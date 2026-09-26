// LIB010: real UI/runtime/background/store/directory/client + production host service.
// Only Native Messaging transport and OS process launch are replaced. OPFS bytes
// are copied verbatim to a disposable on-disk fixture for the host to validate.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { releaseInventory } from './release-inventory.mjs';
const require = createRequire(import.meta.url);
const { WorkspaceDirectoryService, CodexBridgeHost } = require('../native-host/host.js');
const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'output/playwright/lib010-directory-integration');
fs.mkdirSync(output, { recursive: true });
const run = fs.mkdtempSync(path.join(output, 'run-'));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-directory-integration-'));
const extension = path.join(temporary, 'extension'), diskRoot = path.join(temporary, 'Brevess');
const hostState = path.join(temporary, 'host-state');
const sourceFiles = ['background.js', 'core/workspace-directory-native-client.js',
  'core/workspace-directory-controller.js', 'core/directory-sync.js', 'core/article-workspace.js',
  'core/article-workspace-store.js', 'core/local-reading-library.js', 'native-host/host.js',
  'options.js', 'options.html', 'options-local-library.js', 'options-local-library.css'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const report = { status: 'FAIL', checks: [], sourceHashes: {}, endSourceHashes: {}, screenshots: [],
  errors: [], nativeCalls: [], launches: [], realApiCalls: 0, installed: false,
  boundary: 'Fresh isolated Edge. Unmodified production options/runtime/background/store/directory/client and native host dispatcher/service. Synthetic native IDB and OPFS fixtures, copied byte-for-byte to a disposable filesystem at BIND only. Native Messaging OS transport replaced with an isolated worker-to-Node message queue; explorer spawn is a recording substitute. No real external FSA selection, registry, installation, credentials, user data, provider call or visible Explorer window tested.' };
const check = (name, details) => { report.checks.push({ name, pass: true, details }); console.log(`PASS ${name}`); };
let context, page, worker, pumpTimer, pumpWork = Promise.resolve(), pumping = false;
const native = new WorkspaceDirectoryService({ stateRoot: hostState, platform: 'win32', systemRoot: 'C:\\Windows',
  spawnImpl(command, args, options) {
    assert.equal(command, 'C:\\Windows\\explorer.exe'); assert.equal(options.shell, false);
    assert.equal(args.length, 1); assert.ok(args[0].startsWith(diskRoot + path.sep));
    report.launches.push({ command: 'system Explorer', relativePath: path.relative(diskRoot, args[0]), shell: false });
    const child = new EventEmitter(); child.unref = () => {}; queueMicrotask(() => child.emit('spawn')); return child;
  } });
const responses = new Map();
const host = new CodexBridgeHost({ workspaceDirectoryService: native,
  server: { onNotification: () => () => {} }, threadMap: {}, imageStore: {}, eventStore: {},
  pdfFigureStore: {}, pdfTranslationPages: {}, send(message) { responses.get(message.requestId)?.(message); } });
const shot = async name => { await page.screenshot({ path: path.join(run, `${name}.png`) }); report.screenshots.push(`${name}.png`); };
const raw = message => page.evaluate(value => chrome.runtime.sendMessage(value), message);
const statusText = () => page.locator('#nativeDirectoryStatus').innerText();
try {
  for (const file of sourceFiles) report.sourceHashes[file] = sha(fs.readFileSync(path.join(root, file)));
  for (const item of releaseInventory(root, 'store')) {
    const destination = path.join(extension, item.path || item.source);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(root, item.path || item.source), destination);
  }
  const relay = async ({ message, entries }) => {
      assert.match(message.type, /^workspace\.directory\.(status|bind|open)$/u);
      if (message.type === 'workspace.directory.bind') {
        assert.ok(Array.isArray(entries) && entries.length < 30);
        for (const entry of entries) {
          assert.ok(entry.path.startsWith('Brevess/') && !entry.path.split('/').some(p => !p || p === '.' || p === '..' || p.includes('\\') || p.includes(':')));
          const destination = path.resolve(temporary, entry.path);
          assert.ok(destination.startsWith(diskRoot + path.sep));
          fs.mkdirSync(path.dirname(destination), { recursive: true });
          fs.writeFileSync(destination, Buffer.from(entry.base64, 'base64'));
        }
      } else assert.deepEqual(entries, []);
      report.nativeCalls.push({ type: message.type, rootId: message.rootId, workspaceId: message.workspaceId,
        keys: Object.keys(message).sort() });
      const result = await new Promise((resolve, reject) => {
        responses.set(message.requestId, resolve); Promise.resolve(host.handle(message)).catch(reject);
      });
      responses.delete(message.requestId); return result;
  };
  context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), { channel: 'msedge', headless: true,
    viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', timeout: 30_000,
    args: [`--load-extension=${extension}`, `--disable-extensions-except=${extension}`,
      '--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost'] });
  await context.route(/^https?:\/\//u, route => route.abort());
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 20_000 });
  await worker.evaluate(() => {
    globalThis.fetch = async (...args) => { throw Error('NO_EXTERNAL_API'); };
    globalThis.__directorySenders = []; globalThis.__directoryConnections = 0; globalThis.__directoryTransportErrors = [];
    globalThis.__directoryPackets = []; globalThis.__directoryReceivers = new Map();
    chrome.runtime.onMessage.addListener((message, sender) => {
      if (['USER_DATA_DIRECTORY_NATIVE_STATUS','USER_DATA_DIRECTORY_NATIVE_BIND','LOCAL_READING_LIBRARY_OPEN_DIRECTORY'].includes(message.type)) {
        __directorySenders.push({ type: message.type, keys: Object.keys(message).sort(), id: sender.id,
          url: sender.url, frameId: sender.frameId, origin: sender.origin });
      }
    });
    chrome.runtime.connectNative = name => {
      if (name !== 'com.sci_reader.codex_bridge') throw Error('UNEXPECTED_NATIVE_HOST');
      __directoryConnections++;
      const listeners = [], disconnected = []; let closed = false;
      return { onMessage: { addListener: fn => listeners.push(fn) }, onDisconnect: { addListener: fn => disconnected.push(fn) },
        disconnect() { closed = true; for (const fn of disconnected) fn(); },
        postMessage(message) { (async () => {
          const entries = [];
          if (message.type === 'workspace.directory.bind') {
            const selected = await SciLLM.createIndexedDbDirectoryHandleStore(indexedDB).load();
            const data = await selected.getDirectoryHandle('Brevess');
            async function walk(directory, prefix) {
              for await (const [name, item] of directory.entries()) {
                const current = `${prefix}/${name}`;
                if (item.kind === 'directory') await walk(item, current);
                else { const text = await (await item.getFile()).arrayBuffer();
                  entries.push({ path: current, base64: btoa(String.fromCharCode(...new Uint8Array(text))) }); }
              }
            }
            await walk(data, 'Brevess');
          }
          const result = await new Promise(resolve => { __directoryReceivers.set(message.requestId, resolve);
            __directoryPackets.push({ message, entries }); });
          if (!closed) for (const fn of listeners) fn(result);
        })().catch(error => { __directoryTransportErrors.push(String(error)); if (!closed) for (const fn of disconnected) fn(); }); }
      };
    };
  });
  pumpTimer = setInterval(() => {
    if (pumping) return;
    pumping = true;
    pumpWork = (async () => {
      const packets = await worker.evaluate(() => __directoryPackets.splice(0));
      for (const packet of packets) {
        const result = await relay(packet);
        await worker.evaluate(value => { const receive = __directoryReceivers.get(value.requestId);
          __directoryReceivers.delete(value.requestId); receive?.(value); }, result);
      }
    })().catch(error => report.errors.push(`transport: ${error.message}`)).finally(() => { pumping = false; });
  }, 40);
  page = await context.newPage(); page.setDefaultTimeout(12_000);
  page.on('pageerror', error => report.errors.push(error.message));
  const origin = `chrome-extension://${new URL(worker.url()).host}`;
  await page.goto(`${origin}/options.html#page=storage`);
  await page.locator('#nativeDirectorySettings').waitFor();
  assert.equal(await worker.evaluate(() => __directoryConnections), 0); check('real options startup performs zero native calls');
  await page.locator('#checkNativeDirectory').click();
  await page.locator('#nativeDirectoryStatus').filter({ hasText: '请先在' }).waitFor();
  assert.equal(fs.existsSync(hostState), false); check('actual options sender reaches capability and unconfigured status without writes');
  const workspace = await worker.evaluate(async () => {
    const selected = await (await navigator.storage.getDirectory()).getDirectoryHandle('lib010-isolated-root', { create: true });
    await SciLLM.createIndexedDbDirectoryHandleStore(indexedDB).save(selected);
    const root = await selected.getDirectoryHandle('Brevess', { create: true });
    const workspace = await articleWorkspaceStore.ensureWorkspace({ workspaceId: 'workspace:' + 'a'.repeat(64),
      canonicalUrl: 'https://example.org/lib010-synthetic', directoryName: '合成研究 Synthetic study--' + 'a'.repeat(16),
      title: '合成研究 · Synthetic study', contentHash: 'b'.repeat(64), workspaceGeneration: 1, revision: 1 });
    const manifest = SciLLM.createWorkspaceManifest(workspace);
    const write = async (directory, name, value) => { const file = await directory.getFileHandle(name, { create: true });
      const stream = await file.createWritable(); await stream.write(JSON.stringify(value)); await stream.close(); };
    const target = await (await root.getDirectoryHandle('workspaces', { create: true })).getDirectoryHandle(workspace.directoryName, { create: true });
    await write(target, 'manifest.json', manifest); await write(root, 'workspace-index.json', SciLLM.createWorkspaceIndex([manifest]));
    return workspace;
  });
  await page.locator('#checkNativeDirectory').click();
  await page.locator('#nativeDirectoryStatus').filter({ hasText: '尚未绑定' }).waitFor();
  check('read-only status reports missing binding without creating proof or native config');
  await page.locator('#nativeDirectoryPath').fill(path.join(temporary, 'does-not-exist'));
  await page.locator('#bindNativeDirectory').click();
  await page.locator('#nativeDirectoryStatus').filter({ hasText: '根目录已不存在' }).waitFor();
  assert.equal(fs.existsSync(hostState), false); check('wrong explicit path rejected by production host with no stored binding');
  await page.locator('#nativeDirectoryPath').fill(diskRoot); await page.locator('#bindNativeDirectory').click();
  await page.locator('#nativeDirectoryStatus').filter({ hasText: '绑定成功' }).waitFor();
  const proof = JSON.parse(fs.readFileSync(path.join(diskRoot, 'native-directory-binding.json')));
  const config = JSON.parse(fs.readFileSync(path.join(hostState, 'workspace-directories.json')));
  assert.equal(config.bindings[proof.rootId], fs.realpathSync(diskRoot));
  assert.ok(!JSON.stringify(config).includes(proof.challenge)); check('actual bind validates freshly written exact proof and persists only root mapping');
  await page.locator('#checkNativeDirectory').click();
  await page.locator('#nativeDirectoryStatus').filter({ hasText: 'Brevess' }).waitFor();
  await shot('bound-settings');
  await page.locator('.settings-sidebar [data-settings-nav="data"]').click();
  await page.locator('#localReadingLibrary').getByRole('button', { name: '刷新', exact: true }).click();
  const open = page.locator('[data-library-open-directory]').first(); await open.waitFor();
  await open.click(); await page.locator('[data-library-directory-status]').filter({ hasText: '已请求系统打开' }).waitFor();
  assert.equal(report.launches.length, 1); assert.equal(report.launches[0].relativePath, path.join('workspaces', workspace.directoryName));
  check('real library click traverses production background/directory/client/host and requests only exact workspace folder');
  await shot('open-request-confirmed');
  const manifestPath = path.join(diskRoot, 'workspaces', workspace.directoryName, 'manifest.json');
  const manifestBytes = fs.readFileSync(manifestPath), manifest = JSON.parse(manifestBytes);
  fs.writeFileSync(manifestPath, JSON.stringify({ ...manifest, workspaceGeneration: manifest.workspaceGeneration + 1 }));
  await open.click(); await page.locator('[data-library-directory-status]').filter({ hasText: '归属或版本' }).waitFor();
  assert.equal(report.launches.length, 1); check('native final manifest mismatch is shown by actual UI and never launches');
  await shot('native-identity-rejected'); fs.writeFileSync(manifestPath, manifestBytes);
  const before = report.nativeCalls.length;
  await worker.evaluate(async workspace => { await directorySync.enqueueJson(`workspaces/${workspace.directoryName}/annotations/synthetic-pending.json`, { schemaVersion: 1, revision: 1, pending: true }); }, workspace);
  await open.click(); await page.locator('[data-library-directory-status]').filter({ hasText: '尚未同步' }).waitFor();
  assert.equal(report.nativeCalls.length, before); assert.equal(report.launches.length, 1);
  check('current-workspace unsynced data rejected before any native dispatch');
  const popup = await context.newPage(); await popup.goto(`${origin}/action-popup.html`);
  const forbidden = await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'USER_DATA_DIRECTORY_NATIVE_STATUS' }));
  assert.equal(forbidden.error?.code, 'WORKSPACE_DIRECTORY_FORBIDDEN'); assert.equal(report.nativeCalls.length, before);
  check('actual non-options extension page is rejected before native access'); await popup.close();
  await page.evaluate(() => { const frame = document.createElement('iframe'); frame.src = chrome.runtime.getURL('options.html#page=storage'); frame.id='directory-test-child'; document.body.append(frame); });
  const frame = await (await page.locator('#directory-test-child').elementHandle()).contentFrame();
  await frame.waitForSelector('#nativeDirectorySettings');
  const child = await frame.evaluate(() => chrome.runtime.sendMessage({ type: 'USER_DATA_DIRECTORY_NATIVE_STATUS' }));
  assert.equal(child.error?.code, 'WORKSPACE_DIRECTORY_FORBIDDEN'); assert.equal(report.nativeCalls.length, before);
  check('actual options subframe rejected while top-level options was accepted');
  report.senders = await worker.evaluate(() => __directorySenders);
  const good = report.senders.filter(s => s.type === 'LOCAL_READING_LIBRARY_OPEN_DIRECTORY');
  assert.ok(good.every(s => JSON.stringify(s.keys) === JSON.stringify(['type','workspaceId']) && s.frameId === 0));
  assert.ok(report.nativeCalls.filter(c => c.type === 'workspace.directory.open').every(c => !c.keys.includes('absolutePath')));
  assert.equal(report.errors.length, 0); check('real sender/field boundaries, zero page errors and no arbitrary path in open payload', { topFrameId: good[0].frameId });
  report.status = 'PASS';
} catch (error) {
  report.error = String(error.stack || error); console.error(report.error);
  if (worker) report.diagnostics = await worker.evaluate(() => ({ senders: __directorySenders,
    connections: __directoryConnections, transportErrors: __directoryTransportErrors })).catch(() => null);
  if (page && !page.isClosed()) { report.visibleFailure = await statusText().catch(() => ''); await shot('failure').catch(() => {}); }
}
finally {
  clearInterval(pumpTimer); await pumpWork; await context?.close();
  for (const file of sourceFiles) report.endSourceHashes[file] = sha(fs.readFileSync(path.join(root, file)));
  if (JSON.stringify(report.sourceHashes) !== JSON.stringify(report.endSourceHashes)) { report.status = 'FAIL'; report.errors.push('Source changed during verification'); }
  assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir())); assert.match(path.basename(temporary), /^brevess-directory-integration-/u);
  fs.rmSync(temporary, { recursive: true, force: true });
  fs.writeFileSync(path.join(run, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`EVIDENCE ${run}`); process.exitCode = report.status === 'PASS' ? 0 : 1;
}
