(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const CONTENT_SCRIPT_FILES = [
    'core/i18n.js',
    'core/i18n-extension.js',
    'core/i18n-reader.js',
    'core/i18n-reader-extra.js',
    'core/i18n-system.js',
    'core/i18n-tools.js',
    'core/i18n-reader-patterns.js',
    'core/i18n-sharing.js',
    'core/i18n-content.js',
    'core/page-tools.js',
    'core/task-telemetry.js',
    'core/operation-control.js',
    'core/category-store.js',
    'core/highlight-presentation.js',
    'core/confidence-policy.js',
    'core/result-validator.js',
    'core/sentence-boundary.js',
    'core/publisher-adapters.js',
    'core/article-structure.js',
    'core/paragraph-note-markers.js',
    'core/article-extractor.js',
    'core/article-bibliography.js',
    'core/article-preindex.js',
    'core/abbreviation-extractor.js',
    'core/article-chat-citations.js',
    'core/article-chat-attachments.js',
    'core/article-chat.js',
    'core/article-chat-web-sources.js',
    'core/publisher-diagnostics.js',
    'core/highlight-distribution.js',
    'core/supplemental-materials.js',
    'core/pdf-workspace.js',
    'core/supplemental-docx-parts.js',
    'core/supplemental-docx-figures.js',
    'core/supplemental-docx-inspection.js',
    'core/supplemental-pdf-source.js',
    'core/figure-extractor.js',
    'core/figure-source-lease.js',
    'core/figure-viewer.js',
    'core/figure-image-tiles.js',
    'core/figure-analysis.js',
    'core/figure-result-binding.js',
    'core/figure-stage-diagnostics.js',
    'core/faithful-page-snapshot.js',
    'core/research-logic-map.js',
    'core/panel-ledger.js',
    'core/evidence-first-mechanism.js',
    'core/cross-figure-logic.js',
    'core/pdf-annotations.js',
    'core/manual-annotations.js',
    'core/pdf-native-document.js',
    'core/reading-tools.js',
    'core/cache-planner.js',
    'core/review-outline.js',
    'core/privacy-sanitizer.js',
    'core/article-workspace.js',
    'core/article-workspace-save.js',
    'core/article-archive.js',
    'core/export-bundle.js',
    'core/i18n-export.js',
    'core/mechanism-canvas-model.js',
    'core/research-workbench-canvas-interaction.js',
    'core/mechanism-drawing-layout.js',
    'core/mechanism-drawing-ui.js',
    'core/mechanism-drawing-bridge.js',
    'core/mechanism-network.js',
    'core/figure-workspace.js',
    'core/semantic-find.js',
    'core/semantic-find-dom.js',
    'semantic-find-controller.js',
    'core/translation-source.js',
    'core/translation-checkpoint.js',
    'core/selection-tts.js',
    'core/local-translator.js',
    'core/bilingual-translation-controller.js',
    'bilingual-translation-content.js',
    'core/llm-task-catalog.js',
    'core/token-budget.js',
    'core/tts-service.js',
    'core/adaptive-catalog.js',
    'core/settings-store.js',
    'core/i18n-builtins.js',




    'sharing/client.js',
    'sharing/dialog.js',
    'content.js',
    'semantic-find-content.js',
    'page-load-indicator-content.js'
  ];
  const CONTENT_STYLE_FILES = ['content.css', 'semantic-find.css', 'bilingual-translation.css', 'sharing/sharing.css'];
  const CONTENT_SCRIPT_REVISION =
    '1.0.1-visibility-sharing-r37-v26';
  const CONTENT_SCRIPT_RELOADABLE_PREDECESSORS = new Set([
    '1.0.1-visibility-sharing-r37-v25',
    '1.0.1-visibility-sharing-r37-v24',
    '1.0.1-visibility-sharing-r37-v23',
    '1.0.1-visibility-sharing-r37-v22',
    '1.0.1-visibility-sharing-r37-v21',
    '1.0.1-visibility-sharing-r37-v20',
    '1.0.1-visibility-sharing-r37-v19',
    '1.0.1-reliability-r34-figure-retry-v18',
    '1.0.1-reliability-r33-figure-source-v17',
    '1.0.1-reliability-r32-paragraph-notes-v16',
    '1.0.1-reliability-r31-evidence-v15',
    '1.0.1-reliability-r31-evidence-v14',
    '1.0.1-reliability-r30-evidence-v13',
    '1.0.1-reliability-r30-evidence-v12',
    '1.0.1-reliability-r30-evidence-v11',
    '1.0.1-reliability-r29-evidence-v10',
    '1.0.1-reliability-r29-evidence-v9',
    '1.0.1-reliability-r29-evidence-v8',
    '1.0.1-reliability-r29-evidence-v5',
    '1.0.1-reliability-r29-evidence-v4',
    '1.0.1-reliability-r29-evidence-v3',
    '1.0.1-reliability-r29-evidence-v2',
    '1.0.1-reliability-r29-evidence-v1',
    '1.0.1-reliability-r26',
    '1.0.1-local-bilingual-v2',
    '1.0.1-local-bilingual-v1',
    '1.0.1-r16-figure-workspace-v1',
    '1.0.1-semantic-find-v1',
    '1.0.1-article-extraction-resilience-v2',
    '1.0.1-article-preindex-performance-v1',
    '1.0.1-article-preindex-contract-v1'
  ]);
  const FIGURE_EXTRACTOR_REVISION =
    '1.0.1-build2-nature-extended-data';
  const recoveryByTab = new Map();
  const revisionRecoveryByTab = new Map();
  const verifiedRevisionByTab = new Map();
  const recoveryEpochByTab = new Map();
  const CONTENT_INJECTION_CLAIM = 'sciLlmContentInjectionClaim';
  const CONTENT_INJECTION_READY = 'sciLlmContentInjectionReady';
  const CONTENT_INJECTION_BINDING = 'sciLlmContentInjectionBinding';
  const CONTENT_INJECTION_OWNER = 'sciLlmContentInjectionOwner';

  function isMissingReceiverError(error) {
    const message = String(error?.message || error || '');
    return /Could not establish connection|Receiving end does not exist/i.test(message);
  }

  function normalizeNavigationUrl(value) {
    try {
      const url = new URL(String(value || ''));
      url.hash = '';
      return url.href;
    } catch {
      return String(value || '');
    }
  }

  function staleNavigationError() {
    const error = new Error('TAB_MESSAGE_NAVIGATION_STALE');
    error.code = 'TAB_MESSAGE_NAVIGATION_STALE';
    return error;
  }

  function receiverRevisionError() {
    return new Error('CONTENT_SCRIPT_RECEIVER_REVISION_MISMATCH');
  }

  function receiverIdentityError() {
    return new Error('CONTENT_SCRIPT_RECEIVER_IDENTITY_MISMATCH');
  }

  function receiverDocumentIdentityError() {
    return new Error('CONTENT_SCRIPT_RECEIVER_DOCUMENT_IDENTITY_MISMATCH');
  }

  function domRevisionError() {
    return new Error('CONTENT_SCRIPT_DOM_REVISION_MISMATCH');
  }

  function navigationBinding(tabId, options = {}) {
    const expectedUrl = normalizeNavigationUrl(options.expectedUrl);
    if (!expectedUrl) return null;
    return Object.freeze({
      tabId,
      expectedUrl,
      contextKey: String(options.contextKey || '')
    });
  }

  function sameNavigationBinding(left, right) {
    return Boolean(left && right &&
      left.tabId === right.tabId &&
      left.expectedUrl === right.expectedUrl &&
      left.contextKey === right.contextKey);
  }

  function bindingKey(binding) {
    return binding
      ? `${binding.expectedUrl}\u0000${binding.contextKey}`
      : '';
  }

  function recoveryEpoch(tabId) {
    return recoveryEpochByTab.get(tabId) || 0;
  }

  function recoveryOptionsFor(tabId, options, epoch) {
    const callerIsCurrent = options.isCurrent;
    return {
      ...options,
      isCurrent: () => recoveryEpoch(tabId) === epoch &&
        (typeof callerIsCurrent !== 'function' || callerIsCurrent() === true)
    };
  }

  function isOwnedPdfReader(chromeApi, value) {
    try {
      const actual = new URL(String(value || ''));
      const owned = new URL(chromeApi.runtime.getURL('pdf-reader.html'));
      return actual.protocol === 'chrome-extension:' && actual.protocol === owned.protocol &&
        actual.host === owned.host && actual.pathname === owned.pathname;
    } catch (_) { return false; }
  }

  async function resolveOwnPdfReaderSenderTab(chromeApi, sender) {
    if (sender?.id !== chromeApi.runtime.id || !Number.isInteger(sender?.tab?.id) ||
        !isOwnedPdfReader(chromeApi, sender.url) || !sender.documentId) {
      throw staleNavigationError();
    }
    // MessageSender.url may retain the document's initial URL after replaceState.
    // Address its browser-owned document ID to read the live navigation binding.
    const receipt = await chromeApi.tabs.sendMessage(sender.tab.id,
      { action: 'getContentScriptRevision' }, { documentId: sender.documentId });
    if (receipt?.contentRevision !== CONTENT_SCRIPT_REVISION || !receipt.documentIdentity ||
        !isOwnedPdfReader(chromeApi, receipt.navigationIdentity)) throw staleNavigationError();
    return { ...sender.tab, url: normalizeNavigationUrl(receipt.navigationIdentity), pendingUrl: '' };
  }

  async function assertMessageCurrent(chromeApi, tabId, options = {}) {
    if (typeof options.isCurrent === 'function' && options.isCurrent() !== true) {
      throw staleNavigationError();
    }
    const expectedUrl = normalizeNavigationUrl(options.expectedUrl);
    if (options.expectedDocumentId) {
      const frame = await chromeApi.webNavigation.getFrame({ tabId, frameId: 0 });
      if (frame?.documentId !== options.expectedDocumentId || frame.documentLifecycle !== 'active') throw staleNavigationError();
    }
    if (!expectedUrl || typeof chromeApi?.tabs?.get !== 'function') return;
    const tab = await chromeApi.tabs.get(tabId);
    const observedUrl = normalizeNavigationUrl(tab?.url || tab?.pendingUrl);
    let ownPdfReader = false;
    try {
      const expected = new URL(expectedUrl);
      const owned = new URL(chromeApi.runtime.getURL('pdf-reader.html'));
      ownPdfReader = expected.protocol === 'chrome-extension:' &&
        expected.protocol === owned.protocol && expected.host === owned.host &&
        expected.pathname === owned.pathname;
    } catch (_) {}
    if (!observedUrl && ownPdfReader) {
      // A click inside our reader does not grant activeTab. Chromium can omit
      // tabs.get().url even for our own extension page; prove that page through
      // its live receiver instead of treating missing metadata as navigation.
      const receipt = await chromeApi.tabs.sendMessage(tabId, { action: 'getContentScriptRevision' });
      const verified = verifiedRevisionByTab.get(tabId);
      if (receipt?.contentRevision !== CONTENT_SCRIPT_REVISION ||
          normalizeNavigationUrl(receipt?.navigationIdentity) !== expectedUrl ||
          !String(receipt?.documentIdentity || '') ||
          (sameNavigationBinding(verified?.binding, navigationBinding(tabId, options)) &&
            verified?.documentIdentity && verified.documentIdentity !== receipt.documentIdentity) ||
          (typeof options.isCurrent === 'function' && options.isCurrent() !== true)) {
        throw staleNavigationError();
      }
      return;
    }
    if (observedUrl !== expectedUrl ||
        (typeof options.isCurrent === 'function' && options.isCurrent() !== true)) {
      throw staleNavigationError();
    }
  }

  function recoveryBinding(tabId, options = {}) {
    return bindingKey(navigationBinding(tabId, options));
  }

  function messageWithNavigationIdentity(tabId, message, options = {}) {
    const binding = navigationBinding(tabId, options);
    if (!binding || !message || typeof message !== 'object' ||
        Array.isArray(message)) return message;
    const verified = verifiedRevisionByTab.get(tabId);
    const documentIdentity = sameNavigationBinding(verified?.binding, binding)
      ? String(verified.documentIdentity || '') : '';
    if (!documentIdentity) throw receiverDocumentIdentityError();
    return {
      ...message,
      expectedNavigationIdentity: binding.expectedUrl,
      expectedDocumentIdentity: documentIdentity
    };
  }

  function isStaleNavigationReceipt(receipt) {
    return receipt?.code === 'TAB_MESSAGE_NAVIGATION_STALE' ||
      receipt?.error?.code === 'TAB_MESSAGE_NAVIGATION_STALE';
  }

  async function dispatchBoundTabMessage(chromeApi, tabId, message, options = {}) {
    const receipt = await chromeApi.tabs.sendMessage(
      tabId,
      messageWithNavigationIdentity(tabId, message, options)
    );
    await assertMessageCurrent(chromeApi, tabId, options);
    if (isStaleNavigationReceipt(receipt)) throw staleNavigationError();
    // This read always has a structured reply. Passive listeners can answer
    // with no value while the current content receiver is still being injected.
    if (receipt == null && message?.action === 'getArticleWorkspaceSnapshot') {
      throw Object.assign(new Error('Could not establish connection. Receiving end does not exist.'), {
        code: 'CONTENT_SCRIPT_EMPTY_WORKSPACE_RESPONSE'
      });
    }
    return receipt;
  }

  async function probeContentScriptReceiver(chromeApi, tabId, options = {}) {
    await assertMessageCurrent(chromeApi, tabId, options);
    const receipt = await chromeApi.tabs.sendMessage(tabId, {
      action: 'getContentScriptRevision'
    });
    await assertMessageCurrent(chromeApi, tabId, options);
    // Passive translation/load listeners can exist before content.js. An
    // empty probe requires injection and a fresh, fully bound handshake.
    if (receipt == null) {
      throw new Error('Could not establish connection. Receiving end does not exist.');
    }
    if (receipt?.contentRevision !== CONTENT_SCRIPT_REVISION) {
      throw receiverRevisionError();
    }
    const binding = navigationBinding(tabId, options);
    if (binding && normalizeNavigationUrl(receipt?.navigationIdentity) !== binding.expectedUrl) {
      throw receiverIdentityError();
    }
    if (binding && !String(receipt?.documentIdentity || '')) {
      throw receiverDocumentIdentityError();
    }
    return receipt;
  }

  function markContentScriptVerified(tabId, options = {}, receipt = {}) {
    const binding = navigationBinding(tabId, options);
    const documentIdentity = String(receipt?.documentIdentity || '');
    if (binding && documentIdentity) {
      verifiedRevisionByTab.set(tabId, {
        revision: CONTENT_SCRIPT_REVISION,
        binding,
        documentIdentity
      });
    }
  }

  async function inspectLiveContentRevision(chromeApi, tabId) {
    try {
      const results = await chromeApi.scripting.executeScript({
        target: { tabId },
        func: () => String(
          document.documentElement?.dataset?.sciLlmContentRevision || ''
        )
      });
      const revision = String(results?.[0]?.result || '');
      return ['ready', 'waiting', 'claimed'].includes(revision) ? '' : revision;
    } catch {
      return '';
    }
  }

  async function waitForReloadedTab(chromeApi, tabId) {
    let sawLoading = false;
    let elapsedMs = 0;
    for (const delayMs of [75, 125, 200, 350, 600, 900, 1400, 2200]) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
      elapsedMs += delayMs;
      const tab = await chromeApi.tabs.get(tabId).catch(() => null);
      if (tab?.status === 'loading') sawLoading = true;
      if (tab?.status === 'complete' && (sawLoading || elapsedMs >= 400)) return;
    }
    throw new Error('CONTENT_SCRIPT_RELOAD_TIMEOUT');
  }

  function ensureCompatibleContentRevision(chromeApi, tabId, options = {}) {
    const binding = navigationBinding(tabId, options);
    const verified = verifiedRevisionByTab.get(tabId);
    if (binding && verified?.revision === CONTENT_SCRIPT_REVISION &&
        sameNavigationBinding(verified.binding, binding)) {
      return Promise.resolve();
    }
    const epoch = recoveryEpoch(tabId);
    const guardedOptions = recoveryOptionsFor(tabId, options, epoch);
    const existing = revisionRecoveryByTab.get(tabId);
    if (existing && existing.epoch === epoch &&
        sameNavigationBinding(existing.binding, binding)) return existing.promise;
    const recovery = (async () => {
      await assertMessageCurrent(chromeApi, tabId, guardedOptions);
      const liveRevision = await inspectLiveContentRevision(chromeApi, tabId);
      await assertMessageCurrent(chromeApi, tabId, guardedOptions);
      if (!liveRevision) return;
      if (liveRevision === CONTENT_SCRIPT_REVISION) {
        if (binding) {
          try {
            const receipt = await probeContentScriptReceiver(chromeApi, tabId, guardedOptions);
            markContentScriptVerified(tabId, guardedOptions, receipt);
          } catch (error) {
            // A current DOM marker only proves the page once hosted this
            // revision. A missing receiver is the one recoverable condition;
            // leave it unverified so the caller enters the controlled injector.
            if (!isMissingReceiverError(error)) throw error;
          }
        }
        return;
      }
      if (!CONTENT_SCRIPT_RELOADABLE_PREDECESSORS.has(liveRevision) ||
          typeof chromeApi.tabs.reload !== 'function') {
        // Minimal test/browser shims may omit reload. The subsequent business
        // send still follows the missing-receiver reinjection path.
        return;
      }
      await chromeApi.tabs.reload(tabId);
      await assertMessageCurrent(chromeApi, tabId, guardedOptions);
      await waitForReloadedTab(chromeApi, tabId);
      await assertMessageCurrent(chromeApi, tabId, guardedOptions);
      await ensureContentScript(chromeApi, tabId, guardedOptions);
      await assertMessageCurrent(chromeApi, tabId, guardedOptions);
      if (binding) {
        const receipt = await probeContentScriptReceiver(chromeApi, tabId, guardedOptions);
        markContentScriptVerified(tabId, guardedOptions, receipt);
      }
    })();
    const entry = { binding, epoch, promise: recovery };
    revisionRecoveryByTab.set(tabId, entry);
    recovery.finally(() => {
      if (revisionRecoveryByTab.get(tabId) === entry) {
        revisionRecoveryByTab.delete(tabId);
      }
    }).catch(() => undefined);
    return recovery;
  }

  async function inspectContentInjection(chromeApi, target, claim, binding, owner = '', deferArticlePreindex = false) {
    const results = await chromeApi.scripting.executeScript({
      target,
      func: (shouldClaim, claimKey, readyKey, bindingKeyName, expectedRevision,
        expectedBinding, expectedUrl, ownerKey, expectedOwner, deferPreindex) => {
        const root = document.documentElement;
        if (!root) return 'waiting';
        let liveUrl = String(globalThis.location?.href || '');
        try {
          const parsed = new URL(liveUrl);
          parsed.hash = '';
          liveUrl = parsed.href;
        } catch (_) {
          liveUrl = liveUrl.replace(/#.*/, '');
        }
        if (expectedUrl && liveUrl !== expectedUrl) return 'stale';
        if (!shouldClaim) {
          return root.dataset[readyKey] === expectedRevision ? 'ready' : 'waiting';
        }
        // ensureContentScript is reached only after a real message-receiver
        // failure. A DOM revision marker can outlive an invalidated extension
        // world after reload/update, so it must never suppress reinjection.
        // The sidebar and worker have independent JS maps and caller bindings,
        // but share this document. Neither may replace the other's active claim.
        if (root.dataset[claimKey] === expectedRevision) {
          return 'waiting';
        }
        delete root.dataset[readyKey];
        delete root.dataset[bindingKeyName];
        root.dataset[claimKey] = expectedRevision;
        root.dataset[bindingKeyName] = expectedBinding;
        root.dataset[ownerKey] = expectedOwner;
        // A standalone search uses its own DOM index. Do not block its first
        // paint on the unrelated full article preindex; explicit reader actions
        // still use the existing warm/extract paths when needed.
        globalThis.__brevessDeferArticlePreindex = deferPreindex === true;
        return 'claimed';
      },
      args: [
        claim === true,
        CONTENT_INJECTION_CLAIM,
        CONTENT_INJECTION_READY,
        CONTENT_INJECTION_BINDING,
        CONTENT_SCRIPT_REVISION,
        bindingKey(binding),
        binding?.expectedUrl || '',
        CONTENT_INJECTION_OWNER,
        owner,
        deferArticlePreindex === true
      ]
    });
    // Keep all subsequent CSS/files/claim commits on this browser-owned
    // document, including when a same-URL reload changes the tab's document.
    if (results?.[0]?.documentId && !target.documentIds) {
      target.documentIds = [results[0].documentId];
    }
    return results?.[0]?.result || (claim ? 'claimed' : 'waiting');
  }

  async function waitForContentInjection(chromeApi, target, binding) {
    for (const delayMs of [0, 10, 25, 50, 100, 200, 400, 800, 1600, 3200]) {
      if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
      const state = await inspectContentInjection(chromeApi, target, false, binding);
      if (state === 'stale') throw staleNavigationError();
      if (state === 'ready') return;
    }
    throw new Error('CONTENT_SCRIPT_INJECTION_TIMEOUT');
  }

  async function setContentInjectionState(chromeApi, target, ready, binding, owner) {
    const results = await chromeApi.scripting.executeScript({
      target,
      func: (isReady, claimKey, readyKey, bindingKeyName, expectedRevision,
        expectedBinding, expectedUrl, ownerKey, expectedOwner) => {
        const root = document.documentElement;
        if (!root) return 'waiting';
        let liveUrl = String(globalThis.location?.href || '');
        try {
          const parsed = new URL(liveUrl);
          parsed.hash = '';
          liveUrl = parsed.href;
        } catch (_) {
          liveUrl = liveUrl.replace(/#.*/, '');
        }
        if (expectedUrl && liveUrl !== expectedUrl) return 'stale';
        if (root.dataset[ownerKey] !== expectedOwner) return 'waiting';
        if (isReady) {
          root.dataset[readyKey] = expectedRevision;
          root.dataset[bindingKeyName] = expectedBinding;
          delete root.dataset[claimKey];
        } else {
          delete root.dataset[claimKey];
          delete root.dataset[readyKey];
          delete root.dataset[bindingKeyName];
        }
        delete root.dataset[ownerKey];
        return 'ready';
      },
      args: [
        ready === true,
        CONTENT_INJECTION_CLAIM,
        CONTENT_INJECTION_READY,
        CONTENT_INJECTION_BINDING,
        CONTENT_SCRIPT_REVISION,
        bindingKey(binding),
        binding?.expectedUrl || '',
        CONTENT_INJECTION_OWNER,
        owner
      ]
    });
    const state = results?.[0]?.result || 'waiting';
    if (state === 'stale') throw staleNavigationError();
    return state;
  }

  function ensureContentScript(chromeApi, tabId, options = {}) {
    const existing = recoveryByTab.get(tabId);
    const binding = navigationBinding(tabId, options);
    const bindingId = recoveryBinding(tabId, options);
    const epoch = recoveryEpoch(tabId);
    const guardedOptions = recoveryOptionsFor(tabId, options, epoch);
    if (existing?.binding === bindingId && existing.epoch === epoch) return existing.promise;
    if (existing) {
      return existing.promise.catch(() => undefined).then(() =>
        ensureContentScript(chromeApi, tabId, options)
      );
    }
    const target = options.expectedDocumentId ? { tabId, documentIds: [options.expectedDocumentId] } : { tabId };
    const owner = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    const recovery = (async () => {
      await assertMessageCurrent(chromeApi, tabId, guardedOptions);
      const liveRevision = await inspectLiveContentRevision(chromeApi, tabId);
      await assertMessageCurrent(chromeApi, tabId, guardedOptions);
      if (liveRevision && liveRevision !== CONTENT_SCRIPT_REVISION &&
          !CONTENT_SCRIPT_RELOADABLE_PREDECESSORS.has(liveRevision)) {
        throw domRevisionError();
      }
      if (liveRevision === CONTENT_SCRIPT_REVISION) {
        // Another recovery may have completed after this caller first observed
        // a missing receiver. A different binding waits for that recovery, so
        // check the live receiver again before claiming a second injection.
        // The DOM marker alone still cannot prove an extension world is alive.
        try {
          const receipt = await probeContentScriptReceiver(chromeApi, tabId, guardedOptions);
          markContentScriptVerified(tabId, options, receipt);
          return;
        } catch (error) {
          if (!isMissingReceiverError(error)) throw error;
        }
      }
      const state = await inspectContentInjection(chromeApi, target, true, binding, owner, options.deferArticlePreindex);
      await assertMessageCurrent(chromeApi, tabId, guardedOptions);
      if (state === 'stale') throw staleNavigationError();
      if (state === 'ready') return;
      if (state === 'waiting') {
        try {
          await waitForContentInjection(chromeApi, target, binding);
          await assertMessageCurrent(chromeApi, tabId, guardedOptions);
          const receipt = await probeContentScriptReceiver(chromeApi, tabId, guardedOptions);
          markContentScriptVerified(tabId, options, receipt);
          return;
        } catch (error) {
          if (error?.message !== 'CONTENT_SCRIPT_INJECTION_TIMEOUT') throw error;
          try {
            const receipt = await probeContentScriptReceiver(chromeApi, tabId, guardedOptions);
            markContentScriptVerified(tabId, options, receipt);
            return;
          } catch (probeError) {
            if (!isMissingReceiverError(probeError)) throw probeError;
          }
          // A slow injection still owns its claim. A timeout is not evidence
          // that the owner died: fail this caller safely and allow a later
          // request to reuse the receiver once it finishes.
          throw error;
        }
      }
      try {
        await assertMessageCurrent(chromeApi, tabId, guardedOptions);
        await chromeApi.scripting.insertCSS({ target, files: CONTENT_STYLE_FILES });
        await assertMessageCurrent(chromeApi, tabId, guardedOptions);
        await chromeApi.scripting.executeScript({ target, files: CONTENT_SCRIPT_FILES });
        await assertMessageCurrent(chromeApi, tabId, guardedOptions);
        await setContentInjectionState(chromeApi, target, true, binding, owner);
        await assertMessageCurrent(chromeApi, tabId, guardedOptions);
      } catch (error) {
        await setContentInjectionState(chromeApi, target, false, binding, owner).catch(() => {});
        throw error;
      }
    })();
    const entry = { binding: bindingId, epoch, promise: recovery };
    recoveryByTab.set(tabId, entry);
    recovery.finally(() => {
      if (recoveryByTab.get(tabId) === entry) recoveryByTab.delete(tabId);
    }).catch(() => undefined);
    return recovery;
  }

  async function waitForVerifiedContentReceiver(chromeApi, tabId, options = {}) {
    let lastError = null;
    for (const delayMs of [0, 25, 75, 150]) {
      if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
      try {
        const receipt = await probeContentScriptReceiver(chromeApi, tabId, options);
        markContentScriptVerified(tabId, options, receipt);
        return;
      } catch (error) {
        if (!isMissingReceiverError(error)) throw error;
        lastError = error;
      }
    }
    throw lastError || new Error('CONTENT_SCRIPT_RECEIVER_UNAVAILABLE');
  }

  async function ensureContentScriptForActivation(chromeApi, tabId, options = {}) {
    await ensureCompatibleContentRevision(chromeApi, tabId, options);
    // A DOM marker can survive while an extension content world has gone away.
    // Confirm a receiver at the current revision before treating the marker as
    // reusable; a missing receiver must take the existing recovery injector.
    try {
      const receipt = await probeContentScriptReceiver(chromeApi, tabId, options);
      markContentScriptVerified(tabId, options, receipt);
      return;
    } catch (error) {
      if (!isMissingReceiverError(error)) throw error;
    }
    await ensureContentScript(chromeApi, tabId, options);
    await waitForVerifiedContentReceiver(chromeApi, tabId, options);
  }

  function forgetContentScriptState(tabId) {
    verifiedRevisionByTab.delete(tabId);
    recoveryByTab.delete(tabId);
    revisionRecoveryByTab.delete(tabId);
    recoveryEpochByTab.set(tabId, recoveryEpoch(tabId) + 1);
  }

  async function sendTabMessageWithRecovery(chromeApi, tabId, message, options = {}) {
    await assertMessageCurrent(chromeApi, tabId, options);
    await ensureCompatibleContentRevision(chromeApi, tabId, options);
    await assertMessageCurrent(chromeApi, tabId, options);
    if (navigationBinding(tabId, options)) {
      try {
        const receipt = await probeContentScriptReceiver(chromeApi, tabId, options);
        markContentScriptVerified(tabId, options, receipt);
      } catch (error) {
        if (!isMissingReceiverError(error)) throw error;
        await ensureContentScript(chromeApi, tabId, options);
        await waitForVerifiedContentReceiver(chromeApi, tabId, options);
      }
    }
    try {
      return await dispatchBoundTabMessage(chromeApi, tabId, message, options);
    } catch (error) {
      if (!isMissingReceiverError(error)) throw error;
      await assertMessageCurrent(chromeApi, tabId, options);
      await ensureContentScript(chromeApi, tabId, options);
      await waitForVerifiedContentReceiver(chromeApi, tabId, options);
      let lastError = error;
      const retryDelays = error?.code === 'CONTENT_SCRIPT_EMPTY_WORKSPACE_RESPONSE'
        ? [0] : [0, 25, 75, 150];
      for (const delayMs of retryDelays) {
        if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
        await assertMessageCurrent(chromeApi, tabId, options);
        try {
          return await dispatchBoundTabMessage(chromeApi, tabId, message, options);
        } catch (retryError) {
          if (!isMissingReceiverError(retryError) ||
              error?.code === 'CONTENT_SCRIPT_EMPTY_WORKSPACE_RESPONSE' ||
              retryError?.code === 'CONTENT_SCRIPT_EMPTY_WORKSPACE_RESPONSE') throw retryError;
          lastError = retryError;
          await ensureContentScript(chromeApi, tabId, options);
          await waitForVerifiedContentReceiver(chromeApi, tabId, options);
        }
      }
      throw lastError;
    }
  }

  async function sendTabMessageIfPresent(chromeApi, tabId, message) {
    try {
      return await chromeApi.tabs.sendMessage(tabId, message);
    } catch (error) {
      if (isMissingReceiverError(error)) return null;
      throw error;
    }
  }

  async function refreshFigureExtractorInTab(chromeApi, tabId) {
    const numericTabId = Number(tabId);
    if (!Number.isInteger(numericTabId) || numericTabId < 0) {
      throw new Error('INVALID_TAB_ID');
    }
    if (chromeApi?.tabs && typeof chromeApi.tabs.get === 'function') {
      await ensureCompatibleContentRevision(chromeApi, numericTabId);
    }
    await chromeApi.scripting.executeScript({
      target: { tabId: numericTabId },
      files: ['core/supplemental-materials.js', 'core/figure-extractor.js']
    });
    const results = await chromeApi.scripting.executeScript({
      target: { tabId: numericTabId },
      func: expectedRevision => {
        const root = document.documentElement;
        if (root) root.dataset.sciLlmFigureExtractorRevision = expectedRevision;
        const api = globalThis.SciLLM || {};
        if (typeof api.extractArticleFigures !== 'function') {
          return {
            revision: expectedRevision,
            available: false,
            probeFigureId: '',
            figures: []
          };
        }
        const figures = api.extractArticleFigures(document, []).map(figure => {
          const caption = String(figure?.caption || '').normalize('NFKC')
            .replace(/\s+/g, ' ').trim().slice(0, 12000);
          const captionBlocks =
            typeof api.splitFigureCaptionByPanelGroups === 'function'
              ? api.splitFigureCaptionByPanelGroups(caption).slice(0, 60)
                .map(block => ({
                  kind: block?.kind === 'panels' ? 'panels' : 'overview',
                  panels: Array.isArray(block?.panels)
                    ? block.panels.map(String).slice(0, 26) : [],
                  text: String(block?.text || '').normalize('NFKC')
                    .replace(/\s+/g, ' ').trim().slice(0, 6000)
                }))
                .filter(block => block.text)
              : [];
          return {
            figureId: String(figure?.figureId || ''),
            figureLabel: String(figure?.figureLabel || ''),
            hasImage: typeof api.selectFigureImageSource === 'function'
              ? Boolean(api.selectFigureImageSource(figure, document.baseURI))
              : Boolean(figure?.imageElements?.length),
            caption,
            captionBlocks,
            isSupplemental: figure?.isSupplemental === true,
            panelHints: Array.isArray(figure?.panelHints)
              ? figure.panelHints.map(String).slice(0, 30) : []
          };
        }).filter(figure => figure.figureId);
        return {
          revision: expectedRevision,
          available: true,
          probeFigureId: String(api.parseFigureLabel?.(
            'For a Figure360 author presentation of Figure 1'
          )?.figureId || ''),
          figures
        };
      },
      args: [FIGURE_EXTRACTOR_REVISION]
    });
    const diagnostic = results?.[0]?.result || null;
    if (!diagnostic?.available ||
        diagnostic.probeFigureId !== 'figure-1') {
      throw new Error('FIGURE_EXTRACTOR_HOTLOAD_FAILED');
    }
    return diagnostic;
  }

  return {
    CONTENT_SCRIPT_FILES,
    CONTENT_STYLE_FILES,
    CONTENT_SCRIPT_REVISION,
    FIGURE_EXTRACTOR_REVISION,
    CONTENT_INJECTION_CLAIM,
    CONTENT_INJECTION_READY,
    isMissingReceiverError,
    resolveOwnPdfReaderSenderTab,
    ensureContentScript,
    ensureContentScriptForActivation,
    ensureCompatibleContentRevision,
    forgetContentScriptState,
    sendTabMessageIfPresent,
    sendTabMessageWithRecovery,
    refreshFigureExtractorInTab
  };
});
