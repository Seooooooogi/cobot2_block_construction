# Package Structure — JIUM

**Last updated**: 2026-04-22

---

## ZIUM_Control / pick2build (Control PC, ROS Humble)

### Node Map

| Node | File | Entry Point | Role |
|------|------|-------------|------|
| `topic_listener_node` | `stage_place.py` | `stage_place` | Subscribes UI signals + detection pose, manages task queue |
| `robot_worker_node` | `stage_place.py` | `stage_place` | Executes pick/place/push motion on M0609 |
| `object_detection_node` | `detection.py` | `detection` | Serves `/get_3d_position` — YOLO + MediaPipe hand detection |
| `get_keyword_node` | `get_keyword.py` | `get_keyword` | Serves `/get_keyword` — Whisper STT + GPT-4o keyword extraction |

### File Roles

| File | Role | Used by |
|------|------|---------|
| `stage_place.py` | Main orchestrator — TopicListenerNode + RobotWorkerNode | launch file |
| `detection.py` | Object/hand detection service node | launch file |
| `get_keyword.py` | Voice command extraction service node | launch file |
| `realsense.py` | Camera topic subscriber helper (`ImgNode`) | `detection.py` |
| `yolo.py` | YOLO model wrapper (`YoloModel`) | `detection.py` |
| `stt.py` | OpenAI Whisper STT helper (`STT`) | `get_keyword.py` |
| `MicController.py` | PyAudio microphone stream manager | `get_keyword.py` |
| `onrobot.py` | RG2 gripper Modbus TCP controller | `stage_place.py` |

### Launch File

`launch/run_system.launch.py` — launches `stage_place`, `get_keyword`, `detection` nodes.

### package.xml Dependencies

| Package | Type | Used in |
|---------|------|---------|
| `rclpy` | ROS2 | all nodes |
| `std_msgs` | ROS2 | `stage_place.py`, `detection.py`, `get_keyword.py` |
| `std_srvs` | ROS2 | `stage_place.py`, `get_keyword.py` |
| `sensor_msgs` | ROS2 | `realsense.py` |
| `cv_bridge` | ROS2 | `realsense.py`, `detection.py` |
| `ament_index_python` | ROS2 | `stage_place.py`, `detection.py`, `get_keyword.py`, `yolo.py` |
| `od_msg` | custom | `detection.py` — `SrvDepthPosition` |
| `dsr_msgs2` | custom | `stage_place.py` — `SetRobotControl` |
| `launch`, `launch_ros` | ROS2 | launch file |
| `python3-numpy` | pip (rosdep) | `stage_place.py`, `detection.py` |
| `python3-opencv` | pip (rosdep) | `stage_place.py`, `detection.py`, `realsense.py` |
| `python3-scipy` | pip (rosdep) | `stage_place.py` — ZYZ euler extraction |

### Pip Dependencies (not in rosdep — see ZIUM_Control/requirements.txt)

| Package | Used in |
|---------|---------|
| `mediapipe` | `detection.py` — hand landmark detection |
| `ultralytics` | `yolo.py` — YOLO v8 inference |
| `sounddevice` | `stt.py` — audio recording |
| `pyaudio` | `MicController.py`, `get_keyword.py` — microphone stream |
| `openai` | `stt.py` — Whisper API |
| `langchain-openai` | `get_keyword.py` — ChatOpenAI |
| `langchain` | `get_keyword.py` — PromptTemplate |
| `python-dotenv` | `get_keyword.py` — .env loading |

---

## ZIUM_Detection / cobot2 (Detection PC, ROS Foxy Docker)

### Node Map

| Node | File | Entry Point | Role |
|------|------|-------------|------|
| `foundation_pose_node` (namespace: `dsr01`) | `FoundationPose.py` | `foundation_pose` | 6-DoF brick pose estimation — YOLO + FoundationPose tracking |

### File Roles

| File | Role |
|------|------|
| `cobot2/FoundationPose.py` | Main pose estimation node |
| `FoundationPose-main/estimater.py` | FoundationPose estimator library (external, not a ROS node) |
| `FoundationPose-main/weights/best.pt` | YOLO model weights for brick detection |
| `FoundationPose-main/weights/T_gripper2camera.npy` | Gripper-to-camera extrinsic calibration matrix |
| `FoundationPose-main/demo_data/lego/mesh/` | 3D mesh files for FoundationPose (0.obj, 1.obj, 2.obj) |
| `FoundationPose-main/demo_data/lego/cam_K.txt` | Camera intrinsics (fallback — runtime uses CameraInfo topic) |

### package.xml Dependencies

| Package | Used in |
|---------|---------|
| `rclpy` | `FoundationPose.py` |
| `std_msgs` | `FoundationPose.py` — `Int32`, `Float64MultiArray` |
| `sensor_msgs` | `FoundationPose.py` — `Image`, `CameraInfo` |
| `cv_bridge` | `FoundationPose.py` |
| `tf2_msgs` | `FoundationPose.py` — `TFMessage` for T_base2gripper |

### Pip Dependencies (Docker environment — conda env `my`)

| Package | Used in |
|---------|---------|
| `torch` + CUDA | `FoundationPose.py` — GPU inference |
| `ultralytics` | `FoundationPose.py` — YOLO brick detection |
| `trimesh` | `FoundationPose.py` — 3D mesh loading |
| `scipy` | `FoundationPose.py` — euler angle extraction |
| `numpy`, `opencv-python` | `FoundationPose.py` |
| `nvdiffrast` | `estimater.py` — CUDA rasterization |

---

## Runtime Environment Summary

| Component | PC | OS | ROS | GPU |
|-----------|-----|-----|-----|-----|
| pick2build | Control | Ubuntu 22.04 | Humble | optional (YOLO inference) |
| cobot2 | Detection | Ubuntu 20.04 (Docker) | Foxy | required (FoundationPose CUDA) |
| ZIUM_UI | Control | any | — | — |
| M0609 driver | Control | Ubuntu 22.04 | Humble | — |
