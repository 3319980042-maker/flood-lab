/* Offline teaching routes on the bundled road geometry, not a navigation service. */
window.FloodRoadRouting = (() => {
  'use strict';
  const MAX_ACCESS_KM = .35;
  const vehicleClasses = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service', 'track']);
  const prohibited = new Set(['footway', 'pedestrian', 'steps', 'cycleway', 'path', 'platform', 'corridor', 'subway', 'rail', 'cable_car']);
  let graph, components, segments, waters, builtFrom, graphStats;
  const km = (a, b) => Math.hypot((a[0] - b[0]) * Math.cos((a[1] + b[1]) * Math.PI / 360) * 111.32, (a[1] - b[1]) * 110.574);
  const validPoint = p => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;
  const key = p => `${p[0].toFixed(6)},${p[1].toFixed(6)}`;
  const interpolate = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

  function build() {
    const data = window.FloodLocalGeoData;
    builtFrom = data;
    graph = new Map(); components = new Map(); segments = []; waters = [];
    for (const feature of data?.roads?.features || []) {
      const properties = feature.properties || {};
      // Walking paths, piers, railway and roads under construction are not vehicle routes.
      if (!vehicleClasses.has(properties.class) || prohibited.has(properties.subclass)) continue;
      const geometry = feature.geometry || {};
      const lines = geometry.type === 'MultiLineString' ? geometry.coordinates : geometry.type === 'LineString' ? [geometry.coordinates] : [];
      for (const line of lines) for (let index = 1; index < line.length; index++) {
        const a = line[index - 1], b = line[index];
        if (!validPoint(a) || !validPoint(b)) continue;
        const ka = key(a), kb = key(b);
        if (ka === kb) continue;
        if (!graph.has(ka)) graph.set(ka, { p: a.slice(0, 2), edges: [] });
        if (!graph.has(kb)) graph.set(kb, { p: b.slice(0, 2), edges: [] });
        const length = km(a, b);
        graph.get(ka).edges.push([kb, length]); graph.get(kb).edges.push([ka, length]);
        segments.push({ id: segments.length, a, b, ka, kb, length });
      }
    }
    let component = 0;
    const sizes = [];
    for (const id of graph.keys()) {
      if (components.has(id)) continue;
      const pending = [id]; components.set(id, component);
      for (let index = 0; index < pending.length; index++) for (const [next] of graph.get(pending[index]).edges) {
        if (components.has(next)) continue;
        components.set(next, component); pending.push(next);
      }
      sizes.push(pending.length); component++;
    }
    segments.forEach(segment => { segment.component = components.get(segment.ka); });
    for (const feature of data?.water?.features || []) {
      const geometry = feature.geometry || {};
      const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
      for (const rings of polygons) {
        if (!rings.length || !rings[0].length) continue;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        rings[0].forEach(p => { minX = Math.min(minX, p[0]); minY = Math.min(minY, p[1]); maxX = Math.max(maxX, p[0]); maxY = Math.max(maxY, p[1]); });
        waters.push({ rings, minX, minY, maxX, maxY });
      }
    }
    graphStats = { vertices: graph.size, roadSegments: segments.length, components: component, largestComponent: Math.max(0, ...sizes), maxAccessMeters: MAX_ACCESS_KM * 1000, vehicleOnly: true };
  }
  function ensureGraph() { if (!graph || builtFrom !== window.FloodLocalGeoData) build(); }

  function insideRing(p, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  }
  const insideWater = (p, polygon) => insideRing(p, polygon.rings[0]) && !polygon.rings.slice(1).some(ring => insideRing(p, ring));
  function intersectionParameter(a, b, c, d) {
    const rx = b[0] - a[0], ry = b[1] - a[1], sx = d[0] - c[0], sy = d[1] - c[1];
    const determinant = rx * sy - ry * sx;
    if (Math.abs(determinant) < 1e-18) return null;
    const t = ((c[0] - a[0]) * sy - (c[1] - a[1]) * sx) / determinant;
    const u = ((c[0] - a[0]) * ry - (c[1] - a[1]) * rx) / determinant;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null;
  }
  function accessCrossesWater(a, b) {
    // A point already on a recorded bridge road needs no invented water crossing.
    if (km(a, b) < .000001) return false;
    const minX = Math.min(a[0], b[0]), maxX = Math.max(a[0], b[0]), minY = Math.min(a[1], b[1]), maxY = Math.max(a[1], b[1]);
    for (const water of waters) {
      if (maxX < water.minX || minX > water.maxX || maxY < water.minY || minY > water.maxY) continue;
      if (insideWater(a, water) || insideWater(b, water)) return true;
      const cuts = [0, 1];
      for (const ring of water.rings) for (let index = 1; index < ring.length; index++) {
        const t = intersectionParameter(a, b, ring[index - 1], ring[index]);
        if (t !== null) cuts.push(t);
      }
      cuts.sort((x, y) => x - y);
      for (let index = 1; index < cuts.length; index++) {
        if (cuts[index] - cuts[index - 1] > 1e-10 && insideWater(interpolate(a, b, (cuts[index] + cuts[index - 1]) / 2), water)) return true;
      }
    }
    return false;
  }
  function projection(p, segment) {
    const xScale = Math.cos(p[1] * Math.PI / 180) * 111.32;
    const dx = (segment.b[0] - segment.a[0]) * xScale, dy = (segment.b[1] - segment.a[1]) * 110.574;
    const x = (p[0] - segment.a[0]) * xScale, y = (p[1] - segment.a[1]) * 110.574;
    const t = Math.max(0, Math.min(1, (x * dx + y * dy) / (dx * dx + dy * dy)));
    const point = interpolate(segment.a, segment.b, t);
    return { segment, t, point, d: km(p, point), component: segment.component };
  }
  function nearestPerComponent(p) {
    const candidates = new Map();
    // Dense disconnected courtyards can fill a global nearest-18-vertices list.
    // Keep a nearby feasible road segment for each component instead.
    const projected = segments.map(segment => projection(p, segment)).filter(item => item.d <= MAX_ACCESS_KM).sort((a, b) => a.d - b.d);
    for (const candidate of projected) {
      if (!candidates.has(candidate.component) && !accessCrossesWater(p, candidate.point)) candidates.set(candidate.component, candidate);
    }
    return candidates;
  }
  function push(heap, item) {
    heap.push(item); let index = heap.length - 1;
    while (index) { const parent = (index - 1) >> 1; if (heap[parent][0] <= item[0]) break; heap[index] = heap[parent]; index = parent; }
    heap[index] = item;
  }
  function pop(heap) {
    const first = heap[0], last = heap.pop();
    if (heap.length) {
      let index = 0;
      while (index * 2 + 1 < heap.length) {
        let child = index * 2 + 1;
        if (child + 1 < heap.length && heap[child + 1][0] < heap[child][0]) child++;
        if (last[0] <= heap[child][0]) break;
        heap[index] = heap[child]; index = child;
      }
      heap[index] = last;
    }
    return first;
  }
  function roadPath(start, end) {
    if (start.segment.id === end.segment.id) return { coordinates: [start.point, end.point], distance: Math.abs(start.t - end.t) * start.segment.length };
    const dist = new Map(), prev = new Map(), heap = [];
    for (const [id, cost] of [[start.segment.ka, start.t * start.segment.length], [start.segment.kb, (1 - start.t) * start.segment.length]]) {
      if (cost < (dist.get(id) ?? Infinity)) { dist.set(id, cost); prev.set(id, null); push(heap, [cost, id]); }
    }
    const goals = new Map([[end.segment.ka, end.t * end.segment.length], [end.segment.kb, (1 - end.t) * end.segment.length]]);
    let best = Infinity, goal;
    while (heap.length) {
      const [cost, id] = pop(heap);
      if (cost !== dist.get(id)) continue;
      if (cost > best) break;
      if (goals.has(id) && cost + goals.get(id) < best) { best = cost + goals.get(id); goal = id; }
      for (const [next, weight] of graph.get(id).edges) {
        const value = cost + weight;
        if (value < (dist.get(next) ?? Infinity)) { dist.set(next, value); prev.set(next, id); push(heap, [value, next]); }
      }
    }
    if (!goal) return null;
    const ids = [];
    for (let current = goal; current !== null; current = prev.get(current)) ids.push(current);
    ids.reverse();
    return { coordinates: [start.point, ...ids.map(id => graph.get(id).p), end.point], distance: best };
  }
  function find(from, to) {
    if (!validPoint(from) || !validPoint(to)) return null;
    ensureGraph();
    if (!graph.size) return null;
    const a = nearestPerComponent(from), b = nearestPerComponent(to);
    let pair;
    for (const [component, start] of a) {
      const end = b.get(component);
      if (end && (!pair || start.d + end.d < pair.start.d + pair.end.d)) pair = { start, end };
    }
    if (!pair) return null;
    const { start, end } = pair;
    const path = roadPath(start, end);
    if (!path) return null;
    const coordinates = [from.slice(0, 2), ...path.coordinates, to.slice(0, 2)].filter((point, index, all) => !index || km(point, all[index - 1]) > .000001);
    if (coordinates.length === 1) coordinates.push(coordinates[0].slice());
    const distanceKm = path.distance + start.d + end.d;
    return { coordinates, distanceKm: Math.round(distanceKm * 100) / 100, minutes: Math.max(1, Math.ceil(distanceKm / 25 * 60)), accessMeters: { from: Math.round(start.d * 1000), to: Math.round(end.d * 1000) }, source: '离线公开机动车道路几何；接入段估算并避开已收录水体；双向行驶、25 km/h 为教学简化，未经实际导航验证' };
  }
  return { find, stats: () => { ensureGraph(); return { ...graphStats }; } };
})();
