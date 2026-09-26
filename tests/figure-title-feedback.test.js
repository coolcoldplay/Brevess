const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ws = require('../core/figure-workspace.js');
const extractor = require('../core/figure-extractor.js');
const popup = fs.readFileSync(require('node:path').join(__dirname, '../popup.js'), 'utf8');

function loadPresentation() {
  const start = popup.indexOf('function figureSummaryPresentation(');
  assert.ok(start >= 0, 'production Figure title presentation must exist');
  const end = popup.indexOf('\nfunction ', start + 1);
  return new Function('SciLLM', `${popup.slice(start, end)}\nreturn figureSummaryPresentation;`)(extractor);
}
const sourceFigure = number => ({ figureId: `figure-s${number}`, figureLabel: `Figure S${number}`,
  isSupplemental: true, panelHints: ['A'],
  caption: `Figure S${number} English source title related to Figure ${number}Show full captionFigure viewer` });
const resolved = (figure, result, draft = null) => ws.createFigureWorkspaceView({ figure, modelResult: result, draft });

test('FIG-004 S3–S7 prefer resolved Chinese conclusions over English caption and translated source title', () => {
  const present = loadPresentation();
  for (const number of [3, 4, 5, 6, 7]) {
    const figure = sourceFigure(number);
    const result = { coreConclusion: `第${number}图仅支持所示实验条件下的中文结论。`, figureTitleZh: '原题直接译文' };
    const output = present(result, figure, resolved(figure, result));
    assert.equal(output.text, result.coreConclusion);
    assert.equal(output.source, 'coreConclusion');
    assert.equal(output.state, 'available');
    assert.doesNotMatch(output.text, /Show|viewer|English|原题直接译文/);
  }
});

test('FIG-004 reviewed text and explicit blank override stale raw result across modes and JSON roundtrip', () => {
  const present = loadPresentation();
  const figure = sourceFigure(3);
  const result = { coreConclusion: '模型旧结论', authorAssembly: '模型旧组图说明' };
  let draft = ws.createFigureWorkspaceDraft([figure]);
  for (const value of ['人工标题：不能由此推断必要性。', '']) {
    draft = ws.applyFigureWorkspaceMutation(draft, { type: 'set_figure_field', figureId: figure.figureId,
      field: 'coreConclusion', value, expectedRevision: draft.revision });
    const roundTrip = JSON.parse(JSON.stringify(draft));
    for (const model of [result, { ...result, coreConclusion: '深度模式新结论' }]) {
      const output = present(model, figure, resolved(figure, model, roundTrip));
      assert.equal(output.state, value ? 'available' : 'cleared');
      assert.equal(output.fullText, value.normalize('NFKC'));
      assert.equal(output.text, value ? value.normalize('NFKC') : '简要已清空');
    }
  }
});

test('FIG-004 method schematics use available question/assembly without inventing an outcome', () => {
  const present = loadPresentation();
  const figure = { ...sourceFigure(1), figureId: 'figure-1', figureLabel: 'Figure 1', isSupplemental: false };
  const result = { figureQuestion: 'RTX给药和取样如何安排？', coreConclusion: '' };
  const output = present(result, figure, resolved(figure, result));
  assert.equal(output.text, result.figureQuestion.normalize('NFKC'));
  assert.equal(output.source, 'figureQuestion');
  assert.doesNotMatch(output.text, /证明|导致|促进/);
});

test('FIG-004 missing or English-only legacy content reports unavailable Chinese summary, not completed quality', () => {
  const present = loadPresentation();
  const figure = sourceFigure(7);
  for (const result of [{}, { coreConclusion: 'A long English result' }, { figureTitleZh: '原题译文' }]) {
    const output = present(result, figure, resolved(figure, result));
    assert.equal(output.state, 'missing');
    assert.equal(output.text, '中文简要待补');
    assert.equal(output.fullText, '');
  }
});

test('FIG-019 display preserves the full conclusion including its final scientific boundary', () => {
  const present = loadPresentation();
  const figure = sourceFigure(5);
  const fullText = '中文证据🙂'.repeat(25) + '，但不支持充分性。';
  const result = Object.freeze({ coreConclusion: fullText });
  const output = present(result, figure, resolved(figure, result));
  assert.equal(output.text, fullText.normalize('NFKC'));
  assert.ok(output.text.endsWith('但不支持充分性。'));
  assert.equal(output.fullText, fullText.normalize('NFKC'));
  assert.equal(result.coreConclusion, fullText);
});

test('FIG-004 result status distinguishes missing/cleared summary from model completion', () => {
  const start = popup.indexOf('function figureWorkspaceResultStatus(');
  const end = popup.indexOf('\nfunction ', start + 1);
  const status = new Function('figurePanelCompletionPresentation', `${popup.slice(start, end)}\nreturn figureWorkspaceResultStatus;`)(() => ({}));
  assert.equal(status({ result: {}, summaryPresentation: { state: 'missing' } }), '已解读 · 中文简要待补');
  assert.equal(status({ result: {}, summaryPresentation: { state: 'cleared' } }), '已解读 · 简要已清空');
  assert.equal(status({ result: {}, partialResult: true, summaryPresentation: { state: 'missing' } }), '部分结果已保留');
  assert.equal(status({ result: {}, progress: { failed: true }, summaryPresentation: { state: 'missing' } }), '重试失败，原结果已保留');
});

test('FIG-004 source caption display removes glued controls without deleting evidence or editing input', () => {
  const start = popup.indexOf('function figureSourceCaption(');
  assert.ok(start >= 0, 'source caption display projection must exist');
  const end = popup.indexOf('\nfunction ', start + 1);
  const clean = new Function(`${popup.slice(start, end)}\nreturn figureSourceCaption;`)();
  const figure = Object.freeze({ caption: 'Figure S3 Real source title related to Figure 3Show full captionFigure viewer (A) Negative result; not causal. (B) D2–D10.' });
  assert.equal(clean(figure), 'Figure S3 Real source title related to Figure 3 (A) Negative result; not causal. (B) D2–D10.');
  assert.match(figure.caption, /captionFigure viewer/);
});

test('FIG-004 an existing resolved view never falls back to conflicting raw values', () => {
  const present = loadPresentation();
  const figure = sourceFigure(4);
  const result = { coreConclusion: '不应从原始模型复活的结论' };
  assert.equal(present(result, figure, { overview: [{ key: 'coreConclusion', value: '', humanReviewed: true }] }).state, 'cleared');
  assert.equal(present(result, figure, { overview: [] }).state, 'missing');
  assert.equal(present(result, figure).fullText, result.coreConclusion);
});
