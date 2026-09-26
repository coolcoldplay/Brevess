(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  const MAX_PAGES = 10000;
  const MAX_LINES_PER_CAPTION = 80;
  const MAX_CAPTION_CHARS = 12000;
  const HEADER_PATTERN = /^\s*(extended\s+data\s+fig(?:ure)?|supplement(?:ary|al)\s+fig(?:ure)?|fig(?:ure)?)\.?\s*(S\s*)?(\d{1,3})(?!\d)(\s*(?:[.:|\u2010-\u2015\u2212-])\s*|\s*$)(.*)$/iu;
  const CAPTION_BOUNDARY_PATTERN = /^(?:abstract|introduction|results?|discussion|methods?|materials\s+and\s+methods|references?|acknowledg(?:e)?ments?|author\s+contributions?|supplementary\s+information|table\s+\d+)\s*$/iu;
  const BODY_REFERENCE_START = /^(?:shows?|showing|illustrates?|depicts?|demonstrates?|presents?|summari[sz]es?|compares?|indicates?|reveals?|provides?|is|was|were|has|contains?)\b/iu;
  const TERMINAL_CAPTION = /[.!?](?:[)\]}\u201d\u2019'"]+)?\s*$/u;

  function normalizedInlineText(value) {
    return String(value || '').normalize('NFKC').replace(/[\t\f\v ]+/g, ' ').trim();
  }

  function normalizedCaption(value) {
    return String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim()
      .slice(0, MAX_CAPTION_CHARS);
  }

  function positivePageNumber(value) {
    const pageNumber = Number(value);
    return Number.isSafeInteger(pageNumber) && pageNumber > 0 && pageNumber <= MAX_PAGES
      ? pageNumber : 0;
  }

  function textItemCoordinate(item, index) {
    const transform = Array.isArray(item?.transform) ? item.transform : [];
    const x = Number(transform[4]);
    const y = Number(transform[5]);
    const width = Number(item?.width);
    return {
      index,
      text: String(item?.str || '').normalize('NFKC'),
      hasEOL: item?.hasEOL === true,
      x: Number.isFinite(x) ? x : null,
      y: Number.isFinite(y) ? y : null,
      width: Number.isFinite(width) && width >= 0 ? width : 0,
      height: Math.abs(Number(item?.height) || Number(transform[3]) || 0)
    };
  }

  function shouldBreakPdfLine(current, item) {
    if (!current.parts.length) return false;
    if (current.forcedBreak) return true;
    if (current.y === null || item.y === null) return false;
    const tolerance = Math.max(1.5, Math.min(6, Math.max(current.height, item.height) * 0.35));
    return Math.abs(current.y - item.y) > tolerance;
  }

  function appendPdfItem(current, item) {
    const previous = current.parts.at(-1);
    let separator = '';
    if (previous) {
      const estimatedEnd = previous.x === null ? null : previous.x + previous.width;
      const gap = estimatedEnd === null || item.x === null ? null : item.x - estimatedEnd;
      const joinsPunctuation = /^[,.;:!?%\])}]/u.test(item.text);
      const previousEndsSpace = /\s$/u.test(previous.text);
      if (!previousEndsSpace && !joinsPunctuation && (gap === null || gap > -0.5)) separator = ' ';
    }
    current.text += separator + item.text;
    current.parts.push(item);
    if (current.y === null && item.y !== null) current.y = item.y;
    current.height = Math.max(current.height, item.height);
    current.forcedBreak = item.hasEOL;
  }

  function linesFromPdfTextContent(textContent) {
    const items = Array.isArray(textContent?.items) ? textContent.items : [];
    const lines = [];
    let current = { text: '', parts: [], y: null, height: 0, forcedBreak: false };
    const flush = () => {
      const text = normalizedInlineText(current.text);
      const positioned = current.parts.filter(part => part.x !== null);
      lines.push({ text, y: current.y, itemCount: current.parts.length,
        xMin: positioned.length ? Math.min(...positioned.map(part => part.x)) : null,
        xMax: positioned.length ? Math.max(...positioned.map(part => part.x + part.width)) : null,
        height: current.height });
      current = { text: '', parts: [], y: null, height: 0, forcedBreak: false };
    };
    items.map(textItemCoordinate).forEach(item => {
      if (shouldBreakPdfLine(current, item)) flush();
      appendPdfItem(current, item);
      if (item.hasEOL) flush();
    });
    if (current.parts.length) flush();
    return lines;
  }

  function nativePdfPageLines(page) {
    if (typeof page?.text === 'string') {
      return page.text.replace(/\r\n?/g, '\n').split('\n')
        .map(text => ({ text: normalizedInlineText(text), y: null, itemCount: 0 }));
    }
    return linesFromPdfTextContent(page?.textContent);
  }

  function parseCaptionHeader(value) {
    const text = normalizedInlineText(value);
    const match = text.match(HEADER_PATTERN);
    if (!match) return null;
    const number = Number(match[3]);
    if (!Number.isInteger(number) || number < 1 || number > 999) return null;
    const prefix = match[1].toLowerCase();
    const explicitSupplemental = Boolean(match[2]) || prefix.startsWith('supplement');
    const extended = prefix.startsWith('extended');
    const figureSeries = extended ? 'extended-data'
      : explicitSupplemental ? 'supplemental' : 'main';
    const figureCode = extended ? `ED${number}` : `${explicitSupplemental ? 'S' : ''}${number}`;
    const body = normalizedInlineText(match[5]);
    // Supplement/video references are not a second caption for the main Figure.
    if (/^(?:figure\s+supplements?|source\s+data|videos?|animations?)\b/iu.test(body)) return null;
    const hasDelimiter = normalizedInlineText(match[4]) !== '';
    if (body && BODY_REFERENCE_START.test(body)) return null;
    if (body && !hasDelimiter && /^(?:and|or|see|also|above|below|in|from|of|for)\b/iu.test(body)) {
      return null;
    }
    if (/\.{3,}\s*\d{1,4}\s*$/u.test(body) || /^\.{2,}/u.test(body)) return null;
    return {
      figureNumber: number,
      figureCode,
      figureSeries,
      isSupplemental: figureSeries !== 'main',
      figureId: extended ? `figure-ed${number}` : `figure-${figureCode.toLowerCase()}`,
      figureLabel: extended ? `Extended Data Figure ${number}` : `Figure ${figureCode}`,
      header: text,
      body,
      hasDelimiter
    };
  }

  function conservativePanelHints(caption) {
    const panels = new Set();
    const addRange = (first, last = first) => {
      const start = first.charCodeAt(0);
      const end = last.charCodeAt(0);
      if (start < 65 || end > 90 || end < start || end - start > 25) return;
      for (let code = start; code <= end; code += 1) panels.add(String.fromCharCode(code));
    };
    const text = normalizedCaption(caption);
    for (const match of text.matchAll(/\bpanels?\s+([A-Z])(?:\s*[-\u2010-\u2015\u2212]\s*([A-Z]))?/giu)) {
      addRange(match[1].toUpperCase(), (match[2] || match[1]).toUpperCase());
    }
    // PDF legends commonly use lower-case (i), which is a panel, not a Roman
    // numeral. Accept letter lists/ranges but not units or word suffixes: (s).
    for (const match of text.matchAll(/\(\s*([a-z](?:\s*(?:,|and|&|[-\u2010-\u2015\u2212])\s*[a-z])*)\s*\)/giu)) {
      const before = text.slice(0, match.index);
      if (/[\p{L}\p{N}]$/u.test(before)) continue;
      const value = match[1].toUpperCase();
      if (/^[A-Z]$/u.test(value) && /(?:voltage|current|distance|length|height|width|diameter|power|temperature|time|duration|latency|mass|weight|volume|frequency|pressure|energy|charge|resistance|concentration|seconds?)\s*$/iu.test(before)) continue;
      // A bare time unit is not a panel label. A true S in an A-S series is
      // still admitted by an explicit range or "Panel S" above.
      if (value === 'S' && /(?:time|duration|latency|seconds?|\d)\s*$/iu.test(before)) continue;
      for (const part of value.split(/\s*(?:,|AND|&)\s*/u)) {
        const range = part.match(/^([A-Z])(?:\s*[-\u2010-\u2015\u2212]\s*([A-Z]))?$/u);
        if (range) addRange(range[1], range[2] || range[1]);
      }
    }
    return [...panels].sort();
  }

  function parseCaptionContinuation(value) {
    const match = normalizedInlineText(value).match(
      /^(.+?)\s*[.:]?\s*\(?continued(\s+on\s+(?:the\s+)?next\s+page)?\)?\s*\.?$/iu
    );
    const identity = match ? parseCaptionHeader(`${match[1].replace(/[.:]\s*$/u, '')}.`) : null;
    return identity ? { ...identity, direction: match[2] ? 'outgoing' : 'incoming' } : null;
  }

  function isCaptionBoundary(line) {
    const text = normalizedInlineText(line);
    return Boolean(
      CAPTION_BOUNDARY_PATTERN.test(text) ||
      /^(?:the online version\b|figure\s+supplement\b|source\s+data\b|https?:\/\/|research article\b)/iu.test(text) ||
      /\bDOI:\s*https?:\/\//iu.test(text) ||
      /^fig(?:ure)?\.?\s*\d+\s*[\u2010-\u2015-]\s*(?:figure supplements?|videos?|source data)\b/iu.test(text) ||
      /^table\s+(?:S\s*)?\d{1,3}\b/iu.test(text) ||
      /^\d{1,4}\s*$/u.test(text)
    );
  }

  function captionQuality(identity, caption, reasons) {
    const body = normalizedCaption(caption).replace(
      new RegExp('^' + identity.figureLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[.:|\\-]?\\s*', 'iu'),
      ''
    );
    const words = body.match(/[\p{L}\p{N}]+/gu) || [];
    if (body.length < 18 || words.length < 3) reasons.add('short-caption');
    if (!TERMINAL_CAPTION.test(body)) reasons.add('open-caption-boundary');
    return body;
  }

  function collectCaptionCandidate(pages, pageIndex, lineIndex, identity) {
    const page = pages[pageIndex];
    const reasons = new Set();
    const pieces = [identity.header];
    let consumedLines = 1;
    let endedByBoundary = false;
    let endedAtPage = false;
    let explicitContinuation = false;
    const isContinuation = (line, direction) => {
      const marker = parseCaptionContinuation(line);
      return marker?.figureId === identity.figureId && marker.direction === direction;
    };
    if (identity.header.length > MAX_CAPTION_CHARS) reasons.add('caption-truncated');
    let scanIndex = lineIndex + 1;
    for (;
      scanIndex < page.lines.length && consumedLines < MAX_LINES_PER_CAPTION &&
        !reasons.has('caption-truncated');
      scanIndex += 1) {
      const line = page.lines[scanIndex].text;
      if (parseCaptionContinuation(line)) {
        explicitContinuation = isContinuation(line, 'outgoing');
        endedByBoundary = true;
        break;
      }
      if (!line) {
        // PDF.js emits empty EOL items immediately before a line at the same
        // baseline. These are not actual blank paragraphs.
        if (page.lines[scanIndex].y !== null &&
            page.lines[scanIndex].y === page.lines[scanIndex + 1]?.y) continue;
        if (pieces.length > 1) {
          endedByBoundary = true;
          break;
        }
        continue;
      }
      if (parseCaptionHeader(line) || isCaptionBoundary(line)) {
        endedByBoundary = true;
        break;
      }
      const positioned = page.lines[scanIndex];
      const previousLine = page.lines.slice(lineIndex, scanIndex).findLast(candidate => candidate.text);
      const captionEnded = TERMINAL_CAPTION.test(pieces.at(-1) || '');
      const followingBody = captionEnded && previousLine?.y !== null && positioned.y !== null &&
        previousLine?.height > 0 && positioned.height >= previousLine.height * 1.08 &&
        previousLine.y - positioned.y >= Math.max(previousLine.height, positioned.height) * 1.7;
      const pageHeaderAfterCaption = captionEnded && positioned.y !== null &&
        page.lines[lineIndex].y !== null && positioned.y > page.lines[lineIndex].y &&
        new RegExp(`^${page.pageNumber}\\s+\\p{L}`, 'u').test(line);
      if (followingBody || pageHeaderAfterCaption) {
        endedByBoundary = true;
        break;
      }
      pieces.push(line);
      consumedLines += 1;
      if (pieces.join(' ').length >= MAX_CAPTION_CHARS) {
        reasons.add('caption-truncated');
        break;
      }
    }
    if (!endedByBoundary && scanIndex >= page.lines.length) endedAtPage = true;
    if (!endedByBoundary && scanIndex < page.lines.length &&
        consumedLines >= MAX_LINES_PER_CAPTION) reasons.add('caption-truncated');
    let caption = normalizedCaption(pieces.join(' '));
    const pageNumbers = [page.pageNumber];
    const captionSegments = [{ pageNumber: page.pageNumber, text: caption }];
    let continuationPageIndex = pageIndex;
    while (!reasons.has('caption-truncated') &&
        (explicitContinuation || endedAtPage && !TERMINAL_CAPTION.test(caption))) {
      const next = pages[continuationPageIndex + 1];
      if (!next || next.pageNumber !== pages[continuationPageIndex].pageNumber + 1) {
        reasons.add('missing-caption-continuation');
        break;
      }
      let marker = -1;
      next.lines.forEach((line, index) => {
        if (isContinuation(line.text, 'incoming') && (marker < 0 || line.y !== null &&
            (next.lines[marker].y === null || line.y > next.lines[marker].y))) marker = index;
      });
      const openingLine = next.lines[0]?.text || '';
      if (marker < 0 && (explicitContinuation || parseCaptionHeader(openingLine) ||
          parseCaptionContinuation(openingLine))) {
        reasons.add('missing-caption-continuation');
        break;
      }
      const continuation = [];
      const markerY = marker >= 0 ? next.lines[marker].y : null;
      const captionX = page.lines[lineIndex].xMin ?? next.lines[marker]?.xMin;
      // Continuation captions can be extracted after the body even though
      // they appear at the top of the original page. Use their PDF baseline.
      const continuationLines = marker >= 0 && markerY !== null
        ? next.lines.filter(line => line.text && line.y !== null && line.y < markerY &&
            (captionX == null || line.xMin == null ||
              line.xMin >= captionX - 12 && line.xMin <= captionX + 28))
          .sort((a, b) => b.y - a.y)
        : next.lines.slice(marker >= 0 ? marker + 1 : 0);
      const continuationLimit = marker >= 0 ? continuationLines.length
        : Math.min(6, continuationLines.length);
      explicitContinuation = false;
      endedByBoundary = false;
      let continuationIndex = 0;
      for (; continuationIndex < continuationLimit; continuationIndex += 1) {
        const line = continuationLines[continuationIndex];
        if (parseCaptionContinuation(line.text)) {
          explicitContinuation = isContinuation(line.text, 'outgoing');
          endedByBoundary = true;
          break;
        }
        if (!line.text || isCaptionBoundary(line.text) || parseCaptionHeader(line.text)) {
          endedByBoundary = true;
          break;
        }
        if (consumedLines >= MAX_LINES_PER_CAPTION) {
          reasons.add('caption-truncated');
          break;
        }
        continuation.push(line.text);
        consumedLines += 1;
        if (caption.length + 1 + continuation.join(' ').length > MAX_CAPTION_CHARS) {
          reasons.add('caption-truncated');
          break;
        }
        if (marker < 0 && TERMINAL_CAPTION.test(line.text)) {
          endedByBoundary = true;
          break;
        }
      }
      if (!continuation.length) {
        reasons.add('missing-caption-continuation');
        break;
      }
      const previousLength = caption.length;
      caption = normalizedCaption([caption, ...continuation].join(' '));
      const continuationText = caption.slice(previousLength + 1);
      if (continuationText) {
        captionSegments.push({ pageNumber: next.pageNumber, text: continuationText });
        pageNumbers.push(next.pageNumber);
        reasons.add('cross-page-caption');
      }
      endedAtPage = !endedByBoundary && continuationIndex >= continuationLines.length;
      if (!endedByBoundary && !endedAtPage) reasons.add('caption-truncated');
      continuationPageIndex += 1;
    }
    const body = captionQuality(identity, caption, reasons);
    if (!body) return null;
    if (!identity.hasDelimiter) reasons.add('header-without-delimiter');
    if (!endedByBoundary && !endedAtPage) reasons.add('caption-boundary-uncertain');
    return {
      ...identity,
      caption,
      captionSegments,
      captionComplete: !['missing-caption-continuation', 'caption-truncated',
        'open-caption-boundary', 'caption-boundary-uncertain'].some(reason => reasons.has(reason)),
      panelHints: conservativePanelHints(caption),
      contextParagraphs: [],
      captionElement: null,
      element: null,
      imageElements: [],
      analysisImages: [],
      documentOrder: pageIndex * 1000 + lineIndex,
      sourceKind: 'pdf-page-caption',
      imageEvidence: 'full-page',
      pageNumber: page.pageNumber,
      pageNumbers,
      captionPageNumbers: [...pageNumbers],
      artworkPageNumbers: [page.pageNumber],
      artworkPageEvidence: 'caption-anchor-page',
      // A caption anchor cannot prove that artwork does not precede/follow it.
      artworkCoverage: 'partial',
      needsReview: reasons.size > 0,
      reviewReasons: [...reasons],
      boundaryConfidence: reasons.size ? 'review' : 'high'
    };
  }

  function candidateScore(candidate) {
    return Math.min(candidate.caption.length, MAX_CAPTION_CHARS) / 100 +
      candidate.panelHints.length * 20 - candidate.reviewReasons.length * 40 +
      (candidate.hasDelimiter ? 200 : 0);
  }

  function mergeDuplicateCandidate(previous, candidate) {
    const left = normalizedCaption(previous.caption).toLowerCase();
    const right = normalizedCaption(candidate.caption).toLowerCase();
    const compatible = left === right || left.includes(right) || right.includes(left);
    const winner = candidateScore(candidate) > candidateScore(previous) ? candidate : previous;
    // Divergent body references must never move a genuine caption/image to an
    // earlier page or add unrelated full pages to the model's image inputs.
    const pageNumbers = [...winner.pageNumbers];
    const reviewReasons = new Set(winner.reviewReasons);
    if (!compatible) reviewReasons.add('divergent-duplicate-caption');
    return {
      ...winner,
      pageNumber: winner.pageNumber,
      pageNumbers,
      captionPageNumbers: Array.isArray(winner.captionPageNumbers)
        ? [...winner.captionPageNumbers] : [...pageNumbers],
      artworkPageNumbers: Array.isArray(winner.artworkPageNumbers)
        ? [...winner.artworkPageNumbers] : [winner.pageNumber],
      artworkPageEvidence: winner.artworkPageEvidence || 'caption-anchor-page',
      artworkCoverage: winner.artworkCoverage === 'partial' ? 'partial' : 'complete',
      needsReview: winner.needsReview || !compatible,
      reviewReasons: [...reviewReasons],
      boundaryConfidence: winner.needsReview || !compatible ? 'review' : 'high',
      duplicateCaptionCount: (Number(previous.duplicateCaptionCount) || 1) + 1
    };
  }

  function extractNativePdfFigures(input, options = {}) {
    const sourceFingerprint = String(options.sourceFingerprint || (
      !Array.isArray(input) && (input?.documentHash || input?.documentFingerprint)
    ) || '').trim();
    const pages = (Array.isArray(input) ? input : Array.isArray(input?.pages) ? input.pages : [])
      .slice(0, MAX_PAGES)
      .map(page => ({
        pageNumber: positivePageNumber(page?.pageNumber),
        lines: nativePdfPageLines(page)
      }))
      .filter(page => page.pageNumber && page.lines.length)
      .sort((left, right) => left.pageNumber - right.pageNumber);
    const byId = new Map();
    pages.forEach((page, pageIndex) => {
      page.lines.forEach((line, lineIndex) => {
        if (parseCaptionContinuation(line.text)) return;
        const identity = parseCaptionHeader(line.text);
        if (!identity) return;
        const extracted = collectCaptionCandidate(pages, pageIndex, lineIndex, identity);
        const candidate = extracted ? { ...extracted, sourceFingerprint } : null;
        if (!candidate) return;
        const previous = byId.get(candidate.figureId);
        byId.set(candidate.figureId,
          previous ? mergeDuplicateCandidate(previous, candidate) : candidate);
      });
    });
    const limit = Math.max(0, Math.min(300, Number(options.limit) || 300));
    return [...byId.values()]
      .sort((left, right) => left.documentOrder - right.documentOrder)
      .slice(0, limit);
  }

  function manifestImage(images, figure, index) {
    if (typeof images === 'function') return images(figure, index);
    if (images instanceof Map) return images.get(figure.figureId) ?? images.get(index);
    if (images && typeof images === 'object') {
      return images[figure.figureId] ?? images[index] ?? null;
    }
    return null;
  }

  function manifestIdentity(figure, index) {
    const parsed = parseCaptionHeader(
      `${String(figure?.figureLabel || '').trim()}. ${String(figure?.caption || '').trim()}`
    );
    if (parsed) return parsed;
    const figureId = String(figure?.figureId || '').trim();
    const extended = /^figure-ed(\d{1,3})$/iu.exec(figureId);
    const ordinary = /^figure-(s?)(\d{1,3})$/iu.exec(figureId);
    const number = Number(figure?.figureNumber) || Number(extended?.[1] || ordinary?.[2]);
    if (!Number.isInteger(number) || number < 1 || number > 999) return null;
    const isSupplemental = figure?.kind === 'supplemental' || figure?.isSupplemental === true ||
      Boolean(ordinary?.[1]);
    const figureSeries = extended ? 'extended-data' : isSupplemental ? 'supplemental' : 'main';
    const figureCode = extended ? `ED${number}` : `${isSupplemental ? 'S' : ''}${number}`;
    return {
      figureNumber: number,
      figureCode,
      figureSeries,
      isSupplemental: figureSeries !== 'main',
      figureId: extended ? `figure-ed${number}` : `figure-${figureCode.toLowerCase()}`,
      figureLabel: extended ? `Extended Data Figure ${number}` : `Figure ${figureCode}`,
      header: '', body: '', hasDelimiter: true, fallbackIndex: index
    };
  }

  function normalizePdfManifestInventory(manifest, images = null) {
    const values = Array.isArray(manifest?.figures) ? manifest.figures.slice(0, 300) : [];
    return values.flatMap((figure, index) => {
      if (!figure || typeof figure !== 'object') return [];
      const identity = manifestIdentity(figure, index);
      if (!identity) return [];
      const pageNumber = positivePageNumber(figure.pageNumber) ||
        positivePageNumber(Number(figure.pageIndex) + 1);
      const pageNumbers = [...new Set((Array.isArray(figure.captionPageNumbers)
        ? figure.captionPageNumbers
        : Array.isArray(figure.pageNumbers) ? figure.pageNumbers : [pageNumber])
        .map(positivePageNumber).filter(Boolean))]
        .sort((a, b) => a - b);
      const explicitArtworkPages = Array.isArray(figure.artworkPageNumbers);
      const artworkPageNumbers = [...new Set((explicitArtworkPages
        ? figure.artworkPageNumbers : [pageNumber])
        .map(positivePageNumber).filter(Boolean))];
      const suppliedImage = manifestImage(images, figure, index);
      const imageElements = Array.isArray(suppliedImage)
        ? suppliedImage.filter(Boolean)
        : suppliedImage?.element ? [suppliedImage.element]
          : suppliedImage && typeof suppliedImage === 'object' && suppliedImage.nodeType === 1
            ? [suppliedImage] : [];
      const caption = normalizedCaption(figure.caption);
      const needsReview = !caption || !pageNumbers.length || !artworkPageNumbers.length;
      return [{
        ...identity,
        caption,
        panelHints: Array.isArray(figure.panelHints)
          ? [...new Set(figure.panelHints.map(value => String(value).toUpperCase())
            .filter(value => /^[A-Z]$/u.test(value)))].slice(0, 26)
          : conservativePanelHints(caption),
        contextParagraphs: [],
        captionElement: null,
        element: null,
        imageElements,
        analysisImages: [],
        imageSource: typeof suppliedImage === 'string' ? suppliedImage
          : String(suppliedImage?.dataUrl || suppliedImage?.url || ''),
        imageAssetPath: String(figure.image?.workspacePath || figure.imageAssetPath || ''),
        imageSha256: String(figure.image?.sha256 || figure.imageSha256 || ''),
        documentOrder: index,
        sourceKind: 'pdf-figure-manifest',
        imageEvidence: 'whole-figure',
        pageNumber: pageNumbers[0] || 0,
        pageNumbers,
        captionPageNumbers: [...pageNumbers],
        artworkPageNumbers,
        artworkPageEvidence: explicitArtworkPages ? 'manifest' : 'caption-anchor-page',
        artworkCoverage: explicitArtworkPages && artworkPageNumbers.length > 0 &&
          figure.artworkCoverage === 'complete' ? 'complete' : 'partial',
        needsReview,
        reviewReasons: [!caption ? 'missing-caption' : '',
          !pageNumbers.length ? 'missing-page-number' : '',
          !artworkPageNumbers.length ? 'missing-artwork-pages' : ''].filter(Boolean),
        boundaryConfidence: needsReview ? 'review' : 'high',
        sourceFingerprint: String(manifest?.documentFingerprint || ''),
        sourceDocumentFingerprint: String(manifest?.documentFingerprint || '')
      }];
    });
  }

  return {
    linesFromPdfTextContent,
    nativePdfPageLines,
    parseNativePdfFigureCaptionHeader: parseCaptionHeader,
    extractNativePdfFigures,
    normalizePdfManifestInventory
  };
});
