(function attach(root, factory) {
  const dependency = typeof module === 'object' && module.exports
    ? { ...require('./pdf-heading-extractor.js'), ...require('./pdf-text-projection.js') } : root.SciLLM;
  const api = factory(dependency);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(dependency = {}) {
  const SCHEMA_VERSION = 3;
  const PDF_SEMANTIC_INDEX_ALGORITHM_VERSION = 8;
  function pdfWrapFragment(text, includeDigits = false) {
    const value = String(text);
    if (!value.endsWith('-')) return '';
    const end = value.length - 1;
    let start = end;
    const allowed = includeDigits ? /^[\p{L}\p{M}\d]$/u : /^[\p{L}\p{M}]$/u;
    while (start > 0) {
      const low = value.charCodeAt(start - 1);
      const high = start > 1 ? value.charCodeAt(start - 2) : 0;
      const width = low >= 0xDC00 && low <= 0xDFFF && high >= 0xD800 && high <= 0xDBFF ? 2 : 1;
      if (!allowed.test(value.slice(start - width, start))) break;
      start -= width;
    }
    return value.slice(start, end);
  }
  const isPdfCompoundWrapPrefix = text => {
    const fragment = pdfWrapFragment(text, true);
    return /\p{L}/u.test(fragment) && ((/^[\p{Lu}\d]+$/u.test(fragment) &&
      (fragment.match(/\p{Lu}/gu) || []).length >= 2) || /\d/u.test(fragment) ||
      /^(?:non|anti|pre|post|multi)$/iu.test(fragment));
  };
  const joinsBrokenWord = text => {
    const fragment = pdfWrapFragment(text);
    return Boolean(fragment) && !isPdfCompoundWrapPrefix(text);
  };
  const canonicalHash = value => String(value || '').trim().toLowerCase()
    .replace(/^sha256:/u, '');

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const nested of Object.values(value)) {
      if (nested && typeof nested === 'object') deepFreeze(nested);
    }
    return Object.freeze(value);
  }

  function fnv64(value) {
    let hash = 0xcbf29ce484222325n;
    for (const byte of new TextEncoder().encode(String(value))) {
      hash ^= BigInt(byte);
      hash = BigInt.asUintN(64, hash * 0x100000001b3n);
    }
    return hash.toString(16).padStart(16, '0');
  }

  function normalizePdfTextWithOffsets(value) {
    const rawText = String(value || '');
    const output = [];
    const rawToNormalized = new Array(rawText.length + 1).fill(null);
    const normalizedToRawStart = [];
    const normalizedToRawEnd = [];
    let pendingWhitespace = null;
    const emit = (text, rawStart, rawEnd) => {
      const normalizedStart = output.length;
      for (let offset = 0; offset < text.length; offset += 1) {
        output.push(text[offset]);
        normalizedToRawStart.push(rawStart);
        normalizedToRawEnd.push(rawEnd);
      }
      if (rawToNormalized[rawStart] === null) rawToNormalized[rawStart] = normalizedStart;
      for (let boundary = rawStart + 1; boundary < rawEnd; boundary += 1) {
        rawToNormalized[boundary] = normalizedStart;
      }
      rawToNormalized[rawEnd] = output.length;
    };
    const segments = typeof dependency.segmentPdfGraphemes === 'function'
      ? dependency.segmentPdfGraphemes(rawText)
      : (() => { const items = []; let index = 0; for (const segment of rawText) {
        items.push({ segment, index }); index += segment.length; } return items; })();
    rawToNormalized[0] = 0;
    for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
      const entry = segments[segmentIndex];
      const index = entry.index;
      const end = index + entry.segment.length;
      const dehyphenation = entry.segment === '-' && !pendingWhitespace && joinsBrokenWord(`${output.join('')}-`) &&
        /\p{L}\p{M}*$/u.test(output.join('')) &&
        rawText.slice(end).match(/^(?:\r\n|\r|\n)(?=\p{Ll})/u);
      if (dehyphenation) {
        const removedEnd = end + dehyphenation[0].length;
        for (let cursor = index; cursor <= removedEnd; cursor += 1) {
          rawToNormalized[cursor] = output.length;
        }
        while (segments[segmentIndex + 1] &&
          segments[segmentIndex + 1].index < removedEnd) segmentIndex += 1;
        pendingWhitespace = null;
        continue;
      }
      if (/^\s+$/u.test(entry.segment)) {
        if (/[\r\n]/u.test(entry.segment) && output.at(-1) === '-' && isPdfCompoundWrapPrefix(output.join('')) &&
            /^[\p{L}\d]/u.test(rawText.slice(end))) {
          for (let cursor = index; cursor <= end; cursor += 1) rawToNormalized[cursor] = output.length;
          continue;
        }
        pendingWhitespace ||= { start: index, end };
        pendingWhitespace.end = end;
        continue;
      }
      if (pendingWhitespace) {
        if (output.length) emit(' ', pendingWhitespace.start, pendingWhitespace.end);
        else for (let cursor = pendingWhitespace.start; cursor <= pendingWhitespace.end; cursor += 1) {
          rawToNormalized[cursor] = 0;
        }
      }
      pendingWhitespace = null;
      emit(entry.segment.normalize('NFKC'), index, end);
    }
    if (pendingWhitespace) {
      for (let cursor = pendingWhitespace.start;
        cursor <= pendingWhitespace.end; cursor += 1) {
        rawToNormalized[cursor] = output.length;
      }
    }
    for (let cursor = 0; cursor < rawToNormalized.length; cursor += 1) {
      if (rawToNormalized[cursor] === null) {
        rawToNormalized[cursor] = cursor ? rawToNormalized[cursor - 1] : 0;
      }
    }
    return { rawText, normalizedText: output.join(''), rawToNormalized,
      normalizedToRawStart, normalizedToRawEnd };
  }

  function rawRangeToNormalized(projection, start, end) {
    const length = projection?.rawText?.length || 0;
    const from = Math.max(0, Math.min(length, Math.floor(Number(start) || 0)));
    const to = Math.max(from, Math.min(length, Math.floor(Number(end) || 0)));
    return { start: projection.rawToNormalized[from], end: projection.rawToNormalized[to] };
  }

  function normalizedRangeToRaw(projection, start, end) {
    const length = projection?.normalizedText?.length || 0;
    const from = Math.max(0, Math.min(length, Math.floor(Number(start) || 0)));
    const to = Math.max(from, Math.min(length, Math.floor(Number(end) || 0)));
    if (from === to) {
      const boundary = from === length ? projection.rawText.length
        : projection.normalizedToRawStart[from] || 0;
      return { start: boundary, end: boundary };
    }
    return { start: projection.normalizedToRawStart[from],
      end: projection.normalizedToRawEnd[to - 1] };
  }

  function pdfSemanticCacheKey(input = {}) {
    const documentHash = canonicalHash(input.documentHash);
    const revision = String(input.revision ?? '0');
    const pages = (Array.isArray(input.pages) ? input.pages : []).map(page => ({
      pageNumber: Math.max(1, Math.floor(Number(page.pageNumber) || 1)),
      text: String(page.text || ''), pageWidth: Number(page.pageWidth) || null,
      pageHeight: Number(page.pageHeight) || null, view: page.view || null,
      rotate: Number(page.rotate) || 0,
      spans: (Array.isArray(page.spans) ? page.spans : []).map(span => ({
        text: String(span?.text || ''), start: Number(span?.start), end: Number(span?.end),
        fontSize: Number(span?.fontSize) || null, fontName: String(span?.fontName || ''),
        bold: span?.bold === true, rect: span?.rect ? {
          left: Number(span.rect.left), top: Number(span.rect.top),
          right: Number(span.rect.right), bottom: Number(span.rect.bottom)
        } : null,
        quadPoints: Array.isArray(span?.quadPoints) ? span.quadPoints.map(Number) : null
      }))
    })).sort((left, right) => left.pageNumber - right.pageNumber);
    const outline = (Array.isArray(input.outline) ? input.outline : []).map(item => ({
      title: String(item?.title || '').normalize('NFKC').replace(/\s+/gu, ' ').trim(),
      outlinePath: Array.isArray(item?.outlinePath) ? item.outlinePath : null,
      destinationKind: String(item?.destinationKind || ''),
      targetLeft: typeof item?.targetLeft === 'number' && Number.isFinite(item.targetLeft)
        ? item.targetLeft : null,
      pageNumber: Number(item?.pageNumber) || null,
      level: Number(item?.level) || null, targetTop: Number.isFinite(Number(item?.targetTop))
        && item?.targetTop !== null && item?.targetTop !== undefined ? Number(item.targetTop) : null
    }));
    return `pdf-semantic-v${SCHEMA_VERSION}:${documentHash}:${revision}:${fnv64(JSON.stringify({
      textProjectionRevision: PDF_SEMANTIC_INDEX_ALGORITHM_VERSION, pages, outline
    }))}`;
  }

  function pdfSemanticProvenanceKey(input = {}) {
    const documentHash = canonicalHash(input?.document?.documentHash || input.documentHash);
    const revision = Number(input?.document?.revision ?? input.revision) || 0;
    const mappings = (Array.isArray(input.mappings) ? input.mappings : []).map(mapping => ({
      pageNumber: Number(mapping?.pageNumber) || 0,
      rawText: String(mapping?.rawText || '')
    }));
    const paragraphs = (Array.isArray(input.paragraphs) ? input.paragraphs : []).map(paragraph => ({
      paragraphId: String(paragraph?.paragraphId || ''),
      order: Number(paragraph?.order) || 0,
      sectionId: paragraph?.sectionId === null ? null : String(paragraph?.sectionId || ''),
      ...(input.algorithmVersion>=8?{referenceEntry:paragraph?.referenceEntry===true,
        referenceEntryNumber:paragraph?.referenceEntryNumber??null}:{}),
      normalizedText: String(paragraph?.normalizedText || ''),
      ranges: (Array.isArray(paragraph?.ranges) ? paragraph.ranges : []).map(range => ({
        pageNumber: Number(range?.pageNumber) || 0,
        start: Number(range?.start), end: Number(range?.end)
      })),
      rawQuoteByPage: (Array.isArray(paragraph?.rawQuoteByPage)
        ? paragraph.rawQuoteByPage : []).map(range => ({
        pageNumber: Number(range?.pageNumber) || 0,
        start: Number(range?.start), end: Number(range?.end), quote: String(range?.quote || '')
      })),
      positionRuns: (Array.isArray(paragraph?.positionRuns) ? paragraph.positionRuns : [])
        .map(run => ({
          normalizedStart: Number(run?.normalizedStart),
          normalizedEnd: Number(run?.normalizedEnd),
          pageNumber: run?.pageNumber === null ? null : Number(run?.pageNumber),
          rawStart: run?.rawStart === null ? null : Number(run?.rawStart),
          rawEnd: run?.rawEnd === null ? null : Number(run?.rawEnd),
          kind: String(run?.kind || '')
        }))
    }));
    const sections = (Array.isArray(input.sections) ? input.sections : []).map((section, order) => ({
      sectionId: section?.sectionId,
      level: section?.level,
      source: section?.source,
      headingId: section?.headingId,
      parentSectionId: section?.parentSectionId,
      childSectionIds: Array.isArray(section?.childSectionIds)
        ? [...section.childSectionIds] : section?.childSectionIds,
      paragraphIds: Array.isArray(section?.paragraphIds)
        ? [...section.paragraphIds] : section?.paragraphIds,
      order
    }));
    const payload = { cacheKey: String(input.cacheKey || ''), mappings, paragraphs, sections,
      algorithmVersion: input.algorithmVersion,
      headings: input.headings || [], outlineEntries: input.headingDiagnostics?.outlineEntries || [] };
    if (input.algorithmVersion >= 6) payload.layoutDiagnostics = input.layoutDiagnostics || null;
    if (input.algorithmVersion >= 7) {
      payload.sourceGeometry=input.sourceGeometry || [];
      payload.projectedGeometry = (input.spans || []).map(span => ({
        paragraphId: span.paragraphId, pageNumber: span.pageNumber,
        start: span.start, end: span.end, rawText: span.rawText, geometry: span.geometry
      }));
    }
    return `pdf-semantic-provenance-v1:${documentHash}:${revision}:${fnv64(JSON.stringify(payload))}`;
  }

  function pdfSemanticParagraphId(documentHash, revision, ranges) {
    return `pdf-paragraph:${fnv64(`${canonicalHash(documentHash)}:${revision}:${JSON.stringify(ranges)}`)}`;
  }

  function periodIsProtected(text, index, sentenceStart) {
    const previous = text[index - 1] || '';
    const next = text[index + 1] || '';
    if (/[\p{L}\d]/u.test(previous) && /[\p{L}\d]/u.test(next)) return true;
    const context = text.slice(Math.max(sentenceStart, index - 24), index + 1);
    if (/(?:\b(?:Dr|Mr|Mrs|Ms|Prof|Fig|Figs|Eq|Eqs|Ref|Refs|vs)|\b(?:e\.g|i\.e|et\s+al))\.$/iu
      .test(context)) return true;
    if (/\b(?:U\.S|U\.K)\.$/u.test(context)) {
      const following = text.slice(index + 1).match(/^\s*([^\s])/u)?.[1] || '';
      return !following || /^[\p{Ll}\d,;:)]/u.test(following);
    }
    if (/\bNos?\.$/iu.test(context) && /^\s*\d/u.test(text.slice(index + 1))) return true;
    return false;
  }

  function splitSentenceRanges(text) {
    const ranges = [];
    let start = 0;
    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      if (!/[.!?。！？]/u.test(character)) continue;
      if (character === '.' && periodIsProtected(text, index, start)) continue;
      let end = index + 1;
      while (/[)\]}'”’」』]/u.test(text[end] || '')) end += 1;
      const normalizedStart = text.slice(start, end).search(/\S/u);
      const actualStart = normalizedStart < 0 ? end : start + normalizedStart;
      if (end > actualStart) ranges.push({ start: actualStart, end });
      start = end;
      while (/\s/u.test(text[start] || '')) start += 1;
      index = start - 1;
    }
    if (start < text.length) {
      const offset = text.slice(start).search(/\S/u);
      if (offset >= 0) ranges.push({ start: start + offset, end: text.length });
    }
    return ranges;
  }

  function combinedLineRect(page, start, end) {
    const rects = (Array.isArray(page.spans) ? page.spans : []).filter(span =>
      Number(span?.end) > start && Number(span?.start) < end && span.rect)
      .map(span => span.rect).filter(rect => [rect.left, rect.top, rect.right, rect.bottom]
        .map(Number).every(Number.isFinite));
    if (!rects.length) return null;
    return { left: Math.min(...rects.map(rect => Number(rect.left))),
      top: Math.min(...rects.map(rect => Number(rect.top))),
      right: Math.max(...rects.map(rect => Number(rect.right))),
      bottom: Math.max(...rects.map(rect => Number(rect.bottom))) };
  }

  function columnContinuationEvidence(page, previous, current, previousText, currentText, captionFlow = false, terminalFlow = false) {
    const a = previous?.rect, b = current?.rect;
    const width = pageDimensions(page).width;
    if (!a || !b || !(width > 0)) return false;
    const height = a.bottom - a.top, nextHeight = b.bottom - b.top;
    if (!(height > 0) || nextHeight < height * 0.7 || nextHeight > height * 1.4 ||
        b.left - a.left <= 80 || b.top >= a.top - height * 2 ||
        a.right - a.left < width * 0.25 || b.right - b.left < width * 0.2 ||
        (!terminalFlow && /[.!?。！？:;][)\]}'”’」』]*$/u.test(previousText.trim())) ||
        !/^(?:[\p{L}\d]|\((?:fig(?:ure)?s?\.?|table)\s)/iu.test(currentText.trim()) ||
        /^(?:fig(?:ure)?|table)\s*(?:s\s*)?\d/iu.test(previousText.trim()) ||
        /^(?:fig(?:ure)?|table)\s*(?:s\s*)?\d/iu.test(currentText.trim())) return false;
    const broad = (page.spans || []).filter(span => span.rect && span.end > span.start &&
      span.rect.right - span.rect.left >= width * 0.25 &&
      span.rect.right - span.rect.left <= width * 0.55 &&
      span.rect.bottom - span.rect.top >= height * 0.7 &&
      span.rect.bottom - span.rect.top <= height * 1.4);
    const left = broad.filter(span => span.rect.right < b.left + height);
    const right = broad.filter(span => span.rect.left > a.right - height);
    if (left.length < 3 || right.length < 3) return false;
    const quantile = (values, fraction) => values.sort((x, y) => x - y)[Math.floor((values.length - 1) * fraction)];
    const columnEnd = quantile(left.map(span => span.rect.right), 0.8);
    const columnStart = quantile(right.map(span => span.rect.left), 0.2);
    return a.right >= columnEnd - height * (captionFlow ? 2.5 : 1.5) &&
      Math.abs(b.left - columnStart) <= Math.max(3, height * 0.6);
  }

  function terminalColumnContinuationEvidence(page,previous,current,previousText,currentText) {
    if (!/[.!?。！？][)\]}'”’」』]*$/u.test(previousText.trim()) ||
        !/^\p{Lu}/u.test(currentText.trim()) ||
        !columnContinuationEvidence(page,previous,current,previousText,currentText,false,true)) return false;
    const h=previous.rect.bottom-previous.rect.top,b=current.rect;
    // An observed first-line indent in this same column distinguishes new
    // paragraphs from an unindented continuation, even at a sentence boundary.
    return (page.spans || []).some(span=>span.rect &&
      span.rect.top>b.top+h && span.rect.top<b.top+h*20 &&
      span.rect.left-b.left>h*.7 && span.rect.left-b.left<h*3 &&
      span.rect.right-span.rect.left>pageDimensions(page).width*.2 &&
      span.rect.bottom-span.rect.top>=h*.75 && span.rect.bottom-span.rect.top<=h*1.3 &&
      /^\p{Lu}/u.test(page.text.slice(span.start,span.end).trim()) &&
      /[.!?。！？][)\]}'”’」』]*$/u.test(page.text.slice(0,span.start).trim()));
  }

  function flowFurnitureRangeIsValid(range, pageText) {
    const r=range?.rect,w=range?.pageWidth,h=range?.pageHeight;
    if (!r || ![r.left,r.top,r.right,r.bottom,w,h].every(Number.isFinite) ||
        w<=0 || h<=0 || r.left<0 || r.right>w || r.top<0 || r.bottom>h ||
        r.right<=r.left || r.bottom<=r.top) return false;
    const text=pageText.slice(range.start,range.end).trim();
    if (['running-header','publisher-running-header','repeated-page-furniture'].includes(range.kind) &&
        /^(?:Articles?|ll|OPEN ACCESS)$/u.test(text)) return r.bottom<=h*.14;
    if (range.kind==='page-number' && /^Page\s+\d+(?:\s+of\s+\d+)?$/u.test(text))
      return r.bottom<=h*.08 && r.left>=w*.65 && r.bottom-r.top<=12;
    if (range.kind==='publisher-citation' && /^Please cite this article in press as:/iu.test(text))
      return r.bottom<=h*.04 && r.bottom-r.top<=10;
    if (range.kind==='running-header' && /^https:\/\/doi\.org\//u.test(text))return r.bottom<=h*.05;
    if (range.kind==='running-footer')return r.top>=h*.94 && r.bottom-r.top<=12 && text.length<=80;
    return range.kind==='repeated-page-furniture' && r.top>=h*.94 &&
      r.right-r.left>=40 && r.right-r.left<=w*.6 && r.bottom-r.top<=12 &&
      /^[\p{L}][\p{L}\d &,.:;()\-/–—]{6,100}$/u.test(text) && !/[.!?]$/u.test(text);
  }

  function crossPageContinuationEvidence(previousPage, previous, page, first, figureGap=false) {
    if (!previousPage || (figureGap ? page.pageNumber<=previousPage.pageNumber+1 ||
        page.pageNumber>previousPage.pageNumber+3 : page.pageNumber!==previousPage.pageNumber+1)) return false;
    const last=previous.pieces.at(-1),next=first.pieces[0],a=last?.rect,b=next?.rect;
    const text=paragraphProjection(first.pieces).text;
    // Text-only callers have no physical layout to contradict canonical order.
    // Do not apply this fallback to partially positioned pages or isolated labels.
    if (![...(previousPage.spans || []),...(page.spans || [])].some(s=>s.rect || s.quadPoints?.length))
      return text.length>=8 && /\S\s+\S/u.test(text);
    const dimensions=pageDimensions(page),priorDimensions=pageDimensions(previousPage);
    if (!a || !b || !(dimensions.width>0) || !(dimensions.height>0) ||
        !(priorDimensions.width>0) || !(priorDimensions.height>0)) return false;
    const h=a.bottom-a.top,nh=b.bottom-b.top;
    if (!(h>0) || nh<h*.75 || nh>h*1.3 || a.right-a.left<priorDimensions.width*.2 ||
        b.right-b.left<dimensions.width*.2 || b.top<Math.max(25,dimensions.height*.045) ||
        a.bottom<priorDimensions.height*.65 || next.text.trim().length<8) return false;
    return (first.pieces.length===1 && text.length>=12 && /\S\s+\S/u.test(text)) || first.pieces.slice(1).some(piece=>piece.rect &&
      Math.abs(piece.rect.left-b.left)<=h && piece.rect.top>=b.bottom &&
      piece.rect.top<=b.bottom+h*2 && piece.rect.right-piece.rect.left>=dimensions.width*.2 &&
      piece.rect.bottom-piece.rect.top>=h*.75 && piece.rect.bottom-piece.rect.top<=h*1.3);
  }

  function captionMarkers(page) {
    return [...String(page.text || '').matchAll(/\b(?:fig(?:ure)?\.?)\s*(?:s\s*)?\d+\s*[.|:]/giu)]
      .map(m=>({start:m.index,end:m.index+m[0].length,rect:combinedLineRect(page,m.index,m.index+m[0].length)}))
      .filter(r=>r.rect);
  }

  function figureOnlyPageEvidence(page,bodyHeight,limit=String(page.text || '').length,furniture=[]) {
    const height=pageDimensions(page).height;
    if (!(bodyHeight>0) || !(height>0) || !Number.isSafeInteger(limit) || limit<=0 || limit>page.text.length) return null;
    const excluded=span=>furniture.some(r=>r.start<=span.start && r.end>=span.end);
    const spans=(page.spans || []).filter(s=>s.start<limit && s.end>0 && !excluded(s));
    if (spans.length<6 || spans.some(s=>!s.rect || s.end>limit)) return null;
    const markers=captionMarkers(page).filter(r=>r.end<=limit && r.rect.top>=height*.3 &&
      r.rect.bottom-r.rect.top<bodyHeight*.98);
    if (!markers.length) return null;
    const caption=markers[0];
    const panels=spans.filter(s=>/^[A-Za-z]$/u.test(page.text.slice(s.start,s.end).trim()) &&
      s.rect.bottom<caption.rect.top && s.rect.bottom-s.rect.top<=bodyHeight*1.4);
    if (panels.length<2) return null;
    // Small type also occurs in ordinary prose. Three aligned, long lines
    // above the caption establish a body flow even when graph labels exist.
    const rows=[];
    for(const s of spans.filter(s=>s.rect.bottom<caption.rect.top).sort((a,b)=>a.rect.top-b.rect.top||a.rect.left-b.rect.left)){
      const r=s.rect,h=r.bottom-r.top,letters=(page.text.slice(s.start,s.end).match(/\p{L}/gu)||[]).length;
      const row=rows.find(line=>Math.min(line.rect.bottom,r.bottom)-Math.max(line.rect.top,r.top)>=
        Math.min(line.rect.bottom-line.rect.top,h)*.4 && r.left>=line.rect.left && r.left-line.rect.right<=h*2);
      if(row){row.rect.right=Math.max(row.rect.right,r.right);row.letters+=letters;}
      else rows.push({rect:{...r},letters});
    }
    const prose=rows.filter(s=>s.rect.right-s.rect.left>=pageDimensions(page).width*.2 && s.letters>=36);
    for(const first of prose){
      const h=first.rect.bottom-first.rect.top;
      const lines=prose.filter(s=>Math.abs(s.rect.left-first.rect.left)<=h &&
        s.rect.top>=first.rect.top && s.rect.bottom-s.rect.top>=h*.75 &&
        s.rect.bottom-s.rect.top<=h*1.3).sort((a,b)=>a.rect.top-b.rect.top);
      let count=1;
      for(let i=1;i<lines.length;i++){
        const gap=lines[i].rect.top-lines[i-1].rect.bottom;
        count=gap>=0&&gap<=h*1.6?count+1:1;
        if(count>=3)return null;
      }
    }
    if (spans.some(s=>{
      const rawHeight=s.rect.bottom-s.rect.top,width=s.rect.right-s.rect.left;
      const h=rawHeight>width*1.4 && width<bodyHeight*.92?width:rawHeight;
      const value=page.text.slice(s.start,s.end).trim();
      return h<=0 || (s.rect.top>=caption.rect.top-bodyHeight*.5 ? h>=bodyHeight*.98 :
        h>bodyHeight*.92 && !(value.length<=3 && h<=bodyHeight*1.4));
    })) return null;
    const covered=new Uint8Array(limit);
    for (const s of [...spans,...furniture])covered.fill(1,Math.max(0,s.start),Math.min(limit,s.end));
    for(let i=0;i<limit;i++)if(!covered[i] && /\S/u.test(page.text[i]))return null;
    return {pageNumber:page.pageNumber,limit,caption,
      panels:panels.slice(0,4).map(s=>({start:s.start,end:s.end,rect:s.rect}))};
  }

  function alignedCaptionEvidence(page,before,after,pieces) {
    if(!before?.rect || !after?.rect)return null;
    const h=before.rect.bottom-before.rect.top;
    if (!pieces.length || pieces.some(p=>!p.rect || p.rect.bottom-p.rect.top>=h*.94 ||
        p.rect.left<after.rect.left-h || p.rect.bottom>after.rect.top-h)) return null;
    return captionMarkers(page).find(r=>r.rect.left<before.rect.right &&
      r.rect.bottom-r.rect.top<h*.94 && Math.abs(r.rect.top-pieces[0].rect.top)<=h) || null;
  }

  function intervalIsFurniture(page,start,end,ranges) {
    const unique=[...new Map(ranges.filter(r=>r.start>=start&&r.end<=end)
      .map(r=>[r.start+':'+r.end,r])).values()].sort((a,b)=>a.start-b.start);
    let cursor=start;
    for(const r of unique){
      if(r.start<cursor || page.text.slice(cursor,r.start).trim() || !flowFurnitureRangeIsValid(r,page.text))return false;
      cursor=r.end;
    }
    return !page.text.slice(cursor,end).trim();
  }

  function floatingTableEvidence(page, before, after, cells) {
    const w=pageDimensions(page).width,h=before?.rect?.bottom-before?.rect?.top;
    if (!(w>0) || !(h>0) || !after?.rect || cells.length<8 || cells.length>100 ||
        !/^table\s+(?:s\s*)?\d+(?:\.|\s)/iu.test(cells.map(c=>c.text).join(' ')) ||
        cells.some(c=>!c.rect || c.rect.left<after.rect.left-h || c.rect.right>w ||
          c.rect.top<pageDimensions(page).height*.08 || c.rect.bottom>after.rect.top-h ||
          c.rect.bottom-c.rect.top<h*.5 || c.rect.bottom-c.rect.top>h*1.05)) return false;
    const numbers=cells.filter(c=>/^\d+(?:[.\s×x]\d+)*$/u.test(c.text.trim()));
    if (numbers.length<3) return false;
    const rows=[];
    for (const cell of numbers) {
      if (cells.some(other=>other!==cell && cell.rect.left-other.rect.left>w*.15 &&
          Math.abs(cell.rect.top-other.rect.top)<h*.3) &&
          rows.every(y=>Math.abs(y-cell.rect.top)>h*.5)) rows.push(cell.rect.top);
    }
    return rows.length>=3;
  }

  function pageParagraphs(page, excludedRanges, floatingCaptionGaps = [], floatingTableGaps = []) {
    const raw = String(page.text || '');
    const paragraphs = [];
    const appendBodySlice = (sliceStart, sliceEnd) => {
      if (sliceEnd <= sliceStart) return;
      const slice = raw.slice(sliceStart, sliceEnd);
      const blocks = slice.split(/(?:\r?\n[ \t]*){2,}/u);
      let searchFrom = 0;
      for (const block of blocks) {
        const relative = slice.indexOf(block, searchFrom);
        searchFrom = relative + block.length;
        const leading = block.search(/\S/u);
        if (leading < 0) continue;
        const trailing = block.length - block.trimEnd().length;
        const blockStart = sliceStart + relative + leading;
        const blockEnd = sliceStart + relative + block.length - trailing;
        const lines = [];
        const positioned = (Array.isArray(page.spans) ? page.spans : [])
          .filter(span => span.end > blockStart && span.start < blockEnd && span.rect)
          .sort((left, right) => left.start - right.start);
        let covered = blockStart;
        const completeGeometry = positioned.length && positioned.every(span => {
          const start = Math.max(blockStart, span.start);
          const gap = raw.slice(covered, start);
          covered = Math.max(covered, Math.min(blockEnd, span.end));
          return !gap.trim();
        }) && !raw.slice(covered, blockEnd).trim();
        if (completeGeometry) {
          for (const span of positioned) {
            const start = Math.max(blockStart, span.start), end = Math.min(blockEnd, span.end);
            const previous = lines.at(-1), rect = span.rect;
            const height = rect.bottom - rect.top;
            const previousHeight = previous?.rect ? previous.rect.bottom - previous.rect.top : 0;
            const overlap = previous?.rect ? Math.min(previous.rect.bottom, rect.bottom) -
              Math.max(previous.rect.top, rect.top) : 0;
            const sameRow = previous && overlap >= Math.min(height, previousHeight) * 0.4 &&
              rect.left >= previous.rect.left - 2 &&
              rect.left - previous.rect.right <= Math.max(24, height * 2.8);
            if (sameRow) {
              previous.end = end;
              previous.text = raw.slice(previous.start, end);
              previous.rect = { left: Math.min(previous.rect.left, rect.left),
                top: Math.min(previous.rect.top, rect.top), right: Math.max(previous.rect.right, rect.right),
                bottom: Math.max(previous.rect.bottom, rect.bottom) };
            } else lines.push({ pageNumber: page.pageNumber, start, end, text: raw.slice(start, end), rect });
          }
        } else {
          const linePattern = /[^\r\n]+/gu;
          let line;
          while ((line = linePattern.exec(raw.slice(blockStart, blockEnd)))) {
            const text = line[0], start = blockStart + line.index;
            lines.push({ pageNumber: page.pageNumber, start, end: start + text.length, text,
              rect: combinedLineRect(page, start, start + text.length) });
          }
        }
        let pieces = [];
        for (const current of lines) {
          const previous = pieces.at(-1);
          current.sourceGap = previous ? raw.slice(previous.end, current.start) : '';
          const previousHeight = previous?.rect
            ? Number(previous.rect.bottom) - Number(previous.rect.top) : 0;
          const verticalGap = previous?.rect && current.rect
            ? Number(current.rect.top) - Number(previous.rect.bottom) : 0;
          const indentation = previous?.rect && current.rect
            ? Number(current.rect.left) - Number(previous.rect.left) : 0;
          const columnReset = previous?.rect && current.rect &&
            Number(current.rect.top) < Number(previous.rect.top) - Math.max(4, previousHeight) &&
            Math.abs(Number(current.rect.left) - Number(previous.rect.left)) > 80;
          const columnContinuation = columnReset && current.rect.left > previous.rect.left &&
            ((!/[.!?。！？][)\]}'”’」』]*$/u.test(previous.text.trim()) &&
              /^[\p{Ll}\d]/u.test(current.text.trim())) ||
              columnContinuationEvidence(page, previous, current,
                pieces.map(piece => piece.text).join(' '), current.text) ||
              terminalColumnContinuationEvidence(page,previous,current,
                pieces.map(piece=>piece.text).join(' '),current.text));
          const indentedSentenceStart = !columnReset && indentation > Math.max(3, previousHeight * 0.65) &&
            /[.!?。！？][)\]}'”’」』]*$/u.test(previous?.text.trim() || '') &&
            /^[\p{Lu}]/u.test(current.text.trim());
          const captionStart = /^fig\.?\s*(?:s\s*)?\d+\s*\|/iu.test(current.text.trim());
          const paragraphBreak = previous && (captionStart || (columnReset && !columnContinuation) ||
            verticalGap > Math.max(8, previousHeight * 0.65) ||
            (!columnReset && indentation > Math.max(18, previousHeight * 1.4)) || indentedSentenceStart);
          if (paragraphBreak) {
            paragraphs.push({ pieces });
            pieces = [];
          }
          pieces.push(current);
        }
        if (pieces.length) paragraphs.push({ pieces });
      }
    };
    let cursor = 0;
    for (const range of [...excludedRanges].sort((left, right) => left.start - right.start)) {
      const start = Math.max(cursor, Math.min(raw.length, Number(range.start) || 0));
      const end = Math.max(start, Math.min(raw.length, Number(range.end) || start));
      appendBodySlice(cursor, start);
      cursor = end;
    }
    appendBodySlice(cursor, raw.length);
    const joined = [];
    for (const paragraph of paragraphs) {
      const previous = joined.at(-1), last = previous?.pieces.at(-1), first = paragraph.pieces[0];
      const previousText=previous?.pieces.map(piece=>piece.text).join(' ') || '';
      const captionFlow=/(?:^|\s)fig(?:ure)?\.?\s*(?:s\s*)?\d+\s*[.|:]/iu.test(previousText);
      let canJoin = previous && columnContinuationEvidence(page, last, first,
        previousText, paragraph.pieces.map(piece => piece.text).join(' '), captionFlow);
      canJoin ||= previous && terminalColumnContinuationEvidence(page,last,first,previousText,
        paragraph.pieces.map(piece=>piece.text).join(' '));
      if (canJoin) {
        const between = excludedRanges.filter(range => range.end > last.end && range.start < first.start)
          .sort((a, b) => a.start - b.start);
        // Excluded headings are paragraph boundaries. Only explicitly identified
        // running furniture and whitespace may sit between the two raw pieces.
        let cursor = last.end, remaining = '';
        for (const range of between) {
          if (!flowFurnitureRangeIsValid(range,raw)) {
            canJoin = false; break;
          }
          remaining += raw.slice(cursor, Math.max(cursor, range.start));
          cursor = Math.max(cursor, Math.min(first.start, range.end));
        }
        remaining += raw.slice(cursor, first.start);
        if (remaining.trim()) canJoin = false;
      }
      if (canJoin) {
        first.sourceGap = '\n';
        previous.pieces.push(...paragraph.pieces);
      } else joined.push(paragraph);
    }
    // A detached caption can occur between the two body columns in the native
    // text stream. Keep its seed; only join the surrounding body when both the
    // column continuation and the separate physical caption are evidenced.
    for (let i = 0; i + 2 < joined.length; i += 1) {
      const beforeSeed = joined[i], caption = joined[i + 1], afterSeed = joined[i + 2];
      const before = beforeSeed.pieces.at(-1), after = afterSeed.pieces[0];
      const captionText = paragraphProjection(caption.pieces).text;
      const aligned=alignedCaptionEvidence(page,before,after,caption.pieces);
      if ((!/^fig(?:ure)?\.?\s*(?:s\s*)?\d+[.:]\s/iu.test(captionText) && !aligned) ||
          !columnContinuationEvidence(page, before, after,
            paragraphProjection(beforeSeed.pieces).text, paragraphProjection(afterSeed.pieces).text)) continue;
      const height = before.rect.bottom - before.rect.top;
      if (!aligned && !caption.pieces.every(piece => piece.rect &&
          piece.rect.bottom - piece.rect.top < height * 0.94 &&
          piece.rect.bottom - piece.rect.top >= height * 0.55 &&
          piece.rect.top >= before.rect.bottom + height &&
          piece.rect.left >= before.rect.left - height &&
          piece.rect.right <= before.rect.right + height * 2)) continue;
      const lastCaption = caption.pieces.at(-1);
      const support = (page.spans || []).filter(span => span.rect &&
        /^\([A-Z]\)\s/u.test(page.text.slice(span.start, span.end)) &&
        span.rect.top >= lastCaption.rect.bottom &&
        span.rect.top <= lastCaption.rect.bottom + height * 5 &&
        Math.abs(span.rect.left - caption.pieces[0].rect.left) <= height &&
        span.rect.bottom - span.rect.top < height * 0.94);
      if (!aligned && support.length < 2) continue;
      const captionRanges = caption.pieces.map(piece => ({ start: piece.start, end: piece.end, rect: piece.rect }));
      const between = [...captionRanges, ...excludedRanges.filter(range =>
        range.start >= before.end && range.end <= after.start)];
      between.sort((a, b) => a.start - b.start);
      let cursor = before.end, valid = true;
      for (const range of between) {
        if (range.start < cursor || page.text.slice(cursor, range.start).trim() ||
            (!captionRanges.includes(range) && !flowFurnitureRangeIsValid(range,page.text))) {
          valid = false; break;
        }
        cursor = range.end;
      }
      if (!valid || page.text.slice(cursor, after.start).trim()) continue;
      floatingCaptionGaps.push({ pageNumber: page.pageNumber,
        pageWidth: pageDimensions(page).width, pageHeight: pageDimensions(page).height,
        before: { start: before.start, end: before.end, rect: before.rect },
        after: { start: after.start, end: after.end, rect: after.rect },
        kind:aligned?'aligned-caption':'detached-caption',titleRange:aligned || null,
        captionRanges, supportRanges: support.slice(0, 2).map(span => ({
          start: span.start, end: span.end, rect: span.rect })) });
      after.sourceGap = '\n';
      beforeSeed.pieces.push(...afterSeed.pieces);
      joined.splice(i + 2, 1);
    }
    for (let i=0;i+2<joined.length;i+=1) {
      const beforeSeed=joined[i],before=beforeSeed.pieces.at(-1);
      if (!/^table\s+(?:s\s*)?\d+(?:\.|\s)/iu.test(paragraphProjection(joined[i+1].pieces).text)) continue;
      for (let k=i+2;k<Math.min(joined.length,i+26);k+=1) {
        const afterSeed=joined[k],after=afterSeed.pieces[0];
        if (!columnContinuationEvidence(page,before,after,
            paragraphProjection(beforeSeed.pieces).text,paragraphProjection(afterSeed.pieces).text)) continue;
        const detached=joined.slice(i+1,k);
        const blockRanges=detached.flatMap(seed=>{
          const projection=paragraphProjection(seed.pieces);
          return sourceRanges(projection.positionRuns,0,projection.text.length);
        });
        const cells=(page.spans || []).filter(s=>s.start>=blockRanges[0].start &&
          s.end<=blockRanges.at(-1).end).map(s=>({start:s.start,end:s.end,rect:s.rect,text:page.text.slice(s.start,s.end)}));
        if (!floatingTableEvidence(page,before,after,cells)) continue;
        const between=[...blockRanges,...excludedRanges.filter(r=>r.start>=before.end && r.end<=after.start)]
          .sort((a,b)=>a.start-b.start);
        let cursor=before.end,valid=true;
        for (const range of between) {
          if (range.start<cursor || page.text.slice(cursor,range.start).trim() ||
              (!blockRanges.includes(range) && !flowFurnitureRangeIsValid(range,page.text))) {valid=false;break;}
          cursor=range.end;
        }
        if (!valid || page.text.slice(cursor,after.start).trim()) continue;
        floatingTableGaps.push({pageNumber:page.pageNumber,...{
          pageWidth:pageDimensions(page).width,pageHeight:pageDimensions(page).height},
          before:{start:before.start,end:before.end,rect:before.rect},
          after:{start:after.start,end:after.end,rect:after.rect},blockRanges,
          cellRanges:cells.map(({start,end,rect})=>({start,end,rect}))});
        after.sourceGap='\n';beforeSeed.pieces.push(...afterSeed.pieces);joined.splice(k,1);break;
      }
    }
    return joined;
  }

  function paragraphProjection(pieces) {
    const characters = [];
    const positionRuns = [];
    const normalizationOmissions = [];
    let previousMergeable = false;
    const appendSource = (normalizedStart, normalizedEnd, pageNumber, rawStart, rawEnd,
      mergeable) => {
      const previous = positionRuns.at(-1);
      if (mergeable && previousMergeable && previous?.kind === 'source' &&
          previous.pageNumber === pageNumber && previous.normalizedEnd === normalizedStart &&
          previous.rawEnd === rawStart) {
        previous.normalizedEnd = normalizedEnd;
        previous.rawEnd = rawEnd;
      } else {
        positionRuns.push({ normalizedStart, normalizedEnd, pageNumber,
          rawStart, rawEnd, kind: 'source' });
      }
      previousMergeable = mergeable;
    };
    const appendVirtualSpace = () => {
      const normalizedStart = characters.length;
      characters.push(' ');
      positionRuns.push({ normalizedStart, normalizedEnd: normalizedStart + 1,
        pageNumber: null, rawStart: null, rawEnd: null, kind: 'virtual-space' });
      previousMergeable = false;
    };
    const removeTrailingSourceCharacter = () => {
      characters.pop();
      const run = positionRuns.at(-1);
      if (!run || run.kind !== 'source') return;
      normalizationOmissions.push({ pageNumber: run.pageNumber, start: run.rawEnd - 1,
        end: run.rawEnd, kind: 'line-wrap-hyphen' });
      run.normalizedEnd -= 1;
      run.rawEnd -= 1;
      if (run.normalizedEnd <= run.normalizedStart) positionRuns.pop();
      const current = positionRuns.at(-1);
      previousMergeable = current?.kind === 'source' &&
        current.normalizedEnd - current.normalizedStart === current.rawEnd - current.rawStart;
    };
    for (let pieceIndex = 0; pieceIndex < pieces.length; pieceIndex += 1) {
      const piece = pieces[pieceIndex];
      const projection = normalizePdfTextWithOffsets(piece.text);
      if (!projection.normalizedText) continue;
      if (characters.length) {
        const previousPiece = pieces[pieceIndex - 1];
        const trailing = previousPiece?.text.match(/\s+$/u)?.[0] || '';
        const leading = piece.text.slice(0, projection.normalizedToRawStart[0]);
        const gap = trailing + String(piece.sourceGap || '') + leading;
        const dehyphenate = previousPiece?.pageNumber === piece.pageNumber && characters.at(-1) === '-' && joinsBrokenWord(characters.join('')) &&
          /\p{L}\p{M}*-$/u.test(characters.join('')) && /^\p{Ll}/u.test(projection.normalizedText) &&
          /^(?:\r\n|\r|\n)$/u.test(gap);
        if (dehyphenate) {
          removeTrailingSourceCharacter();
        } else if (!(previousPiece?.pageNumber === piece.pageNumber && characters.at(-1) === '-' &&
            isPdfCompoundWrapPrefix(characters.join('')) && /^[\p{L}\d]/u.test(projection.normalizedText) &&
            /^(?:\r\n|\r|\n)[ \t]*$/u.test(gap))) {
          if (previousPiece?.pageNumber === piece.pageNumber && /^[ \t]+$/u.test(gap)) {
            const start = characters.length, previousRun = positionRuns.at(-1);
            characters.push(' ');
            appendSource(start, start + 1, piece.pageNumber, previousRun.rawEnd,
              piece.start + projection.normalizedToRawStart[0], false);
          } else appendVirtualSpace();
        }
      }
      const normalizedBase = characters.length;
      for (let offset = 0; offset < projection.normalizedText.length; offset += 1) {
        characters.push(projection.normalizedText[offset]);
      }
      let index = 0;
      while (index < projection.normalizedText.length) {
        const rawStart = projection.normalizedToRawStart[index];
        const rawEnd = projection.normalizedToRawEnd[index];
        let end = index + 1;
        while (end < projection.normalizedText.length &&
            projection.normalizedToRawStart[end] === rawStart &&
            projection.normalizedToRawEnd[end] === rawEnd) end += 1;
        appendSource(normalizedBase + index, normalizedBase + end, piece.pageNumber,
          piece.start + rawStart, piece.start + rawEnd,
          end - index === 1 && rawEnd - rawStart === 1 &&
          piece.text.slice(rawStart, rawEnd) === projection.normalizedText.slice(index, end));
        index = end;
      }
    }
    return { text: characters.join(''), positionRuns, normalizationOmissions };
  }

  function sourceRanges(positionRuns, start, end) {
    const ranges = [];
    for (const run of positionRuns) {
      if (run.kind !== 'source' || run.normalizedEnd <= start || run.normalizedStart >= end) continue;
      const normalizedStart = Math.max(start, run.normalizedStart);
      const normalizedEnd = Math.min(end, run.normalizedEnd);
      const oneToOne = run.normalizedEnd - run.normalizedStart === run.rawEnd - run.rawStart;
      const rawStart = oneToOne
        ? run.rawStart + normalizedStart - run.normalizedStart : run.rawStart;
      const rawEnd = oneToOne
        ? run.rawStart + normalizedEnd - run.normalizedStart : run.rawEnd;
      const previous = ranges.at(-1);
      if (previous && previous.pageNumber === run.pageNumber && rawStart <= previous.end + 3) {
        previous.end = Math.max(previous.end, rawEnd);
      } else {
        ranges.push({ pageNumber: run.pageNumber, start: rawStart, end: rawEnd });
      }
    }
    return ranges;
  }

  function pageDimensions(page = {}) {
    return { width: Number(page.pageWidth) ||
        Math.abs(Number(page.view?.[2]) - Number(page.view?.[0])) || 0,
    height: Number(page.pageHeight) ||
        Math.abs(Number(page.view?.[3]) - Number(page.view?.[1])) || 0 };
  }

  function pointInsidePage(x, y, page) {
    const dimensions = pageDimensions(page);
    return x >= 0 && y >= 0 && (!dimensions.width || x <= dimensions.width) &&
      (!dimensions.height || y <= dimensions.height);
  }

  const validatePdfQuadPoints = typeof dependency.validatePdfQuadPoints === 'function'
    ? dependency.validatePdfQuadPoints
    : () => [];

  function validRect(value, page) {
    if (!value) return null;
    const rect = [value.left, value.top, value.right, value.bottom].map(Number);
    if (!rect.every(Number.isFinite) || rect[2] <= rect[0] || rect[3] <= rect[1] ||
        !pointInsidePage(rect[0], rect[1], page) ||
        !pointInsidePage(rect[2], rect[3], page)) return null;
    return { left: rect[0], top: rect[1], right: rect[2], bottom: rect[3] };
  }

  function documentRanges(pages, start, end) {
    const ranges = [];
    for (const page of pages) {
      if (page.pageNumber < start.pageNumber || page.pageNumber > end.pageNumber) continue;
      const rangeStart = page.pageNumber === start.pageNumber ? start.offset : 0;
      const rangeEnd = page.pageNumber === end.pageNumber ? end.offset : page.text.length;
      if (rangeEnd > rangeStart) ranges.push({ pageNumber: page.pageNumber,
        start: rangeStart, end: rangeEnd });
    }
    return ranges;
  }

  function repeatedFurnitureByPage(pages) {
    const byPage = new Map();
    if (typeof dependency.classifyPdfPageFurnitureSegments === 'function') {
      for (const page of pages) {
        const dimensions = pageDimensions(page);
        const spans = (Array.isArray(page.spans) ? page.spans : []).filter(span => span.rect);
        const classified = dependency.classifyPdfPageFurnitureSegments(spans.map(span => ({
          ...span, text: String(page.text || '').slice(span.start, span.end)
        })), { left: 0, top: 0, right: dimensions.width, bottom: dimensions.height }, { pageNumber: page.pageNumber });
        const ranges = classified.filter(item => item.furniture).map(item => ({
          start: item.start, end: item.end, kind: item.kind, rect: item.rect,
          pageWidth: dimensions.width, pageHeight: dimensions.height
        }));
        for (const span of spans) {
          const match=page.text.slice(span.start,span.end).trim().match(/^Page\s+(\d+)\s+of\s+(\d+)$/u);
          const range={start:span.start,end:span.end,kind:'page-number',rect:span.rect,
            pageWidth:dimensions.width,pageHeight:dimensions.height};
          if (match && Number(match[1])===page.pageNumber && Number(match[2])>=page.pageNumber &&
              flowFurnitureRangeIsValid(range,page.text)) ranges.push(range);
          const value=page.text.slice(span.start,span.end).trim(),rect=span.rect;
          if (/^Please cite this article in press as:/iu.test(value) && rect.bottom<=dimensions.height*.04)
            ranges.push({...range,kind:'publisher-citation'});
          if (value==='ll' && rect.top>=0 && rect.bottom<=dimensions.height*.11 &&
              rect.bottom-rect.top>=12 && (rect.right<=dimensions.width*.2 || rect.left>=dimensions.width*.8) &&
              spans.some(s=>/^https:\/\/doi\.org\//u.test(page.text.slice(s.start,s.end)) && s.rect.bottom<=dimensions.height*.04))
            ranges.push({...range,kind:'publisher-running-header'});
        }
        // Cell/Neuron place a two-part publisher mark between column text in
        // the native stream. Identify both physical margin items, not body prose.
        for (const label of spans.filter(span => page.text.slice(span.start, span.end).trim() === 'OPEN ACCESS' &&
          span.rect.top >= 0 && span.rect.bottom <= dimensions.height * 0.14 &&
          (span.rect.left >= dimensions.width * 0.7 || span.rect.right <= dimensions.width * 0.3))) {
          const logo = spans.find(span => page.text.slice(span.start, span.end).trim() === 'll' &&
            span.rect.left >= label.rect.left && span.rect.right <= label.rect.right + 4 &&
            span.rect.bottom <= label.rect.top + 4 && label.rect.top - span.rect.bottom <= 20);
          const article=logo && spans.find(span=>/^Articles?$/u.test(page.text.slice(span.start,span.end).trim()) &&
            span.rect.bottom-span.rect.top>=12 && span.rect.bottom-span.rect.top<=24 &&
            Math.abs(span.rect.top-label.rect.top)<=20 && span.rect.bottom<=dimensions.height*.14 &&
            (label.rect.left>=dimensions.width*.7 ? span.rect.right<=dimensions.width*.3 : span.rect.left>=dimensions.width*.7) &&
            !spans.some(other=>other!==span &&
              Math.min(other.rect.bottom,span.rect.bottom)-Math.max(other.rect.top,span.rect.top)>
                Math.min(other.rect.bottom-other.rect.top,span.rect.bottom-span.rect.top)*.4 &&
              Math.max(other.rect.left-span.rect.right,span.rect.left-other.rect.right,0)<20));
          if (logo) for (const span of [logo, label,...(article?[article]:[])]) ranges.push({ start: span.start, end: span.end,
            kind: 'publisher-running-header', rect: span.rect,
            pageWidth: dimensions.width, pageHeight: dimensions.height });
        }
        if (ranges.length) byPage.set(page.pageNumber, ranges);
      }
    }
    const appearances = new Map();
    for (const page of pages) {
      const supplied = (Array.isArray(page.spans) ? page.spans : []).filter(span => span.rect &&
        Number.isSafeInteger(span.start) && Number.isSafeInteger(span.end));
      const lines = supplied.length ? supplied.map(span => ({ text: page.text.slice(span.start, span.end),
        start: span.start, end: span.end, rect: span.rect })) :
        [...page.text.matchAll(/[^\r\n]+/gu)].map(match => ({ text: match[0], start: match.index,
          end: match.index + match[0].length, rect: combinedLineRect(page, match.index, match.index + match[0].length) }));
      for (const line of lines) {
        const normalizedText = line.text.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLowerCase();
        if (!normalizedText) continue;
        // A native item can be a single inline glyph or citation/statistical
        // token. Repetition at a printable edge does not make "P", "0.0001"
        // or a reused figure label a running header/footer.
        if ((!/\s/u.test(normalizedText) && !/^(?:articles?|research|neuroscience)$/u.test(normalizedText)) ||
            /^(?:fig(?:ure)?|table)\s*(?:s\s*)?\d/iu.test(normalizedText)) continue;
        const { start, end, rect } = line;
        // Repeated inline statistics or a caption continuation are still body
        // text. Only an isolated margin item is a running-furniture candidate.
        if (rect && lines.some(other => {
          if (other === line || !other.rect) return false;
          const height = rect.bottom - rect.top;
          const otherHeight = other.rect.bottom - other.rect.top;
          const overlap = Math.min(rect.bottom, other.rect.bottom) -
            Math.max(rect.top, other.rect.top);
          const horizontalGap = Math.max(other.rect.left - rect.right, rect.left - other.rect.right, 0);
          if (overlap >= Math.min(height, otherHeight) * 0.4 &&
              horizontalGap <= Math.max(24, height * 2.8)) return true;
          const horizontalOverlap = Math.min(rect.right, other.rect.right) -
            Math.max(rect.left, other.rect.left);
          const verticalGap = Math.max(other.rect.top - rect.bottom, rect.top - other.rect.bottom, 0);
          return horizontalOverlap > 0 && overlap <= 0 &&
            verticalGap < Math.max(8, Math.min(height, otherHeight) * 1.2);
        })) continue;
        const entries = appearances.get(normalizedText) || [];
        entries.push({ pageNumber: page.pageNumber, start, end, rect,
          pageHeight: Number(page.pageHeight) || 0, pageWidth: Number(page.pageWidth) || 0 });
        appearances.set(normalizedText, entries);
      }
    }
    for (const entries of appearances.values()) {
      if (new Set(entries.map(item => item.pageNumber)).size < 2) continue;
      for (const entry of entries) {
        if (!entry.rect || !entry.pageHeight) continue;
        const atEdge = entry.rect.bottom / entry.pageHeight <= 0.08 ||
          entry.rect.top / entry.pageHeight >= 0.94 || (entry.pageWidth > 0 &&
          (entry.rect.left / entry.pageWidth <= 0.04 || entry.rect.right / entry.pageWidth >= 0.96));
        if (!atEdge) continue;
        const ranges = byPage.get(entry.pageNumber) || [];
        ranges.push({ start: entry.start, end: entry.end, kind: 'repeated-page-furniture',
          rect: entry.rect, pageWidth: entry.pageWidth, pageHeight: entry.pageHeight });
        byPage.set(entry.pageNumber, ranges);
      }
    }
    return byPage;
  }

  function pdfHeadingTitleFragments(heading, rawText) {
    const ranges = heading?.titleRanges;
    if (!Array.isArray(ranges) || ranges.length < 2 || ranges.length > 32 ||
        ranges[0]?.start !== heading.start || ranges[0]?.end !== heading.end ||
        ranges.some(range => !Number.isSafeInteger(range?.start) || !Number.isSafeInteger(range?.end) ||
          range.start < 0 || range.end <= range.start || range.end > rawText.length)) return null;
    const ordered = [...ranges].sort((a, b) => a.start - b.start);
    if (ordered.some((range, i) => i > 0 && range.start < ordered[i - 1].end)) return null;
    const title = ranges.map(range => rawText.slice(range.start, range.end)).join(' ')
      .normalize('NFKC').replace(/\s+/gu, ' ').trim()
      .replace(/-\s+(?=\p{Ll})/gu, '-').replace(/\s+([+−])(?=\s|$)/gu, '$1');
    if (title !== String(heading.normalizedText || '').normalize('NFKC').replace(/\s+/gu, ' ').trim()) return null;
    return { ranges, title };
  }

  // Draft pure helper for insertion into the existing synchronous index factory.
  // It never rewrites text or invents source offsets. References context and any
  // excluded publisher gap are supplied by the index's authoritative classifiers.
  function segmentPdfReferenceEntries(input={}) {
   const original=Array.isArray(input.seeds)?input.seeds:[];
   const ranges=Array.isArray(input.referenceRanges)?input.referenceRanges:[];
   const diagnostics=[];
   if(!ranges.length)return {seeds:original,diagnostics};
   const pages=new Map((input.pages||[]).map(p=>[p.pageNumber,p]));
   const approved=input.approvedGapRanges||[];
   const tokens=[];
   for(const seed of original)for(const piece of seed.pieces||[]){
    const page=pages.get(piece.pageNumber),raw=String(page?.text||'');
    const cuts=[piece.start,piece.end,...ranges.filter(r=>r.pageNumber===piece.pageNumber&&r.start<piece.end&&r.end>piece.start).flatMap(r=>[Math.max(piece.start,r.start),Math.min(piece.end,r.end)])].sort((a,b)=>a-b);
    for(let i=1;i<cuts.length;i++){
     const start=cuts[i-1],end=cuts[i];if(end<=start)continue;
     const value=start===piece.start&&end===piece.end?piece:{...piece,start,end,text:raw.slice(start,end)};
     tokens.push({seed,piece:value,selected:ranges.some(r=>r.pageNumber===piece.pageNumber&&r.start<=start&&r.end>=end)});
    }
   }
   const gapIsAllowed=(a,b)=>{
    if(a.pageNumber===b.pageNumber){
     if(b.start<a.end)return false;
     const raw=String(pages.get(a.pageNumber)?.text||'');let cursor=a.end;
     for(const r of approved.filter(r=>r.pageNumber===a.pageNumber&&r.end>a.end&&r.start<b.start).sort((x,y)=>x.start-y.start)){
      if(r.start<cursor||raw.slice(cursor,r.start).trim())return false;
      cursor=r.end;
     }
     return !raw.slice(cursor,b.start).trim();
    }
    if(b.pageNumber!==a.pageNumber+1||!a.rect||!b.rect)return false;
    const h=a.rect.bottom-a.rect.top,nh=b.rect.bottom-b.rect.top;
    const prior=pages.get(a.pageNumber),next=pages.get(b.pageNumber);
    const priorWidth=Number(prior?.pageWidth||prior?.width||0),nextWidth=Number(next?.pageWidth||next?.width||0);
    const priorHeight=Number(prior?.pageHeight||prior?.height||0),nextHeight=Number(next?.pageHeight||next?.height||0);
    const sameColumn=Math.abs(a.rect.left-b.rect.left)<=h*4;
    const rightBottomToLeftTop=priorWidth>0&&nextWidth>0&&a.rect.left>priorWidth*.45&&
     b.rect.left<nextWidth*.5&&a.rect.bottom>priorHeight*.8&&b.rect.top<nextHeight*.25&&
     a.rect.right-a.rect.left>priorWidth*.2&&b.rect.right-b.rect.left>nextWidth*.2;
    return h>0&&nh>=h*.75&&nh<=h*1.35&&a.rect.bottom>priorHeight*.6&&
     b.rect.top>nextHeight*.04&&b.text.trim().length>=8&&(sameColumn||rightBottomToLeftTop);
   };
   const authorStart=value=>{
    const name=value.replace(/^(?:(?:de|van|von|der|den|da|del|di|dos|la|le|du|al)[ '-]){1,2}(?=\p{Lu})/u,'');
    // U+FFFD is preserved in raw text; a PDF's missing accent glyph must not
    // erase an otherwise evidenced author/number boundary in References.
    return /^[\p{Lu}][\p{L}\p{M}\uFFFD'’ .\-‐–]{1,70},\s*\p{Lu}/u.test(name)||
     /^[\p{Lu}][\p{L}\p{M}\uFFFD'’\-–]+(?:\s+[\p{L}\uFFFD'’\-–]+){0,2}\s+[A-Z][A-Za-z\-‐–]{0,8}(?:,|\.|\s)/u.test(name);
   };
   const rawAnchor=(piece,index)=>{
    const value=piece.text.replace(/\s+/gu,' ').trim(),m=/^(?:\[(\d{1,4})\]|(\d{1,4})[.)])\s+(.+)$/u.exec(value);
    if(m&&authorStart(m[3]))return {index,number:Number(m[1]||m[2]),style:'numbered',piece};
    if(authorStart(value)&&/\((?:18|19|20)\d{2}[a-z]?\)/u.test(value))return {index,number:null,style:'author-year',piece};
    return null;
   };
   const output=[];
   const continuationGeometry=(prior,next)=>{
    if(/^[•●◦▪⁃]\s*/u.test(next.text.trim()))return false;
    if(prior.pageNumber!==next.pageNumber)return gapIsAllowed(prior,next);
    const a=prior.rect,b=next.rect;if(!a||!b)return false;
    const h=a.bottom-a.top,nh=b.bottom-b.top;
    if(!(h>0&&nh>=h*.7&&nh<=h*1.35))return false;
    const dx=b.left-a.left,dy=b.top-a.top,gap=b.top-a.bottom;
    // A completed hanging entry followed by an outdented, separated block has
    // ended. New numbered anchors are handled before this continuation guard.
    if(dx< -Math.max(3,h*.65)&&gap>Math.max(4,h*.8)&&
       /[.!?。！？][)\]}'”’」』]*$/u.test(prior.text.trim())&&/^[\p{Lu}©]/u.test(next.text.trim()))return false;
    if(Math.abs(dx)<=h*5)return dy>=-h*.5&&gap<=Math.max(12,h*2.5);
    // A real column continuation returns upward into the next column. A later
    // floating box to the right and below is a separate block, even in References.
    return dx>80&&dy< -h*2;
   };
   const appendOriginal=t=>{
    const last=output.at(-1);
    if(last?._originalSeed===t.seed)last.pieces.push(t.piece);
    else output.push({...t.seed,pieces:[t.piece],_originalSeed:t.seed});
   };
   const processRun=run=>{
    const found=run.map((t,i)=>rawAnchor(t.piece,i)).filter(Boolean);
    // An author-year on an indented continuation line of a numbered reference is
    // not another entry and must not truncate the enclosing entry's year evidence.
    const candidates=found.some(a=>a.style==='numbered')?found.filter(a=>a.style==='numbered'):found;
    const accepted=candidates.filter((a,i)=>{
     const until=candidates[i+1]?.index??run.length;
     const body=run.slice(a.index,until).map(t=>t.piece.text).join(' ');
     const submitted=a.style==='numbered'&&/(?:^|[.\s])(?:submitted|in press|forthcoming)\.?$/iu.test(body)&&
      candidates.some(b=>b.number===a.number-1)&&candidates.some(b=>b.number===a.number+1);
     if((!/\b(?:18|19|20)\d{2}[a-z]?\b/u.test(body)&&!submitted)||body.length>4000)return false;
     const r=a.piece.rect,h=r?.bottom-r?.top;if(!(h>0&&h<=18))return false;
     const following=run[a.index+1]?.piece,fr=following?.rect;
     const hanging=fr&&following.pageNumber===a.piece.pageNumber&&fr.top>=r.bottom&&
      fr.top-r.bottom<h*3&&fr.left-r.left>=h*.45&&fr.left-r.left<=h*5;
     const partner=candidates.some((b,j)=>{
      if(i===j||a.style!==b.style)return false;
      if(a.style==='numbered'&&Math.abs(a.number-b.number)!==1)return false;
      const br=b.piece.rect;if(!br)return false;
      return (b.piece.pageNumber===a.piece.pageNumber&&Math.abs(br.left-r.left)<=h*.6)||
        (a.style==='numbered'&&(Math.abs(br.left-r.left)>80||
         (Math.abs(b.piece.pageNumber-a.piece.pageNumber)===1&&Math.abs(br.left-r.left)<=h*.6)));
     });
     const completeSingleLine=a.style==='numbered'&&(
      /\b(?:18|19|20)\d{2}[a-z]?\s*[;:]\s*\d/u.test(body)||
      /https?:\/\/\s*doi\.\s*org\//u.test(body)||
      /\b(?:18|19|20)\d{2}[a-z]?\)\..*\b\d+\s*,\s*\d+[–-]\d+/u.test(body));
     return partner&&(hanging||completeSingleLine);
    });
    if(accepted.length<2){run.forEach(appendOriginal);return;}
    let active=null,anchorIndex=0;
    for(let i=0;i<run.length;i++){
     const t=run[i],a=accepted[anchorIndex];
     if(a&&a.index===i){
      active={...t.seed,pieces:[],referenceEntry:true,referenceEntryNumber:a.number,
       referenceEntryStart:{pageNumber:t.piece.pageNumber,start:t.piece.start}};
      output.push(active);anchorIndex++;
      diagnostics.push({kind:'reference-entry-start',pageNumber:t.piece.pageNumber,start:t.piece.start,number:a.number,style:a.style});
     }
     if(active&&active.pieces.length&&!continuationGeometry(active.pieces.at(-1),t.piece))active=null;
     if(active){
      const prior=active.pieces.at(-1),piece={...t.piece};
      if(prior)piece.sourceGap=prior.pageNumber===piece.pageNumber?
       String(pages.get(piece.pageNumber)?.text||'').slice(prior.end,piece.start):'\n';
      // The provenance-bound index handles the actual approved gap, never its text.
      if(prior&&piece.sourceGap.trim())piece.sourceGap='\n';
      active.pieces.push(piece);
     }else appendOriginal(t);
    }
   };
   let run=[];
   const flush=()=>{if(run.length)processRun(run);run=[];};
   for(const t of tokens){
    if(!t.selected){flush();appendOriginal(t);continue;}
    if(run.length&&!gapIsAllowed(run.at(-1).piece,t.piece))flush();
    run.push(t);
   }
   flush();
   if(!diagnostics.length)return {seeds:original,diagnostics};
   return {seeds:output.map(({_originalSeed,...seed})=>seed),diagnostics};
  }

  function referenceContextRanges(pages,headings,outlineEntries) {
    const isRef=value=>/^(?:references|bibliography|参考文献)$/iu.test(String(value||'').trim());
    const anchors=headings.filter(h=>isRef(h.normalizedText||h.title)).map(h=>({pageNumber:h.pageNumber,start:h.start,end:h.end}));
    for(const page of pages){
      const sizes=(page.spans||[]).filter(s=>s.rect).map(s=>s.rect.bottom-s.rect.top).filter(h=>h>0).sort((a,b)=>a-b);
      const median=sizes[Math.floor(sizes.length/2)]||0;
      for(const span of page.spans||[]){
        if(!span.rect || !isRef(page.text.slice(span.start,span.end)))continue;
        const hint=outlineEntries.some(h=>h.pageNumber===page.pageNumber&&isRef(h.title||h.normalizedText));
        if(span.bold===true || span.rect.bottom-span.rect.top>median*1.12 || hint)
          anchors.push({pageNumber:page.pageNumber,start:span.start,end:span.end});
      }
    }
    const unique=[...new Map(anchors.map(a=>[a.pageNumber+':'+a.start,a])).values()]
      .sort((a,b)=>a.pageNumber-b.pageNumber||a.start-b.start);
    const result=[];
    for(const anchor of unique){
      const next=headings.find(h=>!isRef(h.normalizedText||h.title) &&
        (h.pageNumber>anchor.pageNumber||h.pageNumber===anchor.pageNumber&&h.start>anchor.end));
      for(const page of pages){
        if(page.pageNumber<anchor.pageNumber || next&&page.pageNumber>next.pageNumber)continue;
        const start=page.pageNumber===anchor.pageNumber?anchor.end:0;
        const end=next&&page.pageNumber===next.pageNumber?next.start:page.text.length;
        if(end>start)result.push({pageNumber:page.pageNumber,start,end});
      }
    }
    return result;
  }

  function buildPdfSemanticIndex(input = {}) {
    const documentHash = canonicalHash(input.documentHash);
    const revision = Number.isFinite(Number(input.revision)) ? Number(input.revision) : 0;
    const pages = (Array.isArray(input.pages) ? input.pages : []).map(page => ({ ...page,
      pageNumber: Math.max(1, Math.floor(Number(page.pageNumber) || 1)),
      text: String(page.text || '') })).sort((left, right) => left.pageNumber - right.pageNumber);
    const pageMap = new Map(pages.map(page => [page.pageNumber, page]));
    const pageMappings = pages.map(page => ({ pageNumber: page.pageNumber,
      ...normalizePdfTextWithOffsets(page.text) }));
    const headingAnalysis = typeof dependency.analyzePdfHeadings === 'function'
      ? dependency.analyzePdfHeadings({ ...input, documentHash, revision, pages })
      : { headings: dependency.extractPdfHeadings({ ...input, documentHash, revision, pages }),
        outlineEntries: [] };
    // With usable native bookmarks, inferred titles remain ordinary source text.
    // Removing them as headings while showing only the native tree would hide
    // text that has no visible bookmark counterpart.
    const hasEmbeddedOutline = headingAnalysis.outlineEntries.some(entry =>
      Number.isSafeInteger(entry.pageNumber) && pageMap.has(entry.pageNumber));
    const headings = hasEmbeddedOutline
      ? headingAnalysis.headings.filter(heading => heading.source === 'outline') : headingAnalysis.headings;
    const headingByPage = new Map();
    for (const heading of headings) {
      const ranges = headingByPage.get(heading.pageNumber) || [];
      const fragments = pdfHeadingTitleFragments(heading, pageMap.get(heading.pageNumber)?.text || '');
      ranges.push(...(fragments?.ranges || [{ start: heading.start, end: heading.end }]));
      headingByPage.set(heading.pageNumber, ranges);
    }
    const furnitureByPage = repeatedFurnitureByPage(pages);
    let paragraphSeeds = [];
    const floatingCaptionGaps = [];
    const floatingTableGaps = [];
    const figurePageContinuations = [];
    let flowTail=null,figurePages=[];
    for (const page of pages) {
      const current = pageParagraphs(page, [
        ...(headingByPage.get(page.pageNumber) || []),
        ...(furnitureByPage.get(page.pageNumber) || [])
      ], floatingCaptionGaps, floatingTableGaps);
      const previous = flowTail?.pieces.at(-1)?.pageNumber===page.pageNumber-1 ? flowTail : paragraphSeeds.at(-1);
      const first = current[0];
      const previousProjection = previous ? paragraphProjection(previous.pieces).text : '';
      const firstProjection = first ? paragraphProjection(first.pieces).text : '';
      const headingBeforeFirst = first && (headingByPage.get(page.pageNumber) || [])
        .some(range => range.start < first.pieces[0].start);
      const previousLast=previous?.pieces.at(-1);
      const headingAfterPrevious=previousLast && (headingByPage.get(previousLast.pageNumber) || [])
        .some(range=>range.start>=previousLast.end);
      const isCaption = text => /^(?:fig(?:ure)?|table)\s*(?:S\s*)?\d+[.\s:]/iu.test(text);
      if (previous && first && previousProjection && !/[.!?。！？][)\]}'”’」』]*$/u.test(previousProjection) &&
          /^[\p{L}\d]/u.test(firstProjection) && !headingBeforeFirst && !headingAfterPrevious &&
          !isCaption(previousProjection) && !isCaption(firstProjection) &&
          crossPageContinuationEvidence(pageMap.get(previous.pieces.at(-1).pageNumber),previous,page,first)) {
        previous.pieces.push(...first.pieces);
        current.shift();
      }
      if (flowTail && figurePages.length) {
        const before=flowTail.pieces.at(-1),prior=pageMap.get(before.pageNumber),h=before.rect.bottom-before.rect.top;
        const k=current.findIndex(seed=>{
          const after=seed.pieces[0],text=paragraphProjection(seed.pieces).text;
          if(!/^\p{Ll}/u.test(text) || !crossPageContinuationEvidence(prior,flowTail,page,seed,true))return false;
          if(headings.some(heading=>heading.pageNumber>before.pageNumber&&heading.pageNumber<page.pageNumber ||
            heading.pageNumber===before.pageNumber&&heading.start>=before.end ||
            heading.pageNumber===page.pageNumber&&heading.start<after.start))return false;
          return intervalIsFurniture(page,0,after.start,furnitureByPage.get(page.pageNumber)||[]) ||
            Boolean(figureOnlyPageEvidence(page,h,after.start,furnitureByPage.get(page.pageNumber)||[]));
        });
        if (k>=0 && intervalIsFurniture(prior,before.end,prior.text.length,furnitureByPage.get(prior.pageNumber)||[])) {
          const seed=current[k],after=seed.pieces[0];
          figurePageContinuations.push({before:{pageNumber:before.pageNumber,start:before.start,end:before.end,rect:before.rect},
            after:{pageNumber:page.pageNumber,start:after.start,end:after.end,rect:after.rect},
            following:seed.pieces[1]?{pageNumber:page.pageNumber,start:seed.pieces[1].start,end:seed.pieces[1].end,rect:seed.pieces[1].rect}:null,
            skippedPages:[...figurePages]});
          after.sourceGap='\n';flowTail.pieces.push(...seed.pieces);current.splice(k,1);
        }
      }
      paragraphSeeds.push(...current);
      const candidates=[...current,...(flowTail?[flowTail]:[]),...(previous?[previous]:[])].filter(seed=>{
        const last=seed.pieces.at(-1),text=paragraphProjection(seed.pieces).text;
        return last?.pageNumber===page.pageNumber && last.rect && text.length>=40 &&
          !/[.!?。！？][)\]}'”’」』]*$/u.test(text) && !isCaption(text) &&
          !/^(?:references\b|\d+[.)]\s+\p{Lu})/iu.test(text) &&
          last.rect.bottom>=pageDimensions(page).height*.65 && last.rect.right-last.rect.left>=pageDimensions(page).width*.2 &&
          !(headingByPage.get(page.pageNumber)||[]).some(r=>r.start>=last.end) &&
          intervalIsFurniture(page,last.end,page.text.length,furnitureByPage.get(page.pageNumber)||[]);
      }).sort((a,b)=>b.pieces.at(-1).end-a.pieces.at(-1).end);
      if(candidates.length){flowTail=candidates[0];figurePages=[];}
      else if(flowTail && figurePages.length<2 && !(headingByPage.get(page.pageNumber)||[]).length &&
          figureOnlyPageEvidence(page,flowTail.pieces.at(-1).rect.bottom-flowTail.pieces.at(-1).rect.top,
            page.text.length,furnitureByPage.get(page.pageNumber)||[]))figurePages.push(page.pageNumber);
      else {flowTail=null;figurePages=[];}
    }

    const referenceRanges=referenceContextRanges(pages,headings,headingAnalysis.outlineEntries);
    const referenceResult=segmentPdfReferenceEntries({pages,seeds:paragraphSeeds,referenceRanges,
      approvedGapRanges:[...furnitureByPage].flatMap(([pageNumber,ranges])=>ranges.map(r=>({pageNumber,...r})))});
    paragraphSeeds=referenceResult.seeds;
    const spans = [];
    const sentences = [];
    const paragraphs = paragraphSeeds.map((seed, paragraphIndex) => {
      const projection = paragraphProjection(seed.pieces);
      const paragraphRanges = sourceRanges(projection.positionRuns, 0, projection.text.length);
      const paragraphId = pdfSemanticParagraphId(documentHash, revision, paragraphRanges);
      const sentenceIds = [];
      for (const boundary of splitSentenceRanges(projection.text)) {
        const ranges = sourceRanges(projection.positionRuns, boundary.start, boundary.end);
        if (!ranges.length) continue;
        const sentenceId = `pdf-sentence:${fnv64(`${documentHash}:${revision}:${JSON.stringify(ranges)}`)}`;
        const spanIds = [];
        for (const range of ranges) {
          const page = pageMap.get(range.pageNumber);
          const candidates = (Array.isArray(page?.spans) ? page.spans : []).filter(item =>
            Number(item?.end) > range.start && Number(item?.start) < range.end);
          const selected = candidates.length ? candidates : [{ start: range.start, end: range.end }];
          for (const candidate of selected) {
            const start = Math.max(range.start, Number(candidate.start) || range.start);
            const end = Math.min(range.end, Number(candidate.end) || range.end);
            if (end <= start) continue;
            const quadPoints = validatePdfQuadPoints(candidate.quadPoints, page);
            const rect = validRect(candidate.rect, page);
            const geometry = quadPoints.length
              ? { kind: 'quad', pageNumber: range.pageNumber, quadPoints,
                precision: Number(candidate.start) === start && Number(candidate.end) === end
                  ? 'exact-source-span' : 'enclosing-source-span' }
              : rect
                ? { kind: 'rect', pageNumber: range.pageNumber,
                  rect,
                  precision: Number(candidate.start) === start && Number(candidate.end) === end
                    ? 'exact-source-span' : 'enclosing-source-span' }
                : { kind: 'page-paragraph-fallback', pageNumber: range.pageNumber,
                  paragraphId, start, end, precision: 'no-geometry' };
            const spanId = `pdf-span:${fnv64(`${documentHash}:${revision}:${range.pageNumber}:${start}:${end}`)}`;
            spans.push({ spanId, sentenceId, paragraphId, pageNumber: range.pageNumber,
              start, end, rawText: page.text.slice(start, end), geometry });
            spanIds.push(spanId);
          }
        }
        const rawQuoteByPage = ranges.map(range => ({ pageNumber: range.pageNumber,
          start: range.start, end: range.end,
          quote: pageMap.get(range.pageNumber).text.slice(range.start, range.end) }));
        sentences.push({ sentenceId, paragraphId, normalizedText:
          projection.text.slice(boundary.start, boundary.end), ranges, rawQuoteByPage, spanIds });
        sentenceIds.push(sentenceId);
      }
      return { paragraphId, order: paragraphIndex, ranges: paragraphRanges,
        rawQuoteByPage: paragraphRanges.map(range => ({ ...range,
          quote: pageMap.get(range.pageNumber).text.slice(range.start, range.end) })),
        normalizedText: projection.text, positionRuns: projection.positionRuns, sentenceIds,
        normalizationOmissions: projection.normalizationOmissions,
        ...(seed.referenceEntry?{referenceEntry:true,referenceEntryNumber:seed.referenceEntryNumber}: {}) };
    });

    const sections = [];
    const documentStart = { pageNumber: pages[0]?.pageNumber || 1, offset: 0 };
    const lastPage = pages.at(-1);
    const documentEnd = { pageNumber: lastPage?.pageNumber || 1,
      offset: lastPage?.text.length || 0 };
    if (!headings.length) {
      sections.push({ sectionId: `pdf-section:${fnv64(`${documentHash}:${revision}:root`)}`,
        level: 1, source: 'implicit-document', headingId: null,
        parentSectionId: null, childSectionIds: [],
        paragraphIds: paragraphs.map(item => item.paragraphId),
        ranges: documentRanges(pages, documentStart, documentEnd) });
    } else {
      const firstHeading = headings[0];
      const preambleParagraphIds = paragraphs.filter(paragraph => {
        const first = paragraph.ranges[0];
        return first && (first.pageNumber < firstHeading.pageNumber ||
          (first.pageNumber === firstHeading.pageNumber && first.start < firstHeading.start));
      }).map(item => item.paragraphId);
      if (preambleParagraphIds.length) {
        sections.push({ sectionId: `pdf-section:${fnv64(`${documentHash}:${revision}:preamble`)}`,
          level: 1, source: 'implicit-preamble', headingId: null,
          parentSectionId: null, childSectionIds: [], paragraphIds: preambleParagraphIds,
          ranges: documentRanges(pages, documentStart,
            { pageNumber: firstHeading.pageNumber, offset: firstHeading.start }) });
      }
      for (let index = 0; index < headings.length; index += 1) {
        const heading = headings[index];
        const next = headings[index + 1];
        const nextPeer = headings.slice(index + 1).find(item => item.level <= heading.level);
        const paragraphIds = paragraphs.filter(paragraph => {
          const first = paragraph.ranges[0];
          if (!first) return false;
          const after = first.pageNumber > heading.pageNumber ||
            (first.pageNumber === heading.pageNumber && first.start > heading.end);
          const beforeNext = !next || first.pageNumber < next.pageNumber ||
            (first.pageNumber === next.pageNumber && first.start < next.start);
          return after && beforeNext;
        }).map(item => item.paragraphId);
        sections.push({ sectionId: `pdf-section:${fnv64(`${documentHash}:${revision}:${heading.headingId}`)}`,
          level: heading.level, source: heading.source, headingId: heading.headingId,
          parentSectionId: null, childSectionIds: [], paragraphIds,
          ranges: documentRanges(pages,
            { pageNumber: heading.pageNumber, offset: heading.start },
            nextPeer ? { pageNumber: nextPeer.pageNumber, offset: nextPeer.start } : documentEnd) });
      }
      const stack = [];
      for (const section of sections.filter(item => item.headingId)) {
        while (stack.length && stack.at(-1).level >= section.level) stack.pop();
        const parent = stack.at(-1);
        if (parent) {
          section.parentSectionId = parent.sectionId;
          parent.childSectionIds.push(section.sectionId);
        }
        stack.push(section);
      }
    }
    const sectionByParagraph = new Map(sections.flatMap(section =>
      section.paragraphIds.map(paragraphId => [paragraphId, section.sectionId])));
    paragraphs.forEach(paragraph => { paragraph.sectionId = sectionByParagraph.get(paragraph.paragraphId) || null; });
    const result = {
      schemaVersion: SCHEMA_VERSION,
      algorithmVersion: PDF_SEMANTIC_INDEX_ALGORITHM_VERSION,
      cacheKey: pdfSemanticCacheKey({ documentHash, revision, pages,
        outline: Array.isArray(input.outline) ? input.outline : [] }),
      document: { documentId: `pdf-document:${documentHash}`, documentHash, revision,
        pageCount: pages.length, sectionIds: sections.map(item => item.sectionId) },
      mappings: pageMappings,
      sourceGeometry: pages.map(page=>({pageNumber:page.pageNumber,
        pageWidth:pageDimensions(page).width,pageHeight:pageDimensions(page).height,
        spans:(page.spans || []).filter(span=>Number.isSafeInteger(span.start) && Number.isSafeInteger(span.end))
          .map(span=>({start:span.start,end:span.end,rect:validRect(span.rect,page)}))})),
      headingDiagnostics: { outlineEntries: headingAnalysis.outlineEntries },
      layoutDiagnostics: { repeatedFurnitureRanges: [...furnitureByPage].flatMap(
        ([pageNumber, ranges]) => ranges.map(range => ({ pageNumber, ...range }))),
        normalizedLineWrapRanges: paragraphs.flatMap(paragraph => paragraph.normalizationOmissions),
        floatingCaptionGaps, floatingTableGaps, figurePageContinuations,
        referenceRanges,referenceEntries:referenceResult.diagnostics },
      sections, headings, paragraphs, sentences, spans,
      geometryPolicy: { missing: 'page-paragraph-fallback', fabricatedQuads: false }
    };
    result.provenanceKey = pdfSemanticProvenanceKey(result);
    return deepFreeze(result);
  }

  return { SCHEMA_VERSION, PDF_SEMANTIC_INDEX_ALGORITHM_VERSION, buildPdfSemanticIndex, normalizePdfTextWithOffsets,
    pdfSemanticCacheKey, rawRangeToNormalized, normalizedRangeToRaw, splitSentenceRanges,
    pdfSemanticProvenanceKey, pdfSemanticParagraphId, isPdfCompoundWrapPrefix,
    pdfColumnContinuationEvidence: columnContinuationEvidence,
    pdfFlowFurnitureRangeIsValid: flowFurnitureRangeIsValid,
    pdfFloatingTableEvidence: floatingTableEvidence,
    pdfAlignedCaptionEvidence: alignedCaptionEvidence,
    pdfFigureOnlyPageEvidence: figureOnlyPageEvidence,
    pdfCrossPageContinuationEvidence: crossPageContinuationEvidence,
    segmentPdfReferenceEntries,
    segmentPdfGraphemes: dependency.segmentPdfGraphemes,
    validatePdfQuadPoints, pdfHeadingTitleFragments };
});
