(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;Object.assign(root.BrevessReadingAgent ||= {},api);})(globalThis,()=>{
  'use strict';
  const KEY='brevess-reading-jobs-v1',terminal=new Set(['completed','partial','failed','cancelled','interrupted']);
  const fault=(code,message=code)=>Object.assign(Error(message),{code});
  const copy=value=>JSON.parse(JSON.stringify(value));
  function createReadingJobController({browser,ensureContent,save,bundle,keepAlive=p=>p,now=()=>Date.now()}){
    const jobs=new Map();let active=null,persistChain=Promise.resolve();
    const ready=(async()=>{const saved=(await browser.storage.session.get(KEY))[KEY]||[];for(const value of saved){if(!terminal.has(value.state)){value.state='interrupted';value.error='浏览器或扩展已重启；已完成结果保留，请检查后重新发起剩余任务。';for(const target of value.targets)if(!terminal.has(target.state))target.state='interrupted';}jobs.set(value.jobId,value);}})();
    function persist(){
      const all=[...jobs.values()].sort((a,b)=>b.createdAt-a.createdAt);for(const old of all.slice(50))if(terminal.has(old.state))jobs.delete(old.jobId);
      let snapshot=copy([...jobs.values()]);
      for(const old of [...all].reverse()){
        if(new TextEncoder().encode(JSON.stringify(snapshot)).length<=2*1024*1024)break;
        if(terminal.has(old.state)){jobs.delete(old.jobId);snapshot=copy([...jobs.values()]);}
      }
      persistChain=persistChain.catch(()=>{}).then(()=>browser.storage.session.set({[KEY]:snapshot}));return persistChain;
    }
    const savedTab=tab=>globalThis.SciLLM?.parseOfflineArticleReaderUrl?.(tab?.url,browser.runtime?.getURL?.(''));
    const supportedTab=tab=>/^https?:\/\//.test(tab?.url||'')||Boolean(savedTab(tab));
    async function getTab(id){const tab=await browser.tabs.get(id);if(!supportedTab(tab))throw fault('READING_TAB_UNSUPPORTED','请选择论文网页或本机保存的论文。');return tab;}
    async function page(tabId,action,binding={},extra={}){
      const result=await browser.tabs.sendMessage(tabId,{action,...extra,expectedDocumentIdentity:binding.documentIdentity,expectedNavigationIdentity:binding.navigationIdentity},{frameId:0});
      if(result?.success===false)throw fault(result.code||result.error?.code||'READING_PAGE_FAILED',result.error?.message||result.error||result.code);
      if(!result)throw fault('READING_PAGE_UNAVAILABLE');return result;
    }
    async function inspect(tabId){const tab=await getTab(tabId);if(savedTab(tab)){const proof=await page(tabId,'validateSavedArticleReader');if(!proof?.binding)throw fault('READING_TARGET_NOT_READY');}else await ensureContent(tab);const result=await page(tabId,'getReadingAgentSnapshot');const after=await getTab(tabId);if(after.url!==tab.url)throw fault('READING_TARGET_CHANGED');return{...result.data,binding:{tabId,url:tab.url,...result.data.binding}};}
    async function verify(target){const tab=await getTab(target.tabId);if(tab.url!==target.url)throw fault('READING_TARGET_CHANGED');const result=await page(target.tabId,'getReadingAgentSnapshot',target,{compact:true});if(result.data.binding.documentHash!==target.documentHash)throw fault('READING_TARGET_CHANGED');return result.data;}
    async function execute(job){
      job.state='running';await persist();
      for(const target of job.targets){
        if(job.cancelRequested){target.state='cancelled';continue;}
        try{
          const current=await verify(target.binding);
          if(current.status?.running)throw fault('READING_FIGURE_BUSY','该论文已有解图任务，请等待完成。');
          target.state='running';target.stage=job.task;await persist();
          if(job.task==='figures'){
            const known=new Set(current.figures.map(figure=>figure.figureId));
            if(target.binding.figureIds.some(id=>!known.has(id)))throw fault('READING_FIGURE_STALE');
            const result=await page(target.binding.tabId,'analyzeFiguresWithLLM',target.binding,{operationId:target.operationId,rejectIfBusy:true,documentHash:target.binding.documentHash,figureIds:target.binding.figureIds,analysisDepth:job.analysisDepth,figureInputMode:job.figureInputMode});
            target.analysis={success:result.success===true,cancelled:result.cancelled===true,totalFigures:result.totalFigures,failedFigures:result.failedFigures,code:result.code};
            if(result.cancelled||job.cancelRequested){target.state='cancelled';continue;}
            const status=await page(target.binding.tabId,'getFigureAnalysisStatus',target.binding);
            target.progress=status.status;
            if(status.status?.phase==='failed')throw fault('READING_ANALYSIS_FAILED');
          }
          if(job.task==='save'||job.saveAfter){await verify(target.binding);target.stage='saving';await persist();target.saved=await save(target.binding,target.operationId);}
          target.state=target.progress?.failedFigures||target.progress?.phase==='partial'||target.saved?.complete===false?'partial':'completed';
        }catch(error){target.state=job.cancelRequested?'cancelled':'failed';target.error={code:error.code||'READING_TASK_FAILED',message:String(error.message||error).slice(0,500)};}
        finally{target.finishedAt=now();await persist();}
      }
      job.state=job.cancelRequested?'cancelled':job.targets.every(t=>t.state==='completed')?'completed':job.targets.every(t=>t.state==='failed')?'failed':'partial';job.finishedAt=now();await persist();
    }
    async function handle(name,args){
      await ready;
      if(name==='reading_list_tabs')return{tabs:(await browser.tabs.query({})).filter(supportedTab).map(({id,windowId,title,url,discarded,status})=>({tabId:id,windowId,title,url,discarded,status})),activeJobId:active?.jobId||null};
      if(name==='reading_inspect')return inspect(args.tabId);
      if(name==='reading_open'){const url=new URL(args.url);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw fault('READING_URL_INVALID');const tab=await browser.tabs.create({url:url.href,active:false});return{tabId:tab.id,url:url.href,status:'loading',next:'reading.inspect'};}
      if(name==='reading_bundle')return bundle(args);
      if(name==='reading_status'){
        const result=args.jobId?jobs.get(args.jobId):null;if(args.jobId&&!result)throw fault('READING_JOB_NOT_FOUND');
        for(const current of result?[result]:[...jobs.values()].filter(j=>j.state==='running')){const target=current.targets.find(t=>t.state==='running');if(target&&current.task==='figures'&&target.stage==='figures')try{const status=(await page(target.binding.tabId,'getFigureAnalysisStatus',target.binding)).status;if(status?.operationId===target.operationId)target.progress=status;}catch{/* Navigation is reported by execution, never silently rebound. */}}
        return copy(result||{jobs:[...jobs.values()].sort((a,b)=>b.createdAt-a.createdAt)});
      }
      if(name==='reading_cancel'){
        const job=jobs.get(args.jobId);if(!job)throw fault('READING_JOB_NOT_FOUND');if(terminal.has(job.state))return copy(job);
        job.cancelRequested=true;await persist();
        const target=job.targets.find(t=>t.state==='running'&&t.stage==='figures');
        if(target)try{const status=(await page(target.binding.tabId,'getFigureAnalysisStatus',target.binding)).status;if(status?.operationId===target.operationId)await page(target.binding.tabId,'controlLlmOperation',target.binding,{scope:'figure',command:'cancel'});}catch(error){job.cancelWarning=error.code||error.message;}
        return copy(job);
      }
      if(name!=='reading_start')throw fault('READING_TOOL_UNKNOWN');
      const duplicate=[...jobs.values()].find(job=>job.requestId===args.requestId);
      const signature=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(args)))),v=>v.toString(16).padStart(2,'0')).join('');if(duplicate){if(duplicate.signature!==signature)throw fault('READING_REQUEST_ID_REUSED');return copy(duplicate);}
      if(active)throw fault('READING_BATCH_BUSY','已有阅读批处理任务，请先查看进度或取消。');
      if(new Set(args.targets.map(t=>t.tabId)).size!==args.targets.length)throw fault('READING_DUPLICATE_TAB');
      if(args.task==='figures'&&args.targets.some(t=>!t.figureIds?.length))throw fault('READING_FIGURES_REQUIRED');
      const job={jobId:'reading-'+crypto.randomUUID(),requestId:args.requestId,signature,task:args.task,saveAfter:args.saveAfter!==false,analysisDepth:args.analysisDepth||'standard',figureInputMode:args.figureInputMode||'vision',createdAt:now(),state:'queued',targets:args.targets.map(binding=>({binding:copy(binding),operationId:(args.task==='figures'?'figure-':'reading-')+crypto.randomUUID(),state:'queued'}))};
      active=job;jobs.set(job.jobId,job);
      try{await persist();}catch(error){active=null;jobs.delete(job.jobId);throw error;}
      const task=execute(job).catch(async error=>{job.state='failed';job.error=String(error.code||error.message);await persist();}).finally(()=>{if(active===job)active=null;});
      keepAlive(task).catch(()=>{});return copy(job);
    }
    return{handle,ready};
  }
  return{createReadingJobController};
});
