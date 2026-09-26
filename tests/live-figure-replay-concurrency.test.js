const test = require('node:test');
const assert = require('node:assert/strict');

test('a documented workflow schematic need not invent an empirical inference', async () => {
  const { panelsAreSubstantive } = await import('../scripts/verify-live-figure-extension.mjs');
  const panel = { role: 'model_setup', methodCategory: 'schematic', purpose: '说明研究中的处理时间与实验顺序',
    design: '14月龄雄性小鼠按实验设计给予处理并在随后进行多项测试', comparison: '无',
    directObservation: '示意图显示了给药时间点和测试时间安排', localInference: '无',
    contribution: '提供实验设计的可视化说明，连接处理安排与后续评估' };
  assert.equal(panelsAreSubstantive([panel]), true);
  assert.equal(panelsAreSubstantive([{ ...panel, role: 'phenotype', methodCategory: 'wet_lab' }]), false);
  assert.equal(panelsAreSubstantive([{ ...panel, design: '', directObservation: '', contribution: '' }]), false);
});

test('concurrent Figure replay matches exact request content regardless of arrival order', async () => {
  const { takeReplayEntry } = await import('../scripts/verify-live-figure-extension.mjs');
  const make = (sequence, panel) => {
    const shape = { endpoint: '/chat/completions', model: 'deepseek-v4-flash',
      figureId: 'figure-1', pass: 'panel_extraction', expectedPanels: [panel] };
    const body = { model: shape.model, thinking: { type: 'disabled' }, max_tokens: 8000,
      response_format: { type: 'json_object' }, messages: [
        { role: 'system', content: 'retain all evidence and validate all fields' },
        { role: 'user', content: JSON.stringify({ panel, evidence: 'original public caption' }) }
      ] };
    return { sequence, endpoint: shape.endpoint, expectedShape: shape, requestBody: body };
  };
  const entries = [make(1, 'A'), make(2, 'G')];
  const used = new Set();
  assert.equal(takeReplayEntry(entries[1].requestBody, entries[1].expectedShape, entries, used, true).sequence, 2);
  assert.equal(takeReplayEntry(entries[0].requestBody, entries[0].expectedShape, entries, used, true).sequence, 1);
  assert.throws(() => takeReplayEntry(entries[0].requestBody, entries[0].expectedShape, entries, used, true),
    { code: 'LIVE_FIGURE_REPLAY_MISMATCH' });
});

test('strict Figure replay rejects evidence, prompt, model reasoning and output budget drift', async () => {
  const { takeReplayEntry } = await import('../scripts/verify-live-figure-extension.mjs');
  const shape = { endpoint: '/chat/completions', model: 'deepseek-v4-pro',
    figureId: 'figure-1', pass: 'panel_extraction', expectedPanels: ['A'] };
  const body = { model: shape.model, messages: [{ role: 'system', content: 'all fields' },
    { role: 'user', content: 'all caption and body evidence' }],
    thinking: { type: 'enabled' }, reasoning_effort: 'high', max_tokens: 16384 };
  const entry = { sequence: 1, endpoint: shape.endpoint, expectedShape: shape, requestBody: body };
  for (const mutate of [
    value => { value.messages[0].content = 'short answer'; },
    value => { value.messages[1].content = 'less evidence'; },
    value => { value.reasoning_effort = 'low'; },
    value => { value.max_tokens = 2048; }
  ]) {
    const changed = structuredClone(body);
    mutate(changed);
    assert.throws(() => takeReplayEntry(changed, shape, [entry], new Set(), true),
      { code: 'LIVE_FIGURE_REPLAY_MISMATCH' });
  }
});
