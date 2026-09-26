(function onboardingModule(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function createOnboardingModule() {
  'use strict';

  const ONBOARDING_VERSION = 1;
  const ONBOARDING_STORAGE_KEY = 'onboardingState';
  const STEPS = Object.freeze(['storage', 'api']);
  const STEP_STATES = new Set(['pending', 'completed', 'skipped']);

  function timestamp(value) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
  }

  function sourceTab(input = {}) {
    const tabId = Number(input.tabId);
    const windowId = Number(input.windowId);
    return {
      tabId: Number.isInteger(tabId) && tabId >= 0 ? tabId : null,
      windowId: Number.isInteger(windowId) && windowId >= 0 ? windowId : null,
      url: String(input.url || '').slice(0, 4096)
    };
  }

  function stepState(value) {
    return STEP_STATES.has(value) ? value : 'pending';
  }

  function terminal(value) {
    return value === 'completed' || value === 'skipped';
  }

  function normalizeOnboardingState(input = {}, version = ONBOARDING_VERSION) {
    const currentVersion = Math.max(1, Number(version) || ONBOARDING_VERSION);
    if (!input || Number(input.onboardingVersion) !== currentVersion) {
      return {
        schemaVersion: 1,
        onboardingVersion: currentVersion,
        acknowledged: false,
        steps: { storage: 'pending', api: 'pending' },
        configured: { storage: false, api: false },
        sourceTab: sourceTab(),
        startedAt: '',
        completedAt: ''
      };
    }
    const steps = {
      storage: stepState(input.steps?.storage),
      api: stepState(input.steps?.api)
    };
    const acknowledged = STEPS.every(step => terminal(steps[step]));
    return {
      schemaVersion: 1,
      onboardingVersion: currentVersion,
      acknowledged,
      steps,
      configured: {
        storage: steps.storage === 'completed',
        api: steps.api === 'completed'
      },
      sourceTab: sourceTab(input.sourceTab),
      startedAt: timestamp(input.startedAt),
      completedAt: acknowledged ? timestamp(input.completedAt) : ''
    };
  }

  function shouldStartOnboarding(input, version = ONBOARDING_VERSION) {
    return !normalizeOnboardingState(input, version).acknowledged;
  }

  function startOnboarding(input, source = {}, now = new Date().toISOString()) {
    const state = normalizeOnboardingState(input);
    const supplied = sourceTab(source);
    const hasSuppliedSource = supplied.tabId !== null;
    return {
      ...state,
      sourceTab: hasSuppliedSource ? supplied : state.sourceTab,
      startedAt: state.startedAt || timestamp(now),
      completedAt: state.acknowledged ? state.completedAt : ''
    };
  }

  function setOnboardingStep(input, step, status, now = new Date().toISOString()) {
    if (!STEPS.includes(step)) throw new Error('INVALID_ONBOARDING_STEP');
    if (!STEP_STATES.has(status)) throw new Error('INVALID_ONBOARDING_STATUS');
    const state = normalizeOnboardingState(input);
    const steps = { ...state.steps, [step]: status };
    const acknowledged = STEPS.every(name => terminal(steps[name]));
    return {
      ...state,
      steps,
      configured: {
        storage: steps.storage === 'completed',
        api: steps.api === 'completed'
      },
      acknowledged,
      startedAt: state.startedAt || timestamp(now),
      completedAt: acknowledged ? timestamp(now) : ''
    };
  }

  function restartOnboarding(input, source = {}, now = new Date().toISOString()) {
    const state = normalizeOnboardingState(input);
    const supplied = sourceTab(source);
    return {
      ...state,
      acknowledged: false,
      steps: { storage: 'pending', api: 'pending' },
      configured: { storage: false, api: false },
      sourceTab: supplied.tabId !== null ? supplied : state.sourceTab,
      startedAt: timestamp(now),
      completedAt: ''
    };
  }

  function createOnboardingController({
    storageArea,
    now = () => new Date().toISOString()
  } = {}) {
    if (!storageArea?.get || !storageArea?.set) {
      throw new Error('ONBOARDING_STORAGE_REQUIRED');
    }
    let mutationTail = Promise.resolve();

    async function read() {
      const result = await storageArea.get(ONBOARDING_STORAGE_KEY);
      return normalizeOnboardingState(result?.[ONBOARDING_STORAGE_KEY]);
    }

    function mutate(operation) {
      const pending = mutationTail.then(async () => {
        const current = await read();
        const next = operation(current);
        await storageArea.set({ [ONBOARDING_STORAGE_KEY]: next });
        return next;
      });
      mutationTail = pending.catch(() => undefined);
      return pending;
    }

    return Object.freeze({
      get() {
        return mutationTail.then(read, read);
      },
      begin(source) {
        return mutate(current => startOnboarding(current, source, now()));
      },
      setStep(step, status) {
        return mutate(current => setOnboardingStep(current, step, status, now()));
      },
      restart(source) {
        return mutate(current => restartOnboarding(current, source, now()));
      }
    });
  }

  return Object.freeze({
    ONBOARDING_VERSION,
    ONBOARDING_STORAGE_KEY,
    normalizeOnboardingState,
    shouldStartOnboarding,
    startOnboarding,
    setOnboardingStep,
    restartOnboarding,
    createOnboardingController
  });
});
