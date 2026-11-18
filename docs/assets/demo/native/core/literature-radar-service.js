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
    let running=false;
    async function exclusive(fn){
      const busy=()=>{throw m.radarError('RADAR_BUSY','RADAR_BUSY：另一个雷达正在检查，请稍后重试。');};
      if(running)busy();running=true;
      try{return await (globalThis.navigator?.locks?globalThis.navigator.locks.request('brevess-radar-scan-v1',{ifAvailable:true},lock=>lock?fn():busy()):fn());}
      finally{running=false;}
    }
    const check=(id,options)=>exclusive(()=>checkOne(id,options));
    async function checkAll({signal,onProgress}={}){
      return exclusive(async()=>{
        const snapshot=await store.read();
        if(snapshot.active?.expiresAt>now())throw m.radarError('RADAR_BUSY','RADAR_BUSY：另一个雷达正在检查，请稍后重试。');
        const results=[],total=snapshot.radars.length;
        const report=async current=>{try{await onProgress?.({total,completed:results.length,current,results:[...results]});}catch{}};
        for(const radar of snapshot.radars){
          if(signal?.aborted)break;await report({id:radar.id,name:radar.name});
          try{results.push({id:radar.id,name:radar.name,...await checkOne(radar.id,{signal})});}
          catch(error){if(signal?.aborted)break;results.push({id:radar.id,name:radar.name,error:{code:error.code,message:error.message}});}
          await report(null);
        }
        return {total,results,cancelled:!!signal?.aborted};
      });
    }
    async function checkOne(id, { signal } = {}) {
      if((await store.get(id)).sourceQueries)return checkMulti(id,{signal});
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
            const url=m.radarPaperUrl(radar.source,paper);
            if (!url || typeof paper.title !== 'string') throw m.radarError('RADAR_RESULT_INVALID');
            if (known.has(paper.id)) { mergeAbstract(revision.articles.find(p=>p.id===paper.id),paper); continue; }
            known.add(paper.id); added++;
            revision.articles.push({ ...paper, url,
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
          // A user's stop is not a source failure and must not create a retry penalty.
          if(signal?.aborted)return;
          const radar = state.radars.find(r => r.id === id);
          if (!radar || m.radarRevision(radar).number !== snapshot.revision.number) return;
          const revision = m.radarRevision(radar);
          revision.error = { code: String(error.code || 'RADAR_CHECK_FAILED'), message: String(error.message || error).slice(0, 1200), at: now() };
          revision.nextRetryAt = now() + 3600000;
        });
        throw error;
      } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
    }
    async function checkMulti(id,{signal}={}) {
      signal?.throwIfAborted();const startedAt=now(),owner=crypto.randomUUID();
      const snapshot=await store.transact(state=>{
        if(state.active?.expiresAt>startedAt)throw m.radarError('RADAR_BUSY');
        const radar=store.find(state,id),revision=m.radarRevision(radar),queries=m.radarSourceQueries(revision.sourceQueries?revision:radar);
        state.active={owner,id,revision:revision.number,expiresAt:startedAt+timeoutMs+30000};revision.lastAttemptAt=startedAt;
        return {radar,revision,queries};
      });
      const controller=new AbortController(),cancel=()=>controller.abort(signal.reason);signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
      const timer=setTimeout(()=>controller.abort(m.radarError('RADAR_TIMEOUT')),timeoutMs),results=[];
      try {
        for(const entry of snapshot.queries){
          await store.transact(state=>{signal?.throwIfAborted();if(state.active?.owner!==owner||m.radarRevision(store.find(state,id)).number!==snapshot.revision.number)throw m.radarError('RADAR_STALE');state.active.source=entry.source;});
          signal?.throwIfAborted();const prior=snapshot.revision.sourceStates?.[entry.source]||{},window=m.radarScanWindow({...prior,baselineDays:snapshot.revision.baselineDays},startedAt);
          try {
            controller.signal.throwIfAborted();if(!adapters[entry.source]?.discover)throw m.radarError('RADAR_SOURCE_UNAVAILABLE');
            const result=await new Promise((resolve,reject)=>{const aborted=()=>reject(controller.signal.reason||m.radarError('RADAR_TIMEOUT'));controller.signal.addEventListener('abort',aborted,{once:true});Promise.resolve().then(()=>adapters[entry.source].discover({query:entry.query,...window,signal:controller.signal})).then(resolve,reject).finally(()=>controller.signal.removeEventListener('abort',aborted));});
            if(!Array.isArray(result?.articles)||result.articles.length>5000||result.articles.some(p=>!m.radarPaperUrl(entry.source,p)||typeof p.title!=='string'))throw m.radarError('RADAR_RESULT_INVALID');
            results.push({...entry,result,window,baseline:!prior.baselineAt});
          } catch(error){signal?.throwIfAborted();results.push({...entry,window,error:{code:String(error.code||'RADAR_CHECK_FAILED'),message:String(error.message||error).slice(0,1200),at:startedAt}});}
        }
        return await store.transact(state=>{
          signal?.throwIfAborted();const radar=store.find(state,id),revision=m.radarRevision(radar);
          if(state.active?.owner!==owner||revision.number!==snapshot.revision.number)throw m.radarError('RADAR_STALE');
          revision.sourceStates||={};let added=0,newCount=0,merged=0;const warnings=[];
          for(const item of results){
            const status=revision.sourceStates[item.source]||={};status.lastAttemptAt=startedAt;
            if(item.error){status.error=item.error;warnings.push(m.RADAR_SOURCES[item.source].name+'：'+item.error.message);continue;}
            const counts=m.mergeRadarArticles(revision.articles,item.result.articles,{source:item.source,defaultSource:radar.source,baseline:item.baseline,at:startedAt});added+=counts.added;newCount+=counts.newCount;merged+=counts.merged;
            status.windowStart||=item.window.startDay;status.baselineAt||=startedAt;status.lastSuccessAt=startedAt;status.lastWindow=item.window;status.error=null;status.queryTranslation=String(item.result.queryTranslation||item.query).slice(0,16000);
            warnings.push(...(item.result.warnings||[]).map(s=>m.RADAR_SOURCES[item.source].name+'：'+String(s)));
          }
          if(revision.articles.length>5000)throw m.radarError('RADAR_QUERY_TOO_BROAD','合并结果超过 5,000 篇，原进度已保留；请缩小检索式。');
          const successes=results.filter(r=>!r.error),failures=results.filter(r=>r.error);revision.lastNewCount=newCount;revision.warnings=warnings.slice(0,30);
          if(successes.length){revision.baselineAt||=startedAt;revision.lastSuccessAt=startedAt;revision.windowStart||=successes[0].window.startDay;revision.lastWindow=successes[0].window;}
          revision.error=failures.length?{code:successes.length?'RADAR_PARTIAL_FAILURE':'RADAR_CHECK_FAILED',message:failures.map(r=>m.RADAR_SOURCES[r.source].name+'：'+r.error.message).join('；'),at:startedAt}:null;
          revision.nextRetryAt=failures.length?startedAt+3600000:null;state.active=null;
          return {id,baseline:successes.every(r=>r.baseline),added,newCount,merged,checkedAt:startedAt,partial:!!failures.length,sources:results.map(r=>({source:r.source,success:!r.error,...(r.error?{error:r.error}:{matched:r.result.articles.length})}))};
        });
      } finally {clearTimeout(timer);signal?.removeEventListener('abort',cancel);await store.transact(state=>{if(state.active?.owner===owner)state.active=null;});}
    }

    const backfillAbstracts=(...args)=>exclusive(()=>backfillOne(...args));
    async function backfillOne(id, version, { signal, onProgress } = {}) {
      signal?.throwIfAborted(); const owner=crypto.randomUUID(), startedAt=now();
      const snapshot=await store.transact(state=>{
        if (state.active?.expiresAt>startedAt) throw m.radarError('RADAR_BUSY');
        const radar=store.find(state,id), revision=radar.revisions.find(v=>v.number===version);
        if (!revision) throw m.radarError('RADAR_REVISION_NOT_FOUND');
        const targets=revision.articles.filter(p=>!['ready','missing'].includes(p.abstractStatus)).flatMap(p=>{const record=(p.sourceRecords||[{...p,source:p.source||radar.source}]).find(r=>adapters[r.source]?.fetchAbstracts);return record?[{source:record.source,id:record.id,paperId:p.id}]:[];});
        if(!targets.length)return {targets:[]};
        state.active={owner,id,revision:version,expiresAt:startedAt+timeoutMs+30000};
        return {targets};
      });
      const controller=new AbortController(), cancel=()=>controller.abort(signal.reason);
      signal?.addEventListener('abort',cancel,{once:true}); if(signal?.aborted)cancel();
      const timer=setTimeout(()=>controller.abort(m.radarError('RADAR_TIMEOUT')),timeoutMs);
      let completed=0, errors=0;
      try {
        for(const source of [...new Set(snapshot.targets.map(t=>t.source))]){const targets=snapshot.targets.filter(t=>t.source===source);
        for(let offset=0;offset<targets.length;offset+=100) {
          controller.signal.throwIfAborted();
          const batch=targets.slice(offset,offset+100),ids=batch.map(t=>t.id), rows=await adapters[source].fetchAbstracts(ids,{signal:controller.signal});
          await store.transact(state=>{
            controller.signal.throwIfAborted(); if(state.active?.owner!==owner)throw m.radarError('RADAR_STALE');
            const revision=store.find(state,id).revisions.find(v=>v.number===version);
            if(!revision || rows.length!==ids.length || new Set(rows.map(p=>p.id)).size!==ids.length || rows.some(p=>!ids.includes(p.id)))throw m.radarError('RADAR_RESULT_INVALID');
            for(const row of rows) { const p=revision.articles.find(p=>p.id===batch.find(t=>t.id===row.id)?.paperId);if(p){mergeAbstract(p,row);const record=p.sourceRecords?.find(r=>r.source===source&&r.id===row.id);if(record)mergeAbstract(record,row);} }
          });
          completed+=rows.length;errors+=rows.filter(p=>p.abstractStatus==='error').length;onProgress?.({completed,total:snapshot.targets.length,errors});
        }}
        return {completed,total:snapshot.targets.length,errors};
      } finally {
        clearTimeout(timer);signal?.removeEventListener('abort',cancel);
        await store.transact(state=>{if(state.active?.owner===owner)state.active=null;});
      }
    }

    const backfillBaseline=(...args)=>exclusive(()=>backfillBaselineOne(...args));
    async function backfillBaselineOne(id, version, {startDay,endDay,signal}={}) {
      const validDay=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
      if(!validDay(startDay)||!validDay(endDay)||startDay>endDay||startDay<'1900-01-01')throw m.radarError('RADAR_HISTORY_RANGE','请填写有效的历史基线日期范围。');
      signal?.throwIfAborted();const startedAt=now(),owner=crypto.randomUUID();
      const snapshot=await store.transact(state=>{
        if(state.active?.expiresAt>startedAt)throw m.radarError('RADAR_BUSY');
        const radar=store.find(state,id),revision=m.radarRevision(radar);
        if(revision.sourceQueries)throw m.radarError('RADAR_HISTORY_RANGE','多来源策略请分别使用来源检索式建立历史策略；原历史基线保留。');
        if(!revision.baselineAt||revision.number!==version)throw m.radarError('RADAR_STALE','请先完成当前版本的首次检查，再补充历史基线。');
        const initialStart=revision.windowStart||m.radarScanWindow({baselineDays:revision.baselineDays},revision.baselineAt).startDay;
        if(endDay>=initialStart)throw m.radarError('RADAR_HISTORY_RANGE','历史范围须早于首次基线窗口；当前增量检查范围保持不变。');
        if(!adapters[radar.source]?.discover)throw m.radarError('RADAR_SOURCE_UNAVAILABLE');
        state.active={owner,id,revision:version,expiresAt:startedAt+timeoutMs+30000};
        return {source:radar.source,query:revision.query};
      });
      const controller=new AbortController();let rejectDeadline;
      const deadline=new Promise((_,reject)=>{rejectDeadline=reject;});
      const cancel=()=>{controller.abort(signal.reason);rejectDeadline(signal.reason);};
      signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
      const timer=setTimeout(()=>{const error=m.radarError('RADAR_TIMEOUT','历史基线检索超时，原数据与进度已保留。请缩小日期范围后重试。');controller.abort(error);rejectDeadline(error);},timeoutMs);
      try {
        const result=await Promise.race([adapters[snapshot.source].discover({query:snapshot.query,startDay,endDay,signal:controller.signal}),deadline]);
        if(!Array.isArray(result?.articles)||result.articles.length>5000)throw m.radarError('RADAR_RESULT_INVALID');
        return await store.transact(state=>{
          signal?.throwIfAborted();controller.signal.throwIfAborted();const radar=store.find(state,id),revision=m.radarRevision(radar);
          if(state.active?.owner!==owner||revision.number!==version||revision.query!==snapshot.query)throw m.radarError('RADAR_STALE','任务已变化，本次历史结果未写入。');
          const known=new Set(revision.articles.map(p=>p.id)),received=new Set();let added=0;
          for(const paper of result.articles){
            const url=m.radarPaperUrl(radar.source,paper);
            if(!url||typeof paper.title!=='string'||!paper.title.trim()||received.has(paper.id))throw m.radarError('RADAR_RESULT_INVALID');
            received.add(paper.id);if(known.has(paper.id))continue;
            known.add(paper.id);added++;
            revision.articles.push({...paper,url,firstSeenAt:startedAt,isBaseline:true,read:false});
          }
          if(added&&revision.articles.length>5000)throw m.radarError('RADAR_QUERY_TOO_BROAD','补充后本版本将超过 5,000 篇分享上限，本次未保存。请缩小历史日期范围。');
          const history=Array.isArray(revision.baselineHistory)?revision.baselineHistory:[];
          revision.baselineHistory=[...history.filter(h=>h.startDay!==startDay||h.endDay!==endDay),{startDay,endDay,checkedAt:startedAt,matched:received.size,added}].slice(-100);
          state.active=null;
          return {id,version,startDay,endDay,added,matched:received.size,checkedAt:startedAt};
        });
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
          ((v.error && v.nextRetryAt && v.nextRetryAt <= at) || !v.lastSuccessAt || v.lastSuccessAt + r.intervalHours * 3600000 <= at);
      }).sort((a, b) => (m.radarRevision(a).lastAttemptAt || 0) - (m.radarRevision(b).lastAttemptAt || 0));
      // One rule per wake keeps an MV3 event bounded; the next wake handles the next due rule.
      if (!due.length) return [];
      try { return [await check(due[0].id)]; }
      catch (error) { return [{ id: due[0].id, error: { code: error.code, message: error.message } }]; }
    }
    return { check, checkAll, checkDue, backfillAbstracts, backfillBaseline };
  }
  return { createRadarService };
});
