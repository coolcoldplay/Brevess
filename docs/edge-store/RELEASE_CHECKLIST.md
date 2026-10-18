# Edge Add-ons 上架前检查表

## 必须全部通过

- [ ] `manifest.json` 版本已递增，且与 `package.json`、更新说明一致。
- [ ] 商店 ZIP 根目录直接包含 `manifest.json`，不是再套一层文件夹。
- [ ] ZIP 不包含 `.git`、测试、日志、Playwright 输出、源映射、API Key、Token、文章缓存或 Native Host EXE。
- [ ] `_locales/zh_CN/messages.json` 和 `_locales/en/messages.json` 已包含在 ZIP 中。
- [ ] `npm test` 全部通过。
- [ ] `npm run test:edge-side-panel` 全部通过。
- [ ] `npm run test:edge-restart` 全部通过。
- [ ] 新安装、首次引导、跳过目录、跳过 API、重新打开设置均已手测。
- [ ] 所有商店截图来自同一发布版本，没有旧标题、旧 Logo、调试文字、重复占位回复或混合测试语言。
- [ ] 隐私政策 URL 可在无登录窗口访问。
- [ ] 支持 URL、项目网站和 reviewer demo 均返回 HTTP 200。
- [ ] 发布构建显式传入 `-IncludeStableCompanionAlias`，GitHub Release 中存在稳定文件名 `Brevess-Codex-Bridge-Windows-x64.zip`。
- [ ] Partner Center 分配的 Edge 扩展 ID 已写入 Bridge 的 `catalog-extension-ids.txt` 并重新打包。
- [ ] Windows Defender/SmartScreen 与至少一个干净 Windows 用户环境已检查 Bridge 包。
- [ ] Privacy 页中的单一用途、权限、远程代码和数据使用披露与实际行为一致。
- [ ] Notes for certification 已粘贴完整测试步骤，并解释为何不提供共享 LLM 凭据。
- [ ] 发布者名称、Logo、说明和截图均为自己拥有或有权使用的内容。

## 建议发布策略

1. 第一次提交先选择 **Hidden** 或受限市场完成最终验证。
2. 通过审核后使用商店链接验证安装、扩展 ID、Native Messaging 和更新流程。
3. 验证无误再切换为 **Public**。
4. 后续每次更新先递增版本号、重建 ZIP、重新运行全部测试，再在 Partner Center 上传；每次更新都会重新进入认证。
