(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BrevessSharingBackground = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const KEY = 'brevessSharingSessionV1';
  const MAP_KEY = 'brevessSharingMappingsV1';
  const DEFAULT_ENDPOINT = 'http://127.0.0.1:40731';
  const fail = (code, message) => Object.assign(new Error(message || code), { code });
  function endpoint(value) {
    let url; try { url = new URL(value); } catch { throw fail('INVALID_ENDPOINT'); }
    if (url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) throw fail('INVALID_ENDPOINT');
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw fail('HTTPS_REQUIRED');
    return url.origin;
  }
  function createBridge({ chromeApi, fetchImpl = fetch, now = Date.now }) {
    let serial = Promise.resolve();
    const metadata = s => ({ endpoint: s.endpoint || DEFAULT_ENDPOINT, user: s.user || null, expiresAt: s.expiresAt || null });
    const read = async () => (await chromeApi.storage.session.get(KEY))[KEY] || { endpoint: DEFAULT_ENDPOINT };
    const save = s => chromeApi.storage.session.set({ [KEY]: s });
    const notifySessionChange = async () => {
      // Extension pages/side panels receive runtime broadcasts; publisher-page
      // content scripts receive the tab message below. Neither carries identity.
      try { if (chromeApi.runtime.sendMessage) void Promise.resolve(chromeApi.runtime.sendMessage({ type: 'BREVESS_SHARING_SESSION_CHANGED' })).catch(() => {}); } catch (_) {}
      if (!chromeApi.tabs?.query || !chromeApi.tabs?.sendMessage) return;
      try {
        const tabs = await chromeApi.tabs.query({});
        // Dispatch without waiting for a tab to acknowledge; a tab may itself
        // request fresh session metadata and must not deadlock this serial queue.
        void Promise.allSettled(tabs.filter(tab => Number.isInteger(tab.id)).map(tab => chromeApi.tabs.sendMessage(tab.id, { type: 'BREVESS_SHARING_SESSION_CHANGED' })));
      } catch (_) { /* Closed/restricted tabs have no content receiver. */ }
    };
    const trusted = sender => sender?.id === chromeApi.runtime.id && (sender.frameId === undefined || sender.frameId === 0);
    const extensionPage = sender => {
      try { return trusted(sender) && new URL(sender.url).origin === new URL(chromeApi.runtime.getURL('/')).origin && sender.url.startsWith(chromeApi.runtime.getURL('')); } catch { return false; }
    };
    async function execute(message, sender) {
      if (!trusted(sender)) throw fail('UNTRUSTED_SENDER');
      const session = await read();
      if (message.type === 'BREVESS_SHARING_SESSION_GET') return metadata(session);
      if (['BREVESS_SHARING_MAPPING_GET', 'BREVESS_SHARING_MAPPING_SET'].includes(message.type)) {
        if (typeof message.localKey !== 'string' || !message.localKey || message.localKey.length > 4000) throw fail('INVALID_LOCAL_IDENTITY');
        if (!session.user) {
          if (message.type === 'BREVESS_SHARING_MAPPING_SET') throw fail('LOGIN_REQUIRED');
          return { visibility: 'private', groupId: null, resourceId: null, revision: null, verified: true };
        }
        const account = { endpoint: session.endpoint || DEFAULT_ENDPOINT, userId: session.user.id };
        const key = JSON.stringify([account.endpoint, account.userId, message.localKey]);
        const maps = (await chromeApi.storage.local.get(MAP_KEY))[MAP_KEY] || {};
        if (message.type === 'BREVESS_SHARING_MAPPING_GET') return maps[key] ? { ...maps[key], verified: false } : { visibility: 'private', groupId: null, resourceId: null, revision: null, verified: true };
        if (message.expectedAccount?.endpoint !== account.endpoint || message.expectedAccount?.userId !== account.userId) throw fail('ACCOUNT_CHANGED');
        const resource = message.resource;
        if (resource?.ownerId !== account.userId || !/^res_[A-Za-z0-9_-]+$/.test(resource.id || '') || !Number.isInteger(resource.revision) || resource.revision < 1 || !['private', 'group', 'public'].includes(resource.visibility)) throw fail('INVALID_MAPPING');
        if (maps[key]?.resourceId === resource.id && maps[key].revision > resource.revision) throw fail('STALE_MAPPING');
        maps[key] = { resourceId: resource.id, revision: resource.revision, visibility: resource.visibility, groupId: resource.groupId || null, confirmedAt: now() };
        await chromeApi.storage.local.set({ [MAP_KEY]: maps });
        return { ...maps[key], verified: true };
      }
      if (message.type === 'BREVESS_SHARING_CONFIG') {
        if (!extensionPage(sender)) throw fail('EXTENSION_PAGE_REQUIRED');
        const next = { endpoint: endpoint(message.endpoint) };
        await save(next); await notifySessionChange(); return metadata(next);
      }
      if (message.type !== 'BREVESS_SHARING_REQUEST') throw fail('INVALID_REQUEST');
      const method = message.method || 'GET';
      const path = message.path;
      const adminRoute = method === 'POST' && /^\/api\/admin\/(?:users\/(?:query|change)|content\/query|moderate|audit\/query|groups\/query)$/.test(path) && extensionPage(sender) && sender.url === chromeApi.runtime.getURL('sharing/admin.html');
      const accountRoute = typeof path === 'string' && /^\/api\/account\/(?:verify-email|resend-verification|forgot-password|reset-password|change-password|set-email)$/.test(path);
      const paged = typeof path === 'string' && /^\/api\/(?:resources|resources\/[A-Za-z0-9_-]+\/comments)\?limit=([1-9]\d{0,2})&offset=(0|[1-9]\d{0,6})$/.exec(path);
      if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(method) || typeof path !== 'string' || !(adminRoute || accountRoute && method === 'POST' || paged && method === 'GET' && +paged[1] <= 200 && +paged[2] <= 1000000 || /^\/api\/(?:health|register|login|logout|me|groups|resources|invitations|discover)(?:\/[A-Za-z0-9_-]+)*$/.test(path))) throw fail('INVALID_REQUEST');
      if ((accountRoute || ['/api/register', '/api/login'].includes(path) || path.startsWith('/api/groups') && method !== 'GET' || path.startsWith('/api/invitations') && method !== 'GET') && !extensionPage(sender)) throw fail('EXTENSION_PAGE_REQUIRED');
      if (message.expectedAccount && (message.expectedAccount.endpoint !== (session.endpoint || DEFAULT_ENDPOINT) || message.expectedAccount.userId !== session.user?.id)) throw fail('ACCOUNT_CHANGED');
      const body = message.body === undefined ? undefined : JSON.stringify(message.body);
      if (body && body.length > 240000) throw fail('REQUEST_TOO_LARGE');
      const target = endpoint(session.endpoint || DEFAULT_ENDPOINT) + path;
      // Clear local credentials even if remote token revocation cannot be confirmed offline.
      if (path === '/api/logout' && method === 'POST') { await save({ endpoint: session.endpoint || DEFAULT_ENDPOINT }); await notifySessionChange(); }
      const headers = { Accept: 'application/json' };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (session.token) headers.Authorization = `Bearer ${session.token}`;
      let response;
      try { response = await fetchImpl(target, { method, headers, body, cache: 'no-store', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(15000) }); }
      catch { throw fail('SHARING_UNAVAILABLE', '共享服务不可用；本次修改未确认生效。'); }
      let data; try { data = await response.json(); } catch { throw fail('INVALID_RESPONSE'); }
      if (!response.ok) {
        if (response.status === 401 && path !== '/api/login') { await save({ endpoint: session.endpoint || DEFAULT_ENDPOINT }); await notifySessionChange(); }
        throw Object.assign(fail(data?.error?.code || `HTTP_${response.status}`, data?.error?.message || '共享请求失败'), { status: response.status });
      }
      if (path === '/api/login' && method === 'POST') {
        if (!data.token || !data.user?.id) throw fail('INVALID_RESPONSE');
        await save({ endpoint: session.endpoint || DEFAULT_ENDPOINT, token: data.token, user: data.user, expiresAt: data.expiresAt });
        await notifySessionChange();
        return { user: data.user, expiresAt: data.expiresAt };
      }
      if (path === '/api/logout' && method === 'POST') await save({ endpoint: session.endpoint || DEFAULT_ENDPOINT });
      if (method === 'POST' && ['/api/account/reset-password', '/api/account/change-password', '/api/account/verify-email'].includes(path)) { await save({ endpoint: session.endpoint || DEFAULT_ENDPOINT }); await notifySessionChange(); }
      if (path === '/api/me' && data?.user?.id === session.user?.id) await save({ ...session, user: data.user });
      return data;
    }
    async function handle(message, sender) {
      // Serialize configuration/session transitions to prevent a late request from reviving an old account.
      const task = serial.then(() => execute(message, sender));
      serial = task.catch(() => {});
      try { return { ok: true, data: await task }; }
      catch (error) { return { ok: false, error: { code: error.code || 'SHARING_FAILED', message: error.message || '共享请求失败', status: error.status } }; }
    }
    return { handle };
  }
  function install(chromeApi) {
    const bridge = createBridge({ chromeApi });
    chromeApi.runtime.onMessage.addListener((message, sender, respond) => {
      if (!['BREVESS_SHARING_REQUEST', 'BREVESS_SHARING_SESSION_GET', 'BREVESS_SHARING_CONFIG', 'BREVESS_SHARING_MAPPING_GET', 'BREVESS_SHARING_MAPPING_SET'].includes(message?.type)) return false;
      bridge.handle(message, sender).then(respond); return true;
    });
    return bridge;
  }
  return { createBridge, endpoint, install };
});
