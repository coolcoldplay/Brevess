const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const {
  createArticleIndexSnapshot,
  planArticleIndexRefresh
} = require('../core/article-preindex.js');
const articlePreindex = require('../core/article-preindex.js');
const messenger = require('../core/tab-messenger.js');

test('creates an exact immutable article-index snapshot without freezing its inputs', () => {
  const structure = {
    sections: [{
      sectionId: 'section-1',
      title: 'Results',
      items: [{ text: 'Original structure text' }]
    }]
  };
  const typedRecords = [{
    sourceIdentity: 'paragraph-1',
    meta: { kind: 'body' }
  }];
  const figures = [{
    figureId: 'figure-1',
    panelHints: ['A'],
    metadata: { label: 'Figure 1' }
  }];
  const diagnostics = {
    counts: { body: 1 },
    warnings: [{ code: 'LOW_COVERAGE' }]
  };
  const input = {
    url: 'https://example.test/paper',
    revision: 3,
    domRevision: 7,
    phase: 'canonical',
    structure,
    typedRecords,
    figures,
    diagnostics,
    capturedAt: 100
  };

  const snapshot = createArticleIndexSnapshot(input);

  assert.deepEqual(Object.keys(snapshot), [
    'url',
    'revision',
    'domRevision',
    'phase',
    'structure',
    'typedRecords',
    'figures',
    'diagnostics',
    'capturedAt'
  ]);
  assert.equal(snapshot.url, 'https://example.test/paper');
  assert.equal(snapshot.revision, 3);
  assert.equal(snapshot.domRevision, 7);
  assert.equal(snapshot.phase, 'canonical');
  assert.equal(snapshot.capturedAt, 100);
  assert.equal(snapshot.figures[0].panelHints[0], 'A');

  for (const value of [
    snapshot,
    snapshot.structure,
    snapshot.structure.sections,
    snapshot.structure.sections[0],
    snapshot.structure.sections[0].items,
    snapshot.structure.sections[0].items[0],
    snapshot.typedRecords,
    snapshot.typedRecords[0],
    snapshot.typedRecords[0].meta,
    snapshot.figures,
    snapshot.figures[0],
    snapshot.figures[0].panelHints,
    snapshot.figures[0].metadata,
    snapshot.diagnostics,
    snapshot.diagnostics.counts,
    snapshot.diagnostics.warnings,
    snapshot.diagnostics.warnings[0]
  ]) {
    assert.equal(Object.isFrozen(value), true);
  }

  for (const value of [
    input,
    structure,
    structure.sections,
    structure.sections[0],
    typedRecords,
    typedRecords[0],
    figures,
    figures[0],
    figures[0].panelHints,
    diagnostics,
    diagnostics.counts
  ]) {
    assert.equal(Object.isFrozen(value), false);
  }

  structure.sections[0].title = 'Changed title';
  structure.sections[0].items[0].text = 'Changed structure text';
  typedRecords[0].meta.kind = 'caption';
  typedRecords.push({ sourceIdentity: 'paragraph-2' });
  figures[0].figureId = 'figure-9';
  figures[0].panelHints[0] = 'Z';
  diagnostics.counts.body = 9;
  diagnostics.warnings[0].code = 'CHANGED';

  assert.equal(snapshot.structure.sections[0].title, 'Results');
  assert.equal(snapshot.structure.sections[0].items[0].text, 'Original structure text');
  assert.equal(snapshot.typedRecords[0].meta.kind, 'body');
  assert.equal(snapshot.typedRecords.length, 1);
  assert.equal(snapshot.figures[0].figureId, 'figure-1');
  assert.equal(snapshot.figures[0].panelHints[0], 'A');
  assert.equal(snapshot.diagnostics.counts.body, 1);
  assert.equal(snapshot.diagnostics.warnings[0].code, 'LOW_COVERAGE');
});

test('preserves aliases and cycles while treating non-plain DOM handles as opaque', () => {
  class FakeElement {
    constructor(name) {
      this.name = name;
    }
  }

  const element = new FakeElement('figure');
  const captionElement = new FakeElement('caption');
  const imageElement = new FakeElement('image');
  const imageElements = [imageElement];
  const shared = { marker: 'shared' };
  shared.self = shared;
  const structure = { shared };
  const typedRecords = [{ shared }];
  const figures = [{
    shared,
    element,
    captionElement,
    imageElements
  }];
  const diagnostics = { shared };

  const snapshot = createArticleIndexSnapshot({
    structure,
    typedRecords,
    figures,
    diagnostics
  });

  const clonedShared = snapshot.structure.shared;
  assert.notStrictEqual(clonedShared, shared);
  assert.strictEqual(snapshot.typedRecords[0].shared, clonedShared);
  assert.strictEqual(snapshot.figures[0].shared, clonedShared);
  assert.strictEqual(snapshot.diagnostics.shared, clonedShared);
  assert.strictEqual(clonedShared.self, clonedShared);
  assert.equal(Object.isFrozen(clonedShared), true);

  assert.strictEqual(snapshot.figures[0].element, element);
  assert.strictEqual(snapshot.figures[0].captionElement, captionElement);
  assert.strictEqual(snapshot.figures[0].imageElements[0], imageElement);
  assert.notStrictEqual(snapshot.figures[0].imageElements, imageElements);
  assert.equal(Object.isFrozen(snapshot.figures[0].imageElements), true);
  assert.equal(Object.isFrozen(element), false);
  assert.equal(Object.isFrozen(captionElement), false);
  assert.equal(Object.isFrozen(imageElement), false);
});

test('retains cross-realm arrays and other non-plain handles as unfrozen opaque references', () => {
  const crossRealmArray = vm.runInNewContext('[{ mutable: true }]');
  const crossRealmObject = vm.runInNewContext('({ nested: { mutable: true } })');
  const date = new Date(0);
  const map = new Map([['figure-1', { mutable: true }]]);
  const structure = { crossRealmArray, crossRealmObject, date, map };

  const snapshot = createArticleIndexSnapshot({ structure });

  assert.strictEqual(snapshot.structure.crossRealmArray, crossRealmArray);
  assert.strictEqual(snapshot.structure.crossRealmObject, crossRealmObject);
  assert.strictEqual(snapshot.structure.date, date);
  assert.strictEqual(snapshot.structure.map, map);
  assert.equal(Object.isFrozen(crossRealmArray), false);
  assert.equal(Object.isFrozen(crossRealmArray[0]), false);
  assert.equal(Object.isFrozen(crossRealmObject), false);
  assert.equal(Object.isFrozen(crossRealmObject.nested), false);
  assert.equal(Object.isFrozen(date), false);
  assert.equal(Object.isFrozen(map), false);
});

test('reads each snapshot field and each plain-data getter exactly once', () => {
  const nestedReads = { count: 0 };
  const nested = {};
  Object.defineProperty(nested, 'value', {
    enumerable: true,
    get() {
      nestedReads.count += 1;
      if (nestedReads.count > 1) throw new Error('nested getter read twice');
      return { stable: true };
    }
  });
  const values = {
    url: 'https://example.test/getters',
    revision: 8,
    domRevision: 13,
    phase: 'canonical',
    structure: nested,
    typedRecords: [],
    figures: [],
    diagnostics: {},
    capturedAt: 101
  };
  const reads = Object.create(null);
  const proxyReads = Object.create(null);
  const target = {};
  for (const [field, value] of Object.entries(values)) {
    Object.defineProperty(target, field, {
      enumerable: true,
      get() {
        reads[field] = (reads[field] || 0) + 1;
        if (reads[field] > 1) throw new Error(`${field} read twice`);
        return value;
      }
    });
  }
  const input = new Proxy(target, {
    get(proxyTarget, field, receiver) {
      if (Object.hasOwn(values, field)) {
        proxyReads[field] = (proxyReads[field] || 0) + 1;
      }
      return Reflect.get(proxyTarget, field, receiver);
    }
  });

  const snapshot = createArticleIndexSnapshot(input);

  assert.deepEqual({ ...reads }, Object.fromEntries(
    Object.keys(values).map(field => [field, 1])
  ));
  assert.deepEqual({ ...proxyReads }, Object.fromEntries(
    Object.keys(values).map(field => [field, 1])
  ));
  assert.equal(nestedReads.count, 1);
  assert.deepEqual(snapshot.structure.value, { stable: true });
  assert.equal(Object.isFrozen(snapshot.structure.value), true);
});

test('contains top-level get trap failures behind the fixed reflection error', () => {
  const leaked = new Error('LEAKED_TRAP_DETAIL');
  leaked.name = 'LeakedTrapError';
  leaked.cause = new Error('LEAKED_TRAP_CAUSE');
  const hostile = new Proxy({}, {
    get() {
      throw leaked;
    }
  });

  assert.throws(
    () => createArticleIndexSnapshot(hostile),
    error => {
      assert.equal(error?.name, 'TypeError');
      assert.equal(error?.message, 'ARTICLE_INDEX_SNAPSHOT_REFLECTION_FAILED');
      assert.equal(error?.code, 'ARTICLE_INDEX_SNAPSHOT_REFLECTION_FAILED');
      assert.equal(Object.hasOwn(error, 'cause'), false);
      assert.equal(String(error).includes('LEAKED_TRAP_DETAIL'), false);
      return true;
    }
  );
});

test('contains revoked top-level proxies behind the fixed reflection error', () => {
  const { proxy, revoke } = Proxy.revocable({}, {});
  revoke();

  assert.throws(
    () => createArticleIndexSnapshot(proxy),
    error => {
      assert.equal(error?.name, 'TypeError');
      assert.equal(error?.message, 'ARTICLE_INDEX_SNAPSHOT_REFLECTION_FAILED');
      assert.equal(error?.code, 'ARTICLE_INDEX_SNAPSHOT_REFLECTION_FAILED');
      assert.equal(Object.hasOwn(error, 'cause'), false);
      return true;
    }
  );
});

test('clones sparse and null-prototype plain data including symbol properties', () => {
  const symbol = Symbol('article-index');
  const sparse = new Array(4);
  sparse[2] = { value: 'kept' };
  sparse[symbol] = { source: 'symbol' };
  const nullPrototype = Object.create(null);
  nullPrototype.sparse = sparse;
  nullPrototype.self = nullPrototype;

  const snapshot = createArticleIndexSnapshot({
    structure: nullPrototype,
    typedRecords: [nullPrototype],
    figures: [],
    diagnostics: nullPrototype
  });

  assert.equal(Object.getPrototypeOf(snapshot.structure), null);
  assert.strictEqual(snapshot.structure, snapshot.typedRecords[0]);
  assert.strictEqual(snapshot.structure, snapshot.diagnostics);
  assert.strictEqual(snapshot.structure.self, snapshot.structure);
  assert.equal(snapshot.structure.sparse.length, 4);
  assert.equal(0 in snapshot.structure.sparse, false);
  assert.equal(1 in snapshot.structure.sparse, false);
  assert.equal(2 in snapshot.structure.sparse, true);
  assert.equal(3 in snapshot.structure.sparse, false);
  assert.deepEqual(snapshot.structure.sparse[2], { value: 'kept' });
  assert.deepEqual(snapshot.structure.sparse[symbol], { source: 'symbol' });
  assert.equal(Object.isFrozen(snapshot.structure.sparse), true);
  assert.equal(Object.isFrozen(snapshot.structure.sparse[symbol]), true);
});

test('classifies a shared same-realm plain object only once', () => {
  let prototypeReads = 0;
  const shared = new Proxy({ marker: 'shared' }, {
    getPrototypeOf(target) {
      prototypeReads += 1;
      if (prototypeReads > 1) throw new Error('prototype read twice');
      return Reflect.getPrototypeOf(target);
    }
  });

  const snapshot = createArticleIndexSnapshot({
    structure: { shared },
    typedRecords: [{ shared }],
    figures: [{ shared }],
    diagnostics: { shared }
  });

  assert.equal(prototypeReads, 1);
  assert.notStrictEqual(snapshot.structure.shared, shared);
  assert.strictEqual(snapshot.structure.shared, snapshot.typedRecords[0].shared);
  assert.strictEqual(snapshot.structure.shared, snapshot.figures[0].shared);
  assert.strictEqual(snapshot.structure.shared, snapshot.diagnostics.shared);
  assert.equal(Object.isFrozen(snapshot.structure.shared), true);
  assert.equal(Object.isFrozen(shared), false);
});

test('converts reflection trap failures to one fixed public error', () => {
  const hostile = new Proxy({}, {
    ownKeys() {
      throw new Error('hostile reflection details');
    }
  });
  assert.throws(
    () => createArticleIndexSnapshot({ structure: hostile }),
    error => {
      assert.equal(error?.name, 'TypeError');
      assert.equal(error?.message, 'ARTICLE_INDEX_SNAPSHOT_REFLECTION_FAILED');
      assert.equal(error?.code, 'ARTICLE_INDEX_SNAPSHOT_REFLECTION_FAILED');
      return true;
    }
  );
});

for (const invalidLength of [-1, '2']) {
  test(`rejects reflected array length ${JSON.stringify(invalidLength)} with the fixed error`, () => {
    const hostileArray = new Proxy([], {
      get(target, property, receiver) {
        if (property === 'length') return invalidLength;
        return Reflect.get(target, property, receiver);
      }
    });

    assert.throws(
      () => createArticleIndexSnapshot({ figures: hostileArray }),
      error => {
        assert.equal(error?.name, 'TypeError');
        assert.equal(error?.message, 'ARTICLE_INDEX_SNAPSHOT_REFLECTION_FAILED');
        assert.equal(error?.code, 'ARTICLE_INDEX_SNAPSHOT_REFLECTION_FAILED');
        return true;
      }
    );
  });
}

test('plans exact frozen Figure refreshes in first-seen order without mutating descriptors', () => {
  const exact = planArticleIndexRefresh([
    { kind: 'caption', figureId: 'figure-2' },
    { kind: 'plugin-ui' }
  ]);
  assert.deepEqual(exact, {
    full: false,
    structure: false,
    figureIds: ['figure-2']
  });
  assert.equal(Object.isFrozen(exact), true);
  assert.equal(Object.isFrozen(exact.figureIds), true);

  const descriptors = [
    { kind: 'caption', figureId: 'figure-2' },
    { kind: 'plugin-ui', figureId: 'figure-plugin' },
    { kind: 'figure', figureId: 'figure-s2' },
    { kind: 'caption', figureId: 'figure-2' },
    { kind: 'caption', figureId: 'supp-Custom' }
  ];
  const original = structuredClone(descriptors);

  const plan = planArticleIndexRefresh(descriptors);

  assert.deepEqual(plan, {
    full: false,
    structure: false,
    figureIds: ['figure-2', 'figure-s2', 'supp-Custom']
  });
  assert.deepEqual(descriptors, original);
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(Object.isFrozen(plan.figureIds), true);
  assert.equal(Object.isFrozen(descriptors), false);
  assert.equal(Object.isFrozen(descriptors[0]), false);
});

test('returns exact full and stable no-op plans and marks explicit structure dirtiness', () => {
  let inspectedAfterRoot = false;
  const laterDescriptor = {};
  Object.defineProperty(laterDescriptor, 'kind', {
    get() {
      inspectedAfterRoot = true;
      throw new Error('descriptor after root replacement must not be inspected');
    }
  });

  const full = planArticleIndexRefresh([
    { kind: 'root-replacement' },
    laterDescriptor
  ]);
  assert.deepEqual(full, { full: true });
  assert.deepEqual(Object.keys(full), ['full']);
  assert.equal(Object.isFrozen(full), true);
  assert.equal(inspectedAfterRoot, false);

  const empty = planArticleIndexRefresh([]);
  const pluginOnly = planArticleIndexRefresh([{ kind: 'plugin-ui' }]);
  assert.deepEqual(empty, {
    full: false,
    structure: false,
    figureIds: []
  });
  assert.deepEqual(pluginOnly, empty);
  assert.equal(Object.isFrozen(empty), true);
  assert.equal(Object.isFrozen(empty.figureIds), true);
  assert.equal(Object.isFrozen(pluginOnly), true);
  assert.equal(Object.isFrozen(pluginOnly.figureIds), true);

  for (const kind of ['structure', 'paragraph', 'heading']) {
    assert.deepEqual(planArticleIndexRefresh([{ kind }]), {
      full: false,
      structure: true,
      figureIds: []
    });
  }
});

test('exports only the preindex API through CommonJS and the global UMD namespace', () => {
  assert.deepEqual(Object.keys(articlePreindex).sort(), [
    'createArticleIndexSnapshot',
    'planArticleIndexRefresh'
  ]);

  const source = fs.readFileSync(
    path.join(__dirname, '..', 'core', 'article-preindex.js'),
    'utf8'
  );
  const context = vm.createContext({ SciLLM: { sentinel: true } });
  vm.runInContext(source, context);

  assert.equal(context.SciLLM.sentinel, true);
  assert.equal(typeof context.SciLLM.createArticleIndexSnapshot, 'function');
  assert.equal(typeof context.SciLLM.planArticleIndexRefresh, 'function');
});

test('loads article preindex exactly once after extraction and before content', () => {
  const file = 'core/article-preindex.js';
  assert.equal(
    messenger.CONTENT_SCRIPT_FILES.filter(candidate => candidate === file).length,
    1
  );
  assert.ok(
    messenger.CONTENT_SCRIPT_FILES.indexOf('core/article-extractor.js') <
      messenger.CONTENT_SCRIPT_FILES.indexOf(file)
  );
  assert.ok(
    messenger.CONTENT_SCRIPT_FILES.indexOf(file) <
      messenger.CONTENT_SCRIPT_FILES.indexOf('content.js')
  );
});
