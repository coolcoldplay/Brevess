(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const MAX_PAGES = 10000;
  const MAX_ITEMS_PER_PAGE = 100000;
  const MAX_TEXT_LENGTH = 50000;
  const FONT_NAME = 'mineru-ocr-sans';
  const BASELINE_WARNING = 'MINERU_TEXT_BASELINE_UNAVAILABLE_BBOX_BOTTOM_APPROXIMATION';
  const FONT_WARNING = 'MINERU_FONT_METRICS_UNAVAILABLE_UNIFORM_SANS_SERIF';
  const TEXT_TYPES = new Set(['text', 'inline_equation']);

  function finitePositive(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
  }

  function normalizedText(value) {
    return typeof value === 'string'
      ? value.normalize('NFKC').replace(/[\u0000-\u001f\u007f]+/gu, ' ').trim()
        .slice(0, MAX_TEXT_LENGTH)
      : '';
  }

  function validBox(value, width, height) {
    if (!Array.isArray(value) || value.length !== 4) return null;
    const box = value.map(Number);
    if (!box.every(Number.isFinite)) return null;
    const [x0, y0, x1, y1] = box;
    if (x0 < 0 || y0 < 0 || x1 <= x0 || y1 <= y0 || x1 > width || y1 > height) {
      return null;
    }
    return box;
  }

  function boxKey(value) {
    return value.map(number => Number(number).toFixed(6)).join(':');
  }

  function extractPageItems(page, width, height) {
    const items = [];
    const seen = new Set();
    const lineIds = new Map();
    let lineIndex = 0;
    let droppedInvalidItems = 0;
    let droppedDuplicateItems = 0;

    function visitLines(lines) {
      if (!Array.isArray(lines)) return;
      for (const line of lines) {
        if (items.length >= MAX_ITEMS_PER_PAGE) break;
        const lineBBox = validBox(line?.bbox, width, height);
        if (!lineBBox || !Array.isArray(line?.spans)) {
          droppedInvalidItems += 1;
          continue;
        }
        const lineKey = boxKey(lineBBox);
        if (!lineIds.has(lineKey)) lineIds.set(lineKey, lineIndex++);
        const currentLine = lineIds.get(lineKey);
        line.spans.forEach((span, spanIndex) => {
          if (items.length >= MAX_ITEMS_PER_PAGE) return;
          const type = String(span?.type || '').trim().toLowerCase();
          const str = normalizedText(span?.content);
          const bbox = validBox(span?.bbox, width, height);
          if (!TEXT_TYPES.has(type) || !str || !bbox) {
            droppedInvalidItems += 1;
            return;
          }
          const key = `${type}\u0000${str}\u0000${boxKey(bbox)}`;
          if (seen.has(key)) {
            droppedDuplicateItems += 1;
            return;
          }
          seen.add(key);
          const score = Number(span?.score);
          items.push({
            str,
            bbox,
            lineBBox: [...lineBBox],
            type,
            score: Number.isFinite(score) ? score : null,
            lineIndex: currentLine,
            spanIndex,
            geometryAccuracy: 'bbox-only'
          });
        });
      }
    }

    function visitBlocks(blocks) {
      if (!Array.isArray(blocks)) return;
      for (const block of blocks) {
        if (!block || typeof block !== 'object' || items.length >= MAX_ITEMS_PER_PAGE) continue;
        visitLines(block.lines);
        visitBlocks(block.blocks);
      }
    }

    // para_blocks is MinerU's final reading-order tree. preproc_blocks duplicates it,
    // while discarded_blocks contains page furniture that must stay out of the index.
    visitBlocks(page?.para_blocks);
    items.sort((left, right) => left.lineIndex - right.lineIndex ||
      left.spanIndex - right.spanIndex);
    return {
      items,
      diagnostics: {
        droppedInvalidItems,
        droppedDuplicateItems,
        truncated: items.length >= MAX_ITEMS_PER_PAGE
      }
    };
  }

  function extractMineruLayoutTextPages(layout) {
    const pages = Array.isArray(layout?.pdf_info) ? layout.pdf_info.slice(0, MAX_PAGES) : [];
    const pageNumbers = new Set();
    const result = [];
    for (const page of pages) {
      const pageIndex = Number(page?.page_idx);
      const size = Array.isArray(page?.page_size) ? page.page_size.map(Number) : [];
      const width = finitePositive(size[0]);
      const height = finitePositive(size[1]);
      const pageNumber = Number.isSafeInteger(pageIndex) && pageIndex >= 0
        ? pageIndex + 1 : 0;
      if (!pageNumber || !width || !height || pageNumbers.has(pageNumber)) continue;
      pageNumbers.add(pageNumber);
      const extracted = extractPageItems(page, width, height);
      result.push({
        source: 'mineru-layout',
        pageNumber,
        width,
        height,
        items: extracted.items,
        warnings: [BASELINE_WARNING],
        diagnostics: extracted.diagnostics
      });
    }
    return result.sort((left, right) => left.pageNumber - right.pageNumber);
  }

  function normalizedPageView(input) {
    const view = Array.isArray(input) ? input : input?.view;
    if (!Array.isArray(view) || view.length !== 4) throw new Error('INVALID_PDF_PAGE_VIEW');
    const values = view.map(Number);
    if (!values.every(Number.isFinite) || values[2] <= values[0] || values[3] <= values[1]) {
      throw new Error('INVALID_PDF_PAGE_VIEW');
    }
    const suppliedRotation = Array.isArray(input) ? 0 : Number(input?.rotation ?? input?.rotate ?? 0);
    const rotation = ((suppliedRotation % 360) + 360) % 360;
    if (![0, 90, 180, 270].includes(rotation)) throw new Error('INVALID_PDF_PAGE_ROTATION');
    return { view: values, rotation };
  }

  function itemGeometry(item, page, pageView) {
    const [xMin, yMin, xMax, yMax] = pageView.view;
    const baseWidth = xMax - xMin;
    const baseHeight = yMax - yMin;
    const rotated = pageView.rotation === 90 || pageView.rotation === 270;
    const displayWidth = rotated ? baseHeight : baseWidth;
    const displayHeight = rotated ? baseWidth : baseHeight;
    const [x0, , x1, y1] = item.bbox;
    const y0 = item.bbox[1];
    const displayLeft = x0 / page.width * displayWidth;
    const displayBottom = y1 / page.height * displayHeight;
    const width = (x1 - x0) / page.width * displayWidth;
    const height = (y1 - y0) / page.height * displayHeight;
    let transform;
    if (pageView.rotation === 90) {
      transform = [0, height, -height, 0,
        xMin + displayBottom, yMin + displayLeft];
    } else if (pageView.rotation === 180) {
      transform = [-height, 0, 0, -height,
        xMax - displayLeft, yMin + displayBottom];
    } else if (pageView.rotation === 270) {
      transform = [0, -height, height, 0,
        xMax - displayBottom, yMax - displayLeft];
    } else {
      transform = [height, 0, 0, height,
        xMin + displayLeft, yMax - displayBottom];
    }
    return { width, height, transform };
  }

  function textDirection(value) {
    return /[\u0590-\u08ff]/u.test(value) ? 'rtl' : 'ltr';
  }

  function mineruPageToPdfTextContent(page, pageViewInput) {
    if (page?.source !== 'mineru-layout' || !Number.isSafeInteger(page?.pageNumber) ||
        !finitePositive(page?.width) || !finitePositive(page?.height) ||
        !Array.isArray(page?.items)) throw new Error('INVALID_MINERU_LAYOUT_PAGE');
    const pageView = normalizedPageView(pageViewInput);
    const items = page.items.flatMap((item, index) => {
      const bbox = validBox(item?.bbox, page.width, page.height);
      const str = normalizedText(item?.str);
      if (!bbox || !str) return [];
      const geometry = itemGeometry({ ...item, bbox }, page, pageView);
      const next = page.items[index + 1];
      return [{
        str,
        dir: textDirection(str),
        width: geometry.width,
        height: geometry.height,
        transform: geometry.transform,
        fontName: FONT_NAME,
        hasEOL: !next || next.lineIndex !== item.lineIndex
      }];
    });
    return {
      source: 'mineru-layout',
      pageNumber: page.pageNumber,
      items,
      styles: {
        [FONT_NAME]: {
          fontFamily: 'sans-serif',
          ascent: 1,
          descent: 0,
          vertical: false
        }
      },
      warnings: [BASELINE_WARNING, FONT_WARNING],
      geometryAccuracy: 'bbox-only-baseline-approximate',
      rotation: pageView.rotation,
      view: [...pageView.view]
    };
  }

  return {
    MINERU_OCR_BASELINE_WARNING: BASELINE_WARNING,
    MINERU_OCR_FONT_WARNING: FONT_WARNING,
    extractMineruLayoutTextPages,
    mineruPageToPdfTextContent
  };
});
