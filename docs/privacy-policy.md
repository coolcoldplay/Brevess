# Brevess Privacy Policy / 隐私政策

**Effective date / 生效日期：2026-07-28**
**Applies to / 适用产品：Brevess Microsoft Edge 扩展**

Brevess helps users read and analyze scientific article pages in Microsoft Edge.
It provides local article navigation, abbreviation extraction, rule-based and
manual highlighting, Figure/Panel organization, optional model-assisted
analysis, full-text Q&A, and local article workspaces.

Brevess 用于在 Microsoft Edge 中阅读和分析科研论文网页，提供本地论文导航、缩写提取、
正则与手动高亮、Figure/Panel 整理、可选的模型辅助分析、全文问答及本地论文工作区。

## 1. Data handled / 处理的数据

Brevess may handle the following data only to provide features requested by the
user:

- **Current article page data:** URL, title, DOI when available, headings,
  article text, captions, Figure images or image URLs, and page structure. The
  extension does not continuously monitor browsing; page extraction starts
  after the user activates Brevess for the current tab.
- **User-created content:** analysis-mode choices, category rules, highlights,
  notes, questions, chat history, Figure/Panel follow-ups, feedback examples,
  and export preferences.
- **Configuration and authentication data:** model-provider settings and API
  keys entered by the user. API keys are stored in the extension's local
  storage and are sent only to the endpoint selected by the user for
  authentication. Brevess does not operate a developer server that receives
  these keys.
- **Local usage records:** per-article model, feature, and token-usage totals,
  task status, cache metadata, and diagnostic error messages. These records
  remain on the user's device unless the user exports them.
- **Optional local integrations:** a user-selected folder, a loopback Zotero
  Connector endpoint, and the separately installed Windows Local Codex bridge.

Brevess 仅为提供用户主动使用的功能而处理以下数据：

- **当前论文网页数据：**网址、标题、DOI（如有）、标题层级、正文、图注、Figure 图片或
  图片地址及页面结构。扩展不会持续监控浏览活动；只有用户在当前标签页激活 Brevess 后
  才开始提取。
- **用户创建的内容：**分析模式、类别规则、高亮、备注、问题、问答历史、Panel 追问、
  反馈示例及导出偏好。
- **配置与鉴权数据：**用户填写的模型服务配置和 API Key。API Key 保存在扩展本地存储中，
  仅作为鉴权信息发送给用户选择的服务地址；Brevess 不运营接收这些 Key 的开发者服务器。
- **本地使用记录：**按论文、功能和模型统计的 Token、任务状态、缓存元数据和诊断错误。
  除非用户主动导出，否则这些记录留在本机。
- **可选本地集成：**用户选择的本地文件夹、回环地址上的 Zotero Connector，以及另行安装
  的 Windows 本机 Codex 桥。

## 2. Storage and retention / 存储与保留

Settings and article workspaces are stored locally using Microsoft Edge
extension storage, IndexedDB, and—only when selected by the user—the local
folder chosen through the File System Access API. Brevess does not upload a
copy to a developer-operated cloud service.

Local data remains until the user deletes the relevant article workspace,
clears extension data, removes files from the selected folder, or uninstalls the
extension. Files explicitly exported or saved to a user-selected folder can
remain after uninstallation. Optional Local Codex bridge data under
`%LOCALAPPDATA%\SCIReaderCodexBridge` remains until the user removes it.

设置和论文工作区保存在 Microsoft Edge 扩展本地存储、IndexedDB，以及用户主动选择的
本地文件夹中。Brevess 不会把副本上传到开发者运营的云端。

数据会保留到用户删除相应论文工作区、清除扩展数据、删除所选目录文件或卸载扩展为止。
用户明确导出或写入自选目录的文件可能在卸载扩展后继续存在。可选本机 Codex 桥位于
`%LOCALAPPDATA%\SCIReaderCodexBridge` 的数据会保留到用户自行删除。

## 3. Data transmission and third parties / 数据传输与第三方

Model-assisted features are disabled until the user configures a provider and
grants the in-extension permission to send article content. Depending on the
task, Brevess may send the necessary article excerpts, captions, compressed
Figure images, questions, and limited conversation context directly to the
provider or compatible endpoint selected by the user. Provider availability,
retention, billing, and processing are governed by that provider's terms and
privacy policy.

Supported routes can include OpenAI, Anthropic, Google Gemini, DeepSeek,
OpenAI-compatible services configured by the user, or the optional Local Codex
bridge. Custom remote endpoints must use HTTPS. Plain HTTP is permitted only
for explicit loopback addresses (`localhost` or `127.0.0.1`), such as a local
model service or Zotero Connector.

The Local Codex bridge is a separate, optional Windows companion. It exchanges
messages only with approved extension IDs on the same device and uses the
user's extension-specific Codex sign-in. Codex processing is subject to the
terms applicable to the user's Codex account.

只有在用户配置模型并勾选“正文发送许可”后，模型辅助功能才会启用。根据任务需要，
Brevess 可能把必要的论文片段、图注、压缩后的 Figure 图片、问题和有限对话上下文直接
发送至用户选择的模型服务或兼容地址。服务可用性、数据保留、计费和处理规则由相应服务商
的条款和隐私政策决定。

可选路由包括 OpenAI、Anthropic、Google Gemini、DeepSeek、用户配置的
OpenAI-compatible 服务或本机 Codex 桥。远程自定义地址必须使用 HTTPS；只有用户明确
配置的本机回环地址（`localhost` 或 `127.0.0.1`）可以使用 HTTP，例如本地模型服务或
Zotero Connector。

本机 Codex 桥是单独安装的可选 Windows 组件，只与同一设备上获准的扩展 ID 通信，并
使用插件专用 Codex 登录。Codex 的处理适用用户 Codex 账户对应的条款。

## 4. User controls / 用户控制

Users can:

- use local navigation, abbreviation extraction, regular-expression
  highlighting, manual annotations, and local workspaces without enabling an
  external model;
- revoke model content sharing by clearing **Permission to send article text**
  and saving model settings;
- choose, edit, test, or remove provider profiles;
- delete individual article workspaces, clear highlights or chats, export data,
  and clear extension storage;
- avoid selecting a local folder or disconnect optional local integrations.

用户可以：

- 不启用外部模型，直接使用本地导航、缩写提取、正则高亮、手动标注和本地工作区；
- 取消勾选“正文发送许可”并保存，从而停止向模型发送正文；
- 选择、修改、测试或删除模型配置；
- 删除单篇论文工作区、清除高亮或问答、导出数据及清理扩展存储；
- 不选择本地目录，或不启用任何可选本地集成。

## 5. No sale, advertising, or developer analytics / 不出售、无广告、无开发者遥测

Brevess does not sell, license, broker, or use user data for advertising,
creditworthiness, or unrelated profiling. It contains no advertising SDK and
does not send product analytics or browsing telemetry to the developer.

Brevess 不出售、许可、经纪或利用用户数据投放广告、评估信用或进行无关画像；不包含广告
SDK，也不会向开发者发送产品分析或浏览遥测。

## 6. Security / 安全

Remote model requests use HTTPS, except for explicit loopback services on the
user's own device. API keys are kept in local extension storage, masked in the
interface after saving, and excluded from normal article exports and token
reports. No storage system can be guaranteed absolutely secure; users should
protect their Edge profile, API credentials, exported files, and selected local
folders.

远程模型请求使用 HTTPS，本机回环服务除外。API Key 保存在扩展本地存储中，保存后在界面
中隐藏，并从常规论文导出和 Token 报告中排除。任何存储方式都不能保证绝对安全，用户应
保护自己的 Edge 配置文件、API 凭据、导出文件和所选本地文件夹。

## 7. Sensitive information and intended use / 敏感信息与用途

Brevess is a research reading aid, not a medical device and not a substitute
for clinical, legal, or professional advice. Users should not submit private,
identifiable patient data or other confidential information to third-party
model services unless they are authorized to do so and the selected provider is
appropriate for that use.

Brevess 是科研阅读辅助工具，不是医疗器械，也不能替代临床、法律或其他专业判断。除非
用户具备相应授权且所选服务适合该用途，否则不应向第三方模型提交可识别患者身份的数据或
其他机密信息。

## 8. Children / 儿童

Brevess is intended for researchers, students, and professional readers. It is
not directed to children under 13 and does not knowingly collect children's
personal information.

## 9. Changes / 政策变更

Material changes will be published at this URL with a new effective date and,
when appropriate, called out in release notes. Continued use after an update is
subject to the updated policy.

重大变更会在本页面更新生效日期，并在适当情况下写入版本说明。

## 10. Contact / 联系方式

- Email: [brevess0729@163.com](mailto:brevess0729@163.com)
- Issues: <https://github.com/coolcoldplay/Brevess/issues>
- Source: <https://github.com/coolcoldplay/Brevess>
