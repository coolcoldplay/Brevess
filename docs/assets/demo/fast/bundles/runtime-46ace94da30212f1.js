
;/* native/literature-radar/enrichment.js */
(function(root){
  'use strict';
  root.BrevessRadarUI={create({store,adapter,service,refresh,notice}){
    const R=root.BrevessRadar,$=id=>document.getElementById(id),client=R.createRadarRuntimeClient();
    const node=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;};
    let selected=null,revision=null,viewKey='',activeRun=null,queryEpoch=0,queryJob=null,scoring=null,hover=null,altTarget=null;
    const opened=new Set(),hiddenTranslations=new Set(),translationJobs=new Map();
    const status=(id,text)=>{$(id).textContent=text;};
    const errorText=e=>e?.message||'操作未完成，请稍后重试。';
    const op=()=>`radar-ai-${crypto.randomUUID()}`;
    const currentSpec=()=>R.radarScoringRange({description:$('score-description').value,startDay:$('score-start').value,endDay:$('score-end').value});
    const currentRun=()=>revision?.aiRuns?.find(r=>r.key===activeRun);
    function scoreFor(paper){const r=currentRun()?.results?.[paper.id];return r?.sourceFingerprint===R.radarSourceFingerprint(paper)?r:null;}
    function updateCount(){
      if(!revision)return;let candidates=[];try{candidates=R.radarScoringCandidates(revision.articles,currentSpec());}catch{}
      const available=candidates.filter(p=>p.abstractStatus==='ready').length,unknown=revision.articles.filter(p=>!p.createdDay).length;
      status('score-count',`所选范围 ${candidates.length} 篇 · 可评分 ${available} 篇 · 摘要待补齐或无摘要 ${candidates.length-available} 篇${unknown?` · ${unknown} 篇入库日期未知，未纳入`:''}。仅对本版本已扫描文献评分。`);
      $('score-papers').disabled=!!scoring||!available;
    }
    async function rememberView(){if(!selected||!revision)return;const id=selected.id,version=revision.number,spec={description:$('score-description').value,startDay:$('score-start').value,endDay:$('score-end').value,key:activeRun,sort:$('paper-sort').value};await store.transact(s=>{const v=store.find(s,id).revisions.find(v=>v.number===version);if(v)v.scoreView=spec;});}
    function prepare(radar,version,state){
      selected=radar;revision=version;const key=`${radar.id}:${version.number}`;
      if(key!==viewKey){
        if(scoring)stopScoring();for(const job of translationJobs.values())job.provider.destroy();translationJobs.clear();
        viewKey=key;const view=version.scoreView||{},days=version.articles.map(p=>p.createdDay).filter(Boolean).sort();
        $('score-description').value=view.description||'';$('score-start').value=view.startDay||days[0]||R.radarDay(Date.now()-29*R.DAY);
        $('score-end').value=view.endDay||days.at(-1)||R.radarDay(Date.now());activeRun=view.key||null;$('paper-sort').value=view.sort||'time';
        status('score-status','');
      }
      const menu=$('score-history');menu.replaceChildren(new Option('选择已保存的评分任务',''));
      for(const run of [...(version.aiRuns||[])].reverse()){const completed=Object.values(run.results||{}).filter(r=>r.status==='ready').length;menu.append(new Option(`${run.description.slice(0,34)} · ${run.startDay}—${run.endDay} · ${completed} 篇`,run.key));}
      menu.value=activeRun||'';
      const run=currentRun();status('score-model',run?`当前结果来自已保存任务 · 模型：${run.route?.model||run.route?.name||'语义查找配置'} · 分数表示相关性，不是概率。`:'尚未选择评分任务；分数不会自动生成。');
      const supports=p=>(p.sourceRecords||[{...p,source:p.source||selected.source}]).some(r=>r.source==='pubmed');
      const count=version.articles.filter(p=>supports(p)&&!['ready','missing'].includes(p.abstractStatus)).length;
      $('backfill-abstracts').hidden=!version.articles.some(supports);
      $('backfill-abstracts').disabled=!!(state.active?.expiresAt>Date.now())||!count;status('backfill-abstracts',count?`补齐摘要（${count}）`:'摘要已补齐');
      updateCount();
    }
    function bilingual(original,paper,part){
      const key=`${viewKey}:${paper.id}:${part}`,source=part==='title'?paper.title:R.radarAbstractText(paper);
      const block=node('div','bilingual-block');block.dataset.translationPart=part;block.dataset.pmid=paper.id;block.tabIndex=0;
      block.title='鼠标指向或聚焦本块，按下并松开 Alt 显示/隐藏中文对照';original.setAttribute('translate','no');block.append(original);
      const saved=paper.translations?.[part];
      if(saved?.sourceText===source&&!hiddenTranslations.has(key)){const zh=node('div','translation-zh'), translated=node('p','',saved.translatedText);translated.setAttribute('translate','no');zh.append(node('small','','中文对照'),translated);block.append(zh);block.classList.add('has-translation');}
      const target={key,source,paper:{...paper,source:paper.source||selected.source},part,id:selected.id,revision:revision.number};
      block.addEventListener('mouseenter',()=>{hover=target;});block.addEventListener('mouseleave',()=>{if(hover?.key===key)hover=null;});
      block.addEventListener('focus',()=>{hover=target;});block.addEventListener('blur',()=>{if(hover?.key===key)hover=null;});
      return block;
    }
    function decorate(article,paper){
      article.dataset.pmid=paper.id;const title=article.querySelector('h3'),afterTitle=title.nextSibling;
      article.insertBefore(bilingual(title,paper,'title'),afterTitle);
      const abstract=node('details','paper-abstract'),key=`${viewKey}:${paper.id}`;abstract.open=opened.has(key);
      const labels={ready:'摘要',missing:'来源未提供摘要',error:'摘要获取失败 · 可补齐重试'};
      abstract.append(node('summary','',labels[paper.abstractStatus]||'摘要待补齐'));
      if(paper.abstractStatus==='ready'){
        const original=node('div','abstract-original');for(const s of paper.abstractSections||[]){const p=node('p');if(s.label)p.append(node('strong','',s.label+' '));p.append(document.createTextNode(s.text));original.append(p);}
        abstract.append(bilingual(original,paper,'abstract'));
        if(paper.abstractCopyright)abstract.append(node('small','copyright',paper.abstractCopyright));
      }else abstract.append(node('p','hint',paper.abstractStatus==='missing'?'来源记录没有摘要，未生成替代内容。':'点击“补齐摘要”获取 PubMed 原文；此操作不调用 AI。'));
      abstract.addEventListener('toggle',()=>{if(abstract.open)opened.add(key);else opened.delete(key);});article.insertBefore(abstract,article.querySelector('.paper-footer'));
      const result=scoreFor(paper),score=node('div','relevance-result');
      if(result?.status==='ready'){const color=R.radarScoreColor(result.score);score.style.backgroundColor=color.css;score.append(node('strong','',`相关性 ${result.score}/100`),node('span','',result.reason));}
      else if(currentRun()){const messages={'missing-abstract':'未评分 · 来源无摘要','abstract-unavailable':'未评分 · 摘要待补齐',error:`评分失败 · ${result?.errorCode||''}`,cancelled:'已停止 · 可继续评分',pending:'评分中…'};score.textContent=messages[result?.status]||'未评分 · 不在此任务范围或内容已更新';}
      if(score.textContent)article.insertBefore(score,abstract);
    }
    function compare(a,b){
      if($('paper-sort').value==='relevance'){const x=scoreFor(a),y=scoreFor(b),av=x?.status==='ready'?x.score:-1,bv=y?.status==='ready'?y.score:-1;if(av!==bv)return bv-av;}
      return R.radarPaperTime(b)-R.radarPaperTime(a)||b.id.localeCompare(a.id,'en',{numeric:true});
    }
    async function translate(target){
      if(translationJobs.has(target.key))return;
      let provider;
      try {
      const binding=await R.radarTranslationBinding(target.id,target.revision,target.paper,target.part);
      const wrap=request=>client.request({type:'RADAR_TRANSLATION',request});
      const bridge={getRoute:(taskId,documentBinding)=>wrap({type:'TRANSLATION_TASK_ROUTE_GET',taskId,documentBinding}),translate:wrap,
        getReceipt:request=>wrap({...request,type:'TRANSLATION_RECEIPT_GET'}),cancel:(operationId,documentBinding,taskId)=>wrap({type:'LLM_CONTROL_OPERATION',operationId,documentBinding,taskId,command:'cancel'})};
      const T=root.BrevessLocalTranslator;if(!T){notice('翻译组件尚未载入。');return;}
      provider=T.createTaskProvider({taskId:'full_text_translation',localProvider:T.createProvider(),bridge,captureIdentity:()=>binding,isCurrent:()=>viewKey===`${target.id}:${target.revision}`});
      translationJobs.set(target.key,{provider});notice('正在检查当前原文翻译配置…');
        const available=await provider.availability(),signature=provider.getState().engineSignature;
        const paper=(await store.get(target.id)).revisions.find(v=>v.number===target.revision)?.articles.find(p=>p.id===target.paper.id),saved=paper?.translations?.[target.part];
        if(saved?.sourceText===target.source&&saved.engineSignature===signature){
          if(hiddenTranslations.has(target.key))hiddenTranslations.delete(target.key);else hiddenTranslations.add(target.key);
          notice('已切换缓存的中文对照。');await refresh(true);return;
        }
        if(available==='unavailable')throw new Error('当前配置为浏览器本地翻译，但本浏览器暂不可用；可在模型设置中选择原文翻译服务。');
        await provider.initialize();notice('正在翻译所指向的'+(target.part==='title'?'标题':'摘要')+'…');
        const translatedText=await provider.translate(target.source,{sourceKey:`radar:${target.part}`});
        await store.transact(state=>{const p=store.find(state,target.id).revisions.find(v=>v.number===target.revision)?.articles.find(p=>p.id===target.paper.id);
          if(!p||(target.part==='title'?p.title:R.radarAbstractText(p))!==target.source)throw R.radarError('RADAR_AI_STALE');
          p.translations||={};p.translations[target.part]={sourceText:target.source,translatedText,engineSignature:signature,at:Date.now()};});
        hiddenTranslations.delete(target.key);notice('中文对照已保存。');await refresh(true);
      }catch(e){notice(errorText(e));}finally{provider?.destroy();translationJobs.delete(target.key);}
    }
    const typing=e=>e.target?.closest?.('input,textarea,select,[contenteditable="true"]');
    document.addEventListener('keydown',e=>{if(e.key==='Alt'&&!e.ctrlKey&&!e.metaKey&&!e.shiftKey&&!e.repeat&&!typing(e)){altTarget=hover;if(altTarget)e.preventDefault();}else if(e.key!=='Alt')altTarget=null;});
    document.addEventListener('keyup',e=>{if(e.key==='Alt'){const target=altTarget;altTarget=null;if(target&&hover?.key===target.key&&!e.ctrlKey&&!e.metaKey&&!e.shiftKey&&!typing(e)){e.preventDefault();void translate(target);}}});
    window.addEventListener('blur',()=>{altTarget=null;});
    function editorOpened(query){queryEpoch++;cancelQuery();$('query-need').value=query||'';$('query-candidate').value='';$('query-candidate-area').hidden=true;status('query-ai-status','');}
    function cancelQuery(){if(queryJob){void client.request({type:'RADAR_AI_CANCEL',operationId:queryJob}).catch(()=>{});queryJob=null;}$('generate-query').disabled=false;}
    $('source').addEventListener('change',()=>{queryEpoch++;cancelQuery();$('query-candidate-area').hidden=true;});
    $('editor').addEventListener('close',()=>{queryEpoch++;cancelQuery();});
    $('cancel-query-ai').addEventListener('click',()=>{queryEpoch++;cancelQuery();status('query-ai-status','已停止生成；已完成的候选与人工编辑保留，尚未保存。');});
    $('generate-query').addEventListener('click',async()=>{
      const input=$('query-need').value.trim();if(!input){status('query-ai-status','请填写研究需求或已有检索式。');return;}
      const epoch=++queryEpoch,operationId=op();queryJob=operationId;$('generate-query').disabled=true;status('query-ai-status','正在使用全局默认模型生成候选检索式…');
      try{const route=await client.request({type:'RADAR_AI_ROUTE',kind:'query'});if(epoch!==queryEpoch)return;
        const controller=window.R21RadarQueries,rows=controller?controller.values():[{source:$('source').value,query:$('query').value}],generation=controller?.epoch;let completed=0;const failures=[];
        for(const row of rows){if(epoch!==queryEpoch)return;const requestId=op();queryJob=requestId;status('query-ai-status','正在为 '+R.RADAR_SOURCES[row.source].name+' 生成检索式…');
          try{const result=await client.request({type:'RADAR_AI_QUERY',input,source:row.source,operationId:requestId,expectedEngineSignature:route.engineSignature});if(epoch!==queryEpoch)return;
            if(controller){if(!controller.candidate(row.source,result.query,row.query,generation)){failures.push(R.RADAR_SOURCES[row.source].name+'：输入已变化，保留人工内容');continue;}}
            else {$('query-candidate').value=result.query;$('query-candidate-area').hidden=false;}completed++;
          }catch(error){if(epoch!==queryEpoch)return;failures.push(R.RADAR_SOURCES[row.source].name+'：'+errorText(error));}
        }
        status('query-ai-status','已生成 '+completed+' / '+rows.length+' 个来源检索式；可逐项编辑后保存。'+failures.join('；'));status('query-validation','尚未保存或扫描。');
      }catch(e){if(epoch===queryEpoch)status('query-ai-status',errorText(e));}finally{if(epoch===queryEpoch){queryJob=null;$('generate-query').disabled=false;}}
    });
    $('validate-query').addEventListener('click',async()=>{const query=$('query-candidate').value,epoch=queryEpoch;
      try{R.validateRadarQuery(query);status('query-validation','正在读取 PubMed 解析反馈…');const result=await adapter.previewQuery(query);
        if(epoch!==queryEpoch||query!==$('query-candidate').value)return;
        status('query-validation',`${result.errors.length?'PubMed 错误：'+result.errors.join('；'):`PubMed 命中 ${result.count} 篇。`}${result.warnings.length?' 提示：'+result.warnings.join('；'):''}\n解析：${result.queryTranslation}\n可解析不代表符合研究意图，请人工检查候选。`);
      }catch(e){if(epoch===queryEpoch)status('query-validation',errorText(e));}});
    $('apply-query').addEventListener('click',()=>{try{$('query').value=$('source').value==='pubmed'?R.validateRadarQuery($('query-candidate').value):$('query-candidate').value.trim();$('query').dispatchEvent(new Event('input'));status('query-ai-status','候选已应用到检索框，尚未保存或扫描。');}catch(e){status('query-validation',errorText(e));}});
    $('backfill-abstracts').addEventListener('click',async()=>{
      if(!selected||!revision)return;const id=selected.id,version=revision.number;$('backfill-abstracts').disabled=true;
      try{const result=await service.backfillAbstracts(id,version,{onProgress:p=>notice(`摘要补齐 ${p.completed}/${p.total}，失败 ${p.errors} 篇。`)});notice(`摘要补齐完成：处理 ${result.completed} 篇，失败 ${result.errors} 篇。未改变新增计数。`);}catch(e){notice(errorText(e));}finally{await refresh(true);}
    });
    for(const id of ['score-description','score-start','score-end'])$(id).addEventListener('input',()=>{activeRun=null;updateCount();void refresh(true);});
    $('paper-sort').addEventListener('change',()=>{void rememberView().then(()=>refresh(true));});
    $('score-history').addEventListener('change',()=>{activeRun=$('score-history').value||null;const run=currentRun();if(run){$('score-description').value=run.description;$('score-start').value=run.startDay;$('score-end').value=run.endDay;}void rememberView().then(()=>refresh(true));});
    function scoringControls(busy){for(const id of ['score-description','score-start','score-end','score-history'])$(id).disabled=busy;$('stop-scoring').disabled=!busy;updateCount();}
    function stopScoring(){if(!scoring)return;scoring.stopped=true;if(scoring.operationId)void client.request({type:'RADAR_AI_CANCEL',operationId:scoring.operationId}).catch(()=>{});status('score-status','已请求停止；正在收尾，已完成结果保留。');}
    $('relevance-panel').addEventListener('toggle',async()=>{
      if(!$('relevance-panel').open)return;
      try{const result=await client.request({type:'RADAR_AI_ROUTE',kind:'relevance'});
        status('live-score-route','评分模型 · '+(result.route?.model||result.route?.name||'已就绪'));
      }catch(error){status('live-score-route',error.code==='NO_USABLE_PROFILE'?'需要支持语义判定的模型（TypeSafe JEV）':errorText(error));}
    });
    $('stop-scoring').addEventListener('click',stopScoring);
    $('score-papers').addEventListener('click',async()=>{
      if(scoring||!selected||!revision)return;let spec;try{spec=currentSpec();}catch(e){status('score-status',errorText(e));return;}
      const job={id:selected.id,revision:revision.number,stopped:false,operationId:null};scoring=job;scoringControls(true);
      const candidates=R.radarScoringCandidates(revision.articles,spec);let completed=0,failed=0,cached=0;
      try{const route=await client.request({type:'RADAR_AI_ROUTE',kind:'relevance'});activeRun=await R.radarScoringRunKey(spec,route.engineSignature);await rememberView();status('score-status',`模型：${route.route?.model||route.route?.name||'语义查找配置'} · 逐篇评分中…`);
        for(const paper of candidates){if(job.stopped||viewKey!==`${job.id}:${job.revision}`)break;job.operationId=op();
          try{const receipt=await client.request({type:'RADAR_AI_SCORE',id:job.id,revision:job.revision,pmid:paper.id,description:spec.description,startDay:spec.startDay,endDay:spec.endDay,operationId:job.operationId,expectedEngineSignature:route.engineSignature});
            activeRun=receipt.runKey;if(receipt.result.status==='ready')completed++;if(receipt.cached)cached++;
          }catch(e){if(job.stopped)break;failed++;if(['AUTH_INVALID','QUOTA_EXHAUSTED','RADAR_AI_ROUTE_CHANGED','CAPABILITY_MISMATCH','LLM_NOT_READY','RADAR_AI_UNAVAILABLE'].includes(e.code))throw e;}
          finally{job.operationId=null;}
          if(viewKey===`${job.id}:${job.revision}`){await rememberView();await refresh(true);status('score-status',`已评分 ${completed} 篇 · 复用 ${cached} 篇 · 失败 ${failed} 篇。`);}
        }
        if(viewKey===`${job.id}:${job.revision}`)status('score-status',`${job.stopped?'已停止，可继续':'本轮完成'}：评分 ${completed} 篇，复用 ${cached} 篇，失败 ${failed} 篇。无摘要不计分；分值表示相关性，不是准确率。`);
      }catch(e){if(viewKey===`${job.id}:${job.revision}`)status('score-status',errorText(e));}
      finally{if(scoring===job){scoring=null;scoringControls(false);}await refresh(true);}
    });
    window.addEventListener('pagehide',()=>{cancelQuery();stopScoring();for(const job of translationJobs.values())job.provider.destroy();});
    return {prepare,decorate,compare,scoreFor,editorOpened,isRelevanceSort:()=>$('paper-sort').value==='relevance'};
  }};
})(globalThis);


;/* native/core/literature-radar-trend.js */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;Object.assign(root.BrevessRadar ||= {},api);})(globalThis,()=>{
  'use strict';
  const DAY=86400000,valid=value=>typeof value==='number'&&Number.isFinite(value)&&value>0&&value<=8640000000000000;
  function radarTrend(revision={}) {
    const papers=new Map();
    for(const paper of revision.articles||[]) {
      if(!paper?.id)continue;
      const previous=papers.get(paper.id);
      if(!previous||valid(paper.firstSeenAt)&&(!valid(previous.firstSeenAt)||paper.firstSeenAt<previous.firstSeenAt))papers.set(paper.id,paper);
    }
    const dated=[...papers.values()].filter(p=>valid(p.firstSeenAt)),undated=papers.size-dated.length;
    const timestamps=dated.map(p=>p.firstSeenAt);
    if(valid(revision.baselineAt))timestamps.push(revision.baselineAt);
    if(valid(revision.lastSuccessAt))timestamps.push(revision.lastSuccessAt);
    if(!timestamps.length)return {points:[],total:0,newTotal:0,undated,bucketDays:1};
    const first=Math.floor(timestamps.reduce((a,b)=>Math.min(a,b),Infinity)/DAY),last=Math.floor(timestamps.reduce((a,b)=>Math.max(a,b),0)/DAY);
    const bucketDays=Math.max(1,Math.ceil((last-first+1)/180)),points=Array.from({length:Math.ceil((last-first+1)/bucketDays)},(_,i)=>({
      startDay:new Date((first+i*bucketDays)*DAY).toISOString().slice(0,10),endDay:new Date(Math.min(last,first+(i+1)*bucketDays-1)*DAY).toISOString().slice(0,10),newCount:0,discovered:0,cumulative:0
    }));
    for(const paper of dated){const point=points[Math.floor((Math.floor(paper.firstSeenAt/DAY)-first)/bucketDays)];point.discovered++;if(!paper.isBaseline)point.newCount++;}
    let cumulative=0;for(const point of points){cumulative+=point.discovered;point.cumulative=cumulative;}
    return {points,total:cumulative,newTotal:points.reduce((n,p)=>n+p.newCount,0),undated,bucketDays};
  }
  return {radarTrend};
});


;/* native/literature-radar/trend.js */
(function(root){
  'use strict';
  const NS='http://www.w3.org/2000/svg',R=root.BrevessRadar,T=value=>root.SciLLM?.translateInterfaceText?.(value)||value;
  R.renderRadarTrend=function(container,revision,mode='cumulative'){
    const doc=container.ownerDocument,data=R.radarTrend(revision),key=mode==='new'?'newCount':'cumulative',label=T(mode==='new'?'新增文献':'累计文献');
    const text=(tag,value,className)=>{const node=doc.createElement(tag);node.textContent=value;if(className)node.className=className;return node;};
    container.replaceChildren();container.dataset.mode=mode;container.dataset.total=data.total;container.dataset.newTotal=data.newTotal;
    const compact=data.total===0||data.points.length<=1;container.closest('.radar-trend')?.classList.toggle('trend-compact',compact);
    if(compact){container.append(text('p',T(data.undated?'旧记录缺少首次发现时间，暂无法绘制趋势。':data.total===0?'尚无文献，暂不绘制趋势。':'单个日期暂不绘制趋势。'),'hint'));return;}
    const summary=text('p',`${label} · ${mode==='new'?data.newTotal:data.total} ${T('篇')}`,'trend-summary');container.append(summary);
    if(!data.points.length){container.append(text('p',T(data.undated?'旧记录缺少首次发现时间，暂无法绘制趋势。':'首次检查成功后显示文献趋势。'),'hint'));return;}
    const svg=doc.createElementNS(NS,'svg');svg.setAttribute('viewBox','0 0 760 260');svg.setAttribute('role','img');svg.setAttribute('tabindex','0');svg.setAttribute('aria-label',T('文献发现趋势；左右方向键查看各时间段'));
    const node=(tag,attrs,value)=>{const child=doc.createElementNS(NS,tag);for(const [name,v]of Object.entries(attrs))child.setAttribute(name,String(v));if(value!==undefined)child.textContent=value;svg.append(child);return child;};
    node('title',{},label);const high=Math.max(1,...data.points.map(p=>p[key])),step=Math.max(1,Math.ceil(high/4)),top=step*4;
    const left=55,right=740,bottom=214,y=value=>bottom-value/top*180,x=i=>data.points.length===1?(left+right)/2:left+i/(data.points.length-1)*(right-left);
    for(let i=0;i<=4;i++){const value=i*step;node('line',{x1:left,y1:y(value),x2:right,y2:y(value),class:'trend-grid'});node('text',{x:left-12,y:y(value)+4,'text-anchor':'end',class:'trend-axis'},value);}
    node('text',{x:left,y:16,class:'trend-axis'},T('文献数量（篇）'));
    for(const i of [...new Set([0,Math.floor((data.points.length-1)/2),data.points.length-1])])node('text',{x:x(i),y:237,'text-anchor':i===0&&data.points.length>1?'start':i===data.points.length-1&&data.points.length>1?'end':'middle',class:'trend-axis'},data.points[i].startDay);
    node('text',{x:right,y:257,'text-anchor':'end',class:'trend-axis'},T('首次发现日期（UTC）'));
    const points=data.points.map((p,i)=>`${x(i)},${y(p[key])}`).join(' ');
    if(data.points.length>1)node('polygon',{points:`${left},${bottom} ${points} ${right},${bottom}`,class:'trend-area'});
    node('polyline',{points,class:'trend-line'});
    const cursor=node('line',{y1:28,y2:bottom,class:'trend-cursor'}),dot=node('circle',{r:4,class:'trend-point'});
    const detail=text('output','','trend-detail');detail.setAttribute('aria-live','polite');
    let selected=data.points.length-1;
    const select=index=>{selected=Math.max(0,Math.min(data.points.length-1,index));const point=data.points[selected];cursor.setAttribute('x1',x(selected));cursor.setAttribute('x2',x(selected));dot.setAttribute('cx',x(selected));dot.setAttribute('cy',y(point[key]));detail.textContent=`${point.startDay}${point.endDay!==point.startDay?' — '+point.endDay:''} · ${label} ${point[key]} ${T('篇')}`;};
    svg.addEventListener('pointermove',event=>{const rect=svg.getBoundingClientRect();select(Math.round(((event.clientX-rect.left)*760/rect.width-left)/(right-left)*(data.points.length-1)));});
    svg.addEventListener('keydown',event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();select(event.key==='Home'?0:event.key==='End'?data.points.length-1:selected+(event.key==='ArrowRight'?1:-1));}});
    select(selected);container.append(svg,detail,text('p',T('累计包含首次基线；新增仅计后续首次发现，重复扫描不重复计数。')+(data.bucketDays>1?` ${T('每个点汇总天数：')}${data.bucketDays}`:'')+(data.undated?` ${T('缺少发现时间，未纳入：')}${data.undated}`:''),'hint'));
  };
})(globalThis);


;/* native/literature-radar/source-queries.js */
(function(){'use strict';const R=globalThis.BrevessRadar;
 R.createRadarSourceQueries=function({document:doc,source,query}){
  const box=doc.createElement('section');box.className='radar-source-queries';const heading=doc.createElement('strong');heading.textContent='选择文献来源';const choices=doc.createElement('div');choices.className='radar-source-choices';const fields=doc.createElement('div');box.append(heading,choices,fields);source.before(box);
  let selected=new Set(['pubmed']),drafts=new Map(),epoch=0;
  source.hidden=true;query.hidden=true;query.required=false;doc.querySelector('label[for=source]').hidden=true;doc.querySelector('label[for=query]').hidden=true;doc.getElementById('source-hint').hidden=true;doc.getElementById('preview-query').parentElement.hidden=true;
  const values=()=>[...selected].map(id=>({source:id,query:drafts.get(id)||''}));
  function sync(){const first=values()[0];if(first){source.value=first.source;query.value=first.query;}query.dispatchEvent(new Event('input'));}
  function render(){choices.replaceChildren();fields.replaceChildren();for(const [id,def]of Object.entries(R.RADAR_SOURCES)){
    const label=doc.createElement('label'),check=doc.createElement('input');check.type='checkbox';check.value=id;check.checked=selected.has(id);check.dataset.radarSource=id;label.append(check,def.name);choices.append(label);
    check.onchange=()=>{if(check.checked)selected.add(id);else selected.delete(id);epoch++;render();source.dispatchEvent(new Event('change'));};
   }
   for(const id of selected){const def=R.RADAR_SOURCES[id],row=doc.createElement('label');row.className='radar-source-query';row.append(def.name+' · 独立检索式');const input=doc.createElement('textarea');input.rows=3;input.maxLength=4000;input.required=true;input.spellcheck=false;input.dataset.sourceQuery=id;input.setAttribute('aria-label',def.name+' 检索式');input.placeholder=def.example;input.value=drafts.get(id)||'';input.oninput=()=>{drafts.set(id,input.value);sync();};row.append(input);
    const hint=doc.createElement('small');hint.textContent=['biorxiv','medrxiv'].includes(id)?'通过 Europe PMC 预印本索引；使用 TITLE_ABS 与布尔检索。':def.credential?'需在“来源连接”配置 API 授权。':id==='crossref'||id==='asta'?'使用普通关键词。':'使用该来源的检索语法。';hint.textContent+=' 日期口径：'+def.date;row.append(hint);const link=doc.createElement('a');link.textContent='来源语法与能力 ↗';link.href=def.help;link.target='_blank';link.rel='noopener noreferrer';row.append(link);fields.append(row);
   }sync();
  }
  render();return {values,get epoch(){return epoch;},reset(radar){epoch++;const rows=radar?R.radarSourceQueries(radar):[{source:'pubmed',query:''}];selected=new Set(rows.map(r=>r.source));drafts=new Map(rows.map(r=>[r.source,r.query]));render();},candidate(id,value,previous,generation){if(epoch!==generation||!selected.has(id)||drafts.get(id)!==previous&&!(drafts.get(id)===undefined&&previous===''))return false;drafts.set(id,value);const input=fields.querySelector('[data-source-query="'+id+'"]');if(input)input.value=value;sync();return true;}};
 };
})();


;/* native-workbench-store.js */
/* Keep website examples entirely in memory, using production model validation. */
(() => {
 const s=window.SciLLM, demo=window.__websiteDemo, d=window.BV_DEMO_DATA;
 if(s?.createMemoryResearchWorkbenchBackend){const create=s.createResearchWorkbenchStore;const backend=s.createMemoryResearchWorkbenchBackend();s.createResearchWorkbenchStore=options=>create({...options,backend});}
 if(window.BrevessLibraryAttachments){BrevessLibraryAttachments.createLibraryAttachmentStore=()=>({load:async()=>null,verify:async()=>({available:false}),close:async()=>{},save:async()=>{throw Error('请在已安装的插件中导入自己的文件。');}});}
 if(window.BrevessLibraryCatalog){const C=BrevessLibraryCatalog;let catalog=C.createEmptyLibraryCatalog();C.createLibraryCatalogStore=()=>({read:async()=>structuredClone(catalog),execute:async req=>{const update=C.applyLibraryCatalogCommand(catalog,req);catalog=update.catalog;return update.result;},close:async()=>{},restoreBackup:async()=>{throw Error('官网体验不导入私人备份；请在已安装插件中使用。');}});}
 if(window.BrevessWorkbenchLibraryImport){let entries=[];BrevessWorkbenchLibraryImport.createLibraryImportStore=()=>({readAll:async()=>structuredClone(entries),replace:async x=>{entries=structuredClone(x);return entries;},clear:async()=>{entries=[];}});}
 if(window.BrevessRadar?.createMemoryRadarBackend){
   const create=BrevessRadar.createRadarStore, at=Date.parse('2021-07-16T08:00:00Z');
   const initial={schema:1,active:null,radars:[{id:'radar-alphafold-example',name:BV_I18N.text('蛋白质结构预测',parent.document.documentElement.lang),query:'AlphaFold AND protein structure',source:'pubmed',intervalHours:0,baselineDays:30,enabled:false,editVersion:1,createdAt:at,updatedAt:at,revisions:[{number:1,query:'AlphaFold AND protein structure',baselineDays:30,createdAt:at,windowStart:'2021-06-17',baselineAt:at,lastSuccessAt:at,lastAttemptAt:at,nextRetryAt:null,lastNewCount:1,warnings:[],error:null,queryTranslation:'AlphaFold AND protein structure',articles:[{id:'34265844',title:d.title,authors:['John Jumper','Richard Evans','Alexander Pritzel'],journal:'Nature',doi:'10.1038/s41586-021-03819-2',url:d.source,publicationDate:'2021-07-15',createdDay:'2021-07-15',firstSeenAt:at,isBaseline:false,read:false,abstract:d.paragraphs[0].text,abstractStatus:'ready'}]}]}]};
   const backend=BrevessRadar.createMemoryRadarBackend(initial);BrevessRadar.createRadarStore=options=>create({...options,backend});
 }
})();


;/* native/literature-radar/app.js */
(() => {
  'use strict';

  globalThis.SciLLM?.registerInterfaceTranslations?.({
    '基线起始日期':'Baseline start date','按发表日期纳入，留空包括全部年份。':'Include papers by publication date. Leave blank for all years.',
    '年度文献分布':'Publications by year','检索年度分布':'Search by publication year','取消检索':'Cancel search','选择年份可设置基线起点。':'Select a year to set the baseline start.',
    '正在检索年度分布…':'Searching publication years…','请先填写所选来源的检索式。':'Enter a query for each selected source.',
    '无匹配文献':'No matching publications','篇':'papers','全部年份':'All years','首次基线':'Initial baseline',
    '补充历史基线':'Add historical baseline','追加历史基线':'Add historical baseline','历史基线已补充。':'Historical baseline added.',
    '从（含当日）':'From (inclusive)','至（含当日）':'To (inclusive)',
    '只追加所选日期内的基线文献，不计为新增。已有文献、已读状态和当前增量检查进度保持不变。':'Append baseline papers within these dates. Existing papers, read states and incremental progress are preserved.',
    '完整检索成功后才保存；超过5,000篇、超时或分页失败均不保存本次结果。可缩小日期范围分次补充。':'Save only after a complete search. More than 5,000 results, timeouts or incomplete pages leave existing data unchanged. Narrow the dates to backfill in batches.',
    '正在检索历史基线…':'Searching historical baseline…','检索完成 · 本窗口无匹配文献':'Search complete · no matches in this window',
    '当前窗口无匹配。可补充更早的历史基线，或编辑检索式与回溯范围。':'No matches in the current window. Add an earlier historical baseline, or edit the query and lookback period.',
    '初始窗口无匹配 · 已补充历史基线':'No matches in the initial window · historical baseline added',
    '首次窗口内无匹配文献。':'No papers matched the initial window.','单个日期暂不绘制趋势。':'A trend needs more than one date.',
    '尚无文献，暂不绘制趋势。':'No papers yet; no trend to plot.','最近检查':'Last check','运行条件':'Runtime conditions',
    '补充后本版本将超过 5,000 篇分享上限，本次未保存。请缩小历史日期范围。':'This version would exceed the 5,000-paper export limit. No changes were saved. Narrow the historical date range.',
    '检索式发送给所选来源；任务和结果保存在本机。首次结果为基线，后续首次发现的匹配记录计为新增。每次向前重叠 7 天去重检查；超出 5,000 篇或分页不完整时保留原进度。':'Queries are sent to the selected source; tasks and results stay on this device. Initial results are baseline papers; later discoveries count as new. Checks overlap by 7 days and deduplicate. More than 5,000 results or incomplete pages leave progress unchanged.',
    '确认检索并追加':'Search and append','历史基线范围':'Historical baseline range',
    '该日期范围无匹配，原有文献保留。':'No matches in these dates; existing papers were preserved.',
    '通过 Europe PMC 预印本索引检索。':'Searches the Europe PMC preprint index.'
  },[
    [/^最近历史补充：(\d{4}-\d{2}-\d{2}) — (\d{4}-\d{2}-\d{2}) · 匹配 (\d+) 篇，追加 (\d+) 篇。$/u,m=>'Last historical backfill: '+m[1]+' — '+m[2]+' · '+m[3]+' matched, '+m[4]+' added.'],
    [/^本窗口：(\d{4}-\d{2}-\d{2}) — (\d{4}-\d{2}-\d{2}) · (.+)$/u,m=>'Current window: '+m[1]+' — '+m[2]+' · '+m[3]],
    [/^实际检索式：(.+)$/u,m=>'Effective query: '+m[1]]
  ]);
  const R = globalThis.BrevessRadar, $ = id => document.getElementById(id), T=value=>globalThis.SciLLM?.translateInterfaceText?.(value)||value;
  const store = R.createRadarStore(), adapters=R.createRadarAdapters(), adapter=adapters.pubmed, service = R.createRadarService({ store, adapters });
  for(const [id,source] of Object.entries(R.RADAR_SOURCES))$('source').append(new Option(source.name+(source.preprint?' · '+T('预印本'):source.credential?' · API Key':''),id));
  let enrichment;
  let state, selected = null, revisionNumber = null, filter = 'new', limit = 40, editing = null, lastRender = '', background = false;
  let batch=null,trendMode='cumulative';
  const sourceQueries=window.R21RadarQueries=R.createRadarSourceQueries({document,source:$('source'),query:$('query')});
  if(window.self!==window.top){document.body.classList.add('radar-embedded');document.querySelector('.section-label').append($('new-radar'));}
  const text = (id, value) => { $(id).textContent = value; };
  const dateTime = at => at ? new Date(at).toLocaleString(globalThis.SciLLM?.getInterfaceLanguage?.() || 'zh-CN', { hour12: false }) : '尚未检查';
  const element = (tag, className, value) => {
    const node = document.createElement(tag); if (className) node.className = className;
    if (value !== undefined) node.textContent = value; return node;
  };
  const notice = message => text('notice', message);
  const current = () => state?.radars.find(r => r.id === selected);
  async function refresh(force = false) {
    state = await store.read();
    if (!state.radars.some(r => r.id === selected)) selected = state.radars[0]?.id || null;
    const fingerprint = JSON.stringify([state, selected, revisionNumber, filter, limit, $('unread-only').checked, state.active?.expiresAt > Date.now()]);
    if (!force && fingerprint === lastRender) return;
    lastRender = fingerprint; render();
  }
  function render() {
    $('check-all').disabled=!!batch||!!(state.active?.expiresAt>Date.now())||!state.radars.length;
    $('cancel-check-all').hidden=!batch;
    text('radar-count', String(state.radars.length).padStart(2, '0'));
    const list = $('radar-list'); list.replaceChildren();
    if (!state.radars.length) list.append(element('p', 'muted', '还没有追踪任务。'));
    for (const radar of state.radars) {
      const unread = R.radarUnreadCount(radar);
      const button = element('button', 'tracker'); button.type = 'button'; button.setAttribute('aria-pressed', String(radar.id === selected));
      const radarName = element('strong', '', radar.name); radarName.setAttribute('translate', 'no');
      button.append(radarName, element('small', unread ? 'tracker-new' : '', `${unread ? unread+' 篇未读新增 · ' : ''}${!radar.enabled ? '已暂停' : radar.intervalHours ? '每 ' + radar.intervalHours + ' 小时' : '仅手动'}`));
      if(unread){const badge=element('span','tracker-count',String(unread));badge.setAttribute('translate','no');badge.setAttribute('aria-label',T('未读新增')+' '+unread);badge.title=T('未读新增')+' '+unread;button.append(badge);}
      button.addEventListener('click', () => { selected = radar.id; revisionNumber = null; limit = 40; void safe(() => refresh(true)); }); list.append(button);
    }
    const radar = current(); $('empty').hidden = !!radar; $('radar-detail').hidden = !radar;
    if (!radar) return;
    const latest = R.radarRevision(radar), revision = radar.revisions.find(v => v.number === revisionNumber) || latest;
    revisionNumber = revision.number;
    R.renderRadarTrend($('radar-trend-chart'),revision,trendMode);
    enrichment?.prepare(radar, revision, state);
    const active = state.active?.expiresAt > Date.now(), mine = active && state.active.id === radar.id;
    const sourceRows=R.radarSourceQueries(revision.sourceQueries?revision:{source:radar.source,query:revision.query});text('source-label',sourceRows.map(row=>R.RADAR_SOURCES[row.source].name).join(' · '));$('pubmed-method').hidden=!sourceRows.some(r=>r.source==='pubmed');text('source-method',sourceRows.map(r=>R.RADAR_SOURCES[r.source].name+'：'+sourceHint(r.source)).join('\n'));
    const statuses=$('source-status');statuses.replaceChildren();statuses.hidden=!revision.sourceQueries;for(const row of sourceRows){const st=revision.sourceStates?.[row.source];statuses.append(element('li','',R.RADAR_SOURCES[row.source].name+' · '+(mine&&state.active.source===row.source?'正在检查':st?.error?'失败：'+st.error.message:st?.lastSuccessAt?'已完成 · '+dateTime(st.lastSuccessAt):'尚未检查')));}
    text('radar-name', radar.name); text('query-preview', revision.sourceQueries?revision.sourceQueries.map(row=>R.RADAR_SOURCES[row.source].name+': '+row.query).join('\n'):revision.query);
    $('radar-name').setAttribute('translate', 'no'); $('query-preview').setAttribute('translate', 'no');
    const history=Array.isArray(revision.baselineHistory)?revision.baselineHistory:[],lastHistory=history.at(-1);
    text('scan-state', mine ? '正在检查来源…' : latest.error ? (latest.error.code==='RADAR_PARTIAL_FAILURE'?'部分来源失败 · 已成功的结果保留':'最近检查失败 · 原进度已保留') : !latest.baselineAt ? '待建立首次基线' : !latest.articles.length ? T('检索完成 · 本窗口无匹配文献') : '已建立基线 · 持续追踪新增');
    const pubmedQuery=sourceRows.find(row=>row.source==='pubmed')?.query;
    const historyLink=$('pubmed-history-link');historyLink.hidden=!pubmedQuery;
    if(pubmedQuery){
      const href='https://pubmed.ncbi.nlm.nih.gov/?term='+encodeURIComponent(pubmedQuery);
      if(historyLink.href!==href){const next=historyLink.cloneNode(true);next.href=href;historyLink.replaceWith(next);}
    }
    $('history-baseline').hidden=!!revision.sourceQueries||!['biorxiv','medrxiv','europepmc'].includes(radar.source)||revision!==latest;
    $('history-baseline').disabled=!!active||!!batch||!latest.baselineAt||latest.windowStart==='0001-01-01';
    $('baseline-history').hidden=!lastHistory;
    text('baseline-history',lastHistory?T(`最近历史补充：${lastHistory.startDay} — ${lastHistory.endDay} · 匹配 ${lastHistory.matched} 篇，追加 ${lastHistory.added} 篇。`):'');
    text('toggle-radar', radar.enabled ? '暂停自动检查' : '启用自动检查');
    $('check-radar').disabled = !!active||!!batch; text('check-radar', mine ? '检查中…' : '立即检查');
    text('last-success', dateTime(latest.lastSuccessAt)); text('last-attempt', dateTime(latest.lastAttemptAt));
    const sameAttempt=latest.lastSuccessAt===latest.lastAttemptAt&&!latest.error;
    $('last-attempt').parentElement.hidden=sameAttempt;
    $('last-success').previousElementSibling.textContent=T(sameAttempt?'最近检查':'最近成功检查');
    text('interval', !radar.enabled ? '已暂停（可手动检查）' : radar.intervalHours ? `每 ${radar.intervalHours} 小时` : '仅手动');
    text('scan-window', revision.lastWindow ? T(`${radar.source==='asta'?'上次检索发表日期：':'上次成功覆盖：'}${revision.lastWindow.startDay==='0001-01-01'?T('全部年份'):revision.lastWindow.startDay} — ${revision.lastWindow.endDay}（含去重重叠窗口）`) : Object.hasOwn(revision,'baselineStartDay') ? T('首次基线')+' · '+(revision.baselineStartDay||T('全部年份')) : `首次回溯 ${revision.baselineDays} 天；检查成功后开始累计新增。`);
    $('scan-error').hidden = !latest.error;
    text('scan-error', latest.error ? `${latest.error.message} 最近成功时间：${dateTime(latest.lastSuccessAt)}。可手动重试。` : '');
    const translated=revision.queryTranslation&&revision.queryTranslation.trim()!==revision.query.trim();
    $('query-translation').hidden=!translated;text('query-translation',translated?T('实际检索式：'+revision.queryTranslation):'');
    const warnings=[...new Set(revision.warnings)];$('query-warnings').hidden=!warnings.length;
    text('query-warnings',warnings.length?'来源提示：'+warnings.join('；'):'');
    const selector = $('revision'); selector.replaceChildren();
    for (const v of [...radar.revisions].reverse()) { const option = element('option', '', `版本 ${v.number}${v === latest ? ' · 当前' : ' · 历史'}`); option.value = v.number; selector.append(option); }
    selector.value = revision.number;
    text('count-new', revision.articles.filter(p => !p.isBaseline).length); text('count-baseline', revision.articles.filter(p => p.isBaseline).length); text('count-all', revision.articles.length);
    for (const button of document.querySelectorAll('[data-filter]')) button.setAttribute('aria-pressed', String(button.dataset.filter === filter));
    const articles = revision.articles.filter(p => (filter === 'all' || (filter === 'baseline') === p.isBaseline) && (!$('unread-only').checked || !p.read))
      .sort(enrichment.compare);
    text('feed-description', `${articles.length} 篇 · ${enrichment.isRelevanceSort() ? '相关性从高到低 · 并列按时间' : '时间由新到旧'}${revision !== latest ? ' · 历史检索版本' : ''}`);
    const feed = $('paper-list'); feed.replaceChildren(); let previousDay;
    if (!articles.length) feed.append(element('p', 'feed-empty', !revision.baselineAt ? '首次检查后，基线文献将出现在这里。' : !revision.articles.length ? T('当前窗口无匹配。可补充更早的历史基线，或编辑检索式与回溯范围。') : filter === 'new' ? '尚无新增文献。首次结果可在“基线”中查看。' : '当前筛选下没有文献。'));
    for (const paper of articles.slice(0, limit)) {
      const day = paper.createdDay || R.radarDay(paper.firstSeenAt);
      if (!enrichment.isRelevanceSort() && day !== previousDay) { feed.append(element('div', 'date-divider', `${day} / ${paper.createdDay ? R.RADAR_SOURCES[(paper.source||radar.source)].date : T('首次发现')}`)); previousDay = day; }
      const article = element('article', 'paper');
      const label = element('div', 'paper-label'); label.append(element('span', 'badge' + (!paper.isBaseline && !paper.read ? ' badge-new' : ''), paper.isBaseline ? '基线' : paper.read ? '新增 · 已读' : '新增 · 未读'), element('span', '', (paper.source||radar.source)==='pubmed'?`PMID ${paper.id}`:R.RADAR_SOURCES[(paper.source||radar.source)].name));
      const title = element('h3'), link = element('a', '', paper.title || '未提供标题');
      if (paper.title) title.setAttribute('translate', 'no');
      link.href = R.radarPaperUrl((paper.source||radar.source),paper); link.target = '_blank'; link.rel = 'noopener noreferrer'; title.append(link);
      if(R.isRadarPreprint(paper,paper.source||radar.source))label.append(element('span','badge preprint','预印本 · 请核对评审状态'));
      const heading = element('div', 'paper-heading'), publication = element('div', 'paper-publication');
      publication.setAttribute('translate', 'no');
      if (paper.journal) publication.append(element('strong', '', paper.journal));
      if (paper.publicationDate) { const date = element('span', '', paper.publicationDate); date.title = '来源提供的发表日期'; publication.append(date); }
      heading.append(label, publication); article.append(heading, title);
      if (paper.authors?.length) article.append(element('p', '', paper.authors.slice(0, 5).join(', ') + (paper.authors.length > 5 ? ' et al.' : '')));
      const footer = element('div', 'paper-footer'), links = element('div', 'links'), open = element('a', '', R.RADAR_SOURCES[(paper.source||radar.source)].name+' ↗');
      open.href = link.href; open.target = '_blank'; open.rel = 'noopener noreferrer'; links.append(open);
      for(const related of new Map([paper,...(paper.sourceRecords||[])].flatMap(r=>r.relatedPublications||[]).map(r=>[r.source+':'+r.id,r])).values()){const href=R.radarPaperUrl(related.source,related);if(!href)continue;const a=element('a','',related.relation==='Preprint of'?'关联正式版 ↗':related.relation+' ↗');a.href=href;a.target='_blank';a.rel='noopener noreferrer';links.append(a);}
      for(const record of paper.sourceRecords||[]){if(record.source===(paper.source||radar.source)&&record.id===paper.id)continue;const href=R.radarPaperUrl(record.source,record);if(!href)continue;const more=element('a','',R.RADAR_SOURCES[record.source].name+(record.version?' v'+record.version:'')+' ↗');more.href=href;more.target='_blank';more.rel='noopener noreferrer';links.append(more);}
      if(paper.sourceRecords?.length>1)label.append(element('span','badge','已合并 '+paper.sourceRecords.length+' 条来源记录（DOI/PMID）'));
      if (paper.doi) { const doi = element('a', '', 'DOI ↗'); doi.href = 'https://doi.org/' + encodeURIComponent(paper.doi); doi.target = '_blank'; doi.rel = 'noopener noreferrer'; links.append(doi); }
      const read = element('button', '', paper.read ? '标为未读' : '标为已读'); read.type = 'button';
      read.addEventListener('click', () => safe(async () => { await store.markRead(radar.id, revision.number, [paper.id], !paper.read); await refresh(true); }));
      if(window.parent!==window && typeof window.parent.BrevessProjectReadingQueue?.add==='function'){
        const add=element('button','','加入课题待读');add.type='button';
        add.addEventListener('click',()=>safe(async()=>{
          add.disabled=true;
          try{const name=await window.parent.BrevessProjectReadingQueue.add(radar.id,revision.number,paper.id,enrichment.scoreFor(paper)?.score);
            notice('已加入「'+name+'」的课题待读');add.textContent='已加入课题';}
          finally{add.disabled=false;}
        }));
        links.append(add);
      }
      footer.append(links, read); article.append(footer); enrichment.decorate(article, paper); feed.append(article);
    }
    $('load-more').hidden = articles.length <= limit;
  }
  async function safe(fn) { try { return await fn(); } catch (error) { notice(error.message || '操作失败，请重试。'); } }
  let initialBaseline='', yearSearch=null;
  function resetYears(){
    yearSearch?.abort();yearSearch=null;
    $('preview-years').textContent=T('检索年度分布');
    $('years-results').replaceChildren();text('years-status','');
  }
  function renderYearChart(target,counts) {
    if(!Array.isArray(counts)||counts.some(([y,n])=>!Number.isInteger(y)||y<1||y>9999||!Number.isSafeInteger(n)||n<0))throw Error(T('来源返回的数据不完整'));
    const years=new Map(counts.filter(([,n])=>n>0).sort((a,b)=>a[0]-b[0]));
    if(!years.size){target.append(element('p','hint',T('无匹配文献')));return;}
    const first=years.keys().next().value,last=[...years.keys()].at(-1),max=Math.max(...years.values());
    const plot=element('div','year-plot'),detail=element('output','year-readout',T('选择年份可设置基线起点。'));
    for(let year=first;year<=last;year++){
      const count=years.get(year)||0,bar=element('button','year-bar');
      bar.type='button';bar.dataset.year=year;
      const date=String(year).padStart(4,'0')+'-01-01',label=year+' · '+count.toLocaleString()+' '+T('篇');
      bar.title=label;bar.setAttribute('aria-label',label);
      const fill=element('span','year-fill');fill.style.height=(count/max*100)+'%';bar.append(fill);
      const inspect=()=>{detail.textContent=label;};bar.onfocus=inspect;bar.onpointerenter=inspect;
      bar.disabled=date>$('baseline').max;
      bar.onclick=()=>{$('baseline').value=date;$('baseline').dispatchEvent(new Event('input'));inspect();};
      plot.append(bar);
    }
    const axis=element('div','year-axis');axis.append(element('span','',String(first)),element('span','',String(last)));
    target.append(plot,axis,detail);
  }
  $('preview-years').addEventListener('click',async()=>{
    if(yearSearch){resetYears();return;}
    resetYears();let rows;
    try{rows=R.validateRadarSourceQueries(sourceQueries.values());}catch{ text('years-status',T('请先填写所选来源的检索式。'));return; }
    const controller=new AbortController();yearSearch=controller;
    $('preview-years').textContent=T('取消检索');text('years-status',T('正在检索年度分布…'));
    const jobs=rows.map(async({source,query})=>{
      const group=element('section','year-source');group.append(element('strong','',R.RADAR_SOURCES[source].name));$('years-results').append(group);
      try{
        const counts=await adapters[source].publicationYears(query,{signal:controller.signal});
        if(yearSearch===controller)renderYearChart(group,counts);
      }catch(e){if(yearSearch===controller)group.append(element('p','hint',e.message));}
    });
    await Promise.all(jobs);
    if(yearSearch===controller){yearSearch=null;text('preview-years',T('检索年度分布'));text('years-status','');}
  });
  $('query').addEventListener('input',resetYears);
  $('editor').addEventListener('close',resetYears);
  function edit(radar) {
    editing = radar ? structuredClone(radar) : null;
    text('editor-title', radar ? '编辑文献追踪任务' : '新建文献追踪任务');
    $('name').value = radar?.name || ''; $('query').value = radar?.query || '';
    $('source').value=radar?.source||'pubmed';$('source').disabled=false;sourceQueries.reset(radar);enrichment.editorOpened(radar?.query || '');updateSource();
    $('frequency').value = radar?.intervalHours ?? 24;
    const latest=radar&&R.radarRevision(radar);
    const legacyDate=latest&&!Object.hasOwn(latest,'baselineStartDay')&&(latest.windowStart||R.radarScanWindow(R.radarBaseline(latest),latest.createdAt||radar.createdAt||Date.now()).startDay);
    initialBaseline=radar?.baselineStartDay??legacyDate??'';
    $('baseline').max=R.radarDay(Date.now());$('baseline').value=initialBaseline; $('enabled').checked = radar?.enabled ?? true;
    text('edit-note', radar ? '修改检索式或回溯范围后，会建立新的基线版本；旧文献记录保留在历史版本中。' : '启用后，在运行条件允许时检查到期任务。');
    text('form-error', ''); preview(); $('editor').showModal(); $('name').focus();
  }
  function sourceHint(id){const def=R.RADAR_SOURCES[id];return T(id==='asta'?'Asta 官方文献检索：输入关键词，按发表日期追踪。不是网页 Deep search；可能含预印本，晚到索引可能漏检。API Key 可在来源连接中配置。':['biorxiv','medrxiv'].includes(id)?'通过 Europe PMC 预印本索引检索。':id==='crossref'?'输入关键词；不使用 PubMed 字段标签或布尔语法。':def.credential?'需要 API Key；可用范围由服务商和机构授权决定。':'使用该来源原生检索语法。')+' '+T('日期口径：')+def.date;}
  function updateSource(){const id=$('source').value,def=R.RADAR_SOURCES[id];$('query').placeholder=def.example;text('source-hint',sourceHint(id));$('validate-query').hidden=id!=='pubmed';preview();}
  function previewPubmed(){
    const query=$('query').value.trim(),isPubmed=$('source').value==='pubmed';
    $('pubmed-check').hidden=!isPubmed;if(!isPubmed)return;
    // Keep the publisher's actual precedence. Only split a top-level operation.
    let depth=0,quoted=false;
    $('boolean-preview').textContent=query.replace(/"|\(|\)|\b(?:AND|OR|NOT)\b/gi,token=>{
      if(token==='"')quoted=!quoted;
      else if(!quoted){if(token==='(')depth++;else if(token===')')depth--;else if(depth===0)return '\n'+token+' ';}
      return token;
    });
    const raw=$('seed-pmids').value.trim(),ids=raw?raw.split(/[\s,，、;；]+/):[];
    const valid=ids.length>0&&ids.length<=20&&ids.every(value=>/^[1-9]\d{0,8}$/.test(value));
    const link=$('seed-preview');link.hidden=!query||!valid;link.removeAttribute('href');
    if(query&&valid)link.href='https://pubmed.ncbi.nlm.nih.gov/?term='+encodeURIComponent('('+query+') AND ('+ids.map(id=>id+'[PMID]').join(' OR ')+')');
    $('seed-error').textContent=raw&&!valid?'请输入最多 20 个数字 PMID。':'';
  }
  $('seed-pmids').addEventListener('input',previewPubmed);
  function preview(){previewPubmed();const id=$('source').value,q=encodeURIComponent($('query').value),urls={asta:'https://asta.allen.ai/',pubmed:'https://pubmed.ncbi.nlm.nih.gov/?term='+q,europepmc:'https://europepmc.org/search?query='+q,biorxiv:'https://europepmc.org/search?query='+encodeURIComponent('('+ $('query').value+') AND SRC:PPR AND PUBLISHER:bioRxiv'),medrxiv:'https://europepmc.org/search?query='+encodeURIComponent('('+ $('query').value+') AND SRC:PPR AND PUBLISHER:medRxiv'),arxiv:'https://arxiv.org/search/?query='+q+'&searchtype=all',crossref:'https://search.crossref.org/?q='+q,wos:'https://www.webofscience.com/wos/woscc/advanced-search',scopus:'https://www.scopus.com/search/form.uri?display=advanced'};$('preview-query').href=urls[id];text('preview-query',id==='asta'?'打开 Asta 网页 ↗':'打开来源检索 ↗');}
  $('source').addEventListener('change',updateSource);
  async function connectionState(){const id=$('connection-source').value,connection=await R.loadRadarConnection(id);if(id!==$('connection-source').value)return;text('connection-state',connection.apiKey?'本机已配置；填写新值可替换。':id==='asta'?'尚未配置 Asta Key；将尝试匿名访问，访问范围和限流由来源决定。':'尚未配置');$('connection-help').href=R.RADAR_SOURCES[id].help;$('institution-token').hidden=id!=='scopus';$('connection-key').value='';$('connection-token').value='';text('connection-message','');}
  $('connections').addEventListener('click',()=>safe(async()=>{await connectionState();$('connections-dialog').showModal();}));
  $('close-connections').addEventListener('click',()=>$('connections-dialog').close());
  $('connections-dialog').addEventListener('close',()=>{$('connection-key').value='';$('connection-token').value='';});
  $('connection-source').addEventListener('change',()=>safe(connectionState));
  $('connection-form').addEventListener('submit',async event=>{event.preventDefault();const id=$('connection-source').value;try{await R.saveRadarConnection(id,{apiKey:$('connection-key').value,instToken:$('connection-token').value});await connectionState();text('connection-message','连接已保存；请立即检查雷达以验证来源授权。');}catch(error){text('connection-message',error.message);}});
  $('remove-connection').addEventListener('click',()=>safe(async()=>{await R.removeRadarConnection($('connection-source').value);await connectionState();}));
  $('new-radar').addEventListener('click', () => edit(null)); $('edit-radar').addEventListener('click', () => edit(current()));
  for (const id of ['close-editor', 'cancel-editor']) $(id).addEventListener('click', () => $('editor').close());
  $('query').addEventListener('input', preview);
  $('radar-form').addEventListener('submit', async event => {
    event.preventDefault();
    try {
      const radar = await store.save({ id: editing?.id, name: $('name').value, ...(editing&&!editing.sourceQueries&&sourceQueries.values().length===1&&sourceQueries.values()[0].source===editing.source?{}:{sourceQueries:sourceQueries.values()}), query:sourceQueries.values()[0]?.query||'', source:editing?.source||sourceQueries.values()[0]?.source||'pubmed', intervalHours: Number($('frequency').value), ...(editing&&!Object.hasOwn(editing,'baselineStartDay')&&$('baseline').value===initialBaseline?R.radarBaseline(editing):{baselineStartDay:$('baseline').value}), enabled: $('enabled').checked }, editing?.editVersion);
      selected = radar.id; revisionNumber = null; filter = 'new'; limit = 40; $('editor').close(); notice('追踪任务已保存。'); await refresh(true); void tick();
    } catch (error) { text('form-error', error.message); }
  });
  $('check-radar').addEventListener('click', () => safe(async () => {
    const id = selected; notice('正在从所选来源检索，请稍候…');
    const pending = service.check(id); setTimeout(() => safe(() => refresh()), 50);
    try {
      const result = await pending;
      if (selected === id) { revisionNumber = null; filter = result.baseline ? 'baseline' : 'new'; limit = 40; }
      notice('');
    } finally { await refresh(true); }
  }));

  let historyTarget=null,historyPending=false;
  const historyStartFor=source=>source==='biorxiv'?'2013-01-01':source==='medrxiv'?'2019-01-01':'1900-01-01';
  $('history-baseline').addEventListener('click',()=>safe(async()=>{
    const radar=current(),revision=R.radarRevision(radar);
    if(!revision.baselineAt||revision.windowStart==='0001-01-01')return;
    const initialStart=revision.windowStart||R.radarScanWindow(R.radarBaseline(revision),revision.baselineAt).startDay;
    historyTarget={id:radar.id,version:revision.number};
    text('history-query',R.RADAR_SOURCES[radar.source].name+' · '+revision.query);
    text('history-date-basis',T('日期口径：')+R.RADAR_SOURCES[radar.source].date);
    $('history-start').value=historyStartFor(radar.source);
    $('history-end').value=new Date(Date.parse(initialStart)-R.DAY).toISOString().slice(0,10);
    $('history-end').max=$('history-end').value;text('history-error','');$('history-dialog').showModal();$('history-start').focus();
  }));
  for(const id of ['close-history','cancel-history'])$(id).addEventListener('click',()=>{if(!historyPending)$('history-dialog').close();});
  $('history-dialog').addEventListener('cancel',event=>{if(historyPending)event.preventDefault();});
  $('history-form').addEventListener('submit',async event=>{
    event.preventDefault();if(historyPending||!historyTarget)return;
    historyPending=true;for(const id of ['confirm-history','close-history','cancel-history','history-start','history-end'])$(id).disabled=true;
    text('history-error',T('正在检索历史基线…'));
    try {
      const result=await service.backfillBaseline(historyTarget.id,historyTarget.version,{startDay:$('history-start').value,endDay:$('history-end').value});
      if(selected===historyTarget.id){filter='baseline';revisionNumber=null;limit=40;}
      notice('');$('history-dialog').close();
      text('history-error','');
    } catch(error){text('history-error',T(error.message||'操作失败，请重试。'));}
    finally{historyPending=false;for(const id of ['confirm-history','close-history','cancel-history','history-start','history-end'])$(id).disabled=false;await refresh(true);}
  });
  $('check-all').addEventListener('click',()=>safe(async()=>{
    if(batch)return;batch=new AbortController();text('batch-status',T('批量检查进度')+' 0/'+state.radars.length);$('batch-results').hidden=true;await refresh(true);
    try{
      const result=await service.checkAll({signal:batch.signal,onProgress:async p=>{
        text('batch-status',T(`批量检查进度 ${p.completed}/${p.total}${p.current?' · '+p.current.name:''}`));await refresh(true);
      }});
      const failed=result.results.filter(r=>r.error||r.partial),success=result.results.length-failed.length,newCount=result.results.reduce((n,r)=>n+(r.newCount||0),0);
      text('batch-status',T(`${result.cancelled?'批量检查已停止':'批量检查完成'} · 成功 ${success}/${result.total} · 失败 ${failed.length} · 新增 ${newCount}`));
      const failures=$('batch-failures');failures.replaceChildren();
      for(const item of failed)failures.append(element('li','',item.name+'：'+(item.error?.message||item.sources.filter(s=>!s.success).map(s=>R.RADAR_SOURCES[s.source].name+'：'+s.error.message).join('；'))));
      $('batch-results').hidden=!failed.length;
    }finally{batch=null;await refresh(true);}
  }));
  $('cancel-check-all').addEventListener('click',()=>{batch?.abort();});
  $('toggle-radar').addEventListener('click', () => safe(async () => {
    const radar = current(); await store.save({ ...radar, enabled: !radar.enabled }, radar.editVersion); await refresh(true); void tick();
  }));
  for (const button of document.querySelectorAll('[data-filter]')) button.addEventListener('click', () => { filter = button.dataset.filter; limit = 40; void safe(() => refresh(true)); });
  $('revision').addEventListener('change', () => { revisionNumber = Number($('revision').value); limit = 40; void safe(() => refresh(true)); });
  for(const button of document.querySelectorAll('[data-trend-mode]'))button.addEventListener('click',()=>{
    trendMode=button.dataset.trendMode;for(const item of document.querySelectorAll('[data-trend-mode]'))item.setAttribute('aria-pressed',String(item===button));
    const radar=current();if(radar)R.renderRadarTrend($('radar-trend-chart'),radar.revisions.find(v=>v.number===revisionNumber)||R.radarRevision(radar),trendMode);
  });
  $('unread-only').addEventListener('change', () => { limit = 40; void safe(() => refresh(true)); });
  $('load-more').addEventListener('click', () => { limit += 40; void safe(() => refresh(true)); });
  async function tick() {
    await safe(async () => {
      background = false;
      try { background = !!(await globalThis.chrome?.alarms?.get('brevess-literature-radar-tick-v1')); } catch {}
      text('schedule-mode', background ? '后台周期检查已接入。浏览器关闭时暂停，重新激活后补查到期任务。' : '当前为页面内周期检查：工作台或雷达页面需保持打开。后台周期检查尚未接入。');
      if (!background) await service.checkDue();
      await refresh();
    });
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void tick(); });
  window.addEventListener('focus', () => { void tick(); });
  enrichment = window.BrevessRadarUI.create({store, adapter, service, refresh, notice});
  void globalThis.SciLLM?.bootstrapInterfaceLanguage?.();
  globalThis.SciLLM?.onInterfaceLanguageChange?.(() => { if (state) render(); });
  void safe(async () => { await refresh(true); await tick(); });
  setInterval(() => safe(() => refresh()), 2000);
  setInterval(tick, 60000);
})();


;/* native/core/input-tools.js */
(function (root) {
  'use strict';
  if (root.BrevessInputTools) return;
  const editingSelector = 'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="combobox"]';
  function isEditingEvent(event) {
    if (event?.isComposing || event?.keyCode === 229) return true;
    const nodes = [...(event?.composedPath?.() || []), event?.target];
    let active = root.document?.activeElement;
    while (active) { nodes.push(active); active = active.shadowRoot?.activeElement; }
    return nodes.some(node => node?.isContentEditable || node?.closest?.(editingSelector));
  }
  root.BrevessInputTools = { isEditingEvent };
  const doc = root.document;
  if (!doc) return;
  const jobs = new WeakMap();
  let field = null, status = null, sequence = null, provider = null;
  function editable(node) {
    if (!node || node.disabled || node.readOnly) return null;
    if (node.tagName === 'TEXTAREA' || (node.tagName === 'INPUT' && ['text','search','url','tel',''].includes(node.type))) return node;
    if (node.isContentEditable) {
      while (node.parentElement?.isContentEditable) node = node.parentElement;
      return node;
    }
    return null;
  }
  const read = node => 'value' in node ? node.value : node.textContent;
  function paint(message = '') {
    if (!status && message) {
      status = doc.createElement('output'); status.dataset.sciPluginUi = 'true';
      status.setAttribute('role','status'); status.setAttribute('aria-live','polite');
      status.style.cssText='position:fixed;bottom:16px;right:16px;z-index:2147483647;padding:8px 12px;background:white;color:#222;border:1px solid #ccc;border-radius:6px;font:13px sans-serif;pointer-events:none';
      doc.documentElement.append(status);
    }
    if(status){status.textContent=message;status.hidden=!message;}
  }
  function focus(event) {
    const next = editable(event.composedPath?.()[0] || event.target);
    if (field !== next) { if (field) jobs.get(field)?.abort(); paint(); sequence = null; }
    field = next;
  }
  function caretOffset(node) {
    if ('selectionStart' in node) return node.selectionStart === node.selectionEnd ? node.selectionStart : null;
    const selection = doc.getSelection();
    if (!selection?.isCollapsed || !selection.rangeCount || !node.contains(selection.anchorNode)) return null;
    const range = selection.getRangeAt(0).cloneRange(); range.selectNodeContents(node);
    range.setEnd(selection.anchorNode, selection.anchorOffset); return range.toString().length;
  }
  function write(node, value) {
    if (node.isContentEditable) {
      const selection = doc.getSelection(), range = doc.createRange();
      range.selectNodeContents(node);
      selection.removeAllRanges(); selection.addRange(range);
      if (doc.execCommand('insertText', false, value)) return;
      range.deleteContents();
      const text = doc.createTextNode(value);
      range.insertNode(text); range.setStartAfter(text); range.collapse(true);
      selection.removeAllRanges(); selection.addRange(range);
    } else {
      const proto = node.tagName === 'TEXTAREA' ? root.HTMLTextAreaElement.prototype : root.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(node, value);
      node.setSelectionRange?.(value.length, value.length);
    }
    node.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  }
  async function translate(node, snapshot, source) {
    const controller = new AbortController(); jobs.get(node)?.abort(); jobs.set(node, controller);
    paint('正在翻译…');
    try {
      if (!root.BrevessLocalTranslator) throw Error('翻译引擎未就绪');
      provider ||= root.BrevessLocalTranslator.createProvider({ sourceLanguage: 'zh', targetLanguage: 'en' });
      await provider.initialize({ signal: controller.signal });
      const result = await provider.translate(source, { signal: controller.signal, foreground: true });
      if (!controller.signal.aborted && field === node && node.isConnected && read(node) === snapshot && jobs.get(node) === controller) {
        jobs.delete(node); write(node, typeof result === 'string' ? result : result.translatedText);
      }
      if (field === node) paint();
    } catch (error) {
      if (field === node && !controller.signal.aborted) { paint('翻译失败：' + String(error?.message || error) + '；可再按三次空格重试'); }
    } finally { if (jobs.get(node) === controller) jobs.delete(node); }
  }
  doc.addEventListener('focusin', focus, true);
  doc.addEventListener('input', event => { const node = editable(event.composedPath?.()[0] || event.target); if (node) jobs.get(node)?.abort(); }, true);
  doc.addEventListener('focusout', event => {
    const current = editable(event.composedPath?.()[0] || event.target);
    if (current && current === field && !current.contains(event.relatedTarget)) {
      jobs.get(current)?.abort(); sequence = null; field = null; paint();
    }
  }, true);
  doc.addEventListener('compositionstart', () => { sequence = null; }, true);
  doc.addEventListener('keydown', event => {
    const node = editable(event.composedPath?.()[0] || event.target);
    if (!node || event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.repeat ||
        event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || event.key !== ' ') { sequence = null; return; }
    const now = Date.now(), current = read(node), caret = caretOffset(node);
    if (caret == null || !/\p{Script=Han}/u.test(current) || current.length > 12002) { sequence = null; return; }
    field = node;
    // Save the original before the browser inserts the first space. On macOS
    // the second may become a period, and contenteditable often inserts NBSP.
    const suffix = current.slice(caret);
    const added = sequence ? current.slice(sequence.prefix.length, caret) : '';
    if (!sequence || sequence.node !== node || now - sequence.time > 900 ||
        !current.startsWith(sequence.prefix) || suffix !== sequence.suffix ||
        !/^(?:[ \u00a0\u3000]{1,2}|[.。][ \u00a0\u3000]?)$/.test(added)) {
      sequence = {node, time: now, count: 1, prefix: current.slice(0,caret), suffix,
        source: node.isContentEditable ? node.innerText : current};
      return;
    }
    sequence.time = now;
    if (++sequence.count < 3) return;
    const source = sequence.source; sequence = null;
    event.preventDefault();
    void translate(node, current, source);
  }, true);
  root.addEventListener('pagehide', () => { if (field) jobs.get(field)?.abort(); provider?.destroy(); status?.remove(); status=null; }, { once: true });
})(globalThis);


;/* native-radar.js */
/* The real radar renders a public, dated example; no scheduled network scans. */
(() => {
 const demo=window.__websiteDemo;demo.surface='radar';
 const notify=message=>{const n=document.getElementById('notice');n.textContent=message;};
 const needsInstall=new Set(['connections','toggle-radar','check-radar','check-all','confirm-history','score-papers','backfill-abstracts','validate-query']);
 document.addEventListener('click',e=>{
   const b=e.target.closest('button');
   if(needsInstall.has(b?.id)){e.preventDefault();e.stopImmediatePropagation();notify('官网展示 AlphaFold 公开示例；实时检索、定时追踪和模型评分请在插件中使用。');return;}
   if(b?.id==='generate-query'){e.preventDefault();e.stopImmediatePropagation();document.getElementById('query-candidate-area').hidden=false;document.getElementById('query-candidate').value='AlphaFold[Title/Abstract] AND protein structure[Title/Abstract]';document.getElementById('query-ai-status').textContent='预置检索式示例，请按研究问题修改。';return;}
   const link=e.target.closest('a');if((link?.closest('h3')&&link.href.includes('34265844'))||link?.href===BV_DEMO_DATA.source){e.preventDefault();parent.parent.postMessage({source:'brevess-native-demo',type:'jump',id:'abstract'},location.origin);}
 },true);
 document.getElementById('radar-form').addEventListener('submit',e=>{e.preventDefault();e.stopImmediatePropagation();notify('已预览检索式。实际保存与追踪请在插件中完成。');document.getElementById('editor').close();},true);
 addEventListener('message',e=>{if(e.source===parent&&e.origin===location.origin&&e.data?.source==='brevess-website'&&e.data.type==='language')SciLLM.setInterfaceLanguage(e.data.language,document);});
})();

