# Agent 快速接入

打开「设置 → 模型与连接 → 连接你的 Agent」，选择客户端并点击「连接并测试」。已安装本机组件时，这一步会增量配置所选客户端、配对浏览器并测试连接。支持问答的客户端会收到一条合成测试消息，返回预期文字后设置页才显示问答测试通过。首次安装或更新本机组件，可从「高级选项」复制配置提示词，随后回到设置页继续。

已配对的浏览器可以在工作台和设置均关闭时响应连接状态、能力和文献总库查询。操作某个具体课题时，打开对应的工作台并按原流程授权。多个工作台同时打开时，连接继续提供总库读取，课题操作等待选定唯一目标。

## 客户端能力

| 客户端 | MCP 配置 | BREVESS 问答通道 |
| --- | --- | --- |
| Codex、DeepSeek Harness | 设置中增量配置 | 官方 app-server 或 Harness SDK |
| Google Antigravity、Cursor、Gemini CLI、Copilot CLI、Qwen Code、Kimi Code | 设置中增量配置 | 官方 CLI 的 ACP 接口 |
| Claude Code、CodeBuddy Code | 设置中增量配置 | 本机客户端的流式 JSON 接口 |
| OpenCode | 识别本机 CLI 的主版本，按 v1 或 v2 配置结构写入 | 本机 ACP 接口 |
| WorkBuddy | 设置中增量配置 | 桌面客户端接单，或使用已登录的命令行直连 |
| Qoder | 设置中增量配置 | 客户端接单 |
| TRAE、通用 MCP 客户端，或版本无法识别的 OpenCode | 从设置复制配置，到客户端导入 | 取决于客户端已启用的工具 |

使用 WorkBuddy 桌面版时，在连接器管理中信任并启用 `brevess` 和 `brevess-presentations`。回到 BREVESS 选择「桌面客户端接单」，点击「连接并测试」，将页面上的接单指令复制到 WorkBuddy 新会话并发送。收到回复后，BREVESS 会自动更新连接状态。

Antigravity 使用 `agy acp`。设置可复用已有 CLI，也可按需下载并校验 Google 官方发布的 CLI。登录按钮打开 Google 官方页面，一次性授权码只交给正在等待的 CLI。模型和推理强度由客户端当前会话返回。只安装桌面 App 时，MCP 配置和 CLI 模型登录分别显示。参考 [Google ACP 说明](https://antigravity.google/docs/cli/acp/) 和 [T3 Code 的 Provider 实现](https://github.com/pingdotgg/t3code/blob/main/docs/user/providers-antigravity.md)。

MCP 当前开放文献总库查询、阅读素材、课题、假说梳理和组图规划等工具。以 `brevess.capabilities` 的运行时结果为准，不承诺尚无接口的任意网页高亮、翻译或解图操作。写操作还需要 BREVESS 中的短期任务权限，安装器不自动批准研究写入。

## 给接入 Agent 的操作说明

要求 Node.js 22+，复用已安装的运行时。安装器无需 npm 依赖、不下载软件、不接触密码库。先确认正在加载的插件源码及扩展 ID，从[本版源码](https://github.com/coolcoldplay/Brevess/archive/refs/tags/v1.0.2-r27-reader-r23.2.zip)解压后的仓库根目录运行以下命令，将占位符替换为扩展管理页显示的 ID。

```sh
node scripts/setup-agent-connection.mjs --client qwen --extension-id <扩展ID> --dry-run
node scripts/setup-agent-connection.mjs --client qwen --extension-id <扩展ID>
```

多个客户端用逗号分隔，例如 `--client codex,dsh`。可用值：`codex,dsh,antigravity,qwen,kimi,qoder,workbuddy,codebuddy,trae,claude,gemini,cursor,copilot,opencode,generic`。

需要授权课题写入时使用 `--allow-write`；只读使用 `--read-only`。未指定时保留已安装组件的写能力，新安装默认只读。安装器不会更改 BREVESS 的默认模型、功能路由或隐私许可。

macOS 注册 Chrome / Edge 用户级 Native Messaging。Windows 注册对应 HKCU 项，不需要管理员权限。内部组件只监听 `127.0.0.1`，多个客户端共用同一服务，空闲退出。安装器只输出路径和结果状态，不输出配对令牌。

### 客户端差异

- Codex：只增量添加带标记的 `mcp_servers.brevess` TOML 块，保留其他配置。
- DSH：只在 `$DSH_HOME/cordis.patch.yml`（默认 `~/.dsh/cordis.patch.yml`）添加一个 `insert` 补丁，不改写官方应用内部文件。完全退出再打开 DSH 后验证。
- JSON/JSONC 客户端：只插入 `mcpServers.brevess`，保留注释、其他服务和现有配置内容。同名非托管条目存在时停止，不覆盖。
- Kimi：当前 Kimi Code 使用 `~/.kimi-code/mcp.json`，支持 `KIMI_CODE_HOME`。若本机实际是旧 Kimi CLI（`~/.kimi/mcp.json`），先用该版本官方 `kimi mcp add` 导入生成的命令，不能只写新路径然后声称成功。
- CodeBuddy：遵循官方文件优先级 `.codebuddy/.mcp.json`、`.codebuddy/mcp.json`、`.codebuddy.json`，保留现有有效文件。
- Qoder：这里对应当前统一客户端 / CLI 的 `~/.qoder/settings.json`。旧 IDE 或 Qoder CN 路径以其官方 MCP 界面为准，不能仅凭同名产品推断。
- TRAE / 通用客户端：安装器生成 stdio JSON 后返回 `client-setup-required`；由 Agent 在官方 MCP 设置中导入并检查启用状态。
- OpenCode：V1 与 V2 配置层级不同，设置页按本机 CLI 主版本选择配置。识别失败时，可使用官方 `mcp add` 和生成的命令、参数。两代配置分别使用 `mcp.brevess` 和 `mcp.servers.brevess`。

安装后回到设置页点击「连接并测试」。手动配对、断开与移除入口收在「高级选项」。安装器的 `configured-not-tested` 只代表文件写入成功。必须继续调用真实工具和模型才算完成。

### 恢复

每次实际改变文件都会生成私有备份与 `receipt.json`，路径由安装器返回。备份可能包含客户端原配置，禁止上传或放入公开验收包。

```sh
node scripts/setup-agent-connection.mjs --restore "/绝对路径/receipt.json"
```

恢复前校验全部文件和备份哈希；如果安装后有新的用户修改，停止恢复以免覆盖。恢复不会删除研究资料、登录信息或聊天历史。已连接客户端应先关闭连接，再恢复配置。安装器依赖的 Node 路径失效时重新运行接入提示词修复。

## 官方参考

核对日期：2026-11-26。模型与推理能力以当前客户端的实际响应为准。

- [Codex MCP](https://developers.openai.com/codex/mcp)
- [DSH MCP](https://deepseek-harness.github.io/deepseek-harness/subsystems/mcp) · [用户补丁示例](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/guide/mcp-memory.md)
- [Qwen Code](https://qwenlm.github.io/qwen-code-docs/en/users/configuration/settings/)
- [Kimi Code MCP](https://moonshotai.github.io/kimi-code/en/customization/mcp.html) · [数据位置](https://moonshotai.github.io/kimi-code/en/configuration/data-locations.html)
- [Qoder](https://docs.qoder.com/cli/mcp-reference)
- [CodeBuddy Code](https://www.codebuddy.ai/docs/cli/mcp)
- [TRAE](https://docs.trae.ai/ide/model-context-protocol)
- [Claude Code](https://code.claude.com/docs/en/mcp) · [Gemini CLI](https://geminicli.com/docs/tools/mcp-server/)
- [Cursor](https://cursor.com/docs/mcp) · [Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers)
- [OpenCode](https://opencode.ai/docs/mcp-servers/)
