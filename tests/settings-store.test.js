const test = require('node:test');
const assert = require('node:assert/strict');
require('../core/confidence-policy.js');
require('../core/category-store.js');
require('../core/adaptive-catalog.js');
const {
  TASK_ROUTE_KEYS,
  PROFILE_ID_PATTERN,
  createDefaultSettings,
  createTokenPolicy,
  normalizeTaskRoutes,
  normalizeProfile,
  legacyProfileId,
  mergeSettings,
  loadSettings,
  saveSettings,
  toPublicSettings,
  isConfiguredProfile,
  getEffectiveMode
} = require('../core/settings-store.js');

function createMemoryStorage() {
  const values = {};
  const getCalls = [];
  return {
    values,
    getCalls,
    get(key, callback) {
      getCalls.push(key);
      const keys = Array.isArray(key) ? key : [key];
      callback(Object.fromEntries(keys.map(item => [item, values[item]])));
    },
    set(input, callback) {
      Object.assign(values, input);
      callback();
    }
  };
}

test('defaults to one empty v5 profile and regex mode until any profile is configured and consented', () => {
  const settings = createDefaultSettings();
  assert.equal(settings.version, 5);
  assert.deepEqual(settings.categoryOverrides, {});
  assert.deepEqual(settings.studyTypeOverrides, {});
  assert.deepEqual(settings.customCategories, []);
  assert.deepEqual(Object.keys(settings.profiles), ['profile_default_openai']);
  assert.equal(settings.globalProfileId, 'profile_default_openai');
  assert.deepEqual(settings.profileOrder, ['profile_default_openai']);
  assert.equal(settings.profiles.profile_default_openai.config.apiKey, '');
  assert.deepEqual(settings.taskRoutes, Object.fromEntries(
    TASK_ROUTE_KEYS.map(taskId => [taskId, { mode: 'global', profileId: null }])
  ));
  assert.equal(settings.mode, 'regex');
  assert.equal(settings.autoAnalyze, false);
  assert.equal(settings.consentGranted, false);
  assert.equal(getEffectiveMode(settings), 'regex');

  settings.mode = 'llm';
  settings.profiles.profile_default_openai.config.apiKey = 'secret';
  assert.equal(getEffectiveMode(settings), 'regex');
  settings.consentGranted = true;
  assert.equal(getEffectiveMode(settings), 'llm');
});

test('stores four bounded editable Panel follow-up prompts with defaults for blanks', () => {
  const defaults = createDefaultSettings();
  assert.deepEqual(Object.keys(defaults.figurePanelFollowupPrompts).sort(), [
    'axes_reading', 'grouping', 'sample_information', 'technique_principle'
  ]);
  const merged = mergeSettings({
    ...defaults,
    figurePanelFollowupPrompts: {
      grouping: '  只解释当前论文的分组。  ',
      axes_reading: 'x'.repeat(1200),
      technique_principle: '',
      unsupported: 'ignored'
    }
  });
  assert.equal(merged.figurePanelFollowupPrompts.grouping, '只解释当前论文的分组。');
  assert.equal(merged.figurePanelFollowupPrompts.axes_reading.length, 1000);
  assert.ok(merged.figurePanelFollowupPrompts.technique_principle.length > 0);
  assert.equal(merged.figurePanelFollowupPrompts.unsupported, undefined);
});

test('preserves an explicitly empty v5 profile collection', () => {
  const settings = mergeSettings({
    version: 5,
    profiles: {},
    profileOrder: [],
    globalProfileId: '',
    taskRoutes: {
      figure: { mode: 'profile', profileId: 'profile_deleted' }
    }
  });

  assert.deepEqual(settings.profiles, {});
  assert.deepEqual(settings.profileOrder, []);
  assert.equal(settings.globalProfileId, '');
  assert.deepEqual(settings.taskRoutes, Object.fromEntries(
    TASK_ROUTE_KEYS.map(taskId => [taskId, { mode: 'global', profileId: null }])
  ));
});

test('falls back to the default profile for malformed v5 profile collections', () => {
  const malformedProfiles = [
    null,
    [],
    'not-a-profile-map',
    { invalid_entry: { providerId: 'unknown', config: {} } }
  ];

  malformedProfiles.forEach(profiles => {
    const settings = mergeSettings({
      version: 5,
      profiles,
      profileOrder: ['invalid_entry'],
      globalProfileId: 'invalid_entry',
      taskRoutes: {
        figure: { mode: 'profile', profileId: 'invalid_entry' }
      }
    });

    assert.deepEqual(Object.keys(settings.profiles), ['profile_default_openai']);
    assert.deepEqual(settings.profileOrder, ['profile_default_openai']);
    assert.equal(settings.globalProfileId, 'profile_default_openai');
    assert.deepEqual(settings.taskRoutes.figure, { mode: 'global', profileId: null });
  });
});

test('stores credentials locally but never exposes them in public settings', async () => {
  const storage = createMemoryStorage();
  const settings = createDefaultSettings();
  settings.profiles = {
    profile_private_gateway: {
      name: 'Private gateway',
      providerId: 'openai-compatible',
      config: {
        apiKey: 'super-secret-value',
        model: 'private-model',
        baseUrl: 'https://gateway.example/v1',
        customHeaders: { 'X-Tenant-Token': 'tenant-secret' }
      },
      capabilities: { vision: false },
      tokenPolicy: { mode: 'auto', autoCap: null, manualMax: null }
    }
  };
  settings.globalProfileId = 'profile_private_gateway';
  settings.profileOrder = ['profile_private_gateway'];
  await saveSettings(storage, settings);

  const loaded = await loadSettings(storage);
  assert.equal(loaded.profiles.profile_private_gateway.config.apiKey, 'super-secret-value');
  assert.equal(
    loaded.profiles.profile_private_gateway.config.customHeaders['X-Tenant-Token'],
    'tenant-secret'
  );
  const publicSettings = toPublicSettings(loaded);
  const publicConfig = publicSettings.profiles.profile_private_gateway.config;
  assert.equal(publicConfig.apiKey, undefined);
  assert.equal(publicConfig.customHeaders, undefined);
  assert.equal(publicConfig.hasApiKey, true);
  assert.match(publicConfig.apiKeyMask, /alue$/);
  assert.deepEqual(publicConfig.customHeaderNames, ['X-Tenant-Token']);
  const serialized = JSON.stringify(publicSettings);
  assert.equal(serialized.includes('super-secret-value'), false);
  assert.equal(serialized.includes('tenant-secret'), false);
});

test('migrates complete v4 provider slots to deterministic legacy profiles', () => {
  const v4 = {
    version: 4,
    mode: 'llm',
    providerId: 'deepseek',
    consentGranted: true,
    providers: {
      openai: { apiKey: 'openai-key', model: 'gpt-custom', maxOutputTokens: 4096 },
      anthropic: { apiKey: 'anthropic-key', model: 'claude-custom', maxOutputTokens: 4096 },
      gemini: { apiKey: 'gemini-key', model: 'gemini-custom', maxOutputTokens: 4096 },
      deepseek: {
        apiKey: 'deepseek-key', model: 'deepseek-custom', maxOutputTokens: 12288,
        thinking: true
      },
      'openai-compatible': {
        apiKey: 'gateway-key', model: 'gateway-model',
        baseUrl: 'https://gateway.example/v1', presetId: 'custom',
        authHeader: 'X-API-Key', authPrefix: '', jsonMode: true,
        supportsVision: true, maxOutputTokens: 4096,
        customHeaders: { 'X-Tenant': 'tenant-secret' }
      }
    }
  };

  const migrated = mergeSettings(v4);
  assert.equal(migrated.version, 5);
  assert.equal(legacyProfileId('deepseek'), 'profile_legacy_deepseek');
  assert.equal(
    legacyProfileId('openai-compatible'),
    'profile_legacy_openai_compatible'
  );
  assert.equal(migrated.globalProfileId, 'profile_legacy_deepseek');
  assert.deepEqual(migrated.profileOrder, [
    'profile_legacy_openai',
    'profile_legacy_anthropic',
    'profile_legacy_gemini',
    'profile_legacy_deepseek',
    'profile_legacy_openai_compatible'
  ]);
  assert.equal(migrated.profiles.profile_legacy_deepseek.config.apiKey, 'deepseek-key');
  assert.equal(migrated.profiles.profile_legacy_deepseek.config.thinking, true);
  assert.equal(migrated.profiles.profile_legacy_openai_compatible.config.apiKey, 'gateway-key');
  assert.deepEqual(
    migrated.profiles.profile_legacy_openai_compatible.config.customHeaders,
    { 'X-Tenant': 'tenant-secret' }
  );
  assert.deepEqual(migrated.profiles.profile_legacy_openai.tokenPolicy, {
    mode: 'auto', autoCap: null, manualMax: null
  });
  assert.deepEqual(migrated.profiles.profile_legacy_deepseek.tokenPolicy, {
    mode: 'auto', autoCap: 12288, manualMax: null
  });
  assert.deepEqual(migrated.taskRoutes, Object.fromEntries(
    TASK_ROUTE_KEYS.map(taskId => [taskId, { mode: 'global', profileId: null }])
  ));
  assert.equal('providers' in migrated, false);
  assert.equal('providerId' in migrated, false);
  assert.deepEqual(mergeSettings(migrated), migrated);
});

test('ignores malformed legacy token limits instead of coercing them to a cap', () => {
  const migrated = mergeSettings({
    version: 4,
    providers: {
      openai: { maxOutputTokens: null },
      anthropic: { maxOutputTokens: '' },
      gemini: { maxOutputTokens: false },
      deepseek: { maxOutputTokens: {} },
      'openai-compatible': { maxOutputTokens: '12288' }
    }
  });

  migrated.profileOrder.forEach(profileId => {
    assert.equal(migrated.profiles[profileId].tokenPolicy.autoCap, null);
  });
});

test('treats unversioned provider slots as legacy settings', () => {
  const migrated = mergeSettings({
    providerId: 'deepseek',
    providers: { deepseek: { apiKey: 'legacy-key', model: 'legacy-model' } }
  });

  assert.equal(migrated.globalProfileId, 'profile_legacy_deepseek');
  assert.equal(
    migrated.profiles.profile_legacy_deepseek.config.apiKey,
    'legacy-key'
  );
});

test('normalizes token policies, profile identity, and task routes', () => {
  assert.deepEqual(createTokenPolicy(), {
    mode: 'auto', autoCap: null, manualMax: null
  });
  assert.deepEqual(createTokenPolicy({ mode: 'auto', autoCap: 700 }), {
    mode: 'auto', autoCap: 768, manualMax: null
  });
  assert.deepEqual(createTokenPolicy({ mode: 'auto', autoCap: 999999, manualMax: 8192 }), {
    mode: 'auto', autoCap: 65536, manualMax: null
  });
  assert.deepEqual(createTokenPolicy({ mode: 'manual', manualMax: 1, autoCap: 8192 }), {
    mode: 'manual', autoCap: null, manualMax: 512
  });
  assert.deepEqual(createTokenPolicy({ mode: 'manual', manualMax: 'invalid' }), {
    mode: 'manual', autoCap: null, manualMax: 4096
  });
  assert.deepEqual(createTokenPolicy({ mode: 'invalid', manualMax: 8192 }), {
    mode: 'auto', autoCap: null, manualMax: null
  });

  assert.equal(PROFILE_ID_PATTERN.test('profile_valid_gateway_1'), true);
  assert.equal(normalizeProfile('invalid-profile', { providerId: 'openai', config: {} }), null);
  assert.equal(normalizeProfile('profile_unknown_provider', {
    providerId: 'unknown', config: {}
  }), null);
  const profile = normalizeProfile('profile_valid_gateway_1', {
    name: '  Gateway  ',
    providerId: 'openai-compatible',
    config: { apiKey: 'secret', model: 'm', baseUrl: 'https://example.test', future: 1 },
    capabilities: { vision: 1 },
    tokenPolicy: { mode: 'manual', manualMax: 4100 }
  });
  assert.equal(profile.name, 'Gateway');
  assert.equal(profile.config.future, 1);
  assert.deepEqual(profile.capabilities, { vision: true });
  assert.deepEqual(profile.tokenPolicy, {
    mode: 'manual', autoCap: null, manualMax: 4096
  });

  const profiles = { profile_valid_gateway_1: profile };
  assert.deepEqual(normalizeTaskRoutes({
    highlight: { mode: 'profile', profileId: 'profile_valid_gateway_1' },
    summary: { mode: 'profile', profileId: 'profile_missing' },
    figure: { mode: 'global', profileId: 'profile_valid_gateway_1' },
    extra: { mode: 'profile', profileId: 'profile_valid_gateway_1' }
  }, profiles), {
    highlight: { mode: 'profile', profileId: 'profile_valid_gateway_1' },
    summary: { mode: 'global', profileId: null },
    figure: { mode: 'global', profileId: null },
    crossFigure: { mode: 'global', profileId: null }
  });
});

test('preserves JSON-like profile extensions while normalizing v5 settings', () => {
  const v5Settings = {
    ...createDefaultSettings(),
    profiles: {
      profile_future_openai: {
        id: 'conflicting-id',
        profileId: 'profile_conflict',
        name: 'Future profile',
        providerId: 'openai',
        config: { apiKey: 'key', model: 'model' },
        capabilities: { vision: true, futureAudio: true },
        tokenPolicy: { mode: 'auto', autoCap: null },
        futureMetadata: { nested: [{ keep: true }] },
        futureFlag: 'preserve-me'
      }
    },
    globalProfileId: 'profile_future_openai',
    profileOrder: ['profile_future_openai']
  };

  const normalized = mergeSettings(v5Settings);
  assert.equal(normalized.version, 5);
  assert.deepEqual(
    normalized.profiles.profile_future_openai.futureMetadata,
    { nested: [{ keep: true }] }
  );
  assert.equal(normalized.profiles.profile_future_openai.futureFlag, 'preserve-me');
  assert.equal(normalized.profiles.profile_future_openai.capabilities.futureAudio, true);
  assert.equal(normalized.profiles.profile_future_openai.id, undefined);
  assert.equal(normalized.profiles.profile_future_openai.profileId, undefined);
  assert.notEqual(
    normalized.profiles.profile_future_openai.futureMetadata,
    v5Settings.profiles.profile_future_openai.futureMetadata
  );
  assert.deepEqual(mergeSettings(normalized), normalized);
});

test('treats finite future settings versions as opaque cloned payloads', () => {
  const futureSettings = {
    version: 6,
    mode: 'llm',
    consentGranted: true,
    providerId: 'future-provider',
    providers: {
      'future-provider': { apiKey: 'future-provider-secret', futureOption: true }
    },
    profiles: {
      'future/profile:id': {
        id: 'future/profile:id',
        providerId: 'quantum-provider',
        config: {
          apiKey: 'future-profile-secret', model: { future: true },
          nested: [{ keep: 'opaque' }]
        },
        tokenPolicy: { mode: 'adaptive-v6', futureLimit: { soft: 12345 } },
        capabilities: { vision: 'auto-v6', audio: true },
        futureMetadata: { keep: ['everything'] }
      }
    },
    profileOrder: ['future/profile:id'],
    globalProfileId: 'future/profile:id',
    taskRoutes: { highlight: { mode: 'future-route', future: true } },
    futureRoot: { nested: [{ keep: true }] }
  };
  const snapshot = JSON.parse(JSON.stringify(futureSettings));

  const normalized = mergeSettings(futureSettings);
  assert.deepEqual(normalized, snapshot);
  assert.notEqual(normalized, futureSettings);
  assert.notEqual(normalized.profiles, futureSettings.profiles);
  assert.notEqual(normalized.futureRoot.nested, futureSettings.futureRoot.nested);
  assert.deepEqual(futureSettings, snapshot);
  assert.deepEqual(mergeSettings(normalized), normalized);
  assert.equal(getEffectiveMode(normalized), 'regex');
  assert.equal(getEffectiveMode({ version: 6, mode: 'llm', consentGranted: true }), 'regex');

  const publicFuture = toPublicSettings(normalized);
  const serialized = JSON.stringify(publicFuture);
  assert.equal(serialized.includes('future-provider-secret'), false);
  assert.equal(serialized.includes('future-profile-secret'), false);
  assert.equal(
    publicFuture.profiles['future/profile:id'].tokenPolicy.mode,
    'adaptive-v6'
  );
  assert.deepEqual(normalized, snapshot);
});

test('requires provider-specific fields for profile readiness', () => {
  assert.equal(isConfiguredProfile({
    providerId: 'openai', config: { apiKey: 'key', model: 'model' }
  }), true);
  assert.equal(isConfiguredProfile({
    providerId: 'openai', config: { apiKey: '', model: 'model' }
  }), false);
  assert.equal(isConfiguredProfile({
    providerId: 'openai-compatible',
    config: { apiKey: 'key', model: 'model', baseUrl: '' }
  }), false);
  assert.equal(isConfiguredProfile({
    providerId: 'openai-compatible',
    config: { apiKey: 'key', model: 'model', baseUrl: 'https://example.test/v1' }
  }), true);

  for (const malformed of ['   ', 42, {}, []]) {
    assert.equal(isConfiguredProfile({
      providerId: 'openai', config: { apiKey: malformed, model: 'model' }
    }), false);
    assert.equal(isConfiguredProfile({
      providerId: 'openai', config: { apiKey: 'key', model: malformed }
    }), false);
    assert.equal(isConfiguredProfile({
      providerId: 'openai-compatible',
      config: { apiKey: 'key', model: 'model', baseUrl: malformed }
    }), false);
  }
});

test('requires literal consent before enabling LLM mode', () => {
  const settings = createDefaultSettings();
  settings.mode = 'llm';
  settings.profiles.profile_default_openai.config.apiKey = 'key';
  settings.consentGranted = 'false';
  assert.equal(getEffectiveMode(settings), 'regex');

  settings.consentGranted = true;
  assert.equal(getEffectiveMode(settings), 'llm');
});

test('defaults and normalizes the global confidence threshold', async () => {
  assert.equal(createDefaultSettings().confidenceThreshold, 0.8);
  const storage = createMemoryStorage();
  const settings = createDefaultSettings();
  settings.confidenceThreshold = 2;
  const saved = await saveSettings(storage, settings);
  assert.equal(saved.confidenceThreshold, 0.95);
});

test('migrates v2 settings to reading-view defaults without losing provider config or custom categories', () => {
  const merged = mergeSettings({
    version: 2,
    mode: 'llm',
    selectedCategoryIds: ['result', 'limitation'],
    customCategories: [{
      categoryId: 'custom_translation', name: 'Translation',
      definition: 'Translation relevance', spanPolicy: 'clause', color: '#3366CC', version: 1
    }],
    providers: { deepseek: { apiKey: 'key', model: 'model' } }
  });
  assert.equal(merged.version, 5);
  assert.equal(merged.readingViewId, 'quick_story');
  assert.ok(merged.viewCategoryOverrides.quick_story.add.includes('result'));
  assert.ok(merged.viewCategoryOverrides.quick_story.remove.includes('knowledge_gap'));
  assert.deepEqual(merged.studyTypeOverrides, {});
  assert.equal(merged.profiles.profile_legacy_deepseek.config.apiKey, 'key');
  assert.equal(merged.customCategories[0].categoryId, 'custom_translation');
});

test('keeps separate category changes for all four reading views', () => {
  const merged = mergeSettings({
    version: 3,
    readingViewId: 'mechanism_chain',
    viewCategoryOverrides: {
      quick_story: { add: ['result'], remove: ['known_background'] },
      mechanism_chain: { add: ['limitation'], remove: ['association_evidence'] },
      critical_review: { add: [], remove: ['transparency_reproducibility'] },
      review_synthesis: { add: ['objective'], remove: ['future'] }
    }
  });
  assert.equal(merged.readingViewId, 'mechanism_chain');
  assert.deepEqual(merged.viewCategoryOverrides.mechanism_chain, {
    add: ['limitation'], remove: ['association_evidence']
  });
  assert.deepEqual(merged.viewCategoryOverrides.review_synthesis, {
    add: ['objective'], remove: ['future']
  });
});

test('settings include an independent review view override', () => {
  const settings = createDefaultSettings();
  assert.deepEqual(settings.viewCategoryOverrides.review_synthesis, { add: [], remove: [] });
});

test('migrates legacy phrase rules into editable category overrides', () => {
  const merged = mergeSettings({ version: 3 }, {
    legacyAllRules: {
      result: {
        name: 'Findings',
        color: '#123456',
        patterns: ['increased', 'decreased'],
        isRegex: false
      },
      method: {
        name: 'Methods',
        color: '#abcdef',
        patterns: ['\\b(?:PCR|ELISA)\\b'],
        isRegex: true
      }
    }
  });

  assert.equal(merged.categoryOverrides.result.name, 'Findings');
  assert.equal(merged.categoryOverrides.result.color, '#123456');
  assert.deepEqual(
    merged.categoryOverrides.result.regex.phrases,
    ['increased', 'decreased']
  );
  assert.equal(merged.categoryOverrides.result.regex.expressions, undefined);
  assert.deepEqual(
    merged.categoryOverrides.method.regex.expressions,
    ['\\b(?:PCR|ELISA)\\b']
  );
  assert.equal(merged.categoryOverrides.method.regex.phrases, undefined);
});

test('keeps explicit category overrides ahead of non-conflicting legacy rule fields', () => {
  const merged = mergeSettings({
    version: 3,
    categoryOverrides: {
      result: {
        name: 'My results',
        regex: { caseSensitive: true }
      }
    }
  }, {
    legacyAllRules: {
      result: {
        name: 'Stale name',
        color: '#654321',
        patterns: ['legacy phrase'],
        isRegex: false
      }
    }
  });

  assert.equal(merged.categoryOverrides.result.name, 'My results');
  assert.equal(merged.categoryOverrides.result.color, '#654321');
  assert.equal(merged.categoryOverrides.result.regex.caseSensitive, true);
  assert.deepEqual(merged.categoryOverrides.result.regex.phrases, ['legacy phrase']);
});

test('normalizes document study type overrides to one valid selection', () => {
  const uppercaseHash = 'A'.repeat(64);
  const lowercaseHash = 'b'.repeat(64);
  const merged = mergeSettings({
    version: 3,
    studyTypeOverrides: {
      [uppercaseHash]: {
        primaryType: 'observational',
        secondaryType: 'clinical_trial',
        updatedAt: 123
      },
      [lowercaseHash]: { studyType: 'clinical_trial', updatedAt: 456 },
      invalid_hash: { studyType: 'observational', updatedAt: 999 },
      ['c'.repeat(64)]: { studyType: 'not_a_study_type', updatedAt: 999 }
    }
  });

  assert.deepEqual(merged.studyTypeOverrides[uppercaseHash.toLowerCase()], {
    studyType: 'observational',
    updatedAt: 123
  });
  assert.deepEqual(merged.studyTypeOverrides[lowercaseHash], {
    studyType: 'clinical_trial',
    updatedAt: 456
  });
  assert.equal(merged.studyTypeOverrides.invalid_hash, undefined);
  assert.equal(merged.studyTypeOverrides['c'.repeat(64)], undefined);
  assert.equal('secondaryType' in merged.studyTypeOverrides[uppercaseHash.toLowerCase()], false);
});

test('deduplicates study type hashes before limiting and keeps the newest deterministic record', () => {
  const overrides = {};
  for (let index = 1; index <= 47; index += 1) {
    overrides[index.toString(16).padStart(64, '0')] = {
      studyType: 'observational',
      updatedAt: 500 + index
    };
  }

  const collisionHash = 'a'.repeat(64);
  overrides[collisionHash.toUpperCase()] = {
    studyType: 'observational', updatedAt: 200
  };
  overrides[collisionHash] = {
    studyType: 'clinical_trial', updatedAt: 100
  };

  const tiedHash = 'b'.repeat(64);
  overrides[tiedHash.toUpperCase()] = {
    primaryType: 'basic_mechanistic', updatedAt: 75
  };
  overrides[tiedHash] = {
    studyType: 'preclinical_translational', updatedAt: 75
  };

  const tailHash = 'f'.repeat(64);
  overrides[tailHash] = { studyType: 'observational', updatedAt: 50 };

  const merged = mergeSettings({ version: 3, studyTypeOverrides: overrides });

  assert.equal(Object.keys(merged.studyTypeOverrides).length, 50);
  assert.deepEqual(merged.studyTypeOverrides[collisionHash], {
    studyType: 'observational', updatedAt: 200
  });
  assert.deepEqual(merged.studyTypeOverrides[tiedHash], {
    studyType: 'preclinical_translational', updatedAt: 75
  });
  assert.deepEqual(merged.studyTypeOverrides[tailHash], {
    studyType: 'observational', updatedAt: 50
  });
  assert.deepEqual(Object.keys(merged.studyTypeOverrides[collisionHash]), [
    'studyType', 'updatedAt'
  ]);
});

test('loads legacy rules once for pre-v4 settings without deleting their storage key', async () => {
  const storage = createMemoryStorage();
  storage.values.sciLlmSettingsV2 = { version: 3 };
  storage.values.allRules = {
    result: {
      name: 'Legacy result', color: '#123456',
      patterns: ['legacy phrase'], isRegex: false
    }
  };

  const loaded = await loadSettings(storage);

  assert.deepEqual(loaded.categoryOverrides.result.regex.phrases, ['legacy phrase']);
  assert.deepEqual(storage.getCalls, [['sciLlmSettingsV2', 'allRules']]);
  assert.ok(storage.values.allRules.result);
});

test('does not overwrite current v4 category overrides with stale legacy rules', async () => {
  const storage = createMemoryStorage();
  storage.values.sciLlmSettingsV2 = {
    version: 4,
    categoryOverrides: {
      result: { regex: { phrases: ['current phrase'] } }
    }
  };
  storage.values.allRules = {
    result: { patterns: ['stale phrase'], isRegex: false }
  };

  const loaded = await loadSettings(storage);

  assert.deepEqual(loaded.categoryOverrides.result.regex.phrases, ['current phrase']);
  assert.ok(storage.values.allRules.result);
});

test('falls back to scalar reads for legacy storage adapters without array-key support', async () => {
  const values = {
    sciLlmSettingsV2: { version: 4, providerId: 'deepseek' },
    allRules: { result: { patterns: ['stale phrase'], isRegex: false } }
  };
  const getCalls = [];
  const storage = {
    get(key, callback) {
      getCalls.push(key);
      callback({ [key]: values[key] });
    }
  };

  const loaded = await loadSettings(storage);

  assert.equal(loaded.globalProfileId, 'profile_legacy_deepseek');
  assert.deepEqual(loaded.categoryOverrides, {});
  assert.deepEqual(getCalls, [
    ['sciLlmSettingsV2', 'allRules'],
    'sciLlmSettingsV2',
    'allRules'
  ]);
});

test('defensively normalizes malformed overrides and preserves unknown saved fields', () => {
  const merged = mergeSettings({
    version: 3,
    categoryOverrides: [],
    customCategories: [{ categoryId: 'custom_translation', future: { keep: true } }],
    futureSettings: { nested: { keep: true } }
  }, { legacyAllRules: 'malformed' });

  assert.deepEqual(merged.categoryOverrides, {});
  assert.deepEqual(merged.customCategories[0].future, { keep: true });
  assert.deepEqual(merged.futureSettings, { nested: { keep: true } });
});
