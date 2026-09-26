const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function sliceFunctions(script, startName, endName) {
  const start = script.indexOf(`function ${startName}`);
  const end = script.indexOf(`function ${endName}`, start + 1);
  assert.ok(start >= 0 && end > start);
  return script.slice(start, end);
}

test('notification Token formatter announces input, output, total, and request count', () => {
  const popup = read('popup.js');
  const source = sliceFunctions(
    popup,
    'normalizedNotificationTokenUsage',
    'showStatus'
  );
  const context = {};
  vm.runInNewContext(
    `${source}; globalThis.formatUsage = formatNotificationTokenUsage;` +
      'globalThis.appendUsage = appendNotificationTokenUsage;',
    context
  );
  assert.equal(
    context.formatUsage({
      inputTokens: 1200,
      outputTokens: 345,
      requests: 2,
      totalTokens: 1545
    }),
    'Token：输入 1,200 · 输出 345 · 总计 1,545 · 2 次调用'
  );
  assert.match(
    context.appendUsage('逐图解读完成', {
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15
    }),
    /^逐图解读完成 · Token：输入 10 · 输出 5 · 总计 15$/
  );
});

test('provider telemetry is aggregated and propagated to every completion surface', () => {
  const background = read('background.js');
  const content = read('content.js');
  const popup = read('popup.js');
  assert.match(background, /function aggregateNotificationTokenUsage/);
  assert.match(background, /reverseState\.tokenUsageEvents/);
  assert.match(background, /data:\s*\{[\s\S]*notificationUsage/);
  assert.match(content, /showLlmPageStatus\([\s\S]*response\.data\.notificationUsage/);
  assert.match(content, /terminalTurn\.usage = response\.data\.notificationUsage/);
  assert.match(content, /usage:\s*response\.data\.notificationUsage/);
  for (const workflow of [
    'runFigureAnalysis',
    'runFigurePanelFollowup',
    'runSingleFigureAnalysis',
    'runSingleFigurePanelAnalysis',
    'runCrossFigureLogic',
    'runReviewOutlineAnalysis'
  ]) {
    const start = popup.indexOf(`async function ${workflow}`);
    const end = popup.indexOf('\nasync function ', start + 1);
    const source = popup.slice(start, end < 0 ? popup.length : end);
    assert.match(source, /response\.usage/, workflow);
  }
});

test('Figure progress names missing Panels, durable counts, and truthful input mode', () => {
  const popup = read('popup.js');
  const source = sliceFunctions(
    popup, 'normalizeFigureRecoveryPanelLabels', 'compactFigureResultConclusion'
  );
  const context = { Date, t: value => String(value || '') };
  vm.runInNewContext(`${source}; globalThis.format = formatFigureProgress;`, context);
  const visual = context.format({
    phase: 'figure_panel_recovery_checkpoint',
    expectedPanels: ['A', 'B', 'C', 'D'],
    missingPanels: ['C', 'D'],
    savedPanelCount: 2,
    validatedPanelCount: 2,
    inputMode: 'figure_image'
  }, 1000);
  assert.match(visual.phaseText, /缺失 Panel/u);
  assert.ok(visual.details.includes('待补 Panel：C、D'));
  assert.ok(visual.details.includes('已保存 2 个 Panel；已校验 2 个 Panel'));
  assert.ok(visual.details.includes('输入依据：整张 Figure 图片'));

  const fallback = context.format({
    phase: 'figure_panel_recovery_batch_complete',
    missingPanels: ['D'], savedPanelCount: 3, validatedPanelCount: 3,
    inputMode: 'caption_context'
  }, 1000);
  assert.ok(fallback.details.includes('输入依据：图注/正文回退'));
});

test('Figure checkpoints are origin-tab private and public/native events contain no science', () => {
  const background = read('background.js');
  const start = background.indexOf('const FIGURE_PUBLIC_PROGRESS_MESSAGE_TYPES');
  const end = background.indexOf('function sanitizeCodexReverseResult', start);
  const source = background.slice(start, end);
  const context = {};
  vm.runInNewContext(
    `${source}; globalThis.sanitize = sanitizePublicLlmProgress;`, context
  );
  const safe = context.sanitize({
    phase: 'figure_panel_recovery_checkpoint',
    figureId: 'figure-1', operationId: 'op-1',
    missingPanels: ['C'], savedPanelCount: 2, validatedPanelCount: 3,
    providerAttempt: 7, providerAttemptLimit: 12,
    inputMode: 'caption_context', checkpointStatus: 'pending_save',
    partialFigureResult: { panels: [{ directObservation: 'private science' }] },
    figureResult: { coreConclusion: 'private science' },
    checkpointAnnotations: [{ quote: 'private text' }]
  });
  assert.equal(safe.figureId, 'figure-1');
  assert.equal(safe.savedPanelCount, 2);
  assert.equal(safe.validatedPanelCount, 3);
  assert.equal(safe.providerAttempt, 7);
  assert.equal(safe.providerAttemptLimit, 12);
  assert.equal(safe.checkpointStatus, 'pending_save');
  assert.equal(Object.hasOwn(safe, 'partialFigureResult'), false);
  assert.equal(Object.hasOwn(safe, 'figureResult'), false);
  assert.equal(Object.hasOwn(safe, 'checkpointAnnotations'), false);
  assert.match(background, /async function persistOriginFigureCheckpoint/u);
  assert.match(background, /action:\s*'llmFigureCheckpoint'/u);
  assert.match(background, /sender\.tab\.id/u);
  assert.match(background, /onFigureCheckpoint/u);
  assert.doesNotMatch(
    sliceFunctions(background, 'publishCodexReverseEvent', 'aggregateNotificationTokenUsage'),
    /result:\s*response\.data/u
  );
});

test('private Figure checkpoint binding rejects cross-origin and stale request identity', () => {
  const background = read('background.js');
  const source = sliceFunctions(
    background, 'validateOriginFigureCheckpointBinding', 'persistOriginFigureCheckpoint'
  ).replace(/\s*async\s*$/u, '');
  const context = {};
  vm.runInNewContext(
    `${source}; globalThis.validate = validateOriginFigureCheckpointBinding;`, context
  );
  const message = {
    type: 'LLM_ANALYZE_FIGURES', operationId: 'op-1', workspaceLifecycle: 4,
    figures: [{ figureId: 'figure-1' }]
  };
  const sender = {
    id: 'runtime-id', tab: { id: 17 }, frameId: 0,
    documentId: '11111111-1111-4111-8111-111111111111'
  };
  const checkpoint = {
    figureId: 'figure-1', operationId: 'op-1', analysisDepth: 'standard',
    checkpointEnvelope: {
      version: 'figure-checkpoint-envelope-v1', figureId: 'figure-1',
      figureResult: { figureId: 'figure-1', panels: [{ panel: 'A' }] }
    },
    figureResult: { figureId: 'figure-1', panels: [{ panel: 'A' }] }
  };
  assert.equal(context.validate(message, sender, checkpoint, 'runtime-id').senderTabId, 17);
  assert.throws(() => context.validate(message, { ...sender, id: 'other' }, checkpoint,
    'runtime-id'), /FIGURE_CHECKPOINT_TRANSPORT_UNAVAILABLE/u);
  assert.throws(() => context.validate(message, sender,
    { ...checkpoint, operationId: 'stale-op' }, 'runtime-id'),
  /FIGURE_CHECKPOINT_BINDING_INVALID/u);
  assert.throws(() => context.validate({ ...message, workspaceLifecycle: 5 }, sender,
    { ...checkpoint, workspaceLifecycle: 4 }, 'runtime-id'),
  /FIGURE_CHECKPOINT_BINDING_INVALID/u);
});

test('private Figure checkpoint survives JSON messaging without object-alias identity', async () => {
  const background = read('background.js');
  const start = background.indexOf('function validateOriginFigureCheckpointBinding');
  const end = background.indexOf('function validateOriginWorkspaceCommitGuardBinding', start);
  const sent = [];
  const context = {
    chrome: {
      runtime: { id: 'runtime-id' },
      tabs: { sendMessage: async (...args) => {
        sent.push(JSON.parse(JSON.stringify(args)));
        return { success: true, savedPanelCount: 1 };
      } }
    }
  };
  vm.runInNewContext(
    `${background.slice(start, end)}; globalThis.persist = persistOriginFigureCheckpoint;`,
    context
  );
  const figureResult = { figureId: 'figure-1', panels: [{ panel: 'A' }] };
  const checkpointEnvelope = {
    version: 'figure-checkpoint-envelope-v1', figureId: 'figure-1',
    figureResult: JSON.parse(JSON.stringify(figureResult))
  };
  const receipt = await context.persist({
    type: 'LLM_ANALYZE_FIGURES', operationId: 'op-1', workspaceLifecycle: 4,
    figures: [{ figureId: 'figure-1' }]
  }, {
    id: 'runtime-id', tab: { id: 17 }, frameId: 2,
    documentId: '22222222-2222-4222-8222-222222222222'
  }, {
    figureId: 'figure-1', operationId: 'op-1', analysisDepth: 'standard',
    checkpointEnvelope, figureResult
  });
  assert.equal(receipt.success, true);
  const forwarded = sent[0][1].checkpoint;
  assert.equal(Object.hasOwn(forwarded, 'figureResult'), false);
  assert.deepEqual(forwarded.checkpointEnvelope.figureResult, figureResult);
  assert.deepEqual(sent[0][2], {
    frameId: 2,
    documentId: '22222222-2222-4222-8222-222222222222'
  });
});

test('workspace commit guard is bound to the origin tab frame workspace path and lifecycle', async () => {
  const background = read('background.js');
  const start = background.indexOf('function validateOriginWorkspaceCommitGuardBinding');
  const end = background.indexOf('async function handleRoutedMessage', start);
  const sent = [];
  const context = {
    chrome: {
      runtime: { id: 'runtime-id' },
      tabs: { sendMessage: async (...args) => {
        sent.push(args);
        return { success: true };
      } }
    }
  };
  vm.runInNewContext(
    `${background.slice(start, end)}; ` +
      'globalThis.persistGuard = persistOriginWorkspaceCommitGuard;',
    context
  );
  const message = {
    type: 'ARTICLE_WORKSPACE_SAVE_ASSET', commitGuardKind: 'figure_retry',
    commitGuardId: 'figure-retry-guard-abcdefgh', workspaceLifecycle: 7,
    workspaceId: 'workspace:a', workspaceGeneration: 3,
    relativePath: 'figures/workspace-draft.json'
  };
  const sender = {
    id: 'runtime-id', tab: { id: 17 }, frameId: 2,
    documentId: '17171717-1717-4717-8717-171717171717'
  };
  const receipt = await context.persistGuard(message, sender, {
    commitGuardId: message.commitGuardId,
    workspaceId: message.workspaceId,
    workspaceGeneration: message.workspaceGeneration,
    relativePath: message.relativePath
  });
  assert.equal(receipt.success, true);
  assert.equal(sent[0][0], 17);
  assert.equal(sent[0][1].action, 'llmFigureWorkspaceCommitGuard');
  assert.equal(sent[0][1].workspaceLifecycle, 7);
  assert.equal(sent[0][2].frameId, 2);
  assert.equal(sent[0][2].documentId,
    '17171717-1717-4717-8717-171717171717');
  const stagingPath =
    'internal/figure-retry-staging/figure-retry-guard-stageabcd.json';
  const confirm = {
    ...message,
    type: 'ARTICLE_WORKSPACE_CONFIRM_STAGED_ASSET',
    commitGuardId: 'figure-retry-guard-confirmabcd',
    stagingPath
  };
  const confirmed = await context.persistGuard(confirm, sender, {
    commitGuardId: confirm.commitGuardId,
    workspaceId: confirm.workspaceId,
    workspaceGeneration: confirm.workspaceGeneration,
    relativePath: confirm.relativePath,
    stagingPath
  });
  assert.equal(confirmed.success, true);
  assert.equal(sent[1][1].stagingPath, stagingPath);
  assert.equal(sent[1][2].frameId, 2);
  assert.equal(sent[1][2].documentId,
    '17171717-1717-4717-8717-171717171717');
  await assert.rejects(() => context.persistGuard(
    { ...confirm, stagingPath: stagingPath.replace('stageabcd', 'otherabcd') },
    sender, {
      commitGuardId: confirm.commitGuardId,
      workspaceId: confirm.workspaceId,
      workspaceGeneration: confirm.workspaceGeneration,
      relativePath: confirm.relativePath,
      stagingPath
    }
  ), /FIGURE_COMMIT_GUARD_UNAVAILABLE/u);
  await assert.rejects(() => context.persistGuard(
    { ...message, relativePath: 'figures/other.json' }, sender, {
      commitGuardId: message.commitGuardId,
      workspaceId: message.workspaceId,
      workspaceGeneration: message.workspaceGeneration,
      relativePath: message.relativePath
    }
  ), /FIGURE_COMMIT_GUARD_UNAVAILABLE/u);
});

test('routed background work repairs browser-authoritative document changes before success', async () => {
  const background = read('background.js');
  const start = background.indexOf('async function handleRoutedMessage');
  const end = background.indexOf('function bytesToBase64', start);
  assert.ok(start >= 0 && end > start);
  const documentA = '20202020-2020-4020-8020-202020202020';
  const documentB = '21212121-2121-4121-8121-212121212121';
  const sender = {
    id: 'runtime-id', tab: { id: 20 }, frameId: 0,
    documentId: documentA, url: 'https://example.test/article'
  };

  async function run(frameDocuments) {
    const queue = [...frameDocuments];
    const commits = [];
    let providerCalls = 0;
    const context = {
      Promise,
      chrome: {
        runtime: { id: 'runtime-id', getURL: value => `chrome-extension://runtime-id/${value}` },
        webNavigation: {
          async getFrame() {
            const documentId = queue.shift();
            return documentId ? { documentId } : null;
          }
        }
      },
      llmRouter: {
        async commitTrustedDocument(value) { commits.push(value); },
        async handle(_message, ownerContext) {
          try {
            await ownerContext.assertTrustedOwnerCurrent();
            providerCalls += 1;
            await ownerContext.assertTrustedOwnerCurrent();
            return { success: true, data: { completed: true } };
          } catch (error) {
            return { success: false, error: { code: error.code } };
          }
        }
      },
      aggregateNotificationTokenUsage() { return null; },
      async publishCodexReverseEvent() {},
      async coordinateOpenArticleWorkspaceTabs() { return []; }
    };
    vm.runInNewContext(
      `${background.slice(start, end)}; globalThis.route = handleRoutedMessage;`,
      context,
      { filename: 'background-routed-owner-guard.js' }
    );
    const response = await context.route({ type: 'LLM_ANALYZE_FIGURES' }, sender,
      () => undefined);
    return { response, commits, providerCalls, remainingFrames: queue.length };
  }

  const staleAtEntry = await run([documentB]);
  assert.equal(staleAtEntry.response.success, false);
  assert.equal(staleAtEntry.response.error.code, 'CANCELLED');
  assert.equal(staleAtEntry.providerCalls, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(staleAtEntry.commits)), [{
    senderExtensionId: 'runtime-id', senderTabId: 20, senderFrameId: 0,
    senderDocumentId: documentB
  }], 'the current browser document is durably repaired before rejection');

  const navigatedBeforeExit = await run([documentA, documentA, documentB]);
  assert.equal(navigatedBeforeExit.response.success, false);
  assert.equal(navigatedBeforeExit.response.error.code, 'CANCELLED');
  assert.equal(navigatedBeforeExit.providerCalls, 1,
    'the second guard prevents a stale successful return after provider work');
  assert.deepEqual(JSON.parse(JSON.stringify(navigatedBeforeExit.commits)), [{
    senderExtensionId: 'runtime-id', senderTabId: 20, senderFrameId: 0,
    senderDocumentId: documentA
  }, {
    senderExtensionId: 'runtime-id', senderTabId: 20, senderFrameId: 0,
    senderDocumentId: documentB
  }]);

  const stable = await run([documentA, documentA, documentA, documentA]);
  assert.equal(stable.response.success, true);
  assert.equal(stable.providerCalls, 1);
  assert.equal(stable.commits.length, 2,
    'entry and exit guards both reconcile the same committed document');
});

test('background origin-tab transport preserves bounded chat and outline progress but strips Figure science', async () => {
  const background = read('background.js');
  const start = background.indexOf('const FIGURE_PUBLIC_PROGRESS_MESSAGE_TYPES');
  const end = background.indexOf('function sanitizeCodexReverseResult', start);
  assert.ok(start >= 0 && end > start);
  const source = background.slice(start, end);
  const delivered = [];
  const native = [];
  const context = { Promise };
  vm.runInNewContext(
    `${source}; globalThis.createTransport = createRoutedLlmProgressTransport;`,
    context
  );
  const dependencies = {
    expectedRuntimeId: 'runtime-id',
    recordTokenUsageProgress: async () => null,
    sendTabProgress: async (tabId, payload, options) => {
      delivered.push({ tabId, payload, options });
    },
    publishCodexReverseEvent: async (...args) => native.push(args)
  };
  const sender = {
    id: 'runtime-id', tab: { id: 17 }, frameId: 2,
    documentId: '17171717-1717-4717-8717-171717171717'
  };
  const chat = context.createTransport(
    { type: 'LLM_ASK_ARTICLE', workspaceLifecycle: 5 }, sender, {}, dependencies
  );
  const chatProgress = {
    phase: 'chat_answer_block', turnId: 'turn-1',
    block: { blockId: 'b1', markdown: 'bounded answer' },
    coverage: { selectedSections: 3, totalSections: 5 },
    usage: { inputTokens: 10, outputTokens: 4 },
    continuation: 2, status: 'streaming'
  };
  await chat(chatProgress);
  assert.equal(JSON.stringify(delivered[0].payload.progress), JSON.stringify({
    ...chatProgress, workspaceLifecycle: 5
  }));
  assert.equal(Object.hasOwn(native[0][3], 'block'), false);

  const outline = context.createTransport(
    { type: 'LLM_ANALYZE_REVIEW_OUTLINE', workspaceLifecycle: 6 }, sender, {}, dependencies
  );
  const outlineProgress = {
    phase: 'review_chunk_checkpoint', completedChunks: 2, totalChunks: 4,
    checkpointSummaries: [{ paragraphId: 'p1', summary: 'bounded summary' }]
  };
  await outline(outlineProgress);
  assert.equal(JSON.stringify(delivered[1].payload.progress), JSON.stringify({
    ...outlineProgress, workspaceLifecycle: 6
  }));

  const figure = context.createTransport(
    { type: 'LLM_ANALYZE_FIGURES', workspaceLifecycle: 7 }, sender, {}, dependencies
  );
  await figure({
    phase: 'figure_panel_recovery_checkpoint', figureId: 'figure-1',
    savedPanelCount: 1, figureResult: { coreConclusion: 'private science' },
    checkpointAnnotations: [{ quote: 'private science' }]
  });
  assert.equal(delivered[2].payload.progress.figureId, 'figure-1');
  assert.equal(Object.hasOwn(delivered[2].payload.progress, 'figureResult'), false);
  assert.equal(Object.hasOwn(delivered[2].payload.progress, 'checkpointAnnotations'), false);
  assert.equal(Object.hasOwn(native.at(-1)[3], 'figureResult'), false);

  const crossFigure = context.createTransport(
    { type: 'LLM_ANALYZE_CROSS_FIGURE_LOGIC', workspaceLifecycle: 8 },
    sender, {}, dependencies
  );
  const crossProgress = {
    phase: 'mapping_claim_relations', operationId: 'cross-op', operationEpoch: 3,
    completedPanels: 7, totalPanels: 12, elapsedMs: 1350, status: 'retrying',
    canonicalNodes: [{ label: 'private mechanism' }],
    checkpointResult: { mechanismSummary: 'private science' }
  };
  await crossFigure(crossProgress);
  for (const safe of [delivered[3].payload.progress, native.at(-1)[3]]) {
    assert.equal(safe.operationEpoch, 3);
    assert.equal(safe.completedPanels, 7);
    assert.equal(safe.totalPanels, 12);
    assert.equal(safe.elapsedMs, 1350);
    assert.equal(safe.status, 'retrying');
    assert.equal(Object.hasOwn(safe, 'canonicalNodes'), false);
    assert.equal(Object.hasOwn(safe, 'checkpointResult'), false);
  }
  for (const item of delivered) {
    assert.equal(JSON.stringify(item.options), JSON.stringify({
      frameId: 2,
      documentId: '17171717-1717-4717-8717-171717171717'
    }));
  }
});

test('background progress delivery targets only the exact trusted tab frame and document', async () => {
  const background = read('background.js');
  const start = background.indexOf('const FIGURE_PUBLIC_PROGRESS_MESSAGE_TYPES');
  const end = background.indexOf('function sanitizeCodexReverseResult', start);
  assert.ok(start >= 0 && end > start);
  const source = background.slice(start, end);
  const defaultSends = [];
  const context = {
    Promise,
    chrome: {
      runtime: { id: 'runtime-id' },
      tabs: { sendMessage: async (...args) => defaultSends.push(args) }
    }
  };
  vm.runInNewContext(
    `${source}; globalThis.createTransport = createRoutedLlmProgressTransport;`,
    context
  );

  const exactSender = {
    id: 'runtime-id', tab: { id: 17 }, frameId: 2,
    documentId: '17171717-1717-4717-8717-171717171717'
  };
  await context.createTransport(
    { type: 'LLM_ASK_ARTICLE' }, exactSender, {}, {
      recordTokenUsageProgress: async () => null,
      publishCodexReverseEvent: async () => null
    }
  )({ phase: 'chat_answer_block' });
  assert.equal(defaultSends.length, 1);
  assert.equal(defaultSends[0][0], 17);
  assert.equal(JSON.stringify(defaultSends[0][2]), JSON.stringify({
    frameId: 2,
    documentId: '17171717-1717-4717-8717-171717171717'
  }));

  const activeTarget = {
    tabId: 17, frameId: 2,
    documentId: '27272727-2727-4727-8727-272727272727'
  };
  const attempts = [];
  const delivered = [];
  let usageCalls = 0;
  let reverseCalls = 0;
  const dependencies = {
    expectedRuntimeId: 'runtime-id',
    recordTokenUsageProgress: async () => { usageCalls += 1; },
    sendTabProgress: async (tabId, payload, options) => {
      attempts.push({ tabId, payload, options });
      if (tabId === activeTarget.tabId &&
          options?.frameId === activeTarget.frameId &&
          options?.documentId === activeTarget.documentId) {
        delivered.push({ tabId, payload, options });
        return;
      }
      throw new Error('Receiving end does not match the exact document');
    },
    publishCodexReverseEvent: async () => { reverseCalls += 1; }
  };
  const run = sender => context.createTransport(
    { type: 'LLM_ASK_ARTICLE' }, sender, {}, dependencies
  )({ phase: 'chat_answer_block' });

  await run({
    id: 'runtime-id', tab: { id: 17 }, frameId: 2,
    documentId: activeTarget.documentId
  });
  assert.equal(delivered.length, 1, 'the exact document receives progress');

  const fullWidthDocumentId = activeTarget.documentId.replace(/\d/gu,
    digit => String.fromCharCode(0xFF10 + Number(digit)));
  await run({
    id: 'runtime-id', tab: { id: 17 }, frameId: 2,
    documentId: `\u3000${fullWidthDocumentId}\u3000`
  });
  assert.equal(delivered.length, 2,
    'document identity is NFKC-normalized and trimmed before exact routing');
  assert.equal(delivered.at(-1).options.documentId, activeTarget.documentId);

  const attemptedBeforeMismatches = attempts.length;
  await run({
    id: 'runtime-id', tab: { id: 17 }, frameId: 2,
    documentId: '17171717-1717-4717-8717-171717171717'
  });
  await run({
    id: 'runtime-id', tab: { id: 17 }, frameId: 3,
    documentId: activeTarget.documentId
  });
  assert.equal(attempts.length, attemptedBeforeMismatches + 2,
    'stale-document and wrong-frame sends retain their exact binding');
  assert.equal(delivered.length, 2,
    'Chrome-style routing delivers neither a stale document nor a wrong iframe');

  const missingOrUntrusted = [
    { id: 'runtime-id', frameId: 2, documentId: activeTarget.documentId },
    { id: 'runtime-id', tab: { id: 17 }, documentId: activeTarget.documentId },
    { id: 'runtime-id', tab: { id: 17 }, frameId: 2 },
    { id: 'other-extension', tab: { id: 17 }, frameId: 2,
      documentId: activeTarget.documentId },
    { id: 'runtime-id', tab: { id: 17 }, frameId: 2,
      documentId: 'x'.repeat(257) }
  ];
  const attemptsBeforeSuppressed = attempts.length;
  for (const sender of missingOrUntrusted) await run(sender);
  assert.equal(attempts.length, attemptsBeforeSuppressed,
    'missing, untrusted, or unbounded identities suppress origin delivery');

  const accessorSender = {
    id: 'runtime-id', tab: { id: 17 }, frameId: 2
  };
  Object.defineProperty(accessorSender, 'documentId', {
    get() { throw new Error('hostile documentId getter'); }
  });
  const frameAccessorSender = {
    id: 'runtime-id', tab: { id: 17 }, documentId: activeTarget.documentId
  };
  Object.defineProperty(frameAccessorSender, 'frameId', {
    get() { throw new Error('hostile frameId getter'); }
  });
  const tabAccessorSender = {
    id: 'runtime-id', frameId: 2, documentId: activeTarget.documentId
  };
  Object.defineProperty(tabAccessorSender, 'tab', {
    get() { throw new Error('hostile tab getter'); }
  });
  const tabIdAccessor = {};
  Object.defineProperty(tabIdAccessor, 'id', {
    get() { throw new Error('hostile tab.id getter'); }
  });
  const tabIdAccessorSender = {
    id: 'runtime-id', tab: tabIdAccessor, frameId: 2,
    documentId: activeTarget.documentId
  };
  const inheritedSender = Object.create(exactSender);
  const proxySender = new Proxy(exactSender, {
    getOwnPropertyDescriptor() { throw new Error('hostile descriptor trap'); }
  });
  const unsafeSenders = [
    accessorSender, frameAccessorSender, tabAccessorSender, tabIdAccessorSender,
    inheritedSender, proxySender
  ];
  for (const sender of unsafeSenders) await run(sender);
  assert.equal(attempts.length, attemptsBeforeSuppressed,
    'accessor, inherited, and proxy identities fail closed without a send');

  const totalRuns = 2 + 2 + missingOrUntrusted.length + unsafeSenders.length;
  assert.equal(usageCalls, totalRuns,
    'identity rejection never suppresses token telemetry');
  assert.equal(reverseCalls, totalRuns,
    'identity rejection never suppresses native reverse progress');
});

test('token telemetry accepts only task IDs allowed by the current message branch', () => {
  const background = read('background.js');
  const start = background.indexOf('const TOKEN_USAGE_FEATURES');
  const end = background.indexOf('function aggregateNotificationTokenUsage', start);
  assert.ok(start >= 0 && end > start);
  const taskIds = [
    'document_highlight', 'evidence_ledger_review', 'paragraph_summary',
    'article_outline_summary', 'abbreviation_translation', 'figure_walkthrough',
    'figure_panel_interpretation', 'figure_panel_followup',
    'cross_figure_mechanism', 'paper_research_logic', 'paper_innovations',
    'paper_limitations', 'literature_note_autofill', 'article_chat', 'selection_chat'
  ];
  const context = {
    SciLLM: {
      LLM_TASK_IDS: taskIds,
      resolveLlmTaskId(messageType, branch) {
        const dispatch = new Map([
          ['LLM_ANALYZE_DOCUMENT:primary', 'document_highlight'],
          ['LLM_ANALYZE_DOCUMENT:evidence_ledger', 'evidence_ledger_review'],
          ['LLM_ANALYZE_REVIEW_OUTLINE:paragraph', 'paragraph_summary'],
          ['LLM_ANALYZE_REVIEW_OUTLINE:outline', 'article_outline_summary'],
          ['LLM_TRANSLATE_ABBREVIATIONS:default', 'abbreviation_translation'],
          ['LLM_ANALYZE_FIGURES:default', 'figure_walkthrough'],
          ['LLM_ANALYZE_FIGURE_PANEL:default', 'figure_panel_interpretation'],
          ['LLM_ASK_FIGURE_PANEL:default', 'figure_panel_followup'],
          ['LLM_ANALYZE_CROSS_FIGURE_LOGIC:default', 'cross_figure_mechanism'],
          ['LLM_ANALYZE_RESEARCH_LOGIC:default', 'paper_research_logic'],
          ['LLM_ANALYZE_PAPER_INNOVATION:default', 'paper_innovations'],
          ['LLM_ANALYZE_PAPER_LIMITATIONS:default', 'paper_limitations'],
          ['LLM_AUTOFILL_LITERATURE_NOTE:default', 'literature_note_autofill'],
          ['LLM_ASK_ARTICLE:article', 'article_chat'],
          ['LLM_ASK_ARTICLE:selection', 'selection_chat']
        ]);
        const taskId = dispatch.get(`${messageType}:${branch}`);
        if (!taskId) throw new Error('UNKNOWN_LLM_TASK');
        return taskId;
      },
      getLlmTaskDefinition(taskId) {
        if (!taskIds.includes(taskId)) throw new Error('UNKNOWN_LLM_TASK');
        return { id: taskId, labelZh: `label:${taskId}` };
      }
    },
    tokenUsageStore: { record() { throw new Error('not used'); } },
    console
  };
  vm.runInNewContext(
    `${background.slice(start, end)}; globalThis.resolveFeature = resolveTokenUsageFeature;`,
    context
  );

  assert.deepEqual(
    Array.from(context.resolveFeature(
      { type: 'LLM_ANALYZE_DOCUMENT' },
      { featureId: 'evidence_ledger_review' }
    )),
    ['evidence_ledger_review', 'label:evidence_ledger_review']
  );
  assert.deepEqual(
    Array.from(context.resolveFeature(
      { type: 'LLM_ANALYZE_DOCUMENT' },
      { featureId: 'article_chat' }
    )),
    ['document_highlight', 'label:document_highlight']
  );
  assert.deepEqual(
    Array.from(context.resolveFeature(
      { type: 'LLM_ANALYZE_REVIEW_OUTLINE', paragraphOnly: true },
      { featureId: 'highlight' }
    )),
    ['paragraph_summary', 'label:paragraph_summary']
  );
  assert.deepEqual(
    Array.from(context.resolveFeature(
      { type: 'LLM_ANALYZE_REVIEW_OUTLINE' },
      { featureId: '__proto__' }
    )),
    ['article_outline_summary', 'label:article_outline_summary']
  );
  assert.deepEqual(
    Array.from(context.resolveFeature(
      { type: 'LLM_ASK_ARTICLE', selectionEvidence: { text: 'selected' } },
      { featureId: 'article_chat' }
    )),
    ['selection_chat', 'label:selection_chat']
  );
  assert.deepEqual(
    Array.from(context.resolveFeature(
      { type: 'LLM_ANALYZE_FIGURE_PANEL' },
      { featureId: 'figure_panel_followup' }
    )),
    ['figure_panel_interpretation', 'label:figure_panel_interpretation']
  );
  assert.equal(context.resolveFeature(
    { type: 'LLM_UNKNOWN' }, { featureId: 'legacy_alias' }
  ), null);
});
