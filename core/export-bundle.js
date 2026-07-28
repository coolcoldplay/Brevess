(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const encoder = new TextEncoder();
  const SENSITIVE_KEY = /^(?:api[-_]?key|authorization|token|secret|password|dataurl)$/i;

  function sanitizeExportFilename(value, fallback = 'export') {
    const normalized = String(value || '').normalize('NFKC')
      .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, '-')
      .replace(/\s+/g, ' ')
      .replace(/[.\s-]+$/g, '')
      .trim()
      .slice(0, 120);
    return normalized || fallback;
  }

  function sanitizeZipPath(value) {
    const segments = String(value || '').replace(/\\/g, '/').split('/')
      .map(segment => sanitizeExportFilename(segment, 'file'))
      .filter(segment => segment && segment !== '.' && segment !== '..');
    if (!segments.length) throw new Error('INVALID_ZIP_PATH');
    return segments.join('/');
  }

  function cloneExportValue(value, depth = 0) {
    if (depth > 30) return '[depth limit]';
    if (Array.isArray(value)) return value.map(item => cloneExportValue(item, depth + 1));
    if (!value || typeof value !== 'object') {
      if (typeof value === 'string' && /^data:[^,]+(?:;base64)?,/i.test(value)) {
        return '[embedded data omitted]';
      }
      if (typeof value === 'string' && value.length > 200000) {
        return `${value.slice(0, 200000)}\n[truncated]`;
      }
      return value;
    }
    const output = {};
    Object.entries(value).forEach(([key, nested]) => {
      if (SENSITIVE_KEY.test(key)) return;
      output[key] = cloneExportValue(nested, depth + 1);
    });
    return output;
  }

  function exportJson(value) {
    return `${JSON.stringify(cloneExportValue(value), null, 2)}\n`;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit += 1) {
        crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
      }
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function dosTimestamp(value = new Date()) {
    const date = value instanceof Date && Number.isFinite(value.getTime())
      ? value : new Date();
    const year = Math.max(1980, date.getFullYear());
    return {
      time: ((date.getHours() & 31) << 11) |
        ((date.getMinutes() & 63) << 5) |
        (Math.floor(date.getSeconds() / 2) & 31),
      date: (((year - 1980) & 127) << 9) |
        (((date.getMonth() + 1) & 15) << 5) |
        (date.getDate() & 31)
    };
  }

  async function entryBytes(value) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (typeof Blob !== 'undefined' && value instanceof Blob) {
      return new Uint8Array(await value.arrayBuffer());
    }
    return encoder.encode(String(value ?? ''));
  }

  function localHeader(nameBytes, bytes, crc, timestamp) {
    const header = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x0800, true);
    view.setUint16(8, 0, true);
    view.setUint16(10, timestamp.time, true);
    view.setUint16(12, timestamp.date, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, bytes.length, true);
    view.setUint32(22, bytes.length, true);
    view.setUint16(26, nameBytes.length, true);
    view.setUint16(28, 0, true);
    header.set(nameBytes, 30);
    return header;
  }

  function centralHeader(nameBytes, bytes, crc, timestamp, offset) {
    const header = new Uint8Array(46 + nameBytes.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 20, true);
    view.setUint16(8, 0x0800, true);
    view.setUint16(10, 0, true);
    view.setUint16(12, timestamp.time, true);
    view.setUint16(14, timestamp.date, true);
    view.setUint32(16, crc, true);
    view.setUint32(20, bytes.length, true);
    view.setUint32(24, bytes.length, true);
    view.setUint16(28, nameBytes.length, true);
    view.setUint16(30, 0, true);
    view.setUint16(32, 0, true);
    view.setUint16(34, 0, true);
    view.setUint16(36, 0, true);
    view.setUint32(38, 0, true);
    view.setUint32(42, offset, true);
    header.set(nameBytes, 46);
    return header;
  }

  function endOfCentralDirectory(entryCount, centralSize, centralOffset) {
    const record = new Uint8Array(22);
    const view = new DataView(record.buffer);
    view.setUint32(0, 0x06054b50, true);
    view.setUint16(4, 0, true);
    view.setUint16(6, 0, true);
    view.setUint16(8, entryCount, true);
    view.setUint16(10, entryCount, true);
    view.setUint32(12, centralSize, true);
    view.setUint32(16, centralOffset, true);
    view.setUint16(20, 0, true);
    return record;
  }

  async function createZipBlob(entries, options = {}) {
    const values = Array.isArray(entries) ? entries : [];
    if (!values.length || values.length > 65535) throw new Error('INVALID_ZIP_ENTRY_COUNT');
    const seen = new Set();
    const prepared = [];
    let localOffset = 0;
    const timestamp = dosTimestamp(options.modifiedAt);
    for (const entry of values) {
      const path = sanitizeZipPath(entry?.path);
      if (seen.has(path)) throw new Error(`DUPLICATE_ZIP_PATH:${path}`);
      seen.add(path);
      const bytes = await entryBytes(entry?.data);
      if (bytes.length > 0xffffffff) throw new Error(`ZIP_ENTRY_TOO_LARGE:${path}`);
      const nameBytes = encoder.encode(path);
      const checksum = crc32(bytes);
      const local = localHeader(nameBytes, bytes, checksum, timestamp);
      const central = centralHeader(nameBytes, bytes, checksum, timestamp, localOffset);
      prepared.push({ local, bytes, central });
      localOffset += local.length + bytes.length;
      if (localOffset > 0xffffffff) throw new Error('ZIP_TOO_LARGE');
    }
    const centralSize = prepared.reduce((sum, item) => sum + item.central.length, 0);
    const parts = [];
    prepared.forEach(item => parts.push(item.local, item.bytes));
    prepared.forEach(item => parts.push(item.central));
    parts.push(endOfCentralDirectory(prepared.length, centralSize, localOffset));
    return new Blob(parts, { type: 'application/zip' });
  }

  function buildFigureMarkdown(figure = {}) {
    const title = String(figure.figureLabel || figure.figureId || 'Figure');
    const panels = Array.isArray(figure.panelHints) ? figure.panelHints.join(', ') : '';
    return [
      `# ${title}`,
      '',
      `- Figure ID: ${figure.figureId || ''}`,
      `- Panels: ${panels || '未标注'}`,
      `- 图像文件: ${(figure.imageFiles || []).join(', ') || '未能打包；参见 sourceUrls'}`,
      '',
      '## 图注',
      '',
      String(figure.caption || '无'),
      '',
      '## 本图全部解读数据',
      '',
      '```json',
      JSON.stringify(cloneExportValue({
        standard: figure.standard || null,
        deep: figure.deep || null,
        panelAnalyses: figure.panelAnalyses || {},
        panelFollowups: figure.panelFollowups || {},
        panelFollowupHistories: figure.panelFollowupHistories || {},
        contextParagraphs: figure.contextParagraphs || []
      }), null, 2),
      '```',
      ''
    ].join('\n');
  }

  function buildPptAgentPrompt(bundle = {}) {
    const figures = Array.isArray(bundle.figures) ? bundle.figures : [];
    return [
      '# 正式 Journal Club PPT 制作任务（给 Codex 或其他 AI）',
      '',
      `论文题目：${bundle.title || '未提供'}`,
      `论文链接：${bundle.url || '未提供'}`,
      '',
      '你收到的是 Brevess 导出的可复核材料包。目标不是把论文内容堆进幻灯片，' +
      '而是制作一份可以直接用于正式 Journal Club 的、以原论文 Panel 为主要视觉证据的可编辑 PowerPoint。',
      '',
      '默认使用中文汇报，按 25–35 分钟设计；页数由证据密度决定，通常为 24–34 页。' +
      '如果用户另行给出时长、语言、模板或页数，以用户要求为准。',
      '',
      '## 开始前必须读取',
      '',
      '1. `manifest.json`：核对论文信息、Figure 清单和缺失图片。',
      '2. `analysis/article-context.json`：提取研究背景、知识缺口、研究设计与作者在正文中的表述。',
      '3. `analysis/cross-figure-logic.json` 和 `.md`：确定整篇论文的证据递进与 Figure 间承接。',
      '4. 全部 `analysis/figures/*.json` 和 `.md`：理解每张 Figure、Panel、对照、读出和结论边界。',
      '5. `figures/` 下的全部原始高清图：以视觉核验和原始图注为最终依据。',
      '',
      '材料包中的 AI 解图只能作为导航和解释候选，不能替代对原图、图注和正文的核对。' +
      '如果包内分析与原图或正文冲突，以论文原始证据为准，并在自检报告中记录。',
      '',
      '## 零、先判定执行 Agent 是否具有图像理解能力',
      '',
      '这里的“具有图像理解能力”不是指能读取文件名、OCR 文本或图片尺寸，而是指 Agent 能实际打开并观察原始 Figure，' +
      '辨认 Panel 标签、边界、坐标轴、图例、比例尺、分组和相邻区域。开始制作前必须明确选择以下一种工作模式：',
      '',
      '### A. 具有图像理解能力：直接完成可汇报的完整 PPT',
      '',
      '- 逐张打开 `figures/` 中的高清原图，结合图注和正文核对真实 Panel 边界；按本 Prompt 的裁切、版式和验收规则，' +
      '直接生成包含真实 Panel 的完整 PPT。不得仅依赖 `panelHints`、OCR 或包内 AI 解图来猜测裁切范围。',
      '- 每个裁切图必须与原 Figure 并排复核：本 Panel 字母完整且只出现一次；不得残留相邻 Panel 的字母、图像、坐标轴、' +
      '图例碎片、色条、虚线框或半截文字；也不得因裁得过紧而切掉本 Panel 的标签、比例尺、图例、坐标标题或分组名称。',
      '- 如果原图布局复杂，先制作带坐标网格的原图预览或边界草图，再确定裁切框。不要在裁切图已经包含 Panel 字母时，' +
      '又在 PPT 上叠加第二个相同字母。',
      '',
      '### B. 没有图像理解能力：生成 Panel 占位版 PPT，严禁猜图或假装核验过',
      '',
      '- 可以利用正文、图注、`analysis/` 和 `panelHints` 完成故事线、页标题、讲稿、结论边界与版式，但不得自行裁切、' +
      '解释像素内容、重画数据或声称已经检查原图。',
      '- 所有需要放置论文 Panel 的位置使用清晰的浅灰或细蓝线方框。方框中央用大字标注 `Fig. 2A`、`Fig. 3B–D` 等准确标识，' +
      '下方写“请从原始 Figure 截图替换”，并注明必须保留的坐标轴、图例、比例尺、分组或时间点，指导用户自行粘贴。',
      '- 占位框应按最终版式预留 65%–85% 的页面面积，一页 1–4 个框；不得用虚构曲线、示意柱状图、AI 图片或空白装饰替代实验数据。',
      '- 输出文件名应明确带 `_PANEL_PLACEHOLDERS.pptx`，并在自检报告中逐页列出待替换的 Figure/Panel。' +
      '待用户或有视觉能力的 Agent 补图后，才能把它称为完整证据版 PPT。',
      '',
      '即使 Agent 具有图像理解能力，只要某张原图缺失、损坏或分辨率不足，也必须对该 Panel 使用上述占位框，' +
      '不得从图注或分析文字反向生成实验图片。',
      '',
      '## 一、成品必须采用的 Journal Club 结构',
      '',
      '1. **封面**：论文原题、期刊、发表年份、汇报人和日期。不要添加与论文无关的装饰图。',
      '2. **作者与研究团队**：清楚列出共同第一作者、共同通讯作者、主要单位、研究方向与作者贡献。' +
      '头像只允许使用可核实的期刊或机构官方照片；找不到时使用纯文字版，严禁生成或猜测人物信息。',
      '3. **研究背景**：用 2–4 页完成“领域问题 → 已知机制/关键前人工作 → 尚未解决的缺口”。' +
      '只保留理解本文所必需的背景，并在页脚给出简短来源。',
      '4. **科学问题**：用一页明确写出 2–4 个可检验的问题。每个问题必须能映射到后续一组实验，' +
      '不能写成宽泛主题或把论文结论提前当作问题。',
      '5. **实验策略总览（按需）**：仅当多模型、多示踪或多级环路会妨碍理解时增加一页，' +
      '用简洁流程说明模型、操控、读出和因果验证层级。',
      '6. **结果主体**：占全篇约 60%–70%。以 Panel 证据页为主体，按正文大纲中的科学问题和主 Figure 证据链推进。' +
      '同一张 Figure 可以因可读性拆成多页，但页眉仍统一标为 `FIGURE 1`、`FIGURE 2`……；' +
      '不要把拆开的每一页重新编号为 `RESULT 01`、`RESULT 02`，也不要凭页数制造十几个“结果”。',
      '7. **局限性与讨论**：至少一页，区分证据支持的结论、尚未排除的替代解释、模型/样本的外推边界和待验证问题。',
      '8. **总结**：用三条 take-home messages 回答“建立了什么、机制上推进了什么、边界或意义是什么”。' +
      '总结必须与展示过的证据强度一致。',
      '9. **结束页**：简洁的致谢或 Q&A，不重复整页结论。',
      '',
      '## 二、结果页的 Panel-first 硬性规则',
      '',
      '1. 每页只承担一个科学问题或一个证据推进步骤；标题优先写成该页回答的问题或有边界的结果句，' +
      '不要只写“Figure 3”或“实验结果”。',
      '2. 原论文 Panel 必须是结果页的视觉主体，通常占页面 65%–85%。' +
      '一页放 1–4 个逻辑上不可分割的 Panel；放不下就拆页，但不能拆散必要的对照与比较组。',
      '3. 对复合 Figure，必须依据原图中真实的 Panel 标签和边界裁切 A、B、C……；' +
      '`panelHints` 只可作为索引，不能替代视觉核验。不得臆造、重绘、拼接或改变实验数据。',
      '4. 裁切必须保留坐标轴、图例、比例尺、统计符号、分组名称、时间点和必要的相邻说明。' +
      '不能可靠分割时保留整图，并用细框或半透明色块标出目标 Panel。',
      '5. 裁切验收必须同时检查两类错误：一类是相邻 Panel 残留，包括别的字母、图像边缘、色条、坐标或半截文字；' +
      '另一类是本 Panel 裁切不全，包括字母残缺、轴标题被截、图例缺项或比例尺消失。任何一类都必须返工。',
      '6. 不强制为每个 Figure 制作总览页。只有当一张 Figure 的实验框架无法通过单个证据页解释清楚时，' +
      '才增加简短总览；总览不能取代 Panel 证据页。',
      '7. 页面文字只保留 1–2 句关键总结或极短标签，用于指出实验比较和结论。' +
      '实验目的、完整设计、逐图解读和证据边界放入演讲备注，不要在结果页堆成长段文字。',
      '8. 对照、阴性结果、救援实验和充分性/必要性证据必须被保留；' +
      '不能只选择支持主结论的 Panel，也不能把相关性证据写成因果结论。',
      '9. Figure 之间若存在关键承接，可以插入极简“承上启下”页：只写已经建立的结论、' +
      '仍缺少的证据和下一步问题。引用 `analysis/cross-figure-logic.md`，不要添加装饰性流程图。',
      '',
      '## 三、视觉与版式：清楚、克制、无干扰',
      '',
      '1. 使用 16:9、白色背景、黑色正文和单一蓝色强调色；顶部可用一条细蓝线，页码置于角落。' +
      '保持整套标题位置、字体、边距和页码一致。',
      '2. 建议标题 32–40 pt、正文 20–28 pt；Panel 内原始标注必须在投影状态下可读。' +
      '不要为了塞入更多内容把文字或 Figure 缩得过小。',
      '3. 禁止添加无信息价值的图标、卡片、渐变、彩色背景、装饰圆形、AI 生成插画或与实验无关的照片。' +
      '不要给每个 Panel 加粗重边框；只在需要引导视线时使用细框、箭头或轻度高亮。',
      '4. 背景页可以使用少量经核实的机制示意图或文献图；结果页只能使用本论文真实 Figure/Panel，' +
      '不得用 AI 图像替代实验数据。',
      '5. 保留充足留白和清楚的阅读顺序。视觉层级应始终是：页标题 → Panel 证据 → 一句结论 → 来源。',
      '',
      '## 四、每一页都要有可直接讲述的演讲备注',
      '',
      '备注必须写成自然、连贯、可直接朗读的学术汇报口语，不是要点列表，也不是对页面文字的机械复述。' +
      '标题页和结束页也要有简短开场或收束语。整体口吻应像研究者在组会上带着听众读一篇论文：' +
      '有承接、有停顿、有取舍，不要每页都用同一种模板句开头，也不要逐字朗读图注。',
      '',
      '结果页备注按以下逻辑写成完整段落：',
      '',
      '1. 用一句话承接上一页，并指出这一页要解决的具体问题。',
      '2. 说明实验目的与设计：模型/样本、操控、对照、时间点、读出指标，以及为什么这个设计能回答问题。',
      '3. 按页面从左到右、从上到下逐 Panel 解读：先说明看什么，再说明横纵坐标、颜色或分组，' +
      '最后描述观察到的差异、方向、统计结果或阴性结果。',
      '4. 给出有边界的解释：区分直接观察、局部推断和因果结论，说明替代解释是否被排除。',
      '5. 在对应 Figure 的讲稿中就地加入适度的批判性评价，而不是把所有批评集中到最后一页。' +
      '根据实际证据讨论样本量与统计单位、对照是否匹配、示踪物或模型是否代表生理过程、静态图像能否支持动态通量、' +
      '共定位能否支持跨膜转运、相关性是否被写成因果、救援实验是否真正恢复了上游缺陷，以及结果之间是否存在张力或替代解释。' +
      '先准确解释作者证据，再指出边界；没有依据时不要为了显得“批判”而硬挑问题。',
      '6. 说明这一页在全文证据链中的作用，并自然引出下一页的问题。',
      '',
      '结果页备注通常为 180–350 个中文字符，复杂实验可更长；背景、过渡和总结页通常为 100–220 个中文字符。' +
      '优先保证逻辑完整，不要用固定套话填充字数。不得编造样本量、统计值、剂量、时间或作者未报告的信息。',
      '',
      '在每页备注末尾另起一段添加不需要朗读的 `[Source trace]`，记录原图路径、Figure/Panel 编号，' +
      '以及使用的分析文件，例如：`figures/Figure_03/image_01.png | Fig. 3A–D | analysis/figures/Figure_03.json`。',
      '',
      '## 五、可选口播音频与自动切页',
      '',
      '如果用户要求语音讲解，且环境能够生成并嵌入音频，则用每页 `[Source trace]` 之前的口语讲稿生成一段独立中文语音。' +
      '优先使用自然的中文神经网络语音；同时保留完整备注和无音频的可编辑版本。',
      '',
      '音频同步必须满足以下硬性规则：',
      '',
      '1. 每页只有一个口播媒体对象，并设置为进入页面后立即播放。PowerPoint 动画时间线必须是 `With Previous`、' +
      '`TriggerDelayTime = 0`；仅设置 `PlayOnEntry` 不够，因为 PowerPoint 可能仍把媒体效果保留为 `On Click`。',
      '2. 自动切页时间使用 PowerPoint 嵌入后实际解码得到的媒体长度，例如 `MediaFormat.Length / 1000`，' +
      '再增加 1.0–1.5 秒缓冲；不要只依赖外部 MP3 容器估算或字数推算。',
      '3. 自动讲解版关闭鼠标单击翻页，避免误触在讲话中途切页；仍可保留键盘方向键用于人工跳过。',
      '4. 交付前逐页核验：音频触发类型、零延迟、实际媒体时长、页面切换时间和媒体文件数量必须一一对应。' +
      '建议同时输出可编辑的 narrated `.pptx` 和双击即放映的 `.ppsx`。',
      '',
      '## 六、局限性与讨论的写法',
      '',
      '不要写通用套话。至少从以下维度中选择与本文证据真正相关的 3–5 点：模型与刺激范式、样本或细胞类型、' +
      '相关性与因果性的边界、通路平行分支或替代机制、行为读出的特异性、急性操控与慢性疾病之间的差异、' +
      '动物结果向临床或人类机制外推的限制。',
      '',
      '每一点都采用“现有证据支持什么 → 还不能回答什么 → 什么实验可以进一步验证”的表达。' +
      '最后给出一条稳健结论，避免把局限性写成对论文价值的全盘否定。',
      '',
      '## 七、制作工作流',
      '',
      '1. 先声明采用“完整视觉版”还是“Panel 占位版”。完整视觉版建立 `work/panel-crops/`，' +
      '先导出裁切图和裁切坐标清单；占位版建立逐页待替换 Panel 清单。',
      '2. 先写 `work/slide-plan.md`，逐页列出：页面角色、科学问题、使用的 Panel、' +
      '所属主 Figure、页面右上角分区标签、一句结论、与前后页的逻辑关系和预计讲述时间。',
      '3. 根据“背景 → 缺口 → 科学问题 → Panel 证据递进 → 局限性 → 三条总结”完成整套 PPT。',
      '4. 写完全部演讲备注后再做视觉校正，防止为了补文字破坏 Panel 可读性。',
      '5. 将 PPT 渲染为逐页图片或缩略图并逐页检查。完整视觉版至少在 50% 缩放下复核 Figure、坐标和分组是否可读，' +
      '并对所有裁切图做一次高分辨率边界检查；占位版则检查每个框的 Fig/Panel 标识是否与 slide plan 完全一致。',
      '',
      '## 八、包内 Figure 清单',
      '',
      ...figures.map((figure, index) =>
        `${index + 1}. ${figure.figureLabel || figure.figureId}；Panels：` +
        `${(figure.panelHints || []).join(', ') || '未标注'}；图片：` +
        `${(figure.imageFiles || []).join(', ') || '未打包'}`),
      '',
      '## 九、交付物',
      '',
      '- 完整视觉模式：包含真实 Panel 的可编辑的 `.pptx`；无视觉模式：明确命名的 `_PANEL_PLACEHOLDERS.pptx`；',
      '- 完整视觉模式提供 `work/panel-crops/` 裁切图；占位模式提供逐页 Panel 替换清单；',
      '- 完整视觉模式提供 `work/crop-manifest.json`（原图、Panel、裁切坐标、输出文件）；' +
      '占位模式提供 `work/panel-placeholder-manifest.json`（页码、方框位置、待粘贴 Panel 和必须保留的信息）；',
      '- `work/slide-plan.md`（每页角色、标题、科学问题、证据任务、主 Figure、Panel、页眉标签、结论、衔接与预计时间）；',
      '- 一份最终自检报告，列出无法可靠裁切、信息缺失、证据不足或仍需人工核实的页面；',
      '- 如环境支持，附一份与最终 PPT 同步的 PDF 预览。',
      '- 如生成口播，另附同步验证通过的 narrated `.pptx` 和 `.ppsx`，并保留无音频编辑版。',
      '',
      '## 十、交付前硬性验收',
      '',
      '- 作者、单位、共同第一/通讯作者和贡献均有可靠来源；缺失信息宁可省略，不得猜测。',
      '- 背景明确导向知识缺口，科学问题与后续结果分组一一对应。',
      '- 结果页以真实 Panel 为主体，没有装饰性视觉元素或大段正文。',
      '- 所有 Panel 标签、坐标、图例、分组、比例尺、统计符号和结论方向均与原论文一致。',
      '- 结果页按正文科学问题和 `FIGURE 1`、`FIGURE 2`……组织，没有把拆页误写成十几个 `RESULT`。',
      '- 完整视觉版没有相邻 Panel 残留、重复 Panel 字母或本 Panel 字母/坐标/图例被截断；' +
      '无视觉版的每个占位框都明确标注待粘贴的 `Fig. 2A` 等编号。',
      '- 每页只有一个主要信息，前后页能形成连续的证据链。',
      '- 局限性具体、基于本文证据，并与总结中的结论强度一致。',
      '- 每一页都有自然可讲的备注；结果页备注包含实验设计、逐 Panel 读图、结果、就地批判性评价、边界和逻辑衔接。',
      '- 无文字溢出、图片遮挡、低清晰度、不可读小字或错误裁切。',
      '- 所有页面均可通过 `[Source trace]` 回溯；完整视觉版的裁切还必须能通过 `crop-manifest.json` 回溯。',
      '- 如生成口播，32 页或实际全部页面均为进入页面立即播放，切页时间等于实际媒体长度加缓冲，' +
      '不存在长时间静默、讲话中途切页或音频数量与页面数量不一致。',
      ''
    ].join('\n');
  }

  function noteSection(title, body) {
    const anchor = sanitizeExportFilename(title, 'section')
      .toLowerCase().replace(/\s+/g, '-');
    return [
      `<h2 id="sci-note-${escapeHtml(anchor)}">${escapeHtml(title)}</h2>`,
      body || '<p><em>暂无内容。</em></p>'
    ].join('');
  }

  const ZOTERO_NOTE_LABELS = Object.freeze({
    figureId: 'Figure ID',
    figureLabel: 'Figure',
    figureQuestion: '本图回答的问题',
    coreConclusion: '核心结论',
    authorAssembly: '作者如何组织本图',
    claimBoundary: '结论边界',
    directObservation: '直接观察',
    observation: '直接观察',
    localInference: '局部推断',
    contribution: '在全文论证中的作用',
    purpose: '实验目的',
    design: '实验设计',
    methods: '方法',
    comparison: '比较关系',
    result: '结果',
    conclusion: '结论',
    evidenceLevel: '证据等级',
    relationLevel: '关系强度',
    role: '论证角色',
    panels: 'Panels',
    panelGroups: 'Panel 组合',
    logicBridges: '逻辑桥接',
    argumentChain: '证据链',
    groupGoal: '组合目标',
    groupConclusion: '组合结论',
    overallThesis: '全文主线',
    dominoChain: '主图串联',
    residualGaps: '尚未解决的问题',
    established: '前图已经建立',
    handoff: '交给下一图的问题',
    transition: '衔接逻辑',
    sourceFigureId: '前一张 Figure',
    targetFigureId: '后一张 Figure',
    relationType: '关系类型',
    answer: '回答',
    question: '问题',
    summary: '摘要',
    basis: '依据',
    caveat: '注意',
    limitations: '局限',
    contextParagraphs: '相关正文证据'
  });

  function zoteroNoteLabel(key) {
    const normalized = String(key || '').replace(/_([a-z])/g, (_, letter) =>
      letter.toUpperCase());
    if (ZOTERO_NOTE_LABELS[normalized]) return ZOTERO_NOTE_LABELS[normalized];
    return normalized
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/_/g, ' ')
      .replace(/\bzh\b/gi, '')
      .trim();
  }

  function zoteroInlineMarkup(value) {
    return escapeHtml(value)
      .replace(/`([^`\n]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\[\[(\d+)\]\]/g, '<sup>[$1]</sup>');
  }

  function zoteroMarkdownHtml(value) {
    const lines = String(value || '').replace(/\r\n?/g, '\n').split('\n');
    const output = [];
    let listType = '';
    const closeList = () => {
      if (listType) output.push(`</${listType}>`);
      listType = '';
    };
    lines.forEach(line => {
      const trimmed = line.trim();
      if (!trimmed) {
        closeList();
        return;
      }
      const heading = trimmed.match(/^(#{1,4})\s+(.+)$/);
      if (heading) {
        closeList();
        const level = Math.min(6, heading[1].length + 2);
        output.push(`<h${level}>${zoteroInlineMarkup(heading[2])}</h${level}>`);
        return;
      }
      const unordered = trimmed.match(/^[-*]\s+(.+)$/);
      const ordered = trimmed.match(/^\d+[.)]\s+(.+)$/);
      if (unordered || ordered) {
        const nextList = ordered ? 'ol' : 'ul';
        if (listType !== nextList) {
          closeList();
          listType = nextList;
          output.push(`<${listType}>`);
        }
        output.push(`<li>${zoteroInlineMarkup((unordered || ordered)[1])}</li>`);
        return;
      }
      closeList();
      output.push(`<p>${zoteroInlineMarkup(trimmed)}</p>`);
    });
    closeList();
    return output.join('') || '<p><em>暂无内容。</em></p>';
  }

  const ZOTERO_NOTE_TOKEN_LABELS = Object.freeze({
    model_setup: '模型建立',
    method_validation: '方法验证',
    phenotype: '表型结果',
    mechanism: '机制证据',
    rescue: '挽救实验',
    validation: '验证',
    other: '其他',
    schematic: '示意图',
    imaging: '成像',
    quantification: '定量分析',
    sequencing: '测序',
    intervention_effect: '干预效应',
    association: '相关性',
    descriptive: '描述性证据',
    sufficiency: '充分性',
    necessity: '必要性',
    upstream: '上游',
    downstream: '下游',
    parallel_support: '平行支持',
    replication: '重复验证',
    contrast: '对照',
    extension: '扩展'
  });

  const ZOTERO_NOTE_INTERNAL_KEYS = new Set([
    'figureid', 'figurelabel', 'panelid', 'analysistitle', 'analysisdepth',
    'basis', 'methoddetails', 'methodsource', 'observationsource',
    'contextparagraphs', 'panelcoverage', 'cachehit', 'operationid',
    'normalizedmethod', 'methodfamily', 'methodtext', 'methodcategory',
    'ignoredunexpectedpanelcount', 'visionfallback', 'metadata', 'diagnostics'
  ]);

  function zoteroHasValue(value) {
    if (value === null || value === undefined || value === '') return false;
    if (Array.isArray(value)) return value.some(zoteroHasValue);
    if (typeof value === 'object') {
      return Object.values(value).some(zoteroHasValue);
    }
    return true;
  }

  function zoteroFirstValue(source, keys) {
    for (const key of keys) {
      if (zoteroHasValue(source?.[key])) return source[key];
    }
    return '';
  }

  function zoteroDisplayToken(value) {
    const text = String(value ?? '').trim();
    return ZOTERO_NOTE_TOKEN_LABELS[text] || text;
  }

  function zoteroCompactValue(value, depth = 0) {
    if (depth > 3) return '<em>内容已精简</em>';
    if (!zoteroHasValue(value)) return '<em>未提供</em>';
    if (typeof value === 'boolean') return value ? '是' : '否';
    if (typeof value === 'number') return escapeHtml(value);
    if (typeof value === 'string') {
      const lines = value.replace(/\r\n?/g, '\n').split('\n')
        .map(line => line.trim()).filter(Boolean);
      if (!lines.length) return '<em>未提供</em>';
      if (lines.length > 1 && lines.every(line => /^([-*]|\d+[.)])\s+/.test(line))) {
        return `<ul>${lines.map(line =>
          `<li>${zoteroInlineMarkup(line.replace(/^([-*]|\d+[.)])\s+/, ''))}</li>`
        ).join('')}</ul>`;
      }
      return lines.map(line => zoteroInlineMarkup(zoteroDisplayToken(line))).join('<br>');
    }
    if (Array.isArray(value)) {
      const items = value.filter(zoteroHasValue);
      if (!items.length) return '<em>未提供</em>';
      return `<ul>${items.map(item =>
        `<li>${zoteroCompactValue(item, depth + 1)}</li>`).join('')}</ul>`;
    }
    const safeValue = cloneExportValue(value);
    const entries = Object.entries(safeValue || {}).filter(([key, nested]) => {
      const normalizedKey = String(key).replace(/[^a-z0-9]/gi, '').toLowerCase();
      return zoteroHasValue(nested) && !ZOTERO_NOTE_INTERNAL_KEYS.has(normalizedKey) &&
        !/(?:^|_)(?:cache|diagnostic|metadata|operation)(?:_|$)/i.test(key);
    });
    if (!entries.length) return '<em>未提供</em>';
    return `<ul>${entries.map(([key, nested]) => [
      `<li><strong>${escapeHtml(zoteroNoteLabel(key) || key)}：</strong>`,
      zoteroCompactValue(nested, depth + 1),
      '</li>'
    ].join('')).join('')}</ul>`;
  }

  function zoteroCompactTable(rows, headers = null) {
    const visibleRows = rows.filter(row => {
      if (!Array.isArray(row)) return false;
      return (headers ? row : row.slice(1)).some(zoteroHasValue);
    });
    if (!visibleRows.length) return '';
    const head = Array.isArray(headers) && headers.length
      ? `<tr>${headers.map(header =>
        `<th>${escapeHtml(header)}</th>`).join('')}</tr>`
      : '';
    const body = visibleRows.map(row => `<tr>${row.map((cell, index) => {
      if (!headers && index === 0) {
        return `<th>${escapeHtml(cell)}</th>`;
      }
      return `<td>${zoteroCompactValue(cell)}</td>`;
    }).join('')}</tr>`).join('');
    return `<table><tbody>${head}${body}</tbody></table>`;
  }

  function zoteroPanelLabel(value, fallback = '') {
    return String(value || fallback).replace(/^panel[\s_-]*/i, '').trim() || fallback;
  }

  function zoteroPanelMethods(panel) {
    const methods = zoteroFirstValue(panel, ['methods', 'method', 'techniques']);
    const values = [];
    const category = zoteroDisplayToken(panel?.methodCategory || '');
    if (category) values.push(`类别：${category}`);
    if (Array.isArray(methods)) {
      methods.forEach(method => {
        if (typeof method === 'string') values.push(method);
        else {
          const label = zoteroFirstValue(method, [
            'normalizedMethod', 'method', 'name', 'label', 'methodText', 'text'
          ]);
          if (label) values.push(label);
        }
      });
    } else if (methods) {
      values.push(methods);
    }
    return [...new Set(values.map(value => String(value).trim()).filter(Boolean))];
  }

  function zoteroPanelRows(panel, followup) {
    const methodValues = zoteroPanelMethods(panel);
    return [
      ['论证角色', zoteroDisplayToken(zoteroFirstValue(panel, ['role']))],
      ['研究对象/表型', zoteroFirstValue(panel, ['phenotypeName', 'phenotype'])],
      ['实验目的', zoteroFirstValue(panel, ['purpose', 'experimentalPurpose', 'aim'])],
      ['方法', methodValues],
      ['实验设计', zoteroFirstValue(panel, ['design', 'experimentalDesign'])],
      ['比较关系', zoteroFirstValue(panel, ['comparison', 'comparisonRelationship'])],
      ['直接观察', zoteroFirstValue(panel, ['directObservation', 'observation', 'result'])],
      ['局部推断', zoteroFirstValue(panel, ['localInference', 'inference'])],
      ['全文作用', zoteroFirstValue(panel, ['contribution', 'roleInArgument'])],
      ['结论边界', zoteroFirstValue(panel, ['claimBoundary'])],
      ['追问结论', zoteroFirstValue(followup, ['answer', 'summary'])],
      ['追问边界', zoteroFirstValue(followup, ['claimBoundary', 'caveat'])]
    ];
  }

  function zoteroFigureAnalysisHtml(figure) {
    const analysis = cloneExportValue(figure.deep || figure.standard || {});
    const panelAnalyses = cloneExportValue(figure.panelAnalyses || {});
    const panelFollowups = cloneExportValue(figure.panelFollowups || {});
    const panelByLabel = new Map();
    (Array.isArray(analysis.panels) ? analysis.panels : []).forEach((panel, index) => {
      const label = zoteroPanelLabel(panel?.panel || panel?.panelId, String(index + 1));
      panelByLabel.set(label, panel);
    });
    Object.entries(panelAnalyses).forEach(([rawLabel, panel]) => {
      const label = zoteroPanelLabel(panel?.panel || panel?.panelId || rawLabel, rawLabel);
      panelByLabel.set(label, { ...(panelByLabel.get(label) || {}), ...panel });
    });
    Object.keys(panelFollowups).forEach(rawLabel => {
      const label = zoteroPanelLabel(rawLabel, rawLabel);
      if (!panelByLabel.has(label)) panelByLabel.set(label, {});
    });

    const metrics = (Array.isArray(figure.images) ? figure.images : [])
      .map((image, index) => {
        const dimensions = image.pixelWidth && image.pixelHeight
          ? `${image.pixelWidth} × ${image.pixelHeight} px` : '尺寸未知';
        const size = Number(image.byteLength) > 0
          ? `${(Number(image.byteLength) / 1024 / 1024).toFixed(1)} MB` : '大小未知';
        return `原图 ${index + 1}：${dimensions}，${size}`;
      });
    const summary = zoteroCompactTable([
      ['本图问题', analysis.figureQuestion],
      ['核心结论', analysis.coreConclusion],
      ['图的组织', analysis.authorAssembly],
      ['结论边界', analysis.claimBoundary]
    ]);
    const panels = [...panelByLabel.entries()].map(([label, panel]) => {
      const followup = panelFollowups[label] || panelFollowups[`Panel ${label}`] || {};
      return [
        `<h4 id="sci-note-${escapeHtml(
          figure.figureId || figure.figureLabel || 'figure'
        )}-panel-${escapeHtml(label)}">Panel ${escapeHtml(label)}</h4>`,
        zoteroCompactTable(zoteroPanelRows(panel, followup))
      ].join('');
    }).join('');
    const panelGroups = Array.isArray(analysis.panelGroups) && analysis.panelGroups.length
      ? [
        '<h4>Panel 组合</h4>',
        zoteroCompactTable(analysis.panelGroups.map(group => [
          (Array.isArray(group.panels) ? group.panels : []).join('、'),
          group.groupGoal,
          group.groupConclusion
        ]), ['Panels', '组合目标', '组合结论'])
      ].join('') : '';
    const argumentChain = Array.isArray(analysis.argumentChain) &&
      analysis.argumentChain.length
      ? [
        '<h4>本图证据链</h4>',
        zoteroCompactTable(analysis.argumentChain.map(step => [
          (Array.isArray(step.panels) ? step.panels : []).join('、'),
          step.established,
          step.handoff,
          zoteroDisplayToken(step.evidenceLevel)
        ]), ['Panels', '已建立', '下一步问题', '证据等级'])
      ].join('') : '';
    return [
      metrics.length
        ? `<p><strong>快照图像：</strong>${escapeHtml(metrics.join('；'))}</p>` : '',
      summary,
      panels ? `<h3>Panel 分解</h3>${panels}` : '',
      panelGroups,
      argumentChain
    ].join('');
  }

  function zoteroCrossFigureHtml(value) {
    const logic = cloneExportValue(value || {});
    if (!logic || !Object.keys(logic).length) return '';
    const parts = [];
    if (logic.overallThesis) {
      parts.push(
        `<p><strong>全文主线：</strong>${zoteroCompactValue(logic.overallThesis)}</p>`
      );
    }
    if (Array.isArray(logic.nodes) && logic.nodes.length) {
      parts.push(
        '<h3>各图角色</h3>',
        zoteroCompactTable(logic.nodes.map(node => [
          node.figureLabel || node.figureId,
          zoteroDisplayToken(node.role),
          node.established,
          node.transition,
          zoteroDisplayToken(node.evidenceLevel)
        ]), ['Figure', '角色', '建立了什么', '如何衔接', '证据等级'])
      );
    }
    if (Array.isArray(logic.dominoChain) && logic.dominoChain.length) {
      const structuredSteps = logic.dominoChain.filter(step =>
        step && typeof step === 'object' && !Array.isArray(step));
      const narrativeSteps = logic.dominoChain.filter(step =>
        typeof step === 'string' || typeof step === 'number');
      parts.push(
        '<h3>主图串解</h3>',
        structuredSteps.length ? zoteroCompactTable(structuredSteps.map(step => [
          `${step.fromFigureLabel || step.fromFigureId || ''} → ${
            step.toFigureLabel || step.toFigureId || ''}`,
          zoteroDisplayToken(step.relationType),
          step.established,
          step.transition,
          step.evidenceBoundary
        ]), ['连接', '关系', '前图建立', '推进逻辑', '证据边界']) : '',
        narrativeSteps.length ? zoteroCompactValue(narrativeSteps) : ''
      );
    }
    if (Array.isArray(logic.supplementalSupport) && logic.supplementalSupport.length) {
      parts.push(
        '<h3>补充图支持</h3>',
        zoteroCompactTable(logic.supplementalSupport.map(item => [
          item.figureLabel || item.figureId,
          item.supportsFigureLabel || item.supportsFigureId,
          item.contribution
        ]), ['补充图', '支持主图', '贡献'])
      );
    }
    if (Array.isArray(logic.residualGaps) && logic.residualGaps.length) {
      parts.push(
        '<h3>尚未解决的问题</h3>',
        zoteroCompactValue(logic.residualGaps)
      );
    }
    if (logic.claimBoundary) {
      parts.push(
        `<p><strong>总体证据边界：</strong>${
          zoteroCompactValue(logic.claimBoundary)
        }</p>`
      );
    }
    return parts.join('');
  }

  function zoteroNoteSourceHeader(input, kind) {
    let sourceUrl = '';
    try {
      const parsed = new URL(String(input.url || ''));
      if (['http:', 'https:'].includes(parsed.protocol)) sourceUrl = parsed.href;
    } catch (_) {}
    return [
      `<div data-sci-reader-note="${escapeHtml(kind)}">`,
      `<h1>${kind === 'figure-interpretation'
        ? 'SCI Reader：图解'
        : 'SCI Reader：全文问答'}</h1>`,
      `<h2>${escapeHtml(input.title || '')}</h2>`,
      sourceUrl
        ? `<p><a href="${escapeHtml(sourceUrl)}">打开论文原网页</a></p>`
        : ''
    ].join('');
  }

  function zoteroNoteFooter(input) {
    return [
      `<p><small>由 Brevess 于 ${escapeHtml(
        input.exportedAt || new Date().toISOString()
      )} 导出。</small></p>`,
      '</div>'
    ].join('');
  }

  function buildZoteroFigureNoteHtml(input = {}) {
    const figures = Array.isArray(input.figures) ? input.figures : [];
    const quickLinks = figures.map((figure, index) =>
      `<a href="#sci-note-figure-${index + 1}">${
        escapeHtml(figure.figureLabel || figure.figureId || `Figure ${index + 1}`)
      }</a>`).join(' · ');
    const figureHtml = figures.map((figure, index) => [
      `<h2 id="sci-note-figure-${index + 1}">${
        escapeHtml(figure.figureLabel || figure.figureId || `Figure ${index + 1}`)
      }</h2>`,
      figure.caption
        ? `<p><strong>图注：</strong>${zoteroInlineMarkup(figure.caption)}</p>`
        : '',
      zoteroFigureAnalysisHtml(figure)
    ].join('')).join('');
    const crossFigure = zoteroCrossFigureHtml(input.crossFigureLogic);
    return [
      zoteroNoteSourceHeader(input, 'figure-interpretation'),
      `<p><strong>内容概览：</strong>${figures.length} 张 Figure；${
        Number(input.embeddedImageCount) || 0
      } 张高清原图已嵌入增强网页快照。</p>`,
      quickLinks ? `<p><strong>快速跳转：</strong>${quickLinks}</p>` : '',
      noteSection('主图串解', crossFigure),
      noteSection(
        'Figure 与 Panel 解读',
        figureHtml || '<p><em>尚未生成图解内容。</em></p>'
      ),
      zoteroNoteFooter(input)
    ].join('');
  }

  function buildZoteroChatNoteHtml(input = {}) {
    const turns = Array.isArray(input.chat?.turns) ? input.chat.turns : [];
    const chatHtml = turns.map((turn, index) => {
      const blocks = (Array.isArray(turn.answerBlocks) ? turn.answerBlocks : [])
        .map(block => zoteroMarkdownHtml(block.markdown || ''))
        .join('');
      return [
        `<h3>问答 ${index + 1}</h3>`,
        `<blockquote><strong>问题</strong><br>${zoteroInlineMarkup(turn.question || '')}</blockquote>`,
        `<div><strong>回答</strong>${blocks || zoteroMarkdownHtml(turn.summary || '无回答')}</div>`
      ].join('');
    }).join('');
    return [
      zoteroNoteSourceHeader(input, 'fulltext-qa'),
      `<p><strong>内容概览：</strong>${turns.length} 轮全文问答。</p>`,
      noteSection(
        '全文问答',
        chatHtml || '<p><em>尚未生成全文问答内容。</em></p>'
      ),
      zoteroNoteFooter(input)
    ].join('');
  }

  // Kept for callers from older unpacked builds. New exports intentionally use
  // two independent child notes through the functions above.
  function buildZoteroNoteHtml(input = {}) {
    return [
      buildZoteroFigureNoteHtml(input),
      buildZoteroChatNoteHtml(input)
    ].join('');
  }

  function buildZoteroFallbackReadme(input = {}) {
    return [
      '# Zotero 增强快照离线包',
      '',
      `论文：${input.title || ''}`,
      `原文：${input.url || ''}`,
      '',
      '此包在 Zotero 桌面端未运行、Connector HTTP 服务不可用或直接导入失败时生成。',
      '',
      '## 文件',
      '',
      '- `snapshot.html`：忠实保留出版社网页 HTML，只固化插件激活时的单栏结构、' +
        '高亮、可点击备注和可获取的 Figure 高清原图；',
      '- `notes/SCI-Reader-Figure-Interpretation.html`：主图串解、Figure 与 Panel 图解；',
      '- `notes/SCI-Reader-Fulltext-QA.html`：独立保存全文问答；',
      '- `metadata.json`：论文和导出信息。',
      '',
      '## 手工导入',
      '',
      '1. 在 Zotero 中先用浏览器 Connector 保存原论文，或新建网页条目。',
      '2. 将 `snapshot.html` 拖到该条目上作为附件。',
      '3. 分别打开 `notes` 下的两个 HTML，复制正文并在 Zotero 条目下新建两个子笔记。',
      ''
    ].join('\n');
  }

  return {
    sanitizeExportFilename,
    sanitizeZipPath,
    cloneExportValue,
    exportJson,
    escapeHtml,
    crc32,
    createZipBlob,
    buildFigureMarkdown,
    buildPptAgentPrompt,
    buildZoteroFigureNoteHtml,
    buildZoteroChatNoteHtml,
    buildZoteroNoteHtml,
    buildZoteroFallbackReadme
  };
});
