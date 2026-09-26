const test = require('node:test');
const assert = require('node:assert/strict');

let policy;
try {
  policy = require('../core/pdf-save-policy.js');
} catch (_) {
  policy = {};
}

function fakeHandle(name = 'paper.pdf', sourceBytes = Uint8Array.of(1, 2, 3), options = {}) {
  const writes = [];
  let closed = 0;
  let aborted = 0;
  let diskBytes = Uint8Array.from(sourceBytes);
  return {
    name,
    writes,
    get closed() { return closed; },
    get aborted() { return aborted; },
    replace(bytes) { diskBytes = Uint8Array.from(bytes); },
    async getFile() {
      if (closed && options.failReadAfterClose) throw new Error('disk changed after close');
      const snapshot = diskBytes.slice();
      return { name, async arrayBuffer() { return snapshot.buffer; } };
    },
    async createWritable() {
      return {
        async write(bytes) {
          const written = Uint8Array.from(bytes);
          writes.push(written);
          diskBytes = options.corruptWrite ? Uint8Array.of(0) : written;
          if (options.failWrite) throw new Error('disk full');
        },
        async close() {
          closed += 1;
          if (typeof options.afterClose === 'function') options.afterClose();
        },
        async abort() { aborted += 1; }
      };
    }
  };
}

test('allows overwrite only for a matching retained local handle and confirmation', () => {
  assert.deepEqual(policy.pdfOverwriteDecision({ sourceKind: 'remote' }), {
    allowed: false, reason: 'remote_source'
  });
  assert.deepEqual(policy.pdfOverwriteDecision({ sourceKind: 'local' }), {
    allowed: false, reason: 'file_handle_required'
  });
  assert.equal(policy.pdfOverwriteDecision({
    sourceKind: 'local', hasFileHandle: true,
    openedHash: 'a', currentHash: 'b', confirmed: true
  }).reason, 'source_changed');
  assert.equal(policy.pdfOverwriteDecision({
    sourceKind: 'local', hasFileHandle: true,
    openedHash: 'a', currentHash: 'a', confirmed: false
  }).reason, 'confirmation_required');
  assert.equal(policy.pdfOverwriteDecision({
    sourceKind: 'local', hasFileHandle: true,
    openedHash: 'a', currentHash: 'a', confirmed: true
  }).allowed, true);
});

test('save-copy uses a picker handle, writes exact bytes, and verifies after close', async () => {
  const handle = fakeHandle('annotated.pdf');
  const calls = [];
  const bytes = Uint8Array.of(37, 80, 68, 70, 9);
  const result = await policy.saveAnnotatedPdfCopy({
    bytes,
    suggestedName: 'paper-annotated.pdf',
    fileHandle: handle,
    preflight: async written => { calls.push(['preflight', Array.from(written)]); return { ok: true }; },
    verify: async written => {
      calls.push(['verify', Array.from(written), handle.closed]);
      return { ok: true, verifiedIds: ['ann-1'] };
    },
    sha256: async written => `hash:${Array.from(written).join(',')}`
  });

  assert.deepEqual(Array.from(handle.writes[0]), Array.from(bytes));
  assert.equal(handle.closed, 1);
  assert.equal(calls[0][0], 'preflight');
  assert.deepEqual(calls[1], ['verify', Array.from(bytes), 1]);
  assert.deepEqual(result, {
    mode: 'copy', status: 'file_verified', fileName: 'annotated.pdf',
    actualHash: 'hash:37,80,68,70,9',
    verification: { ok: true, verifiedIds: ['ann-1'] }
  });
});

test('save-copy falls back to a bounded Blob URL download and always revokes it', async () => {
  const events = [];
  class FakeBlob {
    constructor(parts, options) { this.parts = parts; this.type = options.type; }
  }
  const result = await policy.saveAnnotatedPdfCopy({
    bytes: Uint8Array.of(1, 2, 3),
    suggestedName: 'paper.pdf',
    BlobCtor: FakeBlob,
    createObjectURL(blob) { events.push(['create', blob.type]); return 'blob:test'; },
    revokeObjectURL(url) { events.push(['revoke', url]); },
    triggerDownload(url, name) { events.push(['download', url, name]); },
    preflight: async () => ({ ok: true, verifiedIds: [] })
  });
  assert.deepEqual(events, [
    ['create', 'application/pdf'],
    ['download', 'blob:test', 'paper.pdf'],
    ['revoke', 'blob:test']
  ]);
  assert.equal(result.mode, 'download');
  assert.equal(result.status, 'export_verified_download_started');
  assert.equal('verification' in result, false);
});

test('picker acquisition invokes the browser API immediately and normalizes cancellation', async () => {
  let invoked = false;
  const pending = policy.acquireAnnotatedPdfSaveHandle({
    suggestedName: 'paper.pdf',
    showSaveFilePicker() { invoked = true; return Promise.resolve(fakeHandle()); }
  });
  assert.equal(invoked, true, 'the picker must be invoked in the click activation stack');
  assert.ok(await pending);
  const cancelled = Object.assign(new Error('cancelled'), { name: 'AbortError' });
  await assert.rejects(policy.acquireAnnotatedPdfSaveHandle({
    suggestedName: 'paper.pdf', showSaveFilePicker: () => Promise.reject(cancelled)
  }), error => error.code === 'save_cancelled');
});

test('copy target identity rejects the retained source and fails closed on comparison errors', async () => {
  const source = fakeHandle('source.pdf');
  const same = fakeHandle('source.pdf');
  same.isSameEntry = async candidate => candidate === source;
  await assert.rejects(policy.assertDistinctPdfCopyTarget(same, source),
    error => error.code === 'copy_target_is_source');

  const different = fakeHandle('copy.pdf');
  different.isSameEntry = async () => false;
  assert.equal(await policy.assertDistinctPdfCopyTarget(different, source), true);

  const unknown = fakeHandle('unknown.pdf');
  unknown.isSameEntry = async () => { throw new Error('identity unavailable'); };
  await assert.rejects(policy.assertDistinctPdfCopyTarget(unknown, source),
    error => error.code === 'copy_target_identity_failed');
  await assert.rejects(policy.assertDistinctPdfCopyTarget(fakeHandle(), source),
    error => error.code === 'copy_target_identity_failed');
});

test('write failure aborts best-effort and corrupt disk bytes fail actual reopen verification', async () => {
  const broken = fakeHandle('broken.pdf', Uint8Array.of(1), { failWrite: true });
  await assert.rejects(policy.saveAnnotatedPdfCopy({
    bytes: Uint8Array.of(1), suggestedName: 'paper.pdf',
    fileHandle: broken, preflight: async () => ({ ok: true }), verify: async () => ({ ok: true })
  }), error => error.code === 'write_failed' && error.cause?.message === 'disk full');
  assert.equal(broken.aborted, 1);

  const corrupt = fakeHandle('corrupt.pdf', Uint8Array.of(1), { corruptWrite: true });
  await assert.rejects(policy.saveAnnotatedPdfCopy({
    bytes: Uint8Array.of(9), suggestedName: 'paper.pdf', fileHandle: corrupt,
    preflight: async () => ({ ok: true }),
    verify: async actual => ({ ok: actual[0] === 9, missingIds: ['ann-1'] })
  }), error => error.code === 'verification_failed' && error.committed === true);
});

test('guarded overwrite rereads and hashes source before named confirmation and verification', async () => {
  const handle = fakeHandle('source-paper.pdf', Uint8Array.of(5, 6));
  const events = [];
  const result = await policy.overwriteAnnotatedPdf({
    bytes: Uint8Array.of(9, 8, 7),
    sourceKind: 'local',
    fileHandle: handle,
    openedHash: 'same',
    sha256: async bytes => { events.push(['hash', Array.from(bytes)]); return 'same'; },
    confirm: message => { events.push(['confirm', message]); return true; },
    preflight: async () => ({ ok: true }),
    verify: async bytes => { events.push(['verify', Array.from(bytes)]); return { ok: true }; }
  });
  assert.match(events[1][1], /source-paper\.pdf/);
  assert.deepEqual(events.map(item => item[0]),
    ['hash', 'confirm', 'hash', 'hash', 'verify', 'hash']);
  assert.equal(handle.closed, 1);
  assert.equal(result.mode, 'overwrite');
});

test('guarded overwrite rejects changed source before confirmation or write', async () => {
  const handle = fakeHandle('changed.pdf', Uint8Array.of(5, 6));
  let confirmations = 0;
  await assert.rejects(policy.overwriteAnnotatedPdf({
    bytes: Uint8Array.of(9), sourceKind: 'local', fileHandle: handle,
    openedHash: 'opened', sha256: async () => 'changed',
    confirm: () => { confirmations += 1; return true; },
    preflight: async () => ({ ok: true }), verify: async () => ({ ok: true })
  }), error => error.code === 'source_changed');
  assert.equal(confirmations, 0);
  assert.equal(handle.writes.length, 0);
});

test('overwrite closes the confirmation TOCTOU window with a second source hash', async () => {
  const handle = fakeHandle('changed-after-confirm.pdf', Uint8Array.of(1));
  let hashCalls = 0;
  await assert.rejects(policy.overwriteAnnotatedPdf({
    bytes: Uint8Array.of(9), sourceKind: 'local', fileHandle: handle,
    openedHash: 'original', preflight: async () => ({ ok: true }),
    sha256: async () => (++hashCalls === 1 ? 'original' : 'changed'),
    confirm: () => true, verify: async () => ({ ok: true })
  }), error => error.code === 'source_changed');
  assert.equal(handle.writes.length, 0);
});

test('actual written hash supports two consecutive guarded overwrites', async () => {
  const handle = fakeHandle('repeat.pdf', Uint8Array.of(1));
  const hash = bytes => Promise.resolve(`h${Array.from(bytes).join('')}`);
  const common = {
    sourceKind: 'local', fileHandle: handle, sha256: hash,
    preflight: async () => ({ ok: true }), confirm: () => true,
    verify: async () => ({ ok: true })
  };
  const first = await policy.overwriteAnnotatedPdf({
    ...common, bytes: Uint8Array.of(2), openedHash: 'h1'
  });
  const second = await policy.overwriteAnnotatedPdf({
    ...common, bytes: Uint8Array.of(3), openedHash: first.actualHash
  });
  assert.equal(first.actualHash, 'h2');
  assert.equal(second.actualHash, 'h3');
  assert.equal(handle.writes.length, 2);
});

test('operation checkpoint cancels a pending save before it writes', async () => {
  const handle = fakeHandle();
  let current = true;
  await assert.rejects(policy.saveAnnotatedPdfCopy({
    bytes: Uint8Array.of(9), fileHandle: handle,
    preflight: async () => { current = false; return { ok: true }; },
    assertCurrent: () => current,
    verify: async () => ({ ok: true })
  }), error => error.code === 'save_context_changed');
  assert.equal(handle.writes.length, 0);
});

test('a context change after close reports a verified committed snapshot instead of cancellation', async () => {
  let current = true;
  const handle = fakeHandle('committed.pdf', Uint8Array.of(1), {
    afterClose() { current = false; }
  });
  const result = await policy.saveAnnotatedPdfCopy({
    bytes: Uint8Array.of(9), fileHandle: handle,
    preflight: async () => ({ ok: true }),
    verify: async actual => ({ ok: actual[0] === 9, verifiedIds: ['snapshot'] }),
    sha256: async bytes => `h${Array.from(bytes).join('')}`,
    assertCurrent: () => current
  });
  assert.equal(handle.closed, 1);
  assert.equal(result.status, 'verified_snapshot_saved_context_changed');
  assert.deepEqual(result.verification.verifiedIds, ['snapshot']);
});

test('a post-close disk read failure is marked committed for truthful UI reporting', async () => {
  const handle = fakeHandle('changed-on-disk.pdf', Uint8Array.of(1), {
    failReadAfterClose: true
  });
  await assert.rejects(policy.saveAnnotatedPdfCopy({
    bytes: Uint8Array.of(9), fileHandle: handle,
    preflight: async () => ({ ok: true }), verify: async () => ({ ok: true })
  }), error => error.code === 'source_changed' && error.committed === true);
  assert.equal(handle.closed, 1);
});
