(function(root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./literature-radar-model.js') : root.BrevessRadar);
  if (typeof module === 'object' && module.exports) module.exports = api;
  Object.assign(root.BrevessRadar ||= {}, api);
})(globalThis, function(m) {
  'use strict';
  function createMemoryRadarBackend(initial) {
    let state = m.radarClone(initial), tail = Promise.resolve();
    return { transaction(fn) {
      const run = tail.then(() => {
        const draft = m.radarClone(state), result = fn(draft);
        if (result?.then) throw m.radarError('RADAR_ASYNC_TRANSACTION');
        state = m.radarClone(result.state);
        return m.radarClone(result.value);
      });
      tail = run.catch(() => {}); return run;
    } };
  }
  function createIndexedDbRadarBackend(indexedDB = globalThis.indexedDB) {
    let opening;
    function open() {
      return opening ||= new Promise((resolve, reject) => {
        if (!indexedDB?.open) { reject(m.radarError('RADAR_STORAGE_UNAVAILABLE')); return; }
        const request = indexedDB.open(m.RADAR_DATABASE, 1);
        request.onupgradeneeded = () => request.result.createObjectStore('state');
        request.onerror = () => { opening = null; reject(request.error); };
        request.onblocked = () => reject(m.radarError('RADAR_STORAGE_BLOCKED'));
        request.onsuccess = () => {
          const db = request.result; db.onversionchange = () => { db.close(); opening = null; }; resolve(db);
        };
      });
    }
    return { async transaction(fn) {
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('state', 'readwrite'), store = tx.objectStore('state');
        let result, fault;
        tx.oncomplete = () => resolve(result.value);
        tx.onabort = () => reject(fault || tx.error || m.radarError('RADAR_STORAGE_ABORTED'));
        tx.onerror = () => {};
        const request = store.get('radar');
        request.onsuccess = () => {
          try {
            result = fn(request.result);
            if (result?.then) throw m.radarError('RADAR_ASYNC_TRANSACTION');
            store.put(result.state, 'radar');
          } catch (error) { fault = error; tx.abort(); }
        };
      });
    } };
  }
  function createRadarStore({ backend = createIndexedDbRadarBackend(), now = Date.now } = {}) {
    const transact = fn => backend.transaction(raw => {
      const state = raw === undefined ? m.emptyRadarState() : m.validateRadarState(raw);
      const value = fn(state); if (value?.then) throw m.radarError('RADAR_ASYNC_TRANSACTION');
      m.validateRadarState(state); return { state, value: m.radarClone(value) };
    });
    const find = (state, id) => {
      const radar = state.radars.find(r => r.id === id);
      if (!radar) throw m.radarError('RADAR_NOT_FOUND'); return radar;
    };
    function revision(config, number) {
      return { number, query: config.query, baselineDays: config.baselineDays, createdAt: now(), windowStart: null,
        baselineAt: null, lastSuccessAt: null, lastAttemptAt: null, nextRetryAt: null, lastNewCount: 0,
        articles: [], warnings: [], queryTranslation: '', error: null };
    }
    return { transact, find, read: () => transact(state => state), get: id => transact(state => find(state, id)),
      save(input, expectedVersion) {
        const config = m.validateRadarConfig(input);
        return transact(state => {
          if (!input.id) {
            if (state.radars.length >= 50) throw m.radarError('RADAR_RULE_LIMIT', '最多保存 50 个雷达。');
            const radar = { ...config, id: 'radar-' + crypto.randomUUID(), editVersion: 1, createdAt: now(), updatedAt: now(), revisions: [revision(config, 1)] };
            state.radars.push(radar); return radar;
          }
          const radar = find(state, input.id);
          if (expectedVersion !== radar.editVersion) throw m.radarError('RADAR_EDIT_CONFLICT', '此检索式已被其他窗口或 Agent 修改。请重新打开后编辑。');
          if (radar.query !== config.query || radar.baselineDays !== config.baselineDays) radar.revisions.push(revision(config, radar.revisions.length + 1));
          Object.assign(radar, config, { editVersion: radar.editVersion + 1, updatedAt: now() }); return radar;
        });
      },
      markRead(id, version, ids, read) {
        if (!Array.isArray(ids) || ids.length > 5000 || ids.some(id => typeof id !== 'string' || !/^\d+$/.test(id)) || typeof read !== 'boolean') throw m.radarError('RADAR_ARGUMENT');
        return transact(state => {
          const radar = find(state, id), revision = radar.revisions.find(r => r.number === version);
          if (!revision) throw m.radarError('RADAR_REVISION_NOT_FOUND');
          const selected = new Set(ids);
          for (const paper of revision.articles) if (selected.has(paper.id)) paper.read = read;
          return { count: revision.articles.filter(p => selected.has(p.id)).length };
        });
      }
    };
  }
  return { createMemoryRadarBackend, createIndexedDbRadarBackend, createRadarStore };
});
