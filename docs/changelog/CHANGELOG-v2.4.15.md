# 2.4.15：本机 Codex 视觉解图与反向事件通道

## 修复

- 修复本机 Codex 被错误标记为不支持视觉的问题。旧版会在网页端直接跳过 Figure 图片，
  因而所有结果都显示为“仅使用图注与正文”。
- 修复 `providers/codex-local.js` 丢弃 `request.images` 的问题。
- 修复 Native Messaging `turn.start` 只有文本输入的问题。

## 新增

- 网页提取的 Figure JPEG/PNG/WebP 会由本机桥安全落成临时文件，并通过 Codex App
  Server 的 `localImage` 输入发送给模型。
- 每轮最多传递 8 张图片，单张上限 4 MB、合计上限 24 MB；请求结束后自动清理临时文件。
- 新增插件到本机桥的反向事件协议：
  `reader.figure.*`、`reader.panel.*` 和 `reader.cross_figure.*`。
- 最新事件写入 `reader-events/latest.json`，完整事件追加到
  `reader-events/events.ndjson`；设置页会显示实际路径。
- Native Host 升级到 1.2.0。

## 验证

- 单元测试覆盖图片转存、App Server `localImage` 输入、请求结束清理、事件确认与事件账本。
- 使用真实插件截图完成模型级测试，本机 Codex 从图片像素中返回
  `{"figure_count":8}`。
- 反向事件探针已实际写入本机 `latest.json` 和 `events.ndjson`。
