# 网页研读稳定性与进度反馈 — 本地 r11

本文记录 `Brevess-v1.0.1-reliability-20260909-reading-r11` 的阅读稳定性改动及其证据边界。最终源码已冻结并同步至 r11 staging，定向验收、全套回归、安装包 Nature 复验以及真实 PMC/PDF Methods 范围核对均已通过。打包过程不安装、注册、登录、发送模型请求或发布扩展。

## 本轮范围

- 网页正文提取与 Figure 目录分开结算。Figure 目录初始化或保存失败时，已经取得的正文仍可进入研读工作区；界面只对 Figure 能力显示受限原因和重试提示。
- 页面仍在加载或持续变化时，工作区显示等待提示，不把不稳定的中间 DOM 宣称为完整正文。遇到访客预览或订阅访问边界时，界面明确说明当前只有摘要、参考文献、扩展数据或其他公开片段。
- 稳定提取结果可被 Figure 目录、正文工作区和手动标注等消费者复用；刷新会重新核对页面与工作区生命周期，避免把旧页面的暂存结果绑定到新页面。
- AI 操作按钮展示当前实际阶段和计数，例如正文段保存进度、提纲段数、Figure 完成数及已保存 Panel 数。运行期间保留取消入口和柔和边缘提示；系统启用“减少动态效果”时停用动画但保留文字状态。
- 阅读侧栏新增专注模式，在保持当前子视图、输入草稿、Methods 等限定范围和滚动位置的同时，把空间让给当前内容。320 px 和 520 px 下仍保留取消、错误、公开预览边界、笔记保存失败提示及主阅读、机制和笔记等视图的退出入口。
- Figure 内容按证据块组织承上、核心证据、启下、已保存的块间衔接和所属 Panel。字段通过双击、Enter 或 Space 进入编辑，不再为每个字段重复放置“编辑”按钮；Panel 编号和折叠层级采用更紧凑的布局。

这些改动改善失败隔离、状态表达和操作可见性，不构成模型科学判断质量、引用正确率或 Figure 解读准确率的新声明。

## 已验证的 Methods 范围与 Nature 公开预览

- Methods 范围修复已在真实公开 PDF 的生产 parser 快照上验证：限定范围问答与智能高亮使用同一组 Methods 段落；范围为空时本地停止，不发送请求、不新增问答轮次，也不静默回退全文。验证在生产 popup 的两个按钮处理器执行到拦截的标签页 transport 为止，不覆盖真实 reader 与侧栏连接或模型响应。
- r11 staging 已在真实 Nature 访客页完成冷启动、锚点刷新、完整重载以及受控 Figure 保存/页面加载故障复验。三次稳定状态都得到相同的 89 段公开页面记录并保留订阅预览提示；这仍不是 Nature 全文提取证据。

预备的 popup 组件验收在 transport 处拦截，没有运行真实网页/PDF content resolver，因此未发现 `core/article-chat.js` 只在侧栏入口加载的问题。后续真实 PMC 核对暴露了该遗漏：侧栏 `popup.html` 已加载解析器，但网页内容脚本注入清单和 PDF 阅读器入口缺少依赖。最终源码在 `core/tab-messenger.js` 的 `CONTENT_SCRIPT_FILES` 和 `pdf-reader.html` 中补齐 `core/article-chat.js`，使侧栏、网页内容脚本和 PDF 阅读器三个入口使用同一范围解析器。前三次 PMC 验收失败记录原样保留，不进入通过证据清单。

## 当前证据

`output/playwright/live-article-extraction-final-r2/report.json` 在真实 Nature 访客页面、隔离浏览器和零模型请求条件下通过。页面实际返回 89 段可读页面内容，其中包括摘要、44 条参考文献、作者及出版元数据、扩展数据和补充材料入口。页面同时出现订阅访问提示；因此该记录证明的是公开预览提取、刷新一致性和访问边界提示，不是 Nature 全文提取。

同一记录还在真实页面 DOM 上通过受控故障注入验证：Figure 目录保存失败时保留 89 段正文并给出 Figure 范围的 `SAVE_FAILED` 提示；页面被标记为继续加载时不发布暂存工作区，恢复稳定后可重新提取。用户最初截图中的完全相同失败状态没有在新的正常访问中自然复现，故不能宣称已经复现原截图；受控故障只覆盖同类失败处理路径。

`output/playwright/ai-button-progress-20260909/report.json` 使用生产 DOM 和生产函数注入合成进度事件，验证 520 px、320 px、取消操作、终态清理和减少动态效果，共产生零外部请求、零模型请求。它是组件交互证据，不是模型任务端到端证据。

`output/playwright/sidebar-focus-mode-20260909/report.json` 使用生产 `popup.html`、`popup.js` 和 `popup.css` 及合成侧栏内容完成 8 项检查，外部请求和 Provider 请求均为 0。专注模式使聊天内容高度在 320 px 增加 64 px、在 520 px 增加 118 px；进入和退出时保留输入草稿、Methods 范围、当前滚动位置、取消及错误状态、公开预览提示、笔记保存失败状态，并在主阅读、机制和笔记子视图保留可访问的退出入口。验证器为 `scripts/verify-sidebar-focus-mode.mjs`。该报告验证生产界面的确定性交互，不代表真实论文或模型任务结果。

`output/playwright/figure-evidence-layout-20260909/report.json` 使用生产 Figure 渲染组件和合成数据完成 9 项浏览器检查，覆盖 360 px 与 720 px 的证据块层级、块间衔接归属、折叠、Panel 直达、双击与键盘编辑、缺失科学问题占位、紧凑编号和无横向溢出；外部请求和模型请求均为 0。相关定向组件测试 144/144 通过。该证据证明布局与交互契约，不是实际模型生成的 Figure 结果或科学内容验收。

`output/playwright/package-reading-r11/pdf-methods/report.json` 使用真实公开 PDF `elife-83176-v2.pdf`，完成 PDF reader content 预检、生产 popup 的限定范围问答和智能高亮按钮 payload 核对，以及空范围实际问答零新增轮次检查；共验证 11 项，模型请求为 0。Methods 范围覆盖第 13–17 页的 5 个页级记录，两条按钮动作携带相同范围。报告中的 6 个源码 SHA 与 r11 staging 一致。它没有证明页内更细的精确 Methods 边界，也没有验证 reader 到侧栏的完整实时连接或模型回答。

`output/playwright/package-reading-r11/pmc-methods-r4/report.json` 在真实 PMC 全文页和 r11 staging 上执行实际 content resolver。页面提取 176 条正文记录，其中 `STAR★METHODS` 父范围选择 33 条 methods/availability 子节记录，其余 143 条不进入范围；冷启动、锚点刷新和重载路径完成，错误数为 0，模型请求为 0。该报告证明真实 HTML content 入口的范围解析，不扩展为模型回答质量证据。

`output/playwright/package-reading-r11/nature-final/report.json` 直接加载最终 r11 staging，在真实 Nature 访客页和隔离浏览器中完成冷启动、锚点刷新与完整重载；三次均得到 89 段公开记录，错误数为 0。受控 Figure 保存失败时正文工作区仍保留，暂存草稿不显示且恢复成功；页面继续加载时暂不发布中间工作区，稳定后恢复为 89 段。报告记录的 `content.js`、`popup.js`、`popup.css` 和最终 `core/tab-messenger.js` SHA 与 staging 一致，真实模型请求为 0。页面有订阅访问边界，因此只能证明公开预览和故障隔离，不能宣称取得 Nature 全文。

最终 `npm test` 在正常逐文件隔离下完成 3,891/3,891，通过 3,891、失败 0、跳过 0、取消 0，退出码为 0。运行前后关键 production 源码聚合 SHA 均为 `a7700e68b1846ab80af9d092dd27e65b54766067d21fc0647169fb6ec03b82f3`，包含最终 `pdf-reader.html`。机器摘要为 `tmp/reading-r11-full-regressions.json`，SHA-256 `87b5aa24565928ff76ff56cbb2c8834a94ecc7dbe2f7729885d1ca94657889ad`；完整日志为 `tmp/reading-r11-full-regressions.log`，SHA-256 `0ce753740fe0f0bd7f6648ca7b95b9e77dc12ec8794f9b8f48c7154df48c4dfa`。这是自动测试证据，不冒充浏览器或真实页面验收。

r9/r10 已有原页 PDF、真实 DeepSeek 文本与视觉请求、跨页划选问答、机制候选、导出和自定义模型连接报告可作为保留功能的历史证据。它们必须在 r11 证据清单中标为历史范围，不能替代本轮网页提取、Methods 或 Figure 新布局的验收。

## 门禁结果

- **Methods 范围修复：已通过。** 真实 PMC 全文的 content resolver 从 176 条记录选择 `STAR★METHODS` 的 33 条记录并排除其余 143 条；真实公开 PDF reader 验证第 13–17 页的 5 个页级 Methods 记录、两按钮同范围和空范围零新增轮次。两者均为零模型请求；PDF 页内精确边界、完整 reader 到侧栏连接和模型响应不在本项声明内。
- **Figure 布局浏览器验收：已通过。** 合成组件数据下完成 9 项实际浏览器检查，相关定向测试 144/144 通过，且无外部或模型请求；范围仅限布局与交互，不扩展为真实模型结果声明。
- **最终全套回归：已通过。** `npm test` 共 3,891/3,891 通过，失败、跳过和取消均为 0，退出码 0；运行前后 production 聚合 SHA 相同。
- **证据清单：已锁定。** 当前清单保留 current 与 historical scope 标签；三次未通过的 PMC 验收不进入通过清单，也没有被改写成通过。
- **源码冻结与 staging 同步：已通过。** 从保留的 r10 复制 r11 后按 finalizer 完整清单同步，668/668 个文件与冻结源码 SHA 相等；旧 r10 `PACKAGE_INFO.json` 未沿用，native-host 可执行文件保持原 SHA 且未重建。
- **安装包 Nature 提取复验：已通过。** 最终 r11 staging 的冷启动、锚点刷新、完整重载、Figure 保存失败隔离和页面加载恢复均通过，持续保留访客预览边界。报告 SHA-256 为 `9d7d4b1dd8e7ef3734512b69a29fa736178ce3bd5b2207f634cec3ee1daf244c`。

## 本地打包状态与收尾流程

1. 已从只读保留的 `dist/Brevess-v1.0.1-reliability-20260909-models-r10` 复制并同步新的 `dist/Brevess-v1.0.1-reliability-20260909-reading-r11`；r9、r10 staging、ZIP、哈希和 release receipt 均保持原样。最终同步回执为 `tmp/reading-r11-package-stage-sync.json`，SHA-256 `526012c83a8509b746f15d1c0ad27e7faae3efdb73f46a1d467e98c634f164e0`。
2. 运行 `scripts/finalize-local-pdf-package.mjs Brevess-v1.0.1-reliability-20260909-reading-r11 --evidence-manifest tmp/reading-r11-evidence-draft.json`，核对固定开发版 ID `finhfnjbpidfakpmkghkfjlfcfpoandh`、manifest v3、PDF WASM CSP、源码哈希、资源引用和凭据模式，并生成新的 `PACKAGE_INFO.json`。
3. 从 r11 staging 根内容创建 ZIP，确保 `manifest.json` 位于 ZIP 根部；随后运行 `scripts/verify-local-package-zip.ps1 -BuildName Brevess-v1.0.1-reliability-20260909-reading-r11`，生成独立的 release JSON 和 SHA-256 文件。
4. 最终回执记录 staging 文件数、源码匹配数、资源检查数、ZIP 字节数、ZIP SHA-256、证据清单 SHA-256 和固定扩展 ID。打包过程不安装、注册、登录、发送模型请求或发布扩展。
