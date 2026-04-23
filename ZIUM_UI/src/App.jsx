import React, { useState, useEffect, useRef, useCallback } from 'react';
import './App.css';
import logoImg from './logo.png';
import { useAuth } from './hooks/useAuth';
import { useFirebaseComms } from './hooks/useFirebaseComms';
import { useBlueprints } from './hooks/useBlueprints';

const BLOCK_TYPES = [
  { id: 'b1x2', label: '1 X 2 (세로)', w: 1, h: 2, color: '#9b59b6' },
  { id: 'b2x1', label: '2 X 1 (가로)', w: 2, h: 1, color: '#3498db' },
  { id: 'b2x2_v', label: '2 X 2 (세로)', w: 2, h: 2, color: '#f1c40f' },
  { id: 'b2x2_h', label: '2 X 2 (가로)', w: 2, h: 2, color: '#f39c12' },
  { id: 'b2x3', label: '2 X 3 (세로)', w: 2, h: 3, color: '#e67e22' },
  { id: 'b3x2', label: '3 X 2 (가로)', w: 3, h: 2, color: '#e74c3c' },
];

const CANVAS_W = 2000;
const CANVAS_H = 1200;
const GRID_SIZE = 50;

const BlueprintEditor = () => {
  const [placedBlocks, setPlacedBlocks] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [levels, setLevels] = useState([1]);
  const [currentLevel, setCurrentLevel] = useState(1);
  const [totalSentCount, setTotalSentCount] = useState(0);
  const [completedBlockIds, setCompletedBlockIds] = useState([]);
  const [activeDragInfo, setActiveDragInfo] = useState(null);
  const [dragPreview, setDragPreview] = useState(null);
  const [zoomLevel, setZoomLevel] = useState(0.8);
  const canvasAreaRef = useRef(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [robotWorkingStatus, setRobotWorkingStatus] = useState('대기 중 💤');

  // ── Firebase 훅 ──────────────────────────────────────────────
  const { user, authLoading, login, logout } = useAuth();

  const handleBlockCompleted = useCallback((id) => {
    console.log('[Firebase] 배치 완료 블록 ID:', id);
    setCompletedBlockIds((prev) => {
      if (!prev.includes(id)) return [...prev, id];
      return prev;
    });
  }, []);

  const { connectionStatus, publishBlueprint, publishSignal } =
    useFirebaseComms({ onBlockCompleted: handleBlockCompleted });

  const { savedList, isLoading: blueprintLoading, saveBlueprint, fetchMyBlueprints } =
    useBlueprints(user);

  const [showBlueprintList, setShowBlueprintList] = useState(false);
  // ─────────────────────────────────────────────────────────────

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (selectedId && (e.key === 'Delete' || e.key === 'Backspace')) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        deleteBlock();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedId]);

  useEffect(() => {
    if (totalSentCount > 0 && completedBlockIds.length === totalSentCount) {
      setRobotWorkingStatus('작업 마침 ✅');
    }
  }, [completedBlockIds, totalSentCount]);

  const xAxisLabels = Array.from({ length: 81 }, (_, i) => i);
  const yAxisLabels = Array.from({ length: 49 }, (_, i) => i);

  useEffect(() => {
    const container = canvasAreaRef.current;
    if (!container) return;
    const handleNativeWheel = (e) => {
      if (e.ctrlKey) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.05 : 0.05;
        setZoomLevel(prev => Math.min(Math.max(prev + delta, 0.2), 2.0));
      }
    };
    container.addEventListener('wheel', handleNativeWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleNativeWheel);
  }, []);

  const checkOverlap = (newX, newY, newW, newH, excludeId = null) => {
    return placedBlocks.some((block) => {
      if (block.level !== currentLevel) return false;
      if (excludeId && block.id === excludeId) return false;
      const isXOverlap = newX < block.x + block.w * GRID_SIZE && newX + newW * GRID_SIZE > block.x;
      const isYOverlap = newY < block.y + block.h * GRID_SIZE && newY + newH * GRID_SIZE > block.y;
      return isXOverlap && isYOverlap;
    });
  };

  const transparentImg = useRef(new Image());
  useEffect(() => {
    transparentImg.current.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  }, []);

  const onDragStartNew = (e, blockType) => {
    e.dataTransfer.setData('actionType', 'CREATE');
    e.dataTransfer.setData('blockType', JSON.stringify(blockType));
    if (e.dataTransfer.setDragImage) e.dataTransfer.setDragImage(transparentImg.current, 0, 0);
    setActiveDragInfo({ w: blockType.w, h: blockType.h, id: null });
  };

  const onDragStartExisting = (e, id) => {
    const block = placedBlocks.find(b => b.id === id);
    e.dataTransfer.setData('actionType', 'MOVE');
    e.dataTransfer.setData('blockId', id);
    setSelectedId(id);
    if (e.dataTransfer.setDragImage) e.dataTransfer.setDragImage(transparentImg.current, 0, 0);
    setActiveDragInfo({ w: block.w, h: block.h, id: block.id });
  };

  const onDragOver = (e) => {
    e.preventDefault();
    if (!activeDragInfo || !canvasAreaRef.current) return;
    const container = canvasAreaRef.current;
    const rect = e.currentTarget.getBoundingClientRect();
    const padding = 40;
    const offsetX = e.clientX - rect.left - padding;
    const offsetY = e.clientY - rect.top - padding;
    const mouseX = (offsetX + container.scrollLeft) / zoomLevel;
    const mouseY = (offsetY + container.scrollTop) / zoomLevel;
    const blockW = activeDragInfo.w * GRID_SIZE;
    const blockH = activeDragInfo.h * GRID_SIZE;
    const newX = mouseX - blockW / 2;
    const newY = mouseY - blockH / 2;
    let snappedX = Math.round(newX / GRID_SIZE) * GRID_SIZE;
    let snappedY = Math.round(newY / GRID_SIZE) * GRID_SIZE;
    snappedX = Math.max(0, Math.min(snappedX, CANVAS_W - blockW));
    snappedY = Math.max(0, Math.min(snappedY, CANVAS_H - blockH));
    const isOverlap = checkOverlap(snappedX, snappedY, activeDragInfo.w, activeDragInfo.h, activeDragInfo.id);
    setDragPreview({ x: snappedX, y: snappedY, w: activeDragInfo.w, h: activeDragInfo.h, isValid: !isOverlap });
  };

  const onDrop = (e) => {
    e.preventDefault();
    const actionType = e.dataTransfer.getData('actionType');
    if (dragPreview && dragPreview.isValid) {
      if (actionType === 'CREATE') {
        const blockType = JSON.parse(e.dataTransfer.getData('blockType'));
        setPlacedBlocks([...placedBlocks, { ...blockType, typeId: blockType.id, id: Date.now(), x: dragPreview.x, y: dragPreview.y, level: currentLevel, help: false }]);
      } else if (actionType === 'MOVE') {
        const blockId = Number(e.dataTransfer.getData('blockId'));
        setPlacedBlocks(placedBlocks.map(block =>
          block.id === blockId ? { ...block, x: dragPreview.x, y: dragPreview.y } : block
        ));
      }
    } else if (dragPreview && !dragPreview.isValid) {
      alert('⚠️ 다른 블록과 겹치는 위치에는 놓을 수 없습니다.');
    }
    setDragPreview(null);
    setActiveDragInfo(null);
  };

  const deleteBlock = () => {
    setPlacedBlocks(placedBlocks.filter(block => block.id !== selectedId));
    setSelectedId(null);
  };

  const toggleHelpStatus = () => {
    if (!selectedId) return;
    setPlacedBlocks(placedBlocks.map(block =>
      block.id === selectedId ? { ...block, help: !block.help } : block
    ));
  };

  const clearCurrentLevel = () => {
    setPlacedBlocks(placedBlocks.filter(block => block.level !== currentLevel));
    setSelectedId(null);
  };

  const clearAllLevels = () => {
    if (window.confirm('모든 층의 설계도가 삭제됩니다. 정말 초기화하시겠습니까?')) {
      setPlacedBlocks([]);
      setLevels([1]);
      setCurrentLevel(1);
      setSelectedId(null);
      setTotalSentCount(0);
      setCompletedBlockIds([]);
      setRobotWorkingStatus('대기 중 💤');
    }
  };

  const addNewLevel = () => {
    const nextLevel = levels.length + 1;
    setLevels([...levels, nextLevel]);
    setCurrentLevel(nextLevel);
    setSelectedId(null);
  };

  const getBlockTypeNumber = (typeId) => {
    const map = { 'b1x2': '1', 'b2x1': '2', 'b2x2_v': '3', 'b2x2_h': '4', 'b2x3': '5', 'b3x2': '6' };
    return map[typeId] || '1';
  };

  // ── Firebase 신호 발행 ────────────────────────────────────────
  const handleSignal = async (topicName) => {
    const signalKey = topicName.replace('/', ''); // '/signal_stop' → 'signal_stop'
    try {
      await publishSignal(signalKey);
      if (topicName === '/signal_stop') setRobotWorkingStatus('일시 정지 ⏸️');
      else if (topicName === '/signal_start') {
        setRobotWorkingStatus('재개 🔄');
        setTimeout(() => setRobotWorkingStatus('진행 중 🏗️'), 1500);
      }
    } catch (e) {
      alert('신호 전송 실패: ' + e.message);
    }
  };

  const buildPayload = (blocks) => {
    const idMap = {};
    const sortedBlocks = [...blocks].sort((a, b) => {
      if (a.level !== b.level) return a.level - b.level;
      if (a.y !== b.y) return a.y - b.y;
      return a.x - b.x;
    });
    const payloadData = sortedBlocks.map((block, index) => {
      const gridX = block.x / GRID_SIZE;
      const gridY = block.y / GRID_SIZE;
      const centerX = gridX + block.w / 2;
      const centerY = gridY + block.h / 2;
      const robotId = index + 1;
      idMap[block.id] = robotId;
      return {
        id: robotId,
        type: getBlockTypeNumber(block.typeId),
        level: block.level,
        help: !!block.help,
        coordinate: { x: centerX * 2, y: centerY * 2 },
      };
    });
    return { payloadData, idMap };
  };

  // 전체 설계도 Firebase로 전송
  const publishToRobot = async () => {
    if (!placedBlocks.length) { alert('⚠️ 배치된 블록이 없습니다.'); return; }
    setIsProcessing(true);
    const { payloadData, idMap } = buildPayload(placedBlocks);
    setPlacedBlocks(placedBlocks.map(b => ({ ...b, robotId: idMap[b.id] })));
    setTotalSentCount(payloadData.length);
    setCompletedBlockIds([]);
    setRobotWorkingStatus('건설중 🏗️');
    try {
      await publishBlueprint(payloadData);
      alert(`✅ ${placedBlocks.length}개의 블록 좌표를 Firebase로 전송했습니다!`);
    } catch (e) {
      alert('전송 실패: ' + e.message);
    } finally {
      setIsProcessing(false);
    }
  };

  // 현재 층만 Firebase로 전송
  const publishCurrentLevelToRobot = async () => {
    const currentBlocks = placedBlocks.filter(b => b.level === currentLevel);
    if (!currentBlocks.length) { alert(`⚠️ 현재 층(Level ${currentLevel})에 배치된 블록이 없습니다.`); return; }
    setIsProcessing(true);
    const { payloadData, idMap } = buildPayload(currentBlocks);
    setPlacedBlocks(placedBlocks.map(b => b.level === currentLevel ? { ...b, robotId: idMap[b.id] } : b));
    setTotalSentCount(payloadData.length);
    setCompletedBlockIds([]);
    setRobotWorkingStatus('건설중 🏗️');
    try {
      await publishBlueprint(payloadData);
      alert(`✅ Level ${currentLevel}의 블록 ${currentBlocks.length}개를 Firebase로 전송했습니다!`);
    } catch (e) {
      alert('전송 실패: ' + e.message);
    } finally {
      setIsProcessing(false);
    }
  };
  // ─────────────────────────────────────────────────────────────

  // ── Firestore 설계도 저장/불러오기 ────────────────────────────
  const handleSaveToCloud = async () => {
    const name = prompt('설계도 이름을 입력하세요:', `설계도_${new Date().toLocaleString('ko-KR')}`);
    if (name === null) return;
    await saveBlueprint(name, levels, placedBlocks);
  };

  const handleOpenBlueprintList = async () => {
    await fetchMyBlueprints();
    setShowBlueprintList(true);
  };

  const handleLoadBlueprint = (bp) => {
    if (window.confirm(`"${bp.name}" 설계도를 불러오시겠습니까? 현재 작업 내용은 사라집니다.`)) {
      setPlacedBlocks(bp.blocks);
      setLevels(bp.levels || [1]);
      setCurrentLevel(1);
      setSelectedId(null);
      setShowBlueprintList(false);
    }
  };
  // ─────────────────────────────────────────────────────────────

  const isBlockVertical = (block) => {
    if (!block || !block.h || !block.w) return false;
    if (block.h > block.w) return true;
    if (block.typeId && typeof block.typeId === 'string' && block.typeId.endsWith('_v')) return true;
    return false;
  };

  const currentLevelBlocks = placedBlocks.filter(b => b.level === currentLevel);
  const previousLevelBlocks = placedBlocks.filter(b => b.level === currentLevel - 1);
  const progressPercent = totalSentCount === 0 ? 0 : Math.round((completedBlockIds.length / totalSentCount) * 100);
  const activeSelectedBlock = placedBlocks.find(b => b.id === selectedId);

  if (authLoading) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#fff', background: '#1a1a2e' }}>Firebase 초기화 중...</div>;
  }

  return (
    <div className="project-container">
      <header className="header">
        {/* 좌측 로고 */}
        <div className="logo-section">
          <img src={logoImg} alt="JIUM Logo" className="project-logo" />
          <div className="title-group">
            <h1 className="main-title">JIUM</h1>
            <span className="sub-title">Blueprint Designer</span>
          </div>
        </div>

        {/* 중앙: 파일 관리 + 진행률 */}
        <div className="center-management-zone">
          <div className="header-file-controls">
            {user ? (
              <>
                <button onClick={handleSaveToCloud} className="header-file-btn save" disabled={blueprintLoading}>
                  ☁️ 클라우드 저장
                </button>
                <button onClick={handleOpenBlueprintList} className="header-file-btn load" disabled={blueprintLoading}>
                  📂 설계도 목록
                </button>
                <button onClick={logout} className="header-file-btn" style={{ background: '#555' }}>
                  {user.displayName?.split(' ')[0]} 로그아웃
                </button>
              </>
            ) : (
              <button onClick={login} className="header-file-btn save">
                🔑 Google 로그인
              </button>
            )}
          </div>

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

        {/* 우측: 상태 + 제어 */}
        <div className="robot-controls">
          <div className="status-monitor">
            <div className={`status-card ros-card ${connectionStatus.includes('에러') ? 'error-card' : ''}`}>
              <span className="card-label">FIREBASE</span>
              <span className="card-value">
                {connectionStatus.includes('완료') ? 'Connected' :
                  connectionStatus.includes('시도') ? 'Connecting...' : 'Disconnected'}
              </span>
            </div>
            <div className={`status-card work-card ${robotWorkingStatus.includes('마침') ? 'completed-card' : ''}`}>
              <span className="card-label">ROBOT STATE</span>
              <span className="card-value">{robotWorkingStatus}</span>
            </div>
          </div>

          <div className="control-actions">
            <button className="signal-btn btn-unlock standard" onClick={() => handleSignal('/signal_unlock')}>
              Unlock 🔓
            </button>
            <div
              className={`toggle-switch-container ${robotWorkingStatus.includes('일시 정지') ? 'state-start' : 'state-stop'}`}
              onClick={() => {
                if (robotWorkingStatus.includes('일시 정지')) handleSignal('/signal_start');
                else handleSignal('/signal_stop');
              }}
            >
              <div className="switch-label stop-label">Stop 🛑</div>
              <div className="switch-label start-label">Start ▶️</div>
              <div className="switch-handle">
                {robotWorkingStatus.includes('일시 정지') ? 'Start' : 'Stop'}
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Firestore 설계도 목록 모달 */}
      {showBlueprintList && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#1e1e2e', borderRadius: '12px', padding: '24px', minWidth: '400px', maxHeight: '60vh', overflowY: 'auto', color: '#fff' }}>
            <h3 style={{ marginTop: 0 }}>☁️ 저장된 설계도</h3>
            {savedList.length === 0 ? (
              <p style={{ color: '#aaa' }}>저장된 설계도가 없습니다.</p>
            ) : (
              savedList.map(bp => (
                <div key={bp.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px', borderBottom: '1px solid #333' }}>
                  <div>
                    <div style={{ fontWeight: 'bold' }}>{bp.name}</div>
                    <div style={{ fontSize: '12px', color: '#aaa' }}>블록 {bp.blocks?.length}개</div>
                  </div>
                  <button onClick={() => handleLoadBlueprint(bp)} style={{ background: '#3498db', color: '#fff', border: 'none', borderRadius: '6px', padding: '6px 12px', cursor: 'pointer' }}>
                    불러오기
                  </button>
                </div>
              ))
            )}
            <button onClick={() => setShowBlueprintList(false)} style={{ marginTop: '16px', background: '#555', color: '#fff', border: 'none', borderRadius: '6px', padding: '8px 16px', cursor: 'pointer', width: '100%' }}>
              닫기
            </button>
          </div>
        </div>
      )}

      <div className="main-layout">
        <div className="canvas-container">
          <section
            className="canvas-area"
            ref={canvasAreaRef}
            onDragOver={onDragOver}
            onDrop={onDrop}
            onDragLeave={() => setDragPreview(null)}
            onClick={() => setSelectedId(null)}
          >
            <div className="scroll-boundary" style={{ width: `${CANVAS_W * zoomLevel + 30}px`, height: `${CANVAS_H * zoomLevel + 25}px` }}>
              <div className="ruler-corner"></div>
              <div className="axis-x-sticky">
                <div className="label-container" style={{ width: (CANVAS_W * zoomLevel) + 100, position: 'relative', height: '100%' }}>
                  {xAxisLabels.map(num => (
                    <span key={`x-${num}`} className={`axis-label ${num % 2 === 0 ? 'even' : 'odd'}`} style={{ left: num * 25 * zoomLevel }}>{num}</span>
                  ))}
                </div>
              </div>
              <div className="axis-y-sticky">
                <div className="label-container" style={{ height: (CANVAS_H * zoomLevel) + 100, position: 'relative', width: '100%' }}>
                  {yAxisLabels.map(num => (
                    <span key={`y-${num}`} className={`axis-label ${num % 2 === 0 ? 'even' : 'odd'}`} style={{ top: num * 25 * zoomLevel }}>{num}</span>
                  ))}
                </div>
              </div>

              <div className="zoom-wrapper" style={{ transform: `scale(${zoomLevel})` }}>
                <div className="grid-overlay"></div>

                {dragPreview && (
                  <div className={`drag-preview ${dragPreview.isValid ? 'valid' : 'invalid'}`}
                    style={{ left: dragPreview.x, top: dragPreview.y, width: dragPreview.w * GRID_SIZE, height: dragPreview.h * GRID_SIZE }}>
                    <div className="center-dot guide" />
                  </div>
                )}

                {previousLevelBlocks.map((block) => {
                  const isCompleted = block.robotId && completedBlockIds.includes(block.robotId);
                  const isVertical = isBlockVertical(block);
                  return (
                    <div key={`ghost-${block.id}`}
                      className={`placed-block ghost-block ${isCompleted ? 'completed' : ''} ${block.help ? 'help-active' : ''}`}
                      style={{ left: block.x, top: block.y, width: block.w * GRID_SIZE, height: block.h * GRID_SIZE, backgroundColor: block.color, '--w': block.w, '--h': block.h }}>
                      {block.help && <div className="help-indicator">🙋‍♂️</div>}
                      <div className="pegs-container">
                        {Array.from({ length: block.w * block.h }).map((_, i) => <div key={i} className="lego-peg" />)}
                      </div>
                      {isVertical ? (<><div className="grip-line v-left" /><div className="grip-line v-right" /></>) : (<><div className="grip-line h-top" /><div className="grip-line h-bottom" /></>)}
                    </div>
                  );
                })}

                {currentLevelBlocks.map((block) => {
                  const isCompleted = block.robotId && completedBlockIds.includes(block.robotId);
                  const isVertical = isBlockVertical(block);
                  return (
                    <div key={block.id}
                      className={`placed-block ${selectedId === block.id ? 'selected' : ''} ${isCompleted ? 'completed' : ''} ${block.help ? 'help-active' : ''}`}
                      draggable
                      onDragStart={(e) => onDragStartExisting(e, block.id)}
                      onClick={(e) => { e.stopPropagation(); setSelectedId(block.id); }}
                      style={{ left: block.x, top: block.y, width: block.w * GRID_SIZE, height: block.h * GRID_SIZE, backgroundColor: block.color, '--w': block.w, '--h': block.h }}>
                      {block.help && <div className="help-indicator">🙋‍♂️</div>}
                      <div className="pegs-container">
                        {Array.from({ length: block.w * block.h }).map((_, i) => <div key={i} className="lego-peg" />)}
                      </div>
                      {isVertical ? (<><div className="grip-line v-left" /><div className="grip-line v-right" /></>) : (<><div className="grip-line h-top" /><div className="grip-line h-bottom" /></>)}
                      {!isCompleted && <div className="center-dot" />}
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          <div className="level-tabs">
            {levels.map(lvl => (
              <div key={lvl} className={`level-tab ${currentLevel === lvl ? 'active' : ''}`}
                onClick={() => { setCurrentLevel(lvl); setSelectedId(null); }}>
                Level {lvl}
              </div>
            ))}
            <button className="level-tab add-btn" onClick={addNewLevel}>+ Add Level</button>
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
            <p>총 블록: {placedBlocks.length}개 (현재 층: {currentLevelBlocks.length}개)</p>

            {activeSelectedBlock && (
              <div className="edit-controls">
                <p className="selected-text">블록 선택됨</p>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={toggleHelpStatus}
                    className={`help-btn ${activeSelectedBlock.help ? 'active' : 'inactive'}`}
                    style={{ flex: 1, margin: 0 }}>
                    {activeSelectedBlock.help ? '🙋 사람 개입 켬' : '🤖 사람 개입 끔'}
                  </button>
                  <button onClick={deleteBlock} className="delete-btn" style={{ flex: 1, margin: 0 }}>선택 삭제</button>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: '5px', marginBottom: '10px' }}>
              <button onClick={clearCurrentLevel} className="reset-btn" style={{ flex: 1, padding: '10px 5px', fontSize: '12px' }}>현재 층 초기화</button>
              <button onClick={clearAllLevels} className="reset-btn" style={{ flex: 1, padding: '10px 5px', fontSize: '12px', backgroundColor: '#c0392b' }}>전체 초기화</button>
            </div>

            <button className="publish-btn" onClick={publishCurrentLevelToRobot} disabled={isProcessing}
              style={{ backgroundColor: '#3498db', marginBottom: '0' }}>
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
