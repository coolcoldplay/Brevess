const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ONBOARDING_VERSION,
  ONBOARDING_STORAGE_KEY,
  normalizeOnboardingState,
  shouldStartOnboarding,
  startOnboarding,
  setOnboardingStep,
  restartOnboarding,
  createOnboardingController
} = require('../core/onboarding.js');

function memoryStorage(initial = {}) {
  const values = structuredClone(initial);
  return {
    values,
    async get(key) { return { [key]: structuredClone(values[key]) }; },
    async set(patch) { Object.assign(values, structuredClone(patch)); }
  };
}

test('first use starts once and browser or extension restarts do not acknowledge it', () => {
  const fresh = normalizeOnboardingState();
  assert.equal(fresh.onboardingVersion, ONBOARDING_VERSION);
  assert.equal(fresh.acknowledged, false);
  assert.deepEqual(fresh.steps, { storage: 'pending', api: 'pending' });
  assert.equal(shouldStartOnboarding(fresh), true);

  const started = startOnboarding(fresh, {
    tabId: 42, windowId: 7, url: 'https://example.org/paper'
  }, '2026-07-20T00:00:00.000Z');
  assert.equal(started.sourceTab.tabId, 42);
  assert.equal(started.acknowledged, false);
  assert.equal(shouldStartOnboarding(started), true);
});

test('storage and API complete or skip independently and acknowledge only at both terminals', () => {
  let state = startOnboarding(null, { tabId: 2, windowId: 1 });
  state = setOnboardingStep(state, 'storage', 'skipped', '2026-07-20T00:01:00.000Z');
  assert.deepEqual(state.steps, { storage: 'skipped', api: 'pending' });
  assert.equal(state.acknowledged, false);
  assert.equal(state.configured.storage, false, 'skipped storage is not configured');

  state = setOnboardingStep(state, 'api', 'completed', '2026-07-20T00:02:00.000Z');
  assert.equal(state.acknowledged, true);
  assert.equal(state.configured.storage, false);
  assert.equal(state.configured.api, true);
  assert.equal(shouldStartOnboarding(state), false);
});

test('reopening onboarding keeps the source identity but resets only guide progress', () => {
  let state = startOnboarding(null, { tabId: 9, windowId: 3, url: 'https://paper.test' });
  state = setOnboardingStep(state, 'storage', 'completed');
  state = setOnboardingStep(state, 'api', 'skipped');
  const restarted = restartOnboarding(state, {}, '2026-07-20T00:03:00.000Z');
  assert.equal(restarted.acknowledged, false);
  assert.deepEqual(restarted.steps, { storage: 'pending', api: 'pending' });
  assert.deepEqual(restarted.sourceTab, state.sourceTab);
});

test('controller serializes concurrent step completion without losing either step', async () => {
  const storage = memoryStorage();
  const controller = createOnboardingController({
    storageArea: storage,
    now: () => '2026-07-20T00:04:00.000Z'
  });
  await controller.begin({ tabId: 5, windowId: 1 });
  const storageStep = controller.setStep('storage', 'completed');
  const apiStep = controller.setStep('api', 'skipped');
  const readQueuedBehindMutations = controller.get();
  await Promise.all([storageStep, apiStep]);
  const saved = await readQueuedBehindMutations;
  assert.deepEqual(saved.steps, { storage: 'completed', api: 'skipped' });
  assert.equal(saved.acknowledged, true);
  assert.deepEqual(storage.values[ONBOARDING_STORAGE_KEY], saved);
});
