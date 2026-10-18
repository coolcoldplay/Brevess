'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const M = require('../workbench/model.js');
const R = require('../workbench/routing.js');

function node(id, x, y, w = 190, h = 82) {
  return { id, label: id, x, y, w, h };
}

test('portForPoint maps a pointer to any node side and persists a clamped offset', () => {
  const value = { x: 100, y: 50, w: 200, h: 100 };
  assert.deepEqual(M.portForPoint(value, { x: 100, y: 100 }), { side: 'left', offset: 0.5 });
  assert.deepEqual(M.portForPoint(value, { x: 300, y: 75 }), { side: 'right', offset: 0.25 });
  assert.deepEqual(M.portForPoint(value, { x: 150, y: 50 }), { side: 'top', offset: 0.25 });
  assert.deepEqual(M.portForPoint(value, { x: 250, y: 150 }), { side: 'bottom', offset: 0.75 });
  assert.deepEqual(M.portForPoint(value, { x: -10, y: 200 }), { side: 'bottom', offset: 0 });
  assert.deepEqual(M.portForPoint(value, { x: 400, y: -10 }), { side: 'top', offset: 1 });
});

test('branch and feedback routes stay orthogonal, clear of nodes, deterministic and bounded in bends', () => {
  const nodes = [
    node('upstream', 0, 0),
    node('main', 340, 0),
    node('response', 680, 0),
    node('branch', 340, 250)
  ];
  const edges = [
    { id: 'main-1', source: 'upstream', target: 'main', kind: 'main', claim: '主线' },
    { id: 'main-2', source: 'main', target: 'response', kind: 'main', claim: '主线' },
    { id: 'branch-1', source: 'upstream', target: 'branch', kind: 'branch', claim: '条件分支' },
    { id: 'branch-2', source: 'branch', target: 'response', kind: 'branch', claim: '旁路驱动' },
    { id: 'feedback', source: 'response', target: 'main', kind: 'feedback', claim: '反馈' }
  ];
  const routes = R.routeAll(nodes, edges);
  for (const edge of edges) {
    const route = routes[edge.id];
    assert.equal(route.blocked, false, `${edge.id} blocked`);
    assert.equal(R.orthogonal(route.points), true, `${edge.id} has a diagonal segment`);
    assert.ok(R.turnCount(route.points) <= 6, `${edge.id} has too many turns`);
    for (const segment of R.segments(route.points)) {
      for (const object of nodes) {
        assert.equal(R.segmentHits(segment[0], segment[1], M.rect(object)), false, `${edge.id} crosses ${object.id}`);
      }
    }
  }
  const reversed = R.routeAll(nodes, [...edges].reverse());
  assert.deepEqual(reversed, routes);
});
