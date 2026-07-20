# 开放获取论文准确性基准

## 目的

这组固定样本用于检查三种阅读视图和八种研究类型下的证据等级边界。它不是用关键词命中率代替人工判断，而是持续测试最容易误报的结构：相关与因果、内部与外部验证、统计与实际意义、普通改善与机制补救，以及通路富集与机制证据。

## 样本矩阵

| 主要类型 | 论文 | 核心压力测试 |
| --- | --- | --- |
| 基础机制 | [C1q and immunoglobulins mediate activity-dependent synapse loss](https://www.science.org/doi/10.1126/science.adv1219) | association / causal effect / necessity / rescue |
| 临床前转化 | [Computational translation of genomic responses from experimental model systems to humans](https://pmc.ncbi.nlm.nih.gov/articles/PMC6343937/) | 跨物种验证不等于临床获益 |
| 观察性 | [Confounding mechanisms and adjustment strategies in air pollution epidemiology](https://pmc.ncbi.nlm.nih.gov/articles/PMC12448834/) | 调整后关联、空间混杂、方向翻转 |
| 临床试验 | [Open-label placebo treatment in chronic low back pain](https://pmc.ncbi.nlm.nih.gov/articles/PMC5113234/) | 主要结局、探索性随访、效应量与区间 |
| 诊断/预后 | [Localization-adjusted diagnostic performance and assistance effect](https://pmc.ncbi.nlm.nih.gov/articles/PMC9339006/) | AUROC、校准、参考标准、外部验证、临床效用分离 |
| 组学/高通量 | [Batch effect detection and correction in RNA-seq data](https://pmc.ncbi.nlm.nih.gov/articles/PMC9284682/) | 批次校正不等于生物机制或独立重复 |
| 系统综述/Meta | [Ferrous bisglycinate supplementation systematic review and meta-analysis](https://pmc.ncbi.nlm.nih.gov/articles/PMC10331582/) | 合并效应、异质性、偏倚与证据确定性分离 |
| 方法/资源 | [POIBM batch correction through latent sample matching](https://pmc.ncbi.nlm.nih.gov/articles/PMC9048693/) | 基准比较、参数敏感性、独立数据与适用边界 |
| 基础机制 | [Conditional Casq2 ablation and rescue models](https://pmc.ncbi.nlm.nih.gov/articles/PMC5905597/) | 条件敲除、细胞类型特异性、时序恢复与部分 rescue 分离 |
| 临床前转化 | [Patient-derived xenograft humanised mouse model](https://pmc.ncbi.nlm.nih.gov/articles/PMC6145285/) | 人源化小鼠不等于人体试验，模型可行性不等于临床获益 |
| 观察性 | [Perioperative plasma NGAL and 3-year mortality](https://pmc.ncbi.nlm.nih.gov/articles/PMC4460181/) | 调整后关联、追加协变量后关联消失、预后价值与因果分离 |
| 临床试验 | [OPERAM cluster randomised controlled trial](https://pmc.ncbi.nlm.nih.gov/articles/PMC8276068/) | ITT 主分析、聚类、结局裁定与补充分析分离 |
| 诊断/预后 | [External validation and clinical utility of a hemodialysis mortality model](https://pmc.ncbi.nlm.nih.gov/articles/PMC5788083/) | 区分度、校准和限定阈值范围内的净获益分离 |
| 组学/高通量 | [Direct RNA sequencing of SARS-CoV-2-infected cells](https://pmc.ncbi.nlm.nih.gov/articles/PMC12451313/) | 修饰/异构体发现、富集推断与正交功能验证分离 |
| 系统综述/Meta | [Systematic review of external prediction-model validation](https://pmc.ncbi.nlm.nih.gov/articles/PMC3999945/) | 未报告校准不等于校准不佳，综述计数不等于单模型性能 |
| 方法/资源 | [Enrichment on steps, not genes](https://pmc.ncbi.nlm.nih.gov/articles/PMC10994554/) | 方法灵敏度不等于生物机制，定义中的 sufficient 不等于充分性实验 |

## 已固化的高精度规则

- 快速主线固定为 9 个默认类别，不因论文类型无条件膨胀。
- 调整后的观察性关联不能仅凭时间顺序或混杂校正升级为因果。
- 只有 P 值不能满足“效应与不确定性”；需要区间、标准误或明确的不精确性描述。
- 训练集交叉验证、bootstrap 或随机切分不能标成外部验证。
- AUROC 不自动代表校准或临床效用。
- 差异表达、通路富集、网络中心性和伪时间不自动代表机制中介。
- necessity、sufficiency、rescue 的关键槽位必须由返回的原文引文直接支撑。
- 普通治疗改善不能标成机制 rescue；必须有初始异常、不同的补救动作以及同一结局恢复。
- `associated with`、`correlated with` 即使来自调整模型，也不能直接标成因果效应。
- 给药剂量和时间表只是方法信息；只有结局随剂量、时长或时间变化时才标成时间/剂量证据。
- 技术重复和同一样本的重复测量不能标成跨体系验证。
- 机制和定量证据槽位必须是对应引文中的短原文，防止模型以真实引文承载虚构变量。
- 缺失信息只进入审计清单，不生成页面高亮。

## 自动化状态

- 研究类型/视图组合矩阵：16 篇论文覆盖 8 类研究设计与 3 种阅读视图。
- 证据边界对抗样本：本地验证器覆盖因果措辞、效应区间、外部验证、实际意义、时间/剂量、跨体系、富集推断、necessity、sufficiency、rescue 和槽位幻觉。
- 浏览器端真实模型复测：需 Chrome 控制连接恢复后执行，不应把浏览器控制组件缺失误判为插件或模型失败。

## quality-r8 新增回归门槛

- `missing_information` 只能表述为“待核查：当前证据台账未覆盖”，不得声称全文不存在。
- 每条缺失审计必须返回 2–6 个原文检索词；本地全文命中多个具体检索词或定量/给药词时拒绝该审计。
- “We hypothesized … would …” 等前瞻性假设不能归入创新与意义。
- 相关、提示和可能性措辞的置信度上限为 0.85，解释文本不得升级为确定因果。
- Results 分块必须关注连接论文蓝图的中心发现，并包含会约束治疗或机制结论的重要阴性/选择性结果。
- 2026-07-14 Europe PMC 官方 OA XML 全文压力测试：9 篇、383 段、291,890 字符、48 个语义分块，正文覆盖率 100%，图注/参考文献进入测试正文为 0。
- 14 个 Results 分块全部收到阴性/选择性结果召回指令；3/3 条假设或研究目的实例被拒绝为创新，25/25 条非因果关联实例被拒绝为因果效应。
- 详细可复核指标、论文 ID 与原始 XML SHA-256 见 `oa-fulltext-quality-r8.json`。
- 真实浏览器模型复测仍须在插件重新加载 quality-r8 后记录。

## quality-r9 主线汇总门槛

- 主线关系的“协同/synergy”措辞必须能在所引用的已验证原文中找到协同、ZIP、Bliss、Loewe 或 combination index 证据，否则本地拒绝。
- 引用完全相同证据集合的重复主线关系只保留一条。
- 主线证据强度受被引用标注的本地置信度限制，不能仅采用模型自报的 `strong`。
- “we propose that …”继续作为前瞻性假设拒绝；“we propose a new method/framework”作为可能的当前贡献保留给后续语义条件判断。
- 2026-07-14 OA 全文压力测试：9 篇、383 段、291,890 字符、48 个语义分块，25/25 条非因果关联被拒绝为因果，2/2 条真实假设/研究目的被拒绝为创新。
- 详细指标见 `oa-fulltext-quality-r9.json`；真实浏览器模型复测必须在重新加载 `2.0.0-quality-r9` 后记录。

## quality-r10 长全文恢复与请求规模门槛

- `REQUEST_TIMEOUT` 必须立即拆小当前多段分块；连续两次 `PROVIDER_UNAVAILABLE` 必须拆小并续跑，不能让已完成分块随整篇失败。
- 页面进度必须按 `REQUEST_TIMEOUT`、`PROVIDER_UNAVAILABLE`、`OUTPUT_TRUNCATED` 显示准确的降载原因。
- 9 篇 OA 全文的模拟提供商压力测试必须覆盖全部 383 个正文段落，并分别注入超时和模型繁忙场景。
- 2026-07-14 压力测试共注入 13 次错误、触发 9 次自适应拆分，383/383 段完成；详细指标见 `oa-pipeline-stress-quality-r10.json`。
- 9 类快速主线的 DeepSeek 请求体最大为 28,535 字节，正文单段最大为 4,151 字符；此规模用于排除“异常巨型提示词”作为主要故障原因。
- 关系摘要必须拒绝仅由相关性引文支撑的“调控/介导/导致/补救”措辞，并拒绝关系标签中未出现在所引证据或结构槽位里的拉丁科学实体。
- 真实浏览器模型复测必须在重新加载 `2.0.0-quality-r10` 后记录，且应观察到超时/繁忙时自动拆分而非整篇失败。

## quality-r11 待核查反证门槛

- 待核查项必须是单一、可检索的原子化缺失事实；表达、预后、剂量、安全性等不同事实不得捆绑成一项。
- 正文反证检索必须识别 `TP53mut` / `TP53 mutant`、`tissue` / `samples` 等生物医学写法变体，同时限制在同一段落并要求实体锚点，防止跨段拼接产生误判。
- 仅出现 `TET1` 一类带数字的基因名不得被视为剂量或给药方案证据；定量方案反证必须包含数值和单位。
- 真实 Wiley OA 运行中发现的“TET1 表达未覆盖”假待核查项必须在重新加载 `2.0.0-quality-r11` 后消失，而其余确实未覆盖的审计项仍应保留。
- 2026-07-14 全量结果：202/202 项自动化测试通过；9 篇 OA 全文共 383 段、291,890 字符、48 个分块，25/25 条非因果关联与 2/2 条假设/目的通过负例门槛。
- 故障压力结果：注入 13 次超时/繁忙错误，触发 9 次自适应拆分，383/383 段完成，最大 DeepSeek 请求体 28,535 字节；明细见 `oa-fulltext-quality-r11.json` 与 `oa-pipeline-stress-quality-r11.json`。

## figure-r1 逐图解读回归门槛

- Figure 提取必须排除补充图、图形摘要、表格、方案图和图标，支持懒加载图片，并按主图号数值排序、合并重复候选。
- `Figs. 2A, B, and 3`、`Fig. 2A–C`、`图2、3` 等正文复合引用必须关联到所有涉及的主图，不能把句中无关统计数字误作图号。
- 视觉请求必须在五类提供商中保持等价的图像输入；不支持视觉时只能使用图注与有限正文上下文，并明确禁止生成未观察到的视觉事实。
- 模型输出必须通过 Figure ID、固定 JSON 结构、字段长度和文本安全校验；错误 Figure ID 不得渲染到其他图题。
- 每张 Figure 独立重试、缓存和检查点；鉴权与额度错误不得伪装成文本回退，后续 Figure 失败不得丢失已完成结果。
- 2026-07-14 全量结果：225/225 项自动化测试通过；OA 全文基准仍为 9 篇、383 段、291,890 字符、48 个分块，25/25 条非因果关联和 2/2 条假设/目的通过负例门槛。
- 故障压力结果保持为 13 次注入错误、9 次自适应拆分、383/383 段完成，最大请求体 28,535 字节；可复核报告见 `oa-fulltext-figure-r1.json` 与 `oa-pipeline-stress-figure-r1.json`。

## figure-r2 真实浏览器门槛

- Europe PMC `PMC6145285` 必须识别且仅识别 8 张主图，图号按 Figure 1–8 排序；每张图必须取得一个有效位图和至少一个正文引用上下文。
- `Open in a separate windowFigure 1` 一类无空格的无障碍文本不能造成漏图；图注后文出现 Supplementary Figure 或 Table 不能排除当前主图。
- 8 张真实位图必须全部能经过与生产代码等价的 Canvas/JPEG 流程，且每张低于 1.5 MiB。
- 模拟 API 结果必须生成 8 个按钮、8 张卡片和 `figure-1` 至 `figure-8` 的顺序映射；卡片默认折叠，点击后展开并更新 `aria-expanded`。
- 模型输出中的 HTML/事件属性必须只以纯文本出现，不得创建可执行节点；浏览器测试必须验证注入节点数为 0、脚本执行标志为 false。
- `figure-r2` 全量回归为 227/227；OA 报告见 `oa-fulltext-figure-r2.json`，故障压力报告见 `oa-pipeline-stress-figure-r2.json`。

## review-r6 综述综合与大纲门槛

- 系统综述/Meta 仍属于既有八类研究设计之一，但必须额外归一化为叙述性、系统、范围、Meta 或伞状综述子类型；非综述必须为 `not_review`。
- “综述脉络”固定包含七类综述专用关系并复用知识缺口、局限性和未来方向。证据共识与矛盾证据必须分别提供两个不同且可精确定位的来源、共同目标主张和相容/相反方向；缺任一条件均由本地验证器拒绝。
- H1–H4 标题路径和重复小节 ID 必须保留到每个段落，结构变化必须改变文档哈希。
- 每个输入段落必须且只能得到一条经 ID 和长度校验的摘要；Map 分块零重叠，超时、繁忙或截断时自动重试/拆分并从检查点恢复。
- Reduce 只能接收段落摘要和标题结构，不能接收原始段落正文；Reduce 失败时必须返回包含全部摘要的本地层级。
- 大章节、全部小节和段落三种显示深度必须只在本地切换；段落摘要应定位到精确源元素，模型文本只能通过安全文本节点渲染。
- Figure 标准/深度解读必须按 Provider 能力决定图像输入：DeepSeek 官方保持文本证据，OpenAI 兼容端点默认关闭视觉，只有用户明确启用才发送图片。
- 2026-07-15 全量结果：278/278 项自动化测试通过；运行修订号为 `2.0.0-review-r6`，提示词缓存 v8，论文分类器缓存 v2。

## review-r7 输出格式恢复门槛

- 段落摘要返回非法 JSON、漏段、重复 ID 或缺字段时，必须作为 `INVALID_RESPONSE` 自动重试；第二次请求必须附加 schema、ID 完整性和唯一性纠错指令。
- 同一多段分块连续两次格式异常后必须按段落二分继续，先前完成的分块检查点不得重复请求。
- 全局 Reduce 连续格式异常时必须保留全部逐段摘要和本地标题树，不能把整个大纲任务判为失败。
- 进度界面必须区分格式纠错与服务繁忙；若单段在重试上限后仍失败，必须显示已完成段落数并说明重新点击会从断点继续。
- 2026-07-15 全量结果：283/283 项自动化测试通过；运行修订号为 `2.0.0-review-r7`，兼容并复用 r6 的大纲检查点。

## review-r8 综述正文与逻辑大纲门槛

- ScienceDirect 风格页面必须优先选择纯正文容器，不能让包含 `Outline`、`Tables`、`Extras` 短列表的祖先 `main` 因节点更多而胜出。
- H5/H6、`role=heading` 和常见 section-title 必须保留真实层级；`Article`、网页目录、作者信息、CRediT、生成式 AI 声明、资助、利益声明、附件和参考文献不得进入大纲输入。
- 每个段落摘要只能发送给直接所属叶子章节一次，不能在父章节与子章节之间重复，避免 Token 浪费与章节综合污染。
- 每个有直属段落的章节必须生成少量逻辑单元；其 `source_paragraph_ids` 必须覆盖该章节每个段落恰好一次，遗漏、重复、跨章节和虚构 ID 必须由本地验证器拒绝。
- 大纲面板必须通过 Shadow DOM 隔离出版社的 `details/summary` 样式，标题、箭头、角色标签和分隔线不得重叠。
- 2026-07-15 全量结果：292/292 项自动化测试通过；运行修订号为 `2.0.0-review-r8`，提取器 r6，大纲结构与提示词缓存 v2。

## review-r9 ScienceDirect 目录锚定与综合质量门槛

- 真实失败页面的回归夹具必须复现“仅保留 Abstract 与一个正文节、漏掉其余正式章节，并混入两篇推荐文章标题”的错误输入。
- 页面有至少三个可解析的官方 Outline 锚点时，提取器必须按锚点顺序读取对应正文目标；父章节不能重复吞入子章节段落，非正文目录项和侧栏文章卡片不得进入结果。
- 诊断结果必须报告 `outline-anchors`、`OUTLINE_ANCHORS` 和锁定章节数；运行状态必须在 API 调用前显示正文章节覆盖数。
- 输入至少五个科学段落时，全局综合不得声称没有实质科学内容或只有导航；中心命题、组织策略和章节摘要必须分别包含具体综述对象/机制/结论、按实际顺序的主题推进，以及本节问题/证据或机制/结论。
- 2026-07-15 全量结果：295/295 项自动化测试通过；运行修订号为 `2.0.0-review-r9`，提取器 r7，综述提示词缓存 v3。
