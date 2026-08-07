'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const readline = require('node:readline');
const http = require('node:http');
const { spawn, spawnSync } = require('node:child_process');

const HOST_VERSION = '1.0.1';
const MAX_NATIVE_INPUT_BYTES = 64 * 1024 * 1024;
const MAX_NATIVE_OUTPUT_BYTES = 900 * 1024;
const DEFAULT_APP_SERVER_TIMEOUT_MS = 30000;
const MAX_TURN_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_TURN_IMAGE_TOTAL_BYTES = 24 * 1024 * 1024;
const MAX_TURN_IMAGES = 8;
const MAX_READER_EVENT_BYTES = 4 * 1024 * 1024;
const MAX_READER_EVENT_LOG_BYTES = 16 * 1024 * 1024;
const MAX_PDF_FIGURE_BYTES = 200 * 1024 * 1024;
const MAX_PDF_FIGURE_CHUNK_BYTES = 512 * 1024;
const MAX_PDF_FIGURE_IMAGE_BYTES = 96 * 1024 * 1024;
const MAX_PDF_FIGURE_PROCESS_LOG_BYTES = 1024 * 1024;
const DEFAULT_PDF_FIGURE_DPI = 200;
const DEFAULT_PDF_FIGURE_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_PDF_TRANSLATION_HTML_BYTES = 48 * 1024 * 1024;
const DEFAULT_PDF_TRANSLATION_TTL_MS = 6 * 60 * 60 * 1000;

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

function pdfFigureTaskDirectory() {
  return path.join(stateDirectory(), 'pdf-figure-tasks');
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

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const descriptor = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    while (true) {
      const bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest('hex');
}

function mimeTypeForFigureFile(filePath) {
  const extension = path.extname(String(filePath || '')).toLowerCase();
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.webp') return 'image/webp';
  return 'image/png';
}

function pdffigures2FileKey(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function matchPdffigures2Images(figures = [], imageFiles = []) {
  const available = imageFiles
    .map(filePath => path.resolve(String(filePath || '')))
    .filter(filePath => fs.existsSync(filePath) && fs.statSync(filePath).isFile())
    .sort((left, right) => path.basename(left).localeCompare(
      path.basename(right), undefined, { numeric: true, sensitivity: 'base' }
    ));
  const used = new Set();
  return (Array.isArray(figures) ? figures : []).map(figure => {
    const type = String(figure?.figType || 'Figure').trim() || 'Figure';
    const name = String(figure?.name || '').trim();
    const expectedKey = pdffigures2FileKey(`${type}${name}`);
    const renderBase = path.basename(String(figure?.renderURL || ''));
    let imagePath = available.find(candidate =>
      !used.has(candidate) && path.basename(candidate) === renderBase
    );
    if (!imagePath) {
      imagePath = available.find(candidate => {
        if (used.has(candidate)) return false;
        const match = path.basename(candidate).match(/-(Figure|Table)(.+)-(\d+)\.[^.]+$/i);
        return match && pdffigures2FileKey(`${match[1]}${match[2]}`) === expectedKey;
      });
    }
    if (imagePath) used.add(imagePath);
    return { ...(figure || {}), imagePath: imagePath || '' };
  });
}

function pdffigures2Label(figure = {}) {
  const caption = String(figure.caption || '').normalize('NFKC').trim();
  const name = String(figure.name || '').normalize('NFKC').trim();
  const match = caption.match(
    /^(?:Figure|Fig\.?)\s*(S?\s*\d+)([A-Za-z]?)(?=\b|\s|[.:,)])/i
  ) || name.match(/^(S?\s*\d+)([A-Za-z]?)$/i);
  if (!match) return '';
  const compact = match[1].replace(/\s+/g, '').toUpperCase();
  const supplemental = compact.startsWith('S');
  const digits = compact.replace(/^S/, '');
  if (!/^\d+$/.test(digits)) return '';
  return `Figure ${supplemental ? 'S' : ''}${Number(digits)}${String(match[2] || '').toUpperCase()}`;
}

function median(values = [], fallback = -1) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return fallback;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function figureBoundaryValues(figure = {}) {
  const box = figure.regionBoundary || figure.figureBox || {};
  const x1 = Number(box.x1 ?? box.x ?? box.left);
  const y1 = Number(box.y1 ?? box.y ?? box.top);
  const x2 = Number(box.x2 ?? box.right ?? (Number.isFinite(x1) ? x1 + Number(box.width) : NaN));
  const y2 = Number(box.y2 ?? box.bottom ?? (Number.isFinite(y1) ? y1 + Number(box.height) : NaN));
  return { x1, y1, width: x2 - x1, height: y2 - y1 };
}

function degeneratePdffigures2Figure(figure = {}) {
  const box = figureBoundaryValues(figure);
  const imageText = (Array.isArray(figure.imageText) ? figure.imageText : [])
    .join(' ').normalize('NFKC').replace(/\s+/g, ' ').trim();
  const footerOnly = /^(?:(?:nat\.?\s+neurosci|author\s+manuscript|available\s+in\s+pmc|page\s+\d+)[ .;:]*)+$/i
    .test(imageText);
  return box.width < 72 || box.height < 64 || footerOnly;
}

function captionRichness(value) {
  const text = String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  const panels = text.match(/\([A-Z](?:\s*[-\u2010-\u2015]\s*[A-Z])?\)/g) || [];
  return panels.length * 10000 + Math.min(text.length, 9000);
}

function runPdffigures2Process(javaPath, args, options = {}) {
  const signal = options.signal;
  const timeoutMs = Math.max(10000,
    Number(options.timeoutMs) || DEFAULT_PDF_FIGURE_TIMEOUT_MS);
  return new Promise((resolve, reject) => {
    let settled = false;
    let stdout = '';
    let stderr = '';
    let timeout;
    const child = spawn(javaPath, args, {
      cwd: options.cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const append = (current, chunk) =>
      (current + String(chunk || '')).slice(-MAX_PDF_FIGURE_PROCESS_LOG_BYTES);
    child.stdout.on('data', chunk => { stdout = append(stdout, chunk); });
    child.stderr.on('data', chunk => { stderr = append(stderr, chunk); });
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener?.('abort', abort);
      if (error) reject(error); else resolve(value);
    };
    const stop = () => {
      try { child.kill(); } catch (_) { /* process already stopped */ }
    };
    const abort = () => {
      stop();
      finish(codedError('PDF_FIGURE_CANCELLED', 'PDF Figure extraction was cancelled'));
    };
    if (signal?.aborted) return abort();
    signal?.addEventListener?.('abort', abort, { once: true });
    timeout = setTimeout(() => {
      stop();
      finish(codedError(
        'PDF_FIGURE_EXTRACTION_TIMEOUT',
        'PDFFigures2 did not finish within the allowed time',
        true
      ));
    }, timeoutMs);
    child.on('error', error => finish(codedError(
      'PDF_FIGURE_ENGINE_START_FAILED',
      `Unable to start the local PDF Figure engine: ${error.message}`
    )));
    child.on('close', code => finish(null, { code, stdout, stderr }));
  });
}

class Pdffigures2Runner {
  constructor(options = {}) {
    this.jarPath = String(options.jarPath || process.env.BREVESS_PDFFIGURES2_JAR || '');
    this.javaPath = String(options.javaPath || '');
    this.extractorVersion = String(options.extractorVersion || '0.2.0-cross-page');
    this.dpi = Math.max(72, Math.min(400,
      Number(options.dpi) || DEFAULT_PDF_FIGURE_DPI));
    this.timeoutMs = Math.max(10000,
      Number(options.timeoutMs) || DEFAULT_PDF_FIGURE_TIMEOUT_MS);
  }

  bundledJarCandidates() {
    return [
      this.jarPath,
      path.join(path.dirname(process.execPath), 'pdffigures2', 'pdffigures2.jar'),
      path.join(path.dirname(process.execPath), '..', 'pdffigures2', 'pdffigures2.jar'),
      path.join(__dirname, 'pdffigures2', 'pdffigures2.jar')
    ].filter(Boolean);
  }

  bundledFallbackJarCandidates() {
    return [
      path.join(path.dirname(process.execPath), 'pdffigures2', 'brevess-pdf-fallback.jar'),
      path.join(path.dirname(process.execPath), '..', 'pdffigures2', 'brevess-pdf-fallback.jar'),
      path.join(__dirname, 'pdffigures2', 'brevess-pdf-fallback.jar')
    ];
  }

  bundledImageIoDirectories() {
    return [
      path.join(path.dirname(process.execPath), 'pdffigures2'),
      path.join(path.dirname(process.execPath), '..', 'pdffigures2'),
      path.join(__dirname, 'pdffigures2')
    ];
  }

  resolveImageIoJars() {
    const names = [
      'jai-imageio-core-1.4.0.jar',
      'jai-imageio-jpeg2000-1.4.0.jar'
    ];
    return names.map(name => this.bundledImageIoDirectories()
      .map(directory => path.join(directory, name))
      .find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) || ''
    ).filter(Boolean);
  }

  bundledJavaCandidates() {
    const environmentHome = process.env.BREVESS_JAVA_HOME || process.env.JAVA_HOME || '';
    return [
      this.javaPath,
      path.join(path.dirname(process.execPath), 'runtime', 'bin', 'java.exe'),
      path.join(path.dirname(process.execPath), '..', 'runtime', 'bin', 'java.exe'),
      path.join(__dirname, 'runtime', 'bin', 'java.exe'),
      environmentHome ? path.join(environmentHome, 'bin', 'java.exe') : ''
    ].filter(Boolean);
  }

  resolveJar() {
    return this.bundledJarCandidates().find(candidate =>
      fs.existsSync(candidate) && fs.statSync(candidate).isFile()
    ) || '';
  }

  resolveFallbackJar() {
    return this.bundledFallbackJarCandidates().find(candidate =>
      fs.existsSync(candidate) && fs.statSync(candidate).isFile()
    ) || '';
  }

  resolveJava() {
    const bundled = this.bundledJavaCandidates().find(candidate =>
      fs.existsSync(candidate) && fs.statSync(candidate).isFile()
    );
    if (bundled) return bundled;
    const lookup = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', ['java'], {
      encoding: 'utf8', windowsHide: true, timeout: 5000
    });
    return lookup.status === 0
      ? String(lookup.stdout || '').split(/\r?\n/).map(value => value.trim())
        .find(Boolean) || ''
      : '';
  }

  async health() {
    const jarPath = this.resolveJar();
    const javaPath = this.resolveJava();
    let javaVersion = '';
    if (javaPath) {
      const version = spawnSync(javaPath, ['-version'], {
        encoding: 'utf8', windowsHide: true, timeout: 10000
      });
      javaVersion = String(version.stderr || version.stdout || '')
        .split(/\r?\n/)[0].trim();
    }
    return {
      available: Boolean(jarPath && javaPath),
      crossPageRecoveryAvailable: Boolean(this.resolveFallbackJar() && javaPath),
      jpeg2000Available: this.resolveImageIoJars().length === 2,
      extractorVersion: this.extractorVersion,
      javaVersion,
      reason: !jarPath ? 'PDF_FIGURE_JAR_MISSING'
        : !javaPath ? 'PDF_FIGURE_JAVA_MISSING' : ''
    };
  }

  async extract(input = {}) {
    const jarPath = this.resolveJar();
    const javaPath = this.resolveJava();
    if (!jarPath) throw codedError(
      'PDF_FIGURE_JAR_MISSING',
      'The local PDFFigures2 engine is not installed'
    );
    if (!javaPath) throw codedError(
      'PDF_FIGURE_JAVA_MISSING',
      'The bundled Java runtime for PDF Figure extraction is not installed'
    );
    const pdfPath = path.resolve(String(input.pdfPath || ''));
    const outputDirectory = path.resolve(String(input.outputDirectory || ''));
    if (!fs.existsSync(pdfPath) || !fs.statSync(pdfPath).isFile()) {
      throw codedError('PDF_FIGURE_INPUT_INVALID', 'The PDF input file is missing');
    }
    fs.mkdirSync(outputDirectory, { recursive: true });
    const imagePrefix = path.join(outputDirectory, 'figure-');
    const dataPrefix = path.join(outputDirectory, 'metadata-');
    input.onProgress?.({ phase: 'starting', progress: 15, completedFigures: 0 });
    const imageIoJars = this.resolveImageIoJars();
    const launcher = imageIoJars.length === 2
      ? ['-cp', [jarPath, ...imageIoJars].join(path.delimiter),
        'org.allenai.pdffigures2.FigureExtractorBatchCli']
      : ['-jar', jarPath];
    const args = [
      '-Dsun.java2d.cmm=sun.java2d.cmm.kcms.KcmsServiceProvider',
      ...launcher,
      pdfPath,
      '-q',
      '-i', String(this.dpi),
      '-m', imagePrefix,
      '-d', dataPrefix
    ];
    input.onProgress?.({ phase: 'rendering', progress: 25, completedFigures: 0 });
    const result = await runPdffigures2Process(javaPath, args, {
      cwd: outputDirectory,
      signal: input.signal,
      timeoutMs: this.timeoutMs
    });
    if (result.code !== 0) {
      const diagnostic = sanitizeLogText(result.stderr || result.stdout || '')
        .replace(/\s+/g, ' ').trim().slice(0, 700);
      throw codedError(
        'PDF_FIGURE_EXTRACTION_FAILED',
        diagnostic
          ? `PDFFigures2 could not extract this PDF: ${diagnostic}`
          : `PDFFigures2 exited with code ${result.code}`,
        true
      );
    }
    input.onProgress?.({ phase: 'reading', progress: 85, completedFigures: 0 });
    const files = fs.readdirSync(outputDirectory, { withFileTypes: true })
      .filter(entry => entry.isFile())
      .map(entry => path.join(outputDirectory, entry.name));
    const jsonFiles = files.filter(filePath => path.extname(filePath).toLowerCase() === '.json');
    if (jsonFiles.length !== 1) {
      throw codedError(
        'PDF_FIGURE_METADATA_MISSING',
        'PDFFigures2 did not produce one Figure metadata file'
      );
    }
    let figures;
    try {
      figures = JSON.parse(fs.readFileSync(jsonFiles[0], 'utf8'));
    } catch (error) {
      throw codedError(
        'PDF_FIGURE_METADATA_INVALID',
        `PDFFigures2 returned invalid Figure metadata: ${error.message}`
      );
    }
    if (!Array.isArray(figures)) {
      throw codedError('PDF_FIGURE_METADATA_INVALID', 'PDFFigures2 metadata is not a Figure list');
    }
    const imageFiles = files.filter(filePath =>
      ['.png', '.jpg', '.jpeg', '.webp'].includes(path.extname(filePath).toLowerCase())
    );
    const figureMetadata = matchPdffigures2Images(figures, imageFiles)
      .filter(figure => String(figure?.figType || '').toLowerCase() === 'figure');
    const unusableMetadataLabels = figureMetadata
      .filter(figure => !figure.imagePath || degeneratePdffigures2Figure(figure))
      .map(pdffigures2Label).filter(Boolean);
    let matched = figureMetadata.filter(figure =>
      figure.imagePath && !degeneratePdffigures2Figure(figure)
    );
    const warnings = [];
    const fallbackJar = this.resolveFallbackJar();
    if (fallbackJar) {
      try {
        const boxes = matched.map(figureBoundaryValues);
        // A single detected Figure is not representative enough to crop every
        // recovered plate. Sparse extraction is exactly where the fallback
        // needs generous, page-aware bounds instead of inheriting one narrow box.
        const preferred = boxes.length >= 3 ? [
          median(boxes.map(box => box.x1)),
          median(boxes.map(box => box.y1)),
          median(boxes.map(box => box.width)),
          median(boxes.map(box => box.height))
        ] : [-1, -1, -1, -1];
        const labels = matched.map(pdffigures2Label).filter(Boolean);
        const classPath = [fallbackJar, jarPath, ...imageIoJars].join(path.delimiter);
        const recoveredProcess = await runPdffigures2Process(javaPath, [
          '-cp', classPath, 'BrevessPdfFallback', pdfPath, outputDirectory,
          String(this.dpi), labels.join(','), ...preferred.map(String)
        ], {
          cwd: outputDirectory,
          signal: input.signal,
          timeoutMs: this.timeoutMs
        });
        if (recoveredProcess.code === 0) {
          const recoveredOutput = String(recoveredProcess.stdout || '');
          const recoveredJsonStart = recoveredOutput.indexOf('{"captions"');
          const recovered = JSON.parse(recoveredJsonStart >= 0
            ? recoveredOutput.slice(recoveredJsonStart) : recoveredOutput || '{}');
          const captionsByLabel = new Map((Array.isArray(recovered.captions)
            ? recovered.captions : []).map(item => [
              String(item?.label || '').toLowerCase(), String(item?.caption || '')
            ]));
          matched = matched.map(figure => {
            const recoveredCaption = captionsByLabel.get(
              pdffigures2Label(figure).toLowerCase()
            ) || '';
            return captionRichness(recoveredCaption) > captionRichness(figure.caption)
              ? { ...figure, caption: recoveredCaption, captionRecovered: true }
              : figure;
          });
          const existing = new Set(matched.map(figure =>
            pdffigures2Label(figure).toLowerCase()
          ));
          (Array.isArray(recovered.figures) ? recovered.figures : []).forEach(figure => {
            const label = pdffigures2Label(figure).toLowerCase();
            const imagePath = path.resolve(outputDirectory, String(figure.imageFile || ''));
            if (!label || existing.has(label) ||
                !imagePath.startsWith(`${outputDirectory}${path.sep}`) ||
                !fs.existsSync(imagePath)) return;
            matched.push({ ...figure, imagePath, recoveredBy: 'pdfbox-cross-page' });
            existing.add(label);
          });
        } else {
          warnings.push('PDF_FIGURE_CROSS_PAGE_RECOVERY_FAILED');
        }
      } catch (error) {
        appendLog(`PDF cross-page recovery skipped: ${error.stack || error}`);
        warnings.push('PDF_FIGURE_CROSS_PAGE_RECOVERY_FAILED');
      }
    } else {
      warnings.push('PDF_FIGURE_CROSS_PAGE_RECOVERY_UNAVAILABLE');
    }
    if (unusableMetadataLabels.length) {
      const recoveredLabels = new Set(matched.map(pdffigures2Label));
      const stillMissing = unusableMetadataLabels.filter(label => !recoveredLabels.has(label));
      warnings.push(stillMissing.length
        ? 'PDF_FIGURE_PDFFIGURES2_IMAGE_MISSING'
        : 'PDF_FIGURE_PDFFIGURES2_IMAGE_RECOVERED');
    }
    return {
      extractorVersion: this.extractorVersion,
      figures: matched,
      warnings: matched.length ? warnings : ['PDF_FIGURE_NONE_FOUND', ...warnings]
    };
  }
}

class PdfFigureTaskStore {
  constructor(options = {}) {
    this.root = path.resolve(options.root || pdfFigureTaskDirectory());
    this.runner = options.runner || new Pdffigures2Runner(options);
    this.leaseMs = Math.max(60000, Number(options.leaseMs) || 60 * 60 * 1000);
    this.tasks = new Map();
  }

  taskDirectory(taskId) {
    const id = String(taskId || '');
    if (!/^[a-zA-Z0-9._-]{3,160}$/.test(id)) {
      throw codedError('PDF_FIGURE_TASK_INVALID', 'Invalid PDF Figure task ID');
    }
    const key = crypto.createHash('sha256').update(id).digest('hex').slice(0, 32);
    return safeChildPath(this.root, path.join(this.root, key));
  }

  cleanupStale(now = Date.now()) {
    let entries = [];
    try { entries = fs.readdirSync(this.root, { withFileTypes: true }); } catch (_) { return; }
    entries.filter(entry => entry.isDirectory()).forEach(entry => {
      const directory = safeChildPath(this.root, path.join(this.root, entry.name));
      try {
        if (fs.statSync(directory).mtimeMs < now - this.leaseMs) {
          fs.rmSync(directory, { recursive: true, force: true });
        }
      } catch (_) {
        // A concurrently running native host may own this directory.
      }
    });
  }

  async health() {
    return this.runner.health?.() || {
      available: false,
      reason: 'PDF_FIGURE_ENGINE_UNAVAILABLE'
    };
  }

  begin(input = {}) {
    fs.mkdirSync(this.root, { recursive: true });
    this.cleanupStale();
    const taskId = String(input.taskId || '');
    const totalBytes = Number(input.totalBytes);
    const fingerprint = String(input.documentFingerprint || '').toLowerCase();
    if (!Number.isInteger(totalBytes) || totalBytes < 5 || totalBytes > MAX_PDF_FIGURE_BYTES) {
      throw codedError('PDF_FIGURE_INPUT_TOO_LARGE', 'Invalid PDF byte length');
    }
    if (!/^[a-f0-9]{64}$/.test(fingerprint)) {
      throw codedError('PDF_FIGURE_FINGERPRINT_INVALID', 'Invalid PDF fingerprint');
    }
    this.release(taskId);
    const directory = this.taskDirectory(taskId);
    const outputDirectory = safeChildPath(directory, path.join(directory, 'output'));
    fs.mkdirSync(outputDirectory, { recursive: true });
    const pdfPath = safeChildPath(directory, path.join(directory, 'input.pdf'));
    fs.writeFileSync(pdfPath, Buffer.alloc(0), { flag: 'wx' });
    const task = {
      taskId,
      directory,
      outputDirectory,
      pdfPath,
      totalBytes,
      fingerprint,
      fileName: path.basename(String(input.fileName || 'article.pdf')).slice(0, 180),
      kind: input.kind === 'supplemental' ? 'supplemental' : 'main',
      receivedBytes: 0,
      uploadHash: crypto.createHash('sha256'),
      controller: new AbortController(),
      images: new Map(),
      status: 'uploading',
      createdAt: Date.now()
    };
    this.tasks.set(taskId, task);
    return { taskId, nextOffset: 0 };
  }

  appendChunk(input = {}) {
    const task = this.tasks.get(String(input.taskId || ''));
    if (!task || task.status !== 'uploading') {
      throw codedError('PDF_FIGURE_TASK_MISSING', 'PDF Figure upload task is missing');
    }
    const offset = Number(input.offset);
    if (!Number.isInteger(offset) || offset !== task.receivedBytes) {
      throw codedError('PDF_FIGURE_UPLOAD_OFFSET', 'Unexpected PDF upload offset');
    }
    const encoded = String(input.data || '').replace(/\s+/g, '');
    if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
      throw codedError('PDF_FIGURE_UPLOAD_CHUNK_INVALID', 'Invalid PDF upload chunk');
    }
    const bytes = Buffer.from(encoded, 'base64');
    if (!bytes.length || bytes.length > MAX_PDF_FIGURE_CHUNK_BYTES ||
        task.receivedBytes + bytes.length > task.totalBytes) {
      throw codedError('PDF_FIGURE_UPLOAD_CHUNK_INVALID', 'PDF upload chunk exceeded its limit');
    }
    fs.appendFileSync(task.pdfPath, bytes);
    task.uploadHash.update(bytes);
    task.receivedBytes += bytes.length;
    return { taskId: task.taskId, nextOffset: task.receivedBytes };
  }

  figureResult(task, raw, index) {
    const imagePath = safeChildPath(
      task.outputDirectory,
      path.resolve(String(raw?.imagePath || raw?.imageFile || ''))
    );
    if (!fs.existsSync(imagePath) || !fs.statSync(imagePath).isFile()) {
      throw codedError('PDF_FIGURE_IMAGE_MISSING', 'PDFFigures2 did not render a Figure image');
    }
    const byteLength = fs.statSync(imagePath).size;
    if (!byteLength || byteLength > MAX_PDF_FIGURE_IMAGE_BYTES) {
      throw codedError('PDF_FIGURE_IMAGE_TOO_LARGE', 'A rendered Figure exceeded its limit');
    }
    const imageHash = sha256File(imagePath);
    const imageId = `figure-${index + 1}-${imageHash.slice(0, 12)}`;
    task.images.set(imageId, { path: imagePath, byteLength, sha256: imageHash });
    const result = { ...(raw || {}) };
    delete result.imagePath;
    delete result.imageFile;
    return {
      ...result,
      imageId,
      byteLength,
      sha256: imageHash,
      mimeType: mimeTypeForFigureFile(imagePath)
    };
  }

  async commit(taskId, onProgress = () => {}) {
    const task = this.tasks.get(String(taskId || ''));
    if (!task || task.status !== 'uploading') {
      throw codedError('PDF_FIGURE_TASK_MISSING', 'PDF Figure task is missing');
    }
    if (task.receivedBytes !== task.totalBytes) {
      throw codedError('PDF_FIGURE_UPLOAD_INCOMPLETE', 'PDF upload is incomplete');
    }
    const actualHash = task.uploadHash.digest('hex');
    if (actualHash !== task.fingerprint) {
      throw codedError('PDF_FIGURE_FINGERPRINT_MISMATCH', 'PDF upload failed integrity verification');
    }
    const signature = Buffer.alloc(5);
    const descriptor = fs.openSync(task.pdfPath, 'r');
    try { fs.readSync(descriptor, signature, 0, 5, 0); } finally { fs.closeSync(descriptor); }
    if (signature.toString('ascii') !== '%PDF-') {
      throw codedError('PDF_FIGURE_INPUT_INVALID', 'Uploaded bytes are not a PDF');
    }
    task.status = 'extracting';
    onProgress({ phase: 'extracting', progress: 10, completedFigures: 0 });
    try {
      const extracted = await this.runner.extract({
        pdfPath: task.pdfPath,
        outputDirectory: task.outputDirectory,
        fileName: task.fileName,
        kind: task.kind,
        signal: task.controller.signal,
        onProgress
      });
      if (task.controller.signal.aborted) {
        throw codedError('PDF_FIGURE_CANCELLED', 'PDF Figure extraction was cancelled');
      }
      const rawFigures = Array.isArray(extracted?.figures) ? extracted.figures : [];
      const figures = rawFigures.map((figure, index) =>
        this.figureResult(task, figure, index)
      );
      task.status = 'ready';
      task.expiresAt = Date.now() + this.leaseMs;
      onProgress({
        phase: 'ready', progress: 100, completedFigures: figures.length
      });
      return {
        taskId: task.taskId,
        extractorVersion: String(extracted?.extractorVersion || ''),
        figures,
        warnings: Array.isArray(extracted?.warnings) ? extracted.warnings : []
      };
    } catch (error) {
      const cancelled = task.controller.signal.aborted ||
        error?.code === 'PDF_FIGURE_CANCELLED';
      this.release(task.taskId);
      if (cancelled) throw codedError(
        'PDF_FIGURE_CANCELLED',
        'PDF Figure extraction was cancelled'
      );
      throw error;
    } finally {
      try { fs.rmSync(task.pdfPath, { force: true }); } catch (_) { /* already removed */ }
    }
  }

  readImage(input = {}) {
    const task = this.tasks.get(String(input.taskId || ''));
    const image = task?.images.get(String(input.imageId || ''));
    if (!task || task.status !== 'ready' || !image) {
      throw codedError('PDF_FIGURE_IMAGE_MISSING', 'PDF Figure image lease is missing');
    }
    const offset = Number(input.offset);
    const length = Math.min(MAX_PDF_FIGURE_CHUNK_BYTES, Number(input.length));
    if (!Number.isInteger(offset) || offset < 0 || offset >= image.byteLength ||
        !Number.isInteger(length) || length <= 0) {
      throw codedError('PDF_FIGURE_IMAGE_RANGE_INVALID', 'Invalid Figure image byte range');
    }
    const bytesToRead = Math.min(length, image.byteLength - offset);
    const buffer = Buffer.allocUnsafe(bytesToRead);
    const descriptor = fs.openSync(image.path, 'r');
    let bytesRead;
    try { bytesRead = fs.readSync(descriptor, buffer, 0, bytesToRead, offset); }
    finally { fs.closeSync(descriptor); }
    if (bytesRead !== bytesToRead) {
      throw codedError('PDF_FIGURE_IMAGE_READ_FAILED', 'Figure image read ended early', true);
    }
    return {
      taskId: task.taskId,
      imageId: String(input.imageId || ''),
      offset,
      nextOffset: offset + bytesRead,
      eof: offset + bytesRead >= image.byteLength,
      data: buffer.toString('base64')
    };
  }

  cancel(taskId) {
    const task = this.tasks.get(String(taskId || ''));
    if (!task) return false;
    task.controller.abort();
    this.release(task.taskId);
    return true;
  }

  release(taskId) {
    const id = String(taskId || '');
    let directory;
    try { directory = this.taskDirectory(id); } catch (_) { return false; }
    const task = this.tasks.get(id);
    task?.controller?.abort();
    this.tasks.delete(id);
    try { fs.rmSync(directory, { recursive: true, force: true }); } catch (_) { return false; }
    return true;
  }

  close() {
    [...this.tasks.keys()].forEach(taskId => this.release(taskId));
  }
}

class PdfTranslationPageServer {
  constructor(options = {}) {
    this.server = null;
    this.port = 0;
    this.pages = new Map();
    this.ttlMs = Math.max(5 * 60 * 1000,
      Number(options.ttlMs) || DEFAULT_PDF_TRANSLATION_TTL_MS);
    this.expiryTimer = null;
  }

  escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
  }

  documentHtml(title, articleHtml, sourceUrl, nonce) {
    const safeTitle = this.escapeHtml(title);
    const safeSourceUrl = this.escapeHtml(sourceUrl);
    const sourceLink = safeSourceUrl
      ? `<a href="${safeSourceUrl}" target="_blank" rel="noreferrer">查看原始 PDF</a>`
      : '';
    return `<!doctype html><html lang="en" data-brevess-pdf-source-url="${safeSourceUrl}">` +
      `<head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<meta name="brevess-pdf-source-url" content="${safeSourceUrl}">` +
      `<title>${safeTitle}</title><style>` +
      `:root{color-scheme:light}*{box-sizing:border-box}html{scroll-behavior:smooth}` +
      `body{margin:0;background:#eef3f6;color:#17324d;font:17px/1.78 Georgia,` +
      `"Times New Roman","Noto Serif SC",serif}` +
      `header{position:sticky;z-index:20;top:0;display:flex;min-height:62px;align-items:center;` +
      `justify-content:space-between;gap:18px;padding:9px max(18px,calc((100% - 1100px)/2));` +
      `border-bottom:1px solid #d4e0e8;background:rgba(255,255,255,.96);backdrop-filter:blur(12px);` +
      `font:600 13px/1.3 "Segoe UI","Noto Sans SC",sans-serif}` +
      `header>div{display:flex;min-width:0;align-items:center;gap:8px}` +
      `header strong{max-width:min(58vw,720px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}` +
      `header button,header a{display:inline-flex;min-height:34px;align-items:center;justify-content:center;` +
      `padding:0 11px;border:1px solid #b7ccda;border-radius:8px;color:#174d70;background:#fff;` +
      `font:650 12px/1 "Segoe UI","Noto Sans SC",sans-serif;text-decoration:none;cursor:pointer}` +
      `#brevessPdfZoomValue{min-width:44px;text-align:center;color:#47677a}` +
      `main{width:min(calc(980px * var(--brevess-reader-zoom,1)),calc(100% - 32px));` +
      `margin:28px auto;padding:clamp(24px,5vw,64px);background:#fff;border-radius:18px;` +
      `box-shadow:0 16px 44px rgba(35,64,85,.12)}h1,h2,h3,h4{font-family:"Segoe UI",` +
      `"Noto Sans SC",sans-serif;color:#0f4d73;line-height:1.28;scroll-margin-top:24px}` +
      `h1 .immersive-translate-target-wrapper,h2 .immersive-translate-target-wrapper,` +
      `h3 .immersive-translate-target-wrapper,h4 .immersive-translate-target-wrapper,` +
      `h1 [data-immersive-translate-translation-element-mark],` +
      `h2 [data-immersive-translate-translation-element-mark],` +
      `h3 [data-immersive-translate-translation-element-mark],` +
      `h4 [data-immersive-translate-translation-element-mark]{display:block;margin-top:.24em;` +
      `color:#3e718d;font-size:.84em;font-weight:600}` +
      `h1{font-size:2rem}h2{margin-top:2.2em;border-bottom:1px solid #d7e2eb;padding-bottom:.35em}` +
      `h3{margin-top:1.7em}p{margin:1em 0}figure{margin:2.4em 0;padding:16px;border:1px solid #d7e2eb;` +
      `border-radius:14px;background:#fbfdfe}figure img{display:block;max-width:100%;height:auto;margin:auto}` +
      `figcaption{margin-top:14px;color:#365a70;font:14px/1.65 "Segoe UI","Noto Sans SC",sans-serif}` +
      `table{width:100%;border-collapse:collapse;overflow-wrap:anywhere}th,td{padding:8px;border:1px solid #cbdbe5}` +
      `a{color:#075f96}@media(max-width:720px){header{padding:8px 10px}header strong{max-width:34vw}` +
      `main{width:100%;margin:0;border-radius:0;padding:22px 16px}}` +
      `</style></head><body><header data-sci-plugin-ui><strong>${safeTitle}</strong><div>` +
      `<button id="brevessPdfZoomOut" type="button" aria-label="缩小">−</button>` +
      `<span id="brevessPdfZoomValue">100%</span>` +
      `<button id="brevessPdfZoomIn" type="button" aria-label="放大">＋</button>` +
      `<button id="brevessPdfZoomReset" type="button">适宽</button>${sourceLink}</div></header>` +
      `<main data-brevess-translation-page="true">${articleHtml}</main>` +
      `<script nonce="${nonce}">(()=>{let z=1;const r=document.documentElement,v=document.getElementById(` +
      `'brevessPdfZoomValue');const set=n=>{z=Math.max(.75,Math.min(1.6,Math.round(n*20)/20));` +
      `r.style.setProperty('--brevess-reader-zoom',String(z));r.style.fontSize=(17*z)+'px';` +
      `v.textContent=Math.round(z*100)+'%'};document.getElementById('brevessPdfZoomOut').onclick=()=>set(z-.1);` +
      `document.getElementById('brevessPdfZoomIn').onclick=()=>set(z+.1);` +
      `document.getElementById('brevessPdfZoomReset').onclick=()=>set(1);` +
      `addEventListener('keydown',e=>{if(!(e.ctrlKey||e.metaKey))return;if(e.key==='+'||e.key==='='){` +
      `e.preventDefault();set(z+.1)}else if(e.key==='-'){e.preventDefault();set(z-.1)}else if(e.key==='0'){` +
      `e.preventDefault();set(1)}})})()</script></body></html>`;
  }

  async start() {
    if (this.server) return this.port;
    this.server = http.createServer((request, response) => {
      const url = new URL(request.url || '/', 'http://127.0.0.1');
      const match = url.pathname.match(/^\/brevess-pdf\/([a-f0-9]{48})$/);
      const page = match ? this.pages.get(match[1]) : null;
      if (request.method !== 'GET' || !page) {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('Not found');
        return;
      }
      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store, max-age=0',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'none'; img-src data: https:; style-src 'unsafe-inline'; " +
          `font-src data:; script-src 'nonce-${page.nonce}'`
      });
      response.end(page.html);
    });
    await new Promise((resolve, reject) => {
      const onError = error => reject(error);
      this.server.once('error', onError);
      this.server.listen(0, '127.0.0.1', () => {
        this.server?.off('error', onError);
        resolve();
      });
    });
    this.port = Number(this.server.address()?.port) || 0;
    return this.port;
  }

  async publish(input = {}) {
    const articleHtml = String(input.articleHtml || '');
    const bytes = Buffer.byteLength(articleHtml, 'utf8');
    if (!articleHtml || bytes > MAX_PDF_TRANSLATION_HTML_BYTES) {
      throw codedError(
        bytes > MAX_PDF_TRANSLATION_HTML_BYTES
          ? 'PDF_TRANSLATION_PAGE_TOO_LARGE' : 'PDF_TRANSLATION_PAGE_EMPTY',
        bytes > MAX_PDF_TRANSLATION_HTML_BYTES
          ? 'The translation-compatible PDF page exceeded the local limit'
          : 'The parsed PDF page is empty'
      );
    }
    await this.start();
    const token = crypto.randomBytes(24).toString('hex');
    const nonce = crypto.randomBytes(18).toString('base64');
    const sourceUrl = String(input.sourceUrl || '').slice(0, 8000);
    this.pages.clear();
    this.pages.set(token, {
      html: this.documentHtml(
        String(input.title || 'Parsed PDF'), articleHtml, sourceUrl, nonce
      ),
      nonce,
      createdAt: Date.now()
    });
    clearTimeout(this.expiryTimer);
    this.expiryTimer = setTimeout(() => this.close(), this.ttlMs);
    return {
      url: `http://127.0.0.1:${this.port}/brevess-pdf/${token}`,
      expiresInMs: this.ttlMs
    };
  }

  hasPublishedPage() {
    return this.pages.size > 0 && Boolean(this.server);
  }

  close() {
    clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
    this.pages.clear();
    try { this.server?.close(); } catch (_) { /* already closed */ }
    this.server = null;
    this.port = 0;
  }
}

class CodexBridgeHost {
  constructor(options = {}) {
    this.server = options.server || new CodexAppServer(options);
    this.threadMap = options.threadMap || new ThreadMap(options.threadMapPath);
    this.imageStore = options.imageStore ||
      new TurnImageStore(options.turnImageRoot || turnImageDirectory());
    this.eventStore = options.eventStore ||
      new ReaderEventStore(options.readerEventRoot || readerEventDirectory());
    this.pdfFigureStore = options.pdfFigureStore || new PdfFigureTaskStore({
      root: options.pdfFigureTaskRoot || pdfFigureTaskDirectory(),
      runner: options.pdfFigureRunner
    });
    this.pdfTranslationPages = options.pdfTranslationPages ||
      new PdfTranslationPageServer(options.pdfTranslationPageOptions);
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

  async handlePdfFigure(message = {}) {
    const type = String(message.type || '');
    const requestId = String(message.requestId || '');
    const taskId = String(message.taskId || '');
    try {
      if (type === 'pdf.figure.health') {
        const health = await this.pdfFigureStore.health();
        this.send({
          type: 'pdf.figure.health.result',
          requestId,
          available: health?.available === true,
          crossPageRecoveryAvailable: health?.crossPageRecoveryAvailable === true,
          extractorVersion: String(health?.extractorVersion || ''),
          javaVersion: String(health?.javaVersion || ''),
          reason: String(health?.reason || ''),
          hostVersion: HOST_VERSION
        });
        return;
      }
      if (type === 'pdf.figure.extract.begin') {
        const result = this.pdfFigureStore.begin(message);
        this.send({ type: 'pdf.figure.upload.ready', requestId, ...result });
        return;
      }
      if (type === 'pdf.figure.extract.chunk') {
        const result = this.pdfFigureStore.appendChunk(message);
        this.send({ type: 'pdf.figure.upload.ack', requestId, ...result });
        return;
      }
      if (type === 'pdf.figure.extract.commit') {
        const result = await this.pdfFigureStore.commit(taskId, progress => {
          this.send({
            type: 'pdf.figure.extract.progress',
            requestId,
            taskId,
            phase: String(progress?.phase || 'extracting'),
            progress: Math.max(0, Math.min(100, Number(progress?.progress) || 0)),
            completedFigures: Math.max(0, Number(progress?.completedFigures) || 0)
          });
        });
        this.send({ type: 'pdf.figure.extract.result', requestId, ...result });
        return;
      }
      if (type === 'pdf.figure.image.read') {
        const result = this.pdfFigureStore.readImage(message);
        this.send({ type: 'pdf.figure.image.chunk', requestId, ...result });
        return;
      }
      if (type === 'pdf.figure.extract.cancel') {
        this.pdfFigureStore.cancel(taskId);
        this.send({ type: 'pdf.figure.extract.cancelled', requestId, taskId });
        return;
      }
      if (type === 'pdf.figure.extract.release') {
        this.pdfFigureStore.release(taskId);
        this.send({ type: 'pdf.figure.extract.released', requestId, taskId });
        return;
      }
      throw codedError('INVALID_SETTINGS', 'Unknown PDF Figure bridge request');
    } catch (error) {
      if (error?.code === 'PDF_FIGURE_CANCELLED') {
        this.send({ type: 'pdf.figure.extract.cancelled', requestId, taskId });
        return;
      }
      this.send({
        type: 'pdf.figure.extract.error',
        requestId,
        taskId,
        error: publicError(error)
      });
    }
  }

  async handlePdfTranslation(message = {}) {
    const requestId = String(message.requestId || '');
    try {
      if (message.type !== 'pdf.translation.publish') {
        throw codedError('INVALID_SETTINGS', 'Unknown PDF translation request');
      }
      const result = await this.pdfTranslationPages.publish(message);
      this.send({ type: 'pdf.translation.published', requestId, ...result });
    } catch (error) {
      this.send({ type: 'pdf.translation.error', requestId, error: publicError(error) });
    }
  }

  async handle(message = {}) {
    const type = String(message.type || '');
    if (type.startsWith('pdf.figure.')) return this.handlePdfFigure(message);
    if (type.startsWith('pdf.translation.')) return this.handlePdfTranslation(message);
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

  close(options = {}) {
    this.unsubscribe?.();
    for (const context of this.active.values()) {
      this.imageStore.cleanup(context.imageLease);
    }
    this.active.clear();
    this.pdfFigureStore.close();
    if (options.keepTranslation !== true) this.pdfTranslationPages.close();
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
  process.stdin.on('end', () => host.close({
    keepTranslation: host.pdfTranslationPages.hasPublishedPage()
  }));
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
  PdfFigureTaskStore,
  PdfTranslationPageServer,
  Pdffigures2Runner,
  matchPdffigures2Images,
  degeneratePdffigures2Figure,
  pdffigures2Label,
  runPdffigures2Process,
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
  pdfFigureTaskDirectory,
  stateDirectory
};
