# `2.0.0-review-r6` 最终需求与发行审计

审计日期：2026-07-15

## 验收结果

- JavaScript 语法检查：76 个文件，0 失败。
- 自动化测试：278 项通过，0 失败、0 跳过。
- 发行目录：53 个白名单文件；与源码逐文件 SHA-256 比较，0 不一致。
- `SCI论文逻辑助手-v2.0.0-review-r6.zip`：53 个文件，0 缺失、0 多余、0 哈希不一致。
- `SCI论文逻辑助手-v2.0.0.zip`：53 个文件，0 缺失、0 多余、0 哈希不一致。
- 两个 ZIP 的 SHA-256：`B7E9A1CE8AF8645C101891CE2CAD32AB7CDAD1196A8158BF078486BC6E4E1DB4`。
- 发行目录不包含 `tests`、`docs`、`scripts`、`output`、`.git`、源码映射、环境文件或开发归档；API Key 模式扫描无匹配。

## 需求—源码—测试映射

| 设计要求 | 源码证据 | 自动化证据 | 发行证据 |
| --- | --- | --- | --- |
| 保留八种主类型并增加六值 `reviewSubtype` | `core/study-profile.js:9-10,47-51,106,138,163-200` | `tests/study-profile.test.js:69,84`；`tests/adaptive-catalog.test.js:12` | `core/study-profile.js` 已进入发行包且哈希一致 |
| 第四视图与七个综述专用类别、三类复用类别 | `core/adaptive-catalog.js:47-53,527-596` | `tests/adaptive-catalog.test.js:12,23`；`tests/settings-store.test.js:115,135` | `core/adaptive-catalog.js`、弹窗文件已进入发行包 |
| 共识/矛盾必须有两个不同、同目标且方向可判定的证据 | `core/result-validator.js:41,229-285` | `tests/result-validator.test.js:62-94` | 验证器与提示词目录均进入发行包 |
| H1–H4 路径、重复标题唯一、结构改变缓存 | `core/article-extractor.js:84-123`；`core/analysis-cache.js:18-24` | `tests/article-extractor.test.js:63-80`；`tests/analysis-cache.test.js:37` | 提取器与缓存模块均进入发行包 |
| 每个段落恰好一条摘要，拒绝漏段/多段/重复 ID | `core/review-outline.js:86-95,141-152` | `tests/review-outline.test.js:32,52`；`tests/review-outline-pipeline.test.js:60` | `core/review-outline.js` 为新增发行文件之一 |
| 10,000 字符零重叠分块、重试、二分降载、检查点续跑 | `core/review-outline-pipeline.js:32-61,99-147` | `tests/review-outline-pipeline.test.js:73-101`；`tests/background-router.test.js:879` | `core/review-outline-pipeline.js` 为新增发行文件之一 |
| Reduce 只接收摘要、覆盖章节，不接收段落原文 | `core/review-outline.js:230-260` | `tests/review-outline.test.js:68-91` | 两个综述模块均进入发行包 |
| Reduce 失败仍保留本地标题树和全部段落摘要 | `core/review-outline.js:344-370`；`core/review-outline-pipeline.js:175-212` | `tests/review-outline-pipeline.test.js:102`；`tests/review-outline-ui-contract.test.js:36` | 内容页与两个综述模块均哈希一致 |
| 完整缓存零 API 调用；正文、模型、版本变化失效 | `core/cache-planner.js:111-143`；`core/background-router.js:679-732` | `tests/cache-planner.test.js:84`；`tests/background-router.test.js:869`；`tests/review-outline-pipeline.test.js:111` | 缓存、路由和综述模块均进入发行包 |
| Popup 显示第四视图、逐段进度、关闭后恢复、非综述提示 | `popup.html:46,114`；`popup.js:548-611,1328-1386` | `tests/reading-view-ui-contract.test.js:10,27,36,43` | `popup.html/js/css` 均哈希一致 |
| 侧栏三级深度、折叠树、段落跳转、安全文本渲染 | `content.js:1837-1998`；`content.css:401-580` | `tests/review-outline-ui-contract.test.js:16,29` | `content.js/css` 均哈希一致 |
| Figure 标准解读后允许单图深度解读 | `content.js:1409-1444,1552-1598`；`core/figure-analysis.js:47-169,211-219` | `tests/figure-renderer-contract.test.js:41,58,75`；`tests/figure-analysis.test.js:87` | Figure 模块与内容页均哈希一致 |
| Provider 视觉能力边界；DeepSeek 官方不发送图片 | `providers/provider-registry.js:9-49`；`providers/deepseek.js`；`providers/openai-compatible.js` | `tests/provider-adapters.test.js:139,153,211,232`；`tests/options-contract.test.js:60` | Provider、设置页和 Figure 模块均哈希一致 |
| 仅处理正文；排除参考文献、图注和非正文 | `core/article-extractor.js`；`content.js:1107-1156,2020-2029` | `tests/article-extractor.test.js:196,245`；`tests/chunker.test.js:5` | 提取器和内容页均哈希一致 |
| 不保存 URL、凭据、图片或原始全文；模型文本安全渲染 | `core/review-outline.js` 的结构化结果；`content.js:1887-1994` 使用 `textContent` | `tests/review-outline.test.js:44,68`；`tests/review-outline-ui-contract.test.js:16`；`tests/evidence-ledger.test.js:30` | 凭据扫描无匹配，发行白名单与 ZIP 校验通过 |
| Manifest/后台加载顺序包含新模块且既有功能不回归 | `background.js:1-27,52`；`manifest.json` | `tests/manifest-foundation.test.js`；完整 278 项回归 | 53 个发行文件与两个 ZIP 全部逐文件哈希一致 |

## 版本与缓存隔离

- 内容脚本与后台运行修订：`2.0.0-review-r6`。
- 提示词缓存版本：`8`。
- 论文类型分类器版本：`2`，用于隔离缺少 `reviewSubtype` 的旧缓存。
- Figure 标准/深度缓存和综述完整/进度缓存使用独立键。

结论：设计规范第 4–16 节及验收清单均有源码、自动化测试和发行物证据；没有已知未满足项。
