const test = require('node:test');
const assert = require('node:assert/strict');

require('../core/category-store.js');
const { createUnifiedCategoryCatalog } = require('../core/adaptive-catalog.js');
require('../providers/provider-utils.js');
const { compileAnalysisPrompt } = require('../core/prompt-compiler.js');
const { validateChunkResult } = require('../core/result-validator.js');
const {
  JEV_HIGHLIGHT_ALGORITHM_VERSION,
  analyzeJevHighlights
} = require('../core/jev-highlight.js');

function category(id, overrides = {}) {
  return {
    categoryId: id,
    name: id,
    definition: `Configured meaning for ${id}`,
    decisionQuestion: `Does the exact source satisfy ${id}?`,
    includeAll: ['The configured meaning is directly supported by the source.'],
    excludeAny: ['Negated or unsupported assertions.'],
    requiredSlots: [],
    allowedQuoteRoles: ['statement'],
    positiveExamples: ['Treatment increased survival.'],
    hardNegativeExamples: ['Treatment did not increase survival.'],
    spanPolicy: 'sentence',
    minimumConfidence: 0.8,
    claimMode: 'explicit',
    relationRequired: false,
    enabledEngines: ['llm'],
    color: '#336699',
    version: 1,
    persistence: 'saved',
    builtIn: false,
    ...overrides
  };
}

function request(categories, paragraphs, chunkId = 'jev-chunk', signal) {
  return {
    ...compileAnalysisPrompt({ categories, paragraphs, chunkId }),
    paragraphs,
    signal
  };
}

function choiceAnswer(question, selected, selectedProbability = 0.94) {
  const keys = Object.keys(question.criteria);
  const rest = keys.length > 1 ? (1 - selectedProbability) / (keys.length - 1) : 0;
  return {
    type: 'choice',
    choice: selected,
    probabilities: Object.fromEntries(keys.map(key => [key, key === selected ? selectedProbability : rest])),
    confidence: 0.51
  };
}

function questionPath(instructions, kind) {
  const match = instructions.match(new RegExp(`${kind} \\"([^\\"]+)\\"`));
  return match?.[1] || '';
}

function scriptedEvaluate({ score, slotValues = {}, supportSentence = () => null,
  onCall = () => {}, missingSlot = '', slotValidationScore = 0.93,
  choiceProbability = () => 0.94, roleScore = () => 0.94 } = {}) {
  return async ({ state, questions }) => {
    onCall({ state, questions });
    const answers = {};
    for (const [id, question] of Object.entries(questions)) {
      if (question.type === 'noul') {
        if (state.phase === 'slot_validation') {
          answers[id] = { type: 'noul', noul: slotValidationScore };
          continue;
        }
        if (state.phase === 'candidate_role') {
          const candidateKey = questionPath(question.instructions, 'candidate');
          const roleKey = questionPath(question.instructions, 'role');
          answers[id] = { type: 'noul',
            noul: roleScore(state.candidates[candidateKey], state.roles[roleKey]) };
          continue;
        }
        if (state.phase === 'support_role') {
          const sentenceKey = questionPath(question.instructions, 'sentence');
          const roleKey = questionPath(question.instructions, 'role');
          const role = state.roles[roleKey];
          const wanted = supportSentence(role.id, state);
          answers[id] = { type: 'noul',
            noul: state.context[sentenceKey]?.text === wanted ? 0.94 : 0.1 };
          continue;
        }
        const sentenceKey = questionPath(question.instructions, 'sentence');
        const categoryKey = questionPath(question.instructions, 'category');
        answers[id] = {
          type: 'noul',
          noul: Number(score?.(state.sentences[sentenceKey], state.categories[categoryKey])) || 0
        };
        continue;
      }
      const keys = Object.keys(question.criteria);
      let selected = keys.find(key => key !== 'none');
      if (question.instructions.startsWith('SUPPORT_ROLE')) {
        const role = questionPath(question.instructions, 'role');
        const wanted = supportSentence(role, state);
        selected = keys.find(key => state.context[key]?.text === wanted) || 'none';
      } else if (question.instructions.startsWith('SLOT_')) {
        const slot = questionPath(question.instructions, 'slot');
        if (slot === missingSlot) {
          selected = 'none';
        } else {
          const target = slotValues[slot];
          const option = Object.entries(state.token_options || {}).find(([, value]) => {
            if (!target || !value) return false;
            const quote = state.quotes[value.sentence]?.text || '';
            const start = quote.indexOf(target);
            if (start < 0) return false;
            const end = start + target.length;
            return question.instructions.startsWith('SLOT_START')
              ? value.start === start
              : value.end === end;
          });
          selected = option?.[0] || 'none';
        }
      }
      answers[id] = choiceAnswer(question, selected,
        choiceProbability({ state, question, selected }));
    }
    return { answers, model: 'jev-test', usage: {} };
  };
}

test('exports a versioned algorithm and supports independent multi-label custom categories', async () => {
  assert.match(JEV_HIGHLIGHT_ALGORITHM_VERSION, /^jev-highlight-v\d+$/);
  const categories = [category('custom_result'), category('custom_priority')];
  const paragraphs = [{ paragraphId: 'p1', text: 'Treatment increased survival in mice.' }];
  const phases = [];
  const result = await analyzeJevHighlights(request(categories, paragraphs), scriptedEvaluate({
    score: () => 0.91,
    onCall: ({ state }) => phases.push(state.phase)
  }));

  assert.equal(result.annotations.length, 2);
  assert.deepEqual(new Set(result.annotations.map(item => item.category_id)),
    new Set(['custom_result', 'custom_priority']));
  assert.ok(result.annotations.every(item => item.highlight_quotes[0].quote === paragraphs[0].text));
  const checked = validateChunkResult({
    paragraphs, requestedCategories: categories, response: result, expectedChunkId: 'jev-chunk'
  });
  assert.equal(checked.rejected.length, 0);
  assert.equal(checked.annotations.length, 2);
  assert.deepEqual(phases, ['candidate_screen', 'candidate_role']);
});

test('abstains from a negated hard negative instead of forcing a label', async () => {
  const categories = [category('custom_result')];
  const paragraphs = [{ paragraphId: 'p1', text: 'Treatment did not increase survival.' }];
  const result = await analyzeJevHighlights(request(categories, paragraphs), scriptedEvaluate({
    score: () => 0.12
  }));
  assert.deepEqual(result.annotations, []);
  assert.deepEqual(result.paragraphs_reviewed, ['p1']);
});

test('does not globally reject negation when the configured category accepts null results', async () => {
  const resultCategory = createUnifiedCategoryCatalog().result;
  const paragraphs = [{ paragraphId: 'p1',
    text: 'Treatment did not increase total sleep duration compared with vehicle.' }];
  let screenInstructions = '';
  const result = await analyzeJevHighlights(request([resultCategory], paragraphs), scriptedEvaluate({
    score: () => 0.91,
    onCall({ state, questions }) {
      if (state.phase === 'candidate_screen') {
        screenInstructions = Object.values(questions)[0].instructions;
      }
    }
  }));
  assert.doesNotMatch(screenInstructions, /negation.+favor false/i);
  assert.equal(result.annotations.length, 1);
  assert.equal(result.annotations[0].category_id, 'result');
});

test('keeps UTF-16 source text and the exact occurrence for repeated sentences', async () => {
  const categories = [category('custom_result')];
  const text = 'LRRC7⁺ cells were ≤ 5% 😊. LRRC7⁺ cells were ≤ 5% 😊.';
  const paragraphs = [{ paragraphId: 'p1', text }];
  const result = await analyzeJevHighlights(request(categories, paragraphs), scriptedEvaluate({
    score: sentence => sentence.occurrence === 1 ? 0.93 : 0.1
  }));

  assert.equal(result.annotations.length, 1);
  const quote = result.annotations[0].highlight_quotes[0];
  assert.equal(quote.quote, 'LRRC7⁺ cells were ≤ 5% 😊.');
  assert.equal(quote.occurrence, 1);
  const checked = validateChunkResult({ paragraphs, requestedCategories: categories, response: result });
  assert.equal(checked.annotations[0].start, text.lastIndexOf(quote.quote));
  assert.equal(text.slice(checked.annotations[0].start, checked.annotations[0].end), quote.quote);
});

test('keeps a PDF soft-wrapped scientific question and its exact slot as one sentence', async () => {
  const scientificQuestion = createUnifiedCategoryCatalog().scientific_question;
  const text = 'Here, \nwe investigated the effect of neuronal activity on microglial motility and the implications for the \nformation and survival of dendritic spines on hippocampal CA1 neurons in vivo.';
  const researchQuestion = 'effect of neuronal activity on microglial motility and the implications for the \nformation and survival of dendritic spines on hippocampal CA1 neurons in vivo';
  const paragraphs = [{ paragraphId: 'pdf-p1', text }];
  let screenedSentences = [];
  const result = await analyzeJevHighlights(request([scientificQuestion], paragraphs), scriptedEvaluate({
    score: sentence => sentence.text.includes('we investigated') ? 0.94 : 0.1,
    slotValues: { research_question: researchQuestion },
    onCall({ state }) {
      if (state.phase === 'candidate_screen') {
        screenedSentences = Object.values(state.sentences);
      }
    }
  }));

  assert.equal(screenedSentences.length, 1);
  assert.equal(screenedSentences[0].text, text);
  assert.equal(text.slice(screenedSentences[0].start, screenedSentences[0].end), text);
  assert.equal(result.annotations.length, 1);
  assert.equal(result.annotations[0].highlight_quotes[0].quote, text);
  assert.deepEqual(result.annotations[0].slots,
    [{ name: 'research_question', value: researchQuestion }]);
});

test('splits punctuation, blank blocks, and list items while preserving symbols and offsets', async () => {
  const measured = category('measured_text');
  const text = [
    'We measured Ca²⁺ at pH 7.4',
    'and found 3.2±0.4 μm². Next, CD4⁺ cells increased by 10% (P < 0.01)!',
    '',
    '- First control was unchanged',
    '- Second control was stable'
  ].join('\n');
  let screenedSentences = [];
  await analyzeJevHighlights(request([measured], [{ paragraphId: 'p-layout', text }]),
    scriptedEvaluate({
      score: () => 0.1,
      onCall({ state }) {
        if (state.phase === 'candidate_screen') {
          screenedSentences = Object.values(state.sentences);
        }
      }
    }));

  assert.deepEqual(screenedSentences.map(item => item.text), [
    'We measured Ca²⁺ at pH 7.4\nand found 3.2±0.4 μm².',
    'Next, CD4⁺ cells increased by 10% (P < 0.01)!',
    '- First control was unchanged',
    '- Second control was stable'
  ]);
  assert.ok(screenedSentences.every(item => text.slice(item.start, item.end) === item.text));
});

test('grounds inferred roles, relations, and short required slots in selected source sentences', async () => {
  const inferred = category('custom_warning', {
    requiredSlots: ['claim_strength', 'evidence_strength'],
    allowedQuoteRoles: ['claim', 'evidence'],
    claimMode: 'inferred',
    relationRequired: true,
    minimumConfidence: 0.85
  });
  const paragraphs = [{
    paragraphId: 'p1',
    text: 'The authors claimed that exposure proves disease causation. The cohort only showed an association.'
  }];
  const evaluate = scriptedEvaluate({
    score: sentence => sentence.text.startsWith('The authors') ? 0.92 : 0.1,
    roleScore: (_candidate, role) => role.id === 'claim' ? 0.94 : 0.1,
    supportSentence: role => role === 'evidence' ? 'The cohort only showed an association.' : null,
    slotValues: { claim_strength: 'proves disease causation', evidence_strength: 'only showed an association' }
  });
  const result = await analyzeJevHighlights(request([inferred], paragraphs), evaluate);

  assert.equal(result.annotations.length, 1);
  const annotation = result.annotations[0];
  assert.equal(annotation.claim_mode, 'inferred');
  assert.match(annotation.relation_id, /^jev-rel-/);
  assert.deepEqual(annotation.highlight_quotes.map(item => item.role), ['claim']);
  assert.deepEqual(annotation.support_quotes.map(item => item.role), ['evidence']);
  assert.deepEqual(annotation.slots, [
    { name: 'claim_strength', value: 'proves disease causation' },
    { name: 'evidence_strength', value: 'only showed an association' }
  ]);
  assert.equal(annotation.reason_zh, 'Jev类别判断，原文证据已定位');
  assert.equal(annotation.confidence, 0.92);
  const checked = validateChunkResult({ paragraphs, requestedCategories: [inferred], response: result });
  assert.equal(checked.rejected.length, 0);
  assert.equal(checked.annotations.length, 1);
});

test('abstains when a required role or slot cannot be selected', async () => {
  const inferred = category('custom_warning', {
    requiredSlots: ['claim_strength', 'evidence_strength'],
    allowedQuoteRoles: ['claim', 'evidence'],
    claimMode: 'inferred',
    relationRequired: true
  });
  const paragraphs = [{ paragraphId: 'p1',
    text: 'The paper claims causation. The cohort reports association.' }];
  const result = await analyzeJevHighlights(request([inferred], paragraphs), scriptedEvaluate({
    score: sentence => sentence.text.startsWith('The paper') ? 0.92 : 0.1,
    roleScore: (_candidate, role) => role.id === 'claim' ? 0.94 : 0.1,
    supportSentence: () => 'The cohort reports association.',
    slotValues: { claim_strength: 'claims causation', evidence_strength: 'reports association' },
    missingSlot: 'evidence_strength'
  }));
  assert.deepEqual(result.annotations, []);
});

test('preserves built-in necessity roles and relation grounding', async () => {
  const necessity = createUnifiedCategoryCatalog().necessity_evidence;
  const paragraphs = [{ paragraphId: 'p1',
    text: 'Blocking C1q abolished activity-induced loss of VGLUT2 terminals.' }];
  let roleState;
  let roleQuestions;
  let endState;
  let endQuestions;
  const result = await analyzeJevHighlights(request([necessity], paragraphs), scriptedEvaluate({
    score: () => 0.95,
    supportSentence: () => paragraphs[0].text,
    onCall({ state, questions }) {
      if (state.phase === 'candidate_role') {
        roleState = state;
        roleQuestions = questions;
      }
      if (state.phase === 'slot_end_grounding') {
        endState = state;
        endQuestions = questions;
      }
    },
    slotValues: {
      upstream_factor: 'activity-induced',
      blocked_mediator: 'C1q',
      target_outcome: 'loss of VGLUT2 terminals',
      effect_reduction: 'abolished'
    }
  }));
  assert.equal(result.annotations.length, 1);
  assert.equal(result.annotations[0].relation_id.startsWith('jev-rel-'), true);
  assert.deepEqual(new Set([
    ...result.annotations[0].highlight_quotes,
    ...result.annotations[0].support_quotes
  ].map(item => item.role)), new Set(['upstream_effect', 'reduced_outcome']));
  assert.ok(Object.values(roleQuestions).every(question => question.type === 'noul'));
  assert.ok(Object.values(roleState.roles).every(role =>
    role.meaning.length > role.id.replaceAll('_', ' ').length));
  const upstreamRole = Object.values(roleState.roles)
    .find(role => role.id === 'upstream_effect');
  assert.match(upstreamRole.meaning, /embedded|upstream-factor.+target-outcome/i);
  assert.ok(Object.values(endQuestions).every(question =>
    /selected start|closest|shortest/i.test(question.instructions)));
  for (const [index, question] of Object.values(endQuestions).entries()) {
    const start = endState.selected_starts[`slot_${index}`];
    for (const id of Object.keys(question.criteria).filter(id => id !== 'none')) {
      const token = endState.token_options[id];
      assert.equal(token.sentence, start.sentence);
      assert.ok(token.start >= start.start);
    }
  }
});

test('allows one sentence to independently satisfy all sufficiency and rescue roles', async () => {
  const catalog = createUnifiedCategoryCatalog();
  const cases = [{
    category: catalog.sufficiency_evidence,
    text: 'Activation of kinase K alone induced cell proliferation in the absence of growth factor F.',
    slots: {
      activated_mediator: 'Activation of kinase K',
      absent_upstream_stimulus: 'absence of growth factor F',
      target_outcome: 'cell proliferation'
    }
  }, {
    category: catalog.rescue_evidence,
    text: 'Deletion of gene G reduced neuronal survival, and re-expression of G in the knockout neurons restored survival to wild-type levels.',
    slots: {
      initial_perturbation: 'Deletion of gene G',
      abnormal_outcome: 'reduced neuronal survival',
      rescue_action: 're-expression of G',
      rescued_outcome: 'restored survival to wild-type levels'
    }
  }];
  const slotInstructions = [];
  for (const [index, sample] of cases.entries()) {
    const paragraphs = [{ paragraphId: `p${index}`, text: sample.text }];
    const result = await analyzeJevHighlights(request([sample.category], paragraphs,
      `causal-${index}`), scriptedEvaluate({
      score: () => 0.95,
      roleScore: () => 0.94,
      slotValues: sample.slots,
      onCall({ state, questions }) {
        if (/^slot_(?:start|end)_grounding$/u.test(state.phase)) {
          slotInstructions.push(...Object.values(questions).map(item => item.instructions));
        }
      }
    }));
    assert.equal(result.annotations.length, 1, sample.category.categoryId);
    const roles = new Set([
      ...result.annotations[0].highlight_quotes,
      ...result.annotations[0].support_quotes
    ].map(item => item.role));
    const expectedRoles = sample.category.categoryId === 'sufficiency_evidence'
      ? ['mediator_activation', 'induced_outcome']
      : ['initial_abnormality', 'rescued_outcome'];
    assert.ok(expectedRoles.every(role => roles.has(role)), sample.category.categoryId);
  }
  assert.ok(slotInstructions.every(instruction =>
    /direction|negation|qualifier/i.test(instruction)));
});

test('abstains when an independently required role is absent from candidate and context', async () => {
  const inferred = category('custom_warning', {
    allowedQuoteRoles: ['claim', 'evidence'],
    claimMode: 'inferred',
    relationRequired: true
  });
  const paragraphs = [{ paragraphId: 'p1',
    text: 'The authors asserted a causal conclusion. An unrelated sentence discusses storage.' }];
  const result = await analyzeJevHighlights(request([inferred], paragraphs), scriptedEvaluate({
    score: sentence => sentence.text.startsWith('The authors') ? 0.92 : 0.1,
    roleScore: (_candidate, role) => role.id === 'claim' ? 0.94 : 0.1,
    supportSentence: () => null
  }));
  assert.deepEqual(result.annotations, []);
});

test('splits Han characters for exact slots and validates a low-ambiguity span separately', async () => {
  const scientificQuestion = createUnifiedCategoryCatalog().scientific_question;
  const paragraphs = [{ paragraphId: 'p1',
    text: '本研究旨在检验蛋白X是否调控成年小鼠的睡眠时长。' }];
  let tokenOptions = [];
  const result = await analyzeJevHighlights(request([scientificQuestion], paragraphs), scriptedEvaluate({
    score: () => 0.92,
    slotValues: { research_question: '蛋白X是否调控成年小鼠的睡眠时长' },
    slotValidationScore: 0.9,
    choiceProbability: ({ state }) => /^slot_(?:start|end)_grounding$/u.test(state.phase)
      ? 0.27 : 0.94,
    onCall({ state }) {
      if (state.phase === 'slot_start_grounding') {
        tokenOptions = Object.values(state.token_options);
      }
    }
  }));
  assert.ok(tokenOptions.length > 10);
  assert.equal(tokenOptions.some(item => /[\u3400-\u9fff].*[\u3400-\u9fff]/u.test(item.text)), false);
  assert.equal(result.annotations.length, 1);
  assert.deepEqual(result.annotations[0].slots,
    [{ name: 'research_question', value: '蛋白X是否调控成年小鼠的睡眠时长' }]);
  assert.equal(result.annotations[0].confidence, 0.9);
});

test('accepts provider probability rounding at the documented 0.01 tolerance plus epsilon', async () => {
  const scientificQuestion = createUnifiedCategoryCatalog().scientific_question;
  const paragraphs = [{ paragraphId: 'p1',
    text: 'We investigated whether protein X regulates sleep duration.' }];
  const base = scriptedEvaluate({
    score: () => 0.94,
    slotValues: { research_question: 'whether protein X regulates sleep duration' }
  });
  const evaluate = async input => {
    const response = await base(input);
    if (/^slot_(?:start|end)_grounding$/u.test(input.state.phase)) {
      for (const answer of Object.values(response.answers)) {
        for (const key of Object.keys(answer.probabilities)) answer.probabilities[key] = 0;
        answer.probabilities[answer.choice] = 0.99;
      }
    }
    return response;
  };
  const result = await analyzeJevHighlights(request([scientificQuestion], paragraphs), evaluate);
  assert.equal(result.annotations.length, 1);
});

test('rejects a low-boundary-probability slot when its independent Noul validation fails', async () => {
  const scientificQuestion = createUnifiedCategoryCatalog().scientific_question;
  const paragraphs = [{ paragraphId: 'p1', text: 'We asked whether treatment improves sleep.' }];
  const result = await analyzeJevHighlights(request([scientificQuestion], paragraphs),
    scriptedEvaluate({
      score: () => 0.94,
      slotValues: { research_question: 'whether treatment improves sleep' },
      choiceProbability: ({ state }) => /^slot_(?:start|end)_grounding$/u.test(state.phase)
        ? 0.12 : 0.94,
      slotValidationScore: 0.79
    }));
  assert.deepEqual(result.annotations, []);
});

test('fails retryably on malformed, partial, or non-finite typed answers', async () => {
  const categories = [category('custom_a'), category('custom_b')];
  const paragraphs = [{ paragraphId: 'p1', text: 'A complete scientific result was reported.' }];
  await assert.rejects(
    analyzeJevHighlights(request(categories, paragraphs), async ({ questions }) => {
      const [id] = Object.keys(questions);
      return { answers: { [id]: { type: 'noul', noul: Number.NaN } } };
    }),
    error => error?.code === 'INVALID_RESPONSE' && error?.retryable === true
  );
});

test('checks an already-aborted signal before making any evaluator call', async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  await assert.rejects(
    analyzeJevHighlights(request(
      [category('custom_result')],
      [{ paragraphId: 'p1', text: 'Treatment increased survival.' }],
      'jev-chunk', controller.signal
    ), async () => { calls += 1; return { answers: {} }; }),
    error => error?.code === 'CANCELLED'
  );
  assert.equal(calls, 0);
});

test('batches every sentence-category decision without dropping later work', async () => {
  const categories = Array.from({ length: 5 }, (_, index) => category(`custom_${index}`));
  const paragraphs = Array.from({ length: 7 }, (_, paragraphIndex) => ({
    paragraphId: `p${paragraphIndex}`,
    text: Array.from({ length: 4 }, (_, sentenceIndex) =>
      `Paragraph ${paragraphIndex} sentence ${sentenceIndex} reports a measured value.`).join(' ')
  }));
  let calls = 0;
  let decisions = 0;
  const result = await analyzeJevHighlights(request(categories, paragraphs), scriptedEvaluate({
    score: () => 0.1,
    onCall({ state, questions }) {
      if (state.phase === 'candidate_screen') {
        calls += 1;
        decisions += Object.keys(questions).length;
      }
    }
  }));
  assert.ok(calls > 1);
  assert.equal(decisions, 7 * 4 * 5);
  assert.deepEqual(result.paragraphs_reviewed, paragraphs.map(item => item.paragraphId));
  assert.deepEqual(result.annotations, []);
});

test('counts CJK as UTF-8 bytes and reports an indivisible over-limit decision', async () => {
  const oversized = category('custom_cjk', { definition: '证'.repeat(11_000) });
  let calls = 0;
  await assert.rejects(
    analyzeJevHighlights(request([oversized], [{
      paragraphId: 'p1', text: '治疗提高了生存率。'
    }]), async () => { calls += 1; return { answers: {} }; }),
    error => error?.code === 'JEV_LIMIT_EXCEEDED'
  );
  assert.equal(calls, 0);
});
