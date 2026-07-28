# Build 39 / 2.4.11 候选发布审计报告

日期：2026-07-24
审计入口提交：`d916794`
候选版本：`2.4.11`
运行修订：`2.4.11-build39-release-candidate-r11`

## 1. 修改前基线

- 分支：`feature/build39-optimization`
- 入口版本：`2.4.10`
- 入口工作树已有 32 个修改文件和 1 个未跟踪脚本，本轮没有重置、覆盖或改写这些人工迭代。
- Node 基线：933 项通过，0 项失败。
- 入口 Edge 测试没有覆盖“磁盘聚合索引为空但独立 turn 文件完整”的真实故障，也没有制造旧版 tab 级 `enabled:false` 升级状态。
- 用户 Cell 工作区实证：`chat/index.json` 为 0 轮，但磁盘存在 2 个完整 turn，分别含 5 个与 3 个回答块；其中 1 个 turn 未进入 manifest。
- 固定提示词基线：
  - 全文高亮：12,077 → 5,379 字符（-55.5%）。
  - FigureContext：10,413 → 7,094 字符（-31.9%）。

详见 [基线报告](BUILD39_RC_BASELINE.md)。

## 2. 审计覆盖矩阵

| 领域 | 主要证据 | 结果 |
| --- | --- | --- |
| A 页面激活与正文抽取 | 提取器/结构/adapter 单测；Edge 标签页、动态 DOM 与根节点替换 E2E；Science 本地实页；5 站在线 OA | 通过；在线 3 站风控被安全拒绝 |
| B 导航与页面交互 | Edge 导航树、单栏布局、手动选择、通知、键盘 Figure/Panel、tab 切换 | 通过 |
| C 全文高亮与证据台账 | 流式 Claim Census、分块/暂停/取消/恢复、关系槽位、唯一 quote 单测和 Edge E2E | 通过 |
| D Figure 与 Panel | Figure/Panel/多米诺链定向 199 项；无标签图、Nature 紧凑图注、跨批次结果、视觉降级、追问 E2E | 通过 |
| E 全文问答 | full/retrieval、NDJSON、Markdown、截断续传、取消/删除/重生成、95 轮分页、5000 轮检索、唯一引用 | 通过 |
| F 工作区与文件 | IndexedDB、目录镜像、空索引恢复、孤立 turn、自愈索引、迁移、清除、generation/tombstone、浏览器重启 | 通过 |
| G Provider 与 Token | 五类 provider adapter、流/非流、容量、超时/限流/鉴权/截断、任务路由和取消 | 通过受控 fixture；未调用真实付费 API |
| H 性能与流畅度 | Edge 交互计时、出版社提取基准、Build39 提示词基准、500 段/5000 轮/1000 工作区 benchmark | 通过目标门限 |

## 3. 发现的问题

- P0：0。
- P1：4，均已按根因修复。
  - `R39-P1-001`：只读侧栏刷新覆盖问答聚合索引。
  - `R39-P1-002`：已授权目录不会自动恢复，仍反复询问。
  - `R39-P1-003`：旧 tab 级禁用覆盖导致切回标签页后侧栏消失。
  - `R39-P1-004`：分析完成后磁盘任务状态仍残留 running。
- P2：6；其中文档冲突、激活时目录基线和 E2E 竞态门限已修复，3 项为原生侧栏可观测性、在线站点风控和真实付费 Provider 的外部验证边界。

每项症状、最小复现、根因、文件、数据风险和回归测试详见 [统一问题清单](BUILD39_RC_ISSUES.md)。

## 4. 集中修复批次

### 批次一：恢复链路与数据完整性

- `getArticleWorkspaceSnapshot` 恢复为真正只读，不在恢复前触发全量 checkpoint。
- 目录恢复合并 `chat/index.json` 和全部独立 turn 文件；turn 文件是可恢复的第二事实来源。
- 发现空/陈旧聚合索引时自动重建并回写，避免下次启动再次隐藏历史。
- 内容脚本从索引轮次与恢复轮次合并重建内存，按时间排序并把中断任务恢复为惰性状态。
- 自动恢复后才提交正文结构/段落基线，满足新激活论文创建目录，同时绝不写空聊天、Figure、分析或高亮聚合状态。

### 批次二：侧栏生命周期

- 升级、启动、service worker 初始化和 tab 同步时检查旧 tab 级 sidePanel 选项。
- 将旧 `enabled:false` 或错误路径修复为 `enabled:true`、`popup.html`。
- 已授权目录先自动恢复，只有需要新用户手势时才保留显式扫描入口；不存在新版工作区时才探测旧档案。

### 批次三：任务终态

- 全文分析成功、取消或失败后，先释放 operation，再捕获最后一个工作区快照。
- 保证重启恢复不会把已完成任务显示为运行中，也不会阻塞后续分析。

### 批次四：版本与发布文档

- 版本统一到 2.4.11；README、安装说明、Build39 冻结说明和 CHANGELOG 使用同一侧栏/恢复语义。
- 没有改变 schema、许可证、浏览器权限、API Key 存储边界或真实 Provider 行为。

## 5. 修改范围

核心接口：

- 新增内容动作：`saveArticleWorkspaceBaseline`。
- 新增后台修复函数：`repairLegacyTabSidePanelOptions`、`repairAllLegacyTabSidePanelOptions`。
- `ARTICLE_WORKSPACE_SCAN_RESTORE` 的返回增加恢复 turn 列表与聚合索引修复状态；旧调用者忽略新字段时仍兼容。

主要源码：

- `background.js`
- `content.js`
- `popup.js`
- `core/background-router.js`
- `core/directory-sync.js`
- `core/tab-messenger.js`

数据结构：

- IndexedDB、目录 manifest、turn、archive 和迁移包 schema 均未升级。
- 只改变恢复合并与写入顺序；旧数据无需破坏性迁移。

## 6. 自动测试与 E2E

- Node 最终全量：937/937 通过。
- Figure/Panel 定向：199/199 通过。
- 存储、恢复、引用、Provider 与标签页定向：通过。
- Science 保存页：
  - 正文 98 段；
  - AAAS 右栏 `display:none`、宽度 0；
  - 实验条件 quote 候选数 1；
  - 精确句子范围聚焦成功。
- 在线 OA：
  - PLOS：20 段，正常；
  - Frontiers：41 段，正常；
  - MDPI、PMC、ScienceDirect：站点风控，均标记 `NON_ARTICLE_CHALLENGE`，没有误识别为论文。
- Edge 源码主流程：通过，`qaPassed=true`、`pageErrors=0`；旧 tab 级 `enabled:false` 覆盖已被修复。
- Edge 重启/损坏索引恢复：通过；在 `chat/index.json` 为空但独立 turn 文件完整的条件下，未点击“扫描/加载”前已自动恢复 1 轮历史问答（`beforeScanUi.chatTurns=1`）。
- Edge 实际打包目录主流程：通过，`qaPassed=true`、`pageErrors=0`；旧 tab 级禁用覆盖、标签切换、95 轮历史、全文问答引用、Figure/Panel 与目录持久化均完成。
- Edge 实际打包目录重启恢复：通过；点击任何扫描按钮前 `beforeScanUi.chatTurns=1`，历史问题、回答和 Figure 结果均可见，`sidePanelEnabled=true`。

## 7. 性能、Token 与质量

固定提示词：

- 全文高亮：12,077 → 5,379 字符，减少 55.5%。
- FigureContext：10,413 → 7,094 字符，减少 31.9%。

浏览器交互（审计 E2E）：

- 未激活标签侧栏可用：65 ms。
- 切回已激活论文并恢复内部状态：148 ms（另一轮成功审计为 57 ms）。
- 手动选择工具条：首次 48 ms、后续 20 ms。
- 95 轮历史每次增加 30 轮：91–95 ms，滚动锚点位移 0 px。
- Figure 稳定状态轮询：0 次重新提取、0 次 freshness 扫描。

规模 benchmark：

- 500 段窄问题检索约 19 ms。
- 5000 轮记忆构建约 99–111 ms；旧轮次仍可检索。
- 1000 工作区总览约 10–12 ms，目标 < 2000 ms。
- 本地提交代理约 1.5–1.9 ms，目标 < 100 ms。
- 500 段重复证据引用继续被拒绝。

基准在 Windows 桌面环境存在毫秒级调度抖动；绝对门限和正确性断言均通过，没有观察到影响用户的关键路径退化。

## 8. 安全与兼容

- 未增加权限、远程遥测、云存储或运行时依赖。
- 没有上传仓库、论文、用户工作区或 API Key。
- 普通工作区、目录镜像、诊断与无凭据导出继续剥离鉴权字段。
- 完整迁移包仍明确包含 API Key，并要求二次确认；目录授权不会随迁移包导入。
- 损坏 JSON、目录穿越、保留名、绝对路径和凭据形字段继续被拒绝。

## 9. 候选构建

- 目录：`dist/SCI论文阅读助手-v2.4.11-build39-release-candidate`
- 文件数：90
- 目录内容哈希（按相对路径和文件 SHA-256 排序后计算）：`c602c24d0d3ab058652f877a74cbac802941e464d0fde98e1f73de929f310d9e`
- 源码与打包文件哈希差异：0

## 10. 剩余风险

- Playwright 无法稳定访问 Edge 原生侧栏宿主 DOM；本轮组合使用 `sidePanel.getOptions`、实际 tab 切换、页面状态和恢复 UI 作为证据。
- 在线出版社会改版或启用验证码；被阻断的页面需要在可访问的真实浏览器环境复测。
- 未经授权不调用真实付费 Provider；未来供应商格式差异需依赖脱敏诊断继续适配。

## 11. 最终结论

本候选版通过全量单元测试、保存的 Science 页面回归、在线 OA 安全回归、源码 Edge E2E、实际打包目录 Edge E2E、浏览器重启/损坏问答索引恢复、性能基准和逐文件哈希一致性检查。没有未关闭的 P0/P1，未观察到数据丢失、错误引用跳转或关键路径性能退化，接受为 Build39 优化线唯一最终候选版。
