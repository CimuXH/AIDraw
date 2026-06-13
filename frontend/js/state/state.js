/**
 * 场景图谱 + 全局状态管理 + localStorage 持久化
 */
const SceneGraph = (() => {
  const STORAGE_KEY = 'aidraw_scene_graph';
  let objects = [];
  const canvasSize = { width: 1100, height: 700 };
  let version = 0;

  // 当前工具状态
  let currentColor = '#000000';
  let currentStrokeWidth = 3;
  let currentFill = false;

  // ---------- 持久化 ----------

  function save() {
    try {
      const data = { objects, canvasSize, version, currentColor, currentStrokeWidth, currentFill };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('[SceneGraph] localStorage 保存失败:', e.message);
    }
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (!data.objects || !Array.isArray(data.objects)) return false;
      objects = data.objects;
      version = data.version || objects.length;
      currentColor = data.currentColor || '#000000';
      currentStrokeWidth = data.currentStrokeWidth || 3;
      currentFill = data.currentFill || false;
      console.log('[SceneGraph] 已恢复', objects.length, '个图形');
      return true;
    } catch (e) {
      console.warn('[SceneGraph] 读取失败:', e.message);
      try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
      return false;
    }
  }

  // ---------- 生命周期 ----------

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
    save();
    console.log('[SceneGraph] 添加:', newObj.label || newObj.type, '(总数:', objects.length, ')');
    return newObj;
  }

  function removeObject(id) {
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
    save();
  }

  function clear() {
    objects = [];
    version++;
    save();
    console.log('[SceneGraph] 已清空');
  }

  // ---------- 查询 ----------

  function findById(id) { return objects.find(obj => obj.id === id); }
  function findByLabel(keyword) { return objects.filter(obj => obj.label && obj.label.includes(keyword)); }
  function findByType(type) { return objects.filter(obj => obj.type === type); }
  function getAll() { return [...objects]; }
  function getObjectCount() { return objects.length; }

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

  // ---------- 工具状态 ----------

  function getCurrentColor() { return currentColor; }
  function setCurrentColor(c) { currentColor = c; save(); }
  function getCurrentStrokeWidth() { return currentStrokeWidth; }
  function setCurrentStrokeWidth(w) { currentStrokeWidth = w; save(); }
  function getCurrentFill() { return currentFill; }
  function setCurrentFill(f) { currentFill = f; save(); }

  // ---------- 初始化 ----------

  function init() {
    return load();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return {
    addObject, removeObject, findById, findByLabel, findByType,
    getAll, clear, toLLMContext, getObjectCount,
    getCurrentColor, setCurrentColor,
    getCurrentStrokeWidth, setCurrentStrokeWidth,
    getCurrentFill, setCurrentFill,
  };
})();
