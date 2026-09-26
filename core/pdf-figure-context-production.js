(function attach(root, factory) {
  const dependency = typeof module === 'object' && module.exports
    ? Object.assign({}, require('./pdf-figure-context.js'), require('./pdf-semantic-index.js'))
    : (root.SciLLM || {});
  const api = factory(dependency, root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared, root) {
  const VERSION = 1;
  const HASH_PATTERN = /^[a-f0-9]{64}$/u;

  function fail(code) {
    const error = new Error(code);
    error.code = code;
    throw error;
  }

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
  }

  function canonicalHash(value) {
    const hash = String(value || '').trim().toLowerCase().replace(/^sha256:/u, '');
    return HASH_PATTERN.test(hash) ? hash : '';
  }

  function positiveInteger(value) {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }

  function normalizedText(value) {
    return String(value || '').normalize('NFKC').replace(/\s+/gu, ' ').trim();
  }

  function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).sort()
      .map(key => [key, stableValue(value[key])]));
  }

  function stableJson(value) {
    return JSON.stringify(stableValue(value));
  }

  async function sha256Text(value) {
    const bytes = new TextEncoder().encode(String(value));
    if (root.crypto?.subtle) {
      const digest = await root.crypto.subtle.digest('SHA-256', bytes);
      return [...new Uint8Array(digest)].map(item => item.toString(16).padStart(2, '0')).join('');
    }
    if (typeof require === 'function') {
      return require('node:crypto').createHash('sha256').update(bytes).digest('hex');
    }
    fail('PDF_FIGURE_DIGEST_UNAVAILABLE');
  }

  function sameRanges(left, right) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((item, index) => {
      const candidate = right[index];
      return item?.pageNumber === candidate?.pageNumber && item?.start === candidate?.start &&
        item?.end === candidate?.end && String(item?.quote || '') === String(candidate?.quote || '');
    });
  }

  function declaredRangesWithQuotes(ranges, quotes) {
    if (!Array.isArray(ranges) || !Array.isArray(quotes) || ranges.length !== quotes.length) {
      fail('PDF_FIGURE_SEMANTIC_SENTENCE_TAMPERED');
    }
    const combined = ranges.map((range, index) => ({ ...range, quote: quotes[index]?.quote }));
    if (!sameRanges(combined, quotes)) fail('PDF_FIGURE_SEMANTIC_SENTENCE_TAMPERED');
    return quotes;
  }

  function publicFragments(ranges, pageText, pageCount, errorCode) {
    if (!Array.isArray(ranges) || !ranges.length) fail(errorCode);
    const result = [];
    let previous = null;
    for (const range of ranges) {
      const pageNumber = positiveInteger(range?.pageNumber);
      const text = pageText.get(pageNumber);
      const start = range?.start;
      const end = range?.end;
      if (pageNumber === null || pageNumber > pageCount || typeof text !== 'string' ||
          !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 ||
          end <= start || end > text.length || text.slice(start, end) !== range?.quote ||
          (previous && (pageNumber < previous.pageNumber ||
            (pageNumber === previous.pageNumber && start < previous.end)))) fail(errorCode);
      result.push({ pageNumber, start, end, quote: range.quote });
      previous = range;
    }
    return result;
  }

  function navigationTargets(navigation) {
    const targets = new Map();
    const pending = Array.isArray(navigation?.sections) ? [...navigation.sections] : [];
    while (pending.length) {
      const section = pending.shift();
      pending.push(...(Array.isArray(section?.children) ? section.children : []));
      for (const target of Array.isArray(section?.paragraphTargets)
        ? section.paragraphTargets : []) {
        if (!target?.paragraphId || targets.has(target.paragraphId)) {
          fail('PDF_FIGURE_DOCUMENT_BINDING_CONFLICT');
        }
        targets.set(target.paragraphId, target);
      }
    }
    return targets;
  }

  function figurePages(figure, pageCount) {
    const values = [figure?.pageNumber,
      ...(Array.isArray(figure?.captionPageNumbers)
        ? figure.captionPageNumbers
        : Array.isArray(figure?.pageNumbers) ? figure.pageNumbers : [])];
    const pages = [...new Set(values)];
    if (!pages.length || pages.some(page => positiveInteger(page) === null || page > pageCount)) {
      fail('PDF_FIGURE_PAGE_INVALID');
    }
    return pages.sort((left, right) => left - right);
  }

  function figureVisualCoverage(figure, captionPageNumbers, pageCount) {
    const artworkPageNumbers = [...new Set((Array.isArray(figure?.artworkPageNumbers)
      ? figure.artworkPageNumbers : [figure?.pageNumber])
      .map(positiveInteger).filter(Boolean))];
    if (!artworkPageNumbers.length || artworkPageNumbers.some(page => page > pageCount)) {
      fail('PDF_FIGURE_ARTWORK_PAGES_INVALID');
    }
    const artworkPageEvidence = ['manifest', 'verified-page-regions', 'user-selection']
      .includes(figure?.artworkPageEvidence)
      ? figure.artworkPageEvidence : 'caption-anchor-page';
    return {
      captionPageNumbers: [...captionPageNumbers],
      artworkPageNumbers,
      artworkPageEvidence,
      artworkCoverage: figure?.artworkCoverage !== 'complete' ||
        artworkPageEvidence === 'caption-anchor-page'
        ? 'partial' : 'complete'
    };
  }

  function migrationDigest(value) {
    const digest = String(value || '').trim().toLowerCase();
    return HASH_PATTERN.test(digest) ? digest : '';
  }

  function canMigrateCompletedPdfFigureResult(previous, next) {
    if (!previous || !next || typeof previous !== 'object' || typeof next !== 'object' ||
        !['completed', 'complete'].includes(String(previous.state || previous.status || '').toLowerCase()) ||
        !['completed', 'complete'].includes(String(next.state || next.status || '').toLowerCase()) ||
        next.verified !== true) return false;
    const keys = ['documentHash', 'semanticContextDigest'];
    const baseMatches = keys.every(key => {
      const before = migrationDigest(previous[key]);
      const after = migrationDigest(next[key]);
      return Boolean(before && before === after);
    });
    if (!baseMatches) return false;
    const previousImage = migrationDigest(previous.imageContentHash);
    const nextImage = migrationDigest(next.imageContentHash);
    const previousSet = migrationDigest(previous.visualEvidenceSetDigest);
    const nextSet = migrationDigest(next.visualEvidenceSetDigest);
    return Boolean(previousImage && previousImage === nextImage && !previousSet && !nextSet) ||
      Boolean(previousSet && previousSet === nextSet && !previousImage && !nextImage);
  }

  function createPdfFigureContextProductionAdapter(input = {}) {
    if (typeof shared.selectPdfFigureContext !== 'function' ||
        typeof shared.splitSentenceRanges !== 'function') {
      fail('PDF_FIGURE_PRODUCTION_DEPENDENCY_MISSING');
    }
    const semanticDocument = input.semanticDocument;
    const compatibility = input.compatibility;
    const nativeDocument = input.nativeDocument;
    const figureInventory = input.figureInventory;
    const getCurrentSemanticDocument = typeof input.getCurrentSemanticDocument === 'function'
      ? input.getCurrentSemanticDocument : () => semanticDocument;
    const getCurrentCompatibility = typeof input.getCurrentCompatibility === 'function'
      ? input.getCurrentCompatibility : () => compatibility;
    const getCurrentNativeDocument = typeof input.getCurrentNativeDocument === 'function'
      ? input.getCurrentNativeDocument : () => nativeDocument;
    const getCurrentFigureInventory = typeof input.getCurrentFigureInventory === 'function'
      ? input.getCurrentFigureInventory : () => figureInventory;

    function requireCurrentOwnership() {
      let current;
      try {
        current = [getCurrentSemanticDocument(), getCurrentCompatibility(),
          getCurrentNativeDocument(), getCurrentFigureInventory()];
      } catch (_) {
        fail('PDF_FIGURE_CONTEXT_STALE');
      }
      if (current[0] !== semanticDocument || current[1] !== compatibility ||
          current[2] !== nativeDocument || current[3] !== figureInventory) {
        fail('PDF_FIGURE_CONTEXT_STALE');
      }
    }

    function validatedSnapshot() {
      const index = semanticDocument?.index;
      const structure = nativeDocument?.structure;
      const documentHash = canonicalHash(semanticDocument?.documentHash);
      const documentGeneration = positiveInteger(semanticDocument?.documentGeneration);
      const semanticRevision = positiveInteger(semanticDocument?.revision);
      const pageCount = positiveInteger(semanticDocument?.pageCount);
      const compatible = documentHash && documentGeneration && semanticRevision && pageCount &&
        index && structure && canonicalHash(index?.document?.documentHash) === documentHash &&
        index?.document?.revision === semanticRevision && index?.document?.pageCount === pageCount &&
        canonicalHash(structure?.documentHash) === documentHash &&
        nativeDocument?.documentGeneration === documentGeneration &&
        nativeDocument?.pageCount === pageCount &&
        canonicalHash(compatibility?.documentHash) === documentHash &&
        compatibility?.documentGeneration === documentGeneration &&
        compatibility?.revision === semanticRevision &&
        typeof compatibility?.resolvePdfSemanticRange === 'function' &&
        Array.isArray(index?.paragraphs) && Array.isArray(index?.sentences) &&
        Array.isArray(index?.mappings) && compatibility?.semanticNavigation;
      if (!compatible) fail('PDF_FIGURE_DOCUMENT_BINDING_CONFLICT');
      const pageText = new Map();
      for (const mapping of index.mappings) {
        if (positiveInteger(mapping?.pageNumber) === null || mapping.pageNumber > pageCount ||
            typeof mapping?.rawText !== 'string' || pageText.has(mapping.pageNumber)) {
          fail('PDF_FIGURE_DOCUMENT_BINDING_CONFLICT');
        }
        pageText.set(mapping.pageNumber, mapping.rawText);
      }
      if (pageText.size !== pageCount) fail('PDF_FIGURE_DOCUMENT_BINDING_CONFLICT');
      return { index, documentHash, documentGeneration, semanticRevision, pageCount,
        pageText, targets: navigationTargets(compatibility.semanticNavigation) };
    }

    function resolveVerified(snapshot, paragraph, target, start, end, quote, expected) {
      const resolved = compatibility.resolvePdfSemanticRange(
        paragraph.paragraphId, target.normalizedStart + start,
        target.normalizedStart + end, quote
      );
      if (resolved?.status !== 'resolved' || resolved?.verified !== true ||
          resolved?.paragraphId !== paragraph.paragraphId ||
          resolved?.normalizedRange?.start !== target.normalizedStart + start ||
          resolved?.normalizedRange?.end !== target.normalizedStart + end ||
          resolved?.normalizedQuote !== quote) fail('PDF_FIGURE_SEMANTIC_RANGE_UNVERIFIED');
      const fragments = publicFragments(
        resolved.ranges, snapshot.pageText, snapshot.pageCount,
        'PDF_FIGURE_SEMANTIC_RANGE_UNVERIFIED'
      );
      const declared = publicFragments(
        expected, snapshot.pageText, snapshot.pageCount,
        'PDF_FIGURE_SEMANTIC_SENTENCE_TAMPERED'
      );
      const contains = (outer, inner) => outer.pageNumber === inner.pageNumber &&
        outer.start <= inner.start && outer.end >= inner.end;
      if (fragments.some(fragment => !declared.some(item => contains(item, fragment))) ||
          declared.some(item => !fragments.some(fragment => contains(item, fragment)))) {
        fail('PDF_FIGURE_SEMANTIC_SENTENCE_TAMPERED');
      }
      return fragments;
    }

    function mainFigureReferenceMatches(value, figure) {
      const label = normalizedText(figure?.figureLabel || figure?.label);
      const parsed = label.match(/^(?:fig(?:ure)?s?\.?\s*)?(S?\d+)$/iu);
      if (!parsed) return normalizedText(value).includes(label);
      const pattern = new RegExp(`\\bfig(?:ure)?s?\\.?\\s*${parsed[1]}(?![\\p{L}\\d])`, 'giu');
      for (const match of String(value || '').matchAll(pattern)) {
        const prefix = String(value || '').slice(Math.max(0, match.index - 28), match.index);
        const suffix = String(value || '').slice(match.index + match[0].length,
          match.index + match[0].length + 28);
        if (/\b(?:supplementary|supp\.?|extended\s+data)\s*$/iu.test(prefix) ||
            /^\s*[—-]\s*(?:figure\s+supplement|video)\b/iu.test(suffix)) continue;
        return true;
      }
      return false;
    }

    function adaptRecords(snapshot, figure) {
      const sentenceById = new Map();
      for (const sentence of snapshot.index.sentences) {
        if (typeof sentence?.sentenceId !== 'string' || !sentence.sentenceId ||
            sentenceById.has(sentence.sentenceId)) fail('PDF_FIGURE_SEMANTIC_SENTENCE_TAMPERED');
        sentenceById.set(sentence.sentenceId, sentence);
      }
      const records = [];
      const omissions = [];
      for (let paragraphIndex = 0;
        paragraphIndex < snapshot.index.paragraphs.length; paragraphIndex += 1) {
        const paragraph = snapshot.index.paragraphs[paragraphIndex];
        try {
        const text = paragraph?.normalizedText;
        const target = snapshot.targets.get(paragraph?.paragraphId);
        const boundaries = typeof text === 'string' ? shared.splitSentenceRanges(text) : [];
        if (!target || target.expectedNormalizedQuote !== text ||
            target.normalizedEnd - target.normalizedStart !== text.length ||
            !Array.isArray(paragraph?.sentenceIds) || boundaries.length !== paragraph.sentenceIds.length) {
          fail('PDF_FIGURE_SEMANTIC_SENTENCE_TAMPERED');
        }
        const paragraphDeclared = declaredRangesWithQuotes(
          paragraph.ranges, paragraph.rawQuoteByPage);
        const paragraphFragments = resolveVerified(snapshot, paragraph, target, 0, text.length,
          text, paragraphDeclared);
        const semanticSentences = boundaries.map((boundary, sentenceIndex) => {
          const sentence = sentenceById.get(paragraph.sentenceIds[sentenceIndex]);
          const quote = text.slice(boundary.start, boundary.end);
          if (!sentence || sentence.paragraphId !== paragraph.paragraphId ||
              sentence.normalizedText !== quote) fail('PDF_FIGURE_SEMANTIC_SENTENCE_TAMPERED');
          const declared = declaredRangesWithQuotes(sentence.ranges, sentence.rawQuoteByPage);
          const fragments = resolveVerified(snapshot, paragraph, target, boundary.start,
            boundary.end, quote, declared);
          return {
            sentenceId: sentence.sentenceId,
            normalizedStart: boundary.start,
            normalizedEnd: boundary.end,
            normalizedText: quote,
            pageNumber: fragments[0].pageNumber,
            pageNumbers: [...new Set(fragments.map(fragment => fragment.pageNumber))],
            sourceFragments: fragments,
            rawQuoteByPage: fragments
          };
        });
        records.push({
          recordId: paragraph.paragraphId,
          sourceKey: paragraph.paragraphId,
          paragraphId: paragraph.paragraphId,
          paragraphIndex,
          recordType: 'semantic-paragraph',
          documentHash: snapshot.documentHash,
          documentGeneration: snapshot.documentGeneration,
          semanticRevision: snapshot.semanticRevision,
          normalizedText: text,
          pageNumber: paragraphFragments[0].pageNumber,
          pageNumbers: [...new Set(paragraphFragments.map(fragment => fragment.pageNumber))],
          sourceFragments: paragraphFragments,
          rawQuoteByPage: paragraphFragments,
          semanticSentences
        });
        } catch (error) {
          if (mainFigureReferenceMatches(paragraph?.normalizedText, figure)) throw error;
          omissions.push({
            paragraphId: String(paragraph?.paragraphId || ''),
            code: String(error?.code || 'PDF_FIGURE_SEMANTIC_RANGE_UNVERIFIED')
          });
        }
      }
      return { records, omissions };
    }

    function resolvedRecordSlice(snapshot, record, start, end, errorCode) {
      const target = snapshot.targets.get(record.paragraphId);
      const quote = record.normalizedText.slice(start, end);
      if (!target || !quote) fail(errorCode);
      const resolved = compatibility.resolvePdfSemanticRange(
        record.paragraphId,
        target.normalizedStart + start,
        target.normalizedStart + end,
        quote
      );
      if (resolved?.status !== 'resolved' || resolved?.verified !== true ||
          resolved?.paragraphId !== record.paragraphId ||
          resolved?.normalizedRange?.start !== target.normalizedStart + start ||
          resolved?.normalizedRange?.end !== target.normalizedStart + end ||
          resolved?.normalizedQuote !== quote) fail(errorCode);
      return publicFragments(resolved.ranges, snapshot.pageText, snapshot.pageCount, errorCode);
    }

    function sentenceSlice(snapshot, record, sentence, start, end, offset = start) {
      const fragments = start === sentence.normalizedStart && end === sentence.normalizedEnd
        ? sentence.sourceFragments
        : resolvedRecordSlice(snapshot, record, start, end,
          'PDF_FIGURE_SEMANTIC_RANGE_UNVERIFIED');
      return {
        sentenceId: start === sentence.normalizedStart && end === sentence.normalizedEnd
          ? sentence.sentenceId : `${sentence.sentenceId}:slice:${start}-${end}`,
        normalizedStart: offset,
        normalizedEnd: offset + end - start,
        normalizedText: record.normalizedText.slice(start, end),
        pageNumber: fragments[0].pageNumber,
        pageNumbers: [...new Set(fragments.map(fragment => fragment.pageNumber))],
        sourceFragments: fragments,
        rawQuoteByPage: fragments
      };
    }

    function captionTokens(value) {
      return new Set(normalizedText(value).toLowerCase()
        .match(/[\p{L}\p{N}]{3,}/gu) || []);
    }

    function captionRecord(records, figure, snapshot) {
      const caption = normalizedText(figure.caption);
      if (!caption) fail('PDF_FIGURE_CAPTION_BINDING_UNAVAILABLE');
      const figurePageSet = new Set(figurePages(figure, snapshot.pageCount));
      let searchable = '';
      const placements = [];
      for (const record of records) {
        if (searchable) searchable += ' ';
        const start = searchable.length;
        searchable += record.normalizedText;
        placements.push({ record, start, end: searchable.length });
      }
      // PDF.js can emit punctuation as separate text items. The caption
      // directory joins "( b)" while the canonical index retains "( b )".
      // Match the complete caption's characters, then use the original index
      // offsets and text for every locator; never approximate the quote.
      const offsets = [];
      let compact = '';
      for (let index = 0; index < searchable.length; index += 1) {
        if (/\s/u.test(searchable[index])) continue;
        compact += searchable[index];
        offsets.push(index);
      }
      const captionSegments = Array.isArray(figure.captionSegments)
        ? figure.captionSegments : null;
      if (captionSegments && (!captionSegments.length ||
          captionSegments.length > figurePageSet.size ||
          captionSegments.some((part, index) => !figurePageSet.has(part?.pageNumber) ||
            !normalizedText(part?.text) || (index > 0 &&
              part.pageNumber <= captionSegments[index - 1].pageNumber)) ||
          normalizedText(captionSegments.map(part => part.text).join(' ')) !== caption)) {
        fail('PDF_FIGURE_CAPTION_BINDING_UNAVAILABLE');
      }
      const parts = captionSegments || [{ text: caption }];
      const matchedParts = [];
      for (const part of parts) {
        const matches = [];
        const needle = normalizedText(part.text).replace(/\s/gu, '');
        let compactCursor = 0;
        while (needle && compactCursor <= compact.length - needle.length) {
          const found = compact.indexOf(needle, compactCursor);
          if (found < 0) break;
          const start = offsets[found];
          const end = offsets[found + needle.length - 1] + 1;
          const touched = placements.filter(item => item.start < end && item.end > start);
          if (touched.length && touched.every(item =>
            item.record.pageNumbers.some(page => part.pageNumber
              ? page === part.pageNumber : figurePageSet.has(page)))) {
            matches.push({ start, end, touched });
          }
          compactCursor = found + 1;
        }
        if (matches.length !== 1) {
          if (captionSegments) fail('PDF_FIGURE_CAPTION_BINDING_UNAVAILABLE');
          break;
        }
        matchedParts.push({ ...matches[0], pageNumber: part.pageNumber || null });
      }
      if (matchedParts.some((part, index) => index > 0 &&
          part.start < matchedParts[index - 1].end)) {
        fail('PDF_FIGURE_CAPTION_BINDING_UNAVAILABLE');
      }
      const intervals = new Map();
      const omissions = [];
      let sentences = [];
      let sourceParagraphIds = [];
      let captionText = caption;
      if (matchedParts.length === parts.length) {
        captionText = '';
        for (const match of matchedParts) {
        if (captionText) captionText += ' ';
        const captionOffset = captionText.length;
        captionText += searchable.slice(match.start, match.end);
        sourceParagraphIds.push(...match.touched.map(item => item.record.paragraphId));
        for (const item of match.touched) {
          const localStart = Math.max(0, match.start - item.start);
          const localEnd = Math.min(item.record.normalizedText.length, match.end - item.start);
          intervals.set(item.record.recordId, [...(intervals.get(item.record.recordId) || []),
            { start: localStart, end: localEnd }]);
          for (const sentence of item.record.semanticSentences) {
            const start = Math.max(sentence.normalizedStart, localStart);
            const end = Math.min(sentence.normalizedEnd, localEnd);
            if (end <= start) continue;
            const slice = sentenceSlice(snapshot, item.record, sentence, start, end,
              captionOffset + item.start + start - match.start);
            if (match.pageNumber && slice.sourceFragments.some(fragment =>
              fragment.pageNumber !== match.pageNumber)) {
              fail('PDF_FIGURE_CAPTION_BINDING_UNAVAILABLE');
            }
            sentences.push(slice);
          }
        }
        }
        sourceParagraphIds = [...new Set(sourceParagraphIds)];
      } else {
        const expectedTokens = captionTokens(caption);
        const candidates = records.flatMap(record => record.semanticSentences
          .filter(sentence => sentence.pageNumbers.some(page => figurePageSet.has(page)) &&
            mainFigureReferenceMatches(sentence.normalizedText, figure))
          .map(sentence => {
            const tokens = captionTokens(sentence.normalizedText);
            const overlap = [...tokens].filter(token => expectedTokens.has(token)).length;
            return { record, sentence, overlap,
              density: tokens.size ? overlap / tokens.size : 0 };
          }))
          .filter(candidate => candidate.overlap >= 3 && candidate.density >= 0.45)
          .sort((left, right) => right.overlap - left.overlap ||
            right.density - left.density ||
            left.record.paragraphIndex - right.record.paragraphIndex ||
            left.sentence.normalizedStart - right.sentence.normalizedStart);
        const selected = candidates[0];
        const tied = selected && candidates[1] &&
          selected.overlap === candidates[1].overlap &&
          selected.density === candidates[1].density;
        if (!selected || tied) fail('PDF_FIGURE_CAPTION_BINDING_UNAVAILABLE');
        captionText = selected.sentence.normalizedText;
        sentences = [sentenceSlice(snapshot, selected.record, selected.sentence,
          selected.sentence.normalizedStart, selected.sentence.normalizedEnd, 0)];
        sourceParagraphIds = [selected.record.paragraphId];
        intervals.set(selected.record.recordId, [{
          start: selected.sentence.normalizedStart,
          end: selected.sentence.normalizedEnd
        }]);
        omissions.push({ paragraphId: selected.record.paragraphId,
          code: 'PDF_FIGURE_CAPTION_LAYOUT_FRAGMENTED' });
      }
      if (!sentences.length) fail('PDF_FIGURE_CAPTION_BINDING_UNAVAILABLE');
      const fragments = sentences.flatMap(sentence => sentence.sourceFragments);
      if (fragments.some(fragment => !figurePageSet.has(fragment.pageNumber))) {
        fail('PDF_FIGURE_CAPTION_BINDING_UNAVAILABLE');
      }
      return {
        record: {
          recordId: `${sourceParagraphIds[0]}:figure-caption:${figure.figureId}`,
          sourceKey: sourceParagraphIds[0],
          paragraphId: sourceParagraphIds[0],
          paragraphIds: sourceParagraphIds,
          paragraphIndex: Math.min(...sourceParagraphIds.map(paragraphId =>
            records.find(record => record.paragraphId === paragraphId)?.paragraphIndex ??
              Number.MAX_SAFE_INTEGER)),
          recordType: 'figure-caption',
          figureId: figure.figureId,
          documentHash: snapshot.documentHash,
          documentGeneration: snapshot.documentGeneration,
          semanticRevision: snapshot.semanticRevision,
          normalizedText: captionText,
          pageNumber: fragments[0].pageNumber,
          pageNumbers: [...new Set(fragments.map(fragment => fragment.pageNumber))],
          sourceFragments: fragments,
          rawQuoteByPage: fragments,
          semanticSentences: sentences
        },
        intervals,
        omissions
      };
    }

    function bodyRecordsAfterCaption(records, caption, snapshot) {
      return records.map(record => {
        const intervals = caption.intervals.get(record.recordId) || [];
        if (!intervals.length) return record;
        const semanticSentences = [];
        for (const sentence of record.semanticSentences) {
          let ranges = [{ start: sentence.normalizedStart, end: sentence.normalizedEnd }];
          for (const removed of intervals) {
            ranges = ranges.flatMap(range => {
              if (removed.end <= range.start || removed.start >= range.end) return [range];
              return [
                ...(removed.start > range.start
                  ? [{ start: range.start, end: removed.start }] : []),
                ...(removed.end < range.end
                  ? [{ start: removed.end, end: range.end }] : [])
              ];
            });
          }
          for (const range of ranges) {
            let start = range.start;
            let end = range.end;
            while (start < end && /\s/u.test(record.normalizedText[start])) start += 1;
            while (end > start && /\s/u.test(record.normalizedText[end - 1])) end -= 1;
            if (end > start) {
              semanticSentences.push(sentenceSlice(
                snapshot, record, sentence, start, end, start));
            }
          }
        }
        return semanticSentences.length ? { ...record, semanticSentences } : null;
      }).filter(Boolean);
    }

    function bindSelectedEvidence(context, records, snapshot) {
      const byId = new Map(records.map(record => [record.recordId, record]));
      const previousIssues = new Set();
      const bind = evidence => {
        const location = evidence.location;
        const record = byId.get(location?.recordId);
        const matches = (record?.semanticSentences || []).filter(sentence =>
          sentence.sentenceId === location.sentenceId &&
          sentence.normalizedStart === location.normalizedStart &&
          sentence.normalizedEnd === location.normalizedEnd &&
          sentence.normalizedText === evidence.text &&
          evidence.text === location.expectedNormalizedQuote);
        if (matches.length !== 1 || location.paragraphId !== record.paragraphId) {
          fail('PDF_FIGURE_EVIDENCE_UNVERIFIED');
        }
        // These producer sentences already passed the current semantic resolver.
        // Rebind every selected raw fragment exactly; the generic selector's
        // whitespace comparison cannot reconstruct a removed line-end hyphen.
        const fragments = publicFragments(matches[0].sourceFragments,
          snapshot.pageText, snapshot.pageCount, 'PDF_FIGURE_EVIDENCE_UNVERIFIED');
        const selectedFragments = location.sourceFragments;
        if (!Array.isArray(selectedFragments) || selectedFragments.length !== fragments.length ||
            fragments.some((fragment, index) =>
              ['pageNumber', 'start', 'end'].some(key =>
                fragment[key] !== selectedFragments[index]?.[key]))) {
          fail('PDF_FIGURE_EVIDENCE_UNVERIFIED');
        }
        const exact = fragments.length === 1 && fragments[0].quote === evidence.text &&
          fragments[0].end - fragments[0].start === evidence.text.length;
        for (const issue of location.locatorIssues || []) previousIssues.add(issue);
        return { ...evidence, location: { ...location,
          locatorStatus: 'resolved', locatorIssues: [],
          locatorPrecision: exact ? 'exact-raw' : fragments.length > 1
            ? 'discontinuous' : 'normalized-equivalent',
          sourceStart: exact ? fragments[0].start : null,
          sourceEnd: exact ? fragments[0].end : null,
          pageStart: exact ? fragments[0].start : null,
          pageEnd: exact ? fragments[0].end : null,
          documentStart: null, documentEnd: null
        } };
      };
      const captions = context.captionEvidence.map(bind);
      const body = context.bodyEvidence.map(bind);
      return { ...context, captionEvidence: captions, bodyEvidence: body,
        textualEvidence: { ...context.textualEvidence, captions, body },
        coverage: { ...context.coverage,
          omissions: context.coverage.omissions.filter(issue => !previousIssues.has(issue)),
          missingReasons: context.coverage.missingReasons.filter(issue => !previousIssues.has(issue))
        } };
    }

    async function selectFigureContext(request = {}) {
      requireCurrentOwnership();
      const snapshot = validatedSnapshot();
      if (!Array.isArray(figureInventory)) fail('PDF_FIGURE_ID_INVALID');
      const selected = figureInventory.filter(figure => figure?.figureId === request.figureId);
      if (selected.length !== 1 ||
          !/^[a-z0-9][a-z0-9._-]{0,127}$/iu.test(String(request.figureId || ''))) {
        fail('PDF_FIGURE_ID_INVALID');
      }
      const figure = selected[0];
      if (figure.captionComplete === false || (Array.isArray(figure.reviewReasons) &&
          figure.reviewReasons.some(reason =>
            ['missing-caption-continuation', 'caption-truncated'].includes(reason)))) {
        fail('PDF_FIGURE_CAPTION_INCOMPLETE');
      }
      const pages = figurePages(figure, snapshot.pageCount);
      const visualCoverage = figureVisualCoverage(figure, pages, snapshot.pageCount);
      if (canonicalHash(figure.sourceFingerprint) !== snapshot.documentHash) {
        fail('PDF_FIGURE_SOURCE_BINDING_CONFLICT');
      }
      const adapted = adaptRecords(snapshot, figure);
      const records = adapted.records;
      const caption = captionRecord(records, figure, snapshot);
      const bodyRecords = bodyRecordsAfterCaption(records, caption, snapshot);
      const binding = {
        documentHash: snapshot.documentHash,
        documentGeneration: snapshot.documentGeneration,
        semanticRevision: snapshot.semanticRevision
      };
      const selectedContext = shared.selectPdfFigureContext({
        ...binding,
        expectedBinding: binding,
        target: {
          ...binding,
          figureId: figure.figureId,
          label: normalizedText(figure.figureLabel || figure.label),
          pageNumber: figure.pageNumber,
          pageNumbers: pages,
          captionPageNumbers: visualCoverage.captionPageNumbers,
          artworkPageNumbers: visualCoverage.artworkPageNumbers,
          artworkPageEvidence: visualCoverage.artworkPageEvidence,
          artworkCoverage: visualCoverage.artworkCoverage,
          captionHint: normalizedText(figure.caption)
        },
        records: [caption.record, ...bodyRecords],
        route: request.route,
        visualEvidence: request.visualEvidence,
        visualEvidenceSet: request.visualEvidenceSet,
        sourceCoverage: {
          pageCount: snapshot.pageCount,
          indexedPageNumbers: [...snapshot.pageText.keys()].sort((left, right) => left - right),
          missingPageNumbers: [],
          failedPageNumbers: []
        }
      }, request.options || {});
      const context = bindSelectedEvidence(selectedContext,
        [caption.record, ...bodyRecords], snapshot);
      if (!context.binding.valid) fail('PDF_FIGURE_DOCUMENT_BINDING_CONFLICT');
      if (request.requireCaptionAndBody !== false &&
          (!context.captionEvidence.length || !context.bodyEvidence.length)) {
        fail('PDF_FIGURE_CONTEXT_INCOMPLETE');
      }
      const target = { figureId: figure.figureId,
        figureLabel: normalizedText(figure.figureLabel || figure.label),
        pageNumber: figure.pageNumber, pageNumbers: pages };
      const semanticContextDigest = await sha256Text(stableJson({
        binding, target, textualEvidence: context.textualEvidence
      }));
      requireCurrentOwnership();
      return deepFreeze({ version: VERSION, binding, target,
        visualCoverage,
        records: [caption.record, ...bodyRecords],
        sourceCoverage: context.coverage, context, semanticContextDigest,
        omissions: [...adapted.omissions, ...caption.omissions] });
    }

    return Object.freeze({ selectFigureContext });
  }

  return { PDF_FIGURE_CONTEXT_PRODUCTION_VERSION: VERSION,
    createPdfFigureContextProductionAdapter, canMigrateCompletedPdfFigureResult };
});
