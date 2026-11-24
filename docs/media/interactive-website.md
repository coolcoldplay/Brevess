# 官网交互体验

官网的侧栏、文献雷达和课题工作台直接运行 BREVESS **1.0.2 r18** 的 HTML、CSS 和界面代码。划句弹窗也直接导出插件组件，使用原 `content.css`；宿主页提供论文节选、引导提示和展开容器。手机端通过独立的触屏适配层，将同一套原组件重排为竖屏全屏体验；电脑端保留并排布局。

## 代码与数据

- `docs/assets/demo/native/`：插件原界面文件；`source-manifest.json` 记录版本、文件尺寸和 SHA-256。原 JavaScript、CSS 不作改写；HTML 入口仅注入隔离适配器、网络策略与 defer 标记，使原脚本并行下载、按文档顺序执行。
- `native-*.js`：用内存存储替代扩展通信和本机服务，仍调用原有渲染器、文献资源投影、画布模型、编辑与拖动逻辑。表格放大使用原表格阅读器。
- `scripts/website-selection-export.mjs`：导出完整划句、定位/拖动、正则匹配、双语翻译块与高清图查看器函数。构建清单逐函数记录 SHA-256，防止后续维护时误换成近似界面。
- `highlight-examples.js`：复用插件的类别定义，增加明确标注的“论文术语”示例情境。正则实际匹配原文；LLM 使用与原文偏移对应的 8 处预置语义标注。侧栏的类别、短语/整句模式、置信度分布、高亮分布和来源开关均使用原组件。
- `paper-data.js`：公开论文节选、人工整理的示例解读和翻译。不读取本机阅读记录、浏览器配置或 API Key。
- `native-reader-tools.js` / `native-sidebar-tools.js`：原版语义搜索、双语翻译、大纲和缩略词表的网页接入。`reading-tools-data.js` 提供公开节选的译文、术语释义与三组明确标注的检索示例；语义搜索阈值、定位和转备注实际执行。未覆盖的问题会说明示例范围。
- `native-image-tools.js`：原版图片悬停工具、局部放大镜、尺寸拖动、图片笔记和标注编辑器。高清查看器在论文区的独立框架内运行，保留旁边的侧栏和原版图注联动。预览在浏览器中缩至 600 px，HR 使用已下载的完整公开图片，重复查看复用同一资源。
- AI 按钮揭示预置内容，不发起模型请求，过渡时间不表示模型生成速度。账号、后台追踪和本机文件接入在安装后的插件中使用。
- 划句翻译支持准备好的原句与术语，其他选区会明确说明缺少预置译文。完整自定义规则编辑、任意问题推理和任意文本翻译需安装插件；演示入口会说明边界。
- 体验中的编辑、摘句、图片笔记/标注、缩略词与画布修改保存在内存；重置或刷新即清除。图片笔记同步到 Figure 备注，随侧栏保存进入体验文献库。Markdown 导出由用户主动触发。官网原有的语言偏好保留方式不变。

## 论文与授权

Jumper, J. et al. [Highly accurate protein structure prediction with AlphaFold](https://www.nature.com/articles/s41586-021-03819-2). *Nature* **596**, 583–589 (2021). DOI: 10.1038/s41586-021-03819-2。

论文节选与 Figure 1–5 按 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) 使用。图像来自论文原图；页面按阅读尺寸显示。节选省略文献引用编号。翻译、解读与研究规划为另行编写的演示内容，不代表原作者的结论或认可。

插件源码使用 AGPL-3.0-or-later；原组件的 LICENSE 和 THIRD_PARTY_NOTICES 随导出保留。Mermaid 的 MIT 授权另见 `docs/assets/demo/licenses/mermaid-MIT.txt`，其打包依赖声明仍保留在原 vendor 文件中。

## 构建与验证

在仓库根目录运行（Node 22 或更新版本）：

```sh
node scripts/build-website-demo.mjs
node scripts/build-website-runtime.mjs
node scripts/verify-website-demo.mjs
python3 -m http.server 8764 --directory docs
```

默认从 `extension/` 导出。需要预览另一个已检出的插件版本时，显式指定源目录：

```sh
node scripts/build-website-demo.mjs --source /path/to/current-extension
```

打开 `http://localhost:8764/#features`。校验器检查原组件逐文件一致性、划句组件逐函数一致性、入口引用、适配器语法、遗留视频链接、意外导出的测试文件、本机路径、常见密钥格式和图片元数据。它不是完整插件回归，也不证明第三方模型回答质量。

`build-website-runtime.mjs` 从上述原文件生成 `assets/demo/fast/` 入口：按原顺序合并专用经典脚本，较大的公共依赖保留独立引用，供宿主页与各模块复用缓存；原作用域和界面不变，Mermaid 在首次绘图时加载。内容哈希用于缓存；清单记录每个输入与输出的 SHA-256。修改适配器或重新导出原组件后运行此构建，校验器会拒绝过期产物。官网在首个侧栏就绪后利用空闲时间依次准备工作台和网页体验；省流量或 2G 连接仅在进入模块时加载。

## 网页阅读场景

「不止论文」包含项目公开仓库和已公开的对话示例。两个场景共用阅读侧栏，可试用原文划选、备注、检索和带引文的问答。GitHub 标志归 GitHub 所有，来自[官方图标](https://github.githubassets.com/favicons/favicon.svg)。

桌面上可以并排阅读原文和侧栏，手机上可以在二者之间切换。顶部标签用于切换论文精读、课题工作台与网页阅读。演示中的编辑保存在当前页面内存，刷新后回到初始内容。
