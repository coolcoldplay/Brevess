# 本机 Codex 全文问答

Brevess 1.0.1 的“本机 Codex”模型提供商通过 Chromium Native Messaging 调用
Codex App Server。插件不读取或保存明文登录令牌；App Server 把认证状态保存在
`%LOCALAPPDATA%\BrevessCodexBridge\codex-home`，与桌面 Codex 和 Codex CLI 隔离。

## Windows 安装

1. 安装 Codex，确认 PowerShell 中的 `codex --version` 可以正常使用。
2. 打开 `edge://extensions/` 或 `chrome://extensions/`，在 Brevess 卡片中复制当前
   显示的 32 位扩展 ID。
3. 在扩展构建目录的 `native-host` 文件夹中运行，并把 `实际扩展ID` 替换为上一步
   复制的值：

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\install.ps1 -ExtensionId 实际扩展ID
   ```

4. 在 `edge://extensions` 或 `chrome://extensions` 中重新加载扩展。
5. 打开插件设置，新建 Profile，Provider 选择“本机 Codex”，模型使用
   `auto`。在“插件专用 Codex 会话”中点击“登录 / 重新登录”，完成网页授权。
6. 登录状态显示“已登录”后，保存 Profile 并点击“测试连接”。测试会运行一次真实、
   不保存线程的短模型回合。
7. 在“全文问答”底部的模型下拉框中选择这个 Profile。

如果设置页无法打开登录页，可在 `native-host` 目录运行备用脚本：

```powershell
powershell -ExecutionPolicy Bypass -File .\login.ps1
```

不要直接用普通的 `codex login` 代替：普通命令默认登录的是 CLI 自己的
`CODEX_HOME`，不是插件的隔离目录。

Edge 商店安装版使用固定的商店 ID；GitHub Release 中的商店 ZIP 作为“解压扩展”加载时，
浏览器可能根据文件夹路径生成另一个 ID。因此应始终以扩展管理页显示的实际 ID 为准，并
把它传给安装脚本：

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -ExtensionId 实际扩展ID
```

## 数据与权限边界

- 每篇论文和每个 Codex Profile 会绑定一个 Codex thread。
- thread 映射保存在 `%LOCALAPPDATA%\BrevessCodexBridge\threads.json`。
- Codex 自己管理插件专用登录状态，插件和桥接程序都不会导出登录令牌。
- 桌面 Codex、Codex CLI 与插件不会共享刷新令牌，避免并发刷新导致会话失效。
- Codex 线程以只读 sandbox、永不请求审批的方式启动；提示词明确禁止使用命令、
  文件、网络、MCP 或代码修改工具；桥接进程也会禁用 shell 和 web search。
- 论文正文仍按插件的检索计划分块，只把当前问题需要的上下文发送给 Codex。

## Figure 图片输入

- 本机 Codex 现在被注册为视觉模型。解图前，网页端会提取并压缩 Figure 原图，再通过
  Native Messaging 发送到本机桥。
- 桥接程序只在
  `%LOCALAPPDATA%\BrevessCodexBridge\turn-images`
  创建本轮请求使用的临时图片，并以 Codex App Server 的 `localImage` 输入传给模型。
- 模型回合完成、失败或取消后，临时图片会立即删除。
- 如果网页图片受到跨域、登录墙或加载超时限制，插件仍会明确回退到“图注与正文”，并在
  Figure 结果中记录 `visionFallback`；不会把纯文本结果伪装成视觉解读。

## 反向事件通道

本机 Codex 生成 Figure、Panel 或跨图结果时，插件会把进度与最终结果实时写入：

- 最新状态：
  `%LOCALAPPDATA%\BrevessCodexBridge\reader-events\latest.json`
- 追加式事件流：
  `%LOCALAPPDATA%\BrevessCodexBridge\reader-events\events.ndjson`

设置页的“本机 Codex”状态会显示这两个实际路径。事件中不保存 API Key、登录令牌或图片
Base64，只包含页面身份、任务进度和模型结果；事件日志达到 16 MB 后轮换为
`events.previous.ndjson`。桌面 Codex 可以按需读取这两个文件，因此不再依赖浏览器侧栏
DOM 是否允许自动化访问。

## 卸载

运行 `native-host\uninstall.ps1` 删除 Edge 和 Chrome 的 Native Messaging 注册。
为了保留可恢复的 thread 映射，脚本不会自动删除
`%LOCALAPPDATA%\BrevessCodexBridge`。
