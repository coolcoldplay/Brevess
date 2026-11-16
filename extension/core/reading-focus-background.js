(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BrevessReadingFocus = Object.assign(root.BrevessReadingFocus || {}, api);
  if (typeof chrome !== 'undefined' && chrome.runtime?.id && chrome.scripting) {
    root.BrevessReadingFocusController = api.createFocusController(chrome, root.BrevessReadingFocus);
    root.BrevessReadingFocusController.register();
  }
})(globalThis, function () {
  'use strict';
  function createFocusController(browser, model, now = Date.now) {
    const ALARM = 'brevess-reading-focus-deadline-v1', CHECKPOINT = 'brevess-reading-focus-checkpoint-v1';
    const PREFIX = browser.runtime.getURL('');
    let queue = Promise.resolve(), generation = 0;
    const previews = new Map();
    const enqueue = fn => { const task = queue.then(fn); queue = task.catch(() => {}); return task; };
    const read = async () => model.load((await browser.storage.local.get(model.STORAGE_KEY))[model.STORAGE_KEY]);
    const send = data => browser.runtime.sendMessage({ type: 'BREVESS_READING_FOCUS_STATE', data }).catch(() => {});
    async function notify(effect) {
      if (!browser.notifications || !await browser.permissions.contains({ permissions: ['notifications'] })) return;
      const copy = { 'focus-done': ['本轮专注完成', '准备好后，在侧栏手动开始休息。'], 'break-done': ['休息结束', '准备好后，在侧栏开始下一轮。'], 'away-limit': ['该回到文献阅读了', '本次非论文浏览已达到设定时长。'] }[effect.kind];
      if (copy) await browser.notifications.create('brevess-focus:' + effect.id, { type: 'basic', iconUrl: browser.runtime.getURL('icons/icon128.png'), title: copy[0], message: copy[1] });
    }
    async function apply(action, stillCurrent) {
      return enqueue(async () => {
        if (stillCurrent && !await stillCurrent()) return null;
        const result = model.reduce(await read(), action, now());
        await browser.storage.local.set({ [model.STORAGE_KEY]: result.state });
        await browser.alarms.clear(ALARM);
        const due = model.deadline(result.state, now());
        if (due) await browser.alarms.create(ALARM, { when: due });
        if (result.state.active) {
          if (!await browser.alarms.get(CHECKPOINT)) await browser.alarms.create(CHECKPOINT, { periodInMinutes: 1 });
        } else await browser.alarms.clear(CHECKPOINT);
        await send({ state: result.state });
        for (const effect of result.effects) await notify(effect).catch(() => {});
        return result.state;
      });
    }
    async function preview(tab) {
      if (!tab?.id) return { type: 'unknown', reason: '没有可读取的标签页', outline: [] };
      // Extension PDF readers cannot be inspected through scripting.executeScript.
      // Their source type is authoritative; a missing HTML snapshot is not a web page.
      try {
        const url = new URL(tab.url || '');
        if (url.protocol === 'chrome-extension:' && url.host === browser.runtime.id && url.pathname === '/pdf-reader.html')
          return { type: 'paper', reason: 'PDF 文献', outline: [] };
      } catch (_) {}
      const key = tab.id + ':' + (tab.url || '');
      const cached = previews.get(tab.id);
      if (cached?.key === key && (cached.manual || now() - cached.at < 60000)) return cached.value;
      let snapshot = { readable: false };
      if (/^(https?:|file:)/i.test(tab.url || '')) {
        try {
          const results = await browser.scripting.executeScript({ target: { tabId: tab.id }, func: model.extractPageSnapshot });
          snapshot = results[0]?.result || snapshot;
        } catch (_) {}
      }
      const value = model.classify(snapshot);
      // The preview is ephemeral. It contains heading text, never persisted browsing history.
      previews.set(tab.id, { key, at: now(), value });
      while (previews.size > 12) previews.delete(previews.keys().next().value);
      return value;
    }
    async function focusedTab() {
      const win = await browser.windows.getLastFocused();
      if (!win?.focused) return null;
      return (await browser.tabs.query({ active: true, windowId: win.id }))[0] || null;
    }
    async function sync() {
      const token = ++generation;
      const tab = await focusedTab();
      if (!tab) { if ((await read()).active) await apply({ type: 'FOREGROUND', value: false }, () => token === generation); return; }
      const result = await preview(tab);
      const current = await focusedTab();
      if (token !== generation || current?.id !== tab.id || current?.url !== tab.url) return;
      if ((await read()).active) await apply({ type: 'PAGE', pageType: result.type, foreground: true }, () => token === generation);
      if (token !== generation) return;
      await send({ preview: result, tabId: tab.id, windowId: tab.windowId });
    }
    function trusted(sender) {
      return sender?.id === browser.runtime.id && !sender.tab && sender.url?.split(/[?#]/)[0] === PREFIX + 'popup.html';
    }
    async function handle(message, sender) {
      if (!trusted(sender)) throw Error('FOCUS_CALLER_DENIED');
      await queue;
      const command = message.command;
      if (command === 'READ' || command === 'CLASSIFY') {
        const tabs = await browser.tabs.query({ active: true, windowId: Number(message.windowId) });
        const tab = tabs[0];
        if (command === 'CLASSIFY' && Number(message.tabId) !== tab?.id) throw Error('FOCUS_CONTEXT_CHANGED');
        const result = await preview(tab);
        const current = (await browser.tabs.query({ active: true, windowId: Number(message.windowId) }))[0];
        if (current?.id !== tab?.id || current?.url !== tab?.url) throw Error('FOCUS_CONTEXT_CHANGED');
        return { state: model.projected(await read(), now()), preview: result, tabId: tab?.id, notifications: await browser.permissions.contains({ permissions: ['notifications'] }) };
      }
      if (command === 'START') {
        const tab = await focusedTab(), p = await preview(tab);
        const current = await focusedTab();
        if (current?.id !== tab?.id || current?.url !== tab?.url) throw Error('FOCUS_CONTEXT_CHANGED');
        return { state: await apply({ type: 'START', id: crypto.randomUUID(), pageType: p.type, mode: message.mode }) };
      }
      if (command === 'SETTINGS') return { state: await apply({ type: 'SETTINGS', settings: message.settings }) };
      if (command === 'CLASSIFY_AS') {
        if (!['paper','nonpaper','unknown'].includes(message.pageType)) throw Error('FOCUS_INVALID_PAGE_TYPE');
        const tab = await focusedTab();
        if (!tab || tab.id !== Number(message.tabId)) throw Error('FOCUS_CONTEXT_CHANGED');
        const p = await preview(tab), current = await focusedTab();
        if (current?.id !== tab.id || current?.url !== tab.url) throw Error('FOCUS_CONTEXT_CHANGED');
        const value = { ...p, type: message.pageType, reason: '由你手动确认' };
        previews.set(tab.id, { key: tab.id + ':' + tab.url, at: now(), value, manual: true });
        await apply({ type: 'PAGE', pageType: value.type, foreground: true });
        await send({ preview: value, tabId: tab.id, windowId: tab.windowId });
        return { state: await read(), preview: value, tabId: tab.id };
      }
      if (['PAUSE','RESUME','NEXT','END','CHOOSE','MODE'].includes(command)) return { state: await apply({ type: command, mode: message.mode }) };
      throw Error('FOCUS_COMMAND_UNKNOWN');
    }
    function register() {
      browser.runtime.onMessage.addListener((message, sender, respond) => {
        if(message?.type==='BREVESS_READING_SOURCE_KIND'){
          if(sender?.id!==browser.runtime.id||!sender.tab||Number(sender.frameId||0)!==0)return false;
          const originalUrl=sender.tab.url;
          preview(sender.tab).then(async value=>{const live=await browser.tabs.get(sender.tab.id);if(live.url!==originalUrl)throw Error('SOURCE_CHANGED');respond({success:true,pageType:value.type});}).catch(e=>respond({success:false,error:e.message}));return true;
        }
        if (message?.type !== 'BREVESS_READING_FOCUS') return false;
        handle(message, sender).then(data => respond({ success: true, data }), error => respond({ success: false, error: String(error.message) })); return true;
      });
      browser.alarms.onAlarm.addListener(alarm => { if ([ALARM,CHECKPOINT].includes(alarm.name)) void apply({type:'TICK'}).catch(() => {}); });
      browser.tabs.onActivated.addListener(() => { void sync().catch(() => {}); });
      browser.tabs.onUpdated.addListener((id, change, tab) => {
        if (change.url || change.status === 'complete') { previews.delete(id); if (tab.active) void sync().catch(() => {}); }
      });
      browser.tabs.onRemoved.addListener(id => { previews.delete(id); });
      browser.windows.onFocusChanged.addListener(() => { void sync().catch(() => {}); });
      // storage.session survives worker suspension but not a browser restart.
      return enqueue(async () => {
        const marker = 'brevessReadingFocusBootV1';
        const seen = await browser.storage.session.get(marker);
        if (!seen[marker]) {
          const old = await read();
          if (old.active) await browser.storage.local.set({ [model.STORAGE_KEY]: model.reduce(old, { type: 'RECOVER' }, now()).state });
          await browser.storage.session.set({ [marker]: true });
        }
      }).then(sync).catch(() => {});
    }
    return { register, handle, sync, apply, read, preview };
  }
  return { createFocusController };
});
