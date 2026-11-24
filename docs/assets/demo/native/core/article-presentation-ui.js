(() => {
  const api=globalThis.SciLLM.articlePresentation;
  const english=()=>document.documentElement.lang.toLowerCase().startsWith('en');
  const tr=(zh,en)=>english()?en:zh;
  const el=(tag,text)=>Object.assign(document.createElement(tag),text?{textContent:text}:{});
  const configured=new Set();
  let configuredPromise=null;
  let checkedAt=-Infinity;
  function discoverClients(force=false){
    if(configuredPromise)return configuredPromise;
    if(!force && Date.now()-checkedAt<30000)return;
    checkedAt=Date.now();
    configuredPromise=chrome.runtime.sendMessage({type:'BREVESS_ARTICLE_PRESENTATION',op:'clients'}).then(response=>{
      if(!response?.success || !Array.isArray(response.data))return;
      const available=new Set(response.data.filter(id=>Object.hasOwn(api.agents,id)));
      if(available.size===configured.size && [...available].every(id=>configured.has(id)))return;
      const select=document.getElementById('articleChatProfile');
      const previous=select?.value;
      configured.clear();
      for(const id of available)configured.add(id);
      renderArticleChatProfileOptions();
      if(select && select.value!==previous)select.dispatchEvent(new Event('change',{bubbles:true}));
    }).catch(()=>{}).finally(()=>{configuredPromise=null;});
    return configuredPromise;
  }
  const refreshChatClients=()=>{
    if(document.visibilityState==='visible' && document.getElementById('workspace-chat')?.hidden===false)void discoverClients(true);
  };
  window.addEventListener('focus',refreshChatClients);
  document.addEventListener('visibilitychange',refreshChatClients);
  chrome.storage?.onChanged?.addListener((changes,area)=>{
    if(area!=='local' || !('brevess-mcp-bridge-v1' in changes || 'brevess-mcp-paused-v1' in changes))return;
    // A pairing change can land while a request for the previous registration is in flight.
    if(configuredPromise)void configuredPromise.then(refreshChatClients);
    else refreshChatClients();
  });
  const externalId=value=>typeof value==='string' && value.startsWith('local_agent:') && configured.has(value.slice(12)) ? value.slice(12) : '';
  function isRequest(input){
    return !!input && (api.requested(input.value) || !!input.value.trim() && input.value.includes(input.dataset.presentationPreset || '\u0000'));
  }
  function authorize(profile,chat=false){
    return new Promise(resolve=>{
      const dialog=el('dialog');dialog.className='ppt-share-dialog';dialog.setAttribute('aria-labelledby','pptShareTitle');
      const form=el('form');form.method='dialog';
      const title=el('h3',chat?tr('交给本机 Agent','Ask a local agent'):tr('制作论文 PPT','Create a paper presentation'));title.id='pptShareTitle';
      const label=el('label',tr('Agent','Agent')),select=el('select');
      for(const [id,name] of Object.entries(api.agents)){select.add(new Option(name,id));}
      select.value=Object.hasOwn(api.agents,profile)?profile:profile==='codex-local'?'codex':profile==='deepseek-harness'?'dsh':'workbuddy';label.append(select);
      const note=el('p',chat?tr('发送本篇正文和图注。还要附上哪些阅读材料？','Share this paper’s text and captions. Include any reading materials?'):tr('发送本篇正文、原图和原始图注。还要使用哪些阅读材料？','Share this paper’s text, original figures and captions. Which reading materials should the agent also use?'));
      const option=(text)=>{const l=el('label'),input=el('input');input.type='checkbox';l.append(input,document.createTextNode(text));return [l,input];};
      const [history,h]=option(tr('本篇问答历史','This paper’s Q&A history'));
      const [notes,n]=option(tr('本篇高亮、备注、笔记和解图记录','Highlights, annotations, notes and figure analyses'));
      const buttons=el('footer'),cancel=el('button',tr('取消','Cancel')),submit=el('button',chat?tr('发送','Send'):tr('授权并制作','Authorize and create'));
      cancel.type='button';cancel.onclick=()=>dialog.close();submit.value='create';buttons.append(cancel,submit);
      form.append(title,label,note,history,notes,buttons);dialog.append(form);document.body.append(dialog);
      dialog.addEventListener('close',()=>{const grant=dialog.returnValue==='create'?{agent:select.value,history:h.checked,notes:n.checked}:null;dialog.remove();resolve(grant);},{once:true});
      dialog.showModal();
    });
  }
  let busy=false;
  async function submit(input,external=''){
    if(busy)return;busy=true;const ctx=capturePanelContext(),question=input.value.trim();
    try{
      const selected=llmSettingsState?.settings?.profiles?.[document.getElementById('articleChatProfile')?.value];
      const chat=!!external&&!isRequest(input);
      const grant=await authorize(external||selected?.providerId,chat);if(!grant||!isCurrentPanelContext(ctx))return;
      let notes;
      if(grant.notes){
        await loadLiteratureNoteDocumentState();if(!isCurrentPanelContext(ctx))return;
        const s=literatureNoteDocumentState;notes=s?.valuesByTemplate||s?.valuesByTemplateId||s?.values||{};
      }
      const response=await sendTabMessage(ctx.tabId,{action:'createArticlePresentation',question,grant,literature:notes,kind:chat?'chat':'ppt'});
      if(!response?.success)throw Error(response?.error||tr('未能启动制作','Unable to start the presentation'));
      if(isCurrentPanelContext(ctx)&&input.value.trim()===question){input.value='';delete input.dataset.presentationPreset;input.dispatchEvent(new Event('input',{bubbles:true}));}
    }catch(e){if(isCurrentPanelContext(ctx))showStatus(e.message,'error');}finally{busy=false;}
  }
  async function act(button){
    const ctx=capturePanelContext();button.disabled=true;
    try{
      const action=button.dataset.articleChatAction;
      if(action==='ppt-copy'){
        const turn=currentWorkspaceSnapshot?.chat?.turns?.find(t=>t.turnId===button.dataset.turnId);
        if(!turn?.presentation)return;
        const setup = await chrome.runtime.sendMessage({type:'BREVESS_ARTICLE_PRESENTATION', op:'setup', args:{agent:turn.presentation.agent}}).catch(() => null);
        if (!isCurrentPanelContext(ctx)) return;
        await navigator.clipboard.writeText(api.handoff(turn.presentation, setup?.success ? setup.data : null));
        showStatus(tr('已复制给 Agent 的任务指令','Agent handoff copied'),'success');return;
      }
      const response=await sendTabMessage(ctx.tabId,{action:action==='ppt-cancel'?'cancelArticlePresentation':'downloadArticlePresentation',turnId:button.dataset.turnId},{timeoutMs:180000});
      if(!response?.success)throw Error(response?.error||'PPT 请求失败');
    }catch(e){if(isCurrentPanelContext(ctx))showStatus(e.message,'error');}finally{button.disabled=false;}
  }
  function renderQuestion(element,turn) {
    const source=turn.readerJob||turn.presentation||turn.agentDialogue, q=api.interaction(source?.interaction);
    const old=element.querySelector('.agent-question-card');
    if(!q || ['cancelled','expired','failed'].includes(source.state) || (turn.readerJob && q.state==='waiting' && turn.status!=='generating')) {old?.remove();return false;}
    const version=[source.id,q.requestId,q.state].join('/');
    const isOpen=q.state==='waiting';
    if(old?.dataset.version===version)return isOpen;
    const card=el(isOpen?'form':'div');card.className='agent-question-card';card.dataset.version=version;
    card.setAttribute('aria-label',tr('Agent 提问','Agent question'));
    const ctx=capturePanelContext();
    const hasOptions=q.questions.some(item=>item.options.length);
    const body=isOpen?card:el('details');
    if(isOpen) {
      card.append(el('strong',hasOptions?tr('请你选择','Your input'):tr('请你补充','Your input')));
    } else {
      const summary=el('summary',q.state==='answered'?tr('已回复','Your response'):tr('已跳过','Skipped'));
      const selected=api.readerChoices([q]).flatMap(row=>[...row.choices,row.note]).filter(Boolean);
      if(selected.length)summary.append(el('span',selected.join(' · ')));
      body.append(summary);card.append(body);
    }
    const previous = api.readerChoices(source.previous);
    if (previous.length) {
      const history=el('details');
      history.append(el('summary',tr('之前的选择','Previous choices')));
      for (const entry of previous) {
        const choice=entry.skipped ? tr('已跳过','Skipped') : [...entry.choices,entry.note].filter(Boolean).join(' · ');
        history.append(el('p',entry.question+' — '+choice));
      }
      body.append(history);
    }
    const controls=new Map();
    for(const item of q.questions) {
      const group=el('fieldset'),legend=el('legend',item.prompt);group.append(legend);
      if(item.heading && item.heading!==item.prompt)legend.prepend(el('small',item.heading));
      if(!isOpen) {
        const a=q.responses?.find(row=>row.id===item.id);
        if(a)group.append(el('p',[...a.selected.map(id=>item.options.find(o=>o.id===id)?.label),a.text].filter(Boolean).join(' · ')));
      } else {
        const inputs=[];
        for(const option of item.options){
          const label=el('label'),input=el('input'),copy=el('span');
          input.type=item.multiple?'checkbox':'radio';input.name=turn.turnId+'-'+q.requestId+'-'+item.id;input.value=option.id;
          copy.append(el('span',option.label));
          if(option.description)copy.append(el('small',option.description));
          label.append(input,copy);group.append(label);inputs.push(input);
        }
        let extra=null;
        if(item.allowText){
          extra=el('textarea');extra.rows=1;extra.maxLength=1000;
          extra.placeholder=item.options.length?tr('其他或补充说明','Other or add a note'):tr('输入你的回答','Enter your answer');
          extra.setAttribute('aria-label',item.prompt+' · '+extra.placeholder);group.append(extra);
        }
        controls.set(item.id,{inputs,extra});
      }
      body.append(group);
    }
    if(isOpen){
      const read=()=>Object.fromEntries([...controls].map(([id,c])=>[id,{selected:c.inputs.filter(i=>i.checked).map(i=>i.value),text:c.extra?.value||''}]));
      const footer=el('footer'),error=el('p'),skip=el('button',tr('跳过','Skip')),send=el('button',hasOptions?tr('提交选择','Send response'):tr('发送回答','Send response'));
      error.hidden=true;error.setAttribute('role','alert');skip.type='button';send.type='submit';send.disabled=true;
      footer.append(skip,send);card.append(error,footer);
      let submitting=false;
      const update=()=>{send.disabled=submitting||!api.answersFor(q,read());skip.disabled=submitting;};
      card.addEventListener('input',update);
      async function respond(dismissed){
        if(submitting||!isCurrentPanelContext(ctx))return;
        const current=currentWorkspaceSnapshot?.chat?.turns?.find(t=>t.turnId===turn.turnId);
        const bound=current?.readerJob||current?.presentation||current?.agentDialogue;
        if(!bound||bound.id!==source.id||bound.interaction?.requestId!==q.requestId)return;
        if(bound.documentHash!==currentWorkspaceSnapshot.documentHash &&
            !(current.presentation && api.samePaperBinding(bound.paper,currentWorkspaceSnapshot.agentPaper)))return;
        const answers=api.answersFor(q,read());if(!dismissed&&!answers)return;
        submitting=true;update();error.hidden=true;
        try{
          const args={id:source.id,documentHash:bound.documentHash,requestId:q.requestId,dismissed,answers};
          if(turn.presentation||turn.readerJob) {
            const reply=await chrome.runtime.sendMessage({type:'BREVESS_ARTICLE_PRESENTATION',op:'respond',args});
            if(!reply?.success)throw Error(reply?.error);
            if(turn.presentation && isCurrentPanelContext(ctx))await sendTabMessage(ctx.tabId,{action:'refreshArticlePresentation',turnId:turn.turnId});
          } else {
            const reply=await sendTabMessage(ctx.tabId,{action:'answerArticleAgentQuestion',turnId:turn.turnId,...args});
            if(!reply?.success)throw Error(reply?.error);
          }
        }catch(e){
          if(isCurrentPanelContext(ctx)){error.textContent=tr('回复未送达，请重试。','Could not send your reply. Try again.');error.hidden=false;}
          submitting=false;update();
        }
      }
      card.onsubmit=e=>{e.preventDefault();void respond(false);};
      skip.onclick=()=>void respond(true);
    }
    old?.remove();
    const anchor=isOpen?'.article-chat-turn-status':'.article-chat-answer-blocks';
    element.querySelector(anchor)?.before(card);
    return isOpen;
  }
  globalThis.BrevessPresentationUI={isRequest,submit,act,renderQuestion,configured,discoverClients,externalId};
})();
