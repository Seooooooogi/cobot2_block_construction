# Brief: Refactor pick2build / cobot2 Package Structure

**Goal**
pick2build와 cobot2 패키지의 Python 파일 역할을 파악하고, 파편화된 기능을 통합·정리하며 불필요한 import와 package.xml 의존성을 제거한다. 완료 기준은 양 패키지 colcon build 통과.

**Scope IN**
- pick2build / cobot2 각 Python 파일의 담당 기능 파악 및 정리
- 사용되지 않는 Python import 제거 (두 패키지 모두)
- 파편화된 기능 파일 통합 또는 재구성 (유사 역할 파일 병합)
- package.xml 의존성 실제 사용 기반으로 업데이트
- colcon build 에러 없이 통과 확인
- pick2build ↔ cobot2 간 ROS2 토픽 인터페이스 명세 문서화 (1-PC 통합 준비)

**Scope OUT**
- ROS2 토픽/서비스 인터페이스 변경 금지 (`/dsr01/target_lego_pose` 등 기존 계약 유지)
- pick/place/compliance 동작 로직 변경 금지 — 구조 정리만, 기능 수정 아님
- ZIUM_UI 코드 변경 없음
- launch 파일 entry point 변경 없음
- Docker 환경(Dockerfile, 이미지) 변경 없음
- 실제 1-PC 통합 실행 제외 — 인터페이스 명세까지만 (통합은 Phase 3 이후 별도 brief)

**1-PC 통합 검토 (Phase 3 이후)**
- Option A: 패키지 구조 유지, 단일 PC에서 Docker + Host 동시 실행 (토픽 localhost 통신)
- Option B: cobot2를 ROS Humble로 마이그레이션, 단일 워크스페이스 통합
- 이번 Phase에서 인터페이스를 명확히 정의해두면 통합 시 변경 범위 최소화 가능

**Constraints**
- 기존 ROS2 토픽 인터페이스 유지: 노드명·토픽명·메시지 타입 동일해야 함
- `od_msg`, `dsr_msgs2` 커스텀 패키지 의존성: 실제 사용 여부 확인 후에만 제거
- 리팩토링 전후 `colcon build` 동일하게 통과해야 함

**Exit Criteria**
- [ ] `cd ZIUM_Control && colcon build` → 에러 없이 완료
- [ ] `cd ZIUM_Detection && colcon build` (Docker 내) → 에러 없이 완료
- [ ] 각 Python 파일의 역할이 코드 내 또는 별도 메모로 명확히 정의됨
- [ ] 통합 전후 ROS2 토픽 목록 동일 (`ros2 topic list` 기준)

**Risk Flags**
- `od_msg`, `dsr_msgs2`는 외부 커스텀 패키지 — 실제 미사용이어도 제거 시 다른 노드에서 간접 의존 가능
- `detection.py`의 mediapipe import가 Control PC(pick2build)에 있음 — hand landmark detection 용도로 추정되나, 실제 사용 경로 불명확
- 파일 통합 시 circular import 발생 가능 (pick2build 내 상호 참조 구조 주의)
- Docker(ROS Foxy) ↔ Host(ROS Humble) 간 import 경로 혼용 — cobot2 정리 시 환경 분리 유지 필요
