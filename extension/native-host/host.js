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
const MAX_JSON_TURN_TEXT_BYTES = 3 * 1024 * 1024;
const MAX_JSON_TURN_ITEMS = 256;
const MAX_JSON_TURN_EVENTS = 65536;
const MAX_JSON_ITEM_ID_BYTES = 256;
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

const WORKSPACE_DIRECTORY_PROOF_FILE = 'native-directory-binding.json';
const WORKSPACE_DIRECTORY_MAX_PROOF_MS = 10 * 60 * 1000;
const WORKSPACE_DIRECTORY_UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;

function workspaceDirectoryError(suffix, message) {
  return codedError(`WORKSPACE_DIRECTORY_${suffix}`, message);
}

// Self-contained for the existing Node SEA build: no dynamically loaded module,
// shell, user-supplied executable, registry change, or arbitrary open-path API.
class WorkspaceDirectoryService {
  constructor(options = {}) {
    this.stateRoot = path.resolve(options.stateRoot || stateDirectory());
    this.configPath = path.join(this.stateRoot, 'workspace-directories.json');
    this.platform = options.platform || process.platform;
    this.systemRoot = options.systemRoot || process.env.SystemRoot || 'C:\\Windows';
    this.spawnImpl = options.spawnImpl || spawn;
    this.now = options.now || Date.now;
  }

  rootId(value) {
    if (typeof value !== 'string' || !WORKSPACE_DIRECTORY_UUID.test(value)) {
      throw workspaceDirectoryError('INVALID_REQUEST', 'A valid directory root identifier is required.');
    }
    return value;
  }

  requireSupported() {
    if (this.platform !== 'win32') {
      throw workspaceDirectoryError('UNSUPPORTED', 'Opening workspace folders is supported on Windows only.');
    }
  }

  localAbsolute(value) {
    if (typeof value !== 'string' || !value || value.length > 4096 || value.trim() !== value ||
        /[\u0000-\u001f\u007f]/u.test(value) || /^[\\/]{2}/u.test(value) ||
        !path.isAbsolute(value) || (path.sep === '\\' && !/^[a-z]:[\\/]/iu.test(value))) {
      throw workspaceDirectoryError('INVALID_PATH', 'Use the absolute path of the local Brevess data root.');
    }
    const withoutDrive = value.replace(/^[a-z]:/iu, '');
    if (/[:*?"<>|]/u.test(withoutDrive) || withoutDrive.split(/[\\/]/u).some(part =>
      part === '.' || part === '..' || (part && /[. ]$/u.test(part)))) {
      throw workspaceDirectoryError('INVALID_PATH', 'The local directory path is ambiguous or unsafe.');
    }
    return path.resolve(value);
  }

  samePath(first, second) {
    return path.sep === '\\' ? first.toLowerCase() === second.toLowerCase() : first === second;
  }

  readJson(file, maximum, suffix) {
    let descriptor;
    try {
      const before = fs.lstatSync(file);
      if (before.isSymbolicLink() || !before.isFile() ||
          !this.samePath(fs.realpathSync(file), path.resolve(file))) {
        throw workspaceDirectoryError('PATH_ESCAPE', 'A directory metadata path was redirected.');
      }
      if (before.size < 2 || before.size > maximum) throw Error('BOUNDED_JSON');
      descriptor = fs.openSync(file, 'r');
      const opened = fs.fstatSync(descriptor);
      if (!opened.isFile() || before.dev !== opened.dev || before.ino !== opened.ino) {
        throw workspaceDirectoryError('PATH_ESCAPE', 'Directory metadata changed while being checked.');
      }
      const bytes = Buffer.alloc(maximum + 1);
      const length = fs.readSync(descriptor, bytes, 0, bytes.length, 0);
      if (length > maximum || !this.samePath(fs.realpathSync(file), path.resolve(file))) throw Error('BOUNDED_JSON');
      const value = JSON.parse(bytes.subarray(0, length).toString('utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('OBJECT_REQUIRED');
      return value;
    } catch (error) {
      if (String(error?.code || '').startsWith('WORKSPACE_DIRECTORY_')) throw error;
      throw workspaceDirectoryError(suffix, 'Directory metadata is missing, unreadable, or invalid.');
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
    }
  }

  readConfig() {
    try { fs.lstatSync(this.configPath); }
    catch (error) {
      if (error.code === 'ENOENT') return { schemaVersion: 1,
        kind: 'brevess-workspace-directory-bindings', bindings: Object.create(null) };
      throw workspaceDirectoryError('CONFIG_INVALID', 'Directory binding configuration cannot be read.');
    }
    const value = this.readJson(this.configPath, 64 * 1024, 'CONFIG_INVALID');
    if (value.schemaVersion !== 1 || value.kind !== 'brevess-workspace-directory-bindings' ||
        !value.bindings || typeof value.bindings !== 'object' || Array.isArray(value.bindings) ||
        Object.keys(value.bindings).length > 32) {
      throw workspaceDirectoryError('CONFIG_INVALID', 'Directory binding configuration is invalid.');
    }
    for (const [id, root] of Object.entries(value.bindings)) {
      try { this.rootId(id); this.localAbsolute(root); }
      catch (_) { throw workspaceDirectoryError('CONFIG_INVALID', 'Directory binding configuration is invalid.'); }
    }
    return value;
  }

  realDirectory(value, suffix) {
    const candidate = this.localAbsolute(value);
    try {
      const real = fs.realpathSync(candidate);
      this.localAbsolute(real); // Reject network/device targets after resolution too.
      if (!fs.statSync(real).isDirectory()) throw Error('DIRECTORY_REQUIRED');
      return real;
    } catch (error) {
      if (String(error?.code || '').startsWith('WORKSPACE_DIRECTORY_')) {
        throw workspaceDirectoryError('PATH_ESCAPE', 'The resolved directory is not a local directory.');
      }
      throw workspaceDirectoryError(suffix, 'The saved directory no longer exists or cannot be read.');
    }
  }

  proof(root, rootId) {
    const proof = this.readJson(path.join(root, WORKSPACE_DIRECTORY_PROOF_FILE), 16 * 1024, 'PROOF_INVALID');
    if (proof.schemaVersion !== 1 || proof.kind !== 'brevess-native-directory-binding' ||
        typeof proof.rootId !== 'string' || !WORKSPACE_DIRECTORY_UUID.test(proof.rootId)) {
      throw workspaceDirectoryError('PROOF_INVALID', 'The selected directory has no valid binding proof.');
    }
    if (proof.rootId !== rootId) throw workspaceDirectoryError('ROOT_MISMATCH', 'The selected and bound directory roots differ.');
    return proof;
  }

  boundRoot(rootId) {
    const config = this.readConfig();
    if (!Object.hasOwn(config.bindings, rootId)) {
      throw workspaceDirectoryError('NOT_BOUND', 'Bind the currently selected data root before opening a folder.');
    }
    const stored = config.bindings[rootId];
    const real = this.realDirectory(stored, 'ROOT_MISSING');
    if (!this.samePath(real, stored)) throw workspaceDirectoryError('ROOT_MISMATCH', 'The bound directory root was redirected.');
    this.proof(real, rootId);
    return real;
  }

  status(input = {}) {
    if (input.rootId === '') return { supported: this.platform === 'win32', bound: false, rootId: '' };
    const rootId = this.rootId(input.rootId);
    if (this.platform !== 'win32') return { supported: false, bound: false, rootId };
    const config = this.readConfig();
    if (!Object.hasOwn(config.bindings, rootId)) return { supported: true, bound: false, rootId };
    this.boundRoot(rootId);
    return { supported: true, bound: true, rootId };
  }

  bind(input = {}) {
    this.requireSupported(); const rootId = this.rootId(input.rootId);
    if (typeof input.challenge !== 'string' || !/^[a-f0-9]{64}$/u.test(input.challenge)) {
      throw workspaceDirectoryError('INVALID_REQUEST', 'A fresh directory binding challenge is required.');
    }
    const root = this.realDirectory(input.absolutePath, 'ROOT_MISSING');
    const proof = this.proof(root, rootId);
    if (typeof proof.challenge !== 'string' || proof.challenge !== input.challenge ||
        !Number.isSafeInteger(proof.expiresAt)) {
      throw workspaceDirectoryError('PROOF_INVALID', 'The directory binding challenge does not match.');
    }
    const remaining = proof.expiresAt - this.now();
    if (!(remaining > 0 && remaining <= WORKSPACE_DIRECTORY_MAX_PROOF_MS)) {
      throw workspaceDirectoryError('PROOF_EXPIRED', 'Refresh the directory binding proof and try again.');
    }
    const config = this.readConfig();
    if (!Object.hasOwn(config.bindings, rootId) && Object.keys(config.bindings).length >= 32) {
      throw workspaceDirectoryError('CONFIG_WRITE_FAILED', 'The directory binding limit has been reached.');
    }
    config.bindings[rootId] = root;
    let temporary = '';
    try {
      // This is the sole writing path, reached only after an exact fresh proof.
      fs.mkdirSync(this.stateRoot, { recursive: true });
      if (!this.samePath(fs.realpathSync(this.stateRoot), this.stateRoot)) throw Error('STATE_ROOT_REDIRECTED');
      temporary = path.join(this.stateRoot, `workspace-directories-${crypto.randomUUID()}.tmp`);
      fs.writeFileSync(temporary, `${JSON.stringify(config)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      fs.renameSync(temporary, this.configPath); temporary = '';
    } catch (_) {
      throw workspaceDirectoryError('CONFIG_WRITE_FAILED', 'The directory binding could not be saved.');
    } finally {
      if (temporary) { try { fs.unlinkSync(temporary); } catch (_) { /* only our exclusive temporary file */ } }
    }
    return { supported: true, bound: true, rootId };
  }

  workspaceTarget(root, input) {
    const directoryName = input.directoryName;
    if (typeof directoryName !== 'string' || !directoryName || directoryName.length > 180 ||
        directoryName.trim() !== directoryName || /[. ]$/u.test(directoryName) ||
        /[\\/:*?"<>|\u0000-\u001f\u007f]/u.test(directoryName) ||
        directoryName === '.' || directoryName === '..' ||
        /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu.test(directoryName)) {
      throw workspaceDirectoryError('INVALID_PATH', 'The workspace directory name is unsafe.');
    }
    if (typeof input.workspaceId !== 'string' || !/^workspace:[a-f0-9]{12,64}$/u.test(input.workspaceId) ||
        !Number.isSafeInteger(input.workspaceGeneration) || input.workspaceGeneration < 0 ||
        typeof input.canonicalUrl !== 'string' || input.canonicalUrl.length > 4000 ||
        /[\u0000-\u001f\u007f]/u.test(input.canonicalUrl)) {
      throw workspaceDirectoryError('INVALID_REQUEST', 'A complete current workspace identity is required.');
    }
    const suffix = directoryName.split('--').at(-1);
    if (!/^[a-f0-9]{12,64}$/u.test(suffix) || !input.workspaceId.slice(10).startsWith(suffix)) {
      throw workspaceDirectoryError('INVALID_PATH', 'The workspace directory does not match its stable identity.');
    }
    const container = path.join(root, 'workspaces');
    const realContainer = this.realDirectory(container, 'MISSING');
    if (!this.samePath(container, realContainer)) throw workspaceDirectoryError('PATH_ESCAPE', 'The workspace root was redirected.');
    const candidate = path.join(container, directoryName);
    const real = this.realDirectory(candidate, 'MISSING');
    const relative = path.relative(realContainer, real);
    if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative) ||
        !this.samePath(candidate, real)) {
      throw workspaceDirectoryError('PATH_ESCAPE', 'The workspace directory escaped its bound location.');
    }
    const manifest = this.readJson(path.join(real, 'manifest.json'), 1024 * 1024, 'MANIFEST_INVALID');
    if (manifest.schemaVersion !== 1 || manifest.kind !== 'sci-logic-highlighter-workspace' ||
        typeof manifest.workspaceId !== 'string' || typeof manifest.canonicalUrl !== 'string' ||
        typeof manifest.directoryName !== 'string' || !Number.isSafeInteger(manifest.workspaceGeneration) ||
        manifest.workspaceGeneration < 0) {
      throw workspaceDirectoryError('MANIFEST_INVALID', 'The workspace manifest has an unsupported or invalid identity.');
    }
    if (['workspaceId', 'workspaceGeneration', 'canonicalUrl', 'directoryName'].some(key => manifest[key] !== input[key])) {
      throw workspaceDirectoryError('IDENTITY_MISMATCH', 'The saved folder belongs to a different workspace or version.');
    }
    if (!/^[a-f0-9]{64}$/u.test(manifest.contentHash || '') || !Number.isSafeInteger(manifest.revision) || manifest.revision < 0 ||
        !Array.isArray(manifest.assets) || !Array.isArray(manifest.aliases) ||
        typeof manifest.title !== 'string' || typeof manifest.createdAt !== 'string' || typeof manifest.updatedAt !== 'string') {
      throw workspaceDirectoryError('MANIFEST_INVALID', 'The saved workspace manifest is incomplete.');
    }
    return real;
  }

  researchTarget(root, input) {
    const identity=input.identity, fields={project:['kind','projectId'],figure:['kind','projectId','planId','figureId'],panel:['kind','projectId','planId','figureId','panelId']};
    const keys=fields[identity?.kind];
    if(!keys||!identity||typeof identity!=='object'||Array.isArray(identity)||Object.keys(identity).length!==keys.length||
      Object.keys(identity).some(key=>!keys.includes(key))||keys.filter(key=>key!=='kind').some(key=>typeof identity[key]!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(identity[key]))||
      Object.keys(input).some(key=>!['type','requestId','rootId','identity','mappingId','mappingRecordId'].includes(key))) {
      throw workspaceDirectoryError('INVALID_REQUEST','A complete stable workbench identity is required.');
    }
    const canonical=value=>JSON.stringify(Object.fromEntries(Object.keys(value).sort().map(key=>[key,value[key]&&typeof value[key]==='object'?JSON.parse(canonical(value[key])):value[key]])));
    const mappingId=crypto.createHash('sha256').update(canonical(identity)).digest('hex');
    if(input.mappingId!==mappingId||!WORKSPACE_DIRECTORY_UUID.test(input.mappingRecordId||''))throw workspaceDirectoryError('INVALID_REQUEST','The mapping identity is invalid.');
    const mapFile=path.join(root,'research-data','.brevess-directory-map',mappingId,'map-'+input.mappingRecordId+'.json');
    const record=this.readJson(mapFile,16384,'MANIFEST_INVALID');
    const parts=typeof record.relativePath==='string'?record.relativePath.split('/'):[];
    const depth={project:3,figure:5,panel:6}[identity.kind];
    if(record.kind!=='brevess-research-data-directory'||record.schemaVersion!==1||record.mappingId!==mappingId||record.recordId!==input.mappingRecordId||
      canonical(record.identity||{})!==canonical(identity)||typeof record.originalDisplayName!=='string'||parts.length!==depth||!['Brevess','SCI-Highlighter'].includes(parts[0])||!this.samePath(parts[0],path.basename(root))||parts[1]!=='research-data'||
      parts.some(part=>!part||part==='.'||part==='..'||/[\\:*?"<>|\u0000-\u001f\u007f]/u.test(part)||/[. ]$/u.test(part))) {
      throw workspaceDirectoryError('MANIFEST_INVALID','The workbench directory mapping is invalid.');
    }
    let target=root;
    for(const part of parts.slice(1)){const candidate=path.join(target,part),real=this.realDirectory(candidate,'MISSING');
      if(!this.samePath(candidate,real))throw workspaceDirectoryError('PATH_ESCAPE','A workbench data directory was redirected.');target=real;}
    const marker=this.readJson(path.join(target,'.brevess-data-directory.json'),16384,'MANIFEST_INVALID');
    if(canonical(marker)!==canonical(record))throw workspaceDirectoryError('IDENTITY_MISMATCH','The folder ownership marker differs from its mapping.');
    return target;
  }

  openResearch(input = {}) {
    this.requireSupported();const rootId=this.rootId(input.rootId),root=this.boundRoot(rootId),target=this.researchTarget(root,input);
    if(!this.samePath(this.boundRoot(rootId),root)||!this.samePath(this.researchTarget(root,input),target))throw workspaceDirectoryError('PATH_ESCAPE','The workbench directory changed during validation.');
    if(!/^[a-z]:[\\/]/iu.test(this.systemRoot)||/^[\\/]{2}/u.test(this.systemRoot)||/[\u0000-\u001f\u007f]/u.test(this.systemRoot))throw workspaceDirectoryError('OPEN_FAILED','The Windows folder opener is unavailable.');
    return new Promise((resolve,reject)=>{
      let settled=false;const timer=setTimeout(()=>finish(false),5000);timer.unref?.();
      const finish=success=>{if(settled)return;settled=true;clearTimeout(timer);
        if(success)resolve({opened:true,rootId,mappingId:input.mappingId});else reject(workspaceDirectoryError('OPEN_FAILED','Windows could not accept the folder-open request.'));};
      try{const child=this.spawnImpl(path.win32.join(this.systemRoot,'explorer.exe'),[target],{shell:false,windowsHide:true,stdio:'ignore'});
        child.once('error',()=>finish(false));child.once('spawn',()=>{child.unref?.();finish(true);});}catch(_){finish(false);}
    });
  }

  open(input = {}) {
    this.requireSupported(); const rootId = this.rootId(input.rootId);
    const root = this.boundRoot(rootId);
    const target = this.workspaceTarget(root, input);
    // Recheck directly before spawning. No asynchronous gap, path inference,
    // workspace creation, or token/expiry downgrade occurs on the open path.
    if (!this.samePath(this.boundRoot(rootId), root) || !this.samePath(this.workspaceTarget(root, input), target)) {
      throw workspaceDirectoryError('PATH_ESCAPE', 'The workspace changed while being checked.');
    }
    if (!/^[a-z]:[\\/]/iu.test(this.systemRoot) || /^[\\/]{2}/u.test(this.systemRoot) ||
        /[\u0000-\u001f\u007f]/u.test(this.systemRoot)) {
      throw workspaceDirectoryError('OPEN_FAILED', 'The Windows folder opener is unavailable.');
    }
    const executable = path.win32.join(this.systemRoot, 'explorer.exe');
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => finish(false), 5000); timer.unref?.();
      const finish = success => {
        if (settled) return; settled = true; clearTimeout(timer);
        if (success) resolve({ opened: true, rootId, workspaceId: input.workspaceId });
        else reject(workspaceDirectoryError('OPEN_FAILED', 'Windows could not accept the folder-open request.'));
      };
      try {
        const child = this.spawnImpl(executable, [target], { shell: false, windowsHide: true, stdio: 'ignore' });
        child.once('error', () => finish(false));
        child.once('spawn', () => { child.unref?.(); finish(true); });
      } catch (_) { finish(false); }
    });
  }
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
    // Configuration is validated only when the PDF service is requested.
    this.javaInitialHeapMiB = options.javaInitialHeapMiB !== undefined
      ? options.javaInitialHeapMiB : process.env.BREVESS_PDFFIGURES2_JAVA_XMS_MIB;
    this.javaMaxHeapMiB = options.javaMaxHeapMiB !== undefined
      ? options.javaMaxHeapMiB : process.env.BREVESS_PDFFIGURES2_JAVA_XMX_MIB;
    this.jarPath = String(options.jarPath || process.env.BREVESS_PDFFIGURES2_JAR || '');
    this.javaPath = String(options.javaPath || '');
    this.extractorVersion = String(options.extractorVersion || '0.2.1-numbered-captions');
    this.dpi = Math.max(72, Math.min(400,
      Number(options.dpi) || DEFAULT_PDF_FIGURE_DPI));
    this.timeoutMs = Math.max(10000,
      Number(options.timeoutMs) || DEFAULT_PDF_FIGURE_TIMEOUT_MS);
  }

  javaHeapArgs() {
    const heapMiB = value => {
      if (value === undefined) return undefined;
      if (!['number', 'string'].includes(typeof value) ||
          !/^[1-9]\d{0,3}$/.test(String(value)) || Number(value) > 4096) {
        throw codedError('PDF_FIGURE_JAVA_HEAP_INVALID',
          'Java heap settings must be integer MiB values from 1 to 4096');
      }
      return Number(value);
    };
    const initial = heapMiB(this.javaInitialHeapMiB);
    const maximum = heapMiB(this.javaMaxHeapMiB);
    if (initial !== undefined && maximum !== undefined && initial > maximum) {
      throw codedError('PDF_FIGURE_JAVA_HEAP_INVALID',
        'Java initial heap must not exceed maximum heap');
    }
    // Omitted settings preserve JVM defaults, including ordinary user hosts.
    return [
      ...(initial === undefined ? [] : [`-Xms${initial}m`]),
      ...(maximum === undefined ? [] : [`-Xmx${maximum}m`])
    ];
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
    let heapArgs;
    try {
      heapArgs = this.javaHeapArgs();
    } catch (error) {
      return {
        available: false,
        crossPageRecoveryAvailable: false,
        jpeg2000Available: false,
        extractorVersion: this.extractorVersion,
        javaVersion: '',
        reason: error.code || 'PDF_FIGURE_JAVA_HEAP_INVALID'
      };
    }
    const jarPath = this.resolveJar();
    const javaPath = this.resolveJava();
    let javaVersion = '';
    let probeSucceeded = false;
    let probeTimedOut = false;
    if (javaPath) {
      let version;
      try {
        version = spawnSync(javaPath, [...heapArgs, '-version'], {
          encoding: 'utf8', windowsHide: true, timeout: 10000
        });
      } catch (error) {
        version = { error };
      }
      probeSucceeded = version.status === 0 && !version.error && !version.signal;
      probeTimedOut = version.error?.code === 'ETIMEDOUT';
      if (probeSucceeded) {
        javaVersion = String(version.stderr || version.stdout || '')
          .split(/\r?\n/)[0].trim();
      }
    }
    const available = Boolean(jarPath && javaPath && probeSucceeded);
    return {
      available,
      crossPageRecoveryAvailable: available && Boolean(this.resolveFallbackJar()),
      jpeg2000Available: this.resolveImageIoJars().length === 2,
      extractorVersion: this.extractorVersion,
      javaVersion,
      reason: !jarPath ? 'PDF_FIGURE_JAR_MISSING'
        : !javaPath ? 'PDF_FIGURE_JAVA_MISSING'
        : probeTimedOut ? 'PDF_FIGURE_JAVA_PROBE_TIMEOUT'
        : !probeSucceeded ? 'PDF_FIGURE_JAVA_PROBE_FAILED' : ''
    };
  }

  async extract(input = {}) {
    const heapArgs = this.javaHeapArgs();
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
      ...heapArgs,
      '-Dfile.encoding=UTF-8',
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
          ...heapArgs,
          '-Dfile.encoding=UTF-8',
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

// This backend remains in host.js: the Windows SEA build embeds only this file.
const HARNESS_SUPPORTED_VERSION = '0.2.0-rc.2';
const HARNESS_PROVIDER = 'deepseek-account';
const HARNESS_MAX_TEXT = 2 * 1024 * 1024;

function classifyHarnessLlmFailure(failure) {
  if (!failure || typeof failure !== 'object' || Array.isArray(failure)) return { code: 'HARNESS_TURN_FAILED' };
  // turn/end.reason.error is the official SDK LlmError.failure record. Read
  // only its exact machine code and numeric HTTP status, never free text/cause.
  const codes = {
    ACCOUNT_TOKEN_INVALID: 'AUTH_INVALID', ACCOUNT_SIGN_IN_REQUIRED: 'AUTH_INVALID', AUTH: 'AUTH_INVALID',
    ACCOUNT_QUOTA: 'QUOTA_EXHAUSTED', ACCOUNT_QUOTA_EXCEEDED: 'QUOTA_EXHAUSTED', QUOTA: 'QUOTA_EXHAUSTED',
    RATE_LIMIT: 'RATE_LIMITED', SERVER: 'PROVIDER_UNAVAILABLE', TRANSPORT: 'NETWORK_ERROR', TIMEOUT: 'REQUEST_TIMEOUT',
    CONTEXT_WINDOW_EXCEEDED: 'CONTEXT_BUDGET_EXCEEDED'
  };
  const status = Number.isSafeInteger(failure.status) && failure.status >= 100 && failure.status <= 599
    ? failure.status : undefined;
  const classified = code => ({ code, ...(status === undefined ? {} : { status }) });
  if (typeof failure.code === 'string' && Object.hasOwn(codes, failure.code)) return classified(codes[failure.code]);
  if (status === 401 || status === 403) return classified('AUTH_INVALID');
  if (status === 402) return classified('QUOTA_EXHAUSTED');
  if (status === 408) return classified('REQUEST_TIMEOUT');
  if (status === 429) return classified('RATE_LIMITED');
  if (status >= 500) return classified('PROVIDER_UNAVAILABLE');
  return classified('HARNESS_TURN_FAILED');
}

function harnessPublicError(error) {
  const allowed = new Set(['HARNESS_NOT_INSTALLED', 'HARNESS_VERSION_UNSUPPORTED',
    'HARNESS_START_FAILED', 'HARNESS_PROTOCOL_ERROR', 'HARNESS_MODEL_REQUIRED',
    'HARNESS_MODEL_UNAVAILABLE', 'HARNESS_IMAGE_UNSUPPORTED', 'HARNESS_NOT_AUTHENTICATED',
    'HARNESS_TOOL_DISABLED', 'HARNESS_MAX_TOKENS', 'HARNESS_TURN_FAILED',
    'HARNESS_PROCESS_EXITED', 'REQUEST_TIMEOUT', 'INVALID_SETTINGS', 'CANCELLED',
    'AUTH_INVALID', 'QUOTA_EXHAUSTED', 'RATE_LIMITED', 'PROVIDER_UNAVAILABLE',
    'NETWORK_ERROR', 'CONTEXT_BUDGET_EXCEEDED', 'WEB_SEARCH_GROUNDING_MISSING',
    'WEB_SEARCH_RESPONSE_INCOMPLETE']);
  const code = allowed.has(error?.code) ? error.code : 'HARNESS_TURN_FAILED';
  // SDK/provider error bodies can contain account tokens, URLs and echoed prompts.
  return { code, message: code.replaceAll('_', ' ').toLowerCase(),
    retryable: ['HARNESS_START_FAILED', 'HARNESS_PROCESS_EXITED', 'REQUEST_TIMEOUT',
      'RATE_LIMITED', 'PROVIDER_UNAVAILABLE', 'NETWORK_ERROR'].includes(code),
    ...(Number.isSafeInteger(error?.status) && error.status >= 100 && error.status <= 599 ? { status: error.status } : {}) };
}

function normalizeHarnessUsage(value) {
  if (!value || typeof value !== 'object') return null;
  const token = n => Number.isSafeInteger(n) && n >= 0 ? n : null;
  const input = token(value.inputTokens), output = token(value.outputTokens);
  if (input === null || output === null) return null;
  const read = token(value.cacheReadTokens) ?? 0, write = token(value.cacheWriteTokens) ?? 0;
  const totalInput = input + read + write;
  if (!Number.isSafeInteger(totalInput + output)) return null;
  return { inputTokens: totalInput, outputTokens: output, totalTokens: totalInput + output,
    reasoningTokens: token(value.reasoningTokens) ?? 0, cacheHitTokens: read,
    cacheMissTokens: input + write, estimated: false };
}

function validateHarnessTurn(message) {
  if (message.webSearch !== undefined && typeof message.webSearch !== 'boolean') {
    throw codedError('INVALID_SETTINGS', 'Harness webSearch must be a boolean');
  }
  const model = typeof message.model === 'string' ? message.model.trim() : '';
  if (!model || model === 'auto' || model.length > 200 || /[\x00-\x1f]/.test(model)) {
    throw codedError('HARNESS_MODEL_REQUIRED', 'Choose an installed Harness model');
  }
  const systemPrompt = String(message.systemPrompt || ''), userPrompt = String(message.userPrompt || '');
  if (!userPrompt.trim() || Buffer.byteLength(systemPrompt + userPrompt) > HARNESS_MAX_TEXT) {
    throw codedError('INVALID_SETTINGS', 'Invalid Harness prompt');
  }
  if (message.maxOutputTokens !== undefined && (!Number.isSafeInteger(message.maxOutputTokens) ||
      message.maxOutputTokens < 1 || message.maxOutputTokens > 256000)) {
    throw codedError('INVALID_SETTINGS', 'Invalid Harness token bound');
  }
  const reasoningEffort = message.reasoningEffort && message.reasoningEffort !== 'auto'
    ? String(message.reasoningEffort) : undefined;
  if (reasoningEffort && !['off', 'low', 'high', 'max'].includes(reasoningEffort)) {
    throw codedError('INVALID_SETTINGS', 'Invalid Harness reasoning effort');
  }
  const images = message.images === undefined ? [] : message.images;
  if (!Array.isArray(images) || images.length > MAX_TURN_IMAGES) throw codedError('INVALID_SETTINGS', 'Invalid Harness images');
  let bytes = 0;
  const contentBlocks = [{ type: 'text', text: userPrompt }];
  for (const image of images) {
    const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(image?.dataUrl || ''));
    if (!match || match[2].length % 4 !== 0 || (image.mediaType && image.mediaType !== match[1])) {
      throw codedError('INVALID_SETTINGS', 'Harness images must be encoded image data');
    }
    const size = Buffer.from(match[2], 'base64').length;
    bytes += size;
    if (!size || size > MAX_TURN_IMAGE_BYTES || bytes > MAX_TURN_IMAGE_TOTAL_BYTES) throw codedError('INVALID_SETTINGS', 'Harness image bound exceeded');
    contentBlocks.push({ type: 'image', mimeType: match[1], data: match[2] });
  }
  const timeoutMs = Math.max(1000, Math.min(15 * 60 * 1000, Number(message.timeoutMs) || 300000));
  return { model, systemPrompt, contentBlocks, reasoningEffort, webSearch: message.webSearch === true,
    maxTokens: message.maxOutputTokens ?? 8192, timeoutMs };
}

function harnessWebSources(meta) {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta) || typeof meta.truncated !== 'boolean' ||
      !Array.isArray(meta.sources) || !meta.sources.length || meta.sources.length > 8) return null;
  const urls = new Set(), sources = [];
  for (const source of meta.sources) {
    if (!source || typeof source !== 'object' || Array.isArray(source) ||
        typeof source.url !== 'string' || !source.url || source.url.length > 8000 ||
        /[\s\x00-\x1f\x7f]/.test(source.url) || urls.has(source.url) ||
        (source.title !== undefined && (typeof source.title !== 'string' || source.title.length > 2000))) return null;
    let parsed;
    try { parsed = new URL(source.url); } catch { return null; }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || !parsed.hostname) return null;
    urls.add(source.url);
    sources.push({ url: source.url, ...(source.title !== undefined ? { title: source.title } : {}) });
  }
  return sources;
}

function readHarnessArchiveManifest(archive, entry) {
  // Read only a fixed application manifest, never account/configuration files.
  const fd = fs.openSync(archive, 'r');
  try {
    const prefix = Buffer.alloc(16); if (fs.readSync(fd, prefix, 0, 16, 0) !== 16) throw Error('header');
    const size = prefix.readUInt32LE(4), jsonSize = prefix.readUInt32LE(12);
    if (jsonSize > 20000000 || size > 25000000 || jsonSize < 2) throw Error('header');
    const headerBytes = Buffer.alloc(jsonSize); fs.readSync(fd, headerBytes, 0, jsonSize, 16);
    let node = JSON.parse(headerBytes.toString('utf8'));
    for (const segment of entry.split('/')) node = node.files?.[segment];
    if (!node || node.unpacked || !Number.isSafeInteger(node.size) || node.size > 65536) throw Error('manifest');
    const bytes = Buffer.alloc(node.size); fs.readSync(fd, bytes, 0, node.size, 8 + size + Number(node.offset));
    return JSON.parse(bytes.toString('utf8'));
  } finally { fs.closeSync(fd); }
}

function findHarnessInstallation() {
  if (process.platform !== 'win32') throw codedError('HARNESS_NOT_INSTALLED', 'Harness Windows installation unavailable');
  const candidates = [path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Programs', 'DeepSeek Harness'),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'DeepSeek Harness')];
  for (const candidate of candidates) {
    const exe = path.join(candidate, 'DeepSeek Harness.exe'), archive = path.join(candidate, 'resources', 'app.asar');
    if (!fs.existsSync(exe) || !fs.existsSync(archive)) continue;
    try {
      const version = readHarnessArchiveManifest(archive, 'package.json').version;
      const sdkVersion = readHarnessArchiveManifest(archive, 'dsh/node_modules/@deepseek-ai/dsh-sdk-protocol/package.json').version;
      if (version !== HARNESS_SUPPORTED_VERSION || sdkVersion !== HARNESS_SUPPORTED_VERSION) throw codedError('HARNESS_VERSION_UNSUPPORTED', 'Unsupported Harness installation');
      return { executable: fs.realpathSync(exe), archive: fs.realpathSync(archive), version, sdkVersion };
    } catch (error) {
      if (error.code === 'HARNESS_VERSION_UNSUPPORTED') throw error;
      throw codedError('HARNESS_VERSION_UNSUPPORTED', 'Harness installation structure changed');
    }
  }
  throw codedError('HARNESS_NOT_INSTALLED', 'DeepSeek Harness is not installed');
}

// Fixed bootstrap program; content/system/image data never enters argv or code.
async function closedHarnessBootstrap() {
  const fs = require('node:fs'), path = require('node:path');
  const { pathToFileURL } = require('node:url');
  for (const method of ['log', 'info', 'debug', 'warn', 'error']) console[method] = () => {};
  const archive = process.argv[2];
  const base = path.join(archive, 'dsh', 'node_modules', '@deepseek-ai');
  const names = ['cordis', 'dsh-session', 'dsh-agent', 'dsh-llm', 'dsh-session-projection',
    'dsh-system-prompt', 'dsh-tools', 'dsh-agent-loop', 'dsh-attachment-local',
    'dsh-credentials-local', 'dsh-authorization', 'dsh-deepseek-account-platform',
    'dsh-llm-deepseek-account', 'dsh-sdk-protocol', 'dsh-sdk-jsonrpc-server',
    'dsh-web', 'dsh-web-search-deepseek', 'dsh-tool-web', 'dsh-tool-call-timeout-policy'];
  const modules = {};
  for (const name of names) modules[name] = await import(pathToFileURL(path.join(base, name, 'lib', 'index.js')).href);
  const { Context } = modules.cordis;
  const ctx = new Context();
  const mount = async (name, config) => ctx.plugin(modules[name].default || modules[name], config);
  await mount('dsh-session'); await mount('dsh-agent'); await mount('dsh-llm');
  await mount('dsh-session-projection');
  await mount('dsh-system-prompt', { includeHarnessIdentity: false, includeRuntimeContext: false });
  await mount('dsh-tools', { mode: 'native' });
  // Search producers mount only for an explicit standalone web request below.
  // No loader, filesystem, skills, jobs, PTC or subagent plugins.
  await mount('dsh-agent-loop', { agents: [] });
  await mount('dsh-attachment-local', { dshHome: process.cwd(), maxImagesPerMessage: 8,
    maxImageBytes: 4194304, maxMessageImageBytes: 25165824 });
  await mount('dsh-credentials-local', { watch: false });
  await mount('dsh-authorization');
  await mount('dsh-deepseek-account-platform', { desktopPlatform: 'win32' });
  // Explicit official endpoint prevents an inherited project env changing auth destination.
  await mount('dsh-llm-deepseek-account', { baseURL: 'https://api.deepseek.com/anthropic' });
  let webSearch = false, searchCalls = 0;
  ctx.tools.guard(exec => {
    const queries = exec.arguments?.queries;
    if (!webSearch || exec.name !== 'web_search' || searchCalls >= 1 ||
        !Array.isArray(queries) || queries.length !== 1 || typeof queries[0] !== 'string' ||
        !queries[0].trim() || queries[0].length > 8192) return 'HARNESS_TOOL_DISABLED';
    searchCalls++;
  });
  ctx.on('system-prompt/assemble', (assembly) => {
    if (webSearch ? assembly.tools.length !== 1 || assembly.tools[0].name !== 'web_search'
      : assembly.tools.length !== 0) throw new Error('HARNESS_TOOL_DISABLED');
    return assembly;
  });
  const transport = new modules['dsh-sdk-protocol'].JsonRpcLineTransport(process.stdin, process.stdout);
  const sdk = new modules['dsh-sdk-jsonrpc-server'].HarnessSdkJsonRpcServer(ctx, transport, { maxTokensAsSuccess: false });
  let configured = false;
  let rootSessionId;
  ctx.on('agent/assistant-stream', function ({ frame }) {
    const agent = ctx.agents.currentInitiator();
    if (String(agent?.session.id) !== rootSessionId || frame.type !== 'chunk') return;
    // Tool turns contain multiple attempts; only durable final text crosses this bridge.
    if (webSearch) return;
    if (frame.chunk.type === 'tool-call-delta' || (frame.chunk.type === 'block-end' && frame.chunk.block?.type === 'tool-call')) {
      transport.notify('brevess.toolRejected', { sessionId: rootSessionId });
    } else if (frame.chunk.type === 'text-delta') {
      transport.notify('brevess.delta', { sessionId: rootSessionId, text: frame.chunk.text, revision: frame.revision, attemptId: String(frame.attemptId) });
    } else if (frame.chunk.type === 'usage') {
      transport.notify('brevess.usage', { sessionId: rootSessionId, usage: frame.chunk.usage });
    }
  });
  const models = async () => {
    const catalog = await ctx.llm.listModels('deepseek-account');
    return Promise.all(catalog.map(async entry => {
      const info = await ctx.llm.resolveModelInfo('deepseek-account', entry.id);
      return { id: entry.id, name: entry.name, inputModalities: entry.inputModalities || ['text'],
        reasoningEfforts: info.reasoning?.efforts.map(e => e.id) || [], defaultReasoningEffort: info.reasoning?.defaultEffort,
        maxTokens: info.defaultMaxTokens, contextWindow: info.context?.contextWindow };
    }));
  };
  const shutdown = async () => {
    await sdk.shutdown(); await transport.flush(); await ctx.root.fiber.dispose(); transport.close();
    process.exit(0);
  };
  transport.onRequest(async (method, params) => {
    if (method === 'brevess.health') {
      const state = await ctx.deepseekAccount.getState();
      return { accountStatus: state.status, toolsEnabled: false, webSearchSupported: true,
        allowedWebTools: ['web_search'], provider: 'deepseek-account' };
    }
    if (method === 'brevess.models') return { models: await models(), provider: 'deepseek-account' };
    if (method === 'brevess.configure') {
      if (configured || typeof params.systemPrompt !== 'string' || params.systemPrompt.length > 2097152 ||
          typeof params.webSearch !== 'boolean') throw Error('INVALID_SETTINGS');
      configured = true;
      webSearch = params.webSearch;
      if (webSearch) {
        await mount('dsh-web', { searchProvider: 'deepseek-official' });
        await mount('dsh-web-search-deepseek', {
          baseURL: 'https://api.deepseek.com/anthropic/v1', maxUses: 1, maxTokens: 4096
        });
        await mount('dsh-tool-web', {
          search: true, fetch: false, searchMaxQueries: 1, searchMaxResults: 8, searchTimeoutMs: 60000
        });
        await mount('dsh-tool-call-timeout-policy');
      }
      ctx.systemPrompt.section({ name: 'brevess:task', order: 0, complete: true,
        interpolate: false, text: params.systemPrompt });
      return { configured: true };
    }
    if (method === 'initialize') {
      if (!configured || params.provider !== 'deepseek-account') throw Error('INVALID_SETTINGS');
      params = { ...params, cwd: process.cwd() };
    }
    if (method === 'session/prompt') {
      if (rootSessionId || typeof params.sessionId !== 'string') throw Error('INVALID_SETTINGS');
      rootSessionId = params.sessionId;
      if (params.contentBlocks?.some(b => b.type === 'image')) {
        const catalog = await models();
        if (!catalog.find(m => m.id === sdk.model)?.inputModalities.includes('image')) throw Error('HARNESS_IMAGE_UNSUPPORTED');
      }
    }
    if (method === 'shutdown') { setImmediate(() => shutdown().catch(() => process.exit(0))); return {}; }
    if (!['initialize', 'session/prompt'].includes(method)) throw Error('INVALID_SETTINGS');
    return sdk.handleRequest(method, params);
  });
  process.stdin.once('end', () => shutdown().catch(() => process.exit(0)));
  transport.start();
}

function harnessBootstrapSource() {
  return "'use strict';\n(" + closedHarnessBootstrap.toString() + ")().catch(() => process.exit(71));\n";
}

class HarnessSdkProcess {
  constructor(options = {}) {
    this.installation = options.installation || null;
    this.spawnProcess = options.spawnProcess || spawn;
    this.pending = new Map(); this.sequence = 0; this.closed = false;
  }
  async start(onNotification, onFailure) {
    this.installation ||= findHarnessInstallation();
    this.onNotification = onNotification; this.onFailure = onFailure;
    const base = path.join(stateDirectory(), 'harness-tasks'); fs.mkdirSync(base, { recursive: true });
    this.taskParent = fs.realpathSync(base);
    this.root = fs.mkdtempSync(path.join(base, 'sdk-'));
    this.createdRoot = fs.realpathSync(this.root);
    const script = path.join(this.root, 'bootstrap.cjs'); fs.writeFileSync(script, harnessBootstrapSource(), { mode: 0o600 });
    // No shell, user-selected executable, project environment files or prompt arguments.
    const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
    for (const name of Object.keys(env)) if (/^(?:NODE_OPTIONS|NODE_PATH|ELECTRON_NO_ASAR|DSH_HOME|DEEPSEEK_BASE_URL|DEEPSEEK_SEARCH_BASE_URL|DSH_WEB_SEARCH_PROVIDER|DSH_WEB_FETCH_PROVIDER)$/i.test(name)) delete env[name];
    let child;
    try {
      child = this.spawnProcess(this.installation.executable, [script, this.installation.archive],
        { cwd: this.root, env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch {
      this.removeRoot(); throw codedError('HARNESS_START_FAILED', 'Harness could not start');
    }
    this.child = child;
    child.stderr.on('data', () => {}); // Do not expose SDK credential/provider diagnostics.
    child.stdin.on('error', () => this.fail(codedError('HARNESS_PROCESS_EXITED', 'Harness input closed')));
    child.stdout.on('error', () => this.fail(codedError('HARNESS_PROTOCOL_ERROR', 'Harness output closed')));
    child.on('error', () => this.fail(codedError('HARNESS_START_FAILED', 'Harness could not start')));
    child.on('exit', () => {
      this.exited = true;
      if (!this.closed) this.fail(codedError('HARNESS_PROCESS_EXITED', 'Harness exited before completion'));
      this.removeRoot();
    });
    let buffer = '';
    child.stdout.setEncoding('utf8'); child.stdout.on('data', text => {
      if (this.closed) return;
      buffer += text;
      if (buffer.length > 32 * 1024 * 1024) return this.fail(codedError('HARNESS_PROTOCOL_ERROR', 'Harness output bound exceeded'));
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        if (!line.trim()) continue;
        let frame; try { frame = JSON.parse(line); } catch { return this.fail(codedError('HARNESS_PROTOCOL_ERROR', 'Invalid Harness frame')); }
        if (frame.jsonrpc !== '2.0') return this.fail(codedError('HARNESS_PROTOCOL_ERROR', 'Invalid Harness protocol'));
        if (frame.id !== undefined) {
          const pending = this.pending.get(frame.id); if (!pending) continue;
          this.pending.delete(frame.id); clearTimeout(pending.timer);
          if (frame.error) pending.reject(codedError('HARNESS_TURN_FAILED', 'Harness SDK rejected the request'));
          else pending.resolve(frame.result);
        } else if (typeof frame.method === 'string') {
          try { this.onNotification?.(frame); } catch { this.fail(codedError('HARNESS_PROTOCOL_ERROR', 'Harness notification failed')); return; }
        }
      }
    });
  }
  request(method, params, timeoutMs = 30000) {
    if (this.closed || !this.child) return Promise.reject(this.failure || codedError('HARNESS_PROCESS_EXITED', 'Harness process unavailable'));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(codedError('REQUEST_TIMEOUT', 'Harness SDK timed out')); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n', error => {
        if (!error) return; const pending = this.pending.get(id); if (!pending) return;
        this.pending.delete(id); clearTimeout(timer); reject(codedError('HARNESS_PROCESS_EXITED', 'Harness input closed'));
      });
    });
  }
  fail(error) {
    if (this.closed) return;
    this.failure = error;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
    this.onFailure?.(error); this.close();
  }
  removeRoot() {
    if (!this.root) return;
    const target = this.root; this.root = null;
    try {
      const resolved = fs.realpathSync(target);
      // Check absolute identity and the immediate parent before any recursive delete.
      if (!path.isAbsolute(resolved) || resolved !== this.createdRoot ||
          path.dirname(resolved) !== this.taskParent || !/^sdk-[A-Za-z0-9_-]+$/.test(path.basename(resolved)) ||
          fs.lstatSync(target).isSymbolicLink()) return;
      fs.rmSync(resolved, { recursive: true, force: true });
    } catch { /* OS may briefly hold attachment files. */ }
  }
  close() {
    if (this.closed) return; this.closed = true;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(this.failure || codedError('CANCELLED', 'Harness request closed')); }
    this.pending.clear();
    if (!this.child || this.exited) { this.removeRoot(); return; }
    try { this.child.stdin.end(JSON.stringify({ jsonrpc: '2.0', id: ++this.sequence, method: 'shutdown', params: {} }) + '\n'); } catch {}
    const child = this.child;
    const timer = setTimeout(() => { if (!this.exited) child.kill(); }, 750);
    timer.unref?.(); child.once('exit', () => clearTimeout(timer));
  }
}

class HarnessBridgeService {
  constructor(options = {}) {
    this.send = options.send || (() => {});
    this.processFactory = options.processFactory || (() => new HarnessSdkProcess());
    this.active = new Map(); this.controls = new Map(); this.closed = false;
  }
  async handle(message) {
    if (this.closed) return;
    const requestId = String(message.requestId || '');
    if (!requestId || requestId.length > 200 || /[\x00-\x1f]/.test(requestId)) return;
    if (message.type === 'harness.turn.cancel') {
      const context = this.active.get(requestId);
      if (context) this.finish(context, 'cancelled');
      return;
    }
    if (message.type === 'harness.control.cancel') {
      const context = this.controls.get(requestId);
      if (context) this.finishControl(context, 'cancelled');
      return;
    }
    if (message.type === 'harness.turn.start') return this.startTurn(message);
    if (!['harness.health.check', 'harness.models.list'].includes(message.type)) {
      this.send({ type: 'harness.error', requestId, error: harnessPublicError({ code: 'INVALID_SETTINGS' }) }); return;
    }
    if (this.controls.has(requestId) || this.active.has(requestId)) return;
    const context = { requestId, child: null, terminal: false };
    this.controls.set(requestId, context);
    try {
      const child = context.child = this.processFactory();
      await child.start(() => {}, error => this.finishControl(context, 'error', error));
      if (context.terminal || this.closed || this.controls.get(requestId) !== context) return;
      const data = await child.request(message.type === 'harness.health.check' ? 'brevess.health' : 'brevess.models', {});
      if (context.terminal || this.closed || this.controls.get(requestId) !== context) return;
      this.finishControl(context, 'completed', null, { type: message.type === 'harness.health.check' ? 'harness.health.result' : 'harness.models.result', requestId,
        hostVersion: HOST_VERSION, version: child.installation?.version || HARNESS_SUPPORTED_VERSION,
        installed: true, toolsEnabled: false, webSearchSupported: true,
        allowedWebTools: ['web_search'], provider: HARNESS_PROVIDER,
        ...(message.type === 'harness.health.check' ? { accountStatus: data.accountStatus,
          credentialStored: data.accountStatus === 'credential-stored' } : { models: data.models || [] }) });
    } catch (error) {
      if (!context.terminal && !this.closed) this.finishControl(context, 'error', error);
    }
  }
  finishControl(context, status, error, result) {
    if (context.terminal || this.controls.get(context.requestId) !== context) return;
    context.terminal = true;
    this.controls.delete(context.requestId);
    context.child?.close();
    if (this.closed) return;
    this.send(status === 'completed' ? result : status === 'cancelled'
      ? { type: 'harness.control.cancelled', requestId: context.requestId }
      : { type: 'harness.error', requestId: context.requestId, error: harnessPublicError(error) });
  }
  async startTurn(message) {
    const requestId = String(message.requestId);
    if (this.active.has(requestId) || this.controls.has(requestId)) return; // Existing owned request remains intact.
    let input;
    try { input = validateHarnessTurn(message); }
    catch (error) { this.send({ type: 'harness.turn.error', requestId, error: harnessPublicError(error) }); return; }
    const context = { requestId, input, child: this.processFactory(), sessionId: 'brevess-' + crypto.randomUUID(),
      turn: null, terminal: false, text: '', streamed: '', usage: null, liveUsage: null, startedAt: Date.now(), seen: new Set(),
      webEvents: new Map(), lastWebSeq: 0, webCall: null, webResult: null, finalStep: null, finalSeq: null };
    this.active.set(requestId, context);
    context.timer = setTimeout(() => this.finish(context, 'error', { code: 'REQUEST_TIMEOUT' }), input.timeoutMs);
    try {
      await context.child.start(frame => this.notification(context, frame), error => this.finish(context, 'error', error));
      if (context.terminal) return;
      const catalog = await context.child.request('brevess.models', {});
      if (context.terminal) return;
      const model = catalog.models?.find(entry => entry.id === input.model);
      if (!model) {
        const health = await context.child.request('brevess.health', {});
        throw codedError(health.accountStatus === 'signed-out' ? 'HARNESS_NOT_AUTHENTICATED' : 'HARNESS_MODEL_UNAVAILABLE', 'Selected Harness model is not available');
      }
      if (input.contentBlocks.some(b => b.type === 'image') && !model.inputModalities?.includes('image')) throw codedError('HARNESS_IMAGE_UNSUPPORTED', 'Selected Harness model does not accept images');
      await context.child.request('brevess.configure', { systemPrompt: input.systemPrompt, webSearch: input.webSearch });
      if (context.terminal) return;
      await context.child.request('initialize', { cwd: context.child.root || stateDirectory(), provider: HARNESS_PROVIDER,
        model: input.model, maxTokens: input.maxTokens, ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}) });
      if (context.terminal) return;
      this.send({ type: 'harness.turn.started', requestId, model: input.model, sessionId: context.sessionId });
      // Events can arrive before this enqueue acknowledgement resolves.
      context.promptSent = true;
      await context.child.request('session/prompt', { sessionId: context.sessionId, contentBlocks: input.contentBlocks });
    } catch (error) { if (!context.terminal) this.finish(context, 'error', error); }
  }
  notification(context, frame) {
    if (context.terminal || !context.promptSent || frame.params?.sessionId !== context.sessionId) return;
    const params = frame.params;
    if (frame.method === 'brevess.toolRejected') { this.finish(context, 'error', { code: 'HARNESS_TOOL_DISABLED' }); return; }
    if (context.input.webSearch && ['brevess.delta', 'brevess.usage'].includes(frame.method)) return;
    if (frame.method === 'brevess.usage') { context.liveUsage = normalizeHarnessUsage(params.usage); return; }
    if (frame.method === 'brevess.delta') {
      if (typeof params.text !== 'string' || !Number.isSafeInteger(params.revision) || context.seen.has('r:' + params.revision)) return;
      if (context.attemptId && context.attemptId !== params.attemptId) { this.finish(context, 'error', { code: 'HARNESS_PROTOCOL_ERROR' }); return; }
      context.attemptId = params.attemptId;
      context.seen.add('r:' + params.revision); context.streamed += params.text;
      if (context.streamed.length > 8 * 1024 * 1024) { this.finish(context, 'error', { code: 'HARNESS_PROTOCOL_ERROR' }); return; }
      this.sendText(context, params.text); return;
    }
    if (frame.method !== 'session.event') return;
    const event = params.event, data = event?.data || {};
    if (event?.type === 'turn/start' && context.turn === null) {
      if (Number.isSafeInteger(data.turn) && data.turn > 0) context.turn = data.turn;
      return;
    }
    if (context.turn === null || data.turn !== context.turn) return;
    if (context.input.webSearch && ['assistant/message', 'tool/call', 'tool/result', 'turn/end'].includes(event.type)) {
      if (!Number.isSafeInteger(event.seq) || event.seq <= 0) {
        this.finish(context, 'error', { code: 'HARNESS_PROTOCOL_ERROR' }); return;
      }
      const fingerprint = crypto.createHash('sha256')
        .update(JSON.stringify({ type: event.type, data, sourceEventSeqs: event.sourceEventSeqs })).digest('hex');
      if (context.webEvents.has(event.seq)) {
        if (context.webEvents.get(event.seq) !== fingerprint) this.finish(context, 'error', { code: 'HARNESS_PROTOCOL_ERROR' });
        return;
      }
      if (event.seq <= context.lastWebSeq || context.webEvents.size >= 64) {
        this.finish(context, 'error', { code: 'HARNESS_PROTOCOL_ERROR' }); return;
      }
      context.webEvents.set(event.seq, fingerprint); context.lastWebSeq = event.seq;
    }
    if (event.type === 'tool/call') {
      const queries = data.arguments?.queries;
      if (!context.input.webSearch || data.name !== 'web_search' || context.webCall ||
          typeof data.callId !== 'string' || !data.callId || data.callId.length > 200 || /[\x00-\x1f\x7f]/.test(data.callId) ||
          !Number.isSafeInteger(data.step) || data.step < 1 || !Array.isArray(queries) || queries.length !== 1 ||
          typeof queries[0] !== 'string' || !queries[0].trim() || queries[0].length > 8192) {
        this.finish(context, 'error', { code: 'HARNESS_TOOL_DISABLED' }); return;
      }
      context.webCall = { callId: data.callId, step: data.step, seq: event.seq }; return;
    }
    if (event.type === 'tool/result' && context.input.webSearch) {
      const call = context.webCall, message = data.message, sources = harnessWebSources(data.meta);
      if (!call || context.webResult || data.step !== call.step || message?.role !== 'tool' ||
          message.toolCallId !== call.callId || message.source?.kind !== 'tool' || message.source.callId !== call.callId ||
          message.isError || data.error !== undefined || !Array.isArray(event.sourceEventSeqs) ||
          event.sourceEventSeqs.length !== 1 || event.sourceEventSeqs[0] !== call.seq || !sources) {
        this.finish(context, 'error', { code: 'WEB_SEARCH_GROUNDING_MISSING' }); return;
      }
      context.webResult = { seq: event.seq, sources }; return;
    }
    if (event.type === 'assistant/message') {
      const identity = 'message:' + (event.seq ?? data.step);
      if (context.seen.has(identity)) return; context.seen.add(identity);
      const content = data.message?.content || [];
      const text = content.filter(block => block.type === 'text').map(block => block.text || '').join('');
      if (context.input.webSearch) {
        const hasTools = content.some(block => block.type === 'tool-call');
        const source = data.message?.source;
        if (!hasTools && (data.message?.role !== 'assistant' || source?.kind !== 'model' ||
            source.provider !== HARNESS_PROVIDER || source.model !== context.input.model)) {
          this.finish(context, 'error', { code: 'WEB_SEARCH_RESPONSE_INCOMPLETE' }); return;
        }
        context.text = hasTools || data.interrupted === true ? '' : text;
        context.finalStep = hasTools || data.interrupted === true ? null : data.step;
        context.finalSeq = hasTools || data.interrupted === true ? null : event.seq;
      } else context.text += text;
      if (context.text.length > 8 * 1024 * 1024) { this.finish(context, 'error', { code: 'HARNESS_PROTOCOL_ERROR' }); return; }
      if (!context.input.webSearch && !context.streamed && text) this.sendText(context, text);
      const usage = normalizeHarnessUsage(data.usage);
      if (usage) {
        if (!context.usage) context.usage = usage;
        else for (const key of ['inputTokens', 'outputTokens', 'totalTokens', 'reasoningTokens', 'cacheHitTokens', 'cacheMissTokens']) context.usage[key] += usage[key];
        if (!context.input.webSearch) this.send({ type: 'harness.turn.usage', requestId: context.requestId, usage: context.usage });
      }
    } else if (event.type === 'turn/end') {
      const kind = data.reason?.kind;
      if (context.input.webSearch && kind === 'completed') {
        if (!context.webCall || !context.webResult) this.finish(context, 'error', { code: 'WEB_SEARCH_GROUNDING_MISSING' });
        else if (!context.text.trim() || !Number.isSafeInteger(context.finalStep) || context.finalStep <= context.webCall.step ||
            !Number.isSafeInteger(context.finalSeq) || context.finalSeq <= context.webResult.seq) {
          this.finish(context, 'error', { code: 'WEB_SEARCH_RESPONSE_INCOMPLETE' });
        } else {
          this.sendText(context, context.text); this.finish(context, 'completed');
        }
      } else if (context.streamed && context.streamed !== context.text && kind === 'completed') this.finish(context, 'error', { code: 'HARNESS_PROTOCOL_ERROR' });
      else if (kind === 'completed' && context.text.trim()) this.finish(context, 'completed');
      else this.finish(context, 'error', kind === 'max-tokens' ? { code: 'HARNESS_MAX_TOKENS' }
        : kind === 'error' ? classifyHarnessLlmFailure(data.reason?.error) : { code: 'HARNESS_TURN_FAILED' });
    }
  }
  sendText(context, text) {
    // Keep every Native Messaging frame safely below Chromium's 1 MiB cap.
    for (let offset = 0; offset < text.length; offset += 65536) this.send({
      type: 'harness.turn.delta', requestId: context.requestId, text: text.slice(offset, offset + 65536)
    });
  }
  finish(context, status, error) {
    if (context.terminal) return;
    context.terminal = true; clearTimeout(context.timer); this.active.delete(context.requestId);
    const knownUsage = context.usage || context.liveUsage || { inputTokens: Math.ceil((context.input.systemPrompt.length + context.input.contentBlocks[0].text.length) / 4) + (context.input.contentBlocks.length - 1) * 1024,
      outputTokens: Math.ceil((context.text || context.streamed).length / 4), estimated: true };
    // The official auxiliary-search provider does not expose its model usage.
    const usage = context.input.webSearch ? { ...knownUsage, estimated: true, searchUsageIncluded: false } : knownUsage;
    this.send({ type: 'harness.turn.' + status, requestId: context.requestId, model: context.input.model,
      elapsedMs: Date.now() - context.startedAt, usage,
      ...(status === 'completed' ? { finishReason: 'stop' } : {}),
      ...(status === 'completed' && context.input.webSearch ? { webSearch: { schemaVersion: 1, searched: true,
        responseId: context.sessionId + ':' + context.turn, callId: context.webCall.callId,
        sources: context.webResult.sources } } : {}),
      ...(error ? { error: harnessPublicError(error) } : {}) });
    context.child.close();
  }
  close() {
    if (this.closed) return; this.closed = true;
    for (const context of [...this.active.values()]) this.finish(context, 'cancelled');
    for (const context of [...this.controls.values()]) this.finishControl(context, 'cancelled');
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
    this.workspaceDirectoryService = options.workspaceDirectoryService ||
      new WorkspaceDirectoryService(options.workspaceDirectoryOptions);
    this.send = options.send || (() => {});
    this.harness = options.harness || new HarnessBridgeService({ send: this.send });
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
        jsonResponseCapabilities: {
          version: 1,
          completedFinal: true,
          outputSchemaForwarding: true
        },
        terminationReceiptCapabilities: { version: 1, upstreamTerminal: true },
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
        cancelPending: message.responseMode === 'json' && this.pendingCancellations.has(requestId),
        startedSent: false,
        imageLease,
        jsonResponse: message.responseMode === 'json' ? {
          items: new Map(),
          invalidReason: '',
          textBytes: 0,
          eventCount: 0,
          resourceTerminated: false,
          resourceInterruptSent: false,
          schemaForwarded: Object.prototype.hasOwnProperty.call(message, 'outputSchema')
        } : null
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
        ...(effort !== 'auto' ? { effort } : {}),
        ...(context.jsonResponse?.schemaForwarded ? { outputSchema: message.outputSchema } : {})
      });
      if (context.jsonResponse?.resourceTerminated) {
        if (!context.jsonResponse.resourceInterruptSent && result?.turn?.id) {
          context.turnId = String(result.turn.id);
          context.jsonResponse.resourceInterruptSent = true;
          void this.interruptContext(context);
        }
        return;
      }
      const turnId = String(result?.turn?.id || '');
      if (!turnId) {
        throw codedError('CODEX_PROVIDER_REJECTED', 'Codex did not return a turn ID');
      }
      context.turnId = turnId;
      if (!context.startedSent) {
        context.startedSent = true;
        this.send({ type: 'turn.started', requestId, threadId, turnId });
      }
      const pendingCancellation = this.pendingCancellations.delete(requestId);
      if (context.cancelPending || pendingCancellation) {
        context.cancelPending = true;
        await this.interruptContext(context);
      }
    } catch (error) {
      if (context) this.active.delete(requestId);
      if (!context?.jsonResponse?.resourceTerminated) {
        this.imageStore.cleanup(context?.imageLease || imageLease);
        this.send({ type: 'turn.error', requestId, error: publicError(error) });
      }
    } finally {
      this.pendingCancellations.delete(requestId);
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

  recordJsonItem(context, itemId, rawPhase, eventType, text) {
    const json = context.jsonResponse;
    const id = typeof itemId === 'string' ? itemId : '';
    const phase = rawPhase === 'final_answer' || rawPhase === 'commentary' ? rawPhase : null;
    const value = typeof text === 'string' ? text : '';
    const textBytes = Buffer.byteLength(value, 'utf8');
    const previous = json.items.get(id);
    if (eventType === 'completed' && (phase || previous?.phase) === 'final_answer' &&
        textBytes > MAX_NATIVE_OUTPUT_BYTES) {
      this.abortJsonResources(context, 'Codex bridge output exceeded the Native Messaging limit', 'INVALID_RESPONSE');
      return;
    }
    if (Buffer.byteLength(id, 'utf8') > MAX_JSON_ITEM_ID_BYTES ||
        (!previous && json.items.size >= MAX_JSON_TURN_ITEMS) ||
        json.eventCount >= MAX_JSON_TURN_EVENTS ||
        textBytes > MAX_JSON_TURN_TEXT_BYTES - json.textBytes) {
      this.abortJsonResources(context, 'JSON response exceeded the request-wide resource limit');
      return;
    }
    json.eventCount += 1;
    json.textBytes += textBytes;
    const textHash = crypto.createHash('sha256').update(value, 'utf8').digest('hex');
    if (!id) json.invalidReason = 'A JSON response item has no identity';
    if (rawPhase !== undefined && rawPhase !== null && !phase) {
      json.invalidReason = 'A JSON response item has unsupported phase metadata';
    }
    let item = json.items.get(id);
    if (!item) {
      item = { itemId: id, phase: null, completed: false, completedText: '', completedTextHash: '' };
      json.items.set(id, item);
    }
    if (phase) {
      if (item.phase && item.phase !== phase) {
        json.invalidReason = 'A JSON response item has conflicting phase metadata';
      } else {
        item.phase = phase;
      }
    }
    if (eventType === 'completed') {
      const completedTextHash = crypto.createHash('sha256').update(value, 'utf16le').digest('hex');
      if (typeof text !== 'string') {
        json.invalidReason = 'A completed JSON response item has no full text';
      } else if (item.completed && (item.completedTextHash !== completedTextHash ||
          (item.phase !== 'commentary' && item.completedText !== text))) {
        json.invalidReason = 'A JSON response item has conflicting completed text';
      } else {
        item.completed = true;
        item.completedText = text;
        item.completedTextHash = completedTextHash;
      }
    }
    if (item.phase === 'commentary') item.completedText = '';
    this.send({
      type: 'turn.item.diagnostic',
      requestId: context.requestId,
      itemId: id,
      phase: item.phase === 'final_answer' ? 'final' : item.phase || 'unknown',
      eventType,
      textLength: value.length,
      textHash
    });
  }

  abortJsonResources(context, message, code = 'CODEX_JSON_RESOURCE_LIMIT') {
    const json = context.jsonResponse;
    if (json.resourceTerminated) return;
    json.resourceTerminated = true;
    json.resourceInterruptSent = Boolean(context.threadId && context.turnId);
    json.items.clear();
    this.active.delete(context.requestId);
    this.pendingCancellations.delete(context.requestId);
    this.imageStore.cleanup(context.imageLease);
    this.send({ type: 'turn.error', requestId: context.requestId,
      error: publicError(codedError(code, message, false)) });
    void this.interruptContext(context);
  }

  commitJsonResponse(context) {
    const json = context.jsonResponse;
    const reject = (message, code = 'CODEX_JSON_PROTOCOL_INVALID') => {
      this.send({ type: 'turn.error', requestId: context.requestId,
        terminationReceiptProtocol: 1, upstreamStatus: 'completed',
        threadId: context.threadId, turnId: context.turnId,
        error: publicError(codedError(code, message, false)) });
      return false;
    };
    if (json.invalidReason) return reject(json.invalidReason);
    const completed = [...json.items.values()].filter(item => item.completed);
    if (completed.some(item => !item.phase)) {
      return reject('A completed JSON response item has unknown phase');
    }
    const finals = completed.filter(item => item.phase === 'final_answer');
    if (finals.length !== 1) return reject('JSON response requires exactly one completed final assistant item');
    const item = finals[0];
    if (!item.completedText.trim()) return reject('The completed JSON final assistant item is empty');
    const message = {
      type: 'turn.delta',
      requestId: context.requestId,
      text: item.completedText,
      itemId: item.itemId,
      phase: 'final',
      itemCompleted: true,
      jsonResponseProtocol: 1,
      schemaForwarded: json.schemaForwarded
    };
    if (Buffer.byteLength(JSON.stringify(message), 'utf8') > MAX_NATIVE_OUTPUT_BYTES) {
      return reject('Codex bridge output exceeded the Native Messaging limit', 'INVALID_RESPONSE');
    }
    this.send(message);
    return true;
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
      if (context.jsonResponse) {
        this.recordJsonItem(context, params.item.id, params.item.phase, 'started', params.item.text);
        return;
      }
      context.phases.set(String(params.item.id), params.item.phase || null);
      return;
    }
    if (method === 'item/agentMessage/delta') {
      if (context.jsonResponse) {
        this.recordJsonItem(context, params.itemId, null, 'delta', params.delta);
        return;
      }
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
      if (context.jsonResponse) {
        this.recordJsonItem(context, params.item.id, params.item.phase, 'completed', params.item.text);
        return;
      }
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
      const terminationProof = context.jsonResponse && ['completed', 'interrupted', 'failed'].includes(params.turn?.status) ? { terminationReceiptProtocol: 1,
        threadId: context.threadId, turnId: context.turnId,
        upstreamStatus: status === 'completed' ? 'completed' : status === 'interrupted' ? 'interrupted' : 'failed' } : {};
      if (context.usage) {
        this.send({
          type: 'turn.usage',
          requestId: context.requestId,
          usage: context.usage
        });
      }
      if (status === 'completed') {
        if (context.jsonResponse && context.cancelPending) {
          this.send({ type: 'turn.cancelled', requestId: context.requestId, ...terminationProof });
        } else if (!context.jsonResponse || this.commitJsonResponse(context)) {
          this.send({
            type: 'turn.completed',
            requestId: context.requestId,
            ...terminationProof,
            finishReason: 'stop',
            usage: context.usage
          });
        }
      } else if (status === 'interrupted') {
        this.send({ type: 'turn.cancelled', requestId: context.requestId, ...terminationProof });
      } else {
        const turnError = classifyTurnError(params.turn?.error || {});
        appendLog(
          `turn failed code=${turnError.code} status=${turnError.status || 0} ` +
          `message=${turnError.message}`
        );
        this.send({
          type: 'turn.error',
          requestId: context.requestId,
          ...terminationProof,
          error: publicError(turnError)
        });
      }
      this.imageStore.cleanup(context.imageLease);
      this.active.delete(context.requestId);
      this.pendingCancellations.delete(context.requestId);
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
    if (type.startsWith('harness.')) return this.harness.handle(message);
    if (type.startsWith('workspace.directory.')) {
      const requestId = String(message.requestId || '');
      try {
        const action = type.slice('workspace.directory.'.length);
        if (!['status', 'bind', 'open', 'openResearch'].includes(action)) {
          throw workspaceDirectoryError('INVALID_REQUEST', 'Unknown workspace directory request.');
        }
        const result = await this.workspaceDirectoryService[action](message);
        this.send({ type: `${type}.result`, requestId, ...result });
      } catch (error) {
        this.send({ type: 'workspace.directory.error', requestId, error: publicError(error) });
      }
      return;
    }
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
    this.harness.close();
    for (const context of this.active.values()) {
      this.imageStore.cleanup(context.imageLease);
    }
    this.active.clear();
    this.pendingCancellations.clear();
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
  HarnessBridgeService,
  HarnessSdkProcess,
  harnessBootstrapSource,
  findHarnessInstallation,
  normalizeHarnessUsage,
  validateHarnessTurn,
  CodexAppServer,
  CodexBridgeHost,
  WorkspaceDirectoryService,
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
