/**
 * 主控制器 — 串联语音识别 → NLU → 绘图 → 反馈
 */

const App = (() => {
  // ---------- 状态 ----------
  let isProcessing = false;      // 正在等待 NLU 返回
  let pendingText = null;        // 处理中的排队指令（最多存 1 条）

  // ---------- 初始化 ----------
  function init() {
    console.log('[App] 初始化...');

    // 绑定麦克风按钮
    const micBtn = document.getElementById('micBtn');
    if (micBtn) {
      micBtn.addEventListener('click', () => {
        SpeechRecognizer.toggle();
      });
    }

    // 绑定清空按钮
    const clearBtn = document.getElementById('clearBtn');
    if (clearBtn) {
      clearBtn.addEventListener('click', handleClearCanvas);
    }

    // --- 语音识别结果 ---
    window.addEventListener('speech:final', (event) => {
      const text = event.detail.text;
      console.log('[App] 收到语音:', text);

      // 本地快捷命令 — 不经过 LLM，直接执行
      if (handleLocalCommand(text)) {
        return;
      }

      // 需要 LLM 理解的命令 → 发送 NLU 请求
      sendToNLU(text);
    });

    // --- 网络事件 ---
    window.addEventListener('network:connected', () => {
      addLog('🔗', '已连接到服务器');
    });

    window.addEventListener('network:nlu_result', (event) => {
      isProcessing = false;
      const { commands } = event.detail;

      if (!commands || commands.length === 0) {
        addLog('⚠️', 'LLM 返回了空命令');
        SpeechSynthesizer.speak('抱歉，我没理解');
        processPending();
        return;
      }

      // 遍历执行命令
      commands.forEach((cmd, index) => {
        executeCommand(cmd, index === commands.length - 1);
      });

      // 处理排队中的下一条指令
      processPending();
    });

    window.addEventListener('network:nlu_error', (event) => {
      isProcessing = false;
      const { error, fallback } = event.detail;
      addLog('❌', error);
      SpeechSynthesizer.speak(fallback);
      processPending();
    });

    // --- 语音错误 ---
    window.addEventListener('speech:error', (event) => {
      const { error, message } = event.detail;
      addLog('❌', `[${error}] ${message}`);
    });

    // 从 localStorage 恢复图谱并重绘画布
    const count = SceneGraph.getObjectCount();
    if (count > 0) {
      redrawCanvas();
      updateCanvasHint(false);
      addLog('📂', `已恢复 ${count} 个图形`);
    } else {
      updateCanvasHint(true);
    }
    updateToolDisplay();

    console.log('[App] 初始化完成 (图形数:', count, ')');
    addLog('💡', '系统就绪，点击麦克风按钮开始绘画');
  }

  // ---------- 本地快捷命令 ----------
  function handleLocalCommand(text) {
    const cmd = text.trim();

    // 清空画布
    if (cmd === '清除' || cmd === '清空' || cmd === '清空画布') {
      handleClearCanvas();
      return true;
    }

    // 切换填充
    if (cmd === '实心' || cmd === '填充') {
      SceneGraph.setCurrentFill(true);
      updateToolDisplay();
      addLog('🔧', '切换为实心填充');
      SpeechSynthesizer.speak('已切换为实心');
      return true;
    }
    if (cmd === '空心' || cmd === '描边') {
      SceneGraph.setCurrentFill(false);
      updateToolDisplay();
      addLog('🔧', '切换为空心描边');
      SpeechSynthesizer.speak('已切换为空心');
      return true;
    }

    return false;
  }

  function handleClearCanvas() {
    CanvasEngine.clear();
    SceneGraph.clear();
    updateCanvasHint(true);
    addLog('🧹', '画布已清空');
    SpeechSynthesizer.speak('画布已清空');
  }

  // ---------- NLU 请求 ----------
  function sendToNLU(text) {
    if (isProcessing) {
      // 并发保护：存下最新的一条，处理完再发
      pendingText = text;
      addLog('⏳', `排队中: "${text}"`);
      return;
    }

    // 检查连接状态
    if (!Network.isConnected()) {
      addLog('❌', '未连接到服务器，请确认后端已启动');
      SpeechSynthesizer.speak('服务器未连接');
      return;
    }

    isProcessing = true;
    const context = SceneGraph.toLLMContext();
    const reqId = Network.sendNLURequest(text, context);

    if (reqId) {
      addLog('📤', `"${text}"`);
      updateConnectionStatus('processing');
    } else {
      isProcessing = false;
    }
  }

  /** 处理排队中的指令 */
  function processPending() {
    updateConnectionStatus('connected');
    if (pendingText) {
      const text = pendingText;
      pendingText = null;
      console.log('[App] 处理排队指令:', text);
      sendToNLU(text);
    }
  }

  // ---------- 命令执行 ----------

  /** action 名称规范化：容错 LLM 返回的各种变体 */
  function normalizeAction(raw) {
    if (!raw) return 'unknown';
    const a = raw.trim();
    // 精确匹配映射表：LLM 可能返回的各种写法 → 标准名
    const aliasMap = {
      // 基本形状
      'drawcircle': 'drawCircle', 'circle': 'drawCircle', '画圆': 'drawCircle',
      'drawrectangle': 'drawRectangle', 'rectangle': 'drawRectangle', 'rect': 'drawRectangle', '画矩形': 'drawRectangle', '正方形': 'drawRectangle',
      'drawtriangle': 'drawTriangle', 'triangle': 'drawTriangle', '画三角形': 'drawTriangle',
      'drawline': 'drawLine', 'line': 'drawLine', '画线': 'drawLine',
      'drawellipse': 'drawEllipse', 'ellipse': 'drawEllipse', 'oval': 'drawEllipse', '画椭圆': 'drawEllipse',
      'drawstar': 'drawStar', 'star': 'drawStar', '五角星': 'drawStar', '画星': 'drawStar',
      'drawheart': 'drawHeart', 'heart': 'drawHeart', '心形': 'drawHeart', '画心': 'drawHeart',
      // 复合图形
      'drawsun': 'drawSun', 'sun': 'drawSun', '太阳': 'drawSun',
      'drawhouse': 'drawHouse', 'house': 'drawHouse', '房子': 'drawHouse',
      'drawtree': 'drawTree', 'tree': 'drawTree', '树': 'drawTree',
      'drawflower': 'drawFlower', 'flower': 'drawFlower', '花': 'drawFlower',
      // 其他
      'clearcanvas': 'clearCanvas', 'clear': 'clearCanvas', '清空': 'clearCanvas',
      'unknown': 'unknown',
    };
    // 去掉空格、下划线、连字符后小写匹配
    const key = a.replace(/[\s_-]/g, '').toLowerCase();
    if (aliasMap[key]) return aliasMap[key];
    // 模糊匹配：包含关键词
    if (key.includes('circle') || key.includes('圆')) return 'drawCircle';
    if (key.includes('rect') || key.includes('矩形') || key.includes('正方')) return 'drawRectangle';
    if (key.includes('triangle') || key.includes('三角')) return 'drawTriangle';
    if (key.includes('line') || key.includes('线')) return 'drawLine';
    if (key.includes('ellipse') || key.includes('椭圆') || key.includes('oval')) return 'drawEllipse';
    if (key.includes('star') || key.includes('星') || key.includes('五角')) return 'drawStar';
    if (key.includes('heart') || key.includes('心')) return 'drawHeart';
    if (key.includes('sun') || key.includes('太阳')) return 'drawSun';
    if (key.includes('house') || key.includes('房子')) return 'drawHouse';
    if (key.includes('tree') || key.includes('树')) return 'drawTree';
    if (key.includes('flower') || key.includes('花')) return 'drawFlower';
    if (key.includes('clear') || key.includes('清空') || key.includes('清除')) return 'clearCanvas';
    return 'unknown';
  }

  function executeCommand(cmd, isLast) {
    // 容错：规范化 action 名称
    cmd.action = normalizeAction(cmd.action);
    console.log('[App] 执行命令:', cmd.action, cmd);

    switch (cmd.action) {
      // === 基本形状 ===
      case 'drawCircle':
        addLog('🟢', `画圆形: ${cmd.label || ''}`);
        SceneGraph.addObject({
          type: 'circle',
          label: cmd.label || '圆形',
          bbox: { x: cmd.x - (cmd.radius || 50), y: cmd.y - (cmd.radius || 50), width: (cmd.radius || 50) * 2, height: (cmd.radius || 50) * 2 },
          center: { x: cmd.x, y: cmd.y },
          color: cmd.color || SceneGraph.getCurrentColor(),
          fill: cmd.fill !== undefined ? cmd.fill : SceneGraph.getCurrentFill(),
          strokeWidth: cmd.strokeWidth || SceneGraph.getCurrentStrokeWidth(),
          params: { radius: cmd.radius || 50 },
        });
        break;

      case 'drawRectangle':
        addLog('🟦', `画矩形: ${cmd.label || ''}`);
        SceneGraph.addObject({
          type: 'rectangle',
          label: cmd.label || '矩形',
          bbox: { x: cmd.x, y: cmd.y, width: cmd.width || 100, height: cmd.height || 80 },
          center: { x: (cmd.x || 0) + (cmd.width || 100) / 2, y: (cmd.y || 0) + (cmd.height || 80) / 2 },
          color: cmd.color || SceneGraph.getCurrentColor(),
          fill: cmd.fill !== undefined ? cmd.fill : SceneGraph.getCurrentFill(),
          strokeWidth: cmd.strokeWidth || SceneGraph.getCurrentStrokeWidth(),
          params: {},
        });
        break;

      case 'drawTriangle':
        addLog('🔺', `画三角形: ${cmd.label || ''}`);
        SceneGraph.addObject({
          type: 'triangle',
          label: cmd.label || '三角形',
          bbox: { x: (cmd.x || 0) - (cmd.size || 80) / 2, y: (cmd.y || 0) - (cmd.size || 80) / 2, width: cmd.size || 80, height: cmd.size || 80 },
          center: { x: cmd.x, y: cmd.y },
          color: cmd.color || SceneGraph.getCurrentColor(),
          fill: cmd.fill !== undefined ? cmd.fill : SceneGraph.getCurrentFill(),
          strokeWidth: cmd.strokeWidth || SceneGraph.getCurrentStrokeWidth(),
          params: { size: cmd.size || 80 },
        });
        break;

      case 'drawLine':
        addLog('📏', `画直线: ${cmd.label || ''}`);
        SceneGraph.addObject({
          type: 'line',
          label: cmd.label || '直线',
          bbox: {
            x: Math.min(cmd.x1 || 0, cmd.x2 || 0),
            y: Math.min(cmd.y1 || 0, cmd.y2 || 0),
            width: Math.abs((cmd.x2 || 0) - (cmd.x1 || 0)),
            height: Math.abs((cmd.y2 || 0) - (cmd.y1 || 0)),
          },
          center: { x: ((cmd.x1 || 0) + (cmd.x2 || 0)) / 2, y: ((cmd.y1 || 0) + (cmd.y2 || 0)) / 2 },
          color: cmd.color || SceneGraph.getCurrentColor(),
          fill: false,
          strokeWidth: cmd.strokeWidth || SceneGraph.getCurrentStrokeWidth(),
          params: { x1: cmd.x1, y1: cmd.y1, x2: cmd.x2, y2: cmd.y2 },
        });
        break;

      case 'drawEllipse':
        addLog('🟡', `画椭圆: ${cmd.label || ''}`);
        SceneGraph.addObject({
          type: 'ellipse',
          label: cmd.label || '椭圆',
          bbox: { x: (cmd.x || 0) - (cmd.radiusX || 60), y: (cmd.y || 0) - (cmd.radiusY || 40), width: (cmd.radiusX || 60) * 2, height: (cmd.radiusY || 40) * 2 },
          center: { x: cmd.x, y: cmd.y },
          color: cmd.color || SceneGraph.getCurrentColor(),
          fill: cmd.fill !== undefined ? cmd.fill : SceneGraph.getCurrentFill(),
          strokeWidth: cmd.strokeWidth || SceneGraph.getCurrentStrokeWidth(),
          params: { radiusX: cmd.radiusX || 60, radiusY: cmd.radiusY || 40 },
        });
        break;

      case 'drawStar':
        addLog('⭐', `画星形: ${cmd.label || ''}`);
        SceneGraph.addObject({
          type: 'star',
          label: cmd.label || '星形',
          bbox: { x: (cmd.x || 0) - (cmd.outerRadius || 50), y: (cmd.y || 0) - (cmd.outerRadius || 50), width: (cmd.outerRadius || 50) * 2, height: (cmd.outerRadius || 50) * 2 },
          center: { x: cmd.x, y: cmd.y },
          color: cmd.color || SceneGraph.getCurrentColor(),
          fill: cmd.fill !== undefined ? cmd.fill : SceneGraph.getCurrentFill(),
          strokeWidth: cmd.strokeWidth || SceneGraph.getCurrentStrokeWidth(),
          params: { outerRadius: cmd.outerRadius || 50, innerRadius: cmd.innerRadius || 20, points: cmd.points || 5 },
        });
        break;

      case 'drawHeart':
        addLog('❤️', `画心形: ${cmd.label || ''}`);
        SceneGraph.addObject({
          type: 'heart',
          label: cmd.label || '心形',
          bbox: { x: (cmd.x || 0) - (cmd.size || 60) / 2, y: (cmd.y || 0) - (cmd.size || 60) / 2, width: cmd.size || 60, height: cmd.size || 60 },
          center: { x: cmd.x, y: cmd.y },
          color: cmd.color || SceneGraph.getCurrentColor(),
          fill: cmd.fill !== undefined ? cmd.fill : SceneGraph.getCurrentFill(),
          strokeWidth: cmd.strokeWidth || SceneGraph.getCurrentStrokeWidth(),
          params: { size: cmd.size || 60 },
        });
        break;

      // === 复合图形 ===
      case 'drawSun':
        addLog('☀️', `画太阳: ${cmd.label || ''}`);
        SceneGraph.addObject({
          type: 'sun',
          label: cmd.label || '太阳',
          bbox: { x: (cmd.x || 0) - (cmd.radius || 60), y: (cmd.y || 0) - (cmd.radius || 60), width: (cmd.radius || 60) * 2, height: (cmd.radius || 60) * 2 },
          center: { x: cmd.x, y: cmd.y },
          color: cmd.color || '#FFFF00',
          fill: true,
          strokeWidth: cmd.strokeWidth || 2,
          params: { radius: cmd.radius || 60 },
        });
        break;

      case 'drawHouse':
        addLog('🏠', `画房子: ${cmd.label || ''}`);
        SceneGraph.addObject({
          type: 'house',
          label: cmd.label || '房子',
          bbox: { x: cmd.x, y: cmd.y, width: cmd.width || 150, height: cmd.height || 150 },
          center: { x: (cmd.x || 0) + (cmd.width || 150) / 2, y: (cmd.y || 0) + (cmd.height || 150) / 2 },
          color: cmd.color || '#8B4513',
          fill: true,
          strokeWidth: cmd.strokeWidth || 2,
          params: { width: cmd.width || 150, height: cmd.height || 150 },
        });
        break;

      case 'drawTree':
        addLog('🌳', `画树: ${cmd.label || ''}`);
        SceneGraph.addObject({
          type: 'tree',
          label: cmd.label || '树',
          bbox: { x: (cmd.x || 0) - 40, y: (cmd.y || 0) - (cmd.height || 150), width: 80, height: cmd.height || 150 },
          center: { x: cmd.x, y: cmd.y },
          color: cmd.color || '#008000',
          fill: true,
          strokeWidth: cmd.strokeWidth || 2,
          params: { height: cmd.height || 150 },
        });
        break;

      case 'drawFlower':
        addLog('🌸', `画花: ${cmd.label || ''}`);
        SceneGraph.addObject({
          type: 'flower',
          label: cmd.label || '花',
          bbox: { x: (cmd.x || 0) - (cmd.size || 40) / 2, y: (cmd.y || 0) - (cmd.size || 40), width: cmd.size || 40, height: cmd.size || 40 * 2 },
          center: { x: cmd.x, y: cmd.y },
          color: cmd.color || '#FFC0CB',
          fill: true,
          strokeWidth: cmd.strokeWidth || 2,
          params: { size: cmd.size || 40 },
        });
        break;

      case 'clearCanvas':
        addLog('🧹', '清空画布');
        SceneGraph.clear();
        break;

      case 'unknown':
        addLog('🤷', '无法识别的指令');
        SpeechSynthesizer.speak('抱歉，我没听懂，请再说一遍');
        break;

      default:
        console.warn('[App] 未知 action:', cmd.action);
        break;
    }

    updateCanvasHint(SceneGraph.getObjectCount() === 0);

    // 重绘画布（阶段四用 shapes.js 实际绘制）
    redrawCanvas();

    // TTS 反馈（最后一条命令播报）
    if (isLast && cmd.action !== 'unknown') {
      const feedback = getFeedbackText(cmd);
      SpeechSynthesizer.speak(feedback);
      addLog('🔊', feedback);
    }
  }

  // ---------- 画布重绘 ----------
  function redrawCanvas() {
    const ctx = CanvasEngine.getCtx();
    if (!ctx) return;

    CanvasEngine.clear();
    const allObjects = SceneGraph.getAll();
    // 按 zIndex 排序
    allObjects.sort((a, b) => a.zIndex - b.zIndex);

    allObjects.forEach(obj => {
      drawObject(ctx, obj);
    });
  }

  function drawObject(ctx, obj) {
    // 阶段四 shapes.js 就位后，这里调用对应的 drawXxx()
    // 目前先用简单的临时绘制（后续会被 shapes.js 替换）
    ctx.save();
    ctx.strokeStyle = obj.color;
    ctx.fillStyle = obj.color;
    ctx.lineWidth = obj.strokeWidth;

    switch (obj.type) {
      case 'circle':
        ctx.beginPath();
        ctx.arc(obj.center.x, obj.center.y, obj.params.radius, 0, Math.PI * 2);
        if (obj.fill) ctx.fill(); else ctx.stroke();
        break;
      case 'rectangle':
        if (obj.fill) ctx.fillRect(obj.bbox.x, obj.bbox.y, obj.bbox.width, obj.bbox.height);
        else ctx.strokeRect(obj.bbox.x, obj.bbox.y, obj.bbox.width, obj.bbox.height);
        break;
      case 'triangle':
        drawTriangleImpl(ctx, obj);
        break;
      case 'line':
        ctx.beginPath();
        ctx.moveTo(obj.params.x1, obj.params.y1);
        ctx.lineTo(obj.params.x2, obj.params.y2);
        ctx.stroke();
        break;
      case 'ellipse':
        ctx.beginPath();
        ctx.ellipse(obj.center.x, obj.center.y, obj.params.radiusX, obj.params.radiusY, 0, 0, Math.PI * 2);
        if (obj.fill) ctx.fill(); else ctx.stroke();
        break;
      case 'star':
        drawStarImpl(ctx, obj);
        break;
      case 'heart':
        drawHeartImpl(ctx, obj);
        break;
      case 'sun':
        drawSunImpl(ctx, obj);
        break;
      case 'house':
        drawHouseImpl(ctx, obj);
        break;
      case 'tree':
        drawTreeImpl(ctx, obj);
        break;
      case 'flower':
        drawFlowerImpl(ctx, obj);
        break;
      default:
        break;
    }
    ctx.restore();
  }

  // 临时绘制函数（阶段四移到 shapes.js）
  function drawTriangleImpl(ctx, obj) {
    const s = obj.params.size || 80;
    const cx = obj.center.x, cy = obj.center.y;
    const h = s * Math.sqrt(3) / 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy - h * 0.6);
    ctx.lineTo(cx - s / 2, cy + h * 0.4);
    ctx.lineTo(cx + s / 2, cy + h * 0.4);
    ctx.closePath();
    if (obj.fill) ctx.fill(); else ctx.stroke();
  }

  function drawStarImpl(ctx, obj) {
    const cx = obj.center.x, cy = obj.center.y;
    const outerR = obj.params.outerRadius || 50;
    const innerR = obj.params.innerRadius || 20;
    const points = obj.params.points || 5;
    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const r = i % 2 === 0 ? outerR : innerR;
      const angle = (i * Math.PI) / points - Math.PI / 2;
      const x = cx + r * Math.cos(angle);
      const y = cy + r * Math.sin(angle);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    if (obj.fill) ctx.fill(); else ctx.stroke();
  }

  function drawHeartImpl(ctx, obj) {
    const cx = obj.center.x, cy = obj.center.y;
    const s = (obj.params.size || 60) / 60;
    ctx.beginPath();
    ctx.moveTo(cx, cy + 15 * s);
    ctx.bezierCurveTo(cx - 30 * s, cy - 5 * s, cx - 20 * s, cy - 30 * s, cx, cy - 15 * s);
    ctx.bezierCurveTo(cx + 20 * s, cy - 30 * s, cx + 30 * s, cy - 5 * s, cx, cy + 15 * s);
    if (obj.fill) ctx.fill(); else ctx.stroke();
  }

  function drawSunImpl(ctx, obj) {
    const { x, y } = obj.center;
    const r = obj.params.radius || 60;
    // 圆形本体
    ctx.beginPath();
    ctx.arc(x, y, r * 0.6, 0, Math.PI * 2);
    if (obj.fill) ctx.fill(); else ctx.stroke();
    // 光芒
    ctx.lineWidth = obj.strokeWidth;
    for (let i = 0; i < 8; i++) {
      const angle = (i * Math.PI * 2) / 8;
      const x1 = x + r * 0.7 * Math.cos(angle);
      const y1 = y + r * 0.7 * Math.sin(angle);
      const x2 = x + r * Math.cos(angle);
      const y2 = y + r * Math.sin(angle);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
  }

  function drawHouseImpl(ctx, obj) {
    const { x, y } = obj.bbox;
    const w = obj.params.width || 150;
    const h = obj.params.height || 150;
    // 墙体
    ctx.fillStyle = obj.color;
    ctx.fillRect(x, y + h * 0.4, w, h * 0.6);
    ctx.strokeStyle = obj.color;
    ctx.strokeRect(x, y + h * 0.4, w, h * 0.6);
    // 屋顶
    ctx.beginPath();
    ctx.moveTo(x, y + h * 0.4);
    ctx.lineTo(x + w / 2, y);
    ctx.lineTo(x + w, y + h * 0.4);
    ctx.closePath();
    ctx.fillStyle = '#CC0000';
    ctx.fill();
    ctx.stroke();
    // 门
    ctx.fillStyle = '#8B4513';
    ctx.fillRect(x + w * 0.35, y + h * 0.65, w * 0.3, h * 0.35);
  }

  function drawTreeImpl(ctx, obj) {
    const cx = obj.center.x;
    const baseY = obj.params.height ? obj.center.y : obj.center.y;
    const treeH = obj.params.height || 150;
    // 树干
    ctx.fillStyle = '#8B4513';
    ctx.fillRect(cx - 10, baseY - treeH * 0.3, 20, treeH * 0.4);
    // 树冠
    ctx.fillStyle = obj.color;
    ctx.beginPath();
    ctx.arc(cx, baseY - treeH * 0.5, treeH * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx - 20, baseY - treeH * 0.35, treeH * 0.25, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + 20, baseY - treeH * 0.35, treeH * 0.25, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawFlowerImpl(ctx, obj) {
    const cx = obj.center.x, cy = obj.center.y;
    const s = (obj.params.size || 40) / 40;
    // 花瓣
    for (let i = 0; i < 5; i++) {
      const angle = (i * Math.PI * 2) / 5 - Math.PI / 2;
      const px = cx + 15 * s * Math.cos(angle);
      const py = cy + 15 * s * Math.sin(angle);
      ctx.beginPath();
      ctx.ellipse(px, py, 10 * s, 5 * s, angle, 0, Math.PI * 2);
      ctx.fill();
    }
    // 花心
    ctx.fillStyle = '#FFD700';
    ctx.beginPath();
    ctx.arc(cx, cy, 8 * s, 0, Math.PI * 2);
    ctx.fill();
    // 茎
    ctx.strokeStyle = '#008000';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy + 8 * s);
    ctx.lineTo(cx, cy + 40 * s);
    ctx.stroke();
  }

  // ---------- TTS 反馈文字 ----------
  function getFeedbackText(cmd) {
    switch (cmd.action) {
      case 'drawCircle': return `已画好${cmd.label || '圆形'}`;
      case 'drawRectangle': return `已画好${cmd.label || '矩形'}`;
      case 'drawTriangle': return `已画好${cmd.label || '三角形'}`;
      case 'drawLine': return `已画好${cmd.label || '直线'}`;
      case 'drawEllipse': return `已画好${cmd.label || '椭圆'}`;
      case 'drawStar': return `已画好${cmd.label || '星形'}`;
      case 'drawHeart': return `已画好${cmd.label || '心形'}`;
      case 'drawSun': return `已画好${cmd.label || '太阳'}`;
      case 'drawHouse': return `已画好${cmd.label || '房子'}`;
      case 'drawTree': return `已画好${cmd.label || '树'}`;
      case 'drawFlower': return `已画好${cmd.label || '花'}`;
      case 'clearCanvas': return '画布已清空';
      default: return '已完成';
    }
  }

  // ---------- UI 辅助 ----------
  function addLog(icon, text) {
    const logArea = document.getElementById('logArea');
    if (!logArea) return;
    const placeholder = logArea.querySelector('.log-placeholder');
    if (placeholder) placeholder.remove();
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.innerHTML = `<span class="log-icon">${icon}</span><span class="log-text">${escapeHtml(text)}</span>`;
    logArea.appendChild(entry);
    logArea.scrollTop = logArea.scrollHeight;
    while (logArea.children.length > 50) logArea.firstChild.remove();
  }

  function updateCanvasHint(show) {
    const hint = document.getElementById('canvasHint');
    if (hint) hint.style.display = show ? 'block' : 'none';
  }

  function updateConnectionStatus(status) {
    const el = document.querySelector('#statusIndicator .status-text');
    if (el) {
      switch (status) {
        case 'processing': el.textContent = '处理中...'; break;
        case 'connected': el.textContent = '就绪'; break;
        default: break;
      }
    }
  }

  function updateToolDisplay() {
    const swatch = document.getElementById('colorSwatch');
    const strokeDisp = document.getElementById('strokeDisplay');
    const fillDisp = document.getElementById('fillDisplay');
    if (swatch) swatch.style.background = SceneGraph.getCurrentColor();
    if (strokeDisp) strokeDisp.textContent = SceneGraph.getCurrentStrokeWidth();
    if (fillDisp) fillDisp.textContent = SceneGraph.getCurrentFill() ? '是' : '否';
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ---------- 启动 ----------
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { init };
})();
