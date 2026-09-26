const test = require('node:test');
const assert = require('node:assert/strict');

const {
  REVIEW_OUTLINE_VERSION,
  selectArticleOutlineStrategy,
  createReviewParagraphSchema,
  compileReviewParagraphPrompt,
  validateReviewParagraphBatch,
  createReviewSynthesisSchema,
  compileReviewSynthesisPrompt,
  validateReviewSynthesis,
  buildReviewOutlineTree,
  collectReviewParagraphSummaries
} = require('../core/review-outline.js');

test('selects a generic or primary-research strategy when review metadata is absent', () => {
  assert.equal(selectArticleOutlineStrategy(null), 'generic_article');
  assert.equal(selectArticleOutlineStrategy({
    primaryType: '', reviewSubtype: 'not_review'
  }), 'generic_article');
  assert.equal(selectArticleOutlineStrategy({
    primaryType: 'basic_mechanistic', reviewSubtype: 'not_review'
  }), 'primary_research');
  assert.equal(selectArticleOutlineStrategy({
    primaryType: 'narrative_review', reviewSubtype: 'narrative'
  }), 'review');
});

test('generic article prompts never claim the paper is a review', () => {
  const genericParagraphs = [{
    paragraphId: 'p1', sectionId: 'results', sectionTitle: 'Results',
    text: 'Treatment restored the phenotype.'
  }];
  const mapPrompt = compileReviewParagraphPrompt(
    'batch-1', genericParagraphs, 'primary_research'
  );
  assert.match(mapPrompt.systemPrompt, /生物医学论文/);
  assert.doesNotMatch(mapPrompt.systemPrompt, /综述结构分析助手|被引研究/);
  const reducePrompt = compileReviewSynthesisPrompt(
    'Mechanistic paper', genericParagraphs, [{
      paragraphId: 'p1', summary: '治疗恢复表型', rhetoricalRole: 'evidence_support',
      keyPoint: '支持因果结论', transitionFromPrevious: ''
    }], 'not_review', 'primary_research'
  );
  assert.match(reducePrompt.systemPrompt, /研究问题.*结果.*结论/s);
  assert.doesNotMatch(reducePrompt.systemPrompt, /生物医学综述的/);
});

const paragraphs = [{
  paragraphId: 'sec-a-p-001', sectionId: 'sec-a', sectionTitle: 'Mechanisms',
  sectionKind: 'article', headingLevel: 2,
  headingPath: [{ level: 1, sectionId: 'sec-root', title: 'Review' },
    { level: 2, sectionId: 'sec-a', title: 'Mechanisms' }],
  text: 'Distinctive original sentence about pathway evidence.'
}];

const mapResponse = {
  batch_id: 'review-001', paragraphs_reviewed: ['sec-a-p-001'],
  paragraph_summaries: [{
    paragraph_id: 'sec-a-p-001', summary_zh: '该段总结通路证据。',
    rhetorical_role: 'evidence_support', key_point_zh: '支持本节机制论点。',
    transition_from_previous_zh: ''
  }]
};

test('paragraph schema requires one bounded summary record per requested id', () => {
  const schema = createReviewParagraphSchema(['sec-a-p-001']);
  assert.deepEqual(schema.properties.paragraphs_reviewed.items.enum, ['sec-a-p-001']);
  assert.ok(schema.required.includes('paragraph_summaries'));
  assert.equal(schema.properties.paragraph_summaries.items.additionalProperties, false);
  assert.deepEqual(schema.properties.paragraph_summaries.items.required, [
    'paragraph_id', 'summary_zh', 'rhetorical_role', 'key_point_zh',
    'transition_from_previous_zh'
  ]);
  assert.equal(REVIEW_OUTLINE_VERSION, '3');
});

test('paragraph prompt sends heading paths and source text as untrusted JSON', () => {
  const request = compileReviewParagraphPrompt('review-001', paragraphs);
  const payload = JSON.parse(request.userPrompt);
  assert.equal(payload.paragraphs[0].text, paragraphs[0].text);
  assert.equal(payload.paragraphs[0].heading_path[1].title, 'Mechanisms');
  assert.match(request.systemPrompt, /untrusted|不可信/i);
});

test('paragraph validation rejects missing extra and duplicate ids', () => {
  assert.throws(() => validateReviewParagraphBatch({
    ...mapResponse, paragraph_summaries: []
  }, paragraphs, 'review-001'), error => error.code === 'INVALID_RESPONSE');
  assert.throws(() => validateReviewParagraphBatch({
    ...mapResponse,
    paragraphs_reviewed: ['sec-a-p-001', 'invented'],
    paragraph_summaries: [...mapResponse.paragraph_summaries,
      { ...mapResponse.paragraph_summaries[0], paragraph_id: 'invented' }]
  }, paragraphs, 'review-001'), error => error.code === 'INVALID_RESPONSE');
  assert.throws(() => validateReviewParagraphBatch({
    ...mapResponse,
    paragraph_summaries: [mapResponse.paragraph_summaries[0], mapResponse.paragraph_summaries[0]]
  }, paragraphs, 'review-001'), error => error.code === 'INVALID_RESPONSE');
});

test('synthesis prompt contains summaries but none of the original paragraph text', () => {
  const summaries = validateReviewParagraphBatch(mapResponse, paragraphs, 'review-001');
  const request = compileReviewSynthesisPrompt('Review title', paragraphs, summaries);
  assert.match(request.userPrompt, /该段总结通路证据/);
  assert.doesNotMatch(request.userPrompt, /Distinctive original sentence/);
  assert.equal(createReviewSynthesisSchema(['sec-root', 'sec-a'])
    .properties.sections.items.additionalProperties, false);
});

test('synthesis assigns each paragraph summary only to its direct leaf section', () => {
  const nestedParagraphs = [
    {
      ...paragraphs[0], paragraphId: 'sec-root-p-001', sectionId: 'sec-root',
      sectionTitle: 'Review', headingLevel: 1,
      headingPath: [{ level: 1, sectionId: 'sec-root', title: 'Review' }]
    },
    paragraphs[0]
  ];
  const summaries = nestedParagraphs.map(item => ({
    paragraphId: item.paragraphId, summary: `摘要 ${item.paragraphId}`,
    rhetoricalRole: 'evidence_support', keyPoint: '支持主题', transitionFromPrevious: ''
  }));

  const request = compileReviewSynthesisPrompt('Review', nestedParagraphs, summaries);
  const payload = JSON.parse(request.userPrompt);
  const assignedIds = payload.sections.flatMap(section =>
    section.paragraph_summaries.map(item => item.paragraph_id));

  assert.deepEqual(assignedIds.sort(), ['sec-a-p-001', 'sec-root-p-001']);
  assert.equal(new Set(assignedIds).size, assignedIds.length);
});

test('synthesis requests evidence-grounded logical units inside long sections', () => {
  const summaries = validateReviewParagraphBatch(mapResponse, paragraphs, 'review-001');
  const request = compileReviewSynthesisPrompt('Review title', paragraphs, summaries);
  const sectionSchema = request.responseSchema.properties.sections.items;

  assert.ok(sectionSchema.required.includes('logical_units'));
  assert.deepEqual(sectionSchema.properties.logical_units.items.properties.source_paragraph_ids
    .items.enum, ['sec-a-p-001']);
  assert.match(request.systemPrompt, /逻辑单元/);
  assert.match(request.systemPrompt, /每个段落 ID.*恰好一次/);
});

test('synthesis validation requires every known section and rejects invented sections', () => {
  const expected = ['sec-root', 'sec-a'];
  const raw = {
    paper_thesis_zh: '中心命题', organization_strategy_zh: '按主题推进',
    sections: expected.map(section_id => ({
      section_id, section_role: '主题组织', section_summary_zh: '章节摘要',
      transition_from_previous_zh: ''
    })), key_tensions: []
  };
  assert.equal(validateReviewSynthesis(raw, expected).sections.length, 2);
  assert.throws(() => validateReviewSynthesis({
    ...raw, sections: [...raw.sections, { ...raw.sections[0], section_id: 'invented' }]
  }, expected), error => error.code === 'INVALID_RESPONSE');
});

test('tree builder nests headings and includes each paragraph exactly once', () => {
  const summaries = validateReviewParagraphBatch(mapResponse, paragraphs, 'review-001');
  const outline = buildReviewOutlineTree({
    articleTitle: 'Review', reviewSubtype: 'narrative', paragraphs, summaries,
    synthesis: null
  });
  assert.equal(outline.nodes[0].children[0].sectionId, 'sec-a');
  assert.deepEqual(outline.nodes[0].children[0].paragraphs.map(item => item.paragraphId),
    ['sec-a-p-001']);
  assert.equal(outline.globalSynthesisAvailable, false);
});

test('collects paragraph summaries from nested scoped outlines', () => {
  const outline = {
    nodes: [{ sectionId: 'sec-a', paragraphs: [{
      paragraphId: 'p1', summary: '摘要 1', rhetoricalRole: 'evidence_support',
      keyPoint: '关键点', transitionFromPrevious: ''
    }], children: [{ sectionId: 'sec-b', paragraphs: [{
      paragraphId: 'p2', summary: '摘要 2'
    }], children: [] }] }]
  };
  assert.deepEqual(collectReviewParagraphSummaries(outline).map(item => item.paragraphId),
    ['p1', 'p2']);
});

test('tree builder exposes model-discovered logical units without inventing evidence', () => {
  const summaries = validateReviewParagraphBatch(mapResponse, paragraphs, 'review-001');
  const synthesis = validateReviewSynthesis({
    paper_thesis_zh: '中心命题', organization_strategy_zh: '按机制推进',
    sections: [
      {
        section_id: 'sec-root', section_role: '总领全文',
        section_summary_zh: '提出综述范围。', transition_from_previous_zh: '',
        logical_units: []
      },
      {
        section_id: 'sec-a', section_role: '机制综合',
        section_summary_zh: '整合通路证据。', transition_from_previous_zh: '',
        logical_units: [{
          unit_id: 'u1', title_zh: '通路证据链', rhetorical_role: 'synthesis',
          summary_zh: '从机制到结论形成证据链。',
          source_paragraph_ids: ['sec-a-p-001']
        }]
      }
    ], key_tensions: []
  }, ['sec-root', 'sec-a'], paragraphs);
  const outline = buildReviewOutlineTree({
    articleTitle: 'Review', reviewSubtype: 'narrative', paragraphs, summaries, synthesis
  });
  const section = outline.nodes[0].children[0];
  const logicalUnit = section.children[0];

  assert.equal(logicalUnit.logicalUnit, true);
  assert.equal(logicalUnit.title, '通路证据链');
  assert.deepEqual(logicalUnit.paragraphs.map(item => item.paragraphId), ['sec-a-p-001']);
  assert.equal(section.paragraphs.length, 0);
});

test('rejects an empty-content synthesis when multiple scientific paragraphs were supplied', () => {
  const sourceParagraphs = Array.from({ length: 6 }, (_, index) => ({
    ...paragraphs[0], paragraphId: `sec-a-p-${String(index + 1).padStart(3, '0')}`,
    text: `Scientific paragraph ${index + 1} explains a distinct lactylation mechanism.`
  }));
  const sourceIds = sourceParagraphs.map(item => item.paragraphId);
  const emptySynthesis = {
    paper_thesis_zh: '本文为综述，但提供的摘要和段落未包含实质科学内容，无法归纳中心命题。',
    organization_strategy_zh: '各章节仅为导航文本或标题信息，难以分析组织策略。',
    sections: [{
      section_id: 'sec-a', section_role: '导航',
      section_summary_zh: '本章节只有标题和来源信息，无实质科学内容。',
      transition_from_previous_zh: '',
      logical_units: [{
        unit_id: 'u1', title_zh: '导航信息', rhetorical_role: 'other',
        summary_zh: '没有可用科学内容。', transition_from_previous_zh: '',
        source_paragraph_ids: sourceIds
      }]
    }], key_tensions: []
  };

  assert.throws(
    () => validateReviewSynthesis(emptySynthesis, ['sec-a'], sourceParagraphs),
    error => error.code === 'INVALID_RESPONSE' && /substantive|实质/i.test(error.message)
  );
  const prompt = compileReviewSynthesisPrompt(
    'Review title', sourceParagraphs,
    sourceParagraphs.map(item => ({
      paragraphId: item.paragraphId, summary: '乳酰化机制摘要。',
      rhetoricalRole: 'evidence_support', keyPoint: '支持机制链。',
      transitionFromPrevious: ''
    }))
  );
  assert.match(prompt.systemPrompt, /不得声称.*无实质内容/);
});

test('synthesis prompt demands a concrete biomedical thesis and ordered argument chain', () => {
  const summaries = validateReviewParagraphBatch(mapResponse, paragraphs, 'review-001');
  const prompt = compileReviewSynthesisPrompt('Review title', paragraphs, summaries);

  assert.match(prompt.systemPrompt, /paper_thesis_zh.*综述对象.*主要机制.*转化\/研究结论/);
  assert.match(prompt.systemPrompt, /organization_strategy_zh.*实际章节顺序.*具体主题/);
  assert.match(prompt.systemPrompt, /section_summary_zh.*本节问题.*证据\/机制.*本节结论/);
  assert.match(prompt.systemPrompt, /禁止.*元话语.*信息不足/);
});
