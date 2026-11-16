/* BREVESS reader dynamic interface catalog. Captures remain verbatim except explicitly listed UI arguments. */
(function(root,factory){const catalog=factory();if(typeof module==='object'&&module.exports)module.exports=catalog;if(root.SciLLM?.compileInterfaceTemplate&&root.SciLLM?.registerInterfaceTranslations)root.SciLLM.registerInterfaceTranslations({},catalog.pairs.map(root.SciLLM.compileInterfaceTemplate));})(globalThis,()=>{
'use strict';
const pairs=[
  [
    "{0}：单击定位 · 双击解图 · 长按 1 秒查看原图/核对 PDF 页码；图片加载另行提示；键盘 Enter / Shift+Enter / Alt+Enter",
    "{0}: click to locate · Double-click to interpret · Hold for 1 second to view the original image/check PDF page; image-loading status is shown separately; keyboard: Enter / Shift+Enter / Alt+Enter"
  ],
  [
    "补充来源尚未生成可核验目录。import stage={0}; cancelled={1}; notStarted={2}; path={3}",
    "The supplementary source has no verifiable directory yet. import stage={0}; cancelled={1}; notStarted={2}; path={3}"
  ],
  [
    "PPT 材料包已导出：{0} 张 Figure、{1} 个高清图文件；{2} 张 Figure 未能下载原图，请查看 manifest",
    "PPT materials exported: {0} Figures and {1} high-resolution image files; originals for {2} Figures could not be downloaded; see manifest"
  ],
  [
    "已保存到 Zotero「{0}」：按原网页排版保留快照，内嵌 {1} 张高清原图，图解与全文问答已分别保存为两个子笔记{2}",
    "Saved to Zotero “{0}”: webpage layout preserved, with {1} embedded high-resolution originals. Figure interpretations and full-text Q&A saved as separate child notes{2}",
    [
      2
    ]
  ],
  [
    "确定清除“{0}”的本地工作区吗？\n包含 {1} 轮问答、{2} 个 Figure 结果和{3} 段正文索引。此操作不可撤销。",
    "Clear the local workspace for “{0}”?\nIncludes {1} Q&A rounds, {2} Figure results, and {3} indexed article paragraphs. This cannot be undone."
  ],
  [
    "共 {0} 项 · 自动 {1} · 手动 {2} · 全局命中 {3} · 中文全称 {4}/{5} · 含义 {6}/{7} · 本地词库 {8} 项",
    "{0} entries · {1} automatic · {2} manual · {3} global matches · Chinese full forms {4}/{5} · Meanings {6}/{7} · {8} local glossary entries"
  ],
  [
    "；{0} 张 Figure 未能获取原图；{1} 项资源缺失、{2} 项还原限制，快照可能与当前网页存在差异",
    "; originals for {0} Figures could not be retrieved; {1} resources missing and {2} rendering limitations may affect snapshot fidelity"
  ],
  [
    "浏览器本地保存已完成；{0} 项检测到更晚的并发修改，已保留较新版本并将在下一次自动保存时合并。",
    "Browser-local save completed; {0} items have newer concurrent edits. Newer versions are preserved and will be merged at the next automatic save."
  ],
  [
    "{0}将使用哪种证据？使用 Figure 图像可以读取图像细节；仅文本模式只使用图注与正文。",
    "Which evidence should {0} use? Figure images provide visual detail; text-only mode uses captions and article text."
  ],
  [
    "PDF 已建立统一索引：{0} 个段落、{1} 张完整 Figure；五个模块现在共用同一份正文",
    "Unified PDF index ready: {0} paragraphs and {1} complete Figures; all five modules now use the same article text"
  ],
  [
    "{0} · {1} 张 Figure · {2} 个图文件 · {3} 张图缺少原图，详见 manifest",
    "{0} · {1} Figures · {2} image files · {3} Figures lack original images; see manifest"
  ],
  [
    "本机与目录中的保存内容不同；已保留现有内容并停止本次恢复，请先核对需要保留的版本（{0}）",
    "Local and folder copies differ. Current content is preserved and restore stopped; check which version to keep ({0})"
  ],
  [
    "后台恢复提交结果尚未确认；请先保留页面与草稿并核对本机记录，不要直接重复恢复（{0}）",
    "Background restore is not confirmed. Keep the page and drafts, and check local records before attempting another restore ({0})"
  ],
  [
    "已导入 {0} 张 Figure、识别 {1} 个 Panel；尚缺 {2}，请手动补充或重试",
    "Imported {0} Figures and identified {1} Panels; {2} still missing. Add them manually or retry"
  ],
  [
    "当前模型无法读取 {0} 的图片。可继续依据图注与正文解读，图像细节将无法核对。",
    "The current model cannot read the image for {0}. You can continue using the caption and article text; image details cannot be verified."
  ],
  [
    "PDF 已准备完成：{0} 个段落、{1} 张 Figure；全文问答和图解现在可用",
    "PDF ready: {0} paragraphs and {1} Figures; full-text Q&A and figure interpretation are now available"
  ],
  [
    "；本次离线网页不完整（{0} 项资源未保存），已保留之前的离线副本，请联网重试",
    "; offline webpage incomplete ({0} resources not saved). The previous offline copy is preserved; reconnect and retry"
  ],
  [
    "{0}；Ctrl 或 Command 加 Enter 保存，Escape 取消",
    "{0}; Ctrl or Command + Enter to save, Escape to cancel"
  ],
  [
    "PDF 已准备完成：{0} 个段落、{1} 张 Figure；全文问答和图解现在可用{2}",
    "PDF ready: {0} paragraphs and {1} Figures; full-text Q&A and figure interpretation are now available{2}",
    [
      2
    ]
  ],
  [
    "已保存到 Zotero「{0}」：按原网页排版保留快照，内嵌 {1} 张高清原图，",
    "Saved to Zotero “{0}”: webpage layout preserved in the snapshot, with {1} embedded high-resolution original images,"
  ],
  [
    "未能完成 {0} 的图片解读。可继续依据图注与正文解读，图像细节将无法核对。",
    "Could not complete image interpretation for {0}. You can continue using the caption and article text; image details cannot be verified."
  ],
  [
    "将删除本文 {0} 条手动标注，其中 {1} 条待重新定位。自动高亮不会受影响。",
    "Delete {0} manual annotations in this article, including {1} that need relocation. Automatic highlights are unaffected."
  ],
  [
    "{0}Ctrl 点击多选，Shift 点击选择连续范围；直接点击展开或收起",
    "{0}Ctrl-click for multiple selection; Shift-click for a contiguous range; click to expand or collapse"
  ],
  [
    "当前有新编辑或尚未保存的草稿，已停止恢复并保留内容；请先完成保存（{0}）",
    "Restore stopped because there are new edits or unsaved drafts. Content is preserved; finish saving first ({0})"
  ],
  [
    "本机内容或删除记录已改变，旧档案未覆盖当前数据；请重新核对后扫描（{0}）",
    "Local content or deletion records changed. The old archive did not overwrite current data; review it and scan again ({0})"
  ],
  [
    "未能获取 {0} 的图片。可继续依据图注与正文解读，图像细节将无法核对。",
    "Could not retrieve the image for {0}. You can continue using the caption and article text; image details cannot be verified."
  ],
  [
    "逐图解读完成 {0}/{1} 张，{2} 张失败；成功结果已保留，重试时会复用缓存{3}",
    "Individual Figure interpretation: {0}/{1} complete, {2} failed. Successful results are preserved and cached results will be reused on retry{3}",
    [
      3
    ]
  ],
  [
    "{0}；依次切换关闭、开启、按需。按需模式由模型判断是否需要外部检索。",
    "{0}; cycle through off, on, and as needed. In as-needed mode, the model decides whether external search is necessary.",
    [
      0
    ]
  ],
  [
    "无法跳转到 {0}：当前原文图注或图片位置不可用，请刷新论文后重试。",
    "Cannot navigate to {0}: the original caption or image location is unavailable. Refresh the paper and retry."
  ],
  [
    "；{0} 张 Figure 未能下载原图，请查看 manifest",
    "; original images for {0} Figures could not be downloaded; see manifest"
  ],
  [
    "{0}的模型已配置；请在设置的“正文发送许可”中勾选同意并保存。",
    "The model for {0} is configured. In settings, consent to sending article text and save.",
    [
      0
    ]
  ],
  [
    "Zotero 导出：{0} · {1}/{2} 项 · {3} 项处理中 · {4} 秒{5}",
    "Zotero export: {0} · {1}/{2} items · {3} processing · {4} seconds{5}",
    [
      0,
      5
    ]
  ],
  [
    "PPT 材料包已导出：{0} 张 Figure、{1} 个高清图文件",
    "PPT materials exported: {0} Figures and {1} high-resolution image files"
  ],
  [
    "；{0} 项资源缺失、{1} 项还原限制，快照可能与当前网页存在差异",
    "; {0} resources missing and {1} rendering limitations may affect snapshot fidelity"
  ],
  [
    "浏览器工作区恢复已提交；{0}。请保留当前编辑并核对恢复结果。",
    "Browser workspace restore submitted; {0}. Keep current edits and check the restore result.",
    [
      0
    ]
  ],
  [
    "PPT 材料包已导出：{0} 张 Figure、{1} 个高清图文件{2}",
    "PPT materials exported: {0} Figures and {1} high-resolution image files{2}",
    [
      2
    ]
  ],
  [
    "主图证据输入：{0}/{1} 张已有逐图解读；其余按图注谨慎串联。",
    "Main-Figure evidence: {0}/{1} Figures have individual interpretations; the rest are linked cautiously using captions."
  ],
  [
    "正文提及 {0} 张补充图；已纳入 {1} 张，其中 {2} 张已解读。",
    "The article mentions {0} supplementary Figures. {1} are included, of which {2} have been interpreted."
  ],
  [
    "{0} 条证据没有绑定到回答中的具体句子，因此未生成跳转点。",
    "{0} evidence items are not bound to specific answer sentences, so no navigation targets were created."
  ],
  [
    "暂时无法核验本机已保存内容，已停止恢复；请稍后重试（{0}）",
    "Cannot verify locally saved content yet. Restore stopped; retry later ({0})"
  ],
  [
    "笔记内容已保留，完成确认失败（{0}）；重试只核对保存状态。",
    "Note content is preserved, but completion confirmation failed ({0}). Retrying only checks save status.",
    [
      0
    ]
  ],
  [
    "{0}；已生成段落已有缓存，档案保存尚未确认；重试会复用缓存",
    "{0}; generated paragraphs are cached; archive saving is unconfirmed. Retry will reuse the cache",
    [
      0
    ]
  ],
  [
    "自动高亮已清除，手动标注保留不变；本地状态保存失败：{0}",
    "Automatic highlights cleared; manual annotations preserved. Failed to save local state: {0}",
    [
      0
    ]
  ],
  [
    "已导出 {0} 项全局缩略词，可直接分享 JSON 文件。",
    "Exported {0} global abbreviations. The JSON file can be shared directly."
  ],
  [
    "Q0 已通过来源与结果泄漏检查；覆盖 {0} 个证据原子。",
    "Q0 passed source and result-leakage checks, covering {0} evidence atoms."
  ],
  [
    "；{0} 个字段的来源未保存，正文已保留，请对照原文核验。",
    "; sources for {0} fields were not saved. Text is preserved; verify it against the original."
  ],
  [
    "自动高亮已清除，手动标注保留不变；本地状态保存失败：",
    "Automatic highlights cleared; manual annotations preserved. Failed to save local state:"
  ],
  [
    "已补齐 {0} 项空白内容；保留已有内容和正在编辑的内容。",
    "Filled {0} blank fields; existing content and current edits were preserved."
  ],
  [
    "PPT 材料：{0} · {1}/{2} 项 · {3} 项处理中 · {4} 秒{5}",
    "PPT materials: {0} · {1}/{2} items · {3} processing · {4} seconds{5}",
    [
      0,
      5
    ]
  ],
  [
    "双击核验/恢复来源（仅阻止已记录且未提交的来源写入）",
    "Double-click to verify/restore sources (only recorded, uncommitted source writes are blocked)"
  ],
  [
    "；本次离线网页不完整（{0} 项资源未保存），请联网重试",
    "; offline webpage incomplete ({0} resources not saved); reconnect and retry"
  ],
  [
    "{0} 张完整 Figure；五个模块现在共用同一份正文",
    "{0} complete Figures; all five modules now use the same article text"
  ],
  [
    "{0}Ctrl/⌘+Enter 保存，Escape 取消",
    "{0}Ctrl/⌘+Enter to save, Escape to cancel"
  ],
  [
    "已导入 {0} 张 Figure、识别 {1} 个 Panel",
    "Imported {0} Figures and identified {1} Panels"
  ],
  [
    "确定删除 {0}？\n\n这会同时移除其解图结果和串解关系。",
    "Delete {0}?\n\nThis also removes its interpretation and cross-Figure relationships."
  ],
  [
    "来源准备已停止（停止来源未确认），已保存结果保留。",
    "Source preparation stopped (stop origin unconfirmed). Saved results are preserved."
  ],
  [
    "图解启动已停止（停止来源未确认），已保存结果保留。",
    "Figure interpretation startup stopped (stop origin unconfirmed). Saved results are preserved."
  ],
  [
    "当前文献已建立正文索引 · {0} paragraphs",
    "Article text index ready · {0} paragraphs"
  ],
  [
    "已审计 Panel 证据 {0}；类别：{1}；证据代码：{2}；{3}",
    "Audited Panel evidence {0}; category: {1}; evidence code: {2}; {3}",
    [
      1,
      3
    ]
  ],
  [
    "围绕论文科学问题“{0}”，本证据块展开首轮证据检验。",
    "This evidence block begins the evidence assessment for the paper’s scientific question “{0}”."
  ],
  [
    "浏览器本地保存已完成；{0} 项检测到更晚的并发修改，",
    "Browser-local save completed; {0} items have newer concurrent edits,"
  ],
  [
    "可定位高亮 {0} 句；当前阈值保留 {1} 句，排除 {2} 句",
    "{0} locatable highlight sentences; threshold keeps {1} and excludes {2}"
  ],
  [
    "图解收尾未确认：{0}；已保存结果保留，请核对后继续。",
    "Figure finalization unconfirmed: {0}; saved results are preserved. Check before continuing.",
    [
      0
    ]
  ],
  [
    "双击或 Shift+Enter {0} · {1} · {2}/{3}",
    "Double-click or Shift+Enter to {0} · {1} · {2}/{3}",
    [
      0,
      1
    ]
  ],
  [
    "{0}；已下载内嵌 {1} 张高清原图的原网页快照 ZIP{2}",
    "{0}; downloaded the webpage snapshot ZIP with {1} embedded high-resolution original images{2}",
    [
      0,
      2
    ]
  ],
  [
    "已保存 {0} 个工作区文件和 {1} 轮问答到本地文件夹{2}",
    "Saved {0} workspace files and {1} Q&A rounds to the local folder{2}",
    [
      2
    ]
  ],
  [
    "已显示 {0} 处讨论；点击正文虚线句子阅读与交流。",
    "Displayed {0} discussions. Click dashed-underlined sentences to read and discuss."
  ],
  [
    "；{0} 个字段未完成，已保存有效结果，可单独重试。",
    "; {0} fields are incomplete. Valid results were saved and can be retried individually."
  ],
  [
    "目录写入未完成（{0}），数据仍保留在待同步队列中",
    "Folder write incomplete ({0}); data remains in the pending sync queue",
    [
      0
    ]
  ],
  [
    "本轮上下文：{0}/{1} 段 · 已按问题覆盖相关章节",
    "Context for this round: {0}/{1} paragraphs · Relevant sections selected for the question"
  ],
  [
    "本次结果已保存在浏览器；文件夹同步尚未完成。{0}",
    "Results saved in the browser; folder synchronization is not complete yet. {0}",
    [
      0
    ]
  ],
  [
    "已存入本地词库：新增 {0}、更新 {1}、已有 {2} 项",
    "Saved to local glossary: {0} added, {1} updated, {2} already present"
  ],
  [
    "{0} 张 Figure；全文问答和图解现在可用",
    "{0} Figures; full-text Q&A and figure interpretation are now available"
  ],
  [
    "Figure 排序未保存：{0}；原顺序已保留。",
    "Figure order was not saved: {0}. The original order is preserved.",
    [
      0
    ]
  ],
  [
    "已从本地工作区恢复全部结果和 {0} 轮历史问答",
    "Restored all results and {0} historical Q&A rounds from the local workspace"
  ],
  [
    "· {0} 张图缺少原图，详见 manifest",
    "· {0} Figures lack original images; see manifest"
  ],
  [
    "PPT 材料包已导出：{0} 张 Figure、",
    "PPT materials exported: {0} Figures,"
  ],
  [
    "已恢复当前网页的本地工作区和 {0} 轮历史问答",
    "Restored the current webpage’s local workspace and {0} historical Q&A rounds"
  ],
  [
    "；已保存 {0} 个字段，重试会继续未完成部分。",
    "; {0} fields saved. Retry will continue the unfinished parts."
  ],
  [
    "其中 {0} 条待重新定位。自动高亮不会受影响。",
    "including {0} that need relocation. Automatic highlights are unaffected."
  ],
  [
    "{0}模型正在处理（已等待 {1} 秒，最长 {2} 秒）…",
    "{0}Model processing (waited {1} seconds, up to {2} seconds)…",
    [
      0
    ]
  ],
  [
    "Figure 解读已取消，已完成结果会保留{0}",
    "Figure interpretation cancelled; completed results are preserved{0}",
    [
      0
    ]
  ],
  [
    "{0} · {1} 张 Figure · {2} 个图文件",
    "{0} · {1} Figures · {2} image files"
  ],
  [
    "适配诊断包已导出：{0} ·{1} 个候选正文根节点",
    "Site-adaptation diagnostics exported: {0} · {1} candidate article roots"
  ],
  [
    "第 {0} 段：单击跳转，双击生成 AI 概述",
    "Paragraph {0}: click to locate; double-click for an AI overview"
  ],
  [
    "围绕论文科学问题“{0}”，本证据块聚焦“{1}”。",
    "For the paper’s scientific question “{0}”, this evidence block focuses on “{1}”."
  ],
  [
    "{0}；已保存结果保留，请刷新文献后重新解图。",
    "{0}; saved results are preserved. Refresh the article before interpreting Figures again.",
    [
      0
    ]
  ],
  [
    "{0} · {1} 张 Figure · {2} 个图文件{3}",
    "{0} · {1} Figures · {2} image files{3}",
    [
      3
    ]
  ],
  [
    "开始或继续未完成图解（保留此前费用预留）",
    "start or continue unfinished Figure interpretations (previous cost reservation preserved)"
  ],
  [
    "请先在设置中保存可供全部解图使用的模型。",
    "First save a model for all Figure interpretations in Settings."
  ],
  [
    "双击或 Shift+Enter {0} · {1}",
    "Double-click or Shift+Enter to {0} · {1}",
    [
      0,
      1
    ]
  ],
  [
    "未找到 {0} 在当前正文中的首次出现位置。",
    "The first occurrence of {0} was not found in the current article text."
  ],
  [
    "同色 Panel 属于同一证据功能组：{0}",
    "Panels with the same color belong to the same evidence-function group: {0}"
  ],
  [
    "针对前序留下的“{0}”，本证据块聚焦“{1}”。",
    "Addressing the earlier unresolved question “{0}”, this evidence block focuses on “{1}”."
  ],
  [
    "待核验：仅可定位到第 {0} 页（页级证据）",
    "Verification pending: only page {0} can be located (page-level evidence)"
  ],
  [
    "智能检索完成，已在原文高亮 {0} 处匹配。",
    "Smart search completed; highlighted {0} matches in the original text."
  ],
  [
    "；本次离线网页不完整（{0} 项资源未保存）",
    "; this offline webpage is incomplete ({0} resources not saved)"
  ],
  [
    "跨图综合已生成：{0} 个节点、{1} 条跨图连接",
    "Cross-Figure synthesis generated: {0} nodes, {1} cross-Figure links"
  ],
  [
    "本轮上下文：{0}/{1} 段 · 已发送完整正文",
    "Context for this round: {0}/{1} paragraphs · Full article text sent"
  ],
  [
    "；本次离线网页不完整（{0} 项资源未保存）{1}",
    "; offline webpage incomplete ({0} resources not saved){1}",
    [
      1
    ]
  ],
  [
    "{0}：可重新提取，或导出适配诊断包用于修复",
    "{0}: retry extraction or export site-adaptation diagnostics for troubleshooting",
    [
      0
    ]
  ],
  [
    "补充来源尚未准备完整，已保存结果保留。{0}",
    "Supplementary sources are not fully ready. Saved results are preserved. {0}",
    [
      0
    ]
  ],
  [
    "跨图综合已生成：{0} 个节点、{1} 条跨图连接{2}",
    "Cross-Figure synthesis generated: {0} nodes and {1} cross-Figure links{2}",
    [
      2
    ]
  ],
  [
    "已更新分析范围：当前包含 {0} 段正文。",
    "Analysis scope updated: {0} article paragraphs included."
  ],
  [
    "所选标题字段暂无内容，显示已有描述：{0}",
    "The selected title field is empty; showing the existing description: {0}",
    [
      0
    ]
  ],
  [
    "已审计 Panel 证据 {0}；类别：{1}；",
    "Audited Panel evidence {0}; category: {1};",
    [
      1
    ]
  ],
  [
    "图解与全文问答已分别保存为两个子笔记",
    "figure interpretations and full-text Q&A saved as two separate child notes"
  ],
  [
    "已自动恢复本地工作区和 {0} 轮历史问答",
    "Automatically restored the local workspace and {0} historical Q&A rounds"
  ],
  [
    "分析模式已保存，但正文组合刷新失败：{0}",
    "Analysis mode saved, but article composition refresh failed: {0}",
    [
      0
    ]
  ],
  [
    "清除手动标注失败，页面标记保持不变：{0}",
    "Failed to clear manual annotations; page marks are unchanged: {0}",
    [
      0
    ]
  ],
  [
    "图解归档收尾失败：{0}；已保存图解保留。",
    "Figure archive finalization failed: {0}; saved interpretations are preserved.",
    [
      0
    ]
  ],
  [
    "{0}，暂不可开始新任务；已保存结果保留。",
    "{0}; a new task cannot start yet. Saved results are preserved.",
    [
      0
    ]
  ],
  [
    "关系：{0}；上游：{1}；支持 Figure：{2}",
    "Relationship: {0}; upstream: {1}; supporting Figures: {2}"
  ],
  [
    "{0}；档案保存队列已确认，重新点击可恢复",
    "{0}; archive save queue confirmed; click again to resume",
    [
      0
    ]
  ],
  [
    "已存 {0} · 可识别 {1} · 已校验 {2}",
    "Saved {0} · Recognizable {1} · Verified {2}"
  ],
  [
    "PDF 已建立统一索引：{0} 个段落、",
    "Unified PDF index ready: {0} paragraphs,"
  ],
  [
    "已定位 {0} 在正文中的首次出现位置。",
    "Located the first occurrence of {0} in the article text."
  ],
  [
    "停止确认中：{0}；不会启动第二个任务。",
    "Confirming stop: {0}; a second task will not be started.",
    [
      0
    ]
  ],
  [
    "；{0} 张 Figure 未能获取原图",
    "; original images for {0} Figures could not be retrieved"
  ],
  [
    "，含离线网页、样式和 {0} 张阅读图片",
    ", including the offline webpage, styles, and {0} reading images"
  ],
  [
    "笔记草稿保存失败，当前内容仍保留：{0}",
    "Note draft save failed; current content is preserved: {0}",
    [
      0
    ]
  ],
  [
    "英文全称 {0}；查看完整含义并定位原文",
    "English full form {0}; view its full meaning and locate it in the article"
  ],
  [
    "双击或 Shift+Enter {0}",
    "Double-click or Shift+Enter to {0}",
    [
      0
    ]
  ],
  [
    "{0}：双击或按 Enter、空格编辑",
    "{0}: double-click or press Enter/Space to edit",
    [
      0
    ]
  ],
  [
    "图像依据：PDF 第 {0} 页原页。",
    "Image source: original PDF page {0}."
  ],
  [
    "请先在设置中保存可供{0}使用的模型。",
    "First save a model for {0} in settings.",
    [
      0
    ]
  ],
  [
    "检索已完成，但原文高亮定位失败：{0}",
    "Search completed, but locating highlights in the original text failed: {0}",
    [
      0
    ]
  ],
  [
    "分类已保存，但正文组合刷新失败：{0}",
    "Categories saved, but article composition refresh failed: {0}",
    [
      0
    ]
  ],
  [
    "预设已保存，但正文组合刷新失败：{0}",
    "Preset saved, but article composition refresh failed: {0}",
    [
      0
    ]
  ],
  [
    "识别模式已保存，但正文准备失败：{0}",
    "Recognition mode saved, but article preparation failed: {0}",
    [
      0
    ]
  ],
  [
    "逐图解读完成 {0}/{1} 张，{2} 张失败；",
    "Individual Figure interpretation: {0}/{1} completed, {2} failed;"
  ],
  [
    "切换分析模式失败，已恢复原选择：{0}",
    "Failed to switch analysis mode; original selection restored: {0}",
    [
      0
    ]
  ],
  [
    "恢复预设失败，已保留原分类选择：{0}",
    "Failed to restore the preset; previous categories preserved: {0}",
    [
      0
    ]
  ],
  [
    "逐图解读完成：{0} 张 Figure{1}",
    "Figure analysis complete: {0} Figures{1}",
    [
      1
    ]
  ],
  [
    "来源准备已停止，已保存结果保留。",
    "Source preparation stopped. Saved results are preserved."
  ],
  [
    "图解启动已停止，已保存结果保留。",
    "Figure interpretation startup stopped. Saved results are preserved."
  ],
  [
    "当前文献已建立正文索引 · {0} 段",
    "Article text index ready · {0} paragraphs"
  ],
  [
    "页面内容（含参考文献等公开资料）",
    "page content (including references and other public material)"
  ],
  [
    "（已完成 {0}/{1} 张，失败 {2} 张）",
    "(completed {0}/{1} Figures, {2} failed)"
  ],
  [
    "PDF 已准备完成：{0} 个段落、",
    "PDF ready: {0} paragraphs,"
  ],
  [
    "{0}：{1}；双击或按 Enter 编辑",
    "{0}: {1}; double-click or press Enter to edit",
    [
      0
    ]
  ],
  [
    "设置 Panel {0} 笔记可见性{1}",
    "Set visibility for Panel {0} note{1}",
    [
      1
    ]
  ],
  [
    "{0} {1}：双击或按 Enter 编辑",
    "{0} {1}: double-click or press Enter to edit",
    [
      0
    ]
  ],
  [
    "{0} 段正文索引。此操作不可撤销。",
    "{0} indexed article paragraphs. This cannot be undone."
  ],
  [
    "Panel 标题信息保存失败：{0}",
    "Failed to save Panel title information: {0}",
    [
      0
    ]
  ],
  [
    "Panel 标题显示刷新失败：{0}",
    "Failed to refresh Panel title display: {0}",
    [
      0
    ]
  ],
  [
    "{0}模型正在处理（已等待 {1} 秒）…",
    "{0}Model processing (waited {1} seconds)…",
    [
      0
    ]
  ],
  [
    "缩写 {0}；查看完整含义并定位原文",
    "Abbreviation {0}; view its full meaning and locate it in the article"
  ],
  [
    "Zotero 导出：{0} · {1} 秒{2}",
    "Zotero export: {0} · {1} seconds{2}",
    [
      0,
      2
    ]
  ],
  [
    "无法控制 Figure 解读：{0}",
    "Unable to control Figure interpretation: {0}",
    [
      0
    ]
  ],
  [
    "无法取消 Figure 解读：{0}",
    "Unable to cancel Figure interpretation: {0}",
    [
      0
    ]
  ],
  [
    "已翻译 {0} 个标题，{1} 个失败。{2}",
    "Translated {0} titles; {1} failed. {2}",
    [
      2
    ]
  ],
  [
    "本证据块承接前序留下的“{0}”。",
    "This evidence block follows up on the earlier unresolved question “{0}”."
  ],
  [
    "当前论文没有 Figure {0}",
    "The current paper has no Figure {0}"
  ],
  [
    "第 {0} 条联系（{1}） · {2} · {3}",
    "Relationship {0} ({1}) · {2} · {3}",
    [
      1
    ]
  ],
  [
    "已发现 {0} 张图（{1} 张补充图）",
    "Found {0} Figures ({1} supplementary)"
  ],
  [
    "{0} · {1} 张 Figure ·",
    "{0} · {1} Figures ·"
  ],
  [
    "{0}；已下载内嵌 {1} 张高清原图的",
    "{0}; downloaded a snapshot with {1} embedded high-resolution original images",
    [
      0
    ]
  ],
  [
    "确定清除“{0}”的本地工作区吗？",
    "Clear the local workspace for “{0}”?"
  ],
  [
    "保存分类失败，已恢复原选择：{0}",
    "Failed to save categories; original selection restored: {0}",
    [
      0
    ]
  ],
  [
    "{0} · {1}/{2} 项 · {3} 项处理中",
    "{0} · {1}/{2} items · {3} processing",
    [
      0
    ]
  ],
  [
    "未识别长文本 {0} 块/{1} 字：{2}",
    "Unrecognized long text: {0} blocks/{1} characters: {2}",
    [
      2
    ]
  ],
  [
    "已完成 {0} 个导航标题翻译。",
    "Translated {0} navigation titles."
  ],
  [
    "加载更早对话（还有 {0} 轮）",
    "Load earlier conversations ({0} rounds remaining)"
  ],
  [
    "Figure 目录已刷新：{0}",
    "Figure directory refreshed: {0}"
  ],
  [
    "{0} 个 Figure 结果和",
    "{0} Figure results and"
  ],
  [
    "保留 {0} 句 · 排除 {1} 句",
    "Keep {0} sentences · Exclude {1}"
  ],
  [
    "台账关系 {0} 条/审读 {1} 条",
    "Evidence records: {0} relationships / {1} reviewed"
  ],
  [
    "完成 {0}/{1} 张，{2} 张分析失败{3}",
    "Completed {0}/{1} Figures, {2} analyses failed{3}",
    [
      3
    ]
  ],
  [
    "将删除本文 {0} 条手动标注，",
    "Delete {0} manual annotations in this article,"
  ],
  [
    "来源 {0} · {1}（引文待核验）",
    "Source {0} · {1} (quotation awaiting verification)"
  ],
  [
    "PDF 增强识别未完成：{0}",
    "Enhanced PDF recognition incomplete: {0}"
  ],
  [
    "无法定位 {0} 的原文位置。",
    "Cannot locate {0} in the original text."
  ],
  [
    "已存入本地词库：新增 {0}、",
    "Saved to local glossary: {0} added,"
  ],
  [
    "{0}：单击查看 · 离线只读",
    "{0}: click to view · Offline, read-only",
    [
      0
    ]
  ],
  [
    "{0}参与规则和 LLM 分析",
    "Include {0} in rule-based and LLM analysis"
  ],
  [
    "{0} · Panel {1} 笔记",
    "{0} · Panel {1} note"
  ],
  [
    "查看 Panel {0} 评论",
    "View Panel {0} comments"
  ],
  [
    "已解读 {0} 个 Panel",
    "Interpreted {0} Panels"
  ],
  [
    "替换 Panel 证据 {0}",
    "Replace Panel evidence {0}"
  ],
  [
    "移除 Panel 证据 {0}",
    "Remove Panel evidence {0}"
  ],
  [
    "Figure 跳转失败：{0}",
    "Figure navigation failed: {0}",
    [
      0
    ]
  ],
  [
    "清除当前页本地内容失败：{0}",
    "Failed to clear local content for this page: {0}",
    [
      0
    ]
  ],
  [
    "已生成本地大纲：{0} 个标题",
    "Generated a local outline with {0} headings"
  ],
  [
    "{0}–{1}分：{2}句，保留{3}句，排除{4}句",
    "Score {0}–{1}: {2} sentences, keep {3}, exclude {4}"
  ],
  [
    "{0} · {1} 个标题 · {2} 段{3}",
    "{0} · {1} headings · {2} paragraphs of {3}",
    [
      3
    ]
  ],
  [
    "PPT 材料：{0} · {1} 秒{2}",
    "PPT materials: {0} · {1} seconds{2}",
    [
      0,
      2
    ]
  ],
  [
    "从本文缩略词表移除 {0}？",
    "Remove {0} from this article’s abbreviation table?"
  ],
  [
    "跳转到以 {0} 开头的缩写",
    "Jump to abbreviations starting with {0}"
  ],
  [
    "第 {0} 段，单击编辑笔记",
    "Paragraph {0}, click to edit note"
  ],
  [
    "无法更新章节分析范围：{0}",
    "Cannot update the section analysis scope: {0}",
    [
      0
    ]
  ],
  [
    "Panel 解读 · {0}",
    "Panel interpretation · {0}"
  ],
  [
    "历史追问 · {0}（{1} 轮）",
    "Previous follow-up · {0} ({1} rounds)"
  ],
  [
    "已取得 {0} 项，正在保存",
    "Obtained {0} items; saving"
  ],
  [
    "本轮{0}；点击切换联网模式",
    "This turn: {0}; click to change web-search mode",
    [
      0
    ]
  ],
  [
    "保存到本地文件夹失败：{0}",
    "Failed to save to the local folder: {0}",
    [
      0
    ]
  ],
  [
    "笔记模板选择保存失败：{0}",
    "Failed to save the note-template selection: {0}",
    [
      0
    ]
  ],
  [
    "适配诊断包已导出：{0} ·",
    "Site-adaptation diagnostics exported: {0} ·"
  ],
  [
    "无法打开分类规则设置：{0}",
    "Cannot open classification rules: {0}",
    [
      0
    ]
  ],
  [
    "{0} · LLM 语义识别",
    "{0} · LLM semantic recognition",
    [
      0
    ]
  ],
  [
    "；已识别 Panel {0}",
    "; identified Panel {0}"
  ],
  [
    "Panel 解读失败：{0}",
    "Panel interpretation failed: {0}",
    [
      0
    ]
  ],
  [
    "Panel 追问失败：{0}",
    "Panel follow-up failed: {0}",
    [
      0
    ]
  ],
  [
    "来源 {0} · 位置待核验",
    "Source {0} · Location awaiting verification"
  ],
  [
    "本次窗口；全计划 {0} 张",
    "Current window; {0} Figures in the full plan"
  ],
  [
    "正在读取本地匹配分数…",
    "Reading local match scores…"
  ],
  [
    "已保存 {0} 的中文全称",
    "Saved chinese full form for {0}"
  ],
  [
    "PDF 解析未完成：{0}",
    "PDF parsing incomplete: {0}"
  ],
  [
    "没有以 {0} 开头的缩写",
    "No abbreviations starting with {0}"
  ],
  [
    "共 {0} 项 · 自动 {1}",
    "{0} entries · {1} automatic"
  ],
  [
    "· 共 {0} 次模型请求",
    "· {0} model requests in total"
  ],
  [
    "已完成 {0} 的定向追问",
    "Targeted follow-up for {0} completed"
  ],
  [
    "已存 {0}{1} · 可识别 {2}",
    "Saved {0}{1} · Recognizable {2}"
  ],
  [
    "扫描本地工作区失败：{0}",
    "Failed to scan local workspaces: {0}",
    [
      0
    ]
  ],
  [
    "最低置信度已设为 {0}%",
    "Minimum confidence set to {0}%"
  ],
  [
    "{0}–{1}分 · {2} · {3} {4}句",
    "Score {0}–{1} · {2} · {3} {4} sentences"
  ],
  [
    "未识别长文本 {0} 块/",
    "Unrecognized long text: {0} blocks/"
  ],
  [
    "已选择：{0}（{1} KiB）",
    "Selected: {0} ({1} KiB)"
  ],
  [
    "已完成 {0} 的单图精读",
    "Completed in-depth interpretation of {0}"
  ],
  [
    "· 待重新定位 {0} 条",
    "· {0} need relocation"
  ],
  [
    "LLM 已高亮 {0} 处",
    "LLM highlighted {0} locations"
  ],
  [
    "从本文缩略词表移除 {0}",
    "Remove {0} from this article’s abbreviation table"
  ],
  [
    "已保存默认查词网站：{0}",
    "Default word-lookup website saved: {0}"
  ],
  [
    "适配诊断包导出失败：{0}",
    "Failed to export site-adaptation diagnostics: {0}",
    [
      0
    ]
  ],
  [
    "{0} 张仅使用图注与正文",
    "{0} Figures use captions and article text only"
  ],
  [
    "论文大纲已生成：{0} 段{1}",
    "Article outline generated: {0} paragraphs{1}",
    [
      1
    ]
  ],
  [
    "（已完成 {0}/{1} 张）",
    "(completed {0}/{1} Figures)"
  ],
  [
    "保存 {0} 的中文全称",
    "Save chinese full form for {0}"
  ],
  [
    "· 本地词库 {0} 项",
    "· {0} local glossary entries"
  ],
  [
    "缩略词表读取失败：{0}",
    "Failed to read the abbreviation table: {0}"
  ],
  [
    "更新 {0}、已有 {1} 项",
    "{0} updated, {1} already present"
  ],
  [
    "存入本地词库失败：{0}",
    "Failed to save to local glossary: {0}"
  ],
  [
    "全局词库导出失败：{0}",
    "Failed to export the global glossary: {0}"
  ],
  [
    "打开设置页面失败：{0}",
    "Failed to open settings: {0}",
    [
      0
    ]
  ],
  [
    "{0} 的人工修订已保存",
    "Manual revision saved for {0}"
  ],
  [
    "跨图总链生成失败：{0}",
    "Failed to generate the cross-Figure chain: {0}",
    [
      0
    ]
  ],
  [
    "已存 {0} Panel",
    "{0} Panels saved"
  ],
  [
    "图表梳理已导出为 {0}",
    "Figure organization exported as {0}"
  ],
  [
    "设置 {0} 的证据类别",
    "Set evidence category for {0}"
  ],
  [
    "同步回原论文失败：{0}",
    "Failed to sync back to the original paper: {0}",
    [
      0
    ]
  ],
  [
    "补充图拖动已取消：{0}",
    "Supplementary Figure drag cancelled: {0}",
    [
      0
    ]
  ],
  [
    "智能检索发送失败：{0}",
    "Failed to send smart-search request: {0}",
    [
      0
    ]
  ],
  [
    "无法修改本轮问答：{0}",
    "Cannot edit this Q&A turn: {0}",
    [
      0
    ]
  ],
  [
    "加载本文档案失败：{0}",
    "Failed to load this article’s archive: {0}",
    [
      0
    ]
  ],
  [
    "导出本文档案失败：{0}",
    "Failed to export this article’s archive: {0}",
    [
      0
    ]
  ],
  [
    "导入本文档案失败：{0}",
    "Failed to import this article’s archive: {0}",
    [
      0
    ]
  ],
  [
    "{0}，正在核对保存状态",
    "{0}; checking save status",
    [
      0
    ]
  ],
  [
    "{0} 个候选正文根节点",
    "{0} candidate article roots"
  ],
  [
    "类型 {0}（用户选择）",
    "Type: {0} (user selected)",
    [
      0
    ]
  ],
  [
    "低于阈值隐藏 {0} 条",
    "{0} items hidden below threshold"
  ],
  [
    "（已完成 {0}/{1} 段）",
    "(completed {0}/{1} paragraphs)"
  ],
  [
    "本文手动标注 {0} 条",
    "{0} manual annotations in this article"
  ],
  [
    "清除自动高亮失败：{0}",
    "Failed to clear automatic highlights: {0}",
    [
      0
    ]
  ],
  [
    "无法切换识别模式：{0}",
    "Cannot switch recognition mode: {0}",
    [
      0
    ]
  ],
  [
    "显示密度切换失败：{0}",
    "Failed to change display density: {0}",
    [
      0
    ]
  ],
  [
    "查词链接读取失败：{0}",
    "Failed to read word-lookup links: {0}",
    [
      0
    ]
  ],
  [
    "单段摘要生成失败：{0}",
    "Paragraph summary generation failed: {0}",
    [
      0
    ]
  ],
  [
    "定位段落笔记失败：{0}",
    "Failed to locate the paragraph note: {0}",
    [
      0
    ]
  ],
  [
    "论文大纲生成失败{0}：{1}",
    "Article outline generation failed{0}: {1}",
    [
      0,
      1
    ]
  ],
  [
    "无法取消全文问答：{0}",
    "Unable to cancel full-text Q&A: {0}",
    [
      0
    ]
  ],
  [
    "无法加载更早问答：{0}",
    "Unable to load earlier Q&A: {0}",
    [
      0
    ]
  ],
  [
    "无法清空全文问答：{0}",
    "Unable to clear full-text Q&A: {0}",
    [
      0
    ]
  ],
  [
    "无法控制全文分析：{0}",
    "Unable to control full-text analysis: {0}",
    [
      0
    ]
  ],
  [
    "无法取消全文分析：{0}",
    "Unable to cancel full-text analysis: {0}",
    [
      0
    ]
  ],
  [
    "创新点（作者声明）",
    "Novelty (author’s claim)"
  ],
  [
    "已保存 {0} 的含义",
    "Saved meaning for {0}"
  ],
  [
    "· 中文全称 {0}/{1}",
    "· Chinese full forms {0}/{1}"
  ],
  [
    "{0}单击编辑笔记。\n{1}",
    "{0}Click to edit note.\n{1}"
  ],
  [
    "{0} 已恢复模型原文",
    "Original model text restored for {0}"
  ],
  [
    "{0} 个 Panel",
    "{0} Panels"
  ],
  [
    "原 Panel：{0}",
    "Original Panel: {0}"
  ],
  [
    "{0} 没有可跳转的 {1}",
    "{0} has no available {1} target",
    [
      1
    ]
  ],
  [
    "{0} 的 Panel",
    "Panels in {0}"
  ],
  [
    "{0} · 核对图像页",
    "{0} · Verify image page"
  ],
  [
    "历史目录记录（{0}）",
    "Historical directory record ({0})"
  ],
  [
    "已核对图像页：{0}。",
    "Verified image page: {0}."
  ],
  [
    "参考原文 {0}{1} · {2}",
    "Original source {0}{1} · {2}"
  ],
  [
    "包含 {0} 轮问答、",
    "Includes {0} Q&A rounds,"
  ],
  [
    "PDF 第 {0} 页",
    "PDF page {0}"
  ],
  [
    "模型处理中 · {0}",
    "Model processing · {0}",
    [
      0
    ]
  ],
  [
    "呈现层隐藏 {0} 条",
    "{0} items hidden by presentation rules"
  ],
  [
    "{0} · 仅本次会话",
    "{0} · This session only",
    [
      0
    ]
  ],
  [
    "{0}将使用哪种证据？",
    "Which evidence will {0} use?"
  ],
  [
    "（已完成 {0}/{1} 张",
    "(completed {0}/{1} Figures"
  ],
  [
    "置信度保存失败：{0}",
    "Failed to save confidence: {0}",
    [
      0
    ]
  ],
  [
    "{0} · 原网页布局",
    "{0} · Original webpage layout",
    [
      0
    ]
  ],
  [
    "AI 补全失败：{0}",
    "AI completion failed: {0}",
    [
      0
    ]
  ],
  [
    "生成当前选中字段",
    "generate the currently selected field"
  ],
  [
    "收起{0}的段落摘要",
    "Collapse paragraph summaries under {0}"
  ],
  [
    "展开{0}的段落摘要",
    "Expand paragraph summaries under {0}"
  ],
  [
    "收起{0}的下级标题",
    "Collapse subheadings under {0}"
  ],
  [
    "展开{0}的下级标题",
    "Expand subheadings under {0}"
  ],
  [
    "保存 {0} 的含义",
    "Save meaning for {0}"
  ],
  [
    "笔记加载失败：{0}",
    "Failed to load notes: {0}"
  ],
  [
    "· 全局命中 {0}",
    "· {0} global matches"
  ],
  [
    "标题翻译失败：{0}",
    "Title translation failed: {0}",
    [
      0
    ]
  ],
  [
    "{0} · 第 {1} 轮",
    "{0} · Round {1}"
  ],
  [
    "待补主图节点：{0}",
    "Main-Figure nodes still needed: {0}"
  ],
  [
    "定位正文证据 {0}",
    "Locate article evidence {0}"
  ],
  [
    "{0} · 目录标题",
    "{0} · Outline heading"
  ],
  [
    "移除章节范围：{0}",
    "Remove section scope: {0}"
  ],
  [
    "加载未完成：{0}。",
    "Loading incomplete: {0}.",
    [
      0
    ]
  ],
  [
    "{0} 个高清图文件",
    "{0} high-resolution image files"
  ],
  [
    "正文准备失败：{0}",
    "Article preparation failed: {0}",
    [
      0
    ]
  ],
  [
    "{0}（引文待核验）",
    "{0} (quotation awaiting verification)"
  ],
  [
    "· 目标 {0} 项",
    "· Target: {0} items"
  ],
  [
    "已保存正文段 {0}",
    "Saved article paragraph {0}"
  ],
  [
    "模型返回 {0} 条",
    "Model returned {0} items"
  ],
  [
    "成功应用 {0} 条",
    "Applied {0} items"
  ],
  [
    "定位拒绝 {0} 条",
    "Rejected {0} locations"
  ],
  [
    "语义拒绝 {0} 条",
    "{0} semantic rejections"
  ],
  [
    "原文定位失败：{0}",
    "Failed to locate the original text: {0}",
    [
      0
    ]
  ],
  [
    "{0} · 聚焦布局",
    "{0} · Focused layout",
    [
      0
    ]
  ],
  [
    "概述追加失败：{0}",
    "Failed to append the overview: {0}",
    [
      0
    ]
  ],
  [
    "先解读可用图；{0}",
    "Interpret available Figures first; {0}",
    [
      0
    ]
  ],
  [
    "逐图解读失败{0}：{1}",
    "Individual Figure interpretation failed{0}: {1}",
    [
      0,
      1
    ]
  ],
  [
    "单图精读失败：{0}",
    "Single-Figure detailed interpretation failed: {0}",
    [
      0
    ]
  ],
  [
    "机制关系 {0}/{1}",
    "Mechanism relationships {0}/{1}"
  ],
  [
    "{0} 的中文全称",
    "Chinese full form of {0}"
  ],
  [
    "填写中文全称",
    "Enter chinese full form"
  ],
  [
    "· 含义 {0}/{1}",
    "· Meanings {0}/{1}"
  ],
  [
    "步骤 {0} · {1}",
    "Step {0} · {1}"
  ],
  [
    "定位证据 {0}：{1}",
    "Locate evidence {0}: {1}"
  ],
  [
    "· 已校验 {0}",
    "· Verified {0}"
  ],
  [
    "第 {0} 条联系",
    "Relationship {0}"
  ],
  [
    "证据代码：{0}；{1}",
    "Evidence code: {0}; {1}",
    [
      1
    ]
  ],
  [
    "机制节点 {0}：{1}",
    "Mechanism node {0}: {1}"
  ],
  [
    "置信度 {0} ·",
    "Confidence {0} ·"
  ],
  [
    "{0} 个证据原子",
    "{0} evidence atoms"
  ],
  [
    "{0} · 来自 {1}",
    "{0} · From {1}"
  ],
  [
    "已保存 {0} 项",
    "Saved {0} items"
  ],
  [
    "· 缺 {0} 张",
    "· {0} missing"
  ],
  [
    "{0} 图像页核对",
    "{0} image-page verification"
  ],
  [
    "查看第 {0} 页",
    "View page {0}"
  ],
  [
    "{0} 条手动标注",
    "{0} manual annotations"
  ],
  [
    "{0} 个图解结果",
    "{0} figure interpretations"
  ],
  [
    "已暂停 · {0}",
    "Paused · {0}",
    [
      0
    ]
  ],
  [
    "已完成分块 {0}",
    "Completed chunk {0}"
  ],
  [
    "机制关系 {0}/",
    "Mechanism relationships {0}/"
  ],
  [
    "当前阈值 {0}分",
    "Current threshold: {0} points"
  ],
  [
    "共 {0} 处匹配",
    "{0} matches in total"
  ],
  [
    "完成 {0}/{1} 张",
    "Completed {0}/{1} Figures"
  ],
  [
    "，失败 {0} 张",
    ", {0} Figures failed"
  ],
  [
    "{0}，暂不可重试",
    "{0}; retry is temporarily unavailable",
    [
      0
    ]
  ],
  [
    "· {0} 项缺失",
    "· {0} items missing"
  ],
  [
    "来源未完成：{0}",
    "Sources incomplete: {0}",
    [
      0
    ]
  ],
  [
    "{0} 张来自缓存",
    "{0} Figures from cache"
  ],
  [
    "开始批量处理",
    "start batch processing"
  ],
  [
    "停止当前任务",
    "stop the current task"
  ],
  [
    "· 手动 {0}",
    "· {0} manual"
  ],
  [
    "上次保存：{0}",
    "Last saved: {0}"
  ],
  [
    "{0} · {1} 条",
    "{0} · {1} items"
  ],
  [
    "{0} 解读完成",
    "{0} interpretation complete"
  ],
  [
    "{0} 追问回答",
    "{0} follow-up answer"
  ],
  [
    "你的问题：{0}",
    "Your question: {0}"
  ],
  [
    "本次依据：{0}",
    "Evidence used: {0}"
  ],
  [
    "论证步骤 {0}",
    "Argument step {0}"
  ],
  [
    "{0} 解读字段",
    "{0} interpretation fields"
  ],
  [
    "实验差别：{0}",
    "Experimental difference: {0}"
  ],
  [
    "{0}/{1} 图完成",
    "{0}/{1} Figures complete"
  ],
  [
    "{0} · 图注",
    "{0} · Caption"
  ],
  [
    "已跳转到 {0}",
    "Navigated to {0}"
  ],
  [
    "机制节点 {0}",
    "Mechanism node {0}"
  ],
  [
    "作者表述：{0}",
    "Author’s statement: {0}"
  ],
  [
    "证据等级：{0}",
    "Evidence level: {0}",
    [
      0
    ]
  ],
  [
    "{0}：本轮问答",
    "{0}: current Q&A turn"
  ],
  [
    "{0} 个图文件",
    "{0} image files"
  ],
  [
    "来源 {0} ·",
    "Source {0} ·"
  ],
  [
    "已取得 {0}/{1}",
    "Obtained {0}/{1}"
  ],
  [
    "· 缺失 {0}",
    "· Missing {0}"
  ],
  [
    "分析完成 {0}",
    "Analysis complete {0}"
  ],
  [
    "{0}；分块 {1}/{2}",
    "{0}; chunk {1}/{2}",
    [
      0
    ]
  ],
  [
    "共 {0} 字符",
    "{0} characters in total"
  ],
  [
    "应用失败：{0}",
    "Failed to apply: {0}",
    [
      0
    ]
  ],
  [
    "查词失败：{0}",
    "Word lookup failed: {0}",
    [
      0
    ]
  ],
  [
    "移除失败：{0}",
    "Removal failed: {0}",
    [
      0
    ]
  ],
  [
    "默认网站：{0}",
    "Default website: {0}"
  ],
  [
    "提取失败：{0}",
    "Extraction failed: {0}",
    [
      0
    ]
  ],
  [
    "问答：就绪",
    "Q&A: Ready"
  ],
  [
    "{0}：单击{1}；{2}",
    "{0}: click to {1}; {2}",
    [
      0,
      1,
      2
    ]
  ],
  [
    "隐藏{0}高亮",
    "Hide {0} highlights",
    [
      0
    ]
  ],
  [
    "显示{0}高亮",
    "Show {0} highlights",
    [
      0
    ]
  ],
  [
    "{0} 的含义",
    "Meaning of {0}"
  ],
  [
    "填写含义",
    "Enter meaning"
  ],
  [
    "可识别 {0}",
    "{0} recognizable"
  ],
  [
    "已校验 {0}",
    "{0} verified"
  ],
  [
    "跳转到 {0}",
    "Navigate to {0}"
  ],
  [
    "{0} 条主张",
    "{0} claims"
  ],
  [
    "有争议：{0}",
    "Disputed: {0}"
  ],
  [
    "联系 {0}：{1}",
    "Relationship {0}: {1}"
  ],
  [
    "关系：{0}；",
    "Relationship: {0};"
  ],
  [
    "上游：{0}；",
    "Upstream: {0};"
  ],
  [
    "保存于 {0}",
    "Saved at {0}"
  ],
  [
    "已切换到{0}",
    "Switched to {0}",
    [
      0
    ]
  ],
  [
    "提取器 {0}",
    "Extractor {0}"
  ],
  [
    "候选区 {0}",
    "Candidate region {0}"
  ],
  [
    "阈值 {0}%",
    "Threshold {0}%"
  ],
  [
    "{0} 已删除",
    "{0} deleted"
  ],
  [
    "{0}提取失败",
    "{0} extraction failed"
  ],
  [
    "已移除 {0}",
    "Removed {0}"
  ],
  [
    "打开笔记",
    "open notes"
  ],
  [
    "已知背景",
    "Established background"
  ],
  [
    "科学问题",
    "Research question"
  ],
  [
    "方法描述",
    "Methods"
  ],
  [
    "结果陈述",
    "Results"
  ],
  [
    "结果解释",
    "Interpretation"
  ],
  [
    "未来方向",
    "Future directions"
  ],
  [
    "评论 {0}",
    "Comments {0}"
  ],
  [
    "问题：{0}",
    "Question: {0}"
  ],
  [
    "证据块{0}",
    "Evidence block {0}"
  ],
  [
    "{0} 节点",
    "{0} nodes"
  ],
  [
    "删除{0} {1}",
    "Delete {0} {1}",
    [
      0
    ]
  ],
  [
    "尚缺：{0}",
    "Still missing: {0}"
  ],
  [
    "记录{0}…",
    "Record {0}…",
    [0]
  ],
  [
    "解图 {0}",
    "Figure interpretation {0}"
  ],
  [
    "{0} 段…",
    "{0} paragraphs…"
  ],
  [
    "已选 {0}",
    "Selected {0}"
  ],
  [
    "{0}×{1}/{2}字",
    "{0}×{1}/{2} characters"
  ],
  [
    "{0} 字：{1}",
    "{0} characters: {1}"
  ],
  [
    "模式 {0}",
    "Mode: {0}",
    [
      0
    ]
  ],
  [
    "正则 {0}",
    "Regex {0}"
  ],
  [
    "手动 {0}",
    "Manual {0}"
  ],
  [
    "局限性",
    "Limitations"
  ],
  [
    "新增{0}",
    "Add {0}",
    [
      0
    ]
  ],
  [
    "打开{0}",
    "Open {0}"
  ],
  [
    "停用{0}",
    "Disable {0}",
    [
      0
    ]
  ],
  [
    "启用{0}",
    "Enable {0}",
    [
      0
    ]
  ],
  [
    "切换",
    "switch"
  ],
  [
    "段{0}",
    "Paragraph {0}"
  ]
];
return {pairs};
});
