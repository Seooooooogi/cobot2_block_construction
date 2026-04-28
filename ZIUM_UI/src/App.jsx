import React, { useState, useEffect, useRef } from 'react';
// import * as ROSLIB from 'roslib';
import './App.css';
import logoImg from './logo.png';
import {
  BLOCK_TYPES,
  CANVAS_W,
  CANVAS_H,
  GRID_SIZE,
} from './constants';
import { useBlueprintIO } from './hooks/useBlueprintIO';
import { useDragDrop } from './hooks/useDragDrop';
import { useROS } from './hooks/useROS';

const BlueprintEditor = () => {
  const [placedBlocks, setPlacedBlocks] = useState([]);
  const [selectedId, setSelectedId] = useState(null);

  const [levels, setLevels] = useState([1]); // 생성된 층 배열 [1, 2, 3...]
  const [currentLevel, setCurrentLevel] = useState(1); // 현재 화면에 보이는 층

  // --- 진행률 관리를 위한 상태 ---
  const [totalSentCount, setTotalSentCount] = useState(0);       // 전송한 총 블록 개수
  const [completedBlockIds, setCompletedBlockIds] = useState([]); // 로봇이 배치 완료한 ID 배열 (/signal_id)

  // 확대/축소 상태 (기본 1.0)
  const [zoomLevel, setZoomLevel] = useState(0.8);
  const canvasAreaRef = useRef(null);

  // ROS 통신은 useROS hook이 책임 (rosRef/rosStatus는 hook이 소유).
  const [isProcessing, setIsProcessing] = useState(false);

  // 로봇 작업 진행 상태 (대기 중, 진행 중, 일시 정지 등)
  const [robotWorkingStatus, setRobotWorkingStatus] = useState('대기 중 💤');

  // --- 키보드 Delete / Backspace 키로 블록 삭제 ---
  useEffect(() => {
    const handleKeyDown = (e) => {
      // 1. 블록이 선택된 상태인지 확인
      // 2. 누른 키가 Delete 또는 Backspace인지 확인
      if (selectedId && (e.key === 'Delete' || e.key === 'Backspace')) {
        
        // input창 입력 중에 삭제되는 것을 방지 (나중에 텍스트 입력 기능 추가 시 필요)
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        // 선택 삭제 함수 호출
        deleteBlock();
        console.log(`[단축키] 블록 ID ${selectedId} 삭제됨`);
      }
    };

    // 윈도우 전체에 키다운 이벤트 리스너 등록
    window.addEventListener('keydown', handleKeyDown);
    
    // 컴포넌트 언마운트 시 리스너 제거 (메모리 누수 방지)
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectedId]); // selectedId가 바뀔 때마다 리스너 내부의 참조를 갱신

  // 블록 배치가 모두 끝났는지 감지
  useEffect(() => {
    if (totalSentCount > 0 && completedBlockIds.length === totalSentCount) {
      setRobotWorkingStatus('작업 마침 ✅');
    }
  }, [completedBlockIds, totalSentCount]);

  // 좌표 숫자 배열 생성 (0~80, 0~48)
  const xAxisLabels = Array.from({ length: 81 }, (_, i) => i);
  const yAxisLabels = Array.from({ length: 49 }, (_, i) => i);

  // ROS 연결·구독·서비스·publish 책임은 useROS hook으로 일임.
  // hook 내부에서 마운트 시 자동 connect + /signal_id 구독 + 언마운트 시 close 처리.
  const { rosStatus, callSignalService, publishBlockInfo } = useROS({
    setCompletedBlockIds,
    setTotalSentCount,
    setRobotWorkingStatus,
  });

  // 브라우저 줌 방지 및 캔버스 전용 줌 (Native Event)
  useEffect(() => {
    const container = canvasAreaRef.current;
    if (!container) return;

    const handleNativeWheel = (e) => {
      if (e.ctrlKey) {
        e.preventDefault(); // 브라우저 전체 줌 방지
        const delta = e.deltaY > 0 ? -0.05 : 0.05;
        setZoomLevel(prev => Math.min(Math.max(prev + delta, 0.2), 2.0));
      }
    };

    // passive: false 설정이 있어야 preventDefault가 작동합니다.
    container.addEventListener('wheel', handleNativeWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleNativeWheel);
  }, []);

  // 초기 로드 시 캔버스 크기에 맞춰 줌 조절 (Fit-to-screen)
  useEffect(() => {
    if (canvasAreaRef.current) {
      const container = canvasAreaRef.current;

      container.scrollLeft = 0;
      container.scrollTop = 0;
      // 전체가 다 보여야 하므로 더 작은 배율을 선택
      // setZoomLevel(Math.min(scaleX, scaleY, 1.0));
    }
  }, []);

  // --- 드래그앤드롭 ---
  // CREATE/MOVE 시나리오, 프리뷰, 충돌 검사 모두 useDragDrop hook이 책임진다.
  // hook은 placedBlocks/currentLevel/zoomLevel을 읽어 좌표를 계산하고,
  // setPlacedBlocks/setSelectedId를 통해 결과를 반영한다.
  const {
    activeDragInfo,
    dragPreview,
    setDragPreview,
    onDragStartNew,
    onDragStartExisting,
    onDragOver,
    onDrop,
  } = useDragDrop({
    placedBlocks,
    currentLevel,
    zoomLevel,
    canvasAreaRef,
    setPlacedBlocks,
    setSelectedId,
  });


  const deleteBlock = () => {
    setPlacedBlocks(placedBlocks.filter(block => block.id !== selectedId));
    setSelectedId(null);
  };

  // --- 사람의 도움(Help) 상태 토글 함수 ---
  const toggleHelpStatus = () => {
    if (!selectedId) return;
    setPlacedBlocks(placedBlocks.map(block => 
      block.id === selectedId ? { ...block, help: !block.help } : block
    ));
  };

  // 현재 층만 비우기
  const clearCurrentLevel = () => {
    setPlacedBlocks(placedBlocks.filter(block => block.level !== currentLevel));
    setSelectedId(null);
  };

  // 전체 초기화 (모든 층 비우고 Level 1로 리셋)
  const clearAllLevels = () => {
    if (window.confirm("모든 층의 설계도가 삭제됩니다. 정말 초기화하시겠습니까?")) {
      setPlacedBlocks([]);
      setLevels([1]);
      setCurrentLevel(1);
      setSelectedId(null);
      setTotalSentCount(0);       // 진행률 초기화
      setCompletedBlockIds([]);   // 진행률 초기화
      setRobotWorkingStatus('대기 중 💤'); // 초기화 시 상태도 대기로 변경
    }
  };

  // 새로운 층(탭) 추가
  const addNewLevel = () => {
    const nextLevel = levels.length + 1;
    setLevels([...levels, nextLevel]);
    setCurrentLevel(nextLevel);
    setSelectedId(null);
  };

  /**
   * 전체 설계도(모든 층) 전송.
   * 빈 상태 가드 + isProcessing 토글만 책임지고, 실제 publish/payload 변환은 hook에 위임.
   * 성공 시 모든 placedBlocks의 robotId를 hook이 반환한 idMap으로 갱신해
   * 진행률 시각화에서 어느 블록이 어느 robotId인지 매칭되도록 한다.
   */
  const publishToRobot = () => {
    if (placedBlocks.length === 0) {
      alert("⚠️ 배치된 블록이 없습니다.");
      return;
    }
    setIsProcessing(true);
    const result = publishBlockInfo(placedBlocks);
    if (result) {
      setPlacedBlocks(placedBlocks.map(b => ({ ...b, robotId: result.idMap[b.id] })));
      alert(`✅ ${placedBlocks.length}개의 블록 좌표를 전송했습니다!`);
    }
    setIsProcessing(false);
  };

  /**
   * 현재 층의 설계도만 전송.
   * 현재 층에 블록이 없으면 alert 후 종료. 성공 시 현재 층 블록의 robotId만 갱신.
   */
  const publishCurrentLevelToRobot = () => {
    const currentBlocks = placedBlocks.filter(b => b.level === currentLevel);
    if (currentBlocks.length === 0) {
      alert(`⚠️ 현재 층(Level ${currentLevel})에 배치된 블록이 없습니다.`);
      return;
    }
    setIsProcessing(true);
    const result = publishBlockInfo(currentBlocks);
    if (result) {
      setPlacedBlocks(placedBlocks.map(b =>
        b.level === currentLevel ? { ...b, robotId: result.idMap[b.id] } : b
      ));
      alert(`✅ Level ${currentLevel}의 블록 ${currentBlocks.length}개 좌표를 전송했습니다!`);
    }
    setIsProcessing(false);
  };

  // --- 블록이 세로형태인지 가로형태인지 판별하는 헬퍼 함수 ---
  const isBlockVertical = (block) => {
    if (!block || !block.h || !block.w) return false;
    if (block.h > block.w) return true;
    if (block.typeId && typeof block.typeId === 'string' && block.typeId.endsWith('_v')) {
      return true;
    }
    return false;
  };

  // 현재 층에 속한 블록과 렌더링을 위한 바로 아래층(고스트) 블록 분리
  const currentLevelBlocks = placedBlocks.filter(b => b.level === currentLevel);
  const previousLevelBlocks = placedBlocks.filter(b => b.level === currentLevel - 1);

  // --- 진행률 계산 퍼센티지 ---
  const progressPercent = totalSentCount === 0 ? 0 : Math.round((completedBlockIds.length / totalSentCount) * 100);

  const activeSelectedBlock = placedBlocks.find(b => b.id === selectedId);

  // 상태 텍스트에 따라 CSS 클래스 매핑 함수
  const getStatusClass = (status) => {
    if (status.includes('대기 중')) return 'state-waiting';
    if (status.includes('진행 중')) return 'state-working';
    if (status.includes('일시 정지')) return 'state-paused';
    if (status.includes('재개')) return 'state-resuming';
    if (status.includes('작업 마침')) return 'state-completed';
    return '';
  };

  // --- 설계도 저장 및 불러오기 ---
  // 파일 IO 책임은 useBlueprintIO hook으로 분리되어 있다.
  // hook은 placedBlocks/levels를 읽어 export하고, 불러오기 시 4개 setter로 상태를 갱신.
  const { saveBlueprintToFile, loadBlueprintFromFile } = useBlueprintIO({
    placedBlocks,
    levels,
    setPlacedBlocks,
    setLevels,
    setCurrentLevel,
    setSelectedId,
  });

  return (
    <div className="project-container">
      <header className="header">
        {/* 1. 좌측 로고 영역 */}
        <div className="logo-section">
          <img src={logoImg} alt="JIUM Logo" className="project-logo" />
          <div className="title-group">
            <h1 className="main-title">JIUM</h1>
            <span className="sub-title">Blueprint Designer</span>
          </div>
        </div>

        
        {/* 2. 중앙 영역: 상단(파일 관리) + 하단(진행률) */}
        <div className="center-management-zone">
          {/* 📁 파일 관리 섹션 (진행률 위로 이동) */}
          <div className="header-file-controls">
            <button onClick={saveBlueprintToFile} className="header-file-btn save">
              💾 설계도 저장
            </button>
            <label className="header-file-btn load">
              📂 불러오기
              <input type="file" accept=".json" onChange={loadBlueprintFromFile} style={{ display: 'none' }} />
            </label>
          </div>

          {/* 📊 건설 진행률 (아래로 이동) */}
          <div className="progress-container">
            <div className="progress-info">
              <span>CONSTRUCTION PROGRESS</span>
              <span>{progressPercent}% ({completedBlockIds.length} / {totalSentCount})</span>
            </div>
            <div className="progress-bar-bg">
              <div className="progress-bar-fill" style={{ width: `${progressPercent}%` }}></div>
            </div>
          </div>
        </div>

        {/* 3. 우측 컨트롤 영역 */}
        <div className="robot-controls">
          {/* --- 상태 모니터링 섹션 (비율 1:2) --- */}
          <div className="status-monitor">
            {/* ROS CONNECTION (비율 1) */}
            <div className={`status-card ros-card ${rosStatus.includes('에러') ? 'error-card' : ''}`}>
              <span className="card-label">ROS CONNECTION</span>
              <span className="card-value">
                {rosStatus.includes('완료') ? 'Connected' : 
                rosStatus.includes('시도') ? 'Connecting...' : 
                rosStatus.includes('에러') ? 'Init Error' : 'Disconnected'}
              </span>
            </div>

            {/* SYSTEM STATE (비율 2) */}
            <div className={`status-card work-card ${robotWorkingStatus.includes('마침') ? 'completed-card' : ''}`}>
              <span className="card-label">ROBOT STATE</span>
              <span className="card-value">
                {robotWorkingStatus}
              </span>
            </div>
          </div>
          
          {/* --- 버튼 제어 섹션 (비율 1:2) --- */}
          <div className="control-actions">
            <button className="signal-btn btn-unlock standard" onClick={() => callSignalService('/signal_unlock')}>
              Unlock 🔓
            </button>

            {/* ✅ 물리 스위치 형태의 토글 섹션 */}
            <div
              className={`toggle-switch-container ${robotWorkingStatus.includes('일시 정지') ? 'state-start' : 'state-stop'}`}
              onClick={() => {
                if (robotWorkingStatus.includes('일시 정지')) {
                  callSignalService('/signal_start');
                } else {
                  callSignalService('/signal_stop');
                }
              }}
            >
              {/* 배경 라벨 */}
              <div className="switch-label stop-label">Stop 🛑</div>
              <div className="switch-label start-label">Start ▶️</div>
              
              {/* 실제로 움직이는 핸들(스위치) */}
              <div className="switch-handle">
                {robotWorkingStatus.includes('일시 정지') ? 'Start' : 'Stop'}
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="main-layout">
        {/* 캔버스와 탭을 감싸는 컨테이너 추가 */}
        <div className="canvas-container">
          <section 
            className="canvas-area"
            ref={canvasAreaRef}
            onDragOver={onDragOver}
            onDrop={onDrop}
            onDragLeave={() => setDragPreview(null)}
            onClick={() => setSelectedId(null)}
          >
            <div 
              className="scroll-boundary"
              style={{ width: `${CANVAS_W * zoomLevel + 30}px`, height: `${CANVAS_H * zoomLevel + 25}px` }}
            >
              <div className="ruler-corner"></div>
              
              <div className="axis-x-sticky">
                <div className="label-container" style={{ width: (CANVAS_W * zoomLevel) + 100, position: 'relative', height: '100%' }}>
                  {xAxisLabels.map(num => (
                    <span key={`x-${num}`} className={`axis-label ${num % 2 === 0 ? 'even' : 'odd'}`} style={{ left: num * 25 * zoomLevel}}>
                      {num}
                    </span>
                  ))}
                </div>
              </div>

              <div className="axis-y-sticky">
                <div className="label-container" style={{ height: (CANVAS_H * zoomLevel) + 100, position: 'relative', width: '100%' }}>
                  {yAxisLabels.map(num => (
                    <span key={`y-${num}`} className={`axis-label ${num % 2 === 0 ? 'even' : 'odd'}`} style={{ top: num * 25 * zoomLevel }}>
                      {num}
                    </span>
                  ))}
                </div>
              </div>

              <div className="zoom-wrapper" style={{ transform: `scale(${zoomLevel})` }}>
                <div className="grid-overlay"></div>
                
                {dragPreview && (
                  <div 
                    className={`drag-preview ${dragPreview.isValid ? 'valid' : 'invalid'}`}
                    style={{ left: dragPreview.x, top: dragPreview.y, width: dragPreview.w * GRID_SIZE, height: dragPreview.h * GRID_SIZE }}
                  >
                    <div className="center-dot guide" />
                  </div>
                )}

                {/* 1. 이전 층 블록 (반투명 고스트 모드 - 조작 불가) */}
                {previousLevelBlocks.map((block) => {
                  const isCompleted = block.robotId && completedBlockIds.includes(block.robotId);
                  const isVertical = isBlockVertical(block); // 세로/가로 판별

                  return (
                    <div
                      key={`ghost-${block.id}`}
                      className={`placed-block ghost-block ${isCompleted ? 'completed' : ''} ${block.help ? 'help-active' : ''}`}
                      style={{ left: block.x, top: block.y, width: block.w * GRID_SIZE, height: block.h * GRID_SIZE, backgroundColor: block.color, '--w': block.w, '--h': block.h }}
                    >
                      {block.help && <div className="help-indicator">🙋‍♂️</div>}

                      <div className="pegs-container">
                        {Array.from({ length: block.w * block.h }).map((_, i) => <div key={i} className="lego-peg" />)}
                      </div>

                      {/* --- 고스트 블록에도 그리퍼 파지선 표시 --- */}
                      {isVertical ? (
                        <>
                          <div className="grip-line v-left" />
                          <div className="grip-line v-right" />
                        </>
                      ) : (
                        <>
                          <div className="grip-line h-top" />
                          <div className="grip-line h-bottom" />
                        </>
                      )}

                    </div>
                  );
                })}

                {/* 2. 현재 층 블록 */}
                {currentLevelBlocks.map((block) => {
                  // 배치 완료된 블록인지 검사
                  const isCompleted = block.robotId && completedBlockIds.includes(block.robotId);
                  const isVertical = isBlockVertical(block);
                  
                  return (
                    <div
                      key={block.id}
                      // ✅ help 상태에 따라 클래스 추가 및 선택 상태와 결합
                      className={`placed-block ${selectedId === block.id ? 'selected' : ''} ${isCompleted ? 'completed' : ''} ${block.help ? 'help-active' : ''}`}
                      draggable
                      onDragStart={(e) => onDragStartExisting(e, block.id)}
                      onClick={(e) => { e.stopPropagation(); setSelectedId(block.id); }}
                      style={{ left: block.x, top: block.y, width: block.w * GRID_SIZE, height: block.h * GRID_SIZE, backgroundColor: block.color, '--w': block.w, '--h': block.h }}
                    >
                      {block.help && <div className="help-indicator">🙋‍♂️</div>}

                      <div className="pegs-container">
                        {Array.from({ length: block.w * block.h }).map((_, i) => <div key={i} className="lego-peg" />)}
                      </div>

                      {isVertical ? (
                        <>
                          <div className="grip-line v-left" />
                          <div className="grip-line v-right" />
                        </>
                      ) : (
                        <>
                          <div className="grip-line h-top" />
                          <div className="grip-line h-bottom" />
                        </>
                      )}
                      
                      {!isCompleted && <div className="center-dot" />}
                    </div>
                  );
                })}

              </div> 
            </div> 
          </section>

          {/* --- 엑셀 시트형 층(Level) 탭 UI --- */}
          <div className="level-tabs">
            {levels.map(lvl => (
              <div 
                key={lvl} 
                className={`level-tab ${currentLevel === lvl ? 'active' : ''}`}
                onClick={() => { setCurrentLevel(lvl); setSelectedId(null); }}
              >
                Level {lvl}
              </div>
            ))}
            <button className="level-tab add-btn" onClick={addNewLevel}>
              + Add Level
            </button>
          </div>
        </div>

        <aside className="sidebar">
          <h3>Block List</h3>
          <div className="block-list">
            {BLOCK_TYPES.map((block) => (
              <div key={block.id} className="draggable-block" draggable onDragStart={(e) => onDragStartNew(e, block)}>
                <div className="block-preview">
                  <div className="preview-shape" style={{ backgroundColor: block.color, width: `${block.w * 10}px`, height: `${block.h * 10}px`, maxWidth: '30px', maxHeight: '30px' }} />
                </div>
                <span className="block-label">{block.label}</span>
              </div>
            ))}
          </div>
          
          <div className="status-panel">

            {/* 개수 카운트도 층별 정보를 포함하도록 수정 */}
            <p>총 블록: {placedBlocks.length}개 (현재 층: {currentLevelBlocks.length}개)</p>
            
            {activeSelectedBlock && (
              <div className="edit-controls">
                <p className="selected-text">블록 선택됨</p>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {/* --- 사람의 도움(Help) 토글 버튼 --- */}
                  <button 
                    onClick={toggleHelpStatus} 
                    className={`help-btn ${activeSelectedBlock.help ? 'active' : 'inactive'}`}
                    style={{ flex: 1, margin: 0 }}
                  >
                    {activeSelectedBlock.help ? '🙋 사람 개입 켬' : '🤖 사람 개입 끔'}
                  </button>
                  <button onClick={deleteBlock} className="delete-btn" style={{ flex: 1, margin: 0 }}>선택 삭제</button>
                </div>
              </div>
            )}
            
            {/* 초기화 버튼을 두 가지(현재 층 / 전체)로 세분화 */}
            <div style={{ display: 'flex', gap: '5px', marginBottom: '10px' }}>
              <button onClick={clearCurrentLevel} className="reset-btn" style={{ flex: 1, padding: '10px 5px', fontSize: '12px' }}>현재 층 초기화</button>
              <button onClick={clearAllLevels} className="reset-btn" style={{ flex: 1, padding: '10px 5px', fontSize: '12px', backgroundColor: '#c0392b' }}>전체 초기화</button>
            </div>

            <button 
              className="publish-btn" 
              onClick={publishCurrentLevelToRobot} 
              disabled={isProcessing}
              style={{ backgroundColor: '#3498db', marginBottom: '0' }}
            >
              {isProcessing ? '전송 중...' : `Level ${currentLevel} 설계도 전송 📡`}
            </button>

            <button className="publish-btn" onClick={publishToRobot} disabled={isProcessing}>
              {isProcessing ? '전송 중...' : '전체 설계도 전송하기 🚀'}
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
};

export default BlueprintEditor;