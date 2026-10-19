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
      const count=version.articles.filter(p=>!['ready','missing'].includes(p.abstractStatus)).length;
      $('backfill-abstracts').disabled=!!(state.active?.expiresAt>Date.now())||!count;status('backfill-abstracts',count?`补齐摘要（${count}）`:'摘要已补齐');
      updateCount();
    }
    function bilingual(original,paper,part){
      const key=`${viewKey}:${paper.id}:${part}`,source=part==='title'?paper.title:R.radarAbstractText(paper);
      const block=node('div','bilingual-block');block.dataset.translationPart=part;block.dataset.pmid=paper.id;block.tabIndex=0;
      block.title='鼠标指向或聚焦本块，按下并松开 Alt 显示/隐藏中文对照';original.setAttribute('translate','no');block.append(original);
      const saved=paper.translations?.[part];
      if(saved?.sourceText===source&&!hiddenTranslations.has(key)){const zh=node('div','translation-zh'), translated=node('p','',saved.translatedText);translated.setAttribute('translate','no');zh.append(node('small','','中文对照'),translated);block.append(zh);block.classList.add('has-translation');}
      const target={key,source,paper,part,id:selected.id,revision:revision.number};
      block.addEventListener('mouseenter',()=>{hover=target;});block.addEventListener('mouseleave',()=>{if(hover?.key===key)hover=null;});
      block.addEventListener('focus',()=>{hover=target;});block.addEventListener('blur',()=>{if(hover?.key===key)hover=null;});
      return block;
    }
    function decorate(article,paper){
      article.dataset.pmid=paper.id;const title=article.querySelector('h3'),afterTitle=title.nextSibling;
      article.insertBefore(bilingual(title,paper,'title'),afterTitle);
      const abstract=node('details','paper-abstract'),key=`${viewKey}:${paper.id}`;abstract.open=opened.has(key);
      const labels={ready:'摘要',missing:'PubMed 未提供摘要',error:'摘要获取失败 · 可补齐重试'};
      abstract.append(node('summary','',labels[paper.abstractStatus]||'摘要待补齐'));
      if(paper.abstractStatus==='ready'){
        const original=node('div','abstract-original');for(const s of paper.abstractSections||[]){const p=node('p');if(s.label)p.append(node('strong','',s.label+' '));p.append(document.createTextNode(s.text));original.append(p);}
        abstract.append(bilingual(original,paper,'abstract'));
        if(paper.abstractCopyright)abstract.append(node('small','copyright',paper.abstractCopyright));
      }else abstract.append(node('p','hint',paper.abstractStatus==='missing'?'来源记录没有摘要，未生成替代内容。':'点击“补齐摘要”获取 PubMed 原文；此操作不调用 AI。'));
      abstract.addEventListener('toggle',()=>{if(abstract.open)opened.add(key);else opened.delete(key);});article.insertBefore(abstract,article.querySelector('.paper-footer'));
      const result=scoreFor(paper),score=node('div','relevance-result');
      if(result?.status==='ready'){const color=R.radarScoreColor(result.score);score.style.backgroundColor=color.css;score.append(node('strong','',`相关性 ${result.score}/100`),node('span','',result.reason));}
      else if(currentRun()){const messages={'missing-abstract':'未评分 · PubMed 无摘要','abstract-unavailable':'未评分 · 摘要待补齐',error:`评分失败 · ${result?.errorCode||''}`,cancelled:'已停止 · 可继续评分',pending:'评分中…'};score.textContent=messages[result?.status]||'未评分 · 不在此任务范围或内容已更新';}
      if(score.textContent)article.insertBefore(score,abstract);
    }
    function compare(a,b){
      if($('paper-sort').value==='relevance'){const x=scoreFor(a),y=scoreFor(b),av=x?.status==='ready'?x.score:-1,bv=y?.status==='ready'?y.score:-1;if(av!==bv)return bv-av;}
      return R.radarPaperTime(b)-R.radarPaperTime(a)||b.id.localeCompare(a.id,'en',{numeric:true});
    }
    async function translate(target){
      if(translationJobs.has(target.key))return;
      const binding=await R.radarTranslationBinding(target.id,target.revision,target.paper,target.part);
      const wrap=request=>client.request({type:'RADAR_TRANSLATION',request});
      const bridge={getRoute:(taskId,documentBinding)=>wrap({type:'TRANSLATION_TASK_ROUTE_GET',taskId,documentBinding}),translate:wrap,
        getReceipt:request=>wrap({...request,type:'TRANSLATION_RECEIPT_GET'}),cancel:(operationId,documentBinding,taskId)=>wrap({type:'LLM_CONTROL_OPERATION',operationId,documentBinding,taskId,command:'cancel'})};
      const T=root.BrevessLocalTranslator;if(!T){notice('翻译组件尚未载入。');return;}
      const provider=T.createTaskProvider({taskId:'full_text_translation',localProvider:T.createProvider(),bridge,captureIdentity:()=>binding,isCurrent:()=>viewKey===`${target.id}:${target.revision}`});
      translationJobs.set(target.key,{provider});notice('正在检查当前原文翻译配置…');
      try{
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
      }catch(e){notice(errorText(e));}finally{provider.destroy();translationJobs.delete(target.key);}
    }
    const typing=e=>e.target?.closest?.('input,textarea,select,[contenteditable="true"]');
    document.addEventListener('keydown',e=>{if(e.key==='Alt'&&!e.ctrlKey&&!e.metaKey&&!e.shiftKey&&!e.repeat&&!typing(e)){altTarget=hover;if(altTarget)e.preventDefault();}else if(e.key!=='Alt')altTarget=null;});
    document.addEventListener('keyup',e=>{if(e.key==='Alt'){const target=altTarget;altTarget=null;if(target&&hover?.key===target.key&&!e.ctrlKey&&!e.metaKey&&!e.shiftKey&&!typing(e)){e.preventDefault();void translate(target);}}});
    window.addEventListener('blur',()=>{altTarget=null;});
    function editorOpened(query){queryEpoch++;cancelQuery();$('query-need').value=query||'';$('query-candidate').value='';$('query-candidate-area').hidden=true;status('query-ai-status','');}
    function cancelQuery(){if(queryJob){void client.request({type:'RADAR_AI_CANCEL',operationId:queryJob}).catch(()=>{});queryJob=null;}$('generate-query').disabled=false;}
    $('editor').addEventListener('close',()=>{queryEpoch++;cancelQuery();});
    $('cancel-query-ai').addEventListener('click',()=>{queryEpoch++;cancelQuery();status('query-ai-status','已停止生成；原检索式保留。');});
    $('generate-query').addEventListener('click',async()=>{
      const input=$('query-need').value.trim();if(!input){status('query-ai-status','请填写研究需求或已有检索式。');return;}
      const epoch=++queryEpoch,operationId=op();queryJob=operationId;$('generate-query').disabled=true;status('query-ai-status','正在使用全局默认模型生成候选检索式…');
      try{const route=await client.request({type:'RADAR_AI_ROUTE',kind:'query'});if(epoch!==queryEpoch)return;
        const result=await client.request({type:'RADAR_AI_QUERY',input,operationId,expectedEngineSignature:route.engineSignature});if(epoch!==queryEpoch)return;
        $('query-candidate').value=result.query;$('query-candidate-area').hidden=false;status('query-ai-status',`模型：${result.route?.model||result.route?.name||'全局默认'}。${result.explanation}`);status('query-validation','候选待验证。生成和应用均不会自动保存或扫描。');
      }catch(e){if(epoch===queryEpoch)status('query-ai-status',errorText(e));}finally{if(epoch===queryEpoch){queryJob=null;$('generate-query').disabled=false;}}
    });
    $('validate-query').addEventListener('click',async()=>{const query=$('query-candidate').value,epoch=queryEpoch;
      try{R.validateRadarQuery(query);status('query-validation','正在读取 PubMed 解析反馈…');const result=await adapter.previewQuery(query);
        if(epoch!==queryEpoch||query!==$('query-candidate').value)return;
        status('query-validation',`${result.errors.length?'PubMed 错误：'+result.errors.join('；'):`PubMed 命中 ${result.count} 篇。`}${result.warnings.length?' 提示：'+result.warnings.join('；'):''}\n解析：${result.queryTranslation}\n可解析不代表符合研究意图，请人工检查候选。`);
      }catch(e){if(epoch===queryEpoch)status('query-validation',errorText(e));}});
    $('apply-query').addEventListener('click',()=>{try{$('query').value=R.validateRadarQuery($('query-candidate').value);$('query').dispatchEvent(new Event('input'));status('query-ai-status','候选已应用到检索框，尚未保存或扫描。');}catch(e){status('query-validation',errorText(e));}});
    $('backfill-abstracts').addEventListener('click',async()=>{
      if(!selected||!revision)return;const id=selected.id,version=revision.number;$('backfill-abstracts').disabled=true;
      try{const result=await service.backfillAbstracts(id,version,{onProgress:p=>notice(`摘要补齐 ${p.completed}/${p.total}，失败 ${p.errors} 篇。`)});notice(`摘要补齐完成：处理 ${result.completed} 篇，失败 ${result.errors} 篇。未改变新增计数。`);}catch(e){notice(errorText(e));}finally{await refresh(true);}
    });
    for(const id of ['score-description','score-start','score-end'])$(id).addEventListener('input',()=>{activeRun=null;updateCount();void refresh(true);});
    $('paper-sort').addEventListener('change',()=>{void rememberView().then(()=>refresh(true));});
    $('score-history').addEventListener('change',()=>{activeRun=$('score-history').value||null;const run=currentRun();if(run){$('score-description').value=run.description;$('score-start').value=run.startDay;$('score-end').value=run.endDay;}void rememberView().then(()=>refresh(true));});
    function scoringControls(busy){for(const id of ['score-description','score-start','score-end','score-history'])$(id).disabled=busy;$('stop-scoring').disabled=!busy;updateCount();}
    function stopScoring(){if(!scoring)return;scoring.stopped=true;if(scoring.operationId)void client.request({type:'RADAR_AI_CANCEL',operationId:scoring.operationId}).catch(()=>{});status('score-status','已请求停止；正在收尾，已完成结果保留。');}
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
    return {prepare,decorate,compare,editorOpened,isRelevanceSort:()=>$('paper-sort').value==='relevance'};
  }};
})(globalThis);
