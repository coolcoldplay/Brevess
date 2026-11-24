
;/* native/core/i18n-export.js */
(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  'use strict';
  // Only literal template fragments are translated. Interpolated paper text,
  // notes, model answers and user customization are never searched or replaced.
  const EN = Object.freeze({
    '笔记模板不可用': 'The note template is unavailable',
    '文献笔记': 'Literature note',
    '“{0}”的来源无法安全转换，原文已保留': 'Sources for “{0}” could not be converted safely. The original text is unchanged',
    '笔记格式无法安全转换，原文已保留': 'The note format could not be converted safely. The original text is unchanged',
    '已保存的精确引文（导出时未重新核验）：': 'Saved exact quotations (not reverified during export):',
    '来源 {0}': 'Source {0}', '已保存引文 {0}': 'Saved quotation {0}',
    '来源仅有第 {0} 页位置，待核验。': 'Only a location on page {0} is available for this source; verification is pending.',
    '来源已过期，待重新核验。': 'The source is stale and needs verification again.',
    '来源存在歧义，待核验。': 'The source is ambiguous and needs verification.',
    '未找到正文来源。': 'No source was found in the article.',
    '来源记录无效，无法定位。': 'The source record is invalid and cannot be located.',
    '历史内容，来源未保存。': 'Historical content; its source was not saved.',
    '来源记录无法核验。': 'The source record cannot be verified.',
    '备注：{0}': 'Note: {0}', '高亮备注与译文': 'Highlight notes and translations',
    '译文（部分完成）': 'Translation (partial)', '译文': 'Translation',
    '译文 {0}（原文位置未匹配）': 'Translation {0} (source location not matched)',
    '备注 {0}{1}': 'Note {0}{1}', '（原文位置未匹配）': ' (source location not matched)',
    '返回高亮原句': 'Back to the highlighted sentence', '打开论文原网页': 'Open the original article page',
    '查看备注 {0}': 'View note {0}',
    '未标注': 'Not labeled', '- 图像文件: {0}': '- Image files: {0}',
    '未能打包；参见 sourceUrls': 'Not packaged; see sourceUrls', '## 图注': '## Caption', '无': 'None',
    '## 本图全部解读数据': '## Complete analysis data for this figure', '中文': 'English',
    '科研组会 / Journal Club': 'Research group meeting / Journal Club',
    '<p><em>暂无内容。</em></p>': '<p><em>No content yet.</em></p>',
    '本图回答的问题': 'Question addressed by this figure', '核心结论': 'Core conclusion',
    '作者如何组织本图': 'How the authors organized the figure', '结论边界': 'Limits of the conclusion',
    '直接观察': 'Direct observation', '局部推断': 'Local inference', '在全文论证中的作用': 'Role in the paper’s argument',
    '实验目的': 'Experimental purpose', '实验设计': 'Experimental design', '方法': 'Methods', '比较关系': 'Comparison',
    '结果': 'Result', '结论': 'Conclusion', '证据等级': 'Evidence level', '关系强度': 'Strength of the relationship',
    '论证角色': 'Role in the argument', 'Panel 组合': 'Panel groups', '逻辑桥接': 'Logical bridges', '证据链': 'Evidence chain',
    '组合目标': 'Group objective', '组合结论': 'Group conclusion', '全文主线': 'Main argument of the paper',
    '主图串联': 'Links between main figures', '尚未解决的问题': 'Unresolved questions', '前图已经建立': 'Established by the preceding figure',
    '交给下一图的问题': 'Question for the next figure', '衔接逻辑': 'Transition logic', '前一张 Figure': 'Previous figure',
    '后一张 Figure': 'Next figure', '关系类型': 'Relationship type', '回答': 'Answer', '问题': 'Question', '摘要': 'Summary',
    '依据': 'Basis', '注意': 'Caveat', '局限': 'Limitations', '相关正文证据': 'Related evidence from the article',
    '模型建立': 'Model establishment', '方法验证': 'Method validation', '表型结果': 'Phenotypic result',
    '机制证据': 'Mechanistic evidence', '挽救实验': 'Rescue experiment', '验证': 'Validation', '其他': 'Other',
    '示意图': 'Schematic', '成像': 'Imaging', '定量分析': 'Quantitative analysis', '测序': 'Sequencing',
    '干预效应': 'Intervention effect', '相关性': 'Association', '描述性证据': 'Descriptive evidence',
    '充分性': 'Sufficiency', '必要性': 'Necessity', '上游': 'Upstream', '下游': 'Downstream',
    '平行支持': 'Parallel support', '重复验证': 'Replication', '对照': 'Control', '扩展': 'Extension',
    '<em>内容已精简</em>': '<em>Content abbreviated</em>', '<em>未提供</em>': '<em>Not provided</em>',
    '是': 'Yes', '否': 'No', '类别：{0}': 'Category: {0}', '类别：': 'Category: ', '未报告': 'Not reported',
    '笔记': 'Notes', '旧论证角色': 'Legacy argument role', '方法类别（兼容保留）': 'Method category (legacy)',
    '全文作用（兼容保留）': 'Role in the paper (legacy)', '追问结论': 'Follow-up conclusion', '追问边界': 'Follow-up limitations',
    '研究对象/表型': 'Study subject / phenotype', '全文作用': 'Role in the paper', '## Panel {0} 八字段': '## Panel {0}: eight fields',
    '尺寸未知': 'Dimensions unknown', '大小未知': 'Size unknown', '原图 {0}：{1}，{2}': 'Original image {0}: {1}, {2}',
    '本图问题': 'Figure question', '图的组织': 'Figure organization', '<h4>Panel 组合</h4>': '<h4>Panel groups</h4>',
    '<h4>本图证据链</h4>': '<h4>Evidence chain for this figure</h4>', '已建立': 'Established finding', '下一步问题': 'Next question',
    '<p><strong>快照图像：</strong>{0}</p>': '<p><strong>Snapshot images:</strong> {0}</p>',
    '<h3>Panel 分解</h3>{0}': '<h3>Panel breakdown</h3>{0}',
    '<p><strong>全文主线：</strong>{0}</p>': '<p><strong>Main argument:</strong> {0}</p>',
    '<h3>各图角色</h3>': '<h3>Roles of the figures</h3>', '角色': 'Role', '建立了什么': 'What was established', '如何衔接': 'How it connects',
    '<h3>主图串解</h3>': '<h3>Main-figure narrative</h3>', '连接': 'Link', '关系': 'Relationship', '前图建立': 'Previous finding',
    '推进逻辑': 'Logical progression', '证据边界': 'Evidence boundary', '<h3>补充图支持</h3>': '<h3>Support from supplementary figures</h3>',
    '补充图': 'Supplementary figure', '支持主图': 'Main figure supported', '贡献': 'Contribution',
    '<h3>尚未解决的问题</h3>': '<h3>Unresolved questions</h3>',
    '<p><strong>总体证据边界：</strong>{0}</p>': '<p><strong>Overall evidence boundary:</strong> {0}</p>',
    'Brevess：图解': 'Brevess: Figure interpretation', 'Brevess：全文问答': 'Brevess: Full-text Q&A',
    '<p><a href="{0}">打开论文原网页</a></p>': '<p><a href="{0}">Open the original article</a></p>',
    '<p><small>由 Brevess 于 {0} 导出。</small></p>': '<p><small>Exported by Brevess on {0}.</small></p>',
    '<p><strong>内容概览：</strong>{0} 张 Figure；{1} 张高清原图已嵌入增强网页快照。</p>': '<p><strong>Overview:</strong> {0} figures; {1} high-resolution original images embedded in the enhanced webpage snapshot.</p>',
    '<p><strong>快速跳转：</strong>{0}</p>': '<p><strong>Quick links:</strong> {0}</p>',
    '主图串解': 'Main-figure narrative', 'Figure 与 Panel 解读': 'Figure and Panel interpretation',
    '<p><em>尚未生成图解内容。</em></p>': '<p><em>No figure interpretation has been generated.</em></p>',
    '<h3>问答 {0}</h3>': '<h3>Q&A {0}</h3>',
    '<blockquote><strong>问题</strong><br>{0}</blockquote>': '<blockquote><strong>Question</strong><br>{0}</blockquote>',
    '<div><strong>回答</strong>{0}</div>': '<div><strong>Answer</strong>{0}</div>', '无回答': 'No answer',
    '<p><strong>内容概览：</strong>{0} 轮全文问答。</p>': '<p><strong>Overview:</strong> {0} full-text Q&A turns.</p>',
    '全文问答': 'Full-text Q&A', '<p><em>尚未生成全文问答内容。</em></p>': '<p><em>No full-text Q&A has been generated.</em></p>',
    '<div data-sci-reader-note="reading-content" style="overflow-wrap:anywhere;max-width:100%"><h1>Brevess：高亮备注与译文</h1>': '<div data-sci-reader-note="reading-content" style="overflow-wrap:anywhere;max-width:100%"><h1>Brevess: Highlight notes and translations</h1>',
    '已确认译文已保留。': 'Confirmed translations have been preserved.',
    '翻译尚未全部完成；仅保留已确认内容，未译部分仍为原文。': 'Translation is incomplete. Only confirmed translations are preserved; untranslated passages remain in the original language.',
    '<h3>备注 {0}</h3><blockquote>{1}</blockquote><p style="white-space:pre-wrap">{2}</p>': '<h3>Note {0}</h3><blockquote>{1}</blockquote><p style="white-space:pre-wrap">{2}</p>',
    '原句未提供': 'Original sentence not provided',
    '<h3>译文 {0}{1}</h3><blockquote>{2}</blockquote><p lang="zh" style="white-space:pre-wrap">{3}</p>': '<h3>Translation {0}{1}</h3><blockquote>{2}</blockquote><p lang="zh" style="white-space:pre-wrap">{3}</p>',
    '（部分完成）': ' (partial)', '# Zotero 增强快照离线包': '# Zotero enhanced snapshot offline package',
    '论文：{0}': 'Article: {0}', '原文：{0}': 'Source: {0}',
    '此包在 Zotero 桌面端未运行、Connector HTTP 服务不可用或直接导入失败时生成。': 'This package is generated when Zotero Desktop is not running, its Connector HTTP service is unavailable, or direct import fails.',
    '## 文件': '## Files',
    '- `snapshot.html`：保留出版社布局、高亮、备注正文与原句回链、已确认译文和可获取的 Figure 原图；部分翻译明确标记。': '- `snapshot.html`: preserves the publisher layout, highlights, note text with links to original sentences, confirmed translations and available original figures. Partial translations are marked.',
    '- `notes/SCI-Reader-Figure-Interpretation.html`：主图串解、Figure 与 Panel 图解；': '- `notes/SCI-Reader-Figure-Interpretation.html`: main-figure narrative and Figure/Panel interpretation.',
    '- `notes/SCI-Reader-Fulltext-QA.html`：独立保存全文问答；': '- `notes/SCI-Reader-Fulltext-QA.html`: a separate full-text Q&A record.',
    '- `notes/SCI-Reader-Reading-Content.html`：独立备份高亮备注、引用原句和已确认译文；': '- `notes/SCI-Reader-Reading-Content.html`: a separate backup of highlight notes, original quotations and confirmed translations.',
    '- `metadata.json`：论文和导出信息。': '- `metadata.json`: article and export metadata.', '## 手工导入': '## Manual import',
    '1. 在 Zotero 中先用浏览器 Connector 保存原论文，或新建网页条目。': '1. Save the original article using the Zotero browser Connector, or create a webpage item.',
    '2. 将 `snapshot.html` 拖到该条目上作为附件。': '2. Drag `snapshot.html` onto that item as an attachment.',
    '3. 分别打开 `notes` 下的 HTML，复制正文并在 Zotero 条目下新建对应子笔记。': '3. Open each HTML file in `notes`, copy its content, and create the corresponding child note under the Zotero item.',
    '证据类型': 'Evidence type', '实验方法': 'Experimental methods', '统计方法': 'Statistical methods',
    '研究对象 / 表型': 'Study subject / phenotype', '原文证据': 'Original evidence', '本地推断': 'Local inference',
    '正文未提供': 'Not provided in the article', '未填写': 'Not filled in', '原文未明确提供': 'Not explicitly provided in the article',
    '表型名称': 'Phenotype name', '未明确': 'Not specified', '分组设计': 'Group design', '图像观察': 'Image observation',
    '未核验图像；旧记录或推断': 'Image not verified; legacy record or inference', '实验结论': 'Experimental conclusion',
    '图像核验': 'Image verified', '原文结果': 'Reported result', '正文/图注': 'Article text / caption',
    '已核验图像': 'Verified image', '原文报告；未核验图像': 'Reported in the article; image not verified',
    '已提供图像': 'Image provided', '据图注描述，未独立核验图像': 'Described in the caption; image not independently verified',
    '据正文描述，未独立核验图像': 'Described in the article; image not independently verified',
    '多来源，图像是否核验请结合解读依据': 'Multiple sources; consult the analysis basis to determine whether the image was verified',
    '设计/组别': 'Design / groups', '比较/对照': 'Comparison / control'
  });

  function translateExportBuiltin(value, language) {
    return String(language || '').toLowerCase().startsWith('en') && Object.hasOwn(EN, value) ? EN[value] : value;
  }
  function formatExportBuiltin(parts, values, language) {
    const key = parts.map((part, index) => part + (index < values.length ? `{${index}}` : '')).join('');
    const template = translateExportBuiltin(key, language);
    // Replacement is one pass, so braces inside user text are never interpreted.
    return template.replace(/\{(\d+)\}/g, (match, index) => Number(index) < values.length ? String(values[Number(index)]) : match);
  }

  function buildEnglishPptAgentPrompt(bundle, customization) {
    const c = customization, figures = Array.isArray(bundle.figures) ? bundle.figures : [];
    return [
      '# Formal Journal Club PowerPoint task (for Codex or another AI Agent)', '',
      'Organize slides by evidence block. Map the research question, control and panels to one supported claim. Keep representative images and quantification for a block together. Split only if projection makes labels unreadable. Repeat the block ID and essential control on continuation slides. Fit source panels inside their frames at the original aspect ratio and allow whitespace. Compare all four edges with the source to keep the letters, axes and legends visible. Speaker notes for each slide should explain which panel to look at first, how to read its comparison and how it leads to the next slide.',
      `Article title: ${bundle.title || 'Not provided'}`, `Article URL: ${bundle.url || 'Not provided'}`, '',
      'This is a verifiable materials package exported by Brevess. Create an editable PowerPoint suitable for a formal Journal Club, using original paper Panels as the main visual evidence. Do not simply pack paper text into slides.',
      `Present in ${c.language}, designed for ${c.durationMinutes} minutes. Let evidence density determine the slide count, normally ${c.slideCount} slides. Explicit user requirements for duration, language, template or slide count take precedence.`, '',
      '## User requirements', '', `- Presentation language: ${c.language}`, `- Duration: ${c.durationMinutes} minutes`,
      `- Target slide count: ${c.slideCount}`, `- Audience: ${c.audience}`, `- Template and layout: ${c.template || 'Use the default layout below'}`,
      `- Figures or questions to emphasize: ${c.focusFigures || 'Follow the full-paper evidence chain'}`,
      `- Narration audio: ${c.narration ? 'Requested; generate and verify synchronization if the environment supports it' : 'Not requested'}`,
      c.extraInstructions ? `- Additional requirements:\n${c.extraInstructions}` : '- Additional requirements: None', '',
      '## Required reading before starting', '',
      '1. `manifest.json`: verify article metadata, the Figure inventory and missing images.',
      '2. `analysis/article-context.json`: establish the background, knowledge gap, study design and the authors’ wording in the article.',
      '3. `analysis/cross-figure-logic.json` and `.md`: establish the progression of evidence and connections between Figures.',
      '4. Every `analysis/figures/*.json` and `.md`: understand each Figure, Panel, control, readout and conclusion boundary.',
      '5. All original high-resolution images in `figures/`: use direct visual inspection and original captions as the final reference.',
      'AI figure analyses in this package are navigation aids and candidate explanations. They do not replace checking the original images, captions and article. When they conflict, use the original evidence and document the discrepancy in the review report.', '',
      '## 0. Establish whether the executing Agent can understand images', '',
      'Image understanding means actually opening and observing the original Figure and identifying Panel labels, boundaries, axes, legends, scale bars, groups and neighboring regions. Reading filenames, OCR or image dimensions alone does not qualify. Explicitly select one of these modes before production:', '',
      '### A. Image understanding available: produce a complete presentation', '',
      '- Open each original high-resolution image in `figures/` and verify real Panel boundaries against captions and article text. Produce the full deck with actual Panels using the cropping, layout and acceptance rules below. Never guess crop bounds from `panelHints`, OCR or AI analyses alone.',
      '- Compare every crop beside the original Figure. Its Panel letter must be complete and appear once. Remove all neighboring Panel letters, image fragments, axes, legend fragments, color bars, dashed boxes and cut-off text; retain this Panel’s own labels, scale bar, legend, axis titles and group names.',
      '- For complex layouts, make a coordinate-grid preview or boundary sketch before deciding crops. Do not overlay a second Panel letter if the crop already contains it.', '',
      '### B. No image understanding: produce a Panel-placeholder deck', '',
      '- Use article text, captions, `analysis/` and `panelHints` to plan the story, titles, script, conclusion boundaries and layout. Do not crop images, infer pixel content, redraw data or claim that you inspected the originals.',
      '- Use clear light-gray or thin blue rectangular placeholders wherever paper Panels belong. Center the exact identifier, such as `Fig. 2A` or `Fig. 3B–D`, in large type. Add “Replace with a screenshot from the original Figure” and specify the axes, legends, scale bars, groups or time points that must remain.',
      '- Reserve 65%–85% of slide area for 1–4 placeholders per slide. Never replace experimental data with invented curves, illustrative bar charts, AI images or decorative blank space.',
      '- Name the file with `_PANEL_PLACEHOLDERS.pptx` and list the Figures/Panels to replace on every slide in the review report. It becomes a complete evidence deck only after a user or an Agent with image understanding inserts and checks the originals.',
      'Even an Agent with image understanding must use placeholders for missing, damaged or insufficiently resolved images. Never generate experimental images from captions or analysis text.', '',
      '## 1. Required Journal Club structure', '',
      '1. **Title:** original article title, journal, publication year, presenter and date. No unrelated decorative images.',
      '2. **Authors and research team:** identify co-first and co-corresponding authors, principal affiliations, research areas and contributions. Use only verifiable official journal or institutional portraits. If unavailable, use text; never generate portraits or guess biographical details.',
      '3. **Background:** use 2–4 slides to progress from the field’s problem through established mechanisms/key prior work to the unresolved gap. Include only background necessary to understand this paper, with brief source citations in the footer.',
      '4. **Scientific questions:** state 2–4 testable questions on one slide. Each must map to later experiments; avoid broad topics or presenting the paper’s conclusions as questions.',
      '5. **Experimental strategy overview, if needed:** add one concise overview only when multiple models, tracing methods or circuit levels would otherwise impede understanding. Explain model, manipulation, readout and levels of causal validation.',
      '6. **Results:** about 60%–70% of the deck. Progress through scientific questions and the main-Figure evidence chain using Panel evidence slides. A Figure may span slides for readability, but retain the same `FIGURE 1`, `FIGURE 2`, etc. header. Do not renumber split slides `RESULT 01`, `RESULT 02` or invent numerous “results” based on slide count.',
      '7. **Limitations and discussion:** at least one slide distinguishing supported conclusions, unresolved alternative explanations, model/sample generalization limits and questions still to test.',
      '8. **Summary:** three take-home messages stating what was established, the mechanistic advance and its boundary or significance. Match the strength of conclusions to the evidence shown.',
      '9. **Closing:** a concise acknowledgement or Q&A slide without repeating the full conclusion slide.', '',
      '## 2. Mandatory Panel-first rules for results slides', '',
      '1. Each slide answers one scientific question or advances one evidence step. Prefer a question or bounded result statement as its title, not merely “Figure 3” or “Results”.',
      '2. Original paper Panels must dominate results slides, normally occupying 65%–85% of the page. Use 1–4 logically inseparable Panels; split a crowded slide without separating necessary controls and comparison groups.',
      '3. Crop composite Figures using real Panel labels and boundaries. `panelHints` is an index, not visual verification. Never invent, redraw, splice or alter experimental data.',
      '4. Retain axes, legends, scale bars, statistical symbols, group labels, time points and necessary adjacent explanations. If reliable separation is impossible, retain the whole Figure and mark the target Panel with a thin outline or translucent highlight.',
      '5. Check for both neighboring-Panel residue and incomplete target Panels. Stray letters, image edges, color bars, axes or truncated text are defects; missing letters, axis titles, legend entries or scale bars are also defects. Rework either type.',
      '6. Do not require an overview for every Figure. Add one only if a single evidence slide cannot explain the experimental framework. An overview never replaces Panel evidence slides.',
      '7. Keep visible text to 1–2 key summary sentences or brief labels explaining the comparison and conclusion. Put the purpose, full design, detailed interpretation and evidence limits in speaker notes.',
      '8. Retain controls, negative findings, rescue experiments and necessity/sufficiency evidence. Do not select only Panels favoring the main conclusion or turn association into causation.',
      '9. When Figures need a transition, use a minimal slide with the established conclusion, missing evidence and next question. Cite `analysis/cross-figure-logic.md`; avoid decorative flowcharts.', '',
      '## 3. Visual design and layout', '',
      '1. Use 16:9 slides, white backgrounds, black text and a single blue accent. An optional thin blue rule may run along the top; put page numbers in a corner. Keep title positions, fonts, margins and numbering consistent.',
      '2. Suggested sizes: 32–40 pt titles and 20–28 pt body text. Original Panel annotations must be readable when projected. Do not shrink text or Figures merely to fit more content.',
      '3. Avoid uninformative icons, cards, gradients, colored backgrounds, decorative circles, AI illustrations and unrelated photographs. Do not put heavy borders around every Panel; use thin outlines, arrows or subtle highlighting only to direct attention.',
      '4. Background slides may use a small number of verified mechanistic diagrams or literature figures. Results slides must use this paper’s actual Figures/Panels; AI imagery cannot replace experimental data.',
      '5. Preserve whitespace and a clear reading order: title → Panel evidence → one-sentence conclusion → source.', '',
      '## 4. Speakable notes on every slide', '',
      `Write natural, coherent academic presentation prose in ${c.language}, suitable for reading aloud. It must not be a bullet list or mechanical repetition of slide text. Include short opening and closing remarks on the title and final slides. Sound like a researcher guiding a group through a paper, with transitions, pauses and selective emphasis; vary openings and do not read captions verbatim.`,
      'For results slides, write complete paragraphs following this sequence:', '',
      '1. Connect to the preceding slide and name the precise question this slide addresses.',
      '2. Explain purpose and design: model/sample, manipulation, control, time point, readout and why the design answers the question.',
      '3. Read Panels from left to right and top to bottom: what to inspect, then axes, colors or groups, then the observed difference, direction, statistics or negative result.',
      '4. Give a bounded interpretation distinguishing direct observation, local inference and causality; explain whether alternatives were excluded.',
      '5. Integrate proportionate critical evaluation at the relevant Figure rather than reserving all criticism for the last slide. Where supported, discuss sample size and statistical units, matched controls, physiological relevance of tracers/models, whether static images establish dynamic flux, whether colocalization supports transmembrane transport, association versus causality, whether rescue restores the upstream deficit, and tensions or alternative explanations across findings. Explain the authors’ evidence accurately before discussing limits; never invent objections to appear critical.',
      '6. State the slide’s role in the full evidence chain and naturally introduce the next question.', '',
      /^(?:中文|汉语|Chinese|zh(?:-[A-Za-z]+)?)$/i.test(c.language)
        ? 'For a Chinese presentation, results notes normally contain 180–350 Chinese characters (more for complex experiments); background, transition and summary notes normally contain 100–220.'
        : 'Results notes normally support 60–120 seconds of speech; background, transition and summary notes support 30–60 seconds. Adjust for the selected language and total duration.',
      'Prioritize complete logic over fixed word counts. Do not pad with stock phrases or invent sample sizes, statistics, doses, time points or unreported information.',
      'End each slide’s notes with a separate, unspoken `[Source trace]` paragraph containing the original image path, Figure/Panel identifiers and analysis files used, for example `figures/Figure_03/image_01.png | Fig. 3A–D | analysis/figures/Figure_03.json`.', '',
      '## 5. Optional narration audio and automatic slide timing', '',
      `If requested and supported by the environment, generate one separate ${c.language} audio clip per slide using the spoken script before [Source trace]. Prefer a natural neural voice in ${c.language}. Preserve complete notes and an editable version without audio.`,
      'Audio synchronization requirements:',
      '1. Exactly one narration media object per slide, starting immediately on entry. The PowerPoint animation timeline must use `With Previous` and `TriggerDelayTime = 0`. `PlayOnEntry` alone is insufficient because the effect may remain `On Click`.',
      '2. Set automatic advance from the actual decoded duration after embedding, such as `MediaFormat.Length / 1000`, plus 1.0–1.5 seconds. Do not rely solely on external MP3 container estimates or word counts.',
      '3. Disable mouse-click advance in the automatic narration version to prevent accidental mid-sentence transitions. Keyboard arrow navigation may remain available.',
      '4. Verify every slide’s trigger, zero delay, actual media duration, advance time and media count. Prefer both an editable narrated `.pptx` and a double-click-to-play `.ppsx`.', '',
      '## 6. Writing limitations and discussion', '',
      'Avoid generic caveats. Choose 3–5 dimensions relevant to the actual evidence: model and stimulation paradigm, sample/cell type, association versus causality, parallel pathways or alternative mechanisms, specificity of behavioral readouts, acute manipulation versus chronic disease, and limits of translating animal results to clinical or human mechanisms.',
      'For each, explain “what current evidence supports → what remains unanswered → an experiment that could test it”. Finish with a robust conclusion; limitations should not become a blanket dismissal of the paper.', '',
      '## 7. Production workflow', '',
      '1. Declare complete visual mode or Panel-placeholder mode. For visual mode, create `work/panel-crops/` and export crops with their coordinates first. For placeholder mode, prepare a slide-by-slide Panel replacement inventory.',
      '2. Write `work/slide-plan.md` first: slide role, scientific question, Panels, main Figure, top-right section label, one-sentence conclusion, links to preceding/following slides and estimated speaking time.',
      '3. Build the deck in this order: background → gap → scientific questions → progressive Panel evidence → limitations → three take-home messages.',
      '4. Finish all speaker notes before visual refinement so extra prose does not compromise Panel readability.',
      '5. Render slides as images or thumbnails and inspect every slide. In visual mode, verify Figures, axes and groups at least at 50% zoom and inspect all crop boundaries at high resolution. In placeholder mode, verify that each Figure/Panel identifier exactly matches the slide plan.', '',
      '## 8. Figure inventory', '',
      ...figures.map((figure, index) => `${index + 1}. ${figure.figureLabel || figure.figureId}; Panels: ${(figure.panelHints || []).join(', ') || 'Not labeled'}; Images: ${(figure.imageFiles || []).join(', ') || 'Not packaged'}`), '',
      '## 9. Deliverables', '',
      '- An editable `.pptx` with actual Panels in visual mode, or an explicitly named `_PANEL_PLACEHOLDERS.pptx` in nonvisual mode.',
      '- Visual mode: crops in `work/panel-crops/`. Placeholder mode: a slide-by-slide Panel replacement list.',
      '- Visual mode: `work/crop-manifest.json` with original image, Panel, coordinates and output file. Placeholder mode: `work/panel-placeholder-manifest.json` with slide number, box position, required Panel and information to retain.',
      '- `work/slide-plan.md` with every slide’s role, title, question, evidence task, main Figure, Panels, section label, conclusion, transitions and estimated timing.',
      '- A final review report listing unreliable crops, missing information, insufficient evidence and slides still needing human verification.',
      '- A PDF preview matching the final deck, when supported.',
      '- If narrated, synchronized and verified narrated `.pptx` and `.ppsx` files, plus the editable version without audio.', '',
      '## 10. Mandatory acceptance checks', '',
      '- Reliable sources support authors, affiliations, co-first/co-corresponding status and contributions. Omit missing information rather than guess.',
      '- Background leads to the knowledge gap; scientific questions map one-to-one to later result groups.',
      '- Actual Panels dominate results slides, without decorative visuals or long text blocks.',
      '- Panel labels, axes, legends, groups, scale bars, statistical symbols and conclusion directions agree with the original paper.',
      '- Results follow article questions and `FIGURE 1`, `FIGURE 2`, etc.; splitting Figures does not create numerous artificial `RESULT` groups.',
      '- Visual mode has no neighboring-Panel residue, duplicate letters or clipped target letters/axes/legends. Every nonvisual placeholder clearly identifies the required `Fig. 2A` or other exact Panel.',
      '- Each slide has one main message and the sequence forms a continuous evidence chain.',
      '- Limitations are specific and grounded in this paper’s evidence, consistent with the strength of the summary.',
      '- Every slide has natural, speakable notes. Results notes cover design, Panel reading, findings, relevant critical evaluation, boundaries and transitions.',
      '- No text overflow, image overlap, low resolution, unreadably small text or incorrect crops.',
      '- Every slide is traceable through `[Source trace]`; visual-mode crops are also traceable through `crop-manifest.json`.',
      '- If narrated, all 32 slides or the actual full slide count start audio immediately on entry and advance after actual media duration plus buffer. No prolonged silence, interrupted narration or mismatch between audio and slide counts.', ''
    ].join('\n');
  }
  return { translateExportBuiltin, formatExportBuiltin, buildEnglishPptAgentPrompt };
});


;/* native/core/chat-table-viewer.js */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object') module.exports = api;
  root.BrevessTableViewer = api;
})(globalThis, function () {
  'use strict';
  const PREFIX = 'brevess.tableView.';
  const tags = new Set(['strong', 'em', 'code', 'sup', 'sub', 'br', 'a']);
  function safeLink(value) {
    try { const u = new URL(value); return /^https?:$/.test(u.protocol) && !u.username && !u.password ? u.href : ''; } catch { return ''; }
  }
  // Transfer structured inline content, never executable model HTML or event handlers.
  function inline(node) {
    if (node.nodeType === 3) return { text: node.textContent };
    const tag = node.tagName?.toLowerCase();
    if (['script', 'style', 'iframe', 'object', 'img'].includes(tag)) return { text: '' };
    const children = Array.from(node.childNodes || [], inline);
    return { tag: tags.has(tag) ? tag : 'span', href: tag === 'a' ? safeLink(node.href) : '', children };
  }
  function capture(table, title = '') {
    const rows = Array.from(table.rows, row => Array.from(row.cells, cell => ({
      header: cell.tagName === 'TH', align: ['left', 'center', 'right'].includes(cell.style.textAlign) ? cell.style.textAlign : 'left',
      content: inline(cell), text: cell.textContent
    })));
    const value = { title: String(title).slice(0, 500), rows, createdAt: Date.now() };
    if (rows.length > 2000 || rows.some(r => r.length > 100) || JSON.stringify(value).length > 1000000) throw Error('表格过大，请分段查看。');
    return value;
  }
  function render(doc, value) {
    const table = doc.createElement('table'), head = doc.createElement('thead'), body = doc.createElement('tbody');
    function append(parent, part) {
      if (typeof part?.text === 'string') { parent.append(doc.createTextNode(part.text)); return; }
      const tag = tags.has(part?.tag) ? part.tag : 'span', n = doc.createElement(tag);
      if (tag === 'a' && safeLink(part.href)) { n.href = safeLink(part.href); n.target = '_blank'; n.rel = 'noopener noreferrer'; }
      for (const child of part?.children || []) append(n, child);
      parent.append(n);
    }
    for (const [i, row] of value.rows.entries()) {
      const tr = doc.createElement('tr');
      for (const cell of row) { const td = doc.createElement(cell.header ? 'th' : 'td'); if (cell.header) td.scope = 'col'; td.style.textAlign = cell.align; append(td, cell.content); tr.append(td); }
      (i === 0 && row.every(c => c.header) ? head : body).append(tr);
    }
    table.append(head, body); return table;
  }
  async function open(table, { chromeApi = globalThis.chrome, screen = globalThis.screen, title } = {}) {
    const value = capture(table, title || document.querySelector('#sidePanelPaperTitle')?.textContent || '回答中的表格');
    const key = PREFIX + crypto.randomUUID();
    await chromeApi.storage.session.set({ [key]: value });
    try {
      await chromeApi.windows.create({ url: chromeApi.runtime.getURL('table-viewer.html') + '#' + key.slice(PREFIX.length), type: 'popup',
        width: Math.min(1280, screen?.availWidth || 1280), height: Math.min(820, screen?.availHeight || 820), focused: true });
    } catch (error) { await chromeApi.storage.session.remove(key); throw error; }
  }
  return { PREFIX, safeLink, inline, capture, render, open };
});


;/* native/core/chat-diagram-viewer.js */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object') module.exports = api;
  root.BrevessDiagramViewer = api;
})(globalThis, function () {
  'use strict';
  const PREFIX = 'brevess.diagramView.';
  function validateSource(source) {
    if (typeof source !== 'string' || !source.trim() || source.length > 20000 || /%%\s*\{|^\s*---/m.test(source)) {
      throw Error('示意图内容无效，请从问答中重新打开。');
    }
    return source;
  }
  function capture(source, title = '') {
    return { source: validateSource(source), title: String(title).slice(0, 500), createdAt: Date.now() };
  }
  async function open(source, { chromeApi = globalThis.chrome, screen = globalThis.screen, title = '回答中的示意图' } = {}) {
    const key = PREFIX + crypto.randomUUID();
    await chromeApi.storage.session.set({ [key]: capture(source, title) });
    try {
      // Explicit bounds also work on macOS, where maximized popup creation can yield a zero-width window.
      await chromeApi.windows.create({ url: chromeApi.runtime.getURL('diagram-viewer.html') + '#' + key.slice(PREFIX.length), type: 'popup',
        width: Math.min(1440, screen?.availWidth || 1440), height: Math.min(940, screen?.availHeight || 940), focused: true });
    } catch (error) { await chromeApi.storage.session.remove(key); throw error; }
  }
  async function consume(id, { storage = globalThis.chrome.storage.session, now = Date.now() } = {}) {
    if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/.test(id)) throw Error('请从问答示意图旁的「展开查看」重新打开。');
    const key = PREFIX + id, value = (await storage.get(key))[key];
    await storage.remove(key);
    if (!value || !Number.isFinite(value.createdAt) || now - value.createdAt > 10 * 60 * 1000 || value.createdAt > now + 1000) throw Error('此示意图快照已过期，请从问答中重新打开。');
    return { source: validateSource(value.source), title: String(value.title || '回答中的示意图').slice(0, 500) };
  }
  function pngDimensions(width, height) {
    if (![width, height].every(value => Number.isFinite(value) && value > 0)) throw Error('示意图尚未就绪。');
    const scale = Math.min(2, 8192 / width, 8192 / height, Math.sqrt(16000000 / (width * height)));
    return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
  }
  async function renderPng(svg) {
    const box = svg?.viewBox?.baseVal;
    const size = pngDimensions(box?.width, box?.height);
    const doc = svg.ownerDocument, win = doc.defaultView;
    await doc.fonts?.ready;
    // Export the complete SVG, excluding the viewport's zoom and pan transform.
    const copy = svg.cloneNode(true);
    copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    copy.setAttribute('width', String(size.width)); copy.setAttribute('height', String(size.height));
    copy.style.width = size.width + 'px'; copy.style.height = size.height + 'px'; copy.style.maxWidth = 'none';
    // Mermaid can include SVG foreignObject labels. A self-contained data image
    // keeps those labels exportable in Chromium; a blob URL taints the canvas.
    const image = new win.Image();
    image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new win.XMLSerializer().serializeToString(copy));
    await image.decode();
    const canvas = doc.createElement('canvas'); canvas.width = size.width; canvas.height = size.height;
    const context = canvas.getContext('2d');
    if (!context) throw Error('无法创建图片。');
    context.fillStyle = '#fff'; context.fillRect(0, 0, size.width, size.height);
    context.drawImage(image, 0, 0, size.width, size.height);
    return await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(Error('图片生成失败。')), 'image/png'));
  }
  async function copyPng(svg, { clipboard = globalThis.navigator?.clipboard, ClipboardItem = globalThis.ClipboardItem, toPng = renderPng } = {}) {
    if (!clipboard?.write || !ClipboardItem) throw Error('当前浏览器不支持复制图片。');
    const png = toPng(svg);
    // Start clipboard.write during the click gesture, before asynchronous SVG decoding.
    png.catch(() => {});
    await clipboard.write([new ClipboardItem({ 'image/png': png })]);
  }
function create(source, options = {}) {
    const doc = options.document || globalThis.document;
    const createWorkspaceElement = options.createElement || ((tag, cls = '', text = '') => {
        const node = doc.createElement(tag); node.className = cls; node.textContent = text; return node;
    });
    const render = options.render || ((node) => globalThis.SciLLM?.renderMechanismDiagramInMeasurableHost(node, { mermaid: globalThis.mermaid }));
    const wrapper = createWorkspaceElement('section', 'article-chat-mermaid-block');
    const toolbar = createWorkspaceElement('div', 'article-chat-mermaid-toolbar');
    toolbar.setAttribute('role', 'toolbar');
    toolbar.setAttribute('aria-label', '示意图视野');
    const viewport = createWorkspaceElement('div', 'article-chat-mermaid-viewport');
    viewport.tabIndex = 0;
    viewport.setAttribute('role', 'region');
    viewport.setAttribute('aria-label', '回答中的示意图；滚轮缩放，拖动平移，方向键移动，加减键缩放，Home适应视野');
    viewport.title = '滚轮缩放 · 拖动平移 · Home 适应视野';
    const diagram = createWorkspaceElement('div', 'article-chat-mermaid');
    diagram.textContent = source;
    const disclosure = createWorkspaceElement('details', 'article-chat-mermaid-source');
    const pre = createWorkspaceElement('pre');
    const code = createWorkspaceElement('code');
    code.textContent = source;
    pre.appendChild(code);
    disclosure.append(createWorkspaceElement('summary', '', '图形源码'), pre);
    const zoomLabel = createWorkspaceElement('output', 'article-chat-mermaid-zoom', '100%');
    zoomLabel.setAttribute('aria-label', '缩放比例');
    let svg = null, naturalWidth = 1, naturalHeight = 1, scale = 1, x = 0, y = 0, frame = 0, drag = null;
    function paint() {
        frame = 0;
        if (!svg) return;
        diagram.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + scale + ')';
        zoomLabel.value = Math.round(scale * 100) + '%';
        zoomLabel.textContent = zoomLabel.value;
    }
    function schedulePaint() { if (!frame) frame = requestAnimationFrame(paint); }
    function zoom(next, atX = viewport.clientWidth / 2, atY = viewport.clientHeight / 2) {
        if (!svg) return;
        next = Math.max(.02, Math.min(6, next));
        x = atX - (atX - x) * next / scale;
        y = atY - (atY - y) * next / scale;
        scale = next;
        schedulePaint();
    }
    function reset(fit) {
        if (!svg) return;
        const width = Math.max(32, viewport.clientWidth - 24), height = Math.max(32, viewport.clientHeight - 24);
        scale = fit ? Math.max(.02, Math.min(1, width / naturalWidth, height / naturalHeight)) : 1;
        x = naturalWidth * scale <= width ? (viewport.clientWidth - naturalWidth * scale) / 2 : 12;
        y = naturalHeight * scale <= height ? (viewport.clientHeight - naturalHeight * scale) / 2 : 12;
        schedulePaint();
    }
    function button(text, label, action) {
        const control = createWorkspaceElement('button', '', text);
        control.type = 'button'; control.title = label; control.setAttribute('aria-label', label);
        control.disabled = true; control.addEventListener('click', action); return control;
    }
    toolbar.append(button('−', '缩小示意图', () => zoom(scale / 1.25)), zoomLabel,
        button('+', '放大示意图', () => zoom(scale * 1.25)),
        button('适应', '适应视野', () => reset(true)),
        button('1:1', '原始大小', () => reset(false)));
    const copyImage = button('复制图片', '复制示意图为图片', async () => {
        copyImage.disabled = true;
        status.textContent = '正在复制图片…';
        try { await copyPng(svg); status.textContent = '已复制图片，可直接粘贴。'; }
        catch (error) {
            console.warn('[BREVESS] Diagram image copy failed:', error);
            status.textContent = '复制图片失败，请在当前窗口中重试。';
        }
        finally { copyImage.disabled = false; }
    });
    copyImage.className = 'article-chat-mermaid-copy';
    copyImage.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 4H4v16h13v-3"/><rect x="8" y="3" width="13" height="14" rx="2"/><circle cx="12" cy="7" r="1"/><path d="m9 14 4-4 3 3 2-2 3 3"/></svg>';
    toolbar.append(copyImage);
    if (options.expand !== false) {
        const expand = button('展开', '展开查看示意图', async () => {
            expand.disabled = true;
            try { await (options.open || open)(source, { title: doc.querySelector('#sidePanelPaperTitle')?.textContent || '回答中的示意图' }); }
            catch { status.textContent = '暂时无法打开大窗，请重试。'; }
            finally { expand.disabled = false; }
        });
        expand.className = 'article-chat-mermaid-expand';
        expand.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M9 9L3 3m12 6l6-6M9 15l-6 6m12-6l6 6"/></svg>';
        toolbar.append(expand);
    }
    const status = createWorkspaceElement('p', 'article-chat-mermaid-status');
    status.setAttribute('role', 'status');
    viewport.appendChild(diagram); wrapper.append(toolbar, viewport, status, disclosure);
    viewport.addEventListener('wheel', event => {
        if (!svg) return;
        event.preventDefault(); event.stopPropagation();
        const rect = viewport.getBoundingClientRect();
        const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1);
        zoom(scale * Math.exp(-Math.max(-500, Math.min(500, delta)) * .002), event.clientX - rect.left, event.clientY - rect.top);
    }, { passive: false });
    viewport.addEventListener('pointerdown', event => {
        if (!svg || event.button !== 0 || event.isPrimary === false) return;
        event.preventDefault(); viewport.focus({ preventScroll: true });
        drag = { id: event.pointerId, clientX: event.clientX, clientY: event.clientY, x, y };
        viewport.setPointerCapture(event.pointerId); viewport.classList.add('is-dragging');
    });
    viewport.addEventListener('pointermove', event => {
        if (!drag || event.pointerId !== drag.id) return;
        x = drag.x + event.clientX - drag.clientX; y = drag.y + event.clientY - drag.clientY; schedulePaint();
    });
    function endDrag(event) {
        if (!drag || event.pointerId !== drag.id) return;
        drag = null; viewport.classList.remove('is-dragging');
        if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
    }
    viewport.addEventListener('pointerup', endDrag); viewport.addEventListener('pointercancel', endDrag);
    viewport.addEventListener('lostpointercapture', endDrag);
    viewport.addEventListener('keydown', event => {
        if (!svg || event.altKey || event.ctrlKey || event.metaKey) return;
        if (event.key === '+' || event.key === '=') zoom(scale * 1.25);
        else if (event.key === '-') zoom(scale / 1.25);
        else if (event.key === 'Home') reset(true);
        else if (event.key === '0') reset(false);
        else if (event.key === 'ArrowLeft') { x += 40; schedulePaint(); }
        else if (event.key === 'ArrowRight') { x -= 40; schedulePaint(); }
        else if (event.key === 'ArrowUp') { y += 40; schedulePaint(); }
        else if (event.key === 'ArrowDown') { y -= 40; schedulePaint(); }
        else return;
        event.preventDefault(); event.stopPropagation();
    });
    // Keep the bundled strict renderer and unmodified source; never apply model configuration.
    wrapper.ready = Promise.resolve().then(async () => {
        validateSource(source);
        const rendered = await render(diagram);
        if (!rendered || diagram.querySelector('.error-icon, .error-text')) throw new Error('INVALID_DIAGRAM');
        if (!diagram.isConnected) return;
        diagram.querySelectorAll('a').forEach(link => {
            link.removeAttribute('href'); link.removeAttribute('xlink:href');
        });
        svg = diagram.querySelector('svg');
        const box = svg?.viewBox?.baseVal;
        if (!box || !(box.width > 0 && box.height > 0)) throw new Error('INVALID_DIAGRAM');
        naturalWidth = box.width; naturalHeight = box.height;
        svg.style.width = naturalWidth + 'px'; svg.style.height = naturalHeight + 'px'; svg.style.maxWidth = 'none';
        diagram.style.width = naturalWidth + 'px'; diagram.style.height = naturalHeight + 'px';
        toolbar.querySelectorAll('button').forEach(control => { control.disabled = false; });
        reset(options.fit === true);
        return true;
    }).catch(() => {
        if (frame) cancelAnimationFrame(frame);
        toolbar.remove(); viewport.remove();
        disclosure.open = true;
        wrapper.prepend(createWorkspaceElement('p', 'article-chat-mermaid-error', '示意图暂无法渲染，已保留原始代码。'));
        return false;
    });
    wrapper.fit = () => reset(true);
    return wrapper;
}

  return { PREFIX, validateSource, capture, open, consume, pngDimensions, renderPng, copyPng, create };
});


;/* native/core/chat-message-ui.js */
/* Shared with article QA. DOM-only Markdown; optional citation/diagram hooks keep their original owner. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.BrevessChatMessageUI=api;})(globalThis,()=>{
'use strict';
function createRenderer({document=globalThis.document,createElement,createCitation,createMermaid}={}){
 const createWorkspaceElement=createElement||((tag,className='',text='')=>{const node=document.createElement(tag);node.className=className;node.textContent=text;return node;});
 const createArticleChatInlineCitation=createCitation||(()=>document.createTextNode(''));
 const createArticleChatMermaid=createMermaid||(source=>{const pre=createWorkspaceElement('pre'),code=createWorkspaceElement('code','',source);code.dataset.language='mermaid';pre.append(code);return pre;});
function normalizeArticleChatMarkdownLinkUrl(value) {
    const rawUrl = String(value || '').trim();
    if (!rawUrl || rawUrl.length > 2048) return '';
    let parsed;
    try {
        parsed = new URL(rawUrl);
    } catch (_) {
        return '';
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password ||
        isUnsafeArticleChatWebHostname(parsed.hostname)) return '';
    return parsed.href.length <= 2048 ? parsed.href : '';
}

function createArticleChatMarkdownLink(label, value) {
    const url = normalizeArticleChatMarkdownLinkUrl(value);
    if (!url) return null;
    const link = createWorkspaceElement('a', 'article-chat-markdown-link', label || url);
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.referrerPolicy = 'no-referrer';
    link.dataset.sourceTrust = 'unverified';
    link.title = '在新标签页打开外部链接（来源未验证）';
    return link;
}

function articleChatMarkdownExplicitLinkAt(text, start) {
    if (text[start] !== '[' || text[start + 1] === '[') return null;
    let labelEnd = -1;
    for (let index = start + 1; index < text.length && text[index] !== '\n'; index += 1) {
        if (text[index] === '\\') {
            index += 1;
            continue;
        }
        if (text[index] === ']' && text[index + 1] === '(') {
            labelEnd = index;
            break;
        }
    }
    if (labelEnd < 0) return null;
    const destinationStart = labelEnd + 2;
    let parenthesisDepth = 0;
    for (let index = destinationStart; index < text.length && text[index] !== '\n'; index += 1) {
        const character = text[index];
        if (/\s/u.test(character)) return null;
        if (character === '\\') {
            index += 1;
            continue;
        }
        if (character === '(') {
            parenthesisDepth += 1;
        } else if (character === ')') {
            if (parenthesisDepth > 0) {
                parenthesisDepth -= 1;
                continue;
            }
            const label = text.slice(start + 1, labelEnd)
                .replace(/\\([\\[\]()])/g, '$1');
            const url = text.slice(destinationStart, index)
                .replace(/\\([\\()])/g, '$1');
            if (!label || !url) return null;
            return { kind: 'link', label, url, length: index - start + 1 };
        }
    }
    return null;
}

function articleChatMarkdownBareUrlAt(text, start) {
    const prefix = text.slice(start, start + 8);
    if (!/^https?:\/\//i.test(prefix)) return null;
    let end = start;
    while (end < text.length && !/[\s<>"'`]/u.test(text[end])) end += 1;
    let candidate = text.slice(start, end);
    while (/[.,;:!?。；，！？：]$/u.test(candidate)) candidate = candidate.slice(0, -1);
    for (const [opening, closing] of [['(', ')'], ['[', ']'], ['{', '}']]) {
        while (candidate.endsWith(closing) &&
            candidate.split(closing).length > candidate.split(opening).length) {
            candidate = candidate.slice(0, -1);
        }
    }
    return candidate ? { kind: 'link', label: candidate, url: candidate, length: candidate.length } : null;
}

function articleChatInlineMarkdownTokenAt(text, start) {
    const lineBreak = text.slice(start).match(/^<br\s*\/?>/i);
    if (lineBreak) return { kind: 'br', length: lineBreak[0].length };
    const citation = text.slice(start).match(/^\[\[(\d{1,3})\]\]/);
    if (citation) return { kind: 'citation', marker: citation[1], length: citation[0].length };
    const explicitLink = articleChatMarkdownExplicitLinkAt(text, start);
    if (explicitLink) return explicitLink;
    const autoLink = text.slice(start).match(/^<(https?:\/\/[^\s<>]+)>/i);
    if (autoLink) return {
        kind: 'link', label: autoLink[1], url: autoLink[1], length: autoLink[0].length
    };
    const scriptToken = text.slice(start).match(
        /^(?:<sup>[^<\n]+<\/sup>|<sub>[^<\n]+<\/sub>)/i
    );
    const scriptMatch = scriptToken?.[0].match(/^<(sup|sub)>([^<\n]+)<\/\1>$/i);
    if (scriptMatch) return {
        kind: 'script', tagName: scriptMatch[1].toLowerCase(), text: scriptMatch[2],
        length: scriptMatch[0].length
    };
    const delimiters = [
        ['`', 'code'], ['**', 'strong'], ['__', 'strong'], ['*', 'em'], ['_', 'em']
    ];
    for (const [delimiter, kind] of delimiters) {
        if (!text.startsWith(delimiter, start)) continue;
        const end = text.indexOf(delimiter, start + delimiter.length);
        if (end > start + delimiter.length && !text.slice(start, end).includes('\n')) {
            return {
                kind,
                text: text.slice(start + delimiter.length, end),
                length: end + delimiter.length - start
            };
        }
    }
    return articleChatMarkdownBareUrlAt(text, start);
}

function appendArticleChatInlineMarkdown(parent, value, context = {}) {
    const text = String(value || '');
    let cursor = 0;
    let plainTextStart = 0;
    while (cursor < text.length) {
        const token = articleChatInlineMarkdownTokenAt(text, cursor);
        if (!token) {
            cursor += 1;
            continue;
        }
        if (cursor > plainTextStart) {
            parent.appendChild(document.createTextNode(text.slice(plainTextStart, cursor)));
        }
        if (token.kind === 'citation') {
            const marker = token.marker;
            const evidenceIndex = (Array.isArray(context.evidence) ? context.evidence : [])
                .findIndex(item => String(item?.marker || '') === marker);
            const evidenceItem = evidenceIndex >= 0 ? context.evidence[evidenceIndex] : null;
            if (evidenceItem) {
                parent.appendChild(createArticleChatInlineCitation(
                    evidenceItem,
                    evidenceIndex,
                    context.snapshot,
                    Math.max(0, Number(context.citationNumberOffset) || 0) + evidenceIndex + 1
                ));
                context.citationIndexes?.add(evidenceIndex);
            } else {
                parent.appendChild(document.createTextNode(text.slice(cursor, cursor + token.length)));
            }
        } else if (token.kind === 'link') {
            parent.appendChild(createArticleChatMarkdownLink(token.label, token.url) ||
                document.createTextNode(text.slice(cursor, cursor + token.length)));
        } else if (token.kind === 'script') {
            const scriptMatch = ['', token.tagName, token.text];
            parent.appendChild(createWorkspaceElement(
                scriptMatch[1], '', scriptMatch[2]
            ));
        } else if (['strong', 'em'].includes(token.kind) &&
            (Number(context.inlineDepth) || 0) < 8) {
            const formatted = createWorkspaceElement(token.kind);
            appendArticleChatInlineMarkdown(formatted, token.text, {
                ...context, inlineDepth: (Number(context.inlineDepth) || 0) + 1
            });
            parent.appendChild(formatted);
        } else {
            parent.appendChild(createWorkspaceElement(token.kind, '', token.text));
        }
        cursor += token.length;
        plainTextStart = cursor;
    }
    if (plainTextStart < text.length) {
        parent.appendChild(document.createTextNode(text.slice(plainTextStart)));
    }
}

function normalizeArticleChatMarkdown(value) {
    let fence = null;
    return String(value || '').replace(/\r\n?/g, '\n').split('\n').map(line => {
        const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
        if (marker) {
            if (!fence) fence = marker[1];
            else if (marker[1][0] === fence[0] && marker[1].length >= fence.length &&
                line.slice(marker[0].length).trim() === '') fence = null;
            return line;
        }
        // List repair is for prose only: never change table structure or literal code.
        if (fence || line.includes('|') || line.includes('`') || /^(?: {4}|\t)/.test(line)) return line;
        return line.replace(/([。！？；;：:）)])[\t ]*(\d{1,2}[.)]\s+(?=\*\*|__|[\u3400-\u9fffA-Za-z]))/g, '$1\n\n$2');
    }).join('\n').trim();
}

function isArticleChatMarkdownBlockStart(line) {
    return /^(?:#{1,4}\s+|>\s?|```|[-*+]\s+|\d+[.)]\s+)/.test(line) ||
        /^\|?.+\|.+\|?$/u.test(line);
}

function parseArticleChatMarkdownTableRow(value) {
    let line = String(value || '').trim();
    if (!line.includes('|')) return null;
    if (line.startsWith('|')) line = line.slice(1);
    if (line.endsWith('|') && !line.endsWith('\\|')) line = line.slice(0, -1);
    const cells = [];
    let cell = '';
    let code = false;
    for (let index = 0; index < line.length; index += 1) {
        const character = line[index];
        if (character === '\\' && index + 1 < line.length) {
            const escaped = line[index + 1];
            if (['|', '\\', '`'].includes(escaped)) {
                cell += escaped;
                index += 1;
                continue;
            }
        }
        if (character === '`') code = !code;
        if (character === '|' && !code) {
            cells.push(cell.trim());
            cell = '';
        } else {
            cell += character;
        }
    }
    cells.push(cell.trim());
    return cells.length >= 2 ? cells : null;
}

function articleChatMarkdownTableAlignments(cells) {
    if (!Array.isArray(cells) || cells.length < 2) return null;
    const alignments = [];
    for (const value of cells) {
        const cell = String(value || '').trim();
        if (!/^:?-{3,}:?$/u.test(cell)) return null;
        alignments.push(cell.startsWith(':') && cell.endsWith(':')
            ? 'center' : cell.endsWith(':') ? 'right' : 'left');
    }
    return alignments;
}

function createArticleChatMarkdownTable(headerCells, alignments, bodyRows, context) {
    const wrapper = createWorkspaceElement('div', 'article-chat-markdown-table-wrap');
    wrapper.setAttribute('role', 'region');
    wrapper.setAttribute('aria-label', '回答中的表格');
    wrapper.tabIndex = 0;
    const table = createWorkspaceElement('table', 'article-chat-markdown-table');
    const head = document.createElement('thead');
    const headerRow = document.createElement('tr');
    headerCells.forEach((value, index) => {
        const cell = document.createElement('th');
        cell.scope = 'col';
        cell.style.textAlign = alignments[index];
        appendArticleChatInlineMarkdown(cell, value, context);
        headerRow.appendChild(cell);
    });
    head.appendChild(headerRow);
    const body = document.createElement('tbody');
    bodyRows.forEach(row => {
        const tableRow = document.createElement('tr');
        headerCells.forEach((_, index) => {
            const cell = document.createElement('td');
            cell.style.textAlign = alignments[index];
            appendArticleChatInlineMarkdown(cell, row[index] || '', context);
            tableRow.appendChild(cell);
        });
        body.appendChild(tableRow);
    });
    table.append(head, body);
    wrapper.appendChild(table);
    if (globalThis.BrevessTableViewer?.open) {
        const block = createWorkspaceElement('section', 'article-chat-table-block');
        const tools = createWorkspaceElement('div', 'article-chat-table-tools');
        const label = createWorkspaceElement('span', '', `${bodyRows.length} 行 · ${headerCells.length} 列`);
        const expand = createWorkspaceElement('button', 'article-chat-table-expand', '放大查看');
        expand.type = 'button';
        expand.setAttribute('aria-label', '在大窗口查看完整表格');
        expand.title = '打开独立大窗口，保留当前对话位置';
        const status = createWorkspaceElement('span', 'article-chat-table-status'); status.setAttribute('role', 'status');
        expand.addEventListener('click', async () => {
            if (expand.disabled) return;
            expand.disabled = true; status.textContent = '';
            try { await globalThis.BrevessTableViewer.open(table); }
            catch (e) { status.textContent = e.message || '无法打开表格，请重试。'; }
            finally { expand.disabled = false; }
        });
        tools.append(label, expand); block.append(tools, wrapper, status); return block;
    }
    return wrapper;
}

function articleChatOrderedListItemCount(value) {
    return normalizeArticleChatMarkdown(value).split('\n')
        .filter(line => /^\s*\d+[.)]\s+/.test(line)).length;
}

function renderArticleChatMarkdown(value, context = {}) {
    const root = createWorkspaceElement('div', 'article-chat-message-content');
    root.setAttribute('data-i18n-user-content', '');
    const renderContext = { ...context, citationIndexes: new Set() };
    const lines = normalizeArticleChatMarkdown(value).split('\n');
    let index = 0;
    let orderedItemsRendered = 0;
    while (index < lines.length) {
        const line = lines[index].trim();
        if (!line) {
            index += 1;
            continue;
        }
        const fenceMatch = line.match(/^(`{3,}|~{3,})(.*)$/);
        if (fenceMatch) {
            const language = fenceMatch[2].trim();
            const fenceEnd = new RegExp(`^${fenceMatch[1][0]}{${fenceMatch[1].length},}\\s*$`);
            const codeLines = [];
            index += 1;
            while (index < lines.length && !fenceEnd.test(lines[index].trim())) {
                codeLines.push(lines[index]);
                index += 1;
            }
            if (index < lines.length) index += 1;
            if (language.toLowerCase() === 'mermaid') {
                root.appendChild(createArticleChatMermaid(codeLines.join('\n')));
                continue;
            }
            const pre = createWorkspaceElement('pre');
            const code = createWorkspaceElement('code', '', codeLines.join('\n'));
            if (language) code.dataset.language = language;
            pre.appendChild(code);
            root.appendChild(pre);
            continue;
        }
        const tableHeader = parseArticleChatMarkdownTableRow(lines[index]);
        const tableDelimiter = index + 1 < lines.length
            ? parseArticleChatMarkdownTableRow(lines[index + 1]) : null;
        const tableAlignments = articleChatMarkdownTableAlignments(tableDelimiter);
        if (tableHeader && tableAlignments && tableHeader.length === tableAlignments.length) {
            const bodyRows = [];
            index += 2;
            while (index < lines.length && lines[index].trim()) {
                const row = parseArticleChatMarkdownTableRow(lines[index]);
                if (!row) break;
                bodyRows.push(row.slice(0, tableHeader.length));
                index += 1;
            }
            root.appendChild(createArticleChatMarkdownTable(
                tableHeader, tableAlignments, bodyRows, renderContext
            ));
            continue;
        }
        const heading = line.match(/^(#{1,4})\s+(.+)$/);
        if (heading) {
            const element = createWorkspaceElement(`h${Math.min(4, heading[1].length + 2)}`);
            appendArticleChatInlineMarkdown(element, heading[2], renderContext);
            root.appendChild(element);
            index += 1;
            continue;
        }
        const listMatch = line.match(/^([-*+]|\d+[.)])\s+(.+)$/);
        if (listMatch) {
            const ordered = /^\d/.test(listMatch[1]);
            const list = createWorkspaceElement(ordered ? 'ol' : 'ul');
            if (ordered) {
                const explicitStart = Number.parseInt(listMatch[1], 10);
                const continuedStart = Math.max(
                    1,
                    (Number(context.orderedListStart) || 1) + orderedItemsRendered
                );
                const start = Math.max(explicitStart || 1, continuedStart);
                if (start > 1) list.start = start;
            }
            let listItemCount = 0;
            while (index < lines.length) {
                const itemMatch = lines[index].trim().match(/^([-*+]|\d+[.)])\s+(.+)$/);
                if (!itemMatch || /^\d/.test(itemMatch[1]) !== ordered) break;
                const item = createWorkspaceElement('li');
                appendArticleChatInlineMarkdown(item, itemMatch[2], renderContext);
                list.appendChild(item);
                listItemCount += 1;
                index += 1;
            }
            if (ordered) orderedItemsRendered += listItemCount;
            root.appendChild(list);
            continue;
        }
        if (line.startsWith('>')) {
            const quote = createWorkspaceElement('blockquote');
            appendArticleChatInlineMarkdown(quote, line.replace(/^>\s?/, ''), renderContext);
            root.appendChild(quote);
            index += 1;
            continue;
        }
        const paragraphLines = [line];
        index += 1;
        while (index < lines.length && lines[index].trim() &&
            !isArticleChatMarkdownBlockStart(lines[index].trim())) {
            paragraphLines.push(lines[index].trim());
            index += 1;
        }
        const paragraph = createWorkspaceElement('p');
        paragraphLines.forEach((paragraphLine, lineIndex) => {
            if (lineIndex) paragraph.appendChild(document.createElement('br'));
            appendArticleChatInlineMarkdown(paragraph, paragraphLine, renderContext);
        });
        root.appendChild(paragraph);
    }
    root.dataset.inlineCitationCount = String(renderContext.citationIndexes.size);
    root.dataset.inlineCitationIndexes = [...renderContext.citationIndexes].join(',');
    return root;
}

function isUnsafeArticleChatWebHostname(value) {
    const hostname = String(value || '').toLowerCase()
        .replace(/^\[|\]$/g, '').replace(/\.$/, '');
    if (!hostname || hostname === 'localhost' ||
        /(?:^|\.)(?:localhost|local|internal|intranet|home|lan|onion|test|invalid|example)$/.test(hostname)) {
        return true;
    }
    if (hostname.includes(':')) {
        const first = hostname.split(':', 1)[0];
        if (hostname === '::' || hostname === '::1' ||
            hostname.startsWith('::ffff:') ||
            /^(?:fc|fd)[0-9a-f]{0,2}$/i.test(first) ||
            /^fe[89ab][0-9a-f]?$/i.test(first) ||
            /^ff[0-9a-f]{0,2}$/i.test(first) ||
            hostname.startsWith('100:') ||
            hostname === '2001:db8::' || hostname.startsWith('2001:db8:') ||
            hostname.startsWith('2001:0:') || hostname.startsWith('2001:2:') ||
            hostname.startsWith('2002:') || hostname.startsWith('64:ff9b:1:')) {
            return true;
        }
        const mappedIpv4 = hostname.match(/:(\d{1,3}(?:\.\d{1,3}){3})$/)?.[1];
        return mappedIpv4 ? isUnsafeArticleChatWebHostname(mappedIpv4) : false;
    }
    if (/^\d+(?:\.\d+){3}$/.test(hostname)) {
        const octets = hostname.split('.').map(Number);
        if (octets.length !== 4 || octets.some(octet =>
            !Number.isInteger(octet) || octet < 0 || octet > 255)) return true;
        const [a, b, c] = octets;
        return a === 0 || a === 10 || a === 127 || a >= 224 ||
            (a === 100 && b >= 64 && b <= 127) ||
            (a === 169 && b === 254) ||
            (a === 172 && b >= 16 && b <= 31) ||
            (a === 192 && b === 0) ||
            (a === 192 && b === 168) ||
            (a === 198 && (b === 18 || b === 19)) ||
            (a === 198 && b === 51 && c === 100) ||
            (a === 203 && b === 0 && c === 113);
    }
    return !hostname.includes('.');
}

return {normalizeArticleChatMarkdownLinkUrl,createArticleChatMarkdownLink,articleChatMarkdownExplicitLinkAt,articleChatMarkdownBareUrlAt,articleChatInlineMarkdownTokenAt,appendArticleChatInlineMarkdown,normalizeArticleChatMarkdown,isArticleChatMarkdownBlockStart,parseArticleChatMarkdownTableRow,articleChatMarkdownTableAlignments,createArticleChatMarkdownTable,articleChatOrderedListItemCount,renderArticleChatMarkdown,isUnsafeArticleChatWebHostname};
}
return {createRenderer};
});


;/* native/core/web-media.js */
(function(root){
  'use strict';
  const api=root.SciLLM ||= {};
  const excluded='[data-sci-plugin-ui],[data-brevess-magnifier],#sci-logic-panel,#sci-article-navigator,#sci-figure-image-viewer';
  function safeSource(value,base){if(!value)return "";try{const u=new URL(value,base);return ['http:','https:','blob:'].includes(u.protocol)||/^data:image\//i.test(value)?u.href:'';}catch{return '';}}
  function mediaId(source){
    // Stable local locator, not a permission or content-integrity credential.
    // Actions also bind the complete source and existing workspace identities.
    const words=[2166136261,2246822519,3266489917,668265263];
    for(let i=0;i<source.length;i++)for(let j=0;j<4;j++)words[j]=Math.imul(words[j]^source.charCodeAt(i),[16777619,2246822519,3266489917,668265263][j]);
    return 'web-media-'+words.map(x=>(x>>>0).toString(16).padStart(8,'0')).join('');
  }
  function collectWebMedia(doc){
    const found=[],seen=new Map();
    for(const element of doc.querySelectorAll('img,video')){
      if(element.closest(excluded))continue;
      const video=element.tagName==='VIDEO',box=element.getBoundingClientRect();
      if(!video&&Math.max(box.width,element.naturalWidth||0)<32&&Math.max(box.height,element.naturalHeight||0)<32)continue;
      const source=safeSource(video?(element.currentSrc||element.src||element.querySelector('source')?.src||element.poster):(element.currentSrc||element.src||element.dataset.src),doc.baseURI);
      if(!source)continue;
      const identity=(video?'video:':'image:')+source,id=mediaId(identity);
      if(seen.has(id)){if(seen.get(id).webMedia.identity===identity)seen.get(id).mediaElements.push(element);continue;}
      let thumbnail=video?safeSource(element.poster,doc.baseURI):source;
      if(video&&!element.poster&&element.readyState>=2){try{const c=doc.createElement('canvas'),scale=Math.min(1,640/element.videoWidth);c.width=element.videoWidth*scale;c.height=element.videoHeight*scale;c.getContext('2d').drawImage(element,0,0,c.width,c.height);thumbnail=c.toDataURL('image/png');}catch{thumbnail='';}}
      const caption=String(element.closest('figure')?.querySelector('figcaption')?.textContent||element.alt||element.title||element.getAttribute('aria-label')||'').trim().slice(0,4000);
      const item={figureId:id,figureLabel:(video?'视频':'图片')+' '+(found.length+1),caption,sourceKind:video?'web-video':'web-image',element,captionElement:element,imageElements:video?[]:[element],mediaElements:[element],panelHints:[],contextParagraphs:[],isSupplemental:false,
        webMedia:{kind:video?'video':'image',source,identity,thumbnail,title:caption||((video?'视频':'图片')+' '+(found.length+1))}};
      found.push(item);seen.set(id,item);
    }
    return found;
  }
  function renderWebMediaCards({document:doc=globalThis.document,mount,figures,getNote,onLocate,onSaveNote,onAsk,onAnnotate,drafts=new Map()}){
    const active=doc.activeElement,focused=mount.contains(active)&&active.tagName==='TEXTAREA'?{id:active.closest('[data-media-id]')?.dataset.mediaId,start:active.selectionStart,end:active.selectionEnd}:null;
    mount.replaceChildren();
    for(const figure of figures){
      const card=doc.createElement('section');card.className='brevess-web-media-card';card.dataset.mediaId=figure.figureId;
      card.style.cssText='border:1px solid var(--bv-line,#ddd);border-radius:8px;padding:12px;margin:10px 0;background:var(--bv-surface,#fff)';
      const title=doc.createElement('strong');title.textContent=figure.figureLabel;
      const preview=doc.createElement('div');preview.style.cssText='margin:8px 0;text-align:center;background:var(--bv-raised,#f7f7f7)';
      if(figure.webMedia.thumbnail){const image=doc.createElement('img');image.src=figure.webMedia.thumbnail;image.alt=figure.webMedia.title;image.loading='lazy';image.style.cssText='max-width:100%;max-height:220px;object-fit:contain';preview.append(image);}else preview.textContent='▶ 视频缩略图暂不可用';
      const caption=doc.createElement('p');caption.textContent=figure.webMedia.title;caption.style.cssText='font-size:12px;overflow-wrap:anywhere';
      const actions=doc.createElement('div');actions.style.cssText='display:flex;gap:8px;flex-wrap:wrap';
      const status=doc.createElement('output');status.setAttribute('aria-live','polite');status.style.cssText='display:block;font-size:12px;margin-top:6px';
      const action=(label,fn)=>{const b=doc.createElement('button');b.type='button';b.textContent=label;b.addEventListener('click',async()=>{b.disabled=true;try{await fn();}catch(e){status.textContent=e?.message||'操作失败';}finally{b.disabled=false;}});actions.append(b);return b;};
      const editor=doc.createElement('div');editor.hidden=!drafts.has(figure.figureId);
      const input=doc.createElement('textarea');input.setAttribute('aria-label',figure.figureLabel+'笔记');input.value=String(drafts.has(figure.figureId)?drafts.get(figure.figureId):getNote(figure)||'');input.addEventListener('input',()=>drafts.set(figure.figureId,input.value));input.maxLength=12000;input.style.cssText='width:100%;box-sizing:border-box;min-height:90px;margin-top:8px';
      const save=doc.createElement('button');save.type='button';save.textContent='保存笔记';
      const note=doc.createElement('p');note.style.cssText='white-space:pre-wrap;font-size:13px';note.textContent=String(getNote(figure)||'');
      save.addEventListener('click',async()=>{save.disabled=true;const value=input.value;try{await onSaveNote(figure,value);note.textContent=value;status.textContent='笔记已保存';if(drafts.get(figure.figureId)===value){drafts.delete(figure.figureId);if(input.value===value)editor.hidden=true;}}catch(e){status.textContent=e?.message||'保存失败，草稿已保留';}finally{save.disabled=false;}});
      editor.append(input,save);action('跳转',()=>onLocate(figure));action('笔记',()=>{editor.hidden=!editor.hidden;if(!editor.hidden)input.focus();});action('提问',()=>onAsk(figure));if(figure.webMedia.kind==='image'&&onAnnotate)action('标注',()=>onAnnotate(figure));
      card.append(title,preview,caption,actions,note,editor,status);mount.append(card);if(focused?.id===figure.figureId&&!editor.hidden){input.focus();input.setSelectionRange(Math.min(focused.start,input.value.length),Math.min(focused.end,input.value.length));}
    }
    if(!figures.length){const empty=doc.createElement('p');empty.textContent='当前页面尚未发现图片或视频；可在加载完成后刷新。';mount.append(empty);}
  }
  function openFigureNoteEditor({document:doc=globalThis.document,title='图片笔记',value='',onSave}){
    doc.querySelectorAll('[data-brevess-figure-note]').forEach(node=>node.remove());
    const host=doc.createElement('div');host.dataset.sciPluginUi='';host.dataset.brevessFigureNote='';
    host.style.cssText='position:fixed;right:24px;top:20%;z-index:2147483647;width:min(360px,calc(100vw - 32px));background:var(--bv-surface,white);color:var(--bv-text,#222);border:1px solid var(--bv-line-strong,#aaa);border-radius:8px;padding:16px;box-shadow:0 4px 24px #0003;font:14px/1.5 sans-serif';
    const label=doc.createElement('strong');label.textContent=title;const input=doc.createElement('textarea');input.value=value;input.maxLength=12000;input.setAttribute('aria-label','图片笔记');input.style.cssText='display:block;width:100%;box-sizing:border-box;min-height:120px;margin:12px 0';
    const save=doc.createElement('button');save.type='button';save.setAttribute('aria-label','保存');save.title='保存';save.innerHTML='<svg width=22 height=22 viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 3h13l3 3v15H4zM8 3v6h8V3M8 21v-8h8v8"/></svg>';const close=doc.createElement('button');close.type='button';close.setAttribute('aria-label','关闭');close.title='关闭';close.innerHTML='<svg width=22 height=22 viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';close.style.marginLeft='8px';const status=doc.createElement('output');status.style.display='block';status.setAttribute('aria-live','polite');
    for(const b of [save,close])b.style.cssText='display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;padding:6px;border:1px solid var(--bv-line,#cbd5e1);border-radius:6px;background:var(--bv-raised,#f8fafc);color:var(--bv-text,#334155);cursor:pointer;margin-right:8px';
    host.addEventListener('click',e=>e.stopPropagation());host.addEventListener('keydown',e=>{if(e.key==='Escape'){e.stopPropagation();host.remove();}});
    save.addEventListener('click',async()=>{save.disabled=true;const submitted=input.value;try{await onSave(submitted);status.textContent=input.value===submitted?'已保存':'先前内容已保存；还有未保存修改';}catch(e){status.textContent=e?.message||'保存失败，草稿已保留';}finally{save.disabled=false;}});close.addEventListener('click',()=>host.remove());host.append(label,input,save,close,status);doc.documentElement.append(host);input.focus();return host;
  }
  Object.assign(api,{collectWebMedia,renderWebMediaCards,openFigureNoteEditor});
})(globalThis);


;/* native/core/literature-note-inserts.js */
/* Rich inserts use the existing note editor and the article's own source and image stores. */
(() => {
  'use strict';
  const imageRef = /!\[([^\]\n]{0,240})\]\(brevess-image:([a-f0-9]{64})\)/g;
  const fallbackKey = id => 'brevessNoteImage:' + id;
  const path = id => 'literature-notes/images/' + id + '.json';
  const raster = value => typeof value === 'string' && /^data:image\/(?:png|jpeg|gif|webp|avif);base64,[a-z\d+/=]+$/i.test(value);
  async function fromWorkspace(target,id) {
    if (!target) return null;
    const response = await chrome.runtime.sendMessage({type:'ARTICLE_WORKSPACE_GET_ASSET',...target,relativePath:path(id)});
    if (!response?.success && response?.error?.code !== 'WORKSPACE_NOT_FOUND') throw Error('未能读取笔记图片');
    return response?.data?.asset?.content?.dataUrl;
  }
  async function readImage(context,id) {
    const stored = await fromWorkspace(context.target,id);
    if (raster(stored)) return stored;
    const key = fallbackKey(id);
    const local = (await chrome.storage.local.get(key))[key];
    if (!raster(local)) throw Error('此笔记图片不可用');
    // A draft can acquire a workspace after it already contains an image.
    if (context.target && isCurrentLiteratureNoteContext(context)) await writeWorkspaceImage(context.target,id,local);
    return local;
  }
  async function writeWorkspaceImage(target,id,dataUrl) {
    const response = await chrome.runtime.sendMessage({type:'ARTICLE_WORKSPACE_SAVE_ASSET',...target,
      relativePath:path(id),expectedRevision:0,content:{dataUrl}});
    if (response?.error?.code === 'WORKSPACE_NOT_FOUND') return false;
    if (!response?.success && !(response?.error?.code === 'ASSET_REVISION_CONFLICT' && await fromWorkspace(target,id) === dataUrl))
      throw Error(response?.error?.message || '未能保存笔记图片');
    return true;
  }
  async function storeImage(context,dataUrl) {
    if (!raster(dataUrl)) throw Error('图片格式无法读取');
    const digest = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(dataUrl));
    const id = Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
    if (!isCurrentLiteratureNoteContext(context)) throw Error('当前论文已切换');
    if (!context.target || !await writeWorkspaceImage(context.target,id,dataUrl))
      await chrome.storage.local.set({[fallbackKey(id)]:dataUrl});
    return id;
  }
  async function hydrate(root) {
    const context = captureLiteratureNoteContext();
    await Promise.all([...root.querySelectorAll('img[data-note-image]:not([src])')].map(async img=>{
      try {
        const url = await readImage(context,img.dataset.noteImage);
        if (img.isConnected && isCurrentLiteratureNoteContext(context)) img.src = url;
      } catch (error) { img.title = error.message; }
    }));
  }
  async function portable(text,context) {
    const urls = new Map();
    for (const match of text.matchAll(imageRef)) if (!urls.has(match[2])) urls.set(match[2],await readImage(context,match[2]));
    return text.replace(imageRef,(_,alt,id) => '![' + alt + '](' + urls.get(id) + ')');
  }
  function fileUrl(file) {
    return new Promise((resolve,reject) => {
      const reader=new FileReader();
      reader.onload=()=>resolve(reader.result); reader.onerror=()=>reject(Error('无法读取剪贴板图片'));
      reader.readAsDataURL(file);
    });
  }
  async function rasterize(file) {
    if (['image/png','image/jpeg','image/webp','image/gif','image/avif'].includes(file.type) && file.size <= 4*1024*1024) return fileUrl(file);
    const url=URL.createObjectURL(file);
    try {
      const img=new Image(); img.src=url; await img.decode();
      if (!img.naturalWidth || !img.naturalHeight) throw Error('图片没有可用的尺寸');
      const scale=Math.min(1,2400/Math.max(img.naturalWidth,img.naturalHeight));
      const canvas=document.createElement('canvas'); canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));
      canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
      canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
      return canvas.toDataURL('image/webp',0.9);
    } finally { URL.revokeObjectURL(url); }
  }
  function destination(field,start=field.selectionStart,end=field.selectionEnd) {
    const context=captureLiteratureNoteContext(), value=field.value, editor=literatureNoteEditors.get(field), bookmark=editor?.bookmark?.();
    const rich = editor?.rich;
    const valid=()=>field.isConnected && !field.disabled && !field.readOnly && editor?.rich===rich &&
      field.value===value && isCurrentLiteratureNoteContext(context);
    return { context, valid, insert(text) {
      if (!valid()) throw Error('字段或论文已变化，请重新插入');
      if (!(editor?.rich ? editor.insert(text,bookmark,{replaceAll:start===0&&end===value.length&&text===''}) : literatureNoteSourceEditors.get(field)?.replaceRange(text,start,end))) throw Error('请将光标放在完整引用标记之外，并检查字段长度');
      if (editor) editor.focus(); else field.focus({preventScroll:true});
    }};
  }
  function mark(alt,id) { return '![' + String(alt || '图片').replace(/[\n\r\[\]\\]/g,' ').slice(0,240) + '](brevess-image:' + id + ')'; }
  function sources() {
    const entries = new Map(), snapshot=currentWorkspaceSnapshot;
    function add(id,text,section) {
      if (/^(p-|pdf-paragraph:)[a-f0-9]{16}$/.test(id) && text && !entries.has(id))
        entries.set(id,{id,text:String(text),section:String(section || '正文')});
    }
    for (const p of [...(snapshot?.paragraphs||[]),...(snapshot?.literatureNoteCaptionSources||[])]) {
      if (p.sourceKey) add(p.paragraphId,p.text,p.sectionTitle);
    }
    const pdf = currentPdfSemanticNavigation;
    if (pdf && pdf.documentId===snapshot?.documentId && pdf.documentHash===snapshot?.documentHash) {
      const visit=sections=>{ for (const section of sections||[]) {
        for (const t of section.paragraphTargets||[]) if(isTrustedPopupPdfParagraphTarget(t,pdf))
          add(t.paragraphId,t.expectedNormalizedQuote,section.title);
        visit(section.children);
      }};
      visit(pdf.sections);
    }
    return [...entries.values()];
  }
  function node(tag, text) {
    const el=document.createElement(tag); if (text) el.textContent=text; return el;
  }
  function figureIdOf(item) {
    const id = String(item.figureId || '').toLowerCase();
    return /^figure-(?:s|ed)?[1-9]\d{0,2}$/.test(id) ? id : SciLLM.parseFigureLabel(item.name)?.figureId;
  }
  async function resolvePanelMention(job, valid) {
    const scope = job.context.panel;
    const items = await BrevessNotePanels.list(scope);
    if (!valid()) return null;
    const matching = prefix => items.filter(item => figureIdOf(item) === 'figure-' + prefix + job.number);
    let candidates = matching(job.series);
    // The quick navigator labels Extended Data as FS as well. An actual S
    // figure takes precedence, and FED remains an explicit Extended Data target.
    if (!candidates.length && job.series === 's') candidates = matching('ed');
    if (!candidates.length) throw Error('当前论文未找到对应图号');
    const direct = candidates.filter(item => item.direct?.toUpperCase() === job.label);
    let matches = direct;
    if (!direct.length) {
      matches = [];
      for (const item of candidates.filter(item => !item.direct)) {
        const labels = await BrevessNotePanels.labels(scope, item);
        if (!valid()) return null;
        if (labels.some(label => String(label).toUpperCase() === job.label)) matches.push(item);
      }
    }
    if (!matches.length) throw Error('未找到对应裁片，可在图解中核对 Panel');
    if (matches.length !== 1) throw Error('多张原图含有相同 Panel 编号，请核对图解');
    const item = matches[0];
    const crop = await BrevessNotePanels.crop(scope, item, job.label);
    if (!valid()) return null;
    const id = await storeImage(job.context.note, crop.dataUrl);
    const alt = (crop.name || item.name) + ' · Panel ' + job.label;
    return {id, alt, markdown:mark(alt, id)};
  }
  function action(field,kind) {
    try {
      if(kind==='citation') void selectCitation(field);
      if(kind==='image') { const input=node('input');input.type='file';input.accept='image/*';input.multiple=true;const dest=destination(field);input.onchange=()=>void insertFiles([...input.files],dest);input.click(); }
      if(kind==='table') destination(field).insert('\n\n| 项目 | 结果 |\n| --- | --- |\n|  |  |\n\n');
      if(kind==='clear') destination(field,0,field.value.length).insert('');
    } catch(e){showStatus(e.message,'error');}
  }
  async function insertFiles(files,dest) {
    try {
      const inserts=[];
      for(const file of files){if(!dest.valid())throw Error('字段或论文已变化，请重新插入');inserts.push(mark(file.name,await storeImage(dest.context,await rasterize(file))));}
      if(inserts.length)dest.insert(inserts.join('\n'));
    }catch(e){showStatus(e.message,'error');}
  }
  let pendingCitation;
  async function selectCitation(field) {
    pendingCitation?.cancel();
    const dest=destination(field),scope=capturePanelContext();
    const bar=node('div');bar.className='note-citation-prompt';bar.setAttribute('role','status');
    bar.append(node('span','请在当前论文原文划选句子，松开即插入引文。'));
    const stop=node('button','取消（Esc）');stop.type='button';bar.append(stop);field.closest('.literature-note-field').prepend(bar);
    const port=chrome.tabs.connect(scope.tabId,{name:'brevess-note-citation'});
    let done=false;
    const cancel=()=>{if(done)return;done=true;clearInterval(timer);port.disconnect();bar.remove();document.removeEventListener('keydown',escape,true);if(pendingCitation?.cancel===cancel)pendingCitation=null;};
    const escape=e=>{if(e.key==='Escape'){e.preventDefault();cancel();}};
    const timer=setInterval(()=>{if(!dest.valid()||!isCurrentPanelContext(scope))cancel();},200);
    pendingCitation={cancel};stop.onclick=cancel;document.addEventListener('keydown',escape,true);
    port.onDisconnect.addListener(()=>{void chrome.runtime.lastError;if(!done){cancel();showStatus('引文选择已结束；可重新点击插入引文。','info');}});
    port.onMessage.addListener(m=>{
      if(m.cancelled){cancel();return;}
      if(m.error){bar.firstChild.textContent=m.error;return;}
      if(!dest.valid()||!isCurrentPanelContext(scope)){cancel();return;}
      if(!Array.isArray(m.ids)||!m.ids.length||m.ids.some(id=>!sources().some(p=>p.id===id))){bar.firstChild.textContent='原文位置尚未就绪，请稍候重新划选。';return;}
      try{dest.insert(m.ids.map(id=>'('+id+')').join(''));cancel();showStatus('已插入原文引文。','success');}catch(e){cancel();showStatus(e.message,'error');}
    });
  }
  function bind(field) {
    const editor = literatureNoteEditors.get(field);
    const rich = editor?.surface;
    if (rich) {
      SciLLM.attachLiteratureNotePanelMentions({
        field, editor, sourceEditor:literatureNoteSourceEditors.get(field), resolve:resolvePanelMention,
        context:() => ({note:captureLiteratureNoteContext(), panel:capturePanelContext()}),
        isCurrent:context => isCurrentLiteratureNoteContext(context.note) && isCurrentPanelContext(context.panel)
      });
      rich.addEventListener('paste', event => {
        const files = [...(event.clipboardData?.items || [])]
          .filter(item => item.kind === 'file' && item.type.startsWith('image/'))
          .map(item => item.getAsFile()).filter(Boolean);
        if (files.length) {
          event.preventDefault();
          void insertFiles(files, destination(field));
        }
      });
    }
    field.addEventListener('paste',async e=>{
      const files=[...(e.clipboardData?.items||[])].filter(i=>i.kind==='file' && i.type.startsWith('image/')).map(i=>i.getAsFile()).filter(Boolean);
      if(!files.length)return;
      e.preventDefault(); const dest=destination(field);
      try{
        const inserts=[];
        for(const file of files){
          if(!dest.valid())throw Error('字段或论文已变化，请重新粘贴');
          inserts.push(mark(file.name,await storeImage(dest.context,await rasterize(file))));
        }
        dest.insert(inserts.join('\n'));
      }catch(error){showStatus(error.message || '粘贴图片失败','error');}
    });
    const media=node('div');media.className='literature-note-media';
    field.after(media);
    const refresh=()=>{
      const matches=[...field.value.matchAll(imageRef)];
      media.hidden=field.hidden||!matches.length;
      if(media.hidden)return;
      if(media.dataset.refs!==JSON.stringify(matches.map(m=>[m[1],m[2]]))){
        media.replaceChildren(); for(const [,alt,id] of matches){const img=node('img');img.alt=alt;img.dataset.noteImage=id;media.append(img);}
        media.dataset.refs=JSON.stringify(matches.map(m=>[m[1],m[2]]));
      }
      void hydrate(media);
    };
    new MutationObserver(refresh).observe(field,{attributes:true,attributeFilter:['hidden']});
    field.addEventListener('input',refresh);refresh();
  }
  globalThis.BrevessNoteInserts={bind,action,hydrate,portable};
})();

