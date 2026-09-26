import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, extname, join, resolve } from 'node:path';

const scriptRoot = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(scriptRoot);
const hostPath = join(projectRoot, 'native-host', 'host.js');
const useExecutable = process.argv.includes('--exe');
const allowAuthRequired = process.argv.includes('--allow-auth-required');
const visionImageFlag = process.argv.indexOf('--vision-image');
const visionImagePath = visionImageFlag >= 0
  ? resolve(process.argv[visionImageFlag + 1] || '') : '';
const executablePath = join(
  projectRoot, 'native-host', 'bin', 'brevess-codex-host.exe'
);
const child = spawn(
  useExecutable ? executablePath : process.execPath,
  useExecutable
    ? ['chrome-extension://test/']
    : [hostPath, 'chrome-extension://test/'],
  {
    cwd: projectRoot,
    stdio: ['pipe', 'pipe', 'inherit'],
    windowsHide: true
  }
);

let inputBuffer = Buffer.alloc(0);
const waiters = [];
const messages = [];

function encode(message) {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

function pushMessage(message) {
  messages.push(message);
  for (let index = waiters.length - 1; index >= 0; index -= 1) {
    const waiter = waiters[index];
    if (!waiter.predicate(message)) continue;
    waiters.splice(index, 1);
    clearTimeout(waiter.timer);
    waiter.resolve(message);
  }
}

child.stdout.on('data', chunk => {
  inputBuffer = Buffer.concat([inputBuffer, chunk]);
  while (inputBuffer.length >= 4) {
    const length = inputBuffer.readUInt32LE(0);
    if (inputBuffer.length < length + 4) break;
    const body = inputBuffer.subarray(4, 4 + length);
    inputBuffer = inputBuffer.subarray(4 + length);
    pushMessage(JSON.parse(body.toString('utf8')));
  }
});

function waitFor(predicate, timeoutMs = 180000) {
  const existing = messages.find(predicate);
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const index = waiters.findIndex(item => item.resolve === resolve);
      if (index >= 0) waiters.splice(index, 1);
      reject(new Error('Timed out waiting for Native Host response'));
    }, timeoutMs);
    waiters.push({ predicate, resolve, reject, timer });
  });
}

function send(message) {
  child.stdin.write(encode(message));
}

async function runTurn(requestId, question) {
  send({
    type: 'turn.start',
    requestId,
    conversationKey: 'sci-reader-real-codex-smoke-test',
    conversationLabel: 'Brevess Codex smoke test',
    profileId: 'profile_codex_smoke',
    model: 'auto',
    reasoningEffort: 'low',
    systemPrompt: [
      'Return exactly two newline-delimited JSON objects and no Markdown fence.',
      '{"type":"answer_block","block_id":"block-1","markdown":"...","evidence":[]}',
      '{"type":"final","summary":"..."}'
    ].join('\n'),
    userPrompt: `Write a five-word answer to: ${question}`,
    maxOutputTokens: 512
  });
  const started = await waitFor(message =>
    message.requestId === requestId && message.type === 'turn.started'
  );
  await waitFor(message =>
    message.requestId === requestId &&
    ['turn.completed', 'turn.error', 'turn.cancelled'].includes(message.type)
  );
  const output = messages
    .filter(message => message.requestId === requestId && message.type === 'turn.delta')
    .map(message => message.text).join('');
  return { started, output };
}

async function runVisionTurn(requestId, imagePath) {
  const extension = extname(imagePath).toLowerCase();
  const mediaType = extension === '.jpg' || extension === '.jpeg'
    ? 'image/jpeg' : extension === '.webp' ? 'image/webp' : 'image/png';
  const dataUrl = `data:${mediaType};base64,${readFileSync(imagePath).toString('base64')}`;
  send({
    type: 'turn.start',
    requestId,
    conversationKey: '',
    conversationLabel: 'Brevess Codex vision smoke test',
    profileId: 'profile_codex_vision_smoke',
    model: 'auto',
    reasoningEffort: 'low',
    systemPrompt: [
      'Read the attached screenshot itself.',
      'Return only one JSON object: {"figure_count":NUMBER}.',
      'NUMBER is the count immediately before "张 Figure" in the top completion notification.'
    ].join(' '),
    userPrompt: 'Inspect the pixels and return the requested number.',
    images: [{ mediaType, dataUrl, detail: 'high' }],
    maxOutputTokens: 128,
    ephemeral: true
  });
  await waitFor(message =>
    message.requestId === requestId && message.type === 'turn.started'
  );
  const terminal = await waitFor(message =>
    message.requestId === requestId &&
    ['turn.completed', 'turn.error', 'turn.cancelled'].includes(message.type)
  );
  if (terminal.type !== 'turn.completed') {
    throw new Error(`Vision turn failed: ${JSON.stringify(terminal)}`);
  }
  const output = messages
    .filter(message => message.requestId === requestId && message.type === 'turn.delta')
    .map(message => message.text).join('');
  if (!/"figure_count"\s*:\s*8\b/.test(output)) {
    throw new Error(`Codex did not read the screenshot pixels: ${output}`);
  }
  return output;
}

async function publishReverseChannelProbe() {
  send({
    type: 'reader.event.publish',
    requestId: 'reader-event-live',
    event: {
      eventType: 'reader.figure.result',
      streamKey: 'native-host-smoke-test',
      operationId: 'native-host-smoke-test',
      source: { title: 'Brevess reverse-channel smoke test', url: 'about:blank' },
      result: { passed: true, basis: 'vision_text' }
    }
  });
  const ack = await waitFor(message =>
    message.requestId === 'reader-event-live' &&
    ['reader.event.ack', 'host.error'].includes(message.type)
  );
  if (ack.type !== 'reader.event.ack' ||
      !existsSync(ack.latestEventPath) || !existsSync(ack.eventLogPath)) {
    throw new Error(`Reverse channel did not persist its event: ${JSON.stringify(ack)}`);
  }
  const latest = JSON.parse(readFileSync(ack.latestEventPath, 'utf8'));
  if (latest?.latest?.operationId !== 'native-host-smoke-test') {
    throw new Error('Reverse channel latest snapshot did not contain the probe event');
  }
  return ack;
}

try {
  send({ type: 'health.check', requestId: 'health-live' });
  const health = await waitFor(message =>
    message.requestId === 'health-live' &&
    ['health.result', 'host.error'].includes(message.type)
  );
  if (health.type !== 'health.result') {
    if (allowAuthRequired && health.error?.code === 'CODEX_NOT_AUTHENTICATED') {
      send({
        type: 'auth.login.start',
        requestId: 'login-live',
        force: false
      });
      const login = await waitFor(message =>
        message.requestId === 'login-live' &&
        ['auth.login.started', 'host.error'].includes(message.type)
      );
      if (login.type !== 'auth.login.started' ||
          !/^https:\/\/(?:auth\.openai\.com|chatgpt\.com)\//i.test(login.authUrl || '')) {
        throw new Error(`Plugin-scoped login did not start: ${JSON.stringify(login)}`);
      }
      console.log(JSON.stringify({
        passed: true,
        transport: useExecutable ? 'native-executable' : 'node-source',
        authenticated: false,
        authFlowAvailable: true,
        expectedAction: 'Open extension settings and use 登录 / 重新登录'
      }, null, 2));
      process.exitCode = 0;
    } else {
      throw new Error(JSON.stringify(health.error));
    }
  } else {
    const reverseChannel = await publishReverseChannelProbe();
    const first = await runTurn('turn-live-1', 'What powers photosynthesis?');
    const second = await runTurn('turn-live-2', 'What did I ask previously?');
    if (!first.output.includes('"type":"answer_block"') ||
        !first.output.includes('"type":"final"')) {
      throw new Error(`Unexpected first output: ${first.output}`);
    }
    if (first.started.threadId !== second.started.threadId) {
      throw new Error('Per-paper Codex thread was not resumed');
    }
    const visionOutput = visionImagePath
      ? await runVisionTurn('turn-live-vision', visionImagePath) : '';
    console.log(JSON.stringify({
      passed: true,
      transport: useExecutable ? 'native-executable' : 'node-source',
      authenticated: true,
      health: {
        accountType: health.accountType,
        planType: health.planType,
        userAgent: health.userAgent
      },
      reverseChannel: {
        eventLogPath: reverseChannel.eventLogPath,
        latestEventPath: reverseChannel.latestEventPath
      },
      threadResumed: true,
      visionVerified: Boolean(visionOutput),
      visionOutput,
      firstOutput: first.output,
      secondOutput: second.output
    }, null, 2));
  }
} finally {
  child.stdin.end();
  child.kill();
}
