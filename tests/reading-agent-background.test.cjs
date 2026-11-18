const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function service({ routerError = false, pendingCount = 0 } = {}) {
  let dependencies;
  const messages = [];
  const context = {
    BrevessReadingAgent: { createReadingJobController(input) { dependencies = input; return {}; } }
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../extension/core/reading-agent-background.js'), 'utf8'), context);
  context.BrevessReadingAgent.installReadingAgentBackground({
    browser: { runtime: { onMessage: { addListener() {} } }, tabs: {
      async sendMessage() { return { success: true, workspace: { workspaceId: 'paper', workspaceGeneration: 1, directoryName: 'Paper--hash' },
        assetCount: 9, turnCount: 2, warnings: [], offlineSnapshot: { complete: true } }; }
    } },
    authorize: async () => {}, ensureContent: async () => {}, keepAlive: p => p,
    directory: { status: async () => ({ permission: 'granted', directoryName: 'Brevess' }) },
    router: { async handle(message) {
      messages.push(message.type);
      return routerError ? { success: false, error: { code: 'DISK_TEST_ERROR', message: 'Disk rejected the write' } }
        : { success: true, data: { permission: 'granted', pendingCount, failed: 0, conflicts: 0, queued: 9 } };
    } }
  });
  return { dependencies, messages };
}

test('save consumes the router envelope and returns an actual drained directory receipt', async () => {
  const { dependencies, messages } = service();
  const saved = await dependencies.save({ tabId: 1 }, 'operation');
  assert.equal(saved.complete, true);
  assert.equal(saved.relativePath, 'workspaces/Paper--hash');
  assert.equal(saved.assetCount, 9);
  assert.deepEqual(messages, ['ARTICLE_WORKSPACE_MIRROR_ALL', 'USER_DATA_SYNC_NOW']);
});
test('router and pending-write failures cannot be reported as successful local saves', async () => {
  await assert.rejects(service({ routerError: true }).dependencies.save({ tabId: 1 }, 'operation'), { code: 'DISK_TEST_ERROR' });
  await assert.rejects(service({ pendingCount: 1 }).dependencies.save({ tabId: 1 }, 'operation'), { code: 'READING_DIRECTORY_SYNC_INCOMPLETE' });
});

test('authorized same-origin WOFF2 aliases are accepted only with the font byte signature', async () => {
  const source = fs.readFileSync(require.resolve('../extension/content.js'), 'utf8');
  const start = source.indexOf('async function fetchOfflineArticleSnapshotResource(');
  const end = source.indexOf('async function persistOfflineArticleSnapshot(', start);
  let bytes = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 1, 2]);
  const context = { URL, Uint8Array, TextDecoder, fetch: async () => new Response(bytes, {
    headers: { 'content-type': 'application/font-woff2; charset="UTF-8"' }
  }), encodeSnapshotImageDataUrl: (_, mime) => 'data:' + mime + ';base64,d09GMgEC' };
  vm.runInNewContext(source.slice(start, end) + '; globalThis.run = fetchOfflineArticleSnapshotResource;', context);
  const request = { kind: 'font', url: 'https://journal.test/font.woff2' };
  const operation = { binding: { url: 'https://journal.test/paper' } };
  assert.equal((await context.run(request, operation, () => {})).contentType, 'font/woff2');
  bytes = new Uint8Array([60, 104, 116, 109, 108]);
  await assert.rejects(context.run(request, operation, () => {}), { code: 'OFFLINE_RESOURCE_TYPE' });
});

test('offline save improves a partial snapshot without replacing a better copy', () => {
  const { shouldReplaceOfflineSnapshot: replace } = require('../extension/core/faithful-page-snapshot.js');
  const missing = { kind: 'font', url: 'https://journal.test/font.woff2', reason: 'type' };
  const previous = { complete: false, documentHash: 'same', missingResources: [missing], warnings: ['layout'], embeddedImages: 4, embeddedFonts: 1 };
  const html = data => '<meta name="brevess-offline-snapshot" content="' + encodeURIComponent(JSON.stringify(data)) + '">';
  const improved = { ...previous, missingResources: [], embeddedFonts: 2 };
  assert.equal(replace(html(previous), improved), true);
  assert.equal(replace(html({ ...previous, complete: true }), improved), false);
  assert.equal(replace(html(previous), { ...previous, embeddedImages: 3 }), false);
  assert.equal(replace(html(previous), { ...improved, embeddedImages: 3 }), true);
  assert.equal(replace(html(previous), { ...improved, missingResources: [{ ...missing, url: 'another' }] }), false);
  assert.equal(replace(html(previous), { ...improved, documentHash: 'changed' }), false);
});
