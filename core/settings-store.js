(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  const FALLBACK_PANEL_FOLLOWUP_PROMPTS = Object.freeze({
    grouping: '解释实验分组、对照组与比较关系，并明确这些分组能够和不能支持的结论。',
    technique_principle: '解释实验或生物信息学技术的原理、读出指标及合理的解释边界。',
    axes_reading: '解释输入中有证据支持的坐标轴、标签和实用读图顺序；不可见时明确说明。',
    sample_information: '只解释输入明确支持的样本、物种、组织、细胞、队列和重复信息，不补猜缺失细节。'
  });

  function normalizeStoredPanelFollowupPrompts(value) {
    if (shared.normalizePanelFollowupPrompts) {
      return shared.normalizePanelFollowupPrompts(value);
    }
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return Object.fromEntries(Object.entries(FALLBACK_PANEL_FOLLOWUP_PROMPTS)
      .map(([topic, fallback]) => {
        const prompt = String(source[topic] || '').normalize('NFKC')
          .replace(/\s+/g, ' ').trim().slice(0, 1000);
        return [topic, prompt || fallback.normalize('NFKC')];
      }));
  }
  const STORAGE_KEY = 'sciLlmSettingsV2';
  const SESSION_CATEGORY_KEY = 'sciLlmSessionCategoriesV2';
  const CATEGORY_IDS = [
    'hypothesis', 'objective', 'method', 'result', 'conclusion', 'comparison',
    'limitation', 'future', 'causality', 'emphasis', 'evidence', 'interpretation'
  ];
  const TASK_ROUTE_KEYS = ['highlight', 'summary', 'figure', 'crossFigure'];
  const PROFILE_ID_PATTERN = /^profile_[a-z0-9_]{3,80}$/;
  const PUBLIC_CONFIG_MAX_DEPTH = 32;
  const PROVIDER_IDS = [
    'openai', 'anthropic', 'gemini', 'deepseek', 'openai-compatible'
  ];
  const PROVIDER_ID_SET = new Set(PROVIDER_IDS);
  const PROVIDER_NAMES = {
    openai: 'OpenAI',
    anthropic: 'Anthropic',
    gemini: 'Gemini',
    deepseek: 'DeepSeek',
    'openai-compatible': 'OpenAI-compatible'
  };
  const PROVIDER_VISION_DEFAULTS = {
    openai: true,
    anthropic: true,
    gemini: true,
    deepseek: false,
    'openai-compatible': false
  };
  const LEGACY_PROVIDER_DEFAULTS = {
    openai: { apiKey: '', model: 'gpt-5-mini', maxOutputTokens: 4096 },
    anthropic: { apiKey: '', model: 'claude-sonnet-4-6', maxOutputTokens: 4096 },
    gemini: { apiKey: '', model: 'gemini-3.5-flash', maxOutputTokens: 4096 },
    deepseek: {
      apiKey: '', model: 'deepseek-v4-flash', maxOutputTokens: 4096, thinking: false
    },
    'openai-compatible': {
      apiKey: '', model: '', presetId: 'custom', baseUrl: '',
      authHeader: 'Authorization', authPrefix: 'Bearer', maxOutputTokens: 4096,
      jsonMode: true, supportsVision: false, customHeaders: {}
    }
  };

  function createDefaultViewOverrides() {
    return {
      quick_story: { add: [], remove: [] },
      mechanism_chain: { add: [], remove: [] },
      critical_review: { add: [], remove: [] },
      review_synthesis: { add: [], remove: [] }
    };
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
      Object.entries(value).map(([key, item]) => [key, cloneJsonLike(item)])
    );
  }

  function mergeJsonLike(base, override) {
    if (!isPlainObject(base) || !isPlainObject(override)) {
      return cloneJsonLike(override);
    }
    const merged = cloneJsonLike(base);
    Object.entries(override).forEach(([key, value]) => {
      merged[key] = isPlainObject(value) && isPlainObject(merged[key])
        ? mergeJsonLike(merged[key], value) : cloneJsonLike(value);
    });
    return merged;
  }

  function normalizeIdList(value) {
    return [...new Set((Array.isArray(value) ? value : [])
      .map(String)
      .filter(item => /^[a-z][a-z0-9_]*$/.test(item)))];
  }

  function normalizeViewOverrides(value) {
    const defaults = createDefaultViewOverrides();
    Object.keys(defaults).forEach(viewId => {
      defaults[viewId] = {
        add: normalizeIdList(value?.[viewId]?.add),
        remove: normalizeIdList(value?.[viewId]?.remove)
      };
    });
    return defaults;
  }

  function deriveViewOverride(viewId, selectedCategoryIds) {
    const defaults = shared.READING_VIEWS?.[viewId]?.categoryIds || CATEGORY_IDS;
    const selected = new Set(normalizeIdList(selectedCategoryIds));
    const knownCategoryIds = typeof shared.createAdaptiveCategoryCatalog === 'function'
      ? Object.keys(shared.createAdaptiveCategoryCatalog()) : defaults;
    return {
      add: [...selected].filter(categoryId => !defaults.includes(categoryId)),
      remove: [...new Set([...defaults, ...knownCategoryIds])]
        .filter(categoryId => !selected.has(categoryId))
    };
  }

  function normalizeStudyTypeOverrides(value) {
    const retained = new Map();
    Object.entries(value && typeof value === 'object' ? value : {})
      .forEach(([documentHash, item]) => {
        if (!/^[a-f0-9]{64}$/i.test(documentHash) || !item || typeof item !== 'object') {
          return;
        }
        const hasCurrentType = shared.isStudyType?.(item.studyType);
        const studyType = hasCurrentType
          ? item.studyType
          : (shared.isStudyType?.(item.primaryType) ? item.primaryType : null);
        if (!studyType) return;

        const timestamp = Number(item.updatedAt);
        const candidate = {
          studyType,
          updatedAt: Number.isFinite(timestamp) ? timestamp : 0,
          hasCurrentType
        };
        const normalizedHash = documentHash.toLowerCase();
        const previous = retained.get(normalizedHash);
        const candidateWinsTie = previous && candidate.updatedAt === previous.updatedAt && (
          (candidate.hasCurrentType && !previous.hasCurrentType) ||
          (candidate.hasCurrentType === previous.hasCurrentType &&
            candidate.studyType.localeCompare(previous.studyType) < 0)
        );
        if (!previous || candidate.updatedAt > previous.updatedAt || candidateWinsTie) {
          retained.set(normalizedHash, candidate);
        }
      });

    return Object.fromEntries(
      [...retained.entries()]
        .sort((first, second) =>
          second[1].updatedAt - first[1].updatedAt || first[0].localeCompare(second[0])
        )
        .slice(0, 50)
        .map(([documentHash, item]) => [documentHash, {
          studyType: item.studyType,
          updatedAt: item.updatedAt
        }])
    );
  }

  function normalizeCategoryOverrides(value, legacyAllRules) {
    const legacy = isPlainObject(legacyAllRules) ? legacyAllRules : {};
    const explicit = isPlainObject(value) ? value : {};
    const categoryIds = new Set([...Object.keys(legacy), ...Object.keys(explicit)]);
    const normalized = {};

    categoryIds.forEach(categoryId => {
      if (!/^[a-z][a-z0-9_]*$/.test(categoryId)) return;
      const legacyRule = isPlainObject(legacy[categoryId]) ? legacy[categoryId] : null;
      const explicitOverride = isPlainObject(explicit[categoryId])
        ? explicit[categoryId] : null;
      if (!legacyRule && !explicitOverride) return;

      const normalize = input => shared.normalizeCategoryOverride
        ? shared.normalizeCategoryOverride(input) : cloneJsonLike(input);
      const migrated = legacyRule ? normalize(legacyRule) : {};
      const saved = explicitOverride ? normalize(explicitOverride) : {};
      normalized[categoryId] = mergeJsonLike(migrated, saved);
    });
    return normalized;
  }

  function normalizeTokenLimit(value, fallback) {
    if (value === null || value === undefined || value === '' ||
        typeof value === 'boolean') return fallback;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    const rounded = Math.round(numeric / 256) * 256;
    return Math.max(512, Math.min(65536, rounded));
  }

  function createTokenPolicy(value = {}) {
    const input = isPlainObject(value) ? value : {};
    if (input.mode === 'manual') {
      return {
        mode: 'manual',
        autoCap: null,
        manualMax: normalizeTokenLimit(input.manualMax, 4096)
      };
    }
    return {
      mode: 'auto',
      autoCap: normalizeTokenLimit(input.autoCap, null),
      manualMax: null
    };
  }

  function normalizeLegacyAutoCap(value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 ||
        value === 4096) return null;
    return normalizeTokenLimit(value, null);
  }

  function normalizeTaskRoutes(value, profiles) {
    const input = isPlainObject(value) ? value : {};
    const availableProfiles = isPlainObject(profiles) ? profiles : {};
    return Object.fromEntries(TASK_ROUTE_KEYS.map(taskId => {
      const route = isPlainObject(input[taskId]) ? input[taskId] : {};
      const profileId = String(route.profileId || '');
      const validProfileRoute = route.mode === 'profile' &&
        Object.prototype.hasOwnProperty.call(availableProfiles, profileId);
      return [taskId, validProfileRoute
        ? { mode: 'profile', profileId }
        : { mode: 'global', profileId: null }];
    }));
  }

  function legacyProfileId(providerId) {
    return `profile_legacy_${String(providerId || '').toLowerCase()
      .replace(/[^a-z0-9]/g, '_')}`;
  }

  function normalizeProfile(id, value) {
    if (!PROFILE_ID_PATTERN.test(String(id || '')) || !isPlainObject(value)) return null;
    const providerId = String(value.providerId || '');
    if (!PROVIDER_ID_SET.has(providerId)) return null;
    const normalized = cloneJsonLike(value);
    delete normalized.id;
    delete normalized.profileId;
    const config = isPlainObject(normalized.config) ? normalized.config : {};
    const name = String(value.name || PROVIDER_NAMES[providerId]).trim() ||
      PROVIDER_NAMES[providerId];
    const hasExplicitVision = isPlainObject(value.capabilities) &&
      value.capabilities.vision !== undefined;
    const vision = hasExplicitVision
      ? Boolean(value.capabilities.vision)
      : (providerId === 'openai-compatible'
        ? config.supportsVision === true
        : PROVIDER_VISION_DEFAULTS[providerId]);
    const capabilities = isPlainObject(normalized.capabilities)
      ? normalized.capabilities : {};
    capabilities.vision = vision;
    normalized.name = name;
    normalized.providerId = providerId;
    normalized.config = config;
    normalized.capabilities = capabilities;
    normalized.tokenPolicy = createTokenPolicy(value.tokenPolicy);
    return normalized;
  }

  function createDefaultProfile() {
    const { maxOutputTokens, ...config } = LEGACY_PROVIDER_DEFAULTS.openai;
    return normalizeProfile('profile_default_openai', {
      name: 'OpenAI',
      providerId: 'openai',
      config,
      capabilities: { vision: true },
      tokenPolicy: { mode: 'auto', autoCap: null }
    });
  }

  function createDefaultTaskRoutes() {
    return normalizeTaskRoutes({}, {});
  }

  function migrateLegacyProfiles(saved) {
    const savedProviders = isPlainObject(saved.providers) ? saved.providers : {};
    const profiles = {};
    const profileOrder = [];
    PROVIDER_IDS.forEach(providerId => {
      const legacyConfig = Object.assign(
        {},
        cloneJsonLike(LEGACY_PROVIDER_DEFAULTS[providerId]),
        isPlainObject(savedProviders[providerId])
          ? cloneJsonLike(savedProviders[providerId]) : {}
      );
      const maxOutputTokens = legacyConfig.maxOutputTokens;
      delete legacyConfig.maxOutputTokens;
      const autoCap = normalizeLegacyAutoCap(maxOutputTokens);
      const profileId = legacyProfileId(providerId);
      profiles[profileId] = normalizeProfile(profileId, {
        name: PROVIDER_NAMES[providerId],
        providerId,
        config: legacyConfig,
        capabilities: {
          vision: providerId === 'openai-compatible'
            ? legacyConfig.supportsVision === true
            : PROVIDER_VISION_DEFAULTS[providerId]
        },
        tokenPolicy: { mode: 'auto', autoCap }
      });
      profileOrder.push(profileId);
    });
    return { profiles, profileOrder };
  }

  function normalizeProfiles(value) {
    if (!isPlainObject(value)) return {};
    return Object.fromEntries(Object.entries(value)
      .map(([profileId, profile]) => [profileId, normalizeProfile(profileId, profile)])
      .filter(([, profile]) => profile));
  }

  function normalizeProfileOrder(value, profiles) {
    const seen = new Set();
    const ordered = [];
    (Array.isArray(value) ? value : []).forEach(profileId => {
      if (typeof profileId !== 'string' || seen.has(profileId) ||
          !Object.prototype.hasOwnProperty.call(profiles, profileId)) return;
      seen.add(profileId);
      ordered.push(profileId);
    });
    Object.keys(profiles).sort().forEach(profileId => {
      if (seen.has(profileId)) return;
      seen.add(profileId);
      ordered.push(profileId);
    });
    return ordered;
  }

  function isPreV4Settings(saved) {
    const version = Number(saved?.version);
    return !Number.isFinite(version) || version < 4;
  }

  function createDefaultSettings() {
    return {
      version: 5,
      mode: 'regex',
      consentGranted: false,
      autoAnalyze: false,
      confidenceThreshold: shared.DEFAULT_CONFIDENCE_THRESHOLD || 0.8,
      readingViewId: 'quick_story',
      viewCategoryOverrides: createDefaultViewOverrides(),
      categoryOverrides: {},
      studyTypeOverrides: {},
      selectedCategoryIds: [...CATEGORY_IDS],
      customCategories: [],
      profiles: { profile_default_openai: createDefaultProfile() },
      globalProfileId: 'profile_default_openai',
      profileOrder: ['profile_default_openai'],
      taskRoutes: createDefaultTaskRoutes(),
      figurePanelFollowupPrompts: normalizeStoredPanelFollowupPrompts({})
    };
  }

  function mergeSettings(saved, options = {}) {
    if (isPlainObject(saved) && typeof saved.version === 'number' &&
        Number.isFinite(saved.version) && saved.version > 5) {
      return cloneJsonLike(saved);
    }
    const defaults = createDefaultSettings();
    if (!isPlainObject(saved)) {
      if (!isPlainObject(options) || !isPlainObject(options.legacyAllRules)) return defaults;
      saved = {};
    }
    const merged = Object.assign({}, defaults, saved);
    const savedVersion = Number(saved.version);
    merged.version = 5;
    merged.selectedCategoryIds = Array.isArray(saved.selectedCategoryIds) ?
      [...saved.selectedCategoryIds] : defaults.selectedCategoryIds;
    merged.customCategories = Array.isArray(saved.customCategories) ?
      saved.customCategories.filter(item => item && typeof item === 'object').map(item => ({ ...item })) : [];
    const hasLegacyProviderShape = !Number.isFinite(savedVersion)
      ? !isPlainObject(saved.profiles)
      : savedVersion < 5;
    if (hasLegacyProviderShape) {
      const migrated = migrateLegacyProfiles(saved);
      merged.profiles = migrated.profiles;
      merged.profileOrder = migrated.profileOrder;
      const selectedLegacyProfileId = legacyProfileId(saved.providerId);
      merged.globalProfileId = Object.prototype.hasOwnProperty.call(
        merged.profiles, selectedLegacyProfileId
      ) ? selectedLegacyProfileId : merged.profileOrder[0];
      merged.taskRoutes = createDefaultTaskRoutes();
    } else {
      const normalizedProfiles = normalizeProfiles(saved.profiles);
      const explicitlyEmptyProfiles = isPlainObject(saved.profiles) &&
        Object.keys(saved.profiles).length === 0;
      merged.profiles = explicitlyEmptyProfiles || Object.keys(normalizedProfiles).length
        ? normalizedProfiles
        : cloneJsonLike(defaults.profiles);
      merged.profileOrder = normalizeProfileOrder(saved.profileOrder, merged.profiles);
      merged.globalProfileId = Object.prototype.hasOwnProperty.call(
        merged.profiles, saved.globalProfileId
      ) ? saved.globalProfileId : (merged.profileOrder[0] || '');
      merged.taskRoutes = normalizeTaskRoutes(saved.taskRoutes, merged.profiles);
    }
    delete merged.providerId;
    delete merged.providers;
    merged.confidenceThreshold = shared.normalizeConfidenceThreshold
      ? shared.normalizeConfidenceThreshold(saved.confidenceThreshold)
      : 0.8;
    merged.readingViewId = shared.isReadingView?.(saved.readingViewId)
      ? saved.readingViewId : 'quick_story';
    merged.viewCategoryOverrides = normalizeViewOverrides(saved.viewCategoryOverrides);
    if (Number(saved.version) < 3 && Array.isArray(saved.selectedCategoryIds)) {
      merged.viewCategoryOverrides.quick_story = deriveViewOverride(
        'quick_story', saved.selectedCategoryIds
      );
    }
    const legacyAllRules = isPreV4Settings(saved) ? options.legacyAllRules : undefined;
    merged.categoryOverrides = normalizeCategoryOverrides(
      saved.categoryOverrides,
      legacyAllRules
    );
    merged.studyTypeOverrides = normalizeStudyTypeOverrides(saved.studyTypeOverrides);
    merged.figurePanelFollowupPrompts = normalizeStoredPanelFollowupPrompts(
      saved.figurePanelFollowupPrompts
    );
    return merged;
  }

  function callStorage(storageArea, method, value) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = result => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      try {
        const maybePromise = storageArea[method](value, done);
        if (maybePromise && typeof maybePromise.then === 'function') {
          maybePromise.then(done, reject);
        }
      } catch (error) {
        reject(error);
      }
    });
  }

  async function loadSettings(storageArea) {
    let result = await callStorage(storageArea, 'get', [STORAGE_KEY, 'allRules']);
    const hasSettings = Object.prototype.hasOwnProperty.call(result || {}, STORAGE_KEY);
    const hasLegacyRules = Object.prototype.hasOwnProperty.call(result || {}, 'allRules');
    if (!hasSettings && !hasLegacyRules) {
      const [settingsResult, rulesResult] = await Promise.all([
        callStorage(storageArea, 'get', STORAGE_KEY),
        callStorage(storageArea, 'get', 'allRules')
      ]);
      result = Object.assign({}, settingsResult, rulesResult);
    }
    const saved = result?.[STORAGE_KEY];
    return mergeSettings(saved, {
      legacyAllRules: isPreV4Settings(saved) ? result?.allRules : undefined
    });
  }

  async function saveSettings(storageArea, settings) {
    const normalized = mergeSettings(settings);
    await callStorage(storageArea, 'set', { [STORAGE_KEY]: normalized });
    return normalized;
  }

  async function loadSessionCategories(storageArea) {
    if (!storageArea) return [];
    const result = await callStorage(storageArea, 'get', SESSION_CATEGORY_KEY);
    const categories = result?.[SESSION_CATEGORY_KEY];
    return Array.isArray(categories)
      ? categories.filter(item => item && typeof item === 'object').map(item => ({ ...item }))
      : [];
  }

  async function saveSessionCategories(storageArea, categories) {
    if (!storageArea) return [];
    const normalized = Array.isArray(categories)
      ? categories.filter(item => item && typeof item === 'object').map(item => ({ ...item }))
      : [];
    await callStorage(storageArea, 'set', { [SESSION_CATEGORY_KEY]: normalized });
    return normalized;
  }

  function isSensitivePublicConfigKey(key) {
    const normalizedKey = String(key).toLowerCase().replace(/[^a-z0-9]/g, '');
    return normalizedKey === 'apikey' || normalizedKey === 'customheaders';
  }

  function sanitizePublicConfigValue(value, depth = 0) {
    if (depth > PUBLIC_CONFIG_MAX_DEPTH) return null;
    if (Array.isArray(value)) {
      return value.map(item => sanitizePublicConfigValue(item, depth + 1));
    }
    if (!isPlainObject(value)) {
      return value === null || ['string', 'number', 'boolean'].includes(typeof value)
        ? value : null;
    }
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !isSensitivePublicConfigKey(key))
      .map(([key, item]) => [key, sanitizePublicConfigValue(item, depth + 1)]));
  }

  function isNonBlankString(value) {
    return typeof value === 'string' && value.trim().length > 0;
  }

  function toPublicSettings(settings) {
    const normalized = mergeSettings(settings);
    const publicSettings = sanitizePublicConfigValue(normalized);
    if (!isPlainObject(normalized.profiles) || !isPlainObject(publicSettings.profiles)) {
      return publicSettings;
    }
    Object.entries(normalized.profiles).forEach(([profileId, profile]) => {
      if (!isPlainObject(profile) || !isPlainObject(profile.config)) return;
      const publicProfile = publicSettings.profiles[profileId];
      if (!isPlainObject(publicProfile)) return;
      const config = profile.config;
      const { apiKey, customHeaders } = config;
      const safeConfig = isPlainObject(publicProfile.config) ? publicProfile.config : {};
      const normalizedApiKey = isNonBlankString(apiKey) ? apiKey.trim() : '';
      safeConfig.hasApiKey = Boolean(normalizedApiKey);
      safeConfig.apiKeyMask = normalizedApiKey ? `••••${normalizedApiKey.slice(-4)}` : '';
      safeConfig.customHeaderNames = isPlainObject(customHeaders)
        ? Object.keys(customHeaders) : [];
      publicProfile.config = safeConfig;
    });
    return publicSettings;
  }

  function isConfiguredProfile(profile) {
    if (!isPlainObject(profile) || !PROVIDER_ID_SET.has(profile.providerId) ||
        !isPlainObject(profile.config)) return false;
    const configured = isNonBlankString(profile.config.apiKey) &&
      isNonBlankString(profile.config.model);
    return configured && (profile.providerId !== 'openai-compatible' ||
      isNonBlankString(profile.config.baseUrl));
  }

  function getEffectiveMode(settings) {
    const normalized = mergeSettings(settings);
    const configured = isPlainObject(normalized.profiles) &&
      Object.values(normalized.profiles).some(isConfiguredProfile);
    return normalized.mode === 'llm' && normalized.consentGranted === true && configured
      ? 'llm' : 'regex';
  }

  return {
    TASK_ROUTE_KEYS,
    PROFILE_ID_PATTERN,
    createDefaultSettings,
    createDefaultViewOverrides,
    createTokenPolicy,
    normalizeTaskRoutes,
    normalizeProfile,
    legacyProfileId,
    deriveViewOverride,
    mergeSettings,
    loadSettings,
    saveSettings,
    loadSessionCategories,
    saveSessionCategories,
    toPublicSettings,
    isConfiguredProfile,
    getEffectiveMode
  };
});
