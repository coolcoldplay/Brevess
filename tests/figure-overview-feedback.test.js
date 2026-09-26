const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const popup = fs.readFileSync(path.join(__dirname, '../popup.js'), 'utf8');
function load(name) {
  const start = popup.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} must exist in production popup`);
  const end = popup.indexOf('\nfunction ', start + 1);
  return new Function(`${popup.slice(start, end)}\nreturn ${name};`)();
}

test('UI-005 semicolon-separated boundaries display as points without changing the editable scalar', () => {
  const project = load('projectFigureOverviewField');
  const value = '仅检验 RTX 模型，未验证其他应激；aCAS3 与 H&E 未直接证明死亡通路；未标注的比较不能推断显著。';
  const field = Object.freeze({ key: 'claimBoundary', value, humanReviewed: true });
  const result = project(field);
  assert.deepEqual(result.value, ['仅检验 RTX 模型，未验证其他应激；', 'aCAS3 与 H&E 未直接证明死亡通路；', '未标注的比较不能推断显著。']);
  assert.equal(result.editValue, value);
  assert.equal(field.value, value);
  assert.equal(result.humanReviewed, true);
});

test('UI-005 ordinary commas, conditional semicolons, and scientific parentheses remain intact', () => {
  const project = load('projectFigureOverviewField');
  for (const value of ['未证明因果，只提示相关，仍需检验。', '如果对照缺失；则不能推断必要性。',
    'The condition is incomplete; therefore no causality is inferred.',
    '使用模型（剂量 1；时长 2）；未直接证明因果。']) {
    const result = project({ key: 'coreConclusion', value });
    assert.equal(result.value, value);
    assert.equal(result.editValue, value);
  }
  const result = project({ key: 'claimBoundary', value: '使用模型（剂量 1；时长 2）；未直接证明因果。' });
  assert.deepEqual(result.value, ['使用模型（剂量 1；时长 2）；', '未直接证明因果。']);
  assert.equal(project({ key: 'claimBoundary', value: '如果对照缺失；则不能推断必要性。' }).value,
    '如果对照缺失；则不能推断必要性。');
});

test('UI-005 explicit arrays, empty reviewed values and explicit editor values are preserved', () => {
  const project = load('projectFigureOverviewField');
  const values = Object.freeze(['Panel A 仅支持相关', 'Panel B 尚不支持因果']);
  assert.deepEqual(project({ key: 'claimBoundary', value: values }).value, values);
  assert.deepEqual(project({ key: 'claimBoundary', value: values }).editValue, values);
  assert.equal(project({ key: 'claimBoundary', value: '', humanReviewed: true }).value, '');
  assert.equal(project({ key: 'claimBoundary', value: [], humanReviewed: true }).editValue.length, 0);
  assert.equal(project({ key: 'claimBoundary', value: '一；二', editValue: '' }).editValue, '');
});

test('UI-005 explicit list markers and ordered assembly steps remain in original order', () => {
  const project = load('projectFigureOverviewField');
  const explicit = '1. 未证明必要性\n2. 未证明充分性';
  assert.deepEqual(project({ key: 'remainingQuestion', value: explicit }).value,
    ['1. 未证明必要性', '2. 未证明充分性']);
  const sequence = '作者先以示意图(A)引入模型，再用(B)确立表型，接着用(C)描绘时间进程，最后用(D)定位细胞。';
  const result = project({ key: 'authorAssembly', value: sequence });
  assert.deepEqual(result.value, ['作者先以示意图(A)引入模型，', '再用(B)确立表型，', '接着用(C)描绘时间进程，', '最后用(D)定位细胞。']);
  assert.equal(result.editValue, sequence);
});

test('UI-005 overview expansion keys separate documents, generations, and Figures but not ordinary redraws', () => {
  const key = load('figureOverviewExpansionKey');
  const snapshot = { url: 'https://example.org/a', documentHash: 'body-a',
    localWorkspace: { workspaceId: 'workspace:a', workspaceGeneration: 1, contentHash: 'body-a' } };
  const original = key(snapshot, 'figure-1');
  assert.equal(original, key({ ...snapshot, revision: 9 }, 'figure-1'));
  assert.notEqual(original, key(snapshot, 'figure-2'));
  assert.notEqual(original, key({ url: 'https://example.org/b', documentHash: 'body-b' }, 'figure-1'));
  assert.notEqual(original, key({ ...snapshot, localWorkspace: { ...snapshot.localWorkspace, workspaceGeneration: 2 } }, 'figure-1'));
  assert.equal(key({}, 'figure-1'), '');
});
