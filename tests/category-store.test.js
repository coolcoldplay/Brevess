const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {
  MAX_REGEX_RULES,
  MAX_REGEX_LENGTH,
  MAX_REGEX_REPEAT,
  MAX_COMPLEX_GROUP_REPEAT,
  BUILT_IN_REGEX,
  createBuiltInCategories,
  normalizeCustomCategory,
  validateCategory,
  toUnifiedCategory,
  flattenUnifiedCategory,
  mergeCategoryOverrides,
  validateUnifiedCategory,
  hasUnsafeRegexStructure,
  compileCategoryPromptPreview
} = require('../core/category-store.js');
const { createUnifiedCategoryCatalog } = require('../core/adaptive-catalog.js');

test('provides all thirteen stable built-in category ids', () => {
  const ids = Object.keys(createBuiltInCategories());
  assert.deepEqual(ids, [
    'hypothesis', 'objective', 'method', 'result', 'conclusion', 'comparison',
    'limitation', 'future', 'causality', 'emphasis', 'evidence', 'interpretation',
    'semantic_match'
  ]);
});

test('built-in categories provide versioned semantic boundaries and examples', () => {
  const categories = Object.values(createBuiltInCategories());
  categories.forEach(category => {
    assert.equal(category.version, 3, category.categoryId);
    ['includeWhen', 'excludeWhen', 'positiveExamples', 'negativeExamples'].forEach(field => {
      assert.ok(Array.isArray(category[field]) && category[field].length > 0,
        `${category.categoryId}.${field}`);
    });
  });
  assert.ok(categories.find(item => item.categoryId === 'causality')
    .negativeExamples.some(example => /as shown in/i.test(example)));
});

test('built-in regex defaults avoid bare discourse cues that create false positives', () => {
  assert.ok(!BUILT_IN_REGEX.method.phrases.includes('using'));
  assert.ok(!BUILT_IN_REGEX.method.phrases.includes('via'));
  assert.ok(!BUILT_IN_REGEX.result.phrases.includes('as shown in'));
  assert.ok(!BUILT_IN_REGEX.conclusion.phrases.includes('therefore'));
  assert.ok(!BUILT_IN_REGEX.comparison.phrases.includes('while'));
  assert.ok(!BUILT_IN_REGEX.limitation.phrases.includes('although'));
  assert.ok(!BUILT_IN_REGEX.future.phrases.includes('next'));
  assert.ok(!BUILT_IN_REGEX.causality.phrases.includes('thus'));
  assert.ok(!BUILT_IN_REGEX.emphasis.phrases.includes('significantly'));
  assert.ok(!BUILT_IN_REGEX.evidence.phrases.includes('supporting'));
  assert.ok(BUILT_IN_REGEX.causality.phrases.includes('resulted in'));
  assert.ok(!BUILT_IN_REGEX.limitation.phrases.includes('limited by'));
  assert.ok(!BUILT_IN_REGEX.objective.phrases.includes('in order to'));
  assert.ok(!BUILT_IN_REGEX.objective.phrases.includes('this work'));
  assert.ok(!BUILT_IN_REGEX.conclusion.phrases.includes('overall'));
  assert.ok(!BUILT_IN_REGEX.future.phrases.includes('follow-up'));
  assert.ok(!BUILT_IN_REGEX.emphasis.phrases.includes('particularly'));
});

test('normalizes a user-defined AI category', () => {
  const category = normalizeCustomCategory({
    name: '临床转化意义',
    idHint: 'clinical',
    definition: '识别研究结果对临床诊疗的明确意义',
    excludeWhen: ['只描述临床样本'],
    spanPolicy: 'clause',
    color: '#2F80ED'
  });
  assert.match(category.categoryId, /^custom_clinical_/);
  assert.equal(category.version, 1);
  assert.equal(category.persistence, 'saved');
  assert.deepEqual(category.enabledEngines, ['llm']);
  assert.deepEqual(validateCategory(category), []);
});

test('custom regex capability requires a usable matching rule and stays canonical', () => {
  const emptyRegex = normalizeCustomCategory({
    categoryId: 'custom_empty_regex',
    name: 'Empty regex',
    definition: 'A semantic category without local matching rules.',
    color: '#3366CC',
    enabledEngines: ['llm', 'regex'],
    regex: {
      phrases: [], expressions: [], excludePhrases: ['excluded only'],
      caseSensitive: false, wholeWord: true
    }
  });
  assert.deepEqual(emptyRegex.enabledEngines, ['llm']);
  assert.deepEqual(
    flattenUnifiedCategory(toUnifiedCategory(emptyRegex)).enabledEngines,
    ['llm']
  );

  const inferredRegex = normalizeCustomCategory({
    categoryId: 'custom_inferred_regex',
    name: 'Inferred regex',
    definition: 'A category with a usable local matching rule.',
    color: '#3366CC',
    regex: {
      phrases: ['patient selection'], expressions: [],
      caseSensitive: false, wholeWord: true
    }
  });
  assert.deepEqual(inferredRegex.enabledEngines, ['llm', 'regex']);

  const llmOnlyWithRules = normalizeCustomCategory({
    ...inferredRegex,
    categoryId: 'custom_llm_only_with_rules',
    enabledEngines: ['llm']
  });
  assert.deepEqual(llmOnlyWithRules.enabledEngines, ['llm']);

  const enabledLater = normalizeCustomCategory({
    ...emptyRegex,
    regex: {
      ...emptyRegex.regex,
      phrases: ['later local rule']
    },
    enabledEngines: ['llm', 'regex']
  });
  assert.deepEqual(enabledLater.enabledEngines, ['llm', 'regex']);
  assert.deepEqual(validateUnifiedCategory(enabledLater), []);
});

test('rejects incomplete or unsafe category shapes', () => {
  const errors = validateCategory({
    categoryId: 'bad id',
    name: '',
    definition: '',
    spanPolicy: 'paragraph',
    color: 'red',
    version: 0
  });
  assert.ok(errors.includes('categoryId'));
  assert.ok(errors.includes('name'));
  assert.ok(errors.includes('definition'));
  assert.ok(errors.includes('spanPolicy'));
  assert.ok(errors.includes('color'));
  assert.ok(errors.includes('version'));
});

test('creates a valid unified catalog with regex rules for built-in results', () => {
  const catalog = createUnifiedCategoryCatalog();
  assert.ok(Object.keys(catalog).length > 12);
  Object.values(catalog).forEach(category => {
    assert.equal(typeof category.prompt.definition, 'string', category.categoryId);
    assert.ok(Array.isArray(category.regex.phrases), category.categoryId);
    assert.ok(Array.isArray(category.regex.expressions), category.categoryId);
    assert.deepEqual(validateUnifiedCategory(category), [], category.categoryId);
  });
  assert.ok(catalog.result.regex.phrases.length > 0);
});

test('deep-merges category overrides without mutating the built-in category', () => {
  const builtIn = createUnifiedCategoryCatalog().limitation;
  const original = structuredClone(builtIn);
  const merged = mergeCategoryOverrides(builtIn, {
    name: '研究限制',
    color: '#123456',
    prompt: { definition: '自定义的限制定义' },
    regex: { expressions: ['\\bsample size\\b'] }
  });

  assert.equal(merged.name, '研究限制');
  assert.equal(merged.color, '#123456');
  assert.equal(merged.prompt.definition, '自定义的限制定义');
  assert.deepEqual(merged.regex.expressions, ['\\bsample size\\b']);
  assert.equal(merged.definition, '自定义的限制定义');
  assert.deepEqual(builtIn, original);
});

test('compiles a single-category prompt preview without the global output schema', () => {
  const preview = compileCategoryPromptPreview(createUnifiedCategoryCatalog().result);
  assert.match(preview, /结果陈述/);
  assert.match(preview, /应当包含/);
  assert.doesNotMatch(preview, /additionalProperties/);
});

test('reports the index of an invalid regex expression', () => {
  const result = createUnifiedCategoryCatalog().result;
  const errors = validateUnifiedCategory({
    ...result,
    regex: {
      ...result.regex,
      expressions: ['valid.*expression', '[broken']
    }
  });
  assert.ok(errors.includes('regex.expressions.1'));
});

test('migrates legacy phrase patterns for any category', () => {
  const category = toUnifiedCategory({
    categoryId: 'custom_phrase',
    patterns: ['first phrase', 'second phrase'],
    isRegex: false
  });
  assert.deepEqual(category.regex.phrases, ['first phrase', 'second phrase']);
  assert.deepEqual(category.regex.expressions, []);
});

test('migrates legacy regex patterns for any category', () => {
  const category = toUnifiedCategory({
    categoryId: 'custom_expression',
    patterns: ['value\\s+rose'],
    isRegex: true
  });
  assert.deepEqual(category.regex.phrases, []);
  assert.deepEqual(category.regex.expressions, ['value\\s+rose']);
});

test('prefers an explicit regex object over legacy patterns', () => {
  const category = toUnifiedCategory({
    categoryId: 'custom_precedence',
    patterns: ['legacy.*pattern'],
    isRegex: true,
    regex: {
      phrases: ['explicit phrase'],
      expressions: ['explicit.+expression'],
      caseSensitive: true,
      wholeWord: true
    }
  });
  assert.deepEqual(category.regex.phrases, ['explicit phrase']);
  assert.deepEqual(category.regex.expressions, ['explicit.+expression']);
});

test('normalizes and validates fixed-phrase regex exclusions', () => {
  const category = toUnifiedCategory({
    ...createBuiltInCategories().result,
    regex: {
      phrases: ['response increased'],
      excludePhrases: ['baseline response increased'],
      expressions: [],
      caseSensitive: false,
      wholeWord: false
    }
  });
  assert.deepEqual(category.regex.excludePhrases, ['baseline response increased']);
  assert.deepEqual(validateUnifiedCategory(category), []);
  const invalid = {
    ...category,
    regex: { ...category.regex, excludePhrases: [42] }
  };
  assert.ok(validateUnifiedCategory(invalid).includes('regex.excludePhrases.0'));
});

test('validates a strict unified category without legacy prompt fields', () => {
  const category = {
    categoryId: 'strict_unified',
    name: '严格统一类别',
    color: '#123456',
    version: 1,
    enabledEngines: ['llm'],
    prompt: {
      definition: '仅存在于结构化 prompt 中的定义',
      decisionQuestion: '是否符合该定义？',
      includeWhen: [],
      excludeWhen: [],
      positiveExamples: [],
      negativeExamples: [],
      requiredSlots: [],
      allowedQuoteRoles: ['statement'],
      spanPolicy: 'clause',
      minimumConfidence: 0.8
    },
    regex: {
      phrases: [],
      expressions: [],
      caseSensitive: false,
      wholeWord: false
    }
  };
  assert.deepEqual(validateUnifiedCategory(category), []);
});

test('deep-clones and recursively merges unknown JSON-like extension fields', () => {
  const base = {
    ...createUnifiedCategoryCatalog().limitation,
    extension: {
      baseOnly: { values: ['base'] },
      shared: { left: 1, nested: { fromBase: true } }
    }
  };
  const override = {
    extension: {
      overrideOnly: { values: ['override'] },
      shared: { right: 2, nested: { fromOverride: true } }
    },
    prompt: { futureConfig: { labels: ['prompt override'] } },
    regex: { futureConfig: { labels: ['regex override'] } }
  };
  const baseBefore = structuredClone(base);
  const overrideBefore = structuredClone(override);
  const merged = mergeCategoryOverrides(base, override);

  assert.deepEqual(merged.extension, {
    baseOnly: { values: ['base'] },
    overrideOnly: { values: ['override'] },
    shared: {
      left: 1,
      right: 2,
      nested: { fromBase: true, fromOverride: true }
    }
  });
  merged.extension.baseOnly.values.push('changed');
  merged.extension.shared.nested.fromBase = false;
  merged.prompt.futureConfig.labels.push('changed');
  merged.regex.futureConfig.labels.push('changed');
  assert.deepEqual(base, baseBefore);
  assert.deepEqual(override, overrideBefore);
});

test('allows retired categories while rejecting unknown engines', () => {
  const result = createUnifiedCategoryCatalog().result;
  assert.deepEqual(validateUnifiedCategory({ ...result, enabledEngines: [] }), []);
  assert.ok(validateUnifiedCategory({
    ...result,
    enabledEngines: ['llm', 'shell']
  }).includes('enabledEngines'));
});

test('enforces regex rule count and length limits with indexed errors', () => {
  assert.equal(MAX_REGEX_RULES, 64);
  assert.equal(MAX_REGEX_LENGTH, 500);
  const result = createUnifiedCategoryCatalog().result;
  const tooMany = validateUnifiedCategory({
    ...result,
    regex: { ...result.regex, expressions: Array(65).fill('safe') }
  });
  const tooLong = validateUnifiedCategory({
    ...result,
    regex: { ...result.regex, phrases: ['x'.repeat(501)] }
  });
  assert.ok(tooMany.includes('regex.expressions'));
  assert.ok(tooLong.includes('regex.phrases.0'));
});

test('rejects conservatively detected high-risk regex structures', () => {
  const result = createUnifiedCategoryCatalog().result;
  const errors = validateUnifiedCategory({
    ...result,
    regex: {
      ...result.regex,
      expressions: ['(a+)+', '(.*)+', '(.+)*', '.*.*']
    }
  });
  for (let index = 0; index < 4; index += 1) {
    assert.ok(errors.includes(`regex.expressions.${index}`));
  }
});

test('rejects ambiguous unbounded groups and empty-match expressions by index', () => {
  const result = createUnifiedCategoryCatalog().result;
  const errors = validateUnifiedCategory({
    ...result,
    regex: {
      ...result.regex,
      expressions: ['(a|aa)+$', '(?:a|a?)+$', '(a+(?:b)?)+$', '']
    }
  });
  for (let index = 0; index < 4; index += 1) {
    assert.ok(errors.includes(`regex.expressions.${index}`));
  }
});

test('allows bounded groups and ignores escaped or character-class parentheses', () => {
  const result = createUnifiedCategoryCatalog().result;
  const errors = validateUnifiedCategory({
    ...result,
    regex: {
      ...result.regex,
      expressions: [
        '(?:cat|dog)s?',
        '(?:ab|cd){1,3}',
        '\\(literal\\)+',
        '[()]+'
      ]
    }
  });
  assert.deepEqual(errors, []);
});

test('rejects excessive bounded group repeats and multiple unbounded quantifiers', () => {
  const result = createUnifiedCategoryCatalog().result;
  const errors = validateUnifiedCategory({
    ...result,
    regex: {
      ...result.regex,
      expressions: ['(?:a|aa){1,999999}$', 'a+a+a+a+a+a+$']
    }
  });
  assert.ok(errors.includes('regex.expressions.0'));
  assert.ok(errors.includes('regex.expressions.1'));
});

test('exports repeat limits and allows conservative bounded controls', () => {
  assert.equal(MAX_REGEX_REPEAT, 100);
  assert.equal(MAX_COMPLEX_GROUP_REPEAT, 8);
  const result = createUnifiedCategoryCatalog().result;
  const errors = validateUnifiedCategory({
    ...result,
    regex: {
      ...result.regex,
      expressions: ['a{1,20}b{1,20}', '(?:cat|dog){1,8}', '\\d+']
    }
  });
  assert.deepEqual(errors, []);
});

test('rejects adjacent overlapping finite quantifiers and repeated ambiguous groups', () => {
  const result = createUnifiedCategoryCatalog().result;
  const expressions = [
    'a{1,100}a{1,100}a{1,100}a{1,100}a{1,100}Z',
    '[ab]{1,50}[bc]{1,50}Z',
    '(?:a|aa){1,8}(?:a|aa){1,8}Z'
  ];
  const errors = validateUnifiedCategory({
    ...result,
    regex: { ...result.regex, expressions }
  });
  expressions.forEach((_, index) => {
    assert.ok(errors.includes(`regex.expressions.${index}`));
  });
});

test('keeps non-overlapping finite quantifiers and unambiguous alternations safe', () => {
  const result = createUnifiedCategoryCatalog().result;
  const errors = validateUnifiedCategory({
    ...result,
    regex: {
      ...result.regex,
      expressions: [
        'a{1,20}b{1,20}',
        '(?:cat|dog){1,8}',
        '[ab]{1,20}[cd]{1,20}'
      ]
    }
  });
  assert.deepEqual(errors, []);
});

test('rejects lazy, grouped, and lookaround-separated overlapping bounded repeats', () => {
  const dangerous = [
    'a{1,100}?a{1,100}?Z',
    '[ab]{1,100}?[bc]{1,100}?Z',
    '(?:a{1,100})(?:a{1,100})(?:a{1,100})(?:a{1,100})Z',
    'a{1,100}(?=a)a{1,100}Z'
  ];
  dangerous.forEach(expression => {
    assert.equal(hasUnsafeRegexStructure(expression), true, expression);
  });
});

test('rejects a known unsafe structure before constructing its RegExp', () => {
  const result = createUnifiedCategoryCatalog().result;
  const dangerous = 'a{1,100}?a{1,100}?Z';
  const NativeRegExp = globalThis.RegExp;
  let constructedDangerousExpression = false;
  globalThis.RegExp = function guardedRegExp(pattern, flags) {
    if (pattern === dangerous) {
      constructedDangerousExpression = true;
      throw new Error('unsafe expression reached RegExp construction');
    }
    return new NativeRegExp(pattern, flags);
  };
  globalThis.RegExp.prototype = NativeRegExp.prototype;
  try {
    const errors = validateUnifiedCategory({
      ...result,
      regex: { ...result.regex, expressions: [dangerous] }
    });
    assert.ok(errors.includes('regex.expressions.0'));
  } finally {
    globalThis.RegExp = NativeRegExp;
  }
  assert.equal(constructedDangerousExpression, false);
});

test('rejects nested wrappers and empty groups that hide overlapping bounded repeats', () => {
  const dangerous = [
    '(?:(?:a{1,100}))(?:(?:a{1,100}))(?:(?:a{1,100}))(?:(?:a{1,100}))Z',
    'a{1,100}(?:)a{1,100}(?:)a{1,100}(?:)a{1,100}Z',
    'a{1,100}(?:(?:))a{1,100}(?:(?:))a{1,100}Z',
    'a{1,100}(?:){1,8}a{1,100}Z',
    '(?<left>a{1,100})(?<right>a{1,100})Z',
    '(?<left>(a{1,100}))(?<right>(a{1,100}))Z',
    '(a{1,100})(a{1,100})Z',
    'a{1,100}(?<gap>)a{1,100}Z',
    'a{1,100}()a{1,100}Z',
    'a{1,100}(?<=a)a{1,100}Z'
  ];
  dangerous.forEach(expression => {
    assert.equal(hasUnsafeRegexStructure(expression), true, expression);
  });
});

test('keeps nested wrappers and empty groups safe when bounded repeats do not overlap', () => {
  const safe = [
    '(?:(?:a{1,20}))(?:(?:b{1,20}))Z',
    'a{1,20}(?:)b{1,20}Z',
    'a{1,20}(?:(?:))b{1,20}Z',
    'a{1,20}(?:){1,8}b{1,20}Z',
    '(?<left>a{1,20})(?<right>b{1,20})Z',
    '(?<left>(a{1,20}))(?<right>(b{1,20}))Z',
    '(a{1,20})(b{1,20})Z',
    'a{1,20}(?<gap>)b{1,20}Z',
    'a{1,20}()b{1,20}Z',
    'a{1,20}(?<=a)b{1,20}Z'
  ];
  safe.forEach(expression => {
    assert.equal(hasUnsafeRegexStructure(expression), false, expression);
  });
});

test('keeps non-overlapping lazy, grouped, and lookaround bounded controls safe', () => {
  const safe = [
    'a{1,20}?b{1,20}?Z',
    '[ab]{1,20}?[cd]{1,20}?Z',
    '(?:a{1,20})(?:b{1,20})Z',
    'a{1,20}(?=b)b{1,20}Z'
  ];
  safe.forEach(expression => {
    assert.equal(hasUnsafeRegexStructure(expression), false, expression);
  });
});

test('keeps every built-in regex configuration in the shared category store', () => {
  const catalog = createUnifiedCategoryCatalog();
  assert.deepEqual(Object.keys(BUILT_IN_REGEX), [
    'hypothesis', 'objective', 'method', 'result', 'conclusion', 'comparison',
    'limitation', 'future', 'causality', 'emphasis', 'evidence', 'interpretation',
    'semantic_match'
  ]);
  for (const [categoryId, regex] of Object.entries(BUILT_IN_REGEX)) {
    assert.deepEqual([...catalog[categoryId].regex.phrases], [...regex.phrases], categoryId);
    assert.deepEqual([...catalog[categoryId].regex.expressions], [...regex.expressions], categoryId);
  }
});

test('reports a clear dependency error when category-store is not loaded', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'core', 'adaptive-catalog.js'), 'utf8'
  );
  const sandbox = { module: { exports: {} } };
  vm.runInNewContext(source, sandbox);
  assert.throws(
    () => sandbox.module.exports.createUnifiedCategoryCatalog(),
    /Category store must be loaded before adaptive catalog/
  );
});
