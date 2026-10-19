(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  function defineTask(
    id,
    group,
    labelZh,
    requirements,
    budgetKind,
    unitLabelZh,
    defaultReasoning = 'auto',
    defaultTokenRule = 'auto'
  ) {
    return Object.freeze({
      id,
      group,
      labelZh,
      requirements: Object.freeze({ ...requirements }),
      budgetKind,
      unitLabelZh,
      defaultReasoning,
      defaultTokenRule
    });
  }

  const TASK_DEFINITIONS = Object.freeze([
    defineTask('document_highlight', 'reading', '文献高亮', {}, 'highlight', '篇文献'),
    defineTask('literature_radar_query', 'reading', '文献雷达检索式（全局默认）', { textGeneration: true }, 'singleSummary', '条检索式'),
    defineTask('semantic_find', 'reading', '语义查找', {
      typedDecisions: true,
      decisionType: 'noul'
    }, 'highlight', '个候选片段'),
    defineTask('evidence_ledger_review', 'reading', '证据台账审阅', {}, 'batchSummary', '条证据'),
    defineTask('paragraph_summary', 'summary', '段落总结', {}, 'singleSummary', '个段落'),
    defineTask('article_outline_summary', 'summary', '文章大纲总结', {}, 'batchSummary', '篇文章'),
    defineTask('abbreviation_translation', 'reading', '缩写释义与翻译', {}, 'singleSummary', '个缩写'),
    defineTask('figure_walkthrough', 'figure', '图表解读', { vision: true, captionContext: true }, 'figure', '张图'),
    defineTask('figure_panel_interpretation', 'figure', '图版解读', { vision: true, captionContext: true }, 'figurePanel', '个图版'),
    defineTask('figure_panel_followup', 'figure', '图版追问', { vision: true, captionContext: true }, 'panelChat', '次追问'),
    defineTask('cross_figure_mechanism', 'figure', '跨图机制整合', {}, 'crossFigure', '组图'),
    defineTask('paper_research_logic', 'paper_review', '论文研究逻辑', {}, 'batchSummary', '篇论文'),
    defineTask('paper_innovations', 'paper_review', '论文创新点', {}, 'singleSummary', '篇论文'),
    defineTask('paper_limitations', 'paper_review', '论文局限性', {}, 'singleSummary', '篇论文'),
    defineTask('literature_note_autofill', 'paper_review', '文献笔记自动填写', {}, 'batchSummary', '篇论文'),
    defineTask('article_chat', 'chat', '文章问答', {}, 'articleChat', '次对话'),
    defineTask('selection_chat', 'chat', '选中文本问答', {}, 'articleChat', '段选中文本'),
    defineTask('full_text_translation', 'reading', '原文翻译', { translation: true, textGeneration: true }, 'singleSummary', '段原文'),
    defineTask('navigation_title_translation', 'summary', '导航标题翻译', { translation: true, textGeneration: true }, 'singleSummary', '组标题')
  ]);

  const LLM_TASK_IDS = Object.freeze(TASK_DEFINITIONS.map(definition => definition.id));
  const TASKS_BY_ID = Object.freeze(Object.fromEntries(
    TASK_DEFINITIONS.map(definition => [definition.id, definition])
  ));

  function unknownLlmTaskError() {
    const error = new Error('UNKNOWN_LLM_TASK');
    error.code = 'UNKNOWN_LLM_TASK';
    return error;
  }

  function getLlmTaskDefinition(taskId) {
    const normalizedTaskId = String(taskId || '');
    if (Object.prototype.hasOwnProperty.call(TASKS_BY_ID, normalizedTaskId)) {
      return TASKS_BY_ID[normalizedTaskId];
    }
    throw unknownLlmTaskError();
  }

  function taskPolicySignature(taskOrId) {
    const definition = typeof taskOrId === 'string'
      ? getLlmTaskDefinition(taskOrId)
      : taskOrId;
    if (!TASK_DEFINITIONS.includes(definition)) {
      throw unknownLlmTaskError();
    }
    return JSON.stringify({
      id: definition.id,
      requirements: definition.requirements,
      budgetKind: definition.budgetKind,
      defaultReasoning: definition.defaultReasoning,
      defaultTokenRule: definition.defaultTokenRule
    });
  }

  function taskModelForProfile(policy, profile, profileId) {
    if (!policy || !profile || !profileId) return '';
    return policy?.modelProfileId === profileId &&
      (!policy.modelProviderId || policy.modelProviderId === profile?.providerId) &&
      (policy.modelPresetId === undefined || policy.modelPresetId === String(profile?.config?.presetId || ''))
      ? String(policy.model || '').trim() : '';
  }

  // Mirrors the adapters implemented by this build; it is not a claim that
  // every service/model offers a general web-search API.
  function supportsTaskWebSearch(providerId, config = {}, taskId) {
    if (!['article_chat', 'selection_chat'].includes(taskId)) return false;
    if (providerId === 'deepseek-harness') return ['deepseek-flash', 'deepseek-v4-pro'].includes(config.model);
    if (!['openai', 'deepseek'].includes(providerId)) return false;
    if (providerId === 'deepseek' && config.model !== 'deepseek-flash') return false;
    if (!String(config.baseUrl || '').trim()) return true;
    try {
      const url = new URL(config.baseUrl);
      const paths = providerId === 'openai' ? ['/v1/responses']
        : ['/responses', '/chat/completions', '/v1/chat/completions'];
      return url.protocol === 'https:' && url.hostname === `api.${providerId}.com` &&
        !url.port && !url.username && !url.password && !url.search && !url.hash &&
        paths.includes(url.pathname.replace(/\/+$/u, ''));
    } catch { return false; }
  }

  return Object.freeze({
    supportsTaskWebSearch,
    taskModelForProfile,
    LLM_TASK_IDS,
    TASK_DEFINITIONS,
    getLlmTaskDefinition,
    taskPolicySignature
  });
});
