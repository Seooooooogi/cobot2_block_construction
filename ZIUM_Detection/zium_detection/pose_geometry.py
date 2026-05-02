"""
pose_geometry — FoundationPose 노드에서 사용하는 순수 기하 계산 함수 모음.

이 모듈은 ROS/카메라/노드 상태에 의존하지 않는 수학 변환만 담당한다.
- TF 메시지 → 4x4 동차 변환 행렬 변환 (build_tf_matrix)
- 카메라 좌표계 포즈 → 베이스 좌표계 그리핑 좌표/각도 변환 (compute_gripping_point)
- 회전 행렬 기반 레고 자세 분류 (classify_lego_pose)

검증된 컨벤션 (FoundationPose 통합 검증, 2026-04-27):
- T_gripper2camera 의 translation magnitude > 5 → mm 단위로 간주, /1000 자동 변환
- bz offset -260 mm 적용 (좌표계 origin 차이 보정 — 의미는 미문서화)
- TF chain: base_link → link_1 → ... → link_6 (6개 transform 순차 곱)
"""

import numpy as np
from scipy.spatial.transform import Rotation as R


def classify_lego_pose(rot_matrix):
    """레고 블록의 자세를 베이스 Z축 대비 로컬 축 방향으로 분류.

    로봇 베이스 Z축([0,0,1])과 블록 로컬 축 (X/Y/Z)의 내적 부호·크기로
    UPRIGHT / INVERTED / SIDE / FRONT / UNKNOWN 5종을 판별한다.

    Parameters
    ----------
    rot_matrix : np.ndarray, shape (3, 3)
        베이스 좌표계 기준 블록 회전 행렬.

    Returns
    -------
    pose_name : str
        자세명 — "UPRIGHT" | "INVERTED" | "SIDE" | "FRONT" | "UNKNOWN".
    pose_code : float
        자세 코드 — UPRIGHT=0.0, INVERTED=1.0, SIDE=2.0, FRONT=3.0, UNKNOWN=-1.0.
        UPRIGHT(0.0)이면 재정렬 불필요, 그 외는 재정렬 필요로 해석.
    """
    base_z = np.array([0, 0, 1])
    local_x = rot_matrix @ np.array([1, 0, 0])
    local_y = rot_matrix @ np.array([0, 1, 0])
    local_z = rot_matrix @ np.array([0, 0, 1])

    dot_x = np.dot(local_x, base_z)
    dot_y = np.dot(local_y, base_z)
    dot_z = np.dot(local_z, base_z)

    if dot_z > 0.8:
        return "UPRIGHT", 0.0
    elif dot_z < -0.8:
        return "INVERTED", 1.0
    elif abs(dot_y) > 0.8:
        return "SIDE", 2.0
    elif abs(dot_x) > 0.8:
        return "FRONT", 3.0
    else:
        return "UNKNOWN", -1.0


def build_tf_matrix(transform):
    """단일 TransformStamped 메시지를 4x4 동차 변환 행렬로 변환.

    회전은 quaternion(x,y,z,w) → 3x3 회전 행렬, 변위는 translation(x,y,z) →
    동차 행렬의 마지막 열 [0:3, 3] 에 채워진다.

    Parameters
    ----------
    transform : geometry_msgs.msg.TransformStamped
        ROS2 TF 메시지. transform.transform.rotation / translation 사용.

    Returns
    -------
    mat : np.ndarray, shape (4, 4)
        동차 변환 행렬 (단위는 입력 translation 단위 그대로 — 보통 m).
    """
    mat = np.eye(4)
    mat[:3, :3] = R.from_quat([
        transform.transform.rotation.x,
        transform.transform.rotation.y,
        transform.transform.rotation.z,
        transform.transform.rotation.w,
    ]).as_matrix()
    mat[:3, 3] = [
        transform.transform.translation.x,
        transform.transform.translation.y,
        transform.transform.translation.z,
    ]
    return mat


def compute_gripping_point(pose_in_cam, T_g2c, T_base2gripper):
    """카메라 좌표계 블록 포즈를 베이스 좌표계 그리핑 좌표/각도로 변환.

    파이프라인:
    1. T_g2c (gripper→camera) translation 단위 자동 보정 (mm 감지 시 ÷1000)
    2. T_base2cam = T_base2gripper @ T_g2c
    3. 카메라 좌표계 블록 원점 → 베이스 좌표계 좌표 (m → mm 변환, z에 -260mm 오프셋)
    4. 베이스 좌표계 회전 행렬 → Roll/Pitch (xyz Euler) 추출
    5. Yaw = arctan2(local_x_in_base.y, local_x_in_base.x) + 90, [-180, 180] 정규화

    Parameters
    ----------
    pose_in_cam : np.ndarray, shape (4, 4)
        카메라 좌표계 기준 블록 포즈 (FoundationPose 출력, m 단위).
    T_g2c : np.ndarray, shape (4, 4)
        gripper → camera hand-eye calibration 행렬.
        translation 절대값이 5 이상이면 mm 단위로 간주하여 자동 ÷1000 변환된다.
    T_base2gripper : np.ndarray, shape (4, 4)
        base → gripper TF chain 누적 행렬. 단위 m.

    Returns
    -------
    coords : tuple of float
        (bx, by, bz) — 베이스 좌표계 그리핑 좌표, 단위 mm. bz에 -260 오프셋 적용됨.
    angles : tuple of float
        (roll, pitch, yaw) — 베이스 좌표계 자세, 단위 도(°). yaw는 [-180, 180].
    rot_matrix : np.ndarray, shape (3, 3)
        베이스 좌표계 기준 블록 회전 행렬 — classify_lego_pose 입력으로 사용.
    """
    # 1. 위치 계산 (카메라 좌표 -> 베이스 좌표)
    cam_top_center = pose_in_cam @ np.array([0, 0, 0, 1])
    T_g2c_m = T_g2c.copy()
    if np.any(np.abs(T_g2c_m[:3, 3]) > 5.0):
        T_g2c_m[:3, 3] /= 1000.0

    T_base2cam = T_base2gripper @ T_g2c_m
    base_top_center = T_base2cam @ cam_top_center

    # 단위 변환 (m -> mm) 및 오프셋(-260) 적용
    bx = base_top_center[0] * 1000
    by = base_top_center[1] * 1000
    bz = (base_top_center[2] * 1000) - 260

    # 2. 자세 계산 (절대 각도)
    T_base2obj = T_base2cam @ pose_in_cam
    rot_matrix = T_base2obj[:3, :3]

    # Scipy 를 이용한 Roll(RX), Pitch(RY) 추출
    euler_angles = R.from_matrix(rot_matrix).as_euler('xyz', degrees=True)
    roll, pitch = euler_angles[0], euler_angles[1]

    # Yaw(RZ) 계산 및 -180 ~ 180 범위 조정
    obj_x_in_base = rot_matrix @ np.array([1, 0, 0])
    yaw = np.degrees(np.arctan2(obj_x_in_base[1], obj_x_in_base[0])) + 90

    if yaw > 180:
        yaw -= 360
    elif yaw < -180:
        yaw += 360

    return (bx, by, bz), (roll, pitch, yaw), rot_matrix
