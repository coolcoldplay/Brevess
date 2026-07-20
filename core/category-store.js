(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const BUILT_INS = [
    ['hypothesis', '提出假设', '作者明确提出可检验的假设、预测或理论模型', '#FF6B6B'],
    ['objective', '研究目的', '当前研究明确声明的目标、问题或评价目的', '#4ECDC4'],
    ['method', '方法描述', '当前研究实施的实验、采样、测量、统计或计算步骤', '#95E1D3'],
    ['result', '结果陈述', '当前研究直接观察、测量或统计得到的发现', '#FFE66D'],
    ['conclusion', '结论总结', '基于整项研究或多项结果形成的综合结论', '#A8E6CF'],
    ['comparison', '对比分析', '组别、条件、方法、研究或解释之间的明确对比或相似关系', '#FFB6C1'],
    ['limitation', '局限性', '当前研究的弱点、偏倚、不确定性或外推限制', '#DDA0DD'],
    ['future', '未来方向', '明确提出后续研究、验证、重复或开发方向', '#87CEEB'],
    ['causality', '因果关系', '明确声明因素导致、介导、促进、抑制或解释另一结果', '#FFD700'],
    ['emphasis', '强调重要性', '作者明确标记某项发现为重要、显著、意外或核心', '#FF8C00'],
    ['evidence', '提供证据', '明确以数据、图表、分析或既有研究支持当前论点', '#20B2AA'],
    ['interpretation', '结果解释', '解释研究结果的意义、机制、影响或可能原因', '#9370DB']
  ];

  const MAX_REGEX_RULES = 64;
  const MAX_REGEX_LENGTH = 500;
  const MAX_REGEX_REPEAT = 100;
  const MAX_COMPLEX_GROUP_REPEAT = 8;

  const BUILT_IN_REGEX = Object.freeze({
    hypothesis: Object.freeze({
      phrases: Object.freeze([
        'we hypothesize', 'we hypothesized', 'it is hypothesized', 'we propose',
        'we postulate', 'we assume', 'we predict', 'our hypothesis', 'the hypothesis',
        'it can be hypothesized', 'we speculate', 'presumably', 'supposedly',
        'it is conceivable that', 'it is plausible that'
      ]),
      expressions: Object.freeze([])
    }),
    objective: Object.freeze({
      phrases: Object.freeze([
        'the aim', 'the objective', 'the purpose', 'the goal', 'this study aims',
        'we aim to', 'aimed at', 'in order to', 'to investigate', 'to explore',
        'to examine', 'to determine', 'to assess', 'to evaluate', 'to analyze',
        'to identify', 'to clarify', 'to elucidate', 'the present study', 'this work'
      ]),
      expressions: Object.freeze([])
    }),
    method: Object.freeze({
      phrases: Object.freeze([
        'we performed', 'we conducted', 'we used', 'we employed', 'we applied',
        'was performed', 'was conducted', 'was carried out', 'by means of',
        'the method', 'the procedure', 'the protocol'
      ]),
      expressions: Object.freeze([])
    }),
    result: Object.freeze({
      phrases: Object.freeze([
        'we found', 'we observed', 'the results show', 'the results indicate',
        'the results suggest', 'the results demonstrate', 'our findings', 'this result',
        'these results', 'it was found', 'revealed that',
        'demonstrated that'
      ]),
      expressions: Object.freeze([])
    }),
    conclusion: Object.freeze({
      phrases: Object.freeze([
        'in conclusion', 'in summary', 'to summarize', 'to conclude', 'taken together',
        'collectively', 'overall', 'in general', 'we conclude', 'we demonstrate',
        'these findings suggest', 'these results indicate', 'this study demonstrates'
      ]),
      expressions: Object.freeze([])
    }),
    comparison: Object.freeze({
      phrases: Object.freeze([
        'compared to', 'compared with', 'in contrast', 'in comparison', 'by contrast',
        'conversely', 'on the other hand', 'whereas', 'unlike',
        'similar to', 'similarly', 'likewise', 'in the same way', 'correspondingly'
      ]),
      expressions: Object.freeze([])
    }),
    limitation: Object.freeze({
      phrases: Object.freeze([
        'limitation', 'limited by', 'caveat', 'shortcoming', 'weakness', 'disadvantage',
        'drawback', 'constraint', 'it should be noted', 'one limitation', 'a limitation',
        'however, it is important to note'
      ]),
      expressions: Object.freeze([])
    }),
    future: Object.freeze({
      phrases: Object.freeze([
        'future studies', 'future research',
        'future work', 'further investigation', 'further research', 'remains to be',
        'warrant', 'additional studies', 'follow-up', 'going forward', 'in the future'
      ]),
      expressions: Object.freeze([])
    }),
    causality: Object.freeze({
      phrases: Object.freeze([
        'because', 'due to', 'owing to', 'caused by', 'resulted in', 'led to',
        'as a result', 'as a consequence',
        'for this reason', 'attributed to'
      ]),
      expressions: Object.freeze([])
    }),
    emphasis: Object.freeze({
      phrases: Object.freeze([
        'importantly', 'notably', 'remarkably', 'strikingly',
        'particularly', 'especially', 'crucially', 'critically', 'it is important',
        'it is noteworthy', 'of note', 'of particular interest', 'most importantly',
        'more importantly'
      ]),
      expressions: Object.freeze([])
    }),
    evidence: Object.freeze({
      phrases: Object.freeze([
        'evidence suggests', 'evidence indicates', 'studies have shown',
        'research has shown', 'it has been reported', 'previous studies', 'prior research',
        'literature suggests', 'corroborating'
      ]),
      expressions: Object.freeze([])
    }),
    interpretation: Object.freeze({
      phrases: Object.freeze([
        'this suggests', 'this indicates', 'this implies', 'this means',
        'suggesting that', 'indicating that', 'implying that', 'may be explained by',
        'can be explained by', 'is consistent with', 'is in line with',
        'supports the notion', 'supports the view'
      ]),
      expressions: Object.freeze([])
    })
  });

  const BUILT_IN_GUIDANCE = {
    hypothesis: {
      includeWhen: ['作者提出当前研究要检验的假设、预测或理论模型'],
      excludeWhen: ['仅对已观察结果提出可能解释，且没有可检验命题'],
      positiveExamples: ['We hypothesized that microglial C1q drives synapse loss.'],
      negativeExamples: ['This finding may reflect altered neuronal activity.']
    },
    objective: {
      includeWhen: ['明确声明当前研究要回答、检验、确定或评估的问题'],
      excludeWhen: ['描述已实施的方法或已经得到的发现'],
      positiveExamples: ['We sought to determine whether activity alters synaptic density.'],
      negativeExamples: ['We measured synaptic density by confocal microscopy.']
    },
    method: {
      includeWhen: ['描述当前研究实际执行的实验、采样、测量、统计或计算步骤'],
      excludeWhen: ['只声明研究目的、报告结果或引用既有方法而未说明本研究执行'],
      positiveExamples: ['We quantified VGLUT2-positive puncta using confocal microscopy.'],
      negativeExamples: ['Our goal was to quantify synaptic density.']
    },
    result: {
      includeWhen: ['报告当前研究直接观察、测量或统计得到的发现'],
      excludeWhen: ['解释机制、综合多项结果或陈述文献背景'],
      positiveExamples: ['CNO treatment reduced VGLUT2 terminal density.'],
      negativeExamples: ['This reduction may indicate activity-dependent refinement.']
    },
    conclusion: {
      includeWhen: ['综合多项结果或整项研究形成总体结论'],
      excludeWhen: ['只报告单个观察或一般背景事实'],
      positiveExamples: ['Together, these findings demonstrate activity-dependent synaptic refinement.'],
      negativeExamples: ['VGLUT2 density was lower in the treated group.']
    },
    comparison: {
      includeWhen: ['明确比较两个组别、条件、方法、研究或解释的差异或相似性'],
      excludeWhen: ['while 表示实验过程或时间，或者只是普通并列'],
      positiveExamples: ['VGLUT2 density was lower ipsilaterally than contralaterally.'],
      negativeExamples: ['Signals were recorded while animals performed the task.']
    },
    limitation: {
      includeWhen: ['明确说明研究弱点、偏倚、不确定性或外推限制'],
      excludeWhen: ['仅有 however 或 although 转折，未声明研究限制'],
      positiveExamples: ['The small sample size limits generalizability.'],
      negativeExamples: ['However, the groups did not differ at baseline.']
    },
    future: {
      includeWhen: ['明确提出后续研究、验证、重复或开发方向'],
      excludeWhen: ['next 仅表示本文叙事顺序或当前实验下一步'],
      positiveExamples: ['Future studies should test whether this mechanism is reversible.'],
      negativeExamples: ['Next, we measured VGLUT2 density.']
    },
    causality: {
      includeWhen: ['完整片段表达原因或作用因素以及其导致、介导、促进或抑制的结果'],
      excludeWhen: ['孤立连接词；as shown in；as an example；as a marker；since 加年份；过程性 while'],
      positiveExamples: ['Increased neuronal activity caused C1q deposition and reduced synaptic density.'],
      negativeExamples: ['As shown in Fig. 1, synaptic density was reduced.']
    },
    emphasis: {
      includeWhen: ['作者明确评价某项发现为重要、核心、意外或值得注意'],
      excludeWhen: ['significant 仅表示统计显著性，没有重要性评价'],
      positiveExamples: ['Importantly, the effect was restricted to the activated projection zone.'],
      negativeExamples: ['The difference was statistically significant.']
    },
    evidence: {
      includeWhen: ['数据、图表、分析或既有研究被明确用于支持当前论点'],
      excludeWhen: ['仅出现图号、引用或背景事实，没有支持关系'],
      positiveExamples: ['Electrophysiological recordings confirmed increased neuronal activity.'],
      negativeExamples: ['Neuronal activity has been studied previously (12).']
    },
    interpretation: {
      includeWhen: ['解释结果的意义、机制、影响或可能原因'],
      excludeWhen: ['只报告直接结果、研究目的或无解释的结论复述'],
      positiveExamples: ['This suggests that neuronal activity selectively enhances C1q deposition.'],
      negativeExamples: ['C1q deposition increased in the ipsilateral hemisphere.']
    }
  };

  function createBuiltInCategories() {
    return Object.fromEntries(BUILT_INS.map(([categoryId, name, definition, color]) => {
      const guidance = BUILT_IN_GUIDANCE[categoryId];
      return [categoryId, toUnifiedCategory({
        categoryId,
        name,
        definition,
        decisionQuestion: `该原文是否符合“${definition}”，且不是排除情形？`,
        includeAll: [...guidance.includeWhen],
        excludeAny: [...guidance.excludeWhen],
        requiredSlots: [],
        allowedQuoteRoles: ['statement'],
        includeWhen: [...guidance.includeWhen],
        excludeWhen: [...guidance.excludeWhen],
        positiveExamples: [...guidance.positiveExamples],
        negativeExamples: [...guidance.negativeExamples],
        hardNegativeExamples: [...guidance.negativeExamples],
        spanPolicy: 'clause',
        minimumConfidence: 0.8,
        claimMode: 'explicit',
        relationRequired: categoryId === 'causality',
        color,
        version: 3,
        persistence: 'saved',
        builtIn: true
      })];
    }));
  }

  function slugify(value) {
    const ascii = String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    return ascii || 'category';
  }

  function normalizeCustomCategory(input) {
    const name = String(input.name || '').trim();
    return {
      categoryId: input.categoryId || `custom_${slugify(input.idHint || 'clinical')}_${Date.now().toString(36)}`,
      name,
      definition: String(input.definition || '').trim(),
      decisionQuestion: String(input.decisionQuestion || input.definition || '').trim(),
      includeAll: Array.isArray(input.includeAll) ? input.includeAll.map(String) :
        (Array.isArray(input.includeWhen) ? input.includeWhen.map(String) : []),
      excludeAny: Array.isArray(input.excludeAny) ? input.excludeAny.map(String) :
        (Array.isArray(input.excludeWhen) ? input.excludeWhen.map(String) : []),
      requiredSlots: Array.isArray(input.requiredSlots) ? input.requiredSlots.map(String) : [],
      allowedQuoteRoles: Array.isArray(input.allowedQuoteRoles) && input.allowedQuoteRoles.length
        ? input.allowedQuoteRoles.map(String) : ['statement'],
      includeWhen: Array.isArray(input.includeWhen) ? input.includeWhen.map(String) : [],
      excludeWhen: Array.isArray(input.excludeWhen) ? input.excludeWhen.map(String) : [],
      positiveExamples: Array.isArray(input.positiveExamples) ? input.positiveExamples.map(String) : [],
      negativeExamples: Array.isArray(input.negativeExamples) ? input.negativeExamples.map(String) : [],
      hardNegativeExamples: Array.isArray(input.hardNegativeExamples)
        ? input.hardNegativeExamples.map(String)
        : (Array.isArray(input.negativeExamples) ? input.negativeExamples.map(String) : []),
      spanPolicy: input.spanPolicy || 'clause',
      minimumConfidence: Number.isFinite(Number(input.minimumConfidence))
        ? Number(input.minimumConfidence) : 0.8,
      claimMode: ['explicit', 'inferred', 'either'].includes(input.claimMode)
        ? input.claimMode : 'explicit',
      relationRequired: Boolean(input.relationRequired),
      color: input.color || '#2F80ED',
      version: Number.isInteger(input.version) && input.version > 0 ? input.version : 1,
      persistence: input.persistence === 'one-off' ? 'one-off' : 'saved',
      builtIn: false
    };
  }

  function validateCategory(category) {
    const errors = [];
    if (!/^[a-z][a-z0-9_]*$/.test(category.categoryId || '')) errors.push('categoryId');
    if (!String(category.name || '').trim()) errors.push('name');
    if (!String(category.definition || '').trim()) errors.push('definition');
    if (!['phrase', 'clause', 'sentence'].includes(category.spanPolicy)) errors.push('spanPolicy');
    if (!/^#[0-9A-F]{6}$/i.test(category.color || '')) errors.push('color');
    if (!Number.isInteger(category.version) || category.version < 1) errors.push('version');
    return errors;
  }

  function own(object, key) {
    return Object.prototype.hasOwnProperty.call(object || {}, key);
  }

  function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function cloneJsonLike(value) {
    if (Array.isArray(value)) return value.map(cloneJsonLike);
    if (!isPlainObject(value)) return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, cloneJsonLike(nested)])
    );
  }

  function mergeJsonLike(base, override) {
    if (override === undefined) return cloneJsonLike(base);
    if (!isPlainObject(base) || !isPlainObject(override)) {
      return cloneJsonLike(override);
    }
    const result = cloneJsonLike(base);
    Object.entries(override).forEach(([key, value]) => {
      result[key] = own(base, key)
        ? mergeJsonLike(base[key], value)
        : cloneJsonLike(value);
    });
    return result;
  }

  function copyArray(value, fallback = []) {
    return Array.isArray(value) ? value.map(String) : [...fallback];
  }

  function firstArray(...values) {
    const value = values.find(Array.isArray);
    return value ? value.map(String) : [];
  }

  function normalizeMinimumConfidence(value, fallback = 0.8) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function toUnifiedCategory(input = {}) {
    const category = input && typeof input === 'object' ? cloneJsonLike(input) : {};
    const sourcePrompt = isPlainObject(category.prompt)
      ? category.prompt : {};
    const hasExplicitRegex = isPlainObject(category.regex);
    const sourceRegex = hasExplicitRegex ? category.regex : {};
    const legacyPatterns = Array.isArray(category.patterns)
      ? category.patterns.map(String) : null;
    const builtInRegex = BUILT_IN_REGEX[category.categoryId];
    let defaultPhrases = [];
    let defaultExpressions = [];
    if (hasExplicitRegex) {
      defaultPhrases = copyArray(sourceRegex.phrases);
      defaultExpressions = copyArray(sourceRegex.expressions);
    } else if (legacyPatterns) {
      if (category.isRegex === true) defaultExpressions = legacyPatterns;
      else defaultPhrases = legacyPatterns;
    } else if (builtInRegex) {
      defaultPhrases = copyArray(builtInRegex.phrases);
      defaultExpressions = copyArray(builtInRegex.expressions);
    }
    const prompt = {
      ...sourcePrompt,
      definition: String(sourcePrompt.definition ?? category.definition ?? ''),
      decisionQuestion: String(
        sourcePrompt.decisionQuestion ?? category.decisionQuestion ??
        sourcePrompt.definition ?? category.definition ?? ''
      ),
      includeWhen: firstArray(
        sourcePrompt.includeWhen, category.includeWhen, category.includeAll
      ),
      excludeWhen: firstArray(
        sourcePrompt.excludeWhen, category.excludeWhen, category.excludeAny
      ),
      positiveExamples: firstArray(
        sourcePrompt.positiveExamples, category.positiveExamples
      ),
      negativeExamples: firstArray(
        sourcePrompt.negativeExamples, category.negativeExamples,
        category.hardNegativeExamples
      ),
      requiredSlots: firstArray(sourcePrompt.requiredSlots, category.requiredSlots),
      allowedQuoteRoles: firstArray(
        sourcePrompt.allowedQuoteRoles, category.allowedQuoteRoles, ['statement']
      ),
      spanPolicy: sourcePrompt.spanPolicy || category.spanPolicy || 'clause',
      minimumConfidence: normalizeMinimumConfidence(
        sourcePrompt.minimumConfidence ?? category.minimumConfidence
      )
    };
    const regex = {
      ...sourceRegex,
      phrases: defaultPhrases,
      expressions: defaultExpressions,
      caseSensitive: typeof sourceRegex.caseSensitive === 'boolean'
        ? sourceRegex.caseSensitive : false,
      wholeWord: typeof sourceRegex.wholeWord === 'boolean'
        ? sourceRegex.wholeWord : false
    };
    return {
      ...category,
      enabledEngines: Array.isArray(category.enabledEngines)
        ? category.enabledEngines.map(String) : ['llm', 'regex'],
      prompt,
      regex
    };
  }

  function assignPromptOverride(prompt, input, promptKey, legacyKeys, normalizer) {
    if (own(prompt, promptKey)) {
      prompt[promptKey] = normalizer(prompt[promptKey]);
      return;
    }
    const legacyKey = legacyKeys.find(key => own(input, key));
    if (legacyKey) prompt[promptKey] = normalizer(input[legacyKey]);
  }

  function normalizeCategoryOverride(input = {}) {
    const source = input && typeof input === 'object' ? cloneJsonLike(input) : {};
    const normalized = cloneJsonLike(source);
    if (own(source, 'categoryId')) normalized.categoryId = String(source.categoryId);
    if (own(source, 'name')) normalized.name = String(source.name).trim();
    if (own(source, 'color')) normalized.color = String(source.color);
    if (own(source, 'enabledEngines')) {
      normalized.enabledEngines = copyArray(source.enabledEngines);
    }

    const promptSource = isPlainObject(source.prompt)
      ? source.prompt : {};
    const prompt = { ...promptSource };
    const stringValue = value => String(value ?? '').trim();
    const arrayValue = value => copyArray(value);
    assignPromptOverride(prompt, source, 'definition', ['definition'], stringValue);
    assignPromptOverride(
      prompt, source, 'decisionQuestion', ['decisionQuestion'], stringValue
    );
    assignPromptOverride(
      prompt, source, 'includeWhen', ['includeWhen', 'includeAll'], arrayValue
    );
    assignPromptOverride(
      prompt, source, 'excludeWhen', ['excludeWhen', 'excludeAny'], arrayValue
    );
    assignPromptOverride(
      prompt, source, 'positiveExamples', ['positiveExamples'], arrayValue
    );
    assignPromptOverride(
      prompt, source, 'negativeExamples',
      ['negativeExamples', 'hardNegativeExamples'], arrayValue
    );
    assignPromptOverride(
      prompt, source, 'requiredSlots', ['requiredSlots'], arrayValue
    );
    assignPromptOverride(
      prompt, source, 'allowedQuoteRoles', ['allowedQuoteRoles'], arrayValue
    );
    assignPromptOverride(prompt, source, 'spanPolicy', ['spanPolicy'], stringValue);
    assignPromptOverride(
      prompt, source, 'minimumConfidence', ['minimumConfidence'],
      value => normalizeMinimumConfidence(value)
    );
    if (own(source, 'prompt') || Object.keys(prompt).length) normalized.prompt = prompt;

    const regexSource = isPlainObject(source.regex)
      ? source.regex : {};
    const regex = { ...regexSource };
    if (own(regexSource, 'phrases')) regex.phrases = copyArray(regexSource.phrases);
    if (own(regexSource, 'expressions')) {
      regex.expressions = copyArray(regexSource.expressions);
    }
    if (own(regexSource, 'caseSensitive')) {
      regex.caseSensitive = Boolean(regexSource.caseSensitive);
    }
    if (own(regexSource, 'wholeWord')) regex.wholeWord = Boolean(regexSource.wholeWord);
    if (Array.isArray(source.patterns) && !own(regexSource, 'phrases') &&
        !own(regexSource, 'expressions')) {
      regex[source.isRegex ? 'expressions' : 'phrases'] = copyArray(source.patterns);
    }
    if (own(source, 'regex') || Object.keys(regex).length) normalized.regex = regex;
    return normalized;
  }

  function flattenUnifiedCategory(input = {}) {
    const category = toUnifiedCategory(input);
    const prompt = category.prompt;
    return {
      ...category,
      definition: prompt.definition,
      decisionQuestion: prompt.decisionQuestion,
      includeAll: [...prompt.includeWhen],
      excludeAny: [...prompt.excludeWhen],
      requiredSlots: [...prompt.requiredSlots],
      allowedQuoteRoles: [...prompt.allowedQuoteRoles],
      includeWhen: [...prompt.includeWhen],
      excludeWhen: [...prompt.excludeWhen],
      positiveExamples: [...prompt.positiveExamples],
      negativeExamples: [...prompt.negativeExamples],
      hardNegativeExamples: [...prompt.negativeExamples],
      spanPolicy: prompt.spanPolicy,
      minimumConfidence: prompt.minimumConfidence
    };
  }

  function mergeCategoryOverrides(category, override = {}) {
    const base = toUnifiedCategory(category);
    const normalizedOverride = normalizeCategoryOverride(override);
    return flattenUnifiedCategory(mergeJsonLike(base, normalizedOverride));
  }

  function readRegexQuantifier(source, index) {
    const character = source[index];
    if (character === '*' || character === '+') {
      return {
        length: 1,
        minimum: character === '+' ? 1 : 0,
        maximum: Infinity,
        unbounded: true
      };
    }
    if (character === '?') {
      return { length: 1, minimum: 0, maximum: 1, unbounded: false };
    }
    if (character !== '{') return null;
    const match = source.slice(index).match(/^\{(\d+)(?:,(\d*))?\}/);
    if (!match) return null;
    const minimum = Number(match[1]);
    const hasComma = match[2] !== undefined;
    const maximum = hasComma
      ? (match[2] === '' ? Infinity : Number(match[2]))
      : minimum;
    return {
      length: match[0].length,
      minimum,
      maximum,
      unbounded: maximum === Infinity
    };
  }

  function hasUnsafeQuantifierStructure(source) {
    const groups = [];
    let inCharacterClass = false;
    let unboundedQuantifiers = 0;
    for (let index = 0; index < source.length; index += 1) {
      const character = source[index];
      if (character === '\\') {
        index += 1;
        continue;
      }
      if (inCharacterClass) {
        if (character === ']') inCharacterClass = false;
        continue;
      }
      if (character === '[') {
        inCharacterClass = true;
        continue;
      }
      if (character === '(') {
        if (groups.length) groups[groups.length - 1].hasNestedGroup = true;
        groups.push({
          start: index,
          hasAlternation: false,
          hasQuantifier: false,
          hasNestedGroup: false
        });
        continue;
      }
      if (character === ')') {
        const group = groups.pop();
        if (!group) continue;
        const outerQuantifier = readRegexQuantifier(source, index + 1);
        const isComplex = group.hasAlternation || group.hasQuantifier ||
          group.hasNestedGroup;
        const groupSource = source.slice(group.start + 1, index)
          .replace(/^\?(?::|=|!|<[=!])/, '');
        if (outerQuantifier && outerQuantifier.maximum > 1 &&
            group.hasAlternation && hasAmbiguousAlternation(groupSource)) {
          return true;
        }
        if (outerQuantifier && isComplex &&
            outerQuantifier.maximum > MAX_COMPLEX_GROUP_REPEAT) {
          return true;
        }
        continue;
      }
      const group = groups[groups.length - 1];
      if (character === '|' && group) {
        group.hasAlternation = true;
        continue;
      }
      const quantifier = readRegexQuantifier(source, index);
      const isGroupPrefix = character === '?' && group && index === group.start + 1;
      if (quantifier && !isGroupPrefix) {
        if (Number.isFinite(quantifier.maximum) &&
            quantifier.maximum > MAX_REGEX_REPEAT) {
          return true;
        }
        if (quantifier.unbounded) {
          unboundedQuantifiers += 1;
          if (unboundedQuantifiers > 1) return true;
        }
        if (group) group.hasQuantifier = true;
        index += quantifier.length - 1;
      }
    }
    return false;
  }

  function atomCharacterSet(source) {
    if (!source) return { any: true, values: new Set() };
    if (source === '.') return { any: true, values: new Set() };
    if (source[0] === '\\') {
      const escaped = source[1] || '';
      if ('dDsSwW'.includes(escaped)) {
        return { any: false, values: new Set([`\\${escaped.toLowerCase()}`]) };
      }
      return { any: false, values: new Set([escaped]) };
    }
    if (source[0] !== '[') {
      return { any: false, values: new Set([source[0]]) };
    }
    if (source[1] === '^') return { any: true, values: new Set() };
    const values = new Set();
    for (let index = 1; index < source.length - 1; index += 1) {
      if (source[index] === '\\' && index + 1 < source.length - 1) {
        values.add(`\\${source[index + 1].toLowerCase()}`);
        index += 1;
        continue;
      }
      if (source[index] === '-' && index > 1 && index + 1 < source.length - 1) {
        const start = source.charCodeAt(index - 1);
        const end = source.charCodeAt(index + 1);
        if (start <= end && end - start <= 64) {
          for (let code = start; code <= end; code += 1) {
            values.add(String.fromCharCode(code));
          }
        } else {
          return { any: true, values: new Set() };
        }
        index += 1;
        continue;
      }
      values.add(source[index]);
    }
    return { any: false, values };
  }

  function characterSetsOverlap(left, right) {
    if (left.any || right.any) return true;
    for (const value of left.values) {
      if (right.values.has(value)) return true;
      if (value === '\\w' && right.values.has('\\d')) return true;
      if (value === '\\d' && right.values.has('\\w')) return true;
    }
    return false;
  }

  function readSimpleRegexAtom(source, index) {
    const character = source[index];
    if (character === '\\' && index + 1 < source.length) {
      return { source: source.slice(index, index + 2), length: 2 };
    }
    if (character === '[') {
      let cursor = index + 1;
      if (source[cursor] === '^') cursor += 1;
      for (; cursor < source.length; cursor += 1) {
        if (source[cursor] === '\\') {
          cursor += 1;
          continue;
        }
        if (source[cursor] === ']') {
          return {
            source: source.slice(index, cursor + 1),
            length: cursor - index + 1
          };
        }
      }
      return null;
    }
    if ('()|^$*+?{}'.includes(character)) return null;
    return { source: character, length: 1 };
  }

  function readRegexGroup(source, index) {
    if (source[index] !== '(') return null;
    let depth = 0;
    let inCharacterClass = false;
    for (let cursor = index; cursor < source.length; cursor += 1) {
      const character = source[cursor];
      if (character === '\\') {
        cursor += 1;
        continue;
      }
      if (inCharacterClass) {
        if (character === ']') inCharacterClass = false;
        continue;
      }
      if (character === '[') {
        inCharacterClass = true;
        continue;
      }
      if (character === '(') depth += 1;
      if (character !== ')') continue;
      depth -= 1;
      if (depth !== 0) continue;
      const rawBody = source.slice(index + 1, cursor);
      const structuralPrefix = rawBody.match(/^\?(?::|=|!|<=|<!)/)?.[0] || '';
      const namedCapturePrefix = structuralPrefix
        ? '' : (rawBody.match(/^\?<[^>]+>/)?.[0] || '');
      const prefix = structuralPrefix || namedCapturePrefix;
      return {
        body: rawBody.slice(prefix.length),
        length: cursor - index + 1,
        zeroWidth: ['?=', '?!', '?<=', '?<!'].includes(structuralPrefix)
      };
    }
    return null;
  }

  function readSimpleFiniteRepeat(source, index) {
    const atom = readSimpleRegexAtom(source, index);
    if (!atom) return null;
    const quantifier = readRegexQuantifier(source, index + atom.length);
    const variableFinite = quantifier && Number.isFinite(quantifier.maximum) &&
      quantifier.minimum !== quantifier.maximum;
    if (!variableFinite) return null;
    const modifierIndex = index + atom.length + quantifier.length;
    const modifierLength = source[modifierIndex] === '?' ? 1 : 0;
    return {
      characterSet: atomCharacterSet(atom.source),
      length: atom.length + quantifier.length + modifierLength
    };
  }

  function isEffectivelyZeroWidthGroup(group) {
    if (!group) return false;
    if (group.zeroWidth || group.body === '') return true;
    let index = 0;
    while (index < group.body.length) {
      const nested = readRegexGroup(group.body, index);
      if (!nested || !isEffectivelyZeroWidthGroup(nested)) return false;
      index += nested.length;
    }
    return true;
  }

  function readFiniteRepeatToken(source, index) {
    const simple = readSimpleFiniteRepeat(source, index);
    if (simple) return simple;
    const group = readRegexGroup(source, index);
    if (!group || group.zeroWidth) return null;
    const outerQuantifier = readRegexQuantifier(source, index + group.length);
    const variableOuter = outerQuantifier && Number.isFinite(outerQuantifier.maximum) &&
      outerQuantifier.minimum !== outerQuantifier.maximum;
    if (variableOuter) {
      const modifierIndex = index + group.length + outerQuantifier.length;
      const modifierLength = source[modifierIndex] === '?' ? 1 : 0;
      return {
        characterSet: firstBranchCharacterSet(group.body),
        length: group.length + outerQuantifier.length + modifierLength
      };
    }
    const inner = readFiniteRepeatToken(group.body, 0);
    if (!inner || inner.length !== group.body.length) return null;
    return {
      characterSet: inner.characterSet,
      length: group.length
    };
  }

  function hasAdjacentOverlappingFiniteQuantifiers(source) {
    let previous = null;
    for (let index = 0; index < source.length;) {
      const group = readRegexGroup(source, index);
      if (isEffectivelyZeroWidthGroup(group)) {
        const quantifier = readRegexQuantifier(source, index + group.length);
        let transparentLength = group.length + (quantifier?.length || 0);
        if (source[index + transparentLength] === '?') transparentLength += 1;
        index += transparentLength;
        continue;
      }
      const token = readFiniteRepeatToken(source, index);
      if (!token) {
        previous = null;
        index += group?.length || 1;
        continue;
      }
      const current = token.characterSet;
      if (previous && characterSetsOverlap(previous, current)) return true;
      previous = current;
      index += token.length;
    }
    return false;
  }

  function firstBranchCharacterSet(branch) {
    let index = 0;
    while (index < branch.length && '^'.includes(branch[index])) index += 1;
    const atom = readSimpleRegexAtom(branch, index);
    return atom ? atomCharacterSet(atom.source) : { any: true, values: new Set() };
  }

  function hasAmbiguousAlternation(source) {
    const branches = [];
    let depth = 0;
    let inCharacterClass = false;
    let start = 0;
    for (let index = 0; index < source.length; index += 1) {
      const character = source[index];
      if (character === '\\') {
        index += 1;
        continue;
      }
      if (inCharacterClass) {
        if (character === ']') inCharacterClass = false;
        continue;
      }
      if (character === '[') {
        inCharacterClass = true;
        continue;
      }
      if (character === '(') depth += 1;
      else if (character === ')') depth = Math.max(0, depth - 1);
      else if (character === '|' && depth === 0) {
        branches.push(source.slice(start, index));
        start = index + 1;
      }
    }
    branches.push(source.slice(start));
    if (branches.length < 2) return false;
    const sets = branches.map(firstBranchCharacterSet);
    for (let left = 0; left < sets.length; left += 1) {
      for (let right = left + 1; right < sets.length; right += 1) {
        if (characterSetsOverlap(sets[left], sets[right])) return true;
      }
    }
    return false;
  }

  function hasUnsafeRegexStructure(expression) {
    const source = String(expression);
    const simplified = source
      .replace(/\\./g, '')
      .replace(/\[(?:\\.|[^\]\\])*\]/g, '');
    const repeatedWildcard = /\.(?:\*|\+)(?:\?|\+)?[^|)]*\.(?:\*|\+)/;
    return hasUnsafeQuantifierStructure(source) ||
      hasAdjacentOverlappingFiniteQuantifiers(source) ||
      repeatedWildcard.test(simplified);
  }

  function validateUnifiedCategory(category) {
    const prompt = category?.prompt;
    const errors = validateCategory({
      ...(category || {}),
      definition: prompt?.definition,
      spanPolicy: prompt?.spanPolicy
    }).filter(error => !['definition', 'spanPolicy'].includes(error));
    const engines = category?.enabledEngines;
    if (!Array.isArray(engines) ||
        engines.some(engine => !['llm', 'regex'].includes(engine))) {
      errors.push('enabledEngines');
    }

    if (!prompt || typeof prompt !== 'object' || Array.isArray(prompt)) {
      errors.push('prompt');
    } else {
      if (typeof prompt.definition !== 'string' || !prompt.definition.trim()) {
        errors.push('prompt.definition');
      }
      if (typeof prompt.decisionQuestion !== 'string') {
        errors.push('prompt.decisionQuestion');
      }
      [
        'includeWhen', 'excludeWhen', 'positiveExamples', 'negativeExamples',
        'requiredSlots', 'allowedQuoteRoles'
      ].forEach(field => {
        if (!Array.isArray(prompt[field]) ||
            prompt[field].some(value => typeof value !== 'string')) {
          errors.push(`prompt.${field}`);
        }
      });
      if (!['phrase', 'clause', 'sentence'].includes(prompt.spanPolicy)) {
        errors.push('prompt.spanPolicy');
      }
      if (!Number.isFinite(prompt.minimumConfidence) ||
          prompt.minimumConfidence < 0 || prompt.minimumConfidence > 1) {
        errors.push('prompt.minimumConfidence');
      }
    }

    const regex = category?.regex;
    if (!regex || typeof regex !== 'object' || Array.isArray(regex)) {
      errors.push('regex');
    } else {
      ['phrases', 'expressions'].forEach(field => {
        if (!Array.isArray(regex[field])) {
          errors.push(`regex.${field}`);
          return;
        }
        if (regex[field].length > MAX_REGEX_RULES) errors.push(`regex.${field}`);
        regex[field].forEach((value, index) => {
          const path = `regex.${field}.${index}`;
          if (typeof value !== 'string') {
            errors.push(path);
            return;
          }
          if (value.length > MAX_REGEX_LENGTH) {
            errors.push(path);
            return;
          }
          if (field === 'expressions') {
            if (hasUnsafeRegexStructure(value)) {
              errors.push(path);
              return;
            }
            let compiled;
            try {
              compiled = new RegExp(value);
            } catch (_) {
              errors.push(path);
              return;
            }
            if (compiled.test('')) errors.push(path);
          }
        });
      });
      if (typeof regex.caseSensitive !== 'boolean') errors.push('regex.caseSensitive');
      if (typeof regex.wholeWord !== 'boolean') errors.push('regex.wholeWord');
    }
    return [...new Set(errors)];
  }

  function compileCategoryPromptPreview(input) {
    const category = flattenUnifiedCategory(input);
    const prompt = category.prompt;
    const list = values => values.length
      ? values.map((value, index) => `${index + 1}. ${value}`).join('\n')
      : '（无）';
    return [
      `类别：${category.name}（${category.categoryId}）`,
      `定义：${prompt.definition}`,
      `判定问题：${prompt.decisionQuestion}`,
      `应当包含：\n${list(prompt.includeWhen)}`,
      `应当排除：\n${list(prompt.excludeWhen)}`,
      `正例：\n${list(prompt.positiveExamples)}`,
      `反例：\n${list(prompt.negativeExamples)}`,
      `必需信息槽：${prompt.requiredSlots.join('、') || '（无）'}`,
      `允许的引用角色：${prompt.allowedQuoteRoles.join('、') || '（无）'}`,
      `片段策略：${prompt.spanPolicy}`,
      `最低置信度：${prompt.minimumConfidence}`
    ].join('\n\n');
  }

  return {
    MAX_REGEX_RULES,
    MAX_REGEX_LENGTH,
    MAX_REGEX_REPEAT,
    MAX_COMPLEX_GROUP_REPEAT,
    BUILT_IN_REGEX,
    createBuiltInCategories,
    normalizeCustomCategory,
    validateCategory,
    toUnifiedCategory,
    normalizeCategoryOverride,
    mergeCategoryOverrides,
    flattenUnifiedCategory,
    validateUnifiedCategory,
    hasUnsafeRegexStructure,
    compileCategoryPromptPreview
  };
});
