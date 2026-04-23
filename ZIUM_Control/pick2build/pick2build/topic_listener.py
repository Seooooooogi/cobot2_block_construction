import json
import rclpy
from rclpy.node import Node
from std_msgs.msg import String, Float64MultiArray, Int32

from pick2build.shared_state import RobotSharedState


class TopicListenerNode(Node):
    def __init__(self, state: RobotSharedState):
        super().__init__('topic_listener')
        self.state = state
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

    def stop_callback(self, msg):
        self.get_logger().warn("[Pause] 일시 정지 수신")
        self.state.is_paused = True

    def start_callback(self, msg):
        self.get_logger().info("[Resume] 작업 재개 수신")
        self.state.is_paused = False

    def unlock_callback(self, msg):
        if msg.data == 1:
            self.get_logger().info("[Unlock] 해제 신호 확인")
            self.state.needs_unlock = True
