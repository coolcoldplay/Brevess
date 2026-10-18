# Partner Center 隐私页填写稿

适用版本：Brevess 1.0.1

## Single Purpose Description

帮助用户在当前打开的科研论文网页中定位结构、识别和标注证据、理解 Figure/Panel，并基于原文进行可追溯的阅读问答。插件只在用户点击工具栏图标激活当前页面后工作。

English:

Help users navigate, annotate, and understand evidence in the scientific paper currently open in Microsoft Edge. The extension works on the active page only after the user clicks its toolbar icon.

## Permission justification

| 权限 | 可粘贴的说明 |
|---|---|
| `activeTab` | 用户点击插件图标后，临时访问当前标签页，以确认页面、激活论文工作区并把侧栏操作限定到用户明确选择的网页。 |
| `storage` | 在本机保存设置、分析模式、规则、用户同意状态、可选 API Profile/API Key、文章工作区索引、标注及 Token 使用量。API 凭据不会进入普通导出或诊断包；用户主动启用便携配置备份时，只会以口令保护的认证密文写入所选目录。 |
| `unlimitedStorage` | 解除浏览器对扩展本地存储的默认容量配额，仅用于保存用户主动创建或保留的大体积论文笔记、标注及其本地文章工作区。该权限不会用于后台扫描网页或自动上传数据，不扩大任何 host/network 网络权限。用户仍可删除单篇工作区、清空本机数据或卸载扩展；数据只保留到用户执行这些删除操作为止。 |
| `scripting` | 仅在用户激活的当前论文页注入内容脚本，用于读取可见论文 HTML、生成导航、绘制/编辑高亮以及跳转原文。 |
| `offscreen` | 在 Manifest V3 后台 Service Worker 可能休眠时，使用扩展自带的离屏文档完成用户发起的流式模型网络请求；不用于播放媒体、跟踪或执行远程代码。 |
| `sidePanel` | 在 Microsoft Edge 原生侧栏中提供论文导航、高亮、摘句、解图和全文问答工作区。 |
| `nativeMessaging` | 连接用户主动安装并登录的可选本机 Codex Bridge。该权限不自动安装软件；未安装 Bridge 时，本地导航、正则和手动标注仍可使用。 |
| `https://*/*` | 科研论文和用户自选的兼容 LLM Provider 可能位于不同 HTTPS 域名。访问只发生于用户激活的论文页或用户发起的 Provider 请求。 |
| `http://localhost/*` | 支持用户在本机运行的兼容 LLM 服务；只允许回环主机。 |
| `http://127.0.0.1/*` | 支持用户在本机运行的兼容 LLM 服务；只允许 IPv4 回环地址。 |

## Remote code

选择：**No / 否**。

可粘贴说明：

扩展包不下载、注入或执行任何远程 JavaScript、WebAssembly 或可执行代码。所有可执行代码和字体均随 ZIP 提交。可选 LLM 服务只返回文本/JSON 数据，返回内容经过结构和证据校验后以文本节点渲染，不作为代码执行。用户可编辑的正则表达式是本地数据规则，不是远程代码。

## Data usage disclosure

准确披露以下数据类型：

1. **Website content / 网站内容**
   当前激活论文的正文、标题、章节、图注和用户明确请求分析的 Figure 图片。
2. **User-provided content / 用户提供的内容**
   问题、备注、规则、白名单、黑名单、模型配置及手动选择的文本。
3. **Authentication information / 身份验证信息**
   用户自行填写的 Provider API Key，或本机 Codex Bridge 的本地会话状态。API Key 默认保存在扩展本地存储；用户启用便携配置备份后，也会以认证密文写入用户选择的本地文件夹。
4. **Website identifiers / 网站标识信息**
   当前论文 URL、canonical URL、DOI 和标题，用于区分本机文章工作区及恢复跳转。
5. **Product interaction and diagnostics / 产品交互与诊断**
   本机 Token 用量、任务状态、错误信息和用户主动导出的诊断包。没有远程分析或广告 SDK。

不要声明插件收集完整浏览历史。插件不在后台扫描用户访问过的网页，只处理用户激活的当前页面。

## How the data is used

- 提供用户请求的论文导航、证据标注、Figure/Panel 解读和全文问答。
- 在本机恢复文章工作区、计算 Token 使用量和诊断错误。
- 不出售数据，不投放广告，不建立跨站画像，不进行信用、保险、就业或医疗资格判断。
- 数据不会为与用户所请求功能无关的目的共享。

## Transmission and consent

- 本地导航、缩写、正则和手动高亮不发送正文到第三方。
- 只有用户保存了可用 Provider、勾选正文发送许可并主动运行 LLM 功能时，才会把完成请求所必需的正文、图注、图片或问题发给该 Provider。
- 第三方 Provider 的保留和训练政策由用户与 Provider 之间的条款决定。
- 除用户明确配置的回环地址外，网络请求使用 HTTPS。
- 用户可在设置中撤回许可、删除 API Profile、清空本机工作区或卸载扩展。

## Storage and retention

- 默认：`chrome.storage.local` 与 IndexedDB。
- 可选：用户通过系统目录选择器授权的本地 `Brevess` 文件夹。
- 保留期限：直到用户删除对应工作区、清空数据、删除本地文件或卸载扩展。
- 用户启用便携配置备份后，模型/API 设置（包括 API Key 和自定义鉴权头）与全局缩略词表只以 AES-GCM 认证密文写入主文件 `Brevess/settings/portable-config.enc.json`；成功更新后，最多保留一个同样加密的滚动旧版副本 `Brevess/backups/settings/portable-config.enc.previous.json`。密钥由 PBKDF2 从备份口令派生。
- 备份口令不写入目录或任何导出文件；派生密钥只缓存在本机，可用“忘记备份解锁”清除。忘记口令后无法恢复密文副本。
- 普通论文导出、诊断、日志、Token 报告、缓存和单篇工作区仍排除 API 凭据；页面原始载荷也不进入便携配置备份。

## Privacy policy URL

`https://coolcoldplay.github.io/Brevess/privacy-policy.html`

发布前必须从无登录的浏览器窗口验证该 URL 可访问，并确认页面内容与当前版本一致。
