# Reviewer instructions / 审核操作说明

## English — local features without credentials

BREVESS 1.0.2 is a free research reading extension. No BREVESS account is required. AI functionality uses a user's separately configured provider and credentials; no shared developer key is bundled.

1. Install the submitted extension on desktop Chrome. Open the synthetic demonstration article at https://coolcoldplay.github.io/Brevess/reviewer-demo.html . This is original demonstration material, not a clinical study.
2. Open BREVESS from the toolbar and select its reading entry. If first-run setup appears, skip the optional local-folder and model setup. Local navigation and manual/rule annotations work without an account.
3. Open the article navigation view and expand a section. Click a heading/paragraph and verify that the source page scrolls to it.
4. Open the highlighting view, choose the offline Rules/Regex mode, select categories and apply. Verify colored underlines on matching article text.
5. Select text on the article and use the manual annotation controls to add a note. Reopen the article's local workspace to inspect saved annotations.
6. Open the research workbench. Inspect the library, hypothesis and figure-planning tabs; creating a local plan does not require an online account. Delete test records after testing if desired.
7. Open Settings and switch between Chinese and English. API content transmission is disabled by default. Credentials are entered by the user in model settings.

## Optional services

- AI: configure a supported provider, endpoint, model and test credential; enable article-content transmission and save. Then test one paragraph explanation, figure request or full-text question. Third-party charges/terms apply. Revoking AI consent does not revoke independent PDF enhancement, speech or literature-source settings.
- PDF: native page reading/indexing is local. Enhanced recognition sends the PDF or URL to MinerU; precision mode requires a separate MinerU token.
- Literature radar: a user-created search contacts its chosen literature source. Enabled schedules run in the background; notifications are optional. Some sources need a separate subscription/API key.
- Speech: browser/system voices may be local or network voices. Online/DeepSeek speech sends selected text to the selected service. Automatic selected-text speech is off by default.
- Native companion: optional external software, installed separately. It must allow the **actual Chrome Web Store extension ID**. The old Edge catalog ID and local development ID are not substitutes. Native companion compatibility is not a prerequisite for basic browser reading.
- MCP: optional loopback connection for an external agent, with packaged handlers and local approval boundaries. No Node server is embedded in the Chrome upload ZIP.

No production user credentials, paid-provider API keys or fake AI responses are included in the demonstration. If review requires a working paid-provider credential, the publisher should supply a dedicated revocable test credential through the dashboard's private Test instructions field. The current preparation does not create or purchase one. Do not claim optional AI/companion routes have passed live acceptance unless a recorded run exists.

## 发布前由发布者执行

- 从未登录的环境打开上述演示 URL 和隐私 URL，确认内容是当前版本。
- 在真实 Chrome 原生侧栏完成首次安装、标签切换、关闭重开和重启恢复。
- 在准备发布的 ZIP 上核验 PDF 本地阅读、AI 真实服务、雷达、导入/导出和权限撤回。
- 把实际成功步骤与当前按钮名称同步到本文件，不能把自动化内部调用等同于人工首次运行体验。
