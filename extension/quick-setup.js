/* Uses options.html's existing credential boundary and the normal directory store. */
(function (root) {
  'use strict';
  const quickRoute = () => ['#quick-setup', '#onboarding'].includes(location.hash);
  const riskKey = 'brevessAiPrivacyAcknowledgementV1';
  const validRisk = value => value?.version === 1 && value.acknowledged === true &&
    Number.isSafeInteger(value.updatedAt) && value.updatedAt > 0;
  async function call(message) {
    const result = await chrome.runtime.sendMessage(message);
    if (!result?.success) throw Object.assign(new Error(result?.error?.message || '操作未完成，请重试。'), result?.error);
    return result.data;
  }
  root.BrevessQuickSetup = {
    isRoute: quickRoute,
    open: () => call({ type: 'QUICK_SETUP_OPEN' }),
    async maybeOpen() {
      const state = await call({ type: 'ONBOARDING_GET' });
      // Only the first settings visit prompts automatically. Closing the window
      // leaves its always-visible navigation entry available without nagging.
      if (!state.acknowledged && !state.startedAt) return this.open();
      return { opened: false };
    }
  };
  if (!quickRoute()) return;
  document.documentElement.classList.add('quick-setup-window');
  document.addEventListener('DOMContentLoaded', mount, { once: true });

  async function mount() {
    document.title = 'BREVESS · 快速配置';
    const host = document.createElement('main');
    host.id = 'quickSetup';
    host.innerHTML = `
      <header class="qs-brand"><img src="icons/icon128.png" alt=""><span>BREVESS</span></header>
      <form id="qsForm">
        <h1>准备好，开始阅读。</h1>
        <p class="qs-intro">保存位置与 AI 连接，在这里一次设好。</p>
        <section class="qs-section" aria-labelledby="qsFolderTitle">
          <div class="qs-heading"><span class="qs-number" aria-hidden="true">1</span><h2 id="qsFolderTitle">保存到哪里</h2></div>
          <div class="qs-directory"><div><p id="qsDirectoryName">尚未选择文件夹</p><p class="qs-hint" id="qsDirectoryHint">论文、笔记与课题保存在此处。</p></div><div class="qs-directory-actions"><button id="qsChooseDirectory" type="button" class="qs-secondary">选择文件夹</button><button id="qsOtherDirectory" type="button" class="qs-text" hidden>另选文件夹</button></div></div>
        </section>
        <section class="qs-section" aria-labelledby="qsApiTitle">
          <div class="qs-heading"><span class="qs-number" aria-hidden="true">2</span><h2 id="qsApiTitle">全局默认 AI</h2></div>
          <div class="qs-fields">
            <label class="qs-field">服务商<span class="qs-provider"><img id="qsProviderIcon" alt="" hidden><select id="qsProvider" aria-label="服务商" disabled></select></span></label>
            <label class="qs-field">模型<input id="qsModel" class="qs-input" list="qsModels" required autocomplete="off" spellcheck="false" placeholder="选择或输入模型名称"><datalist id="qsModels"></datalist></label>
            <label class="qs-field qs-wide" id="qsEndpointField" hidden>API 地址<input id="qsEndpoint" class="qs-input" type="url" placeholder="https://api.example.com/v1" autocomplete="off" spellcheck="false"></label>
            <label class="qs-field qs-wide">API Key<span class="qs-key"><input id="qsKey" class="qs-input" type="password" autocomplete="off" spellcheck="false" placeholder="粘贴 API Key"><button id="qsToggleKey" type="button" aria-label="显示 API Key" aria-pressed="false">显示</button></span></label>
          </div>
          <p class="qs-hint qs-destination" id="qsDestination"></p>
        </section>
        <section class="qs-section" aria-labelledby="qsPrivacyTitle">
          <div class="qs-heading"><span class="qs-number" aria-hidden="true">3</span><h2 id="qsPrivacyTitle">确认隐私风险</h2></div>
          <label class="qs-consent"><input id="qsConsent" type="checkbox" required><span>我已了解下方隐私风险；允许在调用 AI 时，将相关正文、图注与图片发送给我选择的服务商。</span></label>
          <details><summary>隐私风险与责任声明</summary>
            <p>请勿在含有敏感数据的网页或课题工作台调用 AI 功能。调用时，相关数据将上传至所选大模型服务提供商，存在隐私泄露风险。</p>
            <p>API Key 保存在本机扩展存储中；测试与调用时会发送至你选择的服务，包括自定义代理。插件不另行向作者服务器上传密钥。含凭据的迁移文件请勿公开分享。</p>
            <p>我已了解上述风险，并承诺不提交敏感数据；因本人提交敏感数据而导致的信息泄露及相关后果由本人自行承担，与作者无关。</p>
          </details>
        </section>
        <p id="qsStatus" class="qs-status" role="status" aria-live="polite">正在读取配置…</p>
        <footer class="qs-footer"><button id="qsLater" type="button" class="qs-text">暂不配置，先手动阅读</button><button id="qsSubmit" type="submit" class="qs-primary" disabled>测试连接并完成</button></footer>
      </form>
      <section id="qsSuccess" class="qs-success" hidden aria-labelledby="qsSuccessTitle">
        <div class="qs-check" aria-hidden="true">✓</div><h1 id="qsSuccessTitle">可以开始了。</h1><p class="qs-intro">配置已保存，之后可随时在设置中修改。</p>
        <dl class="qs-summary"><div><dt>保存位置</dt><dd id="qsSavedFolder"></dd></div><div><dt>默认模型</dt><dd id="qsSavedModel"></dd></div></dl>
        <p class="qs-hint">支持的 AI 功能将使用此连接；各功能仍可单独指定模型。AI 任务由你发起。</p>
        <p id="qsFinishStatus" class="qs-status" role="status" aria-live="polite"></p>
        <footer class="qs-footer"><button id="qsFullSettings" class="qs-text" type="button">查看完整设置</button><button id="qsStart" class="qs-primary" type="button">开始使用</button></footer>
      </section>`;
    document.body.append(host);
    const $ = id => document.getElementById(id);
    let busy = false, ready = false, directory = null, directoryReady = false;
    let settings, choices = [], selected = '', sourceTab = {}, prepared = false;
    let profileId = '', existing = null;
    const drafts = new Map();
    const notice = (text, tone = '') => { $('qsStatus').textContent = text; $('qsStatus').dataset.tone = tone; };
    function setBusy(value) {
      busy = value;
      host.querySelectorAll('#qsForm button, #qsForm input, #qsForm select').forEach(el => { el.disabled = value || !ready; });
      $('qsSubmit').textContent = value ? '正在处理…' : '测试连接并完成';
      $('qsForm').setAttribute('aria-busy', String(value));
    }
    function renderDirectory() {
      $('qsDirectoryName').textContent = directory?.name || '尚未选择文件夹';
      $('qsDirectoryName').title = directory?.name || '';
      $('qsDirectoryHint').textContent = directoryReady ? '已授权 · 文件保存到此目录的 Brevess 文件夹' : directory ? '需要重新授权此文件夹的读写权限。' : '论文、笔记与课题保存在此处。';
      $('qsChooseDirectory').textContent = directoryReady ? '更改' : directory ? '授权文件夹' : '选择文件夹';
      $('qsOtherDirectory').hidden = !directory || directoryReady;
    }
    function choice() { return choices.find(item => item.id === $('qsProvider').value); }
    function rememberDraft() {
      if (selected) drafts.set(selected, { model: $('qsModel').value, key: $('qsKey').value, endpoint: $('qsEndpoint').value, profileId, existing });
    }
    function renderProvider() {
      const item = choice(); if (!item) return;
      selected = item.id;
      const draft = drafts.get(selected);
      existing = draft?.existing || null;
      profileId = draft?.profileId || `profile_setup_${crypto.randomUUID().replaceAll('-', '_')}`;
      $('qsModel').value = draft?.model ?? item.defaultModel;
      $('qsKey').value = draft?.key || '';
      $('qsKey').type = 'password'; $('qsToggleKey').textContent = '显示'; $('qsToggleKey').setAttribute('aria-pressed', 'false'); $('qsToggleKey').setAttribute('aria-label', '显示 API Key');
      $('qsKey').placeholder = existing?.config?.hasApiKey ? '已保存密钥；留空继续使用' : '粘贴 API Key';
      $('qsKey').required = !existing?.config?.hasApiKey;
      $('qsEndpoint').value = draft?.endpoint ?? item.baseUrl ?? '';
      // A previously customized endpoint stays visible, never disguised as official.
      $('qsEndpointField').hidden = !item.custom && !(existing?.config?.baseUrl);
      $('qsEndpoint').required = item.custom;
      $('qsModels').replaceChildren(...(item.models || []).map(model => new Option(model, model)));
      const brand = root.SciLLM.getProviderBrand({ providerId: item.providerId, config: item.config || {} });
      $('qsProviderIcon').hidden = !brand;
      if (brand) $('qsProviderIcon').src = brand.src;
      updateDestination();
    }
    function updateDestination() {
      const item = choice(); if (!item) return;
      const endpoint = $('qsEndpoint').value.trim() || item.host;
      let destination = endpoint;
      try { destination = new URL(endpoint).host; } catch (_) {}
      $('qsDestination').textContent = `连接至 ${destination || '你填写的 API 地址'} · 测试仅发送合成文本`;
    }
    async function saveRisk() {
      const commit = () => chrome.storage.local.set({ [riskKey]: { version: 1, acknowledged: true, updatedAt: Date.now() } });
      if (navigator.locks) await navigator.locks.request(riskKey, commit); else await commit();
    }
    async function progress(storageStatus, apiStatus) {
      await call({ type: 'ONBOARDING_SET_STEP', step: 'storage', status: storageStatus });
      const state = await call({ type: 'ONBOARDING_SET_STEP', step: 'api', status: apiStatus });
      sourceTab = state.sourceTab || {};
    }
    $('qsProvider').addEventListener('change', () => { rememberDraft(); renderProvider(); notice(''); });
    $('qsEndpoint').addEventListener('input', () => {
      // A saved key belongs to its saved destination. Changing that destination
      // requires explicit key entry, not silently forwarding the old credential.
      const changed = existing?.config?.hasApiKey && $('qsEndpoint').value.trim() !== String(existing.config.baseUrl || '').trim();
      $('qsKey').required = Boolean(changed || !existing?.config?.hasApiKey);
      $('qsKey').placeholder = changed ? '地址已更改，请重新填写对应密钥' : existing?.config?.hasApiKey ? '已保存密钥；留空继续使用' : '粘贴 API Key';
      updateDestination();
    });
    $('qsToggleKey').addEventListener('click', () => {
      const show = $('qsKey').type === 'password'; $('qsKey').type = show ? 'text' : 'password';
      $('qsToggleKey').textContent = show ? '隐藏' : '显示'; $('qsToggleKey').setAttribute('aria-pressed', String(show)); $('qsToggleKey').setAttribute('aria-label', show ? '隐藏 API Key' : '显示 API Key');
    });
    async function chooseDirectory(forcePicker = false) {
      if (busy) return;
      if (!window.showDirectoryPicker) { notice('此浏览器不支持文件夹授权，请使用最新版 Chrome 或 Edge。', 'error'); return; }
      setBusy(true); notice('请选择用于保存 BREVESS 资料的文件夹。');
      try {
        let handle = directory;
        if (handle && !directoryReady && !forcePicker) {
          if (await handle.requestPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('未获得读写权限，请重试或选择其他文件夹。');
        } else handle = await window.showDirectoryPicker({ id: 'sci-highlighter-user-data', mode: 'readwrite', startIn: 'documents' });
        await root.SciLLM.saveDirectoryHandle(indexedDB, handle);
        directory = handle;
        const result = await call({ type: 'USER_DATA_SYNC_NOW', drain: true });
        directoryReady = result.permission === 'granted' && !result.failed && !result.pendingCount;
        if (!directoryReady) throw new Error('文件夹已选择，但写入尚未完成。请检查权限后重试。');
        await call({ type: 'ONBOARDING_SET_STEP', step: 'storage', status: 'completed' });
        notice('文件夹已就绪。', 'success');
      } catch (error) {
        notice(error.name === 'AbortError' ? '已取消选择，原有保存位置未改变。' : error.message, error.name === 'AbortError' ? '' : 'error');
      } finally { renderDirectory(); setBusy(false); }
    }
    $('qsChooseDirectory').addEventListener('click', () => chooseDirectory());
    $('qsOtherDirectory').addEventListener('click', () => chooseDirectory(true));
    $('qsForm').addEventListener('submit', async event => {
      event.preventDefault(); if (busy || !ready) return;
      if (!directoryReady) { notice('请先选择并授权保存文件夹。', 'error'); $('qsChooseDirectory').focus(); return; }
      if (!$('qsConsent').checked) { $('qsConsent').focus(); return; }
      const item = choice();
      const config = { ...(item.config || {}), model: $('qsModel').value.trim(), apiKey: $('qsKey').value.trim() };
      const endpoint = $('qsEndpoint').value.trim();
      if (endpoint) config.baseUrl = endpoint;
      if (endpoint) {
        let url; try { url = new URL(endpoint); } catch (_) {}
        if (!url || url.username || url.password || url.search || url.hash || !(url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
          notice('API 地址请使用 HTTPS；本机接口可使用 localhost 或 127.0.0.1。地址不能包含密钥或查询参数。', 'error'); $('qsEndpoint').focus(); return;
        }
      }
      setBusy(true); notice('正在测试连接… 通常需要几秒，最长约 30 秒。');
      try {
        await saveRisk();
        const result = await call({ type: 'LLM_QUICK_SETUP_SAVE', consentGranted: true,
          profile: { id: profileId, name: existing?.name || item.label, providerId: item.providerId, config } });
        // The settings transaction is already complete. Retrying guide bookkeeping
        // must never re-test, duplicate or replace this saved connection.
        existing = result.settings.profiles[profileId]; settings = result.settings;
        $('qsKey').value = ''; drafts.clear();
        $('qsSavedFolder').textContent = directory.name;
        $('qsSavedModel').textContent = `${item.label} · ${config.model}`;
        $('qsForm').hidden = true; $('qsSuccess').hidden = false;
        try {
          await progress('completed', 'completed');
          const finish = await call({ type: 'ONBOARDING_PREPARE_FINISH', sourceTab });
          prepared = finish.prepared === true;
          if (!prepared) $('qsStart').textContent = '完成';
        } catch (_) { $('qsFinishStatus').textContent = '设置已保存；可关闭此窗口后，从工具栏打开 BREVESS。'; }
        $('qsStart').focus();
      } catch (error) {
        const messages = { AI_PRIVACY_ACK_REQUIRED: '请重新确认隐私风险。', QUICK_SETUP_CHANGED: '此连接刚刚在另一窗口修改，请重新打开快速配置后再试。', QUICK_SETUP_DIRECTORY_REQUIRED: '文件夹权限已失效，请重新授权。', AUTH_INVALID: 'API Key 未通过验证，请检查密钥与服务商是否匹配。', UNAUTHORIZED: 'API Key 未通过验证，请检查密钥。', NETWORK_ERROR: '未能连接服务，请检查网络和 API 地址后重试。', REQUEST_TIMEOUT: '连接超时，已保留输入，请稍后重试。', QUOTA_EXHAUSTED: '账户额度不足，请充值或切换服务商后重试。', RATE_LIMITED: '服务暂时限流，已保留输入，请稍后重试。', QUICK_SETUP_OWNER_CLOSED: '配置窗口已关闭，设置未提交。' };
        notice(messages[error.code] || '连接或保存未完成。请检查密钥、模型名称、账户额度和网络后重试。', 'error');
      } finally { setBusy(false); }
    });
    $('qsLater').addEventListener('click', async () => {
      if (!ready) { window.close(); return; }
      if (busy) return; setBusy(true);
      try { await progress(directoryReady ? 'completed' : 'skipped', settings?.consentGranted && existing?.config?.hasApiKey ? 'completed' : 'skipped'); window.close(); }
      catch (_) { notice('未能记录进度，请重试。', 'error'); setBusy(false); }
    });
    $('qsStart').addEventListener('click', async () => {
      if (!prepared) { window.close(); return; }
      $('qsStart').disabled = true;
      try { await call({ type: 'ONBOARDING_FINISH', sourceTab }); window.close(); }
      catch (_) { $('qsFinishStatus').textContent = '设置已保存。请回到网页，点击工具栏中的 BREVESS 开始阅读。'; $('qsStart').disabled = false; prepared = false; $('qsStart').textContent = '完成'; }
    });
    $('qsFullSettings').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('options.html#page=models') }).then(() => window.close()));
    try {
      const [data, handle, risk, state] = await Promise.all([
        call({ type: 'LLM_GET_SETTINGS' }), root.SciLLM.loadDirectoryHandle(indexedDB), chrome.storage.local.get(riskKey), call({ type: 'ONBOARDING_GET' })
      ]);
      settings = data.settings; directory = handle; sourceTab = state.sourceTab || {};
      directoryReady = Boolean(handle && await handle.queryPermission({ mode: 'readwrite' }).catch(() => 'prompt') === 'granted');
      const hosts = { deepseek: 'https://api.deepseek.com', openai: 'https://api.openai.com', anthropic: 'https://api.anthropic.com', gemini: 'https://generativelanguage.googleapis.com' };
      choices = ['deepseek', 'openai', 'anthropic', 'gemini'].map(id => ({ id, providerId: id, ...data.providers[id], host: hosts[id] }));
      for (const preset of data.compatibleProviderPresets || []) if (preset.id !== 'custom') choices.push({ ...preset, id: `compatible:${preset.id}`, providerId: 'openai-compatible', host: preset.baseUrl, config: { presetId: preset.id, authHeader: preset.authHeader, authPrefix: preset.authPrefix, jsonMode: preset.jsonMode, supportsVision: preset.supportsVision } });
      choices.push({ id: 'custom', label: '自定义兼容接口', providerId: 'openai-compatible', defaultModel: '', custom: true, config: { presetId: 'custom', authHeader: 'Authorization', authPrefix: 'Bearer', jsonMode: true } });
      $('qsProvider').replaceChildren(...choices.map(item => new Option(item.label, item.id)));
      const current = settings.profiles[settings.globalProfileId];
      let currentChoice = choices.find(item => item.providerId === current?.providerId && (item.providerId !== 'openai-compatible' || item.config.presetId === current.config?.presetId));
      if (current?.providerId === 'openai-compatible' && !currentChoice) currentChoice = choices.find(item => item.id === 'custom');
      if (current?.config?.hasApiKey && currentChoice) {
        drafts.set(currentChoice.id, { model: current.config.model, endpoint: current.config.baseUrl || '', profileId: settings.globalProfileId, existing: current });
        $('qsProvider').value = currentChoice.id;
      }
      $('qsConsent').checked = validRisk(risk[riskKey]) && settings.consentGranted === true;
      renderDirectory(); renderProvider(); ready = true; setBusy(false);
      notice('密钥只保存在本机；测试通过后设为全局默认连接。');
    } catch (_) {
      notice('配置读取失败，请关闭此窗口后从设置中的「快速配置」重试。', 'error');
      $('qsLater').disabled = false; $('qsLater').textContent = '关闭';
    }
  }
})(globalThis);
