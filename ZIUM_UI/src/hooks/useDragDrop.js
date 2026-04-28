import { useState, useEffect, useRef } from 'react';
import { GRID_SIZE, CANVAS_W, CANVAS_H } from '../constants';

/**
 * useDragDrop — 캔버스 블록 드래그앤드롭 hook.
 *
 * 사이드바에서 새 블록을 드래그해 캔버스에 놓는 'CREATE' 시나리오와,
 * 이미 배치된 블록을 다른 위치로 옮기는 'MOVE' 시나리오를 모두 처리한다.
 * 드래그 프리뷰(드롭 위치 미리보기)와 충돌 검사도 함께 책임진다.
 *
 * 동작 흐름:
 *   1. onDragStartNew      : 사이드바 블록 → CREATE 모드, blockType을 dataTransfer에 직렬화
 *   2. onDragStartExisting : 캔버스 블록 → MOVE 모드, blockId만 전송
 *   3. onDragOver          : 마우스 이동 시 격자 스냅 + 충돌 검사 → dragPreview 갱신
 *   4. onDrop              : isValid 확인 후 placedBlocks 갱신 (CREATE: 추가, MOVE: 위치 변경)
 *
 * 같은 층(currentLevel) 블록끼리만 충돌로 간주한다 — 다른 층 블록 위에 겹쳐 쌓는 것은 허용.
 *
 * @param {Object}          params
 * @param {Array}           params.placedBlocks    - 현재 배치된 블록 배열. 충돌 검사 + MOVE 갱신에 사용.
 * @param {number}          params.currentLevel    - 현재 표시 중인 층. 충돌 검사 시 같은 층만 비교.
 * @param {number}          params.zoomLevel       - 캔버스 줌 배율 (0.2~2.0). 마우스 좌표 보정.
 * @param {React.RefObject} params.canvasAreaRef   - canvas-area DOM ref. scroll 위치 + bounding rect 참조.
 * @param {Function}        params.setPlacedBlocks - 블록 상태 setter. CREATE/MOVE 결과 반영.
 * @param {Function}        params.setSelectedId   - 선택 블록 setter. MOVE 시작 시 해당 블록을 선택 상태로.
 *
 * @returns {{
 *   activeDragInfo:      Object|null,
 *   dragPreview:         Object|null,
 *   setDragPreview:      Function,
 *   onDragStartNew:      (e: DragEvent, blockType: Object) => void,
 *   onDragStartExisting: (e: DragEvent, id: number) => void,
 *   onDragOver:          (e: DragEvent) => void,
 *   onDrop:              (e: DragEvent) => void
 * }}
 */
export function useDragDrop({
  placedBlocks,
  currentLevel,
  zoomLevel,
  canvasAreaRef,
  setPlacedBlocks,
  setSelectedId,
}) {
  // 드래그 중인 블록 정보 — onDragOver/onDrop이 참조 (CREATE 시 id=null, MOVE 시 기존 id).
  const [activeDragInfo, setActiveDragInfo] = useState(null);

  // 드롭 위치 미리보기 — { x, y, w, h, isValid }. JSX에서 valid/invalid 시각화.
  const [dragPreview, setDragPreview] = useState(null);

  // 브라우저 기본 드래그 고스트(반투명 블록)를 제거하기 위한 1x1 투명 이미지.
  // setDragImage()에 넘겨 실제 드래그 시 표시되는 그림자를 숨긴다.
  const transparentImg = useRef(new Image());
  useEffect(() => {
    transparentImg.current.src =
      'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  }, []);

  /**
   * 충돌 검사 — 새 블록 배치 영역이 같은 층의 다른 블록과 겹치는지 확인.
   *
   * @param {number}      newX      - 좌상단 x (px, 캔버스 좌표).
   * @param {number}      newY      - 좌상단 y (px).
   * @param {number}      newW      - 가로 격자 칸 수.
   * @param {number}      newH      - 세로 격자 칸 수.
   * @param {number|null} excludeId - MOVE 시 자기 자신을 충돌 대상에서 제외할 id.
   * @returns {boolean} 다른 같은 층 블록과 겹치면 true.
   */
  const checkOverlap = (newX, newY, newW, newH, excludeId = null) => {
    return placedBlocks.some((block) => {
      // 다른 층 블록은 충돌 검사에서 제외 (겹쳐 쌓기 허용)
      if (block.level !== currentLevel) return false;
      if (excludeId && block.id === excludeId) return false;

      const isXOverlap = newX < block.x + block.w * GRID_SIZE && newX + newW * GRID_SIZE > block.x;
      const isYOverlap = newY < block.y + block.h * GRID_SIZE && newY + newH * GRID_SIZE > block.y;
      return isXOverlap && isYOverlap;
    });
  };

  /**
   * 사이드바에서 새 블록 드래그 시작 (CREATE 모드).
   *
   * @param {DragEvent} e         - dragstart 이벤트.
   * @param {Object}    blockType - constants.js의 BlockType 객체.
   */
  const onDragStartNew = (e, blockType) => {
    e.dataTransfer.setData('actionType', 'CREATE');
    e.dataTransfer.setData('blockType', JSON.stringify(blockType));

    if (e.dataTransfer.setDragImage) {
      e.dataTransfer.setDragImage(transparentImg.current, 0, 0);
    }

    setActiveDragInfo({ w: blockType.w, h: blockType.h, id: null });
  };

  /**
   * 캔버스에 이미 배치된 블록 드래그 시작 (MOVE 모드).
   *
   * @param {DragEvent} e  - dragstart 이벤트.
   * @param {number}    id - 이동시킬 블록의 고유 id (Date.now 기반).
   */
  const onDragStartExisting = (e, id) => {
    const block = placedBlocks.find(b => b.id === id);
    e.dataTransfer.setData('actionType', 'MOVE');
    e.dataTransfer.setData('blockId', id);
    setSelectedId(id);

    if (e.dataTransfer.setDragImage) {
      e.dataTransfer.setDragImage(transparentImg.current, 0, 0);
    }

    setActiveDragInfo({ w: block.w, h: block.h, id: block.id });
  };

  /**
   * 캔버스 위에서 드래그 중일 때 호출.
   * 마우스 좌표를 격자에 스냅 + 캔버스 경계 클램프 + 충돌 검사 후 dragPreview 갱신.
   *
   * 좌표 변환 단계:
   *   1. 패딩(40)과 컨테이너 bounding rect 보정으로 캔버스 영역 내 좌표 추출
   *   2. 스크롤 양 + zoomLevel 보정 → 실제(논리) 캔버스 좌표
   *   3. 블록 중심이 마우스에 오도록 좌상단 좌표 계산
   *   4. GRID_SIZE 단위 스냅
   *   5. 캔버스 범위(CANVAS_W/H) 클램프
   *
   * @param {DragEvent} e - dragover 이벤트.
   */
  const onDragOver = (e) => {
    e.preventDefault();
    if (!activeDragInfo || !canvasAreaRef.current) return;

    const container = canvasAreaRef.current;
    const rect = e.currentTarget.getBoundingClientRect();

    // 캔버스 패딩 보정 (40px)
    const padding = 40;
    const offsetX = e.clientX - rect.left - padding;
    const offsetY = e.clientY - rect.top - padding;

    // 스크롤 + 줌 보정 → 실제 캔버스 좌표
    const mouseX = (offsetX + container.scrollLeft) / zoomLevel;
    const mouseY = (offsetY + container.scrollTop) / zoomLevel;

    const blockW = activeDragInfo.w * GRID_SIZE;
    const blockH = activeDragInfo.h * GRID_SIZE;

    // 블록 중심을 마우스 끝에 맞추기 위해 좌상단 좌표 보정
    const newX = mouseX - blockW / 2;
    const newY = mouseY - blockH / 2;

    // 격자 스냅
    let snappedX = Math.round(newX / GRID_SIZE) * GRID_SIZE;
    let snappedY = Math.round(newY / GRID_SIZE) * GRID_SIZE;

    // 캔버스 경계 클램프
    snappedX = Math.max(0, Math.min(snappedX, CANVAS_W - blockW));
    snappedY = Math.max(0, Math.min(snappedY, CANVAS_H - blockH));

    const isOverlap = checkOverlap(snappedX, snappedY, activeDragInfo.w, activeDragInfo.h, activeDragInfo.id);

    setDragPreview({
      x: snappedX,
      y: snappedY,
      w: activeDragInfo.w,
      h: activeDragInfo.h,
      isValid: !isOverlap,
    });
  };

  /**
   * 드롭 처리 — 유효 위치면 placedBlocks 갱신, 겹치면 alert.
   *
   * CREATE 모드: blockType 전개 + 현재 currentLevel + help=false로 새 블록 추가.
   *              id는 Date.now()로 부여 (충돌 가능성 매우 낮은 단순 고유키).
   * MOVE   모드: 기존 블록의 x/y만 갱신, level/help/typeId 등은 유지.
   *
   * 드롭 종료 후 dragPreview / activeDragInfo는 항상 null로 정리.
   *
   * @param {DragEvent} e - drop 이벤트.
   */
  const onDrop = (e) => {
    e.preventDefault();
    const actionType = e.dataTransfer.getData('actionType');

    if (dragPreview && dragPreview.isValid) {
      if (actionType === 'CREATE') {
        const blockType = JSON.parse(e.dataTransfer.getData('blockType'));
        setPlacedBlocks([
          ...placedBlocks,
          {
            ...blockType,
            typeId: blockType.id,
            id: Date.now(),
            x: dragPreview.x,
            y: dragPreview.y,
            level: currentLevel,
            help: false,
          },
        ]);
      } else if (actionType === 'MOVE') {
        const blockId = Number(e.dataTransfer.getData('blockId'));
        setPlacedBlocks(placedBlocks.map(block =>
          block.id === blockId ? { ...block, x: dragPreview.x, y: dragPreview.y } : block
        ));
      }
    } else if (dragPreview && !dragPreview.isValid) {
      alert("⚠️ 다른 블록과 겹치는 위치에는 놓을 수 없습니다.");
    }

    setDragPreview(null);
    setActiveDragInfo(null);
  };

  return {
    activeDragInfo,
    dragPreview,
    setDragPreview,
    onDragStartNew,
    onDragStartExisting,
    onDragOver,
    onDrop,
  };
}
