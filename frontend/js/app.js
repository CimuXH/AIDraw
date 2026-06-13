/**
 * 主控制器 — 串联语音识别 → NLU → 绘图 → 反馈
 */

const App = (() => {
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
      clearBtn.addEventListener('click', () => {
        CanvasEngine.clear();
        SceneGraph.clear();
        History.clear();
        updateCanvasHint(true);
        addLog('🧹', '画布已清空');
      });
    }

    // 监听语音识别最终结果 — 阶段七端到端串联时扩展
    window.addEventListener('speech:final', (event) => {
      const text = event.detail.text;
      console.log('[App] 收到语音:', text);

      // 本地快捷命令（阶段七完善）
      if (text === '撤销' || text === '撤回') {
        handleUndo();
        return;
      }
      if (text === '清除' || text === '清空' || text === '清空画布') {
        CanvasEngine.clear();
        SceneGraph.clear();
        History.clear();
        updateCanvasHint(true);
        addLog('🧹', '画布已清空');
        return;
      }

      // 其他命令：占位，阶段三~七实现
      addLog('⏳', `"${text}" → NLU 处理中（后端未就绪）`);
    });

    // 监听语音错误
    window.addEventListener('speech:error', (event) => {
      const { error, message } = event.detail;
      addLog('❌', `[${error}] ${message}`);
    });

    console.log('[App] 初始化完成 — 阶段一：语音识别可用');
    addLog('💡', '系统就绪，点击麦克风按钮开始');
  }

  // ---------- 辅助 ----------
  function handleUndo() {
    const ctx = CanvasEngine.getCtx();
    if (History.undo(ctx, SceneGraph)) {
      addLog('↩', '已撤销上一步');
    } else {
      addLog('⚠️', '无法撤销');
    }
  }

  function updateCanvasHint(show) {
    const hint = document.getElementById('canvasHint');
    if (hint) hint.style.display = show ? 'block' : 'none';
  }

  function addLog(icon, text) {
    const logArea = document.getElementById('logArea');
    if (!logArea) return;
    const placeholder = logArea.querySelector('.log-placeholder');
    if (placeholder) placeholder.remove();
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.innerHTML = `<span class="log-icon">${icon}</span><span class="log-text">${text}</span>`;
    logArea.appendChild(entry);
    logArea.scrollTop = logArea.scrollHeight;
    while (logArea.children.length > 50) logArea.firstChild.remove();
  }

  // 页面加载时初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { init };
})();
