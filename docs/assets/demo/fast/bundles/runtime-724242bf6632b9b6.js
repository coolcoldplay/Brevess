
;/* native/core/reading-focus-model.js */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BrevessReadingFocus = Object.assign(root.BrevessReadingFocus || {}, api);
})(globalThis, function () {
  'use strict';
  const STORAGE_KEY = 'brevessReadingFocusV1';
  const DEFAULTS = Object.freeze({ focusMinutes: 25, breakMinutes: 3, awayLimitMinutes: 5 });
  const clone = value => structuredClone(value);
  const ms = value => value * 60000;
  function settings(input = {}) {
    const result = { ...DEFAULTS, ...input };
    for (const key of Object.keys(DEFAULTS)) {
      if (!Number.isFinite(result[key]) || result[key] < (key === 'awayLimitMinutes' ? 0 : 1) || result[key] > 240) throw Error('FOCUS_INVALID_MINUTES');
    }
    return result;
  }
  function dayKey(at) {
    const d = new Date(at);
    return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-');
  }
  function activityDay(state, at) {
    return state.days[dayKey(at)] ||= {ms:0, papers:[]};
  }
  function touchPaper(state, at, key) {
    if (!key) return;
    const day = activityDay(state, at);
    if (!day.papers.includes(key)) day.papers.push(key);
  }
  function addReading(state, from, span, key) {
    const end = from + span;
    while (from < end) {
      const midnight = new Date(from); midnight.setHours(24,0,0,0);
      const until = Math.min(end, midnight.getTime());
      activityDay(state,from).ms += until-from;
      touchPaper(state,from,key);
      from=until;
    }
  }
  function progress(s, preferences) {
    if (!s?.running) return null;
    if (s.mode === 'free') return {fraction:(s.freeElapsedMs % 3600000)/3600000, hours:Math.floor(s.freeElapsedMs/3600000)};
    const rest = s.phase.startsWith('break');
    const total = (rest ? s.breakTotalMs : s.focusTotalMs) || ms(rest ? preferences.breakMinutes : preferences.focusMinutes);
    return {fraction:Math.min(1,Math.max(0,(rest ? s.breakRemainingMs : s.focusRemainingMs)/total)), hours:0};
  }
  function load(input) {
    if (input == null) return { schemaVersion: 1, settings: settings(), active: null, history: [], days: {} };
    if (input.schemaVersion !== 1 || !Array.isArray(input.history)) throw Error('FOCUS_UNSUPPORTED_STORAGE');
    const state = {...clone(input), settings:settings(input.settings)};
    if (!state.days) {
      state.days = {};
      for (const h of state.history) if (h.focusedMs > 0 && dayKey(h.startedAt)===dayKey(h.endedAt)) activityDay(state,h.startedAt).ms += h.focusedMs;
      if (state.active?.focusedMs > 0 && dayKey(state.active.startedAt)===dayKey(state.active.lastAt)) activityDay(state,state.active.startedAt).ms += state.active.focusedMs;
    }
    return state;
  }
  function notice(session, kind, effects) {
    effects.push({ kind, id: session.id + ':' + kind + ':' + session.round + ':' + session.excursion });
  }
  function settle(state, now, effects = []) {
    const s = state.active, reader = state.reader;
    if (reader) {
      const end = Math.min(now, reader.expires);
      if (!s && end > reader.lastAt) addReading(state,reader.lastAt,end-reader.lastAt,reader.key);
      reader.lastAt = Math.max(reader.lastAt,end);
      if (now >= reader.expires) delete state.reader;
    }
    if (!s) return state;
    const from = s.lastAt, delta = Math.max(0, now - from);
    s.lastAt = Math.max(s.lastAt, now);
    if (s.pageType === 'nonpaper' && s.foreground) {
      s.awayTotalMs += delta; s.awayVisitMs += delta;
      const limit = ms(state.settings.awayLimitMinutes);
      if (limit > 0 && !s.awayNotified && s.awayVisitMs >= limit) { s.awayNotified = true; notice(s, 'away-limit', effects); }
    }
    if (!s.running) return state;
    if (s.mode === 'free') { s.freeElapsedMs += delta; if (s.foreground) addReading(state,from,delta,s.paperKey); }
    else if (s.phase === 'focus' || s.phase === 'break') {
      const key = s.phase === 'focus' ? 'focusRemainingMs' : 'breakRemainingMs';
      const spent = Math.min(delta, s[key]); s[key] -= spent;
      if (s.phase === 'focus') { s.focusedMs += spent; if (s.foreground) addReading(state,from,spent,s.paperKey); }
      if (s[key] === 0) {
        const finished = s.phase;
        if (finished === 'focus') s.completedRounds += 1;
        s.phase = finished + '-done'; s.running = false; s.pendingSwitch = false;
        notice(s, finished + '-done', effects);
      }
    }
    return state;
  }
  function changePage(s, type, foreground = true) {
    s.foreground = foreground;
    const before = s.pageType;
    s.pageType = ['paper', 'nonpaper', 'unknown'].includes(type) ? type : 'unknown';
    if (s.pageType === 'unknown') return;
    if (s.pageType === 'nonpaper') {
      if (!s.excursionOpen) {
        s.excursion += 1; s.excursionOpen = true; s.awayVisitMs = 0; s.awayNotified = false;
        s.freeElapsedMs = 0;
      }
      if (s.mode === 'pomodoro' && s.phase === 'focus' && !s.overrideNonpaper && (before !== 'nonpaper' || s.running)) {
        s.running = false; s.pendingSwitch = true;
      }
    } else {
      s.excursionOpen = false; s.overrideNonpaper = false; s.pendingSwitch = false;
      if (before !== 'paper') {
        s.mode = 'pomodoro';
        s.running = !s.userPaused && (s.phase === 'focus' || s.phase === 'break');
      }
    }
  }
  function reduce(input, action, now) {
    if (!Number.isFinite(now)) throw Error('FOCUS_TIME_REQUIRED');
    const state = load(input), effects = [];
    if (action.type === 'RECOVER') {
      delete state.reader;
      if (state.active) state.active.lastAt = now;
    } else settle(state, now, effects);
    const s = state.active;
    switch (action.type) {
      case 'SETTINGS': {
        state.settings = settings({ ...state.settings, ...action.settings });
        // New durations apply to the next phase. A running countdown is never reset.
        break;
      }
      case 'START': {
        if (s) break;
        if (typeof action.id !== 'string' || !action.id) throw Error('FOCUS_SESSION_ID_REQUIRED');
        const pageType = ['paper', 'nonpaper', 'unknown'].includes(action.pageType) ? action.pageType : 'unknown';
        const mode = action.mode || (pageType === 'paper' ? 'pomodoro' : 'free');
        if (!['free', 'pomodoro'].includes(mode)) throw Error('FOCUS_MODE_REQUIRED');
        state.active = { id: action.id, startedAt: now, lastAt: now, mode, phase: 'focus', running: pageType !== 'unknown' || Boolean(action.mode), userPaused: false,
          pageType, paperKey:action.paperKey || '', focusTotalMs:ms(state.settings.focusMinutes), breakTotalMs:ms(state.settings.breakMinutes), foreground: true, pendingSwitch: false, overrideNonpaper: mode === 'pomodoro' && pageType === 'nonpaper',
          focusRemainingMs: ms(state.settings.focusMinutes), breakRemainingMs: ms(state.settings.breakMinutes), focusedMs: 0,
          freeElapsedMs: 0, awayTotalMs: 0, awayVisitMs: 0, excursion: pageType === 'nonpaper' ? 1 : 0,
          excursionOpen: pageType === 'nonpaper', awayNotified: false, round: 1, completedRounds: 0 };
        break;
      }
      case 'PAGE': if (s) { changePage(s, action.pageType, action.foreground !== false); s.paperKey=action.paperKey||''; } break;
      case 'VISIT': break;
      case 'READER':
        if (action.paperKey) {
          state.reader = {key:action.paperKey,tabId:action.tabId,windowId:action.windowId,owner:action.owner,lastAt:now,expires:now+60000};
          touchPaper(state,now,action.paperKey);
        } else delete state.reader;
        break;
      case 'FOREGROUND': if (s) s.foreground = action.value === true; break;
      case 'CHOOSE':
        if (s && s.pendingSwitch) {
          if (!['free', 'pomodoro'].includes(action.mode)) throw Error('FOCUS_MODE_REQUIRED');
          if (action.mode === 'free' && s.pageType === 'nonpaper') s.freeElapsedMs = s.awayVisitMs;
          s.pendingSwitch = false; s.mode = action.mode; s.userPaused = false; s.overrideNonpaper = action.mode === 'pomodoro';
          s.running = action.mode === 'free' || s.phase === 'focus' || s.phase === 'break';
        }
        break;
      case 'MODE':
        if (s) {
          if (!['free', 'pomodoro'].includes(action.mode)) throw Error('FOCUS_MODE_REQUIRED');
          s.mode = action.mode; s.pendingSwitch = false; s.overrideNonpaper = action.mode === 'pomodoro' && s.pageType === 'nonpaper';
          s.userPaused = false; s.running = action.mode === 'free' || s.phase === 'focus' || s.phase === 'break';
        }
        break;
      case 'PAUSE': if (s) { s.running = false; s.userPaused = true; } break;
      case 'RESUME':
        if (s) { s.running = s.mode === 'free' || s.phase === 'focus' || s.phase === 'break'; s.userPaused = false; s.pendingSwitch = false; s.overrideNonpaper = s.mode === 'pomodoro' && s.pageType === 'nonpaper'; }
        break;
      case 'NEXT':
        if (s && s.phase === 'focus-done') { s.phase = 'break'; s.breakRemainingMs = s.breakTotalMs = ms(state.settings.breakMinutes); s.mode = 'pomodoro'; s.running = true; s.userPaused = false; }
        else if (s && s.phase === 'break-done') { s.phase = 'focus'; s.round += 1; s.focusRemainingMs = s.focusTotalMs = ms(state.settings.focusMinutes); s.mode = 'pomodoro'; s.running = true; s.userPaused = false; }
        break;
      case 'RECOVER': if (s) { s.running = false; s.userPaused = true; s.foreground = false; s.pageType = 'unknown'; s.pendingSwitch = false; } break;
      case 'END':
        if (s) {
          state.history.push({ id: s.id, startedAt: s.startedAt, endedAt: now, focusedMs: s.focusedMs, awayTotalMs: s.awayTotalMs, completedRounds: s.completedRounds });
          state.active = null;
        }
        break;
      case 'TICK': break;
      default: throw Error('FOCUS_UNKNOWN_ACTION');
    }
    if (['VISIT','PAGE','START'].includes(action.type) && action.pageType==='paper' && action.foreground!==false) touchPaper(state,now,action.paperKey);
    state.revision = (Number.isSafeInteger(state.revision) ? state.revision : 0) + 1;
    return { state, effects };
  }
  function projected(input, now) { return settle(load(input), now, []); }
  function deadline(state, now) {
    const s = state.active; if (!s) return null;
    const waits = [];
    if (s.running && s.mode === 'pomodoro' && ['focus','break'].includes(s.phase)) waits.push(s.phase === 'focus' ? s.focusRemainingMs : s.breakRemainingMs);
    if (s.pageType === 'nonpaper' && s.foreground && !s.awayNotified && state.settings.awayLimitMinutes > 0) waits.push(Math.max(0, ms(state.settings.awayLimitMinutes) - s.awayVisitMs));
    return waits.length ? now + Math.max(1, Math.min(...waits)) : null;
  }
  return { STORAGE_KEY, DEFAULTS, load, reduce, projected, deadline, dayKey, progress };
});


;/* native/reading-focus-ui.js */
(() => {
  'use strict';
  globalThis.SciLLM?.registerInterfaceTranslations?.({'阅读日历':'Reading calendar','时长（小时）':'Time (hours)','篇数':'Papers','统计指标':'Calendar metric'});
  const M = globalThis.BrevessReadingFocus;
  let shownPendingSwitch = null;
  let state = M.load(), preview = { type:'unknown', outline:[], reason:'正在识别页面结构' }, tabId, windowId, selectedMode = null, notifications = false, settingsDirty = false;
  const root = document.createElement('section'); root.id = 'readingFocusRoot'; root.setAttribute('aria-label','阅读专注');
  root.innerHTML = `<button id="focusToggle" type="button" aria-expanded="false" aria-controls="focusControls" title="自由计时 / 番茄钟" aria-label="阅读专注计时"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><g data-idle stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.5h12M6 20.5h12M7.5 3.5v2c0 3 2.5 4.7 4.5 6.5-2 1.8-4.5 3.5-4.5 6.5v2M16.5 3.5v2c0 3-2.5 4.7-4.5 6.5 2 1.8 4.5 3.5 4.5 6.5v2"/></g><g data-progress><circle cx="12" cy="12" r="9.5" opacity=".18"/><circle id="focusArc" cx="12" cy="12" r="9.5" pathLength="100" transform="rotate(-90 12 12)"/><text id="focusHours" x="12" y="12.5" text-anchor="middle" dominant-baseline="middle" fill="currentColor" stroke="none" font-size="11" font-weight="650"></text></g></svg><span id="focusCompactTime"></span></button>
    <section id="focusControls" aria-label="计时控制" hidden>
      <div class="focusHeading"><strong>阅读专注</strong><button id="focusCollapse" type="button" aria-label="收起计时面板">×</button></div>
      <div class="focusModes" role="group" aria-label="计时模式"><button type="button" data-focus-mode="free">自由计时</button><button type="button" data-focus-mode="pomodoro">番茄钟</button></div>
      <div id="focusPhase"></div><div id="focusClock">00:00</div>
      <div class="focusAway"><span>当次非论文 <b id="focusAwayVisit">00:00</b></span><span>本场非论文累计 <b id="focusAwayTotal">00:00</b></span></div>
      <section id="focusSwitchPrompt" role="status" aria-label="已离开论文" hidden><strong>已暂停番茄钟</strong><p>当前页面未识别为论文。</p><button type="button" id="focusChooseFree">进入自由计时</button><button type="button" id="focusChooseContinue">继续番茄钟</button></section>
      <div id="focusUnknown" hidden>页面类型待确认，可手动选择计时模式。</div>
      <div class="focusActions"><button id="focusPrimary" type="button">开始专注</button><button id="focusEnd" type="button" hidden>结束专注</button></div>
      <details id="focusCalendar" class="focus-calendar" open><summary>阅读日历</summary><div class="focus-calendar-heading"><div role="group" aria-label="统计指标"><button type="button" data-metric="time" aria-pressed="true">时长（小时）</button><button type="button" data-metric="papers" aria-pressed="false">篇数</button></div></div><div class="focus-month"><button id="focusPrevMonth" type="button" aria-label="上个月">‹</button><span id="focusMonth"></span><button id="focusNextMonth" type="button" aria-label="下个月">›</button></div><div id="focusDays" class="focus-days"></div><small id="focusDayDetail" aria-live="polite"></small></details>
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
  const currentMonth = () => {const d=new Date();return new Date(d.getFullYear(),d.getMonth(),1);};
  let calendarMonth=currentMonth(), metric='time', calendarKey='', pickedDay='';
  function renderCalendar(days) {
    if ($('focusControls').hidden || !$('focusCalendar').open) return;
    const year=calendarMonth.getFullYear(), month=calendarMonth.getMonth(), today=M.dayKey(Date.now());
    const locale=document.documentElement.lang.startsWith('en')?'en':'zh-CN';
    const date=new Date(year,month,1), last=new Date(year,month+1,0).getDate();
    const cells=Array.from({length:last},(_,i)=>{const key=M.dayKey(new Date(year,month,i+1));const day=days[key];return {key,minutes:Math.floor((day?.ms||0)/60000),papers:day?.papers.length||0,ms:day?.ms||0};});
    const nextKey=JSON.stringify([year,month,today,metric,locale,pickedDay,cells.map(d=>[d.minutes,d.ms>0,d.papers])]);if(nextKey===calendarKey)return;calendarKey=nextKey;
    $('focusMonth').textContent=new Intl.DateTimeFormat(locale,{year:'numeric',month:'long'}).format(date);
    $('focusNextMonth').disabled=date>=currentMonth();
    for(const b of root.querySelectorAll('[data-metric]'))b.setAttribute('aria-pressed',String(b.dataset.metric===metric));
    const grid=$('focusDays');grid.replaceChildren();const weekday=new Intl.DateTimeFormat(locale,{weekday:'narrow'});
    for(let i=0;i<7;i++){const label=document.createElement('span');label.textContent=weekday.format(new Date(2024,0,1+i));grid.append(label);}
    const hoursOf=d=>d.ms>0&&d.ms<180000?'<0.1':String(Math.round(d.ms / 3600000 * 10) / 10);
    const labelOf=d=>locale==='en'?`${d.key} · ${d.minutes} min · ${d.papers} papers`:`${d.key} · ${d.minutes||!d.ms?d.minutes:'不足 1'} 分钟 · ${d.papers} 篇`;
    const thresholds=metric==='papers'?[1,2,4,8]:[1,15*60000,45*60000,90*60000];
    for (const [i,d] of cells.entries()) {const b=document.createElement('button');b.type='button';b.dataset.day=d.key;b.textContent=metric==='papers'?String(d.papers):hoursOf(d);b.title=labelOf(d);b.setAttribute('aria-label',b.title);b.setAttribute('aria-pressed',String(d.key===pickedDay));if(d.key===today)b.setAttribute('aria-current','date');if(!i)b.style.gridColumnStart=(date.getDay()+6)%7+1;b.dataset.level=String(thresholds.filter(v=>(metric==='papers'?d.papers:d.ms)>=v).length);grid.append(b);}
    const selected=cells.find(d=>d.key===(pickedDay||today));$('focusDayDetail').textContent=selected?labelOf(selected):'';
  }
  function open(value) { $('focusControls').hidden=!value;$('focusToggle').setAttribute('aria-expanded',String(value)); if(value)render(); }
  function render() {
    const view=M.projected(state,Date.now());const s = view.active, mode=currentMode(s), done=s?.phase?.endsWith('-done');
    const duration = !s ? (mode==='pomodoro'?state.settings.focusMinutes*60000:0) : mode==='free' ? s.freeElapsedMs : s.phase.startsWith('break')?s.breakRemainingMs:s.focusRemainingMs;
    $('focusClock').textContent=format(duration);
    const ring=M.progress(s,state.settings);const toggle=$('focusToggle');toggle.toggleAttribute('data-counting',Boolean(ring));
    if(ring){$('focusArc').setAttribute('stroke-dasharray',`${ring.fraction*100} 100`);$('focusHours').textContent=ring.hours?String(ring.hours):'';}
    renderCalendar(view.days);
    $('focusCompactTime').textContent=s ? (done&&mode==='pomodoro'?'已到点':format(duration)) : '';
    $('focusToggle').title = !s?'自由计时 / 番茄钟':(mode==='free'?'自由计时':s.phase.startsWith('break')?'休息':'番茄钟')+(s.running?' · 进行中':' · 已暂停');
    if(s)toggle.title+=' · '+format(duration);toggle.setAttribute('aria-label',toggle.title);
    $('focusPhase').textContent = !s ? (mode==='free'?'自由计时':'番茄专注') : done&&mode==='pomodoro' ? (s.phase==='focus-done'?'专注完成 · 请手动开始休息':'休息结束 · 请手动开始下一轮') : (mode==='free'?'自由计时':s.phase==='break'?'休息':'番茄专注')+(s.running?'':' · 已暂停');
    $('focusAwayVisit').textContent=format(s?.awayVisitMs||0); $('focusAwayTotal').textContent=format(s?.awayTotalMs||0);
    for(const b of root.querySelectorAll('[data-focus-mode]'))b.setAttribute('aria-pressed',String(b.dataset.focusMode===mode));
    $('focusPrimary').textContent=!s?'开始专注':done&&mode==='pomodoro'?(s.phase==='focus-done'?'开始休息':'开始下一轮'):s.running?'暂停计时':'继续计时';
    $('focusEnd').hidden=!s; $('focusSwitchPrompt').hidden=!s?.pendingSwitch;
    $('focusPrimary').hidden=Boolean(s?.pendingSwitch);
    $('focusUnknown').hidden=preview.type!=='unknown';
    const pendingKey=s?.pendingSwitch ? s.id+':'+s.excursion : null;
    const newlyPending=pendingKey&&pendingKey!==shownPendingSwitch;
    shownPendingSwitch=pendingKey;
    if(newlyPending)open(true);
    if($('focusControls').hidden)return;
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
    header.insertBefore(root,$('saveCurrentArticleWorkspace') || $('openSidePanelSettings'));const main=app.querySelector('.workspace-main');main.before(pane);
    $('focusToggle').addEventListener('click',()=>open($('focusControls').hidden));$('focusCollapse').addEventListener('click',()=>open(false));
    root.addEventListener('keydown',e=>{if(e.key==='Escape'){open(false);$('focusToggle').focus();}});
    $('focusCalendar').addEventListener('toggle',()=>{if ($('focusCalendar').open) render();});
    for (const b of root.querySelectorAll('[data-metric]')) b.onclick=()=>{metric=b.dataset.metric;render();};
    for(const [id,delta] of [['focusPrevMonth',-1],['focusNextMonth',1]]) $(id).onclick=()=>{calendarMonth=new Date(calendarMonth.getFullYear(),calendarMonth.getMonth()+delta,1);pickedDay='';render();};
    $('focusDays').onclick=e=>{const b=e.target.closest('button[data-day]');if(b){pickedDay=b.dataset.day;render();$('focusDays').querySelector(`[data-day="${pickedDay}"]`)?.focus();}};
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
    async function refresh(){const token=++readGeneration;try{const response=await chrome.runtime.sendMessage({type:'BREVESS_READING_FOCUS',command:'READ',windowId,visible:!document.hidden});if(token!==readGeneration)return;if(response?.success)accept(response.data);else note(response?.error||'页面预览暂不可用');}catch(e){if(token===readGeneration)note(e.message);}}
    chrome.tabs.onActivated.addListener(info=>{if(info.windowId===windowId)void refresh();});
    chrome.tabs.onUpdated.addListener((id,change)=>{if(id===tabId&&(change.url||change.status==='complete'))void refresh();});
    render();renderPreview();chrome.windows.getCurrent().then(win=>{windowId=win.id;return refresh();}).catch(e=>note(e.message));
    const finishVisit=()=>{if(Number.isInteger(tabId))void chrome.runtime.sendMessage({type:'BREVESS_READING_FOCUS',command:'READER_CLOSED',windowId,tabId}).catch(()=>{});};
    document.addEventListener('visibilitychange',()=>{if(document.hidden)finishVisit();else if(windowId!=null)void refresh();});
    window.addEventListener('pagehide',finishVisit,{once:true});
    chrome.windows.onFocusChanged?.addListener(id=>{if(id===windowId&&!document.hidden)void refresh();});
    setInterval(()=>{if(!document.hidden&&windowId!=null&&preview.type==='paper')void refresh();},30000);
    setInterval(()=>{if(!document.hidden)render();},1000);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();


;/* native/unified-reading-ui.js */
(() => {
 'use strict';
 // A small bridge augments the original workspace, never creates a second one.
 const $=id=>document.getElementById(id);
 let current=null,epoch=0,lastPosition=null,legacy=null,loading=false,outlineRefreshAt=0,temporaryOutline=null,temporaryOwner='',temporarySignature='',preFilterStatus='';
 const styles=document.createElement('style');
 styles.textContent='#articleNavigationTree .workspace-tree-jump[aria-current="location"]{background:var(--bv-selected,#eef5f8);color:var(--bv-on-selected,#215c80);border-radius:4px}.unified-legacy{margin:10px 0}.unified-legacy textarea{width:100%;min-height:100px;font:inherit}.unified-legacy pre{white-space:pre-wrap;overflow-wrap:anywhere}';
 document.head.append(styles);
 function mark(){for(const el of $('articleNavigationTree')?.querySelectorAll('[data-reading-section-id]')||[]){if(el.dataset.readingSectionId===lastPosition)el.setAttribute('aria-current','location');else el.removeAttribute('aria-current');}}
 function clearLegacy(){for(const el of document.querySelectorAll('[data-unified-legacy]'))el.remove();legacy=null;}
 function call(command,extra={}){return chrome.runtime.sendMessage({type:'BREVESS_WEB_READING',command,windowId:current.windowId,...extra}).then(r=>{if(!r?.success)throw Error(r?.error||'网页记录读取失败');return r.data;});}
 function card(parent,title){const box=document.createElement('details');box.className='side-panel-result-card unified-legacy';box.dataset.unifiedLegacy='true';const summary=document.createElement('summary');summary.textContent=title;box.append(summary);parent?.append(box);return box;}
 function documentOwner(){return typeof activePanelTabContext==='undefined'?'':activePanelTabContext.key+'|'+(typeof manualAnnotationState==='object'?manualAnnotationState.contentWorldNonce:'');}
 function outlineSourceDetails(value,truncated=false,title=''){
  if(typeof value!=='string'||!value.trim())return {};
  const compact=text=>String(text||'').normalize('NFKC').replace(/^(?:提问|问题|Question|You)\s*[:：]\s*/i,'').replace(/\s+/g,'');
  if(!truncated&&compact(value)===compact(title))return {};
  return {unifiedOutlineFullText:value.slice(0,24000),unifiedOutlineTextTruncated:truncated===true||value.length>24000};
 }
 function filterOutline(snapshot){
  const value=temporaryOutline;
  if(!snapshot||!value||temporaryOwner!==documentOwner()||value.tabId!==activePanelTabContext?.tabId)return null;
  const frames=Array.isArray(value.frames)?value.frames:[],top=frames.find(f=>f.frameId===0);
  if(!top||String(top.url||'').split('#')[0]!==String(snapshot.url||'').split('#')[0])return null;
  if(!frames.some(f=>Array.isArray(f.groups)&&f.groups.length))return null;
  const nodes=[];let count=0,omitted=0,currentSectionId=null;
  for(const frame of frames){omitted+=Number(frame.omitted)||0;for(const group of frame.groups||[]){const stack=[];for(const item of group.items||[]){
   const level=Math.min(6,Math.max(1,Number(item.level)||1));
   const ref={tabId:value.tabId,frameId:frame.frameId,session:frame.session,version:frame.version,id:item.id};
   const node={sectionId:'filter:'+JSON.stringify([ref.tabId,ref.frameId,ref.session,group.operation,item.id]),title:item.title,searchTitleFontSize:item.searchTitleFontSize,searchPublication:item.searchPublication,...outlineSourceDetails(item.fullText,item.textTruncated===true||String(item.fullText||'').length>=2400,item.title),level,children:[],paragraphs:[],paragraphCount:0,analysisSectionIds:[],unifiedFilterReference:ref};
   if(frame.currentId===item.id)currentSectionId=node.sectionId;
   while(stack.length&&stack.at(-1).level>=level)stack.pop();(stack.length?stack.at(-1).children:nodes).push(node);stack.push(node);count++;
  }}}
  return {nodes,count,omitted,currentSectionId,reading:value.provider==='reading-module'&&!value.temporary};
 }
 function structuredSnapshot(){return legacy?.snapshot?.kind==='conversation'||legacy?.snapshot?.outlineKind==='feed';}
 function projectOutline(snapshot){
  const filtered=filterOutline(snapshot);
  if(filtered){
    if(!filtered.reading)return {...snapshot,nodes:filtered.nodes};
    // Reading-mode nodes have session-scoped scroll targets. Translation and
    // persistence use the original section identities, including after reload.
    const originals=snapshot.readingTranslationSourceNodes || snapshot.nodes || [];
    const normalize=title=>String(title||'').normalize('NFKC').replace(/\s+/g,' ').trim();
    const byTitle=new Map();
    function index(nodes,parent=''){
      for(const node of nodes){
        const title=normalize(node.title), matches=byTitle.get(title)||[];
        matches.push({node,parent}); byTitle.set(title,matches);
        index(node.children||[],title);
      }
    }
    function bind(nodes,parent=''){
      for(const node of nodes){
        const title=normalize(node.title), all=byTitle.get(title)||[];
        const matches=all.length>1 ? all.filter(item=>item.parent===parent) : all;
        if(matches.length===1)node.translationSource=matches[0].node;
        bind(node.children||[],title);
      }
    }
    index(originals); bind(filtered.nodes);
    return {...snapshot,nodes:filtered.nodes,readingTranslationSourceNodes:originals};
  }
  if(!structuredSnapshot()||!snapshot||String(snapshot.url||'').split('#')[0]!==legacy.snapshot.sourceUrl)return snapshot;
  const s=legacy.snapshot,items=new Map((s.outline||[]).map(r=>[r.id,{sectionId:'web:'+r.id,title:r.title,...outlineSourceDetails(r.text,r.textTruncated,r.title),level:r.level,children:[],paragraphs:[],paragraphCount:0,analysisSectionIds:[],unifiedWebReference:r}])),nodes=[];
  for(const r of s.outline||[]){const node=items.get(r.id),parent=items.get(r.parentId);(parent?parent.children:nodes).push(node);}
  return {...snapshot,nodes};
 }
 function conversationStatus(){const filtered=filterOutline(typeof currentWorkspaceSnapshot==='undefined'?null:currentWorkspaceSnapshot);if(filtered&&$('articleNavigationStatus')){$('articleNavigationStatus').textContent=(filtered.reading?'阅读大纲':'滤镜大纲')+' · '+filtered.count+' 项'+(filtered.omitted?' · 另有 '+filtered.omitted+' 项未显示':'');return;}if(structuredSnapshot()&&typeof currentWorkspaceSnapshot==='object'&&String(currentWorkspaceSnapshot?.url||'').split('#')[0]===legacy.snapshot.sourceUrl&&$('articleNavigationStatus'))$('articleNavigationStatus').textContent=legacy.snapshot.adapterStatus==='unrecognized'?'当前站点消息结构尚未识别':legacy.snapshot.outlineKind==='feed'?'当前动态 · '+legacy.snapshot.outline.filter(r=>r.level===1).length+' 条 · 仅已加载内容':'当前对话 · '+legacy.snapshot.outline.filter(r=>r.role==='user'&&r.level===1).length+' 个提问 · 仅已加载内容';}
 function conversationOutline(){
  if(!structuredSnapshot()||!currentWorkspaceSnapshot)return;
  renderArticleNavigationTree(currentWorkspaceSnapshot);conversationStatus();
  const s=legacy.snapshot;
  if(!filterOutline(currentWorkspaceSnapshot))lastPosition=s.currentId?'web:'+s.currentId:lastPosition;mark();
 }
 function renderLegacy(){
  if(!legacy?.saved)return;
  const value=legacy.saved.content;
  if(value.notes && !$('literatureNoteDrawer')?.querySelector('[data-unified-legacy]')){
   const box=card($('literatureNoteDrawer'),'已有网页笔记'),editor=document.createElement('textarea'),status=document.createElement('small');editor.value=value.notes;editor.setAttribute('aria-label','已有网页笔记');box.append(editor,status);
   const owner=legacy,ownerContext=current;let timer,chain=Promise.resolve(),savedValue=value.notes;
   const flush=()=>{clearTimeout(timer);const notes=editor.value;if(notes===savedValue)return;status.textContent='正在保存…';chain=chain.catch(()=>{}).then(async()=>{const r=await chrome.runtime.sendMessage({type:'BREVESS_WEB_READING',command:'SAVE',windowId:ownerContext.windowId,context:owner.context,notes,expectedNotes:savedValue,expectedRevision:owner.saved.revision});if(!r?.success)throw Error(r?.error||'保存失败');owner.saved=r.data.asset;savedValue=notes;status.textContent=r.data.sync?.state==='saved'?'已写入本地文件夹':'已暂存，待写入本地文件夹';}).catch(e=>{status.textContent=e.message;});};
   editor.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(flush,350);});editor.addEventListener('blur',flush);
  }
  if(value.annotations?.length&&!$('workspace-highlights')?.querySelector('[data-unified-legacy]')){
   const box=card($('workspace-highlights'),'已有网页高亮与备注');
   for(const a of value.annotations){const row=document.createElement('div'),button=document.createElement('button'),note=document.createElement('textarea'),status=document.createElement('small');button.type='button';button.className='btn btn-secondary';button.textContent=a.quote;const owner=legacy,ownerContext=current;button.onclick=()=>call('ANCHOR',{context:owner.context,anchor:a}).catch(e=>{status.textContent=e.message;});note.value=a.note||'';note.setAttribute('aria-label','已有网页原句备注');let timer,chain=Promise.resolve();const flush=()=>{clearTimeout(timer);const text=note.value;chain=chain.catch(()=>{}).then(async()=>{const prior=owner.saved.content.annotations||[],annotations=prior.map(item=>item.id===a.id?{...item,note:text}:item);status.textContent='正在保存…';const r=await chrome.runtime.sendMessage({type:'BREVESS_WEB_READING',command:'ANNOTATIONS',windowId:ownerContext.windowId,context:owner.context,annotations,expectedAnnotations:prior,expectedRevision:owner.saved.revision});if(!r?.success)throw Error(r?.error||'保存失败');owner.saved=r.data.asset;status.textContent=r.data.sync?.state==='saved'?'已写入本地文件夹':'已暂存，待写入本地文件夹';}).catch(e=>{status.textContent=e.message;});};note.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(flush,350);});note.addEventListener('blur',flush);row.append(button,note,status);box.append(row);}
  }
  const turns=(legacy.history?.items||[]).filter(t=>!globalThis.BrevessUnifiedComposer||t.mode!=='multi');
  if(turns.length&&!$('workspace-chat')?.querySelector('[data-unified-legacy]')){
   const box=card($('workspace-chat'),'已有网页问答');$('articleChatForm')?.before(box);
   for(const t of turns){const q=document.createElement('strong'),a=document.createElement('pre');q.textContent=t.question;a.textContent=t.answer||t.text||'回答未完成';box.append(q,a);}
  }
 }
 async function refresh(){
  if(loading||typeof activePanelTabContext==='undefined'||!activePanelTabContext.activated)return;
  conversationStatus();
  const context=activePanelTabContext,key=context.key,documentKey=key+'|'+(typeof manualAnnotationState==='object'?manualAnnotationState.contentWorldNonce:'');if(current?.documentKey===documentKey){renderLegacy();conversationOutline();if(structuredSnapshot()&&Date.now()-outlineRefreshAt>3000){loading=true;outlineRefreshAt=Date.now();try{const r=await call('READ');if(current?.documentKey===documentKey&&!r.paper){legacy.snapshot=r.snapshot;legacy.context=r.context;conversationOutline();}}catch(_){}finally{loading=false;}}return;}
  const ticket=++epoch;loading=true;clearLegacy();lastPosition=null;mark();
  try{const tab=await chrome.tabs.get(context.tabId);if(ticket!==epoch||activePanelTabContext.key!==key)return;current={key,documentKey,tabId:tab.id,windowId:tab.windowId,url:tab.url};const result=await call('READ');if(activePanelTabContext.key!==key){current=null;return;}if(!result.paper){legacy=result;renderLegacy();conversationOutline();}}
  catch(_){current=null;}finally{loading=false;}
 }
 function locationError(e){if($('articleNavigationFocusStatus')){$('articleNavigationFocusStatus').hidden=false;$('articleNavigationFocusStatus').textContent=e.message;}}
 globalThis.BrevessUnifiedReading={projectOutline,locate:ref=>call('LOCATE',{context:legacy?.context,ref}).then(r=>{if(!r.found)throw Error(r.reason||'当前网页未找到原位置');}).catch(locationError),locateFilter:async(ref,sectionId)=>{const owner=documentOwner();try{if(!filterOutline(currentWorkspaceSnapshot))throw Error('滤镜大纲已更新，请重新选择');const r=await globalThis.BrevessUnifiedComposer?.locateOutline(ref);if(!r?.located)throw Error('当前网页未找到原位置');if(owner===documentOwner()&&filterOutline(currentWorkspaceSnapshot)){lastPosition=sectionId;mark();}}catch(e){locationError(e);}}};
 document.addEventListener('brevess:temporary-outline',event=>{const value=event.detail;if(value&&value.tabId!==activePanelTabContext?.tabId)return;const owner=documentOwner(),signature=owner+'|'+JSON.stringify(value);if(signature===temporarySignature)return;const snapshot=typeof currentWorkspaceSnapshot==='undefined'?null:currentWorkspaceSnapshot,wasFiltered=filterOutline(snapshot);if(!wasFiltered)preFilterStatus=$('articleNavigationStatus')?.textContent||'';temporarySignature=signature;temporaryOwner=owner;temporaryOutline=value;if(lastPosition?.startsWith('filter:'))lastPosition=null;if(snapshot){const projected=filterOutline(snapshot);if(projected?.reading)lastPosition=projected.currentSectionId;renderArticleNavigationTree(snapshot);if(wasFiltered&&!projected&&/^(滤镜|阅读)大纲/.test($('articleNavigationStatus')?.textContent||''))$('articleNavigationStatus').textContent=preFilterStatus;conversationStatus();mark();}});
 chrome.runtime.onMessage.addListener((m,s)=>{if(filterOutline(typeof currentWorkspaceSnapshot==='undefined'?null:currentWorkspaceSnapshot))return false;if(m?.type==='BREVESS_UNIFIED_READING_POSITION'&&!structuredSnapshot()&&s?.id===chrome.runtime.id&&s.tab?.id===activePanelTabContext?.tabId&&String(s.tab.url||'').split('#')[0]===String(m.url||'').split('#')[0]){lastPosition=m.sectionId;mark();}if(m?.type==='BREVESS_WEB_READING_EVENT'&&m.position&&structuredSnapshot()&&m.tabId===current?.tabId){lastPosition='web:'+m.currentId;legacy.snapshot.currentId=m.currentId;mark();}return false;});
 function init(){const tree=$('articleNavigationTree');if(tree)new MutationObserver(()=>{mark();conversationStatus();}).observe(tree,{childList:true,subtree:true});setInterval(refresh,900);void refresh();}
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();


;/* native/same-paper-sidebar.js */
(() => {
 'use strict';
 let owner='',signature='',binding='',boundNonce='',busy=false,reading=false,box=null,requested=false;const drafts=new Map();
 const context=()=>({tabId:activePanelTabContext?.tabId,url:activePanelTabContext?.url||'',nonce:manualAnnotationState?.contentWorldNonce||'',key:(activePanelTabContext?.key||'')+'|'+(manualAnnotationState?.contentWorldNonce||'')});
 const node=(tag,text)=>{const el=document.createElement(tag);el.textContent=text;return el;};
 function clear(){box?.remove();box=null;signature='';binding='';boundNonce='';drafts.clear();}
 async function send(c,extra){const r=await chrome.tabs.sendMessage(c.tabId,{type:'BREVESS_SAME_PAPER_SIDEBAR',url:c.url,...extra},{frameId:0});if(!r?.success)throw Error(r?.error||'批注暂不可用');return r.data;}
 async function refresh(){
  if(typeof activePanelTabContext==='undefined'||typeof manualAnnotationState==='undefined')return;
  const c=context();if(c.key!==owner){owner=c.key;clear();}
  if(busy||reading||!c.url||!Number.isInteger(c.tabId))return;
  const parent=document.getElementById('workspace-highlights');if(!parent)return;
  reading=true;
  try{const data=await send(c,{command:'READ'});if(context().key!==c.key||busy)return;
   if(binding&&binding!==data.binding)clear();binding=data.binding;boundNonce=data.contentWorldNonce;
   const next=JSON.stringify(data);if(next===signature)return;signature=next;
   if(!data.rows.length){clear();return;}
   const open=box?.open??true;box?.remove();box=node('details','');box.dataset.samePaperNotes='true';box.className='side-panel-result-card';box.open=open;
   box.append(node('summary','同篇文献批注 · '+data.rows.length));parent.append(box);
   for(const row of data.rows){
    const item=node('div','');item.className='workspace-highlight-entry';item.style.cssText='padding:10px 0;border-top:1px solid #ddd';
    item.append(node('small',row.local?'自动关联的本机批注':'关联的共享备注'),node('p',row.quote),node('p',row.text||'（空备注）'));
    const status=node('small',row.located?'已定位原文':row.reason||'当前页面未找到唯一位置');item.append(status);
    const action=(label,kind,value,token=row.token)=>{const button=node('button',label);button.type='button';button.className='btn btn-secondary';
     button.addEventListener('click',async event=>{if(!event.isTrusted||busy)return;busy=true;button.disabled=true;try{if(context().key!==c.key)throw Error('文献已变化');await send(c,{command:'ACTION',binding:data.binding,contentWorldNonce:data.contentWorldNonce,key:row.key,token,action:kind,...(value?{value:value()}: {})});if(kind==='edit')drafts.delete(row.key);status.textContent=kind==='edit'?'已保存原批注':'已完成';signature='';}catch(e){status.textContent=e.message;}finally{button.disabled=false;busy=false;void refresh();}});return button;};
    const locate=action('定位','locate');locate.disabled=!row.located;item.append(locate);
    if(row.local&&row.association==='active'){
     const editor=node('details',''),area=node('textarea','');editor.append(node('summary','编辑原批注'));area.setAttribute('aria-label','同篇文献原批注');area.style.cssText='width:100%;min-height:80px;font:inherit';
     const draft=drafts.get(row.key);area.value=draft?.value??row.text;area.addEventListener('input',()=>drafts.set(row.key,{value:area.value,token:draft?.token||row.token}));editor.open=!!draft;
     editor.append(area,action('保存原批注','edit',()=>area.value,draft?.token||row.token));item.append(editor);
    }else if(!row.local)item.append(action('评论','thread'));
    if(row.association)item.append(action(row.association==='active'?'停止跨原件显示':'恢复跨原件显示','association'));
    box.append(item);
   }
   if(requested){requested=false;box.open=true;box.scrollIntoView({block:'nearest'});}
  }catch(_){if(context().key!==c.key)clear();}finally{reading=false;}
 }
 chrome.runtime.onMessage.addListener((m,s)=>{
  if(m?.type!=='BREVESS_SAME_PAPER_REVEAL'||s?.id!==chrome.runtime.id)return false;
  const c=context();if(s.tab?.id!==c.tabId||m.contentWorldNonce!==boundNonce)return false;
  switchWorkspaceView('highlights');requested=true;signature='';void refresh();return false;
 });
 setInterval(refresh,1000);void refresh();
})();


;/* native/workspace-storage-choices.js */
(()=>{'use strict';let pending=null;
 function choose(mode){if(pending)return pending;const dialog=document.createElement('dialog');dialog.className='brevess-storage-choice';dialog.innerHTML=mode==='save'?'<form method="dialog"><h3>保存当前资料</h3><p>保存正文、图片和已有的翻译、高亮、笔记、解图与问答。</p><label><input name="page" type="checkbox" checked>包含网页与离线阅读副本</label><p><small>未勾选时不新增网页副本，已存在的副本保留。</small></p><div><button value="cancel">取消</button><button value="confirm">保存</button></div></form>':'<form method="dialog"><h3>删除当前资料</h3><label><input name="page" type="checkbox">网页正文与离线副本</label><label><input name="user" type="checkbox">用户数据（高亮、备注、笔记和AI结果）</label><p><small>只删除勾选部分。</small></p><div><button value="cancel">取消</button><button value="confirm">删除所选内容</button></div></form>';
 document.body.append(dialog);pending=new Promise(resolve=>{dialog.addEventListener('close',()=>{const value=dialog.returnValue==='confirm'?{page:dialog.querySelector('[name="page"]').checked,user:!!dialog.querySelector('[name="user"]')?.checked}:null;dialog.remove();pending=null;resolve(value);},{once:true});dialog.showModal();});return pending;
 }
 globalThis.BrevessWorkspaceChoices={choose};})();


;/* native/web-filters-general/ux-context.js */
(function(g,factory){const api=factory();if(typeof module==='object')module.exports=api;g.WFGUXContext=api;})(globalThis,function(){
'use strict';
function outlineIntent(question){const q=String(question||'').trim();return /(?:调整|修改|自定义|重做|设置|分组|过滤).{0,18}(?:插件)?(?:大纲|目录)|(?:提取|生成).{0,12}(?:插件|侧栏).{0,8}(?:大纲|目录)|(?:大纲|目录).{0,18}(?:提取|分组|层级|范围|字段|排除)|(?:按|每)(?:每)?(?:条|个|篇|项).{0,20}(?:动态|帖子|消息|文章|事件|活动|结果).{0,25}(?:列出|提取|显示|分组)|(?:adjust|customize|change|extract|group).{0,30}(?:outline|toc)/i.test(q);}
function route({question='',adjustmentMode='display',contextScope={},webSearch={mode:'off'},sourceIds=[],adjusting=false,hasAuxiliarySources=false}={}){
 const mode=webSearch?.mode??'off';
 if(!['off','on','deep','auto'].includes(mode))throw Error('WEB_SEARCH_MODE_INVALID');
 const scoped=['sectionIds','sectionTitles','scopes'].some(k=>Array.isArray(contextScope?.[k])&&contextScope[k].length>0);
 if(adjusting&&outlineIntent(question)){if(scoped)throw Error('ORIGINAL_CONTEXT_COMBINATION_UNSUPPORTED');return {kind:'outline',webSearch:{mode:'off',enabled:false},contextScope};}
 if(adjusting){if(scoped)throw Error('ORIGINAL_CONTEXT_COMBINATION_UNSUPPORTED');return {kind:'display',webSearch:{mode:'off',enabled:false},contextScope};}
 if(sourceIds.length<=1&&(!hasAuxiliarySources||scoped||mode!=='off'))return {kind:'original',scoped,webSearch:{mode,enabled:['on','deep'].includes(mode)},contextScope};
 if(scoped||mode!=='off')throw Error('ORIGINAL_CONTEXT_COMBINATION_UNSUPPORTED');
 return {kind:'research',webSearch:{mode:'off',enabled:false},contextScope};
}
function shouldSubmit(e){return e.key==='Enter'&&!e.shiftKey&&!e.altKey&&!e.ctrlKey&&!e.metaKey&&!e.isComposing&&!e.composing&&e.keyCode!==229;}
return {route,shouldSubmit,outlineIntent};
});


;/* native/providers/provider-registry.js */
(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  const DEFINITIONS = {
    openai: {
      label: 'OpenAI', defaultModel: 'gpt-5-mini',
      models: ['gpt-5-mini', 'gpt-5', 'gpt-4.1'],
      supportsVision: true, visionInputFormat: 'openai',
      contextWindowTokens: 128000, maxOutputTokens: 65536
    },
    anthropic: {
      label: 'Anthropic Claude', defaultModel: 'claude-sonnet-4-6',
      models: ['claude-sonnet-4-6', 'claude-opus-4-7', 'claude-opus-4-6', 'claude-haiku-4-5'],
      supportsVision: true, visionInputFormat: 'anthropic',
      contextWindowTokens: 200000, maxOutputTokens: 65536
    },
    gemini: {
      label: 'Google Gemini', defaultModel: 'gemini-3.6-flash',
      models: ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-2.5-pro', 'gemini-2.5-flash'],
      supportsVision: true, visionInputFormat: 'gemini',
      contextWindowTokens: 128000, maxOutputTokens: 65536
    },
    deepseek: {
      label: 'DeepSeek', defaultModel: 'deepseek-v4-flash',
      models: [
        'deepseek-flash', 'deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp'
      ],
      supportsVision: false, visionInputFormat: 'none',
      contextWindowTokens: 128000, maxOutputTokens: 65536
    },
    typesafe: {
      label: 'TypeSafe Jev（文本判定）', defaultModel: 'jev-latest',
      models: ['jev-latest', 'jev-1.13.0', 'jev-preview'],
      supportsVision: false, visionInputFormat: 'none',
      supportedTaskIds: ['document_highlight', 'semantic_find'], textGeneration: false,
      typedDecisions: true, decisionTypes: ['noul', 'choice'],
      contextWindowTokens: 64000, maxStateQuestionTokens: 32000,
      maxOutputTokens: 32768
    },
    'codex-local': {
      label: '本机 Codex', defaultModel: 'auto',
      models: ['auto'],
      supportsVision: true, visionInputFormat: 'codex-local',
      contextWindowTokens: 400000, maxOutputTokens: 65536,
      localOnly: true
    },
    'deepseek-harness': {
      label: '本机 DeepSeek Harness', defaultModel: 'deepseek-flash',
      models: ['deepseek-flash', 'deepseek-v4-pro'],
      supportsVision: false, visionInputFormat: 'deepseek-harness',
      contextWindowTokens: 1000000, maxOutputTokens: 256000,
      localOnly: true
    },
    'openai-compatible': {
      label: '自定义 OpenAI 兼容接口', defaultModel: '', requiresBaseUrl: true,
      models: [], supportsVision: false, visionInputFormat: 'openai',
      contextWindowTokens: 32768, maxOutputTokens: 65536
    }
  };

  const COMPATIBLE_PROVIDER_PRESETS = [
    {
      id: 'custom', label: '自定义 OpenAI 兼容接口',
      description: '手动填写服务地址、模型名称和鉴权方式。',
      baseUrl: '', defaultModel: '', authHeader: 'Authorization', authPrefix: 'Bearer',
      jsonMode: true, supportsVision: false
    },
    {
      id: 'grok', label: 'Grok（xAI）',
      description: 'xAI 官方 OpenAI 兼容接口。',
      baseUrl: 'https://api.x.ai/v1', defaultModel: 'grok-4.7',
      authHeader: 'Authorization', authPrefix: 'Bearer', jsonMode: true, supportsVision: true
    },
    {
      id: 'kimi', group: 'domestic', label: 'Kimi（月之暗面）',
      description: 'Kimi 官方 OpenAI Chat Completions 接口。',
      baseUrl: 'https://api.moonshot.cn/v1', defaultModel: 'kimi-k3',
      authHeader: 'Authorization', authPrefix: 'Bearer', jsonMode: true, supportsVision: true
    },
    {
      id: 'zhipu', group: 'domestic', label: '智谱 GLM',
      description: '智谱开放平台通用 API。',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4', defaultModel: 'glm-5.2',
      authHeader: 'Authorization', authPrefix: 'Bearer', jsonMode: true, supportsVision: false
    },
    {
      id: 'doubao', group: 'domestic', label: '豆包（火山方舟）',
      description: '火山方舟 OpenAI 兼容 Chat 接口。',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      defaultModel: 'doubao-seed-2-0-lite-260215',
      authHeader: 'Authorization', authPrefix: 'Bearer', jsonMode: true, supportsVision: false
    },
    {
      id: 'qwen', group: 'domestic', label: '通义千问（阿里云百炼）',
      description: '阿里云百炼 OpenAI 兼容接口（北京地域）。',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', defaultModel: 'qwen-flash',
      authHeader: 'Authorization', authPrefix: 'Bearer', jsonMode: true, supportsVision: false
    },
    {
      id: 'hunyuan-tokenhub', group: 'domestic', label: '腾讯混元（TokenHub）',
      description: '腾讯云当前推荐的 TokenHub 接口，需要 TokenHub API Key。',
      baseUrl: 'https://tokenhub.tencentmaas.com/v1', defaultModel: 'hy3-preview',
      authHeader: 'Authorization', authPrefix: 'Bearer', jsonMode: true, supportsVision: false
    },
    {
      id: 'hunyuan-classic', group: 'domestic', label: '腾讯混元（经典 API）',
      description: '适用于已有混元经典 API Key 的账户。',
      baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1', defaultModel: 'hunyuan-turbos-latest',
      authHeader: 'Authorization', authPrefix: 'Bearer', jsonMode: true, supportsVision: false
    },
    {
      id: 'qianfan', group: 'domestic', label: '百度千帆',
      description: '千帆 v2 OpenAI 兼容接口。',
      baseUrl: 'https://qianfan.baidubce.com/v2', defaultModel: 'ernie-4.5-turbo-32k',
      authHeader: 'Authorization', authPrefix: 'Bearer', jsonMode: true, supportsVision: false
    },
    {
      id: 'minimax', group: 'domestic', label: 'MiniMax',
      description: 'MiniMax M2.7 OpenAI 兼容文本接口。',
      baseUrl: 'https://api.minimaxi.com/v1', defaultModel: 'MiniMax-M2.7',
      authHeader: 'Authorization', authPrefix: 'Bearer', jsonMode: true, supportsVision: false
    }
  ];

  const FACTORY_EXPORTS = {
    openai: 'createOpenAIAdapter',
    anthropic: 'createAnthropicAdapter',
    gemini: 'createGeminiAdapter',
    deepseek: 'createDeepSeekAdapter',
    typesafe: 'createTypeSafeAdapter',
    'codex-local': 'createCodexLocalAdapter',
    'deepseek-harness': 'createDeepSeekHarnessAdapter',
    'openai-compatible': 'createOpenAICompatibleAdapter'
  };

  function runtimeShared() {
    if (typeof globalThis !== 'undefined' && globalThis.SciLLM) {
      return globalThis.SciLLM;
    }
    return shared;
  }

  function getProviderDefinitions() {
    const definitions = JSON.parse(JSON.stringify(DEFINITIONS));
    const highlightVersion = runtimeShared().JEV_HIGHLIGHT_ALGORITHM_VERSION;
    const semanticFindVersion = runtimeShared().SEMANTIC_FIND_VERSION || 'semantic-find-v1';
    definitions.typesafe.taskAlgorithmVersions = {
      semantic_find: String(semanticFindVersion)
    };
    if (typeof highlightVersion === 'string' && highlightVersion) {
      definitions.typesafe.taskAlgorithmVersions.document_highlight = highlightVersion;
    }
    return definitions;
  }

  function getCompatibleProviderPresets() {
    return JSON.parse(JSON.stringify(COMPATIBLE_PROVIDER_PRESETS));
  }

  function noReasoningCapability() {
    return {
      supported: false,
      mode: 'none',
      levels: [],
      defaultLevel: 'auto'
    };
  }

  function reasoningCapability(mode, levels, defaultLevel = 'auto') {
    return {
      supported: true,
      mode,
      levels: [...levels],
      defaultLevel
    };
  }

  // Model catalogs carry capabilities, not credentials or page content. Bind
  // them to the service endpoint so a different gateway cannot inherit them.
  function modelCapabilityScope(providerId, config = {}) {
    return JSON.stringify([providerId, String(config.baseUrl || '').trim().replace(/\/+$/, ''), String(config.presetId || '')]);
  }

  function modelReasoningMetadata(item, providerId) {
    let raw = item?.reasoningEfforts ?? item?.supportedReasoningEfforts ?? item?.supported_reasoning_efforts;
    const thinking = item?.capabilities?.thinking;
    const effort = item?.capabilities?.effort;
    if (providerId === 'anthropic' && effort && typeof effort.supported === 'boolean') {
      raw = effort.supported ? Object.keys(effort).filter(key => key !== 'supported' && effort[key]?.supported === true) : [];
    }
    if (!Array.isArray(raw)) return thinking?.supported === false ? noReasoningCapability() : null;
    const levels = [...new Set(raw.map(value => typeof value === 'string' ? value : value?.reasoningEffort ?? value?.effort ?? value?.id)
      .filter(value => typeof value === 'string' && /^[a-z][a-z0-9_-]{0,63}$/.test(value)))].slice(0, 32);
    if (!levels.length) return noReasoningCapability();
    const advertisedDefault = item.defaultReasoningEffort ?? item.default_reasoning_effort;
    const offLevel = levels.find(level => ['off', 'none', 'disabled'].includes(level));
    return { supported: true, mode: 'effort', levels: ['auto', ...levels.filter(level => level !== 'auto')],
      defaultLevel: levels.includes(advertisedDefault) ? advertisedDefault : 'auto',
      canDisable: Boolean(offLevel) || thinking?.types?.disabled?.supported === true,
      offLevel: offLevel || 'auto',
      ...(thinking?.types?.adaptive?.supported === true ? { thinkingType: 'adaptive' } : {}) };
  }

  function buildModelCapabilityCatalog(providerId, config, models, fetchedAt = Date.now()) {
    const entries = [];
    for (const item of (Array.isArray(models) ? models : []).slice(0, 500)) {
      const id = String(item?.id || item?.model || '').trim();
      if (!id || id.length > 256) continue;
      const reasoning = modelReasoningMetadata(item, providerId);
      const web = item?.capabilities?.server_tools?.web_search?.supported ?? item?.webSearchSupported;
      if (!reasoning && typeof web !== 'boolean') continue;
      entries.push({ id, ...(reasoning ? { reasoning } : {}), ...(typeof web === 'boolean' ? { webSearch: web } : {}) });
      if (providerId === 'codex-local' && item.isDefault === true) entries.push({ ...entries[entries.length - 1], id: 'auto' });
    }
    return { scope: modelCapabilityScope(providerId, config), fetchedAt, models: entries };
  }

  function getDeclaredModelCapabilities(providerId, config = {}) {
    const catalog = config.modelCapabilityCatalog;
    if (!catalog || catalog.scope !== modelCapabilityScope(providerId, config)) return null;
    if (!Array.isArray(catalog.models)) return null;
    const item = catalog.models.find(item => item?.id === String(config.model || '').trim());
    if (!item) return null;
    const raw = item.reasoning;
    const levels = Array.isArray(raw?.levels) ? [...new Set(raw.levels.filter(value =>
      typeof value === 'string' && /^[a-z][a-z0-9_-]{0,63}$/.test(value)))].slice(0, 32) : [];
    const reasoning = raw?.supported === false ? noReasoningCapability() :
      raw?.supported === true && levels.length ? {
        supported: true, mode: raw.mode === 'toggle' ? 'toggle' : 'effort', levels,
        defaultLevel: levels.includes(raw.defaultLevel) ? raw.defaultLevel : levels.includes('auto') ? 'auto' : levels[0],
        ...(typeof raw.canDisable === 'boolean' ? { canDisable: raw.canDisable } : {}),
        ...(levels.includes(raw.offLevel) ? { offLevel: raw.offLevel } : {}),
        ...(raw.thinkingType === 'adaptive' ? { thinkingType: 'adaptive' } : {})
      } : null;
    return { ...(reasoning ? { reasoning } : {}), ...(typeof item.webSearch === 'boolean' ? { webSearch: item.webSearch } : {}) };
  }

  function reasoningCanDisable(providerId, config, capability = getProviderReasoningCapabilities(providerId, config)) {
    if (!capability?.supported) return false;
    if (typeof capability.canDisable === 'boolean') return capability.canDisable;
    return capability.mode === 'toggle' || ['deepseek', 'deepseek-harness'].includes(providerId) ||
      capability.levels.some(level => ['none', 'off', 'disabled'].includes(level));
  }

  function getProviderReasoningCapabilities(providerId, config = {}) {
    const declared = getDeclaredModelCapabilities(providerId, config)?.reasoning;
    if (declared && ['openai', 'anthropic', 'gemini', 'deepseek', 'codex-local', 'deepseek-harness', 'openai-compatible'].includes(providerId)) {
      // A catalog cannot enable a parameter on a protocol the adapter lacks.
      if (providerId === 'openai' && /\/chat\/completions(?:[/?#]|$)/i.test(String(config.baseUrl || ''))) return noReasoningCapability();
      return { ...declared, levels: [...declared.levels] };
    }
    const model = normalizedModelName(config);
    if (providerId === 'openai') {
      if (/\/chat\/completions(?:[/?#]|$)/i.test(String(config.baseUrl || ''))) {
        return noReasoningCapability();
      }
      if (/^(?:gpt-5(?:[-_.]|$)|o(?:1|3|4)(?:[-_.]|$))/.test(model)) {
        if (/^gpt-5-pro(?:[-_.]|$)/.test(model)) {
          return reasoningCapability('effort', ['auto', 'high']);
        }
        if (/^gpt-5\.(?:2|4)-pro(?:[-_.]|$)/.test(model)) {
          return reasoningCapability('effort', ['auto', 'medium', 'high', 'xhigh']);
        }
        if (/^gpt-5\.6(?:[-_.]|$)/.test(model)) {
          return reasoningCapability('effort', [
            'auto', 'none', 'low', 'medium', 'high', 'xhigh', 'max'
          ]);
        }
        if (/^gpt-5\.1(?:[-_.]|$)/.test(model)) {
          return reasoningCapability('effort', [
            'auto', 'none', 'low', 'medium', 'high'
          ]);
        }
        if (/^gpt-5\.(?:2|4)(?:[-_.]|$)/.test(model)) {
          return reasoningCapability('effort', [
            'auto', 'none', 'low', 'medium', 'high', 'xhigh'
          ]);
        }
        if (/^gpt-5(?:$|-20\d{2}|-(?:mini|nano|codex)(?:[-_.]|$))/.test(model)) {
          return reasoningCapability('effort', [
            'auto', 'minimal', 'low', 'medium', 'high'
          ]);
        }
        if (/^o(?:1|3|4)(?:[-_.]|$)/.test(model)) {
          return reasoningCapability('effort', /(?:^|[-_.])pro(?:[-_.]|$)/.test(model)
            ? ['auto', 'high'] : ['auto', 'low', 'medium', 'high']);
        }
      }
      return noReasoningCapability();
    }
    if (providerId === 'anthropic') {
      const opus47Plus = /^claude-opus-4-(?:7|8)(?:[-_.]|$)/.test(model);
      const opus45 = /^claude-opus-4-5(?:[-_.]|$)/.test(model);
      const effortModel = /^claude-(?:sonnet-4-6|opus-4-(?:5|6|7|8))(?:[-_.]|$)/
        .test(model);
      if (!effortModel) return noReasoningCapability();
      return reasoningCapability('effort', opus47Plus
        ? ['auto', 'low', 'medium', 'high', 'xhigh', 'max']
        : opus45
          ? ['auto', 'low', 'medium', 'high']
          : ['auto', 'low', 'medium', 'high', 'max']);
    }
    if (providerId === 'gemini') {
      if (/^gemini-3\.1-flash-lite-image(?:[-_.]|$)/.test(model)) {
        return reasoningCapability('effort', ['auto', 'minimal', 'high']);
      }
      if (/^gemini-3-pro-preview(?:[-_.]|$)/.test(model)) {
        return reasoningCapability('effort', ['auto', 'low', 'high']);
      }
      if (/^gemini-3\.1-pro-preview(?:[-_.]|$)/.test(model)) {
        return reasoningCapability('effort', ['auto', 'low', 'medium', 'high']);
      }
      if (/^gemini-(?:3\.(?:5|6)-flash(?:-lite)?|3\.1-flash-lite|3-flash-preview)(?:[-_.]|$)/
        .test(model)) {
        return reasoningCapability('effort', [
          'auto', 'minimal', 'low', 'medium', 'high'
        ]);
      }
      return noReasoningCapability();
    }
    if (providerId === 'deepseek') {
      // The official Chat Completions API lists deepseek-flash as a current
      // alias with the same explicit thinking toggle and effort controls.
      // Keep this exact so an undocumented future model is not inferred.
      return /^deepseek-(?:flash$|v4(?:[-_.]|$)|chat$|reasoner$)/.test(model)
        ? reasoningCapability('effort', ['low', 'high', 'max'], 'high')
        : noReasoningCapability();
    }
    if (providerId === 'codex-local') {
      return reasoningCapability('effort', [
        'auto', 'low', 'medium', 'high', 'xhigh'
      ]);
    }
    if (providerId === 'deepseek-harness' && ['deepseek-flash', 'deepseek-v4-pro'].includes(String(config?.model || '').trim())) {
      return reasoningCapability('effort', ['auto', 'low', 'high', 'max']);
    }
    if (providerId === 'openai-compatible') {
      const mode = String(config.reasoningMode || '').trim().toLowerCase();
      if (mode === 'effort') {
        return reasoningCapability('effort', [
          'auto', 'minimal', 'low', 'medium', 'high', 'xhigh'
        ]);
      }
      if (mode === 'toggle') {
        return reasoningCapability('toggle', ['auto', 'enabled', 'disabled']);
      }
    }
    return noReasoningCapability();
  }

  function normalizeReasoningForProvider(providerId, config = {}, requested = {}) {
    const requestedEnabled = requested?.enabled === true;
    const capability = getProviderReasoningCapabilities(providerId, config);
    if (!requestedEnabled) {
      const offLevel = capability.offLevel || capability.levels.find(level => ['none', 'off', 'disabled'].includes(level));
      return { enabled: false, effort: offLevel || 'auto' };
    }
    if (capability.supported !== true || !Array.isArray(capability.levels)) {
      return { enabled: false, effort: 'auto' };
    }
    if (capability.mode === 'toggle') {
      return capability.levels.includes('enabled')
        ? { enabled: true, effort: 'enabled' }
        : { enabled: false, effort: 'auto' };
    }

    let effort = String(requested?.effort || 'auto').trim().toLowerCase() || 'auto';
    if (providerId === 'deepseek' && !getDeclaredModelCapabilities(providerId, config)?.reasoning) {
      if (effort === 'disabled' || effort === 'none') {
        return { enabled: false, effort: 'auto' };
      }
      if (effort === 'enabled' || effort === 'auto') effort = capability.defaultLevel;
      else if (effort === 'minimal') effort = 'low';
      else if (effort === 'medium' || effort === 'xhigh') effort = 'high';
    }
    if (['none', 'disabled', 'off'].includes(effort)) {
      return normalizeReasoningForProvider(providerId, config, { enabled: false });
    }
    if (effort === 'auto' || capability.levels.includes(effort)) {
      return { enabled: true, effort };
    }
    const fallback = capability.levels.includes(capability.defaultLevel)
      ? capability.defaultLevel : 'auto';
    return { enabled: true, effort: fallback };
  }

  function getProviderCapabilities(providerId, config = {}) {
    const definition = DEFINITIONS[providerId];
    if (!definition) return {
      supportsVision: false,
      visionInputFormat: 'none',
      reasoning: noReasoningCapability()
    };
    // Official model aliases served by DeepSeek-V4.1-Flash (2026-09-25).
    // Match the documented API names only; Pro and speculative suffixes stay text-only.
    const deepSeekVision = providerId === 'deepseek' && [
      'deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp'
    ].includes(normalizedModelName(config));
    const harnessVision = providerId === 'deepseek-harness' && String(config?.model || '').trim() === 'deepseek-flash';
    const supportsVision = providerId === 'openai-compatible'
      ? config.supportsVision === true
      : harnessVision || deepSeekVision || definition.supportsVision === true;
    const capabilities = {
      supportsVision,
      visionInputFormat: supportsVision
        ? (deepSeekVision ? 'openai' : definition.visionInputFormat)
        : 'none',
      reasoning: getProviderReasoningCapabilities(providerId, config)
    };
    if (Array.isArray(definition.supportedTaskIds)) {
      capabilities.supportedTaskIds = [...definition.supportedTaskIds];
    }
    if (definition.textGeneration === false) capabilities.textGeneration = false;
    if (definition.typedDecisions === true) capabilities.typedDecisions = true;
    if (Array.isArray(definition.decisionTypes)) {
      capabilities.decisionTypes = [...definition.decisionTypes];
    }
    const algorithmVersion = runtimeShared().JEV_HIGHLIGHT_ALGORITHM_VERSION;
    const semanticFindVersion = runtimeShared().SEMANTIC_FIND_VERSION || 'semantic-find-v1';
    const taskAlgorithmVersions = definition.taskAlgorithmVersions || (
      providerId === 'typesafe'
        ? { semantic_find: String(semanticFindVersion) }
        : null
    );
    if (providerId === 'typesafe' && typeof algorithmVersion === 'string' &&
        algorithmVersion && taskAlgorithmVersions) {
      taskAlgorithmVersions.document_highlight = algorithmVersion;
    }
    if (taskAlgorithmVersions) {
      capabilities.taskAlgorithmVersions = { ...taskAlgorithmVersions };
    }
    if (Number(definition.maxStateQuestionTokens) > 0) {
      capabilities.maxStateQuestionTokens = Number(definition.maxStateQuestionTokens);
    }
    return capabilities;
  }

  function providerSupportsTask(providerId, taskId) {
    const definition = DEFINITIONS[providerId];
    if (!definition) return false;
    return !Array.isArray(definition.supportedTaskIds) ||
      definition.supportedTaskIds.includes(String(taskId || ''));
  }

  function validContextWindowOverride(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 8192 || numeric > 2000000) return null;
    return Math.round(numeric / 1024) * 1024;
  }

  function normalizedModelName(config = {}) {
    const model = String(config?.model || '').trim().toLowerCase();
    return model.split('/').at(-1) || model;
  }

  function knownModelCapacity(config = {}) {
    const model = normalizedModelName(config);
    if (model === 'deepseek-flash' || /^deepseek-v4-(?:pro|flash)(?:[-_.]|$)/.test(model)) {
      return { contextWindowTokens: 1000000, maxOutputTokens: 384000 };
    }
    if (/^grok-4\.7(?:[-_.]|$)/.test(model)) return { contextWindowTokens: 500000, maxOutputTokens: 32768 };
    if (/^gpt-4\.1(?:[-_.]|$)/.test(model)) {
      return { contextWindowTokens: 1047576, maxOutputTokens: 65536 };
    }
    if (/^gpt-5(?:[-_.]|$)/.test(model)) {
      return { contextWindowTokens: 400000, maxOutputTokens: 65536 };
    }
    if (/^gemini-(?:2\.5|3(?:\.|-|$))/.test(model)) {
      return { contextWindowTokens: 1000000, maxOutputTokens: 65536 };
    }
    if (/^jev(?:[-_.]|$)/.test(model)) {
      return { contextWindowTokens: 64000, maxOutputTokens: 32768 };
    }
    return null;
  }

  function getProviderContextWindowTokens(providerId, config = {}, override = null) {
    // Context limits are derived from the selected model; legacy overrides remain stored but no longer control allocation.
    const known = knownModelCapacity(config);
    if (known) return known.contextWindowTokens;
    return DEFINITIONS[providerId]?.contextWindowTokens || 32768;
  }

  function validOutputTokenOverride(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 512 || numeric > 2000000) return null;
    return Math.round(numeric);
  }

  function getProviderMaxOutputTokens(providerId, config = {}, override = null) {
    const explicit = validOutputTokenOverride(override);
    if (providerId === 'deepseek-harness') return Math.min(explicit || 256000, 256000);
    if (explicit) return explicit;
    const known = knownModelCapacity(config);
    if (known) return known.maxOutputTokens;
    return DEFINITIONS[providerId]?.maxOutputTokens || 65536;
  }

  function isHttpUrl(value) {
    try {
      const url = new URL(value);
      const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
      return url.protocol === 'https:' || (url.protocol === 'http:' && loopback);
    } catch {
      return false;
    }
  }

  function validateProviderConfig(providerId, config) {
    const errors = [];
    if (!DEFINITIONS[providerId]) return ['providerId'];
    if (providerId === 'codex-local') {
      if (!String(config?.model || '').trim()) errors.push('model');
      const effort = String(config?.reasoningEffort || 'auto');
      if (!getProviderReasoningCapabilities(providerId, config).levels.includes(effort)) {
        errors.push('reasoningEffort');
      }
      return errors;
    }
    if (providerId === 'deepseek-harness') {
      if (!String(config?.model || '').trim() || String(config.model).trim() === 'auto') errors.push('model');
      if (!['auto', 'off', ...getProviderReasoningCapabilities(providerId, config).levels].includes(String(config?.reasoningEffort || 'auto'))) errors.push('reasoningEffort');
      return errors;
    }
    if (!String(config?.apiKey || '').trim()) errors.push('apiKey');
    if (!String(config?.model || '').trim()) errors.push('model');
    const baseUrl = String(config?.baseUrl || '').trim();
    if (providerId === 'typesafe' && baseUrl) {
      const normalized = baseUrl.replace(/\/+$/u, '');
      if (normalized !== 'https://api.typesafe.ai/v1' &&
          normalized !== 'https://api.typesafe.ai/v1/systemone') {
        errors.push('baseUrl');
      }
      return errors;
    }
    if ((DEFINITIONS[providerId].requiresBaseUrl || baseUrl) && !isHttpUrl(baseUrl)) {
      errors.push('baseUrl');
    }
    return errors;
  }

  function createProviderAdapter({ providerId, config, fetchImpl, nativeClient, harnessClient }) {
    const errors = validateProviderConfig(providerId, config);
    if (errors.length) throw new Error(`Invalid provider config: ${errors.join(',')}`);
    const factory = runtimeShared()[FACTORY_EXPORTS[providerId]];
    if (typeof factory !== 'function') {
      throw new Error(`Provider adapter is unavailable: ${providerId}`);
    }
    const adapterConfig = {
      ...config,
      __providerCapabilities: getProviderCapabilities(providerId, config),
      __reasoningCapabilities: getProviderReasoningCapabilities(providerId, config)
    };
    const adapter = providerId === 'deepseek-harness'
      ? factory(adapterConfig, harnessClient)
      : providerId === 'codex-local'
      ? factory(adapterConfig, nativeClient)
      : factory(adapterConfig, fetchImpl || fetch);
    adapter.maxOutputTokens = getProviderMaxOutputTokens(providerId, config);
    adapter.contextWindowTokens = getProviderContextWindowTokens(providerId, config);
    return adapter;
  }

  return {
    getProviderDefinitions,
    getCompatibleProviderPresets,
    getProviderCapabilities,
    providerSupportsTask,
    modelCapabilityScope,
    modelReasoningMetadata,
    buildModelCapabilityCatalog,
    getDeclaredModelCapabilities,
    reasoningCanDisable,
    getProviderReasoningCapabilities,
    normalizeReasoningForProvider,
    getProviderContextWindowTokens,
    getProviderMaxOutputTokens,
    validateProviderConfig,
    createProviderAdapter
  };
});


;/* native/web-filters-general/ux-composer.js */
(function(g,factory){const api=factory(g);if(typeof module==='object')module.exports=api;g.WFGComposer=api;})(globalThis,function(g){
'use strict';
const LEVEL_LABELS={auto:'自动',minimal:'最少',low:'低',medium:'中',high:'高',xhigh:'更高',max:'最高',ultra:'极高',enabled:'开启'};
function reasoningState(settings,selectedProfileId,api){
 const policy=settings?.taskPolicies?.article_chat||{},profileId=selectedProfileId||(policy.mode==='profile'?policy.profileId:settings?.globalProfileId),profile=settings?.profiles?.[profileId];
 if(!profile||typeof api?.getProviderReasoningCapabilities!=='function')return {supported:false,label:'思考',reason:'请先配置支持思考的模型',options:[],profileId:profileId||''};
 const config={...profile.config};config.model=api.taskModelForProfile?.(policy,profile,profileId)||config.model;
 const capability=api.getProviderReasoningCapabilities(profile.providerId,config);
 if(capability?.supported!==true)return {supported:false,label:'思考',reason:'当前模型不支持调节思考',options:[],profileId};
 const normalized=api.normalizeReasoningForProvider(profile.providerId,config,{enabled:policy.reasoningEnabled===true,effort:policy.reasoningEffort||'auto'});
 const canDisable=api.reasoningCanDisable?.(profile.providerId,config,capability)===true;
 const levels=capability.mode==='toggle'?['enabled']:(capability.levels||[]).filter(x=>!['none','disabled','off'].includes(x));
 const options=[...(canDisable?[{value:'off',label:'关闭',enabled:false,effort:'auto'}]:[]),...levels.map(level=>({value:level,label:LEVEL_LABELS[level]||level,enabled:true,effort:level}))];
 const value=normalized.enabled?normalized.effort:canDisable?'off':(levels.includes('auto')?'auto':capability.defaultLevel),label=normalized.enabled?'思考 · '+(LEVEL_LABELS[normalized.effort]||normalized.effort):'思考';
 return {supported:true,label,options,value,profileId,providerId:profile.providerId,config,normalized,canDisable};
}
const views=new WeakMap(),activeViews=new Set();let wrapped=false,nativeNetworkSync=null;
function icon(name){
 const paths={
  brain:'M6.6 15.5c-2.5.3-4.2-1.1-4.2-3.4 0-2 1-3.6 2.5-4.3.8-2.1 2.9-3.2 5-2.9 2-1.4 4.7-1.1 6.4.3 3.3.4 5.4 3.2 5.4 6.2 0 2.4-1.2 4.1-3.2 4.8l.7 3.3h-2.6l-1.8-3.9c-1.6.2-2.9 1.3-4.7 1.3-1.5 0-2.7-.5-3.5-1.4Z M6.6 13c.7-2 2.4-3 4.4-3 .3-1.4 1-2.3 2.2-3 M13 13.4c2.3-1.6 4.6-1.9 6.4-1.5',
  globe:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3 12h18M12 3a17 17 0 0 1 0 18 17 17 0 0 1 0-18Z'
 };
 if(paths[name]){const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg'),path=document.createElementNS(ns,'path');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('width','20');svg.setAttribute('height','20');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.6');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');svg.setAttribute('aria-hidden','true');path.setAttribute('d',paths[name]);svg.append(path);return svg;}
 const i=document.createElement('i');i.className='ph ph-'+name;i.setAttribute('aria-hidden','true');return i;}
function control(text,name){const b=document.createElement('button');b.type='button';b.className='btn btn-secondary';if(name)b.append(icon(name));const span=document.createElement('span');span.textContent=text;b.append(span);return b;}
function node(tag,cls){const n=document.createElement(tag);n.className=cls;return n;}
function settings(){return typeof llmSettingsState!=='undefined'?llmSettingsState?.settings:null;}
function announce(v,message){const status=v.form.querySelector('.wfg-ux-status');if(status)status.textContent=message;}
function close(v,focus=false){if(!v.open)return;const {button,popup}=v.open;popup.hidden=true;button.setAttribute('aria-expanded','false');v.open=null;if(focus)button.focus();}
function open(v,button,popup,focus=true){if(v.open?.popup===popup){close(v,true);return;}close(v);popup.hidden=false;button.setAttribute('aria-expanded','true');v.open={button,popup};if(focus)popup.querySelector('[role^="menuitem"]:not(:disabled)')?.focus();}
function menuKeys(v,popup,event){const items=[...popup.querySelectorAll('[role^="menuitem"]:not(:disabled)')],at=items.indexOf(document.activeElement);let index=null;if((event.key==='Enter'||event.key===' ')&&items.includes(document.activeElement)){event.preventDefault();event.stopPropagation();document.activeElement.click();return;}if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(v,true);return;}if(event.key==='ArrowDown')index=(at+1)%items.length;if(event.key==='ArrowUp')index=(at-1+items.length)%items.length;if(event.key==='Home')index=0;if(event.key==='End')index=items.length-1;if(index!==null){event.preventDefault();event.stopPropagation();items[index]?.focus();}if(event.key==='Tab')close(v,true);}
function decorateFiles(v){const host=v.form.querySelector('#articleChatAttachments'),files=typeof articleChatAttachments!=='undefined'?articleChatAttachments:[];if(!host)return;for(const [i,chip]of [...host.children].entries()){if(chip.hasAttribute('data-composer-file'))continue;const file=files[i],name=chip.firstElementChild;if(!file||!name)continue;chip.dataset.composerFile='';const body=node('span','wfg-file-body'),kind=String(file.mediaType||file.mimeType||file.type||'').toLowerCase(),isImage=kind.startsWith('image/')||String(file.dataUrl||'').startsWith('data:image/');let art;if(isImage&&/^data:image\/(png|jpeg|webp);base64,/i.test(file.dataUrl||'')){art=document.createElement('img');art.src=file.dataUrl;art.alt='';}else art=icon(/\.pdf$/i.test(file.name)?'file-magnifying-glass':isImage?'image':'file-magnifying-glass');art.classList.add('wfg-file-art');body.append(name);const size=node('small','wfg-file-size'),bytes=Number(file.byteLength)||0,ext=String(file.name||'').split('.').at(-1).toUpperCase();size.textContent=(ext.length<=8?ext:'文件')+(bytes?' · '+(bytes>=1048576?(bytes/1048576).toFixed(1)+' MB':Math.max(1,Math.ceil(bytes/1024))+' KB'):'');body.append(size);chip.prepend(art,body);}}
function networkState(settings,selectedProfileId,api,sourceCount=1){
 const policy=settings?.taskPolicies?.article_chat||{},id=selectedProfileId||(policy.mode==='profile'?policy.profileId:settings?.globalProfileId),profile=settings?.profiles?.[id];
 const config={...profile?.config};config.model=api?.taskModelForProfile?.(policy,profile,id)||config.model;
 const capability=api?.getTaskWebSearchCapabilities?.(profile?.providerId,config,'article_chat')||{supported:false,modes:[]};
 return sourceCount>1?{supported:false,modes:[]}:capability;
}
function updateNetwork(v){const b=v.network;if(!b)return;
 const capability=networkState(settings(),v.profile?.value||'',g.SciLLM,v.state?.sourceIds?.length||1);
 b.hidden=v.state?.adjusting===true;b.disabled=!capability.supported||b.hidden;
 if(v.networkSlot)v.networkSlot.hidden=b.hidden;
 if(b.disabled&&v.open?.popup===v.networkMenu)close(v);
 if(typeof articleChatWebSearchMode==='undefined')return;
 if(!capability.modes.includes(articleChatWebSearchMode)){articleChatWebSearchMode='off';articleChatWebSearchEnabled=false;}
 const mode=articleChatWebSearchMode,on=mode!=='off',label={off:'关闭',on:'开启',deep:'深度检索',auto:'按需'}[mode]||'关闭';
 const description=capability.supported?'联网：'+label+'；点击选择模式':'联网已关闭；当前模型或问答范围不支持联网';
 b.setAttribute('aria-pressed',String(on));b.setAttribute('aria-label',description);b.dataset.searchMode=mode;
 b.title=description;
 if(!v.networkMenu)return;
 v.networkMenu.replaceChildren();
 for(const value of capability.modes){
  const item=control({off:'关闭 · 仅当前材料',on:'联网 · 搜索与读取链接',deep:'深度检索 · 多步查证',auto:'按需联网'}[value]||value);item.setAttribute('role','menuitemradio');item.setAttribute('aria-checked',String(value===mode));item.dataset.networkMode=value;
  item.addEventListener('click',()=>{articleChatWebSearchCustomized=true;articleChatWebSearchMode=value;articleChatWebSearchEnabled=['on','deep'].includes(value);close(v,true);if(typeof syncArticleChatWebSearchToggle==='function')syncArticleChatWebSearchToggle();});v.networkMenu.append(item);
 }
}
// Refresh once per connection, without delaying page reading or sending text.
const capabilityRequests=new Map();
function refreshModelCapabilities(v){
 const data=settings(),policy=data?.taskPolicies?.article_chat||{},id=v.profile?.value||(policy.mode==='profile'?policy.profileId:data?.globalProfileId),profile=data?.profiles?.[id];
 if(!profile||typeof sendLlmMessage!=='function'||!g.SciLLM.modelCapabilityScope)return;
 const scope=g.SciLLM.modelCapabilityScope(profile.providerId,profile.config),key=id+'|'+scope;
 const cached=profile.config?.modelCapabilityCatalog;
 if(cached?.scope===scope&&Date.now()-cached.fetchedAt<86400000||Date.now()-(capabilityRequests.get(key)||0)<300000)return;
 capabilityRequests.set(key,Date.now());
 void sendLlmMessage({type:'LLM_LIST_MODELS',profileId:id,cacheCapabilities:true}).then(result=>{
  const current=settings()?.profiles?.[id];
  if(!result.modelCapabilityCatalog||!current||g.SciLLM.modelCapabilityScope(current.providerId,current.config)!==scope)return;
  current.config.modelCapabilityCatalog=result.modelCapabilityCatalog;
  refreshReasoning(v);if(nativeNetworkSync)nativeNetworkSync();updateNetwork(v);
 }).catch(()=>{});
}
function refreshReasoning(v){const d=reasoningState(settings(),v.profile?.value||'',g.SciLLM);v.reasoning=d;v.thinking.hidden=!d.supported||v.state?.adjusting===true;if(v.thinkingSlot)v.thinkingSlot.hidden=v.thinking.hidden;if(v.thinking.hidden&&v.open?.popup===v.thinkingMenu)close(v);v.thinking.disabled=!d.supported||v.saving||v.state?.busy===true;v.thinking.setAttribute('aria-pressed',String(d.normalized?.enabled===true));v.thinking.title=d.supported?'思考：'+(d.options.find(x=>x.value===d.value)?.label||'跟随模型')+'；点击调整':d.reason;v.thinking.dataset.effort=d.value||'';v.thinking.setAttribute('aria-label',d.supported?'思考深度：'+(d.options.find(x=>x.value===d.value)?.label||d.label):d.reason);
 const previouslyFocused=document.activeElement?.dataset?.thinkingLevel;v.thinkingMenu.replaceChildren();for(const option of d.options){const b=control(option.label);b.setAttribute('role','menuitemradio');b.setAttribute('aria-checked',String(option.value===d.value));b.dataset.thinkingLevel=option.value;b.disabled=!!v.saving;b.addEventListener('click',()=>void saveReasoning(v,option));v.thinkingMenu.append(b);}if(v.open?.popup===v.thinkingMenu&&previouslyFocused)v.thinkingMenu.querySelector('[data-thinking-level="'+previouslyFocused+'"]')?.focus();
}
async function saveReasoning(v,option){if(v.saving||!v.reasoning?.supported)return;if(option.value===v.reasoning.value){close(v,true);return;}const menuHadFocus=v.thinkingMenu.contains(document.activeElement),selectedProfileId=v.profile?.value||'',initialSettings=settings(),expected=g.SciLLM.normalizeReasoningForProvider(v.reasoning.providerId,v.reasoning.config,{enabled:option.enabled,effort:option.effort});v.saving=true;refreshReasoning(v);try{
 if(typeof sendLlmMessage!=='function')throw Error('当前组件无法保存思考设置');
 const result=await sendLlmMessage({type:'LLM_UPDATE_PROFILE_ROUTING',articleChatReasoning:{enabled:option.enabled,effort:option.effort,profileId:selectedProfileId}}),p=result?.settings?.taskPolicies?.article_chat;
 if(!p||p.reasoningEnabled!==expected.enabled||p.reasoningEffort!==expected.effort)throw Error('当前后台尚未支持此思考设置，原设置已保留');
 if(settings()!==initialSettings||(v.profile?.value||'')!==selectedProfileId)return;
 if(typeof llmSettingsState!=='undefined')llmSettingsState=result;close(v,true);if(nativeNetworkSync)nativeNetworkSync();updateNetwork(v);
 }catch(e){announce(v,e.message||'思考设置未保存，请重试');}finally{v.saving=false;refreshReasoning(v);if(menuHadFocus&&!v.thinking.hidden&&(v.profile?.value||'')===selectedProfileId&&document.activeElement===document.body){if(v.open?.popup===v.thinkingMenu)v.thinkingMenu.querySelector('[data-thinking-level="'+option.value+'"]')?.focus();else v.thinking.focus();}}}
function wrapNative(){if(wrapped)return;wrapped=true;if(typeof syncArticleChatWebSearchToggle==='function'){nativeNetworkSync=syncArticleChatWebSearchToggle;syncArticleChatWebSearchToggle=function(...args){const result=nativeNetworkSync(...args);for(const v of activeViews)updateNetwork(v);return result;};}if(typeof renderArticleChatAttachmentChips==='function'){const original=renderArticleChatAttachmentChips;renderArticleChatAttachmentChips=function(...args){const result=original(...args);for(const v of activeViews)decorateFiles(v);return result;};}}
function mount(form){if(form.id!=='articleChatForm'||views.has(form))return;const u=form.querySelector('[data-wfg-ux]'),inputRow=form.querySelector('.article-chat-input-row'),profile=form.querySelector('#articleChatProfile'),add=form.querySelector('#addArticleChatAttachment'),network=form.querySelector('#articleChatWebSearch'),send=form.querySelector('#sendArticleChat');if(!u||!inputRow||!profile||!add||!network||!send)return;
 const v={form,u,profile,add,network,send,state:null,saving:false,open:null};views.set(form,v);activeViews.add(v);wrapNative();form.dataset.wfgComposer='';
 const header=node('div','wfg-composer-header'),deck=node('div','wfg-composer-deck'),toolbar=node('div','wfg-composer-toolbar'),left=node('div','wfg-composer-actions'),right=node('div','wfg-composer-actions wfg-composer-send'),tools=u.querySelector('.wfg-ux-tools'),sources=u.querySelector('[data-add-sources]'),picker=profile.closest('.article-chat-model-picker');
 for(const selector of ['#articleChatContextScopes','#articleChatAttachments','.wfg-ux-chips']){const n=form.querySelector(selector);if(n)deck.append(n);}const box=u.querySelector('.wfg-ux-sources'),preview=u.querySelector('.wfg-ux-preview'),status=u.querySelector('.wfg-ux-status');
 const thinking=control('','brain');thinking.querySelector('span')?.remove();thinking.dataset.thinking='';thinking.setAttribute('aria-haspopup','menu');thinking.setAttribute('aria-expanded','false');v.thinking=thinking;
 const attachmentMenu=node('div','wfg-composer-menu'),thinkingMenu=node('div','wfg-composer-menu wfg-thinking-menu');attachmentMenu.dataset.composerAttachmentsMenu='';attachmentMenu.setAttribute('role','menu');attachmentMenu.setAttribute('aria-label','添加附件或网页');thinkingMenu.setAttribute('role','menu');thinkingMenu.setAttribute('aria-label','思考深度');for(const m of [attachmentMenu,thinkingMenu]){m.hidden=true;m.setAttribute('data-sidebar-focus-escape-priority','');m.addEventListener('keydown',e=>menuKeys(v,m,e));}v.attachmentMenu=attachmentMenu;v.thinkingMenu=thinkingMenu;
 const local=control('本地文件','upload');local.dataset.composerLocal='';local.setAttribute('role','menuitem');local.addEventListener('click',()=>{close(v);form.querySelector('#articleChatAttachmentFiles')?.click();});sources.setAttribute('role','menuitem');sources.replaceChildren(icon('compass'),document.createTextNode('其他网页'));sources.addEventListener('click',()=>close(v));attachmentMenu.append(local,sources);
 const attachmentSlot=node('div','wfg-composer-menu-anchor'),thinkingSlot=node('div','wfg-composer-menu-anchor');attachmentSlot.append(add,attachmentMenu);thinkingSlot.append(thinking,thinkingMenu);v.thinkingSlot=thinkingSlot;add.setAttribute('aria-label','添加附件或网页');add.title='添加本地文件或其他网页';add.setAttribute('aria-haspopup','menu');add.setAttribute('aria-expanded','false');
 add.addEventListener('click',event=>{event.preventDefault();event.stopImmediatePropagation();if(!add.disabled)open(v,add,attachmentMenu);},true);thinking.addEventListener('click',()=>{refreshReasoning(v);if(!thinking.disabled)open(v,thinking,thinkingMenu);});for(const [button,menu]of [[add,attachmentMenu],[thinking,thinkingMenu]])button.addEventListener('keydown',e=>{if(e.key==='ArrowDown'&&!button.disabled){e.preventDefault();if(v.open?.popup!==menu)open(v,button,menu);else menu.querySelector('[role^="menuitem"]')?.focus();}});
 network.replaceChildren(icon('globe'));
 const networkMenu=node('div','wfg-composer-menu wfg-network-menu'),networkSlot=node('div','wfg-composer-menu-anchor');networkMenu.hidden=true;networkMenu.setAttribute('role','menu');networkMenu.setAttribute('aria-label','联网模式');networkMenu.setAttribute('data-sidebar-focus-escape-priority','');networkMenu.addEventListener('keydown',e=>menuKeys(v,networkMenu,e));v.networkMenu=networkMenu;v.networkSlot=networkSlot;networkSlot.append(network,networkMenu);network.setAttribute('aria-haspopup','menu');network.setAttribute('aria-expanded','false');
 network.addEventListener('click',event=>{event.preventDefault();event.stopImmediatePropagation();if(network.disabled)return;updateNetwork(v);open(v,network,networkMenu);},true);network.addEventListener('keydown',e=>{if(e.key==='ArrowDown'&&!network.disabled){e.preventDefault();updateNetwork(v);open(v,network,networkMenu);}});
 const oldControls=form.querySelector('.article-chat-submit-controls');left.append(thinkingSlot,networkSlot,tools);right.append(picker,attachmentSlot,send);toolbar.append(left,right);oldControls?.remove();const help=form.querySelector('#articleChatSearchOption');if(help)help.classList.add('visually-hidden');const generalization=u.querySelector('[data-generalization]');u.replaceChildren(deck,box,preview,...(generalization?[generalization]:[]),inputRow,toolbar,status);box.setAttribute('data-sidebar-focus-escape-priority','');box.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();box.hidden=true;add.focus();}});
 form.addEventListener('change',e=>{if(e.target===profile){close(v);refreshReasoning(v);updateNetwork(v);refreshModelCapabilities(v);}});document.addEventListener('pointerdown',e=>{if(v.open&&!v.open.popup.contains(e.target)&&!v.open.button.contains(e.target))close(v);});form.addEventListener('submit',()=>close(v),true);
 g.BrevessChatAgentControls?.mountComposer(right);
 decorateFiles(v);refreshReasoning(v);refreshModelCapabilities(v);if(nativeNetworkSync)nativeNetworkSync();updateNetwork(v);
 const initialSettings=settings();if(typeof sendLlmMessage==='function')void sendLlmMessage({type:'LLM_GET_SETTINGS'}).then(result=>{if(settings()!==initialSettings||v.saving)return;if(typeof llmSettingsState!=='undefined')llmSettingsState=result;refreshReasoning(v);if(nativeNetworkSync)nativeNetworkSync();updateNetwork(v);}).catch(()=>{});
}
function render(form,state){const v=views.get(form);if(!v)return;v.state=state;refreshReasoning(v);refreshModelCapabilities(v);if(nativeNetworkSync)nativeNetworkSync();updateNetwork(v);decorateFiles(v);}
return {reasoningState,networkState,mount,render};
});


;/* native/web-filters-general/ux-workflow.js */
(function(g){'use strict';
const views=new WeakMap(),all=new Set();
function element(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text)n.textContent=text;return n;}
function mount(form,u,api){
 const v={form,u,api,key:null,drafts:new Map(),state:null};views.set(form,v);all.add(v);
 const box=element('section','wfg-workflow');box.dataset.filterWorkflow='';box.setAttribute('aria-label','网页滤镜编辑');
 const head=element('div','wfg-workflow-head'),heading=element('strong','','网页滤镜'),close=u.querySelector('[data-exit-display]');close.textContent='返回问答';close.title='退出编辑并取消未保存的预览';close.setAttribute('aria-label','返回普通问答');const collapse=api.button('收起',()=>{v.collapsed=!v.collapsed;body.hidden=v.collapsed;collapse.textContent=v.collapsed?'展开':'收起';collapse.setAttribute('aria-expanded',String(!v.collapsed));});collapse.className+=' wfg-workflow-collapse';collapse.setAttribute('aria-expanded','true');const scripts=api.button('我的脚本',()=>api.scripts());scripts.title='管理已保存的网页脚本';if(form.id==='articleChatForm') { close.hidden=true; head.append(heading,collapse,close); } else head.append(heading,scripts,collapse,close);
 const steps=element('ol','wfg-workflow-steps');for(const label of ['描述调整','预览与微调','保存滤镜'])steps.append(element('li','',label));
 const target=element('div','wfg-workflow-target'),title=element('span','wfg-workflow-page');title.dataset.workflowPage='';
 target.append(title);
 const chips=u.querySelector('.wfg-ux-chips'),hint=element('p','wfg-workflow-hint');hint.dataset.workflowHint='';
 const review=element('div','wfg-workflow-review');review.append(u.querySelector('[data-generalization]'),u.querySelector('.wfg-ux-preview'));
 const body=element('div','wfg-workflow-body');body.append(steps,target,chips,hint,review);box.append(head,body);u.prepend(box);
 Object.assign(v,{box,body,heading,collapse,steps,title,hint,chips});
 api.input().addEventListener('input',()=>{if(v.key)v.drafts.set(v.key,api.input().value);});
}
function isDisplay(form) {
 return views.get(form)?.active === true;
}
function openPageCommands(form) {
 const view = views.get(form);
 if (!view?.active) return;
 const field = view.api.input();
 const space = field.selectionStart && !/\s$/u.test(field.value.slice(0, field.selectionStart)) ? ' ' : '';
 field.setRangeText(space + '@@', field.selectionStart, field.selectionEnd, 'end');
 field.focus();
 field.dispatchEvent(new Event('input', {bubbles: true}));
}
function refreshTabs(form) {
 return views.get(form)?.api.refreshTabs();
}
function targetCommands(form, symbol) {
 const view = views.get(form);
 if (!view?.active || view.state.busy || view.state.generalization?.busy) return [];
 if (symbol === '@') {
  return [{name: view.picking ? '完成选取' : '选择页面元素',
   detail: view.picking ? '使用已选的页面元素' : '在网页上点选要调整的区域',
   action: view.api.pick}];
 }
 if (view.picking) return [];
 const state = view.state, draft = state.generalization, samples = draft?.samples || [];
 const origin = draft?.wholePage && samples.length ? new URL(samples[0].url).origin : null;
 const host = new URL(state.url).hostname;
 return view.api.tabs().filter(tab => tab.id !== state.tabId && (!origin || new URL(tab.url).origin === origin))
  .sort((a,b) => Number(new URL(b.url).hostname === host) - Number(new URL(a.url).hostname === host))
  .map(tab => {
   const item = {name: tab.title || tab.url, detail: tab.url,
    action: () => view.api.switch(tab.id, !!draft && !samples.some(sample => sample.tabId === tab.id))};
   const included = state.referenceIds.includes(tab.id);
   if (!draft && (included || state.sourceIds.length < 6)) {
    item.referenceLabel = included ? '移除参考' : '作参考';
    item.referenceAction = () => view.api.toggleReference(tab.id);
   }
   return item;
  });
}
function render(form,state,picking){const v=views.get(form);if(!v)return;
 const availabilityChanged=v.picking!==picking || v.state?.busy!==state.busy ||
  v.state?.generalization?.busy!==state.generalization?.busy;
 v.state=state;
 const active=state.adjusting&&state.adjustmentMode!=='outline';
 const key=state.tabId+':'+state.documentKey+':'+(active?'filter':'chat');
 if(v.active&&!active){v.drafts.delete(v.key);v.key=null;v.u.querySelector('.wfg-ux-status').textContent='';v.u.querySelector('.wfg-ux-sources').hidden=true;v.collapsed=false;v.body.hidden=false;v.collapse.textContent='收起';v.collapse.setAttribute('aria-expanded','true');}
 v.active=!!active;v.picking=picking;v.u.dataset.filterEditing=String(!!active);if(v.key!==key){if(v.key)v.drafts.set(v.key,v.api.input().value);v.key=key;v.api.input().value=v.drafts.get(key)||'';v.api.input().dispatchEvent(new Event('input',{bubbles:true}));}
 v.box.hidden=!active;
 if(active)v.body.insertBefore(v.chips,v.hint);else v.u.querySelector('.wfg-composer-deck')?.append(v.chips);
 v.u.querySelector('[data-pick]').hidden=active;v.title.textContent=(state.generalization?'当前验证页 · ':'当前页 · ')+state.title;v.title.title=state.url;
 const stage=state.generalization||state.saved?2:state.plan?1:0;
 [...v.steps.children].forEach((li,i)=>{li.dataset.active=String(i===stage);if(i===stage)li.setAttribute('aria-current','step');else li.removeAttribute('aria-current');});
 v.heading.textContent=state.generalization?'网页滤镜 · 跨页验证':'网页滤镜';v.hint.hidden=!!state.generalization||!picking&&!state.busy&&!!(state.targets.length||state.plan);v.hint.textContent=picking?'点击要调整的区域；选好后点网页上的「完成选取」。':state.busy?'AI 正在检查目标并生成预览…':!active?'滤镜已保留，可切换原貌或继续编辑。':!state.targets.length?'':state.plan?'预览已显示在网页上。可继续提要求，或对比原貌后保存。':'已选 '+state.targets.length+' 个元素。输入调整要求，再发送预览。';
 if(!v.hint.textContent)v.hint.hidden=true;
 if(availabilityChanged && active && form.querySelector('#articleChatCommandMenu')?.hidden===false &&
    typeof updateArticleChatCommandMenu==='function')updateArticleChatCommandMenu();
 const send=form.querySelector('[type=submit]');if(active&&send){send.setAttribute('aria-label',state.busy?'正在生成预览':'发送要求并预览');send.title='发送要求并在网页预览';}else if(send){send.removeAttribute('aria-label');send.removeAttribute('title');}
}
function suspend(){if(typeof closeArticleChatCommandMenu==='function')closeArticleChatCommandMenu();for(const v of all){if(v.key)v.drafts.set(v.key,v.api.input().value);v.key=null;v.active=false;v.u.dataset.filterEditing='false';v.api.input().value='';v.box.hidden=true;}}
g.WFGWorkflow={mount,render,suspend,isDisplay,refreshTabs,targetCommands,openPageCommands};
})(globalThis);


;/* native/web-filters-general/ux-panel.js */
(function(){'use strict';
let state=null,tabs=[],busy=false,refreshing=false,scheduled=false,picking=false,modeBusy=false,pickSequence=0,pickTask=null;const mounted=new WeakSet();let outline=null,outlineSequence=0,outlineTimer=null;

let pendingSelectTab=null, focusedFilterKey=null;
let navigationGeneration=0,refreshSequence=0,contextPending=true,nativeSequenceFloor=-1,contextTarget=null,contextWindowId=null;
function binding(value){return value?{tabId:value.tabId,navigationUrl:value.navigationUrl||value.url||'',documentKey:value.documentKey||''}:null;}
function sameBinding(a,b){return !!a&&!!b&&a.tabId===b.tabId&&a.navigationUrl===b.navigationUrl&&a.documentKey===b.documentKey;}
function clearTimeline(){for(const log of document.querySelectorAll('#articleChatMessages,#webHistory')){log.querySelectorAll('.article-chat-turn,[data-wfg-turn],[data-turn-id],.article-chat-draft,.workspace-empty').forEach(n=>n.remove());delete log.dataset.wfgDocument;}liveProcess.clear();}
function invalidateContext(){document.querySelector('dialog.wfg-script-library[open]')?.close();globalThis.WFGWorkflow?.suspend();navigationGeneration++;refreshSequence++;contextPending=true;state=null;tabs=[];busy=false;picking=false;modeBusy=false;pickSequence++;clearTimeout(outlineTimer);outlineSequence++;outline=null;clearTimeline();
 for(const f of forms()){f.querySelector('.wfg-ux-chips')?.replaceChildren();for(const n of f.querySelectorAll('.wfg-ux-preview,.wfg-ux-sources'))n.hidden=true;const send=f.querySelector('[type=submit]');if(send)send.disabled=true;}
 message('正在连接当前页面…');
 if(typeof activePanelTabContext!=='undefined'&&typeof scheduleActiveTabContextSync==='function'){nativeSequenceFloor=Number(activePanelTabContext.tabContextSequence)||0;scheduleActiveTabContextSync({force:true});}
}
function trustedPdfReader(value){try{const url=new URL(value),own=new URL(chrome.runtime.getURL(''));return url.protocol===own.protocol&&url.host===own.host&&url.pathname==='/pdf-reader.html';}catch{return false;}}
function savedNativeContext(context,snapshot){
 if(!context?.activated||!snapshot?.documentId)return false;
 if(context.pdfMode)return trustedPdfReader(context.url)&&typeof currentWorkspaceSnapshot!=='undefined'&&snapshot.documentId===currentWorkspaceSnapshot?.documentId&&snapshot.documentHash===currentWorkspaceSnapshot?.documentHash&&snapshot.url===currentWorkspaceSnapshot?.url;
 if(!context.offlineMode)return false;
 const reader=globalThis.SciLLM?.parseOfflineArticleReaderUrl?.(context.url,chrome.runtime.getURL(''));
 return !!reader&&snapshot.localWorkspace?.workspaceId===reader.workspaceId&&
  (reader.workspaceGeneration===null||Number(snapshot.localWorkspace.workspaceGeneration||1)===reader.workspaceGeneration);
}
function acceptNativeContext(context,snapshot){
 if(savedNativeContext(context,snapshot))return true;
 const target=state?binding(state):contextTarget;
 if(contextPending||!target||!context||context.tabId!==target.tabId)return false;
 const normalize=value=>{try{const u=new URL(value);u.hash='';return u.href;}catch{return String(value||'');}};
 if(normalize(context.url)!==normalize(target.navigationUrl))return false;
 return nativeSequenceFloor<0||(Number(context.tabContextSequence)||0)>nativeSequenceFloor;
}
function restoreNativeTimeline(){if(typeof renderArticleChatSnapshot==='function'&&typeof currentWorkspaceSnapshot!=='undefined'&&typeof activePanelTabContext!=='undefined'&&currentWorkspaceSnapshot&&acceptNativeContext(activePanelTabContext,currentWorkspaceSnapshot))renderArticleChatSnapshot(currentWorkspaceSnapshot);}
async function call(command,data={}){
 const generation=navigationGeneration,expected=state?binding(state):null;
 const windowId=(await chrome.windows.getCurrent()).id;
 if(generation!==navigationGeneration)throw Error('PAGE_CHANGED');
 const r=await chrome.runtime.sendMessage({type:'WFG_UX',command,windowId,...(expected&&!['STATE','LIST'].includes(command)?{expectedContext:expected}:{}),...data});
 if(generation!==navigationGeneration&&command!=='SWITCH_TAB')throw Error('PAGE_CHANGED');
 if(!r?.ok)throw Error(r?.error||'请求未完成');
 if(expected&&r.data&&typeof r.data==='object'&&'sourceIds'in r.data&&command!=='STATE'&&!sameBinding(expected,binding(r.data)))throw Error('PAGE_CHANGED');
 return r.data;
}
async function refreshOutline(){const seq=++outlineSequence;try{const result=await call('OUTLINE');if(result.tabId!==state?.tabId)throw Error('OUTLINE_PAGE_CHANGED');if(seq===outlineSequence){outline=result;document.dispatchEvent(new CustomEvent('brevess:temporary-outline',{detail:result}));}return result;}catch(e){if(seq===outlineSequence){outline=null;document.dispatchEvent(new CustomEvent('brevess:temporary-outline',{detail:null}));}throw e;}}
function forms(){return [...document.querySelectorAll('#articleChatForm,#webQuestionForm')];}
function input(form){return form.querySelector('#articleChatQuestion,#webQuestion');}
function defaultQuestionHint(){
 const text='直接提问或者试试输入 / 或者 @ 或者@@';
 return globalThis.SciLLM?.translateInterfaceText?.(text)||text;
}
function icon(name){
 if(name==='sliders-horizontal'){const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');for(const [k,v]of Object.entries({viewBox:'0 0 24 24',width:'20',height:'20',fill:'none',stroke:'currentColor','stroke-width':'1.6','stroke-linecap':'round','aria-hidden':'true'}))svg.setAttribute(k,v);const path=document.createElementNS(ns,'path');path.setAttribute('d','M3 6h4m4 0h10M3 12h10m4 0h4M3 18h4m4 0h10');svg.append(path);for(const [x,y]of [[9,6],[15,12],[9,18]]){const c=document.createElementNS(ns,'circle');c.setAttribute('cx',x);c.setAttribute('cy',y);c.setAttribute('r','2');svg.append(c);}return svg;}
 const i=document.createElement('i');i.className='ph ph-'+name;i.setAttribute('aria-hidden','true');return i;
}
function labelButton(b,text,name){b.replaceChildren();if(name)b.append(icon(name));const label=document.createElement('span');label.textContent=text;b.append(label);}
function btn(text,action,title=''){const b=document.createElement('button');b.type='button';b.className='btn btn-secondary';b.textContent=text;if(title)b.title=title;b.onclick=()=>{if(b.disabled)return;const controls=[...document.querySelectorAll('[data-pick],[data-toggle],[data-undo],[data-save],[data-cancel],[data-add-sources],[data-share],[data-disable],[data-filter-confirm],[data-filter-decline]')];for(const c of controls)c.disabled=true;void run(action).finally(()=>{for(const c of controls)c.disabled=false;render();});};return b;}

async function showSavedScripts(){
 const dialog=document.createElement('dialog');dialog.className='wfg-script-library';
 dialog.setAttribute('aria-label','我的脚本');
 const head=document.createElement('header'),title=document.createElement('strong'),close=document.createElement('button');
 title.textContent='我的脚本';close.type='button';close.textContent='关闭';close.onclick=()=>dialog.close();
 const list=document.createElement('div'),notice=document.createElement('p');notice.setAttribute('role','status');
 head.append(title,close);dialog.append(head,list,notice);document.body.append(dialog);
 dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();
 const generation=navigationGeneration;
 function draw(items){
  if(!dialog.open)return;
  if(navigationGeneration!==generation){dialog.close();return;}
  list.replaceChildren();
  if(!items.length){list.textContent='还没有保存的脚本';return;}
  for(const relevant of [true,false]){
   const group=items.filter(s=>s.matches===relevant).sort((a,b)=>Number(!!a.builtin)-Number(!!b.builtin));if(!group.length)continue;
   const label=document.createElement('h3');label.textContent=relevant?'当前网页':'其他网页';list.append(label);
   for(const item of group){
    const row=document.createElement('div'),label=document.createElement('label'),info=document.createElement('span'),name=document.createElement('b'),scope=document.createElement('small'),toggle=document.createElement('input');
    row.className='wfg-script-row';
    name.textContent=item.name+' · V'+Math.max(1,item.version);scope.textContent=item.scope;
    if(item.builtin||item.kind==='preview'){
     const origin=document.createElement('span');origin.textContent=item.builtin?'内置脚本':'临时预览';
     scope.prepend(origin,document.createTextNode(' · '));
    }
    toggle.type='checkbox';toggle.checked=item.enabled;toggle.setAttribute('role','switch');toggle.setAttribute('aria-label','启用 '+item.name);
    async function update(command,data,message){
     if(list.inert)return;
     list.inert=true;notice.textContent='正在更新…';
     try{
      draw(await call(command,{kind:item.kind,id:item.id,generation:item.generation,...data}));
      notice.textContent=message;
     }catch(e){
      toggle.checked=item.enabled;
      notice.textContent=e.message==='GENERATION_CONFLICT'?'脚本列表已更新，请重新选择。':errorText(e.message);
      try{draw(await call('SCRIPTS_LIST'));}catch{}
     }finally{
      list.inert=false;
      if(dialog.open){
       const switches=[...list.querySelectorAll('[role="switch"]')];
       (switches.find(el=>el.dataset.scriptId===item.id&&el.dataset.kind===item.kind)||switches[0]||close).focus();
      }
     }
    }
    toggle.dataset.scriptId=item.id;toggle.dataset.kind=item.kind;
    toggle.onchange=()=>update('SCRIPT_ENABLE',{enabled:toggle.checked},'已更新');
    const remove=document.createElement('button');
    remove.type='button';remove.className='wfg-delete-script';remove.title='删除脚本';
    remove.setAttribute('aria-label','删除 '+item.name);remove.append(icon('trash'));
    remove.onclick=()=>update('SCRIPT_DELETE',{},'已删除「'+item.name+'」');
    info.append(name,scope);label.append(info);
    if(item.kind==='preview'){
     remove.textContent='撤销预览';remove.title='撤销预览';remove.setAttribute('aria-label','撤销预览');
     remove.onclick=()=>update('SCRIPT_DISMISS_PREVIEW',{version:item.version,documentKey:item.documentKey},'已撤销预览');
    }else label.append(toggle);
    row.append(label,remove);list.append(row);
   }
  }
 }
 try{draw(await call('SCRIPTS_LIST'));}catch(e){notice.textContent=errorText(e.message);}
}
function renderFilterControls(preview){
 const confirmation=preview.querySelector('[data-filter-confirmation]');
 const proposal=state?.saveConfirmation;
 confirmation.hidden=!proposal;
 confirmation.querySelector('[data-filter-confirmation-text]').textContent=proposal?
  '保存到本地，并自动套用于：'+proposal.scopeLabel+'。'+(proposal.replaces?'将停用 '+proposal.replaces+' 个匹配的旧滤镜，旧记录保留。':''):'';
 const scopeInput=confirmation.querySelector('[data-filter-scope]');
 if(proposal && scopeInput.dataset.token!==proposal.token){scopeInput.value=proposal.scopeUrl||'';scopeInput.dataset.token=proposal.token;}
 const scopeDirty=!!proposal&&scopeInput.value!==proposal.scopeUrl;
 const toggle=preview.querySelector('[data-toggle]');
 toggle.textContent=state.preview?'查看原貌':'查看滤镜';
 toggle.setAttribute('aria-label',state.preview?'查看原貌，保留滤镜供再次预览':'查看滤镜，重新应用当前页预览');
 toggle.setAttribute('aria-pressed',String(state.preview));
 toggle.disabled=!!state.busy;
 const save=preview.querySelector('[data-save]');
 preview.querySelector('[data-similar-save]').hidden=!state.preview||state.saved||state.adjustmentMode==='outline';save.textContent='保存到当前网页';save.disabled=!state.preview||state.saved||state.busy;
 confirmation.querySelector('[data-filter-confirm]').disabled=!!state.busy||scopeDirty;
 preview.querySelector('[data-phase]').textContent=!state.preview?'正在看原貌':state.saved?'已保存 · 自动套用':state.layoutReview?'本页预览 · '+state.layoutReview:'仅本次预览';
}
function explicitFilterSaveReply(question){return !!state?.saveConfirmation&&['确认保存','确认自动套用','确认保存并自动套用','确认保存到本地并自动套用'].includes(String(question||'').trim().replace(/[。！!！]$/u,''));}

function r17ChatNotice(value) {
 const text=String(value||'');
 const last=typeof state==='undefined'?null:state?.turns?.at(-1);
 if(last&&['failed','error'].includes(last.status)&&!last.answer&&text===errorText(last.error||last.status))return '';
 const redundant=new Set(['页面含编辑器、表单或工具画布','已退出调整显示，继续内容问答。','正在调整显示：点选元素，或在下方描述修改。','已在原网页临时预览；继续在这里提出修改，满意后保存。','回答与引用已保存。','正在生成显示指令…','正在阅读所选内容…']);
 if(redundant.has(text)||/^按原文问答处理，保留(?:所选章节|当前原文)与(?:联网开启|按需联网|联网关闭)。$/u.test(text))return '';
 return text.split('；').filter(part=>!redundant.has(part.trim())).join('；');
}

function message(text){for(const f of forms()){const n=f.querySelector('.wfg-ux-status');if(n)n.textContent=r17ChatNotice(text);}}
function errorText(code){const outlineCode=String(code).split(/[;:]/)[0];if(/^OUTLINE_/.test(outlineCode)&&outlineCode!==code)return errorText(outlineCode);const rollback=/^(MODEL_PLAN_INVALID|MODEL_PLAN_UNSUPPORTED|MODEL_PLAN_TARGET_UNREAD|COLOR_SCOPE_LIMIT); rolled back (\d+)$/.exec(String(code||''));if(rollback)return errorText(rollback[1])+' 回退回执：已还原 '+rollback[2]+' 项修改。';return ({READING_BODY_HIDDEN:'本轮修改遮住了正文，已撤回。请缩小要调整的范围。',INTERACTIVE_PAGE:'候选正文范围包含表单或编辑器，未保存。请重新比较或缩小正文范围。',MODULE_MEDIA_CROPPING_DENIED:'自动套用需保留完整图片，请使用高度 auto、max-height none 和 object-fit contain。',GENERALIZE_REPLACE_PREVIEW:'此页已有调整。请先取消本页预览，再沿用样例效果；原样例会保留。',GENERALIZE_SELECTOR_OVERFIT:'候选规则依赖单页编号或固定位置，无法可靠泛化；请补充样例后重新比较。',GENERALIZE_TWO_PAGES_REQUIRED:'套用到相似网页前，请在至少两个不同网页选取对应区域并确认预览，再用 AI 比较验证。',GENERALIZE_SELECT_REQUIRED:'请先选取与当前规则对应的区域并测试预览，确认效果后再加入样例。',GENERALIZE_SAMPLE_CHANGED:'样例页面已变化或预览已失效，请回到该页重新选取、预览并加入样例。',GENERALIZE_EFFECT_MISMATCH:'各样例的调整效果不一致，请使用相同的字号、颜色或隐藏要求，再加入样例。',GENERALIZE_TARGET_MISMATCH:'候选规则在样例中多选或漏选了区域，验证未通过，未保存。',GENERALIZE_SCOPE_UNTESTED:'候选适用范围未被样例覆盖，未保存。',GENERALIZE_STRUCTURE_REQUIRED:'候选规则缺少可靠的正文和页面结构条件，未保存。',GENERALIZE_REPLY_INVALID:'模型返回的泛化规则格式不完整，请重新比较。',GENERALIZE_OPERATION_UNSUPPORTED:'当前样例流程支持顶层网页的样式、隐藏和颜色替换；请每次测试不超过8项调整。',GENERALIZE_SAMPLE_LIMIT:'每组最多6个不同网页样例，请先移除不需要的样例。',GENERALIZE_BUSY:'正在比较或保存样例，请等待完成。',GENERALIZE_START_NEW:'这组规则已保存，请关闭结果后建立新样例集。',GENERALIZE_INSUFFICIENT_EVIDENCE:'样例不足以推导可靠规则，请补充更有代表性的网页和对应区域。',OUTLINE_NONPAPER_REQUIRED:'当前是论文页面；大纲提取调整仅用于非论文网页。',OUTLINE_RELATIVE_SELECTOR:'字段必须使用条目内部的安全选择器。',OUTLINE_NO_MATCHES:'提取规则没有匹配当前已加载条目，未应用大纲。',OUTLINE_FIELD_REQUIRED:'必需字段未在当前条目中找到，请调整字段规则。',OUTLINE_FIELD_AMBIGUOUS:'标题字段匹配了多个位置，请区分当前条目和转发引用。',OUTLINE_FIELD_LIMIT:'单个字段匹配过多，请缩小字段范围。',OUTLINE_OUTPUT_LIMIT:'提取结果超过安全上限，请缩小范围或字段。',OUTLINE_NESTED_ITEMS:'规则同时选中了嵌套条目，请限定独立条目。',OUTLINE_ITEM_LIMIT:'条目超过当前核验上限，请缩小提取范围。',MODEL_PLAN_INVALID:'修改指令不符合安全格式，未应用修改。请简化要求后重试。',MODEL_PLAN_UNSUPPORTED:'当前不支持该修改操作，未应用修改。请改用隐藏、排版或颜色调整等操作。',MODEL_PLAN_TARGET_UNREAD:'修改范围未经当前页面核验，未应用修改。请重新选取目标后重试。',COLOR_SCOPE_LIMIT:'匹配范围过大，未应用修改。请缩小所选范围后重试。',SAVE_SCOPE_INVALID:'请填写当前同站点的网址前缀，须涵盖当前页面且不含查询参数或片段。',SAVE_SCOPE_EXTRACTION:'大纲提取规则只能保存为当前已核验路径。',SAVE_CONFIRMATION_EXPIRED:'当前预览或页面已变化，请重新点击保存并确认适用范围。',PREVIEW_FIRST:'请先点击查看滤镜，再保存当前预览。',READING_ROOT_REQUIRED:'当前页面尚未确认可靠的正文区域，预览已保留，暂不能保存为自动阅读模块。',READING_REPLAY_UNVERIFIED:'当前规则不能在已识别的正文范围重放，暂未保存。',PROTECTED_CONTENT_HIDE:'隐藏规则涉及受保护正文或未确认的区域，预览保留，暂不保存为自动模块。',MODULE_AUTOMATIC_OPERATION_UNSUPPORTED:'此操作可以临时预览，但目前不能保存为自动阅读模块。',MODULE_STYLE_NOT_PORTABLE:'当前样式可以预览，但不能全部保存为自动阅读模块。请改用字号、颜色、换行等阅读排版样式后再保存。',MODULE_WRAPPING_REQUIRED:'自动阅读模块需要保留文字换行。请使用正常换行后再保存，当前预览已保留。',MODULE_POSITIONAL_GROUP_NOT_REUSABLE:'当前规则枚举了固定条目，无法覆盖以后新增的结果。请继续要求按全部同类条目应用，再预览保存。',MODULE_SELECTOR_NOT_PORTABLE:'规则包含本次页面专用标识，暂不能作为自动阅读模块保存。',SOURCE_DOCUMENT_CHANGED:'来源页面已更新，未应用修改。请等待页面稳定后重新选择目标并重试。',SOURCE_TARGET_CHANGED:'所选元素或原文已变化，未应用修改。请重新选择要调整的元素后再试。',SOURCE_EVIDENCE_CHANGED:'已读取的页面内容或结构发生变化，未应用修改。请重新选择目标并重试。',SOURCE_CLOSED_OR_NAVIGATED:'来源页面已关闭或跳转，未应用修改。请回到目标页面后重新选择。',SOURCE_REVALIDATION_LIMIT:'页面持续更新，本次核验已停止，未应用修改。请等待页面稳定或缩小目标范围后重试。',DOCUMENT_CHANGED:'文档已重新加载，未应用修改。请在当前页面重新选择目标。',SELECTION_STALE:'所选元素已过期，未应用修改。请重新选择目标。',MODEL_REQUEST_TIMEOUT:"模型请求超时，未应用修改。",...{"MODEL_AUTH_INVALID":"模型认证失败，请检查原模型配置中的 API Key。","MODEL_AUTH_MISSING":"模型配置缺少 API Key。","MODEL_RATE_LIMITED":"模型服务限流，请稍后重试。","MODEL_PROVIDER_UNAVAILABLE":"模型服务暂时不可用，请稍后重试。","MODEL_NETWORK_ERROR":"模型服务连接失败，请检查网络和原模型服务地址。","MODEL_OUTPUT_TRUNCATED":"模型输出被截断，未应用修改；请缩小本次调整范围后重试。","MODEL_TIMEOUT":"模型请求超时，未应用修改。","MODEL_CANCELLED":"已停止这次请求。","RESEARCH_CANCELLED":"已停止这次请求。","MODEL_INCOMPLETE":"模型响应未完整结束，未应用修改。","MODEL_JSON_INVALID":"模型返回格式错误，自动纠正一次后仍无效；未应用修改。","MODEL_REPLY_INVALID":"模型返回了不支持的响应格式，未应用修改。","MODEL_PROVIDER_ERROR":"模型服务返回未知错误，未应用修改。","MULTI_CONTEXT_BUDGET_EXCEEDED":"所选网页、目标或附件超出当前模型上下文预算。请减少来源或本次调整范围。","MULTI_BUDGET_TOO_SMALL":"当前模型上下文预算不足，尚未发出请求。","MODEL_PLAN_FIELDS":"模型返回了协议以外的字段，修改已拒绝。"},VISION_UNSUPPORTED:'当前模型不支持图片输入。图片未发送，请换用支持视觉的原模型配置。',PREVIEW_NOT_VERIFIED:'目标未匹配或页面已变化，暂不能保存滤镜。请重新选择目标或调整要求后再预览。',PREVIEW_DOCUMENT_CHANGED:'页面已变化，当前预览不能直接保存；请重新提出要求或取消预览。',SELECTION_CANCELLED:'已取消目标选择。',QUESTION_CANCELLED:'已停止这次请求。',ORIGINAL_CONTEXT_COMBINATION_UNSUPPORTED:'本轮包含章节限制或联网设置，暂不能同时处理多网页或显示预览。请移除额外来源和显示目标、取消预览，或调整原章节/联网选项；当前范围没有被扩大。',ORIGINAL_CONTEXT_UNAVAILABLE:'当前页面无法使用原问答上下文，请等待正文载入后重试。'})[code]||({failed:"本次请求未完成；旧记录未保留具体原因。",cancelled:"已停止这次请求。",pending:"请求尚未完成。"})[code]||("未完成："+code);}
async function run(fn){const generation=navigationGeneration;try{const result=await fn();if(generation!==navigationGeneration)return;if(result&&typeof result==='object'&&'sourceIds'in result){if(!state||!sameBinding(binding(state),binding(result)))return;state=result;render();}}catch(e){if(generation!==navigationGeneration)return;const detail=errorText(e.message);if(state)state.notice=detail;message(detail);}}
function toggleDisplayReference(tabId) {
 return run(() => {
  const remove = state.referenceIds.includes(tabId);
  const sources = state.sourceIds.filter(id => id !== tabId);
  const references = state.referenceIds.filter(id => id !== tabId);
  return call('SOURCES', {tabIds: remove ? sources : [...sources, tabId],
   referenceIds: remove ? references : [...references, tabId]});
 });
}
async function switchPage(tabId,pick=false){pendingSelectTab=pick?tabId:null;try{await call('SWITCH_TAB',{tabId});}catch(e){pendingSelectTab=null;throw e;}}
function sourceLabel(id){return tabs.find(t=>t.id===id)?.title||(state?.tabId===id?state.title:'来源 '+id);}
function chip(text,remove,locate){const c=document.createElement('span');c.className='article-chat-attachment-chip';const label=locate?btn(text,locate):document.createElement('span');if(!locate)label.textContent=text;label.classList.add('wfg-chip-label');label.title=text;c.append(label);if(remove){const x=btn('',remove);x.append(icon('x'));x.title='移除来源或目标';x.setAttribute('aria-label','移除 '+text);c.append(x);}return c;}

function appendPlan(answer,plan,turn){
 const colorLabel=op=>{const names={color:'文字颜色','background-color':'背景颜色','border-top-color':'上边框','border-right-color':'右边框','border-bottom-color':'下边框','border-left-color':'左边框','outline-color':'轮廓颜色','text-decoration-color':'文字装饰颜色',fill:'填充颜色',stroke:'描边颜色'};const properties=Array.isArray(op.properties)?op.properties.map(p=>names[p]||p).join('、'):'';const rgba=value=>Array.isArray(value)?'RGBA('+value.join(', ')+')':'';return '（'+properties+'：'+rgba(op.from)+' → '+rgba(op.to)+'）';};
 if(!plan||!Array.isArray(plan.operations))return;
 const box=document.createElement('details');box.className='wfg-ux-plan';box.dataset.filterPlan='';box.open=false;
 const summary=document.createElement('summary');summary.textContent='查看 '+plan.operations.length+' 项修改';box.append(summary);
 const card=document.createElement('section');card.className='wfg-script-card';
 const header=document.createElement('header'),name=document.createElement('strong'),version=document.createElement('small');
 name.textContent=plan.name;const index=state.turns.filter(t=>t.displayPlan||t.displayProposal).indexOf(turn);
 version.textContent='V'+(turn.displayVersion||index+1);
 header.append(icon('code'),name,version);card.append(header);
 if(turn.displayReview){const note=document.createElement('p');note.textContent=turn.displayReview;card.append(note);}
 const annotations=document.createElement('ol');const verbs={pubmedAbstracts:'显示完整摘要',replaceColor:'按颜色替换',hide:'隐藏',show:'显示',collapse:'折叠',sort:'排序',group:'分组',reorder:'重排',outline:'建立大纲',generatedText:'添加独立生成文本',style:'调整样式'};
 for(const op of plan.operations){const line=document.createElement('li');line.textContent=(verbs[op.type]||'网页操作')+'：'+(op.target?.selector||'指定目标')+(op.type==='replaceColor'?colorLabel(op):op.type==='style'?'（'+Object.keys(op.styles||{}).join('、')+'）':'')+(op.type==='outline'&&op.placement==='sidebar'?'，显示在侧栏':'');annotations.append(line);}
 const pre=document.createElement('pre'),code=document.createElement('code');code.textContent=JSON.stringify(plan,null,2);pre.append(code);box.append(annotations,pre);card.append(box);if(turn.status!=='failed')card.append(btn('应用此版本',()=>call('APPLY_VERSION',{turnId:turn.turnId})));answer.append(card);
}
function beginPick(){
 if(!state?.adjusting||picking)return pickTask;
 const seq=++pickSequence;picking=true;render();
 const job=call('PICK').then(async next=>{if(seq===pickSequence&&state?.tabId===next.tabId&&next.adjusting){state=next;render();const d=next.generalization;if(d?.canTransfer&&!d.candidate&&!d.samples.some(s=>s.tabId===next.tabId)&&next.targets.length&&!next.plan){state=await call('GENERALIZE_PREVIEW');render();}}}).catch(e=>{if(seq===pickSequence&&state?.adjusting&&e.message!=='SELECTION_CANCELLED')message(errorText(e.message));}).finally(()=>{if(seq===pickSequence){picking=false;render();}});
 pickTask=job;return job;
}
async function finishPendingPick(){if(!picking)return;const task=pickTask;try{await call('FINISH_PICK');}catch(e){if(e.message!=='请先在网页选择元素')throw e;await call('CANCEL_PICK');}await task;}
const liveProcess=new Map();
function reconcile(log){
 const nodes=[...log.children].filter(n=>n.matches('.article-chat-turn,[data-wfg-turn]'));
 for(const n of nodes)n.hidden=Boolean(state?.adjusting)!==(n.dataset.wfgMode==='adjustment');
 const ordered=nodes.map((node,index)=>({node,index,time:Number(node.dataset.chatCreated)||0})).sort((a,b)=>a.time-b.time||a.index-b.index).map(x=>x.node);
 ordered.forEach((node,index)=>{const current=log.children[index];if(current!==node)log.insertBefore(node,current||null);});
}
globalThis.WFGChatTimeline={reconcile,acceptNativeContext};
function r17ChatTurnMetadata(turn = {}) {
    const text = value => typeof value === 'string' ? value.trim().slice(0,200) : '';
    const actualModel = value => ['configured','simulation'].includes(text(value)) ? '' : text(value);
    const model = actualModel(turn.model) || actualModel(turn.route?.model);
    const profile = text(turn.profileName) || text(turn.route?.effectiveProfileName);
    const labels = [...new Set([profile,model].filter(Boolean))], details = [];
    const coverage = turn.coverage;
    const count = value => Number.isSafeInteger(value) && value >= 0;
    if (Array.isArray(coverage) && coverage.length) {
        const rows = coverage.filter(row => row && count(row.readElements));
        if (rows.length) {
            labels.push('上下文 ' + rows.length + ' 个网页 · ' + rows.reduce((n,row)=>n+row.readElements,0) + ' 个元素');
            details.push(...rows.map(row=>(text(row.title)||'网页')+'：读取 '+row.readElements+' 个元素'+(count(row.omitted)&&row.omitted?'，省略 '+row.omitted:'')).slice(0,6));
        }
    } else if (coverage && count(coverage.sentParagraphs) && count(coverage.totalParagraphs)) {
        labels.push('上下文 ' + coverage.sentParagraphs + '/' + coverage.totalParagraphs + ' 段');
        if (coverage.truncated === true) details.push('按问题选择相关章节，未发送全部正文');
    }
    return {label:labels.join(' · '),title:details.join('；')};
}

function history(form){
 const log=document.getElementById(form.id==='articleChatForm'?'articleChatMessages':'webHistory');if(!log||!state)return;
 const context=JSON.stringify(binding(state));
 if(log.dataset.wfgDocument!==context){for(const old of log.querySelectorAll('[data-wfg-turn]'))old.remove();liveProcess.clear();log.dataset.wfgDocument=context;}
 const ids=new Set((state.turns||[]).map(t=>t.turnId));
 for(const old of log.querySelectorAll('[data-wfg-turn]'))if(!ids.has(old.dataset.wfgTurn)){liveProcess.delete(old.dataset.wfgTurn);old.remove();}
 const nearBottom=log.scrollHeight-log.scrollTop-log.clientHeight<100;
 let changed=false;
 for(const turn of state.turns||[]){
   const live=liveProcess.get(turn.turnId),signature=JSON.stringify([turn.question,turn.status,turn.answer,turn.error,turn.displayPlan,turn.displayVersion,turn.displayReview,turn.multiSources,turn.coverage,turn.model,turn.profileName,turn.route,live]);
   let card=[...log.querySelectorAll('[data-wfg-turn]')].find(n=>n.dataset.wfgTurn===turn.turnId);
   if(card){card.dataset.wfgMode=turn.interactionMode||((turn.displayPlan||turn.displayProposal)?'adjustment':'chat');}
   if(card?.dataset.signature===signature)continue;
   const folds=new Map([...card?.querySelectorAll('details')||[]].map(n=>[n.className,n.open]));
   const previousStatus=card?.dataset.status;
   if(!card){card=document.createElement('article');card.className='article-chat-turn';card.dataset.wfgTurn=turn.turnId;log.append(card);}
   card.replaceChildren();card.dataset.signature=signature;card.dataset.status=turn.status;card.dataset.chatCreated=String(Number(turn.createdAt)||Date.parse(turn.createdAt)||0);
   const q=document.createElement('div');q.className='article-chat-message is-user article-chat-question';const qc=document.createElement('div');qc.className='article-chat-message-content';qc.textContent=turn.question;qc.setAttribute('translate','no');q.append(qc);
   const a=document.createElement('div');a.className='article-chat-message is-assistant article-chat-answer';if(typeof articleChatResponseModelLabel==='function'){const heading=document.createElement('div');heading.className='article-chat-answer-heading';heading.textContent=articleChatResponseModelLabel(turn);a.append(heading);}
   if(live?.process?.items.length){const panel=document.createElement('details');panel.className='article-chat-process-details';panel.open=turn.status==='pending';const sum=document.createElement('summary');sum.textContent=turn.status==='pending'?'正在处理':'处理过程';panel.append(sum);const entries=document.createElement('div');entries.className='article-chat-process-log';for(const item of live.process.items){const p=document.createElement('div');p.className='article-chat-process-entry';p.dataset.kind=item.kind;p.textContent=item.text;entries.append(p);}panel.append(entries);a.append(panel);}
   const text=document.createElement('div');text.className='article-chat-message-content';text.style.whiteSpace='pre-wrap';
   text.textContent=turn.status==='pending'?(live?.text||'等待模型响应'):(turn.answer||(['complete','completed'].includes(turn.status)?'':errorText(turn.error||turn.status)));a.append(text);appendPlan(a,turn.displayPlan||turn.displayProposal,turn);
   if(turn.status==='pending'&&live?.text){const label=document.createElement('small');label.className='article-chat-draft-label';label.textContent='正在生成 · 待核验';a.insertBefore(label,text);}
   for(const ref of turn.multiSources||[]){const b=btn('['+ref.citation+'] '+ref.title+' · '+String(ref.quote||'').slice(0,100),()=>call('LOCATE',{turnId:turn.turnId,citation:ref.citation}));b.className='article-chat-inline-citation';a.append(b);}
   if(turn.coverage?.length){const coverage=document.createElement('details');coverage.className='article-chat-source-details';const title=document.createElement('summary');title.textContent='来源 · '+turn.coverage.length;coverage.append(title);const body=document.createElement('div');body.textContent=turn.coverage.map(c=>c.title+'：读取 '+c.readElements+' 个元素'+(c.omitted?'，省略 '+c.omitted:'')).join('；');coverage.append(body);a.append(coverage);}
   const metadata=r17ChatTurnMetadata(turn);
   if(metadata.label){const footer=document.createElement('footer');footer.className='article-chat-turn-footer';const meta=document.createElement('span');meta.className='article-chat-message-meta';meta.textContent=metadata.label;meta.title=metadata.title;footer.append(meta);a.append(footer);}
   card.dataset.wfgMode=turn.interactionMode||((turn.displayPlan||turn.displayProposal)?'adjustment':'chat');
   const promptKey = card.dataset.wfgMode === 'adjustment' ? 'displayQuickPrompts' : 'articleChatQuickPrompts';
   card.append(q,createSaveQuestionButton(()=>turn.question,promptKey),a);[...card.querySelectorAll('details')].forEach(n=>{if(folds.has(n.className)&&!(n.className==='article-chat-process-details'&&previousStatus==='pending'&&turn.status!=='pending'))n.open=folds.get(n.className);});
   log.querySelector('.workspace-empty')?.remove();changed=true;
 }
 reconcile(log);if(changed&&nearBottom)requestAnimationFrame(()=>{log.scrollTop=log.scrollHeight;});
}
function render(){if(!state)return;if(!state.adjusting&&picking){picking=false;pickSequence++;}clearTimeout(outlineTimer);outlineTimer=setTimeout(()=>void refreshOutline().catch(()=>{}),60);for(const f of forms()){const u=f.querySelector('[data-wfg-ux]');if(!u)continue;const chips=u.querySelector('.wfg-ux-chips');chips.replaceChildren();for(const id of state.sourceIds){const c=chip(id===state.tabId?'当前页 · '+sourceLabel(id):state.referenceIds.includes(id)?'参考 · '+sourceLabel(id):sourceLabel(id),id===state.tabId?null:()=>call('SOURCES',{tabIds:state.sourceIds.filter(x=>x!==id),referenceIds:state.referenceIds.filter(x=>x!==id)}));if(id===state.tabId)c.dataset.current='';chips.append(c);}for(const [targetIndex,target] of state.targets.entries()){const text=(targetIndex+1)+' · '+target.sourceTitle+' · '+(target.attributes?.alt||target.displayText||target.text||target.tag).slice(0,55);const c=chip(text,()=>call('TARGETS',{targets:state.targets.filter(t=>t.id!==target.id)}),()=>call('LOCATE_TARGET',{id:target.id}));const l=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.checked=!!target.sameKind;check.onchange=()=>run(()=>call('TARGETS',{targets:state.targets.map(t=>t.id===target.id?{...t,sameKind:check.checked}:t)}));l.append(check,'作用同类');c.append(l);chips.append(c);}
const outlining=!!state.adjusting&&state.adjustmentMode==='outline';u.querySelector('[data-outline-mode]')?.setAttribute('aria-pressed',String(outlining));u.querySelector('[data-outline-reset]').hidden=!outlining;const outlineUndo=u.querySelector('[data-outline-undo]');outlineUndo.hidden=!outlining||!!state.plan||!state.canUndo;outlineUndo.disabled=state.busy;const active=!!state.adjusting;if(f.id==='articleChatForm')syncChatModeTool(typeof activePanelTabContext!=='undefined' && !!(activePanelTabContext.pdfMode||activePanelTabContext.offlineMode));const pick=u.querySelector('[data-pick]');pick.setAttribute('aria-pressed',String(active));pick.title=active?'正在调整显示；点击退出并回到内容问答':'调整整页显示，或选择具体元素';pick.disabled=modeBusy;pick.hidden=typeof activePanelTabContext!=='undefined'&&!!activePanelTabContext?.pdfMode;u.querySelector('[data-exit-display]').hidden=!state.adjusting;input(f).placeholder=active?(outlining?'描述你想要的大纲…':'描述调整，或输入 / 选指令、@ 选元素、@@ 换网页'):defaultQuestionHint();const preview=u.querySelector('.wfg-ux-preview');preview.hidden=!state.plan;preview.querySelector('[data-heading]').textContent=outlining?(state.saved?'已保存大纲规则':'大纲预览'):state.saved?'已保存滤镜':'显示预览';preview.querySelector('[data-phase]').textContent=state.saved?'自动套用':state.preview?'尚未保存':'正在看原貌';preview.querySelector('[data-info]').textContent=(state.saved?'适用范围：':'保存后用于：')+(state.saved?state.scopeLabel:state.saveScopeLabel);preview.querySelector('[data-toggle]').textContent=state.preview?'看原貌':'看预览';preview.querySelector('[data-save]').disabled=!state.preview||state.saved||state.busy;preview.querySelector('[data-save]').hidden=state.saved||!!state.generalization;preview.querySelector('[data-save]').textContent='仅保存本页';preview.querySelector('[data-info]').hidden=!!state.generalization;preview.querySelector('[data-toggle]').setAttribute('aria-pressed',String(!state.preview));preview.querySelector('[data-undo]').disabled=!state.canUndo||state.busy;preview.querySelector('[data-disable]').hidden=!state.saved;preview.querySelector('[data-cancel]').hidden=state.saved;renderFilterControls(preview);renderGeneralization(u);u.querySelector('[data-stop]').hidden=!state.busy&&!picking;u.querySelector('[data-stop]').textContent=picking?'取消选择':'停止';const send=f.querySelector('[type=submit]');if(send&&!(typeof articleChatSubmitPending!=='undefined'&&articleChatSubmitPending))send.disabled=state.busy||busy||modeBusy;if(send){send.classList.toggle('wfg-send-running',!!state.busy||busy);send.setAttribute('aria-busy',String(!!state.busy||busy));}u.querySelector('.wfg-ux-status').textContent=state.busy?'':r17ChatNotice(/^(OUTLINE_|MODEL_|RESEARCH_|MULTI_|SOURCE_|PREVIEW_|COLOR_|DOCUMENT_CHANGED|SELECTION_STALE)/.test(state.notice||'')?errorText(state.notice):state.notice);globalThis.WFGComposer?.render(f,state);globalThis.WFGWorkflow?.render(f,state,picking);history(f);if(!u.querySelector(".wfg-ux-sources").hidden)list(f);}}
function list(form){
const box=form.querySelector('.wfg-ux-sources'),search=box.querySelector('input[type=search]'),rows=box.querySelector('[data-rows]');rows.replaceChildren();
for(const t of tabs.filter(t=>(t.title+' '+t.url).toLowerCase().includes(search.value.toLowerCase()))){
const row=document.createElement('div');row.className='wfg-ux-source-row';
const l=document.createElement('label'),c=document.createElement('input'),name=document.createElement('span');name.className='wfg-ux-source-title';name.textContent=t.title+(t.id===state?.tabId?'（当前页）':'');name.title=t.title+'\n'+t.url;
c.type='checkbox';c.dataset.sourceId=t.id;c.checked=state?.sourceIds.includes(t.id);c.disabled=t.id===state?.tabId;
c.onchange=()=>run(()=>call('SOURCES',{tabIds:c.checked?[...state.sourceIds,t.id]:state.sourceIds.filter(id=>id!==t.id),referenceIds:state.referenceIds}));l.append(c,name);row.append(l);
if(t.id!==state?.tabId&&state?.adjusting){const ref=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.checked=state?.referenceIds.includes(t.id);check.title='将此网页作为风格参考';check.onchange=()=>run(()=>call('SOURCES',{tabIds:state.sourceIds.includes(t.id)?state.sourceIds:[...state.sourceIds,t.id],referenceIds:check.checked?[...state.referenceIds,t.id]:state.referenceIds.filter(id=>id!==t.id)}));ref.append(check,'参考风格');row.append(ref);}
rows.append(row);}
if(!rows.childElementCount){const empty=document.createElement('p');empty.className='wfg-ux-empty';empty.textContent='未找到匹配的网页';rows.append(empty);}
}
function createGeneralization(){
 const box=document.createElement('details');box.dataset.generalization='';box.className='wfg-generalization';box.setAttribute('aria-label','相似网页套用');
 const title=document.createElement('summary');title.textContent='套用到相似网页';
 const help=document.createElement('p');help.dataset.generalizationHelp='';help.textContent='先确认本页效果，再补充另一篇论文。两页都通过测试后，AI 才会生成适用范围。';
 const list=document.createElement('ul');list.dataset.generalizationSamples='';
 const add=btn('效果正确，选另一篇验证',async()=>{const next=await call('GENERALIZE_ADD');state=next;render();const valid=next.generalization?.samples.filter(s=>!s.stale).length||0;if(valid>=2)return call('GENERALIZE_GENERATE',{profileId:document.getElementById('articleChatProfile')?.value||''});globalThis.WFGWorkflow.openPageCommands(box.closest('form'));return next;});add.dataset.generalizationAdd='';
 const next=btn('选择另一网页测试',async()=>{const form=box.closest('form');globalThis.WFGWorkflow.openPageCommands(form);});next.dataset.generalizationNext='';
 const transfer=btn('沿用样例效果并预览',()=>call('GENERALIZE_PREVIEW'));transfer.dataset.generalizationTransfer='';
 const reuse=btn('沿用原要求',()=>{const i=input(box.closest('form'));i.value=state?.generalization?.request||'';i.dispatchEvent(new Event('input',{bubbles:true}));i.focus();});reuse.dataset.generalizationReuse='';
 const generate=btn('AI 比较并验证',()=>call('GENERALIZE_GENERATE',{profileId:document.getElementById('articleChatProfile')?.value||''}));generate.dataset.generalizationGenerate='';
 const result=document.createElement('div');result.dataset.generalizationResult='';result.setAttribute('aria-live','polite');
 const save=btn('确认范围并保存滤镜',()=>call('GENERALIZE_SAVE',{token:state?.generalization?.candidate?.token}));save.dataset.generalizationSave='';
 const cancel=btn('结束这组验证',()=>call('GENERALIZE_CANCEL'));cancel.dataset.generalizationCancel='';
 box.append(title,help,list,add,next,transfer,reuse,generate,result,save,cancel);return box;
}
function renderGeneralization(u){
 const box=u.querySelector('[data-generalization]'),d=state.generalization;
 box.hidden=!d&&(!state.plan||state.saved||state.adjustmentMode==='outline');
 if(state.plan&&!d)box.open=true;if(d&&box.dataset.draft!==d.id){box.open=true;box.dataset.draft=d.id;}
 const blocked=!!d?.busy||state.busy||picking;
 const current=d?.samples.find(s=>s.tabId===state.tabId),valid=d?.samples.filter(s=>!s.stale).length||0;
 box.querySelector('summary').textContent=d?.saved?'相似网页滤镜已保存':d?'跨页验证 · '+valid+' 个网页已确认':'套用到相似网页';
 box.dataset.phase=d?.saved?'saved':d?.candidate?'save':d?.busy?'generating':valid>=2?'ready':current?'choose':'confirm';
 box.querySelector('[data-generalization-help]').textContent=d?.saved?'以后打开适用范围内且结构匹配的论文，会自动套用。':d?.candidate?'两页验证已通过。在这里保存即可，无需返回第一篇。':d?.busy?'正在对比网页结构并逐页测试…':!valid?'本页效果满意后，再选一篇类似论文验证，即可自动套用到同类网页。':valid===1&&d.wholePage?(current?'选另一篇同站点论文，验证整页效果。':state.preview?'检查正文、图表和引用，满意后确认。':'预览同一组调整，检查这篇论文上的效果。'):valid===1?(current?'第 1 页已确认。下一步：选另一篇论文的对应区域。':state.preview?'第 2 页已预览相同效果。确认后直接生成通用滤镜，无需返回第一篇。':'第 2 页：选取相同区域，完成选取后会自动预览。无需返回第一篇。'):'样例已确认，可在当前页生成并保存通用滤镜。';
 const add=box.querySelector('[data-generalization-add]');add.hidden=!!d?.saved||!!d?.candidate||!!current&&!current.stale||!!d&&!state.plan;add.disabled=blocked||!state.preview||!state.plan||!state.sampleReady;add.textContent=current?.stale?'重新确认并验证':valid?'效果正确，生成通用滤镜':'效果正确，选另一篇验证';add.classList.add('wfg-flow-primary');
 const next=box.querySelector('[data-generalization-next]');next.hidden=!d||!!d.saved||!!d.candidate||!current;next.textContent=valid>=2?'再添加一篇（可选）':'选择第二篇论文';next.disabled=blocked;
 const canPreviewSample=!state.plan||!!(d?.wholePage&&state.saved&&state.automaticModuleView);
 const transfer=box.querySelector('[data-generalization-transfer]');transfer.hidden=!d?.canTransfer||!!current||!canPreviewSample;transfer.textContent=d?.wholePage?'预览本页整页效果':'沿用样例效果并预览';transfer.disabled=blocked||(!d?.wholePage&&!state.targets.length)||!canPreviewSample;transfer.title=d?.wholePage?'在这篇论文上核验对应区域，预览整页调整':state.plan?'先取消本页旧预览，再沿用样例效果':'将样例的相同字号、样式或隐藏效果用于当前所选区域';
 const reuse=box.querySelector('[data-generalization-reuse]');reuse.hidden=!d?.request||!!d.saved||!!current||(d.canTransfer&&!(d.wholePage&&canPreviewSample));reuse.disabled=blocked;
 const list=box.querySelector('[data-generalization-samples]');list.replaceChildren();
 for(const sample of d?.samples||[]){const li=document.createElement('li'),label=btn(sample.title,()=>switchPage(sample.tabId,false));label.title=sample.url;label.disabled=blocked||sample.tabId===state.tabId;const status=document.createElement('small');status.textContent=sample.stale?'已变化 · 请重测':sample.count+' 处已确认';status.dataset.stale=String(sample.stale);li.append(label,status);if(!d.saved){const remove=btn('移除',()=>call('GENERALIZE_REMOVE',{tabId:sample.tabId}));remove.setAttribute('aria-label','移除样例 '+sample.title);remove.disabled=blocked;li.append(remove);}list.append(li);}
 const generate=box.querySelector('[data-generalization-generate]');generate.hidden=!!d?.saved||!d||!!d.candidate||valid<2;generate.disabled=blocked||valid<2||d.samples.some(s=>s.stale);generate.textContent=d?.busy?'正在逐页核验…':'比较并验证';
 const result=box.querySelector('[data-generalization-result]');const signature=JSON.stringify([d?.error,d?.candidate,d?.saved]);
 if(result.dataset.signature!==signature){result.dataset.signature=signature;result.replaceChildren();const line=text=>{const p=document.createElement('p');p.textContent=text;result.append(p);};
 if(d?.error)line(errorText(d.error));
 if(d?.candidate){line((d.saved?'已保存，自动套用于：':'候选适用范围：')+d.candidate.scopeLabel);const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='查看适用范围与逐页验证';details.append(summary);const p=document.createElement('p');p.textContent='共同点：'+d.candidate.common+'\n差异：'+d.candidate.differences+'\n范围依据：'+d.candidate.scopeReason;p.style.whiteSpace='pre-wrap';details.append(p);for(const check of d.candidate.checks){const p=document.createElement('p');p.textContent='验证通过 · '+check.title+' · '+check.matches.join(' / ')+' 处命中';details.append(p);}result.append(details);if(d.candidate.replaces&&!d.saved)line('保存将停用 '+d.candidate.replaces+' 个覆盖样例页的旧规则，旧记录保留。');}}
 const save=box.querySelector('[data-generalization-save]');save.classList.add('wfg-flow-primary');save.hidden=!d?.candidate||!!d.saved;save.disabled=blocked;
 const cancel=box.querySelector('[data-generalization-cancel]');cancel.hidden=!d;cancel.disabled=!!d?.busy;cancel.textContent=d?.saved?'关闭验证结果':'结束这组验证';
}
function mount(form){if(mounted.has(form))return;mounted.add(form);const u=document.createElement('div');u.dataset.wfgUx='';const tools=document.createElement('div');tools.className='wfg-ux-tools';const sources=btn('添加网页',async()=>{tabs=await call('LIST');box.hidden=!box.hidden;list(form);if(!box.hidden)search.focus();});sources.dataset.addSources='';labelButton(sources,'添加网页','file-magnifying-glass');const pick=btn('调整显示',()=>{},'描述整页效果，也可以点选局部调整');pick.dataset.pick='';pick.setAttribute('aria-label','网页滤镜');pick.setAttribute('aria-pressed','false');labelButton(pick,'调整显示','sliders-horizontal');pick.onclick=()=>{if(modeBusy)return;modeBusy=true;render();void run(async()=>{const next=await call('MODE',{active:!state?.adjusting,mode:'display'});state=next;render();return next;}).finally(()=>{modeBusy=false;render();});};
const outlineMode=btn('调整大纲',()=>call('MODE',{active:!(state?.adjusting&&state.adjustmentMode==='outline'),mode:'outline'}),'提取非论文网页的条目、字段与层级');outlineMode.dataset.outlineMode='';labelButton(outlineMode,'调整大纲','list-tree');
const outlineReset=btn('恢复默认大纲',()=>call('RESET_OUTLINE'));outlineReset.dataset.outlineReset='';outlineReset.hidden=true;
const outlineUndo=btn('撤销大纲调整',()=>call('UNDO'));outlineUndo.dataset.outlineUndo='';outlineUndo.hidden=true;
const exitDisplay=btn('退出',()=>call('MODE',{active:false}),'返回普通问答，取消未保存的预览和元素选择');exitDisplay.dataset.exitDisplay='';exitDisplay.hidden=true;
const stop=btn('停止',()=>call(picking?'CANCEL_PICK':'CANCEL'));stop.dataset.stop='';stop.hidden=true;tools.append(sources,pick,outlineReset,outlineUndo,exitDisplay,stop);const chips=document.createElement('div');chips.className='wfg-ux-chips';const box=document.createElement('div');box.className='wfg-ux-sources';box.hidden=true;const search=document.createElement('input');search.type='search';search.placeholder='按网页标题搜索';search.setAttribute('aria-label','搜索已打开网页');search.oninput=()=>list(form);const rows=document.createElement('div');rows.dataset.rows='';const searchWrap=document.createElement('label');searchWrap.className='wfg-ux-search';searchWrap.append(icon('magnifying-glass'),search);const sourceHead=document.createElement('div');sourceHead.className='wfg-ux-source-head';sourceHead.append('选择要一起阅读的网页',btn('收起',()=>{box.hidden=true;}));box.append(sourceHead,searchWrap,rows);const preview=document.createElement('div');preview.className='wfg-ux-preview';preview.hidden=true;const head=document.createElement('div');head.className='wfg-ux-preview-head';const heading=document.createElement('strong');heading.dataset.heading='';const phase=document.createElement('small');phase.dataset.phase='';head.append(heading,phase);const info=document.createElement('p');info.className='wfg-ux-scope';info.dataset.info='';const primary=document.createElement('div');primary.className='wfg-ux-primary-actions';const secondary=document.createElement('div');secondary.className='wfg-ux-secondary-actions';preview.append(head,info,primary,secondary);const share=btn('分享滤镜',async()=>{const data=await call('EXPORT'),url=URL.createObjectURL(new Blob([data.raw],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='Brevess-filter-'+data.id+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);message('已导出滤镜 JSON；通过原附件按钮导入，预览后保存。');});share.dataset.share='';labelButton(share,'分享','export');share.title='导出滤镜 JSON';secondary.append(share);for(const [text,key,command]of [['查看原貌','toggle','TOGGLE'],['撤销一步','undo','UNDO'],['取消预览','cancel','CANCEL'],['保存并自动套用','save','PREPARE_SAVE'],['停用滤镜','disable','DISABLE']]){const b=btn(text,()=>call(command));b.dataset[key]='';if(key==='save'){labelButton(b,text,'floppy-disk');primary.prepend(b);}else if(key==='toggle')primary.append(b);else {if(key==='undo')labelButton(b,text,'arrow-counter-clockwise');secondary.append(b);}}const confirmation=document.createElement('div');confirmation.dataset.filterConfirmation='';confirmation.className='wfg-filter-confirmation';confirmation.hidden=true;confirmation.setAttribute('role','group');confirmation.setAttribute('aria-label','确认保存滤镜');
const confirmationText=document.createElement('p');confirmationText.dataset.filterConfirmationText='';
const confirmSave=btn('确认保存',()=>call('SAVE',{confirmationToken:state?.saveConfirmation?.token}));confirmSave.dataset.filterConfirm='';
const declineSave=btn('仅本次预览',()=>call('CANCEL_SAVE'));declineSave.dataset.filterDecline='';
const scopeLabel=document.createElement('label');scopeLabel.textContent='适用网址';const scopeInput=document.createElement('input');scopeInput.type='url';scopeInput.readOnly=true;scopeInput.dataset.filterScope='';scopeInput.setAttribute('aria-label','适用网址前缀');scopeInput.oninput=()=>{confirmSave.disabled=scopeInput.value!==state?.saveConfirmation?.scopeUrl;};scopeLabel.append(scopeInput);const checkScope=btn('检查范围',()=>call('PREPARE_SAVE',{scopeUrl:scopeInput.value}));checkScope.dataset.filterScopeCheck='';checkScope.hidden=true;const similar=btn('套用到同类网页',()=>call('PREPARE_SAVE',{similar:true}));similar.dataset.similarSave='';
 primary.append(similar);confirmation.append(scopeLabel,checkScope,confirmationText,confirmSave,declineSave);preview.append(confirmation);
const status=document.createElement('p');status.className='wfg-ux-status';status.setAttribute('role','status');u.append(chips,tools,box,preview,createGeneralization(),status);form.prepend(u);globalThis.WFGComposer?.mount(form);globalThis.WFGWorkflow?.mount(form,u,{button:btn,input:()=>input(form),scripts:showSavedScripts,toggleReference:toggleDisplayReference,tabs:()=>tabs,refreshTabs:async()=>{tabs=await call('LIST');},pick:()=>run(()=>picking?call('FINISH_PICK'):beginPick()),switch:(id,pick)=>run(()=>switchPage(id,pick))});

let composing=false,justComposed=false;
input(form).addEventListener('compositionstart',()=>{composing=true;});
input(form).addEventListener('compositionend',()=>{composing=false;justComposed=true;setTimeout(()=>justComposed=false,0);});
form.addEventListener('keydown',event=>{if(event.target!==input(form)||event.key!=='Enter')return;if(composing||justComposed||event.isComposing||event.keyCode===229){event.stopImmediatePropagation();return;}if(event.shiftKey){event.stopImmediatePropagation();return;}const menu=document.getElementById('articleChatCommandMenu');if(menu&&!menu.hidden&&menu.getBoundingClientRect().height>0)return;if(!WFGUXContext.shouldSubmit(event))return;event.preventDefault();event.stopImmediatePropagation();if(!busy&&!state?.busy)form.requestSubmit();},true);

form.addEventListener('submit',e=>{e.preventDefault();e.stopImmediatePropagation();if(form.id==='articleChatForm'&&typeof activePanelTabContext!=='undefined'&&savedNativeContext(activePanelTabContext,currentWorkspaceSnapshot)){void (document.getElementById('sendArticleChat')?.dataset.mode==='cancel'?cancelArticleChat():submitArticleChat());return;}if(form.id==='articleChatForm'&&document.getElementById('sendArticleChat')?.dataset.mode==='cancel'){void run(()=>cancelArticleChat());return;}const text=input(form).value.trim();if(!text||busy||modeBusy)return;if(form.id==='articleChatForm'&&!state?.adjusting&&(globalThis.BrevessPresentationUI?.isRequest(input(form))||globalThis.BrevessChatAgentControls?.route())){void submitArticleChat();return;}form.querySelector('.wfg-ux-sources').hidden=true;const submissionGeneration=navigationGeneration;busy=true;render();const attachments=form.id==='articleChatForm'&&typeof articleChatAttachments!=='undefined'?articleChatAttachments:[];void run(async()=>{try{if(state?.adjusting&&state.adjustmentMode!=='outline')await finishPendingPick();const contextScope=!globalThis.WFGWorkflow?.isDisplay(form)&&form.id==='articleChatForm'&&typeof articleChatContextScopePayload==='function'?articleChatContextScopePayload():{};const webSearch={mode:form.id==='articleChatForm'&&typeof articleChatWebSearchMode!=='undefined'?articleChatWebSearchMode:'off'};const route=explicitFilterSaveReply(text)?{kind:'display',webSearch:{mode:'off',enabled:false}}:WFGUXContext.route({contextScope,webSearch,...state,question:text});if(route.kind==='original'){if(form.id!=='articleChatForm'||typeof submitArticleChat!=='function'||typeof activePanelTabContext==='undefined'||(Number.isInteger(state?.tabId)?activePanelTabContext.tabId!==state.tabId:!activePanelTabContext.activated||!currentWorkspaceSnapshot?.documentHash))throw Error('ORIGINAL_CONTEXT_UNAVAILABLE');message('');await submitArticleChat();return null;}input(form).value='';input(form).dispatchEvent(new Event('input',{bubbles:true}));const result=await call('RUN',{question:text,attachments,contextScope,webSearch:route.webSearch,profileId:document.getElementById('articleChatProfile')?.value||''});if(form.id==='articleChatForm'&&typeof articleChatAttachments!=='undefined'&&articleChatAttachments===attachments){articleChatAttachments=[];if(typeof renderArticleChatAttachmentChips==='function')renderArticleChatAttachmentChips();}return result;}finally{if(submissionGeneration===navigationGeneration){busy=false;render();}}});},true);
form.addEventListener('change',event=>{const fileInput=event.target;if(fileInput.id!=='articleChatAttachmentFiles'||![...fileInput.files].some(f=>/\.json$/i.test(f.name)))return;event.stopImmediatePropagation();const files=[...fileInput.files];fileInput.value='';void run(async()=>{const other=[];for(const file of files){if(/\.json$/i.test(file.name)&&file.size<=64000){const raw=await file.text();let value;try{value=JSON.parse(raw);}catch{}if(value?.format==='brevess.reading-module'){state=await call('IMPORT_MODULE',{raw});render();continue;}if(value?.schemaVersion===2&&Array.isArray(value.operations)){state=await call('IMPORT',{raw});render();continue;}}other.push(file);}if(other.length&&typeof addArticleChatAttachmentFiles==='function')await addArticleChatAttachmentFiles(other);});},true);
const scope=form.querySelector('#webScope');if(scope){scope.hidden=true;form.querySelector('label[for=webScope]')?.setAttribute('hidden','');form.querySelector('#webScopeInfo')?.setAttribute('hidden','');}
}
async function refresh(){
 const sequence=++refreshSequence,generation=navigationGeneration;
 const current=()=>sequence===refreshSequence&&generation===navigationGeneration;
 try{
  for(const f of forms())mount(f);if(!forms().length)return;
  const windowId=(await chrome.windows.getCurrent()).id;if(!current())return;contextWindowId=windowId;
  const [target]=await chrome.tabs.query({active:true,windowId});if(!current())return;
  contextTarget=target?{tabId:target.id,navigationUrl:target.url||target.pendingUrl||''}:null;
  const saved=globalThis.SciLLM?.parseOfflineArticleReaderUrl?.(contextTarget?.navigationUrl,chrome.runtime.getURL(''));
  if(saved||trustedPdfReader(contextTarget?.navigationUrl)){
    state=null;contextPending=false;message('');
    for(const f of forms()){
      for(const n of f.querySelectorAll('[data-filter-workflow],.wfg-ux-preview,.wfg-ux-sources,[data-generalization],[data-add-sources]'))n.hidden=true;
      const u=f.querySelector('[data-wfg-ux]');if(u)u.dataset.filterEditing='false';
      globalThis.WFGComposer?.render(f,{adjusting:false,sourceIds:[]});
    }
    syncPdfDisplayControls();restoreNativeTimeline();return;
  }
  for(const f of forms())for(const n of f.querySelectorAll('[data-add-sources]'))n.hidden=false;
  const next=await call('STATE');if(!current())return;
  const [liveTarget]=await chrome.tabs.query({active:true,windowId});if(!current())return;
  if(!target||!liveTarget||next.tabId!==liveTarget.id||(next.navigationUrl||next.url)!==(liveTarget.url||liveTarget.pendingUrl)||liveTarget.id!==target.id)throw Error('PAGE_CHANGED');
  if(state&&!sameBinding(binding(state),binding(next)))clearTimeline();
  state=next;contextPending=false;render();if(state.adjusting&&focusedFilterKey!==state.documentKey){focusedFilterKey=state.documentKey;if(typeof switchWorkspaceView==='function')switchWorkspaceView('chat',{persist:false});}restoreNativeTimeline();if(pendingSelectTab===state.tabId){pendingSelectTab=null;if(state.generalization?.wholePage){if(!state.plan||(state.saved&&state.automaticModuleView))void call('GENERALIZE_PREVIEW').then(next=>{if(state?.tabId===next.tabId){state=next;render();}}).catch(e=>message(errorText(e.message)));}else void beginPick();}
  const listResult=await call('LIST');if(!current())return;tabs=listResult;render();
  if(!state.turns.length){const historyResult=await call('HISTORY');if(!current()||!sameBinding(binding(state),binding(historyResult)))return;state=historyResult;render();}
 }catch(e){if(!current())return;if(e.message==='PAGE_CHANGED'){invalidateContext();queueMicrotask(()=>void refresh());}else{contextPending=false;message('当前页面尚未就绪：'+e.message);restoreNativeTimeline();}}
}
chrome.runtime.onMessage.addListener((m,s)=>{
 if(m?.type==='WFG_UX_PROGRESS'&&s.id===chrome.runtime.id&&!contextPending&&sameBinding(binding(state),binding(m))&&state.busy){
   const turn=state.turns.find(t=>t.turnId===m.turnId);if(!turn||turn.status!=='pending')return;
   const prior=liveProcess.get(m.turnId)||{items:[],text:'',sequence:0};const event=m.event||{};
   if(event.type==='answer_preview')prior.text=String(event.text||'').slice(0,32768);
   else {const normalized=globalThis.SciLLM?.normalizeArticleChatProcess?.(event);
     if(normalized){const next=globalThis.SciLLM.reduceArticleChatProcess(prior.process,{...normalized,sequence:++prior.sequence},m.turnId);prior.process=next;}}
   liveProcess.set(m.turnId,prior);while(liveProcess.size>40)liveProcess.delete(liveProcess.keys().next().value);
   for(const form of forms())history(form);return;
 }
 if(m?.type==='WFG_UX_STATE'&&s.id===chrome.runtime.id&&!contextPending&&sameBinding(binding(state),binding(m.state))){state=m.state;render();}});
function syncChatModeTool(pdf) {
 const tool=document.getElementById('chatDisplayMode'); if(!tool)return;
 const editing=!!state?.adjusting && state.adjustmentMode!=='outline';
 tool.disabled=pdf || modeBusy || !document.querySelector('#articleChatForm [data-pick]');
 tool.setAttribute('aria-pressed',String(editing));
 const modeLabel=editing?'调整显示':'普通问答';
 tool.querySelector('.chat-mode-label')?.remove();
 const path=tool.querySelector('[data-toolbar-icon] path');
 const shape=editing?'M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6':'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0';
 if(path&&path.getAttribute('d')!==shape)path.setAttribute('d',shape);
 tool.title='当前：'+modeLabel+'；'+(editing?'切换到普通问答':'切换到调整显示'); tool.setAttribute('aria-label',tool.title);
 tool.dataset.mode=editing?'display':'chat';
 tool.onclick=()=>document.querySelector(editing?'#articleChatForm [data-exit-display]':'#articleChatForm [data-pick]')?.click();
}
function syncPdfDisplayControls(){const pdf=typeof activePanelTabContext!=='undefined'&&!!(activePanelTabContext?.pdfMode||activePanelTabContext?.offlineMode);syncChatModeTool(pdf);for(const n of document.querySelectorAll('[data-pick],[data-exit-display]')){if(pdf)n.hidden=true;else if(n.hasAttribute('data-pick'))n.hidden=!!state?.adjusting&&state.adjustmentMode!=='outline';}}
const observer=new MutationObserver(()=>{if(scheduled)return;scheduled=true;setTimeout(()=>{scheduled=false;syncPdfDisplayControls();for(const f of forms())if(!mounted.has(f))void refresh();if(state)for(const f of forms())history(f);},100);});observer.observe(document.documentElement,{childList:true,subtree:true});if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',refresh);else void refresh();
function observeActiveTab(tabId,windowId){
 if(contextWindowId!==null&&windowId!==contextWindowId||contextTarget?.tabId===tabId)return;
 contextTarget={tabId,navigationUrl:''};invalidateContext();void refresh();
}
chrome.tabs.onActivated.addListener(({tabId,windowId})=>observeActiveTab(tabId,windowId));chrome.tabs.onUpdated.addListener((id,c)=>{if(id===(state?.tabId??contextTarget?.tabId)&&(c.status==='loading'||c.url)){invalidateContext();void refresh();}else if(id===(state?.tabId??contextTarget?.tabId)&&c.status==='complete')void refresh();});
globalThis.BrevessUnifiedComposer={observeActiveTab,showSavedScripts,isEditing:()=>!!state?.adjusting||pendingSelectTab!==null,setFilterOriginal:async original=>{if(state?.plan&&state.preview===original)await call('TOGGLE');},inspectFilter:async()=>{const exported=await call('EXPORT');const exportedValue=JSON.parse(exported.raw),value=exportedValue.module||exportedValue,u=new URL(state.navigationUrl);return {raw:exported.raw,scope:value.scope?value.scope.origin+value.scope.path:u.origin+(value.match?.pathPrefixes?.[0]||u.pathname),basePlan:JSON.stringify(state.plan||null)};},saveFilter:async data=>{const next=await call('EDIT_FILTER',data);state=next;render();return next;},refresh,mount,getOutline:refreshOutline,get outline(){return outline;},locateOutline:ref=>call('LOCATE_OUTLINE',{ref}),version:2};
})();


;/* native/web-filters-general/compare-composer.js */
/* @@ selects explicit sources; normal single-document QA retains its own route. */
(function () {
  'use strict';
  const sessions = new Map();
  let current = null, picker = null, preview = null, sequence = 0, rendering = false;
  const form = () => document.getElementById('articleChatForm');
  const input = () => document.getElementById('articleChatQuestion');
  const el = (tag, cls, text) => { const n = document.createElement(tag); n.className = cls || ''; if (text) n.textContent = text; return n; };
  function button(text, action, cls = '') { const b = el('button', cls, text); b.type = 'button'; b.onclick = action; return b; }
  async function call(command, fields = {}) {
    const response = await chrome.runtime.sendMessage({ type: 'WFG_RESEARCH', command, ...fields });
    if (!response?.ok) throw Error(response?.error || '请求未完成');
    return response.data;
  }
  function payload(s) { return { tabIds: s.sources.map(t => t.id), sourceNumbers: s.sources.map(t => t.number) }; }
  function usesSelectedSources(s) { return !!s?.explicitSources && s.sources.length > 0; }
  function notice(text) { if (current) current.notice = text; render(); }
  function errorText(e) {
    const code = String(e?.message || e);
    return ({ BODY_CITATIONS_MISSING:'已读取正文，但模型没有给出能核对的引用。请重试或切换模型。', SOURCE_BODY_UNAVAILABLE:'所选来源没有可读取的正文。请在原标签页打开全文，再重新发送。', BODY_REVIEW_INVALID:'模型未能完成分批阅读，请重试或切换模型。', MODEL_JSON_INVALID: '模型返回格式不完整，请重试。', MODEL_TIMEOUT: '模型响应超时，请稍后重试。', TOOL_ARGUMENT_INVALID: '模型请求的原文位置无效，请重试。', PDF_SOURCE_NOT_READY: '这份 PDF 还在读取文字，请稍后重试。',
      SOURCE_CLOSED_OR_NAVIGATED: '所选网页已关闭或跳转，请重新选择后发送。',
      SOURCE_DOCUMENT_CHANGED: '所选内容发生了变化，请重新发送以使用最新正文。',
      PAGE_NOT_PERMITTED: '这个页面暂时不能读取，请改选普通网页或 BREVESS PDF 阅读器。',
      RESEARCH_CANCELLED: '已停止生成', RESEARCH_BUSY: '上一条问题仍在处理，请稍后再发送。',
      SOURCE_CITATION_NOT_LOCATED: '原文引用暂时无法定位，请核对来源。'
    })[code] || code;
  }
  function closePicker(focus = false) { picker?.remove(); picker = null; if (focus) input()?.focus(); }
  async function sync() {
    const seq = ++sequence;
    closePicker();
    closePreview();
    current = null;
    const { id: windowId } = await chrome.windows.getCurrent();
    const [tab] = await chrome.tabs.query({ active: true, windowId });
    if (seq !== sequence || !tab) return;
    const key = tab.id + ':' + tab.url;
    if (!sessions.has(key)) sessions.set(key, { key, tabId: tab.id, sources: [{ id: tab.id, title: tab.title, number: 1 }], nextNumber: 2, turns: [], notice: '', busy: false });
    current = sessions.get(key);
    render();
  }
  async function history(s) {
    if (!usesSelectedSources(s) || s.busy) return;
    const identity = JSON.stringify(payload(s));
    try {
      const result = await call('HISTORY', payload(s));
      if (identity !== JSON.stringify(payload(s))) return;
      s.turns = result.items || []; render();
    } catch (e) { if (s === current) notice(errorText(e)); }
  }
  async function chooseSources() {
    if (!current) await sync();
    const s = current;
    if (!s || s.busy) return;
    closePicker();
    try {
      const { id: windowId } = await chrome.windows.getCurrent();
      const tabs = await call('LIST', { windowId });
      if (s !== current) return;
      if (!tabs.some(t => t.id === s.tabId)) throw Error('PAGE_NOT_PERMITTED');
      if (!s.sources.length) { s.sources.push({ ...tabs.find(t => t.id === s.tabId), number: 1 }); s.nextNumber = 2; }
      for (const source of s.sources) source.title = tabs.find(t => t.id === source.id)?.title || source.title;
      s.explicitSources = true;
      render();
      const box = el('section', 'brevess-compare-picker'); picker = box;
      box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', '选择网页或 PDF');
      const head = el('div', 'brevess-compare-picker-head');
      const dismiss=button('×', () => { closePicker(true); void history(s); });
      dismiss.setAttribute('aria-label','关闭');head.append(el('strong', '', '选择网页或 PDF'),dismiss);
      const search = el('input'); search.type = 'search'; search.placeholder = '搜索已打开的标签页'; search.setAttribute('aria-label', search.placeholder);
      const rows = el('div', 'brevess-compare-rows');
      const hint = el('small', '', '最多 6 篇 · 提问时可写“网页 1”和“网页 2”');
      function list() {
        rows.replaceChildren();
        for (const tab of tabs.filter(t => (t.title + ' ' + t.url).toLowerCase().includes(search.value.toLowerCase()))) {
          const row = el('label', 'brevess-compare-source');
          const check = el('input'); check.type = 'checkbox'; check.checked = s.sources.some(t => t.id === tab.id);
          check.disabled = !check.checked && s.sources.length >= 6;
          const selected = s.sources.find(t => t.id === tab.id);
          const text = el('span'); text.append(el('span', 'brevess-compare-source-name', tab.title || tab.url), el('small', '', (selected ? '网页 ' + selected.number + ' · ' : '') + (tab.kind === 'pdf' ? 'PDF' : tab.url) + (tab.id === s.tabId ? ' · 当前页' : '')));
          check.onchange = () => {
            if (check.checked) s.sources.push({ ...tab, number: s.nextNumber++ });
            else s.sources = s.sources.filter(t => t.id !== tab.id);
            s.turns = []; s.notice = ''; list(); render();
          };
          row.append(check, text); rows.append(row);
        }
        if (!rows.childElementCount) rows.append(el('p', '', '没有匹配的标签页'));
      }
      search.oninput = list;
      box.append(head, search, rows, hint); document.body.append(box);
      const rect = input().getBoundingClientRect();
      box.style.left = Math.max(8, rect.left) + 'px';
      box.style.width = Math.min(rect.width, innerWidth - 16) + 'px';
      box.style.bottom = Math.max(8, innerHeight - rect.top + 8) + 'px';
      list(); search.focus();
    } catch (e) { notice(errorText(e)); }
  }
  async function locate(turn, ref, sources) {
    try { await call('LOCATE', { ...sources, turnId: turn.turnId, citation: ref.citation }); }
    catch (e) { notice(errorText(e)); }
  }
  function closePreview(restoreFocus = false) {
    if (!preview) return;
    const anchor = preview.anchor; preview.remove(); preview = null;
    if (restoreFocus && anchor?.isConnected) anchor.focus();
  }
  function showSource(turn, ref, sources, anchor) {
    closePicker(); closePreview();
    const box = el('section', 'brevess-source-preview'); preview = box; box.anchor = anchor;
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', '引用来源');
    const head = el('div', 'brevess-compare-picker-head');
    const close = button('×', () => closePreview(true)); close.setAttribute('aria-label', '关闭引用来源');
    head.append(el('strong', '', '引用来源'), close);
    const title = el('div', 'brevess-source-title', ref.title);
    const pages = ref.target?.nativePdf?.pageNumbers;
    const page = pages?.length ? pages.join('、') : ref.target?.nativePdf?.pageNumber;
    let location = page ? 'PDF · 第 ' + page + ' 页' : ref.target?.nativePdf ? 'PDF' : '';
    if (!location) try { location = new URL(ref.sourceUrl).hostname; } catch {}
    const quote = String(ref.quote || ref.text || ''), context = String(ref.excerpt || quote);
    const body = el('blockquote', 'brevess-source-excerpt');
    const at = context.indexOf(quote);
    if (at >= 0 && quote) body.append(document.createTextNode(context.slice(0, at)), el('mark', '', quote), document.createTextNode(context.slice(at + quote.length)));
    else body.textContent = quote;
    const open = button('打开原文 ↗', () => { closePreview(); void locate(turn, ref, sources); }, 'brevess-source-open');
    box.append(head, title, el('small', '', location), body, open); document.body.append(box);
    const anchorRect = anchor.getBoundingClientRect();
    box.style.left = '12px'; box.style.right = '12px';
    box.style.top = Math.max(12, Math.min(anchorRect.bottom + 8, innerHeight - box.offsetHeight - 16)) + 'px';
    close.focus();
  }
  function turnCard(turn, s) {
    const card = el('article', 'article-chat-turn');
    card.dataset.compareTurn = turn.turnId;
    card.append(el('div', 'article-chat-message is-user article-chat-question', turn.question));
    card.append(createSaveQuestionButton(() => turn.question));
    const answer = el('div', 'article-chat-message is-assistant article-chat-answer');if(typeof articleChatResponseModelLabel==='function')answer.append(el('div','article-chat-answer-heading',articleChatResponseModelLabel(turn)));
    const sources = payload(s);
    const refs = (turn.multiSources || []).map(c => ({ ...c, marker: String(c.citation) }));
    const renderer = BrevessChatMessageUI.createRenderer({ createCitation: ref => {
      const b = button('[' + ref.citation + ']', () => showSource(turn, ref, sources, b), 'article-chat-inline-citation');
      b.title = ref.title + '\n' + ref.quote; b.setAttribute('aria-label', '原文 ' + ref.citation + ' · ' + ref.title); return b;
    } });
    const markdown = String(turn.answer || '').replace(/\[(\d+)\]/g, '[[$1]]');
    answer.append(renderer.renderArticleChatMarkdown(markdown || (turn.status === 'pending' ? '正在读取所选文献…' : errorText(turn.error || turn.status)), { evidence: refs }));
    const footer = el('div', 'brevess-compare-meta', '多文献问答' + (turn.model ? ' · ' + turn.model : ''));
    if (turn.coverage?.some(c=>Number.isInteger(c.availablePassages))) {
      const details=el('details','article-chat-source-details'), summary=el('summary','','正文来源 · '+turn.coverage.length);
      details.append(summary);for(const c of turn.coverage)details.append(el('div','',c.title+' · 已读 '+(c.reviewedPassages??c.readElements)+' / '+c.availablePassages+' 段'+((c.reviewedPassages||0)>c.readElements?' · 本轮作答选用 '+c.readElements+' 段':'')+(c.indexTruncated?' · 部分内容不可读':'')));answer.append(details);
    }
    if (turn.status === 'failed' || turn.status === 'cancelled') footer.append(button('重试', () => { input().value = turn.question; input().focus(); }));
    if (turn.status === 'complete') footer.append(button('复制', () => navigator.clipboard.writeText(turn.answer).catch(e => notice(e.message))));
    answer.append(footer); card.append(answer); return card;
  }
  function render() {
    if (rendering || !current || !form()) return;
    rendering = true;
    try {
      const s = current, f = form();
      let deck = f.querySelector('[data-compare-sources]');
      if (!deck) { deck = el('div', 'brevess-compare-chips'); deck.dataset.compareSources = ''; (f.querySelector('.wfg-composer-deck') || f).append(deck); }
      const signature = JSON.stringify([s.sources, s.busy, s.explicitSources]);
      if (deck.dataset.signature !== signature) {
        deck.dataset.signature = signature; deck.replaceChildren(); deck.hidden = !usesSelectedSources(s);
        if (usesSelectedSources(s)) for (const source of s.sources) {
          const chip = el('span', 'brevess-compare-chip');
          const label = el('span', '', '网页 ' + source.number + ' · ' + source.title); label.title = label.textContent;
          chip.append(label);
          const remove = button('×', () => { s.sources = s.sources.filter(t => t.id !== source.id); s.turns = []; s.notice = ''; closePreview(); render(); void history(s); });
          remove.disabled = s.busy; remove.setAttribute('aria-label', '移除网页 ' + source.number); remove.title = '移除网页 ' + source.number; chip.append(remove);
          deck.append(chip);
        }
      }
      let status = f.querySelector('[data-compare-status]');
      if (!status) { status = el('div', 'brevess-compare-status'); status.dataset.compareStatus = ''; status.setAttribute('role', 'status'); f.append(status); }
      const statusText = s.notice || '';
      if (status.dataset.text !== statusText + s.busy) { status.dataset.text = statusText + s.busy; status.replaceChildren(document.createTextNode(statusText)); if (s.busy) status.append(button('停止', () => void call('CANCEL'))); status.hidden = !statusText && !s.busy; }
      const log = document.getElementById('articleChatMessages');
      if (log) {
        let thread = log.querySelector('[data-compare-thread]');
        const sig = JSON.stringify([s.key, s.turns]);
        if (s.turns.length && (!thread || thread.dataset.signature !== sig)) {
          const next = el('section'); next.dataset.compareThread = ''; next.dataset.signature = sig;
          for (const turn of s.turns) next.append(turnCard(turn, s));
          const follow = s.scrollToLatest || log.scrollHeight - log.scrollTop - log.clientHeight < 100;
          if (thread) thread.replaceWith(next); else log.append(next);
          if (follow) { log.scrollTop = log.scrollHeight; s.scrollToLatest = false; }
        } else if (!s.turns.length) thread?.remove();
      }
    } finally { rendering = false; }
  }
  async function ask() {
    const s = current, question = input()?.value.trim();
    if (!s || s.busy || !question) return;
    if (typeof llmSettingsState === 'undefined' || llmSettingsState?.settings?.consentGranted !== true) { notice('请先在设置中配置模型并确认正文发送。'); return; }
    if (typeof articleChatContextScopes !== 'undefined' && articleChatContextScopes.size) { notice('跨文献问答使用所选文献，请先移除单篇章节限定。'); return; }
    const request = { ...payload(s), profileId: document.getElementById('articleChatProfile')?.value || '', question,
      attachments: typeof articleChatAttachments !== 'undefined' ? articleChatAttachments : [], requestId: crypto.randomUUID() };
    s.scrollToLatest = true; s.busy = true; s.notice = '正在比较 ' + s.sources.length + ' 篇文献'; s.requestId = request.requestId;
    const pending = { turnId: request.requestId, question, answer: '', status: 'pending' }; s.turns.push(pending);
    input().value = ''; closePicker(); render();
    try {
      const result = await call('ASK', request);
      s.turns = s.turns.filter(t => t !== pending).concat(result.turn); s.notice = '';
      if (typeof articleChatAttachments !== 'undefined' && articleChatAttachments === request.attachments) { articleChatAttachments = []; renderArticleChatAttachmentChips(); }
    } catch (e) { pending.status = 'failed'; pending.error = errorText(e); s.notice = ''; }
    finally { s.busy = false; render(); }
  }
  window.addEventListener('input', event => {
    if (event.target !== input() || event.isComposing || globalThis.WFGWorkflow?.isDisplay(form())) return;
    const field = event.target, at = field.selectionStart;
    if (field.value.slice(0, at).endsWith('@@')) {
      event.stopImmediatePropagation(); field.setRangeText('', at - 2, at, 'end');
      if (typeof closeArticleChatCommandMenu === 'function') closeArticleChatCommandMenu();
      void chooseSources();
    }
  }, true);
  window.addEventListener('keydown', event => {
    if (globalThis.WFGWorkflow?.isDisplay(form()) || document.getElementById('articleChatCommandMenu')?.hidden === false) return;
    if (event.target !== input() || !usesSelectedSources(current) || event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault(); event.stopImmediatePropagation();
    form().requestSubmit();
  }, true);
  window.addEventListener('submit', event => {
    if (event.target !== form() || !usesSelectedSources(current) || globalThis.WFGWorkflow?.isDisplay(form())) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (globalThis.BrevessUnifiedComposer?.isEditing()) { notice('请先退出网页滤镜，再进行跨文献问答。'); return; }
    void ask();
  }, true);
  window.addEventListener('click', event => { if (event.target.closest?.('[data-add-sources]')) { event.preventDefault(); event.stopImmediatePropagation(); void chooseSources(); } }, true);
  document.addEventListener('pointerdown', event => { if (preview && !preview.contains(event.target) && !event.target.closest?.('.article-chat-inline-citation')) closePreview(); if (picker && !picker.contains(event.target)) { closePicker(); if (current) void history(current); } });
  document.addEventListener('keydown', event => { if (preview && event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); closePreview(true); } if (picker && event.key === 'Escape') { event.preventDefault(); closePicker(true); if (current) void history(current); } }, true);
  chrome.runtime.onMessage.addListener((m, sender) => {
    if (sender.id !== chrome.runtime.id || m?.type !== 'BREVESS_COMPARE_PROGRESS') return;
    const s = [...sessions.values()].find(s => s.busy && s.requestId === m.requestId); if (!s) return;
    const pending = s.turns.find(t => t.turnId === m.requestId);
    if (m.event?.type === 'public_summary') { s.notice = m.event.text; render(); }
    if (pending && m.event?.type === 'answer_preview') { pending.answer = String(m.event.text || '').slice(0,32768); render(); }
  });
  chrome.tabs.onActivated.addListener(() => void sync());
  chrome.tabs.onUpdated.addListener((id, change) => { if (id === current?.tabId && change.url) void sync(); });
  chrome.tabs.onRemoved.addListener(id => { for (const [key, s] of sessions) if (s.tabId === id) sessions.delete(key); });
  let queued = false;
  new MutationObserver(() => { if (queued) return; queued = true; queueMicrotask(() => { queued = false; render(); }); }).observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => void sync()); else void sync();
})();


;/* native/core/sidebar-toolbar-icons.js */
/* One 24-unit outline system for the two compact sidebar toolbars. */
(function () {
  'use strict';
  const batch = 'm10 3 2.2 5.8L18 11l-5.8 2.2L10 19l-2.2-5.8L2 11l5.8-2.2zM19 2v5m-2.5-2.5h5M19 16v5m-2.5-2.5h5';
  const translate = 'M3 5h12M9 3v2M12 5c-1 5-4 8-8 10M5 8c1 3 3 5 6 7M13 21l4-10 4 10M14.5 17h5';
  const paths = {
    batchHighlights: batch, batchOutline: batch, batchFigures: batch, batchNotes: batch,
    openHighlightSettings: 'M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6',
    applyHighlight: 'm5 15 10-11 5 5L9 20H4zM3 22h13',
    pdfPanelWorkspaceOpen: 'M3 9V3h6M15 3h6v6M21 15v6h-6M9 21H3v-6M7 7h10v10H7z',
    figureBoardOpen: 'M3 3h7v6H3zM14 15h7v6h-7zM3 15h7v6H3zM6.5 9v6M7 12h10v3',
    figureBoardReview: 'M4 3h12l4 4v14H4zM7 13l3 3 6-7',
    chatDisplayMode: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
    sidePanelSavedScripts: 'M3 5h7l2 2h9v13H3zM10 11l-2 2 2 2M15 11l2 2-2 2',
    toggleBilingualTranslation: translate,
    importArticleAbbreviationsToGlobal: 'M3 4h13l5 5v12H3zM7 4v6h10V4M7 21v-7h10v7',
    configureAbbreviationLookup: 'M9 15l6-6M8 10l-3 3a4 4 0 0 0 6 6l3-3M10 8l3-3a4 4 0 0 1 6 6l-3 3',
    addArticleAbbreviationEntry: 'M12 4v16M4 12h16',
    removeArticleAbbreviationEntry: 'M3 6h18M8 6V3h8v3M6 6l1 15h10l1-15M10 10v7M14 10v7',
    translateArticleAbbreviations: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z',
    sidePanelNotificationSummary: 'M6 8a6 6 0 0 1 12 0c0 7 3 7 3 9H3c0-2 3-2 3-9M10 21h4',
    openSidePanelSettings: 'M19.11 9.05L21.82 10.09L21.82 13.91L19.11 14.95L20.29 17.59L17.59 20.29L14.95 19.11L13.91 21.82L10.09 21.82L9.05 19.11L6.41 20.29L3.71 17.59L4.89 14.95L2.18 13.91L2.18 10.09L4.89 9.05L3.71 6.41L6.41 3.71L9.05 4.89L10.09 2.18L13.91 2.18L14.95 4.89L17.59 3.71L20.29 6.41L19.11 9.05Z M15.25 12a3.25 3.25 0 1 1-6.5 0 3.25 3.25 0 0 1 6.5 0',
    copyLiteratureNote: 'M9 9h12v12H9zM15 9V3H3v12h6',
    exportLiteratureNoteMarkdown: 'M3 18V6l5 7 5-7v12M19 6v12m-3-3 3 3 3-3',
    toggleLiteratureNoteMarkdown: 'M8 6l-5 6 5 6M16 6l5 6-5 6M14 3l-4 18',
    figurePanelHeaderFieldsButton: 'M4 6h16M4 12h16M4 18h16M8 4v4M16 10v4M10 16v4',
    collapseAllOutlineLevels: 'm7 4 5 5 5-5M7 20l5-5 5 5',
    collapseAllFigureLevels: 'm7 4 5 5 5-5M7 20l5-5 5 5',
    openSupplementalFigureImport: 'M12 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-7M4 17l5-5 3.5 3.5 2-2 5.5 5.5M7.5 8.5h.01M18.5 2v7M15 5.5h7',
    translateNavigationTitles: translate,
    showArticleAbbreviations: 'm2 20 6.5-16L15 20M4.5 14h8.1M17 6h5M17 12h4M17 18h5',
    saveCurrentArticleWorkspace: 'M4 3h13l4 4v14H3V3h1M7 3v6h10V3M7 21v-8h10v8',
    refreshArticleNavigation: 'M20 4v6h-6M4 20v-6h6M20 10a8 8 0 0 0-14-4M4 14a8 8 0 0 0 14 4',
    refreshFigureInventory: 'M20 4v6h-6M4 20v-6h6M20 10a8 8 0 0 0-14-4M4 14a8 8 0 0 0 14 4',
    clearArticleChat: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7',
    sidePanelMoreToolsSummary: 'M5 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2M12 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2M19 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2',
    autofillLiteratureNote: 'M5 3h10l4 4v5M5 3v18h8M9 8h4M9 12h3M16 16l2-2 3 3-2 2-4 1z'
  };
  function apply() {
    for (const [id, d] of Object.entries(paths)) {
      const button = document.getElementById(id); if (!button || button.querySelector('[data-toolbar-icon]')) continue;
      const old = button.querySelector(':scope > svg,:scope > i,:scope > .side-panel-tool-letter,:scope > .side-panel-more-glyph,:scope > .figure-panel-header-fields-triangle');
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      for (const [k, v] of Object.entries({viewBox:'0 0 24 24',width:'20',height:'20',fill:'none',stroke:'currentColor','stroke-width':'1.75','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true','data-toolbar-icon':''})) svg.setAttribute(k,v);
      const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d',d); svg.append(path);
      if (old) old.replaceWith(svg); else button.prepend(svg);
    }
  }
  apply();
  for (const id of ['sidePanelHeader','sidePanelDocumentStatus']) {
    const root = document.getElementById(id); if (root) new MutationObserver(apply).observe(root,{childList:true,subtree:true});
  }
})();


;/* native/core/pdf-panel-sidebar.js */
/* Sidebar is a separate extension document. Bind every action to the same
 * active tab before and after the asynchronous reader response. */
(() => {
  const open = document.getElementById('pdfPanelWorkspaceOpen');
  let target, timer, closeTimer, selection, gallery;
  const sizeKey = 'brevessFigurePreviewSize';
  function validSize(value) {
    return value && [value.width, value.height].every(n => Number.isInteger(n) && n > 0 && n <= 16384);
  }
  function dismiss(item, soft = false) {
    if (!item) return;
    void sendTabMessage(item.scope.tabId, {
      action: 'hideArticleFigurePreview',
      token: item.token,
      soft,
      expectedDocumentIdentity: item.scope.panelDocumentIdentity || '',
      pageUrl: item.scope.url
    }).catch(() => {});
  }
  function hide() {
    clearTimeout(timer);
    clearTimeout(closeTimer);
    dismiss(selection);
    selection = null;
    target = null;
  }
  const view = document.getElementById('workspace-figures');
  const isWeb = (scope) => !scope.pdfMode && !scope.offlineMode && /^(?:https?|file):/.test(scope.url || '');
  function scopeValid(scope) {
    if (!isWeb(scope)) return isCurrentPanelContext(scope);
    const now = capturePanelContext();
    return now.tabId === scope.tabId && now.key === scope.key && isCurrentPanelContext(now);
  }
  let scan, scanTimer;
  function stopScan() {
    clearTimeout(scanTimer);
    scan = null;
  }
  async function scanNext(state) {
    if (scan !== state || view.hidden || !scopeValid(state.scope)) return;
    try {
      if (!state.items) state.items = await request(state.scope, 'listWebPanelFigures');
      if (scan !== state || view.hidden) return;
      if (!state.items.length) {
        stopScan();
        return;
      }
      const item = state.items.shift();
      await request(state.scope, 'warmWebPanelFigure', { figureId: item.figureId, index: item.index });
    } catch (_) {
      /* Individual Figures can be retried in the gallery. */
    }
    if (scan === state && state.items?.length) scanTimer = setTimeout(() => scanNext(state), 400);
  }
  function sync() {
    const scope = capturePanelContext();
    const web = isWeb(scope) && isCurrentPanelContext(scope);
    open.hidden = !scope.pdfMode && !web;
    if (!web || view.hidden || (scan && !scopeValid(scan.scope))) stopScan();
    if (web && !view.hidden && !scan) {
      const state = (scan = { scope, items: null });
      scanTimer = setTimeout(() => scanNext(state), 350);
    }
    if (gallery && !scopeValid(gallery.scope)) gallery = null;
    if ((view.hidden && !target?.closest('#figureQuickNav')) || (selection && !scopeValid(selection.scope))) hide();
  }
  function locate(el) {
    const badge = el.closest?.(
      '[data-figure-badge],.figure-quick-nav-marker,.workspace-panel-id,.workspace-panel-description,.figure-quick-nav-panel-button'
    );
    const row = badge?.closest('[data-figure-id]');
    if (!row) return null;
    return { badge, figureId: row.dataset.figureId, label: row.dataset.panelId || '' };
  }
  function replacement(info) {
    if (info.badge.isConnected) return info.badge;
    const id = CSS.escape(info.figureId);
    if (info.badge.hasAttribute('data-figure-badge'))
      return view.querySelector('[data-figure-badge="' + id + '"]');
    const kind = [
      'figure-quick-nav-marker',
      'figure-quick-nav-panel-button',
      'workspace-panel-id',
      'workspace-panel-description'
    ].find((cls) => info.badge.classList.contains(cls));
    const row =
      '[data-figure-id="' +
      id +
      '"]' +
      (info.label ? '[data-panel-id="' + CSS.escape(info.label) + '"]' : '');
    return (
      kind && document.querySelector(row + (kind === 'figure-quick-nav-panel-button' ? '' : ' ') + '.' + kind)
    );
  }
  async function request(scope, action, extra = {}) {
    if (!scopeValid(scope)) throw Error('当前文献已切换');
    const response = await sendTabMessage(scope.tabId, {
      action,
      ...extra,
      ...(isWeb(scope)
        ? { pageUrl: scope.url, expectedDocumentIdentity: scope.panelDocumentIdentity || '' }
        : {})
    });
    if (!scopeValid(scope)) throw Error('当前文献已切换');
    if (!response?.success) throw Error(response?.error?.message || '无法读取 Panel');
    if (isWeb(scope)) {
      if (
        !response.documentIdentity ||
        (scope.panelDocumentIdentity && response.documentIdentity !== scope.panelDocumentIdentity)
      )
        throw Error('当前网页已重新加载');
      scope.panelDocumentIdentity = response.documentIdentity;
    }
    return response.data;
  }
  globalThis.BrevessNotePanels = {
    list: scope => request(scope,'listNoteFigures'),
    labels: (scope,item) => request(scope,'listNotePanels',{figureId:item.figureId,index:item.index}),
    crop: (scope,item,label) => request(scope,scope.pdfMode ? 'readPdfPanelCrop' : 'readWebPanelCrop',
      {figureId:item.figureId,index:item.index,label,edge:1600})
  };
  async function show(info) {
    const badge = replacement(info),
      scope = capturePanelContext();
    if (!badge || (view.hidden && !badge.closest('#figureQuickNav')) || !scopeValid(scope)) return;
    const rect = badge.getBoundingClientRect(),
      selected = { scope, figureId: info.figureId, label: info.label, token: crypto.randomUUID() };
    target = badge;
    selection = selected;
    try {
      const size = (await chrome.storage.local.get(sizeKey))[sizeKey];
      if (selection !== selected || !scopeValid(scope)) return;
      await request(scope, 'showArticleFigurePreview', {
        size: validSize(size) ? size : null,
        figureId: info.figureId,
        label: info.label,
        token: selected.token,
        anchor: Math.max(0, Math.min(1, (rect.top + rect.height / 2) / innerHeight))
      });
      if (selection !== selected) dismiss(selected);
    } catch (e) {
      if (selection === selected && scopeValid(scope)) showStatus(e.message, 'error');
    }
  }
  function enter(e) {
    const info = locate(e.target);
    if (!info || e.pointerType === 'touch') return;
    clearTimeout(closeTimer);
    if (target === info.badge) return;
    hide();
    target = info.badge;
    timer = setTimeout(() => show(info), 160);
  }
  function leave(e) {
    if (!target?.contains(e.target) || (e.relatedTarget instanceof Node && target.contains(e.relatedTarget)))
      return;
    clearTimeout(timer);
    target = null;
    const item = selection;
    if (item) closeTimer = setTimeout(() => dismiss(item, true), 240);
  }
  for (const key of ['pointerover', 'focusin']) document.addEventListener(key, enter);
  for (const key of ['pointerout', 'focusout']) document.addEventListener(key, leave);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hide();
  });
  view.addEventListener('scroll', hide, { passive: true });
  addEventListener('pagehide', hide);
  function attach(p) {
    const name = p.name + ' ' + p.label;
    const file = {
      attachmentId: p.attachmentId || crypto.randomUUID(),
      kind: 'image',
      name: name + (/jpeg/.test(p.mediaType) ? '.jpg' : '.png'),
      mediaType: p.mediaType,
      dataUrl: p.dataUrl
    };
    articleChatAttachments = SciLLM.normalizeArticleChatAttachments([
      ...articleChatAttachments.filter((f) => f.attachmentId !== file.attachmentId),
      file
    ]);
    renderArticleChatAttachmentChips();
    switchWorkspaceView('chat');
    const input = document.getElementById('articleChatQuestion');
    const lines = [
      name + (p.page ? '（PDF 第 ' + p.page + ' 页）' : '（网页原图裁片）'),
      p.caption,
      p.ambiguous ? '此裁图的自动定位待核对。' : '',
      '我的问题：'
    ].filter(Boolean);
    input.value = [input.value.trim(), lines.join('\n')].filter(Boolean).join('\n\n');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    hide();
    input.focus();
  }
  async function editor(scope, figureId, label) {
    const token = crypto.randomUUID();
    gallery = { scope, token };
    await request(scope, 'openArticleFigureGallery', { figureId, label, token });
  }
  open.onclick = () => editor(capturePanelContext()).catch((e) => showStatus(e.message, 'error'));
  chrome.runtime.onMessage.addListener((m, sender) => {
    if (m?.type !== 'BREVESS_FIGURE_SURFACE_ACTION' || sender.id !== chrome.runtime.id) return;
    const item = [selection, gallery].find(
      (x) => x && x.token === m.token && x.scope.tabId === sender.tab?.id
    );
    if (
      !item ||
      !scopeValid(item.scope) ||
      (item.scope.panelDocumentIdentity && m.documentIdentity !== item.scope.panelDocumentIdentity)
    )
      return;
    if (m.kind === 'resize' && item === selection && validSize(m.size)) {
      void chrome.storage.local.set({ [sizeKey]: { width: m.size.width, height: m.size.height } })
        .catch(() => showStatus('预览尺寸未保存', 'error'));
      return;
    }
    if (m.kind === 'review')
      void editor(item.scope, m.figureId, m.label).catch((e) => showStatus(e.message, 'error'));
    if (m.kind === 'ask')
      void request(item.scope, item.scope.pdfMode ? 'readPdfPanelCrop' : 'readWebPanelCrop', {
        figureId: m.figureId,
        label: m.label,
        index: m.index,
        edge: 1400
      })
        .then((p) => {
          if (scopeValid(item.scope)) attach(p);
        })
        .catch((e) => showStatus(e.message, 'error'));
  });
  new MutationObserver(sync).observe(document.getElementById('workspace-figures'), {
    attributes: true,
    attributeFilter: ['hidden']
  });
  new MutationObserver(sync).observe(document.getElementById('sidePanelPaperTitle'), {
    childList: true,
    subtree: true,
    characterData: true
  });
  sync();
})();

// Keep the edge itself available to the scrollbar and the article view.
(() => {
  const nav = document.getElementById('figureQuickNav');
  let anchor = null;
  let renderedSnapshot = null;

  function close() {
    delete nav.dataset.edgeOpen;
    anchor = null;
  }

  function place(y) {
    const count = nav.querySelectorAll('.figure-quick-nav-marker').length;
    if (!count || nav.hidden || document.querySelector('dialog:modal')) return close();
    const margin = 8;
    const available = Math.max(1, innerHeight - 2 * margin - 8);
    const columnWidth = parseFloat(nav.style.getPropertyValue('--figure-nav-width')) || 34;
    const maxColumns = Math.max(1, Math.floor((innerWidth - margin - 2) / columnWidth));
    const rowHeight = Math.max(16, Math.min(25, Math.floor(available / Math.ceil(count / maxColumns))));
    const maxRows = Math.max(1, Math.floor(available / rowHeight));
    const columns = Math.ceil(count / maxRows);
    const rows = Math.ceil(count / columns);
    const height = rows * rowHeight + 8;
    nav.style.setProperty('--edge-rows', rows);
    nav.style.setProperty('--edge-row-height', rowHeight + 'px');
    nav.style.top = Math.max(margin, Math.min(innerHeight - margin - height, y - height / 2)) + 'px';
    nav.dataset.edgeOpen = 'true';
    anchor = y;
  }

  function openAt(y) {
    if (anchor === null) {
      const data = currentWorkspaceSnapshot?.figures;
      if (!data?.figures?.length) return close();
      if (renderedSnapshot !== currentWorkspaceSnapshot || nav.hidden || !nav.firstElementChild) {
        const draft = data.draft || currentWorkspaceSnapshot.figureWorkspaceDraft;
        renderFigureQuickNav(SciLLM.orderFigureWorkspaceItems(data.figures,
          draft?.supplementalPlacements, draft?.figureDisplayOrder));
        renderedSnapshot = currentWorkspaceSnapshot;
      }
    }
    place(y);
  }

  document.addEventListener('pointermove', event => {
    if (event.pointerType === 'touch' || event.buttons) return;
    if (anchor !== null && nav.contains(event.target)) return;
    if (event.clientX >= innerWidth - 8) openAt(event.clientY);
    else if (anchor !== null) close();
  }, { passive: true });
  document.addEventListener('pointerout', event => { if (!event.relatedTarget) close(); });
  nav.addEventListener('focusin', () => { if (anchor === null) openAt(innerHeight / 2); });
  nav.addEventListener('focusout', event => {
    if (!nav.contains(event.relatedTarget) && !nav.matches(':hover')) close();
  });
  nav.addEventListener('keydown', event => {
    if (event.key === 'Escape') { close(); event.target.blur(); }
    if (event.key === 'Enter' && event.target === nav) {
      openAt(innerHeight / 2);
      nav.querySelector('button')?.focus();
    }
  });
  window.addEventListener('resize', () => { if (anchor !== null) place(Math.min(innerHeight, anchor)); });
  new MutationObserver(() => {
    if (nav.hidden) close();
    else if (anchor !== null) place(anchor);
  }).observe(nav, { attributes: true, attributeFilter: ['hidden'], childList: true });
})();


;/* native/core/highlight-distribution.js */
(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  const HIGHLIGHT_DISTRIBUTION_VERSION = '3';
  const HIGHLIGHT_SOURCES = ['manual', 'llm', 'regex', 'other'];

  function normalize(value) {
    return String(value || '').normalize('NFKC').replace(/\s+/gu, ' ').trim();
  }

  function flatten(nodes) {
    if (typeof shared.flattenStructureNodes === 'function') {
      return shared.flattenStructureNodes(nodes);
    }
    const result = [];
    (Array.isArray(nodes) ? nodes : []).forEach(node => {
      result.push(node);
      result.push(...flatten(node.children));
    });
    return result;
  }

  function normalizeSource(value) {
    const source = normalize(value).toLowerCase();
    if (source === 'manual') return 'manual';
    if (source === 'llm' || source === 'ai') return 'llm';
    if (source === 'regex' || source === 'rule') return 'regex';
    return 'other';
  }

  function buildHighlightDistribution(structure = {}, occurrences = []) {
    const nodes = flatten(structure.nodes);
    const paragraphs = Array.isArray(structure.paragraphs) ? structure.paragraphs : [];
    const paragraphSection = new Map(
      paragraphs.map(item => [normalize(item.paragraphId), normalize(item.sectionId)])
    );
    const categoryMap = new Map();
    const rowMap = new Map(nodes.map(node => [
      normalize(node.sectionId),
      {
        sectionId: normalize(node.sectionId),
        title: normalize(node.title) || '未命名章节',
        level: Math.max(1, Number(node.level) || 1),
        order: Number(node.order) || 0,
        cells: {},
        total: 0
      }
    ]));
    const unresolved = [];
    const sourceCounts = Object.fromEntries(HIGHLIGHT_SOURCES.map(source => [source, 0]));
    const seenAutomaticOccurrences = new Set();
    let deduplicatedHighlights = 0;

    (Array.isArray(occurrences) ? occurrences : []).forEach((item, index) => {
      const categoryId = normalize(item?.categoryId) || 'uncategorized';
      const sectionId = normalize(item?.sectionId) ||
        paragraphSection.get(normalize(item?.paragraphId)) || '';
      const occurrence = {
        ...item,
        highlightId: normalize(item?.highlightId) || `highlight-${index + 1}`,
        categoryId,
        categoryName: normalize(item?.categoryName) || categoryId,
        color: normalize(item?.color) || '#D9D6CE',
        sectionId,
        source: normalizeSource(item?.source),
        sourceStart: Number.isInteger(item?.sourceStart) ? item.sourceStart : null,
        sourceEnd: Number.isInteger(item?.sourceEnd) ? item.sourceEnd : null
      };
      const positionKey = occurrence.source !== 'manual' &&
        occurrence.paragraphId && Number.isInteger(occurrence.sourceStart)
        ? [
            occurrence.source,
            occurrence.categoryId,
            normalize(occurrence.paragraphId),
            occurrence.sourceStart,
            occurrence.sourceEnd
          ].join('\n')
        : '';
      if (positionKey && seenAutomaticOccurrences.has(positionKey)) {
        deduplicatedHighlights += 1;
        return;
      }
      if (positionKey) seenAutomaticOccurrences.add(positionKey);

      const category = categoryMap.get(categoryId) || {
        categoryId,
        name: normalize(item?.categoryName) || categoryId,
        color: normalize(item?.color) || '#D9D6CE',
        count: 0
      };
      category.count += 1;
      categoryMap.set(categoryId, category);
      occurrence.categoryName = category.name;
      occurrence.color = category.color;
      sourceCounts[occurrence.source] += 1;
      const row = rowMap.get(sectionId);
      if (!row) {
        unresolved.push(occurrence);
        return;
      }
      const cell = row.cells[categoryId] || { count: 0, items: [], sources: {} };
      cell.count += 1;
      cell.items.push(occurrence);
      const sourceCell = cell.sources[occurrence.source] || { count: 0, items: [] };
      sourceCell.count += 1;
      sourceCell.items.push(occurrence);
      cell.sources[occurrence.source] = sourceCell;
      row.cells[categoryId] = cell;
      row.total += 1;
    });

    const categories = [...categoryMap.values()];
    const rows = [...rowMap.values()]
      .filter(row => row.total > 0)
      .sort((first, second) => first.order - second.order);

    return {
      version: HIGHLIGHT_DISTRIBUTION_VERSION,
      categories,
      rows,
      unresolved,
      sourceCounts,
      totalHighlights: Object.values(sourceCounts).reduce((sum, count) => sum + count, 0),
      deduplicatedHighlights
    };
  }

  return {
    HIGHLIGHT_DISTRIBUTION_VERSION,
    HIGHLIGHT_SOURCES,
    buildHighlightDistribution
  };
});


;/* highlight-examples.js */
/* Public examples. Category definitions come from the shipping catalog. */
window.BVHighlightExamples = (api,d) => {
 const catalog=api.createUnifiedCategoryCatalog();
 const terms=d.highlightTerms||[['term_msa','序列比对','#4ECDC4','\\b(?:MSAs?|multi-sequence alignments)\\b'],['term_model','模型与评估','#FFB6C1','\\b(?:AlphaFold|CASP14|PDB)\\b'],['term_metric','精度指标','#87CEEB','\\b(?:GDT|lDDT-Cα|atomic accuracy)\\b']];
 terms.forEach(([categoryId,name,color,expression])=>catalog[categoryId]=api.toUnifiedCategory({categoryId,name,color,builtIn:false,enabledEngines:['regex','llm'],regex:{phrases:[],expressions:[expression],excludePhrases:[],caseSensitive:false,wholeWord:false},prompt:{definition:'标记原文中的'+name}}));
 const views={quick_story:{name:'快速主线',categoryIds:['known_background','method','result','comparison','limitation','significance_novelty']},paper_terms:{name:d.web?'网页术语（示例情境）':'论文术语（示例情境）',categoryIds:terms.map(x=>x[0])}};
 const slices=d.highlightSlices||[
  ['abstract','known_background',0,'Through an',.94,'说明结构知识与序列数量之间的背景差距。'],
  ['accuracy','significance_novelty',0,'We validated',.91,'作者声明的方法创新，需与后续验证结果分开阅读。'],
  ['accuracy','result','We validated',null,.95,'CASP14 验证结果；多数情况并不代表每一个目标。'],
  ['network','method',0,null,.9,'说明算法如何整合结构知识和多序列比对。'],
  ['interpretation','method',0,'Domains are',.89,'描述消融实验的两个测试集及样本量。'],
  ['interpretation','comparison','Domains are',null,.86,'不同测试集使用不同评分，比较时需区分指标。'],
  ['msa','limitation',0,'We observe',.95,'浅 MSA 下性能下降，是模型应用的边界。'],
  ['msa','result','We observe',null,.87,'超过约 100 条序列后的收益趋缓，是数据中观察到的结果。']
 ];
 const llm=slices.map(([p,categoryId,from,to,confidence,note],i)=>{
  const text=d.paragraphs.find(x=>x.id===p).text,start=typeof from==='number'?from:text.indexOf(from),end=to?text.indexOf(to):text.length;
  if(start<0||end<=start)throw Error('Invalid public highlight excerpt');
  const quote=text.slice(start,end).trimEnd();
  return{id:'llm-'+i,source:'llm',categoryId,confidence,note,segments:[{p,start,end:start+quote.length}],text:quote};
 });
 const labelSources=new Map([...Object.values(catalog),...Object.values(views)].map(item=>[item,item.name]));
 const localize=()=>{for(const [item,name] of labelSources)item.name=window.BV_I18N?.text(name)||name;};
 localize();document.addEventListener('brevess-demo-languagechange',localize);
 return{catalog,views,llm};
};


;/* native-highlights.js */
/* Wire the production highlight controls and renderer to public example data. */
window.BVSetupHighlights = ({d,demo,send}) => {
 const example=BVHighlightExamples(SciLLM,d),byId=id=>document.getElementById(id);
 let last={items:[],groups:[]};
 llmSettingsState.availableCategories=Object.entries(example.catalog).map(([categoryId,c])=>({...c,categoryId}));
 llmSettingsState.readingViews=structuredClone(example.views);llmSettingsState.effectiveMode='llm';
 llmSettingsState.settings.analysisMode='regex';readingViewId='paper_terms';analysisMode='regex';
 selectedCategories=new Set(example.views.paper_terms.categoryIds);llmSelectedCategories=new Set(example.views.quick_story.categoryIds);
 preparedDocumentState={documentHash:'a'.repeat(64),activeCategories:[],categorySources:[]};
 const config=()=>({engine:analysisMode,viewId:readingViewId,ids:[...getConfiguredViewSelection()],confidence:confidenceThreshold,mode:highlightMode});
 const render=()=>{matchCounts={};for(const a of last.items.filter(a=>a.source===analysisMode))matchCounts[a.categoryId]=(matchCounts[a.categoryId]||0)+1;
  confidenceDistributionState={key:confidenceDistributionContextKey(),status:'ready',data:last.llmRan?{groups:last.groups}:null};
  renderCategories();updateAnalysisModeUi();renderManualAnnotationSummary();
  byId('llmDiagnostics').textContent=last.llmRan?'语义结果与匹配分数为预置示例；此页面不调用模型。':'双击底部高亮图标，展示预置语义识别结果。';
 };
 const sync=()=>{for(const c of llmSettingsState.availableCategories)c.name=example.catalog[c.categoryId]?.name||c.name;for(const [id,view] of Object.entries(llmSettingsState.readingViews))view.name=example.views[id]?.name||view.name;render();send('highlight-engine',{engine:analysisMode});send('highlight-config',{config:config()});};
 const run=()=>send('highlight-run',{engine:analysisMode,config:config()});
 queueCategorySelectionMutation=async(id,enabled)=>{const view=llmSettingsState.readingViews[readingViewId];view.categoryIds=enabled?[...new Set([...view.categoryIds,id])]:view.categoryIds.filter(x=>x!==id);selectedCategories=new Set(view.categoryIds);llmSelectedCategories=new Set(view.categoryIds);sync();};
 saveSettings=async()=>{};
 refreshConfidenceDistribution=async()=>{confidenceDistributionState={key:confidenceDistributionContextKey(),status:'ready',data:last.llmRan?{groups:last.groups}:null};renderConfidenceDistribution();};
 openCategoryRuleEditor=id=>{send('toast',{message:'此处展示插件原生规则入口。完整规则编辑可在安装后的设置中使用；官网可切换情境、类别与匹配模式。'});return Promise.resolve();};
 byId('toggleAnalysisEngine').addEventListener('click',()=>{analysisMode=analysisMode==='regex'?'llm':'regex';readingViewId=analysisMode==='llm'?'quick_story':'paper_terms';sync();});
 byId('readingViewOptions').addEventListener('change',e=>{readingViewId=e.target.value;sync();});
 byId('confidenceThreshold').addEventListener('input',e=>{confidenceThreshold=Number(e.target.value);sync();});
 document.querySelectorAll('[name=highlightMode]').forEach(r=>r.addEventListener('change',e=>{highlightMode=e.target.value;if(last.regexRan)run();else sync();}));
 byId('moreCategories').addEventListener('click',()=>{const panel=byId('moreCategoriesPanel');panel.hidden=!panel.hidden;byId('moreCategories').setAttribute('aria-expanded',String(!panel.hidden));renderCategories();});
 byId('categorySearch').addEventListener('input',()=>renderCategories());
 byId('clearAutomaticHighlights').addEventListener('click',()=>send('highlight-clear',{target:'automatic'}));
 byId('clearManualAnnotations').addEventListener('click',()=>send('highlight-clear',{target:'manual'}));
 byId('applyHighlight').addEventListener('click',run);
 byId('editReadingScenarios').addEventListener('click',()=>{send('toast',{message:'示例已准备“快速主线”和“论文术语”两种情境。安装后可自由编辑情境与规则。'});});
 byId('highlightControls').open=true;
 document.addEventListener('brevess-demo-languagechange',sync);
 return{run,sync,complete(){byId('highlightControls').open=false;byId('workspace-highlights').scrollTop=0;},receive(state){last=state;demo.reading.annotations=state.items;manualAnnotationState.annotationCount=new Set(state.items.filter(a=>a.source==='manual').map(a=>a.id)).size;
  currentWorkspaceSnapshot.highlightDistribution=SciLLM.buildHighlightDistribution(currentWorkspaceSnapshot,state.items);
  render();renderHighlightDistributionSnapshot(currentWorkspaceSnapshot);
 },engine:()=>analysisMode};
};


;/* reading-tools-data.js */
/* Editorial examples tied to the public AlphaFold excerpts; no model requests. */
window.BV_READER_EXAMPLES = {
 title:'利用 AlphaFold 实现高精度蛋白质结构预测',
 headings:{abstract:'摘要',accuracy:'AlphaFold 的预测精度',network:'AlphaFold 网络',interpretation:'解读神经网络',msa:'MSA 深度与链间接触'},
 figures:['AlphaFold 能够生成高精度结构。','AlphaFold 对近期 PDB 结构的预测精度。','架构细节。','解读神经网络。','MSA 深度与链间接触的影响。'],
 abbreviations:[
  {abbreviation:'CASP14',fullName:'14th Critical Assessment of protein Structure Prediction',paragraphId:'accuracy',meaningZh:'第十四届蛋白质结构预测关键评估',definitionZh:'采用盲测目标比较蛋白质结构预测方法。本文以 CASP14 结果检验模型精度。'},
  {abbreviation:'MSA',fullName:'multiple sequence alignment',paragraphId:'msa',meaningZh:'多序列比对',definitionZh:'将同源序列按位置对齐，用序列变化模式提供结构约束线索。本文指出浅 MSA 下精度会下降。'},
  {abbreviation:'PDB',fullName:'Protein Data Bank',paragraphId:'interpretation',meaningZh:'蛋白质结构数据库',definitionZh:'保存实验解析的大分子三维结构；本文使用 PDB 结构构建独立测试集。'},
  {abbreviation:'GDT',fullName:'global distance test',paragraphId:'interpretation',meaningZh:'全局距离检验',definitionZh:'衡量预测结构与参考结构的整体相似程度。图 4a 对结构域使用 GDT 评分。'},
  {abbreviation:'lDDT-Cα',fullName:'local Distance Difference Test (Cα atoms)',paragraphId:'interpretation',meaningZh:'基于 Cα 原子的局部距离差异检验',definitionZh:'比较局部原子间距离的保持情况。图 4a 对蛋白质链使用此评分；不能将它与 GDT 直接视为同一量。'}
 ],
 semanticQueries:[
  {query:'比对序列不足时，预测还可靠吗？',aliases:/比对|序列不足|msa|序列深度|同源|alignment|shallow|homolog/i,score:s=>s.paragraphId==='msa'?(s.text.startsWith('The model')? .98 : .84):s.paragraphId==='network'? .76 : .12},
  {query:'模型通过哪些测试证明预测精度？',aliases:/测试|验证|精度|评估|盲测|准确|验证集|accuracy|assess|validat|benchmark|test/i,score:s=>s.paragraphId==='accuracy'?(s.text.startsWith('We validated')? .96 : .78):s.paragraphId==='interpretation'? .86 : .12},
  {query:'如何把生物学知识融入网络？',aliases:/生物|物理|知识|网络|算法|方法|架构|network|biolog|physical|architect|method/i,score:s=>s.paragraphId==='network'? .97 : s.paragraphId==='abstract'? .74 : .1}
 ]
};


;/* native-sidebar-tools.js */
/* Production outline and abbreviation controls; only the data boundary is adapted. */
window.BVSetupSidebarTools=({d,demo,send})=>{
 const examples=d.readerExamples||BV_READER_EXAMPLES,byId=id=>document.getElementById(id);
 const extracted=SciLLM.extractArticleAbbreviations(d.paragraphs.map(p=>({paragraphId:p.id,text:p.text})));
 let entries=examples.abbreviations.map(entry=>({...entry,meaningZh:'',definitionZh:'',sourceType:extracted.some(a=>a.abbreviation.toUpperCase()===entry.abbreviation.toUpperCase())?'automatic':'manual'})).sort((a,b)=>a.abbreviation.localeCompare(b.abbreviation));
 let memory=SciLLM.normalizeGlobalAbbreviationMemory({entries:[]});
 const snapshot=()=>({documentKey:panelTabDocumentKey({id:1,url:d.source}),documentHash:'a'.repeat(64),documentIdentity:'public-alphafold-demo',tabId:1,entries:structuredClone(entries),automaticCount:entries.filter(e=>e.sourceType==='automatic').length,manualCount:entries.filter(e=>e.sourceType==='manual').length,globalCount:0,translatedCount:entries.filter(e=>e.meaningZh).length,definedCount:entries.filter(e=>e.definitionZh).length});
 const handle=demo.handleMessage;
 demo.handleMessage=async m=>{
  if(m.action==='getArticleAbbreviations')return {success:true,abbreviations:snapshot()};
  if(m.action==='updateArticleAbbreviationTranslations'){
   for(const update of m.translations){const entry=entries.find(e=>abbreviationPairKey(e)===abbreviationPairKey(update));if(!entry)continue;for(const field of ['meaningZh','definitionZh'])if(update[field]!==undefined&&(!m.onlyEmpty||!entry[field]))entry[field]=update[field];}
   return {success:true,abbreviations:snapshot()};
  }
  if(m.action==='removeArticleAbbreviation'){entries=entries.filter(e=>e.abbreviation!==m.abbreviation);return {success:true};}
  if(m.type==='ABBREVIATION_MEMORY_GET')return {success:true,data:{memory}};
  if(m.type==='ABBREVIATION_MEMORY_MERGE'){const result=SciLLM.mergeGlobalAbbreviationMemory(memory,m.entries,{incrementSupport:m.incrementSupport});memory=result.memory;return {success:true,data:result};}
  return handle(m);
 };
 loadArticleAbbreviationSnapshot=async()=>currentArticleAbbreviationSnapshot=snapshot();
 enrichArticleAbbreviations=async({entry=null,fields=['meaningZh']}={})=>{
  const binding=abbreviationBinding(),targets=entry?[entry]:entries,updates=[];
  for(const target of targets){const example=examples.abbreviations.find(e=>abbreviationPairKey(e)===abbreviationPairKey(target));if(!example)continue;
   const update={abbreviation:target.abbreviation,fullName:target.fullName,origin:'prepared-example'};
   for(const field of fields)if(!target[field]&&!abbreviationDraft(target,field).value.trim())update[field]=example[field];
   updates.push(update);
  }
  const next=await persistArticleAbbreviationTranslations(updates,{binding,onlyEmpty:true});
  if(isCurrentAbbreviationBinding(binding,true))renderArticleAbbreviationTable(next);
  send('toast',{message:'已补齐空白项；保留手动填写内容。释义为预置示例，未调用在线模型。'});
 };
 setupAbbreviationDialogs();
 byId('showArticleAbbreviations').addEventListener('click',()=>{void showArticleAbbreviationTable();send('toast',{message:entries.length+' 项缩略词示例；可编辑或补齐空白释义。'});});
 byId('translateArticleAbbreviations').addEventListener('click',()=>void enrichArticleAbbreviations());
 byId('importArticleAbbreviationsToGlobal').addEventListener('click',()=>void importCurrentArticleAbbreviationsToGlobal());
 byId('exportGlobalAbbreviationMemory').addEventListener('click',()=>void exportGlobalAbbreviationMemoryFile());
 byId('translateNavigationTitles').disabled=false;
 byId('translateNavigationTitles').title='翻译大纲标题';
 byId('translateNavigationTitles').addEventListener('click',()=>{
  for(const p of d.paragraphs)if(examples.headings[p.id])outlineTitleTranslations.set(outlineExpansionKey('html',p.id),['html',p.id,p.heading,examples.headings[p.id],'public-prepared-translation']);
  renderArticleNavigationTree(currentWorkspaceSnapshot);
  byId('translateNavigationTitles').disabled=false;
  send('toast',{message:Object.keys(examples.headings).length?'大纲已显示中英对照，可点击标题定位原文。译文为预置示例。':'此完整网页暂未准备大纲译文；安装插件后可翻译当前网页标题。'});
 });
 return {add(entry){
  const existing=entries.find(e=>abbreviationPairKey(e)===abbreviationPairKey(entry));
  if(!existing)entries.push({...entry,paragraphId:entry.paragraphId||entry.blockId||'msa',sourceType:'manual'});
  entries.sort((a,b)=>a.abbreviation.localeCompare(b.abbreviation));
  currentArticleAbbreviationSnapshot=snapshot();
  if(byId('articleAbbreviationDialog').open)renderArticleAbbreviationTable(currentArticleAbbreviationSnapshot);
 }};
};


;/* native-sidebar.js */
/* Bind prepared data to production renderers. No HTML/CSS imitation of the sidebar. */
(() => {
 const start=()=>{
  try {
   const d=window.BV_DEMO_DATA, demo=window.__websiteDemo;
   let busy=false, mode='navigation';
   const en=()=>document.documentElement.lang==='en',pick=values=>values[en()&&values[1]?1:0],t=value=>BV_I18N.text(value);
   figurePanelHeaderFieldsState={purpose:true,evidenceType:false,experimentalMethods:false,statisticalMethods:false,comparison:false,directObservation:false};
   const send=(type,data)=>demo.send(type,data), byId=id=>document.getElementById(id);
   pollSidebarRuntimeTasks=async()=>{};
   refreshArticleWorkspace=async()=>currentWorkspaceSnapshot;
   // The website has no extension receiver handshake. Keep the native controls,
   // and route their content-script commands to this isolated in-memory adapter.
   sendTabMessage=async(tabId,message)=>chrome.tabs.sendMessage(tabId,message);
   llmSettingsState=demo.profile;
   activePanelTabContext={...activePanelTabContext,tabId:1,url:d.source,title:d.title,activated:true,key:d.source};
   demo.draft=SciLLM.createFigureWorkspaceDraft(demo.figures());
   demo.snapshot=()=>currentWorkspaceSnapshot;
   currentWorkspaceSnapshot={...demo.structure(),publisher:d.publisher||'springer-nature',figures:{figures:demo.figures(),inventoryReady:true,workspaceLifecycle:1,draft:demo.draft},chat:{turns:[]}};
   if(d.web)for(const node of d.outline||[])outlineExpansionState.set(outlineExpansionKey('html',node.sectionId),true);
   manualAnnotationState={documentId:d.documentId||'alphafold-example',annotationCount:0,unresolvedCount:0};
   focusWorkspaceSource=async target=>{target.kind==='highlight'?send('annotation',{id:target.highlightId}):send('jump',{id:target.evidence?.paragraphId||target.sectionId||target.paragraphId||'abstract'});return true;};
   handleFigureWorkspaceJump=async figure=>send('jump',{id:'figure-'+String(figure.figureId).replace(/\D/g,'')});
   async function generate(module=mode, specific){
     if(busy)return;busy=true;send('generation',{module});
     const button=document.querySelector(`[data-workspace-target="${module==='note'?'notes':module}"]`);
     button?.setAttribute('aria-busy','true');
     try {
       // The brief transition only reveals prepared output, not model latency.
       await new Promise(r=>setTimeout(r,350));
       if(module==='figures'){
         const ids=specific?[Number(specific.replace(/\D/g,''))]:figureSelectedIds.size?[...figureSelectedIds].map(id=>Number(id.replace(/\D/g,''))):d.figures.map(f=>f.id);
         demo.reading.figures=[...new Set([...demo.reading.figures,...ids])];
         demo.draft=SciLLM.createFigureWorkspaceDraft(demo.figures(),demo.draft);demo.reading.draft=structuredClone(demo.draft);
         currentWorkspaceSnapshot.figures={figures:demo.figures(),inventoryReady:true,workspaceLifecycle:1,draft:demo.draft};
         figureWorkspaceViewState.clear?.();
         figureExpansionState.set('Fig'+ids[0],true);
         renderFigureWorkspaceSnapshot(currentWorkspaceSnapshot,{coordinated:true});
       } else if(module==='navigation') {
         currentWorkspaceSnapshot.paragraphSummaries=d.paragraphs.map(p=>({paragraphId:p.id,summary:pick(p.summary)}));
         d.paragraphs.forEach(p=>outlineExpansionState.set(outlineExpansionKey('html',p.id),true));
         renderArticleNavigationTree(currentWorkspaceSnapshot);
         document.querySelectorAll('#articleNavigationTree details.workspace-tree-node').forEach(n=>{n.open=true;});
       } else if(module==='highlights') {highlights.run();}
       else if(module==='notes'||module==='note'){
         const fields=d.notes||{research_background:'蛋白质序列数量远多于已解析结构，结构预测可以帮助缩小这一差距。',scientific_questions:'如何在没有已知相似结构时，从氨基酸序列预测可靠的三维结构？',experimental_design:'CASP14 盲测；训练时间之后的 PDB 测试集；组件消融；MSA 深度分析。',important_methods:'MSA 与残基对表示；Evoformer；Invariant Point Attention；recycling。',main_findings:'在多数 CASP14 目标上取得很高精度。低 MSA 深度仍是重要的适用边界（Fig 5a）。',innovations:'将共进化信息与几何推理整合到端到端网络。',limitations:'高局部置信度不等于已验证生物学功能；浅 MSA 和链间接触仍需谨慎。',open_questions:'哪些低置信区域值得优先实验验证？',transferable_ideas:'先用结构与置信度提出可检验的问题，再结合实验对照验证。'};
         literatureNoteDocumentState={schemaVersion:3,templateId:'basic_research',valuesByTemplate:{basic_research:{...Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,t(v)])),...demo.reading.notes}},fieldStatusByTemplate:{basic_research:Object.fromEntries(Object.keys(fields).map(k=>[k,'supported']))},fieldEvidenceByTemplate:{},fieldUpdatedAtByTemplate:{},updatedAt:Date.now()};
         demo.reading.notes=literatureNoteDocumentState.valuesByTemplate.basic_research;renderLiteratureNoteDrawer();
       } else if(module==='chat') await answer(pick(d.questions[0].q));
       send('generated',{module,reading:demo.reading});
     }finally{busy=false;button?.setAttribute('aria-busy','false');}
   }
   function switchMode(view){mode=view;switchWorkspaceView(view,{persist:false,loadNotes:false});if(view==='notes')renderLiteratureNoteDrawer();if(view==='chat')renderArticleChatSnapshot(currentWorkspaceSnapshot);send('module',{module:view});}
   runSingleFigureAnalysis=async id=>generate('figures',id);
   performSidebarModuleBatch=async module=>generate(module);
   generateSelectedLiteratureNoteFields=async()=>generate('notes');
   runSingleFigurePanelAnalysis=async id=>generate('figures',id);
   persistLiteratureNote=async()=>{};
   async function answer(question){
     const q=d.questions.find(x=>x.q.includes(question)||x.match?.test(question))||(d.web?null:(/msa|比对|序列/i.test(question)?d.questions[0]:/evoformer|recycl|结构模块|架构|流程/i.test(question)?d.questions[1]:/局限|验证|置信|可靠|不足/i.test(question)?d.questions[2]:null));
     const turn={turnId:'example-'+Date.now(),question,status:'completed',answer:q?`${pick(q.answer)}\n\n${pick(q.details)}\n\n${d.web?'**'+t('依据当前网页内容整理。')+'**':'**'+t('回到原图核对：')+'** '+q.refs.map(i=>`Fig ${i}`).join(' · ')}\n\n*${t('预置示例，未调用在线模型。')}*`:(en()?'Try a prepared example: ':'这是官网预置体验。试问：')+d.questions.map(x=>pick(x.q)).join(en()?'; ':'；')+(en()?'. Install BREVESS to ask your configured model any question.':'。安装插件后可向已配置的模型自由提问。'),createdAt:Date.now(),profileName:t('预置 AI 示例')};
     if(q){
       const evidenceIds=q.evidenceIds||(q===d.questions[0]?['msa']:[]);
       if(evidenceIds.length)turn.answer=turn.answer.replace(pick(q.details),pick(q.details)+' '+evidenceIds.map((_,i)=>'[['+(i+1)+']]').join(' '));
       const evidence=evidenceIds.map((id,index)=>{const p=d.paragraphs.find(p=>p.id===id);return {marker:String(index+1),paragraphId:id,sectionTitle:p.heading,quote:p.text,documentRevision:1};});
       if(!d.web&&q===d.questions[1])turn.answer+=en()?'\n\n| Component | Role |\n| --- | --- |\n| Evoformer | Exchanges information between MSA and pair representations |\n| Structure module | Converts representations into 3D coordinates |\n| Recycling | Feeds predictions back into the network for refinement |':'\n\n| 组件 | 作用 |\n| --- | --- |\n| Evoformer | 让 MSA 与残基对表示交换信息 |\n| 结构模块 | 将表示转成三维坐标 |\n| Recycling | 把预测反馈给网络继续精炼 |';
       turn.answerBlocks=[{blockId:turn.turnId+'-answer',markdown:turn.answer,evidence}];
     }
     currentWorkspaceSnapshot.chat.turns.push(turn);demo.reading.chat=currentWorkspaceSnapshot.chat.turns;
     renderArticleChatSnapshot(currentWorkspaceSnapshot);byId('articleChatQuestion').value='';
     byId('articleChatMessages').scrollTop=byId('articleChatMessages').scrollHeight;
     send('generated',{module:'chat',reading:demo.reading});
   }
   submitArticleChat=async event=>{event?.preventDefault();const q=byId('articleChatQuestion').value.trim();if(q)await answer(q);};
   const highlights=BVSetupHighlights({d,demo,send});
   byId('sidePanelPaperTitle').textContent=d.title;
   byId('articleNavigationStatus').textContent=d.web?d.publisher+' · 完整正文':'springer-nature · 5 个标题 · 论文节选';
   byId('sidePanelDocumentStatusText').textContent='已激活 · '+(d.publisher||'springer-nature')+' · 网页滤镜';
   renderArticleNavigationTree(currentWorkspaceSnapshot);renderFigureWorkspaceSnapshot(currentWorkspaceSnapshot,{coordinated:true});renderHighlightDistributionSnapshot(currentWorkspaceSnapshot);renderManualAnnotationSummary();renderLiteratureNoteDrawer();
   highlights.sync();
   const readerTools=BVSetupSidebarTools({d,demo,send});
   setupSidebarBatchActions();setupOutlineLevelControl();setupFigurePanelHeaderFieldsMenu();setupFigureKeyboardNavigation();
   byId('collapseAllFigureLevels').addEventListener('click',()=>setAllFigureLevelsExpanded(false));
   byId('toggleLiteratureNoteMarkdown').addEventListener('click',()=>setLiteratureNotePreview(!literatureNotePreviewing,{userInitiated:true}));
   byId('copyLiteratureNote').addEventListener('click',()=>void copyLiteratureNote());
   byId('exportLiteratureNoteMarkdown').addEventListener('click',()=>exportLiteratureNoteMarkdown());
   byId('articleChatMessages').addEventListener('click',async e=>{
     const button=e.target.closest('[data-article-chat-action]');if(!button)return;
     const turns=currentWorkspaceSnapshot.chat.turns,turn=turns.find(t=>t.turnId===button.dataset.turnId);if(!turn)return;
     const action=button.dataset.articleChatAction;
     if(action==='copy-answer'){try{await navigator.clipboard.writeText(turn.answer);send('toast',{message:'已复制回答'});}catch{send('toast',{message:'浏览器未允许复制，可选中回答手动复制。'});}return;}
     if(action==='delete-answer'){turn.answer='';turn.answerBlocks=[];}
     else {currentWorkspaceSnapshot.chat.turns=turns.filter(t=>t!==turn);if(action==='regenerate')await answer(turn.question);}
     demo.reading.chat=currentWorkspaceSnapshot.chat.turns;renderArticleChatSnapshot(currentWorkspaceSnapshot);
   });
   byId('literatureNoteTemplateSelect').addEventListener('change',()=>{
     literatureNoteDocumentState ||= {schemaVersion:3,valuesByTemplate:{},fieldStatusByTemplate:{},fieldEvidenceByTemplate:{},fieldUpdatedAtByTemplate:{}};
     literatureNoteDocumentState.templateId=byId('literatureNoteTemplateSelect').value;
     renderLiteratureNoteDrawer();
   });
   byId('clearArticleChat').addEventListener('click',()=>{currentWorkspaceSnapshot.chat.turns=[];demo.reading.chat=[];renderArticleChatSnapshot(currentWorkspaceSnapshot);});
   byId('refreshFigureInventory').addEventListener('click',()=>renderFigureWorkspaceSnapshot(currentWorkspaceSnapshot,{coordinated:true}));
   document.querySelectorAll('[data-workspace-target]').forEach(b=>{
     b.addEventListener('click',()=>switchMode(b.dataset.workspaceTarget));
     if(['notes','chat'].includes(b.dataset.workspaceTarget))b.addEventListener('dblclick',()=>generate(b.dataset.workspaceTarget));
   });
   document.addEventListener('submit',e=>{if(e.target.id==='articleChatForm'&&!window.BrevessUnifiedComposer?.isEditing()){e.preventDefault();e.stopImmediatePropagation();void submitArticleChat(e);}},true);
   byId('articleChatQuestion').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!window.BrevessUnifiedComposer?.isEditing()){e.preventDefault();void submitArticleChat(e);}});
   byId('saveCurrentArticleWorkspace').addEventListener('click',()=>send('save',{reading:demo.reading}));
   byId('refreshArticleNavigation').addEventListener('click',()=>{renderArticleNavigationTree(currentWorkspaceSnapshot);send('toast',{message:'大纲已刷新'});});
   document.querySelector('[aria-label="打开识别规则与模型设置"]')?.addEventListener('click',()=>send('install'));
   document.addEventListener('click',e=>{const a=e.target.closest('a');if(a?.hash.startsWith('#figure-')){e.preventDefault();send('jump',{id:a.hash.slice(1)});}});
   byId('literatureNoteForm').addEventListener('input',()=>{
     for(const field of document.querySelectorAll('[data-literature-note-field]'))demo.reading.notes[field.dataset.literatureNoteField]=field.value;
     if(literatureNoteDocumentState)literatureNoteDocumentState.valuesByTemplate[literatureNoteDocumentState.templateId]={...demo.reading.notes};
   });
   // Keep generated content, user edits and highlights on this page only.
   addEventListener('message',e=>{if(e.source!==parent||e.origin!==location.origin||e.data?.source!=='brevess-website')return;
     const m=e.data;if(m.type==='module')switchMode(m.module);if(m.type==='generate')generate(m.module||mode);if(m.type==='ask'){switchMode('chat');void answer(m.question);}
     if(m.type==='language')SciLLM.setInterfaceLanguage(m.language,document);
     if(m.type==='highlight-complete')highlights.complete();
     if(m.type==='annotations')highlights.receive(m);
     if(m.type==='abbreviation-add')readerTools.add(m.entry);
     if(m.type==='image-note'){
       demo.draft=SciLLM.applyFigureWorkspaceMutation(demo.draft,{type:'set_figure_field',figureId:m.figureId,field:'note',value:m.value,expectedRevision:demo.draft.revision});
       demo.reading.draft=structuredClone(demo.draft);currentWorkspaceSnapshot.figures.draft=demo.draft;
       renderFigureWorkspaceSnapshot(currentWorkspaceSnapshot,{coordinated:true});
     }
     if(m.type==='image-viewer'){
       const previous=figureOriginalViewerState.captionVisible;figureOriginalViewerState={...figureOriginalViewerState,...m.state};
       if(m.state.open&&m.state.captionVisible){switchMode('figures');showFigureCaptionSidebar(m.state.figureId);}
       else if(previous)hideFigureCaptionSidebar(m.state.figureId);
     }
   });
   // Feature links reveal prepared examples through the same native renderers.
   // Reopening an example keeps annotations, generated results and note edits.
   let featureRequest=0;
   demo.openFeature=async feature=>{
     const view={outline:'navigation',evidence:'chat',search:'navigation',highlights:'highlights',figures:'figures',chat:'chat',notes:'notes',translate:'navigation'}[feature];
     if(!view)return;
     const request=++featureRequest;
     while(busy){await new Promise(resolve=>setTimeout(resolve,40));if(request!==featureRequest)return;}
     switchMode(view);
     if(feature==='outline'&&!currentWorkspaceSnapshot.paragraphSummaries?.length)await generate('navigation');
     if(feature==='figures'){
       if(!demo.reading.figures.length)await generate('figures','Fig1');
       else{figureExpansionState.set('Fig'+demo.reading.figures[0],true);renderFigureWorkspaceSnapshot(currentWorkspaceSnapshot,{coordinated:true});}
     }
     if(feature==='notes'&&!Object.keys(demo.reading.notes).length)await generate('notes');
     if(feature==='chat'&&!currentWorkspaceSnapshot.chat.turns.length)await answer(pick(d.questions[0].q));
     if(feature==='evidence'){
       let turn=currentWorkspaceSnapshot.chat.turns.find(turn=>turn.answerBlocks?.some(block=>block.evidence?.some(source=>source.paragraphId==='msa')));
       if(!turn){await answer(pick(d.questions[0].q));turn=currentWorkspaceSnapshot.chat.turns.at(-1);}
       else renderArticleChatSnapshot(currentWorkspaceSnapshot);
       const log=byId('articleChatMessages'),citation=log.querySelector('[data-turn-id="'+turn.turnId+'"] .article-chat-inline-citation[data-paragraph-id="msa"]');
       if(citation)log.scrollTop+=citation.getBoundingClientRect().top-log.getBoundingClientRect().top-log.clientHeight/2;
     }
     if(request===featureRequest)document.querySelector('[data-workspace-target="'+view+'"]')?.focus({preventScroll:true});
     return view;
   };
   switchMode('navigation');demo.ready=true;BV_I18N.activate();demo.generate=generate;demo.send('ready',{surface:'sidebar'});
  }catch(e){__websiteDemo.errors.push(e.stack);console.error(e);}
 };
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();

