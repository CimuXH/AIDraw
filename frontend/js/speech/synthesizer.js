/**
 * 语音合成模块 (TTS)
 * 封装 Web Speech API — SpeechSynthesis
 * 支持中文语音选择、队列管理
 */
const SpeechSynthesizer = (() => {
  // ---------- 状态 ----------
  let voiceReady = false;
  let selectedVoice = null;
  let speaking = false;
  let queue = [];

  // ---------- 初始化 ----------
  function init() {
    if (!('speechSynthesis' in window)) {
      console.warn('[TTS] 当前浏览器不支持 SpeechSynthesis');
      return;
    }

    // voices 是异步加载的
    const voices = speechSynthesis.getVoices();
    if (voices.length > 0) {
      pickVoice(voices);
    }

    // Chrome 中 voices 异步加载，需要监听变化
    speechSynthesis.onvoiceschanged = () => {
      const updatedVoices = speechSynthesis.getVoices();
      if (updatedVoices.length > 0 && !voiceReady) {
        pickVoice(updatedVoices);
      }
    };
  }

  /** 选择最合适的中文语音 */
  function pickVoice(voices) {
    // 优先级：zh-CN 本地语音 > zh-CN > zh-TW > 任何含中文的
    const zhCNLocal = voices.find(v => v.lang === 'zh-CN' && v.localService);
    const zhCN = voices.find(v => v.lang === 'zh-CN');
    const zhTW = voices.find(v => v.lang === 'zh-TW');
    const anyZH = voices.find(v => v.lang.startsWith('zh'));

    selectedVoice = zhCNLocal || zhCN || zhTW || anyZH || null;
    voiceReady = true;

    if (selectedVoice) {
      console.log('[TTS] 选择语音:', selectedVoice.name, selectedVoice.lang,
        selectedVoice.localService ? '(本地)' : '(云端)');
    } else {
      console.warn('[TTS] 未找到中文语音，使用浏览器默认');
    }
  }

  // ---------- 公开方法 ----------

  /** 播报文字（自动排队） */
  function speak(text) {
    if (!('speechSynthesis' in window)) {
      console.log('[TTS] (不支持) 播报:', text);
      return;
    }

    if (!text || text.trim() === '') return;

    // 加入队列
    queue.push(text.trim());

    // 如果当前没有在播放，立即开始
    if (!speaking) {
      playNext();
    }
  }

  /** 停止所有播报并清空队列 */
  function stop() {
    speechSynthesis.cancel();
    queue = [];
    speaking = false;
  }

  /** 是否正在播报 */
  function isSpeaking() {
    return speaking;
  }

  // ---------- 内部方法 ----------

  function playNext() {
    if (queue.length === 0) {
      speaking = false;
      return;
    }

    const text = queue.shift();
    speaking = true;

    const utterance = new SpeechSynthesisUtterance(text);

    if (selectedVoice) {
      utterance.voice = selectedVoice;
    }
    utterance.lang = 'zh-CN';
    utterance.rate = 1.0;   // 正常语速
    utterance.pitch = 1.0;  // 正常音调
    utterance.volume = 1.0;

    utterance.onend = () => {
      speaking = false;
      playNext(); // 播放下一条
    };

    utterance.onerror = (event) => {
      console.warn('[TTS] 播报出错:', event.error);
      speaking = false;
      playNext(); // 出错则跳过，继续下一条
    };

    speechSynthesis.speak(utterance);
  }

  // 初始化
  init();

  return { speak, stop, isSpeaking };
})();
