(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BrevessSharingProjection = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const labelText=value=>globalThis.SciLLM?.translateInterfaceText?.(value)||value;
  const separator=()=>globalThis.SciLLM?.getInterfaceLanguage?.()==='en'?': ':'：';
  const text = value => typeof value === 'string' ? value : '';
  const fields = (row, specs) => specs.flatMap(([key, label]) => typeof row[key] === 'string' && row[key] !== '' ? [`${labelText(label)}${separator()}${row[key]}`] : []).join('\n');
  const evidence = binding => [fields(binding, [['judgement','人工证据判断']]), Array.isArray(binding.types) && binding.types.length ? labelText('证据分类：') + binding.types.map(type=>labelText({sufficient:'充分',necessary:'必要',correlation:'相关'}[type]||'')).filter(Boolean).join(globalThis.SciLLM?.getInterfaceLanguage?.()==='en'?' / ':'、') : '', binding.contrary ? labelText('相反结果：是') : ''].filter(Boolean).join('\n');
  const localKey = (projectId, kind, id) => JSON.stringify(['workbench', projectId, kind, id]);
  function hypothesis(projectId, row) {
    return { kind: 'hypothesis', localKey: localKey(projectId, 'hypothesis', row.id), title: text(row.name), text: fields(row, [['description', '说明'], ['question', '问题']]), source: {}, body: {
      nodes: (row.nodes || []).map(node => ({ id: node.id, label: text(node.label), text: fields(node, [['condition', '条件'], ['text', '内容']]), ...(Number.isFinite(node.x) ? { x: node.x } : {}), ...(Number.isFinite(node.y) ? { y: node.y } : {}) })),
      edges: (row.edges || []).map(edge => ({ id: edge.id, source: edge.source, target: edge.target, kind: ['main','branch','feedback'].includes(edge.kind) ? edge.kind : 'main', label: text(edge.claim), text: [fields(edge, [['condition','条件'], ['status','状态']]), ...(edge.bindings || []).map(evidence)].filter(Boolean).join('\n') }))
    }, links: [] };
  }
  function figurePlan(projectId, row) {
    const panels = [], evidenceBlocks = [], summary = [fields(row, [['description','说明'], ['question','问题']])];
    for (const figure of row.figures || []) {
      summary.push(fields(figure, [['title','Figure'], ['question','论证目标'], ['transition','与下一张图的逻辑']]));
      for (const panel of figure.panels || []) {
        let manual = fields(panel, [['text','文本'], ['purpose','问题'], ['experiment','实验与比较组'], ['claim','计划论断'], ['readout','关键读出'], ['expectedResult','预期结果'], ['result','已有结果'], ['gap','待确定条件'], ['status','实验状态']]);
        for(const reference of panel.references||[])if(reference&&typeof reference==='object'){
          const authored=fields(reference,[['note','人工参考说明'],['borrow','参考用途']]);
          if(authored)manual+='\n'+authored;
        }
        if (panel.groupTable) {
          // Explicitly flatten only human table labels/cells; no arbitrary nested metadata.
          const table = panel.groupTable, lines = [];
          for (const column of table.columns || []) if (typeof column.name === 'string') lines.push(column.name);
          for (const entry of table.rows || []) {
            if (typeof entry.name === 'string') lines.push(entry.name);
            for (const column of table.columns || []) { const cell = table.cells?.[entry.id]?.[column.id]; if (typeof cell === 'string' || typeof cell === 'number') lines.push(String(cell)); }
          }
          if (lines.length) manual += '\n'+labelText('实验分组表：')+'\n' + lines.join(' | ');
        }
        panels.push({ id: panel.id, figureId: figure.id, label: text(panel.title), text: manual, ...Object.fromEntries(['x','y','w','h'].filter(key => Number.isFinite(panel[key])).map(key => [key, panel[key]])) });
      }
      for (const block of figure.evidenceBlocks || []) evidenceBlocks.push({ id: block.id, title: text(block.title), summary: text(block.summary), panelIds: (block.panelIds || []).filter(id => panels.some(panel => panel.id === id)) });
    }
    return { kind: 'figure_plan', localKey: localKey(projectId, 'figure_plan', row.id), title: text(row.name), text: summary.filter(Boolean).join('\n\n'), source: {}, body: { panels, evidenceBlocks }, links: [] };
  }
  return Object.freeze({ localKey, hypothesis, figurePlan });
});
