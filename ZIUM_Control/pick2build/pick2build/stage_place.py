# Role: Main orchestrator node — pick/place/push control, signal handling, vision-to-robot coordination
import rclpy
from rclpy.node import Node
from rclpy.callback_groups import ReentrantCallbackGroup
from rclpy.executors import MultiThreadedExecutor
from std_msgs.msg import String, Bool, Float64MultiArray
from std_srvs.srv import Trigger

from od_msg.srv import SrvDepthPosition
from ament_index_python.packages import get_package_share_directory
from dsr_msgs2.srv import SetRobotControl
import os

from scipy.spatial.transform import Rotation as R
from std_msgs.msg import Int32
import json
import DR_init # 전역 설정을 위해 먼저 임포트
import time
import threading
from pick2build.onrobot import RG
from queue import Queue, Empty
import numpy as np
import cv2

# 로봇 설정 상수
ROBOT_ID = "dsr01"
ROBOT_MODEL = "m0609"
ROBOT_TOOL = "Tool Weight"
ROBOT_TCP = "GripperDA_v2"
VELOCITY, ACC = 400.00, 500.00
GRIPPER_NAME = "rg2"
TOOLCHARGER_IP = "192.168.1.1"
TOOLCHARGER_PORT = "502"

# 두산 로보틱스의 하드웨어 상태 번호와 제어 명령 번호
# 로봇 상태 상수
STATE_STANDBY = 1    # 정상 대기
STATE_SAFE_OFF = 3   # 서보 꺼짐
STATE_SAFE_STOP = 5  # 안전 정지

# 제어 명령 상수
CONTROL_RESET_SAFE_STOP = 2
CONTROL_RESET_SAFE_OFF = 3

# 제어상태 변수 정의
is_paused = False
needs_unlock = False

# 큐 저장소
task_queue = Queue()
pose_queue = Queue()


class TopicListenerNode(Node):
    def __init__(self):
        super().__init__('topic_listener')
        self.subscription = self.create_subscription(String, '/block/info', self.listener_callback, 10)
        self.pose_sub = self.create_subscription(Float64MultiArray, '/dsr01/target_lego_pose', self.pose_callback, 10)
        self.create_subscription(Int32, '/signal_stop', self.stop_callback, 10)
        self.create_subscription(Int32, '/signal_start', self.start_callback, 10)
        self.create_subscription(Int32, '/signal_unlock', self.unlock_callback, 10)
        self.get_logger().info(">>> [통신 노드] 가동 완료. 대기 중...")

    def listener_callback(self, msg):
        try:
            blocks = json.loads(msg.data)
            for b in blocks:
                block_id = int(b['id']) 
                block_type = str(b['type'])
                block_level = float(b['level'])
                block_help = bool(b['help'])
                u = float(b['coordinate']['x'])
                v = float(b['coordinate']['y'])
                task_queue.put_nowait((block_help,block_id,block_type,block_level, u, v))
                self.get_logger().info(f"큐에 추가됨 - Human : {block_help} | Id : {block_id} | Type: {block_type} | Level: {block_level}| Grid: ({u}, {v})")
        except Exception as e:
            self.get_logger().error(f"JSON 파싱 에러: {e}")

    def pose_callback(self, msg):
        try:
            if len(msg.data) >= 7:
                target_pose = list(msg.data[:7])
                pose_queue.put_nowait(target_pose)
                self.get_logger().info(f"비전 목표 좌표 수신 완료: {target_pose}")
        except Exception as e:
            self.get_logger().error(f"좌표 수신 에러: {e}")

    # 작업의 일시 정지 및 재개를 제어
    def stop_callback(self, msg):
        global is_paused
        self.get_logger().warn("[Pause] 일시 정지 수신")
        is_paused = True

    def start_callback(self, msg):
        global is_paused
        self.get_logger().info("[Resume] 작업 재개 수신")
        is_paused = False

    # 로봇이 안전 정지 상태일 때, 사용자가 위험 요소가 없음을 확인하고 보내는 "해제 신호"를 처리
    def unlock_callback(self, msg):
        global needs_unlock
        if msg.data == 1:
            self.get_logger().info("[Unlock] 해제 신호 확인")
            needs_unlock = True


class RobotWorkerNode(Node):
    def __init__(self):
        super().__init__('robot_worker', namespace=ROBOT_ID)
        self.gripper = RG(GRIPPER_NAME, TOOLCHARGER_IP, TOOLCHARGER_PORT)
        self.detection_pub = self.create_publisher(Int32, '/dsr01/detection_start', 10)
        self.id_pub = self.create_publisher(Int32, '/signal_id', 10)
        # 제어용 서보 컨트롤
        self.srv_control = self.create_client(SetRobotControl, f'/{ROBOT_ID}/system/set_robot_control')

        self.cb_group = ReentrantCallbackGroup()
        self.stt_client = self.create_client(Trigger, '/get_keyword', callback_group=self.cb_group)
        self.vision_client = self.create_client(SrvDepthPosition, 'get_3d_position', callback_group=self.cb_group)

    # chesk_pause + movel 기능 정의
    def movel2(self, *args, **kwargs):
        self.check_pause()
        from DSR_ROBOT2 import movel
        return movel(*args, **kwargs)

    # chesk_pause + movej 기능 정의
    def movej2(self, *args, **kwargs):
        self.check_pause()
        from DSR_ROBOT2 import movej
        return movej(*args, **kwargs)
    
    def call_hw_control(self, control_value):
        # 하드웨어 제어 서비스(srv_control)를 호출하여 로봇의 잠금을 풀거나 전원을 다시 넣는 역할
        # 로봇 제어 서비스가 현재 살아있는지 1초간 확인 : 응답이 없으면 실패(False)를 반환
        if not self.srv_control.wait_for_service(timeout_sec=1.0): return False
        # 두산 로봇 하드웨어 제어를 위한 요청 객체를 생성
        req = SetRobotControl.Request()
        #요청 객체에 실제 명령(예: 안전 정지 해제 등)을 담음
        req.robot_control = control_value
        self.srv_control.call_async(req) # 응답을 기다리지 않고 즉시 반환 : 프로그램 정지 방지
        return True # 명령이 일단 성공적으로 전송

    def check_pause(self, force_state=None):
        global is_paused, needs_unlock
        from DSR_ROBOT2 import get_robot_state, drl_script_stop, DR_QSTOP_STO , wait
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
        else :
            force_params = None

        while rclpy.ok():
            state = get_robot_state()
            
            if state in [STATE_SAFE_STOP, STATE_SAFE_OFF] or is_paused:
                if state in [STATE_SAFE_STOP, STATE_SAFE_OFF]:
                    self.get_logger().error(f"하드웨어 정지 감지 (Code: {state})")
                    drl_script_stop(DR_QSTOP_STO) # DRL 큐 강제 초기화 (Stale 명령 방지)
                    
                    while not needs_unlock and rclpy.ok():
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
                        needs_unlock = False
                        
                        # [안전장치 1] 복구 완료 직후 남아있을지 모를 힘 제어 변수 강제 초기화
                        if force_params:
                            release_force(time=0.0)
                            release_compliance_ctrl()
                            time.sleep(0.5) 
                    else:
                        self.get_logger().error("복구 실패. 하드웨어나 비상정지 버튼을 수동 점검하세요.")
                        needs_unlock = False
                        continue 

                elif is_paused:
                    # 정상 상태에서 멈출 때만 부드럽게 힘을 뺌
                    if force_params:
                        self.get_logger().warn("일시 정지 감지: 하드웨어 보호를 위해 힘 제어를 임시 해제합니다.")
                        release_force(time=0.0)
                        release_compliance_ctrl()
                        wait(0.5) 
                        
                    while is_paused and rclpy.ok():
                        time.sleep(0.5)

                if force_params:
                    self.get_logger().info("작업 재개: 힘 제어 설정을 원래대로 복원합니다.")
                    set_ref_coord(1)
                    task_compliance_ctrl()
                    set_stiffnessx(force_params['stiffness'], time=0.0)
                    
                    # 상태 "1"일 때만 force가 있으므로 적용. "2"일 때는 자연스럽게 스킵됨.
                    if force_params['force'] is not None:
                        set_desired_force(force_params['force'], force_params['dir'], time=0.0, mod=DR_FC_MOD_ABS)
                    wait(0.5)
                    time.sleep(0.1)

            else:
                break # 에러도 없고 정지도 아니면 탈출하여 메인 작업 계속

    # 기존 robot_control.py 에 있던 카메라 -> 로봇 좌표계 변환 함수 이식
    def transform_to_base(self, target_coord, npy_path, current_pos):
        T_gripper2camera = np.load(npy_path)
        
        # 현재 로봇 좌표를 4x4 행렬로 변환
        T_base2gripper = np.eye(4)
        rot = R.from_euler('ZYZ', current_pos[3:], degrees=True).as_matrix()
        T_base2gripper[:3, :3] = rot
        T_base2gripper[:3, 3] = current_pos[:3]
        
        # 타겟의 카메라 기준 좌표를 동차좌표계(4x1)로 변환
        target_camera = np.array([target_coord[0], target_coord[1], target_coord[2], 1.0])
        
        # 베이스 기준 좌표 계산: T_base2gripper * T_gripper2camera * target_camera
        target_base = T_base2gripper @ T_gripper2camera @ target_camera
        
        return target_base[:3] # x, y, z 리턴

    def _get_vision_target(self, target_name, timeout_sec=10.0):
        from DSR_ROBOT2 import get_current_posx, DR_BASE
        temp_vision = rclpy.create_node(f'temp_vision_{int(time.time())}')
        v_client = temp_vision.create_client(SrvDepthPosition, 'get_3d_position')
        if not v_client.wait_for_service(timeout_sec=timeout_sec):
            self.get_logger().error("비전 노드를 찾을 수 없습니다.")
            temp_vision.destroy_node()
            return None

        v_req = SrvDepthPosition.Request()
        v_req.target = target_name
        v_future = v_client.call_async(v_req)
        rclpy.spin_until_future_complete(temp_vision, v_future)
        v_res = v_future.result()
        temp_vision.destroy_node()

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
        
    def perform_task(self):
        from DSR_ROBOT2 import (
            posx, posj, movej, movel, wait, move_periodic,movejx,
            DR_MV_MOD_ABS, DR_MV_RA_DUPLICATE, DR_MV_MOD_REL,
            set_tool, set_tcp, get_tool, get_tcp, mwait,
            ROBOT_MODE_MANUAL, ROBOT_MODE_AUTONOMOUS, get_robot_mode, set_robot_mode,
            set_ref_coord, task_compliance_ctrl, set_stiffnessx, set_desired_force,get_tool_force,DR_BASE,
            check_force_condition, release_force, release_compliance_ctrl,get_current_posx,
            DR_FC_MOD_ABS, DR_TOOL, DR_AXIS_Z
        )

        go_home = [0.051,6.463,54.335,-0.066,119.191,0.028]

        def grasp(): self.check_pause(); wait(0.5); self.gripper.close_gripper(); wait(1)
        def release(): self.check_pause(); wait(0.5); self.gripper.open_gripper(); wait(1)

        def check_x_push_and_execute(block_id):
            self.check_pause(); self.get_logger().info("1초 대기: 로봇을 X방향으로 살짝 밀면 음성 인식(시동어) 대기 상태가 됩니다.")

            msg = Int32()
            msg.data = block_id
            
            set_ref_coord(1);task_compliance_ctrl()
            set_stiffnessx([50.0, 300.0, 300.0, 200.0, 200.0, 200.0], time=0.0) 
            
            start_t = time.time()
            triggered = False
            
            while rclpy.ok() and (time.time() - start_t) < 5.0:
                self.check_pause(2)
                force = get_tool_force(DR_BASE)
                if abs(force[0]) > 10.0:
                    triggered = True
                    break
                wait(0.05)
                
            release_compliance_ctrl();set_ref_coord(0)
            mwait()
            
            if triggered:
                current_pos, _ = get_current_posx(0)
                current_z = current_pos[2]
                if current_z <= 300.0:
                    self.movel2(posx([0.00, 0.00, +200.00, 0.00, 0.00, 0.00]), vel=VELOCITY, acc=ACC, ref=0, mod=DR_MV_MOD_REL)
                    mwait()
                self.get_logger().info("X축 밀기 감지 완료! 삐- 소리 후 원하시는 도구를 말씀해 주세요.")
                print("\a") # 터미널 비프음 알림
                
                # [1. 음성 인식 서비스 호출]
                temp_stt_node = rclpy.create_node('temp_stt_client_node')
                client = temp_stt_node.create_client(Trigger, '/get_keyword')
                
                if not client.wait_for_service(timeout_sec=3.0):
                    self.get_logger().error("음성 인식 노드(/get_keyword)가 실행되어 있지 않습니다.")
                    temp_stt_node.destroy_node()
                    return

                req = Trigger.Request()
                future = client.call_async(req)
                rclpy.spin_until_future_complete(temp_stt_node, future)
                response = future.result()
                temp_stt_node.destroy_node()
                
                if response is not None and response.success:
                    data = response.message.split(',')
                    obj = data[0].strip() if len(data) > 0 else ""
                    tgt = data[1].strip() if len(data) > 1 else ""
                    
                    if obj:
                        self.get_logger().info(f"명령 수신 성공: [{obj}]를 [{tgt}]로 이동")
                        
                        saved_positions = {
                            "vision_pos": [-473.049,149.734,201.853,175.522,179.372,-94.333]
                        }

                        # [2. 손 위치 먼저 파악 (tgt == 'hand'인 경우)]
                        hand_pos = None
                        if tgt.lower() == 'hand':
                            self.get_logger().info("현재 위치에서 손 위치를 먼저 스캔합니다.")
                            hand_pos = self._get_vision_target('hand', timeout_sec=3.0)
                            if not hand_pos:
                                self.get_logger().error("손 위치를 찾지 못했습니다.")

                        # [3. 물체 인식을 위한 전용 위치로 이동]
                        self.get_logger().info("물체 인식을 위해 전용 위치로 이동합니다.")
                        # 안전 경유지
                        self.movej2(go_home, vel=100.0, acc=80.0)
                        mwait()
                        self.movej2(posj([100.88, 4.44, 57.62, -0.01, 118.14, 100.60]), vel=100.0, acc=80.0)
                        self.movej2(posj([161.509, 18.008, 65.921, 0.07, 95.456, 251.794]), vel=100.0, acc=80.0)
                        mwait()
                        self.check_pause();wait(1.0)

                        # [4. 이동한 위치에서 물체(obj) 탐색 수행]
                        self.get_logger().info(f"인식 지점에서 [{obj}] 탐색 중...")
                        tool_pos = self._get_vision_target(obj, timeout_sec=3.0)

                        if tool_pos:
                            # [5. 물체 집기 (Pick)]
                            self.get_logger().info(f"--- {obj} 집기 수행 ---")
                            pick_pos = list(tool_pos)
                            pick_pos[2] = -30 # 물체 바로 위로 접근 (높이 보정)
                            self.get_logger().info(f"좌표 [{pick_pos[0]},{pick_pos[1]},{pick_pos[2]}] 탐색 중...")
                            self.movel2(pick_pos, vel=VELOCITY, acc=ACC)
                            mwait()
                            grasp()
                            mwait()
                            
                            pick_pos[2] = 0
                            self.movel2(pick_pos, vel=VELOCITY, acc=ACC)
                            mwait()

                            self.movel2(saved_positions["vision_pos"], vel=100.0, acc=80.0)
                            # 물체를 들고 다시 중간 안전 위치로
                            self.movej2(posj([100.88, 4.44, 57.62, -0.01, 118.14, 100.60]), vel=100.0, acc=80.0)
                            mwait()

                            # [6. 목적지로 이동 (Place)]
                            if tgt.lower() == 'hand':
                                if hand_pos:
                                    self.movej2(go_home, vel=100.0, acc=80.0) # init_robot2 (중간 안전 위치 경유)
                                    dest_pos = list(hand_pos)
                                    dest_pos[2] += 30.0 # 손 위 30mm 지점에서 정지
                                    self.movel2(dest_pos, vel=VELOCITY, acc=ACC)
                                    release()
                                    self.get_logger().info("손으로 전달 완료")
                                else:
                                    self.get_logger().error("손 위치를 찾지 못해 작업을 중지합니다.")
                                    
                            elif tgt in saved_positions:
                                self.get_logger().info(f"[{tgt}] 위치로 이동하여 내려놓습니다.")
                                self.movej2(go_home, vel=100.0, acc=80.0)
                                self.movel2(saved_positions[tgt], vel=VELOCITY, acc=ACC)
                                release()

                            # [7. 최종 복귀]
                            self.movej2(go_home, vel=100.0, acc=80.0)
                            release()
                        else:
                            self.get_logger().warn(f"카메라에서 [{obj}]를 찾지 못했습니다.")
                            self.movej2(go_home, vel=100.0, acc=80.0)
                    else:
                        self.get_logger().warn("명령어에서 객체를 추출하지 못했습니다.")
                else:
                    self.get_logger().warn("음성 인식 실패 또는 아무 말도 하지 않았습니다.")
            else:
                self.get_logger().info("밀기 감지 안 됨. 다음 블록 작업 대기 상태로 넘어갑니다.")

            self.id_pub.publish(msg)
            self.get_logger().info(f"완료 신호 {self.block_id} 발행 완료")

        # --- 아래는 기존에 있던 블록 조립 함수들 생략 없이 그대로 유지 ---
        def get_transformation_matrix():
            src_pts = np.array([[2, 2],[80, 2],[80, 46],[2, 46]], dtype=np.float32)
            dst_pts = np.array([[571.52,309.13],[572.65,-313.56],[221.37,-313.85],[220.93,309.72]], dtype=np.float32)
            H, _ = cv2.findHomography(src_pts, dst_pts)
            return H

        def grid_to_base(u, v, H):
            point = np.array([[[u, v]]], dtype=np.float32)
            t_point = cv2.perspectiveTransform(point, H)
            return t_point[0][0][0], t_point[0][0][1]
        
        def brick_pick(block_type):
            self.is_picked = False
            # 1. 블록 타입에 따른 ID 부여
            if block_type == "1" or block_type == "2":
                self.block_id = 0
                self.ANGLE_OFFSET = 0
                self.force = 20
                self.periodic = [0.5, 1.5, 0, 0, 0, 2.0]
                self.brick_coord = [579.61,-10.213,83.007,129.30, 179.96, 129.15]
                
            elif block_type == "3" or block_type == "4":
                self.block_id = 1
                self.ANGLE_OFFSET = 0
                self.force = 19
                self.periodic = [1.0, 1.0, 0, 0, 0, 2.0]
                self.brick_coord = [571.966,-10.213, 82.007,129.30, 179.96, 129.15]

            elif block_type == "5" or block_type == "6":
                self.block_id = 2
                self.ANGLE_OFFSET = 0
                self.force = 22
                self.periodic = [1.5, 1.5, 0, 0, 0, 2.0]
                self.brick_coord = [571.21,-18.32,82.007,129.30, 179.96, 129.15]
                
            set_ref_coord(0) 
            release()
            
            self.movej2(go_home, vel=100.00, acc=80.00)
            self.movej2(posj([-128.53, 13.51, 69.47, -0.05, 97.03, 140.00]), vel=100.00, acc=80.00)
            wait(2.0)
            self.check_pause()
            
            # 3. 큐 비우기
            while not pose_queue.empty():
                pose_queue.get_nowait()
            
            # 4. 비전 인식 요청
            msg = Int32()
            msg.data = self.block_id
            self.detection_pub.publish(msg)
            self.get_logger().info(f"비전 인식 시작 신호 {self.block_id} 발행 완료. 좌표 대기 중...")

            try:
                # 5. 비전 좌표 수신 대기 
                target_pose = pose_queue.get(block=True, timeout=15.0)
                self.brick_mesh = int(target_pose[6])
                self.get_logger().info(f"비전 수신 좌표(원본): {target_pose}")

                # ----------------------------------------------------------------
                # [★핵심 해결 로직★] 비전의 삐딱한 각도에서 "진짜 수평 Rz 각도" 추출
                # ----------------------------------------------------------------
                import math
                # 1. 비전이 준 오일러 각(ZYZ)을 3D 회전 행렬(Matrix)로 변환
                vision_rot = R.from_euler('ZYZ', [target_pose[3], target_pose[4], target_pose[5]], degrees=True).as_matrix()
                
                # 2. 블록의 X축이 실제로 가리키는 3D 벡터 추출
                vx = vision_rot[0, 0]
                vy = vision_rot[1, 0]
                
                # 3. 로봇을 완벽한 수직(Rx=0, Ry=180)으로 강제했을 때 필요한 '순수 Rz' 역산
                # (ZYZ 좌표계에서 Ry=180일 때 X축은 [-cos(theta), sin(theta)] 방향을 가집니다)
                true_block_rz = math.degrees(math.atan2(vy, -vx))
                # ----------------------------------------------------------------

                # 이제 추출해 낸 '진짜 수평 각도(true_block_rz)'를 기반으로 180도 최적화를 진행합니다.
                current_pose_init = get_current_posx(0)[0]
                gripper_rz = current_pose_init[5]

                raw_diff = true_block_rz - gripper_rz
                min_rotation = raw_diff - round(raw_diff / 180.0) * 180.0
                
                optimized_rz = gripper_rz + min_rotation + self.ANGLE_OFFSET
                
                self.get_logger().info(f"Rz 수학적 보정 완료: 비전({target_pose[5]:.2f}도) -> 진짜 Rz({true_block_rz:.2f}도) -> 목표({optimized_rz:.2f}도)")

                # 6. 블록 상단(접근 위치)으로 1차 이동 (이때도 무조건 Rx=0, Ry=180 으로 똑바로 서서 접근해야 안전합니다)
                self.movel2(posx([target_pose[0], target_pose[1], target_pose[2], 0.00, 180.00, optimized_rz]), vel=80.0, acc=60.0, radius=0.00, ref=0, mod=DR_MV_MOD_ABS)
                mwait() 
                
                #7. 픽업 위치로 2차 하강
                self.movel2(posx([target_pose[0], target_pose[1], -28.0, 0.00, 180.00, optimized_rz]), vel=VELOCITY, acc=ACC, radius=0.00, ref=0, mod=DR_MV_MOD_ABS)
                mwait() 

                current_pose = get_current_posx(0)[0]
                self.get_logger().info(f"도착 후 실제 좌표: {current_pose}")
                self.get_logger().info("목표 픽업 위치 도달. 픽업을 진행합니다.")
                self.check_pause()
                
                # 8. 블록 잡기
                grasp()
                mwait()
                
                if self.brick_mesh == 0 :
                    # 들어 올린 후 홈으로 복귀
                    self.movej2(posj([-128.53, 13.51, 69.47, -0.05, 97.03, 140.00]), vel=100.00, acc=80.00)
                    self.movej2(go_home, vel=100.00, acc=80.00)
                    mwait()

                    self.movel2(posx(self.brick_coord), vel=VELOCITY, acc=ACC, radius=0.00, ref=0, mod=DR_MV_MOD_ABS)
                    self.movel2(posx([0.00, 0.00, -60.00, 0.00, 0.00, 0.00]), vel=VELOCITY, acc=ACC, ref=0, mod=DR_MV_MOD_REL)
                    set_ref_coord(1); task_compliance_ctrl()
                    set_stiffnessx([300.00, 300.00, 100.00, 200.00, 200.00, 50.00],time=0.0)
                    set_desired_force([0.00, 0.00, 22.00, 0.00, 0.00, 0.00],[0,0,1,0,0,0],time=0.0,mod=DR_FC_MOD_ABS)

                    attempts = 0
                    while rclpy.ok():
                        self.check_pause(1)
                        force = get_tool_force()
                        if self.force <= force[2] <= 300.0:
                            release_force(time=0.0); release_compliance_ctrl(); release()
                            mwait()
                            self.movel2(posx([0.00, 0.00, +80.00, 0.00, 0.00, 0.00]), vel=VELOCITY, acc=ACC, ref=0, mod=DR_MV_MOD_REL)
                            break                   
                        else:
                            move_periodic(self.periodic, 0.8, 0.0, 1)
                        wait(0.05); attempts += 1
                        if attempts > 5:
                            release_force(time=0.0); release_compliance_ctrl(); release()
                            mwait()
                            self.movel2(posx([0.00, 0.00, +80.00, 0.00, 0.00, 0.00]), vel=VELOCITY, acc=ACC, ref=0, mod=DR_MV_MOD_REL)
                            break

                    grasp(); mwait()
                    self.movel2(posx([0.00, 00.00, -55.00, 0.00, 0.00, 0.00]), vel=VELOCITY, acc=ACC, ref=0, mod=DR_MV_MOD_REL)
                    mwait(); set_ref_coord(1); task_compliance_ctrl()
                    set_stiffnessx([300.00, 300.00, 100.00, 200.00, 200.00, 50.00],time=0.0)
                    set_desired_force([0.00, 0.00, 20.00, 0.00, 0.00, 0.00],[0,0,1,0,0,0],time=0.0,mod=DR_FC_MOD_ABS)
                    
                    attempts = 0
                    while rclpy.ok():
                        self.check_pause(1)
                        force = get_tool_force()
                        if 20.0 <= force[2] <= 300.0:
                            release_force(time=0.0); release_compliance_ctrl(); release()
                            mwait()
                            break
                        else:
                            move_periodic([1.0, 1.0, 0, 0, 0, 2.0], 0.8, 0.0, 1)
                        wait(0.05); attempts += 1
                        if attempts > 5:
                            release_force(time=0.0); release_compliance_ctrl(); release()
                            mwait()
                            break 
                    wait(0.05)

                else:
                    set_ref_coord(0)
                    self.movej2(posj([-128.53, 13.51, 69.47, -0.05, 97.03, 140.00]), vel=100.00, acc=80.00)
                    mwait()
                    self.movej2(go_home, vel=100.00, acc=80.00)
                    mwait()
                    self.movel2(posx([571.966,-10.213,232.007,129.30, 179.96, 129.15]), vel=VELOCITY, acc=ACC, radius=0.00, ref=0, mod=DR_MV_MOD_ABS)
                    mwait()
                    wait(5.0)
                    # [손 위치]
                    hand_pos = None
                    self.get_logger().info("현재 위치에서 손 위치를 먼저 스캔합니다.")
                    hand_pos = self._get_vision_target('hand')
                    if not hand_pos:
                        self.get_logger().error("손 위치를 찾지 못했습니다.")

                    # [6. 손으로 이동 (Place)]
                    if hand_pos:
                        self.movej2(go_home, vel=100.0, acc=80.0) # init_robot2 (중간 안전 위치 경유)
                        dest_pos = list(hand_pos)
                        dest_pos[2] += 30.0 # 손 위 30mm 지점에서 정지
                        self.movel2(dest_pos, vel=VELOCITY, acc=ACC)
                        release()
                        mwait()
                        wait(5.0)
                        self.get_logger().info("손으로 전달 완료")
                    else:
                        self.get_logger().error("손 위치를 찾지 못해 작업을 중지합니다.")

                self.movel2(posx(self.brick_coord), vel=VELOCITY, acc=ACC, radius=0.00, ref=0, mod=DR_MV_MOD_ABS)
                self.movel2(posx([0.00, 0.00, -80.00, 0.00, 0.00, 0.00]), vel=VELOCITY, acc=ACC, ref=0, mod=DR_MV_MOD_REL)
                grasp(); mwait()
                self.movel2(posx([0.00, 0.00, +80.00, 0.00, 0.00, 0.00]), vel=VELOCITY, acc=ACC, ref=0, mod=DR_MV_MOD_REL)
                self.movej2(go_home, vel=100.00, acc=80.00)
                mwait()
                self.is_picked = True
                
            except Empty:
                self.get_logger().error("비전 인식 응답 시간 초과")
                self.movej2(go_home, vel=100.00, acc=80.00)
                mwait()
                self.is_picked = False
                return

        def brick_place(block_help,block_type,block_level,u,v):
            if block_type == "1" or block_type == "3" or block_type == "5":
                self.rz_coord = 39.15
            elif block_type == "2" or block_type == "4" or block_type == "6":
                self.rz_coord = 129.15

            if block_type == "1" or block_type == "2":
                self.force = 20
                if block_type == "1":
                    self.period = [1.0, 0.3, 0, 0, 0, 1.0]
                if block_type == "2":
                    self.period = [0.3, 1.0, 0, 0, 0, 1.0]
                
            elif block_type == "3" or block_type == "4":
                self.force = 19
                self.period = [0.5, 0.5, 0, 0, 0, 1.0]

            elif block_type == "5" or block_type == "6":
                self.force = 22
                self.period = [1.0, 1.0, 0, 0, 0, 1.0]

            grasp(); self.movej2(go_home, vel=100.00, acc=80.00)
            H = get_transformation_matrix()
            x, y = grid_to_base(u,v, H)
            z = 103.507 + 20 * (block_level-1)
            if block_help:
                z += 100
                self.movel2(posx([x, y, z, 129.30, 179.96, self.rz_coord]), vel=VELOCITY, acc=ACC, radius=0.00, ref=0, mod=DR_MV_MOD_ABS)
                set_ref_coord(0)
                wait(5.0)
                # [손 위치]
                hand_pos = None
                self.get_logger().info("현재 위치에서 손 위치를 먼저 스캔합니다.")
                hand_pos = self._get_vision_target('hand')
                if not hand_pos:
                    self.get_logger().error("손 위치를 찾지 못했습니다.")

                # [손으로 이동 (Place)]
                if hand_pos:
                    self.movej2(go_home, vel=100.0, acc=80.0) # init_robot2 (중간 안전 위치 경유)
                    dest_pos = list(hand_pos)
                    dest_pos[2] += 30.0 # 손 위 30mm 지점에서 정지
                    self.movel2(dest_pos, vel=VELOCITY, acc=ACC)
                    release()
                    mwait()
                    wait(5.0)
                    self.get_logger().info("손으로 전달 완료")
                else:
                    self.get_logger().error("손 위치를 찾지 못해 작업을 중지합니다.")

            else:
                self.movel2(posx([x, y, z, 129.30, 179.96, self.rz_coord]), vel=VELOCITY, acc=ACC, radius=0.00, ref=0, mod=DR_MV_MOD_ABS)
                self.movel2(posx([0.00, 0.00, -85.00, 0.00, 0.00, 0.00]), vel=VELOCITY, acc=ACC, ref=0, mod=DR_MV_MOD_REL)
                mwait(); set_ref_coord(1); task_compliance_ctrl()
                set_stiffnessx([300.00, 300.00, 100.00, 200.00, 200.00, 50.00],time=0.0)
                set_desired_force([0.00, 0.00, 22.00, 0.00, 0.00, 0.00],[0,0,1,0,0,0],time=0.0,mod=DR_FC_MOD_ABS)
                
                attempts = 0
                while rclpy.ok():
                    self.check_pause(1)
                    force = get_tool_force()
                    if self.force <= force[2] <= 300.0:
                        release_force(time=0.0); release_compliance_ctrl()
                        mwait()
                        release()
                        break                   
                    else:
                        move_periodic(self.period, 0.8, 0.0, 1)
                    wait(0.05); attempts += 1
                    if attempts > 5:
                        release_force(time=0.0); release_compliance_ctrl()
                        mwait()
                        release()
                        break

                self.movel2(posx([0.00, 00.00, 100.00, 0.00, 0.00, 0.00]), vel=VELOCITY, acc=ACC, ref=0, mod=DR_MV_MOD_REL)
                grasp(); self.movel2(posx([0.00, 00.00, -70.00, 0.00, 0.00, 0.00]), vel=VELOCITY, acc=ACC, ref=0, mod=DR_MV_MOD_REL)
                mwait(); set_ref_coord(1); task_compliance_ctrl()
                set_stiffnessx([300.00, 300.00, 100.00, 200.00, 200.00, 50.00],time=0.0)
                set_desired_force([0.00, 0.00, 22.00, 0.00, 0.00, 0.00],[0,0,1,0,0,0],time=0.0,mod=DR_FC_MOD_ABS)
                
                attempts = 0
                while rclpy.ok():
                    self.check_pause(1)
                    force = get_tool_force()
                    if 22.0 <= force[2] <= 300.0:
                        release_force(time=0.0); release_compliance_ctrl()
                        mwait()
                        release()
                        mwait()
                        break
                    else:
                        move_periodic([1.0, 1.0, 0, 0, 0, 2.0], 0.8, 0.0, 1)
                    wait(0.05); attempts += 1
                    if attempts > 5:
                        release_force(time=0.0); release_compliance_ctrl()
                        mwait()
                        release()
                        break

                self.movel2(posx([0.00, 00.00, 100.00, 0.00, 0.00, 0.00]), vel=VELOCITY, acc=ACC, ref=0, mod=DR_MV_MOD_REL)
                set_ref_coord(0) 
                mwait()

        # 메인 큐 대기 루프 (Main Thread)
        while rclpy.ok():
            try:
                block_help,block_id,block_type,block_level, u, v = task_queue.get(block=True, timeout=1.0)
                self.initialize_robot() 
            except Empty:
                continue
            try:
                self.get_logger().info(f"작업 시작: Human({block_help}) ID ({block_id}) Type({block_type}) level({block_level}) Grid({u}, {v})")
                retry_count = 0 ; max_retries = 3 ; self.is_picked = False

                while not self.is_picked and rclpy.ok():
                    #비전 통신과 함께 동작
                    brick_pick(block_type)
                    if not self.is_picked:
                        retry_count += 1
                        if retry_count >= max_retries:
                            global is_paused
                            is_paused = True 
                            self.check_pause() 
                            retry_count = 0

                brick_place(block_help,block_type,block_level,u, v)

                self.get_logger().info(f"작업 완료: Human({block_help}) ID ({block_id}) Type({block_type}) level({block_level}) Grid({u}, {v})")
                
                check_x_push_and_execute(block_id)
                
            except Exception as e:
                self.get_logger().error(f"로봇 에러 발생: {e}")
            finally:
                task_queue.task_done()

def main(args=None):
    rclpy.init(args=args)
    listener_node = TopicListenerNode()
    worker_node = RobotWorkerNode()

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