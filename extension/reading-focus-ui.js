(() => {
  'use strict';
  const M = globalThis.BrevessReadingFocus;
  let shownPendingSwitch = null;
  let state = M.load(), preview = { type:'unknown', outline:[], reason:'正在识别页面结构' }, tabId, windowId, selectedMode = null, notifications = false, settingsDirty = false;
  const root = document.createElement('section'); root.id = 'readingFocusRoot'; root.setAttribute('aria-label','阅读专注');
  root.innerHTML = `<button id="focusToggle" type="button" aria-expanded="false" aria-controls="focusControls" title="自由计时 / 番茄钟" aria-label="阅读专注计时"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/></svg><span id="focusCompactTime"></span></button>
    <section id="focusControls" aria-label="计时控制" hidden>
      <div class="focusHeading"><strong>阅读专注</strong><button id="focusCollapse" type="button" aria-label="收起计时面板">×</button></div>
      <div class="focusModes" role="group" aria-label="计时模式"><button type="button" data-focus-mode="free">自由计时</button><button type="button" data-focus-mode="pomodoro">番茄钟</button></div>
      <div id="focusPhase"></div><div id="focusClock">00:00</div>
      <div class="focusAway"><span>当次非论文 <b id="focusAwayVisit">00:00</b></span><span>本场非论文累计 <b id="focusAwayTotal">00:00</b></span></div>
      <section id="focusSwitchPrompt" role="dialog" aria-label="已离开论文" hidden><strong>已暂停番茄钟</strong><p>当前页面未识别为论文。</p><button type="button" id="focusChooseFree">进入自由计时</button><button type="button" id="focusChooseContinue">继续番茄钟</button></section>
      <div id="focusUnknown" hidden>页面类型待确认，可手动选择计时模式。</div>
      <div class="focusActions"><button id="focusPrimary" type="button">开始专注</button><button id="focusEnd" type="button" hidden>结束专注</button></div>
      <details id="focusTimingSettings"><summary>时长设置</summary><form id="focusSettingsForm"><label>专注（分钟）<input name="focusMinutes" type="number" min="1" max="240" step="1" required></label><label>休息（分钟）<input name="breakMinutes" type="number" min="1" max="240" step="1" required></label><label>当次非论文提醒上限<input name="awayLimitMinutes" type="number" min="0" max="240" step="1" required></label><small>单位：分钟；0 表示不提醒。修改后自动记住，当前番茄阶段保持原倒计时。</small><button type="submit">保存时长</button></form></details>
      <details><summary>本地计时记录</summary><div id="focusHistory"></div></details>
      <div id="focusNotice" role="status" aria-live="polite"></div><button type="button" id="focusEnableNotifications">启用系统通知</button>
    </section>`;
  const pane = document.createElement('section'); pane.id = 'readingFocusPreview'; pane.hidden = true;
  pane.innerHTML = `<div class="focusPreviewHeader"><span id="focusPageType">结构待确认</span><select id="focusCorrectType" aria-label="手动确认网页类型"><option value="unknown">不确定</option><option value="paper">论文</option><option value="nonpaper">非论文</option></select></div><p id="focusRecognitionReason"></p><div class="focusReadingEntry"><button type="button" id="focusActivateReading">开启研读</button><span>大纲与计时已可用</span></div><p id="focusActivationNotice" role="status" aria-live="polite"></p><div class="focusOutlineSurface"><ol id="focusPreviewOutline"></ol></div>`;
  const $ = id => document.getElementById(id);
  const format = duration => { const s=Math.floor(Math.max(0,duration)/1000);return (s>=3600 ? Math.floor(s/3600)+':'+String(Math.floor(s/60)%60).padStart(2,'0') : String(Math.floor(s/60)).padStart(2,'0'))+':'+String(s%60).padStart(2,'0'); };
  function note(text) { $('focusNotice').textContent = text; }
  async function command(command, extra = {}) {
    const response = await chrome.runtime.sendMessage({type:'BREVESS_READING_FOCUS',command,windowId,...extra});
    if (!response?.success) throw Error(response?.error || '计时服务未连接');
    accept(response.data); return response.data;
  }
  function accept(data) {
    if (data.state && (data.state.revision || 0) >= (state.revision || 0)) state = M.load(data.state);
    if (data.preview) { if (tabId!==data.tabId) selectedMode=null; preview=data.preview; tabId=data.tabId; renderPreview(); }
    if (typeof data.notifications==='boolean') notifications=data.notifications;
    render();
  }
  function currentMode(s) { return s?.mode || selectedMode || (preview.type==='paper'?'pomodoro':'free'); }
  function open(value) { $('focusControls').hidden=!value;$('focusToggle').setAttribute('aria-expanded',String(value)); }
  function render() {
    const s = M.projected(state,Date.now()).active, mode=currentMode(s), done=s?.phase?.endsWith('-done');
    const duration = !s ? (mode==='pomodoro'?state.settings.focusMinutes*60000:0) : mode==='free' ? s.freeElapsedMs : s.phase.startsWith('break')?s.breakRemainingMs:s.focusRemainingMs;
    $('focusClock').textContent=format(duration);
    $('focusCompactTime').textContent=s ? (done&&mode==='pomodoro'?'已到点':format(duration)) : '';
    $('focusToggle').title = !s?'自由计时 / 番茄钟':(mode==='free'?'自由计时':s.phase.startsWith('break')?'休息':'番茄钟')+(s.running?' · 进行中':' · 已暂停');
    $('focusPhase').textContent = !s ? (mode==='free'?'自由计时':'番茄专注') : done&&mode==='pomodoro' ? (s.phase==='focus-done'?'专注完成 · 请手动开始休息':'休息结束 · 请手动开始下一轮') : (mode==='free'?'自由计时':s.phase==='break'?'休息':'番茄专注')+(s.running?'':' · 已暂停');
    $('focusAwayVisit').textContent=format(s?.awayVisitMs||0); $('focusAwayTotal').textContent=format(s?.awayTotalMs||0);
    for(const b of root.querySelectorAll('[data-focus-mode]'))b.setAttribute('aria-pressed',String(b.dataset.focusMode===mode));
    $('focusPrimary').textContent=!s?'开始专注':done&&mode==='pomodoro'?(s.phase==='focus-done'?'开始休息':'开始下一轮'):s.running?'暂停计时':'继续计时';
    $('focusEnd').hidden=!s; $('focusSwitchPrompt').hidden=!s?.pendingSwitch;
    $('focusPrimary').hidden=Boolean(s?.pendingSwitch);
    $('focusUnknown').hidden=preview.type!=='unknown';
    const pendingKey=s?.pendingSwitch ? s.id+':'+s.excursion : null;
    if(pendingKey&&pendingKey!==shownPendingSwitch)open(true);
    shownPendingSwitch=pendingKey;
    $('focusEnableNotifications').hidden=notifications;
    if(!settingsDirty && document.activeElement?.closest('#focusSettingsForm')==null)for(const [key,value]of Object.entries(state.settings)){const input=$('focusSettingsForm').elements.namedItem(key);if(input)input.value=value;}
    const history=$('focusHistory');history.replaceChildren();
    if(!state.history.length)history.textContent='暂无记录';
    for(const item of state.history.slice(-10).reverse()){const p=document.createElement('p');p.textContent=new Date(item.startedAt).toLocaleString()+' · 专注 '+format(item.focusedMs)+' · 非论文 '+format(item.awayTotalMs)+' · '+item.completedRounds+' 轮';history.append(p);}
  }
  function renderPreview() {
    pane.hidden=true; // The original workspace now loads for every readable page.
    $('focusPageType').textContent={paper:'已识别为论文',nonpaper:'非论文页面',unknown:'页面类型待确认'}[preview.type];
    $('focusCorrectType').value=preview.type;
    $('focusRecognitionReason').textContent=preview.reason||'';
    const list=$('focusPreviewOutline');list.replaceChildren();
    // Reuse the active outline's nested classes and typography without its
    // analysis checkboxes or source-jump actions, which require reader activation.
    const headings=preview.outline||[],stack=[];
    for(const [index,item]of headings.entries()){
      const level=Math.min(6,Math.max(1,Number(item.level)||2));
      while(stack.length&&stack[stack.length-1].level>=level)stack.pop();
      const parent=stack[stack.length-1];
      if(parent&&!parent.children){parent.children=document.createElement('ol');parent.node.append(parent.children);}
      const li=document.createElement('li');li.className='workspace-tree-node';li.dataset.treeDepth=String(Math.min(3,stack.length));
      const row=document.createElement('div');row.className='workspace-tree-summary';
      const title=document.createElement('span');title.className='workspace-tree-jump';title.textContent=item.title;
      title.setAttribute('role','heading');title.setAttribute('aria-level',String(level));row.append(title);li.append(row);
      (parent?.children||list).append(li);
      // The document title is separate from section depth, as in the reader.
      if(index===0&&level===1&&headings.slice(1).some(h=>Number(h.level)>1))li.classList.add('focusPreviewDocumentTitle');
      else stack.push({level,node:li,children:null});
    }
    if(!list.children.length){const li=document.createElement('li');li.textContent='当前没有可预览的大纲';list.append(li);}
  }
  const attempt = fn => () => Promise.resolve().then(fn).catch(e=>note(e.message));
  async function enableNotifications(){try{notifications=await chrome.permissions.request({permissions:['notifications']});note(notifications?'已启用系统通知':'未授权系统通知；到点状态仍会显示在侧栏。');}catch(e){note('系统通知未启用：'+e.message);}render();}
  function init() {
    const header=$('sidePanelHeader'), app=$('sidePanelApp');if(!header||!app)return;
    header.insertBefore(root,$('openSidePanelSettings'));const main=app.querySelector('.workspace-main');main.before(pane);
    $('focusToggle').addEventListener('click',()=>open($('focusControls').hidden));$('focusCollapse').addEventListener('click',()=>open(false));
    root.addEventListener('keydown',e=>{if(e.key==='Escape'){open(false);$('focusToggle').focus();}});
    $('focusEnableNotifications').addEventListener('click',enableNotifications);
    $('focusPrimary').addEventListener('click',attempt(async()=>{const s=M.projected(state,Date.now()).active;if(!s){await command('START',selectedMode?{mode:selectedMode}:{});if(!notifications)note('可点击“启用系统通知”，接收计时到点提醒。');}else await command(s.phase.endsWith('-done')&&s.mode==='pomodoro'?'NEXT':s.running?'PAUSE':'RESUME');}));
    $('focusEnd').addEventListener('click',attempt(async()=>{await command('END');note('本次专注已结束，记录已保存在本机。');}));
    for(const b of root.querySelectorAll('[data-focus-mode]'))b.addEventListener('click',attempt(async()=>{selectedMode=b.dataset.focusMode;if(state.active)await command('MODE',{mode:selectedMode});else render();}));
    $('focusChooseFree').addEventListener('click',attempt(()=>command('CHOOSE',{mode:'free'})));
    $('focusChooseContinue').addEventListener('click',attempt(()=>command('CHOOSE',{mode:'pomodoro'})));
    $('focusSettingsForm').addEventListener('input',()=>{settingsDirty=true;});
    $('focusSettingsForm').addEventListener('submit',e=>{e.preventDefault();const values=Object.fromEntries(new FormData(e.currentTarget));const settings=Object.fromEntries(Object.entries(values).map(([key,value])=>[key,Number(value)]));void command('SETTINGS',{settings}).then(()=>{settingsDirty=false;render();note('时长设置已记住。');}).catch(e=>note(e.message));});
    $('focusCorrectType').addEventListener('change',attempt(()=>command('CLASSIFY_AS',{tabId,pageType:$('focusCorrectType').value})));
    $('focusActivateReading').addEventListener('click',async()=>{
      const button=$('focusActivateReading'),status=$('focusActivationNotice');if(button.disabled)return;
      button.disabled=true;status.textContent='正在准备正文与研读工具…';
      try{
        if(typeof activateCurrentTabFromSidePanel!=='function')throw Error('研读入口尚未就绪');
        const opened=await activateCurrentTabFromSidePanel();
        status.textContent=opened===false?'尚未开启研读，请查看上方提示；大纲和计时仍可用。':'';
        renderPreview();
      }catch(e){status.textContent='未能开启研读：'+e.message;}
      finally{button.disabled=false;}
    });
    new MutationObserver(renderPreview).observe(app,{attributes:true,attributeFilter:['class']});
    chrome.runtime.onMessage.addListener(message=>{if(message?.type==='BREVESS_READING_FOCUS_STATE'){const data=message.data;if(data.preview&&data.windowId!==windowId){if(data.state)accept({state:data.state});}else accept(data);}return false;});
    let readGeneration=0;
    async function refresh(){const token=++readGeneration;try{const response=await chrome.runtime.sendMessage({type:'BREVESS_READING_FOCUS',command:'READ',windowId});if(token!==readGeneration)return;if(response?.success)accept(response.data);else note(response?.error||'页面预览暂不可用');}catch(e){if(token===readGeneration)note(e.message);}}
    chrome.tabs.onActivated.addListener(info=>{if(info.windowId===windowId)void refresh();});
    chrome.tabs.onUpdated.addListener((id,change)=>{if(id===tabId&&(change.url||change.status==='complete'))void refresh();});
    render();renderPreview();chrome.windows.getCurrent().then(win=>{windowId=win.id;return refresh();}).catch(e=>note(e.message));
    setInterval(()=>{if(!document.hidden)render();},1000);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
