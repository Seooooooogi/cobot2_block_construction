"""
vis_utils — FoundationPose 노드용 OpenCV 시각화 헬퍼.

ROS/노드 상태에 의존하지 않는 순수 이미지 변환만 담당한다.
cv2.imshow / cv2.waitKey 같은 화면 출력 부수효과는 호출자(노드 메서드)에 두어
모듈 자체는 입력 이미지 → 시각화된 이미지의 결정적(deterministic) 변환만 수행한다.
"""

import cv2
import torch


def draw_yolo_detections(color_img, all_dets, best_det):
    """YOLO 검출 결과를 입력 이미지에 박스/라벨로 그려 새 이미지로 반환한다.

    선정된 타겟(`best_det`)은 빨간색(BGR (0,0,255)) + 두꺼운 박스 + "TARGET LOCKED:" 접두 라벨,
    나머지 검출은 초록색(BGR (0,255,0)) + 일반 두께 박스 + "ID:{cls} {conf:.2f}" 라벨로 표시한다.
    원본 `color_img`는 변경하지 않는다 (내부에서 copy 후 그린다).

    Parameters
    ----------
    color_img : np.ndarray, shape (H, W, 3), dtype uint8
        BGR 색상 이미지. CvBridge 가 RealSense 컬러 토픽에서 변환한 형태를 가정.
    all_dets : iterable
        YOLO `Results.boxes` 의 iterable. 각 원소는 `xyxy`(torch.Tensor, shape (1,4)),
        `conf`(torch.Tensor, shape (1,)), `cls`(torch.Tensor, shape (1,)) 를 가져야 한다.
    best_det : object or None
        `all_dets` 중 선택된 타겟. None 이면 모든 검출이 일반(초록) 색상으로 그려진다.
        타겟 일치 판정은 `torch.equal(det.xyxy[0], best_det.xyxy[0])` 로 수행.

    Returns
    -------
    yolo_vis : np.ndarray, shape (H, W, 3), dtype uint8
        박스/라벨이 그려진 시각화 이미지. 화면 표시(`cv2.imshow`)는 호출자가 수행.
    """
    yolo_vis = color_img.copy()

    for det in all_dets:
        box = det.xyxy[0].cpu().numpy().astype(int)
        conf = det.conf[0].item()
        cls = int(det.cls[0].item())

        # 기본 색상: 초록색 (BGR)
        color = (0, 255, 0)
        label = f"ID:{cls} {conf:.2f}"

        # 선정된 타겟이면 빨간색 + 두꺼운 박스(thickness=3)로 강조
        if best_det is not None and torch.equal(det.xyxy[0], best_det.xyxy[0]):
            color = (0, 0, 255)
            label = f"TARGET LOCKED: {label}"
            cv2.rectangle(yolo_vis, (box[0], box[1]), (box[2], box[3]), color, 3)
        else:
            cv2.rectangle(yolo_vis, (box[0], box[1]), (box[2], box[3]), color, 2)

        cv2.putText(yolo_vis, label, (box[0], box[1] - 10),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2)

    return yolo_vis
