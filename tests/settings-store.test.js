const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
require('../core/confidence-policy.js');
require('../core/category-store.js');
require('../core/adaptive-catalog.js');
require('../core/reading-tools.js');
const { LLM_TASK_IDS } = require('../core/llm-task-catalog.js');
const {
  PROFILE_ID_PATTERN,
  DEFAULT_FIGURE_PANEL_HEADER_FIELDS,
  createDefaultSettings,
  normalizeFigurePanelHeaderFields,
  createTokenPolicy,
  normalizeTaskRoutes,
  normalizeTaskPolicy,
  migrateLegacyTaskRoutes,
  createV5BackupPayload,
  normalizeProfile,
  legacyProfileId,
  mergeSettings,
  loadSettings,
  saveSettings,
  toPublicSettings,
  isConfiguredProfile,
  isLlmReady,
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

test('CommonJS settings-store loads its task catalog without global preload order', () => {
  const output = execFileSync(process.execPath, ['-e', [
    "delete globalThis.SciLLM;",
    "const store = require('./core/settings-store.js');",
    "const settings = store.createDefaultSettings();",
    "process.stdout.write(JSON.stringify({ version: settings.version, taskCount: Object.keys(settings.taskPolicies).length }));"
  ].join(' ')], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });
  assert.deepEqual(JSON.parse(output), { version: 6, taskCount: 18 });
});

test('defaults to version 6 task policies and regex mode until any profile is configured and consented', () => {
  const settings = createDefaultSettings();
  assert.equal(settings.version, 6);
  assert.deepEqual(settings.categoryOverrides, {});
  assert.deepEqual(settings.deletedBuiltInCategoryIds, []);
  assert.deepEqual(settings.studyTypeOverrides, {});
  assert.deepEqual(settings.customCategories, []);
  assert.deepEqual(Object.keys(settings.profiles), ['profile_default_openai']);
  assert.equal(settings.globalProfileId, 'profile_default_openai');
  assert.deepEqual(settings.profileOrder, ['profile_default_openai']);
  assert.equal(settings.profiles.profile_default_openai.config.apiKey, '');
  assert.equal(settings.profiles.profile_default_openai.contextWindowTokens, null);
  assert.equal(settings.taskRoutes, undefined);
  assert.deepEqual(Object.keys(settings.taskPolicies), LLM_TASK_IDS);
  for (const [taskId, policy] of Object.entries(settings.taskPolicies)) {
    assert.deepEqual(Object.keys(policy), [
      'mode', 'profileId', 'reasoningEnabled', 'reasoningEffort',
      'tokenRule', 'allowTextFallback'
    ]);
    assert.deepEqual(policy, {
      mode: ['full_text_translation', 'navigation_title_translation'].includes(taskId) ? 'local' : 'global',
      profileId: null,
      reasoningEnabled: false,
      reasoningEffort: 'auto',
      tokenRule: 'auto',
      allowTextFallback: false
    });
    assert.equal('apiKey' in policy, false);
  }
  assert.equal(settings.mode, 'regex');
  assert.equal(settings.autoAnalyze, false);
  assert.equal(settings.autoCacheFigureImages, true);
  assert.equal(settings.saveArticleWebSnapshot, true);
  assert.equal(settings.literatureNoteTemplates.length, 7);
  assert.equal(settings.lastLiteratureNoteTemplateId, 'basic_research');
  assert.deepEqual(settings.selectionLlmActions.map(item => item.id), [
    'translate', 'explain'
  ]);
  assert.equal(settings.consentGranted, false);
  assert.equal(getEffectiveMode(settings), 'regex');

  settings.mode = 'llm';
  settings.profiles.profile_default_openai.config.apiKey = 'secret';
  assert.equal(getEffectiveMode(settings), 'regex');
  settings.consentGranted = true;
  assert.equal(getEffectiveMode(settings), 'llm');
});

test('normalizes task policies to bounded catalog defaults without credentials', () => {
  const profiles = {
    profile_valid_text: { capabilities: { vision: false } },
    profile_valid_vision: { capabilities: { vision: true } }
  };
  const invalid = normalizeTaskPolicy('document_highlight', {
    mode: 'profile',
    profileId: 'profile_missing',
    reasoningEnabled: 'true',
    reasoningEffort: 'extreme',
    tokenRule: { mode: 'unlimited' },
    allowTextFallback: true,
    apiKey: 'must-not-copy',
    customHeaders: { Authorization: 'must-not-copy' }
  }, profiles);
  assert.deepEqual(invalid, {
    mode: 'global',
    profileId: null,
    reasoningEnabled: false,
    reasoningEffort: 'auto',
    tokenRule: 'auto',
    allowTextFallback: false
  });

  const valid = normalizeTaskPolicy('figure_panel_interpretation', {
    mode: 'profile',
    profileId: 'profile_valid_vision',
    reasoningEnabled: true,
    reasoningEffort: 'xhigh',
    tokenRule: 'auto',
    allowTextFallback: true,
    apiKey: 'must-not-copy'
  }, profiles);
  assert.deepEqual(valid, {
    mode: 'profile',
    profileId: 'profile_valid_vision',
    reasoningEnabled: true,
    reasoningEffort: 'xhigh',
    tokenRule: 'auto',
    allowTextFallback: true
  });
});

test('preserves only a bounded custom token rule through v6 merge and storage round trips', async () => {
  const settings = createDefaultSettings();
  const sourceRule = {
    input: {
      safetyRatio: 0.9,
      reservedTokens: 1024,
      sourceCapTokens: 20000,
      maxUnits: 12,
      prompt: 'must-not-copy'
    },
    output: {
      base: 1000,
      perUnit: 500,
      floor: 2048,
      ceiling: 8192,
      truncationRetries: 1,
      retryMultiplier: 1.5,
      schema: { apiKey: 'must-not-copy' }
    },
    apiKey: 'must-not-copy',
    code: 'must-not-copy'
  };
  settings.taskPolicies.figure_walkthrough.tokenRule = sourceRule;

  const merged = mergeSettings(settings);
  assert.deepEqual(merged.taskPolicies.figure_walkthrough.tokenRule, {
    input: {
      safetyRatio: 0.9,
      reservedTokens: 1024,
      sourceCapTokens: 20000,
      maxUnits: 12
    },
    output: {
      base: 1000,
      perUnit: 500,
      floor: 2048,
      ceiling: 8192,
      truncationRetries: 1,
      retryMultiplier: 1.5
    }
  });
  assert.notEqual(merged.taskPolicies.figure_walkthrough.tokenRule, sourceRule);
  assert.equal(/apiKey|prompt|schema|code/.test(
    JSON.stringify(merged.taskPolicies.figure_walkthrough.tokenRule)
  ), false);

  const storage = createMemoryStorage();
  await saveSettings(storage, merged);
  const loaded = await loadSettings(storage);
  assert.deepEqual(
    loaded.taskPolicies.figure_walkthrough.tokenRule,
    merged.taskPolicies.figure_walkthrough.tokenRule
  );
  assert.notEqual(
    loaded.taskPolicies.figure_walkthrough.tokenRule,
    merged.taskPolicies.figure_walkthrough.tokenRule
  );
});

test('normalizes malformed custom token rules and rejects prototype injection', () => {
  const malformed = normalizeTaskPolicy('figure_walkthrough', {
    tokenRule: {
      input: {
        safetyRatio: Infinity,
        reservedTokens: -30,
        sourceCapTokens: 1e100,
        maxUnits: 0
      },
      output: {
        base: NaN,
        perUnit: -1,
        floor: 0,
        ceiling: Infinity,
        truncationRetries: 999,
        retryMultiplier: 1
      }
    }
  }, {});
  assert.deepEqual(malformed.tokenRule, {
    input: {
      safetyRatio: 1,
      reservedTokens: 0,
      sourceCapTokens: 2000000,
      maxUnits: 1
    },
    output: {
      base: 3200,
      perUnit: 0,
      floor: 512,
      ceiling: 24576,
      truncationRetries: 10,
      retryMultiplier: 1.75
    }
  });

  const inherited = Object.create({
    input: { sourceCapTokens: 1 },
    output: { ceiling: 1 }
  });
  assert.equal(normalizeTaskPolicy('figure_walkthrough', {
    tokenRule: inherited
  }, {}).tokenRule, 'auto');

  const injected = JSON.parse('{"input":{"__proto__":{"apiKey":"secret"}},"output":{}}');
  assert.equal(normalizeTaskPolicy('figure_walkthrough', {
    tokenRule: injected
  }, {}).tokenRule, 'auto');
});

test('migrates every v5 task route to its approved version 6 task policies', () => {
  const profiles = {
    profile_fast: {
      config: { reasoningEffort: 'xhigh' },
      capabilities: { vision: false }
    },
    profile_text: {
      config: { reasoningEnabled: true, reasoningEffort: 'high' },
      capabilities: { vision: false }
    },
    profile_vision: {
      config: { thinking: true, reasoningEffort: 'medium' },
      capabilities: { vision: true }
    }
  };
  const migrated = migrateLegacyTaskRoutes({
    highlight: { mode: 'profile', profileId: 'profile_fast' },
    summary: { mode: 'profile', profileId: 'profile_text' },
    figure: {
      mode: 'profile', profileId: 'profile_vision', allowTextFallback: true
    },
    crossFigure: { mode: 'global', profileId: 'profile_fast' }
  }, profiles);

  const expectedRouteGroups = {
    document_highlight: 'profile_fast',
    evidence_ledger_review: 'profile_fast',
    paragraph_summary: 'profile_text',
    article_outline_summary: 'profile_text',
    abbreviation_translation: 'profile_text',
    paper_research_logic: 'profile_text',
    paper_innovations: 'profile_text',
    paper_limitations: 'profile_text',
    literature_note_autofill: 'profile_text',
    article_chat: 'profile_text',
    selection_chat: 'profile_text',
    figure_walkthrough: 'profile_vision',
    figure_panel_interpretation: 'profile_vision',
    figure_panel_followup: 'profile_vision'
  };
  assert.deepEqual(Object.keys(migrated), LLM_TASK_IDS);
  for (const [taskId, profileId] of Object.entries(expectedRouteGroups)) {
    assert.equal(migrated[taskId].mode, 'profile', taskId);
    assert.equal(migrated[taskId].profileId, profileId, taskId);
  }
  assert.equal(migrated.taskPolicies, undefined);
  assert.equal(migrated.document_highlight.profileId, 'profile_fast');
  assert.equal(migrated.evidence_ledger_review.profileId, 'profile_fast');
  assert.equal(migrated.document_highlight.reasoningEnabled, false);
  assert.equal(migrated.document_highlight.reasoningEffort, 'xhigh');
  assert.equal(migrated.abbreviation_translation.profileId, 'profile_text');
  assert.equal(migrated.figure_panel_followup.profileId, 'profile_vision');
  assert.equal(migrated.cross_figure_mechanism.mode, 'global');
  assert.equal(migrated.cross_figure_mechanism.profileId, null);
  assert.equal(migrated.paragraph_summary.reasoningEnabled, true);
  assert.equal(migrated.paragraph_summary.reasoningEffort, 'high');
  assert.equal(migrated.figure_walkthrough.reasoningEnabled, true);
  assert.equal(migrated.figure_walkthrough.reasoningEffort, 'medium');
  assert.equal(migrated.figure_walkthrough.allowTextFallback, true);
  assert.equal(migrated.cross_figure_mechanism.allowTextFallback, false);
});

test('mergeSettings promotes v5 taskRoutes to version 6 taskPolicies', () => {
  const profile = normalizeProfile('profile_fast_route', {
    name: 'Fast route',
    providerId: 'openai',
    config: { apiKey: 'local-secret', model: 'gpt-fast' },
    capabilities: { vision: true }
  });
  const migrated = mergeSettings({
    version: 5,
    profiles: { profile_fast_route: profile },
    profileOrder: ['profile_fast_route'],
    globalProfileId: 'profile_fast_route',
    taskRoutes: {
      highlight: { mode: 'profile', profileId: 'profile_fast_route' },
      summary: { mode: 'profile', profileId: 'profile_fast_route' },
      figure: { mode: 'profile', profileId: 'profile_fast_route' },
      crossFigure: { mode: 'global', profileId: null }
    }
  });

  assert.equal(migrated.version, 6);
  assert.equal(migrated.taskRoutes, undefined);
  assert.equal(migrated.taskPolicies.document_highlight.profileId, 'profile_fast_route');
  assert.equal(migrated.taskPolicies.evidence_ledger_review.profileId, 'profile_fast_route');
  assert.equal(migrated.taskPolicies.abbreviation_translation.profileId, 'profile_fast_route');
  assert.equal(migrated.taskPolicies.figure_panel_followup.profileId, 'profile_fast_route');
  assert.equal(migrated.taskPolicies.cross_figure_mechanism.mode, 'global');
});

test('v5 global routes inherit explicit reasoning from the effective global profile', () => {
  const profile = normalizeProfile('profile_global_reasoning', {
    name: 'Global reasoning',
    providerId: 'openai',
    config: {
      apiKey: 'local-key', model: 'gpt-global',
      reasoningEnabled: true, reasoningEffort: 'high'
    },
    capabilities: { vision: true }
  });
  const migrated = mergeSettings({
    version: 5,
    profiles: { profile_global_reasoning: profile },
    profileOrder: ['profile_global_reasoning'],
    globalProfileId: 'profile_global_reasoning',
    taskRoutes: {
      highlight: { mode: 'global', profileId: null },
      summary: { mode: 'global', profileId: null }
    }
  });

  for (const taskId of [
    'document_highlight', 'evidence_ledger_review', 'paragraph_summary',
    'article_outline_summary', 'abbreviation_translation'
  ]) {
    assert.equal(migrated.taskPolicies[taskId].mode, 'global', taskId);
    assert.equal(migrated.taskPolicies[taskId].profileId, null, taskId);
    assert.equal(migrated.taskPolicies[taskId].reasoningEnabled, true, taskId);
    assert.equal(migrated.taskPolicies[taskId].reasoningEffort, 'high', taskId);
  }
});

test('public settings expose a read-only legacy taskRoutes projection', () => {
  const settings = createDefaultSettings();
  settings.taskPolicies.document_highlight = {
    ...settings.taskPolicies.document_highlight,
    mode: 'profile',
    profileId: 'profile_default_openai'
  };
  settings.taskPolicies.paragraph_summary = {
    ...settings.taskPolicies.paragraph_summary,
    mode: 'profile',
    profileId: 'profile_default_openai'
  };
  const publicSettings = toPublicSettings(settings);

  assert.deepEqual(publicSettings.taskRoutes, {
    highlight: { mode: 'profile', profileId: 'profile_default_openai' },
    summary: { mode: 'profile', profileId: 'profile_default_openai' },
    figure: { mode: 'global', profileId: null },
    crossFigure: { mode: 'global', profileId: null }
  });
  publicSettings.taskRoutes.highlight.profileId = 'profile_missing';
  const persisted = mergeSettings(publicSettings);
  assert.equal(persisted.taskRoutes, undefined);
  assert.equal(
    persisted.taskPolicies.document_highlight.profileId,
    'profile_default_openai'
  );
});

test('v6 compatibility route patches persist when taskPolicies are absent', async () => {
  const storage = createMemoryStorage();
  const patch = createDefaultSettings();
  delete patch.taskPolicies;
  patch.taskRoutes = {
    highlight: { mode: 'global', profileId: null },
    summary: { mode: 'global', profileId: null },
    figure: { mode: 'profile', profileId: 'profile_default_openai' },
    crossFigure: { mode: 'global', profileId: null }
  };

  const saved = await saveSettings(storage, patch);

  assert.equal(saved.taskRoutes, undefined);
  for (const taskId of [
    'figure_walkthrough', 'figure_panel_interpretation', 'figure_panel_followup'
  ]) {
    assert.equal(saved.taskPolicies[taskId].mode, 'profile', taskId);
    assert.equal(
      saved.taskPolicies[taskId].profileId,
      'profile_default_openai',
      taskId
    );
  }
  assert.deepEqual(storage.values.sciLlmSettingsV2.taskPolicies, saved.taskPolicies);
  assert.equal(storage.values.sciLlmSettingsV2.taskRoutes, undefined);
});

test('backs up normalized v5 settings once before the first v6 save', async () => {
  const storage = createMemoryStorage();
  storage.values.sciLlmSettingsV2 = {
    version: 5,
    profiles: {
      profile_backup_route: {
        name: 'Backup route',
        providerId: 'openai',
        config: { apiKey: 'backup-local-key', model: 'gpt-backup' },
        capabilities: { vision: true }
      }
    },
    profileOrder: ['profile_backup_route'],
    globalProfileId: 'profile_backup_route',
    taskRoutes: {
      summary: { mode: 'profile', profileId: 'profile_backup_route' }
    },
    futureSetting: { preserve: true }
  };
  const payload = createV5BackupPayload(storage.values.sciLlmSettingsV2);
  assert.equal(payload.version, 5);
  assert.equal(payload.taskPolicies, undefined);
  assert.deepEqual(payload.taskRoutes.summary, {
    mode: 'profile', profileId: 'profile_backup_route'
  });
  assert.deepEqual(payload.futureSetting, { preserve: true });

  const loaded = await loadSettings(storage);
  await saveSettings(storage, loaded);
  assert.deepEqual(storage.values.sciLlmSettingsV5Backup, payload);
  assert.equal(storage.values.sciLlmSettingsV2.version, 6);
  assert.equal(storage.values.sciLlmSettingsV2.taskRoutes, undefined);
  assert.deepEqual(Object.keys(storage.values.sciLlmSettingsV2.taskPolicies), LLM_TASK_IDS);

  const firstBackup = JSON.parse(JSON.stringify(storage.values.sciLlmSettingsV5Backup));
  storage.values.sciLlmSettingsV2.futureSetting = { preserve: false };
  await saveSettings(storage, storage.values.sciLlmSettingsV2);
  assert.deepEqual(storage.values.sciLlmSettingsV5Backup, firstBackup);
});

test('persists only valid unique deleted built-in category ids', () => {
  const settings = mergeSettings({
    version: 5,
    deletedBuiltInCategoryIds: [
      'objective', 'objective', 'causal_overreach', 'custom_unknown', '../result'
    ]
  });
  assert.deepEqual(
    settings.deletedBuiltInCategoryIds,
    ['objective', 'causal_overreach']
  );
  assert.deepEqual(
    mergeSettings(settings).deletedBuiltInCategoryIds,
    ['objective', 'causal_overreach']
  );
});

test('Figure original caching defaults on and preserves an explicit opt-out', () => {
  assert.equal(mergeSettings({ version: 5 }).autoCacheFigureImages, true);
  assert.equal(
    mergeSettings({ version: 5, autoCacheFigureImages: false }).autoCacheFigureImages,
    false
  );
});

test('normalizes offline snapshots, literature templates, remembered template, and selection actions', () => {
  const merged = mergeSettings({
    version: 5,
    saveArticleWebSnapshot: false,
    literatureNoteTemplates: [{
      id: 'clinical_custom',
      name: 'Clinical custom',
      studyFamily: 'clinical',
      fields: [{ id: 'population', label: 'Population' }]
    }],
    lastLiteratureNoteTemplateId: 'missing_template',
    selectionLlmActions: [{
      id: 'criticize', name: 'Critique', prompt: 'Identify unsupported claims.', enabled: true
    }]
  });

  assert.equal(merged.saveArticleWebSnapshot, false);
  assert.deepEqual(merged.literatureNoteTemplates.map(item => item.id), ['clinical_custom']);
  assert.equal(merged.lastLiteratureNoteTemplateId, 'clinical_custom');
  assert.deepEqual(merged.selectionLlmActions.map(item => item.id), ['criticize']);
});

test('Panel heading fields use the approved defaults and return fresh copies', () => {
  const expected = {
    evidenceType: true,
    purpose: false,
    experimentalMethods: true,
    statisticalMethods: true,
    comparison: false,
    directObservation: false
  };
  const first = createDefaultSettings();
  const second = createDefaultSettings();

  assert.deepEqual(DEFAULT_FIGURE_PANEL_HEADER_FIELDS, expected);
  assert.deepEqual(first.figurePanelHeaderFields, expected);
  assert.notEqual(first.figurePanelHeaderFields, second.figurePanelHeaderFields);
  first.figurePanelHeaderFields.evidenceType = false;
  assert.equal(second.figurePanelHeaderFields.evidenceType, true);
});

test('strictly normalizes Panel heading fields and drops unknown keys', () => {
  const source = {
    evidenceType: false,
    purpose: true,
    experimentalMethods: 1,
    statisticalMethods: 'true',
    comparison: true,
    directObservation: null,
    unsupported: true
  };
  const normalized = normalizeFigurePanelHeaderFields(source);

  assert.deepEqual(normalized, {
    evidenceType: false,
    purpose: true,
    experimentalMethods: true,
    statisticalMethods: true,
    comparison: true,
    directObservation: false
  });
  assert.equal(Object.hasOwn(normalized, 'unsupported'), false);
  assert.notEqual(normalized, source);
  source.purpose = false;
  assert.equal(normalized.purpose, true);
  assert.deepEqual(normalizeFigurePanelHeaderFields(null),
    DEFAULT_FIGURE_PANEL_HEADER_FIELDS);
  assert.deepEqual(normalizeFigurePanelHeaderFields([]),
    DEFAULT_FIGURE_PANEL_HEADER_FIELDS);
  assert.deepEqual(normalizeFigurePanelHeaderFields({
    evidenceType: 'false', purpose: 1
  }), DEFAULT_FIGURE_PANEL_HEADER_FIELDS);
});

test('merge and save normalize Panel heading fields without aliasing storage input', async () => {
  const storedFields = { purpose: true, evidenceType: false, unknown: true };
  const merged = mergeSettings({ version: 5, figurePanelHeaderFields: storedFields });
  assert.deepEqual(merged.figurePanelHeaderFields, {
    evidenceType: false,
    purpose: true,
    experimentalMethods: true,
    statisticalMethods: true,
    comparison: false,
    directObservation: false
  });
  assert.notEqual(merged.figurePanelHeaderFields, storedFields);
  assert.deepEqual(mergeSettings({ version: 5 }).figurePanelHeaderFields,
    DEFAULT_FIGURE_PANEL_HEADER_FIELDS);

  const storage = createMemoryStorage();
  const saved = await saveSettings(storage, {
    ...createDefaultSettings(),
    figurePanelHeaderFields: { comparison: true, directObservation: true }
  });
  assert.deepEqual(saved.figurePanelHeaderFields, {
    evidenceType: true,
    purpose: false,
    experimentalMethods: true,
    statisticalMethods: true,
    comparison: true,
    directObservation: true
  });
  assert.notEqual(saved.figurePanelHeaderFields,
    storage.values.sciLlmSettingsV2.figurePanelHeaderFields);
});

test('keyboard shortcuts default to the complete unique map and normalize overrides', () => {
  assert.deepEqual(createDefaultSettings().keyboardShortcuts, {
    figures: 'F',
    navigation: 'G',
    analysis: 'A',
    highlights: 'H',
    chat: 'Q',
    semanticFind: 'J',
    zotero: 'Z',
    ppt: 'P',
    scanLocal: 'R',
    saveLocal: 'S',
    deleteLocal: 'D',
    exportJson: 'E',
    importJson: 'I',
    settings: 'T',
    collapseFigurePanels: '0'
  });
  const merged = mergeSettings({
    version: 5,
    keyboardShortcuts: { figures: 'x', navigation: '', ppt: '7' }
  });
  assert.equal(merged.keyboardShortcuts.figures, 'X');
  assert.equal(merged.keyboardShortcuts.navigation, '');
  assert.equal(merged.keyboardShortcuts.ppt, '7');
  assert.equal(merged.keyboardShortcuts.analysis, 'A');
});

test('treats a local Codex profile as configured without storing an API key', () => {
  const settings = createDefaultSettings();
  settings.mode = 'llm';
  settings.consentGranted = true;
  settings.profiles = {
    profile_codex_local: normalizeProfile('profile_codex_local', {
      name: '本机 Codex',
      providerId: 'codex-local',
      config: { model: 'auto', reasoningEffort: 'high' }
    })
  };
  settings.profileOrder = ['profile_codex_local'];
  settings.globalProfileId = 'profile_codex_local';

  assert.equal(isConfiguredProfile(settings.profiles.profile_codex_local), true);
  assert.equal(getEffectiveMode(settings), 'llm');
  assert.equal(
    toPublicSettings(settings).profiles.profile_codex_local.config.hasApiKey,
    false
  );
  assert.equal(settings.profiles.profile_codex_local.capabilities.vision, true);
});

test('keeps Codex-backed LLM features ready while regex remains the highlight engine', () => {
  const settings = createDefaultSettings();
  settings.mode = 'regex';
  settings.consentGranted = true;
  settings.profiles = {
    profile_codex_local: normalizeProfile('profile_codex_local', {
      name: '本机 Codex',
      providerId: 'codex-local',
      config: { model: 'auto', reasoningEffort: 'auto' }
    })
  };
  settings.profileOrder = ['profile_codex_local'];
  settings.globalProfileId = 'profile_codex_local';

  assert.equal(isLlmReady(settings), true);
  assert.equal(getEffectiveMode(settings), 'regex');
});

test('upgrades a 2.4.14 text-only local Codex profile to native vision', () => {
  const profile = normalizeProfile('profile_codex_legacy_text', {
    name: '本机 Codex',
    providerId: 'codex-local',
    config: { model: 'auto', reasoningEffort: 'medium' },
    capabilities: { vision: false }
  });
  assert.equal(profile.capabilities.vision, true);
});

test('normalizes an optional advanced context-window override independently of output policy', () => {
  const profile = normalizeProfile('profile_context_override', {
    name: 'Context override',
    providerId: 'openai-compatible',
    config: { apiKey: 'key', model: 'custom-model', baseUrl: 'https://example.com/v1' },
    contextWindowTokens: 131111,
    tokenPolicy: { mode: 'manual', manualMax: 4096 }
  });
  assert.equal(profile.contextWindowTokens, 131072);
  assert.deepEqual(profile.tokenPolicy, {
    mode: 'auto', autoCap: null, manualMax: null
  });

  const invalid = normalizeProfile('profile_context_invalid', {
    name: 'Invalid context', providerId: 'deepseek',
    config: { apiKey: 'key', model: 'model' }, contextWindowTokens: 4096
  });
  assert.equal(invalid.contextWindowTokens, null);
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

test('normalizes language, analysis modes, chat prompts, and Panel preset CRUD', () => {
  const defaults = createDefaultSettings();
  assert.equal(defaults.language, 'zh-CN');
  assert.equal(defaults.analysisModes.length, 3);
  assert.ok(defaults.articleChatQuickPrompts.length >= 4);
  assert.equal(defaults.figurePanelFollowupPresets.length, 4);
  const merged = mergeSettings({
    ...defaults,
    language: 'en-US',
    readingViewId: 'my_mode',
    analysisModes: [{
      id: 'my_mode',
      name: 'My mode',
      description: 'Only selected rules',
      categoryIds: ['objective', 'objective', 'result']
    }],
    articleChatQuickPrompts: [{
      id: 'why',
      name: 'Why',
      prompt: 'Explain why.'
    }],
    figurePanelFollowupPrompts: undefined,
    figurePanelFollowupPresets: [{
      id: 'stats',
      name: 'Statistics',
      prompt: 'Explain the statistical test and its limits.'
    }]
  });
  assert.equal(merged.language, 'en');
  assert.equal(merged.readingViewId, 'my_mode');
  assert.deepEqual(merged.analysisModes[0].categoryIds, ['objective', 'result']);
  assert.equal(merged.articleChatQuickPrompts[0].prompt, 'Explain why.');
  assert.equal(merged.figurePanelFollowupPresets[0].topic, '');
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
  assert.equal(settings.taskRoutes, undefined);
  assert.deepEqual(Object.keys(settings.taskPolicies), LLM_TASK_IDS);
  assert.ok(Object.entries(settings.taskPolicies).every(([taskId, policy]) =>
    policy.mode === (['full_text_translation', 'navigation_title_translation'].includes(taskId) ? 'local' : 'global') && policy.profileId === null
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
    assert.deepEqual(settings.taskPolicies.figure_walkthrough, {
      mode: 'global', profileId: null, reasoningEnabled: false,
      reasoningEffort: 'auto', tokenRule: 'auto', allowTextFallback: false
    });
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
  assert.equal(migrated.version, 6);
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
    mode: 'auto', autoCap: null, manualMax: null
  });
  assert.equal(migrated.taskRoutes, undefined);
  assert.deepEqual(Object.keys(migrated.taskPolicies), LLM_TASK_IDS);
  assert.ok(Object.entries(migrated.taskPolicies).every(([taskId, policy]) =>
    policy.mode === (['full_text_translation', 'navigation_title_translation'].includes(taskId) ? 'local' : 'global') && policy.profileId === null
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
    mode: 'auto', autoCap: null, manualMax: null
  });
  assert.deepEqual(createTokenPolicy({ mode: 'auto', autoCap: 999999, manualMax: 8192 }), {
    mode: 'auto', autoCap: null, manualMax: null
  });
  assert.deepEqual(createTokenPolicy({ mode: 'manual', manualMax: 1, autoCap: 8192 }), {
    mode: 'auto', autoCap: null, manualMax: null
  });
  assert.deepEqual(createTokenPolicy({ mode: 'manual', manualMax: 'invalid' }), {
    mode: 'auto', autoCap: null, manualMax: null
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
    mode: 'auto', autoCap: null, manualMax: null
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
    version: 5,
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
  assert.equal(normalized.version, 6);
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
    version: 7,
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
  assert.equal(getEffectiveMode({ version: 7, mode: 'llm', consentGranted: true }), 'regex');

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
  assert.equal(merged.version, 6);
  assert.equal(merged.readingViewId, 'quick_story');
  assert.ok(!merged.viewCategoryOverrides.quick_story.add.includes('result'));
  assert.ok(!merged.viewCategoryOverrides.quick_story.remove.includes('result'));
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
