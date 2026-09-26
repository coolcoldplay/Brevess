# 2.4.23：Cell Results 完整提取与缩写表原文跳转

## Cell 导航大纲

- 修复 Cell Figure/视频区域的隐藏 `Info`、`Accessibility & Keyboard Shortcuts`、`Download Options`、`Transcript` 等 H2 标题打断 Results 层级的问题。
- 进一步排除视频播放器内部的 `Settings`、`Playback Speed`、`Quality`、`Subtitles` 等 H3 控件标题。
- 功能控件现在依据 `.video-player`、`.video-playback`、`.video-player-modal`、`.transcript-panel` 等 DOM 祖先精确剔除，不再作为需要屏蔽后续同层级标题的正文容器。
- 使用《CSF clearance through arachnoid fenestrations to olfactory meningeal lymphatics》的实际 Cell 页面复核：Results 下恢复 10 个真实小标题，视频控件标题泄漏为 0。

## 全文缩写表

- 每个缩写在本地提取完成后，会再次扫描正文并记录其首次字面出现的段落定位信息。
- 缩写列和全称列均改为可点击、可键盘聚焦的跳转按钮。
- 点击任一词条会关闭缩写表，并平滑定位和短暂强调该缩写在正文中首次出现的段落。
- 使用完整词边界匹配，避免把 `cDC2a` 中的字符误认为 `cDC2` 的首次出现位置。

## 品牌与高亮兼容

- 扩展工具栏、扩展管理页和设置页统一使用新的 Brevess Logo，并生成 16、32、48、128 像素的透明 PNG 图标。
- 原生侧栏标题更新为“论文阅读助手Brevess：Brevity · Evidence · Essence”。
- 修复章节分析范围中的稳定段落 ID 与网页 DOM 段落 ID 不一致、导致正则模式错误跳过全部正文的问题；当前同时保留 `paragraphId` 与 `sourceKey` 参与范围判断。

## 验证

- 新增 Cell 真实 Results 标题序列、播放器 DOM 祖先过滤、缩写首次出现定位、界面跳转、品牌资源和段落 ID 兼容测试。
- 全量自动化测试：1041 项通过。
- 运行修订：`2.4.23-build43-cell-results-abbreviation-jump-r1`。
