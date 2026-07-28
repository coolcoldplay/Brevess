# Build 39 候选发布审计基线

日期：2026-07-24
分支：`feature/build39-optimization`
审计入口提交：`d916794 Fix publisher focus layouts and floating panel`
入口版本：`2.4.10`
运行标识：`2.4.10-build39-edge-global-sidebar-r10`

## 基线边界

本基线是在既有 Build 39 优化工作树上建立的，不把此前尚未提交的产品迭代误记为本轮审计新增内容。审计入口已有 32 个修改文件和 1 个未跟踪的 Science 快照脚本；这些内容均予以保留，不做重置、覆盖或历史改写。

审计入口的主要未提交模块包括：

- 侧栏与网页运行时：`background.js`、`content.js`、`content.css`、`popup.js`、`popup.html`、`popup.css`
- 全文问答与目录存储：`core/article-chat*.js`、`core/background-router.js`、`core/directory-sync.js`、`core/tab-messenger.js`
- 发布元数据与构建：`manifest.json`、`package.json`、`package-lock.json`、`scripts/build-unpacked-extension.ps1`
- 自动化验证：Edge 主流程、浏览器重启、文章归档、全文问答、Figure、目录同步和 UI 契约测试
- 文档：`README.md`、`BUILD39_OPTIMIZATION.md`

`dist/SCI论文阅读助手-v2.4.10-edge-global-sidebar-build39` 及此前各 Build 39 目录均属于审计前产物，不是本轮最终候选构建。

## 审计入口已知验证状态

- Node 自动化：933 项通过、0 项失败。
- Edge 主流程：通过，但测试将 `popup.html` 作为普通扩展页面打开，不能单独证明 Edge 原生侧栏宿主在旧配置升级后的可见性。
- Edge 重启恢复：通过受控的完整 `chat/index.json` 夹具，尚未覆盖“聚合索引为空但独立 turn 文件完整”的真实故障形态。
- Build 39 固定提示词基准：
  - 全文高亮提示词字符数：12,077 → 5,379（-55.5%）
  - Figure/Panel 上下文字符数：10,413 → 7,094（-31.9%）

## 审计入口可复现缺陷

### R39-P1-001：只读侧栏刷新覆盖历史问答聚合索引

- 症状：返回标签页或重新连接当前论文后，本地 `chat/index.json` 被保存为 0 轮，界面加载后看不到历史问答。
- 真实数据证据：用户的 Cell 工作区中 `chat/index.json` 为 0 轮，但存在两份完整 `chat/turns/*.json`，分别包含 5 个和 3 个回答块。
- 最小复现：清空内存工作副本，打开已保存论文，让侧栏先请求工作区快照，再检查磁盘聚合索引。
- 初步根因：`getArticleWorkspaceSnapshot` 是读取操作，却无条件调用全量工作区保存；恢复开始前，空内存状态先覆盖了磁盘聚合索引。
- 风险：P1，存在静默隐藏历史的用户数据风险；独立 turn 文件仍在，因此可恢复。

### R39-P1-002：已授权目录不会自动恢复

- 症状：切回已激活论文仍出现“是否加载之前结果”，而不是直接显示本地结果。
- 最小复现：保留可读目录句柄、清空 IndexedDB 工作区、重新打开同一论文。
- 初步根因：初始化只探测旧单文件档案；多文件论文工作区仅由显式扫描或“加载”按钮触发。
- 风险：P1，状态恢复不符合用户预期，容易诱发重复分析和重复 API 消耗。

### R39-P1-003：旧版标签页级侧栏禁用覆盖全局侧栏

- 症状：切换到其他标签页后再返回，Edge 原生侧栏消失。
- 最小复现：旧版本对标签页写入 `enabled:false`，随后在不改变扩展 ID 的情况下升级至全局侧栏版本。
- 初步根因：无 `tabId` 的全局 `setOptions` 不会清除浏览器保留的标签页级覆盖；既有全新浏览器夹具没有该升级状态。
- 风险：P1，核心入口不可见；网页内容和本地数据本身未删除。

## 文档与发布基线差距

- 根目录只有截至 `CHANGELOG-v2.3.0.md` 的分版本变更记录，没有 2.4.x 统一变更日志。
- `README.md` 同时保留“未激活页自动收起/返回恢复把手”和 2.4.10 全局窗口侧栏两套说明，需要在候选发布前统一。
- Edge 主流程测试需要明确区分“扩展页面内 UI 回归”和“原生侧栏宿主可见性”两种证据。

## 基线后必须执行的发布门禁

1. 全量 Node 测试。
2. Edge 多标签页主流程。
3. Edge 浏览器重启与损坏索引恢复。
4. Science 本地快照、Publisher/OA 适配回归。
5. Build 39 提示词和全文问答基准。
6. `git diff --check`、开源发布检查、源码与最终打包目录哈希一致性。
7. 仅在以上门禁通过后创建一次最终候选构建。
