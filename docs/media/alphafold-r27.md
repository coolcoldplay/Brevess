# AlphaFold 实测素材 · 1.0.2 r27

采集日期：2026-11-17。环境：macOS、Google Chrome 原生扩展侧栏，BREVESS 1.0.2 r27。模型配置显示为 DeepSeek V4.1 Flash（`deepseek-flash`）。

## 论文归属

Jumper, J., Evans, R., Pritzel, A. et al. [Highly accurate protein structure prediction with AlphaFold](https://www.nature.com/articles/s41586-021-03819-2). *Nature* **596**, 583–589 (2021). DOI: 10.1038/s41586-021-03819-2。

原文及展示的 Figure 1 按 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) 使用。AI 中文输出属于插件生成内容，不属于原论文，也不代表作者认可。

## 实际操作

- 在同一篇 AlphaFold 原文页选择 Figure 1 图像输入，生成 A–E 的 Panel 解读，展开 1A 证据字段。
- 要求用表格比较 Evoformer、结构模块、recycling 的输入、操作、作用和原文依据。
- 实际返回 3 行、5 列表格与引用；点击引用跳转原文，再打开独立表格阅读窗口。

`r27-figures-*.webp`、`r27-chat-*.webp` 为真实窗口画面的裁剪与压缩，去掉浏览器标签栏、账户区域和图片元数据；未重写或拼造 AI 答案。当时的 `r27-*.webm` 为关键画面剪辑，不是连续录屏。视频资源已于 2026-11-18 从当前官网移除，历史版本仍可从 Git 查看。

README 保留早期版本的导航、高亮、笔记和工作台截图。官网现改为真实 UI 组件运行的交互体验，详见[交互体验说明](interactive-website.md)。预置解读与规划内容是演示数据，不作为真实模型实测结果或速度证据。

## 范围和限制

本次演示证实上述解图、问答、引用定位和表格展开的实际流程。补充图目录抓取仍不完整；AI 科学解读没有经过全面人工核验。完整自动回归仍有失败与超时，因此源码及浏览器包以预览版发布。
