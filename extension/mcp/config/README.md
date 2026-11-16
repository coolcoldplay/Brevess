# MCP client configuration

## Windows 用户入口

打开匹配配套组件里的 `Install-Brevess-Codex-Bridge.cmd`，选择已安装的 Codex、DeepSeek Harness 或两者。默认只读；空选择是“仅组件”，不会配置 Agent 客户端。安装器保留其他服务，并把所选客户端指向 `%LOCALAPPDATA%\BrevessCodexBridge\agent\versions\…` 下的固定 Node 和 MCP payload。版本目录由安装器生成，不手填、不替换成临时解压路径。

已经存在安装器管理的 BREVESS 配置时复用它；不要再创建 HTTP 配置或启动另一个 9537 服务。安装器拒绝手工改过的管理块或不安全格式时，保留备份并核对差异，不覆盖整份配置。需要升级且两客户端都受管理时，一起选择两者；不要留下一个客户端指向旧 payload。

重新加载所选客户端，在 BREVESS 工作台 **Agent 连接**中“检测连接组件”→“自动配对并自检”，然后在客户端调用 `brevess.status` / `brevess.capabilities`。服务在线、扩展配对与客户端读工具成功分别核验。无需收费模型调用或插件专用模型登录；配对 token 不进入配置示例、聊天、截图或课题。当前没有已核实的公开安装下载 URL；浏览器扩展 ZIP 本身不代表配套组件已安装。

## 已核验的客户端

- **Codex npm CLI 0.151.0**：安装器合并 `CODEX_HOME/config.toml` 的 `mcp_servers.brevess` 块；未指定时使用实际用户默认目录。`codex-config.toml` 只说明安装后只读块的形状，所有示例行均注释，不能替代管理回执或用于覆盖已有文件。
- **DeepSeek Harness Desktop 0.2.0-rc.2**：实际机制是 `DSH_HOME`（未指定时用户 `.dsh`）下 `profiles/desktop/cordis.patch.yml`，由适配器合并 `@deepseek-ai/dsh-mcp-client` 的 stdio 条目。`deepseek-harness.json` 是说明资料，**不是**该版本可导入的 `mcpServers` 配置，不应粘贴到 Harness 设置。

自动适配对其他版本会停止并说明未验证，不会猜测私有字段。需要手动接入时先核对目标客户端的实际配置机制，保留安装路径、只读设置、其他服务和备份。

## 读取与写入

默认只读。总库 `library.query_global_library` / `library.catalog_read` 无需项目 scope 或先建立课题；课题用 `workbench.read_context`，单篇文献机制图用 `mechanism.read_context`。

用户明确同意启用写能力后，才通过配套安装器的 `-AgentAllowWrite` 或核验过的高级启动参数 `--allow-write` 更新连接配置。若安装器同时管理两个客户端，应按其升级检查一起更新，随后重载客户端。写传输仍不批准任何目标修改：课题使用 `brevess.request_write_scope`，文献使用 `brevess.request_document_write_scope`；总库 `library.catalog_command` 需要 `--allow-write` **以及浏览器原生逐次确认**，携带总库 `expectedRevision` 和稳定 `idempotencyKey`，不能用项目 scope 绕过。

## 高级开发：独立源码调试

以下只用于开发者在合成目标中的隔离调试，不是已安装用户的默认接入方式。当前 `--stdio-only` 使用共享服务代理，不会让每个 stdio 客户端独占端口。源码运行必须使用专用临时 state 目录和随机端口，并显式 `--no-write`；不得复用用户 `%LOCALAPPDATA%\BrevessMcp` 或默认 9537，也不要改写真实客户端配置。

```powershell
$brevessDevState = Join-Path $env:TEMP ('brevess-mcp-dev-' + [guid]::NewGuid().ToString('N'))
node .\mcp\server.js --stdio-only --no-write --port 0 --state-dir $brevessDevState
```

该命令供 MCP stdio 客户端调试，不是自动配对命令，也不保证向终端打印配对链接。隔离 HTTP 测试仅在明确需要时使用 `--http-only`，仍须独立 state、随机端口和显式只读；不能再按历史默认端口示例启动另一服务。现存 `codex-exec.ps1` 和 `mcp/e2e/README.md` 属开发/历史 HTTP 调试资料，可能执行客户端模型回合，不是免费的连接自检；未经专门授权不要执行，旧默认 state/port 示例不得与安装服务并用。

恢复安装器管理的客户端改动见配套组件 `uninstall.ps1 -RestoreAgentClients`。它仅按回执恢复自身配置，保留其他设置；人工改过的管理块需要先审查。普通无参卸载只移除自身 native 注册，保留 Agent 配置和本机数据，不能当作完整客户端恢复。
