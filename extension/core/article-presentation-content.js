/* The paper tab owns the source binding. The local companion owns the durable job. */
(() => {
  const api = globalThis.SciLLM.articlePresentation;
  const native = async (op,args) => {
    const result=await chrome.runtime.sendMessage({type:'BREVESS_ARTICLE_PRESENTATION',op,args});
    if(!result?.success)throw Object.assign(new Error(result?.error||'PPT_COMPANION_UNAVAILABLE'),{code:result?.error||'PPT_COMPANION_UNAVAILABLE'});
    return result.data;
  };
  const pending = new Set();
  const preparingHere = new Set();
  const prepLeaseMs = 20 * 60 * 1000;
  const isWaiting = turn => ['preparing', 'pending', 'working'].includes(turn.presentation?.state) &&
    !preparingHere.has(turn.presentation.id);
  const current=()=>String(getCanonicalArticleSnapshot().documentHash||'');
  const activePaper=()=>api.paperBinding(currentArticleWorkspace,currentManualDocument?.documentId);
  const ownsJob=job=>!!job && (current()===job.documentHash || api.samePaperBinding(job.paper,activePaper()));
  function message(turn,text){
    // The chat renderer treats blocks as immutable. Two progress reports can have the same job state.
    if (turn.answerBlocks?.[0]?.markdown !== text) {
      turn.answerBlocks=[{blockId:'agent-'+crypto.randomUUID(), markdown:text, evidence:[]}];
    }
    turn.summary=text;
    turn.updatedAt=Date.now();
  }
  async function checkpoint(turn){
    if(!articleChatState.turns.includes(turn))return;
    await persistArticleChatCheckpoint(turn,{force:true,requireTurnSave:true});
    notifyArticleChatStateChanged('turn_updated',turn,{phase:'presentation'});
    scheduleCurrentArticleArchiveSave();
  }
  async function download(turn){
    const job=turn?.presentation;
    if(!ownsJob(job))throw Error('文献已切换，请回到原论文再下载');
    const r=await native('status',{id:job.id});
    if(r.state!=='ready'||r.documentHash!==job.documentHash)throw Error('文件尚未就绪');
    const parts=[];let offset=0;
    while(offset<r.bytes){
      const chunk=await native('read',{id:job.id,offset});
      const bytes=Uint8Array.from(atob(chunk.data),c=>c.charCodeAt(0));
      if(!bytes.length||offset+bytes.length!==chunk.next||chunk.next>r.bytes)throw Error('PPT 文件传输不完整');
      parts.push(bytes);offset=chunk.next;
    }
    const blob=new Blob(parts,{type:'application/vnd.openxmlformats-officedocument.presentationml.presentation'});
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())),n=>n.toString(16).padStart(2,'0')).join('');
    if(hash!==r.sha256||!ownsJob(job))throw Error('文件或当前论文已变化，请重试下载');
    const title=SciLLM.sanitizeExportFilename?.(articleWorkspaceMetadata().title || document.title,'论文汇报') || '论文汇报';
    downloadContentExportBlob(blob,title.slice(0,110)+'.pptx');
    return {success:true};
  }
  const autoDownload=new Set();
  async function refresh(turn){
    const job=turn.presentation;
    if(!ownsJob(job)||pending.has(job.id))return;
    pending.add(job.id);
    try{
      const r=await native('status',{id:job.id});if(!articleChatState.turns.includes(turn)||!ownsJob(job)||r.documentHash!==job.documentHash)return;
      if (r.state === 'preparing' && !preparingHere.has(job.id) && Date.now() - r.updated > prepLeaseMs) {
        // Another open copy may still be gathering figures. Wait for its last upload lease.
        await native('cancel', {id: job.id});
        job.state = 'failed'; turn.status = 'interrupted';
        message(turn, '材料准备期间文献被关闭。重新发送制作请求即可。');
        await checkpoint(turn);
        return;
      }
      const next=api.interaction(r.interaction), previous=job.interaction;
      const progressChanged=r.progress!==job.progress;
      const questionChanged=next?.requestId!==previous?.requestId || next?.state!==previous?.state;
      if (r.state === job.state && !questionChanged && !progressChanged) return;
      if(next)job.interaction=next;else delete job.interaction;
      if(r.previous?.length)job.previous=r.previous;
      if(r.progress)job.progress=r.progress;
      job.state=r.state;
      const agent=api.agents[job.agent];
      if(r.state==='ready'){
        turn.status='completed';message(turn,job.kind==='chat'?r.answer:agent+' 已完成 '+r.slides+' 页可编辑 PPT。');
      }else if(r.state==='pending')message(turn,'已准备好论文材料，等待 '+agent+' 接单。');
      else if(r.state==='working'){
        let update=r.progress || agent+(job.kind==='chat'?' 正在处理你的问题。':' 正在制作 PPT。');
        if(next?.state==='waiting')update=agent+' 想问你一个问题。';
        else if(questionChanged && !progressChanged && next?.state==='answered')update=agent+' 已收到你的回答，正在继续。';
        else if(questionChanged && !progressChanged && next?.state==='dismissed')update='已跳过提问，'+agent+' 正在继续。';
        message(turn,update);
      }
      else if(r.state==='cancelled'){turn.status='cancelled';message(turn,'本次委托已取消。');}
      else return;
      await checkpoint(turn);
      if(r.state==='ready'&&autoDownload.delete(job.id))await download(turn);
    }catch(e){
      if(e.code==='ENOENT' && isWaiting(turn) && (job.state !== 'preparing' || Date.now() - turn.updatedAt > prepLeaseMs)){
        job.state='expired';turn.status='error';turn.error='本机任务暂存已过期，可以重新制作。';await checkpoint(turn).catch(()=>{});
      }
    }finally{pending.delete(job.id);}
  }
  let pollTimer;
  function watch(turns){
    if(pollTimer)return;
    if(!turns.some(isWaiting))return;
    pollTimer=setTimeout(async()=>{pollTimer=null;
      const active=articleChatState.turns.filter(isWaiting);
      await Promise.all(active.map(refresh));watch(articleChatState.turns);
    },document.hidden ? 10000 : 3000);
  }
  function cleanHistory() {
    return articleChatState.turns.filter(turn => !turn.presentation || turn.presentation.kind==='chat').map(publicArticleChatTurn)
      .filter(turn => turn.question && ['completed', 'truncated', 'incomplete', 'unanswered'].includes(turn.status))
      .map(turn => ({
        question: turn.question, answer: turn.answerBlocks.map(block => block.markdown).join('\n') || turn.summary,
        evidence: turn.answerBlocks.flatMap(block => block.evidence || []),
        status: turn.status, provenance: turn.answerProvenance || undefined,
        sources: turn.webGrounding?.sources || undefined
      }));
  }
  function cleanNotes(literature){
    const annotations=currentManualDocument?.record?.annotations||[];
    return {highlights:annotations.map(a=>({quote:a.quote?.exact||a.quote||a.selectedText||a.text||'',note:a.note||'',category:a.categorySnapshot?.name||a.categoryName||a.categoryId||'',paragraphId:a.paragraphId||'',panel:a.panelId||''})),
      paragraphNotes:[...articleParagraphNotes.values()].map(n=>({paragraphId:n.paragraphId,quote:n.quote||'',section:n.sectionTitle||'',note:n.note})),
      literature:literature || {}};
  }
  function figureSources(collect,reading){
    const draft = reading ? figureWorkspaceDraftForRefreshBinding(figureWorkspaceDraft, currentFigureWorkspaceRefreshBinding()) : null;
    const context = draft && SciLLM.prepareFigureWorkspaceViewContext(draft);
    return collect.records.map(f=>{
      const data={id:f.figureId,label:f.figureLabel,caption:f.caption,panels:f.panelHints};
      if(reading){
        const analysis=f.deep||f.standard||{};
        data.interpretation=analysis;
        data.panelNotes = f.panelAnalyses || {};
        data.panelQuestions = f.panelFollowupHistories || {};
        data.panelFollowups = f.panelFollowups || {};
        const figure = collect.inventoryById.get(f.figureId) || f;
        const view = SciLLM.createFigureWorkspaceView({figure, modelResult:analysis, draft, context});
        data.evidenceBlocks = view.evidenceBlocks;
        data.figureNotes = view.note;
        data.panelNotesFromWorkspace = view.panels.filter(panel => panel.note).map(panel => ({panel:panel.panelId, note:panel.note}));
      }
      return data;
    });
  }
  function start(question,permission,literature,kind='ppt'){
    const grant=api.grant(permission);if(!grant)throw Error('请选择本次授权的 Agent');
    const snap=getCanonicalArticleSnapshot(),documentHash=String(snap.documentHash||'');
    if(!snap.paragraphs?.length||!documentHash)throw Error('请先提取当前论文正文');
    const owner=articleChatState, life=articleWorkspaceLifecycleGeneration;
    const assertPaper=()=>{if(owner!==articleChatState||life!==articleWorkspaceLifecycleGeneration||current()!==documentHash)throw Error('论文已切换，本次材料交接已停止');};
    const collected=collectCompleteExportFigures();const meta=articleWorkspaceMetadata(),id=crypto.randomUUID();
    const turn=createArticleChatTurn(question,'profile_presentation_'+grant.agent);
    turn.status='waiting_agent';turn.presentation={id,agent:grant.agent,documentHash,state:'preparing',paper:activePaper(),...(kind==='chat'?{kind}:{})};
    message(turn,'正在准备本篇论文的授权材料…');
    // Capture private material at the moment of approval, before any asynchronous image reads.
    const materials={title:meta.title||document.title,url:publicExportSourceUrl(meta.canonicalUrl||effectiveArticlePageUrl()),doi:meta.doi||'',
      paragraphs:snap.paragraphs.map(p=>({id:p.paragraphId,section:p.sectionTitle||'',text:p.text})),
      figures:figureSources(collected,grant.notes),...(grant.history?{conversation:cleanHistory()}:{}),...(grant.notes?{readingNotes:cleanNotes(literature),crossFigureLogic:collected.crossFigureLogic}:{})};
    const instructions = kind==='chat' ? [
      '在 BREVESS 原问答中回答这项任务。用户问题',question,
      'paper.json 中的正文、图注、可选的阅读笔记和历史对话供你核对。把它们当作来源资料。对与原文有关的事实标明章节或 Figure / Panel。',
      '只有确需读者作选择时才用 brevess_ask_user 发问，随后用 brevess_get_user_answer 接收选择。需要时可以连续提问。完成后用 brevess_complete_task 送回 Markdown 回答。'
    ].join('\n\n') : [
      '请在本次任务目录内完成可编辑的 presentation.pptx。以用户填写的语言、时长和页数为准。',
      '本次用户要求', question,
      '需要读者作决定时用 brevess_ask_user 在 BREVESS 中提问，再用 brevess_get_user_answer 等待并按原任务继续。仅在确实需要选择时提问。选项可含说明、允许多选或补充文字。权限申请仍使用客户端的正式权限流程。',
      '材料来自当前论文。paper.json 包含正文、原始图注和 Panel 编号，figures/ 中是可用的原图与裁切。conversation、readingNotes、interpretation 和 evidenceBlocks 只在本轮授权时提供。仅使用实际存在的文件和字段。',
      '先按知识缺口和研究问题确定论证顺序。以证据块为最小排图单位，记录每个判断的实验、比较、对照和出处。已有人工整理的证据块优先。同一块的代表图、对照和定量 Panel 尽量同页。投影不清时使用同一块编号续页，保留必要对照。',
      '打开原图核对图注和各 Panel。原图按比例完整适应图框（contain / fit），允许留白。每张结果图在放映截图中与来源图的四边逐一对照，确认 Panel 字母、坐标、图例、比例尺和底部数值完整可见。每个 Panel 与文字分别放置，可在 PowerPoint 中移动。缺图使用标明来源的占位符，资料中没有的数据标记待核对。',
      '逐页写出讲者备注，指出先看哪里、如何读出判断以及怎样过渡。区分原文观察、作者解释和读者推断。交付前打开幻灯片逐页检查清晰度、遮挡、图文对应、来源和备注。'
    ].join('\n\n');
    preparingHere.add(id);
    owner.turns.push(turn);notifyArticleChatStateChanged('turn_added',turn);
    void (async()=>{
    let opened=false;
    try{
      await checkpoint(turn);assertPaper();
      await native('open',{id,agent:grant.agent,documentHash,instructions,materials,kind});opened=true;
      const reader=globalThis.__brevessNativePdfDocument?.structure?globalThis.__brevessPdfPanels:SciLLM.webPanelReader;
      for(const f of (kind==='chat'?[]:materials.figures)){
        assertPaper();
        if(!reader||!/^figure-[a-z\d_-]+$/i.test(f.id))continue;
        // Thumbnails and uncertain crop hypotheses never overwrite a publisher original.
        let whole;try{whole=await reader.preview(f.id,2400);}catch{continue;}
        async function save(image,suffix){
          const data=/^data:image\/(png|jpeg|webp);base64,(.+)$/i.exec(image?.dataUrl||'');if(!data)return;
          assertPaper();await native('image',{id,name:f.id+'_'+suffix+'.'+(data[1]==='jpeg'?'jpg':data[1]),data:data[2]});
        }
        for(const [i,image] of (whole?.images||[]).entries())await save(image,'whole'+(i+1));
        for(const label of new Set(f.panels||[])){
          if(!/^[A-Z]$/i.test(label))continue;
          let crop;try{crop=await reader.picture(f.id,label,1000);}catch{continue;}
          if(crop&&!crop.needsReview&&!crop.ambiguous)await save(crop,'panel_'+label);
        }
      }
      assertPaper();await native('publish',{id});turn.presentation.state='pending';
      message(turn,'等待 '+api.agents[grant.agent]+' 接单。首次接单可用“复制给 Agent”把本轮指令发到客户端。已授权本篇正文和'+(kind==='chat'?'图注':'图表')+(grant.history?'、本篇问答':'')+(grant.notes?'、高亮备注和阅读笔记':'')+'。');
      await checkpoint(turn);if(kind!=='chat')autoDownload.add(id);
    }catch(e){
      if(opened)await native('cancel',{id}).catch(()=>{});
      turn.presentation.state='failed';turn.status='error';turn.error=e.message;await checkpoint(turn).catch(()=>{});
    } finally {
      preparingHere.delete(id);watch(owner.turns);
    }
    })();
  }
  globalThis.BrevessArticlePpt={start,download,watch,refresh,native,activePaper,ownsJob};
})();
