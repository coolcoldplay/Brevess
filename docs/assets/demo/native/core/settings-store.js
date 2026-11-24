(function attach(root, factory) {
  const isCommonJs = typeof module === 'object' && module.exports;
  const shared = root.SciLLM || {};
  if (isCommonJs) {
    Object.assign(shared, require('./llm-task-catalog.js'));
    Object.assign(shared, require('./token-budget.js'));
    Object.assign(shared, require('./tts-service.js'));
    Object.assign(shared, require('./literature-url.js'));
  }
  const api = factory(shared);
  if (isCommonJs) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  const DEFAULT_FIGURE_PANEL_HEADER_FIELDS = Object.freeze({
    evidenceType: true,
    purpose: false,
    experimentalMethods: true,
    statisticalMethods: true,
    comparison: false,
    directObservation: false
  });
  const FALLBACK_PANEL_FOLLOWUP_PROMPTS = Object.freeze({
    grouping: '解释实验分组、对照组与比较关系，并明确这些分组能够和不能支持的结论。',
    technique_principle: '解释实验或生物信息学技术的原理、读出指标及合理的解释边界。',
    axes_reading: '解释输入中有证据支持的坐标轴、标签和实用读图顺序；不可见时明确说明。',
    sample_information: '只解释输入明确支持的样本、物种、组织、细胞、队列和重复信息，不补猜缺失细节。'
  });
  const DEFAULT_PANEL_FOLLOWUP_PRESETS = Object.freeze([
    Object.freeze({
      id: 'grouping',
      topic: 'grouping',
      name: '分组含义与设置',
      prompt: FALLBACK_PANEL_FOLLOWUP_PROMPTS.grouping
    }),
    Object.freeze({
      id: 'technique_principle',
      topic: 'technique_principle',
      name: '实验技术原理',
      prompt: FALLBACK_PANEL_FOLLOWUP_PROMPTS.technique_principle
    }),
    Object.freeze({
      id: 'axes_reading',
      topic: 'axes_reading',
      name: '横纵坐标含义与读图方法',
      prompt: FALLBACK_PANEL_FOLLOWUP_PROMPTS.axes_reading
    }),
    Object.freeze({
      id: 'sample_information',
      topic: 'sample_information',
      name: '实验所用样本信息',
      prompt: FALLBACK_PANEL_FOLLOWUP_PROMPTS.sample_information
    })
  ]);

  function normalizePanelFollowupPresets(value, legacyPrompts = {}) {
    const source = Array.isArray(value) ? value : DEFAULT_PANEL_FOLLOWUP_PRESETS.map(preset => ({
      ...preset,
      prompt: legacyPrompts?.[preset.topic] || preset.prompt
    }));
    const validTopics = new Set(Object.keys(FALLBACK_PANEL_FOLLOWUP_PROMPTS));
    const seen = new Set();
    return source.slice(0, 30).map((item, index) => {
      const raw = item && typeof item === 'object' ? item : {};
      const fallback = DEFAULT_PANEL_FOLLOWUP_PRESETS[index] || {};
      let id = String(raw.id || fallback.id || `panel_prompt_${index + 1}`)
        .normalize('NFKC').toLowerCase().replace(/[^a-z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '').slice(0, 80) || `panel_prompt_${index + 1}`;
      let suffix = 2;
      const baseId = id;
      while (seen.has(id)) id = `${baseId}_${suffix++}`.slice(0, 80);
      seen.add(id);
      const requestedTopic = raw.topic !== undefined
        ? String(raw.topic || '')
        : String(raw.id && raw.id !== fallback.id ? '' : (fallback.topic || ''));
      return {
        id,
        topic: validTopics.has(requestedTopic) ? requestedTopic : '',
        name: String(raw.name || fallback.name || `追问 ${index + 1}`)
          .normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, 80),
        prompt: String(raw.prompt || fallback.prompt || '')
          .normalize('NFKC').trim().slice(0, 4000)
      };
    }).filter(item => item.name && item.prompt);
  }
  const LEGACY_ARTICLE_CHAT_QUICK_PROMPTS = Object.freeze([
    Object.freeze({
      id: 'core_claim',
      name: '核心结论',
      prompt: '请概括本文最核心的结论，并逐条说明对应的关键原文证据。'
    }),
    Object.freeze({
      id: 'evidence_chain',
      name: '证据链',
      prompt: '请梳理作者支持核心机制的完整证据链，并指出其中最薄弱的一环。'
    }),
    Object.freeze({
      id: 'limitations',
      name: '局限性',
      prompt: '请结合正文证据总结本文的主要局限、尚未解决的问题和可能影响结论外推的条件。'
    }),
    Object.freeze({
      id: 'section_compare',
      name: '跨章节比较',
      prompt: '请比较所选章节中的观点、证据和结论，指出一致之处、差异及潜在矛盾。'
    })
  ]);

  const DEFAULT_ARTICLE_CHAT_QUICK_PROMPTS = Object.freeze([
    { id: 'team_prior_work', name: '团队前作时间线',
      prompt: '这篇论文接的是团队哪项前作的下一棒？核实作者身份，选最多三篇直接相关的前作，按年份列出当时的发现、留下的问题，以及本文承接它的实验。附已核实的 DOI 或 PMID，标明本文是否直接引用。无法联网时仅用当前可见资料，标注待核验项。' },
    { id: 'changed_judgment', name: '读完后，哪个判断该变？',
      prompt: '写出读本文前后，一位谨慎的同行会如何表述同一个科学判断。标出发生变化的关键词、让你改口的那项结果，以及为什么证据只够你改到这个程度。若只能从引言重建当时的认识，请注明。' },
    { id: 'read_each_panel', name: '逐 Panel 读图',
      prompt: '从我选中的图开始，未指定时先读第一张主图。每个 Panel 讲清楚比较谁、先看哪里、观察到了什么、最多能得出什么结论。标明哪些信息来自原图，哪些仅来自图注。原图不可见时请说明。' },
    { id: 'distinguishing_figure', name: '哪张图区分了两种解释？',
      prompt: '在揭示结果前，先列出两种合理解释，以及它们对同一实验的预测。再指出哪个 Panel 最能区分两者。若两种解释都能产生图中的结果，说明实验回答了什么、什么问题仍然开放。' },
    { id: 'shared_evidence', name: '哪些证据可能一起出错？',
      prompt: '选一项由多张图支持的核心结论。检查这些图是否共享样本、测量方法或分析假设。指出哪些证据可能一起出错，以及哪一项独立证据最能让你放心。原文未交代的地方标为未知。' },
    { id: 'transferable_decision', name: '学走作者最聪明的一步',
      prompt: '只挑一个最值得借鉴的研究决策。还原作者面对的困难、一个直觉上会尝试的做法，以及作者实际怎么做。解释这一步多获得了什么信息，并提炼出一条能迁移到其他课题的原则。' },
    { id: 'pi_guided_reading', name: 'PI 带我精读',
      prompt: '一次只问我一个问题，等我回答再继续。先让我预测关键实验，再让我解释真实结果，最后让我判断结论边界。反馈时指出我用对了哪条证据、哪一步推断走远了，以及值得回看的 Panel。现在只提出第一个问题。' },
    { id: 'journal_club_outline', name: '10 分钟组会大纲',
      prompt: '为没读过本文的组员设计一场 10 分钟、最多 8 页的汇报。逐页给出一句可直接使用的标题、建议展示的原图或材料、过渡句和用时。把最多时间留给决定结论的实验。' },
    { id: 'three_panels', name: '只讲三个 Panel',
      prompt: '如果汇报临时缩到 5 分钟，只能展示三个 Panel，你会留哪三个？按听众能跟上的顺序排列，说明每个 Panel 必须指给大家看的对照，以及删掉它会让哪一步论证断掉。另留一张答疑备用图。' },
    { id: 'agent_journal_club_ppt', name: '让 Agent 制作组会 PPT',
      prompt: '请让已连接的 Agent 为当前论文制作并下载可编辑的组会 PPT（.pptx）。默认 10 分钟，讲给尚未读过本文的同事。先用一句话讲清背景中的知识缺口和研究问题，再按“问题 → 实验与对照 → 观察 → 判断”组织证据，最后交代结论边界和可讨论的问题。以证据块为最小排图单位：为每个判断列出所需的比较对象、对照和原始 Figure/Panel。同一证据块的实验设计、代表图和定量 Panel 尽量同页；图太密、投影时标签难以辨认才拆页，续页沿用证据块编号并保留关键对照。每个结果页用一句可验证的判断作标题，标注 Figure、Panel 和来源页码或原文位置。原图按比例完整适应图框，允许留白，保留坐标轴、图例、比例尺和 Panel 字母。图与文字可分别编辑。缺图或数据不明时标记待核对，不补画实验数据。只结合我为本次制作授权的本篇问答、高亮、备注、笔记和解图；清楚区分原文观察、作者解释和我的推断。逐页写讲者备注，指出先看哪个 Panel、如何读对照、怎样过渡到下一页。交付前逐页对照每张原图的四边，核查引用、图文对应和投影可读性。' },
    { id: 'builtin_figure_map_v1', name: '图表梳理草图', prompt: `依据当前论文正文及已解读的 Figure/Panel 摘要，生成图表梳理草图。
先用不超过三句话说明核心发现、适用条件和证据范围，再输出可导入的草图。
节点写清具体分子、细胞、过程或结果。每个节点的 label 必须独立带上所属物种、细胞或样本体系；不能把这些条件仅放在单独的分组标题节点或说明段中。不同物种、细胞类型、处理条件不要合并。若不同干预并未联合施加，不得合成为联合条件；共用结果节点只保留各实验共同满足的条件，干预名称写在各自起点。优先保留主要机制，不凑节点数，证据少时只需两个节点，最多 24 个节点、36 条联系。优先画观察到的“干预 → 观测结果”：只有阻断/抑制实验时，使用阻断/抑制处理节点，不自动倒推一个未直接观察的激活机制。允许几组独立的干预—结果，不必拼成一条完整机制链。
每条联系必须引用提供的 figure_analysis_context 中真实存在的 Panel key。促进用 positive，抑制用 negative，仅相关时用 neutral；不要把相关性画成已证实的因果。联系方向必须与起点含义一致：若证据是阻断 R 降低 K，应画“R 阻断 → K”负联系，不能画“R 激活 → K”负联系。无差异或未增加不等于抑制，应写在局限段，不强行画负联系。不同物种、细胞或条件之间不得为凑连通图而连线；观察性关联应使用该观察体系自身的两个节点。可以有多组相互独立的子图。联系文字可为空。不凭常识补缺失机制。
在普通回答中给出一个完整的 brevess-map 代码块。JSON只含 schema、documentHash、sourceDigest、nodes、edges；schema固定为 brevess.chat-figure-map.v1，两个来源字段逐字复制上下文。节点为 {"id":"n1","label":"实体与条件"}；联系为 {"id":"e1","from":"n1","to":"n2","label":"关系或空字符串","polarity":"positive|negative|neutral","evidenceKeys":["上下文中的真实key"]}。节点ID唯一，每个端点都必须存在，每个节点至少参与一条联系。不要在JSON内放解释、引文标记、URL或操作指令。
遵守问答模块外层 NDJSON 协议：每行是一个合法 JSON 记录。markdown 的换行只转义一次为 \u005cn，内嵌图谱 JSON 的引号只转义一次为 \u005c"；不要二次转义整个 markdown，不要在普通说明中使用未转义的英文双引号。图谱代码块单独放在一个 answer_block，evidence为空数组，图谱内容不另加引文标记。
输出前检查：先确定有证据的 edges，再只保留这些 edges 端点实际使用的 nodes，删除没有连线的节点。无差异、未增加或未观察到效应的结果全部只放在局限段，既不画 negative，也不画 neutral，相关节点不得加入 nodes。neutral 仅用于明确观察到的关联，其两个端点必须各自在 label 写明观察样本体系。节点与联系 label 使用纯文字，不用 HTML 标签。
代码块后逐条简述证据与局限，按问答模块的规则引用原文；解图摘要仅作辅助，不是独立证明。不输出“已保存/已应用”：这里只生成待核对草图。最后输出 turn_summary 和 final 记录。
若没有已解读图表的辅助上下文，或它不足以支撑一条有证据的联系，明确指出需要先解读哪些图，不编造 key、来源字段或草图。` },
    { id: 'audit_talk', name: '汇报前核查',
      prompt: '逐句核对我提供的讲稿或 PPT 结论。用表格列出原句、对应原文或 Panel、证据是否支持、建议改写。优先找数字或方向说反、研究对象被偷换、把相关性讲成因果的问题。若还没有草稿，请先让我贴入。' }
  ].map(Object.freeze));

  const LEGACY_PPT_PROMPT_V3 = '请让已连接的 Agent 为当前论文制作并下载可编辑的组会 PPT（.pptx）。默认 10 分钟，讲给尚未读过本文的同事。先用一句话讲清背景中的知识缺口和研究问题，再按“问题 → 实验与对照 → 观察 → 判断”组织证据，最后交代结论边界和可讨论的问题。以证据块为最小排图单位：为每个判断列出所需的比较对象、对照和原始 Figure/Panel。同一证据块的实验设计、代表图和定量 Panel 尽量同页；图太密、投影时标签难以辨认才拆页，续页沿用证据块编号并保留关键对照。每个结果页用一句可验证的判断作标题，标注 Figure、Panel 和来源页码或原文位置。使用可核对的原图，保留比例、轴、图例、比例尺和字母，图与文字可分别编辑。缺图或数据不明时标记待核对，不补画实验数据。只结合我为本次制作授权的本篇问答、高亮、备注、笔记和解图；清楚区分原文观察、作者解释和我的推断。逐页写讲者备注，指出先看哪个 Panel、如何读对照、怎样过渡到下一页。交付前检查引用、图文对应和投影可读性。';

  function migrateArticleChatQuickPrompts(settings) {
    const rows = settings.articleChatQuickPrompts;
    if (!Array.isArray(rows) || !rows.length || settings.articleChatPromptCatalogVersion >= 5) return rows;
    const draft = DEFAULT_ARTICLE_CHAT_QUICK_PROMPTS.find(row => row.id === 'builtin_figure_map_v1');
    const withDraft = items => items.some(row => row?.id === draft.id) ? items : [...items, draft];
    if (settings.articleChatPromptCatalogVersion === 4) return withDraft(rows);
    if (settings.articleChatPromptCatalogVersion === 3) {
      const next = DEFAULT_ARTICLE_CHAT_QUICK_PROMPTS.find(row => row.id === 'agent_journal_club_ppt');
      const previous = LEGACY_PPT_PROMPT_V3.normalize('NFKC');
      return withDraft(rows.map(row => row?.id === next.id && typeof row.prompt === 'string' &&
        row.prompt.normalize('NFKC') === previous ? {...row, prompt: next.prompt} : row));
    }
    if (settings.articleChatPromptCatalogVersion === 2) {
      const ppt = DEFAULT_ARTICLE_CHAT_QUICK_PROMPTS.find(row => row.id === 'agent_journal_club_ppt');
      return withDraft(rows.some(row => row?.id === ppt.id) ? rows : [...rows, ppt]);
    }
    const canonical = text => String(text || '').normalize('NFKC').trim();
    const custom = rows.filter(row => !LEGACY_ARTICLE_CHAT_QUICK_PROMPTS.some(old =>
      old.id === row?.id && canonical(old.name) === canonical(row.name) && canonical(old.prompt) === canonical(row.prompt)));
    const ids = new Set(custom.map(row => row?.id));
    return [...custom, ...DEFAULT_ARTICLE_CHAT_QUICK_PROMPTS.filter(row => !ids.has(row.id))];
  }

  const DEFAULT_DISPLAY_QUICK_PROMPTS = Object.freeze([
    { id: "publisher_clean", name: "出版社论文纯净阅读",
      prompt: "识别当前出版社的论文正文栏，将其居中，最大行宽调到 82ch，窄窗口自动换行。隐藏广告、站点导航、侧栏推荐和页脚。保留标题、作者、正文、图表、图注、引用链接及补充材料入口。预览后检查正文可见性与实际宽度。" },
    { id: "text_width", name: "调整正文宽度",
      prompt: "将正文宽度设为 720px" },
    { id: "large_type", name: "大字阅读",
      prompt: "将正文段落字号调到 20px、行高调到 1.75。保留上下标、行内公式和引用序号，让标题与正文容易区分。" },
    { id: "hd_figure", name: "加载高清原图",
      prompt: "加载图 1 的高清原图" },
    { id: "captions", name: "图注对读",
      prompt: "让图注紧随对应图片，字号调到 16px、行高调到 1.6。保留 Panel 字母、图例、比例尺和原图链接，整张图按原比例显示。" },
    { id: "wide_table", name: "宽表横向滚动",
      prompt: "让超出正文宽度的表格在自己的区域内横向滚动，保留每一行、每一列和表注，正文宽度保持不变。" },
    { id: "section_headings", name: "突出章节层级",
      prompt: "用字号、字重和段前留白区分正文中的一级、二级和三级标题，保留标题文字、编号和跳转锚点。" }
  ].map(row => Object.freeze(row)));

  function normalizeArticleChatQuickPrompts(value, defaults = DEFAULT_ARTICLE_CHAT_QUICK_PROMPTS) {
    const source = Array.isArray(value) ? value : defaults;
    const seen = new Set();
    const limit = defaults === DEFAULT_DISPLAY_QUICK_PROMPTS ? 30 : 30 + DEFAULT_ARTICLE_CHAT_QUICK_PROMPTS.length;
    return source.slice(0, limit).map((item, index) => {
      const raw = item && typeof item === 'object' ? item : {};
      const fallback = defaults[index] || {};
      let id = String(raw.id || fallback.id || `prompt_${index + 1}`)
        .normalize('NFKC').toLowerCase().replace(/[^a-z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '').slice(0, 80) || `prompt_${index + 1}`;
      let suffix = 2;
      const baseId = id;
      while (seen.has(id)) {
        const tail = `_${suffix++}`;
        id = baseId.slice(0, 80 - tail.length) + tail;
      }
      seen.add(id);
      const name = String(raw.name || fallback.name || `快捷提示 ${index + 1}`)
        .normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, 80);
      const prompt = String(raw.prompt || fallback.prompt || '')
        .normalize('NFKC').trim().slice(0, 4000);
      return { id, name: name || `快捷提示 ${index + 1}`, prompt };
    }).filter(item => item.prompt);
  }

  function normalizeStoredPanelFollowupPrompts(value) {
    if (shared.normalizePanelFollowupPrompts) {
      return shared.normalizePanelFollowupPrompts(value);
    }
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return Object.fromEntries(Object.entries(FALLBACK_PANEL_FOLLOWUP_PROMPTS)
      .map(([topic, fallback]) => {
        const prompt = String(source[topic] || '').normalize('NFKC')
          .replace(/\s+/g, ' ').trim().slice(0, 1000);
        return [topic, prompt || fallback.normalize('NFKC')];
      }));
  }
  const FALLBACK_KEYBOARD_SHORTCUTS = Object.freeze({
    figures: 'F',
    navigation: 'G',
    analysis: 'A',
    highlights: 'H',
    chat: 'Q',
    semanticFind: 'J',
    zotero: 'Z',
    ppt: 'P',
    scanLocal: 'R',
    saveLocal: 'S',
    deleteLocal: 'D',
    exportJson: 'E',
    importJson: 'I',
    settings: 'T',
    collapseFigurePanels: '0'
  });

  function normalizeStoredKeyboardShortcuts(value) {
    if (shared.normalizeKeyboardShortcuts) {
      return shared.normalizeKeyboardShortcuts(value);
    }
    const source = value && typeof value === 'object' && !Array.isArray(value)
      ? value : {};
    return Object.fromEntries(Object.entries(FALLBACK_KEYBOARD_SHORTCUTS)
      .map(([actionId, defaultKey]) => {
        if (!Object.prototype.hasOwnProperty.call(source, actionId)) {
          return [actionId, defaultKey];
        }
        const normalized = String(source[actionId] ?? '')
          .normalize('NFKC').trim().toUpperCase();
        return [actionId, !normalized
          ? '' : /^[A-Z0-9]$/.test(normalized) ? normalized : defaultKey];
      }));
  }
  const LEGACY_SCENARIO_PRESETS = {"quick_story":{"name":"快速主线","description":"为什么做、如何验证、发现什么、说明什么","categoryIds":["known_background","knowledge_gap","objective","hypothesis","study_strategy","method","result","key_result","interpretation","conclusion","significance_novelty","limitation"]},"mechanism_chain":{"name":"机制证据链","description":"起始因素、机制中介、证据强度与下游结局","categoryIds":["driver_intervention","association_evidence","causal_effect","mechanism_mediator","necessity_evidence","sufficiency_evidence","rescue_evidence","temporal_dose_evidence","cross_system_validation","mechanism_gap","alternative_mechanism","evidence","interpretation"]},"critical_review":{"name":"批判性审读","description":"设计、统计、因果边界、替代解释与复现性","categoryIds":["design_control","sample_population","measurement_validity","effect_uncertainty","statistical_robustness","confounding_reverse_causality","causal_overreach","alternative_explanation","replication_external_validation","generalizability","statistical_vs_practical_significance","limitation","transparency_reproducibility"]},"review_synthesis":{"name":"综述证据综合","description":"范围、共识、矛盾、异质性、证据质量与作者综合判断","categoryIds":["review_scope_thesis","evidence_consensus","conflicting_evidence","heterogeneity_source","evidence_quality_certainty","integrative_framework","author_synthesis","knowledge_gap","evidence","conclusion","limitation","future"]}};

  function migrateUntouchedScenarioPresets(saved, normalized) {
    if (saved.scenarioPresetVersion === 1 || !Array.isArray(saved.analysisModes)) return normalized;
    const legacy = Object.entries(LEGACY_SCENARIO_PRESETS);
    const untouched = saved.analysisModes.length === legacy.length && legacy.every(([id, preset]) => {
      const mode = saved.analysisModes.find(item => item?.id === id);
      const override = saved.viewCategoryOverrides?.[id];
      return mode && mode.name === preset.name && mode.description === preset.description &&
        JSON.stringify(mode.categoryIds) === JSON.stringify(preset.categoryIds) &&
        !(override?.add?.length || override?.remove?.length);
    });
    return untouched ? createDefaultAnalysisModes() : normalized;
  }

  function createDefaultAnalysisModes() {
    const source = shared.READING_VIEWS && typeof shared.READING_VIEWS === 'object'
      ? shared.READING_VIEWS : {};
    return Object.entries(source).filter(([, definition]) => !definition.legacyOnly).map(([id, definition]) => ({
      id,
      name: String(definition?.name || id),
      description: String(definition?.description || ''),
      categoryIds: Array.isArray(definition?.categoryIds)
        ? [...definition.categoryIds] : []
    }));
  }

  function normalizeAnalysisModes(value, legacyOverrides = {}) {
    const defaults = createDefaultAnalysisModes();
    const source = Array.isArray(value) && value.length ? value : defaults;
    const seen = new Set();
    const normalized = source.slice(0, 30).map((item, index) => {
      const raw = item && typeof item === 'object' ? item : {};
      const fallback = defaults[index] || {};
      let id = String(raw.id || fallback.id || `mode_${index + 1}`)
        .normalize('NFKC').toLowerCase().replace(/[^a-z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '').slice(0, 80) || `mode_${index + 1}`;
      let suffix = 2;
      const baseId = id;
      while (seen.has(id)) {
        const ending = `_${suffix++}`;
        id = `${baseId.slice(0, 80 - ending.length)}${ending}`;
      }
      seen.add(id);
      const baseIds = Array.isArray(raw.categoryIds)
        ? raw.categoryIds : Array.isArray(fallback.categoryIds)
          ? fallback.categoryIds : [];
      const override = legacyOverrides?.[id] || {};
      const removed = new Set(Array.isArray(override.remove)
        ? override.remove.map(String) : []);
      const categoryIds = [...new Set([
        ...baseIds.map(String),
        ...(Array.isArray(override.add) ? override.add.map(String) : [])
      ])].filter(categoryId => categoryId && !removed.has(categoryId)).slice(0, 240);
      return {
        id,
        name: String(raw.name || fallback.name || `分析模式 ${index + 1}`)
          .normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, 80),
        description: String(raw.description ?? fallback.description ?? '')
          .normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, 240),
        categoryIds
      };
    }).filter(item => item.name);
    return normalized.length ? normalized : defaults;
  }
  const STORAGE_KEY = 'sciLlmSettingsV2';
  const V5_SETTINGS_BACKUP_KEY = 'sciLlmSettingsV5Backup';
  const SESSION_CATEGORY_KEY = 'sciLlmSessionCategoriesV2';
  const CATEGORY_IDS = [
    'hypothesis', 'objective', 'method', 'result', 'conclusion', 'comparison',
    'limitation', 'future', 'causality', 'emphasis', 'evidence', 'interpretation'
  ];
  const TASK_ROUTE_KEYS = ['highlight', 'summary', 'figure', 'crossFigure'];
  const REASONING_EFFORTS = new Set([
    'auto', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'
  ]);
  const LEGACY_TASK_ROUTE_GROUPS = Object.freeze({
    highlight: Object.freeze([
      'document_highlight', 'evidence_ledger_review'
    ]),
    summary: Object.freeze([
      'paragraph_summary', 'article_outline_summary', 'abbreviation_translation',
      'paper_research_logic', 'paper_innovations', 'paper_limitations',
      'literature_note_autofill', 'article_chat', 'selection_chat'
    ]),
    figure: Object.freeze([
      'figure_walkthrough', 'figure_panel_interpretation', 'figure_panel_followup'
    ]),
    crossFigure: Object.freeze(['cross_figure_mechanism'])
  });
  const LEGACY_ROUTE_REPRESENTATIVES = Object.freeze({
    highlight: 'document_highlight',
    summary: 'paragraph_summary',
    figure: 'figure_walkthrough',
    crossFigure: 'cross_figure_mechanism'
  });
  const PROFILE_ID_PATTERN = /^profile_[a-z0-9_]{3,80}$/;
  const PUBLIC_CONFIG_MAX_DEPTH = 32;
  const PROVIDER_IDS = [
    'openai', 'anthropic', 'gemini', 'deepseek', 'typesafe', 'codex-local', 'deepseek-harness',
    'openai-compatible'
  ];
  const PROVIDER_ID_SET = new Set(PROVIDER_IDS);
  const PROVIDER_NAMES = {
    openai: 'OpenAI',
    anthropic: 'Anthropic',
    gemini: 'Gemini',
    deepseek: 'DeepSeek',
    typesafe: 'TypeSafe Jev（文本判定）',
    'codex-local': '本机 Codex',
    'deepseek-harness': '本机 DeepSeek Harness',
    'openai-compatible': 'OpenAI-compatible'
  };
  const PROVIDER_VISION_DEFAULTS = {
    openai: true,
    anthropic: true,
    gemini: true,
    deepseek: false,
    typesafe: false,
    'codex-local': true,
    'deepseek-harness': false,
    'openai-compatible': false
  };
  const LEGACY_PROVIDER_DEFAULTS = {
    openai: { apiKey: '', model: 'gpt-5-mini', maxOutputTokens: 4096 },
    anthropic: { apiKey: '', model: 'claude-sonnet-4-6', maxOutputTokens: 4096 },
    gemini: { apiKey: '', model: 'gemini-3.5-flash', maxOutputTokens: 4096 },
    deepseek: {
      apiKey: '', model: 'deepseek-v4-flash', maxOutputTokens: 4096, thinking: false
    },
    typesafe: { apiKey: '', model: 'jev-latest', maxOutputTokens: 4096 },
    'codex-local': {
      model: 'auto', reasoningEffort: 'auto', maxOutputTokens: 4096
    },
    'deepseek-harness': {
      model: 'deepseek-flash', reasoningEffort: 'auto', maxOutputTokens: 4096
    },
    'openai-compatible': {
      apiKey: '', model: '', presetId: 'custom', baseUrl: '',
      authHeader: 'Authorization', authPrefix: 'Bearer', maxOutputTokens: 4096,
      jsonMode: true, supportsVision: true, customHeaders: {}
    }
  };

  function createDefaultViewOverrides() {
    return {
      quick_story: { add: [], remove: [] },
      mechanism_chain: { add: [], remove: [] },
      critical_review: { add: [], remove: [] },
      review_synthesis: { add: [], remove: [] }
    };
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
      Object.entries(value).map(([key, item]) => [key, cloneJsonLike(item)])
    );
  }

  function mergeJsonLike(base, override) {
    if (!isPlainObject(base) || !isPlainObject(override)) {
      return cloneJsonLike(override);
    }
    const merged = cloneJsonLike(base);
    Object.entries(override).forEach(([key, value]) => {
      merged[key] = isPlainObject(value) && isPlainObject(merged[key])
        ? mergeJsonLike(merged[key], value) : cloneJsonLike(value);
    });
    return merged;
  }

  function normalizeIdList(value) {
    return [...new Set((Array.isArray(value) ? value : [])
      .map(String)
      .filter(item => /^[a-z][a-z0-9_]*$/.test(item)))];
  }

  function normalizeFigurePanelHeaderFields(value) {
    const source = isPlainObject(value) ? value : {};
    return Object.fromEntries(Object.entries(DEFAULT_FIGURE_PANEL_HEADER_FIELDS)
      .map(([key, fallback]) => [
        key,
        typeof source[key] === 'boolean' ? source[key] : fallback
      ]));
  }

  function normalizeDeletedBuiltInCategoryIds(value) {
    const knownBuiltInIds = typeof shared.createUnifiedCategoryCatalog === 'function'
      ? new Set(Object.keys(shared.createUnifiedCategoryCatalog()))
      : null;
    return normalizeIdList(value)
      .filter(categoryId => !knownBuiltInIds || knownBuiltInIds.has(categoryId));
  }

  function normalizeViewOverrides(value) {
    const defaults = createDefaultViewOverrides();
    Object.keys(defaults).forEach(viewId => {
      defaults[viewId] = {
        add: normalizeIdList(value?.[viewId]?.add),
        remove: normalizeIdList(value?.[viewId]?.remove)
      };
    });
    return defaults;
  }

  function deriveViewOverride(viewId, selectedCategoryIds) {
    const defaults = shared.READING_VIEWS?.[viewId]?.categoryIds || CATEGORY_IDS;
    const selected = new Set(normalizeIdList(selectedCategoryIds));
    const knownCategoryIds = typeof shared.createAdaptiveCategoryCatalog === 'function'
      ? Object.keys(shared.createAdaptiveCategoryCatalog()) : defaults;
    return {
      add: [...selected].filter(categoryId => !defaults.includes(categoryId)),
      remove: [...new Set([...defaults, ...knownCategoryIds])]
        .filter(categoryId => !selected.has(categoryId))
    };
  }

  function normalizeStudyTypeOverrides(value) {
    const retained = new Map();
    Object.entries(value && typeof value === 'object' ? value : {})
      .forEach(([documentHash, item]) => {
        if (!/^[a-f0-9]{64}$/i.test(documentHash) || !item || typeof item !== 'object') {
          return;
        }
        const hasCurrentType = shared.isStudyType?.(item.studyType);
        const studyType = hasCurrentType
          ? item.studyType
          : (shared.isStudyType?.(item.primaryType) ? item.primaryType : null);
        if (!studyType) return;

        const timestamp = Number(item.updatedAt);
        const candidate = {
          studyType,
          updatedAt: Number.isFinite(timestamp) ? timestamp : 0,
          hasCurrentType
        };
        const normalizedHash = documentHash.toLowerCase();
        const previous = retained.get(normalizedHash);
        const candidateWinsTie = previous && candidate.updatedAt === previous.updatedAt && (
          (candidate.hasCurrentType && !previous.hasCurrentType) ||
          (candidate.hasCurrentType === previous.hasCurrentType &&
            candidate.studyType.localeCompare(previous.studyType) < 0)
        );
        if (!previous || candidate.updatedAt > previous.updatedAt || candidateWinsTie) {
          retained.set(normalizedHash, candidate);
        }
      });

    return Object.fromEntries(
      [...retained.entries()]
        .sort((first, second) =>
          second[1].updatedAt - first[1].updatedAt || first[0].localeCompare(second[0])
        )
        .slice(0, 50)
        .map(([documentHash, item]) => [documentHash, {
          studyType: item.studyType,
          updatedAt: item.updatedAt
        }])
    );
  }

  function normalizeCategoryOverrides(value, legacyAllRules) {
    const legacy = isPlainObject(legacyAllRules) ? legacyAllRules : {};
    const explicit = isPlainObject(value) ? value : {};
    const categoryIds = new Set([...Object.keys(legacy), ...Object.keys(explicit)]);
    const normalized = {};

    categoryIds.forEach(categoryId => {
      if (!/^[a-z][a-z0-9_]*$/.test(categoryId)) return;
      const legacyRule = isPlainObject(legacy[categoryId]) ? legacy[categoryId] : null;
      const explicitOverride = isPlainObject(explicit[categoryId])
        ? explicit[categoryId] : null;
      if (!legacyRule && !explicitOverride) return;

      const normalize = input => shared.normalizeCategoryOverride
        ? shared.normalizeCategoryOverride(input) : cloneJsonLike(input);
      const migrated = legacyRule ? normalize(legacyRule) : {};
      const saved = explicitOverride ? normalize(explicitOverride) : {};
      normalized[categoryId] = mergeJsonLike(migrated, saved);
    });
    return normalized;
  }

  function normalizeTokenLimit(value, fallback) {
    if (value === null || value === undefined || value === '' ||
        typeof value === 'boolean') return fallback;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    const rounded = Math.round(numeric / 256) * 256;
    return Math.max(512, Math.min(2000000, rounded));
  }

  function createTokenPolicy(value = {}) {
    return {
      mode: 'auto',
      autoCap: null,
      manualMax: null
    };
  }

  function normalizeContextWindowTokens(value) {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 8192 || numeric > 2000000) return null;
    return Math.round(numeric / 1024) * 1024;
  }

  function normalizeLegacyAutoCap(value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 ||
        value === 4096) return null;
    return normalizeTokenLimit(value, null);
  }

  function normalizeTaskRoutes(value, profiles) {
    const input = isPlainObject(value) ? value : {};
    const availableProfiles = isPlainObject(profiles) ? profiles : {};
    return Object.fromEntries(TASK_ROUTE_KEYS.map(taskId => {
      const route = isPlainObject(input[taskId]) ? input[taskId] : {};
      const profileId = String(route.profileId || '');
      const validProfileRoute = route.mode === 'profile' &&
        Object.prototype.hasOwnProperty.call(availableProfiles, profileId);
      return [taskId, validProfileRoute
        ? { mode: 'profile', profileId }
        : { mode: 'global', profileId: null }];
    }));
  }

  function normalizeTaskPolicy(taskId, value, profiles) {
    const definition = shared.getLlmTaskDefinition(taskId);
    const input = isPlainObject(value) ? value : {};
    const availableProfiles = isPlainObject(profiles) ? profiles : {};
    const profileId = String(input.profileId || '');
    const validProfileRoute = input.mode === 'profile' &&
      Object.prototype.hasOwnProperty.call(availableProfiles, profileId);
    const translationTask = definition.requirements?.translation === true;
    const translationMode = ['global', 'profile'].includes(input.mode)
      ? input.mode : 'local';
    const catalogReasoning = REASONING_EFFORTS.has(definition.defaultReasoning)
      ? definition.defaultReasoning : 'auto';
    const reasoningEffort = REASONING_EFFORTS.has(input.reasoningEffort) ||
      typeof input.reasoningEffort === 'string' && /^[a-z][a-z0-9_-]{0,63}$/.test(input.reasoningEffort) &&
      Object.entries(availableProfiles).some(([id, profile]) => shared.getProviderReasoningCapabilities?.(profile.providerId, {
        ...profile.config, ...(input.modelProfileId === id && input.model ? { model: input.model } : {})
      })?.levels.includes(input.reasoningEffort))
      ? input.reasoningEffort : catalogReasoning;
    const reasoningEnabled = typeof input.reasoningEnabled === 'boolean'
      ? input.reasoningEnabled
      : (typeof input.thinking === 'boolean' ? input.thinking : false);
    const tokenRule = typeof shared.normalizeTaskTokenRule === 'function'
      ? shared.normalizeTaskTokenRule(taskId, input.tokenRule)
      : definition.defaultTokenRule;
    const visionTask = definition.requirements?.vision === true;
    return {
      mode: translationTask ? translationMode : validProfileRoute ? 'profile' : 'global',
      profileId: translationTask
        ? (translationMode === 'profile' ? profileId : null)
        : (validProfileRoute ? profileId : null),
      reasoningEnabled,
      reasoningEffort,
      tokenRule,
      allowTextFallback: visionTask && input.allowTextFallback === true,
      // Optional overrides bind to a connection, so switching the global
      // provider never carries another provider's model ID into its request.
      ...(typeof input.model === 'string' && input.model.trim() &&
          input.model.trim().length <= 256 && !/[\u0000-\u001f\u007f]/u.test(input.model) &&
          Object.prototype.hasOwnProperty.call(availableProfiles, String(input.modelProfileId || ''))
        ? { model: input.model.trim(), modelProfileId: String(input.modelProfileId),
          modelProviderId: String(input.modelProviderId || availableProfiles[input.modelProfileId]?.providerId || ''),
          modelPresetId: String(input.modelPresetId ?? availableProfiles[input.modelProfileId]?.config?.presetId ?? '') } : {}),
      ...(['article_chat', 'selection_chat'].includes(taskId) && typeof input.webSearchEnabled === 'boolean'
        ? { webSearchEnabled: input.webSearchEnabled } : {})
    };
  }

  function semanticFindDefaultPolicy(profiles, profileOrder = []) {
    const availableProfiles = isPlainObject(profiles) ? profiles : {};
    const orderedIds = [
      ...(Array.isArray(profileOrder) ? profileOrder : []),
      ...Object.keys(availableProfiles)
    ];
    const seen = new Set();
    const profileId = orderedIds.find(id => {
      const normalizedId = String(id || '');
      if (!normalizedId || seen.has(normalizedId)) return false;
      seen.add(normalizedId);
      const profile = availableProfiles[normalizedId];
      if (profile?.providerId !== 'typesafe' || !isConfiguredProfile(profile)) return false;
      const endpoint = String(profile.config?.baseUrl || '').replace(/\/+$/u, '');
      return !endpoint || endpoint === 'https://api.typesafe.ai/v1' ||
        endpoint === 'https://api.typesafe.ai/v1/systemone';
    });
    return normalizeTaskPolicy('semantic_find', profileId ? {
      mode: 'profile', profileId
    } : {}, availableProfiles);
  }

  function createDefaultTaskPolicies(profiles = {}, profileOrder = []) {
    return Object.fromEntries(shared.LLM_TASK_IDS.map(taskId => [
      taskId,
      taskId === 'semantic_find'
        ? semanticFindDefaultPolicy(profiles, profileOrder)
        : normalizeTaskPolicy(taskId, {}, profiles)
    ]));
  }

  function normalizeTaskPolicies(value, profiles, profileOrder = []) {
    const input = isPlainObject(value) ? value : {};
    return Object.fromEntries(shared.LLM_TASK_IDS.map(taskId => [
      taskId,
      taskId === 'semantic_find' &&
        !Object.prototype.hasOwnProperty.call(input, taskId)
        ? semanticFindDefaultPolicy(profiles, profileOrder)
        : normalizeTaskPolicy(taskId, input[taskId], profiles)
    ]));
  }

  function migrateLegacyTaskRoutes(
    taskRoutes,
    profiles,
    globalProfileId,
    profileOrder = []
  ) {
    const input = isPlainObject(taskRoutes) ? taskRoutes : {};
    const availableProfiles = isPlainObject(profiles) ? profiles : {};
    const globalProfile = Object.prototype.hasOwnProperty.call(
      availableProfiles, globalProfileId
    ) ? availableProfiles[globalProfileId] : null;
    const routeKeyByTaskId = Object.fromEntries(
      Object.entries(LEGACY_TASK_ROUTE_GROUPS)
        .flatMap(([routeKey, taskIds]) => taskIds.map(taskId => [taskId, routeKey]))
    );
    return Object.fromEntries(shared.LLM_TASK_IDS.map(taskId => {
      if (taskId === 'semantic_find') {
        return [taskId, semanticFindDefaultPolicy(availableProfiles, profileOrder)];
      }
      const route = isPlainObject(input[routeKeyByTaskId[taskId]])
        ? input[routeKeyByTaskId[taskId]] : {};
      const selectedProfile = route.mode === 'profile' &&
        Object.prototype.hasOwnProperty.call(availableProfiles, route.profileId)
        ? availableProfiles[route.profileId] : globalProfile;
      const profileConfig = isPlainObject(selectedProfile?.config)
        ? selectedProfile.config : {};
      return [taskId, normalizeTaskPolicy(taskId, {
        ...route,
        reasoningEnabled: profileConfig.reasoningEnabled,
        thinking: profileConfig.thinking,
        reasoningEffort: profileConfig.reasoningEffort
      }, availableProfiles)];
    }));
  }

  function projectLegacyTaskRoutes(taskPolicies, profiles) {
    const normalized = normalizeTaskPolicies(taskPolicies, profiles);
    return Object.fromEntries(TASK_ROUTE_KEYS.map(routeKey => {
      const policy = normalized[LEGACY_ROUTE_REPRESENTATIVES[routeKey]];
      return [routeKey, {
        mode: policy.mode,
        profileId: policy.profileId
      }];
    }));
  }

  function legacyProfileId(providerId) {
    return `profile_legacy_${String(providerId || '').toLowerCase()
      .replace(/[^a-z0-9]/g, '_')}`;
  }

  function normalizeProfile(id, value) {
    if (!PROFILE_ID_PATTERN.test(String(id || '')) || !isPlainObject(value)) return null;
    const providerId = String(value.providerId || '');
    if (!PROVIDER_ID_SET.has(providerId)) return null;
    const normalized = cloneJsonLike(value);
    delete normalized.id;
    delete normalized.profileId;
    const config = isPlainObject(normalized.config) ? normalized.config : {};
    const name = String(value.name || PROVIDER_NAMES[providerId]).trim() ||
      PROVIDER_NAMES[providerId];
    const hasExplicitVision = isPlainObject(value.capabilities) &&
      value.capabilities.vision !== undefined;
    // Builds through 2.4.14 persisted local Codex as text-only. 2.4.15 adds
    // native App Server image input, so an old explicit false must migrate to
    // the now-guaranteed provider capability instead of permanently disabling
    // Figure pixels for upgraded profiles.
    const vision = providerId === 'codex-local'
      ? true
      : providerId === 'deepseek-harness' ? String(config.model || '').trim() === 'deepseek-flash'
      : (hasExplicitVision
        ? Boolean(value.capabilities.vision)
        : (providerId === 'openai-compatible'
          ? config.supportsVision === true
          : PROVIDER_VISION_DEFAULTS[providerId]));
    const capabilities = isPlainObject(normalized.capabilities)
      ? normalized.capabilities : {};
    capabilities.vision = vision;
    normalized.name = name;
    normalized.providerId = providerId;
    normalized.config = config;
    normalized.capabilities = capabilities;
    normalized.tokenPolicy = createTokenPolicy(value.tokenPolicy);
    normalized.contextWindowTokens = normalizeContextWindowTokens(
      value.contextWindowTokens
    );
    return normalized;
  }

  function createDefaultProfile() {
    const { maxOutputTokens, ...config } = LEGACY_PROVIDER_DEFAULTS.openai;
    return normalizeProfile('profile_default_openai', {
      name: 'OpenAI',
      providerId: 'openai',
      config,
      capabilities: { vision: true },
      contextWindowTokens: null,
      tokenPolicy: { mode: 'auto', autoCap: null }
    });
  }

  function createDefaultTaskRoutes() {
    return normalizeTaskRoutes({}, {});
  }

  function migrateLegacyProfiles(saved) {
    const savedProviders = isPlainObject(saved.providers) ? saved.providers : {};
    const profiles = {};
    const profileOrder = [];
    PROVIDER_IDS.filter(providerId =>
      !['codex-local', 'deepseek-harness', 'typesafe'].includes(providerId)
    ).forEach(providerId => {
      const legacyConfig = Object.assign(
        {},
        cloneJsonLike(LEGACY_PROVIDER_DEFAULTS[providerId]),
        isPlainObject(savedProviders[providerId])
          ? cloneJsonLike(savedProviders[providerId]) : {}
      );
      const maxOutputTokens = legacyConfig.maxOutputTokens;
      delete legacyConfig.maxOutputTokens;
      const autoCap = normalizeLegacyAutoCap(maxOutputTokens);
      const profileId = legacyProfileId(providerId);
      profiles[profileId] = normalizeProfile(profileId, {
        name: PROVIDER_NAMES[providerId],
        providerId,
        config: legacyConfig,
        capabilities: {
          vision: providerId === 'openai-compatible'
            ? legacyConfig.supportsVision === true
            : PROVIDER_VISION_DEFAULTS[providerId]
        },
        tokenPolicy: { mode: 'auto', autoCap }
      });
      profileOrder.push(profileId);
    });
    return { profiles, profileOrder };
  }

  function normalizeProfiles(value) {
    if (!isPlainObject(value)) return {};
    return Object.fromEntries(Object.entries(value)
      .map(([profileId, profile]) => [profileId, normalizeProfile(profileId, profile)])
      .filter(([, profile]) => profile));
  }

  function normalizeProfileOrder(value, profiles) {
    const seen = new Set();
    const ordered = [];
    (Array.isArray(value) ? value : []).forEach(profileId => {
      if (typeof profileId !== 'string' || seen.has(profileId) ||
          !Object.prototype.hasOwnProperty.call(profiles, profileId)) return;
      seen.add(profileId);
      ordered.push(profileId);
    });
    Object.keys(profiles).sort().forEach(profileId => {
      if (seen.has(profileId)) return;
      seen.add(profileId);
      ordered.push(profileId);
    });
    return ordered;
  }

  function isPreV4Settings(saved) {
    const version = Number(saved?.version);
    return !Number.isFinite(version) || version < 4;
  }

  function createDefaultSettings() {
    const profiles = { profile_default_openai: createDefaultProfile() };
    return {
      version: 6,
      mode: 'regex',
      language: 'zh-CN',
      consentGranted: false,
      autoAnalyze: false,
      literatureUrlWhitelist: [],
      tts: shared.normalizeTtsSettings(),
      autoCacheFigureImages: true,
      saveArticleWebSnapshot: true,
      confidenceThreshold: shared.DEFAULT_CONFIDENCE_THRESHOLD || 0.8,
      readingViewId: 'quick_story',
      analysisModes: normalizeAnalysisModes(),
      viewCategoryOverrides: createDefaultViewOverrides(),
      categoryOverrides: {},
      deletedBuiltInCategoryIds: [],
      studyTypeOverrides: {},
      selectedCategoryIds: [...CATEGORY_IDS],
      customCategories: [],
      profiles,
      globalProfileId: 'profile_default_openai',
      profileOrder: ['profile_default_openai'],
      taskPolicies: createDefaultTaskPolicies(profiles, ['profile_default_openai']),
      figurePanelHeaderFields: normalizeFigurePanelHeaderFields(),
      figurePanelFollowupPrompts: normalizeStoredPanelFollowupPrompts({}),
      figurePanelFollowupPresets: normalizePanelFollowupPresets(),
      articleChatPromptCatalogVersion: 5,
      articleChatQuickPrompts: normalizeArticleChatQuickPrompts(),
      displayQuickPrompts: normalizeArticleChatQuickPrompts(undefined, DEFAULT_DISPLAY_QUICK_PROMPTS),
      literatureNoteTemplates: shared.normalizeLiteratureNoteTemplates
        ? shared.normalizeLiteratureNoteTemplates() : [],
      lastLiteratureNoteTemplateId: 'basic_research',
      selectionLlmActions: shared.normalizeSelectionActions
        ? shared.normalizeSelectionActions() : [],
      keyboardShortcuts: normalizeStoredKeyboardShortcuts({})
    };
  }

  function mergeSettings(saved, options = {}) {
    if (isPlainObject(saved) && typeof saved.version === 'number' &&
        Number.isFinite(saved.version) && saved.version > 6) {
      return cloneJsonLike(saved);
    }
    const defaults = createDefaultSettings();
    if (!isPlainObject(saved)) {
      if (!isPlainObject(options) || !isPlainObject(options.legacyAllRules)) return defaults;
      saved = {};
    }
    const merged = Object.assign({}, defaults, saved);
    const savedVersion = Number(saved.version);
    merged.version = 6;
    merged.selectedCategoryIds = Array.isArray(saved.selectedCategoryIds) ?
      [...saved.selectedCategoryIds] : defaults.selectedCategoryIds;
    merged.customCategories = Array.isArray(saved.customCategories) ?
      saved.customCategories.filter(item => item && typeof item === 'object').map(item => ({ ...item })) : [];
    const hasLegacyProviderShape = !Number.isFinite(savedVersion)
      ? !isPlainObject(saved.profiles)
      : savedVersion < 5;
    if (hasLegacyProviderShape) {
      const migrated = migrateLegacyProfiles(saved);
      merged.profiles = migrated.profiles;
      merged.profileOrder = migrated.profileOrder;
      const selectedLegacyProfileId = legacyProfileId(saved.providerId);
      merged.globalProfileId = Object.prototype.hasOwnProperty.call(
        merged.profiles, selectedLegacyProfileId
      ) ? selectedLegacyProfileId : merged.profileOrder[0];
      merged.taskPolicies = createDefaultTaskPolicies(
        merged.profiles,
        merged.profileOrder
      );
    } else {
      const normalizedProfiles = normalizeProfiles(saved.profiles);
      const explicitlyEmptyProfiles = isPlainObject(saved.profiles) &&
        Object.keys(saved.profiles).length === 0;
      merged.profiles = explicitlyEmptyProfiles || Object.keys(normalizedProfiles).length
        ? normalizedProfiles
        : cloneJsonLike(defaults.profiles);
      merged.profileOrder = normalizeProfileOrder(saved.profileOrder, merged.profiles);
      merged.globalProfileId = Object.prototype.hasOwnProperty.call(
        merged.profiles, saved.globalProfileId
      ) ? saved.globalProfileId : (merged.profileOrder[0] || '');
      const hasExplicitTaskPolicies = isPlainObject(saved.taskPolicies);
      const useLegacyRouteCompatibility = savedVersion >= 6 &&
        !hasExplicitTaskPolicies && isPlainObject(saved.taskRoutes);
      merged.taskPolicies = savedVersion >= 6 && !useLegacyRouteCompatibility
        ? normalizeTaskPolicies(
          saved.taskPolicies,
          merged.profiles,
          merged.profileOrder
        )
        : migrateLegacyTaskRoutes(
          saved.taskRoutes,
          merged.profiles,
          merged.globalProfileId,
          merged.profileOrder
        );
    }
    delete merged.taskRoutes;
    delete merged.providerId;
    delete merged.providers;
    merged.confidenceThreshold = shared.normalizeConfidenceThreshold
      ? shared.normalizeConfidenceThreshold(saved.confidenceThreshold)
      : 0.8;
    merged.viewCategoryOverrides = normalizeViewOverrides(saved.viewCategoryOverrides);
    merged.analysisModes = normalizeAnalysisModes(
      saved.analysisModes,
      saved.analysisModes ? {} : merged.viewCategoryOverrides
    );
    const beforeScenarioMigration = merged.analysisModes;
    merged.analysisModes = migrateUntouchedScenarioPresets(saved, merged.analysisModes);
    if (merged.analysisModes !== beforeScenarioMigration) {
      merged.previousScenarioPresets = cloneJsonLike(saved.analysisModes);
    }
    merged.scenarioPresetVersion = 1;
    // Preserve a pre-scenario workspace's explicitly selected legacy view.
    if (!saved.analysisModes && saved.readingViewId === 'mechanism_chain' && shared.READING_VIEWS?.mechanism_chain) {
      merged.analysisModes.push({ id: 'mechanism_chain', ...cloneJsonLike(shared.READING_VIEWS.mechanism_chain) });
    }
    const availableModeIds = new Set(merged.analysisModes.map(mode => mode.id));
    merged.readingViewId = availableModeIds.has(String(saved.readingViewId || ''))
      ? String(saved.readingViewId) : (merged.analysisModes[0]?.id || 'quick_story');
    if (Number(saved.version) < 3 && Array.isArray(saved.selectedCategoryIds)) {
      merged.viewCategoryOverrides.quick_story = deriveViewOverride(
        'quick_story', saved.selectedCategoryIds
      );
    }
    const legacyAllRules = isPreV4Settings(saved) ? options.legacyAllRules : undefined;
    merged.categoryOverrides = normalizeCategoryOverrides(
      saved.categoryOverrides,
      legacyAllRules
    );
    merged.deletedBuiltInCategoryIds = normalizeDeletedBuiltInCategoryIds(
      saved.deletedBuiltInCategoryIds
    );
    merged.studyTypeOverrides = normalizeStudyTypeOverrides(saved.studyTypeOverrides);
    merged.autoCacheFigureImages = saved.autoCacheFigureImages !== false;
    merged.saveArticleWebSnapshot = saved.saveArticleWebSnapshot !== false;
    merged.language = String(saved.language || '').toLowerCase().startsWith('en')
      ? 'en' : 'zh-CN';
    merged.tts = shared.normalizeTtsSettings(saved.tts);
    merged.literatureUrlWhitelist = shared.normalizeLiteratureUrlWhitelist(saved.literatureUrlWhitelist);
    merged.figurePanelHeaderFields = normalizeFigurePanelHeaderFields(
      saved.figurePanelHeaderFields
    );
    merged.figurePanelFollowupPrompts = normalizeStoredPanelFollowupPrompts(
      saved.figurePanelFollowupPrompts
    );
    merged.figurePanelFollowupPresets = normalizePanelFollowupPresets(
      saved.figurePanelFollowupPresets,
      merged.figurePanelFollowupPrompts
    );
    if (isPlainObject(saved.figurePanelFollowupPrompts)) {
      merged.figurePanelFollowupPresets = merged.figurePanelFollowupPresets
        .map(preset => preset.topic
          ? { ...preset, prompt: merged.figurePanelFollowupPrompts[preset.topic] }
          : preset);
    }
    merged.figurePanelFollowupPresets.forEach(preset => {
      if (preset.topic) merged.figurePanelFollowupPrompts[preset.topic] = preset.prompt;
    });
    merged.articleChatQuickPrompts = normalizeArticleChatQuickPrompts(migrateArticleChatQuickPrompts(saved));
    merged.articleChatPromptCatalogVersion = 5;
    merged.displayQuickPrompts = normalizeArticleChatQuickPrompts(saved.displayQuickPrompts, DEFAULT_DISPLAY_QUICK_PROMPTS);
    merged.literatureNoteTemplates = shared.normalizeLiteratureNoteTemplates
      ? shared.normalizeLiteratureNoteTemplates(saved.literatureNoteTemplates)
      : defaults.literatureNoteTemplates;
    const availableNoteTemplateIds = new Set(
      merged.literatureNoteTemplates.map(template => template.id)
    );
    merged.lastLiteratureNoteTemplateId = availableNoteTemplateIds.has(
      String(saved.lastLiteratureNoteTemplateId || '')
    ) ? String(saved.lastLiteratureNoteTemplateId) :
      (merged.literatureNoteTemplates[0]?.id || '');
    merged.selectionLlmActions = shared.normalizeSelectionActions
      ? shared.normalizeSelectionActions(saved.selectionLlmActions)
      : defaults.selectionLlmActions;
    merged.keyboardShortcuts = normalizeStoredKeyboardShortcuts(
      saved.keyboardShortcuts
    );
    return merged;
  }

  function createV5BackupPayload(saved, options = {}) {
    if (!isPlainObject(saved)) return null;
    const savedVersion = Number(saved.version);
    if (Number.isFinite(savedVersion) && savedVersion > 5) return null;
    const normalized = mergeSettings(saved, options);
    if (normalized.version !== 6) return null;
    const backup = cloneJsonLike(normalized);
    backup.version = 5;
    backup.taskRoutes = savedVersion >= 5
      ? normalizeTaskRoutes(saved.taskRoutes, backup.profiles)
      : createDefaultTaskRoutes();
    delete backup.taskPolicies;
    return backup;
  }

  function callStorage(storageArea, method, value) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = result => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      try {
        const maybePromise = storageArea[method](value, done);
        if (maybePromise && typeof maybePromise.then === 'function') {
          maybePromise.then(done, reject);
        }
      } catch (error) {
        reject(error);
      }
    });
  }

  async function loadSettings(storageArea) {
    let result = await callStorage(storageArea, 'get', [STORAGE_KEY, 'allRules']);
    const hasSettings = Object.prototype.hasOwnProperty.call(result || {}, STORAGE_KEY);
    const hasLegacyRules = Object.prototype.hasOwnProperty.call(result || {}, 'allRules');
    if (!hasSettings && !hasLegacyRules) {
      const [settingsResult, rulesResult] = await Promise.all([
        callStorage(storageArea, 'get', STORAGE_KEY),
        callStorage(storageArea, 'get', 'allRules')
      ]);
      result = Object.assign({}, settingsResult, rulesResult);
    }
    const saved = result?.[STORAGE_KEY];
    return mergeSettings(saved, {
      legacyAllRules: isPreV4Settings(saved) ? result?.allRules : undefined
    });
  }

  async function saveSettings(storageArea, settings) {
    const normalized = mergeSettings(settings);
    const payload = { [STORAGE_KEY]: normalized };
    if (normalized.version === 6 && typeof storageArea?.get === 'function') {
      let previous = await callStorage(
        storageArea, 'get', [STORAGE_KEY, V5_SETTINGS_BACKUP_KEY]
      );
      const hasRecognizedKey = [STORAGE_KEY, V5_SETTINGS_BACKUP_KEY].some(key =>
        Object.prototype.hasOwnProperty.call(previous || {}, key)
      );
      if (!hasRecognizedKey) {
        const [settingsResult, backupResult] = await Promise.all([
          callStorage(storageArea, 'get', STORAGE_KEY),
          callStorage(storageArea, 'get', V5_SETTINGS_BACKUP_KEY)
        ]);
        previous = Object.assign({}, settingsResult, backupResult);
      }
      if (previous?.[V5_SETTINGS_BACKUP_KEY] === undefined) {
        const backup = createV5BackupPayload(previous?.[STORAGE_KEY] ?? settings);
        if (backup) payload[V5_SETTINGS_BACKUP_KEY] = backup;
      }
    }
    await callStorage(storageArea, 'set', payload);
    return mergeSettings(normalized);
  }

  async function loadSessionCategories(storageArea) {
    if (!storageArea) return [];
    const result = await callStorage(storageArea, 'get', SESSION_CATEGORY_KEY);
    const categories = result?.[SESSION_CATEGORY_KEY];
    return Array.isArray(categories)
      ? categories.filter(item => item && typeof item === 'object').map(item => ({ ...item }))
      : [];
  }

  async function saveSessionCategories(storageArea, categories) {
    if (!storageArea) return [];
    const normalized = Array.isArray(categories)
      ? categories.filter(item => item && typeof item === 'object').map(item => ({ ...item }))
      : [];
    await callStorage(storageArea, 'set', { [SESSION_CATEGORY_KEY]: normalized });
    return normalized;
  }

  function isSensitivePublicConfigKey(key) {
    const normalizedKey = String(key).toLowerCase().replace(/[^a-z0-9]/g, '');
    return normalizedKey === 'apikey' || normalizedKey === 'customheaders';
  }

  function sanitizePublicConfigValue(value, depth = 0) {
    if (depth > PUBLIC_CONFIG_MAX_DEPTH) return null;
    if (Array.isArray(value)) {
      return value.map(item => sanitizePublicConfigValue(item, depth + 1));
    }
    if (!isPlainObject(value)) {
      return value === null || ['string', 'number', 'boolean'].includes(typeof value)
        ? value : null;
    }
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !isSensitivePublicConfigKey(key))
      .map(([key, item]) => [key, sanitizePublicConfigValue(item, depth + 1)]));
  }

  function isNonBlankString(value) {
    return typeof value === 'string' && value.trim().length > 0;
  }

  function toPublicSettings(settings) {
    const normalized = mergeSettings(settings);
    const publicSettings = sanitizePublicConfigValue(normalized);
    if (normalized.version === 6) publicSettings.tts = shared.toPublicTtsSettings(normalized.tts);
    if (normalized.version === 6 && isPlainObject(normalized.taskPolicies)) {
      publicSettings.taskRoutes = projectLegacyTaskRoutes(
        normalized.taskPolicies,
        normalized.profiles
      );
    }
    if (!isPlainObject(normalized.profiles) || !isPlainObject(publicSettings.profiles)) {
      return publicSettings;
    }
    Object.entries(normalized.profiles).forEach(([profileId, profile]) => {
      if (!isPlainObject(profile) || !isPlainObject(profile.config)) return;
      const publicProfile = publicSettings.profiles[profileId];
      if (!isPlainObject(publicProfile)) return;
      const config = profile.config;
      const { apiKey, customHeaders } = config;
      const safeConfig = isPlainObject(publicProfile.config) ? publicProfile.config : {};
      const normalizedApiKey = isNonBlankString(apiKey) ? apiKey.trim() : '';
      safeConfig.hasApiKey = Boolean(normalizedApiKey);
      safeConfig.apiKeyMask = normalizedApiKey ? `••••${normalizedApiKey.slice(-4)}` : '';
      safeConfig.customHeaderNames = isPlainObject(customHeaders)
        ? Object.keys(customHeaders) : [];
      publicProfile.config = safeConfig;
    });
    return publicSettings;
  }

  function isConfiguredProfile(profile) {
    if (!isPlainObject(profile) || !PROVIDER_ID_SET.has(profile.providerId) ||
        !isPlainObject(profile.config)) return false;
    const configured = ['codex-local', 'deepseek-harness'].includes(profile.providerId)
      ? isNonBlankString(profile.config.model)
      : isNonBlankString(profile.config.apiKey) &&
        isNonBlankString(profile.config.model);
    return configured && (profile.providerId !== 'openai-compatible' ||
      isNonBlankString(profile.config.baseUrl));
  }

  function isLlmReady(settings) {
    const normalized = mergeSettings(settings);
    const configured = isPlainObject(normalized.profiles) &&
      Object.values(normalized.profiles).some(isConfiguredProfile);
    return normalized.consentGranted === true && configured;
  }

  function getEffectiveMode(settings) {
    const normalized = mergeSettings(settings);
    return normalized.mode === 'llm' && isLlmReady(normalized)
      ? 'llm' : 'regex';
  }

  return {
    TASK_ROUTE_KEYS,
    V5_SETTINGS_BACKUP_KEY,
    PROFILE_ID_PATTERN,
    DEFAULT_FIGURE_PANEL_HEADER_FIELDS,
    normalizeFigurePanelHeaderFields,
    DEFAULT_ARTICLE_CHAT_QUICK_PROMPTS,
    DEFAULT_DISPLAY_QUICK_PROMPTS,
    normalizeArticleChatQuickPrompts,
    DEFAULT_PANEL_FOLLOWUP_PRESETS,
    normalizePanelFollowupPresets,
    createDefaultSettings,
    createDefaultViewOverrides,
    createDefaultAnalysisModes,
    normalizeAnalysisModes,
    createTokenPolicy,
    normalizeContextWindowTokens,
    normalizeTaskRoutes,
    normalizeTaskPolicy,
    normalizeTaskPolicies,
    migrateLegacyTaskRoutes,
    createV5BackupPayload,
    normalizeProfile,
    legacyProfileId,
    deriveViewOverride,
    mergeSettings,
    loadSettings,
    saveSettings,
    loadSessionCategories,
    saveSessionCategories,
    toPublicSettings,
    isConfiguredProfile,
    isLlmReady,
    getEffectiveMode
  };
});
