import React, { useState, useEffect, useRef } from 'react';
// import * as ROSLIB from 'roslib';
import './App.css';

const BLOCK_TYPES = [
  { id: 'b1x2', label: '1 X 2 (세로)', w: 1, h: 2, color: '#9b59b6' },
  { id: 'b2x1', label: '2 X 1 (가로)', w: 2, h: 1, color: '#3498db' },
  { id: 'b2x2_v', label: '2 X 2 (세로)', w: 2, h: 2, color: '#f1c40f' },
  { id: 'b2x2_h', label: '2 X 2 (가로)', w: 2, h: 2, color: '#f39c12' },
  { id: 'b2x3', label: '2 X 3 (세로)', w: 2, h: 3, color: '#e67e22' },
  { id: 'b3x2', label: '3 X 2 (가로)', w: 3, h: 2, color: '#e74c3c' },
];

const CANVAS_W = 2000; // 40칸
const CANVAS_H = 1200; // 24칸
const GRID_SIZE = 50; 

// ROS 통신 및 토픽 설정
const ROS_BRIDGE_URL = 'ws://192.168.1.32:9090'; // 상황에 맞게 IP 수정 필요
const CMD_TOPIC_NAME = '/block/info'; // 봇이 구독하는 토픽명으로 수정 필요

const BlueprintEditor = () => {
  const [placedBlocks, setPlacedBlocks] = useState([]);
  const [selectedId, setSelectedId] = useState(null);

  const [levels, setLevels] = useState([1]); // 생성된 층 배열 [1, 2, 3...]
  const [currentLevel, setCurrentLevel] = useState(1); // 현재 화면에 보이는 층

  // --- 진행률 관리를 위한 상태 ---
  const [totalSentCount, setTotalSentCount] = useState(0);       // 전송한 총 블록 개수
  const [completedBlockIds, setCompletedBlockIds] = useState([]); // 로봇이 배치 완료한 ID 배열 (/signal_id)

  // 드래그 중인 블록의 정보를 저장
  const [activeDragInfo, setActiveDragInfo] = useState(null);
  // 프리뷰 위치 및 유효성 상태
  const [dragPreview, setDragPreview] = useState(null);

  // 확대/축소 상태 (기본 1.0)
  const [zoomLevel, setZoomLevel] = useState(0.8);
  const canvasAreaRef = useRef(null);

  // ROS 상태 관리
  const rosRef = useRef(null);
  const [rosStatus, setRosStatus] = useState('연결 안됨 ⚪');
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

  // 컴포넌트 마운트 시 ROS 연결
  useEffect(() => {
    connectROS();
    return () => {
      if (rosRef.current) rosRef.current.close();
    };
  }, []);

  const connectROS = () => {
    setRosStatus('연결 시도 중... 🟡');
    try {
      const ros = new ROSLIB.Ros({ url: ROS_BRIDGE_URL });
      ros.on('connection', () => {
        setRosStatus('연결 완료 🟢');
        rosRef.current = ros;

        // 로봇이 블록 배치를 완료할 때마다 보내는 ID 수신
        const signalIdTopic = new ROSLIB.Topic({
          ros: ros,
          name: '/signal_id',
          messageType: 'std_msgs/msg/Int32'
        });

        signalIdTopic.subscribe((message) => {
          console.log('[로봇 완료 응답] 놓은 블록 ID:', message.data);
          // 기존에 배열에 없는 ID면 배열에 추가하여 상태 업데이트
          setCompletedBlockIds((prev) => {
            if (!prev.includes(message.data)) return [...prev, message.data];
            return prev;
          });
        });
      });
      ros.on('error', () => setRosStatus('연결 에러 🔴'));
      ros.on('close', () => setRosStatus('연결 끊김 ⚪'));
    } catch (e) {
      setRosStatus('초기화 에러 🔴');
    }
  };

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

  // 충돌 검사 로직
  const checkOverlap = (newX, newY, newW, newH, excludeId = null) => {
    return placedBlocks.some((block) => {
      // ✅ 현재 층(currentLevel)이 아닌 블록은 충돌 검사에서 무시합니다! (겹쳐 쌓기 허용)
      if (block.level !== currentLevel) return false;

      if (excludeId && block.id === excludeId) return false;
      const isXOverlap = newX < block.x + block.w * GRID_SIZE && newX + newW * GRID_SIZE > block.x;
      const isYOverlap = newY < block.y + block.h * GRID_SIZE && newY + newH * GRID_SIZE > block.y;
      return isXOverlap && isYOverlap;
    });
  };

  // 투명한 드래그 이미지를 미리 생성해둡니다.
  const transparentImg = useRef(new Image());
  useEffect(() => {
    // 1x1 크기의 투명한 GIF 데이터
    transparentImg.current.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  }, []);

  // 1. 신규 블록 드래그 시작
  const onDragStartNew = (e, blockType) => {
    e.dataTransfer.setData('actionType', 'CREATE');
    e.dataTransfer.setData('blockType', JSON.stringify(blockType));

    // 브라우저 기본 드래그 이미지를 투명하게 설정
    if (e.dataTransfer.setDragImage) {
      e.dataTransfer.setDragImage(transparentImg.current, 0, 0);
    }

    setActiveDragInfo({ w: blockType.w, h: blockType.h, id: null });
  };

  // 2. 기존 블록 드래그 시작 (이동용)
  const onDragStartExisting = (e, id) => {
    const block = placedBlocks.find(b => b.id === id);
    e.dataTransfer.setData('actionType', 'MOVE');
    e.dataTransfer.setData('blockId', id);
    setSelectedId(id); 

    // 브라우저 기본 드래그 이미지를 투명하게 설정
    if (e.dataTransfer.setDragImage) {
      e.dataTransfer.setDragImage(transparentImg.current, 0, 0);
    }
    
    setActiveDragInfo({ w: block.w, h: block.h, id: block.id });
  };

  const onDragOver = (e) => {
    e.preventDefault();
    if (!activeDragInfo || !canvasAreaRef.current) return;

    const container = canvasAreaRef.current;
    const rect = e.currentTarget.getBoundingClientRect();

    // 브라우저 뷰포트 내 마우스 상대 좌표 (패딩 제외)
    const padding = 40;
    const offsetX = e.clientX - rect.left - padding;
    const offsetY = e.clientY - rect.top - padding;

    // 좌표 보정: (마우스 위치 + 스크롤 양) / 배율
    const mouseX = (offsetX + container.scrollLeft) / zoomLevel;
    const mouseY = (offsetY + container.scrollTop) / zoomLevel;
    
    // 블록의 중심이 마우스 끝에 오도록 좌상단(x, y) 좌표 계산
    const blockW = activeDragInfo.w * GRID_SIZE;
    const blockH = activeDragInfo.h * GRID_SIZE;

    // 중심점 기준 좌표 계산
    const newX = mouseX - blockW / 2;
    const newY = mouseY - blockH / 2;

    let snappedX = Math.round(newX / GRID_SIZE) * GRID_SIZE;
    let snappedY = Math.round(newY / GRID_SIZE) * GRID_SIZE;

    // 24x40 영역 밖으로 나가지 않도록 경계 제한
    snappedX = Math.max(0, Math.min(snappedX, CANVAS_W - blockW));
    snappedY = Math.max(0, Math.min(snappedY, CANVAS_H - blockH));

    const isOverlap = checkOverlap(snappedX, snappedY, activeDragInfo.w, activeDragInfo.h, activeDragInfo.id);

    setDragPreview({
      x: snappedX,
      y: snappedY,
      w: activeDragInfo.w,
      h: activeDragInfo.h,
      isValid: !isOverlap
    });
  };

  // const onDragLeave = () => {
  //   setDragPreview(null);
  // };

  const onDrop = (e) => {
    e.preventDefault();
    const actionType = e.dataTransfer.getData('actionType');
    
    // 드롭 시점에 프리뷰 데이터 활용
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
      alert("⚠️ 다른 블록과 겹치는 위치에는 놓을 수 없습니다.");
    }

    setDragPreview(null);
    setActiveDragInfo(null);
  };
  
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

  // 블록 타입 문자열을 숫자로 변환하는 헬퍼 함수
  const getBlockTypeNumber = (typeId) => {
    const map = {
      'b1x2': "1",   // 1x2 세로
      'b2x1': "2",   // 2x1 가로
      'b2x2_v': "3", // 2x2 세로
      'b2x2_h': "4", // 2x2 가로
      'b2x3': "5",   // 2x3 세로
      'b3x2': "6"    // 3x2 가로
    };
    return map[typeId] || "1";
  };

  // 제어 시그널(Stop/Start/Unlock) ROS 발행 함수
  const publishSignal = (topicName) => {
    if (!rosRef.current || !rosRef.current.isConnected) {
      alert("⚠️ 로봇(ROS)에 연결되어 있지 않습니다!");
      return;
    }

    const signalTopic = new ROSLIB.Topic({
      ros: rosRef.current,
      name: topicName,
      messageType: 'std_msgs/msg/Int32'
    });

    signalTopic.publish({ data: 1 });
    console.log(`[제어 신호 전송] 토픽: ${topicName}, 데이터: 1`);

    // 토픽에 따른 작업 상태 변경 로직
    if (topicName === '/signal_stop') {
      setRobotWorkingStatus('일시 정지 ⏸️');
    } else if (topicName === '/signal_start') {
      setRobotWorkingStatus('재개 🔄');
      setTimeout(() => {
        setRobotWorkingStatus('진행 중 🏗️');
      }, 1500); // 1.5초 후 진행 중으로 자연스럽게 변경
    }
  };

  // ROS로 좌표 데이터 퍼블리시
  const publishToRobot = () => {
    if (!rosRef.current || !rosRef.current.isConnected) {
      alert("⚠️ 로봇(ROS)에 연결되어 있지 않습니다!");
      return;
    }

    if (placedBlocks.length === 0) {
      alert("⚠️ 배치된 블록이 없습니다.");
      return;
    }
    setIsProcessing(true);

    // 로봇이 밑에서부터 차곡차곡 쌓을 수 있도록 정렬 (층 오름차순 -> Y축 -> X축)
    const sortedBlocks = [...placedBlocks].sort((a, b) => {
      if (a.level !== b.level) return a.level - b.level;
      if (a.y !== b.y) return a.y - b.y;
      return a.x - b.x;
    });

    const idMap = {}; // 블록의 고유 id(Date.now)에 매칭될 부여된 로봇 전송 ID (1, 2, 3...)

    // 요구사항에 맞춘 JSON 배열 데이터 생성
    const payloadData = sortedBlocks.map((block, index) => {
      // 1. 블록의 픽셀 좌표를 격자 단위(0~40, 0~24)로 변환
      const gridX = block.x / GRID_SIZE;
      const gridY = block.y / GRID_SIZE;
      
      // 2. 블록의 중심점 좌표 구하기 (격자 단위)
      const centerX = gridX + (block.w / 2);
      const centerY = gridY + (block.h / 2);

      // 3. 로봇 좌표계(0~80, 0~48)로 변환 (격자 * 2)
      const robotX = centerX * 2;
      const robotY = centerY * 2;

      const robotId = index + 1;
      idMap[block.id] = robotId; // 전송 ID 기록

      return {
        id: robotId, // 요구사항에 따른 1부터 시작하는 index
        type: getBlockTypeNumber(block.typeId),
        level: block.level,
        help: !!block.help,
        coordinate: {
          x: robotX,
          y: robotY
        }
      };
    });

    // 기존 블록 상태에 부여된 robotId 업데이트 (화면 시각화를 위함)
    setPlacedBlocks(placedBlocks.map(b => ({ ...b, robotId: idMap[b.id] })));
    // 진행률 바 초기화
    setTotalSentCount(payloadData.length);
    setCompletedBlockIds([]);

    setRobotWorkingStatus('건설중 🏗️'); // 설계도 전송 시 상태를 '진행 중'으로 설정

    const cmdTopic = new ROSLIB.Topic({
      ros: rosRef.current,
      name: CMD_TOPIC_NAME,
      messageType: 'std_msgs/String'
    });

    const jsonString = JSON.stringify(payloadData);
    
    console.log("Publishing Target Data:", jsonString);
    cmdTopic.publish({ data: jsonString });

    alert(`✅ ${placedBlocks.length}개의 블록 좌표를 전송했습니다!`);
    setIsProcessing(false);
  };

  // --- 현재 층의 좌표 데이터만 ROS로 퍼블리시 ---
const publishCurrentLevelToRobot = () => {
    if (!rosRef.current || !rosRef.current.isConnected) {
      alert("⚠️ 로봇(ROS)에 연결되어 있지 않습니다!");
      return;
    }

    // 현재 층에 해당하는 블록만 필터링
    const currentBlocks = placedBlocks.filter(b => b.level === currentLevel);

    if (currentBlocks.length === 0) {
      alert(`⚠️ 현재 층(Level ${currentLevel})에 배치된 블록이 없습니다.`);
      return;
    }

    setIsProcessing(true);

    // 현재 층 내에서만 정렬 (Y축 -> X축 순서)
    const sortedBlocks = [...currentBlocks].sort((a, b) => {
      if (a.y !== b.y) return a.y - b.y;
      return a.x - b.x;
    });

    const idMap = {};

    const payloadData = sortedBlocks.map((block, index) => {
      const gridX = block.x / GRID_SIZE;
      const gridY = block.y / GRID_SIZE;
      const centerX = gridX + (block.w / 2);
      const centerY = gridY + (block.h / 2);
      const robotX = centerX * 2;
      const robotY = centerY * 2;

      const robotId = index + 1;
      idMap[block.id] = robotId;

      return {
        id: robotId,
        type: getBlockTypeNumber(block.typeId),
        level: block.level,
        help: !!block.help,
        coordinate: { x: robotX, y: robotY }
      };
    });

    // robotId 업데이트 및 진행률 초기화
    setPlacedBlocks(placedBlocks.map(b => 
      b.level === currentLevel ? { ...b, robotId: idMap[b.id] } : b
    ));
    setTotalSentCount(payloadData.length);
    setCompletedBlockIds([]);
    setRobotWorkingStatus('건설중 🏗️');

    const cmdTopic = new ROSLIB.Topic({
      ros: rosRef.current,
      name: CMD_TOPIC_NAME,
      messageType: 'std_msgs/String'
    });

    const jsonString = JSON.stringify(payloadData);
    cmdTopic.publish({ data: jsonString });

    alert(`✅ Level ${currentLevel}의 블록 ${currentBlocks.length}개 좌표를 전송했습니다!`);
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

  // --- 설계도 저장 및 불러오기 로직 ---

// 1. 설계도를 JSON 파일로 저장 (파일명: 년_월_일_시_분)
const saveBlueprintToFile = () => {
    if (placedBlocks.length === 0) {
      alert("저장할 블록 정보가 없습니다.");
      return;
    }

    // 날짜 및 시간 데이터 추출
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const date = now.getDate();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');

    // ✅ 초를 제외한 파일명 생성 (예: JIUM_Blueprint_2026-2-25_1945.json)
    const fileName = `JIUM_Blueprint_${year}-${month}-${date}_${hours}${minutes}.json`;

    const dataToSave = {
      version: "1.0",
      savedAt: now.toISOString(),
      levels: levels,
      blocks: placedBlocks
    };

    const jsonString = JSON.stringify(dataToSave, null, 2);
    const blob = new Blob([jsonString], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = fileName; 
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // 2. JSON 파일을 읽어서 설계도 복원 (불러오기)
  const loadBlueprintFromFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const importedData = JSON.parse(event.target.result);

        // 간단한 데이터 유효성 검사
        if (!importedData.blocks || !Array.isArray(importedData.blocks)) {
          throw new Error("유효한 설계도 파일이 아닙니다.");
        }

        if (window.confirm("새 설계도를 불러오시겠습니까? 현재 작업 중인 내용은 사라집니다.")) {
          // 상태 업데이트: 블록, 층 정보, 현재 층 초기화
          setPlacedBlocks(importedData.blocks);
          setLevels(importedData.levels || [1]);
          setCurrentLevel(1); // 불러온 후 1층부터 보여줌
          setSelectedId(null);
          alert("✅ 설계도를 성공적으로 불러왔습니다!");
        }
      } catch (err) {
        alert("⚠️ 파일을 읽는 중 오류가 발생했습니다: " + err.message);
      }
    };
    reader.readAsText(file);
    
    // 같은 파일을 다시 선택할 수 있도록 input 초기화
    e.target.value = "";
  };

  return (
    <div className="project-container">
      <header className="header">
        {/* 1. 좌측 로고 영역 */}
        <div className="logo-section">
          <img src="./logo.png" alt="JIUM Logo" className="project-logo" />
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
            <button className="signal-btn btn-unlock standard" onClick={() => publishSignal('/signal_unlock')}>
              Unlock 🔓
            </button>

            {/* ✅ 물리 스위치 형태의 토글 섹션 */}
            <div 
              className={`toggle-switch-container ${robotWorkingStatus.includes('일시 정지') ? 'state-start' : 'state-stop'}`}
              onClick={() => {
                if (robotWorkingStatus.includes('일시 정지')) {
                  publishSignal('/signal_start');
                } else {
                  publishSignal('/signal_stop');
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