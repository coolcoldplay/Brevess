# Microsoft Edge Add-ons 商店文案

适用版本：Brevess 1.0.1
建议类别：Productivity / 生产力
定价：免费
支持语言：中文（简体）、English

## 中文（简体）

### 产品名称

Brevess

### 简短说明

在 Edge 侧栏中导航科研论文、提取缩写、按规则或 LLM 高亮证据、解读 Figure/Panel，并围绕当前全文连续问答。

### 单一用途

帮助用户在当前打开的科研论文网页中定位结构、识别和标注证据、理解图表，并基于原文进行可追溯的阅读问答。

### 详细说明

Brevess 是一个面向科研论文网页的 Edge 侧栏阅读工具。点击浏览器工具栏图标后，插件只处理当前激活的论文页面，并把导航、高亮、摘句、Figure/Panel 解读和全文问答集中在同一个侧栏工作区中。

主要功能：

- 论文导航：从当前网页的本地 HTML 中提取摘要、引言、结果、讨论、方法、参考文献、补充材料等结构，点击标题或段落即可跳转原文。
- 缩写表：在本机提取正文中明确给出的“全称（缩写）”或“缩写（全称）”定义，按字母排序；点击词条可跳转到首次出现位置。
- 证据高亮：提供可编辑的离线正则规则与可选 LLM 分析。自动结果使用彩色下划线，手动标注使用荧光高亮；类别、备注、白名单和黑名单均可在本机管理。
- 多分析模式：可为不同阅读任务组织独立类别，并在切换模式后保留已有高亮。
- 摘句与高亮分布：按章节和类别查看高亮位置，点击分布单元格可返回对应原文。
- Figure 与 Panel 解读：按 Figure 或 Panel 查看目的、设计、比较、直接观察、局部推论和证据边界，并保留多轮 Panel 追问历史。
- 全文问答：基于当前论文建立本地索引，支持多轮问答、章节限定、来源标记、原文跳转和自然语言“查找并高亮”。
- 本地工作区：问答、高亮、Figure/Panel 结果和使用量记录保存在浏览器 IndexedDB；用户也可以明确选择一个本地目录进行备份、恢复、导入和导出。
- Token 使用量：按论文、功能、模型和 Provider 查看本机记录的输入、输出及总 Token。

无需 LLM 也可以使用论文导航、缩写表、手动高亮和离线正则高亮。LLM 功能采用“用户自带 Provider”模式：用户自行配置兼容服务或可选的本机 Codex Bridge，并在首次发送正文前明确同意。API Key 仅保存在本机扩展存储中，不会写入导出文件、诊断包或日志。

重要说明：

- 插件不会自动处理浏览历史；只有用户点击工具栏图标激活的当前页面才会进入阅读工作区。
- 使用第三方 LLM 时，当前论文的必要正文、图注或图片以及用户问题会发送到用户选择的服务。数据处理条款和保留政策由该服务商决定。
- 本机 Codex Bridge 是可选的 Windows 辅助程序，不是使用本地导航、正则或手动标注的前提。
- 本工具用于辅助阅读与证据整理，不提供医疗诊断、治疗建议或替代专业判断。

### 搜索词（最多 7 个）

1. 论文阅读
2. 科研阅读
3. 文献高亮
4. 全文问答
5. 论文导航
6. Figure解读
7. 证据提取

## English

### Product name

Brevess

### Short description

Navigate scientific papers, extract abbreviations, highlight evidence with rules or an LLM, interpret figures and panels, and ask grounded full-text questions in the Edge sidebar.

### Single purpose

Help users navigate, annotate, and understand evidence in the scientific paper that is currently open in Microsoft Edge.

### Long description

Brevess is an Edge sidebar workspace for reading scientific papers on the web. After the user clicks the toolbar icon, the extension works only with the active paper page and brings navigation, evidence highlighting, excerpts, Figure/Panel interpretation, and grounded full-text Q&A into one reading workspace.

Key capabilities:

- Paper navigation: extracts the local HTML structure of the current article, including Abstract, Introduction, Results, Discussion, Methods, References, and supplementary sections. Headings and paragraphs link back to the source.
- Abbreviation table: locally extracts explicit long-form/short-form definitions, sorts them alphabetically, and jumps to the first source occurrence.
- Evidence highlighting: combines editable offline regular-expression rules with optional LLM analysis. Automatic matches use colored underlines; manual annotations use fluorescent highlights and support categories, notes, allowlists, and blocklists.
- Reading modes: organizes category sets for different analysis goals and preserves existing highlights when modes are changed.
- Evidence map: groups highlights by section and category and links every available cell back to the article.
- Figure and Panel interpretation: presents purpose, design, comparison, direct observation, local inference, and claim boundaries, with persistent multi-turn Panel follow-ups.
- Full-text Q&A: builds a local index of the current paper and supports multi-turn answers, section-scoped questions, verified source markers, source jumps, and natural-language “find and highlight”.
- Local workspaces: stores questions, annotations, Figure/Panel results, and usage records in browser IndexedDB. Users may explicitly choose a local folder for backup, restore, import, and export.
- Token usage: shows locally recorded input, output, and total token counts by paper, feature, provider, and model.

Navigation, abbreviation extraction, manual highlighting, and offline rule highlighting do not require an LLM. Optional LLM features use a bring-your-own-provider model. The user configures a compatible provider or the optional local Codex Bridge and must explicitly consent before article content is sent. API keys stay in local extension storage and are excluded from exports, diagnostics, caches, and logs.

Important:

- The extension does not automatically process browsing history. It handles only the current page after the user activates it.
- When a third-party LLM is selected, the required article text, captions or images, and the user’s question are sent to that provider. The provider’s own terms and retention policy apply.
- The Windows Codex Bridge is optional and is not required for local navigation, rule matching, or manual annotations.
- Brevess supports reading and evidence organization; it does not provide medical diagnosis or treatment advice.

### Search terms (maximum 7)

1. scientific paper
2. paper reader
3. evidence highlight
4. full text Q&A
5. paper navigation
6. figure analysis
7. research reading

## URLs to enter

- Website: `https://github.com/coolcoldplay/Brevess`
- Support: `https://github.com/coolcoldplay/Brevess/issues`
- Privacy policy: `https://coolcoldplay.github.io/Brevess/privacy-policy.html`
- Reviewer demo: `https://coolcoldplay.github.io/Brevess/reviewer-demo.html`

Do not submit until every URL above returns HTTP 200 without requiring a login.
