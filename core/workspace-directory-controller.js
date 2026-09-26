(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const messages = {
    UNCONFIGURED: '请先在“本地保存”中选择保存目录并完成同步。',
    PERMISSION_REQUIRED: '保存目录尚未授权，请在“本地保存”中重新授权后重试。',
    ROOT_MISSING: '保存根目录已不存在，请核对目录位置并重新绑定。',
    BINDING_MISSING: '尚未绑定本机目录路径，请在“本地保存”中绑定实际的 Brevess 数据目录。',
    BINDING_INVALID: '目录绑定记录无效，请核对当前目录；原记录已保留。',
    ROOT_CHANGED: '操作期间保存目录已切换，请核对当前目录后重新操作。',
    NOT_SYNCED: '这篇文献的目录尚未同步完成，请先完成保存与目录同步。',
    IDENTITY_MISMATCH: '目录中的文献归属或版本与当前工作区不一致，请先核对保存和同步状态。',
    PATH_INVALID: '目录路径无效，请填写实际 Brevess 数据根目录的完整本地路径。',
    MANIFEST_INVALID: '文献目录清单无效，已保留原文件，请检查目录和同步状态。',
    CRYPTO_UNAVAILABLE: '当前环境无法生成目录绑定证明，请更新浏览器后重试。',
    IO_ERROR: '无法读取保存目录，请检查目录权限、文件占用和同步状态。',
    UNSUPPORTED: '当前系统的本机助手暂不支持打开文献目录。',
    INVALID_REQUEST: '本机目录请求无效，请刷新设置页面后重试。',
    INVALID_PATH: '请输入实际 Brevess 数据根目录的完整本地路径。',
    NOT_BOUND: '本机助手尚未绑定当前保存目录，请先完成目录路径绑定。',
    ROOT_MISMATCH: '本机绑定与当前保存目录不一致，请核对实际路径并重新绑定。',
    PROOF_INVALID: '填写的路径与当前授权保存目录不匹配，请填写包含 Brevess 的实际数据根目录路径。',
    PROOF_EXPIRED: '目录绑定证明已过期，请重新点击绑定。',
    CONFIG_INVALID: '本机助手的目录绑定配置无效，原配置已保留，请检查本机助手。',
    CONFIG_WRITE_FAILED: '本机助手未能确认保存绑定配置，请检查权限并重新检查绑定状态。',
    MISSING: '这篇文献的本地目录不存在，请先完成保存与同步。',
    PATH_ESCAPE: '文献目录已超出绑定范围，未发送打开请求，请核对目录及链接。',
    OPEN_FAILED: '本机助手未能启动文件管理器，请检查系统后重试。',
    HOST_UNAVAILABLE: '本机助手未连接，请先安装或启用现有 Brevess 本机助手。',
    HOST_UPDATE_REQUIRED: '当前本机助手不支持打开文献目录，请更新本机助手后重试。',
    TIMEOUT: '本机助手未返回确认，尚不能确认目录是否已打开；请先查看文件管理器再重试。',
    PROTOCOL_INVALID: '未收到有效的本机目录操作确认，请检查本机助手版本及状态。',
    FORBIDDEN: '请从本扩展设置页执行目录绑定或打开操作。',
    BUSY: '另一项目录操作正在进行，请等待结果后再操作。'
  };
  const prefix = 'WORKSPACE_DIRECTORY_';
  function fail(suffix) { throw Object.assign(new Error(prefix + suffix), { code: prefix + suffix, retryable: false }); }
  function publicWorkspaceDirectoryError(error) {
    const suffix = String(error?.code || '').startsWith(prefix) ? String(error.code).slice(prefix.length) : 'IO_ERROR';
    const known = Object.hasOwn(messages, suffix) ? suffix : 'IO_ERROR';
    return { code: prefix + known, message: messages[known], retryable: false };
  }
  function targetValue(value) {
    return { rootId: value.rootId, workspaceId: value.workspaceId,
      workspaceGeneration: value.workspaceGeneration, canonicalUrl: value.canonicalUrl,
      directoryName: value.directoryName };
  }
  function sameWorkspace(left, right) {
    return right && !right.deletionPending && ['workspaceId', 'workspaceGeneration', 'canonicalUrl',
      'directoryName', 'contentHash', 'revision', 'storageRevision']
      .every(key => left[key] === right[key]);
  }
  function createWorkspaceDirectoryController({ directorySync, nativeClient, articleWorkspaceStore,
    runtimeExtensionId }) {
    let mutationActive = false;
    function assertSender(sender) {
      let valid = false;
      try {
        const url = new URL(sender?.url);
        valid = Boolean(runtimeExtensionId) && sender.id === runtimeExtensionId && sender.frameId === 0 &&
          /^(?:chrome|moz)-extension:$/u.test(url.protocol) && url.host === runtimeExtensionId &&
          url.pathname === '/options.html' && !url.username && !url.password;
      } catch (_) { /* Only the actual privileged options document is accepted. */ }
      if (!valid) fail('FORBIDDEN');
    }
    async function capability() {
      const result = await nativeClient.status('');
      if (result?.supported !== true) fail('UNSUPPORTED');
    }
    async function status() {
      await capability();
      let binding;
      try { binding = await directorySync.readNativeDirectoryBinding(); }
      catch (error) { return { available: true, bound: false, rootName: '', ...publicWorkspaceDirectoryError(error) }; }
      const value = await nativeClient.status(binding.rootId);
      if (value?.supported !== true || value.rootId !== binding.rootId || typeof value.bound !== 'boolean') fail('PROTOCOL_INVALID');
      const latest = await directorySync.readNativeDirectoryBinding();
      if (latest.rootId !== binding.rootId) fail('ROOT_CHANGED');
      return { available: true, bound: value.bound, rootName: latest.rootName,
        ...(value.bound ? {} : publicWorkspaceDirectoryError({ code: prefix + 'NOT_BOUND' })) };
    }
    async function bind(message) {
      const absolutePath = typeof message.absolutePath === 'string' ? message.absolutePath.trim() : '';
      if (!absolutePath || absolutePath.length > 2048 || /[\u0000-\u001f\u007f]/u.test(absolutePath)) fail('INVALID_PATH');
      await capability();
      const proof = await directorySync.prepareNativeDirectoryBinding();
      const result = await nativeClient.bind({ absolutePath, rootId: proof.rootId, challenge: proof.challenge });
      if (result?.bound !== true || result.rootId !== proof.rootId) fail('PROTOCOL_INVALID');
      const latest = await directorySync.readNativeDirectoryBinding();
      if (latest.rootId !== proof.rootId) fail('ROOT_CHANGED');
      return { bound: true, rootName: latest.rootName };
    }
    async function open(message) {
      if (typeof message.workspaceId !== 'string' || !/^workspace:[a-f0-9]{12,64}$/u.test(message.workspaceId)) fail('INVALID_REQUEST');
      const workspace = await articleWorkspaceStore.getWorkspace(message.workspaceId);
      if (!workspace || workspace.deletionPending) fail('MISSING');
      const first = await directorySync.getWorkspaceDirectoryOpenTarget(workspace);
      const latest = await articleWorkspaceStore.getWorkspace(workspace.workspaceId);
      if (!sameWorkspace(workspace, latest)) fail('IDENTITY_MISMATCH');
      const target = await directorySync.getWorkspaceDirectoryOpenTarget(latest);
      if (first.rootId !== target.rootId) fail('ROOT_CHANGED');
      if (JSON.stringify(targetValue(first)) !== JSON.stringify(targetValue(target))) fail('IDENTITY_MISMATCH');
      const finalWorkspace = await articleWorkspaceStore.getWorkspace(workspace.workspaceId);
      if (!sameWorkspace(latest, finalWorkspace)) fail('IDENTITY_MISMATCH');
      const input = targetValue(target);
      const result = await nativeClient.open(input);
      if (result?.opened !== true || result.rootId !== input.rootId || result.workspaceId !== input.workspaceId) fail('PROTOCOL_INVALID');
      return { opened: true, workspaceId: input.workspaceId, rootName: target.rootName };
    }
    async function handle(message, sender) {
      assertSender(sender);
      if (message?.type === 'USER_DATA_DIRECTORY_NATIVE_STATUS') return status();
      if (!['USER_DATA_DIRECTORY_NATIVE_BIND', 'LOCAL_READING_LIBRARY_OPEN_DIRECTORY'].includes(message?.type)) fail('INVALID_REQUEST');
      if (mutationActive) fail('BUSY');
      mutationActive = true;
      try { return await (message.type === 'USER_DATA_DIRECTORY_NATIVE_BIND' ? bind(message) : open(message)); }
      finally { mutationActive = false; }
    }
    return { handle };
  }
  return { createWorkspaceDirectoryController, publicWorkspaceDirectoryError };
});
