# JIUM (지음) v1.0
AI(CV) 기반 협동 로봇(Doosan M0609)이 RealSense로 블록을 인식하고 사용자 도면에 따라 자동 pick & place 하는 협동 건축 시스템

## Hard Rules (never bend)

Global rules → see [.claude/rules/ai-constitution.md](~/.claude/rules/ai-constitution.md)

Project-specific:
1. **no motion without pose**: Detection 컨테이너(`zium_detection`)로부터 블록 포즈(`/dsr01/target_lego_pose`)를 수신하기 전 pick 동작 명령 금지
2. **no move during e-stop**: `/signal_stop` 수신 후 emergency stop 상태에서 어떤 모션 명령도 전송 금지. `/signal_unlock` 수신 후에만 재개 가능
3. **no pose interpolation**: FoundationPose 결과 누락 시 보간/추측 금지 — 해당 에피소드 skip 처리

## Quick Ref

| 컴포넌트 | 명령 |
|----------|------|
| Control (pick2build) | `cd ZIUM_Control && colcon build && ros2 launch pick2build run_system.launch.py` |
| Detection (Docker) | `docker compose -f ZIUM_Detection/docker-compose.yml up -d` (호스트에서 실행) |
| UI (React) | `cd ZIUM_UI && npm install && npm run dev` |
| ROS2 테스트 | `colcon test && colcon test-result` |

## System Architecture

```
Admin UI (React)
    │ WebSocket (rosbridge)
    ▼
Single PC (Ubuntu 22.04 + ROS2 Humble)
┌─ Host: pick2build (Control)        Container: zium-detection:humble-cu118
│  ├── Queue (block task list)  ◄──── /dsr01/target_lego_pose
│  ├── brick_pick()             ────► /dsr01/detection_start
│  ├── brick_place()                  foundation_pose_node
│  └── check_x_push_and_execute()     (YOLO + FoundationPose)
│
└─ Host: realsense2_camera_node ────► /camera/color/image_raw, aligned_depth_to_color/...

pick2build ──► Doosan M0609 (TCP/IP) + RG2 그리퍼 (Modbus TCP)
```

## ROS Topics

| Topic | 방향 | 설명 |
|-------|------|------|
| `/block/info` | UI → Control | 블록 배치 설계 정보 |
| `/signal_id` | UI → Control | 작업 시작 신호 |
| `/signal_stop` | UI → Control | 일시정지 |
| `/signal_start` | UI → Control | 재개 |
| `/signal_unlock` | UI → Control | 강제재개 |
| `/dsr01/detection_start` | Control → Detection | 감지 시작 트리거 |
| `/dsr01/target_lego_pose` | Detection → Control | 블록 6-DoF 포즈 |

## Packages

- `ZIUM_Control/pick2build` — M0609 제어, pick/place, stop-recovery, STT
- `ZIUM_Detection` — RealSense pub, YOLO, FoundationPose pose estimation (package: `zium_detection`)
- `ZIUM_UI/src` — React 관리자 대시보드 (Floor Plan, 공정률, 일시정지/재개)

## Secrets Policy

- 로봇 IP, Modbus 주소는 `.env` 또는 launch file 파라미터로만 관리
- `.env` 파일 커밋 금지 — `.env.example`이 템플릿

## Dev Conventions

- 커밋은 명시적으로 요청받을 때만 생성
- 한 논리적 변경 = 한 커밋 (독립적으로 revert 가능)
- 커밋 subject line은 영어, body는 한/영 혼용 허용
- ROS2 노드 변경 후 반드시 `colcon build` 에러 없음 확인
- 실제 로봇 연결 전 virtual/simulation 모드 동작 확인

## Compact Instructions

압축 시 보존:
1. Hard Rules (global + project-specific)
2. 현재 작업 중인 브랜치 / 미커밋 파일 목록
3. 진행 중인 태스크와 상태
4. 활성 에러 또는 조사 중인 버그
5. Dev Conventions
6. 이번 세션에서 수정한 파일 경로
