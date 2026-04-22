# ROS2 Interface Specification — pick2build ↔ cobot2

**Last updated**: 2026-04-22  
**Purpose**: 1-PC 통합 준비용 인터페이스 계약 명세. 이 문서에 정의된 토픽명·메시지 타입은 변경 금지.

---

## Package Overview

| Package | PC | ROS | Runtime |
|---------|-----|-----|---------|
| `pick2build` | Control PC | ROS Humble | Host Ubuntu 22.04 |
| `cobot2` | Detection PC | ROS Foxy | Docker (Ubuntu 20.04) |

---

## Cross-Package Topics (DDS Network)

### `/dsr01/detection_start`
- **Direction**: pick2build → cobot2
- **Type**: `std_msgs/msg/Int32`
- **Publisher**: `RobotWorkerNode` (`stage_place.py`)
- **Subscriber**: `FoundationPoseManager` (`FoundationPose.py`)
- **Data**: target block mesh ID (0=`0.obj`, 1=`1.obj`, 2=`2.obj`)
- **Trigger**: published immediately before `brick_pick()` begins pose acquisition
- **Behavior**: receipt resets all tracking state and restarts YOLO detection for the new target

### `/dsr01/target_lego_pose`
- **Direction**: cobot2 → pick2build
- **Type**: `std_msgs/msg/Float64MultiArray`
- **Publisher**: `FoundationPoseManager` (`FoundationPose.py`)
- **Subscriber**: `TopicListenerNode` (`stage_place.py`)
- **Data**: `[x, y, z, roll, pitch, yaw, pose_code]` — 7 float64 values
  - `x, y, z`: robot base frame coordinates (mm)
  - `roll, pitch, yaw`: orientation (degrees)
  - `pose_code`: `0.0`=UPRIGHT (no realignment), `1.0`=INVERTED, `2.0`=SIDE, `3.0`=FRONT
- **Publish timing**: single publish after `STABLE_THRESHOLD=20` frames of stable tracking
- **Hard rule**: pick2build must not begin `brick_pick()` motion until this topic is received

---

## pick2build Internal Services

### `/get_3d_position`
- **Type**: `od_msg/srv/SrvDepthPosition`
- **Provider**: `ObjectDetectionNode` (`detection.py`)
- **Consumer**: `RobotWorkerNode` (`stage_place.py`) via `_get_vision_target()`
- **Request**: `target` (string) — object label or `'hand'`
- **Response**: `depth_position` — [x, y, z] in camera frame (mm)
- **Purpose**: Stage 3 user-push scenario — detect hand/tool position on Control PC camera

### `/get_keyword`
- **Type**: `std_srvs/srv/Trigger`
- **Provider**: `GetKeyword` node (`get_keyword.py`)
- **Consumer**: `RobotWorkerNode` (`stage_place.py`)
- **Request**: (empty)
- **Response**: `success` (bool), `message` (string) — extracted keyword in `"tool / destination"` format
- **Purpose**: voice command extraction for Stage 3 tool delivery

---

## pick2build ← ZIUM_UI (rosbridge WebSocket)

| Topic | Type | Direction | Description |
|-------|------|-----------|-------------|
| `/block/info` | `std_msgs/String` (JSON) | UI → pick2build | block placement design data |
| `/signal_id` | `std_msgs/Int32` | UI → pick2build | task start signal |
| `/signal_stop` | `std_msgs/Int32` | UI → pick2build | pause |
| `/signal_start` | `std_msgs/Int32` | UI → pick2build | resume |
| `/signal_unlock` | `std_msgs/Int32` | UI → pick2build | force resume from e-stop |

---

## pick2build Internal Topics (cobot2 camera relay)

The camera topics below originate from the Detection PC and are forwarded to Control PC via DDS. `pick2build/realsense.py` subscribes to these for the Control PC camera pipeline.

| Topic | Type | Source |
|-------|------|--------|
| `/dsr01/camera/color/image_raw` | `sensor_msgs/Image` | Detection PC RealSense |
| `/dsr01/camera/aligned_depth_to_color/image_raw` | `sensor_msgs/Image` | Detection PC RealSense |
| `/dsr01/camera/color/camera_info` | `sensor_msgs/CameraInfo` | Detection PC RealSense |

---

## TF Topics (cobot2 uses for coordinate transform)

| Topic | Type | Direction |
|-------|------|-----------|
| `/tf` | `tf2_msgs/TFMessage` | Robot driver → cobot2 |

`FoundationPoseManager` subscribes `/tf` to compute `T_base2gripper` transform chain:  
`base_link → link_1 → link_2 → link_3 → link_4 → link_5 → link_6`

---

## 1-PC Consolidation Notes

**Option A** (keep packages, single PC):
- Both packages run on same host
- DDS communication remains via localhost — no config change needed if `ROS_DOMAIN_ID` matches
- Docker container for cobot2 still required (ROS Foxy + CUDA environment for FoundationPose)
- Risk: GPU resource contention between cobot2 (CUDA) and pick2build inference

**Option B** (single ROS Humble workspace):
- Migrate cobot2 to ROS Humble — requires verifying all dependencies (FoundationPose, pyrealsense2) are Humble-compatible
- Eliminates Docker boundary, simplifies deployment
- Breaking change: namespace and node names must be preserved for topic contract
