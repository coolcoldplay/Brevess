const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  normalizeInterfaceLanguage,
  translateInterfaceText,
  outputLanguageContract,
  localizeGeneratedFallback
} = require('../core/i18n.js');

test('normalizes the global language and translates known interface text', () => {
  assert.equal(normalizeInterfaceLanguage('en-US'), 'en');
  assert.equal(normalizeInterfaceLanguage('zh-CN'), 'zh-CN');
  assert.equal(translateInterfaceText('  分析模式  ', 'en'), '  Analysis modes  ');
  assert.equal(translateInterfaceText('用户自定义类别', 'en'), '用户自定义类别');
  assert.equal(translateInterfaceText('开始研读', 'en'), 'Start reading');
  assert.equal(
    translateInterfaceText(
      '正在仅用内置合成文本测试连接；不会发送当前论文内容。',
      'en'
    ),
    'Testing connectivity with extension-bundled synthetic text only; no content from the current paper is sent.'
  );
  assert.equal(
    translateInterfaceText(
      '正在使用内置合成文本和 JSON Schema 测试；不会发送当前论文内容。',
      'en'
    ),
    'Testing with extension-bundled synthetic text and a JSON Schema; no content from the current paper is sent.'
  );
  assert.equal(
    translateInterfaceText(
      '正在使用内置合成文本、微型 PNG 和 JSON Schema 测试；不会发送当前论文内容。',
      'en'
    ),
    'Testing with extension-bundled synthetic text, a tiny PNG, and a JSON Schema; no content from the current paper is sent.'
  );
  assert.equal(
    translateInterfaceText('外部导入 · 来源未验证', 'en'),
    'External import · Source unverified'
  );
  assert.equal(
    translateInterfaceText('联网回答 · 来源未验证', 'en'),
    'Web answer · Source unverified'
  );
  assert.equal(
    translateInterfaceText('列为上游节点，行为下游节点。', 'en'),
    'Columns are upstream nodes and rows are downstream nodes.'
  );
  assert.equal(translateInterfaceText('充分性证据', 'en'), 'Sufficiency evidence');
  assert.equal(translateInterfaceText('必要性证据', 'en'), 'Necessity evidence');
  assert.equal(translateInterfaceText('其他或相关性证据', 'en'), 'Related / other evidence');
  const matrixLabels = new Map([
    ['未填写节点', 'Unnamed node'],
    ['关闭证据单元格编辑器', 'Close evidence-cell editor'],
    ['选择 Panel 证据', 'Select Panel evidence'],
    ['选择 Panel', 'Select Panel'],
    ['证据类别', 'Evidence class'],
    ['自环联系极性', 'Self-loop polarity'],
    ['请选择极性', 'Select polarity'],
    ['选择要添加证据的联系', 'Select the link that receives the evidence'],
    ['添加证据', 'Add evidence'],
    ['保存名称', 'Save name'],
    ['删除证据', 'Delete evidence'],
    ['编辑', 'Edit'],
    ['未关联 Panel 审计', 'Non-linked Panel audit'],
    ['未关联 Panel 不会显示为联系证据，以下条目保留其审计状态与原因。',
      'Non-linked Panels are not shown as link evidence. Their audit status and reason are listed below.'],
    ['未关联', 'Unlinked'],
    ['已排除', 'Excluded'],
    ['存在歧义', 'Ambiguous'],
    ['候选 Panel', 'Candidate Panels'],
    ['当前证据表中没有关联联系。', 'No link currently contains this Panel.']
  ]);
  matrixLabels.forEach((expected, source) => {
    assert.equal(translateInterfaceText(source, 'en'), expected, source);
  });
  assert.equal(
    translateInterfaceText('证据单元格：中性 → 关闭', 'en'),
    'Evidence cell: 中性 → 关闭'
  );
  assert.equal(
    translateInterfaceText('编辑 中性 到 关闭 的 Panel 证据', 'en'),
    'Edit Panel evidence from 中性 to 关闭'
  );
  assert.equal(
    translateInterfaceText('删除机制节点：充分性证据', 'en'),
    'Delete mechanism node: 充分性证据'
  );
  assert.equal(
    translateInterfaceText('Panel 名称：必要性证据', 'en'),
    'Panel name: 必要性证据'
  );
  assert.equal(
    translateInterfaceText('替换 Panel：必要性证据', 'en'),
    'Replace Panel: 必要性证据'
  );
  assert.equal(
    translateInterfaceText('证据类别：必要性证据', 'en'),
    'Evidence class: 必要性证据'
  );
  assert.equal(
    translateInterfaceText('第 2 条联系（负向/抑制）', 'en'),
    'Link 2 (Negative / inhibitory)'
  );
  assert.equal(
    translateInterfaceText('Panel 证据 必要性证据；类别：其他或相关性证据', 'en'),
    'Panel evidence 必要性证据; class: Related / other evidence'
  );
  assert.equal(translateInterfaceText('尚未解析 PDF', 'en'), 'PDF not parsed yet');
  assert.equal(
    translateInterfaceText('AI 已填写 9 个空白字段', 'en'),
    'AI filled 9 blank fields'
  );
  assert.equal(translateInterfaceText('正文未提供', 'en'),
    'Not provided in the article');
  assert.equal(translateInterfaceText('已由正文证据填写', 'en'),
    'Filled from article evidence');
  assert.equal(
    translateInterfaceText('上次保存失败，已恢复未丢失的编辑并等待重试', 'en'),
    'The previous save failed. Your edits were restored and are waiting to retry.'
  );
  assert.equal(translateInterfaceText('已恢复未保存的编辑，正在重试', 'en'),
    'Unsaved edits restored; retrying now.');
  assert.equal(translateInterfaceText('笔记保存队列已满，请稍后重试', 'en'),
    'The note save queue is full. Please retry shortly.');
  assert.equal(translateInterfaceText('保存失败', 'en'), 'Save failed');
  assert.equal(translateInterfaceText('文献笔记本地保存失败', 'en'),
    'The literature note could not be saved locally.');
  assert.equal(translateInterfaceText('文献笔记保存请求无效', 'en'),
    'The literature-note save request is invalid.');
  assert.equal(translateInterfaceText('文献笔记内容无效或过大', 'en'),
    'The literature-note changes are invalid or too large.');
  assert.equal(
    translateInterfaceText('当前文献笔记已达到容量上限，请精简后重试', 'en'),
    'This literature note has reached its storage limit. Shorten it and retry.'
  );
  assert.equal(
    translateInterfaceText('文献笔记本地存储已达到容量上限，请清理后重试', 'en'),
    'Local literature-note storage has reached its limit. Free some space and retry.'
  );
  assert.equal(
    translateInterfaceText(
      'AI 已填写 0 个空白字段；3 个字段正文未提供；保留 1 个已有字段；2 个返回无效（已复用本地结果）',
      'en'
    ),
    'AI filled 0 blank fields; 3 fields were not provided in the article; ' +
      'preserved 1 existing field; 2 invalid results (reused local result)'
  );
  assert.equal(
    translateInterfaceText(
      'AI 已填写 1 个空白字段；1 个字段正文未提供；保留 1 个已有字段；1 个返回无效',
      'en'
    ),
    'AI filled 1 blank field; 1 field was not provided in the article; ' +
      'preserved 1 existing field; 1 invalid result'
  );
  assert.equal(
    translateInterfaceText('逐图解读完成：16 张 Figure', 'en'),
    'Figure analysis complete: 16 Figures'
  );
});

test('defines one authoritative output-language contract for every AI task', () => {
  assert.match(outputLanguageContract('en-US'), /all human-readable.*English/is);
  assert.match(outputLanguageContract('zh-CN'), /所有面向用户.*中文/s);
  assert.equal(localizeGeneratedFallback('missing_evidence', 'en'),
    'Not provided in the article');
  assert.equal(localizeGeneratedFallback('missing_evidence', 'zh-CN'), '正文未提供');
});

test('mechanism generation stages and terminal states have fixed bilingual labels', () => {
  const labels = new Map([
    ['正在收集 Panel 证据', 'Collecting Panel evidence'],
    ['正在规范化机制节点', 'Canonicalizing mechanism nodes'],
    ['正在映射主张关系', 'Mapping claim relations'],
    ['正在组装机制图', 'Assembling mechanism graph'],
    ['正在修复未解析证据', 'Repairing unresolved evidence'],
    ['正在验证最终结果', 'Validating final result'],
    ['模型仍在处理', 'The model is still processing'],
    ['机制链任务排队中', 'Mechanism generation queued'],
    ['机制链生成处理中', 'Mechanism generation in progress'],
    ['机制链生成正在重试', 'Retrying mechanism generation'],
    ['取消机制链生成', 'Cancel mechanism generation'],
    ['正在取消机制链生成', 'Cancelling mechanism generation'],
    ['机制链生成已取消', 'Mechanism generation cancelled'],
    ['机制链需要人工核验', 'Mechanism generation needs review'],
    ['机制链生成失败', 'Mechanism generation failed'],
    ['机制链生成完成', 'Mechanism generation complete'],
    ['机制链生成超时', 'Mechanism generation deadline exceeded'],
    ['机制链请求额度已用尽', 'Mechanism request budget exhausted'],
    ['机制链工作区版本冲突', 'Mechanism workspace revision conflict']
  ]);
  labels.forEach((expected, source) => {
    assert.equal(translateInterfaceText(source, 'en'), expected, source);
    assert.equal(translateInterfaceText(source, 'zh-CN'), source, source);
  });
  assert.equal(
    translateInterfaceText('模型仍在处理（已等待 61 秒）', 'en'),
    'The model is still processing (61 seconds elapsed)'
  );
});

test('mechanism read view localizes zoom, relation, audit, legend, and inspector chrome', () => {
  const labels = new Map([
    ['机制图缩放', 'Mechanism graph zoom'],
    ['适合宽度', 'Fit width'],
    ['实际大小', 'Actual size'],
    ['实际大小（100%）', 'Actual size (100%)'],
    ['正向/促进', 'Positive / promoting'],
    ['负向/抑制', 'Negative / inhibitory'],
    ['因果联系', 'Causal relation'],
    ['相关联系', 'Correlative relation'],
    ['争议联系', 'Contested relation'],
    ['充分性', 'Sufficiency'],
    ['救援实验', 'Rescue'],
    ['上位性', 'Epistasis'],
    ['定向干预', 'Directional intervention'],
    ['相关性', 'Association'],
    ['观察 / 定位', 'Observation / localization'],
    ['阴性结果', 'Null result'],
    ['反证', 'Counterevidence'],
    ['结论不明 / 未知', 'Inconclusive / unknown'],
    ['未连通证据审计', 'Disconnected evidence audit'],
    ['未连通但有证据的节点', 'Disconnected but evidenced nodes'],
    ['未解析证据审计', 'Unresolved evidence audit'],
    ['尚未解析的证据', 'Unresolved evidence'],
    ['排除证据审计', 'Excluded evidence audit'],
    ['示意图 / 非证据排除项', 'Schematic / non-evidentiary exclusions'],
    ['复合关系暂不支持', 'Composite relations are not supported'],
    ['关系术语未能映射', 'Relation term could not be mapped'],
    ['缺少关系映射', 'Relation mapping is missing'],
    ['来源支持的示意图，不作为机制证据',
      'Source-backed schematic; not treated as mechanism evidence'],
    ['机制链需要人工检查。', 'The mechanism chain needs manual review.'],
    ['正在等待机制链生成；也可以先新增节点，手动构建机制链。',
      'Waiting for mechanism-chain generation. You can also add a node and build the chain manually.'],
    ['未配置 LLM 也可以使用：点击“新增链条节点”开始结构化记录。',
      'You can use this without an LLM: select “Add chain node” to start a structured record.'],
    ['新增上游', 'Add upstream node'],
    ['新增下游分支', 'Add downstream branch'],
    ['删除联系', 'Delete link'],
    ['添加联系的 Panel 证据', 'Add Panel evidence to this link'],
    ['手工录入 Panel 证据编号', 'Enter a Panel evidence ID manually']
  ]);
  labels.forEach((expected, source) => {
    assert.equal(translateInterfaceText(source, 'en'), expected, source);
    assert.equal(translateInterfaceText(source, 'zh-CN'), source, source);
  });
  assert.equal(
    translateInterfaceText('机制节点 2：双击或按 Enter 编辑', 'en'),
    'Mechanism node 2: double-click or press Enter to edit'
  );
  const validationMessages = new Map([
    ['当前机制链与已生成证据审计不一致，需要重新检查。',
      'The current mechanism chain does not match the generated evidence audit and needs review.'],
    ['第 2 个节点 ID 重复。', 'Node 2 has a duplicate ID.'],
    ['第 3 条联系指向无效节点。', 'Link 3 points to an invalid node.'],
    ['第 4 条自反馈必须标记为正反馈或负反馈。',
      'Self-loop 4 must be marked as positive or negative feedback.'],
    ['第 5 条联系重复。', 'Link 5 is duplicated.'],
    ['第 6 条联系的第 7 个 Panel 证据需要重新选择。',
      'Panel evidence 7 on link 6 must be selected again.'],
    ['第 8 条联系的第 9 个 Panel 证据无法定位。',
      'Panel evidence 9 on link 8 could not be located.'],
    ['当前机制网络包含 3 个未连接子图。',
      'The current mechanism network contains 3 disconnected components.'],
    ['Panel 证据 2A 需要人工选择。', 'Panel evidence 2A requires manual selection.']
  ]);
  validationMessages.forEach((expected, source) => {
    assert.equal(translateInterfaceText(source, 'en'), expected, source);
    assert.equal(translateInterfaceText(source, 'zh-CN'), source, source);
  });
});

test('committed restore warnings have complete bounded English translations', () => {
  const cases = new Map([
    ['恢复已进入提交阶段，但页面应用结果无法确认；请勿再次执行恢复。',
      'Restore entered the commit stage, but the in-page result could not be confirmed. Do not run restore again.'],
    ['恢复内容已应用，但页面随后发生变化，后续持久化未执行；请勿再次执行恢复。',
      'The restored content was applied, but the page then changed and persistence did not run. Do not run restore again.'],
    ['恢复内容已应用，但图解工作区持久化失败；请勿再次执行恢复。',
      'The restored content was applied, but the figure workspace could not be persisted. Do not run restore again.'],
    ['恢复内容已应用并已持久化，但恢复回执登记失败；请勿再次执行恢复。',
      'The restored content was applied and persisted, but the restore receipt could not be registered. Do not run restore again.'],
    ['恢复内容已应用并已持久化，回执也已登记，但页面在提交后发生变化；请勿再次执行恢复。',
      'The restored content was applied and persisted, and its receipt was registered, but the page changed after commit. Do not run restore again.'],
    ['恢复内容已应用，但提交后状态异常；请勿再次执行恢复。',
      'The restored content was applied, but its post-commit state is abnormal. Do not run restore again.'],
    ['恢复已进入工作区应用提交阶段，但提交失败且可能已部分写入；请勿再次执行恢复。',
      'Restore entered the workspace-application commit stage, but the commit failed and may have written partial state. Do not run restore again.'],
    ['恢复内容已应用并已持久化，但页面随后发生变化，恢复回执尚未登记；请勿再次执行恢复。',
      'The restored content was applied and persisted, but the page then changed before the restore receipt was registered. Do not run restore again.']
  ]);
  cases.forEach((expected, source) => {
    assert.equal(translateInterfaceText(source, 'en'), expected, source);
    assert.ok(expected.length <= 180, source);
  });
});

test('translates the settings, reader, notification, and figure-workspace labels used by English mode', () => {
  const cases = new Map([
    ['设置中心', 'Settings'],
    ['本地保存', 'Local storage'],
    ['模型与连接', 'Models & connections'],
    ['PDF 与阅读工具', 'PDF & reading tools'],
    ['正在连接当前论文…', 'Connecting to the current paper…'],
    ['Panel 标题信息', 'Panel title details'],
    ['补充材料覆盖', 'Supplemental-material coverage'],
    ['导出 PNG', 'Export PNG'],
    ['Brevess PDF 阅读工作区', 'Brevess PDF workspace'],
    ['← 返回原论文正文', '← Return to the article'],
    ['Brevess 离线文献', 'Brevess offline paper'],
    ['正在读取论文工作区…', 'Reading the paper workspace…']
  ]);
  for (const [source, expected] of cases) {
    assert.equal(translateInterfaceText(source, 'en'), expected, source);
  }
});

test('translates dynamic extraction outcomes without leaving Chinese status fragments', () => {
  assert.equal(
    translateInterfaceText('全文创新点已部分生成,需人工核验(已复用正文证据缓存)', 'en'),
    'Paper-wide innovations were partially generated and need review (reused article-evidence cache)'
  );
  assert.equal(
    translateInterfaceText('研究背景与科学问题提取失败：Provider returned an invalid response', 'en'),
    'Research background and scientific questions extraction failed: Provider returned an invalid response'
  );
  const cases = new Map([
    ['已激活 · elsevier', 'Active · elsevier'],
    ['正在向 LLM 追问…', 'Asking the LLM…'],
    ['Figure 解读失败', 'Figure analysis failed'],
    ['Extended Data Figure 3 · 解读失败', 'Extended Data Figure 3 · failed'],
    ['自动填写失败：Unable to reach the provider', 'Autofill failed: Unable to reach the provider'],
    ['文献笔记自动填写失败：Unable to reach the provider', 'Literature-note autofill failed: Unable to reach the provider'],
    ['查看 表型 P1 到 细胞 C 的联系', 'View relationship from 表型 P1 to 细胞 C'],
    ['已从 PDF 原生大纲读取 12 个标题', 'Read 12 headings from the native PDF outline'],
    ['原始 PDF · 12 个标题', 'Original PDF · 12 headings']
    ,['已保存并逐页核验 3 条批注。',
      'Saved and verified 3 annotations page by page.'],
    ['批注导出已核验，浏览器已开始下载；请在下载完成后确认文件。',
      'The annotation export was verified and the browser started the download; confirm the file after it finishes.'],
    ['已从写入文件重新读取并逐页核验 3 条批注。',
      'Re-read the written file and verified 3 annotations page by page.'],
    ['保存期间 PDF 或批注已变更，本次保存已取消，请重试。',
      'The PDF or annotations changed while saving. This save was cancelled; try again.'],
    ['保存目标未准备完成，请重试。',
      'The save destination was not ready. Try again.'],
    ['所选 PDF 文字没有可保存的页面坐标，请重新选择',
      'The selected PDF text has no savable page coordinates. Select it again.'],
    ['无法保存所选 PDF 文字的页面坐标，请重新选择',
      'Could not save page coordinates for the selected PDF text. Select it again.'],
    ['本次提问已取消，已完成的回答内容已保留。',
      'This question was cancelled. Completed answer content was preserved.'],
    ['已保存点击时的批注快照；当前批注已变化。',
      'The annotation snapshot from when you clicked was saved; the current annotations have changed.'],
    ['所选保存位置是当前原 PDF，请使用“覆盖原 PDF”并完成安全确认。',
      'The selected destination is the current original PDF. Use “Overwrite original PDF” and complete the safety confirmation.'],
    ['无法确认保存副本与原 PDF 是否为同一文件，已停止保存。',
      'Could not confirm whether the copy destination is the original PDF, so saving was stopped.'],
    ['浏览器已开始下载点击时的批注快照；当前批注已变化，请在下载完成后确认文件。',
      'The browser started downloading the annotation snapshot from when you clicked; the current annotations have changed, so confirm the file after the download finishes.'],
    ['文件已经写入，但重新读取核验失败；请检查目标文件后再重试。',
      'The file was written, but re-reading and verification failed. Check the destination file before trying again.']
  ]);
  for (const [source, expected] of cases) {
    assert.equal(translateInterfaceText(source, 'en'), expected, source);
  }
});

test('covers the static text on every extension-owned reading and settings surface', () => {
  const files = [
    'action-popup.html',
    'popup.html',
    'options.html',
    'pdf-reader.html',
    'offline-reader.html',
    'logic-map.html'
  ];
  const misses = [];
  for (const file of files) {
    const html = fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
      .replace(/<!--[\s\S]*?-->/g, '');
    const texts = [...html.matchAll(/>([^<>]+)</g)]
      .map(match => match[1].replace(/&[^;]+;/g, ' ').replace(/\s+/g, ' ').trim())
      .filter(value => /[\u3400-\u9fff]/u.test(value) && value.length <= 120);
    for (const text of new Set(texts)) {
      if (translateInterfaceText(text, 'en') === text) misses.push(`${file}: ${text}`);
    }
  }
  assert.deepEqual(misses, []);
});

test('localizes the remaining static reader labels while preserving Chinese mode', () => {
  const cases = new Map([
    ['直接读取本地 HTML/PDF 标题层级，无需调用 AI。',
      'Read local HTML/PDF heading structures directly; no AI required.'],
    ['专注阅读', 'Focus reading'],
    ['更多', 'More'],
    ['收起', 'Collapse'],
    ['翻页', 'Page navigation'],
    ['PDF 阅读状态', 'PDF reading status'],
    ['PDF 页处理进度', 'PDF page processing progress']
  ]);
  cases.forEach((expected, source) => {
    assert.equal(translateInterfaceText(source, 'en'), expected, source);
    assert.equal(translateInterfaceText(source, 'zh-CN'), source, source);
  });
});

test('localizes article-chat web-search controls, sources, and fail-closed errors', () => {
  const cases = new Map([
    ['联网', 'Web'],
    ['为下一轮开启联网搜索', 'Enable web search for the next question'],
    ['为下一轮关闭联网搜索', 'Disable web search for the next question'],
    ['联网搜索已关闭；点击后下一轮将检索网络',
      'Web search is off; click to search the web for the next question'],
    ['联网搜索已开启；点击后下一轮仅使用论文正文',
      'Web search is on; click to use only the article text for the next question'],
    ['联网来源', 'Web sources'],
    ['本回答引用的联网来源', 'Web sources cited in this answer'],
    ['联网来源 2：Example（example.org）', 'Web source 2: Example (example.org)'],
    ['打开联网来源 2：Example（example.org）', 'Open web source 2: Example (example.org)'],
    ['当前模型不支持联网搜索；请关闭“联网”后重试，或切换支持联网的模型。',
      'The current model does not support web search. Turn off “Web” and retry, or switch to a model that supports web search.'],
    ['联网检索没有返回可核验来源；本轮回答未采用，请重试。',
      'Web search returned no verifiable sources, so this answer was discarded. Please retry.'],
    ['联网回答或来源未完整返回；本轮回答未采用，请重试。',
      'The web-grounded answer or its sources were incomplete, so this answer was discarded. Please retry.'],
    ['当前 Provider、模型或接口地址不支持可验证的联网检索。请关闭“联网”后重试，或切换到支持该能力的官方接口。',
      'The current provider, model, or endpoint does not support verifiable web search. Turn off “Web” and retry, or switch to an official endpoint that supports it.'],
    ['联网回答没有返回可验证且与本次回答绑定的来源，因此结果未被展示或保存。请重试或更换支持联网检索的模型。',
      'The web-grounded answer returned no verifiable sources bound to this answer, so the result was not displayed or saved. Retry or switch to a model that supports web search.'],
    ['联网检索结果不完整或格式校验失败，因此未展示未经完整验证的回答。请重试。',
      'The web-search result was incomplete or failed format validation, so the unverified answer was not displayed. Please retry.'],
    ['联网回答未能完整保存到当前论文工作区，因此没有发布该结果。请检查工作区后重试。',
      'The web-grounded answer could not be fully saved to the current article workspace, so the result was not published. Check the workspace and retry.'],
    ['当前问答模型不支持带来源的联网搜索，请关闭联网搜索或切换模型。',
      'The current chat model does not support sourced web search. Turn off web search or switch models.'],
    ['联网回答缺少可验证的信息源，未发布本次回答。',
      'The web-grounded answer lacked verifiable sources, so it was not published.'],
    ['联网回答未完整返回，未发布不完整内容。',
      'The web-grounded answer was incomplete, so incomplete content was not published.'],
    ['全文问答发送失败：联网检索没有返回可核验来源；本轮回答未采用，请重试。',
      'Failed to send the full-text question: Web search returned no verifiable sources, so this answer was discarded. Please retry.']
  ]);
  cases.forEach((expected, source) => {
    assert.equal(translateInterfaceText(source, 'en'), expected, source);
    assert.equal(translateInterfaceText(source, 'zh-CN'), source, source);
  });
});

test('covers static placeholders, titles, and accessible labels in English mode', () => {
  const files = [
    'action-popup.html', 'popup.html', 'options.html',
    'pdf-reader.html', 'offline-reader.html', 'logic-map.html'
  ];
  const misses = [];
  for (const file of files) {
    const html = fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
      .replace(/<!--[\s\S]*?-->/g, '');
    const values = [...html.matchAll(/(?:placeholder|title|aria-label)="([^"]+)"/g)]
      .map(match => match[1].replace(/&[^;]+;/g, ' ').replace(/\s+/g, ' ').trim())
      .filter(value => /[\u3400-\u9fff]/u.test(value));
    for (const value of new Set(values)) {
      if (translateInterfaceText(value, 'en') === value) misses.push(`${file}: ${value}`);
    }
  }
  assert.deepEqual(misses, []);
});
