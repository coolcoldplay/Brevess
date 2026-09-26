const test = require('node:test');
const assert = require('node:assert/strict');
const { planFigureImageTiles } = require('../core/figure-image-tiles.js');

function assertValidPlan(plan, sourceWidth, sourceHeight) {
  assert.ok(plan.length >= 1 && plan.length <= 4);
  plan.forEach(tile => {
    for (const value of [tile.x, tile.y, tile.width, tile.height]) {
      assert.equal(Number.isInteger(value), true);
    }
    assert.ok(tile.x >= 0 && tile.y >= 0 && tile.width > 0 && tile.height > 0);
    assert.ok(tile.x + tile.width <= sourceWidth && tile.y + tile.height <= sourceHeight);
    assert.ok(tile.width <= sourceWidth && tile.height <= sourceHeight);
    assert.deepEqual(Object.keys(tile), ['x', 'y', 'width', 'height', 'position']);
    assert.match(tile.position, /完整图|分区/);
    assert.match(tile.position, new RegExp(`x=${tile.x}–${tile.x + tile.width - 1}`));
    assert.match(tile.position, new RegExp(`y=${tile.y}–${tile.y + tile.height - 1}`));
  });
}

function assertEveryPixelCovered(plan, sourceWidth, sourceHeight) {
  const scale = Math.max(sourceWidth, sourceHeight) > 100
    ? 100 / Math.max(sourceWidth, sourceHeight) : 1;
  const width = Math.max(1, Math.ceil(sourceWidth * scale));
  const height = Math.max(1, Math.ceil(sourceHeight * scale));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(sourceWidth - 1, Math.floor(x / scale));
      const sourceY = Math.min(sourceHeight - 1, Math.floor(y / scale));
      assert.equal(plan.some(tile =>
        sourceX >= tile.x && sourceX < tile.x + tile.width &&
        sourceY >= tile.y && sourceY < tile.y + tile.height
      ), true, `uncovered source pixel ${sourceX},${sourceY}`);
    }
  }
}

function adjacentOverlap(first, second, axis) {
  return axis === 'horizontal'
    ? first.y + first.height - second.y
    : first.x + first.width - second.x;
}

test('keeps images at or below the 800-square pixel budget as one uncropped tile', () => {
  for (const [width, height] of [[800, 800], [400, 1200], [1, 1]]) {
    const plan = planFigureImageTiles(width, height);
    assert.deepEqual(plan.map(tile => [tile.x, tile.y, tile.width, tile.height]), [
      [0, 0, width, height]
    ]);
    assertValidPlan(plan, width, height);
    assertEveryPixelCovered(plan, width, height);
  }
});

test('plans the tall Cell Figure as four overlapping horizontal bands without losing edges', () => {
  const plan = planFigureImageTiles(2848, 4146);
  assert.equal(plan.length, 4);
  assert.deepEqual(plan.map(tile => tile.x), [0, 0, 0, 0]);
  assert.deepEqual(plan.map(tile => tile.width), [2848, 2848, 2848, 2848]);
  assert.equal(plan[0].y, 0);
  assert.equal(plan.at(-1).y + plan.at(-1).height, 4146);
  for (let index = 1; index < plan.length; index += 1) {
    const overlap = adjacentOverlap(plan[index - 1], plan[index], 'horizontal');
    assert.ok(overlap >= 102 && overlap <= 105, `unexpected overlap ${overlap}`);
  }
  assert.match(plan[0].position, /横向分区 1\/4（原图上部）/);
  assertValidPlan(plan, 2848, 4146);
  assertEveryPixelCovered(plan, 2848, 4146);
});

test('plans a wide Figure as four overlapping vertical bands in reading order', () => {
  const plan = planFigureImageTiles(4200, 1800);
  assert.equal(plan.length, 4);
  assert.deepEqual(plan.map(tile => tile.y), [0, 0, 0, 0]);
  assert.deepEqual(plan.map(tile => tile.height), [1800, 1800, 1800, 1800]);
  assert.equal(plan[0].x, 0);
  assert.equal(plan.at(-1).x + plan.at(-1).width, 4200);
  for (let index = 1; index < plan.length; index += 1) {
    const overlap = adjacentOverlap(plan[index - 1], plan[index], 'vertical');
    assert.ok(overlap >= 104 && overlap <= 106, `unexpected overlap ${overlap}`);
  }
  assert.match(plan[0].position, /纵向分区 1\/4（原图左侧）/);
  assertValidPlan(plan, 4200, 1800);
  assertEveryPixelCovered(plan, 4200, 1800);
});

test('plans the near-square Cell Figure as a row-major overlapping 2x2 grid', () => {
  const plan = planFigureImageTiles(3370, 3740);
  assert.equal(plan.length, 4);
  assert.deepEqual(plan.map(tile => tile.position.match(/2×2 分区：(左上|右上|左下|右下)/)?.[1]), [
    '左上', '右上', '左下', '右下'
  ]);
  assert.equal(plan[0].x, 0);
  assert.equal(plan[0].y, 0);
  assert.equal(plan[1].x + plan[1].width, 3370);
  assert.equal(plan[2].y + plan[2].height, 3740);
  assert.equal(plan[3].x + plan[3].width, 3370);
  assert.equal(plan[3].y + plan[3].height, 3740);
  assert.ok(plan[0].x + plan[0].width - plan[1].x >= 168);
  assert.ok(plan[0].y + plan[0].height - plan[2].y >= 186);
  assertValidPlan(plan, 3370, 3740);
  assertEveryPixelCovered(plan, 3370, 3740);
});

test('honors bounded tile parameters without creating gaps or more than four crops', () => {
  const plan = planFigureImageTiles(2400, 1600, {
    maxTiles: 3,
    overlapRatio: 0.2,
    singleImageMaxPixels: 100,
    nearSquareRatio: 1.5
  });
  assert.equal(plan.length, 3);
  assert.match(plan[0].position, /纵向分区/);
  assertValidPlan(plan, 2400, 1600);
  assertEveryPixelCovered(plan, 2400, 1600);
});

test('rejects invalid dimensions and unbounded or unknown parameters', () => {
  for (const dimensions of [[0, 100], [100.5, 100], [Infinity, 100], [100001, 100]]) {
    assert.throws(() => planFigureImageTiles(...dimensions), RangeError);
  }
  assert.throws(() => planFigureImageTiles(1000, 1000, { maxTiles: 5 }), RangeError);
  assert.throws(() => planFigureImageTiles(1000, 1000, { overlapRatio: 0.5 }), RangeError);
  assert.throws(() => planFigureImageTiles(1000, 1000, { panelBounds: [] }), TypeError);
});

test('does not mutate caller options and returns an immutable plan', () => {
  const options = { maxTiles: 4, overlapRatio: 0.1 };
  const before = structuredClone(options);
  const plan = planFigureImageTiles(1200, 1200, options);
  assert.deepEqual(options, before);
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(plan.every(Object.isFrozen), true);
});
