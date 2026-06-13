/**
 * 场景图谱 + 全局状态管理 — 占位，阶段五实现
 */
const SceneGraph = (() => {
  let objects = [];
  const canvasSize = { width: 1100, height: 700 };
  let version = 0;

  // 当前工具状态
  let currentColor = '#000000';
  let currentStrokeWidth = 3;
  let currentFill = false;

  function addObject(obj) {
    const newObj = {
      id: `obj_${Date.now()}_${objects.length}`,
      zIndex: objects.length,
      createdAt: Date.now(),
      parentId: null,
      ...obj,
    };
    objects.push(newObj);
    version++;
    console.log('[SceneGraph] 添加:', newObj.label || newObj.type);
    return newObj;
  }

  function removeObject(id) {
    // 级联删除子对象
    const toRemove = new Set();
    toRemove.add(id);
    let changed = true;
    while (changed) {
      changed = false;
      for (const obj of objects) {
        if (!toRemove.has(obj.id) && obj.parentId && toRemove.has(obj.parentId)) {
          toRemove.add(obj.id);
          changed = true;
        }
      }
    }
    objects = objects.filter(obj => !toRemove.has(obj.id));
    version++;
  }

  function findById(id) { return objects.find(obj => obj.id === id); }
  function findByLabel(keyword) { return objects.filter(obj => obj.label && obj.label.includes(keyword)); }
  function findByType(type) { return objects.filter(obj => obj.type === type); }
  function getAll() { return [...objects]; }
  function clear() { objects = []; version++; }

  function toLLMContext() {
    if (objects.length === 0) return `画布尺寸:${canvasSize.width}×${canvasSize.height}\n当前无已绘制图形。`;
    let ctx = `画布尺寸:${canvasSize.width}×${canvasSize.height}\n已绘制${objects.length}个图形:\n`;
    objects.forEach((obj, i) => {
      ctx += `${i + 1}. ${obj.type}'${obj.label || '未命名'}'(${obj.id}) `;
      if (obj.bbox) ctx += `bbox(x:${obj.bbox.x},y:${obj.bbox.y},w:${obj.bbox.width},h:${obj.bbox.height}) `;
      if (obj.center) ctx += `中心(${obj.center.x},${obj.center.y}) `;
      ctx += `颜色:${obj.color} `;
      ctx += obj.fill ? '实心 ' : '空心 ';
      ctx += `线宽${obj.strokeWidth}`;
      if (obj.params) ctx += ` 参数:${JSON.stringify(obj.params)}`;
      ctx += '\n';
    });
    return ctx;
  }

  return {
    addObject, removeObject, findById, findByLabel, findByType,
    getAll, clear, toLLMContext,
    getCurrentColor: () => currentColor,
    setCurrentColor: (c) => { currentColor = c; },
    getCurrentStrokeWidth: () => currentStrokeWidth,
    setCurrentStrokeWidth: (w) => { currentStrokeWidth = w; },
    getCurrentFill: () => currentFill,
    setCurrentFill: (f) => { currentFill = f; },
    getObjectCount: () => objects.length,
  };
})();
