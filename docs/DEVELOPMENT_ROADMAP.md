# JIUM — Development Roadmap

## Completed (v1.0, 2026-02-10 ~ 2026-02-27)

- [x] Project planning & environment setup
- [x] YOLO + FoundationPose detection pipeline (Detection PC, Docker)
- [x] RealSense publisher node
- [x] 6-DoF pose estimation
- [x] M0609 coordinate teaching & motion development
- [x] brick_pick() / brick_place() ROS2 nodes
- [x] Compliance/force feedback for brick placement
- [x] Stop / Resume / Force-resume safety system
- [x] React admin UI (floor plan, 공정률, 제어 패널)
- [x] rosbridge WebSocket integration
- [x] STT (음성 인식) → tool pick 시퀀스
- [x] End-to-end system integration
- [x] 3-stage workflow (Stage1: pick, Stage2: place, Stage3: user push)

## Phase 2: Code Refactoring

- [ ] 2-1. 패키지 의존성 정리 (pick2build / cobot2 불필요 import 제거)
- [ ] 2-2. 중복 로직 통합 (Control / Detection 간 공유 유틸리티 분리)
- [ ] 2-3. ROS2 노드 구조 정리 (노드 분리 기준 명확화, 단일 책임 원칙 적용)
- [ ] 2-4. 설정값 하드코딩 제거 (좌표, force threshold 등 → launch param / env)

## Phase 3: Reproducibility Verification

- [ ] 3-1. 외부 코드(FoundationPose 등) 환경 재현 절차 문서화
- [ ] 3-2. 실제 환경에서 전체 시퀀스 재실행 검증 (신규 환경 기준)
- [ ] 3-3. Docker 환경 재구성 후 detection pipeline 정상 동작 확인
- [ ] 3-4. 재현 실패 항목 목록화 및 원인 분석

## Phase 4: Stability & Robustness

- [ ] 4-1. Gripper 진입 불가 시 재시도 로직 (현재: 손 위치 스캔 fallback)
- [ ] 4-2. Brick 정렬 실패 시 자동 재정렬 횟수 제한 + abort 처리
- [ ] 4-3. Detection timeout handling (`/dsr01/target_lego_pose` 미수신 시)
- [ ] 4-4. Control PC ↔ Detection PC 연결 끊김 감지 및 복구

## Phase 5: Precision Improvement

- [ ] 5-1. RealSense 캘리브레이션 자동화 스크립트
- [ ] 5-2. Compliance force 파라미터 튜닝 인터페이스

## Phase 6: UI Enhancement

- [ ] 6-1. 실시간 카메라 피드 표시 (Admin UI)
- [ ] 6-2. 블록별 배치 성공/실패 시각화
- [ ] 6-3. 작업 이력 로그 저장 (JSON)
