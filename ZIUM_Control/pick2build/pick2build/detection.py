# Role: Object/hand detection node on Control PC — serves /get_3d_position service via YOLO + MediaPipe
import numpy as np
import rclpy
from rclpy.node import Node
import os
import cv2
import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision

from od_msg.srv import SrvDepthPosition
from pick2build.realsense import ImgNode
from ament_index_python.packages import get_package_share_directory

class ObjectDetectionNode(Node):
    def __init__(self, model_name='yolo'):
        super().__init__('object_detection_node')
        
        self.img_node = ImgNode()
        self.yolo_model = None  # lazy: created on first non-'hand' request (avoids ultralytics import at boot)
        self.hand_detector = self._init_hand_detector()

        # --- [추가] 손 위치 저장을 위한 캐시 변수 ---
        self.cached_hand_pos = [0.0, 0.0, 0.0]

        self.intrinsics = self._wait_for_valid_data(
            self.img_node.get_camera_intrinsic, "camera intrinsics"
        )
        
        # self.timer = self.create_timer(0.5, self.simple_vis_callback)

        self.create_service(SrvDepthPosition, 'get_3d_position', self.handle_get_depth)
        self.get_logger().info("Service Ready. Waiting for request...")

    # def simple_vis_callback(self):
    #     """단순히 영상 스트리밍만 확인하는 용도 (추론 X)"""
    #     rclpy.spin_once(self.img_node, timeout_sec=0)
    #     frame = self.img_node.get_color_frame()
    #     if frame is not None:
    #         cv2.imshow("Live Stream", frame)
    #         cv2.waitKey(1)

    def _init_hand_detector(self):
        package_path = get_package_share_directory('pick2build')
        model_path = os.path.join(package_path, 'resource', 'hand_landmarker.task')
        base_options = python.BaseOptions(model_asset_path=model_path, delegate=python.BaseOptions.Delegate.GPU)
        options = vision.HandLandmarkerOptions(
            base_options=base_options,
            running_mode=vision.RunningMode.IMAGE,
            num_hands=1
        )
        return vision.HandLandmarker.create_from_options(options)
    
    def _get_hand_landmark_pixel(self, color_frame):
        """MediaPipe Hand Landmarker 전전용 함수"""
        if self.hand_detector is None:
            return None, None

        # MediaPipe용 이미지 변환 (BGR -> RGB)
        frame_rgb = cv2.cvtColor(color_frame, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=frame_rgb)

        # 손 관절 검출 수행
        detection_result = self.hand_detector.detect(mp_image)

        if not detection_result.hand_landmarks:
            return None, None

        # [0][0] 의미: 첫 번째 손(0)의 0번 관절(Wrist, 손목)
        wrist_landmark = detection_result.hand_landmarks[0][9]
        
        # 정규화된 좌표(0~1)를 실제 픽셀 좌표로 변환
        h, w, _ = color_frame.shape
        cx = int(wrist_landmark.x * w)
        cy = int(wrist_landmark.y * h)
        
        return cx, cy

    def handle_get_depth(self, request, response):
        target = request.target.lower()
        self.get_logger().info(f"비전 요청: [{target}]")

        # 1. 프레임 동기화를 위해 버퍼 비우기 (중요)
        for _ in range(10):
            rclpy.spin_once(self.img_node, timeout_sec=0.01)
            
        color_frame = self.img_node.get_color_frame()
        depth_frame = self.img_node.get_depth_frame()

        if color_frame is None or depth_frame is None:
            response.depth_position = [0.0, 0.0, 0.0]
            return response
        
        cx, cy = None, None
        if target == 'hand':
            cx, cy = self._get_hand_landmark_pixel(color_frame)
        else:
            cx, cy = self._get_yolo_target_pixel(target)

        if cx is not None and cy is not None:
            h, w = depth_frame.shape
            cx, cy = np.clip(cx, 0, w - 1), np.clip(cy, 0, h - 1)
            
            # 2. Depth 0 해결: 주변 5x5 영역의 평균값(또는 중앙값) 사용
            roi = depth_frame[max(0, cy-2):min(h, cy+3), max(0, cx-2):min(w, cx+3)]
            valid_depths = roi[roi > 0] # 0이 아닌 값들만 추출
            
            if len(valid_depths) > 0:
                cz = np.median(valid_depths) # 중앙값 사용으로 튀는 값 방지
                coords = self._pixel_to_camera_coords(cx, cy, cz)
                response.depth_position = [float(x) for x in coords]
                self.get_logger().info(f"{target} 깊이 측정 성공: {cz}mm")
            else:
                self.get_logger().warn(f"{target} 영역의 모든 Depth가 0입니다. 카메라 거리를 띄우세요.")
                response.depth_position = [0.0, 0.0, 0.0]
        else:
            response.depth_position = [0.0, 0.0, 0.0]

        return response
    
    # --- 헬퍼 함수들 ---

    def _get_yolo_target_pixel(self, target):
        """YOLO: 객체 Bounding Box의 중심 픽셀 좌표 반환"""
        if self.yolo_model is None:
            from pick2build.yolo import YoloModel
            self.yolo_model = YoloModel()
        box, score = self.yolo_model.get_best_detection(self.img_node, target)
        if box is not None:
            # box: [x1, y1, x2, y2]
            cx = int((box[0] + box[2]) / 2)
            cy = int((box[1] + box[3]) / 2)
            return cx, cy
        return None, None


    def _pixel_to_camera_coords(self, x, y, z):
        fx, fy = self.intrinsics['fx'], self.intrinsics['fy']
        ppx, ppy = self.intrinsics['ppx'], self.intrinsics['ppy']
        return ((x - ppx) * z / fx, (y - ppy) * z / fy, z)

    def _wait_for_valid_data(self, getter, description):
        data = getter()
        while data is None or (isinstance(data, np.ndarray) and not data.any()):
            rclpy.spin_once(self.img_node)
            data = getter()
        return data

def main(args=None):
    rclpy.init(args=args)
    node = ObjectDetectionNode()
    try:
        rclpy.spin(node)
    finally:
        cv2.destroyAllWindows()
        node.destroy_node()
        rclpy.shutdown()

if __name__ == '__main__':
    main()