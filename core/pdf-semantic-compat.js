(function attach(root, factory) {
  const dependency = typeof module === 'object' && module.exports
    ? require('./pdf-semantic-index.js') : root.SciLLM;
  const api = factory(dependency);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(dependency = {}) {
  const COMPAT_SCHEMA_VERSION = 1;
  const MAX_FOCUS_RANGES = 16;
  const MAX_FOCUS_PAGES = 4;
  const MAX_FOCUS_OFFSET = 100000000;
  const REASONS = Object.freeze({
    STALE: 'PDF_SEMANTIC_SOURCE_STALE',
    NOT_FOUND: 'PDF_SEMANTIC_PARAGRAPH_NOT_FOUND',
    INVALID: 'PDF_SEMANTIC_RANGE_INVALID',
    QUOTE_REQUIRED: 'PDF_SEMANTIC_QUOTE_REQUIRED',
    QUOTE_MISMATCH: 'PDF_SEMANTIC_QUOTE_MISMATCH',
    MAPPING_UNAVAILABLE: 'PDF_SEMANTIC_MAPPING_UNAVAILABLE',
    BOUNDARY_AMBIGUOUS: 'PDF_SEMANTIC_BOUNDARY_AMBIGUOUS'
  });

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const nested of Object.values(value)) {
      if (nested && typeof nested === 'object') deepFreeze(nested);
    }
    return Object.freeze(value);
  }

  const canonicalHash = value => {
    const hash = String(value || '').trim().toLowerCase().replace(/^sha256:/u, '');
    return /^[a-f0-9]{64}$/u.test(hash) ? hash : '';
  };
  const semanticIndex = value => value?.index || value;
  const nativeStructure = value => value?.structure || value;
  const positiveSafeInteger = value => Number.isSafeInteger(value) && value >= 1;

  function identitySnapshot(semanticDocument, nativeDocument) {
    const index = semanticIndex(semanticDocument);
    const native = nativeStructure(nativeDocument);
    const documentHash = canonicalHash(semanticDocument?.documentHash || index?.document?.documentHash);
    return Object.freeze({
      documentId: `sha256:${documentHash}`,
      adapterId: 'pdf-native',
      documentHash,
      documentGeneration: semanticDocument?.documentGeneration,
      revision: semanticDocument?.revision ?? index?.document?.revision,
      outerSchemaVersion: semanticDocument?.schemaVersion,
      semanticSchemaVersion: index?.schemaVersion,
      semanticCacheKey: String(index?.cacheKey || ''),
      semanticProvenanceKey: String(index?.provenanceKey || ''),
      indexObject: index,
      semanticDocumentObject: semanticDocument,
      nativeDocumentObject: nativeDocument,
      nativeStructureObject: native,
      nativeDocumentId: String(native?.documentId || ''),
      nativeAdapterId: String(native?.adapterId || ''),
      nativeDocumentHash: canonicalHash(native?.documentHash),
      nativeDocumentGeneration: nativeDocument?.documentGeneration,
      indexDocumentId: String(index?.document?.documentId || ''),
      indexDocumentHash: canonicalHash(index?.document?.documentHash),
      indexRevision: index?.document?.revision
    });
  }

  function validBoundIdentity(snapshot, semanticDocument, nativeDocument) {
    const current = identitySnapshot(semanticDocument, nativeDocument);
    return Boolean(snapshot.documentHash) &&
      positiveSafeInteger(snapshot.documentGeneration) &&
      positiveSafeInteger(snapshot.revision) &&
      snapshot.documentId === `sha256:${snapshot.documentHash}` &&
      semanticDocument?.documentId === snapshot.documentId &&
      semanticDocument?.adapterId === snapshot.adapterId &&
      semanticDocument?.documentHash === snapshot.documentHash &&
      semanticIndex(semanticDocument)?.document?.documentHash === snapshot.documentHash &&
      nativeStructure(nativeDocument)?.documentHash === snapshot.documentHash &&
      current.documentId === snapshot.documentId &&
      current.documentHash === snapshot.documentHash &&
      current.documentGeneration === snapshot.documentGeneration &&
      current.revision === snapshot.revision &&
      current.outerSchemaVersion === 1 &&
      current.outerSchemaVersion === snapshot.outerSchemaVersion &&
      current.semanticSchemaVersion === dependency.SCHEMA_VERSION &&
      current.semanticSchemaVersion === snapshot.semanticSchemaVersion &&
      current.indexObject === snapshot.indexObject &&
      current.semanticCacheKey === snapshot.semanticCacheKey &&
      current.semanticCacheKey.startsWith(
        `pdf-semantic-v${dependency.SCHEMA_VERSION}:${snapshot.documentHash}:${snapshot.revision}:`) &&
      current.indexDocumentId === `pdf-document:${snapshot.documentHash}` &&
      current.indexDocumentHash === snapshot.documentHash &&
      current.indexRevision === snapshot.revision &&
      current.semanticProvenanceKey === snapshot.semanticProvenanceKey &&
      typeof dependency.pdfSemanticProvenanceKey === 'function' &&
      current.semanticProvenanceKey === dependency.pdfSemanticProvenanceKey(current.indexObject) &&
      current.nativeDocumentId === snapshot.documentId &&
      current.nativeAdapterId === snapshot.adapterId &&
      current.nativeDocumentHash === snapshot.documentHash &&
      current.nativeDocumentGeneration === snapshot.documentGeneration;
  }

  function boundIdentityIsCurrent(snapshot, semanticDocument, nativeDocument) {
    const index = semanticIndex(semanticDocument);
    const native = nativeStructure(nativeDocument);
    return semanticDocument === snapshot.semanticDocumentObject &&
      nativeDocument === snapshot.nativeDocumentObject &&
      index === snapshot.indexObject && native === snapshot.nativeStructureObject &&
      semanticDocument?.schemaVersion === snapshot.outerSchemaVersion &&
      semanticDocument?.documentId === snapshot.documentId &&
      semanticDocument?.adapterId === snapshot.adapterId &&
      semanticDocument?.documentHash === snapshot.documentHash &&
      semanticDocument?.documentGeneration === snapshot.documentGeneration &&
      semanticDocument?.revision === snapshot.revision &&
      index?.schemaVersion === snapshot.semanticSchemaVersion &&
      index?.cacheKey === snapshot.semanticCacheKey &&
      index?.provenanceKey === snapshot.semanticProvenanceKey &&
      index?.document?.documentId === snapshot.indexDocumentId &&
      index?.document?.documentHash === snapshot.indexDocumentHash &&
      index?.document?.revision === snapshot.indexRevision &&
      native?.documentId === snapshot.nativeDocumentId &&
      native?.adapterId === snapshot.nativeAdapterId &&
      native?.documentHash === snapshot.nativeDocumentHash &&
      nativeDocument?.documentGeneration === snapshot.nativeDocumentGeneration;
  }

  function publicIdentity(snapshot) {
    return {
      documentId: snapshot.documentId,
      adapterId: snapshot.adapterId,
      documentHash: snapshot.documentHash,
      documentGeneration: snapshot.documentGeneration,
      revision: snapshot.revision,
      semanticSchemaVersion: snapshot.semanticSchemaVersion,
      semanticCacheKey: snapshot.semanticCacheKey,
      semanticProvenanceKey: snapshot.semanticProvenanceKey
    };
  }

  function navigationIdentity(snapshot) {
    return {
      documentId: snapshot.documentId,
      documentHash: snapshot.documentHash,
      documentGeneration: snapshot.documentGeneration,
      revision: snapshot.revision,
      semanticCacheKey: snapshot.semanticCacheKey,
      semanticProvenanceKey: snapshot.semanticProvenanceKey
    };
  }

  function staleSourceError() {
    const error = new Error(REASONS.STALE);
    error.code = REASONS.STALE;
    return error;
  }

  function requireValidBinding(semanticDocument, nativeDocument) {
    const snapshot = identitySnapshot(semanticDocument, nativeDocument);
    let valid = false;
    try {
      valid = validBoundIdentity(snapshot, semanticDocument, nativeDocument);
    } catch (_) {
      valid = false;
    }
    if (!valid) {
      throw staleSourceError();
    }
    return snapshot;
  }

  const exposesInternalDocumentIdentity = value =>
    typeof value === 'string' && value.includes('pdf-document:');

  function validSemanticStructure(index) {
    if (!Array.isArray(index?.sections) || !Array.isArray(index?.paragraphs)) return false;

    const paragraphs = new Map();
    for (const paragraph of index.paragraphs) {
      const paragraphId = paragraph?.paragraphId;
      if (typeof paragraphId !== 'string' || !paragraphId.trim() ||
          exposesInternalDocumentIdentity(paragraphId) || paragraphs.has(paragraphId)) return false;
      paragraphs.set(paragraphId, paragraph);
    }

    const sections = new Map();
    for (const section of index.sections) {
      const sectionId = section?.sectionId;
      if (typeof sectionId !== 'string' || !sectionId.trim() ||
          exposesInternalDocumentIdentity(sectionId) || sections.has(sectionId) ||
          !Number.isSafeInteger(section?.level) || section.level < 1 ||
          typeof section?.source !== 'string' || !section.source.trim() ||
          exposesInternalDocumentIdentity(section.source) ||
          !(section.headingId === null || (typeof section.headingId === 'string' &&
            section.headingId.trim() && !exposesInternalDocumentIdentity(section.headingId))) ||
          !(section.parentSectionId === null || (typeof section.parentSectionId === 'string' &&
            section.parentSectionId.trim() &&
            !exposesInternalDocumentIdentity(section.parentSectionId))) ||
          !Array.isArray(section.childSectionIds) || !Array.isArray(section.paragraphIds)) {
        return false;
      }
      sections.set(sectionId, section);
    }

    const paragraphOwners = new Map();
    for (const [sectionId, section] of sections) {
      const childIds = new Set();
      for (const childId of section.childSectionIds) {
        if (typeof childId !== 'string' || !childId.trim() || childId === sectionId ||
            exposesInternalDocumentIdentity(childId) || childIds.has(childId) ||
            !sections.has(childId)) return false;
        childIds.add(childId);
      }
      const paragraphIds = new Set();
      for (const paragraphId of section.paragraphIds) {
        if (typeof paragraphId !== 'string' || !paragraphId.trim() ||
            exposesInternalDocumentIdentity(paragraphId) || paragraphIds.has(paragraphId) ||
            !paragraphs.has(paragraphId) || paragraphOwners.has(paragraphId)) return false;
        paragraphIds.add(paragraphId);
        paragraphOwners.set(paragraphId, sectionId);
      }
    }

    for (const [sectionId, section] of sections) {
      const parentId = section.parentSectionId;
      if (parentId !== null) {
        const parent = sections.get(parentId);
        if (!parent || !parent.childSectionIds.includes(sectionId)) return false;
      }
      for (const childId of section.childSectionIds) {
        if (sections.get(childId)?.parentSectionId !== sectionId) return false;
      }
    }

    const colors = new Map();
    for (const sectionId of sections.keys()) {
      if (colors.get(sectionId) === 2) continue;
      const trail = [];
      let cursor = sectionId;
      while (cursor !== null) {
        const color = colors.get(cursor) || 0;
        if (color === 1) return false;
        if (color === 2) break;
        colors.set(cursor, 1);
        trail.push(cursor);
        cursor = sections.get(cursor).parentSectionId;
      }
      for (const visited of trail) colors.set(visited, 2);
    }

    if (paragraphOwners.size !== paragraphs.size) return false;
    for (const [paragraphId, paragraph] of paragraphs) {
      if (typeof paragraph?.sectionId !== 'string' || !paragraph.sectionId.trim() ||
          paragraphOwners.get(paragraphId) !== paragraph.sectionId) return false;
    }
    return true;
  }

  function requireValidSemanticStructure(index) {
    let valid = false;
    try {
      valid = validSemanticStructure(index);
    } catch (_) {
      valid = false;
    }
    if (!valid) throw staleSourceError();
  }

  function resultFor(snapshot, input = {}) {
    return deepFreeze({
      schemaVersion: COMPAT_SCHEMA_VERSION,
      status: input.status || 'unresolved',
      precision: input.precision || 'none',
      reasonCode: input.reasonCode || '',
      verified: input.verified === true,
      ...publicIdentity(snapshot),
      paragraphId: String(input.paragraphId || ''),
      normalizedRange: {
        start: Number.isSafeInteger(input.start) ? input.start : null,
        end: Number.isSafeInteger(input.end) ? input.end : null
      },
      normalizedQuote: String(input.normalizedQuote || ''),
      ranges: Array.isArray(input.ranges) ? input.ranges : [],
      fallbackPageAnchors: Array.isArray(input.fallbackPageAnchors)
        ? input.fallbackPageAnchors : []
    });
  }

  function hasOnlyPairedSurrogates(text) {
    for (let index = 0; index < text.length; index += 1) {
      const current = text.charCodeAt(index);
      if (current >= 0xD800 && current <= 0xDBFF) {
        const next = text.charCodeAt(index + 1);
        if (!(next >= 0xDC00 && next <= 0xDFFF)) return false;
        index += 1;
      } else if (current >= 0xDC00 && current <= 0xDFFF) return false;
    }
    return true;
  }

  function strictOneToOneGraphemeSequence(raw, expected) {
    if (!hasOnlyPairedSurrogates(raw) || !hasOnlyPairedSurrogates(expected) ||
        typeof dependency.segmentPdfGraphemes !== 'function') return false;
    if (raw === expected) return true;
    const rawSegments = dependency.segmentPdfGraphemes(raw);
    const expectedSegments = dependency.segmentPdfGraphemes(expected);
    return rawSegments.length === expectedSegments.length && rawSegments.every((entry, index) =>
      entry.segment.length === expectedSegments[index].segment.length &&
      entry.segment.normalize('NFKC') === expectedSegments[index].segment);
  }

  function canonicalPages(index) {
    if (!Array.isArray(index?.mappings)) return null;
    const pages = new Map();
    for (const mapping of index.mappings) {
      const pageNumber = mapping?.pageNumber;
      if (!Number.isSafeInteger(pageNumber) || pageNumber < 1 ||
          typeof mapping?.rawText !== 'string' || pages.has(pageNumber)) return null;
      pages.set(pageNumber, mapping.rawText);
    }
    return pages;
  }

  function normalizedEdgeGrapheme(raw, edge) {
    if (!hasOnlyPairedSurrogates(raw) ||
        typeof dependency.segmentPdfGraphemes !== 'function') return '';
    const graphemes = dependency.segmentPdfGraphemes(raw);
    const selected = edge === 'start' ? graphemes[0] : graphemes.at(-1);
    return typeof selected?.segment === 'string' ? selected.segment.normalize('NFKC') : '';
  }

  function validDehyphenationGap(previous, current, pageText, gap) {
    const previousGrapheme = normalizedEdgeGrapheme(
      pageText.slice(previous.rawStart, previous.rawEnd), 'end');
    const currentGrapheme = normalizedEdgeGrapheme(
      pageText.slice(current.rawStart, current.rawEnd), 'start');
    return /^-(?:\r\n|\r|\n)$/u.test(gap) &&
      /\p{L}\p{M}*$/u.test(previousGrapheme) && /^\p{Ll}/u.test(currentGrapheme);
  }

  function validVirtualLineGap(gap) {
    return /^(?=[\s\S]*[\r\n])\s+$/u.test(gap);
  }

  function validPositionRunAdjacency(index, pages) {
    for (const paragraph of index.paragraphs) {
      if (typeof paragraph?.normalizedText !== 'string' ||
          !Array.isArray(paragraph?.positionRuns) || !paragraph.positionRuns.length) return false;
      let normalizedCursor = 0;
      let previousSource = null;
      let virtualAfterSource = false;
      for (const run of paragraph.positionRuns) {
        if (!run || !Number.isSafeInteger(run.normalizedStart) ||
            !Number.isSafeInteger(run.normalizedEnd) ||
            run.normalizedStart !== normalizedCursor || run.normalizedEnd <= run.normalizedStart ||
            run.normalizedEnd > paragraph.normalizedText.length) return false;
        if (run.kind === 'virtual-space') {
          if (!previousSource || virtualAfterSource || run.pageNumber !== null ||
              run.rawStart !== null || run.rawEnd !== null ||
              paragraph.normalizedText.slice(run.normalizedStart, run.normalizedEnd) !== ' ') {
            return false;
          }
          virtualAfterSource = true;
        } else if (run.kind === 'source') {
          if (!Number.isSafeInteger(run.pageNumber) || run.pageNumber < 1 ||
              !Number.isSafeInteger(run.rawStart) || !Number.isSafeInteger(run.rawEnd) ||
              run.rawStart < 0 || run.rawEnd <= run.rawStart ||
              !pages.has(run.pageNumber) || run.rawEnd > pages.get(run.pageNumber).length) {
            return false;
          }
          if (previousSource) {
            if (run.pageNumber === previousSource.pageNumber) {
              if (run.rawStart < previousSource.rawEnd) return false;
              const pageText = pages.get(run.pageNumber);
              const gap = pageText.slice(previousSource.rawEnd, run.rawStart);
              if (virtualAfterSource) {
                if (!validVirtualLineGap(gap)) return false;
              } else if (gap &&
                  !validDehyphenationGap(previousSource, run, pageText, gap)) return false;
            } else if (run.pageNumber <= previousSource.pageNumber || !virtualAfterSource) {
              return false;
            }
          } else if (virtualAfterSource) return false;
          previousSource = run;
          virtualAfterSource = false;
        } else return false;
        normalizedCursor = run.normalizedEnd;
      }
      if (virtualAfterSource || normalizedCursor !== paragraph.normalizedText.length) return false;
    }
    return true;
  }

  function requireValidPositionRunAdjacency(index, pages) {
    let valid = false;
    try {
      valid = validPositionRunAdjacency(index, pages);
    } catch (_) {
      valid = false;
    }
    if (!valid) throw staleSourceError();
  }

  function sourceRunMatchesText(run, normalizedText, pageText) {
    const raw = pageText.slice(run.rawStart, run.rawEnd);
    const expected = normalizedText.slice(run.normalizedStart, run.normalizedEnd);
    if (raw === expected) return true;
    if (/^\s+$/u.test(raw) && expected === ' ') return true;
    let normalized = dependency.normalizePdfTextWithOffsets(raw).normalizedText;
    if (/^\s/u.test(raw)) normalized = ` ${normalized}`;
    if (/\s$/u.test(raw)) normalized = `${normalized} `;
    return normalized === expected;
  }

  function validatePositionRuns(paragraph, pages) {
    const text = String(paragraph?.normalizedText || '');
    const runs = paragraph?.positionRuns;
    if (!Array.isArray(runs) || (!runs.length && text.length)) return false;
    let normalizedCursor = 0;
    let previousSource = null;
    for (const run of runs) {
      if (!run || !Number.isSafeInteger(run.normalizedStart) ||
          !Number.isSafeInteger(run.normalizedEnd) ||
          run.normalizedStart !== normalizedCursor || run.normalizedEnd <= run.normalizedStart ||
          run.normalizedEnd > text.length) return false;
      if (run.kind === 'virtual-space') {
        if (run.pageNumber !== null || run.rawStart !== null || run.rawEnd !== null ||
            text.slice(run.normalizedStart, run.normalizedEnd) !== ' ') return false;
      } else if (run.kind === 'source') {
        if (!Number.isSafeInteger(run.pageNumber) || run.pageNumber < 1 ||
            !Number.isSafeInteger(run.rawStart) || !Number.isSafeInteger(run.rawEnd) ||
            run.rawStart < 0 || run.rawEnd <= run.rawStart) return false;
        const pageText = pages.get(run.pageNumber);
        const raw = pageText?.slice(run.rawStart, run.rawEnd) || '';
        const expected = text.slice(run.normalizedStart, run.normalizedEnd);
        const rawSegments = hasOnlyPairedSurrogates(raw) &&
          dependency.segmentPdfGraphemes?.(raw);
        const validAtomicMapping = strictOneToOneGraphemeSequence(raw, expected) ||
          (/^\s+$/u.test(raw) && expected === ' ') ||
          (rawSegments?.length === 1 && raw.normalize('NFKC') === expected);
        if (pageText === undefined || run.rawEnd > pageText.length || !validAtomicMapping ||
            !sourceRunMatchesText(run, text, pageText)) return false;
        if (previousSource && (run.pageNumber < previousSource.pageNumber ||
            (run.pageNumber === previousSource.pageNumber &&
              run.rawStart < previousSource.rawEnd))) return false;
        previousSource = run;
      } else return false;
      normalizedCursor = run.normalizedEnd;
    }
    return normalizedCursor === text.length;
  }

  function derivedParagraphRanges(runs) {
    const ranges = [];
    for (const run of runs) {
      if (run?.kind !== 'source') continue;
      const previous = ranges.at(-1);
      if (previous && previous.pageNumber === run.pageNumber &&
          run.rawStart <= previous.end + 3) {
        previous.end = Math.max(previous.end, run.rawEnd);
      } else {
        ranges.push({ pageNumber: run.pageNumber, start: run.rawStart, end: run.rawEnd });
      }
    }
    return ranges;
  }

  function sameRawRanges(left, right) {
    return Array.isArray(right) && left.length === right.length && left.every((range, index) =>
      range.pageNumber === right[index]?.pageNumber && range.start === right[index]?.start &&
      range.end === right[index]?.end);
  }

  function sameRawQuotes(ranges, quotes, pages) {
    return Array.isArray(quotes) && ranges.length === quotes.length && ranges.every((range, index) =>
      range.pageNumber === quotes[index]?.pageNumber && range.start === quotes[index]?.start &&
      range.end === quotes[index]?.end &&
      pages.get(range.pageNumber)?.slice(range.start, range.end) === quotes[index]?.quote);
  }

  // One bit per UTF-16 boundary keeps construction linear without retaining a
  // per-character object map. Resolves can test a boundary in constant time.
  function compileGraphemeBoundaries(text) {
    if (!hasOnlyPairedSurrogates(text) ||
        typeof dependency.segmentPdfGraphemes !== 'function') return null;
    const bits = new Uint8Array(Math.ceil((text.length + 1) / 8));
    const mark = offset => { bits[offset >> 3] |= 1 << (offset & 7); };
    mark(0);
    for (const item of dependency.segmentPdfGraphemes(text)) mark(item.index);
    mark(text.length);
    return bits;
  }

  function compiledBoundaryIncludes(bits, offset) {
    return Boolean(bits && (bits[offset >> 3] & (1 << (offset & 7))));
  }

  function compileParagraphs(index, pages, snapshot) {
    const compiled = new Map();
    for (const paragraph of Array.isArray(index?.paragraphs) ? index.paragraphs : []) {
      const text = String(paragraph?.normalizedText || '');
      const runs = Array.isArray(paragraph?.positionRuns) ? paragraph.positionRuns : [];
      const derivedRanges = derivedParagraphRanges(runs);
      const mappingValid = validatePositionRuns(paragraph, pages) &&
        sameRawRanges(derivedRanges, paragraph?.ranges) &&
        sameRawQuotes(derivedRanges, paragraph?.rawQuoteByPage, pages) &&
        typeof dependency.pdfSemanticParagraphId === 'function' &&
        paragraph?.paragraphId === dependency.pdfSemanticParagraphId(
          snapshot.documentHash, snapshot.revision, derivedRanges);
      const entry = {
        paragraph,
        text,
        runs,
        pages,
        mappingValid,
        graphemeBoundaries: compileGraphemeBoundaries(text)
      };
      const existing = compiled.get(paragraph?.paragraphId);
      if (existing) existing.mappingValid = false;
      else compiled.set(paragraph?.paragraphId, entry);
    }
    return compiled;
  }

  function paragraphNavigationTarget(paragraph, snapshot, documentNormalizedStart) {
    const text = paragraph?.normalizedText;
    const firstRange = Array.isArray(paragraph?.ranges) ? paragraph.ranges[0] : null;
    if (typeof paragraph?.paragraphId !== 'string' || typeof text !== 'string' || !text.length ||
        !Number.isSafeInteger(firstRange?.pageNumber) || firstRange.pageNumber < 1 ||
        !Number.isSafeInteger(documentNormalizedStart) || documentNormalizedStart < 0) return null;
    const pageNumbers = [...new Set((Array.isArray(paragraph?.ranges) ? paragraph.ranges : [])
      .map(range => range?.pageNumber)
      .filter(pageNumber => Number.isSafeInteger(pageNumber) && pageNumber > 0))]
      .sort((left, right) => left - right);
    if (!pageNumbers.length) return null;
    return {
      kind: 'paragraph',
      ...navigationIdentity(snapshot),
      paragraphId: paragraph.paragraphId,
      pageNumber: firstRange.pageNumber,
      pageNumbers,
      normalizedStart: documentNormalizedStart,
      normalizedEnd: documentNormalizedStart + text.length,
      expectedNormalizedQuote: text
    };
  }

  function compiledHeadingTargets(index, pages, snapshot) {
    const candidates = new Map();
    for (const heading of Array.isArray(index?.headings) ? index.headings : []) {
      const headingId = heading?.headingId;
      if (typeof headingId !== 'string' || !headingId || candidates.has(headingId)) {
        if (typeof headingId === 'string') candidates.set(headingId, null);
        continue;
      }
      const pageNumber = heading.pageNumber;
      const start = heading.start;
      const end = heading.end;
      const pageText = pages.get(pageNumber);
      const expectedId = `pdf-heading:${snapshot.documentHash}:${snapshot.revision}:` +
        `${pageNumber}:${start}:${end}`;
      if (!Number.isSafeInteger(pageNumber) || pageNumber < 1 ||
          !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start ||
          pageText === undefined || end > pageText.length || headingId !== expectedId) {
        candidates.set(headingId, null);
        continue;
      }
      const title = pageText.slice(start, end).normalize('NFKC').replace(/\s+/gu, ' ').trim();
      candidates.set(headingId, title ? {
        title,
        target: {
          kind: 'heading',
          ...navigationIdentity(snapshot),
          headingId,
          pageNumber,
          start,
          end,
          expectedNormalizedQuote: title
        }
      } : null);
    }
    return candidates;
  }

  function semanticNavigationFromValidated(index, pages, snapshot) {
    let documentNormalizedCursor = 0;
    const paragraphs = new Map(index.paragraphs.map(paragraph => {
      const target = paragraphNavigationTarget(
        paragraph, snapshot, documentNormalizedCursor
      );
      documentNormalizedCursor += String(paragraph?.normalizedText || '').length;
      return [paragraph.paragraphId, target];
    }));
    const headings = compiledHeadingTargets(index, pages, snapshot);
    const firstPage = [...pages.keys()].sort((left, right) => left - right)[0] || 1;
    const sections = new Map();
    for (const section of index.sections) {
      const paragraphTargets = section.paragraphIds.map(paragraphId => paragraphs.get(paragraphId))
        .filter(Boolean);
      const heading = section.headingId ? headings.get(section.headingId) : null;
      const fallbackTarget = paragraphTargets[0] || {
        kind: 'page', ...navigationIdentity(snapshot), pageNumber: firstPage
      };
      const title = heading?.title || (section.source === 'implicit-preamble'
        ? 'Preamble' : section.source === 'implicit-document'
          ? 'Document' : paragraphTargets[0]?.expectedNormalizedQuote.slice(0, 160) || 'Section');
      sections.set(section.sectionId, {
        sectionId: section.sectionId,
        parentSectionId: section.parentSectionId,
        title,
        level: section.level,
        source: section.source,
        pageNumber: heading?.target.pageNumber || fallbackTarget.pageNumber,
        target: heading?.target || fallbackTarget,
        paragraphTargets,
        children: []
      });
    }
    for (const section of index.sections) {
      const node = sections.get(section.sectionId);
      node.children = section.childSectionIds.map(sectionId => sections.get(sectionId));
    }
    return deepFreeze({
      schemaVersion: 1,
      type: 'pdf-semantic-navigation',
      ...navigationIdentity(snapshot),
      sections: index.sections.filter(section => section.parentSectionId === null)
        .map(section => sections.get(section.sectionId))
    });
  }

  function firstOverlappingRun(runs, start) {
    let low = 0;
    let high = runs.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (runs[middle].normalizedEnd <= start) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  function pageAnchorsForRange(runs, start, end, validPages, startIndex) {
    const numbers = [];
    const add = pageNumber => {
      if (validPages.has(pageNumber) && !numbers.includes(pageNumber)) numbers.push(pageNumber);
    };
    for (let index = startIndex; index < runs.length; index += 1) {
      const run = runs[index];
      if (run.normalizedStart >= end) break;
      if (run.normalizedEnd <= start) continue;
      if (run.kind === 'source') add(run.pageNumber);
      else {
        for (let before = index - 1; before >= 0; before -= 1) {
          if (runs[before].kind === 'source') { add(runs[before].pageNumber); break; }
        }
        for (let after = index + 1; after < runs.length; after += 1) {
          if (runs[after].kind === 'source') { add(runs[after].pageNumber); break; }
        }
      }
    }
    return numbers.sort((left, right) => left - right).map(pageNumber => ({
      pageNumber, legacyParagraphId: `pdf-page-${pageNumber}`
    }));
  }

  function mapNormalizedRange(compiled, start, end, startIndex) {
    const { text, runs, pages } = compiled;
    const ranges = [];
    let boundaryAmbiguous = false;
    let normalizedEquivalent = false;
    let previousFragment = null;
    for (let index = startIndex; index < runs.length; index += 1) {
      const run = runs[index];
      if (run.normalizedStart >= end) break;
      if (run.normalizedEnd <= start) continue;
      const from = Math.max(start, run.normalizedStart);
      const to = Math.min(end, run.normalizedEnd);
      if (run.kind === 'virtual-space') {
        normalizedEquivalent = true;
        previousFragment = null;
        continue;
      }
      const oneToOne = run.normalizedEnd - run.normalizedStart === run.rawEnd - run.rawStart;
      if (!oneToOne && (from !== run.normalizedStart || to !== run.normalizedEnd)) {
        boundaryAmbiguous = true;
        break;
      }
      const rawStart = oneToOne ? run.rawStart + from - run.normalizedStart : run.rawStart;
      const rawEnd = oneToOne ? run.rawStart + to - run.normalizedStart : run.rawEnd;
      const quote = pages.get(run.pageNumber).slice(rawStart, rawEnd);
      const normalizedSlice = text.slice(from, to);
      const precision = quote === normalizedSlice ? 'exact-raw' : 'normalized-equivalent';
      if (precision !== 'exact-raw') normalizedEquivalent = true;
      if (previousFragment && previousFragment.normalizedEnd === from &&
          (previousFragment.pageNumber !== run.pageNumber || previousFragment.rawEnd !== rawStart)) {
        normalizedEquivalent = true;
      }
      const previous = ranges.at(-1);
      if (previous && previous.pageNumber === run.pageNumber && previous.end === rawStart) {
        previous.end = rawEnd;
        previous.quote += quote;
        if (precision !== 'exact-raw') previous.precision = 'normalized-equivalent';
      } else {
        ranges.push({ pageNumber: run.pageNumber,
          legacyParagraphId: `pdf-page-${run.pageNumber}`,
          start: rawStart, end: rawEnd, quote, precision });
      }
      previousFragment = { normalizedEnd: to, pageNumber: run.pageNumber, rawEnd };
    }
    return { ranges, boundaryAmbiguous, normalizedEquivalent };
  }

  function articleStructureFromValidated(index, native, snapshot) {
    const paragraphs = (Array.isArray(index?.paragraphs) ? index.paragraphs : [])
      .map((paragraph, order) => {
        const legacyParagraphIds = [...new Set((paragraph.positionRuns || [])
          .filter(run => run.kind === 'source' && Number.isSafeInteger(run.pageNumber))
          .map(run => `pdf-page-${run.pageNumber}`))];
        const pageNumber = Number(legacyParagraphIds[0]?.slice('pdf-page-'.length)) || null;
        return {
          paragraphId: paragraph.paragraphId,
          sourceKey: paragraph.paragraphId,
          sourceIdentity: pageNumber ? `pdf:${pageNumber}` : 'pdf:semantic',
          legacyParagraphId: legacyParagraphIds[0] || null,
          legacyParagraphIds,
          pageNumber,
          order,
          sectionId: paragraph.sectionId || null,
          kind: 'pdf-semantic-paragraph',
          recordType: 'body',
          text: paragraph.normalizedText,
          displayText: paragraph.normalizedText
        };
      });
    const nodes = (Array.isArray(index?.sections) ? index.sections : []).map((section, order) => ({
      sectionId: section.sectionId,
      level: section.level,
      source: section.source,
      headingId: section.headingId,
      parentSectionId: section.parentSectionId,
      childSectionIds: [...section.childSectionIds],
      paragraphIds: [...section.paragraphIds],
      order
    }));
    return deepFreeze({
      version: '1.0.0-pdf-semantic-compat',
      adapterId: snapshot.adapterId,
      publisherFamily: native?.publisherFamily || 'pdf-workspace',
      strategy: 'pdf-semantic-compatibility',
      documentId: snapshot.documentId,
      documentHash: snapshot.documentHash,
      documentGeneration: snapshot.documentGeneration,
      revision: snapshot.revision,
      semanticSchemaVersion: snapshot.semanticSchemaVersion,
      semanticCacheKey: snapshot.semanticCacheKey,
      semanticProvenanceKey: snapshot.semanticProvenanceKey,
      title: String(native?.title || ''),
      url: String(native?.url || ''),
      nodes,
      paragraphs,
      typedRecords: paragraphs,
      diagnostics: {
        semanticParagraphCount: paragraphs.length,
        semanticSectionCount: nodes.length
      }
    });
  }

  function adaptPdfSemanticIndexToArticleStructure(input = {}) {
    const semanticDocument = input.semanticDocument;
    const nativeDocument = input.nativeDocument;
    const index = semanticIndex(semanticDocument);
    const snapshot = requireValidBinding(semanticDocument, nativeDocument);
    requireValidSemanticStructure(index);
    const pages = canonicalPages(index);
    if (!pages) throw staleSourceError();
    requireValidPositionRunAdjacency(index, pages);
    return articleStructureFromValidated(
      index, nativeStructure(nativeDocument), snapshot
    );
  }

  function createPdfSemanticCompatibilityAdapter(input = {}) {
    const semanticDocument = input.semanticDocument;
    const nativeDocument = input.nativeDocument;
    const getCurrentSemanticDocument = typeof input.getCurrentSemanticDocument === 'function'
      ? input.getCurrentSemanticDocument : () => semanticDocument;
    const getCurrentNativeDocument = typeof input.getCurrentNativeDocument === 'function'
      ? input.getCurrentNativeDocument : () => nativeDocument;
    const index = semanticIndex(semanticDocument);
    const snapshot = requireValidBinding(semanticDocument, nativeDocument);
    requireValidSemanticStructure(index);
    const pages = canonicalPages(index);
    if (!pages) throw staleSourceError();
    requireValidPositionRunAdjacency(index, pages);
    const compiledParagraphs = compileParagraphs(index, pages, snapshot);
    const articleStructure = articleStructureFromValidated(
      index, nativeStructure(nativeDocument), snapshot
    );
    const semanticNavigation = semanticNavigationFromValidated(index, pages, snapshot);
    const navigationTargetsByParagraphId = new Map();
    const pendingNavigationSections = [...semanticNavigation.sections];
    while (pendingNavigationSections.length) {
      const section = pendingNavigationSections.shift();
      pendingNavigationSections.push(...section.children);
      for (const target of section.paragraphTargets) {
        navigationTargetsByParagraphId.set(target.paragraphId, target);
      }
    }

    function resolvePdfSemanticRange(paragraphId, start, end, expectedQuote) {
      let currentSemantic;
      let currentNative;
      try {
        currentSemantic = getCurrentSemanticDocument();
        currentNative = getCurrentNativeDocument();
      } catch (_) {
        return resultFor(snapshot, { paragraphId, start, end, reasonCode: REASONS.STALE });
      }
      if (currentSemantic !== semanticDocument || currentNative !== nativeDocument ||
          !boundIdentityIsCurrent(snapshot, currentSemantic, currentNative)) {
        return resultFor(snapshot, { paragraphId, start, end, reasonCode: REASONS.STALE });
      }
      const compiled = compiledParagraphs.get(paragraphId);
      if (!compiled) {
        return resultFor(snapshot, { paragraphId, start, end, reasonCode: REASONS.NOT_FOUND });
      }
      const navigationTarget = navigationTargetsByParagraphId.get(paragraphId);
      const text = compiled.text;
      const localStart = Number.isSafeInteger(start) && navigationTarget
        ? start - navigationTarget.normalizedStart : -1;
      const localEnd = Number.isSafeInteger(end) && navigationTarget
        ? end - navigationTarget.normalizedStart : -1;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
          !navigationTarget || start < navigationTarget.normalizedStart || end <= start ||
          end > navigationTarget.normalizedEnd ||
          !compiledBoundaryIncludes(compiled.graphemeBoundaries, localStart) ||
          !compiledBoundaryIncludes(compiled.graphemeBoundaries, localEnd)) {
        return resultFor(snapshot, { paragraphId, start, end, reasonCode: REASONS.INVALID });
      }
      const normalizedQuote = text.slice(localStart, localEnd);
      if (typeof expectedQuote !== 'string' || !expectedQuote.length) {
        return resultFor(snapshot, { paragraphId, start, end, normalizedQuote,
          reasonCode: REASONS.QUOTE_REQUIRED });
      }
      if (expectedQuote !== normalizedQuote) {
        return resultFor(snapshot, { paragraphId, start, end, normalizedQuote,
          reasonCode: REASONS.QUOTE_MISMATCH });
      }
      if (!compiled.mappingValid) {
        return resultFor(snapshot, { paragraphId, start, end, normalizedQuote,
          reasonCode: REASONS.MAPPING_UNAVAILABLE });
      }
      const startIndex = firstOverlappingRun(compiled.runs, localStart);
      const fallbackPageAnchors = pageAnchorsForRange(
        compiled.runs, localStart, localEnd, pages, startIndex
      );
      const mapped = mapNormalizedRange(compiled, localStart, localEnd, startIndex);
      if (mapped.boundaryAmbiguous) {
        return resultFor(snapshot, { paragraphId, start, end, normalizedQuote,
          status: fallbackPageAnchors.length ? 'degraded' : 'unresolved',
          precision: fallbackPageAnchors.length ? 'page-only' : 'none',
          reasonCode: REASONS.BOUNDARY_AMBIGUOUS, fallbackPageAnchors });
      }
      if (!mapped.ranges.length) {
        return resultFor(snapshot, { paragraphId, start, end, normalizedQuote,
          status: fallbackPageAnchors.length ? 'degraded' : 'unresolved',
          precision: fallbackPageAnchors.length ? 'page-only' : 'none',
          reasonCode: REASONS.MAPPING_UNAVAILABLE, fallbackPageAnchors });
      }
      return resultFor(snapshot, { paragraphId, start, end, normalizedQuote,
        status: 'resolved', verified: true,
        precision: mapped.normalizedEquivalent ? 'normalized-equivalent' : 'exact-raw',
        ranges: mapped.ranges });
    }

    function createNativeFocusRequest(paragraphId, start, end, expectedQuote) {
      const navigationTarget = navigationTargetsByParagraphId.get(paragraphId);
      if (!navigationTarget || typeof paragraphId !== 'string' || !paragraphId ||
          !Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
          start < navigationTarget.normalizedStart || end <= start ||
          end > navigationTarget.normalizedEnd || end > MAX_FOCUS_OFFSET ||
          typeof expectedQuote !== 'string' || !expectedQuote.length ||
          expectedQuote.length !== end - start) return null;
      const localStart = start - navigationTarget.normalizedStart;
      const localEnd = end - navigationTarget.normalizedStart;
      const result = resolvePdfSemanticRange(paragraphId, start, end, expectedQuote);
      const compiled = compiledParagraphs.get(paragraphId);
      if (!compiled?.mappingValid || result.paragraphId !== paragraphId ||
          result.normalizedRange.start !== start || result.normalizedRange.end !== end ||
          result.normalizedQuote !== expectedQuote) return null;
      const granularity = localStart === 0 && localEnd === compiled.text.length
        ? 'paragraph' : 'sentence';
      const startIndex = firstOverlappingRun(compiled.runs, localStart);
      const mapped = mapNormalizedRange(compiled, localStart, localEnd, startIndex);
      const identity = navigationIdentity(snapshot);
      if (result.status === 'resolved') {
        const precision = mapped.normalizedEquivalent
          ? 'normalized-equivalent' : 'exact-raw';
        if (result.verified !== true || result.precision !== precision ||
            mapped.boundaryAmbiguous || !mapped.ranges.length ||
            mapped.ranges.length > MAX_FOCUS_RANGES) return null;
        const ranges = [];
        const pageNumbers = new Set();
        let previous = null;
        for (const range of mapped.ranges) {
          const pageText = compiled.pages.get(range.pageNumber);
          if (typeof pageText !== 'string' ||
              !Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end) ||
              range.start < 0 || range.end <= range.start ||
              range.end > pageText.length || range.end > MAX_FOCUS_OFFSET ||
              pageText.slice(range.start, range.end) !== range.quote ||
              !['exact-raw', 'normalized-equivalent'].includes(range.precision) ||
              (previous && (range.pageNumber < previous.pageNumber ||
                (range.pageNumber === previous.pageNumber && range.start < previous.end)))) return null;
          pageNumbers.add(range.pageNumber);
          if (pageNumbers.size > MAX_FOCUS_PAGES) return null;
          ranges.push({ pageNumber: range.pageNumber, start: range.start, end: range.end,
            quote: range.quote, precision: range.precision });
          previous = range;
        }
        return deepFreeze({ schemaVersion: 1, type: 'pdf-native-focus-request', mode: 'ranges',
          ...identity, paragraphId, granularity,
          pageNumber: ranges[0].pageNumber, precision, ranges });
      }
      if (result.status === 'degraded' && result.verified !== true &&
          result.precision === 'page-only') {
        const anchors = pageAnchorsForRange(
          compiled.runs, localStart, localEnd, compiled.pages, startIndex);
        if (!anchors.length || anchors.length > MAX_FOCUS_PAGES) return null;
        const pageNumbers = anchors.map(anchor => anchor.pageNumber);
        return deepFreeze({ schemaVersion: 1, type: 'pdf-native-focus-request', mode: 'page-only',
          ...identity, paragraphId, granularity,
          pageNumber: pageNumbers[0], precision: 'page-only',
          pageNumbers, ranges: [] });
      }
      return null;
    }

    return Object.freeze({
      schemaVersion: COMPAT_SCHEMA_VERSION,
      ...publicIdentity(snapshot),
      articleStructure,
      semanticNavigation,
      resolvePdfSemanticRange,
      createNativeFocusRequest
    });
  }

  return { COMPAT_SCHEMA_VERSION, PDF_SEMANTIC_COMPAT_REASON_CODES: REASONS,
    createPdfSemanticCompatibilityAdapter, adaptPdfSemanticIndexToArticleStructure };
});
