# Role: 6-DoF brick pose estimation node on Detection PC — YOLO detection + FoundationPose tracking, publishes /dsr01/target_lego_pose
import os
import sys

# FoundationPose 프로젝트 경로 설정
# estimater 모듈과 weights/demo_data 자산은 모두 FoundationPose-main/ 아래에 있음.
# 정적 install(--symlink-install 미사용)에서는 __file__이 install 트리를 가리키므로
# 상대경로(__file__/../FoundationPose-main)는 닿지 않음. 컨테이너 src 절대경로 우선 사용,
# 호스트 dev 실행을 위해 상대경로 fallback 유지.
_module_dir = os.path.dirname(os.path.abspath(__file__))
project_path = '/ros2_ws/src/zium_detection/FoundationPose-main'
if not os.path.isdir(project_path):
    project_path = os.path.abspath(os.path.join(_module_dir, '..', 'FoundationPose-main'))
if project_path not in sys.path:
    sys.path.append(project_path)

import argparse
import cv2
import numpy as np
import trimesh
import torch
from ultralytics import YOLO

from estimater import *

import rclpy
from rclpy.node import Node
from std_msgs.msg import Float64MultiArray, Int32
from sensor_msgs.msg import Image, CameraInfo
from cv_bridge import CvBridge
from tf2_msgs.msg import TFMessage

from zium_detection.pose_geometry import (
    build_tf_matrix,
    classify_lego_pose,
    compute_gripping_point,
)


class FoundationPoseManager(Node):
    def __init__(self, args):
        super().__init__('foundation_pose_node', namespace='dsr01')
        self.args = args
        self.yolo_model = YOLO(args.yolo_model)
        self.bridge = CvBridge()
        
        # --- [수정] 토픽 구독 설정 (Port 대신 Topic 사용) ---
        self.color_sub = self.create_subscription(Image, 'camera/color/image_raw', self.color_callback, 10)
        self.depth_sub = self.create_subscription(Image, 'camera/aligned_depth_to_color/image_raw', self.depth_callback, 10)
        self.info_sub = self.create_subscription(CameraInfo, 'camera/color/camera_info', self.info_callback, 10)
        
        # 데이터 저장용 변수
        self.latest_color_msg = None
        self.latest_depth_msg = None
        self.K = None  # CameraInfo에서 받을 예정
        
        self.target_id_sub = self.create_subscription(Int32, '/dsr01/detection_start', self.target_id_callback, 10)
        self.target_block_id = None
        
        self.T_gripper2cam = np.load(os.path.join(project_path, 'weights/T_gripper2camera.npy'))
        
        self.tf_sub = self.create_subscription(TFMessage, '/tf', self.tf_callback, 10)
        self.tf_buffer = {}
        self.current_T_base2gripper = None 
        
        self.target_pub = self.create_publisher(Float64MultiArray, '/dsr01/target_lego_pose', 10)
        
        self.mesh_dir = os.path.join(project_path, 'demo_data/lego/mesh')
        self.mesh_files = ["0.obj", "1.obj", "2.obj"]

        self.scorer = ScorePredictor()
        self.refiner = PoseRefinePredictor()
        self.glctx = dr.RasterizeCudaContext()
        self.estimators = {}
        self.bboxes = {}
        self.to_origins = {}

        self._load_meshes()
        
        self.tracking_started = False
        self.active_model = None
        self.last_pose = None
        self.pose_buffer = []      
        self.published = False
        self.STABLE_THRESHOLD = 20 

    # --- [추가] ROS 2 콜백 함수들 ---
    def color_callback(self, msg):
        self.latest_color_msg = msg

    def depth_callback(self, msg):
        self.latest_depth_msg = msg

    def info_callback(self, msg):
        if self.K is None:
            # CameraInfo에서 K 매트릭스 추출 (3x3)
            self.K = np.array(msg.k).reshape(3, 3)
            self.get_logger().info("Camera Intrinsics (K) initialized from topic.")
        
    def target_id_callback(self, msg):
        #new_id = msg.data
        #if self.target_block_id != new_id:
        #    self.get_logger().info(f'Target Block ID changed to: {new_id}')
        #    self.target_block_id = new_id
        #    self.tracking_started = False
        #    self.published = False
        #    self.pose_buffer = []
        #    self.active_model = None
        #    self.last_pose = None
        # [수정] 동일한 ID가 들어와도 무조건 초기화하여 새로 추적을 시작합니다.
        self.target_block_id = msg.data
        self.get_logger().info(f'Target Block ID {self.target_block_id} received. Initializing/Resetting tracking...')
        
        self.tracking_started = False
        self.published = False
        self.pose_buffer = []
        self.active_model = None
        self.last_pose = None
        
    def tf_callback(self, msg):
        for transform in msg.transforms:
            parent = transform.header.frame_id
            child = transform.child_frame_id
            key = f"{parent}_to_{child}"
            self.tf_buffer[key] = build_tf_matrix(transform)

        req_keys = ['base_link_to_link_1', 'link_1_to_link_2', 'link_2_to_link_3',
                    'link_3_to_link_4', 'link_4_to_link_5', 'link_5_to_link_6']

        if all(k in self.tf_buffer for k in req_keys):
            T = np.eye(4)
            for k in req_keys:
                T = T @ self.tf_buffer[k]
            self.current_T_base2gripper = T

    def _load_meshes(self):
        for f in self.mesh_files:
            path = os.path.join(self.mesh_dir, f)
            if not os.path.exists(path): continue
            m = trimesh.load(path)
            
            # [수정] 사용자가 블렌더에서 설정한 축과 원점을 강제로 유지합니다.
            # 기존의 t_origin, ext = trimesh.bounds.oriented_bounds(m) 부분을 대체합니다.
            
            # 1. 원점 변환 없이 그대로 사용 (단위 행렬)
            self.to_origins[f] = np.eye(4) 
            
            # 2. 박스 범위를 재계산된 축이 아닌, 원래 파일의 축(AABB) 기준으로 설정
            min_bound, max_bound = m.bounds
            self.bboxes[f] = np.stack([min_bound, max_bound], axis=0).reshape(2,3)
            
            self.estimators[f] = FoundationPose(
                model_pts=m.vertices, 
                model_normals=m.vertex_normals, 
                mesh=m, 
                scorer=self.scorer, 
                refiner=self.refiner, 
                glctx=self.glctx,
                symmetry_tfs=None
            )


    def show_yolo_detection_window(self, color_img, all_dets, best_det):
        """
        YOLO 탐색 단계 전용 시각화 창 (선정된 타겟은 빨간색, 나머지는 초록색)
        """
        yolo_vis = color_img.copy()
        
        for det in all_dets:
            box = det.xyxy[0].cpu().numpy().astype(int)
            conf = det.conf[0].item()
            cls = int(det.cls[0].item())
            
            # 기본 색상: 초록색 (BGR)
            color = (0, 255, 0)
            label = f"ID:{cls} {conf:.2f}"
            
            # 만약 현재 검출된 박스가 'best_det'와 일치하면 빨간색으로 변경
            if best_det is not None and torch.equal(det.xyxy[0], best_det.xyxy[0]):
                color = (0, 0, 255) # 빨간색
                label = f"TARGET LOCKED: {label}"
                # 빨간색 박스는 더 두껍게 강조
                cv2.rectangle(yolo_vis, (box[0], box[1]), (box[2], box[3]), color, 3)
            else:
                cv2.rectangle(yolo_vis, (box[0], box[1]), (box[2], box[3]), color, 2)
                
            cv2.putText(yolo_vis, label, (box[0], box[1] - 10), 
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2)

        # 창 이름 설정 및 출력
        win_name = "YOLO Detection Stage (Static Snapshot)"
        cv2.imshow(win_name, yolo_vis)
        cv2.waitKey(1)
        # yolo 연산이 끝나면 이 시점의 이미지가 창에 고정(멈춤)됩니다.
        
    def run(self):
        cv2.namedWindow("RG2 Tracking (Multi-Pose Mode)")
        try:
            while rclpy.ok():
                # [중요] ROS 2 토픽 수신을 위해 spin_once 실행
                rclpy.spin_once(self, timeout_sec=0.001)
                
                # --- [수정] 토픽 데이터 유효성 검사 ---
                if self.latest_color_msg is None or self.latest_depth_msg is None or self.K is None:
                    continue
                
                # 메시지를 OpenCV 이미지로 변환 및 단위 조정 (mm -> m)
                color_img = self.bridge.imgmsg_to_cv2(self.latest_color_msg, desired_encoding='bgr8')
                depth_raw_img = self.bridge.imgmsg_to_cv2(self.latest_depth_msg, desired_encoding='16UC1')
                depth_img = depth_raw_img.astype(float) / 1000.0 
                
                # 시각화용 복사본 생성
                vis = color_img.copy()

                # 1. 초기 추적 등록 로직 (YOLO 기반 객체 탐지 후 FoundationPose 등록)
                if self.target_block_id is not None and not self.tracking_started:
                    results = self.yolo_model.predict(color_img, conf=0.4, verbose=False, device='cuda:0')[0]
                    valid_dets = [det for det in results.boxes if int(det.cls[0].item()) == self.target_block_id]
                    
                    self.show_yolo_detection_window(color_img, valid_dets, None)
                    
                    if valid_dets:
                        best_det = max(valid_dets, key=lambda x: x.conf[0].item())
                        self.show_yolo_detection_window(color_img, valid_dets, best_det)
                        box = best_det.xyxy[0].cpu().numpy().astype(int)
                        target_mesh_name = f"{self.target_block_id}.obj"

                        if target_mesh_name in self.estimators:
                            x1, y1, x2, y2 = box
                            roi_depth = depth_img[y1:y2, x1:x2]
                            valid_roi = roi_depth[(roi_depth > 0.1) & (roi_depth < 0.8)]
                            if len(valid_roi) > 0:
                                # 바닥면 제외 및 마스크 생성 로직
                                floor_val = np.percentile(valid_roi, 95)
                                roi_mask = (roi_depth < (floor_val - 0.002)) & (roi_depth > 0.1)
                                full_mask = np.zeros_like(depth_img, dtype=bool)
                                full_mask[y1:y2, x1:x2] = roi_mask
                                
                                if np.sum(full_mask) > 15:
                                    torch.cuda.empty_cache()
                                    try:
                                        p = self.estimators[target_mesh_name].register(
                                            K=self.K, rgb=color_img, depth=depth_img, 
                                            ob_mask=full_mask, iteration=self.args.est_refine_iter
                                        )
                                        if p is not None:
                                            self.active_model = target_mesh_name
                                            self.tracking_started = True
                                    except Exception as e:
                                        print(f"Registration Error: {e}", flush=True)
                                        torch.cuda.empty_cache()

                # 2. 실시간 추적 및 데이터 발행 로직
                if self.tracking_started:
                    try:
                        # 아직 목표 데이터를 발행하지 않은 경우에만 추적 및 데이터 수집
                        if not self.published:
                            pose = self.estimators[self.active_model].track_one(
                                rgb=color_img, depth=depth_img, K=self.K,
                                iteration=self.args.track_refine_iter
                            )
                            if pose is not None:
                                self.last_pose = pose
                                # 객체의 원점 보정 적용
                                cp_pose = self.last_pose @ np.linalg.inv(self.to_origins[self.active_model])
                                
                                # 베이스 좌표계 기준 좌표 및 각도 계산
                                # current_T_base2gripper 가 아직 채워지지 않았으면 다음 프레임에 재시도.
                                if self.current_T_base2gripper is None:
                                    continue

                                coords, angles, rot_mat = compute_gripping_point(
                                    cp_pose, self.T_gripper2cam, self.current_T_base2gripper
                                )
                                if coords is not None and angles[0] is not None:
                                    # 레고의 포즈 상태(코드) 판별
                                    pose_name, pose_code = classify_lego_pose(rot_mat)
                                    # XYZ(3) + RPY(3) + PoseCode(1) = 총 7개 데이터 저장
                                    self.pose_buffer.append([
                                        coords[0], coords[1], coords[2],
                                        angles[0], angles[1], angles[2], pose_code
                                    ])

                        # 시각화: 추적 중인 객체의 3D 박스와 축 그리기
                        if self.last_pose is not None:
                            cp = self.last_pose @ np.linalg.inv(self.to_origins[self.active_model])
                            vis = draw_posed_3d_box(self.K, img=color_img.copy(), ob_in_cam=cp, bbox=self.bboxes[self.active_model])
                            vis = draw_xyz_axis(vis, ob_in_cam=cp, scale=0.03, K=self.K, thickness=2, is_input_rgb=False)

                        # 데이터 안정화(30프레임) 후 최종 토픽 발행
                        if len(self.pose_buffer) >= self.STABLE_THRESHOLD and not self.published:
                            data_array = np.array(self.pose_buffer)
                            final_values = []
                            for i in range(7):
                                col = data_array[:, i]
                                # 최빈값(Mode) 기반의 필터링 후 평균 계산하여 노이즈 제거
                                vals, counts = np.unique(np.round(col, 1), return_counts=True)
                                mode_val = vals[np.argmax(counts)]
                                final_values.append(np.mean(col[np.abs(col - mode_val) < 0.2]))
                            
                            # ROS 2 토픽 발행
                            result_msg = Float64MultiArray()
                            result_msg.data = [float(v) for v in final_values]
                            self.target_pub.publish(result_msg)
                            self.published = True
                            print(f"\n[DONE] ID {self.target_block_id} | Pose Code: {final_values[6]} Published")
                            # 0.0이면 불필요, 그 외(1.0 등)면 필요
                            alignment_status = "재정렬 불필요" if final_values[6] == 0.0 else "재정렬 필요"

                            # 로그 출력
                            print(f"\n[DONE] ID {self.target_block_id} | Pose Code: {final_values[6]} | 상태: {alignment_status} Published")

                    except Exception as e:
                        print(f"Tracking error: {e}")
                        self.tracking_started = False

                # 화면 상단 상태 표시 메시지
                if self.target_block_id is None:
                    cv2.putText(vis, "Waiting for Target ID...", (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
                elif not self.tracking_started:
                    cv2.putText(vis, f"Searching ID: {self.target_block_id}", (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 255), 2)

                # 결과 윈도우 표시 및 키 입력 처리
                cv2.imshow("RG2 Tracking (Multi-Pose Mode)", vis)
                key = cv2.waitKey(1) & 0xFF
                if key == ord('q'): 
                    break
                elif key == ord('r'): # 리셋 키: 현재 추적 정보를 초기화하고 다시 시작
                    self.tracking_started = False
                    self.published = False
                    self.pose_buffer = []

        finally:
            cv2.destroyAllWindows()


def main(args=None):
    rclpy.init(args=args)
    parser = argparse.ArgumentParser()
    parser.add_argument('--est_refine_iter', type=int, default=20) 
    parser.add_argument('--track_refine_iter', type=int, default=20)
    parser.add_argument('--yolo_model', type=str, default=os.path.join(project_path, 'weights/best.pt'))
    # ROS2 launch가 추가하는 `--ros-args -r __node:=... -r __ns:=...`를 argparse가 거부하지
    # 않도록 parse_known_args 사용. ROS 인자는 rclpy.init이 이미 sys.argv에서 처리함.
    args, _ = parser.parse_known_args()

    manager = FoundationPoseManager(args)
    try:
        manager.run() 
    except KeyboardInterrupt:
        pass
    finally:
        manager.destroy_node() 
        rclpy.shutdown()

if __name__ == '__main__':
    main()
