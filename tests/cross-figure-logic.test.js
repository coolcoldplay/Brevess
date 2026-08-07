const test = require('node:test');
const assert = require('node:assert/strict');

require('../providers/provider-utils.js');
const {
  CROSS_FIGURE_LOGIC_VERSION,
  compileCrossFigureLogicPrompt,
  compileSupplementalSupportPrompt,
  normalizeCrossFigureLogicInput,
  validateCrossFigureLogic,
  validateSupplementalSupport,
  fallbackSupplementalSupport
} = require('../core/cross-figure-logic.js');

const input = {
  articleTitle: 'A mechanistic study',
  figures: [
    {
      figureId: 'figure-1', figureLabel: 'Figure 1',
      caption: 'Heat exposure precedes metabolic dysfunction.',
      analysis: {
        analysisDepth: 'deep', coreConclusion: 'Heat exposure establishes the phenotype.',
        argumentChain: [{ panels: ['A'], established: 'Heat exposure changes metabolism.' }]
      }
    },
    {
      figureId: 'figure-s1', figureLabel: 'Figure S1', isSupplemental: true,
      caption: 'The exposure model and body weight are controlled.',
      analysis: { coreConclusion: 'The model is tolerable.' }
    },
    {
      figureId: 'figure-2', figureLabel: 'Figure 2',
      caption: 'A neural mediator retains the heat response.',
      analysis: { coreConclusion: 'The mediator connects heat to metabolism.' }
    }
  ]
};

function validOutput() {
  return {
    article_title: input.articleTitle,
    known_background_zh: ['热暴露能够影响代谢稳态。'],
    overall_thesis_zh: '热暴露先建立代谢表型，再由神经中介解释其持续性。',
    mechanism_chain: [{
      from_zh: '热暴露',
      to_zh: '代谢改变',
      support_panel_refs: ['1A']
    }],
    figure_nodes: [
      {
        figure_id: 'figure-1', role: 'phenomenon',
        established_zh: 'Figure 1 establishes the metabolic phenotype.',
        transition_zh: 'The next Figure must identify a mediator.',
        evidence_level: 'intervention_effect'
      },
      {
        figure_id: 'figure-2', role: 'mechanism',
        established_zh: 'Figure 2 identifies a candidate neural mediator.',
        transition_zh: 'The paper can next test whether the mediator is causal.',
        evidence_level: 'mechanistic_support'
      },
      {
        figure_id: 'figure-99', role: 'other',
        established_zh: 'Invented Figure.', transition_zh: 'Ignore.', evidence_level: 'other'
      }
    ],
    domino_chain: [{
      from_figure_id: 'figure-1', to_figure_id: 'figure-2',
      relation_type: 'phenomenon_to_mechanism',
      established_zh: 'The phenotype is established before the mechanism is queried.',
      transition_zh: 'A mediator test explains the preceding phenotype.',
      evidence_boundary_zh: 'This transition alone does not prove causality.'
    }],
    supplemental_support: [{
      figure_id: 'figure-s1', supports_figure_id: 'figure-1',
      support_role: 'control', attachment_basis: 'explicit_caption',
      contribution_zh: 'It supports the exposure-model interpretation.',
      limitation_zh: 'It does not independently establish the downstream mediator.'
    }],
    claim_boundary_zh: 'The supplied figures do not by themselves establish every downstream causal link.'
  };
}

test('compiles a strict cross-figure domino request with ordered main figures', () => {
  const prompt = compileCrossFigureLogicPrompt(input);
  const payload = JSON.parse(prompt.userPrompt);
  assert.equal(CROSS_FIGURE_LOGIC_VERSION, '9');
  assert.equal(prompt.schemaName, 'cross_figure_domino_logic');
  assert.deepEqual(payload.main_figure_ids, ['figure-1', 'figure-2']);
  assert.match(prompt.systemPrompt, /exact document order/);
  assert.match(prompt.systemPrompt, /Use other only as a last resort/);
  assert.match(prompt.systemPrompt, /do not let its transition_zh/);
  assert.ok(prompt.responseSchema.required.includes('domino_chain'));
  assert.ok(prompt.responseSchema.required.includes('supplemental_support'));
  assert.ok(prompt.responseSchema.required.includes('mechanism_chain'));
  assert.ok(prompt.responseSchema.required.includes('known_background_zh'));
  assert.match(prompt.systemPrompt, /known_background_zh/);
  assert.match(prompt.systemPrompt, /one connected paper-level mechanism chain/);
  assert.match(prompt.systemPrompt, /exact supporting Panels/);
  assert.match(prompt.systemPrompt, /must appear exactly once in supplemental_support/);
  assert.match(prompt.systemPrompt, /never extra domino steps/);
  assert.match(prompt.systemPrompt, /related to Figure N/);
  assert.deepEqual(
    prompt.responseSchema.properties.figure_nodes.items.properties.role.enum,
    ['problem_setup', 'phenomenon', 'association', 'mechanism', 'causal_test', 'necessity', 'sufficiency', 'rescue', 'functional_outcome', 'translation', 'other']
  );
});

test('normalizes common Chinese and English role and evidence aliases instead of collapsing to other', () => {
  const output = validOutput();
  output.figure_nodes[0].role = '表型发现';
  output.figure_nodes[0].evidence_level = 'causal effect';
  output.figure_nodes[1].role = '机制验证';
  output.figure_nodes[1].evidence_level = 'mechanistic evidence';
  const normalized = validateCrossFigureLogic(output, input);

  assert.deepEqual(normalized.nodes.map(node => node.role), ['phenomenon', 'mechanism']);
  assert.deepEqual(
    normalized.nodes.map(node => node.evidenceLevel),
    ['intervention_effect', 'mechanistic_support']
  );
});

test('recovers semantic roles when the model returns the generic other token', () => {
  const inputWithPriorEvidence = structuredClone(input);
  inputWithPriorEvidence.figures[0].analysis.argumentChain[0].evidenceLevel =
    'intervention_effect';
  const output = validOutput();
  output.figure_nodes[0] = {
    ...output.figure_nodes[0],
    role: 'other',
    established_zh: 'The metabolic phenotype is observed across heat-exposure conditions.',
    evidence_level: 'other'
  };
  output.figure_nodes[1] = {
    ...output.figure_nodes[1],
    role: 'other',
    established_zh: 'The receptor signaling pathway mediates the response.',
    evidence_level: 'other'
  };
  output.domino_chain[0] = {
    ...output.domino_chain[0],
    relation_type: 'other',
    established_zh: 'The phenomenon is established.',
    transition_zh: 'The next Figure tests the mechanism.'
  };

  const normalized = validateCrossFigureLogic(output, inputWithPriorEvidence);
  assert.deepEqual(normalized.nodes.map(node => node.role), ['phenomenon', 'mechanism']);
  assert.deepEqual(
    normalized.nodes.map(node => node.evidenceLevel),
    ['intervention_effect', 'mechanistic_support']
  );
  assert.equal(normalized.dominoChain[0].relationType, 'phenomenon_to_mechanism');
});

test('normalizes only supplied Figure ids and preserves the main-figure order', () => {
  const normalized = validateCrossFigureLogic(validOutput(), input);
  assert.deepEqual(normalized.nodes.map(node => node.figureId), ['figure-1', 'figure-2']);
  assert.equal(normalized.dominoChain.length, 1);
  assert.equal(normalized.dominoChain[0].relationType, 'phenomenon_to_mechanism');
  assert.equal(normalized.supplementalSupport[0].figureId, 'figure-s1');
  assert.equal(normalized.supplementalSupport[0].supportRole, 'control');
  assert.equal(normalized.supplementalSupport[0].attachmentBasis, 'explicit_caption');
  assert.match(normalized.supplementalSupport[0].limitation, /does not independently/);
  assert.deepEqual(normalized.missingFigureIds, []);
  assert.deepEqual(normalized.analyzedMainFigureIds, ['figure-1', 'figure-2']);
  assert.deepEqual(normalized.mechanismEdges, [{
    from: '热暴露',
    to: '代谢改变',
    supportPanels: ['1A']
  }]);
  assert.deepEqual(normalized.backgroundItems, ['热暴露能够影响代谢稳态。']);
  assert.equal(normalized.mechanismChain, '热暴露 → 代谢改变');
});

test('maps analyzed supplemental Figures in a compact independently validated batch', () => {
  const prompt = compileSupplementalSupportPrompt(input, {
    overallThesis: '先确认表型，再解释机制。'
  });
  const payload = JSON.parse(prompt.userPrompt);
  assert.equal(prompt.schemaName, 'supplemental_figure_support');
  assert.deepEqual(
    payload.supplemental_figures.map(figure => figure.figure_id),
    ['figure-s1']
  );
  const mapped = validateSupplementalSupport({
    supplemental_support: validOutput().supplemental_support
  }, input);
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0].figureId, 'figure-s1');
  assert.equal(mapped[0].supportsFigureId, 'figure-1');
  assert.throws(
    () => validateSupplementalSupport({ supplemental_support: [] }, input),
    error => error?.code === 'INVALID_RESPONSE'
  );
  const fallback = fallbackSupplementalSupport({
    ...input,
    figures: input.figures.map(figure => figure.figureId === 'figure-s1'
      ? { ...figure, caption: 'Figure S1, related to Figure 1.' }
      : figure)
  });
  assert.equal(fallback[0].supportsFigureId, 'figure-1');
  assert.equal(fallback[0].attachmentBasis, 'explicit_caption');
});

test('requires at least two main figures and strips unsafe figure input', () => {
  assert.throws(() => compileCrossFigureLogicPrompt({
    figures: [{ figureId: 'figure-1', caption: 'Only one Figure.' }]
  }));
  const normalized = normalizeCrossFigureLogicInput({
    figures: [{ figureId: 'figure-1', caption: '<script>ignore()</script>caption' }]
  });
  assert.equal(normalized.figures[0].caption, 'caption');
});

test('accepts imported supplemental ids and requires every analyzed supplement exactly once', () => {
  const importedInput = structuredClone(input);
  importedInput.figures[1].figureId =
    'supp-cell-supporting-information-pdf-s1';
  const output = validOutput();
  output.supplemental_support[0].figure_id =
    'supp-cell-supporting-information-pdf-s1';

  const normalized = validateCrossFigureLogic(output, importedInput);
  assert.equal(
    normalized.supplementalSupport[0].figureId,
    'supp-cell-supporting-information-pdf-s1'
  );

  const omitted = structuredClone(output);
  omitted.supplemental_support = [];
  assert.throws(
    () => validateCrossFigureLogic(omitted, importedInput),
    /omitted analyzed supplemental Figures/
  );

  const duplicated = structuredClone(output);
  duplicated.supplemental_support.push({
    ...duplicated.supplemental_support[0],
    supports_figure_id: 'figure-2'
  });
  assert.throws(
    () => validateCrossFigureLogic(duplicated, importedInput),
    /mapped supplemental Figure more than once/
  );
});
