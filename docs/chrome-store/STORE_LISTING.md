# Chrome Web Store 商店文案

准备日期：2026-11-17。定位已确认：免费扩展、用户自备 AI API Key、中英文界面。以下文字对应 1.0.2；不要沿用旧 Edge 1.0.1 文案。后台名称来自实际上传的 manifest，以发布包为准。

## 基本字段

- 名称：BREVESS（跟随当前源码 manifest，不在后台另造名称）。
- 默认语言：简体中文；另添加 English 本地化。
- 分类建议：Productivity / Tools；以后台当日可选分类为准。
- 官网：https://coolcoldplay.github.io/Brevess/
- 支持：https://github.com/coolcoldplay/Brevess/issues
- 联系邮箱：brevess0729@163.com（沿用现有产品联系方式，提交前确认仍有人接收）。
- 隐私：https://coolcoldplay.github.io/Brevess/privacy-policy.html（须先更新为本次版本）。
- 收费说明：扩展免费；外部模型、语音、文献数据库服务按各自条款收费，BREVESS 不包含 API 额度。

## 中文简介

在浏览器侧栏中导航论文、按规则或 LLM 高亮证据、解读 Figure/Panel，并基于全文连续问答。

## 中文详细说明（可粘贴）

BREVESS 是面向科研论文阅读的浏览器扩展。围绕同一篇文献，把章节导航、证据标注、图表阅读、基于全文的问答与本地资料整理放在一个工作流程中。

无需 AI API Key 即可开始：
• 根据论文结构生成章节导航，跳转原文。
• 使用本地正则规则高亮证据，手工添加标注与备注。
• 阅读 PDF 原页，建立本地文字索引。
• 在本地文献库与研究工作台整理资料、假说和组图方案。

配置自己的模型服务后，可按需使用正文分析、Figure/Panel 解读、全文问答、语义查找和模型翻译。AI 结果仅辅助阅读，仍需核对论文原文。扩展不提供共享 API Key，也不包含模型额度；第三方可能另行收费。

阅读辅助还包括网页双语阅读、选区朗读和可配置的页面过滤。文献雷达可按用户设置检索并定时检查所选文献来源；部分来源需要单独的 API 或机构授权。

数据与隐私：设置、标注、文献记录和工作台资料默认保存在本机，也可写入用户选择的目录。轻量页面脚本为快捷键、划词、翻译入口与本地过滤初始化；完整论文工作区针对选定文档激活。启用 AI 内容发送后，任务需要的文本、图注、图片或问题会发送至用户选择的服务。PDF 增强识别会把 PDF 或网址发送至 MinerU；语音和文献检索使用各自配置的服务。关闭 AI 正文发送不会同时关闭这些独立功能。详情见隐私政策。

支持中文和 English 界面。部分能力取决于网页结构、PDF 文本层、浏览器版本及所选服务。可选本机伴侣需另外安装；云协作账号不在本次版本中提供。

## English short description

Navigate papers, highlight evidence, interpret figures and panels, and ask full-text questions in the browser sidebar.

## English detailed description (paste-ready)

BREVESS helps you read scientific papers with article navigation, evidence annotations, figure exploration, source-based questions and a local research workspace.

Start without an AI API key:
• Navigate paper sections and jump to the source.
• Highlight evidence with local rules and add manual notes.
• Read original PDF pages and build a local text index.
• Organize papers, hypotheses and figure plans in your local workspace.

Configure your own model provider to use optional text analysis, Figure/Panel interpretation, full-text Q&A, semantic search and model translation. AI output is a reading aid and can be incorrect; check the original paper. The extension is free and does not include API credits. Third-party services may charge separately.

Reading tools include bilingual web reading, selected-text speech and configurable page filters. Literature radar can search and periodically check the sources you choose; some sources require separate API or institutional access.

Settings, annotations, library and workbench data are stored locally by default, with an optional user-selected folder. Lightweight scripts initialize shortcuts, selection/translation controls and configured local page filters; the full paper workspace is activated for the selected document. With AI content transmission enabled, necessary text, captions, images or questions go to your chosen provider. PDF enhancement sends a PDF or its URL to MinerU. Speech and literature searches use their separately configured services. Disabling AI article transmission does not disable these independent features. See the privacy policy for details.

Chinese and English interfaces are available. Features depend on page structure, PDF text layers, browser support and service availability. Optional local companion software is installed separately. Developer-hosted cloud collaboration accounts are not included in this release.

## 不应写入的宣传承诺

不写“完全离线”“所有数据永不离开本机”“零数据处理”“免费无限 AI”“无需任何 API 即可完整 AI 解图”“所有网站均支持”“已通过 Google 审核”。未验证的付费服务、原生伴侣和云协作不作为首发卖点。
