(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;Object.assign(root.Workbench ||= {},api);})(globalThis,()=>{
  'use strict';
  function createAgentPanel({container,connect,start,cancel,onStatus=()=>{},conversations=null,docked=false,toolLabels={},surface=null,sourceCatalog=globalThis.BrevessAgentConnections?.sources}){
    const renderer=globalThis.BrevessChatMessageUI.createRenderer();
    const icon=path=>'<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+path+'"/></svg>';
    container.innerHTML=`<div class="agent-heading"><div class="agent-heading-copy"><strong>Agent 辅助</strong><span data-agent-context>课题工作台</span></div>${conversations?`<button type="button" data-agent-history aria-label="历史会话" title="历史会话" aria-expanded="false">${icon('M3 4v5h5M3.5 9a9 9 0 1 1 .7 8M12 7v5l3.5 2')}</button><button type="button" data-agent-new aria-label="新建会话" title="新建会话">${icon('M12 4v16M4 12h16')}</button>`:''}<button type="button" data-agent-access-toggle aria-label="操作权限" title="操作权限" aria-expanded="false">${icon('M12 3 4 6v6c0 4.5 3.2 7.3 8 9 4.8-1.7 8-4.5 8-9V6z M9 12l2 2 4-5')}</button><button type="button" data-agent-close aria-label="关闭 Agent 面板" title="关闭">${icon('m6 6 12 12M18 6 6 18')}</button></div>
      <div data-agent-threads class="agent-threads" hidden></div>
      <div class="agent-status-row"><p class="agent-connection" role="status" data-agent-connection>正在连接…</p><button type="button" data-agent-connect title="重新检查连接" aria-label="重新检查连接">${icon('M20.5 4v5.5H15M3.5 20v-5.5H9M4.5 8a8.5 8.5 0 0 1 14-2l2 3.5M19.5 16a8.5 8.5 0 0 1-14 2l-2-3.5')}</button></div>
      <div class="agent-access" data-agent-access hidden><div data-agent-permissions></div><a href="../options.html#page=models" target="_blank" rel="noopener">连接与模型设置 ↗</a></div>
      <div class="agent-messages article-chat-messages" data-agent-messages role="log" aria-label="Agent 对话" aria-live="polite"><div class="agent-empty"><span class="agent-empty-symbol" aria-hidden="true">${icon('m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z')}</span><strong>一起推进你的研究</strong><p>从文献证据，到假说与实验设计。</p><div class="agent-suggestions"><button type="button" data-agent-suggest="读取当前假说和已有证据，找出尚缺少验证的联系；先给出建议，不修改画布。">梳理证据缺口 <span>↗</span></button><button type="button" data-agent-suggest="根据当前假说和已有文献，建议一张机制图的节点与联系。区分观察与推断，标明来源；先给出方案供我核对。">构思机制图 <span>↗</span></button><button type="button" data-agent-suggest="根据当前假说，规划关键实验和对照组，并说明每个 Panel 要回答的问题；先给出方案，不修改画布。">规划实验组图 <span>↗</span></button></div></div></div>
      <button type="button" data-agent-latest hidden>回到最新消息 ↓</button>
      <form class="article-chat-composer" data-agent-form><label class="field"><span>交给 Agent 的任务</span><textarea data-agent-task rows="3" maxlength="32000" aria-label="交给 Agent 的任务" placeholder="描述研究任务，或继续追问…"></textarea></label><div class="agent-composer-toolbar"><div class="agent-config"><select data-agent-provider aria-label="Agent 服务"><option value="codex-local">Codex</option><option value="deepseek-harness">DeepSeek Harness</option></select><select data-agent-model aria-label="Agent 模型"><option value="auto">自动</option></select><select data-agent-effort aria-label="推理强度" title="推理强度" hidden></select></div><button type="button" data-agent-stop hidden aria-label="停止生成" title="停止生成">${icon('M7 7h10v10H7z')}</button><button type="submit" data-agent-send disabled aria-label="发送任务" title="发送 · Enter（Shift+Enter 换行）">${icon('M12 19V5m-6 6 6-6 6 6')}</button></div></form>`;
    const q=selector=>container.querySelector(selector),provider=q('[data-agent-provider]'),model=q('[data-agent-model]'),send=q('[data-agent-send]'),stop=q('[data-agent-stop]'),connection=q('[data-agent-connection]'),messages=q('[data-agent-messages]');let epoch=0,ready=false,running=false,connectionInfo=null,deletionApproved=false,activeTurn=null,stopping=false,following=true;
    const access=q('[data-agent-access]'),accessToggle=q('[data-agent-access-toggle]'),effort=q('[data-agent-effort]');
    const rememberKey='brevess-workbench-agent-choice-v1';
    let choices={},sourceGeneration=0,refreshTimer=null,destroyed=false,opened=false,capabilityPending=false,effortEpoch=0;
    const effortLabels={auto:'自动',minimal:'极低',low:'低',medium:'中',high:'高',xhigh:'极高',max:'最高',ultra:'Ultra',enabled:'开启',disabled:'关闭',standard:'标准',deep:'深入',off:'关闭',none:'无'};
    const apiNames={agent:'本机 Agent',external:'已接入的 Agent',api:'API 连接'};
    const opt=(value,label)=>{const o=document.createElement('option');o.value=value;o.textContent=label;return o;};
    function showAccess(show){access.hidden=!show;accessToggle.setAttribute('aria-expanded',String(show));}
    accessToggle.onclick=()=>showAccess(access.hidden);
    container.addEventListener('keydown',e=>{if(e.key==='Escape'&&!access.hidden){e.stopPropagation();showAccess(false);accessToggle.focus();}});
    function updateEffort(info=connectionInfo){
      const entry=info?.models?.find(m=>m.id===model.value),levels=entry?.reasoningEfforts||[];
      const current=choices[provider.value]?.model===model.value?choices[provider.value].effort:undefined;
      effort.replaceChildren(...(levels.length?['auto',...levels.filter(v=>v!=='auto')]:[]).map(v=>opt(v,effortLabels[v]||v)));
      effort.hidden=!levels.length;
      if(levels.length)effort.value=levels.includes(current)?current:'auto';
    }
    function displayConnection(){
      const desktop=model.value==='client-default'||connectionInfo?.delegated&&connectionInfo.models.length===1;
      const prefix=desktop?'客户端接单':provider.value.startsWith('client:')?'已读取模型':'已连接';
      connection.textContent=prefix+' · '+(provider.selectedOptions[0]?.textContent||'Agent');
      connection.title=desktop?'由已连接的桌面 Agent 等待并领取 BREVESS 任务。':connectionInfo?.label||'';
      onStatus(connection.textContent);
    }
    function remember(){choices[provider.value]={model:model.value,effort:effort.value||'auto'};choices.selected=provider.value;try{localStorage.setItem(rememberKey,JSON.stringify(choices));}catch{}}
    try{choices=JSON.parse(localStorage.getItem(rememberKey)||'{}')||{};}catch{}
    async function refreshSources(force=false){
      if(!sourceCatalog||running||destroyed)return;
      const generation=++sourceGeneration;
      try{
        const {rows,externalKnown}=await sourceCatalog();if(destroyed||generation!==sourceGeneration||running||!rows?.length)return;
        if(externalKnown===false)for(const o of provider.options)if(o.value.startsWith('client:')&&!rows.some(r=>r.id===o.value))rows.push({id:o.value,label:o.text,kind:'external'});
        const signature=JSON.stringify(rows),previous=provider.dataset.sources?provider.value:choices.selected;
        if(provider.dataset.sources!==signature){
          provider.dataset.sources=signature;provider.replaceChildren();
          for(const kind of ['agent','external','api']){const group=document.createElement('optgroup');group.label=apiNames[kind];for(const row of rows.filter(r=>r.kind===kind))group.append(opt(row.id,row.label));if(group.children.length)provider.append(group);}
          provider.value=rows.some(x=>x.id===previous)?previous:rows[0].id;
          if(!connectionInfo||provider.value!==previous){model.replaceChildren();await check();return;}
        }
        if(force&&!ready)await check();
      }catch{if(!ready&&!destroyed)await check();}
    }
    const refreshSoon=()=>{if(!opened||document.hidden||destroyed)return;clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>void refreshSources(true),100);};
    const storageChanged=(changes,area)=>{if(area==='local')refreshSoon();};
    globalThis.chrome?.storage?.onChanged?.addListener(storageChanged);
    window.addEventListener('focus',refreshSoon);document.addEventListener('visibilitychange',refreshSoon);
    provider.addEventListener('pointerdown',()=>void refreshSources());provider.addEventListener('focus',()=>void refreshSources());
    const poll=setInterval(()=>{if(opened&&!container.hidden&&!document.hidden&&!running)void refreshSources();},5000);
    model.onchange=async()=>{capabilityPending=false;const token=++effortEpoch;updateEffort();remember();
      if(ready)displayConnection();
      if(connectionInfo?.perModel && !running){const source=provider.value,key=model.value;capabilityPending=true;controls();
        try{const info=await connect(source,key);if(token===effortEpoch&&source===provider.value&&key===model.value){connectionInfo=info;updateEffort();}}
        catch(error){if(token===effortEpoch){ready=false;connection.textContent=safeError(error);}}
        finally{if(token===effortEpoch){capabilityPending=false;controls();}}}
    };effort.onchange=remember;
    const input=q('[data-agent-task]'),latest=q('[data-agent-latest]');
    let threadId=null,historyLoading=!!conversations,historyBusy=false,historyEpoch=0;
    if(surface==='settings'){
      const empty=messages.querySelector('.agent-empty');
      empty.querySelector('strong').textContent='BREVESS 设置助手';empty.querySelector('p').textContent='查看连接、模型与阅读偏好。';
      const tasks=['查看已连接的服务','如何选择适合的推理强度？','在哪里管理阅读提示词？'];
      empty.querySelectorAll('[data-agent-suggest]').forEach((b,i)=>{b.dataset.agentSuggest=tasks[i];b.firstChild.textContent=tasks[i];});
      input.placeholder='询问 BREVESS 设置…';
    }
    const welcome=messages.firstElementChild?.cloneNode(true);
    const threadList=q('[data-agent-threads]'),historyButton=q('[data-agent-history]'),newButton=q('[data-agent-new]');
    function showThreadList(show){if(!threadList)return;threadList.hidden=!show;historyButton?.setAttribute('aria-expanded',String(show));}
    async function loadThreads(action='list',id=null,show=false){
      if(!conversations||running)return;
      const token=++historyEpoch;historyLoading=true;controls();
      try{const data=await conversations({action,id});if(token!==historyEpoch)return;
        if(data.denied){historyButton.hidden=newButton.hidden=true;showThreadList(false);if(threadId){messages.replaceChildren();activeTurn=null;}threadId=null;return;}
        historyButton.hidden=newButton.hidden=false;
        const changed=threadId!==data.current;threadId=data.current;threadList.replaceChildren();
        for(const item of data.items){const b=document.createElement('button');b.type='button';b.setAttribute('aria-pressed',String(item.id===threadId));b.textContent=item.title;b.title=new Date(item.updated).toLocaleString();b.onclick=()=>void loadThreads('select',item.id);threadList.append(b);}
        if(!data.items.length)threadList.textContent='暂无历史会话';
        if(!show||changed){messages.replaceChildren();activeTurn=null;turnSequence=0;for(const t of data.turns||[])api.replay(t);if(!messages.children.length&&welcome)messages.append(welcome.cloneNode(true));}
        showThreadList(show);if(action!=='list')input.focus();
      }catch(e){if(token===historyEpoch){onStatus('会话记录暂时无法读取');connection.textContent='会话记录暂时无法读取';}}
      finally{if(token===historyEpoch){historyLoading=false;controls();}}
    }
    if(historyButton)historyButton.onclick=()=>threadList.hidden?void loadThreads('list',null,true):showThreadList(false);
    if(newButton)newButton.onclick=()=>void loadThreads('new');
    const element=(tag,cls='',text='')=>{const node=document.createElement(tag);node.className=cls;node.textContent=text;return node;};
    const nearEnd=()=>messages.scrollHeight-messages.clientHeight-messages.scrollTop<48;
    function follow(force=false){if(force||following){messages.scrollTop=messages.scrollHeight;following=true;latest.hidden=true;}else latest.hidden=false;}
    messages.addEventListener('scroll',()=>{following=nearEnd();latest.hidden=following;},{passive:true});
    latest.onclick=()=>follow(true);
    input.addEventListener('input',()=>{controls();input.style.height='auto';input.style.height=Math.min(180,Math.max(78,input.scrollHeight))+'px';});
    messages.addEventListener('click',event=>{const button=event.target.closest('[data-agent-suggest]');if(button){input.value=button.dataset.agentSuggest;input.dispatchEvent(new Event('input'));input.focus();}});
    input.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&event.keyCode!==229&&!event.altKey&&!event.ctrlKey&&!event.metaKey){event.preventDefault();if(!send.disabled)q('[data-agent-form]').requestSubmit();}});
    function begin(task){q('.agent-empty')?.remove();activeTurn=element('section','article-chat-turn');activeTurn.dataset.agentTurn=String(++turnSequence);activeTurn.setAttribute('aria-label','任务 '+turnSequence);activeTurn.tools=new Map();messages.append(activeTurn);message(task,'user');activeTurn.progress=element('p','agent-run-status','正在准备任务…');activeTurn.progress.setAttribute('role','status');activeTurn.append(activeTurn.progress);const turns=messages.querySelectorAll('.article-chat-turn');if(!conversations&&turns.length>100)turns[0].remove();follow(true);}
    let turnSequence=0;
    function terminal(state,error){if(!activeTurn||activeTurn.dataset.terminal)return;activeTurn.dataset.terminal=state;const status=state==='completed'?'任务已完成':state==='cancelled'?'已停止 · 已有回答和操作回执已保留':'任务未完成 · '+safeError(error);activeTurn.progress.textContent=status;activeTurn.progress.classList.toggle('is-error',state==='failed');if(state==='completed'&&!activeTurn.querySelector('.agent-tool.is-error')){const detail=activeTurn.querySelector('.agent-tools');if(detail)detail.open=false;}for(const row of activeTurn.tools.values())if(row.dataset.state==='running'){row.dataset.state=state==='completed'?'unconfirmed':'stopped';row.textContent=(state==='completed'?'未收到结果：':'已停止等待：')+row.dataset.label;}onStatus('Agent '+status);follow();}
    const heading=q('.agent-heading');heading.setAttribute('aria-label',docked?'Agent 侧栏':'拖动 Agent 窗口');let position=null;
    function place(rect){if(docked)return;position=globalThis.Workbench.clampFloatingPanel(rect,{w:innerWidth,h:innerHeight});Object.assign(container.style,{left:position.x+'px',top:position.y+'px',right:'auto',bottom:'auto',width:position.w+'px',height:position.h+'px'});}
    function rect(){const r=container.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};}
    heading.addEventListener('pointerdown',event=>{if(docked||event.button!==0||event.target.closest('button,input,textarea,select,a'))return;event.preventDefault();event.stopPropagation();const before=rect(),start={x:event.clientX,y:event.clientY};heading.setPointerCapture(event.pointerId);heading.classList.add('dragging');const move=e=>place({...before,x:before.x+e.clientX-start.x,y:before.y+e.clientY-start.y}),finish=()=>{heading.classList.remove('dragging');heading.removeEventListener('pointermove',move);heading.removeEventListener('pointerup',finish);heading.removeEventListener('pointercancel',finish);};heading.addEventListener('pointermove',move);heading.addEventListener('pointerup',finish,{once:true});heading.addEventListener('pointercancel',finish,{once:true});});
    const onResize=()=>{if(!container.hidden)place(rect());else if(position)position=globalThis.Workbench.clampFloatingPanel(position,{w:innerWidth,h:innerHeight});};if(!docked)window.addEventListener('resize',onResize);
    function message(text,kind='message'){
      if(kind==='user'&&!activeTurn){begin(String(text));return;}
      if(!activeTurn){q('.agent-empty')?.remove();activeTurn=element('section','article-chat-turn');activeTurn.tools=new Map();messages.append(activeTurn);activeTurn.progress=element('p','agent-run-status');activeTurn.append(activeTurn.progress);}
      const prose=kind==='message'||kind==='user',row=element('div',prose?'article-chat-message '+(kind==='user'?'is-user':'is-assistant'):'agent-notice '+kind);
      if(prose){row.setAttribute('data-i18n-ignore','');row.append(element('div','article-chat-message-meta',kind==='user'?'你':'Agent'));if(kind==='message')row.append(renderer.renderArticleChatMarkdown(String(text)));else row.append(element('div','agent-user-text',String(text)));}
      else row.textContent=String(text);
      if(activeTurn.progress)activeTurn.insertBefore(row,activeTurn.progress);else activeTurn.append(row);follow();return row;
    }
    function tool(event){
      if(!activeTurn)return;let group=activeTurn.querySelector('.agent-tools');
      if(!group){group=element('details','agent-tools');group.open=true;group.append(element('summary','','工具活动'));activeTurn.insertBefore(group,activeTurn.progress);}
      const callId=String(event.id||event.name),round=activeTurn.round||0,key=round+':'+callId,name=label(event.name);let row=activeTurn.tools.get(key);
      if(!row){row=element('div','agent-tool');row.dataset.agentTool=callId;row.dataset.agentRound=String(round);row.dataset.label=name;activeTurn.tools.set(key,row);group.append(row);}
      row.dataset.state=event.type==='tool_start'?'running':event.success?'completed':'failed';row.classList.toggle('is-error',row.dataset.state==='failed');
      row.textContent=(event.type==='tool_start'?'正在':event.success?'已完成：':'未完成：')+name+(event.type==='tool_result'&&!event.success?' · '+safeError(event.error):'');
      group.querySelector('summary').textContent='工具活动 · '+activeTurn.tools.size+' 项';if(!event.success&&event.type==='tool_result')group.open=true;follow();
    }
    const labels={read_context:'读取工作台',list_projects:'查看课题列表',get_project:'读取课题',query_library:'搜索本地文献',read_literature:'读取文献与证据',create_project:'创建课题',edit_project:'修改课题',remove_entity:'移入回收站',undo:'撤销',redo:'重做',list_recycle:'查看回收站',restore:'恢复对象',model_operation:'编辑假说与组图',navigate:'切换工作区',save_view:'保存视图',invoke_action:'调整工作台',import_project:'导入课题',export_project:'导出课题',import_asset:'保存自有图片',read_asset:'读取图片',locate_source:'定位文献来源',clipboard:'复制与粘贴',local_data:'操作本地文献数据',radar_list:'查看文献追踪任务',radar_get:'读取追踪文献',radar_save:'保存追踪任务',radar_check:'检查新增文献',radar_mark_read:'标记文献阅读状态'};const label=name=>toolLabels[name]||labels[name]||'工具操作';const explanations={AGENT_LOCAL_DATA_VERSION_CHANGED:'数据在确认期间发生变化，未执行这次操作。请重新读取并确认。',WORKSPACE_DELETION_CONFLICT:'数据版本已更新，旧授权未执行。',AGENT_LOCAL_DATA_APPROVAL_DENIED:'你未批准这次操作，已保留数据。',AGENT_LOCAL_DATA_APPROVAL_EXPIRED:'授权预览已过期，未执行操作。',WORKBENCH_AGENT_PROJECT_CHANGED:'课题已切换，后续操作已停止；请核对已完成回执。',WORKBENCH_AGENT_STALE_REVISION:'课题已有新的修改，请重新读取后再操作。'};
    Object.assign(labels,{list_document_types:'读取待分类论文',fill_document_types:'批量填写文献类型',query_global_library:'查询文献总库',read_library_catalog:'读取目录和标签',command_library_catalog:'整理文献总库'});
    labels.data_directory='创建或打开数据目录';
    const errorHints={AGENT_CLIENT_LOGIN_REQUIRED:'客户端命令行要求登录。可在模型菜单选择「桌面客户端接单」，或在该客户端命令行登录后重试。',AGENT_CLIENT_NOT_REGISTERED:'客户端登记已变更，请重新检查连接。',AGENT_CLIENT_TURN_FAILED:'客户端未完成这次请求。请检查其登录和模型可用性。',CONSENT_REQUIRED:'请先在设置的隐私与权限中允许模型处理内容。',WORKBENCH_AGENT_EFFORT_CHANGED:'该模型可用的推理强度已变动，请重新选择。',DOCUMENT_CONTEXT_CHANGED:'当前文献已变化，请重新打开对应图表后继续。',DOCUMENT_SCOPE_REQUIRED:'修改本篇图表前，请在操作权限中核对并授权本篇。',DOCUMENT_CONTEXT_UNAVAILABLE:'当前文献图表尚未就绪，请先打开解图画板。',WORKBENCH_AGENT_PERMISSION_DENIED:'此操作尚未授权。需要时可在上方“操作权限”开启相应权限。',WORKBENCH_AGENT_PERMISSION_REVOKED:'操作权限已变化，本次操作已停止。请核对权限后重试。',WORKBENCH_AGENT_PARTIALLY_COMMITTED:'部分操作已保存，后续操作已停止；请核对回执。',WORKBENCH_AGENT_STATUS_UNCONFIRMED:'连接响应未确认，已提交的操作不会回滚；请核对已有回执和保存结果。',WORKBENCH_AGENT_BINDING_EXPIRED:'工作台已切换，请重新连接当前工作台。',WORKBENCH_AGENT_HOST_UNAVAILABLE:'请先打开课题工作台，等待加载后重新连接。',WORKBENCH_AGENT_DISCONNECTED:'与工作台的连接已断开，请重新连接。',NETWORK_ERROR:'网络或服务连接未完成，请检查连接后手动重新发送。',CANCELLED:'任务已停止。',WORKBENCH_AGENT_INVALID_RESPONSE:'模型回复格式无效，未执行该轮操作。',WORKBENCH_AGENT_INCOMPLETE_TURN:'模型响应没有完整结束，未执行该轮操作。',WORKBENCH_AGENT_TURN_FAILED:'本地模型未成功完成响应。',WORKBENCH_AGENT_MODEL_UNAVAILABLE:'所选模型已不可用，请检查服务设置。',WORKBENCH_AGENT_LIMIT:'达到本次操作或推理轮数上限。',WORKBENCH_AGENT_CORRECTION_LIMIT:'操作纠正后仍未完成，请核对工具回执。',WORKBENCH_AGENT_NO_PROGRESS:'重复处理后没有进展，请核对工具回执。',WORKBENCH_AGENT_TOOL_UNRESOLVED:'仍有操作未完成，请核对工具回执。',CODEX_BRIDGE_UNAVAILABLE:'Codex 本地连接未就绪。',HARNESS_NOT_AUTHENTICATED:'请在 DeepSeek Harness 中登录。',HARNESS_MODEL_UNAVAILABLE:'Harness 没有可用模型。',WORKBENCH_SHARED_READ_ONLY:'共享课题为只读，未执行修改。',WORKBENCH_PRESENTATION_READ_ONLY:'演示模式为只读，未执行修改。'};
    function safeError(error={}){const code=Object.prototype.hasOwnProperty.call(explanations,error?.code)||Object.prototype.hasOwnProperty.call(errorHints,error?.code)?error.code:'AGENT_REQUEST_FAILED';return (explanations[code]||errorHints[code]||'请求未完成，请核对当前状态后再试。')+'（'+code+'）';}

    function controls(){if(historyButton){historyButton.disabled=newButton.disabled=running||historyLoading;}provider.disabled=running;model.disabled=running||!ready;effort.disabled=running||!ready||capabilityPending;q('[data-agent-connect]').disabled=running;send.disabled=!ready||running||capabilityPending||historyLoading||!input.value.trim();send.hidden=running;stop.hidden=!running;stop.disabled=!running||stopping;stop.title=stopping?'正在停止…':'停止生成';stop.setAttribute('aria-label',stop.title);}
    async function check(){const current=++epoch,id=provider.value,previousModel=model.value||choices[id]?.model;ready=false;controls();connection.dataset.state='connecting';connection.textContent='正在检查连接…';try{let info;
      try{info=await connect(id,previousModel||undefined);}catch(error){
        if(!previousModel||!['MODEL_UNAVAILABLE','WORKBENCH_AGENT_MODEL_UNAVAILABLE'].includes(error.code))throw error;
        info=await connect(id);
      }
      if(current!==epoch)return;connectionInfo=info;const models=Array.isArray(info?.models)?info.models.filter(entry=>typeof entry?.id==='string'&&entry.id):[];if(!models.length)throw {code:'WORKBENCH_AGENT_MODEL_UNAVAILABLE'};model.replaceChildren();for(const entry of models){const option=document.createElement('option');option.value=entry.id;option.textContent=entry.name||entry.id;option.title=entry.id;model.append(option);}const selected=models.find(x=>x.id===previousModel)||models.find(x=>x.id===info.model);if(selected)model.value=selected.id;updateEffort(info);ready=true;connection.dataset.state='ready';displayConnection();}catch(error){if(current!==epoch)return;connectionInfo=null;connection.dataset.state='error';connection.textContent=safeError(error);onStatus('Agent 连接未就绪');}finally{if(current===epoch)controls();}}
    q('[data-agent-close]').onclick=()=>{container.hidden=true;};q('[data-agent-connect]').onclick=()=>void check();provider.onchange=()=>{epoch++;effortEpoch++;capabilityPending=false;ready=false;connectionInfo=null;model.replaceChildren();updateEffort();void check().then(()=>{if(ready)remember();});};stop.onclick=()=>{if(!running||stopping)return;stopping=true;controls();if(activeTurn?.progress)activeTurn.progress.textContent='正在停止…';if(deletionApproved)message('已请求停止。已经批准并开始的永久删除会完成，请核对随后显示的实际回执。','operation');cancel();};
    q('[data-agent-form]').onsubmit=async event=>{event.preventDefault();if(!ready||running||historyLoading||capabilityPending)return;showThreadList(false);const task=input.value.trim();if(!task)return;running=true;stopping=false;controls();begin(task);input.value='';input.style.height='';input.focus();try{const result=await start({task,providerId:provider.value,model:model.value,reasoningEffort:effort.value||'auto',connectionInfo,threadId});if(result?.threadId)threadId=result.threadId;terminal(result?.status==='failed'?'failed':result?.status==='cancelled'?'cancelled':'completed',result?.error);}catch(error){terminal(error?.code==='CANCELLED'?'cancelled':'failed',error);}finally{running=false;stopping=false;controls();}};
    const api={open(){opened=true;if(conversations&&!historyBusy){historyBusy=true;void loadThreads();}container.hidden=false;if(position)place(position);else place(rect());if(!ready&&!running){if(sourceCatalog)void refreshSources(true);else void check();}},destroy(){destroyed=true;clearInterval(poll);clearTimeout(refreshTimer);window.removeEventListener('focus',refreshSoon);document.removeEventListener('visibilitychange',refreshSoon);globalThis.chrome?.storage?.onChanged?.removeListener(storageChanged);epoch++;historyEpoch++;window.removeEventListener('resize',onResize);},message,replay(task){begin(String(task.task||''));for(const event of task.events||[])api.event(event);if(!activeTurn.dataset.terminal)terminal('failed',{code:'WORKBENCH_AGENT_STATUS_UNCONFIRMED'});},event(event){if(event.type==='tool_result')deletionApproved=false;
      if(event.type==='message')message(event.text);
      else if(event.type==='tool_start'||event.type==='tool_result'){tool(event);if(event.type==='tool_result'&&event.success&&event.name==='local_data'&&event.result?.deleted===true)message('所列文档工作区的插件本机数据已删除。'+(event.result.pendingDiskCleanup?'目录文件清理尚未完成，请在存储设置检查权限并重试。':event.result.permission==='unconfigured'?'未配置保存目录，未执行目录文件清理。':'目录文件清理已完成。'),'receipt');}
      else if(event.type==='format_repair'&&activeTurn?.progress){activeTurn.progress.textContent='正在校正回复格式…';}
      else if(event.type==='round'){const desktop = model.value === 'client-default' || connectionInfo?.delegated && connectionInfo.models.length === 1;
        const text = desktop ? '等待桌面客户端回答 · 请在已启用 BREVESS 连接器的会话中领取任务，回答将出现在这里。' : '正在处理 · 第 '+event.round+' 轮';if(activeTurn){activeTurn.round=Number(event.round)||0;if(activeTurn.progress)activeTurn.progress.textContent=text;}onStatus('Agent '+text);follow();}
      else if(event.type==='completed')terminal('completed');else if(event.type==='cancelled')terminal('cancelled');else if(event.type==='error')terminal('failed',event.error);
    },requestApproval(preview,{signal}={}){
      container.hidden=false;return new Promise(resolve=>{const card=document.createElement('div');card.className='agent-approval';const title=document.createElement('strong');title.textContent=preview.operation==='delete_workspace'?'批准删除论文数据':'批准修改本地数据';const summary=document.createElement('p');summary.textContent=preview.operation==='delete_workspace'?'删除论文《'+(preview.workspace?.title||'未命名论文')+'》所列文档工作区的保存数据：'+(preview.assets?.length||0)+' 项公开资源、'+(preview.turns?.length||0)+' 条对话及其他内部记录，以及目录原件、备份和冲突副本。':preview.summary||preview.title||preview.workspace?.title||'请核对下列数据范围';const note=document.createElement('p');note.textContent=preview.operation==='delete_workspace'?'此操作会永久删除所列文档工作区的数据及目录备份，不能通过工作台撤销。':'修改范围和批准时的数据版本如下。';const details=document.createElement('details'),label=document.createElement('summary'),body=document.createElement('pre');label.textContent='查看具体数据与版本';body.textContent=JSON.stringify(preview,null,2);details.append(label,body);const yes=document.createElement('button'),no=document.createElement('button');yes.type=no.type='button';yes.textContent=preview.operation==='delete_workspace'?'批准删除所列数据':'批准所列修改';no.textContent='拒绝';card.append(title,summary,note,details,yes,no);if(activeTurn?.progress)activeTurn.insertBefore(card,activeTurn.progress);else (activeTurn||messages).append(card);follow(true);let settled=false;
        const finish=approved=>{if(settled)return;settled=true;if(approved&&preview.operation==='delete_workspace')deletionApproved=true;yes.disabled=no.disabled=true;signal?.removeEventListener('abort',aborted);const result=document.createElement('p');result.textContent=approved?'你已批准这一次操作':'未批准，保留本地数据';card.append(result);resolve({approved,approvalId:preview.approvalId});};const aborted=()=>finish(false);yes.onclick=event=>{if(event.isTrusted)finish(true);};no.onclick=()=>finish(false);signal?.addEventListener('abort',aborted,{once:true});if(signal?.aborted)finish(false);
      });
    }};return api;
  }
  return {createAgentPanel};
});
