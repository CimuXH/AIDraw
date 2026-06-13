/**
 * 语音识别模块 (STT)
 * 封装 Web Speech API — SpeechRecognition
 * 支持中文连续识别、自动恢复、事件派发
 */
const SpeechRecognizer = (() => {
  // ---------- 内部状态 ----------
  let recognition = null;
  let isListening = false;
  let isUserStopped = false;   // true = 用户主动关闭，不自动恢复

  // ---------- 浏览器兼容检查 ----------
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const isSupported = !!SpeechRecognition;

  // ---------- 初始化 ----------
  function init() {
    if (!isSupported) {
      console.warn('[STT] 当前浏览器不支持 Web Speech API，请使用 Chrome 或 Edge');
      return false;
    }

    recognition = new SpeechRecognition();
    recognition.lang = 'zh-CN';
    recognition.continuous = true;       // 连续识别
    recognition.interimResults = true;   // 返回中间结果
    recognition.maxAlternatives = 1;     // 只取最高置信度结果

    // --- 识别结果回调 ---
    recognition.onresult = (event) => {
      let interim = '';
      let finalText = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalText += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }

      // 更新 UI 中间结果
      if (interim) {
        updateInterimUI(interim);
      }

      // 派发最终结果
      if (finalText) {
        finalText = finalText.trim();
        if (finalText) {
          updateInterimUI(''); // 清空中间结果
          dispatchFinal(finalText);
        }
      }
    };

    // --- 识别结束回调 ---
    recognition.onend = () => {
      console.log('[STT] 识别会话结束');
      if (!isUserStopped) {
        // 自动恢复监听
        console.log('[STT] 自动恢复监听...');
        setTimeout(() => {
          if (!isUserStopped && recognition) {
            try { recognition.start(); }
            catch (e) { console.warn('[STT] 自动恢复失败:', e.message); }
          }
        }, 300);
      } else {
        updateListeningState(false);
      }
    };

    // --- 错误回调 ---
    recognition.onerror = (event) => {
      console.error('[STT] 错误:', event.error, event.message);
      switch (event.error) {
        case 'no-speech':
          // 静默，正常情况，不提示
          break;
        case 'aborted':
          // 用户或系统中断
          break;
        case 'network':
          updateStatusUI('error', '网络异常');
          dispatchEvent('speech:error', { error: 'network', message: '语音识别网络异常' });
          break;
        case 'not-allowed':
          updateStatusUI('error', '麦克风被拒绝');
          dispatchEvent('speech:error', { error: 'not-allowed', message: '请允许麦克风权限' });
          isUserStopped = true;
          break;
        case 'audio-capture':
          updateStatusUI('error', '未检测到麦克风');
          dispatchEvent('speech:error', { error: 'audio-capture', message: '未检测到麦克风设备' });
          break;
        default:
          dispatchEvent('speech:error', { error: event.error, message: event.message });
      }
    };

    // --- 音频开始/结束（用于状态指示） ---
    recognition.onspeechstart = () => {
      console.log('[STT] 检测到语音');
    };
    recognition.onspeechend = () => {
      console.log('[STT] 语音结束');
    };

    console.log('[STT] 初始化完成');
    return true;
  }

  // ---------- 公开方法 ----------

  /** 开始监听 */
  function start() {
    if (!isSupported) {
      alert('当前浏览器不支持语音识别，请使用 Chrome 或 Edge 浏览器。');
      return;
    }
    if (!recognition) {
      if (!init()) return;
    }

    isUserStopped = false;
    try {
      recognition.start();
      isListening = true;
      updateListeningState(true);
      console.log('[STT] 开始聆听');
    } catch (e) {
      // 可能已经在运行中
      console.warn('[STT] start 异常:', e.message);
    }
  }

  /** 停止监听 */
  function stop() {
    isUserStopped = true;
    isListening = false;
    if (recognition) {
      try { recognition.stop(); } catch (e) { /* ignore */ }
    }
    updateListeningState(false);
    updateInterimUI('');
    console.log('[STT] 已停止聆听');
  }

  /** 切换监听状态 */
  function toggle() {
    if (isListening) {
      stop();
    } else {
      start();
    }
  }

  /** 是否正在监听 */
  function getIsListening() {
    return isListening;
  }

  /** 浏览器是否支持 */
  function getIsSupported() {
    return isSupported;
  }

  // ---------- 内部辅助 ----------

  function dispatchFinal(text) {
    console.log(`[STT] ✅ 最终识别: "${text}"`);
    addLogEntry('🎤', text);
    dispatchEvent('speech:final', { text, timestamp: Date.now() });
  }

  function updateInterimUI(text) {
    const el = document.getElementById('interimText');
    if (el) {
      el.textContent = text ? `听到: "${text}"` : '';
      el.className = text ? 'interim-text active' : 'interim-text';
    }
  }

  function updateListeningState(active) {
    const micBtn = document.getElementById('micBtn');
    const micText = micBtn?.querySelector('.mic-text');
    const statusIndicator = document.getElementById('statusIndicator');

    if (micBtn) {
      micBtn.classList.toggle('listening', active);
      if (micText) micText.textContent = active ? '聆听中...' : '开始聆听';
    }

    if (statusIndicator) {
      statusIndicator.className = active
        ? 'status-indicator status-listening'
        : 'status-indicator status-idle';
      const statusText = statusIndicator.querySelector('.status-text');
      if (statusText) statusText.textContent = active ? '聆听中' : '就绪';
    }
  }

  function updateStatusUI(status, text) {
    const statusIndicator = document.getElementById('statusIndicator');
    if (statusIndicator) {
      statusIndicator.className = `status-indicator status-${status}`;
      const statusText = statusIndicator.querySelector('.status-text');
      if (statusText) statusText.textContent = text;
    }
  }

  function addLogEntry(icon, text) {
    const logArea = document.getElementById('logArea');
    if (!logArea) return;

    // 移除占位文字
    const placeholder = logArea.querySelector('.log-placeholder');
    if (placeholder) placeholder.remove();

    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.innerHTML = `<span class="log-icon">${icon}</span><span class="log-text">${text}</span>`;
    logArea.appendChild(entry);

    // 滚动到底部
    logArea.scrollTop = logArea.scrollHeight;

    // 最多保留 50 条
    while (logArea.children.length > 50) {
      logArea.firstChild.remove();
    }
  }

  function dispatchEvent(name, detail) {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  }

  // ---------- 导出 ----------
  return {
    init,
    start,
    stop,
    toggle,
    getIsListening,
    getIsSupported,
  };
})();

// 页面加载时自动初始化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => SpeechRecognizer.init());
} else {
  SpeechRecognizer.init();
}
