# 2.4.26：Zotero Uminer 全文语料正则优化

## 正则准确性

- 使用本机 Zotero 的 989 份 Uminer `full.md` 建立离线全文回归基准，语料约 89 MB。
- 收紧会产生大量误报的裸词和泛化短语，例如 `overall`、`in order to`、`this work`、`follow-up`、`particularly`、`limited by`。
- 将研究目的、假设、结果、结论、局限和未来方向改为带主语、动作或句首约束的高精度表达式。
- 补齐 `OBJECTIVE`、`METHODS`、`RESULTS`、`CONCLUSIONS AND RELEVANCE`、`DESIGN`、`INTERVENTIONS`、`MAIN OUTCOMES AND MEASURES` 等结构化摘要标签。
- 保留因果、对比和结果解释等语义明确的原有规则。

## 回归基准

- 新增 `npm run benchmark:zotero-regex`，默认只读扫描 `~/Zotero/llm-for-zotero-mineru`。
- 自动排除专利型文件、References、Acknowledgements、Supplementary information 等非默认分析范围。
- 报告章节分布、每千句命中率、规则级命中、类别冲突、结构化摘要召回及反例上下文。
- 新增人工整理的正反例回归测试，防止后续重新引入常见误报。

## 版本

- 扩展版本：`2.4.26`
- 运行修订：`2.4.26-build46-zotero-regex-corpus-r1`
