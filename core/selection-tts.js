(function attach(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(root) {
  const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
  const MAX_SELECTION_CHARACTERS = 20000;
  // The queue belongs to the window, not to a controller. Only its current
  // owner may cancel it; a stale selection/controller must not stop a new one.
  const browserOwners = new WeakMap();
  const gestureTypes = new Set(['click', 'pointerup', 'mouseup', 'touchend', 'keydown', 'keyup']);
  const phases = new Set(['settings', 'discovery', 'synthesis', 'receiving', 'decode-pcm', 'decode-audio', 'playback']);
  const safeMessages = {
    TTS_INVALID_TEXT: '请选择 1–20000 个字符后朗读；更长的内容请分段选择。',
    TTS_COMPATIBILITY: '此服务不支持 JSON 朗读模式；可在朗读设置中选择自动兼容或标准音频。',
    TTS_TIMEOUT: '这一段的朗读请求超时，请检查服务后重试。',
    TTS_HTTP: '朗读服务拒绝了这一段请求，请检查服务状态和设置。',
    TTS_NETWORK: '无法连接朗读服务，请确认服务已启动及地址可访问。',
    TTS_RESPONSE_TYPE: '这一段未返回有效音频，请检查朗读服务。',
    TTS_RESPONSE_SIZE: '这一段音频为空或超过大小限制。',
    TTS_PLAY_FAILED: '音频播放失败，请检查浏览器的音频权限。',
    TTS_BROWSER_UNAVAILABLE: '此浏览器暂不支持内置朗读，请更换浏览器或在设置中选择其他朗读方式。',
    TTS_BROWSER_NO_VOICES: '浏览器未提供可用音色，请安装系统语音包后重试，或在设置中选择其他朗读方式。',
    TTS_BROWSER_VOICE_UNAVAILABLE: '所选浏览器音色当前不可用，请在朗读设置中重新选择音色或选择自动。',
    TTS_BROWSER_BUSY: '浏览器正在播放其他朗读，请等待或停止该朗读后重试。',
    TTS_BROWSER_TIMEOUT: '浏览器朗读未正常响应，请点击朗读重试或检查系统语音设置。'
  };
  function trusted(event) { return event?.isTrusted === true && gestureTypes.has(event.type); }
  function safeDetails(value, fallback) {
    const details = { phase: phases.has(value?.phase) ? value.phase : fallback };
    for (const key of ['elapsedMs', 'httpStatus', 'audioBytes']) {
      const number = value?.[key];
      if (Number.isSafeInteger(number) && number >= 0 &&
          (key !== 'httpStatus' || (number >= 100 && number <= 599)) &&
          (key !== 'audioBytes' || number <= MAX_AUDIO_BYTES * 2)) details[key] = number;
    }
    return details;
  }
  function failure(code, message, details) { return Object.assign(new Error(message), { code, ttsDetails: details }); }

  function validVoiceId(value) {
    return typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
  }
  function browserVoiceRows(synth) {
    const seen = new Set();
    return Array.from(synth.getVoices() || []).filter(voice => {
      if (!validVoiceId(voice?.voiceURI) || seen.has(voice.voiceURI)) return false;
      seen.add(voice.voiceURI); return true;
    }).map(voice => ({ id: voice.voiceURI, name: String(voice.name || voice.voiceURI), lang: String(voice.lang || ''),
      localService: voice.localService === true, default: voice.default === true }));
  }
  async function listBrowserTtsVoices({ signal, timeoutMs = 1500, speechSynthesis = root.speechSynthesis } = {}) {
    if (signal?.aborted) throw failure('TTS_CANCELLED', '朗读已停止。');
    if (!speechSynthesis || typeof speechSynthesis.getVoices !== 'function' || typeof speechSynthesis.speak !== 'function') {
      throw failure('TTS_BROWSER_UNAVAILABLE', safeMessages.TTS_BROWSER_UNAVAILABLE, { phase: 'discovery' });
    }
    const read = () => { try { return browserVoiceRows(speechSynthesis); } catch { return []; } };
    const voices = read(); if (voices.length) return voices;
    return new Promise((resolve, reject) => {
      let timer, poll, settled = false;
      const finish = (result, error) => {
        if (settled) return; settled = true; clearTimeout(timer); clearInterval(poll);
        speechSynthesis.removeEventListener?.('voiceschanged', changed); signal?.removeEventListener('abort', aborted);
        if (error) reject(error); else resolve(result);
      };
      const changed = () => { const found = read(); if (found.length) finish(found); };
      const aborted = () => finish(null, failure('TTS_CANCELLED', '朗读已停止。'));
      speechSynthesis.addEventListener?.('voiceschanged', changed);
      signal?.addEventListener('abort', aborted, { once: true });
      timer = setTimeout(() => finish(read()), Number.isFinite(timeoutMs) ? Math.max(0, Math.min(5000, timeoutMs)) : 1500);
      // Some engines expose getVoices before their voiceschanged event support.
      poll = setInterval(changed, 100); changed(); if (signal?.aborted) aborted();
    });
  }

  function validBase64(value) {
    if (value.length % 4) return false;
    let end = value.length;
    if (value.endsWith('==')) end -= 2;
    else if (value.endsWith('=')) end -= 1;
    // A quantified four-character group can exhaust the JS regex stack on valid
    // multi-megabyte audio. Scan once while retaining the same padding rules.
    for (let index = 0; index < end; index++) {
      const code = value.charCodeAt(index);
      if (!((code >= 65 && code <= 90) || (code >= 97 && code <= 122) ||
          (code >= 48 && code <= 57) || code === 43 || code === 47)) return false;
    }
    return true;
  }

  // Preserve every character and split on sentence/space boundaries where possible.
  // Array.from prevents a chunk boundary from cutting a Unicode surrogate pair.
  function splitTtsText(text) {
    const characters = Array.from(text), chunks = [];
    const containsHan = /\p{Script=Han}/u.test(text);
    const firstLimit = containsHan ? 80 : 240, laterLimit = containsHan ? 240 : 600;
    let offset = 0;
    while (offset < characters.length) {
      const limit = chunks.length ? laterLimit : firstLimit;
      let end = Math.min(offset + limit, characters.length);
      if (end < characters.length) {
        let sentence = 0, whitespace = 0;
        for (let index = offset; index < end; index++) {
          if (/[。！？.!?\n]/u.test(characters[index])) sentence = index + 1;
          if (/\s/u.test(characters[index])) whitespace = index + 1;
        }
        const minimum = offset + Math.floor(limit / 3);
        if (sentence >= minimum) end = sentence;
        else if (whitespace >= minimum) end = whitespace;
      }
      chunks.push(characters.slice(offset, end).join(''));
      offset = end;
    }
    return chunks;
  }

  function createSelectionTtsController(options = {}) {
    if (typeof options.sendMessage !== 'function' || typeof options.getLease !== 'function' ||
        typeof options.isCurrentLease !== 'function') throw new TypeError('TTS requires a transport and current page lease.');
    const AudioCtor = options.AudioCtor || root.Audio;
    const AudioContextCtor = options.AudioContextCtor || root.AudioContext || root.webkitAudioContext;
    const synth = Object.hasOwn(options, 'speechSynthesis') ? options.speechSynthesis : root.speechSynthesis;
    const UtteranceCtor = options.SpeechSynthesisUtteranceCtor || root.SpeechSynthesisUtterance;
    const urlApi = options.urlApi || root.URL;
    let sequence = 0, active = null, destroyed = false;
    let state = { status: 'idle' };
    const notify = next => { state = next; try { options.onState?.({ ...state }); } catch { /* UI callbacks do not own playback. */ } };
    const currentOperation = operation => !destroyed && active === operation && !operation.controller.signal.aborted;
    const current = operation => currentOperation(operation) && operation.leaseReady && options.isCurrentLease(operation.lease) === true;
    const progress = (operation, status, extra = {}) => notify({ status, phase: operation.phase,
      ...(operation.browserVoice ? { browserVoice: operation.browserVoice } : {}),
      ...(operation.noticeCode ? { noticeCode: operation.noticeCode, noticeMessage: operation.noticeMessage } : {}),
      chunkIndex: operation.index, chunkCount: operation.chunks.length, completedChunks: operation.completed, ...extra });
    function disposeSpeech(operation, cancel = true) {
      if (!operation) return;
      clearTimeout(operation.speechTimer); operation.speechTimer = null;
      const utterance = operation.utterance; operation.utterance = null;
      if (utterance) { utterance.onstart = null; utterance.onend = null; utterance.onerror = null; }
      operation.speechResolve?.(false); operation.speechResolve = null;
      if (synth && browserOwners.get(synth)?.operation === operation) {
        browserOwners.delete(synth);
        if (cancel && utterance) { try { synth.cancel(); } catch { /* Browser already released its queue. */ } }
      }
    }
    function disposeChunk(operation) {
      if (operation?.source) {
        operation.source.onended = null;
        try { operation.source.stop(); } catch { /* Already ended. */ }
        operation.source.disconnect(); operation.source = null;
      }
      operation.buffer = null;
      if (operation?.audio) {
        operation.audio.onended = null; operation.audio.onerror = null;
        operation.audio.pause(); operation.audio.removeAttribute?.('src'); operation.audio.load?.(); operation.audio = null;
      }
      if (operation?.url) { urlApi.revokeObjectURL(operation.url); operation.url = ''; }
    }
    function disposeAudio(operation) {
      disposeSpeech(operation);
      disposeChunk(operation);
      operation.next = null;
      if (operation?.context) {
        try { Promise.resolve(operation.context.close()).catch(() => {}); } catch { /* Already closed. */ }
        operation.context = null;
      }
    }
    async function prepareBrowser(operation, settings) {
      disposeAudio(operation); // Release the manual WebAudio gesture prime.
      if (!UtteranceCtor) throw failure('TTS_BROWSER_UNAVAILABLE', safeMessages.TTS_BROWSER_UNAVAILABLE, { phase: 'discovery' });
      operation.phase = 'discovery'; progress(operation, 'loading');
      const voices = await listBrowserTtsVoices({ speechSynthesis: synth, signal: operation.controller.signal,
        timeoutMs: options.browserVoiceTimeoutMs ?? 1500 });
      if (!current(operation)) throw failure('TTS_CANCELLED', '朗读已停止。');
      if (!voices.length) throw failure('TTS_BROWSER_NO_VOICES', safeMessages.TTS_BROWSER_NO_VOICES, { phase: 'discovery' });
      const id = settings?.browser?.[operation.language === 'zh' ? 'voiceZh' : 'voiceEn'];
      let selected;
      if (id) {
        selected = validVoiceId(id) ? voices.find(voice => voice.id === id) : null;
        if (!selected) throw failure('TTS_BROWSER_VOICE_UNAVAILABLE', safeMessages.TTS_BROWSER_VOICE_UNAVAILABLE, { phase: 'discovery' });
      } else {
        const matching = voices.filter(voice => voice.lang.toLowerCase().replace(/_/gu, '-').split('-')[0] === operation.language);
        selected = matching.find(voice => voice.localService && voice.default) || matching.find(voice => voice.localService) ||
          matching.find(voice => voice.default) || matching[0] || voices.find(voice => voice.localService && voice.default) ||
          voices.find(voice => voice.localService) || voices.find(voice => voice.default) || voices[0];
        if (!matching.length) {
          operation.noticeCode = 'TTS_BROWSER_LANGUAGE_FALLBACK';
          operation.noticeMessage = '未找到对应语言的音色，正在使用浏览器可用音色。';
        }
      }
      operation.voice = Array.from(synth.getVoices() || []).find(voice => voice.voiceURI === selected.id);
      if (!operation.voice) throw failure('TTS_BROWSER_VOICE_UNAVAILABLE', safeMessages.TTS_BROWSER_VOICE_UNAVAILABLE, { phase: 'discovery' });
      operation.browserVoice = selected;
      operation.rate = Number.isFinite(settings?.speed) && settings.speed >= 0.25 && settings.speed <= 4 ? settings.speed : 1;
    }
    function playBrowser(operation) {
      if (!current(operation)) { if (active === operation) stop(); return Promise.resolve(false); }
      const previous = browserOwners.get(synth);
      if (!previous && operation.completed === 0 && (synth.speaking || synth.pending)) {
        return Promise.resolve(failOperation(operation, failure('TTS_BROWSER_BUSY', safeMessages.TTS_BROWSER_BUSY, { phase: 'playback' })));
      }
      if (previous && previous.operation !== operation) previous.stop();
      if (!current(operation)) return Promise.resolve(false);
      disposeSpeech(operation);
      const utterance = new UtteranceCtor(operation.chunks[operation.index]);
      utterance.voice = operation.voice; utterance.lang = operation.voice.lang || (operation.language === 'zh' ? 'zh-CN' : 'en-US');
      utterance.rate = operation.rate;
      operation.utterance = utterance; operation.phase = 'playback';
      browserOwners.set(synth, { operation, stop });
      const index = operation.index;
      const owns = () => operation.utterance === utterance && operation.index === index && browserOwners.get(synth)?.operation === operation;
      let started = false;
      const pending = new Promise(resolve => { operation.speechResolve = resolve; });
      const settle = value => { operation.speechResolve?.(value); operation.speechResolve = null; };
      const isLive = () => {
        if (!owns()) return false;
        if (!current(operation)) { disposeSpeech(operation); if (active === operation) stop(); return false; }
        return true;
      };
      const timeout = () => {
        if (isLive()) failOperation(operation, failure('TTS_BROWSER_TIMEOUT', safeMessages.TTS_BROWSER_TIMEOUT, { phase: 'playback' }));
      };
      utterance.onstart = () => {
        if (!isLive() || started) return;
        started = true; clearTimeout(operation.speechTimer);
        operation.speechTimer = setTimeout(timeout, options.browserPlaybackTimeoutMs ??
          Math.max(30000, Math.min(180000, Array.from(utterance.text).length * 350 + 15000) / operation.rate));
        progress(operation, 'playing'); settle(true);
      };
      utterance.onend = () => {
        if (!isLive()) return;
        if (!started) { failOperation(operation, failure('TTS_PLAY_FAILED', safeMessages.TTS_PLAY_FAILED, { phase: 'playback' })); return; }
        disposeSpeech(operation, false); operation.completed += 1;
        if (operation.completed === operation.chunks.length) { active = null; progress(operation, 'idle'); return; }
        operation.index += 1; progress(operation, 'loading');
        try { void playBrowser(operation).catch(error => failOperation(operation, error)); } catch (error) { failOperation(operation, error); }
      };
      utterance.onerror = event => {
        if (!isLive()) return;
        if (event?.error === 'not-allowed') {
          disposeSpeech(operation);
          progress(operation, 'awaiting_play', { errorCode: 'TTS_PLAY_GESTURE_REQUIRED' });
        } else failOperation(operation, failure('TTS_PLAY_FAILED', safeMessages.TTS_PLAY_FAILED, { phase: 'playback' }));
      };
      operation.speechTimer = setTimeout(timeout, options.browserStartTimeoutMs ?? 8000);
      progress(operation, 'loading');
      try { synth.speak(utterance); } catch (error) {
        if (error?.name === 'NotAllowedError') utterance.onerror({ error: 'not-allowed' });
        else failOperation(operation, failure('TTS_PLAY_FAILED', safeMessages.TTS_PLAY_FAILED, { phase: 'playback' }));
      }
      return pending;
    }
    function stop() {
      sequence += 1;
      const previous = active; active = null;
      if (previous) {
        previous.controller.abort(); disposeAudio(previous);
        if (previous.dispatched) {
          try { Promise.resolve(options.sendMessage({ type: 'TTS_CANCEL', requestId: previous.requestId, lease: previous.lease })).catch(() => {}); }
          catch { /* Page unload can close the message port. */ }
        }
      }
      notify({ status: 'idle' });
    }
    function failOperation(operation, error) {
      if (!(operation.leaseReady ? current(operation) : currentOperation(operation))) {
        disposeAudio(operation); if (active === operation) stop(); return false;
      }
      const errorCode = /^TTS_[A-Z_]+$/u.test(error?.code || '') ? error.code : 'TTS_FAILED';
      const details = safeDetails(error?.ttsDetails, operation.phase);
      stop();
      progress(operation, 'error', { errorCode, errorMessage: safeMessages[errorCode] || '朗读失败，请检查设置。', errorDetails: details });
      return false;
    }
    async function send(message, operation) {
      const signal = operation.controller.signal;
      if (signal.aborted) throw failure('TTS_CANCELLED', '朗读已停止。');
      let abort, timer;
      const started = Date.now();
      const phase = message.type === 'TTS_SYNTHESIZE' ? 'synthesis' : 'settings';
      const cancellation = new Promise((_, reject) => {
        abort = () => reject(failure('TTS_CANCELLED', '朗读已停止。', { phase, elapsedMs: Date.now() - started }));
        signal.addEventListener('abort', abort, { once: true });
        timer = setTimeout(() => reject(failure('TTS_TIMEOUT', '朗读服务超时。', { phase, elapsedMs: Date.now() - started })),
          message.type === 'TTS_SYNTHESIZE' ? 50000 : 5000);
      });
      try {
        const response = await Promise.race([Promise.resolve().then(() => {
          if (!currentOperation(operation) || (message.type === 'TTS_SYNTHESIZE' && !current(operation))) throw failure('TTS_CANCELLED', '朗读已停止。');
          return options.sendMessage(message);
        }), cancellation]);
        if (!response?.success) throw failure(response?.error?.code || 'TTS_FAILED', '朗读失败。', safeDetails(response?.error?.details, phase));
        return response.data;
      } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
    }
    async function prepare(operation, index) {
      if (!current(operation)) throw failure('TTS_CANCELLED', '朗读已停止。');
      const requestId = `${operation.id}-${index}`;
      operation.requestId = requestId; operation.dispatched = true;
      const result = await send({ type: 'TTS_SYNTHESIZE', requestId, text: operation.chunks[index], language: operation.language,
        automatic: operation.automatic, userGesture: true, lease: operation.lease }, operation);
      if (!current(operation)) throw failure('TTS_CANCELLED', '朗读已停止。');
      if (!['audio/mpeg', 'audio/wav'].includes(result?.mimeType) || !Number.isInteger(result?.byteLength) ||
          result.byteLength < 1 || result.byteLength > MAX_AUDIO_BYTES || typeof result.audioBase64 !== 'string' ||
          result.audioBase64.length > Math.ceil(MAX_AUDIO_BYTES / 3) * 4 ||
          !validBase64(result.audioBase64)) {
        throw failure('TTS_RESPONSE_TYPE', '朗读音频无效。', { phase: 'receiving' });
      }
      const binary = atob(result.audioBase64);
      if (binary.length !== result.byteLength) throw failure('TTS_RESPONSE_TYPE', '朗读音频无效。', { phase: 'receiving' });
      return { bytes: Uint8Array.from(binary, character => character.charCodeAt(0)), mimeType: result.mimeType };
    }
    function prefetch(operation) {
      const index = operation.index + 1;
      if (!current(operation) || operation.next || index >= operation.chunks.length) return;
      // Exactly one future block is retained. The synthesis transport is serial;
      // a failed future block cannot interrupt audio that is already playing.
      operation.next = { index, promise: prepare(operation, index).then(data => ({ data }), error => ({ error })) };
    }
    async function ended(operation, index, playback) {
      if (!current(operation)) { disposeAudio(operation); if (active === operation) stop(); return; }
      if (operation.index !== index || (operation.source || operation.audio) !== playback) return;
      disposeChunk(operation); operation.completed += 1;
      if (operation.completed === operation.chunks.length) {
        disposeAudio(operation); active = null; progress(operation, 'idle'); return;
      }
      operation.index += 1; operation.phase = 'synthesis'; progress(operation, 'loading');
      try {
        const pending = operation.next; operation.next = null;
        const result = pending?.index === operation.index ? await pending.promise : { data: await prepare(operation, operation.index) };
        if (result.error) throw result.error;
        if (!current(operation)) { disposeAudio(operation); if (active === operation) stop(); return; }
        await install(operation, result.data);
        await play(operation);
      } catch (error) { failOperation(operation, error); }
    }
    async function install(operation, result) {
      operation.phase = 'decode-audio'; progress(operation, 'loading');
      if (operation.context) {
        let buffer;
        try { buffer = await operation.context.decodeAudioData(result.bytes.buffer); }
        catch { throw failure('TTS_RESPONSE_TYPE', '朗读音频无效。', { phase: 'decode-audio', audioBytes: result.bytes.length }); }
        if (!current(operation)) throw failure('TTS_CANCELLED', '朗读已停止。');
        if (!buffer || !Number.isFinite(buffer.duration) || buffer.duration <= 0 || buffer.duration > 600) {
          throw failure('TTS_RESPONSE_TYPE', '朗读音频无效。', { phase: 'decode-audio', audioBytes: result.bytes.length });
        }
        operation.buffer = buffer;
      } else {
        if (!current(operation)) throw failure('TTS_CANCELLED', '朗读已停止。');
        operation.url = urlApi.createObjectURL(new Blob([result.bytes], { type: result.mimeType }));
        operation.audio = new AudioCtor(operation.url);
        const index = operation.index, audio = operation.audio;
        operation.audio.onended = () => { void ended(operation, index, audio); };
        operation.audio.onerror = () => {
          if (current(operation) && (operation.index !== index || operation.audio !== audio)) return;
          failOperation(operation, failure('TTS_PLAY_FAILED', '音频播放失败。', { phase: 'playback' }));
        };
      }
    }
    async function play(operation) {
      if (!current(operation)) { if (active === operation) stop(); return false; }
      operation.phase = 'playback';
      try {
        if (operation.context) {
          if (operation.context.state !== 'running') { progress(operation, 'awaiting_play', { errorCode: 'TTS_PLAY_GESTURE_REQUIRED' }); return false; }
          const source = operation.context.createBufferSource();
          source.buffer = operation.buffer; source.connect(operation.context.destination);
          const index = operation.index;
          source.onended = () => { void ended(operation, index, source); };
          operation.source = source; source.start();
        } else {
          await operation.audio.play();
          if (!current(operation)) { disposeAudio(operation); if (active === operation) stop(); return false; }
        }
        progress(operation, 'playing'); prefetch(operation); return true;
      } catch (error) {
        if (error?.name === 'NotAllowedError' && current(operation)) {
          progress(operation, 'awaiting_play', { errorCode: 'TTS_PLAY_GESTURE_REQUIRED' }); return false;
        }
        return failOperation(operation, failure('TTS_PLAY_FAILED', '音频播放失败。', { phase: 'playback' }));
      }
    }
    async function speak({ text, event, automatic = false, language } = {}) {
      if (destroyed) return false;
      if (!trusted(event)) { notify({ status: 'error', errorCode: 'TTS_GESTURE_REQUIRED' }); return false; }
      stop();
      const selection = typeof text === 'string' ? text.trim() : '';
      if (!selection || Array.from(selection).length > MAX_SELECTION_CHARACTERS || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(selection)) {
        notify({ status: 'error', errorCode: 'TTS_INVALID_TEXT', errorMessage: safeMessages.TTS_INVALID_TEXT }); return false;
      }
      const id = `tts-${root.crypto?.randomUUID?.() || `${Date.now()}-${++sequence}-${Math.random().toString(36).slice(2)}`}`;
      const operation = { id, lease: null, leaseReady: false, requestId: `${id}-0`, controller: new AbortController(), dispatched: false,
        audio: null, url: '', context: null, chunks: splitTtsText(selection), index: 0, completed: 0, next: null,
        phase: 'settings', automatic: automatic === true,
        language: language === 'zh' || (language !== 'en' && /\p{Script=Han}/u.test(selection)) ? 'zh' : 'en' };
      active = operation;
      try {
        // Capture the original selection before any asynchronous settings wait.
        operation.lease = structuredClone(options.getLease()); operation.leaseReady = true;
        // Keep the network-audio context prime synchronous with a manual click.
        // A browser-speech choice immediately closes it after settings arrive.
        const prime = () => { if (AudioContextCtor) {
          try { operation.context = new AudioContextCtor(); Promise.resolve(operation.context.resume()).catch(() => {}); }
          catch (error) { operation.primeError = error; }
        } };
        if (!automatic) prime();
        progress(operation, 'loading');
        const settings = await send({ type: 'TTS_GET_PUBLIC_SETTINGS' }, operation);
        if (!currentOperation(operation)) return false;
        if (automatic && settings?.autoPlay !== true) { stop(); return false; }
        if (!current(operation)) { stop(); return false; }
        operation.mode = settings?.mode || 'browser';
        if (operation.mode === 'browser') {
          await prepareBrowser(operation, settings);
          return await playBrowser(operation);
        }
        if (!['local', 'online'].includes(operation.mode)) throw failure('TTS_BROWSER_UNAVAILABLE', safeMessages.TTS_BROWSER_UNAVAILABLE);
        if (automatic) prime();
        if (operation.primeError) throw operation.primeError;
        operation.phase = 'synthesis'; progress(operation, 'loading');
        const result = await prepare(operation, 0);
        await install(operation, result);
        return await play(operation);
      } catch (error) { return failOperation(operation, error); }
    }
    async function resume({ event } = {}) {
      if (!trusted(event) || state.status !== 'awaiting_play' || !active) return false;
      const operation = active;
      if (!current(operation)) { stop(); return false; }
      if (operation.mode === 'browser') {
        try { return await playBrowser(operation); } catch (error) { return failOperation(operation, error); }
      }
      if (operation.context) {
        let timer;
        try { await Promise.race([operation.context.resume(), new Promise(resolve => { timer = setTimeout(resolve, 500); })]); }
        catch { /* The visible click-to-play state remains available. */ }
        finally { clearTimeout(timer); }
      }
      return play(operation);
    }
    const onPageHide = () => stop();
    root.addEventListener?.('pagehide', onPageHide);
    return { speak, resume, stop, getState: () => ({ ...state }), destroy() {
      stop(); destroyed = true; root.removeEventListener?.('pagehide', onPageHide);
    } };
  }
  return { createSelectionTtsController, splitTtsText, listBrowserTtsVoices };
});
