(function attach(root, factory) {
  if (root.SciLLM?.INTERFACE_I18N_REVISION === 'r37-en-2' && !(typeof module === 'object' && module.exports)) return;
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const EN = Object.freeze({
    '选择供应商并填写 API Key 即可接入，自动使用默认模型。具体模型与功能选项在下方表格设置。': 'Choose a provider and enter your API key to connect using its default model. Choose models and options for each feature in the table below.',
    '供应商': 'Provider',
    '已保存连接': 'Saved connections',
    '当前连接的默认模型': 'Default model for the selected connection',
    '当前连接': 'Selected connection',
    '默认连接': 'Default connection',
    '默认模型': 'Default model',
    '连接与模型': 'Connection and model',
    '思考': 'Thinking',
    '未开启': 'Off',
    '不支持': 'Unavailable',
    '默认模型与在线模型目录': 'Default model and model directory',
    '连接测试详情': 'Connection test details',
    '额外测试（可选）': 'Additional tests (optional)',
    '各功能默认沿用默认连接与模型；可分别选择具体模型，设置思考、推理强度、联网和 Token 规则。': 'Features inherit the default connection and model. Choose a model, thinking, reasoning effort, web search and token rules for each feature.',
    '保存功能设置': 'Save feature settings',
    '功能设置已保存。': 'Feature settings saved.',
    '请完成连接设置后重试。': 'Complete the connection settings and try again.',
    '保存失败，请检查连接设置。': 'Could not save. Check the connection settings.',
    '此功能或当前模型暂不支持联网。': 'Web search is not supported by this feature or model in this build.',
    '作为此功能的默认联网选项，可在问答中临时调整。': 'Default web search setting for this feature. You can change it for an individual conversation.',
    '保存文件夹': 'Save folder',
    '选择文献文件的保存位置；保存的正文、笔记和图片可用于离线阅读与备份。': 'Choose where to save article files. Saved text, notes and images are available for offline reading and backup.',
    '尚未写入': 'Not written yet',
    '未能完成文件夹设置，请检查文件夹读写权限后重试。': 'Folder setup could not finish. Check read/write access and try again.',
    '未能恢复文件夹访问权限，请重新选择目录并允许读写。': 'Folder access could not be restored. Select the folder again and allow read/write access.',
    '选择保存文件夹': 'Choose a save folder',
    '选择一次目录，之后点击侧栏“保存”即可写入文献文件，无需绑定本机路径或手动同步。': 'Choose a folder once, then click Save in the sidebar to write your article files. No path binding or manual sync is needed.',
    '文件保存在所选目录内的 Brevess 文件夹；已有 Brevess 或 SCI-Highlighter 数据目录会直接沿用。': 'Files are saved in a Brevess folder inside your selection. An existing Brevess or SCI-Highlighter data folder is used directly.',
    '高级设置 · 可选备份与目录维护': 'Advanced · Optional backup and folder maintenance',
    '恢复文件夹访问权限': 'Restore folder access',
    '可选：在文件管理器中打开文献目录': 'Optional: open article folders in File Explorer',
    '仅用于“打开文件夹”快捷按钮，不影响文献保存。需要此功能时，再填写 Brevess 或 SCI-Highlighter 数据目录的完整本机路径。': 'Only needed for the Open folder shortcut; article saving is unaffected. To enable the shortcut, enter the full local path of your Brevess or SCI-Highlighter data folder.',
    '模型配置备份（可选）': 'Model configuration backup (optional)',
    '需要换电脑恢复 API Key、模型设置、MinerU Token 和全局缩略词表时，可自行创建口令加密备份。不启用也能保存文献；遗忘口令无法恢复备份中的凭据。': 'Optionally create a passphrase-protected backup to restore API keys, model settings, the MinerU token and global abbreviations on another computer. Article saving does not require this backup. Lost passphrases cannot recover backed-up credentials.',
    '可选：备份 API Key 与模型配置，方便换电脑恢复。不影响文献保存。': 'Optional: back up API keys and model settings for another computer. Article saving is unaffected.',
    '模型配置备份已加密；需要恢复配置时再解锁。不影响文献保存。': 'The model backup is encrypted. Unlock it when you want to restore settings. Article saving is unaffected.',
    '文件夹已选好，但文件尚未写入完成。请检查目录权限后点击保存重试。': 'The folder is selected, but some files have not been written. Check folder access and click Save to retry.',
    '文件夹已就绪。之后点击侧栏“保存”，即可将文献文件写入此处，无需绑定路径或手动同步。': 'Your folder is ready. Click Save in the sidebar to write article files here. No path binding or manual sync is needed.',
    '待写入文件': 'Pending files',
    '上次写入': 'Last written',
    '重试写入文件': 'Retry file writes',
    '正在写入本地文件夹…': 'Writing to the local folder…',
    '文件已写入本地文件夹。': 'Files have been written to the local folder.',
    '文件尚未全部写入；内容仍保存在浏览器中，请重试保存。': 'Some files have not been written. Your content remains in the browser; retry saving.',
    '写入本地文件夹': 'Write to the local folder',
    '文件写入未完成，内容仍保存在浏览器中，请重试保存': 'Files have not been fully written. Your content remains in the browser; retry saving',
    '本次结果已保存在浏览器，但尚未完整写入所选文件夹。': 'Your work is saved in the browser but has not been fully written to the selected folder.',
    '网页工具': 'Page tools',
    '无需打开侧栏': 'No sidebar required',
    '开关会记住并应用于之后打开的网页': 'Remember these choices for pages opened later',
    '页面语义检索': 'Semantic search on this page',
    '划句弹窗 · 翻译与高亮': 'Selection popup · Translate and highlight',
    '整页翻译': 'Full-page translation',
    '含 Alt 段落翻译': 'Includes Alt paragraph translation',
    '打开检索': 'Open search',
    '翻译当前页': 'Translate this page',
    '正在读取工具设置…': 'Loading page tool settings…',
    '颜色按类别 · 斜纹为排除': 'Colors show categories · Hatching shows excluded items',
    '当前情境暂无分析结果': 'No analysis results for this reading context',
    '100分': '100 points',
    '存入本地词库': 'Save to local dictionary',
    '查词链接': 'Lookup sites',
    '单击缩写看含义并定位 · 双击行内 AI 补空白 · 长按缩写 1 秒查词（Alt+Enter）': 'Click to see meaning and locate text · Double-click a row to fill blanks with AI · Hold an abbreviation for 1 second to look it up (Alt+Enter)',
    '中文全称': 'Full name in Chinese',
    '含义': 'Meaning',
    '缩写释义': 'Abbreviation meaning',
    '返回缩写表': 'Back to abbreviations',
    '长按缩写 1 秒查词': 'Hold an abbreviation for 1 second to look it up',
    '选中一个默认网站，以英文全称查词。Wikipedia、Google、必应可直接填写主页；其他网站请用 {query} 代替搜索词。': 'Choose a default site to look up the full English name. Enter the homepage for Wikipedia, Google, or Bing; use {query} for the search term on other sites.',
    '＋ 添加网站': '+ Add site',
    '遇到适配问题、功能异常或有改进建议，可通过邮箱或 GitHub Issues 反馈。': 'Report compatibility issues, errors, or suggestions by email or GitHub Issues.',
    'GitHub Issues · 问题与建议': 'GitHub Issues · Problems and suggestions',
    '复制邮箱': 'Copy email address',
    '复制反馈邮箱': 'Copy feedback email address',
    '赞赏支持': 'Support development',
    '感谢你支持 BREVESS 的持续开发。': 'Thank you for supporting continued BREVESS development.',
    '微信赞赏': 'WeChat support',
    '使用微信扫描二维码': 'Scan the QR code with WeChat',
    '支付宝赞赏': 'Alipay support',
    '使用支付宝扫描二维码': 'Scan the QR code with Alipay',
    '在线原文': 'Original article online',
    '查看保存记录': 'View saved record',
    '查看本机保存的原图': 'View locally saved original image',
    '查看离线保存详情': 'View offline save details',
    '关闭原图': 'Close original image',
    '本机保存的原图': 'Locally saved original image',
    '核对 Figure 图像页': 'Check Figure image pages',
    '使用缩写释义与翻译模型，仅补齐空白中文全称': 'Use the abbreviation and translation model to fill only missing full names in Chinese',
    '使用缩写释义与翻译模型，仅补齐空白含义': 'Use the abbreviation and translation model to fill only missing meanings',
    '关闭缩写释义': 'Close abbreviation meaning',
    '关闭查词链接': 'Close lookup sites',
    '正在独立整理原文实验依据…': 'Extracting experimental evidence from the original article…',
    '正在核对笔记证据': 'Checking note evidence',
    '正在逐条回源核对本次生成的笔记…': 'Checking each generated note against the original evidence…',
    '正在回源核对本次生成的笔记…': 'Checking generated notes against the original evidence…',
    '笔记已生成，部分证据核对未完成；保留正文继续保存。': 'Notes generated; some evidence checks are incomplete. Keeping and saving the draft.',
    '本次生成的笔记已完成一次证据核对，正在保存…': 'One evidence review of the generated notes is complete. Saving…',
    '笔记已生成，证据核对未完成，正在保留正文…': 'Notes generated; evidence review is incomplete. Keeping the draft…',
    "原文翻译": "Full-text translation",
    "导航标题翻译": "Navigation heading translation",
    "课题工作台": "Research workbench",
    "假说梳理与组图规划": "Hypothesis mapping and figure planning",
    "假说梳理 · 组图规划": "Hypothesis mapping · Figure planning",
    "课题工作台：假说梳理与组图规划": "Research workbench: hypothesis mapping and figure planning",
    "隐藏已保存译文，不停止翻译": "Hide saved translations without stopping translation",
    "配置本地目录": "Configure local folder",
    "全屏打开": "Open full screen",
    "段原文": "source paragraph",
    "组标题": "heading group",
    "全局与通用": "Global and shared",
    "编辑预览": "Draft preview",
    "浏览器本地翻译": "Browser-local translation",
    "浏览器本地翻译（可用性在使用时检查）": "Browser-local translation (availability checked when used)",
    "专用配置已失效；请选择配置": "Dedicated profile unavailable; select a profile",
    "文本 JSON（普通提示）": "Text JSON (prompt)",
    "文本 JSON Schema（样例校验）": "Text JSON Schema (sample validation)",
    "图片与 JSON Schema": "Image and JSON Schema",
    "单项复测": "Retest this item",
    "以下是未保存的编辑预览；点击保存后生效。全局默认仅用于明确选择继承全局的任务。原文与导航翻译默认使用浏览器本地翻译，专用配置失效时不会转用其他模型。": "These are unsaved draft previews; save to apply. The global profile is used only by tasks set to inherit it. Full-text and navigation translations default to the browser-local translator; an unavailable dedicated profile will not switch to another model.",
    "JSON 解析失败": "JSON parsing failed",
    "JSON 内容不符合探针约定": "JSON does not match the probe contract",
    "响应未通过该探针校验": "Response did not pass this probe validation",
    '切换原网页与聚焦布局': 'Switch between the original page and focus layout',
    '本地翻译导航标题': 'Translate navigation headings locally',
    '预览 PPT 材料包': 'Preview PowerPoint materials',
    '自定义汇报要求': 'Customize presentation requirements',
    '语言': 'Language',
    '汇报时长（分钟）': 'Presentation duration (minutes)',
    '页数': 'Slide count',
    '汇报对象': 'Audience',
    '模板或版式要求': 'Template or layout requirements',
    '重点 Figure / Panel': 'Figures / Panels to emphasize',
    '生成逐页口播讲稿': 'Include a spoken script for each slide',
    '其他要求': 'Additional requirements',
    '按自定义要求更新下方提示词': 'Update the prompt below with these requirements',
    '给 Agent 的完整提示词 · 可直接编辑': 'Complete prompt for the Agent · Editable',
    '确认后，以下文本会原样保存到材料包。': 'After confirmation, the text below will be saved exactly as written in the materials package.',
    '包内文件': 'Package files',
    '确认并导出 ZIP': 'Confirm and export ZIP',
    '例如 Fig. 2、Fig. 4A–D': 'For example, Fig. 2 and Fig. 4A–D',
    '在此网页开启研读？': 'Start reading on this webpage?',
    '这个网址尚未识别为论文页面。开启后可在侧栏阅读、标注和做笔记。': 'This URL has not been recognized as an article page. Start reading to use the sidebar for reading, annotation, and notes.',
    '开启研读': 'Start reading',
    '论文网址': 'Article URLs',
    '文献网页白名单': 'Article webpage allowlist',
    '内置规则识别出版社与预印本的论文网址。未识别网页在点击侧栏时会询问是否开启；插件图标中的“开始研读”可直接开启。': 'Built-in rules recognize publisher and preprint article URLs. Opening the sidebar on an unrecognized page asks whether to start reading; “Start reading” in the extension menu enables it directly.',
    '自定义网址，每行一条': 'Custom URLs, one per line',
    '域名只匹配该域名；*.域名包含其子域名。完整网址匹配指定路径，末尾 * 可匹配路径下所有文章。删除一行即可移除规则。': 'A domain matches only that domain; *.domain includes its subdomains. A full URL matches the specified path; a trailing * matches all articles below it. Delete a line to remove its rule.',
    '保存网址白名单': 'Save URL allowlist',
    '接入配置流程': 'Connection setup steps',
    '1 · 保存配置': '1 · Save profile',
    '2 · 读取目录': '2 · Load model directory',
    '可手填模型 ID': 'Model IDs can be entered manually',
    '3 · 选择模型': '3 · Select a model',
    '待选择': 'Not selected',
    '4 · 验证能力': '4 · Verify capabilities',
    '尚未验证': 'Not verified',
    '选择 Provider 后会读取目录；内置候选、目录模型与手填 ID 分别标注，目录不代表能力验证。': 'Selecting a provider loads its directory. Built-in suggestions, directory models, and manually entered IDs have separate labels; directory inclusion does not verify capabilities.',
    '筛选模型候选': 'Filter model suggestions',
    '搜索目录或内置候选（不修改模型 ID）': 'Search the directory or built-in suggestions (keeps the model ID)',
    '本机 DeepSeek Harness': 'Local DeepSeek Harness',
    '复用官方桌面保存的登录，无需填写 API Key 或服务网址。请先安装官方 Harness 并在其桌面应用登录，再刷新状态。': 'Use the login saved by the official desktop app without entering an API key or service URL. Install the official Harness and sign in through its desktop app, then refresh the status.',
    '官方桌面登录状态': 'Official desktop login status',
    '尚未检查安装与保存登录': 'Installation and saved login have not been checked',
    '状态检测仅确认安装与保存登录；请点击“测试连接”验证模型实际可用性。': 'The status check confirms installation and saved login. Use “Test connection” to verify that the model is available.',
    '支持解图，': 'Supports figure analysis; ',
    '用于文本任务；推理强度按当前模型能力发送。': 'For text tasks; reasoning effort follows the capabilities of the selected model.',
    '选择额外测试项': 'Select additional tests',
    '基础文本始终测试；图片配置沿用自动图片与结构化检查。额外测试各自调用模型。': 'Basic text is always tested. Image profiles retain automatic image and structured-output checks. Each additional test calls the model separately.',
    '文本 JSON': 'Text JSON',
    '文本 JSON Schema': 'Text JSON Schema',
    '操作反馈': 'Action feedback',
    '本页能力验证结果': 'Capability verification results',
    '结果只对当前配置有效；修改配置需重新测试。未测试、跳过与不支持均不会计作通过。': 'Results apply only to the current profile; test again after editing it. Untested, skipped, and unsupported checks do not count as passes.',
    '复制反馈链接': 'Copy feedback link',
    '选区朗读': 'Read selected text',
    '朗读所选文字': 'Read the selected text aloud',
    '播放朗读': 'Play speech',
    '停止朗读': 'Stop reading',
    '在网页或 PDF 中选中文字后点击朗读。默认连接本机 Kokoro，无需 API Key。': 'Select text on a webpage or PDF and click Read aloud. The default is local Kokoro, which needs no API key.',
    '在网页或 PDF 中选中文字后点击朗读。默认使用浏览器内置朗读，无需 API Key 或部署模型。': 'Select text on a webpage or PDF and click Read aloud. Browser speech is the default; no API key or model setup is needed.',
    '浏览器内置（免费，无需密钥）': 'Browser speech (free, no key)',
    '使用浏览器和系统提供的音色，无需部署模型。自动选择优先匹配语种，缺少时使用系统可用音色；标为“联网”的音色可能需要网络。': 'Uses browser and system voices without model setup. Automatic selection prefers the matching language, then an available system voice. Voices marked online may need a network connection.',
    '自动选择系统音色': 'Choose a system voice automatically',
    '保存设置后可刷新浏览器音色。': 'Save settings to refresh browser voices.',
    '未发现浏览器音色。请检查系统语音设置后刷新音色，或选择已配置的朗读服务。': 'No browser voices were found. Check system speech settings and refresh, or choose a configured speech service.',
    '浏览器音色暂不可用；已保留当前设置，请检查系统语音设置后重试。': 'Browser voices are unavailable. Your settings are preserved; check system speech settings and retry.',
    '未找到对应语言的音色，正在使用浏览器可用音色。': 'No voice matches this language. Using an available browser voice.',
    '请填写 0.25–4 范围的语速。': 'Enter a speech speed from 0.25 to 4.',
    '朗读服务': 'Speech service',
    '本地 Kokoro': 'Local Kokoro',
    '在线兼容接口': 'Compatible online API',
    '语速': 'Speech speed',
    '1 为原速，范围 0.25–4。': '1 is normal speed. Range: 0.25–4.',
    '语音接口地址': 'Speech API endpoint',
    '语音模型': 'Speech model',
    '英文音色': 'English voice',
    '中文音色': 'Chinese voice',
    'API Key（可选）': 'API key (optional)',
    '清除已保存的 Key': 'Clear the saved key',
    '密钥只保存在本机，保存后不回显。': 'The key is stored locally and is not displayed after saving.',
    '已保存 Key；留空则保留，填写新 Key 可替换。': 'A key is saved. Leave blank to keep it, or enter a new key to replace it.',
    '本地模式只连接本机回环地址；请先启动 Kokoro。': 'Local mode connects only to this device. Start Kokoro first.',
    '只向你保存的 HTTPS 语音接口发送所选文字；在线服务可能收费。': 'Selected text is sent only to your saved HTTPS speech endpoint. Online services may charge fees.',
    '选中文字后自动朗读（默认关闭）': 'Read aloud automatically after selection (off by default)',
    '音色可选择或手动填写。含中文的选区使用中文音色；中英混排及专业缩写的读音以服务支持为准。': 'Choose a voice or enter its ID. Selections containing Chinese use the Chinese voice. Pronunciation of mixed languages and technical abbreviations depends on the service.',
    '保存朗读设置': 'Save speech settings',
    '刷新音色': 'Refresh voices',
    '试听英文': 'Preview English',
    '试听中文': 'Preview Chinese',
    '点击播放': 'Click to play',
    '请填写模型、中英文音色及 0.25–4 范围的语速。': 'Enter a model, English and Chinese voices, and a speed from 0.25 to 4.',
    '朗读设置已保存。': 'Speech settings saved.',
    '已保存提交时的设置；新修改尚未保存。': 'Submitted settings saved. Your newer changes are not saved yet.',
    '朗读已停止。': 'Reading stopped.',
    '正在合成语音…': 'Generating speech…',
    '正在朗读…': 'Reading aloud…',
    '浏览器需要再次点击才能播放。': 'The browser requires another click to play audio.',
    '朗读失败，请确认服务已启动并检查设置。': 'Reading failed. Check that the service is running and review its settings.',
    '请选择 1–5000 个字符后朗读。': 'Select 1–5,000 characters to read aloud.',
    '朗读服务超时，请缩短文字或检查服务。': 'The speech service timed out. Shorten the text or check the service.',
    '服务未返回有效音频，请检查语音接口地址。': 'The service did not return valid audio. Check the speech endpoint.',
    '朗读设置已修改，保存后可刷新音色或试听。': 'Speech settings changed. Save them before refreshing voices or previewing speech.',
    '请先保存朗读设置。': 'Save speech settings first.',
    '正在获取音色…': 'Loading voices…',
    '音色获取失败；请检查服务，或手动填写音色 ID。': 'Could not load voices. Check the service or enter a voice ID manually.',
    "本地传输方式": "Local transport",
    "自动兼容（优先 JSON）": "Automatic (prefer JSON)",
    "JSON（避免音频下载接管）": "JSON (avoid intercepted audio downloads)",
    "标准音频（兼容旧服务）": "Standard audio (older services)",
    "自动模式探测本机 Kokoro 的 JSON 支持；旧服务沿用标准音频，可能被下载工具接管。": "Automatic mode checks local Kokoro for JSON support. Older services use standard audio, which download managers may intercept.",
    "此服务不支持 JSON 朗读模式；可在朗读设置中选择自动兼容或标准音频。": "This service does not support JSON speech. Choose automatic or standard audio in speech settings.",
    "自定义英文音色 ID": "Custom English voice ID",
    "自定义中文音色 ID": "Custom Chinese voice ID",
    "手动输入音色 ID": "Enter a voice ID",
    "（当前设置）": "(current setting)",
    "请选择音色": "Choose a voice",
    "正在准备音色列表…": "Preparing voice list…",
    "保存服务配置后可加载音色列表。": "Save the service configuration to load voices.",
    "音色获取失败；已保留当前音色，可重试或手动填写。": "Could not load voices. Your current voice is preserved; retry or enter an ID.",
    "保存服务配置后可加载音色；也可手动填写。": "Save the service configuration to load voices, or enter an ID.",
    "正在准备标注位置，备注已保留…": "Preparing the annotation position. Your note is preserved…",
    "分组依据与实验差别": "Grouping rationale and experimental differences",
    "分组依据已对应原文；实验含义仍需结合原图核对。": "Grouping sources match the article. Check the experimental interpretation against the figure.",
    "分组依据尚不充分，请结合原图核对实验差别。": "Grouping evidence is incomplete. Check experimental differences against the figure.",
    "PDF 图注未提供稳定的 Panel 标签；以下为整图证据概览，未臆造 Panel 编号。": "The PDF caption has no stable panel labels. This overview covers the whole figure without inventing panel IDs.",
    '朗读未完成，请检查设置中的朗读服务。': 'Reading did not complete. Check the speech service in Settings.',
    '标注索引准备中；可先翻译或朗读，就绪后重新选区可添加备注。': 'The annotation index is loading. You can translate or listen now; select the text again once ready to add notes.',
    '正在本地翻译此段': 'Translating this paragraph locally',
    '页面正文已变化或标注尚未就绪，请重新选择文字': 'The page text changed or annotations are not ready. Select the text again.',
    '重试翻译': 'Retry translation',
    '请先保存完整的朗读服务配置。': 'Save a complete speech service configuration first.',
    '朗读地址须为本机回环地址，或已配置的 HTTPS 在线语音接口。': 'Use a local loopback address or a configured HTTPS speech endpoint.',
    '请填写有效的中文或英文音色 ID。': 'Enter a valid Chinese or English voice ID.',
    '朗读模型或密钥格式无效。': 'The speech model or API key format is invalid.',
    '朗读服务超时，请检查服务后重试。': 'The speech service timed out. Check it and try again.',
    '无法连接朗读服务，请确认服务已启动及地址可访问。': 'Cannot connect to the speech service. Check that it is running and its address is reachable.',
    '朗读服务拒绝了请求，请检查设置。': 'The speech service rejected the request. Check the settings.',
    '朗读服务发生跳转，已停止请求。请填写最终接口地址。': 'The speech service redirected the request, so it was stopped. Enter the final endpoint address.',
    '朗读服务未返回支持的音频。': 'The speech service did not return supported audio.',
    '朗读响应为空或超过大小限制，请缩短选区。': 'The speech response is empty or too large. Select less text.',
    '服务未返回音色列表；可以手动填写音色 ID。': 'The service did not return a voice list. You can enter a voice ID manually.',
    'Panel 目录待核：当前未取得可信的完整图注目录，已保留现有解读。请刷新原文后核对。': 'Panel inventory needs review: a verified complete caption inventory is unavailable. Existing analysis has been retained. Refresh the source article to check it.',
    'Panel 覆盖待核：返回的标签存在重复或与原图目录不一致。': 'Panel coverage needs review: returned labels are duplicated or do not match the source Figure inventory.',
    // R21 selection tools, visual chat inputs, source feedback and page export.
    '选区阅读工具': 'Selection reading tools',
    '切换手动高亮类别的阅读情境': 'Switch the reading context for manual highlight categories',
    '选区工具模式': 'Selection tool mode',
    '本地翻译': 'Local translation',
    '手写备注': 'Manual note',
    'AI 解读': 'AI explanation',
    '规则与缩略词': 'Rules and abbreviations',
    '关闭选区工具': 'Close selection tools',
    '仅翻译所选文字，论文文本在本机处理。': 'Translate only the selected text. Article text is processed on this device.',
    '开启本地翻译': 'Start local translation',
    '首次使用或资源缺失时，浏览器可能需要下载翻译资源。': 'The browser may need to download translation resources on first use or when resources are missing.',
    '页面正文已变化，请重新选择文字': 'The page text has changed. Select the text again.',
    '当前浏览器的本地翻译接口不可用，未启用云端翻译。': 'Local translation is unavailable in this browser. Cloud translation has not been enabled.',
    '正在准备本地翻译…': 'Preparing local translation…',
    '重新翻译': 'Translate again',
    '请点击“开启本地翻译”确认使用浏览器本地模型。': 'Click “Start local translation” to confirm use of the browser’s local model.',
    '写下判断、疑问或后续线索': 'Write an observation, question or follow-up idea',
    '备注随所选原文保存；未选颜色时使用当前情境第一个类别。': 'The note is saved with the selected original text. If no color is selected, the first category in the current context is used.',
    '保存': 'Save',
    '当前情境没有可用高亮类别，请先选择其他情境。': 'This context has no available highlight categories. Select another context first.',
    'AI 划词动作': 'AI selection action',
    '当前提示词': 'Current prompt',
    '本次临时提示词': 'Temporary prompt for this request',
    '允许联网检索': 'Allow web search',
    '仅用于本次请求。默认提示词请在设置中修改。': 'Used only for this request. Change the default prompt in Settings.',
    '点击 AI 解读所选文字。': 'Click AI to explain the selected text.',
    '执行 AI 解读': 'Run AI explanation',
    '已取消': 'Cancelled',
    '请先在插件设置中配置划词动作模型。': 'Configure a model for selection actions in the extension settings first.',
    '请输入本次提示词。': 'Enter a prompt for this request.',
    '正在解读…': 'Generating explanation…',
    '选区解读未完成，请重试。': 'The selection explanation did not complete. Please retry.',
    '模型未返回可显示的结果。': 'The model returned no displayable result.',
    '联网来源：': 'Web sources:',
    '加入高亮规则': 'Add to highlight rules',
    '选择要填入固定短语的高亮规则': 'Select the highlight rule to receive this exact phrase',
    '加入白名单': 'Add to allowlist',
    '加入黑名单': 'Add to blocklist',
    '重新绑定此标注': 'Reattach this annotation',
    '返回结构不完整': 'The response structure is incomplete',
    '标题长度不符合要求': 'The title length does not meet the requirements',
    '图号与请求不一致': 'The Figure identifier does not match the request',
    'Panel 标签不符合图注': 'Panel labels do not match the caption',
    'Panel 内容为空': 'Panel content is empty',
    '整图概述为空': 'The Figure overview is empty',
    '证据分组数量不符合要求': 'The number of evidence groups does not meet the requirements',
    '证据分组为空': 'An evidence group is empty',
    '证据分组包含未知 Panel': 'An evidence group contains an unknown Panel',
    'Panel 存在重复分组': 'A Panel appears in multiple evidence groups',
    '证据分组遗漏 Panel': 'Evidence groups omit a Panel',
    '返回内容未通过校验，已保留此前有效结果。': 'The response failed validation. Previously valid results were retained.',
    '回答中的示意图': 'Diagram in the answer',
    '回答中的表格': 'Table in the answer',
    '图形源码': 'Diagram source',
    '示意图暂无法渲染，已保留原始代码。': 'The diagram could not be rendered. Its original code was retained.',
    '附件无法恢复，请重新添加后再生成': 'Attachments could not be restored. Add them again before regenerating.',
    '添加附件': 'Add attachments',
    '本轮附件': 'Attachments for this turn',
    '添加图片、文本或可读 PDF；也可拖放或粘贴图片，最多 4 个': 'Add images, text or PDFs with readable text; you can also drop or paste images. Up to 4 attachments.',
    '附件': 'Attachments',
    '视觉输入状态': 'Visual input status',
    '按需联网 · 已检索': 'Automatic web search · Searched',
    '按需联网 · 待判断': 'Automatic web search · Decision pending',
    '按需联网 · 未检索': 'Automatic web search · No search performed',
    '当前模型不支持视觉，未读取图片，仅参考文字': 'This model does not support vision. Images were not read; only text was used.',
    '未读取所询问的图片，仅参考可用文字': 'The requested image was not read; only available text was used.',
    '仅部分图片已传入模型': 'Only some images were sent to the model',
    '附件仅支持 PNG、JPEG、WebP、TXT、Markdown、CSV、JSON 和可读 PDF。': 'Attachments support PNG, JPEG, WebP, TXT, Markdown, CSV, JSON and PDFs with readable text.',
    'PDF 页数超过 1000 页，请缩小文件范围。': 'The PDF exceeds 1,000 pages. Use a smaller page range.',
    'PDF 文本超过 60000 字符，请拆分后添加。': 'The PDF text exceeds 60,000 characters. Split it before adding it.',
    'PDF 没有可读文字，扫描件暂不支持；请先提取文本。': 'The PDF has no readable text. Scanned PDFs are not supported; extract the text first.',
    '可能已加密或没有可读文字': 'It may be encrypted or contain no readable text',
    '正在读取附件，请稍候。': 'Reading attachments. Please wait.',
    '附件仍在读取，请稍候再发送。': 'Attachments are still being read. Wait before sending.',
    '每轮最多添加 4 个附件。': 'Add up to 4 attachments per turn.',
    '联网关闭': 'Web search off',
    '联网开启': 'Web search on',
    '按需联网': 'Automatic web search',
    '正在保存原网页排版、样式和图片并连接 Zotero…': 'Saving the original page layout, styles and images, and connecting to Zotero…',
    '当前文库': 'Current library',
    'Zotero 当前不可用': 'Zotero is currently unavailable',
    '原网页快照 ZIP': 'Original-page snapshot ZIP',
    '长按拖动调整补充图位置': 'Press and hold, then drag to reorder the supplemental Figure',
    'Alt+↑ 上移，Alt+↓ 下移': 'Alt+↑ to move up, Alt+↓ to move down',
    '长按拖动调整补充图位置；Alt+↑ 上移，Alt+↓ 下移': 'Press and hold, then drag to reorder the supplemental Figure; Alt+↑ to move up, Alt+↓ to move down',
    '请先完成当前 Figure 编辑': 'Finish editing the current Figure first',
    'Ctrl 点击多选，Shift 点击选择连续范围；直接点击展开或收起': 'Ctrl-click to select multiple Figures; Shift-click to select a range; click to expand or collapse',
    '已选中；Ctrl 点击多选，Shift 点击选择连续范围；直接点击展开或收起': 'Selected; Ctrl-click to select multiple Figures; Shift-click to select a range; click to expand or collapse',
    '本轮回答已复制': 'Copied this answer',
    '复制回答': 'Copy answer',
    '无法写入剪贴板，请重试或手动复制。': 'Could not write to the clipboard. Retry or copy manually.',
    '依次解读全部 Figure': 'Analyze all Figures in order',
    '正在生成图表梳理': 'Generating figure synthesis',
    '正在读取 Figure': 'Reading Figure',
    '字段来源（未定位到具体段落）': 'Field sources (not assigned to individual paragraphs)',
    '开启本地英中双语阅读': 'Enable local English–Chinese bilingual reading',
    '开启本地英中双语阅读；悬停段落按 Alt 单独切换': 'Enable local English–Chinese bilingual reading; hover over a paragraph and press Alt to toggle it individually',
    '当前为单段翻译；点击开启全页。悬停段落按 Alt 切换译文': 'Paragraph translation is active; click to translate the whole page. Hover over a paragraph and press Alt to toggle its translation',
    '关闭本地英中双语阅读，保留原文': 'Turn off bilingual reading and keep the original',
    '本地双语阅读本批仅支持 HTML 网页，不支持 PDF': 'Local bilingual reading supports HTML pages only; PDF is not supported',
    '本地英中双语阅读不可用；仅支持具备 Translator API 的 HTML 网页': 'Local bilingual reading is unavailable; an HTML page with the official Translator API is required',
    '本地翻译失败；点击关闭后重试，未调用云端服务': 'Local translation failed. Turn it off and retry; no cloud service was used',
    '请在原网页确认开启本地翻译；点击此按钮可取消': 'Confirm local translation on the original page; click this button to cancel',
    '正在准备本地双语阅读；点击可取消': 'Preparing local bilingual reading; click to cancel',
    '无法连接当前网页的本地翻译。请刷新网页后重试；未调用云端服务。': 'Could not connect to local translation on this page. Reload the page and retry; no cloud service was used.',
    '当前页面环境没有可用的官方 Translator 接口。请检查浏览器支持与策略；未调用云端服务。': 'The official Translator API is unavailable in this page context. Check browser support and policies; no cloud service was used.',
    '浏览器的英译中（en → zh）语言组合当前不可用。请检查模型、设备条件或浏览器策略；未调用云端服务。': 'English to Chinese (en → zh) is currently unavailable. Check the model, device requirements and browser policies; no cloud service was used.',
    '请在原网页点击确认按钮后启动本地翻译。': 'Click the confirmation button on the original page to start local translation.',
    '本地英译中模型下载或初始化失败。请检查网络、可用磁盘空间及浏览器状态，关闭后重试；未调用云端服务。': 'Local English-to-Chinese model download or initialization failed. Check the network, free disk space and browser, then turn it off and retry; no cloud service was used.',
    '当前段落的本地翻译失败，其他有效译文仍保留；可关闭后重试，未调用云端服务。': 'Local translation failed for this paragraph. Other valid translations were retained; turn it off and retry. No cloud service was used.',
    '本地模型返回空译文，原文保持不变；可关闭后重试。': 'The local model returned an empty translation. The original is unchanged; turn it off and retry.',
    '本地模型返回的译文异常，已保留原文；其他有效译文不受影响。': 'The local model returned a damaged translation. The original and other valid translations were retained.',
    '本段译文异常，已保留原文。': 'This translation was damaged. The original was retained.',
    '本段未返回译文，已保留原文。': 'No translation was returned for this paragraph. The original was retained.',
    '本段翻译失败，已保留原文。': 'Translation failed for this paragraph. The original was retained.',
    '本地翻译会话尚未初始化，请关闭后重新开启。': 'The local translation session is not initialized. Turn it off and on again.',
    '本地翻译已取消。': 'Local translation was cancelled.',
    '本地翻译失败；未调用云端服务。请关闭后重试。': 'Local translation failed; no cloud service was used. Turn it off and retry.',
    '图表梳理': 'Figure synthesis',
    '图表梳理工具': 'Figure synthesis tools',
    '导出或导入图表梳理': 'Export or import figure synthesis',
    '图表梳理区内跳转': 'Navigate figure synthesis',
    '手动绘制': 'Draw manually',
    '编辑修改': 'Edit',
    'AI生成': 'Generate with AI',
    '重新生成': 'Regenerate',
    // Contextual note-format icons retain localized accessible names.
    '笔记格式工具': 'Note formatting',
    '加粗选中文字': 'Bold selected text',
    '设置无序列表': 'Bulleted list',
    '设置有序列表': 'Numbered list',
    '增加列表缩进': 'Increase list indent',
    '减少列表缩进': 'Decrease list indent',
    '设置选中文字颜色': 'Text color',
    '切换笔记编辑或预览': 'Toggle note edit or preview',
    '笔记预览': 'Note preview',
    '编辑笔记': 'Edit note',
    '预览笔记': 'Preview note',
    '查看 Markdown 源码': 'View Markdown source',
    '查看渲染后的笔记': 'View rendered notes',
    '正在组合输入，请完成输入后再切换预览。': 'Finish composing text before switching the note view.',
    '黑色': 'Black', '红色': 'Red', '橙色': 'Orange',
    '绿色': 'Green', '蓝色': 'Blue', '紫色': 'Purple',
    // NOTE-007 copy/export and LIB-010 native directory controls and results.
    '复制笔记': 'Copy notes',
    '导出 Markdown': 'Export Markdown',
    '笔记复制与导出': 'Copy and export notes',
    '已复制当前模板笔记，来源状态一并保留。': 'Copied the current template notes with their source status.',
    '已复制当前模板笔记,来源状态一并保留。': 'Copied the current template notes with their source status.',
    '已生成 Markdown 文件；颜色使用笔记的受控标记。': 'Markdown file created; colors use the note format markers.',
    '已生成 Markdown 文件;颜色使用笔记的受控标记。': 'Markdown file created; colors use the note format markers.',
    '笔记模板不可用': 'The note template is unavailable',
    '笔记格式无法安全转换，原文已保留': 'The note format could not be converted safely; the original text was preserved',
    '笔记格式无法安全转换,原文已保留': 'The note format could not be converted safely; the original text was preserved',
    '在文件管理器中打开文献目录': 'Open article folders in File Explorer',
    '首次使用需显式绑定本机路径。填写所选保存位置内实际数据根（Brevess 或兼容的 SCI-Highlighter 文件夹）的完整绝对路径，不是论文子目录，也不一定是上方选择的外层文件夹。浏览器只提供目录名，无法替你推算路径。': 'Before first use, explicitly bind a local path. Enter the full absolute path of the actual data root inside your selected storage location (the Brevess or legacy SCI-Highlighter folder). This is not an article subfolder and may differ from the parent folder selected above. The browser provides only a folder name and cannot determine this path for you.',
    '实际数据根绝对路径': 'Absolute path of the actual data root',
    '例如 D:\\论文资料\\Brevess': 'For example: D:\\Papers\\Brevess',
    '绑定本机目录路径': 'Bind local folder path',
    '检查助手与绑定状态': 'Check helper and binding status',
    '尚未检查。绑定只核验现有目录，不会选择新的保存位置或创建文献文件夹。': 'Not checked yet. Binding only verifies an existing folder; it does not select a new storage location or create article folders.',
    '需要支持目录打开功能的本机助手；旧版请随插件一起更新。此处不会自动安装助手。': 'A local helper that supports folder opening is required. Update older helpers along with the extension. This page does not install the helper automatically.',
    '查看本机助手安装说明': 'View local helper installation instructions',
    '目录与本机助手设置': 'Folder and local helper settings',
    '打开文件夹': 'Open folder',
    '正在打开…': 'Opening…',
    '通过本机助手打开已同步且归属验证通过的文献目录': 'Use the local helper to open a synced article folder with verified identity',
    '其他目录操作正在进行，请完成后再试。': 'Another folder operation is in progress. Finish it before trying again.',
    '请填写实际数据根的完整绝对路径。目录名不能代替本机路径。': 'Enter the full absolute path of the actual data root. A folder name is not a local path.',
    '正在核验并绑定本机目录…': 'Verifying and binding the local folder…',
    '正在检查本机助手与目录绑定…': 'Checking the local helper and folder binding…',
    '未收到有效的绑定确认，请先检查状态。': 'No valid binding confirmation was received. Check the status first.',
    '未收到有效的助手状态，请确认本机助手版本。': 'No valid helper status was received. Check the local helper version.',
    '本机助手可用，当前数据根尚未绑定。请填写绝对路径后点击绑定。': 'Local helper available. The current data root is not bound yet. Enter its absolute path and click Bind.',
    '本机助手不可用，请确认已安装支持目录打开功能的版本；旧版需更新。': 'Local helper unavailable. Make sure a version with folder-opening support is installed; older versions need an update.',
    '未能确认操作结果，请检查本机助手与目录设置。': 'The operation result could not be confirmed. Check the local helper and folder settings.',
    '未能确认目录打开结果，请检查本机助手和目录设置。': 'The folder-open result could not be confirmed. Check the local helper and folder settings.',
    '未收到有效的系统打开确认，请先查看文件管理器，避免重复打开。': 'No valid system-open confirmation was received. Check your file manager first to avoid opening the folder twice.',
    '目录打开未确认，请先查看文件管理器。': 'Folder opening is not confirmed. Check your file manager first.',
    '请先在“本地保存”中选择保存目录并完成同步。': 'Choose a storage folder under Local storage and finish syncing first.',
    '保存目录尚未授权，请在“本地保存”中重新授权后重试。': 'Storage-folder access is not authorized. Grant access again under Local storage, then retry.',
    '保存根目录已不存在，请核对目录位置并重新绑定。': 'The storage root no longer exists. Check its location and bind it again.',
    '尚未绑定本机目录路径，请在“本地保存”中绑定实际的 Brevess 数据目录。': 'No local folder path is bound. Bind the actual Brevess data folder under Local storage.',
    '目录绑定记录无效，请核对当前目录；原记录已保留。': 'The folder binding record is invalid. Check the current folder; the original record was preserved.',
    '操作期间保存目录已切换，请核对当前目录后重新操作。': 'The storage folder changed during the operation. Check the current folder and try again.',
    '这篇文献的目录尚未同步完成，请先完成保存与目录同步。': 'This article folder has not finished syncing. Finish saving and syncing it first.',
    '目录中的文献归属或版本与当前工作区不一致，请先核对保存和同步状态。': 'The folder belongs to a different article or workspace version. Check the save and sync status first.',
    '目录路径无效，请填写实际 Brevess 数据根目录的完整本地路径。': 'The folder path is invalid. Enter the full local path of the actual Brevess data root.',
    '文献目录清单无效，已保留原文件，请检查目录和同步状态。': 'The article folder manifest is invalid. The original file was preserved; check the folder and sync status.',
    '当前环境无法生成目录绑定证明，请更新浏览器后重试。': 'This environment cannot create folder binding proof. Update the browser and retry.',
    '无法读取保存目录，请检查目录权限、文件占用和同步状态。': 'The storage folder could not be read. Check its permissions, file locks, and sync status.',
    '当前系统的本机助手暂不支持打开文献目录。': 'The local helper on this system does not support opening article folders.',
    '本机目录请求无效，请刷新设置页面后重试。': 'The local folder request is invalid. Refresh the settings page and retry.',
    '请输入实际 Brevess 数据根目录的完整本地路径。': 'Enter the full local path of the actual Brevess data root.',
    '本机助手尚未绑定当前保存目录，请先完成目录路径绑定。': 'The local helper is not bound to the current storage folder. Bind the folder path first.',
    '本机绑定与当前保存目录不一致，请核对实际路径并重新绑定。': 'The local binding does not match the current storage folder. Check the actual path and bind it again.',
    '填写的路径与当前授权保存目录不匹配，请填写包含 Brevess 的实际数据根目录路径。': 'The entered path does not match the authorized storage folder. Enter the actual data-root path containing Brevess.',
    '目录绑定证明已过期，请重新点击绑定。': 'The folder binding proof has expired. Click Bind again.',
    '本机助手的目录绑定配置无效，原配置已保留，请检查本机助手。': 'The local helper folder-binding configuration is invalid. The original configuration was preserved; check the helper.',
    '本机助手未能确认保存绑定配置，请检查权限并重新检查绑定状态。': 'The local helper could not confirm that the binding configuration was saved. Check permissions and the binding status again.',
    '这篇文献的本地目录不存在，请先完成保存与同步。': "This article's local folder does not exist. Save and sync it first.",
    '文献目录已超出绑定范围，未发送打开请求，请核对目录及链接。': 'The article folder is outside the bound location. No open request was sent; check the folder and links.',
    '本机助手未能启动文件管理器，请检查系统后重试。': 'The local helper could not start the file manager. Check the system and retry.',
    '本机助手未连接，请先安装或启用现有 Brevess 本机助手。': 'The local helper is not connected. Install or enable the Brevess local helper first.',
    '当前本机助手不支持打开文献目录，请更新本机助手后重试。': 'This local helper does not support opening article folders. Update it and retry.',
    '本机助手未返回确认，尚不能确认目录是否已打开；请先查看文件管理器再重试。': 'The local helper did not confirm the request, so folder opening is still unconfirmed. Check your file manager before retrying.',
    '未收到有效的本机目录操作确认，请检查本机助手版本及状态。': 'No valid local folder operation confirmation was received. Check the helper version and status.',
    '请从本扩展设置页执行目录绑定或打开操作。': 'Bind or open folders from this extension settings page.',
    '另一项目录操作正在进行，请等待结果后再操作。': 'Another folder operation is in progress. Wait for its result before continuing.',
    '高亮设置与应用': 'Highlight settings and apply',
    '笔记': 'Notes',
    '图解': 'Figures',
    '打开摘句的高亮设置': 'Open excerpt highlight settings',
    '按需开启更多能力': 'Enable optional features',
    '可直接阅读': 'Ready to read',
    'AI 已就绪': 'AI ready',
    '配置已保存；AI 尚未启用，请补充模型凭据并确认正文发送许可。': 'Settings saved. AI is not enabled yet; add model credentials and confirm content-sharing consent.',
    'AI · 按需启用': 'AI · Optional',
    '阅读就绪状态': 'Reading readiness',
    '启用 AI 时确认': 'Confirm when enabling AI',
    '选择目录后可启用加密备份；当前数据仍保存在浏览器本地。': 'Choose a folder to enable encrypted backup. Your data is still saved locally in the browser.',
    '没有匹配的已保存文献。试试其他关键词或搜索范围。': 'No matching saved articles. Try other keywords or search scopes.',
    '尚未保存文献。打开论文并开始研读后，会自动出现在这里。': 'No saved articles yet. Open an article and start reading to add it here automatically.',
    '本节段落': 'Section paragraphs',
    'PDF 文献': 'PDF article',
    '网页文献': 'Web article',
    '目录来自当前文献，不调用 LLM；需要时再逐图解读或提问。': 'The directory comes from this article without an LLM call. Interpret a figure or ask questions when needed.',
    '围绕当前文献连续提问；输入 @ 选择章节，输入 / 使用快捷提示词。': 'Ask questions about this article. Type @ to select sections or / for prompt shortcuts.',
    '本地文献与缩略词库': 'Local articles and abbreviation library',
    '字段名称': 'Field name',
    'AI 提示词': 'AI prompt',
    '显示与输入选项': 'Display and input options',
    '占位提示': 'Placeholder',
    '必填字段': 'Required field',
    '删除字段': 'Delete field',
    '删除模板': 'Delete template',
    '模板字段': 'Template fields',
    '新增字段': 'Add field',
    '新字段': 'New field',
    '每个模板至少保留一个字段': 'Keep at least one field per template',
    '字段名称用于笔记展示；AI 提示词说明仅应从文章证据中提取哪些内容。': 'Field names appear in notes. AI prompts specify what to extract from article evidence.',
    '为基础研究、临床研究、综述、病例、方法学和指南配置不同模板。每个字段都可设置名称和 AI 提示词，无需填写内部 ID。': 'Configure templates for different article types. Give each field a name and an AI prompt; internal IDs are managed automatically.',
    'Brevess 设置': 'Brevess settings',
    '设置中心': 'Settings',
    '开始使用': 'Get started',
    '设置概览': 'Setup overview',
    '本地保存': 'Local storage',
    '可选': 'Optional',
    '已连接': 'Connected',
    '模型与连接': 'Models & connections',
    '待配置': 'Not configured',
    '阅读与分析': 'Reading & analysis',
    '分析方式': 'Analysis behavior',
    '阅读场景': 'Reading scenarios',
    '阅读情境': 'Reading scenario',
    '编辑情境与类别': 'Edit scenarios and categories',
    '证据匹配阈值': 'Evidence match threshold',
    '按本地证据匹配分数筛选；分数不代表实测准确率。': 'Filter by the local evidence-match score; the score is not a measured accuracy rate.',
    '情境中的类别': 'Categories in this scenario',
    '逐项选择、查看或编辑规则；新增类别需点击分析，切换情境本身不会调用模型。': 'Select each category and view or edit its rules. New categories require Analyze; switching scenarios itself does not call the model.',
    '高亮类别': 'Highlight categories',
    'PDF 与阅读工具': 'PDF & reading tools',
    '系统': 'System',
    '数据与备份': 'Data & backup',
    '设置页面': 'Settings page',
    '个性化设置': 'Personalize settings',
    '完成当前配置': 'Finish setup',
    '重新检查设置': 'Check settings again',
    '先确认关键能力，再按需要细调': 'Confirm the essentials, then fine-tune as needed',
    '这里是长期保留的设置首页。新手检查清单与日常设置共用同一份真实配置，不会再出现两套页面。': 'This is the permanent settings home. The setup checklist and everyday settings use the same configuration.',
    '确认阅读、保存与模型状态': 'Check reading, storage, and model status',
    '基础阅读可直接使用；本地目录与 AI 模型按你的工作方式选配。': 'Basic reading is ready. Add a local folder or AI model only when your workflow needs one.',
    '基础阅读': 'Basic reading',
    '可用': 'Available',
    'AI 模型': 'AI model',
    '已配置': 'Configured',
    '浏览器本地': 'Browser only',
    '正文发送许可': 'Permission to send article text',
    '已同意': 'Allowed',
    '三项检查清单': 'Three-step checklist',
    '基础阅读无需 AI。完成模型与许可后启用问答和解图；本地目录始终可选。': 'Basic reading works without AI. Configure a model and permission to enable chat and figure analysis; a local folder is always optional.',
    '浏览与手动工具': 'Browsing and manual tools',
    '导航、阅读、高亮和手动笔记已经可以直接使用。': 'Navigation, reading, highlighting, and manual notes are ready to use.',
    '已就绪': 'Ready',
    '连接 AI 模型': 'Connect an AI model',
    '用于问答、解图、翻译和释义；可随时切换模型。': 'Used for chat, figure analysis, translation, and explanation. You can switch models at any time.',
    '查看配置': 'View configuration',
    '确认正文发送许可': 'Confirm article-text permission',
    '只有在启用 LLM 功能时，才把所需正文或图注发送给所选服务商。': 'Only the article text or captions needed for an LLM task are sent to the selected provider.',
    '选择本地保存目录': 'Choose a local storage folder',
    '用于目录镜像、离线阅读和跨设备手动备份。': 'Used for folder mirroring, offline reading, and manual cross-device backups.',
    '选择目录': 'Choose folder',
    '暂时跳过': 'Skip for now',
    '完成并打开插件': 'Finish and open the extension',
    '常用入口': 'Quick access',
    '当前阅读配置': 'Current reading setup',
    '当前模型': 'Current model',
    '高亮模式': 'Highlight mode',
    '离线网页': 'Offline webpage',
    '自动保存': 'Auto-save',
    '保存目录': 'Storage folder',
    '仅浏览器本地': 'Browser only',
    'PDF 与阅读工具': 'PDF & reading tools',
    '高亮类别规则': 'Highlight category rules',
    '浏览本地数据': 'Browse local data',
    '← 返回 PDF': '← Return to PDF',
    '快捷键设置兼容入口': 'Shortcut settings compatibility entry',
    '这里使用的就是日常设置页面，之后可随时回来修改。': 'This is the everyday settings page. You can return and change it at any time.',
    '返回设置概览': 'Return to setup overview',
    '继续下一项': 'Continue to next item',
    'Brevess · 规则工作区': 'Brevess · Rule workspace',
    '让每一种证据都有清楚的判定边界': 'Give every evidence type a clear decision boundary',
    '逐个查看和编辑给 AI 的提示词与离线正则规则。修改只保存在本机，内置类别可随时恢复。': 'Review and edit AI prompts and offline regex rules. Changes stay on this device, and built-in categories can be restored at any time.',
    '已可用': 'Available',
    '检查中': 'Checking',
    '可选；用于目录镜像、离线阅读和跨设备手动备份。': 'Optional; used for folder mirroring, offline reading, and manual cross-device backups.',
    '用于问答、解图、翻译和释义；可随时更换模型。': 'Used for chat, figure analysis, translation, and explanation. You can switch models at any time.',
    '待检查': 'Needs checking',
    '去配置': 'Configure',
    '待确认': 'Needs confirmation',
    '仅本地功能': 'Local-only features',
    '规则模式': 'Rule mode',
    '未启用': 'Disabled',
    '搜索类别名称或 ID': 'Search category name or ID',
    '选择一个类别': 'Choose a category',
    '内置规则': 'Built-in rules',
    '复制为自定义类别': 'Duplicate as custom category',
    '反例（建议填写容易混淆的难反例，每行一条）': 'Negative examples (add easily confused hard negatives when possible, one per line)',
    '语义判定方式': 'Claim interpretation',
    '仅明确陈述': 'Explicit statements only',
    '允许合理推断': 'Allow reasonable inference',
    '明确陈述或合理推断': 'Explicit statements or reasonable inference',
    '关系约束': 'Relationship constraint',
    '必须包含实体或变量之间的关系': 'Must include a relationship between entities or variables',
    '自动识别显示为粗下划线；用户手动标注使用荧光笔高亮。': 'Automatic matches use a bold underline; manual annotations use marker highlights.',
    '短语': 'Phrase',
    '分句': 'Sentence',
    '预览由插件的提示词编译规则生成，不包含 API Key 或论文正文。': 'The preview is compiled by the extension and contains no API key or article text.',
    '白名单固定短语（匹配即高亮，每行一条）': 'Allowlisted fixed phrases (highlight on match, one per line)',
    '正则表达式（每行一条）': 'Regular expressions (one per line)',
    '黑名单固定短语（匹配即排除，每行一条）': 'Blocklisted fixed phrases (exclude on match, one per line)',
    '不会保存规则；测试文本最多 20,000 字符，结果最多显示 100 条。': 'Rules are not saved by this test. Test text is limited to 20,000 characters and 100 results.',
    '请选择类别': 'Choose a category',
    'Analysis Modes · 分析组合': 'Analysis modes · Combinations',
    '每个模式直接从全局类别目录勾选规则；侧栏不再要求选择论文类型。': 'Each mode selects rules directly from the global category catalog; the side panel no longer asks for a paper type.',
    '勾选项同时用于 LLM 分析；启用正则引擎的类别也可用于正则模式。': 'Selected categories are used for LLM analysis; categories with regex enabled can also run in regex mode.',
    'Reading scenarios · 阅读场景': 'Reading scenarios',
    '自定义论文阅读场景': 'Customize paper reading scenarios',
    '每个场景可自由组合全局类别；切换、编辑和保存场景不会发起模型请求。': 'Each scenario can use any combination of global categories. Switching, editing, and saving scenarios does not call the model.',
    '新增场景': 'Add scenario',
    '恢复全部内置场景': 'Restore all built-in scenarios',
    '阅读场景列表': 'Reading scenario list',
    '编辑阅读场景': 'Edit reading scenario',
    '自定义场景': 'Custom scenario',
    '内置场景 · 可编辑': 'Built-in scenario · Editable',
    '复制场景': 'Duplicate scenario',
    '恢复此内置场景': 'Restore this built-in scenario',
    '场景名称': 'Scenario name',
    '场景 ID': 'Scenario ID',
    '删除当前场景': 'Delete current scenario',
    '保存阅读场景': 'Save reading scenarios',
    '已删除的内置场景': 'Deleted built-in scenarios',
    '这些场景不会自行返回；只有在这里主动恢复后才会重新出现。': 'These scenarios will stay deleted until you restore them here.',
    '未命名场景': 'Unnamed scenario',
    '新阅读场景': 'New reading scenario',
    '已新增场景草稿，保存后生效。': 'A scenario draft was added. Save to apply it.',
    '已复制完整类别组合；修改名称后保存即可。': 'The complete category combination was duplicated. Rename it, then save.',
    '已恢复这个内置场景的名称、说明与默认类别组合；保存后生效。': 'This built-in scenario\u2019s default name, description, and category combination were restored. Save to apply them.',
    '至少保留一个阅读场景。': 'Keep at least one reading scenario.',
    '内置场景可在本页恢复。': 'Built-in scenarios can be restored on this page.',
    '场景已从草稿中删除，点击保存后生效。': 'The scenario was removed from the draft. Save to apply the change.',
    '恢复全部内置阅读场景的默认名称、说明和类别组合？自定义场景会保留。': 'Restore the default names, descriptions, and category combinations for all built-in reading scenarios? Custom scenarios will be kept.',
    '已恢复全部内置场景；自定义场景已保留，点击保存后生效。': 'All built-in scenarios were restored and custom scenarios were kept. Save to apply the change.',
    '至少需要一个已命名的阅读场景。': 'At least one named reading scenario is required.',
    '每个阅读场景至少勾选一个类别规则。': 'Select at least one category rule for every reading scenario.',
    '阅读场景已保存；切换场景不会调用模型。': 'Reading scenarios saved. Switching scenarios does not call the model.',
    '正在复制完整类别规则…': 'Duplicating the complete category rule…',
    '已复制为自定义类别；提示词、语义约束与正则规则均已保留。': 'Duplicated as a custom category. Prompts, semantic constraints, and regex rules were preserved.',
    '例如：statement': 'For example: statement',
    'Local storage · 可选': 'Local storage · Optional',
    '本地保存目录': 'Local storage folder',
    '把论文工作区镜像到你授权的文件夹，便于离线阅读、手动备份和迁移。浏览器本地数据仍是主数据源。': 'Mirror paper workspaces to an authorized folder for offline reading, manual backup, and migration. Browser-local data remains the primary source.',
    '保存本地存储设置': 'Save local storage settings',
    'Reading tools · 阅读体验': 'Reading tools · Reading experience',
    'PDF、提示词与文献笔记': 'PDF, prompts & literature notes',
    '集中管理 PDF 解析、全文问答快捷提示词、选中文段动作、Panel 追问和离线正文保存。': 'Manage PDF parsing, full-text chat prompts, text-selection actions, Panel follow-ups, and offline article storage.',
    '阅读工具分区': 'Reading-tool sections',
    'PDF 解析': 'PDF parsing',
    '快捷提示词': 'Quick prompts',
    '选区动作': 'Selection actions',
    'Panel 追问': 'Panel follow-ups',
    '保存阅读工具设置': 'Save reading-tool settings',
    'AI connection · 按需启用': 'AI connection · Enable when needed',
    '模型服务与连接': 'Model services & connections',
    '先连接模型，再按任务设置': 'Connect a model, then route tasks',
    '配置服务商、验证实际连接，并为常用任务选择模型。': 'Configure a provider, verify the actual connection, and choose models for common tasks.',
    '连接模型': 'Connect a model',
    '先完成一个可用连接，再按任务选择模型；导航、阅读和手动标注无需模型。': 'Create one usable connection first, then route tasks to models. Navigation, reading, and manual annotation need no model.',
    '模型连接': 'Model connection',
    '配置名称、服务商、凭据和模型保存在本机；测试只发送内置合成内容。': 'The profile name, provider, credential, and model stay on this device. Tests send only bundled synthetic content.',
    '高级连接设置': 'Advanced connection settings',
    '保存连接': 'Save connection',
    '当前连接结果': 'Current connection result',
    '尚未测试连接': 'Connection not tested yet',
    '高级：正文分析方式': 'Advanced: article analysis behavior',
    '高级任务设置': 'Advanced task settings',
    '高亮、摘要、证据审阅与跨图整合等低频任务仍可逐项配置。': 'Less frequent tasks such as highlighting, summaries, evidence review, and cross-figure synthesis remain individually configurable.',
    '高级 AI 功能的模型策略，可横向滚动': 'Model policies for advanced AI features; scroll horizontally',
    '当前模板': 'Current template',
    '有未保存修改': 'Unsaved changes',
    '保存失败': 'Save failed',
    '只在需要问答、解图、翻译或 LLM 高亮时配置；导航、阅读和手动标注无需模型。': 'Configure AI only for chat, figure analysis, translation, or LLM highlighting. Navigation, reading, and manual annotation need no model.',
    '尚未配置': 'Not configured',
    '正文高亮引擎': 'Article highlighting engine',
    '正则模式（离线）': 'Regex mode (offline)',
    '这里只控制“亮文”的自动高亮方式；段落概述、解图和全文问答仍可独立使用已配置的模型。': 'This controls only automatic article highlighting. Paragraph overviews, figure analysis, and full-text chat can still use configured models independently.',
    '进入论文页后自动分析正文': 'Analyze article text automatically when a paper opens',
    '命名 API Profiles': 'Named API profiles',
    '可为不同任务保存独立的模型服务与 Token 策略。': 'Save independent model services and token strategies for different tasks.',
    '按功能指定模型': 'Assign models by feature',
    '每个用户可见的 AI 功能都可独立指定模型、推理强度和 Token 规则；未单独指定时使用全局默认。': 'Each visible AI feature can independently choose a model, reasoning effort, and token rule. Unassigned features use the global default.',
    '全局默认 Profile': 'Global default profile',
    '功能': 'Feature',
    '模型选择': 'Model',
    '推理': 'Reasoning',
    '推理强度': 'Reasoning effort',
    'Token 规则': 'Token rule',
    '状态': 'Status',
    '各 AI 功能的模型策略，可横向滚动': 'Model policies for each AI feature; scroll horizontally',
    '需要多模态模型': 'Multimodal model required',
    '支持原图或正文与图注解读': 'Supports images or article text and captions',
    '正文与图注解读': 'Article text and captions',
    '解图支持所有已配置模型：多模态模型读取原图，纯文本模型使用正文与图注。': 'Figure interpretation supports all configured models: multimodal models read images; text models use article text and captions.',
    '解图支持已配置的生成模型：多模态模型读取原图，纯文本模型使用正文与图注。': 'Figure interpretation supports configured generative models: multimodal models read images; text models use article text and captions.',
    '用于文本概率判定，不支持生成问答、笔记或解图；请前往': 'returns typed text probabilities and does not generate answers, notes, or figure interpretations. Go to',
    '按功能指定模型 → 语义查找': 'Models by feature → Semantic find',
    '，将此 Profile 指定给语义查找或文献高亮。': ', and assign this profile to semantic find or paper highlighting.',
    '缺少模型': 'Missing model',
    '能力不匹配': 'Capability mismatch',
    '支持此输入': 'Input supported',
    '开启': 'On',
    '关闭': 'Off',
    '自动': 'Auto',
    '自定义': 'Custom',
    '最小': 'Minimal',
    '低': 'Low',
    '中': 'Medium',
    '高': 'High',
    '极高': 'Extra high',
    '最高': 'Maximum',
    '文献高亮': 'Paper highlighting',
    '语义查找': 'Semantic find',
    '个候选片段': 'candidate spans',
    '不支持此类文本判定': 'Does not support this typed decision',
    '仅支持文献高亮与语义查找': 'Paper highlighting and semantic find only',
    '证据台账审阅': 'Evidence-ledger review',
    '段落总结': 'Paragraph summary',
    '文章大纲总结': 'Article-outline summary',
    '缩写释义与翻译': 'Abbreviation explanation & translation',
    '图表解读': 'Figure walkthrough',
    '图版解读': 'Figure-panel interpretation',
    '图版追问': 'Figure-panel follow-up',
    '跨图机制整合': 'Cross-figure mechanism synthesis',
    '论文研究逻辑': 'Paper research logic',
    '论文创新点': 'Paper innovations',
    '论文局限性': 'Paper limitations',
    '文献笔记自动填写': 'Literature-note autofill',
    '文章问答': 'Article chat',
    '选中文本问答': 'Selected-text chat',
    '篇文献': 'paper',
    '条证据': 'evidence item',
    '个段落': 'paragraph',
    '篇文章': 'article',
    '个缩写': 'abbreviation',
    '张图': 'figure',
    '个图版': 'panel',
    '次追问': 'follow-up',
    '组图': 'figure set',
    '篇论文': 'paper',
    '次对话': 'chat turn',
    '段选中文本': 'text selection',
    '使用全局默认': 'Use global default',
    '未配置': 'Not configured',
    '不支持图片': 'Image input unsupported',
    '启用推理': 'Enable reasoning',
    '编辑': 'Edit',
    '按': 'For',
    '预览': 'preview',
    '当前模型仅支持推理开关，不支持强度分级。': 'This model supports only a reasoning toggle, not effort levels.',
    '不可选强度会由服务商规则归一到最接近的级别。': 'Unavailable efforts are normalized to the nearest provider-supported level.',
    '当前模型不支持可配置推理。': 'This model does not support configurable reasoning.',
    '未命名': 'Unnamed',
    '未选服务商': 'No provider selected',
    '未填写模型': 'No model entered',
    '视觉': 'Vision',
    '仅文本': 'Text only',
    '自定义 OpenAI 兼容接口': 'Custom OpenAI-compatible endpoint',
    'Kimi（月之暗面）': 'Kimi (Moonshot AI)',
    '智谱 GLM': 'Zhipu GLM',
    '豆包（火山方舟）': 'Doubao (Volcengine Ark)',
    '通义千问（阿里云百炼）': 'Qwen (Alibaba Cloud Model Studio)',
    '腾讯混元（TokenHub）': 'Tencent Hunyuan (TokenHub)',
    '腾讯混元（经典 API）': 'Tencent Hunyuan (Classic API)',
    '百度千帆': 'Baidu Qianfan',
    '不能为空。': ' is required.',
    '超出允许范围。': ' is outside the allowed range.',
    '最低 Token 不能高于最高 Token。': 'The token floor cannot exceed the token ceiling.',
    '带“多模态模型”标记的功能必须选择支持图片输入的 Profile；不兼容选项会直接禁用。': 'Features marked “multimodal model” require a profile with image input support; incompatible choices are disabled.',
    '执行 Token 规则': 'Execution token rule',
    '选择一项功能后编辑。': 'Choose a feature to edit.',
    '关闭 Token 规则': 'Close token rule',
    '输入预算': 'Input budget',
    '输出预算': 'Output budget',
    '安全比例': 'Safety ratio',
    '预留 Token': 'Reserved tokens',
    '来源上限 Token': 'Source token cap',
    '不限': 'No limit',
    '最大任务单元': 'Maximum task units',
    '基础 Token': 'Base tokens',
    '每单元 Token': 'Tokens per unit',
    '最低 Token': 'Token floor',
    '最高 Token': 'Token ceiling',
    '截断重试次数': 'Truncation retries',
    '重试倍率': 'Retry multiplier',
    '有效输入': 'Effective input',
    '有效输出': 'Effective output',
    '复制到其他功能': 'Copy to other features',
    '复制到已选功能': 'Copy to selected features',
    'Token 规则已复制到 {count} 项功能，保存设置后生效。': 'Token rule copied to {count} features. Save settings to apply it.',
    '恢复自动规则': 'Reset to automatic rule',
    '应用规则': 'Apply rule',
    '配置名称': 'Configuration name',
    '输入后按 Enter 或移开焦点即可单独保存名称。': 'Press Enter or move focus away to save the name.',
    'Token 策略': 'Token strategy',
    '输出 Token 由插件根据任务、模型容量和截断重试自动分配，无需手动设置上限。': 'Output tokens are allocated automatically based on the task, model capacity, and truncation retries.',
    '上下文窗口 Token（高级，可留空）': 'Context-window tokens (advanced, optional)',
    '仅在服务商明确给出窗口大小时填写；它与输出 Token 上限相互独立。': 'Enter this only when the provider specifies a context-window size. It is independent of the output-token limit.',
    '国内服务商已独立列出；“自定义兼容接口”用于其他 OpenAI 兼容服务。': 'Domestic providers are listed separately. Use “Custom compatible endpoint” for other OpenAI-compatible services.',
    '在线模型': 'Available models',
    '联网获取': 'Fetch online',
    '联网': 'Web',
    '为下一轮开启联网搜索': 'Enable web search for the next question',
    '为下一轮关闭联网搜索': 'Disable web search for the next question',
    '联网搜索已关闭；点击后下一轮将检索网络': 'Web search is off; click to search the web for the next question',
    '联网搜索已开启；点击后下一轮仅使用论文正文': 'Web search is on; click to use only the article text for the next question',
    '联网来源': 'Web sources',
    '本回答引用的联网来源': 'Web sources cited in this answer',
    '外部导入 · 来源未验证': 'External import · Source unverified',
    '联网回答 · 来源未验证': 'Web answer · Source unverified',
    '论文层级提取': 'Paper-level extraction',
    '独立读取正文，只填充空白笔记字段': 'Reads article text independently and fills only blank note fields',
    '论文层级提取操作': 'Paper-level extraction actions',
    '当前模型不支持联网搜索；请关闭“联网”后重试，或切换支持联网的模型。': 'The current model does not support web search. Turn off “Web” and retry, or switch to a model that supports web search.',
    '联网检索没有返回可核验来源；本轮回答未采用，请重试。': 'Web search returned no verifiable sources, so this answer was discarded. Please retry.',
    '联网回答或来源未完整返回；本轮回答未采用，请重试。': 'The web-grounded answer or its sources were incomplete, so this answer was discarded. Please retry.',
    '当前 Provider、模型或接口地址不支持可验证的联网检索。请关闭“联网”后重试，或切换到支持该能力的官方接口。': 'The current provider, model, or endpoint does not support verifiable web search. Turn off “Web” and retry, or switch to an official endpoint that supports it.',
    '联网回答没有返回可验证且与本次回答绑定的来源，因此结果未被展示或保存。请重试或更换支持联网检索的模型。': 'The web-grounded answer returned no verifiable sources bound to this answer, so the result was not displayed or saved. Retry or switch to a model that supports web search.',
    '联网检索结果不完整或格式校验失败，因此未展示未经完整验证的回答。请重试。': 'The web-search result was incomplete or failed format validation, so the unverified answer was not displayed. Please retry.',
    '联网回答未能完整保存到当前论文工作区，因此没有发布该结果。请检查工作区后重试。': 'The web-grounded answer could not be fully saved to the current article workspace, so the result was not published. Check the workspace and retry.',
    '当前问答模型不支持带来源的联网搜索，请关闭联网搜索或切换模型。': 'The current chat model does not support sourced web search. Turn off web search or switch models.',
    '联网回答缺少可验证的信息源，未发布本次回答。': 'The web-grounded answer lacked verifiable sources, so it was not published.',
    '联网回答未完整返回，未发布不完整内容。': 'The web-grounded answer was incomplete, so incomplete content was not published.',
    '选择 Provider 后会自动获取当前账号可用模型；仍可手动输入。': 'After choosing a provider, the extension fetches models available to the current account; manual entry is still supported.',
    'Key 仅保存在本机扩展存储中；保存后不会再次回显。': 'The key is stored only in local extension storage and is not displayed again after saving.',
    '推理强度': 'Reasoning effort',
    '仅在当前服务商与模型支持时发送推理参数。': 'Reasoning parameters are sent only when supported by the current provider and model.',
    '同时测试结构化推理（可选）': 'Also test structured reasoning (optional)',
    '仅文本配置：额外测试结构化推理（可选；视觉配置会自动测试）': 'Text-only profiles: additionally test structured reasoning (optional; vision profiles test it automatically)',
    '“测试连接”会发送插件内置的合成文本、微型 PNG 和 JSON Schema；绝不发送当前论文内容。': '“Test connection” sends extension-bundled synthetic text, a tiny PNG, and a JSON Schema; it never sends content from the current paper.',
    '正在仅用内置合成文本测试连接；不会发送当前论文内容。': 'Testing connectivity with extension-bundled synthetic text only; no content from the current paper is sent.',
    '正在使用内置合成文本和 JSON Schema 测试；不会发送当前论文内容。': 'Testing with extension-bundled synthetic text and a JSON Schema; no content from the current paper is sent.',
    '正在使用内置合成文本、微型 PNG 和 JSON Schema 测试；不会发送当前论文内容。': 'Testing with extension-bundled synthetic text, a tiny PNG, and a JSON Schema; no content from the current paper is sent.',
    '结构化推理通过': 'Structured reasoning passed',
    '结构化推理失败（连接正常）': 'Structured reasoning failed (connection is working)',
    '结构化推理已跳过（当前配置不支持）': 'Structured reasoning skipped (unsupported by this profile)',
    '接口预设': 'Endpoint preset',
    '选择后自动填入服务地址与默认模型；API Key 不会被修改。': 'Selecting a preset fills the service URL and default model without changing the API key.',
    '仅允许 HTTPS；本机服务可使用 http://localhost 或 http://127.0.0.1。': 'HTTPS is required, except for local services at http://localhost or http://127.0.0.1.',
    '鉴权请求头': 'Authentication header',
    'Key 前缀': 'Key prefix',
    '接口支持': 'Endpoint capabilities',
    '该兼容模型支持图片输入（仅在服务商明确支持时开启）': 'This compatible model supports image input (enable only when the provider explicitly supports it)',
    '本机 Codex': 'Local Codex',
    '使用插件专用的 Codex 登录空间，不读取桌面 Codex、CLI 或其他程序的令牌，也不会在插件中保存 API Key。请在这里单独登录一次，避免多个 Codex 进程争用刷新令牌。': 'Uses an extension-specific Codex login. It does not read tokens from desktop Codex, the CLI, or other programs, and stores no API key in the extension. Sign in here once to avoid refresh-token contention.',
    '下载 Windows 本机 Codex 桥（可选）': 'Download the Windows local Codex bridge (optional)',
    '查看安装说明': 'View installation guide',
    '插件专用 Codex 会话': 'Extension-specific Codex session',
    '尚未检查登录状态': 'Sign-in status not checked',
    '登录 / 重新登录': 'Sign in / Sign in again',
    '刷新状态': 'Refresh status',
    '退出插件会话': 'Sign out of extension session',
    '反向通道尚未检查。连接后，解图进度与结果会实时写入本机事件账本，供 Codex 按需读取。': 'The reverse channel has not been checked. Once connected, figure-analysis progress and results are written to a local event ledger for Codex to read when needed.',
    'PDF 解析 · MinerU': 'PDF parsing · MinerU',
    'PDF 原页阅读与增强识别': 'Original PDF reading & enhanced text recognition',
    '原页阅读和本地文字索引无需 MinerU。只有主动点击“增强文本识别”时，才会按这里的配置处理 PDF。': 'Original-page reading and local text indexing do not require MinerU. These settings are used only when you choose “Enhance text recognition”.',
    '未点击增强识别时，PDF 不会发送到 MinerU；原页阅读、查找和本地文字索引仍可直接使用。': 'The PDF is not sent to MinerU unless you choose enhanced recognition. Original-page reading, search, and local text indexing remain available.',
    '在浏览器中打开 PDF 后激活 Brevess，即会按这里的配置自动解析；无需在 PDF 页面再次选择文件或填写 Token。': 'When a PDF is open, Brevess uses these settings. You do not need to select the file or enter a token again on the PDF page.',
    '轻量解析无需 Token': 'Lightweight parsing requires no token',
    '解析模式': 'Parsing mode',
    '轻量解析 · 免 Token（适合不超过 20 页）': 'Lightweight parsing · No token (best for up to 20 pages)',
    '精准解析 · MinerU Token（长文献 / 复杂版式）': 'Precision parsing · MinerU token (long papers / complex layouts)',
    '已保存的 Token 不会再次回显；输入新值会覆盖旧值。': 'Saved tokens are not displayed again. Entering a new value replaces the old one.',
    '文献语言': 'Paper language',
    '中英文': 'Chinese and English',
    '英文': 'English',
    '日文': 'Japanese',
    '韩文': 'Korean',
    '扫描版 PDF 启用 OCR': 'Enable OCR for scanned PDFs',
    '保存 PDF 解析设置': 'Save PDF parsing settings',
    '清除 MinerU Token': 'Clear MinerU token',
    'PDF 会发送到 MinerU 做版面解析；解析后的正文仍遵循下方的模型发送许可。': 'The PDF is sent to MinerU for layout parsing. Parsed text still follows the model-sending permission below.',
    '根据任务路由选择第三方模型服务；未单独指定时使用全局默认。': 'Choose third-party model services by task routing; the global default is used when no task-specific profile is set.',
    '图注任务最好选择支持视觉输入的模型。': 'For caption tasks, choose a model that supports vision when possible.',
    '在问答输入框键入“/”即可按名称插入；名称和提示词内容均可新增、修改或删除。': 'Type “/” in the chat box to insert by name. Names and prompt text can be added, edited, or deleted.',
    '文献笔记模板': 'Literature-note templates',
    '为基础研究、临床研究、综述、病例、方法学和指南配置不同字段。每行一个字段，可直接修改或新增模板。': 'Configure different fields for basic research, clinical studies, reviews, cases, methods, and guidelines. Use one field per line, and edit or add templates directly.',
    '新增模板': 'Add template',
    '选中文段后的分析按钮': 'Text-selection analysis buttons',
    '“翻译”和“释义”为默认动作；可自定义更多按钮及发送到全文问答的内置提示词。': '“Translate” and “Explain” are default actions. Add more buttons and built-in prompts sent to full-text chat.',
    '新增动作': 'Add action',
    '追问选项的名称和提示词都可以新增、修改或删除；历史回答会按轮次折叠保留。': 'Follow-up names and prompts can be added, edited, or deleted. Previous answers remain collapsed by turn.',
    '离线内容与高清原图': 'Offline content & high-resolution figures',
    '控制需要长期保存在浏览器本地的完整正文网页与 Figure 高清原图。': 'Choose whether full article webpages and high-resolution Figures are kept long-term in browser-local storage.',
    '自动缓存每张已加载的 Figure 高清原图（推荐，可显著加快再次打开和导出）': 'Cache every loaded high-resolution Figure automatically (recommended; makes reopening and export much faster)',
    '保存文献时同时保存可离线恢复的完整正文网页（推荐；断网或离开校园网后仍可阅读）': 'Save a complete offline-restorable article webpage with the paper (recommended; remains readable without network or campus access)',
    '我知道启用 LLM 模式后，插件会根据任务路由，把论文正文、图注或图片发送到我选择的第三方模型服务；API Key 仍只保存在本机扩展存储中。': 'I understand that, when LLM mode is enabled, the extension sends the article text, captions, or images required by the task to my selected third-party model service. API keys remain in local extension storage.',
    'API Key 不会进入论文页面、同步存储、日志、缓存或语料导出。': 'API keys are never inserted into article pages, sync storage, logs, caches, or corpus exports.',
    '“测试连接”只发送插件内置的合成句，不发送当前论文。': '“Test connection” sends only a built-in synthetic sentence, never the current paper.',
    '自定义接口只在你点击保存或测试时申请对应域名权限。': 'Custom endpoints request domain permission only when you save or test them.',
    '键盘操作': 'Keyboard controls',
    '阅读工具': 'Reading tools',
    '点击输入框后直接按一个字母或数字；Backspace/Delete 可停用。输入文字、编辑表单或打开高清原图时不会误触。': 'Click a shortcut field and press a letter or number. Backspace/Delete disables it. Shortcuts do not trigger while typing, editing forms, or viewing a high-resolution figure.',
    '快捷键不能重复；数字 1–9 保留用于跳转对应 Figure。': 'Shortcuts must be unique. Numbers 1–9 are reserved for jumping to Figures.',
    '扩展类别': 'Extended categories',
    '新建自定义 LLM 类别': 'Create a custom LLM category',
    '先创建类别，再在上方工作区继续编辑完整提示词与正则规则。': 'Create a category first, then edit its full prompt and regex rules in the workspace above.',
    '优先高亮范围': 'Preferred highlight span',
    '保留方式': 'Retention',
    '长期保存': 'Keep permanently',
    '仅本次浏览会话': 'Current browsing session only',
    '添加识别类别': 'Add recognition category',
    '已永久删除的内置类别': 'Permanently deleted built-in categories',
    '这些类别不会参与任何识别或标注。只有在这里主动恢复后才会重新出现。': 'These categories are excluded from all recognition and annotation until you restore them here.',
    '仅保存在本机': 'Stored only on this device',
    '本地数据与备份': 'Local data & backup',
    '选择一个目录镜像类别、标注与反馈。页面只显示目录名称，不读取或展示系统完整路径。': 'Choose a folder to mirror categories, annotations, and feedback. The page shows only the folder name, never the full system path.',
    '论文工作区总览': 'Paper workspace overview',
    '按论文管理已保存的全文问答、Figure/Panel 解读、高亮和分析结果。列表只读取轻量摘要，详细占用按当前页加载。': 'Manage saved full-text chats, Figure/Panel interpretations, highlights, and analyses by paper. The list reads lightweight summaries; detailed usage loads per page.',
    '正在读取本地工作区…': 'Reading local workspaces…',
    '按论文标题或 DOI 搜索': 'Search by paper title or DOI',
    '排序': 'Sort',
    '最近修改': 'Recently modified',
    '最近访问': 'Recently accessed',
    '最近创建': 'Recently created',
    '占用从大到小': 'Size: largest first',
    '占用从小到大': 'Size: smallest first',
    '标题 A–Z': 'Title A–Z',
    '选择当前页': 'Select current page',
    '清除所选': 'Delete selected',
    '上一页': 'Previous page',
    '第 1 / 1 页': 'Page 1 / 1',
    '下一页': 'Next page',
    '目录镜像': 'Folder mirror',
    '本机数据库仍是主数据源；目录授权不可用时，修改会留在待同步队列中。': 'The local database remains the primary source. When folder authorization is unavailable, changes remain in the pending-sync queue.',
    '未选择': 'Not selected',
    '已选目录': 'Selected folder',
    '尚未选择目录': 'No folder selected',
    '加密配置备份': 'Encrypted configuration backup',
    'API Key、模型设置、MinerU PDF 解析设置与 Token、全局缩略词表以加密形式存放在所选目录；遗忘口令无法恢复密文凭据。': 'API keys, model settings, MinerU PDF settings and token, and the global abbreviation glossary are encrypted in the selected folder. Encrypted credentials cannot be recovered if the passphrase is lost.',
    '修订版本': 'Revision',
    '上次同步': 'Last sync',
    '加密配置备份未启用。': 'Encrypted configuration backup is disabled.',
    '解锁配置备份': 'Unlock configuration backup',
    '更换口令': 'Change passphrase',
    '遗忘本机密钥': 'Forget local key',
    '立即备份配置': 'Back up configuration now',
    '待同步': 'Pending sync',
    '冲突': 'Conflicts',
    '上次成功同步': 'Last successful sync',
    '尚未同步': 'Not synced yet',
    '重新授权': 'Reauthorize',
    '从目录重建': 'Rebuild from folder',
    '整机迁移': 'Full-device migration',
    '导出模型配置、API Key、自定义请求头、分析模式、分类提示词/正则、手动标注与反馈语料；在新浏览器导入后即可继续使用。': 'Export model configuration, API keys, custom headers, analysis modes, category prompts and regexes, manual annotations, and feedback corpus for import into another browser.',
    '导出模型配置、API Key、自定义请求头、阅读场景、分类提示词/正则、手动标注与反馈语料；在新浏览器导入后即可继续使用。': 'Export model configuration, API keys, custom headers, reading scenarios, category prompts and regexes, manual annotations, and feedback corpus for import into another browser.',
    '完整配置': 'Complete configuration',
    '迁移文件包含 API Key 等敏感信息，请仅保存在可信设备中。出于浏览器安全限制，本地目录授权无法随文件迁移，导入后需重新选择一次目录。': 'Migration files contain sensitive information such as API keys. Keep them only on trusted devices. Browser security prevents folder authorization from migrating, so choose the folder again after import.',
    '反馈语料与离线规则': 'Feedback corpus & offline rules',
    '网页中的反馈不包含全文、网页地址或 API Key。': 'Feedback from webpages contains no full text, page URL, or API key.',
    '正在读取…': 'Reading…',
    '离线规则至少需要来自 3 篇不同文档的重复正向证据。': 'Offline rules require repeated positive evidence from at least three different documents.',
    '导出 JSONL': 'Export JSONL',
    '导出 CSV': 'Export CSV',
    '项目信息': 'Project information',
    '关于、开源与反馈': 'About, open source & feedback',
    '许可证、源代码和问题反馈统一放在这里。': 'Licenses, source code, and feedback are collected here.',
    '遇到适配问题、功能异常或有改进建议，请通过 GitHub Issues 联系维护者。': 'Contact the maintainers through GitHub Issues for compatibility issues, bugs, or improvement suggestions.',
    '自由软件与源代码': 'Free software & source code',
    '本插件采用 GNU AGPL-3.0-or-later 发布。你可以依照许可证使用、研究、修改和再分发；本软件不提供任何明示或默示担保。': 'This extension is released under GNU AGPL-3.0-or-later. You may use, study, modify, and redistribute it under the license. The software is provided without express or implied warranty.',
    '查看公开源代码': 'View public source code',
    '查看 AGPL 许可证': 'View AGPL license',
    '第三方许可证与来源': 'Third-party licenses & sources',
    '未保存的修改': 'Unsaved changes',
    '要放弃当前类别的修改吗？': 'Discard changes to the current category?',
    '切换类别会丢失尚未保存的提示词或正则规则。你也可以取消切换，继续编辑并保存。': 'Switching categories discards unsaved prompt or regex changes. Cancel to continue editing and save them.',
    '继续编辑': 'Continue editing',
    '放弃并切换': 'Discard and switch',
    '恢复这个类别的内置规则？': 'Restore the built-in rules for this category?',
    '当前类别的本地修改会被移除，其他类别和旧版规则不会受影响。': 'Local changes to this category will be removed. Other categories and legacy rules are unaffected.',
    '确认恢复': 'Restore',
    '从目录恢复': 'Restore from folder',
    '从目录重建本地数据？': 'Rebuild local data from the folder?',
    '插件会导入索引中版本较新的类别与标注；现有冲突文件和有效备份都会保留，不会删除损坏的原文件。': 'The extension imports newer categories and annotations from the index. Existing conflict files and valid backups are kept, and damaged source files are not deleted.',
    '确认重建': 'Rebuild',
    '完整配置迁移': 'Complete configuration migration',
    '导入并覆盖当前配置？': 'Import and replace the current configuration?',
    '将恢复迁移文件中的 API Key、模型、自定义分类、提示词、正则、手动标注与反馈语料。当前目录授权不会改变。': 'This restores API keys, models, custom categories, prompts, regexes, manual annotations, and feedback corpus from the migration file. Current folder authorization is unchanged.',
    '确认导入': 'Import',
    '输入口令后，插件会从当前目录安全恢复加密设置。': 'Enter the passphrase to restore encrypted settings securely from the current folder.',
    '当前口令': 'Current passphrase',
    '口令': 'Passphrase',
    '确认新口令': 'Confirm new passphrase',
    '确认': 'Confirm',
    '导出网页适配诊断包': 'Export webpage compatibility diagnostics',
    '当前论文的本地工作区与档案': 'Local workspace and archive for the current paper',
    '设置 Panel 标题信息': 'Configure Panel title details',
    'Panel 标题显示字段': 'Panel title display fields',
    '清空该网页的本地文件夹保存': 'Clear this webpage from local folder storage',
    '导出 PPT 材料包': 'Export PowerPoint materials',
    '导出增强网页和笔记到 Zotero': 'Export enhanced webpage and notes to Zotero',
    '高亮视觉家族': 'Highlight visual family',
    '按名称或 ID 搜索': 'Search by name or ID',
    'Figure 与 Panel 展开控制': 'Figure and Panel expansion controls',
    '展开全部 Figure': 'Expand all Figures',
    '收起全部 Figure 与 Panel': 'Collapse all Figures and Panels',
    'Figure 与 Panel 快速跳转': 'Quick Figure and Panel navigation',
    '返回 Figure 与 Panel': 'Return to Figures and Panels',
    '机制网络工具': 'Mechanism-network tools',
    '导出或导入机制网络': 'Export or import mechanism network',
    '全文问答记录': 'Full-text chat history',
    '本轮限定章节': 'Sections selected for this turn',
    '直接提问；输入 @ 限定章节，输入 / 插入快捷提示词': 'Ask directly; type @ to limit sections or / to insert a quick prompt',
    '问答输入建议': 'Chat input suggestions',
    '选择全文问答模型': 'Choose full-text chat model',
    '选择智能检索高亮类别': 'Choose smart-retrieval highlight category',
    '选择智能检索高亮颜色': 'Choose smart-retrieval highlight color',
    '论文工作区': 'Paper workspace',
    'F 进入解图；←/→ 切换 Figure，↑/↓ 切换 Panel；1–9 跳 Figure，0 折叠所有 Panel': 'Press F for Figures; ←/→ switches Figures, ↑/↓ switches Panels; 1–9 jumps to a Figure, and 0 collapses all Panels',
    '关闭缩写表': 'Close abbreviation table',
    '缩略词表操作': 'Abbreviation-table actions',
    '使用“段落概述”对应的 LLM 模型补齐空白中文含义': 'Use the Paragraph overview LLM to fill missing meanings',
    '按缩写首字母快速跳转': 'Jump by abbreviation initial',
    '关闭 Figure 解读编辑器': 'Close Figure interpretation editor',
    '关闭段落笔记': 'Close paragraph note',
    '写下判断、疑问、实验启发或后续要核查的线索': 'Write a judgment, question, experimental idea, or lead to verify later',
    '关闭新建补充 Figure': 'Close supplemental Figure creator',
    'PDF 来源': 'PDF source',
    'Figure 图片或图注来源': 'Figure image or caption source',
    '例如 Figure S2': 'For example: Figure S2',
    '例如 8': 'For example: 8',
    '例如：Figure 3. (A) ... (B) ...': 'For example: Figure 3. (A) ... (B) ...',
    'Brevess 设置首页': 'Brevess settings home',
    '返回 PDF 阅读器': 'Return to PDF reader',
    '设置导航': 'Settings navigation',
    '关键设置状态': 'Essential setup status',
    '设置完成度': 'Setup progress',
    '类别规则工作区': 'Category-rule workspace',
    '识别类别': 'Recognition categories',
    '新增类别规则': 'Add category rule',
    '搜索名称或 ID': 'Search name or ID',
    '类别列表': 'Category list',
    '规则编辑方式': 'Rule editing method',
    '粘贴一小段论文文字进行试跑。': 'Paste a short article excerpt for a test run.',
    '分析模式列表': 'Analysis-mode list',
    '编辑分析模式': 'Edit analysis mode',
    'API Profile 列表': 'API profile list',
    '例如：主力模型': 'For example: Primary model',
    '使用插件的保守默认值': 'Use the extension’s conservative default',
    '选择或输入模型 ID': 'Choose or enter a model ID',
    '选择联网获取的模型': 'Choose a model fetched online',
    '粘贴 API Key': 'Paste API key',
    '留空表示无前缀': 'Leave blank for no prefix',
    '精准解析时填写；Token 仅保存在本机': 'Enter for precision parsing; the token stays on this device',
    '例如：临床转化意义': 'For example: Clinical relevance',
    '清楚说明什么内容属于这一类。': 'Clearly describe what belongs in this category.',
    '搜索标题或 DOI': 'Search title or DOI',
    '论文工作区分页': 'Paper-workspace pagination',
    '加密配置备份状态': 'Encrypted configuration backup status',
    '目录同步状态': 'Folder sync status',
    '本地数据操作': 'Local data actions',
    '开源项目链接': 'Open-source project links',
    '论文论证主链画布': 'Main paper-argument canvas',
    '统一问题—证据—结论主链': 'Unified question–evidence–conclusion chain',
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
    '模型 ID（可手动输入）': 'Model ID (editable)',
    '使用手填模型 ID': 'Using entered model ID',
    '选择候选模型（可选）': 'Choose a suggested model (optional)',
    '可直接填写服务商提供的完整模型 ID，包括未出现在候选列表中的新模型。保存和调用均以左侧输入框为准。': 'Enter the complete model ID supplied by your provider, including new models absent from the suggestions. The input field determines the model saved and used.',
    '当前配置没有可用的 API Key。请在本配置中填写并保存密钥；手填模型 ID 不受候选列表限制。': 'This profile has no available API key. Enter and save a key for this profile; manually entered model IDs are not restricted to the suggestions.',
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
    '显示': 'Display',
    '核心': 'Core',
    '扩展': 'Expanded',
    '全部': 'All',
    '细分类别': 'Fine-grained categories',
    '细类': 'Categories',
    '默认': 'Default',
    '推荐': 'Recommended',
    '语境': 'Context',
    '问题': 'Question',
    '设计': 'Design',
    '证据': 'Evidence',
    '解释': 'Interpretation',
    '验证': 'Validation',
    '边界': 'Boundary',
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
    'English': 'English',
    '证据表': 'Evidence matrix',
    '机制图': 'Mechanism graph',
    '机制图缩放': 'Mechanism graph zoom',
    '机制网络区内跳转': 'Mechanism network section navigation',
    '快速查看': 'Jump to',
    '待核验': 'Pending review',
    '已保存图': 'Saved graph',
    '已保存证据': 'Saved evidence',
    '候选图': 'Candidate graph',
    '候选证据': 'Candidate evidence',
    '未解析条目': 'Unresolved items',
    '待核验预览（尚未替换已保存机制网络）': 'Pending-review preview (saved mechanism network unchanged)',
    '此处仅展示生成候选；核验完成前，已保存机制网络保持不变。': 'Generated candidates are shown here only. The saved mechanism network remains unchanged until review is complete.',
    '候选节点与关系': 'Candidate nodes and relations',
    '全部候选节点': 'All candidate nodes',
    '关系与 Panel 证据': 'Relations and Panel evidence',
    '未解析或无关系的 Panel 证据': 'Unresolved or non-relational Panel evidence',
    '没有记录未解析或无关系的 Panel 证据。': 'No unresolved or non-relational Panel evidence was recorded.',
    '上游节点': 'Upstream node',
    '关系性质': 'Relation',
    '下游节点': 'Downstream node',
    'Panel 证据': 'Panel evidence',
    '实验上下文': 'Experimental context',
    '关系图例': 'Relation legend',
    '适合宽度': 'Fit width',
    '实际大小': 'Actual size',
    '实际大小（100%）': 'Actual size (100%)',
    '恢复视图': 'Reset view',
    '恢复适合宽度并回到图起点': 'Fit to width and return to the graph origin',
    '维护、同步与迁移': 'Maintenance, sync, and migration',
    '工作区管理、目录镜像、整机迁移与反馈语料': 'Workspace management, folder mirroring, device migration, and feedback corpus',
    '阅读资料与本地数据': 'Reading resources and local data',
    'LOCAL FIRST · 本地数据': 'LOCAL FIRST · Local data',
    '检索本地文献与缩略词；需要时再展开工作区维护、目录同步与迁移。': 'Search local articles and abbreviations; expand workspace maintenance, folder sync, and migration when needed.',
    '先检索本地文献与缩略词，需要时再展开维护、同步与迁移。': 'Search local articles and abbreviations first; expand maintenance, sync, and migration when needed.',
    '检索已保存内容': 'Search saved content',
    '搜索范围': 'Search scope',
    '全部范围': 'All fields',
    '本地文献': 'Local articles',
    '全局缩略词': 'Global abbreviations',
    '打开原文': 'Open article',
    '查看出现文献': 'View article occurrences',
    '收起出现文献': 'Hide article occurrences',
    '阅读显示': 'Shown while reading',
    '导入日期': 'Imported',
    '隐藏': 'Hidden',
    '正向/促进': 'Positive / promoting',
    '因果联系': 'Causal relation',
    '相关联系': 'Correlative relation',
    '争议联系': 'Contested relation',
    '结果 ↓ / 来源 →': 'Target ↓ / Source →',
    '列为上游节点，行为下游节点。': 'Columns are upstream nodes and rows are downstream nodes.',
    '充分性证据': 'Sufficiency evidence',
    '必要性证据': 'Necessity evidence',
    '其他或相关性证据': 'Related / other evidence',
    '救援实验': 'Rescue',
    '上位性': 'Epistasis',
    '定向干预': 'Directional intervention',
    '相关性': 'Association',
    '观察 / 定位': 'Observation / localization',
    '阴性结果': 'Null result',
    '反证': 'Counterevidence',
    '结论不明 / 未知': 'Inconclusive / unknown',
    '未关联 Panel 审计': 'Non-linked Panel audit',
    '未关联 Panel 不会显示为联系证据，以下条目保留其审计状态与原因。': 'Non-linked Panels are not shown as link evidence. Their audit status and reason are listed below.',
    '未关联': 'Unlinked',
    '已排除': 'Excluded',
    '存在歧义': 'Ambiguous',
    '候选 Panel': 'Candidate Panels',
    '当前证据表中没有关联联系。': 'No link currently contains this Panel.',
    '未连通证据审计': 'Disconnected evidence audit',
    '未连通但有证据的节点': 'Disconnected but evidenced nodes',
    '未解析证据审计': 'Unresolved evidence audit',
    '尚未解析的证据': 'Unresolved evidence',
    '排除证据审计': 'Excluded evidence audit',
    '示意图 / 非证据排除项': 'Schematic / non-evidentiary exclusions',
    'Panel 内的主张互不相容': 'Panel claims are incompatible',
    '因果检验不满足纳入条件': 'Causal test does not meet inclusion criteria',
    '缺少可定位的节点证据': 'No locatable node evidence',
    '复合关系暂不支持': 'Composite relations are not supported',
    '不允许自指关系': 'Self-relations are not allowed',
    '缺少审计定位': 'Audit placement is missing',
    '缺少证据记录': 'Evidence record is missing',
    '关系术语未能映射': 'Relation term could not be mapped',
    '缺少关系映射': 'Relation mapping is missing',
    '来源支持的示意图，不作为机制证据': 'Source-backed schematic; not treated as mechanism evidence',
    '机制链需要人工检查。': 'The mechanism chain needs manual review.',
    '正在等待机制链生成；也可以先新增节点，手动构建机制链。': 'Waiting for mechanism-chain generation. You can also add a node and build the chain manually.',
    '未配置 LLM 也可以使用：点击“新增链条节点”开始结构化记录。': 'You can use this without an LLM: select “Add chain node” to start a structured record.',
    '当前机制链与已生成证据审计不一致，需要重新检查。': 'The current mechanism chain does not match the generated evidence audit and needs review.',
    '未填写节点': 'Unnamed node',
    '关闭': 'Close',
    '关闭证据单元格编辑器': 'Close evidence-cell editor',
    '选择 Panel 证据': 'Select Panel evidence',
    '选择 Panel': 'Select Panel',
    '证据类别': 'Evidence class',
    '自环联系极性': 'Self-loop polarity',
    '请选择极性': 'Select polarity',
    '选择要添加证据的联系': 'Select the link that receives the evidence',
    '添加证据': 'Add evidence',
    '充分性': 'Sufficiency',
    '必要性': 'Necessity',
    '其他': 'Related / other',
    '保存名称': 'Save name',
    '删除证据': 'Delete evidence',
    '编辑': 'Edit',
    'Panel 证据已变化，请重新打开此单元格': 'Panel evidence changed. Reopen this cell.',
    '论文上下文已变化，请重新打开证据表': 'The paper context changed. Reopen the evidence matrix.',
    '正在保存，请稍候': 'Saving. Please wait.',
    '自环联系必须选择正向或负向极性': 'Choose positive or negative polarity for a self-loop.',
    '证据未保存，请刷新后重试': 'Evidence was not saved. Refresh and try again.',
    '列为上游节点，行为下游节点；格内列出支持该联系的 Figure / Panel。红色为充分性证据，蓝色为必要性证据，黑色为其他或相关性证据。': 'Columns are upstream nodes and rows are downstream nodes. Each cell lists the Figures or Panels supporting that link. Red marks sufficiency evidence, blue marks necessity evidence, and black marks other or correlational evidence.',
    '机制节点按全文证据凝练；箭头只表达机制方向，证据 Panel 统一列在下方证据表。': 'Nodes are distilled from evidence across the paper. Arrows show mechanism direction; supporting Panels are listed in the evidence matrix below.',
    '机制图组件尚未就绪，请刷新后重试。': 'The mechanism graph is not ready. Refresh and try again.',
    '全文机制图': 'Paper-wide mechanism graph',
    '机制图渲染失败，节点与证据表仍可继续编辑。': 'The mechanism graph could not be rendered. Nodes and the evidence matrix remain editable.',
    '正在收集 Panel 证据': 'Collecting Panel evidence',
    '正在规范化机制节点': 'Canonicalizing mechanism nodes',
    '正在映射主张关系': 'Mapping claim relations',
    '正在组装机制图': 'Assembling mechanism graph',
    '正在修复未解析证据': 'Repairing unresolved evidence',
    '正在验证最终结果': 'Validating final result',
    '模型仍在处理': 'The model is still processing',
    '机制链任务排队中': 'Mechanism generation queued',
    '机制链生成处理中': 'Mechanism generation in progress',
    '机制链生成正在重试': 'Retrying mechanism generation',
    '取消机制链生成': 'Cancel mechanism generation',
    '正在取消机制链生成': 'Cancelling mechanism generation',
    '机制链生成已取消': 'Mechanism generation cancelled',
    '机制链需要人工核验': 'Mechanism generation needs review',
    '机制链生成失败': 'Mechanism generation failed',
    '机制链生成完成': 'Mechanism generation complete',
    '机制链生成超时': 'Mechanism generation deadline exceeded',
    '机制链请求额度已用尽': 'Mechanism request budget exhausted',
    '机制链工作区版本冲突': 'Mechanism workspace revision conflict',
    '开始研读': 'Start reading',
    '继续研读': 'Continue reading',
    '在侧栏打开当前文献': 'Open this paper in the side panel',
    '查看历史': 'View history',
    '浏览本地保存的文献': 'Browse locally saved papers',
    '打开设置': 'Open settings',
    '管理模型与阅读工具': 'Manage models and reading tools',
    '正在读取当前页面…': 'Reading the current page…',
    '正在连接当前论文…': 'Connecting to the current paper…',
    '已激活，正在读取当前页面': 'Active — reading the current page',
    '重新提取': 'Extract again',
    'Panel 标题信息': 'Panel title details',
    '证据类型': 'Evidence type',
    '比较/分组': 'Comparison / grouping',
    '发现这篇论文的本地历史档案': 'A local archive was found for this paper',
    '可以加载上次结果，或保留当前页面并重新分析。': 'Load the previous results, or keep the current page and analyze it again.',
    '加载上次结果': 'Load previous results',
    '重新分析': 'Analyze again',
    '暂停分析': 'Pause analysis',
    '取消分析': 'Cancel analysis',
    '越高越精确，越低显示越多': 'Higher is more precise; lower shows more results',
    '单词/短语': 'Words / phrases',
    '整句': 'Full sentences',
    '搜索更多分类': 'Search more categories',
    '下方每项都可查看或编辑规则；临时类别会单独标记。': 'You can view or edit every rule below. Temporary categories are labelled separately.',
    '正在读取手动标注…': 'Reading manual annotations…',
    'Figure 与 Panel': 'Figures & Panels',
    '正在从网页结构读取 Figure 与 Panel 目录…': 'Reading the Figure and Panel catalog from the webpage structure…',
    '补充材料覆盖': 'Supplemental-material coverage',
    '← 返回': '← Back',
    '分支、汇合与反馈按证据方向显示；双击文字即可编辑。': 'Branches, convergences, and feedback follow the evidence direction. Double-click text to edit.',
    '新增': 'Add',
    '聚焦路径': 'Focus path',
    '导出 PNG': 'Export PNG',
    '导出 SVG': 'Export SVG',
    '导出 JSON': 'Export JSON',
    '导入 JSON': 'Import JSON',
    '导出到 Zotero': 'Export to Zotero',
    '清空本地工作区': 'Clear local workspace',
    '扫描并恢复本地工作区': 'Scan and restore local workspace',
    '更多论文工具': 'More paper tools',
    '刷新论文导航': 'Refresh article navigation',
    '刷新图表目录': 'Refresh figure inventory',
    '清空对话': 'Clear conversation',
    '问答工具': 'Chat tools',
    '已保存': 'Saved',
    '以当前网页正文为上下文连续对话，每次提问都可切换已配置模型。': 'Chat continuously using the current article as context. You can switch configured models for every question.',
    '等待读取当前网页正文…': 'Waiting for the current article text…',
    '正在检查模型连接…': 'Checking the model connection…',
    '模型设置': 'Model settings',
    'AI 填写需要已配置的模型。': 'AI autofill requires a configured model.',
    '模型已配置；授予正文发送许可后即可 AI 填写。': 'A model is configured. Grant permission to send article text to enable AI autofill.',
    'AI 填写配置模型': 'AI autofill model',
    '无法确认 AI 填写的任务模型；请检查任务设置与全局回退。': 'The task model for AI autofill could not be confirmed. Check the task setting and global fallback.',
    '模型已配置；尚未授予正文发送许可。': 'A model is configured, but permission to send article text has not been granted.',
    '尚未连接可用于全文问答的模型。': 'No model is connected for full-text chat.',
    '尚未配置可用模型': 'No available model configured',
    '本轮模型': 'Model for this turn',
    '联网检索是可选辅助来源；关闭时仅使用论文正文。': 'Web search is an optional supporting source. When off, only the article text is used.',
    '智能检索高亮': 'Semantic highlight search',
    '智能检索匹配': 'Semantic match',
    '把当前问题转成可编辑的正文高亮，不会发送问答。': 'Turn the current question into editable article highlights without sending a chat request.',
    '可以询问结论、机制、方法、证据强弱、局限，或让模型跨章节比较。': 'Ask about conclusions, mechanisms, methods, evidence strength, limitations, or cross-section comparisons.',
    '向全文提问': 'Ask the full paper',
    '高亮颜色': 'Highlight color',
    '正在从正文中提取明确声明的缩写与全称…': 'Extracting explicitly defined abbreviations and full forms from the article…',
    '本文导入全局记忆': 'Add this paper to global memory',
    '导入词库': 'Import glossary',
    '导出词库': 'Export glossary',
    '缩写': 'Abbreviation',
    '英文全称': 'English full form',
    '中文含义': 'Chinese meaning',
    '一键获取': 'Fetch',
    '正文中暂未发现“全称（缩写）”或“缩写（全称）”形式的可靠定义。': 'No reliable “full form (abbreviation)” or “abbreviation (full form)” definitions were found in the article.',
    '编辑 Figure 解读': 'Edit Figure interpretation',
    '模型原文会保留；保存后显示人工修订版，并同步写入当前论文工作区。': 'The model output is preserved. Your revision will be displayed and saved to the current paper workspace.',
    '取消': 'Cancel',
    '手动点评 · 不消耗 token': 'Manual note · no tokens used',
    '段落笔记': 'Paragraph note',
    '删除笔记': 'Delete note',
    '保存笔记': 'Save note',
    '手动补全证据': 'Add evidence manually',
    '新建补充 Figure': 'Create supplemental Figure',
    '可解析补充 PDF，或用图片、图注创建单张补充图。': 'Parse a supplemental PDF, or create one supplemental figure from an image or caption.',
    '选择来源': 'Choose source',
    'PDF 解析': 'PDF parsing',
    '图片 / 图注': 'Image / caption',
    '用 MinerU 在后台解析补充 PDF': 'Parse a supplemental PDF with MinerU in the background',
    '在这里选择已下载的补充 PDF。解析期间不会切换或覆盖当前正文页面。': 'Choose a downloaded supplemental PDF here. Parsing will not switch or replace the current article page.',
    '选择补充材料 PDF': 'Choose supplemental PDF',
    'MinerU 将识别图注、Figure 和 Panel；完成后会自动导入并报告缺失项。': 'MinerU will identify captions, Figures, and Panels, then import them and report missing items.',
    'Figure 类型': 'Figure type',
    'Figure 编号': 'Figure number',
    '原 PDF 页码（可选）': 'Original PDF page (optional)',
    '页码按 PDF 阅读器显示的页数填写；图解卡片可据此跳回原 PDF 页面。': 'Use the page number shown in the PDF reader so the figure card can jump back to the original PDF.',
    '选择 Figure 图片': 'Choose Figure image',
    '点击此处后按 Ctrl+V，可直接粘贴剪贴板图片': 'Click here and press Ctrl+V to paste an image from the clipboard',
    '未选择图片；也可以只填写图注。': 'No image selected. You can provide only a caption.',
    '图注（可选）': 'Caption (optional)',
    '图片和图注至少提供一种；图片支持 PNG、JPEG、WebP，最大 20 MiB。': 'Provide at least an image or a caption. PNG, JPEG, and WebP up to 20 MiB are supported.',
    '继续': 'Continue',
    '清除本文手动标注？': 'Clear manual annotations for this paper?',
    '这会删除本文保存的手动标注，并移除页面上的荧光笔高亮。': 'This deletes saved manual annotations for this paper and removes their highlights from the page.',
    '确认清除': 'Clear annotations',
    '当前页面': 'Current page',
    '当前页面暂不支持直接研读，仍可查看历史或设置。': 'This page cannot be read directly. History and settings are still available.',
    '暂时无法读取当前页面，请关闭后重试。': 'The current page could not be read. Close this popup and try again.',
    '正在打开研读侧栏…': 'Opening the reading side panel…',
    '无法打开研读侧栏。': 'Could not open the reading side panel.',
    '研读侧栏': 'Reading sidebar',
    '增强文本识别': 'Enhance text recognition',
    '识别设置': 'Recognition settings',
    '页': 'Page',
    '正在准备 PDF': 'Preparing PDF',
    '直接显示 PDF 原页并在本机建立文字索引；扫描件可使用增强识别。': 'Read the original PDF pages with a local text index. Scanned pages can use enhanced recognition.',
    '原页阅读与文字索引在本机完成。仅主动使用“增强文本识别”时，PDF 才发送至 MinerU；显示仍保留 PDF 原页。': 'Original-page reading and text indexing run locally. The PDF is sent to MinerU only when you choose enhanced text recognition; original pages remain visible.',
    'PDF 页码与查找': 'PDF page navigation and search',
    '页码': 'Page number',
    '在 PDF 中查找': 'Find in PDF',
    '上一处': 'Previous match',
    '下一处': 'Next match',
    '文献笔记': 'Literature note',
    '打开文献笔记': 'Open literature note',
    '关闭文献笔记': 'Close literature note',
    '文献类型模板': 'Paper-type template',
    'AI 读取全文填写本模板': 'Fill this template from the full paper',
    'AI 正在阅读全文并填写…': 'AI is reading the paper and filling the template…',
    '正在分析正文证据…': 'Analyzing article evidence…',
    '已自动保存到本机': 'Saved automatically on this device',
    '正在保存…': 'Saving…',
    '研究背景': 'Research background',
    '科学问题': 'Scientific questions',
    '研究背景与科学问题': 'Research background and scientific questions',
    '全文创新点': 'Paper-wide innovations',
    '研究局限': 'Research limitations',
    '提取研究背景与科学问题': 'Extract background and questions',
    '提取创新点': 'Extract innovations',
    '提取研究局限': 'Extract limitations',
    '全文创新点已部分生成,需人工核验(已复用正文证据缓存)': 'Paper-wide innovations were partially generated and need review (reused article-evidence cache)',
    '研究局限已部分生成,需人工核验(已复用正文证据缓存)': 'Research limitations were partially generated and need review (reused article-evidence cache)',
    '正在提取…': 'Extracting…',
    '不需要先解图；按正文证据生成 Q0 与 Q1–Q4 推进链。': 'No figure analysis is required. Generates Q0 and a Q1–Q4 progression from article evidence.',
    '尚未生成；可点击下方新增后填写。': 'Not generated yet. Add an item below to enter it manually.',
    '双击填写': 'Double-click to edit',
    '双击或按 Enter 编辑': 'double-click or press Enter to edit',
    '新增背景': 'Add background',
    '新增问题': 'Add question',
    '新增创新点': 'Add innovation',
    '新增局限': 'Add limitation',
    '机制网络': 'Mechanism network',
    '打开机制网络': 'Open mechanism network',
    '新建机制网络': 'Create mechanism network',
    '节点设置': 'Node settings',
    '联系设置': 'Link settings',
    '新增上游': 'Add upstream node',
    '新增下游分支': 'Add downstream branch',
    '删除节点': 'Delete node',
    '连接到现有节点': 'Connect to an existing node',
    '上游节点': 'Upstream node',
    '下游节点': 'Downstream node',
    '联系极性': 'Link polarity',
    '中性': 'Neutral',
    '正向': 'Positive',
    '负向/抑制': 'Negative / inhibitory',
    '添加联系': 'Add link',
    '未解析 Panel': 'Unresolved Panel',
    '删除联系': 'Delete link',
    '添加联系的 Panel 证据': 'Add Panel evidence to this link',
    '＋ 添加 Panel 证据': '＋ Add Panel evidence',
    '手工录入 Panel 证据编号': 'Enter a Panel evidence ID manually',
    '添加编号': 'Add ID',
    '例如 2A 或 S2A': 'For example, 2A or S2A',
    '该编号对应多个 Panel，请从列表选择': 'This ID matches multiple Panels. Choose one from the list.',
    '未找到唯一对应的 Panel': 'No unique matching Panel was found',
    '尚未解析 PDF': 'PDF not parsed yet',
    '开始解析 PDF': 'Parse PDF',
    '重新解析': 'Parse again',
    '保存带批注副本': 'Save annotated copy',
    '覆盖原 PDF': 'Overwrite original PDF',
    '选择可安全覆盖的本地 PDF': 'Choose a local PDF that can be safely overwritten',
    '正在写入批注并重新打开 PDF 核验…': 'Writing annotations and reopening the PDF for verification…',
    '批注导出已核验，浏览器已开始下载；请在下载完成后确认文件。': 'The annotation export was verified and the browser started the download; confirm the file after it finishes.',
    '浏览器已开始下载点击时的批注快照；当前批注已变化，请在下载完成后确认文件。': 'The browser started downloading the annotation snapshot from when you clicked; the current annotations have changed, so confirm the file after the download finishes.',
    '已保存点击时的批注快照；当前批注已变化。': 'The annotation snapshot from when you clicked was saved; the current annotations have changed.',
    '所选保存位置是当前原 PDF，请使用“覆盖原 PDF”并完成安全确认。': 'The selected destination is the current original PDF. Use “Overwrite original PDF” and complete the safety confirmation.',
    '无法确认保存副本与原 PDF 是否为同一文件，已停止保存。': 'Could not confirm whether the copy destination is the original PDF, so saving was stopped.',
    '文件已经写入，但重新读取核验失败；请检查目标文件后再重试。': 'The file was written, but re-reading and verification failed. Check the destination file before trying again.',
    '保存期间 PDF 或批注已变更，本次保存已取消，请重试。': 'The PDF or annotations changed while saving. This save was cancelled; try again.',
    '保存目标未准备完成，请重试。': 'The save destination was not ready. Try again.',
    '已取消保存，原文件未改变。': 'Save cancelled. The original file was not changed.',
    '原 PDF 已被其他程序修改，为避免覆盖新内容，本次保存已阻止。': 'The original PDF changed in another program. Saving was blocked to protect the newer file.',
    '批注 PDF 保存或核验失败，请重试或改用“保存带批注副本”。': 'The annotated PDF could not be saved or verified. Try again or use “Save annotated copy”.',
    '所选 PDF 文字没有可保存的页面坐标，请重新选择': 'The selected PDF text has no savable page coordinates. Select it again.',
    '无法保存所选 PDF 文字的页面坐标，请重新选择': 'Could not save page coordinates for the selected PDF text. Select it again.',
    '本次提问已取消，已完成的回答内容已保留。': 'This question was cancelled. Completed answer content was preserved.',
    '打开 MinerU 设置': 'Open MinerU settings',
    '打开 PDF': 'Open PDF',
    '选择本地文件或输入远程地址': 'Choose a local file or enter a remote address',
    '或输入远程 PDF 地址': 'Or enter a remote PDF address',
    '打开远程 PDF': 'Open remote PDF',
    'PDF 辅助文字索引': 'PDF auxiliary text index',
    '请输入远程 PDF 的 HTTP(S) 地址。': 'Enter an HTTP(S) address for the remote PDF.',
    '请输入有效的远程 PDF 地址。': 'Enter a valid remote PDF address.',
    '远程 PDF 地址必须使用 http:// 或 https://，且不能包含用户名或密码。': 'The remote PDF address must use http:// or https:// and cannot contain a username or password.',
    '无法打开这个远程 PDF 地址，请检查后重试。': 'This remote PDF address could not be opened. Check it and try again.',
    '正在打开远程 PDF…': 'Opening the remote PDF…',
    '查看原始 PDF': 'View original PDF',
    '新标签打开 PDF': 'Open PDF in a new tab',
    '返回原论文正文': 'Return to the article',
    '返回上处': 'Back to previous location',
    '适宽': 'Fit width',
    '适合阅读宽度': 'Fit to reading width',
    '阅读缩放': 'Reading zoom',
    '解析设置': 'Parsing settings',
    '原始 PDF': 'Original PDF',
    '可选择文字的原始 PDF': 'Selectable original PDF',
    '解析后的 PDF 正文': 'Parsed PDF text',
    '浏览器尚未允许扩展读取这个本地 PDF': 'The browser has not allowed the extension to read this local PDF',
    '选择当前本地 PDF': 'Choose this local PDF',
    '当前先显示原始 PDF。需要重排正文、层级大纲和 Figure 解读时，再点击“开始解析 PDF”。': 'The original PDF is shown first. Click “Parse PDF” only when you need reflowed text, a reconstructed outline, or figure analysis.',
    '可在扩展管理页允许访问文件网址后重新解析；也可以只在这里重新选择当前文件。': 'Allow access to file URLs in extension settings, or select this file again here.',
    '若出版社禁止内嵌显示，请使用顶部“新标签打开 PDF”；返回本页后解析结果仍会保留。': 'If the publisher blocks embedded viewing, use “Open PDF in a new tab”. Parsed results remain available when you return.',
    'PDF 会发送到 MinerU 进行版面解析；Token 与解析偏好统一在 Brevess 的“模型与分析”设置页管理。': 'The PDF is sent to MinerU for layout parsing. Manage its token and parsing preferences under Models & analysis.',
    'Brevess PDF 阅读工作区': 'Brevess PDF workspace',
    '可在原 PDF 页面翻页、缩放和搜索；含文字层的页面支持划选、高亮与批注，这些操作不需要 MinerU 或 LLM。': 'Turn pages, zoom, and search in the original PDF. Pages with a text layer support selection, highlights, and annotations without MinerU or an LLM.',
    '含文字层的 PDF 会自动建立正文索引，可继续使用亮文、问答和解图。扫描件缺少可选文字时，可在页面顶部选择“增强文本识别”；阅读画面始终保留原 PDF。': 'PDFs with a text layer are indexed automatically for highlights, chat, and figure analysis. For scanned pages without selectable text, choose “Enhance text recognition” at the top; the reading view always keeps the original PDF.',
    '← 返回原论文正文': '← Return to the article',
    '正在准备文献 PDF…': 'Preparing the paper PDF…',
    '离线文献': 'Offline paper',
    '离线文献正文': 'Offline paper text',
    '正在载入离线文献…': 'Loading offline paper…',
    'Brevess 离线文献': 'Brevess offline paper',
    '仅读取本机保存的网页快照': 'Reading only the webpage snapshot saved on this device',
    '关闭': 'Close',
    '论文论证地图': 'Paper argument map',
    '回到原文': 'Back to article',
    '全屏': 'Full screen',
    '缩小': 'Zoom out',
    '放大': 'Zoom in',
    '折叠所有图': 'Collapse all figures',
    '编辑论证': 'Edit argument',
    '折叠编辑面板': 'Collapse editor',
    '主图': 'Main figure',
    '补充图': 'Supplemental figure',
    '补充视频': 'Supplemental video',
    '补充表': 'Supplemental table',
    '补充材料': 'Supplemental material',
    '正在载入…': 'Loading…',
    '载入远端版本': 'Load remote version',
    '重试保存': 'Retry save',
    '机制链': 'Mechanism chain',
    '结论边界': 'Claim boundary',
    '等待载入…': 'Waiting to load…',
    'Brevess · 论文论证地图': 'Brevess · Paper argument map',
    '正在读取论文工作区…': 'Reading the paper workspace…',
    '折叠编辑': 'Collapse editor',
    '发现尚未同步的本地草稿。': 'An unsynced local draft was found.',
    '恢复草稿': 'Restore draft',
    '使用已保存版本': 'Use saved version',
    '标题层级与逐段摘要': 'Outline and paragraph summaries',
    '等待读取当前论文结构…': 'Waiting for the current paper structure…',
    '直接读取本地 HTML 标题层级，无需调用 AI。': 'Reads the local HTML heading hierarchy without AI.',
    '收起全部标题层级': 'Collapse all headings',
    '直接读取本地 HTML/PDF 标题层级，无需调用 AI。': 'Read local HTML/PDF heading structures directly; no AI required.',
    '专注阅读': 'Focus reading',
    '切换专注阅读': 'Toggle focus reading',
    '标题层级展开控制': 'Heading expansion controls',
    '摘句工具': 'Excerpt tools',
    '图解工具': 'Figure tools',
    '笔记工具': 'Note tools',
    '高亮': 'Highlight',
    '检索内容': 'Search query',
    '检索模型': 'Search model',
    '选择智能检索高亮模型': 'Choose a search highlighting model',
    '输入想查找的内容，在正文中生成可编辑高亮；不会发送问答或改动问答草稿。': 'Describe what to find and create editable highlights in the article. Your chat draft stays unchanged; no question is sent.',
    '例如：本文支持核心结论的实验依据': 'For example: experimental evidence for the central conclusion',
    '请先配置可用模型，并选择智能检索的高亮类别。': 'Configure an available model and choose a highlight category first.',
    '更多': 'More',
    '收起': 'Collapse',
    '翻页': 'Page navigation',
    'PDF 阅读状态': 'PDF reading status',
    'PDF 页处理进度': 'PDF page processing progress',
    '展开全部标题层级': 'Expand all headings',
    '摘句与高亮': 'Excerpts and highlights',
    '高亮分布': 'Highlight distribution',
    '查看不同类型高亮的章节分布与手动备注。': 'Review the section distribution of highlight types and manual notes.',
    '当前页面还没有可归类的高亮。': 'This page has no categorized highlights yet.',
    '全部解图': 'Analyze all figures',
    '添加补图': 'Add supplemental figure',
    '目录由网页结构即时生成，不调用 LLM；需要时再逐个解读或提问。': 'The catalog is built from webpage structure without an LLM. Interpret or ask about figures only when needed.',
    '全文缩写表': 'Full abbreviation table',
    '查看全文缩写表': 'View full abbreviation table',
    '通知历史': 'Notification history',
    '查看通知历史': 'View notification history',
    '暂无通知': 'No notifications',
    '仅保留最近 40 条': 'Only the 40 most recent items are kept',
    '自动保存到本机': 'Saved automatically on this device',
    '保存到本地文件夹': 'Save to local folder',
    '扫描本地文件夹恢复工作区': 'Scan local folder to restore workspace',
    '导出': 'Export',
    '解析': 'Parse',
    '等待解析': 'Waiting to parse',
    '取消图解': 'Cancel figure analysis',
    '暂停图解': 'Pause figure analysis',
    '恢复模型原文': 'Restore model output',
    '人工修订': 'Manual revision',
    '保存人工修订': 'Save manual revision',
    '目的': 'Purpose',
    '表型测量': 'Phenotype measurement',
    '图注陈述': 'Caption statement',
    '直接观察': 'Direct observation',
    '实验对照': 'Experimental control',
    '统计比较': 'Statistical comparison',
    '机制推断': 'Mechanistic inference',
    '代表性图像': 'Representative image',
    '定量分析': 'Quantification',
    '定位观察': 'Localization',
    '时间序列': 'Time course',
    '剂量反应': 'Dose response',
    '实验方法': 'Experimental methods',
    '统计学方法': 'Statistical methods',
    '直接观察': 'Direct observation',
    '我的点评': 'My notes',
    '来源': 'Source',
    '类型': 'Type',
    '操作': 'Actions'
    ,'正文未提供': 'Not provided in the article'
    ,'已由正文证据填写': 'Filled from article evidence'
    ,'上次保存失败，已恢复未丢失的编辑并等待重试': 'The previous save failed. Your edits were restored and are waiting to retry.'
    ,'已恢复未保存的编辑，正在重试': 'Unsaved edits restored; retrying now.'
    ,'笔记保存队列已满，请稍后重试': 'The note save queue is full. Please retry shortly.'
    ,'笔记模板保存冲突；草稿已保留，请重新选择模板后重试': 'The note template changed elsewhere. Your draft is retained; select a template again to retry.'
    ,'图注/正文回退': 'Caption/article-text fallback'
    ,'整张 Figure 图片': 'Whole Figure image'
    ,'Panel 裁切图': 'Panel crop'
    ,'重试缺失 Panel': 'Retry missing Panels'
    ,'待补 Panel': 'Missing Panels'
    ,'尚不可识别 Panel': 'Unidentifiable Panels'
    ,'已校验': 'Validated'
    ,'已保存': 'Saved'
    ,'等待保存': 'waiting to be saved'
    ,'个 Panel': 'Panels'
    ,'输入依据': 'Input source'
    ,'正在仅请求缺失 Panel': 'Requesting only missing Panels'
    ,'已校验的 Panel 正在等待保存': 'Validated Panels are waiting to be saved'
    ,'已保存有效 Panel，准备补齐缺失 Panel': 'Validated Panels were saved; preparing missing Panels'
    ,'缺失 Panel 批次已校验，正在保存': 'Missing-Panel batch validated; saving now'
    ,'缺失 Panel 批次已保存': 'Missing-Panel batch saved'
    ,'缺失 Panel 恢复完成': 'Missing-Panel recovery complete'
    ,'当前 Panel 分批已校验，正在保存': 'Current Panel batch validated; saving now'
    ,'当前 Panel 分批已保存，继续下一批': 'Current Panel batch saved; continuing'
    ,'重新运行深度解读以补齐缺失 Panel': 'Rerun deep analysis to fill missing Panels'
    ,'深度解读的缺失 Panel 需要重新运行深度解读': 'Missing Panels in deep analysis require a full deep-analysis rerun.'
    ,'深度解读恢复完成': 'Deep-analysis recovery complete'
    ,'深度解读恢复失败': 'Deep-analysis recovery failed'
    ,'已保留': 'Retained'
    ,'个恢复结果': 'recovered results'
    ,'仍有 Panel 待补': 'Panels still need recovery'
    ,'已完成缺失 Panel': 'Completed missing Panels'
    ,'Figure 状态已变化，请刷新后按当前缺失 Panel 重试。': 'The Figure changed. Refresh and retry only the currently missing Panels.'
    ,'缺失 Panel 重试失败': 'Missing-Panel retry failed'
    ,'尚缺 Panel': 'is missing Panels'
    ,'个有效 Panel，可仅重试缺失项。': 'valid Panels; only missing items need retrying.'
    ,'返回结构未通过校验；已保留通过校验的 Panel，可重试待补项。': 'The response structure failed validation. Validated Panels were retained; retry only missing items.'
    ,'解读失败': 'analysis failed'
    ,'已忽略模型重复返回的': 'Ignored'
    ,'个批次外 Panel': 'out-of-batch Panels returned by the model'
    ,'本批 Figure 解读已取消': 'This Figure analysis batch was cancelled'
    ,'等待前面的 Figure 完成': 'Waiting for preceding Figures'
    ,'已暂停，当前请求结束后不再发送新请求': 'Paused; no new requests will be sent after the current request'
    ,'正在准备图片与正文上下文': 'Preparing image and article context'
    ,'仅使用图注与正文证据': 'Using caption and article-text evidence only'
    ,'正在发送 Figure 请求': 'Sending Figure request'
    ,'模型正在处理这张 Figure': 'The model is processing this Figure'
    ,'已收到模型响应，正在检查返回内容': 'Model response received; checking the response'
    ,'正在校验返回结构': 'Validating response structure'
    ,'正在整理 Figure 解读': 'Assembling Figure analysis'
    ,'Panel 已提取，正在综合整图证据链': 'Panels extracted; synthesizing the whole-Figure evidence chain'
    ,'整图证据链综合完成': 'Whole-Figure evidence-chain synthesis complete'
    ,'返回结构不完整，正在自动修正': 'Response structure incomplete; repairing automatically'
    ,'正在规划 Panel 证据输入': 'Planning Panel evidence inputs'
    ,'Panel 返回结构不完整，正在自动修正': 'Panel response structure incomplete; repairing automatically'
    ,'Panel 请求暂时失败，正在等待自动重试': 'Panel request failed temporarily; waiting to retry automatically'
    ,'正在调整 Panel 输出令牌上限': 'Adjusting the Panel output-token limit'
    ,'正在增加 Panel 输出令牌上限': 'Increasing the Panel output-token limit'
    ,'正在降低 Panel 输入容量': 'Reducing Panel input size'
    ,'Panel 解读已完成': 'Panel analysis complete'
    ,'整图返回不稳定，已切换为 Panel 提取后再综合': 'Whole-Figure response was unstable; switched to Panel extraction followed by synthesis'
    ,'模型已返回，正在读取用量与完成状态': 'Model returned; reading usage and completion status'
    ,'Figure 解读失败': 'Figure analysis failed'
    ,'视觉输入被拒绝，正在改用图注与正文': 'Visual input was rejected; switching to caption and article text'
    ,'请求暂时失败，正在等待自动重试': 'Request failed temporarily; waiting to retry automatically'
    ,'正在调整输出令牌上限后重试': 'Adjusting the output-token limit before retrying'
    ,'正在增加输出令牌后重试': 'Increasing the output-token limit before retrying'
    ,'输出过长，正改用紧凑 JSON 重试': 'Output was too long; retrying with compact JSON'
    ,'正在处理 Figure': 'Processing Figure'
    ,'批次进度': 'Batch progress'
    ,'张': 'Figures'
    ,'预期 Panel': 'Expected Panels'
    ,'个': 'items'
    ,'图注中未识别到可核验的 Panel 标签': 'No verifiable Panel labels were identified in the caption'
    ,'Panel 分批': 'Panel batches'
    ,'已识别': 'Recognized'
    ,'本批有效 Panel': 'Valid Panels in this batch'
    ,'当前有效模型不接收图片；本次仅发送图注与正文证据': 'The active model does not accept images; only caption and article-text evidence was sent'
    ,'视觉请求未被接受，已回退到图注与正文证据': 'The visual request was rejected; fell back to caption and article-text evidence'
    ,'秒后自动重试': 'seconds until automatic retry'
    ,'第': 'attempt'
    ,'次': 'attempts'
    ,'有效路由': 'Effective route'
    ,'能力': 'capability'
    ,'路由回退': 'Route fallback'
    ,'已用时': 'Elapsed'
    ,'秒': 'seconds'
    ,'分': 'minutes'
    ,'保存失败': 'Save failed'
    ,'正在保存…': 'Saving…'
    ,'文献笔记本地保存失败': 'The literature note could not be saved locally.'
    ,'文献笔记保存请求无效': 'The literature-note save request is invalid.'
    ,'文献笔记内容无效或过大': 'The literature-note changes are invalid or too large.'
    ,'当前文献笔记已达到容量上限，请精简后重试': 'This literature note has reached its storage limit. Shorten it and retry.'
    ,'文献笔记本地存储已达到容量上限，请清理后重试': 'Local literature-note storage has reached its limit. Free some space and retry.'
    ,'恢复已进入提交阶段，但页面应用结果无法确认；请勿再次执行恢复。': 'Restore entered the commit stage, but the in-page result could not be confirmed. Do not run restore again.'
    ,'恢复内容已应用，但页面随后发生变化，后续持久化未执行；请勿再次执行恢复。': 'The restored content was applied, but the page then changed and persistence did not run. Do not run restore again.'
    ,'恢复内容已应用，但图解工作区持久化失败；请勿再次执行恢复。': 'The restored content was applied, but the figure workspace could not be persisted. Do not run restore again.'
    ,'恢复内容已应用并已持久化，但恢复回执登记失败；请勿再次执行恢复。': 'The restored content was applied and persisted, but the restore receipt could not be registered. Do not run restore again.'
    ,'恢复内容已应用并已持久化，回执也已登记，但页面在提交后发生变化；请勿再次执行恢复。': 'The restored content was applied and persisted, and its receipt was registered, but the page changed after commit. Do not run restore again.'
    ,'恢复内容已应用，但提交后状态异常；请勿再次执行恢复。': 'The restored content was applied, but its post-commit state is abnormal. Do not run restore again.'
    ,'恢复已进入工作区应用提交阶段，但提交失败且可能已部分写入；请勿再次执行恢复。': 'Restore entered the workspace-application commit stage, but the commit failed and may have written partial state. Do not run restore again.'
    ,'恢复内容已应用并已持久化，但页面随后发生变化，恢复回执尚未登记；请勿再次执行恢复。': 'The restored content was applied and persisted, but the page then changed before the restore receipt was registered. Do not run restore again.'
    ,'基础研究 Article': 'Basic research article'
    ,'临床研究': 'Clinical study'
    ,'系统综述 / Meta-analysis': 'Systematic review / Meta-analysis'
    ,'叙述性综述': 'Narrative review'
    ,'病例报告 / 病例系列': 'Case report / Case series'
    ,'方法学 / Protocol / 资源': 'Methods / Protocol / Resource'
    ,'指南 / 共识': 'Guideline / Consensus'
    ,'科学问题与逻辑子问题': 'Scientific question and logical subquestions'
    ,'实验设计': 'Experimental design'
    ,'重要实验方法': 'Important methods'
    ,'主要发现': 'Main findings'
    ,'研究创新点': 'Research innovations'
    ,'研究局限性': 'Research limitations'
    ,'我可以借鉴的内容': 'Ideas I can reuse'
    ,'待验证问题': 'Open questions'
    ,'P · 研究人群': 'P · Population'
    ,'I · 干预/暴露': 'I · Intervention / exposure'
    ,'C · 对照': 'C · Comparison'
    ,'O · 结局': 'O · Outcomes'
    ,'研究设计': 'Study design'
    ,'入排标准': 'Eligibility criteria'
    ,'主要终点': 'Primary endpoint'
    ,'次要终点': 'Secondary endpoints'
    ,'效应量与置信区间': 'Effect size and confidence interval'
    ,'安全性': 'Safety'
    ,'偏倚风险': 'Risk of bias'
    ,'外推性与临床意义': 'Generalizability and clinical relevance'
    ,'检索问题': 'Review question'
    ,'数据库与检索范围': 'Databases and search scope'
    ,'纳入与排除标准': 'Inclusion and exclusion criteria'
    ,'纳入研究与样本量': 'Included studies and sample size'
    ,'合并效应': 'Pooled effect'
    ,'异质性': 'Heterogeneity'
    ,'敏感性/亚组分析': 'Sensitivity / subgroup analysis'
    ,'证据确定性': 'Certainty of evidence'
    ,'综述局限': 'Review limitations'
    ,'综述范围': 'Review scope'
    ,'主题框架': 'Thematic framework'
    ,'主要共识': 'Main consensus'
    ,'争议与相反证据': 'Controversies and conflicting evidence'
    ,'证据缺口': 'Evidence gaps'
    ,'作者观点': 'Authors’ perspective'
    ,'未来方向': 'Future directions'
    ,'基本情况': 'Patient profile'
    ,'主诉与病程': 'Chief complaint and course'
    ,'诊断过程': 'Diagnostic process'
    ,'鉴别诊断': 'Differential diagnosis'
    ,'干预': 'Intervention'
    ,'结局与随访': 'Outcome and follow-up'
    ,'病例特殊性': 'Case novelty'
    ,'临床启示': 'Clinical lesson'
    ,'方法目标': 'Method goal'
    ,'输入与输出': 'Inputs and outputs'
    ,'关键步骤': 'Key steps'
    ,'关键参数': 'Critical parameters'
    ,'对照与质控': 'Controls and quality control'
    ,'验证指标': 'Validation metrics'
    ,'复现要点': 'Reproducibility notes'
    ,'适用边界与局限': 'Scope and limitations'
    ,'适用人群': 'Target population'
    ,'关键临床问题': 'Key clinical questions'
    ,'核心推荐': 'Core recommendations'
    ,'推荐强度': 'Recommendation strength'
    ,'证据等级': 'Evidence grade'
    ,'例外与禁忌': 'Exceptions and contraindications'
    ,'实施要点': 'Implementation notes'
    ,'更新依据与争议': 'Update triggers and controversies'
  });

  const EN_PATTERNS = Object.freeze([
    [/^文件写入未完成（(.+)），内容仍保存在浏览器中，请重试保存$/u, match => `Files have not been fully written (${match[1]}). Your content remains in the browser; retry saving`],
    [/^本次结果已保存在浏览器，但尚未完整写入所选文件夹。(.+)$/u, match => `Your work is saved in the browser but has not been fully written to the selected folder. ${translateString(match[1], 'en')}`],
    [/^正在核对笔记 (\d+) \/ (\d+)…$/u, match => `Checking notes ${match[1]} / ${match[2]}…`],
    [/^本次生成的笔记已完成一次证据核对，修订 (\d+) 处。$/u, match => `One evidence review of the generated notes is complete; ${match[1]} corrections.`],
    [/^Panel 覆盖待补：(.+)$/u, match => `Panel coverage incomplete: ${match[1]}`],
    [/^Panel 覆盖完整：(.+)$/u, match => `Panel coverage complete: ${match[1]}`],
    // Anchored UI templates only. Captured names, IDs and error details remain
    // verbatim unless the entire detail is an exact known interface string.
    [/^浏览器正在准备本地翻译资源：(\d+)%（需要时下载）$/u,
      match => `Preparing local translation resources: ${match[1]}% (downloaded when needed)`],
    [/^本地翻译失败：(.+)$/u, match => `Local translation failed: ${EN[match[1]] || match[1]}`],
    [/^保存失败：(.+)。草稿仍保留，可重试。$/u,
      match => `Save failed: ${EN[match[1]] || match[1]}. Your draft was retained; you can retry.`],
    [/^解读失败：(.+)$/u, match => `Explanation failed: ${EN[match[1]] || match[1]}`],
    [/^待重新定位 (\d+)$/u, match => `Awaiting relocation: ${match[1]}`],
    [/^附件：(.+)$/u, match => `Attachments: ${match[1]}`],
    [/^移除附件 (.+)$/u, match => `Remove attachment ${match[1]}`],
    [/^附件为空或过大：(.+)$/u, match => `The attachment is empty or too large: ${match[1]}`],
    [/^已获取 (\d+) 个音色；也可手动输入。$/u, match => `${match[1]} voices loaded. You can also enter an ID manually.`],
    [/^已传入 (\d+) 张图片$/u, match => `${match[1]} image${match[1] === '1' ? '' : 's'} sent to the model`],
    [/^未读取图：(.+)$/u, match => `Images not read: ${match[1]}`],
    [/^另有 (\d+) 张图片未传入$/u, match => `${match[1]} additional image${match[1] === '1' ? ' was' : 's were'} not sent`],
    [/^PDF 无法读取：(.+)$/u, match => `Could not read the PDF: ${EN[match[1]] || match[1]}`],
    [/^本轮(联网关闭|联网开启|按需联网)；点击切换联网模式$/u,
      match => `This turn: ${EN[match[1]]}; click to change the web search mode`],
    [/^(联网关闭|联网开启|按需联网)；依次切换关闭、开启、按需。按需模式由模型判断是否需要外部检索。$/u,
      match => `${EN[match[1]]}; cycle through off, on and automatic. In automatic mode, the model decides whether external search is needed.`],
    [/^复制回答：本轮问答$/u, () => 'Copy answer: this turn'],
    [/^补充图位置保存失败：(.+)$/u, match => `Could not save the supplemental Figure position: ${EN[match[1]] || match[1]}`],
    [/^仅解读所选 (\d+) 张 Figure$/u, match => `Analyze only the ${match[1]} selected Figure${match[1] === '1' ? '' : 's'}`],
    [/^解读所选 (\d+) 张$/u, match => `Analyze ${match[1]} selected Figure${match[1] === '1' ? '' : 's'}`],
    [/^；?(\d+) 项资源缺失、(\d+) 项还原限制，快照可能与当前网页存在差异$/u,
      match => `${match[0].startsWith('；') ? '; ' : ''}${match[1]} missing resources and ${match[2]} reproduction limits; the snapshot may differ from the current page`],
    [/^已保存到 Zotero「(.+)」：按原网页排版保留快照，内嵌 (\d+) 张高清原图，图解与全文问答已分别保存为两个子笔记(?:；(\d+) 张 Figure 未能获取原图)?(?:；(\d+) 项资源缺失、(\d+) 项还原限制，快照可能与当前网页存在差异)?$/u,
      match => `Saved to Zotero “${match[1] === '当前文库' ? EN[match[1]] : match[1]}”: snapshot retained with the original page layout and ${match[2]} embedded high-resolution original images. Figure explanations and article Q&A were saved as two separate child notes` +
        (match[3] ? `; original images could not be obtained for ${match[3]} Figure${match[3] === '1' ? '' : 's'}` : '') +
        (match[4] ? `; ${match[4]} missing resource${match[4] === '1' ? '' : 's'} and ${match[5]} reproduction limit${match[5] === '1' ? '' : 's'}; the snapshot may differ from the current page` : '')],
    [/^未能直接导入 Zotero（(.+)）；已下载内嵌 (\d+) 张高清原图的原网页快照 ZIP(?:；(\d+) 项资源缺失、(\d+) 项还原限制，快照可能与当前网页存在差异)?$/u,
      match => `Could not import directly into Zotero (${EN[match[1]] || match[1]}). Downloaded an original-page snapshot ZIP with ${match[2]} embedded high-resolution original images` +
        (match[3] ? `; ${match[3]} missing resource${match[3] === '1' ? '' : 's'} and ${match[4]} reproduction limit${match[4] === '1' ? '' : 's'}; the snapshot may differ from the current page` : '')],
    [/^(.+)（(WORKSPACE_DIRECTORY_[A-Z_]+)）$/u,
      match => `${translateString(match[1], 'en')} (${match[2]})`],
    [/^绑定成功：(.+)。仅打开已同步且通过身份校验的文献目录；绑定不代表文献已同步。$/u,
      match => `Bound: ${match[1] === '当前数据根' ? 'current data root' : match[1]}. Only synced article folders with verified identity can be opened; binding does not mean an article has been synced.`],
    [/^本机助手可用，最近核验已绑定目录：(.+)。$/u,
      match => `Local helper available. Last verified bound folder: ${match[1] === '当前数据根' ? 'current data root' : match[1]}.`],
    [/^打开 (.+) 的文件夹$/u, match => `Open folder for ${match[1]}`],
    [/^正在核验「(.+)」的文献目录…$/u,
      match => `Verifying the article folder for “${match[1]}”…`],
    [/^已请求系统打开「(.+)」的文件夹，请查看文件管理器。$/u,
      match => `Requested the system to open the folder for “${match[1]}”. Check your file manager.`],
    [/^「(.+)」：(.+)$/u,
      match => EN[match[2]] ? `“${match[1]}”: ${EN[match[2]]}` : null],
    [/^复制失败[：:](.+)$/u, match => `Copy failed: ${translateString(match[1], 'en')}`],
    [/^导出失败[：:](.+)$/u, match => `Export failed: ${translateString(match[1], 'en')}`],
    [/^“(.+)”的来源无法安全转换[，,]原文已保留$/u,
      match => `Sources for “${match[1]}” could not be converted safely; the original text was preserved`],
    [/^共 (\d+) 个节点、(\d+) 条候选关系。$/u,
      match => `${match[1]} nodes and ${match[2]} candidate relations.`],
    [/^共 (\d+) 个节点；当前没有候选关系边。$/u,
      match => `${match[1]} nodes; there are currently no candidate relation edges.`],
    [/^预览记录了 (\d+) 个 Panel；下表同时保留未解析和未形成关系的证据。$/u,
      match => `The preview records ${match[1]} Panels; the table also retains unresolved evidence and evidence that did not form a relation.`],
    [/^预览引用了 (\d+) 个 Panel；缺少完整 Panel 处置清单，无法确认是否覆盖全部已读 Panel。$/u,
      match => `The preview references ${match[1]} Panels; without a complete Panel disposition list, full coverage of read Panels cannot be confirmed.`],
    [/^当前范围：(.+) · 文献行会标明已保存内容与未覆盖字段。$/u,
      match => `Current scope: ${translateString(match[1], 'en')} · Each article shows saved content and fields not covered.`],
    [/^当前范围：全局缩略词 · 可检索缩写、全称、中文释义与出现文献。$/u,
      () => 'Current scope: global abbreviations · Search abbreviations, full names, Chinese meanings, and article occurrences.'],
    [/^本机共 (\d+) 篇已保存文献、(\d+) 个全局缩略词。$/u,
      match => `${match[1]} saved article${match[1] === '1' ? '' : 's'} and ${match[2]} global abbreviation${match[2] === '1' ? '' : 's'} on this device.`],
    [/^(.+)可检索覆盖 (\d+) \/ (\d+) 篇；未保存该部分的文献不会产生该范围命中。$/u,
      match => `${translateString(match[1], 'en')} is searchable in ${match[2]} of ${match[3]} articles; articles without that saved field cannot match this scope.`],
    [/^更新 (.+) · 已保存：(.+?)(?: · 未覆盖：(.+))?$/u,
      match => `Updated ${match[1]} · Saved: ${match[2]}${match[3] ? ` · Not covered: ${match[3]}` : ''}`],
    [/^命中范围：(.+)$/u, match => `Matched scope: ${match[1]}`],
    [/^第 (\d+) \/ (\d+) 页 · 共 (\d+) 项$/u,
      match => `Page ${match[1]} of ${match[2]} · ${match[3]} items`],
    [/^(打开)?联网来源 (\d+)：(.+)（([^（）]+)）$/u,
      match => `${match[1] ? 'Open web source' : 'Web source'} ${match[2]}: ${match[3]} (${match[4]})`],
    [/^全文问答发送失败：(.+)$/u,
      match => `Failed to send the full-text question: ${translateString(match[1], 'en')}`],
    [/^模型仍在处理（已等待 (\d+) 秒）$/u,
      match => `The model is still processing (${match[1]} seconds elapsed)`],
    [/^证据单元格：(.+) → (.+)$/u,
      match => `Evidence cell: ${match[1]} → ${match[2]}`],
    [/^编辑 (.+) 到 (.+) 的 Panel 证据$/u,
      match => `Edit Panel evidence from ${match[1]} to ${match[2]}`],
    [/^删除机制节点：(.+)$/u,
      match => `Delete mechanism node: ${match[1]}`],
    [/^机制节点 (\d+)：双击或按 Enter 编辑$/u,
      match => `Mechanism node ${match[1]}: double-click or press Enter to edit`],
    [/^第 (\d+) 个节点 ID 重复。$/u,
      match => `Node ${match[1]} has a duplicate ID.`],
    [/^第 (\d+) 条联系指向无效节点。$/u,
      match => `Link ${match[1]} points to an invalid node.`],
    [/^第 (\d+) 条自反馈必须标记为正反馈或负反馈。$/u,
      match => `Self-loop ${match[1]} must be marked as positive or negative feedback.`],
    [/^第 (\d+) 条联系重复。$/u,
      match => `Link ${match[1]} is duplicated.`],
    [/^第 (\d+) 条联系的第 (\d+) 个 Panel 证据需要重新选择。$/u,
      match => `Panel evidence ${match[2]} on link ${match[1]} must be selected again.`],
    [/^第 (\d+) 条联系的第 (\d+) 个 Panel 证据无法定位。$/u,
      match => `Panel evidence ${match[2]} on link ${match[1]} could not be located.`],
    [/^当前机制网络包含 (\d+) 个未连接子图。$/u,
      match => `The current mechanism network contains ${match[1]} disconnected components.`],
    [/^Panel 证据 (.+) 需要人工选择。$/u,
      match => `Panel evidence ${match[1]} requires manual selection.`],
    [/^Panel 名称：(.+)$/u, match => `Panel name: ${match[1]}`],
    [/^替换 Panel：(.+)$/u, match => `Replace Panel: ${match[1]}`],
    [/^证据类别：(.+)$/u, match => `Evidence class: ${match[1]}`],
    [/^第 (\d+) 条联系（(.+)）$/u,
      match => `Link ${match[1]} (${translateString(match[2], 'en')})`],
    [/^Panel 证据 (.+)；类别：(.+)$/u,
      match => `Panel evidence ${match[1]}; class: ${translateString(match[2], 'en')}`],
    [/^已保存并逐页核验 (\d+) 条批注。$/u,
      match => `Saved and verified ${match[1]} annotations page by page.`],
    [/^已从写入文件重新读取并逐页核验 (\d+) 条批注。$/u,
      match => `Re-read the written file and verified ${match[1]} annotations page by page.`],
    [/^AI 已填写 (\d+) 个空白字段(?:（已复用本地结果）)?$/u,
      match => `AI filled ${match[1]} blank fields${match[0].includes('复用') ? ' (reused local result)' : ''}`],
    [/^AI 已填写 (\d+) 个空白字段；(\d+) 个字段正文未提供；保留 (\d+) 个已有字段(?:；(\d+) 个返回无效)?(?:（已复用本地结果）)?$/u,
      match => `AI filled ${match[1]} blank field${match[1] === '1' ? '' : 's'}; ` +
        `${match[2]} field${match[2] === '1' ? '' : 's'} ` +
        `${match[2] === '1' ? 'was' : 'were'} not provided in the article; ` +
        `preserved ${match[3]} existing field${match[3] === '1' ? '' : 's'}` +
        (match[4] ? `; ${match[4]} invalid result${match[4] === '1' ? '' : 's'}` : '') +
        (match[0].includes('复用') ? ' (reused local result)' : '')],
    [/^文献笔记已自动填写 (\d+) 个字段(?:（已复用本地结果）)?$/u,
      match => `AI filled ${match[1]} literature-note fields${match[0].includes('复用') ? ' (reused local result)' : ''}`],
    [/^逐图解读完成：(\d+) 张 Figure$/u,
      match => `Figure analysis complete: ${match[1]} Figures`],
    [/^当前文献已建立正文索引\s*[·・]\s*(\d+)\s*段$/u, match => `Article indexed · ${match[1]} paragraphs`],
    [/^已激活\s*[·・]\s*PDF 文献$/u, () => 'Active · PDF article'],
    [/^已激活\s*[·・]\s*网页文献$/u, () => 'Active · Web article'],
    [/^已激活\s*[·・]\s*(.+)$/u, match => `Active · ${match[1]}`],
    [/^正在向 LLM 追问…$/u, () => 'Asking the LLM…'],
    [/^本地英译中模型下载中 (\d+)%；点击可取消$/u,
      match => `Downloading the local English-to-Chinese model: ${match[1]}%; click to cancel`],
    [/^Figure 解读失败$/u, () => 'Figure analysis failed'],
    [/^(Extended Data Figure \d+|Figure \d+)\s*[·・]\s*解读失败$/u,
      match => `${match[1]} · failed`],
    [/^自动填写失败：(.+)$/u, match => `Autofill failed: ${match[1]}`],
    [/^文献笔记自动填写失败：(.+)$/u,
      match => `Literature-note autofill failed: ${match[1]}`],
    [/^查看 (.+) 到 (.+) 的联系$/u,
      match => `View relationship from ${match[1]} to ${match[2]}`],
    [/^已从 PDF 原生大纲读取 (\d+) 个标题$/u,
      match => `Read ${match[1]} headings from the native PDF outline`],
    [/^原始 PDF\s*[·・]\s*(\d+) 个标题$/u,
      match => `Original PDF · ${match[1]} headings`],
    [/^正在提取(.+)…$/u, match => `Extracting ${translateString(match[1], 'en').toLowerCase()}…`],
    [/^(.+)提取失败：(.+)$/u,
      match => `${translateString(match[1], 'en')} extraction failed: ${match[2]}`],
    [/^(.+)已部分生成[，,]需人工核验(?:[（(]已复用正文证据缓存[）)])?$/u,
      match => `${translateString(match[1], 'en')} were partially generated and need review${match[0].includes('复用') ? ' (reused article-evidence cache)' : ''}`],
    [/^(.+)已生成$/u, match => `${translateString(match[1], 'en')} generated`],
    [/^(\d+) 条$/u, match => `${match[1]} items`],
    [/^Figure (\d+) · 待解读$/u, match => `Figure ${match[1]} · pending`],
    [/^Extended Data Figure (\d+) · 待解读$/u,
      match => `Extended Data Figure ${match[1]} · pending`]
  ]);

  const textSources = new WeakMap();
  const translatedText = new WeakMap();
  const attributeSources = new WeakMap();
  const additionalTranslations = Object.create(null);
  const additionalPatterns = [...EN_PATTERNS];
  const observedRoots = new Map();
  const languageListeners = new Set();
  let language = 'zh-CN';
  let languageRevision = 0;
  let applying = false;
  let interfaceRoot = null;

  function normalizeLanguage(value) {
    return String(value || '').toLowerCase().startsWith('en') ? 'en' : 'zh-CN';
  }

  const GENERATED_FALLBACKS = Object.freeze({
    missing_evidence: Object.freeze({
      en: 'Not provided in the article',
      'zh-CN': '正文未提供'
    })
  });

  function outputLanguageContract(value) {
    const normalized = normalizeLanguage(value);
    if (normalized === 'en') {
      return [
        'OUTPUT_LANGUAGE_CONTRACT: Write all human-readable natural-language output strings in English.',
        'Keep JSON property names, stable IDs, gene/protein names, abbreviations, equations, numeric values, and verbatim evidence quotes unchanged.',
        'This language contract overrides any earlier instruction to answer in Chinese, but it never overrides the response schema or evidence boundaries.'
      ].join(' ');
    }
    return [
      '输出语言契约：所有面向用户的自然语言输出必须使用简体中文。',
      'JSON 属性名、稳定 ID、基因/蛋白名称、缩略词、公式、数值和逐字证据引文保持不变。',
      '本语言契约覆盖前文要求英文回答的指令，但不覆盖响应结构和证据边界。'
    ].join('');
  }

  function localizeGeneratedFallback(key, value) {
    const normalized = normalizeLanguage(value);
    return GENERATED_FALLBACKS[key]?.[normalized] || String(key || '');
  }

  function applyOutputLanguageContract(request, value) {
    const source = request && typeof request === 'object' ? request : {};
    const contract = outputLanguageContract(value);
    const systemPrompt = String(source.systemPrompt || '').trim();
    return {
      ...source,
      outputLanguage: normalizeLanguage(value),
      systemPrompt: systemPrompt ? `${systemPrompt}\n\n${contract}` : contract
    };
  }

  function translateString(value, targetLanguage = language) {
    if (targetLanguage !== 'en') return String(value || '');
    const input = String(value || '');
    const trimmed = input.trim();
    let translated = additionalTranslations[trimmed] || EN[trimmed];
    if (!translated && trimmed.endsWith('：')) {
      const label = trimmed.slice(0, -1);
      const value = additionalTranslations[label] || EN[label];
      if (value) translated = value + ':';
    }
    if (!translated && /[\u3400-\u9fff]/u.test(trimmed)) {
      for (const [pattern, renderer] of additionalPatterns) {
        if (pattern.brevessRequiredFragments?.some(fragment => !trimmed.includes(fragment))) continue;
        // Long prose uses exact catalog entries or the linear template matcher.
        // Unbounded legacy regular expressions must not process whole documents.
        if (trimmed.length > 4096 && !pattern.brevessLinearTemplate) continue;
        const match = trimmed.match(pattern);
        if (!match) continue;
        translated = renderer(match);
        break;
      }
    }
    if (!translated) return input;
    const start = input.slice(0, input.indexOf(trimmed));
    const end = input.slice(input.indexOf(trimmed) + trimmed.length);
    return `${start}${translated}${end}`;
  }

  // Match literal-delimited placeholders in linear time. Adjacent placeholders
  // have no recoverable boundary, so retain their combined value as one unit.
  // This also prevents user content from being split or normalized by i18n.
  function compileInterfaceTemplate([source, target, translatedArgs = []]) {
    const pieces = String(source).split(/((?:\{\d+\})+)/g);
    const groups = [];
    for (let i = 1; i < pieces.length; i += 2) groups.push(pieces[i]);
    const pattern = {
      brevessLinearTemplate: true,
      brevessRequiredFragments: pieces.filter((_, i) => i % 2 === 0).filter(Boolean),
      [Symbol.match](input) {
        const value = String(input);
        if (!value.startsWith(pieces[0])) return null;
        let cursor = pieces[0].length;
        const match = [value];
        for (let i = 1; i < pieces.length; i += 2) {
          const next = pieces[i + 1];
          const last = i + 2 >= pieces.length;
          const end = last ? (value.endsWith(next) ? value.length - next.length : -1) : value.indexOf(next, cursor);
          if (end < cursor) return null;
          match.push(value.slice(cursor, end));
          cursor = end + next.length;
        }
        return cursor === value.length ? match : null;
      }
    };
    return [pattern, match => {
      const values = new Map();
      groups.forEach((group, index) => {
        const ids = [...group.matchAll(/\{(\d+)\}/g)].map(item => Number(item[1]));
        const raw = match[index + 1] || '';
        const rendered = ids.length === 1 && translatedArgs.includes(ids[0]) ? translateString(raw, 'en') : raw;
        values.set(group, rendered);
      });
      return String(target).replace(/(?:\{\d+\})+/g, group => values.has(group) ? values.get(group)
        : group.replace(/\{\d+\}/g, token => values.get(token) ?? token));
    }];
  }

  // Article content belongs to the document, not the interface dictionary.
  // Exclude entire PDF subtrees, including TextLayers rendered off-DOM.
  const pdfContentSelector = '#pdfNativeViewer, #pdfReaderArticle, .pdf-native-text-layer';
  function pdfContentRoot(node) {
    const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    return element?.closest?.(pdfContentSelector) || null;
  }

  // Explicit boundaries protect article text and user-authored values even
  // when they happen to be identical to a built-in interface label.
  function ignoredContent(node) {
    const element = node?.nodeType === 1 ? node : node?.parentElement;
    return element?.closest?.('[data-i18n-ignore], [translate="no"], [contenteditable="true"]') || null;
  }

  function applyTextNode(node) {
    if (pdfContentRoot(node) || ignoredContent(node) || node.parentElement?.closest?.('script, style, textarea, pre, code')) return;
    // Generated answers contain both prose and controls. Keep prose verbatim;
    // controls opt back in so citation and disclosure labels remain localized.
    const content = node.parentElement?.closest?.('[data-i18n-user-content]');
    if (content && !node.parentElement?.closest?.('button, summary, [data-i18n-interface-text]')) return;
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
    if (ignoredContent(element)) return;
    const contentRoot = pdfContentRoot(element);
    if (contentRoot && contentRoot !== element) return;
    const names = ['placeholder', 'title', 'aria-label', 'alt'];
    let sources = attributeSources.get(element);
    if (!sources) {
      sources = {};
      attributeSources.set(element, sources);
    }
    if (element.hasAttribute('data-i18n-href-en')) {
      if (!('href' in sources)) sources.href = element.getAttribute('href');
      const href = language === 'en' ? element.getAttribute('data-i18n-href-en') : sources.href;
      if (element.getAttribute('href') !== href) element.setAttribute('href', href);
    }
    names.forEach(name => {
      if ((element.getAttribute('data-i18n-ignore-attributes') || '').split(/\s+/u).includes(name)) return;
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

  function applyTree(rootNode = globalThis.document) {
    if (!rootNode || applying || ignoredContent(rootNode)) return;
    if (pdfContentRoot(rootNode)) {
      if (rootNode.nodeType === Node.ELEMENT_NODE) applyAttributes(rootNode);
      return;
    }
    applying = true;
    try {
      const walker = document.createTreeWalker(
        rootNode,
        NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
        { acceptNode(node) {
          if (ignoredContent(node)) return NodeFilter.FILTER_REJECT;
          if (!pdfContentRoot(node)) return NodeFilter.FILTER_ACCEPT;
          if (node.nodeType === Node.ELEMENT_NODE) applyAttributes(node);
          return NodeFilter.FILTER_REJECT;
        } }
      );
      let node = rootNode;
      while (node) {
        if (node.nodeType === Node.TEXT_NODE) applyTextNode(node);
        else if (node.nodeType === Node.ELEMENT_NODE) applyAttributes(node);
        node = walker.nextNode();
      }
      if (rootNode === document && document.documentElement.lang !== language) document.documentElement.lang = language;
    } finally {
      applying = false;
    }
  }

  function observeInterfaceRoot(rootNode) {
    if (!rootNode || typeof MutationObserver !== 'function') return () => {};
    applyTree(rootNode);
    if (observedRoots.has(rootNode)) return observedRoots.get(rootNode).dispose;
    const observer = new MutationObserver(records => {
      if (applying) return;
      records.forEach(record => {
        if (record.target?.isConnected === false) return;
        if (record.type === 'characterData') applyTextNode(record.target);
        // PDF.js moves staged leaves into the live layer and discards older
        // layers. Mutation records can retain obsolete, detached roots.
        record.addedNodes?.forEach(node => {
          if (node.isConnected !== false) applyTree(node);
        });
        if (record.type === 'attributes') applyAttributes(record.target);
      });
    });
    observer.observe(rootNode, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['placeholder', 'title', 'aria-label', 'alt']
    });
    const dispose = () => { observer.disconnect(); observedRoots.delete(rootNode); };
    observedRoots.set(rootNode, { observer, dispose });
    return dispose;
  }

  function setInterfaceLanguage(value, rootNode = globalThis.document) {
    languageRevision++;
    const selected = normalizeLanguage(value);
    const changed = selected !== language;
    language = selected;
    interfaceRoot = rootNode;
    applyTree(rootNode);
    if (rootNode) observeInterfaceRoot(rootNode);
    for (const root of observedRoots.keys()) applyTree(root);
    if (changed) for (const listener of languageListeners) {
      try { listener(language); } catch (_) { /* A view must not block other views. */ }
    }
    return language;
  }

  function registerInterfaceTranslations(entries = {}, patterns = []) {
    Object.assign(additionalTranslations, entries);
    additionalPatterns.push(...patterns);
    // Specific complete messages must precede generic “{value} failed” rules,
    // regardless of which view loaded its catalog first.
    const specificity = pattern => {
      const literal = pattern.brevessRequiredFragments?.join('') || String(pattern.source || '')
        .replace(/\[[^\]]*\]/g, '').replace(/\\[dDsSwWbB]/g, '').replace(/[^\p{L}\p{N} ]/gu, '');
      return (literal.match(/[\u3400-\u9fff]/gu)?.length || 0) * 8 + literal.length;
    };
    additionalPatterns.sort((a, b) => specificity(b[0]) - specificity(a[0]));
    for (const root of observedRoots.keys()) applyTree(root);
  }

  function onInterfaceLanguageChange(listener) {
    languageListeners.add(listener);
    return () => languageListeners.delete(listener);
  }

  // The existing settings key is shared by every extension surface. Reading
  // changes updates open views without persisting translations or new schemas.
  globalThis.chrome?.storage?.onChanged?.addListener?.((changes, area) => {
    if (area !== 'local' || !changes.sciLlmSettingsV2?.newValue?.language) return;
    setInterfaceLanguage(changes.sciLlmSettingsV2.newValue.language, interfaceRoot);
  });

  async function bootstrapInterfaceLanguage(runtime = globalThis.chrome?.runtime, rootNode = globalThis.document) {
    if (!runtime?.sendMessage || typeof document === 'undefined') return language;
    const requestedAt = languageRevision;
    try {
      const response = await runtime.sendMessage({ type: 'LLM_GET_SETTINGS' });
      if (requestedAt !== languageRevision) return language;
      const value = response?.success === false ? null : (response?.data || response);
      const selected = value?.settings?.language || value?.language || 'zh-CN';
      return setInterfaceLanguage(selected, rootNode);
    } catch (_) {
      if (requestedAt !== languageRevision) return language;
      return setInterfaceLanguage('zh-CN', rootNode);
    }
  }

  return {
    INTERFACE_I18N_REVISION: 'r37-en-2',
    INTERFACE_TRANSLATIONS_EN: EN,
    normalizeInterfaceLanguage: normalizeLanguage,
    translateInterfaceText: translateString,
    registerInterfaceTranslations,
    compileInterfaceTemplate,
    applyInterfaceTranslations: applyTree,
    observeInterfaceRoot,
    getInterfaceLanguage: () => language,
    onInterfaceLanguageChange,
    setInterfaceLanguage,
    bootstrapInterfaceLanguage,
    outputLanguageContract,
    localizeGeneratedFallback,
    applyOutputLanguageContract
  };
});
