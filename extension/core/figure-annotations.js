(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  'use strict';
  const FIGURE_ANNOTATIONS_PATH = 'annotations/figure-images.json';
  const clone = value => JSON.parse(JSON.stringify(value));
  const fail = () => { throw Object.assign(new Error('图片标注格式或来源无效；原存档未覆盖。'), { code: 'FIGURE_ANNOTATIONS_INVALID' }); };
  function figureAnnotationBinding(value) {
    if (!value || typeof value.documentKey !== 'string' || !value.documentKey || value.documentKey.length > 4096 || /[\u0000-\u001f]/u.test(value.documentKey) ||
        typeof value.figureId !== 'string' || !value.figureId || value.figureId.length > 300 ||
        !Number.isSafeInteger(value.imageIndex) || value.imageIndex < 0 || value.imageIndex > 999 ||
        !/^[a-f0-9]{64}$/u.test(value.sha256 || '') ||
        ![value.width, value.height].every(n => Number.isSafeInteger(n) && n > 0 && n <= 100000)) fail();
    return { documentKey: value.documentKey, figureId: value.figureId, imageIndex: value.imageIndex,
      sha256: value.sha256, width: value.width, height: value.height };
  }
  const figureAnnotationKey = value => JSON.stringify(figureAnnotationBinding(value));
  function annotationObjects(values) {
    if (!Array.isArray(values) || values.length > 1000) fail();
    const ids = new Set(); let pointCount = 0;
    return values.map(value => {
      if (!value || !/^[\w-]{1,120}$/u.test(value.id || '') || ids.has(value.id) ||
          !['pen', 'line', 'arrow', 'rectangle', 'ellipse', 'text'].includes(value.type) ||
          !/^#[a-f0-9]{6}$/iu.test(value.color || '') || !Number.isFinite(value.width) || value.width < .25 || value.width > 30 ||
          !Array.isArray(value.points) || value.points.length < 1 || value.points.length > 4096) fail();
      if (value.type !== 'pen' && value.type !== 'text' && value.points.length !== 2) fail();
      pointCount += value.points.length; if (pointCount > 100000) fail();
      const points = value.points.map(point => {
        if (!Array.isArray(point) || point.length !== 2 || !point.every(n => Number.isFinite(n) && n >= 0 && n <= 1)) fail();
        return point.slice();
      });
      ids.add(value.id);
      const result = { id: value.id, type: value.type, color: value.color, width: value.width, points };
      if (value.type === 'text') {
        if (typeof value.text !== 'string' || !value.text.trim() || value.text.length > 2000) fail();
        result.text = value.text;
        result.fontSize = value.fontSize === undefined ? 24 : value.fontSize;
        if (!Number.isFinite(result.fontSize) || result.fontSize < 8 || result.fontSize > 96) fail();
      }
      return result;
    });
  }
  function normalizeFigureAnnotations(value) {
    if (value == null) return { schemaVersion: 1, kind: 'brevess-figure-annotations', records: [] };
    if (value.schemaVersion !== 1 || value.kind !== 'brevess-figure-annotations' || !Array.isArray(value.records) || value.records.length > 1000) fail();
    const keys = new Set();
    const records = value.records.map(record => {
      const binding = figureAnnotationBinding(record?.binding), key = figureAnnotationKey(binding);
      if (keys.has(key)) fail(); keys.add(key);
      return { binding, objects: annotationObjects(record.objects) };
    });
    if (JSON.stringify(records).length > 8 * 1024 * 1024) fail();
    return { schemaVersion: 1, kind: 'brevess-figure-annotations', records };
  }
  function findFigureAnnotationRecord(value, binding) {
    const key = figureAnnotationKey(binding);
    return normalizeFigureAnnotations(value).records.find(record => figureAnnotationKey(record.binding) === key) || null;
  }
  function withFigureAnnotationRecord(value, binding, objects) {
    const document = normalizeFigureAnnotations(value), key = figureAnnotationKey(binding);
    const record = { binding: figureAnnotationBinding(binding), objects: annotationObjects(objects) };
    const index = document.records.findIndex(item => figureAnnotationKey(item.binding) === key);
    if (index < 0) document.records.push(record); else document.records[index] = record;
    return normalizeFigureAnnotations(document);
  }
  function createFigureAnnotationSession({ binding, objects = [], save: persist }) {
    const identity = figureAnnotationBinding(binding), listeners = new Set();
    let current = annotationObjects(objects), acknowledged = JSON.stringify(current), error = '', inFlight = null;
    const undo = [], redo = [];
    const getState = () => ({ binding: clone(identity), objects: clone(current), dirty: JSON.stringify(current) !== acknowledged,
      saving: Boolean(inFlight), error, canUndo: undo.length > 0, canRedo: redo.length > 0 });
    const notify = () => { const state = getState(); for (const listener of listeners) { try { listener(state); } catch (_) {} } };
    function commit(values) {
      const next = annotationObjects(values); if (JSON.stringify(next) === JSON.stringify(current)) return;
      undo.push(current); if (undo.length > 30) undo.shift(); redo.length = 0;
      current = next; error = ''; notify();
    }
    async function save() {
      if (inFlight) return inFlight;
      if (!getState().dirty) return { saved: true, unchanged: true };
      const snapshot = clone(current); error = '';
      const operation = Promise.resolve().then(() => persist(snapshot, clone(identity))).then(receipt => {
        if (receipt?.saved !== true || receipt.stale || receipt.deferred || receipt.frozen) throw new Error('标注保存尚未确认，请重试。');
        acknowledged = JSON.stringify(snapshot); return receipt;
      }).catch(cause => { error = cause?.message || '标注保存失败，请重试。'; throw cause; });
      inFlight = operation; notify();
      try { return await operation; } finally { inFlight = null; notify(); }
    }
    return { getState, commit, save, subscribe(listener) { listeners.add(listener); listener(getState()); return () => listeners.delete(listener); },
      undo() { if (!undo.length) return; redo.push(current); current = undo.pop(); error = ''; notify(); },
      redo() { if (!redo.length) return; undo.push(current); current = redo.pop(); error = ''; notify(); } };
  }
  function createFigureAnnotationRepository({ readAsset, writeAsset, assertCurrent = () => {}, onSaved = () => {}, initialDocument = null }) {
    const sessions = new Map(); let document = normalizeFigureAnnotations(initialDocument), assetObserved = false;
    let connection = { readAsset, writeAsset, assertCurrent, onSaved };
    const read = async context => { context.assertCurrent(); const asset = await context.readAsset(); context.assertCurrent();
      if (asset) { document = normalizeFigureAnnotations(asset.content); assetObserved = true; }
      else if (assetObserved) document = normalizeFigureAnnotations(null);
      return asset; };
    async function open(binding) {
      const context = connection; context.assertCurrent(); const key = figureAnnotationKey(binding); if (sessions.has(key)) return sessions.get(key);
      await read(context); if (sessions.has(key)) return sessions.get(key);
      let baseline = findFigureAnnotationRecord(document, binding)?.objects || [];
      const session = createFigureAnnotationSession({ binding, objects: baseline, save: async objects => {
        // Each operation owns its original lifecycle, even if the page reconnects while it awaits I/O.
        const context = connection, asset = await read(context);
        const actual = findFigureAnnotationRecord(document, binding)?.objects || [];
        if (JSON.stringify(actual) === JSON.stringify(objects) && asset) { baseline = clone(objects); context.onSaved(document); return { saved: true, unchanged: true }; }
        if (JSON.stringify(actual) !== JSON.stringify(baseline)) throw Object.assign(new Error('此图标注已被其他页面修改，草稿已保留。'), { code: 'FIGURE_ANNOTATION_CONFLICT' });
        const next = withFigureAnnotationRecord(document, binding, objects); context.assertCurrent();
        const receipt = await context.writeAsset(next, { force: true, expectedRevision: Number(asset?.revision) || 0,
          expectedContentHash: asset?.contentHash, createOnly: !asset }); context.assertCurrent();
        if (receipt?.saved !== true || receipt.stale || receipt.frozen || receipt.deferred) throw new Error('标注保存尚未确认，请重试。');
        const reopened = await read(context);
        if (!reopened || JSON.stringify(findFigureAnnotationRecord(document, binding)?.objects) !== JSON.stringify(objects)) throw new Error('标注回读未确认，草稿已保留，请重试。');
        baseline = clone(objects); context.onSaved(document); return { saved: true };
      } });
      sessions.set(key, session); return session;
    }
    return { open, reconnect(next) { next.assertCurrent(); connection = { onSaved: () => {}, ...next }; },
      snapshot: () => clone(document), hasDrafts: () => [...sessions.values()].some(session => session.getState().dirty || session.getState().saving) };
  }
  return { FIGURE_ANNOTATIONS_PATH, figureAnnotationBinding, figureAnnotationKey, normalizeFigureAnnotations,
    findFigureAnnotationRecord, withFigureAnnotationRecord, createFigureAnnotationSession, createFigureAnnotationRepository };
});
