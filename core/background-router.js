(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  const RUNTIME_REVISION = '1.0.0-build1-store-release';
  const TASK_TIMEOUTS_MS = Object.freeze({
    highlight: 180000,
    summary: 180000,
    chat: 240000,
    figure: 300000,
    crossFigure: 300000
  });
  const TASK_CONCURRENCY = Object.freeze({
    highlight: 3,
    summary: 2,
    chat: 1,
    figure: 3,
    crossFigure: 1
  });
  const PREFERENCE_KEYS = new Set([
    'mode', 'language', 'providerId', 'consentGranted', 'autoAnalyze',
    'autoCacheFigureImages',
    'selectedCategoryIds',
    'confidenceThreshold', 'readingViewId', 'viewCategoryOverrides',
    'analysisModes', 'figurePanelFollowupPrompts', 'figurePanelFollowupPresets',
    'articleChatQuickPrompts',
    'keyboardShortcuts'
  ]);

  function invalidSettings(fields) {
    const error = new Error('Provider settings are incomplete or invalid');
    error.code = 'INVALID_SETTINGS';
    error.fields = fields;
    return error;
  }

  function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function cloneJsonLike(value) {
    if (Array.isArray(value)) return value.map(cloneJsonLike);
    if (!isPlainObject(value)) return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, cloneJsonLike(nested)])
    );
  }

  function deepMergeJsonLike(base, override) {
    if (override === undefined) return cloneJsonLike(base);
    if (!isPlainObject(base) || !isPlainObject(override)) {
      return cloneJsonLike(override);
    }
    const merged = cloneJsonLike(base);
    Object.entries(override).forEach(([key, value]) => {
      merged[key] = Object.prototype.hasOwnProperty.call(base, key)
        ? deepMergeJsonLike(base[key], value)
        : cloneJsonLike(value);
    });
    return merged;
  }

  function safeError(error) {
    const allowedCodes = new Set([
      'INVALID_SETTINGS', 'AUTH_INVALID', 'QUOTA_EXHAUSTED', 'REQUEST_TIMEOUT',
      'RATE_LIMITED', 'PROVIDER_UNAVAILABLE', 'PROVIDER_REJECTED', 'NETWORK_ERROR',
      'INVALID_RESPONSE', 'OUTPUT_TRUNCATED', 'CANCELLED', 'LLM_NOT_READY',
      'NO_USABLE_PROFILE', 'TOKEN_LIMIT_REJECTED', 'PARAGRAPH_STALE',
      'CONTEXT_BUDGET_EXCEEDED', 'CITATION_AMBIGUOUS', 'CITATION_STALE',
      'STUDY_TYPE_REQUIRED', 'ANNOTATION_LIMIT_REACHED', 'NOTE_TOO_LONG',
      'INVALID_ARCHIVE_SCHEMA', 'ARCHIVE_IDENTITY_MISMATCH',
      'ARTICLE_ARCHIVE_TOO_LARGE', 'ARTICLE_ARCHIVE_NOT_FOUND',
      'INVALID_JSON_ASSET', 'DIRECTORY_SYNC_UNAVAILABLE',
      'WORKSPACE_STORE_UNAVAILABLE', 'WORKSPACE_NOT_FOUND',
      'WORKSPACE_REVISION_CONFLICT', 'WORKSPACE_HASH_CONFLICT',
      'WORKSPACE_GENERATION_CONFLICT', 'WORKSPACE_DELETION_CONFLICT',
      'WORKSPACE_DELETION_PENDING', 'INVALID_WORKSPACE_GENERATION',
      'TURN_NOT_FOUND', 'TURN_ALREADY_EXISTS',
      'INVALID_WORKSPACE', 'INVALID_WORKSPACE_PATH', 'INVALID_WORKSPACE_MANIFEST',
      'INVALID_WORKSPACE_INDEX', 'WORKSPACE_CONTAINS_CREDENTIALS',
      'INVALID_MIGRATION_SCHEMA', 'INVALID_MIGRATION_SETTINGS',
      'INVALID_MIGRATION_DOCUMENTS', 'INVALID_MIGRATION_FEEDBACK',
      'MIGRATION_BUNDLE_TOO_LARGE',
      'CODEX_NOT_INSTALLED', 'CODEX_NOT_AUTHENTICATED',
      'CODEX_BRIDGE_UNAVAILABLE', 'CODEX_PROVIDER_REJECTED'
    ]);
    const portableConfigCode = /^PORTABLE_CONFIG_[A-Z0-9_]+$/u.test(String(error?.code || ''))
      ? String(error.code) : '';
    const code = allowedCodes.has(error?.code)
      ? error.code
      : portableConfigCode || 'INTERNAL_ERROR';
    const messages = {
      INVALID_SETTINGS: 'Provider settings are incomplete or invalid',
      AUTH_INVALID: 'API authentication failed',
      QUOTA_EXHAUSTED: 'API quota is exhausted',
      REQUEST_TIMEOUT: 'Provider request timed out',
      RATE_LIMITED: 'Provider rate limit reached',
      PROVIDER_UNAVAILABLE: 'Provider is temporarily unavailable',
      PROVIDER_REJECTED: 'Provider rejected the request',
      NETWORK_ERROR: 'Unable to reach the provider',
      INVALID_RESPONSE: 'Provider returned an invalid response',
      OUTPUT_TRUNCATED: 'Model output reached its token limit',
      CANCELLED: 'Provider request was cancelled',
      LLM_NOT_READY: 'LLM mode requires a configured provider and consent',
      NO_USABLE_PROFILE: 'No usable API profile is configured',
      CODEX_NOT_INSTALLED: 'Codex is not installed on this computer',
      CODEX_NOT_AUTHENTICATED: 'Codex is installed but not signed in',
      CODEX_BRIDGE_UNAVAILABLE: 'The local Codex bridge is unavailable',
      CODEX_PROVIDER_REJECTED: 'Local Codex rejected the request',
      TOKEN_LIMIT_REJECTED: 'Provider rejected the requested output token limit',
      PARAGRAPH_STALE: 'The requested paragraph is no longer in the document',
      CONTEXT_BUDGET_EXCEEDED: 'The selected model context window cannot fit this request',
      CITATION_AMBIGUOUS: 'The cited text matches more than one article location',
      CITATION_STALE: 'The article changed and the citation must be verified again',
      STUDY_TYPE_REQUIRED: 'Study type must be selected before analysis.',
      ANNOTATION_LIMIT_REACHED: 'This document has reached the annotation limit.',
      NOTE_TOO_LONG: 'The annotation note is too long.',
      INVALID_ARCHIVE_SCHEMA: 'The article archive format is invalid.',
      ARCHIVE_IDENTITY_MISMATCH: 'The article archive belongs to another document.',
      ARTICLE_ARCHIVE_TOO_LARGE: 'The article archive is too large.',
      ARTICLE_ARCHIVE_NOT_FOUND: 'No saved article archive was found.',
      INVALID_JSON_ASSET: 'The saved article archive is damaged.',
      DIRECTORY_SYNC_UNAVAILABLE: 'A local archive directory has not been configured.',
      WORKSPACE_STORE_UNAVAILABLE: 'Local article workspaces are unavailable.',
      WORKSPACE_NOT_FOUND: 'The local article workspace was not found.',
      WORKSPACE_REVISION_CONFLICT: 'The article workspace changed before this save completed.',
      WORKSPACE_HASH_CONFLICT: 'The article workspace content hash no longer matches.',
      WORKSPACE_GENERATION_CONFLICT: 'This save belongs to an older cleared workspace.',
      WORKSPACE_DELETION_CONFLICT: 'The article workspace deletion state changed.',
      WORKSPACE_DELETION_PENDING: 'The article workspace is being deleted.',
      INVALID_WORKSPACE_GENERATION: 'The article workspace generation is invalid.',
      TURN_NOT_FOUND: 'The saved chat turn is missing and must be recreated.',
      TURN_ALREADY_EXISTS: 'The saved chat turn already exists.',
      INVALID_WORKSPACE: 'The article workspace is invalid.',
      INVALID_WORKSPACE_PATH: 'The article workspace path is invalid.',
      INVALID_WORKSPACE_MANIFEST: 'The article workspace manifest is invalid.',
      INVALID_WORKSPACE_INDEX: 'The article workspace index is invalid.',
      WORKSPACE_CONTAINS_CREDENTIALS: 'Credentials cannot be stored in an article workspace.',
      INVALID_MIGRATION_SCHEMA: 'The migration file format is invalid.',
      INVALID_MIGRATION_SETTINGS: 'The migration settings are invalid.',
      INVALID_MIGRATION_DOCUMENTS: 'The migration document records are invalid.',
      INVALID_MIGRATION_FEEDBACK: 'The migration feedback records are invalid.',
      MIGRATION_BUNDLE_TOO_LARGE: 'The migration file is too large.',
      PORTABLE_CONFIG_FAILED: 'Portable configuration request failed.',
      INTERNAL_ERROR: 'Unable to complete the request'
    };
    if (portableConfigCode) messages[portableConfigCode] = messages.PORTABLE_CONFIG_FAILED;
    const result = {
      code,
      message: messages[code],
      runtimeRevision: RUNTIME_REVISION,
      retryable: error?.retryable === true,
      fields: code === 'INVALID_SETTINGS' ? error.fields || [] : undefined
    };
    const allowedDiagnosticStages = new Set(['request', 'response-body']);
    if (allowedDiagnosticStages.has(error?.diagnosticStage)) {
      result.diagnosticStage = error.diagnosticStage;
    }
    if (code !== 'INTERNAL_ERROR' && error?.diagnosticType) {
      result.diagnosticType = String(error.diagnosticType)
        .replace(/[^A-Za-z0-9_$-]/g, '').slice(0, 80) || 'Error';
    }
    if (Number.isFinite(error?.requestBytes)) {
      result.requestBytes = Math.max(0, Math.min(1000000, Math.round(error.requestBytes)));
    }
    if (Number.isFinite(error?.elapsedMs)) {
      result.elapsedMs = Math.max(0, Math.min(600000, Math.round(error.elapsedMs)));
    }
    if (Number.isFinite(error?.retryAfterMs) && error.retryAfterMs > 0) {
      result.retryAfterMs = Math.max(0, Math.min(300000, Math.round(error.retryAfterMs)));
    }
    if (Number.isFinite(error?.status) && error.status > 0) {
      result.status = Math.max(0, Math.min(599, Math.round(error.status)));
    }
    if (code === 'INTERNAL_ERROR') {
      const type = String(error?.name || 'Error').replace(/[^A-Za-z0-9_$-]/g, '').slice(0, 80);
      const diagnosticMessage = String(error?.message || 'Unknown internal error')
        .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
        .replace(/sk-[A-Za-z0-9_-]{8,}/gi, '[redacted]')
        .slice(0, 240);
      result.diagnosticType = type || 'Error';
      result.diagnosticMessage = diagnosticMessage;
    }
    return result;
  }

  function safePortableConfigError(error) {
    const code = /^PORTABLE_CONFIG_[A-Z0-9_]+$/u.test(String(error?.code || ''))
      ? String(error.code) : 'PORTABLE_CONFIG_FAILED';
    return Object.assign(new Error(code), {
      code,
      retryable: error?.retryable === true
    });
  }

  async function testAdapterWithRetry(adapter, request, maxAttempts = 2) {
    let attempt = 0;
    while (attempt < maxAttempts) {
      attempt += 1;
      try {
        return await adapter.analyzeChunk(request);
      } catch (error) {
        if (!error?.retryable || attempt >= maxAttempts) throw error;
      }
    }
    throw new Error('Provider connection test did not complete');
  }

  function publicCategory(category) {
    return {
      categoryId: category.categoryId,
      name: category.name,
      color: category.color,
      persistence: category.persistence,
      builtIn: category.builtIn,
      retired: category.retired === true,
      enabledEngines: Array.isArray(category.enabledEngines)
        ? [...category.enabledEngines] : ['llm', 'regex'],
      claimMode: category.claimMode || 'explicit',
      minimumConfidence: Number(category.minimumConfidence) || 0.8
    };
  }

  function publicStudyProfile(profile) {
    if (!profile) return null;
    return {
      ...profile,
      primaryTypeName: profile?.useTypeSpecificWarnings === false
        ? '通用分析'
        : shared.STUDY_TYPES?.[profile?.primaryType]?.name || profile?.primaryType || ''
    };
  }

  function normalizeUnifiedCustomCategory(category) {
    const normalized = shared.flattenUnifiedCategory(shared.toUnifiedCategory({
      ...category,
      builtIn: false
    }));
    normalized.categoryId = String(category?.categoryId || normalized.categoryId || '');
    normalized.persistence = category?.persistence === 'one-off' ? 'one-off' : 'saved';
    normalized.builtIn = false;
    return normalized;
  }

  function portableConfigStatus(value = {}) {
    return {
      state: String(value?.state || 'unknown'),
      revision: Math.max(0, Number(value?.revision) || 0),
      updatedAt: String(value?.updatedAt || ''),
      pending: value?.pending === true,
      lastError: String(value?.lastError || '')
    };
  }

  function createDisabledPortableConfigManager() {
    const status = () => portableConfigStatus({ state: 'disabled' });
    return Object.freeze({
      probe: status,
      create: status,
      unlock: status,
      rotatePassphrase: status,
      forgetKey: status,
      backupNow: status,
      status,
      publicStatus: status
    });
  }

  function createBackgroundRouter({
    storageArea,
    sessionStorageArea,
    fetchImpl,
    nativeClient = null,
    cacheStore = shared.createMemoryAnalysisCache(),
    corpusStore = shared.createMemoryCorpusStore(),
    documentStore = shared.createMemoryDocumentStore(),
    articleWorkspaceStore = null,
    tokenUsageStore = null,
    directorySync = null,
    portableConfigManager = createDisabledPortableConfigManager(),
    sleepImpl = delay => new Promise(resolve => setTimeout(resolve, delay))
  }) {
    let memorySessionCategories = [];
    const documentIdsByHash = new Map();
    let documentMutationTail = Promise.resolve();
    const operationRegistry = shared.createOperationRegistry?.();

    async function currentPortableConfigStatus() {
      const status = typeof portableConfigManager?.status === 'function'
        ? await portableConfigManager.status()
        : await portableConfigManager?.publicStatus?.();
      return portableConfigStatus(status);
    }

    function operationFor(message) {
      return operationRegistry?.getOrCreate(message?.operationId) || null;
    }

    async function waitForOperation(operation) {
      if (!operation) return;
      await operationRegistry.waitIfPaused(operation);
      operationRegistry.throwIfCancelled(operation);
    }

    async function sleepForOperation(delay, operation) {
      await waitForOperation(operation);
      const signal = operation?.controller?.signal;
      if (!signal) return sleepImpl(delay);
      let onAbort;
      const cancelled = new Promise((resolve, reject) => {
        onAbort = () => reject(shared.operationError());
        signal.addEventListener('abort', onAbort, { once: true });
      });
      try {
        await Promise.race([sleepImpl(delay), cancelled]);
      } finally {
        signal.removeEventListener('abort', onAbort);
      }
      await waitForOperation(operation);
    }

    function serializeDocumentMutation(operation) {
      const pending = documentMutationTail.then(operation, operation);
      documentMutationTail = pending.catch(() => undefined);
      return pending;
    }

    async function loadRouterSessionCategories() {
      if (sessionStorageArea) {
        return shared.loadSessionCategories(sessionStorageArea);
      }
      return memorySessionCategories.map(cloneJsonLike);
    }

    async function saveRouterSessionCategories(categories) {
      if (sessionStorageArea) {
        return shared.saveSessionCategories(sessionStorageArea, categories);
      }
      memorySessionCategories = Array.isArray(categories)
        ? categories.filter(item => item && typeof item === 'object').map(cloneJsonLike)
        : [];
      return memorySessionCategories.map(cloneJsonLike);
    }

    async function loadAllCategories(settings) {
      const sessionCustomCategories = await loadRouterSessionCategories();
      const savedCustomCategories = (settings.customCategories || [])
        .map(normalizeUnifiedCustomCategory);
      const normalizedSessionCategories = sessionCustomCategories
        .map(normalizeUnifiedCustomCategory);
      const customCategories = [...savedCustomCategories, ...normalizedSessionCategories];
      const categoryMap = shared.createUnifiedCategoryCatalog(settings.categoryOverrides);
      const deletedBuiltInCategoryIds = new Set(
        Array.isArray(settings.deletedBuiltInCategoryIds)
          ? settings.deletedBuiltInCategoryIds
          : []
      );
      deletedBuiltInCategoryIds.forEach(categoryId => {
        delete categoryMap[categoryId];
      });
      customCategories.forEach(category => { categoryMap[category.categoryId] = category; });
      return {
        savedCustomCategories,
        sessionCustomCategories: normalizedSessionCategories,
        customCategories,
        categoryMap
      };
    }

    async function publicState(settings) {
      const { customCategories, categoryMap } = await loadAllCategories(settings);
      const baseCatalog = shared.createUnifiedCategoryCatalog();
      const deletedBuiltInCategories = (settings.deletedBuiltInCategoryIds || [])
        .map(categoryId => baseCatalog[categoryId])
        .filter(Boolean)
        .map(publicCategory);
      return {
        settings: shared.toPublicSettings(settings),
        effectiveMode: shared.getEffectiveMode(settings),
        llmReady: shared.isLlmReady(settings),
        providers: shared.getProviderDefinitions(),
        compatibleProviderPresets: shared.getCompatibleProviderPresets(),
        panelFollowupDefaults: cloneJsonLike(shared.DEFAULT_PANEL_FOLLOWUP_PROMPTS || {}),
        panelFollowupPresetDefaults: cloneJsonLike(
          shared.DEFAULT_PANEL_FOLLOWUP_PRESETS || []
        ),
        articleChatQuickPromptDefaults: cloneJsonLike(
          shared.DEFAULT_ARTICLE_CHAT_QUICK_PROMPTS || []
        ),
        customCategories,
        deletedBuiltInCategories,
        studyTypes: shared.STUDY_TYPES,
        readingViews: Object.fromEntries((settings.analysisModes || []).map(mode => [
          mode.id,
          {
            name: mode.name,
            description: mode.description,
            categoryIds: [...mode.categoryIds]
          }
        ])),
        analysisModeDefaults: shared.createDefaultAnalysisModes(),
        availableCategories: Object.values(categoryMap).map(publicCategory)
      };
    }

    async function categoryDetail(settings, categoryId) {
      if (!/^[a-z][a-z0-9_]*$/.test(categoryId)) {
        throw invalidSettings(['categoryId']);
      }
      const baseCatalog = shared.createUnifiedCategoryCatalog();
      const baseCategory = baseCatalog[categoryId];
      if (baseCategory && (settings.deletedBuiltInCategoryIds || []).includes(categoryId)) {
        throw invalidSettings(['categoryId']);
      }
      const hasOverride = Boolean(baseCategory) && Object.prototype.hasOwnProperty.call(
        settings.categoryOverrides || {}, categoryId
      );
      let category;
      if (baseCategory) {
        category = shared.mergeCategoryOverrides(
          baseCategory,
          hasOverride ? settings.categoryOverrides[categoryId] : {}
        );
      } else {
        const { customCategories } = await loadAllCategories(settings);
        category = customCategories.find(item => item.categoryId === categoryId);
        if (!category) throw invalidSettings(['categoryId']);
      }
      const errors = shared.validateUnifiedCategory(category);
      if (errors.length) throw invalidSettings(errors);
      return {
        category,
        promptPreview: shared.compileCategoryPromptPreview(category),
        metadata: {
          builtIn: category.builtIn !== false,
          overridden: hasOverride
        }
      };
    }

    function requireLlmReady(settings) {
      if (!shared.isLlmReady(settings)) {
        const error = new Error('LLM mode is not ready');
        error.code = 'LLM_NOT_READY';
        throw error;
      }
    }

    function publicRoute(route) {
      return {
        taskType: route.taskType,
        requestedProfileId: route.requestedProfileId,
        effectiveProfileId: route.effectiveProfileId,
        effectiveProfileName: route.publicProfile.name,
        name: route.publicProfile.name,
        providerId: route.providerId,
        model: route.model,
        capabilityMode: route.capabilityMode,
        concurrency: TASK_CONCURRENCY[route.taskType] || 1,
        fallbackReason: route.fallbackReason
      };
    }

    function createTaskAdapter(
      settings, taskType, requirements = {}, context = {}, budgetKind, adapterOptions = {}
    ) {
      const route = shared.resolveTaskProfile(settings, taskType, requirements);
      const rawAdapter = shared.createProviderAdapter({
        providerId: route.providerId,
        config: route.config,
        fetchImpl,
        nativeClient
      });
      const routePublic = publicRoute(route);
      const tokenPolicyCap = Math.max(0, Number(adapterOptions.tokenPolicyCap) || 0);
      const effectiveTokenPolicy = tokenPolicyCap
        ? {
          ...route.tokenPolicy,
          ...(route.tokenPolicy?.mode === 'manual'
            ? { manualMax: Math.min(tokenPolicyCap, Number(route.tokenPolicy.manualMax) || tokenPolicyCap) }
            : { autoCap: Math.min(tokenPolicyCap, Number(route.tokenPolicy?.autoCap) || tokenPolicyCap) })
        }
        : route.tokenPolicy;
      const adapter = shared.createTokenManagedAdapter({
        rawAdapter,
        kind: budgetKind,
        tokenPolicy: effectiveTokenPolicy,
        adapterCap: rawAdapter.maxOutputTokens,
        requestTimeoutMs: TASK_TIMEOUTS_MS[taskType] || 180000,
        maxTokenLimitRetries: adapterOptions.maxTokenLimitRetries,
        maxTruncationRetries: adapterOptions.maxTruncationRetries,
        onProgress: event => context.onProgress?.({
          ...event,
          taskType,
          effectiveProfileId: route.effectiveProfileId,
          effectiveProfileName: route.publicProfile.name,
          route: routePublic
        })
      });
      return { adapter, rawAdapter, route, routePublic, tokenPolicy: effectiveTokenPolicy };
    }

    function routeProgress(context, routePublic) {
      return event => context.onProgress?.({
        ...event,
        taskType: routePublic.taskType,
        effectiveProfileId: routePublic.effectiveProfileId,
        effectiveProfileName: routePublic.effectiveProfileName,
        route: routePublic
      });
    }

    async function composeCategories(settings, profile) {
      const { customCategories } = await loadAllCategories(settings);
      const viewDefinition = (settings.analysisModes || [])
        .find(mode => mode.id === settings.readingViewId);
      return shared.composeReadingView({
        viewId: settings.readingViewId,
        viewDefinition,
        studyProfile: profile,
        override: settings.viewCategoryOverrides?.[settings.readingViewId],
        customCategories,
        categoryOverrides: settings.categoryOverrides,
        deletedBuiltInCategoryIds: settings.deletedBuiltInCategoryIds,
        engine: 'llm'
      });
    }

    async function composeManualCategories(settings, profile) {
      const { customCategories } = await loadAllCategories(settings);
      const viewDefinition = (settings.analysisModes || [])
        .find(mode => mode.id === settings.readingViewId);
      return shared.composeReadingView({
        viewId: settings.readingViewId,
        viewDefinition,
        studyProfile: profile,
        override: settings.viewCategoryOverrides?.[settings.readingViewId],
        customCategories,
        categoryOverrides: settings.categoryOverrides,
        deletedBuiltInCategoryIds: settings.deletedBuiltInCategoryIds
      });
    }

    async function prepareStoredDocumentUnsafe(settings, document) {
      const paragraphs = Array.isArray(document?.paragraphs) ? document.paragraphs : [];
      if (!paragraphs.length) throw invalidSettings(['paragraphs']);
      const documentHash = await shared.hashDocument(paragraphs);
      const computedDocumentId = await shared.createDocumentId({
        title: document?.title,
        canonicalUrl: document?.canonicalUrl || document?.url,
        doi: document?.doi,
        paragraphs
      });
      const requestedDocumentId = String(document?.documentId || '').trim();
      const previousDocumentHash = String(document?.previousDocumentHash || '').toLowerCase();
      let documentId = computedDocumentId;
      if (requestedDocumentId && /^[a-f0-9]{64}$/.test(previousDocumentHash)) {
        try {
          const existing = await documentStore.getDocument(requestedDocumentId);
          const knownHashes = new Set([
            existing?.documentHash,
            ...(Array.isArray(existing?.documentHashes) ? existing.documentHashes : [])
          ].filter(Boolean));
          if (existing && knownHashes.has(previousDocumentHash)) {
            documentId = requestedDocumentId;
          }
        } catch (_) {
          // Ignore stale or malformed identities and fall back to the current extraction.
        }
      }
      documentIdsByHash.set(documentHash, documentId);
      const legacyStudyType = settings.studyTypeOverrides?.[documentHash]?.studyType;
      const record = await documentStore.prepareDocument({
        schemaVersion: 1,
        documentId,
        title: document?.title || '',
        canonicalUrl: document?.canonicalUrl || document?.url || '',
        studyType: shared.isStudyType(legacyStudyType) ? legacyStudyType : null,
        annotations: [],
        revision: 0,
        updatedAt: '',
        documentHash,
        documentHashes: [documentHash],
        legacyStudyTypeMigrated: true
      });
      const profile = shared.createManualStudyProfile(record.studyType, document) || {
          ...shared.createFallbackStudyProfile('使用当前分析模式，不需要选择论文类型。'),
          primaryType: '',
          paperBlueprint: shared.deriveManualPaperBlueprint(document),
          requiresConfirmation: false,
          useTypeSpecificWarnings: false,
          manuallyOverridden: false
        };
      const composition = await composeManualCategories(settings, profile);
      return { documentId, documentHash, record, profile, composition, paragraphs };
    }

    function prepareStoredDocument(settings, document) {
      return serializeDocumentMutation(() =>
        prepareStoredDocumentUnsafe(settings, document)
      );
    }

    async function prepareDocument(settings, document) {
      requireLlmReady(settings);
      const stored = await prepareStoredDocument(settings, document);
      const { documentId, documentHash, record, profile, paragraphs } = stored;
      const composition = await composeCategories(settings, profile);
      return {
        documentId,
        documentHash,
        record,
        requiresStudyType: !profile,
        studyProfile: profile,
        paperBlueprint: profile?.paperBlueprint || null,
        readingViewId: composition.viewId,
        activeCategories: composition.categories,
        categorySources: composition.sources,
        paragraphs
      };
    }

    async function prepareParagraphOnlyReviewDocument(settings, message, requestedParagraphIds) {
      requireLlmReady(settings);
      const paragraphs = Array.isArray(message?.document?.paragraphs)
        ? message.document.paragraphs : [];
      const proof = message?.documentProof || {};
      const documentId = String(proof.documentId || '').trim();
      const documentHash = String(proof.documentHash || '').toLowerCase();
      const suppliedParagraphIds = paragraphs.map(paragraph =>
        String(paragraph?.paragraphId || '').trim()
      ).filter(Boolean);
      const suppliedIdSet = new Set(suppliedParagraphIds);
      if (!requestedParagraphIds.size || !paragraphs.length ||
          paragraphs.length !== requestedParagraphIds.size ||
          suppliedIdSet.size !== paragraphs.length ||
          !suppliedParagraphIds.every(id => requestedParagraphIds.has(id))) {
        throw invalidSettings(['scopeParagraphIds', 'paragraphs']);
      }
      if (!documentId || !/^[a-f0-9]{64}$/.test(documentHash)) {
        throw invalidSettings(['documentProof']);
      }
      const record = await documentStore.getDocument(documentId);
      const knownHashes = new Set([
        record?.documentHash,
        ...(Array.isArray(record?.documentHashes) ? record.documentHashes : [])
      ].map(value => String(value || '').toLowerCase()).filter(Boolean));
      if (!record || !knownHashes.has(documentHash)) {
        throw invalidSettings(['documentProof']);
      }
      const profile = shared.createManualStudyProfile(record.studyType, message.document) || {
          ...shared.createFallbackStudyProfile('使用当前分析模式，不需要选择论文类型。'),
          primaryType: '',
          paperBlueprint: shared.deriveManualPaperBlueprint(message.document),
          requiresConfirmation: false,
          useTypeSpecificWarnings: false,
          manuallyOverridden: false
        };
      const composition = await composeCategories(settings, profile);
      documentIdsByHash.set(documentHash, documentId);
      return {
        documentId,
        documentHash,
        record,
        requiresStudyType: !profile,
        studyProfile: profile,
        paperBlueprint: profile?.paperBlueprint || null,
        readingViewId: composition.viewId,
        activeCategories: composition.categories,
        categorySources: composition.sources,
        paragraphs
      };
    }

    function requireStudyType(prepared) {
      if (!prepared?.studyProfile) {
        const error = new Error('Study type must be selected before analysis.');
        error.code = 'STUDY_TYPE_REQUIRED';
        throw error;
      }
    }

    let settingsMutationTail = Promise.resolve();

    function serializeSettingsMutation(operation) {
      const pending = settingsMutationTail.then(operation, operation);
      settingsMutationTail = pending.catch(() => undefined);
      return pending;
    }

    function serializeAllMutations(operation) {
      const pending = Promise.all([
        settingsMutationTail.catch(() => undefined),
        documentMutationTail.catch(() => undefined)
      ]).then(operation);
      const settled = pending.catch(() => undefined);
      settingsMutationTail = settled;
      documentMutationTail = settled;
      return pending;
    }

    function requireVersion5Settings(settings) {
      if (Number(settings?.version) !== 5) throw invalidSettings(['version']);
    }

    function orderedProfileIds(settings) {
      const profiles = isPlainObject(settings?.profiles) ? settings.profiles : {};
      const seen = new Set();
      const result = [];
      (Array.isArray(settings?.profileOrder) ? settings.profileOrder : [])
        .forEach(profileId => {
          if (typeof profileId !== 'string' || seen.has(profileId) ||
              !Object.prototype.hasOwnProperty.call(profiles, profileId)) return;
          seen.add(profileId);
          result.push(profileId);
        });
      Object.keys(profiles).sort().forEach(profileId => {
        if (seen.has(profileId)) return;
        seen.add(profileId);
        result.push(profileId);
      });
      return result;
    }

    function publicProfileResult(profileId, profile) {
      const config = isPlainObject(profile?.config) ? profile.config : {};
      return {
        id: profileId,
        name: String(profile?.name || ''),
        providerId: profile?.providerId,
        model: String(config.model || ''),
        supportsVision: shared.getProviderCapabilities(
          profile?.providerId,
          config
        ).supportsVision === true
      };
    }

    function upsertProfile(settings, message) {
      requireVersion5Settings(settings);
      const incoming = isPlainObject(message?.profile) ? message.profile : message;
      const profileId = String(
        incoming?.id || incoming?.profileId || message?.profileId || ''
      );
      if (!shared.PROFILE_ID_PATTERN?.test(profileId)) {
        throw invalidSettings(['profileId']);
      }
      const current = isPlainObject(settings.profiles?.[profileId])
        ? settings.profiles[profileId] : null;
      const providerId = String(incoming?.providerId || current?.providerId || '');
      if (!Object.prototype.hasOwnProperty.call(
        shared.getProviderDefinitions(), providerId
      )) throw invalidSettings(['providerId']);
      if (incoming?.config !== undefined && !isPlainObject(incoming.config)) {
        throw invalidSettings(['config']);
      }

      const currentConfig = isPlainObject(current?.config) ? current.config : {};
      const incomingConfig = isPlainObject(incoming?.config) ? incoming.config : {};
      const config = { ...cloneJsonLike(currentConfig), ...cloneJsonLike(incomingConfig) };
      if (message?.clearApiKey === true) {
        config.apiKey = '';
      } else if (!String(incomingConfig.apiKey || '').trim() && currentConfig.apiKey) {
        config.apiKey = currentConfig.apiKey;
      }
      const candidate = {
        ...cloneJsonLike(current || {}),
        ...cloneJsonLike(incoming || {}),
        name: incoming?.name !== undefined ? incoming.name : current?.name,
        providerId,
        config,
        capabilities: incoming?.capabilities !== undefined
          ? cloneJsonLike(incoming.capabilities)
          : cloneJsonLike(current?.capabilities || {}),
        tokenPolicy: incoming?.tokenPolicy !== undefined
          ? cloneJsonLike(incoming.tokenPolicy)
          : cloneJsonLike(current?.tokenPolicy || {})
      };
      const normalized = shared.normalizeProfile(profileId, candidate);
      if (!normalized) throw invalidSettings(['profileId', 'providerId']);

      settings.profiles = isPlainObject(settings.profiles) ? settings.profiles : {};
      settings.profiles[profileId] = normalized;
      settings.profileOrder = orderedProfileIds(settings);
      if (!Object.prototype.hasOwnProperty.call(
        settings.profiles,
        settings.globalProfileId
      )) settings.globalProfileId = settings.profileOrder[0] || profileId;
      settings.taskRoutes = shared.normalizeTaskRoutes(
        settings.taskRoutes,
        settings.profiles
      );
      return { profileId, profile: normalized };
    }

    function duplicateProfileId(settings, sourceId) {
      const sourceStem = String(sourceId || '').replace(/^profile_/, '')
        .replace(/[^a-z0-9_]/g, '_').slice(0, 64) || 'copy';
      let suffix = 'copy';
      let sequence = 1;
      while (true) {
        const room = Math.max(3, 80 - 'profile_'.length - suffix.length - 1);
        const candidate = `profile_${sourceStem.slice(0, room)}_${suffix}`;
        if (!Object.prototype.hasOwnProperty.call(settings.profiles, candidate)) {
          return candidate;
        }
        sequence += 1;
        suffix = `copy_${sequence}`;
      }
    }

    async function runConnectionTest(profileId, profile, configOverride) {
      const currentConfig = isPlainObject(profile?.config) ? profile.config : {};
      const incomingConfig = isPlainObject(configOverride) ? configOverride : {};
      const config = { ...cloneJsonLike(currentConfig), ...cloneJsonLike(incomingConfig) };
      if (!String(incomingConfig.apiKey || '').trim() && currentConfig.apiKey) {
        config.apiKey = currentConfig.apiKey;
      }
      const errors = shared.validateProviderConfig(profile?.providerId, config);
      if (errors.length) throw invalidSettings(errors);
      const adapter = shared.createProviderAdapter({
        providerId: profile.providerId,
        config,
        fetchImpl,
        nativeClient
      });
      if (profile.providerId === 'codex-local' &&
          typeof adapter.testConnection === 'function') {
        const status = await adapter.testConnection({ timeoutMs: 120000 });
        return {
          connected: status?.connected === true,
          profileId,
          providerId: profile.providerId,
          model: config.model || 'auto',
          accountType: status?.accountType || '',
          planType: status?.planType || '',
          userAgent: status?.userAgent || ''
        };
      }
      const connectionParagraphs = [
        { paragraphId: 'connection-p1', sectionTitle: '', text: 'Treatment increased survival.' }
      ];
      const connectionPrompt = shared.compileAnalysisPrompt({
        categories: [shared.createBuiltInCategories().result],
        chunkId: 'connection-test',
        sectionTitle: '',
        paragraphs: connectionParagraphs
      });
      const result = await testAdapterWithRetry(adapter, {
        ...connectionPrompt,
        paragraphs: connectionParagraphs
      });
      if (!Array.isArray(result.paragraphs_reviewed) || !Array.isArray(result.annotations)) {
        const error = new Error('Invalid connection-test response');
        error.code = 'INVALID_RESPONSE';
        throw error;
      }
      return {
        connected: true,
        profileId,
        providerId: profile.providerId,
        model: config.model
      };
    }

    function categoryAsset(settings) {
      return {
        schemaVersion: 1,
        revision: Number(settings.userDataCategoryRevision) || 0,
        sourceId: 'extension',
        categoryOverrides: cloneJsonLike(settings.categoryOverrides || {}),
        deletedBuiltInCategoryIds: [...(settings.deletedBuiltInCategoryIds || [])],
        customCategories: cloneJsonLike(settings.customCategories || []),
        selectedCategoryIds: [...(settings.selectedCategoryIds || [])],
        viewCategoryOverrides: cloneJsonLike(settings.viewCategoryOverrides || {})
      };
    }

    function scheduleDirectoryFlush() {
      if (!directorySync?.flush) return;
      try {
        Promise.resolve(directorySync.flush(importUserDataAsset)).catch(() => undefined);
      } catch (_) {
        // Directory availability must never roll back a successful local mutation.
      }
    }

    async function mirrorJson(relativePath, value) {
      if (!directorySync?.enqueueJson) return;
      try {
        await directorySync.enqueueJson(relativePath, value);
        scheduleDirectoryFlush();
      } catch (_) {
        // The primary local stores remain authoritative while sync is unavailable.
      }
    }

    async function mirrorText(relativePath, value) {
      if (!directorySync?.enqueueText) return;
      try {
        await directorySync.enqueueText(relativePath, value);
        scheduleDirectoryFlush();
      } catch (_) {
        // The primary local stores remain authoritative while sync is unavailable.
      }
    }

    async function mirrorCategorySettings(settings) {
      await mirrorJson('categories.json', categoryAsset(settings));
    }

    async function mirrorDocumentRecord(record) {
      if (!record?.documentId) return;
      await mirrorJson(
        `annotations/${encodeURIComponent(record.documentId)}.json`,
        cloneJsonLike(record)
      );
    }

    function isWordCharacter(value) {
      return Boolean(value) && /[\p{L}\p{N}_]/u.test(value);
    }

    function regexMatches(regex, text, expressionRow, wholeWord) {
      const matches = [];
      let match;
      while ((match = regex.exec(text)) && matches.length <= 100) {
        const value = match[0];
        if (!value) {
          regex.lastIndex = Math.max(regex.lastIndex + 1, match.index + 1);
          continue;
        }
        const start = match.index;
        const end = start + value.length;
        if (!wholeWord || (
          !isWordCharacter(text[start - 1]) && !isWordCharacter(text[end])
        )) {
          matches.push({ expressionRow, start, end, text: value });
        }
      }
      return matches;
    }

    function escapeRegex(value) {
      return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function testCategoryRegex(category, text) {
      const flags = category.regex.caseSensitive ? 'g' : 'gi';
      const matches = [];
      const exclusions = [];
      (category.regex.excludePhrases || []).forEach((phrase, index) => {
        if (!phrase) return;
        exclusions.push(...regexMatches(
          new RegExp(escapeRegex(phrase), flags),
          text,
          `excludePhrase:${index}`,
          category.regex.wholeWord
        ));
      });
      category.regex.phrases.forEach((phrase, index) => {
        if (!phrase) return;
        matches.push(...regexMatches(
          new RegExp(escapeRegex(phrase), flags),
          text,
          `phrase:${index}`,
          category.regex.wholeWord
        ));
      });
      category.regex.expressions.forEach((expression, index) => {
        matches.push(...regexMatches(
          new RegExp(expression, flags),
          text,
          `expression:${index}`,
          category.regex.wholeWord
        ));
      });
      matches.sort((left, right) =>
        left.start - right.start || left.end - right.end ||
        left.expressionRow.localeCompare(right.expressionRow)
      );
      const included = matches.filter(match => !exclusions.some(excluded =>
        excluded.start < match.end && excluded.end > match.start
      ));
      return {
        matches: included.slice(0, 100),
        excludedCount: matches.length - included.length,
        truncated: included.length > 100
      };
    }

    function normalizeFigureInput(value, articleTitle) {
      const figureId = String(value?.figureId || '').trim().slice(0, 80);
      const caption = String(value?.caption || '').normalize('NFKC')
        .replace(/\s+/g, ' ').trim().slice(0, 8000);
      if (!/^figure-(?:s)?\d{1,3}$/.test(figureId) || !caption) {
        throw invalidSettings(['figures']);
      }
      const imageVariants = (Array.isArray(value?.imageVariants) ? value.imageVariants : [])
        .slice(0, 6).map(candidate => {
          const image = shared.normalizeImageInputs([candidate], { maxImages: 1 })[0];
          const width = Math.max(0, Math.round(Number(candidate?.width) || 0));
          const height = Math.max(0, Math.round(Number(candidate?.height) || 0));
          if (!image || !width || !height) return null;
          return {
            ...image,
            width,
            height,
            maxEdge: Math.max(0, Math.round(
              Number(candidate?.maxEdge) || Math.max(width, height)
            )),
            inputMode: candidate?.inputMode === 'panel_crop'
              ? 'panel_crop' : 'figure_image',
            pixelsSupplied: true
          };
        }).filter(Boolean);
      return {
        figureId,
        figureLabel: String(value?.figureLabel || figureId).trim().slice(0, 80),
        caption,
        articleTitle: String(articleTitle || '').trim().slice(0, 500),
        panelHints: [...new Set((Array.isArray(value?.panelHints) ? value.panelHints : [])
          .slice(0, 30)
          .map(item => String(item || '').trim().toUpperCase())
          .filter(item => /^[A-Z0-9][A-Z0-9.+-]{0,7}$/.test(item)))],
        contextParagraphs: (Array.isArray(value?.contextParagraphs)
          ? value.contextParagraphs : []).slice(0, 12).map(item => ({
          paragraphId: String(item?.paragraphId || '').slice(0, 120),
          sectionTitle: String(item?.sectionTitle || '').normalize('NFKC')
            .replace(/\s+/g, ' ').trim().slice(0, 240),
          text: String(item?.text || '').normalize('NFKC')
            .replace(/\s+/g, ' ').trim().slice(0, 1200)
        })),
        images: shared.normalizeImageInputs(value?.images),
        imageVariants
      };
    }

    async function requestFigureJson(adapter, request, context, progressBase, options = {}) {
      const emitLifecycle = options.emitLifecycle === true;
      const operation = options.operation || null;
      const requestOnce = async payload => {
        await waitForOperation(operation);
        if (emitLifecycle) {
          context.onProgress?.({ phase: 'figure_model_processing', ...progressBase });
        }
        const raw = await adapter.generateJson({
          ...payload,
          signal: operation?.controller?.signal
        });
        if (emitLifecycle) {
          context.onProgress?.({ phase: 'figure_response_received', ...progressBase });
        }
        return raw;
      };
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
          return await requestOnce(request);
        } catch (error) {
          if (operation?.controller?.signal?.aborted) throw shared.operationError();
          if (!error?.retryable || attempt >= 2) throw error;
          const waitMs = Math.max(
            Number(error?.retryAfterMs) || 0,
            attempt === 1 ? 1500 : 4000
          );
          context.onProgress?.({
            phase: 'figure_retry',
            ...progressBase,
            attempt: attempt + 1,
            waitMs,
            errorCode: error.code || 'NETWORK_ERROR'
          });
          await sleepForOperation(waitMs, operation);
        }
      }
      throw new Error('Figure analysis did not complete');
    }

    function splitFigurePanelBatches(figure, analysisDepth) {
      const panels = Array.isArray(figure?.panelHints) ? figure.panelHints : [];
      if (!panels.length) return [[]];
      // Deep analysis contains many required fields per panel.  Small batches keep
      // its structured response below the output limit of economical models.
      const batchSize = analysisDepth === 'deep' ? 2 : 4;
      const batches = [];
      for (let index = 0; index < panels.length; index += batchSize) {
        batches.push(panels.slice(index, index + batchSize));
      }
      return batches;
    }

    function mergeFigurePanelBatchResults(results, figure, analysisDepth) {
      const values = Array.isArray(results) ? results.filter(Boolean) : [];
      const first = values[0] || {};
      const uniqueBy = (items, key) => {
        const seen = new Set();
        return (Array.isArray(items) ? items : []).filter(item => {
          const value = key(item);
          if (!value || seen.has(value)) return false;
          seen.add(value);
          return true;
        });
      };
      const panels = uniqueBy(values.flatMap(item => item.panels || []), item => item.panel);
      const expectedPanels = Array.isArray(figure?.panelHints) ? figure.panelHints : [];
      const unexpectedPanels = uniqueBy(
        values.flatMap(item => item?.panelCoverage?.unexpectedPanels || []),
        item => String(item || '')
      );
      const firstText = field => values.map(item => String(item?.[field] || '').trim())
        .find(Boolean) || '';
      const merged = {
        ...first,
        figureId: figure.figureId,
        analysisDepth,
        panels,
        panelGroups: uniqueBy(values.flatMap(item => item.panelGroups || []), item =>
          shared.stableHash([item?.panels, item?.groupGoal, item?.groupConclusion])),
        logicBridges: uniqueBy(values.flatMap(item => item.logicBridges || []), item =>
          shared.stableHash([item?.fromGroup, item?.toGroup, item?.relationType, item?.bridge])),
        argumentChain: uniqueBy(values.flatMap(item => item.argumentChain || []), item =>
          shared.stableHash([item?.panels, item?.established, item?.handoff, item?.evidenceLevel])),
        panelCoverage: {
          expectedPanels: [...expectedPanels],
          returnedPanels: panels.map(item => item.panel),
          missingPanels: expectedPanels.filter(panel => !panels.some(item => item.panel === panel)),
          unexpectedPanels,
          ignoredUnexpectedPanelCount: unexpectedPanels.length
        },
        figureQuestion: firstText('figureQuestion'),
        authorAssembly: firstText('authorAssembly'),
        coreConclusion: firstText('coreConclusion'),
        claimBoundary: firstText('claimBoundary')
      };
      if (analysisDepth === 'deep') Object.assign(merged, {
        controlAnalysis: uniqueBy(values.flatMap(item => item.controlAnalysis || []), item =>
          shared.stableHash([item?.panels, item?.controlType, item?.excludedExplanation])),
        evidenceRelations: uniqueBy(values.flatMap(item => item.evidenceRelations || []), item =>
          shared.stableHash([item?.panels, item?.relationLevel, item?.rationale])),
        negativeResultValue: firstText('negativeResultValue'),
        qualitativeQuantitativeLink: firstText('qualitativeQuantitativeLink'),
        alternativeExplanations: uniqueBy(values.flatMap(item => item.alternativeExplanations || []),
          item => String(item || '')),
        missingLinksIfPanelRemoved: uniqueBy(
          values.flatMap(item => item.missingLinksIfPanelRemoved || []),
          item => String(item || '')
        ),
        paperArgumentRole: firstText('paperArgumentRole'),
        deepAuthorStrategy: firstText('deepAuthorStrategy')
      });
      return merged;
    }

    async function mapWithConcurrency(items, limit, mapper) {
      const values = new Array(items.length);
      let cursor = 0;
      const workers = Array.from({
        length: Math.max(1, Math.min(items.length || 1, Number(limit) || 1))
      }, async () => {
        while (cursor < items.length) {
          const index = cursor;
          cursor += 1;
          values[index] = await mapper(items[index], index);
        }
      });
      await Promise.all(workers);
      return values;
    }

    async function requestFigurePanelBatches({
      adapter,
      route,
      figure,
      analysisDepth,
      progress,
      progressBase,
      operation
    }) {
      const panelBatches = splitFigurePanelBatches(figure, analysisDepth);
      let visionFallback = route.capabilityMode === 'caption_text_only';
      let useVisualInput = route.capabilityMode === 'vision' && figure.images.length > 0;
      if (visionFallback) {
        progress({
          phase: 'caption_text_only',
          ...progressBase,
          basis: 'caption_context',
          visionFallback: true,
          completedPanelBatches: 0,
          totalPanelBatches: panelBatches.length
        });
      }

      async function requestValidated({
        prompt,
        request,
        validate,
        progressDetails
      }) {
        try {
          const raw = await requestFigureJson(
            adapter, request, { onProgress: progress }, progressDetails,
            { emitLifecycle: true, operation }
          );
          progress({ phase: 'figure_validating', ...progressDetails });
          return validate(raw);
        } catch (error) {
          if (error?.code !== 'INVALID_RESPONSE') throw error;
          progress({ phase: 'figure_schema_retry', ...progressDetails });
          const repairedRaw = await requestFigureJson(adapter, {
            ...request,
            systemPrompt: `${prompt.systemPrompt}\nSCHEMA_REPAIR_PASS: Return only the exact JSON object, include every required key, use empty strings or empty arrays when evidence is absent, and do not add unsupported keys.`
          }, { onProgress: progress }, progressDetails,
          { emitLifecycle: true, operation });
          progress({ phase: 'figure_validating', ...progressDetails });
          return validate(repairedRaw);
        }
      }

      const degradableResponseCodes = new Set([
        'PROVIDER_REJECTED', 'INVALID_RESPONSE', 'CONTEXT_BUDGET_EXCEEDED',
        'TOKEN_LIMIT_REJECTED', 'OUTPUT_TRUNCATED', 'REQUEST_TIMEOUT'
      ]);

      // When the publisher DOM exposes no stable Panel labels, asking an
      // economical text model for the full per-Panel schema is both wasteful
      // and fragile. Use a smaller evidence-overview contract that preserves
      // the Figure question, ordered reasoning chain, conclusion, and limits
      // without inventing Panel letters.
      if (panelBatches.length === 1 && panelBatches[0].length === 0) {
        const overviewBase = {
          ...progressBase,
          expectedPanels: [],
          expectedPanelCount: 0,
          panelBatchIndex: 1,
          totalPanelBatches: 1,
          completedPanelBatches: 0,
          unlabeledFigure: true
        };
        const runOverview = async visualInput => {
          const prompt = shared.compileUnlabeledFigureOverviewPrompt(
            figure, { visualInput, analysisDepth }
          );
          progress({
            phase: 'figure_requesting', ...overviewBase,
            basis: visualInput ? 'vision_text' : 'caption_context',
            visionFallback
          });
          return requestValidated({
            prompt,
            request: {
              ...prompt,
              images: visualInput ? figure.images : [],
              outputUnits: analysisDepth === 'deep' ? 2 : 1
            },
            progressDetails: overviewBase,
            validate: raw => shared.validateUnlabeledFigureOverview(
              raw, figure, { visualInput, analysisDepth }
            )
          });
        };
        let result;
        let lastError = null;
        try {
          result = await runOverview(useVisualInput);
        } catch (error) {
          lastError = error;
          if (useVisualInput && degradableResponseCodes.has(error?.code)) {
            visionFallback = true;
            useVisualInput = false;
            progress({ phase: 'figure_fallback', ...overviewBase, errorCode: error.code });
            result = await runOverview(false);
            lastError = null;
          }
        }
        if (!result) throw lastError || new Error('Figure overview did not return a result');
        progress({
          phase: 'figure_assembling', ...overviewBase,
          recognizedPanelCount: 0
        });
        progress({
          phase: 'figure_panel_batch_complete', ...overviewBase,
          completedPanelBatches: 1,
          recognizedPanelCount: 0,
          basis: result.basis,
          visionFallback,
          partialFigureResult: result
        });
        return { result, visionFallback, totalPanelBatches: 1 };
      }

      // A small Figure is fastest and most coherent as one structured request.
      if (panelBatches.length === 1) {
        const panelHints = panelBatches[0];
        const batchFigure = { ...figure, panelHints };
        const batchBase = {
          ...progressBase,
          expectedPanels: [...panelHints],
          expectedPanelCount: panelHints.length,
          panelBatchIndex: 1,
          totalPanelBatches: 1,
          completedPanelBatches: 0
        };
        const run = async visualInput => {
          const prompt = shared.compileFigureAnalysisPrompt(
            batchFigure, { visualInput, analysisDepth }
          );
          const request = {
            ...prompt,
            images: visualInput ? figure.images : [],
            outputUnits: Math.max(1, panelHints.length)
          };
          progress({
            phase: 'figure_requesting', ...batchBase,
            basis: visualInput ? 'vision_text' : 'caption_context',
            visionFallback
          });
          return requestValidated({
            prompt, request, progressDetails: batchBase,
            validate: raw => shared.validateFigureAnalysis(
              raw, batchFigure, { visualInput, analysisDepth }
            )
          });
        };
        const runCompactTwoPass = async visualInput => {
          const panelPrompt = shared.compileFigurePanelBatchPrompt(
            batchFigure, { visualInput, analysisDepth }
          );
          progress({
            phase: 'figure_compact_fallback', ...batchBase,
            basis: visualInput ? 'vision_text' : 'caption_context',
            visionFallback: !visualInput
          });
          const panelResult = await requestValidated({
            prompt: panelPrompt,
            request: {
              ...panelPrompt,
              images: visualInput ? figure.images : [],
              outputUnits: Math.max(1, panelHints.length)
            },
            progressDetails: batchBase,
            validate: raw => shared.validateFigurePanelBatch(
              raw, batchFigure, { visualInput, analysisDepth }
            )
          });
          progress({
            phase: 'figure_panel_batch_complete', ...batchBase,
            completedPanelBatches: 1,
            recognizedPanelCount: panelResult.panels.length,
            basis: panelResult.basis,
            visionFallback: !visualInput,
            partialFigureResult: panelResult
          });
          const synthesisPrompt = shared.compileFigureSynthesisPrompt(
            batchFigure, panelResult.panels, { visualInput, analysisDepth }
          );
          progress({
            phase: 'figure_synthesizing', ...batchBase,
            completedPanelBatches: 1,
            recognizedPanelCount: panelResult.panels.length
          });
          return requestValidated({
            prompt: synthesisPrompt,
            request: {
              ...synthesisPrompt,
              images: [],
              outputUnits: Math.max(1, panelResult.panels.length)
            },
            progressDetails: batchBase,
            validate: raw => shared.validateFigureSynthesis(
              raw, batchFigure, panelResult.panels,
              { visualInput, analysisDepth }
            )
          });
        };
        let result;
        let lastError = null;
        try {
          result = await run(useVisualInput);
        } catch (error) {
          lastError = error;
          if (useVisualInput && degradableResponseCodes.has(error?.code)) {
            visionFallback = true;
            useVisualInput = false;
            progress({ phase: 'figure_fallback', ...batchBase, errorCode: error.code });
            try {
              result = await run(false);
              lastError = null;
            } catch (fallbackError) {
              lastError = fallbackError;
            }
          }
        }
        if (!result && panelHints.length && degradableResponseCodes.has(lastError?.code)) {
          visionFallback = true;
          useVisualInput = false;
          result = await runCompactTwoPass(false);
        }
        if (!result) throw lastError || new Error('Figure analysis did not return a result');
        progress({
          phase: 'figure_assembling', ...batchBase,
          recognizedPanelCount: result.panels.length
        });
        progress({
          phase: 'figure_panel_batch_complete', ...batchBase,
          completedPanelBatches: 1,
          recognizedPanelCount: result.panels.length,
          basis: result.basis,
          visionFallback,
          partialFigureResult: result
        });
        return { result, visionFallback, totalPanelBatches: 1 };
      }

      const runExtraction = async visualInput => {
        const completed = new Array(panelBatches.length);
        let completedCount = 0;
        return mapWithConcurrency(
          panelBatches,
          TASK_CONCURRENCY.figure,
          async (panelHints, batchIndex) => {
            const batchFigure = { ...figure, panelHints };
            const batchBase = {
              ...progressBase,
              expectedPanels: [...panelHints],
              expectedPanelCount: panelHints.length,
              panelBatchIndex: batchIndex + 1,
              totalPanelBatches: panelBatches.length,
              completedPanelBatches: completedCount
            };
            const prompt = shared.compileFigurePanelBatchPrompt(
              batchFigure, { visualInput, analysisDepth }
            );
            const request = {
              ...prompt,
              images: visualInput ? figure.images : [],
              outputUnits: Math.max(1, panelHints.length)
            };
            progress({
              phase: 'figure_requesting', ...batchBase,
              basis: visualInput ? 'vision_text' : 'caption_context',
              visionFallback
            });
            const result = await requestValidated({
              prompt, request, progressDetails: batchBase,
              validate: raw => shared.validateFigurePanelBatch(
                raw, batchFigure, { visualInput, analysisDepth }
              )
            });
            completed[batchIndex] = result;
            completedCount += 1;
            const partial = mergeFigurePanelBatchResults(
              completed.filter(Boolean), figure, analysisDepth
            );
            progress({
              phase: 'figure_assembling', ...batchBase,
              completedPanelBatches: completedCount,
              recognizedPanelCount: partial.panels.length,
              batchRecognizedPanelCount: result.panels.length,
              unexpectedPanels: result.panelCoverage?.unexpectedPanels || [],
              ignoredUnexpectedPanelCount:
                result.panelCoverage?.ignoredUnexpectedPanelCount || 0
            });
            progress({
              phase: 'figure_panel_batch_complete', ...batchBase,
              completedPanelBatches: completedCount,
              recognizedPanelCount: partial.panels.length,
              batchRecognizedPanelCount: result.panels.length,
              unexpectedPanels: result.panelCoverage?.unexpectedPanels || [],
              ignoredUnexpectedPanelCount:
                result.panelCoverage?.ignoredUnexpectedPanelCount || 0,
              basis: partial.basis,
              visionFallback,
              partialFigureResult: partial
            });
            return result;
          }
        );
      };

      let batchResults;
      try {
        batchResults = await runExtraction(useVisualInput);
      } catch (error) {
        if (!useVisualInput || !degradableResponseCodes.has(error?.code)) throw error;
        visionFallback = true;
        useVisualInput = false;
        progress({ phase: 'figure_fallback', ...progressBase, errorCode: error.code });
        batchResults = await runExtraction(false);
      }

      const panelResult = mergeFigurePanelBatchResults(batchResults, figure, analysisDepth);
      const synthesisBase = {
        ...progressBase,
        expectedPanels: [...figure.panelHints],
        expectedPanelCount: figure.panelHints.length,
        completedPanelBatches: panelBatches.length,
        totalPanelBatches: panelBatches.length
      };
      progress({
        phase: 'figure_synthesizing', ...synthesisBase,
        recognizedPanelCount: panelResult.panels.length
      });
      const synthesisPrompt = shared.compileFigureSynthesisPrompt(
        figure, panelResult.panels, { visualInput: useVisualInput, analysisDepth }
      );
      const synthesisRequest = {
        ...synthesisPrompt,
        images: [],
        outputUnits: Math.max(1, panelResult.panels.length)
      };
      const result = await requestValidated({
        prompt: synthesisPrompt,
        request: synthesisRequest,
        progressDetails: synthesisBase,
        validate: raw => shared.validateFigureSynthesis(
          raw, figure, panelResult.panels,
          { visualInput: useVisualInput, analysisDepth }
        )
      });
      progress({
        phase: 'figure_synthesis_complete', ...synthesisBase,
        recognizedPanelCount: result.panels.length,
        basis: result.basis,
        visionFallback
      });
      return { result, visionFallback, totalPanelBatches: panelBatches.length };
    }

    async function analyzeFigures(settings, message, context) {
      requireLlmReady(settings);
      const operation = operationFor(message);
      await waitForOperation(operation);
      const rawFigures = Array.isArray(message?.figures) ? message.figures.slice(0, 50) : [];
      if (!rawFigures.length) throw invalidSettings(['figures']);
      const document = message?.document || {};
      const paragraphs = Array.isArray(document.paragraphs) ? document.paragraphs : [];
      const documentHash = paragraphs.length
        ? await shared.hashDocument(paragraphs)
        : shared.stableHash({
          title: String(document.title || ''),
          figures: rawFigures.map(item => [item?.figureId, item?.caption])
        });
      const analysisDepth = message?.analysisDepth === 'standard' ? 'standard' : 'deep';
      const operationId = String(message?.operationId || '').trim().slice(0, 100);
      const figureProgressState = { active: null };
      const figureProgressContext = {
        ...context,
        onProgress: event => context.onProgress?.({
          ...(figureProgressState.active || {}),
          ...event
        })
      };
      const task = createTaskAdapter(
        settings, 'figure', { vision: true }, figureProgressContext, 'figure'
      );
      const { adapter, route, routePublic } = task;
      const progress = routeProgress(figureProgressContext, routePublic);
      const figures = rawFigures.map(value => normalizeFigureInput(value, document.title));
      const records = figures.map(figure => {
        const figureHash = shared.stableHash({
          caption: figure.caption,
          panelHints: figure.panelHints,
          contextParagraphs: figure.contextParagraphs,
          images: route.capabilityMode === 'vision'
            ? figure.images.map(image => shared.stableHash(image.dataUrl))
            : []
        });
        return {
          figure,
          key: shared.buildFigureCacheKey({
            documentHash,
            providerId: route.providerId,
            model: route.model,
            profileSignature: route.profileSignature,
            figureId: figure.figureId,
            figureHash,
            analysisDepth,
            figureVersion: shared.FIGURE_ANALYSIS_VERSION
          })
        };
      });
      const cached = message?.forceRefresh === true
        ? new Map() : await cacheStore.getMany(records.map(record => record.key));
      const figureResults = [];
      let cacheHits = 0;
      let visionFallbacks = 0;
      const progressOffset = Math.max(
        0,
        Math.floor(Number(message.figureProgressOffset) || 0)
      );
      const progressTotal = Math.max(
        progressOffset + records.length,
        Math.floor(Number(message.figureProgressTotal) || 0)
      );

      for (let index = 0; index < records.length; index += 1) {
        const record = records[index];
        const startedAt = Date.now();
        const progressBase = {
          figureId: record.figure.figureId,
          figureLabel: record.figure.figureLabel,
          expectedPanels: [...record.figure.panelHints],
          expectedPanelCount: record.figure.panelHints.length,
          completedFigures: progressOffset + index,
          totalFigures: progressTotal,
          providerId: route.providerId,
          model: route.model,
          capabilityMode: route.capabilityMode,
          operationId,
          startedAt
        };
        figureProgressState.active = progressBase;
        const cachedValue = cached.get(record.key)?.figureResult;
        let result;
        if (cachedValue) {
          try {
            const validated = shared.validateCachedFigureAnalysis(
              cachedValue,
              record.figure,
              { analysisDepth }
            );
            cacheHits += 1;
            result = {
              ...validated,
              visionFallback: cachedValue.visionFallback === true,
              cacheHit: true
            };
          } catch (error) {
            await cacheStore.deleteMany?.([record.key]);
          }
        }
        if (!result) {
          const analyzed = await requestFigurePanelBatches({
            adapter,
            route,
            figure: record.figure,
            analysisDepth,
            progress,
            progressBase,
            operation
          });
          result = {
            ...analyzed.result,
            visionFallback: analyzed.visionFallback,
            cacheHit: false
          };
          await cacheStore.setMany([{
            key: record.key,
            createdAt: Date.now(),
            figureResult: result
          }]);
        }
        if (result.visionFallback) visionFallbacks += 1;
        figureResults.push(result);
        progress({
          phase: 'figure',
          ...progressBase,
          completedFigures: progressOffset + index + 1,
          basis: result.basis,
          cacheHit: result.cacheHit,
          recognizedPanelCount: Array.isArray(result.panels) ? result.panels.length : 0,
          figureResult: result
        });
        figureProgressState.active = null;
      }

      return {
        documentHash,
        figureResults,
        totalFigures: figureResults.length,
        cacheHits,
        visionFallbacks,
        analysisDepth,
        operationId,
        providerId: route.providerId,
        model: route.model,
        route: routePublic,
        figureVersion: shared.FIGURE_ANALYSIS_VERSION
      };
    }

    function normalizeSinglePanelInput(message, requestMode) {
      const document = message?.document || {};
      const figure = normalizeFigureInput(message?.figure, document.title);
      const panelSource = isPlainObject(message?.panel)
        ? message.panel : { panel: message?.panelId || message?.panel };
      const panel = String(panelSource.panel || '').trim().toUpperCase();
      if (!/^[A-Z0-9][A-Z0-9.+-]{0,7}$/.test(panel)) {
        throw invalidSettings(['panel']);
      }
      if (figure.panelHints.length && !figure.panelHints.includes(panel)) {
        throw invalidSettings(['panel']);
      }
      const topics = shared.normalizePanelFollowupTopics(message?.topics);
      const customQuestion = shared.normalizePanelCustomQuestion(message?.customQuestion);
      if (requestMode === 'followup' && !topics.length && !customQuestion) {
        throw invalidSettings(['topics', 'customQuestion']);
      }
      const documentHash = String(
        message?.documentHash || document.documentHash || ''
      ).replace(/^sha256:/i, '').trim().toLowerCase();
      return {
        ...figure,
        requestMode,
        documentHash: /^[a-f0-9]{64}$/.test(documentHash)
          ? documentHash : shared.stableHash({
            title: document.title || '', figureId: figure.figureId, caption: figure.caption
          }),
        panelId: panel,
        panel: {
          panel,
          role: String(panelSource.role || '').trim().slice(0, 80),
          phenotypeName: String(panelSource.phenotypeName || '').trim().slice(0, 240),
          methods: (Array.isArray(panelSource.methods) ? panelSource.methods : [])
            .slice(0, 12).map(item => String(item || '').trim().slice(0, 120)),
          purpose: String(panelSource.purpose || '').trim().slice(0, 1000),
          design: String(panelSource.design || '').trim().slice(0, 1000),
          comparison: String(panelSource.comparison || '').trim().slice(0, 1000),
          directObservation: String(panelSource.directObservation || '').trim().slice(0, 1000)
        },
        topics,
        customQuestion,
        history: (Array.isArray(message?.history) ? message.history : []).slice(-100)
          .map((item, index) => ({
            historyId: String(item?.historyId || item?.turnId || `panel-history-${index + 1}`)
              .slice(0, 120),
            role: item?.role === 'assistant' ? 'assistant' : 'user',
            content: String(item?.content || item?.answer || item?.question || '')
              .normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, 3200)
          })).filter(item => item.content)
      };
    }

    function publicFigurePanelPlan(plan, attempts) {
      return {
        topic: plan.topic,
        inputMode: plan.inputMode,
        imageWidth: plan.imageWidth,
        imageHeight: plan.imageHeight,
        imageMaxEdge: plan.imageMaxEdge,
        pixelsSupplied: plan.pixelsSupplied,
        selectedSources: [...plan.selectedSources],
        degradationReason: plan.degradationReason,
        estimatedInputTokens: plan.estimatedInputTokens,
        inputBudgetTokens: plan.inputBudgetTokens,
        includedHistoryIds: plan.history.map(item => item.historyId),
        attempts
      };
    }

    async function runSinglePanelRequest(settings, message, context, requestMode) {
      requireLlmReady(settings);
      const input = normalizeSinglePanelInput(message, requestMode);
      const operation = operationFor(message);
      await waitForOperation(operation);
      const outputUnits = requestMode === 'followup'
        ? shared.figurePanelFollowupOutputUnits(input) : 1;
      const budgetKind = requestMode === 'followup' ? 'panelChat' : 'figurePanel';
      const task = createTaskAdapter(
        settings, 'figure', { vision: true }, context, budgetKind,
        { maxTokenLimitRetries: 0, maxTruncationRetries: 3 }
      );
      const { adapter, rawAdapter, route, routePublic } = task;
      const profile = settings?.profiles?.[route.effectiveProfileId] || {};
      const contextWindowTokens = shared.getProviderContextWindowTokens(
        route.providerId, route.config, profile.contextWindowTokens
      );
      const requestedOutputBudget = shared.computeOutputTokenBudget(budgetKind, {
        tokenPolicy: task.tokenPolicy,
        adapterCap: adapter.maxOutputTokens,
        units: outputUnits
      });
      const maximumOutputByContext = Math.max(512, Math.floor(
        (Math.floor(contextWindowTokens * 0.9) - 768 - 2048) / 256
      ) * 256);
      const automaticRuleCeiling = requestedOutputBudget.mode === 'auto'
        ? Number(shared.RULES?.[budgetKind]?.ceiling) || requestedOutputBudget.ceiling
        : requestedOutputBudget.ceiling;
      const outputBudget = {
        ...requestedOutputBudget,
        initial: Math.min(requestedOutputBudget.initial, maximumOutputByContext),
        ceiling: Math.min(
          requestedOutputBudget.ceiling,
          automaticRuleCeiling,
          maximumOutputByContext
        ),
        contextClamped: requestedOutputBudget.initial > maximumOutputByContext ||
          requestedOutputBudget.ceiling > maximumOutputByContext ||
          requestedOutputBudget.ceiling > automaticRuleCeiling
      };
      const planInput = {
        ...input,
        existingPanelInterpretation: requestMode === 'followup' ? input.panel : null,
        imageVariants: route.capabilityMode === 'vision' ? input.imageVariants : [],
        contextWindowTokens,
        outputTokens: outputBudget.initial
      };
      const plans = shared.buildFigurePanelPlans(planInput);
      if (!plans.length || plans[0].estimatedInputTokens > plans[0].inputBudgetTokens) {
        const error = new Error('The selected model context window cannot fit this Panel request');
        error.code = 'CONTEXT_BUDGET_EXCEEDED';
        throw error;
      }
      const figureHash = shared.stableHash({
        figureId: input.figureId,
        caption: input.caption,
        panelHints: input.panelHints,
        contextParagraphs: input.contextParagraphs.map(item => [item.paragraphId, item.text]),
        imageVariants: input.imageVariants.map(item => [
          item.width, item.height, item.inputMode, shared.stableHash(item.dataUrl)
        ])
      });
      const questionSignature = shared.stableHash({
        topics: input.topics,
        customQuestion: input.customQuestion,
        history: input.history.map(item => [item.role, item.content]),
        existingPanelInterpretation: requestMode === 'followup' ? input.panel : null
      });
      const records = plans.map(plan => ({
        plan,
        key: shared.buildFigurePanelCacheKey({
          documentHash: input.documentHash,
          figureHash,
          panelId: input.panelId,
          providerId: route.providerId,
          model: route.model,
          inputMode: plan.inputMode,
          imageWidth: plan.imageWidth,
          imageHeight: plan.imageHeight,
          promptVersion: shared.FIGURE_PANEL_PROMPT_VERSION,
          requestMode,
          questionSignature,
          profileSignature: route.profileSignature
        })
      }));
      if (message?.forceRefresh !== true) {
        const cached = await cacheStore.getMany(records.map(record => record.key));
        for (const record of records) {
          const value = cached.get(record.key)?.panelResult;
          if (!value || value.panel !== input.panelId || value.figureId !== input.figureId) continue;
          const resultKey = requestMode === 'followup' ? 'panelFollowup' : 'panelAnalysis';
          return {
            [resultKey]: { ...value, cacheHit: true },
            cacheHit: true,
            documentHash: input.documentHash,
            route: routePublic
          };
        }
      }

      const progressBase = {
        figureId: input.figureId,
        figureLabel: input.figureLabel,
        expectedPanels: [input.panelId],
        expectedPanelCount: 1,
        completedFigures: 0,
        totalFigures: 1,
        providerId: route.providerId,
        model: route.model,
        capabilityMode: route.capabilityMode,
        operationId: String(message?.operationId || '').slice(0, 100)
      };
      context.onProgress?.({ phase: 'figure_panel_planning', ...progressBase });
      let lastError = null;
      let recordIndex = 0;
      let currentOutputTokens = outputBudget.initial;
      let degradationOverride = '';
      let providerRequestCount = 0;
      const transientRetries = new Set();
      const availableInputTokens = outputTokens => Math.max(
        0,
        Math.floor(contextWindowTokens * 0.9) - Math.max(512, outputTokens) - 768
      );
      for (let providerAttempt = 0;
        providerAttempt < 6 && recordIndex < records.length;
        providerAttempt += 1) {
        const { plan, key } = records[recordIndex];
        await waitForOperation(operation);
        const visualInput = plan.pixelsSupplied === true;
        const promptInput = { ...input, ...plan };
        const prompt = requestMode === 'followup'
          ? shared.compilePanelFollowupPrompt(promptInput, {
            visualInput,
            topicPrompts: settings.figurePanelFollowupPrompts
          })
          : shared.compileFigurePanelInterpretationPrompt(promptInput, { visualInput });
        try {
          const validate = raw => requestMode === 'followup'
            ? shared.validatePanelFollowup(raw, input, { visualInput })
            : shared.validateFigurePanelInterpretation(raw, input, { visualInput });
          const requestPanelJson = async requestPrompt => {
            providerRequestCount += 1;
            return rawAdapter.generateJson({
              ...requestPrompt,
              images: plan.images,
              outputUnits: 1,
              maxOutputTokens: currentOutputTokens,
              timeoutMs: TASK_TIMEOUTS_MS.figure,
              signal: operation?.controller?.signal
            });
          };
          let validated;
          try {
            validated = validate(await requestPanelJson(prompt));
          } catch (error) {
            if (error?.code !== 'INVALID_RESPONSE') throw error;
            context.onProgress?.({
              phase: 'figure_panel_schema_retry', ...progressBase,
              attempt: providerRequestCount + 1,
              inputMode: plan.inputMode,
              maxOutputTokens: currentOutputTokens,
              errorCode: error.code
            });
            const repairedRaw = await requestPanelJson({
              ...prompt,
              systemPrompt: `${prompt.systemPrompt}\nSCHEMA_REPAIR_PASS: Return only one JSON object that exactly matches the supplied schema. Include every required key, preserve the requested Figure and Panel ids, use empty strings or arrays for unsupported details, and do not add keys.`
            });
            validated = validate(repairedRaw);
          }
          const panelResult = {
            ...validated,
            inputBasis: {
              ...publicFigurePanelPlan(plan, providerRequestCount),
              ...(degradationOverride ? { degradationReason: degradationOverride } : {}),
              outputBudgetTokens: currentOutputTokens
            },
            cacheHit: false
          };
          await cacheStore.setMany([{ key, createdAt: Date.now(), panelResult }]);
          context.onProgress?.({
            phase: 'figure_panel_complete', ...progressBase,
            inputMode: plan.inputMode, attempts: providerRequestCount
          });
          const resultKey = requestMode === 'followup' ? 'panelFollowup' : 'panelAnalysis';
          return {
            [resultKey]: panelResult,
            cacheHit: false,
            documentHash: input.documentHash,
            route: routePublic
          };
        } catch (error) {
          lastError = error;
          const transientKey = `${recordIndex}:${error?.code || 'NETWORK_ERROR'}`;
          if (error?.retryable && error?.code !== 'INVALID_RESPONSE' &&
              !transientRetries.has(transientKey)) {
            transientRetries.add(transientKey);
            const waitMs = Math.max(Number(error?.retryAfterMs) || 0, 1500);
            context.onProgress?.({
              phase: 'figure_panel_transient_retry', ...progressBase,
              attempt: providerRequestCount + 1,
              waitMs,
              inputMode: plan.inputMode,
              errorCode: error.code || 'NETWORK_ERROR'
            });
            await sleepForOperation(waitMs, operation);
            continue;
          }
          const rejectedVisualInput = plan.pixelsSupplied &&
            error?.code === 'PROVIDER_REJECTED';
          const invalidVisualOutput = plan.pixelsSupplied &&
            error?.code === 'INVALID_RESPONSE';
          if (rejectedVisualInput) degradationOverride = 'provider_rejected_pixels';
          if (invalidVisualOutput) degradationOverride = 'invalid_visual_response';
          if (error?.code === 'TOKEN_LIMIT_REJECTED') {
            const suggested = Number(error?.suggestedMaxOutputTokens);
            const reduced = Number.isFinite(suggested) && suggested >= 512
              ? suggested : currentOutputTokens * 0.75;
            const nextOutputTokens = Math.max(
              512,
              Math.min(currentOutputTokens - 256, Math.floor(reduced / 256) * 256)
            );
            if (nextOutputTokens >= currentOutputTokens) throw error;
            currentOutputTokens = nextOutputTokens;
            context.onProgress?.({
              phase: 'figure_panel_token_retry', ...progressBase,
              attempt: providerAttempt + 2,
              inputMode: plan.inputMode,
              maxOutputTokens: currentOutputTokens,
              errorCode: error.code
            });
            continue;
          }
          if (error?.code === 'OUTPUT_TRUNCATED' &&
              outputBudget.mode === 'auto' && currentOutputTokens < outputBudget.ceiling) {
            const expandedOutputTokens = Math.min(
              outputBudget.ceiling,
              Math.ceil((currentOutputTokens * 1.75) / 256) * 256
            );
            const fittingRecordIndex = records.findIndex((record, index) =>
              index >= recordIndex &&
              record.plan.estimatedInputTokens <= availableInputTokens(expandedOutputTokens)
            );
            if (fittingRecordIndex < 0 || expandedOutputTokens <= currentOutputTokens) {
              throw error;
            }
            currentOutputTokens = expandedOutputTokens;
            recordIndex = fittingRecordIndex;
            const next = records[recordIndex].plan;
            context.onProgress?.({
              phase: 'figure_panel_output_retry', ...progressBase,
              attempt: providerAttempt + 2,
              previousEstimatedInputTokens: plan.estimatedInputTokens,
              estimatedInputTokens: next.estimatedInputTokens,
              inputMode: next.inputMode,
              maxOutputTokens: currentOutputTokens,
              errorCode: error.code
            });
            continue;
          }
          if (error?.code === 'OUTPUT_TRUNCATED') throw error;
          const nextIndex = rejectedVisualInput || invalidVisualOutput
            ? records.findIndex((record, index) =>
              index > recordIndex && record.plan.pixelsSupplied === false)
            : recordIndex + 1;
          const next = nextIndex >= 0 ? records[nextIndex]?.plan : null;
          if ((!shared.isFigurePanelCapacityError(error) && !rejectedVisualInput &&
              !invalidVisualOutput) || !next ||
              next.estimatedInputTokens >= plan.estimatedInputTokens) throw error;
          context.onProgress?.({
            phase: 'figure_panel_retry', ...progressBase,
            attempt: providerAttempt + 2,
            previousEstimatedInputTokens: plan.estimatedInputTokens,
            estimatedInputTokens: next.estimatedInputTokens,
            inputMode: next.inputMode,
            errorCode: error.code || 'CONTEXT_BUDGET_EXCEEDED'
          });
          recordIndex = nextIndex;
        }
      }
      throw lastError || new Error('Panel request did not complete');
    }

    function analyzeFigurePanel(settings, message, context) {
      return runSinglePanelRequest(settings, message, context, 'interpretation');
    }

    function askFigurePanel(settings, message, context) {
      return runSinglePanelRequest(settings, message, context, 'followup');
    }

    function settingsForExplicitProfile(settings, profileId) {
      const requestedProfileId = String(profileId || '').trim();
      if (!requestedProfileId) return settings;
      const profile = settings?.profiles?.[requestedProfileId];
      if (!profile || !shared.profileUsable({ ...profile, id: requestedProfileId })) {
        throw invalidSettings(['profileId']);
      }
      return {
        ...settings,
        taskRoutes: {
          ...(settings.taskRoutes || {}),
          summary: { mode: 'profile', profileId: requestedProfileId }
        }
      };
    }

    async function askArticle(settings, message, context) {
      const input = shared.normalizeArticleChatInput(message);
      if (settings?.consentGranted !== true) {
        const error = new Error('Article content sharing consent is required');
        error.code = 'LLM_NOT_READY';
        throw error;
      }
      const operation = operationFor(message);
      await waitForOperation(operation);
      const routedSettings = settingsForExplicitProfile(settings, input.profileId);
      const task = createTaskAdapter(
        routedSettings,
        'summary',
        {},
        context,
        'articleChat'
      );
      const route = {
        ...task.routePublic,
        taskType: 'chat',
        concurrency: TASK_CONCURRENCY.chat
      };
      const effectiveProfile = routedSettings?.profiles?.[task.route.effectiveProfileId] || {};
      const result = await shared.runArticleChat({
        input,
        adapter: task.adapter,
        selectedProfileId: task.route.effectiveProfileId,
        profile: {
          providerId: task.route.providerId,
          config: task.route.config,
          tokenPolicy: task.route.tokenPolicy,
          contextWindowTokens: effectiveProfile.contextWindowTokens
        },
        signal: operation?.controller?.signal,
        timeoutMs: TASK_TIMEOUTS_MS.chat,
        waitIfPaused: () => waitForOperation(operation),
        onProgress: routeProgress(context, route)
      });
      await waitForOperation(operation);
      return {
        ...result,
        operationId: operation?.operationId || '',
        route
      };
    }

    async function analyzeCrossFigureLogic(settings, message, context) {
      requireLlmReady(settings);
      const input = shared.normalizeCrossFigureLogicInput({
        articleTitle: message?.document?.title || '',
        figures: message?.figures
      });
      if (input.mainFigureIds.length < 2) throw invalidSettings(['figures']);
      const task = createTaskAdapter(settings, 'crossFigure', {}, context, 'crossFigure');
      const { adapter, route, routePublic } = task;
      const progress = routeProgress(context, routePublic);
      const documentHash = shared.stableHash({
        title: input.articleTitle,
        figures: input.figures
      });
      const figureHash = shared.stableHash({
        figures: input.figures,
        crossFigureVersion: shared.CROSS_FIGURE_LOGIC_VERSION
      });
      const key = shared.buildFigureCacheKey({
        documentHash,
        providerId: route.providerId,
        model: route.model,
        profileSignature: route.profileSignature,
        figureId: 'cross-figure-domino',
        figureHash,
        analysisDepth: 'deep',
        figureVersion: shared.CROSS_FIGURE_LOGIC_VERSION
      });
      const cached = await cacheStore.getMany([key]);
      const cachedValue = cached.get(key)?.crossFigureLogic;
      if (cachedValue && message?.forceRefresh !== true) {
        return {
          documentHash,
          crossFigureLogic: { ...cachedValue, cacheHit: true },
          cacheHit: true,
          providerId: route.providerId,
          model: route.model,
          route: routePublic,
          crossFigureVersion: shared.CROSS_FIGURE_LOGIC_VERSION
        };
      }
      progress({
        phase: 'cross_figure_logic',
        completedFigures: 0,
        totalFigures: input.mainFigureIds.length,
        figureLabel: 'Cross-figure domino chain'
      });
      const prompt = shared.compileCrossFigureLogicPrompt(input);
      const raw = await requestFigureJson(adapter, {
        ...prompt,
        outputUnits: input.mainFigureIds.length
      }, { onProgress: progress }, {
        completedFigures: 0,
        totalFigures: input.mainFigureIds.length,
        figureLabel: 'Cross-figure domino chain'
      });
      const crossFigureLogic = shared.validateCrossFigureLogic(raw, input);
      await cacheStore.setMany([{
        key,
        createdAt: Date.now(),
        crossFigureLogic
      }]);
      progress({
        phase: 'cross_figure_logic',
        completedFigures: input.mainFigureIds.length,
        totalFigures: input.mainFigureIds.length,
        figureLabel: 'Cross-figure domino chain'
      });
      return {
        documentHash,
        crossFigureLogic: { ...crossFigureLogic, cacheHit: false },
        cacheHit: false,
        providerId: route.providerId,
        model: route.model,
        route: routePublic,
        crossFigureVersion: shared.CROSS_FIGURE_LOGIC_VERSION
      };
    }

    function validAssetRevision(value) {
      return Number.isSafeInteger(value) && value >= 0;
    }

    function validImportedCategoryAsset(value) {
      if (!isPlainObject(value) || value.schemaVersion !== 1 ||
          !validAssetRevision(value.revision) ||
          !isPlainObject(value.categoryOverrides) ||
          !Array.isArray(value.customCategories) ||
          !Array.isArray(value.selectedCategoryIds) ||
          !isPlainObject(value.viewCategoryOverrides)) return false;
      const deletedBuiltInCategoryIds = value.deletedBuiltInCategoryIds === undefined
        ? []
        : value.deletedBuiltInCategoryIds;
      if (!Array.isArray(deletedBuiltInCategoryIds)) return false;
      if (!value.selectedCategoryIds.every(categoryId =>
        /^[a-z][a-z0-9_]*$/.test(String(categoryId || ''))
      )) return false;
      const customCategories = value.customCategories.map(normalizeUnifiedCustomCategory);
      if (customCategories.some(category =>
        !/^[a-z][a-z0-9_]*$/.test(category.categoryId) ||
        shared.validateUnifiedCategory(category).length
      )) return false;
      const catalog = shared.createUnifiedCategoryCatalog();
      if (!deletedBuiltInCategoryIds.every(categoryId =>
        Object.prototype.hasOwnProperty.call(catalog, String(categoryId || ''))
      )) return false;
      customCategories.forEach(category => { catalog[category.categoryId] = category; });
      for (const [categoryId, override] of Object.entries(value.categoryOverrides)) {
        if (!/^[a-z][a-z0-9_]*$/.test(categoryId) || !isPlainObject(override) ||
            !catalog[categoryId]) return false;
        const merged = shared.mergeCategoryOverrides(catalog[categoryId], override);
        if (shared.validateUnifiedCategory(merged).length) return false;
      }
      return Object.values(value.viewCategoryOverrides).every(override =>
        isPlainObject(override) && Array.isArray(override.add) &&
        Array.isArray(override.remove) &&
        [...override.add, ...override.remove].every(categoryId =>
          /^[a-z][a-z0-9_]*$/.test(String(categoryId || ''))
        )
      );
    }

    async function importUserDataAsset(relativePath, value) {
      if (relativePath === 'categories.json') {
        if (!validImportedCategoryAsset(value)) return { imported: false, reason: 'invalid' };
        const settings = await shared.loadSettings(storageArea);
        const localRevision = Number(settings.userDataCategoryRevision) || 0;
        if (value.revision <= localRevision) return { imported: false, reason: 'stale' };
        settings.categoryOverrides = cloneJsonLike(value.categoryOverrides);
        settings.deletedBuiltInCategoryIds = [
          ...(value.deletedBuiltInCategoryIds || [])
        ];
        settings.customCategories = value.customCategories.map(normalizeUnifiedCustomCategory);
        settings.selectedCategoryIds = [...value.selectedCategoryIds];
        settings.viewCategoryOverrides = cloneJsonLike(value.viewCategoryOverrides);
        settings.userDataCategoryRevision = value.revision;
        await shared.saveSettings(storageArea, settings);
        return { imported: true, revision: value.revision };
      }

      const match = /^annotations\/([^/]+)\.json$/u.exec(String(relativePath || ''));
      if (!match || !isPlainObject(value) || value.schemaVersion !== 1 ||
          !validAssetRevision(value.revision)) return { imported: false, reason: 'invalid' };
      let pathDocumentId;
      try {
        pathDocumentId = decodeURIComponent(match[1]);
      } catch (_) {
        return { imported: false, reason: 'invalid' };
      }
      if (pathDocumentId !== value.documentId) return { imported: false, reason: 'invalid' };
      const local = await documentStore.getDocument(value.documentId);
      if (local && Number(local.revision) >= value.revision) {
        return { imported: false, reason: 'stale' };
      }
      try {
        const record = await documentStore.putDocument(value);
        return { imported: true, revision: record.revision };
      } catch (_) {
        return { imported: false, reason: 'invalid' };
      }
    }

    function requireDirectorySync(method) {
      if (typeof directorySync?.[method] === 'function') return;
      const error = new Error('Directory sync is unavailable');
      error.code = 'DIRECTORY_SYNC_UNAVAILABLE';
      throw error;
    }

    function requireArticleWorkspaceStore(method) {
      if (typeof articleWorkspaceStore?.[method] === 'function') return;
      const error = new Error('Article workspace store is unavailable');
      error.code = 'WORKSPACE_STORE_UNAVAILABLE';
      throw error;
    }

    function publicWorkspace(workspace) {
      if (!workspace) return null;
      return {
        schemaVersion: Number(workspace.schemaVersion) || 1,
        workspaceId: String(workspace.workspaceId || ''),
        canonicalUrl: String(workspace.canonicalUrl || ''),
        aliases: cloneJsonLike(workspace.aliases || []),
        title: String(workspace.title || ''),
        directoryName: String(workspace.directoryName || ''),
        revision: String(workspace.revision || ''),
        contentHash: String(workspace.contentHash || ''),
        workspaceGeneration: Number(workspace.workspaceGeneration) || 1,
        storageRevision: Number(workspace.storageRevision) || 0,
        nextTurnSequence: Number(workspace.nextTurnSequence) || 0,
        memoryNeedsRebuild: Boolean(workspace.memoryNeedsRebuild),
        deletionPending: Boolean(workspace.deletionPending),
        createdAt: String(workspace.createdAt || ''),
        updatedAt: String(workspace.updatedAt || '')
      };
    }

    function assertWorkspaceMutationGeneration(workspace, message = {}) {
      const expected = Number(message.workspaceGeneration);
      if (!Number.isInteger(expected) || expected < 1) return;
      const current = Math.max(1, Number(workspace?.workspaceGeneration) || 1);
      if (expected === current) return;
      const error = new Error('WORKSPACE_GENERATION_CONFLICT');
      error.code = 'WORKSPACE_GENERATION_CONFLICT';
      error.expectedGeneration = expected;
      error.currentGeneration = current;
      throw error;
    }

    function publicStoredArticleChatTurn(turn = {}) {
      const value = cloneJsonLike(turn);
      for (const key of [
        'turnKey', 'workspaceId', 'workspaceGeneration', 'sequence', 'revision'
      ]) delete value[key];
      return value;
    }

    async function pageAllWorkspaceTurns(workspaceId) {
      if (typeof articleWorkspaceStore?.pageTurns !== 'function') return [];
      const turns = [];
      let afterSequence = 0;
      while (true) {
        const page = await articleWorkspaceStore.pageTurns(workspaceId, {
          limit: 1000, afterSequence
        });
        turns.push(...(page.items || []));
        if (!page.hasMore || Number(page.nextSequence) <= afterSequence) break;
        afterSequence = Number(page.nextSequence);
      }
      return turns;
    }

    function chatIndexWithTurns(indexInput, turnsInput, { authoritative = false } = {}) {
      const index = isPlainObject(indexInput) ? cloneJsonLike(indexInput) : {};
      const turnsById = new Map();
      if (!authoritative) {
        (Array.isArray(index.turns) ? index.turns : []).forEach(turn => {
          const turnId = String(turn?.turnId || '');
          if (turnId) turnsById.set(turnId, cloneJsonLike(turn));
        });
      }
      (Array.isArray(turnsInput) ? turnsInput : []).forEach(turn => {
        const turnId = String(turn?.turnId || '');
        if (turnId) turnsById.set(turnId, publicStoredArticleChatTurn(turn));
      });
      const turns = [...turnsById.values()].sort((left, right) =>
        Number(left.sequence || 0) - Number(right.sequence || 0) ||
        Number(left.createdAt || 0) - Number(right.createdAt || 0) ||
        String(left.turnId || '').localeCompare(String(right.turnId || ''))
      );
      return {
        ...index,
        turns,
        totalTurns: turns.length,
        returnedTurns: turns.length,
        windowStart: 0,
        hasEarlier: false
      };
    }

    function safeWorkspaceCounts(summary = {}) {
      const count = value => Math.max(0, Number(value) || 0);
      return {
        assetCount: count(summary.assetCount),
        chatTurnCount: count(summary.chatTurnCount || summary.turnCount),
        figureCount: count(summary.figureCount),
        panelCount: count(summary.panelCount),
        highlightCount: count(summary.highlightCount),
        annotationCount: count(summary.annotationCount),
        estimatedBytes: count(summary.assetBytes) + count(summary.turnBytes)
      };
    }

    function workspaceDoi(workspace = {}) {
      return String((Array.isArray(workspace.aliases) ? workspace.aliases : [])
        .find(alias => alias?.type === 'doi')?.value || '');
    }

    function publicWorkspaceOverview(workspace, manifest = null, syncStatus = {}) {
      const counts = safeWorkspaceCounts(workspace?.summary);
      let site = '';
      try { site = new URL(workspace.canonicalUrl).hostname; } catch (_) {}
      const conflictMatches = Boolean(syncStatus.lastConflict && workspace.directoryName &&
        JSON.stringify(syncStatus.lastConflict).includes(workspace.directoryName));
      let syncState = 'local-only';
      if (workspace.deletionPending) syncState = 'deleting';
      else if (conflictMatches) syncState = 'conflict';
      else if (manifest && manifest.contentHash !== workspace.contentHash) {
        syncState = 'content-changed';
      } else if (manifest && manifest.contentHash === workspace.contentHash) {
        syncState = Number(manifest.revision || 0) >= Number(workspace.storageRevision || 0)
          ? 'synced' : 'pending';
      } else if (syncStatus.permission === 'granted') syncState = 'pending';
      return {
        schemaVersion: 1,
        workspaceId: String(workspace.workspaceId || ''),
        canonicalUrl: String(workspace.canonicalUrl || ''),
        doi: workspaceDoi(workspace),
        site,
        title: String(workspace.title || ''),
        contentHash: String(workspace.contentHash || ''),
        workspaceGeneration: Number(workspace.workspaceGeneration) || 1,
        createdAt: String(workspace.createdAt || ''),
        lastAccessedAt: String(workspace.lastAccessedAt || workspace.updatedAt || ''),
        updatedAt: String(workspace.updatedAt || ''),
        syncState,
        deletionPending: Boolean(workspace.deletionPending),
        ...counts
      };
    }

    function jsonByteSize(value) {
      try { return new TextEncoder().encode(JSON.stringify(value)).byteLength; } catch (_) { return 0; }
    }

    function detailFromWorkspaceAssets(workspace, assets, turns) {
      const byPath = new Map((Array.isArray(assets) ? assets : [])
        .map(asset => [String(asset.relativePath || ''), asset.content]));
      const chat = byPath.get('chat/index.json');
      const figuresAsset = byPath.get('figures/inventory.json');
      const highlightAsset = byPath.get('annotations/highlights.json');
      const figures = Array.isArray(figuresAsset?.figures) ? figuresAsset.figures : [];
      const panelCount = figures.reduce((total, figure) => {
        const panels = new Set();
        (Array.isArray(figure?.panelHints) ? figure.panelHints : []).forEach(panel =>
          panels.add(String(panel?.panelId || panel?.panel || panel || '')));
        Object.keys(figure?.panelAnalyses || {}).forEach(panel => panels.add(String(panel)));
        Object.keys(figure?.panelFollowups || {}).forEach(panel => panels.add(String(panel)));
        return total + [...panels].filter(Boolean).length;
      }, 0);
      const storedTurns = Array.isArray(turns) ? turns : [];
      return {
        workspaceId: String(workspace.workspaceId || ''),
        chatTurnCount: Array.isArray(chat?.turns) ? chat.turns.length : storedTurns.length,
        figureCount: figures.length,
        panelCount,
        highlightCount: Math.max(0,
          Number(highlightAsset?.highlightDistribution?.totalHighlights) || 0),
        annotationCount: Array.isArray(highlightAsset?.annotations)
          ? highlightAsset.annotations.length : 0,
        assetCount: Array.isArray(assets) ? assets.length : 0,
        estimatedBytes: (Array.isArray(assets) ? assets : []).reduce((sum, asset) =>
          sum + (Number(asset.byteSize) || jsonByteSize(asset.content)), 0) +
          storedTurns.reduce((sum, turn) => sum + jsonByteSize(turn), 0)
      };
    }

    async function handleUnsafe(message, context = {}) {
      if (message.type === 'LLM_CONTROL_OPERATION') {
        const operationId = shared.normalizeOperationId?.(message.operationId) || '';
        const command = String(message.command || 'status');
        if (!operationId || !['pause', 'resume', 'cancel', 'release', 'status'].includes(command)) {
          throw invalidSettings(['operationId', 'command']);
        }
        return operationRegistry?.control(operationId, command) || {
          operationId, active: false, paused: false, cancelled: false
        };
      }

      if (message.type === 'MIGRATION_EXPORT') {
        const [settings, documents, feedbackSamples] = await Promise.all([
          shared.loadSettings(storageArea),
          documentStore.exportAll(),
          corpusStore.list()
        ]);
        return shared.createMigrationBundle({
          exportedAt: new Date().toISOString(),
          extensionVersion: String(message.extensionVersion || ''),
          settings,
          documents,
          feedbackSamples
        });
      }

      if (message.type === 'MIGRATION_IMPORT') {
        const bundle = shared.validateMigrationBundle(message.bundle);
        return serializeAllMutations(async () => {
          const settings = await shared.saveSettings(storageArea, bundle.settings);
          let importedDocuments = 0;
          for (const record of bundle.documents.documents) {
            await documentStore.putDocument(record);
            importedDocuments += 1;
          }
          let importedFeedback = 0;
          for (const sample of bundle.feedbackSamples) {
            await corpusStore.add(sample);
            importedFeedback += 1;
          }
          await mirrorCategorySettings(settings);
          for (const record of bundle.documents.documents) {
            await mirrorDocumentRecord(record);
          }
          return {
            imported: true,
            importedDocuments,
            importedFeedback,
            settings: shared.toPublicSettings(settings),
            directoryHandleRestored: false
          };
        });
      }

      if (message.type === 'ARTICLE_WORKSPACE_ENSURE') {
        requireArticleWorkspaceStore('ensureWorkspace');
        const workspace = await articleWorkspaceStore.ensureWorkspace(message.workspace, {
          expectedRevision: message.expectedRevision,
          expectedContentHash: message.expectedContentHash
        });
        return { workspace: publicWorkspace(workspace) };
      }

      if (message.type === 'ARTICLE_WORKSPACE_SAVE_ASSET') {
        requireArticleWorkspaceStore('putAsset');
        requireArticleWorkspaceStore('getWorkspace');
        const workspace = await articleWorkspaceStore.getWorkspace(message.workspaceId);
        if (!workspace || workspace.deletionPending) {
          const error = new Error('WORKSPACE_NOT_FOUND');
          error.code = 'WORKSPACE_NOT_FOUND';
          throw error;
        }
        assertWorkspaceMutationGeneration(workspace, message);
        let content = message.content;
        if (String(message.relativePath || '') === 'chat/index.json' &&
            typeof articleWorkspaceStore?.pageTurns === 'function') {
          content = chatIndexWithTurns(
            message.content,
            await pageAllWorkspaceTurns(workspace.workspaceId)
          );
        }
        const asset = await articleWorkspaceStore.putAsset(
          workspace.workspaceId, message.relativePath, content, {
            expectedRevision: message.expectedRevision,
            expectedContentHash: message.expectedContentHash,
            contentHash: message.contentHash
          }
        );
        let queued = false;
        if (typeof directorySync?.enqueueWorkspaceAsset === 'function') {
          try {
            await directorySync.enqueueWorkspaceAsset(
              workspace, asset.relativePath, asset.content, {
                revision: asset.revision,
                contentHash: asset.contentHash,
                updatedAt: asset.updatedAt,
                advanceFromDirectory: true,
                workspaceGeneration: workspace.workspaceGeneration
              }
            );
            queued = true;
            scheduleDirectoryFlush();
          } catch (_) {}
        }
        return {
          saved: true,
          queued,
          asset: {
            relativePath: asset.relativePath,
            revision: asset.revision,
            contentHash: asset.contentHash,
            byteSize: asset.byteSize,
            updatedAt: asset.updatedAt
          }
        };
      }

      if (message.type === 'ARTICLE_WORKSPACE_SAVE_TURN') {
        requireArticleWorkspaceStore('appendTurn');
        requireArticleWorkspaceStore('getWorkspace');
        const workspace = await articleWorkspaceStore.getWorkspace(message.workspaceId);
        if (!workspace || workspace.deletionPending) {
          const error = new Error('WORKSPACE_NOT_FOUND');
          error.code = 'WORKSPACE_NOT_FOUND';
          throw error;
        }
        assertWorkspaceMutationGeneration(workspace, message);
        const turn = await articleWorkspaceStore.appendTurn(workspace.workspaceId, message.turn);
        let queued = false;
        if (typeof directorySync?.enqueueWorkspaceAsset === 'function') {
          const filename = encodeURIComponent(turn.turnId).slice(0, 240);
          try {
            await directorySync.enqueueWorkspaceAsset(
              workspace, `chat/turns/${filename}.json`, turn, {
                revision: turn.revision,
                updatedAt: turn.updatedAt,
                advanceFromDirectory: true,
                workspaceGeneration: workspace.workspaceGeneration
              }
            );
            queued = true;
            scheduleDirectoryFlush();
          } catch (_) {}
        }
        return {
          saved: true,
          queued,
          turn: cloneJsonLike(turn)
        };
      }

      if (message.type === 'ARTICLE_WORKSPACE_UPDATE_TURN') {
        requireArticleWorkspaceStore('updateTurn');
        requireArticleWorkspaceStore('getWorkspace');
        const workspace = await articleWorkspaceStore.getWorkspace(message.workspaceId);
        if (!workspace || workspace.deletionPending) {
          const error = new Error('WORKSPACE_NOT_FOUND');
          error.code = 'WORKSPACE_NOT_FOUND';
          throw error;
        }
        assertWorkspaceMutationGeneration(workspace, message);
        let turn;
        let recreated = false;
        try {
          turn = await articleWorkspaceStore.updateTurn(
            workspace.workspaceId, message.turnId, message.turn || {}
          );
        } catch (error) {
          if (error?.code !== 'TURN_NOT_FOUND' ||
              typeof articleWorkspaceStore?.appendTurn !== 'function') {
            throw error;
          }
          // A directory restore can populate the page before an older browser
          // database contains the independent turn record. Treat update as an
          // idempotent upsert so an explicit “保存全部” never fails merely
          // because its aggregate chat index and turn store drifted apart.
          turn = await articleWorkspaceStore.appendTurn(
            workspace.workspaceId, message.turn || {}
          );
          recreated = true;
        }
        let queued = false;
        if (typeof directorySync?.enqueueWorkspaceAsset === 'function') {
          const filename = encodeURIComponent(turn.turnId).slice(0, 240);
          try {
            await directorySync.enqueueWorkspaceAsset(
              workspace, `chat/turns/${filename}.json`, turn, {
                revision: turn.revision,
                updatedAt: turn.updatedAt,
                advanceFromDirectory: true,
                workspaceGeneration: workspace.workspaceGeneration
              }
            );
            queued = true;
            scheduleDirectoryFlush();
          } catch (_) {}
        }
        return { saved: true, queued, recreated, turn: cloneJsonLike(turn) };
      }

      if (message.type === 'ARTICLE_WORKSPACE_DELETE_TURN') {
        requireArticleWorkspaceStore('deleteTurn');
        requireArticleWorkspaceStore('getWorkspace');
        const workspace = await articleWorkspaceStore.getWorkspace(message.workspaceId);
        if (!workspace || workspace.deletionPending) {
          return { deleted: true, alreadyMissing: true };
        }
        assertWorkspaceMutationGeneration(workspace, message);
        const tombstone = await articleWorkspaceStore.deleteTurn(
          workspace.workspaceId, message.turnId
        );
        if (typeof directorySync?.enqueueWorkspaceAsset === 'function') {
          const filename = encodeURIComponent(String(message.turnId || '')).slice(0, 240);
          try {
            await directorySync.enqueueWorkspaceAsset(
              workspace, `chat/tombstones/${filename}.json`, tombstone, {
                revision: Date.now(),
                advanceFromDirectory: true,
                workspaceGeneration: workspace.workspaceGeneration
              }
            );
            scheduleDirectoryFlush();
          } catch (_) {}
        }
        return { deleted: true, tombstone: cloneJsonLike(tombstone) };
      }

      if (message.type === 'ARTICLE_WORKSPACE_PROBE' ||
          message.type === 'ARTICLE_WORKSPACE_SCAN_RESTORE') {
        if (message.type === 'ARTICLE_WORKSPACE_SCAN_RESTORE' &&
            message.requestPermission === true &&
            typeof directorySync?.requestDirectoryPermission === 'function') {
          const permissionResult = await directorySync.requestDirectoryPermission();
          if (!permissionResult.granted) {
            return { permission: permissionResult.permission, manifests: [], matches: [] };
          }
          if (message.permissionOnly === true) {
            return { permission: 'granted', manifests: [], matches: [] };
          }
        }
        requireDirectorySync('listWorkspaceManifests');
        const result = await directorySync.listWorkspaceManifests(message.identity || {});
        if (typeof articleWorkspaceStore?.getWorkspaceGenerationState === 'function' &&
            Array.isArray(result.matches)) {
          const retained = [];
          let tombstonedMatches = 0;
          for (const match of result.matches) {
            const manifest = match?.manifest;
            if (!manifest?.workspaceId) continue;
            const state = await articleWorkspaceStore.getWorkspaceGenerationState(
              manifest.workspaceId
            );
            if (state.deletionGeneration >= Number(manifest.workspaceGeneration || 1)) {
              tombstonedMatches += 1;
            } else {
              retained.push(match);
            }
          }
          result.matches = retained;
          result.tombstonedMatches = tombstonedMatches;
        }
        if (message.type === 'ARTICLE_WORKSPACE_SCAN_RESTORE' && !result.matches.length &&
            !result.tombstonedMatches &&
            message.identity?.documentId && typeof directorySync.readJson === 'function' &&
            typeof shared.convertLegacyArticleArchiveToWorkspace === 'function') {
          const legacyPath = shared.articleArchiveRelativePath({
            documentId: message.identity.documentId,
            canonicalUrl: message.identity.canonicalUrl
          });
          const legacy = await directorySync.readJson(legacyPath);
          if (legacy.found) {
            const converted = await shared.convertLegacyArticleArchiveToWorkspace(legacy.value);
            if (articleWorkspaceStore?.ensureWorkspace && articleWorkspaceStore?.putAsset) {
              const savedWorkspace = await articleWorkspaceStore.ensureWorkspace(converted.workspace);
              await articleWorkspaceStore.putAsset(
                savedWorkspace.workspaceId, converted.assets[0].path, converted.assets[0].value,
                { contentHash: converted.assets[0].contentHash }
              );
              if (typeof directorySync.enqueueWorkspaceAsset === 'function') {
                await directorySync.enqueueWorkspaceAsset(
                  savedWorkspace, converted.assets[0].path, converted.assets[0].value,
                  { revision: converted.assets[0].revision,
                    contentHash: converted.assets[0].contentHash }
                );
                scheduleDirectoryFlush();
              }
            }
            result.matches = [{ match: 'legacy-imported', manifest: converted.manifest }];
            result.restore = {
              match: 'legacy-imported',
              manifest: converted.manifest,
              assets: converted.assets.map(asset => ({
                relativePath: asset.path,
                content: cloneJsonLike(asset.value),
                revision: Number(asset.revision) || 1,
                contentHash: String(asset.contentHash || '')
              }))
            };
            result.legacyPreserved = true;
          }
        }
        if (message.type === 'ARTICLE_WORKSPACE_SCAN_RESTORE' && result.matches.length &&
            !result.restore) {
          const selected = result.matches[0];
          const loadedAssets = [];
          if (typeof directorySync?.readWorkspaceAsset === 'function') {
            for (const asset of selected.manifest?.assets || []) {
              try {
                const loaded = await directorySync.readWorkspaceAsset(
                  selected.manifest, asset.path
                );
                const envelope = loaded?.value;
                if (loaded?.found && envelope?.data !== undefined) {
                  loadedAssets.push({
                    relativePath: asset.path,
                    content: cloneJsonLike(envelope.data),
                    revision: Number(envelope.revision) || Number(asset.revision) || 0,
                    contentHash: String(envelope.contentHash || asset.contentHash || ''),
                    updatedAt: String(envelope.updatedAt || asset.updatedAt || '')
                  });
                }
              } catch (_) {}
            }
          }
          if (typeof directorySync?.listWorkspaceChatAssets === 'function') {
            try {
              const discovered = await directorySync.listWorkspaceChatAssets(
                selected.manifest
              );
              const loadedByPath = new Map(loadedAssets.map(asset => [
                String(asset.relativePath || ''), asset
              ]));
              const manifestPaths = new Set((selected.manifest?.assets || [])
                .map(asset => String(asset.path || '')));
              let recoveredUnindexedChatAssets = 0;
              let recoveredGenerationMismatchChatAssets = 0;
              for (const asset of discovered.assets || []) {
                const path = String(asset.relativePath || '');
                if (!path) continue;
                const current = loadedByPath.get(path);
                if (!current || Number(asset.revision || 0) >=
                    Number(current.revision || 0)) {
                  loadedByPath.set(path, asset);
                }
                if ((!manifestPaths.has(path) ||
                    asset.recoveredGenerationMismatch === true) &&
                    typeof directorySync.enqueueWorkspaceAsset === 'function') {
                  await directorySync.enqueueWorkspaceAsset(
                    selected.manifest, path, asset.content, {
                      revision: Number(asset.revision) || 0,
                      contentHash: String(asset.contentHash || ''),
                      updatedAt: String(asset.updatedAt || ''),
                      workspaceGeneration:
                        Number(selected.manifest.workspaceGeneration) || 1
                    }
                  );
                  if (!manifestPaths.has(path)) recoveredUnindexedChatAssets += 1;
                  if (asset.recoveredGenerationMismatch === true) {
                    recoveredGenerationMismatchChatAssets += 1;
                  }
                }
              }
              loadedAssets.splice(0, loadedAssets.length, ...loadedByPath.values());
              if (recoveredUnindexedChatAssets) scheduleDirectoryFlush();
              result.recoveredUnindexedChatAssets = recoveredUnindexedChatAssets;
              result.recoveredGenerationMismatchChatAssets =
                recoveredGenerationMismatchChatAssets;
              result.invalidChatAssets = Number(discovered.invalidAssets) || 0;
            } catch (_) {}
          }
          const isTurnPath = value => /^chat\/turns\/[^/]+\.json$/u.test(
            String(value || '')
          );
          const isTurnTombstonePath = value => /^chat\/tombstones\/[^/]+\.json$/u.test(
            String(value || '')
          );
          const turnAssets = loadedAssets.filter(asset =>
            isTurnPath(asset.relativePath) && asset.content?.turnId
          );
          const turnTombstones = loadedAssets.filter(asset =>
            isTurnTombstonePath(asset.relativePath) &&
            asset.content?.entityType === 'turn' && asset.content?.entityId
          );
          const deletedTurnIds = new Set(turnTombstones.map(asset =>
            String(asset.content.entityId)
          ));
          const assets = loadedAssets.filter(asset =>
            !isTurnPath(asset.relativePath) && !isTurnTombstonePath(asset.relativePath)
          );
          const chatIndexAsset = assets.find(asset =>
            asset.relativePath === 'chat/index.json'
          );
          const indexedTurnIds = (Array.isArray(chatIndexAsset?.content?.turns)
            ? chatIndexAsset.content.turns : []).map(turn =>
            String(turn?.turnId || '')
          ).filter(Boolean);
          const restoredTurnsById = new Map();
          (Array.isArray(chatIndexAsset?.content?.turns)
            ? chatIndexAsset.content.turns : []).forEach(turn => {
            const turnId = String(turn?.turnId || '');
            if (turnId && !deletedTurnIds.has(turnId)) {
              restoredTurnsById.set(turnId, cloneJsonLike(turn));
            }
          });
          turnAssets.forEach(asset => {
            const turnId = String(asset.content?.turnId || '');
            if (turnId && !deletedTurnIds.has(turnId)) {
              restoredTurnsById.set(turnId, cloneJsonLike(asset.content));
            }
          });
          const restoredTurns = [...restoredTurnsById.values()].sort((left, right) =>
            Number(left.sequence || 0) - Number(right.sequence || 0) ||
            Number(left.createdAt || 0) - Number(right.createdAt || 0) ||
            String(left.turnId || '').localeCompare(String(right.turnId || ''))
          );
          const restoredChatIndex = chatIndexWithTurns(
            chatIndexAsset?.content || {}, restoredTurns
          );
          const restoredTurnIds = restoredTurns.map(turn => String(turn?.turnId || ''));
          const chatIndexNeedsRepair = !chatIndexAsset
            ? restoredTurns.length > 0
            : Number(chatIndexAsset.content?.totalTurns) !== restoredTurns.length ||
              JSON.stringify(indexedTurnIds) !== JSON.stringify(restoredTurnIds);
          if (chatIndexAsset) {
            chatIndexAsset.content = restoredChatIndex;
          } else if (restoredTurns.length) {
            assets.push({
              relativePath: 'chat/index.json',
              content: restoredChatIndex,
              revision: Math.max(0, ...turnAssets.map(asset =>
                Number(asset.revision) || 0
              )),
              contentHash: '',
              updatedAt: String(restoredTurns.at(-1)?.updatedAt || '')
            });
          }
          if (chatIndexNeedsRepair &&
              typeof directorySync?.enqueueWorkspaceAsset === 'function') {
            try {
              await directorySync.enqueueWorkspaceAsset(
                selected.manifest, 'chat/index.json', restoredChatIndex, {
                  revision: Math.max(
                    Date.now(),
                    Number(chatIndexAsset?.revision || 0) + 1
                  ),
                  workspaceGeneration:
                    Number(selected.manifest.workspaceGeneration) || 1
                }
              );
              result.repairedChatIndex = true;
              scheduleDirectoryFlush();
            } catch (_) {
              result.repairedChatIndex = false;
            }
          }
          if (articleWorkspaceStore?.ensureWorkspace && articleWorkspaceStore?.putAsset) {
            // Always reconcile the browser-local workspace with the directory
            // manifest. Reusing an older generation here made the content
            // script restore generation N+1 while IndexedDB remained on N,
            // causing every later chat save to fail.
            const importedWorkspace = await articleWorkspaceStore.ensureWorkspace({
              ...selected.manifest,
              storageRevision: selected.manifest.revision
            });
            for (const asset of assets) {
              await articleWorkspaceStore.putAsset(
                importedWorkspace.workspaceId, asset.relativePath, asset.content,
                { contentHash: asset.contentHash }
              );
            }
            if (typeof articleWorkspaceStore.deleteTurn === 'function') {
              for (const turnId of deletedTurnIds) {
                await articleWorkspaceStore.deleteTurn(importedWorkspace.workspaceId, turnId);
              }
            }
            const existingTurnIds = new Set();
            if (typeof articleWorkspaceStore.pageTurns === 'function') {
              let afterSequence = 0;
              while (true) {
                const page = await articleWorkspaceStore.pageTurns(
                  importedWorkspace.workspaceId, { limit: 1000, afterSequence }
                );
                (page.items || []).forEach(turn => existingTurnIds.add(String(turn.turnId || '')));
                if (!page.hasMore || Number(page.nextSequence) <= afterSequence) break;
                afterSequence = Number(page.nextSequence);
              }
            }
            turnAssets.sort((left, right) =>
              Number(left.content?.sequence || 0) - Number(right.content?.sequence || 0) ||
              String(left.content?.createdAt || '').localeCompare(
                String(right.content?.createdAt || '')
              ) || String(left.content?.turnId || '').localeCompare(
                String(right.content?.turnId || '')
              )
            );
            for (const asset of turnAssets) {
              const turnId = String(asset.content.turnId || '');
              if (!turnId || deletedTurnIds.has(turnId)) continue;
              if (existingTurnIds.has(turnId)) {
                if (typeof articleWorkspaceStore.updateTurn === 'function') {
                  await articleWorkspaceStore.updateTurn(
                    importedWorkspace.workspaceId, turnId, asset.content
                  );
                }
                continue;
              }
              if (typeof articleWorkspaceStore.appendTurn === 'function') {
                await articleWorkspaceStore.appendTurn(
                  importedWorkspace.workspaceId, asset.content
                );
                existingTurnIds.add(turnId);
              }
            }
          }
          result.restore = {
            match: selected.match,
            manifest: selected.manifest,
            assets,
            // Keep the recovered turn records in the restore payload as a
            // second source of truth. The content script can rebuild history
            // even when an older chat/index.json was overwritten empty.
            turns: restoredTurns.map(cloneJsonLike)
          };
        }
        return result;
      }

      if (message.type === 'ARTICLE_WORKSPACE_LIST') {
        requireArticleWorkspaceStore('listWorkspaces');
        const [workspaces, tokenUsageDocuments] = await Promise.all([
          articleWorkspaceStore.listWorkspaces(),
          typeof tokenUsageStore?.list === 'function' ? tokenUsageStore.list() : []
        ]);
        let directoryOverview = {
          permission: 'unconfigured', manifests: [], invalidManifests: 0,
          pendingCount: 0, conflictCount: 0, lastConflict: null
        };
        if (typeof directorySync?.listWorkspaceManifests === 'function') {
          try {
            directoryOverview = {
              ...directoryOverview,
              ...(await directorySync.listWorkspaceManifests({}))
            };
          } catch (_) {}
        }
        if (typeof directorySync?.status === 'function') {
          try {
            directoryOverview = {
              ...directoryOverview,
              ...(await directorySync.status())
            };
          } catch (_) {}
        }
        const manifestById = new Map((directoryOverview.manifests || [])
          .map(manifest => [manifest.workspaceId, manifest]));
        const usageByUrl = new Map((tokenUsageDocuments || [])
          .map(usage => [
            typeof shared.normalizeTokenUsageCanonicalUrl === 'function'
              ? shared.normalizeTokenUsageCanonicalUrl(usage.canonicalUrl)
              : String(usage.canonicalUrl || ''),
            usage
          ]).filter(([url]) => url));
        const summaries = workspaces.map(workspace => {
          const overview = publicWorkspaceOverview(
            workspace, manifestById.get(workspace.workspaceId) || null, directoryOverview
          );
          const url = typeof shared.normalizeTokenUsageCanonicalUrl === 'function'
            ? shared.normalizeTokenUsageCanonicalUrl(workspace.canonicalUrl)
            : String(workspace.canonicalUrl || '');
          return {
            ...overview,
            tokenUsage: usageByUrl.get(url) || null
          };
        });
        return {
          workspaces: summaries,
          totals: {
            workspaceCount: summaries.length,
            estimatedBytes: summaries.reduce((sum, item) => sum + item.estimatedBytes, 0),
            chatTurnCount: summaries.reduce((sum, item) => sum + item.chatTurnCount, 0),
            figureCount: summaries.reduce((sum, item) => sum + item.figureCount, 0),
            panelCount: summaries.reduce((sum, item) => sum + item.panelCount, 0),
            highlightCount: summaries.reduce((sum, item) => sum + item.highlightCount, 0),
            tokenRequests: summaries.reduce((sum, item) =>
              sum + (Number(item.tokenUsage?.totals?.requests) || 0), 0),
            inputTokens: summaries.reduce((sum, item) =>
              sum + (Number(item.tokenUsage?.totals?.inputTokens) || 0), 0),
            outputTokens: summaries.reduce((sum, item) =>
              sum + (Number(item.tokenUsage?.totals?.outputTokens) || 0), 0)
          },
          sync: {
            permission: String(directoryOverview.permission || 'unconfigured'),
            pendingCount: Math.max(0, Number(directoryOverview.pendingCount) || 0),
            conflictCount: Math.max(0, Number(directoryOverview.conflictCount) || 0),
            corruptCount: Math.max(0, Number(directoryOverview.invalidManifests) || 0)
          }
        };
      }

      if (message.type === 'ARTICLE_WORKSPACE_DETAIL') {
        requireArticleWorkspaceStore('getWorkspace');
        requireArticleWorkspaceStore('listAssets');
        requireArticleWorkspaceStore('pageTurns');
        const workspace = await articleWorkspaceStore.getWorkspace(message.workspaceId);
        if (!workspace) {
          const error = new Error('WORKSPACE_NOT_FOUND');
          error.code = 'WORKSPACE_NOT_FOUND';
          throw error;
        }
        const assets = await articleWorkspaceStore.listAssets(workspace.workspaceId);
        const turns = [];
        let afterSequence = 0;
        while (true) {
          const page = await articleWorkspaceStore.pageTurns(workspace.workspaceId, {
            limit: 1000, afterSequence
          });
          turns.push(...page.items);
          if (!page.hasMore || Number(page.nextSequence) <= afterSequence) break;
          afterSequence = Number(page.nextSequence);
        }
        const detail = detailFromWorkspaceAssets(workspace, assets, turns);
        const tokenUsage = typeof tokenUsageStore?.getForDocument === 'function'
          ? await tokenUsageStore.getForDocument({
            canonicalUrl: workspace.canonicalUrl,
            documentKey: workspace.workspaceId
          }) : null;
        return { ...detail, tokenUsage };
      }

      if (message.type === 'LLM_TOKEN_USAGE_LIST') {
        return {
          documents: typeof tokenUsageStore?.list === 'function'
            ? await tokenUsageStore.list() : []
        };
      }

      if (message.type === 'LLM_TOKEN_USAGE_CLEAR') {
        if (typeof tokenUsageStore?.clearDocument !== 'function') {
          return { deleted: false };
        }
        return tokenUsageStore.clearDocument({
          canonicalUrl: message.canonicalUrl,
          documentKey: message.documentKey
        });
      }

      if (message.type === 'ARTICLE_WORKSPACE_STATS') {
        requireArticleWorkspaceStore('getStorageStatistics');
        return articleWorkspaceStore.getStorageStatistics();
      }

      if (message.type === 'ARTICLE_WORKSPACE_EXPORT') {
        requireArticleWorkspaceStore('getWorkspace');
        requireArticleWorkspaceStore('listAssets');
        requireArticleWorkspaceStore('pageTurns');
        const workspace = await articleWorkspaceStore.getWorkspace(message.workspaceId);
        if (!workspace) {
          const error = new Error('WORKSPACE_NOT_FOUND');
          error.code = 'WORKSPACE_NOT_FOUND';
          throw error;
        }
        const turns = [];
        let afterSequence = 0;
        while (true) {
          const page = await articleWorkspaceStore.pageTurns(workspace.workspaceId, {
            limit: 10_000, afterSequence
          });
          turns.push(...page.items);
          if (!page.hasMore || page.nextSequence <= afterSequence) break;
          afterSequence = page.nextSequence;
        }
        return {
          schemaVersion: 1,
          workspace: publicWorkspace(workspace),
          assets: (await articleWorkspaceStore.listAssets(workspace.workspaceId)).map(asset => ({
            relativePath: asset.relativePath,
            content: cloneJsonLike(asset.content),
            contentHash: asset.contentHash,
            revision: asset.revision,
            updatedAt: asset.updatedAt
          })),
          turns: turns.map(turn => cloneJsonLike(turn))
        };
      }

      if (message.type === 'ARTICLE_WORKSPACE_BEGIN_DELETE') {
        requireArticleWorkspaceStore('getWorkspace');
        requireArticleWorkspaceStore('beginWorkspaceDeletion');
        const workspace = await articleWorkspaceStore.getWorkspace(message.workspaceId);
        if (!workspace) {
          const error = new Error('WORKSPACE_NOT_FOUND');
          error.code = 'WORKSPACE_NOT_FOUND';
          throw error;
        }
        const tombstone = await articleWorkspaceStore.beginWorkspaceDeletion(workspace.workspaceId);
        const cancellation = typeof directorySync?.cancelWorkspaceQueue === 'function'
          ? await directorySync.cancelWorkspaceQueue(workspace) : { cancelled: 0 };
        return { ...cloneJsonLike(tombstone), cancelled: Number(cancellation.cancelled) || 0 };
      }

      if (message.type === 'ARTICLE_WORKSPACE_FINALIZE_DELETE') {
        requireArticleWorkspaceStore('getWorkspace');
        requireArticleWorkspaceStore('finalizeWorkspaceDeletion');
        const workspace = await articleWorkspaceStore.getWorkspace(message.workspaceId);
        if (!workspace) return { deleted: true, alreadyMissing: true };
        let disk = { removed: true, permission: 'unconfigured' };
        if (typeof directorySync?.removeWorkspaceTree === 'function') {
          try {
            disk = await directorySync.removeWorkspaceTree(workspace);
          } catch (error) {
            disk = {
              removed: false,
              permission: 'error',
              pending: true,
              errorCode: String(error?.code || error?.name || 'DIRECTORY_DELETE_FAILED')
            };
          }
        }
        await articleWorkspaceStore.finalizeWorkspaceDeletion(
          workspace.workspaceId, message.tombstoneId
        );
        if (typeof tokenUsageStore?.clearDocument === 'function') {
          await tokenUsageStore.clearDocument({
            canonicalUrl: workspace.canonicalUrl,
            documentKey: workspace.workspaceId
          }).catch(() => null);
        }
        const pendingDiskCleanup = !disk.removed && disk.permission !== 'unconfigured';
        return {
          deleted: true,
          permission: disk.permission,
          removedFromDisk: disk.removed,
          pendingDiskCleanup,
          diskCleanupError: disk.errorCode || null,
          workspaceGeneration: Math.max(
            1, Number(workspace.workspaceGeneration) || 1
          ) + 1
        };
      }

      if (message.type === 'ARTICLE_WORKSPACE_REBUILD_INDEX') {
        requireDirectorySync('rebuildWorkspaceIndex');
        return directorySync.rebuildWorkspaceIndex();
      }

      if (message.type === 'ARTICLE_ARCHIVE_PROBE') {
        requireDirectorySync('readJson');
        const documentId = String(message.documentId || '').trim();
        const relativePath = shared.articleArchiveRelativePath({
          documentId,
          canonicalUrl: message.canonicalUrl
        });
        const result = await directorySync.readJson(relativePath);
        if (!result.found) {
          return {
            found: false,
            permission: result.permission,
            relativePath
          };
        }
        const archive = shared.validateArticleArchive(result.value);
        if (shared.articleArchiveRelativePath(archive) !== relativePath) {
          const error = new Error('ARCHIVE_IDENTITY_MISMATCH');
          error.code = 'ARCHIVE_IDENTITY_MISMATCH';
          throw error;
        }
        return {
          found: true,
          permission: result.permission,
          relativePath,
          savedAt: archive.savedAt,
          revision: archive.revision,
          title: archive.title,
          documentHash: archive.documentHash,
          annotationCount: archive.documentRecord.annotations?.length || 0,
          hasLlmAnalysis: Boolean(archive.workspace?.llm?.rawAnalysis),
          hasReviewOutline: Boolean(archive.workspace?.reviewOutline),
          figureCount: Array.isArray(archive.workspace?.figures)
            ? archive.workspace.figures.length : 0
        };
      }

      if (message.type === 'ARTICLE_ARCHIVE_SAVE') {
        requireDirectorySync('enqueueJson');
        const archive = shared.validateArticleArchive(message.archive);
        const relativePath = shared.articleArchiveRelativePath(archive);
        await directorySync.enqueueJson(relativePath, archive);
        scheduleDirectoryFlush();
        return {
          saved: true,
          queued: true,
          relativePath,
          revision: archive.revision,
          savedAt: archive.savedAt
        };
      }

      if (message.type === 'ARTICLE_ARCHIVE_LOAD') {
        requireDirectorySync('readJson');
        const documentId = String(message.documentId || '').trim();
        const relativePath = shared.articleArchiveRelativePath({
          documentId,
          canonicalUrl: message.canonicalUrl
        });
        const directArchive = message.archive
          ? shared.validateArticleArchive(message.archive) : null;
        const result = directArchive
          ? { permission: 'imported', found: true, value: directArchive }
          : await directorySync.readJson(relativePath);
        if (!result.found) {
          const error = new Error('ARTICLE_ARCHIVE_NOT_FOUND');
          error.code = 'ARTICLE_ARCHIVE_NOT_FOUND';
          throw error;
        }
        const archive = shared.validateArticleArchive(result.value);
        if (!directArchive && shared.articleArchiveRelativePath(archive) !== relativePath) {
          const error = new Error('ARCHIVE_IDENTITY_MISMATCH');
          error.code = 'ARCHIVE_IDENTITY_MISMATCH';
          throw error;
        }
        let applied = false;
        if (message.apply === true) {
          await documentStore.putDocument({
            ...archive.documentRecord,
            documentId,
            documentHash: String(message.documentHash || archive.documentHash || ''),
            documentHashes: [...new Set([
              ...(archive.documentRecord.documentHashes || []),
              archive.documentHash,
              message.documentHash
            ].filter(Boolean))],
            canonicalUrl: String(message.canonicalUrl || archive.canonicalUrl || '')
          });
          applied = true;
        }
        return { archive, applied, permission: result.permission, relativePath };
      }

      if (message.type === 'PORTABLE_CONFIG_PROBE') {
        return portableConfigStatus(await portableConfigManager.probe());
      }

      if (message.type === 'PORTABLE_CONFIG_CREATE') {
        return portableConfigStatus(await portableConfigManager.create(
          String(message.passphrase || '')
        ));
      }

      if (message.type === 'PORTABLE_CONFIG_UNLOCK') {
        return portableConfigStatus(await portableConfigManager.unlock(
          String(message.passphrase || '')
        ));
      }

      if (message.type === 'PORTABLE_CONFIG_ROTATE_PASSPHRASE') {
        return portableConfigStatus(await portableConfigManager.rotatePassphrase(
          String(message.currentPassphrase || ''),
          String(message.newPassphrase || '')
        ));
      }

      if (message.type === 'PORTABLE_CONFIG_FORGET_KEY') {
        return portableConfigStatus(await portableConfigManager.forgetKey());
      }

      if (message.type === 'PORTABLE_CONFIG_BACKUP_NOW') {
        return portableConfigStatus(await portableConfigManager.backupNow());
      }

      if (message.type === 'PORTABLE_CONFIG_STATUS') {
        return currentPortableConfigStatus();
      }

      if (message.type === 'USER_DATA_SYNC_STATUS') {
        requireDirectorySync('status');
        const [directoryStatus, portableConfig] = await Promise.all([
          directorySync.status(), currentPortableConfigStatus()
        ]);
        return { ...directoryStatus, portableConfig };
      }

      if (message.type === 'USER_DATA_SYNC_NOW') {
        requireDirectorySync('flush');
        let result = await directorySync.flush(importUserDataAsset);
        if (message.drain === true) {
          for (let attempt = 0; attempt < 5 &&
              result?.permission === 'granted' &&
              !Number(result?.failed) &&
              Number(result?.pendingCount) > 0; attempt += 1) {
            await new Promise(resolve => setTimeout(resolve, 30 * (attempt + 1)));
            result = await directorySync.flush(importUserDataAsset);
          }
        }
        return result;
      }

      if (message.type === 'USER_DATA_REBUILD_INDEX') {
        requireDirectorySync('rebuildIndex');
        return serializeAllMutations(() =>
          directorySync.rebuildIndex(importUserDataAsset)
        );
      }

      if (message.type === 'USER_DATA_EXPORT_BUNDLE') {
        requireDirectorySync('exportBundle');
        const [settings, documents, samples] = await Promise.all([
          shared.loadSettings(storageArea),
          documentStore.exportAll(),
          corpusStore.list()
        ]);
        return directorySync.exportBundle({
          schemaVersion: 1,
          categories: categoryAsset(settings),
          documents,
          feedbackCorpus: shared.exportCorpus(samples, 'jsonl')
        });
      }

      if (message.type === 'LLM_GET_SETTINGS') {
        return publicState(await shared.loadSettings(storageArea));
      }

      if (message.type === 'CATEGORY_GET') {
        const settings = await shared.loadSettings(storageArea);
        return await categoryDetail(settings, String(message.categoryId || ''));
      }

      if (message.type === 'CATEGORY_SAVE_OVERRIDE') {
        return serializeSettingsMutation(async () => {
          const settings = await shared.loadSettings(storageArea);
          const categoryId = String(message.categoryId || '');
          const detail = await categoryDetail(settings, categoryId);
          if (!isPlainObject(message.override)) throw invalidSettings(['override']);
          const incoming = shared.normalizeCategoryOverride(message.override);
          if (incoming.categoryId && incoming.categoryId !== categoryId) {
            throw invalidSettings(['categoryId']);
          }
          delete incoming.categoryId;
          if (!detail.metadata.builtIn) {
            const mergedCategory = shared.mergeCategoryOverrides(detail.category, incoming);
            mergedCategory.categoryId = categoryId;
            mergedCategory.persistence = detail.category.persistence === 'one-off'
              ? 'one-off' : 'saved';
            mergedCategory.builtIn = false;
            const customErrors = shared.validateUnifiedCategory(mergedCategory);
            if (customErrors.length) throw invalidSettings(customErrors);
            if (mergedCategory.persistence === 'one-off') {
              const sessionCategories = await loadRouterSessionCategories();
              const nextSession = sessionCategories
                .filter(item => item.categoryId !== categoryId);
              nextSession.push(mergedCategory);
              await saveRouterSessionCategories(nextSession);
              return await categoryDetail(settings, categoryId);
            }
            settings.customCategories = (settings.customCategories || [])
              .filter(item => item.categoryId !== categoryId);
            settings.customCategories.push(mergedCategory);
            settings.userDataCategoryRevision =
              (Number(settings.userDataCategoryRevision) || 0) + 1;
            const saved = await shared.saveSettings(storageArea, settings);
            await mirrorCategorySettings(saved);
            return await categoryDetail(saved, categoryId);
          }
          const current = isPlainObject(settings.categoryOverrides?.[categoryId])
            ? settings.categoryOverrides[categoryId] : {};
          const nextOverride = deepMergeJsonLike(current, incoming);
          const baseCategory = shared.createUnifiedCategoryCatalog()[categoryId];
          const mergedCategory = shared.mergeCategoryOverrides(baseCategory, nextOverride);
          const errors = shared.validateUnifiedCategory(mergedCategory);
          if (errors.length) throw invalidSettings(errors);
          settings.categoryOverrides[categoryId] = nextOverride;
          settings.userDataCategoryRevision =
            (Number(settings.userDataCategoryRevision) || 0) + 1;
          const saved = await shared.saveSettings(storageArea, settings);
          await mirrorCategorySettings(saved);
          return await categoryDetail(saved, categoryId);
        });
      }

      if (message.type === 'CATEGORY_APPEND_FIXED_PHRASE') {
        return serializeSettingsMutation(async () => {
          const settings = await shared.loadSettings(storageArea);
          const categoryId = String(message.categoryId || '');
          const listType = message.listType === 'exclude' ? 'exclude' : 'include';
          const field = listType === 'exclude' ? 'excludePhrases' : 'phrases';
          const phrase = String(message.phrase || '').normalize('NFKC')
            .replace(/\s+/gu, ' ').trim();
          if (!phrase || phrase.length > shared.MAX_REGEX_LENGTH) {
            throw invalidSettings(['phrase']);
          }
          const detail = await categoryDetail(settings, categoryId);
          const values = Array.isArray(detail.category.regex?.[field])
            ? [...detail.category.regex[field]] : [];
          const comparison = detail.category.regex?.caseSensitive
            ? phrase : phrase.toLocaleLowerCase('en-US');
          const duplicate = values.some(value =>
            (detail.category.regex?.caseSensitive
              ? String(value) : String(value).toLocaleLowerCase('en-US')) === comparison
          );
          if (!duplicate) values.push(phrase);
          const incoming = { regex: { [field]: values } };
          if (!detail.metadata.builtIn) {
            const mergedCategory = shared.mergeCategoryOverrides(detail.category, incoming);
            mergedCategory.categoryId = categoryId;
            mergedCategory.persistence = detail.category.persistence === 'one-off'
              ? 'one-off' : 'saved';
            mergedCategory.builtIn = false;
            const errors = shared.validateUnifiedCategory(mergedCategory);
            if (errors.length) throw invalidSettings(errors);
            if (mergedCategory.persistence === 'one-off') {
              const sessionCategories = await loadRouterSessionCategories();
              await saveRouterSessionCategories([
                ...sessionCategories.filter(item => item.categoryId !== categoryId),
                mergedCategory
              ]);
              return {
                ...(await categoryDetail(settings, categoryId)),
                appended: !duplicate,
                listType,
                phrase
              };
            }
            settings.customCategories = (settings.customCategories || [])
              .filter(item => item.categoryId !== categoryId);
            settings.customCategories.push(mergedCategory);
          } else {
            const current = isPlainObject(settings.categoryOverrides?.[categoryId])
              ? settings.categoryOverrides[categoryId] : {};
            const nextOverride = deepMergeJsonLike(current, incoming);
            const baseCategory = shared.createUnifiedCategoryCatalog()[categoryId];
            const mergedCategory = shared.mergeCategoryOverrides(baseCategory, nextOverride);
            const errors = shared.validateUnifiedCategory(mergedCategory);
            if (errors.length) throw invalidSettings(errors);
            settings.categoryOverrides[categoryId] = nextOverride;
          }
          settings.userDataCategoryRevision =
            (Number(settings.userDataCategoryRevision) || 0) + (duplicate ? 0 : 1);
          const saved = await shared.saveSettings(storageArea, settings);
          if (!duplicate) await mirrorCategorySettings(saved);
          return {
            ...(await categoryDetail(saved, categoryId)),
            appended: !duplicate,
            listType,
            phrase
          };
        });
      }

      if (message.type === 'CATEGORY_RESET_OVERRIDE') {
        return serializeSettingsMutation(async () => {
          const settings = await shared.loadSettings(storageArea);
          const categoryId = String(message.categoryId || '');
          const detail = await categoryDetail(settings, categoryId);
          if (!detail.metadata.builtIn) throw invalidSettings(['categoryId']);
          delete settings.categoryOverrides[categoryId];
          settings.userDataCategoryRevision =
            (Number(settings.userDataCategoryRevision) || 0) + 1;
          const saved = await shared.saveSettings(storageArea, settings);
          await mirrorCategorySettings(saved);
          return await categoryDetail(saved, categoryId);
        });
      }

      if (message.type === 'CATEGORY_DELETE') {
        return serializeAllMutations(async () => {
          const settings = await shared.loadSettings(storageArea);
          const categoryId = String(message.categoryId || '');
          const baseCategory = shared.createUnifiedCategoryCatalog()[categoryId];
          if (!baseCategory ||
              (settings.deletedBuiltInCategoryIds || []).includes(categoryId)) {
            throw invalidSettings(['categoryId']);
          }
          const referenceCount = await documentStore.countCategoryReferences(categoryId);
          settings.deletedBuiltInCategoryIds = [
            ...(settings.deletedBuiltInCategoryIds || []),
            categoryId
          ];
          delete settings.categoryOverrides[categoryId];
          settings.selectedCategoryIds = settings.selectedCategoryIds
            .filter(item => item !== categoryId);
          Object.values(settings.viewCategoryOverrides).forEach(override => {
            override.add = override.add.filter(item => item !== categoryId);
            override.remove = override.remove.filter(item => item !== categoryId);
          });
          settings.userDataCategoryRevision =
            (Number(settings.userDataCategoryRevision) || 0) + 1;
          const saved = await shared.saveSettings(storageArea, settings);
          await mirrorCategorySettings(saved);
          return {
            ...(await publicState(saved)),
            deleted: true,
            builtIn: true,
            referenceCount
          };
        });
      }

      if (message.type === 'CATEGORY_RESTORE_BUILT_IN') {
        return serializeSettingsMutation(async () => {
          const settings = await shared.loadSettings(storageArea);
          const categoryId = String(message.categoryId || '');
          const baseCategory = shared.createUnifiedCategoryCatalog()[categoryId];
          if (!baseCategory ||
              !(settings.deletedBuiltInCategoryIds || []).includes(categoryId)) {
            throw invalidSettings(['categoryId']);
          }
          settings.deletedBuiltInCategoryIds = settings.deletedBuiltInCategoryIds
            .filter(item => item !== categoryId);
          settings.userDataCategoryRevision =
            (Number(settings.userDataCategoryRevision) || 0) + 1;
          const saved = await shared.saveSettings(storageArea, settings);
          await mirrorCategorySettings(saved);
          return publicState(saved);
        });
      }

      if (message.type === 'CATEGORY_TEST_REGEX') {
        const settings = await shared.loadSettings(storageArea);
        const categoryId = String(message.categoryId || '');
        const detail = await categoryDetail(settings, categoryId);
        if (typeof message.testText !== 'string' || message.testText.length > 20000) {
          throw invalidSettings(['testText']);
        }
        let category = detail.category;
        if (message.candidateRegex !== undefined) {
          if (!isPlainObject(message.candidateRegex)) {
            throw invalidSettings(['candidateRegex']);
          }
          category = shared.mergeCategoryOverrides(category, {
            regex: message.candidateRegex
          });
        }
        const errors = shared.validateUnifiedCategory(category);
        if (errors.length) throw invalidSettings(errors);
        return testCategoryRegex(category, message.testText);
      }

      if (message.type === 'LLM_SAVE_PROFILE') {
        return serializeSettingsMutation(async () => {
          const settings = await shared.loadSettings(storageArea);
          const result = upsertProfile(settings, message);
          const saved = await shared.saveSettings(storageArea, settings);
          return {
            ...(await publicState(saved)),
            profile: publicProfileResult(result.profileId, saved.profiles[result.profileId])
          };
        });
      }

      if (message.type === 'LLM_DUPLICATE_PROFILE') {
        return serializeSettingsMutation(async () => {
          const settings = await shared.loadSettings(storageArea);
          requireVersion5Settings(settings);
          const sourceId = String(message.profileId || '');
          const source = settings.profiles?.[sourceId];
          if (!isPlainObject(source)) throw invalidSettings(['profileId']);
          const profileId = duplicateProfileId(settings, sourceId);
          const duplicate = cloneJsonLike(source);
          duplicate.name = `${String(source.name || '')} 副本`.trim();
          const result = upsertProfile(settings, { profile: { ...duplicate, id: profileId } });
          const saved = await shared.saveSettings(storageArea, settings);
          return {
            ...(await publicState(saved)),
            profile: publicProfileResult(result.profileId, saved.profiles[result.profileId])
          };
        });
      }

      if (message.type === 'LLM_DELETE_PROFILE') {
        return serializeSettingsMutation(async () => {
          const settings = await shared.loadSettings(storageArea);
          requireVersion5Settings(settings);
          const profileId = String(message.profileId || '');
          if (!shared.PROFILE_ID_PATTERN?.test(profileId) ||
              !Object.prototype.hasOwnProperty.call(settings.profiles || {}, profileId)) {
            throw invalidSettings(['profileId']);
          }
          delete settings.profiles[profileId];
          settings.profileOrder = orderedProfileIds(settings);
          settings.taskRoutes = shared.normalizeTaskRoutes(
            settings.taskRoutes,
            settings.profiles
          );
          if (settings.globalProfileId === profileId ||
              !Object.prototype.hasOwnProperty.call(
                settings.profiles,
                settings.globalProfileId
              )) settings.globalProfileId = settings.profileOrder[0] || '';
          const saved = await shared.saveSettings(storageArea, settings);
          return {
            ...(await publicState(saved)),
            deletedProfileId: profileId
          };
        });
      }

      if (message.type === 'LLM_UPDATE_PROFILE_ROUTING') {
        return serializeSettingsMutation(async () => {
          const settings = await shared.loadSettings(storageArea);
          requireVersion5Settings(settings);
          if (message.globalProfileId !== undefined) {
            const profileId = String(message.globalProfileId || '');
            if (!Object.prototype.hasOwnProperty.call(settings.profiles || {}, profileId)) {
              throw invalidSettings(['globalProfileId']);
            }
            settings.globalProfileId = profileId;
          }
          settings.taskRoutes = shared.normalizeTaskRoutes(
            message.taskRoutes === undefined ? settings.taskRoutes : message.taskRoutes,
            settings.profiles
          );
          return publicState(await shared.saveSettings(storageArea, settings));
        });
      }

      if (message.type === 'LLM_SAVE_PROVIDER') {
        return serializeSettingsMutation(async () => {
          const settings = await shared.loadSettings(storageArea);
          requireVersion5Settings(settings);
          const providerId = String(message.providerId || '');
          const profileId = shared.legacyProfileId(providerId);
          const current = settings.profiles?.[profileId];
          const currentConfig = isPlainObject(current?.config) ? current.config : {};
          const incomingConfig = isPlainObject(message.config) ? message.config : {};
          const config = { ...cloneJsonLike(currentConfig), ...cloneJsonLike(incomingConfig) };
          if (!String(incomingConfig.apiKey || '').trim() && currentConfig.apiKey) {
            config.apiKey = currentConfig.apiKey;
          }
          const errors = shared.validateProviderConfig(providerId, config);
          if (errors.length) throw invalidSettings(errors);
          const definition = shared.getProviderDefinitions()[providerId];
          const result = upsertProfile(settings, {
            profile: {
              ...(current || {}),
              id: profileId,
              name: current?.name || definition?.label || providerId,
              providerId,
              config
            }
          });
          const saved = await shared.saveSettings(storageArea, settings);
          return {
            ...(await publicState(saved)),
            profile: publicProfileResult(result.profileId, saved.profiles[result.profileId])
          };
        });
      }

      if (message.type === 'LLM_UPDATE_PREFERENCES') {
        return serializeSettingsMutation(async () => {
          const settings = await shared.loadSettings(storageArea);
          requireVersion5Settings(settings);
          const preferences = message.preferences && typeof message.preferences === 'object'
            ? message.preferences : {};
          Object.entries(preferences).forEach(([key, value]) => {
            if (PREFERENCE_KEYS.has(key)) settings[key] = value;
          });
          if (!['regex', 'llm'].includes(settings.mode)) throw invalidSettings(['mode']);
          if (preferences.providerId !== undefined) {
            const legacyProfileId = shared.legacyProfileId(preferences.providerId);
            if (!settings.profiles?.[legacyProfileId]) throw invalidSettings(['providerId']);
            settings.globalProfileId = legacyProfileId;
          }
          delete settings.providerId;
          delete settings.providers;
          if (!settings.profiles?.[settings.globalProfileId]) {
            throw invalidSettings(['globalProfileId']);
          }
          if (!Array.isArray(settings.selectedCategoryIds)) throw invalidSettings(['selectedCategoryIds']);
          const normalizedModes = shared.normalizeAnalysisModes(settings.analysisModes);
          settings.analysisModes = normalizedModes;
          if (!normalizedModes.some(mode => mode.id === settings.readingViewId)) {
            throw invalidSettings(['readingViewId']);
          }
          if (Array.isArray(preferences.selectedCategoryIds)) {
            settings.viewCategoryOverrides[settings.readingViewId] = shared.deriveViewOverride(
              settings.readingViewId,
              preferences.selectedCategoryIds
            );
          }
          const saved = await shared.saveSettings(storageArea, settings);
          return publicState(saved);
        });
      }

      if (message.type === 'LLM_SAVE_CUSTOM_CATEGORY') {
        return serializeSettingsMutation(async () => {
          const settings = await shared.loadSettings(storageArea);
          const sessionCategories = await loadRouterSessionCategories();
          const category = shared.normalizeCustomCategory(message.category || {});
          const errors = shared.validateCategory(category);
          const builtInIds = new Set(Object.keys(shared.createAdaptiveCategoryCatalog()));
          if (builtInIds.has(category.categoryId)) errors.push('categoryId');
          if (errors.length) throw invalidSettings([...new Set(errors)]);

          settings.customCategories = settings.customCategories
            .filter(item => item.categoryId !== category.categoryId);
          const nextSession = sessionCategories
            .filter(item => item.categoryId !== category.categoryId);
          if (category.persistence === 'one-off') nextSession.push(category);
          else settings.customCategories.push(category);
          if (!settings.selectedCategoryIds.includes(category.categoryId)) {
            settings.selectedCategoryIds.push(category.categoryId);
          }
          const currentOverride = settings.viewCategoryOverrides[settings.readingViewId];
          if (!currentOverride.add.includes(category.categoryId)) {
            currentOverride.add.push(category.categoryId);
          }
          currentOverride.remove = currentOverride.remove
            .filter(categoryId => categoryId !== category.categoryId);
          if (category.persistence === 'one-off' ||
              sessionCategories.some(item => item.categoryId === category.categoryId)) {
            await saveRouterSessionCategories(nextSession);
          }
          return publicState(await shared.saveSettings(storageArea, settings));
        });
      }

      if (message.type === 'LLM_DELETE_CUSTOM_CATEGORY') {
        return serializeAllMutations(async () => {
          const settings = await shared.loadSettings(storageArea);
          const categoryId = String(message.categoryId || '');
          const builtInIds = new Set(Object.keys(shared.createAdaptiveCategoryCatalog()));
          if (!categoryId || builtInIds.has(categoryId)) throw invalidSettings(['categoryId']);
          const sessionCategories = await loadRouterSessionCategories();
          const savedDefinition = settings.customCategories
            .find(item => item.categoryId === categoryId);
          const sessionDefinition = sessionCategories
            .find(item => item.categoryId === categoryId);
          if (!savedDefinition && !sessionDefinition) throw invalidSettings(['categoryId']);
          const referenceCount = await documentStore.countCategoryReferences(categoryId);
          settings.selectedCategoryIds = settings.selectedCategoryIds
            .filter(item => item !== categoryId);
          Object.values(settings.viewCategoryOverrides).forEach(override => {
            override.add = override.add.filter(item => item !== categoryId);
            override.remove = override.remove.filter(item => item !== categoryId);
          });
          let nextSession;
          if (referenceCount > 0) {
            settings.customCategories = settings.customCategories.map(item =>
              item.categoryId === categoryId
                ? { ...item, retired: true, enabledEngines: [] }
                : item
            );
            nextSession = sessionCategories.map(item =>
              item.categoryId === categoryId
                ? { ...item, retired: true, enabledEngines: [] }
                : item
            );
          } else {
            settings.customCategories = settings.customCategories
              .filter(item => item.categoryId !== categoryId);
            nextSession = sessionCategories
              .filter(item => item.categoryId !== categoryId);
          }
          await saveRouterSessionCategories(nextSession);
          return {
            ...(await publicState(await shared.saveSettings(storageArea, settings))),
            retired: referenceCount > 0,
            referenceCount
          };
        });
      }

      if (message.type === 'LLM_LIST_MODELS') {
        const settings = await shared.loadSettings(storageArea);
        requireVersion5Settings(settings);
        const profileId = String(message.profileId || '');
        const profile = settings.profiles?.[profileId];
        if (!isPlainObject(profile)) throw invalidSettings(['profileId']);
        const providerId = String(message.providerId || profile.providerId || '');
        if (!Object.prototype.hasOwnProperty.call(
          shared.getProviderDefinitions(), providerId
        )) throw invalidSettings(['providerId']);
        const currentConfig = isPlainObject(profile.config) ? profile.config : {};
        const incomingConfig = isPlainObject(message.config) ? message.config : {};
        const config = {
          ...cloneJsonLike(currentConfig),
          ...cloneJsonLike(incomingConfig)
        };
        if (!String(incomingConfig.apiKey || '').trim() && currentConfig.apiKey) {
          config.apiKey = currentConfig.apiKey;
        }
        return shared.discoverProviderModels({
          providerId,
          config,
          fetchImpl,
          timeoutMs: 20000
        });
      }

      if (message.type === 'LLM_TEST_PROFILE') {
        const settings = await shared.loadSettings(storageArea);
        requireVersion5Settings(settings);
        const profileId = String(message.profileId || '');
        const profile = settings.profiles?.[profileId];
        if (!isPlainObject(profile)) throw invalidSettings(['profileId']);
        return runConnectionTest(profileId, profile, message.config);
      }

      if (message.type === 'CODEX_LOCAL_STATUS') {
        if (!nativeClient || typeof nativeClient.health !== 'function') {
          const error = new Error('The local Codex bridge is unavailable');
          error.code = 'CODEX_BRIDGE_UNAVAILABLE';
          throw error;
        }
        const status = await nativeClient.health({ timeoutMs: 20000 });
        return {
          connected: status?.connected === true,
          accountType: String(status?.accountType || ''),
          planType: String(status?.planType || ''),
          hostVersion: String(status?.hostVersion || ''),
          eventLogPath: String(status?.eventLogPath || ''),
          latestEventPath: String(status?.latestEventPath || '')
        };
      }

      if (message.type === 'CODEX_LOCAL_LOGIN_START') {
        if (!nativeClient || typeof nativeClient.startLogin !== 'function') {
          const error = new Error('The local Codex bridge is unavailable');
          error.code = 'CODEX_BRIDGE_UNAVAILABLE';
          throw error;
        }
        const login = await nativeClient.startLogin({
          force: message.force === true,
          timeoutMs: 30000
        });
        return {
          loginId: String(login?.loginId || ''),
          authUrl: String(login?.authUrl || '')
        };
      }

      if (message.type === 'CODEX_LOCAL_LOGOUT') {
        if (!nativeClient || typeof nativeClient.logout !== 'function') {
          const error = new Error('The local Codex bridge is unavailable');
          error.code = 'CODEX_BRIDGE_UNAVAILABLE';
          throw error;
        }
        return nativeClient.logout({ timeoutMs: 30000 });
      }

      if (message.type === 'LLM_TEST_PROVIDER') {
        const settings = await shared.loadSettings(storageArea);
        requireVersion5Settings(settings);
        const providerId = String(message.providerId || '');
        const profileId = shared.legacyProfileId(providerId);
        const profile = settings.profiles?.[profileId];
        if (!isPlainObject(profile)) throw invalidSettings(['providerId']);
        return runConnectionTest(profileId, profile, message.config);
      }

      if (message.type === 'DOCUMENT_PREPARE') {
        const settings = await shared.loadSettings(storageArea);
        const prepared = await prepareStoredDocument(settings, message.document);
        return {
          documentId: prepared.documentId,
          documentHash: prepared.documentHash,
          record: prepared.record,
          studyProfile: publicStudyProfile(prepared.profile),
          paperBlueprint: prepared.profile?.paperBlueprint || null,
          readingViewId: prepared.composition.viewId,
          activeCategories: prepared.composition.categories.map(publicCategory),
          categorySources: prepared.composition.sources,
          requiresStudyType: !prepared.profile
        };
      }

      if (message.type === 'DOCUMENT_GET') {
        const documentId = String(message.documentId || '').trim();
        if (!documentId) throw invalidSettings(['documentId']);
        return { record: await documentStore.getDocument(documentId) };
      }

      if (message.type === 'ANNOTATION_UPSERT') {
        return serializeDocumentMutation(async () => {
          const settings = await shared.loadSettings(storageArea);
          const documentId = String(message.documentId || '').trim();
          if (!documentId) throw invalidSettings(['documentId']);
          if (!isPlainObject(message.annotation)) throw invalidSettings(['annotation']);
          const categoryId = String(message.annotation.categoryId || '');
          const { categoryMap } = await loadAllCategories(settings);
          const category = categoryMap[categoryId];
          if (!category) throw invalidSettings(['categoryId']);
          const trustedAnnotation = {
            ...message.annotation,
            categoryId,
            categorySnapshot: shared.makeCategorySnapshot(category)
          };
          const record = await documentStore.upsertAnnotation(documentId, trustedAnnotation);
          await mirrorDocumentRecord(record);
          return {
            record,
            annotation: record.annotations.find(item =>
              item.annotationId === trustedAnnotation.annotationId
            ),
            warningThresholdReached: record.annotations.length >=
              (shared.WARNING_ANNOTATIONS_PER_DOCUMENT || 1000)
          };
        });
      }

      if (message.type === 'ANNOTATION_DELETE') {
        return serializeDocumentMutation(async () => {
          const documentId = String(message.documentId || '').trim();
          const annotationId = String(message.annotationId || '').trim();
          if (!documentId) throw invalidSettings(['documentId']);
          if (!annotationId) throw invalidSettings(['annotationId']);
          const record = await documentStore.deleteAnnotation(documentId, annotationId);
          await mirrorDocumentRecord(record);
          return { record };
        });
      }

      if (message.type === 'ANNOTATION_CLEAR_DOCUMENT') {
        return serializeDocumentMutation(async () => {
          const documentId = String(message.documentId || '').trim();
          if (!documentId) throw invalidSettings(['documentId']);
          const record = await documentStore.clearAnnotations(documentId);
          await mirrorDocumentRecord(record);
          return { record };
        });
      }

      if (message.type === 'LLM_PREPARE_DOCUMENT') {
        const settings = await shared.loadSettings(storageArea);
        const prepared = await prepareDocument(settings, message.document);
        return {
          documentId: prepared.documentId,
          documentHash: prepared.documentHash,
          studyProfile: publicStudyProfile(prepared.studyProfile),
          paperBlueprint: prepared.paperBlueprint,
          readingViewId: prepared.readingViewId,
          activeCategories: prepared.activeCategories.map(publicCategory),
          categorySources: prepared.categorySources,
          requiresStudyType: prepared.requiresStudyType,
          profileCacheHit: false,
          fullTextAnalyzed: false
        };
      }

      if (message.type === 'LLM_SET_STUDY_TYPE') {
        return serializeDocumentMutation(async () => {
        const settings = await shared.loadSettings(storageArea);
        const rawDocumentId = String(message.documentId || '').trim();
        const documentHash = String(message.documentHash || '').toLowerCase();
        if (!rawDocumentId && !/^[a-f0-9]{64}$/.test(documentHash)) {
          throw invalidSettings(['documentId']);
        }
        if (!shared.isStudyType(message.studyType)) throw invalidSettings(['studyType']);
        let documentId = rawDocumentId || documentIdsByHash.get(documentHash);
        if (!documentId && documentHash) {
          const exported = await documentStore.exportAll();
          const matchingRecord = exported.documents.find(item =>
            item.documentHash === documentHash ||
            item.documentHashes?.includes(documentHash)
          );
          documentId = matchingRecord?.documentId;
        }
        documentId ||= `sha256:${documentHash}`;
        const record = await documentStore.setStudyType(
          documentId,
          message.studyType
        );
        await mirrorDocumentRecord(record);
        const profile = shared.createManualStudyProfile(record.studyType);
        const composition = await composeCategories(settings, profile);
        return {
          documentId,
          documentHash: documentHash || documentId.replace(/^sha256:/, ''),
          updatedAt: record.updatedAt,
          record,
          studyProfile: publicStudyProfile(profile),
          paperBlueprint: profile.paperBlueprint,
          readingViewId: composition.viewId,
          activeCategories: composition.categories.map(publicCategory),
          categorySources: composition.sources,
          requiresStudyType: false,
          profileCacheHit: false,
          fullTextAnalyzed: false
        };
        });
      }

      if (message.type === 'LLM_ANALYZE_DOCUMENT') {
        const operation = operationFor(message);
        await waitForOperation(operation);
        const settings = await shared.loadSettings(storageArea);
        const prepared = await prepareDocument(settings, message.document);
        requireStudyType(prepared);
        if (!prepared.activeCategories.length) throw invalidSettings(['activeCategories']);
        const highlightTask = createTaskAdapter(settings, 'highlight', {}, context, 'highlight');
        const { adapter: highlightAdapter, route: highlightRoute, routePublic } = highlightTask;
        const progress = routeProgress(context, routePublic);
        const contextHash = shared.stableHash({
          studyType: prepared.studyProfile.primaryType,
          paperBlueprint: prepared.paperBlueprint
        });
        const analysis = await shared.analyzeWithCategoryCache({
          paragraphs: prepared.paragraphs,
          selectedCategories: prepared.activeCategories,
          providerId: highlightRoute.providerId,
          model: highlightRoute.model,
          profileSignature: highlightRoute.profileSignature,
          adapter: highlightAdapter,
          cacheStore,
          // Keep one response compact enough for providers with modest output caps;
          // analysis-pipeline will split again if a single paragraph is still too dense.
          maxChars: 6400,
          concurrency: routePublic.concurrency,
          contextHash,
          viewId: prepared.readingViewId,
          paperBlueprint: prepared.paperBlueprint,
          studyProfile: prepared.studyProfile,
          signal: operation?.controller?.signal,
          waitIfPaused: () => waitForOperation(operation),
          onProgress: progress,
          onParagraphComplete: async completed => {
            await progress({
              phase: 'paragraph_checkpoint',
              chunkId: completed.chunkId,
              paragraphId: completed.paragraphId,
              checkpointedAnnotations: Array.isArray(completed.annotations)
                ? completed.annotations.length : 0,
              checkpointAnnotations: Array.isArray(completed.annotations)
                ? completed.annotations : [],
              checkpointRejected: Array.isArray(completed.rejected)
                ? completed.rejected : []
            });
          },
          onChunkComplete: async completed => {
            await progress({
              phase: 'chunk_checkpoint',
              chunkId: completed.chunkId,
              checkpointedAnnotations: Array.isArray(completed.annotations)
                ? completed.annotations.length : 0,
              // These are already validated, bounded annotations for one
              // chunk. Sending them with progress lets the page render useful
              // highlights while later chunks are still being requested.
              checkpointAnnotations: Array.isArray(completed.annotations)
                ? completed.annotations : [],
              checkpointRejected: Array.isArray(completed.rejected)
                ? completed.rejected : []
            });
          }
        });

        const annotationDigest = shared.stableHash(analysis.annotations);
        const ledgerKey = shared.buildLedgerCacheKey({
          documentHash: prepared.documentHash,
          viewId: prepared.readingViewId,
          studyTypeSignature: shared.studyTypeSignature(prepared.studyProfile),
          categorySignature: shared.stableHash(
            prepared.activeCategories.map(item => [item.categoryId, item.version])
          ),
          annotationDigest,
          ledgerVersion: shared.EVIDENCE_LEDGER_VERSION,
          profileSignature: highlightRoute.profileSignature
        });
        let ledger;
        let ledgerCacheHit = false;
        const ledgerCached = await cacheStore.getMany([ledgerKey]);
        if (ledgerCached.has(ledgerKey)) {
          ledger = ledgerCached.get(ledgerKey).ledger;
          ledgerCacheHit = true;
        } else if (!analysis.annotations.length) {
          ledger = {
            available: true,
            keyAnnotationIds: [],
            relationSummaries: [],
            reviewWarnings: [],
            auditItems: [],
            rejected: []
          };
        } else {
          try {
            const ledgerTask = createTaskAdapter(settings, 'highlight', {}, context, 'highlight');
            ledger = await shared.reviewEvidenceLedger({
              viewId: prepared.readingViewId,
              studyProfile: prepared.studyProfile,
              annotations: analysis.annotations,
              paragraphs: prepared.paragraphs,
              adapter: ledgerTask.adapter,
              signal: operation?.controller?.signal,
              waitIfPaused: () => waitForOperation(operation)
            });
            await cacheStore.setMany([{
              key: ledgerKey,
              createdAt: Date.now(),
              ledger
            }]);
          } catch (error) {
            if (operation?.controller?.signal?.aborted || error?.code === 'CANCELLED') {
              throw shared.operationError();
            }
            ledger = {
              available: false,
              errorCode: safeError(error).code,
              keyAnnotationIds: [],
              relationSummaries: [],
              reviewWarnings: [],
              auditItems: [],
              rejected: []
            };
          }
        }

        return {
          ...analysis,
          documentId: prepared.documentId,
          documentHash: prepared.documentHash,
          studyProfile: publicStudyProfile(prepared.studyProfile),
          paperBlueprint: prepared.paperBlueprint,
          readingViewId: prepared.readingViewId,
          requiresStudyType: false,
          profileCacheHit: false,
          ledgerCacheHit,
          ledger,
          confidenceThreshold: settings.confidenceThreshold,
          semanticRejectedCount: Array.isArray(analysis.rejected)
            ? analysis.rejected.length : 0,
          categories: prepared.activeCategories.map(publicCategory),
          categorySources: prepared.categorySources,
          route: routePublic
        };
      }

      if (message.type === 'LLM_ANALYZE_FIGURES') {
        return analyzeFigures(
          await shared.loadSettings(storageArea),
          message,
          context
        );
      }

      if (message.type === 'LLM_ANALYZE_FIGURE_PANEL') {
        return analyzeFigurePanel(
          await shared.loadSettings(storageArea),
          message,
          context
        );
      }

      if (message.type === 'LLM_ASK_FIGURE_PANEL') {
        return askFigurePanel(
          await shared.loadSettings(storageArea),
          message,
          context
        );
      }

      if (message.type === 'LLM_ASK_ARTICLE') {
        return askArticle(
          await shared.loadSettings(storageArea),
          message,
          context
        );
      }

      if (message.type === 'LLM_ANALYZE_CROSS_FIGURE_LOGIC') {
        return analyzeCrossFigureLogic(
          await shared.loadSettings(storageArea),
          message,
          context
        );
      }

      if (message.type === 'LLM_ANALYZE_REVIEW_OUTLINE') {
        const settings = await shared.loadSettings(storageArea);
        const requestedParagraphIds = new Set(
          (Array.isArray(message.scopeParagraphIds) ? message.scopeParagraphIds : [])
            .map(value => String(value || '').trim())
            .filter(Boolean)
        );
        const prepared = message.paragraphOnly === true
          ? await prepareParagraphOnlyReviewDocument(
            settings, message, requestedParagraphIds
          )
          : await prepareDocument(settings, message.document);
        requireStudyType(prepared);
        const analysisParagraphs = message.paragraphOnly === true
          ? prepared.paragraphs
          : requestedParagraphIds.size
          ? prepared.paragraphs.filter(paragraph =>
              requestedParagraphIds.has(String(paragraph.paragraphId || '')))
          : prepared.paragraphs;
        if (!analysisParagraphs.length) throw invalidSettings(['scopeParagraphIds']);
        const scopeSignature = requestedParagraphIds.size
          ? shared.stableHash({
              scopeId: String(message.scopeId || ''),
              paragraphIds: analysisParagraphs.map(paragraph => paragraph.paragraphId)
            })
          : '';
        const summaryTask = createTaskAdapter(
          settings, 'summary', {}, context,
          message.paragraphOnly === true ? 'singleSummary' : 'batchSummary'
        );
        const { adapter: summaryAdapter, route: summaryRoute, routePublic } = summaryTask;
        const progress = routeProgress(context, routePublic);
        const cacheContext = {
          documentHash: prepared.documentHash,
          providerId: summaryRoute.providerId,
          model: summaryRoute.model,
          profileSignature: summaryRoute.profileSignature,
          outlineVersion: shared.REVIEW_OUTLINE_VERSION,
          promptVersion: shared.REVIEW_PROMPT_VERSION,
          studyTypeSignature: shared.studyTypeSignature(prepared.studyProfile),
          scopeSignature
        };
        const outlineKey = shared.buildReviewOutlineCacheKey(cacheContext);
        const progressKey = shared.buildReviewOutlineProgressKey(cacheContext);
        const cached = await cacheStore.getMany([outlineKey, progressKey]);
        const cachedOutline = cached.get(outlineKey)?.outline;
        const responseBase = {
          documentId: prepared.documentId,
          documentHash: prepared.documentHash,
          studyProfile: publicStudyProfile(prepared.studyProfile),
          providerId: summaryRoute.providerId,
          model: summaryRoute.model,
          route: routePublic,
          nonReviewNotice: prepared.studyProfile.reviewSubtype === 'not_review',
          scopeId: String(message.scopeId || '')
        };
        if (cachedOutline && message.forceRefresh !== true) {
          return { ...responseBase, outline: cachedOutline, cacheHit: true };
        }
        const progressChunks = {
          ...(cached.get(progressKey)?.chunks || {})
        };
        const maxChars = Math.min(10000, Math.max(100, Number(message.maxChars) || 10000));
        const outline = await shared.analyzeReviewOutline({
          paragraphs: analysisParagraphs,
          articleTitle: message.document?.title || '',
          reviewSubtype: prepared.studyProfile.reviewSubtype,
          documentHash: prepared.documentHash,
          adapter: summaryAdapter,
          paragraphOnly: message.paragraphOnly === true,
          resumeChunks: new Map(Object.entries(progressChunks)),
          maxChars,
          sleepImpl,
          onProgress: progress,
          onChunkComplete: async completed => {
            progressChunks[completed.chunkId] = completed;
            await cacheStore.setMany([{
              key: progressKey,
              createdAt: Date.now(),
              chunks: progressChunks
            }]);
            await progress({
              phase: 'review_chunk_checkpoint',
              chunkId: completed.chunkId,
              checkpointSummaries: completed.summaries,
              scopeId: String(message.scopeId || ''),
              paragraphOnly: message.paragraphOnly === true,
              completedChunks: Object.keys(progressChunks).length,
              completedParagraphs: new Set(Object.values(progressChunks)
                .flatMap(item => item?.paragraphIds || [])).size,
              totalParagraphs: analysisParagraphs.length
            });
          }
        });
        await cacheStore.setMany([{
          key: outlineKey,
          createdAt: Date.now(),
          outline
        }]);
        return { ...responseBase, outline, cacheHit: false };
      }

      if (message.type === 'LLM_RECORD_FEEDBACK') {
        const sample = shared.normalizeFeedbackSample(message.sample || {});
        const missing = ['documentHash', 'paragraphId', 'quote', 'categoryId']
          .filter(field => !sample[field]);
        if (missing.length) throw invalidSettings(missing);
        await corpusStore.add(sample);
        const stats = await corpusStore.stats();
        const samples = await corpusStore.list();
        await mirrorText('corpus/feedback.jsonl', shared.exportCorpus(samples, 'jsonl'));
        return {
          saved: true,
          stats,
          suggestExport: stats.documents >= 3 && stats.accepted + stats.corrected >= 3
        };
      }

      if (message.type === 'LLM_CORPUS_STATUS') {
        const stats = await corpusStore.stats();
        return {
          stats,
          suggestExport: stats.documents >= 3 && stats.accepted + stats.corrected >= 3
        };
      }

      if (message.type === 'LLM_EXPORT_CORPUS') {
        const format = message.format === 'csv' ? 'csv' : 'jsonl';
        const samples = await corpusStore.list();
        return {
          format,
          content: shared.exportCorpus(samples, format),
          mimeType: format === 'csv'
            ? 'text/csv;charset=utf-8' : 'application/x-ndjson;charset=utf-8',
          filename: `sci-llm-corpus-${new Date().toISOString().slice(0, 10)}.${format}`
        };
      }

      if (message.type === 'LLM_DISTILL_RULES') {
        const samples = await corpusStore.list();
        const settings = await shared.loadSettings(storageArea);
        const categoryMap = shared.createAdaptiveCategoryCatalog();
        (settings.deletedBuiltInCategoryIds || []).forEach(categoryId => {
          delete categoryMap[categoryId];
        });
        [...settings.customCategories, ...await loadRouterSessionCategories()]
          .forEach(category => { categoryMap[category.categoryId] = category; });
        return {
          rules: shared.distillOfflineRules(samples, categoryMap),
          stats: await corpusStore.stats()
        };
      }

      throw Object.assign(new Error('Unknown message'), { code: 'UNKNOWN_MESSAGE' });
    }

    async function handle(message, context = {}) {
      try {
        return { success: true, data: await handleUnsafe(message || {}, context) };
      } catch (error) {
        const safe = String(message?.type || '').startsWith('PORTABLE_CONFIG_')
          ? safePortableConfigError(error)
          : error;
        return { success: false, error: safeError(safe) };
      }
    }

    return { handle };
  }

  return { createBackgroundRouter };
});
