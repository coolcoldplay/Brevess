const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const popup = fs.readFileSync(path.join(__dirname, '..', 'popup.js'), 'utf8');

// Execute the production handlers, with only browser/message boundaries stubbed.
function executable(name, dependencies = {}) {
  let start = popup.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  if (popup.slice(start - 6, start) === 'async ') start -= 6;
  const body = popup.indexOf(') {', start) + 2;
  let depth = 0;
  let end = body;
  do {
    if (popup[end] === '{') depth++;
    if (popup[end] === '}') depth--;
    end++;
  } while (depth && end < popup.length);
  return Function(...Object.keys(dependencies), `return (${popup.slice(start, end)});`)(
    ...Object.values(dependencies)
  );
}

function harness({ transportFailure = false, appliedSuccess = true, commitSuccess = false, navigateAt = '' } = {}) {
  const calls = [];
  const presented = [];
  const statuses = [];
  const uiChanges = [];
  let current = true;
  const workspace = { workspaceId: 'workspace:paper', workspaceGeneration: 1,
    canonicalUrl: 'https://example.test/paper', contentHash: 'revision' };
  const scanned = { permission: 'granted', restore: { manifest: workspace, assets: {} } };
  const applied = appliedSuccess
    ? { success: true, committed: true, durableFigureWorkspace: true,
      receiptRegistered: true, restoreReceipt: 'receipt', chatTurns: 2, uiState: { view: 'figures' } }
    : { success: false, committed: false, retryable: true,
      error: 'ARTICLE_WORKSPACE_RESTORE_TARGET_MISMATCH' };
  const send = async message => {
    calls.push(message);
    if (message.type === 'ARTICLE_WORKSPACE_SCAN_RESTORE') return scanned;
    if (message.type === 'ARTICLE_WORKSPACE_COMMIT_RESTORE') {
      if (navigateAt === 'commit') current = false;
      if (transportFailure) throw new Error('DIRECTORY_IO_FAILED');
      return commitSuccess ? { success: true } : {
        success: false, error: 'ARTICLE_WORKSPACE_RESTORE_TARGET_MISMATCH'
      };
    }
    throw new Error(`Unexpected message: ${message.type}`);
  };
  const dependencies = {
    isPristineFigureOnlyWorkspaceRestore: executable('isPristineFigureOnlyWorkspaceRestore', {
      SciLLM: require('../core/figure-workspace.js')
    }),
    assertArticleWorkspaceRestorePanelReady: executable('assertArticleWorkspaceRestorePanelReady', {
      hasArticleWorkspaceRestorePanelDrafts: () => false
    }),
    preserveArticleWorkspaceRestorePanelDrafts: executable('preserveArticleWorkspaceRestorePanelDrafts', {
      hasArticleWorkspaceRestorePanelDrafts: () => false
    }),
    currentArticleArchiveIdentity: () => ({documentId:'doc:paper'}),
    describePreparedArticleWorkspaceRestoreStatus: executable('describePreparedArticleWorkspaceRestoreStatus'),
    currentArticleArchiveProbe: null,
    setArticleArchivePrompt: () => {},
    describeArticleWorkspaceRestoreError: executable('describeArticleWorkspaceRestoreError'),
    capturePanelContext: () => ({ tabId: 4 }),
    isCurrentPanelContext: () => current,
    beginArticleWorkspaceDirectoryPermissionRequest: () => null,
    resolveArticleWorkspaceDirectoryPermission: async () => 'granted',
    sendTabMessage: async (_id, message) => {
      calls.push(message);
      if (navigateAt === 'apply' && message.action === 'applyArticleWorkspaceAssets') current = false;
      return message.action === 'ensureArticleWorkspace'
        ? { success: true, workspace, restoreAuthorization: { token: 'one-time-token' } }
        : applied;
    },
    sendLlmMessage: send,
    buildArticleWorkspaceRestoreTarget: () => ({ authorizationToken: 'one-time-token',
      documentId: 'doc:paper', current: workspace, manifest: workspace }),
    commitAuthorizedArticleWorkspaceScan: executable('commitAuthorizedArticleWorkspaceScan', {
      sendLlmMessage: send,
      publicArticleWorkspaceRestoreCommitTarget: executable('publicArticleWorkspaceRestoreCommitTarget')
    }),
    describeCommittedArticleRestore: executable('describeCommittedArticleRestore'),
    presentCommittedArticleRestoreResult: async result => { presented.push(result); return true; },
    applyRestoredSidePanelUiState: () => uiChanges.push('ui-state'),
    refreshManualAnnotationSummary: async () => { if (navigateAt === 'refresh') current = false; },
    refreshArticleWorkspace: async () => { if (navigateAt === 'workspace-refresh') current = false; },
    showStatus: (message, type) => statuses.push({ message, type }),
    document: { getElementById: () => ({ disabled: false }) }
  };
  return { calls, presented, statuses, uiChanges, applied, dependencies,
    restore: executable('restoreCurrentArticleWorkspaceFromDirectory', dependencies),
    scan: () => executable('scanArticleWorkspaceForContext', dependencies)({ panelContext: { tabId: 4 }, permissionTicket: null }) };
}

for (const entry of ['restore', 'scan']) {
  for (const transportFailure of [false, true]) {
    test(`ARCH-009 ${entry}: post-apply ${transportFailure ? 'transport rejection' : 'commit refusal'} preserves committed outcome`, async () => {
      const h = harness({ transportFailure });
      const result = await h[entry]();
      const failure = entry === 'restore' ? result.applied : result;
      assert.equal(failure.success, false);
      assert.equal(failure.committed, true);
      assert.equal(failure.retryable, false);
      assert.equal(failure.postCommitStatus, 'workspace-background-commit-failed');
      assert.equal(failure.restoreReceipt, 'receipt');
      assert.equal(failure.chatTurns, 2);
      assert.equal(failure.error, transportFailure ? 'DIRECTORY_IO_FAILED' : 'ARTICLE_WORKSPACE_RESTORE_TARGET_MISMATCH');
      assert.equal(h.presented.length, 1);
      assert.equal(h.statuses.some(s => /加载.*失败|扫描.*失败/.test(s.message)), false);
      assert.equal(h.calls.filter(c => c.type === 'ARTICLE_WORKSPACE_COMMIT_RESTORE').length, 1);
    });
  }
}

test('ARCH-009 failed page identity check still performs zero background commits', async () => {
  const h = harness({ appliedSuccess: false });
  await assert.rejects(h.restore(), /ARTICLE_WORKSPACE_RESTORE_TARGET_MISMATCH/);
  assert.equal(h.calls.filter(c => c.type === 'ARTICLE_WORKSPACE_COMMIT_RESTORE').length, 0);
  assert.equal(h.presented.length, 0);
});

test('ARCH-009 successful directory restore retains receipt, UI state and normal refresh', async () => {
  const h = harness({ commitSuccess: true });
  const result = await h.restore();
  assert.strictEqual(result.applied, h.applied);
  assert.equal(h.presented.length, 0);
  assert.equal(h.statuses.at(-1).type, 'success');
});

test('ARCH-009 archive load does not retry an older archive after directory application committed', async () => {
  const h = harness();
  let archiveLoads = 0;
  const load = executable('loadArticleArchiveForContext', {
    ...h.dependencies,
    currentArticleArchiveIdentity: () => ({ documentId: 'doc:paper' }),
    restoreCurrentArticleWorkspaceFromDirectory: h.restore,
    setArticleArchivePrompt: () => {},
    rememberArticleArchivePromptDecision: async () => {},
    sendLlmMessage: async () => { archiveLoads++; throw Error('Must not load old archive'); },
    applyLoadedArticleArchive: async () => { throw Error('Must not apply twice'); }
  });
  const result = await load({ panelContext: { tabId: 4 }, permissionTicket: null });
  assert.equal(result?.committed, true);
  assert.equal(result?.retryable, false);
  assert.equal(archiveLoads, 0);
});

test('ARCH-009 committed directory failure explains the actual stage without claiming a rollback', () => {
  const describe = executable('describeCommittedArticleRestore');
  const status = describe({ success: false, committed: true, retryable: false,
    postCommitStatus: 'workspace-background-commit-failed' });
  assert.match(status.message, /已应用/);
  assert.match(status.message, /工作区.*后台提交失败/);
  assert.match(status.message, /请勿再次执行恢复/);
  assert.doesNotMatch(status.message, /图解工作区持久化失败|未改任何内容|可以放心关闭/);
});

test('ARCH-009 manual proof failure does not misidentify a Figure persistence error', () => {
  const describe = executable('describeCommittedArticleRestore');
  const status = describe({success:false,committed:true,retryable:false,
    postCommitStatus:'manual-proof-failed',durableFigureWorkspace:false});
  assert.match(status.message, /已应用.*人工标注.*校验失败/);
  assert.match(status.message, /请勿再次执行恢复/);
  assert.doesNotMatch(status.message, /图解工作区持久化失败|恢复成功/);
});

for (const failure of [
  { result: { permission: 'denied', requiresReauthorization: true }, expected: /再次点击保存.*允许访问/ },
  { result: { permission: 'granted', requiresReselection: true, failed: 1 }, expected: /重新选择同一个基础目录/ },
  { result: { permission: 'granted', failed: 1, errorCode: 'QUOTA_EXCEEDED', failedPath: 'figures/workspace-draft.json' }, expected: /QUOTA_EXCEEDED/ },
  { result: { permission: 'granted', pendingCount: 2 }, expected: /目录写入未完成/ }
]) {
  test(`ARCH-009 save retains actionable folder failure: ${failure.expected}`, async () => {
    const statuses = [];
    const button = { disabled: false, setAttribute() {}, removeAttribute() {} };
    const save = executable('saveCurrentArticleWorkspace', {
      articleWorkspaceSaveGuard: { isPending: () => false, run: work => work() },
      beginArticleWorkspaceDirectoryPermissionRequest: () => null,
      resolveArticleWorkspaceDirectoryPermission: async () => 'granted',
      renderArticleWorkspaceSaveProgress() {},
      capturePanelContext: () => ({ tabId: 4 }),
      isCurrentPanelContext: () => true,
      document: { getElementById: () => button },
      sendTabMessage: async (_id, message) => message.action === 'ensureArticleWorkspace'
        ? { success: true, workspace: { workspaceId: 'workspace:fixture' } }
        : { success: true, workspace: { workspaceId: 'workspace:fixture' }, assetCount: 14 },
      sendLlmMessage: async message => message.type === 'USER_DATA_SYNC_NOW'
        ? failure.result : { permission: 'granted' },
      directorySyncFailureMessage: executable('directorySyncFailureMessage'),
      showStatus: (message, type) => statuses.push({ message, type })
    });
    await save();
    assert.equal(statuses.at(-1).type, 'warning');
    assert.match(statuses.at(-1).message, /已保存在浏览器/);
    assert.match(statuses.at(-1).message, failure.expected);
    assert.doesNotMatch(statuses.at(-1).message, /可以放心关闭|同步将自动重试/);
    assert.equal(button.disabled, false);
  });
}

for (const entry of ['restore', 'scan']) {
  for (const navigateAt of ['apply', 'commit', 'refresh', 'workspace-refresh']) {
    test(`ARCH-009 ${entry} retains commit and stops UI work after navigation at ${navigateAt}`, async () => {
      const h = harness({ commitSuccess: true, navigateAt });
      const result = await h[entry]();
      assert.equal(h.calls.filter(c => c.type === 'ARTICLE_WORKSPACE_COMMIT_RESTORE').length, 1);
      assert.equal((entry === 'restore' ? result?.applied : result)?.committed, true);
      assert.equal(h.statuses.length, 0);
      assert.equal(h.uiChanges.length, ['refresh', 'workspace-refresh'].includes(navigateAt) ? 1 : 0);
    });
  }
}
