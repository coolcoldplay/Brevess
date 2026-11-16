(function (root) {
  'use strict';
  const api = root.SciLLM || (typeof module === 'object' ? require('./i18n.js') : {});
  const entries = Object.fromEntries(`
微信赞赏二维码	WeChat support QR code
支付宝赞赏二维码	Alipay support QR code
文献雷达 · Brevess	Literature radar · BREVESS
文献雷达	Literature radar
让新文献，沿着你的研究问题汇集。	Follow new literature relevant to your research questions.
新建追踪任务	New tracking task
追踪任务	Tracking tasks
本机保存 · PubMed	Saved locally · PubMed
固定检索式，持续发现。其他文献源尚未接入。	Keep discovering papers with a saved query. Other literature sources are not connected yet.
正在读取运行状态…	Loading status…
从一个研究问题开始	Start with a research question
新建文献追踪任务，保存 PubMed 检索式。首次检索建立基线，后续新增按时间汇集在这里。	Create a tracking task and save a PubMed query. The first search establishes a baseline; newly discovered papers appear here in chronological order.
支持字段标签、布尔逻辑和 PubMed 原生检索语法。	Supports field tags, Boolean operators, and native PubMed query syntax.
编辑检索式	Edit query
立即检查	Check now
暂停自动检查	Pause automatic checks
最近成功检查	Last successful check
尚未检查	Not checked yet
最近尝试	Last attempt
监测间隔	Check interval
检索口径与运行说明	Search scope and operation
按 PubMed 记录创建日期 CRDT 检索，向前重叠 7 天，以 PMID 去重。首次结果属于基线；“新增”是后续检查首次发现的匹配记录。晚到索引和历史修订超过重叠范围可能漏检。按入库日期由新到旧排列；日期缺失时用本机首次发现时间。	Searches by PubMed record creation date (CRDT), with a seven-day overlap and PMID deduplication. Initial results form the baseline; new results are matching records first found in later checks. Late indexing and older revisions outside the overlap may be missed. Results are ordered by entry date, newest first, or by local discovery time when the date is unavailable.
检索时间按 UTC 日界覆盖；七天重叠避免同日漏检。浏览器关闭时不运行，休眠恢复后补查到期任务。每次完整检查成功才更新进度。最多每次处理 5,000 篇，超限会明确失败并保留进度。	Search dates use UTC day boundaries, with a seven-day overlap to avoid gaps. Checks stop when the browser closes; overdue tasks resume after wake-up. Progress updates only after a complete successful check. Each check handles up to 5,000 papers; exceeding this limit reports a failure and preserves progress.
检索式会发送给 NCBI；任务与结果保存在本机扩展数据库。没有邮件、外部推送或自动 AI 分析。	Queries are sent to NCBI. Tasks and results are stored in the local extension database. No email, external notifications, or automatic AI analysis is performed.
PubMed 日期与检索说明 ↗	PubMed date and search documentation ↗
基线	Baseline
检索版本	Query version
AI 相关性评分	AI relevance scoring
使用“语义查找”配置的模型，依据标题和摘要逐篇评分。仅点击开始后调用模型；扫描、展开和排序不调用 AI。	Uses the Semantic search model to score each paper by its title and abstract. The model runs only after you click Start; scanning, expanding, and sorting do not call AI.
相关性描述	Relevance criteria
PubMed 入库日期 · 从	PubMed entry date · From
至（含当日）	To (inclusive)
开始 / 继续评分	Start / resume scoring
停止	Stop
已保存的评分任务	Saved scoring tasks
选择已保存的评分任务	Select a saved scoring task
仅未读	Unread only
补齐摘要	Fetch missing abstracts
时间从新到旧	Newest first
相关性从高到低	Highest relevance first
指向标题或摘要，按 Alt 查看中文对照	Point to a title or abstract and press Alt to view its Chinese translation
加载更多	Load more
新建文献追踪任务	New literature tracking task
编辑文献追踪任务	Edit literature tracking task
雷达名称	Radar name
PubMed 检索式	PubMed query
AI 生成检索式	Generate a query with AI
使用全局默认模型生成可编辑候选。原检索式保留，应用后仍需手动保存。	Generate an editable candidate with the global default model. The original query is preserved; save manually after applying a candidate.
研究需求或已有检索式	Research requirements or existing query
AI 生成候选	Generate candidate
停止生成	Stop generation
候选检索式（可编辑）	Candidate query (editable)
验证 PubMed 解析	Validate with PubMed
应用候选	Apply candidate
保留 PubMed 原生语法。请使用可长期复用的检索式，监测日期由雷达添加。	Use native PubMed syntax and a reusable query. The radar adds the monitoring dates.
在 PubMed 预览 ↗	Preview in PubMed ↗
监测间隔（小时）	Check interval (hours)
1–720 小时；0 表示仅手动检查。	1–720 hours; 0 means manual checks only.
首次回溯	Initial lookback
今天入库	Added today
最近 7 天	Last 7 days
最近 30 天	Last 30 days
最近 90 天	Last 90 days
首次结果单列为基线，不计为新增。	Initial results form a separate baseline and are not counted as new.
启用自动检查	Enable automatic checks
启用后，在运行条件允许时检查到期任务。	When enabled, overdue tasks run whenever the browser is available.
保存雷达	Save radar
文献追踪任务	Literature tracking tasks
文献时间流	Literature timeline
文献类型	Paper type
例如：胶质母细胞瘤免疫治疗中，肿瘤微环境对治疗响应的影响	For example: how the tumor microenvironment affects response to glioblastoma immunotherapy
关闭编辑	Close editor
例如：胶质母细胞瘤免疫治疗	For example: glioblastoma immunotherapy
用中文或英文描述希望追踪的研究	Describe the research you want to follow in Chinese or English
还没有追踪任务。	No tracking tasks yet.
已暂停	Paused
仅手动	Manual only
正在检查 PubMed…	Checking PubMed…
最近检查失败 · 原进度已保留	Last check failed · Progress preserved
待建立首次基线	Waiting for the initial baseline
已建立基线 · 持续追踪新增	Baseline established · Tracking new papers
检查中…	Checking…
已暂停（可手动检查）	Paused (manual checks available)
PubMed 解析：	PubMed interpretation:
PubMed 提示：	PubMed notice:
· 当前	· Current
· 历史	· Historical
相关性从高到低 · 并列按时间	Highest relevance first · Ties ordered by time
时间由新到旧	Newest first
· 历史检索版本	· Historical query version
首次检查后，基线文献将出现在这里。	Baseline papers appear here after the first check.
尚无新增文献。首次结果可在“基线”中查看。	No new papers yet. Initial results are available under Baseline.
当前筛选下没有文献。	No papers match these filters.
PubMed 入库	Added to PubMed
首次发现	First discovered
新增 · 已读	New · Read
新增 · 未读	New · Unread
未提供标题	No title provided
标为未读	Mark unread
标为已读	Mark read
操作失败，请重试。	Action failed. Please retry.
修改检索式或回溯范围后，会建立新的基线版本；旧文献记录保留在历史版本中。	Changing the query or lookback creates a new baseline version. Earlier paper records remain in the version history.
追踪任务已保存。	Tracking task saved.
正在从 PubMed 检索，请稍候…	Searching PubMed. Please wait…
后台周期检查已接入。浏览器关闭时暂停，重新激活后补查到期任务。	Periodic background checks are enabled. They pause when the browser closes and resume overdue tasks when it becomes active again.
当前为页面内周期检查：工作台或雷达页面需保持打开。后台周期检查尚未接入。	Periodic checks currently run in this page; keep the workbench or radar open. Background checks are not connected yet.
操作未完成，请稍后重试。	The action did not complete. Please retry shortly.
语义查找配置	Semantic search configuration
尚未选择评分任务；分数不会自动生成。	No scoring task selected. Scores are not generated automatically.
摘要已补齐	Abstracts fetched
鼠标指向或聚焦本块，按下并松开 Alt 显示/隐藏中文对照	Point to or focus this block, then press and release Alt to show or hide the Chinese translation
中文对照	Chinese translation
PubMed 未提供摘要	No abstract provided by PubMed
摘要获取失败 · 可补齐重试	Abstract fetch failed · Retry fetching
摘要待补齐	Abstract not fetched yet
来源记录没有摘要，未生成替代内容。	The source record has no abstract. No substitute content was generated.
点击“补齐摘要”获取 PubMed 原文；此操作不调用 AI。	Click Fetch missing abstracts to retrieve the PubMed text. This does not call AI.
未评分 · PubMed 无摘要	Not scored · No abstract in PubMed
未评分 · 摘要待补齐	Not scored · Abstract not fetched yet
已停止 · 可继续评分	Stopped · Scoring can resume
评分中…	Scoring…
未评分 · 不在此任务范围或内容已更新	Not scored · Outside this task or content has changed
翻译组件尚未载入。	The translation component has not loaded.
正在检查当前原文翻译配置…	Checking the full-text translation configuration…
已切换缓存的中文对照。	Toggled the cached Chinese translation.
当前配置为浏览器本地翻译，但本浏览器暂不可用；可在模型设置中选择原文翻译服务。	Browser-local translation is configured but unavailable in this browser. Choose a full-text translation service in model settings.
中文对照已保存。	Chinese translation saved.
已停止生成；原检索式保留。	Generation stopped. The original query is preserved.
请填写研究需求或已有检索式。	Enter research requirements or an existing query.
正在使用全局默认模型生成候选检索式…	Generating a candidate query with the global default model…
全局默认	Global default
候选待验证。生成和应用均不会自动保存或扫描。	Candidate awaiting validation. Generating or applying it does not save or run a search automatically.
正在读取 PubMed 解析反馈…	Reading PubMed validation feedback…
PubMed 错误：	PubMed error:
提示：	Note:
候选已应用到检索框，尚未保存或扫描。	Candidate applied to the query field. It has not been saved or searched.
已请求停止；正在收尾，已完成结果保留。	Stop requested. Finishing the current step and preserving completed results.
已停止，可继续	Stopped; can resume
本轮完成	Run complete
`.trim().split('\n').map(line => line.split('\t')));
  const templates = [
    ['{0} 篇未读新增 · {1}', '{0} new unread papers · {1}', [1]],
    ['每 {0} 小时', 'Every {0} hours'],
    ['上次成功覆盖：{0} — {1}（含去重重叠窗口）', 'Last successful coverage: {0} — {1} (including the deduplication overlap)'],
    ['首次回溯 {0} 天；检查成功后开始累计新增。', 'Initial lookback: {0} days. New papers accumulate after a successful check.'],
    ['{0} 最近成功时间：{1}。可手动重试。', '{0} Last successful check: {1}. You can retry manually.', [0]],
    ['版本 {0}{1}', 'Version {0}{1}', [1]],
    ['{0} 篇 · {1}{2}', '{0} papers · {1}{2}', [1,2]],
    ['首次基线已建立：{0} 篇，不计为新增。', 'Initial baseline established: {0} papers, excluded from the new-paper count.'],
    ['检查完成：发现 {0} 篇新增文献。', 'Check complete: {0} new papers found.'],
    ['所选范围 {0} 篇 · 可评分 {1} 篇 · 摘要待补齐或无摘要 {2} 篇{3}。仅对本版本已扫描文献评分。', '{0} papers in scope · {1} eligible for scoring · {2} missing or unavailable abstracts{3}. Scores apply only to papers scanned in this version.', [3]],
    ['· {0} 篇入库日期未知，未纳入', '· {0} papers with unknown entry dates excluded'],
    ['{0} · {1}—{2} · {3} 篇', '{0} · {1}—{2} · {3} papers'],
    ['当前结果来自已保存任务 · 模型：{0} · 分数表示相关性，不是概率。', 'Results from a saved task · Model: {0} · Scores indicate relevance, not probability.', [0]],
    ['补齐摘要（{0}）', 'Fetch missing abstracts ({0})'],
    ['相关性 {0}/100', 'Relevance {0}/100'],
    ['评分失败 · {0}', 'Scoring failed · {0}', [0]],
    ['正在翻译所指向的{0}…', 'Translating the selected {0}…', [0]],
    ['模型：{0}。{1}', 'Model: {0}. {1}', [0,1]],
    ['PubMed 命中 {0} 篇。', 'PubMed matched {0} papers.'],
    ['{0}{1}\n解析：{2}\n可解析不代表符合研究意图，请人工检查候选。', '{0}{1}\nInterpretation: {2}\nA valid query may still differ from your research intent. Review the candidate manually.', [0,1]],
    ['摘要补齐 {0}/{1}，失败 {2} 篇。', 'Abstracts fetched: {0}/{1}; {2} failed.'],
    ['摘要补齐完成：处理 {0} 篇，失败 {1} 篇。未改变新增计数。', 'Abstract fetch complete: {0} processed, {1} failed. New-paper counts are unchanged.'],
    ['模型：{0} · 逐篇评分中…', 'Model: {0} · Scoring papers…', [0]],
    ['已评分 {0} 篇 · 复用 {1} 篇 · 失败 {2} 篇。', '{0} scored · {1} reused · {2} failed.'],
    ['{0}：评分 {1} 篇，复用 {2} 篇，失败 {3} 篇。无摘要不计分；分值表示相关性，不是准确率。', '{0}: {1} scored, {2} reused, {3} failed. Papers without abstracts are not scored; scores indicate relevance, not accuracy.', [0]]
  ];
  const patterns = templates.map(template => api.compileInterfaceTemplate(template));
  api.registerInterfaceTranslations?.(entries, patterns);
  if (typeof module === 'object' && module.exports) module.exports = { entries, templates, patterns };
})(globalThis);
