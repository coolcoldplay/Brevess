(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const DEFAULT_SCALE = 1.35;
  const DEFAULT_MIN_SCALE = 0.5;
  const DEFAULT_MAX_SCALE = 3;
  const DEFAULT_OVERSCAN = 1;
  const DEFAULT_MAX_LIVE_PAGES = 7;
  const MAX_OVERSCAN = 64;
  const MAX_LIVE_PAGES = 64;
  const MAX_CONFIGURED_SCALE = 100;
  const HUNDREDTH_TOLERANCE = 1e-9;

  function finiteNumber(value) {
    try {
      const number = Number(value);
      return Number.isFinite(number) ? number : null;
    } catch (_) {
      return null;
    }
  }

  function positiveNumber(value, fallback, maximum = Number.MAX_VALUE) {
    const number = finiteNumber(value);
    return number !== null && number > 0 && number <= maximum ? number : fallback;
  }

  function boundedNonNegativeInteger(value, fallback, maximum) {
    const number = finiteNumber(value);
    return number !== null && number >= 0
      ? Math.min(maximum, Math.floor(number)) : fallback;
  }

  function boundedPositiveInteger(value, fallback, maximum) {
    const number = finiteNumber(value);
    return number !== null && number >= 1
      ? Math.min(maximum, Math.floor(number)) : fallback;
  }

  function lowerHundredth(value) {
    return Math.floor((value * 100) + HUNDREDTH_TOLERANCE) / 100;
  }

  function upperHundredth(value) {
    return Math.ceil((value * 100) - HUNDREDTH_TOLERANCE) / 100;
  }

  function createPdfNativeReaderState(options = {}) {
    const safeOptions = options && typeof options === 'object' ? options : {};
    let requestedMinScale = positiveNumber(
      safeOptions.minScale,
      DEFAULT_MIN_SCALE,
      MAX_CONFIGURED_SCALE
    );
    let requestedMaxScale = positiveNumber(
      safeOptions.maxScale,
      DEFAULT_MAX_SCALE,
      MAX_CONFIGURED_SCALE
    );
    if (requestedMaxScale < requestedMinScale) {
      [requestedMinScale, requestedMaxScale] = [requestedMaxScale, requestedMinScale];
    }
    let minScale = upperHundredth(requestedMinScale);
    let maxScale = lowerHundredth(requestedMaxScale);
    if (minScale <= 0 || maxScale < minScale) {
      minScale = DEFAULT_MIN_SCALE;
      maxScale = DEFAULT_MAX_SCALE;
    }
    const overscan = boundedNonNegativeInteger(
      safeOptions.overscan,
      DEFAULT_OVERSCAN,
      MAX_OVERSCAN
    );
    const maxLivePages = boundedPositiveInteger(
      safeOptions.maxLivePages,
      DEFAULT_MAX_LIVE_PAGES,
      MAX_LIVE_PAGES
    );

    function normalizeScale(value, fallback) {
      const number = finiteNumber(value);
      const candidate = number !== null && number > 0 ? number : fallback;
      const clamped = Math.min(maxScale, Math.max(minScale, candidate));
      return Math.round(clamped * 100) / 100;
    }

    let scale = normalizeScale(safeOptions.initialScale, DEFAULT_SCALE);
    let fitWidthMode = false;

    return Object.freeze({
      getScale() {
        return scale;
      },

      setScale(value) {
        const requested = finiteNumber(value);
        if (requested !== null && requested > 0) fitWidthMode = false;
        scale = normalizeScale(value, scale);
        return scale;
      },

      fitWidth(input = {}) {
        if (!input || typeof input !== 'object') return scale;
        const pageWidth = finiteNumber(input.pageWidth);
        const containerWidth = finiteNumber(input.containerWidth);
        const suppliedPadding = input.padding === undefined ? 32 : finiteNumber(input.padding);
        const padding = suppliedPadding !== null && suppliedPadding >= 0
          ? suppliedPadding : 32;
        if (pageWidth === null || pageWidth <= 0 ||
            containerWidth === null || containerWidth <= padding) return scale;
        scale = normalizeScale((containerWidth - padding) / pageWidth, scale);
        fitWidthMode = true;
        return scale;
      },

      isFitWidth() {
        return fitWidthMode;
      },

      pageWindow(input = {}) {
        if (!input || typeof input !== 'object') return [];
        const pageCount = boundedPositiveInteger(
          input.pageCount,
          0,
          Number.MAX_SAFE_INTEGER
        );
        if (pageCount < 1) return [];
        const firstValue = finiteNumber(input.firstVisible);
        const lastValue = finiteNumber(input.lastVisible);
        const boundedFirst = Math.min(pageCount, Math.max(1,
          Math.floor(firstValue === null ? 1 : firstValue)));
        const boundedLast = Math.min(pageCount, Math.max(1,
          Math.floor(lastValue === null ? boundedFirst : lastValue)));
        const firstVisible = Math.min(boundedFirst, boundedLast);
        const lastVisible = Math.max(boundedFirst, boundedLast);
        const visibleSpan = lastVisible - firstVisible + 1;
        if (visibleSpan > maxLivePages) {
          return Array.from(
            { length: maxLivePages },
            (_, index) => firstVisible + index
          );
        }

        const remaining = maxLivePages - visibleSpan;
        const desiredBefore = Math.min(overscan, firstVisible - 1);
        const desiredAfter = Math.min(overscan, pageCount - lastVisible);
        let before = desiredBefore;
        let after = desiredAfter;
        if (before + after > remaining) {
          before = Math.min(desiredBefore, Math.ceil(remaining / 2));
          after = Math.min(desiredAfter, remaining - before);
          let unused = remaining - before - after;
          if (unused > 0) {
            const extraBefore = Math.min(desiredBefore - before, unused);
            before += extraBefore;
            unused -= extraBefore;
          }
          if (unused > 0) after += Math.min(desiredAfter - after, unused);
        }
        const start = firstVisible - before;
        const length = before + visibleSpan + after;
        return Array.from({ length }, (_, index) => start + index);
      }
    });
  }

  function createPdfNativeCommandQueue(options = {}) {
    const safeOptions = options && typeof options === 'object' ? options : {};
    const maxCommands = boundedPositiveInteger(safeOptions.maxCommands, 32, 128);
    let commands = [];
    return Object.freeze({
      enqueue(name, ...args) {
        const normalizedName = String(name || '');
        if (!/^[A-Za-z][A-Za-z0-9]{0,48}$/.test(normalizedName)) return false;
        commands.push({ name: normalizedName, args: args.slice(0, 8) });
        if (commands.length > maxCommands) commands = commands.slice(-maxCommands);
        return true;
      },
      drain(target) {
        const pending = commands;
        commands = [];
        return pending.map(command => {
          const method = target?.[command.name];
          return typeof method === 'function'
            ? method.apply(target, command.args) : undefined;
        });
      },
      size() {
        return commands.length;
      }
    });
  }

  function createPdfNativeBridgeController(options = {}) {
    const safeOptions = options && typeof options === 'object' ? options : {};
    const queue = createPdfNativeCommandQueue(safeOptions);
    let reader = null;
    return Object.freeze({
      command(name, ...args) {
        const method = reader?.[name];
        if (typeof method === 'function') return method.apply(reader, args);
        queue.enqueue(name, ...args);
        return undefined;
      },
      onReady(api) {
        reader = api && typeof api === 'object' ? api : null;
        if (typeof safeOptions.onReady === 'function') safeOptions.onReady(reader);
        return reader ? queue.drain(reader) : [];
      },
      onState(next) {
        if (typeof safeOptions.onState === 'function') safeOptions.onState(next);
      },
      getReader() {
        return reader;
      }
    });
  }

  function selectPdfNativePage(records, viewerRect) {
    const top = finiteNumber(viewerRect?.top);
    const bottom = finiteNumber(viewerRect?.bottom);
    if (top === null || bottom === null || bottom <= top || !Array.isArray(records)) {
      return null;
    }
    return records
      .filter(record => {
        const recordTop = finiteNumber(record?.top);
        const recordBottom = finiteNumber(record?.bottom);
        return recordTop !== null && recordBottom !== null &&
          recordBottom > top && recordTop < bottom;
      })
      .sort((left, right) => Math.abs(left.top - top) - Math.abs(right.top - top))[0] || null;
  }

  function pdfNativeScrollDelta(beforeTop, afterTop) {
    const before = finiteNumber(beforeTop);
    const after = finiteNumber(afterTop);
    return before === null || after === null ? 0 : after - before;
  }

  function pdfNativeAnchoredScrollTop(input = {}) {
    const scrollTop = finiteNumber(input?.scrollTop);
    if (scrollTop === null) return 0;
    return Math.max(0, scrollTop + pdfNativeScrollDelta(
      input?.anchorTop,
      input?.nextAnchorTop
    ));
  }

  function pdfNativeContentWidth(input = {}) {
    const width = finiteNumber(input?.clientWidth);
    const left = finiteNumber(parseFloat(input?.paddingLeft)) || 0;
    const right = finiteNumber(parseFloat(input?.paddingRight)) || 0;
    return width === null ? 0 : Math.max(0, width - Math.max(0, left) - Math.max(0, right));
  }

  function pdfNativeUnscaledPageWidth(page) {
    try {
      return positiveNumber(page?.getViewport?.({ scale: 1 })?.width, 0);
    } catch (_) {
      return 0;
    }
  }

  function setPdfNativeSurface(surface, mode = 'native') {
    const fallback = mode === 'fallback';
    if (surface?.viewer) surface.viewer.hidden = fallback;
    if (surface?.frame) surface.frame.hidden = !fallback;
    return fallback ? 'fallback' : 'native';
  }

  function setPdfReaderViewSurface(surface, view = 'original') {
    const next = view === 'original' ? 'original' : 'parsed';
    if (surface?.originalViewer) surface.originalViewer.hidden = next !== 'original';
    if (surface?.parsedWorkspace) surface.parsedWorkspace.hidden = next === 'original';
    if (surface?.control) {
      surface.control.hidden = next === 'original' &&
        surface.control.dataset?.state === 'idle';
    }
    if (next === 'original') surface?.nativeReader?.activate?.();
    else surface?.nativeReader?.deactivate?.();
    if (surface?.toggle) {
      surface.toggle.textContent = next === 'original' ? '返回解析结果' : '查看原始 PDF';
      surface.toggle.setAttribute?.('aria-pressed', String(next === 'original'));
    }
    return next;
  }

  function cancelPdfNativeRenders(records) {
    for (const record of Array.from(records || [])) {
      try {
        record?.renderTask?.cancel?.();
      } catch (_) {}
    }
  }

  function createPdfNativeResizeScheduler(callback, options = {}) {
    const safeOptions = options && typeof options === 'object' ? options : {};
    const setTimer = typeof safeOptions.setTimer === 'function'
      ? safeOptions.setTimer : setTimeout;
    const clearTimer = typeof safeOptions.clearTimer === 'function'
      ? safeOptions.clearTimer : clearTimeout;
    const delay = Math.min(500, Math.max(16, finiteNumber(safeOptions.delay) || 100));
    let timer = null;
    return Object.freeze({
      schedule() {
        if (timer !== null) clearTimer(timer);
        timer = setTimer(() => {
          timer = null;
          callback();
        }, delay);
      },
      cancel() {
        if (timer !== null) clearTimer(timer);
        timer = null;
      }
    });
  }

  function createPdfNativeRenderGeneration() {
    let generation = 0;
    let controller = new AbortController();
    return Object.freeze({
      next() {
        controller.abort();
        controller = new AbortController();
        generation += 1;
        return generation;
      },
      current() {
        return generation;
      },
      capture() {
        return Object.freeze({ generation, signal: controller.signal });
      },
      isCurrent(value) {
        const token = value && typeof value === 'object' ? value.generation : value;
        const signal = value && typeof value === 'object' ? value.signal : null;
        return token === generation && !signal?.aborted;
      },
      abort() {
        controller.abort();
      }
    });
  }

  function createPdfNativeLifecycle() {
    let generation = 0;
    let terminal = false;
    return Object.freeze({
      begin() {
        if (!terminal) generation += 1;
        return generation;
      },
      fail() {
        terminal = true;
        generation += 1;
        return generation;
      },
      restart() {
        terminal = false;
        generation += 1;
        return generation;
      },
      canCommit(token) {
        return !terminal && token === generation;
      },
      isTerminal() {
        return terminal;
      }
    });
  }

  function createAbortError() {
    const error = new Error('PDF task cancelled');
    error.name = 'AbortError';
    return error;
  }

  function createPdfNativeTaskQueue(options = {}) {
    const concurrency = boundedPositiveInteger(options?.concurrency, 2, 8);
    const maxPending = boundedPositiveInteger(options?.maxPending, 24, 256);
    let active = 0;
    let order = 0;
    const pending = [];
    const activeEntries = new Set();
    const keyed = new Map();

    function entryKey(options = {}) {
      const key = String(options?.key || '');
      if (!key) return '';
      return `${finiteNumber(options?.generation) ?? 0}:${key.slice(0, 100)}`;
    }

    function forget(entry) {
      activeEntries.delete(entry);
      if (entry.mapKey && keyed.get(entry.mapKey) === entry.promise) keyed.delete(entry.mapKey);
      entry.detach?.();
    }

    function rejectEntry(entry) {
      entry.controller.abort();
      forget(entry);
      entry.reject(createAbortError());
    }

    function pump() {
      while (active < concurrency && pending.length > 0) {
        pending.sort((left, right) =>
          right.priority - left.priority || left.order - right.order
        );
        const entry = pending.shift();
        if (entry.controller.signal.aborted || entry.wanted?.() === false) {
          rejectEntry(entry);
          continue;
        }
        active += 1;
        activeEntries.add(entry);
        Promise.resolve().then(() => entry.task({ signal: entry.controller.signal }))
          .then(entry.resolve, entry.reject)
          .finally(() => {
            active -= 1;
            forget(entry);
            pump();
          });
      }
    }

    return Object.freeze({
      schedule(task, taskOptions = {}) {
        if (typeof task !== 'function') return Promise.reject(new TypeError('task required'));
        const mapKey = entryKey(taskOptions);
        if (mapKey && keyed.has(mapKey)) return keyed.get(mapKey);
        const priority = finiteNumber(taskOptions?.priority) || 0;
        if (pending.length >= maxPending) {
          const lowest = pending.slice().sort((left, right) =>
            left.priority - right.priority || right.order - left.order
          )[0];
          if (!lowest || priority <= lowest.priority) return Promise.reject(createAbortError());
          pending.splice(pending.indexOf(lowest), 1);
          rejectEntry(lowest);
        }
        const controller = new AbortController();
        const entry = {
          task, controller, priority, order: order++, mapKey,
          generation: finiteNumber(taskOptions?.generation) ?? 0,
          wanted: typeof taskOptions?.wanted === 'function' ? taskOptions.wanted : null,
          detach: null, resolve: null, reject: null, promise: null
        };
        entry.promise = new Promise((resolve, reject) => {
          entry.resolve = resolve;
          entry.reject = reject;
        });
        const externalSignal = taskOptions?.signal;
        if (externalSignal?.aborted) controller.abort();
        else if (externalSignal?.addEventListener) {
          const abort = () => controller.abort();
          externalSignal.addEventListener('abort', abort, { once: true });
          entry.detach = () => externalSignal.removeEventListener?.('abort', abort);
        }
        pending.push(entry);
        if (mapKey) keyed.set(mapKey, entry.promise);
        pump();
        return entry.promise;
      },
      cancelPending(predicate) {
        const cancelled = pending.filter(entry => !predicate || predicate(entry));
        cancelled.forEach(entry => {
          const index = pending.indexOf(entry);
          if (index >= 0) pending.splice(index, 1);
          rejectEntry(entry);
        });
        return cancelled.length;
      },
      pruneGeneration(generation) {
        let cancelled = this.cancelPending(entry => entry.generation !== generation);
        activeEntries.forEach(entry => {
          if (entry.generation !== generation && !entry.controller.signal.aborted) {
            entry.controller.abort();
            cancelled += 1;
          }
        });
        return cancelled;
      },
      cancelAll() {
        const cancelled = this.cancelPending();
        activeEntries.forEach(entry => entry.controller.abort());
        return cancelled + activeEntries.size;
      },
      activeCount() { return active; },
      pendingCount() { return pending.length; },
      stats() { return { active, pending: pending.length, concurrency }; }
    });
  }

  function createPdfNativeCanvasBudget(options = {}) {
    const maxPixels = boundedPositiveInteger(options?.maxPixels, 16_000_000, 128_000_000);
    const maxBytes = boundedPositiveInteger(options?.maxBytes, 64_000_000, 512_000_000);
    const maxLivePages = boundedPositiveInteger(options?.maxLivePages, 7, 64);
    const maxOutputScale = positiveNumber(options?.maxOutputScale, 2.5, 4);
    const entries = new Map();
    const reservations = new Map();
    let clock = 0;

    function usage() {
      let pixels = 0;
      let bytes = 0;
      entries.forEach(entry => {
        pixels += entry.pixels;
        bytes += entry.bytes;
      });
      reservations.forEach(entry => {
        pixels += entry.pixels;
        bytes += entry.bytes;
      });
      return { pixels, bytes, livePages: entries.size + reservations.size };
    }

    function normalizedEntry(input = {}) {
      const suppliedPixels = finiteNumber(input?.pixels);
      const pixels = Math.min(maxPixels, Math.max(1,
        Math.floor(suppliedPixels !== null ? suppliedPixels : 1)));
      const suppliedBytes = finiteNumber(input?.bytes);
      const bytes = Math.min(maxBytes, Math.max(1,
        Math.floor(suppliedBytes !== null ? suppliedBytes : pixels * 4)));
      return { pixels, bytes, touched: ++clock };
    }

    function protectedPageSet(values, ownPage) {
      const protectedPages = new Set(Array.from(values || [], value =>
        Math.max(1, Math.floor(finiteNumber(value) || 1))
      ));
      protectedPages.add(ownPage);
      return protectedPages;
    }

    function evictUntilWithinBudget(protectedPages, maxLiveCount) {
      const evicted = [];
      while (true) {
        const current = usage();
        if (current.pixels <= maxPixels && current.bytes <= maxBytes &&
            current.livePages <= maxLiveCount) return { accepted: true, evicted };
        const candidate = Array.from(entries.entries())
          .filter(([number]) => !protectedPages.has(number))
          .sort((left, right) => left[1].touched - right[1].touched)[0];
        if (!candidate) return { accepted: false, evicted: [] };
        entries.delete(candidate[0]);
        evicted.push(candidate[0]);
      }
    }

    function outputScale(input = {}) {
      const width = positiveNumber(input?.width, 1);
      const height = positiveNumber(input?.height, 1);
      const requested = Math.min(input?.offscreen && !input?.current ? 1 : maxOutputScale,
        positiveNumber(input?.requestedScale, 1, maxOutputScale));
      const usedPixels = Math.max(0, finiteNumber(input?.usedPixels) || 0);
      const usedBytes = Math.max(0, finiteNumber(input?.usedBytes) || 0);
      const basePixels = Math.max(1, width * height);
      const pixelScale = Math.sqrt(Math.max(1, maxPixels - usedPixels) / basePixels);
      const byteScale = Math.sqrt(Math.max(4, maxBytes - usedBytes) / (basePixels * 4));
      const availableScale = Math.min(requested, pixelScale, byteScale);
      if (availableScale < 1) return 0;
      return Math.floor(availableScale * 100) / 100;
    }

    return Object.freeze({
      outputScale,
      reserve(pageNumber, input = {}) {
        const key = Math.max(1, Math.floor(finiteNumber(pageNumber) || 1));
        const entrySnapshot = new Map(Array.from(entries, ([number, entry]) =>
          [number, { ...entry }]
        ));
        const token = Object.freeze({});
        reservations.set(token, { ...normalizedEntry(input), pageNumber: key });
        const result = evictUntilWithinBudget(
          protectedPageSet(input?.protectedPages, key),
          maxLivePages + (entries.has(key) ? 1 : 0)
        );
        if (!result.accepted) {
          reservations.delete(token);
          entries.clear();
          entrySnapshot.forEach((entry, number) => entries.set(number, entry));
          return { accepted: false, evicted: [], reservation: null };
        }
        return { accepted: true, evicted: result.evicted, reservation: token };
      },
      commit(reservation) {
        const staged = reservations.get(reservation);
        if (!staged) return false;
        reservations.delete(reservation);
        entries.set(staged.pageNumber, {
          pixels: staged.pixels, bytes: staged.bytes, touched: ++clock
        });
        return true;
      },
      rollback(reservation) {
        return reservations.delete(reservation);
      },
      admit(pageNumber, input = {}) {
        const key = Math.max(1, Math.floor(finiteNumber(pageNumber) || 1));
        const next = normalizedEntry(input);
        const snapshot = new Map(Array.from(entries, ([number, entry]) =>
          [number, { ...entry }]
        ));
        entries.set(key, next);
        const result = evictUntilWithinBudget(
          protectedPageSet(input?.protectedPages, key), maxLivePages
        );
        if (!result.accepted) {
          entries.clear();
          snapshot.forEach((entry, number) => entries.set(number, entry));
          return { accepted: false, evicted: [] };
        }
        return { accepted: true, evicted: result.evicted };
      },
      touch(pageNumber) {
        const entry = entries.get(Number(pageNumber));
        if (entry) entry.touched = ++clock;
      },
      release(pageNumber) {
        const key = Number(pageNumber);
        let released = entries.delete(key);
        for (const [token, reservation] of reservations) {
          if (reservation.pageNumber === key) {
            reservations.delete(token);
            released = true;
          }
        }
        return released;
      },
      clear() { entries.clear(); reservations.clear(); },
      usage
    });
  }

  function pdfNativeError(code) {
    const error = new Error(code);
    error.code = code;
    return error;
  }

  function sanitizePdfNativeLinkUrl(value) {
    try {
      const url = new URL(String(value || ''));
      return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.href : '';
    } catch (_) {
      return '';
    }
  }

  function normalizePdfNativePageImageRequest(pageNumber, options = {}, context = {}) {
    const normalizedPage = finiteNumber(pageNumber);
    const pageCount = boundedPositiveInteger(
      context?.pageCount,
      0,
      Number.MAX_SAFE_INTEGER
    );
    if (!Number.isSafeInteger(normalizedPage) || normalizedPage < 1 ||
        pageCount < 1 || normalizedPage > pageCount) {
      throw pdfNativeError('PDF_IMAGE_PAGE_OUT_OF_RANGE');
    }
    const safeOptions = options && typeof options === 'object' ? options : {};
    if (safeOptions.clip !== undefined && safeOptions.clip !== null) {
      throw pdfNativeError('PDF_IMAGE_CLIP_UNSUPPORTED');
    }
    const scale = safeOptions.scale === undefined ? 1.5 : finiteNumber(safeOptions.scale);
    if (scale === null || scale <= 0 || scale > 4) {
      throw pdfNativeError('PDF_IMAGE_SCALE_OUT_OF_RANGE');
    }
    return Object.freeze({ pageNumber: normalizedPage, scale, clip: null });
  }

  function validatePdfNativeImageDimensions(viewport, options = {}) {
    const width = Math.ceil(finiteNumber(viewport?.width) || 0);
    const height = Math.ceil(finiteNumber(viewport?.height) || 0);
    const maxPixels = boundedPositiveInteger(
      options?.maxPixels,
      16_000_000,
      128_000_000
    );
    if (width < 1 || height < 1) throw pdfNativeError('PDF_IMAGE_INVALID_DIMENSIONS');
    if (!Number.isSafeInteger(width * height) || width * height > maxPixels) {
      throw pdfNativeError('PDF_IMAGE_PIXEL_LIMIT_EXCEEDED');
    }
    return Object.freeze({ width, height, pixels: width * height });
  }

  function createPdfNativePageProjection(record, identity = {}) {
    const pageNumber = finiteNumber(record?.pageNumber);
    const generation = finiteNumber(identity?.documentGeneration);
    const renderGeneration = finiteNumber(identity?.renderGeneration);
    const textProjectionReady = record?.rendered === true ||
      (record?.textLayerReady === true && Number.isSafeInteger(renderGeneration) &&
        renderGeneration > 0 && record.textLayerRenderGeneration === renderGeneration);
    if (!record?.mounted || !textProjectionReady || !record.section || !record.textLayer ||
        !record.textContent || !record.viewport || !Number.isSafeInteger(pageNumber) ||
        pageNumber < 1 || !String(identity?.documentHash || '') ||
        !Number.isSafeInteger(generation) || generation < 1 ||
        record.documentHash !== identity.documentHash ||
        record.documentGeneration !== generation) return null;
    return {
      pageNumber,
      documentHash: identity.documentHash,
      documentGeneration: generation,
      viewport: record.viewport,
      pageElement: record.section,
      textLayer: record.textLayer,
      textContent: record.textContent
    };
  }

  async function destroyPdfNativeDocumentResources(input = {}) {
    try {
      if (input?.pdfDocument?.destroy) return await input.pdfDocument.destroy();
      return await input?.loadingTask?.destroy?.();
    } catch (_) {
      return undefined;
    }
  }

  function resetPdfReaderSourceOwnership(input = {}) {
    const objectUrl = String(input?.objectUrl || '');
    if (objectUrl && typeof input?.revokeObjectURL === 'function') {
      input.revokeObjectURL(objectUrl);
    }
    input?.nativeReader?.replaceDocument?.();
    return { objectUrl: '', nativePdfBytesPromise: null, localFileBytes: null };
  }

  function normalizePdfNativePageText(textContent, options = {}) {
    const maximum = boundedPositiveInteger(options?.maxLength, 50000, 200000);
    let result = '';
    for (const item of Array.isArray(textContent?.items) ? textContent.items : []) {
      const value = String(item?.str || '').normalize('NFKC').trim();
      if (!value) continue;
      if (result && !result.endsWith('\n')) result += ' ';
      result += value;
      if (item?.hasEOL) result += '\n';
      if (result.length >= maximum) break;
    }
    return result.replace(/[ \t]+\n/g, '\n').replace(/[ \t]{2,}/g, ' ')
      .trim().slice(0, maximum);
  }

  function classifyPdfNativePageContent(textContent, operatorList = {}, operators = {}) {
    const hasText = normalizePdfNativePageText(textContent, { maxLength: 30 }).length > 0;
    const fnArray = Array.isArray(operatorList?.fnArray) ? operatorList.fnArray : [];
    const imageOperators = new Set([
      operators.paintImageXObject,
      operators.paintInlineImageXObject,
      operators.paintImageMaskXObject,
      operators.paintImageMaskXObjectGroup,
      operators.paintImageXObjectRepeat,
      operators.paintImageMaskXObjectRepeat,
      operators.paintSolidColorImageMask
    ].map(Number).filter(Number.isFinite));
    const hasImage = fnArray.some(operation => imageOperators.has(Number(operation)));
    return {
      textStatus: hasText ? 'full' : 'empty',
      hasVisualContent: hasText || fnArray.length > 0,
      ocrCandidate: !hasText && hasImage
    };
  }

  function createPdfNativeTextBudget(options = {}) {
    const maxChars = boundedPositiveInteger(options?.maxChars, 4_000_000, 20_000_000);
    const entries = new Map();
    let characters = 0;
    return Object.freeze({
      retain(pageNumber, value) {
        const key = Math.max(1, Math.floor(finiteNumber(pageNumber) || 1));
        const next = String(value || '');
        const previous = entries.get(key) || '';
        const projected = characters - previous.length + next.length;
        if (projected > maxChars) return { accepted: false, text: '' };
        entries.set(key, next);
        characters = projected;
        return { accepted: true, text: next };
      },
      release(pageNumber) {
        const key = Math.max(1, Math.floor(finiteNumber(pageNumber) || 1));
        const previous = entries.get(key);
        if (previous === undefined) return false;
        characters -= previous.length;
        return entries.delete(key);
      },
      clear() { entries.clear(); characters = 0; },
      usage() { return { characters, pages: entries.size, maxChars }; }
    });
  }

  function yieldPdfNativePaint(windowObject = globalThis) {
    return new Promise(resolve => {
      let done = false, taskTimer, frame;
      const finish = () => {
        if (done) return;
        done = true;
        windowObject.clearTimeout(deadline);
        windowObject.clearTimeout(taskTimer);
        if (frame !== undefined) windowObject.cancelAnimationFrame?.(frame);
        resolve();
      };
      // Hidden readers can suspend RAF indefinitely. Keep both paths bounded.
      const deadline = windowObject.setTimeout(finish, 50);
      const afterPaint = () => {
        if (!done) taskTimer = windowObject.setTimeout(finish, 0);
      };
      if (!windowObject.requestAnimationFrame ||
          windowObject.document?.visibilityState === 'hidden') afterPaint();
      else frame = windowObject.requestAnimationFrame(afterPaint);
    });
  }

  function createPdfNativePageTextCache(options = {}) {
    const maxPages = boundedPositiveInteger(options.maxPages, 12, 32);
    const maxItems = boundedPositiveInteger(options.maxItems, 24000, 100000);
    const maxChars = boundedPositiveInteger(options.maxChars, 500000, 2000000);
    const entries = new Map();
    let items = 0, characters = 0;
    const remove = key => {
      const entry = entries.get(key);
      if (!entry) return;
      items -= entry.items; characters -= entry.characters; entries.delete(key);
    };
    return Object.freeze({
      get(key, binding) {
        const entry = entries.get(key);
        if (!entry) return null;
        if (entry.sourceDocument !== binding.sourceDocument || entry.page !== binding.page ||
            entry.ocr !== binding.ocr) { remove(key); return null; }
        entries.delete(key); entries.set(key, entry);
        return entry.textContent;
      },
      retain(key, binding, textContent) {
        const values = Array.isArray(textContent?.items) ? textContent.items : [];
        const chars = values.reduce((sum, item) => sum + String(item?.str || '').length, 0);
        if (values.length > maxItems || chars > maxChars) return false;
        remove(key);
        while (entries.size && (entries.size >= maxPages ||
            items + values.length > maxItems || characters + chars > maxChars)) {
          remove(entries.keys().next().value);
        }
        entries.set(key, { ...binding, textContent, items: values.length, characters: chars });
        items += values.length; characters += chars;
        return true;
      },
      clear() { entries.clear(); items = 0; characters = 0; },
      usage() { return { pages: entries.size, items, characters, maxPages, maxItems, maxChars }; }
    });
  }

  function createPdfNativePageMountController(options = {}) {
    const getRecord = typeof options.getRecord === 'function' ? options.getRecord : () => null;
    const isActive = typeof options.isActive === 'function' ? options.isActive : () => true;
    const isDisposed = typeof options.isDisposed === 'function' ? options.isDisposed : () => false;
    const mountLayers = typeof options.mountLayers === 'function' ? options.mountLayers : () => {};
    const scheduleRender = typeof options.scheduleRender === 'function'
      ? options.scheduleRender : async () => {};
    const onError = typeof options.onError === 'function' ? options.onError : () => {};
    const onTextError = typeof options.onTextError === 'function'
      ? options.onTextError : () => false;
    const shouldLoadText = typeof options.shouldLoadText === 'function'
      ? options.shouldLoadText : record => !record.textContent;
    const getTextContent = typeof options.getTextContent === 'function'
      ? options.getTextContent : record => record.page.getTextContent({
        includeMarkedContent: true, disableNormalization: true
      });
    const pendingTextLoads = new WeakMap();
    const ownsRecord = record => getRecord(record?.pageNumber) === record;

    async function ensureTextContent(record) {
      if (record.textContent || !shouldLoadText(record)) return;
      const existing = pendingTextLoads.get(record);
      if (existing) return existing;
      const pending = Promise.resolve().then(() => getTextContent(record)).then(textContent => {
        if (!ownsRecord(record) || !record.mounted || !isActive() || isDisposed()) return;
        record.textContent = textContent;
      }).catch(error => {
        if (!ownsRecord(record) || !isActive() || isDisposed()) return;
        if (onTextError(error, record) !== true) throw error;
      }).finally(() => {
        if (pendingTextLoads.get(record) === pending) pendingTextLoads.delete(record);
      });
      pendingTextLoads.set(record, pending);
      return pending;
    }
    return Object.freeze({
      async mount(pageNumber, current = false, mountOptions = {}) {
        const record = getRecord(pageNumber);
        if (!record || !isActive() || isDisposed()) return record || null;
        try {
          if (!record.mounted) mountLayers(record);
          await ensureTextContent(record);
          if (!ownsRecord(record) || !record.mounted || !isActive() || isDisposed()) {
            return getRecord(pageNumber) || null;
          }
          await scheduleRender(record, current, mountOptions);
          return record;
        } catch (error) {
          onError(error);
          throw error;
        }
      }
    });
  }

  function completePdfNativeRender(record, input = {}) {
    if (!record || record.renderTask !== input?.task ||
        record.renderingGeneration !== input?.generation) return false;
    record.renderTask = null;
    record.renderingGeneration = 0;
    record.rendering = false;
    if (input.generation === input.currentGeneration && input.wanted &&
        record.mounted && !record.rendered && typeof input.reschedule === 'function') {
      input.reschedule();
    }
    return true;
  }

  function normalizePdfNativeReadingPosition(value, documentHash, pageCount) {
    if (!/^[a-f0-9]{64}$/u.test(String(documentHash || '')) ||
        value?.documentHash !== documentHash || value?.version !== 1) return null;
    const page = finiteNumber(value.pageNumber);
    const count = finiteNumber(pageCount);
    const scale = finiteNumber(value.scale);
    const offset = finiteNumber(value.pageOffset);
    if (!Number.isSafeInteger(page) || page < 1 || !count || page > count ||
        scale === null || scale < DEFAULT_MIN_SCALE || scale > DEFAULT_MAX_SCALE ||
        offset === null || offset < 0 || offset > 1) return null;
    return { version: 1, documentHash, pageNumber: page, scale, pageOffset: offset };
  }

  function createPdfSemanticFocusLifetime(input = {}) {
    const now = input.now || Date.now;
    const schedule = input.setTimer || setTimeout;
    const cancel = input.clearTimer || clearTimeout;
    const remove = input.remove || (layer => layer.remove());
    let lease = null;
    function clear() {
      const previous = lease;
      lease = null;
      if (!previous) return;
      cancel(previous.timer);
      previous.layers.forEach(remove);
    }
    function expireDue() {
      if (!lease || now() < lease.expiresAt) return false;
      clear();
      return true;
    }
    function replace(layers, owner) {
      clear();
      const current = { layers: [...layers], owner, expiresAt: now() + 1500, timer: null };
      lease = current;
      const expire = () => {
        if (lease !== current) return;
        if (!expireDue()) current.timer = schedule(expire, Math.max(1, current.expiresAt - now()));
      };
      current.timer = schedule(expire, 1500);
    }
    return Object.freeze({ clear, replace, expireDue });
  }

  return {
    createPdfSemanticFocusLifetime,
    createPdfNativeReaderState,
    createPdfNativeCommandQueue,
    createPdfNativeBridgeController,
    selectPdfNativePage,
    pdfNativeScrollDelta,
    pdfNativeAnchoredScrollTop,
    pdfNativeContentWidth,
    pdfNativeUnscaledPageWidth,
    setPdfNativeSurface,
    setPdfReaderViewSurface,
    cancelPdfNativeRenders,
    createPdfNativeResizeScheduler,
    createPdfNativeRenderGeneration,
    createPdfNativeLifecycle,
    createPdfNativeTaskQueue,
    createPdfNativeCanvasBudget,
    sanitizePdfNativeLinkUrl,
    normalizePdfNativePageImageRequest,
    validatePdfNativeImageDimensions,
    createPdfNativePageProjection,
    destroyPdfNativeDocumentResources,
    resetPdfReaderSourceOwnership,
    normalizePdfNativePageText,
    classifyPdfNativePageContent,
    createPdfNativeTextBudget,
    createPdfNativePageTextCache,
    yieldPdfNativePaint,
    createPdfNativePageMountController,
    completePdfNativeRender,
    normalizePdfNativeReadingPosition
  };
});
