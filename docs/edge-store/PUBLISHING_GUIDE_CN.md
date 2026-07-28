# Brevess：Microsoft Edge Add-ons 上架操作指南

适用版本：1.0.0
最后核对日期：2026-07-29

## 先说清楚：哪些步骤必须由发布者本人完成

代码、ZIP、图片、商店文案、隐私披露和审核说明可以在本项目中准备好；以下动作涉及账号身份、法律协议或对外发布，必须由你本人完成：

1. 决定使用个人开发者还是公司开发者身份。
2. 注册/验证 Partner Center 开发者账号并接受协议。
3. 把隐私政策和 reviewer demo 发布到你的 GitHub Pages。
4. 把可选 Codex Bridge 上传到你的 GitHub Release。
5. 在 Partner Center 上传文件、确认披露并点击 Publish。

不要使用“南方医科大学”作为发布者名称，除非你已经获得学校书面授权。

## 第一阶段：本地发布门禁

在 PowerShell 中进入项目：

```powershell
Set-Location 'C:\path\to\brevess'
```

依次运行：

```powershell
npm test
npm run test:edge-side-panel
npm run test:edge-restart
npm run assets:edge-store
npm run screenshots:edge-store
```

全部通过后，创建第一份发布包：

```powershell
npm run build:edge-store
```

构建目录为：

```text
dist\Brevess-Edge-v1.0.0
```

验证构建：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\verify-edge-store-release.ps1 `
  -ReleaseRoot .\dist\Brevess-Edge-v1.0.0
```

只有输出 `Status : PASS` 才继续。

## 第二阶段：先发布必须在线访问的页面

本项目已经准备：

- `docs/privacy-policy.html`
- `docs/reviewer-demo.html`

把当前仓库提交并推送到 `coolcoldplay/Brevess` 后：

1. 打开 GitHub 仓库的 **Settings > Pages**。
2. 在 **Build and deployment** 中选择 **Deploy from a branch**。
3. 选择发布分支（通常 `main`）和 `/docs` 文件夹。
4. 保存并等待 Pages 构建完成。
5. 使用 Edge InPrivate 窗口检查：

   - `https://coolcoldplay.github.io/Brevess/privacy-policy.html`
   - `https://coolcoldplay.github.io/Brevess/reviewer-demo.html`

两条 URL 都必须无需登录、无证书警告并返回正常页面。否则不要提交商店审核。

## 第三阶段：注册 Edge 开发者账号

1. 打开 `https://partner.microsoft.com/dashboard`。
2. 使用 Microsoft 个人账号（Outlook.com、Live.com、Hotmail.com）登录；也可以通过 GitHub 创建对应 Microsoft 账号。
3. 工作或学校账号不能单独成为 Edge Program 的 Primary Owner。
4. 进入 **Account settings > Programs > Microsoft Edge > Get started**。
5. 选择国家/地区和账号类型：

   - **Individual**：以个人或未注册团队发布，验证更快。
   - **Company**：只能使用有权代表的注册公司名称，验证可能需要数天到数周。

6. 国家/地区和账号类型注册后不能更改，先确认再提交。
7. Publisher display name 最多 50 个字符，而且必须有权使用。
8. 阅读并接受 App Developer Agreement，完成验证。

Microsoft 当前不收取 Edge 扩展开发者注册费。

## 第四阶段：创建商店项目并取得 Catalog Extension ID

1. 在 Partner Center 首页进入 **Edge** 工作区。
2. 点击 **Create new extension**。
3. 上传：

   ```text
   dist\Brevess-Edge-v1.0.0\Brevess-v1.0.0-Microsoft-Edge.zip
   ```

4. 等待包验证完成，查看 **Extension overview**。
5. 复制 Microsoft 分配的 32 位小写扩展 ID。

这个 ID 对可选 Codex Native Messaging 很重要。商店安装后的 ID可能与本地侧载 ID不同。

## 第五阶段：用真实商店 ID 重建最终发布包

假设 Partner Center 给出的 ID 是 `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`，运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\build-edge-store-release.ps1 `
  -CatalogExtensionId 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' `
  -ReleaseName 'Brevess-Edge-v1.0.0-catalog'
```

然后验证：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\verify-edge-store-release.ps1 `
  -ReleaseRoot .\dist\Brevess-Edge-v1.0.0-catalog
```

验证通过后，在 Partner Center 的 **Packages** 页面重新上传最终 ZIP：

```text
dist\Brevess-Edge-v1.0.0-catalog\Brevess-v1.0.0-Microsoft-Edge.zip
```

## 第六阶段：发布可选 Codex Bridge

在 GitHub 仓库创建版本为 `v1.0.0` 的 Release，至少上传：

```text
Brevess-Codex-Bridge-Windows-x64-v1.0.0.zip
Brevess-Codex-Bridge-Windows-x64.zip
```

第二个稳定文件名必须保持不变，因为插件设置页使用：

```text
https://github.com/coolcoldplay/Brevess/releases/latest/download/Brevess-Codex-Bridge-Windows-x64.zip
```

发布后，从 InPrivate 窗口实际下载一次并检查：

1. ZIP 能打开。
2. `catalog-extension-ids.txt` 包含 Partner Center 的真实 ID。
3. `Install-Brevess-Codex-Bridge.cmd`、卸载脚本、README 和 `bin\brevess-codex-host.exe` 都存在。
4. Windows Defender 没有报毒。

如果 Bridge 未完成代码签名或 SmartScreen 信誉积累，必须在商店说明中明确它是“可选 Windows 辅助程序”，不要描述为无警告的一键安装。

## 第七阶段：填写 Availability 与 Properties

### Availability

首次建议：

- Visibility：先选 **Hidden**，审核通过后用商店链接做一次干净安装验证；确认无误再切换 **Public**。
- Markets：如果隐私政策、支持能力和第三方 Provider 条款尚未覆盖全球，先选择你能支持的市场；否则可保留全部市场。

### Properties

- Category：**Productivity**
- Website：`https://github.com/coolcoldplay/Brevess`
- Support：`https://github.com/coolcoldplay/Brevess/issues`
- Mature content：不勾选
- Privacy information：选择 **Yes**，因为扩展会访问当前网页内容，并可在用户同意后把内容发给其选择的模型服务。
- Privacy URL：`https://coolcoldplay.github.io/Brevess/privacy-policy.html`

## 第八阶段：填写新的 Privacy 页面

打开本发布目录中的 `PRIVACY_AND_PERMISSIONS.md`，逐项复制：

1. **Single Purpose**：粘贴单一用途说明。
2. **Permission justification**：为 `activeTab`、`storage`、`scripting`、`offscreen`、`sidePanel`、`nativeMessaging` 和三个 host permission 分别填理由。
3. **Are you using remote code?**：选择 **No**。
4. **Data usage**：如实选择网站内容、用户提供内容、身份验证信息、当前网站标识、本机产品交互/诊断数据。
5. 勾选有限使用相关声明前，再与隐私政策逐条核对。
6. 填写隐私政策 URL 并保存。

不要把“未使用统计 SDK”误填成“不访问任何用户数据”。当前论文正文、问题和 API Key 都属于需要披露的数据处理范围，只是处理方式以本地和用户指定 Provider 为主。

## 第九阶段：填写中文和英文商店详情

打开 `STORE_LISTING.md`。

### 中文（简体）

1. Description：粘贴中文详细说明。
2. Logo：上传 `store-logo-300.png`。
3. Small promotional tile：上传 `small-tile-440x280.png`。
4. Large promotional tile：上传 `large-tile-1400x560.png`。
5. Screenshots：按编号上传 `screenshot-1` 至 `screenshot-5`。
6. Search terms：粘贴 7 个中文搜索词。

### English

1. 添加 English (United States)。
2. Description：粘贴英文 Long description。
3. 上传同一组品牌图；截图如果仍是中文侧栏，应在英文说明中注明界面支持 CH/EN 直接切换，或者后续另拍英文版截图。
4. 粘贴英文 Search terms。

Partner Center 要求每个列出的语言都提供 250–10,000 字符的 Description 和 Logo。项目清单已经使用 `__MSG_...__`、`default_locale` 和 `_locales`，因此中文和英文应被识别为两个 locale。

## 第十阶段：填写审核备注并提交

打开 `CERTIFICATION_NOTES.md`，把内容粘贴到 **Notes for certification**。重点保留：

- 无需账号即可测试的本地功能。
- 原创 reviewer demo URL。
- 完整点击路径。
- LLM 使用 BYO Provider，不存在可以共享的统一云账号。
- Codex Bridge 是可选 Windows 辅助程序。
- 不使用远程代码。

检查所有页面状态为 Complete 后，点击 **Publish**。

官方说明认证最长可能需要 7 个工作日。审核期间保持：

- GitHub Pages 在线。
- GitHub Release 下载在线。
- 支持邮箱/Issues 可联系。
- 不删除 Reviewer demo。

## 审核通过后的验证

1. 从商店链接安装，不使用本地侧载版本。
2. 在 `edge://extensions` 记录真实扩展 ID。
3. 如果 ID 与 Bridge 清单不一致，立即重建和替换 GitHub Release 稳定 ZIP。
4. 依次验证首次引导、导航、缩写、正则、手动高亮、本地目录、BYO API、Codex Bridge、Figure/Panel、全文问答和 Token 统计。
5. 查看 Edge 扩展错误页，确认无 Service Worker 或权限错误。
6. 验证无误后再把 Visibility 改为 Public。

## 后续更新

每次更新必须：

1. 递增 `manifest.json` 与 `package.json` 版本。
2. 更新 CHANGELOG 和商店审核备注。
3. 重跑全部测试与截图。
4. 重建并验证 ZIP。
5. 在 Partner Center 上传新包。

商店更新同样会进入认证流程，不要直接复用旧 ZIP 或旧截图。

## 官方依据

- 发布流程：`https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension`
- 开发者账号：`https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/create-dev-account`
- 开发者政策：`https://learn.microsoft.com/en-us/legal/microsoft-edge/extensions/developer-policies`
- Native Messaging：`https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/native-messaging`
