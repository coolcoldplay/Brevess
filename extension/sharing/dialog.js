(function () {
  'use strict';
  const client = globalThis.BrevessSharingClient;
  const scriptBase = new URL('.', globalThis.chrome?.runtime?.getURL ? chrome.runtime.getURL('sharing/dialog.js') : document.currentScript.src);
  const pageURL = globalThis.chrome?.runtime?.getURL ? chrome.runtime.getURL('sharing/index.html') : new URL('index.html', scriptBase).href;
  const cssURL = globalThis.chrome?.runtime?.getURL ? chrome.runtime.getURL('sharing/sharing.css') : new URL('sharing.css', scriptBase).href;
  const contentContext = !!globalThis.chrome?.runtime?.getURL && !globalThis.location.href.startsWith(chrome.runtime.getURL(''));
  const shadowMode = contentContext ? 'closed' : 'open';
  const labels = { private: '仅个人可见', group: '课题组内共享', public: '公开' };
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function previewBody(resource) {
    const body=resource.body||{};
    if(resource.kind==='hypothesis'){
      const names=new Map((body.nodes||[]).map(node=>[node.id,node.label]));
      return `<h4>假说节点</h4>${(body.nodes||[]).map(node=>`<p><strong data-i18n-ignore>${escape(node.label)}</strong></p><pre>${escape(node.text||'')}</pre>`).join('')}<h4>关系与人工判断</h4>${(body.edges||[]).map(edge=>`<p><span data-i18n-ignore>${escape(names.get(edge.source)||'Node')}</span> → <span data-i18n-ignore>${escape(names.get(edge.target)||'Node')}</span> · ${escape({main:'主线',branch:'分支',feedback:'反馈'}[edge.kind])}</p><pre>${escape([edge.label,edge.text].filter(Boolean).join('\n'))}</pre>`).join('')}`;
    }
    if(resource.kind==='figure_plan')return `<h4>Panel 规划</h4>${(body.panels||[]).map(panel=>`<p><strong data-i18n-ignore>${escape(panel.label)}</strong></p><pre>${escape(panel.text||'')}</pre>`).join('')}<h4>证据块</h4>${(body.evidenceBlocks||[]).map(block=>`<p><strong data-i18n-ignore>${escape(block.title)}</strong></p><pre>${escape(block.summary||'')}</pre>`).join('')}`;
    return '';
  }
  function previewSource(source) {
    const labels={doi:'DOI',url:'在线来源',documentHash:'文档版本',figureId:'Figure',panelId:'Panel',paragraphId:'段落',annotationId:'高亮备注',quote:'定位短引文',prefix:'前文定位',suffix:'后文定位',blockFingerprint:'段落标识',startOffset:'起始位置',endOffset:'结束位置'};
    return Object.keys(source).length?'<h4>来源定位</h4>'+Object.entries(source).map(([key,value])=>`<p><strong>${labels[key]||escape(key)}：</strong><span data-i18n-ignore>${escape(value)}</span></p>`).join(''):'';
  }
  let active = null;
  async function open(input) {
    if (active) { active.focus(); return { status: 'cancelled' }; }
    let projected, projectionError;
    try { projected = client.projection(input); } catch (error) {
      if(error.code!=='SENSITIVE_CONTENT'){globalThis.alert(globalThis.SciLLM?.translateInterfaceText?.(error.message)||error.message);return {status:'error',error};}
      projectionError=error;
      projected={kind:input.kind,title:'当前本机内容不能共享',text:error.message,source:{},body:{},links:[]};
    }
    const reviewedInput={...projected,localKey:input.localKey};
    const host = document.createElement('div');
    host.dataset.brevessSharing = 'dialog';
    if (globalThis.location.pathname?.includes('/workbench/')) host.classList.add('brevess-sharing-workbench');
    const shadow = host.attachShadow({ mode: shadowMode });
    const stopTranslation=globalThis.SciLLM?.observeInterfaceRoot?.(shadow);
    shadow.innerHTML = `<link rel="stylesheet" href="${escape(cssURL)}"><dialog class="sharing-dialog" aria-labelledby="sharing-title"><header><div><p class="eyebrow">BREVESS</p><h2 id="sharing-title">此条内容的可见性</h2></div><button class="icon-button" data-close aria-label="关闭可见性设置">×</button></header><p class="privacy-note">作者编辑，课题组成员阅读。仅个人可见是旧记录与新记录的默认值；共享不会改动本机原文和来源定位。</p><p data-account class="muted" role="status">正在读取账号与当前权限…</p><label>可见范围<select data-visibility aria-label="可见范围"><option value="private">仅个人可见</option><option value="group">课题组内共享</option>${['highlight_note','panel_note'].includes(input.kind)?'<option value="public">公开</option>':''}</select></label><label data-group-wrap hidden>共享到课题组<select data-group aria-label="共享到课题组"></select></label><p data-explainer class="muted"></p><details open><summary>实际将发送的内容 · 请逐项检查</summary><div class="preview"><h3 ${projected.title&&!projectionError?'data-i18n-ignore':''}>${escape(projected.title || '未命名')}</h3>${projected.text&&!projectionError?'<pre>'+escape(projected.text)+'</pre>':'<p>'+escape(projected.text||'（空白备注）')+'</p>'}${previewSource(projected.source)}${previewBody(projected)}<p>关联已发布资源：${projected.links.length} 条（阅读时逐条鉴权）</p></div></details><p class="muted">不上传整篇论文、截图、附件、本机路径或来源快照。父条目共享不会自动共享关联条目。取消共享无法收回别人此前已阅读或复制的内容。</p><p class="message" data-message role="status" aria-live="polite"></p><footer><a href="${escape(pageURL)}" target="_blank" rel="noopener">账号、课题组与共享中心 ↗</a><div><button data-close>取消</button><button class="primary" data-save disabled>保存可见性</button></div></footer></dialog>`;
    document.documentElement.appendChild(host);
    const dialog = shadow.querySelector('dialog'); active = dialog;
    const $ = selector => shadow.querySelector(selector), visibility = $('[data-visibility]'), group = $('[data-group]'), message = $('[data-message]'), save = $('[data-save]');
    visibility.disabled = true; group.disabled = true;
    let state, auth, readable = true, busy = false, result = { status: 'cancelled' };
    const update = () => {
      $('[data-group-wrap]').hidden = visibility.value !== 'group';
      $('[data-explainer]').textContent = visibility.value === 'public' ? '所有已注册并登录 BREVESS 的用户可检索与阅读此条备注；未登录访客不能阅读。' : visibility.value === 'group' ? '仅作者与所选课题组的当前成员可读；成员退出或被移出后失去访问。' : state?.resourceId ? '服务确认后立即停止公开和课题组访问。' : '内容保留在本机，此操作不会上传。';
      save.disabled = busy || !readable || !state || (visibility.value !== 'private' || !!state.resourceId) && !auth?.user || visibility.value === 'group' && !group.value || !!projectionError && visibility.value !== 'private';
    };
    visibility.onchange = update; group.onchange = update;
    const completed = new Promise(resolve => dialog.addEventListener('close', () => { active = null; stopTranslation?.(); host.remove(); resolve(result); }, { once: true }));
    for (const button of shadow.querySelectorAll('[data-close]')) button.onclick = () => { if (!busy) dialog.close(); };
    dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
    dialog.showModal();
    try {
      auth = await client.getSession();
      state = await client.getLocalState(input.localKey);
      if (state.resourceId) state = await client.refresh(input.localKey);
      if (!dialog.isConnected) return completed;
      visibility.value = state.visibility;
      $('[data-account]').textContent = auth.user ? `账号：${auth.user.username} · ${auth.endpoint}` : '尚未登录。选择共享前，请打开共享中心登录，然后重新打开此预览。';
      if (auth.user) {
        const groups = (await client.api('/api/groups')).groups;
        group.innerHTML = '<option value="">选择课题组</option>' + groups.map(row => `<option data-i18n-ignore value="${escape(row.id)}">${escape(row.name)}</option>`).join('');
        group.value = state.groupId || '';
      }
      if(projectionError)message.textContent='当前内容检测未通过，可选择“仅个人可见”撤销已有共享。';
      visibility.disabled = false; group.disabled = false;
      update();
    } catch (error) { readable = false; message.textContent = `${error.message} 当前服务权限未确认，请关闭后重试；本机内容未变。`; update(); }
    save.onclick = async event => {
      if (!event.isTrusted) { message.textContent = '请亲自点击保存可见性。'; return; }
      busy = true; update(); message.textContent = '正在等待共享服务确认…';
      try {
        const current = await client.getSession();
        if (current.endpoint !== auth.endpoint || current.user?.id !== auth.user?.id) throw new Error('账号或服务已切换，请关闭后重新打开预览。');
        result = await client.save(reviewedInput, visibility.value, group.value || null, { ...state, account: { endpoint: auth.endpoint, userId: auth.user?.id } });
        message.textContent = result.localOnly ? '已保持仅个人可见，未上传。' : `服务已确认：${labels[result.resource.visibility]}`;
        busy = false; save.disabled = true; $('[data-close]').textContent = '×';
        const finish = shadow.querySelectorAll('[data-close]')[1]; finish.textContent = '完成';
        visibility.disabled = true; group.disabled = true;
      } catch (error) { message.textContent = `${error.message}${error.code === 'SERVER_SAVED_MAPPING_FAILED' ? '' : ' 本次可见性变更未确认生效。'}`; busy = false; if(error.code === 'SERVER_SAVED_MAPPING_FAILED')readable=false; update(); }
    };
    return completed;
  }
  async function discover(input) {
    if (!['highlight_note','panel_note'].includes(input?.kind)) throw new Error('此入口仅支持原文备注与 Panel 笔记');
    const source={};
    for(const key of ['documentHash','doi','url','figureId','panelId','paragraphId','blockFingerprint','quote'])if(typeof input.source?.[key]==='string'&&input.source[key])source[key]=input.source[key];
    for(const key of ['startOffset','endOffset'])if(Number.isSafeInteger(input.source?.[key])&&input.source[key]>=0)source[key]=input.source[key];
    const auth=await client.getSession();
    if(!auth.user)throw new Error('请先注册并登录 BREVESS 账号，再查看读者笔记。');
    const scope=input.groupId?{groupId:input.groupId}:input.visibility==='public'?{visibility:'public'}:{};
    return client.api('/api/discover','POST',{kind:input.kind,source,...scope,sort:['likes','newest','oldest'].includes(input.sort)?input.sort:'newest',...(Number.isInteger(input.limit)&&input.limit>=1&&input.limit<=200&&Number.isSafeInteger(input.offset)&&input.offset>=0?{limit:input.limit,offset:input.offset}:{})},{endpoint:auth.endpoint,userId:auth.user.id});
  }
  async function openReader(input) {
    if(active){active.focus();return {status:'cancelled'};}
    input={...input,source:{...input.source}};
    const host=document.createElement('div');host.dataset.brevessSharing='reader';
    if (globalThis.location.pathname?.includes('/workbench/')) host.classList.add('brevess-sharing-workbench');
    const shadow=host.attachShadow({mode:shadowMode});
    const stopTranslation=globalThis.SciLLM?.observeInterfaceRoot?.(shadow);
    shadow.innerHTML=`<link rel="stylesheet" href="${escape(cssURL)}"><dialog class="sharing-dialog reader-dialog" aria-labelledby="reader-title"><header><div><p class="eyebrow">BREVESS</p><h2 id="reader-title">${escape(input.title||'这里的读者笔记与讨论')}</h2></div><button class="icon-button" data-close aria-label="关闭读者笔记">×</button></header><p class="privacy-note">围绕同一来源交流。评论继承原备注的可见范围；备注撤销共享或成员离组后，评论访问也随之撤销。</p>${input.source?.quote?`<blockquote class="reader-sentence" data-i18n-ignore>${escape(input.source.quote)}</blockquote>`:''}<label>作者范围<select data-author-scope aria-label="筛选笔记与评论作者范围" disabled><option value="">${input.visibility==='public'?'所有已登录用户的公开讨论':'所有当前可读的作者'}</option></select></label><div class="reader-tabs" role="tablist" aria-label="笔记可见范围"><button role="tab" aria-selected="true" data-filter="all">所有</button><button role="tab" aria-selected="false" data-filter="public">公开</button><button role="tab" aria-selected="false" data-filter="group">课题组</button><button role="tab" aria-selected="false" data-filter="mine">我的</button></div><p data-message class="message" role="status" aria-live="polite"></p><section data-list class="reader-list" aria-label="读者笔记与评论列表"></section><footer><a href="${escape(pageURL)}" target="_blank" rel="noopener">注册 / 登录与课题组管理 ↗</a><div><button data-refresh>刷新权限</button><button data-close>关闭</button></div></footer></dialog>`;
    if(input.title&&!input.titleIsInterface)shadow.querySelector('#reader-title').setAttribute('data-i18n-ignore','');
    document.documentElement.appendChild(host);
    const $=selector=>shadow.querySelector(selector),dialog=$('dialog'),list=$('[data-list]'),message=$('[data-message]'),authorScope=$('[data-author-scope]');active=dialog;
    let rows=[],auth=null,filter='all',groupId=input.groupId||'',sort=['likes','newest','oldest'].includes(input.sort)?input.sort:'newest',generation=0,busy=false,mutating=false,memberGroups=[],startDraft='',startVisibility=groupId?'group':'public',startGroupId=groupId,panelComposerOpen=false;
    const drafts=new Map(),threads=new Map(),commentPages=new Map(),commentMore=new Map();
    let notePages=1,notesHaveMore=false;
    async function pagedRead(fetchPage,field,pages){let values=[],offset=0,more=false;for(let i=0;i<pages;i++){const result=await fetchPage(offset);values.push(...(result[field]||[]));more=result.hasMore===true;if(more&&(!Number.isSafeInteger(result.nextOffset)||result.nextOffset<=offset||result.nextOffset>1000000))throw new Error('分页结果无效，请刷新后重试。');if(!more)break;offset=result.nextOffset;}return {values:[...new Map(values.map(row=>[row.id,row])).values()],hasMore:more};}
    const resetPages=()=>{notePages=1;commentPages.clear();commentMore.clear();notesHaveMore=false;};
    const clear=(discardDrafts=false)=>{rows=[];threads.clear();list.replaceChildren();if(discardDrafts){drafts.clear();startDraft='';resetPages();}};
    const make=(tag,text,className,userContent=false)=>{const el=document.createElement(tag);el.textContent=text;if(className)el.className=className;if(userContent)el.setAttribute('data-i18n-ignore','');return el;};
    const account=()=>({endpoint:auth.endpoint,userId:auth.user.id});
    const dateText=value=>{const date=new Date(value);return Number.isNaN(date.getTime())?'':date.toLocaleString(globalThis.SciLLM?.getInterfaceLanguage?.()==='en'?'en':'zh-CN');};
    async function mutate(action,resourceId,clearDraft){
      if(mutating)return;mutating=true;busy=true;
      for(const control of list.querySelectorAll('button,textarea,select'))control.disabled=true;
      try{
        if(typeof input.onValidateSource==='function'&&await input.onValidateSource(input.source)===false)throw new Error('当前来源已变化，请重新打开评论入口。');
        await action();if(clearDraft)drafts.delete(resourceId);
        if(await reload())message.textContent='讨论已更新。';
      }catch(error){generation++;clear();message.textContent=error.status===409?'原备注已更新，请刷新并确认内容后重新评论。':'评论操作未确认，内容已清空以重新核验权限：'+error.message;}
      finally{mutating=false;busy=false;}
    }
    function likeButton(row,comment){
      const subject=comment||row,liked=subject.likedByMe===true,count=Number.isSafeInteger(subject.likeCount)?subject.likeCount:0;
      const button=make('button',`${liked?'已赞':'赞'} ${count}`,'reader-like');button.type='button';button.setAttribute('aria-pressed',String(liked));button.setAttribute('aria-label',(liked?'取消':'')+(comment?'评论点赞':'原备注点赞'));if(comment)button.dataset.likeComment=comment.id;else button.dataset.likeResource=row.id;
      button.onclick=event=>{if(event.isTrusted)mutate(()=>client.setLike(row.id,comment?.id,!liked,account()),row.id,false);};return button;
    }
    function startComposer(){
      const form=document.createElement('form');form.className='reader-start-form';
      form.append(make('h3','发起这个 Panel 的讨论'),make('p',`来源：Figure ${input.source.figureId} · Panel ${input.source.panelId}`,'muted'));
      const label=make('label','首条评论'),textArea=document.createElement('textarea');textArea.dataset.commentFor='__new_panel__';textArea.rows=4;textArea.maxLength=4000;textArea.required=true;textArea.value=startDraft;textArea.placeholder='写下对这个 Panel 的理解、问题或补充…';textArea.setAttribute('aria-label','Panel 首条评论');textArea.oninput=()=>{startDraft=textArea.value;};label.append(textArea);form.append(label);
      const visibilityLabel=make('label','发送范围'),visibilitySelect=document.createElement('select');visibilitySelect.setAttribute('aria-label','首条评论发送范围');
      for(const [value,title]of [['public','公开 · 已注册并登录的 BREVESS 用户'],['group','仅所选课题组成员']]){const option=make('option',title);option.value=value;visibilitySelect.append(option);}visibilitySelect.value=startVisibility;visibilityLabel.append(visibilitySelect);form.append(visibilityLabel);
      const groupLabel=make('label','选择课题组'),groupSelect=document.createElement('select');groupSelect.setAttribute('aria-label','首条评论课题组');groupSelect.required=true;const empty=make('option','请选择课题组');empty.value='';groupSelect.append(empty);for(const group of memberGroups){const option=make('option',group.name,'',true);option.value=group.id;groupSelect.append(option);}groupSelect.value=memberGroups.some(group=>group.id===startGroupId)?startGroupId:'';groupLabel.append(groupSelect);form.append(groupLabel);
      const scopeNote=make('p','','muted');form.append(scopeNote);
      const update=()=>{startVisibility=visibilitySelect.value;startGroupId=groupSelect.value;groupLabel.hidden=startVisibility!=='group';groupSelect.disabled=startVisibility!=='group';scopeNote.textContent=startVisibility==='group'?'首条评论与后续回复仅作者和所选课题组当前成员可读。':'首条评论与后续回复向所有已注册并登录的 BREVESS 用户开放。';};visibilitySelect.onchange=update;groupSelect.onchange=update;update();
      form.append(make('p','这是独立的在线讨论，不会改写你的本机 Panel 笔记。','muted'));const send=make('button','发布首条评论');send.type='submit';send.className='primary';form.append(send);
      form.onsubmit=event=>{event.preventDefault();if(!event.isTrusted||!textArea.value.trim())return;const text=textArea.value,visibility=visibilitySelect.value,targetGroup=groupSelect.value,expected=account();mutate(async()=>{await client.startPanelDiscussion(input,text,visibility,targetGroup,expected);startDraft='';groupId=visibility==='group'?targetGroup:'';},null,false);};
      if(rows.length){const details=document.createElement('details');details.open=panelComposerOpen;details.ontoggle=()=>{panelComposerOpen=details.open;};details.append(make('summary','发起新的 Panel 讨论'),form);list.append(details);}else list.append(form);
    }
    function render(){
      list.replaceChildren();
      const visible=rows.filter(row=>filter==='all'||filter==='mine'&&row.ownerId===auth?.user?.id||row.visibility===filter);
      for(const row of visible){
        const article=document.createElement('article');article.className='reader-note';
        const header=document.createElement('header'),identity=document.createElement('div');
        identity.append(make('strong',row.author?.username||'BREVESS 用户','',!!row.author?.username),make('span',labels[row.visibility]||'受权限保护','reader-badge'));
        header.append(identity,make('time','发表于 '+dateText(row.createdAt||row.updatedAt)));article.append(header);
        if(row.source?.quote)article.append(make('blockquote',row.source.quote,'',true));
        article.append(make('p',row.text||'（空白笔记）','reader-note-text',!!row.text));
        if(['public','group'].includes(row.visibility))article.append(likeButton(row));
        if(typeof input.onLocate==='function'){
          const locate=make('button','定位到原文');locate.type='button';
          locate.onclick=async event=>{if(!event.isTrusted)return;try{const current=await client.api('/api/resources/'+encodeURIComponent(row.id),'GET',undefined,account());await input.onLocate(current.source);}catch(error){clear();message.textContent='无法定位或权限已变化：'+error.message;}};
          article.append(locate);
        }
        if(row.kind==='panel_note'&&row.canEdit&&row.ownerId===auth.user.id&&row.visibility!=='private'){
          const withdraw=make('button','撤回此讨论');withdraw.type='button';withdraw.title='改为仅个人可见，同时撤销他人对后续评论的访问';withdraw.onclick=event=>{if(event.isTrusted)mutate(()=>client.withdrawPanelDiscussion(row,account()),row.id,true);};article.append(withdraw);
        }
        const discussion=document.createElement('section');discussion.className='reader-comments';
        const comments=threads.get(row.id)||[];discussion.append(make('h3',`评论交流 · ${comments.length}`));
        for(const comment of comments){
          const entry=document.createElement('article');entry.className='reader-comment';
          const head=document.createElement('header');head.append(make('strong',comment.author?.username||'BREVESS 用户','',!!comment.author?.username),make('time','发表于 '+dateText(comment.createdAt)));entry.append(head,make('p',comment.text,'reader-note-text',true));
          if(['public','group'].includes(row.visibility))entry.append(likeButton(row,comment));
          if(comment.authorId===auth.user.id){const remove=make('button','删除我的评论');remove.type='button';remove.onclick=event=>{if(event.isTrusted)mutate(()=>client.deleteComment(row.id,comment.id,account()),row.id,false);};entry.append(remove);}
          discussion.append(entry);
        }
        if(commentMore.get(row.id)){const more=make('button','加载更多评论');more.type='button';more.dataset.moreComments=row.id;more.onclick=event=>{if(!event.isTrusted||busy)return;commentPages.set(row.id,(commentPages.get(row.id)||1)+1);reload();};discussion.append(more);}
        if(!comments.length)discussion.append(make('p','还没有评论，可以从这条备注开始讨论。','muted'));
        const form=document.createElement('form');form.className='reader-comment-form';
        const label=make('label','发表对这条备注的评论'),inputBox=document.createElement('textarea');inputBox.dataset.commentFor=row.id;inputBox.maxLength=4000;inputBox.rows=3;inputBox.required=true;inputBox.value=drafts.get(row.id)||'';inputBox.placeholder='写下你的理解、疑问或补充…';inputBox.setAttribute('aria-label','对 '+(row.author?.username||'作者')+' 的备注发表评论');
        inputBox.oninput=()=>drafts.set(row.id,inputBox.value);label.append(inputBox);form.append(label);
        const tools=document.createElement('div');tools.className='reader-comment-actions';const send=make('button','发送评论');send.type='submit';send.className='primary';tools.append(make('small',`与原备注同范围：${labels[row.visibility]} · 仅登录后可交流`),send);form.append(tools);
        form.onsubmit=event=>{event.preventDefault();if(!event.isTrusted)return;const text=inputBox.value;if(!text.trim())return;mutate(()=>client.addComment(row.id,text,row.revision,account()),row.id,true);};
        discussion.append(form);article.append(discussion);
        list.append(article);
      }
      if(!visible.length)list.append(make('p','这里暂时没有此范围内可阅读的笔记。','muted'));
      if(notesHaveMore){list.append(make('p','还有更多结果，可继续加载。','muted'));const more=make('button','加载更多笔记');more.type='button';more.dataset.moreNotes='';more.onclick=event=>{if(!event.isTrusted||busy)return;notePages++;reload();};list.append(more);}
      if(input.allowStart===true&&input.kind==='panel_note'&&auth?.user)startComposer();
    }
    async function reload(){
      const focused=shadow.activeElement,caret=focused?.dataset?.commentFor?{id:focused.dataset.commentFor,start:focused.selectionStart,end:focused.selectionEnd}:null;
      const id=++generation;busy=true;clear(false);authorScope.disabled=true;message.textContent='正在核验当前账号、原文来源与评论权限…';
      try{
        const previous=auth;auth=await client.getSession();
        if(previous&&(previous.endpoint!==auth.endpoint||previous.user?.id!==auth.user?.id)){drafts.clear();startDraft='';resetPages();}
        if(!auth.user)throw new Error('请先注册并登录 BREVESS 账号，再查看或参与讨论。');
        const supportsPaging=(await client.api('/api/health')).capabilities?.pagination===true;
        const groups=(await client.api('/api/groups','GET',undefined,account())).groups;
        if(id!==generation||!dialog.isConnected||document.hidden)return;
        memberGroups=groups;
        authorScope.replaceChildren();const all=make('option',input.visibility==='public'?'所有已登录用户的公开讨论':'所有当前可读的作者');all.value='';authorScope.append(all);
        for(const group of groups){const option=make('option','只看课题组成员：'+group.name);option.value=group.id;authorScope.append(option);}
        if(groupId&&!groups.some(group=>group.id===groupId))throw new Error('你已不属于所选课题组，不能读取该范围的讨论。');
        authorScope.value=groupId;
        let found;
        if(input.resourceId){
          const row=await client.api('/api/resources/'+encodeURIComponent(input.resourceId),'GET',undefined,account());
          if(row.kind!==input.kind||input.source.documentHash&&!client.matchesSourceAnchor(input.source,row.source))throw new Error('讨论来源已变化，请重新打开该条目。');
          const selectedGroup=groups.find(group=>group.id===groupId);
          found=groupId&&(!selectedGroup?.members.some(member=>member.id===row.ownerId)||!(row.visibility==='public'||row.visibility==='group'&&row.groupId===groupId))?[]:[row];
        }else{
          const result=await pagedRead(offset=>discover({...input,groupId,sort,...(supportsPaging?{limit:20,offset}:{})}),'resources',supportsPaging?notePages:1);
          notesHaveMore=result.hasMore;found=result.values.filter(row=>client.matchesSourceAnchor(input.source,row.source));
        }
        const loaded=await Promise.all(found.map(async row=>{try{const thread=await pagedRead(offset=>client.comments(row.id,account(),groupId,sort,supportsPaging?{limit:50,offset}:undefined),'comments',supportsPaging?(commentPages.get(row.id)||1):1);return {row,comments:thread.values,hasMore:thread.hasMore};}catch(error){if([403,404].includes(error.status))return null;throw error;}}));
        const current=await client.getSession();
        if(current.endpoint!==auth.endpoint||current.user?.id!==auth.user?.id)throw new Error('账号已切换，请刷新当前读者笔记。');
        if(id!==generation||!dialog.isConnected||document.hidden)return;
        rows=loaded.filter(Boolean).map(item=>item.row);threads.clear();for(const item of loaded)if(item){threads.set(item.row.id,item.comments);commentMore.set(item.row.id,item.hasMore);}
        render();message.textContent=`${auth.user.username} · ${rows.length} 条当前可读笔记${groupId?' · 仅显示所选课题组当前成员的笔记与评论':''}`;
        if(caret){const field=Array.from(list.querySelectorAll('textarea')).find(el=>el.dataset.commentFor===caret.id);if(field){if(caret.id==='__new_panel__'){const details=field.closest('details');if(details){details.open=true;panelComposerOpen=true;}}field.focus({preventScroll:true});field.setSelectionRange(caret.start,caret.end);}}
        return true;
      }catch(error){if(id===generation){clear();message.textContent=error.message;}}
      finally{if(id===generation){busy=false;authorScope.disabled=false;}}
    }
    for(const tab of shadow.querySelectorAll('[data-filter]'))tab.onclick=()=>{filter=tab.dataset.filter;for(const other of shadow.querySelectorAll('[data-filter]'))other.setAttribute('aria-selected',String(other===tab));render();};
    authorScope.onchange=()=>{resetPages();groupId=authorScope.value;filter='all';startVisibility=groupId?'group':'public';startGroupId=groupId;for(const tab of shadow.querySelectorAll('[data-filter]'))tab.setAttribute('aria-selected',String(tab.dataset.filter==='all'));reload();};
    const sortLabel=make('label','讨论排序'),sortSelect=document.createElement('select');sortSelect.dataset.sort='';sortSelect.setAttribute('aria-label','笔记与评论排序');for(const [value,title]of [['likes','点赞最多'],['newest','最新'],['oldest','最早']]){const option=make('option',title);option.value=value;sortSelect.append(option);}sortSelect.value=sort;sortLabel.append(sortSelect);authorScope.parentElement.after(sortLabel);sortSelect.onchange=()=>{resetPages();sort=sortSelect.value;reload();};
    for(const button of shadow.querySelectorAll('[data-close]'))button.onclick=()=>dialog.close();
    $('[data-refresh]').onclick=reload;
    const onVisibility=()=>{if(document.hidden){generation++;clear();busy=false;message.textContent='页面离开后已清空共享笔记。';}else reload();};
    document.addEventListener('visibilitychange',onVisibility);
    const onSessionChange=message=>{if(message?.type==='BREVESS_SHARING_SESSION_CHANGED'){generation++;clear(true);dialog.close();}};
    globalThis.chrome?.runtime?.onMessage?.addListener(onSessionChange);
    const timer=setInterval(()=>{if(!document.hidden&&!busy)reload();},15000);
    const completed=new Promise(resolve=>dialog.addEventListener('close',()=>{generation++;clear(true);clearInterval(timer);document.removeEventListener('visibilitychange',onVisibility);globalThis.chrome?.runtime?.onMessage?.removeListener(onSessionChange);active=null;stopTranslation?.();host.remove();resolve({status:'closed'});},{once:true}));
    dialog.showModal();await reload();return completed;
  }
  globalThis.BrevessSharing = Object.freeze({ open, openReader, discover, getLocalState: client.getLocalState });
})();
