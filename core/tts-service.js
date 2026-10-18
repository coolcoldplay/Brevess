(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const TTS_MAX_TEXT_CHARACTERS = 5000;
  const TTS_MAX_AUDIO_BYTES = 8 * 1024 * 1024;
  const TTS_REQUEST_TIMEOUT_MS = 45000;
  const TTS_LOCAL_ENDPOINT = 'http://127.0.0.1:8880/v1/audio/speech';
  const voicePattern = /^[a-zA-Z0-9][a-zA-Z0-9_.+-]{0,79}$/;
  const plain = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const string = (value, fallback = '') => typeof value === 'string' ? value.trim() : fallback;
  // Voice URIs are opaque browser identifiers. Keep spaces/Unicode exactly;
  // malformed types remain invalid instead of becoming the automatic choice.
  const browserVoice = value => value === undefined ? '' : typeof value === 'string' ? value : '\u0000';
  const errors = {
    TTS_BROWSER_ONLY: '浏览器内置朗读应在当前页面播放，无需连接语音服务。',
    TTS_NOT_CONFIGURED: '请先保存完整的朗读服务配置。',
    TTS_INVALID_ENDPOINT: '朗读地址须为本机回环地址，或已配置的 HTTPS 在线语音接口。',
    TTS_INVALID_TEXT: '请选择 1–5000 个字符后朗读。',
    TTS_INVALID_VOICE: '请填写有效的中文或英文音色 ID。',
    TTS_INVALID_CONFIG: '朗读模型或密钥格式无效。',
    TTS_CANCELLED: '朗读已停止。',
    TTS_TIMEOUT: '朗读服务超时，请检查服务后重试。',
    TTS_NETWORK: '无法连接朗读服务，请确认服务已启动及地址可访问。',
    TTS_HTTP: '朗读服务拒绝了请求，请检查设置。',
    TTS_REDIRECT: '朗读服务发生跳转，已停止请求。请填写最终接口地址。',
    TTS_RESPONSE_TYPE: '朗读服务未返回支持的音频。',
    TTS_RESPONSE_SIZE: '朗读响应为空或超过大小限制，请缩短选区。',
    TTS_COMPATIBILITY: '此服务不支持 JSON 朗读模式；可在朗读设置中选择自动兼容或标准音频。',
    TTS_VOICES: '服务未返回音色列表；可以手动填写音色 ID。'
  };
  const diagnosticPhases = new Set(['settings', 'discovery', 'synthesis', 'receiving', 'decode-pcm', 'decode-audio', 'playback']);
  function ttsError(code, value) {
    const error = Object.assign(new Error(errors[code] || errors.TTS_NETWORK), { code });
    if (value && typeof value === 'object') {
      const details = {};
      if (diagnosticPhases.has(value.phase)) details.phase = value.phase;
      for (const key of ['elapsedMs', 'httpStatus', 'audioBytes']) {
        const number = value[key];
        if (Number.isSafeInteger(number) && number >= 0 &&
            (key !== 'httpStatus' || (number >= 100 && number <= 599)) &&
            (key !== 'audioBytes' || number <= TTS_MAX_AUDIO_BYTES * 2)) details[key] = number;
      }
      error.ttsDetails = details;
    }
    return error;
  }

  function normalizeTtsSettings(value) {
    const raw = plain(value);
    const local = plain(raw.local);
    const online = plain(raw.online);
    const browser = plain(raw.browser);
    const speed = Number(raw.speed);
    return {
      mode: ['local', 'online'].includes(raw.mode) ? raw.mode : 'browser',
      autoPlay: raw.autoPlay === true,
      speed: Number.isFinite(speed) && speed >= 0.25 && speed <= 4 ? speed : 1,
      browser: { voiceEn: browserVoice(browser.voiceEn), voiceZh: browserVoice(browser.voiceZh) },
      local: {
        endpoint: string(local.endpoint, TTS_LOCAL_ENDPOINT), model: string(local.model, 'kokoro'),
        transport: ['json-pcm', 'standard'].includes(local.transport) ? local.transport : 'auto',
        voiceEn: string(local.voiceEn, 'af_heart'), voiceZh: string(local.voiceZh, 'zf_xiaoxiao')
      },
      online: {
        endpoint: string(online.endpoint), model: string(online.model),
        voiceEn: string(online.voiceEn), voiceZh: string(online.voiceZh), apiKey: string(online.apiKey)
      }
    };
  }

  function mergeTtsSettings(current, patch) {
    const before = normalizeTtsSettings(current);
    const update = plain(patch);
    return normalizeTtsSettings({ ...before, ...update,
      browser: { ...before.browser, ...plain(update.browser) },
      local: { ...before.local, ...plain(update.local) },
      online: { ...before.online, ...plain(update.online) }
    });
  }

  function toPublicTtsSettings(value) {
    const settings = normalizeTtsSettings(value);
    const { apiKey, ...online } = settings.online;
    return { ...settings, online: { ...online, hasApiKey: Boolean(apiKey) } };
  }

  function validateTtsEndpoint(endpoint, mode) {
    let url;
    try { url = new URL(endpoint); } catch { throw ttsError('TTS_INVALID_ENDPOINT'); }
    const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname.toLowerCase());
    if (url.username || url.password || url.search || url.hash ||
        !url.pathname.endsWith('/audio/speech') || url.href.length > 2048 ||
        (mode === 'local' ? !loopback || !['http:', 'https:'].includes(url.protocol) : url.protocol !== 'https:')) {
      throw ttsError('TTS_INVALID_ENDPOINT');
    }
    return url.href;
  }

  function activeConfig(value) {
    const settings = normalizeTtsSettings(value);
    if (settings.mode === 'browser') throw ttsError('TTS_BROWSER_ONLY');
    const config = settings[settings.mode];
    if (!config.endpoint || !config.model) throw ttsError('TTS_NOT_CONFIGURED');
    const endpoint = validateTtsEndpoint(config.endpoint, settings.mode);
    if (config.model.length > 120 || /[\u0000-\u001f\u007f]/u.test(config.model) ||
        (config.apiKey && (config.apiKey.length > 4096 || /[\u0000-\u001f\u007f]/u.test(config.apiKey)))) {
      throw ttsError('TTS_INVALID_CONFIG');
    }
    return { settings, config, endpoint };
  }

  function getTtsPublicSettings(value) {
    const settings = normalizeTtsSettings(value);
    if (settings.mode === 'browser') {
      return { mode: settings.mode, autoPlay: settings.autoPlay, speed: settings.speed, configured: true,
        browser: { ...settings.browser } };
    }
    let configured = false;
    try {
      const { config } = activeConfig(settings);
      configured = voicePattern.test(config.voiceEn) && voicePattern.test(config.voiceZh);
    } catch { /* Invalid saved configuration must never cause a fallback upload. */ }
    return { mode: settings.mode, autoPlay: settings.autoPlay, speed: settings.speed, configured };
  }

  function validateBrowserTtsSettings(value) {
    const { browser } = normalizeTtsSettings(value);
    for (const voice of [browser.voiceEn, browser.voiceZh]) {
      if (voice.length > 512 || /[\u0000-\u001f\u007f-\u009f]/u.test(voice)) throw ttsError('TTS_INVALID_VOICE');
    }
  }

  function normalizeTtsVoices(value) {
    const candidates = Array.isArray(value) ? value : (value?.voices || value?.data);
    if (!Array.isArray(candidates)) throw ttsError('TTS_VOICES');
    const seen = new Set();
    const voices = [];
    for (const item of candidates.slice(0, 256)) {
      const id = string(typeof item === 'string' ? item : item?.id);
      if (!voicePattern.test(id) || seen.has(id)) continue;
      seen.add(id);
      voices.push({ id, name: string(item?.name, id).replace(/[\u0000-\u001f\u007f]/gu, '').slice(0, 100) || id });
    }
    if (!voices.length) throw ttsError('TTS_VOICES');
    return { voices, defaultVoice: seen.has(value?.default_voice) ? value.default_voice : '' };
  }

  function encodedAudio(bytes) {
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 16384) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 16384));
    }
    return btoa(binary);
  }

  function hasAudioSignature(bytes, mimeType) {
    if (mimeType === 'audio/mpeg') {
      return bytes.length >= 3 && ((bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) ||
        (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0));
    }
    return bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' &&
      String.fromCharCode(...bytes.subarray(8, 12)) === 'WAVE';
  }

  function createTtsService(options = {}) {
    const fetchImpl = options.fetchImpl || globalThis.fetch;
    const kokoroCapabilities = new Map();
    // Injectable shorter deadlines support deterministic tests; production cannot raise the cap.
    const timeoutMs = Math.max(1, Math.min(TTS_REQUEST_TIMEOUT_MS, Number(options.timeoutMs) || TTS_REQUEST_TIMEOUT_MS));
    async function requestBytes(endpoint, init, { signal, limit, acceptedTypes, phase = 'synthesis', deadline = Date.now() + timeoutMs }) {
      const started = Date.now();
      let stage = phase, httpStatus, total = 0;
      const diagnostics = () => ({ phase: stage, elapsedMs: Math.max(0, Date.now() - started), httpStatus, audioBytes: total });
      const controller = new AbortController();
      let timedOut = false;
      const abort = () => controller.abort();
      if (signal?.aborted) throw ttsError('TTS_CANCELLED', diagnostics());
      signal?.addEventListener('abort', abort, { once: true });
      const remaining = Math.min(timeoutMs, deadline - Date.now());
      if (remaining <= 0) { signal?.removeEventListener('abort', abort); throw ttsError('TTS_TIMEOUT', diagnostics()); }
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, remaining);
      let rejectAbort;
      const aborted = new Promise((_, reject) => { rejectAbort = () => reject(ttsError(timedOut ? 'TTS_TIMEOUT' : 'TTS_CANCELLED')); });
      controller.signal.addEventListener('abort', rejectAbort, { once: true });
      let reader;
      try {
        const response = await Promise.race([fetchImpl(endpoint, { ...init, signal: controller.signal,
          redirect: 'error', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' }), aborted]);
        httpStatus = response.status;
        if (response.redirected || (response.url && response.url !== endpoint) ||
            (response.status >= 300 && response.status < 400) || response.type === 'opaqueredirect') throw ttsError('TTS_REDIRECT');
        if (!response.ok) throw ttsError('TTS_HTTP');
        let mimeType = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        if (['audio/mp3', 'audio/x-mp3'].includes(mimeType)) mimeType = 'audio/mpeg';
        if (mimeType === 'audio/x-wav') mimeType = 'audio/wav';
        if (!acceptedTypes.includes(mimeType)) throw ttsError('TTS_RESPONSE_TYPE');
        const length = response.headers.get('content-length');
        if (length !== null && (!/^\d+$/u.test(length) || Number(length) > limit || Number(length) < 1)) throw ttsError('TTS_RESPONSE_SIZE');
        if (!response.body?.getReader) throw ttsError('TTS_RESPONSE_TYPE');
        reader = response.body.getReader();
        stage = phase === 'discovery' ? 'discovery' : 'receiving';
        const chunks = [];
        while (true) {
          const { done, value } = await Promise.race([reader.read(), aborted]);
          if (done) break;
          total += value.byteLength;
          if (total > limit) throw ttsError('TTS_RESPONSE_SIZE');
          chunks.push(value);
        }
        if (!total) throw ttsError('TTS_RESPONSE_SIZE');
        const bytes = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        return { bytes, mimeType };
      } catch (error) {
        if (controller.signal.aborted) throw ttsError(timedOut ? 'TTS_TIMEOUT' : 'TTS_CANCELLED', diagnostics());
        if (Object.hasOwn(errors, error?.code)) throw ttsError(error.code, diagnostics());
        throw ttsError('TTS_NETWORK', diagnostics());
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        controller.signal.removeEventListener('abort', rejectAbort);
        if (reader) { try { void reader.cancel().catch(() => {}); } catch { /* Already closed. */ } }
        controller.abort();
      }
    }

    async function kokoroJsonEndpoint(endpoint, signal, deadline) {
      const base = endpoint.replace(/\/(?:v1\/)?audio\/speech$/u, '');
      const target = `${base}/dev/captioned_speech`;
      if (kokoroCapabilities.get(endpoint) > Date.now()) return target;
      const { bytes } = await requestBytes(`${base}/openapi.json`,
        { method: 'GET', headers: { Accept: 'application/json' } },
        { signal, phase: 'discovery', deadline: Math.min(deadline, Date.now() + 5000), limit: 256 * 1024, acceptedTypes: ['application/json'] });
      let spec;
      try { spec = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw ttsError('TTS_COMPATIBILITY', { phase: 'discovery' }); }
      const post = spec?.paths?.['/dev/captioned_speech']?.post;
      const ref = post?.requestBody?.content?.['application/json']?.schema?.$ref;
      const schemaName = typeof ref === 'string' && /^#\/components\/schemas\/[A-Za-z0-9_]+$/u.test(ref) ? ref.split('/').at(-1) : '';
      const properties = spec?.components?.schemas?.[schemaName]?.properties;
      if (!/kokoro/iu.test(String(spec?.info?.title || '')) ||
          !properties?.response_format?.enum?.includes?.('pcm') ||
          properties?.stream?.type !== 'boolean' || properties?.return_timestamps?.type !== 'boolean') {
        throw ttsError('TTS_COMPATIBILITY', { phase: 'discovery' });
      }
      if (kokoroCapabilities.size >= 16) kokoroCapabilities.delete(kokoroCapabilities.keys().next().value);
      kokoroCapabilities.set(endpoint, Date.now() + 5 * 60 * 1000);
      return target;
    }

    function pcmJsonToWav(bytes) {
      let response;
      try { response = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw ttsError('TTS_RESPONSE_TYPE'); }
      const audio = response?.audio;
      if (response?.audio_format !== 'audio/pcm' || typeof audio !== 'string' || !audio.length ||
          audio.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(audio)) throw ttsError('TTS_RESPONSE_TYPE');
      const size = audio.length / 4 * 3 - (audio.endsWith('==') ? 2 : audio.endsWith('=') ? 1 : 0);
      if (size + 44 > TTS_MAX_AUDIO_BYTES) throw ttsError('TTS_RESPONSE_SIZE');
      if (size < 2 || size % 2) throw ttsError('TTS_RESPONSE_TYPE');
      let raw;
      try { raw = atob(audio); } catch { throw ttsError('TTS_RESPONSE_TYPE'); }
      if (raw.length !== size) throw ttsError('TTS_RESPONSE_TYPE');
      // Kokoro's PCM writer emits mono signed 16-bit little-endian at 24 kHz.
      // Only this in-memory WAV reaches the player; the HTTP response is JSON.
      const wav = new Uint8Array(44 + size);
      const view = new DataView(wav.buffer);
      const label = (offset, text) => { for (let i = 0; i < text.length; i++) wav[offset + i] = text.charCodeAt(i); };
      label(0, 'RIFF'); view.setUint32(4, 36 + size, true); label(8, 'WAVE'); label(12, 'fmt ');
      view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
      view.setUint32(24, 24000, true); view.setUint32(28, 48000, true);
      view.setUint16(32, 2, true); view.setUint16(34, 16, true); label(36, 'data'); view.setUint32(40, size, true);
      for (let i = 0; i < size; i++) wav[44 + i] = raw.charCodeAt(i);
      return wav;
    }

    async function synthesize(input, { settings: value, signal } = {}) {
        const deadline = Date.now() + timeoutMs;
        const { settings, config, endpoint } = activeConfig(value);
        const text = typeof input?.text === 'string' ? input.text.trim() : '';
        if (!text || Array.from(text).length > TTS_MAX_TEXT_CHARACTERS || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text)) throw ttsError('TTS_INVALID_TEXT');
        const language = input?.language === 'zh' || (input?.language !== 'en' && /\p{Script=Han}/u.test(text)) ? 'zh' : 'en';
        const voice = language === 'zh' ? config.voiceZh : config.voiceEn;
        if (!voicePattern.test(voice)) throw ttsError('TTS_INVALID_VOICE');
        const body = { model: config.model, input: text, voice, response_format: 'mp3', speed: settings.speed };
        if (settings.mode === 'local') Object.assign(body, { stream: false, return_download_link: false, allow_voice_tags: false, ssml: false });
        let target = '';
        if (settings.mode === 'local' && config.transport !== 'standard' && /^kokoro(?:[-_].*)?$/iu.test(config.model)) {
          try { target = await kokoroJsonEndpoint(endpoint, signal, deadline); }
          catch (error) {
            // Capability discovery carries no selected text. Older compatible
            // services retain their original endpoint when discovery is absent.
            if (signal?.aborted || ['TTS_CANCELLED', 'TTS_REDIRECT'].includes(error?.code) || Date.now() >= deadline) throw error;
            if (config.transport === 'json-pcm') throw ttsError('TTS_COMPATIBILITY', error?.ttsDetails || { phase: 'discovery' });
          }
        } else if (settings.mode === 'local' && config.transport === 'json-pcm') throw ttsError('TTS_COMPATIBILITY');
        if (target) {
          if (signal?.aborted) throw ttsError('TTS_CANCELLED');
          Object.assign(body, { response_format: 'pcm', return_timestamps: false });
          const result = await requestBytes(target, { method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) },
          { signal, deadline, limit: Math.ceil(TTS_MAX_AUDIO_BYTES / 3) * 4 + 65536, acceptedTypes: ['application/json'] });
          let wav;
          try { wav = pcmJsonToWav(result.bytes); }
          catch (error) { throw ttsError(error.code, { phase: 'decode-pcm', audioBytes: result.bytes.length }); }
          return { audioBase64: encodedAudio(wav), mimeType: 'audio/wav', byteLength: wav.length, voice, language };
        }
        const headers = { 'Content-Type': 'application/json', Accept: 'audio/mpeg, audio/wav' };
        if (settings.mode === 'online' && config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
        const { bytes, mimeType } = await requestBytes(endpoint, { method: 'POST', headers, body: JSON.stringify(body) },
          { signal, deadline, limit: TTS_MAX_AUDIO_BYTES, acceptedTypes: ['audio/mpeg', 'audio/wav'] });
        if (!hasAudioSignature(bytes, mimeType)) throw ttsError('TTS_RESPONSE_TYPE', { phase: 'decode-audio', audioBytes: bytes.length });
        return { audioBase64: encodedAudio(bytes), mimeType, byteLength: bytes.length, voice, language };
    }
    return {
      async synthesize(input, options) {
        const started = Date.now();
        try { return await synthesize(input, options); }
        catch (error) {
          const code = Object.hasOwn(errors, error?.code) ? error.code : 'TTS_NETWORK';
          throw ttsError(code, { phase: 'settings', ...error?.ttsDetails, elapsedMs: Math.max(0, Date.now() - started) });
        }
      },
      async listVoices({ settings: value, signal } = {}) {
        const { settings, config, endpoint } = activeConfig(value);
        const url = endpoint.slice(0, -'speech'.length) + 'voices';
        const headers = { Accept: 'application/json' };
        if (settings.mode === 'online' && config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
        const { bytes } = await requestBytes(url, { method: 'GET', headers },
          { signal, limit: 128 * 1024, acceptedTypes: ['application/json'] });
        try { return normalizeTtsVoices(JSON.parse(new TextDecoder().decode(bytes))); }
        catch { throw ttsError('TTS_VOICES'); }
      }
    };
  }
  return { TTS_MAX_TEXT_CHARACTERS, TTS_MAX_AUDIO_BYTES, TTS_REQUEST_TIMEOUT_MS, TTS_LOCAL_ENDPOINT,
    normalizeTtsSettings, mergeTtsSettings, toPublicTtsSettings, getTtsPublicSettings,
    validateTtsEndpoint, validateBrowserTtsSettings, normalizeTtsVoices, createTtsService };
});
