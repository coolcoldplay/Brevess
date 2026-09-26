# 2.4.16：PPT 制作材料与 Zotero 增强快照

## 导出 PPT 制作材料

- 侧栏顶部“导出本文档案”旁新增“导出 PPT 制作材料”按钮。
- 按 Figure 扫描出版社页面提供的 `data-original`、`data-full`、`data-hires`、
  最大 `srcset` 和全尺寸链接；读取所有成功候选的真实像素尺寸，选择像素面积最大的
  原图，并在 manifest 中记录宽高、候选数和选择策略。
- ZIP 同时保存完整 Figure/Panel 解读、Panel 单独解读与追问历史、相关正文证据、
  主图多米诺跨图逻辑、全文问答、手动标注及文章上下文。
- 包内 `PROMPT_FOR_CODEX_OR_AGENT.md` 要求本地 Agent 先核验真实 Panel 边界，
  输出可回溯的裁切清单，再根据 Figure 论证逻辑安排 16:9 学术汇报页和跨图承接页。
- Prompt 会先区分 Agent 是否具备真实图像理解能力：视觉 Agent 直接完成并逐图验收真实
  Panel；无视觉能力时改用标注 `Fig. 2A` 等编号的 Panel 占位框，禁止猜测裁图或伪造数据，
  方便用户或另一名视觉 Agent 后续截图替换。
- Prompt 新增精确裁图验收、按正文主 Figure 而非拆页数量编号、自然 Journal Club 讲稿、
  逐 Figure 批判性评价，以及语音 `With Previous` 立即播放和按实际媒体时长自动切页规则。
- 导出清单会标记无法取得原图的 Figure，禁止 Agent 凭空重建实验图片。

## Zotero 增强网页快照

- 侧栏顶部新增“导出增强网页快照到 Zotero”按钮。
- 快照移除脚本和扩展临时 UI，保留自动下划线、LLM 下划线、手动高亮、备注标记，
  并附加完整手动标注目录。
- 解图、Panel 追问、跨图逻辑、全文问答和手动注释组合为 Zotero 子笔记。
- 优先使用 Zotero 桌面端公开的 Connector HTTP 服务，在用户当前文库或集合中创建
  网页条目、增强快照附件和子笔记。
- Zotero 未运行、目标文库不允许文件附件、快照过大或直连失败时，自动下载包含
  `snapshot.html`、笔记和元数据的离线导入 ZIP，不丢失已经生成的内容。
- Zotero 快照改为独立的 UTF-8 单栏阅读文档，不再复制出版社导航、侧栏、广告和推荐内容。
- 导出时复用高清原图解析与质量比较链路，将最佳 Figure 原图作为 `data:` 资源直接嵌入
  `snapshot.html`；正文根节点之外的 Extended Data Figure 自动汇入离线高清图集。
- 解图、Panel 追问、主图串解、全文问答和手动批注改为分层语义笔记，并同时附在快照末尾，
  不再向 Zotero 笔记输出原始 JSON。

## 安全与可复核性

- 原图抓取仅允许 HTTP(S) 图片响应，限制单图大小和超时时间。
- 导出 JSON 自动移除 API Key、Authorization、Token、密码和嵌入式 Data URL。
- 图片来源清单删除查询参数、用户名、密码和临时 Blob 地址，避免泄露签名 URL。
- Zotero 直连地址仅允许 `127.0.0.1` 或 `localhost` 的标准本地 Connector 服务。
