(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const PRESENTATION_SCHEMA_VERSION = 1;
  const PRESENTATION_MODES = Object.freeze([
    'inline_highlight', 'inline_badge', 'relation_card', 'audit_warning', 'special'
  ]);
  const VISIBILITY_TIERS = Object.freeze(['core', 'expanded', 'expert']);
  const DISPLAY_FAMILIES = Object.freeze({
    context: family('context', '语境', 'Context', '#64748b'),
    question: family('question', '问题', 'Question', '#7c3aed'),
    design: family('design', '设计', 'Design', '#0f766e'),
    evidence: family('evidence', '证据', 'Evidence', '#2563eb'),
    interpretation: family('interpretation', '解释', 'Interpretation', '#b45309'),
    validation: family('validation', '验证', 'Validation', '#15803d'),
    boundary: family('boundary', '边界', 'Boundary', '#b42318')
  });

  function family(id, labelZh, labelEn, color) {
    return Object.freeze({
      id, labelZh, labelEn, color,
      cssVariable: `--sci-family-${id}`
    });
  }

  function presentation(displayFamilyId, presentationMode, shortLabelZh, shortLabelEn,
    defaultVisibilityTier = 'core', showInlineAnchor = undefined) {
    const relationLike = presentationMode === 'relation_card' ||
      presentationMode === 'audit_warning';
    return Object.freeze({
      displayFamilyId,
      presentationMode,
      showInlineAnchor: showInlineAnchor === undefined ? relationLike : Boolean(showInlineAnchor),
      defaultVisibilityTier,
      shortLabelZh,
      shortLabelEn
    });
  }

  const CATEGORY_PRESENTATION = Object.freeze({
    known_background: presentation('context', 'inline_highlight', '背景', 'Background'),
    scientific_question: presentation('question', 'inline_highlight', '问题', 'Question'),
    review_question: presentation('boundary', 'inline_highlight', '原文存疑', 'Author concern'),
    knowledge_gap: presentation('question', 'inline_highlight', '缺口', 'Gap'),
    objective: presentation('question', 'inline_badge', '目标', 'Objective'),
    hypothesis: presentation('question', 'inline_badge', '假设', 'Hypothesis'),
    study_strategy: presentation('design', 'inline_highlight', '策略', 'Strategy'),
    method: presentation('design', 'inline_highlight', '方法', 'Method'),
    result: presentation('evidence', 'inline_highlight', '结果', 'Result'),
    key_result: presentation('evidence', 'inline_badge', '关键', 'Key'),
    interpretation: presentation('interpretation', 'inline_highlight', '解释', 'Interpretation'),
    conclusion: presentation('interpretation', 'inline_badge', '结论', 'Conclusion'),
    significance_novelty: presentation('interpretation', 'inline_badge', '创新', 'Novelty'),
    limitation: presentation('boundary', 'inline_highlight', '局限', 'Limitation'),
    future: presentation('boundary', 'inline_highlight', '未来', 'Future'),

    driver_intervention: presentation('design', 'inline_badge', '干预', 'Intervention'),
    association_evidence: presentation('evidence', 'relation_card', '相关', 'Association'),
    causal_effect: presentation('evidence', 'relation_card', '因果', 'Causal'),
    mechanism_mediator: presentation('interpretation', 'relation_card', '中介', 'Mediator'),
    necessity_evidence: presentation('validation', 'relation_card', '必要', 'Necessary'),
    sufficiency_evidence: presentation('validation', 'relation_card', '充分', 'Sufficient'),
    rescue_evidence: presentation('validation', 'relation_card', 'Rescue', 'Rescue'),
    temporal_dose_evidence: presentation('validation', 'relation_card', '时序/剂量', 'Time/dose'),
    cross_system_validation: presentation('validation', 'relation_card', '外部验证', 'Cross-system'),
    mechanism_gap: presentation('boundary', 'inline_highlight', '机制缺口', 'Mechanism gap'),
    alternative_mechanism: presentation('boundary', 'relation_card', '替代机制', 'Alternative'),

    design_control: presentation('design', 'inline_highlight', '对照', 'Control'),
    sample_population: presentation('context', 'inline_highlight', '样本', 'Sample'),
    measurement_validity: presentation('validation', 'inline_highlight', '测量', 'Measurement'),
    effect_uncertainty: presentation('evidence', 'inline_highlight', '不确定性', 'Uncertainty'),
    statistical_robustness: presentation('validation', 'inline_highlight', '稳健性', 'Robustness'),
    confounding_reverse_causality: presentation('boundary', 'audit_warning', '混杂/反向', 'Confounding'),
    causal_overreach: presentation('boundary', 'audit_warning', '因果越界', 'Overreach'),
    alternative_explanation: presentation('boundary', 'audit_warning', '替代解释', 'Alternative'),
    replication_external_validation: presentation('validation', 'relation_card', '外部验证', 'Replication'),
    generalizability: presentation('boundary', 'inline_highlight', '外推', 'Generalizability'),
    statistical_vs_practical_significance: presentation('evidence', 'relation_card', '实际意义', 'Practical'),
    transparency_reproducibility: presentation('validation', 'inline_highlight', '可复现', 'Reproducibility'),

    review_scope_thesis: presentation('context', 'inline_highlight', '范围', 'Scope'),
    evidence_consensus: presentation('evidence', 'relation_card', '共识', 'Consensus'),
    conflicting_evidence: presentation('evidence', 'relation_card', '冲突', 'Conflict'),
    heterogeneity_source: presentation('boundary', 'relation_card', '异质性', 'Heterogeneity'),
    evidence_quality_certainty: presentation('validation', 'inline_highlight', '证据质量', 'Certainty'),
    integrative_framework: presentation('interpretation', 'inline_badge', '框架', 'Framework'),
    author_synthesis: presentation('interpretation', 'inline_badge', '综合', 'Synthesis'),

    comparison: presentation('evidence', 'inline_highlight', '比较', 'Comparison', 'expert', false),
    causality: presentation('evidence', 'relation_card', '因果', 'Causality', 'expert'),
    emphasis: presentation('interpretation', 'inline_highlight', '强调', 'Emphasis', 'expert', false),
    evidence: presentation('evidence', 'inline_highlight', '证据', 'Evidence'),
    semantic_match: presentation(null, 'special', '检索', 'Match', 'expert', false)
  });

  const VIEW_VISIBILITY_OVERRIDES = Object.freeze({
    quick_story: viewTiers(
      ['knowledge_gap', 'objective', 'hypothesis', 'study_strategy', 'key_result',
        'interpretation', 'conclusion', 'significance_novelty', 'limitation'],
      ['known_background', 'result'],
      ['method']
    ),
    mechanism_chain: viewTiers(
      ['driver_intervention', 'association_evidence', 'causal_effect',
        'mechanism_mediator', 'necessity_evidence', 'sufficiency_evidence',
        'rescue_evidence', 'cross_system_validation', 'mechanism_gap'],
      ['temporal_dose_evidence', 'alternative_mechanism', 'interpretation'],
      ['evidence']
    ),
    critical_review: viewTiers(
      ['design_control', 'sample_population', 'measurement_validity',
        'effect_uncertainty', 'statistical_robustness',
        'confounding_reverse_causality', 'causal_overreach',
        'alternative_explanation', 'replication_external_validation',
        'generalizability', 'limitation'],
      ['statistical_vs_practical_significance', 'transparency_reproducibility'],
      []
    ),
    review_synthesis: viewTiers(
      ['review_scope_thesis', 'evidence_consensus', 'conflicting_evidence',
        'heterogeneity_source', 'evidence_quality_certainty',
        'integrative_framework', 'author_synthesis', 'knowledge_gap',
        'limitation', 'future'],
      ['conclusion'],
      ['evidence']
    )
  });

  function viewTiers(core, expanded, expert) {
    return Object.freeze(Object.fromEntries([
      ...core.map(id => [id, 'core']),
      ...expanded.map(id => [id, 'expanded']),
      ...expert.map(id => [id, 'expert'])
    ]));
  }

  const STUDY_VIEW_RECOMMENDATIONS = Object.freeze({
    basic_mechanistic: recommendation('quick_story', ['mechanism_chain', 'critical_review']),
    preclinical_translational: recommendation('quick_story', ['mechanism_chain', 'critical_review']),
    observational: recommendation('quick_story', ['critical_review']),
    clinical_trial: recommendation('quick_story', ['critical_review']),
    diagnostic_prognostic: recommendation('quick_story', ['critical_review']),
    omics_high_throughput: recommendation('quick_story', ['critical_review']),
    narrative_review: recommendation('review_synthesis', ['quick_story']),
    systematic_review_meta: recommendation('review_synthesis', ['critical_review']),
    methods_resource: recommendation('quick_story', ['critical_review'])
  });

  function recommendation(defaultViewId, recommendedViewIds) {
    return Object.freeze({ defaultViewId, recommendedViewIds: Object.freeze(recommendedViewIds) });
  }

  const FAMILY_PRIORITY = Object.freeze({
    boundary: 7,
    validation: 6,
    evidence: 5,
    interpretation: 4,
    question: 3,
    design: 2,
    context: 1
  });
  const MODE_PRIORITY = Object.freeze({
    audit_warning: 100,
    relation_card: 20,
    inline_badge: 10,
    inline_highlight: 5,
    special: 0
  });

  function normalizeDensity(value) {
    return value === 'expanded' || value === 'expert' || value === 'all'
      ? (value === 'all' ? 'expert' : value)
      : 'core';
  }

  function isBuiltInReadingView(viewId) {
    return Object.prototype.hasOwnProperty.call(VIEW_VISIBILITY_OVERRIDES, String(viewId || ''));
  }

  function presentationForCategory(categoryId, category = null) {
    const id = String(categoryId || '');
    const builtIn = CATEGORY_PRESENTATION[id];
    if (builtIn) return { categoryId: id, builtIn: true, ...builtIn };
    return {
      categoryId: id,
      builtIn: false,
      displayFamilyId: null,
      presentationMode: 'inline_highlight',
      showInlineAnchor: true,
      defaultVisibilityTier: 'core',
      shortLabelZh: String(category?.name || id).slice(0, 24),
      shortLabelEn: String(category?.name || id).slice(0, 24)
    };
  }

  function visibilityTierForCategory(viewId, categoryId, category = null) {
    const id = String(categoryId || '');
    const override = VIEW_VISIBILITY_OVERRIDES[String(viewId || '')];
    if (!override) return presentationForCategory(id, category).defaultVisibilityTier;
    if (Object.prototype.hasOwnProperty.call(override, id)) return override[id];
    return CATEGORY_PRESENTATION[id] ? 'expert' : 'core';
  }

  function categoryVisibleAtDensity(viewId, categoryId, density, category = null) {
    if (!isBuiltInReadingView(viewId)) return true;
    const tier = visibilityTierForCategory(viewId, categoryId, category);
    return VISIBILITY_TIERS.indexOf(tier) <= VISIBILITY_TIERS.indexOf(normalizeDensity(density));
  }

  function visibleCategoryIds(viewId, density, categoryIds = [], categoryMap = {}) {
    return (Array.isArray(categoryIds) ? categoryIds : [])
      .map(String)
      .filter(id => categoryVisibleAtDensity(viewId, id, density, categoryMap[id]));
  }

  function decoratedCategory(item, categoryMap = {}) {
    const categoryId = String(item?.categoryId || '');
    const category = categoryMap[categoryId] || {};
    const meta = presentationForCategory(categoryId, category);
    return {
      ...item,
      ...meta,
      categoryName: String(category.name || categoryId),
      color: String(category.color || item?.color ||
        DISPLAY_FAMILIES[meta.displayFamilyId]?.color || '#2f80ed')
    };
  }

  function presentationRank(item) {
    return (MODE_PRIORITY[item.presentationMode] || 0) * 100 +
      (FAMILY_PRIORITY[item.displayFamilyId] || 0);
  }

  function resolveAnnotationPresentation(annotation, options = {}) {
    const categoryMap = options.categoryMap || {};
    const hiddenFamilies = new Set((options.hiddenFamilyIds || []).map(String));
    const categories = (Array.isArray(annotation?.categories) ? annotation.categories : [])
      .filter(item => categoryVisibleAtDensity(
        options.viewId, item?.categoryId, options.density, categoryMap[item?.categoryId]
      ))
      .map(item => decoratedCategory(item, categoryMap))
      .filter(item => !item.displayFamilyId || !hiddenFamilies.has(item.displayFamilyId))
      .sort((left, right) =>
        presentationRank(right) - presentationRank(left) ||
        left.categoryId.localeCompare(right.categoryId)
      );
    const primary = categories[0] || null;
    const auditCategories = categories.filter(item => item.presentationMode === 'audit_warning');
    const relationCategories = categories.filter(item => item.presentationMode === 'relation_card');
    const badgeCategories = categories.filter((item, index) =>
      ['inline_badge', 'relation_card', 'audit_warning'].includes(item.presentationMode) ||
      (categories.length > 1 && index > 0)
    );
    const familyIds = [...new Set(categories.map(item => item.displayFamilyId).filter(Boolean))];
    const visibleMode = auditCategories.length
      ? 'audit_warning'
      : relationCategories.length && !categories.some(item =>
        item.presentationMode === 'inline_highlight' || item.presentationMode === 'inline_badge')
        ? 'relation_card'
        : primary?.presentationMode || '';
    return {
      ...annotation,
      categories,
      primary,
      auditCategories,
      relationCategories,
      badgeCategories,
      familyIds,
      visibleMode,
      badgeLabels: badgeCategories.map(item => item.shortLabelZh),
      badgeLabelZh: badgeLabel(badgeCategories, 'shortLabelZh'),
      badgeLabelEn: badgeLabel(badgeCategories, 'shortLabelEn'),
      hiddenCategoryCount: Math.max(0,
        (Array.isArray(annotation?.categories) ? annotation.categories.length : 0) - categories.length
      )
    };
  }

  function badgeLabel(items, key) {
    const labels = [...new Set(items.map(item => item[key]).filter(Boolean))];
    if (labels.length <= 3) return labels.join(' · ');
    return `${labels.slice(0, 2).join(' · ')} +${labels.length - 2}`;
  }

  function resolveAnnotationPresentations(annotations, options = {}) {
    return (Array.isArray(annotations) ? annotations : [])
      .map(item => resolveAnnotationPresentation(item, options))
      .filter(item => item.categories.length && item.visibleMode !== 'special');
  }

  function familyLegend(annotations, options = {}) {
    const categoryMap = options.categoryMap || {};
    const counts = {};
    resolveAnnotationPresentations(annotations, { ...options, hiddenFamilyIds: [] })
      .forEach(annotation => {
        annotation.familyIds.forEach(familyId => {
          counts[familyId] = (counts[familyId] || 0) + 1;
        });
      });
    return Object.keys(DISPLAY_FAMILIES).filter(id => counts[id]).map(id => ({
      ...DISPLAY_FAMILIES[id],
      count: counts[id],
      hidden: (options.hiddenFamilyIds || []).includes(id),
      categories: Object.values(categoryMap).filter(category =>
        presentationForCategory(category.categoryId, category).displayFamilyId === id
      ).map(category => category.categoryId)
    }));
  }

  function validatePresentationRegistry(categoryIds = Object.keys(CATEGORY_PRESENTATION)) {
    const errors = [];
    const supplied = new Set((Array.isArray(categoryIds) ? categoryIds : []).map(String));
    supplied.forEach(categoryId => {
      const item = CATEGORY_PRESENTATION[categoryId];
      if (!item) {
        errors.push(`missing:${categoryId}`);
        return;
      }
      if (categoryId !== 'semantic_match' && !DISPLAY_FAMILIES[item.displayFamilyId]) {
        errors.push(`family:${categoryId}`);
      }
      if (!PRESENTATION_MODES.includes(item.presentationMode)) errors.push(`mode:${categoryId}`);
      if (!VISIBILITY_TIERS.includes(item.defaultVisibilityTier)) errors.push(`tier:${categoryId}`);
    });
    Object.entries(VIEW_VISIBILITY_OVERRIDES).forEach(([viewId, tiers]) => {
      Object.entries(tiers).forEach(([categoryId, tier]) => {
        if (!supplied.has(categoryId)) errors.push(`view-category:${viewId}:${categoryId}`);
        if (!VISIBILITY_TIERS.includes(tier)) errors.push(`view-tier:${viewId}:${categoryId}`);
      });
    });
    return errors;
  }

  return {
    PRESENTATION_SCHEMA_VERSION,
    PRESENTATION_MODES,
    VISIBILITY_TIERS,
    DISPLAY_FAMILIES,
    CATEGORY_PRESENTATION,
    VIEW_VISIBILITY_OVERRIDES,
    STUDY_VIEW_RECOMMENDATIONS,
    FAMILY_PRIORITY,
    MODE_PRIORITY,
    normalizePresentationDensity: normalizeDensity,
    isBuiltInReadingView,
    presentationForCategory,
    visibilityTierForCategory,
    categoryVisibleAtDensity,
    visibleCategoryIds,
    resolveAnnotationPresentation,
    resolveAnnotationPresentations,
    familyLegend,
    validatePresentationRegistry
  };
});
