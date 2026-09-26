const test = require('node:test');
const assert = require('node:assert/strict');

const settingsStore = require('../core/settings-store.js');
require('../core/cache-planner.js');
const { SEMANTIC_FIND_VERSION } = require('../core/semantic-find.js');
const registry = require('../providers/provider-registry.js');
const router = require('../core/task-profile-router.js');

function profile(providerId, config) {
  return {
    name: providerId,
    providerId,
    config: { ...config },
    capabilities: { vision: false },
    tokenPolicy: { mode: 'auto', autoCap: null, manualMax: null }
  };
}

function semanticPolicy(overrides = {}) {
  return {
    mode: 'global',
    profileId: null,
    reasoningEnabled: false,
    reasoningEffort: 'auto',
    tokenRule: 'auto',
    allowTextFallback: false,
    ...overrides
  };
}

function savedSettings() {
  const settings = settingsStore.createDefaultSettings();
  settings.profiles = {
    profile_openai: profile('openai', {
      apiKey: 'openai-secret', model: 'gpt-5-mini'
    }),
    profile_typesafe: profile('typesafe', {
      apiKey: 'typesafe-secret', model: 'jev-latest'
    })
  };
  settings.profileOrder = ['profile_openai', 'profile_typesafe'];
  settings.globalProfileId = 'profile_openai';
  return settings;
}

test('missing semantic-find policy selects the first configured TypeSafe profile once', () => {
  const saved = savedSettings();
  delete saved.taskPolicies.semantic_find;

  const merged = settingsStore.mergeSettings(saved);
  assert.deepEqual(merged.taskPolicies.semantic_find, semanticPolicy({
    mode: 'profile', profileId: 'profile_typesafe'
  }));
  assert.deepEqual(settingsStore.mergeSettings(merged), merged);
});

test('an explicit semantic-find route is preserved instead of being remigrated', () => {
  const saved = savedSettings();
  saved.taskPolicies.semantic_find = semanticPolicy();

  const merged = settingsStore.mergeSettings(saved);
  assert.deepEqual(merged.taskPolicies.semantic_find, semanticPolicy());
});

test('semantic find routes only to a usable noul typed-decision profile', () => {
  const settings = savedSettings();
  settings.taskPolicies.semantic_find = semanticPolicy({
    mode: 'profile', profileId: 'profile_typesafe'
  });

  const resolved = router.resolveTaskProfile(settings, 'semantic_find');
  assert.equal(resolved.providerId, 'typesafe');
  assert.equal(resolved.effectiveProfileId, 'profile_typesafe');
  assert.equal(resolved.capabilityMode, 'text_classification');
  assert.deepEqual(resolved.profileSignature.length > 0, true);
  assert.deepEqual(
    router.requestBehaviorSignature(
      'typesafe', settings.profiles.profile_typesafe.config, null, 'semantic_find'
    ),
    { typedDecisions: true, semanticFindAlgorithmVersion: SEMANTIC_FIND_VERSION }
  );
  assert.deepEqual(registry.getProviderCapabilities('typesafe').decisionTypes,
    ['noul', 'choice']);
});

test('semantic find never falls back to a usable generative global profile', () => {
  for (const semantic of [
    semanticPolicy(),
    semanticPolicy({ mode: 'profile', profileId: 'profile_missing' }),
    semanticPolicy({ mode: 'profile', profileId: 'profile_typesafe' })
  ]) {
    const settings = savedSettings();
    settings.taskPolicies.semantic_find = semantic;
    if (semantic.profileId === 'profile_typesafe') {
      settings.profiles.profile_typesafe.config.apiKey = '';
    }
    assert.throws(
      () => router.resolveTaskProfile(settings, 'semantic_find'),
      error => error.code === 'NO_USABLE_PROFILE' &&
        error.message === 'No usable API profile is configured'
    );
  }
});

test('semantic-find default remains unconfigured when no usable TypeSafe profile exists', () => {
  const saved = savedSettings();
  saved.profiles.profile_typesafe.config.apiKey = '';
  delete saved.taskPolicies.semantic_find;

  const merged = settingsStore.mergeSettings(saved);
  assert.deepEqual(merged.taskPolicies.semantic_find, semanticPolicy());
  assert.throws(
    () => router.resolveTaskProfile(merged, 'semantic_find'),
    error => error.code === 'NO_USABLE_PROFILE'
  );
});

test('semantic-find migration skips an invalid TypeSafe endpoint for a later usable profile', () => {
  const saved = savedSettings();
  saved.profiles.profile_typesafe.config.baseUrl = 'https://untrusted.example/v1';
  saved.profiles.profile_typesafe_second = profile('typesafe', {
    apiKey: 'second-secret',
    model: 'jev-latest',
    baseUrl: 'https://api.typesafe.ai/v1'
  });
  saved.profileOrder.push('profile_typesafe_second');
  delete saved.taskPolicies.semantic_find;

  const merged = settingsStore.mergeSettings(saved);
  assert.equal(merged.taskPolicies.semantic_find.mode, 'profile');
  assert.equal(merged.taskPolicies.semantic_find.profileId, 'profile_typesafe_second');
  assert.deepEqual(
    registry.validateProviderConfig(
      'typesafe', saved.profiles.profile_typesafe.config
    ),
    ['baseUrl']
  );
});
