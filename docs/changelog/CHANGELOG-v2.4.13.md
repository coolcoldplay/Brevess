# v2.4.13 · 本机 Codex 全文问答

- 新增“本机 Codex”模型提供商，无需在插件内填写 API Key。
- 新增 Windows Native Messaging Host 和一键注册/卸载脚本。
- 通过 Codex App Server JSON-RPC 接收流式回答。
- 每篇论文、每个 Profile 持久化独立 Codex thread。
- 全文问答取消操作会调用 `turn/interrupt`，保留已经完成的回答块。
- Codex 桥以只读 sandbox 运行，关闭审批并禁止工具调用。
- 增加 Codex 安装、登录、桥接断开等分层错误提示。
- 现有 OpenAI、DeepSeek、Claude、Gemini 和兼容接口保持不变。
