# Role: Main orchestrator node — pick/place/push control, signal handling, vision-to-robot coordination
import rclpy
from rclpy.node import Node
from rclpy.callback_groups import ReentrantCallbackGroup
from rclpy.executors import MultiThreadedExecutor
from od_msg.srv import SrvDepthPosition
from ament_index_python.packages import get_package_share_directory
from dsr_msgs2.srv import SetRobotControl
import os

from scipy.spatial.transform import Rotation as R
from std_msgs.msg import Int32
import math
import DR_init
import time
import threading
from pick2build.onrobot import RG
from queue import Empty
import numpy as np
import cv2

from dotenv import load_dotenv
import yaml

from pick2build.shared_state import RobotSharedState
from pick2build.topic_listener import TopicListenerNode

# 로봇 설정 상수
ROBOT_ID = "dsr01"
ROBOT_MODEL = "m0609"
ROBOT_TOOL = "Tool Weight"
ROBOT_TCP = "GripperDA_v2"
VELOCITY, ACC = 400.00, 500.00
GRIPPER_NAME = "rg2"

# 두산 로보틱스의 하드웨어 상태 번호와 제어 명령 번호
STATE_STANDBY = 1
STATE_SAFE_OFF = 3
STATE_SAFE_STOP = 5

CONTROL_RESET_SAFE_STOP = 2
CONTROL_RESET_SAFE_OFF = 3


class RobotWorkerNode(Node):
    def __init__(self, state: RobotSharedState):
        super().__init__('robot_worker', namespace=ROBOT_ID)
        self.state = state

        package_path = get_package_share_directory('pick2build')
        load_dotenv(os.path.join(package_path, 'resource', '.env'))
        with open(os.path.join(package_path, 'config', 'robot_params.yaml')) as f:
            cfg = yaml.safe_load(f)

        self.GO_HOME = cfg['poses']['go_home']
        self.BRICK_APPROACH = cfg['poses']['brick_approach']
        self.HAND_DELIVERY_SCAN = cfg['poses']['hand_delivery_scan']
        self.BLOCK_CFG = cfg['block_types']
        self.PLACE_CFG = cfg['place']

        self.gripper = RG(GRIPPER_NAME,
                          os.getenv('TOOLCHARGER_IP', '192.168.1.1'),
                          os.getenv('TOOLCHARGER_PORT', '502'))
        self.detection_pub = self.create_publisher(Int32, '/dsr01/detection_start', 10)
        self.id_pub = self.create_publisher(Int32, '/signal_id', 10)
        self.srv_control = self.create_client(SetRobotControl, f'/{ROBOT_ID}/system/set_robot_control')

        self.cb_group = ReentrantCallbackGroup()
        self.vision_client = self.create_client(SrvDepthPosition, 'get_3d_position', callback_group=self.cb_group)

    def movel2(self, *args, **kwargs):
        self.check_pause()
        from DSR_ROBOT2 import movel
        return movel(*args, **kwargs)

    def movej2(self, *args, **kwargs):
        self.check_pause()
        from DSR_ROBOT2 import movej
        return movej(*args, **kwargs)

    def call_hw_control(self, control_value):
        if not self.srv_control.wait_for_service(timeout_sec=1.0): return False
        req = SetRobotControl.Request()
        req.robot_control = control_value
        self.srv_control.call_async(req)
        return True

    def check_pause(self, force_state=None):
        from DSR_ROBOT2 import get_robot_state, drl_script_stop, DR_QSTOP_STO, wait
        from DSR_ROBOT2 import release_force, release_compliance_ctrl, set_ref_coord, task_compliance_ctrl, set_stiffnessx, set_desired_force, DR_FC_MOD_ABS

        if str(force_state) == "1":
            force_params = {
                'stiffness': [300.00, 300.00, 100.00, 200.00, 200.00, 50.00],
                'force': [0.00, 0.00, 20.00, 0.00, 0.00, 0.00],
                'dir': [0, 0, 1, 0, 0, 0]
            }
        elif str(force_state) == "2":
            force_params = {
                'stiffness': [50.0, 300.0, 300.0, 200.0, 200.0, 200.0],
                'force': None,
                'dir': None
            }
        else:
            force_params = None

        while rclpy.ok():
            state = get_robot_state()

            if state in [STATE_SAFE_STOP, STATE_SAFE_OFF] or self.state.is_paused:
                if state in [STATE_SAFE_STOP, STATE_SAFE_OFF]:
                    self.get_logger().error(f"하드웨어 정지 감지 (Code: {state})")
                    drl_script_stop(DR_QSTOP_STO)

                    while not self.state.needs_unlock and rclpy.ok():
                        self.get_logger().warn(">>> 안전 확인 후 [/signal_unlock]을 보내세요.", throttle_duration_sec=3.0)
                        time.sleep(0.5)

                    cmd = CONTROL_RESET_SAFE_STOP if state == STATE_SAFE_STOP else CONTROL_RESET_SAFE_OFF
                    self.get_logger().info(f"복구 명령 전송 중 (Command: {cmd})...")
                    self.call_hw_control(cmd)

                    success_recovery = False
                    for i in range(20):
                        time.sleep(0.5)
                        current_state = get_robot_state()
                        if current_state == STATE_STANDBY:
                            success_recovery = True
                            break
                        self.get_logger().info(f"복구 대기 중... 현재 상태: {current_state}")

                    if success_recovery:
                        self.get_logger().info("[성공] 하드웨어가 정상 대기 상태로 전환되었습니다.")
                        self.initialize_robot()
                        self.state.needs_unlock = False

                        if force_params:
                            release_force(time=0.0)
                            release_compliance_ctrl()
                            time.sleep(0.5)
                    else:
                        self.get_logger().error("복구 실패. 하드웨어나 비상정지 버튼을 수동 점검하세요.")
                        self.state.needs_unlock = False
                        continue

                elif self.state.is_paused:
                    if force_params:
                        self.get_logger().warn("일시 정지 감지: 하드웨어 보호를 위해 힘 제어를 임시 해제합니다.")
                        release_force(time=0.0)
                        release_compliance_ctrl()
                        wait(0.5)

                    while self.state.is_paused and rclpy.ok():
                        time.sleep(0.5)

                if force_params:
                    self.get_logger().info("작업 재개: 힘 제어 설정을 원래대로 복원합니다.")
                    set_ref_coord(1)
                    task_compliance_ctrl()
                    set_stiffnessx(force_params['stiffness'], time=0.0)

                    if force_params['force'] is not None:
                        set_desired_force(force_params['force'], force_params['dir'], time=0.0, mod=DR_FC_MOD_ABS)
                    wait(0.5)
                    time.sleep(0.1)

            else:
                break

    def transform_to_base(self, target_coord, npy_path, current_pos):
        T_gripper2camera = np.load(npy_path)

        T_base2gripper = np.eye(4)
        rot = R.from_euler('ZYZ', current_pos[3:], degrees=True).as_matrix()
        T_base2gripper[:3, :3] = rot
        T_base2gripper[:3, 3] = current_pos[:3]

        target_camera = np.array([target_coord[0], target_coord[1], target_coord[2], 1.0])
        target_base = T_base2gripper @ T_gripper2camera @ target_camera

        return target_base[:3]

    def _get_vision_target(self, target_name, timeout_sec=10.0):
        from DSR_ROBOT2 import get_current_posx, DR_BASE
        if not self.vision_client.wait_for_service(timeout_sec=timeout_sec):
            self.get_logger().error("비전 노드를 찾을 수 없습니다.")
            return None

        v_req = SrvDepthPosition.Request()
        v_req.target = target_name
        v_future = self.vision_client.call_async(v_req)

        start = time.time()
        while not v_future.done() and rclpy.ok():
            if time.time() - start >= timeout_sec:
                v_future.cancel()
                self.get_logger().error("비전 서비스 응답 시간 초과")
                return None
            time.sleep(0.05)
        v_res = v_future.result()

        if v_res is not None:
            cam_coords = v_res.depth_position.tolist()
            if sum(cam_coords) != 0:
                pkg_path = get_package_share_directory("pick2build")
                npy_path = os.path.join(pkg_path, "resource", "T_gripper2camera.npy")
                cur_pos, _ = get_current_posx(DR_BASE)
                td_coord = self.transform_to_base(cam_coords, npy_path, cur_pos)
                DEPTH_OFFSET = -5.0
                MIN_DEPTH = 2.0
                td_coord[2] += DEPTH_OFFSET
                td_coord[2] = max(td_coord[2], MIN_DEPTH)
                return list(td_coord[:3]) + cur_pos[3:]
        return None

    def initialize_robot(self):
        from DSR_ROBOT2 import (get_robot_mode, get_tool, get_tcp,
                                set_robot_mode, set_tool, set_tcp,
                                ROBOT_MODE_MANUAL, ROBOT_MODE_AUTONOMOUS)
        if (get_robot_mode() == ROBOT_MODE_AUTONOMOUS and
                get_tool() == ROBOT_TOOL and get_tcp() == ROBOT_TCP):
            return

        set_robot_mode(ROBOT_MODE_MANUAL)
        time.sleep(0.5)
        set_tool(ROBOT_TOOL); set_tcp(ROBOT_TCP)
        set_robot_mode(ROBOT_MODE_AUTONOMOUS)
        time.sleep(2)

    def grasp(self):
        from DSR_ROBOT2 import wait
        self.check_pause()
        wait(0.5)
        self.gripper.close_gripper()
        wait(1)

    def release(self):
        from DSR_ROBOT2 import wait
        self.check_pause()
        wait(0.5)
        self.gripper.open_gripper()
        wait(1)

    def get_transformation_matrix(self):
        src_pts = np.array([[2, 2], [80, 2], [80, 46], [2, 46]], dtype=np.float32)
        dst_pts = np.array([[571.52, 309.13], [572.65, -313.56], [221.37, -313.85], [220.93, 309.72]], dtype=np.float32)
        H, _ = cv2.findHomography(src_pts, dst_pts)
        return H

    def grid_to_base(self, u, v, H):
        point = np.array([[[u, v]]], dtype=np.float32)
        t_point = cv2.perspectiveTransform(point, H)
        return t_point[0][0][0], t_point[0][0][1]

    def brick_pick(self, block_type):
        from DSR_ROBOT2 import (
            posx, posj, wait, move_periodic, mwait,
            DR_MV_MOD_ABS, DR_MV_MOD_REL,
            set_ref_coord, task_compliance_ctrl, set_stiffnessx, set_desired_force,
            get_tool_force, DR_FC_MOD_ABS, release_force, release_compliance_ctrl,
            get_current_posx
        )
        self.is_picked = False

        bt = self.BLOCK_CFG[block_type]
        self.block_id = bt['block_id']
        self.ANGLE_OFFSET = 0
        self.force = bt['pick_force']
        self.periodic = bt['pick_periodic']
        self.brick_coord = bt['coord']

        set_ref_coord(0)
        self.release()

        self.movej2(self.GO_HOME, vel=100.00, acc=80.00)
        self.movej2(posj(self.BRICK_APPROACH), vel=100.00, acc=80.00)
        wait(2.0)
        self.check_pause()

        while not self.state.pose_queue.empty():
            self.state.pose_queue.get_nowait()

        msg = Int32()
        msg.data = self.block_id
        self.detection_pub.publish(msg)
        self.get_logger().info(f"비전 인식 시작 신호 {self.block_id} 발행 완료. 좌표 대기 중...")

        try:
            target_pose = self.state.pose_queue.get(block=True, timeout=15.0)
            self.brick_mesh = int(target_pose[6])
            self.get_logger().info(f"비전 수신 좌표(원본): {target_pose}")

            # [★핵심 해결 로직★] 비전의 삐딱한 각도에서 "진짜 수평 Rz 각도" 추출
            vision_rot = R.from_euler('ZYZ', [target_pose[3], target_pose[4], target_pose[5]], degrees=True).as_matrix()
            vx = vision_rot[0, 0]
            vy = vision_rot[1, 0]
            # ZYZ 좌표계에서 Ry=180일 때 X축은 [-cos(theta), sin(theta)] 방향을 가짐
            true_block_rz = math.degrees(math.atan2(vy, -vx))

            current_pose_init = get_current_posx(0)[0]
            gripper_rz = current_pose_init[5]
            raw_diff = true_block_rz - gripper_rz
            min_rotation = raw_diff - round(raw_diff / 180.0) * 180.0
            optimized_rz = gripper_rz + min_rotation + self.ANGLE_OFFSET

            self.get_logger().info(f"Rz 수학적 보정 완료: 비전({target_pose[5]:.2f}도) -> 진짜 Rz({true_block_rz:.2f}도) -> 목표({optimized_rz:.2f}도)")

            self.movel2(posx([target_pose[0], target_pose[1], target_pose[2], 0.00, 180.00, optimized_rz]), vel=80.0, acc=60.0, radius=0.00, ref=0, mod=DR_MV_MOD_ABS)
            mwait()

            self.movel2(posx([target_pose[0], target_pose[1], -28.0, 0.00, 180.00, optimized_rz]), vel=VELOCITY, acc=ACC, radius=0.00, ref=0, mod=DR_MV_MOD_ABS)
            mwait()

            current_pose = get_current_posx(0)[0]
            self.get_logger().info(f"도착 후 실제 좌표: {current_pose}")
            self.get_logger().info("목표 픽업 위치 도달. 픽업을 진행합니다.")
            self.check_pause()

            self.grasp()
            mwait()

            if self.brick_mesh == 0:
                self.movej2(posj(self.BRICK_APPROACH), vel=100.00, acc=80.00)
                self.movej2(self.GO_HOME, vel=100.00, acc=80.00)
                mwait()

                self.movel2(posx(self.brick_coord), vel=VELOCITY, acc=ACC, radius=0.00, ref=0, mod=DR_MV_MOD_ABS)
                self.movel2(posx([0.00, 0.00, -60.00, 0.00, 0.00, 0.00]), vel=VELOCITY, acc=ACC, ref=0, mod=DR_MV_MOD_REL)
                set_ref_coord(1); task_compliance_ctrl()
                set_stiffnessx([300.00, 300.00, 100.00, 200.00, 200.00, 50.00], time=0.0)
                set_desired_force([0.00, 0.00, 22.00, 0.00, 0.00, 0.00], [0, 0, 1, 0, 0, 0], time=0.0, mod=DR_FC_MOD_ABS)

                attempts = 0
                while rclpy.ok():
                    self.check_pause(1)
                    force = get_tool_force()
                    if self.force <= force[2] <= 300.0:
                        release_force(time=0.0); release_compliance_ctrl(); self.release()
                        mwait()
                        self.movel2(posx([0.00, 0.00, +80.00, 0.00, 0.00, 0.00]), vel=VELOCITY, acc=ACC, ref=0, mod=DR_MV_MOD_REL)
                        break
                    else:
                        move_periodic(self.periodic, 0.8, 0.0, 1)
                    wait(0.05); attempts += 1
                    if attempts > 5:
                        release_force(time=0.0); release_compliance_ctrl(); self.release()
                        mwait()
                        self.movel2(posx([0.00, 0.00, +80.00, 0.00, 0.00, 0.00]), vel=VELOCITY, acc=ACC, ref=0, mod=DR_MV_MOD_REL)
                        break

                self.grasp(); mwait()
                self.movel2(posx([0.00, 0.00, -55.00, 0.00, 0.00, 0.00]), vel=VELOCITY, acc=ACC, ref=0, mod=DR_MV_MOD_REL)
                mwait(); set_ref_coord(1); task_compliance_ctrl()
                set_stiffnessx([300.00, 300.00, 100.00, 200.00, 200.00, 50.00], time=0.0)
                set_desired_force([0.00, 0.00, 20.00, 0.00, 0.00, 0.00], [0, 0, 1, 0, 0, 0], time=0.0, mod=DR_FC_MOD_ABS)

                attempts = 0
                while rclpy.ok():
                    self.check_pause(1)
                    force = get_tool_force()
                    if 20.0 <= force[2] <= 300.0:
                        release_force(time=0.0); release_compliance_ctrl(); self.release()
                        mwait()
                        break
                    else:
                        move_periodic([1.0, 1.0, 0, 0, 0, 2.0], 0.8, 0.0, 1)
                    wait(0.05); attempts += 1
                    if attempts > 5:
                        release_force(time=0.0); release_compliance_ctrl(); self.release()
                        mwait()
                        break
                wait(0.05)

            else:
                set_ref_coord(0)
                self.movej2(posj(self.BRICK_APPROACH), vel=100.00, acc=80.00)
                mwait()
                self.movej2(self.GO_HOME, vel=100.00, acc=80.00)
                mwait()
                self.movel2(posx(self.HAND_DELIVERY_SCAN), vel=VELOCITY, acc=ACC, radius=0.00, ref=0, mod=DR_MV_MOD_ABS)
                mwait()
                wait(5.0)
                hand_pos = None
                self.get_logger().info("현재 위치에서 손 위치를 먼저 스캔합니다.")
                hand_pos = self._get_vision_target('hand')
                if not hand_pos:
                    self.get_logger().error("손 위치를 찾지 못했습니다.")

                if hand_pos:
                    self.movej2(self.GO_HOME, vel=100.0, acc=80.0)
                    dest_pos = list(hand_pos)
                    dest_pos[2] += 30.0
                    self.movel2(dest_pos, vel=VELOCITY, acc=ACC)
                    self.release()
                    mwait()
                    wait(5.0)
                    self.get_logger().info("손으로 전달 완료")
                else:
                    self.get_logger().error("손 위치를 찾지 못해 작업을 중지합니다.")

            self.movel2(posx(self.brick_coord), vel=VELOCITY, acc=ACC, radius=0.00, ref=0, mod=DR_MV_MOD_ABS)
            self.movel2(posx([0.00, 0.00, -80.00, 0.00, 0.00, 0.00]), vel=VELOCITY, acc=ACC, ref=0, mod=DR_MV_MOD_REL)
            self.grasp(); mwait()
            self.movel2(posx([0.00, 0.00, +80.00, 0.00, 0.00, 0.00]), vel=VELOCITY, acc=ACC, ref=0, mod=DR_MV_MOD_REL)
            self.movej2(self.GO_HOME, vel=100.00, acc=80.00)
            mwait()
            self.is_picked = True

        except Empty:
            self.get_logger().error("비전 인식 응답 시간 초과")
            self.movej2(self.GO_HOME, vel=100.00, acc=80.00)
            mwait()
            self.is_picked = False

    def brick_place(self, block_help, block_type, block_level, u, v):
        from DSR_ROBOT2 import (
            posx, wait, move_periodic, mwait,
            DR_MV_MOD_ABS, DR_MV_MOD_REL,
            set_ref_coord, task_compliance_ctrl, set_stiffnessx, set_desired_force,
            get_tool_force, DR_FC_MOD_ABS, release_force, release_compliance_ctrl
        )
        bt = self.BLOCK_CFG[block_type]
        self.rz_coord = bt['place_rz']
        self.force = bt['place_force']
        self.period = bt['place_period']

        self.grasp(); self.movej2(self.GO_HOME, vel=100.00, acc=80.00)
        H = self.get_transformation_matrix()
        x, y = self.grid_to_base(u, v, H)
        z = self.PLACE_CFG['z_base'] + self.PLACE_CFG['z_step'] * (block_level - 1)

        if block_help:
            z += 100
            self.movel2(posx([x, y, z, 129.30, 179.96, self.rz_coord]), vel=VELOCITY, acc=ACC, radius=0.00, ref=0, mod=DR_MV_MOD_ABS)
            set_ref_coord(0)
            wait(5.0)
            hand_pos = None
            self.get_logger().info("현재 위치에서 손 위치를 먼저 스캔합니다.")
            hand_pos = self._get_vision_target('hand')
            if not hand_pos:
                self.get_logger().error("손 위치를 찾지 못했습니다.")

            if hand_pos:
                self.movej2(self.GO_HOME, vel=100.0, acc=80.0)
                dest_pos = list(hand_pos)
                dest_pos[2] += 30.0
                self.movel2(dest_pos, vel=VELOCITY, acc=ACC)
                self.release()
                mwait()
                wait(5.0)
                self.get_logger().info("손으로 전달 완료")
            else:
                self.get_logger().error("손 위치를 찾지 못해 작업을 중지합니다.")

        else:
            self.movel2(posx([x, y, z, 129.30, 179.96, self.rz_coord]), vel=VELOCITY, acc=ACC, radius=0.00, ref=0, mod=DR_MV_MOD_ABS)
            self.movel2(posx([0.00, 0.00, -85.00, 0.00, 0.00, 0.00]), vel=VELOCITY, acc=ACC, ref=0, mod=DR_MV_MOD_REL)
            mwait(); set_ref_coord(1); task_compliance_ctrl()
            set_stiffnessx([300.00, 300.00, 100.00, 200.00, 200.00, 50.00], time=0.0)
            set_desired_force([0.00, 0.00, 22.00, 0.00, 0.00, 0.00], [0, 0, 1, 0, 0, 0], time=0.0, mod=DR_FC_MOD_ABS)

            attempts = 0
            while rclpy.ok():
                self.check_pause(1)
                force = get_tool_force()
                if self.force <= force[2] <= 300.0:
                    release_force(time=0.0); release_compliance_ctrl()
                    mwait()
                    self.release()
                    break
                else:
                    move_periodic(self.period, 0.8, 0.0, 1)
                wait(0.05); attempts += 1
                if attempts > 5:
                    release_force(time=0.0); release_compliance_ctrl()
                    mwait()
                    self.release()
                    break

            self.movel2(posx([0.00, 0.00, 100.00, 0.00, 0.00, 0.00]), vel=VELOCITY, acc=ACC, ref=0, mod=DR_MV_MOD_REL)
            self.grasp(); self.movel2(posx([0.00, 0.00, -70.00, 0.00, 0.00, 0.00]), vel=VELOCITY, acc=ACC, ref=0, mod=DR_MV_MOD_REL)
            mwait(); set_ref_coord(1); task_compliance_ctrl()
            set_stiffnessx([300.00, 300.00, 100.00, 200.00, 200.00, 50.00], time=0.0)
            set_desired_force([0.00, 0.00, 22.00, 0.00, 0.00, 0.00], [0, 0, 1, 0, 0, 0], time=0.0, mod=DR_FC_MOD_ABS)

            attempts = 0
            while rclpy.ok():
                self.check_pause(1)
                force = get_tool_force()
                if 22.0 <= force[2] <= 300.0:
                    release_force(time=0.0); release_compliance_ctrl()
                    mwait()
                    self.release()
                    mwait()
                    break
                else:
                    move_periodic([1.0, 1.0, 0, 0, 0, 2.0], 0.8, 0.0, 1)
                wait(0.05); attempts += 1
                if attempts > 5:
                    release_force(time=0.0); release_compliance_ctrl()
                    mwait()
                    self.release()
                    break

            self.movel2(posx([0.00, 0.00, 100.00, 0.00, 0.00, 0.00]), vel=VELOCITY, acc=ACC, ref=0, mod=DR_MV_MOD_REL)
            set_ref_coord(0)
            mwait()

    def perform_task(self):
        while rclpy.ok():
            try:
                block_help, block_id, block_type, block_level, u, v = self.state.task_queue.get(block=True, timeout=1.0)
                self.initialize_robot()
            except Empty:
                continue
            try:
                self.get_logger().info(f"작업 시작: Human({block_help}) ID ({block_id}) Type({block_type}) level({block_level}) Grid({u}, {v})")
                retry_count = 0; max_retries = 3; self.is_picked = False

                while not self.is_picked and rclpy.ok():
                    self.brick_pick(block_type)
                    if not self.is_picked:
                        retry_count += 1
                        if retry_count >= max_retries:
                            self.state.is_paused = True
                            self.check_pause()
                            retry_count = 0

                self.brick_place(block_help, block_type, block_level, u, v)

                self.get_logger().info(f"작업 완료: Human({block_help}) ID ({block_id}) Type({block_type}) level({block_level}) Grid({u}, {v})")

                done_msg = Int32()
                done_msg.data = block_id
                self.id_pub.publish(done_msg)
                self.get_logger().info(f"완료 신호 {block_id} 발행 완료")

            except Exception as e:
                self.get_logger().error(f"로봇 에러 발생: {e}")
            finally:
                self.state.task_queue.task_done()


def main(args=None):
    rclpy.init(args=args)
    state = RobotSharedState()
    listener_node = TopicListenerNode(state)
    worker_node = RobotWorkerNode(state)

    DR_init.__dsr__id = ROBOT_ID
    DR_init.__dsr__model = ROBOT_MODEL
    DR_init.__dsr__node = worker_node

    executor = MultiThreadedExecutor(num_threads=4)
    executor.add_node(listener_node)
    executor.add_node(worker_node)

    spin_thread = threading.Thread(target=executor.spin, daemon=True)
    spin_thread.start()

    try:
        worker_node.perform_task()
    except KeyboardInterrupt:
        pass
    finally:
        executor.shutdown()
        listener_node.destroy_node()
        worker_node.destroy_node()
        rclpy.shutdown()


if __name__ == "__main__":
    main()
