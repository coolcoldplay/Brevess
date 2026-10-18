'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { functionSource } = require('./helpers/r28-full07-source.js');

const root = path.join(__dirname, '..');
const content = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
const batchSource = () => {
  const start = content.indexOf('async function analyzeFiguresWithLLM(options = {})');
  const end = content.indexOf('\nfunction setReviewOutlineDepth', start);
  assert.ok(start >= 0 && end > start);
  return content.slice(start, end);
};

test('Figure batch parallelism is bounded and keeps resume or explicit-window runs serial', () => {
  const batch = batchSource();
  assert.match(content, /const FIGURE_BATCH_WORKER_LIMIT = 2;/u);
  assert.match(batch, /options\.figureUserResumeIntent \|\|\s*options\.figureExecutionWindow !== undefined \? 1 :/u);
  assert.match(batch, /Math\.min\(FIGURE_BATCH_WORKER_LIMIT, figures\.length\)/u);
  assert.match(batch, /Promise\.all\(Array\.from\(\{ length: figureBatchWorkerCount \},[\s\S]*runFigureWorker\(workerIndex\)/u);
  assert.match(batch, /withFigureCommit/u);
});

test('parallel Figure requests receive independent operation identities while commits stay serialized', () => {
  const batch = batchSource();
  assert.match(batch, /operation\.requestOperationByFigure\.set\(figure\.figureId, requestOperationId\)/u);
  assert.match(batch, /operation\.requestOperationIds\.add\(requestOperationId\)/u);
  assert.match(batch, /operationId: requestOperationId/u);
  assert.match(batch, /currentFigureProviderAttemptsConsumed\(\s*requestOperationId\s*\)/u);
  const sendAt = batch.indexOf('const response = await sendFigureAnalysisRequestWithReceipt');
  assert.ok(sendAt > 0);
  assert.match(batch.slice(sendAt), /await withFigureCommit\(async \(\) =>/u);
  assert.match(content, /figureOperationState\.active\?\.requestOperationIds\?\.has\(patch\.operationId\)/u);
  assert.match(content, /const operationOwned = \(\) => isCurrentFigureOperation\(operationId\) \|\|[\s\S]{0,180}requestOperationIds\?\.has\(operationId\)/u);
  assert.match(content, /figureAnalysisStatus\.running === false[\s\S]{0,180}\['completed', 'partial', 'failed', 'cancelled'\]\.includes\(figureAnalysisStatus\.phase\)/u);
});

test('finishFigureOperation releases every independent request operation before clearing ownership', async () => {
  const outer = 'figure-11111111-1111-4111-8111-111111111111';
  const first = 'figure-22222222-2222-4222-8222-222222222222';
  const second = 'figure-33333333-3333-4333-8333-333333333333';
  const operation = {
    operationId: outer,
    generation: 7,
    workspaceLifecycle: 3,
    waiters: [],
    requestOperationIds: new Set([first, second])
  };
  const figureOperationState = { active: operation, generation: 7 };
  const finish = new Function(
    'figureOperationState',
    'isCurrentFigureOperation',
    `${functionSource(content, 'finishFigureOperation')}\nreturn finishFigureOperation;`
  )(
    figureOperationState,
    candidate => figureOperationState.active === candidate
  );
  const released = [];
  const result = await finish(operation, {
    maxAttempts: 1,
    sendMessage: async message => {
      released.push(message.operationId);
      return { success: true, data: {
        operationId: message.operationId,
        released: true,
        cancelled: message.command === 'cancel',
        cleanupComplete: true,
        requestedCommand: message.command
      } };
    }
  });
  assert.deepEqual(released, [outer, first, second]);
  assert.equal(result.released, true);
  assert.equal(figureOperationState.active, null);
  assert.equal(operation.cleanupPending, false);
});
