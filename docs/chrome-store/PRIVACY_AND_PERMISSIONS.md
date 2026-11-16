# Chrome 隐私表单与权限说明

依据当前代码整理于 2026-11-17。静态检查不是商店合规认证。后台表单定义如有变化，应按实际字段复核。

## Single purpose（可粘贴）

Help researchers read and organize scientific literature: navigate source documents, annotate evidence, understand figures and ask source-based questions, then retain the resulting notes and evidence in a local research workspace. Translation, speech, literature discovery and figure planning support this literature-reading workflow.

单一用途是科研文献阅读与证据整理。不要把工具描述成与阅读无关的通用浏览器改造、通用 Agent 执行器或独立办公套件。

## 权限理由（英文可粘贴）

| 权限 | 理由 |
|---|---|
| `activeTab` | Access the tab explicitly selected by the user when activating the paper-reading workspace, and direct navigation/highlight actions to that document. |
| `storage` | Store settings, explicit consent, provider credentials, annotations, paper indexes, research workspace data and local usage records. Credentials are used for the selected service and are not sent to the developer. |
| `unlimitedStorage` | Retain user-selected PDFs, cached figures, saved paper content and annotations in local extension storage/IndexedDB beyond the ordinary quota. Users control saved material and can delete it. This grants no additional network access. |
| `scripting` | Inject packaged reading/extraction and annotation code into user-selected pages and frames. No downloaded script is injected. |
| `offscreen` | Run the packaged offscreen document and dedicated network worker for user-requested provider streaming, and support the extension's local processing when the MV3 worker cannot provide a document context. |
| `sidePanel` | Display paper navigation, highlights, figures and Q&A in Chrome's native side panel alongside the source document. |
| `nativeMessaging` | Connect only to the optional, separately installed local companion for Codex/local PDF figure processing. Ordinary browser reading and manual annotations do not require this companion. No software is installed by this permission. |
| `webNavigation` | Bind reading tasks and messages to the current tab/frame/document, detect document replacement, and invalidate stale work so results and credentials are not applied to a different page. It is not used to assemble a browsing-history feed. |
| `alarms` | Schedule the literature radar checks explicitly enabled by the user and resume due checks while the browser runs. Queries are sent to the selected literature source; results are saved locally. |
| `notifications` (optional) | Notify users about literature-radar results only after they opt into notifications and grant the browser permission. |
| `https://*/*` | Scientific sources, figures/PDF storage and user-configured AI endpoints can be on arbitrary HTTPS domains. Packaged content scripts provide reading shortcuts/translation controls and configured local filters on matching pages. Full reading, source retrieval and configured online tools use the relevant document or user-selected service. This does not send a browsing feed to the developer. |
| `http://localhost/*`, `http://127.0.0.1/*` | Connect to optional user-run local model/speech services, Zotero and the workbench MCP bridge on the same device. |
| `file:///*` | Read local papers opened by the user and apply the reading tools when the user separately enables Chrome's “Allow access to file URLs”. The extension does not enumerate the filesystem. |

`https://api.typesafe.ai/*` 与 `https://*/*` 重复，Chrome 暂存包已去掉重复项，不移除该 Provider。源 manifest 的开发 key 保留，Chrome 包不包含该 key；商店 ID 以后由后台确认。

广泛 HTTPS 权限是本次真实功能所需的待重点说明项，并不能承诺一定获批。若审核要求进一步缩权，需设计按站点授权和动态内容脚本，完成回归后再改变权限。不要为“更好看”直接删除功能依赖的权限。

## Remote code

拟选 No，依据：业务 JS、PDF.js、Worker、WebAssembly 和字体在包内。API 返回文本/JSON/图片/音频等结果，应用使用固定功能处理；本地 MCP 使用包内限定处理函数。没有远程 JS/CDN script。

可粘贴：All executable extension code, workers and PDF.js WebAssembly assets are included in the submitted package. Remote services return task data such as text, structured results, images or audio. These responses are not evaluated as extension JavaScript. The optional local MCP bridge maps permitted requests to packaged handlers, not arbitrary script execution.

检查记录：`vendor/pdfjs/build/pdf.min.mjs` 与 `pdf.worker.min.mjs` 中有通用动态编译 token；不可仅凭搜索命中就声称发现远程代码。PDF 的 `cMapUrl`、`standardFontDataUrl`、`wasmUrl` 指向 `chrome.runtime.getURL(...)` 本地资源。打包审计列出这些命中供审核定位，仍需完整 PDF 实测。

## Data usage 字段映射

不要选择“不收集/处理任何用户数据”。Chrome 明确要求披露仅本地处理的数据。

| 后台数据类型 | 本版本填写建议与范围 |
|---|---|
| Website content | 勾选：论文/网页文本、图片、图注、PDF、选区、用户标注及导入的研究资料。 |
| Authentication information | 勾选：用户提供的 API Key、Token、鉴权头和本地集成凭据。 |
| Web history | 勾选并限定说明：用户阅读/保存文献的网址、标题、来源标识和相关资源请求；不采集完整浏览历史。 |
| User activity | 勾选并限定说明：支持快捷键、划词、阅读工具和本机任务/Token 统计所需的交互信息；不向开发者传输鼠标/键盘行为流。 |
| Personal communications | 保守勾选：用户在全文问答中输入的问题和保存的对话。没有访问邮箱或第三方聊天账号的功能。 |
| Personally identifiable information | 本版本无账号注册和个人身份字段，不主动收集；不要把用户可能写入任意文本的内容误称为绝不可能含身份信息。若恢复账号服务，必须重审。 |
| Financial/payment、Health、Location | 无针对这些数据的功能性收集，不勾选。外部服务看到请求 IP 不等于扩展请求 GPS；科研论文内容不能宣传为临床健康数据服务。 |

以上以实际后台类别定义复核；不要将 Edge 的“User-provided content”自造为 Chrome 复选框。

认证项应如实确认：不出售数据；不用于与所披露用途无关的目的；不用于信用/借贷判断。第三方服务仍按自己的条款处理，不能承诺所有自选 Provider 均不保留或不训练。

## 发送触发与撤回

- AI 正文：`core/settings-store.js` 的 `consentGranted` 默认 false，用户配置并启用；后续自动模式只在用户开启后生效。
- MinerU：由 PDF 增强识别单独触发，不能写成受 AI 许可统一控制。
- 雷达：所选来源和定时任务分别控制，可后台定时联网；见 `core/literature-radar-*.js`。
- 朗读：默认浏览器模式、自动朗读关闭；在线语音和联网音色需要单独说明；见 `core/tts-service.js`。
- 本地页面脚本：见 manifest 的三个 content_scripts 组，过滤与快捷键不等于后台上传。
- 云协作：`core/sharing-background.js` 当前停用，不宣传账号服务。

## 官方依据

- [填写隐私字段](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)
- [用户数据 FAQ（包括本地处理）](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)
- [有限使用](https://developer.chrome.com/docs/webstore/program-policies/limited-use)
- [披露要求](https://developer.chrome.com/docs/webstore/program-policies/disclosure-requirements)
- [Manifest V3 代码要求](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements)
