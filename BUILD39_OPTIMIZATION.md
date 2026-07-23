# build39 优化说明

build39 基于 build38 冻结点 `389ab42`，重点降低全文高亮和 Figure/Panel 解读中的重复 Token、输出截断与无效重算，同时保持旧模型接口可降级使用。

2.4.6 出版社聚焦版以真实页面 DOM 为依据补充单栏规则：Cell Press 旧版隐藏 `.core-sections-menu-outer`、`.core-collateral-aside` 与 `.core-header-aside` 并把三列内容网格收敛为一列；新版 ScienceDirect 隐藏粘性目录与 `RelatedContent` 两侧列；Nature、Springer Link、PLOS、Frontiers、ACS、JAMA、bioRxiv 等使用各站实际侧栏节点，并同步放宽正文的父级网格、浮动或固定宽度。真实注入回归中，Nature、Springer Link、PLOS、Frontiers 的正文分别扩展到 1248、1248、980、1536 px，bioRxiv 从 650 px 扩展到 1090 px。无法绕过 Cloudflare 的站点仍需要用户导出的完整 HTML 或适配诊断包做最终确认，不以合成页面替代。

2.4.6 同时修复悬浮图钉的静默失败：不再因缺少 Document Picture-in-Picture 而直接禁用按钮；系统窗口创建超过 4.5 秒会自动回退到独立扩展窗口；窗口坐标超出可见屏幕时会移除手动坐标重试；`null` 不再被误判为窗口 ID `0`。Edge 端到端测试同时覆盖真正的跨软件置顶窗口与兼容独立窗口，两者都绑定原论文标签页、支持跨标签页保持和图钉关闭。兼容窗口不承诺系统级 always-on-top，并在界面中明确提示升级浏览器。

2.4.5 Panel 修复版会在 Nature 等分层 Figure DOM 中选择 Panel 信息最完整的 caption 来源，覆盖 `a-c`、`d-f`、`g,h`、`i,j` 等逗号、句点与区间组合；检测到包含多个不同 Figure 身份的聚合容器时会将其排除，并拒绝使用身份不一致的 caption，防止编号、图片、Panel 和定位目标跨图串位。对 Nature `bottom-caption` 优先读取加粗的结构化 Panel 标记，避免把 `n.c.`、`T cells`、`Mann–Whitney` 等图注缩写误识别为 Panel。目录缓存采用 MutationObserver 精确置脏、普通读取直接复用，并保留 2 秒低成本兜底检查，避免侧栏快照反复遍历所有 Figure 造成页面卡顿。

2.4.5 同时启用出版社单栏正文模式。内容脚本先记录当前适配器家族，再由限定在 `data-sci-reader-single-column=true` 下的 CSS 隐藏 16 类已适配出版社的文章目录、右侧导航和阅读伴侣，并将正文容器恢复为无浮动、单一网格列和全可用宽度。通用回退只处理带 article/content 语义标签的 `nav`、`aside` 或 `role=navigation`，避免误伤正文。由于 Edge 未向扩展开放修改原生侧栏宽度的接口，此方案直接让出版社网页切换为单栏，达到正文不再保留站内导航栏的目标。

悬浮置顶窗口修复了 iframe 加载竞态：先注册 `load/error` 监听再挂载 iframe，并在呈现窗口内容的同时异步同步跨标签页图钉状态。这样即使 iframe 命中缓存，也不会因错过 `load` 事件等待 5 秒后关闭；后台同步较慢时，悬浮窗口也能先显示内容。

侧栏标题栏的齿轮改为直接打开 `options.html#categoryWorkspace`，即“类别规则/识别规则与模型设置”工作区；适配诊断包入口移至当前论文全局工具栏的虫形图标。

## 全文高亮

- 新增紧凑的 Claim Census 协议。模型只判断类别代码、原文显示片段、支持片段、证据角色、槽位和证据来源，不再生成 ID、relation ID、occurrence、confidence 或 reason。
- 输出使用逐段 NDJSON；每完成一个段落立即验证、缓存并向页面发送 checkpoint。
- 输出被截断时保留已完成段落，下一次只提交缺失段落。关闭浏览器或请求失败后也能从段落 checkpoint 恢复。
- 显示片段与支持片段分离：只有显示片段着色，支持片段作为可核验的证据元数据保留。
- 系统策略前缀固定；类别 DSL 和论文原文作为不可信数据序列化，降低提示注入风险并提高前缀缓存稳定性。
- 不支持流式文本的接口继续使用 build38 的严格 JSON 协议。

## Figure 与 Panel

- Figure 批处理使用 `figure-context-v1`：共享图例、当前批次 Panel 图注切片、去重正文注册表、Panel 到正文引用、分组/方法/实验设置注册表。
- 不再把完整 Figure 图注和全部正文段落重复发送给每个 Panel 批次。
- 方法字段改为开放词表。模型返回有原文依据的方法名称，本地生成 `methodText`、`methodFamily` 和 `normalizedMethod`；已知别名会统一，未知新技术会保留而不会丢弃。
- 单 Panel 请求生成稳定 `panel-ir-v1`，集中保存图注切片、正文证据和已有解读。
- Panel 追问不再携带最多 100 条原始历史：保留最近 5 条，并从更早历史中检索最多 4 条与当前问题相关的记录；仍受同一上下文预算约束。

## 容量、缓存与兼容性

- 高亮缓存协议升级为 `10-ndjson-census`，分块协议升级为 `5-paragraph-checkpoint`，避免复用 build38 的旧响应形状。
- Figure 分析版本升级为 `9-figure-context-open-methods`，Panel 提示版本升级为 `2-panel-ir-memory`。
- 流式调用现在统一获得任务级输出 Token 预算；显式传入的 Panel/全文问答预算仍优先且受模型上限约束。
- 本地派生字段采用稳定散列，不依赖模型随意命名，也不因一次截断续传而变化。

## 量化结果

`npm run benchmark:build39` 使用固定代表性输入比较新旧请求：

- 全文高亮提示从 12,077 字符降至 5,379 字符，减少 55.5%。
- Figure Panel 批次上下文从 10,413 字符降至 7,094 字符，减少 31.9%。

这些数字衡量的是固定基准输入的请求体积，不代表所有论文的 API 计费比例；图片 Token 和不同模型的分词方式仍会影响实际消耗。

## 本轮有意不自动上线的部分

- 高风险类别的二阶段 Evidence Adjudication 与全局关系链接器，需要有专家金标准语料后再设阈值，避免为节省 Token 引入不可见的漏检。
- 47 类重构为正交 claim/evidence graph 会改变现有颜色、缓存和历史数据语义；build39 保留兼容类别映射，待迁移方案与语义基准齐备后再切换。
- Panel 类型专用微提示词，以及“视觉事实提取 → 科学证据整合”的深度双阶段流程，需用显微图、WB、流式图、UMAP 和生存曲线等真实图集分别验收后再启用。
- 自适应密度控制器目前由逐段续传和分块降级替代；待收集真实供应商 usage 遥测后再按类别密度动态调整批次大小。
- Provider 实际 usage 的动态 Token 校准尚未写回规划参数，以免少量早期样本把兼容接口的能力估计带偏。
- 本地 confidence 是透明的规则分数，不宣称是统计校准概率。后续应在盲评集上做可靠性校准。

## 验证命令

```bash
npm test
npm run benchmark:build39
npm run test:edge-side-panel
npm run test:edge-restart
npm run build:unpacked
```
