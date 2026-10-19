(function(root) {
  const api=root.SciLLM || (typeof module==='object'?require('./i18n.js'):{});
  const entries=Object.fromEntries(`
就绪	Ready
正在应用…	Applying…
填写中文全称	Enter the full name in Chinese
填写含义	Enter the meaning
停止整页翻译	Stop full-page translation
当前网页已变化，请重新打开扩展菜单。	The page changed. Reopen the extension menu.
请到网页中确认启用本地翻译。	Confirm local translation on the webpage.
已启动整页翻译，可在网页中查看进度。	Full-page translation started. View its progress on the webpage.
整页翻译已停止，已有译文保留。	Full-page translation stopped. Existing translations are preserved.
设置已保存；点击工具按钮或划选文字即可使用。	Settings saved. Click a tool button or select text to use it.
操作失败，请刷新网页后重试。	The operation failed. Refresh the webpage and retry.
工具未能加载，请刷新网页后重试。	The tool could not load. Refresh the webpage and retry.
开启开关后，按需检索、划句或翻译。	Enable the tools, then search, select text or translate as needed.
无法打开 PDF 阅读器。	Could not open the PDF reader.
无法打开课题工作台。	Could not open the research workbench.
请先完成 ANNOTATION_CLEAR_DOCUMENT	Complete ANNOTATION_CLEAR_DOCUMENT first.
必应	Bing
请输入有效的查词网址。	Enter a valid dictionary lookup URL.
查词网址仅支持不含账户信息的 http 或 https 页面。	Lookup URLs must use HTTP or HTTPS and contain no account credentials.
自定义网站请在搜索网址中用 {query} 代替查词内容。	Use {query} for the lookup term in a custom search URL.
请保留 1–20 个查词网站。	Keep between 1 and 20 lookup sites.
网站标识重复，请删除后重新添加。	Duplicate site identifier. Remove the site and add it again.
请选择一个默认查词网站。	Select a default lookup site.
该行没有可查询的词语。	This row has no term to look up.
已准备可用原文；等待模型回答。	Available source text is ready. Waiting for the model's answer.
回答尚未完整，正在继续生成。	The answer is incomplete. Continuing generation.
本轮需要联网核验，等待服务端返回。	This turn needs web verification. Waiting for the service.
本轮基于已提供的材料回答，无需联网。	This turn uses the supplied material without web access.
检索决策：	Search decision:
服务端报告检索已完成；来源仍待核验。	The service reports the search is complete. Sources still need verification.
服务端报告正在检索；来源仍待核验。	The service reports the search is in progress. Sources still need verification.
模型在多次自动续写后仍达到实际输出上限；已保留已完成的回答块。	The model still reached its output limit after repeated continuation. Completed answer blocks are preserved.
部分模型输出连续未通过格式或引用校验；已保留通过校验的回答块。	Some model output repeatedly failed format or citation checks. Validated answer blocks are preserved.
模型多次续写后仍以未完成的引导句结束；已保留已经完成的回答块。	The model still ended with an incomplete lead-in after repeated continuation. Completed answer blocks are preserved.
部分选中页仍缺少可以精确定位的引用；已保留通过校验的回答，可重试补全。	Some selected pages still lack precisely located citations. Validated answers are preserved; retry to complete them.
模型多次续写后仍未形成完整回答；已保留已经完成的回答块。	The model did not complete the answer after repeated continuation. Completed answer blocks are preserved.
旧页面或浏览器会话已结束，原调用的远端终态仍未确认。原次数和 token 预留保留，当前目标暂停；可继续独立目标。	The previous page or browser session ended, but the remote call's final state is unconfirmed. Request and token reservations remain; this target is paused. Independent targets can continue.
旧请求缺少可核验的页面归属，无法确认原调用是否结束。原次数和 token 预留保留，当前目标暂停；可继续独立目标。	The previous request lacks a verifiable page identity, so completion is unconfirmed. Request and token reservations remain; this target is paused. Independent targets can continue.
旧请求仍占用额度，尚无证据确认原页面已退休或远端调用已结束。请先通过原操作的取消或释放控件退出，再核验终态；可继续独立目标。	The previous request still reserves capacity, and its page retirement or remote completion is unconfirmed. Use the original operation's cancel or release control, then verify its final state. Independent targets can continue.
模型映射响应无效，已按图注明示关系保守挂接；建议人工确认。	The model's mapping was invalid. Links use only relationships explicitly stated in captions; review them manually.
模型映射响应无效，已临时挂接到最接近的主图；具体关系需要人工确认。	The model's mapping was invalid. Temporarily linked to the nearest main Figure; verify the relationship manually.
现有证据存在不确定性或不能唯一对应节点，待人工核验。	The evidence is uncertain or does not identify a unique node. Manual verification is required.
高亮备注与译文	Highlight notes and translations
已确认译文已保留。	Confirmed translations are preserved.
翻译尚未全部完成；仅保留已确认内容，未译部分仍为原文。	Translation is incomplete. Only confirmed translations are preserved; unfinished sections retain the source text.
译文（部分完成）	Translation (partially complete)
译文	Translation
原句未提供	Source sentence not provided
返回高亮原句	Return to the highlighted sentence
不支持或缺少 brevess-library-transfer-v1 envelope。	The brevess-library-transfer-v1 envelope is missing or unsupported.
transfer kind 不匹配。	Transfer kind does not match.
transfer payload 或时间戳无效。	Invalid transfer payload or timestamp.
transfer 完整性校验失败。	Transfer integrity verification failed.
combined transfer 缺少 radars 或 entries。	The combined transfer is missing radars or entries.
已保存的精确引文（导出时未重新核验）：	Saved exact quotation (not reverified during export):
来源已过期，待重新核验。	The source is stale and needs verification again.
来源存在歧义，待核验。	The source is ambiguous and needs verification.
未找到正文来源。	The source was not found in the article text.
来源记录无效，无法定位。	The source record is invalid and cannot be located.
历史内容，来源未保存。	Historical content; its source was not saved.
来源记录无法核验。	The source record cannot be verified.
来源标记不能拆开修改；请选中完整标记后替换或删除。当前内容已保留。	Source markers cannot be edited in parts. Select the whole marker to replace or delete it. Current content is preserved.
来源显示暂不可用，已保留原文；请检查后再复制或导出。	Source display is temporarily unavailable. Original text is preserved; check it before copying or exporting.
来源未保存：笔记正文必须为非空字符串。	Source not saved: note content must be a nonempty string.
来源未保存：追加引用会超过 12000 字符，正文已完整保留。	Source not saved: adding citations would exceed 12,000 characters. The full note is preserved.
来源未保存：生成结果未提供可保存的来源。	Source not saved: the generated result supplied no source that can be saved.
来源未保存：来源 ID 不符合当前段落引用格式。	Source not saved: its ID does not match the current paragraph citation format.
来源未保存：来源信息超出安全处理范围。	Source not saved: the source information exceeds safe processing limits.
来源未保存：缺少本次生成的来源回执。	Source not saved: the source receipt for this generation is missing.
来源未保存：来源回执与当前文献不一致。	Source not saved: its receipt does not match the current article.
来源未保存：回执未包含全部指定段落。	Source not saved: the receipt does not include every specified paragraph.
来源未保存：回执中段落 ID 重复或相互矛盾。	Source not saved: paragraph IDs in the receipt are duplicated or inconsistent.
来源未保存：来源显示模块未就绪。	Source not saved: the source display module is not ready.
来源未保存：引用无法安全显示，格式或显示长度超限。	Source not saved: the citation exceeds format or display-length limits and cannot be shown safely.
来源未保存：新增引用处于代码或其他不可识别的格式中。	Source not saved: the new citation is inside code or another unsupported format.
来源未保存：正文中的引用不属于本字段的已核验来源。	Source not saved: a citation in the text is not among this field's verified sources.
来源未保存：来源信息无法安全读取。	Source not saved: the source information cannot be read safely.
请填写名称与 PubMed 检索式，并选择有效的回溯范围和频率。	Enter a name and PubMed query, then select a valid lookback period and frequency.
文献雷达本地数据版本或结构异常；原数据已保留，未覆盖。	The local radar data version or structure is invalid. Original data is preserved and has not been overwritten.
PubMed 摘要 XML 不完整或格式无效。	PubMed abstract XML is incomplete or invalid.
PubMed 未返回部分 PMID 的摘要记录，可稍后补齐。	PubMed did not return abstracts for some PMIDs. Fetch the missing abstracts later.
无法连接 PubMed 或响应无效，请检查网络后重试。	Could not connect to PubMed or its response was invalid. Check your connection and retry.
检索范围过大，请缩小检索式或首次回溯范围。	The search scope is too large. Narrow the query or initial lookback period.
PubMed 未接受部分检索条件。请在 PubMed 核对字段、引号和括号。	PubMed rejected some search conditions. Check the fields, quotation marks and parentheses in PubMed.
单日结果超过当前 PubMed 单次提取边界（9,999 篇），请缩小检索式。	One day's results exceed the PubMed retrieval limit of 9,999 articles. Narrow the query.
PubMed 返回的 PMID 数量不完整，请重试。	PubMed returned an incomplete set of PMIDs. Retry the request.
本次超过 5,000 篇处理上限。未截断、未推进进度；请缩小检索式或回溯范围。	This run exceeds the 5,000-article processing limit. Nothing was truncated and progress was not advanced. Narrow the query or lookback period.
部分文献信息缺失，本次进度已保留。请稍后重试。	Some article metadata is missing. Progress is preserved; retry later.
部分摘要获取失败，文献已保留；可点击“补齐摘要”重试。	Some abstracts could not be fetched. Articles are preserved; choose “Fetch missing abstracts” to retry.
RADAR_BUSY：另一个雷达正在检查，请稍后重试。	RADAR_BUSY: Another radar check is running. Retry later.
检查超时，已保留上次进度。可稍后重试或缩小检索式。	The check timed out. Previous progress is preserved. Retry later or narrow the query.
检索式已变化，本次旧结果未写入。	The query changed. Results for the previous query were not written.
最多保存 50 个雷达。	You can save up to 50 radars.
此检索式已被其他窗口或 Agent 修改。请重新打开后编辑。	Another window or agent changed this query. Reopen it before editing.
radar transfer payload 无效。	Invalid radar transfer payload.
radar transfer state 无效。	Invalid radar transfer state.
radar revisions/articles 无效。	Invalid radar revisions or articles.
radar 论文身份无效。	Invalid radar article identity.
radar import 需要 8–160 字符 idempotencyKey。	Radar import requires an idempotencyKey of 8–160 characters.
idempotencyKey 不能使用原型属性名。	The idempotencyKey cannot be a prototype property name.
radar transfer revision 已变化。	The radar transfer revision changed.
PDF 全文	Full PDF text
离线快照在移除图片后仍超过 64 MiB，未保存；请缩短正文后重试。	The offline snapshot still exceeds 64 MiB after removing images and was not saved. Shorten the article text and retry.
共享请求失败	Sharing request failed
在 Fig 色块以外长按 0.4 秒拖动排序；Alt+↑/↓ 调整展示位置	Hold outside the Figure color block for 0.4 seconds to drag; use Alt+↑/↓ to reorder.
排序保存未确认	The order change has not been confirmed as saved.
研究类型自动识别失败，请手动确认后再分析。	Study-type detection failed. Confirm the type manually before analysis.
用户选择	User selection
该 Figure 的来源尚未取得完整证明。	This Figure's source has not been fully verified.
来源待补齐	Source information incomplete
缺失图：	Missing Figures:
下载页记录与原材料/论文绑定不一致	The download-page record does not match the original material or article.
下载页来源尚未确认	The download-page source is unconfirmed.
下载目标与原材料归属不一致	The download target does not belong to the original material.
出版社附件页未提供同文献唯一下载入口	The publisher's attachment page provides no unique download for this article.
出版社附件页指向数据文件，须检查原文件格式和内容	The publisher's attachment page points to a data file. Check its original format and contents.
附件页没有唯一可确认的补充 PDF 下载链接	The attachment page has no uniquely verifiable supplementary PDF download.
补充材料链接无效	Invalid supplementary-material link.
出版社附件获取失败	Could not fetch the publisher's attachment.
附件重定向链接无效	Invalid attachment redirect link.
附件重定向不属于原始论文/附件	The attachment redirect does not belong to the original article or attachment.
补充材料超过文件大小限制	The supplementary material exceeds the file-size limit.
附件响应无法读取	The attachment response cannot be read.
出版社响应不是有效 PDF	The publisher's response is not a valid PDF.
附件包装页超过读取限制	The attachment wrapper page exceeds the read limit.
附件包装页已离开原始出版社来源	The attachment wrapper page has left the original publisher's origin.
附件下载链接循环	Attachment download links form a loop.
未取得原始 PDF	The original PDF was not obtained.
模型未确认	Model unconfirmed
Token：未提供	Tokens: not provided
浏览器内置朗读应在当前页面播放，无需连接语音服务。	Browser speech should play on the current page without connecting to a speech service.
增强网页快照	Enhanced webpage snapshot
AI 运行中	AI is running
记录内容…	Record content…
停用	Disable
启用	Enable
本图问题：	Question addressed by this Figure:
核心结论：	Core conclusion:
证据边界：	Evidence limits:
组图逻辑：	Figure composition logic:
遗留问题：	Remaining questions:
对论证链的贡献：	Contribution to the argument:
请在普通网页使用；浏览器内部页面及 PDF 请使用对应阅读入口。	Use this on a regular web page. For browser pages and PDFs, use their dedicated reading entry.
从本文缩略词表移除 {0}？	Remove {0} from this article's abbreviation list?
**问题：**	**Question:**
注释：	Annotation:
离线文献已切换，请重新打开	The offline article changed. Please reopen it.
请从当前文献重新打开侧栏	Please reopen the sidebar from the current article.
任务已取消	Task cancelled
任务未完成，请查看服务设置和诊断	The task did not finish. Check service settings and diagnostics.
Figure 资源地址无效	Invalid Figure resource URL
只允许读取 HTTP(S) Figure 资源	Only HTTP(S) Figure resources can be read
Figure 大图页面超过解析上限	The high-resolution Figure page exceeds the parsing limit
出版社的大图页面返回了安全验证，改用页面内原图候选	The publisher's image page requires verification. Using image candidates from the article instead.
链接既不是图片，也不是可解析的大图页面	The link is neither an image nor a supported high-resolution image page
Figure 大图页面解析超时	High-resolution Figure page parsing timed out
导出来源无效	Invalid export source
导出来源已变化	The export source changed
导出操作过多，请稍后重试	Too many exports are running. Please retry later.
图片地址无效	Invalid image URL
只允许导出 HTTP(S) Figure 图片	Only HTTP(S) Figure images can be exported
高清图地址没有返回图片	The high-resolution image URL did not return an image
单张高清图为空或超过 40 MB	The high-resolution image is empty or exceeds 40 MB
高清图下载超时	High-resolution image download timed out
已保存原图不在本地缓存中。	The saved original image is not in the local cache.
无法连接这篇离线文献，请从本机历史重新打开。	Could not connect to this offline article. Reopen it from local history.
离线文献的保存记录暂不可用，请从本机历史重新打开。	The offline article's saved record is unavailable. Reopen it from local history.
当前标签页已经变化，请重新打开菜单。	The current tab changed. Please reopen the menu.
请先确认是否在此网页开启研读侧栏。	Please confirm opening the reading sidebar on this page first.
无法解析 Figure 大图链接	Could not resolve the high-resolution Figure link
当前 PDF 已变化，书目信息未应用。请在当前 PDF 中重新保存。	The PDF changed, so bibliographic details were not applied. Save again from the current PDF.
模型返回了重复的 Panel 标记，尚不能确认完整覆盖。	The model returned duplicate Panel labels. Full coverage cannot be confirmed.
书目请求与当前 PDF 的本文 DOI 不一致。	The bibliographic request's DOI does not match the current PDF.
PDF 书目信息未通过校验，保存已停止。	PDF bibliographic validation failed. Saving stopped.
当前文献或原文已变化，翻译结果未写入。请重新打开翻译。	The article or source text changed. Translation was not saved. Please reopen translation.
翻译服务尚未就绪，请重新加载扩展后重试。	The translation service is not ready. Reload the extension and retry.
此任务使用浏览器本地翻译，请从当前阅读页启动。	This task uses browser translation. Start it from the current reading page.
解图功能已更新，请重新打开阅读页后重试。	Figure analysis was updated. Reopen the reading page and retry.
解图图片的字节或区域信息不完整，请重新加载原图后重试。	Image bytes or region details are incomplete. Reload the original image and retry.
该请求正在处理中，请等待当前请求完成。	This request is running. Wait for it to finish.
当前模型不支持图片输入，请选择支持图像理解的模型。	This model does not support images. Select a model with image understanding.
当前模型不支持按需联网判断，请选择手动联网或关闭联网。	This model does not support automatic web-access decisions. Choose manual web access or disable it.
模型未返回有效的联网判断，请重试或选择手动联网。	The model returned an invalid web-access decision. Retry or choose manual web access.
无法连接当前 PDF 阅读页，请回到原页重试解图。	Could not connect to the PDF reader. Return to that page and retry Figure analysis.
PDF 或图像已更新，请等待索引完成后重新解图。	The PDF or image changed. Wait for indexing, then retry Figure analysis.
模型未返回有效的 Panel 目录，请重新解图。	The model returned an invalid Panel index. Retry Figure analysis.
Panel 目录与当前 PDF 原图不匹配，请重新解图。	The Panel index does not match the current PDF image. Retry Figure analysis.
模型返回了无法核验的 Panel 标签，请重新解图。	The model returned unverifiable Panel labels. Retry Figure analysis.
模型返回的 Panel 标签重复，请重新解图。	The model returned duplicate Panel labels. Retry Figure analysis.
当前 Figure 的 Panel 数量超过单图支持范围。	This Figure exceeds the supported number of Panels per image.
PDF 解图上下文不完整，请刷新图目录后重试。	PDF Figure context is incomplete. Refresh the Figure index and retry.
尚未找到可核验的图注和相关正文，请等待索引完成。	Verifiable captions and related text are unavailable. Wait for indexing to finish.
这张图的跨页图注尚不完整，请等待后续页面读取完成后重试。	The caption continues across pages and is incomplete. Wait for those pages to load and retry.
PDF 解图证据已变化，请重新解图。	PDF Figure evidence changed. Retry Figure analysis.
图注或正文尚未定位到 PDF 原文，请等待索引完成。	Captions or text have not been located in the PDF. Wait for indexing to finish.
当前图的正文证据超过处理上限，请缩小分析范围。	Article evidence for this Figure exceeds the processing limit. Reduce the analysis scope.
解图模型配置已更改，请重新发起解图。	The Figure analysis model settings changed. Restart analysis.
当前图像输入不完整，请刷新图目录后重试。	Image input is incomplete. Refresh the Figure index and retry.
PDF 图像无法读取，请重新准备原图。	The PDF image cannot be read. Prepare the original image again.
PDF 图像与当前文献不匹配，请重新准备原图。	The PDF image does not match this article. Prepare the original image again.
PDF 图像已变化，请重新准备原图。	The PDF image changed. Prepare the original image again.
当前浏览器无法校验 PDF 图像，请重新打开阅读页。	The browser cannot validate the PDF image. Reopen the reading page.
Jev 的单次识别容量不足，请缩短过长的类别定义或原文范围后重试。	The request exceeds Jev's recognition capacity. Shorten category definitions or source text and retry.
本次执行窗口的目标或上限与首次预约不匹配，请核对执行范围。	Targets or limits do not match the initial reservation. Check the execution scope.
本次获准的模型调用上限已达到，已保存的进度可以继续查看。	The approved model-call limit was reached. Saved progress remains available.
本次执行窗口已停止或所属页面已变化，请重新确认后续执行范围。	This execution window stopped or its page changed. Confirm the scope before continuing.
本次确认已失效，Figure 解读已暂停；已保存结果保留。	Confirmation expired. Figure analysis paused; saved results are retained.
PDF 的视觉输入已停止；需要重新准备文字输入，已保存结果保留。	PDF image input stopped. Prepare text input again; saved results are retained.
当前摘要模型不支持结构化 JSON，请选择支持该功能的模型后重试。	The summary model does not support structured JSON. Choose a compatible model and retry.
当前文献的图注证据不完整，无法生成主要发现。请补全图注后重试。	Caption evidence is incomplete, so key findings cannot be generated. Complete the captions and retry.
删除请求缺少有效的确认记录，请刷新列表后重试。	The deletion request has no valid confirmation. Refresh the list and retry.
恢复计划已失效或不匹配，请重新扫描；未覆盖本机数据。	The restore plan expired or does not match. Scan again; local data was not overwritten.
待处理恢复计划过多，请稍后重新扫描。	Too many restore plans are pending. Scan again later.
扫描后本机数据已改变，本次恢复已停止；新修改已保留。	Local data changed after scanning. Restore stopped; new edits are preserved.
保存快照中的标注与当前文档不同，旧快照未写入目录；请读取当前标注后重新保存。	Snapshot annotations differ from the current document. The old snapshot was not written. Load current annotations and save again.
无法确认恢复文档的本机基线，本次恢复已停止。	The local baseline for this document could not be confirmed. Restore stopped.
恢复文档记录未通过校验，本次恢复已停止。	The document restore record failed validation. Restore stopped.
暂时无法校验恢复文档，本次恢复已停止。	The restore document cannot currently be validated. Restore stopped.
本机已有删除记录，不能用旧档案恢复已删除内容。	A local deletion record exists. Older archives cannot restore deleted content.
恢复数据超出当前安全处理上限，未执行部分恢复。	Restore data exceeds the safe processing limit. No partial restore was performed.
恢复基线无效，请重新扫描。	Invalid restore baseline. Scan again.
恢复资产无效，未执行部分恢复。	Invalid restore assets. No partial restore was performed.
本机恢复状态无效，未执行部分恢复。	Invalid local restore state. No partial restore was performed.
分析结果已生成，但档案保存尚未确认。请保留当前页面并重试保存。	Analysis results were generated, but archive saving is unconfirmed. Keep this page open and retry saving.
通用分析	General analysis
Figure 解读已暂停；已保存结果保留。继续文字解读需要本次确认。	Figure analysis paused; saved results are retained. Confirm to continue with text analysis.
使用当前分析模式，不需要选择论文类型。	Using the current analysis mode; no paper type selection is needed.
组图逻辑	Figure composition logic
遗留问题	Remaining questions
统计方法	Statistical methods
局部推断	Local inference
设计/组别	Design / groups
比较/对照	Comparison / control
未报告	Not reported
图像观察	Image observations
已提供图像	Image provided
据图注描述，未独立核验图像	Based on the caption; image not independently verified
据正文描述，未独立核验图像	Based on article text; image not independently verified
多来源，图像是否核验请结合解读依据	Multiple sources; consult the analysis basis for image verification
未核验图像；旧记录或推断	Image unverified; legacy record or inference
未明确	Unspecified
实验目的	Experimental objective
实验结论	Experimental conclusion
执行中	Running
自动重试	Automatic retry
等待重试	Waiting to retry
核验中	Verifying
保存中	Saving
结果待确认	Result awaiting confirmation
已停止	Stopped
部分完成	Partially complete
需处理	Action required
等待状态	Waiting for status
正文已更新	Article text updated
当前 PDF 页数不可用，请重新绑定文献。	The PDF page count is unavailable. Rebind the article.
请使用物理页码或范围，例如 5-6。	Use physical page numbers or ranges, such as 5–6.
请选择 1–4 个不重复的物理页码。	Select 1–4 distinct physical page numbers.
停止确认中（仅查询回执）	Confirming stop (receipt checks only)
译文保存失败	Translation could not be saved
翻译已阻塞，请检查模型配置/额度	Translation is blocked. Check model settings and quota.
等待原请求回执，不重复推理	Waiting for the original request receipt; no duplicate inference
翻译自动重试中	Translation is retrying automatically
当前范围译文已全部保存；点击停止，译文保留	All translations in scope are saved. Click to stop; saved translations are retained.
翻译进行中；点击停止，保留已保存译文	Translation in progress. Click to stop; saved translations are retained.
开启/继续全文翻译，复用已保存译文	Start or resume article translation, reusing saved translations
原文存疑	Source concern
缺口	Gap
目标	Objective
策略	Strategy
结果	Result
关键	Key point
创新	Novelty
未来	Future work
因果	Causality
中介	Mediation
时序/剂量	Timing / dose
机制缺口	Mechanistic gap
替代机制	Alternative mechanism
样本	Sample
测量	Measurement
不确定性	Uncertainty
稳健性	Robustness
混杂/反向	Confounding / reverse causation
因果越界	Causal overreach
外推	Generalization
实际意义	Practical significance
可复现	Reproducibility
范围	Scope
共识	Consensus
证据质量	Evidence quality
框架	Framework
综合	Synthesis
强调	Emphasis
检索	Search
请选择 1–20000 个字符后朗读；更长的内容请分段选择。	Select 1–20,000 characters to read aloud. Select longer passages in sections.
这一段的朗读请求超时，请检查服务后重试。	The read-aloud request timed out. Check the service and retry.
朗读服务拒绝了这一段请求，请检查服务状态和设置。	The read-aloud service rejected this request. Check its status and settings.
这一段未返回有效音频，请检查朗读服务。	No valid audio was returned. Check the read-aloud service.
这一段音频为空或超过大小限制。	The audio is empty or exceeds the size limit.
音频播放失败，请检查浏览器的音频权限。	Audio playback failed. Check browser audio permissions.
此浏览器暂不支持内置朗读，请更换浏览器或在设置中选择其他朗读方式。	This browser does not support built-in read-aloud. Use another browser or choose a different method in settings.
浏览器未提供可用音色，请安装系统语音包后重试，或在设置中选择其他朗读方式。	No browser voices are available. Install a system speech pack or choose another read-aloud method.
所选浏览器音色当前不可用，请在朗读设置中重新选择音色或选择自动。	The selected browser voice is unavailable. Select another voice or Automatic in read-aloud settings.
浏览器正在播放其他朗读，请等待或停止该朗读后重试。	The browser is reading other content. Wait or stop that playback before retrying.
浏览器朗读未正常响应，请点击朗读重试或检查系统语音设置。	Browser read-aloud is not responding. Retry or check system speech settings.
朗读失败，请检查设置。	Read-aloud failed. Check settings.
朗读服务超时。	The read-aloud service timed out.
朗读失败。	Read-aloud failed.
朗读音频无效。	Invalid read-aloud audio.
音频播放失败。	Audio playback failed.
无法核验雷达页面身份，请重新打开工作台。	The radar page identity could not be verified. Reopen the workbench.
AI 请求字段无效。	Invalid AI request fields.
候选检索式的括号、引号、布尔运算符或字段标签有误，请编辑后再验证。	The candidate query has invalid brackets, quotes, Boolean operators or field tags. Edit it and validate again.
模型输出格式不合格，未写入结果。	The model output format is invalid. Results were not saved.
模型配置已变化，请重新开始。	Model settings changed. Please start again.
该文献已有评分请求，请等待完成。	A scoring request for this paper is already running. Wait for it to finish.
文献内容已变化，本次旧结果未写入。	Paper content changed. The outdated result was not saved.
该文献不在指定的 PubMed 入库日期范围内，或入库日期未知。	This paper is outside the selected PubMed entry-date range, or its entry date is unknown.
本版本已保存 100 个评分任务，请使用已有描述和范围继续。	This version has 100 saved scoring tasks. Continue with an existing description and scope.
雷达 AI 接口尚未接入，请重新加载已更新的扩展。	The radar AI interface is unavailable. Reload the updated extension.
模型调用失败，已保留原文和已有结果。	The model request failed. Source text and existing results are preserved.
所选模型不支持文章级结构化输出，请在对应模型设置中选择支持文本生成的模型。	This model does not support structured paper output. Select a text-generation model in the corresponding settings.
本篇标题、摘要和描述超过语义模型的单次输入边界，未截断原文，也未计分。请缩短相关性描述后重试。	The title, abstract and description exceed the semantic model's input limit. Source text was not truncated and no score was assigned. Shorten the relevance description and retry.
模型认证失败，请检查对应服务配置；原文和已有结果已保留。	Model authentication failed. Check the service configuration; source text and existing results are preserved.
尚未配置可用模型，请检查对应的模型设置。	No available model is configured. Check the corresponding model settings.
请先配置模型并启用模型服务。	Configure a model and enable its service first.
模型服务额度不足，已停止后续请求。	The model service has insufficient quota. Further requests stopped.
模型服务暂时限流，可稍后继续。	The model service is rate-limited. Continue later.
模型输出不完整，本篇未计分，可稍后重试。	The model output is incomplete. This paper was not scored; retry later.
已停止；已完成的逐篇结果已保存。	Stopped; completed per-paper results are saved.
整篇标题与摘要的语义匹配分（JEV 结构化判定换算为 0–100）；未生成文字评语。	Semantic match score for the full title and abstract (JEV structured assessment scaled to 0–100); no written evaluation generated.
你正在执行“全文语义检索并高亮”，不是普通问答。	Perform semantic search and highlighting across the article, rather than general Q&A.
请找出正文中所有直接匹配该意图的重要原文句子。	Find all important original sentences in the article that directly match this intent.
回答要简短；每个匹配必须附带可逐字回定位的原文证据 citation。	Keep the answer brief. Each match must include a source citation that can be located verbatim.
不要用推测补足证据，不要返回只在标题、作者、导航、参考文献或附加界面中出现的内容。	Do not fill evidence gaps with speculation. Exclude content found only in titles, author lists, navigation, references or ancillary interface elements.
`.trim().split('\n').map(line=>line.split('\t')));
  Object.assign(entries, {
    '# Brevess：PPT 制作材料包':'# BREVESS: Presentation materials',
    '# 文献全文问答':'# Article Q&A', '## 问答 {0}':'## Q&A {0}', '## 内容':'## Contents',
    '- `figures/`：逐 Figure 保存的最高质量原图；每个图片文件都在 manifest 中记录来源。':'- `figures/`: The highest-quality original image for each Figure. Image sources are recorded in the manifest.',
    '- `analysis/figures/`：每张 Figure 的整图、Panel、Panel 追问及相关正文证据。':'- `analysis/figures/`: Figure and Panel analysis, Panel follow-up questions, and related article evidence.',
    '- `analysis/cross-figure-logic.*`：主图多米诺跨图逻辑。':'- `analysis/cross-figure-logic.*`: The argument chain across main Figures.',
    '- `analysis/fulltext-question-answer.*`：完整全文问答历史。':'- `analysis/fulltext-question-answer.*`: Complete article Q&A history.',
    '- `analysis/manual-annotations.json`：手动高亮与注释。':'- `analysis/manual-annotations.json`: Manual highlights and notes.',
    '- `PROMPT_FOR_CODEX_OR_AGENT.md`：交给本地 Codex 或其他 Agent 的制图任务。':'- `PROMPT_FOR_CODEX_OR_AGENT.md`: The figure-making task for local Codex or another agent.',
    '请先核对 `manifest.json` 中的 `missingImageFigureIds`。缺图时不要凭空重建，':'First check `missingImageFigureIds` in `manifest.json`. Do not invent missing images;',
    '应回到论文页面下载原图后再制作 PPT。':'download the originals from the article before making the presentation.'
  });
  entries['确定清除“{0}”的本地工作区吗？\n包含 {1} 轮问答、{2} 个 Figure 结果和{3} 段正文索引。此操作不可撤销。']='Delete the local workspace for “{0}”?\nThis includes {1} Q&A turns, {2} Figure results and {3} indexed paragraphs. This cannot be undone.';
  const templates=[
    ['{0}模型正在处理（已等待 {1} 秒{2}）…','{0}The model is processing (waited {1} seconds{2})…',[0,2]],
    ['，最长 {0} 秒',', up to {0} seconds'],
    ['缩写 {0}；查看完整含义并定位原文','Abbreviation {0}; view its full meaning and locate the source'],
    ['英文全称 {0}；查看完整含义并定位原文','Full English name {0}; view its full meaning and locate the source'],
    ['填写{0}','Enter {0}',[0]],
    ['保存 {0} 的中文全称','Save the full Chinese name for {0}'],
    ['保存 {0} 的含义','Save the meaning of {0}'],
    ['已保存 {0} 的中文全称','Saved the full Chinese name for {0}'],
    ['已保存 {0} 的含义','Saved the meaning of {0}'],
    ['{0} 的中文全称','Full Chinese name for {0}'],
    ['{0} 的含义','Meaning of {0}'],
    ['本轮上下文：{0}/{1} 段{2}','Context for this turn: {0}/{1} paragraphs{2}',[2]],
    ['来源 {0} · {1}','Source {0} · {1}'],
    ['（已完成 {0}/{1} 张{2}）','(Completed {0}/{1} Figures{2})',[2]],
    ['{0}：单击展开/收起 · 双击解读此 Panel · Shift+Enter 解读','{0}: click to expand/collapse · Double-click or Shift+Enter to analyze this Panel'],
    ['Figure 名称：中文简要待补；双击或按 Enter 编辑','Figure name: summary pending; double-click or press Enter to edit'],
    ['Panel 名称：描述待补；双击或按 Enter 编辑','Panel name: description pending; double-click or press Enter to edit'],
    ['用户的自然语言检索意图是：{0}','The user’s natural-language search intent is: {0}'],
    ['{0} · {1}条证据 · {2}','{0} · {1} evidence items · {2}',[0]],
    ['朗读：{0}','Read aloud: {0}',[0]],['{0}；备注草稿仍保留。','{0}; the note draft is preserved.',[0]],
    ['补充来源尚未准备完整，已保存结果保留。{0}','Supplementary sources are incomplete. Saved results are preserved. {0}',[0]],
    ['本次窗口 {0} 张（全计划 {1} 张），正在准备第 1 张…','This window: {0} Figures ({1} in the full plan). Preparing Figure 1…'],
    ['共发现 {0} 张主图和 {1} 张补充图，正在准备第 1 张…','Found {0} main and {1} supplementary Figures. Preparing Figure 1…'],
    ['{0} 已有解读，已自动跳过','{0} already has analysis; skipped automatically'],
    ['{0} 已完成，准备下一张…','{0} completed. Preparing the next Figure…'],
    ['第 {0}/{1} 张失败：{2}；{3}','Figure {0}/{1} failed: {2}; {3}',[2,3]],
    ['{0} 解读失败，已保留成功结果并继续下一张：{1}','{0} analysis failed. Successful results are preserved; continuing to the next Figure: {1}',[1]],
    ['全部 {0} 张 Figure 解读失败','Analysis failed for all {0} Figures'],
    ['；其中 {0} 张已有结果，已自动跳过','; {0} already had results and were skipped'],
    ['本次窗口（全计划 {0} 张）·','Current window ({0} Figures in the full plan) ·'],
    ['逐图解读完成 {0}/{1} 张，{2} 张分析失败{3}','Figure analysis: {0}/{1} completed, {2} failed{3}',[3]],
    ['；来源未完成：{0}','; incomplete sources: {0}',[0]],
    ['逐图解读完成：{0} 张 Figure{1}','Figure analysis complete: {0} Figures{1}',[1]],
    ['，其中 {0} 张仅使用图注与正文',', including {0} using captions and article text only'],
    ['论证贡献：{0}','Contribution to the argument: {0}'],
    ['，已锁定 {0} 个正文章节',', {0} article sections selected'],
    ['，已排除 {0} 个网页功能区或非正文单元',', {0} page controls or non-article units excluded'],
    ['已确认 {0} 个论文正文段落{1}{2}，正在分析…','Confirmed {0} article paragraphs{1}{2}. Analyzing…'],
    ['论文大纲已生成{0}','Article outline generated{0}',[0]],['论文大纲生成失败：{0}','Article outline generation failed: {0}',[0]],
    ['{0}格式不符合要求，正在自动纠正，{1} 秒后重试…','{0} format is invalid. Correcting automatically; retrying in {1} seconds…',[0]],
    ['{0}{1}，{2} 秒后重试…','{0}{1}; retrying in {2} seconds…'],
    ['当前返回格式仍不稳定，已自动拆小并继续（{0}/{1}）…','Response format remains unstable. Split into smaller chunks and continued ({0}/{1})…'],
    ['当前摘要分块过大或超时，已自动拆分并继续（{0}/{1}）…','The summary chunk is too large or timed out. Split automatically and continued ({0}/{1})…'],
    ['论文大纲已生成，正在核验保存{0}','Article outline generated. Verifying and saving{0}',[0]],
    ['{0} 请求暂时失败，{1} 秒后自动重试…','{0} request failed temporarily. Retrying in {1} seconds…'],
    ['{0} 的视觉输入不受模型支持，正改用图注与正文继续','{0} image input is unsupported by the model. Continuing with captions and article text'],
    ['{0} 的模型不支持当前视觉输入，已改用图注与正文继续解读…','The model for {0} does not support this image input. Continuing analysis with captions and article text…'],
    ['{0} 已完成','{0} completed'],['逐图解读 {0}/{1}：{2} 已完成…','Figure analysis {0}/{1}: {2} completed…'],
    ['{0}，{1} 秒后自动重试第 {2} 次{3}','{0}; retry {2} in {1} seconds{3}',[0,3]],
    ['{0}，已自动拆分为更小分块并继续分析{1}','{0}; automatically split into smaller chunks and continued analysis{1}',[0,1]],
    ['Figure 大图资源读取失败（HTTP {0}）','Could not read the high-resolution Figure resource (HTTP {0})'],
    ['高清图下载失败（HTTP {0}）','High-resolution image download failed (HTTP {0})'],
    ['{0}生成完成，正在核验/保存{1}','{0} generated; verifying / saving{1}',[0,1]],
    ['Panel 证据 {0} 无法唯一定位，请人工选择。','Panel evidence {0} cannot be uniquely located. Select it manually.'],
    ['物理页码须在 1–{0} 内，最多 4 页。','Physical pages must be between 1 and {0}, with at most 4 pages.'],
    ['· 已保存 {0}/{1}','· Saved {0}/{1}'],['· 尝试 {0} / 重试 {1}','· Attempts {0} / retries {1}'],
    ['翻译已停止 · 未完成 {0}，点击继续','Translation stopped · {0} unfinished; click to resume'],
    ['论文：{0}','Article: {0}'],['原文：{0}','Source: {0}'],['导出时间：{0}','Exported: {0}']
  ];
  // Full status sentences take precedence over generic prefix fallbacks.
  Object.assign(entries, {
  "正在提取机制节点词表…": "Extracting the mechanism-node vocabulary…",
  "正在提取正文证据…": "Extracting evidence from the article…",
  "正在读取论文图片目录…": "Reading the article image index…",
  "正在理解检索意图并核对可回定位的原文证据…": "Interpreting the search intent and checking traceable source evidence…",
  "正在继续生成…": "Continuing generation…",
  "正在检索全文并组织回答…": "Searching the full text and composing the answer…",
  "正在核验并加载，请稍候。": "Verifying and loading. Please wait.",
  "正在取消…": "Canceling…",
  "正在按自定义要求更新提示词…": "Updating the prompt with your custom requirements…",
  "正在准备图片和文件清单…": "Preparing images and the file manifest…",
  "正在重新提取当前论文…": "Extracting the current article again…",
  "正在读取当前页面结构…": "Reading the current page structure…",
  "正在生成本地标题层级与段落索引…": "Building the local heading hierarchy and paragraph index…",
  "正在发送正文证据": "Sending article evidence",
  "正在保存已核对结果": "Saving verified results",
  "正在压缩正文证据后重试": "Compressing article evidence before retrying",
  "正在修复返回格式": "Repairing the response format",
  "正在核验字段证据": "Verifying field evidence",
  "正在分析正文证据": "Analyzing article evidence",
  "正在保存正文段结果": "Saving paragraph results",
  "正在保存分析分块": "Saving analysis chunks",
  "正在重试当前分析分块": "Retrying the current analysis chunk",
  "正在拆分过长正文": "Splitting oversized article text",
  "正在更新分析设置": "Updating analysis settings",
  "正在准备正文": "Preparing article text",
  "正在综合章节结构": "Combining the section structure",
  "正在提取正文层级": "Extracting the article hierarchy",
  "正在生成诊断包…": "Generating the diagnostic package…",
  "正在综合章节结构…": "Combining the section structure…",
  "正在提取正文层级…": "Extracting the article hierarchy…",
  "正在连接本地模型桥接，尚未派发请求。": "Connecting to the local model bridge; no request has been dispatched.",
  "正在读取论文中的 Figure…": "Reading Figures from the article…",
  "正在读取当前页面的正文提取诊断…": "Reading article-extraction diagnostics for the current page…",
  "正在保存并识别 Panel…": "Saving and identifying Panels…",
  "正在本地校验、缩放并压缩图片…": "Validating, resizing and compressing the image locally…",
  "正在重新准备当前论文的本地正文，完成后继续图解…": "Preparing local article text again; Figure analysis will resume when ready…",
  "正在核验已发现 Figure 的来源…": "Verifying sources for discovered Figures…",
  "正在补齐未完成 Figure 的附件来源，已有结果保留…": "Completing attachment sources for unfinished Figures; existing results are preserved…",
  "正在生成逐段摘要…": "Generating paragraph summaries…",
  "正在提取并分析全文，可在页面右下角查看进度": "Extracting and analyzing the full text; view progress in the lower-right corner",
  "管理 PDF、提示词与文献笔记": "Manage PDFs, prompts and literature notes",
  "正在检查插件专用 Codex 会话…": "Checking the extension's dedicated Codex session…",
  "正在检查官方 Harness 安装与保存登录…": "Checking the official Harness installation and saved sign-in…",
  "正在创建插件专用登录会话…": "Creating the extension's dedicated sign-in session…",
  "正在退出插件专用 Codex 会话…": "Signing out of the extension's dedicated Codex session…",
  "正在同步": "Synchronizing",
  "正在安全处理加密配置，请稍候。": "Processing encrypted settings securely. Please wait.",
  "正在等待你选择本地目录…": "Waiting for you to select a local folder…",
  "正在请求目录读写权限…": "Requesting read and write access to the folder…",
  "正在同步本地数据…": "Synchronizing local data…",
  "正在核对目录索引并导入较新数据…": "Checking the folder index and importing newer data…",
  "正在整理 JSON 备份…": "Preparing the JSON backup…",
  "正在刷新论文工作区总览…": "Refreshing the article-workspace overview…",
  "正在整理完整迁移文件…": "Preparing the complete transfer file…",
  "正在恢复完整配置与本地记录…": "Restoring all settings and local records…",
  "正在读取类别规则…": "Reading category rules…",
  "正在校验并保存…": "Validating and saving…",
  "正在恢复内置规则…": "Restoring built-in rules…",
  "正在安全试跑当前正则…": "Safely testing the current regular expression…",
  "正在清除 MinerU Token…": "Clearing the MinerU token…",
  "正在保存 PDF 解析设置…": "Saving PDF parsing settings…",
  "正在永久删除类别…": "Permanently deleting the category…",
  "正在读取官方 Harness 的已安装模型目录…": "Reading the official Harness installed-model catalog…",
  "正在连接服务商并获取可用模型…": "Connecting to the provider and fetching available models…",
  "正在使用内置合成文本测试 JSON 与 Schema 能力；不会发送当前论文内容。": "Testing JSON and schema support with built-in synthetic text; the current article is not sent.",
  "正在停止 Figure 解读，等待后台确认；已保存结果会保留。": "Stopping Figure analysis and waiting for background confirmation; saved results are preserved.",
  "正在准备图片与上下文": "Preparing images and context",
  "正在综合整图证据链": "Combining the Figure evidence chain",
  "正在修正模型返回结构": "Repairing the model response structure",
  "正在修正 Panel 返回结构": "Repairing the Panel response structure",
  "正在准备论文正文与所选文献类型…": "Preparing article text and the selected study type…",
  "正在提取论文正文…": "Extracting article text…",
  "正在识别论文中的主图与补充 Figure…": "Identifying main and supplementary Figures in the article…",
  "正在提取综述正文与标题层级…": "Extracting review text and its heading hierarchy…",
  "正在保存逐段摘要…": "Saving paragraph summaries…",
  "正在生成…": "Generating…",
  "正在进入可直接沉浸翻译的阅读视图…": "Opening the reading view for immersive translation…",
  "正在直接读取 PDF 原页与本地文字索引。扫描件可主动使用增强识别。": "Reading original PDF pages and the local text index. Enhanced recognition is available for scans.",
  "正在使用当前出版社登录会话下载补充 PDF 并直传 MinerU…": "Downloading the supplementary PDF with the current publisher session and sending it directly to MinerU…",
  "正在读取浏览器中已经打开的本地 PDF…": "Reading the local PDF already open in the browser…",
  "正在准备本地 PDF": "Preparing the local PDF",
  "正在本机提取完整 Figure 与图注…": "Extracting complete Figures and captions locally…",
  "正在读取 PDF": "Reading the PDF",
  "正在排队": "Queued",
  "正在识别版面": "Recognizing the page layout",
  "正在申请 PDF 安全上传地址…": "Requesting a secure PDF upload URL…",
  "正在上传 PDF 到 MinerU…": "Uploading the PDF to MinerU…",
  "正在把 PDF 地址提交到 MinerU 轻量解析…": "Submitting the PDF URL for lightweight MinerU parsing…",
  "正在申请 MinerU 精准解析上传地址…": "Requesting a MinerU precision-parsing upload URL…",
  "正在上传 PDF 到 MinerU 精准解析…": "Uploading the PDF for MinerU precision parsing…",
  "正在把 PDF 地址提交到 MinerU VLM 精准解析…": "Submitting the PDF URL for MinerU VLM precision parsing…",
  "正在将高清 Figure 缓存到本地工作区…": "Caching high-resolution Figures in the local workspace…",
  "正在补充原页文字层并保存解析结果…": "Adding the original-page text layer and saving parsing results…",
  "正在完成文本识别": "Finishing text recognition",
  "正在用新版完整图引擎升级旧缓存；正文不会重新发送到 MinerU…": "Upgrading the old cache with the complete-Figure engine; article text is not sent to MinerU again…",
  "正在本机提取补图与图注": "Extracting supplementary Figures and captions locally",
  "正在准备 MinerU 解析…": "Preparing MinerU parsing…",
  "正在解析 PDF": "Parsing the PDF",
  "正在合并正文结构、完整 Figure 与分层大纲…": "Combining article structure, complete Figures and the heading outline…",
  "正在本机提取补充 PDF 的图像与图注": "Extracting images and captions from the supplementary PDF locally",
  "正在建立文字索引": "Building the text index",
  "；上游：无": "; upstream: none",
  "正在检查翻译引擎配置与可用性…": "Checking translation-engine settings and availability…",
  "正在初始化浏览器本地翻译模型…": "Initializing the browser's local translation model…",
  "正在查询已发请求的回执，已阻止重复推理。": "Checking the dispatched request's receipt; duplicate inference is blocked.",
  "正在自动继续未完成译文，合格译文和原文已保留。": "Resuming unfinished translations automatically; accepted translations and original text are preserved.",
  "正在准备本轮问答。": "Preparing this Q&A turn.",
  "正在判断本轮是否需要联网核验。": "Checking whether this turn needs web verification.",
  "正在校验并修复回答格式。": "Validating and repairing the answer format.",
  "正在重新整理回答格式。": "Reformatting the answer.",
  "待核查：当前证据台账未覆盖": "To verify: not covered by the current evidence ledger",
  "正在组合输入，请完成输入后再设置格式。": "Text composition is in progress. Finish typing before formatting.",
  "正在保存译文": "Saving the translation",
  "正在翻译所指向的标题…": "Translating the selected title…",
  "正在翻译所指向的摘要…": "Translating the selected abstract…",
  "正在读取本地库…": "Reading the local library…",
  "正在保存标签…": "Saving tags…",
  "正在校验已保存标签…": "Verifying saved tags…",
  "正在读取文献关联…": "Reading article links…",
  "正在读取 Figure 与已保存页码…": "Reading Figures and saved page numbers…",
  "正在补充检索新增文本…": "Adding newly found text to the search…",
  "正在检查当前索引中的文本…": "Checking text in the current index…",
  "正在准备当前文档…": "Preparing the current document…",
  "发现同名节点：": "Nodes with matching names: ",
  "。请选择复用当前节点或创建独立节点。": ". Reuse the existing node or create a separate node.",
  "AI 已取得，正在保存": "AI results received; saving"
});
  templates.push(...[
  [
    "正在保存 {0}/{1}",
    "Saving {0}/{1}"
  ],
  [
    "正在核对笔记 {0} / {1}…",
    "Checking notes {0} / {1}…"
  ],
  [
    "正在生成 Panel 机制关系（{0}/{1}）…",
    "Generating Panel mechanism relationships ({0}/{1})…"
  ],
  [
    "正在准备本地标题翻译：{0}%",
    "Preparing local heading translation: {0}%"
  ],
  [
    "正在翻译导航标题：{0}/{1}",
    "Translating navigation headings: {0}/{1}"
  ],
  [
    "编辑 {0} 解读",
    "Edit analysis for {0}"
  ],
  [
    "正在追问 {0}…",
    "Generating a follow-up for {0}…"
  ],
  [
    "正在解读 {0}…",
    "Analyzing {0}…"
  ],
  [
    "正在生成 {0} 的回答，完成后会自动定位到这里…",
    "Generating the answer for {0}; it will appear here when complete…"
  ],
  [
    "正在查看 PDF 物理第 {0} 页",
    "Viewing physical PDF page {0}"
  ],
  [
    "已激活 · 仅公开预览 · {0}",
    "Active · Public preview only · {0}"
  ],
  [
    "正在生成“{0}”…",
    "Generating “{0}”…"
  ],
  [
    "已保存 {0}/{1} 个字段，继续生成其余内容…",
    "Saved {0}/{1} fields; generating the remaining content…"
  ],
  [
    "正在重试 · {0}",
    "Retrying · {0}"
  ],
  [
    "正在拆分 · {0}",
    "Splitting · {0}"
  ],
  [
    "正在分析 {0}",
    "Analyzing {0}"
  ],
  [
    "正在生成逐段摘要：{0}/{1}",
    "Generating paragraph summaries: {0}/{1}"
  ],
  [
    "正在处理第 {0}/{1} 张：{2}",
    "Processing Figure {0}/{1}: {2}"
  ],
  [
    "正文 {0} 段",
    "Article text: {0} paragraphs"
  ],
  [
    "正在精读 {0}…",
    "Reading {0} in depth…"
  ],
  [
    "正在精读 {0}，请完成后再分析 {1}",
    "Reading {0} in depth; finish it before analyzing {1}"
  ],
  [
    "{0}高亮：{1}。按回车编辑",
    "{0} highlight: {1}. Press Enter to edit"
  ],
  [
    "正在使用 LLM 分析 {0} 个正文单元…",
    "Analyzing {0} article units with the LLM…"
  ],
  [
    "正在准备第 {0}/{1} 张 Figure…",
    "Preparing Figure {0}/{1}…"
  ],
  [
    "正在准备 {0}…",
    "Preparing {0}…"
  ],
  [
    "正在解读第 {0}/{1} 张：{2}",
    "Analyzing Figure {0}/{1}: {2}"
  ],
  [
    "正在生成逐段摘要（{0}/{1}）…",
    "Generating paragraph summaries ({0}/{1})…"
  ],
  [
    "{0} 页文字提取失败",
    "Text extraction failed on {0} pages"
  ],
  [
    "{0} 页无文字层",
    "{0} pages have no text layer"
  ],
  [
    "已从写入文件重新读取并逐页核验 {0} 条批注。",
    "Reread the saved file and verified {0} annotations page by page."
  ],
  [
    "已在本机提取 {0} 张完整 Figure；MinerU 碎片图不会进入正文。",
    "Extracted {0} complete Figures locally; MinerU image fragments are excluded from the article."
  ],
  [
    "{0} · 已等待 {1} 秒；页面可以保持在后台",
    "{0} · Waited {1} seconds; the page can remain in the background"
  ],
  [
    "MinerU VLM 正在精准解析{0}；页面可以保持在后台",
    "MinerU VLM precision parsing{0}; the page can remain in the background"
  ],
  [
    "已为 {0} 页补充 OCR 文字层；文字与坐标来自 MinerU，基线位置为近似，请核对原页。",
    "Added OCR text layers to {0} pages. Text and coordinates come from MinerU; baselines are approximate. Check the original pages."
  ],
  [
    "已从本地论文工作区恢复正文、分层大纲与 {0} 张完整 Figure。",
    "Restored article text, the heading outline and {0} complete Figures from the local workspace."
  ],
  [
    "已从论文工作区恢复 {0} 张完整 Figure。",
    "Restored {0} complete Figures from the article workspace."
  ],
  [
    "旧缓存已就地升级为 {0} 张完整 Figure；正文未重新解析。",
    "Upgraded the old cache to {0} complete Figures in place; article text was not parsed again."
  ],
  [
    "已从父论文工作区恢复 {0} 张完整补充 Figure。",
    "Restored {0} complete supplementary Figures from the parent article workspace."
  ],
  [
    "已从 PDF 图注建立 {0} 张图的目录；解图前请核对包含完整图像的页码。",
    "Indexed {0} Figures from PDF captions; check the pages containing complete images before analysis."
  ],
  [
    "{0} 项资源未保存",
    "{0} resources were not saved"
  ],
  [
    "图片 {0}",
    "Image {0}"
  ],
  [
    "模型仍在处理（已等待 {0} 秒）",
    "The model is still processing (waited {0} seconds)"
  ],
  [
    "已传入 {0} 张图片",
    "{0} images included"
  ],
  [
    "另有 {0} 张图片未传入",
    "{0} additional images not included"
  ],
  [
    "仅解读所选 {0} 张 Figure",
    "Analyze only the {0} selected Figures"
  ],
  [
    "解读所选 {0} 张",
    "Analyze {0} selected Figures"
  ],
  [
    "证据组 {0}",
    "Evidence group {0}"
  ],
  [
    "连接 {0}",
    "Link {0}"
  ],
  [
    "证据点 {0}",
    "Evidence point {0}"
  ],
  [
    "结论 {0}",
    "Conclusion {0}"
  ],
  [
    "问题 {0}",
    "Question {0}"
  ],
  [
    "{0} 组证据",
    "{0} evidence groups"
  ],
  [
    "{0} 条",
    "{0} items"
  ],
  [
    "；上游：{0}",
    "; upstream: {0}"
  ],
  [
    "正在准备第 {0}/{1} 张：{2}",
    "Preparing Figure {0}/{1}: {2}"
  ],
  [
    "段间关系：{0}",
    "Paragraph relationships: {0}"
  ],
  [
    "正在生成逐段摘要（{0}/{1}）{2}{3}…",
    "Generating paragraph summaries ({0}/{1}){2}{3}…",
    [
      2,
      3
    ]
  ],
  [
    "{0} 请求暂时失败，{1} 秒后自动重试第 {2} 次",
    "{0} request failed temporarily; retry {2} in {1} seconds"
  ],
  [
    "输入 {0} · 输出 {1} · {2} 次",
    "Input {0} · Output {1} · {2} calls"
  ],
  [
    "已从本地文件恢复“{0}”，读取 {1} 个内容文件。",
    "Restored “{0}” from local files; read {1} content files."
  ],
  [
    "迁移完成：恢复 {0} 篇文献记录和 {1} 条反馈。{2}",
    "Transfer complete: restored {0} article records and {1} feedback records. {2}"
  ],
  [
    "正在查看物理第 {0} 页",
    "Viewing physical page {0}"
  ],
  [
    "正在补齐 {0} 项空白内容…",
    "Completing {0} empty items…"
  ],
  [
    "{0} · 置信度 {1} · {2} 个证据原子",
    "{0} · Confidence {1} · {2} evidence atoms"
  ],
  [
    "· {0}/{1} 项 · {2} 项处理中",
    "· {0}/{1} items · {2} processing"
  ],
  [
    "已取得 {0}/{1}{2}，正在保存",
    "Obtained {0}/{1}{2}; saving",
    [
      2
    ]
  ],
  [
    "正在生成逐段摘要：{0}/{1} 段…",
    "Generating paragraph summaries: {0}/{1} paragraphs…"
  ],
  [
    "本文手动标注 {0} 条 · 待重新定位 {1} 条",
    "Manual annotations in this article: {0} · Need relocation: {1}"
  ],
  [
    "{0}Token：输入 {1} · 输出 {2} · 总计 {3}{4}",
    "{0}Tokens: input {1} · output {2} · total {3}{4}",
    [
      0,
      4
    ]
  ],
  [
    "修改尚未完成：{0}。当前提案已保留。",
    "Changes are incomplete: {0}. The current proposal is preserved."
  ],
  [
    "{0}，正在核对保存状态",
    "{0}; checking save status",
    [
      0
    ]
  ]
]);
  api.registerInterfaceTranslations?.(entries,templates.map(pair=>api.compileInterfaceTemplate(pair)));
  if(typeof module==='object'&&module.exports)module.exports={entries,templates};
})(globalThis);
