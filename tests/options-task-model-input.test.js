const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'options.js'), 'utf8');
const draftCapture = source.slice(source.indexOf('function updateTaskModelDraft('), source.indexOf('function handleTaskPolicyTableChange('));

function editor(policy) {
  const context = {
    SciLLM: { LLM_TASK_IDS: ['article_chat'] },
    taskPolicyDraft: () => policy,
    effectiveTaskProfile: () => ({ profileId: 'profile_deepseek' }),
    profileForTaskPolicy: () => ({ providerId: 'deepseek', config: { presetId: 'deepseek_official' } })
  };
  vm.runInNewContext(draftCapture, context);
  return value => context.updateTaskModelDraft({ dataset: { taskPolicyModel: 'article_chat' }, value });
}

test('typing a task model captures it before blur so an asynchronous table refresh cannot restore the old value', () => {
  const policy = { model: 'old-model', webSearchEnabled: true, tokenRule: { input: { safetyRatio: 0.8 } } };
  const input = editor(policy);
  input(' deepseek-v4-pro ');
  // A table rebuild reads the same draft while the input still has focus.
  assert.equal(policy.model, 'deepseek-v4-pro');
  assert.equal(policy.modelProfileId, 'profile_deepseek');
  assert.equal(policy.modelProviderId, 'deepseek');
  assert.equal(policy.modelPresetId, 'deepseek_official');
  assert.equal(policy.webSearchEnabled, true);
  assert.equal(policy.tokenRule.input.safetyRatio, 0.8);
});

test('clearing a task model immediately restores inherited-model behavior', () => {
  const policy = { model: 'old-model', modelProfileId: 'old-profile', reasoningEnabled: true };
  editor(policy)('   ');
  assert.equal(Object.hasOwn(policy, 'model'), false);
  assert.equal(Object.hasOwn(policy, 'modelProfileId'), false);
  assert.equal(policy.reasoningEnabled, true);
});

test('unrelated form inputs do not create or mutate task drafts', () => {
  const context = { SciLLM: { LLM_TASK_IDS: ['article_chat'] }, taskPolicyDraft() { throw new Error('Unexpected draft mutation'); } };
  vm.runInNewContext(draftCapture, context);
  assert.equal(context.updateTaskModelDraft({ dataset: {}, value: 'text' }), false);
  assert.equal(context.updateTaskModelDraft({ dataset: { taskPolicyModel: 'unknown' }, value: 'text' }), false);
});

test('switching from a named vendor to Custom exposes manual endpoint fields instead of retaining the hidden preset', () => {
  const controls = {
    providerId: { value: 'openai-compatible' }, compatiblePreset: { value: 'minimax' },
    profileName: { value: 'My connection' }, model: { value: 'MiniMax-M2.7', dataset: { providerId: 'compatible:minimax' } }
  };
  let renderedPreset;
  const context = {
    document: { getElementById: id => controls[id] }, selectedProfileId: 'profile_example',
    state: { providers: { 'openai-compatible': { label: 'Custom', defaultModel: '' } } },
    profileById: () => ({ providerId: 'openai-compatible' }),
    providerSelectionDescriptor: () => ({ providerId: 'openai-compatible', presetId: controls.compatiblePreset.value, selection: 'openai-compatible' }),
    compatiblePresetFor: () => null,
    renderProvider: () => { renderedPreset = controls.compatiblePreset.value; },
    updateProfileListPreview() {}, scheduleProviderModelDiscovery() {}
  };
  const handler = source.slice(source.indexOf('function handleProviderChange('), source.indexOf('function renderProvider()'));
  vm.runInNewContext(handler + '\nhandleProviderChange();', context);
  assert.equal(renderedPreset, 'custom');
  assert.equal(controls.profileName.value, 'My connection');
});
