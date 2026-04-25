import json
import rclpy
from rclpy.node import Node
from std_msgs.msg import String, Float64MultiArray
from std_srvs.srv import Trigger

from pick2build.shared_state import RobotSharedState


class TopicListenerNode(Node):
    def __init__(self, state: RobotSharedState):
        super().__init__('topic_listener')
        self.state = state
        self.subscription = self.create_subscription(String, '/block/info', self.listener_callback, 10)
        self.pose_sub = self.create_subscription(Float64MultiArray, '/dsr01/target_lego_pose', self.pose_callback, 10)
        self.create_service(Trigger, '/signal_stop', self.stop_service)
        self.create_service(Trigger, '/signal_start', self.start_service)
        self.create_service(Trigger, '/signal_unlock', self.unlock_service)
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
                self.state.task_queue.put_nowait((block_help, block_id, block_type, block_level, u, v))
                self.get_logger().info(f"큐에 추가됨 - Human : {block_help} | Id : {block_id} | Type: {block_type} | Level: {block_level}| Grid: ({u}, {v})")
        except Exception as e:
            self.get_logger().error(f"JSON 파싱 에러: {e}")

    def pose_callback(self, msg):
        try:
            if len(msg.data) >= 7:
                target_pose = list(msg.data[:7])
                self.state.pose_queue.put_nowait(target_pose)
                self.get_logger().info(f"비전 목표 좌표 수신 완료: {target_pose}")
        except Exception as e:
            self.get_logger().error(f"좌표 수신 에러: {e}")

    def stop_service(self, request, response):
        self.get_logger().warn("[Pause] 일시 정지 요청 수신")
        self.state.is_paused = True
        response.success = True
        response.message = "paused"
        return response

    def start_service(self, request, response):
        self.get_logger().info("[Resume] 작업 재개 요청 수신")
        self.state.is_paused = False
        response.success = True
        response.message = "resumed"
        return response

    def unlock_service(self, request, response):
        self.get_logger().info("[Unlock] 해제 요청 수신")
        self.state.needs_unlock = True
        response.success = True
        response.message = "unlocked"
        return response
