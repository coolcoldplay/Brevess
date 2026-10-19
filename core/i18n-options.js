(function(root) {
  const api = root.SciLLM || (typeof module === 'object' ? require('./i18n.js') : {});
  // Interface-only literals. Dynamic captures remain verbatim, including names,
  // paper titles, paths and errors supplied by the user or an external service.
  const entries = Object.fromEntries(`
手动填写服务地址、模型名称和鉴权方式。	Enter the service URL, model name and authentication settings manually.
Kimi 官方 OpenAI Chat Completions 接口。	Kimi's official OpenAI Chat Completions API.
智谱开放平台通用 API。	General API for the Zhipu open platform.
火山方舟 OpenAI 兼容 Chat 接口。	Volcengine Ark's OpenAI-compatible Chat API.
阿里云百炼 OpenAI 兼容接口（北京地域）。	Alibaba Cloud Model Studio's OpenAI-compatible API (Beijing region).
腾讯云当前推荐的 TokenHub 接口，需要 TokenHub API Key。	Tencent Cloud's recommended TokenHub API. Requires a TokenHub API key.
适用于已有混元经典 API Key 的账户。	For accounts with an existing Hunyuan Classic API key.
千帆 v2 OpenAI 兼容接口。	Qianfan v2 OpenAI-compatible API.
MiniMax M2.7 OpenAI 兼容文本接口。	MiniMax M2.7 OpenAI-compatible text API.
{0} 篇论文 · {1} 轮问答 · {2} 个 Figure · Token {3}（{4} 次） · {5} · 待同步 {6} · 冲突 {7} · 损坏 {8}	{0} articles · {1} Q&A turns · {2} Figures · Tokens {3} ({4} calls) · {5} · Pending sync {6} · Conflicts {7} · Damaged {8}
将恢复完整模型与分类配置、{0} 篇文献记录和 {1} 条反馈语料。迁移文件中的 API Key 会写入本机扩展存储；迁移文件不包含目录授权，当前浏览器已有的目录授权不会改变。	Restore the complete model and category configuration, {0} article records and {1} feedback records. API keys in the migration file will be written to local extension storage. The file contains no folder permissions, and this browser's existing folder permissions will remain unchanged.
快捷键 {0} 同时分配给：{1}	Shortcut {0} is assigned to multiple actions: {1}
当前配置已被其他窗口删除；未保存草稿已保留。请选择其他配置或放弃草稿后继续。	This profile was deleted in another window. Your unsaved draft is preserved. Select another profile or discard the draft to continue.
图表	Figures
Brevess · 课题工作台	Brevess · Project workbench
课题独立保存在本机；授权目录后可同步项目与素材。	Projects are stored locally. Authorize a folder to synchronize projects and assets.
Brevess · 设置中心	Brevess · Settings
基础阅读无需 AI；模型、本地保存和正文发送许可都可以独立配置。	Basic reading does not require AI. Configure models, local storage and permission to send article text independently.
新增、修改或删除类别，并分别维护 AI 提示词和离线正则规则。	Add, edit or delete categories, with separate AI prompts and offline regular-expression rules.
按阅读目的组织全局类别规则	Organize global category rules by reading purpose
新增、复制、重命名或删除场景，并自由勾选每个场景参与分析的类别。	Add, copy, rename or delete reading modes, and choose the categories used by each mode.
Model Routing · 模型与连接	Model routing · Models and connections
Local storage · 本地保存	Local storage
选择可选的本地镜像目录	Choose an optional local mirror folder
用于离线阅读与手动备份；不配置目录也会继续保存在浏览器本地。	Use it for offline reading and manual backups. Data is still stored in the browser without a folder.
把阅读过程中常用的解析、问答、选区动作和离线正文设置集中到一页。	Configure parsing, Q&A, selection actions and offline article text in one place.
Keyboard · 快捷操作	Keyboard · Shortcuts
用顺手的按键控制论文阅读流程	Use convenient keys throughout your reading workflow
统一设置导航、亮文、摘句、解图和问答等高频动作。	Configure shortcuts for navigation, highlights, excerpts, figure analysis and Q&A.
Local First · 本地数据	Local first · Local data
Project · 关于与反馈	Project · About and feedback
开源许可与问题反馈	Open-source licenses and feedback
查看源代码、第三方许可，并向维护者反馈问题或建议。	View source code and third-party licenses, and send problems or suggestions to the maintainer.
语言设置保存失败：{0}	Could not save the language setting: {0}
有尚未保存的场景修改。	This reading mode has unsaved changes.
本地存储设置已保存。	Local storage settings saved.
阅读工具设置已保存。	Reading tool settings saved.
保存失败：{0}	Save failed: {0}
第 {0} 行网址无效。请填写域名或 HTTP/HTTPS 网址。	Invalid URL on row {0}. Enter a domain or an HTTP/HTTPS URL.
已保存提交的规则；新修改尚未保存。	Submitted rules saved. New changes remain unsaved.
已保存 {0} 条自定义规则。	Saved {0} custom rules.
{0}（当前设置）	{0} (current setting)
本机	Local
可选音色：英文 {0} 个，中文 {1} 个。	Available voices: {0} English, {1} Chinese.
请选择 1–20000 个字符后朗读；超出时请分段选择。	Select 1–20,000 characters to read aloud. Split longer text into smaller selections.
你好，这是选区朗读的简短试听。	Hello. This is a short preview of selected-text narration.
无法返回 PDF 解析结果：{0}	Could not return the PDF parsing result: {0}
操作失败	Operation failed
反向通道已连接。最新状态：{0}；完整事件流：{1}	Return channel connected. Latest status: {0}; complete event stream: {1}
反向通道尚未连接。连接后，解图进度与结果会实时写入本机事件账本。	The return channel is not connected. Once connected, figure-analysis progress and results are recorded in the local event log.
尚未检测到授权完成。若网页已经显示成功，请点击“刷新状态”；否则重新登录。	Authorization is not yet confirmed. If the web page shows success, refresh the status; otherwise sign in again.
已登录{0}；本机桥 {1}	Signed in{0}; local bridge {1}
已打开登录页，正在等待网页授权完成…	Sign-in page opened. Waiting for web authorization…
状态检查失败：{0}	Status check failed: {0}
本机桥 {0}	Local bridge {0}
未检测到官方 Harness 安装；安装并在官方桌面登录后刷新状态。	Official Harness installation not found. Install it, sign in through the official desktop app and refresh the status.
本机桥返回的 Provider 或工具状态不符合要求，请检查安装后重试。	The local bridge returned an unsupported provider or tool state. Check the installation and retry.
检测到官方桌面的保存登录；请使用“测试连接”验证当前模型。	A saved sign-in was found in the official desktop app. Test the connection to verify the current model.
已检测到官方 Harness；尚未检测到保存登录，请在官方桌面登录后刷新状态。	Official Harness found, but no saved sign-in. Sign in through the official desktop app and refresh the status.
Codex 返回了无效的登录地址	Codex returned an invalid sign-in URL
登录页已打开。请在网页完成授权，本页会自动检测结果。	Sign-in page opened. Complete authorization there; this page will detect the result.
无法开始登录：{0}	Could not start sign-in: {0}
已退出。桌面 Codex 和命令行登录不受影响。	Signed out. Desktop and command-line Codex sessions are unaffected.
退出失败：{0}	Sign-out failed: {0}
未启用 LLM	LLM disabled
已跳过	Skipped
已确认	Confirmed
基础连接已验证	Basic connection verified
连接已配置，待验证	Connection configured; verification pending
已选择（未连接）	Selected (not connected)
未选模型	No model selected
查看目录	View directory
本地保存目录已配置；浏览器授权失效时可稍后重新授权。	Local folder configured. You can authorize it again if browser permission expires.
已暂时跳过；插件仍会使用 IndexedDB 保存本机工作副本。	Skipped for now. The extension still stores a local working copy in IndexedDB.
请选择目录，或暂时跳过后继续。目录选择只会由你的点击触发。	Choose a folder or skip for now. A folder picker opens only when you click.
API 配置已保存；请在模型与连接页分别测试连接和所需能力。	API configuration saved. Test the connection and required capabilities on the Models and connections page.
已暂时跳过；导航、手动高亮和本地阅读功能仍可使用。	Skipped for now. Navigation, manual highlighting and local reading remain available.
保存至少一个 API 配置并同意发送内容，或暂时跳过。	Save at least one API profile and allow content to be sent, or skip for now.
配置 LLM API	Configure an LLM API
本地文件夹是可选项。暂时跳过后仍使用浏览器 IndexedDB 保存本机工作副本，也可正常使用导航、阅读与手动标注。	A local folder is optional. If skipped, the browser still stores a working copy in IndexedDB; navigation, reading and manual annotation remain available.
API 是问答、图解和智能高亮所需的可选项。暂时不配置也能直接使用导航、摘句、手动高亮与本地阅读，之后可随时回来设置。	An API is optional and enables Q&A, figure analysis and intelligent highlighting. Navigation, excerpts, manual highlights and local reading work without it. You can configure it later.
暂不选择，继续	Skip folder selection and continue
暂不配置，直接使用	Skip configuration and start reading
无法读取引导状态：{0}	Could not read setup status: {0}
无法重新打开新手引导：{0}	Could not reopen setup: {0}
无法保存跳过状态：{0}	Could not save the skipped step: {0}
无法继续 API 配置：{0}	Could not continue API configuration: {0}
原论文标签页已关闭；引导已完成，可从任意论文页再次点击插件图标。	The original article tab is closed. Setup is complete; click the extension icon on any article page.
无法返回原论文页面：{0}	Could not return to the original article: {0}
当前浏览器不支持目录选择，请使用“导出 JSON 备份”保存本地数据。	This browser does not support folder selection. Use Export JSON backup to save local data.
无法读取已保存的目录授权，请重新选择目录。JSON 备份仍可使用。	Could not read the saved folder authorization. Select the folder again. JSON backups remain available.
当前数据根	Current data root
已授权	Authorized
需要授权	Authorization required
权限被拒绝	Permission denied
权限未知	Permission unknown
当前口令至少需要 10 个字符。	The current passphrase must contain at least 10 characters.
口令至少需要 10 个字符。	The passphrase must contain at least 10 characters.
两次输入的口令不一致。	The passphrases do not match.
加密配置尚未就绪，请先创建或解锁配置备份。	Encrypted configuration is not ready. Create or unlock a configuration backup first.
口令不正确或备份无法解密。	Incorrect passphrase or the backup could not be decrypted.
所选目录已有配置备份，请改为解锁后再继续。	The selected folder already contains a configuration backup. Unlock it to continue.
当前目录不可用，请恢复目录授权后重试。	The current folder is unavailable. Restore folder authorization and retry.
当前浏览器无法使用安全加密功能。	Secure encryption is unavailable in this browser.
配置备份已损坏或版本不兼容，已停止同步。	The configuration backup is damaged or incompatible. Synchronization stopped.
无法完成加密配置操作，请稍后重试。	Could not complete the encrypted configuration operation. Try again later.
已加密	Encrypted
待创建	Not created
待解锁	Locked
目录不可用	Folder unavailable
同步失败	Sync failed
配置凭据已加密保存，可在受信任设备上用口令恢复。	Configuration credentials are encrypted and can be restored with the passphrase on a trusted device.
配置备份待创建；创建完成前不会同步当前默认配置。	Create a configuration backup before synchronizing current defaults.
配置备份待解锁；解锁完成前不会同步当前默认配置。	Unlock the configuration backup before synchronizing current defaults.
目录不可用，已停止配置同步。	Folder unavailable. Configuration synchronization stopped.
配置备份同步失败，已安全停止。	Configuration backup synchronization failed and stopped safely.
暂时无法确认加密配置状态。	Could not confirm encrypted configuration status.
{0} 请检查目录状态后重试。	{0} Check the folder status and retry.
创建加密备份	Create encrypted backup
创建加密配置备份	Create encrypted configuration backup
设置一个至少 10 个字符的口令。遗忘口令后无法恢复密文凭据。	Set a passphrase with at least 10 characters. Encrypted credentials cannot be recovered if you forget it.
新口令	New passphrase
创建并继续	Create and continue
输入该目录的口令。解锁成功后会先恢复设置，再继续目录同步。	Enter this folder’s passphrase. Unlocking restores settings before folder synchronization resumes.
解锁并恢复	Unlock and restore
更换配置备份口令	Change configuration backup passphrase
输入当前口令与新口令。新口令至少需要 10 个字符。	Enter the current and new passphrases. The new one must contain at least 10 characters.
请先完成加密配置备份，再同步或重建目录。	Complete the encrypted configuration backup before synchronizing or rebuilding the folder.
上次同步未完成：{0}	Previous synchronization incomplete: {0}
读取本地数据状态失败，请稍后重试。	Could not read local data status. Try again later.
配置备份待创建。	Configuration backup has not been created.
配置备份待解锁。	Configuration backup is locked.
配置备份已解锁、恢复设置并完成目录同步。	Configuration backup unlocked, settings restored and folder synchronization completed.
加密配置尚未就绪，已停止后续操作。	Encrypted configuration is not ready. Further operations stopped.
加密配置备份已创建并完成目录同步。	Encrypted configuration backup created and folder synchronization completed.
加密配置备份已解锁、恢复设置并完成目录同步。	Encrypted backup unlocked, settings restored and folder synchronization completed.
当前浏览器不支持目录选择，请使用 JSON 备份下载。	This browser does not support folder selection. Download a JSON backup instead.
解锁	Unlock
目录已保存，配置备份待{0}；完成前不会同步。	Folder saved. Configuration backup action pending: {0}. Synchronization will wait.
目录已保存，但加密配置状态异常；已安全停止同步。	Folder saved, but encrypted configuration status is invalid. Synchronization stopped safely.
目录已保存，加密配置已就绪并完成本地数据同步。	Folder saved, encrypted configuration ready and local data synchronized.
已取消选择，现有目录设置没有改变。	Selection cancelled. Existing folder settings are unchanged.
选择目录失败：{0}	Folder selection failed: {0}
口令未更换；加密配置尚未就绪。	Passphrase unchanged. Encrypted configuration is not ready.
加密配置备份口令已更换。	Encrypted configuration backup passphrase changed.
确定遗忘本机保存的配置密钥吗？密文备份会保留，但下次使用必须重新输入口令。	Forget the configuration key saved on this device? The encrypted backup remains, but you must enter the passphrase next time.
本机密钥已遗忘，但无法确认配置备份状态。请恢复目录授权后重试。	Local key forgotten, but backup status could not be confirmed. Restore folder authorization and retry.
本机密钥已遗忘，但配置备份状态尚未确认。请检查目录后重试。	Local key forgotten, but backup status is unconfirmed. Check the folder and retry.
本机密钥已遗忘；配置备份现在处于待解锁状态。	Local key forgotten. The configuration backup is now locked.
加密配置备份已更新。	Encrypted configuration backup updated.
无法读取已保存的目录授权，请重新选择目录。	Could not read saved folder authorization. Select the folder again.
目录授权未通过，你仍可以导出 JSON 备份。	Folder authorization was not granted. You can still export a JSON backup.
目录权限已恢复，加密配置已就绪并完成同步。	Folder permission restored, encrypted configuration ready and synchronization complete.
目录权限已恢复，但配置备份仍待创建或解锁。	Folder permission restored. The configuration backup still needs to be created or unlocked.
目录权限已恢复，但加密配置状态异常；已停止同步。	Folder permission restored, but encrypted configuration status is invalid. Synchronization stopped.
重新授权失败：{0}	Reauthorization failed: {0}
同步已停止	Synchronization stopped
目录需要重新授权后才能同步。	Authorize the folder again before synchronizing.
同步完成：写入 {0} 项。	Synchronization complete: {0} items written.
同步失败：{0}	Synchronization failed: {0}
重建已停止	Rebuild stopped
重建完成：导入 {0} 项，跳过 {1} 项旧版本。	Rebuild complete: imported {0} items and skipped {1} older versions.
重建失败：{0}	Rebuild failed: {0}
JSON 备份已导出。	JSON backup exported.
导出备份失败：{0}	Backup export failed: {0}
暂无记录	No records yet
本地论文	Local article
已同步	Synchronized
有冲突	Conflict
正文已变化	Article text changed
待清除	Pending deletion
仅本机	Local only
查看各功能与模型 Token	View tokens by feature and model
这篇论文还没有已记录的 LLM Token 消耗。	No LLM token usage has been recorded for this article.
输入 {0} ·	Input {0} ·
输出 {0} ·	Output {0} ·
{0} 次	{0} calls
含 {0} 次估算	Includes {0} estimates
选择 {0}	Select {0}
占用 {0}	Storage {0}
访问	Accessed
修改	Modified
离线阅读	Offline reading
扫描并恢复	Scan and restore
清除	Clear
第 {0} / {1} 页	Page {0} / {1}
没有匹配标题或 DOI 的论文工作区。	No article workspaces match this title or DOI.
还没有本地论文工作区。打开论文并激活插件后会自动建立。	No local article workspaces yet. Open an article and activate the extension to create one.
{0} 篇论文 ·	{0} articles ·
{0} 轮问答 ·	{0} Q&A turns ·
{0} 个 Figure ·	{0} figures ·
Token {0}（{1} 次） ·	Tokens {0} ({1} calls) ·
待同步 {0} ·	Pending sync {0} ·
冲突 {0} ·	Conflicts {0} ·
损坏 {0}	Damaged {0}
读取工作区超时，请刷新后重试。	Workspace read timed out. Refresh and retry.
读取论文工作区失败：{0}	Could not read article workspaces: {0}
确认清除 {0} 篇论文的本地工作区吗？{1}	Clear local workspaces for {0} articles? {1}
将删除 {0} 轮问答、{1} 个 Figure、	This deletes {0} Q&A turns, {1} figures,
{0} 个 Panel，共约 {1}。此操作不可撤销。	{0} panels, approximately {1} in total. This cannot be undone.
工作区列表已更新，请重试。	The workspace list changed. Retry.
已清除 {0} 篇；{1} 篇清除失败，{2} 篇待清除。{3}	Cleared {0}; failed {1}; pending {2}. {3}
已清除 {0} 篇；{1} 篇等待目录重新授权后完成。	Cleared {0}; {1} will finish after folder reauthorization.
已清除 {0} 篇本机工作区；{1} 篇目录副本因未授权暂未删除，但已永久屏蔽，不会被扫描恢复。	Cleared {0} local workspaces. {1} folder copies could not be deleted without authorization; they are permanently excluded from scan recovery.
已清除 {0} 篇论文工作区。	Cleared {0} article workspaces.
清除失败：{0}	Clear failed: {0}
该论文没有可用的离线正文快照	No offline article snapshot is available
已打开离线阅读：“{0}”。	Opened offline article: “{0}”.
已导出“{0}”。	Exported “{0}”.
已从本地文件恢复“{0}”，读取	Restored “{0}” from local files; read
{0} 个内容文件。	{0} content files.
需要重新授权本地保存目录后才能扫描恢复。	Authorize the local folder again before scanning for recovery.
本地保存目录中没有找到匹配的论文工作区。	No matching article workspace was found in the local folder.
操作失败：{0}	Operation failed: {0}
完整迁移文件已导出。文件含 API Key，请妥善保管。	Full migration file exported. It contains API keys; store it securely.
导出迁移文件失败：{0}	Migration export failed: {0}
迁移文件超过允许大小	Migration file exceeds the size limit
将恢复完整模型与分类配置、{0} 篇文献记录和 {1} 条反馈语料。	This restores model and category settings, {0} article records and {1} feedback records.
迁移文件中的 API Key 会写入本机扩展存储；迁移文件不包含目录授权，	API keys in the migration file will be written to local extension storage. Folder authorization is not included;
当前浏览器已有的目录授权不会改变。	existing browser folder authorization remains unchanged.
无法读取迁移文件：{0}	Could not read migration file: {0}
当前本地目录授权保持不变。	Current local folder authorization is unchanged.
当前本地目录记录已保留；如浏览器要求，请重新授权。	The current local folder record is preserved. Reauthorize if the browser requests it.
迁移文件不包含目录授权，请选择本地保存目录。	The migration file excludes folder authorization. Select a local storage folder.
迁移完成：恢复 {0} 篇文献记录和	Migration complete: restored {0} article records and
{0} 条反馈。{1}	{0} feedback records. {1}
导入迁移文件失败：{0}	Migration import failed: {0}
没有找到匹配的类别。可尝试类别名称或英文 ID。	No matching categories. Try a category name or English ID.
规则	Rules
已加载本地修改	Local changes loaded
当前使用内置规则	Using built-in rules
读取失败：{0}	Read failed: {0}
已本地修改	Modified locally
自定义类别	Custom category
永久删除这个内置类别	Permanently delete this built-in category
永久删除这个自定义类别	Permanently delete this custom category
有尚未保存的修改	Unsaved changes
已导出本类别的 AI 提示词与正则模块	AI prompt and regex module exported for this category
不是有效的类别模块文件	Invalid category module file
已导入草稿；保存类别规则后会重新生成提示词预览。	Draft imported. Saving category rules will regenerate the prompt preview.
已导入模块草稿，请检查后点击“保存类别规则”	Module draft imported. Review it and save the category rules.
导入失败：{0}	Import failed: {0}
类别规则已保存在本机	Category rules saved locally
已恢复内置规则	Built-in rules restored
恢复失败：{0}	Restore failed: {0}
{0} 条匹配{1}；测试未保存规则	{0} matches{1}; testing did not save the rules
（仅显示前 100 条）	(first 100 shown)
测试失败：{0}	Test failed: {0}
没有匹配到内容。	No matches found.
仅显示前 100 条匹配	Showing the first 100 matches
读取设置失败：{0}	Could not read settings: {0}
MinerU Token 已保存在本机	MinerU token saved locally
精准解析需要 Token	Precise parsing requires a token
MinerU Token 已清除；PDF 仍可使用轻量解析。	MinerU token cleared. Lightweight PDF parsing remains available.
PDF 解析设置已保存；下次激活 PDF 标签页会自动使用。	PDF parsing settings saved. They will apply when a PDF tab is next activated.
PDF 解析设置保存失败：{0}	Could not save PDF parsing settings: {0}
{0} 篇文档 · {1} 条反馈	{0} documents · {1} feedback records
读取失败	Read failed
本地语料库还是空的，请先在论文页反馈一些 LLM 高亮。	The local corpus is empty. Submit feedback on LLM highlights in an article first.
已导出 {0} 语料。	Exported {0} corpus.
暂时没有达到阈值的离线规则；同一短语需在至少 3 篇不同文档中获得正向确认。	No offline rules meet the threshold. The same phrase needs positive confirmation in at least 3 different documents.
已生成 {0} 类离线规则，可在插件弹窗中导入。	Generated offline rules for {0} categories. Import them in the extension popup.
生成规则失败：{0}	Rule generation failed: {0}
还没有自定义类别。	No custom categories yet.
仅本次会话	This session only
请填写自定义类别的名称和识别定义。	Enter a name and detection definition for the custom category.
自定义识别类别已添加，并已默认勾选。	Custom detection category added and selected by default.
添加类别失败：{0}	Could not add category: {0}
确认永久删除{0}类别“	Permanently delete the {0} category “
内置	Built-in
{0}”吗？	{0}”?
删除后将不再参与正则、LLM 或手动标注；已有标注会保留类别快照。	It will no longer be used for regex, LLM or manual annotation. Existing annotations retain their category snapshot.
{0}识别类别已永久删除。	{0} detection category permanently deleted.
删除类别失败：{0}	Could not delete category: {0}
删除失败：{0}	Delete failed: {0}
尚无可用类别	No available categories
可新建或恢复	Create or restore a category
请新建类别，或在页面下方恢复已删除的内置类别	Create a category or restore a deleted built-in category below
内置识别类别已恢复。	Built-in detection category restored.
恢复类别失败：{0}	Could not restore category: {0}
请填写 Base URL	Enter a Base URL
Base URL 格式不正确	Invalid Base URL format
未授予服务商域名访问权限	Provider domain access was not granted
高亮：LLM	Highlights: LLM
高亮：正则	Highlights: Regex
{0} · LLM 已配置	{0} · LLM configured
{0} · LLM 功能未就绪	{0} · LLM not ready
{0}快捷键	{0} shortcut
只支持单个英文字母或数字。	Use one English letter or digit.
快捷键已修改，尚未保存。	Shortcut changed but not saved.
快捷键 {0} 同时分配给：	Shortcut {0} is assigned to:
已保存提交的快捷键；当前仍有未保存修改。	Submitted shortcuts saved. Current changes remain unsaved.
快捷键已保存，侧栏立即按新设置响应。	Shortcuts saved. The sidebar uses them immediately.
已填入默认快捷键，点击“保存快捷键”后生效。	Default shortcuts filled in. Save shortcuts to apply them.
例如：统计方法	For example: Statistical methods
说明模型需要围绕这个 Panel 回答什么	Describe what the model should answer about this panel
尚未设置 Panel 追问；可新增任意名称和提示词。	No panel follow-ups configured. Add a name and prompt.
例如：核心结论	For example: Core conclusion
插入输入框后仍可继续编辑	You can edit it after insertion into the input field
删除快捷提示词{0}	Delete quick prompt {0}
删除快捷提示词	Delete quick prompt
尚未设置快捷提示词；可点击“新增提示词”创建。	No quick prompts yet. Add a prompt to create one.
复制类别失败：{0}	Could not copy category: {0}
说明 AI 应从文章中提取什么、如何组织；没有证据时留空。	Explain what AI should extract from the article and how to organize it; leave empty when evidence is missing.
多行输入	Multiline input
模板名称	Template name
至少保留一个文献笔记模板	Keep at least one literature note template
未命名模板	Untitled template
尚未设置文献笔记模板；可新增自定义模板。	No literature note templates configured. Add a custom template.
按钮名称	Button name
在选区工具条显示	Show in the selection toolbar
发送到全文问答的提示词	Prompt sent to full-text Q&A
尚未设置选中文段后的分析动作。	No analysis actions configured for selected passages.
{0} 个类别 · {1}	{0} categories · {1}
恢复内置场景“{0}”的默认名称、说明和类别组合？	Restore the default name, description and categories of built-in mode “{0}”?
删除阅读场景“{0}”？类别规则与历史高亮不会被删除。	Delete reading mode “{0}”? Category rules and existing highlights will remain.
读取模型	Read models
选择官方本机模型	Select an official local model
本机目录	Local directory
获取目录	Fetch directory
内置候选	Built-in candidates
手填 ID	Manual ID
候选模型（{0}）	Candidate models ({0})
无匹配候选，手填 ID 保持不变	No matching candidates; manual ID is unchanged
暂无候选，可手填 ID	No candidates; enter an ID manually
使用官方 Harness 桌面登录	Use official Harness desktop sign-in
使用本机 Codex 登录	Use local Codex sign-in
Key 已保存	Key saved
开启推理	Enable reasoning
关闭推理	Disable reasoning
当前服务商以开启/关闭方式控制推理；“自动”沿用服务商默认。	This provider controls reasoning with an on/off switch. Auto uses the provider default.
推理越强通常更慢；插件只向明确支持的模型发送该参数。	Stronger reasoning is usually slower. This parameter is sent only to models that explicitly support it.
估算输入	Estimated input
实测输入	Measured input
· 结构化推理通过	· Structured reasoning passed
· 结构化推理失败（连接正常）	· Structured reasoning failed (connection available)
· 结构化推理失败	· Structured reasoning failed
· 结构化推理已跳过（当前配置不支持）	· Structured reasoning skipped (unsupported configuration)
· 当前配置不支持结构化推理	· This configuration does not support structured reasoning
· 当前能力设置已阻止结构化推理	· Current capability settings block structured reasoning
· 探针 {0}/{1} 通过	· Probes passed {0}/{1}
，{0} 跳过	, {0} skipped
，{0} 项不支持	, {0} unsupported
，{0} 项已阻止	, {0} blocked
· {0} 项兼容性警告	· {0} compatibility warnings
（基础连接仍可用）	(basic connection remains available)
基础文本	Basic text
图片输入	Image input
结构化推理	Structured reasoning
通过	Passed
跳过	Skipped
不支持	Unsupported
已阻止	Blocked
未测试	Not tested
等待结果	Awaiting results
连接成功：	Connection successful:
基础连接成功，但视觉工作流兼容性检查未通过：	Basic connection successful, but visual workflow compatibility checks failed:
基础连接成功，但工作流兼容性检查未通过：	Basic connection successful, but workflow compatibility checks failed:
基础连接尚未验证：	Basic connection not verified:
填写 API Key 后可联网获取当前账号可用模型；模型 ID 仍可手动输入。	Enter an API key to fetch available models for this account. Model IDs can still be entered manually.
已载入 {0} 个缓存目录模型；目录不代表能力验证。	Loaded {0} cached directory models. A directory entry does not verify capabilities.
服务商没有返回可用模型	The provider returned no available models
已读取 {0} 个官方本机模型；当前登录可用性请使用“测试连接”验证。	Read {0} official local models. Test the connection to verify the current sign-in.
已从服务商获取 {0} 个目录模型；调用与能力请单独测试。	Fetched {0} directory models. Test calls and capabilities separately.
自动获取失败	Automatic retrieval failed
获取模型失败	Model retrieval failed
{0}：{1}。仍可手动输入模型 ID。	{0}: {1}. You can still enter a model ID manually.
配置名称不能为空。	Profile name cannot be empty.
配置名称已保存。	Profile name saved.
保存配置名称失败：{0}	Could not save profile name: {0}
官方 Harness 登录已失效或无权限，请在官方桌面重新登录后测试	Official Harness sign-in expired or lacks permission. Sign in again in the official desktop app and test.
API Key 无效或无权限	API key is invalid or lacks permission
请求过于频繁，请稍后重试	Too many requests. Try again later
API 额度不足	Insufficient API quota
服务商拒绝了模型列表请求	The provider rejected the model-list request
连接测试等待超时，请稍后重试	Connection test timed out. Try again later
请求已取消	Request cancelled
无法访问服务商，请检查域名权限和网络	Cannot reach the provider. Check domain permissions and the network
服务商返回了无法识别的格式	The provider returned an unrecognized format
未找到本机 Codex，请先安装 Codex	Local Codex not found. Install Codex first
插件专用 Codex 会话未登录或已过期，请点击本页“登录 / 重新登录”	The extension’s Codex session is signed out or expired. Use Sign in / Sign in again on this page
本机 Codex 桥未安装、未注册或已断开	Local Codex bridge is not installed, registered or connected
本机 Codex 拒绝了这次请求；请查看登录状态后重新测试	Local Codex rejected this request. Check sign-in status and test again
未找到官方 Harness，请先安装并在官方桌面登录	Official Harness not found. Install it and sign in through the official desktop app
官方 Harness 尚未保存登录或登录已失效，请在官方桌面登录后重试	Official Harness has no valid saved sign-in. Sign in through the official desktop app and retry
本机 Harness 桥不可用，请检查安装和注册状态	Local Harness bridge unavailable. Check installation and registration
当前 Harness 登录未提供所选模型，请刷新模型目录后重试	The selected model is unavailable for this Harness sign-in. Refresh the model directory and retry
当前官方 Harness 版本与本机桥不兼容，请更新 Brevess 配套组件	The official Harness version is incompatible with the local bridge. Update the Brevess companion component
浏览器连接的 Windows 配套组件版本过旧，不支持 Harness。请安装 R26 或更新版本的 Windows 配套组件，重新加载扩展后刷新状态。	The connected Windows companion component is too old for Harness. Install R26 or later, reload the extension and refresh the status.
本机 Harness 返回格式异常，请重新测试连接	Local Harness returned an invalid format. Test the connection again
请选择官方 Harness 提供的模型	Select a model provided by official Harness
所选 Harness 模型不支持图片，请选择支持图片的模型	The selected Harness model does not support images. Choose one that does
当前 Harness 请求触发了未启用的工具，请重新测试连接	This Harness request invoked a disabled tool. Test the connection again
Harness 输出达到长度上限，请缩小任务范围后重试	Harness output reached its length limit. Reduce the task scope and retry
Harness 模型请求失败，请测试连接后重试	Harness model request failed. Test the connection and retry
Harness 在请求完成前退出，请重新测试连接	Harness exited before completing the request. Test the connection again
当前模型服务暂时不可用，请稍后重试。	The model service is temporarily unavailable. Try again later.
当前 Codex 上下文不足以容纳这次请求	The current Codex context cannot fit this request
内容不完整或规则不安全：{0}	Incomplete content or unsafe rules: {0}
本地数据库模块不可用，请重新加载扩展后重试	Local database module unavailable. Reload the extension and retry
浏览器本地数据库不可用，请检查隐私设置后重试	Browser local database unavailable. Check privacy settings and retry
无法打开浏览器本地数据库，请重新加载扩展后重试	Cannot open browser local database. Reload the extension and retry
本地数据库正在被旧页面占用，请关闭其他插件设置页后重试	An older page is using the local database. Close other extension settings pages and retry
连接到了网页而不是 API；请检查校园网认证、代理/VPN、杀毒软件拦截或 Base URL	The connection reached a web page instead of an API. Check network authentication, proxy/VPN, antivirus filtering or Base URL
配置已保存	Profile saved
目录读取中	Reading directory
目录已获取 · {0} 项	Directory fetched · {0} entries
可读取目录，也可手填 ID	Fetch the directory or enter an ID manually
已选择 · {0}	Selected · {0}
请选择或填写模型 ID	Select or enter a model ID
尚未验证；保存与读取目录不代表模型可用	Not verified. Saving or fetching a directory does not confirm model availability
配置已修改，之前的结果已过期	Configuration changed. Previous results are outdated
测试中，等待各项结果	Testing; awaiting individual results
基础连接通过，部分能力未通过	Basic connection passed; some capabilities failed
测试未通过，请查看错误并重试	Test failed. Review the error and retry
联网搜索	Web search
未验证	Not verified
未测试；须按接入路径验证	Not tested; verify through the configured connection
邮箱已复制。	Email address copied.
复制未完成；可选中邮箱后手动复制。	Copy did not complete. Select the email address and copy it manually.
接入配置已修改，请重新读取目录；仍可使用手填模型 ID。	Connection settings changed. Fetch the directory again; manual model IDs remain available.
当前 Profile 有未保存修改，是否放弃并继续？	This profile has unsaved changes. Discard them and continue?
{0}（请先保存或取消{1}）	{0} (save or cancel {1} first)
尚未创建 API Profile	No API profiles created
常用服务商	Common providers
国内模型服务商	Chinese model providers
其他接口	Other APIs
已保存 {0}；留空保持不变	Saved {0}; leave empty to keep it
API Profile 已新增。	API profile added.
新增 Profile 失败：{0}	Could not add profile: {0}
API Profile 已复制。	API profile copied.
复制 Profile 失败：{0}	Could not copy profile: {0}
API Profile 已删除。	API profile deleted.
删除 Profile 失败：{0}	Could not delete profile: {0}
已保存提交的设置；当前仍有未保存修改。	Submitted settings saved. Current changes remain unsaved.
模型与路由设置已保存。	Model and routing settings saved.
配置已保存；请确认正文发送许可和模型连接状态。	Configuration saved. Check permission to send article text and the model connection.
连接失败：{0}	Connection failed: {0}
测试已结束；配置已变更，本次结果未应用。请对当前配置重新测试。	Test finished, but the configuration changed. Results were not applied. Test the current configuration again.
全文	Full text
文献雷达检索式（全局默认）	Literature radar queries (global default)
条检索式	queries
TypeSafe Jev（文本判定）	TypeSafe Jev (text classification)
内置候选 · {0}	Built-in candidate · {0}
{0} · 本机	{0} · Local
未记录	Not recorded
模块切换	Switch module
进入解图模块	Open figure analysis
打开导航模块	Open navigation
打开摘句模块	Open excerpts
打开问答模块	Open Q&A
导出与本地工作区	Exports and local workspaces
扫描本地并修复	Scan local files and repair
保存至本地	Save locally
删除本地该网页内容	Delete local content for this page
解图模块	Figure analysis
折叠所有 Figure Panel	Collapse all figure panels
已选择（未连接） · {0}	Selected (not connected) · {0}
方法	Methods
图注	Captions
查看	View
打开本机保存的网页，断网也可查看	Open the locally saved page, including when offline
尚未保存离线网页；在线原文需要网络和访问权限	No offline page saved. The online article requires network access and permission
最近一次保存不完整；查看将打开之前保留的离线网页	The latest save is incomplete. View opens the previous retained offline page
已保存离线网页与阅读图片	Offline page and reading images saved
离线网页部分资源未保存，请联网重新保存	Some offline resources were not saved. Connect to the network and save again
已有离线网页；旧快照的图片与样式完整度未记录	An offline page exists. Image and style completeness was not recorded for this older snapshot
直接检索已保存工作区。所有统计和搜索均在本机完成，不调用模型，也不上传正文。	Search saved workspaces directly. All statistics and searches run locally, without model calls or uploading article text.
新增缩略词	Add abbreviation
搜索已保存文献	Search saved articles
搜索本地库	Search local library
文献搜索范围	Article search scope
编辑文献标签	Edit article tags
搜索标题、笔记或已保存正文	Search titles, notes or saved text
搜索缩写、全称、中文或文献	Search abbreviations, full names, Chinese definitions or articles
按标签筛选	Filter by tags
添加标签筛选	Add tag filter
选择标签…	Choose a tag…
匹配方式	Match mode
标签匹配方式	Tag match mode
任一标签	Any tag
全部标签	All tags
清除标签筛选	Clear tag filter
当前标签筛选	Current tag filter
移除筛选标签 {0}	Remove filter tag {0}
暂无标签，可在文献行添加	No tags yet. Add one in an article row
工作区身份无效，请刷新文献列表。	Invalid workspace identity. Refresh the article list.
工作区版本已改变，请关闭编辑区并刷新文献列表。	The workspace version changed. Close the editor and refresh the article list.
标签资产版本信息无效	Invalid tag asset version information
没有可校验的标签保存基线	No verifiable baseline for saving tags
标签未能保存	Could not save tags
保存回执无法校验，请读取最新标签确认。	The save receipt could not be verified. Read the latest tags to confirm.
请先保存或关闭当前文献的标签草稿，再编辑另一篇。	Save or close the current article’s tag draft before editing another article.
文献标签 · {0}	Article tags · {0}
未命名文献	Untitled article
Enter 添加标签；移除只影响本篇文献。最多 32 个，每个最多 80 字。	Press Enter to add a tag. Removal affects only this article. Up to 32 tags, each up to 80 characters.
新文献标签	New article tag
输入标签，按 Enter 添加	Enter a tag and press Enter
有未保存的标签修改。	Unsaved tag changes.
标签无效：最多 32 个，每个 1–80 字，不能包含换行或控制字符。输入已保留。	Invalid tags: up to 32, each 1–80 characters, without line breaks or control characters. Your input is preserved.
保存标签	Save tags
标签已保存到本机并已同步到目录。	Tags saved locally and synchronized to the folder.
标签已保存到本机；{0}。	Tags saved locally; {0}.
目录同步未完成（{0}）	Folder synchronization incomplete ({0})
目录同步排队中	Folder synchronization queued
目录尚未同步	Folder not yet synchronized
标签保存冲突：另一页面已更新。草稿保留，请读取最新标签后明确选择重新编辑。	Tag save conflict: another page updated the tags. Your draft is preserved. Read the latest tags and explicitly choose to edit again.
保存未确认：{0}。草稿保留，请读取最新标签后重新编辑。	Save unconfirmed: {0}. Your draft is preserved. Read the latest tags and edit again.
放弃当前文献未保存的标签草稿？	Discard the unsaved tag draft for this article?
读取最新标签	Read latest tags
上次未保存草稿（保留供复制，不会自动覆盖新版本）	Previous unsaved draft (kept for copying; will not overwrite the new version)
上次未保存标签草稿	Previous unsaved tag draft
移除文献标签 {0}	Remove article tag {0}
已读取本机标签。	Local tags loaded.
本篇尚无标签。	This article has no tags.
最新标签：{0}	Latest tags: {0}
采用最新标签，重新编辑	Use latest tags and edit again
已采用最新标签；可重新增删后保存。	Latest tags adopted. Make changes and save again.
当前草稿仍保留。请核对最新标签，再选择是否重新编辑。	Your draft is still preserved. Check the latest tags, then choose whether to edit again.
标签无法校验：{0}。禁止覆盖，已有草稿保留。	Tags cannot be verified: {0}. Overwriting is blocked; your draft is preserved.
词库中已经有相同的缩写与全称。	This abbreviation and full name already exist in the dictionary.
该缩略词已被删除，请刷新后重试。	This abbreviation was deleted. Refresh and retry.
请检查缩写、全称和中文释义。	Check the abbreviation, full name and Chinese definition.
缩略词保存失败	Could not save abbreviation
编辑 {0}	Edit {0}
中文释义（可选）	Chinese definition (optional)
在阅读文献时隐藏（仍保留在词库中）	Hide while reading articles (keep in the dictionary)
已保存：{0}	Saved: {0}
仅标题	Title only
· 未覆盖：{0}	· Not covered: {0}
标签异常 · 查看	Tag issue · View
编辑标签	Edit tags
管理	Manage
编辑 {0} 的标签	Edit tags for {0}
打开 {0} 的文件夹	Open folder for {0}
{0} 个来源 · 笔记与批注分别保留	{0} sources · Notes and annotations are kept separately
PDF 原文	PDF source
HTML 网页	HTML page
来源未记录	Source not recorded
标签：{0}	Tags: {0}
没有同时匹配关键词、范围与标签的文献。可分别调整这些条件。	No articles match the keyword, scope and tags together. Adjust these conditions independently.
没有符合当前标签条件的文献。可切换任一/全部标签，或清除标签筛选。	No articles match these tags. Switch between any/all tags, or clear the tag filter.
已保存文献列表，窄屏可左右滚动查看四列	Saved article list. Scroll horizontally on narrow screens to view all four columns
已保存文献：论文标题、发表日期、杂志名称和保存时间	Saved articles: title, publication date, journal and saved time
论文标题	Article title
发表日期	Publication date
杂志名称	Journal
保存时间	Saved time
最近一次点击保存且完整存入本机的时间；不代表目录同步完成。未记录时不以页面更新时间替代	Time of the most recent complete local save; does not confirm folder synchronization. Page update time is not used when no save time is recorded
出版社页面	Publisher page
DOI 注册记录提供的出版社链接；网页可用性由出版社决定	Publisher link from the DOI registry. Page availability is controlled by the publisher
来源标签汇总	Source tag summary
文献标签	Article tags
本地内容与命中片段	Local content and matching excerpts
命中	Match
（封面日期）	(cover date)
没有匹配的全局缩略词。	No matching global abbreviations.
全称	Full name
文献	Articles
次数	Count
详情	Details
{0} 在阅读文献时显示	Show {0} while reading articles
关联读取失败	Could not read associations
：{0} 次	: {0} occurrences
{0} / {1} · {2} 篇	{0} / {1} · {2} articles
尚未在已保存正文或图注中出现。	Not yet found in saved article text or captions.
关联读取失败：{0}	Could not read associations: {0}
从全局词库删除 {0}？	Delete {0} from the global dictionary?
第 {0} / {1} 页 · 共 {2} 项	Page {0} / {1} · {2} items
本地库读取失败	Could not read local library
当前匹配覆盖 {0} / {1} 篇；	Current matches cover {0} / {1} articles;
全库{0}可检索覆盖 {1} / {2} 篇；	Library search coverage for {0}: {1} / {2} articles;
未保存该部分的文献不会产生该范围命中。	Articles without this saved section cannot produce matches in this scope.
匹配 {0} 篇文献 · 全库 {1} 篇。	Matched {0} articles · {1} in the library.
本机共 {0} 篇已保存文献、{1} 个全局缩略词。	This device has {0} saved articles and {1} global abbreviations.
本地库读取失败：{0}	Could not read local library: {0}
`.trim().split('\n').map(line => line.split('\t')));
  const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = Object.entries(entries).filter(([key]) => /\{\d+\}/.test(key))
    .sort(([a], [b]) => b.replace(/\{\d+\}/g, '').length - a.replace(/\{\d+\}/g, '').length)
    .map(([key, translated]) => {
    const indexes = []; let pattern = '', cursor = 0;
    for (const match of key.matchAll(/\{(\d+)\}/g)) {
      pattern += escape(key.slice(cursor, match.index)) + '([\\s\\S]*?)'; indexes.push(match[1]); cursor = match.index + match[0].length;
    }
    pattern += escape(key.slice(cursor));
    const expression = new RegExp('^' + pattern + '$', 'u');
    expression.brevessRequiredFragments = key.split(/\{\d+\}/g).filter(Boolean);
    return [expression, match => {
      const captures = Object.fromEntries(indexes.map((id, index) => [id, match[index + 1]]));
      return translated.replace(/\{(\d+)\}/g, (_, id) => captures[id] ?? '');
    }];
  });
  api.registerInterfaceTranslations?.(entries, patterns);
  if (typeof module === 'object' && module.exports) module.exports = { entries, patterns };
})(globalThis);
