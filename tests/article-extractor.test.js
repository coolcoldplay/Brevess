const test = require('node:test');
const assert = require('node:assert/strict');
const { selectPublisherAdapter } = require('../core/publisher-adapters.js');
require('../core/article-structure.js');
const {
  isExcludedSectionHeading,
  buildParagraphRecords,
  normalizeTextWithOffsets,
  collectContentElements,
  isReviewUtilitySectionTitle,
  selectContentRoot,
  diagnoseArticleExtraction,
  extractArticle,
  extractArticleStructure,
  prepareReviewOutlineParagraphs,
  summarizeArticleRecords
} = require('../core/article-extractor.js');

test('deduplicates repeated DOM copies without merging legitimate short text across sections', () => {
  const repeated = 'This sufficiently long scientific paragraph is duplicated by responsive desktop and mobile article markup, but represents one logical paragraph in the paper.'.repeat(1);
  const records = buildParagraphRecords([
    { kind: 'heading', text: 'Introduction' },
    { kind: 'paragraph', text: repeated },
    { kind: 'paragraph', text: repeated },
    { kind: 'paragraph', text: 'No adverse events were observed.' },
    { kind: 'heading', text: 'Introduction' },
    { kind: 'paragraph', text: repeated },
    { kind: 'heading', text: 'Results' },
    { kind: 'paragraph', text: 'No adverse events were observed.' }
  ]);
  assert.equal(records.filter(record => record.text === repeated).length, 1);
  assert.equal(records.filter(record => record.text === 'No adverse events were observed.').length, 2);
  assert.equal(records.length, 3);
});

test('deduplicates responsive DOM copies by stable source identity but retains real repeated prose', () => {
  const sentence = 'No increase in TP53 signaling was observed after treatment.';
  const records = buildParagraphRecords([
    { kind: 'heading', text: 'Results' },
    { kind: 'paragraph', text: sentence, sourceKey: 'result-p1', domId: 'desktop-p1' },
    { kind: 'paragraph', text: sentence, sourceKey: 'result-p1', domId: 'mobile-p1' },
    { kind: 'paragraph', text: sentence, sourceKey: 'result-p2', domId: 'desktop-p2' },
    { kind: 'heading', text: 'Discussion' },
    { kind: 'paragraph', text: sentence, sourceKey: 'discussion-p1' }
  ]);

  assert.equal(records.length, 3);
  assert.deepEqual(records.map(item => item.sourceIdentity), [
    'result-p1', 'result-p2', 'discussion-p1'
  ]);
  assert.equal(new Set(records.map(item => item.textHash)).size, 1);
});

test('classifies captions and references without mixing them into the body count', () => {
  const records = buildParagraphRecords([
    { kind: 'heading', text: 'Results' },
    { kind: 'paragraph', text: 'Treatment increased survival.' },
    { kind: 'figure-caption', text: 'Figure 1. Survival curves by treatment group.' },
    { kind: 'table-caption', text: 'Table 1. Baseline characteristics.' },
    { kind: 'heading', text: 'References' },
    { kind: 'paragraph', text: 'Smith et al. 2020. Example Journal.' }
  ]);

  assert.deepEqual(records.map(item => item.recordType), [
    'body', 'figure-caption', 'table-caption', 'reference'
  ]);
  assert.deepEqual(summarizeArticleRecords(records), {
    recordCount: 4,
    bodyParagraphCount: 1,
    figureCaptionCount: 1,
    tableCaptionCount: 1,
    referenceCount: 1,
    bodyCharacterCount: 'Treatment increased survival.'.length,
    characterCount: records.reduce((sum, item) => sum + item.text.length, 0)
  });
});

test('does not collect hidden utility prose as canonical article content', () => {
  const visible = {
    tagName: 'P', textContent: 'Visible scientific evidence paragraph.', dataset: {},
    closest: () => null, querySelector: () => null, querySelectorAll: () => [],
    getAttribute: () => null
  };
  const hidden = {
    tagName: 'P', textContent: 'Duplicated mobile utility paragraph.', dataset: {},
    closest: selector => selector.includes('[hidden]') ? { hidden: true } : null,
    querySelector: () => null, querySelectorAll: () => [], getAttribute: () => null
  };
  const root = { querySelectorAll: selector => selector === '*' ? [visible, hidden] : [] };

  assert.deepEqual(collectContentElements(root), [visible]);
});

test('counts a nested adapter paragraph once instead of counting its wrapper and child', () => {
  const paragraph = {
    tagName: 'P', textContent: 'A nested scientific paragraph reports the primary result.',
    dataset: {}, className: '', id: '', closest: () => null,
    querySelector: () => null, querySelectorAll: () => [], getAttribute: () => null
  };
  const wrapper = {
    tagName: 'DIV', textContent: paragraph.textContent,
    dataset: {}, className: 'article-section__content', id: '', closest: () => null,
    querySelector: selector => selector.includes('p') ? paragraph : null,
    querySelectorAll: () => [paragraph], getAttribute: () => null
  };
  const root = {
    querySelectorAll: selector => {
      if (selector === '*') return [wrapper, paragraph];
      if (selector === 'p') return [paragraph];
      if (selector === '.article-section__content > div') return [wrapper];
      return [];
    }
  };
  assert.deepEqual(collectContentElements(root).map(element => element.tagName), ['P']);
});

test('consolidates repeated publisher section roots into one complete article root', () => {
  const element = (tagName, textContent) => ({
    tagName, textContent, dataset: {}, className: '', id: '', closest: () => null,
    querySelector: () => null, querySelectorAll: () => [], getAttribute: () => null
  });
  const firstElements = [
    element('H2', 'Introduction'),
    element('P', 'The introduction provides enough scientific context to identify the article body.')
  ];
  const secondElements = [
    element('H2', 'Results'),
    element('P', 'The results provide enough scientific evidence to identify the complete article body.')
  ];
  const makeSection = (id, elements) => ({
    tagName: 'SECTION', id, className: 'article-section',
    textContent: elements.map(item => item.textContent).join(' '),
    querySelectorAll: selector => selector === '*' ? elements : [],
    querySelector: () => null, getAttribute: () => null,
    contains: candidate => elements.includes(candidate)
  });
  const first = makeSection('section-1', firstElements);
  const second = makeSection('section-2', secondElements);
  const complete = {
    tagName: 'MAIN', id: 'complete-article', className: '',
    textContent: [...firstElements, ...secondElements].map(item => item.textContent).join(' '),
    querySelectorAll: selector => selector === '*' ? [...firstElements, ...secondElements] : [],
    querySelector: () => null, getAttribute: () => null,
    contains: candidate => candidate === first || candidate === second ||
      firstElements.includes(candidate) || secondElements.includes(candidate)
  };
  const adapter = selectPublisherAdapter({ hostname: 'onlinelibrary.wiley.com' });
  const documentRef = {
    body: complete,
    querySelectorAll: selector => {
      if (selector === '.article__body') return [];
      if (selector === '.article-section') return [first, second];
      if (selector.includes(',')) return [complete, first, second];
      return [];
    },
    querySelector: () => complete
  };
  assert.equal(selectContentRoot(documentRef, adapter), complete);
});

test('excludes references and other non-body sections', () => {
  [
    'References', 'Bibliography', 'Acknowledgements', 'Author Contributions', 'Funding',
    'Conflicts of Interest', 'CRediT authorship contribution statement',
    'Generative AI statement', 'Declaration of competing interest',
    'Appendix A. Supplementary data', 'Data and code availability', 'Keywords',
    'Publisher’s note', 'Disclosure statement'
  ]
    .forEach(title => assert.equal(isExcludedSectionHeading(title), true, title));
  ['Introduction', 'Methods', 'Results', 'Discussion', 'Conclusions']
    .forEach(title => assert.equal(isExcludedSectionHeading(title), false, title));
});

test('treats numbered figure and table labels as outline chrome', () => {
  [
    'Figure 1.', 'Figure 12. Study workflow',
    'Table 1', 'Table 3. Baseline characteristics',
    'Skip to main content', 'REVIEW article', 'Related Info Links',
    'Author Information', 'Information & Authors', 'Metrics & Citations', 'Cite',
    'View Options', 'Publication History', 'License Summary', 'Subjects',
    'Authors’ contributions', 'Declaration of AI use', 'Footnotes'
  ].forEach(title => assert.equal(
    isReviewUtilitySectionTitle(title), true, title
  ));
});

test('assigns stable ids and separates the terminal reference section', () => {
  const records = buildParagraphRecords([
    { kind: 'heading', text: 'Results' },
    { kind: 'paragraph', text: 'Treatment increased survival.' },
    { kind: 'heading', text: 'References' },
    { kind: 'paragraph', text: 'Smith et al. 2020.' },
    { kind: 'heading', text: 'Appendix' },
    { kind: 'paragraph', text: 'Material after the reference list.' }
  ]);
  assert.deepEqual(records.map(item => item.paragraphId), [
    'sec-results-p-001', 'sec-references-ref-001', 'sec-references-ref-002'
  ]);
  assert.equal(records[0].sectionTitle, 'Results');
  assert.equal(records[0].sectionKind, 'results');
  assert.deepEqual(records.map(item => item.recordType), ['body', 'reference', 'reference']);
});

test('inherits the major Results kind across descriptive subsection headings', () => {
  const records = buildParagraphRecords([
    { kind: 'heading', text: 'Results' },
    { kind: 'heading', text: 'Model performance and selectivity' },
    { kind: 'paragraph', text: 'The model did not improve specificity in the external cohort.' }
  ]);
  assert.equal(records[0].sectionTitle, 'Model performance and selectivity');
  assert.equal(records[0].sectionKind, 'results');
});

test('normalizes whitespace while retaining raw DOM offsets', () => {
  const normalized = normalizeTextWithOffsets('  A \n B  ');
  assert.equal(normalized.text, 'A B');
  assert.deepEqual(normalized.rawStarts, [2, 3, 6]);
  assert.deepEqual(normalized.rawEnds, [3, 6, 7]);
});

test('keeps repeated section ids unique and preserves source indexes', () => {
  const records = buildParagraphRecords([
    { kind: 'heading', text: 'Results', sourceIndex: 0 },
    { kind: 'paragraph', text: 'First.', sourceIndex: 1 },
    { kind: 'heading', text: 'Results', sourceIndex: 2 },
    { kind: 'paragraph', text: 'Second.', sourceIndex: 3 }
  ]);
  assert.deepEqual(records.map(item => item.paragraphId), [
    'sec-results-p-001', 'sec-results-2-p-001'
  ]);
  assert.deepEqual(records.map(item => item.sourceIndex), [1, 3]);
  assert.notEqual(records[0].headingPath.at(-1).sectionId, records[1].headingPath.at(-1).sectionId);
});

test('preserves H1-H4 ancestry for every extracted paragraph', () => {
  const records = buildParagraphRecords([
    { kind: 'heading', level: 1, text: 'Review' },
    { kind: 'paragraph', text: 'Opening.' },
    { kind: 'heading', level: 2, text: 'Mechanisms' },
    { kind: 'paragraph', text: 'Mechanism overview.' },
    { kind: 'heading', level: 3, text: 'Immune axis' },
    { kind: 'paragraph', text: 'Immune evidence.' },
    { kind: 'heading', level: 2, text: 'Translation' },
    { kind: 'paragraph', text: 'Clinical implications.' }
  ]);
  assert.deepEqual(records[2].headingPath.map(item => item.title), [
    'Review', 'Mechanisms', 'Immune axis'
  ]);
  assert.deepEqual(records[3].headingPath.map(item => item.title), ['Review', 'Translation']);
  assert.equal(records[2].headingLevel, 3);
});

test('attaches extracted paragraph ids to their DOM elements', () => {
  const elements = [
    { tagName: 'H2', textContent: 'Results', dataset: {}, closest: () => null },
    { tagName: 'P', textContent: '  Treatment  improved survival. ', dataset: {}, closest: () => null }
  ];
  const root = { querySelectorAll: () => elements };
  const documentRef = { querySelector: () => root, body: root };
  const records = extractArticle(documentRef);
  assert.equal(records[0].text, 'Treatment improved survival.');
  assert.equal(elements[1].dataset.sciLlmParagraphId, 'sec-results-p-001');
});

test('chooses the content-rich root when a figure-like article appears before the main text', () => {
  const caption = {
    tagName: 'FIGCAPTION',
    textContent: 'Neuronal activity modulation induces synaptic refinement.',
    dataset: {},
    closest: () => null
  };
  const heading = {
    tagName: 'H2',
    textContent: 'Results',
    dataset: {},
    closest: () => null
  };
  const bodyParagraphs = [
    'CNO treatment led to increased c-Fos expression in the ipsilateral MEC compared with the contralateral side.',
    'We next sought to determine whether activity modulation alters synaptic density at the projection site.'
  ].map(textContent => ({
    tagName: 'P',
    textContent,
    dataset: {},
    closest: () => null
  }));
  const figureRoot = { querySelectorAll: () => [caption] };
  const mainRoot = { querySelectorAll: () => [heading, ...bodyParagraphs] };
  const documentRef = {
    querySelector: () => figureRoot,
    querySelectorAll: () => [figureRoot, mainRoot],
    body: mainRoot
  };

  const records = extractArticle(documentRef);

  assert.deepEqual(records.map(item => item.text), bodyParagraphs.map(item => item.textContent));
  assert.equal(caption.dataset.sciLlmParagraphId, undefined);
  assert.equal(bodyParagraphs[0].dataset.sciLlmParagraphId, 'sec-results-p-001');
});

test('reports privacy-safe extraction diagnostics for the selected content root', () => {
  const caption = {
    tagName: 'FIGCAPTION', textContent: 'A figure caption.', dataset: {}, closest: () => null
  };
  const paragraph = {
    tagName: 'P', textContent: 'A full body paragraph with the evidence under discussion.',
    dataset: {}, closest: () => null
  };
  const figureRoot = {
    tagName: 'ARTICLE', id: 'figure-card', className: 'figure-card',
    querySelectorAll: () => [caption], getAttribute: () => null
  };
  const mainRoot = {
    tagName: 'MAIN', id: 'paper', className: 'article-main content',
    querySelectorAll: () => [paragraph], getAttribute: () => null
  };
  const documentRef = {
    querySelectorAll: () => [figureRoot, mainRoot],
    body: mainRoot
  };

  const diagnostics = diagnoseArticleExtraction(documentRef);

  assert.equal(diagnostics.version, '2.1.0-extractor-r12');
  assert.equal(diagnostics.candidateCount, 2);
  assert.equal(diagnostics.selectedRoot, 'MAIN#paper.article-main.content');
  assert.deepEqual(diagnostics.selected, {
    recordCount: 1,
    bodyParagraphCount: 1,
    paragraphCount: 1,
    figureCaptionCount: 0,
    tableCaptionCount: 0,
    referenceCount: 0,
    bodyCharacterCount: paragraph.textContent.length,
    characterCount: paragraph.textContent.length
  });
  assert.equal(JSON.stringify(diagnostics).includes(paragraph.textContent), false);
});

test('diagnostics summarize long unrecognized text containers without exposing text', () => {
  const paragraph = {
    tagName: 'P', textContent: 'A recognized paragraph.', dataset: {}, closest: () => null
  };
  const hiddenBodyText = '1234567890'.repeat(32);
  const unknownBlock = {
    tagName: 'DIV', id: '', className: 'article-body-text', textContent: hiddenBodyText,
    closest: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    getAttribute: () => null
  };
  const mainRoot = {
    tagName: 'MAIN', id: 'main', className: '', getAttribute: () => null,
    querySelectorAll: selector => selector === '*' ? [paragraph, unknownBlock] : [paragraph]
  };
  const documentRef = { querySelectorAll: () => [mainRoot], body: mainRoot };

  const diagnostics = diagnoseArticleExtraction(documentRef);

  assert.equal(diagnostics.unrecognizedTextBlockCount, 1);
  assert.equal(diagnostics.unrecognizedCharacterCount, hiddenBodyText.length);
  assert.deepEqual(diagnostics.unrecognizedTextBlocks, [{
    root: 'DIV.article-body-text',
    count: 1,
    characterCount: hiddenBodyText.length
  }]);
  assert.equal(JSON.stringify(diagnostics).includes(hiddenBodyText), false);
});

test('extracts Science classless DIV paragraphs while excluding citations and references', () => {
  const heading = {
    tagName: 'H2', textContent: 'Results', dataset: {}, closest: () => null
  };
  const bodyText = 'CNO treatment increased neuronal activity and altered synaptic density in the projection site. '.repeat(2).trim();
  const bodyDiv = {
    tagName: 'DIV', id: '', className: '', textContent: bodyText, dataset: {},
    closest: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    getAttribute: () => null
  };
  const citationDiv = {
    tagName: 'DIV', id: '', className: 'citation-content',
    textContent: 'Smith et al. Journal reference content that must not be uploaded.', dataset: {},
    closest: selector => selector.includes('.citation') ? {} : null,
    querySelector: () => null,
    querySelectorAll: () => [],
    getAttribute: () => null
  };
  const referencesHeading = {
    tagName: 'H2', textContent: 'References', dataset: {}, closest: () => null
  };
  const referenceBody = {
    tagName: 'DIV', id: '', className: '',
    textContent: 'A long reference entry after the terminal heading. '.repeat(4), dataset: {},
    closest: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    getAttribute: () => null
  };
  const allElements = [heading, bodyDiv, citationDiv, referencesHeading, referenceBody];
  const root = {
    tagName: 'MAIN', id: 'main', className: '', getAttribute: () => null,
    querySelectorAll: selector => selector === '*'
      ? allElements
      : [heading, referencesHeading]
  };
  const documentRef = { querySelectorAll: () => [root], body: root };

  const records = extractArticle(documentRef);

  assert.deepEqual(records.map(record => record.text), [bodyText]);
  assert.equal(records[0].kind, 'paragraph');
  assert.equal(bodyDiv.dataset.sciLlmParagraphId, 'sec-results-p-001');
  assert.equal(citationDiv.dataset.sciLlmParagraphId, undefined);
  assert.equal(referenceBody.dataset.sciLlmParagraphId, undefined);
});

test('excludes figure captions from LLM extraction and DOM paragraph markers', () => {
  const caption = {
    tagName: 'FIGCAPTION',
    textContent: 'In contrast, neuronal activity caused a significant reduction in synaptic density.',
    dataset: {}, closest: () => null
  };
  const paragraph = {
    tagName: 'P',
    textContent: 'The正文 paragraph remains available for semantic analysis.',
    dataset: {}, closest: () => null
  };
  const root = {
    tagName: 'MAIN', id: 'main', className: '', getAttribute: () => null,
    querySelectorAll: () => [caption, paragraph]
  };
  const documentRef = { querySelectorAll: () => [root], body: root };

  const records = extractArticle(documentRef);

  assert.deepEqual(records.map(record => record.text), [paragraph.textContent]);
  assert.equal(caption.dataset.sciLlmParagraphId, undefined);
  assert.equal(paragraph.dataset.sciLlmParagraphId, 'sec-article-p-001');
});

test('anchors an unsectioned Article node to its first body paragraph', () => {
  const paragraphs = [
    {
      tagName: 'P', id: '', className: '',
      textContent: 'The first body paragraph introduces the scientific perspective.',
      dataset: {}, closest: () => null, querySelector: () => null,
      querySelectorAll: () => [], getAttribute: () => null
    },
    {
      tagName: 'P', id: '', className: '',
      textContent: 'The second body paragraph develops the scientific argument.',
      dataset: {}, closest: () => null, querySelector: () => null,
      querySelectorAll: () => [], getAttribute: () => null
    }
  ];
  const root = {
    tagName: 'DIV', id: '', className: 'article_content',
    textContent: paragraphs.map(item => item.textContent).join(' '),
    querySelectorAll: selector => selector === '*' ? paragraphs : [],
    getAttribute: () => null
  };
  const documentRef = {
    title: 'An unsectioned scientific perspective | ACS Central Science',
    location: { hostname: 'pubs.acs.org' },
    body: root,
    querySelectorAll: selector => selector.includes('.article_content')
      ? [root] : [],
    querySelector: () => root,
    getElementById: () => null
  };

  const structure = extractArticleStructure(documentRef, {
    locationLike: documentRef.location
  });

  assert.equal(structure.nodes[0].title, 'Article');
  assert.equal(
    structure.nodes[0].anchor.dataSelector,
    '[data-sci-llm-paragraph-id="sec-article-p-001"]'
  );
  assert.equal(paragraphs[0].dataset.sciLlmParagraphId, 'sec-article-p-001');
});

test('prefers a clean article body over an ancestor polluted by ScienceDirect navigation', () => {
  const element = (tagName, textContent) => ({
    tagName, textContent, dataset: {}, className: '', id: '',
    closest: () => null, querySelector: () => null, querySelectorAll: () => [],
    getAttribute: () => null
  });
  const bodyElements = [
    element('H2', 'Introduction'),
    element('P', 'Lactylation is introduced as a mechanism of therapeutic resistance in cancer.'),
    element('H2', 'Mechanisms of lactylation-mediated therapeutic resistance'),
    element('P', 'The review integrates evidence across radiotherapy, chemotherapy, targeted therapy, and immunotherapy.')
  ];
  const chromeElements = [
    element('H2', 'Outline'), element('LI', 'Abstract'), element('LI', 'Keywords'),
    element('H2', 'Tables (1)'), element('LI', 'Table 1'),
    element('H2', 'Extras (6)'), element('LI', 'Supplementary data')
  ];
  const articleBody = {
    tagName: 'DIV', id: 'body', className: 'Body',
    querySelectorAll: () => bodyElements, getAttribute: () => null
  };
  const main = {
    tagName: 'MAIN', id: 'main-content', className: '',
    querySelectorAll: () => [...chromeElements, ...bodyElements], getAttribute: () => null
  };
  const documentRef = {
    querySelectorAll: () => [main, articleBody],
    body: main
  };

  assert.equal(selectContentRoot(documentRef), articleBody);
});

test('keeps the complete ScienceDirect body when a single article-body section scores higher', () => {
  const element = (tagName, textContent) => ({
    tagName, textContent, dataset: {}, className: '', id: '',
    closest: () => null, querySelector: () => null, querySelectorAll: () => [],
    getAttribute: () => null
  });
  const scientificSections = [
    'Abstract', 'Introduction', 'Overview of lactylation',
    'Mechanisms of lactylation-mediated therapeutic resistance',
    'Strategies targeting lactylation to overcome tumor therapeutic resistance',
    'Challenges in targeting lactylation'
  ];
  const bodyElements = scientificSections.flatMap(title => [
    element('H2', title),
    element('P', `${title} contains substantive scientific evidence for this review article.`)
  ]);
  const utilityElements = [
    'Outline', 'Keywords', 'Cited by (3)', 'Figures (5)', 'Tables (2)',
    'Author information', 'Article metrics'
  ].map(title => element('H2', title));
  const completeBody = {
    tagName: 'DIV', id: 'body', className: 'Body',
    querySelectorAll: () => [...bodyElements, ...utilityElements],
    getAttribute: () => null
  };
  const selectedSectionElements = bodyElements.slice(8, 10);
  const singleSection = {
    tagName: 'DIV', id: '', className: 'article-body',
    querySelectorAll: () => selectedSectionElements,
    getAttribute: () => null
  };
  const adapter = selectPublisherAdapter({ hostname: 'www.sciencedirect.com' });
  const documentRef = {
    location: { hostname: 'www.sciencedirect.com' },
    querySelectorAll: selector => {
      const matches = [];
      if (selector.includes('#body') || selector.includes('.Body')) matches.push(completeBody);
      if (selector.includes('.article-body')) matches.push(singleSection);
      return [...new Set(matches)];
    },
    body: completeBody
  };

  assert.equal(selectContentRoot(documentRef, adapter), completeBody);
});

test('keeps the complete Elsevier page when Body matches repeated paragraph fragments', () => {
  const headings = [
    'Abstract', 'Introduction', 'Overview of lactylation',
    'Mechanisms of lactylation-mediated therapeutic resistance',
    'Strategies targeting lactylation to overcome tumor therapeutic resistance',
    'Challenges in targeting lactylation'
  ].map((textContent, index) => ({
    tagName: 'H2', textContent, id: `heading-${index}`, className: '',
    dataset: {}, parentElement: null, closest: () => null,
    querySelector: () => null, querySelectorAll: () => [], getAttribute: () => null
  }));
  const fragments = headings.map((heading, index) => ({
    tagName: 'DIV',
    textContent: `${heading.textContent} contains substantive scientific evidence and a complete review argument.`,
    id: '', className: 'Body', dataset: {}, parentElement: null,
    closest: () => null, querySelector: () => null,
    querySelectorAll: () => [], getAttribute: () => null,
    index
  }));
  const orderedElements = headings.flatMap((heading, index) => [heading, fragments[index]]);
  const completePage = {
    tagName: 'MAIN', id: 'main-content', className: '',
    textContent: orderedElements.map(item => item.textContent).join(' '),
    querySelectorAll: selector => {
      if (selector === '*') return orderedElements;
      if (selector === '.Body') return fragments;
      if (selector.includes('h1') || selector.includes('[role="heading"]')) return headings;
      return [];
    },
    getAttribute: () => null,
    contains: candidate => fragments.includes(candidate) || headings.includes(candidate)
  };
  headings.forEach(item => { item.parentElement = completePage; });
  fragments.forEach(item => { item.parentElement = completePage; });
  const adapter = selectPublisherAdapter({ hostname: 'www.sciencedirect.com' });
  const documentRef = {
    title: 'Complete ScienceDirect review',
    location: { hostname: 'www.sciencedirect.com' },
    body: completePage,
    querySelectorAll: selector => {
      if (selector === '.Body') return fragments;
      if (selector.includes('.Body')) return [completePage, ...fragments];
      if (selector.includes('main')) return [completePage];
      return [];
    },
    querySelector: () => completePage,
    getElementById: () => null
  };

  assert.equal(selectContentRoot(documentRef, adapter), completePage);
  const structure = extractArticleStructure(documentRef, {
    locationLike: documentRef.location
  });
  assert.equal(structure.diagnostics.headingCount, headings.length);
  assert.equal(structure.diagnostics.paragraphCount, fragments.length);
});

test('extracts classed DIV prose blocks used by Cell Press reviews', () => {
  const sectionTitles = [
    'Amyloid', 'APOE', 'Immune system',
    'Biomarkers', 'Neuroinflammation biomarkers', 'Therapeutics'
  ];
  const elements = sectionTitles.flatMap((title, index) => {
    const heading = {
      tagName: index % 2 ? 'H3' : 'H2', textContent: title,
      id: `cell-heading-${index}`, className: '', dataset: {},
      parentElement: null, closest: () => null, querySelector: () => null,
      querySelectorAll: () => [], getAttribute: () => null
    };
    const paragraph = {
      tagName: 'DIV', className: 'Paragraph', id: '', dataset: {},
      textContent: `${title} is discussed using multiple lines of evidence, biomarkers, mechanisms, and therapeutic implications.`,
      parentElement: null, closest: () => null, querySelector: () => null,
      querySelectorAll: () => [], getAttribute: () => null
    };
    return [heading, paragraph];
  });
  const root = {
    tagName: 'ARTICLE', id: 'cell-fulltext', className: 'article-content',
    textContent: elements.map(item => item.textContent).join(' '),
    querySelectorAll: selector => selector === '*' ? elements : [],
    getAttribute: () => null
  };
  elements.forEach(item => { item.parentElement = root; });
  const documentRef = {
    title: 'Recent advances in Alzheimer disease',
    location: { hostname: 'www.cell.com' }, body: root,
    querySelectorAll: selector => selector.includes('article') ? [root] : [],
    querySelector: () => root,
    getElementById: () => null
  };

  const structure = extractArticleStructure(documentRef, {
    locationLike: documentRef.location
  });

  const flattenedTitles = [];
  const collectTitles = nodes => nodes.forEach(node => {
    flattenedTitles.push(node.title);
    collectTitles(node.children || []);
  });
  collectTitles(structure.nodes);
  assert.deepEqual(flattenedTitles, sectionTitles);
  assert.equal(structure.diagnostics.headingCount, sectionTitles.length);
  assert.equal(structure.diagnostics.paragraphCount, sectionTitles.length);
});

test('recognizes deep and ARIA section headings instead of flattening their paragraphs', () => {
  const heading = (tagName, textContent, role = null, ariaLevel = null) => ({
    tagName, textContent, dataset: {}, className: '', id: '',
    closest: () => null, querySelector: () => null, querySelectorAll: () => [],
    getAttribute: name => name === 'role' ? role : (name === 'aria-level' ? ariaLevel : null)
  });
  const h5 = heading('H5', 'Lactylation and ferroptosis');
  const ariaHeading = heading('DIV', 'Immune checkpoint resistance', 'heading', '4');
  const paragraph = heading('P', 'This subsection integrates the relevant mechanistic evidence.');
  const root = {
    tagName: 'ARTICLE', id: 'paper', className: '', getAttribute: () => null,
    querySelectorAll: () => [h5, paragraph, ariaHeading, paragraph]
  };
  const documentRef = { querySelectorAll: () => [root], body: root };

  const records = extractArticle(documentRef);

  assert.equal(records[0].sectionTitle, 'Lactylation and ferroptosis');
  assert.equal(records[0].headingLevel, 5);
  assert.equal(records[1].sectionTitle, 'Immune checkpoint resistance');
  assert.equal(records[1].headingLevel, 4);
});

test('prepares a review outline from scientific sections while removing ScienceDirect chrome', () => {
  const records = buildParagraphRecords([
    { kind: 'heading', level: 1, text: 'Article' },
    { kind: 'paragraph', text: 'Navigation and access controls.' },
    { kind: 'heading', level: 1, text: 'Outline' },
    { kind: 'paragraph', text: 'Abstract Keywords Introduction Tables Extras' },
    { kind: 'heading', level: 1, text: 'Tables (1)' },
    { kind: 'table-caption', text: 'Table 1' },
    { kind: 'heading', level: 1, text: 'Extras (6)' },
    { kind: 'paragraph', text: 'Supplementary files and downloads.' },
    { kind: 'heading', level: 1, text: 'Review ArticleLactylation-driven therapeutic resistance in cancer' },
    { kind: 'paragraph', text: 'Author links open overlay panel.' },
    { kind: 'heading', level: 2, text: 'Abstract' },
    { kind: 'paragraph', text: 'The review integrates lactylation mechanisms and therapeutic opportunities.' },
    { kind: 'heading', level: 2, text: 'Mechanisms of lactylation-mediated therapeutic resistance' },
    { kind: 'heading', level: 3, text: 'Radiotherapy resistance' },
    { kind: 'paragraph', text: 'Histone and non-histone lactylation can enhance DNA damage repair.' },
    { kind: 'heading', level: 2, text: 'References' },
    { kind: 'paragraph', text: 'A reference that must never be included.' }
  ]);

  const prepared = prepareReviewOutlineParagraphs(records, {
    articleTitle: 'Lactylation-driven therapeutic resistance in cancer - ScienceDirect'
  });

  assert.deepEqual(prepared.map(item => item.sectionTitle), [
    'Abstract', 'Radiotherapy resistance'
  ]);
  assert.deepEqual(prepared[1].headingPath.map(item => item.title), [
    'Mechanisms of lactylation-mediated therapeutic resistance',
    'Radiotherapy resistance'
  ]);
  assert.equal(prepared.some(item => /Outline|Tables|Extras|Author links/.test(item.text)), false);
});

test('uses ScienceDirect outline anchors to recover every linked body section and exclude article cards', () => {
  const makeElement = (tagName, textContent, parentElement = null) => ({
    tagName, textContent, parentElement, dataset: {}, className: '', id: '',
    closest: () => null, querySelector: () => null, querySelectorAll: () => [],
    getAttribute: () => null
  });
  const sectionTitles = [
    'Abstract', 'Introduction', 'Overview of lactylation',
    'Lactylation enhances cellular adaptation and promotes cancer progression',
    'Mechanisms of lactylation-mediated therapeutic resistance',
    'Strategies targeting lactylation to overcome tumor therapeutic resistance',
    'Challenges in targeting lactylation', 'Conclusions and perspectives'
  ];
  const targets = new Map();
  const links = sectionTitles.map((title, index) => {
    const target = {
      tagName: 'SECTION', id: `sec-${index + 1}`, className: '', parentElement: null,
      getAttribute: () => null, contains: other => other === target
    };
    const heading = makeElement('H2', title, target);
    const paragraph = makeElement(
      'P', `${title} contains substantive review evidence, mechanisms, limitations, and implications.`,
      target
    );
    target.querySelectorAll = () => [heading, paragraph];
    target.querySelector = () => heading;
    targets.set(target.id, target);
    return {
      tagName: 'A', textContent: title,
      getAttribute: name => name === 'href' ? `#${target.id}` : null
    };
  });
  const utilityTitles = ['Keywords', 'CRediT authorship contribution statement', 'References'];
  utilityTitles.forEach((title, index) => {
    const target = {
      tagName: 'SECTION', id: `utility-${index + 1}`, className: '', parentElement: null,
      getAttribute: () => null, contains: other => other === target
    };
    const heading = makeElement('H2', title, target);
    const paragraph = makeElement('P', `${title} metadata must be excluded from the review.`, target);
    target.querySelectorAll = () => [heading, paragraph];
    target.querySelector = () => heading;
    targets.set(target.id, target);
    links.push({
      tagName: 'A', textContent: title,
      getAttribute: name => name === 'href' ? `#${target.id}` : null
    });
  });

  const unrelatedTitles = [
    'Lysine Lactylation: Dynamic Regulation in the Tumor Microenvironment and Clinical Translational Prospects',
    'Novel Cellular Signalling Axes in Neurodegenerative Diseases'
  ];
  const genericElements = [];
  [sectionTitles[0], sectionTitles[5], ...unrelatedTitles].forEach(title => {
    genericElements.push(makeElement('H2', title));
    genericElements.push(makeElement('P', `${title} card or partial page text.`));
  });
  const main = {
    tagName: 'MAIN', id: 'main-content', className: '', getAttribute: () => null,
    querySelectorAll: () => genericElements
  };
  const documentRef = {
    body: main,
    querySelectorAll: selector => selector.includes('a[href^="#"]') ? links : [main],
    getElementById: id => targets.get(id) || null
  };

  const records = extractArticle(documentRef);
  const diagnostics = diagnoseArticleExtraction(documentRef);

  assert.deepEqual([...new Set(records.map(item => item.sectionTitle))], sectionTitles);
  assert.equal(records.some(item => unrelatedTitles.includes(item.sectionTitle)), false);
  assert.equal(records.some(item => utilityTitles.includes(item.sectionTitle)), false);
  assert.equal(records.length, sectionTitles.length);
  assert.equal(diagnostics.strategy, 'outline-anchors');
  assert.equal(diagnostics.selectedRoot, 'OUTLINE_ANCHORS');
  assert.equal(diagnostics.selected.recordCount, sectionTitles.length);
});

test('accepts ScienceDirect outline targets that point directly to headings', () => {
  const targets = new Map();
  const links = [];
  ['Abstract', 'Introduction', 'Overview of lactylation'].forEach((title, index) => {
    const section = {
      tagName: 'DIV', id: `section-${index}`, className: 'article-section',
      parentElement: null, dataset: {}, getAttribute: () => null,
      contains(other) { return other === section || other?.parentElement === section; }
    };
    const heading = {
      tagName: 'H2', id: `heading-${index}`, textContent: title,
      className: '', parentElement: section, dataset: {},
      closest: () => null, querySelector: () => null, querySelectorAll: () => [],
      getAttribute: () => null
    };
    const paragraph = {
      tagName: 'P',
      textContent: (
        `${title} contains enough substantive scientific review text for extraction. `
      ).repeat(2),
      className: '', id: '', parentElement: section, dataset: {},
      closest: () => null, querySelector: () => null, querySelectorAll: () => [],
      getAttribute: () => null
    };
    section.querySelectorAll = () => [heading, paragraph];
    section.querySelector = () => heading;
    targets.set(heading.id, heading);
    links.push({
      tagName: 'A', textContent: title, parentElement: null,
      getAttribute: name => name === 'href' ? `#${heading.id}` : null
    });
  });
  const main = {
    tagName: 'MAIN', id: 'main', className: '', parentElement: null,
    getAttribute: () => null, querySelectorAll: () => []
  };
  const documentRef = {
    location: { hostname: 'www.sciencedirect.com' },
    body: main,
    querySelectorAll: selector => selector.includes('a[href^="#"]') ? links : [main],
    getElementById: id => targets.get(id) || null
  };

  const structure = extractArticleStructure(documentRef, {
    locationLike: documentRef.location
  });

  assert.deepEqual(structure.nodes.map(node => node.title), [
    'Abstract', 'Introduction', 'Overview of lactylation'
  ]);
  assert.equal(structure.adapterId, 'elsevier-sciencedirect');
  assert.equal(structure.paragraphs.length, 3);
});

test('marks the exact outline heading so source jumps avoid oversized section containers', () => {
  const targets = new Map();
  const links = [];
  const headings = [];
  ['Abstract', 'Introduction', 'Results'].forEach((title, index) => {
    const section = {
      tagName: 'SECTION', id: `section-${index}`, className: 'bodySection',
      parentElement: null, dataset: {}, getAttribute: () => null,
      contains(other) { return other === section || other?.parentElement === section; }
    };
    const heading = {
      tagName: 'H2', id: '', textContent: title, className: 'section__title',
      parentElement: section, dataset: {},
      closest: () => null, querySelector: () => null,
      querySelectorAll: () => [], getAttribute: () => null
    };
    const paragraph = {
      tagName: 'P', id: '', className: '',
      textContent: (
        `${title} contains a substantive scientific paragraph for testing. `
      ).repeat(2),
      parentElement: section, dataset: {},
      closest: () => null, querySelector: () => null,
      querySelectorAll: () => [], getAttribute: () => null
    };
    section.querySelectorAll = selector => selector === '*'
      ? [heading, paragraph] : [];
    section.querySelector = () => heading;
    targets.set(section.id, section);
    headings.push(heading);
    links.push({
      tagName: 'A', textContent: title, parentElement: null,
      getAttribute: name => name === 'href' ? `#${section.id}` : null
    });
  });
  const main = {
    tagName: 'MAIN', id: 'main', className: 'content',
    querySelectorAll: () => [], getAttribute: () => null
  };
  const documentRef = {
    title: 'AAAS fixture',
    location: { hostname: 'spj.science.org' },
    body: main,
    querySelectorAll: selector => selector.includes('a[href^="#"]')
      ? links : [main],
    getElementById: id => targets.get(id) || null,
    querySelector: () => main
  };

  const structure = extractArticleStructure(documentRef, {
    locationLike: documentRef.location
  });

  assert.match(
    structure.nodes[1].anchor.dataSelector,
    /^\[data-sci-llm-heading-id="outline-introduction-\d+"\]$/
  );
  assert.equal(
    headings[1].dataset.sciLlmHeadingId,
    structure.nodes[1].anchor.dataSelector.match(/"([^"]+)"/)[1]
  );
});

test('applies publisher-specific excluded selectors to collateral author headings', () => {
  const makeElement = (tagName, textContent, excluded = false) => ({
    tagName,
    id: '',
    className: '',
    textContent,
    parentElement: null,
    dataset: {},
    closest: selector => excluded && selector === '.core-authors' ? {} : null,
    querySelector: () => null,
    querySelectorAll: () => [],
    getAttribute: () => null
  });
  const elements = [
    makeElement('H2', 'Results'),
    makeElement('P', 'The treatment produced a reproducible scientific result.'),
    makeElement('H5', 'Xiao-Kai Chi', true),
    makeElement('P', 'Department and correspondence information.', true)
  ];
  const root = {
    tagName: 'MAIN', id: 'main', className: 'content',
    textContent: elements.map(item => item.textContent).join(' '),
    querySelectorAll: selector => selector === '*' ? elements : [],
    getAttribute: () => null
  };
  const documentRef = {
    title: 'AAAS article fixture',
    location: { hostname: 'spj.science.org' },
    body: root,
    querySelectorAll: selector => selector.includes('main.content') ? [root] : [],
    querySelector: () => root,
    getElementById: () => null
  };

  const structure = extractArticleStructure(documentRef, {
    locationLike: documentRef.location
  });

  assert.deepEqual(structure.nodes.map(node => node.title), ['Results']);
  assert.deepEqual(structure.paragraphs.map(item => item.text), [
    'The treatment produced a reproducible scientific result.'
  ]);
});

test('uses publisher-specific article roots before the generic semantic fallback', () => {
  const cases = [
    ['www.nature.com', '.c-article-body', 'springer-nature'],
    ['onlinelibrary.wiley.com', '.article__body', 'wiley'],
    ['academic.oup.com', '.widget-ArticleFulltext', 'oup'],
    ['www.mdpi.com', 'article.bright', 'mdpi'],
    ['pmc.ncbi.nlm.nih.gov', '#mc', 'pmc-jats']
  ];

  for (const [hostname, rootSelector, family] of cases) {
    const elements = [
      {
        tagName: 'H2',
        id: 'results',
        textContent: 'Results',
        dataset: {},
        closest: () => null,
        querySelector: () => null
      },
      {
        tagName: 'P',
        textContent: 'This publisher-specific body paragraph contains enough scientific evidence.',
        dataset: {},
        closest: () => null,
        querySelector: () => null
      }
    ];
    const root = {
      tagName: 'ARTICLE',
      id: 'publisher-body',
      className: rootSelector.replace(/^[.#]/, ''),
      querySelectorAll: selector => selector === '*' ? elements : [],
      getAttribute: () => null
    };
    const documentRef = {
      title: 'Publisher fixture',
      location: { hostname },
      body: { querySelectorAll: () => [] },
      getElementById: () => null,
      querySelectorAll: selector => selector.includes(rootSelector) ? [root] : [],
      querySelector: selector => selector.includes(rootSelector) ? root : null
    };

    const structure = extractArticleStructure(documentRef, {
      locationLike: documentRef.location
    });
    assert.equal(structure.publisherFamily, family, hostname);
    assert.equal(structure.strategy, 'root-scoring', hostname);
    assert.equal(structure.diagnostics.paragraphCount, 1, hostname);
  }
});

test('rejects browser security challenges instead of exposing them as article sections', () => {
  const heading = {
    tagName: 'H1',
    id: '',
    className: '',
    textContent: 'Are you a robot?',
    dataset: {},
    closest: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    getAttribute: () => null
  };
  const paragraph = {
    tagName: 'P',
    id: '',
    className: '',
    textContent: 'Please confirm you are a human by completing the captcha challenge below.',
    dataset: {},
    closest: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    getAttribute: () => null
  };
  const main = {
    tagName: 'MAIN',
    id: 'main-content',
    className: '',
    textContent: `${heading.textContent} ${paragraph.textContent}`,
    querySelectorAll: selector => selector === '*' ? [heading, paragraph] : [],
    getAttribute: () => null
  };
  const documentRef = {
    title: '请稍候…',
    location: { hostname: 'www.sciencedirect.com' },
    body: main,
    getElementById: () => null,
    querySelectorAll: () => [main],
    querySelector: () => main
  };

  const structure = extractArticleStructure(documentRef, {
    locationLike: documentRef.location
  });

  assert.equal(structure.diagnostics.headingCount, 0);
  assert.equal(structure.diagnostics.paragraphCount, 0);
  assert.ok(structure.diagnostics.warnings.includes('NON_ARTICLE_CHALLENGE'));
});

test('rejects short publisher access-denied pages instead of treating them as articles', () => {
  const heading = {
    tagName: 'H1', textContent: 'Access Denied', dataset: {}, id: '', className: '',
    closest: () => null, querySelector: () => null, querySelectorAll: () => [], getAttribute: () => null
  };
  const paragraph = {
    tagName: 'P', textContent: 'There was a problem providing the content you requested.', dataset: {}, id: '', className: '',
    closest: () => null, querySelector: () => null, querySelectorAll: () => [], getAttribute: () => null
  };
  const body = {
    tagName: 'MAIN', textContent: `${heading.textContent} ${paragraph.textContent}`,
    querySelectorAll: selector => selector === '*' ? [heading, paragraph] : [], getAttribute: () => null
  };
  const structure = extractArticleStructure({
    title: 'Access Denied', location: { hostname: 'www.mdpi.com' }, body,
    getElementById: () => null, querySelectorAll: () => [body], querySelector: () => body
  });
  assert.equal(structure.paragraphs.length, 0);
  assert.ok(structure.diagnostics.warnings.includes('NON_ARTICLE_CHALLENGE'));
});

test('does not send browser security challenge text into article analysis', () => {
  const heading = {
    tagName: 'H2',
    textContent: '正在进行安全验证',
    dataset: {},
    closest: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    getAttribute: () => null
  };
  const paragraph = {
    tagName: 'P',
    textContent: '本网站使用安全服务防护恶意自动程序。',
    dataset: {},
    closest: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    getAttribute: () => null
  };
  const body = {
    tagName: 'MAIN',
    textContent: `${heading.textContent} ${paragraph.textContent}`,
    querySelectorAll: selector => selector === '*' ? [heading, paragraph] : [],
    getAttribute: () => null
  };
  const documentRef = {
    title: '请稍候…',
    location: { hostname: 'onlinelibrary.wiley.com' },
    body,
    querySelectorAll: () => [body],
    querySelector: () => body
  };

  assert.deepEqual(extractArticle(documentRef), []);
});

test('uses publisher paragraph selectors for MDPI DIV-based body paragraphs', () => {
  const heading = {
    tagName: 'H2',
    id: 'sec-introduction',
    className: 'html-h2',
    textContent: '1. Introduction',
    dataset: {},
    closest: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    getAttribute: () => null
  };
  const paragraphTexts = [
    'Evidence-based medicine integrates research evidence with clinical expertise and patient preferences.',
    'Precision medicine requires careful evaluation of heterogeneous data and individual treatment goals.'
  ];
  const paragraphs = paragraphTexts.map((textContent, index) => ({
    tagName: 'DIV',
    id: `html-p-${index + 1}`,
    className: 'html-p',
    textContent,
    dataset: {},
    closest: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    getAttribute: () => null
  }));
  const root = {
    tagName: 'ARTICLE',
    id: 'article',
    className: 'bright',
    textContent: `${heading.textContent} ${paragraphTexts.join(' ')}`,
    querySelectorAll: selector => {
      if (selector === '*') return [heading, ...paragraphs];
      if (selector.includes('.html-p')) return paragraphs;
      if (selector.includes('.html-h2')) return [heading];
      return [];
    },
    getAttribute: () => null
  };
  const documentRef = {
    title: 'Evidence-Based Medicine: Past, Present, Future',
    location: { hostname: 'www.mdpi.com' },
    body: root,
    getElementById: () => null,
    querySelectorAll: selector => selector.includes('article') ? [root] : [],
    querySelector: selector => selector.includes('article') ? root : null
  };

  const structure = extractArticleStructure(documentRef, {
    locationLike: documentRef.location
  });

  assert.equal(structure.publisherFamily, 'mdpi');
  assert.equal(structure.strategy, 'root-scoring');
  assert.deepEqual(structure.paragraphs.map(item => item.text), paragraphTexts);
});

test('falls back to the article root when outline targets overlap the same container', () => {
  const targets = new Map();
  const links = [];
  const root = {
    tagName: 'MAIN',
    id: 'article-main',
    className: 'ArticleDetailsV4__main',
    parentElement: null,
    dataset: {},
    getAttribute: () => null,
    contains: element => element === root || element?.parentElement === root
  };
  const elements = [];
  [
    ['Abstract', 'The review summarizes the central mechanistic evidence.'],
    ['1 Introduction', 'The introduction defines the disease context and unresolved questions.'],
    ['2 Metabolism', 'The section explains glucose, lipid, and amino-acid reprogramming.']
  ].forEach(([title, paragraphText], index) => {
    const heading = {
      tagName: 'H2',
      id: `section-${index + 1}`,
      className: '',
      textContent: title,
      parentElement: root,
      dataset: {},
      closest: selector => String(selector).startsWith('section,article') ? root : null,
      querySelector: () => null,
      querySelectorAll: () => [],
      getAttribute: () => null
    };
    const paragraph = {
      tagName: 'P',
      id: '',
      className: '',
      textContent: paragraphText,
      parentElement: root,
      dataset: {},
      closest: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      getAttribute: () => null
    };
    elements.push(heading, paragraph);
    targets.set(heading.id, heading);
    links.push({
      tagName: 'A',
      textContent: title,
      getAttribute: name => name === 'href' ? `#${heading.id}` : null
    });
  });
  root.textContent = elements.map(item => item.textContent).join(' ');
  root.querySelector = () => elements[0];
  root.querySelectorAll = selector => {
    if (selector === '*') return elements;
    if (selector.includes('a[')) return links;
    if (selector.includes('h1') || selector.includes('.JournalFullText h2')) {
      return elements.filter(item => item.tagName === 'H2');
    }
    if (selector.includes('.JournalFullText p') || selector === 'p') {
      return elements.filter(item => item.tagName === 'P');
    }
    return [];
  };
  const documentRef = {
    title: 'Metabolic reprogramming review',
    location: { hostname: 'www.frontiersin.org' },
    body: root,
    getElementById: id => targets.get(id) || null,
    querySelectorAll: selector => selector.includes('a[') ? links : [root],
    querySelector: () => root
  };

  const structure = extractArticleStructure(documentRef, {
    locationLike: documentRef.location
  });

  assert.equal(structure.strategy, 'root-scoring');
  assert.equal(structure.diagnostics.paragraphCount, 3);
  assert.deepEqual(structure.nodes.map(node => node.title), [
    'Abstract', '1 Introduction', '2 Metabolism'
  ]);
});

test('falls back to the article root when publisher outline links omit many body headings', () => {
  const sectionTitles = [
    'Abstract', 'Introduction', 'First analysis', 'Second analysis',
    'Third analysis', 'Discussion', 'Conclusions'
  ];
  const targets = new Map();
  const links = [];
  const allElements = [];
  sectionTitles.forEach((title, index) => {
    const section = {
      tagName: 'SECTION', id: `section-${index}`, className: 'section',
      parentElement: null, dataset: {}, getAttribute: () => null,
      contains(other) { return other === section || other?.parentElement === section; }
    };
    const heading = {
      tagName: 'H2', id: '', className: '', textContent: title,
      parentElement: section, dataset: {}, closest: () => null,
      querySelector: () => null, querySelectorAll: () => [],
      getAttribute: () => null
    };
    const paragraph = {
      tagName: 'P', id: '', className: '',
      textContent: (
        `${title} contains substantive scientific body text and evidence. `
      ).repeat(3),
      parentElement: section, dataset: {}, closest: () => null,
      querySelector: () => null, querySelectorAll: () => [],
      getAttribute: () => null
    };
    section.querySelectorAll = selector => selector === '*'
      ? [heading, paragraph] : [];
    section.querySelector = () => heading;
    targets.set(section.id, section);
    allElements.push(heading, paragraph);
    if (index < 3) {
      links.push({
        tagName: 'A', textContent: title, parentElement: null,
        getAttribute: name => name === 'href' ? `#${section.id}` : null
      });
    }
  });
  const root = {
    tagName: 'DIV', id: '', className: 'highwire-markup',
    textContent: allElements.map(item => item.textContent).join(' '),
    querySelectorAll: selector => selector === '*' ? allElements : [],
    getAttribute: () => null
  };
  const documentRef = {
    title: 'Complete preprint fixture',
    location: { hostname: 'www.biorxiv.org' },
    body: root,
    querySelectorAll: selector => selector.includes('a[href^="#"]')
      ? links : (selector.includes('.highwire-markup') ? [root] : []),
    querySelector: () => root,
    getElementById: id => targets.get(id) || null
  };

  const structure = extractArticleStructure(documentRef, {
    locationLike: documentRef.location
  });

  assert.equal(structure.strategy, 'root-scoring');
  assert.deepEqual(structure.nodes.map(node => node.title), sectionTitles);
});

test('omits skip links and figure labels without breaking the surrounding section', () => {
  const makeElement = (tagName, textContent) => ({
    tagName,
    id: '',
    className: '',
    textContent,
    parentElement: null,
    dataset: {},
    closest: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    getAttribute: () => null
  });
  const elements = [
    makeElement('H2', 'Skip to main content'),
    makeElement('H2', 'Introduction'),
    makeElement('P', 'The introduction establishes the scientific context.'),
    makeElement('H3', 'Figure 1. Study workflow'),
    makeElement('P', 'The mechanistic interpretation continues after the displayed figure.'),
    makeElement('H2', 'Results'),
    makeElement('P', 'The results describe the primary experimental findings.')
  ];
  const root = {
    tagName: 'MAIN',
    id: 'article-main',
    className: '',
    textContent: elements.map(item => item.textContent).join(' '),
    querySelectorAll: selector => selector === '*' ? elements : [],
    getAttribute: () => null
  };
  const documentRef = {
    title: 'Study title',
    location: { hostname: 'journal.example' },
    body: root,
    getElementById: () => null,
    querySelectorAll: () => [root],
    querySelector: () => root
  };

  const structure = extractArticleStructure(documentRef, {
    locationLike: documentRef.location
  });

  assert.deepEqual(structure.nodes.map(node => node.title), [
    'Introduction', 'Results'
  ]);
  assert.deepEqual(
    structure.paragraphs.filter(item => item.sectionTitle === 'Introduction')
      .map(item => item.text),
    [
      'The introduction establishes the scientific context.',
      'The mechanistic interpretation continues after the displayed figure.'
    ]
  );
});

test('does not wrap the section tree under the article title heading', () => {
  const makeElement = (tagName, textContent) => ({
    tagName,
    id: '',
    className: '',
    textContent,
    parentElement: null,
    dataset: {},
    closest: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    getAttribute: () => null
  });
  const title = 'Adsorptive removal of fluoride from water using hydroxyapatite';
  const elements = [
    makeElement('H1', title),
    makeElement('H2', 'Abstract'),
    makeElement('P', 'The abstract summarizes the adsorption study and its primary findings.'),
    makeElement('H2', 'Introduction'),
    makeElement('P', 'The introduction explains the need for fluoride removal from water.')
  ];
  const root = {
    tagName: 'MAIN',
    id: 'article-main',
    className: '',
    textContent: elements.map(item => item.textContent).join(' '),
    querySelectorAll: selector => selector === '*' ? elements : [],
    getAttribute: () => null
  };
  const documentRef = {
    title: `${title} | Scientific Reports`,
    location: { hostname: 'www.nature.com' },
    body: root,
    getElementById: () => null,
    querySelectorAll: () => [root],
    querySelector: () => root
  };

  const structure = extractArticleStructure(documentRef, {
    locationLike: documentRef.location
  });

  assert.deepEqual(structure.nodes.map(node => node.title), [
    'Abstract', 'Introduction'
  ]);
});

test('prefers a publisher article body over a larger generic page wrapper', () => {
  const element = (tagName, textContent) => ({
    tagName,
    textContent,
    id: '',
    className: '',
    dataset: {},
    closest: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    getAttribute: () => null
  });
  const articleElements = [
    element('H2', 'Introduction'),
    element('P', 'The article body contains the scientific introduction and study context.'),
    element('H2', 'Results'),
    element('P', 'The results report the main evidence and quantitative findings.')
  ];
  const wrapperElements = [
    ...articleElements,
    ...Array.from({ length: 8 }, (_, index) =>
      element('P', `Navigation card ${index + 1} contains unrelated recommendation text.`))
  ];
  const articleBody = {
    tagName: 'DIV',
    id: 'artText',
    className: 'article-text',
    querySelectorAll: () => articleElements,
    getAttribute: () => null
  };
  const wrapper = {
    tagName: 'MAIN',
    id: 'main-content',
    className: '',
    querySelectorAll: () => wrapperElements,
    getAttribute: () => null
  };
  const documentRef = {
    location: { hostname: 'journals.plos.org' },
    body: wrapper,
    querySelectorAll: selector => selector === '#artText' || selector === '.article-text'
      ? [articleBody] : (selector.includes('#artText') ? [wrapper, articleBody] : [wrapper]),
    querySelector: () => wrapper
  };
  const adapter = selectPublisherAdapter(documentRef.location);

  assert.equal(selectContentRoot(documentRef, adapter), articleBody);
});

test('removes duplicate article titles and preamble labels before body sections', () => {
  const makeElement = (tagName, textContent) => ({
    tagName,
    id: '',
    className: '',
    textContent,
    parentElement: null,
    dataset: {},
    closest: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    getAttribute: () => null
  });
  const title = 'Expectations for Mendelian randomization research in PLOS One';
  const elements = [
    makeElement('H1', 'Article'),
    makeElement('P', 'Authors metrics comments and media coverage.'),
    makeElement('H1', title),
    makeElement('P', 'Author affiliations and publication metadata.'),
    makeElement('H1', title),
    makeElement('H2', 'Figures'),
    makeElement('P', 'Figure navigation and image metadata.'),
    makeElement('H2', 'Introduction'),
    makeElement('P', 'The introduction defines the reporting problem.'),
    makeElement('H2', 'Results'),
    makeElement('P', 'The results quantify the growth of problematic studies.')
  ];
  const root = {
    tagName: 'DIV',
    id: 'artText',
    className: 'article-text',
    textContent: elements.map(item => item.textContent).join(' '),
    querySelectorAll: selector => selector === '*' ? elements : [],
    getAttribute: () => null
  };
  const documentRef = {
    title: `${title} | PLOS One`,
    location: { hostname: 'journals.plos.org' },
    body: root,
    getElementById: () => null,
    querySelectorAll: selector => selector === '#artText' ||
      selector === '.article-text' ? [root] : [],
    querySelector: () => root
  };

  const structure = extractArticleStructure(documentRef, {
    locationLike: documentRef.location
  });

  assert.deepEqual(structure.nodes.map(node => node.title), [
    'Introduction', 'Results'
  ]);
  assert.deepEqual(structure.paragraphs.map(item => item.text), [
    'The introduction defines the reporting problem.',
    'The results quantify the growth of problematic studies.'
  ]);
});

test('drops generic preamble paragraphs when explicit body sections exist', () => {
  const makeElement = (tagName, textContent) => ({
    tagName,
    id: '',
    className: '',
    textContent,
    parentElement: null,
    dataset: {},
    closest: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    getAttribute: () => null
  });
  const elements = [
    makeElement('P', 'Authors, metrics, publication date, and article navigation.'),
    makeElement('H2', 'Introduction'),
    makeElement('P', 'The introduction contains the first scientific body paragraph.'),
    makeElement('H2', 'Results'),
    makeElement('P', 'The results contain the second scientific body paragraph.')
  ];
  const root = {
    tagName: 'DIV',
    id: 'artText',
    className: 'article-text',
    textContent: elements.map(item => item.textContent).join(' '),
    querySelectorAll: selector => selector === '*' ? elements : [],
    getAttribute: () => null
  };
  const documentRef = {
    title: 'A structured research article | PLOS One',
    location: { hostname: 'journals.plos.org' },
    body: root,
    getElementById: () => null,
    querySelectorAll: selector => selector === '#artText' ||
      selector === '.article-text' ? [root] : [],
    querySelector: () => root
  };

  const structure = extractArticleStructure(documentRef, {
    locationLike: documentRef.location
  });
  const diagnostics = diagnoseArticleExtraction(documentRef);

  assert.deepEqual(structure.nodes.map(node => node.title), [
    'Introduction', 'Results'
  ]);
  assert.equal(structure.paragraphs.some(item => item.sectionTitle === 'Article'), false);
  assert.equal(diagnostics.selected.recordCount, structure.paragraphs.length);
});

test('ignores Cell author and footnote anchors when global hash links are inspected', () => {
  const makeTarget = (tagName, id, textContent, parentElement = null) => ({
    tagName, id, className: '', textContent, parentElement, dataset: {},
    closest: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    getAttribute: name => name === 'id' ? id : null
  });
  const articleRoot = makeTarget('ARTICLE', 'main-content', 'Summary Introduction Results');
  const sectionSpecs = [
    ['sec-summary', 'Summary', 'This summary states the central biological question and describes how peripheral heat sensing can influence systemic metabolic physiology in the reported experiments.'],
    ['sec-introduction', 'Introduction', 'The introduction explains the heat-stress context, the unresolved neuroendocrine mechanism, and why the authors investigated communication between skin and hypothalamus.'],
    ['sec-results', 'Results', 'The results establish the skin-hypothalamus signaling axis and report the perturbation, rescue, and metabolic measurements that support the principal conclusion.']
  ];
  const targets = new Map();
  const links = [];
  sectionSpecs.forEach(([id, title, paragraph]) => {
    const section = makeTarget('SECTION', id, `${title} ${paragraph}`, articleRoot);
    const heading = makeTarget('H2', `${id}-heading`, title, section);
    const body = makeTarget('P', '', paragraph, section);
    section.contains = other => other === section || other?.parentElement === section;
    section.querySelector = () => heading;
    section.querySelectorAll = () => [heading, body];
    targets.set(id, section);
    links.push({
      tagName: 'A', textContent: title,
      getAttribute: name => name === 'href' ? `#${id}` : null
    });
  });
  const authorCard = makeTarget('DIV', 'author-group', 'Hai-Yan Zhou Author affiliations and publication metadata.', articleRoot);
  const authorTarget = makeTarget('A', 'au1', 'Hai-Yan Zhou', authorCard);
  authorCard.querySelectorAll = selector => selector === '*' ? [
    authorTarget,
    makeTarget('P', '', 'Author affiliations and publication metadata.', authorCard)
  ] : [];
  targets.set('au1', authorTarget);
  links.push({ tagName: 'A', textContent: 'Hai-Yan Zhou', getAttribute: name => name === 'href' ? '#au1' : null });
  const footnote = makeTarget('A', 'fn1', '6', authorCard);
  targets.set('fn1', footnote);
  links.push({ tagName: 'A', textContent: '6', getAttribute: name => name === 'href' ? '#fn1' : null });

  const documentRef = {
    title: 'A skin-hypothalamus axis couples heat stress and metabolic dysfunction | Cell',
    location: { hostname: 'www.cell.com' },
    body: articleRoot,
    getElementById: id => targets.get(id) || null,
    querySelectorAll: selector => {
      if (selector.includes('a[href')) return links;
      if (selector === 'article' || selector.includes('[role="main"]')) return [articleRoot];
      return [];
    },
    querySelector: selector => selector === 'article' ? articleRoot : null
  };

  const structure = extractArticleStructure(documentRef, { locationLike: documentRef.location });

  assert.deepEqual(structure.nodes.map(node => node.title), ['Summary', 'Introduction', 'Results'], JSON.stringify(structure));
  assert.equal(structure.paragraphs.some(item => /Author affiliations/.test(item.text)), false);
});
