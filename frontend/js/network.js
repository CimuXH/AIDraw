/**
 * WebSocket 网络客户端
 * 负责与 Go 后端的双向通信：发送 NLU 请求，接收绘图命令
 */
const Network = (() => {
  // ---------- 配置 ----------
  const WS_URL = 'ws://localhost:8080/ws';
  const MAX_RECONNECT_DELAY = 30000;  // 最大重连间隔 30s
  const INITIAL_RECONNECT_DELAY = 1000; // 初始重连间隔 1s

  // ---------- 内部状态 ----------
  let ws = null;
  let connected = false;
  let reconnectDelay = INITIAL_RECONNECT_DELAY;
  let reconnectTimer = null;
  let requestId = 0;

  // ---------- 公开方法 ----------

  /** 建立 WebSocket 连接 */
  function connect() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      console.log('[Network] 已有连接或正在连接中');
      return;
    }

    console.log('[Network] 正在连接:', WS_URL);
    updateConnectionStatus('connecting');

    try {
      ws = new WebSocket(WS_URL);
    } catch (e) {
      console.error('[Network] 创建 WebSocket 失败:', e);
      scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      console.log('[Network] ✅ 已连接');
      connected = true;
      reconnectDelay = INITIAL_RECONNECT_DELAY;
      updateConnectionStatus('connected');
      dispatchEvent('network:connected', {});
    };

    ws.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch (e) {
        console.error('[Network] 消息解析失败:', e);
        return;
      }

      console.log('[Network] 收到:', msg.type, msg.id);

      switch (msg.type) {
        case 'nlu_result':
          dispatchEvent('network:nlu_result', {
            id: msg.id,
            commands: parseCommands(msg.commands),
          });
          break;
        case 'nlu_error':
          console.error('[Network] NLU 错误:', msg.error);
          dispatchEvent('network:nlu_error', {
            id: msg.id,
            error: msg.error,
            fallback: msg.fallback || '抱歉，我没听懂，请再说一遍',
          });
          break;
        default:
          console.warn('[Network] 未知消息类型:', msg.type);
      }
    };

    ws.onclose = (event) => {
      console.log('[Network] 连接关闭, code:', event.code);
      connected = false;
      updateConnectionStatus('disconnected');
      ws = null;

      if (!event.wasClean) {
        scheduleReconnect();
      }
    };

    ws.onerror = (error) => {
      console.error('[Network] WebSocket 错误:', error);
      // onclose 会在 onerror 之后触发，重连逻辑放在 onclose 中
    };
  }

  /** 发送 NLU 请求 */
  function sendNLURequest(text, sceneContext) {
    if (!connected || !ws || ws.readyState !== WebSocket.OPEN) {
      console.warn('[Network] 未连接，无法发送');
      dispatchEvent('network:nlu_error', {
        id: '',
        error: '未连接到服务器',
        fallback: '网络未连接，请检查后端服务是否启动',
      });
      return null;
    }

    const id = 'req_' + (++requestId) + '_' + Date.now();
    const msg = {
      type: 'nlu_request',
      id: id,
      text: text,
      sceneContext: sceneContext || '',
      timestamp: Date.now(),
    };

    try {
      ws.send(JSON.stringify(msg));
      console.log('[Network] 已发送:', id, text);
      updateConnectionStatus('processing');
      return id;
    } catch (e) {
      console.error('[Network] 发送失败:', e);
      dispatchEvent('network:nlu_error', {
        id: id,
        error: '发送失败: ' + e.message,
        fallback: '消息发送失败，请重试',
      });
      return null;
    }
  }

  /** 断开连接 */
  function disconnect() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (ws) {
      ws.onclose = null; // 阻止自动重连
      ws.close(1000, '用户主动断开');
      ws = null;
    }
    connected = false;
    updateConnectionStatus('disconnected');
    console.log('[Network] 已断开');
  }

  /** 是否已连接 */
  function isConnected() {
    return connected;
  }

  // ---------- 内部方法 ----------

  function scheduleReconnect() {
    if (reconnectTimer) return; // 已有定时器在等待

    console.log(`[Network] ${reconnectDelay / 1000}s 后重连...`);
    updateConnectionStatus('reconnecting');

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
      // 指数退避
      reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
    }, reconnectDelay);
  }

  function parseCommands(commandsRaw) {
    if (!commandsRaw) return [];
    // commandsRaw 可能是已解析的数组，也可能是 JSON 字符串
    if (Array.isArray(commandsRaw)) return commandsRaw;
    if (typeof commandsRaw === 'string') {
      try {
        const parsed = JSON.parse(commandsRaw);
        return Array.isArray(parsed) ? parsed : [];
      } catch (e) {
        console.error('[Network] 解析 commands 失败:', e);
        return [];
      }
    }
    return [];
  }

  function updateConnectionStatus(status) {
    const statusIndicator = document.getElementById('statusIndicator');
    if (!statusIndicator) return;

    switch (status) {
      case 'connecting':
        statusIndicator.className = 'status-indicator status-processing';
        setStatusText('连接中...');
        break;
      case 'connected':
        statusIndicator.className = 'status-indicator status-idle';
        setStatusText('就绪');
        break;
      case 'processing':
        statusIndicator.className = 'status-indicator status-processing';
        setStatusText('处理中...');
        break;
      case 'disconnected':
        statusIndicator.className = 'status-indicator status-error';
        setStatusText('未连接');
        break;
      case 'reconnecting':
        statusIndicator.className = 'status-indicator status-processing';
        setStatusText('重连中...');
        break;
    }
  }

  function setStatusText(text) {
    const el = document.querySelector('#statusIndicator .status-text');
    if (el) el.textContent = text;
  }

  function dispatchEvent(name, detail) {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  }

  // ---------- 自动连接 ----------
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(() => connect(), 500); // 等页面就绪后再连
    });
  } else {
    setTimeout(() => connect(), 500);
  }

  return {
    connect,
    disconnect,
    sendNLURequest,
    isConnected,
  };
})();
