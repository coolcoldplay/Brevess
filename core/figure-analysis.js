(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  const FIGURE_ANALYSIS_VERSION = '6';
  const FIGURE_DEPTHS = new Set(['standard', 'deep']);
  const OBSERVATION_SOURCES = [
    'image_observation', 'caption_statement', 'body_statement', 'multi_source', 'inference'
  ];
  const METHOD_CATEGORIES = [
    'wet_lab', 'imaging', 'bioinformatics', 'clinical', 'schematic', 'other'
  ];
  const METHOD_SOURCES = ['image', 'caption', 'body', 'inference'];
  const RECOGNIZED_METHOD_ALIASES = [
    ['WB', ['wb', 'western blot', 'western-blot', 'immunoblot']],
    ['IF', ['if', 'immunofluorescence', 'immunofluorescent staining']],
    ['IHC', ['ihc', 'immunohistochemistry', 'immunohistochemical staining']],
    ['H&E', [
      'h&e', 'h & e', 'h and e', 'hematoxylin and eosin',
      'haematoxylin and eosin'
    ]],
    ['CCK-8', ['cck-8', 'cck8', 'cell counting kit-8', 'cell counting kit 8']],
    ['Flow cytometry', ['flow cytometry', 'flow cytometric', 'facs']],
    ['RNA-seq', ['rna-seq', 'rna seq', 'rna sequencing']],
    ['scRNA-seq', [
      'scrna-seq', 'scrna seq', 'single-cell rna-seq', 'single cell rna-seq',
      'single-cell rna sequencing', 'single cell rna sequencing'
    ]],
    ['KEGG', ['kegg', 'kegg pathway enrichment', 'kegg pathway analysis', 'kegg enrichment']],
    ['GSEA', ['gsea', 'gene set enrichment analysis']]
  ];
  const PANEL_ROLES = [
    'model_setup', 'manipulation_validation', 'phenotype', 'quantification', 'mechanism',
    'negative_control', 'specificity', 'necessity', 'sufficiency', 'rescue',
    'functional_outcome', 'external_validation', 'other'
  ];
  const LOGIC_RELATION_TYPES = [
    'model_to_validation', 'qualitative_to_quantitative', 'phenomenon_to_mechanism',
    'association_to_intervention', 'general_effect_to_specificity',
    'mechanism_to_functional_outcome', 'initial_evidence_to_rescue',
    'single_system_to_external_validation', 'other'
  ];
  const EVIDENCE_RELATION_LEVELS = [
    'association', 'intervention_effect', 'necessity', 'sufficiency', 'rescue',
    'mechanistic_support', 'functional_validation', 'other'
  ];
  const PANEL_FOLLOWUP_TOPICS = Object.freeze([
    'grouping', 'technique_principle', 'axes_reading', 'sample_information'
  ]);
  const DEFAULT_PANEL_FOLLOWUP_PROMPTS = Object.freeze({
    grouping: '解释实验分组、对照组与比较关系，并明确这些分组能够和不能支持的结论。',
    technique_principle: '解释实验或生物信息学技术的原理、读出指标及合理的解释边界。',
    axes_reading: '解释输入中有证据支持的坐标轴、标签和实用读图顺序；不可见时明确说明。',
    sample_information: '只解释输入明确支持的样本、物种、组织、细胞、队列和重复信息，不补猜缺失细节。'
  });
  const FATAL_FIGURE_BATCH_CODES = new Set([
    'INVALID_SETTINGS', 'LLM_NOT_READY', 'AUTH_INVALID', 'QUOTA_EXHAUSTED', 'CANCELLED'
  ]);

  function isFatalFigureBatchError(value) {
    const code = typeof value === 'string' ? value : value?.code;
    return FATAL_FIGURE_BATCH_CODES.has(String(code || ''));
  }

  function normalizeFigureDepth(value) {
    return FIGURE_DEPTHS.has(value) ? value : 'standard';
  }

  function stringSchema() {
    return { type: 'string' };
  }

  function stringArraySchema() {
    return { type: 'array', items: stringSchema() };
  }

  function createFigureAnalysisSchema(depth = 'standard') {
    const analysisDepth = normalizeFigureDepth(depth);
    const properties = {
      figure_id: stringSchema(),
      analysis_depth: { type: 'string', enum: [analysisDepth] },
      basis: { type: 'string', enum: ['vision_text', 'caption_context'] },
      figure_question_zh: stringSchema(),
      panels: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            panel: stringSchema(),
            role: { type: 'string', enum: PANEL_ROLES },
            phenotype_name_zh: stringSchema(),
            method_category: { type: 'string', enum: METHOD_CATEGORIES },
            methods: stringArraySchema(),
            method_source: { type: 'string', enum: METHOD_SOURCES },
            purpose_zh: stringSchema(),
            design_zh: stringSchema(),
            comparison_zh: stringSchema(),
            direct_observation_zh: stringSchema(),
            observation_source: { type: 'string', enum: OBSERVATION_SOURCES },
            local_inference_zh: stringSchema(),
            contribution_zh: stringSchema()
          },
          required: [
            'panel', 'role', 'phenotype_name_zh', 'method_category', 'methods',
            'method_source', 'purpose_zh', 'design_zh', 'comparison_zh',
            'direct_observation_zh', 'observation_source', 'local_inference_zh',
            'contribution_zh'
          ]
        }
      },
      panel_groups: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            panels: stringArraySchema(),
            group_goal_zh: stringSchema(),
            group_conclusion_zh: stringSchema()
          },
          required: ['panels', 'group_goal_zh', 'group_conclusion_zh']
        }
      },
      logic_bridges: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            from_group: stringSchema(),
            to_group: stringSchema(),
            relation_type: { type: 'string', enum: LOGIC_RELATION_TYPES },
            bridge_zh: stringSchema()
          },
          required: ['from_group', 'to_group', 'relation_type', 'bridge_zh']
        }
      },
      argument_chain: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            panels: stringArraySchema(),
            established_zh: stringSchema(),
            handoff_zh: stringSchema(),
            evidence_level: { type: 'string', enum: EVIDENCE_RELATION_LEVELS }
          },
          required: ['panels', 'established_zh', 'handoff_zh', 'evidence_level']
        }
      },
      author_assembly_zh: stringSchema(),
      core_conclusion_zh: stringSchema(),
      claim_boundary_zh: stringSchema()
    };
    const required = [
      'figure_id', 'analysis_depth', 'basis', 'figure_question_zh', 'panels',
      'panel_groups', 'logic_bridges', 'argument_chain', 'author_assembly_zh', 'core_conclusion_zh',
      'claim_boundary_zh'
    ];
    if (analysisDepth === 'deep') {
      Object.assign(properties, {
        control_analysis: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              panels: stringArraySchema(),
              control_type: stringSchema(),
              excluded_explanation_zh: stringSchema(),
              adequacy_zh: stringSchema()
            },
            required: ['panels', 'control_type', 'excluded_explanation_zh', 'adequacy_zh']
          }
        },
        evidence_relations: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              panels: stringArraySchema(),
              relation_level: { type: 'string', enum: EVIDENCE_RELATION_LEVELS },
              rationale_zh: stringSchema()
            },
            required: ['panels', 'relation_level', 'rationale_zh']
          }
        },
        negative_result_value_zh: stringSchema(),
        qualitative_quantitative_link_zh: stringSchema(),
        alternative_explanations: stringArraySchema(),
        missing_link_if_panel_removed: stringArraySchema(),
        paper_argument_role_zh: stringSchema(),
        deep_author_strategy_zh: stringSchema()
      });
      required.push(
        'control_analysis', 'evidence_relations', 'negative_result_value_zh',
        'qualitative_quantitative_link_zh', 'alternative_explanations',
        'missing_link_if_panel_removed', 'paper_argument_role_zh',
        'deep_author_strategy_zh'
      );
    }
    return { type: 'object', additionalProperties: false, properties, required };
  }

  function createPanelFollowupSchema() {
    return {
      type: 'object',
      additionalProperties: false,
      properties: {
        figure_id: stringSchema(),
        panel: stringSchema(),
        topics: { type: 'array', items: { type: 'string', enum: PANEL_FOLLOWUP_TOPICS } },
        basis: { type: 'string', enum: ['vision_text', 'caption_context'] },
        answer_zh: stringSchema(),
        claim_boundary_zh: stringSchema()
      },
      required: ['figure_id', 'panel', 'topics', 'basis', 'answer_zh', 'claim_boundary_zh']
    };
  }

  function createFigurePanelBatchSchema(depth = 'standard') {
    const analysisDepth = normalizeFigureDepth(depth);
    return {
      type: 'object',
      additionalProperties: false,
      properties: {
        figure_id: stringSchema(),
        analysis_depth: { type: 'string', enum: [analysisDepth] },
        basis: { type: 'string', enum: ['vision_text', 'caption_context'] },
        panels: createFigureAnalysisSchema(analysisDepth).properties.panels
      },
      required: ['figure_id', 'analysis_depth', 'basis', 'panels']
    };
  }

  function createFigureSynthesisSchema(depth = 'standard') {
    const analysisDepth = normalizeFigureDepth(depth);
    const full = createFigureAnalysisSchema(analysisDepth);
    const properties = Object.fromEntries(Object.entries(full.properties)
      .filter(([key]) => key !== 'panels'));
    return {
      type: 'object',
      additionalProperties: false,
      properties,
      required: full.required.filter(key => key !== 'panels')
    };
  }

  function cleanText(value, maxLength = 1200) {
    return String(value || '')
      .normalize('NFKC')
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
      .replace(/<[^>]*>/g, '')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, maxLength);
  }

  function cleanFigureField(value, maxLength = 1600) {
    return cleanText(value, maxLength).replace(
      /^(?:实验设计|结果观察|结论推导|局部推论|核心结论|解读边界|目的|比较对象|作者组图思想|证据边界|Experiment design|Result observation|Conclusion|Core conclusion)\s*[:：]\s*/i,
      ''
    );
  }

  function cleanPhenotypeName(value) {
    return cleanFigureField(value, 240)
      .replace(/^(?:phenotype(?:_name)?|phenotype name|\u8868\u578b(?:\u540d\u79f0)?)\s*[:\uff1a]\s*/i, '')
      .replace(/^[\s:;\-\u2013\u2014]+/, '')
      .trim();
  }

  function methodAliasKey(value) {
    return cleanText(value, 240)
      .toLowerCase()
      .replace(/[\u2010-\u2015]/g, '-')
      .replace(/\s*\([^)]*\)\s*/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizeRecognizedMethod(value) {
    const candidate = methodAliasKey(value);
    if (!candidate) return '';
    const match = RECOGNIZED_METHOD_ALIASES.find(([, aliases]) => aliases.includes(candidate));
    return match ? match[0] : '';
  }

  function normalizeMethods(value) {
    const methods = Array.isArray(value) ? value : [];
    return [...new Set(methods.map(normalizeRecognizedMethod).filter(Boolean))].slice(0, 12);
  }

  function invalidResponse(message) {
    if (shared.ProviderRequestError) {
      return new shared.ProviderRequestError('INVALID_RESPONSE', message);
    }
    const error = new Error(message);
    error.code = 'INVALID_RESPONSE';
    return error;
  }

  function compileFigureSystemPrompt({ visualInput, analysisDepth }) {
    const common = [
      '你是一名严谨的生物医学论文读图导师。分析指定 Figure 的证据结构和作者组图逻辑。',
      '请严格依据图片像素（仅在提供时）、图注和相关正文，不得补写论文未提供的实验或结果。',
      '1. 实验设计：逐个 Panel 说明局部问题、实验目的、具体操作和比较对象。',
      '2. 结果观察：使用“XX比XX高/低”“XX区域变亮/变暗”“曲线在XX之后上升/下降”等直白比较。',
      '3. 结论推导：区分直接观察、局部推论和该 Panel 对整图论证的贡献。',
      '4. 串联逻辑：先把同一实验的图像与定量 Panel 合并成证据组，再说明组间逻辑桥。',
      '为每个 Panel 标记 observation_source：image_observation、caption_statement、body_statement、multi_source 或 inference。',
      '观察只能陈述输入明确支持的事实；推论使用“支持、提示、与……一致”，证据不足时不得使用“证明、导致、介导”。',
      'Panel 标识必须来自输入，不得按连续字母自行补齐。',
      '字段内容不要重复“实验设计：”“结果观察：”“结论推导：”“核心结论：”等界面标签。',
      '标准结果最多 30 个 Panel、6 个 Panel 组和 8 条逻辑桥。',
      '用中文输出严格 JSON，不要 Markdown。'
    ];
    common.push(
      'For every Panel, keep role, phenotype_name_zh, and methods separate: role is the evidence function, phenotype_name_zh is the concrete measured phenotype, and methods are the named assay or analysis.',
      'When role is "phenotype", phenotype_name_zh must be a concrete phenotype supported by the input; use "\u672a\u660e\u786e" when it is not stated. For every other role, phenotype_name_zh must be an empty string.',
      'Set method_category to wet_lab, imaging, bioinformatics, clinical, schematic, or other, and method_source to image, caption, body, or inference. In text-only mode, do not use image as method_source.',
      'methods may contain only these normalized recognized methods: WB, IF, IHC, H&E, CCK-8, Flow cytometry, RNA-seq, scRNA-seq, KEGG, GSEA. Normalize aliases such as Western blot/WB, immunofluorescence/IF, immunohistochemistry/IHC, hematoxylin and eosin/H&E, Cell Counting Kit-8/CCK-8, RNA sequencing/RNA-seq, single-cell RNA sequencing/scRNA-seq, and Gene Set Enrichment Analysis/GSEA. Do not guess a method; use an empty methods array when no recognized method is explicitly supported.'
    );
    common.push(visualInput
      ? '你已获得该 Figure 的图片像素；看不清或图中未显示时必须明确说明，不能猜测。'
      : [
          '你没有看到图片像素，只能依据图注和正文。',
          '可以准确复述图注和正文明确描述的视觉或定量结果，但必须标记 caption_statement、body_statement 或 multi_source。',
          '不得把未提供的信息当作观察结果；不得编造颜色、曲线、亮暗、空间分布、形态或数值。',
          '文本模式不得使用 image_observation；同时受图注和正文明确支持时才使用 multi_source，否则选择单一文本来源或 inference。'
        ].join(' '));
    if (analysisDepth === 'deep') {
      common.push(
        '深度解读还必须回答：作者为什么在前一组 Panel 后仍需要后一组？',
        '逐个关键对照说明它排除了什么替代解释，以及对照是否充分。',
        '说明定性与定量证据如何互相支撑，阴性结果为什么仍有信息。',
        '区分相关、干预效应、必要性、充分性、救援、机制支持和功能验证，不得仅凭顺序升级因果等级。',
        '说明删除每个关键 Panel 后论证链会缺失什么。',
        '说明整张 Figure 在全文中承担建立现象、推进机制、验证因果或证明功能意义的哪项任务。'
      );
    }
    common.push(
      'Return argument_chain as an ordered domino chain: each step names its panels, the evidence established there, the precise reason it licenses the next step, and its evidence level. Do not use generic transitions.'
    );
    return common.join('\n');
  }

  function compileFigureAnalysisPrompt(input, options = {}) {
    const analysisDepth = normalizeFigureDepth(options.analysisDepth);
    const visualInput = options.visualInput === true;
    const contextParagraphs = (Array.isArray(input?.contextParagraphs)
      ? input.contextParagraphs : []).slice(0, 12).map(item => ({
      paragraph_id: cleanText(item?.paragraphId, 120),
      section_title: cleanText(item?.sectionTitle, 240),
      text: cleanText(item?.text, 1200)
    }));
    return {
      systemPrompt: compileFigureSystemPrompt({ visualInput, analysisDepth }),
      userPrompt: JSON.stringify({
        figure_id: cleanText(input?.figureId, 80),
        figure_label: cleanText(input?.figureLabel, 80),
        article_title: cleanText(input?.articleTitle, 500),
        caption: cleanText(input?.caption, 8000),
        related_body_context: contextParagraphs,
        expected_panel_labels: normalizedPanelRefs(input?.panelHints),
        analysis_basis: visualInput ? 'vision_text' : 'caption_context',
        analysis_depth: analysisDepth
      }),
      responseSchema: createFigureAnalysisSchema(analysisDepth),
      schemaName: analysisDepth === 'deep'
        ? 'figure_walkthrough_deep' : 'figure_walkthrough_standard'
    };
  }

  function compileFigurePanelBatchPrompt(input, options = {}) {
    const analysisDepth = normalizeFigureDepth(options.analysisDepth);
    const visualInput = options.visualInput === true;
    const contextParagraphs = (Array.isArray(input?.contextParagraphs)
      ? input.contextParagraphs : []).slice(0, 12).map(item => ({
      paragraph_id: cleanText(item?.paragraphId, 120),
      section_title: cleanText(item?.sectionTitle, 240),
      text: cleanText(item?.text, 1200)
    }));
    return {
      systemPrompt: [
        compileFigureSystemPrompt({ visualInput, analysisDepth: 'standard' }),
        'PANEL_EXTRACTION_PASS: return only the requested Panel records.',
        'Do not generate figure-level groups, bridges, argument chains, conclusions, or audit prose.',
        'Keep every string concise and evidence-grounded so all requested Panels fit in one JSON response.'
      ].join('\n'),
      userPrompt: JSON.stringify({
        figure_id: cleanText(input?.figureId, 80),
        figure_label: cleanText(input?.figureLabel, 80),
        article_title: cleanText(input?.articleTitle, 500),
        caption: cleanText(input?.caption, 8000),
        related_body_context: contextParagraphs,
        expected_panel_labels: normalizedPanelRefs(input?.panelHints),
        analysis_basis: visualInput ? 'vision_text' : 'caption_context',
        analysis_depth: analysisDepth,
        pass: 'panel_extraction'
      }),
      responseSchema: createFigurePanelBatchSchema(analysisDepth),
      schemaName: `figure_panel_batch_${analysisDepth}`
    };
  }

  function compileFigureSynthesisPrompt(input, panelEvidence, options = {}) {
    const analysisDepth = normalizeFigureDepth(options.analysisDepth);
    const visualInput = options.visualInput === true;
    return {
      systemPrompt: [
        'You synthesize a biomedical Figure argument from already extracted, evidence-grounded Panel records.',
        'Use only the supplied caption, related body context, and Panel evidence. Do not invent visual details.',
        'Build one coherent Figure-level question, evidence groups, logical bridges, ordered argument chain, conclusion, and claim boundary.',
        analysisDepth === 'deep'
          ? 'Also audit controls, evidence levels, alternative explanations, negative results, and the role of the Figure in the paper.'
          : 'Keep the synthesis concise and focused on the central evidence chain.',
        'Return strict Chinese JSON only. Do not repeat the Panel records in the response.'
      ].join('\n'),
      userPrompt: JSON.stringify({
        figure_id: cleanText(input?.figureId, 80),
        figure_label: cleanText(input?.figureLabel, 80),
        article_title: cleanText(input?.articleTitle, 500),
        caption: cleanText(input?.caption, 8000),
        related_body_context: (Array.isArray(input?.contextParagraphs)
          ? input.contextParagraphs : []).slice(0, 8).map(item => ({
          paragraph_id: cleanText(item?.paragraphId, 120),
          section_title: cleanText(item?.sectionTitle, 240),
          text: cleanText(item?.text, 900)
        })),
        panel_evidence: (Array.isArray(panelEvidence) ? panelEvidence : []).slice(0, 30),
        analysis_basis: visualInput ? 'vision_text' : 'caption_context',
        analysis_depth: analysisDepth,
        pass: 'figure_synthesis'
      }),
      responseSchema: createFigureSynthesisSchema(analysisDepth),
      schemaName: `figure_synthesis_${analysisDepth}`
    };
  }

  function normalizePanelFollowupTopics(value) {
    const seen = new Set();
    return (Array.isArray(value) ? value : []).map(item => String(item || '').trim())
      .filter(topic => PANEL_FOLLOWUP_TOPICS.includes(topic) && !seen.has(topic) &&
        Boolean(seen.add(topic)))
      .slice(0, PANEL_FOLLOWUP_TOPICS.length);
  }

  function normalizePanelFollowupPrompts(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return Object.fromEntries(PANEL_FOLLOWUP_TOPICS.map(topic => [
      topic,
      cleanText(source[topic], 1000) || DEFAULT_PANEL_FOLLOWUP_PROMPTS[topic]
    ]));
  }

  function normalizePanelCustomQuestion(value) {
    return cleanText(value, 1200);
  }

  function compilePanelFollowupPrompt(input, options = {}) {
    const visualInput = options.visualInput === true;
    const topics = normalizePanelFollowupTopics(input?.topics);
    const customQuestion = normalizePanelCustomQuestion(input?.customQuestion);
    const panel = input?.panel || {};
    const topicInstructions = normalizePanelFollowupPrompts(options.topicPrompts);
    return {
      systemPrompt: [
        'You are a rigorous biomedical figure-reading tutor.',
        'Answer only the requested built-in topics and/or custom question for one Panel.',
        'Use the image only when supplied; otherwise use the caption, body context, and existing Panel interpretation.',
        'Do not invent grouping, sample size, axes, assay conditions, or experimental results.',
        'Write concise Chinese prose with short labelled paragraphs, not Markdown tables.',
        ...topics.map(topic => topicInstructions[topic])
      ].join('\n'),
      userPrompt: JSON.stringify({
        figure_id: cleanText(input?.figureId, 80),
        figure_label: cleanText(input?.figureLabel, 80),
        panel: cleanText(panel?.panel, 20).toUpperCase(),
        requested_topics: topics,
        requested_topic_instructions: Object.fromEntries(
          topics.map(topic => [topic, topicInstructions[topic]])
        ),
        custom_question: customQuestion,
        caption: cleanText(input?.caption, 8000),
        related_body_context: (Array.isArray(input?.contextParagraphs) ? input.contextParagraphs : [])
          .slice(0, 8).map(item => ({
            section_title: cleanText(item?.sectionTitle, 240),
            text: cleanText(item?.text, 1200)
          })),
        existing_panel_interpretation: {
          role: cleanText(panel?.role, 80),
          phenotype: cleanText(panel?.phenotypeName, 240),
          methods: Array.isArray(panel?.methods) ? panel.methods.slice(0, 12) : [],
          purpose: cleanFigureField(panel?.purpose, 1000),
          design: cleanFigureField(panel?.design, 1000),
          comparison: cleanFigureField(panel?.comparison, 1000),
          observation: cleanFigureField(panel?.directObservation, 1000)
        },
        analysis_basis: visualInput ? 'vision_text' : 'caption_context'
      }),
      responseSchema: createPanelFollowupSchema(),
      schemaName: 'figure_panel_followup'
    };
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function requireFigureField(value, field, predicate) {
    if (!predicate(value?.[field])) {
      throw invalidResponse(`Figure response field ${field} has an invalid shape`);
    }
  }

  function requireExactFigureKeys(value, keys, label) {
    if (!isPlainObject(value)) throw invalidResponse(`Figure response ${label} must be an object`);
    const allowed = new Set(keys);
    if (Object.keys(value).some(key => !allowed.has(key))) {
      throw invalidResponse(`Figure response ${label} contains an unsupported field`);
    }
    keys.forEach(key => requireFigureField(value, key, item => item !== undefined));
  }

  function requireStringArray(value, label) {
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
      throw invalidResponse(`Figure response ${label} must be a string array`);
    }
  }

  function canonicalPanelRef(value) {
    const panel = cleanText(value, 20).toUpperCase();
    return /^[A-Z0-9][A-Z0-9.+-]{0,7}$/.test(panel) ? panel : '';
  }

  function assertRawPanelShape(panel) {
    const keys = [
      'panel', 'role', 'phenotype_name_zh', 'method_category', 'methods', 'method_source',
      'purpose_zh', 'design_zh', 'comparison_zh', 'direct_observation_zh',
      'observation_source', 'local_inference_zh', 'contribution_zh'
    ];
    requireExactFigureKeys(panel, keys, 'panel');
    keys.filter(key => !['methods'].includes(key)).forEach(key => {
      requireFigureField(panel, key, item => typeof item === 'string');
    });
    if (!canonicalPanelRef(panel.panel)) {
      throw invalidResponse('Figure response panel label is invalid');
    }
    if (!PANEL_ROLES.includes(panel.role) ||
      !METHOD_CATEGORIES.includes(panel.method_category) ||
      !METHOD_SOURCES.includes(panel.method_source) ||
      !OBSERVATION_SOURCES.includes(panel.observation_source)) {
      throw invalidResponse('Figure response panel enum is invalid');
    }
    requireStringArray(panel.methods, 'panel methods');
  }

  function assertRawArrayOfObjects(value, label, keys, enumChecks = {}) {
    if (!Array.isArray(value)) throw invalidResponse(`Figure response ${label} must be an array`);
    value.forEach(item => {
      requireExactFigureKeys(item, keys, label);
      keys.forEach(key => {
        const expected = enumChecks[key];
        if (expected === 'stringArray') requireStringArray(item[key], `${label}.${key}`);
        else if (expected) {
          if (!expected.includes(item[key])) {
            throw invalidResponse(`Figure response ${label}.${key} enum is invalid`);
          }
        } else if (typeof item[key] !== 'string') {
          throw invalidResponse(`Figure response ${label}.${key} must be a string`);
        }
      });
    });
  }

  function assertRawFigureAnalysis(value, analysisDepth) {
    const baseKeys = [
      'figure_id', 'analysis_depth', 'basis', 'figure_question_zh', 'panels', 'panel_groups',
      'logic_bridges', 'argument_chain', 'author_assembly_zh', 'core_conclusion_zh',
      'claim_boundary_zh'
    ];
    const deepKeys = [
      'control_analysis', 'evidence_relations', 'negative_result_value_zh',
      'qualitative_quantitative_link_zh', 'alternative_explanations',
      'missing_link_if_panel_removed', 'paper_argument_role_zh', 'deep_author_strategy_zh'
    ];
    const keys = analysisDepth === 'deep' ? [...baseKeys, ...deepKeys] : baseKeys;
    requireExactFigureKeys(value, keys, 'root');
    ['figure_id', 'analysis_depth', 'basis', 'figure_question_zh', 'author_assembly_zh',
      'core_conclusion_zh', 'claim_boundary_zh'].forEach(key => {
      requireFigureField(value, key, item => typeof item === 'string');
    });
    if (!['vision_text', 'caption_context'].includes(value.basis)) {
      throw invalidResponse('Figure response basis enum is invalid');
    }
    if (value.analysis_depth !== analysisDepth) {
      throw invalidResponse('Figure response depth did not match the request');
    }
    if (!Array.isArray(value.panels)) throw invalidResponse('Figure response panels must be an array');
    value.panels.forEach(assertRawPanelShape);
    assertRawArrayOfObjects(value.panel_groups, 'panel_groups', [
      'panels', 'group_goal_zh', 'group_conclusion_zh'
    ], { panels: 'stringArray' });
    assertRawArrayOfObjects(value.logic_bridges, 'logic_bridges', [
      'from_group', 'to_group', 'relation_type', 'bridge_zh'
    ], { relation_type: LOGIC_RELATION_TYPES });
    assertRawArrayOfObjects(value.argument_chain, 'argument_chain', [
      'panels', 'established_zh', 'handoff_zh', 'evidence_level'
    ], { panels: 'stringArray', evidence_level: EVIDENCE_RELATION_LEVELS });
    if (analysisDepth !== 'deep') return;
    ['negative_result_value_zh', 'qualitative_quantitative_link_zh',
      'paper_argument_role_zh', 'deep_author_strategy_zh'].forEach(key => {
      requireFigureField(value, key, item => typeof item === 'string');
    });
    requireStringArray(value.alternative_explanations, 'alternative_explanations');
    requireStringArray(value.missing_link_if_panel_removed, 'missing_link_if_panel_removed');
    assertRawArrayOfObjects(value.control_analysis, 'control_analysis', [
      'panels', 'control_type', 'excluded_explanation_zh', 'adequacy_zh'
    ], { panels: 'stringArray' });
    assertRawArrayOfObjects(value.evidence_relations, 'evidence_relations', [
      'panels', 'relation_level', 'rationale_zh'
    ], { panels: 'stringArray', relation_level: EVIDENCE_RELATION_LEVELS });
  }

  function normalizedStringList(value, limit = 30, maxLength = 1200) {
    return (Array.isArray(value) ? value : []).slice(0, limit)
      .map(item => cleanFigureField(item, maxLength)).filter(Boolean);
  }

  function normalizedPanelRefs(value) {
    const result = [];
    const seen = new Set();
    (Array.isArray(value) ? value : []).slice(0, 30).forEach(item => {
      const panel = canonicalPanelRef(item);
      if (panel && !seen.has(panel)) {
        seen.add(panel);
        result.push(panel);
      }
    });
    return result;
  }

  function validateFigureAnalysis(value, input, options = {}) {
    if (!isPlainObject(value)) {
      throw invalidResponse('Figure analysis must be an object');
    }
    const expectedId = cleanText(input?.figureId, 80);
    if (cleanText(value.figure_id, 80) !== expectedId) {
      throw invalidResponse('Figure response id did not match the request');
    }
    const analysisDepth = normalizeFigureDepth(options.analysisDepth);
    assertRawFigureAnalysis(value, analysisDepth);
    const visualInput = options.visualInput === true;
    const expectedPanels = normalizedPanelRefs(input?.panelHints);
    const seenPanels = new Set();
    const panels = [];
    for (const raw of Array.isArray(value.panels) ? value.panels.slice(0, 30) : []) {
      const panel = canonicalPanelRef(raw.panel);
      if (!panel) throw invalidResponse('Figure response panel label is invalid');
      if (expectedPanels.length && !expectedPanels.includes(panel)) {
        throw invalidResponse('Figure response returned an unexpected panel label');
      }
      if (seenPanels.has(panel)) continue;
      seenPanels.add(panel);
      const role = PANEL_ROLES.includes(raw?.role) ? raw.role : 'other';
      let observationSource = OBSERVATION_SOURCES.includes(raw?.observation_source)
        ? raw.observation_source : 'inference';
      if (!visualInput && observationSource === 'image_observation') observationSource = 'inference';
      let methodSource = METHOD_SOURCES.includes(raw?.method_source)
        ? raw.method_source : 'inference';
      if (!visualInput && methodSource === 'image') methodSource = 'inference';
      panels.push({
        panel,
        role,
        phenotypeName: role === 'phenotype'
          ? (cleanPhenotypeName(raw?.phenotype_name_zh) || '\u672a\u660e\u786e') : '',
        methodCategory: METHOD_CATEGORIES.includes(raw?.method_category)
          ? raw.method_category : 'other',
        methods: normalizeMethods(raw?.methods),
        methodSource,
        purpose: cleanFigureField(raw?.purpose_zh),
        design: cleanFigureField(raw?.design_zh),
        comparison: cleanFigureField(raw?.comparison_zh),
        directObservation: cleanFigureField(raw?.direct_observation_zh),
        observationSource,
        localInference: cleanFigureField(raw?.local_inference_zh),
        contribution: cleanFigureField(raw?.contribution_zh)
      });
    }
    const panelGroups = (Array.isArray(value.panel_groups) ? value.panel_groups : [])
      .slice(0, 6).map(raw => ({
        panels: normalizedPanelRefs(raw?.panels),
        groupGoal: cleanFigureField(raw?.group_goal_zh),
        groupConclusion: cleanFigureField(raw?.group_conclusion_zh)
      })).filter(item => item.panels.length || item.groupGoal || item.groupConclusion);
    const logicBridges = (Array.isArray(value.logic_bridges) ? value.logic_bridges : [])
      .slice(0, 8).map(raw => ({
        fromGroup: cleanText(raw?.from_group, 80),
        toGroup: cleanText(raw?.to_group, 80),
        relationType: LOGIC_RELATION_TYPES.includes(raw?.relation_type)
          ? raw.relation_type : 'other',
        bridge: cleanFigureField(raw?.bridge_zh)
      })).filter(item => item.bridge || item.fromGroup || item.toGroup);
    const argumentChain = (Array.isArray(value.argument_chain) ? value.argument_chain : [])
      .slice(0, 12).map(raw => ({
        panels: normalizedPanelRefs(raw?.panels),
        established: cleanFigureField(raw?.established_zh),
        handoff: cleanFigureField(raw?.handoff_zh),
        evidenceLevel: EVIDENCE_RELATION_LEVELS.includes(raw?.evidence_level)
          ? raw.evidence_level : 'other'
      })).filter(item => item.panels.length || item.established || item.handoff);
    const returnedPanels = panels.map(item => item.panel);
    const base = {
      figureId: expectedId,
      analysisDepth,
      basis: visualInput && value.basis !== 'caption_context' ? 'vision_text' : 'caption_context',
      figureQuestion: cleanFigureField(value.figure_question_zh, 2400),
      panels,
      panelGroups,
      logicBridges,
      argumentChain,
      panelCoverage: {
        expectedPanels,
        returnedPanels,
        missingPanels: expectedPanels.filter(panel => !returnedPanels.includes(panel))
      },
      authorAssembly: cleanFigureField(value.author_assembly_zh, 3200),
      coreConclusion: cleanFigureField(value.core_conclusion_zh, 2400),
      claimBoundary: cleanFigureField(value.claim_boundary_zh, 2400)
    };
    if (!base.panels.length && !base.figureQuestion && !base.coreConclusion) {
      throw invalidResponse('Figure analysis did not contain usable content');
    }
    if (analysisDepth === 'deep') {
      base.controlAnalysis = (Array.isArray(value.control_analysis)
        ? value.control_analysis : []).slice(0, 30).map(raw => ({
        panels: normalizedPanelRefs(raw?.panels),
        controlType: cleanFigureField(raw?.control_type, 240),
        excludedExplanation: cleanFigureField(raw?.excluded_explanation_zh),
        adequacy: cleanFigureField(raw?.adequacy_zh)
      }));
      base.evidenceRelations = (Array.isArray(value.evidence_relations)
        ? value.evidence_relations : []).slice(0, 30).map(raw => ({
        panels: normalizedPanelRefs(raw?.panels),
        relationLevel: EVIDENCE_RELATION_LEVELS.includes(raw?.relation_level)
          ? raw.relation_level : 'other',
        rationale: cleanFigureField(raw?.rationale_zh)
      }));
      base.negativeResultValue = cleanFigureField(value.negative_result_value_zh, 2400);
      base.qualitativeQuantitativeLink = cleanFigureField(
        value.qualitative_quantitative_link_zh, 2400
      );
      base.alternativeExplanations = normalizedStringList(value.alternative_explanations, 20);
      base.missingLinksIfPanelRemoved = normalizedStringList(
        value.missing_link_if_panel_removed, 30
      );
      base.paperArgumentRole = cleanFigureField(value.paper_argument_role_zh, 2400);
      base.deepAuthorStrategy = cleanFigureField(value.deep_author_strategy_zh, 3200);
    }
    return base;
  }

  function panelToRaw(panel) {
    return {
      panel: panel?.panel,
      role: panel?.role,
      phenotype_name_zh: panel?.phenotypeName,
      method_category: panel?.methodCategory,
      methods: panel?.methods,
      method_source: panel?.methodSource,
      purpose_zh: panel?.purpose,
      design_zh: panel?.design,
      comparison_zh: panel?.comparison,
      direct_observation_zh: panel?.directObservation,
      observation_source: panel?.observationSource,
      local_inference_zh: panel?.localInference,
      contribution_zh: panel?.contribution
    };
  }

  function emptyFigureFields(analysisDepth) {
    const fields = {
      figure_question_zh: '',
      panel_groups: [],
      logic_bridges: [],
      argument_chain: [],
      author_assembly_zh: '',
      core_conclusion_zh: '',
      claim_boundary_zh: ''
    };
    if (analysisDepth === 'deep') Object.assign(fields, {
      control_analysis: [],
      evidence_relations: [],
      negative_result_value_zh: '',
      qualitative_quantitative_link_zh: '',
      alternative_explanations: [],
      missing_link_if_panel_removed: [],
      paper_argument_role_zh: '',
      deep_author_strategy_zh: ''
    });
    return fields;
  }

  function validateFigurePanelBatch(value, input, options = {}) {
    const analysisDepth = normalizeFigureDepth(options.analysisDepth);
    requireExactFigureKeys(
      value,
      createFigurePanelBatchSchema(analysisDepth).required,
      'panel batch root'
    );
    return validateFigureAnalysis({
      figure_id: value.figure_id,
      analysis_depth: value.analysis_depth,
      basis: value.basis,
      panels: value.panels,
      ...emptyFigureFields(analysisDepth)
    }, input, options);
  }

  function validateFigureSynthesis(value, input, panelEvidence, options = {}) {
    const analysisDepth = normalizeFigureDepth(options.analysisDepth);
    requireExactFigureKeys(
      value,
      createFigureSynthesisSchema(analysisDepth).required,
      'synthesis root'
    );
    return validateFigureAnalysis({
      ...value,
      panels: (Array.isArray(panelEvidence) ? panelEvidence : []).map(panelToRaw)
    }, input, options);
  }

  function validateCachedFigureAnalysis(value, input, options = {}) {
    if (!isPlainObject(value)) throw invalidResponse('Cached Figure analysis must be an object');
    const analysisDepth = normalizeFigureDepth(options.analysisDepth);
    const mapCachedList = (items, mapper) => Array.isArray(items) ? items.map(mapper) : items;
    const toRawPanels = panels => (Array.isArray(panels) ? panels : []).map(panelToRaw);
    const raw = {
      figure_id: value.figureId,
      analysis_depth: value.analysisDepth,
      basis: value.basis,
      figure_question_zh: value.figureQuestion,
      panels: Array.isArray(value.panels) ? toRawPanels(value.panels) : value.panels,
      panel_groups: mapCachedList(value.panelGroups, group => ({
        panels: group?.panels,
        group_goal_zh: group?.groupGoal,
        group_conclusion_zh: group?.groupConclusion
      })),
      logic_bridges: mapCachedList(value.logicBridges, bridge => ({
        from_group: bridge?.fromGroup,
        to_group: bridge?.toGroup,
        relation_type: bridge?.relationType,
        bridge_zh: bridge?.bridge
      })),
      argument_chain: mapCachedList(value.argumentChain, step => ({
        panels: step?.panels,
        established_zh: step?.established,
        handoff_zh: step?.handoff,
        evidence_level: step?.evidenceLevel
      })),
      author_assembly_zh: value.authorAssembly,
      core_conclusion_zh: value.coreConclusion,
      claim_boundary_zh: value.claimBoundary
    };
    if (analysisDepth === 'deep') Object.assign(raw, {
      control_analysis: mapCachedList(value.controlAnalysis,
        control => ({
          panels: control?.panels,
          control_type: control?.controlType,
          excluded_explanation_zh: control?.excludedExplanation,
          adequacy_zh: control?.adequacy
        })
      ),
      evidence_relations: mapCachedList(value.evidenceRelations,
        relation => ({
          panels: relation?.panels,
          relation_level: relation?.relationLevel,
          rationale_zh: relation?.rationale
        })
      ),
      negative_result_value_zh: value.negativeResultValue,
      qualitative_quantitative_link_zh: value.qualitativeQuantitativeLink,
      alternative_explanations: value.alternativeExplanations,
      missing_link_if_panel_removed: value.missingLinksIfPanelRemoved,
      paper_argument_role_zh: value.paperArgumentRole,
      deep_author_strategy_zh: value.deepAuthorStrategy
    });
    return validateFigureAnalysis(raw, input, {
      analysisDepth,
      visualInput: value.basis === 'vision_text'
    });
  }

  function validatePanelFollowup(value, input, options = {}) {
    const expectedTopics = normalizePanelFollowupTopics(input?.topics);
    const customQuestion = normalizePanelCustomQuestion(input?.customQuestion);
    const expectedFigureId = cleanText(input?.figureId, 80);
    const expectedPanel = canonicalPanelRef(input?.panel?.panel || input?.panel);
    requireExactFigureKeys(value, [
      'figure_id', 'panel', 'topics', 'basis', 'answer_zh', 'claim_boundary_zh'
    ], 'panel follow-up');
    if (cleanText(value.figure_id, 80) !== expectedFigureId ||
        canonicalPanelRef(value.panel) !== expectedPanel) {
      throw invalidResponse('Panel follow-up did not match the requested Figure or Panel');
    }
    const topics = normalizePanelFollowupTopics(value.topics);
    if (topics.length !== expectedTopics.length ||
        topics.some(topic => !expectedTopics.includes(topic))) {
      throw invalidResponse('Panel follow-up topics did not match the request');
    }
    const visualInput = options.visualInput === true;
    if (!['vision_text', 'caption_context'].includes(value.basis)) {
      throw invalidResponse('Panel follow-up basis is invalid');
    }
    const answer = cleanFigureField(value.answer_zh, 3600);
    if (!answer) throw invalidResponse('Panel follow-up did not contain an answer');
    return {
      figureId: expectedFigureId,
      panel: expectedPanel,
      topics,
      customQuestion,
      basis: visualInput && value.basis !== 'caption_context' ? 'vision_text' : 'caption_context',
      answer,
      claimBoundary: cleanFigureField(value.claim_boundary_zh, 1200)
    };
  }

  return {
    FIGURE_ANALYSIS_VERSION,
    PANEL_FOLLOWUP_TOPICS,
    DEFAULT_PANEL_FOLLOWUP_PROMPTS,
    createFigureAnalysisSchema,
    createFigurePanelBatchSchema,
    createFigureSynthesisSchema,
    createPanelFollowupSchema,
    compileFigureAnalysisPrompt,
    compileFigurePanelBatchPrompt,
    compileFigureSynthesisPrompt,
    compilePanelFollowupPrompt,
    isFatalFigureBatchError,
    normalizeFigureDepth,
    validateFigureAnalysis,
    validateFigurePanelBatch,
    validateFigureSynthesis,
    validateCachedFigureAnalysis,
    validatePanelFollowup,
    normalizePanelFollowupTopics,
    normalizePanelFollowupPrompts,
    normalizePanelCustomQuestion
  };
});
