const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const reader = fs.readFileSync(path.join(__dirname, '../pdf-reader.js'), 'utf8');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

function harness(options = {}) {
  const bytes = new Uint8Array(Buffer.from('%PDF-1.7\nopened authenticated document\n'));
  const state = { runId: 4, localFile: options.file || null,
    nativePdfBytesPromise: options.promise || Promise.resolve(bytes) };
  const context = vm.createContext({ state, Blob, File, DOMException, Uint8Array,
    workspaceSourceUrl: () => 'https://publisher.example/session-paper.pdf',
    fileNameForSource: () => 'session-paper.pdf',
    canRelayBrowserSessionSource: () => options.relay === true,
    sha256PdfBytes: async value => digest(value),
    SciLLM: { PDF_FIGURE_MAX_BYTES: 200 * 1024 * 1024 },
    __brevessNativePdfDocument: { structure: { documentHash: options.hash || digest(bytes) }, documentGeneration: 7 }
  });
  const start = reader.indexOf('  function capturePdfParseSource(');
  const end = reader.indexOf('  async function uploadLocalFile(', start);
  vm.runInContext(reader.slice(start, end) + '\nglobalThis.capture = capturePdfUploadSource;', context);
  return { state, context, bytes, capture: context.capture };
}

test('remote enhancement uploads exact opened bytes without publisher refetch or credential transfer', async () => {
  const h = harness();
  const source = await h.capture(4);
  assert.ok(source.file instanceof File);
  assert.equal(source.file.name, 'session-paper.pdf');
  assert.deepEqual(new Uint8Array(await source.file.arrayBuffer()), h.bytes);
  assert.equal(source.documentHash, digest(h.bytes));
  assert.equal(h.state.localFile, null, 'capture must not change the live source ownership');
  assert.equal(source.headers, undefined);
  source.assertCurrent();
});

test('changed document generation rejects an outstanding source capture', async () => {
  let resolve;
  const h = harness({ promise: new Promise(r => { resolve = r; }) });
  const pending = h.capture(4);
  h.context.__brevessNativePdfDocument.documentGeneration = 8;
  resolve(h.bytes);
  await assert.rejects(pending, { name: 'AbortError' });
});

test('same URL but different opened bytes is rejected before any upload', async () => {
  const h = harness({ hash: 'a'.repeat(64) });
  await assert.rejects(h.capture(4), /PDF_UPLOAD_SOURCE_HASH_MISMATCH/);
});

test('remote enhancement never falls back to sending its URL when original bytes are unavailable', async () => {
  const h = harness(); h.state.nativePdfBytesPromise = null;
  await assert.rejects(h.capture(4), /PDF_UPLOAD_ORIGINAL_NOT_READY/);
});

test('cancel after capture invalidates the source before the signed upload', async () => {
  const h = harness(); const source = await h.capture(4);
  h.state.runId += 1;
  assert.throws(() => source.assertCurrent(), { name: 'AbortError' });
});

test('local uploads and explicit supplemental relay preserve their existing source contracts', async () => {
  const file = new File(['%PDF-local'], 'local.pdf', { type: 'application/pdf' });
  const local = harness({ file });
  assert.equal((await local.capture(4)).file, file);
  const relay = harness({ relay: true }); relay.state.nativePdfBytesPromise = null;
  assert.equal((await relay.capture(4)).file, null);
});

test('agent and precise production paths use the captured file rather than the mutable state file', async () => {
  for (const name of ['parseWithAgent', 'parseWithPrecise']) {
    const start = reader.indexOf(`  async function ${name}(`);
    const end = reader.indexOf('\n  async function ', start + 1);
    const implementation = reader.slice(start, end);
    assert.match(implementation, /await capturePdfUploadSource\(runId\)/);
    assert.match(implementation, /if \(source\.file instanceof Blob \|\| canRelayBrowserSessionSource\(\)\)/);
  }
});
