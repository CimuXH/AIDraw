/**
 * Canvas 渲染引擎 — 占位，阶段四实现
 */
const CanvasEngine = (() => {
  let canvas = null;
  let ctx = null;

  function init() {
    canvas = document.getElementById('drawCanvas');
    if (!canvas) { console.error('[Canvas] 找不到 #drawCanvas'); return false; }
    ctx = canvas.getContext('2d');
    clear();
    console.log('[Canvas] 初始化完成:', canvas.width, 'x', canvas.height);
    return true;
  }

  function getCtx() { return ctx; }
  function getCanvas() { return canvas; }

  function clear() {
    if (ctx) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }

  // 页面加载时初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { init, getCtx, getCanvas, clear };
})();
