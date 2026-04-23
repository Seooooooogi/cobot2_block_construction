from queue import Queue


class RobotSharedState:
    def __init__(self):
        self.is_paused: bool = False
        self.needs_unlock: bool = False
        self.task_queue: Queue = Queue()
        self.pose_queue: Queue = Queue()
