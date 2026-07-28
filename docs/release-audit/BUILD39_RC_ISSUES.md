# Build 39 候选发布统一问题清单

日期：2026-07-24
审计入口：`d916794` / `2.4.10-build39-edge-global-sidebar-r10`

本清单按用户可见故障归档，但修复按共同根因组织。状态为“已修复”仅表示源码和定向测试已通过；必须等源码 E2E、重启 E2E、打包 E2E 和最终门禁全部通过后才能视为候选发布已验收。

## R39-P1-001：只读侧栏刷新覆盖本地问答索引

- 严重级别：P1
- 状态：已修复，待最终打包回归
- 用户症状：加载此前结果后看不到历史问题和回答；返回标签页后历史问答像是消失。
- 最小复现：让磁盘 `chat/index.json` 含历史轮次，清空当前页面内存，再让侧栏先请求页面工作区快照。
- 稳定复现：是。
- 根因：`getArticleWorkspaceSnapshot` 是读请求，却在恢复前触发全量保存；空的内存 `articleChatState` 先覆盖了磁盘聚合索引。
- 数据风险：会静默隐藏历史。独立 `chat/turns/*.json` 仍在时可恢复，但旧代码不会主动合并孤立 turn 文件。
- 影响模块：页面内容脚本、工作区路由、目录镜像、全文问答恢复。
- 文件与函数：
  - `content.js`：`getArticleWorkspaceSnapshot`
  - `core/background-router.js`：目录工作区恢复、`ARTICLE_WORKSPACE_SAVE_ASSET`
- 修复：
  1. 只读快照不再触发全量工作区写入。
  2. 扫描时把独立 turn 文件作为权威增量来源，与 `chat/index.json` 合并。
  3. 若聚合索引为空、陈旧或缺轮次，恢复时自动重建并回写 `chat/index.json`。
  4. 内容脚本用“索引轮次 + 恢复轮次”双来源重建内存。
- 回归：
  - `tests/background-router.test.js`：空索引、两个独立 turn、其中一轮未被 manifest 索引。
  - `tests/reading-view-ui-contract.test.js`：读快照不得触发全量保存。
  - `scripts/verify-native-side-panel-restart.js`：重启前故意保存空索引，只保留 turn 文件。

## R39-P1-002：已授权目录仍要求手动确认加载

- 严重级别：P1
- 状态：已修复，待最终打包回归
- 用户症状：每次返回论文都询问是否加载以前结果；即使点击加载，也可能仍看不到问答历史。
- 最小复现：保留可读目录句柄，重新打开已保存论文或重启浏览器。
- 稳定复现：是。
- 根因：初始化流程只探测旧版单 JSON 档案；新版多文件工作区只能通过显式“扫描并恢复”入口触发。
- 数据风险：不会直接删除数据，但会诱发重复分析、重复 API 消耗，并与 R39-P1-001 叠加造成历史不可见。
- 影响模块：侧栏初始化、本地目录恢复、通知。
- 文件与函数：
  - `popup.js`：`initializeCurrentArticle`、`restoreCurrentArticleWorkspaceFromDirectory`、`tryAutoRestoreCurrentArticleWorkspace`
- 修复：
  1. 初始化先用现有目录授权无提示扫描并恢复。
  2. 自动恢复成功后跳过旧档案确认提示。
  3. 浏览器确实需要新的用户手势授权时，保留显式扫描按钮作为降级路径。
- 回归：
  - `tests/reading-view-ui-contract.test.js`：自动恢复必须先于旧档案探测。
  - `scripts/verify-native-side-panel-restart.js`：重启后不点击加载按钮，直接断言问题、答案、Figure 和活动视图已经恢复。

## R39-P1-003：旧版标签页级禁用覆盖新版全局侧栏

- 严重级别：P1
- 状态：已修复，待最终打包回归
- 用户症状：切换到其他标签页再返回，插件侧栏自动消失；再次点击图标也可能没有反应。
- 最小复现：旧版本曾对同一 tab 写入 `enabled:false`，保留扩展 ID 升级至全局侧栏版本，再切走和切回该 tab。
- 稳定复现：是。
- 根因：Edge/Chromium 的 tab 级 `sidePanel.setOptions` 会覆盖全局选项；仅写全局 `enabled:true` 不会清除已有 tab 覆盖。
- 数据风险：无直接数据删除，但核心入口不可见且恢复流程无法触发。
- 影响模块：后台侧栏路由、扩展安装/升级、标签切换。
- 文件与函数：
  - `background.js`：`repairLegacyTabSidePanelOptions`、`repairAllLegacyTabSidePanelOptions`
- 修复：
  1. 安装/升级、浏览器启动、service worker 启动和 tab 同步均检查旧 tab 级覆盖。
  2. 对 `enabled:false` 或错误路径统一修复为 `enabled:true`、`popup.html`。
- 回归：
  - `tests/manifest.test.js`：修复函数及生命周期接线。
  - `scripts/verify-native-side-panel-extension.js`：先制造 `enabled:false`，再验证修复前后状态及路径。

## R39-P1-004：分析完成后磁盘任务状态仍可能是 running

- 严重级别：P1
- 状态：已修复，待源码 E2E 复验
- 用户症状：分析已完成，但恢复后仍显示任务运行中；暂停/取消或再次分析可能被错误阻塞。
- 最小复现：完成全文 LLM 高亮后，立即读取 `analysis/full-analysis.json.task.running`。
- 稳定复现：浏览器 E2E 稳定捕获。
- 根因：成功、取消和错误分支的即时快照都在 `finishLlmHighlightOperation` 之前捕获，因此最后落盘的对象仍包含活动 operation。
- 数据风险：不丢内容，但会让恢复状态错误并影响后续任务控制。
- 影响模块：全文高亮任务状态、工作区增量保存、重启恢复。
- 文件与函数：
  - `content.js`：`analyzeArticleWithLLM`
- 修复：在 `finishLlmHighlightOperation` 清除活动 operation 后再捕获并提交最终快照，保证写入顺序以 idle 状态收尾。
- 回归：
  - `tests/reading-view-ui-contract.test.js`：最终快照必须位于任务释放之后。
  - `scripts/verify-native-side-panel-extension.js`：完成后工作区 `task.running` 必须为 `false`。

## R39-P2-001：原生侧栏宿主的自动化可观测性有限

- 严重级别：P2
- 状态：已记录
- 用户症状：无直接产品症状；这是测试证据边界。
- 最小复现：Playwright 通过扩展页面验证 UI 和 `chrome.sidePanel.getOptions`，但 Chromium 对原生侧栏宿主 DOM 没有稳定的跨版本选择器。
- 稳定复现：环境限制。
- 根因：原生浏览器 UI 不属于网页可访问 DOM。
- 数据风险：无。
- 影响模块：发布验证。
- 建议：继续把 `sidePanel.getOptions`、标签切换后的 content 状态、自动恢复 UI 和手工安装检查组合为证据；不伪造“已自动化点击浏览器原生侧栏”的结论。

## R39-P2-002：README 存在旧版与全局侧栏说明冲突

- 严重级别：P2
- 状态：已修复
- 用户症状：安装后不知道侧栏应在何时自动收起或保持展开，也无法判断旧档案提示是否仍是正常流程。
- 最小复现：对比 README 中旧版“未激活页自动收起/恢复把手”和 2.4.10 全局侧栏说明。
- 稳定复现：是。
- 根因：多轮迭代后文档未在单次候选发布前统一。
- 数据风险：无。
- 影响模块：README、安装说明、迁移说明、CHANGELOG。
- 修复：README 与安装说明统一为窗口级持久侧栏、自动工作区恢复和旧档案降级语义；新增 `CHANGELOG-v2.4.11.md`。

## R39-P2-003：激活时仅创建 IndexedDB 记录，磁盘目录首写依赖后续内容变更

- 严重级别：P2
- 状态：已修复，待最终打包回归
- 用户症状：刚激活论文但尚未产生高亮/分析时，本地目录中可能暂时看不到该论文文件夹。
- 最小复现：目录已授权，激活一篇新论文但不执行任何写操作，立即检查工作区目录。
- 稳定复现：是。
- 根因：`ARTICLE_WORKSPACE_ENSURE` 只确保浏览器内工作区；目录镜像由第一个 asset/turn 写入创建。
- 数据风险：无既有数据损坏风险。
- 影响模块：激活、目录镜像。
- 修复：自动恢复已有工作区之后，再写入非破坏性的 `article/structure.json` 与 `article/paragraphs.json` 基线。该动作不会写 `chat/index.json`、Figure、分析或高亮聚合状态；恢复得到的文件指纹也会避免重复写入相同基线。
- 回归：`tests/reading-view-ui-contract.test.js` 固定“先恢复、后基线”的顺序，并断言基线资产白名单只有正文结构和段落。

## R39-P2-004：部分在线 OA 出版社在无人浏览器中返回风控页

- 严重级别：P2（外部兼容风险）
- 状态：已记录
- 用户症状：在特定网络、无头浏览器或站点风控时无法取得论文正文。
- 最小复现：2026-07-24 无头 Edge 访问本轮固定 MDPI、PMC、ScienceDirect OA URL。
- 稳定复现：受网络、时间和站点策略影响，不稳定。
- 根因：出版商返回 Access Denied、reCAPTCHA 或通用 ScienceDirect 挑战页，不是文章 DOM。
- 数据风险：插件已安全拒绝这些页面，不会把验证码或拒绝页当论文发送给 LLM。
- 影响模块：在线发布者验证边界。
- 证据：本轮在线回归共 5 站，PLOS 与 Frontiers 正常提取；MDPI、PMC、ScienceDirect 三站返回 `NON_ARTICLE_CHALLENGE`。
- 建议：继续保留本地 fixture/真实保存页验证和诊断包导出；站点改版或风控故障需在可访问的真实浏览器环境复测，不能通过放宽挑战页判定“修复”。

## R39-P2-005：未使用真实付费 Provider 做发布回归

- 严重级别：P2（外部环境边界）
- 状态：已记录
- 用户症状：特定网关或未来模型版本仍可能返回仓库 fixture 未覆盖的供应商特有格式。
- 最小复现：需要真实 API Key、付费额度和不可控网络。
- 稳定复现：否。
- 根因：发布审计禁止上传论文、暴露凭据或产生未经授权的真实付费调用。
- 数据风险：无；本轮全部使用本地受控 Provider、合成文本和错误夹具。
- 影响模块：OpenAI、Anthropic、Gemini、DeepSeek 与 OpenAI-compatible 运行时边界。
- 建议：发布后若遇到真实 Provider 差异，只导出脱敏诊断；不要把 API Key、完整论文或响应正文加入日志。

## R39-P2-006：Edge E2E 的并发修复返回值与冷启动 120 ms 门限存在抖动

- 严重级别：P2（测试稳定性）
- 状态：已修复
- 用户症状：无产品故障；最终源码 E2E 首次运行出现两个误报。
- 最小复现：后台 tab 监听器先于显式探针修好测试故意写入的 `enabled:false`；或桌面调度抖动使 47 个类别按钮的冷首次渲染达到 123 ms。
- 稳定复现：否。
- 根因：测试错误要求“必须由显式调用返回 repaired=true”，忽略并发修复已先成功；冷/热工具条共用 120 ms 硬门限，未为一次布局调度预留余量。
- 数据风险：无。
- 影响模块：`scripts/verify-native-side-panel-extension.js`。
- 修复：断言最终 tab sidePanel 必须启用且路径正确，并要求 repair 结果是布尔值；冷首次门限调整为 160 ms，热路径收紧为 80 ms。该次实测为 123/22 ms。
- 回归：重新运行完整 Edge 源码与打包 E2E。
