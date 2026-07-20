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

function settingsFixture() {
  return {
    profiles: {
      profile_global: profile('profile_global', 'deepseek', {
        apiKey: 'global-secret', model: 'deepseek-chat'
      }),
      profile_vision: profile('profile_vision', 'openai', {
        apiKey: 'vision-secret', model: 'gpt-5-mini'
      })
    },
    profileOrder: ['profile_global', 'profile_vision'],
    globalProfileId: 'profile_global',
    taskRoutes: {
      highlight: { mode: 'global', profileId: null },
      summary: { mode: 'global', profileId: null },
      figure: { mode: 'profile', profileId: 'profile_vision' },
      crossFigure: { mode: 'global', profileId: null }
    }
  };
}

test('routes a figure task to its requested vision profile without exposing secrets', () => {
  const { resolveTaskProfile } = require('../core/task-profile-router.js');
  const routed = resolveTaskProfile(settingsFixture(), 'figure', { vision: true });

  assert.equal(routed.requestedProfileId, 'profile_vision');
  assert.equal(routed.effectiveProfileId, 'profile_vision');
  assert.equal(routed.capabilityMode, 'vision');
  assert.equal(routed.fallbackReason, null);
  assert.deepEqual(routed.publicProfile, {
    id: 'profile_vision', name: 'profile_vision', providerId: 'openai',
    model: 'gpt-5-mini', supportsVision: true
  });
  assert.doesNotMatch(JSON.stringify(routed.publicProfile), /vision-secret|apiKey|customHeaders/);
});

test('falls back to global when a requested profile is missing', () => {
  const { resolveTaskProfile } = require('../core/task-profile-router.js');
  const settings = settingsFixture();
  settings.taskRoutes.figure.profileId = 'profile_deleted';

  const routed = resolveTaskProfile(settings, 'figure', { vision: true });

  assert.equal(routed.requestedProfileId, 'profile_deleted');
  assert.equal(routed.effectiveProfileId, 'profile_global');
  assert.equal(routed.fallbackReason, 'PROFILE_MISSING');
  assert.equal(routed.capabilityMode, 'caption_text_only');
});

test('falls back to global when a requested profile is unavailable', () => {
  const { resolveTaskProfile } = require('../core/task-profile-router.js');
  const settings = settingsFixture();
  settings.profiles.profile_vision.config.apiKey = '';

  const routed = resolveTaskProfile(settings, 'figure', { vision: true });

  assert.equal(routed.effectiveProfileId, 'profile_global');
  assert.equal(routed.fallbackReason, 'PROFILE_UNAVAILABLE');
});

test('treats a malformed but present requested profile as unavailable', () => {
  const { resolveTaskProfile } = require('../core/task-profile-router.js');
  const settings = settingsFixture();
  settings.profiles.profile_vision = null;

  const routed = resolveTaskProfile(settings, 'figure', { vision: true });

  assert.equal(routed.effectiveProfileId, 'profile_global');
  assert.equal(routed.fallbackReason, 'PROFILE_UNAVAILABLE');
});

test('throws NO_USABLE_PROFILE when the global fallback is unavailable', () => {
  const { resolveTaskProfile } = require('../core/task-profile-router.js');
  const settings = settingsFixture();
  settings.profiles.profile_global.config.apiKey = '';
  settings.profiles.profile_vision.config.apiKey = '';

  assert.throws(
    () => resolveTaskProfile(settings, 'figure', { vision: true }),
    error => error.code === 'NO_USABLE_PROFILE' &&
      error.message === 'No usable API profile is configured'
  );
});

test('rejects unknown task types with a structured route error', () => {
  const { resolveTaskProfile } = require('../core/task-profile-router.js');
  assert.throws(
    () => resolveTaskProfile(settingsFixture(), 'unknown-task'),
    error => error.code === 'INVALID_SETTINGS' &&
      error.message === 'Task profile route is invalid' &&
      assert.deepEqual(error.fields, ['taskType']) === undefined
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

test('profile signatures isolate endpoint, model, and capability without including keys', () => {
  const { resolveTaskProfile } = require('../core/task-profile-router.js');
  const base = settingsFixture();
  base.profiles.profile_global = profile('profile_global', 'openai-compatible', {
    apiKey: 'signature-secret', model: 'model-a', baseUrl: 'https://example.com/v1',
    supportsVision: false, customHeaders: { 'X-Secret': 'header-secret' }
  });
  base.taskRoutes.figure = { mode: 'global', profileId: null };
  const first = resolveTaskProfile(base, 'figure', { vision: true });

  const endpointChanged = structuredClone(base);
  endpointChanged.profiles.profile_global.config.baseUrl = 'https://example.com/v2';
  const second = resolveTaskProfile(endpointChanged, 'figure', { vision: true });

  const modelChanged = structuredClone(base);
  modelChanged.profiles.profile_global.config.model = 'model-b';
  const third = resolveTaskProfile(modelChanged, 'figure', { vision: true });

  const capabilityChanged = structuredClone(base);
  capabilityChanged.profiles.profile_global.config.supportsVision = true;
  const fourth = resolveTaskProfile(capabilityChanged, 'figure', { vision: true });

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
  const deepseek = settingsFixture();
  deepseek.profiles.profile_global = profile('profile_global', 'deepseek', {
    apiKey: 'deepseek-secret', model: 'deepseek-chat', thinking: false
  });
  const thinkingEnabled = structuredClone(deepseek);
  thinkingEnabled.profiles.profile_global.config.thinking = true;

  const compatible = settingsFixture();
  compatible.profiles.profile_global = profile('profile_global', 'openai-compatible', {
    apiKey: 'compatible-secret', model: 'same-model', baseUrl: 'https://example.com/v1',
    jsonMode: true
  });
  const jsonDisabled = structuredClone(compatible);
  jsonDisabled.profiles.profile_global.config.jsonMode = false;

  assert.notEqual(
    resolveTaskProfile(deepseek, 'highlight').profileSignature,
    resolveTaskProfile(thinkingEnabled, 'highlight').profileSignature
  );
  assert.notEqual(
    resolveTaskProfile(compatible, 'highlight').profileSignature,
    resolveTaskProfile(jsonDisabled, 'highlight').profileSignature
  );
  assert.doesNotMatch(JSON.stringify([
    resolveTaskProfile(deepseek, 'highlight').profileSignature,
    resolveTaskProfile(compatible, 'highlight').profileSignature
  ]), /deepseek-secret|compatible-secret/);
});

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
  const routed = resolveTaskProfile(settings, 'highlight');

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
