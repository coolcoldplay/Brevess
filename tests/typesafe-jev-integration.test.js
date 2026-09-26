const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const registry = require('../providers/provider-registry.js');
const settingsStore = require('../core/settings-store.js');
require('../core/cache-planner.js');
const { JEV_HIGHLIGHT_ALGORITHM_VERSION } = require('../core/jev-highlight.js');
const { SEMANTIC_FIND_VERSION } = require('../core/semantic-find.js');
const router = require('../core/task-profile-router.js');
const discovery = require('../core/provider-model-discovery.js');

function typesafeProfile(id = 'profile_typesafe') {
  return {
    id,
    name: 'Jev 高亮',
    providerId: 'typesafe',
    config: { apiKey: 'ts-secret-9876', model: 'jev-custom-2026' },
    capabilities: { vision: false },
    tokenPolicy: { mode: 'auto', autoCap: null }
  };
}

function policy(profileId = null) {
  return {
    mode: profileId ? 'profile' : 'global',
    profileId,
    reasoningEnabled: false,
    reasoningEffort: 'auto',
    tokenRule: 'auto',
    allowTextFallback: false
  };
}

function routingSettings(taskId) {
  const openai = {
    id: 'profile_openai', name: 'OpenAI', providerId: 'openai',
    config: { apiKey: 'openai-secret', model: 'gpt-5-mini' },
    capabilities: { vision: true }, tokenPolicy: { mode: 'auto' }
  };
  const jev = typesafeProfile();
  return {
    language: 'zh-CN',
    profiles: { profile_openai: openai, profile_typesafe: jev },
    globalProfileId: 'profile_openai',
    taskPolicies: Object.fromEntries(settingsStore.createDefaultSettings().taskPolicies &&
      Object.keys(settingsStore.createDefaultSettings().taskPolicies)
        .map(id => [id, policy(id === taskId ? 'profile_typesafe' : null)]))
  };
}

test('registers TypeSafe Jev for typed highlighting and semantic-find decisions', () => {
  const definition = registry.getProviderDefinitions().typesafe;
  assert.equal(definition.label, 'TypeSafe Jev（文本判定）');
  assert.equal(definition.defaultModel, 'jev-latest');
  assert.deepEqual(definition.models, ['jev-latest', 'jev-1.13.0', 'jev-preview']);
  assert.equal(definition.textGeneration, false);
  assert.equal(definition.contextWindowTokens, 64000);
  assert.equal(definition.maxStateQuestionTokens, 32000);
  assert.equal(
    definition.taskAlgorithmVersions.document_highlight,
    JEV_HIGHLIGHT_ALGORITHM_VERSION
  );
  assert.equal(definition.taskAlgorithmVersions.semantic_find, SEMANTIC_FIND_VERSION);
  assert.deepEqual(definition.supportedTaskIds, ['document_highlight', 'semantic_find']);
  assert.deepEqual(definition.decisionTypes, ['noul', 'choice']);
  assert.equal(registry.providerSupportsTask('typesafe', 'document_highlight'), true);
  assert.equal(registry.providerSupportsTask('typesafe', 'semantic_find'), true);
  assert.equal(registry.providerSupportsTask('typesafe', 'article_chat'), false);
  assert.equal(registry.providerSupportsTask('openai', 'article_chat'), true);
  const capabilities = registry.getProviderCapabilities('typesafe');
  assert.equal(capabilities.textGeneration, false);
  assert.equal(capabilities.typedDecisions, true);
  assert.deepEqual(capabilities.supportedTaskIds, ['document_highlight', 'semantic_find']);
  assert.deepEqual(capabilities.decisionTypes, ['noul', 'choice']);
  assert.deepEqual(
    router.requestBehaviorSignature('typesafe', { model: 'jev-latest' }),
    {
      typedDecisions: true,
      highlightAlgorithmVersion: JEV_HIGHLIGHT_ALGORITHM_VERSION
    }
  );
  assert.deepEqual(
    router.requestBehaviorSignature(
      'typesafe', { model: 'jev-latest' }, null, 'semantic_find'
    ),
    {
      typedDecisions: true,
      semanticFindAlgorithmVersion: SEMANTIC_FIND_VERSION
    }
  );
});

test('keeps a custom Jev model and secret across settings save/load while public state stays masked', async () => {
  const initial = settingsStore.createDefaultSettings();
  initial.profiles.profile_typesafe = typesafeProfile();
  initial.profileOrder.push('profile_typesafe');
  const stored = {};
  const storage = {
    async get(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.filter(key => key in stored).map(key => [key, stored[key]]));
    },
    async set(payload) { Object.assign(stored, structuredClone(payload)); }
  };

  await settingsStore.saveSettings(storage, initial);
  const loaded = await settingsStore.loadSettings(storage);
  assert.equal(loaded.profiles.profile_typesafe.config.model, 'jev-custom-2026');
  assert.equal(loaded.profiles.profile_typesafe.config.apiKey, 'ts-secret-9876');

  const publicSettings = settingsStore.toPublicSettings(loaded);
  assert.equal(publicSettings.profiles.profile_typesafe.config.hasApiKey, true);
  assert.equal(publicSettings.profiles.profile_typesafe.config.apiKeyMask, '••••9876');
  assert.equal('apiKey' in publicSettings.profiles.profile_typesafe.config, false);
});

test('discovers Jev models from the official TypeSafe models contract', async () => {
  const request = discovery.modelListRequest('typesafe', { apiKey: 'typesafe-secret' });
  assert.equal(request.url, 'https://api.typesafe.ai/v1/models');
  assert.equal(request.headers.Authorization, 'Bearer typesafe-secret');
  const models = discovery.parseModelList('typesafe', {
    models: [
      { name: 'jev-1.13.0', description: 'stable', release_date: '2026-08-01' },
      { name: 'jev-preview', description: 'preview', release_date: '2026-09-01' }
    ]
  });
  assert.deepEqual(models.map(model => model.id), ['jev-1.13.0', 'jev-preview']);
  assert.equal(models[0].description, 'stable');
  assert.equal(models[0].releaseDate, '2026-08-01');
});

test('routes TypeSafe for highlighting and semantic find and rejects generative tasks', () => {
  const highlight = router.resolveTaskProfile(
    routingSettings('document_highlight'), 'document_highlight'
  );
  assert.equal(highlight.providerId, 'typesafe');
  assert.equal(highlight.capabilityMode, 'text_classification');
  const semanticFind = router.resolveTaskProfile(
    routingSettings('semantic_find'), 'semantic_find'
  );
  assert.equal(semanticFind.providerId, 'typesafe');
  assert.equal(semanticFind.capabilityMode, 'text_classification');

  for (const taskId of ['article_chat', 'literature_note_autofill', 'figure_walkthrough']) {
    assert.throws(
      () => router.resolveTaskProfile(routingSettings(taskId), taskId),
      error => error.code === 'CAPABILITY_MISMATCH'
    );
  }
});

test('settings UI explains Jev scope and excludes it from global/chat model choices', () => {
  const options = fs.readFileSync(path.join(__dirname, '../options.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '../options.html'), 'utf8');
  const popup = fs.readFileSync(path.join(__dirname, '../popup.js'), 'utf8');
  assert.match(html, /用于文本概率判定，不支持生成问答、笔记或解图/);
  assert.match(html, /href="#taskRoutingSettings"/);
  assert.match(html, /按功能指定模型 → 语义查找/);
  assert.match(html, /解图支持已配置的生成模型：多模态模型读取原图，纯文本模型使用正文与图注/);
  assert.doesNotMatch(html, /仅为“全文高亮”指定此 Profile/);
  assert.doesNotMatch(html, /解图支持所有已配置模型/);
  assert.match(options, /providerSupportsTask/);
  assert.match(options, /仅支持文献高亮与语义查找/);
  assert.match(options, /function revealTypesafeTaskRouting/);
  assert.match(options, /data-task-policy-id=\"semantic_find\"/);
  assert.match(options,
    /const effectiveProfile = profileForTaskPolicy\(profileId\) \|\| profile;/);
  assert.match(options,
    /providerSupportsTask\(effectiveProfile\?\.providerId, ['"]article_chat['"]\)/);
  assert.match(popup, /profile\.providerId !== ['"]typesafe['"]/);
  assert.match(popup, /providerSupportsTask\(profile\.providerId, ['"]article_chat['"]\)/);
  const readinessStart = popup.indexOf('function hasUsableLlm(');
  const readinessEnd = popup.indexOf('\n}', readinessStart) + 2;
  const readiness = popup.slice(readinessStart, readinessEnd);
  assert.doesNotMatch(readiness, /llmReady\s*===\s*true/);
  assert.match(readiness, /getArticleChatProfiles\(\)\.length/);
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../manifest.json'), 'utf8'));
  assert.ok(manifest.host_permissions.includes('https://api.typesafe.ai/*'));
});
