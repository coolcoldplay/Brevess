'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const readline = require('node:readline');
const { spawn, spawnSync } = require('node:child_process');

const HOST_VERSION = '1.0.0';
const MAX_NATIVE_INPUT_BYTES = 64 * 1024 * 1024;
const MAX_NATIVE_OUTPUT_BYTES = 900 * 1024;
const DEFAULT_APP_SERVER_TIMEOUT_MS = 30000;
const MAX_TURN_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_TURN_IMAGE_TOTAL_BYTES = 24 * 1024 * 1024;
const MAX_TURN_IMAGES = 8;
const MAX_READER_EVENT_BYTES = 4 * 1024 * 1024;
const MAX_READER_EVENT_LOG_BYTES = 16 * 1024 * 1024;

function stateDirectory() {
  const root = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(root, 'BrevessCodexBridge');
}

function codexHomeDirectory() {
  return path.join(stateDirectory(), 'codex-home');
}

function readerEventDirectory() {
  return path.join(stateDirectory(), 'reader-events');
}

function turnImageDirectory() {
  return path.join(stateDirectory(), 'turn-images');
}

function sanitizeLogText(value) {
  return String(value || '')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/sk-[A-Za-z0-9_-]{8,}/gi, '[redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]{8,})?\b/g,
      '[redacted-jwt]')
    .replace(/("(?:access|refresh|id)_?token"\s*:\s*")[^"]+("?)/gi, '$1[redacted]$2');
}

function appendLog(message) {
  try {
    const directory = stateDirectory();
    fs.mkdirSync(directory, { recursive: true });
    fs.appendFileSync(
      path.join(directory, 'bridge.log'),
      `${new Date().toISOString()} ${sanitizeLogText(message).slice(0, 8000)}\n`,
      'utf8'
    );
  } catch (_) {
    // Logging must never corrupt Native Messaging stdout.
  }
}

function codedError(code, message, retryable = false) {
  const error = new Error(String(message || code));
  error.code = code;
  error.retryable = retryable === true;
  return error;
}

function safeChildPath(root, candidate) {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  if (resolvedCandidate !== resolvedRoot &&
      !resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw codedError('INVALID_SETTINGS', 'Local bridge path escaped its storage directory');
  }
  return resolvedCandidate;
}

function normalizeImageDetail(value) {
  const detail = String(value || 'high');
  return ['auto', 'low', 'high', 'original'].includes(detail) ? detail : 'high';
}

function decodeDataImage(value) {
  const match = String(value || '').match(
    /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/i
  );
  if (!match) {
    throw codedError(
      'INVALID_SETTINGS',
      'Local Codex received an unsupported Figure image format'
    );
  }
  const mediaType = match[1].toLowerCase();
  const bytes = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
  if (!bytes.length || bytes.length > MAX_TURN_IMAGE_BYTES) {
    throw codedError(
      'INVALID_SETTINGS',
      'A Figure image exceeded the local Codex bridge limit'
    );
  }
  const extension = mediaType === 'image/png'
    ? 'png' : mediaType === 'image/webp' ? 'webp' : 'jpg';
  return { bytes, extension, mediaType };
}

class TurnImageStore {
  constructor(root = turnImageDirectory()) {
    this.root = path.resolve(root);
    this.cleanupStale();
  }

  cleanupStale(maxAgeMs = 60 * 60 * 1000) {
    let entries = [];
    try {
      entries = fs.readdirSync(this.root, { withFileTypes: true });
    } catch (_) {
      return;
    }
    const cutoff = Date.now() - Math.max(60000, Number(maxAgeMs) || 0);
    entries.filter(entry => entry.isDirectory()).forEach(entry => {
      const directory = safeChildPath(this.root, path.join(this.root, entry.name));
      try {
        if (fs.statSync(directory).mtimeMs < cutoff) {
          fs.rmSync(directory, { recursive: true, force: true });
        }
      } catch (_) {
        // Another active host may still own the directory.
      }
    });
  }

  materialize(requestId, rawImages) {
    const images = Array.isArray(rawImages)
      ? rawImages.slice(0, MAX_TURN_IMAGES) : [];
    if (!images.length) return { directory: '', inputs: [], imageCount: 0 };
    this.cleanupStale();
    const requestHash = crypto.createHash('sha256')
      .update(String(requestId || crypto.randomUUID()))
      .digest('hex').slice(0, 24);
    const directory = safeChildPath(this.root, path.join(this.root, requestHash));
    fs.mkdirSync(directory, { recursive: true });
    const inputs = [];
    let totalBytes = 0;
    try {
      images.forEach((image, index) => {
        const decoded = decodeDataImage(image?.dataUrl || image);
        totalBytes += decoded.bytes.length;
        if (totalBytes > MAX_TURN_IMAGE_TOTAL_BYTES) {
          throw codedError(
            'INVALID_SETTINGS',
            'Figure images exceeded the local Codex bridge total limit'
          );
        }
        const filePath = safeChildPath(
          directory,
          path.join(directory, `figure-${index + 1}.${decoded.extension}`)
        );
        fs.writeFileSync(filePath, decoded.bytes);
        inputs.push({
          type: 'localImage',
          path: filePath,
          detail: normalizeImageDetail(image?.detail)
        });
      });
      return { directory, inputs, imageCount: inputs.length };
    } catch (error) {
      this.cleanup({ directory });
      throw error;
    }
  }

  cleanup(lease) {
    const directory = String(lease?.directory || '');
    if (!directory) return;
    const safeDirectory = safeChildPath(this.root, directory);
    if (safeDirectory === this.root) return;
    try {
      fs.rmSync(safeDirectory, { recursive: true, force: true });
    } catch (error) {
      appendLog(`turn image cleanup failed: ${error.message}`);
    }
  }
}

function sanitizeReaderEvent(event = {}) {
  const eventType = String(event.eventType || '');
  if (!/^reader\.(?:figure|panel|cross_figure|article)\.(?:progress|result|error)$/.test(
    eventType
  )) {
    throw codedError('INVALID_SETTINGS', 'Unknown reader reverse-channel event');
  }
  const scrub = (value, key = '', depth = 0) => {
    if (depth > 16) return null;
    if (/^(?:dataUrl|images|imageVariants|apiKey|accessToken|refreshToken|idToken)$/i.test(
      key
    )) return undefined;
    if (Array.isArray(value)) {
      return value.slice(0, 500)
        .map(item => scrub(item, '', depth + 1))
        .filter(item => item !== undefined);
    }
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).slice(0, 500)
        .map(([childKey, childValue]) => [
          childKey,
          scrub(childValue, childKey, depth + 1)
        ])
        .filter(([, childValue]) => childValue !== undefined));
    }
    if (typeof value === 'string') return value.slice(0, 500000);
    return value;
  };
  const sanitized = scrub(event);
  const serialized = JSON.stringify(sanitized);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_READER_EVENT_BYTES) {
    throw codedError('INVALID_SETTINGS', 'Reader reverse-channel event is too large');
  }
  const clone = JSON.parse(serialized);
  delete clone.eventId;
  delete clone.receivedAt;
  return clone;
}

class ReaderEventStore {
  constructor(root = readerEventDirectory()) {
    this.root = path.resolve(root);
    this.logPath = path.join(this.root, 'events.ndjson');
    this.latestPath = path.join(this.root, 'latest.json');
    this.state = { version: 1, updatedAt: '', latest: null, streams: {} };
    this.load();
  }

  load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.latestPath, 'utf8'));
      if (parsed?.version === 1 && parsed.streams &&
          typeof parsed.streams === 'object') {
        this.state = parsed;
      }
    } catch (_) {
      this.state = { version: 1, updatedAt: '', latest: null, streams: {} };
    }
  }

  paths() {
    return {
      eventLogPath: this.logPath,
      latestEventPath: this.latestPath
    };
  }

  rotateLogIfNeeded() {
    let size = 0;
    try {
      size = fs.statSync(this.logPath).size;
    } catch (_) {
      return;
    }
    if (size < MAX_READER_EVENT_LOG_BYTES) return;
    const archived = path.join(this.root, 'events.previous.ndjson');
    try {
      fs.rmSync(archived, { force: true });
      fs.renameSync(this.logPath, archived);
    } catch (error) {
      appendLog(`reader event log rotation failed: ${error.message}`);
    }
  }

  publish(event) {
    const normalized = sanitizeReaderEvent(event);
    fs.mkdirSync(this.root, { recursive: true });
    const receivedAt = new Date().toISOString();
    const record = {
      version: 1,
      eventId: crypto.randomUUID(),
      receivedAt,
      ...normalized
    };
    const streamSeed = String(
      normalized.streamKey ||
      `${normalized.source?.url || ''}\0${normalized.operationId || ''}\0${normalized.eventType}`
    );
    const streamKey = crypto.createHash('sha256')
      .update(streamSeed).digest('hex').slice(0, 24);
    this.rotateLogIfNeeded();
    fs.appendFileSync(this.logPath, `${JSON.stringify(record)}\n`, 'utf8');
    this.state = {
      version: 1,
      updatedAt: receivedAt,
      latest: record,
      streams: {
        ...this.state.streams,
        [streamKey]: {
          updatedAt: receivedAt,
          eventType: record.eventType,
          source: record.source || {},
          operationId: String(record.operationId || ''),
          latest: record
        }
      }
    };
    const streamEntries = Object.entries(this.state.streams)
      .sort((left, right) =>
        String(right[1]?.updatedAt || '').localeCompare(String(left[1]?.updatedAt || '')))
      .slice(0, 100);
    this.state.streams = Object.fromEntries(streamEntries);
    fs.writeFileSync(this.latestPath, JSON.stringify(this.state, null, 2), 'utf8');
    return { eventId: record.eventId, receivedAt, ...this.paths() };
  }
}

function classifyCodexError(message, fallback = 'CODEX_PROVIDER_REJECTED') {
  const text = String(message || '');
  if (/(?:not signed in|not logged in|token[_ -]?expired|authentication token|refresh token|401 unauthorized)/i.test(text)) {
    return codedError(
      'CODEX_NOT_AUTHENTICATED',
      'The Brevess Codex session expired. Sign in again from extension settings.'
    );
  }
  if (/\b(?:502|503|504)\b|bad gateway|server overloaded|temporarily unavailable/i.test(text)) {
    return codedError(
      'PROVIDER_UNAVAILABLE',
      'The Codex service is temporarily unavailable. Please retry shortly.',
      true
    );
  }
  if (/context window|too many tokens|maximum context/i.test(text)) {
    return codedError(
      'CONTEXT_BUDGET_EXCEEDED',
      'The local Codex context window cannot fit this request.'
    );
  }
  if (/usage limit|quota|rate limit/i.test(text)) {
    return codedError(
      'QUOTA_EXHAUSTED',
      'The current Codex account has reached its usage limit.'
    );
  }
  return codedError(fallback, text || 'Codex rejected the request');
}

function classifyTurnError(turnError = {}) {
  const info = turnError?.codexErrorInfo;
  const infoName = typeof info === 'string'
    ? info
    : String(Object.keys(info || {})[0] || '');
  const status = Number(
    typeof info === 'object'
      ? info?.[infoName]?.httpStatusCode
      : 0
  ) || 0;
  if (infoName === 'unauthorized' || status === 401) {
    return codedError(
      'CODEX_NOT_AUTHENTICATED',
      'The Brevess Codex session has expired. Sign in again from extension settings.'
    );
  }
  if (infoName === 'usageLimitExceeded' || status === 429) {
    return codedError(
      'QUOTA_EXHAUSTED',
      'The current Codex account has reached its usage limit.'
    );
  }
  if (infoName === 'contextWindowExceeded') {
    return codedError(
      'CONTEXT_BUDGET_EXCEEDED',
      'The local Codex context window cannot fit this request.'
    );
  }
  if (infoName === 'serverOverloaded' ||
      ['httpConnectionFailed', 'responseStreamConnectionFailed',
        'responseStreamDisconnected', 'responseTooManyFailedAttempts'].includes(infoName) ||
      [502, 503, 504].includes(status)) {
    const error = codedError(
      'PROVIDER_UNAVAILABLE',
      'The Codex service is temporarily unavailable. Please retry shortly.',
      true
    );
    if (status) error.status = status;
    return error;
  }
  const error = classifyCodexError(turnError?.message);
  if (status) error.status = status;
  return error;
}

function findCodexBinary() {
  const configured = String(process.env.SCI_READER_CODEX_BIN || '').trim();
  if (configured && fs.existsSync(configured)) return configured;
  const command = process.platform === 'win32' ? 'where.exe' : 'which';
  const names = process.platform === 'win32' ? ['codex', 'codex.exe'] : ['codex'];
  for (const name of names) {
    const result = spawnSync(command, [name], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000
    });
    const candidates = String(result.stdout || '').split(/\r?\n/)
      .map(item => item.trim()).filter(Boolean);
    const executable = process.platform === 'win32'
      ? candidates.find(candidate => fs.existsSync(candidate) && /\.(?:cmd|bat)$/i.test(candidate)) ||
        candidates.find(candidate => fs.existsSync(candidate) && /\.exe$/i.test(candidate))
      : candidates.find(candidate => fs.existsSync(candidate));
    if (executable) return executable;
  }
  throw codedError(
    'CODEX_NOT_INSTALLED',
    'Codex was not found. Install Codex and run "codex login" first.'
  );
}

function codexSpawnSpec(binary) {
  const appServerArgs = [
    'app-server',
    '--disable', 'shell_tool',
    '--config', 'web_search="disabled"'
  ];
  if (process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(binary)) {
    const npmEntry = path.join(
      path.dirname(binary),
      'node_modules',
      '@openai',
      'codex',
      'bin',
      'codex.js'
    );
    if (fs.existsSync(npmEntry)) {
      const nodeLookup = spawnSync('where.exe', ['node.exe'], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 5000
      });
      const nodeBinary = String(nodeLookup.stdout || '').split(/\r?\n/)
        .map(item => item.trim())
        .find(candidate => candidate && fs.existsSync(candidate));
      if (nodeBinary) {
        return { command: nodeBinary, args: [npmEntry, ...appServerArgs] };
      }
    }
    return {
      command: binary,
      args: appServerArgs,
      shell: true
    };
  }
  return { command: binary, args: appServerArgs };
}

class CodexAppServer {
  constructor(options = {}) {
    this.spawnImpl = options.spawnImpl || spawn;
    this.binary = options.binary || null;
    this.child = null;
    this.requestSequence = 0;
    this.pending = new Map();
    this.notificationListeners = new Set();
    this.initializeResult = null;
    this.startPromise = null;
  }

  async start() {
    if (this.initializeResult && this.child && !this.child.killed) {
      return this.initializeResult;
    }
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.startInternal().finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  async startInternal() {
    this.binary = this.binary || findCodexBinary();
    const directory = stateDirectory();
    fs.mkdirSync(directory, { recursive: true });
    const codexHome = codexHomeDirectory();
    fs.mkdirSync(codexHome, { recursive: true });
    const launch = codexSpawnSpec(this.binary);
    const child = this.spawnImpl(launch.command, launch.args, {
      cwd: directory,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: launch.shell === true,
      env: {
        ...process.env,
        CODEX_HOME: codexHome,
        CODEX_SQLITE_HOME: codexHome,
        NO_COLOR: '1'
      }
    });
    this.child = child;
    child.stderr.on('data', chunk => appendLog(`app-server: ${chunk}`));
    child.on('error', error => this.failAll(codedError(
      'CODEX_BRIDGE_UNAVAILABLE',
      `Unable to start Codex: ${error.message}`,
      true
    )));
    child.on('exit', (code, signal) => {
      this.initializeResult = null;
      this.child = null;
      this.failAll(codedError(
        'CODEX_BRIDGE_UNAVAILABLE',
        `Codex App Server exited (${code ?? signal ?? 'unknown'})`,
        true
      ));
    });
    const lines = readline.createInterface({ input: child.stdout });
    lines.on('line', line => this.handleLine(line));
    const initialized = await this.request('initialize', {
      clientInfo: {
        name: 'brevess_browser_extension',
        title: 'Brevess',
        version: HOST_VERSION
      },
      capabilities: null
    });
    this.notify('initialized', {});
    this.initializeResult = initialized;
    return initialized;
  }

  handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch (_) {
      appendLog(`ignored non-JSON app-server output: ${line}`);
      return;
    }
    if (Object.prototype.hasOwnProperty.call(message, 'id') &&
        (Object.prototype.hasOwnProperty.call(message, 'result') ||
         Object.prototype.hasOwnProperty.call(message, 'error'))) {
      const pending = this.pending.get(String(message.id));
      if (!pending) return;
      this.pending.delete(String(message.id));
      clearTimeout(pending.timer);
      if (message.error) {
        pending.reject(classifyCodexError(message.error.message));
      } else {
        pending.resolve(message.result);
      }
      return;
    }
    if (Object.prototype.hasOwnProperty.call(message, 'id') && message.method) {
      this.write({
        id: message.id,
        error: { code: -32601, message: 'Client-side tool requests are disabled' }
      });
      return;
    }
    if (message.method) {
      for (const listener of this.notificationListeners) {
        try {
          listener(message);
        } catch (error) {
          appendLog(`notification listener failed: ${error.stack || error}`);
        }
      }
    }
  }

  write(message) {
    if (!this.child?.stdin?.writable) {
      throw codedError('CODEX_BRIDGE_UNAVAILABLE', 'Codex App Server is not running', true);
    }
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  request(method, params, timeoutMs = DEFAULT_APP_SERVER_TIMEOUT_MS) {
    const id = String(++this.requestSequence);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(codedError(
          'REQUEST_TIMEOUT',
          `Codex App Server timed out during ${method}`,
          true
        ));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.write({ method, id: Number(id), params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  notify(method, params) {
    this.write({ method, params });
  }

  onNotification(listener) {
    this.notificationListeners.add(listener);
    return () => this.notificationListeners.delete(listener);
  }

  failAll(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  close() {
    try {
      this.child?.kill();
    } catch (_) {
      // Browser shutdown already ended the child.
    }
  }
}

class ThreadMap {
  constructor(filePath = path.join(stateDirectory(), 'threads.json')) {
    this.filePath = filePath;
    this.data = { version: 1, threads: {} };
    this.load();
  }

  load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (parsed?.version === 1 && parsed.threads && typeof parsed.threads === 'object') {
        this.data = parsed;
      }
    } catch (_) {
      this.data = { version: 1, threads: {} };
    }
  }

  storageKey(conversationKey, profileId) {
    return crypto.createHash('sha256')
      .update(`${String(conversationKey)}\0${String(profileId)}`)
      .digest('hex');
  }

  get(conversationKey, profileId) {
    if (!conversationKey) return '';
    return String(
      this.data.threads[this.storageKey(conversationKey, profileId)]?.threadId || ''
    );
  }

  set(conversationKey, profileId, threadId, label = '') {
    if (!conversationKey || !threadId) return;
    this.data.threads[this.storageKey(conversationKey, profileId)] = {
      threadId: String(threadId),
      label: String(label || '').slice(0, 500),
      updatedAt: new Date().toISOString()
    };
    this.save();
  }

  delete(conversationKey, profileId) {
    if (!conversationKey) return;
    delete this.data.threads[this.storageKey(conversationKey, profileId)];
    this.save();
  }

  clear() {
    this.data = { version: 1, threads: {} };
    this.save();
  }

  save() {
    const directory = path.dirname(this.filePath);
    fs.mkdirSync(directory, { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(this.data, null, 2), 'utf8');
    fs.renameSync(temporary, this.filePath);
  }
}

function publicError(error) {
  const result = {
    code: String(error?.code || 'CODEX_BRIDGE_UNAVAILABLE'),
    message: String(error?.message || 'Local Codex failed').slice(0, 1000),
    retryable: error?.retryable === true
  };
  if (Number.isFinite(error?.status) && error.status > 0) {
    result.status = Math.max(0, Math.min(599, Math.round(error.status)));
  }
  return result;
}

class CodexBridgeHost {
  constructor(options = {}) {
    this.server = options.server || new CodexAppServer(options);
    this.threadMap = options.threadMap || new ThreadMap(options.threadMapPath);
    this.imageStore = options.imageStore ||
      new TurnImageStore(options.turnImageRoot || turnImageDirectory());
    this.eventStore = options.eventStore ||
      new ReaderEventStore(options.readerEventRoot || readerEventDirectory());
    this.send = options.send || (() => {});
    this.active = new Map();
    this.pendingCancellations = new Set();
    this.loginRequests = new Map();
    this.unsubscribe = this.server.onNotification(message =>
      this.handleServerNotification(message)
    );
  }

  async health(requestId) {
    try {
      const initialized = await this.server.start();
      // A health check must not proactively rotate a refresh token. A real
      // ephemeral model probe is performed by the extension connection test.
      const account = await this.server.request('account/read', { refreshToken: false });
      if (account?.requiresOpenaiAuth && !account?.account) {
        throw codedError(
          'CODEX_NOT_AUTHENTICATED',
          'The Brevess Codex session is not signed in. Use extension settings to sign in.'
        );
      }
      this.send({
        type: 'health.result',
        requestId,
        connected: true,
        hostVersion: HOST_VERSION,
        userAgent: initialized?.userAgent || '',
        platformOs: initialized?.platformOs || process.platform,
        accountType: account?.account?.type || 'unknown',
        planType: account?.account?.planType || '',
        ...this.eventStore.paths()
      });
    } catch (error) {
      this.send({ type: 'host.error', requestId, error: publicError(error) });
    }
  }

  async startLogin(requestId, force = false) {
    try {
      await this.server.start();
      if (force) {
        await this.server.request('account/logout', {});
        this.threadMap.clear?.();
      }
      const result = await this.server.request('account/login/start', {
        type: 'chatgpt',
        codexStreamlinedLogin: true
      });
      const loginId = String(result?.loginId || '');
      const authUrl = String(result?.authUrl || '');
      if (!loginId || !/^https:\/\/(?:auth\.openai\.com|chatgpt\.com)\//i.test(authUrl)) {
        throw codedError(
          'CODEX_PROVIDER_REJECTED',
          'Codex did not return a valid ChatGPT sign-in URL'
        );
      }
      this.loginRequests.set(loginId, requestId);
      this.send({
        type: 'auth.login.started',
        requestId,
        loginId,
        authUrl
      });
    } catch (error) {
      this.send({ type: 'host.error', requestId, error: publicError(error) });
    }
  }

  async logout(requestId) {
    try {
      await this.server.start();
      await this.server.request('account/logout', {});
      this.threadMap.clear?.();
      this.send({ type: 'auth.logout.result', requestId, success: true });
    } catch (error) {
      this.send({ type: 'host.error', requestId, error: publicError(error) });
    }
  }

  async ensureThread(message) {
    const conversationKey = String(message.conversationKey || '');
    const profileId = String(message.profileId || '');
    const existing = message.ephemeral === true
      ? '' : this.threadMap.get(conversationKey, profileId);
    const model = String(message.model || 'auto');
    const baseInstructions = [
      'You are the text-generation engine embedded in a scientific paper reader.',
      'Do not use shell commands, files, web search, MCP tools, apps, or code-editing tools.',
      'Return only the payload requested by the supplied instructions.',
      String(message.systemPrompt || '')
    ].filter(Boolean).join('\n\n');
    const developerInstructions = [
      'Answer exclusively from the supplied article context.',
      'Do not describe your internal reasoning or the Codex environment.',
      message.maxOutputTokens
        ? `Keep the response within approximately ${Number(message.maxOutputTokens)} tokens.`
        : ''
    ].filter(Boolean).join(' ');
    const common = {
      ...(model && model !== 'auto' ? { model } : {}),
      cwd: stateDirectory(),
      approvalPolicy: 'never',
      sandbox: 'read-only',
      baseInstructions,
      developerInstructions
    };
    if (existing) {
      try {
        const resumed = await this.server.request('thread/resume', {
          threadId: existing,
          ...common
        });
        return resumed.thread.id;
      } catch (error) {
        appendLog(`thread resume failed; creating a new thread: ${error.message}`);
        this.threadMap.delete(conversationKey, profileId);
      }
    }
    const started = await this.server.request('thread/start', {
      ...common,
      ephemeral: message.ephemeral === true
    });
    const threadId = String(started?.thread?.id || '');
    if (!threadId) {
      throw codedError('CODEX_PROVIDER_REJECTED', 'Codex did not return a thread ID');
    }
    if (message.ephemeral !== true) {
      this.threadMap.set(
        conversationKey,
        profileId,
        threadId,
        message.conversationLabel
      );
    }
    return threadId;
  }

  async startTurn(message) {
    const requestId = String(message.requestId || '');
    if (!requestId) return;
    let context = null;
    let imageLease = null;
    try {
      await this.server.start();
      const threadId = await this.ensureThread(message);
      const effort = String(message.reasoningEffort || 'auto');
      imageLease = this.imageStore.materialize(requestId, message.images);
      context = {
        requestId,
        threadId,
        turnId: '',
        phases: new Map(),
        sentByItem: new Map(),
        usage: null,
        cancelPending: false,
        startedSent: false,
        imageLease
      };
      // Register before turn/start so very fast app-server notifications cannot
      // race ahead of the JSON-RPC response and disappear.
      this.active.set(requestId, context);
      const result = await this.server.request('turn/start', {
        threadId,
        input: [
          {
            type: 'text',
            text: String(message.userPrompt || ''),
            text_elements: []
          },
          ...imageLease.inputs
        ],
        ...(message.model && message.model !== 'auto' ? { model: message.model } : {}),
        ...(effort !== 'auto' ? { effort } : {})
      });
      const turnId = String(result?.turn?.id || '');
      if (!turnId) {
        throw codedError('CODEX_PROVIDER_REJECTED', 'Codex did not return a turn ID');
      }
      context.turnId = turnId;
      if (!context.startedSent) {
        context.startedSent = true;
        this.send({ type: 'turn.started', requestId, threadId, turnId });
      }
      if (context.cancelPending || this.pendingCancellations.delete(requestId)) {
        context.cancelPending = true;
        await this.interruptContext(context);
      }
    } catch (error) {
      if (context) this.active.delete(requestId);
      this.imageStore.cleanup(context?.imageLease || imageLease);
      this.send({ type: 'turn.error', requestId, error: publicError(error) });
    }
  }

  contextFor(params = {}) {
    const threadId = String(params.threadId || '');
    const turnId = String(params.turnId || params.turn?.id || '');
    for (const context of this.active.values()) {
      if (context.threadId === threadId && context.turnId === turnId) return context;
    }
    if (threadId && turnId) {
      const pending = [...this.active.values()].filter(context =>
        context.threadId === threadId && !context.turnId
      );
      if (pending.length === 1) {
        pending[0].turnId = turnId;
        return pending[0];
      }
    }
    return null;
  }

  handleServerNotification(message) {
    const method = message.method;
    const params = message.params || {};
    if (method === 'account/login/completed') {
      const loginId = String(params.loginId || '');
      const requestId = this.loginRequests.get(loginId) || '';
      if (loginId) this.loginRequests.delete(loginId);
      this.send({
        type: 'auth.login.completed',
        requestId,
        loginId,
        success: params.success === true,
        error: params.success === true ? null : publicError(classifyCodexError(
          params.error || 'Codex sign-in failed'
        ))
      });
      return;
    }
    const context = this.contextFor(params);
    if (method === 'turn/started' && context) {
      if (!context.startedSent) {
        context.startedSent = true;
        this.send({
          type: 'turn.started',
          requestId: context.requestId,
          threadId: context.threadId,
          turnId: context.turnId
        });
      }
      return;
    }
    if (method === 'thread/tokenUsage/updated') {
      for (const active of this.active.values()) {
        if (active.threadId === String(params.threadId || '')) {
          active.usage = params.tokenUsage || params.usage || null;
        }
      }
      return;
    }
    if (!context) return;
    if (method === 'item/started' && params.item?.type === 'agentMessage') {
      context.phases.set(String(params.item.id), params.item.phase || null);
      return;
    }
    if (method === 'item/agentMessage/delta') {
      const itemId = String(params.itemId || '');
      const phase = context.phases.get(itemId);
      if (phase === 'commentary') return;
      const delta = String(params.delta || '');
      if (!delta) return;
      context.sentByItem.set(itemId, (context.sentByItem.get(itemId) || '') + delta);
      this.send({ type: 'turn.delta', requestId: context.requestId, text: delta });
      return;
    }
    if (method === 'item/completed' && params.item?.type === 'agentMessage') {
      const itemId = String(params.item.id || '');
      const phase = params.item.phase || context.phases.get(itemId);
      if (phase === 'commentary') return;
      const fullText = String(params.item.text || '');
      const sent = String(context.sentByItem.get(itemId) || '');
      if (fullText && fullText.startsWith(sent) && fullText.length > sent.length) {
        const remainder = fullText.slice(sent.length);
        context.sentByItem.set(itemId, fullText);
        this.send({ type: 'turn.delta', requestId: context.requestId, text: remainder });
      }
      return;
    }
    if (method === 'turn/completed') {
      const status = String(params.turn?.status || 'failed');
      if (context.usage) {
        this.send({
          type: 'turn.usage',
          requestId: context.requestId,
          usage: context.usage
        });
      }
      if (status === 'completed') {
        this.send({
          type: 'turn.completed',
          requestId: context.requestId,
          finishReason: 'stop',
          usage: context.usage
        });
      } else if (status === 'interrupted') {
        this.send({ type: 'turn.cancelled', requestId: context.requestId });
      } else {
        const turnError = classifyTurnError(params.turn?.error || {});
        appendLog(
          `turn failed code=${turnError.code} status=${turnError.status || 0} ` +
          `message=${turnError.message}`
        );
        this.send({
          type: 'turn.error',
          requestId: context.requestId,
          error: publicError(turnError)
        });
      }
      this.imageStore.cleanup(context.imageLease);
      this.active.delete(context.requestId);
    }
  }

  async interruptContext(context) {
    if (!context?.threadId || !context?.turnId) return;
    try {
      await this.server.request('turn/interrupt', {
        threadId: context.threadId,
        turnId: context.turnId
      }, 10000);
    } catch (error) {
      appendLog(`turn interrupt failed: ${error.message}`);
    }
  }

  async cancel(requestId) {
    const normalizedRequestId = String(requestId || '');
    const context = this.active.get(normalizedRequestId);
    if (!context) {
      this.pendingCancellations.add(normalizedRequestId);
      return;
    }
    context.cancelPending = true;
    await this.interruptContext(context);
  }

  publishReaderEvent(requestId, event) {
    try {
      const result = this.eventStore.publish(event);
      this.send({
        type: 'reader.event.ack',
        requestId: String(requestId || ''),
        success: true,
        ...result
      });
    } catch (error) {
      this.send({
        type: 'host.error',
        requestId: String(requestId || ''),
        error: publicError(error)
      });
    }
  }

  async handle(message = {}) {
    const type = String(message.type || '');
    if (type === 'health.check') return this.health(String(message.requestId || ''));
    if (type === 'auth.login.start') {
      return this.startLogin(
        String(message.requestId || ''),
        message.force === true
      );
    }
    if (type === 'auth.logout') return this.logout(String(message.requestId || ''));
    if (type === 'reader.event.publish') {
      return this.publishReaderEvent(
        String(message.requestId || ''),
        message.event || {}
      );
    }
    if (type === 'turn.start') return this.startTurn(message);
    if (type === 'turn.cancel') return this.cancel(String(message.requestId || ''));
    this.send({
      type: 'host.error',
      requestId: String(message.requestId || ''),
      error: publicError(codedError('INVALID_SETTINGS', 'Unknown bridge request'))
    });
  }

  close() {
    this.unsubscribe?.();
    for (const context of this.active.values()) {
      this.imageStore.cleanup(context.imageLease);
    }
    this.active.clear();
    this.server.close();
  }
}

function createNativeMessageParser(onMessage, onError = appendLog) {
  let buffer = Buffer.alloc(0);
  return chunk => {
    buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
    while (buffer.length >= 4) {
      const length = buffer.readUInt32LE(0);
      if (length > MAX_NATIVE_INPUT_BYTES) {
        onError(`Native message exceeds ${MAX_NATIVE_INPUT_BYTES} bytes`);
        buffer = Buffer.alloc(0);
        return;
      }
      if (buffer.length < 4 + length) return;
      const body = buffer.subarray(4, 4 + length);
      buffer = buffer.subarray(4 + length);
      try {
        onMessage(JSON.parse(body.toString('utf8')));
      } catch (error) {
        onError(`Invalid Native Messaging payload: ${error.message}`);
      }
    }
  };
}

function encodeNativeMessage(message) {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  if (body.length > MAX_NATIVE_OUTPUT_BYTES) {
    return encodeNativeMessage({
      type: 'host.error',
      requestId: String(message?.requestId || ''),
      error: {
        code: 'INVALID_RESPONSE',
        message: 'Codex bridge output exceeded the Native Messaging limit',
        retryable: false
      }
    });
  }
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

function runNativeHost() {
  process.stdin.resume();
  const host = new CodexBridgeHost({
    send(message) {
      process.stdout.write(encodeNativeMessage(message));
    }
  });
  const parse = createNativeMessageParser(message => {
    Promise.resolve(host.handle(message)).catch(error => appendLog(error.stack || error));
  });
  process.stdin.on('data', parse);
  process.stdin.on('end', () => host.close());
  process.stdin.on('error', error => {
    appendLog(error.stack || error);
    host.close();
  });
}

if (require.main === module || !module.parent) runNativeHost();

module.exports = {
  HOST_VERSION,
  CodexAppServer,
  CodexBridgeHost,
  TurnImageStore,
  ReaderEventStore,
  ThreadMap,
  createNativeMessageParser,
  encodeNativeMessage,
  codexSpawnSpec,
  classifyCodexError,
  classifyTurnError,
  findCodexBinary,
  codexHomeDirectory,
  readerEventDirectory,
  turnImageDirectory,
  stateDirectory
};
