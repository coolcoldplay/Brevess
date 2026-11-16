(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.BrevessSharingClient = factory({ chrome: root.chrome, fetch: root.fetch.bind(root) });
})(typeof globalThis !== 'undefined' ? globalThis : this, function createSharingClient(env) {
  'use strict';
  env = env || {};
  const DEFAULT_ENDPOINT = 'http://127.0.0.1:40731';
  let session = { endpoint: DEFAULT_ENDPOINT, user: null }, token = null, memoryMaps = {}, sessionEpoch = 0;
  const bridge = env.chrome?.runtime?.sendMessage ? message => env.chrome.runtime.sendMessage(message) : null;
  const failure = (message, code, status) => Object.assign(new Error(message), { code, status });
  function endpoint(value) {
    let url; try { url = new URL(value); } catch (_) { throw failure('共享服务地址无效', 'INVALID_ENDPOINT'); }
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || !(url.protocol === 'https:' || url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) throw failure('请输入 HTTPS 服务 origin，或本机 HTTP 测试服务 origin', 'INVALID_ENDPOINT');
    return url.origin;
  }
  function unwrap(result) {
    if (!result || result.ok !== true) throw failure(result?.error?.message || '共享服务通信失败', result?.error?.code || 'UNAVAILABLE', result?.error?.status);
    return result.data;
  }
  async function getSession() {
    if (bridge) session = { endpoint: DEFAULT_ENDPOINT, ...unwrap(await bridge({ type: 'BREVESS_SHARING_SESSION_GET' })) };
    return { endpoint: session.endpoint, user: session.user || null, expiresAt: session.expiresAt };
  }
  async function configure(value) {
    const next = endpoint(value);
    if (bridge) session = { endpoint: next, ...unwrap(await bridge({ type: 'BREVESS_SHARING_CONFIG', endpoint: next })) };
    else { sessionEpoch++; session = { endpoint: next, user: null }; token = null; }
    return getSession();
  }
  async function api(path, method = 'GET', body, expectedAccount) {
    const paged = /^\/api\/(?:resources|resources\/[a-z0-9_-]+\/comments)\?limit=([1-9]\d{0,2})&offset=(0|[1-9]\d{0,6})$/i.exec(path);
    if (!/^\/api\/[a-z0-9/_-]+$/i.test(path) && !(method === 'GET' && paged && +paged[1] <= 200 && +paged[2] <= 1000000)) throw failure('接口路径无效', 'INVALID_PATH');
    if (bridge) return unwrap(await bridge({ type: 'BREVESS_SHARING_REQUEST', path, method, body, ...(expectedAccount ? { expectedAccount } : {}) }));
    if (expectedAccount && (session.endpoint !== expectedAccount.endpoint || session.user?.id !== expectedAccount.userId)) throw failure('账号或共享服务已切换，请重新打开预览。', 'ACCOUNT_CHANGED');
    const loginRequest = path === '/api/login' && method === 'POST';
    const logoutRequest = path === '/api/logout' && method === 'POST';
    const requestEndpoint = session.endpoint, requestToken = loginRequest ? null : token;
    // A login/logout starts a new identity epoch immediately. A delayed response
    // must never attach its token or payload to a later account or service origin.
    if (loginRequest || logoutRequest) { sessionEpoch++; token = null; session = { endpoint: requestEndpoint, user: null }; }
    const requestEpoch = sessionEpoch;
    const assertCurrent = () => {
      if (sessionEpoch !== requestEpoch || session.endpoint !== requestEndpoint) throw failure('账号或共享服务已变化，过期请求的结果已丢弃，请重新操作。', 'STALE_SESSION');
    };
    let response;
    try {
      response = await env.fetch(requestEndpoint + path, { method, headers: { 'Content-Type': 'application/json', ...(requestToken ? { Authorization: 'Bearer ' + requestToken } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), cache: 'no-store', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(15000) });
    } catch (_) { assertCurrent(); throw failure('无法连接共享服务；本次变更未确认生效。本机内容仍保留。', 'OFFLINE'); }
    assertCurrent();
    let value; try { value = await response.json(); } catch (_) { assertCurrent(); throw failure('共享服务返回无效响应', 'INVALID_RESPONSE'); }
    assertCurrent();
    if (!response.ok) {
      if (response.status === 401) { sessionEpoch++; token = null; session = { endpoint: requestEndpoint, user: null }; }
      throw failure(value?.error?.message || '共享操作未完成', value?.error?.code || 'REQUEST_FAILED', response.status);
    }
    if (loginRequest) {
      if (typeof value.token !== 'string' || !value.token || !value.user?.id) throw failure('共享服务返回无效登录信息', 'INVALID_RESPONSE');
      sessionEpoch++; token = value.token; session = { endpoint: requestEndpoint, user: value.user, expiresAt: value.expiresAt };
    }
    if (method === 'POST' && ['/api/account/reset-password', '/api/account/change-password', '/api/account/verify-email'].includes(path)) {
      sessionEpoch++; token = null; session = { endpoint: requestEndpoint, user: null };
    }
    if (path === '/api/me' && value?.user?.id === session.user?.id) session = { ...session, user: value.user };
    return value;
  }
  async function login(username, password) {
    const origin = session.endpoint;
    const result = await api('/api/login', 'POST', { username, password });
    if (!bridge && (session.endpoint !== origin || token !== result.token)) throw failure('登录结果已过期，请重新登录。', 'STALE_SESSION');
    return getSession();
  }
  async function logout() {
    await api('/api/logout', 'POST');
    return getSession();
  }
  async function mapKey(localKey) {
    const auth = await getSession();
    return auth.user ? JSON.stringify([auth.endpoint, auth.user.id, String(localKey)]) : null;
  }
  async function getLocalState(localKey) {
    const state = bridge ? unwrap(await bridge({ type: 'BREVESS_SHARING_MAPPING_GET', localKey })) : memoryMaps[await mapKey(localKey)];
    return state?.resourceId ? { ...state, verified: false } : { visibility: 'private', groupId: null, resourceId: null, revision: null, verified: true };
  }
  async function remember(localKey, resource, expectedAccount) {
    if (bridge) return { ...unwrap(await bridge({ type: 'BREVESS_SHARING_MAPPING_SET', localKey, resource, expectedAccount })), verified: true };
    if (session.endpoint !== expectedAccount.endpoint || session.user?.id !== expectedAccount.userId || resource.ownerId !== session.user?.id) throw failure('共享期间账号已变化，请重新核验服务结果。', 'ACCOUNT_CHANGED');
    const key = session.user ? JSON.stringify([expectedAccount.endpoint, expectedAccount.userId, String(localKey)]) : null;
    if (!key || !resource?.id || !Number.isInteger(resource.revision)) throw failure('共享服务没有返回有效版本', 'INVALID_RESPONSE');
    memoryMaps[key] = { resourceId: resource.id, revision: resource.revision, visibility: resource.visibility, groupId: resource.groupId || null, confirmedAt: Date.now() };
    return { ...memoryMaps[key], verified: true };
  }
  async function refresh(localKey) {
    const auth = await getSession();
    const state = await getLocalState(localKey);
    if (!state.resourceId) return state;
    const row = await api('/api/resources/' + encodeURIComponent(state.resourceId));
    return remember(localKey, row, { endpoint: auth.endpoint, userId: auth.user?.id });
  }
  const sourceFields = ['doi', 'url', 'documentHash', 'figureId', 'panelId', 'paragraphId', 'annotationId', 'quote', 'prefix', 'suffix', 'blockFingerprint'];
  function projectContent(input) {
    if (!['highlight_note', 'panel_note', 'hypothesis', 'figure_plan'].includes(input?.kind)) throw failure('不支持此共享内容类型', 'INVALID_RESOURCE');
    const source = {};
    for (const key of sourceFields) if (typeof input.source?.[key] === 'string' && input.source[key]) source[key] = input.source[key];
    for (const key of ['startOffset','endOffset']) if (Number.isSafeInteger(input.source?.[key]) && input.source[key] >= 0) source[key] = input.source[key];
    if (source.url) {
      try { const url = new URL(source.url); if (url.protocol !== 'https:' || url.username || url.password || /^(localhost|127\.|10\.|192\.168\.|0\.|\[)/i.test(url.hostname)) delete source.url; else { url.search = ''; url.hash = ''; source.url = url.href; } } catch (_) { delete source.url; }
    }
    const note = ['highlight_note', 'panel_note'].includes(input.kind);
    const body = note ? {} : projectBody(input.kind, input.body || {});
    const result = { kind: input.kind, title: String(input.title ?? ''), text: String(input.text ?? ''), source, body, links: Array.isArray(input.links) ? [...new Set(input.links.filter(id => typeof id === 'string' && /^res_[a-z0-9_-]+$/i.test(id)))] : [] };
    const strings = value => typeof value === 'string' ? [value] : value && typeof value === 'object' ? Object.values(value).flatMap(strings) : [];
    if (strings(result).some(value => /(?:^|[\s"'(（])(?:[a-z]:[\\/]|file:\/\/|\/(?:Users|home|private|mnt)\/)|sk-[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._-]{12,}|(?:api[_ -]?key|password|secret|token)\s*[:=]\s*[^\s"',}]{6,}/i.test(value))) throw failure('预览内容包含疑似本机路径或凭据，请在原记录中检查后重试。', 'SENSITIVE_CONTENT');
    return result;
  }
  function projection(input) {
    if (typeof input?.localKey !== 'string' || !input.localKey) throw failure('缺少稳定的来源身份，不能共享此条记录', 'INVALID_RESOURCE');
    return projectContent(input);
  }
  function projectBody(kind, body) {
    const specs = kind === 'hypothesis' ? { nodes: ['id', 'label', 'text', 'x', 'y'], edges: ['id', 'source', 'target', 'label', 'text', 'kind'] } : { panels: ['id', 'label', 'text', 'figureId', 'x', 'y', 'w', 'h'], evidenceBlocks: ['id', 'title', 'summary', 'panelIds'] };
    const output = {};
    for (const [list, fields] of Object.entries(specs)) {
      output[list] = (Array.isArray(body[list]) ? body[list] : []).map(row => {
        const value = {};
        for (const field of fields) {
          if (field === 'panelIds' && Array.isArray(row[field])) value[field] = row[field].filter(id => typeof id === 'string');
          else if (typeof row[field] === 'string' || typeof row[field] === 'number' && Number.isFinite(row[field])) value[field] = row[field];
        }
        return value;
      });
    }
    return output;
  }
  async function save(input, visibility, groupId, reviewedState) {
    if (!['private', 'group', 'public'].includes(visibility) || visibility === 'public' && !['highlight_note', 'panel_note'].includes(input.kind)) throw failure('此类型不支持所选可见性', 'INVALID_VISIBILITY');
    const auth = await getSession();
    if (reviewedState?.account && (auth.endpoint !== reviewedState.account.endpoint || auth.user?.id !== reviewedState.account.userId)) throw failure('账号或共享服务已切换，请重新打开预览。', 'ACCOUNT_CHANGED');
    const current = await getLocalState(input.localKey);
    if (reviewedState && (current.resourceId !== reviewedState.resourceId || current.revision !== reviewedState.revision)) throw failure('可见性已在其他窗口更改，请重新打开预览', 'STALE_PREVIEW', 409);
    if (visibility === 'private' && !current.resourceId) return { status: 'saved', localOnly: true, visibility: 'private' };
    if (!auth.user) throw failure('请先登录共享账号', 'LOGIN_REQUIRED', 401);
    if (visibility === 'group' && !groupId) throw failure('请选择课题组', 'GROUP_REQUIRED');
    const payload = visibility === 'private' ? { visibility, groupId: null } : { ...projection(input), visibility, groupId: visibility === 'group' ? groupId : null };
    if (current.resourceId) payload.expectedRevision = current.revision;
    const account = { endpoint: auth.endpoint, userId: auth.user.id };
    const row = await api(current.resourceId ? '/api/resources/' + encodeURIComponent(current.resourceId) : '/api/resources', current.resourceId ? 'PATCH' : 'POST', payload, account);
    try { await remember(input.localKey, row, account); }
    catch (_) { throw failure('服务已处理此操作，但本机共享映射未能确认。请在原账号的共享中心核验结果，勿重复发布。', 'SERVER_SAVED_MAPPING_FAILED'); }
    return { status: 'saved', resource: row };
  }
  async function publishedLinks(localKeys) {
    const ids = [];
    for (const key of [...new Set(localKeys)]) {
      const state = await getLocalState(key);
      if (state.resourceId && state.visibility !== 'private') {
        try { const row = await api('/api/resources/' + encodeURIComponent(state.resourceId)); if (row.visibility !== 'private') ids.push(row.id); } catch (error) { if (![403, 404].includes(error.status)) throw error; }
      }
    }
    return ids;
  }
  function matchesSourceAnchor(target, candidate) {
    const canonicalHash = value => typeof value === 'string' && /^(?:sha256:)?[a-f0-9]{64}$/i.test(value) ? value.replace(/^sha256:/i, '').toLowerCase() : null;
    const targetHash = canonicalHash(target?.documentHash);
    if (!targetHash || targetHash !== canonicalHash(candidate?.documentHash)) return false;
    for (const key of ['figureId','panelId','paragraphId','blockFingerprint']) if (target[key] && target[key] !== candidate[key]) return false;
    const normalize = value => String(value || '').replace(/\s+/gu, ' ').trim();
    if (target.quote && normalize(target.quote) !== normalize(candidate.quote)) return false;
    for (const key of ['startOffset','endOffset']) if (Number.isSafeInteger(target[key]) && target[key] !== candidate[key]) return false;
    return true;
  }
  function comments(resourceId, expectedAccount, groupId, sort = 'newest', pagination) {
    if (!['likes','newest','oldest'].includes(sort)) throw failure('请选择有效排序方式。', 'INVALID_SORT');
    const path = '/api/resources/' + encodeURIComponent(resourceId) + '/comments';
    return groupId || sort !== 'newest' || pagination ? api(path + '/query', 'POST', { ...(groupId ? { groupId } : {}), ...(sort !== 'newest' ? { sort } : {}), ...(pagination ? { limit: pagination.limit, offset: pagination.offset } : {}) }, expectedAccount) : api(path, 'GET', undefined, expectedAccount);
  }
  function addComment(resourceId, text, expectedRevision, expectedAccount) {
    if (typeof text !== 'string' || !text.trim() || text.length > 4000) throw failure('评论需为 1–4000 字符，不能只有空白。', 'INVALID_COMMENT');
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) throw failure('原备注版本未确认，请刷新后评论。', 'INVALID_REVISION');
    return api('/api/resources/' + encodeURIComponent(resourceId) + '/comments', 'POST', { text, expectedRevision }, expectedAccount);
  }
  function deleteComment(resourceId, commentId, expectedAccount) {
    return api('/api/resources/' + encodeURIComponent(resourceId) + '/comments/' + encodeURIComponent(commentId), 'DELETE', undefined, expectedAccount);
  }
  function startPanelDiscussion(input, text, visibility, groupId, expectedAccount) {
    if (input?.kind !== 'panel_note' || !input.source?.documentHash || !input.source?.figureId || !input.source?.panelId) throw failure('当前 Panel 来源未确认，请重新打开评论入口。', 'INVALID_PANEL_SOURCE');
    if (typeof text !== 'string' || !text.trim() || text.length > 4000) throw failure('首条评论需为 1–4000 字符，不能只有空白。', 'INVALID_COMMENT');
    if (!expectedAccount?.userId) throw failure('请先登录后发表评论。', 'LOGIN_REQUIRED');
    if (!['public','group'].includes(visibility) || visibility === 'group' && !groupId) throw failure('请明确选择公开或一个课题组。', 'INVALID_VISIBILITY');
    // The online discussion is a new resource; it never changes Panel.note or a local sidecar.
    const payload = projectContent({ kind: 'panel_note', title: input.title || 'Panel 讨论', text, source: { documentHash: input.source.documentHash, figureId: input.source.figureId, panelId: input.source.panelId }, body: {}, links: [] });
    return api('/api/resources', 'POST', { ...payload, visibility, groupId: visibility === 'group' ? groupId : null }, expectedAccount);
  }
  function withdrawPanelDiscussion(resource, expectedAccount) {
    if (resource?.kind !== 'panel_note' || !resource.canEdit || resource.ownerId !== expectedAccount?.userId) throw failure('只有作者可以撤回这条讨论。', 'FORBIDDEN');
    if (!Number.isInteger(resource.revision) || resource.revision < 1) throw failure('讨论版本未确认，请刷新后再操作。', 'INVALID_REVISION');
    return api('/api/resources/' + encodeURIComponent(resource.id), 'PATCH', { visibility: 'private', groupId: null, expectedRevision: resource.revision }, expectedAccount);
  }
  async function setLike(resourceId, commentId, liked, expectedAccount) {
    if (typeof liked !== 'boolean' || !expectedAccount?.userId) throw failure('请登录后点赞。', 'LOGIN_REQUIRED');
    const path='/api/resources/'+encodeURIComponent(resourceId)+(commentId?'/comments/'+encodeURIComponent(commentId):'')+'/like';
    const response=await api(path,liked?'POST':'DELETE',{},expectedAccount);
    if(!Number.isSafeInteger(response?.likeCount)||response.likeCount<0||typeof response.likedByMe!=='boolean')throw failure('服务未返回有效点赞确认，请刷新后查看。','INVALID_RESPONSE');
    return response;
  }
  return Object.freeze({ api, login, logout, configure, getSession, getLocalState, refresh, projection, save, publishedLinks, matchesSourceAnchor, comments, addComment, deleteComment, startPanelDiscussion, withdrawPanelDiscussion, setLike, DEFAULT_ENDPOINT });
});
