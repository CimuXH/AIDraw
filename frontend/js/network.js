/**
 * WebSocket 网络客户端 — 占位，阶段三实现
 */
const Network = (() => {
  let ws = null;
  let connected = false;

  function connect() {
    console.log('[Network] (占位) 阶段三实现 WebSocket 连接');
  }

  function send(msg) {
    console.log('[Network] (占位) 待发送:', msg);
  }

  function isConnected() { return connected; }

  return { connect, send, isConnected };
})();
