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
    TTS_NOT_CONFIGURED: '朗读服务尚未配置完成，请检查朗读设置。',
    TTS_INVALID_VOICE: '朗读服务不支持所选音色，请在设置中重新选择。',
    TTS_RESPONSE_TYPE: '这一段未返回有效音频，请检查朗读服务。',
    TTS_RESPONSE_SIZE: '这一段音频为空或超过大小限制。',
    TTS_PLAY_FAILED: '音频播放失败，请检查浏览器的音频权限。',
    TTS_BROWSER_UNAVAILABLE: '此浏览器暂不支持内置朗读，请更换浏览器或在设置中选择其他朗读方式。',
    TTS_BROWSER_NO_VOICES: '浏览器未提供可用音色，请安装系统语音包后重试，或在设置中选择其他朗读方式。',
    TTS_BROWSER_VOICE_UNAVAILABLE: '所选浏览器音色当前不可用，请在朗读设置中重新选择音色或选择自动。',
    TTS_BROWSER_LANGUAGE: '没有适合这段文字的朗读音色，请在系统中添加对应语言的语音，或在朗读设置中指定音色。',
    TTS_BROWSER_ENGINE: '系统语音引擎未能播放，请在朗读设置中试用其他音色。',
    TTS_BROWSER_DEVICE: '浏览器无法使用音频输出设备，请检查系统声音输出后重试。',
    TTS_BROWSER_INTERRUPTED: '朗读被中断，请点击朗读重试。',
    TTS_BROWSER_NETWORK: '联网音色无法连接，请选择本机音色或检查网络。',
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
  // macOS mixes character and sound-effect voices into the ordinary voice list.
  // Voice names can include a localized language or quality suffix in parentheses.
  const characterVoices = new Set(['Albert', 'Bad News', 'Bahh', 'Bells', 'Boing', 'Bubbles',
    'Cellos', 'Fred', 'Good News', 'Hysterical', 'Jester', 'Junior', 'Kathy', 'Organ',
    'Princess', 'Ralph', 'Superstar', 'Trinoids', 'Whisper', 'Wobble', 'Zarvox']);
  function readingVoices(voices, language) {
    const suitable = voices.filter(voice => {
      const lang = voice.lang.toLowerCase().replace(/_/gu, '-').split('-')[0];
      const name = voice.name.split(/\s*[(（]/u)[0];
      return lang === language && !characterVoices.has(name) && !/\.novelty\./iu.test(voice.id);
    });
    function priority(voice) {
      const locale = voice.lang.replace(/_/gu, '-').toLowerCase();
      const preferredLocale = language === 'zh' ? /^zh-(cn|hans)(-|$)/u : /^en-us$/u;
      const standard = /^(Samantha|Daniel|Karen|Moira|Tessa|Tingting|婷婷|美嘉)(?:$|\s*[(（])/iu.test(voice.name);
      return Number(voice.localService) * 32 + Number(voice.default) * 16 +
        Number(/enhanced|premium|natural|siri|neural|增强|优质/iu.test(voice.name)) * 8 +
        Number(standard) * 4 + Number(preferredLocale.test(locale)) * 2;
    }
    return suitable.sort((a, b) => priority(b) - priority(a));
  }
  const nativeSpeechErrors = new Map([
    ['voice-unavailable', 'TTS_BROWSER_VOICE_UNAVAILABLE'], ['language-unavailable', 'TTS_BROWSER_LANGUAGE'],
    ['synthesis-unavailable', 'TTS_BROWSER_ENGINE'], ['synthesis-failed', 'TTS_BROWSER_ENGINE'],
    ['audio-busy', 'TTS_BROWSER_BUSY'], ['audio-hardware', 'TTS_BROWSER_DEVICE'],
    ['interrupted', 'TTS_BROWSER_INTERRUPTED'], ['canceled', 'TTS_BROWSER_INTERRUPTED'], ['network', 'TTS_BROWSER_NETWORK']
  ]);
  const serviceStatusMessages = new Map([
    [401, '朗读服务未通过身份验证，请检查朗读连接。'],
    [403, '当前连接没有使用此朗读服务的权限。'],
    [402, '朗读服务提示余额或额度不足。'],
    [429, '朗读服务当前限流，请稍后重试。']
  ]);
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
        timeoutMs: options.browserVoiceTimeoutMs ?? 3000 });
      if (!current(operation)) throw failure('TTS_CANCELLED', '朗读已停止。');
      if (!voices.length) throw failure('TTS_BROWSER_NO_VOICES', safeMessages.TTS_BROWSER_NO_VOICES, { phase: 'discovery' });
      const id = settings?.browser?.[operation.language === 'zh' ? 'voiceZh' : 'voiceEn'];
      let candidates;
      if (id) {
        candidates = validVoiceId(id) ? voices.filter(voice => voice.id === id) : [];
      } else {
        const ranked = readingVoices(operation.localOnly ? voices.filter(voice => voice.localService) : voices, operation.language);
        if (!ranked.length) throw failure('TTS_BROWSER_LANGUAGE', safeMessages.TTS_BROWSER_LANGUAGE, { phase: 'discovery' });
        candidates = ranked.filter(voice => voice.localService === ranked[0].localService).slice(0, 3);
      }
      const available = new Map(Array.from(synth.getVoices() || [], voice => [voice.voiceURI, voice]));
      operation.voiceChoices = candidates.filter(row => available.has(row.id)).map(row => ({ row, voice: available.get(row.id) }));
      if (!operation.voiceChoices.length) throw failure('TTS_BROWSER_VOICE_UNAVAILABLE', safeMessages.TTS_BROWSER_VOICE_UNAVAILABLE, { phase: 'discovery' });
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
      const choice = operation.voiceChoices[0];
      operation.browserVoice = choice.row;
      utterance.voice = choice.voice; utterance.lang = choice.voice.lang || (operation.language === 'zh' ? 'zh-CN' : 'en-US');
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
        if (!started) { utterance.onerror({ error: 'synthesis-failed' }); return; }
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
          return;
        }
        const code = nativeSpeechErrors.get(event?.error) || 'TTS_PLAY_FAILED';
        if (!started && operation.completed === 0 && operation.voiceChoices.length > 1 &&
            ['TTS_BROWSER_VOICE_UNAVAILABLE', 'TTS_BROWSER_ENGINE', 'TTS_BROWSER_LANGUAGE'].includes(code)) {
          operation.voiceChoices.shift();
          const resolveAttempt = operation.speechResolve;
          operation.speechResolve = null;
          disposeSpeech(operation, false);
          browserOwners.set(synth, { operation, stop });
          // Let the native engine finish releasing its failed utterance.
          setTimeout(() => {
            if (!current(operation)) { resolveAttempt(false); return; }
            try { resolveAttempt(playBrowser(operation)); }
            catch (error) { resolveAttempt(failOperation(operation, error)); }
          }, 0);
          return;
        }
        failOperation(operation, failure(code, safeMessages[code], { phase: 'playback' }));
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
      const httpMessage = errorCode === 'TTS_HTTP' && (serviceStatusMessages.get(details.httpStatus) ||
        (details.httpStatus >= 500 && '朗读服务暂时不可用，请稍后重试。'));
      stop();
      const serviceFailure = ['deepseek', 'online', 'local'].includes(operation.mode);
      progress(operation, 'error', { errorCode, errorMessage: httpMessage || safeMessages[errorCode] || '朗读失败，请检查设置。',
        errorDetails: details, canReadLocally: serviceFailure && operation.completed === 0 && Boolean(synth && UtteranceCtor) });
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
      return { bytes: Uint8Array.from(binary, character => character.charCodeAt(0)), mimeType: result.mimeType,
        playbackRate: operation.mode === 'deepseek' && Number.isFinite(result.playbackRate)
          ? Math.max(0.25, Math.min(4, result.playbackRate)) : 1 };
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
      operation.playbackRate = result.playbackRate || 1;
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
        operation.audio.playbackRate = operation.playbackRate;
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
          if (source.playbackRate) source.playbackRate.value = operation.playbackRate;
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
    async function speak({ text, event, automatic = false, language, localOnly = false } = {}) {
      if (destroyed || (automatic && active && !active.automatic)) return false;
      if (!trusted(event)) {
        if (!automatic) notify({ status: 'error', errorCode: 'TTS_GESTURE_REQUIRED' });
        return false;
      }
      stop();
      const selection = typeof text === 'string' ? text.trim() : '';
      if (!selection || Array.from(selection).length > MAX_SELECTION_CHARACTERS || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(selection)) {
        notify({ status: 'error', errorCode: 'TTS_INVALID_TEXT', errorMessage: safeMessages.TTS_INVALID_TEXT }); return false;
      }
      const id = `tts-${root.crypto?.randomUUID?.() || `${Date.now()}-${++sequence}-${Math.random().toString(36).slice(2)}`}`;
      const operation = { id, lease: null, leaseReady: false, requestId: `${id}-0`, controller: new AbortController(), dispatched: false,
        audio: null, url: '', context: null, chunks: splitTtsText(selection), index: 0, completed: 0, next: null,
        phase: 'settings', automatic: automatic === true, localOnly: localOnly === true,
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
        if (!automatic && !operation.localOnly) prime();
        // A manual click must still mean "read" while the deferred selection
        // handler is only finding out whether automatic playback is enabled.
        if (!automatic) progress(operation, 'loading');
        const settings = await send({ type: 'TTS_GET_PUBLIC_SETTINGS' }, operation);
        if (!currentOperation(operation)) return false;
        if (automatic && settings?.autoPlay !== true) { stop(); return false; }
        if (!current(operation)) { stop(); return false; }
        operation.mode = operation.localOnly ? 'browser' : settings?.mode || 'browser';
        if (operation.mode === 'browser') {
          await prepareBrowser(operation, operation.localOnly ? { speed: settings?.speed } : settings);
          return await playBrowser(operation);
        }
        if (!['local', 'online', 'deepseek'].includes(operation.mode)) throw failure('TTS_BROWSER_UNAVAILABLE', safeMessages.TTS_BROWSER_UNAVAILABLE);
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
