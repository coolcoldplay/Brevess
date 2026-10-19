(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM?.registerInterfaceTranslations?.(api.entries, api.patterns);
  root.SciLLM = Object.assign(root.SciLLM || {}, { localizeLogicMapDemo: api.localizeLogicMapDemo });
})(globalThis, function (root) {
  'use strict';
  const entries = Object.fromEntries(`本地翻译等待超时，已保留原文和已完成的部分译文；可关闭后重试。	Local translation timed out. The original and completed translations are preserved; close and retry.
全文翻译	Full-text translation
段落翻译	Paragraph translation
已保存的翻译专用模型不可用，请修正配置后继续。	The saved translation model is unavailable. Correct its configuration before continuing.
请先保存可用模型配置并确认正文发送授权。	Save a working model configuration and authorize sending article text first.
翻译后台暂不可用，已保留译文和原文。	The translation service is unavailable. Original text and translations are preserved.
翻译引擎配置身份无效，请检查已保存配置。	The translation engine configuration could not be verified. Check the saved settings.
翻译模型配置已变化，请重新开启翻译。	The translation model configuration changed. Start translation again.
当前文献或原文已变化，本次译文未提交。	The article or source text changed. This translation was not applied.
本段请求完成状态未知，已阻止重复调用；等待原请求回执。	The paragraph request has an unknown outcome. Duplicate requests are blocked while awaiting confirmation.
翻译模型认证失败，请修正已保存的配置后继续。	Translation model authentication failed. Correct the saved configuration before continuing.
翻译模型额度不足，已保留合格译文。	The translation model quota is exhausted. Valid translations are preserved.
翻译服务仍在限流，已保留译文和未完成段落。	The translation service is still rate limited. Translations and unfinished paragraphs are preserved.
自动恢复已达到累计请求、重试或无进展上限，已保留合格译文。	Automatic recovery reached its request, retry or no-progress limit. Valid translations are preserved.
译文已通过校验，但保存未成功；继续只重试保存。	The translation passed validation but was not saved. Continue to retry saving only.
所选模型翻译失败，已保留有效译文和原文。	Translation with the selected model failed. Valid translations and original text are preserved.
Brevess 双语阅读	BREVESS bilingual reading
本地翻译模型下载进度	Local translation model download progress
收起提示	Dismiss notice
仅收起提示，保留译文和翻译进度	Dismiss the notice while preserving translations and progress
继续未完成翻译	Continue unfinished translation
开启本地翻译；首次使用或资源缺失时浏览器可能下载。论文文本仅在本机处理。	Enable local translation. The browser may download resources on first use or when missing. Article text is processed on this device only.
当前浏览器的本地英译中接口不可用，未启用云端翻译。	Local English-to-Chinese translation is unavailable in this browser. Cloud translation has not been enabled.
本段翻译失败，已保留有效译文。	Paragraph translation failed. Valid translations are preserved.
全文部分完成，已保留合格译文；请处理阻塞或保存失败后继续。	Translation is partially complete. Valid translations are preserved; resolve the blocker or save failure before continuing.
翻译设置已更新，旧引擎已停止。已保留译文；点击继续后按已保存配置翻译未完成部分。	Translation settings changed and the previous engine stopped. Translations are preserved; continue to translate unfinished text using the saved settings.
翻译已暂停，已完成和部分译文均保留。	Translation paused. Completed and partial translations are preserved.
继续翻译	Resume translation
暂停翻译	Pause translation
显示译文	Show translations
隐藏译文	Hide translations
本段部分译文未完成，已保留合格译文和原文。	This paragraph is partially translated. Valid translations and original text are preserved.
本段翻译等待超时，已保留原文。	Paragraph translation timed out. The original text is preserved.
本段请求完成状态未知，已暂停再次调用；请先核对后台状态。	The paragraph request has an unknown outcome. Further requests are paused; check the service status first.
翻译设置已更新，旧引擎已停止；已确认译文保留，点击继续后应用已保存配置。	Translation settings changed and the previous engine stopped. Confirmed translations are preserved; continue to apply the saved settings.
本批双语阅读仅支持 HTML 网页。	Bilingual reading currently supports HTML pages only.
页面已经变化，请重新打开扩展菜单。	The page changed. Reopen the extension menu.
无法验证页面工具入口。	The page tool entry could not be verified.
此页面不支持网页工具。	Page tools are unavailable on this page.
请从扩展图标菜单操作。	Use the extension icon menu.
此页面不支持网页工具，请在普通网页中使用。	Page tools are unavailable here. Use them on a regular web page.
无效的页面工具设置。	Invalid page tool settings.
请先启用语义检索。	Enable semantic search first.
无法打开语义检索，请刷新后重试。	Semantic search could not open. Refresh and retry.
请先启用整页翻译。	Enable full-page translation first.
无法启动翻译，请查看页面提示。	Translation could not start. Check the notice on the page.
页面工具暂不可用，请刷新重试。	Page tools are unavailable. Refresh and retry.
PDF 高亮	PDF highlight
返回解析结果	Back to extracted results
当前 PDF	Current PDF
局部裁剪文字过于复杂，无法安全建立检索范围。	Clipped text is too complex to establish a reliable search range.
当前网页已达到语义检索累计上限；已有结果保留，停止自动补充检索。	This page reached the cumulative semantic search limit. Existing results are preserved; automatic incremental search has stopped.
网页原文已变化，无法继续补充检索。	The page text changed. Incremental search cannot continue.
翻译请求字段无效。	Invalid translation request fields.
该功能不能使用翻译接口。	This feature cannot use the translation endpoint.
无法确认翻译文献和调用来源。	The article and source of the translation request could not be verified.
当前文献已变化，请重新打开翻译。	The article changed. Reopen translation.
缺少可核验的文献标识。	A verifiable article identifier is missing.
翻译模型设置无效。	Invalid translation model settings.
翻译设置已变化，请重新选择翻译任务。	Translation settings changed. Select the translation task again.
无法核验翻译配置标识。	The translation configuration identifier could not be verified.
翻译请求记录未能安全保存，已停止新调用。	The translation request record could not be saved safely. New requests have stopped.
翻译请求记录已达到上限，已停止新调用。	The translation request record limit was reached. New requests have stopped.
该段请求结果尚不明确，已阻止重复调用。	This paragraph request has an unknown outcome. Duplicate requests are blocked.
翻译自动恢复已达到累计上限，已保留合格译文并停止新调用。	Automatic translation recovery reached its cumulative limit. Valid translations are preserved and new requests have stopped.
翻译操作标识与当前请求不一致。	The translation operation identifier does not match the current request.
该翻译操作不属于当前文献或页面。	This translation operation does not belong to the current article or page.
等待翻译的段落过多，请稍后继续。	Too many paragraphs are queued for translation. Continue later.
翻译进度存储不可用。	Translation progress storage is unavailable.
翻译后台未能初始化，请重新加载扩展。	The translation service could not initialize. Reload the extension.
保存人工修改前须读取最新翻译版本。	Load the latest translation revision before saving manual edits.
翻译进度已更新，请重新读取后再保存。	Translation progress changed. Reload it before saving.
翻译进度缺少文献标识。	The translation progress has no article identifier.
翻译进度与当前文献或配置不符。	Translation progress does not match the current article or configuration.
无法核验翻译进度标识。	The translation progress identifier could not be verified.
翻译进度已达到保存上限。	The translation progress storage limit was reached.
翻译任务未完成，请检查当前文献和翻译设置。	Translation is incomplete. Check the current article and translation settings.
该功能当前使用浏览器本地翻译。	This feature currently uses local browser translation.
远程模型尚未获得授权或完成设置。	The remote model has not been authorized or configured.
没有可用的翻译模型配置。	No usable translation model configuration is available.
翻译设置无效。	Invalid translation settings.
翻译已取消。	Translation canceled.
模型返回的翻译格式无效。	The model returned an invalid translation format.
模型译文为空或包含异常标记。	The model translation is empty or contains unexpected markers.
模型未返回译文。	The model returned no translation.
模型译文未完整返回。	The model translation is incomplete.
模型服务拒绝了翻译请求。	The model service rejected the translation request.
翻译模型认证失败。	Translation model authentication failed.
翻译模型额度不足。	The translation model quota is exhausted.
翻译模型请求频率受限。	The translation model is rate limited.
翻译模型拒绝了输出额度设置。	The translation model rejected the output limit setting.
所选模型不能完成该翻译任务。	The selected model cannot complete this translation task.
翻译请求超出任务额度。	The translation request exceeds the task allowance.
保存记录暂不可用，请重新打开	The saved record is unavailable. Reopen it.
保存记录的文献归属未确认，请从本机历史重新打开	The saved record's article identity is unconfirmed. Reopen it from local history.
未找到离线正文快照	No offline article snapshot was found
这篇文献的保存版本已变化，请重新打开	The saved version of this article changed. Reopen it.
已从本机恢复网页、样式与阅读图片 · 点击“查看保存记录”可在侧栏阅读已保存结果 · 离线只读	Page, styles and reading images restored locally · Open the saved record to read saved results in the sidebar · Offline, read only
部分布局或资源完整度未确认	Some layout or resource completeness is unconfirmed
已从本机恢复旧网页快照 · 图片与样式完整度未记录 · 保存记录可在侧栏只读查看	Legacy page snapshot restored locally · Image and style completeness was not recorded · Saved results are available read only in the sidebar
资源	Resource
嵌入资源	Embedded resource
无法打开离线文献	The offline article could not open
Figure 图像页核对	Review Figure image pages
关闭页码核对	Close page review
输入完整图像的物理页码，可多页；填写即人工指定。自动候选仅作参考，空白保持未指定。	Enter the physical page numbers containing the complete image; multiple pages are allowed. Entered values are manual selections. Automatic candidates are suggestions; blank fields remain unspecified.
保存全部页码	Save all page numbers
文献或图像来源已变化，请重新打开核对窗口。	The article or image source changed. Reopen the review window.
当前没有可核对的 PDF Figure。待图注目录建立后可重新打开。	No PDF Figures are ready for page review. Reopen this after the caption index is available.
完整图像页	Complete image pages
例如 5-6	For example, 5-6
完整图像页码	Complete image page numbers
无法定位此页，请用阅读器页码框查看。	This page could not be located. Use the reader's page number field.
缺少此 Figure 的保存回执	Save confirmation is missing for this Figure
保存失败，请重试	Saving failed. Retry.
整表校验失败，未保存任何行	Table validation failed; no rows were saved
PDF 原页尚未就绪，请稍后重试。	The original PDF pages are not ready. Retry shortly.
文献已变化，请重新打开。	The article changed. Reopen it.
旧页码记录未能恢复，请重新核对；其他 Figure 不受影响。	Previous page numbers could not be restored. Review them again; other Figures are unaffected.
PDF 已切换，请查看当前阅读状态后重试。	The PDF changed. Check the current reading status before retrying.
退出专注	Exit focus mode
退出专注阅读	Exit focused reading
进入专注阅读	Enter focused reading
文档已变化，请重新搜索。	The document changed. Search again.
这条原文已变化，请重新选择结果。	This source text changed. Select a result again.
PDF 文本索引仍在准备，请稍后再次按 Enter 搜索。	The PDF text index is still being prepared. Press Enter to search again shortly.
仅搜索当前可提取的文字；未识别或尚未索引的页面不在结果中。	Only currently extractable text is searched. Unrecognized or unindexed pages are excluded.
当前浏览器不支持临时语义高亮，请更新 Edge 或 Chrome。	Temporary semantic highlights are unavailable. Update Edge or Chrome.
网页检索组件未就绪，请刷新页面后重试。	The page search component is not ready. Refresh and retry.
当前网页已达到10000句累计上限；已有结果保留，停止自动补充检索。	This page reached the cumulative limit of 10,000 sentences. Existing results are preserved; automatic incremental search has stopped.
网页文字或可见范围已变化，请重新搜索。	Page text or its visible range changed. Search again.
搜索本页已加载、可渲染的文字（含屏幕外与已存在的开放 Shadow DOM）；不含 iframe、封闭 Shadow DOM、画布或图片内文字。	Search loaded, renderable text on this page, including off-screen text and existing open Shadow DOM. Excludes iframes, closed Shadow DOM, canvas and text in images.
PubMed 结果卡片含已加载的折叠摘要摘录；未加载的摘要全文不在范围内。	PubMed result cards include loaded excerpts from collapsed abstracts. Unloaded full abstracts are excluded.
当前页面没有可搜索的可见文字。	This page has no searchable visible text.
PDF 已变化，请重新搜索。	The PDF changed. Search again.
暂时无法定位这条原文，请重新搜索。	This source text could not be located. Search again.
正文位置已变化，请重新搜索。	The source location changed. Search again.
这条原文当前被网页折叠或隐藏；已有结果保留，请展开后再定位。	This source text is collapsed or hidden. Results are preserved; expand it before locating it.
这条原文暂时无法保存为高亮。	This source text cannot currently be saved as a highlight.
这条网页文字仅支持临时语义高亮，尚无可验证的论文保存位置。	This text supports temporary semantic highlights only; no verifiable article location is available for saving.
原文坐标已变化，请重新搜索。	The source coordinates changed. Search again.
原文坐标不匹配，请重新搜索。	The source coordinates do not match. Search again.
原文暂时不可见，请跳转到对应页面后重试。	The source text is not visible. Go to its page and retry.
PDF 已更换。	The PDF was replaced.
未配置可用的 TypeSafe Jev。请打开模型设置并为语义查找指定 Profile。	No usable TypeSafe Jev is configured. Open model settings and assign a profile to semantic search.
当前模型不能返回语义查找所需的概率，请改用 TypeSafe Jev。	This model cannot return the probabilities needed for semantic search. Use TypeSafe Jev.
请稍后重试	Retry shortly
当前网页可搜索文本；具体范围以本次索引为准。	Searchable page text; the current index determines the exact scope.
范围：当前 PDF 已索引文本（含未显示页）。	Scope: indexed text in the current PDF, including pages not displayed.
无需打开侧栏；搜索范围将在读取当前页面后显示。	No sidebar required. The search scope appears after the page is indexed.
检测到新增内容，已排队补充检索。	New content detected and queued for incremental search.
当前阈值下没有匹配结果。	No results match the current threshold.
自动补充检索已达到本轮文本容量上限；已有结果保留。	Automatic incremental search reached this run's text limit. Existing results are preserved.
新增文本索引格式无效。	Invalid incremental text index format.
新增文本缺少有效批次身份或句子。	The new text lacks a valid batch identifier or sentences.
新增文本段落身份无效。	Invalid paragraph identifier in the new text.
新增文本与已处理段落身份冲突。	The new text conflicts with an already processed paragraph identifier.
累计句子数量达到上限。	The cumulative sentence limit was reached.
新增句子的局部身份或原文坐标无效。	A new sentence has an invalid local identifier or source coordinates.
补充检索返回了错误的批次身份。	Incremental search returned an incorrect batch identifier.
模型返回了无效、冲突或不属于本批的分值。	The model returned invalid, conflicting or out-of-batch scores.
补充检索的批次覆盖计数不一致。	Incremental search batch coverage counts do not match.
当前文档已变化，请重新打开语义查找。	The document changed. Reopen semantic search.
当前分值 —	Current score —
当前文档没有可搜索的语义索引	This document has no searchable semantic index
当前文档没有可搜索的句子	This document has no searchable sentences
语义索引中的句子身份无效	Invalid sentence identifier in the semantic index
模型返回了无效或不属于当前文档的匹配分值。	The model returned invalid scores or scores for a different document.
模型对同一句子返回了冲突分值。	The model returned conflicting scores for the same sentence.
结果覆盖计数不一致，未标记全文完成。	Result coverage counts do not match. The document was not marked complete.
请输入要查找的语义描述。	Describe the meaning you want to find.
按 Enter 开始语义查找。	Press Enter to start semantic search.
描述要查找的语义	Describe the meaning to find
语义查找内容	Semantic search description
按匹配分值从高到低浏览结果	Browse results from highest to lowest match score
上一条	Previous result
下一条	Next result
最低显示分值	Minimum displayed score
模型匹配分值：从高到低 · 深色表示分值更高	Model match score: high to low · Darker colors indicate higher scores
输入描述后按 Enter 搜索。	Enter a description and press Enter to search.
当前文档已变化，请重新搜索。	The document changed. Search again.
语义检索暂时无法启动，请刷新页面后重试。	Semantic search could not start. Refresh and retry.
更改已保存在浏览器草稿，等待同步…	Changes are saved in the browser draft, awaiting sync…
预览模式 · 更改仅保留在当前页面	Preview mode · Changes remain on this page only
已保存，等待同步到本地文件夹	Saved, awaiting sync to the local folder
已安全保存到浏览器	Saved safely in the browser
新更改已留在草稿中，继续同步…	New changes are preserved in the draft. Continuing sync…
另一窗口修改了这张图；本地草稿仍安全保留	Another window changed this map; the local draft is safely preserved
待补充科学问题	Add a scientific question
未命名科学问题	Untitled scientific question
表格范围待补充	Add a table range
Panel 待补充	Add Panels
证据组	Evidence group
待补充证据点	Add an evidence point
观察结果待补充	Add an observation
需人工确认 Panel—观察—论证作用是否应拆成多个证据点	Review whether the Panel, observation and role in the argument should be split into multiple evidence points
展开本图证据组	Expand this figure's evidence groups
折叠本图证据组	Collapse this figure's evidence groups
跳到原文 Figure	Go to the source Figure
待补充证据组	Add an evidence group
已知背景	Known background
最终得到的所有结论（对应最初科学问题）	Final conclusions mapped to the original scientific questions
待补充最终结论	Add a final conclusion
可在左侧编辑面板手动新建补充图、视频或表格	Use the editor on the left to add a supplementary figure, video or table
展开补充材料证据组	Expand supplementary evidence groups
折叠补充材料证据组	Collapse supplementary evidence groups
待补充该材料证明或支持的内容	Add what this material demonstrates or supports
补充证据组	Supplementary evidence group
需人工确认并拆分证据点	Review and split the evidence points
待补充证据组结论	Add an evidence group conclusion
当前证据尚不足以形成机制链	The current evidence is insufficient to form a mechanism chain
支持与反证并存	Both supporting and opposing evidence exist
尚未填写结论边界	No conclusion boundaries have been entered
展开编辑	Expand editor
展开所有图	Expand all figures
填写一个要点	Enter a point
删除此要点	Delete this point
添加要点	Add a point
已知背景（分点）	Known background (bullet points)
添加背景要点	Add a background point
科学问题（关系图）	Scientific questions (relationship graph)
问题内容	Question text
逻辑关系	Logical relationship
总问题无需上游问题	The main question needs no upstream question
当前没有可选择的上游问题	No upstream questions are available
支持 Figure（用逗号分隔）	Supporting Figures (comma separated)
＋ 添加科学问题	+ Add scientific question
上移	Move up
下移	Move down
原文	Source text
添加问题要点	Add a question point
＋ 添加证据组	+ Add evidence group
添加本图结论	Add a conclusion for this figure
论证角色	Role in the argument
个人备注	Personal notes
此点来自旧版组合证据，请确认 Panel、观察结果和论证作用是否需要拆分。	This point came from combined evidence in an earlier version. Review whether its Panels, observations and roles should be split.
已核对	Reviewed
定位类型	Location type
视频时间段	Video time range
表格范围	Table range
开始秒数	Start time (seconds)
结束秒数	End time (seconds)
例如：Table S2, rows 3–8	For example: Table S2, rows 3–8
Panel（用逗号分隔）	Panels (comma separated)
该证据点的论证作用	This evidence point's role in the argument
证据边界 / 局限	Evidence boundaries / limitations
删除组	Delete group
证据组名称	Evidence group name
方法	Method
证据组共同支持	What the evidence group jointly supports
组级局限	Group-level limitations
＋ 添加证据点	+ Add evidence point
最终结论及其对应科学问题	Final conclusions and their scientific questions
结论内容	Conclusion text
＋ 添加最终结论	+ Add final conclusion
暂不连接	Leave unconnected
材料类型	Material type
补充表格	Supplementary table
折叠时显示的一句话功能	One-sentence role shown when collapsed
添加该材料证明的结论	Add a conclusion demonstrated by this material
整图中心连接到主 Figure	Connect the whole supplementary figure to a main Figure
＋ 添加补充证据组	+ Add supplementary evidence group
返回整图	Back to the whole figure
组中心连接到主图证据组	Connect this group to a main-figure evidence group
机制链（信号通路规范）	Mechanism chain (signaling pathway conventions)
作用类型	Effect type
正向 / 促进（箭头）	Positive / activating (arrow)
负向 / 抑制（T 形末端）	Negative / inhibitory (T-shaped end)
相关性 / 方向不确定	Association / uncertain direction
强证据（实线）	Strong evidence (solid line)
弱证据（虚线）	Weak evidence (dashed line)
支持 Panel（用逗号分隔）	Supporting Panels (comma separated)
＋ 添加机制连接	+ Add mechanism connection
哪些结论尚不能外推？	Which conclusions cannot yet be generalized?
已选中：已知背景	Selected: known background
已选中：科学问题	Selected: scientific questions
已选中：Figure 要解决的问题	Selected: question addressed by the Figure
已选中：本图证明	Selected: what this figure demonstrates
已选中：主图证据组	Selected: main-figure evidence group
已选中：最终结论	Selected: final conclusions
已选中：补充材料	Selected: supplementary material
已选中：补充证据组	Selected: supplementary evidence group
已选中：机制链	Selected: mechanism chain
已选中：结论边界	Selected: conclusion boundaries
请选择右侧内容模块	Select a content section on the right
因此下一图需要回答	The next figure therefore needs to address
原文 Figure 暂时无法定位；请刷新原文页面后重试	The source Figure could not be located. Refresh the article and retry.
退出全屏	Exit full screen
已载入工作区中的最新版本	The latest workspace version is loaded
科研逻辑图	Research logic map
预览模式 · 已载入示例论证链	Preview mode · Sample argument chain loaded
论证地图链接缺少工作区信息	The argument map link lacks workspace information
没有找到这张论文论证地图	This article's argument map was not found
远端版本已变化；本地草稿仍保留。请选择恢复草稿或使用远端版本。	The remote version changed. The local draft is preserved; choose whether to restore it or use the remote version.
无匹配	No matches
无法打开研读侧栏	The reading sidebar could not open
原论文标签页已经关闭，且没有可恢复的原文网址。	The original article tab is closed and no source URL is available to restore it.
无法返回原论文	The original article could not reopen
补充 PDF 图片尚未完成父论文保存核验，已保存结果保留。	Supplementary PDF images have not completed save verification against the parent article. Saved results are preserved.
MinerU 轻量解析按 IP 限频，官方未提供实时剩余量。	MinerU lightweight extraction is rate limited by IP. No live remaining quota is provided.
版面解析完成，正在下载结构化正文与图片…	Layout extraction complete. Downloading structured text and images…
MinerU 轻量解析失败	MinerU lightweight extraction failed
等待文件上传	Waiting for file upload
精准解析需要先填写 MinerU Token	Enter a MinerU token before precise extraction
MinerU 精准解析失败	MinerU precise extraction failed
精准解析完成，正在读取 Markdown 与 Figure 图片…	Precise extraction complete. Reading Markdown and Figure images…
PDF 插图	PDF illustration
解析结果已保存，但原页文字层未能建立。可重试增强识别；原始 PDF 仍可正常阅读。	Extracted results are saved, but the original-page text layer could not be built. Retry enhanced recognition; the original PDF remains readable.
辅助文本与 Figure 已保存；继续在 PDF 原页上阅读。	Supporting text and Figures are saved. Continue reading the original PDF pages.
文字层增强未完成	Text-layer enhancement is incomplete
文本识别已完成	Text recognition complete
Brevess: 补充图目录同步失败	BREVESS: supplementary figure index sync failed
已恢复解析结果	Extracted results restored
解析缓存未能恢复，原始 PDF 可继续阅读。可重试增强识别。	The extraction cache could not be restored. The original PDF remains readable; retry enhanced recognition.
缓存恢复未完成	Cache restoration is incomplete
本地缓存已升级	Local cache upgraded
已保留原缓存；新版完整图可在本地伴侣可用后再自动升级。	The original cache is preserved. Complete figures can be upgraded automatically when the local companion is available.
已从原论文工作区恢复解析正文与补充图；如需查看原始 PDF，可在下方重新选择本地文件。	Extracted text and supplementary figures are restored from the parent article workspace. Select the local file below to view the original PDF.
尚未取得与当前原页一致的 PDF 文件，未提交增强识别。请等待原页读取完成，或重新选择当前 PDF 后重试。	No PDF matching the current original pages is available, so enhanced recognition was not started. Wait for loading to finish or select the current PDF again.
这篇 PDF 超过轻量解析限制。请在 Brevess“模型与分析”设置页切换精准解析并填写 MinerU Token。	This PDF exceeds the lightweight extraction limit. In BREVESS Models and analysis settings, select precise extraction and enter a MinerU token.
精准解析需要 MinerU Token，请在 Brevess“模型与分析”设置页填写；Token 只保存在当前浏览器。	Precise extraction requires a MinerU token. Enter it in BREVESS Models and analysis settings; it stays in this browser only.
MinerU Token 无效或已过期，请更新后重试。	The MinerU token is invalid or expired. Update it and retry.
当前浏览器不支持解压 MinerU 结果，请升级浏览器或改用轻量解析。	This browser cannot unpack MinerU results. Update the browser or use lightweight extraction.
原论文标签页已经变化，无法继续使用该出版社会话。请返回原论文后重新点击“解析并纳入”，或在下方选择已下载的补充 PDF。	The parent article tab changed, so its publisher session cannot be reused. Return to the article and choose Extract and include again, or select a downloaded supplementary PDF below.
浏览器自动读取出版社补充 PDF 失败。请确认原论文仍可正常打开并重试；也可以在下方选择已下载的补充 PDF。	The browser could not read the publisher's supplementary PDF. Confirm the parent article still opens and retry, or select a downloaded supplementary PDF below.
这个补充 PDF 超过 MinerU 的 200 MB 文件限制。	This supplementary PDF exceeds MinerU's 200 MB file limit.
补充 PDF 已读取，但直传 MinerU 失败，请重新解析；若仍失败可在下方手动选择文件。	The supplementary PDF was read but could not be uploaded directly to MinerU. Retry extraction or select the file below.
增强识别已完成，但文字索引尚未保存成功。原页仍可阅读，请重试保存或重新打开。	Enhanced recognition completed, but the text index was not saved. Original pages remain readable; retry saving or reopen the file.
文字索引保存未完成	Text index saving is incomplete
未能从原始 PDF 提取补图	Supplementary figures could not be extracted from the original PDF
PDF 来源已改变	The PDF source changed
原始 PDF 没有可用文字层	The original PDF has no usable text layer
原始 PDF 尚未完成读取，增强识别没有启动。请稍后重试。	The original PDF has not finished loading. Enhanced recognition was not started; retry shortly.
读取失败	Loading failed
等待原页就绪	Waiting for original pages
原页读取失败	Original pages could not load
扫描页需要带坐标的文字识别，请先在识别设置填写 MinerU Token。原始 PDF 可继续阅读。	Scanned pages need text recognition with coordinates. Enter a MinerU token in recognition settings; the original PDF remains readable.
需要配置扫描页识别	Configure scanned-page recognition
暂时无法直接读取这个本地 PDF。请允许 Brevess 访问文件网址后重试，或在下方重新选择当前文件。	This local PDF could not be read directly. Allow BREVESS access to file URLs and retry, or select the current file below.
需要本地文件访问权限	Local file access is required
精准解析需要 MinerU Token，请在 Brevess“模型与分析”设置页填写。	Precise extraction requires a MinerU token. Enter it in BREVESS Models and analysis settings.
需要 MinerU Token	A MinerU token is required
未能使用本地完整图引擎；本次先保留 MinerU 图像结果。安装或重新加载 Brevess 本地伴侣后可重试。	The local complete-figure engine was unavailable. MinerU images are preserved for now; install or reload the BREVESS local companion and retry.
本次图像提取已停止；已建立的图注目录仍保留。	Image extraction stopped. The existing caption index is preserved.
增强识别已取消，已读取的原页与索引仍保留。	Enhanced recognition canceled. Loaded original pages and indexes are preserved.
增强识别已取消	Enhanced recognition canceled
原页仍可阅读。	Original pages remain readable.
增强识别未完成	Enhanced recognition is incomplete
本地 PDF 已就绪	Local PDF ready
打开附件下载页	Open attachment download page
请选择已经下载到本机的补充 PDF	Select a supplementary PDF already downloaded to this device
Brevess 不再尝试自动下载或代传期刊附件。选择文件后会显示 PDF 原页；	BREVESS does not automatically download or upload journal attachments. Selecting a file displays its original PDF pages;
增强识别结果用于侧栏索引和补充图解读。	Enhanced recognition results support sidebar indexing and supplementary figure interpretation.
请先点击右上角“打开附件下载页”自行下载，再在下方选择该 PDF。	Use Open attachment download page at the top right to download the file, then select the PDF below.
请先从期刊页面自行下载补充材料，再在下方选择该 PDF。	Download the supplementary material from the journal page, then select the PDF below.
请选择补充材料 PDF	Select a supplementary PDF
PDF 尚未准备完成	The PDF is not ready
打开本地 PDF 文献	Open a local PDF article
选择后直接显示 PDF 原页，自动建立本地文字索引；无需 MinerU。	Selecting a file displays its original PDF pages and builds a local text index automatically. MinerU is not required.
选择已下载的 PDF，即可在原页上选择文字、标注并提问。	Select a downloaded PDF to select text, annotate and ask questions on its original pages.
请选择 PDF 文献	Select a PDF article
未识别到明确图注。可使用增强识别补充图文索引。	No clear figure captions were found. Use enhanced recognition to supplement the text and image index.
原 PDF 没有可提取的文字层。原页可正常阅读；使用“增强文本识别”补充 OCR 后可进行划选、自动高亮和问答。	The original PDF has no extractable text layer. Its pages remain readable; use Enhance text recognition to add OCR for selection, automatic highlighting and questions.
原页可读，需文字识别	Original pages are readable; text recognition is needed
原页与文字索引已就绪	Original pages and text index are ready
文字索引不完整	The text index is incomplete
；当前始终显示 PDF 原页。	; the original PDF pages remain displayed.`.split('\n').map(line => line.split('\t')));

  Object.assign(entries, Object.fromEntries(`文献或解图内容已变化。请关闭绘图面板，再从当前文献重新打开。	The article or figure analysis changed. Close the drawing panel and reopen it from the current article.
图表已有较新的修改。请重新打开面板后再试，原数据已保留。	The diagram has newer changes. Reopen the panel and retry; existing data is preserved.
找不到原节点、联系或证据块。请重新选择当前文献中的项目。	The original node, connection or evidence block was not found. Select an item from the current article again.
该项目已存在，请选中已有联系或证据进行编辑。	This item already exists. Select the existing connection or evidence to edit it.
本次修改未保存。请检查节点、联系与证据选择后重试。	Changes were not saved. Check the selected nodes, connections and evidence, then retry.
绘图与解图面板的连接已关闭，请重新打开图表梳理。	The drawing panel disconnected from figure analysis. Reopen Diagram editor.
保存未成功，原数据已保留。请稍后重试。	Saving failed. Existing data is preserved; retry later.
保存未成功，请重试。	Saving failed. Please retry.
证据块格式无效，请从解图模块重新拖入。	Invalid evidence block format. Drag it from figure analysis again.
无法读取证据块，请从解图模块重新拖入。	The evidence block could not be read. Drag it from figure analysis again.
这份证据来自另一篇文献，请使用当前文献的解图证据。	This evidence belongs to another article. Use evidence from the current article's figure analysis.
当前解图中已找不到该证据块，请刷新解图后重试。	This evidence block is missing from the current figure analysis. Refresh it and retry.
手动绘制图表梳理	Manual diagram editor
图表梳理	Diagram editor
手动绘制	Manual drawing
关闭图表梳理	Close diagram editor
绘图工具	Drawing tools
＋ 节点	+ Node
连线	Connect
平移	Pan
撤销 Ctrl+Z	Undo Ctrl+Z
重做 Ctrl+Shift+Z	Redo Ctrl+Shift+Z
适应画布	Fit canvas
论证步骤	Argument steps
当前进度	Current step
全部联系	All connections
证据矩阵	Evidence matrix
机制图画布：拖动节点；从端口拉线；空白拖动平移；Shift 框选；滚轮缩放	Mechanism canvas: drag nodes; connect from ports; drag empty space to pan; Shift-drag to select; scroll to zoom
添加节点，拉线连接，再从右侧解图拖入证据块。	Add nodes, draw connections, then drag in evidence blocks from figure analysis on the right.
拖动节点 · 从端口拉线 · 空白拖动平移；Shift 框选	Drag nodes · Connect from ports · Drag empty space to pan; Shift-drag to select
选择项编辑	Edit selection
调整证据矩阵高度	Resize evidence matrix height
列为起点 · 行为终点	Columns: sources · Rows: targets
可多选；红蓝双色表示同时为充分与必要。相关或未分类为中性颜色。	Multiple types can be selected. Red and blue indicate both sufficient and necessary evidence. Related or unclassified evidence uses a neutral color.
节点乘节点证据矩阵	Node-by-node evidence matrix
图表中的证据名称可点击定位，右键可更改。	Click an evidence label to locate it; right-click to edit.
证据块操作	Evidence block actions
编辑通道尚未就绪。	The editing connection is not ready.
尚未收到保存确认；图表保留原状态，请重试。	Save confirmation has not arrived. The diagram retains its previous state; retry.
未命名证据	Untitled evidence
平移画布 · 点击“选择”可拖动节点	Pan canvas · Choose Select to drag nodes
依次点击两个节点连线 · 点击“选择”可拖动节点	Click two nodes to connect them · Choose Select to drag nodes
拖动节点 · 双击编辑 · 从端口拉线 · 空白拖动平移；Shift 框选	Drag nodes · Double-click to edit · Connect from ports · Drag empty space to pan; Shift-drag to select
阅读进度	Reading progress
移动重叠节点以显示连线	Move overlapping nodes to reveal the connection
添加节点后，此处自动显示节点 × 节点矩阵。	Add nodes to display the node-by-node matrix here.
终点 ↓ / 起点 →	Target ↓ / Source →
暂无联系	No connections
待添加证据	Add evidence
关闭编辑面板	Close editing panel
节点文字	Node text
拖动节点调整位置。按住 Shift 点击可多选。	Drag nodes to reposition them. Hold Shift and click to select several.
拖动其中一个节点可移动整组选区。	Drag any selected node to move the entire selection.
删除所选节点	Delete selected nodes
删除节点	Delete node
联系文字	Connection text
联系方向含义	Connection direction
促进 →	Promotes →
抑制 ⊣	Inhibits ⊣
关联 ···	Associated ···
反向	Reverse
已绑定证据	Attached evidence
拖入证据块，或从下方选择。	Drag an evidence block here or select one below.
证据名称：点击定位；右键更改类型、替换或移除。	Evidence labels: click to locate; right-click to change type, replace or remove.
证据类型（可多选）	Evidence types (select one or more)
替换证据	Replace evidence
从解图添加证据	Add evidence from figure analysis
选择 Figure 证据块	Select a Figure evidence block
添加到此联系	Attach to this connection
删除联系	Delete link
同节点间的联系	Connections between these nodes
条件或阶段	Condition or stage
例如：小鼠毛囊，处理后 24 小时	For example: mouse hair follicles, 24 hours after treatment
同节点间另建联系	Add another connection between these nodes
原证据块暂不可用；可以右键替换或移除这项绑定。	The original evidence block is unavailable. Right-click to replace or remove this attachment.
合并前的来源记录（只读）	Source record before merging (read only)
合并前的来源记录（只读）；这是合并前最后保存的历史来源，当前绑定仍需复核。	Source record before merging (read only); this is the last saved historical source. The current attachment still needs review.
观察	Observation
原证据块暂不可用；请复核、替换或移除绑定。	The original evidence block is unavailable. Review, replace or remove the attachment.
点击在解图中定位 · 右键更改	Click to locate in figure analysis · Right-click to edit
联系或原证据已变化，请复核此处证据类型。	The connection or original evidence changed. Review its evidence type.
既有单 Panel 引用	Existing single-Panel reference
移除此证据	Remove this evidence
该证据	This evidence
请选择两个不同节点建立联系。	Select two different nodes to connect.
已选中现有联系；不同条件下的关系可用“另建联系”。	The existing connection is selected. Use Add another connection for a different condition.
编辑节点文字，Enter 保存，Shift+Enter 换行，Escape 取消	Edit node text: Enter to save, Shift+Enter for a new line, Escape to cancel
节点文字不能为空。可按 Escape 取消修改。	Node text cannot be empty. Press Escape to cancel.
在下方选择新的 Figure 证据块，再点击“替换证据”。	Select a new Figure evidence block below, then choose Replace evidence.
已将既有 Panel 引用替换为所选完整证据块，请定义证据类型。	The existing Panel reference was replaced with the selected complete evidence block. Set its evidence type.
已替换证据块，请复核此联系的证据类型。	The evidence block was replaced. Review this connection's evidence type.
关闭步骤编辑	Close step editor
保存每一步显示的节点、联系与证据。画布坐标保持固定；完整矩阵始终保留。	Save the nodes, connections and evidence shown in each step. Canvas positions stay fixed and the full matrix is retained.
编辑哪一步	Choose a step to edit
添加步骤	Add step
未命名步骤	Untitled step
尚无步骤	No steps yet
步骤标题	Step title
简短说明	Brief description
对应 Figure（用于刻度与解图定位）	Figures (for progress markers and figure navigation)
解图后可选择实际 Figure。	Analyze figures to select the corresponding Figures here.
此联系尚无证据	This connection has no evidence yet
先选择此步显示的联系。	Select the connections to show in this step first.
添加步骤会记录当前画布可见内容，再按需要勾选。	Adding a step captures the current canvas contents. Adjust the selection as needed.
保存步骤	Save steps
最多可设置 64 个论证步骤。	Up to 64 argument steps can be added.
请为每个步骤填写标题。	Enter a title for every step.
已保存上次提交的步骤；编辑面板中的新修改仍待保存。	The previously submitted steps were saved. New changes in the editor still need saving.
已保存论证步骤。拖动进度条逐步查看，节点位置保持不变。	Argument steps saved. Drag the progress slider to view them; node positions stay fixed.
依次点击起点和终点，或从节点端口拉线。	Click the source and target nodes, or drag from a node port.
连线工具已关闭。	The connection tool is off.
请先选择一个解图证据块。	Select an evidence block from figure analysis first.
在“从解图添加证据”中选择新证据，再点击“替换证据”。	Select new evidence under Add evidence from figure analysis, then choose Replace evidence.
节点文字不能为空。	Node text cannot be empty.
起点和终点需要是不同节点。	Source and target must be different nodes.
请拖到一条联系线上；靠近交叉处时，请移向该联系的独立线段。	Drop onto a connection line. Near an intersection, move to a separate segment of that connection.
未找到明确的目标联系。请拖到该联系的独立线段，或在编辑面板中添加证据。	No clear target connection was found. Drop onto a separate segment or add evidence in the editing panel.
因果	Causal
未见变化	No change observed
方向不一致	Mixed directions
方向未确定	Direction undetermined
反向证据	Counterevidence
无关系反向证据	Counterevidence without a relationship
无显著关系	No significant relationship
定位证据	Localization evidence
节点观察	Node observation
已关联因果关系	Linked causal relationship
已关联相关关系	Linked correlational relationship
节点证据（无关系边）	Node evidence (no relationship edge)
来源支持的示意图（不构成关系证据）	Source-backed schematic (not relationship evidence)
未解析	Unresolved
干预对象与关系方向冲突，需核对原文	The intervention target conflicts with the relationship direction; check the source
关系端点或方向尚未可靠对应	Relationship endpoints or direction are not reliably mapped
尚未完成关系对应	Relationship mapping is incomplete
原文中的实验示意图	Experimental schematic in the source
同一 Panel 的结论存在冲突	Claims for the same Panel conflict
现有实验设计不足以支持因果关系	The experimental design does not establish causality
仅有反向证据，不绘入已确认机制	Counterevidence only; excluded from the confirmed mechanism
有支持证据	Supporting evidence available
关系性质未确定	Relationship type undetermined
物种	Species
组织	Tissue
细胞	Cell
区室	Compartment
时间	Time
剂量	Dose
实验上下文未提供	Experimental context not provided
来源定位未提供	Source location not provided
证据类型未确定	Evidence type undetermined
作用未确定	Role undetermined
未知节点	Unknown node
无关系证据	Evidence without a relationship
未解析证据	Unresolved evidence
Panel 状态未确定	Panel status undetermined
未形成关系边	No relationship edge
待核验关系与 Panel 证据	Relationships and Panel evidence awaiting review
支持 Panel 与来源	Supporting Panels and sources
该候选关系没有可列出的 Panel 证据。	No Panel evidence is listed for this candidate relationship.
查看 Panel	View Panel
尚无候选关系；节点和无关系证据仍保留在本预览中。	No candidate relationships yet. Nodes and evidence without relationships remain in this preview.
机制图组件尚未就绪；请使用下方节点、关系和证据表核验。	The mechanism diagram is not ready. Use the nodes, relationships and evidence table below to review it.
生物实体	Biological entity
结果	Outcome
过程	Process
机制节点	Mechanism node
没有可展示的候选节点。	No candidate nodes to display.
待核验机制节点与关系图	Mechanism nodes and relationships awaiting review
候选关系图渲染失败；节点、关系和 Panel 证据仍可在下方核验。	The candidate diagram could not be rendered. Review its nodes, relationships and Panel evidence below.
合并前的来源记录，只读保留。历史说明不会自动成为当前结论，原联系仍需复核。	Source records from before merging are preserved read only. Historical descriptions do not become current conclusions; existing connections still need review.
原证据块	Original evidence block
已变更的证据块	Changed evidence block
未填写	Not entered
请分别填写原图中的 Panel 编号，例如 A、C、D；不要输入范围或 Figure 编号。	Enter individual Panel labels from the original figure, such as A, C, D. Do not enter ranges or Figure numbers.
请至少选择或填写一个真实 Panel。	Select or enter at least one actual Panel.
一个证据块最多包含 32 个 Panel。	An evidence block can contain up to 32 Panels.
当前 Figure 或证据块标识缺失，请重新打开。	The current Figure or evidence block identifier is missing. Reopen the editor.
每项说明最多 4000 字，请缩短后保存。	Each description is limited to 4,000 characters. Shorten it before saving.
当前证据块不存在，请重新打开。	The current evidence block no longer exists. Reopen the editor.
拆分时请选择原块的一部分 Panel；原块和新块都至少保留一个。	Select only some Panels when splitting. Both blocks must retain at least one Panel.
上方 Panel 成员尚有修改，请先保存成员变化，再进行合并。	Panel membership has unsaved changes. Save them before merging.
请选择另一个需要合并的证据块。	Select another evidence block to merge.
调整分组与说明	Edit grouping and descriptions
手动组合 Panel	Group Panels manually
选择原图中共同支持一项结论的 Panel。说明可留空，保存后可直接拖到机制图联系上。	Select Panels that jointly support a conclusion. Descriptions are optional. After saving, drag the block onto a mechanism connection.
尚无 Panel 目录，请对照原图填写下方编号。	There is no Panel index yet. Refer to the original figure and enter labels below.
补充原图中的 Panel 编号	Add Panel labels from the original figure
例如 A、C、D	For example: A, C, D
逐个填写图中已有编号；会保存为人工定义的 Panel，不推测图像或实验内容。	Enter existing figure labels individually. They are saved as manually defined Panels, without inferring images or experiments.
充分、必要、相关在绑定到具体联系后定义。人工证据块会在后续 AI 更新中保留。	Set sufficient, necessary or related evidence after attaching it to a connection. Manual evidence blocks are preserved in later AI updates.
保存证据块	Save evidence block
文献或草稿已有变化。本次输入仍保留，请复制后重新打开编辑器。	The article or draft changed. Your input is preserved; copy it before reopening the editor.
文献或草稿已有变化，本次保存结果未应用到当前界面。	The article or draft changed. This save result was not applied to the current view.
证据块未保存。输入已保留，请重试。	The evidence block was not saved. Your input is preserved; retry.
证据块未保存。请核对 Panel 编号后重试；输入已保留。	The evidence block was not saved. Check Panel labels and retry; your input is preserved.
拆分或合并分组	Split or merge groups
拆分会把上方勾选的原有 Panel 移到新块，新块使用当前填写的说明；合并将选定块成员加入当前块，使用当前填写的说明，被并入块的说明保留在合并历史。旧联系引用保留并提示复核，证据类型不会自动转移。	Splitting moves selected Panels into a new block with the current descriptions. Merging adds the chosen block's Panels to this block and retains the current descriptions; the merged block's descriptions remain in history. Existing connection references are preserved for review. Evidence types are not transferred automatically.
将勾选 Panel 拆为新块	Move selected Panels into a new block
拆分仅移动原块已有成员；请先清空补充编号。	Splitting only moves existing Panels. Clear additional labels first.
合并另一个证据块	Merge another evidence block
选择当前 Figure 的其他块	Select another block from this Figure
未填写标题	Untitled
合并所选块到当前块	Merge selected block into this block
移除此证据块	Remove this evidence block
改变 Panel 成员或移除证据块后，已绑定的联系会保留来源记录并提示复核。	After changing Panel membership or removing a block, attached connections retain their source records and require review.
格式标记会超过 12000 字符，已保留原文。	Formatting would exceed 12,000 characters. The original text is preserved.
选区边界无效，请重新选择完整文字；原文已保留。	Invalid selection boundaries. Select complete text again; the original is preserved.
请先选中需要设置格式的文字。	Select text to format first.
代码片段内暂不添加文字格式，原文已保留。	Formatting is unavailable inside code. The original text is preserved.
选区跨过格式或链接标记，请只选择完整文字；原文已保留。	The selection crosses formatting or link markers. Select complete text; the original is preserved.
该选区无法安全设置格式，原文已保留。	This selection cannot be formatted safely. The original text is preserved.
格式内容过于复杂，已保留原文。	The formatting is too complex. The original text is preserved.
请选择列表中的文字颜色；原文已保留。	Choose a listed text color. The original text is preserved.
预览无法解析格式，已保留原文。	The preview could not parse formatting. The original text is preserved.
预览暂不可用，已显示原文。	Preview unavailable. Showing the original text.
当前笔记不可编辑，原文已保留。	This note is not editable. The original text is preserved.
格式工具暂不可用，请重新打开笔记。	Formatting tools are unavailable. Reopen the note.
无法设置选区格式，原文已保留。	The selection could not be formatted. The original text is preserved.
选区格式未改变。	Selection formatting unchanged.
编辑期间内容或状态已更新，已保留当前内容。	The content or state changed during editing. Current content is preserved.
编辑已取消，原文已保留。	Editing canceled. The original text is preserved.
格式写入未完成，已保留当前内容。	Formatting was not fully applied. Current content is preserved.
已应用选区格式。	Selection formatting applied.`.split('\n').map(line => line.split('\t'))));
  Object.assign(entries, {
    '添加节点': 'Add node', '修改节点': 'Edit node', '移动节点': 'Move nodes',
    '建立联系': 'Create connection', '修改联系': 'Edit connection', '修改证据类型': 'Edit evidence types',
    '移除证据': 'Remove evidence', '修改论证步骤': 'Edit argument steps', '编辑机制图': 'Edit mechanism diagram',
    '已撤销': 'Undone', '已重做': 'Redone', '便签笔记': 'Sticky note',
    '请先打开手动绘制，再把证据块拖到联系线上。': 'Open manual drawing first, then drag the evidence block onto a connection.',
    '此证据块尚未同步到当前文献，请等待保存完成后重试。': 'This evidence block has not synced to the current article. Wait for saving to finish and retry.',
    '论文论证阶梯': 'Article argument ladder', '未命名论文论证阶梯': 'Untitled article argument ladder',
    '这张图要回答什么问题？': 'What question does this figure address?',
    '未标注 Panel': 'No Panels specified', '问题建立': 'Problem formulation', '现象发现': 'Phenomenon discovery',
    '机制解析': 'Mechanism analysis', '综合证据': 'Combined evidence', '方法细节': 'Method details',
    '对照证据': 'Control evidence', '稳健性验证': 'Robustness validation', '结果延伸': 'Extended findings',
    '机制补强': 'Additional mechanistic evidence', '边界证据': 'Boundary evidence', '独立补充': 'Independent support',
    '待确认关联': 'Association to confirm', '补充证据': 'Supplementary evidence',
    '分步论证摘要': 'Step-by-step argument summary', '当前证据尚不足以形成单一机制链。': 'The current evidence is insufficient to establish a single mechanism chain.',
    '本图要回答': 'Question addressed', '本图结论': 'Figure conclusion', '下一图要解决': 'Question for the next figure',
    '附属补强证据 · 不参与主图推进': 'Supplementary supporting evidence · outside the main figure sequence',
    '尚未填写证据组结论。': 'No evidence-group conclusion yet.', '尚未填写结论边界。': 'No conclusion boundaries yet.',
    '强证据': 'Strong evidence', '弱证据': 'Weak evidence', '观察待补充': 'Observation to add',
    '本图要解决的问题': 'Question addressed by this figure', '本图证明': 'What this figure demonstrates',
    '证据组与证据点': 'Evidence groups and evidence points', '最终结论（对应科学问题）': 'Final conclusions (linked to research questions)',
    '搜索': 'Search', '部分保存': 'Partially saved', '整表校验失败，未保存任何行': 'Batch validation failed; no rows were saved',
    '正在补充检索新加载内容；已有结果保留。': 'Searching newly loaded content; existing results are preserved.',
    '点击定位；右键或 Shift+F10 更改': 'Click to locate; right-click or Shift+F10 to edit',
    '原证据暂不可用': 'Original evidence unavailable', '待复核': 'Needs review',
    '原 Panel': 'Original Panels', '原因': 'Reason', '候选关系': 'Candidate relationships',
    '移除': 'Remove', '在解图中定位': 'Locate in figure analysis',
    '选择': 'Select', '撤销': 'Undo', '重做': 'Redo', '联系': 'Relationship',
    '起点': 'Start', '终点': 'End', '充分': 'Sufficient', '必要': 'Necessary', '相关': 'Correlation',
    '新节点': 'New node', '支持': 'Supports', '选择 Panel（可多选）': 'Select Panels (one or more)'
  });
  const ui = value => root.SciLLM?.translateInterfaceText?.(value, 'en') || value;
  // Every dynamic rule matches a complete built-in message. Captured article,
  // filename and authored note values remain unchanged; only UI errors/enums
  // are recursively translated where their source is a built-in status.
  const patterns = [
    // Bridge history labels contain authored node/edge text. Translate only the
    // finite command/status prefix and retain the complete captured label.
    [/^(已保存|已撤销|已重做)：(添加节点|修改节点|删除节点|移动节点|建立联系|修改联系|删除联系|添加证据|修改证据类型|移除证据|替换证据|修改论证步骤|编辑机制图)(?:：([\s\S]*))?$/u,
      m => `${({已保存:'Saved',已撤销:'Undone',已重做:'Redone'})[m[1]]}: ${ui(m[2])}${m[3] !== undefined ? ': ' + m[3] : ''}`],
    [/^(添加节点|修改节点|删除节点|移动节点|建立联系|修改联系|删除联系|添加证据|修改证据类型|移除证据|替换证据|修改论证步骤|编辑机制图)：([\s\S]+)$/u,
      m => `${ui(m[1])}: ${m[2]}`],
    [/^证据步骤 (\d+)$/u, m => `Evidence step ${m[1]}`],
    [/^Panel ([\s\S]+) 等 (\d+) 个$/u, m => `Panel ${m[1]} (${m[2]} total)`],
    [/^下一图：([\s\S]+)$/u, m => `Next figure: ${m[1]}`],
    [/^✓ (充分|必要|相关)$/u, m => `✓ ${ui(m[1])}`],
    [/^＋ (添加.+)$/u, m => `+ ${ui(m[1])}`],
    [/^(\d+) 节点 · (\d+) 联系 · (\d+) 证据$/u, m => `${m[1]} nodes · ${m[2]} connections · ${m[3]} evidence items`],
    [/^节点 (.+)，双击编辑文字$/u, m => `Node ${m[1]}; double-click to edit text`],
    [/^从 (.+) 拉线$/u, m => `Connect from ${m[1]}`],
    [/^编辑联系 (.+)$/u, m => `Edit connection ${m[1]}`],
    [/^已选 (\d+) 个节点$/u, m => `${m[1]} nodes selected`],
    [/^(\d+) 条联系$/u, m => `${m[1]} connections`],
    [/^此步(节点|联系|证据) · (\d+)$/u, m => `${({节点:'Nodes',联系:'Connections',证据:'Evidence'})[m[1]]} in this step · ${m[2]}`],
    [/^步骤 (\d+)$/u, m => `Step ${m[1]}`],
    [/^已选择起点 (.+)，请选择终点。$/u, m => `Source ${m[1]} selected. Select a target.`],
    [/^松开绑定：(.+)$/u, m => `Release to attach: ${m[1]}`],
    [/^(.+)已在 (.+) 上。$/u, m => `${m[1]} is already attached to ${m[2]}.`],
    [/^已将 (.+) 绑定到 (.+)。右键证据名称可定义类型。$/u, m => `Attached ${m[1]} to ${m[2]}. Right-click the evidence label to set its type.`],
    [/^在 Figure 工作区定位 (.+)$/u, m => `Locate ${m[1]} in the Figure workspace`],
    [/^来源字段 (\d+)$/u, m => `${m[1]} source fields`],
    [/^未形成关系的候选节点（(\d+)）$/u, m => `Candidate nodes without relationships (${m[1]})`],
    [/^未解析或无关系的 Panel 证据（(\d+)）$/u, m => `Unresolved Panel evidence or evidence without relationships (${m[1]})`],
    [/^优先显示 (\d+) 个关系节点和 (\d+) 条候选关系；(\d+) 个未形成关系的节点保留在下方。$/u, m => `Showing ${m[1]} connected nodes and ${m[2]} candidate relationships first; ${m[3]} unconnected nodes remain below.`],
    [/^证据块合并历史（(\d+)）$/u, m => `Evidence block merge history (${m[1]})`],
    [/^跳转到 (.+)：(.+)$/u, m => `Go to ${m[1]}: ${m[2]}`],
    [/^此联系的证据类型：(.+)$/u, m => `Evidence types for this connection: ${m[1]}`],
    [/^(.+) 到 (.+)，(\d+ 条联系|暂无联系)$/u, m => `${m[1]} to ${m[2]}, ${ui(m[3])}`],
    [/^预览记录了 (\d+) 个 Panel；下表同时保留未解析和未形成关系的证据。$/u, m => `The preview records ${m[1]} Panels. The table also retains unresolved evidence and evidence without relationships.`],
    [/^预览引用了 (\d+) 个 Panel；缺少完整 Panel 处置清单，无法确认是否覆盖全部已读 Panel。$/u, m => `The preview references ${m[1]} Panels. A complete Panel disposition list is missing, so coverage of all read Panels cannot be confirmed.`],
    [/^共 (\d+) 个节点；当前没有候选关系边。$/u, m => `${m[1]} nodes; no candidate relationship edges.`],
    [/^已检查 (\d+)\/(\d+) 页(?:（(.+)）)?；当前始终显示 PDF 原页。$/u, m => `Checked ${m[1]}/${m[2]} pages${m[3] ? ` (${m[3].split('，').map(ui).join(', ')})` : ''}; the original PDF pages remain displayed.`],
    [/^浏览器正在准备本地翻译资源：(\d+)%（需要时下载）$/u, m => `Preparing local translation resources: ${m[1]}% (downloaded when needed)`],
    [/^确认覆盖原文件“([\s\S]+)”？此操作不可撤销。$/u, m => `Overwrite the original file “${m[1]}”? This cannot be undone.`],
    [/^(.+?)高亮：([\s\S]*)$/u, m => `${m[1]} highlight: ${m[2]}`],
    [/^(\d+) 项资源未保存$/u, m => `${m[1]} resources were not saved`],
    [/^已从本机恢复部分网页 · (.+)，请联网后重新保存 · 保存记录可在侧栏只读查看$/u, m => `Page partially restored locally · ${ui(m[1])}; reconnect and save again · Saved results are available read only in the sidebar`],
    [/^图片 (\d+)$/u, m => `Image ${m[1]}`],
    [/^图注 p\. (.+)$/u, m => `Caption p. ${m[1]}`],
    [/^自动候选 p\. (.+)$/u, m => `Automatic candidates p. ${m[1]}`],
    [/^(.+) 完整图像页码$/u, m => `${m[1]} complete image page numbers`],
    [/^(.+) 查看图像候选第 (\d+) 页$/u, m => `${m[1]}: view candidate image page ${m[2]}`],
    [/^正在查看物理第 (\d+) 页$/u, m => `Viewing physical page ${m[1]}`],
    [/^(.+)：已有人工页码暂不支持清空，请填写替代页码；本次未保存任何行。$/u, m => `${m[1]}: existing manual page numbers cannot be cleared. Enter replacements; no rows were saved.`],
    [/^没有可保存页码 · (\d+) 张未指定；原记录未改动。$/u, m => `No page numbers to save · ${m[1]} unspecified; existing records were unchanged.`],
    [/^正在保存 (\d+) 张 Figure…$/u, m => `Saving ${m[1]} Figures…`],
    [/^已收到回执 (\d+)\/(\d+)$/u, m => `Received ${m[1]}/${m[2]} save confirmations`],
    [/^(整表校验失败，未保存任何行|部分保存|已保存) · (\d+)\/(\d+) 张 · (\d+) 张未指定(?:；失败（草稿已保留）：([\s\S]+)|。)$/u, m => `${ui(m[1])} · ${m[2]}/${m[3]} Figures · ${m[4]} unspecified${m[5] ? `; failed (drafts preserved): ${m[5]}` : '.'}`],
    [/^(.*?) · 共 (\d+) 条阅读状态$/u, m => `${ui(m[1])} · ${m[2]} reading notices`],
    [/^(\d+) 条阅读状态$/u, m => `${m[1]} reading notices`],
    [/^(\d+)\/(\d+) 页$/u, m => `${m[1]}/${m[2]} pages`],
    [/^模型匹配分值 (.+) · 点击选择高亮类别$/u, m => `Model match score ${m[1]} · Click to choose a highlight category`],
    [/^语义查找失败：([\s\S]+)$/u, m => `Semantic search failed: ${ui(m[1])}`],
    [/^无需打开侧栏 · ([\s\S]+)$/u, m => `No sidebar required · ${ui(m[1])}`],
    [/^找到 (\d+) 条当前阈值以上结果。$/u, m => `Found ${m[1]} results above the current threshold.`],
    [/^新增内容补充检索失败；已有结果保留，可点击“搜索”重试。([\s\S]*)$/u, m => `Incremental search failed. Existing results are preserved; choose Search to retry. ${ui(m[1])}`],
    [/^当前分值 (\d+(?:\.\d+)?)$/u, m => `Current score ${m[1]}`],
    [/^累计已处理 (\d+) \/ (\d+)(?: · 部分覆盖(?:：([\s\S]*))?)?$/u, m => `Processed ${m[1]} / ${m[2]}${m[0].includes('部分覆盖') ? ` · Partial coverage${m[3] ? ': ' + ui(m[3]) : ''}` : ''}`],
    [/^保存失败：([\s\S]+)；草稿仍保留$/u, m => `Saving failed: ${ui(m[1])}; the draft is preserved`],
    [/^关系：(总问题|递进|并列|分支|汇合|验证)；上游：无$/u, m => `Relationship: ${ui(m[1])}; upstream: none`],
    [/^关系：(总问题|递进|并列|分支|汇合|验证)；上游：([\s\S]+)$/u, m => `Relationship: ${ui(m[1])}; upstream: ${m[2]}`],
    [/^支持 Figure：([\s\S]+)$/u, m => `Supporting Figures: ${m[1]}`],
    [/^论证作用：([\s\S]+)$/u, m => `Role in the argument: ${m[1]}`],
    [/^边界：([\s\S]+)$/u, m => `Boundaries: ${m[1]}`],
    [/^共同支持：([\s\S]+)$/u, m => `Jointly supports: ${m[1]}`],
    [/^(.+) 开始着手解决的问题$/u, m => `Question first addressed by ${m[1]}`],
    [/^(\d+) 组证据$/u, m => `${m[1]} evidence groups`],
    [/^(.+) · 本图证明$/u, m => `${m[1]} · What this figure demonstrates`],
    [/^回应：([\s\S]+)$/u, m => `Addresses: ${m[1]}`],
    [/^组级边界：([\s\S]+)$/u, m => `Group-level boundaries: ${m[1]}`],
    [/^问题 (\d+)$/u, m => `Question ${m[1]}`],
    [/^(.+) · 要解决的问题$/u, m => `${m[1]} · Question to address`],
    [/^证据组 (\d+)$/u, m => `Evidence group ${m[1]}`],
    [/^证据点 (\d+)$/u, m => `Evidence point ${m[1]}`],
    [/^结论 (\d+)$/u, m => `Conclusion ${m[1]}`],
    [/^连接 (\d+)$/u, m => `Connection ${m[1]}`],
    [/^载入失败：([\s\S]+)$/u, m => `Loading failed: ${ui(m[1])}`],
    [/^已从写入文件重新读取并逐页核验 (\d+) 条批注。$/u, m => `Reread the written file and verified ${m[1]} annotations page by page.`],
    [/^(.+) · (\d+) 页$/u, m => `${m[1]} · ${m[2]} pages`],
    [/^个人剩余 (\d+) 页$/u, m => `${m[1]} personal pages remaining`],
    [/^组织剩余 (\d+) 页$/u, m => `${m[1]} organization pages remaining`],
    [/^MinerU 官方额度：(.+)（结果可能延迟更新）$/u, m => `Official MinerU quota: ${m[1].split(' · ').map(ui).join(' · ')} (updates may be delayed)`],
    [/^MinerU 高优先级页额度估算：剩余 (\d+)\/(\d+) 页；今日本浏览器已解析 (\d+) 页（不含其他设备或直接 API 调用）$/u, m => `Estimated MinerU high-priority quota: ${m[1]}/${m[2]} pages remaining; ${m[3]} pages extracted in this browser today (excludes other devices and direct API calls)`],
    [/^已在本机提取 (\d+) 张完整 Figure；MinerU 碎片图不会进入正文。$/u, m => `Extracted ${m[1]} complete Figures locally; fragmented MinerU images are excluded from the article.`],
    [/^(.+) · 已等待 (\d+) 秒；页面可以保持在后台$/u, m => `${ui(m[1])} · Waiting ${m[2]} seconds; this page can stay in the background`],
    [/^MinerU VLM 正在精准解析(?: · (\d+)\/(\d+) 页)?；页面可以保持在后台$/u, m => `MinerU VLM precise extraction in progress${m[1] ? ` · ${m[1]}/${m[2]} pages` : ''}; this page can stay in the background`],
    [/^已为 (\d+) 页补充 OCR 文字层；文字与坐标来自 MinerU，基线位置为近似，请核对原页。$/u, m => `Added OCR text layers to ${m[1]} pages. Text and coordinates come from MinerU; baseline positions are approximate. Check the original pages.`],
    [/^(.+) · PDF 解析工作区$/u, m => `${m[1]} · PDF extraction workspace`],
    [/^已从本地论文工作区恢复正文、分层大纲与 (\d+) 张完整 Figure。$/u, m => `Restored article text, a hierarchical outline and ${m[1]} complete Figures from the local workspace.`],
    [/^已从论文工作区恢复 (\d+) 张完整 Figure。$/u, m => `Restored ${m[1]} complete Figures from the article workspace.`],
    [/^旧缓存已就地升级为 (\d+) 张完整 Figure；正文未重新解析。$/u, m => `Upgraded the existing cache to ${m[1]} complete Figures without extracting the article again.`],
    [/^已从父论文工作区恢复 (\d+) 张完整补充 Figure。$/u, m => `Restored ${m[1]} complete supplementary Figures from the parent article workspace.`],
    [/^PDF 解析失败：([\s\S]+)$/u, m => `PDF extraction failed: ${ui(m[1])}`],
    [/^原页读取未完成：([\s\S]+)。增强识别没有启动，请确认文件可打开后重试。$/u, m => `Original-page loading is incomplete: ${ui(m[1])}. Enhanced recognition did not start. Confirm the file opens and retry.`],
    [/^已选择 (.+)，正在读取 PDF 原页与文字索引…$/u, m => `Selected ${m[1]}. Loading original PDF pages and the text index…`],
    [/^已从 PDF 图注建立 (\d+) 张图的目录；解图前请核对包含完整图像的页码。$/u, m => `Created an index of ${m[1]} figures from PDF captions. Review the pages containing complete images before figure interpretation.`],
    [/^PDF 图注索引失败：([\s\S]+)$/u, m => `PDF caption indexing failed: ${ui(m[1])}`],
    [/^(\d+) 页无文字层$/u, m => `${m[1]} pages have no text layer`],
    [/^(\d+) 页文字提取失败$/u, m => `Text extraction failed on ${m[1]} pages`],
    [/^已检查 (\d+)\/(\d+) 页$/u, m => `Checked ${m[1]}/${m[2]} pages`]
  ];

  // Deliberately separate from the global UI dictionary. This projection is
  // used only when creating the built-in demonstration, never stored user maps.
  const demoEntries = Object.fromEntries(`科研逻辑图	Research logic map
感觉神经元调控皮肤老化	Sensory neurons regulate skin aging
皮肤老化伴随胶原流失和成纤维细胞功能下降。	Skin aging is accompanied by collagen loss and declining fibroblast function.
感觉神经元能够改变局部组织微环境。	Sensory neurons can alter the local tissue microenvironment.
感觉神经元是否通过谷氨酸信号驱动皮肤老化？	Do sensory neurons drive skin aging through glutamate signaling?
神经元—谷氨酸—成纤维细胞轴驱动胶原流失，阻断该轴可缓解皮肤老化。	A neuron–glutamate–fibroblast axis drives collagen loss; blocking it can alleviate skin aging.
感觉神经元激活	Sensory neuron activation
谷氨酸释放	Glutamate release
成纤维细胞衰老	Fibroblast senescence
受体拮抗	Receptor antagonism
结论主要来自小鼠模型，在人类皮肤中的因果性仍需验证。	The conclusions mainly come from mouse models; causality in human skin remains to be established.
老化皮肤中的谷氨酸能感觉神经元是否被激活？	Are glutamatergic sensory neurons activated in aging skin?
老化伴随谷氨酸能感觉神经元激活与谷氨酸释放。	Aging is accompanied by glutamatergic sensory neuron activation and glutamate release.
现象建立	Establishing the observation
相关证据	Correlational evidence
神经激活与组织表型	Neuronal activation and tissue phenotype
成像与组织学	Imaging and histology
神经激活与胶原下降同步出现。	Neuronal activation and collagen loss occur together.
Vglut2⁺神经活性升高，胶原含量下降。	Vglut2⁺ neuronal activity increases while collagen content decreases.
建立现象关联	Establishing an association
尚不能证明因果。	Causality has not yet been demonstrated.
谷氨酸是否直接诱导成纤维细胞衰老？	Does glutamate directly induce fibroblast senescence?
谷氨酸直接诱导成纤维细胞衰老。	Glutamate directly induces fibroblast senescence.
因果检验	Testing causality
强证据	Strong evidence
体外因果验证	In vitro causal validation
细胞处理	Cell treatment
谷氨酸足以触发衰老程序。	Glutamate is sufficient to trigger the senescence program.
p16/p21 上调并伴随增殖下降。	p16/p21 increase alongside reduced proliferation.
验证充分性	Testing sufficiency
因此下一图需要回答	The next figure therefore needs to address
独立样本复现主图结论并补充稳健性。	Independent samples reproduce the main-figure findings and support robustness.
独立重复	Independent replication
替代定量方法得到一致结果。	An alternative quantification method yields consistent results.
独立队列复现 p16/p21 上调。	An independent cohort reproduces increased p16/p21.
稳健性验证	Testing robustness`.split('\n').map(line => line.split('\t')));
  function localizeLogicMapDemo(value, language) {
    if (language !== 'en') return value;
    if (typeof value === 'string') return normalizedDemoEntries[value.normalize('NFKC')] || value;
    if (Array.isArray(value)) return value.map(item => localizeLogicMapDemo(item, language));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, localizeLogicMapDemo(item, language)]));
    return value;
  }
  const normalizedDemoEntries = Object.fromEntries(Object.entries(demoEntries).map(([key, value]) => [key.normalize('NFKC'), value]));
  return { entries, patterns, localizeLogicMapDemo };
});
