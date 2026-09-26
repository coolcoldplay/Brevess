const test = require('node:test');
const assert = require('node:assert/strict');

const {
  LLM_TASK_IDS,
  TASK_DEFINITIONS,
  getLlmTaskDefinition,
  taskPolicySignature
} = require('../core/llm-task-catalog.js');

test('defines the ordered user-visible LLM task catalog', () => {
  assert.deepEqual(LLM_TASK_IDS, [
    'document_highlight',
    'semantic_find',
    'evidence_ledger_review',
    'paragraph_summary',
    'article_outline_summary',
    'abbreviation_translation',
    'figure_walkthrough',
    'figure_panel_interpretation',
    'figure_panel_followup',
    'cross_figure_mechanism',
    'paper_research_logic',
    'paper_innovations',
    'paper_limitations',
    'literature_note_autofill',
    'article_chat',
    'selection_chat'
  ]);
  assert.equal(TASK_DEFINITIONS.length, 16);
  assert.deepEqual(getLlmTaskDefinition('semantic_find').requirements, {
    typedDecisions: true,
    decisionType: 'noul'
  });
  assert.equal(getLlmTaskDefinition('semantic_find').budgetKind, 'highlight');
  assert.equal(getLlmTaskDefinition('figure_walkthrough').requirements.vision, true);
  assert.equal(getLlmTaskDefinition('article_chat').budgetKind, 'articleChat');
});

test('rejects unknown LLM task identifiers with a stable error code', () => {
  for (const taskId of ['not_a_real_task', 'toString', 'constructor', '__proto__']) {
    assert.throws(
      () => getLlmTaskDefinition(taskId),
      error => error?.message === 'UNKNOWN_LLM_TASK' && error.code === 'UNKNOWN_LLM_TASK',
      taskId
    );
  }
});

test('only signs canonical LLM task definitions', () => {
  const canonical = getLlmTaskDefinition('article_chat');
  assert.equal(taskPolicySignature('article_chat'), taskPolicySignature(canonical));
  const throwingProxy = new Proxy({}, {
    get() { throw new Error('untrusted property access'); }
  });
  for (const forgedDefinition of [{}, { id: 'article_chat' }, throwingProxy]) {
    assert.throws(
      () => taskPolicySignature(forgedDefinition),
      error => error?.message === 'UNKNOWN_LLM_TASK' && error.code === 'UNKNOWN_LLM_TASK'
    );
  }
});
