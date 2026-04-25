#!/bin/bash
set -e
source /opt/ros/humble/setup.bash
source /ros2_ws/install/setup.bash

# ---------- Weights pre-flight check ----------
# FoundationPose 노드가 죽으면 컨테이너도 즉시 종료되어 원인 메시지가 묻힘.
# 시작 시점에 누락 가중치를 명확히 보고해 docker logs 첫 줄에서 바로 보이도록 함.
WEIGHTS_DIR=/ros2_ws/src/zium_detection/FoundationPose-main/weights
MISSING=()
[[ -f "$WEIGHTS_DIR/best.pt" ]] || MISSING+=("YOLO best.pt (호스트에서 weights/ 마운트 확인)")
[[ -f "$WEIGHTS_DIR/2023-10-28-18-33-37/config.yml" ]] || MISSING+=("FoundationPose refiner: 2023-10-28-18-33-37/")
[[ -f "$WEIGHTS_DIR/2024-01-11-20-02-45/config.yml" ]] || MISSING+=("FoundationPose scorer:  2024-01-11-20-02-45/")

if [[ ${#MISSING[@]} -gt 0 ]]; then
  cat <<EOF
================================================================
[zium-detection] 가중치 누락 — 노드 시작 직후 죽을 가능성:
EOF
  for w in "${MISSING[@]}"; do echo "  - $w"; done
  cat <<EOF

다운로드 (NVlabs FoundationPose 공식 가중치):
  https://drive.google.com/drive/folders/1DFezOAD0oD1BblsXVxqDsl8fj0qzB82i

배치 위치:
  ZIUM_Detection/FoundationPose-main/weights/2023-10-28-18-33-37/
  ZIUM_Detection/FoundationPose-main/weights/2024-01-11-20-02-45/
================================================================

EOF
fi

exec "$@"
