(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const STRUCTURE_DIRTY_KINDS = new Set([
    'structure',
    'paragraph',
    'heading'
  ]);
  const EMPTY_FIGURE_IDS = Object.freeze([]);
  const NO_REFRESH_PLAN = Object.freeze({
    full: false,
    structure: false,
    figureIds: EMPTY_FIGURE_IDS
  });
  const FULL_REFRESH_PLAN = Object.freeze({ full: true });

  function reflectionFailure() {
    const error = new TypeError('ARTICLE_INDEX_SNAPSHOT_REFLECTION_FAILED');
    error.code = 'ARTICLE_INDEX_SNAPSHOT_REFLECTION_FAILED';
    return error;
  }

  /**
   * Clones and freezes only same-realm arrays and plain data objects. DOM nodes,
   * Map, Date, class instances, and objects/arrays with foreign intrinsic
   * prototypes are opaque handles: they remain referenced as-is and are neither
   * traversed nor frozen. Snapshot immutability therefore covers the public
   * plain-data graph, not every object reachable through an opaque handle.
   */
  function cloneAndFreezePlainGraph(value, clones) {
    if (value === null || typeof value !== 'object') return value;
    if (clones.has(value)) return clones.get(value);

    let isArray;
    let prototype;
    try {
      isArray = Array.isArray(value);
      prototype = Object.getPrototypeOf(value);
    } catch {
      throw reflectionFailure();
    }
    const isPlainArray = isArray && prototype === Array.prototype;
    const isPlainObject = !isArray &&
      (prototype === Object.prototype || prototype === null);
    if (!isPlainArray && !isPlainObject) {
      clones.set(value, value);
      return value;
    }

    let length = 0;
    if (isPlainArray) {
      try {
        length = value.length;
      } catch {
        throw reflectionFailure();
      }
      if (!Number.isInteger(length) || length < 0 || length > 0xffffffff) {
        throw reflectionFailure();
      }
    }
    const clone = isPlainArray ? new Array(length) : Object.create(prototype);
    clones.set(value, clone);

    let keys;
    try {
      keys = Reflect.ownKeys(value);
    } catch {
      throw reflectionFailure();
    }
    for (const key of keys) {
      if (isPlainArray && key === 'length') continue;
      let descriptor;
      try {
        descriptor = Object.getOwnPropertyDescriptor(value, key);
      } catch {
        throw reflectionFailure();
      }
      if (!descriptor?.enumerable) continue;
      let propertyValue;
      if (Object.hasOwn(descriptor, 'value')) {
        propertyValue = descriptor.value;
      } else {
        try {
          propertyValue = value[key];
        } catch {
          throw reflectionFailure();
        }
      }
      Object.defineProperty(clone, key, {
        value: cloneAndFreezePlainGraph(propertyValue, clones),
        enumerable: true,
        configurable: true,
        writable: true
      });
    }

    return Object.freeze(clone);
  }

  function createArticleIndexSnapshot(input = {}) {
    const source = input ?? {};
    const clones = new WeakMap();
    let url;
    let revision;
    let domRevision;
    let phase;
    let structureValue;
    let typedRecordsValue;
    let figuresValue;
    let diagnosticsValue;
    let capturedAt;
    try {
      url = source.url;
      revision = source.revision;
      domRevision = source.domRevision;
      phase = source.phase;
      structureValue = source.structure;
      typedRecordsValue = source.typedRecords;
      figuresValue = source.figures;
      diagnosticsValue = source.diagnostics;
      capturedAt = source.capturedAt;
    } catch {
      throw reflectionFailure();
    }
    const structure = structureValue === undefined ? null : structureValue;
    const typedRecords = typedRecordsValue === undefined ? [] : typedRecordsValue;
    const figures = figuresValue === undefined ? [] : figuresValue;
    const diagnostics = diagnosticsValue === undefined ? {} : diagnosticsValue;

    // Task 4 Figure-only refreshes must reuse trusted frozen branches directly;
    // re-cloning an old snapshot here would discard their cache identity.
    return Object.freeze({
      url: url === undefined ? '' : url,
      revision: revision === undefined ? 0 : revision,
      domRevision: domRevision === undefined ? 0 : domRevision,
      phase: phase === undefined ? '' : phase,
      structure: cloneAndFreezePlainGraph(structure, clones),
      typedRecords: cloneAndFreezePlainGraph(typedRecords, clones),
      figures: cloneAndFreezePlainGraph(figures, clones),
      diagnostics: cloneAndFreezePlainGraph(diagnostics, clones),
      capturedAt: capturedAt === undefined ? Date.now() : capturedAt
    });
  }

  function createPartialRefreshPlan(structure, figureIds) {
    return Object.freeze({
      full: false,
      structure,
      figureIds: Object.freeze(figureIds)
    });
  }

  function planArticleIndexRefresh(descriptors = []) {
    const figureIds = [];
    const seenFigureIds = new Set();
    let structure = false;

    for (const descriptor of Array.isArray(descriptors) ? descriptors : []) {
      if (!descriptor || typeof descriptor !== 'object') continue;
      const kind = descriptor.kind;
      if (kind === 'root-replacement') return FULL_REFRESH_PLAN;
      if (kind === 'plugin-ui') continue;
      if (STRUCTURE_DIRTY_KINDS.has(kind)) structure = true;

      const figureId = descriptor.figureId;
      if (typeof figureId !== 'string' || !figureId || seenFigureIds.has(figureId)) {
        continue;
      }
      seenFigureIds.add(figureId);
      figureIds.push(figureId);
    }

    if (!structure && figureIds.length === 0) return NO_REFRESH_PLAN;
    return createPartialRefreshPlan(structure, figureIds);
  }

  return {
    createArticleIndexSnapshot,
    planArticleIndexRefresh
  };
});
