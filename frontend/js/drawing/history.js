/**
 * 撤销系统 — 占位，阶段六实现
 */
const History = (() => {
  let snapshot = null;
  let lastLabel = '';

  function saveSnapshot(ctx) {
    if (!ctx) return;
    const canvas = ctx.canvas;
    snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
    console.log('[History] 快照已保存');
  }

  function undo(ctx, sceneGraph) {
    if (!snapshot) { console.log('[History] 无快照可撤销'); return false; }
    ctx.putImageData(snapshot, 0, 0);
    snapshot = null;
    console.log('[History] 撤销完成');
    return true;
  }

  function canUndo() { return snapshot !== null; }
  function clear() { snapshot = null; }

  return { saveSnapshot, undo, canUndo, clear };
})();
