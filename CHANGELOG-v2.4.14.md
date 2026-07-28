# 2.4.14：本机 Codex 登录与真实连接修复

## 已修复

- 本机桥现在使用 `%LOCALAPPDATA%\SCIReaderCodexBridge\codex-home` 作为插件专用
  `CODEX_HOME`，不再与 Codex Desktop、Codex CLI 或其他 App Server 进程共享刷新令牌。
- 设置页新增插件专用 Codex 的登录、状态刷新和退出入口；网页登录完成后会自动检测。
- 健康检查不再主动刷新令牌，避免只为显示状态而消耗或轮换认证信息。
- “测试连接”在账户检查后会执行一次不保存线程的真实模型回合，避免“测试成功、
  正式问答失败”的假阳性。
- 本机 App Server 启动时禁用 shell 和 web search，并使用隔离配置目录，
  避免用户全局 MCP 配置或失效的第三方服务拖累全文问答。
- 对未登录、额度耗尽、上下文不足、502/503/504 与服务过载分别显示可操作错误，
  不再全部折叠成 “Local Codex rejected the request”。
- 新增 `native-host/login.ps1`，可在设置页登录不可用时为插件专用目录执行备用登录。

## 升级注意

2.4.14 首次使用“本机 Codex”时需要在插件设置页单独登录一次。这个登录不会退出或
覆盖 Codex Desktop、Codex CLI 的现有会话。
