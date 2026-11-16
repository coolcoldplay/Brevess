(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  const DEFAULT_MAX_CHARACTERS = 6000;
  const DEFAULT_MAX_SENTENCES = 18;

  function normalize(value) {
    return String(value ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim();
  }

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
  }

  function safeInteger(value, fallback = null) {
    const number = Number(value);
    return Number.isSafeInteger(number) ? number : fallback;
  }

  function positiveInteger(value, fallback = null) {
    const number = safeInteger(value, fallback);
    return number !== null && number > 0 ? number : fallback;
  }

  function unique(values) {
    return [...new Set(values.filter(Boolean))];
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  }

  function phrasePattern(value) {
    const phrase = normalize(value);
    if (!phrase) return null;
    return new RegExp(escapeRegExp(phrase).replace(/\s+/gu, '\\s+'), 'giu');
  }

  function figureQualifier(value) {
    const qualifier = normalize(value).toLowerCase().replace(/\.$/u, '');
    if (qualifier === 'supp' || qualifier === 'supplementary') return 'supplementary';
    if (qualifier === 'extended data') return 'extended-data';
    return 'main';
  }

  function figureLabelPattern(label) {
    const value = normalize(label);
    if (!value) return null;
    const parsed = value.match(
      /^(?:(supplementary|supp\.?|extended\s+data)\s+)?(?:fig(?:ure)?s?\.?\s*)?(S?\d+)\s*([A-Za-z]?)$/iu
    );
    if (!parsed) return phrasePattern(value);
    const panel = parsed[3] ? escapeRegExp(parsed[3]) : '[A-Za-z]?';
    return {
      regex: new RegExp(
        `\\b(?:(supplementary|supp\\.?|extended\\s+data)\\s+)?` +
        `fig(?:ure)?s?\\.?\\s*${parsed[2]}\\s*${panel}(?![\\p{L}\\d])`, 'giu'
      ),
      qualifier: figureQualifier(parsed[1])
    };
  }

  function patternMatches(text, pattern, kind) {
    if (!pattern) return [];
    const regex = pattern.regex || pattern;
    regex.lastIndex = 0;
    const matches = [];
    for (const match of String(text || '').matchAll(regex)) {
      if (pattern.regex && figureQualifier(match[1]) !== pattern.qualifier) continue;
      const start = match.index || 0;
      matches.push({ start, end: start + match[0].length, kind });
    }
    return matches;
  }

  function hintMatches(text, hints, kind) {
    return unique((Array.isArray(hints) ? hints : []).map(normalize)).flatMap(hint =>
      patternMatches(text, phrasePattern(hint), kind)
    );
  }

  function sentenceSpans(text) {
    if (typeof shared.findScientificSentenceBounds !== 'function') {
      throw new Error('sentence-boundary must be loaded before pdf-figure-context');
    }
    const value = String(text || '');
    const spans = [];
    let cursor = 0;
    while (cursor < value.length) {
      while (cursor < value.length && /\s/u.test(value[cursor])) cursor += 1;
      if (cursor >= value.length) break;
      const bounds = shared.findScientificSentenceBounds(
        value, cursor, Math.min(value.length, cursor + 1)
      );
      if (!Number.isSafeInteger(bounds?.start) || !Number.isSafeInteger(bounds?.end) ||
          bounds.end <= cursor) {
        throw new Error('sentence-boundary returned a non-progressing range');
      }
      spans.push({
        start: bounds.start,
        end: bounds.end,
        text: value.slice(bounds.start, bounds.end),
        sentenceIndex: spans.length
      });
      cursor = bounds.end;
    }
    return spans;
  }

  function mergeFigureAbbreviationSpans(spans, text) {
    const merged = [];
    for (let index = 0; index < spans.length; index += 1) {
      const current = spans[index];
      const next = spans[index + 1];
      if (next && /^supp\.$/iu.test(current.text.trim()) &&
          /^fig(?:ure)?s?\.?\s*S?\d/iu.test(next.text.trim())) {
        merged.push({
          start: current.start,
          end: next.end,
          text: text.slice(current.start, next.end),
          sentenceIndex: merged.length
        });
        index += 1;
      } else {
        merged.push({ ...current, sentenceIndex: merged.length });
      }
    }
    return merged;
  }

  function publicTraceId(value) {
    const id = normalize(value).slice(0, 256);
    // Native semantic IDs contain a colon but are local identities, not URLs.
    if (/^pdf-paragraph:[a-f0-9]{16}(?::figure-caption:figure-[a-z0-9-]{1,64})?$/u.test(id)) return id;
    return /^(?:[a-z][a-z0-9+.-]*:|\/\/)/iu.test(id) ? '' : id;
  }

  function recordIdentity(record) {
    return publicTraceId(record?.recordId) || publicTraceId(record?.paragraphId) ||
      publicTraceId(record?.sourceKey);
  }

  function documentBinding(value) {
    const documentHash = normalize(value?.documentHash).slice(0, 256);
    const documentGeneration = positiveInteger(value?.documentGeneration);
    const revision = positiveInteger(value?.semanticRevision ?? value?.revision);
    return documentHash && documentGeneration !== null && revision !== null
      ? { documentHash, documentGeneration, revision }
      : null;
  }

  function bindingEquals(left, right) {
    return Boolean(left && right && left.documentHash === right.documentHash &&
      left.documentGeneration === right.documentGeneration &&
      left.revision === right.revision);
  }

  function recordFigureIds(record) {
    return unique([
      record?.figureId,
      ...(Array.isArray(record?.figureIds) ? record.figureIds : []),
      ...(Array.isArray(record?.targetFigureIds) ? record.targetFigureIds : [])
    ].map(normalize));
  }

  function inspectSourceFragments(value) {
    const source = Array.isArray(value) ? value : [];
    const issues = [];
    if (source.length > 24) issues.push('SOURCE_FRAGMENTS_TRUNCATED');
    function inspectItem(item) {
      const pageNumber = positiveInteger(item?.pageNumber);
      const start = safeInteger(item?.start);
      const end = safeInteger(item?.end);
      return pageNumber !== null && start !== null && end !== null &&
        start >= 0 && end > start ? {
          pageNumber, start, end,
          quote: typeof item?.quote === 'string' ? item.quote : null
        } : null;
    }
    const items = source.slice(0, 24).map(inspectItem);
    if (source.slice(0, 256).some(item => inspectItem(item) === null)) {
      issues.push('SOURCE_FRAGMENTS_INVALID');
    }
    const validItems = items.filter(Boolean);
    const ordered = [...validItems].sort((left, right) =>
      left.pageNumber - right.pageNumber || left.start - right.start || left.end - right.end);
    if (ordered.some((item, index) => index > 0 &&
        item.pageNumber === ordered[index - 1].pageNumber &&
        item.start < ordered[index - 1].end)) {
      issues.push('SOURCE_FRAGMENT_CONFLICT');
    }
    return { items: validItems, issues: unique(issues) };
  }

  function sourceFragments(value) {
    return inspectSourceFragments(value).items.map(({ pageNumber, start, end }) =>
      ({ pageNumber, start, end }));
  }

  function comparableText(value) {
    return normalize(String(value || '')
      .replace(/\u00ad/gu, '')
      .replace(/([\p{L}])-\s+([\p{L}])/gu, '$1$2'));
  }

  function locatorFor(record, expected, fragmentInspection) {
    const fragments = fragmentInspection.items;
    const issues = [...fragmentInspection.issues];
    if (issues.length) {
      return {
        status: 'degraded', precision: 'unavailable', issues,
        sourceStart: null, sourceEnd: null
      };
    }
    if (!fragments.length) {
      if (typeof record?.normalizedText === 'string') {
        return {
          status: 'unresolved', precision: 'unavailable',
          issues: ['SOURCE_MAPPING_UNAVAILABLE'], sourceStart: null, sourceEnd: null
        };
      }
      return {
        status: 'resolved', precision: 'exact-raw', issues: [],
        sourceStart: null, sourceEnd: null
      };
    }
    if (fragments.length > 1) {
      const quoted = fragments.every(fragment => fragment.quote !== null);
      if (!quoted) {
        return {
          status: 'degraded', precision: 'unavailable',
          issues: ['SOURCE_FRAGMENT_QUOTE_MISSING'], sourceStart: null, sourceEnd: null
        };
      }
      if (quoted && comparableText(fragments.map(fragment => fragment.quote).join(' ')) !==
          comparableText(expected)) {
        return {
          status: 'unresolved', precision: 'unavailable',
          issues: ['SOURCE_FRAGMENT_QUOTE_MISMATCH'], sourceStart: null, sourceEnd: null
        };
      }
      return {
        status: 'degraded', precision: 'discontinuous', issues: [],
        sourceStart: null, sourceEnd: null
      };
    }
    const fragment = fragments[0];
    if (fragment.quote === expected && fragment.end - fragment.start === expected.length) {
      return {
        status: 'resolved', precision: 'exact-raw', issues: [],
        sourceStart: fragment.start, sourceEnd: fragment.end
      };
    }
    if (fragment.quote !== null && comparableText(fragment.quote) === comparableText(expected)) {
      return {
        status: 'degraded', precision: 'normalized-equivalent', issues: [],
        sourceStart: null, sourceEnd: null
      };
    }
    return {
      status: 'unresolved', precision: 'unavailable',
      issues: [fragment.quote === null
        ? 'SOURCE_FRAGMENT_QUOTE_MISSING' : 'SOURCE_FRAGMENT_QUOTE_MISMATCH'],
      sourceStart: null, sourceEnd: null
    };
  }

  function pageNumbersFor(record, span = null) {
    const allFragmentPages = (Array.isArray(span?.sourceFragments)
      ? span.sourceFragments : []).map(item => positiveInteger(item?.pageNumber));
    const spanPages = unique([
      positiveInteger(span?.pageNumber),
      ...(Array.isArray(span?.pageNumbers) ? span.pageNumbers : []),
      ...allFragmentPages
    ].map(value => positiveInteger(value))).sort((left, right) => left - right);
    if (span && spanPages.length) return spanPages;
    return unique([
      positiveInteger(record?.pageNumber),
      ...(Array.isArray(record?.pageNumbers) ? record.pageNumbers : [])
    ].map(value => positiveInteger(value))).sort((left, right) => left - right);
  }

  function semanticSentenceSpans(record, text) {
    const declared = Array.isArray(record?.semanticSentences)
      ? record.semanticSentences : [];
    if (declared.length) {
      const spans = declared.slice(0, 256).map((sentence, sentenceIndex) => {
        const start = safeInteger(sentence?.normalizedStart);
        const end = safeInteger(sentence?.normalizedEnd);
        if (start === null || end === null || start < 0 || end <= start || end > text.length) {
          return null;
        }
        const expected = text.slice(start, end);
        const declaredText = typeof sentence?.normalizedText === 'string'
          ? sentence.normalizedText : expected;
        if (declaredText !== expected) return null;
        const fragmentInspection = inspectSourceFragments(sentence?.sourceFragments);
        const locator = locatorFor(record, expected, fragmentInspection);
        return {
          start, end, text: expected, sentenceIndex,
          sentenceId: normalize(sentence?.sentenceId).slice(0, 256),
          pageNumber: positiveInteger(sentence?.pageNumber),
          pageNumbers: pageNumbersFor(record, sentence),
          sourceFragments: fragmentInspection.items,
          locatorStatus: locator.status,
          locatorPrecision: locator.precision,
          locatorIssues: locator.issues,
          sourceStart: locator.sourceStart,
          sourceEnd: locator.sourceEnd
        };
      }).filter(Boolean);
      if (spans.length === declared.length) return spans;
      return [];
    }
    const normalizedOnly = typeof record?.normalizedText === 'string';
    return mergeFigureAbbreviationSpans(sentenceSpans(text), text).map(span => ({
      ...span,
      sentenceId: '',
      pageNumber: positiveInteger(record?.pageNumber),
      pageNumbers: pageNumbersFor(record),
      sourceFragments: [],
      locatorStatus: normalizedOnly ? 'unresolved' : 'resolved',
      locatorPrecision: normalizedOnly ? 'unavailable' : 'exact-raw',
      locatorIssues: normalizedOnly ? ['SOURCE_MAPPING_UNAVAILABLE'] : [],
      sourceStart: normalizedOnly ? null : span.start,
      sourceEnd: normalizedOnly ? null : span.end
    }));
  }

  function locationFor(record, span) {
    const pageStartBase = safeInteger(record?.pageStart);
    const documentStartBase = safeInteger(record?.documentStart);
    const paragraphId = normalize(record?.paragraphId || recordIdentity(record));
    const pageNumbers = pageNumbersFor(record, span);
    const fragments = sourceFragments(span.sourceFragments);
    const offsetsAreOneToOne = span.locatorPrecision === 'exact-raw';
    const hasExactPageFragment = offsetsAreOneToOne && fragments.length === 1;
    const sourceStart = span.sourceStart === null
      ? null : safeInteger(span.sourceStart, span.start);
    const sourceEnd = span.sourceEnd === null
      ? null : safeInteger(span.sourceEnd, span.end);
    return {
      recordId: recordIdentity(record),
      sourceKey: publicTraceId(record?.sourceKey) || recordIdentity(record),
      paragraphId: publicTraceId(paragraphId),
      sentenceId: span.sentenceId || `${paragraphId}:sentence:${span.sentenceIndex}`,
      pageNumber: positiveInteger(span.pageNumber) || pageNumbers[0] || null,
      pageNumbers,
      paragraphIndex: safeInteger(record?.paragraphIndex),
      sentenceIndex: span.sentenceIndex,
      normalizedStart: span.start,
      normalizedEnd: span.end,
      expectedNormalizedQuote: span.text,
      sourceFragments: fragments,
      locatorStatus: span.locatorStatus,
      locatorPrecision: span.locatorPrecision,
      locatorIssues: span.locatorIssues,
      sourceStart,
      sourceEnd,
      pageStart: hasExactPageFragment ? sourceStart
        : !offsetsAreOneToOne || pageStartBase === null || sourceStart === null
          ? null : pageStartBase + sourceStart,
      pageEnd: hasExactPageFragment ? sourceEnd
        : !offsetsAreOneToOne || pageStartBase === null || sourceEnd === null
          ? null : pageStartBase + sourceEnd,
      documentStart: hasExactPageFragment || !offsetsAreOneToOne ||
        documentStartBase === null || sourceStart === null
        ? null : documentStartBase + sourceStart,
      documentEnd: hasExactPageFragment || !offsetsAreOneToOne ||
        documentStartBase === null || sourceEnd === null
        ? null : documentStartBase + sourceEnd
    };
  }

  function sourceOrder(left, right) {
    const leftPage = safeInteger(left.record?.pageNumber, Number.MAX_SAFE_INTEGER);
    const rightPage = safeInteger(right.record?.pageNumber, Number.MAX_SAFE_INTEGER);
    const leftParagraph = safeInteger(left.record?.paragraphIndex, Number.MAX_SAFE_INTEGER);
    const rightParagraph = safeInteger(right.record?.paragraphIndex, Number.MAX_SAFE_INTEGER);
    return leftPage - rightPage || leftParagraph - rightParagraph ||
      left.recordPosition - right.recordPosition || left.span.start - right.span.start ||
      left.kind.localeCompare(right.kind);
  }

  function rankOrder(targetPage) {
    return (left, right) => {
      const leftPage = safeInteger(left.record?.pageNumber);
      const rightPage = safeInteger(right.record?.pageNumber);
      const leftDistance = targetPage === null || leftPage === null
        ? Number.MAX_SAFE_INTEGER : Math.abs(leftPage - targetPage);
      const rightDistance = targetPage === null || rightPage === null
        ? Number.MAX_SAFE_INTEGER : Math.abs(rightPage - targetPage);
      return right.score - left.score || leftDistance - rightDistance || sourceOrder(left, right);
    };
  }

  function evidenceItem(candidate) {
    const location = locationFor(candidate.record, candidate.span);
    const matches = candidate.matches
      .filter(match => match.start < candidate.span.end && match.end > candidate.span.start)
      .map(match => {
        const normalizedStart = Math.max(candidate.span.start, match.start);
        const normalizedEnd = Math.min(candidate.span.end, match.end);
        const sourceStart = location.locatorPrecision === 'exact-raw' &&
          location.sourceStart !== null
          ? location.sourceStart + normalizedStart - candidate.span.start : null;
        const sourceEnd = sourceStart === null
          ? null : sourceStart + normalizedEnd - normalizedStart;
        return {
          kind: match.kind,
          start: normalizedStart - candidate.span.start,
          end: normalizedEnd - candidate.span.start,
          normalizedStart,
          normalizedEnd,
          sourceStart,
          sourceEnd
        };
      });
    return {
      kind: candidate.kind,
      relevance: candidate.relevance,
      text: candidate.span.text,
      matchSpans: matches,
      location
    };
  }

  function allRecordPageNumbers(record) {
    const semanticPages = (Array.isArray(record?.semanticSentences)
      ? record.semanticSentences : []).flatMap(sentence =>
      (Array.isArray(sentence?.sourceFragments) ? sentence.sourceFragments : [])
        .map(fragment => positiveInteger(fragment?.pageNumber)));
    return unique([...pageNumbersFor(record), ...semanticPages])
      .sort((left, right) => left - right);
  }

  function coverageInput(input, records, targetPage) {
    const declared = input?.sourceCoverage && typeof input.sourceCoverage === 'object'
      ? input.sourceCoverage : {};
    const providedPageNumbers = unique(records.flatMap(allRecordPageNumbers))
      .sort((left, right) => left - right);
    const indexedPageNumbers = unique((Array.isArray(declared.indexedPageNumbers)
      ? declared.indexedPageNumbers : []).map(value => safeInteger(value)))
      .sort((left, right) => left - right);
    const missingPageNumbers = unique((Array.isArray(declared.missingPageNumbers)
      ? declared.missingPageNumbers : []).map(value => safeInteger(value)))
      .sort((left, right) => left - right);
    const failedPageNumbers = unique((Array.isArray(declared.failedPageNumbers)
      ? declared.failedPageNumbers : []).map(value => safeInteger(value)))
      .sort((left, right) => left - right);
    return {
      declaredPageCount: positiveInteger(declared.pageCount || declared.expectedPages),
      indexedPageNumbers,
      missingPageNumbers,
      failedPageNumbers,
      providedPageNumbers,
      targetPagePresent: targetPage === null ? null : providedPageNumbers.includes(targetPage),
      targetPage: targetPage === null ? null : {
        pageNumber: targetPage,
        indexed: indexedPageNumbers.includes(targetPage),
        provided: providedPageNumbers.includes(targetPage),
        missing: missingPageNumbers.includes(targetPage),
        failed: failedPageNumbers.includes(targetPage)
      },
      partialIndex: positiveInteger(declared.pageCount || declared.expectedPages) !== null
        ? indexedPageNumbers.length < positiveInteger(
          declared.pageCount || declared.expectedPages
        ) : false
    };
  }

  function safeAssetId(value) {
    const id = String(value || '').trim();
    return /^[a-z0-9][a-z0-9._-]{0,127}$/iu.test(id) && publicTraceId(id) ? id : '';
  }

  function safeContentHash(value) {
    const hash = String(value || '').trim().toLowerCase();
    return /^[a-f0-9]{64}$/u.test(hash) ? hash : '';
  }

  function safeNormalizedRect(value) {
    if (!value || typeof value !== 'object') return null;
    const rect = {
      x: Number(value.x), y: Number(value.y),
      width: Number(value.width), height: Number(value.height)
    };
    return Object.values(rect).every(Number.isFinite) && rect.x >= 0 && rect.y >= 0 &&
      rect.width > 0 && rect.height > 0 && rect.x + rect.width <= 1 &&
      rect.y + rect.height <= 1 ? rect : null;
  }

  function capabilityContract(input, hasTextEvidence, bindingValid = true) {
    const route = input?.route === 'vision' ? 'vision' : 'text-only';
    const visualSet = input?.visualEvidenceSet && typeof input.visualEvidenceSet === 'object'
      ? input.visualEvidenceSet : null;
    if (visualSet?.version === 'pdf-figure-visual-evidence-set-v1') {
      const targetFigureId = normalize(input?.target?.figureId);
      const binding = documentBinding(input);
      const visualBinding = documentBinding(visualSet.binding);
      const requiredPages = (Array.isArray(visualSet.requiredArtworkPageNumbers)
        ? visualSet.requiredArtworkPageNumbers : []).map(positiveInteger);
      const trustedArtworkPages = (Array.isArray(input?.target?.artworkPageNumbers)
        ? input.target.artworkPageNumbers : []).map(positiveInteger);
      const assets = Array.isArray(visualSet.assets) ? visualSet.assets : [];
      const pageCount = positiveInteger(input?.sourceCoverage?.pageCount ||
        input?.sourceCoverage?.expectedPages || input?.pageCount);
      const indexedPages = unique((Array.isArray(input?.sourceCoverage?.indexedPageNumbers)
        ? input.sourceCoverage.indexedPageNumbers : []).map(value => positiveInteger(value)));
      const setDigest = safeContentHash(visualSet.setDigest);
      const identityBound = Boolean(bindingValid && binding && targetFigureId &&
        bindingEquals(visualBinding, binding) && normalize(visualSet.figureId) === targetFigureId);
      const pagesValid = requiredPages.length >= 2 && requiredPages.length <= 4 &&
        !requiredPages.includes(null) && new Set(requiredPages).size === requiredPages.length &&
        requiredPages.length === trustedArtworkPages.length &&
        requiredPages.every((page, index) => page === trustedArtworkPages[index]) &&
        requiredPages.every(page => (pageCount === null || page <= pageCount) &&
          (!indexedPages.length || indexedPages.includes(page)));
      const imageInputs = assets.length === requiredPages.length ? assets.map((asset, index) => {
        const assetId = safeAssetId(asset?.assetId);
        const imageContentHash = safeContentHash(asset?.imageContentHash);
        const sourceType = normalize(asset?.sourceType).toLowerCase();
        const pageNumber = positiveInteger(asset?.pageNumber);
        return assetId && imageContentHash && sourceType === 'page-region' &&
          pageNumber === requiredPages[index]
          ? { assetId, imageContentHash, sourceType, pageNumber }
          : null;
      }) : [];
      const coverageComplete = visualSet.coverageComplete === true &&
        input?.target?.artworkCoverage !== 'partial';
      const setValid = identityBound && Boolean(setDigest) && pagesValid &&
        imageInputs.length === requiredPages.length && imageInputs.every(Boolean);
      const canSend = route === 'vision' && coverageComplete && setValid;
      let limitations;
      if (!bindingValid) limitations = ['INPUT_BINDING_INVALID'];
      else if (route === 'text-only') limitations = ['TEXT_ONLY_ROUTE'];
      else if (!coverageComplete) limitations = ['ARTWORK_COVERAGE_INCOMPLETE'];
      else if (!identityBound) limitations = ['VISUAL_BINDING_CONFLICT'];
      else if (!pagesValid || imageInputs.length !== requiredPages.length) {
        limitations = ['VISUAL_SET_COVERAGE_INVALID'];
      } else if (!setDigest || imageInputs.some(item => !item)) {
        limitations = ['VISUAL_SET_IDENTITY_INVALID'];
      } else limitations = ['IMAGE_NOT_YET_OBSERVED'];
      return {
        capabilities: {
          route,
          hasTextEvidence,
          canAnalyzeText: hasTextEvidence,
          imageInputRequested: route === 'vision',
          imageInputAvailable: route === 'vision' && setValid && coverageComplete,
          visualEvidenceBound: route === 'vision' && setValid && coverageComplete,
          canSendImageToModel: canSend,
          imageObservationPerformed: false,
          canClaimImageObservation: false,
          imageSourceType: 'visual-evidence-set',
          limitations
        },
        imageInput: null,
        imageInputs: setValid ? imageInputs : [],
        visualEvidenceSet: setValid ? {
          version: visualSet.version,
          figureId: targetFigureId,
          requiredArtworkPageNumbers: [...requiredPages],
          coverageComplete,
          assets: imageInputs,
          setDigest
        } : null
      };
    }
    const visual = input?.visualEvidence && typeof input.visualEvidence === 'object'
      ? input.visualEvidence : {};
    const targetFigureId = normalize(input?.target?.figureId);
    const binding = documentBinding(input);
    const visualBinding = documentBinding(visual);
    const available = visual.available === true;
    const requestedSourceType = normalize(visual.sourceType).toLowerCase();
    const imageSourceType = available && ['full-figure', 'panel', 'page-region']
      .includes(requestedSourceType) ? requestedSourceType : available ? 'unknown' : 'none';
    const identityBound = Boolean(bindingValid && available && binding && targetFigureId &&
      bindingEquals(visualBinding, binding) &&
      normalize(visual.figureId) === targetFigureId && imageSourceType !== 'unknown');
    const assetId = safeAssetId(visual.assetId);
    const imageContentHash = safeContentHash(visual.imageContentHash);
    const pageNumber = positiveInteger(visual.pageNumber);
    const rect = safeNormalizedRect(visual.rect);
    const pageCount = positiveInteger(input?.sourceCoverage?.pageCount ||
      input?.sourceCoverage?.expectedPages || input?.pageCount);
    const indexedPages = unique((Array.isArray(input?.sourceCoverage?.indexedPageNumbers)
      ? input.sourceCoverage.indexedPageNumbers : []).map(value => positiveInteger(value)));
    const trustedFigurePages = unique([
      positiveInteger(input?.target?.pageNumber),
      ...(Array.isArray(input?.target?.pageNumbers) ? input.target.pageNumbers : [])
    ].map(value => positiveInteger(value)));
    const pageInDocument = pageNumber !== null &&
      (pageCount === null || pageNumber <= pageCount) &&
      (!indexedPages.length || indexedPages.includes(pageNumber));
    const pageBoundToFigure = pageNumber !== null &&
      trustedFigurePages.includes(pageNumber);
    const regionValid = imageSourceType !== 'page-region' ||
      (pageInDocument && pageBoundToFigure && rect !== null);
    const assetValid = identityBound && Boolean(assetId && imageContentHash && regionValid);
    const coverageComplete = input?.target?.artworkCoverage !== 'partial';
    const canSend = route === 'vision' && assetValid && coverageComplete;
    let limitations;
    if (!bindingValid) limitations = ['INPUT_BINDING_INVALID'];
    else if (route === 'text-only') limitations = ['TEXT_ONLY_ROUTE'];
    else if (!coverageComplete) limitations = ['ARTWORK_COVERAGE_INCOMPLETE'];
    else if (!available) limitations = ['BOUND_IMAGE_EVIDENCE_NOT_AVAILABLE'];
    else if (!identityBound) limitations = ['VISUAL_BINDING_CONFLICT'];
    else if (!assetId) limitations = ['VISUAL_ASSET_HANDLE_MISSING'];
    else if (!imageContentHash) limitations = ['VISUAL_CONTENT_IDENTITY_INVALID'];
    else if (!regionValid) limitations = ['VISUAL_REGION_INVALID'];
    else limitations = ['IMAGE_NOT_YET_OBSERVED'];
    const imageInput = assetValid ? {
      assetId, imageContentHash, sourceType: imageSourceType,
      ...(imageSourceType === 'page-region' ? { pageNumber, rect } : {})
    } : null;
    return {
      capabilities: {
        route,
        hasTextEvidence,
        canAnalyzeText: hasTextEvidence,
        imageInputRequested: route === 'vision',
        imageInputAvailable: route === 'vision' && assetValid && coverageComplete,
        visualEvidenceBound: route === 'vision' && assetValid && coverageComplete,
        canSendImageToModel: canSend,
        imageObservationPerformed: false,
        canClaimImageObservation: false,
        imageSourceType,
        limitations
      },
      imageInput: route === 'vision' ? imageInput : null
    };
  }

  function selectPdfFigureContext(input = {}, inputOptions = {}) {
    const records = (Array.isArray(input.records) ? input.records : [])
      .filter(record => record && typeof record === 'object');
    const target = input.target && typeof input.target === 'object' ? input.target : {};
    const targetFigureId = normalize(target.figureId);
    const targetPage = positiveInteger(target.pageNumber);
    const binding = documentBinding(input);
    const targetBinding = documentBinding(target);
    const expectedBinding = input.expectedBinding === undefined
      ? binding : documentBinding(input.expectedBinding);
    let bindingFailureReason = null;
    if (!binding || !targetFigureId || !targetBinding ||
        (input.expectedBinding !== undefined && !expectedBinding)) {
      bindingFailureReason = 'DOCUMENT_BINDING_MISSING';
    } else if (!bindingEquals(targetBinding, binding)) {
      bindingFailureReason = 'TARGET_BINDING_CONFLICT';
    } else if (input.expectedBinding !== undefined &&
        expectedBinding.documentHash === binding.documentHash &&
        expectedBinding.documentGeneration > binding.documentGeneration) {
      bindingFailureReason = 'STALE_DOCUMENT_GENERATION';
    } else if (input.expectedBinding !== undefined &&
        expectedBinding.documentHash === binding.documentHash &&
        expectedBinding.documentGeneration === binding.documentGeneration &&
        expectedBinding.revision > binding.revision) {
      bindingFailureReason = 'STALE_SEMANTIC_REVISION';
    } else if (input.expectedBinding !== undefined &&
        !bindingEquals(expectedBinding, binding)) {
      bindingFailureReason = 'DOCUMENT_BINDING_CONFLICT';
    }
    if (!bindingFailureReason) {
      for (const record of records) {
        const sourceBinding = documentBinding(record);
        if (!sourceBinding || !bindingEquals(sourceBinding, binding)) {
          bindingFailureReason = 'SOURCE_BINDING_CONFLICT';
          break;
        }
      }
    }
    const labelPattern = figureLabelPattern(target.label);
    const captionHints = unique([
      ...(Array.isArray(target.captionHints) ? target.captionHints : []),
      target.captionHint
    ].map(normalize));
    const referenceHints = unique([
      ...(Array.isArray(target.referenceHints) ? target.referenceHints : []),
      target.referenceHint
    ].map(normalize));
    const candidates = [];
    const matchedCaptionRecords = new Set();
    const matchedBodyRecords = new Set();
    const relevantRecords = new Set();
    let emptySourceRecordCount = 0;
    let unboundCaptionRecordCount = 0;
    let wholePageRecordCount = 0;
    const maxCharacters = Math.max(1,
      safeInteger(inputOptions.maxCharacters, DEFAULT_MAX_CHARACTERS));
    const maxSentences = Math.max(1,
      safeInteger(inputOptions.maxSentences, DEFAULT_MAX_SENTENCES));
    const initialCoverage = coverageInput(input, records, targetPage);

    if (bindingFailureReason) {
      const emptyEvidence = { version: 2, captions: [], body: [] };
      const capability = capabilityContract(input, false, false);
      return deepFreeze({
        version: 2,
        binding: { valid: false, failureReason: bindingFailureReason },
        document: binding || {
          documentHash: normalize(input.documentHash),
          documentGeneration: positiveInteger(input.documentGeneration),
          revision: positiveInteger(input.semanticRevision ?? input.revision)
        },
        target: {
          figureId: targetFigureId, label: normalize(target.label),
          pageNumber: targetPage, captionHints, referenceHints
        },
        captionEvidence: [], bodyEvidence: [], textualEvidence: emptyEvidence,
        capabilities: capability.capabilities,
        imageInput: capability.imageInput,
        confidence: 'low', fallback: 'identity-invalid',
        budget: {
          maxCharacters, maxSentences, usedCharacters: 0,
          usedSentences: 0, truncated: false
        },
        coverage: {
          inputRecordCount: records.length, examinedRecordCount: 0,
          captionRecordCount: 0, bodyRecordCount: 0,
          matchedCaptionRecordCount: 0, matchedBodyRecordCount: 0,
          includedCaptionSentenceCount: 0, includedBodySentenceCount: 0,
          omittedCandidateSentenceCount: 0, excludedIrrelevantRecordCount: 0,
          emptySourceRecordCount: 0, matchedCaptionPageNumbers: [],
          matchedBodyPageNumbers: [], captionHit: false, bodyHit: false,
          ...initialCoverage,
          omissions: [bindingFailureReason], missingReasons: [bindingFailureReason]
        }
      });
    }

    records.forEach((record, recordPosition) => {
      const text = typeof record.normalizedText === 'string'
        ? record.normalizedText : String(record.text || '');
      const recordId = recordIdentity(record) || `record-${recordPosition}`;
      if (!text.trim()) {
        emptySourceRecordCount += 1;
        return;
      }
      const spans = semanticSentenceSpans(record, text);
      if (!spans.length) {
        emptySourceRecordCount += 1;
        return;
      }
      const type = normalize(record.recordType || record.kind || 'body').toLowerCase();
      const ids = recordFigureIds(record);
      const identityMatch = Boolean(targetFigureId && ids.includes(targetFigureId));
      const identityConflict = Boolean(targetFigureId && ids.length && !identityMatch);
      const labelMatches = patternMatches(text, labelPattern, 'figure-label');
      const captionHintMatches = hintMatches(text, captionHints, 'caption-hint');
      const referenceHintMatches = hintMatches(text, referenceHints, 'reference-hint');

      if (type === 'figure-caption') {
        if (!identityMatch) {
          if (!identityConflict) unboundCaptionRecordCount += 1;
          return;
        }
        relevantRecords.add(recordId);
        matchedCaptionRecords.add(recordId);
        const matches = [...labelMatches, ...captionHintMatches];
        spans.forEach((span, sentenceIndex) => {
          const directMatch = matches.some(match =>
            match.start < span.end && match.end > span.start);
          candidates.push({
            kind: 'caption',
            relevance: directMatch ? 'caption-match' : 'caption-context',
            record, recordPosition, span, matches,
            score: (directMatch ? 340 : 280) - sentenceIndex
          });
        });
        return;
      }

      if (type === 'pdf-page') {
        wholePageRecordCount += 1;
        return;
      }
      if (!['body', 'paragraph', 'semantic-paragraph'].includes(type)) return;
      if (identityConflict) return;
      const directMatches = [...labelMatches, ...referenceHintMatches];
      const directSentenceIndexes = new Set();
      directMatches.forEach(match => {
        const sentence = spans.find(span => match.start < span.end && match.end > span.start);
        if (sentence) directSentenceIndexes.add(sentence.sentenceIndex);
      });
      if (identityMatch && !directSentenceIndexes.size) {
        spans.forEach(span => directSentenceIndexes.add(span.sentenceIndex));
      }
      if (!directSentenceIndexes.size) return;

      relevantRecords.add(recordId);
      matchedBodyRecords.add(recordId);
      const selectedIndexes = new Map();
      directSentenceIndexes.forEach(index => {
        selectedIndexes.set(index, { relevance: identityMatch && !directMatches.length
          ? 'bound-paragraph' : 'direct-reference', score: directMatches.length ? 220 : 180 });
        for (const neighbor of [index - 1, index + 1]) {
          if (neighbor >= 0 && neighbor < spans.length && !selectedIndexes.has(neighbor)) {
            selectedIndexes.set(neighbor, { relevance: 'neighbor-context', score: 100 });
          }
        }
      });
      [...selectedIndexes].forEach(([sentenceIndex, detail]) => candidates.push({
        kind: 'body', relevance: detail.relevance,
        record, recordPosition, span: spans[sentenceIndex],
        matches: directMatches, score: detail.score
      }));
    });

    const ranked = [...candidates].sort(rankOrder(targetPage));
    const selected = [];
    const selectedSet = new Set();
    let usedCharacters = 0;
    function trySelect(candidate) {
      if (!candidate || selectedSet.has(candidate)) return false;
      const separatorCost = selected.length ? 2 : 0;
      if (selected.length >= maxSentences ||
          usedCharacters + separatorCost + candidate.span.text.length > maxCharacters) return false;
      selected.push(candidate);
      selectedSet.add(candidate);
      usedCharacters += separatorCost + candidate.span.text.length;
      return true;
    }
    function trySelectFirst(kind) {
      for (const candidate of ranked) {
        if (candidate.kind === kind && trySelect(candidate)) return;
      }
    }
    let selectedPair = false;
    if (maxSentences >= 2) {
      const rankedBodies = ranked.filter(candidate => candidate.kind === 'body');
      const rankedCaptions = ranked.filter(candidate => candidate.kind === 'caption');
      for (const bodyCandidate of rankedBodies) {
        const captionCandidate = rankedCaptions.find(candidate =>
          bodyCandidate.span.text.length + 2 + candidate.span.text.length <= maxCharacters);
        if (!captionCandidate) continue;
        trySelect(bodyCandidate);
        trySelect(captionCandidate);
        selectedPair = true;
        break;
      }
    }
    if (!selectedPair) {
      trySelectFirst('body');
      trySelectFirst('caption');
    }
    ranked.forEach(trySelect);
    selected.sort(sourceOrder);

    const captions = selected.filter(item => item.kind === 'caption').map(evidenceItem);
    const body = selected.filter(item => item.kind === 'body').map(evidenceItem);
    const includedCaptionRecords = new Set(captions.map(item => item.location.recordId));
    const includedBodyRecords = new Set(body.map(item => item.location.recordId));
    const selectedLocatorIssues = unique([...captions, ...body].flatMap(item =>
      item.location.locatorIssues));
    const omissions = [];
    if (!matchedCaptionRecords.size) omissions.push('CAPTION_NOT_FOUND');
    else if (!captions.length) omissions.push('CAPTION_BUDGET_OMITTED');
    if (!matchedBodyRecords.size) omissions.push('BODY_REFERENCE_NOT_FOUND');
    else if (!body.length) omissions.push('BODY_BUDGET_OMITTED');
    if (emptySourceRecordCount) omissions.push('EMPTY_SOURCE_RECORDS');
    if (unboundCaptionRecordCount) omissions.push('UNBOUND_CAPTION_RECORDS');
    if (wholePageRecordCount) omissions.push('WHOLE_PAGE_RECORDS_EXCLUDED');
    if (selected.length < candidates.length) omissions.push('BUDGET_EXHAUSTED');
    const sourceCoverage = initialCoverage;
    if (sourceCoverage.targetPagePresent === false) omissions.push('TARGET_PAGE_NOT_PROVIDED');
    if (sourceCoverage.missingPageNumbers.length) omissions.push('MISSING_PAGES');
    if (sourceCoverage.failedPageNumbers.length) omissions.push('FAILED_PAGES');
    if (sourceCoverage.partialIndex) omissions.push('PARTIAL_INDEX');
    omissions.push(...selectedLocatorIssues);
    const noRelevanceHit = !matchedCaptionRecords.size && !matchedBodyRecords.size;
    const hasTextEvidence = captions.length + body.length > 0;
    const confidence = captions.length && body.length
      ? 'high' : (captions.length || body.length) ? 'medium' : 'low';
    const fallback = noRelevanceHit ? 'no-relevance-hit'
      : !hasTextEvidence ? 'budget-exhausted' : null;
    const matchedCaptionPageNumbers = unique(captions.flatMap(item =>
      item.location.pageNumbers)).sort((left, right) => left - right);
    const matchedBodyPageNumbers = unique(body.flatMap(item =>
      item.location.pageNumbers)).sort((left, right) => left - right);
    const capability = capabilityContract(input, hasTextEvidence, true);

    return deepFreeze({
      version: 2,
      binding: { valid: true, failureReason: null },
      document: {
        documentHash: normalize(input.documentHash),
        documentGeneration: positiveInteger(input.documentGeneration),
        revision: positiveInteger(input.semanticRevision ?? input.revision),
        semanticRevision: positiveInteger(input.semanticRevision ?? input.revision)
      },
      target: {
        figureId: targetFigureId,
        label: normalize(target.label),
        pageNumber: targetPage,
        captionHints,
        referenceHints
      },
      captionEvidence: captions,
      bodyEvidence: body,
      textualEvidence: { version: 2, captions, body },
      capabilities: capability.capabilities,
      imageInput: capability.imageInput,
      ...(capability.imageInputs ? { imageInputs: capability.imageInputs } : {}),
      ...(capability.visualEvidenceSet
        ? { visualEvidenceSet: capability.visualEvidenceSet } : {}),
      confidence,
      fallback,
      budget: {
        maxCharacters, maxSentences, usedCharacters,
        usedSentences: selected.length,
        truncated: selected.length < candidates.length
      },
      coverage: {
        inputRecordCount: records.length,
        examinedRecordCount: records.length,
        captionRecordCount: records.filter(record =>
          normalize(record.recordType || record.kind).toLowerCase() === 'figure-caption').length,
        bodyRecordCount: records.filter(record => {
          const type = normalize(record.recordType || record.kind || 'body').toLowerCase();
          return ['body', 'paragraph', 'pdf-page', 'semantic-paragraph'].includes(type);
        }).length,
        matchedCaptionRecordCount: includedCaptionRecords.size,
        matchedBodyRecordCount: includedBodyRecords.size,
        includedCaptionSentenceCount: captions.length,
        includedBodySentenceCount: body.length,
        omittedCandidateSentenceCount: candidates.length - selected.length,
        excludedIrrelevantRecordCount: records.length - relevantRecords.size - emptySourceRecordCount,
        emptySourceRecordCount,
        unboundCaptionRecordCount,
        wholePageRecordCount,
        matchedCaptionPageNumbers,
        matchedBodyPageNumbers,
        captionHit: captions.length > 0,
        bodyHit: body.length > 0,
        ...sourceCoverage,
        omissions: unique(omissions),
        missingReasons: unique(omissions)
      }
    });
  }

  return {
    PDF_FIGURE_CONTEXT_DEFAULTS: Object.freeze({
      maxCharacters: DEFAULT_MAX_CHARACTERS,
      maxSentences: DEFAULT_MAX_SENTENCES
    }),
    selectPdfFigureContext
  };
});
