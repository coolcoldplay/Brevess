const test = require('node:test');
const assert = require('node:assert/strict');

require('../core/cache-planner.js');
const {
  FIGURE_PANEL_IMAGE_EDGES,
  FIGURE_PANEL_PROMPT_VERSION,
  classifyFigurePanelQuestion,
  figurePanelFollowupOutputUnits,
  extractFigurePanelCaption,
  selectFigurePanelParagraphs,
  estimateFigurePanelInputTokens,
  buildFigurePanelPlans,
  retrievePanelHistory,
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

test('scales Panel follow-up output room to the actual question depth', () => {
  assert.equal(figurePanelFollowupOutputUnits({ customQuestion: '纵轴表示什么？' }), 1);
  assert.equal(figurePanelFollowupOutputUnits({
    customQuestion: '为什么作者选择这种统计比较？'
  }), 4);
  assert.equal(figurePanelFollowupOutputUnits({
    customQuestion: '请详细、一步一步解释这个 Panel 的完整证据链。'
  }), 8);
  assert.equal(figurePanelFollowupOutputUnits({
    topics: ['grouping', 'technique_principle', 'axes_reading']
  }), 3);
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

test('preserves scientific source text from caption and body through Panel planning', () => {
  const caption = 'Figure 1. Values use p < 0.05. (A) Dose was 10² units and x > 1. (B) Control.';
  const extracted = extractFigurePanelCaption(caption, 'A');
  assert.match(extracted.sharedLegend, /p < 0\.05/u);
  assert.match(extracted.targetText, /10² units and x > 1/u);
  assert.doesNotMatch(extracted.targetText, /102 units/u);
  const fullWidthMarker = extractFigurePanelCaption(
    'Ｆｉｇｕｒｅ 1. （Ａ） Dose was 10² units. （Ｂ） Control.', 'A'
  );
  assert.match(fullWidthMarker.targetText, /（Ａ） Dose was 10² units/u);
  assert.doesNotMatch(fullWidthMarker.targetText, /（Ｂ） Control/u);

  const plans = buildFigurePanelPlans({
    requestMode: 'followup', documentHash: '9'.repeat(64),
    figureId: 'figure-1', figureLabel: 'Figure 1', panelId: 'A', caption,
    contextParagraphs: [{ paragraphId: 'science-1', sectionTitle: 'Results',
      text: '🧪 Figure 1A reports dose 10² units with p < 0.05.' }],
    customQuestion: 'What does Figure 1A report?', imageVariants: [],
    contextWindowTokens: 8192, outputTokens: 2048
  });
  assert.equal(plans.length, 1);
  assert.match(plans[0].captionEvidence.targetText, /10² units and x > 1/u);
  assert.equal(plans[0].contextParagraphs[0].text,
    '🧪 Figure 1A reports dose 10² units with p < 0.05.');
  assert.ok(plans[0].estimatedInputTokens <= plans[0].inputBudgetTokens);
});

test('extracts lowercase grouped Nature legends without treating crossrefs or acronyms as Panels', () => {
  const caption = [
    'Extended Data Fig. 1. Values are mean ± s.e.m.',
    'a, Quality-control data.',
    'b–d, Independent validation assays.',
    'e,f, Rescue and replication.',
    'See Extended Data Fig. 2a. n.s., not significant; P, probability.'
  ].join(' ');

  const panelC = extractFigurePanelCaption(caption, 'C');
  const panelF = extractFigurePanelCaption(caption, 'F');

  assert.match(panelC.sharedLegend, /mean ± s\.e\.m/);
  assert.match(panelC.targetText, /Independent validation assays/);
  assert.doesNotMatch(panelC.targetText, /Quality-control|Rescue/);
  assert.match(panelF.targetText, /Rescue and replication/);
});

test('does not split a caption on isolated inline cross-reference or acronym letters', () => {
  const caption = 'Figure 3. See Extended Data Fig. 1a. n.s., not significant; P, probability.';
  const result = extractFigurePanelCaption(caption, 'P');
  assert.equal(result.sharedLegend, '');
  assert.equal(result.targetText, caption);
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

test('keeps five recent turns and retrieves only topic-relevant older Panel memory', () => {
  const history = [
    { historyId: 'old-method', role: 'user', content: 'How was RNA sequencing normalized?' },
    { historyId: 'old-noise', role: 'assistant', content: 'The weather is unrelated.' },
    { historyId: 'old-axis', role: 'user', content: 'What does the survival curve axis show?' },
    ...Array.from({ length: 7 }, (_, index) => ({
      historyId: `recent-${index + 1}`,
      role: index % 2 ? 'assistant' : 'user',
      content: `recent discussion ${index + 1}`
    }))
  ];
  const selected = retrievePanelHistory(
    history, 'Explain the RNA sequencing method and normalization.'
  );
  assert.ok(selected.some(item => item.historyId === 'old-method' &&
    item.memoryClass === 'retrieved'));
  assert.equal(selected.some(item => item.historyId === 'old-noise'), false);
  assert.deepEqual(selected.filter(item => item.memoryClass === 'recent')
    .map(item => item.historyId), ['recent-3', 'recent-4', 'recent-5', 'recent-6', 'recent-7']);
});

test('never invents input capacity when the requested output leaves too little context', () => {
  const plans = buildFigurePanelPlans({
    requestMode: 'followup', documentHash: 'f'.repeat(64),
    figureId: 'figure-1', figureLabel: 'Figure 1', panelId: 'A',
    caption: 'Figure 1. (A) Result.', contextParagraphs: paragraphs,
    customQuestion: 'Please provide a detailed explanation.',
    imageVariants: [], contextWindowTokens: 8192, outputTokens: 6144
  });
  assert.deepEqual(plans, []);
});

test('budgets the verbatim scientific source rather than a shorter NFKC search projection', () => {
  const jamo = '\u1100\u1161\u11a8';
  const caption = `Figure 1. (A) ${jamo.repeat(400)}`;
  const contextParagraphs = Array.from({ length: 4 }, (_, index) => ({
    paragraphId: `jamo-${index + 1}`, sectionTitle: 'Results',
    text: `Figure 1A reports ${jamo.repeat(500)}`
  }));
  assert.equal(caption.length, 1214);
  assert.equal(contextParagraphs[0].text.length, 1518);
  assert.equal(contextParagraphs[0].text.normalize('NFKC').length, 518);

  const input = {
    requestMode: 'followup', documentHash: '8'.repeat(64),
    figureId: 'figure-1', figureLabel: 'Figure 1', panelId: 'A', caption,
    contextParagraphs, customQuestion: 'Explain Figure 1A.', imageVariants: [],
    contextWindowTokens: 8192
  };
  assert.deepEqual(buildFigurePanelPlans({ ...input, outputTokens: 3072 }), []);
  const admitted = buildFigurePanelPlans({ ...input, outputTokens: 2944 });
  assert.equal(admitted.length, 1);
  assert.ok(admitted[0].estimatedInputTokens > 3532);
  assert.ok(admitted[0].estimatedInputTokens <= admitted[0].inputBudgetTokens);
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

test('preserves each native PDF variant proof and binds text fallback to the same semantic context', () => {
  const binding = { documentHash: 'a'.repeat(64), documentGeneration: 2, semanticRevision: 3 };
  const semanticContextDigest = 'b'.repeat(64);
  const variant = imageVariant(1200, 1200, 900, 'panel_crop');
  variant.assetProof = {
    assetId: `pdfa-${'c'.repeat(48)}`, imageContentHash: 'd'.repeat(64),
    ...binding, figureId: 'figure-2', sourceType: 'panel', sourceSlot: 'panel-a-1200',
    pageNumbers: [2], mimeType: 'image/jpeg', width: 1200, height: 900,
    assetRevision: 1, cropRevision: 1, parentAssetId: `pdfa-${'e'.repeat(48)}`,
    parentImageContentHash: 'f'.repeat(64), rect: { x: 0, y: 0, width: 1, height: 1 },
    encoderRevision: 1
  };
  variant.pdfEvidenceBinding = { figureId: 'figure-2', binding,
    semanticContextDigest, assetProof: variant.assetProof };
  const plans = buildFigurePanelPlans({
    requestMode: 'interpretation', figureId: 'figure-2', figureLabel: 'Figure 2',
    panelId: 'A', caption: 'Figure 2. (A) Result.', contextParagraphs: paragraphs,
    imageVariants: [variant], pdfEvidenceBinding: { figureId: 'figure-2', binding,
      semanticContextDigest, assetProof: null }, contextWindowTokens: 32768, outputTokens: 2048
  });
  assert.equal(plans[0].assetProof.assetId, variant.assetProof.assetId);
  assert.deepEqual(plans[0].pdfEvidenceBinding, variant.pdfEvidenceBinding);
  assert.equal(plans.at(-1).assetProof, null);
  assert.equal(plans.at(-1).pdfEvidenceBinding.semanticContextDigest, semanticContextDigest);
  assert.notEqual(buildFigurePanelCacheKey({
    documentHash: binding.documentHash, figureHash: 'f', panelId: 'A',
    pdfEvidenceBinding: plans[0].pdfEvidenceBinding
  }), buildFigurePanelCacheKey({
    documentHash: binding.documentHash, figureHash: 'f', panelId: 'A',
    pdfEvidenceBinding: plans.at(-1).pdfEvidenceBinding
  }));
});
