(function(root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./literature-radar-model.js') : root.BrevessRadar);
  if (typeof module === 'object' && module.exports) module.exports = api;
  Object.assign(root.BrevessRadar ||= {}, api);
})(globalThis, function(m) {
  'use strict';
  function mergeAbstract(paper, incoming) {
    // Failed refreshes never erase previously acquired source text or user data.
    if (!['ready','missing','error'].includes(incoming.abstractStatus)) return;
    if (incoming.abstractStatus==='error' && paper.abstractStatus==='ready') {
      paper.abstractError=incoming.abstractError; return;
    }
    for (const key of ['abstractSections','abstractStatus','abstractCopyright','abstractSource','abstractError','abstractFetchedAt','abstractAttemptAt'])
      if (Object.hasOwn(incoming,key)) paper[key]=m.radarClone(incoming[key]);
  }
  function createRadarService({ store, adapters, now = Date.now, timeoutMs = 120000 } = {}) {
    async function check(id, { signal } = {}) {
      signal?.throwIfAborted();
      const startedAt = now(), owner = crypto.randomUUID();
      const snapshot = await store.transact(state => {
        if (state.active && state.active.expiresAt > startedAt) throw m.radarError('RADAR_BUSY', 'RADAR_BUSY：另一个雷达正在检查，请稍后重试。');
        const radar = store.find(state, id), revision = m.radarRevision(radar);
        if (!adapters[radar.source]?.discover) throw m.radarError('RADAR_SOURCE_UNAVAILABLE');
        state.active = { owner, id, revision: revision.number, expiresAt: startedAt + timeoutMs + 30000 };
        revision.lastAttemptAt = startedAt;
        return { radar, revision, window: m.radarScanWindow(revision, startedAt) };
      });
      const controller = new AbortController();
      let rejectTimeout;
      const deadline = new Promise((_, reject) => { rejectTimeout = reject; });
      const cancel = () => { controller.abort(signal.reason); rejectTimeout(signal.reason); };
      signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) cancel();
      const timer = setTimeout(() => {
        controller.abort(); rejectTimeout(m.radarError('RADAR_TIMEOUT', '检查超时，已保留上次进度。可稍后重试或缩小检索式。'));
      }, timeoutMs);
      try {
        const result = await Promise.race([adapters[snapshot.radar.source].discover({
          query: snapshot.revision.query, ...snapshot.window, signal: controller.signal
        }), deadline]);
        if (!Array.isArray(result?.articles) || result.articles.length > 5000) throw m.radarError('RADAR_RESULT_INVALID');
        return await store.transact(state => {
          signal?.throwIfAborted();
          const radar = store.find(state, id), revision = m.radarRevision(radar);
          if (state.active?.owner !== owner || revision.number !== snapshot.revision.number) throw m.radarError('RADAR_STALE', '检索式已变化，本次旧结果未写入。');
          const known = new Set(revision.articles.map(p => p.id)), baseline = !revision.baselineAt;
          let added = 0;
          for (const paper of result.articles) {
            if (typeof paper.id !== 'string' || !/^\d+$/.test(paper.id) || typeof paper.title !== 'string') throw m.radarError('RADAR_RESULT_INVALID');
            if (known.has(paper.id)) { mergeAbstract(revision.articles.find(p=>p.id===paper.id),paper); continue; }
            known.add(paper.id); added++;
            revision.articles.push({ ...paper, url: `https://pubmed.ncbi.nlm.nih.gov/${paper.id}/`,
              firstSeenAt: startedAt, isBaseline: baseline, read: false });
          }
          revision.windowStart ||= snapshot.window.startDay;
          revision.baselineAt ||= startedAt;
          revision.lastSuccessAt = startedAt; // Use request start, never completion, to avoid gaps during a long request.
          revision.lastWindow = snapshot.window;
          revision.lastNewCount = baseline ? 0 : added;
          revision.warnings = Array.isArray(result.warnings) ? result.warnings.map(String).slice(0, 20) : [];
          revision.queryTranslation = String(result.queryTranslation || '').slice(0, 16000);
          revision.error = null; revision.nextRetryAt = null; state.active = null;
          return { id, baseline, added, newCount: baseline ? 0 : added, checkedAt: startedAt };
        });
      } catch (error) {
        await store.transact(state => {
          if (state.active?.owner !== owner) return;
          state.active = null;
          const radar = state.radars.find(r => r.id === id);
          if (!radar || m.radarRevision(radar).number !== snapshot.revision.number) return;
          const revision = m.radarRevision(radar);
          revision.error = { code: String(error.code || 'RADAR_CHECK_FAILED'), message: String(error.message || error).slice(0, 1200), at: now() };
          revision.nextRetryAt = now() + 3600000;
        });
        throw error;
      } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
    }
    async function backfillAbstracts(id, version, { signal, onProgress } = {}) {
      signal?.throwIfAborted(); const owner=crypto.randomUUID(), startedAt=now();
      const snapshot=await store.transact(state=>{
        if (state.active?.expiresAt>startedAt) throw m.radarError('RADAR_BUSY');
        const radar=store.find(state,id), revision=radar.revisions.find(v=>v.number===version);
        if (!revision) throw m.radarError('RADAR_REVISION_NOT_FOUND');
        if (!adapters[radar.source]?.fetchAbstracts) throw m.radarError('RADAR_SOURCE_UNAVAILABLE');
        state.active={owner,id,revision:version,expiresAt:startedAt+timeoutMs+30000};
        return {source:radar.source,ids:revision.articles.filter(p=>!['ready','missing'].includes(p.abstractStatus)).map(p=>p.id)};
      });
      const controller=new AbortController(), cancel=()=>controller.abort(signal.reason);
      signal?.addEventListener('abort',cancel,{once:true}); if(signal?.aborted)cancel();
      const timer=setTimeout(()=>controller.abort(m.radarError('RADAR_TIMEOUT')),timeoutMs);
      let completed=0, errors=0;
      try {
        for(let offset=0;offset<snapshot.ids.length;offset+=100) {
          controller.signal.throwIfAborted();
          const ids=snapshot.ids.slice(offset,offset+100), rows=await adapters[snapshot.source].fetchAbstracts(ids,{signal:controller.signal});
          await store.transact(state=>{
            controller.signal.throwIfAborted(); if(state.active?.owner!==owner)throw m.radarError('RADAR_STALE');
            const revision=store.find(state,id).revisions.find(v=>v.number===version);
            if(!revision || rows.length!==ids.length || new Set(rows.map(p=>p.id)).size!==ids.length || rows.some(p=>!ids.includes(p.id)))throw m.radarError('RADAR_RESULT_INVALID');
            for(const row of rows) { const p=revision.articles.find(p=>p.id===row.id);if(p)mergeAbstract(p,row); }
          });
          completed+=rows.length;errors+=rows.filter(p=>p.abstractStatus==='error').length;onProgress?.({completed,total:snapshot.ids.length,errors});
        }
        return {completed,total:snapshot.ids.length,errors};
      } finally {
        clearTimeout(timer);signal?.removeEventListener('abort',cancel);
        await store.transact(state=>{if(state.active?.owner===owner)state.active=null;});
      }
    }
    async function checkDue() {
      const state = await store.read(), at = now();
      if (state.active?.expiresAt > at) return [];
      const due = state.radars.filter(r => {
        const v = m.radarRevision(r);
        return r.enabled && r.intervalHours > 0 && (!v.nextRetryAt || v.nextRetryAt <= at) &&
          (!v.lastSuccessAt || v.lastSuccessAt + r.intervalHours * 3600000 <= at);
      }).sort((a, b) => (m.radarRevision(a).lastAttemptAt || 0) - (m.radarRevision(b).lastAttemptAt || 0));
      // One rule per wake keeps an MV3 event bounded; the next wake handles the next due rule.
      if (!due.length) return [];
      try { return [await check(due[0].id)]; }
      catch (error) { return [{ id: due[0].id, error: { code: error.code, message: error.message } }]; }
    }
    return { check, checkDue, backfillAbstracts };
  }
  return { createRadarService };
});
