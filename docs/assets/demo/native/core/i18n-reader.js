(function(root) {
  const api = root.SciLLM || (typeof module === 'object' ? require('./i18n.js') : {});
  const entries = Object.fromEntries(`
编辑已中止；未保存内容仍需重新填写	Editing stopped; unsaved content must be entered again
论文上下文已切换，未发送编辑内容	The article context changed. Your edits were not sent.
字段无法安全保存	This field cannot be saved safely
保存中…	Saving…
收到较旧保存结果；当前草稿未回退	An older save result arrived. The current draft was preserved.
有新的未保存内容	New unsaved changes
草稿已在别处更新；已保留输入，请重试保存	The draft changed elsewhere. Your input is preserved; retry saving.
保存失败；输入已保留，请重试	Save failed. Your input is preserved; please retry.
Ctrl/⌘+Enter 保存，Escape 取消	Ctrl/⌘+Enter to save; Escape to cancel
未保存	Unsaved
切换论文前未能保存 Figure 编辑；内容未写入新论文	Figure edits could not be saved before switching articles. They were not written to the new article.
页面隐藏时 Figure 编辑未保存	Figure edits were not saved when the page became hidden
页面关闭时 Figure 编辑未保存	Figure edits were not saved when the page closed
PDF 索引或页面尚未就绪，请稍后重新点击。	The PDF index or page is not ready. Try again shortly.
来源文档已变化，需要重新核验原文。	The source document changed. Verify the source text again.
来源原文存在多个匹配，无法精确定位。	Multiple source-text matches were found; an exact location cannot be determined.
未找到已保存的来源原文，请重新核对。	The saved source text could not be found. Please check it again.
定位请求已失效，请重新点击。	The location request expired. Click again.
定位失败，请刷新 PDF 导航后重试。	Location failed. Refresh PDF navigation and retry.
仅定位到对应页。	Located the page only.
定位结果精度无法确认，请刷新 PDF 导航后重试。	Location precision could not be confirmed. Refresh PDF navigation and retry.
句子	Sentence
段落	Paragraph
已定位来源，请核对它是否支持当前笔记。	Source located. Check whether it supports the current note.
来源定位失败，笔记内容已保留。	Source location failed. The note is preserved.
PDF 导航已刷新，本次定位请求已失效。	PDF navigation refreshed; this location request expired.
分类规则或当前论文已变化，请重新应用	The classification rules or current article changed. Apply them again.
手动标注数据未完成清除	Manual annotation data was not completely cleared
页面标记清除失败	Could not clear page markers
未命名配置	Unnamed profile
全局	Global
摘要	Abstract
多图	Multiple figures
正文证据来源	Article evidence sources
来自	From
假设	Hypothesis
如何检验	How it was tested
得到什么	What was found
允许得出的结论	Supported conclusion
局限	Limitations
置信度	Confidence
页级·待核验	Page-level · Needs verification
历史内容，来源未保存	Historical content; source not saved
来源已过期，待重新核验	Source expired; verification required
来源存在歧义，待核验	Ambiguous source; verification required
未找到正文来源	Article source not found
来源记录无效，无法定位	Invalid source record; cannot locate
来源精度不足，待核验	Source precision insufficient; verification required
来源待核验	Source awaiting verification
来源序号已变化，请重新打开笔记	Source numbering changed. Reopen the note.
未产生可替换的新内容，当前笔记已保留	No replacement content was produced. The current note is preserved.
未更新内容	No content updated
保留手工修改	Manual edits preserved
保留已有内容	Existing content preserved
返回无效	Invalid response
内容无变化	Content unchanged
AI 已保存	AI result saved
证据不足	Insufficient evidence
（已复用本地结果）	(reused local results)
AI 生成已填写	AI-generated content filled in
恢复数据已提交到浏览器，但页面已有变化，未覆盖当前页面或草稿；请先保留当前编辑，再核对本机数据。	Restored data was committed to the browser, but the page changed. The current page and draft were not overwritten. Preserve your edits before checking local data.
恢复已提交，但侧栏出现新的编辑，已保留当前草稿并暂停刷新；请先保存草稿再核对恢复结果。	Restoration was committed, but new sidebar edits appeared. The draft is preserved and refresh is paused. Save the draft before checking the restored data.
恢复内容已应用，但人工标注状态校验失败，后续持久化未执行；请勿再次执行恢复。	Restored content was applied, but manual annotation verification failed. Further persistence did not run. Do not repeat restoration.
恢复内容已应用且页面回执已登记，但本地档案提交失败；请勿再次执行恢复。	Restored content was applied and the page receipt recorded, but the local archive commit failed. Do not repeat restoration.
恢复内容已应用且页面回执已登记，但本地工作区的后台提交失败；请勿再次执行恢复。	Restored content was applied and the page receipt recorded, but the background workspace commit failed. Do not repeat restoration.
恢复内容与本地档案已提交，但页面重建后的身份校验失败；请勿再次执行恢复。	Restored content and the local archive were committed, but identity verification failed after rebuilding the page. Do not repeat restoration.
文件夹权限	Folder permission
正文与问答	Article text and Q&A
图解与笔记	Figure analysis and notes
离线正文快照	Offline article snapshot
本地目录同步	Local folder sync
关闭提示	Dismiss notice
保存到本地	Save locally
正在准备…	Preparing…
等待	Waiting
处理中	Processing
失败	Failed
已跳过或需重试	Skipped or retry needed
文件夹可写	Folder is writable
已写入目录	Written to folder
设置中未启用	Disabled in settings
复用快照并写入	Reused snapshot and saved
已完成	Completed
保存未完成	Save incomplete
主要内容已保存	Main content saved
全部保存完成	All content saved
本地内容	Local content
湿实验	Wet-lab experiment
成像	Imaging
生物信息学	Bioinformatics
临床	Clinical
示意图	Schematic
模型建立	Model establishment
操作验证	Manipulation validation
表型证据	Phenotypic evidence
定量证据	Quantitative evidence
机制证据	Mechanistic evidence
阴性对照	Negative control
特异性验证	Specificity validation
必要性检验	Necessity test
充分性检验	Sufficiency test
挽救实验	Rescue experiment
功能结局	Functional outcome
外部验证	External validation
其他证据	Other evidence
提出问题/建立模型	Question formulation / model establishment
建立现象	Establishing a phenomenon
建立关联	Establishing an association
解析机制	Investigating a mechanism
因果检验	Causal test
转化验证	Translational validation
尚无法归类	Not yet classified
关联证据	Associative evidence
干预效应	Intervention effect
挽救证据	Rescue evidence
机制支持	Mechanistic support
功能验证	Functional validation
证据等级待确认	Evidence level not confirmed
请先完成当前编辑后再修改机制链	Finish the current edit before changing the mechanism chain
机制链生成结果未写入：论文上下文已变化，请重试	The mechanism chain was not saved because the article context changed. Please retry.
Figure 草稿保存失败	Figure draft save failed
Figure 编辑尚未保存	Figure edits are not saved yet
翻译停止回执未确认；只查询原请求，不启动新翻译。	Translation stop receipt is unconfirmed. Checking the original request without starting a new translation.
无法连接当前网页翻译，请刷新网页后重试。	Cannot connect to translation on this page. Refresh the page and retry.
切换到聚焦布局；BREVESS 保持激活	Switch to focus layout; BREVESS stays active
恢复原网页布局；BREVESS 保持激活	Restore the original page layout; BREVESS stays active
当前页面不支持切换原网页布局	This page does not support switching to the original layout
· 原网页布局	· Original page layout
· 聚焦布局	· Focus layout
原网页布局切换未完成，请重新连接当前页面后重试。	Layout switching did not complete. Reconnect to the page and retry.
文献 PDF	Article PDF
还没有通知	No notifications yet
PDF 操作未完成，请重试。	The PDF action did not complete. Please retry.
此标签页尚未激活，点击侧栏任意位置即可激活	This tab is inactive. Click anywhere in the sidebar to activate it.
点击侧栏后读取当前论文结构	Click the sidebar to read the current article structure
无法获取当前标签页	Cannot access the current tab
当前网页	Current webpage
正在激活并准备解析当前 PDF…	Activating and preparing to parse the current PDF…
正在激活当前标签页…	Activating the current tab…
请求暂时失败，正在压缩正文证据后重试…	The request failed temporarily. Compressing article evidence before retrying…
模型返回格式不完整，正在自动修复…	The model returned an incomplete format. Repairing it automatically…
正在保留有正文来源的字段，并将其余字段标为缺失…	Preserving fields supported by article sources and marking the others as missing…
模型已返回，正在核验证据并填写模板…	Model response received. Verifying evidence and filling the template…
正在梳理跨图研究逻辑…	Mapping the research logic across figures…
机制节点词表格式不完整，正在进行一次有界修复…	The mechanism-node vocabulary is incomplete. Performing one bounded repair…
当前 Panel 批次格式不完整，正在进行一次有界修复…	This Panel batch has an incomplete format. Performing one bounded repair…
正在修复 Panel 覆盖关系…	Repairing Panel coverage…
正在保留已验证关系并收敛未覆盖 Panel…	Preserving verified relationships and resolving uncovered Panels…
正在生成 Panel 机制关系…	Generating Panel mechanism relationships…
请重试	Please retry
请返回文献页查看具体原因	Return to the article page to see the reason
专注阅读已开启；按专用快捷键切换，或按 Esc 退出。	Focus reading is enabled. Use its shortcut to toggle it, or press Esc to exit.
该缩写	This abbreviation
无法获取当前论文页面	Cannot access the current article page
无法读取本文缩略词表	Cannot read this article's abbreviation list
当前查看的论文已切换，请重新打开缩略词表	The current article changed. Reopen the abbreviation list.
手动	Manual
自动+全局	Automatic + global
未调用 LLM；仅保留正文中有明确全称关系或全局记忆命中的缩写。	No LLM was called. Only abbreviations explicitly linked to full names in the article or found in global memory are retained.
当前论文已切换，请重新打开缩写表。	The current article changed. Reopen the abbreviation list.
当前论文已切换，未将结果写入新论文。	The current article changed. Results were not written to the new article.
缩写内容保存失败	Could not save abbreviation content
中文全称至少应包含一个中文字符。	The Chinese full name must contain at least one Chinese character.
尚未填写中文全称	Chinese full name not entered yet
尚未填写含义，可在表格中手动填写或双击该行让 AI 补全。	Meaning not entered yet. Enter it in the table or double-click the row to fill it with AI.
正在定位原文…	Locating source text…
已定位到正文首次出现的位置	Located the first occurrence in the article
未找到当前原文位置；含义仍可查看	Source location not found; the meaning is still available
原文定位暂不可用；含义仍可查看	Source location is temporarily unavailable; the meaning is still available
查词失败：	Lookup failed:
双击行内让 AI 补齐空白中文全称和含义	Double-click a row to fill missing Chinese full names and meanings with AI
；查看完整含义并定位原文	; view the full meaning and locate the source
单击看含义并定位；长按 1 秒查词（Alt + Enter）	Click to view meaning and locate; hold for 1 second to look up (Alt + Enter)
单击看含义并定位	Click to view meaning and locate
填写	Enter
保存失败：	Save failed:
从本文缩略词表移除	Remove from this article's abbreviation list
移除失败	Removal failed
已移除	Removed
移除失败：	Removal failed:
无法读取全局缩略词库	Cannot read the global abbreviation dictionary
全局缩略词库更新失败	Global abbreviation dictionary update failed
本文缩略词表为空，没有可存入的项目。	This article's abbreviation list is empty. Nothing to save.
正在存入…	Saving…
正在导出…	Exporting…
所选内容已填写；AI 仅补齐空白格。	Selected fields are already filled. AI fills only blank fields.
获取中…	Fetching…
正在补齐	Filling
项空白内容…	blank fields…
已补齐	Filled
项空白内容；保留已有内容和正在编辑的内容。	blank fields; existing content and ongoing edits are preserved.
没有新增内容：已有内容与编辑已保留，无法确定的释义保持空白。	No new content: existing values and edits are preserved; uncertain meanings remain blank.
无新增	No additions
重试	Retry
AI 补全失败：	AI completion failed:
默认网站：	Default site:
新网站	New site
网站名称	Site name
查词网址	Lookup URL
删除网站	Delete site
请至少保留一个网站。	Keep at least one site.
查词链接读取失败：	Could not read lookup links:
最多添加 20 个网站。	You can add up to 20 sites.
已保存默认查词网站：	Default lookup site saved:
章节选择尚未保存，请重新确认分析范围。	Section selection is not saved. Confirm the analysis scope again.
；已保存结果保留，请刷新文献后重新解图。	; saved results are preserved. Refresh the article before analyzing figures again.
文献身份已变化	Article identity changed
同一页面的正文版本已变化	The article version on this page changed
文献工作区代次已变化	The article workspace generation changed
PDF 来源代次已变化	The PDF source generation changed
文献身份尚未准备完成	Article identity is not ready yet
当前论文页面已切换	The current article page changed
网页身份读取失败	Could not read page identity
网页地址已变化	The page URL changed
Figure 文档绑定读取失败	Could not read the Figure document binding
保存记录	Saved record
来源清理回执未确认	Source cleanup receipt is unconfirmed
，暂不可重试	; retry is temporarily unavailable
归档收尾失败，已保存图解保留	Archive finalization failed. Saved figure analysis is preserved.
停止确认中	Confirming stop
来源准备中	Preparing source
准备中	Preparing
打开笔记	Open notes
切换	Switch
双击核验/恢复来源（仅阻止已记录且未提交的来源写入）	Double-click to verify or recover sources (blocks only recorded source writes that are not committed)
双击或 Shift+Enter	Double-click or Shift+Enter
停止当前任务	Stop the current task
开始或继续未完成图解（保留此前费用预留）	Start or resume incomplete figure analysis (retains the earlier cost reservation)
生成当前选中字段	Generate the selected fields
开始批量处理	Start batch processing
停止请求未确认	Stop request unconfirmed
离线记录为只读；需要重新分析时请打开在线原文。	Offline records are read-only. Open the original online article to analyze it again.
图解归档收尾失败：	Figure analysis archive finalization failed:
；已保存图解保留。	; saved figure analysis is preserved.
来源保存回执已核验；请再次双击继续未完成图解。	Source save receipt verified. Double-click again to resume incomplete figure analysis.
来源清理回执尚未确认	Source cleanup receipt is not confirmed yet
，暂不可开始新任务；已保存结果保留。	; a new task cannot start yet. Saved results are preserved.
当前文献初始化或本地恢复未完成，请重新提取后再生成大纲。	Article initialization or local restoration is incomplete. Extract the article again before generating an outline.
请先选择要概述的章节；当前没有发送模型请求。	Select sections to summarize first. No model request was sent.
使用指定模型翻译导航标题	Translate navigation headings with the selected model
使用全局模型翻译导航标题	Translate navigation headings with the global model
取消导航标题翻译	Cancel navigation heading translation
导航标题来源已变化，请重新准备翻译。	Navigation heading sources changed. Prepare translation again.
翻译任务服务不可用。	The translation task service is unavailable.
浏览器需要点击授权，请再次点击标题翻译按钮。	The browser requires a permission gesture. Click the heading translation button again.
当前侧栏环境无法使用浏览器本地英中翻译。请检查浏览器的 Translator 支持。	Browser-local English-to-Chinese translation is unavailable in this sidebar. Check the browser's Translator support.
导航标题翻译的模型配置不可用，请在设置中检查指定模型。	The model for navigation heading translation is unavailable. Check the selected model in settings.
导航标题翻译的任务配置无效，请检查设置后重试。	The navigation heading translation configuration is invalid. Check settings and retry.
导航标题翻译服务暂时无法连接，请重新连接当前文献后重试。	The navigation heading translation service cannot be reached. Reconnect to the article and retry.
标题翻译请求状态尚未确认；已完成的译文已保留，请核实请求状态后再继续。	The heading translation request is unconfirmed. Completed translations are preserved; verify the request status before continuing.
翻译服务不可用	Translation service unavailable
已取消标题翻译；完成的译文已保留。	Heading translation cancelled. Completed translations are preserved.
当前文献的导航标题尚未就绪，请稍后重试。	Navigation headings for this article are not ready. Retry shortly.
当前没有可翻译的导航标题。	No navigation headings are available to translate.
导航标题译文已就绪。	Navigation heading translations are ready.
正在翻译导航标题；再次点击可取消。	Translating navigation headings. Click again to cancel.
翻译模型未返回译文	The translation model returned no translation
未命名章节	Untitled section
正在定位 PDF 原文…	Locating PDF source text…
当前章节	Current section
无法更新 PDF 章节范围	Could not update the PDF section scope
展开	Expand
当前标题	Current heading
正文	Article text
推断	Inferred
单击跳转到本段；双击生成 AI 概述	Click to jump to this paragraph; double-click for an AI summary
无法定位到该段落，请在正文中手动查找。	Cannot locate this paragraph. Find it manually in the article.
无法定位到该段落。	Cannot locate this paragraph.
概述未能追加到笔记	Could not append the summary to notes
概述已追加到笔记	Summary appended to notes
该段落已更新或不再存在，请刷新文章导航后重试	This paragraph changed or no longer exists. Refresh article navigation and retry.
段落概述追加失败	Could not append the paragraph summary
概述追加失败：	Could not append summary:
单段摘要生成失败	Paragraph summary generation failed
单段摘要生成失败：	Paragraph summary generation failed:
定位段落笔记失败：	Could not locate paragraph notes:
文档已切换，当前草稿已保留，请关闭后在原文档重新打开笔记。	The document changed. Your draft is preserved. Close it and reopen the note in the original document.
正在保存到本文工作区…	Saving to this article's workspace…
段落笔记已保存	Paragraph note saved
段落笔记已删除	Paragraph note deleted
笔记已变化，当前草稿已保留，请重新打开笔记核对后保存。	The note changed. Your draft is preserved. Reopen the note and review it before saving.
原文段落已变化，请刷新导航后重新打开笔记。	The source paragraph changed. Refresh navigation and reopen the note.
PDF 原始阅读工具已启用	Native PDF reading tools enabled
暂未识别到稳定的正文标题。可等待页面加载完成后刷新。	No stable article headings found yet. Wait for the page to load, then refresh.
论文证据台账	Article evidence ledger
完成 AI 分析后，核心证据与审读提醒会显示在这里。	Key evidence and review reminders appear here after AI analysis.
核心证据	Key evidence
证据关系	Evidence relationships
审读提醒	Review reminders
需要复核	Review required
待核查	To verify
待核查信息	Information to verify
PDF 原始批注	Native PDF annotations
可在左侧 PDF 工具栏直接使用文本高亮、手写、文本框和批注；原始 PDF 阅读不需要 MinerU。	Use the left PDF toolbar for text highlights, freehand drawing, text boxes, and annotations. Native PDF reading does not require MinerU.
正则	Regex
展开查看每一处原文命中	Expand to see every source-text match
查看原文位置	View source location
当前筛选类型在正文中没有高亮。	No highlights of the selected type were found in the article.
激活当前标签页失败	Could not activate the current tab
已保留当前 PDF 目录与摘要，等待阅读器重新绑定；精确定位暂不可用。	The PDF outline and summaries are preserved while the reader reconnects. Precise location is temporarily unavailable.
PDF 读取或索引失败，请查看右侧通知中的详情并重试	PDF reading or indexing failed. See the notification for details and retry.
正在读取 PDF 原页与文字索引；完成后会自动连接…	Loading original PDF pages and the text index. Connection will resume automatically…
原文依据整理	Source evidence extraction
笔记审校	Note review
AI 笔记：	AI notes:
已向模型发送请求…	Request sent to the model…
正在发送当前论文的正文证据…	Sending article evidence from the current paper…
本字段未完成，已保留其他有效结果，可重试。	This field is incomplete. Other valid results are preserved; you can retry.
请求暂时失败，保留完整证据后重试…	The request failed temporarily. Retrying with the full evidence preserved…
三类高亮均已隐藏；可点击上方按钮重新显示。	All three highlight types are hidden. Use the buttons above to show them again.
每行一项；	One item per line;
Panel 笔记来源无效	Invalid Panel note source
可见性：仅个人可见	Visibility: only you
可见性（点击核验）	Visibility (click to verify)
，点击核验	; click to verify
设置可见性	Set visibility
当前文献已变化，请重新打开 Panel 笔记。	The current article changed. Reopen the Panel note.
请先保存正在编辑的笔记，再设置可见性。	Save your note before setting its visibility.
共享模块尚未就绪，请重新打开侧栏。	Sharing is not ready. Reopen the sidebar.
无法打开共享设置；笔记仍保存在本机。	Could not open sharing settings. The note remains saved locally.
评论	Comments
当前文献已变化，请重新打开 Panel。	The current article changed. Reopen the Panel.
读者笔记模块尚未就绪，请重新打开侧栏。	Reader notes are not ready. Reopen the sidebar.
读者笔记暂不可用。	Reader notes are temporarily unavailable.
字段	Field
尚未填写	Not entered yet
整图概览	Figure overview
证据块编辑	Edit evidence blocks
统一编辑此 Figure 的 Panel 分组、顺序与说明，无需 AI	Edit Panel groups, order, and descriptions for this Figure without AI
本图问题	Figure question
核心结论	Main conclusion
证据边界	Evidence limits
组图思想	Figure design rationale
表型名称	Phenotype name
方法（每行一项）	Methods (one per line)
比较	Comparison
局部推论	Local inference
对论证链的贡献	Contribution to the argument
定性与定量互证	Qualitative and quantitative corroboration
阴性结果的价值	Value of negative results
全文论证角色	Role in the paper's argument
深层组图策略	Underlying figure strategy
替代解释（每行一项）	Alternative explanations (one per line)
删除 Panel 后缺失的论证（每行一项）	Arguments lost if the Panel is removed (one per line)
整图结论	Figure conclusion
这里的修改会同步影响完成态的一句话结论和后续主图串解输入。	Edits here also update the completed one-sentence conclusion and subsequent cross-figure analysis input.
Panel 编号、证据类型等结构字段保持不变；可修订所有面向读者的解释文字。	Panel IDs and structural fields such as evidence types stay unchanged. All explanatory text can be revised.
多米诺论证链	Sequential argument chain
整图	Whole figure
确立了什么	What was established
为什么进入下一步	Why the next step is needed
证据组织	Evidence organization
共同目标	Shared objective
组小结	Group summary
组间逻辑连接	Logical links between groups
下一步必要性	Need for the next step
深度证据审查	Detailed evidence review
当前显示的是人工修订版。	The manually revised version is displayed.
尚未保存人工修订。	Manual revisions have not been saved.
本图问题、核心结论和组图思想不能同时为空。	The Figure question, main conclusion, and design rationale cannot all be empty.
正在保存人工修订…	Saving manual revisions…
再次点击确认恢复	Click again to confirm restoration
再次点击将删除本层级的人工修订，并恢复模型原文。	Clicking again removes manual revisions at this level and restores the original model text.
正在恢复模型原文…	Restoring the original model text…
同色 Panel 属于同一证据功能组	Panels with the same color belong to the same evidence group
描述已清空	Description cleared
描述待补	Description missing
所选标题字段已人工清空	The selected heading field was manually cleared
尚无可显示的 Panel 描述	No Panel description is available
名称已清空	Name cleared
名称待补	Name missing
Panel 名称	Panel name
最佳单张 Figure 图	Best single Figure image
图注与相关正文（未发送图片）	Caption and related article text (no image sent)
按容量规划的证据	Evidence selected within capacity limits
无法定位原文依据，论文页面可能已更新。	Cannot locate the source evidence. The article page may have changed.
例如：为什么作者在这个 Panel 选择这一统计方法？	For example: why did the authors choose this statistical method for this Panel?
请选择追问方向或输入自定义问题	Choose a follow-up topic or enter your own question
回答已生成并显示在下方。	The answer was generated and appears below.
提交后，回答会直接显示在此 Panel 内。	After submission, the answer appears directly in this Panel.
追问已取消，可修改问题后重试。	Follow-up cancelled. Edit the question and retry.
追问失败，可修改问题后重试。	Follow-up failed. Edit the question and retry.
Panel 追问失败：	Panel follow-up failed:
证据单元	Evidence unit
分组设计	Group design
证据条目	Evidence item
已保存的人工复核全文问题	Saved manually reviewed paper question
研究逻辑	Research logic
全文元数据	Paper metadata
跨图研究逻辑	Cross-figure research logic
文章科学问题尚未取得	The paper's scientific question is not available yet
尚未取得论文科学问题，暂无法说明本块承接关系。	The paper's scientific question is unavailable, so this block's connection cannot yet be explained.
尚未取得前一证据块的未决问题，暂无法说明本块承接关系。	The previous evidence block's unresolved question is unavailable, so this block's connection cannot yet be explained.
未匹配的组间连接	Unmatched links between groups
暂无证据小结	No evidence summary yet
证据块名称	Evidence block name
人工证据块	Manual evidence block
标题	Title
方法与对照	Methods and controls
观察结果	Observations
结论	Conclusion
接管前的来源记录	Source record before manual editing
原共同目标	Original shared objective
原组小结	Original group summary
原推断	Original inference
承上	Connection to preceding evidence
证据小结	Evidence summary
分别修订来源字段	Edit source fields separately
图注中没有稳定的 Panel 标签；可双击 Fig 色块解图，或按 Shift+Enter。	No stable Panel labels were found in the caption. Double-click the Fig badge or press Shift+Enter to analyze the figure.
待确认分组	Grouping needs confirmation
正在解读此 Panel…	Analyzing this Panel…
单击展开/收起 · 双击解读此 Panel · Shift+Enter 解读	Click to expand/collapse · Double-click or Shift+Enter to analyze this Panel
提问此 Panel	Ask about this Panel
围绕此 Panel 继续追问	Ask a follow-up about this Panel
解读依据与补充信息	Analysis sources and additional information
方法来源	Method source
观察来源	Observation source
本次解读依据	Sources used in this analysis
目录识别不消耗 Token。双击 Panel 色块才调用所配置的 Figure 模型。	Identifying the Panel list uses no tokens. Double-clicking a Panel badge calls the configured Figure model.
收起提问	Collapse question
正在梳理主图之间的多米诺逻辑…	Mapping the sequential logic across main figures…
主图多米诺总链（跨图梳理）	Overall main-figure argument chain
正在把每张主图的已建立证据、下一步必要性与补图支撑串成全文论证链。	Connecting the established evidence, next-step rationale, and supplementary support of each main figure into the paper's argument.
待补充本图结论	Figure conclusion missing
本图任务	Figure objective
本图确立	Established by this Figure
下一图要解决的问题	Question for the next Figure
当前证据边界	Current evidence limits
紧跟本图的补充证据	Supplementary evidence following this Figure
全链边界	Limits of the full argument chain
解图中…	Analyzing figure…
正在读取原图中的 Panel 标签	Reading Panel labels from the original image
Panel 目录已核对，正在开始解读	Panel list verified. Starting analysis.
等待确认是否继续文字解读	Waiting for confirmation to continue with text-based analysis
已确认，正在依据图注与正文解读	Confirmed. Analyzing the caption and article text.
简要已清空	Summary cleared
中文简要待补	Summary missing
重试失败，原结果已保留	Retry failed. Previous results are preserved.
正在精读	Reading closely
正在校验与保存	Validating and saving
部分结果已保留	Partial results preserved
已解读 · 中文简要待补	Analyzed · Summary missing
已解读 · 简要已清空	Analyzed · Summary cleared
补充证据待解读	Supplementary evidence awaiting analysis
待解读	Awaiting analysis
模型结果已返回，正在完成校验与保存…	Model results received. Completing validation and saving…
Figure 解读已完成	Figure analysis complete
整图说明	Figure description
整图图注	Full Figure caption
正在读取当前 Figure 图注…	Reading the current Figure caption…
暂未取得当前 Figure 图注，正在刷新论文图片目录…	The current Figure caption is unavailable. Refreshing the article's figure list…
Figure 图注	Figure caption
以下内容直接来自网页图注；合并描述的 Panel 保持为同一块。	The content below comes directly from the webpage caption. Panels described together remain grouped.
该 Figure 暂无可读取的网页图注。	No readable webpage caption is available for this Figure.
当前论文没有可打开的 Figure 1	No accessible Figure 1 was found in this article
图表梳理导出失败，请检查网络结构后重试。	Mechanism map export failed. Check the network structure and retry.
图表梳理 JSON 无效或超过 2 MB。	Mechanism map JSON is invalid or exceeds 2 MB.
这是旧版机制图 JSON。继续导入会丢失 Panel 证据、别名与审计信息。是否继续？	This is a legacy mechanism map JSON file. Importing it loses Panel evidence, aliases, and audit information. Continue?
已取消旧版机制图导入。	Legacy mechanism map import cancelled.
图表梳理 JSON 已安全导入。	Mechanism map JSON imported safely.
图表梳理导入失败；文件必须属于当前论文且格式有效。	Mechanism map import failed. The file must belong to this article and have a valid format.
机制链保存失败	Mechanism chain save failed
保存失败；请重试	Save failed; please retry
机制链保存失败；请重试。	Mechanism chain save failed. Please retry.
当前 Figure 尚未保存到文献工作区，请等待同步后重试。	This Figure has not been saved to the article workspace. Wait for synchronization and retry.
此证据块已变化，请重新打开。	This evidence block changed. Reopen it.
手工证据块已保存，可拖到机制图联系上。	Manual evidence block saved. Drag it onto a mechanism-map link.
手工证据块编辑器无法打开，请刷新文献工作区后重试。	The manual evidence editor could not open. Refresh the article workspace and retry.
请先完成当前证据编辑，再打开机制图。	Finish the current evidence edit before opening the mechanism map.
文献页仍使用旧版本插件代码，请刷新文献页后重新打开画布。	The article page is using an older extension version. Refresh it and reopen the canvas.
画布未能打开；请确认文献工作区已准备完成并重试。	The canvas could not open. Check that the article workspace is ready and retry.
机制联系	Mechanistic relationship
负反馈	Negative feedback
正反馈	Positive feedback
添加分支	Add branch
抑制	Inhibition
促进	Activation
影响	Influence
未知	Unknown
可编辑的关系证据	Editable relationship evidence
仅节点定位，只读	Node location only; read-only
定位存在歧义，只读	Ambiguous location; read-only
无法定位编辑对象，只读	Edit target not found; read-only
仅定位到节点，未绑定所属联系；只读	Only the node was located, without an associated link; read-only
存在多个候选联系；只读	Multiple candidate links; read-only
未找到可验证的所属联系；只读	No verifiable associated link found; read-only
原始标识	Original identifier
所属联系	Associated link
新增节点	Add node
当前仅有节点证据；未生成关系边。	Only node evidence is available. No relationship edges were generated.
在正文浮窗绘制机制链，将解图证据拖到联系线上。	Draw the mechanism chain in the article overlay and drag figure evidence onto its links.
单击手动编辑 · 双击 AI 生成 · Shift+Enter AI 生成	Click to edit manually · Double-click or Shift+Enter to generate with AI
已有图表梳理内容。是否重新用 AI 生成？原有内容会保留，生成结果需审核后应用。	A mechanism map already exists. Generate a new one with AI? Existing content is preserved; review the generated result before applying it.
查看待审生成结果	View generated results awaiting review
Figure 笔记结构保存失败	Could not save the Figure note structure
背景或科学问题保存失败；输入已保留，请重试。	Could not save the background or scientific question. Your input is preserved; retry.
总问题	Overall question
递进	Sequential
并列	Parallel
汇合	Convergent
定位正文证据	Locate article evidence
未能定位这条正文证据；页面可能刚刚更新。	Could not locate this article evidence. The page may have just changed.
研究逻辑分层结果	Hierarchical research logic
核心问题	Core question
为什么值得问	Why it matters
论文如何推进	How the paper progresses
证据强度	Strength of evidence
Q0 · 论文核心问题	Q0 · Core research question
作者明确	Explicitly stated by authors
Brevess 重构	Reconstructed by BREVESS
证据待补充	Evidence missing
仍未解决	Still unresolved
Q0 仍需人工核验，当前不会将其当作确定结论。	Q0 still needs manual verification and is not treated as a confirmed conclusion.
正文已核对，正在保存	Article evidence checked. Saving.
已收到结果，正在核对正文证据	Results received. Checking article evidence.
正文已核对，无新增项	Article evidence checked. No additions.
提取失败，点击重试	Extraction failed. Click to retry.
创新点	Novel contributions
无	None
待补充	To be completed
修改问题关系	Edit question relationships
保存关系	Save relationships
当前没有可作为上游的问题	No upstream questions are available
覆盖完整	Complete coverage
已找到，待补全解读	Found; analysis incomplete
仍有缺失	Items still missing
未发现引用	No references found
补充图目录已同步回原论文；后续解图结果也会持续更新。	The supplementary figure list was synchronized to the original article. Later analysis results will also update it.
请重试保存	Please retry saving
PDF 解析完成后，补充图会自动同步回原论文工作区。	Supplementary figures will sync to the original article workspace after PDF parsing completes.
补充材料 PDF	Supplementary PDF
检查 Word 附件	Inspect Word attachment
获取并导入补图	Fetch and import supplementary figures
若补充材料为 PDF，可选择本地文件导入。	If the supplement is a PDF, select a local file to import it.
选择本地补充 PDF	Select a local supplementary PDF
本地补充材料 PDF	Local supplementary PDF
Figure 草稿版本无效	Invalid Figure draft version
展示顺序保存未确认	Display-order save is unconfirmed
补充图位置保存失败	Could not save supplementary figure position
已选中；	Selected;
指针状态异常	Unexpected pointer state
当前绑定尚不能定位此候选页，请在阅读器页码框中核对后确认。	The current binding cannot locate this candidate page. Check it using the reader's page-number field before confirming.
预填已确认图像页；修改后需重新确认。	Confirmed image pages are prefilled. Changes require confirmation again.
预填候选物理页码；尚未确认为完整图像范围。	Candidate physical page numbers are prefilled. The complete image range is not confirmed yet.
修改图像页	Edit image pages
核对图像页	Verify image pages
完整图像的 PDF 页码（最多 4 页）	PDF pages containing the complete image (up to 4)
例如 5-6 或 5,6	For example, 5-6 or 5,6
完整图像的 PDF 页码	PDF pages containing the complete image
已查看原页，确认包含此 Figure 的全部图像与 Panel	I checked the original pages and confirm they contain the complete Figure and all its Panels
保存图像页	Save image pages
图像页保存失败，请重试。	Could not save image pages. Retry.
已保存，后续视觉解读将使用这些页。	Saved. Future visual analysis will use these pages.
以下记录与当前原文目录不匹配，已保留原有解读和人工备注。	These records do not match the current article's figure list. Existing analysis and manual notes are preserved.
证据块目标	Evidence block objective
证据块结论	Evidence block conclusion
上游依据	Upstream evidence
已建立的证据	Established evidence
下一步问题	Next question
证据层级	Evidence level
证据衔接	Evidence connection
下一步目标	Next objective
历史 Figure	Historical Figure
历史证据块	Historical evidence block
当前原文位置不可用	Current source location unavailable
当前原文未发现图片目录	No figure list found in the current article
暂未识别到图；请刷新论文工作区后重试。	No figures identified yet. Refresh the article workspace and retry.
Figure 名称	Figure name
文字依据：图注与相关正文（未读取图片）。	Text sources: caption and related article text (image not read).
图像范围待核对；图注所在页可能不包含完整 Figure。	Image range requires verification. The caption page may not contain the complete Figure.
图注边界待复核，可核对原页后再解读。	Caption boundaries need review. Check the original pages before analysis.
编辑手动图	Edit manual figure
修改 Figure 编号、PDF 页码、图注，或替换上传图片	Edit the Figure number, PDF pages, and caption, or replace the uploaded image
原题与图注	Original title and caption
当前显示人工修订版；模型原文仍可恢复	Manual revision displayed; the original model text can still be restored
网页图注未提供稳定的 Panel 标签；以下为整图证据概览，未臆造 Panel 编号。	The webpage caption has no stable Panel labels. The overview below covers the whole Figure without inventing Panel IDs.
对照 Panel	Control Panel
对照类型	Control type
排除的替代解释	Alternative explanations excluded
对照充分性	Adequacy of controls
判断依据	Basis for assessment
替代解释	Alternative explanations
删除 Panel 后缺失的论证	Argument lost if the Panel is removed
已在目录中，可直接单图精读。	Already listed; available for individual Figure analysis.
页面内容（含参考文献等公开资料）	Page content (including references and other public information)
离线记录 · 只读；已恢复保存的分析与手动记录。需要修改或重新分析时请打开在线原文。	Offline record · Read-only. Saved analysis and manual records were restored. Open the original online article to edit or analyze again.
离线记录 · 只读	Offline record · Read-only
离线记录为只读，请打开在线原文后操作	Offline records are read-only. Open the original online article to continue.
该功能	This feature
正文已更新，当前解图完成后刷新。	The article text changed. Refreshing after the current figure analysis finishes.
未命名模型	Unnamed model
章节	Section
快捷提示	Quick prompts
待核验：仅可进行页级定位	Verification required: page-level location only
待核验：原文中存在多个相同或近似位置	Verification required: multiple identical or similar source locations
待核验：正文版本已经变化	Verification required: article version changed
跳转失败：原文位置当前不可见	Jump failed: source location is not currently visible
待核验：没有找到唯一对应的原文段落	Verification required: no unique matching source paragraph
· 已重绑	· Rebound
正文段落	Article paragraph
在新标签页打开外部链接（来源未验证）	Open external link in a new tab (source unverified)
回答边界	Answer limitations
所选章节在当前论文正文中没有可用段落。请重新选择章节；不会改用全文。	The selected sections have no usable paragraphs in this article. Select sections again; the full text will not be substituted.
回答失败	Answer failed
已排队，等待上一轮完成	Queued; waiting for the previous turn
已保留已完成的回答片段；模型续写后仍达到实际输出上限	Completed answer sections are preserved. Continuation still reached the model's actual output limit.
已保留通过校验的回答片段；模型续写后仍未形成完整回答	Validated answer sections are preserved. Continuation still did not produce a complete answer.
已取消；已完成的回答块已保留	Cancelled; completed answer blocks are preserved
已中断；已完成的回答块已保留，可手动重新生成	Interrupted; completed answer blocks are preserved. You can regenerate manually.
回答已删除，可以重新生成	Answer deleted; ready to regenerate
过程 · 展开查看	Progress · Expand to view
已排队，等待上一轮完成。	Queued; waiting for the previous turn to finish.
等待模型响应；当前服务尚未提供实时过程文本。	Waiting for the model. This service has not provided live progress text.
过程文本达到展示上限，部分内容未显示。	Progress text exceeded the display limit. Some content is not shown.
过程 · 本次会话	Progress · This session
等待调用模型	Waiting to call the model
删除排队问题	Delete queued question
只删除回答	Delete answer only
删除本轮	Delete this turn
· 已按问题覆盖相关章节	· Relevant sections covered for this question
· 已发送完整正文	· Full article text sent
问答：正在回答，可在问答面板取消	Q&A: answering; cancel in the Q&A panel
问答：单击打开	Q&A: click to open
已显示全部对话	All conversations shown
请先在设置中配置可用模型并同意发送正文	Configure an available model in settings and allow article text to be sent first
问题已加入队列，将使用提交时选择的模型。	Question queued. It will use the model selected at submission.
问题已发送。	Question sent.
智能检索已加入队列；匹配完成后会直接在原文中高亮。	Semantic search queued. Matches will be highlighted directly in the article.
读取超时：15 秒内未完成文献与已保存进度读取	Read timed out: article and saved progress did not load within 15 seconds
PDF 原始阅读 · 不消耗 MinerU 额度	Native PDF reading · Uses no MinerU quota
当前论文	Current article
页面尚未完成加载，请稍后重新提取	The page is still loading. Extract it again shortly.
正文尚未稳定，可稍后重新提取	Article text is not stable yet. Extract it again shortly.
提取期间正文已变化，请重新提取	Article text changed during extraction. Extract it again.
文献已切换，请重新读取当前论文	The article changed. Read the current article again.
正文仍在加载，请等待页面稳定后重新提取	Article text is still loading. Wait for the page to stabilize and extract again.
提取超时：可重新提取，或直接导出适配诊断包	Extraction timed out. Retry extraction or export a compatibility diagnostic package.
提取失败：	Extraction failed:
未识别到正文	No article text identified
这篇离线文献的记录暂不可用	This offline article record is temporarily unavailable
当前页面结构不可用	The current page structure is unavailable
论文侧栏已刷新	Article sidebar refreshed
读取失败：	Read failed:
含 AI 全文分析	Includes AI full-text analysis
含逐段摘要	Includes paragraph summaries
已找到本地档案	Local archive found
请查看通知中的失败原因	See the notification for the reason
加载时将核验文献身份与可用结果，也可跳过后重新分析。	Loading verifies article identity and available results. You can also skip and analyze again.
本地文献档案已损坏，可重新分析后覆盖保存	The local article archive is corrupted. Analyze again and overwrite it when saving.
当前论文档案尚未准备完成	The current article archive is not ready
本文高亮、备注与分析结果已保存到本地目录	Article highlights, notes, and analysis results were saved to the local folder
当前论文尚未准备完成	The current article is not ready
档案无法恢复到当前页面	The archive cannot be restored to this page
页面正文与存档版本不同：备注和分析卡片已恢复，旧 AI 文本范围未强行套用。	The article text differs from the archive. Notes and analysis cards were restored; old AI text ranges were not forced onto changed text.
上次的高亮、备注与 AI 分析结果已恢复。	Previous highlights, notes, and AI analysis results were restored.
未知错误	Unknown error
当前文献身份或恢复授权与存档不匹配，请确认所在论文后重新加载	Article identity or restoration authorization does not match the archive. Check the article and reload.
当前页面的恢复授权尚未准备好，请刷新论文状态后重试	Restoration authorization is not ready. Refresh article status and retry.
恢复回执未通过校验，无法确认后台保存状态，请先查看当前页面结果	The restoration receipt failed validation. Background save status is unknown; inspect the current page results first.
已从本地工作区恢复上次保存的分析结果	Previously saved analysis restored from the local workspace
本文档案已导出	Article archive exported
导出失败	Export failed
导出已取消	Export cancelled
；Zotero 已确认保存部分内容	; Zotero confirmed that some content was saved
；Zotero 写入结果尚未确认	; Zotero write results are not confirmed
，请先检查 Zotero，直接重试可能创建重复条目	; check Zotero first, as retrying may create duplicate items
准备材料	Prepare materials
下载高清 Figure	Download high-resolution Figures
收集网页样式和图片	Collect page styles and images
连接 Zotero	Connect to Zotero
读取目标文库	Read destination library
保存条目和笔记	Save items and notes
保存网页快照	Save page snapshot
生成 ZIP	Create ZIP
准备离线快照	Prepare offline snapshot
项 ·	items ·
项处理中	items processing
PPT 材料：	PowerPoint materials:
Zotero 导出：	Zotero export:
项缺失	items missing
取消导出	Cancel export
论文页面已变化，请重新导出	The article page changed. Export again.
当前论文页面尚未准备完成	The current article page is not ready
大小待定	Size not determined
PPT 预览面板无法打开	Could not open the PowerPoint preview
提示词更新失败	Could not update the prompt
提示词已更新，可以继续编辑。	Prompt updated. You can continue editing it.
PPT 预览准备失败	Could not prepare the PowerPoint preview
PPT 导出失败	PowerPoint export failed
所选档案不属于当前网页文献	The selected archive does not belong to this article
原文件夹句柄已失效或目录被移动，请在设置页重新选择同一个基础目录	The folder handle expired or the folder moved. Select the same base folder again in settings.
本地文件夹权限已失效；请再次点击保存，并在浏览器提示中允许访问	Local folder permission expired. Click Save again and allow access in the browser prompt.
目录写入未完成，数据仍保留在待同步队列中，可稍后重试	Folder writing is incomplete. Data remains in the sync queue; retry later.
尚未设置本地保存文件夹，请先到设置页面选择文件夹	No local save folder is configured. Select a folder in settings first.
未获得本地文件夹读写权限；请再次点击保存并允许访问	Read/write permission for the local folder was not granted. Click Save again and allow access.
无法识别当前论文的本地工作区	Cannot identify the local workspace for this article
未获得本地文件夹读写权限，请再次点击并允许访问	Local folder read/write permission was not granted. Click again and allow access.
当前论文工作区保存失败	Could not save the current article workspace
，已保留之前的离线副本，请联网重试	; the previous offline copy is preserved. Connect to the internet and retry.
，请联网重试	; connect to the internet and retry
；设置中已关闭离线正文保存	; offline article saving is disabled in settings
；工作区已保存，但离线正文快照失败，请重试	; workspace saved, but the offline article snapshot failed. Retry.
已保留较新版本并将在下一次自动保存时合并。	The newer version is preserved and will be merged during the next automatic save.
本次结果已保存在浏览器；文件夹同步尚未完成。	Results are saved in the browser. Folder sync is not complete.
请查看文件夹权限或稍后重新保存。	Check folder permissions or save again later.
侧栏仍有编辑或正在保存的草稿，请保存或关闭编辑后再恢复；当前内容已保留。	The sidebar has active edits or a draft being saved. Save or close the editor before restoring. Current content is preserved.
文件夹同步尚未完成	Folder sync is incomplete
人工标注显示重建尚未完成	Manual annotation display reconstruction is incomplete
未获得本地文件夹读取权限；请再次点击并允许访问	Local folder read permission was not granted. Click again and allow access.
未获得本地文件夹读取权限，请再次点击并允许访问	Local folder read permission was not granted. Click again and allow access.
本地文件夹中没有匹配当前网页的工作区	No workspace in the local folder matches this page
本地工作区恢复失败	Local workspace restoration failed
已安全恢复问答、图解和分析卡片；正文已变化，旧文本范围未强行套用	Q&A, figure analysis, and analysis cards were restored safely. The text changed, so old text ranges were not forced onto it.
已恢复当前网页的本地工作区	Local workspace restored for this page
已自动恢复当前网页的本地工作区	Local workspace automatically restored for this page
未获得本地文件夹读取权限；请再次点击扫描并允许访问	Local folder read permission was not granted. Click Scan again and allow access.
当前网页尚未建立本地工作区	No local workspace exists for this page yet
未获得本地文件夹读写权限；请再次点击清除并允许访问	Local folder read/write permission was not granted. Click Clear again and allow access.
本地文件夹权限不足，清除已暂停；再次授权后可继续	Insufficient local folder permissions. Clearing is paused and can resume after access is granted.
页面状态重置失败	Could not reset page state
当前网页的本地内容已清除，并已建立新的空工作区	Local content for this page was cleared and a new empty workspace created
已跳过旧档案，可按当前设置重新分析	Old archive skipped. You can analyze again with the current settings.
正文页面仍在加载，正在等待页面结构稳定…	The article page is still loading. Waiting for its structure to stabilize…
页面正文尚未稳定，请等待加载完成后重新提取；页面稳定后侧栏也会自动刷新。	Article text is not stable yet. Wait for loading to finish and extract again. The sidebar also refreshes automatically once the page stabilizes.
正文提取超时	Article extraction timed out
正文提取失败	Article extraction failed
可重新提取，或导出适配诊断包用于修复	Retry extraction or export a compatibility diagnostic package for troubleshooting
查看公开备注	View public notes
公开备注作者范围	Public note authors
全部可见	All accessible notes
仅课题组成员	Research group members only
默认关闭；开启后可点击正文虚线句子阅读与交流，需要登录。	Off by default. Enable it to click dashed-underlined sentences and join discussions. Sign-in required.
请先打开一篇文献	Open an article first
公开备注暂不可用	Public notes are temporarily unavailable
已关闭公开备注；自己的高亮保持不变。	Public notes hidden. Your own highlights are unchanged.
当前账号尚未加入课题组	This account has not joined a research group
账号已变化，请重新开启查看公开备注。	The account changed. Enable public notes again.
侧栏初始化失败：可重新提取或导出适配诊断包	Sidebar initialization failed. Retry extraction or export a compatibility diagnostic package.
LLM 操作失败	LLM action failed
已选择；单击取消选择，双击生成此字段，Shift+Enter 生成	Selected; click to deselect, double-click or Shift+Enter to generate this field
未选择；单击选择，双击生成此字段，Shift+Enter 生成	Not selected; click to select, double-click or Shift+Enter to generate this field
当前笔记模板没有可填写字段	The current note template has no fields to fill
请先选择至少一个笔记字段	Select at least one note field first
已保存在浏览器，等待同步到本地文件夹	Saved in the browser; waiting to sync to the local folder
AI 功能	AI feature
请求超时；模型服务可能繁忙，请稍后重试。	Request timed out. The model service may be busy; retry later.
无法连接模型服务；请检查网络后重试。	Cannot connect to the model service. Check your network and retry.
API 凭据无效；请在模型设置中更新密钥。	Invalid API credentials. Update the key in model settings.
API 额度不足；请检查账户额度。	Insufficient API quota. Check your account balance.
请求过于频繁；请稍后重试。	Too many requests. Retry later.
模型返回格式不完整；系统已停止写入，请重试。	The model returned an incomplete format. Writing stopped; retry.
模型未生成可验证的机制关系；系统未保存空图，请重试。	The model produced no verifiable mechanism relationships. No empty map was saved; retry.
达到本轮运行时限；本轮已停止，请核对图解进度后重试。	This run reached its time limit and stopped. Check figure analysis progress before retrying.
达到本轮模型调用次数上限；本轮已停止，请核对图解进度后重试。	This run reached its model-call limit and stopped. Check figure analysis progress before retrying.
未能读取任务运行状态；请重新打开侧栏后重试。	Could not read task status. Reopen the sidebar and retry.
保存任务运行状态未获确认；请重新打开侧栏后核对进度。	Task status save is unconfirmed. Reopen the sidebar and check progress.
未能读取阶段检查点；请重新打开侧栏后重试。	Could not read the stage checkpoint. Reopen the sidebar and retry.
保存阶段检查点未获确认；请重新打开侧栏后核对进度。	Stage checkpoint save is unconfirmed. Reopen the sidebar and check progress.
所需的工作区同步尚未完成；请重新打开侧栏后重试。	Required workspace sync is incomplete. Reopen the sidebar and retry.
工作区已发生变化；请返回解图页刷新后重试。已有结果会保留。	The workspace changed. Return to figure analysis, refresh, and retry. Existing results are preserved.
工作区同步尚未完成；请重试，已有结果会保留。	Workspace sync is incomplete. Retry; existing results are preserved.
上次解图任务尚未确认结束；请稍后重试。	The previous figure analysis task has not been confirmed finished. Retry later.
模型输出被截断；请稍后重试或缩小任务范围。	Model output was truncated. Retry later or reduce the task scope.
已取消。	Cancelled.
机制链生成	Mechanism chain generation
未完成；请稍后重试。若再次失败，请保留通知并反馈。	Incomplete. Retry later. If it fails again, keep the notification and report the issue.
失败；请检查模型设置或稍后重试。	Failed. Check model settings or retry later.
笔记内容已保留，完成确认未通过；重试只核对保存状态，不会重新生成。	Note content is preserved, but completion was not confirmed. Retrying checks save status without generating again.
连接未确认	Connection unconfirmed
PDF 正文	PDF article text
位置待核验	Location needs verification
来源已变化，请重新核对当前论文。	The source changed. Check the current article again.
未附可定位来源	No locatable source attached
BREVESS-文献笔记.md	BREVESS-article-notes.md
生成内容已保留；证据核对未完成，请核对原文中的模型、条件和例外。	Generated content is preserved. Evidence review is incomplete; check the original model, conditions, and exceptions.
已发送，等待模型	Sent; waiting for the model
模型正在读取正文	The model is reading the article
已收到结果，正在核验	Results received; validating
当前笔记字段不存在	The current note field does not exist
当前笔记字段选择已变化	The selected note fields changed
当前选中的笔记字段均已有内容，无需自动填写。	All selected note fields already contain content. No autofill is needed.
旧笔记任务停止尚未确认，未开始新的生成。	The previous note task has not confirmed stopping. No new generation started.
已生成的笔记草稿仍保留，正在等待其余字段；最终会重新核验保存。	Generated note drafts are preserved while remaining fields are processed. Saving will be verified again at the end.
文献笔记自动填写失败	Article note autofill failed
笔记模板已修改，已保留人工内容并丢弃过期生成结果	The note template changed. Manual content is preserved; outdated generated results were discarded.
返回的笔记模板与当前模板不一致	The returned note template does not match the current template
论文正文身份已变化，已丢弃不属于当前文献的笔记结果	Article identity changed. Note results belonging to another article were discarded.
笔记字段指令已变化，已丢弃过期的生成结果	Note field instructions changed. Outdated generated results were discarded.
，正在保存	; saving
AI 已取得，正在保存	AI result received; saving
字段已保存，但任务完成回执未确认；请保留当前结果	The field was saved, but task completion is unconfirmed. Keep the current results.
；笔记已保存，证据核对未完成，请核对原文中的模型、条件和例外。	; notes saved. Evidence review is incomplete; check the original model, conditions, and exceptions.
已保存部分结果	Partial results saved
未更新字段	No fields updated
保存失败，草稿仍保留	Save failed; draft preserved
填写失败，点击重试	Autofill failed; click to retry
全文分析已暂停	Full-text analysis paused
模型正在分析全文	The model is analyzing the full article
全文分析完成	Full-text analysis complete
先配置 API	Configure the API first
设置	Settings
准备正文并分析	Prepare article text and analyze
请至少选择一个分类	Select at least one category
选类别	Choose categories
重分析	Analyze again
来源准备已停止，已保存结果保留。	Source preparation stopped. Saved results are preserved.
已暂停 Figure 解读；当前来源读取完成后等待继续，不会发起新的模型请求。	Figure analysis paused. After the current source finishes loading, it waits to resume without making new model requests.
继续准备来源并解读未完成的 Figure。	Resume source preparation and analyze incomplete Figures.
无法控制分析任务	Could not control the analysis task
已继续	Resumed
Figure 解读	Figure analysis
全文 LLM 高亮	Full-text LLM highlights
；后台确认稍有延迟，界面已立即释放	; background confirmation is delayed, but the interface is available
继续分析	Resume analysis
继续图解	Resume figure analysis
重新生成整篇逐段摘要	Regenerate summaries for all paragraphs
生成整篇逐段摘要	Generate summaries for all paragraphs
逐段摘要	Paragraph summaries
当前页面暂未识别到正文标题	No article headings identified on this page yet
诊断包格式不完整	Incomplete diagnostic package format
页面没有返回适配诊断数据	The page returned no compatibility diagnostics
活动页面已变化，请在目标论文页重新导出	The active page changed. Export again from the intended article page.
适配诊断包导出失败：	Compatibility diagnostic export failed:
导出适配诊断包	Export compatibility diagnostics
已派发到本地桥接，等待上游确认开始。	Dispatched to the local bridge. Waiting for execution to be confirmed.
上游已开始执行；科学结果仍待返回与校验。	Upstream execution started. Scientific results still need to arrive and pass validation.
已请求停止，等待上游终止回执。	Stop requested. Waiting for the upstream termination receipt.
上游执行结果尚未确认；原超时或取消结果保留。	Upstream execution is unconfirmed. The original timeout or cancellation status is preserved.
本地响应已结束，科学结果仍须校验。	The local response finished. Scientific results still require validation.
继续文字解读？	Continue with text-based analysis?
此 Figure	This Figure
暂停	Pause
继续文字解读	Continue with text-based analysis
本次确认已失效，Figure 解读保持暂停。	This confirmation expired. Figure analysis remains paused.
Figure 解读保持暂停。	Figure analysis remains paused.
分析模式不存在	Analysis mode does not exist
切换分析模式失败，已恢复原选择	Could not switch analysis modes. Original selection restored.
保存分类失败，已恢复原选择	Could not save categories. Original selection restored.
自定义分析模式没有内置预设	Custom analysis modes have no built-in preset
恢复预设失败，已保留原分类选择	Could not restore the preset. Original category selection preserved.
无法切换识别模式，已恢复原设置	Could not switch detection modes. Original settings restored.
置信度保存失败，已恢复原设置	Could not save confidence. Original settings restored.
置信度已保存；刷新论文页面后重新分析即可应用	Confidence saved. Refresh the article page and analyze again to apply it.
未提取到论文正文	No article text extracted
返回的正文组合与当前文献或分析模式不一致	The returned article content does not match the current article or analysis mode
勾选类别后查看分布	Select categories to view the distribution
分数分布暂不可用	Score distribution temporarily unavailable
PDF 分数预览暂不可用；阈值筛选仍可使用	PDF score preview is unavailable; threshold filtering remains available
当前类别暂无可呈现的高亮句子	No displayable highlighted sentences in this category
本地匹配分数分布，按句子去重	Local match score distribution, deduplicated by sentence
保留	Keep
排除	Exclude
诊断不可用	Diagnostics unavailable
图注不参与分析	Captions are excluded from analysis
类型已选择	Type selected
台账复核不可用	Ledger review unavailable
提取诊断不可用，请刷新论文页面后重新打开插件。	Extraction diagnostics are unavailable. Refresh the article page and reopen the extension.
停用	Disable
启用	Enable
视图预设	View preset
主要类型	Primary type
用户添加	User-added
可选类别	Available categories
正则识别 · 仅本次会话	Regex detection · This session only
正则识别	Regex detection
需要 LLM 识别	Requires LLM detection
查看/编辑规则	View/edit rules
没有匹配的其他分类	No other matching categories
无法获取匹配计数:	Could not get match counts:
当前论文工作区尚未准备完成，请刷新后重试	The current article workspace is not ready. Refresh and retry.
请选择不超过 20 MiB 的 PNG、JPEG 或 WebP 图片，且扩展名与文件类型一致	Select a PNG, JPEG, or WebP image up to 20 MiB with a matching file extension
请粘贴完整图注	Paste the complete caption
图注不能超过 8000 个字符	Captions cannot exceed 8,000 characters
当前环境无法计算文件指纹	File fingerprints cannot be calculated in this environment
图片无法解码	Image could not be decoded
图片压缩失败	Image compression failed
无法解码这张图片，请重新导出后再试	Cannot decode this image. Export it again and retry.
图片宽高无效，请重新选择	Invalid image dimensions. Select another image.
当前环境无法处理图片	Image processing is unavailable in this environment
图片压缩后仍超过 1.5 MiB，请裁剪后重试	The compressed image still exceeds 1.5 MiB. Crop it and retry.
主图需要填写 Figure 编号，例如 Figure 3	Enter a Figure number for a main figure, such as Figure 3
PDF 页码必须是正整数	PDF page numbers must be positive integers
请上传或粘贴一张图片，或者填写图注	Upload or paste an image, or enter a caption
补充 Figure 草稿无效	Invalid supplementary Figure draft
无法导入补充 Figure 草稿	Could not import the supplementary Figure draft
无法保存补充 Figure 草稿	Could not save the supplementary Figure draft
没有找到要编辑的补充图	The supplementary figure to edit was not found
补充图修改失败	Could not edit the supplementary figure
没有找到要删除的补充图	The supplementary figure to delete was not found
补充图删除失败	Could not delete the supplementary figure
DOCX Figure 尚未完成保存	DOCX Figure saving is incomplete
DOCX 检查结果尚未保存	DOCX inspection results are not saved
已检查附件，未发现嵌入 Figure。	Attachment inspected. No embedded Figures found.
补图来源准备已取消	Supplementary figure source preparation cancelled
附件分类尚未保存	Attachment classification is not saved
已确认该附件为数据表格，已保留其来源。	The attachment was confirmed as a data table. Its source is preserved.
补充 PDF 超过文件大小限制	The supplementary PDF exceeds the file size limit
所选文件不是有效的 PDF	The selected file is not a valid PDF
补充材料 PDF 链接无效	Invalid supplementary PDF link
补充 PDF 正在后台进行本地来源提取，可继续阅读正文	Local source extraction for the supplementary PDF is running in the background. You can continue reading.
补充 PDF 导入失败	Supplementary PDF import failed
补充 PDF 导入超时	Supplementary PDF import timed out
解析已完成，但未识别到可导入的 Figure；请重试或手动补充图片/图注	Parsing finished, but no importable Figures were found. Retry or add images/captions manually.
已保留当前图片；选择或粘贴新图片可替换。	The current image is preserved. Select or paste a new image to replace it.
例如 Figure 3	For example, Figure 3
例如 Figure S2（留空则自动编号）	For example, Figure S2 (leave blank for automatic numbering)
手动 Figure	Manual Figure
手动补全 Figure	Add a Figure manually
可修改图注，或上传、粘贴新图片替换当前图片。保存后需要重新解图。	Edit the caption or upload/paste a new image to replace the current one. Analyze again after saving.
可上传主图或补充图原图、图注，并标注它在原 PDF 中的页码。	Upload a main or supplementary figure image and caption, and specify its pages in the original PDF.
保存修改	Save changes
这张补充图	This supplementary figure
请先选择要解析的补充 PDF	Select a supplementary PDF to parse first
补充 Figure	Supplementary Figure
已更新	Updated
已新建	Created
；暂未识别到 Panel	; no Panels identified yet
；图片和图注已写入所选文件夹	; image and caption written to the selected folder
；已保存在浏览器，但所选文件夹尚未完成写入，请重新授权文件夹后点击“保存全部”	; saved in the browser, but folder writing is incomplete. Grant folder access again and click Save all.
已在新标签页打开 PDF 工作区	PDF workspace opened in a new tab
已在新标签页打开补充 PDF 工作区	Supplementary PDF workspace opened in a new tab
已从剪贴板导入图片	Image imported from the clipboard
当前标签页尚未激活，请点击侧栏任意位置激活	This tab is inactive. Click anywhere in the sidebar to activate it.
这篇离线文献的保存记录暂不可用，请重新打开	The saved record for this offline article is unavailable. Reopen it.
离线记录为只读；需要修改或重新分析时请打开在线原文。	Offline records are read-only. Open the original online article to edit or analyze again.
补充 PDF 工作区已关闭，且无法恢复解析页面	The supplementary PDF workspace closed and its parsing page could not be restored
补充 PDF 尚未完成解析，请稍后重试	Supplementary PDF parsing is incomplete. Retry later.
论文正文身份已变化，已丢弃不属于当前文献的提取结果	Article identity changed. Extraction results belonging to another article were discarded.
已部分生成，需人工核验	Partially generated; manual verification required
（已复用正文证据缓存）	(reused cached article evidence)
提取失败	Extraction failed
来源保存结果待核验；请双击“核验/恢复来源”，确认前不会重复保存。	Source save results need verification. Double-click Verify/recover sources. No repeated save occurs before confirmation.
补充来源尚未准备完整，已保存结果保留。	Supplementary sources are incomplete. Saved results are preserved.
已声明的 Word 补充附件尚未具备逐图来源证明，请先准备该附件。	The declared supplementary Word attachment lacks per-Figure source verification. Prepare that attachment first.
补充材料缺少来源标识。	Supplementary material has no source identifier.
补充材料来源发生冲突。	Supplementary material sources conflict.
来源准备已停止	Source preparation stopped
来源读取超过等待上限	Source reading exceeded the wait limit
补充附件检查记录无法读取。	Could not read supplementary attachment inspection records.
附件检查记录不属于当前论文。	The attachment inspection record belongs to another article.
附件下载页归属已变化。	The attachment download page's article association changed.
附件下载页检查记录未通过核验。	The attachment download page inspection record failed verification.
附件检查记录尚未保存到本地目录。	Attachment inspection records are not saved to the local folder.
附件检查记录在核验时发生变化。	Attachment inspection records changed during verification.
无法读取补充目录。	Could not read the supplementary figure list.
DOCX 保存身份未确认。	DOCX save identity is unconfirmed.
DOCX 目录尚未完成本地保存。	The DOCX figure list has not finished saving locally.
DOCX 目录在保存核验时发生变化。	The DOCX figure list changed during save verification.
DOCX 原图读取失败。	Could not read original DOCX images.
DOCX 目录在核验期间发生变化。	The DOCX figure list changed during verification.
补充目录保存身份未确认。	Supplementary figure list save identity is unconfirmed.
补充目录不属于当前论文。	The supplementary figure list belongs to another article.
补充 PDF 原始文件指纹未确认。	The original supplementary PDF fingerprint is unconfirmed.
补充 PDF 解析尚未完成或存在解析错误。	Supplementary PDF parsing is incomplete or contains errors.
补充图目录仍不完整。	The supplementary figure list is still incomplete.
补充图片清单发生冲突。	Supplementary image inventories conflict.
补充图注与图像未能逐项对应。	Supplementary captions and images could not be matched individually.
补充 Figure 身份未确认。	Supplementary Figure identity is unconfirmed.
补充图片尚未在当前论文目录中核实。	Supplementary images are not verified in the current article's folder.
补充图片字节校验未通过。	Supplementary image bytes failed verification.
补充目录在核验期间发生变化。	The supplementary figure list changed during verification.
补充 PDF 图目录与当前来源证明不一致。	The supplementary PDF figure list does not match current source verification.
补充导入尚未取得完整保存回执。	Supplementary import has not received a complete save receipt.
已声明补充来源发生变化。	Declared supplementary sources changed.
PDF 尚未确认有无图，需补提取或完成格式分类。	Whether this PDF contains figures is unconfirmed. Extract more content or finish format classification.
附件准备失败	Attachment preparation failed
先解读可用网页图；TIFF 来源待核验，有明确依赖的目标将在本次操作内补来源，已有结果保留。	Analyze available webpage figures first. TIFF sources need verification; sources for explicit dependencies will be prepared in this operation. Existing results are preserved.
TIFF 来源尚未核验。	TIFF sources are not verified yet.
TIFF 来源未取得完整保存回执。	TIFF sources have no complete save receipt.
TIFF 与附件目录未能唯一对应。	TIFF files could not be uniquely matched to the attachment list.
本轮附件读取预算已用完；先解读可用图，依赖此来源的图保留待补源。	This run's attachment-reading budget is exhausted. Available figures are analyzed first; dependent figures wait for their sources.
先解读可用网页图；附件来源待补齐，有明确依赖的目标将在本次操作内补来源，已有结果保留。	Analyze available webpage figures first. Missing attachment sources for explicit dependencies will be prepared in this operation. Existing results are preserved.
缺少已声明的补充来源。	Declared supplementary sources are missing.
附件检查尚未取得完整保存回执。	Attachment inspection has no complete save receipt.
来源准备期间 Figure 目录发生变化。	The Figure list changed during source preparation.
没有已取得来源证明的可解读 Figure。	No analyzable Figure has verified sources.
来源保存结果仍待核验；请双击核验/恢复来源。	Source save results still need verification. Double-click Verify/recover sources.
来源核验对应的页面已变化	The page associated with source verification changed
来源目标已变化	The source target changed
来源保存回执未确认，已保留任务；只读核验成功前不可重新开始。	The source save receipt is unconfirmed. The task is preserved and cannot restart until read-only verification succeeds.
来源准备超过 120 秒，已停止本轮补源；已保存结果保留。	Source preparation exceeded 120 seconds. This run stopped preparing sources; saved results are preserved.
来源准备已停止或论文页面已变化	Source preparation stopped or the article page changed
来源准备对应的页面或任务已变化	The page or task associated with source preparation changed
来源准备的论文归属或版本已变化	The article association or version for source preparation changed
当前网页身份或地址无法确认	Cannot confirm the current page identity or URL
本次操作的原网页身份尚未确认，无法安全重读	The original page identity is unconfirmed. It cannot be safely read again.
正文重读已超出本次操作的原文献版本	The reread article no longer matches this operation's original version
来源快照未返回，请重新提取当前文献	No source snapshot returned. Extract the current article again.
；请等待页面稳定后重新提取文献，再重试图解，已保存结果保留。	; wait for the page to stabilize, extract the article again, then retry figure analysis. Saved results are preserved.
来源保存回执未确认	Source save receipt unconfirmed
图解界面归属已变化，请重新打开侧栏后继续。	The figure analysis view's article association changed. Reopen the sidebar to continue.
选择本次解图依据	Choose sources for this figure analysis
本次批量解图	This batch of figure analysis
该 Figure	This Figure
使用 Figure 图像可以读取图像细节；仅文本模式只使用图注与正文。	Using Figure images includes visual details. Text-only mode uses only captions and article text.
使用 Figure 图像	Use Figure images
仅用图注与正文	Use captions and article text only
正文准备已停止或当前论文已变化，已保存结果保留	Article preparation stopped or the article changed. Saved results are preserved.
本地正文准备未完成，请重新提取后重试图解，已保存结果保留	Local article preparation is incomplete. Extract again and retry figure analysis. Saved results are preserved.
图解界面已关闭	Figure analysis view closed
图解界面归属已变化	Figure analysis view association changed
先解读可用图；	Analyze available figures first;
图解已取消，已完成结果会保留	Figure analysis cancelled. Completed results are preserved.
文献绑定不可用，请刷新文献后重新解图	Article binding unavailable. Refresh the article and analyze again.
本次继续范围已失效	The scope for this continuation expired
本次继续的论文身份已变化	Article identity changed for this continuation
无法确认本次继续范围	Cannot confirm the scope for this continuation
逐图解读失败	Figure-by-figure analysis failed
本次窗口；全计划	This window; full plan
来源未完成：	Sources incomplete:
张来自缓存	from cache
张仅使用图注与正文	using captions and article text only
成功结果已保留，重试时会复用缓存	Successful results are preserved. Retrying reuses the cache.
逐图解读完成：	Figure-by-figure analysis complete:
张 Figure	Figures
来源保存结果待核验；双击核验/恢复来源	Source save results need verification; double-click Verify/recover sources
图解启动已停止	Figure analysis startup stopped
（停止来源未确认）	(stop source unconfirmed)
，已保存结果保留。	; saved results are preserved.
Figure 解读已取消，已完成结果会保留	Figure analysis cancelled. Completed results are preserved.
归档写入回执丢失，需核验后恢复	Archive write receipt missing. Verify it before recovery.
图解归档保存回执已核验；请再次双击继续未完成图解。	Figure analysis archive save receipt verified. Double-click again to resume incomplete analysis.
图解收尾已完成，归档保存回执已核验。	Figure analysis finalized. Archive save receipt verified.
归档尚未保存：未取得当前论文档案。	Archive not saved: the current article archive is unavailable.
归档保存回执未确认。	Archive save receipt unconfirmed.
刷新或归档保存回执未确认	Refresh or archive save receipt unconfirmed
图解收尾未确认：	Figure analysis finalization unconfirmed:
；已保存结果保留，请核对后继续。	; saved results are preserved. Check them before continuing.
当前论文页面已切换，请返回后重试	The article page changed. Return to it and retry.
未找到该 Figure 的高清原图	No high-resolution original image found for this Figure
无法打开该 Figure 原图	Could not open the original Figure image
本次解图已停止或页面归属已变化	Figure analysis stopped or the page association changed
本次解图的 Figure 已变化	The Figure for this analysis changed
正文已更新，本次解图已停止；已保存结果保留。	Article text changed. Figure analysis stopped; saved results are preserved.
解图已取消，已有结果会保留。	Figure analysis cancelled. Existing results are preserved.
单图精读失败：	Individual Figure analysis failed:
Panel 解读	Panel analysis
Panel 解读已取消，已有结果会保留。	Panel analysis cancelled. Existing results are preserved.
图目录尚未保存，请刷新解图目录后再生成图表梳理。	The figure list is not saved. Refresh it before generating a mechanism map.
（已复用缓存）	(reused cache)
机制链生成已取消。	Mechanism chain generation cancelled.
机制链初始化失败；可继续手动新增节点。	Mechanism chain initialization failed. You can still add nodes manually.
论文大纲生成失败	Article outline generation failed
；档案保存队列已确认，重新点击可恢复	; the archive save queue is confirmed. Click again to resume.
；已生成段落已有缓存，档案保存尚未确认；重试会复用缓存	; generated paragraphs are cached, but archive saving is unconfirmed. Retrying reuses the cache.
当前页面尚未准备好手动标注数据	Manual annotation data is not ready on this page
手动标注数据不可用	Manual annotation data unavailable
清除自动高亮失败	Could not clear automatic highlights
请稍后重试	Please retry later
自动高亮已清除，手动标注保留不变	Automatic highlights cleared. Manual annotations are unchanged.
当前论文已变化，请重新确认	The current article changed. Confirm again.
本文手动标注已清除，自动高亮保留不变	Manual annotations cleared for this article. Automatic highlights are unchanged.
手动标注数据已清除；请刷新页面以移除残留标记	Manual annotation data cleared. Refresh the page to remove remaining markers.
请先完成 API、模型和正文发送许可设置	Configure the API, model, and permission to send article text first
请至少选择一个 LLM 识别类别	Select at least one LLM detection category
分析已取消，已完成分块结果会保留	Analysis cancelled. Completed chunk results are preserved.
LLM 分析失败	LLM analysis failed
全文 LLM 高亮已取消，已完成分块结果会保留。	Full-text LLM highlighting cancelled. Completed chunk results are preserved.
LLM 分析未全部完成；已完成分块和高亮均已保留。再次点击只会重试未完成分块。	LLM analysis is incomplete. Completed chunks and highlights are preserved. Click again to retry only incomplete chunks.
高亮保存未确认	Highlight save unconfirmed
高亮已应用	Highlights applied
无法取消全文问答：	Could not cancel full-text Q&A:
无法加载更早问答：	Could not load earlier Q&A:
无法清空全文问答：	Could not clear full-text Q&A:
无法控制全文分析：	Could not control full-text analysis:
无法取消全文分析：	Could not cancel full-text analysis:
无法控制 Figure 解读：	Could not control Figure analysis:
无法取消 Figure 解读：	Could not cancel Figure analysis:
已恢复当前分析模式预设	Current analysis mode preset restored
估算	Estimated
匹配计数:	Match count:
未分类	Unclassified
请选择需要标注的文字	Select the text to annotate
插件界面内不创建正文标注	Article annotations cannot be created inside extension controls
此区域不支持文字标注	This area does not support text annotations
请在论文正文段落内选择文字	Select text within an article paragraph
一次请选择同一段落内的文字	Select text from one paragraph at a time
未命名情境	Unnamed reading context
文章信息	Article information
引言	Introduction
引言与主旨	Introduction and main argument
范围与主旨	Scope and main argument
概念基础	Conceptual foundations
主题引入	Topic introduction
概念定义	Concept definitions
历史演进	Historical development
证据支持	Supporting evidence
证据对照	Evidence comparison
方法比较	Method comparison
综合判断	Integrated assessment
知识缺口	Knowledge gaps
研究启示	Research implications
技术进展	Technical advances
挑战	Challenges
承上启下	Transition
正文已更新，请重新启动解图。	Article text changed. Restart figure analysis.
正文尚未稳定，请刷新文献后重新解图。	Article text is not stable. Refresh the article and analyze figures again.
分析已取消，已完成结果会保留	Analysis cancelled. Completed results are preserved.
已暂停；当前模型请求结束后不会继续发送新请求。	Paused. No new requests will be sent after the current model request finishes.
已继续 Figure 解读。	Figure analysis resumed.
证据分组缺少依据	Evidence groups have no supporting rationale
证据分组依据格式不完整	Evidence group rationale has an incomplete format
分组依据引用了组外 Panel	Group rationale references Panels outside the group
分组依据来源未能核实	Group rationale sources could not be verified
分组依据未正确说明条件差异	Group rationale does not correctly explain condition differences
个有效 Panel	valid Panels
整图仍待补全，可重试。	The full Figure is still incomplete. Retry is available.
待核验项	Items to verify
模型请求超时	Model request timed out
连接模型服务时中断	Connection to the model service was interrupted
模型服务限制请求频率	The model service rate-limited requests
模型服务暂时不可用	The model service is temporarily unavailable
上次请求的完成状态无法确认	The previous request's completion status is unknown
已停止自动重发，已保存的结果仍保留。当前图需核验请求状态。	Automatic retries stopped. Saved results are preserved. Verify the request status for this Figure.
返回结构未通过校验	Response structure failed validation
本次没有有效 Panel，可重试解读。	No valid Panels returned. Retry analysis.
重试来源准备后继续。	Retry source preparation before continuing.
模型正在处理 Figure	The model is processing the Figure
已收到模型响应，等待校验	Model response received; awaiting validation
模型已返回，正在读取完成状态	Model response received; checking completion status
Panel 请求暂时失败，正在等待重试	Panel request failed temporarily; waiting to retry
已切换为 Panel 提取后再综合	Switched to Panel extraction followed by synthesis
停止尚未确认	Stop not confirmed yet
停止已确认（上游已中断）	Stop confirmed (upstream interrupted)
已确认结束（取消后完成）	Finished (completed after cancellation)
已确认结束（上游失败）	Finished (upstream failed)
已确认结束（旧协议未说明中断或完成）	Finished (legacy protocol did not specify interruption or completion)
无法定位此 PDF 高亮，请等待页面就绪后重试。	Cannot locate this PDF highlight. Wait for the page to be ready and retry.
证据强	Strong evidence
证据中等	Moderate evidence
证据有限	Limited evidence
证据待定	Evidence undetermined
快速主线	Quick overview
机制证据链	Mechanistic evidence chain
批判性审读	Critical reading
论文分析模式	Article analysis mode
关闭论文证据台账	Close article evidence ledger
待核查：	To verify:
LLM 标注	LLM annotation
AI 审读	AI review
AI 推断警示	AI inference warning
作者明确陈述	Explicit author statement
。按回车可提供反馈	. Press Enter to provide feedback
反馈保存失败	Could not save feedback
已积累多篇已确认语料，可在 API 设置页导出语料或生成离线规则	Confirmed examples from multiple articles are available. Export the corpus or generate offline rules in API settings.
反馈已保存到本地语料库	Feedback saved to the local corpus
恢复论文侧栏	Restore article sidebar
恢复此论文页面的插件侧栏	Restore the extension sidebar for this article page
Edge 暂时隐藏了此标签页的侧栏，点击即可恢复	Edge temporarily hid this tab's sidebar. Click to restore it.
手动标注操作失败	Manual annotation action failed
未命名类别	Unnamed category
所选 PDF 文字有页面无法保存，请重新选择	Some pages containing the selected PDF text cannot be saved. Select the text again.
所选 PDF 文字没有覆盖完整页面范围，请重新选择	Selected PDF text does not cover the complete page range. Select it again.
加入本文缩略词表	Add to this article's abbreviation list
会随本文工作区保存；稍后可在全文缩写表中导入全局记忆。	Saved with this article's workspace. You can later add it to global memory from the abbreviation list.
例如 TNF	For example, TNF
手动缩写	Manual abbreviation
全称	Full name
例如 tumor necrosis factor	For example, tumor necrosis factor
手动缩写全称	Manual abbreviation full name
加入缩略词表	Add to abbreviation list
请填写有效缩写和完整全称。	Enter a valid abbreviation and its complete full name.
已保存到本文缩略词表	Saved to this article's abbreviation list
无法把该规则高亮定位到正文段落。请刷新导航后重试。	Could not locate this rule highlight in an article paragraph. Refresh navigation and retry.
手动标注已重新绑定	Manual annotation rebound
请重新选择同一段落内的文字，然后点击“重新绑定此标注”	Select text within one paragraph again, then click Rebind this annotation
显示下一批	Show next batch
黑名单	Blocklist
白名单	Allowlist
，当前正则高亮已更新	; current regex highlights updated
所选文段为空，无法发送到全文问答。	The selection is empty and cannot be sent to full-text Q&A.
请先在插件设置中配置全文问答模型。	Configure a full-text Q&A model in extension settings first.
当前文献已变化，已停止保存	The current article changed. Saving stopped.
标注尚未保存	Annotation not saved yet
本句评论	Comments on this sentence
来源位置无法安全确认	The source location cannot be safely confirmed
查看本句评论	View comments on this sentence
账号已变化，请重新开启查看公开备注	The account changed. Enable public notes again.
文献已变化	The article changed
新备注默认仅个人可见；保存后可逐条设置可见性。	New notes are private by default. Set each note's visibility after saving.
页面正文已变化，请重新打开标注	Article text changed. Reopen the annotation.
标注来源已变化，请重新打开标注	The annotation source changed. Reopen it.
请先保存备注，再设置可见性；当前编辑内容仍保留。	Save the note before setting visibility. Your current edits are preserved.
共享模块尚未就绪，请重新打开页面	Sharing is not ready. Reopen the page.
无法打开共享设置；备注仍保存在本机。	Could not open sharing settings. The note remains saved locally.
朗读：浏览器需要再次点击才能播放。	Read aloud: the browser requires another click to play.
朗读：	Read aloud:
未完成，请检查设置中的朗读服务。	Incomplete. Check the speech service in settings.
其余内容正在翻译…	Translating the remaining content…
浏览器正在准备本地翻译资源：	The browser is preparing local translation resources:
%（需要时下载）	% (downloaded when needed)
其余内容未完成，可重试。	Remaining content is incomplete. Retry is available.
本地翻译失败：	Local translation failed:
划句翻译	Translate selection
删除标注	Delete annotation
手动标注已删除	Manual annotation deleted
删除失败：	Deletion failed:
标注位置尚未准备好，请稍后重试	Annotation location is not ready. Retry shortly.
当前情境没有可用高亮类别，请先选择其他情境	No highlight categories are available in this context. Choose another context first.
。草稿仍保留，可重试。	. The draft is preserved; retry is available.
解读失败：	Analysis failed:
待重新定位	Relocation required
已取消，可重新翻译。	Cancelled. You can translate again.
；备注草稿仍保留。	; the note draft is preserved.
手动荧光笔标注	Manual highlight
类别	Category
手动标注类别	Manual annotation category
备注	Note
当前文献已变化，未保存此备注	The current article changed. This note was not saved.
手动标注已保存	Manual annotation saved
AI 审读警告	AI review warning
证据关系卡片	Evidence relationship card
AI 自动高亮	AI automatic highlight
自动高亮详情暂不可用	Automatic highlight details are temporarily unavailable
准确	Accurate
不匹配	Mismatch
AI 高亮正确类别	Correct category for the AI highlight
改为此类别	Change to this category
原始类别	Original category
当前论文正文	Current article text
未提供（关系不完整）	Not provided (incomplete relationship)
支持引文：	Supporting quotations:
证据状态	Evidence status
已保留结构化关系；请逐条核对显示引文与支持引文。	Structured relationships are preserved. Check each displayed quotation and supporting quotation.
证据不足或关系字段不完整，不能据此扩展科学结论。	Evidence is insufficient or relationship fields are incomplete. Do not extend scientific conclusions from them.
作者主张	Author claim
结构化结果未提供 claim 引文	No claim quotation in the structured result
支持证据	Supporting evidence
结构化结果未提供 evidence 引文	No evidence quotation in the structured result
模型认为的问题	Issue identified by the model
未提供具体问题说明	No specific issue description provided
为什么适用	Why it applies
未提供结构化适用依据	No structured rationale provided
当前仍不能确定	What remains uncertain
未被原文引文和结构化字段支持的信息不作推断；该警告不是校准后的统计概率。	No inference is made beyond source quotations and structured fields. This warning is not a calibrated statistical probability.
高亮详情与编辑	Highlight details and editing
本地状态保存失败	Could not save local state
未找到可分析的论文正文	No analyzable article text found
论文准备失败	Article preparation failed
论文正文已准备，请先在插件中单选一个文献类型	Article text is ready. Select one article type in the extension first.
论文内容已变化，未提交旧分析结果。	Article content changed. Old analysis results were not submitted.
全文 LLM 高亮已取消，已完成分块的高亮会保留。	Full-text LLM highlighting cancelled. Highlights from completed chunks are preserved.
Figure 图片来源已变化，请重新开始本次解读。	The Figure image source changed. Restart this analysis.
本次文字解读确认已失效，已暂停。	Text-analysis confirmation expired. Analysis paused.
Figure 解读已暂停；已保存结果保留。	Figure analysis paused. Saved results are preserved.
补充图包含多个 TIFF 图像页，当前无法完整读取。	The supplementary figure contains multiple TIFF image pages that cannot currently be read completely.
补充图解码超时，已停止读取。	Supplementary figure decoding timed out. Reading stopped.
此补充图的 TIFF 格式暂不支持。	This supplementary figure's TIFF format is not supported yet.
补充图来源记录未能保存，请重试保存。	The supplementary figure source record could not be saved. Retry saving.
补充图未通过完整性或大小检查，已停止读取。	The supplementary figure failed integrity or size checks. Reading stopped.
请先在此 Figure 的“核对图像页”中确认完整图像所在页，再进行视觉解读。	Use Verify image pages for this Figure to confirm the complete image pages before visual analysis.
关闭高清原图	Close high-resolution original image
缩小原图	Zoom out of the original image
放大原图	Zoom into the original image
适配窗口	Fit to window
使原图适配窗口	Fit the original image to the window
高清原图加载失败，请关闭后重试。	The high-resolution original image failed to load. Close it and retry.
←/→ 相邻 Figure　↑ 第一张　↓ 最后一张　1–9/0 直达 Figure	←/→ Adjacent Figure　↑ First　↓ Last　1–9/0 Jump to Figure
隐藏图注	Hide caption
查看图注	View caption
隐藏当前 Figure 图注	Hide the current Figure caption
查看当前 Figure 图注	View the current Figure caption
没有找到可用的 Figure 图片地址。	No available Figure image URL found.
本地缓存	Local cache
已自动缓存	Cached automatically
缓存未保存	Cache not saved
高清原图加载失败；出版社可能要求在正文会话中直接读取。	The high-resolution original image failed to load. The publisher may require reading it directly in the article session.
恢复结果保存失败；已有结果保持，可重试保存。	Could not save restored results. Existing results are preserved; retry saving.
图像页保存未确认	Image-page save unconfirmed
其他行校验失败，本行尚未保存	Another row failed validation. This row is not saved yet.
补充图已更新，请重新运行主图串解以纳入补充证据	Supplementary figures updated. Rerun cross-figure analysis to include their evidence.
补充 Figure 已更新，请重新运行主图串解。	Supplementary Figures updated. Rerun cross-figure analysis.
请先生成该图的标准解读	Generate the standard analysis for this Figure first
Figure 内容已变化，请先重新生成标准解读	Figure content changed. Regenerate its standard analysis first.
本次继续的页面或 Figure 绑定已变化	The page or Figure binding for this continuation changed
联网回答缺少可验证的来源凭据，已隐藏该回答，请重新生成。	The web answer has no verifiable source credentials and was hidden. Generate it again.
模型连续达到输出上限。插件已自动提高额度并续写，但仍未形成完整回答；请把问题拆成两个更具体的问题，或检查当前 Profile 的“自动上限”是否过低。	The model repeatedly reached its output limit. Automatic increases and continuation still did not produce a complete answer. Split the question into two specific questions or check whether this profile's automatic limit is too low.
回答格式或引用校验未通过，自动修复未成功。可以重新生成本轮，或将较长的表格、清单分成几次提问；此前已完成的回答会保留。	Answer format or citation validation failed and automatic repair was unsuccessful. Regenerate this turn or split long tables and lists into several questions. Previous completed answers are preserved.
当前模型上下文不足以同时容纳问题、证据和回答，请提高该 Profile 的上下文窗口设置或缩小问题范围。	The model context cannot fit the question, evidence, and answer together. Increase this profile's context window or narrow the question.
插件专用 Codex 会话未登录或已过期。请打开设置 → 模型设置，在“本机 Codex”中点击“登录 / 重新登录”。	The extension's Codex session is signed out or expired. Open Settings → Model settings, then choose Sign in / Sign in again under Local Codex.
未找到本机 Codex。请先安装 Codex，并重新安装本机桥。	Local Codex was not found. Install Codex and reinstall the local bridge.
本机 Codex 桥未安装、未注册或已断开。请重新安装本机桥并重载扩展。	The local Codex bridge is missing, unregistered, or disconnected. Reinstall it and reload the extension.
本机 Codex 拒绝了这次请求。请到设置页检查登录状态并运行连接测试。	Local Codex rejected this request. Check sign-in status in settings and run a connection test.
当前模型服务暂时不可用，请稍后重试。	The current model service is temporarily unavailable. Retry later.
当前 Codex 账户已达到使用限额，请等待额度恢复或切换其他模型。	The Codex account reached its usage limit. Wait for it to reset or switch models.
回答未能完整保存到当前论文工作区。当前可见内容不代表已保存，请检查本地目录访问权限和存储空间后重试。	The answer was not fully saved to this article workspace. Visible content may be unsaved. Check local folder permissions and available storage, then retry.
所选章节在当前论文正文中没有可用段落。请重新选择章节；为避免范围错误，本次不会改用全文。	The selected sections have no usable paragraphs in this article. Select sections again. The full article will not be substituted, to preserve your requested scope.
全文问答失败	Full-text Q&A failed
全文问答回答已完成	Full-text Q&A answer complete
附件无法恢复，请重新添加后再生成。	The attachment could not be restored. Add it again before generating.
创新点响应缺少结构化结果	The novelty response has no structured result
研究局限响应缺少结构化结果	The study limitations response has no structured result
模型没有返回可由正文证据支持的条目，请重试	The model returned no items supported by article evidence. Retry.
文献笔记模板无可填写字段	The article note template has no fillable fields
未找到可用于填写笔记的论文正文	No article text was found to fill the notes
笔记模板在填写期间发生变化，请重试	The note template changed during autofill. Retry.
笔记任务身份已变化	Note task identity changed
笔记草稿与当前文献不匹配	The note draft does not match the current article
本次确认已失效	This confirmation expired
来源写入结果尚未确认；已保留当前操作，请先只读核验保存回执。	Source write results are unconfirmed. The current operation is preserved. Verify its save receipt in read-only mode first.
本次继续的 Figure 范围已变化	The Figure scope for this continuation changed
未找到可识别的主图或补充 Figure	No recognizable main or supplementary Figures found
请先准备已声明的补图来源。	Prepare the declared supplementary figure sources first.
补充来源准备后的 Figure 范围已变化。	The Figure scope changed after supplementary source preparation.
本次窗口	This window
已有解读，已自动跳过	Analysis already exists; skipped automatically
本次继续的页面已变化	The page for this continuation changed
已完成，准备下一张…	Completed. Preparing the next Figure…
无法继续处理	Cannot continue processing
继续下一张	Continue to the next Figure
解读失败，已保留成功结果并继续下一张：	Analysis failed. Successful results are preserved; continuing to the next Figure:
逐图解读完成	Figure-by-figure analysis complete
缓存（未调用模型）	Cache (no model call)
未调用模型	No model call
；成功结果已保留，重试会复用缓存	; successful results are preserved. Retrying reuses the cache.
Figure 写入结果尚未确认，任务保持锁定。	Figure write results are unconfirmed. The task remains locked.
Figure 解读已取消，已完成结果会保留。	Figure analysis cancelled. Completed results are preserved.
Figure 写入结果尚未确认：	Figure write results unconfirmed:
逐图解读失败：	Figure-by-figure analysis failed:
此地址的 PDF 已更换，或旧记录缺少原文件校验信息。原页仍可阅读；请先导出旧记录，再清除这篇文献的工作区后重新分析。	The PDF at this URL was replaced, or the old record lacks original-file verification. The original pages remain readable. Export the old record, then clear this article's workspace before analyzing again.
页面已切换，请重新搜索。	The page changed. Search again.
正文已变化，请重新搜索。	Article text changed. Search again.
上次全文分析在浏览器关闭或页面离开时中断，请手动重新开始。	The previous full-text analysis was interrupted when the browser closed or the page was left. Restart it manually.
页面正文仍在加载，请等待页面加载完成后重新提取。	Article text is still loading. Wait for the page to finish loading and extract again.
当前页面没有可读取的正文。请确认已打开全文，并完成页面的登录或访问验证后重新提取。	No readable article text is available. Open the full text and complete any sign-in or access verification before extracting again.
文献工作区在读取期间发生变化，请重新读取。	The article workspace changed while reading. Read it again.
页面正文在读取期间发生变化，请等待加载稳定后重新提取。	Article text changed while reading. Wait for loading to stabilize and extract again.
正文已识别，但文献身份准备失败，请重新提取。	Article text was identified, but article identity preparation failed. Extract again.
页面正文在读取期间发生变化，请重新读取。	Article text changed while reading. Read it again.
正文已读取；图目录未完整刷新，可刷新重试。	Article text loaded. The figure list did not fully refresh; refresh to retry.
正文已读取；图目录暂未保存，可刷新重试。	Article text loaded. The figure list is not saved yet; refresh to retry.
当前网页仅开放摘要与部分公开资料，尚未取得全文。请先通过网页的机构登录获得全文，或打开已有的原始 PDF。	Only the abstract and some public information are accessible. Sign in through your institution for the full text, or open an original PDF you already have.
已恢复的补充材料	Restored supplementary materials
当前论文内容已切换，请重新打开缩写表。	The current article content changed. Reopen the abbreviation list.
补充 PDF 图片尚未完成父论文保存核验，已保存结果保留。	Supplementary PDF images have not finished save verification in the parent article. Saved results are preserved.
Figure 写入结果尚未确认；任务保持锁定，请勿重新生成。	Figure write results are unconfirmed. The task remains locked; do not regenerate.
笔记存档格式异常，未覆盖原存档	Invalid note archive format. The original archive was not overwritten.
笔记已变化，请保留草稿并重新打开核对	The note changed. Preserve the draft and reopen it for review.
AI 未返回有效概述	AI returned no valid summary
笔记超过 4000 字符，原笔记已保留	The note exceeds 4,000 characters. The original note is preserved.
离线资源下载失败	Offline resource download failed
离线资源类型不符	Offline resource type mismatch
离线资源超过大小限制	Offline resource exceeds the size limit
离线资源没有可读内容	Offline resource has no readable content
离线资源为空	Offline resource is empty
保存期间论文页面已变化，请重新保存	The article page changed while saving. Save again.
离线网页超过保存限制，已有快照已保留	The offline page exceeds the save limit. The existing snapshot is preserved.
离线网页未确认保存，已有快照已保留	Offline page saving is unconfirmed. The existing snapshot is preserved.
上次 Figure 任务已中断，请手动重新开始。	The previous Figure task was interrupted. Restart it manually.
上次组间逻辑任务已中断，请手动重新开始。	The previous group-logic task was interrupted. Restart it manually.
上次全文分析已中断，请手动重新开始。	The previous full-text analysis was interrupted. Restart it manually.
浏览器关闭前的回答已中断，完整回答块已保留。	The answer was interrupted when the browser closed. Complete answer blocks are preserved.
浏览器关闭或页面离开时任务已中断；已完成的回答块已保留，可手动重新生成。	The task was interrupted when the browser closed or the page was left. Completed answer blocks are preserved; regenerate manually if needed.
PDF 语义段落仍在准备中，请等待导航完成后重新划选。	PDF semantic paragraphs are still being prepared. Wait for navigation to finish and select text again.
所选文字在当前页无法唯一绑定到正文段落，请缩小选区后重试。	The selected text cannot be uniquely bound to a paragraph on this page. Narrow the selection and retry.
无法为所选文字建立可恢复的句子定位，请重新划选。	Could not create a recoverable sentence location for the selected text. Select it again.
图注	Caption
当前页面还没有可归类的自动或手动高亮。	No classifiable automatic or manual highlights are available on this page.
无法定位当前章节	Cannot locate the current section
PDF 语义大纲暂不可用。	The PDF semantic outline is temporarily unavailable.
主章节	Main sections
全部标题	All headings
隐藏摘要	Hide summaries
显示摘要	Show summaries
暂无摘要	No summary yet
摘要本节	Summarize this section
暂未识别到稳定的正文标题；页面继续加载时会自动补全。	No stable article headings found yet. They will update as the page loads.
结构大纲	Structural outline
页面处于出版社安全验证；完成验证并刷新后再生成大纲	Publisher access verification is in progress. Complete it and refresh before generating an outline.
综述结构大纲	Review article outline
主要层级	Main levels
全部章节	All sections
深入到段落	Expand to paragraphs
全文中心命题	Central thesis
作者组织策略	Author's organizational strategy
全局组织综合暂不可用；以下标题层级和逐段摘要仍可正常阅读。	The overall synthesis is unavailable. Heading hierarchy and paragraph summaries below remain readable.
重试全局综合	Retry overall synthesis
本节作用	Section role
与前节关系	Relationship to the preceding section
论证贡献：	Contribution to the argument:
段间关系：	Relationship between paragraphs:
关键分歧与开放问题	Key disagreements and open questions
议题	Topic
当前解决或开放状态	Current resolution or open status
AI 未返回此段的有效概述	AI returned no valid summary for this paragraph
逐段摘要任务正在运行，请稍候	Paragraph summarization is running. Please wait.
未找到可生成大纲的论文正文	No article text found for outline generation
已从缓存恢复论文大纲	Article outline restored from cache
论文大纲生成失败：	Article outline generation failed:
本地原图缓存未命中。	The original image was not found in the local cache.
# 文献全文问答	# Article Q&A
无回答	No answer
暂无全文问答。	No article Q&A yet.
# Brevess：PPT 制作材料包	# BREVESS: PowerPoint materials package
## 内容	## Contents
导出操作无效或已存在	Export operation is invalid or already exists
导出资源等待超时	Timed out waiting for export resources
资源下载失败	Resource download failed
PPT 预览已取消或论文已变化，请重新准备材料。	PowerPoint preview was cancelled or the article changed. Prepare the materials again.
论文或研读材料已更新，请重新预览。	The article or reading materials changed. Preview them again.
PPT 预览不可用，请重新准备材料。	PowerPoint preview is unavailable. Prepare the materials again.
PPT 材料正在准备或导出。	PowerPoint materials are being prepared or exported.
请先预览并确认 PPT 材料。	Preview and confirm the PowerPoint materials first.
手动标注	Manual annotations
高亮说明	Highlight description
正文外 Figure 高清图集	High-resolution Figures outside the article body
以下 Figure 位于出版社的弹层或扩展数据区域之外，已单独收录并内嵌最高质量原图。	The following Figures were collected separately from publisher overlays or extended-data areas and embedded at the highest available quality.
正文导航	Article navigation
Zotero 导出已取消	Zotero export cancelled
当前文献或导航内容已变化，请重新打开导航翻译。	The article or navigation content changed. Reopen navigation translation.
返回结构未通过校验，正在纠正…	The response structure failed validation. Correcting it…
已生成有效结果，正在逐批保存…	Valid results generated. Saving in batches…
本批处理完成…	Batch processing complete…
未完成，已保留其他字段，可重试。	Incomplete. Other fields are preserved; retry is available.
连接暂时失败，保留完整证据重试…	Connection failed temporarily. Retrying with full evidence…
连接暂时失败，压缩证据后重试…	Connection failed temporarily. Compressing evidence before retrying…
生成完成，正在核验保存…	Generation complete. Verifying the save…
部分字段未完成，正在保存有效结果…	Some fields are incomplete. Saving valid results…
输出被截断，正在按限制增加输出长度重试…	Output was truncated. Increasing output length within limits and retrying…
输出被截断，正在使用紧凑格式重试…	Output was truncated. Retrying with a compact format…
模型不接受该输出上限，正在调整后重试…	The model rejected this output limit. Adjusting it and retrying…
请求已发送…	Request sent…
模型不接受当前输出长度，正在降低令牌上限后重试…	The model rejected the current output length. Lowering the token limit and retrying…
输出长度不足，正在增加令牌上限后重试…	Output length was insufficient. Increasing the token limit and retrying…
输出被截断，正在改用紧凑 JSON 格式重试…	Output was truncated. Retrying with compact JSON…
全局组织综合	Overall organizational synthesis
返回格式不符合要求	Response format does not meet requirements
请求超时	Request timed out
遇到服务限流	Service rate limit reached
服务暂不可用	Service temporarily unavailable
网络连接失败	Network connection failed
返回内容被截断	Response was truncated
请求失败	Request failed
逐段摘要已完成，正在综合全文组织逻辑…	Paragraph summaries complete. Synthesizing the article's overall organization…
论文大纲已生成，正在核验保存	Article outline generated. Verifying the save.
当前 Figure	Current Figure
已完成…	Completed…
请求频率受限	Request rate limited
模型服务暂时过载	Model service temporarily overloaded
模型连接暂时不稳定	Model connection temporarily unstable
当前分块分析超时	Current chunk analysis timed out
模型持续繁忙	The model remains busy
当前分块输出过长	Current chunk output is too long
当前分块需要降载	Current chunk requires a reduced load
LLM 分析已完成。	LLM analysis complete.
LLM 正在分析正文分块…	LLM is analyzing article chunks…
清除高亮失败:	Could not clear highlights:
获取匹配计数失败:	Could not get match counts:
本次继续的页面绑定已变化	The page binding for this continuation changed
Figure 高清原图打开失败	Could not open the high-resolution Figure image
Figure 高清原图切换失败	Could not switch high-resolution Figure images
`.trim().split('\n').map(line=>line.split('\t')));
  api.registerInterfaceTranslations?.(entries);
  if(typeof module==='object'&&module.exports)module.exports={entries};
})(globalThis);
