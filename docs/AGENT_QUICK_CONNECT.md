# Agent 快速接入

在「设置 → 模型与连接 → 连接你的 Agent」打开连接窗口，选择客户端，点击“复制配置提示词”并粘贴到客户端。它会安装内部通信组件、保留已有配置、完成配对和实际读写验证。账号登录仍在官方页面完成；BREVESS 不索取账号密码，也不搬运客户端的登录令牌。

## 支持方向

| 客户端 | Agent 读取、操作 BREVESS | 在 BREVESS 内调用 Agent |
| --- | --- | --- |
| Codex | MCP，自动配置 | 本机官方 app-server，插件独立官方登录 |
| DeepSeek Harness | MCP，自动添加 Cordis 用户补丁 | 官方 SDK，使用 DSH 账号；适配 0.2.0-rc.2 / 0.2.2-rc.2 |
| Qwen Code、Kimi Code、Qoder、CodeBuddy Code | MCP，增量配置 | 尚未适配 |
| Claude Code、Gemini CLI、Cursor、Copilot CLI | MCP，增量配置 | 尚未适配 |
| TRAE、OpenCode、其他 MCP 客户端 | 生成配置，由 Agent 通过客户端官方入口继续完成 | 尚未适配 |

这里只包括能配置本机 MCP 的客户端。仅提供模型 API 或只接受远程 HTTPS MCP 的网页聊天产品，不能因此视为已接入本机插件。GLM、MiniMax 等模型运行在 Claude Code / OpenCode 等软件里时，选择实际客户端；不会因为用了某家的模型就更换客户端身份。

MCP 当前开放文献总库查询、阅读素材、课题、假说梳理和组图规划等工具。以 `brevess.capabilities` 的运行时结果为准，不承诺尚无接口的任意网页高亮、翻译或解图操作。写操作还需要 BREVESS 中的短期任务权限，安装器不自动批准研究写入。

## 给接入 Agent 的操作说明

要求 Node.js 22+，复用已安装的运行时。安装器无需 npm 依赖、不下载软件、不接触密码库。先确认正在加载的插件源码及扩展 ID，使用同一源码版本：

```sh
node scripts/setup-agent-connection.mjs --client qwen --extension-id <扩展ID> --dry-run
node scripts/setup-agent-connection.mjs --client qwen --extension-id <扩展ID>
```

多个客户端用逗号分隔，例如 `--client codex,dsh`。可用值：`codex,dsh,qwen,kimi,qoder,codebuddy,trae,claude,gemini,cursor,copilot,opencode,generic`。

需要操作验收课题时使用 `--allow-write`；只读使用 `--read-only`。未指定时保留已安装组件的写能力，新安装默认只读。安装器不会更改 BREVESS 的默认模型、功能路由或隐私许可。

macOS 注册 Chrome / Edge 用户级 Native Messaging。Windows 注册对应 HKCU 项，不需要管理员权限。内部组件只监听 `127.0.0.1`，多个客户端共用同一服务，空闲退出。安装器只输出路径和结果状态，不输出配对令牌。Windows 的注册和启动脚本有结构测试；Windows 真机尚需验收。

### 客户端差异

- Codex：只增量添加带标记的 `mcp_servers.brevess` TOML 块，保留其他配置。
- DSH：只在 `$DSH_HOME/cordis.patch.yml`（默认 `~/.dsh/cordis.patch.yml`）添加一个 `insert` 补丁，不改写官方应用内部文件。完全退出再打开 DSH 后验证。
- JSON/JSONC 客户端：只插入 `mcpServers.brevess`，保留注释、其他服务和现有配置内容。同名非托管条目存在时停止，不覆盖。
- Kimi：当前 Kimi Code 使用 `~/.kimi-code/mcp.json`，支持 `KIMI_CODE_HOME`。若本机实际是旧 Kimi CLI（`~/.kimi/mcp.json`），先用该版本官方 `kimi mcp add` 导入生成的命令，不能只写新路径然后声称成功。
- CodeBuddy：遵循官方文件优先级 `.codebuddy/.mcp.json`、`.codebuddy/mcp.json`、`.codebuddy.json`，保留现有有效文件。
- Qoder：这里对应当前统一客户端 / CLI 的 `~/.qoder/settings.json`。旧 IDE 或 Qoder CN 路径以其官方 MCP 界面为准，不能仅凭同名产品推断。
- TRAE / 通用客户端：安装器生成 stdio JSON 后返回 `client-setup-required`；由 Agent 在官方 MCP 设置中导入并检查启用状态。
- OpenCode：V1 与 V2 配置层级不同，使用已安装版本的官方 `mcp add` 命令及生成 JSON 中的命令、参数；不要混用 `mcp.brevess` 和 `mcp.servers.brevess`。

安装后重载扩展，再点击「连接并测试」；插件会自动打开工作台。手动配对、断开与移除入口收在「高级选项」。安装器的 `configured-not-tested` 只代表文件写入成功。必须继续调用真实工具和模型才算完成。

### 验收

1. 在客户端发现并调用 `brevess.status`、`brevess.capabilities`、`library.query_global_library`，读到真实浏览器数据。插件需要打开工作台作为 MCP 主机。
2. Codex / DSH 再分别从 BREVESS 调用一个合成文本任务和 JSON 任务。官方目录允许图片时，使用非敏感小图片检查图像输入。
3. 写入测试只使用明确标记的验收课题：批准短期任务范围、创建节点、回读、刷新后检查，再验证撤销。不要删除或覆盖用户已有课题。
4. 把“配置完成、账号待登录、模型可生成、MCP 可读取、写入已回读”分别记录。新 MCP 配置可能要在客户端新会话中发现。

### 恢复

每次实际改变文件都会生成私有备份与 `receipt.json`，路径由安装器返回。备份可能包含客户端原配置，禁止上传或放入公开验收包。

```sh
node scripts/setup-agent-connection.mjs --restore "/绝对路径/receipt.json"
```

恢复前校验全部文件和备份哈希；如果安装后有新的用户修改，停止恢复以免覆盖。恢复不会删除研究资料、登录信息或聊天历史。已连接客户端应先关闭连接，再恢复配置。安装器依赖的 Node 路径失效时重新运行接入提示词修复。

## 官方参考

核对日期：2026-11-17。配置入口会随客户端版本变化，安装后须实测。

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
