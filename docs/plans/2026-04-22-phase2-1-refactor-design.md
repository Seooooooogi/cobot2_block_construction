# Phase 2-1 Refactoring Design — pick2build & cobot2

**Date**: 2026-04-22  
**Status**: APPROVED (Option B)  
**Scope**: BRIEF.md Phase 2-1 — import 정리, 중복 제거, package.xml 업데이트, 인터페이스 명세 문서화

---

## Current State Analysis

### pick2build (ZIUM_Control, ROS Humble)

| File | Role | Issues |
|------|------|--------|
| `stage_place.py` | Main orchestrator: pick/place/push, signal handling | `get_vision_target()` 3x duplicated; hardcoded IP/coords |
| `detection.py` | Control PC object/hand detection node (YOLO + MediaPipe) | `visualization_callback` dead code (timer never created); `_get_hand_wrist_pixel` / `_get_hand_landmark_pixel` near-duplicate |
| `get_keyword.py` | Voice command extraction node (Whisper STT + GPT-4o) | `super().__init__()` called at line 102 AFTER LLM/chain init — ROS2 anti-pattern |
| `realsense.py` | Camera topic subscriber helper (`ImgNode`) | detection.py-only helper, not a standalone node |
| `yolo.py` | YOLO model wrapper | detection.py-only helper |
| `stt.py` | OpenAI Whisper STT class | get_keyword.py-only helper |
| `MicController.py` | PyAudio microphone stream manager | get_keyword.py-only helper |

### package.xml dependency issues (pick2build)

| Status | Package | Reason |
|--------|---------|--------|
| Remove | `geometry_msgs` | Not used in any pick2build .py file |
| Add | `std_srvs` | `stage_place.py` + `get_keyword.py` both import `Trigger` |
| Add | `ament_index_python` | `stage_place.py`, `detection.py`, `get_keyword.py`, `yolo.py` all use `get_package_share_directory` |
| Document (pip only) | mediapipe, sounddevice, pyaudio, openai, langchain-openai, langchain, python-dotenv, ultralytics | Not in rosdep → document in requirements.txt |

### cobot2 (ZIUM_Detection, ROS Foxy Docker)

| File | Role | Issues |
|------|------|--------|
| `FoundationPose.py` | 6-DoF pose estimation node (FoundationPose + YOLO) | `import pyrealsense2 as rs` dead import (hardware pipeline deleted); conda path hardcoded in sys.path |
| `FoundationPose-main/estimater.py` | FoundationPose estimator library (external dep) | — |

**setup.py entry point bug:**
- Current: `Final_code_FoundationPose_yolo_detectionUI = cobot2.Final_code_FoundationPose_yolo_detectionUI:main` (module does not exist)
- Fix: `foundation_pose = cobot2.FoundationPose:main`

**package.xml**: All declared dependencies confirmed used — no changes needed.

---

## Approved Changes (Option B)

### pick2build

1. `package.xml` — Remove `geometry_msgs`; add `std_srvs`, `ament_index_python`
2. `get_keyword.py` — Move `super().__init__("get_keyword_node")` to first line of `__init__`
3. `detection.py` — Remove `visualization_callback` dead code; merge `_get_hand_wrist_pixel` / `_get_hand_landmark_pixel`
4. `stage_place.py` — Extract 3x duplicated `get_vision_target()` block into single `_get_vision_target()` method
5. Role comments at top of each file

### cobot2

6. `FoundationPose.py` — Remove `import pyrealsense2 as rs` (dead import)
7. `setup.py` — Fix broken entry point to `foundation_pose = cobot2.FoundationPose:main`
8. Role comment at top of `FoundationPose.py`

### Documentation (new files)

9. `docs/ros2_interface_spec.md` — Topic/service interface spec between pick2build ↔ cobot2
10. `docs/package_structure.md` — Package structure overview, file roles, pip dependency list
11. `requirements.txt` (ZIUM_Control) — pip packages not in rosdep

---

## File Merge Decision

**Not merging any files.** Reason:
- `stt.py` + `MicController.py`: different audio backends (sounddevice vs PyAudio), clear separation
- `realsense.py` + `yolo.py`: both are detection.py helpers but unrelated concerns
- Circular import risk noted in BRIEF.md — keep current file structure

---

## ROS2 Interface Spec

```
pick2build (Control PC, ROS Humble) ←→ cobot2 (Detection PC, ROS Foxy Docker)

[cobot2 → pick2build]
  Topic:   /dsr01/target_lego_pose
  Type:    std_msgs/Float64MultiArray
  Data:    [x, y, z, roll, pitch, yaw, pose_code]  (7 float64 values)
  Freq:    once per detection request (publish-and-done, STABLE_THRESHOLD=20 frames)

[pick2build → cobot2]
  Topic:   /dsr01/detection_start
  Type:    std_msgs/Int32
  Data:    target block ID (0=block0.obj, 1=block1.obj, 2=block2.obj)
  Trigger: RobotWorkerNode publishes before brick_pick()

[pick2build internal services]
  /get_keyword       std_srvs/srv/Trigger       GetKeyword node (get_keyword.py)
  /get_3d_position   od_msg/srv/SrvDepthPosition ObjectDetectionNode (detection.py)

[pick2build ← ZIUM_UI via rosbridge]
  /block/info    std_msgs/String (JSON)  block placement design
  /signal_id     std_msgs/Int32          task start signal
  /signal_stop   std_msgs/Int32          pause
  /signal_start  std_msgs/Int32          resume
  /signal_unlock std_msgs/Int32          force resume

[pick2build → ZIUM_UI via rosbridge]
  (rosbridge passthrough — no dedicated publisher from pick2build to UI)
```
