const test = require('node:test');
const assert = require('node:assert/strict');

test('exports the mechanism operation coordinator contract to CommonJS and SciLLM', () => {
  const modulePath = require.resolve('../core/mechanism-operation-coordinator.js');
  const previous = globalThis.SciLLM;
  try {
    globalThis.SciLLM = {};
    delete require.cache[modulePath];
    const api = require(modulePath);
    assert.equal(api.MECHANISM_OPERATION_COORDINATOR_VERSION, '1');
    assert.equal(
      globalThis.SciLLM.MECHANISM_OPERATION_COORDINATOR_VERSION,
      api.MECHANISM_OPERATION_COORDINATOR_VERSION
    );
    assert.strictEqual(
      api.MECHANISM_BINDING_VERSIONS,
      globalThis.SciLLM.EVIDENCE_FIRST_VERSIONS
    );
    assert.strictEqual(api.EVIDENCE_FIRST_POLICY, globalThis.SciLLM.EVIDENCE_FIRST_POLICY);
  } finally {
    delete require.cache[modulePath];
    if (previous === undefined) delete globalThis.SciLLM;
    else globalThis.SciLLM = previous;
  }
});

function loadCoordinator() {
  Object.assign(globalThis.SciLLM || (globalThis.SciLLM = {}),
    require('../core/operation-control.js'),
    require('../core/analysis-cache.js'),
    require('../core/evidence-first-mechanism.js'));
  delete require.cache[require.resolve('../core/mechanism-operation-coordinator.js')];
  return require('../core/mechanism-operation-coordinator.js');
}

test('durable binding rejects version drift for one operation id and accepts a new id', async () => {
  const api = loadCoordinator();
  const cacheStore = globalThis.SciLLM.createMemoryAnalysisCache();
  const firstCoordinator = api.createMechanismOperationCoordinator({ cacheStore });
  const versions = { ...api.MECHANISM_BINDING_VERSIONS };
  const first = await firstCoordinator.beginEvidenceFirstOperation(identity({ versions }));
  await firstCoordinator.commitCheckpoint(first, checkpoint(api, first));
  const restarted = api.createMechanismOperationCoordinator({ cacheStore });
  const same = await restarted.beginEvidenceFirstOperation(identity({ versions }));
  assert.equal(same.epoch, first.epoch);
  assert.ok(await restarted.resume(same));

  for (const key of Object.keys(versions)) {
    const bumpedVersions = { ...versions, [key]: `${versions[key]}-bumped` };
    const bumpedCoordinator = api.createMechanismOperationCoordinator({ cacheStore });
    await assert.rejects(
      bumpedCoordinator.beginEvidenceFirstOperation(identity({ versions: bumpedVersions })),
      error => error.code === 'MECHANISM_OPERATION_STALE'
    );
    const bumped = await bumpedCoordinator.beginEvidenceFirstOperation(identity({
      operationId: `mechanism:paper-1-version-${key}`,
      versions: bumpedVersions
    }));
    assert.equal(bumped.epoch, 1, `${key} requires a new operation id`);
    assert.equal(bumped.binding[key], bumpedVersions[key]);
    assert.equal(await bumpedCoordinator.resume(bumped), null);
    assert.doesNotMatch(JSON.stringify(bumped.binding), /placeholder/iu);
  }
});

test('ready checkpoint is the sealed final authority for claims and later checkpoints', async () => {
  const api = loadCoordinator();
  const coordinator = api.createMechanismOperationCoordinator();
  const operation = await coordinator.beginEvidenceFirstOperation(identity({
    operationId: 'mechanism:sealed-ready-authority'
  }));
  const ready = checkpoint(api, operation, {
    phase: 'ready', nextBatchIndex: 0,
    payload: { finalStatus: 'complete', finalDigest: 'digest-1' }
  });
  const first = await coordinator.commitCheckpoint(operation, ready);
  const replay = await coordinator.commitCheckpoint(operation, ready);
  assert.equal(replay.checkpointCommits, first.checkpointCommits);
  await assert.rejects(
    coordinator.claimProviderRequest(operation),
    error => error?.code === 'MECHANISM_OPERATION_FINALIZED'
  );
  await assert.rejects(
    coordinator.commitCheckpoint(operation, { ...ready, nextBatchIndex: 1 }),
    error => error?.code === 'MECHANISM_CHECKPOINT_INVALID'
  );
  await assert.rejects(
    coordinator.commitCheckpoint(operation, {
      ...ready, payload: { finalStatus: 'needs_review', finalDigest: 'digest-1' }
    }),
    error => error?.code === 'MECHANISM_CHECKPOINT_INVALID'
  );
  assert.deepEqual(await coordinator.status(operation.operationId), {
    operationId: operation.operationId, epoch: operation.epoch,
    status: 'needs_review', active: false, paused: false, cancelled: false
  });
  const finalized = await coordinator.finalize(operation, 'complete');
  assert.equal(finalized.status, 'complete');
  assert.deepEqual(await coordinator.status(operation.operationId), finalized);
});

test('ready and failed terminal status is durable inactive and never inferred by assertActive', async () => {
  const api = loadCoordinator();
  const cacheStore = globalThis.SciLLM.createMemoryAnalysisCache();
  const input = identity({ operationId: 'mechanism:durable-ready-status' });
  const coordinator = api.createMechanismOperationCoordinator({ cacheStore });
  const operation = await coordinator.beginEvidenceFirstOperation(input);
  await coordinator.commitCheckpoint(operation, checkpoint(api, operation, {
    phase: 'ready', nextBatchIndex: 0,
    payload: { finalStatus: 'needs_review', finalDigest: 'digest-ready' }
  }));
  const finalized = await coordinator.finalize(operation, 'needs_review');
  assert.deepEqual(finalized, {
    operationId: input.operationId, epoch: operation.epoch,
    status: 'needs_review', active: false, paused: false, cancelled: false
  });
  assert.deepEqual(await coordinator.status(input.operationId), finalized);
  const restarted = api.createMechanismOperationCoordinator({ cacheStore });
  assert.deepEqual(await restarted.status(input.operationId), finalized);
  const restored = await restarted.beginEvidenceFirstOperation(input);
  assert.equal(restored.epoch, operation.epoch);
  assert.deepEqual(await restarted.resume(restored), await coordinator.resume(operation));
  assert.throws(
    () => restarted.assertActive(restored),
    error => error?.code === 'MECHANISM_OPERATION_FINALIZED'
  );
  assert.throws(
    () => coordinator.control(operation, 'cancel'),
    error => error?.code === 'MECHANISM_OPERATION_FINALIZED'
  );

  const failedInput = identity({ operationId: 'mechanism:durable-failed-status' });
  const failedOperation = await coordinator.beginEvidenceFirstOperation(failedInput);
  const failed = await coordinator.finalize(failedOperation, 'failed');
  assert.deepEqual(failed, {
    operationId: failedInput.operationId, epoch: failedOperation.epoch,
    status: 'failed', active: false, paused: false, cancelled: false
  });
  assert.deepEqual(await restarted.status(failedInput.operationId), failed);
  await assert.rejects(
    restarted.beginEvidenceFirstOperation(failedInput),
    error => error?.code === 'MECHANISM_OPERATION_FINALIZED'
  );
  assert.deepEqual(await restarted.status(failedInput.operationId), failed);
});

test('exact-owner release after workspace commit atomically compacts a completed run', async () => {
  const api = loadCoordinator();
  const cacheStore = globalThis.SciLLM.createMemoryAnalysisCache();
  const coordinator = api.createMechanismOperationCoordinator({ cacheStore });
  const input = identity({ operationId: 'mechanism:workspace-acked-release' });
  const operation = await coordinator.beginEvidenceFirstOperation(input);
  await coordinator.commitCheckpoint(operation, checkpoint(api, operation, {
    phase: 'ready', nextBatchIndex: 0,
    payload: { finalStatus: 'complete', graph: { nodes: [], edges: [] } }
  }));
  await coordinator.finalize(operation, 'complete');
  const owner = {
    operationId: input.operationId,
    documentId: input.documentId,
    workspaceId: input.workspaceId,
    workspaceGeneration: input.workspaceGeneration,
    workspaceLifecycle: input.workspaceLifecycle,
    mechanismChainFingerprint: input.mechanismChainFingerprint,
    senderExtensionId: input.senderExtensionId,
    senderTabId: input.senderTabId,
    senderFrameId: input.senderFrameId,
    senderDocumentId: input.senderDocumentId
  };
  const released = await coordinator.controlOwned(owner, 'release');
  assert.equal(released.status, 'released');
  assert.equal(released.released, true);
  assert.equal(released.compacted, true);
  const [statesAfterRelease, checkpointsAfterRelease, indexesAfterRelease] =
    await Promise.all([
      cacheStore.listProtectedByPrefix('mechanism-run-state:'),
      cacheStore.listProtectedByPrefix('mechanism-checkpoint:'),
      cacheStore.listProtectedByPrefix('mechanism-run-index:')
    ]);
  assert.equal(statesAfterRelease.size, 0);
  assert.equal(checkpointsAfterRelease.size, 0);
  const indexRecord = [...indexesAfterRelease.values()].find(value => value.runIndex);
  const revisionAfterRelease = indexRecord.revision;
  const replay = await coordinator.controlOwned(owner, 'release');
  assert.equal(replay.released, true);
  assert.equal(replay.compacted, true);
  const protectedAfterReplay = await cacheStore.listProtectedByPrefix('mechanism-run-index:');
  const replayedIndex = [...protectedAfterReplay.values()].find(value => value.runIndex);
  assert.equal(replayedIndex.revision, revisionAfterRelease,
    'lost release acknowledgements replay without growing terminal authority');
  const restarted = api.createMechanismOperationCoordinator({ cacheStore });
  await assert.rejects(
    restarted.beginEvidenceFirstOperation(input),
    error => error.code === 'MECHANISM_OPERATION_FINALIZED'
  );
});

function ownerIdentity(input) {
  return {
    operationId: input.operationId,
    documentId: input.documentId,
    workspaceId: input.workspaceId,
    workspaceGeneration: input.workspaceGeneration,
    workspaceLifecycle: input.workspaceLifecycle,
    mechanismChainFingerprint: input.mechanismChainFingerprint,
    senderExtensionId: input.senderExtensionId,
    senderTabId: input.senderTabId,
    senderFrameId: input.senderFrameId,
    senderDocumentId: input.senderDocumentId
  };
}

function coordinatorStableHash(value) {
  const text = JSON.stringify(value);
  return [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35].map(seed => {
    let hash = seed >>> 0;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
  }).join('');
}

test('exact-owner abandon atomically fails and compacts an active run with a strict ACK', async () => {
  const api = loadCoordinator();
  const cacheStore = globalThis.SciLLM.createMemoryAnalysisCache();
  const coordinator = api.createMechanismOperationCoordinator({ cacheStore });
  const input = identity({ operationId: 'mechanism:workspace-commit-abandon' });
  const operation = await coordinator.beginEvidenceFirstOperation(input);
  await coordinator.claimProviderRequest(operation);
  await coordinator.commitCheckpoint(operation, checkpoint(api, operation));

  const acknowledged = await coordinator.controlOwned(ownerIdentity(input), 'abandon');
  assert.deepEqual(acknowledged, {
    operationId: input.operationId,
    epoch: operation.epoch,
    status: 'failed',
    active: false,
    paused: false,
    cancelled: false,
    cancelGeneration: 1,
    abandoned: true,
    compacted: true,
    cleanupComplete: true,
    released: false
  });
  assert.equal(operation.signal.aborted, true);

  const [indexes, states, checkpoints] = await Promise.all([
    cacheStore.listProtectedByPrefix('mechanism-run-index:'),
    cacheStore.listProtectedByPrefix('mechanism-run-state:'),
    cacheStore.listProtectedByPrefix('mechanism-checkpoint:')
  ]);
  assert.equal(indexes.size, 1);
  const abandonedIndex = [...indexes.values()][0].runIndex;
  assert.equal(abandonedIndex.terminal, 'failed');
  assert.equal(abandonedIndex.protectedBytesReserved, 0);
  assert.equal(states.size, 0);
  assert.equal(checkpoints.size, 0);

  const revision = abandonedIndex.revision;
  const replay = await coordinator.controlOwned(ownerIdentity(input), 'abandon');
  assert.deepEqual(replay, acknowledged);
  assert.equal(
    [...(await cacheStore.listProtectedByPrefix('mechanism-run-index:')).values()][0]
      .runIndex.revision,
    revision,
    'a lost abandon ACK replays without changing the durable terminal authority'
  );

  let providerClaims = 0;
  const restarted = api.createMechanismOperationCoordinator({ cacheStore });
  await assert.rejects(
    restarted.beginEvidenceFirstOperation(input).then(async restored => {
      providerClaims += 1;
      return restarted.claimProviderRequest(restored);
    }),
    error => error.code === 'MECHANISM_OPERATION_FINALIZED'
  );
  assert.equal(providerClaims, 0);
});

test('abandon compacts complete needs-review and failed terminals without posing as release', async () => {
  const api = loadCoordinator();
  for (const terminal of ['complete', 'needs_review', 'failed']) {
    const cacheStore = globalThis.SciLLM.createMemoryAnalysisCache();
    const coordinator = api.createMechanismOperationCoordinator({ cacheStore });
    const input = identity({ operationId: `mechanism:abandon-${terminal}` });
    const operation = await coordinator.beginEvidenceFirstOperation(input);
    if (terminal !== 'failed') {
      await coordinator.commitCheckpoint(operation, checkpoint(api, operation, {
        phase: 'ready', nextBatchIndex: 0,
        payload: { finalStatus: terminal, finalDigest: `digest-${terminal}` }
      }));
    }
    await coordinator.finalize(operation, terminal);

    const acknowledged = await coordinator.controlOwned(ownerIdentity(input), 'abandon');
    assert.equal(acknowledged.abandoned, true, terminal);
    assert.equal(acknowledged.cleanupComplete, true, terminal);
    assert.equal(acknowledged.compacted, true, terminal);
    assert.equal(acknowledged.released, false, terminal);
    assert.equal(acknowledged.status, 'failed', terminal);
    const index = [...(await cacheStore.listProtectedByPrefix(
      'mechanism-run-index:'
    )).values()][0].runIndex;
    assert.equal(index.terminal, 'failed', terminal);
    assert.equal(index.protectedBytesReserved, 0, terminal);
    assert.equal((await cacheStore.listProtectedByPrefix(
      'mechanism-run-state:'
    )).size, 0, terminal);
    assert.equal((await cacheStore.listProtectedByPrefix(
      'mechanism-checkpoint:'
    )).size, 0, terminal);
  }
});

test('abandon rejects owner drift and prior cancel or release instead of forging an ACK', async () => {
  const api = loadCoordinator();
  const cacheStore = globalThis.SciLLM.createMemoryAnalysisCache();
  const coordinator = api.createMechanismOperationCoordinator({ cacheStore });
  const input = identity({ operationId: 'mechanism:abandon-owner-drift' });
  const operation = await coordinator.beginEvidenceFirstOperation(input);
  await assert.rejects(
    coordinator.controlOwned({
      ...ownerIdentity(input), workspaceGeneration: input.workspaceGeneration + 1
    }, 'abandon'),
    error => error.code === 'MECHANISM_OPERATION_STALE'
  );
  assert.equal(coordinator.assertActive(operation), operation);

  await coordinator.control(operation, 'cancel');
  await assert.rejects(
    coordinator.controlOwned(ownerIdentity(input), 'abandon'),
    error => error.code === 'MECHANISM_OPERATION_CANCELLED'
  );

  const releaseInput = identity({ operationId: 'mechanism:abandon-after-release' });
  const released = await coordinator.beginEvidenceFirstOperation(releaseInput);
  await coordinator.control(released, 'release');
  await assert.rejects(
    coordinator.controlOwned(ownerIdentity(releaseInput), 'abandon'),
    error => error.code === 'MECHANISM_OPERATION_FINALIZED'
  );
});

test('abandon fails closed without atomic CAS-delete and leaves authority and children intact', async () => {
  const api = loadCoordinator();
  const durable = globalThis.SciLLM.createMemoryAnalysisCache();
  const cacheStore = {
    getMany: (...args) => durable.getMany(...args),
    listProtectedByPrefix: (...args) => durable.listProtectedByPrefix(...args),
    setManyGuarded: (...args) => durable.setManyGuarded(...args),
    compareAndSetManyGuarded: (...args) => durable.compareAndSetManyGuarded(...args),
    deleteMany: (...args) => durable.deleteMany(...args)
  };
  const coordinator = api.createMechanismOperationCoordinator({ cacheStore });
  const input = identity({ operationId: 'mechanism:abandon-atomic-unavailable' });
  const operation = await coordinator.beginEvidenceFirstOperation(input);
  await coordinator.claimProviderRequest(operation);
  await coordinator.commitCheckpoint(operation, checkpoint(api, operation));

  await assert.rejects(
    coordinator.controlOwned(ownerIdentity(input), 'abandon'),
    error => error.code === 'MECHANISM_RUN_STATE_WRITE_FAILED'
  );
  const index = [...(await durable.listProtectedByPrefix(
    'mechanism-run-index:'
  )).values()][0].runIndex;
  assert.equal(index.terminal, 'active');
  assert.equal(index.protectedBytesReserved, api.MECHANISM_PROTECTED_BYTES_RESERVATION);
  assert.equal((await durable.listProtectedByPrefix('mechanism-run-state:')).size, 1);
  assert.equal((await durable.listProtectedByPrefix('mechanism-checkpoint:')).size, 1);
});

test('abandon retries a same-authority CAS conflict and commits exactly one atomic cleanup', async () => {
  const api = loadCoordinator();
  const durable = globalThis.SciLLM.createMemoryAnalysisCache();
  let conflicts = 0;
  let atomicCalls = 0;
  const cacheStore = new Proxy(durable, {
    get(target, property) {
      if (property === 'compareAndSetManyAndDeleteGuarded') {
        return async (values, deleteKeys, guard) => {
          atomicCalls += 1;
          if (conflicts === 0) {
            conflicts += 1;
            const currentValue = (await target.getMany([guard.casKey])).get(guard.casKey);
            return {
              applied: false,
              currentValue,
              revision: currentValue.revision,
              terminalCode: null
            };
          }
          return target.compareAndSetManyAndDeleteGuarded(values, deleteKeys, guard);
        };
      }
      const value = target[property];
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
  const coordinator = api.createMechanismOperationCoordinator({ cacheStore });
  const input = identity({ operationId: 'mechanism:abandon-cas-conflict' });
  const operation = await coordinator.beginEvidenceFirstOperation(input);
  await coordinator.commitCheckpoint(operation, checkpoint(api, operation));

  const acknowledged = await coordinator.controlOwned(ownerIdentity(input), 'abandon');
  assert.equal(acknowledged.abandoned, true);
  assert.equal(atomicCalls, 2);
  assert.equal((await durable.listProtectedByPrefix('mechanism-run-state:')).size, 0);
  assert.equal((await durable.listProtectedByPrefix('mechanism-checkpoint:')).size, 0);
});

test('abandon pins the first owner epoch and never follows changed run-state authority', async () => {
  const api = loadCoordinator();
  const durable = globalThis.SciLLM.createMemoryAnalysisCache();
  let armed = false;
  let ownerIndexReads = 0;
  let authorityAdvanced = false;
  const cacheStore = new Proxy(durable, {
    get(target, property) {
      if (property === 'getMany') {
        return async keys => {
          const found = await target.getMany(keys);
          if (armed && keys.length === 1 &&
              String(keys[0]).startsWith('mechanism-run-index:')) {
            ownerIndexReads += 1;
            if (ownerIndexReads === 2) {
              const runIndexRecord = found.get(keys[0]);
              const current = runIndexRecord.runIndex;
              const stateRecord = (await target.getMany([
                current.latestRunStateKey
              ])).get(current.latestRunStateKey);
              const nextBinding = {
                ...current.identity, operationEpoch: current.latestEpoch + 1
              };
              const nextRunStateKey = `mechanism-run-state:${'0'.repeat(64)}:${
                coordinatorStableHash(nextBinding)
              }`;
              const nextState = { ...stateRecord.runState, binding: nextBinding };
              const nextIndex = {
                ...current,
                revision: current.revision + 1,
                latestEpoch: current.latestEpoch + 1,
                latestRunStateKey: nextRunStateKey
              };
              const applied = await target.compareAndSetManyGuarded([{
                ...runIndexRecord,
                revision: nextIndex.revision,
                runIndex: nextIndex
              }, {
                ...stateRecord,
                key: nextRunStateKey,
                runState: nextState
              }], {
                assertActive() {}, casKey: keys[0], expectedRevision: current.revision
              });
              assert.equal(applied.applied, true);
              authorityAdvanced = true;
              return target.getMany(keys);
            }
          }
          return found;
        };
      }
      const value = target[property];
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
  const coordinator = api.createMechanismOperationCoordinator({ cacheStore });
  const input = identity({ operationId: 'mechanism:abandon-authority-aba' });
  const operation = await coordinator.beginEvidenceFirstOperation(input);
  await coordinator.claimProviderRequest(operation);
  await coordinator.commitCheckpoint(operation, checkpoint(api, operation));
  armed = true;

  await assert.rejects(
    coordinator.controlOwned(ownerIdentity(input), 'abandon'),
    error => error.code === 'MECHANISM_OPERATION_STALE'
  );
  assert.equal(authorityAdvanced, true);
  const records = await durable.listProtectedByPrefix('mechanism-run-index:');
  const index = [...records.values()][0].runIndex;
  assert.equal(index.latestEpoch, operation.epoch + 1);
  assert.equal(index.terminal, 'active');
  assert.equal(index.protectedBytesReserved, api.MECHANISM_PROTECTED_BYTES_RESERVATION);
  assert.equal((await durable.listProtectedByPrefix(
    'mechanism-run-state:'
  )).has(index.latestRunStateKey), true);
});

test('abandon CAS failure is non-destructive and an after-applied ACK loss repairs on retry', async () => {
  const api = loadCoordinator();
  for (const fault of ['before', 'after']) {
    const durable = globalThis.SciLLM.createMemoryAnalysisCache();
    let inject = true;
    const cacheStore = new Proxy(durable, {
      get(target, property) {
        if (property === 'compareAndSetManyAndDeleteGuarded') {
          return async (values, deleteKeys, guard) => {
            const isAbandon = values.some(value => value?.runIndex?.terminal === 'failed');
            if (inject && isAbandon && fault === 'before') {
              inject = false;
              throw new Error('simulated pre-commit failure');
            }
            const result = await target.compareAndSetManyAndDeleteGuarded(
              values, deleteKeys, guard
            );
            if (inject && isAbandon && fault === 'after') {
              inject = false;
              throw new Error('simulated lost post-commit acknowledgement');
            }
            return result;
          };
        }
        const value = target[property];
        return typeof value === 'function' ? value.bind(target) : value;
      }
    });
    const coordinator = api.createMechanismOperationCoordinator({ cacheStore });
    const input = identity({ operationId: `mechanism:abandon-fault-${fault}` });
    const operation = await coordinator.beginEvidenceFirstOperation(input);
    await coordinator.claimProviderRequest(operation);
    await coordinator.commitCheckpoint(operation, checkpoint(api, operation));

    await assert.rejects(
      coordinator.controlOwned(ownerIdentity(input), 'abandon'),
      error => error.code === 'MECHANISM_RUN_STATE_WRITE_FAILED' &&
        !error.message.includes('simulated')
    );
    const afterFault = [...(await durable.listProtectedByPrefix(
      'mechanism-run-index:'
    )).values()][0].runIndex;
    assert.equal(afterFault.terminal, fault === 'before' ? 'active' : 'failed');
    assert.equal(
      afterFault.protectedBytesReserved,
      fault === 'before' ? api.MECHANISM_PROTECTED_BYTES_RESERVATION : 0
    );
    assert.equal(
      (await durable.listProtectedByPrefix('mechanism-run-state:')).size,
      fault === 'before' ? 1 : 0
    );
    assert.equal(
      (await durable.listProtectedByPrefix('mechanism-checkpoint:')).size,
      fault === 'before' ? 1 : 0
    );

    const restarted = api.createMechanismOperationCoordinator({ cacheStore });
    const repaired = await restarted.controlOwned(ownerIdentity(input), 'abandon');
    assert.equal(repaired.abandoned, true);
    assert.equal(repaired.cleanupComplete, true);
    assert.equal(repaired.released, false);
    await assert.rejects(
      restarted.beginEvidenceFirstOperation(input),
      error => error.code === 'MECHANISM_OPERATION_FINALIZED'
    );
  }
});

test('long same-document cancellation sequences retain only compact same-id authority', async () => {
  const api = loadCoordinator();
  const cacheStore = globalThis.SciLLM.createMemoryAnalysisCache();
  const coordinator = api.createMechanismOperationCoordinator({ cacheStore });
  const inputs = Array.from({ length: 150 }, (_, index) => identity({
    operationId: `mechanism:compact-cancel-${index}`
  }));
  for (const input of inputs) {
    const operation = await coordinator.beginEvidenceFirstOperation(input);
    const cancelled = await coordinator.control(operation, 'cancel');
    assert.equal(cancelled.cancelled, true);
  }
  const [indexes, states, checkpoints] = await Promise.all([
    cacheStore.listProtectedByPrefix('mechanism-run-index:'),
    cacheStore.listProtectedByPrefix('mechanism-run-state:'),
    cacheStore.listProtectedByPrefix('mechanism-checkpoint:')
  ]);
  assert.equal(indexes.size, inputs.length);
  assert.equal(states.size, 0);
  assert.equal(checkpoints.size, 0);
  const restarted = api.createMechanismOperationCoordinator({ cacheStore });
  await assert.rejects(
    restarted.beginEvidenceFirstOperation(inputs[0]),
    error => error?.code === 'MECHANISM_OPERATION_CANCELLED'
  );
  assert.equal((await cacheStore.listProtectedByPrefix(
    'mechanism-run-index:'
  )).size, inputs.length);
});

test('string status preserves the first durable terminal when same-id identity drifts', async () => {
  const api = loadCoordinator();
  const cacheStore = globalThis.SciLLM.createMemoryAnalysisCache();
  const operationId = 'mechanism:latest-durable-status';
  const first = api.createMechanismOperationCoordinator({ cacheStore });
  const firstInput = identity({ operationId });
  const completed = await first.beginEvidenceFirstOperation(firstInput);
  await first.commitCheckpoint(completed, checkpoint(api, completed, {
    phase: 'ready', nextBatchIndex: 0,
    payload: { finalStatus: 'complete', finalDigest: 'digest-complete' }
  }));
  await first.finalize(completed, 'complete');

  const second = api.createMechanismOperationCoordinator({ cacheStore });
  await assert.rejects(second.beginEvidenceFirstOperation(identity({
    operationId, documentHash: 'b'.repeat(64)
  })), error => error?.code === 'MECHANISM_OPERATION_STALE');
  const expected = {
    operationId, epoch: completed.epoch, status: 'complete',
    active: false, paused: false, cancelled: false
  };
  assert.deepEqual(await second.status(operationId), expected);
  assert.deepEqual(await first.status(operationId), expected);
});

function identity(overrides = {}) {
  return {
    operationId: 'mechanism:paper-1',
    documentId: 'doc-1',
    documentHash: 'a'.repeat(64),
    workspaceId: 'workspace-1',
    workspaceGeneration: 1,
    workspaceLifecycle: 0,
    mechanismChainFingerprint: 'mechanism-chain-v1-0123456789abcdef',
    senderExtensionId: 'extension-1',
    senderTabId: 1,
    senderFrameId: 0,
    senderDocumentId: '11111111-1111-4111-8111-111111111111',
    profileSignature: 'profile-a',
    baseWorkspaceRevision: 7,
    ...overrides
  };
}

function checkpoint(api, operation, overrides = {}) {
  return {
    schemaVersion: api.MECHANISM_CHECKPOINT_SCHEMA_VERSION,
    binding: operation.binding,
    phase: 'edge_batch',
    nextBatchIndex: 2,
    completedPanelKeys: ['fig1::a'],
    providerReceiptIds: [],
    payload: { edgeCount: 3 },
    ...overrides
  };
}

test('frozen policy uses a 20 minute deadline and exactly 96 durable provider claims', async () => {
  const api = loadCoordinator();
  let clock = 1_000;
  const coordinator = api.createMechanismOperationCoordinator({ now: () => clock });
  const operation = await coordinator.beginEvidenceFirstOperation(identity());

  assert.equal(operation.deadlineAt, clock + 20 * 60 * 1000);
  assert.equal(operation.maxProviderRequests, 96);
  for (let index = 1; index <= 96; index += 1) {
    const claim = await coordinator.claimProviderRequest(operation);
    assert.equal(claim.requestNumber, index);
    assert.equal(claim.remainingProviderRequests, 96 - index);
  }
  await assert.rejects(
    coordinator.claimProviderRequest(operation),
    error => error.code === 'MECHANISM_PROVIDER_REQUEST_BUDGET_EXCEEDED'
  );
  clock = operation.deadlineAt;
  assert.throws(
    () => coordinator.assertActive(operation),
    error => error.code === 'MECHANISM_OPERATION_DEADLINE_EXCEEDED'
  );
});

test('an exact identity status probe rejects owner drift without creating a new epoch', async () => {
  const api = loadCoordinator();
  const cacheStore = globalThis.SciLLM.createMemoryAnalysisCache();
  const coordinator = api.createMechanismOperationCoordinator({ cacheStore });
  const input = identity({ operationId: 'mechanism:owner-status-probe' });
  const operation = await coordinator.beginEvidenceFirstOperation(input);
  assert.equal((await coordinator.status(input)).epoch, operation.epoch);
  await assert.rejects(
    coordinator.status({ ...input, senderDocumentId: '22222222-2222-4222-8222-222222222222' }),
    error => error?.code === 'MECHANISM_OPERATION_STALE'
  );
  assert.equal((await coordinator.status(input)).epoch, operation.epoch);
});

test('1025 unknown tab commit-retire cycles are no-ops before one real owner is admitted', async () => {
  const api = loadCoordinator();
  const cacheStore = globalThis.SciLLM.createMemoryAnalysisCache();
  const coordinator = api.createMechanismOperationCoordinator({
    cacheStore, enforceOwnerAuthority: true
  });
  const senderExtensionId = 'extension-unknown-tab-capacity';
  for (let index = 0; index < 1025; index += 1) {
    const senderTabId = 10_000 + index;
    assert.deepEqual(await coordinator.commitTrustedDocument({
      senderExtensionId,
      senderTabId,
      senderFrameId: 0,
      senderDocumentId: `unknown-document-${index}`
    }), { cleaned: 0 });
    assert.deepEqual(await coordinator.retireTrustedTab({
      senderExtensionId, senderTabId
    }), { cleaned: 0 });
  }

  const emptyPrefixes = await Promise.all([
    'mechanism-owner-tab:',
    'mechanism-owner-current:',
    'mechanism-run-index:',
    'mechanism-run-state:',
    'mechanism-checkpoint:'
  ].map(prefix => cacheStore.listProtectedByPrefix(prefix)));
  assert.deepEqual(emptyPrefixes.map(records => records.size), [0, 0, 0, 0, 0],
    'unknown browser events cannot consume owner, document, or pending-run authority');

  const realInput = identity({
    operationId: 'mechanism:first-real-owner-after-unknown-tabs',
    senderExtensionId,
    senderTabId: 20_000,
    senderDocumentId: 'real-document-before-navigation'
  });
  const real = await coordinator.beginEvidenceFirstOperation(realInput);
  assert.equal((await coordinator.claimProviderRequest(real)).requestNumber, 1,
    'the first real begin remains the authority-creation path');
  assert.equal((await cacheStore.listProtectedByPrefix('mechanism-owner-tab:')).size, 1);
  assert.equal((await cacheStore.listProtectedByPrefix(
    'mechanism-owner-current:'
  )).size, 1);

  const nextDocumentId = 'real-document-after-navigation';
  const navigated = await coordinator.commitTrustedDocument({
    senderExtensionId,
    senderTabId: realInput.senderTabId,
    senderFrameId: realInput.senderFrameId,
    senderDocumentId: nextDocumentId
  });
  assert.deepEqual(navigated, { cleaned: 1 });
  assert.equal(real.signal.aborted, true);
  await assert.rejects(
    coordinator.beginEvidenceFirstOperation(realInput),
    error => error.code === 'MECHANISM_OPERATION_STALE'
  );

  const navigatedInput = identity({
    ...realInput,
    operationId: 'mechanism:known-owner-after-navigation',
    senderDocumentId: nextDocumentId
  });
  const navigatedRun = await coordinator.beginEvidenceFirstOperation(navigatedInput);
  assert.equal((await coordinator.claimProviderRequest(navigatedRun)).requestNumber, 1);
  const retired = await coordinator.retireTrustedTab({
    senderExtensionId, senderTabId: realInput.senderTabId
  });
  assert.deepEqual(retired, { cleaned: 1 });
  assert.equal(navigatedRun.signal.aborted, true);
  assert.equal((await cacheStore.listProtectedByPrefix('mechanism-run-index:')).size, 0);
  assert.equal((await cacheStore.listProtectedByPrefix(
    'mechanism-owner-current:'
  )).size, 0);
  assert.equal((await cacheStore.listProtectedByPrefix('mechanism-owner-tab:')).size, 1,
    'a known retired tab keeps one tombstone to reject late messages');
  await assert.rejects(
    coordinator.beginEvidenceFirstOperation(navigatedInput),
    error => error.code === 'MECHANISM_OPERATION_STALE'
  );
});

test('retire rejects an orphaned real owner when its tab authority alone was lost', async () => {
  const api = loadCoordinator();
  const cacheStore = globalThis.SciLLM.createMemoryAnalysisCache();
  const coordinator = api.createMechanismOperationCoordinator({
    cacheStore, enforceOwnerAuthority: true
  });
  const input = identity({
    operationId: 'mechanism:orphaned-owner-retire',
    senderTabId: 30_001,
    senderDocumentId: 'orphaned-owner-retire-document'
  });
  const operation = await coordinator.beginEvidenceFirstOperation(input);
  await coordinator.claimProviderRequest(operation);
  await coordinator.commitCheckpoint(operation, checkpoint(api, operation));
  const tabKeys = [...(await cacheStore.listProtectedByPrefix(
    'mechanism-owner-tab:'
  )).keys()];
  assert.equal(tabKeys.length, 1);
  await cacheStore.deleteMany(tabKeys);

  await assert.rejects(
    coordinator.retireTrustedTab({
      senderExtensionId: input.senderExtensionId,
      senderTabId: input.senderTabId
    }),
    error => error.code === 'MECHANISM_RUN_STATE_READ_FAILED'
  );
  assert.equal(operation.signal.aborted, false,
    'a fixed read failure must not pretend the orphan was cleaned');
  assert.deepEqual((await Promise.all([
    'mechanism-owner-current:',
    'mechanism-run-index:',
    'mechanism-run-state:',
    'mechanism-checkpoint:'
  ].map(prefix => cacheStore.listProtectedByPrefix(prefix))))
    .map(records => records.size), [1, 1, 1, 1]);
});

test('commit detects a same-tab cross-frame orphan before returning an unknown-tab no-op', async () => {
  const api = loadCoordinator();
  const cacheStore = globalThis.SciLLM.createMemoryAnalysisCache();
  const first = api.createMechanismOperationCoordinator({
    cacheStore, enforceOwnerAuthority: true
  });
  const input = identity({
    operationId: 'mechanism:cross-frame-orphan',
    senderTabId: 30_002,
    senderFrameId: 7,
    senderDocumentId: 'cross-frame-orphan-document'
  });
  await first.beginEvidenceFirstOperation(input);
  const deletePrefixes = [
    'mechanism-owner-tab:',
    'mechanism-run-index:',
    'mechanism-run-state:',
    'mechanism-checkpoint:'
  ];
  const deleteKeys = (await Promise.all(deletePrefixes.map(
    prefix => cacheStore.listProtectedByPrefix(prefix)
  ))).flatMap(records => [...records.keys()]);
  await cacheStore.deleteMany(deleteKeys);
  assert.equal((await cacheStore.listProtectedByPrefix(
    'mechanism-owner-current:'
  )).size, 1, 'only the other frame authority remains');

  const restarted = api.createMechanismOperationCoordinator({
    cacheStore, enforceOwnerAuthority: true
  });
  await assert.rejects(
    restarted.commitTrustedDocument({
      senderExtensionId: input.senderExtensionId,
      senderTabId: input.senderTabId,
      senderFrameId: 0,
      senderDocumentId: 'cross-frame-new-main-document'
    }),
    error => error.code === 'MECHANISM_RUN_STATE_READ_FAILED'
  );
  assert.equal((await cacheStore.listProtectedByPrefix(
    'mechanism-owner-current:'
  )).size, 1);
  assert.equal((await cacheStore.listProtectedByPrefix(
    'mechanism-owner-tab:'
  )).size, 0, 'an orphan rejection must not recreate a tab authority');
});

test('unknown-tab no-op rejects isolated run index state and checkpoint orphans', async () => {
  const api = loadCoordinator();
  for (const retainedPrefix of [
    'mechanism-run-index:',
    'mechanism-run-state:',
    'mechanism-checkpoint:'
  ]) {
    const cacheStore = globalThis.SciLLM.createMemoryAnalysisCache();
    const first = api.createMechanismOperationCoordinator({
      cacheStore, enforceOwnerAuthority: true
    });
    const suffix = retainedPrefix.replace(/[^a-z]/gu, '');
    const input = identity({
      operationId: `mechanism:isolated-orphan-${suffix}`,
      senderTabId: 31_000 + [
        'mechanism-run-index:',
        'mechanism-run-state:',
        'mechanism-checkpoint:'
      ].indexOf(retainedPrefix),
      senderDocumentId: `isolated-orphan-document-${suffix}`
    });
    const operation = await first.beginEvidenceFirstOperation(input);
    await first.commitCheckpoint(operation, checkpoint(api, operation));
    const prefixes = [
      'mechanism-owner-tab:',
      'mechanism-owner-current:',
      'mechanism-run-index:',
      'mechanism-run-state:',
      'mechanism-checkpoint:'
    ];
    const records = await Promise.all(prefixes.map(
      prefix => cacheStore.listProtectedByPrefix(prefix)
    ));
    const deleteKeys = records.flatMap((found, index) =>
      prefixes[index] === retainedPrefix ? [] : [...found.keys()]
    );
    await cacheStore.deleteMany(deleteKeys);
    assert.equal((await cacheStore.listProtectedByPrefix(retainedPrefix)).size, 1);

    const restarted = api.createMechanismOperationCoordinator({
      cacheStore, enforceOwnerAuthority: true
    });
    await assert.rejects(
      restarted.retireTrustedTab({
        senderExtensionId: input.senderExtensionId,
        senderTabId: input.senderTabId
      }),
      error => error.code === 'MECHANISM_RUN_STATE_READ_FAILED',
      retainedPrefix
    );
    assert.equal((await cacheStore.listProtectedByPrefix(retainedPrefix)).size, 1,
      `${retainedPrefix} must remain visibly unconfirmed after fail-closed rejection`);
  }
});

test('committed document authority retires only the prior exact frame owner across restart', async () => {
  const api = loadCoordinator();
  const cacheStore = globalThis.SciLLM.createMemoryAnalysisCache();
  const coordinator = api.createMechanismOperationCoordinator({
    cacheStore, enforceOwnerAuthority: true
  });
  const oldMain = identity({
    operationId: 'mechanism:owner-main-old', senderTabId: 51, senderFrameId: 0,
    senderDocumentId: '51515151-5151-4151-8151-515151515151'
  });
  const otherTab = identity({
    operationId: 'mechanism:owner-other-tab', senderTabId: 52, senderFrameId: 0,
    senderDocumentId: '52525252-5252-4252-8252-525252525252'
  });
  const old = await coordinator.beginEvidenceFirstOperation(oldMain);
  const untouched = await coordinator.beginEvidenceFirstOperation(otherTab);
  await coordinator.claimProviderRequest(old, {
    receipt: '1'.repeat(64), bindingDigest: '2'.repeat(64)
  });

  const cleanup = await coordinator.commitTrustedDocument({
    senderExtensionId: oldMain.senderExtensionId,
    senderTabId: oldMain.senderTabId,
    senderFrameId: oldMain.senderFrameId,
    senderDocumentId: '53535353-5353-4353-8353-535353535353'
  });
  assert.equal(cleanup.cleaned, 1);
  assert.equal(old.signal.aborted, true);
  assert.equal(untouched.signal.aborted, false);

  const restarted = api.createMechanismOperationCoordinator({
    cacheStore, enforceOwnerAuthority: true
  });
  await assert.rejects(
    restarted.beginEvidenceFirstOperation(oldMain),
    error => error.code === 'MECHANISM_OPERATION_STALE'
  );
  const current = await restarted.beginEvidenceFirstOperation(identity({
    operationId: 'mechanism:owner-main-new', senderTabId: 51, senderFrameId: 0,
    senderDocumentId: '53535353-5353-4353-8353-535353535353'
  }));
  assert.equal(current.epoch, 1);
  assert.equal((await restarted.claimProviderRequest(current)).requestNumber, 1);
});

test('tab retirement permanently blocks late or replacement documents for that tab identity', async () => {
  const api = loadCoordinator();
  const cacheStore = globalThis.SciLLM.createMemoryAnalysisCache();
  const coordinator = api.createMechanismOperationCoordinator({
    cacheStore, enforceOwnerAuthority: true
  });
  const oldInput = identity({
    operationId: 'mechanism:removed-tab-old', senderTabId: 61,
    senderDocumentId: '61616161-6161-4161-8161-616161616161'
  });
  const old = await coordinator.beginEvidenceFirstOperation(oldInput);
  const retired = await coordinator.retireTrustedTab({
    senderExtensionId: oldInput.senderExtensionId,
    senderTabId: oldInput.senderTabId
  });
  assert.equal(retired.cleaned, 1);
  assert.equal(old.signal.aborted, true);

  const restarted = api.createMechanismOperationCoordinator({
    cacheStore, enforceOwnerAuthority: true
  });
  await assert.rejects(
    restarted.beginEvidenceFirstOperation(oldInput),
    error => error.code === 'MECHANISM_OPERATION_STALE'
  );
  const newDocument = '62626262-6262-4262-8262-626262626262';
  await assert.rejects(restarted.commitTrustedDocument({
    senderExtensionId: oldInput.senderExtensionId,
    senderTabId: oldInput.senderTabId,
    senderFrameId: 0,
    senderDocumentId: newDocument
  }), error => error.code === 'MECHANISM_OPERATION_STALE');
  await assert.rejects(restarted.beginEvidenceFirstOperation(identity({
    operationId: 'mechanism:removed-tab-new', senderTabId: 61,
    senderDocumentId: newDocument
  })), error => error.code === 'MECHANISM_OPERATION_STALE');
});

test('mechanism authority is sticky across worker restarts but isolated by browser session', async () => {
  const api = loadCoordinator();
  const cacheStore = globalThis.SciLLM.createMemoryAnalysisCache();
  const sessionA = 'a'.repeat(64);
  const sessionB = 'b'.repeat(64);
  const input = identity({
    operationId: 'mechanism:browser-session-authority', senderTabId: 62,
    senderDocumentId: '62626262-6262-4262-8262-626262626262'
  });
  const create = sessionId => api.createMechanismOperationCoordinator({
    cacheStore, enforceOwnerAuthority: true,
    sessionIdentityProvider: async () => sessionId
  });
  const first = create(sessionA);
  const operation = await first.beginEvidenceFirstOperation(input);
  await first.claimProviderRequest(operation, {
    receipt: '7'.repeat(64), bindingDigest: '8'.repeat(64)
  });
  await first.retireTrustedTab({
    senderExtensionId: input.senderExtensionId, senderTabId: input.senderTabId
  });

  const sameSessionRestart = create(sessionA);
  await assert.rejects(
    sameSessionRestart.beginEvidenceFirstOperation(input),
    error => error.code === 'MECHANISM_OPERATION_STALE'
  );
  await assert.rejects(sameSessionRestart.commitTrustedDocument({
    senderExtensionId: input.senderExtensionId,
    senderTabId: input.senderTabId, senderFrameId: input.senderFrameId,
    senderDocumentId: '63636363-6363-4363-8363-636363636363'
  }), error => error.code === 'MECHANISM_OPERATION_STALE');

  const newBrowserSession = create(sessionB);
  const reused = await newBrowserSession.beginEvidenceFirstOperation({
    ...input,
    senderDocumentId: '63636363-6363-4363-8363-636363636363'
  });
  assert.equal(reused.epoch, 1);
  assert.equal(reused.binding.browserSessionId, sessionB);
  assert.equal((await newBrowserSession.claimProviderRequest(reused, {
    receipt: '9'.repeat(64), bindingDigest: 'c'.repeat(64)
  })).requestNumber, 1,
  'a cleared browser session cannot read or reuse the prior IndexedDB receipt');
  const protectedKeys = [];
  for (const prefix of [
    'mechanism-run-index:', 'mechanism-run-state:', 'mechanism-checkpoint:',
    'mechanism-owner-tab:', 'mechanism-owner-current:'
  ]) {
    protectedKeys.push(...(await cacheStore.listProtectedByPrefix(prefix)).keys());
  }
  assert.equal(protectedKeys.some(key => key.includes(`${sessionA}:`)), false,
    'the new session removes obsolete protected authority before admission');
  assert.equal(protectedKeys.every(key => key.includes(`${sessionB}:`)), true);
});

test('browser-session authority is published only after stale namespace purge succeeds', async () => {
  const api = loadCoordinator();
  const durable = globalThis.SciLLM.createMemoryAnalysisCache();
  const oldSession = 'd'.repeat(64);
  const newSession = 'e'.repeat(64);
  const staleKey = `mechanism-owner-tab:${oldSession}:extension-id:64`;
  await durable.setMany([{ key: staleKey, owner: { retired: true } }]);
  let purgeAttempts = 0;
  const cacheStore = {
    getMany: durable.getMany,
    listProtectedByPrefix: durable.listProtectedByPrefix,
    setMany: durable.setMany,
    setManyGuarded: durable.setManyGuarded,
    compareAndSetManyGuarded: durable.compareAndSetManyGuarded,
    async deleteMany(keys) {
      purgeAttempts += 1;
      if (purgeAttempts === 1) throw new Error('injected purge failure');
      return durable.deleteMany(keys);
    }
  };
  const coordinator = api.createMechanismOperationCoordinator({
    cacheStore,
    enforceOwnerAuthority: true,
    sessionIdentityProvider: async () => newSession
  });
  const owner = identity({
    operationId: 'mechanism:session-purge-retry', senderTabId: 64,
    senderDocumentId: '64646464-6464-4464-8464-646464646464'
  });

  await assert.rejects(
    coordinator.commitTrustedDocument(owner),
    error => error.code === 'MECHANISM_RUN_STATE_WRITE_FAILED'
  );
  assert.equal((await durable.listProtectedByPrefix(
    'mechanism-owner-tab:'
  )).has(staleKey), true, 'failed initialization leaves old authority intact');

  await coordinator.commitTrustedDocument(owner);
  assert.equal(purgeAttempts, 2, 'the failed purge is retried before admission');
  assert.equal((await durable.listProtectedByPrefix(
    'mechanism-owner-tab:'
  )).has(staleKey), false);
  const operation = await coordinator.beginEvidenceFirstOperation(owner);
  assert.equal(operation.binding.browserSessionId, newSession);
});

test('workspace lifecycle authority advances exactly once and quarantines the prior lifecycle', async () => {
  const api = loadCoordinator();
  const cacheStore = globalThis.SciLLM.createMemoryAnalysisCache();
  const coordinator = api.createMechanismOperationCoordinator({
    cacheStore, enforceOwnerAuthority: true
  });
  const oldInput = identity({
    operationId: 'mechanism:lifecycle-old', senderTabId: 63,
    senderDocumentId: '63636363-6363-4363-8363-636363636363',
    workspaceLifecycle: 4
  });
  await coordinator.commitTrustedDocument(oldInput);
  const old = await coordinator.beginEvidenceFirstOperation(oldInput);
  await coordinator.claimProviderRequest(old, {
    receipt: '3'.repeat(64), bindingDigest: '4'.repeat(64)
  });

  const nextInput = identity({
    ...oldInput,
    operationId: 'mechanism:lifecycle-next',
    workspaceLifecycle: 5
  });
  const next = await coordinator.beginEvidenceFirstOperation(nextInput);
  assert.equal(old.signal.aborted, true);
  assert.equal((await coordinator.claimProviderRequest(next)).requestNumber, 1);
  await assert.rejects(
    coordinator.claimProviderRequest(old),
    error => error.code === 'MECHANISM_OPERATION_STALE'
  );

  const restarted = api.createMechanismOperationCoordinator({
    cacheStore, enforceOwnerAuthority: true
  });
  await assert.rejects(
    restarted.beginEvidenceFirstOperation(oldInput),
    error => error.code === 'MECHANISM_OPERATION_STALE'
  );
  await assert.rejects(
    restarted.beginEvidenceFirstOperation(identity({
      ...oldInput,
      operationId: 'mechanism:lifecycle-future',
      workspaceLifecycle: 7
    })),
    error => error.code === 'MECHANISM_OPERATION_STALE'
  );
});

test('document authority commits tab generation and frame identity atomically across a lost acknowledgement', async () => {
  const api = loadCoordinator();
  const base = globalThis.SciLLM.createMemoryAnalysisCache();
  let loseNavigationAck = false;
  const cacheStore = new Proxy(base, {
    get(target, property) {
      if (property === 'compareAndSetManyGuarded') {
        return async (values, guard) => {
          const result = await target.compareAndSetManyGuarded(values, guard);
          if (loseNavigationAck && values.some(value => value?.frameAuthority)) {
            loseNavigationAck = false;
            throw new Error('simulated committed navigation ACK loss');
          }
          return result;
        };
      }
      const value = target[property];
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
  const coordinator = api.createMechanismOperationCoordinator({
    cacheStore, enforceOwnerAuthority: true
  });
  const oldInput = identity({
    operationId: 'mechanism:atomic-owner-old', senderTabId: 64,
    senderDocumentId: '64646464-6464-4464-8464-646464646464'
  });
  const old = await coordinator.beginEvidenceFirstOperation(oldInput);
  await coordinator.claimProviderRequest(old, {
    receipt: '5'.repeat(64), bindingDigest: '6'.repeat(64)
  });
  const nextDocumentId = '65656565-6565-4565-8565-656565656565';
  loseNavigationAck = true;
  await assert.rejects(coordinator.commitTrustedDocument({
    senderExtensionId: oldInput.senderExtensionId,
    senderTabId: oldInput.senderTabId,
    senderFrameId: oldInput.senderFrameId,
    senderDocumentId: nextDocumentId
  }), error => error.code === 'MECHANISM_RUN_STATE_WRITE_FAILED');

  const tabs = await base.listProtectedByPrefix('mechanism-owner-tab:');
  const frames = await base.listProtectedByPrefix('mechanism-owner-current:');
  const tab = [...tabs.values()][0].tabAuthority;
  const frame = [...frames.values()][0].frameAuthority;
  assert.equal(frame.senderDocumentId, nextDocumentId);
  assert.equal(frame.navigationGeneration, tab.navigationGeneration);

  const restarted = api.createMechanismOperationCoordinator({
    cacheStore, enforceOwnerAuthority: true
  });
  await restarted.commitTrustedDocument({
    senderExtensionId: oldInput.senderExtensionId,
    senderTabId: oldInput.senderTabId,
    senderFrameId: oldInput.senderFrameId,
    senderDocumentId: nextDocumentId
  });
  await assert.rejects(
    coordinator.claimProviderRequest(old),
    error => error.code === 'MECHANISM_OPERATION_STALE'
  );
});

test('owner retirement atomically compacts a claimed run before crash-retry deletion', async () => {
  const api = loadCoordinator();
  const durable = globalThis.SciLLM.createMemoryAnalysisCache();
  let failIndexDelete = false;
  const cacheStore = new Proxy(durable, {
    get(target, property) {
      if (property === 'deleteMany') {
        return async keys => {
          if (failIndexDelete && keys.some(key =>
            String(key).startsWith('mechanism-run-index:'))) {
            failIndexDelete = false;
            throw new Error('simulated crash after atomic compact');
          }
          return target.deleteMany(keys);
        };
      }
      const value = target[property];
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
  const coordinator = api.createMechanismOperationCoordinator({
    cacheStore, enforceOwnerAuthority: true
  });
  const oldInput = identity({
    operationId: 'mechanism:retire-claimed-crash', senderTabId: 65,
    senderDocumentId: '65656565-6565-4565-8565-656565656565'
  });
  const operation = await coordinator.beginEvidenceFirstOperation(oldInput);
  await coordinator.claimProviderRequest(operation, {
    receipt: '7'.repeat(64), bindingDigest: '8'.repeat(64)
  });
  failIndexDelete = true;
  const nextOwner = {
    senderExtensionId: oldInput.senderExtensionId,
    senderTabId: oldInput.senderTabId,
    senderFrameId: oldInput.senderFrameId,
    senderDocumentId: '66666666-6666-4666-8666-666666666666'
  };
  await assert.rejects(
    coordinator.commitTrustedDocument(nextOwner),
    error => error?.code === 'MECHANISM_RUN_STATE_WRITE_FAILED'
  );
  const [indexesAfterCrash, statesAfterCrash, checkpointsAfterCrash] = await Promise.all([
    durable.listProtectedByPrefix('mechanism-run-index:'),
    durable.listProtectedByPrefix('mechanism-run-state:'),
    durable.listProtectedByPrefix('mechanism-checkpoint:')
  ]);
  assert.equal(indexesAfterCrash.size, 1);
  const repairMarker = [...indexesAfterCrash.values()][0].runIndex;
  assert.equal(repairMarker.terminal, 'released');
  assert.equal(repairMarker.protectedBytesReserved, 0);
  assert.equal(statesAfterCrash.size, 0);
  assert.equal(checkpointsAfterCrash.size, 0);

  const restarted = api.createMechanismOperationCoordinator({
    cacheStore, enforceOwnerAuthority: true
  });
  const repaired = await restarted.commitTrustedDocument(nextOwner);
  assert.equal(repaired.cleaned, 1);
  assert.equal((await durable.listProtectedByPrefix('mechanism-run-index:')).size, 0);
  await assert.rejects(
    restarted.beginEvidenceFirstOperation(oldInput),
    error => error?.code === 'MECHANISM_OPERATION_STALE'
  );
});

test('a durable evidence dispatch receipt is never reclaimed after coordinator reconstruction', async () => {
  const api = loadCoordinator();
  const cacheStore = globalThis.SciLLM.createMemoryAnalysisCache();
  const input = identity({ operationId: 'mechanism:durable-dispatch-receipt' });
  const receipt = 'a'.repeat(64);
  const bindingDigest = 'b'.repeat(64);
  const firstCoordinator = api.createMechanismOperationCoordinator({ cacheStore });
  const first = await firstCoordinator.beginEvidenceFirstOperation(input);
  const claimed = await firstCoordinator.claimProviderRequest(first, {
    receipt, bindingDigest
  });
  assert.equal(claimed.requestNumber, 1);

  const restartedCoordinator = api.createMechanismOperationCoordinator({ cacheStore });
  const restored = await restartedCoordinator.beginEvidenceFirstOperation(input);
  await assert.rejects(
    restartedCoordinator.resume(restored),
    error => error?.code === 'MECHANISM_PROVIDER_RECEIPT_AMBIGUOUS'
  );
  await assert.rejects(
    restartedCoordinator.claimProviderRequest(restored, { receipt, bindingDigest }),
    error => error?.code === 'MECHANISM_PROVIDER_RECEIPT_AMBIGUOUS'
  );
  await assert.rejects(
    restartedCoordinator.claimProviderRequest(restored, {
      receipt, bindingDigest: 'c'.repeat(64)
    }),
    error => error?.code === 'MECHANISM_PROVIDER_RECEIPT_MISMATCH'
  );
  const status = await restartedCoordinator.commitCheckpoint(restored, checkpoint(
    api, restored,
    { phase: 'panel_census', nextBatchIndex: 0, completedPanelKeys: [] }
  ));
  assert.equal(status.providerRequestsClaimed, 1);
});

test('concurrent coordinators grant one durable evidence dispatch receipt exactly once', async () => {
  const api = loadCoordinator();
  const cacheStore = globalThis.SciLLM.createMemoryAnalysisCache();
  const input = identity({ operationId: 'mechanism:concurrent-dispatch-receipt' });
  const receipt = 'd'.repeat(64);
  const bindingDigest = 'e'.repeat(64);
  const firstCoordinator = api.createMechanismOperationCoordinator({ cacheStore });
  const secondCoordinator = api.createMechanismOperationCoordinator({ cacheStore });
  const first = await firstCoordinator.beginEvidenceFirstOperation(input);
  const second = await secondCoordinator.beginEvidenceFirstOperation(input);

  const outcomes = await Promise.allSettled([
    firstCoordinator.claimProviderRequest(first, { receipt, bindingDigest }),
    secondCoordinator.claimProviderRequest(second, { receipt, bindingDigest })
  ]);
  assert.equal(outcomes.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter(item =>
    item.status === 'rejected' &&
    item.reason?.code === 'MECHANISM_PROVIDER_RECEIPT_AMBIGUOUS').length, 1);
  const restarted = api.createMechanismOperationCoordinator({ cacheStore });
  const restored = await restarted.beginEvidenceFirstOperation(input);
  const committed = await restarted.commitCheckpoint(restored, checkpoint(
    api, restored,
    { phase: 'panel_census', nextBatchIndex: 0, completedPanelKeys: [] }
  ));
  assert.equal(committed.providerRequestsClaimed, 1);
});

test('checkpoint receipt frontier never confirms a concurrently claimed unabsorbed response', async () => {
  const api = loadCoordinator();
  const cacheStore = globalThis.SciLLM.createMemoryAnalysisCache();
  const input = identity({ operationId: 'mechanism:receipt-frontier' });
  const firstCoordinator = api.createMechanismOperationCoordinator({ cacheStore });
  const first = await firstCoordinator.beginEvidenceFirstOperation(input);
  const receiptA = '1'.repeat(64);
  const receiptB = '2'.repeat(64);
  await firstCoordinator.claimProviderRequest(first, {
    receipt: receiptA, bindingDigest: '3'.repeat(64)
  });
  await firstCoordinator.claimProviderRequest(first, {
    receipt: receiptB, bindingDigest: '4'.repeat(64)
  });
  await firstCoordinator.commitCheckpoint(first, checkpoint(api, first, {
    phase: 'panel_census', nextBatchIndex: 0, completedPanelKeys: ['fig1::a'],
    providerReceiptIds: [receiptA]
  }));

  const restarted = api.createMechanismOperationCoordinator({ cacheStore });
  const restored = await restarted.beginEvidenceFirstOperation(input);
  await assert.rejects(
    restarted.resume(restored),
    error => error?.code === 'MECHANISM_PROVIDER_RECEIPT_AMBIGUOUS'
  );
});

test('checkpoint receipt frontier resumes only after every claimed response is absorbed', async () => {
  const api = loadCoordinator();
  const cacheStore = globalThis.SciLLM.createMemoryAnalysisCache();
  const input = identity({ operationId: 'mechanism:receipt-frontier-complete' });
  const receipt = '5'.repeat(64);
  const firstCoordinator = api.createMechanismOperationCoordinator({ cacheStore });
  const first = await firstCoordinator.beginEvidenceFirstOperation(input);
  await firstCoordinator.claimProviderRequest(first, {
    receipt, bindingDigest: '6'.repeat(64)
  });
  await firstCoordinator.commitCheckpoint(first, checkpoint(api, first, {
    phase: 'panel_census', nextBatchIndex: 0, completedPanelKeys: ['fig1::a'],
    providerReceiptIds: [receipt]
  }));

  const restarted = api.createMechanismOperationCoordinator({ cacheStore });
  const restored = await restarted.beginEvidenceFirstOperation(input);
  const resumed = await restarted.resume(restored);
  assert.deepEqual(resumed.providerReceiptIds, [receipt]);
});

test('operation binding is authoritative, exact, recursively frozen, and version-complete', async () => {
  const api = loadCoordinator();
  const coordinator = api.createMechanismOperationCoordinator();
  const operation = await coordinator.beginEvidenceFirstOperation(identity());

  assert.deepEqual(Object.keys(operation.binding).sort(), [
    'baseWorkspaceRevision', 'browserSessionId', 'cacheVersion',
    'canonicalSchemaVersion', 'documentHash',
    'documentId', 'evidenceSchemaVersion', 'idAlgorithmVersion',
    'mechanismChainFingerprint', 'normalizationVersion', 'operationEpoch', 'operationId',
    'profileSignature', 'promptVersion', 'senderDocumentId', 'senderExtensionId',
    'senderFrameId', 'senderTabId', 'workspaceGeneration', 'workspaceId',
    'workspaceLifecycle'
  ]);
  assert.equal(Object.isFrozen(operation), true);
  assert.equal(Object.isFrozen(operation.binding), true);
  assert.equal(operation.binding.operationEpoch, operation.epoch);
  assert.equal(operation.binding.baseWorkspaceRevision, 7);
});

test('cancel before request synchronously prevents provider claims', async () => {
  const api = loadCoordinator();
  const coordinator = api.createMechanismOperationCoordinator();
  const operation = await coordinator.beginEvidenceFirstOperation(identity());
  const completion = coordinator.control(operation, 'cancel');

  assert.equal(operation.signal.aborted, true);
  const result = await completion;
  assert.equal(result.cancelled, true);
  await assert.rejects(
    coordinator.claimProviderRequest(operation),
    error => error.code === 'MECHANISM_OPERATION_CANCELLED'
  );
});

test('cancel after an ignored provider response or during validation prevents later writes', async () => {
  const api = loadCoordinator();
  const base = globalThis.SciLLM.createMemoryAnalysisCache();
  let cacheWrites = 0;
  const cacheStore = {
    getMany: (...args) => base.getMany(...args),
    setManyGuarded: (...args) => base.setManyGuarded(...args),
    async compareAndSetManyGuarded(values, guard) {
      if (values.some(value => value.checkpoint)) cacheWrites += 1;
      return base.compareAndSetManyGuarded(values, guard);
    }
  };
  const coordinator = api.createMechanismOperationCoordinator({ cacheStore });
  const operation = await coordinator.beginEvidenceFirstOperation(identity());
  await coordinator.claimProviderRequest(operation);
  await coordinator.control(operation, 'cancel');

  await assert.rejects(
    coordinator.commitCheckpoint(operation, checkpoint(api, operation)),
    error => error.code === 'MECHANISM_OPERATION_CANCELLED'
  );
  assert.equal(cacheWrites, 0);

  await assert.rejects(
    coordinator.beginEvidenceFirstOperation(identity()),
    error => error?.code === 'MECHANISM_OPERATION_CANCELLED'
  );
  assert.throws(
    () => coordinator.validateCheckpoint(operation, checkpoint(api, operation)),
    error => error.code === 'MECHANISM_OPERATION_CANCELLED'
  );
  assert.equal(cacheWrites, 0);
});

test('cancel during a live guarded transaction causes zero checkpoint and progress commits', async () => {
  const api = loadCoordinator();
  const base = globalThis.SciLLM.createMemoryAnalysisCache();
  let guardedStarted;
  const started = new Promise(resolve => { guardedStarted = resolve; });
  let checkpointCommits = 0;
  const cacheStore = {
    getMany: (...args) => base.getMany(...args),
    setManyGuarded: (...args) => base.setManyGuarded(...args),
    async compareAndSetManyGuarded(values, guard) {
      if (!values.some(value => value.checkpoint)) {
        return base.compareAndSetManyGuarded(values, guard);
      }
      guard.assertActive();
      guardedStarted();
      await new Promise(resolve => guard.signal.addEventListener('abort', resolve, { once: true }));
      guard.assertActive();
      checkpointCommits += 1;
    }
  };
  const coordinator = api.createMechanismOperationCoordinator({ cacheStore });
  const operation = await coordinator.beginEvidenceFirstOperation(identity());
  const pending = coordinator.commitCheckpoint(operation, checkpoint(api, operation));
  await started;
  await coordinator.control(operation, 'cancel');

  await assert.rejects(pending, error => error.code === 'MECHANISM_OPERATION_CANCELLED');
  assert.equal(checkpointCommits, 0);
});

test('cancel immediately before final commit guard prevents workspace writes', async () => {
  const api = loadCoordinator();
  const coordinator = api.createMechanismOperationCoordinator();
  const operation = await coordinator.beginEvidenceFirstOperation(identity());
  let workspaceWrites = 0;
  await coordinator.control(operation, 'cancel');
  assert.throws(() => {
    coordinator.assertActive(operation);
    workspaceWrites += 1;
  }, error => error.code === 'MECHANISM_OPERATION_CANCELLED');
  assert.equal(workspaceWrites, 0);
});

test('checkpoint commits do not consume request budget and resume only exact binding', async () => {
  const api = loadCoordinator();
  const cacheStore = globalThis.SciLLM.createMemoryAnalysisCache();
  const coordinator = api.createMechanismOperationCoordinator({ cacheStore, now: () => 500 });
  const operation = await coordinator.beginEvidenceFirstOperation(identity());
  await coordinator.claimProviderRequest(operation);
  const committed = await coordinator.commitCheckpoint(operation, checkpoint(api, operation));
  assert.equal(committed.providerRequestsClaimed, 1);
  assert.equal(committed.checkpointCommits, 1);

  const resumed = await coordinator.resume(operation);
  assert.equal(resumed.nextBatchIndex, 2);
  assert.equal(Object.isFrozen(resumed), true);
  assert.equal(Object.isFrozen(resumed.payload), true);

  await assert.rejects(
    coordinator.beginEvidenceFirstOperation(identity({ profileSignature: 'profile-b' })),
    error => error?.code === 'MECHANISM_OPERATION_STALE'
  );
  const other = await coordinator.beginEvidenceFirstOperation(identity({
    operationId: 'mechanism:paper-1-other', profileSignature: 'profile-b'
  }));
  assert.equal(await coordinator.resume(other), null);
});

test('resume rejects forged binding and accessors without invoking them or leaking raw errors', async () => {
  const api = loadCoordinator();
  let getterCalls = 0;
  const cacheStore = globalThis.SciLLM.createMemoryAnalysisCache();
  const coordinator = api.createMechanismOperationCoordinator({ cacheStore });
  const operation = await coordinator.beginEvidenceFirstOperation(identity());
  await coordinator.commitCheckpoint(operation, checkpoint(api, operation));
  const key = coordinator.checkpointKey(operation);
  const original = (await cacheStore.getMany([key])).get(key);
  await cacheStore.setMany([{
    ...original,
    binding: { ...operation.binding, workspaceId: 'forged' },
    checkpoint: checkpoint(api, operation)
  }]);
  assert.equal(await coordinator.resume(operation), null);

  const stored = { ...original, binding: operation.binding };
  Object.defineProperty(stored, 'checkpoint', {
    enumerable: true,
    get() { getterCalls += 1; throw new Error('raw secret'); }
  });
  const durableGetMany = cacheStore.getMany.bind(cacheStore);
  cacheStore.getMany = async keys => {
    const found = await durableGetMany(keys);
    if (keys.includes(key)) found.set(key, stored);
    return found;
  };
  await assert.rejects(
    coordinator.resume(operation),
    error => error.code === 'MECHANISM_CHECKPOINT_READ_FAILED' &&
      !error.message.includes('raw secret')
  );
  assert.equal(getterCalls, 0);
});

test('checkpoint validation normalizes hostile Proxy prototype traps exactly once', async () => {
  const api = loadCoordinator();
  const coordinator = api.createMechanismOperationCoordinator();
  const operation = await coordinator.beginEvidenceFirstOperation(identity());
  let bindingPrototypeTraps = 0;
  const hostileBinding = new Proxy({ ...operation.binding }, {
    getPrototypeOf() {
      bindingPrototypeTraps += 1;
      throw new Error('secret binding prototype');
    }
  });

  assert.throws(
    () => coordinator.validateCheckpoint(operation, checkpoint(api, operation, {
      binding: hostileBinding
    })),
    error => error.code === 'MECHANISM_CHECKPOINT_INVALID' &&
      error.message === 'Mechanism checkpoint is invalid' &&
      !error.message.includes('secret')
  );
  assert.equal(bindingPrototypeTraps, 1);

  let payloadPrototypeTraps = 0;
  const hostilePayload = new Proxy({ edgeCount: 3 }, {
    getPrototypeOf() {
      payloadPrototypeTraps += 1;
      throw new Error('secret payload prototype');
    }
  });
  assert.throws(
    () => coordinator.validateCheckpoint(operation, checkpoint(api, operation, {
      payload: hostilePayload
    })),
    error => error.code === 'MECHANISM_CHECKPOINT_INVALID' &&
      error.message === 'Mechanism checkpoint is invalid' &&
      !error.message.includes('secret')
  );
  assert.equal(payloadPrototypeTraps, 1);
});

test('checkpoint validation never invokes a Proxy array get trap', async () => {
  const api = loadCoordinator();
  const coordinator = api.createMechanismOperationCoordinator();
  const operation = await coordinator.beginEvidenceFirstOperation(identity());
  let getTraps = 0;
  const panelKeys = new Proxy(['fig1::a'], {
    get() {
      getTraps += 1;
      throw new Error('secret array get');
    }
  });

  const validated = coordinator.validateCheckpoint(operation, checkpoint(api, operation, {
    completedPanelKeys: panelKeys
  }));
  assert.deepEqual(validated.completedPanelKeys, ['fig1::a']);
  assert.equal(getTraps, 0);
  assert.throws(
    () => coordinator.validateCheckpoint(operation, checkpoint(api, operation, {
      nextBatchIndex: 100_001
    })),
    error => error.code === 'MECHANISM_CHECKPOINT_INVALID'
  );
});

test('a duplicate begin attaches to the same durable epoch without resetting claims', async () => {
  const api = loadCoordinator();
  const base = globalThis.SciLLM.createMemoryAnalysisCache();
  let writes = 0;
  const cacheStore = {
    getMany: (...args) => base.getMany(...args),
    setManyGuarded: (...args) => base.setManyGuarded(...args),
    async compareAndSetManyGuarded(values, guard) {
      if (values.some(value => value.checkpoint)) writes += 1;
      return base.compareAndSetManyGuarded(values, guard);
    }
  };
  const coordinator = api.createMechanismOperationCoordinator({ cacheStore });
  const oldRun = await coordinator.beginEvidenceFirstOperation(identity());
  await coordinator.claimProviderRequest(oldRun);
  const sameRun = await coordinator.beginEvidenceFirstOperation(identity());
  assert.strictEqual(sameRun, oldRun);
  assert.equal((await coordinator.claimProviderRequest(sameRun)).requestNumber, 2);
  await coordinator.commitCheckpoint(oldRun, checkpoint(api, oldRun));
  assert.equal(writes, 1);
});

test('durable resume preserves the original deadline and exhausted provider budget', async () => {
  const api = loadCoordinator();
  const cacheStore = globalThis.SciLLM.createMemoryAnalysisCache();
  let clock = 1_000;
  const firstCoordinator = api.createMechanismOperationCoordinator({ cacheStore, now: () => clock });
  const firstRun = await firstCoordinator.beginEvidenceFirstOperation(identity());
  for (let index = 0; index < 96; index += 1) {
    await firstCoordinator.claimProviderRequest(firstRun);
  }
  await firstCoordinator.commitCheckpoint(firstRun, checkpoint(api, firstRun));

  clock = 25_000;
  const restoredCoordinator = api.createMechanismOperationCoordinator({ cacheStore, now: () => clock });
  const restoredRun = await restoredCoordinator.beginEvidenceFirstOperation(identity());
  const resumed = await restoredCoordinator.resume(restoredRun);

  assert.equal(restoredRun.startedAt, firstRun.startedAt);
  assert.equal(restoredRun.deadlineAt, firstRun.deadlineAt);
  assert.equal(resumed.nextBatchIndex, 2);
  await assert.rejects(
    restoredCoordinator.claimProviderRequest(restoredRun),
    error => error.code === 'MECHANISM_PROVIDER_REQUEST_BUDGET_EXCEEDED'
  );
});

test('durable latest-run index keeps one epoch across coordinators', async () => {
  const api = loadCoordinator();
  const base = globalThis.SciLLM.createMemoryAnalysisCache();
  const cacheStore = {
    getMany: (...args) => base.getMany(...args),
    setManyGuarded: (...args) => base.setManyGuarded(...args),
    async compareAndSetManyGuarded(values, guard) {
      return base.compareAndSetManyGuarded(values, guard);
    }
  };
  let clock = 1_000;
  const firstCoordinator = api.createMechanismOperationCoordinator({ cacheStore, now: () => clock });
  const first = await firstCoordinator.beginEvidenceFirstOperation(identity());
  await firstCoordinator.claimProviderRequest(first);
  await firstCoordinator.commitCheckpoint(first, checkpoint(api, first, {
    nextBatchIndex: 1,
    payload: { generation: 1 }
  }));

  const staleCoordinator = api.createMechanismOperationCoordinator({ cacheStore, now: () => clock });
  const stale = await staleCoordinator.beginEvidenceFirstOperation(identity());
  assert.equal(stale.epoch, 1);

  clock = 2_000;
  const same = await firstCoordinator.beginEvidenceFirstOperation(identity());
  assert.strictEqual(same, first);
  assert.equal(same.startedAt, 1_000);
  await firstCoordinator.claimProviderRequest(same);
  await firstCoordinator.commitCheckpoint(same, checkpoint(api, same, {
    nextBatchIndex: 4,
    payload: { generation: 1, advanced: true }
  }));
  assert.equal((await staleCoordinator.claimProviderRequest(stale)).requestNumber, 3);

  const restartedCoordinator = api.createMechanismOperationCoordinator({
    cacheStore, now: () => clock
  });
  const restored = await restartedCoordinator.beginEvidenceFirstOperation(identity());
  assert.equal(restored.epoch, 1);
  assert.equal(restored.startedAt, first.startedAt);
  assert.equal((await restartedCoordinator.claimProviderRequest(restored)).requestNumber, 4);
  const resumed = await restartedCoordinator.resume(restored);
  assert.equal(resumed.nextBatchIndex, 4);
  assert.equal(resumed.payload.advanced, true);
});

test('concurrent duplicate begins attach to one durable epoch without replacement', async () => {
  const api = loadCoordinator();
  const cacheStore = globalThis.SciLLM.createMemoryAnalysisCache();
  const firstCoordinator = api.createMechanismOperationCoordinator({ cacheStore, now: () => 100 });
  const secondCoordinator = api.createMechanismOperationCoordinator({ cacheStore, now: () => 200 });
  await firstCoordinator.beginEvidenceFirstOperation(identity());
  await secondCoordinator.beginEvidenceFirstOperation(identity());

  const [first, second] = await Promise.all([
    firstCoordinator.beginEvidenceFirstOperation(identity()),
    secondCoordinator.beginEvidenceFirstOperation(identity())
  ]);
  assert.equal(first.epoch, 1);
  assert.equal(second.epoch, 1);
  assert.equal(first.startedAt, second.startedAt);
  const claims = await Promise.all([
    firstCoordinator.claimProviderRequest(first),
    secondCoordinator.claimProviderRequest(second)
  ]);
  assert.deepEqual(claims.map(item => item.requestNumber).sort((a, b) => a - b), [1, 2]);
});

test('normalized operation id rejects document identity drift without a replacement epoch', async () => {
  const api = loadCoordinator();
  const cacheStore = globalThis.SciLLM.createMemoryAnalysisCache();
  const firstCoordinator = api.createMechanismOperationCoordinator({ cacheStore });
  const first = await firstCoordinator.beginEvidenceFirstOperation(identity({
    operationId: 'mechanism:global-generation', documentId: 'doc-old'
  }));
  const replacementCoordinator = api.createMechanismOperationCoordinator({ cacheStore });
  await assert.rejects(replacementCoordinator.beginEvidenceFirstOperation(identity({
    operationId: 'mechanism:global-generation', documentId: 'doc-new'
  })), error => error.code === 'MECHANISM_OPERATION_STALE');
  assert.equal((await firstCoordinator.claimProviderRequest(first)).requestNumber, 1);
  const restarted = api.createMechanismOperationCoordinator({ cacheStore });
  const restored = await restarted.beginEvidenceFirstOperation(identity({
    operationId: 'mechanism:global-generation', documentId: 'doc-old'
  }));
  assert.equal(restored.epoch, first.epoch);
});

test('durable cancel is synchronously local and blocks a second coordinator after completion', async () => {
  const api = loadCoordinator();
  const cacheStore = globalThis.SciLLM.createMemoryAnalysisCache();
  const firstCoordinator = api.createMechanismOperationCoordinator({ cacheStore });
  const secondCoordinator = api.createMechanismOperationCoordinator({ cacheStore });
  const input = identity({ operationId: 'mechanism:durable-cancel' });
  const first = await firstCoordinator.beginEvidenceFirstOperation(input);
  const second = await secondCoordinator.beginEvidenceFirstOperation(input);
  const completion = firstCoordinator.control(first, 'cancel');
  assert.equal(first.signal.aborted, true);
  assert.equal(typeof completion?.then, 'function');
  const cancelled = await completion;
  assert.equal(cancelled.cancelled, true);

  await assert.rejects(
    secondCoordinator.claimProviderRequest(second),
    error => error.code === 'MECHANISM_OPERATION_CANCELLED'
  );
  await assert.rejects(
    secondCoordinator.commitCheckpoint(second, checkpoint(api, second)),
    error => error.code === 'MECHANISM_OPERATION_CANCELLED'
  );
  await assert.rejects(
    secondCoordinator.resume(second),
    error => error.code === 'MECHANISM_OPERATION_CANCELLED'
  );
});

test('cancel and release tombstones never mint another epoch for the same operation id', async () => {
  const api = loadCoordinator();
  const cacheStore = globalThis.SciLLM.createMemoryAnalysisCache();
  const cancelInput = identity({ operationId: 'mechanism:cancel-restart' });
  const firstCoordinator = api.createMechanismOperationCoordinator({ cacheStore });
  const cancelledRun = await firstCoordinator.beginEvidenceFirstOperation(cancelInput);
  await firstCoordinator.claimProviderRequest(cancelledRun);
  await firstCoordinator.commitCheckpoint(cancelledRun, checkpoint(api, cancelledRun));
  await firstCoordinator.control(cancelledRun, 'cancel');

  const restarted = api.createMechanismOperationCoordinator({ cacheStore });
  await assert.rejects(
    restarted.beginEvidenceFirstOperation(cancelInput),
    error => error.code === 'MECHANISM_OPERATION_CANCELLED'
  );

  const releaseInput = identity({ operationId: 'mechanism:release-restart' });
  const releasedRun = await firstCoordinator.beginEvidenceFirstOperation(releaseInput);
  await firstCoordinator.control(releasedRun, 'release');
  const releaseRestart = api.createMechanismOperationCoordinator({ cacheStore });
  await assert.rejects(
    releaseRestart.beginEvidenceFirstOperation(releaseInput),
    error => error.code === 'MECHANISM_OPERATION_FINALIZED'
  );
});

test('failed cancel and release terminal writes retain one exact retry intent', async () => {
  const api = loadCoordinator();
  for (const command of ['cancel', 'release']) {
    const base = globalThis.SciLLM.createMemoryAnalysisCache();
    let terminalCalls = 0;
    let releaseRetry;
    let markRetryStarted;
    const retryStarted = new Promise(resolve => { markRetryStarted = resolve; });
    const retryGate = new Promise(resolve => { releaseRetry = resolve; });
    const cacheStore = {
      getMany: (...args) => base.getMany(...args),
      setManyGuarded: (...args) => base.setManyGuarded(...args),
      async compareAndSetManyGuarded(values, guard) {
        const terminal = values.find(value => value.runIndex)?.runIndex?.terminal;
        if (terminal === (command === 'cancel' ? 'cancelled' : 'released')) {
          terminalCalls += 1;
          if (terminalCalls === 1) throw new Error('SECRET_TRANSIENT_TERMINAL');
          if (terminalCalls === 2) {
            markRetryStarted();
            await retryGate;
          }
        }
        return base.compareAndSetManyGuarded(values, guard);
      }
    };
    const coordinator = api.createMechanismOperationCoordinator({ cacheStore });
    const input = identity({ operationId: `mechanism:pending-${command}` });
    const operation = await coordinator.beginEvidenceFirstOperation(input);
    const first = coordinator.control(operation, command);
    assert.equal(operation.signal.aborted, true);
    await assert.rejects(
      first,
      error => error.code === 'MECHANISM_RUN_STATE_WRITE_FAILED' &&
        !error.message.includes('SECRET')
    );
    assert.equal(terminalCalls, 1);

    const retry = coordinator.control(operation, command);
    await retryStarted;
    const duplicate = coordinator.control(operation, command);
    assert.equal(duplicate, retry);
    releaseRetry();
    const [retried, duplicated] = await Promise.all([retry, duplicate]);
    assert.deepEqual(duplicated, retried);
    assert.equal(terminalCalls, 2);
    assert.equal(retried.cancelGeneration, 1);

    const restarted = api.createMechanismOperationCoordinator({ cacheStore });
    await assert.rejects(
      restarted.beginEvidenceFirstOperation(input),
      error => error.code === (command === 'cancel'
        ? 'MECHANISM_OPERATION_CANCELLED'
        : 'MECHANISM_OPERATION_FINALIZED')
    );
    assert.equal(terminalCalls, 2,
      'a committed terminal write remains sticky after its acknowledgement is lost');
  }
});

test('capacity admission reuses an inflight pending terminal without changing its intent', async () => {
  const api = loadCoordinator();
  const base = globalThis.SciLLM.createMemoryAnalysisCache();
  let cancelCalls = 0;
  let markRetryStarted;
  let releaseRetry;
  const retryStarted = new Promise(resolve => { markRetryStarted = resolve; });
  const retryGate = new Promise(resolve => { releaseRetry = resolve; });
  const cacheStore = {
    getMany: (...args) => base.getMany(...args),
    setManyGuarded: (...args) => base.setManyGuarded(...args),
    async compareAndSetManyGuarded(values, guard) {
      const terminal = values.find(value => value.runIndex)?.runIndex?.terminal;
      if (terminal === 'cancelled') {
        cancelCalls += 1;
        if (cancelCalls === 1) throw new Error('SECRET_PENDING_CAPACITY');
        if (cancelCalls === 2) {
          markRetryStarted();
          await retryGate;
        }
      }
      return base.compareAndSetManyGuarded(values, guard);
    }
  };
  const coordinator = api.createMechanismOperationCoordinator({ cacheStore });
  let pending;
  let victim;
  for (let index = 0; index < api.MAX_ACTIVE_MECHANISM_CONTEXTS; index += 1) {
    const operation = await coordinator.beginEvidenceFirstOperation(identity({
      operationId: `mechanism:pending-capacity-${index}`,
      documentId: `pending-capacity-doc-${index}`,
      workspaceId: `pending-capacity-workspace-${index}`
    }));
    if (index === 0) pending = operation;
    if (index === 1) victim = operation;
  }
  await assert.rejects(coordinator.control(pending, 'cancel'));
  const retry = coordinator.control(pending, 'cancel');
  await retryStarted;
  const admission = coordinator.beginEvidenceFirstOperation(identity({
    operationId: 'mechanism:pending-capacity-admitted',
    documentId: 'pending-capacity-admitted', workspaceId: 'pending-capacity-admitted'
  }));
  await Promise.resolve();
  releaseRetry();
  const [admitted, cancelled] = await Promise.all([admission, retry]);
  assert.equal(victim.signal.aborted, false);
  assert.equal(coordinator.assertActive(admitted), admitted);
  assert.equal(cancelled.cancelled, true);
  assert.equal(cancelCalls, 2);
});

test('capacity stays closed until the exact failed terminal intent is retried', async () => {
  const api = loadCoordinator();
  const base = globalThis.SciLLM.createMemoryAnalysisCache();
  let terminalCalls = 0;
  let markCapacityStarted;
  let releaseCapacity;
  const capacityStarted = new Promise(resolve => { markCapacityStarted = resolve; });
  const capacityGate = new Promise(resolve => { releaseCapacity = resolve; });
  const cacheStore = {
    getMany: (...args) => base.getMany(...args),
    setManyGuarded: (...args) => base.setManyGuarded(...args),
    async compareAndSetManyGuarded(values, guard) {
      const terminal = values.find(value => value.runIndex)?.runIndex?.terminal;
      if (terminal === 'cancelled') {
        terminalCalls += 1;
        if (terminalCalls === 1) throw new Error('SECRET_PENDING_REVERSE');
        if (terminalCalls === 2) {
          markCapacityStarted();
          await capacityGate;
        }
      }
      return base.compareAndSetManyGuarded(values, guard);
    }
  };
  const coordinator = api.createMechanismOperationCoordinator({ cacheStore });
  let pending;
  for (let index = 0; index < api.MAX_ACTIVE_MECHANISM_CONTEXTS; index += 1) {
    const operation = await coordinator.beginEvidenceFirstOperation(identity({
      operationId: `mechanism:pending-reverse-${index}`,
      documentId: `pending-reverse-doc-${index}`,
      workspaceId: `pending-reverse-workspace-${index}`
    }));
    if (index === 0) pending = operation;
  }
  await assert.rejects(coordinator.control(pending, 'cancel'));
  const admissionInput = identity({
    operationId: 'mechanism:pending-reverse-admitted',
    documentId: 'pending-reverse-admitted', workspaceId: 'pending-reverse-admitted'
  });
  await assert.rejects(
    coordinator.beginEvidenceFirstOperation(admissionInput),
    error => error?.code === 'MECHANISM_OPERATION_CAPACITY_EXCEEDED'
  );
  assert.equal(terminalCalls, 1);
  const retry = coordinator.control(pending, 'cancel');
  await capacityStarted;
  const callsBeforeRelease = terminalCalls;
  releaseCapacity();
  const retryResult = await retry;
  const admissionResult = await coordinator.beginEvidenceFirstOperation(admissionInput);

  assert.equal(callsBeforeRelease, 2);
  assert.equal(terminalCalls, 2);
  assert.equal(retryResult.cancelled, true);
  assert.equal(coordinator.assertActive(admissionResult), admissionResult);
});

test('durable cancel wins against inflight provider and checkpoint CAS writes', async () => {
  const api = loadCoordinator();
  const base = globalThis.SciLLM.createMemoryAnalysisCache();
  let gateKind = '';
  let releaseGate;
  let markStarted;
  let started = new Promise(resolve => { markStarted = resolve; });
  let gate = new Promise(resolve => { releaseGate = resolve; });
  const cacheStore = {
    getMany: (...args) => base.getMany(...args),
    setManyGuarded: (...args) => base.setManyGuarded(...args),
    async compareAndSetManyGuarded(values, guard) {
      const isClaim = values.some(value => value.runState?.providerRequestsClaimed === 1);
      const isCheckpoint = values.some(value => value.checkpoint);
      if ((gateKind === 'claim' && isClaim) || (gateKind === 'checkpoint' && isCheckpoint)) {
        markStarted();
        await gate;
      }
      return base.compareAndSetManyGuarded(values, guard);
    }
  };

  const runRace = async (operationId, kind) => {
    const firstCoordinator = api.createMechanismOperationCoordinator({ cacheStore });
    const secondCoordinator = api.createMechanismOperationCoordinator({ cacheStore });
    const input = identity({ operationId });
    const first = await firstCoordinator.beginEvidenceFirstOperation(input);
    const second = await secondCoordinator.beginEvidenceFirstOperation(input);
    gateKind = kind;
    started = new Promise(resolve => { markStarted = resolve; });
    gate = new Promise(resolve => { releaseGate = resolve; });
    const inflight = kind === 'claim'
      ? secondCoordinator.claimProviderRequest(second)
      : secondCoordinator.commitCheckpoint(second, checkpoint(api, second));
    await started;
    await firstCoordinator.control(first, 'cancel');
    releaseGate();
    await assert.rejects(
      inflight,
      error => error.code === 'MECHANISM_OPERATION_CANCELLED'
    );
    gateKind = '';
    const restarted = api.createMechanismOperationCoordinator({ cacheStore });
    await assert.rejects(
      restarted.beginEvidenceFirstOperation(input),
      error => error.code === 'MECHANISM_OPERATION_CANCELLED'
    );
    const durable = await restarted.status(input.operationId);
    assert.equal(durable.status, 'cancelled');
    assert.equal(durable.epoch, first.epoch);
  };

  await runRace('mechanism:cancel-claim-race', 'claim');
  await runRace('mechanism:cancel-checkpoint-race', 'checkpoint');
});

test('concurrent coordinators atomically reserve distinct provider request numbers', async () => {
  const api = loadCoordinator();
  const cacheStore = globalThis.SciLLM.createMemoryAnalysisCache();
  const firstCoordinator = api.createMechanismOperationCoordinator({ cacheStore, now: () => 1_000 });
  const secondCoordinator = api.createMechanismOperationCoordinator({ cacheStore, now: () => 1_000 });
  const [firstRun, secondRun] = await Promise.all([
    firstCoordinator.beginEvidenceFirstOperation(identity()),
    secondCoordinator.beginEvidenceFirstOperation(identity())
  ]);
  const claims = await Promise.all([
    firstCoordinator.claimProviderRequest(firstRun),
    secondCoordinator.claimProviderRequest(secondRun)
  ]);
  assert.deepEqual(claims.map(item => item.requestNumber).sort((a, b) => a - b), [1, 2]);
});

test('provider claim never returns before its durable reservation and maps write failure safely', async () => {
  const api = loadCoordinator();
  const base = globalThis.SciLLM.createMemoryAnalysisCache();
  let failReservations = false;
  let durableReservations = 0;
  const cacheStore = {
    getMany: (...args) => base.getMany(...args),
    setManyGuarded: (...args) => base.setManyGuarded(...args),
    async compareAndSetManyGuarded(values, guard) {
      if (failReservations) throw new Error('secret durable write');
      const result = await base.compareAndSetManyGuarded(values, guard);
      if (result.applied && values.some(value => value.runState?.providerRequestsClaimed === 1)) {
        durableReservations += 1;
      }
      return result;
    }
  };
  const coordinator = api.createMechanismOperationCoordinator({ cacheStore });
  const operation = await coordinator.beginEvidenceFirstOperation(identity());
  const claim = await coordinator.claimProviderRequest(operation);
  assert.equal(claim.requestNumber, 1);
  assert.equal(durableReservations, 1);

  failReservations = true;
  await assert.rejects(
    coordinator.claimProviderRequest(operation),
    error => error.code === 'MECHANISM_RUN_STATE_WRITE_FAILED' &&
      !error.message.includes('secret')
  );
});

test('provider claim remains pending until the durable CAS completes', async () => {
  const api = loadCoordinator();
  const base = globalThis.SciLLM.createMemoryAnalysisCache();
  let releaseReservation;
  let markReservationStarted;
  const reservationStarted = new Promise(resolve => { markReservationStarted = resolve; });
  const reservationGate = new Promise(resolve => { releaseReservation = resolve; });
  const cacheStore = {
    getMany: (...args) => base.getMany(...args),
    setManyGuarded: (...args) => base.setManyGuarded(...args),
    async compareAndSetManyGuarded(values, guard) {
      if (values.some(value => value.runState?.providerRequestsClaimed === 1)) {
        markReservationStarted();
        await reservationGate;
      }
      return base.compareAndSetManyGuarded(values, guard);
    }
  };
  const coordinator = api.createMechanismOperationCoordinator({ cacheStore });
  const operation = await coordinator.beginEvidenceFirstOperation(identity());
  let settled = false;
  const pending = coordinator.claimProviderRequest(operation).finally(() => { settled = true; });
  await reservationStarted;
  await Promise.resolve();
  assert.equal(settled, false);
  releaseReservation();
  const claim = await pending;
  assert.equal(claim.requestNumber, 1);
  assert.equal(settled, true);
});

test('coordinator never executes accessors on a CAS receipt', async () => {
  const api = loadCoordinator();
  const base = globalThis.SciLLM.createMemoryAnalysisCache();
  let appliedGetterCalls = 0;
  const appliedAccessorStore = {
    getMany: (...args) => base.getMany(...args),
    compareAndSetManyGuarded: async () => {
      const receipt = { revision: 0, currentValue: null, terminalCode: null };
      Object.defineProperty(receipt, 'applied', {
        enumerable: true,
        get() { appliedGetterCalls += 1; throw new Error('SECRET applied accessor'); }
      });
      return receipt;
    }
  };
  await assert.rejects(
    api.createMechanismOperationCoordinator({ cacheStore: appliedAccessorStore })
      .beginEvidenceFirstOperation(identity()),
    error => error.code === 'MECHANISM_RUN_STATE_WRITE_FAILED' &&
      !error.message.includes('SECRET')
  );
  assert.equal(appliedGetterCalls, 0);

  let currentGetterCalls = 0;
  const currentAccessorStore = {
    getMany: async () => new Map(),
    compareAndSetManyGuarded: async () => {
      const receipt = { applied: false, revision: 0, terminalCode: null };
      Object.defineProperty(receipt, 'currentValue', {
        enumerable: true,
        get() { currentGetterCalls += 1; throw new Error('SECRET current accessor'); }
      });
      return receipt;
    }
  };
  await assert.rejects(
    api.createMechanismOperationCoordinator({ cacheStore: currentAccessorStore })
      .beginEvidenceFirstOperation(identity({ operationId: 'mechanism:receipt-current' })),
    error => error.code === 'MECHANISM_RUN_STATE_WRITE_FAILED' &&
      !error.message.includes('SECRET')
  );
  assert.equal(currentGetterCalls, 0);
});

test('a post-commit deadline reports a committed reservation and never reuses its number', async () => {
  const api = loadCoordinator();
  const base = globalThis.SciLLM.createMemoryAnalysisCache();
  let clock = 1_000;
  let crossDeadline = false;
  const cacheStore = {
    getMany: (...args) => base.getMany(...args),
    setManyGuarded: (...args) => base.setManyGuarded(...args),
    async compareAndSetManyGuarded(values, guard) {
      const result = await base.compareAndSetManyGuarded(values, guard);
      if (crossDeadline && result.applied &&
          values.some(value => value.runState?.providerRequestsClaimed === 1)) {
        clock = 1_000 + 20 * 60 * 1_000;
      }
      return result;
    }
  };
  const coordinator = api.createMechanismOperationCoordinator({ cacheStore, now: () => clock });
  const operation = await coordinator.beginEvidenceFirstOperation(identity({
    operationId: 'mechanism:postcommit-deadline'
  }));
  crossDeadline = true;
  await assert.rejects(
    coordinator.claimProviderRequest(operation),
    error => error.code === 'MECHANISM_OPERATION_DEADLINE_EXCEEDED' &&
      error.committed === true && error.requestNumber === 1
  );
  await assert.rejects(
    coordinator.claimProviderRequest(operation),
    error => error.code === 'MECHANISM_OPERATION_DEADLINE_EXCEEDED'
  );
  clock = 1_001;
  assert.equal((await coordinator.claimProviderRequest(operation)).requestNumber, 2);

  const unexpectedBase = globalThis.SciLLM.createMemoryAnalysisCache();
  const unexpectedStore = {
    getMany: (...args) => unexpectedBase.getMany(...args),
    setManyGuarded: (...args) => unexpectedBase.setManyGuarded(...args),
    async compareAndSetManyGuarded(values, guard) {
      const result = await unexpectedBase.compareAndSetManyGuarded(values, guard);
      if (result.applied &&
          values.some(value => value.runState?.providerRequestsClaimed === 1)) {
        return Object.freeze({ ...result, terminalCode: 'CACHE_GUARD_WRITE_FAILED' });
      }
      return result;
    }
  };
  const unexpectedCoordinator = api.createMechanismOperationCoordinator({
    cacheStore: unexpectedStore
  });
  const unexpectedOperation = await unexpectedCoordinator.beginEvidenceFirstOperation(identity({
    operationId: 'mechanism:postcommit-unexpected'
  }));
  await assert.rejects(
    unexpectedCoordinator.claimProviderRequest(unexpectedOperation),
    error => error.code === 'MECHANISM_RUN_STATE_WRITE_FAILED' &&
      error.committed === true && error.requestNumber === 1
  );
  assert.equal(
    (await unexpectedCoordinator.claimProviderRequest(unexpectedOperation)).requestNumber,
    2
  );
});

test('a committed begin deadline can rebind the exact durable epoch in the same coordinator', async () => {
  const api = loadCoordinator();
  const base = globalThis.SciLLM.createMemoryAnalysisCache();
  let clock = 0;
  let expireAfterInstall = true;
  const operationId = 'mechanism:begin-postcommit-deadline';
  const cacheStore = {
    getMany: (...args) => base.getMany(...args),
    setManyGuarded: (...args) => base.setManyGuarded(...args),
    async compareAndSetManyGuarded(values, guard) {
      const result = await base.compareAndSetManyGuarded(values, guard);
      const runIndex = values.find(value => value.runIndex)?.runIndex;
      if (expireAfterInstall && runIndex?.identity?.operationId === operationId &&
          runIndex.terminal === 'active' && runIndex.revision === 0) {
        expireAfterInstall = false;
        clock = api.OPERATION_DEADLINE_MS;
      }
      return result;
    }
  };
  const coordinator = api.createMechanismOperationCoordinator({ cacheStore, now: () => clock });
  const input = identity({ operationId });

  await assert.rejects(
    coordinator.beginEvidenceFirstOperation(input),
    error => error.code === 'MECHANISM_OPERATION_DEADLINE_EXCEEDED' &&
      error.committed === true
  );
  clock = 0;
  const rebound = await coordinator.beginEvidenceFirstOperation(input);
  assert.equal(rebound.epoch, 1);
  const fresh = api.createMechanismOperationCoordinator({ cacheStore, now: () => clock });
  const restored = await fresh.beginEvidenceFirstOperation(input);
  assert.equal(restored.epoch, rebound.epoch);
});

test('a duplicate begin cannot mint a replacement epoch after the first durable install', async () => {
  const api = loadCoordinator();
  const base = globalThis.SciLLM.createMemoryAnalysisCache();
  const operationId = 'mechanism:replacement-postcommit-deadline';
  let installs = 0;
  const cacheStore = {
    getMany: (...args) => base.getMany(...args),
    setManyGuarded: (...args) => base.setManyGuarded(...args),
    async compareAndSetManyGuarded(values, guard) {
      const result = await base.compareAndSetManyGuarded(values, guard);
      const runIndex = values.find(value => value.runIndex)?.runIndex;
      if (result.applied && runIndex?.identity?.operationId === operationId &&
          runIndex.revision === 0) installs += 1;
      return result;
    }
  };
  const coordinator = api.createMechanismOperationCoordinator({ cacheStore });
  const input = identity({ operationId });
  const first = await coordinator.beginEvidenceFirstOperation(input);
  const duplicate = await coordinator.beginEvidenceFirstOperation(input);
  assert.strictEqual(duplicate, first);
  assert.equal(first.epoch, 1);
  assert.equal(installs, 1);
  await assert.rejects(
    coordinator.beginEvidenceFirstOperation({ ...input, documentHash: 'drifted-document' }),
    error => error.code === 'MECHANISM_OPERATION_STALE'
  );
  const fresh = api.createMechanismOperationCoordinator({ cacheStore });
  const restored = await fresh.beginEvidenceFirstOperation(input);
  assert.equal(restored.epoch, first.epoch);
  assert.equal(installs, 1);
});

test('a precommit failure with a custom registry cannot revive its provisional token', async () => {
  const api = loadCoordinator();
  const authority = Object.freeze({});
  const operationRegistry = globalThis.SciLLM.createOperationRegistry({
    durableRestoreAuthority: authority
  });
  const base = globalThis.SciLLM.createMemoryAnalysisCache();
  let failInstall = true;
  const cacheStore = {
    getMany: (...args) => base.getMany(...args),
    setManyGuarded: (...args) => base.setManyGuarded(...args),
    async compareAndSetManyGuarded(values, guard) {
      if (failInstall) {
        failInstall = false;
        throw new Error('SECRET_PROVISIONAL_INSTALL');
      }
      return base.compareAndSetManyGuarded(values, guard);
    }
  };
  const coordinator = api.createMechanismOperationCoordinator({
    cacheStore,
    operationRegistry,
    operationRegistryDurableRestoreAuthority: authority
  });
  const input = identity({ operationId: 'mechanism:custom-provisional-retry' });

  await assert.rejects(
    coordinator.beginEvidenceFirstOperation(input),
    error => error.code === 'MECHANISM_RUN_STATE_WRITE_FAILED' &&
      !error.message.includes('SECRET')
  );
  const retry = await coordinator.beginEvidenceFirstOperation(input);
  assert.equal(retry.epoch, 2);
  assert.equal(coordinator.assertActive(retry), retry);
});

test('a failed provisional begin cannot replace the first durable same-id identity', async () => {
  const api = loadCoordinator();
  const authority = Object.freeze({});
  const operationRegistry = globalThis.SciLLM.createOperationRegistry({
    durableRestoreAuthority: authority
  });
  const base = globalThis.SciLLM.createMemoryAnalysisCache();
  let failFirstInstall = true;
  const cacheStore = {
    getMany: (...args) => base.getMany(...args),
    setManyGuarded: (...args) => base.setManyGuarded(...args),
    async compareAndSetManyGuarded(values, guard) {
      if (failFirstInstall) {
        failFirstInstall = false;
        throw new Error('SECRET_FALLBACK_FLOOR');
      }
      return base.compareAndSetManyGuarded(values, guard);
    }
  };
  const operationId = 'mechanism:fallback-monotonic';
  const firstIdentity = identity({ operationId });
  const first = api.createMechanismOperationCoordinator({
    cacheStore,
    operationRegistry,
    operationRegistryDurableRestoreAuthority: authority
  });
  await assert.rejects(
    first.beginEvidenceFirstOperation(firstIdentity),
    error => error.code === 'MECHANISM_RUN_STATE_WRITE_FAILED' &&
      !error.message.includes('SECRET')
  );

  const peer = api.createMechanismOperationCoordinator({ cacheStore });
  const peerInput = identity({
    operationId,
    documentId: 'fallback-peer-doc-1',
    documentHash: 'fallback-peer-hash-1',
    workspaceId: 'fallback-peer-workspace-1'
  });
  const peerFirst = await peer.beginEvidenceFirstOperation(peerInput);
  assert.equal(peerFirst.epoch, 1);
  await assert.rejects(
    first.beginEvidenceFirstOperation(firstIdentity),
    error => error.code === 'MECHANISM_OPERATION_STALE'
  );
  const fresh = api.createMechanismOperationCoordinator({ cacheStore });
  const restored = await fresh.beginEvidenceFirstOperation(peerInput);
  assert.equal(restored.epoch, peerFirst.epoch);
  assert.equal((await peer.claimProviderRequest(peerFirst)).requestNumber, 1);
});

test('a duplicate local begin returns the same handle and cannot ABA-replace it', async () => {
  const api = loadCoordinator();
  const coordinator = api.createMechanismOperationCoordinator();
  const oldRun = await coordinator.beginEvidenceFirstOperation(identity());
  const duplicate = await coordinator.beginEvidenceFirstOperation(identity());
  assert.strictEqual(duplicate, oldRun);
  const claim = await coordinator.claimProviderRequest(oldRun);
  assert.equal(claim.requestNumber, 1);
});

test('cancel and release preserve sticky terminal semantics for one operation id', async () => {
  const api = loadCoordinator();
  const coordinator = api.createMechanismOperationCoordinator();
  const input = identity({ operationId: 'mechanism:control-rollover' });
  const first = await coordinator.beginEvidenceFirstOperation(input);
  await coordinator.control(first, 'release');
  await assert.rejects(
    coordinator.beginEvidenceFirstOperation(input),
    error => error.code === 'MECHANISM_OPERATION_FINALIZED'
  );
  const cancelInput = identity({ operationId: 'mechanism:control-cancel-sticky' });
  const cancelled = await coordinator.beginEvidenceFirstOperation(cancelInput);
  await coordinator.control(cancelled, 'cancel');
  await assert.rejects(
    coordinator.beginEvidenceFirstOperation(cancelInput),
    error => error.code === 'MECHANISM_OPERATION_CANCELLED'
  );
});

test('coordinator capacity never evicts authority and exact release admits a new id', async () => {
  const api = loadCoordinator();
  assert.equal(api.MAX_ACTIVE_MECHANISM_CONTEXTS, 128);
  const cacheStore = globalThis.SciLLM.createMemoryAnalysisCache();
  const coordinator = api.createMechanismOperationCoordinator({ cacheStore });
  const handles = [];
  const inputs = [];
  for (let index = 0; index < api.MAX_ACTIVE_MECHANISM_CONTEXTS; index += 1) {
    const input = identity({
      operationId: `mechanism:bounded-${index}`,
      documentId: `doc-${index}`,
      workspaceId: `workspace-${index}`
    });
    inputs.push(input);
    handles.push(await coordinator.beginEvidenceFirstOperation(input));
  }
  await assert.rejects(
    coordinator.beginEvidenceFirstOperation(identity({
      operationId: 'mechanism:bounded-overflow',
      documentId: 'bounded-overflow-doc', workspaceId: 'bounded-overflow-workspace'
    })),
    error => error.code === 'MECHANISM_OPERATION_CAPACITY_EXCEEDED'
  );
  assert.equal(coordinator.assertActive(handles[0]), handles[0]);
  const released = await coordinator.control(handles.at(-1), 'release');
  assert.equal(released.active, false);
  assert.equal(released.released, true);
  assert.equal(released.compacted, true);
  const admitted = await coordinator.beginEvidenceFirstOperation(identity({
    operationId: 'mechanism:bounded-admitted',
    documentId: 'bounded-admitted-doc', workspaceId: 'bounded-admitted-workspace'
  }));
  assert.equal(coordinator.assertActive(admitted), admitted);
  const restarted = api.createMechanismOperationCoordinator({ cacheStore });
  await assert.rejects(
    restarted.beginEvidenceFirstOperation(inputs.at(-1)),
    error => error.code === 'MECHANISM_OPERATION_FINALIZED'
  );
  const restoredFirst = await restarted.beginEvidenceFirstOperation(inputs[0]);
  assert.equal(restoredFirst.epoch, handles[0].epoch);
});

test('durable active capacity rejects the 129th run without retiring a claimed receipt', async () => {
  const api = loadCoordinator();
  const cacheStore = globalThis.SciLLM.createMemoryAnalysisCache();
  const firstCoordinator = api.createMechanismOperationCoordinator({ cacheStore });
  const firstInput = identity({
    operationId: 'mechanism:durable-capacity-first',
    documentId: 'durable-capacity-first-document',
    workspaceId: 'durable-capacity-first-workspace'
  });
  const first = await firstCoordinator.beginEvidenceFirstOperation(firstInput);
  const receipt = {
    receipt: 'a'.repeat(64),
    bindingDigest: 'b'.repeat(64)
  };
  await firstCoordinator.claimProviderRequest(first, receipt);
  for (let index = 1; index < api.MAX_ACTIVE_MECHANISM_CONTEXTS; index += 1) {
    const coordinator = api.createMechanismOperationCoordinator({ cacheStore });
    await coordinator.beginEvidenceFirstOperation(identity({
      operationId: `mechanism:durable-capacity-${index}`,
      documentId: `durable-capacity-document-${index}`,
      workspaceId: `durable-capacity-workspace-${index}`
    }));
  }

  const restarted = api.createMechanismOperationCoordinator({ cacheStore });
  await assert.rejects(
    restarted.beginEvidenceFirstOperation(identity({
      operationId: 'mechanism:durable-capacity-overflow',
      documentId: 'durable-capacity-overflow-document',
      workspaceId: 'durable-capacity-overflow-workspace'
    })),
    error => error.code === 'MECHANISM_OPERATION_CAPACITY_EXCEEDED'
  );

  const restored = await restarted.beginEvidenceFirstOperation(firstInput);
  assert.equal(restored.epoch, first.epoch);
  await assert.rejects(
    restarted.claimProviderRequest(restored, receipt),
    error => error.code === 'MECHANISM_PROVIDER_RECEIPT_AMBIGUOUS'
  );
});

test('provider claims atomically reserve checkpoint bytes before consuming a receipt', async () => {
  const api = loadCoordinator();
  assert.equal(api.MECHANISM_PROTECTED_BYTES_RESERVATION, 24 * 1024 * 1024);
  const cacheStore = globalThis.SciLLM.createMemoryAnalysisCache();
  const coordinator = api.createMechanismOperationCoordinator({ cacheStore });
  const operations = [];
  for (let index = 0; index < 11; index += 1) {
    operations.push(await coordinator.beginEvidenceFirstOperation(identity({
      operationId: `mechanism:byte-reservation-${index}`,
      documentId: `byte-reservation-document-${index}`,
      workspaceId: `byte-reservation-workspace-${index}`
    })));
  }
  for (let index = 0; index < 9; index += 1) {
    assert.equal((await coordinator.claimProviderRequest(operations[index])).requestNumber, 1);
  }
  const concurrent = await Promise.allSettled([
    coordinator.claimProviderRequest(operations[9]),
    coordinator.claimProviderRequest(operations[10])
  ]);
  assert.equal(concurrent.filter(result => result.status === 'fulfilled').length, 1);
  const rejectedIndex = concurrent.findIndex(result => result.status === 'rejected');
  assert.equal(concurrent[rejectedIndex].reason.code, 'MECHANISM_OPERATION_CAPACITY_EXCEEDED');
  await coordinator.control(operations[0], 'release');
  const retried = await coordinator.claimProviderRequest(operations[9 + rejectedIndex]);
  assert.equal(retried.requestNumber, 1,
    'a failed byte reservation consumes neither a claim nor a receipt');
});

test('one empty-store run can persist a legal near-strong-limit UTF-8 checkpoint', async () => {
  const api = loadCoordinator();
  const cacheStore = globalThis.SciLLM.createMemoryAnalysisCache();
  const coordinator = api.createMechanismOperationCoordinator({ cacheStore });
  const operation = await coordinator.beginEvidenceFirstOperation(identity({
    operationId: 'mechanism:near-strong-checkpoint-limit'
  }));
  const receipt = 'c'.repeat(64);
  await coordinator.claimProviderRequest(operation, {
    receipt, bindingDigest: 'd'.repeat(64)
  });
  const result = await coordinator.commitCheckpoint(operation, checkpoint(api, operation, {
    phase: 'panel_census', nextBatchIndex: 0,
    providerReceiptIds: [receipt],
    payload: { chunks: Array.from({ length: 6 }, () => '界'.repeat(900_000)) }
  }));
  assert.equal(result.providerRequestsClaimed, 1);
  const restored = await coordinator.resume(operation);
  assert.equal(restored.payload.chunks.length, 6);
  assert.equal(restored.payload.chunks[0].length, 900_000);
});

test('concurrent begin finalization admits at most one remaining durable slot', async () => {
  const api = loadCoordinator();
  const cacheStore = globalThis.SciLLM.createMemoryAnalysisCache();
  const coordinator = api.createMechanismOperationCoordinator({ cacheStore });
  for (let index = 0; index < api.MAX_ACTIVE_MECHANISM_CONTEXTS - 1; index += 1) {
    await coordinator.beginEvidenceFirstOperation(identity({
      operationId: `mechanism:finalize-prefill-${index}`,
      documentId: `finalize-doc-${index}`,
      workspaceId: `finalize-workspace-${index}`
    }));
  }
  const results = await Promise.allSettled([
    coordinator.beginEvidenceFirstOperation(identity({
      operationId: 'mechanism:finalize-a', documentId: 'final-a', workspaceId: 'final-a'
    })),
    coordinator.beginEvidenceFirstOperation(identity({
      operationId: 'mechanism:finalize-b', documentId: 'final-b', workspaceId: 'final-b'
    }))
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const rejected = results.find(result => result.status === 'rejected');
  assert.equal(rejected.reason.code, 'MECHANISM_OPERATION_CAPACITY_EXCEEDED');
});

test('capacity rejection performs zero overflow installs and preserves every active run', async () => {
  const api = loadCoordinator();
  const base = globalThis.SciLLM.createMemoryAnalysisCache();
  const oldestId = 'mechanism:capacity-failure-oldest';
  const overflowId = 'mechanism:capacity-failure-new';
  let overflowInstalls = 0;
  const cacheStore = {
    getMany: (...args) => base.getMany(...args),
    setManyGuarded: (...args) => base.setManyGuarded(...args),
    async compareAndSetManyGuarded(values, guard) {
      const runIndex = values.find(value => value.runIndex)?.runIndex;
      if (runIndex?.identity?.operationId === overflowId &&
          runIndex.terminal === 'active' && runIndex.revision === 0) {
        overflowInstalls += 1;
      }
      return base.compareAndSetManyGuarded(values, guard);
    }
  };
  const coordinator = api.createMechanismOperationCoordinator({ cacheStore });
  let oldest;
  let oldestInput;
  for (let index = 0; index < api.MAX_ACTIVE_MECHANISM_CONTEXTS; index += 1) {
    const input = identity({
      operationId: index === 0 ? oldestId : `mechanism:capacity-prefill-${index}`,
      documentId: `capacity-doc-${index}`,
      workspaceId: `capacity-workspace-${index}`
    });
    const operation = await coordinator.beginEvidenceFirstOperation(input);
    if (index === 0) {
      oldest = operation;
      oldestInput = input;
    }
  }
  const overflowInput = identity({
    operationId: overflowId, documentId: 'capacity-new', workspaceId: 'capacity-new'
  });

  await assert.rejects(
    coordinator.beginEvidenceFirstOperation(overflowInput),
    error => error.code === 'MECHANISM_OPERATION_CAPACITY_EXCEEDED'
  );
  assert.equal(overflowInstalls, 0);
  assert.equal(oldest.signal.aborted, false);
  assert.equal(coordinator.assertActive(oldest), oldest);
  const peer = api.createMechanismOperationCoordinator({ cacheStore });
  const durableOldest = await peer.beginEvidenceFirstOperation(oldestInput);
  assert.equal(durableOldest.epoch, oldest.epoch);

  await coordinator.control(oldest, 'release');
  const retry = await coordinator.beginEvidenceFirstOperation(overflowInput);
  assert.equal(retry.epoch, 1);
  assert.equal(overflowInstalls, 1);
  await assert.rejects(
    peer.beginEvidenceFirstOperation(oldestInput),
    error => error.code === 'MECHANISM_OPERATION_FINALIZED'
  );
});

test('capacity reaps only a remotely cancelled local context and preserves its tombstone', async () => {
  const api = loadCoordinator();
  const cacheStore = globalThis.SciLLM.createMemoryAnalysisCache();
  const local = api.createMechanismOperationCoordinator({ cacheStore });
  let oldest;
  let oldestInput;
  for (let index = 0; index < api.MAX_ACTIVE_MECHANISM_CONTEXTS; index += 1) {
    const input = identity({
      operationId: `mechanism:remote-cancel-${index}`,
      documentId: `remote-cancel-doc-${index}`,
      workspaceId: `remote-cancel-workspace-${index}`
    });
    const operation = await local.beginEvidenceFirstOperation(input);
    if (index === 0) { oldest = operation; oldestInput = input; }
  }
  const remote = api.createMechanismOperationCoordinator({ cacheStore });
  const remoteHandle = await remote.beginEvidenceFirstOperation(oldestInput);
  await remote.control(remoteHandle, 'cancel');
  const admitted = await local.beginEvidenceFirstOperation(identity({
    operationId: 'mechanism:remote-cancel-admitted',
    documentId: 'remote-cancel-admitted', workspaceId: 'remote-cancel-admitted'
  }));
  assert.equal(oldest.signal.aborted, true);
  assert.equal(local.assertActive(admitted), admitted);
  await assert.rejects(
    local.beginEvidenceFirstOperation(oldestInput),
    error => error.code === 'MECHANISM_OPERATION_CANCELLED'
  );
});

test('a failed terminal write does not free capacity until that exact control retries', async () => {
  const api = loadCoordinator();
  const base = globalThis.SciLLM.createMemoryAnalysisCache();
  let failFirstCancel = true;
  const cacheStore = {
    getMany: (...args) => base.getMany(...args),
    setManyGuarded: (...args) => base.setManyGuarded(...args),
    async compareAndSetManyAndDeleteGuarded(values, deleteKeys, guard) {
      const terminal = values.find(value => value.runIndex)?.runIndex?.terminal;
      if (terminal === 'cancelled' && failFirstCancel) {
        failFirstCancel = false;
        throw new Error('SECRET_CANCEL_GENERATION');
      }
      return base.compareAndSetManyAndDeleteGuarded(values, deleteKeys, guard);
    },
    async compareAndSetManyGuarded(values, guard) {
      const terminal = values.find(value => value.runIndex)?.runIndex?.terminal;
      if (terminal === 'cancelled' && failFirstCancel) {
        failFirstCancel = false;
        throw new Error('SECRET_CANCEL_GENERATION');
      }
      return base.compareAndSetManyGuarded(values, guard);
    }
  };
  const coordinator = api.createMechanismOperationCoordinator({ cacheStore });
  let pending;
  let pendingInput;
  for (let index = 0; index < api.MAX_ACTIVE_MECHANISM_CONTEXTS; index += 1) {
    const input = identity({
      operationId: `mechanism:generation-pending-${index}`,
      documentId: `generation-doc-${index}`,
      workspaceId: `generation-workspace-${index}`
    });
    const operation = await coordinator.beginEvidenceFirstOperation(input);
    if (index === 0) { pending = operation; pendingInput = input; }
  }
  await assert.rejects(
    coordinator.control(pending, 'cancel'),
    error => error.code === 'MECHANISM_RUN_STATE_WRITE_FAILED'
  );
  const admittedInput = identity({
    operationId: 'mechanism:generation-admitted',
    documentId: 'generation-admitted', workspaceId: 'generation-admitted'
  });
  await assert.rejects(
    coordinator.beginEvidenceFirstOperation(admittedInput),
    error => error.code === 'MECHANISM_OPERATION_CAPACITY_EXCEEDED'
  );
  await coordinator.control(pending, 'cancel');
  const admitted = await coordinator.beginEvidenceFirstOperation(admittedInput);
  assert.equal(coordinator.assertActive(admitted), admitted);
  await assert.rejects(
    coordinator.beginEvidenceFirstOperation(pendingInput),
    error => error.code === 'MECHANISM_OPERATION_CANCELLED'
  );
});

test('concurrent duplicate begins reuse one full-capacity slot and never replace identity', async () => {
  const api = loadCoordinator();
  const cacheStore = globalThis.SciLLM.createMemoryAnalysisCache();
  const coordinator = api.createMechanismOperationCoordinator({ cacheStore });
  const operationId = 'mechanism:logical-slot-replacement';
  const originalInput = identity({ operationId });
  const original = await coordinator.beginEvidenceFirstOperation(originalInput);
  for (let index = 1; index < api.MAX_ACTIVE_MECHANISM_CONTEXTS; index += 1) {
    await coordinator.beginEvidenceFirstOperation(identity({
      operationId: `mechanism:logical-slot-prefill-${index}`,
      documentId: `logical-slot-doc-${index}`,
      workspaceId: `logical-slot-workspace-${index}`
    }));
  }

  const [duplicateA, duplicateB] = await Promise.all([
    coordinator.beginEvidenceFirstOperation(originalInput),
    coordinator.beginEvidenceFirstOperation(originalInput)
  ]);
  assert.strictEqual(duplicateA, original);
  assert.strictEqual(duplicateB, original);
  await assert.rejects(
    coordinator.beginEvidenceFirstOperation({
      ...originalInput, documentHash: 'logical-slot-drift'
    }),
    error => error.code === 'MECHANISM_OPERATION_STALE'
  );
  await assert.rejects(
    coordinator.beginEvidenceFirstOperation(identity({
      operationId: 'mechanism:logical-slot-overflow',
      documentId: 'logical-slot-overflow-doc', workspaceId: 'logical-slot-overflow-workspace'
    })),
    error => error.code === 'MECHANISM_OPERATION_CAPACITY_EXCEEDED'
  );
});

test('checkpoint commits serialize and reject an older batch overwriting a newer batch', async () => {
  const api = loadCoordinator();
  const base = globalThis.SciLLM.createMemoryAnalysisCache();
  let releaseOld;
  let markOldStarted;
  const oldStarted = new Promise(resolve => { markOldStarted = resolve; });
  const oldGate = new Promise(resolve => { releaseOld = resolve; });
  let delayed = false;
  const cacheStore = {
    getMany: (...args) => base.getMany(...args),
    setManyGuarded: async (values, guard) => {
      const old = values.find(value => value.checkpoint?.nextBatchIndex === 2);
      if (old && !delayed) { delayed = true; markOldStarted(); await oldGate; }
      return base.setManyGuarded(values, guard);
    },
    compareAndSetManyGuarded: async (values, guard) => {
      const old = values.find(value => value.checkpoint?.nextBatchIndex === 2);
      if (old && !delayed) { delayed = true; markOldStarted(); await oldGate; }
      return base.compareAndSetManyGuarded(values, guard);
    }
  };
  const coordinator = api.createMechanismOperationCoordinator({ cacheStore });
  const operation = await coordinator.beginEvidenceFirstOperation(identity());
  const oldCommit = coordinator.commitCheckpoint(operation, checkpoint(api, operation, {
    nextBatchIndex: 2, payload: { edgeCount: 2 }
  }));
  await oldStarted;
  const newCommit = coordinator.commitCheckpoint(operation, checkpoint(api, operation, {
    nextBatchIndex: 3, payload: { edgeCount: 3 }
  }));
  releaseOld();
  await Promise.all([oldCommit, newCommit]);
  const resumed = await coordinator.resume(operation);
  assert.equal(resumed.nextBatchIndex, 3);
  assert.equal(resumed.payload.edgeCount, 3);
});

test('a later checkpoint cannot drop already completed Panel keys', async () => {
  const api = loadCoordinator();
  const coordinator = api.createMechanismOperationCoordinator();
  const operation = await coordinator.beginEvidenceFirstOperation(identity());
  await coordinator.commitCheckpoint(operation, checkpoint(api, operation, {
    nextBatchIndex: 2,
    completedPanelKeys: ['fig1::a', 'fig1::b']
  }));
  await assert.rejects(
    coordinator.commitCheckpoint(operation, checkpoint(api, operation, {
      nextBatchIndex: 3,
      completedPanelKeys: ['fig1::a']
    })),
    error => error.code === 'MECHANISM_CHECKPOINT_INVALID'
  );
  const resumed = await coordinator.resume(operation);
  assert.deepEqual(resumed.completedPanelKeys, ['fig1::a', 'fig1::b']);
  assert.equal(resumed.nextBatchIndex, 2);
});

test('checkpoint commit only treats an exact same-sequence candidate as idempotent', async () => {
  const api = loadCoordinator();
  const coordinator = api.createMechanismOperationCoordinator();
  const operation = await coordinator.beginEvidenceFirstOperation(identity());
  const latest = checkpoint(api, operation, {
    nextBatchIndex: 3,
    completedPanelKeys: ['fig1::a', 'fig1::b'],
    payload: { edgeCount: 4 }
  });

  const first = await coordinator.commitCheckpoint(operation, latest);
  const repeated = await coordinator.commitCheckpoint(operation, latest);
  assert.equal(repeated.checkpointCommits, first.checkpointCommits);

  await assert.rejects(
    coordinator.commitCheckpoint(operation, checkpoint(api, operation, {
      nextBatchIndex: 2,
      completedPanelKeys: ['fig1::a'],
      payload: { edgeCount: 3 }
    })),
    error => error.code === 'MECHANISM_CHECKPOINT_INVALID'
  );
  await assert.rejects(
    coordinator.commitCheckpoint(operation, checkpoint(api, operation, {
      nextBatchIndex: 3,
      completedPanelKeys: ['fig1::a', 'fig1::b'],
      payload: { edgeCount: 999 }
    })),
    error => error.code === 'MECHANISM_CHECKPOINT_INVALID'
  );
});

test('resume maps cache read failures instead of treating them as misses', async () => {
  const api = loadCoordinator();
  const base = globalThis.SciLLM.createMemoryAnalysisCache();
  let failReads = false;
  const cacheStore = {
    async getMany(...args) {
      if (failReads) throw new Error('secret read failure');
      return base.getMany(...args);
    },
    setManyGuarded: (...args) => base.setManyGuarded(...args),
    compareAndSetManyGuarded: (...args) => base.compareAndSetManyGuarded(...args)
  };
  const coordinator = api.createMechanismOperationCoordinator({ cacheStore });
  const operation = await coordinator.beginEvidenceFirstOperation(identity());
  failReads = true;
  await assert.rejects(
    coordinator.resume(operation),
    error => error.code === 'MECHANISM_CHECKPOINT_READ_FAILED' &&
      !error.message.includes('secret')
  );
});

test('resume distinguishes a missing run state from a genuine checkpoint miss', async () => {
  const api = loadCoordinator();
  const base = globalThis.SciLLM.createMemoryAnalysisCache();
  let missing = '';
  const cacheStore = {
    async getMany(keys) {
      const found = await base.getMany(keys);
      if (missing && keys.some(key => key.startsWith('mechanism-checkpoint:'))) {
        const prefix = missing === 'run' ? 'mechanism-run-state:' : 'mechanism-checkpoint:';
        const key = keys.find(item => item.startsWith(prefix));
        if (key) found.delete(key);
      }
      return found;
    },
    setManyGuarded: (...args) => base.setManyGuarded(...args),
    compareAndSetManyGuarded: (...args) => base.compareAndSetManyGuarded(...args)
  };
  const coordinator = api.createMechanismOperationCoordinator({ cacheStore });
  const operation = await coordinator.beginEvidenceFirstOperation(identity({
    operationId: 'mechanism:resume-missing-state'
  }));
  await coordinator.commitCheckpoint(operation, checkpoint(api, operation));

  missing = 'run';
  await assert.rejects(
    coordinator.resume(operation),
    error => error.code === 'MECHANISM_CHECKPOINT_READ_FAILED'
  );
  missing = 'checkpoint';
  assert.equal(await coordinator.resume(operation), null);
});

test('durable run state rejects unreachable checkpoint sequence integers', async () => {
  const api = loadCoordinator();
  const base = globalThis.SciLLM.createMemoryAnalysisCache();
  let poison = false;
  const cacheStore = {
    async getMany(keys) {
      const found = await base.getMany(keys);
      if (poison) {
        const runKey = keys.find(key => key.startsWith('mechanism-run-state:'));
        if (runKey && found.has(runKey)) {
          const record = found.get(runKey);
          found.set(runKey, {
            ...record,
            runState: { ...record.runState, checkpointSequence: Number.MAX_SAFE_INTEGER }
          });
        }
      }
      return found;
    },
    setManyGuarded: (...args) => base.setManyGuarded(...args),
    compareAndSetManyGuarded: (...args) => base.compareAndSetManyGuarded(...args)
  };
  const first = api.createMechanismOperationCoordinator({ cacheStore });
  const operation = await first.beginEvidenceFirstOperation(identity({
    operationId: 'mechanism:poisoned-sequence'
  }));
  await first.commitCheckpoint(operation, checkpoint(api, operation));
  poison = true;
  const restarted = api.createMechanismOperationCoordinator({ cacheStore });
  await assert.rejects(
    restarted.beginEvidenceFirstOperation(identity({ operationId: 'mechanism:poisoned-sequence' })),
    error => error.code === 'MECHANISM_RUN_STATE_READ_FAILED'
  );
});

test('resume rejects non-exact durable record envelopes with a fixed read error', async () => {
  const api = loadCoordinator();
  const base = globalThis.SciLLM.createMemoryAnalysisCache();
  let poisonRunEnvelope = '';
  const cacheStore = {
    async getMany(keys) {
      const found = await base.getMany(keys);
      if (poisonRunEnvelope) {
        const runKey = keys.find(key => key.startsWith('mechanism-run-state:'));
        if (runKey && found.has(runKey)) {
          found.set(runKey, poisonRunEnvelope === 'extra'
            ? { ...found.get(runKey), unexpected: 'secret envelope' }
            : { ...found.get(runKey), lastAccessedAt: 'unbounded timestamp' });
        }
      }
      return found;
    },
    setManyGuarded: (...args) => base.setManyGuarded(...args),
    compareAndSetManyGuarded: (...args) => base.compareAndSetManyGuarded(...args)
  };
  const coordinator = api.createMechanismOperationCoordinator({ cacheStore });
  const operation = await coordinator.beginEvidenceFirstOperation(identity());
  await coordinator.commitCheckpoint(operation, checkpoint(api, operation));
  poisonRunEnvelope = 'extra';
  await assert.rejects(
    coordinator.resume(operation),
    error => error.code === 'MECHANISM_CHECKPOINT_READ_FAILED' &&
      !error.message.includes('secret')
  );
  poisonRunEnvelope = 'access-time';
  await assert.rejects(
    coordinator.resume(operation),
    error => error.code === 'MECHANISM_CHECKPOINT_READ_FAILED'
  );
});
