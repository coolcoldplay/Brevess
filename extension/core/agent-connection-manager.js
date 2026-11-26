// One authenticated poller per browser. Use the library host when no unique
// workbench can supply a project and its approval UI.
(function (root) {
  'use strict';
  const CONFIG = 'brevess-mcp-bridge-v1', PAUSED = 'brevess-mcp-paused-v1';
  const TYPE = 'BREVESS_AGENT_MANAGER', PORT = 'brevess-agent-module-v1';
  const states = new Set(['connected', 'connecting', 'offline', 'unauthorized', 'incompatible', 'unpaired']);
  const failure = code => Object.assign(new Error(code), {code});
  function createAgentConnectionManager(api, {timeoutMs = 45000, libraryHost} = {}) {
    const modules = new Map(), local = api.storage.local;
    let owner = null, sequence = 0, tail = Promise.resolve(), stopping = false;
    function path(sender) {
      try {
        const url = new URL(sender?.url || ''), own = new URL(api.runtime.getURL(''));
        return sender.id === api.runtime.id && url.protocol === own.protocol && url.host === own.host ? url.pathname : null;
      } catch { return null; }
    }
    const clean = value => ({state: states.has(value?.state) ? value.state : 'unknown',
      activeRequests: Array.isArray(value?.activeRequests) ? value.activeRequests.length : 0});
    const fallback = libraryHost && {command: action => libraryHost.command(action), get status() { return clean(libraryHost.status()); }};
    const stored = () => local.get([CONFIG, PAUSED]);
    const candidate = () => modules.size === 1 ? modules.values().next().value : fallback;
    function enqueue(operation) {
      const result = tail.then(operation);
      tail = result.catch(() => {});
      return result;
    }
    async function status() {
      const data = await stored(), configured = !!data[CONFIG], paused = data[PAUSED] === true;
      const current = owner?.status;
      const stopUnconfirmed = paused && owner && (['connected','connecting','unknown'].includes(current.state) || current.activeRequests > 0);
      const state = stopping ? 'disconnecting' : !configured ? 'unpaired' : stopUnconfirmed ? 'error' : paused ? 'paused'
        : current && current.state !== 'unknown' && current.state !== 'unpaired' ? current.state : 'waiting';
      return {state, configured, paused, modules: modules.size, host: owner ? owner === fallback ? 'library' : 'workbench' : null,
        activeRequests: current?.activeRequests || 0};
    }
    async function relinquish() {
      if (!owner) return;
      const old = owner;
      await old.command('disconnect');
      owner = null;
    }
    async function reconcile({probe = false, retry = false} = {}) {
      const data = await stored(), next = data[CONFIG] && !data[PAUSED] ? candidate() : null;
      if (owner !== next) {
        await relinquish();
        if (!next || next !== candidate()) return;
        owner = next;
        await next.command('connect');
      } else if (owner && (retry || probe)) {
        const state = owner.status.state;
        if (state === 'connected') { if (probe) await owner.command('check'); }
        else if (state !== 'connecting') await owner.command('connect');
      }
    }
    function normalize(config) {
      let url;
      try { url = new URL(config?.server); } catch { throw failure('MCP_BRIDGE_CONFIG_INVALID'); }
      if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.username || url.password ||
          url.pathname !== '/' || url.search || url.hash || typeof config.token !== 'string' || !config.token || config.token.length > 512 ||
          /[\s\u0000-\u001f]/u.test(config.token)) throw failure('MCP_BRIDGE_CONFIG_INVALID');
      return {server: url.origin, token: config.token};
    }
    async function handle(message, sender) {
      if (message?.type !== TYPE) return undefined;
      if (!path(sender)) throw failure('AGENT_MANAGER_FORBIDDEN');
      const action = message.action;
      if (action === 'status') return status();
      if (path(sender) !== '/options.html') throw failure('AGENT_MANAGER_FORBIDDEN');
      if (!['pair', 'check', 'resume', 'disconnect', 'forget'].includes(action)) throw failure('AGENT_MANAGER_ACTION_INVALID');
      const config = action === 'pair' && normalize(message.config);
      return enqueue(async () => {
        if (action === 'disconnect' || action === 'forget') {
          stopping = true;
          try {
            await local.set({[PAUSED]: true});
            await relinquish();
            if (action === 'forget') await local.remove(CONFIG);
          } finally { stopping = false; }
        } else {
          if (config) {
            const before = (await stored())[CONFIG];
            if (before?.server !== config.server || before?.token !== config.token) await relinquish();
            await local.set({[CONFIG]: config, [PAUSED]: false});
          } else if (action === 'resume') await local.set({[PAUSED]: false});
          await reconcile({probe: action === 'check', retry: true});
        }
        return status();
      });
    }
    function onConnect(port) {
      if (port?.name !== PORT) return false;
      if (path(port.sender) !== '/workbench/index.html') { port.disconnect(); return true; }
      const pending = new Map();
      const module = {status: clean(null), command(action) {
        if (!modules.has(port)) return action === 'disconnect' ? Promise.resolve() : Promise.reject(failure('AGENT_MODULE_CLOSED'));
        return new Promise((resolve, reject) => {
          const id = 'manager-' + (++sequence);
          const end = (fn, value) => { clearTimeout(timer); pending.delete(id); fn(value); };
          const timer = setTimeout(() => end(reject, failure('AGENT_MANAGER_TIMEOUT')), timeoutMs);
          pending.set(id, {action, finish(ok) { ok ? end(resolve) : end(reject, failure('AGENT_CONNECTION_FAILED')); }});
          try { port.postMessage({type:'command', id, action}); } catch { end(reject, failure('AGENT_MODULE_CLOSED')); }
        });
      }};
      modules.set(port, module);
      port.onMessage.addListener(message => {
        if (message?.type === 'status') module.status = clean(message.status);
        if (message?.type !== 'receipt' || !pending.has(message.id)) return;
        const item = pending.get(message.id);
        module.status = clean(message.status);
        const stopped = !['connected', 'connecting', 'unknown'].includes(module.status.state) && !module.status.activeRequests;
        item.finish(message.ok === true && (item.action !== 'disconnect' || stopped));
      });
      port.onDisconnect.addListener(() => {
        modules.delete(port);
        for (const item of [...pending.values()]) item.finish(item.action === 'disconnect');
        void enqueue(reconcile).catch(() => {});
      });
      void enqueue(reconcile).catch(() => {});
      return true;
    }
    function onMessage(message, sender, respond) {
      if (message?.type !== TYPE) return false;
      handle(message, sender).then(data => respond({success:true, data}), error => respond({success:false, error:{code:error.code || 'AGENT_CONNECTION_FAILED'}}));
      return true;
    }
    return {handle, status, onConnect, onMessage, restore: () => enqueue(reconcile)};
  }
  const exported = {createAgentConnectionManager, AGENT_MANAGER_MESSAGE_TYPE: TYPE};
  Object.assign(root.SciLLM ||= {}, exported);
  if (typeof module === 'object' && module.exports) module.exports = exported;
})(globalThis);
