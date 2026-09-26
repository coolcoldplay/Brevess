import test from 'node:test';
import assert from 'node:assert/strict';
import { QUESTIONS, selectColdRestoreResumeExpectation, hasConfirmedDirectorySave } from '../scripts/verify-qa012-live-neuron.mjs';

const clone = value => structuredClone(value);
function fixture() {
  const before = { documentId: 'document', documentHash: 'hash', turns: QUESTIONS.map((question, i) => ({
    turnId: `turn-${i}`, question, status: 'completed', answerBlocks: [{ blockId: 'b', markdown: 'captured source answer', evidence: [] }] })) };
  const failed = { documentId: 'document', documentHash: 'hash', turns: [], coverage: null };
  const saved = { exactChatPersisted: true, saveUi: '已保存 12 个工作区文件和 4 轮问答到本地文件夹，含完整离线正文和 0 张嵌入图',
    flushed: { failed: 0, pendingCount: 0, permission: 'granted' }, status: { pendingCount: 0, permission: 'granted' } };
  const report = { phase: { name: 'waiting-cold-restoration' }, saveDirectory: clone(saved),
    turns: before.turns.map(t => ({ turnId: t.turnId, status: t.status })) };
  return { before, failed, saved, report };
}

test('cold failure uses only the separately durable before-cold four-turn expectation without changing empty failure state', () => {
  const f = fixture(), original = clone(f);
  const state = selectColdRestoreResumeExpectation(f.report, f.failed, f.before, f.saved);
  assert.deepEqual(state, f.before); assert.deepEqual(f, original); assert.equal(f.failed.turns.length, 0);
});

test('directory save confirmation rejects the actual browser-only fallback despite containing 已保存', () => {
  assert.equal(hasConfirmedDirectorySave(fixture().saved.saveUi), true);
  for (const value of ['本次结果已保存在浏览器；文件夹同步尚未完成。Unable to complete the request',
    '恢复基线无效，请重新扫描。', '已保存 12 个工作区文件和 3 轮问答到本地文件夹',
    '已保存 0 个工作区文件和 4 轮问答到本地文件夹', '', 'saved']) assert.equal(hasConfirmedDirectorySave(value), false);
  const f = fixture();
  f.saved.saveUi = '本次结果已保存在浏览器；文件夹同步尚未完成。Unable to complete the request';
  f.report.saveDirectory = clone(f.saved);
  assert.throws(() => selectColdRestoreResumeExpectation(f.report, f.failed, f.before, f.saved), { code: 'QA012_RESUME_INVALID' });
});

test('cold expectation rejects mismatched identity, unsuccessful save, other phases, partial turns and altered capture', () => {
  for (const mutate of [
    f => { f.failed.documentHash = 'other'; }, f => { f.failed.documentId = 'other'; },
    f => { f.before.documentHash = ''; }, f => { f.report.phase.name = 'saving'; },
    f => { f.saved.exactChatPersisted = false; }, f => { f.saved.flushed.failed = 1; },
    f => { f.saved.status.pendingCount = 1; }, f => { f.saved.status.permission = 'denied'; },
    f => { f.saved.saveUi = '保存失败'; }, f => { f.before.turns.pop(); },
    f => { f.before.turns[0].status = 'error'; }, f => { f.before.turns[1].question = QUESTIONS[0]; },
    f => { f.report.turns[0].turnId = 'other'; }, f => { f.failed.turns = [clone(f.before.turns[0])]; },
    f => { f.saved.extra = 'different observation'; }
  ]) {
    const f = fixture(); mutate(f);
    assert.throws(() => selectColdRestoreResumeExpectation(f.report, f.failed, f.before, f.saved), { code: 'QA012_RESUME_INVALID' });
  }
});
