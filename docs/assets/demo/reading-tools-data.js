/* Editorial examples tied to the public AlphaFold excerpts; no model requests. */
window.BV_READER_EXAMPLES = {
 title:'利用 AlphaFold 实现高精度蛋白质结构预测',
 headings:{abstract:'摘要',accuracy:'AlphaFold 的预测精度',network:'AlphaFold 网络',interpretation:'解读神经网络',msa:'MSA 深度与链间接触'},
 figures:['AlphaFold 能够生成高精度结构。','AlphaFold 对近期 PDB 结构的预测精度。','架构细节。','解读神经网络。','MSA 深度与链间接触的影响。'],
 abbreviations:[
  {abbreviation:'CASP14',fullName:'14th Critical Assessment of protein Structure Prediction',paragraphId:'accuracy',meaningZh:'第十四届蛋白质结构预测关键评估',definitionZh:'采用盲测目标比较蛋白质结构预测方法。本文以 CASP14 结果检验模型精度。'},
  {abbreviation:'MSA',fullName:'multiple sequence alignment',paragraphId:'msa',meaningZh:'多序列比对',definitionZh:'将同源序列按位置对齐，用序列变化模式提供结构约束线索。本文指出浅 MSA 下精度会下降。'},
  {abbreviation:'PDB',fullName:'Protein Data Bank',paragraphId:'interpretation',meaningZh:'蛋白质结构数据库',definitionZh:'保存实验解析的大分子三维结构；本文使用 PDB 结构构建独立测试集。'},
  {abbreviation:'GDT',fullName:'global distance test',paragraphId:'interpretation',meaningZh:'全局距离检验',definitionZh:'衡量预测结构与参考结构的整体相似程度。图 4a 对结构域使用 GDT 评分。'},
  {abbreviation:'lDDT-Cα',fullName:'local Distance Difference Test (Cα atoms)',paragraphId:'interpretation',meaningZh:'基于 Cα 原子的局部距离差异检验',definitionZh:'比较局部原子间距离的保持情况。图 4a 对蛋白质链使用此评分；不能将它与 GDT 直接视为同一量。'}
 ],
 semanticQueries:[
  {query:'比对序列不足时，预测还可靠吗？',aliases:/比对|序列不足|msa|序列深度|同源|alignment|shallow|homolog/i,score:s=>s.paragraphId==='msa'?(s.text.startsWith('The model')? .98 : .84):s.paragraphId==='network'? .76 : .12},
  {query:'模型通过哪些测试证明预测精度？',aliases:/测试|验证|精度|评估|盲测|准确|验证集|accuracy|assess|validat|benchmark|test/i,score:s=>s.paragraphId==='accuracy'?(s.text.startsWith('We validated')? .96 : .78):s.paragraphId==='interpretation'? .86 : .12},
  {query:'如何把生物学知识融入网络？',aliases:/生物|物理|知识|网络|算法|方法|架构|network|biolog|physical|architect|method/i,score:s=>s.paragraphId==='network'? .97 : s.paragraphId==='abstract'? .74 : .1}
 ]
};
