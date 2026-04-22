# Development Workflow — JIUM

> 글로벌 development-workflow.md를 확장합니다.

## Context Efficiency

- **JIT reading**: 수정 중인 함수/섹션만 읽는다. 전체 파일 로드는 구조 파악이 필요할 때만.
- **Glob/Grep 먼저**: 경로 모를 때는 Read 전에 Glob/Grep으로 위치 확인.
- **Subagent 반환 압축**: 심층 검색 결과 → 핵심 발견만. 원시 출력 전달 금지.

## Review Pipeline (Strict)

```
구현 완료
    │
    ▼
[1. colcon build]
  - ZIUM_Control 또는 ZIUM_Detection 변경 시 반드시 실행
  - 에러 있으면 → 수정 후 재빌드. review 진행 금지
    │
    ▼
[2. code-reviewer]
  - ROS2 패턴, 설계 이슈, 외부 패키지 의존성 위반 체크
  - ROS2 Tier 0 규칙(jium-constitution.md) 준수 여부 확인
  - severity: CRITICAL / MAJOR / MINOR
  - CRITICAL → 반드시 수정 후 재검토
    │
    ▼
[3. verification checklist]
  - 아래 체크리스트 항목 전부 통과해야 완료 선언 가능
    │
    ▼
완료 선언 가능
```

## code-reviewer 자동 트리거 (JIUM 전용)

다음 작업 완료 후 자동으로 code-reviewer 실행:
- `pick2build/` 내 노드 파일 신규 작성 또는 수정
- `cobot2/` 내 노드 파일 신규 작성 또는 수정
- `.launch.py` 파일 작성 또는 수정
- M0609 모션 명령 관련 코드 변경 (`move()`, `pick()`, `place()`, compliance 관련)
- Detection 파이프라인 변경 (YOLO 후처리, FoundationPose 연동)
- ROS 토픽 발행/구독 구조 변경

## Verification Checklist

완료 선언 전 반드시 확인:

### ROS2 패키지 변경 시
- [ ] `colcon build` 에러 없음 (`cd ZIUM_Control && colcon build` 또는 `ZIUM_Detection`)
- [ ] launch 파일 에러 없음 (`ros2 launch pick2build run_system.launch.py`)
- [ ] 변경된 토픽이 실제 퍼블리시/구독되는지 확인 (`ros2 topic list`)
- [ ] 콜백 내 blocking 호출 없음 확인

### Detection 파이프라인 변경 시
- [ ] Docker 컨테이너 내 `colcon build` 에러 없음
- [ ] RealSense 데이터 정상 수신 (`ros2 topic hz /dsr01/camera/color/image_raw`)
- [ ] YOLO 감지 결과 정상 출력 확인
- [ ] FoundationPose 누락 케이스 처리 로직 확인 (skip 처리 여부)

### M0609 모션 코드 변경 시
- [ ] E-Stop 로직 존재 확인
- [ ] `/signal_stop` 수신 시 동작 중단 확인
- [ ] 포즈 데이터 없이 모션 실행되는 경로 없음 확인

### 실제 로봇 연결 전
- [ ] 로봇 IP 연결 확인 (`ping 192.168.1.100` 또는 `.env` 기준 IP)
- [ ] Modbus 연결 확인 (그리퍼)
- [ ] 동일 시퀀스를 시뮬레이션/가상 모드에서 먼저 완료

## Commit Policy

- 커밋은 명시적으로 요청받을 때만 생성
- 한 논리적 변경 = 한 커밋 (독립적으로 revert 가능)
- `--no-verify` 사용 금지
- Subject line: 영어만. Body: 한/영 혼용 허용

## ROS2 명령어 참조

```bash
# 빌드 (Control)
cd /home/rokey/cobot2_block_construction/ZIUM_Control
source /opt/ros/$ROS_DISTRO/setup.bash
colcon build
source install/setup.bash

# 빌드 (Detection, Docker 내부)
cd /home/rokey/cobot2_block_construction/ZIUM_Detection
colcon build
source install/setup.bash

# 런치
ros2 launch pick2build run_system.launch.py

# 토픽 확인
ros2 topic list
ros2 topic hz /dsr01/target_lego_pose
ros2 topic echo /signal_stop
```
