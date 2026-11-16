(async function () {
  'use strict';
  const settingsRoot=document.getElementById('settingsAccountContent');
  let scope=document,prefix='';
  const visible=()=>!document.hidden&&(!settingsRoot||!settingsRoot.closest('[data-settings-page]').hidden);
  if(settingsRoot){
    // Reuse the packaged forms in the settings document itself, with scoped IDs.
    if(document.body.dataset.activeSettingsPage!=='account')await new Promise(resolve=>{
      const activate=event=>{if(event.detail?.page==='account'){window.removeEventListener('brevess-settings-pagechange',activate);resolve();}};
      window.addEventListener('brevess-settings-pagechange',activate);
    });
    try{
      const response=await fetch(chrome.runtime.getURL('sharing/index.html'));
      if(!response.ok)throw new Error('ACCOUNT_TEMPLATE_UNAVAILABLE');
      const template=new DOMParser().parseFromString(await response.text(),'text/html').querySelector('main');
      if(!template?.querySelector('#login-form'))throw new Error('ACCOUNT_TEMPLATE_INVALID');
      template.querySelector('header > div')?.remove();template.querySelector('.intro')?.remove();
      template.querySelector('.layout > section').hidden=true;
      prefix='settings-account-';
      for(const node of template.querySelectorAll('[id]'))node.id=prefix+node.id;
      for(const node of template.querySelectorAll('[for],[aria-labelledby],[aria-describedby],[aria-controls]'))for(const attr of ['for','aria-labelledby','aria-describedby','aria-controls'])if(node.hasAttribute(attr))node.setAttribute(attr,node.getAttribute(attr).split(/\s+/).map(id=>prefix+id).join(' '));
      settingsRoot.replaceChildren(...Array.from(template.childNodes,child=>document.importNode(child,true)));scope=settingsRoot;
    }catch{settingsRoot.textContent=globalThis.SciLLM?.translateInterfaceText?.('账号管理暂时无法加载，请刷新设置页重试。')||'账号管理暂时无法加载，请刷新设置页重试。';return;}
  }
  // Email tokens live only in this page closure. Remove them before any await or request.
  let linkKind=null,linkToken=null;
  function consumeAccountLink(){const fragment=new URLSearchParams(location.hash.slice(1));linkKind=fragment.has('verify')?'verify':fragment.has('reset')?'reset':null;linkToken=linkKind?fragment.get(linkKind):null;if(location.hash)history.replaceState(null,'',location.pathname+location.search);if(!linkToken||linkToken.length>4096){linkKind=null;linkToken=null;}}
  if(!settingsRoot)consumeAccountLink();
  const i18n=globalThis.SciLLM;
  const T=text=>i18n?.translateInterfaceText?.(text)||text;
  const languageReady=globalThis.chrome?.runtime?.sendMessage?i18n?.bootstrapInterfaceLanguage?.():null;
  if(!globalThis.chrome?.runtime?.sendMessage){let language='zh-CN';try{language=localStorage.getItem('brevessSharingInterfaceLanguage')||language;}catch{}i18n?.setInterfaceLanguage?.(language);}
  const client = globalThis.BrevessSharingClient, $ = id => scope.querySelector('#'+prefix+id);
  const labels = { private: '仅个人可见', group: '课题组内共享', public: '公开' };
  const kinds = { highlight_note: '高亮备注', panel_note: 'Panel 笔记', hypothesis: '假说梳理', figure_plan: '组图规划' };
  let rows = [], epoch = 0, auth = null, readerId = new URL(location.href).searchParams.get('resource'), updating = false;
  let endpointDirty = false, configurationPending = Promise.resolve();
  let capabilities = null, capabilitiesEndpoint = null, capabilitiesReady = false, accountMode = 'login', accountBusy = false, accountOperation = 0, nextOffset = null;
  const accountErrors = {
    EMAIL_VERIFICATION_REQUIRED:'请先验证邮箱，再登录账号。', ACCOUNT_TOKEN_INVALID:'此链接已失效、已使用或已过期，请重新申请邮件。',
    INVALID_EMAIL:'请输入有效的邮箱地址。', MAIL_UNAVAILABLE:'邮件暂时无法发送，请稍后重试。', USERNAME_UNAVAILABLE:'此用户名暂不可用，请换一个。',
    EMAIL_UNAVAILABLE:'此邮箱暂不可用，请使用其他邮箱或找回原账号。', LOGIN_FAILED:'用户名或密码不正确。', LOGIN_RATE_LIMIT:'操作过于频繁，请稍后重试。', INVALID_CREDENTIALS:'用户名或密码不正确。', INVALID_PASSWORD:'密码长度为 12–1024 个字符。',
    REGISTRATION_DISABLED:'当前服务暂未开放注册。', RATE_LIMITED:'操作过于频繁，请稍后重试。', AUTH_BUSY:'操作过于频繁，请稍后重试。', CURRENT_PASSWORD_INVALID:'当前密码不正确，请重新登录后重试。', INVALID_SESSION:'登录已过期，请重新登录。', LOGIN_REQUIRED:'请登录 BREVESS 账号后继续。', INVALID_USERNAME:'用户名不符合要求。'
  };
  const accountError=error=>accountErrors[error.code]||error.message||'操作未完成';
  const cloudAccount=()=>capabilities?.emailVerificationRequired === true;
  function clearPasswords(){scope.querySelectorAll('.account-card input[type=password]').forEach(input=>{input.value='';input.setCustomValidity('');});}
  function renderAccount(){
    const logged=!!auth?.user, linked=!!linkKind;
    if($('admin-entry')){ $('admin-entry').hidden=!logged||auth.user.isAdmin!==true; if(logged)$('admin-entry').href=globalThis.chrome?.runtime?.getURL?chrome.runtime.getURL('sharing/admin.html'):auth.endpoint+'/sharing/admin.html'; }
    $('identity').textContent=auth?.user?'已登录：'+auth.user.username:'请注册并登录 BREVESS 账号后阅读共享内容';
    $('signed-out').hidden=logged||linked; $('signed-in').hidden=!logged||linked; $('account-link-panel').hidden=!linked;
    $('verify-form').hidden=linkKind!=='verify'; $('reset-form').hidden=linkKind!=='reset';
    for(const mode of ['login','registration','forgot','resend']) $(mode==='registration'?'registration-form':mode+'-form').hidden=mode!==accountMode;
    $('show-login').setAttribute('aria-pressed',String(accountMode==='login'));$('register').setAttribute('aria-pressed',String(accountMode==='registration'));
    $('register').disabled=accountBusy||!capabilitiesReady||capabilities?.registration===false;$('registration-submit').disabled=$('register').disabled;
    $('show-forgot').hidden=!capabilities?.passwordRecovery; $('show-resend').hidden=!cloudAccount()||accountMode==='resend';
    $('register-email-label').hidden=!cloudAccount();$('register-email').required=cloudAccount();
    $('registration-note').textContent=cloudAccount()?'注册后请查收邮件，验证邮箱后即可登录。':'当前服务使用本机账号，可注册后直接登录。';
    $('password-settings').hidden=!capabilities?.passwordRecovery; $('email-settings').hidden=!cloudAccount();
    $('account-email').textContent=auth?.user?.email||'';
    $('email-state').textContent=logged&&cloudAccount()?(auth.user.emailVerified?'邮箱已验证':auth.user.email?'邮箱尚未验证':'请绑定邮箱，以便找回密码。'):'';
  }
  function setAccountMode(mode){accountMode=mode; $('account-notice').textContent='';renderAccount();}
  function matchPasswords(passwordId,confirmId){const input=$(confirmId);input.setCustomValidity(input.value===$(passwordId).value?'':T('两次输入的密码不一致。'));return input.reportValidity();}
  async function loadCapabilities(generation){
    const current=auth.endpoint;
    if(capabilitiesEndpoint===current&&capabilitiesReady)return;
    capabilitiesReady=false;capabilities=null;renderAccount();
    const health=await client.api('/api/health');
    if(generation!==epoch)return;
    capabilities=health.capabilities||null;capabilitiesEndpoint=current;capabilitiesReady=true;
    $('service-note').textContent=capabilities?'账号由当前 BREVESS 云服务管理。':'当前为本机兼容服务，不支持邮件验证或密码找回。';
    renderAccount();
  }
  function bindAccountForm(id,action){$(id).onsubmit=event=>{
    event.preventDefault();if(!event.isTrusted||accountBusy||!$(id).reportValidity())return;
    const operation=++accountOperation;accountBusy=true;const buttons=[...$(id).querySelectorAll('button')];buttons.forEach(button=>button.disabled=true);
    run(async()=>{try{await configurationPending;if(operation!==accountOperation)return;await action();}catch(error){if(error.status===401){++epoch;clearData();await refresh(true);}$('account-notice').textContent=accountError(error);if(error.code==='EMAIL_VERIFICATION_REQUIRED'){$('resend-email').value=$('register-email').value;}}finally{buttons.forEach(button=>button.disabled=false);accountBusy=false;renderAccount();}});
  };}

  if (readerId && !/^res_[a-z0-9_-]+$/i.test(readerId)) readerId = null;
  const element = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
  const userElement=(tag,text,className)=>{const node=element(tag,text,className);node.setAttribute('data-i18n-ignore','');return node;};
  const button = (label, action, userLabel=false) => { const node = (userLabel?userElement:element)('button', label); node.type = 'button'; node.onclick = () => run(action); return node; };
  function pageOffset(result,current=0){if(!result.hasMore)return null;if(!Number.isSafeInteger(result.nextOffset)||result.nextOffset<=current||result.nextOffset>1000000)throw new Error('分页结果无效，请刷新后重试。');return result.nextOffset;}
  function clearReading() { $('reading').replaceChildren(); $('reader').hidden = true; }
  function clearData() { rows = []; nextOffset=null; $('load-more').hidden=true;$('loaded-search-note').hidden=true; $('resources').replaceChildren(); $('count').textContent = '待核验'; clearReading(); }
  function appendSharedBody(host, row) {
    const body = row.body || {};
    if (row.kind === 'hypothesis') {
      if (body.nodes?.length) host.append(element('h3', '假说节点'));
      const names = new Map((body.nodes || []).map(node => [node.id, node.label]));
      for (const node of body.nodes || []) { const card = element('article', undefined, 'shared-block'); card.append((node.label?userElement:element)('h4', node.label || '未命名节点')); if (node.text) card.append(element('pre', node.text)); host.append(card); }
      if (body.edges?.length) host.append(element('h3', '节点间的关系'));
      for (const edge of body.edges || []) { const card = element('article', undefined, 'shared-block'); card.append(userElement('strong', `${names.get(edge.source) || 'Node'} → ${names.get(edge.target) || 'Node'}`), element('span', { main: '主线', branch: '分支', feedback: '反馈' }[edge.kind] || '关系', 'tag'), (edge.label||edge.text?userElement('pre',[edge.label,edge.text].filter(Boolean).join('\n')):element('p','尚无说明'))); host.append(card); }
    }
    if (row.kind === 'figure_plan') {
      const figures = new Map();
      for (const panel of body.panels || []) { const key = panel.figureId || ''; if (!figures.has(key)) figures.set(key, []); figures.get(key).push(panel); }
      let figureIndex = 0;
      for (const panels of figures.values()) { host.append(element('h3', `Figure ${++figureIndex}`)); for (const panel of panels) { const card = element('article', undefined, 'shared-block'); card.append((panel.label?userElement:element)('h4', panel.label || '未命名 Panel'), (panel.text?userElement('pre',panel.text):element('p','尚无人工说明'))); host.append(card); } }
      if (body.evidenceBlocks?.length) host.append(element('h3', '证据块'));
      for (const block of body.evidenceBlocks || []) { const card = element('article', undefined, 'shared-block'); card.append((block.title?userElement:element)('h4', block.title || '未命名证据块'), element('pre', block.summary || ''), element('small', '对应 Panel：' + (block.panelIds || []).map(id => body.panels.find(panel => panel.id === id)?.label || 'Panel').join('、'))); host.append(card); }
    }
  }
  function appendSource(host, source) {
    if (!Object.keys(source || {}).length) return;
    host.append(element('h3', '来源定位'));
    const labels = { doi: 'DOI', figureId: 'Figure', panelId: 'Panel', paragraphId: '段落', annotationId: '高亮备注' };
    for (const [key, label] of Object.entries(labels)) if (source[key]) host.append(element('p', label + '：' + source[key], 'muted'));
    if (source.url) { try { const parsed = new URL(source.url); if (parsed.protocol === 'https:') { const link = element('a', '打开在线来源 ↗'); link.href = parsed.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; host.append(link); } } catch (_) {} }
    if (source.documentHash) { const details = element('details'); details.append(element('summary', '文档版本标识'), element('pre', source.documentHash)); host.append(details); }
  }
  function say(message) { $('status').textContent = message; }
  async function run(action) { try { await action(); } catch (error) { say(error.message || '操作未完成'); } }
  function showRows() {
    const query = $('search').value.trim().toLowerCase();
    const visible = rows.filter(row => [row.title, row.text, JSON.stringify(row.body || {})].join(' ').toLowerCase().includes(query));
    $('count').textContent = visible.length + ' 条';
    $('resources').replaceChildren();
    for (const row of visible) {
      const li = element('li', undefined, 'resource');
      li.append(button(row.title || '未命名条目', async () => { readerId = row.id; await readResource(row.id, epoch); },!!row.title), element('small', `${kinds[row.kind]} · ${labels[row.visibility]}${row.canEdit ? ' · 我的内容' : ' · 只读'}`));
      $('resources').append(li);
    }
    if (!visible.length) $('resources').append(element('li', '暂无可阅读的匹配内容。', 'muted'));
    $('load-more').hidden=nextOffset===null;$('loaded-search-note').hidden=nextOffset===null;
  }
  async function readResource(id, generation) {
    clearReading();
    const row = await client.api('/api/resources/' + encodeURIComponent(id));
    if (generation !== epoch || document.hidden) return;
    const box = $('reading'), tags = element('div', undefined, 'tags');
    for (const text of [kinds[row.kind], labels[row.visibility], '只读预览', `版本 ${row.revision}`]) tags.append(element('span', text, 'tag'));
    box.append((row.title?userElement:element)('h2', row.title || '未命名条目', 'read-title'), tags);
    const body = element('div', undefined, 'resource-body');
    body.append(row.text?userElement('pre',row.text):element('p','（空白备注）'));
    appendSharedBody(body, row);
    appendSource(body, row.source);
    box.append(body);
    if(['highlight_note','panel_note'].includes(row.kind)){
      const discuss=element('button',`参与讨论 · ${row.commentCount||0} 条回复 · ${row.likeCount||0} 赞`);discuss.type='button';discuss.className='primary';discuss.dataset.openDiscussion=row.id;
      discuss.onclick=event=>{if(event.isTrusted)run(async()=>{await globalThis.BrevessSharing.openReader({kind:row.kind,resourceId:row.id,source:row.source,title:row.title||'备注讨论'});await refresh(true);});};box.append(discuss,element('p','打开同一讨论界面发表评论、点赞或取消赞，并按点赞最多、最新或最早排序。','muted'));
    }
    if (row.linkedResources?.length) {
      box.append(element('h3', '当前有权阅读的关联条目'));
      for (const linked of row.linkedResources) box.append(button(linked.title || '关联条目', async () => { readerId = linked.id; await readResource(linked.id, epoch); },!!linked.title));
    }
    const link = element('a', row.visibility === 'public' ? '分享链接（登录后阅读）↗' : '受权限保护的条目链接 ↗');
    link.href = auth.endpoint + '/sharing/index.html?resource=' + encodeURIComponent(row.id); link.target = '_blank'; link.rel = 'noopener noreferrer';
    const linkLine = element('p'); linkLine.append(link); box.append(linkLine);
    if (row.canEdit && row.kind === 'panel_note') {
      box.append(element('p', '这是你的 Panel 在线备注或讨论。撤回后仅你自己可读，其他人的后续评论也不再对外开放；本机 Panel 笔记保持原样。', 'muted'));
      if (row.visibility !== 'private') {
        const withdraw=element('button','撤回此讨论 / 备注共享');withdraw.type='button';
        withdraw.onclick=event=>{if(event.isTrusted)run(async()=>{withdraw.disabled=true;await client.withdrawPanelDiscussion(row,{endpoint:auth.endpoint,userId:auth.user?.id});await refresh();say('已撤回，当前仅个人可见。');});};box.append(withdraw);
      } else box.append(element('p','已仅个人可见。','muted'));
    } else if (row.canEdit) box.append(element('p', '作者请从原备注或工作台入口修改内容与可见性；本页不会把服务内容覆盖回本地记录。', 'muted'));
    $('reader').hidden = false;
  }
  function renderGroups(groups, invitations) {
    $('groups').replaceChildren(); $('invitations').replaceChildren();
    for (const invitation of invitations) {
      const item = element('section', undefined, 'group'); item.append(element('h3', '邀请加入：' + invitation.groupName));
      item.append(button('接受邀请', async () => { await client.api('/api/invitations/' + invitation.id + '/accept', 'POST'); await refresh(); say('已加入课题组。'); }), button('拒绝', async () => { await client.api('/api/invitations/' + invitation.id, 'DELETE'); await refresh(); }));
      $('invitations').append(item);
    }
    for (const group of groups) {
      const item = element('section', undefined, 'group'), members = element('ul', undefined, 'members');
      item.append(userElement('h3', group.name));
      for (const member of group.members) {
        const li = element('li');li.append(userElement('span',member.username));if(member.id===group.ownerId)li.append(element('span',' · 管理员'));
        if (group.ownerId === auth.user.id && member.id !== auth.user.id) li.append(button('移出', async () => { clearData(); await client.api('/api/groups/' + group.id + '/members/' + member.id, 'DELETE'); await refresh(); say('成员已移出；服务已撤销其组内读取权限。'); }));
        members.append(li);
      }
      item.append(members);
      if (group.ownerId === auth.user.id) {
        const form = element('form'), label = element('label', '邀请成员（对方接受后生效）'), input = element('input'); input.required = true; input.placeholder = '对方用户名'; input.setAttribute('aria-label', '邀请到' + group.name + '的用户名'); label.append(input); form.append(label, element('button', '发送邀请'));
        form.onsubmit = event => { event.preventDefault(); run(async () => { await client.api('/api/groups/' + group.id + '/members', 'POST', { username: input.value }); input.value = ''; say('邀请已创建，等待对方接受。'); }); }; item.append(form);
      } else item.append(button('退出课题组', async () => { clearData(); await client.api('/api/groups/' + group.id + '/leave', 'POST'); await refresh(); say('已退出课题组；访问权限已更新。'); }));
      $('groups').append(item);
    }
  }
  async function refresh(quiet = false) {
    const generation = ++epoch; updating = true; clearData();
    try {
      auth = await client.getSession();
      if (generation !== epoch) return;
      if (!endpointDirty) $('endpoint').value = auth.endpoint;
      $('identity').textContent = auth.user ? '已登录：' + auth.user.username : '请注册并登录 BREVESS 账号后阅读共享内容';
      renderAccount(); $('group-card').hidden = !auth.user;
      try { await loadCapabilities(generation); } catch(error) { if(generation===epoch)$('service-note').textContent='无法确认账号服务，请检查连接后刷新。'; }
      if(generation!==epoch)return;
      if (!auth.user) {
        $('resources').append(element('li', readerId ? '此分享链接需要登录后阅读。登录后将自动打开目标条目。' : '公开备注也仅向已注册并登录的 BREVESS 用户提供。', 'muted'));
        $('count').textContent = '需登录'; $('groups').replaceChildren(); $('invitations').replaceChildren();
        if (!quiet) say('请登录 BREVESS 账号后继续。');
        return;
      }
      const account={endpoint:auth.endpoint,userId:auth.user.id};
      const me=await client.api('/api/me','GET',undefined,account);
      if(generation!==epoch)return;
      auth={...auth,user:me.user};renderAccount();
      if(!settingsRoot){
        const resources = await client.api(capabilities?.pagination?'/api/resources?limit=50&offset=0':'/api/resources','GET',undefined,account);
        if (generation !== epoch || document.hidden) return;
        rows = resources.resources; nextOffset=pageOffset(resources);showRows();
      }
      if (auth.user) {
        const [groups, invitations] = await Promise.all([client.api('/api/groups'), client.api('/api/invitations')]);
        if (generation !== epoch || !visible()) return;
        renderGroups(groups.groups, invitations.invitations);
      }
      if (readerId) {
        try { await readResource(readerId, generation); } catch (error) { clearReading(); if (generation === epoch) say('此条目不存在或当前无权阅读：' + error.message); }
      } else if (!quiet) say('已从服务重新核验访问权限。');
    } catch (error) { if (generation === epoch) { clearData();auth=await client.getSession();renderAccount();$('group-card').hidden=!auth.user; $('groups').replaceChildren(); $('invitations').replaceChildren(); say('共享内容已清空：' + error.message); } }
    finally { if (generation === epoch) updating = false; }
  }
  $('search').oninput = showRows;
  $('load-more').onclick=()=>run(async()=>{const generation=epoch,offset=nextOffset;if(offset===null||!auth?.user)return;$('load-more').disabled=true;try{const page=await client.api('/api/resources?limit=50&offset='+offset,'GET',undefined,{endpoint:auth.endpoint,userId:auth.user.id});if(generation!==epoch)return;rows=[...new Map([...rows,...page.resources].map(row=>[row.id,row])).values()];nextOffset=pageOffset(page,offset);showRows();}catch(error){if(generation===epoch)clearData();throw error;}finally{$('load-more').disabled=false;}});
  $('refresh').onclick = () => run(() => refresh());
  $('close-reader').onclick = () => { readerId = null; clearReading(); };
  $('endpoint').oninput = () => { endpointDirty = true; };
  $('endpoint-form').onsubmit = event => { event.preventDefault(); const requested = $('endpoint').value; ++accountOperation;clearPasswords();linkToken=null;linkKind=null;capabilitiesReady=false;capabilitiesEndpoint=null;
    const pending = configurationPending.catch(() => {}).then(() => client.configure(requested));
    configurationPending = pending;
    run(async () => { ++epoch; clearData(); await pending;
      if ($('endpoint').value === requested) endpointDirty = false;
      readerId = null; await refresh(); }); };
  $('show-login').onclick=()=>setAccountMode('login');$('register').onclick=()=>setAccountMode('registration');
  $('show-forgot').onclick=()=>setAccountMode('forgot');$('show-resend').onclick=()=>setAccountMode('resend');
  scope.querySelectorAll('[data-account-mode]').forEach(button=>button.onclick=()=>setAccountMode(button.dataset.accountMode));
  for(const [first,second]of [['register-password','register-confirm'],['reset-password','reset-confirm'],['new-password','new-confirm']])for(const id of [first,second])$(id).oninput=()=>$(second).setCustomValidity('');
  if(!settingsRoot)window.addEventListener('hashchange',()=>{consumeAccountLink();clearPasswords();$('account-notice').textContent='';renderAccount();if(linkKind&&!globalThis.chrome?.runtime?.sendMessage&&/^https?:$/.test(location.protocol)){capabilitiesReady=false;capabilitiesEndpoint=null;configurationPending=configurationPending.catch(()=>{}).then(()=>client.configure(location.origin));run(async()=>{await configurationPending;await refresh(true);});}});
  $('dismiss-account-link').onclick=()=>{linkToken=null;linkKind=null;clearPasswords();renderAccount();};
  bindAccountForm('login-form',async()=>{const username=$('username').value,password=$('password').value;clearPasswords();++epoch;clearData();await client.login(username,password);$('account-notice').textContent='';await refresh();});
  bindAccountForm('registration-form',async()=>{
    if(!matchPasswords('register-password','register-confirm'))return;
    const username=$('register-username').value,email=$('register-email').value,password=$('register-password').value;clearPasswords();
    const result=await client.api('/api/register','POST',{username,...(cloudAccount()?{email}:{}),password});$('username').value=username;
    if(result.verificationRequired){setAccountMode('login');$('resend-email').value=email;$('account-notice').textContent='账号已创建，请查收验证邮件。验证完成后再登录。';}
    else {await client.login(username,password);await refresh();$('account-notice').textContent='账号已创建并登录。';}
  });
  for(const [id,path]of [['forgot','forgot-password'],['resend','resend-verification']])bindAccountForm(id+'-form',async()=>{await client.api('/api/account/'+path,'POST',{email:$(id+'-email').value});$('account-notice').textContent='如果该邮箱符合条件，我们已发送邮件。请检查收件箱与垃圾邮件。';});
  bindAccountForm('verify-form',async()=>{if(!linkToken||linkKind!=='verify')return;await client.api('/api/account/verify-email','POST',{token:linkToken});linkToken=null;linkKind=null;setAccountMode('login');await refresh(true);$('account-notice').textContent='邮箱已验证。请登录 BREVESS 账号。';});
  bindAccountForm('reset-form',async()=>{if(!linkToken||linkKind!=='reset'||!matchPasswords('reset-password','reset-confirm'))return;const password=$('reset-password').value;clearPasswords();++epoch;clearData();await client.api('/api/account/reset-password','POST',{token:linkToken,password});linkToken=null;linkKind=null;setAccountMode('login');await refresh(true);$('account-notice').textContent='密码已更新，所有会话已退出。请使用新密码登录。';});
  bindAccountForm('change-password-form',async()=>{if(!matchPasswords('new-password','new-confirm'))return;const currentPassword=$('current-password').value,newPassword=$('new-password').value,account={endpoint:auth.endpoint,userId:auth.user.id};clearPasswords();++epoch;clearData();await client.api('/api/account/change-password','POST',{currentPassword,newPassword},account);setAccountMode('login');await refresh(true);$('account-notice').textContent='密码已更新，所有会话已退出。请使用新密码登录。';});
  bindAccountForm('set-email-form',async()=>{const email=$('account-new-email').value,currentPassword=$('email-current-password').value,account={endpoint:auth.endpoint,userId:auth.user.id};clearPasswords();await client.api('/api/account/set-email','POST',{email,currentPassword},account);$('account-notice').textContent='请查收验证邮件。验证成功前，原账号邮箱保持不变。';});
  $('logout').onclick = () => run(async () => { ++epoch; clearData();clearPasswords(); let issue; try { await client.logout(); } catch (error) { issue = error; } readerId = null; await refresh(); if(issue)say('已清除本机会话；远程退出未确认：'+issue.message); });
  $('group-form').onsubmit = event => { event.preventDefault(); run(async () => { await client.api('/api/groups', 'POST', { name: $('group-name').value }); $('group-name').value = ''; await refresh(); say('课题组已创建。'); }); };
  function pageVisibility(){if(!visible()){++epoch;clearData();clearPasswords();$('groups').replaceChildren();$('invitations').replaceChildren();updating=false;}else run(()=>refresh(true));}
  document.addEventListener('visibilitychange', pageVisibility);
  if(settingsRoot)window.addEventListener('brevess-settings-pagechange',pageVisibility);
  window.addEventListener('pagehide', () => { ++epoch; clearData();clearPasswords();linkToken=null; });
  globalThis.chrome?.runtime?.onMessage?.addListener(message => {
    if (message?.type !== 'BREVESS_SHARING_SESSION_CHANGED') return;
    ++epoch; clearData();clearPasswords(); auth = null; $('groups').replaceChildren(); $('invitations').replaceChildren();
    $('identity').textContent = '账号已变化，请刷新访问权限。';
    renderAccount();$('group-card').hidden=true;
    if(visible())queueMicrotask(() => run(() => refresh(true)));
  });
  setInterval(() => { if (visible() && !updating && !accountBusy) run(() => refresh(true)); }, 15000);
  renderAccount();
  if (!globalThis.chrome?.runtime?.sendMessage && /^https?:$/.test(location.protocol)) {configurationPending=client.configure(location.origin);await configurationPending;}
  const languageControl=$('language-control'),languageSelect=$('interface-language');
  if(!globalThis.chrome?.runtime?.sendMessage){languageControl.hidden=false;languageSelect.value=i18n?.getInterfaceLanguage?.()||'zh-CN';languageSelect.onchange=()=>{i18n?.setInterfaceLanguage?.(languageSelect.value);try{localStorage.setItem('brevessSharingInterfaceLanguage',languageSelect.value);}catch{}};}
  await languageReady;
  await refresh();
})();
