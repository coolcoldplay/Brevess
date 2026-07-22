# build39 优化说明

build39 基于 build38 冻结点 `389ab42`，重点降低全文高亮和 Figure/Panel 解读中的重复 Token、输出截断与无效重算，同时保持旧模型接口可降级使用。

2.4.2 Panel 修复版会检测网页异步补全或替换的 Figure caption，并自动废弃过早建立的目录缓存；本地解析同时覆盖 Nature 常见的 `a`、`b–d`、`e,f` 紧凑标记，即使 DOM 内联标签导致标点附近没有空格也能恢复 A–F 目录。

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
