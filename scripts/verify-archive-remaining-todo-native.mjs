// Bounded ARCH009 reachability probe. Production files and existing tests are read-only.
// Run: node scripts/verify-archive-remaining-todo-native.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const expectFixed = process.argv.includes('--expect-fixed');
const outputRoot = path.join(root, 'output/playwright/arch009-remaining-todo');
fs.mkdirSync(outputRoot, { recursive: true });
const out = fs.mkdtempSync(path.join(outputRoot, 'run-'));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-arch009-native-queue-'));
const extension = path.join(temporary, 'extension');
const sourceFiles = ['background.js', 'core/user-data-database.js', 'core/document-store.js',
  'core/article-workspace.js', 'core/article-workspace-store.js', 'core/article-archive.js',
  'core/background-router.js', 'core/directory-sync.js', 'tests/archive-document-final-review.test.js'];
const sha = value => createHash('sha256').update(value).digest('hex');
const report = { startedAt: new Date().toISOString(), scope: 'native IndexedDB / real syncQueue / isolated OPFS, synthetic data only',
  expectFixed,
  methodology: 'One native readwrite syncQueue transaction is deliberately kept active by native get requests. IDB transaction/put wrappers observe and return the original native values without delaying or replacing business results.',
  out, temporary, sourceHashes: Object.fromEntries(sourceFiles.map(file => [file, sha(fs.readFileSync(path.join(root, file)))])), checks: [], pageErrors: [] };
let context, worker;
const check = (name, actual, expected) => { assert.deepEqual(actual, expected, name); report.checks.push(name); };
const timeout = setTimeout(() => { report.timeout = true; fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); process.exit(2); }, 90000);
try {
  fs.mkdirSync(extension);
  for (const directory of ['core', 'providers', 'vendor', 'icons', '_locales'])
    fs.cpSync(path.join(root, directory), path.join(extension, directory), { recursive: true });
  for (const file of fs.readdirSync(root)) if (/\.(?:js|mjs|html|css)$/u.test(file) || file === 'manifest.json')
    fs.copyFileSync(path.join(root, file), path.join(extension, file));
  report.copiedSourceHashes = Object.fromEntries(sourceFiles.filter(file => !file.startsWith('tests/')).map(file => [file, sha(fs.readFileSync(path.join(extension, file)))]));
  context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), {
    channel: 'msedge', headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost', '--disable-background-networking']
  });
  await context.route(/^https?:\/\//u, route => route.abort('blockedbyclient'));
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  report.browserVersion = context.browser()?.version() || 'persistent-context';
  if (expectFixed) {
    report.methodology = 'Three real native DB/queue/OPFS cases. Queue contention is released on a timer without awaiting commit. In-flight case delays delivery of the real native write promise after native write completes; close still executes natively. Explicit I/O boundary latch, not a natural-frequency claim.';
    report.runtime = await runFixedCases(worker);
    for (const scenario of report.runtime.cases) {
      check(scenario.name + ': restore durable', scenario.commit?.data?.persistenceCommitted, true);
      check(scenario.name + ': restored primary document', scenario.document.annotations.length, 1);
      check(scenario.name + ': restored modern highlights', scenario.highlights.content.annotations.length, 1);
      check(scenario.name + ': queue drained', scenario.pending.length, 0);
      check(scenario.name + ': no stale native file close after prepared durable transaction', scenario.lateOldCloses.length, 0);
    }
    const waiting = report.runtime.cases.find(item => item.name === 'waiting-enqueue');
    check('Waiting enqueue: actual old transaction was observed before release', waiting.queueSubmitted, true);
    const prequeued = report.runtime.cases.find(item => item.name === 'prequeued-new-instance');
    check('Prequeued: new queue instance observes identical persisted old row', prequeued.samePersistedQueueRow, true);
    check('Prequeued: old legacy payload never written after restore', prequeued.oldCloses.length, 0);
    check('Prequeued: complete old payload preserved in real conflict file', prequeued.conflictCopies.some(copy =>
      copy.value.documentId === prequeued.identity.documentId && copy.value.documentRecord.annotations.length === 0), true);
    const inflight = report.runtime.cases.find(item => item.name === 'inflight-native-write');
    check('In-flight: real native write reached explicit I/O delivery latch', inflight.ioLatchReached, true);
    check('In-flight: no durable restore while old write still awaits close', inflight.committedWhileLatched, false);
    check('In-flight: native old close really completes before restore transaction', inflight.oldCloses.length > 0 && inflight.oldCloses.every(event => event.seq < inflight.commitEvent.seq), true);
    check('In-flight: competing save settles without lock/tail deadlock', Boolean(inflight.competingSave.success ||
      inflight.competingSave.error?.code === 'ARTICLE_ARCHIVE_DOCUMENT_CONFLICT'), true);
    check('Real postrestore edit saves to native directory', report.runtime.controls.editedDisk.value.documentRecord.annotations[0].note, 'Real later edit');
    check('Real explicit clear saves to native directory', report.runtime.controls.clearedDisk.value.documentRecord.annotations.length, 0);
    check('Former annotated snapshot is rejected after clear', report.runtime.controls.staleAfterClear.error?.code, 'ARTICLE_ARCHIVE_DOCUMENT_CONFLICT');
    // Reopen the identical isolated profile/extension and retained native stores. No fixture rebuild.
    await context.close();
    context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), {
      channel: 'msedge', headless: true,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
        '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost', '--disable-background-networking']
    });
    await context.route(/^https?:\/\//u, route => route.abort('blockedbyclient'));
    worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    report.restart = await worker.evaluate(async cases => {
      const documents = SciLLM.createIndexedDbDocumentStore(indexedDB);
      const queue = SciLLM.createIndexedDbSyncQueue(indexedDB);
      const directory = SciLLM.createDirectorySync({ handleStore: SciLLM.createIndexedDbDirectoryHandleStore(indexedDB), queueStore: queue });
      const before = await queue.getAll();
      const rows = [];
      for (const item of cases) rows.push({ name: item.name, identity: item.identity,
        document: await documents.getDocument(item.identity.documentId), disk: await directory.readJson(item.archivePath) });
      const flush = await directory.flush();
      return { before, rows, flush, after: await queue.getAll() };
    }, report.runtime.cases.map(({ name, identity, archivePath }) => ({ name, identity, archivePath })));
    check('Restart: no invalidated old queue item resurrects', report.restart.before.length, 0);
    check('Restart: same native restored documents remain (clear control retained)', report.restart.rows.map(row => row.document.annotations.length), [0, 1, 1]);
    check('Restart: genuine directory flush succeeds', report.restart.flush.failed, 0);
    report.conclusion = 'Three native scheduling boundaries and production edit/clear controls passed; same-profile restart retained durable state. Original red evidence remains unchanged.';
  } else {
  report.runtime = await worker.evaluate(async () => {
    const events = [], emit = (kind, details = {}) => events.push({ seq: events.length + 1, kind, at: performance.now(), ...details });
    globalThis.__nativeTodoDiagnostics = { events };
    const fail = (message, extra) => { throw new Error(message + (extra ? ': ' + JSON.stringify(extra) : '')); };
    const must = (condition, message, extra) => { if (!condition) fail(message, extra); };
    const request = value => new Promise((resolve, reject) => {
      value.addEventListener('success', () => resolve(value.result));
      value.addEventListener('error', () => reject(value.error));
    });
    const bound = (promise, label) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(Error(label + ' timeout')), 15000))]);
    // Unchanged production constructors, genuine native DB/queue and OPFS handle.
    const documents = SciLLM.createIndexedDbDocumentStore(indexedDB);
    const workspaces = SciLLM.createIndexedDbArticleWorkspaceStore(indexedDB);
    const handles = SciLLM.createIndexedDbDirectoryHandleStore(indexedDB);
    const queue = SciLLM.createIndexedDbSyncQueue(indexedDB);
    const directory = SciLLM.createDirectorySync({ handleStore: handles, queueStore: queue, sourceId: 'native-todo-fixture' });
    const handle = await (await navigator.storage.getDirectory()).getDirectoryHandle('synthetic-native-queue-fixture', { create: true });
    await handles.save(handle);
    const router = SciLLM.createBackgroundRouter({ storageArea: chrome.storage.local,
      documentStore: documents, articleWorkspaceStore: workspaces, directorySync: directory,
      fetchImpl: async () => { throw Error('OFFLINE_PROBE_NO_MODEL'); } });
    const documentId = 'sha256:' + 'd'.repeat(64);
    const identity = { ...await SciLLM.createArticleWorkspaceIdentity({ canonicalUrl: 'https://example.invalid/arch009-native-queue',
      title: 'Synthetic native queue reachability', contentHash: '2'.repeat(64) }), documentId, documentHash: '2'.repeat(64), workspaceGeneration: 1 };
    const annotation = { annotationId: 'synthetic-restored-1', categoryId: 'result',
      categorySnapshot: { name: 'Result', color: '#FFE66D' }, quote: 'Scientific quote 1',
      prefix: '', suffix: '', sectionTitle: 'Results', blockFingerprint: 'synthetic-block',
      startOffset: 0, endOffset: 18, note: 'Synthetic restored note' };
    const workspace = await workspaces.ensureWorkspace(identity);
    await directory.enqueueWorkspaceAsset(workspace, 'annotations/highlights.json', { annotations: [annotation] }, { revision: 40 });
    const fixtureFlush = await directory.flush();
    must(fixtureFlush.permission === 'granted' && fixtureFlush.failed === 0, 'fixture real flush failed', fixtureFlush);
    must(await documents.getDocument(documentId) === null, 'fixture document must initially be absent');
    const scanned = await router.handle({ type: 'ARTICLE_WORKSPACE_SCAN_RESTORE', identity, operationNonce: 'native-todo-proof' });
    must(scanned.success && scanned.data?.restore?.restorePlanId, 'real scan failed', scanned);
    const oldArchive = SciLLM.createArticleArchive({ identity, documentRecord: { documentId,
      canonicalUrl: identity.canonicalUrl, documentHash: identity.documentHash, annotations: [] }, workspace: {}, revision: 1 });
    const archivePath = SciLLM.articleArchiveRelativePath(oldArchive);
    emit('fixture-ready', { archivePath });

    // Only the queue store is locked. No getter, router, store method or payload is replaced.
    const database = await request(indexedDB.open('sci-logic-highlighter-user-data', 4));
    const lock = database.transaction(['syncQueue'], 'readwrite');
    const lockDone = new Promise((resolve, reject) => { lock.oncomplete = resolve; lock.onerror = () => reject(lock.error); lock.onabort = () => reject(lock.error); });
    let release = false, requests = 0;
    const started = performance.now();
    let lockReadyResolve;
    const lockReady = new Promise(resolve => { lockReadyResolve = resolve; });
    const keepActive = () => {
      const current = lock.objectStore('syncQueue').get('__synthetic_probe_lock_nonexistent__');
      current.onsuccess = () => { requests++; lockReadyResolve();
        if (!release && performance.now() - started < 12000) keepActive(); };
    };
    keepActive(); await lockReady; emit('queue-lock-active');

    const nativeTransaction = IDBDatabase.prototype.transaction;
    const nativePut = IDBObjectStore.prototype.put;
    let queueSubmittedResolve;
    const queueSubmitted = new Promise(resolve => { queueSubmittedResolve = resolve; });
    // Transparent observations only; all returned transactions and requests are native originals.
    IDBDatabase.prototype.transaction = function (...args) {
      const tx = Reflect.apply(nativeTransaction, this, args);
      const stores = [...tx.objectStoreNames].sort();
      const mode = tx.mode;
      emit('transaction-created', { stores, mode });
      tx.addEventListener('complete', () => emit('transaction-complete', { stores, mode }));
      if (mode === 'readwrite' && stores.length === 1 && stores[0] === 'syncQueue') queueSubmittedResolve();
      return tx;
    };
    IDBObjectStore.prototype.put = function (...args) {
      const nativeRequest = Reflect.apply(nativePut, this, args);
      if (this.name === 'syncQueue' && args[0]?.relativePath === archivePath) {
        const row = args[0];
        emit('old-archive-queue-put-request', { queueRevision: row.queueRevision,
          annotationCount: JSON.parse(row.content).documentRecord.annotations.length });
        nativeRequest.addEventListener('success', () => emit('old-archive-queue-put-success'));
      }
      return nativeRequest;
    };
    let saveSettled = false;
    let saving, committing, committedRowBeforeRelease;
    try {
      saving = router.handle({ type: 'ARTICLE_ARCHIVE_SAVE', archive: oldArchive }).then(result => {
        saveSettled = true; emit('archive-save-response', { result }); return result;
      });
      await bound(queueSubmitted, 'real queue transaction submission');
      emit('real-archive-queue-transaction-submitted');
      const restore = scanned.data.restore;
      committing = router.handle({ type: 'ARTICLE_WORKSPACE_COMMIT_PREPARED_RESTORE',
        planId: restore.restorePlanId, binding: { kind: 'workspace', current: identity, documentId,
          manifest: restore.manifest, match: restore.match, operationNonce: 'native-todo-proof' } },
      { trustedContentScript: true, senderTabId: 9, senderFrameId: 0,
        senderDocumentId: 'synthetic-browser-document', senderUrl: identity.canonicalUrl,
        assertTrustedOwnerCurrent: async () => {} }).then(result => {
          emit('prepared-commit-response-observed', { result }); return result;
        });
      // Actual native row observation, without changing or delaying a business getter.
      committedRowBeforeRelease = await bound((async () => {
        for (;;) {
          const row = await documents.getDocument(documentId);
          if (row?.annotations?.length === 1) return row;
          await new Promise(resolve => setTimeout(resolve, 5));
        }
      })(), 'five-store native commit while queue lock active');
      emit('restored-document-observed-before-queue-release', { annotationCount: committedRowBeforeRelease.annotations.length, saveSettled });
      must(!saveSettled, 'save unexpectedly settled before native queue lock release');
      release = true; await bound(lockDone, 'queue lock release'); emit('queue-lock-complete');
      const save = await bound(saving, 'save'), commit = await bound(committing, 'commit');
      emit('prepared-commit-response', { result: commit });
      must(commit.success && commit.data.persistenceCommitted, 'prepared commit failed', commit);
      const flushes = [];
      for (let index = 0; index < 4; index++) {
        flushes.push(await directory.flush());
        if ((await queue.getAll()).length === 0) break;
      }
      const disk = await directory.readJson(archivePath);
      const finalDocument = await documents.getDocument(documentId);
      const finalHighlights = await workspaces.getAsset(identity.workspaceId, 'annotations/highlights.json');
      const diskHighlights = await directory.readWorkspaceAsset(restore.manifest, 'annotations/highlights.json');
      // Countercheck: once the commit is already visible, production rejects the same stale archive.
      const postCommitSave = await router.handle({ type: 'ARTICLE_ARCHIVE_SAVE', archive: oldArchive });
      return { identity, fixtureFlush, scan: scanned, archivePath, save, commit,
        committedRowBeforeRelease, finalDocument, finalHighlights, diskHighlights, disk,
        postCommitSave, flushes, pending: await queue.getAll(), lockRequests: requests,
        lockDurationMs: performance.now() - started, events,
        boundary: 'Native store/queue contention. Authorization context is synthetic; no browser user action or natural-frequency claim.' };
    } finally {
      release = true;
      IDBDatabase.prototype.transaction = nativeTransaction;
      IDBObjectStore.prototype.put = nativePut;
      await lockDone.catch(() => {}); database.close();
    }
  });
  const r = report.runtime;
  check('Prepared restore commits through actual five-store IndexedDB transaction', r.commit.data.persistenceCommitted, true);
  check('Restored annotation is native-durable before queue lock release', r.committedRowBeforeRelease.annotations.length, 1);
  check('Precommit archive still reports successful enqueue', r.save.success && r.save.data.queued, true);
  check('Real directory flush writes stale empty legacy archive', r.disk.found && r.disk.value.documentRecord.annotations.length, 0);
  check('Authoritative documents retain the restored annotation', r.finalDocument.annotations.length, 1);
  check('Authoritative workspace highlights retain the restored annotation', r.finalHighlights.content.annotations.length, 1);
  check('Modern directory highlights retain the restored annotation', r.diskHighlights.value.data.annotations.length, 1);
  check('Same stale save initiated after commit is rejected', r.postCommitSave.error?.code, 'ARTICLE_ARCHIVE_DOCUMENT_CONFLICT');
  check('Actual queue drains successfully', r.pending.length, 0);
  const observed = r.events.find(item => item.kind === 'restored-document-observed-before-queue-release');
  const put = r.events.find(item => item.kind === 'old-archive-queue-put-request');
  check('Actual old queue put request occurs after restored row is observed', Boolean(put && observed && put.seq > observed.seq), true);
  report.conclusion = 'Confirmed stale precommit archive can persist to native syncQueue and isolated OPFS after prepared document commit. Getter-delivery TODO ordering itself was not simulated or proved.';
  }
} catch (error) {
  report.error = { name: error.name, message: error.message, stack: error.stack };
  report.runtimeFailure = await worker?.evaluate(() => globalThis.__nativeTodoDiagnostics).catch(() => null);
  process.exitCode = 1;
} finally {
  await context?.close().catch(error => { report.closeError = String(error); });
  clearTimeout(timeout);
  report.sourceHashesAfter = Object.fromEntries(sourceFiles.map(file => [file, sha(fs.readFileSync(path.join(root, file)))]));
  report.sourcesUnchanged = JSON.stringify(report.sourceHashes) === JSON.stringify(report.sourceHashesAfter);
  report.finishedAt = new Date().toISOString();
  fs.copyFileSync(import.meta.filename, path.join(out, path.basename(import.meta.filename)));
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ out, checks: report.checks.length, sourcesUnchanged: report.sourcesUnchanged,
    conclusion: report.conclusion, error: report.error?.message }, null, 2));
}

async function runFixedCases(target) {
  return target.evaluate(async () => {
    const events = [], cases = [];
    let phase = 'setup', latch = null;
    const emit = (kind, details = {}) => {
      const event = { seq: events.length + 1, at: performance.now(), phase, kind, ...details };
      events.push(event); return event;
    };
    globalThis.__nativeTodoDiagnostics = { events, cases };
    const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
    const bound = (promise, label) => Promise.race([promise, delay(15000).then(() => { throw Error(label + ' timeout'); })]);
    const must = (condition, label, value) => { if (!condition) throw Error(label + ': ' + JSON.stringify(value)); };
    const request = native => new Promise((resolve, reject) => {
      native.addEventListener('success', () => resolve(native.result)); native.addEventListener('error', () => reject(native.error));
    });
    const documents = SciLLM.createIndexedDbDocumentStore(indexedDB);
    const workspaces = SciLLM.createIndexedDbArticleWorkspaceStore(indexedDB);
    const handles = SciLLM.createIndexedDbDirectoryHandleStore(indexedDB);
    await handles.save(await (await navigator.storage.getDirectory()).getDirectoryHandle('synthetic-native-fixed-fixture', { create: true }));
    const queue = SciLLM.createIndexedDbSyncQueue(indexedDB);
    const directory = SciLLM.createDirectorySync({ handleStore: handles, queueStore: queue, sourceId: 'native-fixed-fixture' });
    const router = SciLLM.createBackgroundRouter({ storageArea: chrome.storage.local, documentStore: documents,
      articleWorkspaceStore: workspaces, directorySync: directory, fetchImpl: async () => { throw Error('OFFLINE_NO_MODEL'); } });
    const nativeTransaction = IDBDatabase.prototype.transaction;
    const nativePut = IDBObjectStore.prototype.put;
    const nativeCreateWritable = FileSystemFileHandle.prototype.createWritable;
    const nativeWrite = FileSystemWritableFileStream.prototype.write;
    const nativeClose = FileSystemWritableFileStream.prototype.close;
    const streamNames = new WeakMap(), queueWaiters = new Set();
    IDBDatabase.prototype.transaction = function (...args) {
      const tx = Reflect.apply(nativeTransaction, this, args);
      const stores = [...tx.objectStoreNames].sort(), mode = tx.mode, currentPhase = phase;
      emit('transaction-created', { stores, mode });
      tx.addEventListener('complete', () => {
        const previous = phase; phase = currentPhase;
        emit(stores.includes('documents') && stores.includes('workspaceAssets') && mode === 'readwrite'
          ? 'prepared-durable-transaction-complete' : 'transaction-complete', { stores, mode });
        phase = previous;
      });
      if (stores.includes('syncQueue') && mode === 'readwrite') for (const waiter of queueWaiters) waiter.resolve();
      return tx;
    };
    IDBObjectStore.prototype.put = function (...args) {
      const native = Reflect.apply(nativePut, this, args);
      if (this.name === 'syncQueue' && args[0]?.relativePath?.startsWith('articles/')) {
        emit('article-queue-put', { relativePath: args[0].relativePath, queueRevision: args[0].queueRevision,
          annotationCount: JSON.parse(args[0].content).documentRecord.annotations.length });
      }
      return native;
    };
    FileSystemFileHandle.prototype.createWritable = function (...args) {
      const native = Reflect.apply(nativeCreateWritable, this, args), filename = this.name;
      // Tracking returns the very same native stream after the native open completes.
      return native.then(stream => { streamNames.set(stream, filename); return stream; });
    };
    FileSystemWritableFileStream.prototype.write = function (...args) {
      const filename = streamNames.get(this), native = Reflect.apply(nativeWrite, this, args);
      let archive;
      try { const parsed = JSON.parse(String(args[0])); if (parsed?.kind === 'sci-logic-highlighter-article') archive = parsed; } catch (_) {}
      if (archive) emit('native-article-write-start', { filename, annotationCount: archive.documentRecord.annotations.length });
      return native.then(async value => {
        if (archive) emit('native-article-write-complete', { filename, annotationCount: archive.documentRecord.annotations.length });
        if (latch && !latch.fired && filename === latch.filename && archive) {
          latch.fired = true; emit('explicit-io-delivery-latch-reached', { filename }); latch.reached.resolve();
          await latch.release.promise;
          emit('explicit-io-delivery-latch-released', { filename });
        }
        return value;
      });
    };
    FileSystemWritableFileStream.prototype.close = function (...args) {
      const filename = streamNames.get(this), native = Reflect.apply(nativeClose, this, args), currentPhase = phase;
      native.then(() => { const previous = phase; phase = currentPhase; emit('native-file-close-complete', { filename }); phase = previous; }, () => {});
      return native;
    };
    async function fixture(name, ordinal) {
      phase = name;
      const documentId = 'sha256:' + String(ordinal).repeat(64);
      const identity = { ...await SciLLM.createArticleWorkspaceIdentity({ canonicalUrl: 'https://example.invalid/arch009-fixed-' + name,
        title: 'Synthetic ' + name, contentHash: 'a'.repeat(64) }), documentId, documentHash: 'a'.repeat(64), workspaceGeneration: 1 };
      const quote = 'Scientific quote ' + ordinal;
      const annotation = { annotationId: 'annotation-' + ordinal, categoryId: 'result', categorySnapshot: { name: 'Result', color: '#FFE66D' },
        quote, prefix: '', suffix: '', sectionTitle: 'Results', blockFingerprint: 'synthetic-' + ordinal,
        startOffset: 0, endOffset: quote.length, note: 'Restored note ' + ordinal };
      const workspace = await workspaces.ensureWorkspace(identity);
      await directory.enqueueWorkspaceAsset(workspace, 'annotations/highlights.json', { annotations: [annotation] }, { revision: 40 });
      await directory.flush();
      const scan = await router.handle({ type: 'ARTICLE_WORKSPACE_SCAN_RESTORE', identity, operationNonce: 'native-fixed-' + name });
      must(scan.success && scan.data?.restore?.restorePlanId, 'scan', scan);
      const old = SciLLM.createArticleArchive({ identity, documentRecord: { documentId, canonicalUrl: identity.canonicalUrl,
        documentHash: identity.documentHash, annotations: [] }, workspace: {}, revision: 1 });
      const archivePath = SciLLM.articleArchiveRelativePath(old);
      const commit = () => {
        const restore = scan.data.restore;
        return router.handle({ type: 'ARTICLE_WORKSPACE_COMMIT_PREPARED_RESTORE', planId: restore.restorePlanId,
          binding: { kind: 'workspace', current: identity, documentId, manifest: restore.manifest,
            match: restore.match, operationNonce: 'native-fixed-' + name } },
        { trustedContentScript: true, senderTabId: 9, senderFrameId: 0, senderDocumentId: 'synthetic-browser-' + name,
          senderUrl: identity.canonicalUrl, assertTrustedOwnerCurrent: async () => {} }).then(result => {
            emit('prepared-response', { result }); return result;
          });
      };
      return { name, identity, annotation, old, archivePath, commit };
    }
    async function holdQueue() {
      const db = await request(indexedDB.open('sci-logic-highlighter-user-data', 4));
      const tx = Reflect.apply(nativeTransaction, db, [['syncQueue'], 'readwrite']);
      const ready = deferred(), done = deferred();
      let released = false;
      tx.oncomplete = () => done.resolve(); tx.onabort = () => done.reject(tx.error); tx.onerror = () => done.reject(tx.error);
      const pump = () => {
        const item = tx.objectStore('syncQueue').get('__native_contention_only__');
        item.onsuccess = () => { ready.resolve(); if (!released) pump(); };
      };
      pump(); await ready.promise;
      const failsafe = setTimeout(() => { released = true; }, 3000);
      return async () => { released = true; clearTimeout(failsafe); await done.promise; db.close(); emit('native-queue-lock-released'); };
    }
    async function finish(f, commit, extra = {}, activeDirectory = directory) {
      for (let attempt = 0; attempt < 4; attempt++) { await activeDirectory.flush(); if (!(await queue.getAll()).length) break; }
      const commitEvent = events.find(event => event.phase === f.name && event.kind === 'prepared-durable-transaction-complete');
      const oldCloses = events.filter(event => event.phase === f.name && event.kind === 'native-file-close-complete' && event.filename === f.archivePath.split('/').at(-1));
      const meta = await queue.getMeta(), conflictCopies = [];
      for (const entry of meta.conflicts || []) if (entry.path === f.archivePath) {
        // readJson deliberately prohibits internal conflict paths. Read the actual
        // synthetic OPFS file natively instead; no new fixture content is written.
        const parts = entry.conflictPath.split('/');
        let parent = await (await handles.load()).getDirectoryHandle('Brevess');
        for (const part of parts.slice(0, -1)) parent = await parent.getDirectoryHandle(part);
        const file = await (await parent.getFileHandle(parts.at(-1))).getFile();
        conflictCopies.push({ entry, value: JSON.parse(await file.text()) });
      }
      const result = { name: f.name, identity: f.identity, archivePath: f.archivePath, commit,
        document: await documents.getDocument(f.identity.documentId),
        highlights: await workspaces.getAsset(f.identity.workspaceId, 'annotations/highlights.json'),
        disk: await activeDirectory.readJson(f.archivePath), pending: await queue.getAll(), commitEvent, oldCloses, conflictCopies,
        lateOldCloses: oldCloses.filter(event => !commitEvent || event.seq > commitEvent.seq), ...extra };
      cases.push(result); return result;
    }
    try {
      const waiting = await fixture('waiting-enqueue', 1);
      const releaseQueue = await holdQueue(), submitted = deferred(); queueWaiters.add(submitted);
      let saving, committing;
      try {
        saving = router.handle({ type: 'ARTICLE_ARCHIVE_SAVE', archive: waiting.old });
        await bound(submitted.promise, 'actual archive queue submission'); queueWaiters.delete(submitted);
        committing = waiting.commit();
        // A correct shared-store transaction may block both the restore and a document read.
        // Release contention independently, never await durable commit while holding this lock.
        await delay(120);
      } finally { queueWaiters.delete(submitted); await releaseQueue(); }
      await finish(waiting, await bound(committing, 'waiting commit'), { queueSubmitted: true, save: await bound(saving, 'waiting save') });

      const prequeued = await fixture('prequeued-new-instance', 2);
      await directory.enqueueJson(prequeued.archivePath, prequeued.old);
      const originalRow = await queue.get(prequeued.archivePath);
      const newQueue = SciLLM.createIndexedDbSyncQueue(indexedDB);
      const sameRow = await newQueue.get(prequeued.archivePath);
      const newDirectory = SciLLM.createDirectorySync({ handleStore: SciLLM.createIndexedDbDirectoryHandleStore(indexedDB), queueStore: newQueue });
      await finish(prequeued, await bound(prequeued.commit(), 'prequeued commit'),
        { samePersistedQueueRow: Boolean(originalRow && JSON.stringify(originalRow) === JSON.stringify(sameRow)), persistedOldRow: originalRow }, newDirectory);

      const inflight = await fixture('inflight-native-write', 3);
      await directory.enqueueJson(inflight.archivePath, inflight.old);
      latch = { filename: inflight.archivePath.split('/').at(-1), reached: deferred(), release: deferred(), fired: false };
      const flushing = directory.flush();
      await bound(latch.reached.promise, 'real native archive write');
      const inFlightCommit = inflight.commit();
      // Start a real second save while flush holds the document lock. This detects
      // mutationTail -> document-lock / document-lock -> mutationTail inversions.
      const competingSave = router.handle({ type: 'ARTICLE_ARCHIVE_SAVE', archive: inflight.old });
      let committedWhileLatched;
      try {
        await delay(150);
        committedWhileLatched = events.some(event => event.phase === inflight.name && event.kind === 'prepared-durable-transaction-complete');
      } finally { latch.release.resolve(); }
      await bound(flushing, 'in-flight native flush');
      await finish(inflight, await bound(inFlightCommit, 'in-flight commit'), {
        ioLatchReached: latch.fired, committedWhileLatched, competingSave: await bound(competingSave, 'competing save lock order') });
      latch = null;

      phase = 'real-edit-clear-controls';
      const edited = await documents.upsertAnnotation(waiting.identity.documentId, { ...waiting.annotation, note: 'Real later edit' });
      const editedArchive = SciLLM.createArticleArchive({ identity: waiting.identity, documentRecord: edited, workspace: {}, revision: 10 });
      const editSave = await router.handle({ type: 'ARTICLE_ARCHIVE_SAVE', archive: editedArchive });
      must(editSave.success, 'real edit save', editSave); await directory.flush();
      const editedDisk = await directory.readJson(waiting.archivePath);
      const cleared = await documents.clearAnnotations(waiting.identity.documentId);
      const clearArchive = SciLLM.createArticleArchive({ identity: waiting.identity, documentRecord: cleared, workspace: {}, revision: 11 });
      const clearSave = await router.handle({ type: 'ARTICLE_ARCHIVE_SAVE', archive: clearArchive });
      must(clearSave.success, 'real clear save', clearSave); await directory.flush();
      const clearedDisk = await directory.readJson(waiting.archivePath);
      const staleAfterClear = await router.handle({ type: 'ARTICLE_ARCHIVE_SAVE', archive: editedArchive });
      return { cases, events, controls: { edited, editSave, editedDisk, cleared, clearSave, clearedDisk, staleAfterClear } };
    } finally {
      latch?.release.resolve();
      IDBDatabase.prototype.transaction = nativeTransaction; IDBObjectStore.prototype.put = nativePut;
      FileSystemFileHandle.prototype.createWritable = nativeCreateWritable;
      FileSystemWritableFileStream.prototype.write = nativeWrite; FileSystemWritableFileStream.prototype.close = nativeClose;
    }
  });
}
