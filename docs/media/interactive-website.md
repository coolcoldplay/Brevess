# 官网交互体验

官网的侧栏、文献雷达和课题工作台直接运行 BREVESS **1.0.2 r27 Adaptive Figures r10** 的 HTML、CSS 和界面代码。它们由源码导出，不是重新画的近似界面；宿主页只提供论文节选、划句工具、引导提示和展开容器。

## 代码与数据

- `docs/assets/demo/native/`：插件原界面文件；`source-manifest.json` 记录版本、文件尺寸和 SHA-256。原 JavaScript、CSS 不作改写；HTML 入口仅注入隔离适配器、网络策略与 defer 标记，使原脚本并行下载、按文档顺序执行。
- `native-*.js`：用内存存储替代扩展通信和本机服务，仍调用原有渲染器、文献资源投影、画布模型、编辑与拖动逻辑。表格放大使用原表格阅读器。
- `paper-data.js`：公开论文节选、人工整理的示例解读和翻译。不读取本机阅读记录、浏览器配置或 API Key。
- AI 按钮揭示预置内容，不发起模型请求，过渡时间不表示模型生成速度。账号、后台追踪和本机文件接入在安装后的插件中使用。
- 体验中的编辑、摘句和画布修改保存在内存；重置或刷新即清除。Markdown 导出由用户主动触发。官网原有的语言偏好保留方式不变。

## 论文与授权

Jumper, J. et al. [Highly accurate protein structure prediction with AlphaFold](https://www.nature.com/articles/s41586-021-03819-2). *Nature* **596**, 583–589 (2021). DOI: 10.1038/s41586-021-03819-2。

论文节选与 Figure 1–5 按 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) 使用。图像来自论文原图；页面按阅读尺寸显示。节选省略文献引用编号。翻译、解读与研究规划为另行编写的演示内容，不代表原作者的结论或认可。

插件源码使用 AGPL-3.0-or-later；原组件的 LICENSE 和 THIRD_PARTY_NOTICES 随导出保留。Mermaid 的 MIT 授权另见 `docs/assets/demo/licenses/mermaid-MIT.txt`，其打包依赖声明仍保留在原 vendor 文件中。

## 构建与验证

在仓库根目录运行（Node 22 或更新版本）：

```sh
node scripts/build-website-demo.mjs
node scripts/verify-website-demo.mjs
python3 -m http.server 8764 --directory docs
```

默认从 `extension/` 导出。需要预览另一个已检出的插件版本时，显式指定源目录：

```sh
node scripts/build-website-demo.mjs --source /path/to/current-extension
```

打开 `http://localhost:8764/#features`。校验器检查原组件逐文件一致性、入口引用、适配器语法、遗留视频链接、意外导出的测试文件、本机路径、常见密钥格式和图片元数据。它不是完整插件回归，也不证明第三方模型回答质量。

## 浏览器验收

本轮在 Chromium 中实测：

- 底部五个模块切换、双击显示预置内容；提示可关闭和重新打开。
- 实际鼠标划选、段落翻译、手动备注、高亮后再次打开备注。
- Figure 色块跳转；选择 Fig 2 与 Fig 4 后仅处理两图，取消多选后处理五图；Panel 展开与编辑。
- 问答发送、删除与重新生成；MSA 证据引用回到对应原文；原表格阅读器的放大、调节文字与关闭。
- 笔记生成、编辑保留、原 Markdown 导出。
- 侧栏编辑后的图解保存进体验文献库；将 Panel 拖入假说节点和组图规划，确认引用随真实画布模型保存。
- 雷达已读状态切换；文献库和画布模块切换。
- 390 × 844 窄屏无页面横向溢出，原文和侧栏切换可用。完整工作台保留桌面布局，可横向滚动。

旧 MP4、WebM、GIF 演示和播放器已从当前官网移除；README 保留的历史截图有单独的采集说明。
