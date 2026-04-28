/**
 * useBlueprintIO — 설계도 저장/불러오기 hook.
 *
 * 캔버스에 배치된 블록(`placedBlocks`)과 층 정보(`levels`)를 JSON 파일로
 * export하거나, 사용자가 선택한 JSON 파일에서 복원해 상태를 갱신한다.
 * 파일 IO만 담당하며 ROS 통신·드래그·렌더링과는 분리되어 있다.
 *
 * 저장 파일 포맷:
 * {
 *   "version": "1.0",
 *   "savedAt": "<ISO8601>",
 *   "levels":  [1, 2, ...],
 *   "blocks":  [<placedBlock>, ...]
 * }
 *
 * @param {Object}   params
 * @param {Array}    params.placedBlocks      - 캔버스에 배치된 블록 배열. 저장 시 그대로 직렬화.
 * @param {number[]} params.levels            - 생성된 층 번호 배열 (예: [1, 2, 3]).
 * @param {Function} params.setPlacedBlocks   - 블록 상태 setter. 불러오기 성공 시 덮어씀.
 * @param {Function} params.setLevels         - 층 상태 setter. 불러오기 성공 시 덮어씀.
 *                                              파일에 levels가 없으면 [1]로 폴백.
 * @param {Function} params.setCurrentLevel   - 현재 층 setter. 불러오기 후 1로 초기화.
 * @param {Function} params.setSelectedId     - 선택 블록 setter. 불러오기 후 null로 초기화.
 *
 * @returns {{
 *   saveBlueprintToFile: () => void,
 *   loadBlueprintFromFile: (e: Event) => void
 * }}
 */
export function useBlueprintIO({
  placedBlocks,
  levels,
  setPlacedBlocks,
  setLevels,
  setCurrentLevel,
  setSelectedId,
}) {
  /**
   * 현재 placedBlocks/levels를 JSON 파일로 다운로드한다.
   *
   * 파일명 규칙: `JIUM_Blueprint_YYYY-M-D_HHmm.json` (초 단위 제외).
   *   - 같은 분 안에 여러 번 저장하면 파일명이 충돌해 브라우저가 (1), (2) 등을 붙임.
   *
   * 빈 상태(placedBlocks.length === 0)에서는 alert로 안내하고 종료.
   * 다운로드 트리거는 임시 <a download> DOM을 생성·클릭·제거하는 표준 트릭 사용.
   */
  const saveBlueprintToFile = () => {
    if (placedBlocks.length === 0) {
      alert("저장할 블록 정보가 없습니다.");
      return;
    }

    // 날짜·시간 추출 (로컬 타임존 기준 — 파일명용)
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const date = now.getDate();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');

    const fileName = `JIUM_Blueprint_${year}-${month}-${date}_${hours}${minutes}.json`;

    const dataToSave = {
      version: "1.0",
      savedAt: now.toISOString(),
      levels: levels,
      blocks: placedBlocks,
    };

    const jsonString = JSON.stringify(dataToSave, null, 2);
    const blob = new Blob([jsonString], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    // <a download> 트릭으로 브라우저 다운로드 트리거. 사용 후 즉시 정리.
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  /**
   * <input type="file"> change 이벤트로부터 JSON 파일을 읽어 설계도를 복원한다.
   *
   * 사용자 confirm 후에만 상태를 덮어쓰며, 불러오기 후에는 1층부터 표시한다.
   * 같은 파일을 다시 선택할 수 있도록 함수 종료 시 input value를 비운다.
   *
   * 유효성 검사는 최소한(`blocks` 필드가 배열인지)만 수행한다.
   *   - version/savedAt 호환성·블록 스키마 검증은 의도적으로 생략.
   *
   * @param {Event} e - <input type="file"> change 이벤트.
   *                    e.target.files[0]가 사용자가 선택한 파일 객체.
   */
  const loadBlueprintFromFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const importedData = JSON.parse(event.target.result);

        // 최소 유효성: blocks가 배열이어야 함
        if (!importedData.blocks || !Array.isArray(importedData.blocks)) {
          throw new Error("유효한 설계도 파일이 아닙니다.");
        }

        if (window.confirm("새 설계도를 불러오시겠습니까? 현재 작업 중인 내용은 사라집니다.")) {
          setPlacedBlocks(importedData.blocks);
          setLevels(importedData.levels || [1]);
          setCurrentLevel(1);
          setSelectedId(null);
          alert("✅ 설계도를 성공적으로 불러왔습니다!");
        }
      } catch (err) {
        alert("⚠️ 파일을 읽는 중 오류가 발생했습니다: " + err.message);
      }
    };
    reader.readAsText(file);

    // 같은 파일을 다시 선택할 수 있도록 input value 초기화
    e.target.value = "";
  };

  return { saveBlueprintToFile, loadBlueprintFromFile };
}
