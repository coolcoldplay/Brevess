const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const popup = fs.readFileSync(require('node:path').join(__dirname, '../popup.js'), 'utf8');
function region(name, next) {
  const start = popup.indexOf(`function ${name}(`);
  const end = popup.indexOf(`function ${next}(`, start + 1);
  assert.ok(start >= 0 && end > start, `${name} exists`);
  return popup.slice(start, end);
}
function projection() {
  return new Function(`${region('figureEvidenceSummaryParts', 'appendFigureEvidenceEditableField')}; return figureEvidenceSummaryParts;`)();
}
test('summary deduplicates exact repetition but keeps distinct conditions and all source field mappings', () => {
  const block = { groupGoal: 'D2 观察。', groupConclusion: 'D2 观察。', established: 'D4–D8 减少；D10 恢复，但不支持充分性。' };
  const before = JSON.stringify(block);
  assert.deepEqual(projection()(block), [
    { value: 'D2 观察。', fields: ['groupGoal', 'groupConclusion'] },
    { value: block.established, fields: ['established'] }
  ]);
  assert.equal(JSON.stringify(block), before);
});
test('summary respects resolved reviewed blanks rather than raw scalar fallback', () => {
  assert.deepEqual(projection()({ groupGoal: '旧模型内容', groupConclusion: '人工结论',
    fieldStates: { groupGoal: { value: '', humanReviewed: true },
      groupConclusion: { value: '人工修订', humanReviewed: true } } }), [
    { value: '人工修订', fields: ['groupConclusion'] }
  ]);
});
test('upstream reviewed empty neither derives context nor seeds the editor with fallback', () => {
  const resolve = new Function(`${region('resolveFigureEvidenceUpstreamContext', 'createFigureEvidencePanelsDetails')}; return resolveFigureEvidenceUpstreamContext;`)();
  const block = { id: 'block-a', upstreamContext: '', fieldStates: { upstreamContext: { value: '', humanReviewed: true } } };
  assert.deepEqual(resolve(block, { paperQuestion: { value: '不能自动回填' } }), {
    value: '', missing: false, source: 'reviewed-empty'
  });
  let field;
  new Function('appendFigureWorkspaceViewField', `${region('appendFigureEvidenceEditableField', 'bindFigureEvidenceEditFlush')}; appendFigureEvidenceEditableField({}, '承上', 'figure-1', ${JSON.stringify(block)}, 'upstreamContext', 'evidence-block', '旧的回退描述');`)(
    (_parent, value) => { field = value; }
  );
  assert.equal(field.editValue, '');
});
function panelSummary(view, preferences, analyzed = true) {
  const source = region('appendFigurePanelSummary', 'panelFollowupPresetOptions');
  const create = (_tag, className, text = '') => ({ className, textContent: text, dataset: {} });
  const summary = { replaceChildren(...children) { this.children = children; } };
  // No selected field is populated in these cases; the production fallback is the subject.
  new Function('createWorkspaceElement', 'formatFigurePanelHeaderDetails', 'figurePanelHeaderFieldsState',
    'truncateFigurePanelHeaderText', 'FIGURE_PANEL_HEADER_MAX_DETAILS_CODE_POINTS',
    `${source}; return appendFigurePanelSummary;`)(create, () => [], preferences,
      value => String(value), 120)(summary, view, { analyzed });
  return summary.children[1]?.textContent;
}
test('analyzed Panel A with missing chosen header fields shows its actual saved purpose', () => {
  assert.equal(panelSummary({ displayId: '1A', purpose: '给药与取样流程', fields: [] },
    { evidenceType: true }), '给药与取样流程');
});
test('Panel header no-data and user-cleared states are honest, not invented', () => {
  assert.equal(panelSummary({ displayId: '1A', fields: [] }, { evidenceType: true }), '描述待补');
  assert.equal(panelSummary({ displayId: '1A', purpose: '不该回填', fields: [
    { key: 'evidenceType', value: '', humanReviewed: true }
  ] }, { evidenceType: true }), '描述已清空');
  assert.equal(panelSummary({ displayId: '1A', purpose: '不该从旧值复活', fields: [
    { key: 'purpose', value: '', humanReviewed: true }
  ] }, { evidenceType: true }), '描述待补');
});
test('explicitly disabling all Panel header fields keeps the ID-only user preference', () => {
  assert.equal(panelSummary({ displayId: '1A', purpose: '可用目的' }, {}), undefined);
});
test('an empty inventory Panel also indicates unavailable description instead of silent ID-only output', () => {
  assert.equal(panelSummary({ displayId: '1A1', fields: [] }, { evidenceType: true }, false), '描述待补');
});
