# Brevess 持久化兼容标识

Brevess 的界面、文档标题、文件名、构建产物和导出展示统一使用 `Brevess`。
以下字符串仍保留在代码中，因为它们已经写入用户设备或注册到浏览器协议中，
属于非展示型兼容标识：

- `sci-logic-highlighter*`：IndexedDB 数据库名、工作区清单 `kind` 和旧归档格式标识。
- `com.sci_reader.codex_bridge`：Chromium Native Messaging host ID。
- `SCI-Highlighter`：1.0.0 之前创建的本地工作区目录名，仅用于读取旧目录。
- `SCIReaderCodexBridge`：1.0.0 之前的本机 Codex 数据目录，仅用于安装和登录迁移。

新选择的本地目录会创建 `Brevess` 工作区，新安装的本机桥使用
`%LOCALAPPDATA%\BrevessCodexBridge`。安装脚本会复制旧桥接目录中的会话和线程映射；
目录同步会在新的 `Brevess` 工作区不存在时回退读取旧工作区。

这些兼容值不能只做字符串替换。若未来需要移除，必须先提供可恢复、可验证的数据迁移，
并同时兼容既有归档、IndexedDB、Native Messaging 注册和本地文件夹。
