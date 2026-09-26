(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const OMIT = 'script,style,template,noscript,input,textarea,select,option,canvas,iframe,object,embed,' +
    '[data-sci-plugin-ui],.sci-manual-note-marker';
  const MAX_CLIP_RANGE_PROBES = 4096;

  function parentElement(node) {
    return node?.assignedSlot || node?.parentElement || node?.getRootNode?.()?.host || null;
  }

  function createSemanticFindDomSnapshot(document, options = {}) {
    const normalize = options.normalizeTextWithOffsets;
    if (typeof normalize !== 'function') throw new Error('Semantic DOM normalization is unavailable');
    const view = document.defaultView;
    const root = document.body || document.documentElement;
    let stale = false;
    let disconnected = false;
    let notify = () => {};
    let rebound = () => {};
    let additional = () => {};
    let hasAdditionalContent = false;
    let additionalError = null;
    const pendingParagraphs = [];
    let admittedCount = 0;
    let admittedBytes = 0;
    let observer = null;
    let serial = 0;
    let processing = false;
    let visibilityGeneration = 0;
    let visibilityJob = null;
    let visibilityTimer = null;
    let pumpingVisibility = false;
    const now = () => view.performance?.now?.() ?? Date.now();
    const schedule = callback => (view.setTimeout || globalThis.setTimeout)(callback, 0);
    const unschedule = timer => (view.clearTimeout || globalThis.clearTimeout)(timer);
    const VISIBILITY_SLICE_MS = 6;
    const roots = new Set([root]);
    const counters = { scans: 0, scannedTextNodes: 0, mutationBatches: 0, clipRangeProbes: 0,
      visibilitySlices: 0, cancelledVisibilityScans: 0, maxVisibilitySliceMs: 0,
      maxVisibilityCommitMs: 0, maxAdditionalNotificationMs: 0, maxVisibilityReboundMs: 0 };
    // PubMed sends responsive long/short snippets in the same loaded result.
    // The long variant is still an excerpt, not a fetched remote abstract.
    const summarySources = new Map();
    const summaryContainers = new Set();
    const duplicateSummaries = new Set();
    function discoverSummaries(scope) {
      if (document.location?.hostname !== 'pubmed.ncbi.nlm.nih.gov') return;
      const candidates = [...(scope.querySelectorAll?.('article.full-docsum .docsum-snippet') || [])];
      if (scope.matches?.('.docsum-snippet') && scope.closest?.('article.full-docsum')) candidates.push(scope);
      // A mutation scope may be inside a just-added card rather than its root.
      const enclosing = scope.closest?.('.docsum-snippet');
      if (enclosing?.closest?.('article.full-docsum')) candidates.push(enclosing);
      for (const container of candidates) {
        if (summaryContainers.has(container) || summaryContainers.size >= 5000) continue;
        const source = container.querySelector('.full-view-snippet') || container.querySelector('.short-view-snippet');
        if (!source || !source.textContent.trim() || omitted(source)) continue;
        summarySources.set(source, container);
        summaryContainers.add(container);
        for (const duplicate of container.querySelectorAll('.full-view-snippet,.short-view-snippet')) {
          if (duplicate !== source) duplicateSummaries.add(duplicate);
        }
      }
    }
    function summaryFor(node) {
      for (let current = parentElement(node); current; current = parentElement(current)) {
        if (summarySources.has(current)) return current;
      }
      return null;
    }

    function omitted(element) {
      for (let current = element; current; current = parentElement(current)) {
        if (current.matches?.(OMIT) || current.isContentEditable ||
            (current.hasAttribute?.('contenteditable') &&
              current.getAttribute('contenteditable') !== 'false')) return true;
      }
      return false;
    }

    function collect(scope) {
      const iterator = collectSteps(scope);
      let step;
      do { step = iterator.next(); } while (!step.done);
      return step.value;
    }
    function* collectSteps(scope) {
      if (!additionalError) discoverSummaries(scope);
      counters.scans++;
      const output = [];
      const styles = new WeakMap();
      const visited = new Set();
      const foundRoots = new Set();
      const parents = new WeakMap();
      const exclusions = new WeakMap();
      const summaries = new WeakMap();
      const parent = node => {
        if (!parents.has(node)) parents.set(node, parentElement(node));
        return parents.get(node);
      };
      function excluded(element) {
        const trail = [];
        let result = false;
        for (let current = element; current; current = parent(current)) {
          if (exclusions.has(current)) { result = exclusions.get(current); break; }
          trail.push(current);
          if (current.matches?.(OMIT) || current.isContentEditable ||
              (current.hasAttribute?.('contenteditable') && current.getAttribute('contenteditable') !== 'false')) {
            result = true; break;
          }
        }
        for (const node of trail) exclusions.set(node, result);
        return result;
      }
      function summaryForPart(node) {
        const trail = [];
        let result = null;
        for (let current = parent(node); current; current = parent(current)) {
          if (summarySources.has(current)) { result = current; break; }
          if (summaries.has(current)) { result = summaries.get(current); break; }
          trail.push(current);
        }
        for (const element of trail) summaries.set(element, result);
        return result;
      }
      let parts = [];
      let owner = scope.nodeType === 11 ? scope.host : scope;
      const style = element => {
        if (!styles.has(element)) {
          const css = view.getComputedStyle(element);
          // A CSSStyleDeclaration is live; cache its values for this scan as well
          // as the object to avoid repeated native getters for every Text ancestor.
          styles.set(element, { display: css.display, visibility: css.visibility, opacity: css.opacity,
            contentVisibility: css.contentVisibility, clip: css.clip, clipPath: css.clipPath,
            overflowX: css.overflowX, overflowY: css.overflowY, webkitTextFillColor: css.webkitTextFillColor,
            color: css.color, textShadow: css.textShadow, webkitTextStrokeWidth: css.webkitTextStrokeWidth });
        }
        return styles.get(element);
      };
      function visibleParts(node) {
        const element = parent(node);
        if (!element || excluded(element)) return [];
        const sourceText = node.nodeValue;
        const whole = () => [{ node, raw: sourceText }];
        const summary = summaryForPart(node);
        const summaryContainer = summarySources.get(summary);
        const textStyle = style(element);
        const transparent = value => value === 'transparent' ||
          /^rgba\([^)]*,\s*0(?:\.0+)?\s*\)$/u.test(String(value)) ||
          /\/\s*0(?:\.0+)?\s*\)$/u.test(String(value));
        if ((transparent(textStyle.webkitTextFillColor || textStyle.color)) &&
            (!textStyle.textShadow || textStyle.textShadow === 'none') &&
            !(parseFloat(textStyle.webkitTextStrokeWidth) > 0)) return [];
        let deferredLayout = false;
        for (let current = element; current; current = parent(current)) {
          const css = style(current);
          // Only these two known summary wrappers may be collapsed. Hidden
          // descendants, entire cards, editors and other hidden areas stay out.
          if (summary && (current === summary || current === summaryContainer)) continue;
          // Collapsed wrappers have no usable descendant geometry. A nested
          // clipping box is not itself the opted-in summary; conservatively
          // exclude it instead of admitting its invisible suffix or zero box.
          if (summary?.contains(current) && !['inline', 'contents'].includes(css.display) &&
              (/^(hidden|clip)$/u.test(css.overflowX) || /^(hidden|clip)$/u.test(css.overflowY))) return [];
          if (current.hidden || css.display === 'none' ||
              ['hidden', 'collapse'].includes(css.visibility) || Number(css.opacity) === 0 ||
              css.contentVisibility === 'hidden') return [];
          if (css.contentVisibility === 'auto') deferredLayout = true;
          if (current.tagName === 'DETAILS' && !current.open) {
            const summary = [...current.children].find(child => child.tagName === 'SUMMARY');
            if (!summary?.contains(node)) return [];
          }
          // Common visually-hidden rules have a zero clipping rectangle.
          if (/^rect\(\s*0(?:px)?[ ,]+0(?:px)?[ ,]+0(?:px)?[ ,]+0(?:px)?\s*\)$/u.test(css.clip) ||
              /^inset\(\s*(?:50%|100%)(?:\s|\))/u.test(css.clipPath)) return [];
        }
        if (summary) return whole();
        const range = document.createRange();
        range.selectNodeContents(node);
        const rects = [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0);
        if (!rects.length) return deferredLayout ? whole() : [];
        const clip = { left: -Infinity, right: Infinity, top: -Infinity, bottom: Infinity };
        let clipped = false;
        // Scroll containers and the viewport deliberately do not clip the corpus:
        // their offscreen text remains reachable by the reader.
        for (let current = element; current && current !== document.body &&
            current !== document.documentElement; current = parent(current)) {
          const css = style(current);
          // Non-replaced inline and display:contents have no overflow clipping
          // box. Their zero client size must not hide otherwise painted text.
          if (css.display === 'inline' || css.display === 'contents') continue;
          const clipX = /^(hidden|clip)$/u.test(css.overflowX);
          const clipY = /^(hidden|clip)$/u.test(css.overflowY);
          if (!clipX && !clipY) continue;
          const box = current.getBoundingClientRect();
          const scaleX = current.offsetWidth > 0 ? box.width / current.offsetWidth : 1;
          const scaleY = current.offsetHeight > 0 ? box.height / current.offsetHeight : 1;
          const left = box.left + (current.clientLeft || 0) * scaleX;
          const top = box.top + (current.clientTop || 0) * scaleY;
          if (clipX) {
            clip.left = Math.max(clip.left, left);
            clip.right = Math.min(clip.right, left + (current.clientWidth ?? box.width) * scaleX);
          }
          if (clipY) {
            clip.top = Math.max(clip.top, top);
            clip.bottom = Math.min(clip.bottom, top + (current.clientHeight ?? box.height) * scaleY);
          }
          clipped = true;
        }
        if (!clipped) return whole();
        const intersects = rect => rect.right > clip.left && rect.left < clip.right &&
          rect.bottom > clip.top && rect.top < clip.bottom;
        const inside = rect => rect.left >= clip.left && rect.right <= clip.right &&
          rect.top >= clip.top && rect.bottom <= clip.bottom;
        const classify = values => !values.some(intersects) ? 0 : values.every(inside) ? 2 : 1;
        const classification = classify(rects);
        if (!classification) return [];
        if (classification === 2) return whole();

        // Only partially clipped nodes pay for character geometry. Bisect and
        // prune fully inside/outside intervals instead of probing every code unit
        // on every page. A bounded failure is preferable to sending hidden text.
        const spans = [];
        let probes = 0;
        const collectSpan = (start, end, knownRects) => {
          if (!knownRects && ++probes > MAX_CLIP_RANGE_PROBES) {
            throw Object.assign(new Error('局部裁剪文字过于复杂，无法安全建立检索范围。'),
              { code: 'SEMANTIC_FIND_SOURCE_COMPLEX' });
          }
          if (!knownRects) {
            counters.clipRangeProbes++;
            range.setStart(node, start); range.setEnd(node, end);
            knownRects = [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0);
          }
          const state = classify(knownRects);
          if (!state) return;
          let middle = Math.floor((start + end) / 2);
          if (middle > start && /[\uDC00-\uDFFF]/u.test(sourceText[middle]) &&
              /[\uD800-\uDBFF]/u.test(sourceText[middle - 1])) middle--;
          if (state === 2 || middle <= start || middle >= end) {
            const previous = spans[spans.length - 1];
            if (previous?.end === start) previous.end = end;
            else spans.push({ start, end });
            return;
          }
          collectSpan(start, middle); collectSpan(middle, end);
        };
        collectSpan(0, sourceText.length, rects);
        const fragments = [];
        let previousEnd = 0;
        for (const span of spans) {
          if (span.start > previousEnd) fragments.push({ node: null,
            raw: fragments.length ? ' ' : '', gap: true });
          fragments.push({ node, raw: sourceText.slice(span.start, span.end),
            sourceStart: span.start, sourceText });
          previousEnd = span.end;
        }
        if (previousEnd < sourceText.length) fragments.push({ node: null, raw: '', gap: true });
        return fragments;
      }
      function flush() {
        const raw = parts.map(part => part.raw).join('');
        const normalized = normalize(raw);
        if (normalized.text) output.push({ element: owner, parts, ...normalized });
        parts = [];
      }
      function* visit(node) {
        if (!node || visited.has(node)) return;
        visited.add(node);
        yield;
        if (node.nodeType === 3) {
          counters.scannedTextNodes++;
          const visible = node.nodeValue ? visibleParts(node) : [];
          if (visible.some(part => part.node)) {
            const previous = parts.findLast(part => part.node)?.node;
            if (previous && previous.getRootNode() !== node.getRootNode()) flush();
            parts.push(...visible);
          } else if (node.nodeValue?.trim()) parts.push({ node: null, raw: '', gap: true });
          return;
        }
        if (node.nodeType === 11) {
          foundRoots.add(node);
          // A new open shadow root must be observed before a sliced scan reads
          // its text, so edits between slices also cancel the scan generation.
          if (observer && !roots.has(node)) {
            roots.add(node);
            observer.observe(node, observerOptions);
          }
          for (const child of node.childNodes) yield* visit(child);
          return;
        }
        if (node.nodeType !== 1) return;
        if (excluded(node) || duplicateSummaries.has(node)) { parts.push({ node: null, raw: '', gap: true }); return; }
        const css = style(node);
        const summaryWrapper = summarySources.has(node) || summaryContainers.has(node);
        if (!summaryWrapper && (node.hidden || css.display === 'none' || css.contentVisibility === 'hidden')) {
          parts.push({ node: null, raw: '', gap: true }); return;
        }
        if (node.tagName === 'BR') { parts.push({ node: null, raw: '\n' }); return; }
        const block = summaryWrapper || !['inline', 'contents', 'ruby', 'ruby-text'].includes(css.display) ||
          /^(BUTTON|TD|TH|LI|DT|DD|H[1-6])$/u.test(node.tagName);
        const previousOwner = owner;
        if (block || node.shadowRoot) { flush(); owner = node; }
        if (node.shadowRoot) {
          yield* visit(node.shadowRoot);
        } else if (node.tagName === 'SLOT' && typeof node.assignedNodes === 'function') {
          const assigned = node.assignedNodes({ flatten: true });
          for (const child of assigned.length ? assigned : node.childNodes) yield* visit(child);
        } else {
          for (const child of node.childNodes) yield* visit(child);
        }
        if (block || node.shadowRoot) { flush(); owner = previousOwner; }
      }
      yield* visit(scope);
      flush();
      return { entries: output, roots: foundRoots };
    }

    const initial = collect(root);
    for (const shadow of initial.roots) roots.add(shadow);
    const bindings = new Map();
    function reserveParagraphs(values, initialAdmission = false) {
      const bytes = values.reduce((total, paragraph) => total + new TextEncoder().encode(paragraph.text).length, 0);
      if (admittedCount + values.length > 5000 || admittedBytes + bytes > 4 * 1024 * 1024 ||
          values.some(paragraph => paragraph.text.length > 1000000)) {
        throw Object.assign(new Error('当前网页已达到语义检索累计上限；已有结果保留，停止自动补充检索。'),
          { code: 'SEMANTIC_FIND_LIMIT_EXCEEDED' });
      }
      options.validateAdditionalParagraphs?.(values, { initial: initialAdmission });
      admittedCount += values.length; admittedBytes += bytes;
    }
    const paragraphs = initial.entries.map((binding, index) => ({
      paragraphId: `semantic-dom-${index + 1}`, text: binding.text, sectionTitle: ''
    }));
    reserveParagraphs(paragraphs, true);
    initial.entries.forEach((entry, index) => bindings.set(paragraphs[index].paragraphId, entry));
    serial = initial.entries.length;
    const renderedStates = new WeakMap();
    const sourceStructures = new WeakMap();
    const sourceBoundaries = new WeakSet(initial.entries.map(entry => entry.element));
    function sourceContainersFor(entries) {
      const containers = new Set();
      for (const entry of entries) for (const part of entry.parts) if (part.node) {
        for (let node = parentElement(part.node); node; node = parentElement(node)) {
          containers.add(node);
          if (node === entry.element) break;
        }
      }
      return containers;
    }
    const sourceContainers = new WeakSet(sourceContainersFor(initial.entries));
    const unindexedBoundaries = new WeakSet();
    function sourceStructure(element, nextBoundaries, nextContainers) {
      const nodes = [];
      const visit = node => {
        if (node.nodeType === 3) { nodes.push(node); return; }
        if (node.nodeType === 1 && (omitted(node) || duplicateSummaries.has(node))) return;
        // A separately indexed descendant has its own text identity. Keep its
        // boundary so removal/reordering is detected without making a child
        // text replacement invalidate unchanged text belonging to this owner.
        if (node !== element && (sourceBoundaries.has(node) || nextBoundaries?.has(node))) { nodes.push(node); return; }
        // Never-indexed hidden branches are not source text. Preserve their
        // element boundary across internal text replacement/clearing, while a
        // newly inserted branch or removed exclusion still changes composition.
        if (node !== element && !sourceContainers.has(node) && !nextContainers?.has(node)) {
          if (unindexedBoundaries.has(node) || hasSourceText(node)) {
            unindexedBoundaries.add(node); nodes.push(node);
          }
          return;
        }
        const assigned = node.tagName === 'SLOT' ? node.assignedNodes?.({ flatten: true }) : null;
        for (const child of assigned?.length ? assigned : node.shadowRoot?.childNodes || node.childNodes || []) visit(child);
      };
      visit(element); return nodes;
    }
    for (const binding of bindings.values()) {
      if (!sourceStructures.has(binding.element)) sourceStructures.set(binding.element, sourceStructure(binding.element));
    }
    let included = new WeakSet();
    let owners = new WeakMap();
    const ownerIds = new Map();
    let sourceRevision = 0;
    const sourceValidity = new WeakMap();
    function indexBindings() {
      sourceRevision++;
      included = new WeakSet();
      owners = new WeakMap();
      ownerIds.clear();
      for (const [id, binding] of bindings) {
        if (!ownerIds.has(binding.element)) ownerIds.set(binding.element, new Set());
        ownerIds.get(binding.element).add(id);
        owners.set(binding.element, binding.element);
        for (const part of binding.parts) if (part.node) {
          included.add(part.node);
          for (let node = part.node; node; node = parentElement(node)) {
            owners.set(node, binding.element);
            if (node === binding.element) break;
          }
        }
      }
    }
    indexBindings();
    function invalidate() {
      if (stale || disconnected) return;
      stale = true;
      cancelVisibilityScan();
      observer?.disconnect();
      notify();
    }
    function contains(scope, node) {
      for (let current = node; current; current = current.parentNode || current.host) {
        if (current === scope) return true;
      }
      // Slotted light-DOM text follows its composed owner.
      for (let current = node; current; current = parentElement(current)) {
        if (current === scope) return true;
      }
      return false;
    }
    function scopeFor(node) {
      for (let current = node; current; current = parentElement(current)) {
        const owner = owners.get(current);
        if (owner?.isConnected) return owner;
        if (current.nodeType === 1) {
          const display = view.getComputedStyle(current).display;
          if (!['inline', 'contents', 'ruby', 'ruby-text'].includes(display) || current.shadowRoot ||
              /^(BUTTON|TD|TH|LI|DT|DD|H[1-6])$/u.test(current.tagName)) return current;
        }
      }
      return root;
    }
    function hasIncluded(node) {
      if (included.has(node)) return true;
      return [...(node.childNodes || []), ...(node.shadowRoot?.childNodes || [])].some(hasIncluded);
    }
    function hasSourceText(node) {
      if (node.nodeType === 3) return Boolean(node.nodeValue?.trim()) && !omitted(parentElement(node));
      if (node.nodeType === 1 && omitted(node)) return false;
      return [...(node.childNodes || []), ...(node.shadowRoot?.childNodes || [])].some(hasSourceText);
    }
    function retireOwner(element) {
      let retired = false;
      for (const id of ownerIds.get(element) || []) { bindings.delete(id); retired = true; }
      ownerIds.delete(element);
      for (let index = pendingParagraphs.length - 1; index >= 0; index--) {
        if (!bindings.has(pendingParagraphs[index].paragraphId)) pendingParagraphs.splice(index, 1);
      }
      return retired;
    }
    function sourceOwners(node, result) {
      const owner = owners.get(node);
      if (owner) result.add(owner);
      for (const child of [...(node.childNodes || []), ...(node.shadowRoot?.childNodes || [])]) sourceOwners(child, result);
    }
    function ownerSourceUnchanged(element) {
      if (!element.isConnected) return false;
      for (const id of ownerIds.get(element) || []) {
        const binding = bindings.get(id);
        if (binding.parts.some(part => part.node && (!part.node.isConnected ||
            part.node.nodeValue !== (part.sourceText ?? part.raw) || omitted(parentElement(part.node))))) return false;
      }
      const before = sourceStructures.get(element) || [];
      const current = sourceStructure(element);
      return before.length === current.length && before.every((node, index) => node === current[index]);
    }
    function ownerSourceCurrent(element) {
      const cached = sourceValidity.get(element);
      if (!processing && cached?.revision === sourceRevision) return cached.current;
      const current = ownerSourceUnchanged(element);
      sourceValidity.set(element, { revision: sourceRevision, current });
      return current;
    }
    function refreshScope(scope) {
      const iterator = refreshSteps(scope);
      let step;
      do { step = iterator.next(); } while (!step.done);
      return step.value?.() || false;
    }
    function* refreshSteps(scope) {
      if (!root?.isConnected || root !== (document.body || document.documentElement)) { invalidate(); return; }
      const retiring = new Set();
      const old = [];
      for (const binding of bindings.values()) {
        if (!binding.element.isConnected) retiring.add(binding.element);
        else if (contains(scope, binding.element)) old.push(binding);
        yield;
      }
      if (!scope?.isConnected) return () => {
        let retired = false;
        for (const element of retiring) retired = retireOwner(element) || retired;
        if (retired) indexBindings();
        return retired;
      };
      let next;
      try { next = yield* collectSteps(scope); }
      catch (_) {
        // A geometry/complexity failure during a live refresh cannot leave an
        // older searchable snapshot valid. Initial construction still reports
        // its explicit error through the caller's normal failure path.
        invalidate(); return;
      }
      // Unchanged owners keep their bindings/scores. New content receives new
      // IDs; existing owners must retain text, order and source identity.
      const oldByOwner = new Map();
      for (const binding of old) {
        if (!oldByOwner.has(binding.element)) oldByOwner.set(binding.element, []);
        oldByOwner.get(binding.element).push(binding);
        yield;
      }
      const nextByOwner = new Map();
      for (const binding of next.entries) {
        if (!nextByOwner.has(binding.element)) nextByOwner.set(binding.element, []);
        nextByOwner.get(binding.element).push(binding);
        yield;
      }
      const nextBoundaries = new Set(nextByOwner.keys());
      const nextContainers = sourceContainersFor(next.entries);
      const matched = new Map();
      const nextStructures = new Map();
      const nextRenderedStates = new Map();
      let visibilityChanged = false;
      for (const [element, previous] of oldByOwner) {
        const current = nextByOwner.get(element) || [];
        const sameText = previous.length === current.length &&
          previous.every((entry, index) => entry.text === current[index].text);
        if (!sameText) {
          const originalNodes = new Set(previous.flatMap(entry => entry.parts.filter(part => part.node).map(part => part.node)));
          const unchangedSource = previous.every(entry => entry.parts.every(part => !part.node ||
            (part.node.isConnected && part.node.nodeValue === (part.sourceText ?? part.raw))));
          const onlyOriginalNodes = current.every(entry => entry.parts.every(part => !part.node || originalNodes.has(part.node)));
          const beforeStructure = sourceStructures.get(element) || [];
          const currentStructure = sourceStructure(element, nextBoundaries, nextContainers);
          const sameStructure = beforeStructure.length === currentStructure.length &&
            beforeStructure.every((node, index) => node === currentStructure[index]);
          // Scrolling can hide an already indexed control or alter clipping.
          // Keep only the original, previously visible text; changed/deleted
          // Text nodes or sentence structure retire only this owner's IDs.
          // Other source paragraphs and already earned scores stay usable.
          if (!unchangedSource || !onlyOriginalNodes || !sameStructure) {
            retiring.add(element);
            oldByOwner.delete(element);
            yield;
            continue;
          }
        }
        const previousState = renderedStates.get(element) ?? previous.map(entry => entry.text).join('\u0000');
        const currentState = current.map(entry => entry.text).join('\u0000');
        if (previousState !== currentState) visibilityChanged = true;
        nextRenderedStates.set(element, currentState);
        previous.forEach((entry, index) => matched.set(entry, sameText ? current[index] : entry));
        if (sameText) nextStructures.set(element, sourceStructure(element, nextBoundaries, nextContainers));
        yield;
      }
      const additions = next.entries.filter(entry => !oldByOwner.has(entry.element) &&
        !entry.parts.some(part => part.node && included.has(part.node) && !retiring.has(owners.get(part.node))));
      const retained = old.filter(binding => matched.has(binding));
      let changed = false;
      for (const binding of retained) {
        const nextBinding = matched.get(binding);
        changed = changed || binding.element !== nextBinding.element || binding.parts.length !== nextBinding.parts.length ||
          binding.parts.some((part, partIndex) => {
            const nextPart = nextBinding.parts[partIndex];
            return part.node !== nextPart.node || part.raw !== nextPart.raw || part.gap !== nextPart.gap ||
              part.sourceStart !== nextPart.sourceStart || part.sourceText !== nextPart.sourceText;
          });
        yield;
      }
      // No live binding/cache/admission changes are made before this commit.
      // A newer mutation can cancel the iterator at every yield boundary.
      return () => {
        // Mutation delivery is drained by the caller. Check the actual captured
        // Text values as well before any candidate becomes a live binding.
        if (next.entries.some(entry => entry.parts.some(part => part.node &&
            (!part.node.isConnected || part.node.nodeValue !== (part.sourceText ?? part.raw))))) {
          cancelVisibilityScan();
          queueVisibilityScan();
          scheduleVisibilitySlice();
          return false;
        }
        let retired = false;
        // A structure-only refresh can change the source cache without needing
        // indexBindings; invalidate both positive and negative owner memo entries.
        sourceRevision++;
        for (const container of nextContainers) sourceContainers.add(container);
        for (const element of retiring) retired = retireOwner(element) || retired;
        for (const [element, structure] of nextStructures) sourceStructures.set(element, structure);
        for (const [element, state] of nextRenderedStates) renderedStates.set(element, state);
        if (changed) retained.forEach(binding => Object.assign(binding, matched.get(binding)));
        for (const shadow of next.roots) if (!roots.has(shadow)) {
          roots.add(shadow);
          observer?.observe(shadow, observerOptions);
        }
        let admitted = false;
        const attemptedAdmission = additions.length && !additionalError;
        if (attemptedAdmission) {
          const values = additions.map((entry, index) => ({
            paragraphId: `semantic-dom-${serial + index + 1}`, text: entry.text, sectionTitle: ''
          }));
          try {
            reserveParagraphs(values);
            for (const entry of additions) sourceBoundaries.add(entry.element);
            additions.forEach((entry, index) => {
              bindings.set(values[index].paragraphId, entry);
              sourceStructures.set(entry.element, sourceStructure(entry.element));
            });
            serial += additions.length;
            pendingParagraphs.push(...values);
            admitted = true;
            hasAdditionalContent = true;
          } catch (error) {
            additionalError = error;
          }
        }
        if (retired || changed || admitted) indexBindings();
        if (attemptedAdmission) {
          const started = now();
          try { additional(); }
          finally { counters.maxAdditionalNotificationMs = Math.max(counters.maxAdditionalNotificationMs, now() - started); }
        }
        return changed || visibilityChanged || retired;
      };
    }

    function cancelVisibilityScan() {
      visibilityGeneration++;
      if (visibilityJob) counters.cancelledVisibilityScans++;
      visibilityJob = null;
      if (visibilityTimer !== null) unschedule(visibilityTimer);
      visibilityTimer = null;
    }
    function scheduleVisibilitySlice() {
      if (visibilityTimer === null && visibilityJob && !stale && !disconnected) {
        visibilityTimer = schedule(() => { visibilityTimer = null; runVisibilitySlice(); });
      }
    }
    function queueVisibilityScan() {
      visibilityJob = { generation: visibilityGeneration, iterator: refreshSteps(root) };
    }
    function runVisibilitySlice() {
      if (pumpingVisibility || processing || !visibilityJob || stale || disconnected) return;
      if (!root?.isConnected || root !== (document.body || document.documentElement)) { invalidate(); return; }
      pumpingVisibility = true;
      const start = now();
      counters.visibilitySlices++;
      try {
        // MutationObserver delivery and synchronous callers share this boundary.
        // Drain before resuming or committing, so an older iterator never wins.
        process(observer?.takeRecords() || []);
        const job = visibilityJob;
        if (!job || stale || disconnected) return;
        let step;
        do {
          if (job !== visibilityJob || job.generation !== visibilityGeneration) return;
          step = job.iterator.next();
          if (step.done) {
            process(observer?.takeRecords() || []);
            if (job !== visibilityJob || job.generation !== visibilityGeneration || stale || disconnected) return;
            visibilityJob = null;
            const commitStart = now();
            const remapped = step.value?.() || false;
            counters.maxVisibilityCommitMs = Math.max(counters.maxVisibilityCommitMs, now() - commitStart);
            if (remapped && !stale && !disconnected) {
              const notifyStart = now();
              try { rebound(); }
              finally { counters.maxVisibilityReboundMs = Math.max(counters.maxVisibilityReboundMs, now() - notifyStart); }
            }
            return;
          }
        } while (now() - start < VISIBILITY_SLICE_MS);
      } catch (_) {
        invalidate();
      } finally {
        counters.maxVisibilitySliceMs = Math.max(counters.maxVisibilitySliceMs, now() - start);
        pumpingVisibility = false;
        scheduleVisibilitySlice();
      }
    }
    function process(records) {
      if (stale || disconnected || processing || !records.length) return;
      sourceRevision++;
      processing = true;
      counters.mutationBatches++;
      const scopes = new Set();
      const removedOwners = new Set();
      let needsVisibility = false;
      try {
        for (const record of records) {
          const element = record.target.nodeType === 1 ? record.target : parentElement(record.target);
          if (element?.closest?.('[data-sci-plugin-ui]') && !hasIncluded(record.target)) continue;
          if (element?.matches?.('style,link[rel="stylesheet"]') || (record.type === 'childList' &&
              [...record.addedNodes, ...record.removedNodes].some(node =>
                node.matches?.('style,link[rel="stylesheet"]') && !node.matches('[data-sci-plugin-ui]')))) {
            needsVisibility = true; continue;
          }
          if (record.type === 'attributes' && (record.attributeName === 'slot' ||
              (record.attributeName === 'name' && element?.tagName === 'SLOT'))) {
            // Assignment can change both the old and receiving composed owners,
            // including fallback text. Check the host's sources synchronously;
            // the attribute's separate CSS effects still use the sliced scan.
            const host = record.attributeName === 'slot' ? record.target.parentNode : element.getRootNode?.()?.host;
            sourceOwners(host?.shadowRoot ? host : record.target, removedOwners);
            needsVisibility = true;
          }
          if (omitted(element) && !hasIncluded(record.target)) continue;
          if (record.type === 'characterData') {
            if (included.has(record.target) || record.target.nodeValue?.trim()) {
              const scope = scopeFor(record.target);
              if (scope !== root || ownerIds.has(scope)) scopes.add(scope);
              else needsVisibility = true;
            }
          } else if (record.type === 'childList') {
            if ([...record.removedNodes].some(hasIncluded) || [...record.addedNodes].some(hasSourceText)) {
              const scope = scopeFor(record.target);
              if (ownerIds.has(scope)) scopes.add(scope);
              else {
                needsVisibility = true;
                for (const node of record.removedNodes) sourceOwners(node, removedOwners);
              }
            }
          } else if (record.type === 'attributes') {
            // Any HTML/ARIA/custom attribute can occur in a CSS selector,
            // including :has or sibling selectors outside this subtree. Compare
            // rendered corpus after coalescing; irrelevant attribute noise does
            // not invalidate or repaint. Even [style] can affect other elements.
            const scope = scopeFor(record.target);
            // Exclusion removal and composed-source changes are structural,
            // regardless of which attribute triggered them. Validate the local
            // owner now; its visibility and CSS dependencies can finish later.
            if (ownerIds.has(scope)) removedOwners.add(scope);
            needsVisibility = true;
            if (omitted(element) && hasIncluded(record.target)) {
              // Conversion of existing source into an editor/plugin is a source
              // exclusion, not merely visibility: reject its ranges immediately.
              scopes.add(scope);
            } else if (record.attributeName === 'style' && scope !== root) scopes.add(scope);
          }
        }
        if (scopes.size || needsVisibility) {
          needsVisibility = needsVisibility || Boolean(visibilityJob);
          cancelVisibilityScan();
        }
        const minimal = [...scopes].filter(scope => ![...scopes].some(other =>
          other !== scope && contains(other, scope)));
        let remapped = false;
        for (const owner of removedOwners) if (!ownerSourceCurrent(owner)) remapped = retireOwner(owner) || remapped;
        if (remapped) indexBindings();
        for (const scope of minimal) {
          remapped = refreshScope(scope) || remapped;
          if (stale) return;
        }
        if (remapped) { indexBindings(); rebound(); }
        if (needsVisibility && !stale && !disconnected) queueVisibilityScan();
      } finally { processing = false; }
      if (visibilityJob && !pumpingVisibility) runVisibilitySlice();
    }
    const observerOptions = { subtree: true, childList: true, characterData: true, attributes: true };
    observer = new view.MutationObserver(process);
    for (const observedRoot of roots) observer.observe(
      observedRoot === root ? document.documentElement || root : observedRoot, observerOptions);
    // Styles in head can change body text visibility too; plugin styles are ignored.
    if (document.head) observer.observe(document.head, observerOptions);
    const checkLayout = event => {
      if (event?.target?.closest?.('[data-sci-plugin-ui]') || stale || disconnected) return;
      cancelVisibilityScan();
      queueVisibilityScan();
      runVisibilitySlice();
    };
    view.addEventListener('resize', checkLayout);
    document.addEventListener('transitionend', checkLayout, true);
    document.addEventListener('animationend', checkLayout, true);
    const onStylesheetLoad = event => {
      if (event.target?.matches?.('link[rel="stylesheet"]')) checkLayout(event);
    };
    document.addEventListener('load', onStylesheetLoad, true);

    function rangesFor(hit) {
      // Public range callers can arrive before MutationObserver delivery. Drain
      // records first and validate just this owner's full composed source once
      // per revision; checking only its old Text values misses inserted words.
      if (!processing) process(observer?.takeRecords() || []);
      const binding = bindings.get(hit.paragraphId);
      if (stale || disconnected || !binding || !Number.isInteger(hit.start) ||
          !Number.isInteger(hit.end) || hit.start < 0 || hit.end <= hit.start ||
          binding.text.slice(hit.start, hit.end) !== hit.text || !ownerSourceCurrent(binding.element)) return [];
      const rawStart = binding.rawStarts[hit.start];
      const rawEnd = binding.rawEnds[hit.end - 1];
      let position = 0;
      const runs = [];
      let run = null;
      for (const part of binding.parts) {
        const limit = position + part.raw.length;
        if (part.gap) run = null;
        if (part.node) {
          if (!part.node.isConnected || part.node.nodeValue !== (part.sourceText ?? part.raw)) return [];
          if (omitted(parentElement(part.node))) return [];
          if (rawStart < limit && rawEnd > position) {
            const sourceStart = part.sourceStart || 0;
            const start = { node: part.node, offset: sourceStart + Math.max(0, rawStart - position) };
            const end = { node: part.node, offset: sourceStart + Math.min(part.raw.length, rawEnd - position) };
            if (!run || run.end.node.getRootNode() !== part.node.getRootNode()) {
              run = { start, end }; runs.push(run);
            } else run.end = end;
          }
        }
        position = limit;
      }
      return runs.map(({ start, end }) => {
        const range = document.createRange();
        range.setStart(start.node, start.offset);
        range.setEnd(end.node, end.offset);
        return range;
      });
    }
    return {
      paragraphs, bindings, roots, counters,
      get hasAdditionalContent() { return hasAdditionalContent; },
      get hasLoadedSummaries() { return summarySources.size > 0; },
      get pendingVisibilityScan() { return Boolean(visibilityJob); },
      isHitCurrent(hit) { return this.isCurrent() && rangesFor(hit).length > 0; },
      drainAdditionalParagraphs() {
        if (!this.isCurrent()) throw Object.assign(new Error('网页原文已变化，无法继续补充检索。'),
          { code: 'SEMANTIC_FIND_SOURCE_STALE' });
        if (pendingParagraphs.length) return pendingParagraphs.splice(0);
        if (additionalError) throw additionalError;
        return [];
      },
      ranges: rangesFor,
      isVisible(hit) {
        return rangesFor(hit).some(range => {
          let rects = [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0);
          for (let element = parentElement(range.startContainer); element; element = parentElement(element)) {
            const css = view.getComputedStyle(element);
            if (element.hidden || css.display === 'none' || ['hidden', 'collapse'].includes(css.visibility) ||
                css.contentVisibility === 'hidden' || Number(css.opacity) === 0) return false;
            if (['inline', 'contents'].includes(css.display) || element === document.body || element === document.documentElement) continue;
            const box = element.getBoundingClientRect();
            if (/^(hidden|clip)$/u.test(css.overflowX)) rects = rects.filter(rect => rect.right > box.left && rect.left < box.right);
            if (/^(hidden|clip)$/u.test(css.overflowY)) rects = rects.filter(rect => rect.bottom > box.top && rect.top < box.bottom);
          }
          return rects.length > 0;
        });
      },
      reveal(hit) {
        if (!this.isCurrent()) return false;
        const ranges = rangesFor(hit);
        if (!ranges.length) return false;
        for (const range of ranges) {
          const summary = summaryFor(range.startContainer);
          if (!summary) continue;
          const container = summarySources.get(summary);
          for (const element of [container, summary]) {
            element.hidden = false;
            element.style.setProperty('display', 'block', 'important');
            element.style.setProperty('max-height', 'none', 'important');
            element.style.setProperty('height', 'auto', 'important');
            element.style.setProperty('overflow', 'visible', 'important');
          }
          for (const duplicate of duplicateSummaries) {
            if (container.contains(duplicate)) duplicate.style.setProperty('display', 'none', 'important');
          }
        }
        return this.isCurrent();
      },
      range(hit) { const ranges = rangesFor(hit); return ranges.length === 1 ? ranges[0] : null; },
      isCurrent() {
        if (!root?.isConnected || root !== (document.body || document.documentElement)) invalidate();
        if (!processing) process(observer?.takeRecords() || []);
        return !stale && !disconnected;
      },
      watch(onStale, onRebound, onAdditionalContent) {
        notify = onStale || notify; rebound = onRebound || rebound;
        additional = onAdditionalContent || additional;
      },
      disconnect() {
        disconnected = true;
        cancelVisibilityScan();
        observer?.disconnect();
        view.removeEventListener('resize', checkLayout);
        document.removeEventListener('transitionend', checkLayout, true);
        document.removeEventListener('animationend', checkLayout, true);
        document.removeEventListener('load', onStylesheetLoad, true);
      }
    };
  }
  return { createSemanticFindDomSnapshot };
});
