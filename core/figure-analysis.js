(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  const FIGURE_ANALYSIS_VERSION = '12-panel-specific-durable-results';
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
  const METHOD_LABELS_ZH = Object.freeze({
    'schematic': '实验示意图',
    'schematic diagram': '实验示意图',
    'experimental schematic': '实验示意图',
    'representative image': '代表性图像',
    'representative images': '代表性图像',
    'histological reconstruction': '组织学重建',
    'electrophysiology': '电生理记录',
    'electrophysiological recording': '电生理记录',
    'patch-clamp electrophysiology': '膜片钳电生理记录',
    'whole-cell patch clamp': '全细胞膜片钳记录',
    'fiber photometry': '光纤记录',
    'fiber photometry recording': '光纤记录',
    'optical stimulation': '光刺激',
    'optogenetic stimulation': '光遗传刺激',
    'viral injection': '病毒注射',
    'virus injection': '病毒注射',
    'viral tracing': '病毒示踪',
    'histology': '组织学验证',
    'immunofluorescence': '免疫荧光染色',
    'immunohistochemistry': '免疫组织化学染色',
    'behavioral test': '行为学测试',
    'behavioral tests': '行为学测试',
    'behavioral assay': '行为学测试',
    'quantification': '定量分析',
    'heatmap': '热图',
    'bar graph': '柱状图',
    'line graph': '折线图',
    'scatter plot': '散点图',
    'action potential recording': '动作电位记录',
    'action potential firing': '动作电位发放',
    'histological reconstruction of cno microinjection sites': 'CNO微注射位点的组织学重建',
    'chemogenetic activation with cno puff': 'CNO局部给药诱导的化学遗传学激活',
    'electrophysiological recording of action potential firing': '动作电位发放的电生理记录',
    'representative images of viral infection and cannula position': '病毒感染与套管位置的代表性图像',
    'open field': '旷场实验',
    'open field test': '旷场实验',
    'of test': '旷场实验',
    'elevated plus maze': '高架十字迷宫实验',
    'elevated plus-maze': '高架十字迷宫实验',
    'epm': '高架十字迷宫实验',
    'tail suspension': '悬尾实验',
    'tail suspension test': '悬尾实验',
    'ts test': '悬尾实验',
    'sucrose preference': '蔗糖偏好实验',
    'sucrose preference test': '蔗糖偏好实验',
    'sp test': '蔗糖偏好实验',
    'von frey': 'von Frey机械痛阈测试',
    'von frey test': 'von Frey机械痛阈测试',
    'hplc': '高效液相色谱',
    'high-performance liquid chromatography': '高效液相色谱',
    'high performance liquid chromatography': '高效液相色谱',
    'rnasecope': 'RNAscope原位杂交',
    'in situ hybridization': '原位杂交',
    'open arm entries': '高架十字迷宫开放臂进入次数',
    'open arm time': '高架十字迷宫开放臂停留时间',
    'freezing time': '冻结时间测定',
    'sucrose preference percentage': '蔗糖偏好率测定',
    'total distance': '总移动距离测定'
  });
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
      figure_title_zh: stringSchema(),
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
      'figure_id', 'analysis_depth', 'basis', 'figure_title_zh', 'figure_question_zh', 'panels',
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

  function createUnlabeledFigureOverviewSchema(depth = 'standard') {
    const analysisDepth = normalizeFigureDepth(depth);
    const properties = {
      figure_id: stringSchema(),
      analysis_depth: { type: 'string', enum: [analysisDepth] },
      basis: { type: 'string', enum: ['vision_text', 'caption_context'] },
      figure_title_zh: stringSchema(),
      figure_question_zh: stringSchema(),
      evidence_steps: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            source_zh: stringSchema(),
            established_zh: stringSchema(),
            handoff_zh: stringSchema(),
            evidence_level: { type: 'string', enum: EVIDENCE_RELATION_LEVELS }
          },
          required: [
            'source_zh', 'established_zh', 'handoff_zh', 'evidence_level'
          ]
        }
      },
      author_assembly_zh: stringSchema(),
      core_conclusion_zh: stringSchema(),
      claim_boundary_zh: stringSchema()
    };
    const required = [
      'figure_id', 'analysis_depth', 'basis', 'figure_title_zh', 'figure_question_zh',
      'evidence_steps', 'author_assembly_zh', 'core_conclusion_zh',
      'claim_boundary_zh'
    ];
    if (analysisDepth === 'deep') {
      Object.assign(properties, {
        alternative_explanations: stringArraySchema(),
        paper_argument_role_zh: stringSchema(),
        deep_author_strategy_zh: stringSchema()
      });
      required.push(
        'alternative_explanations', 'paper_argument_role_zh',
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

  function createFigurePanelInterpretationSchema() {
    return {
      type: 'object',
      additionalProperties: false,
      properties: {
        figure_id: stringSchema(),
        panel: stringSchema(),
        basis: { type: 'string', enum: ['vision_text', 'caption_context'] },
        panel_interpretation: createFigureAnalysisSchema('standard').properties.panels.items,
        claim_boundary_zh: stringSchema()
      },
      required: ['figure_id', 'panel', 'basis', 'panel_interpretation', 'claim_boundary_zh']
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

  function localizeFigureMethodLabel(value) {
    const text = cleanFigureField(value, 240);
    if (!text || /[\u3400-\u9fff]/u.test(text)) return text;
    const recognized = normalizeRecognizedMethod(text);
    if (recognized) return recognized;
    const key = methodAliasKey(text);
    if (METHOD_LABELS_ZH[key]) return METHOD_LABELS_ZH[key];
    const normalized = text
      .replace(/\brepresentative images?\b/gi, '代表性图像')
      .replace(/\bschematic(?: diagram)?\b/gi, '实验示意图')
      .replace(/\bhistological reconstruction\b/gi, '组织学重建')
      .replace(/\bwhole-cell patch[- ]clamp(?: recording)?\b/gi, '全细胞膜片钳记录')
      .replace(/\bpatch[- ]clamp electrophysiology\b/gi, '膜片钳电生理记录')
      .replace(/\belectrophysiological recording\b/gi, '电生理记录')
      .replace(/\belectrophysiology\b/gi, '电生理记录')
      .replace(/\bfiber photometry(?: recording)?\b/gi, '光纤记录')
      .replace(/\boptogenetic (?:activation|stimulation)\b/gi, '光遗传激活')
      .replace(/\bchemogenetic (?:activation|inhibition)\b/gi, match =>
        /inhibition/i.test(match) ? '化学遗传抑制' : '化学遗传激活')
      .replace(/\bviral? (?:infection|injection)\b/gi, match =>
        /infection/i.test(match) ? '病毒感染' : '病毒注射')
      .replace(/\bcannula position\b/gi, '套管位置')
      .replace(/\bcno microinjection sites?\b/gi, 'CNO微注射位点')
      .replace(/\baction potential firing\b/gi, '动作电位发放')
      .replace(/\bbehavioral (?:test|tests|assay)\b/gi, '行为学测试')
      .replace(/\bopen[- ]field(?: test)?\b|\bOF test\b/gi, '旷场实验')
      .replace(/\belevated plus[- ]maze(?: test)?\b|\bEPM\b/gi, '高架十字迷宫实验')
      .replace(/\btail suspension(?: test)?\b|\bTS test\b/gi, '悬尾实验')
      .replace(/\bsucrose preference(?: test)?\b|\bSP test\b/gi, '蔗糖偏好实验')
      .replace(/\bvon Frey(?: test)?\b/gi, 'von Frey机械痛阈测试')
      .replace(/\bhigh[- ]performance liquid chromatography\b|\bHPLC\b/gi, '高效液相色谱')
      .replace(/\bin situ hybridization\b/gi, '原位杂交')
      .replace(/\bquantification\b/gi, '定量分析')
      .replace(/\bheatmap\b/gi, '热图')
      .replace(/,\s*/g, '、')
      .replace(/\s+/g, ' ')
      .trim();
    return normalized || text;
  }

  function inferMethodFamily(value, fallback = 'other') {
    const text = methodAliasKey(value);
    if (!text) return fallback;
    if (/(?:rna|dna|sequenc|transcript|single-cell|scrna|kegg|gsea|pathway|bioinformatic|clustering|umap|pca)/i.test(text)) {
      return 'bioinformatics';
    }
    if (/(?:microscop|imaging|image|fluorescen|histolog|ihc|h&e|tomograph|mri|pet|ultrasound)/i.test(text)) {
      return 'imaging';
    }
    if (/(?:cohort|patient|clinical|survival analysis|kaplan|hazard ratio|randomi[sz]ed)/i.test(text)) {
      return 'clinical';
    }
    if (/(?:schematic|diagram|model illustration)/i.test(text)) return 'schematic';
    if (/(?:blot|pcr|qpcr|elisa|cytometry|facs|assay|stain|culture|immuno|mass spect|chromatograph|electrophysi|patch clamp)/i.test(text)) {
      return 'wet_lab';
    }
    return METHOD_CATEGORIES.includes(fallback) ? fallback : 'other';
  }

  function normalizeMethodEvidence(value, fallbackCategory = 'other') {
    const source = Array.isArray(value) ? value : [];
    const details = [];
    const seen = new Set();
    for (const item of source.slice(0, 24)) {
      const methodText = cleanFigureField(item, 240);
      if (!methodText) continue;
      const canonicalMethod = normalizeRecognizedMethod(methodText) || methodText;
      const normalizedMethod = localizeFigureMethodLabel(canonicalMethod);
      const key = methodAliasKey(normalizedMethod);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      details.push({
        methodText,
        methodFamily: inferMethodFamily(methodText, fallbackCategory),
        normalizedMethod
      });
    }
    return details.slice(0, 12);
  }

  function normalizeMethods(value, fallbackCategory = 'other') {
    return normalizeMethodEvidence(value, fallbackCategory)
      .map(item => item.normalizedMethod);
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
      'local_inference_zh 与 contribution_zh 必须提炼该 Panel 在证据链中的功能：它支持、排除、验证或推进了什么判断；不得只是翻译图注。',
      '比例尺、标尺数值、图片尺寸、单纯“示意图/代表性图像”、注射位置或实验流程本身不是证据结论；除非它们验证了操作有效性或排除了替代解释，否则不要把它们写进证据组结论或 argument_chain。',
      '4. 串联逻辑：先把同一实验的图像与定量 Panel 合并成证据组，再说明组间逻辑桥。',
      '为每个 Panel 标记 observation_source：image_observation、caption_statement、body_statement、multi_source 或 inference。',
      '观察只能陈述输入明确支持的事实；推论使用“支持、提示、与……一致”，证据不足时不得使用“证明、导致、介导”。',
      'Panel 标识必须来自输入，不得按连续字母自行补齐。',
      '每个 Panel 必须一对一解读：先锁定该字母在图片中的区域、该字母对应的图注分句、标题和坐标轴，再填写这个 Panel 的记录。',
      '不得把 A–D、E–H 等 Panel 组的实验清单复制到组内每个 Panel；组级共同作用只能写入 panel_groups。若输入只能支持组级信息而不能区分单个 Panel，应在单 Panel 字段中明确“现有证据无法单独区分”，不得猜测或复制整组信息。',
      '不同的行为学读出必须区分：总移动距离通常是运动能力控制；开放臂进入/停留对应高架十字迷宫；冻结时间、蔗糖偏好率、机械痛阈分别是不同读出，不能互相替代。',
      'figure_title_zh 只填写原 Figure 标题的直接中文翻译，不得改写成结果总结；输入没有独立 Figure 标题时填写空字符串。',
      '字段内容不要重复“实验设计：”“结果观察：”“结论推导：”“核心结论：”等界面标签。',
      '标准结果最多 30 个 Panel、6 个 Panel 组和 8 条逻辑桥。',
      '用中文输出严格 JSON，不要 Markdown。'
    ];
    common.push(
      'For every Panel, keep role, phenotype_name_zh, and methods separate: role is the evidence function, phenotype_name_zh is the concrete measured phenotype, and methods are the named assay or analysis.',
      'When role is "phenotype", phenotype_name_zh must be a concrete phenotype supported by the input; use "\u672a\u660e\u786e" when it is not stated. For every other role, phenotype_name_zh must be an empty string.',
      'Set method_category to wet_lab, imaging, bioinformatics, clinical, schematic, or other, and method_source to image, caption, body, or inference. In text-only mode, do not use image as method_source.',
        'methods is an open list of method phrases explicitly supported by the image, caption, or body text; do not force it into a closed vocabulary. Every descriptive method or chart-type phrase must be written in Chinese. Established molecular assay abbreviations and proper names such as WB, RNAscope, RNA-seq, GRAB-DA and CNO may remain, but behavioral assay abbreviations such as OF, EPM, TS and SP must be written as their Chinese experiment names. Do not return English phrases such as schematic, representative images, histological reconstruction, electrophysiology, model setup, or phenotype. Do not guess. Use an empty array when no method is supported. Known aliases and method families are normalized locally after the response.'
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

  function uniqueMatches(text, pattern, limit = 16) {
    const values = [];
    const seen = new Set();
    let match;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(text)) && values.length < limit) {
      const value = cleanText(match[1] || match[0], 240);
      const key = value.toLowerCase();
      if (value && !seen.has(key)) {
        seen.add(key);
        values.push(value);
      }
      if (!pattern.global) break;
    }
    return values;
  }

  function buildFigureContext(input, requestedPanels = []) {
    const caption = cleanText(input?.caption, 12000);
    const paragraphs = (Array.isArray(input?.contextParagraphs)
      ? input.contextParagraphs : []).slice(0, 16);
    const panelCaptionSlices = {};
    const panelBodyRefs = {};
    const bodyRegistry = {};
    let sharedLegend = '';
    requestedPanels.forEach(panel => {
      const evidence = typeof shared.extractFigurePanelCaption === 'function'
        ? shared.extractFigurePanelCaption(caption, panel)
        : { sharedLegend: '', targetText: caption };
      if (!sharedLegend && evidence.sharedLegend) sharedLegend = evidence.sharedLegend;
      panelCaptionSlices[panel] = cleanText(evidence.targetText || evidence.combined, 3200);
      const selected = typeof shared.selectFigurePanelParagraphs === 'function'
        ? shared.selectFigurePanelParagraphs(paragraphs, {
          panelId: panel,
          figureLabel: input?.figureLabel,
          topic: 'general',
          question: panelCaptionSlices[panel]
        })
        : paragraphs.slice(0, 4);
      panelBodyRefs[panel] = [];
      selected.slice(0, 4).forEach((item, index) => {
        const paragraphId = cleanText(item?.paragraphId, 120) || `${panel}-body-${index + 1}`;
        panelBodyRefs[panel].push(paragraphId);
        if (!bodyRegistry[paragraphId]) {
          bodyRegistry[paragraphId] = {
            section_title: cleanText(item?.sectionTitle, 240),
            text: cleanText(item?.text, 1400)
          };
        }
      });
    });
    const registryText = [caption, ...paragraphs.map(item => item?.text || '')].join(' ');
    const methodRegistry = uniqueMatches(registryText,
      /\b((?:single[- ]cell\s+)?(?:RNA|DNA)[ -]?seq(?:uencing)?|Western blot|immunoblot|immunofluorescence|immunohistochemistry|flow cytometry|FACS|q?PCR|ELISA|mass spectrometry|patch[- ]clamp|electrophysiology|microscopy|GSEA|KEGG(?: pathway)?(?: analysis| enrichment)?)\b/gi, 20);
    const groupRegistry = uniqueMatches(registryText,
      /\b([A-Za-z0-9+./-]{1,24}(?:\s+[A-Za-z0-9+./-]{1,24}){0,4}\s+(?:group|control|cohort|cells?|mice|patients?|samples?))\b/gi, 20);
    const setupRegistry = uniqueMatches(registryText,
      /\b(n\s*=\s*\d+|mean\s*(?:\u00b1|\+\/-)\s*(?:SEM|SD)|\d+\s+(?:biological|technical)?\s*replicates?|paired|unpaired|randomi[sz]ed|blinded)\b/gi, 16);
    return {
      version: 'figure-context-v1',
      shared_legend: cleanText(sharedLegend, 2400),
      panel_caption_slices: panelCaptionSlices,
      body_registry: bodyRegistry,
      panel_body_refs: panelBodyRefs,
      group_registry: groupRegistry,
      method_registry: methodRegistry,
      setup_registry: setupRegistry
    };
  }

  function compileFigurePanelBatchPrompt(input, options = {}) {
    const analysisDepth = normalizeFigureDepth(options.analysisDepth);
    const visualInput = options.visualInput === true;
    const figureContext = buildFigureContext(input, normalizedPanelRefs(input?.panelHints));
    return {
      systemPrompt: [
        compileFigureSystemPrompt({ visualInput, analysisDepth: 'standard' }),
        'PANEL_EXTRACTION_PASS: return only the requested Panel records.',
        'Return exactly one record for every requested label and no record for any other label.',
        'For each record, use only that label\'s image region, caption clause, heading, axes and body references. Never copy a multi-Panel assay list or group conclusion into every member.',
        'If several labels form one experiment, keep their shared purpose concise but preserve the distinct readout, comparison and observation of each label. Put combined reasoning only in the later synthesis pass.',
        'Do not generate figure-level groups, bridges, argument chains, conclusions, or audit prose.',
        'Keep every string concise and evidence-grounded so all requested Panels fit in one JSON response.'
      ].join('\n'),
      userPrompt: JSON.stringify({
        figure_id: cleanText(input?.figureId, 80),
        figure_label: cleanText(input?.figureLabel, 80),
        article_title: cleanText(input?.articleTitle, 500),
        figure_context: figureContext,
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
        'Evidence groups must express what the grouped Panels establish in the paper argument, not translate their legend. Exclude scale bars, image dimensions, and setup-only details unless they validate the manipulation or rule out an alternative explanation.',
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

  function compileUnlabeledFigureOverviewPrompt(input, options = {}) {
    const analysisDepth = normalizeFigureDepth(options.analysisDepth);
    const visualInput = options.visualInput === true;
    return {
      systemPrompt: [
        'You are a rigorous biomedical figure-reading tutor.',
        'The webpage did not expose stable Panel labels for this Figure. Produce a Figure-level evidence overview without inventing Panel letters or numbers.',
        visualInput
          ? 'Figure pixels are supplied. Describe only components and comparisons that are actually legible.'
          : 'No Figure pixels are supplied. Use only the caption and related body text; never imply that you saw the image.',
        'Order evidence_steps by the paper\'s reasoning sequence. source_zh should name a grounded source such as the caption statement, related Results text, left plot, or workflow schematic, without fabricating a Panel label.',
        'Separate direct evidence from inference, state the handoff to the next step, and use the most conservative evidence_level.',
        'Return detailed but non-repetitive Chinese. Keep the JSON small and include every required key.',
        analysisDepth === 'deep'
          ? 'Also state plausible alternatives, the Figure\'s role in the paper argument, and the author\'s evidence-ordering strategy.'
          : 'Focus on the Figure question, ordered evidence, conclusion, and claim boundary.',
        'Return strict JSON only, without Markdown.'
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
          text: cleanText(item?.text, 1200)
        })),
        expected_panel_labels: [],
        analysis_basis: visualInput ? 'vision_text' : 'caption_context',
        analysis_depth: analysisDepth,
        pass: 'unlabeled_figure_overview'
      }),
      responseSchema: createUnlabeledFigureOverviewSchema(analysisDepth),
      schemaName: `figure_unlabeled_overview_${analysisDepth}`
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

  function compileFigurePanelInterpretationPrompt(input, options = {}) {
    const visualInput = options.visualInput === true;
    const panel = canonicalPanelRef(input?.panelId || input?.panel?.panel || input?.panel);
    const captionEvidence = input?.captionEvidence && typeof input.captionEvidence === 'object'
      ? input.captionEvidence : {};
    return {
      systemPrompt: [
        'You are a rigorous biomedical figure-reading tutor interpreting exactly one requested Panel.',
        'Use only the supplied Panel pixels when present, the target caption range, shared legend, and selected body paragraphs.',
        'Separate experimental purpose, design, comparison, direct observation, local inference, and contribution to the paper argument.',
        'Do not infer unseen axes, colors, sample sizes, statistics, methods, groups, or causal mechanisms.',
        visualInput
          ? 'Image pixels are supplied. State only details that are actually legible in those pixels.'
          : 'No image pixels are supplied. Never use image_observation or image as a source.',
        'Return strict Chinese JSON for the requested Panel only. Do not produce Figure-level groups, synthesis, or a domino chain.'
      ].join('\n'),
      userPrompt: JSON.stringify({
        request_mode: 'single_panel_interpretation',
        figure_id: cleanText(input?.figureId, 80),
        figure_label: cleanText(input?.figureLabel, 80),
        panel,
        article_title: cleanText(input?.articleTitle, 500),
        question_topic: cleanText(input?.topic, 40),
        shared_legend: cleanText(captionEvidence.sharedLegend, 2400),
        target_panel_caption: cleanText(captionEvidence.targetText || captionEvidence.combined, 4800),
        related_body_context: (Array.isArray(input?.contextParagraphs)
          ? input.contextParagraphs : []).slice(0, 4).map(item => ({
          paragraph_id: cleanText(item?.paragraphId, 120),
          section_title: cleanText(item?.sectionTitle, 240),
          text: cleanText(item?.text, 1600)
        })),
        analysis_basis: visualInput ? 'vision_text' : 'caption_context'
      }),
      responseSchema: createFigurePanelInterpretationSchema(),
      schemaName: 'figure_panel_interpretation_v1'
    };
  }

  function normalizedEnumToken(value) {
    return cleanText(value, 120).toLowerCase()
      .replace(/[\s\-/]+/g, '_')
      .replace(/[^a-z0-9_\u3400-\u9fff]/g, '')
      .replace(/^_+|_+$/g, '');
  }

  function normalizedFigureEnum(value, allowed, fallback) {
    const token = normalizedEnumToken(value);
    if (allowed.includes(token)) return token;
    if (token === '图像') {
      if (allowed.includes('image_observation')) return 'image_observation';
      if (allowed.includes('image')) return 'image';
    }
    if (token === '图注') {
      if (allowed.includes('caption_statement')) return 'caption_statement';
      if (allowed.includes('caption')) return 'caption';
    }
    if (token === '正文') {
      if (allowed.includes('body_statement')) return 'body_statement';
      if (allowed.includes('body')) return 'body';
    }
    const aliases = {
      setup: 'model_setup', model: 'model_setup', validation: 'manipulation_validation',
      manipulation: 'manipulation_validation', phenotype_validation: 'phenotype',
      quantitative: 'quantification', causal_mechanism: 'mechanism',
      control: 'negative_control', specificity_control: 'specificity',
      loss_of_function: 'necessity', gain_of_function: 'sufficiency',
      rescue_experiment: 'rescue', function: 'functional_outcome',
      external: 'external_validation', computational: 'bioinformatics',
      bioinformatic: 'bioinformatics', wetlab: 'wet_lab', diagram: 'schematic',
      image: 'image_observation', caption: 'caption_statement', body: 'body_statement',
      combined: 'multi_source', inferred: 'inference', perturbation: 'intervention_effect',
      intervention: 'intervention_effect', mechanistic: 'mechanistic_support',
      function_validation: 'functional_validation', correlation: 'association',
      模型建立: 'model_setup', 操作验证: 'manipulation_validation', 表型: 'phenotype',
      表型验证: 'phenotype', 定量: 'quantification', 机制: 'mechanism',
      阴性对照: 'negative_control', 特异性: 'specificity', 必要性: 'necessity',
      充分性: 'sufficiency', 挽救: 'rescue', 功能结局: 'functional_outcome',
      外部验证: 'external_validation', 湿实验: 'wet_lab', 成像: 'imaging',
      生物信息学: 'bioinformatics', 生信: 'bioinformatics', 临床: 'clinical',
      示意图: 'schematic', 图像: 'image', 图像观察: 'image_observation',
      图注: 'caption_statement', 正文: 'body_statement', 多来源: 'multi_source',
      推断: 'inference', 关联: 'association', 干预效应: 'intervention_effect',
      机制支持: 'mechanistic_support', 功能验证: 'functional_validation',
      现象到机制: 'phenomenon_to_mechanism', 关联到干预: 'association_to_intervention',
      定性到定量: 'qualitative_to_quantitative', 一般效应到特异性: 'general_effect_to_specificity',
      机制到功能结局: 'mechanism_to_functional_outcome', 初始证据到挽救: 'initial_evidence_to_rescue',
      单系统到外部验证: 'single_system_to_external_validation'
    };
    const alias = aliases[token];
    if (alias && allowed.includes(alias)) return alias;
    return allowed.includes(fallback) ? fallback : allowed[0];
  }

  function schemaDefault(schema) {
    if (schema?.type === 'array') return [];
    if (schema?.type === 'object') return {};
    if (schema?.type === 'boolean') return false;
    if (schema?.type === 'number' || schema?.type === 'integer') return 0;
    return '';
  }

  function projectFigureResponseToSchema(value, schema) {
    if (schema?.type === 'object') {
      if (!isPlainObject(value)) return value;
      const source = value;
      return Object.fromEntries(Object.entries(schema.properties || {}).map(([key, child]) => [
        key,
        projectFigureResponseToSchema(
          !Object.prototype.hasOwnProperty.call(source, key) || source[key] === null
            ? schemaDefault(child) : source[key],
          child
        )
      ]));
    }
    if (schema?.type === 'array') {
      if (!Array.isArray(value)) return value;
      return value.map(item => projectFigureResponseToSchema(item, schema.items));
    }
    if (schema?.type === 'string') {
      return value;
    }
    return value;
  }

  function repairFigureResponseShape(value, input, options, schema) {
    const repaired = projectFigureResponseToSchema(value, schema);
    const analysisDepth = normalizeFigureDepth(options?.analysisDepth);
    const visualInput = options?.visualInput === true;
    const expectedId = cleanText(input?.figureId, 80);
    if (!cleanText(repaired.figure_id, 80)) repaired.figure_id = expectedId;
    if ('analysis_depth' in repaired) repaired.analysis_depth = analysisDepth;
    if ('basis' in repaired) {
      repaired.basis = ['vision_text', 'caption_context'].includes(repaired.basis)
        ? repaired.basis : (visualInput ? 'vision_text' : 'caption_context');
    }
    (Array.isArray(repaired.panels) ? repaired.panels : []).forEach(panel => {
      if (!isPlainObject(panel)) return;
      panel.role = normalizedFigureEnum(panel.role, PANEL_ROLES, 'other');
      panel.method_category = normalizedFigureEnum(
        panel.method_category, METHOD_CATEGORIES, 'other'
      );
      panel.method_source = normalizedFigureEnum(
        panel.method_source, METHOD_SOURCES, 'inference'
      );
      panel.observation_source = normalizedFigureEnum(
        panel.observation_source, OBSERVATION_SOURCES, 'inference'
      );
    });
    (Array.isArray(repaired.logic_bridges) ? repaired.logic_bridges : []).forEach(bridge => {
      if (!isPlainObject(bridge)) return;
      bridge.relation_type = normalizedFigureEnum(
        bridge.relation_type, LOGIC_RELATION_TYPES, 'other'
      );
    });
    (Array.isArray(repaired.argument_chain) ? repaired.argument_chain : []).forEach(step => {
      if (!isPlainObject(step)) return;
      step.evidence_level = normalizedFigureEnum(
        step.evidence_level, EVIDENCE_RELATION_LEVELS, 'other'
      );
    });
    (Array.isArray(repaired.evidence_steps) ? repaired.evidence_steps : []).forEach(step => {
      if (!isPlainObject(step)) return;
      step.evidence_level = normalizedFigureEnum(
        step.evidence_level, EVIDENCE_RELATION_LEVELS, 'other'
      );
    });
    (Array.isArray(repaired.evidence_relations) ? repaired.evidence_relations : []).forEach(relation => {
      if (!isPlainObject(relation)) return;
      relation.relation_level = normalizedFigureEnum(
        relation.relation_level, EVIDENCE_RELATION_LEVELS, 'other'
      );
    });
    return repaired;
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
        'Match the depth and length to the requested topics and custom question. Explain the relevant evidence, comparison, reasoning, and boundary fully; do not shorten a substantive answer merely for brevity.',
        'Use readable Chinese with short labelled paragraphs, not Markdown tables.',
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
        shared_legend: cleanText(input?.captionEvidence?.sharedLegend, 2400),
        target_panel_caption: cleanText(
          input?.captionEvidence?.targetText || input?.captionEvidence?.combined || input?.caption,
          4800
        ),
        related_body_context: (Array.isArray(input?.contextParagraphs) ? input.contextParagraphs : [])
          .slice(0, 4).map(item => ({
            paragraph_id: cleanText(item?.paragraphId, 120),
            section_title: cleanText(item?.sectionTitle, 240),
            text: cleanText(item?.text, 1600)
          })),
        bounded_panel_history: (Array.isArray(input?.history) ? input.history : [])
          .map(item => ({
            role: item?.role === 'assistant' ? 'assistant' : 'user',
            content: cleanText(item?.content, 3200),
            memory_class: item?.memoryClass === 'retrieved' ? 'retrieved' : 'recent'
          })).filter(item => item.content),
        panel_ir: {
          version: cleanText(input?.panelIR?.version, 40) || 'panel-ir-v1',
          figure_id: cleanText(input?.panelIR?.figureId || input?.figureId, 80),
          panel_id: cleanText(input?.panelIR?.panelId || panel?.panel, 20),
          topic: cleanText(input?.panelIR?.topic || input?.topic, 40),
          role: cleanText(input?.panelIR?.priorInterpretation?.role || panel?.role, 80),
          phenotype: cleanText(
            input?.panelIR?.priorInterpretation?.phenotype || panel?.phenotypeName, 240
          ),
          methods: (Array.isArray(input?.panelIR?.priorInterpretation?.methods)
            ? input.panelIR.priorInterpretation.methods
            : Array.isArray(panel?.methods) ? panel.methods : []).slice(0, 12),
          observation: cleanFigureField(
            input?.panelIR?.priorInterpretation?.observation || panel?.directObservation, 1000
          ),
          contribution: cleanFigureField(
            input?.panelIR?.priorInterpretation?.contribution || panel?.contribution, 1000
          )
        },
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
      'figure_id', 'analysis_depth', 'basis', 'figure_title_zh', 'figure_question_zh',
      'panels', 'panel_groups',
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
    ['figure_id', 'analysis_depth', 'basis', 'figure_title_zh', 'figure_question_zh',
      'author_assembly_zh',
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

  function compactPanelSpecificityText(value) {
    return cleanFigureField(value, 1800)
      .toLowerCase()
      .replace(/[\s，。；、：:;,.!?！？()（）\[\]【】_-]+/g, '');
  }

  function assertPanelSpecificity(panels) {
    const source = Array.isArray(panels) ? panels : [];
    if (source.length < 2) return;
    const fullSignatures = new Map();
    const methodSignatures = new Map();
    for (const panel of source) {
      const fullSignature = [
        panel.role, panel.phenotypeName, ...(panel.methods || []), panel.purpose,
        panel.design, panel.comparison, panel.directObservation,
        panel.localInference, panel.contribution
      ].map(compactPanelSpecificityText).filter(Boolean).join('|');
      if (fullSignature.length >= 120) {
        const labels = fullSignatures.get(fullSignature) || [];
        labels.push(panel.panel);
        fullSignatures.set(fullSignature, labels);
      }
      const behavioralMethods = (panel.methods || []).filter(method =>
        /(旷场|高架十字迷宫|悬尾|蔗糖偏好|机械痛阈|冻结时间|运动距离)/.test(method)
      );
      if (behavioralMethods.length >= 3) {
        const signature = [...behavioralMethods].sort().join('|');
        const labels = methodSignatures.get(signature) || [];
        labels.push(panel.panel);
        methodSignatures.set(signature, labels);
      }
    }
    const duplicatedFull = [...fullSignatures.values()].find(labels => labels.length >= 3);
    if (duplicatedFull) {
      throw invalidResponse(
        `Figure response copied one group interpretation across Panels: ${duplicatedFull.join(', ')}`
      );
    }
    const duplicatedAssays = [...methodSignatures.values()].find(labels => labels.length >= 2);
    if (duplicatedAssays) {
      throw invalidResponse(
        `Figure response copied a multi-assay group list across Panels: ${duplicatedAssays.join(', ')}`
      );
    }
  }

  function validateFigureAnalysis(value, input, options = {}) {
    if (!isPlainObject(value)) {
      throw invalidResponse('Figure analysis must be an object');
    }
    const analysisDepth = normalizeFigureDepth(options.analysisDepth);
    if (options.repairResponse !== false) {
      value = repairFigureResponseShape(
        value, input, options, createFigureAnalysisSchema(analysisDepth)
      );
    }
    const expectedId = cleanText(input?.figureId, 80);
    if (cleanText(value.figure_id, 80) !== expectedId) {
      throw invalidResponse('Figure response id did not match the request');
    }
    assertRawFigureAnalysis(value, analysisDepth);
    const visualInput = options.visualInput === true;
    const allowPanelOnly = options.allowPanelOnly === true;
    const expectedPanels = normalizedPanelRefs(input?.panelHints);
    const seenPanels = new Set();
    const unexpectedPanels = [];
    const panels = [];
    for (const raw of Array.isArray(value.panels) ? value.panels.slice(0, 30) : []) {
      const panel = canonicalPanelRef(raw.panel);
      if (!panel) throw invalidResponse('Figure response panel label is invalid');
      if (expectedPanels.length && !expectedPanels.includes(panel)) {
        if (options.ignoreUnexpectedPanels !== true) {
          throw invalidResponse('Figure response returned an unexpected panel label');
        }
        if (!unexpectedPanels.includes(panel)) unexpectedPanels.push(panel);
        continue;
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
      const methodCategory = METHOD_CATEGORIES.includes(raw?.method_category)
        ? raw.method_category : 'other';
      const methodDetails = normalizeMethodEvidence(raw?.methods, methodCategory);
      panels.push({
        panel,
        role,
        phenotypeName: role === 'phenotype'
          ? (cleanPhenotypeName(raw?.phenotype_name_zh) || '\u672a\u660e\u786e') : '',
        methodCategory,
        methods: methodDetails.map(item => item.normalizedMethod),
        methodDetails,
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
    if (expectedPanels.length && !panels.length) {
      throw invalidResponse('Figure response did not contain any requested Panel');
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
    const missingPanels = expectedPanels.filter(panel => !returnedPanels.includes(panel));
    if (options.requireCompletePanels === true &&
        expectedPanels.length && missingPanels.length) {
      throw invalidResponse(
        `Figure response did not cover every requested Panel: ${missingPanels.join(', ')}`
      );
    }
    const emptyPanels = panels.filter(panel => !(
      (Array.isArray(panel.methods) && panel.methods.length) ||
      panel.purpose || panel.design || panel.comparison || panel.directObservation ||
      panel.localInference || panel.contribution
    )).map(panel => panel.panel);
    if (emptyPanels.length) {
      throw invalidResponse(
        `Figure response returned empty Panel interpretations: ${emptyPanels.join(', ')}`
      );
    }
    assertPanelSpecificity(panels);
    const base = {
      figureId: expectedId,
      analysisDepth,
      basis: visualInput && value.basis !== 'caption_context' ? 'vision_text' : 'caption_context',
      figureTitleZh: cleanFigureField(value.figure_title_zh, 600),
      figureQuestion: cleanFigureField(value.figure_question_zh, 2400),
      panels,
      panelGroups,
      logicBridges,
      argumentChain,
      panelCoverage: {
        expectedPanels,
        returnedPanels,
        missingPanels,
        unexpectedPanels,
        ignoredUnexpectedPanelCount: unexpectedPanels.length
      },
      authorAssembly: cleanFigureField(value.author_assembly_zh, 3200),
      coreConclusion: cleanFigureField(value.core_conclusion_zh, 2400),
      claimBoundary: cleanFigureField(value.claim_boundary_zh, 2400)
    };
    if (allowPanelOnly) {
      if (!base.panels.length) {
        throw invalidResponse('Figure Panel response did not contain usable content');
      }
    } else if (!base.figureQuestion || !base.coreConclusion) {
      throw invalidResponse(
        'Figure analysis must include a scientific question and a core conclusion'
      );
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
      figure_title_zh: '',
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
    value = repairFigureResponseShape(
      value, input, options, createFigurePanelBatchSchema(analysisDepth)
    );
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
    }, input, {
      ...options,
      ignoreUnexpectedPanels: true,
      requireCompletePanels: true,
      allowPanelOnly: true
    });
  }

  function validateFigureSynthesis(value, input, panelEvidence, options = {}) {
    const analysisDepth = normalizeFigureDepth(options.analysisDepth);
    value = repairFigureResponseShape(
      value, input, options, createFigureSynthesisSchema(analysisDepth)
    );
    requireExactFigureKeys(
      value,
      createFigureSynthesisSchema(analysisDepth).required,
      'synthesis root'
    );
    return validateFigureAnalysis({
      ...value,
      panels: (Array.isArray(panelEvidence) ? panelEvidence : []).map(panelToRaw)
    }, input, { ...options, requireCompletePanels: true });
  }

  function validateUnlabeledFigureOverview(value, input, options = {}) {
    const analysisDepth = normalizeFigureDepth(options.analysisDepth);
    const schema = createUnlabeledFigureOverviewSchema(analysisDepth);
    value = repairFigureResponseShape(value, input, options, schema);
    requireExactFigureKeys(value, schema.required, 'unlabeled Figure overview root');
    const expectedFigureId = cleanText(input?.figureId, 80);
    if (cleanText(value.figure_id, 80) !== expectedFigureId) {
      throw invalidResponse('Unlabeled Figure overview id did not match the request');
    }
    if (value.analysis_depth !== analysisDepth) {
      throw invalidResponse('Unlabeled Figure overview depth did not match the request');
    }
    if (!['vision_text', 'caption_context'].includes(value.basis)) {
      throw invalidResponse('Unlabeled Figure overview basis is invalid');
    }
    assertRawArrayOfObjects(value.evidence_steps, 'evidence_steps', [
      'source_zh', 'established_zh', 'handoff_zh', 'evidence_level'
    ], { evidence_level: EVIDENCE_RELATION_LEVELS });
    const visualInput = options.visualInput === true;
    const evidenceSteps = value.evidence_steps.slice(0, 12).map(step => {
      const source = cleanFigureField(step.source_zh, 400);
      const established = cleanFigureField(step.established_zh, 1800);
      return {
        panels: [],
        established: source && established
          ? `${source}\uff1a${established}` : (established || source),
        handoff: cleanFigureField(step.handoff_zh, 1800),
        evidenceLevel: EVIDENCE_RELATION_LEVELS.includes(step.evidence_level)
          ? step.evidence_level : 'other'
      };
    }).filter(step => step.established || step.handoff);
    const result = {
      figureId: expectedFigureId,
      analysisDepth,
      basis: visualInput && value.basis !== 'caption_context'
        ? 'vision_text' : 'caption_context',
      figureTitleZh: cleanFigureField(value.figure_title_zh, 600),
      figureQuestion: cleanFigureField(value.figure_question_zh, 2400),
      panels: [],
      panelGroups: [],
      logicBridges: [],
      argumentChain: evidenceSteps,
      panelCoverage: {
        expectedPanels: [], returnedPanels: [], missingPanels: [],
        unexpectedPanels: [], ignoredUnexpectedPanelCount: 0
      },
      authorAssembly: cleanFigureField(value.author_assembly_zh, 3200),
      coreConclusion: cleanFigureField(value.core_conclusion_zh, 2400),
      claimBoundary: cleanFigureField(value.claim_boundary_zh, 2400),
      unlabeledOverview: true
    };
    if (!result.figureQuestion && !result.coreConclusion && !result.argumentChain.length) {
      throw invalidResponse('Unlabeled Figure overview did not contain usable content');
    }
    if (analysisDepth === 'deep') Object.assign(result, {
      controlAnalysis: [],
      evidenceRelations: evidenceSteps.map(step => ({
        panels: [], relationLevel: step.evidenceLevel,
        rationale: step.established
      })),
      negativeResultValue: '',
      qualitativeQuantitativeLink: '',
      alternativeExplanations: normalizedStringList(
        value.alternative_explanations, 20
      ),
      missingLinksIfPanelRemoved: [],
      paperArgumentRole: cleanFigureField(value.paper_argument_role_zh, 2400),
      deepAuthorStrategy: cleanFigureField(value.deep_author_strategy_zh, 3200)
    });
    return result;
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
      figure_title_zh: value.figureTitleZh || '',
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
    const validated = validateFigureAnalysis(raw, input, {
      analysisDepth,
      visualInput: value.basis === 'vision_text',
      repairResponse: false,
      requireCompletePanels: true
    });
    if (value.unlabeledOverview === true) validated.unlabeledOverview = true;
    return validated;
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

  function validateFigurePanelInterpretation(value, input, options = {}) {
    const expectedFigureId = cleanText(input?.figureId, 80);
    const expectedPanel = canonicalPanelRef(input?.panelId || input?.panel?.panel || input?.panel);
    requireExactFigureKeys(value, [
      'figure_id', 'panel', 'basis', 'panel_interpretation', 'claim_boundary_zh'
    ], 'Panel interpretation');
    if (cleanText(value.figure_id, 80) !== expectedFigureId ||
        canonicalPanelRef(value.panel) !== expectedPanel) {
      throw invalidResponse('Panel interpretation did not match the requested Figure or Panel');
    }
    assertRawPanelShape(value.panel_interpretation);
    if (canonicalPanelRef(value.panel_interpretation.panel) !== expectedPanel) {
      throw invalidResponse('Panel interpretation body returned a different Panel');
    }
    const normalized = validateFigureAnalysis({
      figure_id: value.figure_id,
      analysis_depth: 'standard',
      basis: value.basis,
      figure_question_zh: '',
      panels: [value.panel_interpretation],
      panel_groups: [],
      logic_bridges: [],
      argument_chain: [],
      author_assembly_zh: '',
      core_conclusion_zh: '',
      claim_boundary_zh: value.claim_boundary_zh
    }, { ...input, panelHints: [expectedPanel] }, {
      analysisDepth: 'standard', visualInput: options.visualInput === true,
      allowPanelOnly: true,
      requireCompletePanels: true
    });
    return {
      ...normalized.panels[0],
      figureId: expectedFigureId,
      basis: normalized.basis,
      claimBoundary: normalized.claimBoundary
    };
  }

  // A committed Figure result remains readable even when a later DOM refresh or
  // parser version discovers additional Panel labels. Coverage completeness is
  // a re-analysis decision; it must never hide a previously durable result.
  function isUsableFigureAnalysisResult(value, input = {}, options = {}) {
    if (!value || typeof value !== 'object') return false;
    const expectedFigureId = cleanText(input?.figureId || value.figureId, 80);
    if (!expectedFigureId || cleanText(value.figureId, 80) !== expectedFigureId) return false;
    const expectedDepth = options.analysisDepth === 'deep'
      ? 'deep' : options.analysisDepth === 'standard' ? 'standard' : '';
    if (expectedDepth && value.analysisDepth !== expectedDepth) return false;
    if (!cleanFigureField(value.figureQuestion, 6000) ||
        !cleanFigureField(value.coreConclusion, 6000)) return false;
    const panels = Array.isArray(value.panels) ? value.panels : [];
    if (!panels.length) {
      // A Figure whose publisher DOM exposes no stable Panel labels is
      // intentionally analyzed as one whole-Figure evidence overview. Its
      // durable result has no synthetic Panel records; the ordered argument
      // chain is the evidence payload that makes the result usable.
      if (value.unlabeledOverview !== true) return false;
      const chain = Array.isArray(value.argumentChain) ? value.argumentChain : [];
      return chain.some(step =>
        cleanFigureField(step?.established, 6000) ||
        cleanFigureField(step?.handoff, 6000)
      );
    }
    return panels.every(panel => Boolean(
      canonicalPanelRef(panel?.panel) && (
        (Array.isArray(panel?.methods) && panel.methods.some(Boolean)) ||
        cleanFigureField(panel?.purpose, 6000) ||
        cleanFigureField(panel?.design, 6000) ||
        cleanFigureField(panel?.comparison, 6000) ||
        cleanFigureField(panel?.directObservation, 6000) ||
        cleanFigureField(panel?.localInference, 6000) ||
        cleanFigureField(panel?.contribution, 6000)
      )
    ));
  }

  return {
    FIGURE_ANALYSIS_VERSION,
    PANEL_FOLLOWUP_TOPICS,
    DEFAULT_PANEL_FOLLOWUP_PROMPTS,
    createFigureAnalysisSchema,
    createUnlabeledFigureOverviewSchema,
    createFigurePanelBatchSchema,
    createFigureSynthesisSchema,
    createFigurePanelInterpretationSchema,
    createPanelFollowupSchema,
    compileFigureAnalysisPrompt,
    compileFigurePanelBatchPrompt,
    compileFigureSynthesisPrompt,
    compileUnlabeledFigureOverviewPrompt,
    compileFigurePanelInterpretationPrompt,
    compilePanelFollowupPrompt,
    isFatalFigureBatchError,
    normalizeFigureDepth,
    validateFigureAnalysis,
    validateFigurePanelBatch,
    validateFigureSynthesis,
    validateUnlabeledFigureOverview,
    validateCachedFigureAnalysis,
    validateFigurePanelInterpretation,
    validatePanelFollowup,
    isUsableFigureAnalysisResult,
    normalizePanelFollowupTopics,
    normalizePanelFollowupPrompts,
    normalizePanelCustomQuestion,
    buildFigureContext,
    normalizeMethodEvidence,
    localizeFigureMethodLabel
  };
});
