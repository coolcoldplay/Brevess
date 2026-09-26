#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../core/category-store.js');
const { createUnifiedCategoryCatalog } = require('../core/adaptive-catalog.js');
const SENTENCE_SEGMENTER = typeof Intl?.Segmenter === 'function'
  ? new Intl.Segmenter('en', { granularity: 'sentence' })
  : null;

const ACTIVE_SECTION_KINDS = new Set([
  'abstract', 'introduction', 'results', 'discussion', 'conclusion'
]);

const EXPECTED_SECTION_KINDS = Object.freeze({
  hypothesis: new Set(['abstract', 'introduction', 'discussion']),
  objective: new Set(['abstract', 'introduction']),
  method: new Set(['abstract', 'methods']),
  result: new Set(['abstract', 'results']),
  conclusion: new Set(['abstract', 'discussion', 'conclusion']),
  comparison: ACTIVE_SECTION_KINDS,
  limitation: new Set(['discussion', 'conclusion']),
  future: new Set(['discussion', 'conclusion']),
  causality: ACTIVE_SECTION_KINDS,
  emphasis: ACTIVE_SECTION_KINDS,
  evidence: new Set(['introduction', 'discussion']),
  interpretation: new Set(['results', 'discussion', 'conclusion']),
  known_background: new Set(['abstract', 'introduction', 'discussion']),
  knowledge_gap: new Set(['abstract', 'introduction', 'discussion', 'conclusion']),
  study_strategy: new Set(['abstract', 'introduction']),
  key_result: new Set(['abstract', 'results', 'discussion']),
  significance_novelty: new Set(['abstract', 'discussion', 'conclusion']),
  driver_intervention: ACTIVE_SECTION_KINDS,
  association_evidence: ACTIVE_SECTION_KINDS,
  causal_effect: ACTIVE_SECTION_KINDS,
  mechanism_mediator: ACTIVE_SECTION_KINDS,
  necessity_evidence: ACTIVE_SECTION_KINDS,
  sufficiency_evidence: ACTIVE_SECTION_KINDS,
  rescue_evidence: ACTIVE_SECTION_KINDS,
  temporal_dose_evidence: ACTIVE_SECTION_KINDS,
  cross_system_validation: ACTIVE_SECTION_KINDS,
  mechanism_gap: new Set(['abstract', 'introduction', 'discussion', 'conclusion']),
  alternative_mechanism: new Set(['results', 'discussion', 'conclusion']),
  design_control: ACTIVE_SECTION_KINDS,
  sample_population: new Set(['abstract', 'introduction', 'results']),
  measurement_validity: new Set(['abstract', 'results', 'discussion']),
  effect_uncertainty: new Set(['abstract', 'results', 'discussion']),
  statistical_robustness: new Set(['abstract', 'results', 'discussion']),
  confounding_reverse_causality: new Set(['discussion', 'conclusion']),
  causal_overreach: new Set(['discussion', 'conclusion']),
  alternative_explanation: new Set(['results', 'discussion', 'conclusion']),
  replication_external_validation: ACTIVE_SECTION_KINDS,
  generalizability: new Set(['discussion', 'conclusion']),
  statistical_vs_practical_significance: new Set(['results', 'discussion', 'conclusion']),
  transparency_reproducibility: ACTIVE_SECTION_KINDS,
  review_scope_thesis: new Set(['abstract', 'introduction']),
  evidence_consensus: new Set(['abstract', 'introduction', 'discussion']),
  conflicting_evidence: new Set(['abstract', 'introduction', 'discussion']),
  heterogeneity_source: new Set(['results', 'discussion']),
  evidence_quality_certainty: new Set(['abstract', 'results', 'discussion', 'conclusion']),
  integrative_framework: new Set(['abstract', 'introduction', 'discussion', 'conclusion']),
  author_synthesis: new Set(['abstract', 'discussion', 'conclusion'])
});

const STRUCTURED_LABEL_CATEGORY = Object.freeze({
  OBJECTIVE: 'objective',
  AIM: 'objective',
  PURPOSE: 'objective',
  DESIGN: 'method',
  'DESIGN, SETTING, AND PARTICIPANTS': 'method',
  'DESIGN AND PARTICIPANTS': 'method',
  SETTING: 'method',
  PARTICIPANTS: 'method',
  INTERVENTION: 'method',
  INTERVENTIONS: 'method',
  EXPOSURE: 'method',
  EXPOSURES: 'method',
  'MAIN OUTCOMES AND MEASURES': 'method',
  METHODS: 'method',
  METHOD: 'method',
  RESULTS: 'result',
  RESULT: 'result',
  CONCLUSION: 'conclusion',
  CONCLUSIONS: 'conclusion',
  'CONCLUSIONS AND RELEVANCE': 'conclusion',
  LIMITATIONS: 'limitation',
  LIMITATION: 'limitation'
});

const STRUCTURED_SENTENCE_PATTERN = new RegExp(
  `^(${Object.keys(STRUCTURED_LABEL_CATEGORY)
    .sort((left, right) => right.length - left.length)
    .map(escapeRegex)
    .join('|')}):\\s+(.*)$`,
  'i'
);

const BARE_STRUCTURED_LABEL_PATTERN = new RegExp(
  `^(${Object.keys(STRUCTURED_LABEL_CATEGORY)
    .sort((left, right) => right.length - left.length)
    .map(escapeRegex)
    .join('|')})\\s*[:.]?$`,
  'i'
);

const SECTION_RULES = [
  ['abstract', /^(?:abstract|summary|highlights?|key points?|research in context)$/i],
  ['introduction', /^(?:introduction|background|context)$/i],
  ['results', /^(?:results?|findings?)$/i],
  ['discussion', /^(?:discussion|general discussion)$/i],
  ['conclusion', /^(?:conclusions?|concluding remarks?|summary and conclusions?)$/i],
  ['methods', /^(?:methods?|materials? and methods?|methods? and materials?|experimental procedures?|patients? and methods?|subjects? and methods?|study design|statistical analysis|star[★*]methods)$/i],
  ['references', /^(?:references|bibliography|literature cited)$/i],
  ['utility', /^(?:acknowledg(?:e)?ments?|author information|author contributions?|funding|conflicts? of interest|competing interests?|ethics declarations?|declarations?|data availability|code availability|resource availability|additional information|supplementary information|supplemental information|extended data|supporting information|appendix|appendices)$/i]
];

const DEFAULT_ROOT = path.join(os.homedir(), 'Zotero', 'llm-for-zotero-mineru');
const args = parseArgs(process.argv.slice(2));
const corpusRoot = path.resolve(args.root || process.env.ZOTERO_MINERU_ROOT || DEFAULT_ROOT);
const reportPath = path.resolve(args.report || path.join(
  process.cwd(), 'output', 'zotero-mineru-regex', 'benchmark-latest.json'
));

if (!fs.existsSync(corpusRoot)) {
  console.error(`Uminer corpus not found: ${corpusRoot}`);
  process.exitCode = 2;
} else {
  const result = runBenchmark();
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  printSummary(result);
}

function runBenchmark() {
  const catalog = createUnifiedCategoryCatalog();
  const categoryMatchers = Object.values(catalog)
    .filter(category => category.categoryId !== 'semantic_match')
    .map(category => compileCategory(category));
  const allFiles = discoverMarkdownFiles(corpusRoot);
  const selectedFiles = selectFiles(allFiles, args.sample, args.seed);
  const aggregate = createAggregate(
    allFiles.length,
    selectedFiles.length,
    categoryMatchers
  );

  selectedFiles.forEach((filePath, documentIndex) => {
    const markdown = fs.readFileSync(filePath, 'utf8');
    const parsed = parseMarkdown(markdown);
    aggregate.documents.parsed += 1;
    if (!parsed.isArticleLike) {
      aggregate.documents.excludedNonArticle += 1;
      return;
    }
    aggregate.documents.articleLike += 1;
    aggregate.paragraphs += parsed.paragraphs.length;
    aggregate.sentences += parsed.sentences.length;
    aggregate.activeSentences += parsed.sentences.filter(sentence =>
      ACTIVE_SECTION_KINDS.has(sentence.sectionKind)
    ).length;
    Object.entries(parsed.sectionCounts).forEach(([kind, count]) => {
      aggregate.sections[kind] = (aggregate.sections[kind] || 0) + count;
    });

    parsed.sentences.forEach((sentence, sentenceIndex) => {
      const matchedCategories = [];
      categoryMatchers.forEach(matcher => {
        const hits = matcher.match(sentence.text);
        if (!hits.length) return;
        matchedCategories.push(matcher.categoryId);
        recordCategoryHits({
          aggregate,
          matcher,
          hits,
          sentence,
          documentIndex,
          sentenceIndex,
          documentKey: path.relative(corpusRoot, filePath)
        });
      });
      if (matchedCategories.length > 1) {
        aggregate.collisions.sentences += 1;
        aggregate.collisions.categoryAssignments += matchedCategories.length;
        const sortedCategories = [...matchedCategories].sort();
        for (let left = 0; left < sortedCategories.length; left += 1) {
          for (let right = left + 1; right < sortedCategories.length; right += 1) {
            const pair = `${sortedCategories[left]} + ${sortedCategories[right]}`;
            aggregate.collisions.pairs[pair] =
              (aggregate.collisions.pairs[pair] || 0) + 1;
          }
        }
        if (ACTIVE_SECTION_KINDS.has(sentence.sectionKind)) {
          aggregate.collisions.activeSentences += 1;
          if (aggregate.collisions.activeSamples.length < args.collisionSamples) {
            aggregate.collisions.activeSamples.push({
              document: path.relative(corpusRoot, filePath),
              sentenceIndex,
              sectionKind: sentence.sectionKind,
              categories: sortedCategories,
              text: sentence.text.slice(0, 520)
            });
          }
        }
      }
      recordStructuredLabel(aggregate, sentence, matchedCategories);
    });
  });

  finalizeAggregate(aggregate);
  return {
    generatedAt: new Date().toISOString(),
    corpus: {
      root: corpusRoot,
      discoveredMarkdownFiles: allFiles.length,
      selectedMarkdownFiles: selectedFiles.length,
      sampleSeed: args.seed
    },
    methodology: {
      note: 'Section alignment and structured-label recall are deterministic proxy metrics, not manually adjudicated clinical/scientific ground truth.',
      activeSectionKinds: [...ACTIVE_SECTION_KINDS],
      excludedFromActiveAnalysis: ['methods', 'references', 'utility', 'front', 'other'],
      articleLikeFilter: 'At least two scientific section kinds, or an abstract plus one core scientific section; patent-like documents are excluded.',
      matchingSemantics: 'Same phrase/expression, case-sensitivity and whole-word behavior as the extension category catalog.',
      precisionReview: 'Per-category active samples, excluded-section samples, rule frequencies and category-pair collisions are retained for local manual audit.'
    },
    metrics: aggregate
  };
}

function createAggregate(discovered, selected, categoryMatchers) {
  const categories = {};
  categoryMatchers.forEach(matcher => {
    categories[matcher.categoryId] = {
      matchedSentences: 0,
      activeMatchedSentences: 0,
      sectionAlignedSentences: 0,
      excludedSectionSentences: 0,
      matchedDocuments: 0,
      activeSectionAlignmentRate: null,
      per1000ActiveSentences: 0,
      expectedSectionKinds: [
        ...(EXPECTED_SECTION_KINDS[matcher.categoryId] || ACTIVE_SECTION_KINDS)
      ],
      sectionDistribution: {},
      configuredRuleCount: matcher.ruleIds.length,
      exercisedRuleCount: 0,
      ruleExerciseRate: null,
      rules: Object.fromEntries(matcher.ruleIds.map(ruleId => [
        ruleId,
        {
          hitSentences: 0,
          activeHitSentences: 0,
          alignedHitSentences: 0
        }
      ])),
      activeSamples: [],
      unexpectedSamples: [],
      excludedSectionSamples: [],
      _matchedDocumentIndexes: new Set()
    };
  });
  return {
    documents: {
      discovered,
      selected,
      parsed: 0,
      articleLike: 0,
      excludedNonArticle: 0
    },
    paragraphs: 0,
    sentences: 0,
    activeSentences: 0,
    sections: {},
    categories,
    collisions: {
      sentences: 0,
      activeSentences: 0,
      categoryAssignments: 0,
      ratePer1000ActiveSentences: 0,
      activeRatePer1000ActiveSentences: 0,
      pairs: {},
      activeSamples: []
    },
    structuredLabels: {
      total: 0,
      matchedByExpectedCategory: 0,
      recall: null,
      byCategory: {}
    },
    regexCoverage: {
      configuredCategories: categoryMatchers.length,
      exercisedCategories: 0,
      configuredRules: categoryMatchers.reduce(
        (total, matcher) => total + matcher.ruleIds.length,
        0
      ),
      exercisedRules: 0,
      categoryExerciseRate: null,
      ruleExerciseRate: null
    }
  };
}

function recordCategoryHits({
  aggregate,
  matcher,
  hits,
  sentence,
  documentIndex,
  sentenceIndex,
  documentKey
}) {
  const category = aggregate.categories[matcher.categoryId];
  category.matchedSentences += 1;
  category._matchedDocumentIndexes.add(documentIndex);
  category.sectionDistribution[sentence.sectionKind] =
    (category.sectionDistribution[sentence.sectionKind] || 0) + 1;
  const isActive = ACTIVE_SECTION_KINDS.has(sentence.sectionKind);
  const expectedSections =
    EXPECTED_SECTION_KINDS[matcher.categoryId] || ACTIVE_SECTION_KINDS;
  const isAligned = expectedSections.has(sentence.sectionKind);
  if (isActive) category.activeMatchedSentences += 1;
  else category.excludedSectionSentences += 1;
  if (isActive && isAligned) category.sectionAlignedSentences += 1;

  hits.forEach(hit => {
    const rule = category.rules[hit.rule];
    if (!rule) return;
    rule.hitSentences += 1;
    if (isActive) rule.activeHitSentences += 1;
    if (isActive && isAligned) rule.alignedHitSentences += 1;
    category.rules[hit.rule] = rule;
  });

  if (isActive && category.activeSamples.length < args.samplesPerCategory) {
    category.activeSamples.push({
      document: documentKey,
      sentenceIndex,
      sectionKind: sentence.sectionKind,
      matchedRules: hits.map(hit => hit.rule),
      text: sentence.text.slice(0, 520)
    });
  }
  if (isActive && !isAligned && category.unexpectedSamples.length < args.samplesPerCategory) {
    category.unexpectedSamples.push({
      document: documentKey,
      sentenceIndex,
      sectionKind: sentence.sectionKind,
      matchedRules: hits.map(hit => hit.rule),
      text: sentence.text.slice(0, 520)
    });
  }
  if (!isActive &&
      category.excludedSectionSamples.length < args.samplesPerCategory) {
    category.excludedSectionSamples.push({
      document: documentKey,
      sentenceIndex,
      sectionKind: sentence.sectionKind,
      matchedRules: hits.map(hit => hit.rule),
      text: sentence.text.slice(0, 520)
    });
  }
}

function recordStructuredLabel(aggregate, sentence, matchedCategories) {
  const match = sentence.text.match(STRUCTURED_SENTENCE_PATTERN);
  if (!match) return;
  const label = normalizeStructuredLabel(match[1]);
  const expectedCategory = STRUCTURED_LABEL_CATEGORY[label];
  if (!expectedCategory) return;
  const labels = aggregate.structuredLabels;
  labels.total += 1;
  const category = labels.byCategory[expectedCategory] || {
    total: 0,
    matched: 0,
    recall: null
  };
  category.total += 1;
  if (matchedCategories.includes(expectedCategory)) {
    labels.matchedByExpectedCategory += 1;
    category.matched += 1;
  }
  labels.byCategory[expectedCategory] = category;
}

function finalizeAggregate(aggregate) {
  Object.values(aggregate.categories).forEach(category => {
    category.matchedDocuments = category._matchedDocumentIndexes.size;
    delete category._matchedDocumentIndexes;
    category.activeSectionAlignmentRate = ratio(
      category.sectionAlignedSentences,
      category.activeMatchedSentences
    );
    category.per1000ActiveSentences = perThousand(
      category.activeMatchedSentences,
      aggregate.activeSentences
    );
    Object.values(category.rules).forEach(rule => {
      rule.activeAlignmentRate = ratio(
        rule.alignedHitSentences,
        rule.activeHitSentences
      );
    });
    category.exercisedRuleCount = Object.values(category.rules)
      .filter(rule => rule.hitSentences > 0).length;
    category.ruleExerciseRate = ratio(
      category.exercisedRuleCount,
      category.configuredRuleCount
    );
    category.rules = Object.fromEntries(
      Object.entries(category.rules).sort(([, left], [, right]) =>
        right.activeHitSentences - left.activeHitSentences ||
        right.hitSentences - left.hitSentences
      )
    );
  });
  aggregate.regexCoverage.exercisedCategories = Object.values(aggregate.categories)
    .filter(category => category.matchedSentences > 0).length;
  aggregate.regexCoverage.exercisedRules = Object.values(aggregate.categories)
    .reduce((total, category) => total + category.exercisedRuleCount, 0);
  aggregate.regexCoverage.categoryExerciseRate = ratio(
    aggregate.regexCoverage.exercisedCategories,
    aggregate.regexCoverage.configuredCategories
  );
  aggregate.regexCoverage.ruleExerciseRate = ratio(
    aggregate.regexCoverage.exercisedRules,
    aggregate.regexCoverage.configuredRules
  );
  aggregate.collisions.ratePer1000ActiveSentences = perThousand(
    aggregate.collisions.sentences,
    aggregate.activeSentences
  );
  aggregate.collisions.activeRatePer1000ActiveSentences = perThousand(
    aggregate.collisions.activeSentences,
    aggregate.activeSentences
  );
  aggregate.collisions.pairs = Object.fromEntries(
    Object.entries(aggregate.collisions.pairs)
      .sort(([, left], [, right]) => right - left)
  );
  aggregate.structuredLabels.recall = ratio(
    aggregate.structuredLabels.matchedByExpectedCategory,
    aggregate.structuredLabels.total
  );
  Object.values(aggregate.structuredLabels.byCategory).forEach(category => {
    category.recall = ratio(category.matched, category.total);
  });
}

function compileCategory(category) {
  const flags = category.regex.caseSensitive ? 'g' : 'gi';
  const rules = [];
  category.regex.phrases.forEach((phrase, index) => {
    if (!phrase) return;
    rules.push({
      id: `phrase:${index}:${phrase}`,
      kind: 'phrase',
      value: category.regex.caseSensitive ? phrase : phrase.toLowerCase()
    });
  });
  category.regex.expressions.forEach((expression, index) => {
    rules.push({
      id: `expression:${index}:${expression}`,
      kind: 'expression',
      regex: new RegExp(expression, flags)
    });
  });
  return {
    categoryId: category.categoryId,
    ruleIds: rules.map(rule => rule.id),
    match(text) {
      const hits = [];
      const searchable = category.regex.caseSensitive ? text : text.toLowerCase();
      rules.forEach(rule => {
        if (rule.kind === 'phrase') {
          let start = searchable.indexOf(rule.value);
          while (start >= 0) {
            const end = start + rule.value.length;
            if (!category.regex.wholeWord || (
              !isWordCharacter(text[start - 1]) && !isWordCharacter(text[end])
            )) {
              hits.push({ rule: rule.id, start, end });
              break;
            }
            start = searchable.indexOf(rule.value, Math.max(end, start + 1));
          }
          return;
        }
        rule.regex.lastIndex = 0;
        let match;
        while ((match = rule.regex.exec(text))) {
          if (!match[0]) {
            rule.regex.lastIndex = Math.max(rule.regex.lastIndex + 1, match.index + 1);
            continue;
          }
          const start = match.index;
          const end = start + match[0].length;
          if (!category.regex.wholeWord || (
            !isWordCharacter(text[start - 1]) && !isWordCharacter(text[end])
          )) {
            hits.push({ rule: rule.id, start, end });
            break;
          }
        }
      });
      return hits;
    }
  };
}

function discoverMarkdownFiles(root) {
  return fs.readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(root, entry.name, 'full.md'))
    .filter(filePath => fs.existsSync(filePath))
    .sort((left, right) => left.localeCompare(right, 'en', { numeric: true }));
}

function selectFiles(files, sample, seed) {
  const limit = Number(sample) || 0;
  if (!limit || limit >= files.length) return files;
  const shuffled = [...files];
  let state = Number(seed) >>> 0;
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const swapIndex = state % (index + 1);
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled.slice(0, limit).sort();
}

function parseMarkdown(markdown) {
  const source = String(markdown || '').normalize('NFKC')
    .replace(/\r\n?/g, '\n')
    .replace(/^\uFEFF/, '');
  const lines = source.split('\n');
  const paragraphs = [];
  const sectionKinds = new Set();
  let sectionKind = 'front';
  let pendingStructuredLabel = '';
  let buffer = [];
  let inFence = false;
  let frontMatter = lines[0]?.trim() === '---';

  function flush() {
    const raw = buffer.join(' ').replace(/\s+/g, ' ').trim();
    buffer = [];
    if (!raw) return;
    const cleaned = cleanMarkdownText(raw);
    if (!cleaned || cleaned.length < 12 || isNoiseParagraph(cleaned)) return;
    const text = pendingStructuredLabel
      ? `${pendingStructuredLabel}: ${cleaned}` : cleaned;
    pendingStructuredLabel = '';
    paragraphs.push({ sectionKind, text });
  }

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (frontMatter) {
      if (index > 0 && line === '---') frontMatter = false;
      return;
    }
    if (/^```/.test(line)) {
      flush();
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    if (!line) {
      flush();
      return;
    }
    if (/^(?:!\[[^\]]*]\([^)]*\)|<img\b[^>]*>)$/i.test(line)) {
      flush();
      return;
    }
    if (/^\|.*\|$/.test(line) || /^[-:| ]{5,}$/.test(line)) {
      flush();
      return;
    }

    const headingMatch = line.match(/^#{1,6}\s+(.+?)\s*#*$/);
    if (headingMatch) {
      flush();
      const heading = cleanHeading(headingMatch[1]);
      const classified = classifySectionHeading(heading, sectionKind);
      if (classified) {
        sectionKind = classified;
        sectionKinds.add(classified);
      }
      return;
    }

    const bareLabel = line.match(BARE_STRUCTURED_LABEL_PATTERN);
    if (bareLabel) {
      flush();
      pendingStructuredLabel = normalizeStructuredLabel(bareLabel[1]);
      const categoryId = STRUCTURED_LABEL_CATEGORY[pendingStructuredLabel];
      if (categoryId === 'objective' || categoryId === 'method' ||
          categoryId === 'result' || categoryId === 'conclusion') {
        sectionKind = sectionKind === 'front' ? 'abstract' : sectionKind;
        sectionKinds.add(sectionKind);
      }
      return;
    }

    const inlineLabel = matchStructuredLabelLine(line);
    if (inlineLabel) {
      flush();
      pendingStructuredLabel = normalizeStructuredLabel(inlineLabel[1]);
      if (sectionKind === 'front') {
        sectionKind = 'abstract';
        sectionKinds.add(sectionKind);
      }
      buffer.push(inlineLabel[2]);
      flush();
      return;
    }

    buffer.push(line);
  });
  flush();

  const sentences = paragraphs.flatMap(paragraph =>
    splitSentences(paragraph.text).map(text => ({
      sectionKind: paragraph.sectionKind,
      text
    }))
  );
  const sectionCounts = {};
  sentences.forEach(sentence => {
    sectionCounts[sentence.sectionKind] =
      (sectionCounts[sentence.sectionKind] || 0) + 1;
  });
  const scientificSectionCount = [...sectionKinds].filter(kind =>
    ['abstract', 'introduction', 'results', 'discussion', 'conclusion', 'methods', 'references']
      .includes(kind)
  ).length;
  const patentLike = /\b(?:patent|claims?|inventors?|publication number)\b/i
    .test(sentences.slice(0, 30).map(sentence => sentence.text).join(' ')) &&
    !sectionKinds.has('results');
  const isArticleLike = !patentLike && (
    scientificSectionCount >= 2 ||
    (sectionKinds.has('abstract') &&
      [...sectionKinds].some(kind =>
        ['introduction', 'results', 'discussion', 'conclusion', 'methods', 'references']
          .includes(kind)
      ))
  );
  return { paragraphs, sentences, sectionCounts, isArticleLike };
}

function classifySectionHeading(value, currentKind) {
  const heading = cleanHeading(value)
    .replace(/^(?:\d+(?:\.\d+)*|[ivxlcdm]+)[.)]?\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  for (const [kind, pattern] of SECTION_RULES) {
    if (pattern.test(heading)) return kind;
  }
  return currentKind === 'front' ? null : currentKind;
}

function cleanHeading(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, '')
    .replace(/[*_`~]/g, '')
    .replace(/\[[^\]]+]\([^)]*\)/g, match => match.replace(/\]\([^)]*\)$/, '').slice(1))
    .trim();
}

function cleanMarkdownText(value) {
  return String(value || '')
    .replace(/!\[([^\]]*)]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[*_`~]/g, '')
    .replace(/^\s*(?:[-+*]|\d+[.)])\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isNoiseParagraph(text) {
  if (/^(?:https?:\/\/|doi:|copyright\b|download\b)/i.test(text)) return true;
  if (/^(?:figure|fig\.?|table|supplementary (?:figure|table))\s*[s\d]+[.:]/i.test(text)) {
    return true;
  }
  const letters = (text.match(/\p{L}/gu) || []).length;
  return letters < 8 || letters / Math.max(text.length, 1) < 0.35;
}

function splitSentences(text) {
  if (SENTENCE_SEGMENTER) {
    return [...SENTENCE_SEGMENTER.segment(text)]
      .map(item => item.segment.replace(/\s+/g, ' ').trim())
      .filter(item => item.length >= 12);
  }
  return (text.match(/[^.!?。！？]+[.!?。！？]?/gu) || [text])
    .map(item => item.replace(/\s+/g, ' ').trim())
    .filter(item => item.length >= 12);
}

function normalizeStructuredLabel(value) {
  return String(value || '').toUpperCase().replace(/\s+/g, ' ').trim();
}

function matchStructuredLabelLine(line) {
  const source = String(line || '');
  const upper = source.toUpperCase();
  for (const label of Object.keys(STRUCTURED_LABEL_CATEGORY)
    .sort((left, right) => right.length - left.length)) {
    if (!upper.startsWith(label)) continue;
    const suffix = source.slice(label.length);
    const punctuation = suffix.match(/^\s*[:.\-–—]\s*(.*)$/);
    if (punctuation) return [source, label, punctuation[1]];
    if (source.startsWith(label)) {
      const whitespace = suffix.match(/^\s+(.*)$/);
      if (whitespace) return [source, label, whitespace[1]];
    }
  }
  return null;
}

function isWordCharacter(value) {
  return Boolean(value) && /[\p{L}\p{N}_]/u.test(value);
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function ratio(numerator, denominator) {
  return denominator ? Number((numerator / denominator).toFixed(4)) : null;
}

function perThousand(numerator, denominator) {
  return denominator ? Number((numerator * 1000 / denominator).toFixed(2)) : 0;
}

function parseArgs(argv) {
  const options = {
    root: '',
    report: '',
    sample: 0,
    seed: 20260728,
    samplesPerCategory: 12,
    collisionSamples: 40
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--root') options.root = argv[++index] || '';
    else if (value === '--report') options.report = argv[++index] || '';
    else if (value === '--sample') options.sample = Number(argv[++index]) || 0;
    else if (value === '--seed') options.seed = Number(argv[++index]) || options.seed;
    else if (value === '--samples-per-category') {
      options.samplesPerCategory = Math.max(0, Number(argv[++index]) || 0);
    } else if (value === '--collision-samples') {
      options.collisionSamples = Math.max(0, Number(argv[++index]) || 0);
    } else if (value === '--help' || value === '-h') {
      console.log([
        'Usage: node scripts/benchmark-zotero-mineru-regex.mjs [options]',
        '',
        '  --root PATH                 Uminer corpus root (default: ~/Zotero/llm-for-zotero-mineru)',
        '  --sample N                  Deterministic document sample; 0 means all',
        '  --seed N                    Sample seed',
        '  --samples-per-category N    Unexpected contexts retained in local report',
        '  --collision-samples N       Multi-category contexts retained in local report',
        '  --report PATH               JSON report path (default: output/.../benchmark-latest.json)'
      ].join('\n'));
      process.exit(0);
    }
  }
  return options;
}

function printSummary(result) {
  const { metrics } = result;
  console.log(`Corpus: ${metrics.documents.articleLike}/${metrics.documents.selected} article-like documents`);
  console.log(`Sentences: ${metrics.sentences} total; ${metrics.activeSentences} in active sections`);
  console.log(`Structured-label recall: ${formatPercent(metrics.structuredLabels.recall)} (${metrics.structuredLabels.matchedByExpectedCategory}/${metrics.structuredLabels.total})`);
  console.log(`Regex exercise: ${metrics.regexCoverage.exercisedCategories}/${metrics.regexCoverage.configuredCategories} categories; ${metrics.regexCoverage.exercisedRules}/${metrics.regexCoverage.configuredRules} rules`);
  console.log('Category\tactive hits\tsection proxy\tper 1k active');
  Object.entries(metrics.categories).forEach(([categoryId, category]) => {
    console.log([
      categoryId,
      category.activeMatchedSentences,
      formatPercent(category.activeSectionAlignmentRate),
      category.per1000ActiveSentences
    ].join('\t'));
  });
  console.log(`Active collision rate: ${metrics.collisions.activeRatePer1000ActiveSentences} per 1k active sentences`);
  console.log(`Report: ${reportPath}`);
}

function formatPercent(value) {
  return value == null ? 'n/a' : `${(value * 100).toFixed(1)}%`;
}
