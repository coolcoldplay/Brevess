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
