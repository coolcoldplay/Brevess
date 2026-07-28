# 2.4.22：导航净化与缩写表准确性修复

## 导航大纲

- Springer Nature 页面中的 “Similar content being viewed by others” 及其推荐文章卡片不再被识别为正文标题。
- Cell/Elsevier 页面中的 `Info`、`Accessibility & Keyboard Shortcuts`、`Download Options`、`Transcript` 等网页功能区不再混入 Results 等正文层级。
- 功能区过滤会按标题层级抑制整个子树，并在遇到同级或更高层级的真实正文标题时恢复，避免只删除功能区标题却遗留其子卡片。
- 补充 Springer Nature 与 Cell/Elsevier 的结构选择器过滤，作为层级判定之外的第二道保护。

## 全文缩写表

- 英文缩写与全称现在必须通过首字符、字母顺序和数字一致性的严格对齐。
- 排除抗体/试剂、catalog/lot、beads、厂商等实验材料元数据。
- 排除 `CD11c+` 一类细胞标记、`Ccr2-KO` 一类基因型标签，以及 `cluster 6` 一类仅表示分组的描述。
- 不再把不完整的 `conventional DC`、`2 conventional` 等内容当作 cDC1/cDC2 的完整全称。
- 保留可验证的 `CITE-seq`、`cDC2`、`BAMs`、`TNF` 等明确“全称（缩写）”或“缩写（全称）”关系。

## 问答与 Panel 追问

- 全文问答的发送按钮改为位于本轮模型选择器上方，右侧操作区按“发送 → 模型”垂直排列。
- 修复 Panel 历史追问渲染代码落入不可达分支、导致界面只显示最新回答的问题。
- 既有多轮历史按轮次分组并默认展开，最新一轮仍在下方单独显示；历史继续随 Figure 工作区保存与恢复。

## 验证

- 新增 Nature 推荐卡片、Cell 功能面板和缩写伪配对的回归用例。
- 全量自动化测试：1035 项通过。
- 运行修订：`2.4.22-build42-outline-abbreviation-filter-r1`。
