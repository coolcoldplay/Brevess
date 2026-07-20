const test = require('node:test');
const assert = require('node:assert/strict');

require('../core/cache-planner.js');
const {
  FIGURE_PANEL_IMAGE_EDGES,
  FIGURE_PANEL_PROMPT_VERSION,
  classifyFigurePanelQuestion,
  extractFigurePanelCaption,
  selectFigurePanelParagraphs,
  estimateFigurePanelInputTokens,
  buildFigurePanelPlans,
  buildFigurePanelCacheKey,
  isFigurePanelCapacityError
} = require('../core/figure-panel-planner.js');

const paragraphs = [
  { paragraphId: 'm1', sectionTitle: 'Methods', text: 'RNA sequencing was performed on treated and control samples.' },
  { paragraphId: 'r1', sectionTitle: 'Results', text: 'Figure 2A shows the treatment and control groups used for the comparison.' },
  { paragraphId: 'r2', sectionTitle: 'Results', text: 'The signal in Figure 2A increased after treatment and was quantified statistically.' },
  { paragraphId: 'd1', sectionTitle: 'Discussion', text: 'This result supports the proposed mechanism but does not establish direct causality.' },
  { paragraphId: 'x1', sectionTitle: 'Introduction', text: 'An unrelated background paragraph about another disease.' }
];

function imageVariant(maxEdge, width, height, inputMode = 'figure_image') {
  return {
    mediaType: 'image/jpeg',
    dataUrl: `data:image/jpeg;base64,${'A'.repeat(Math.max(4, Math.round(maxEdge / 10)))}`,
    maxEdge,
    width,
    height,
    inputMode,
    pixelsSupplied: true
  };
}

test('classifies visual, grouping/statistics, methods, and argument-role Panel questions', () => {
  assert.equal(classifyFigurePanelQuestion({ topics: ['axes_reading'] }), 'visual');
  assert.equal(classifyFigurePanelQuestion({ topics: ['grouping'] }), 'grouping_stats');
  assert.equal(classifyFigurePanelQuestion({ topics: ['technique_principle'] }), 'methods');
  assert.equal(classifyFigurePanelQuestion({ customQuestion: '这个 Panel 在全文论证链中起什么作用？' }), 'argument_role');
  assert.equal(classifyFigurePanelQuestion({ customQuestion: 'How does the curve change over time?' }), 'visual');
});

test('extracts only the shared legend and target-Panel caption range', () => {
  const caption = 'Figure 2. Values are mean ± SEM. (A) Treatment groups and tumor volume. (B–C) RNA abundance and pathway score. (D) Validation cohort.';
  const panelA = extractFigurePanelCaption(caption, 'A');
  const panelB = extractFigurePanelCaption(caption, 'B');
  assert.match(panelA.sharedLegend, /mean ± SEM/);
  assert.match(panelA.targetText, /Treatment groups and tumor volume/);
  assert.doesNotMatch(panelA.combined, /Validation cohort/);
  assert.match(panelB.targetText, /RNA abundance and pathway score/);
  assert.doesNotMatch(panelB.combined, /Treatment groups and tumor volume/);
});

test('selects two to four topic-relevant body paragraphs with stable identities', () => {
  const selected = selectFigurePanelParagraphs(paragraphs, {
    panelId: 'A', figureLabel: 'Figure 2', topic: 'grouping_stats',
    question: 'How were the treatment and control groups compared?'
  });
  assert.ok(selected.length >= 2 && selected.length <= 4);
  assert.equal(selected[0].paragraphId, 'r1');
  assert.ok(selected.some(item => item.paragraphId === 'r2'));
  assert.equal(selected.some(item => item.paragraphId === 'x1'), false);
});

test('builds an image-aware crop/best-image degradation ladder ending in text only', () => {
  assert.deepEqual(FIGURE_PANEL_IMAGE_EDGES, [1200, 960, 768]);
  const plans = buildFigurePanelPlans({
    requestMode: 'interpretation',
    documentHash: 'a'.repeat(64),
    figureId: 'figure-2', figureLabel: 'Figure 2', panelId: 'A',
    caption: 'Figure 2. Shared legend. (A) Treatment reduced tumor volume. (B) Validation.',
    contextParagraphs: paragraphs,
    imageVariants: [
      imageVariant(1200, 1200, 900, 'panel_crop'),
      imageVariant(960, 960, 720, 'panel_crop'),
      imageVariant(768, 768, 576, 'panel_crop')
    ],
    contextWindowTokens: 32768,
    outputTokens: 2048
  });
  assert.deepEqual(plans.map(plan => plan.imageMaxEdge), [1200, 960, 768, 0]);
  assert.deepEqual(plans.map(plan => plan.inputMode), [
    'panel_crop', 'panel_crop', 'panel_crop', 'caption_context'
  ]);
  assert.equal(plans.at(-1).pixelsSupplied, false);
  assert.equal(plans.every(plan => plan.images.length <= 1), true);
  for (let index = 1; index < plans.length; index += 1) {
    assert.ok(plans[index].estimatedInputTokens < plans[index - 1].estimatedInputTokens);
  }
});

test('uses the best single Figure image when reliable Panel geometry is unavailable', () => {
  const plans = buildFigurePanelPlans({
    requestMode: 'followup', documentHash: 'b'.repeat(64),
    figureId: 'figure-3', figureLabel: 'Figure 3', panelId: 'C',
    caption: 'Figure 3. (C) Quantification.', contextParagraphs: paragraphs,
    topics: ['axes_reading'], customQuestion: 'What does the y axis mean?',
    imageVariants: [
      imageVariant(960, 400, 300),
      imageVariant(1200, 1200, 800),
      imageVariant(768, 768, 512)
    ],
    contextWindowTokens: 16384,
    outputTokens: 2048
  });
  assert.equal(plans[0].images.length, 1);
  assert.equal(plans[0].imageMaxEdge, 1200);
  assert.equal(plans[0].inputMode, 'figure_image');
});

test('bounds follow-up history with the same capacity calculation', () => {
  const history = Array.from({ length: 30 }, (_, index) => ({
    role: index % 2 ? 'assistant' : 'user',
    content: `turn ${index} ${'evidence '.repeat(180)}`
  }));
  const plans = buildFigurePanelPlans({
    requestMode: 'followup', documentHash: 'c'.repeat(64),
    figureId: 'figure-1', figureLabel: 'Figure 1', panelId: 'A',
    caption: 'Figure 1. (A) Result.', contextParagraphs: paragraphs,
    customQuestion: 'Explain the result.', history,
    imageVariants: [], contextWindowTokens: 8192, outputTokens: 2048
  });
  assert.equal(plans.length, 1);
  assert.ok(plans[0].history.length < history.length);
  assert.ok(plans[0].estimatedInputTokens <= plans[0].inputBudgetTokens);
});

test('estimates larger images as larger inputs and isolates every Panel cache key', () => {
  const small = estimateFigurePanelInputTokens({ text: 'same', width: 768, height: 512 });
  const large = estimateFigurePanelInputTokens({ text: 'same', width: 1200, height: 900 });
  assert.ok(large > small);
  const common = {
    documentHash: 'd'.repeat(64), figureHash: 'figure-hash', providerId: 'openai',
    model: 'gpt-5.1', inputMode: 'figure_image', imageWidth: 960, imageHeight: 720,
    promptVersion: FIGURE_PANEL_PROMPT_VERSION, requestMode: 'interpretation'
  };
  assert.notEqual(
    buildFigurePanelCacheKey({ ...common, panelId: 'A' }),
    buildFigurePanelCacheKey({ ...common, panelId: 'B' })
  );
  assert.notEqual(
    buildFigurePanelCacheKey({ ...common, panelId: 'A' }),
    buildFigurePanelCacheKey({ ...common, panelId: 'A', inputMode: 'caption_context' })
  );
});

test('recognizes only capacity-shaped failures for smaller-payload retries', () => {
  assert.equal(isFigurePanelCapacityError({ code: 'TOKEN_LIMIT_REJECTED' }), true);
  assert.equal(isFigurePanelCapacityError({ code: 'CONTEXT_BUDGET_EXCEEDED' }), true);
  assert.equal(isFigurePanelCapacityError({ code: 'PROVIDER_REJECTED', message: 'image is too large' }), true);
  assert.equal(isFigurePanelCapacityError({ code: 'AUTH_INVALID' }), false);
  assert.equal(isFigurePanelCapacityError({ code: 'RATE_LIMITED' }), false);
});
