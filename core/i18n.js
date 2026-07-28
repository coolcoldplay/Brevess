(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const EN = Object.freeze({
    '类别规则': 'Categories',
    '分析模式': 'Analysis modes',
    '模型与分析': 'Models & analysis',
    '快捷键': 'Shortcuts',
    '本地数据': 'Local data',
    '关于与反馈': 'About & feedback',
    '新手引导': 'Setup guide',
    '当前：正则模式': 'Current: Regex mode',
    '当前：LLM 模式': 'Current: LLM mode',
    '全部类别': 'All categories',
    '识别目录': 'Category catalog',
    '类别名称': 'Category name',
    '类别颜色': 'Category color',
    '启用识别引擎': 'Recognition engines',
    'AI 提示词': 'AI prompt',
    '正则规则': 'Regex rules',
    '正则表达式': 'Regular expressions',
    '识别定义': 'Definition',
    '判定问题': 'Decision question',
    '应当包含（每行一条）': 'Include (one per line)',
    '应当排除（每行一条）': 'Exclude (one per line)',
    '正例（每行一条）': 'Positive examples (one per line)',
    '反例（每行一条）': 'Negative examples (one per line)',
    '必需信息槽（每行一条）': 'Required slots (one per line)',
    '允许的引用角色（每行一条）': 'Allowed quote roles (one per line)',
    '高亮片段范围': 'Highlight span',
    '最低置信度': 'Minimum confidence',
    '发送给 AI 的提示词预览': 'Prompt preview sent to AI',
    '固定短语（每行一条）': 'Fixed phrases (one per line)',
    '区分大小写': 'Case-sensitive',
    '仅匹配完整词': 'Whole words only',
    '安全试跑': 'Safe test',
    '测试当前规则': 'Test current rules',
    '测试文本': 'Test text',
    '恢复内置规则': 'Restore built-in rules',
    '保存类别规则': 'Save category rules',
    '永久删除': 'Delete permanently',
    '导出本类别': 'Export category',
    '导入到本类别': 'Import into category',
    '自定义每一种论文分析模式': 'Customize every paper analysis mode',
    '新增模式': 'Add mode',
    '恢复内置模式': 'Restore built-in modes',
    '模式名称': 'Mode name',
    '模式 ID': 'Mode ID',
    '说明': 'Description',
    '参与分析的类别规则': 'Categories included in analysis',
    '删除当前模式': 'Delete current mode',
    '保存分析模式': 'Save analysis modes',
    '模型服务与分析方式': 'Model services and analysis',
    '新增 Profile': 'Add profile',
    '复制': 'Duplicate',
    '删除': 'Delete',
    'Profile 名称': 'Profile name',
    '服务商': 'Provider',
    '模型名称': 'Model',
    '获取当前模型': 'Fetch current models',
    'API Key': 'API key',
    '测试连接': 'Test connection',
    '全局默认与任务路由': 'Global defaults and task routing',
    '全局默认 Profile': 'Global default profile',
    '文段高亮（高亮匹配）': 'Text highlight (highlight matching)',
    '段落概述': 'Paragraph overview',
    '逐图解读': 'Figure-by-figure interpretation',
    '跨图串解': 'Cross-figure synthesis',
    '全文问答快捷提示词': 'Full-text chat quick prompts',
    '新增提示词': 'Add prompt',
    '恢复默认': 'Restore defaults',
    'Panel 追问提示词': 'Panel follow-up prompts',
    '新增追问': 'Add follow-up',
    '名称': 'Name',
    '提示词': 'Prompt',
    'Figure 高清原图': 'High-resolution figures',
    '正文发送许可': 'Permission to send article text',
    '保存模型设置': 'Save model settings',
    '快捷键自定义': 'Customize shortcuts',
    '保存快捷键': 'Save shortcuts',
    '选择本地保存目录': 'Choose local storage folder',
    '重新授权目录': 'Reauthorize folder',
    '立即同步': 'Sync now',
    '导出 JSON 备份': 'Export JSON backup',
    '完整迁移': 'Complete migration',
    '导出完整迁移文件': 'Export migration file',
    '导入完整迁移文件': 'Import migration file',
    '反馈语料': 'Feedback corpus',
    '生成离线规则': 'Generate offline rules',
    '开源许可': 'Open-source license',
    '问题反馈': 'Feedback',
    '识别引擎': 'Recognition engine',
    '正则模式': 'Regex mode',
    'LLM 精确模式': 'LLM precision mode',
    '应用高亮': 'Apply highlights',
    '正在分析全文': 'Analyzing full text',
    '分析全文': 'Analyze full text',
    '重新分析全文': 'Reanalyze full text',
    '逻辑关系类别': 'Logic categories',
    '恢复预设': 'Restore preset',
    '更多分类': 'More categories',
    '本文标注': 'Article annotations',
    '清除自动高亮': 'Clear automatic highlights',
    '清除手动标注': 'Clear manual annotations',
    '论文导航': 'Paper navigator',
    '刷新': 'Refresh',
    '生成逐段摘要': 'Summarize paragraphs',
    '导航': 'Navigate',
    '亮文': 'Highlight',
    '摘句': 'Excerpts',
    '解图': 'Figures',
    '问答': 'Chat',
    '文献全文问答': 'Full-text paper chat',
    '本轮模型': 'Model for this turn',
    '匹配类别': 'Match category',
    '查找并高亮': 'Find & highlight',
    '取消回答': 'Cancel response',
    '发送': 'Send',
    '清空': 'Clear',
    '回到最新': 'Jump to latest',
    '加载更早对话': 'Load earlier chat',
    '追问此 Panel': 'Ask about this Panel',
    '自定义问题（可单独提交）': 'Custom question (can be submitted alone)',
    '提交追问': 'Submit follow-up',
    '历史追问': 'Follow-up history',
    '逐图解读': 'Analyze figures',
    '生成逐段摘要': 'Summarize paragraphs',
    '打开识别规则与模型设置': 'Open category and model settings',
    '设置界面语言': 'Interface language',
    '中文': 'Chinese',
    'English': 'English'
  });

  const textSources = new WeakMap();
  const translatedText = new WeakMap();
  const attributeSources = new WeakMap();
  let language = 'zh-CN';
  let observer = null;
  let applying = false;

  function normalizeLanguage(value) {
    return String(value || '').toLowerCase().startsWith('en') ? 'en' : 'zh-CN';
  }

  function translateString(value, targetLanguage = language) {
    if (targetLanguage !== 'en') return String(value || '');
    const input = String(value || '');
    const trimmed = input.trim();
    const translated = EN[trimmed];
    if (!translated) return input;
    const start = input.slice(0, input.indexOf(trimmed));
    const end = input.slice(input.indexOf(trimmed) + trimmed.length);
    return `${start}${translated}${end}`;
  }

  function applyTextNode(node) {
    const current = node.nodeValue || '';
    const last = translatedText.get(node);
    if (!textSources.has(node) || (last !== undefined && current !== last)) {
      textSources.set(node, current);
    }
    const source = textSources.get(node) || '';
    const next = language === 'en' ? translateString(source, 'en') : source;
    translatedText.set(node, next);
    if (current !== next) node.nodeValue = next;
  }

  function applyAttributes(element) {
    const names = ['placeholder', 'title', 'aria-label'];
    let sources = attributeSources.get(element);
    if (!sources) {
      sources = {};
      attributeSources.set(element, sources);
    }
    names.forEach(name => {
      if (!element.hasAttribute?.(name)) return;
      const current = element.getAttribute(name) || '';
      const marker = `${name}Translated`;
      if (!(name in sources) || (sources[marker] !== undefined &&
          current !== sources[marker])) {
        sources[name] = current;
      }
      const next = language === 'en'
        ? translateString(sources[name], 'en') : sources[name];
      sources[marker] = next;
      if (current !== next) element.setAttribute(name, next);
    });
  }

  function applyTree(rootNode = document) {
    if (!rootNode || applying) return;
    applying = true;
    try {
      const walker = document.createTreeWalker(
        rootNode,
        NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT
      );
      let node = rootNode;
      while (node) {
        if (node.nodeType === Node.TEXT_NODE) applyTextNode(node);
        else if (node.nodeType === Node.ELEMENT_NODE) applyAttributes(node);
        node = walker.nextNode();
      }
      document.documentElement.lang = language;
    } finally {
      applying = false;
    }
  }

  function observeInterface(rootNode = document.body) {
    observer?.disconnect();
    if (!rootNode || typeof MutationObserver !== 'function') return;
    observer = new MutationObserver(records => {
      if (applying) return;
      records.forEach(record => {
        if (record.type === 'characterData') applyTextNode(record.target);
        record.addedNodes?.forEach(node => applyTree(node));
        if (record.type === 'attributes') applyAttributes(record.target);
      });
    });
    observer.observe(rootNode, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['placeholder', 'title', 'aria-label']
    });
  }

  function setInterfaceLanguage(value, rootNode = document) {
    language = normalizeLanguage(value);
    applyTree(rootNode);
    observeInterface(document.body);
    return language;
  }

  return {
    INTERFACE_TRANSLATIONS_EN: EN,
    normalizeInterfaceLanguage: normalizeLanguage,
    translateInterfaceText: translateString,
    setInterfaceLanguage
  };
});
