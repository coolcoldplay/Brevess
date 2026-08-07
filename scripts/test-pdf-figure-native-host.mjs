import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptRoot = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(scriptRoot);
const useExecutable = process.argv.includes('--exe');
const pdfFlag = process.argv.indexOf('--pdf');
const pdfPath = pdfFlag >= 0 ? resolve(process.argv[pdfFlag + 1] || '') : '';
const executablePath = join(
  projectRoot, 'native-host', 'bin', 'brevess-codex-host.exe'
);
const hostPath = join(projectRoot, 'native-host', 'host.js');
const testStateRoot = join(projectRoot, 'tmp', 'native-host-smoke-state');
const child = spawn(
  useExecutable ? executablePath : process.execPath,
  useExecutable ? [] : [hostPath],
  {
    cwd: projectRoot,
    env: { ...process.env, LOCALAPPDATA: testStateRoot },
    stdio: ['pipe', 'pipe', 'inherit'],
    windowsHide: true
  }
);

let inputBuffer = Buffer.alloc(0);
const messages = [];
const waiters = [];
const encode = message => {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
};
const send = message => child.stdin.write(encode(message));

function pushMessage(message) {
  messages.push(message);
  for (let index = waiters.length - 1; index >= 0; index -= 1) {
    if (!waiters[index].predicate(message)) continue;
    const waiter = waiters.splice(index, 1)[0];
    clearTimeout(waiter.timer);
    waiter.resolve(message);
  }
}

child.stdout.on('data', chunk => {
  inputBuffer = Buffer.concat([inputBuffer, chunk]);
  while (inputBuffer.length >= 4) {
    const length = inputBuffer.readUInt32LE(0);
    if (inputBuffer.length < length + 4) break;
    const body = inputBuffer.subarray(4, length + 4);
    inputBuffer = inputBuffer.subarray(length + 4);
    pushMessage(JSON.parse(body.toString('utf8')));
  }
});

function waitFor(predicate, timeoutMs = 180000) {
  const existing = messages.find(predicate);
  if (existing) return Promise.resolve(existing);
  return new Promise((resolveWait, reject) => {
    const timer = setTimeout(() => reject(new Error(
      'Timed out waiting for PDF Figure Native Messaging response'
    )), timeoutMs);
    waiters.push({ predicate, resolve: resolveWait, reject, timer });
  });
}

async function request(message, terminalTypes, timeoutMs) {
  send(message);
  const result = await waitFor(candidate =>
    candidate.requestId === message.requestId && terminalTypes.includes(candidate.type),
  timeoutMs);
  if (result.type === 'pdf.figure.extract.error' || result.type === 'host.error') {
    throw new Error(`${result.error?.code || result.type}: ${result.error?.message || ''}`);
  }
  return result;
}

async function extract(pdfBytes) {
  const taskId = `pdf-smoke-${Date.now()}`;
  const fingerprint = createHash('sha256').update(pdfBytes).digest('hex');
  await request({
    type: 'pdf.figure.extract.begin', requestId: 'begin', taskId,
    fileName: basename(pdfPath), kind: 'main', totalBytes: pdfBytes.length,
    documentFingerprint: fingerprint
  }, ['pdf.figure.upload.ready', 'pdf.figure.extract.error']);
  const chunkSize = 512 * 1024;
  for (let offset = 0; offset < pdfBytes.length; offset += chunkSize) {
    await request({
      type: 'pdf.figure.extract.chunk', requestId: `chunk-${offset}`, taskId,
      offset, data: pdfBytes.subarray(offset, offset + chunkSize).toString('base64')
    }, ['pdf.figure.upload.ack', 'pdf.figure.extract.error']);
  }
  const result = await request({
    type: 'pdf.figure.extract.commit', requestId: 'commit', taskId
  }, ['pdf.figure.extract.result', 'pdf.figure.extract.error'], 10 * 60 * 1000);
  if (!result.figures?.length) throw new Error('No whole Figures were extracted');
  const first = result.figures[0];
  const imageParts = [];
  for (let offset = 0; offset < first.byteLength;) {
    const part = await request({
      type: 'pdf.figure.image.read', requestId: `image-${offset}`, taskId,
      imageId: first.imageId, offset, length: 384 * 1024
    }, ['pdf.figure.image.chunk', 'pdf.figure.extract.error']);
    imageParts.push(Buffer.from(part.data, 'base64'));
    offset = part.nextOffset;
  }
  const image = Buffer.concat(imageParts);
  const imageHash = createHash('sha256').update(image).digest('hex');
  if (imageHash !== first.sha256) throw new Error('Figure image SHA-256 mismatch');
  await request({
    type: 'pdf.figure.extract.release', requestId: 'release', taskId
  }, ['pdf.figure.extract.released', 'pdf.figure.extract.error']);
  return {
    figureCount: result.figures.length,
    labels: result.figures.map(figure => `${figure.figType} ${figure.name}`),
    firstImageBytes: image.length,
    noLocalPathLeak: !JSON.stringify(result).includes(projectRoot)
  };
}

try {
  if (useExecutable && !existsSync(executablePath)) {
    throw new Error(`Native host executable is missing: ${executablePath}`);
  }
  const health = await request({
    type: 'pdf.figure.health', requestId: 'pdf-health'
  }, ['pdf.figure.health.result', 'pdf.figure.extract.error']);
  if (!health.available) throw new Error(`PDF engine unavailable: ${health.reason}`);
  const extraction = pdfPath ? await extract(readFileSync(pdfPath)) : null;
  console.log(JSON.stringify({
    passed: true,
    transport: useExecutable ? 'native-executable' : 'node-source',
    health: {
      extractorVersion: health.extractorVersion,
      javaVersion: health.javaVersion
    },
    extraction
  }, null, 2));
} finally {
  child.stdin.end();
  child.kill();
}
