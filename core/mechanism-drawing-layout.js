(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  'use strict';

  const WIDTH = 168, HEIGHT = 68, GAP_X = 112, GAP_Y = 100, MARGIN = 56, PAD = 20;
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const point = (x, y) => ({ x, y });
  const distance = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  const endpoints = edge => [edge.from || edge.source, edge.to || edge.target];
  const grow = (box, padding) => ({ x: box.x - padding, y: box.y - padding,
    width: box.width + padding * 2, height: box.height + padding * 2 });
  const overlaps = (a, b, padding = 0) => a.x < b.x + b.width + padding &&
    a.x + a.width > b.x - padding && a.y < b.y + b.height + padding && a.y + a.height > b.y - padding;
  const inside = (p, box) => p.x > box.x + .001 && p.x < box.x + box.width - .001 &&
    p.y > box.y + .001 && p.y < box.y + box.height - .001;

  function segmentHits(a, b, box) {
    if (Math.abs(a.y - b.y) < .001) return a.y > box.y + .001 && a.y < box.y + box.height - .001 &&
      Math.max(a.x, b.x) > box.x + .001 && Math.min(a.x, b.x) < box.x + box.width - .001;
    if (Math.abs(a.x - b.x) < .001) return a.x > box.x + .001 && a.x < box.x + box.width - .001 &&
      Math.max(a.y, b.y) > box.y + .001 && Math.min(a.y, b.y) < box.y + box.height - .001;
    return true;
  }

  function simplify(points) {
    const result = [];
    points.forEach(p => {
      const b = result[result.length - 1], a = result[result.length - 2];
      if (b && distance(b, p) < .001) return;
      if (a && ((a.x === b.x && b.x === p.x) || (a.y === b.y && b.y === p.y))) {
        // Keep a reversal: removing it could turn a valid detour into a shortcut.
        if ((b.x - a.x) * (p.x - b.x) >= 0 && (b.y - a.y) * (p.y - b.y) >= 0) result.pop();
      }
      result.push(point(p.x, p.y));
    });
    return result;
  }

  function graphParts(input) {
    const seen = new Set();
    const nodes = (Array.isArray(input.nodes) ? input.nodes : []).filter(node => {
      if (!node || typeof node.id !== 'string' || !node.id || seen.has(node.id)) return false;
      seen.add(node.id); return true;
    });
    const edges = (Array.isArray(input.edges) ? input.edges : []).filter(edge => edge &&
      typeof edge.id === 'string' && endpoints(edge).every(id => seen.has(id)));
    return { nodes, edges };
  }

  function nodeSize(node, saved) {
    return { width: finite(saved && saved.width) && saved.width > 0 ? saved.width :
      finite(node.width) && node.width > 0 ? node.width : WIDTH,
    height: finite(saved && saved.height) && saved.height > 0 ? saved.height :
      finite(node.height) && node.height > 0 ? node.height : HEIGHT };
  }

  /** Compute only missing coordinates. Existing finite coordinates are never rearranged. */
  function computeMechanismDrawingLayout(input = {}) {
    const { nodes, edges } = graphParts(input), saved = input.positions || {};
    const positions = Object.create(null), adjacency = new Map(nodes.map(node => [node.id, []]));
    edges.forEach(edge => { const [from, to] = endpoints(edge); if (from !== to) adjacency.get(from).push(to); });
    const order = new Map(nodes.map((node, index) => [node.id, index]));
    const indices = new Map(), low = new Map(), stack = [], stacked = new Set(), components = [];
    let serial = 0;
    function visit(id) {
      indices.set(id, serial); low.set(id, serial++); stack.push(id); stacked.add(id);
      adjacency.get(id).forEach(next => {
        if (!indices.has(next)) { visit(next); low.set(id, Math.min(low.get(id), low.get(next))); }
        else if (stacked.has(next)) low.set(id, Math.min(low.get(id), indices.get(next)));
      });
      if (indices.get(id) === low.get(id)) {
        const component = []; let current;
        do { current = stack.pop(); stacked.delete(current); component.push(current); } while (current !== id);
        components.push(component.sort((a, b) => order.get(a) - order.get(b)));
      }
    }
    nodes.forEach(node => { if (!indices.has(node.id)) visit(node.id); });
    components.sort((a, b) => order.get(a[0]) - order.get(b[0]));
    const componentOf = new Map(); components.forEach((component, i) => component.forEach(id => componentOf.set(id, i)));
    const forward = components.map(() => new Set()), indegree = components.map(() => 0), ranks = components.map(() => 0);
    edges.forEach(edge => {
      const [from, to] = endpoints(edge), a = componentOf.get(from), b = componentOf.get(to);
      if (a !== b && !forward[a].has(b)) { forward[a].add(b); indegree[b]++; }
    });
    const queue = components.map((_, i) => i).filter(i => !indegree[i]);
    while (queue.length) {
      const current = queue.shift();
      forward[current].forEach(next => {
        ranks[next] = Math.max(ranks[next], ranks[current] + components[current].length);
        if (--indegree[next] === 0) { queue.push(next); queue.sort((a, b) => a - b); }
      });
    }
    const layers = new Map();
    components.forEach((component, i) => component.forEach((id, offset) => {
      const rank = ranks[i] + offset;
      if (!layers.has(rank)) layers.set(rank, []);
      layers.get(rank).push(id);
    }));
    const occupancy = [];
    nodes.forEach(node => {
      const current = Object.prototype.hasOwnProperty.call(saved, node.id) ? saved[node.id] : null;
      if (current && finite(current.x) && finite(current.y)) {
        positions[node.id] = Object.assign({}, current, nodeSize(node, current));
        occupancy.push(positions[node.id]);
      }
    });
    const columns = Math.max(2, Math.min(5, Math.floor(((finite(input.width) ? input.width : 1120) - MARGIN * 2 + GAP_X) / (WIDTH + GAP_X))));
    const maxRank = layers.size ? Math.max(...layers.keys()) : 0;
    let bandY = MARGIN;
    for (let band = 0; band <= Math.floor(maxRank / columns); band++) {
      let bandRows = 1;
      for (let column = 0; column < columns; column++) bandRows = Math.max(bandRows, (layers.get(band * columns + column) || []).length);
      for (let column = 0; column < columns; column++) {
        const ids = layers.get(band * columns + column) || [];
        ids.sort((a, b) => order.get(a) - order.get(b));
        ids.forEach((id, row) => {
          if (positions[id]) return;
          const node = nodes[order.get(id)], size = nodeSize(node);
          // Serpentine bands keep long backbones local instead of shrinking text to fit.
          const x = MARGIN + (band % 2 ? columns - column - 1 : column) * (WIDTH + GAP_X);
          let candidate = { x, y: bandY + row * (HEIGHT + GAP_Y), ...size };
          while (occupancy.some(box => overlaps(candidate, box, 24))) candidate.y += HEIGHT + GAP_Y;
          positions[id] = candidate; occupancy.push(candidate);
        });
      }
      bandY += bandRows * (HEIGHT + GAP_Y) + GAP_Y;
    }
    return positions;
  }

  function ports(box, offset) {
    const horizontalOffset = Math.max(-box.width / 3, Math.min(box.width / 3, offset));
    const verticalOffset = Math.max(-box.height / 3, Math.min(box.height / 3, offset));
    const cx = box.x + box.width / 2 + horizontalOffset, cy = box.y + box.height / 2 + verticalOffset;
    return [
      { side: 'left', dir: 0, p: point(box.x, cy), out: point(box.x - PAD, cy) },
      { side: 'right', dir: 0, p: point(box.x + box.width, cy), out: point(box.x + box.width + PAD, cy) },
      { side: 'top', dir: 1, p: point(cx, box.y), out: point(cx, box.y - PAD) },
      { side: 'bottom', dir: 1, p: point(cx, box.y + box.height), out: point(cx, box.y + box.height + PAD) }
    ];
  }

  function routePenalty(points, used) {
    let score = (points.length - 2) * 24;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], horizontal = a.y === b.y;
      score += distance(a, b);
      used.forEach(([c, d]) => {
        const oldHorizontal = c.y === d.y;
        if (horizontal === oldHorizontal && Math.abs(horizontal ? a.y - c.y : a.x - c.x) < 9) {
          const lo = Math.max(Math.min(horizontal ? a.x : a.y, horizontal ? b.x : b.y), Math.min(horizontal ? c.x : c.y, horizontal ? d.x : d.y));
          const hi = Math.min(Math.max(horizontal ? a.x : a.y, horizontal ? b.x : b.y), Math.max(horizontal ? c.x : c.y, horizontal ? d.x : d.y));
          score += Math.max(0, hi - lo) * 2.5;
        } else if (horizontal !== oldHorizontal) {
          const h1 = horizontal ? a : c, h2 = horizontal ? b : d, v1 = horizontal ? c : a, v2 = horizontal ? d : b;
          if (v1.x > Math.min(h1.x, h2.x) && v1.x < Math.max(h1.x, h2.x) && h1.y > Math.min(v1.y, v2.y) && h1.y < Math.max(v1.y, v2.y)) score += 120;
        }
      });
    }
    return score;
  }

  // Used only when simple elbow/corridor candidates are blocked. A* visits a
  // sparse coordinate grid of obstacle boundaries, not a viewport-sized bitmap.
  function searchPath(start, end, obstacles, bounds) {
    const xs = new Set([start.x, end.x, bounds.left, bounds.right]);
    const ys = new Set([start.y, end.y, bounds.top, bounds.bottom]);
    obstacles.forEach(box => { xs.add(box.x); xs.add(box.x + box.width); ys.add(box.y); ys.add(box.y + box.height); });
    const xv = [...xs].sort((a, b) => a - b), yv = [...ys].sort((a, b) => a - b), nx = xv.length;
    const startId = yv.indexOf(start.y) * nx + xv.indexOf(start.x), endId = yv.indexOf(end.y) * nx + xv.indexOf(end.x);
    const p = id => point(xv[id % nx], yv[Math.floor(id / nx)]);
    const costs = new Float64Array(nx * yv.length * 2).fill(Infinity), previous = new Int32Array(costs.length).fill(-1);
    const heap = [], validity = new Map(), connections = new Map();
    function push(item) { let i = heap.length; heap.push(item); while (i) { const parent = (i - 1) >> 1; if (heap[parent].score <= item.score) break; heap[i] = heap[parent]; i = parent; } heap[i] = item; }
    function pop() { const first = heap[0], last = heap.pop(); if (heap.length) { let i = 0; while (i * 2 + 1 < heap.length) { let child = i * 2 + 1; if (child + 1 < heap.length && heap[child + 1].score < heap[child].score) child++; if (heap[child].score >= last.score) break; heap[i] = heap[child]; i = child; } heap[i] = last; } return first; }
    function valid(id) { if (!validity.has(id)) validity.set(id, !obstacles.some(box => inside(p(id), box))); return validity.get(id); }
    for (let dir = 0; dir < 2; dir++) { costs[startId * 2 + dir] = 0; push({ key: startId * 2 + dir, cost: 0, score: distance(start, end) }); }
    let winner = -1;
    while (heap.length) {
      const current = pop(), id = current.key >> 1, dir = current.key % 2;
      if (current.cost !== costs[current.key]) continue;
      if (id === endId) { winner = current.key; break; }
      const ix = id % nx, iy = Math.floor(id / nx), here = p(id);
      [[ix ? id - 1 : -1, 0], [ix + 1 < nx ? id + 1 : -1, 0], [iy ? id - nx : -1, 1], [iy + 1 < yv.length ? id + nx : -1, 1]].forEach(([next, nextDir]) => {
        if (next < 0 || !valid(next)) return;
        const key = Math.min(id, next) + ':' + Math.max(id, next), there = p(next);
        if (!connections.has(key)) connections.set(key, !obstacles.some(box => segmentHits(here, there, box)));
        if (!connections.get(key)) return;
        const target = next * 2 + nextDir, cost = current.cost + distance(here, there) + (dir === nextDir ? 0 : 24);
        if (cost >= costs[target]) return;
        costs[target] = cost; previous[target] = current.key; push({ key: target, cost, score: cost + distance(there, end) });
      });
    }
    if (winner < 0) return null;
    const result = []; for (let key = winner; key >= 0; key = previous[key]) result.push(p(key >> 1));
    return simplify(result.reverse());
  }

  function edgeText(edge) { return typeof edge.label === 'string' ? edge.label : edge.label && typeof edge.label.value === 'string' ? edge.label.value : ''; }

  function placeLabel(route, edge, boxes, occupied, routes) {
    const evidenceCount = (Array.isArray(edge.evidence) ? edge.evidence : Array.isArray(edge.panelEvidence) ? edge.panelEvidence : []).length;
    const width = finite(edge.labelWidth) && edge.labelWidth > 0 ? edge.labelWidth : Math.min(228, Math.max(88, Array.from(edgeText(edge)).reduce((sum, c) => sum + (c.charCodeAt(0) > 255 ? 13 : 7), 20)));
    const height = finite(edge.labelHeight) && edge.labelHeight > 0 ? edge.labelHeight : 26 + (evidenceCount ? Math.min(3, Math.ceil(evidenceCount / 3)) * 22 : 0);
    const candidates = [];
    function propose(anchor, dx, dy) {
      const center = point(anchor.x + dx, anchor.y + dy), box = { x: center.x - width / 2, y: center.y - height / 2, width, height };
      if (boxes.some(node => overlaps(box, node, 12)) || occupied.some(other => overlaps(box, other, 12))) return;
      if ((dx || dy) && boxes.some(node => segmentHits(anchor, center, grow(node, 5)))) return;
      let crossings = 0;
      routes.forEach(other => { if (other === route) return; for (let i = 1; i < other.points.length; i++) if (segmentHits(other.points[i - 1], other.points[i], grow(box, 3))) crossings++; });
      candidates.push({ center, box, anchor, score: Math.abs(dx) + Math.abs(dy) + crossings * 400 });
    }
    for (let i = 1; i < route.points.length; i++) {
      const a = route.points[i - 1], b = route.points[i], horizontal = a.y === b.y;
      [.5, .3, .7].forEach(t => {
        const anchor = point(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
        [0, 1, -1, 2, -2].forEach(step => {
          const offset = step ? Math.sign(step) * ((horizontal ? height : width) / 2 + 18 + (Math.abs(step) - 1) * 40) : 0;
          propose(anchor, horizontal ? 0 : offset, horizontal ? offset : 0);
        });
      });
    }
    const anchor = route.points.length ? route.points[Math.floor(route.points.length / 2)] : point(0, 0);
    if (!candidates.length) for (let ring = 1; ring < 80 && !candidates.length; ring++) {
      [[ring * (width + 24), 0], [-ring * (width + 24), 0], [0, ring * (height + 24)], [0, -ring * (height + 24)]].forEach(([dx, dy]) => propose(anchor, dx, dy));
    }
    // Overlapping manual nodes may obstruct every leader. Keep the label visible
    // outside the graph and mark it detached instead of placing it on a node.
    if (!candidates.length) {
      const right = Math.max(0, ...boxes.map(box => box.x + box.width));
      let box = { x: right + 48, y: occupied.length * (height + 24), width, height };
      while (occupied.some(other => overlaps(box, other, 12))) box.y += height + 24;
      candidates.push({ center: point(box.x + width / 2, box.y + height / 2), box, anchor, score: Infinity, detached: true });
    }
    const chosen = candidates.sort((a, b) => a.score - b.score)[0];
    route.label = { ...chosen.center, width, height };
    route.labelBox = chosen.box; route.labelAnchor = chosen.anchor; route.labelDetached = !!chosen.detached;
    occupied.push(chosen.box);
  }

  /** Routes all graph edges; callers filter the result for story visibility. */
  function routeMechanismDrawingEdges(input = {}) {
    const { nodes, edges } = graphParts(input), positions = computeMechanismDrawingLayout(input);
    const boxes = nodes.map(node => ({ ...positions[node.id], id: node.id })), byId = new Map(boxes.map(box => [box.id, box]));
    const obstacles = boxes.map(box => grow(box, PAD)), routes = [], used = [], pairs = new Map();
    edges.forEach(edge => { const key = JSON.stringify(endpoints(edge).slice().sort()); if (!pairs.has(key)) pairs.set(key, []); pairs.get(key).push(edge); });
    const bounds = { left: Math.min(0, ...boxes.map(box => box.x)) - 60, right: Math.max(0, ...boxes.map(box => box.x + box.width)) + 60,
      top: Math.min(0, ...boxes.map(box => box.y)) - 60, bottom: Math.max(0, ...boxes.map(box => box.y + box.height)) + 60 };
    edges.forEach(edge => {
      const [from, to] = endpoints(edge), a = byId.get(from), b = byId.get(to), group = pairs.get(JSON.stringify([from, to].sort()));
      const ordinal = group.indexOf(edge), offset = (ordinal - (group.length - 1) / 2) * Math.min(16, 36 / Math.max(1, group.length - 1));
      const startPorts = ports(a, offset).filter(port => !boxes.some(box => box.id !== from && segmentHits(port.p, port.out, grow(box, 4))));
      const endPorts = ports(b, offset).filter(port => !boxes.some(box => box.id !== to && segmentHits(port.p, port.out, grow(box, 4))));
      const choices = [];
      function accept(middle, start, end) {
        if (!middle || middle.some(p => !finite(p.x) || !finite(p.y) || obstacles.some(box => inside(p, box)))) return;
        for (let i = 1; i < middle.length; i++) if (obstacles.some(box => segmentHits(middle[i - 1], middle[i], box))) return;
        const points = simplify([start.p, ...middle, end.p]);
        if (from === to && points.length < 4) return;
        choices.push({ points, sourceSide: start.side, targetSide: end.side, score: routePenalty(points, used) });
      }
      const portPairs = [];
      startPorts.forEach(start => endPorts.forEach(end => {
        if (from === to && (start.side !== 'right' || end.side !== 'top')) return;
        portPairs.push({ start, end, score: distance(start.out, end.out) });
        const p = start.out, q = end.out, mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;
        [[p, point(q.x, p.y), q], [p, point(p.x, q.y), q],
          [p, point(mx, p.y), point(mx, q.y), q], [p, point(p.x, my), point(q.x, my), q],
          [p, point(p.x, bounds.top - ordinal * 18), point(q.x, bounds.top - ordinal * 18), q],
          [p, point(p.x, bounds.bottom + ordinal * 18), point(q.x, bounds.bottom + ordinal * 18), q],
          [p, point(bounds.left - ordinal * 18, p.y), point(bounds.left - ordinal * 18, q.y), q],
          [p, point(bounds.right + ordinal * 18, p.y), point(bounds.right + ordinal * 18, q.y), q]
        ].forEach(points => accept(simplify(points), start, end));
      }));
      if (!choices.length) {
        portPairs.sort((x, y) => x.score - y.score);
        for (const pair of portPairs) {
          accept(searchPath(pair.start.out, pair.end.out, obstacles, bounds), pair.start, pair.end);
          if (choices.length) break;
        }
      }
      const chosen = choices.sort((x, y) => x.score - y.score)[0];
      const route = chosen ? { edgeId: edge.id, points: chosen.points, sourceSide: chosen.sourceSide, targetSide: chosen.targetSide, blocked: false } :
        { edgeId: edge.id, points: [], blocked: true, reason: 'node-overlap-or-no-route' };
      route.path = route.points.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' ');
      for (let i = 1; i < route.points.length; i++) used.push([route.points[i - 1], route.points[i]]);
      routes.push(route);
    });
    const occupied = [];
    routes.forEach((route, i) => placeLabel(route, edges[i], boxes, occupied, routes));
    return routes;
  }

  return { computeMechanismDrawingLayout, routeMechanismDrawingEdges };
});
