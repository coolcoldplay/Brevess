(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const DEFAULT_OPTIONS = Object.freeze({
    maxTiles: 4,
    overlapRatio: 0.1,
    singleImageMaxPixels: 800 * 800,
    nearSquareRatio: 1.25
  });
  const OPTION_KEYS = new Set(Object.keys(DEFAULT_OPTIONS));

  function positiveInteger(value, name, maximum) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 1 || number > maximum) {
      throw new RangeError(`${name} must be an integer from 1 to ${maximum}`);
    }
    return number;
  }

  function finiteNumber(value, name, minimum, maximum) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < minimum || number > maximum) {
      throw new RangeError(`${name} must be between ${minimum} and ${maximum}`);
    }
    return number;
  }

  function normalizeOptions(options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError('Figure tile options must be an object');
    }
    for (const key of Object.keys(options)) {
      if (!OPTION_KEYS.has(key)) throw new TypeError(`Unknown Figure tile option: ${key}`);
    }
    return {
      maxTiles: positiveInteger(options.maxTiles ?? DEFAULT_OPTIONS.maxTiles, 'maxTiles', 4),
      overlapRatio: finiteNumber(
        options.overlapRatio ?? DEFAULT_OPTIONS.overlapRatio,
        'overlapRatio', 0, 0.25
      ),
      singleImageMaxPixels: positiveInteger(
        options.singleImageMaxPixels ?? DEFAULT_OPTIONS.singleImageMaxPixels,
        'singleImageMaxPixels', 1000000000
      ),
      nearSquareRatio: finiteNumber(
        options.nearSquareRatio ?? DEFAULT_OPTIONS.nearSquareRatio,
        'nearSquareRatio', 1, 2
      )
    };
  }

  function overlappingSegments(length, count, overlapRatio) {
    const segmentCount = Math.min(count, length);
    const boundaries = Array.from({ length: segmentCount + 1 }, (_, index) =>
      Math.round(index * length / segmentCount));
    const nominalSize = length / segmentCount;
    const overlap = Math.min(
      Math.max(0, Math.round(nominalSize * overlapRatio)),
      Math.max(0, Math.floor(nominalSize) - 1)
    );
    const before = Math.floor(overlap / 2);
    const after = overlap - before;
    return Array.from({ length: segmentCount }, (_, index) => {
      const start = index === 0 ? 0 : Math.max(0, boundaries[index] - before);
      const end = index === segmentCount - 1
        ? length : Math.min(length, boundaries[index + 1] + after);
      return Object.freeze({ start, end, size: end - start });
    });
  }

  function bandLocation(index, count, axis) {
    if (index === 0) return axis === 'horizontal' ? '上部' : '左侧';
    if (index === count - 1) return axis === 'horizontal' ? '下部' : '右侧';
    return axis === 'horizontal' ? '中部' : '中间';
  }

  function tileRecord(x, y, width, height, description) {
    const right = x + width;
    const bottom = y + height;
    return Object.freeze({
      x,
      y,
      width,
      height,
      position: `${description}；原图像素范围 x=${x}–${right - 1}，` +
        `y=${y}–${bottom - 1}。仅描述该区域实际可见内容，并结合其在整图中的位置。`
    });
  }

  function fullImageTile(width, height) {
    return tileRecord(0, 0, width, height, '完整图（覆盖原图全部区域）');
  }

  function bandTiles(width, height, axis, count, overlapRatio) {
    const segments = overlappingSegments(
      axis === 'horizontal' ? height : width,
      count,
      overlapRatio
    );
    return segments.map((segment, index) => {
      const description = axis === 'horizontal'
        ? `横向分区 ${index + 1}/${segments.length}（原图${bandLocation(index, segments.length, axis)}）`
        : `纵向分区 ${index + 1}/${segments.length}（原图${bandLocation(index, segments.length, axis)}）`;
      return axis === 'horizontal'
        ? tileRecord(0, segment.start, width, segment.size, description)
        : tileRecord(segment.start, 0, segment.size, height, description);
    });
  }

  function gridTiles(width, height, overlapRatio) {
    const columns = overlappingSegments(width, 2, overlapRatio);
    const rows = overlappingSegments(height, 2, overlapRatio);
    const positions = [['左上', '右上'], ['左下', '右下']];
    const tiles = [];
    rows.forEach((row, rowIndex) => columns.forEach((column, columnIndex) => {
      tiles.push(tileRecord(
        column.start,
        row.start,
        column.size,
        row.size,
        `2×2 分区：${positions[rowIndex][columnIndex]}`
      ));
    }));
    return tiles;
  }

  function planFigureImageTiles(sourceWidth, sourceHeight, options = {}) {
    const width = positiveInteger(sourceWidth, 'sourceWidth', 100000);
    const height = positiveInteger(sourceHeight, 'sourceHeight', 100000);
    const normalized = normalizeOptions(options);
    const area = width * height;
    let tiles = [fullImageTile(width, height)];

    if (area > normalized.singleImageMaxPixels && normalized.maxTiles > 1) {
      const aspectRatio = Math.max(width, height) / Math.min(width, height);
      if (normalized.maxTiles === 4 && aspectRatio <= normalized.nearSquareRatio) {
        tiles = gridTiles(width, height, normalized.overlapRatio);
      } else {
        const axis = height > width ? 'horizontal' : 'vertical';
        tiles = bandTiles(
          width,
          height,
          axis,
          normalized.maxTiles,
          normalized.overlapRatio
        );
      }
    }

    return Object.freeze(tiles);
  }

  return { planFigureImageTiles };
});
