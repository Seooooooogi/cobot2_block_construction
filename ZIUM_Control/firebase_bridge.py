#!/usr/bin/env python3
"""
firebase_bridge.py — Firebase Realtime Database ↔ ROS2 토픽 브리지

역할:
  - RTDB jium/commands/block_info 감시 → /block/info 토픽 발행
  - RTDB jium/commands/signal_* 감시 → /signal_stop, /signal_start, /signal_unlock 발행
  - /signal_id 토픽 구독 → RTDB jium/status/completed_id 기록

실행:
  pip install firebase-admin
  export GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccountKey.json
  python3 firebase_bridge.py

환경변수:
  FIREBASE_DATABASE_URL  — RTDB URL (예: https://your-project-default-rtdb.firebaseio.com)
"""

import os
import json
import threading
import rclpy
from rclpy.node import Node
from std_msgs.msg import String, Int32
import firebase_admin
from firebase_admin import credentials, db as rtdb


class FirebaseBridgeNode(Node):
    def __init__(self):
        super().__init__('firebase_bridge')

        self._init_firebase()

        # ROS 발행자
        self.block_info_pub = self.create_publisher(String, '/block/info', 10)
        self.signal_stop_pub = self.create_publisher(Int32, '/signal_stop', 10)
        self.signal_start_pub = self.create_publisher(Int32, '/signal_start', 10)
        self.signal_unlock_pub = self.create_publisher(Int32, '/signal_unlock', 10)

        # ROS 구독자 — 로봇이 블록 배치 완료 시 ID를 Firebase로 역전송
        self.create_subscription(Int32, '/signal_id', self._on_signal_id, 10)

        # Firebase 리스너를 별도 스레드에서 실행
        threading.Thread(target=self._start_firebase_listeners, daemon=True).start()
        self.get_logger().info('Firebase Bridge 시작됨')

    def _init_firebase(self):
        cred_path = os.environ.get('GOOGLE_APPLICATION_CREDENTIALS', 'serviceAccountKey.json')
        db_url = os.environ.get('FIREBASE_DATABASE_URL', 'https://YOUR_PROJECT-default-rtdb.firebaseio.com')
        cred = credentials.Certificate(cred_path)
        firebase_admin.initialize_app(cred, {'databaseURL': db_url})

    def _start_firebase_listeners(self):
        """block_info와 각 signal 경로에 리스너 등록"""
        rtdb.reference('jium/commands/block_info').listen(self._on_block_info)
        rtdb.reference('jium/commands/signal_stop').listen(
            lambda e: self._on_signal(e, self.signal_stop_pub, '/signal_stop'))
        rtdb.reference('jium/commands/signal_start').listen(
            lambda e: self._on_signal(e, self.signal_start_pub, '/signal_start'))
        rtdb.reference('jium/commands/signal_unlock').listen(
            lambda e: self._on_signal(e, self.signal_unlock_pub, '/signal_unlock'))

    def _on_block_info(self, event):
        if not event.data:
            return
        payload = event.data.get('data') if isinstance(event.data, dict) else None
        if payload:
            msg = String()
            msg.data = payload
            self.block_info_pub.publish(msg)
            self.get_logger().info(f'[Firebase→ROS] /block/info 발행: {payload[:80]}...')

    def _on_signal(self, event, publisher, topic_name):
        if not event.data:
            return
        msg = Int32()
        msg.data = 1
        publisher.publish(msg)
        self.get_logger().info(f'[Firebase→ROS] {topic_name} 발행')

    def _on_signal_id(self, msg: Int32):
        """로봇이 배치 완료 → Firebase 상태 업데이트"""
        rtdb.reference('jium/status/completed_id').set(msg.data)
        self.get_logger().info(f'[ROS→Firebase] 배치 완료 ID: {msg.data}')


def main():
    rclpy.init()
    node = FirebaseBridgeNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
