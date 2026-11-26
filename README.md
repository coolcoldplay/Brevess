<p align="center"><img src="extension/icons/Brevess-logo.svg" alt="BREVESS logo" width="72"></p>
<h1 align="center">BREVESS · 布理维思</h1>
<p align="center"><strong>Brevity · Evidence · Essence</strong></p>
<p align="center">快速凝练真实、有用的信息，构建知识结构，推动科学研究。</p>
<p align="center">Chrome / Edge · 免费开源 · 中文 / English · 本机 Agent / 模型 API</p>
<p align="center"><a href="https://coolcoldplay.github.io/Brevess/"><strong>官网 · 交互体验</strong></a> · <a href="https://github.com/coolcoldplay/Brevess/releases/tag/v1.0.2-r27-reader-r23.1"><strong>1.0.2 · r23.1</strong></a> · <a href="docs/使用教程.md">使用教程</a></p>

**大部分功能支持手动完成，也可由 AI 辅助。** 从大纲、标注和笔记，到证据整理、假说与组图规划，按自己的节奏积累知识。

## 五个阅读模块

**大纲 → 高亮 → 解图 → 问答 → 笔记**

**[直接体验真实侧栏与工作台](https://coolcoldplay.github.io/Brevess/#features)**：划句、翻译备注、展开 Figure / Panel、问答和编辑笔记；保存后将材料拖入课题。无需登录或填写 API Key，AI 为预置示例。

以下截图均使用 **AlphaFold 2 的 Nature 原论文**。图解与问答展示模型生成的阅读示例，大纲、高亮和笔记展示同一篇论文的阅读过程。

### 1. 大纲

先看论文结构，再进入段落；需要时由 AI 辅助概述，点击标记回到原文。

![大纲：AlphaFold 原文与段落概述并排阅读](docs/assets/site/real-navigation-after.webp)

[亲手体验大纲](https://coolcoldplay.github.io/Brevess/#features)

### 2. 高亮

手动标记重要句子，或让 AI 按背景、问题、方法与结果梳理正文。

![高亮：在 AlphaFold 原文中提取关键信息](docs/assets/site/real-highlights-after.webp)

[亲手体验高亮](https://coolcoldplay.github.io/Brevess/#features)

### 3. 解图

原图与解读并排，逐 Figure / Panel 查看目的、设计、观察和结论，继续追问或手动修订。

![解图：AlphaFold Figure 1 与真实 Panel 解读](docs/assets/site/r27-figures-after.webp)

[亲手体验解图](https://coolcoldplay.github.io/Brevess/#features)

### 4. 问答

在侧栏与大模型讨论论文：比较 Evoformer、结构模块与 recycling，追问方法与结论，再循着回答中的引用核对原文。

![问答：AlphaFold 原文与侧栏中的 DeepSeek 讨论、解释和引用](docs/assets/site/r27-chat-citation.webp)

[亲手体验问答](https://coolcoldplay.github.io/Brevess/#features) · [查看宽表格展开示例](docs/assets/site/r27-chat-table.webp)

### 5. 笔记

把研究背景、科学问题与主要发现整理为笔记；可手动编辑，也可让 AI 辅助填写。

![笔记：将 AlphaFold 阅读所得整理为知识结构](docs/assets/site/real-notes-after.webp)

[亲手体验笔记](https://coolcoldplay.github.io/Brevess/#features)

论文及图表：Jumper et al., [Nature (2021)](https://www.nature.com/articles/s41586-021-03819-2)，[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)。保留的截图未改写 AI 回答；官网现已改为可点击的交互体验，AI 结果为预置示例。[素材记录与限制](docs/media/alphafold-r27.md)。

## 课题工作台

**文献雷达 → 文献总库 → 假说梳理 → 组图规划**

| [1. 文献雷达](https://coolcoldplay.github.io/Brevess/#workbench) | [2. 文献总库](https://coolcoldplay.github.io/Brevess/#workbench) |
| :---: | :---: |
| ![文献雷达操作示例](docs/assets/site/wb-radar-poster.webp) | ![文献总库操作示例](docs/assets/site/wb-library-poster.webp) |
| 保存检索式，追踪文献与阅读状态。 | 汇集文献，查找来源与阅读记录。 |

| [3. 假说梳理](https://coolcoldplay.github.io/Brevess/#workbench) | [4. 组图规划](https://coolcoldplay.github.io/Brevess/#workbench) |
| :---: | :---: |
| ![假说梳理操作示例](docs/assets/site/wb-hypothesis-poster.webp) | ![组图规划操作示例](docs/assets/site/wb-figures-poster.webp) |
| 用节点与连线组织机制，关联支撑证据。 | 按 Figure / Panel 规划实验与论证顺序。 |

从手动整理开始，也可借助 AI 辅助完善研究思路。支持多套方案、本机保存、撤销重做与导入导出。

以上工作台截图为**早期版本实录**。点击模块标题可进入使用 r18 界面组件的[官网工作台](https://coolcoldplay.github.io/Brevess/#workbench)，体验材料引用、画布编辑和撤销。

## 不止论文

网页与 AI 对话也是阅读材料。用 BREVESS 的真实组件体验划句翻译、高亮备注、大纲跳转、语义检索和网页问答。

[体验 GitHub 与 ChatGPT 场景](https://coolcoldplay.github.io/Brevess/#beyond-papers) · 还原 GitHub 仓库界面与完整 README，并呈现经授权的完整 ChatGPT 对话。三个场景整屏切换，AI 辅助为预置交互示例。

## 安装预览版

1. [下载浏览器 ZIP](https://github.com/coolcoldplay/Brevess/releases/download/v1.0.2-r27-reader-r23.1/Brevess-v1.0.2-r23.1-Chrome.zip)，解压到独立文件夹。
2. 打开 `chrome://extensions/`（Edge 使用 `edge://extensions/`）→ 开发者模式 → 加载已解压的扩展程序，选择包含 `manifest.json` 的文件夹。
3. 固定 BREVESS 图标，在论文全文页打开侧栏。首次打开设置时，可在快速配置中选择保存目录、确认隐私提示并连接默认模型。

大纲导航、离线规则、手动高亮、笔记编辑和工作台无需 API Key。部分增强功能需要可选本机伴侣，当前浏览器 ZIP 不包含本机二进制。

**r23.1 公开预览版**支持在设置中连接 Google Antigravity 等本机 Agent，在普通问答中选择客户端提供的模型与推理强度。论文大纲随正文加载更新，识别为同一篇论文的网页与 PDF 可共用高亮、备注、问答和笔记，保存 PDF 时可将原文件附到该文献。[Agent 接入指南](docs/AGENT_QUICK_CONNECT.md) · [版本说明](https://github.com/coolcoldplay/Brevess/releases/tag/v1.0.2-r27-reader-r23.1)。

## 源码与构建

插件源码集中在 [`extension/`](extension/)，构建脚本在 `scripts/`，回归测试在 `tests/`，官网和文档在 `docs/`。

从 GitHub 克隆或下载源码后，Chrome「加载已解压的扩展程序」选择 **`extension/` 文件夹**。Release ZIP 的安装方式不变，仍选择解压后直接包含 `manifest.json` 的文件夹。

Node.js 20+，以下命令均在仓库根目录运行：

```sh
npm ci
npm run test:chrome-store
npm run build:public -- --name Brevess-Public-v1.0.2
```

公开预览包保留现有扩展标识，产物位于 `dist/<名称>/`。另需准备商店上传包时：

```sh
npm run build:chrome-store -- --name Brevess-Chrome-v1.0.2
npm run verify:chrome-store -- dist/Brevess-Chrome-v1.0.2
```

`npm test` 运行完整现有回归；已知范围见[发布检查说明](docs/chrome-store/RELEASE_READINESS.md)。构建与许可见 [OPEN_SOURCE.md](extension/OPEN_SOURCE.md)。

## 联系与赞赏

[brevess0729@163.com](mailto:brevess0729@163.com) · [反馈问题](https://github.com/coolcoldplay/Brevess/issues)

| 微信赞赏 | 支付宝赞赏 |
| :---: | :---: |
| <img src="docs/assets/support/wechat-plugin-display.png" alt="微信赞赏二维码" width="150"> | <img src="docs/assets/support/alipay-plugin-display.png" alt="支付宝赞赏二维码" width="150"> |

[完整教程](docs/使用教程.md) · [版本记录](https://github.com/coolcoldplay/Brevess/releases) · [隐私政策](docs/privacy-policy.md) · [AGPL-3.0-or-later](LICENSE)
