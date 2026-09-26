/**
 * Read and fully verify the current native-PDF browser Selection without
 * sending it anywhere. The returned DTO can be passed as selectionEvidence to
 * an explicitly authorized article-chat request by a live verifier.
 */
export async function readPreparedNativePdfSelectionEvidence(page) {
  if (!page || typeof page.evaluate !== 'function') {
    throw new TypeError('A Playwright Page is required');
  }
  const result = await page.evaluate(async () => {
    const descriptor = describeCurrentManualSelection();
    if (!descriptor?.validation?.valid || !descriptor?.anchor?.pdfAnchor) {
      const error = new Error(
        descriptor?.validation?.code || 'PDF_SELECTION_EVIDENCE_UNAVAILABLE'
      );
      error.code = descriptor?.validation?.code || 'PDF_SELECTION_EVIDENCE_UNAVAILABLE';
      throw error;
    }
    const sourceSegments = Array.isArray(descriptor.anchorSegments) &&
      descriptor.anchorSegments.length
      ? descriptor.anchorSegments : [{ anchor: descriptor.anchor }];
    const segments = sourceSegments.map(segment => ({
      text: String(segment?.anchor?.quote || ''),
      pageNumber: Number(segment?.anchor?.pdfAnchor?.pageNumber) || 0,
      contextHash: String(segment?.anchor?.pdfAnchor?.contextHash || ''),
      documentHash: String(segment?.anchor?.pdfAnchor?.documentHash || ''),
      documentGeneration: Number(descriptor.pdfDocumentGeneration) || 0,
      selectionGeneration: Number(descriptor.pdfSelectionGeneration) || 0
    }));
    const first = segments[0];
    const selection = segments.length > 1 ? {
      documentHash: first.documentHash,
      documentGeneration: first.documentGeneration,
      selectionGeneration: first.selectionGeneration,
      segments
    } : first;
    try {
      const prepared = await SciLLM.prepareNativePdfSelectionEvidence({
        selection,
        ensurePageIndexed: (pageNumber, expected) =>
          globalThis.__brevessPdfReaderBridge?.command?.(
            'ensurePageIndexed', pageNumber, expected
          ),
        getNativeDocument: () => globalThis.__brevessNativePdfDocument
      });
      if (typeof upgradePreparedPdfSelectionEvidence !== 'function') {
        throw Object.assign(new Error('PDF_SELECTION_SEMANTIC_UPGRADE_UNAVAILABLE'), {
          code: 'PDF_SELECTION_SEMANTIC_UPGRADE_UNAVAILABLE'
        });
      }
      return { ok: true, evidence: upgradePreparedPdfSelectionEvidence(prepared) };
    } catch (error) {
      const paragraphs = globalThis.__brevessNativePdfDocument?.structure?.paragraphs || [];
      const normalize = value => String(value || '').normalize('NFKC')
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
        .replace(/\s+/g, ' ').trim();
      return {
        ok: false,
        code: String(error?.code || error?.message || 'PDF_SELECTION_EVIDENCE_UNAVAILABLE'),
        diagnostics: segments.map(item => {
          const paragraph = paragraphs.find(candidate =>
            String(candidate?.paragraphId || '') === `pdf-page-${item.pageNumber}`);
          const quote = normalize(item.text);
          const pageText = normalize(paragraph?.text);
          return {
            pageNumber: item.pageNumber,
            quoteCharacters: quote.length,
            pageCharacters: pageText.length,
            directMatch: pageText.includes(quote),
            canonicalMatch: Boolean(SciLLM.findCanonicalQuoteSourceSpan?.(
              paragraph?.text, item.text
            )),
            quoteHash: String(SciLLM.stableHash?.(quote) || ''),
            pageTextHash: String(paragraph?.textHash || '')
          };
        })
      };
    }
  });
  if (result?.ok === true) return result.evidence;
  throw gestureError(result?.code || 'PDF_SELECTION_EVIDENCE_UNAVAILABLE',
    result?.diagnostics || null);
}

export function assertPreparedNativePdfSelectionEvidenceDiagnostics(diagnostics = {}) {
  const count = Math.max(0, Number(diagnostics.segmentCount) || 0);
  if (!count) throw gestureError('PDF_SELECTION_SEMANTIC_SEGMENTS_EMPTY');
  if (Number(diagnostics.semanticLocatorCount) !== count) {
    throw gestureError('PDF_SELECTION_SEMANTIC_LOCATOR_MISSING');
  }
  if (Number(diagnostics.selectionShapeCount) !== count) {
    throw gestureError('PDF_SELECTION_SEMANTIC_IDENTITY_MISMATCH');
  }
  if (Number(diagnostics.globalQuoteSpanCount) !== count) {
    throw gestureError('PDF_SELECTION_GLOBAL_QUOTE_SPAN_INVALID');
  }
  if (Number(diagnostics.resolvedRawRangeCount) !== count) {
    throw gestureError('PDF_SELECTION_RAW_RANGE_UNRESOLVED');
  }
  if (Number(diagnostics.pageAnchorMatchesRawCount) !== count) {
    throw gestureError('PDF_SELECTION_PAGE_ANCHOR_NOT_RAW_FIRST_PAGE');
  }
  return true;
}

/**
 * Resolve each persisted semantic selection through the real native document.
 * This deliberately validates the page anchor against raw ranges[0], because a
 * semantic paragraph can begin on an earlier page than the selected quote.
 */
export async function inspectPreparedNativePdfSelectionEvidence(page, evidence) {
  if (!page || typeof page.evaluate !== 'function') {
    throw new TypeError('A Playwright Page is required');
  }
  const diagnostics = await page.evaluate(async prepared => {
    const native = globalThis.__brevessNativePdfDocument;
    const navigation = native?.getSemanticNavigation?.();
    const targets = [];
    const pending = Array.isArray(navigation?.sections) ? [...navigation.sections] : [];
    while (pending.length) {
      const section = pending.shift();
      targets.push(...(Array.isArray(section?.paragraphTargets)
        ? section.paragraphTargets : []));
      pending.push(...(Array.isArray(section?.children) ? section.children : []));
    }
    const segments = Array.isArray(prepared?.segments)
      ? prepared.segments : (prepared ? [prepared] : []);
    const rows = [];
    for (const segment of segments) {
      const locator = segment?.semanticLocator;
      const target = targets.find(item =>
        String(item?.paragraphId || '') === String(locator?.paragraphId || ''));
      const result = locator && typeof native?.resolveSemanticHighlight === 'function'
        ? await Promise.resolve(native.resolveSemanticHighlight(locator)) : null;
      const ranges = Array.isArray(result?.ranges) ? result.ranges : [];
      const relativeStart = Number(locator?.normalizedStart) - Number(target?.normalizedStart);
      const relativeEnd = Number(locator?.normalizedEnd) - Number(target?.normalizedStart);
      const quote = String(locator?.expectedNormalizedQuote || '');
      const targetText = String(target?.expectedNormalizedQuote || '');
      const firstRawPage = Number(ranges[0]?.pageNumber) || 0;
      rows.push({
        semanticLocator: locator?.locatorKind === 'pdf-semantic',
        selectionShape: String(segment?.text || '') === quote &&
          String(segment?.paragraphId || '') === String(locator?.paragraphId || ''),
        globalQuoteSpan: Boolean(target && Number.isSafeInteger(relativeStart) &&
          Number.isSafeInteger(relativeEnd) && relativeStart >= 0 &&
          relativeEnd > relativeStart && relativeEnd <= targetText.length &&
          targetText.slice(relativeStart, relativeEnd) === quote &&
          Number(locator.normalizedEnd) - Number(locator.normalizedStart) === quote.length),
        rawRangeResolved: result?.status === 'resolved' && ranges.length > 0,
        pageAnchorMatchesRaw: firstRawPage > 0 &&
          Number(segment?.pageAnchor?.pageNumber) === firstRawPage &&
          String(segment?.pageAnchor?.paragraphId || '') === `pdf-page-${firstRawPage}`,
        continuationPage: firstRawPage > 0 && Number(target?.pageNumber) > 0 &&
          firstRawPage !== Number(target.pageNumber),
        pageNumber: Number(segment?.pageNumber) || 0,
        firstRawPage
      });
    }
    return {
      segmentCount: rows.length,
      semanticLocatorCount: rows.filter(row => row.semanticLocator).length,
      selectionShapeCount: rows.filter(row => row.selectionShape).length,
      globalQuoteSpanCount: rows.filter(row => row.globalQuoteSpan).length,
      resolvedRawRangeCount: rows.filter(row => row.rawRangeResolved).length,
      pageAnchorMatchesRawCount: rows.filter(row => row.pageAnchorMatchesRaw).length,
      continuationPageCount: rows.filter(row => row.continuationPage).length,
      selectedPageCount: new Set(rows.map(row => row.pageNumber).filter(Boolean)).size,
      rawPageCount: new Set(rows.map(row => row.firstRawPage).filter(Boolean)).size
    };
  }, evidence);
  assertPreparedNativePdfSelectionEvidenceDiagnostics(diagnostics);
  return Object.freeze(diagnostics);
}

function gestureError(code, evidence = null) {
  const error = new Error(code);
  error.code = code;
  if (evidence) error.evidence = evidence;
  return error;
}

export async function waitForNativePdfReaderReady(page, expectedHash, timeout = 120_000) {
  if (!page || typeof page.waitForFunction !== 'function') {
    throw new TypeError('A Playwright Page is required');
  }
  await page.waitForFunction(hash => {
    const native = globalThis.__brevessNativePdfDocument;
    const renderedTextPage = document.querySelector(
      '.pdf-native-page.is-rendered .pdf-native-text-layer span');
    return document.querySelector('#pdfNativeViewer')?.dataset?.state === 'ready' &&
      native?.phase === 'text-ready' && native?.structure?.documentHash === hash &&
      Number(native?.pageCount) >= 2 && Boolean(renderedTextPage) &&
      document.documentElement.dataset.pdfWorkspaceReady === 'true' &&
      document.documentElement.dataset.pdfWorkspaceIndexed === 'true';
  }, expectedHash, { timeout });
}

export async function waitForNativePdfManualReady(page, expectedHash, timeout = 30_000) {
  if (!page || typeof page.waitForFunction !== 'function') {
    throw new TypeError('A Playwright Page is required');
  }
  await page.waitForFunction(hash => {
    try {
      const native = globalThis.__brevessNativePdfDocument;
      return native?.structure?.documentHash === hash && Number(native?.pageCount) >= 2 &&
        currentManualDocument?.record?.documentHash === hash &&
        Boolean(currentManualDocument?.documentId) && currentManualCategories?.length > 0;
    } catch (_) {
      return false;
    }
  }, expectedHash, { timeout });
}

async function waitForNativePage(page, pageNumber, timeout = 30_000) {
  await page.waitForFunction(number => {
    const pageNode = document.querySelector(
      `.pdf-native-page[data-pdf-page-number="${number}"]`);
    return pageNode?.classList.contains('is-rendered') &&
      pageNode.querySelectorAll('.pdf-native-text-layer span').length > 0;
  }, pageNumber, { timeout });
}

async function navigateNativePage(page, pageNumber) {
  const pageInput = page.locator('#pdfReaderPageNumber');
  if (await pageInput.count()) {
    await pageInput.fill(String(pageNumber));
    await pageInput.press('Enter');
    await pageInput.evaluate(node =>
      node.dispatchEvent(new Event('change', { bubbles: true })));
  } else {
    const focused = await page.evaluate(number =>
      globalThis.__brevessPdfReaderBridge?.command?.('focusPage', number) === true,
    pageNumber);
    if (!focused) throw gestureError('PDF_PAGE_NAVIGATION_UNAVAILABLE', { pageNumber });
  }
  await page.waitForFunction(number =>
    String(document.querySelector('#pdfReaderPageNumber')?.value || '') === String(number),
  pageNumber, { timeout: 5000 });
  await waitForNativePage(page, pageNumber);
}

async function mountedNativePages(page) {
  return page.evaluate(() => [...document.querySelectorAll(
    '.pdf-native-page.is-rendered[data-pdf-page-number]')]
    .filter(node => node.querySelector('.pdf-native-text-layer span'))
    .map(node => Number(node.dataset.pdfPageNumber) || 0)
    .filter(Boolean)
    .sort((left, right) => left - right));
}

async function chooseProseSpan(page, pageNumber, side) {
  const spans = page.locator(
    `.pdf-native-page[data-pdf-page-number="${pageNumber}"] .pdf-native-text-layer span`
  );
  const choice = await spans.evaluateAll((nodes, input) => {
    const pageNode = nodes[0]?.closest('.pdf-native-page');
    const pageRect = pageNode?.getBoundingClientRect();
    if (!pageRect?.height) return -1;
    const candidates = nodes.map((node, index) => {
      const rect = node.getBoundingClientRect();
      const text = String(node.textContent || '').normalize('NFKC')
        .replace(/\s+/gu, ' ').trim();
      const letters = (text.match(/[A-Za-z\p{L}]/gu) || []).length;
      const fractions = input.side === 'end' ? [0.28, 0.5, 0.72] : [0.72, 0.5, 0.28];
      const hitFraction = fractions.find(fraction => {
        const target = document.elementFromPoint(
          rect.left + Math.min(rect.width - 2, Math.max(2, rect.width * fraction)),
          rect.top + rect.height / 2
        );
        return target?.closest?.('.pdf-native-text-layer span') === node;
      });
      return {
        index, text, letters, rect,
        furniture: Boolean(node.dataset?.pdfPageFurniture),
        ratio: (rect.top - pageRect.top) / pageRect.height,
        hitFraction: Number.isFinite(hitFraction) ? hitFraction : null
      };
    }).filter(item => !item.furniture && item.text.length >= 3 && item.letters >= 2 &&
      item.rect.width >= 10 && item.rect.height >= 4 &&
      !/(?:https?:\/\/|doi\b|@|copyright|^[\d\W]+$)/iu.test(item.text));
    const preferred = candidates.filter(item => input.side === 'end'
      ? item.ratio >= 0.5 && item.ratio <= 0.9
      : item.ratio >= 0.1 && item.ratio <= 0.5);
    const located = preferred.length ? preferred : candidates;
    const hittable = located.filter(item => item.hitFraction !== null);
    const reachable = hittable.length ? hittable : located;
    // PDF.js may emit either line-sized spans or individual word spans for the
    // same PDF, depending on font readiness. Prefer a roomy glyph box when one
    // exists so a real mouse-down never lands on an antialiased edge.
    const sturdy = reachable.filter(item => item.text.length >= 5 &&
      item.letters >= 4 && item.rect.width >= 24);
    const pool = sturdy.length ? sturdy : reachable;
    pool.sort((left, right) => input.side === 'end'
      ? right.rect.top - left.rect.top || right.rect.left - left.rect.left
      : left.rect.top - right.rect.top || left.rect.left - right.rect.left);
    return pool[0] ? {
      index: pool[0].index,
      hitFraction: pool[0].hitFraction
    } : { index: -1, hitFraction: null };
  }, { side });
  if (choice.index < 0) {
    throw gestureError(`PDF_${side.toUpperCase()}_PROSE_SPAN_MISSING`);
  }
  return Object.freeze({
    locator: spans.nth(choice.index),
    hitFraction: Number.isFinite(choice.hitFraction)
      ? choice.hitFraction : (side === 'end' ? 0.28 : 0.72)
  });
}

async function currentSelectionState(page) {
  return page.evaluate(() => {
    const selection = document.getSelection();
    const range = selection?.rangeCount === 1 ? selection.getRangeAt(0) : null;
    const layerFor = node => (node?.nodeType === Node.ELEMENT_NODE
      ? node : node?.parentElement)?.closest?.('.pdf-native-text-layer');
    const startLayer = range ? layerFor(range.startContainer) : null;
    const endLayer = range ? layerFor(range.endContainer) : null;
    const pageRects = [];
    if (range) {
      for (const pageNode of document.querySelectorAll('.pdf-native-page')) {
        const pageRect = pageNode.getBoundingClientRect();
        const rectCount = Array.from(range.getClientRects()).filter(rect =>
          rect.right > pageRect.left && rect.left < pageRect.right &&
          rect.bottom > pageRect.top && rect.top < pageRect.bottom).length;
        if (rectCount) pageRects.push({
          pageNumber: Number(pageNode.dataset.pdfPageNumber) || 0,
          rectCount
        });
      }
    }
    return {
      text: String(selection || '').normalize('NFKC').replace(/\s+/gu, ' ').trim(),
      rangeCount: selection?.rangeCount || 0,
      collapsed: selection?.isCollapsed ?? true,
      startPage: Number(startLayer?.dataset?.pdfPageNumber) || 0,
      endPage: Number(endLayer?.dataset?.pdfPageNumber) || 0,
      pageRects
    };
  });
}

/**
 * Performs one genuine Playwright mouse drag while scrolling with the primary
 * button held. No DOM Range or synthetic mouse event is constructed.
 */
export async function dragSelectAcrossNativePdfPages(page, options = {}) {
  if (!page?.mouse || typeof page.evaluate !== 'function') {
    throw new TypeError('A Playwright Page is required');
  }
  const startPage = Math.max(1, Math.floor(Number(options.startPage) || 1));
  const endPage = Math.max(startPage + 1,
    Math.floor(Number(options.endPage) || startPage + 1));
  const minimumCharacters = Math.max(20,
    Math.floor(Number(options.minimumCharacters) || 20));
  const maximumWheelSteps = Math.max(20,
    Math.min(80, Math.floor(Number(options.maximumWheelSteps) || 48)));
  await navigateNativePage(page, endPage);
  const endChoice = await chooseProseSpan(page, endPage, 'start');
  await navigateNativePage(page, startPage);
  const startChoice = await chooseProseSpan(page, startPage, 'end');
  const end = endChoice.locator;
  const start = startChoice.locator;
  await start.scrollIntoViewIfNeeded();
  await start.waitFor({ state: 'visible', timeout: 5000 });
  let startBox = await start.boundingBox();
  const viewerBox = await page.locator('#pdfNativeViewer').boundingBox();
  const viewport = page.viewportSize();
  if (!startBox?.width || !startBox?.height || !viewerBox || !viewport) {
    throw gestureError('PDF_CROSS_PAGE_GESTURE_BOX_MISSING', {
      startBoxPresent: Boolean(startBox), viewerBoxPresent: Boolean(viewerBox),
      viewportPresent: Boolean(viewport)
    });
  }
  // At the B5 page boundary both recorded carets fit in one viewer viewport.
  // Put them on screen before mouse-down when possible. This preserves a real
  // mouse selection and avoids relying on Chromium's platform-dependent rule
  // for wheel events while the primary button is held.
  let prepositioned = false;
  const prospectiveEndBox = await end.boundingBox({ timeout: 1000 }).catch(() => null);
  const verticalDistance = prospectiveEndBox
    ? prospectiveEndBox.y - startBox.y : Number.POSITIVE_INFINITY;
  if (prospectiveEndBox && verticalDistance > 0 &&
      verticalDistance + Math.max(startBox.height, prospectiveEndBox.height) <=
        viewerBox.height - 48) {
    const scrollDelta = startBox.y - (viewerBox.y + 24);
    if (scrollDelta > 1) {
      await page.evaluate(delta => {
        const viewer = document.getElementById('pdfNativeViewer');
        if (viewer) viewer.scrollTop += delta;
      }, scrollDelta);
      await page.waitForTimeout(125);
      startBox = await start.boundingBox();
      prepositioned = Boolean(startBox?.width && startBox?.height);
    }
  }
  if (!startBox?.width || !startBox?.height) {
    throw gestureError('PDF_CROSS_PAGE_START_BOX_LOST_AFTER_PREPOSITION');
  }
  const startPoint = {
    x: Math.min(viewport.width - 8,
      startBox.x + Math.min(startBox.width - 2,
        Math.max(2, startBox.width * startChoice.hitFraction))),
    y: Math.min(viewport.height - 8, startBox.y + startBox.height / 2)
  };
  const startTarget = await page.evaluate(position => {
    const element = document.elementFromPoint(position.x, position.y);
    const span = element?.closest?.('.pdf-native-text-layer span');
    return {
      textSpan: Boolean(span),
      pageNumber: Number(span?.closest?.('[data-pdf-page-number]')
        ?.dataset?.pdfPageNumber) || 0
    };
  }, startPoint);
  if (!startTarget.textSpan || startTarget.pageNumber !== startPage) {
    throw gestureError('PDF_CROSS_PAGE_START_NOT_REACHED', { startTarget });
  }
  let endBox = null;
  let endPoint = null;
  let wheelSteps = 0;
  let duringDrag = null;
  await page.mouse.move(startPoint.x, startPoint.y);
  await page.mouse.down();
  try {
    await page.mouse.move(
      Math.min(viewport.width - 8,
        startBox.x + Math.min(startBox.width - 2,
          Math.max(4, startBox.width * 0.72))),
      startPoint.y,
      { steps: 10 }
    );
    for (; wheelSteps < maximumWheelSteps; wheelSteps += 1) {
      endBox = await end.boundingBox({ timeout: 250 }).catch(() => null);
      if (endBox && endBox.y >= viewerBox.y + 8 &&
          endBox.y + endBox.height <= viewerBox.y + viewerBox.height - 12) {
        endPoint = {
          x: Math.min(viewport.width - 8,
            endBox.x + Math.min(endBox.width - 2,
              Math.max(2, endBox.width * endChoice.hitFraction))),
          y: endBox.y + endBox.height / 2
        };
        const target = await page.evaluate(position => {
          const element = document.elementFromPoint(position.x, position.y);
          const span = element?.closest?.('.pdf-native-text-layer span');
          return {
            textSpan: Boolean(span),
            pageNumber: Number(span?.closest?.('[data-pdf-page-number]')
              ?.dataset?.pdfPageNumber) || 0
          };
        }, endPoint);
        if (target.textSpan && target.pageNumber === endPage) break;
        endPoint = null;
      }
      await page.mouse.move(
        Math.min(viewport.width - 40, startPoint.x + 80),
        viewerBox.y + viewerBox.height - 35,
        { steps: 4 }
      );
      await page.mouse.wheel(0, 220);
      // Rendering a newly mounted native page can take longer than one wheel
      // interval while the semantic worker is publishing. Keep the button
      // held and allow that real page mount to settle before the next wheel.
      await page.waitForTimeout(125);
    }
    if (!endPoint) {
      const scroll = await page.evaluate(() => {
        const viewer = document.getElementById('pdfNativeViewer');
        return { scrollTop: Number(viewer?.scrollTop) || 0,
          scrollHeight: Number(viewer?.scrollHeight) || 0,
          clientHeight: Number(viewer?.clientHeight) || 0 };
      });
      throw gestureError('PDF_CROSS_PAGE_END_NOT_REACHED', { wheelSteps, ...scroll });
    }
    await page.mouse.move(endPoint.x, endPoint.y, { steps: 24 });
    duringDrag = await currentSelectionState(page);
  } finally {
    await page.mouse.up();
  }
  await page.waitForTimeout(150);
  const selection = await currentSelectionState(page);
  if (selection.rangeCount !== 1 || selection.collapsed ||
      selection.startPage !== startPage || selection.endPage !== endPage ||
      selection.text.length < minimumCharacters) {
    throw gestureError('PDF_CROSS_PAGE_REAL_MOUSE_SELECTION_FAILED', {
      startPage: selection.startPage,
      endPage: selection.endPage,
      characterCount: selection.text.length,
      rangeCount: selection.rangeCount,
      collapsed: selection.collapsed,
      wheelSteps
    });
  }
  const descriptor = await page.evaluate(() => {
    const current = currentManualSelection || describeCurrentManualSelection();
    return current ? structuredClone(current) : null;
  });
  if (!descriptor?.validation?.valid) {
    throw gestureError(descriptor?.validation?.code ||
      'PDF_CROSS_PAGE_SELECTION_DESCRIPTOR_UNAVAILABLE');
  }
  const evidence = options.prepareEvidence === true
    ? await readPreparedNativePdfSelectionEvidence(page) : null;
  return Object.freeze({
    inputMethod: prepositioned
      ? 'playwright-preposition-mouse-down-move-up'
      : 'playwright-mouse-down-wheel-move-up',
    prepositioned,
    wheelSteps,
    mountedPagesAfterGesture: Object.freeze(await mountedNativePages(page)),
    duringDrag: Object.freeze(duringDrag || {}),
    selection: Object.freeze(selection),
    descriptor,
    selectionEvidence: evidence
  });
}
