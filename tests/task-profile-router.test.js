const test = require('node:test');
const assert = require('node:assert/strict');

require('../core/settings-store.js');
require('../core/cache-planner.js');
require('../providers/provider-registry.js');

function profile(id, providerId, config, extra = {}) {
  return {
    id,
    name: extra.name || id,
    providerId,
    config: { ...config },
    capabilities: { ...(extra.capabilities || {}) },
    tokenPolicy: { mode: 'auto', autoCap: null }
  };
}

function policy(overrides = {}) {
  return {
    mode: 'global', profileId: null,
    reasoningEnabled: false, reasoningEffort: 'auto',
    tokenRule: 'auto', allowTextFallback: false,
    ...overrides
  };
}

function settingsFixture() {
  return {
    profiles: {
      profile_global: profile('profile_global', 'deepseek', {
        apiKey: 'global-secret', model: 'deepseek-v4-flash'
      }),
      profile_vision: profile('profile_vision', 'openai', {
        apiKey: 'vision-secret', model: 'gpt-5-mini'
      })
    },
    profileOrder: ['profile_global', 'profile_vision'],
    globalProfileId: 'profile_global',
    taskPolicies: {
      document_highlight: policy(),
      paragraph_summary: policy(),
      figure_walkthrough: policy({
        mode: 'profile', profileId: 'profile_vision',
        reasoningEnabled: true, reasoningEffort: 'high'
      })
    }
  };
}

test('per-feature model overrides change the real route and cache identity without changing the connection', () => {
  const { resolveTaskProfile } = require('../core/task-profile-router.js');
  const settings = settingsFixture();
  const previous = resolveTaskProfile(settings, 'paragraph_summary');
  settings.taskPolicies.paragraph_summary = policy({ model: 'deepseek-v4-pro', modelProfileId: 'profile_global',
    modelProviderId: 'deepseek', modelPresetId: '', reasoningEnabled: true, reasoningEffort: 'high' });
  const result = resolveTaskProfile(settings, 'paragraph_summary');
  assert.equal(result.model, 'deepseek-v4-pro');
  assert.equal(result.config.model, 'deepseek-v4-pro');
  assert.equal(result.effectiveReasoning.enabled, true);
  assert.notEqual(result.profileSignature, previous.profileSignature);
  assert.equal(settings.profiles.profile_global.config.model, 'deepseek-v4-flash');
  assert.equal(resolveTaskProfile(settings, 'document_highlight').model, 'deepseek-v4-flash');
  settings.globalProfileId = 'profile_vision';
  assert.equal(resolveTaskProfile(settings, 'paragraph_summary').model, 'gpt-5-mini');
  settings.globalProfileId = 'profile_global';
  settings.profiles.profile_global = profile('profile_global', 'openai', { model: 'gpt-5-mini', apiKey: 'synthetic' });
  assert.equal(resolveTaskProfile(settings, 'paragraph_summary').model, 'gpt-5-mini');
});

test('web search capability follows implemented task, provider, model and official endpoint boundaries', () => {
  const { supportsTaskWebSearch, taskModelForProfile } = require('../core/llm-task-catalog.js');
  assert.equal(taskModelForProfile(undefined, undefined, undefined), '');
  assert.equal(taskModelForProfile(null, null, ''), '');
  assert.equal(supportsTaskWebSearch('openai', { model: 'gpt-5-mini' }, 'article_chat'), true);
  assert.equal(supportsTaskWebSearch('openai', { baseUrl: 'https://example.com/v1/responses' }, 'article_chat'), false);
  assert.equal(supportsTaskWebSearch('openai', { baseUrl: 'https://api.openai.com/v1/responses?key=x' }, 'article_chat'), false);
  assert.equal(supportsTaskWebSearch('deepseek', { model: 'deepseek-flash' }, 'selection_chat'), true);
  assert.equal(supportsTaskWebSearch('deepseek', { model: 'deepseek-v4-flash' }, 'article_chat'), false);
  assert.equal(supportsTaskWebSearch('deepseek', { model: 'deepseek-flash' }, 'figure_walkthrough'), false);
  assert.equal(supportsTaskWebSearch('gemini', {}, 'article_chat'), false);
  const policy = { model: 'qwen-plus', modelProfileId: 'p', modelProviderId: 'openai-compatible', modelPresetId: 'qwen' };
  assert.equal(taskModelForProfile(policy, { providerId: 'openai-compatible', config: { presetId: 'kimi' } }, 'p'), '');
});

test('routes an exact Figure task policy and returns normalized effective reasoning', () => {
  const { resolveTaskProfile } = require('../core/task-profile-router.js');
  const routed = resolveTaskProfile(settingsFixture(), 'figure_walkthrough');

  assert.equal(routed.taskId, 'figure_walkthrough');
  assert.equal(routed.requestedProfileId, 'profile_vision');
  assert.equal(routed.effectiveProfileId, 'profile_vision');
  assert.equal(routed.capabilityMode, 'vision');
  assert.equal(routed.fallbackReason, null);
  assert.deepEqual(routed.effectiveReasoning, { enabled: true, effort: 'high' });
  assert.deepEqual(routed.publicProfile, {
    id: 'profile_vision', name: 'profile_vision', providerId: 'openai',
    model: 'gpt-5-mini', supportsVision: true
  });
  assert.doesNotMatch(JSON.stringify(routed.publicProfile), /vision-secret|apiKey|customHeaders/);
});

test('reads each exact task policy instead of a legacy route category', () => {
  const { resolveTaskProfile } = require('../core/task-profile-router.js');
  const settings = settingsFixture();
  settings.taskPolicies.figure_panel_interpretation = policy({
    mode: 'profile', profileId: 'profile_vision', reasoningEffort: 'low'
  });

  const walkthrough = resolveTaskProfile(settings, 'figure_walkthrough');
  const panel = resolveTaskProfile(settings, 'figure_panel_interpretation');

  assert.equal(walkthrough.effectiveProfileId, 'profile_vision');
  assert.equal(panel.effectiveProfileId, 'profile_vision');
  assert.deepEqual(walkthrough.effectiveReasoning, { enabled: true, effort: 'high' });
  assert.deepEqual(panel.effectiveReasoning, { enabled: false, effort: 'auto' });
});

test('falls back to global when a requested text profile is missing', () => {
  const { resolveTaskProfile } = require('../core/task-profile-router.js');
  const settings = settingsFixture();
  settings.taskPolicies.document_highlight = policy({
    mode: 'profile', profileId: 'profile_deleted'
  });

  const routed = resolveTaskProfile(settings, 'document_highlight');

  assert.equal(routed.requestedProfileId, 'profile_deleted');
  assert.equal(routed.effectiveProfileId, 'profile_global');
  assert.equal(routed.fallbackReason, 'PROFILE_MISSING');
  assert.equal(routed.capabilityMode, 'text');
});

test('falls back to global when a requested text profile is unavailable', () => {
  const { resolveTaskProfile } = require('../core/task-profile-router.js');
  const settings = settingsFixture();
  settings.taskPolicies.document_highlight = policy({
    mode: 'profile', profileId: 'profile_vision'
  });
  settings.profiles.profile_vision.config.apiKey = '';

  const routed = resolveTaskProfile(settings, 'document_highlight');

  assert.equal(routed.effectiveProfileId, 'profile_global');
  assert.equal(routed.fallbackReason, 'PROFILE_UNAVAILABLE');
});

test('treats a malformed but present requested profile as unavailable', () => {
  const { resolveTaskProfile } = require('../core/task-profile-router.js');
  const settings = settingsFixture();
  settings.taskPolicies.document_highlight = policy({
    mode: 'profile', profileId: 'profile_vision'
  });
  settings.profiles.profile_vision = null;

  const routed = resolveTaskProfile(settings, 'document_highlight');

  assert.equal(routed.effectiveProfileId, 'profile_global');
  assert.equal(routed.fallbackReason, 'PROFILE_UNAVAILABLE');
});

test('routes every Figure task to caption text for a text model without a fallback toggle', () => {
  const { resolveTaskProfile } = require('../core/task-profile-router.js');
  const settings = settingsFixture();
  settings.profiles.profile_global.config.model = 'deepseek-v4-pro';
  for (const taskId of ['figure_walkthrough', 'figure_panel_interpretation', 'figure_panel_followup']) {
    settings.taskPolicies[taskId] = policy({ allowTextFallback: false });
    const route = resolveTaskProfile(settings, taskId);
    assert.equal(route.capabilityMode, 'caption_text_only');
    assert.equal(route.publicProfile.supportsVision, false);
  }
});

test('routes a non-vision Figure profile through explicit caption-text fallback', () => {
  const { resolveTaskProfile } = require('../core/task-profile-router.js');
  const settings = settingsFixture();
  settings.profiles.profile_global.config.model = 'deepseek-v4-pro';
  settings.taskPolicies.figure_walkthrough = policy({ allowTextFallback: true });

  const routed = resolveTaskProfile(settings, 'figure_walkthrough');

  assert.equal(routed.providerId, 'deepseek');
  assert.equal(routed.model, 'deepseek-v4-pro');
  assert.equal(routed.publicProfile.supportsVision, false);
  assert.equal(routed.capabilityMode, 'caption_text_only');
  assert.equal(routed.fallbackReason, null);
});

test('routes DeepSeek vision and Codex Local Figure profiles through image mode', () => {
  const { resolveTaskProfile } = require('../core/task-profile-router.js');
  for (const candidate of [
    {
      profileId: 'profile_deepseek_vision', providerId: 'deepseek',
      config: { apiKey: 'vision-secret', model: 'deepseek-v4-flash-vision-exp' }
    },
    {
      profileId: 'profile_codex_local', providerId: 'codex-local',
      config: { model: 'auto', reasoningEffort: 'auto' }
    }
  ]) {
    const settings = settingsFixture();
    settings.profiles[candidate.profileId] = profile(
      candidate.profileId, candidate.providerId, candidate.config
    );
    settings.taskPolicies.figure_walkthrough = policy({
      mode: 'profile', profileId: candidate.profileId,
      allowTextFallback: true
    });

    const routed = resolveTaskProfile(settings, 'figure_walkthrough');

    assert.equal(routed.providerId, candidate.providerId);
    assert.equal(routed.model, candidate.config.model);
    assert.equal(routed.publicProfile.supportsVision, true);
    assert.equal(routed.capabilityMode, 'vision');
    assert.equal(routed.fallbackReason, null);
  }
});

test('throws NO_USABLE_PROFILE when the global fallback is unavailable', () => {
  const { resolveTaskProfile } = require('../core/task-profile-router.js');
  const settings = settingsFixture();
  settings.profiles.profile_global.config.apiKey = '';
  settings.profiles.profile_vision.config.apiKey = '';

  assert.throws(
    () => resolveTaskProfile(settings, 'document_highlight'),
    error => error.code === 'NO_USABLE_PROFILE' &&
      error.message === 'No usable API profile is configured'
  );
});

test('preserves the catalog error for unknown task IDs', () => {
  const { resolveTaskProfile } = require('../core/task-profile-router.js');
  assert.throws(
    () => resolveTaskProfile(settingsFixture(), 'unknown-task'),
    error => error.code === 'UNKNOWN_LLM_TASK' && error.message === 'UNKNOWN_LLM_TASK'
  );
});

test('normalizes endpoints without userinfo, query, fragment, or trailing slash', () => {
  const { normalizeEndpoint } = require('../core/task-profile-router.js');
  assert.equal(normalizeEndpoint(''), 'official');
  assert.equal(
    normalizeEndpoint('HTTPS://User:Pass@EXAMPLE.COM:8443/v1///?key=secret#credential'),
    'https://example.com:8443/v1'
  );
  assert.equal(normalizeEndpoint('file:///tmp/api'), 'invalid');
  assert.doesNotMatch(
    normalizeEndpoint('https://user:pass@example.com/v1?q=secret#fragment'),
    /user|pass|secret|fragment|\?|#|@/
  );
});

test('profile signatures isolate endpoint, model, and catalog capability without including keys', () => {
  const { resolveTaskProfile } = require('../core/task-profile-router.js');
  const base = settingsFixture();
  base.profiles.profile_global = profile('profile_global', 'openai-compatible', {
    apiKey: 'signature-secret', model: 'model-a', baseUrl: 'https://example.com/v1',
    supportsVision: false, customHeaders: { 'X-Secret': 'header-secret' }
  });
  const first = resolveTaskProfile(base, 'document_highlight');

  const endpointChanged = structuredClone(base);
  endpointChanged.profiles.profile_global.config.baseUrl = 'https://example.com/v2';
  const second = resolveTaskProfile(endpointChanged, 'document_highlight');

  const modelChanged = structuredClone(base);
  modelChanged.profiles.profile_global.config.model = 'model-b';
  const third = resolveTaskProfile(modelChanged, 'document_highlight');

  const capabilityChanged = structuredClone(base);
  capabilityChanged.profiles.profile_global.config.supportsVision = true;
  capabilityChanged.taskPolicies.figure_walkthrough = policy();
  const fourth = resolveTaskProfile(capabilityChanged, 'figure_walkthrough');

  assert.equal(new Set([
    first.profileSignature, second.profileSignature,
    third.profileSignature, fourth.profileSignature
  ]).size, 4);
  assert.doesNotMatch(JSON.stringify([
    first.profileSignature, second.profileSignature,
    third.profileSignature, fourth.profileSignature
  ]), /signature-secret|header-secret/);
});

test('profile signatures isolate safe request-affecting provider flags', () => {
  const { resolveTaskProfile } = require('../core/task-profile-router.js');
  const compatible = settingsFixture();
  compatible.profiles.profile_global = profile('profile_global', 'openai-compatible', {
    apiKey: 'compatible-secret', model: 'same-model', baseUrl: 'https://example.com/v1',
    jsonMode: true
  });
  const jsonDisabled = structuredClone(compatible);
  jsonDisabled.profiles.profile_global.config.jsonMode = false;

  assert.notEqual(
    resolveTaskProfile(compatible, 'document_highlight').profileSignature,
    resolveTaskProfile(jsonDisabled, 'document_highlight').profileSignature
  );
  assert.doesNotMatch(JSON.stringify([
    resolveTaskProfile(compatible, 'document_highlight').profileSignature
  ]), /compatible-secret/);
});

test('profile signatures isolate the requested output language', () => {
  const { resolveTaskProfile } = require('../core/task-profile-router.js');
  const chinese = settingsFixture();
  chinese.language = 'zh-CN';
  const english = structuredClone(chinese);
  english.language = 'en';
  assert.notEqual(
    resolveTaskProfile(chinese, 'paragraph_summary').profileSignature,
    resolveTaskProfile(english, 'paragraph_summary').profileSignature
  );
});

test('profile signatures isolate effective per-task reasoning', () => {
  const settings = settingsFixture();
  const changed = structuredClone(settings);
  changed.taskPolicies.document_highlight.reasoningEnabled = true;
  changed.taskPolicies.document_highlight.reasoningEffort = 'medium';

  assert.notEqual(resolveSignature(settings), resolveSignature(changed));
  assert.deepEqual(
    require('../core/task-profile-router.js')
      .resolveTaskProfile(changed, 'document_highlight').effectiveReasoning,
    { enabled: true, effort: 'high' }
  );
});

test('profile signatures isolate normalized effective token policy and cap', () => {
  const { resolveTaskProfile } = require('../core/task-profile-router.js');
  const variants = [
    { mode: 'manual', manualMax: 4096, autoCap: null },
    { mode: 'manual', manualMax: 8192, autoCap: null },
    { mode: 'auto', autoCap: 4096, manualMax: null },
    { mode: 'auto', autoCap: 8192, manualMax: null }
  ].map(tokenPolicy => {
    const settings = settingsFixture();
    settings.profiles.profile_global.tokenPolicy = tokenPolicy;
    return resolveTaskProfile(settings, 'document_highlight');
  });

  assert.equal(new Set(variants.map(route => route.profileSignature)).size, 4);
  assert.deepEqual(variants.map(route => route.effectiveTokenPolicyCap), [
    4096, 8192, 4096, 8192
  ]);
  assert.doesNotMatch(JSON.stringify(variants.map(route => route.profileSignature)),
    /global-secret|apiKey|manualMax|autoCap/);
});

test('unsupported reasoning settings do not fragment request behavior signatures', () => {
  const settings = settingsFixture();
  settings.profiles.profile_global = profile('profile_global', 'openai', {
    apiKey: 'secret', model: 'gpt-4.1'
  });
  settings.taskPolicies.document_highlight = policy({
    reasoningEnabled: true, reasoningEffort: 'low'
  });
  const changed = structuredClone(settings);
  changed.taskPolicies.document_highlight.reasoningEffort = 'high';
  assert.equal(resolveSignature(settings), resolveSignature(changed));
});

function resolveSignature(settings) {
  const { resolveTaskProfile } = require('../core/task-profile-router.js');
  return resolveTaskProfile(settings, 'document_highlight').profileSignature;
}

test('routing returns isolated JSON-like copies and never mutates settings', () => {
  const { resolveTaskProfile } = require('../core/task-profile-router.js');
  const settings = settingsFixture();
  settings.profiles.profile_global.config.customHeaders = {
    'X-Route-Secret': 'nested-secret'
  };
  settings.profiles.profile_global.tokenPolicy.future = {
    nested: { enabled: true }
  };
  const snapshot = structuredClone(settings);
  const routed = resolveTaskProfile(settings, 'document_highlight');

  routed.config.customHeaders['X-Route-Secret'] = 'mutated';
  routed.tokenPolicy.future.nested.enabled = false;

  assert.deepEqual(settings, snapshot);
  assert.notEqual(routed.config, settings.profiles.profile_global.config);
  assert.notEqual(routed.tokenPolicy, settings.profiles.profile_global.tokenPolicy);
  assert.notEqual(
    routed.config.customHeaders,
    settings.profiles.profile_global.config.customHeaders
  );
  assert.notEqual(
    routed.tokenPolicy.future,
    settings.profiles.profile_global.tokenPolicy.future
  );
  assert.doesNotMatch(JSON.stringify(routed.publicProfile), /nested-secret|customHeaders|apiKey/);
});
