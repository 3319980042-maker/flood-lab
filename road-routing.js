/* Shared offline road geometry router. Speeds are explicit teaching assumptions. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FloodRoadNetwork = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const MAX_ACCESS_KM = .35;
  const vehicleClasses = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service', 'track']);
  const prohibited = new Set(['footway', 'pedestrian', 'steps', 'cycleway', 'path', 'platform', 'corridor', 'subway', 'rail', 'cable_car']);
  const km = (a, b) => Math.hypot((a[0] - b[0]) * Math.cos((a[1] + b[1]) * Math.PI / 360) * 111.32, (a[1] - b[1]) * 110.574);
  const validPoint = p => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;
  const key = p => `${p[0].toFixed(6)},${p[1].toFixed(6)}`;
  const interpolate = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const copyLine = line => line.map(point => point.slice(0, 2));
  const compactLine = line => line.filter((point, index) => !index || km(point, line[index - 1]) > .000001).map(point => point.slice(0, 2));

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

  function create(data) {
    const graph = new Map(), components = new Map(), segments = [], waters = [], accessCache = new Map();
    for (const feature of data?.roads?.features || []) {
      const properties = feature.properties || {};
      // A pedestrian path or railway is never silently promoted to a vehicle road.
      if (!vehicleClasses.has(properties.class) || prohibited.has(properties.subclass)) continue;
      const geometry = feature.geometry || {};
      const lines = geometry.type === 'MultiLineString' ? geometry.coordinates : geometry.type === 'LineString' ? [geometry.coordinates] : [];
      for (const line of lines) for (let index = 1; index < line.length; index++) {
        const rawA = line[index - 1], rawB = line[index];
        if (!validPoint(rawA) || !validPoint(rawB)) continue;
        const a = rawA.slice(0, 2), b = rawB.slice(0, 2), ka = key(a), kb = key(b);
        if (ka === kb) continue;
        if (!graph.has(ka)) graph.set(ka, { p: a, edges: [] });
        if (!graph.has(kb)) graph.set(kb, { p: b, edges: [] });
        const length = km(a, b), id = segments.length;
        graph.get(ka).edges.push([kb, length, id]); graph.get(kb).edges.push([ka, length, id]);
        segments.push({ id, a, b, ka, kb, length });
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
      for (const rawRings of polygons) {
        if (!rawRings.length || !rawRings[0].length) continue;
        const rings = rawRings.map(copyLine);
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        rings[0].forEach(p => { minX = Math.min(minX, p[0]); minY = Math.min(minY, p[1]); maxX = Math.max(maxX, p[0]); maxY = Math.max(maxY, p[1]); });
        waters.push({ rings, minX, minY, maxX, maxY });
      }
    }
    const graphStats = { vertices: graph.size, roadSegments: segments.length, components: component, largestComponent: Math.max(0, ...sizes), maxAccessMeters: MAX_ACCESS_KM * 1000, vehicleOnly: true };

    function accessCrossesWater(a, b) {
      // Existing bridges belong to the road graph; an access leg cannot invent one.
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
      const cacheKey = p.join(',');
      if (accessCache.has(cacheKey)) return accessCache.get(cacheKey);
      const candidates = new Map();
      // Choose baseline access independently of road closures. Never snap past a closure.
      const projected = segments.map(segment => projection(p, segment)).filter(item => item.d <= MAX_ACCESS_KM).sort((a, b) => a.d - b.d);
      for (const candidate of projected) {
        if (!candidates.has(candidate.component) && !accessCrossesWater(p, candidate.point)) candidates.set(candidate.component, candidate);
      }
      if (accessCache.size > 512) accessCache.clear();
      accessCache.set(cacheKey, candidates);
      return candidates;
    }
    function copyAccess(access) {
      if (!access) return null;
      return { segment: { ...access.segment, a: access.segment.a.slice(), b: access.segment.b.slice() }, segmentId: access.segment.id, t: access.t, point: access.point.slice(), d: access.d, component: access.component };
    }
    function snap(point) {
      if (!validPoint(point)) return null;
      const access = segments.map(segment => projection(point, segment)).filter(item => !accessCrossesWater(point, item.point)).sort((a, b) => a.d - b.d)[0];
      return copyAccess(access);
    }
    function snapToComponent(point, componentId) {
      if (!validPoint(point) || !Number.isInteger(componentId)) return null;
      return copyAccess(nearestPerComponent(point).get(componentId));
    }
    function resolveAccess(point, attachment) {
      const id = attachment?.segmentId ?? attachment?.segment?.id, t = attachment?.t;
      if (!Number.isInteger(id) || !Number.isFinite(t) || t < 0 || t > 1 || !segments[id]) return null;
      const segment = segments[id], p = interpolate(segment.a, segment.b, t), d = km(point, p);
      if (d > MAX_ACCESS_KM || accessCrossesWater(point, p)) return null;
      return { segment, t, point: p, d, component: segment.component };
    }
    function roadPath(start, end, conditions = {}) {
      const blocked = conditions.blocked || new Set(), limited = conditions.limited || new Set();
      const weight = (id, length) => length * (limited.has(id) ? 2 : 1);
      if (blocked.has(start.segment.id) || blocked.has(end.segment.id)) return null;
      if (start.segment.id === end.segment.id) {
        const distance = Math.abs(start.t - end.t) * start.segment.length;
        return { coordinates: [start.point, end.point], distance, weightedDistance: weight(start.segment.id, distance), segmentIds: [start.segment.id] };
      }
      const dist = new Map(), prev = new Map(), heap = [];
      for (const [id, cost] of [[start.segment.ka, start.t * start.segment.length], [start.segment.kb, (1 - start.t) * start.segment.length]]) {
        const value = weight(start.segment.id, cost);
        if (value < (dist.get(id) ?? Infinity)) { dist.set(id, value); prev.set(id, null); push(heap, [value, id]); }
      }
      const goals = new Map([[end.segment.ka, weight(end.segment.id, end.t * end.segment.length)], [end.segment.kb, weight(end.segment.id, (1 - end.t) * end.segment.length)]]);
      let best = Infinity, goal;
      while (heap.length) {
        const [cost, id] = pop(heap);
        if (cost !== dist.get(id)) continue;
        if (cost > best) break;
        if (goals.has(id) && cost + goals.get(id) < best) { best = cost + goals.get(id); goal = id; }
        for (const [next, length, segmentId] of graph.get(id).edges) {
          if (blocked.has(segmentId)) continue;
          const value = cost + weight(segmentId, length);
          if (value < (dist.get(next) ?? Infinity)) { dist.set(next, value); prev.set(next, { id, segmentId }); push(heap, [value, next]); }
        }
      }
      if (!goal) return null;
      const ids = [], segmentIds = [end.segment.id];
      for (let current = goal; current !== null;) {
        ids.push(current); const parent = prev.get(current);
        if (parent) segmentIds.push(parent.segmentId);
        current = parent ? parent.id : null;
      }
      ids.reverse();
      const coordinates = [start.point, ...ids.map(id => graph.get(id).p), end.point];
      segmentIds.push(start.segment.id);
      // Keep historical distance/minute rounding stable for saved real-lab experiments.
      return { coordinates, distance: coordinates.slice(1).reduce((sum, p, i) => sum + km(coordinates[i], p), 0), weightedDistance: best, segmentIds: [...new Set(segmentIds)] };
    }
    function routeResult(from, to, start, end, conditions) {
      if (start.component !== end.component) return null;
      const path = roadPath(start, end, conditions);
      if (!path) return null;
      const roadCoordinates = compactLine(path.coordinates);
      if (roadCoordinates.length === 1) roadCoordinates.push(roadCoordinates[0].slice());
      const coordinates = compactLine([from, ...path.coordinates, to]);
      if (coordinates.length === 1) coordinates.push(coordinates[0].slice());
      const accessDistanceKm = start.d + end.d, totalDistanceKm = path.distance + accessDistanceKm;
      const accessLegs = [
        { end: 'from', coordinates: [from.slice(0, 2), start.point.slice()], distanceKm: start.d },
        { end: 'to', coordinates: [end.point.slice(), to.slice(0, 2)], distanceKm: end.d }
      ];
      return {
        coordinates, roadCoordinates, accessLegs, segmentIds: path.segmentIds.slice(),
        roadDistanceKm: path.distance, accessDistanceKm, totalDistanceKm,
        weightedRoadDistanceKm: path.weightedDistance,
        distanceKm: Math.round(totalDistanceKm * 100) / 100,
        minutes: Math.max(1, Math.ceil((path.weightedDistance / 25 + accessDistanceKm / 5) * 60)),
        accessMeters: { from: Math.round(start.d * 1000), to: Math.round(end.d * 1000) },
        fromAccess: copyAccess(start), toAccess: copyAccess(end),
        source: '离线公开机动车道路几何；固定基线接入，不跨水体；道路双向25 km/h、限行减半、接入5 km/h为教学规则，非导航服务'
      };
    }
    function find(from, to, conditions = {}) {
      if (!validPoint(from) || !validPoint(to) || !graph.size) return null;
      const a = nearestPerComponent(from), b = nearestPerComponent(to);
      let pair;
      for (const [componentId, start] of a) {
        const end = b.get(componentId);
        if (end && (!pair || start.d + end.d < pair.start.d + pair.end.d)) pair = { start, end };
      }
      return pair ? routeResult(from, to, pair.start, pair.end, conditions) : null;
    }
    function findFixed(from, to, fromAccess, toAccess, conditions = {}) {
      if (!validPoint(from) || !validPoint(to)) return null;
      const start = resolveAccess(from, fromAccess), end = resolveAccess(to, toAccess);
      return start && end ? routeResult(from, to, start, end, conditions) : null;
    }
    function network() { return segments.map(segment => ({ id: segment.id, a: segment.a.slice(), b: segment.b.slice(), length: segment.length, component: segment.component })); }
    return { find, findFixed, network, snap, snapToComponent, stats: () => ({ ...graphStats }) };
  }
  return { create };
});

;
/* The classroom uses the same offline street graph in Node and the browser. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FloodClassroomNetwork = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const MODEL_ID = 'xuzhou-road-network-v1';
  const WORK_RADIUS_METERS = 60;
  const freeze = value => {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.values(value).forEach(freeze); Object.freeze(value);
    }
    return value;
  };
  const meters = (a, b) => Math.hypot((a[0] - b[0]) * Math.cos((a[1] + b[1]) * Math.PI / 360) * 111320, (a[1] - b[1]) * 110574);
  const mid = segment => [(segment.a[0] + segment.b[0]) / 2, (segment.a[1] + segment.b[1]) / 2];
  const pointKey = point => point.map(value => value.toFixed(6)).join(',');
  function distanceToSegment(point, segment) {
    const scale = Math.cos(point[1] * Math.PI / 180) * 111320;
    const dx = (segment.b[0] - segment.a[0]) * scale, dy = (segment.b[1] - segment.a[1]) * 110574;
    const x = (point[0] - segment.a[0]) * scale, y = (point[1] - segment.a[1]) * 110574;
    const t = Math.max(0, Math.min(1, (x * dx + y * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(x - t * dx, y - t * dy);
  }
  function midpointAlong(line) {
    if (!line?.length) return null;
    const lengths = line.slice(1).map((point, index) => meters(point, line[index]));
    let rest = lengths.reduce((sum, length) => sum + length, 0) / 2;
    for (let index = 0; index < lengths.length; index++) {
      if (rest <= lengths[index]) {
        const t = lengths[index] ? rest / lengths[index] : 0;
        return [line[index][0] + (line[index + 1][0] - line[index][0]) * t, line[index][1] + (line[index + 1][1] - line[index][1]) * t];
      }
      rest -= lengths[index];
    }
    return line.at(-1).slice();
  }
  function create({ router, points, nodes, edges, dataVersion = 'offline-local' }) {
    if (!router?.network || !router.findFixed || !router.snapToComponent) throw new Error('课堂需要支持固定道路接入口的真实路由器');
    const network = router.network(), segments = new Map(network.map(segment => [segment.id, segment]));
    const adjacency = new Map(), componentVertices = new Map();
    for (const segment of network) {
      const a = pointKey(segment.a), b = pointKey(segment.b);
      if (!adjacency.has(a)) adjacency.set(a, []);
      if (!adjacency.has(b)) adjacency.set(b, []);
      adjacency.get(a).push([b, segment.id]); adjacency.get(b).push([a, segment.id]);
      if (!componentVertices.has(segment.component)) componentVertices.set(segment.component, new Set());
      componentVertices.get(segment.component).add(a); componentVertices.get(segment.component).add(b);
    }
    const mainComponent = [...componentVertices].sort((a, b) => b[1].size - a[1].size)[0]?.[0];
    if (!Number.isInteger(mainComponent)) throw new Error('真实机动车路网为空');
    const nodeMap = new Map(nodes.map(node => [node.id, node]));
    const access = new Map(nodes.map(node => [node.id, points[node.id] ? router.snapToComponent(points[node.id], mainComponent) : null]));
    const baselineRoutes = new Map();
    function rawRoute(start, end, conditions = {}) {
      const a = access.get(start), b = access.get(end);
      return a && b ? router.findFixed(points[start], points[end], a, b, conditions) : null;
    }
    for (const edge of edges) baselineRoutes.set(edge.id, rawRoute(edge.a, edge.b));
    const tasks = new Map(edges.map(edge => {
      const baseline = baselineRoutes.get(edge.id);
      const target = nodeMap.get(edge.b)?.pop > 0 ? edge.b : nodeMap.get(edge.a)?.pop > 0 ? edge.a : null;
      const rawPoint = target ? access.get(target)?.point : midpointAlong(baseline?.roadCoordinates);
      const attachment = rawPoint ? router.snapToComponent(rawPoint, mainComponent) : null;
      const point = attachment?.point || null;
      return [edge.id, {
        id: edge.id, a: edge.a, b: edge.b, target, point, radius: WORK_RADIUS_METERS,
        segmentIds: point ? network.filter(segment => segment.component === mainComponent && distanceToSegment(point, segment) <= WORK_RADIUS_METERS).map(segment => segment.id) : []
      }];
    }));
    const caches = new Map();
    function conditions(state) {
      const working = new Set((state.crews || []).filter(crew => crew.job).map(crew => crew.job.edge));
      const signature = (state.edges || []).map(edge => `${edge.id}:${edge.repaired ? 'done' : working.has(edge.id) ? 'work' : edge.damage || edge.depth >= .3 ? 'blocked' : edge.depth >= .15 ? 'limited' : 'open'}`).join('|');
      if (caches.has(signature)) {
        const cached = caches.get(signature); caches.delete(signature); caches.set(signature, cached); return cached;
      }
      const blocked = new Set(), limited = new Set(), roadStates = new Map(), taskStates = [];
      for (const edge of state.edges || []) {
        const task = tasks.get(edge.id); if (!task) continue;
        const workingNow = working.has(edge.id);
        const status = edge.repaired ? 'open' : workingNow || edge.damage || edge.depth >= .3 ? 'blocked' : edge.depth >= .15 ? 'limited' : 'open';
        taskStates.push({ ...task, depth: edge.depth, damage: !!edge.damage, repaired: !!edge.repaired, working: workingNow, status });
        if (status === 'open') continue;
        for (const id of task.segmentIds) {
          let road = roadStates.get(id);
          if (!road) { road = { id, status, taskIds: [] }; roadStates.set(id, road); }
          road.taskIds.push(edge.id);
          if (status === 'blocked') road.status = 'blocked';
        }
      }
      for (const road of roadStates.values()) (road.status === 'blocked' ? blocked : limited).add(road.id);
      const labels = new Map(); let label = 0;
      for (const vertex of adjacency.keys()) {
        if (labels.has(vertex)) continue;
        const pending = [vertex]; labels.set(vertex, label);
        for (let index = 0; index < pending.length; index++) for (const [next, segmentId] of adjacency.get(pending[index])) {
          if (blocked.has(segmentId) || labels.has(next)) continue;
          labels.set(next, label); pending.push(next);
        }
        label++;
      }
      const value = { signature, blocked, limited, roadStates, taskStates, labels, routes: new Map(), workRoutes: new Map() };
      caches.set(signature, value); if (caches.size > 32) caches.delete(caches.keys().next().value);
      return value;
    }
    function attachmentLabel(attachment, current) {
      if (!attachment || current.blocked.has(attachment.segmentId)) return null;
      return current.labels.get(pointKey(segments.get(attachment.segmentId).a));
    }
    function reachable(state, start = 'S') {
      const current = conditions(state), from = attachmentLabel(access.get(start), current), result = new Set(nodeMap.has(start) ? [start] : []);
      if (from === null || from === undefined) return result;
      for (const node of nodes) if (attachmentLabel(access.get(node.id), current) === from) result.add(node.id);
      return result;
    }
    function route(state, start, end) {
      if (!nodeMap.has(start) || !nodeMap.has(end)) return null;
      const current = conditions(state), key = `${start}>${end}`;
      if (!current.routes.has(key)) {
        const result = rawRoute(start, end, current);
        current.routes.set(key, result ? freeze({ ...result, distance: result.distanceKm, nodes: [start, end], edges: [], routingModel: MODEL_ID, dataVersion }) : null);
      }
      return current.routes.get(key);
    }
    function workRoute(state, edge) {
      const current = conditions(state), task = tasks.get(edge.id);
      if (current.workRoutes.has(edge.id)) return current.workRoutes.get(edge.id);
      let best = null;
      if (task?.point && task.segmentIds.length && access.get('S') && !current.blocked.has(access.get('S').segmentId)) {
        const candidates = network.filter(segment => segment.component === mainComponent && !current.blocked.has(segment.id))
          .map(segment => ({ segment, point: mid(segment), distance: meters(mid(segment), task.point) }))
          .filter(candidate => candidate.distance <= task.radius + 350)
          .sort((a, b) => a.distance - b.distance || a.segment.id - b.segment.id).slice(0, 24);
        for (const candidate of candidates) {
          const attachment = { segmentId: candidate.segment.id, t: .5 };
          const result = router.findFixed(points.S, candidate.point, access.get('S'), attachment, current);
          if (result && (!best || result.minutes < best.minutes || result.minutes === best.minutes && result.totalDistanceKm < best.totalDistanceKm)) best = result;
        }
      }
      current.workRoutes.set(edge.id, best ? freeze({ ...best, routingModel: MODEL_ID, dataVersion }) : null);
      return current.workRoutes.get(edge.id);
    }
    function canDispatch(state, edge, crew) {
      if (typeof edge === 'string') edge = state.edges.find(candidate => candidate.id === edge);
      if (typeof crew === 'string') crew = state.crews.find(candidate => candidate.id === crew);
      if (!edge || !crew) return '道路或队伍不存在';
      const task = tasks.get(edge.id);
      if (!task?.point || !task.segmentIds.length) return '作业区没有接入已收录的真实机动车道路';
      return workRoute(state, edge) ? null : '作业区外围没有真实可达的进场道路，请先处理其他阻断';
    }
    function dispatchEstimate(state, edge, crew) {
      if (typeof edge === 'string') edge = state.edges.find(candidate => candidate.id === edge);
      if (typeof crew === 'string') crew = state.crews.find(candidate => candidate.id === crew);
      const error = canDispatch(state, edge, crew); if (error) return { error };
      const result = workRoute(state, edge), task = tasks.get(edge.id);
      const workMinutes = edge.work / crew.speed, travelMinutes = result.minutes, duration = Math.ceil(workMinutes + travelMinutes);
      return { travelMinutes, workMinutes, duration, completionAt: state.time + duration, route: result, workPoint: task.point.slice(), travelDistanceKm: result.distanceKm };
    }
    function scene(state) {
      const current = conditions(state);
      const sceneSignature = state.edges.map(edge => `${edge.id}:${edge.depth}:${edge.damage}`).join('|');
      if (!current.scene || current.sceneSignature !== sceneSignature) {
        const edgeMap = new Map(state.edges.map(edge => [edge.id, edge]));
        current.sceneSignature = sceneSignature;
        current.scene = freeze({
          modelId: MODEL_ID, dataVersion, mainComponent,
          roadStates: [...current.roadStates.values()].map(road => ({ ...road, taskIds: road.taskIds.slice() })),
          tasks: current.taskStates.map(task => ({ ...task, depth: edgeMap.get(task.id).depth, damage: !!edgeMap.get(task.id).damage, point: task.point?.slice() || null, segmentIds: task.segmentIds.slice() })),
          corridors: Object.fromEntries([...baselineRoutes].map(([id, result]) => [id, result ? { ...result, routingModel: MODEL_ID, dataVersion } : null])),
          attachments: Object.fromEntries([...access].map(([id, attachment]) => [id, attachment ? { segmentId: attachment.segmentId, t: attachment.t, point: attachment.point.slice(), accessMeters: Math.round(attachment.d * 1000) } : null])),
          note: '真实机动车道路几何、固定接入口；局部60m灾情为教学设定。接入段单独表达，非导航服务。'
        });
      }
      return current.scene;
    }
    return { modelId: MODEL_ID, dataVersion, reachable, route, canDispatch, dispatchEstimate, scene };
  }
  return { create };
});

;
window.FloodRoadDataVersion="922da47b6900b26c2ad4";
/* The shared core is bundled before this adapter; no online navigation dependency. */
window.FloodRoadRouting = (() => {
  'use strict';
  let builtFrom, router;
  function current() {
    const data = window.FloodLocalGeoData;
    if (!router || builtFrom !== data) {
      router = window.FloodRoadNetwork.create(data);
      builtFrom = data;
    }
    return router;
  }
  return {
    find: (...args) => current().find(...args),
    findFixed: (...args) => current().findFixed(...args),
    network: () => current().network(),
    snap: point => current().snap(point),
    snapToComponent: (...args) => current().snapToComponent(...args),
    stats: () => current().stats()
  };
})();

/* Real street experiment. Independent storage keeps historical topology exercises reproducible. */
window.FloodRealLab=(()=>{
 'use strict';
 const R=window.FloodRoadRouting, KEY='flood-real-streets-v1', HORIZON=120;
 const colors={open:'#20a58b',limited:'#e4a32c',blocked:'#e65168',repair:'#438dec'};
 const escape=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const copy=x=>JSON.parse(JSON.stringify(x));
 const distance=(a,b)=>Math.hypot((a[0]-b[0])*Math.cos(a[1]*Math.PI/180)*111320,(a[1]-b[1])*110574);
 const points=()=>window.FloodGeoScene.getPoints();
 let state,selected=null,routeSelection=null,timer=null,speed=2,picking=false,notice='',cache=null,baselineCache=new Map(),renderCallback=null,authorOpen=false,conditionsOpen=false;
 function preset(name='rising'){
  const p=points();return {format:'flood-real-road-script',version:1,title:name==='compound'?'湖滨复合阻断':'湖滨积水演变',rain:name==='compound'?100:70,budget:80,
   hazards:[{id:'F1',title:'养老院周边低洼积水',center:p.B.slice(),radius:150,depth:.24,start:0,damage:false,cost:12,work:18},
   {id:'F2',title:'医院进场道路积水',center:p.H.slice(),radius:130,depth:.36,start:0,damage:false,cost:16,work:25},
   {id:'F3',title:'社区周边后续阻断',center:p.A.slice(),radius:160,depth:.32,start:25,damage:name==='compound',cost:18,work:22}]};
 }
 function validateScript(raw){
  const fail=()=>{throw new Error('情景文件无效：请使用本平台导出的真实路网脚本');};
  const num=(v,a,b)=>typeof v==='number'&&Number.isFinite(v)&&v>=a&&v<=b;
  if(!raw||raw.format!=='flood-real-road-script'||raw.version!==1||typeof raw.title!=='string'||!raw.title.trim()||raw.title.length>80||!num(raw.rain,0,150)||!num(raw.budget,20,200)||!Array.isArray(raw.hazards)||raw.hazards.length<1||raw.hazards.length>12)fail();
  const ids=new Set();const hazards=raw.hazards.map(h=>{
   if(!h||typeof h.id!=='string'||!/^F\d{1,5}$/.test(h.id)||ids.has(h.id)||typeof h.title!=='string'||!h.title.trim()||h.title.length>80||!Array.isArray(h.center)||h.center.length!==2||!num(h.center[0],117.08,117.26)||!num(h.center[1],34.225,34.295)||!num(h.radius,40,400)||!num(h.depth,0,1.5)||!Number.isInteger(h.start)||!num(h.start,0,119)||typeof h.damage!=='boolean'||!num(h.cost,1,50)||!Number.isInteger(h.work)||!num(h.work,5,90))fail();ids.add(h.id);
   return {id:h.id,title:h.title.trim(),center:h.center.slice(),radius:h.radius,depth:h.depth,start:h.start,damage:h.damage,cost:h.cost,work:h.work};
  });return {format:raw.format,version:1,title:raw.title.trim(),rain:raw.rain,budget:raw.budget,hazards};
 }
 function create(script=preset()){return {version:1,script:validateScript(script),time:0,spent:0,jobs:[],repairs:{},history:[],prediction:null,actions:[],logs:[{at:0,text:'载入真实路网实验'}]};}
 function save(){cache=null;try{localStorage.setItem(KEY,JSON.stringify(state));}catch{notice='浏览器无法保存，请导出实验记录。';}}
 function restore(raw){if(!raw||raw.version!==1||!Number.isInteger(raw.time)||raw.time<0||raw.time>HORIZON||!Array.isArray(raw.actions)||raw.actions.length>20)throw new Error('实验记录无效');const rebuilt=create(raw.script);for(const action of raw.actions){if(!action||!Number.isInteger(action.at)||action.at<rebuilt.time||action.at>raw.time)throw new Error('操作时间无效');if(action.at>rebuilt.time)advance(rebuilt,action.at-rebuilt.time);if(action.type==='dispatch')dispatch(rebuilt,action.hazard);else if(action.type==='predict')predict(rebuilt,action.value);else throw new Error('操作记录无效');}if(raw.time>rebuilt.time)advance(rebuilt,raw.time-rebuilt.time);return rebuilt;}
 function init(){if(state)return;state=create();try{const raw=JSON.parse(localStorage.getItem(KEY)||'null');if(raw)state=restore(raw);}catch{notice='旧的实景实验记录无法验证，已恢复初始情景。';} }
 function current(){init();return state;}
 function depth(s,h){if(s.time<h.start||s.repairs[h.id]!==undefined)return 0;return Math.min(2,h.depth+Math.max(0,s.script.rain-25)*.00012*(s.time-h.start));}
 function radius(s,h){return h.radius*(1+Math.min(.65,Math.max(0,depth(s,h)-h.depth)*1.7));}
 function touched(segment,center,r){const scale=Math.cos(center[1]*Math.PI/180)*111320,dx=(segment.b[0]-segment.a[0])*scale,dy=(segment.b[1]-segment.a[1])*110574,x=(center[0]-segment.a[0])*scale,y=(center[1]-segment.a[1])*110574,t=Math.max(0,Math.min(1,(x*dx+y*dy)/(dx*dx+dy*dy||1)));return Math.hypot(x-t*dx,y-t*dy)<=r;}
 function conditions(s){
  const key=JSON.stringify([s.time,s.script,s.repairs,s.jobs.map(j=>j.hazard)]);if(cache?.key===key)return cache.value;
  const network=R.network(),blocked=new Set(),limited=new Set(),affected=new Map(),statuses=new Map();
  for(const h of s.script.hazards){const d=depth(s,h),active=s.time>=h.start&&s.repairs[h.id]===undefined;if(!active)continue;const ids=[];for(const segment of network)if(touched(segment,h.center,radius(s,h))){ids.push(segment.id);const status=h.damage||d>=.3?'blocked':d>=.15?'limited':'open';if(status==='blocked')blocked.add(segment.id);else if(status==='limited')limited.add(segment.id);if(status!=='open')statuses.set(segment.id,status);}affected.set(h.id,ids);}
  for(const id of blocked){limited.delete(id);statuses.set(id,'blocked');}
  const value={blocked,limited,affected,statuses,network};cache={key,value};return value;
 }
 const baselineRoutes=new Map();
 function baseline(id){if(!baselineRoutes.has(id))baselineRoutes.set(id,R.find(points().S,points()[id]));return baselineRoutes.get(id);}
 function snapshot(s){const c=conditions(s);let available=0,isolated=0,unmapped=0;const facilities=[];
  for(const n of window.FloodLab.nodes.filter(n=>n.pop)){const base=baseline(n.id);const route=base?R.find(points().S,points()[n.id],c):null;const status=!base?'unmapped':route?'reachable':'isolated';if(status==='reachable')available+=n.pop;else if(status==='isolated')isolated+=n.pop;else unmapped+=n.pop;facilities.push({id:n.id,name:n.name,pop:n.pop,status,route,baseline:base});}
  return {at:s.time,available,isolated,unmapped,blocked:c.blocked.size,limited:c.limited.size,spent:s.spent,facilities};
 }
 function record(s){const q=snapshot(s);const row={at:q.at,available:q.available,isolated:q.isolated,blocked:q.blocked,spent:s.spent};if(s.history.at(-1)?.at===s.time)s.history[s.history.length-1]=row;else s.history.push(row);}
 function advance(s,minutes=5){if(!Number.isInteger(minutes)||minutes<1||minutes>120)throw new Error('时间步长无效');if(!s.history.length)record(s);const target=Math.min(HORIZON,s.time+minutes);while(s.time<target){s.time++;for(const j of s.jobs){if(j.end===s.time){s.repairs[j.hazard]=s.time;s.logs.push({at:s.time,text:j.hazard+' 完成作业，重新计算真实路网可达性'});}}s.jobs=s.jobs.filter(j=>j.end>s.time);record(s);}return snapshot(s);}
 function workRoute(s,h){const c=conditions(s);const candidates=c.network.filter(seg=>!c.blocked.has(seg.id)&&distance([(seg.a[0]+seg.b[0])/2,(seg.a[1]+seg.b[1])/2],h.center)<radius(s,h)+350).map(seg=>({p:[(seg.a[0]+seg.b[0])/2,(seg.a[1]+seg.b[1])/2]}));candidates.sort((a,b)=>distance(a.p,h.center)-distance(b.p,h.center));
  let best=null;for(const candidate of candidates.slice(0,24)){const route=R.find(points().S,candidate.p,c);if(route&&(!best||route.minutes<best.minutes))best=route;}return best;
 }
 function dispatch(s,id){const h=s.script.hazards.find(h=>h.id===id);if(!h||s.time>=120)throw new Error('请选择有效灾情，或重新开始实验');if(s.jobs.length>=2)throw new Error('两支作业队均在执行任务');if(s.time<h.start||s.repairs[id]!==undefined||s.jobs.some(j=>j.hazard===id))throw new Error('该灾情尚未发生、已处理或正在处理');if(!conditions(s).affected.get(id)?.length)throw new Error('该范围内没有收录的机动车道路');if(s.spent+h.cost>s.script.budget)throw new Error('剩余预算不足');const route=workRoute(s,h);if(!route)throw new Error('作业区周边没有可达的进场道路，请先处理其他阻断');if(s.time+route.minutes+h.work>HORIZON)throw new Error('剩余实验时间不足以完成此次作业');const job={hazard:id,start:s.time,arrival:s.time+route.minutes,end:s.time+route.minutes+h.work,route:route.coordinates,minutes:route.minutes};s.jobs.push(job);s.actions.push({type:'dispatch',at:s.time,hazard:id});s.spent+=h.cost;s.logs.push({at:s.time,text:id+' 派遣成功：沿真实路网进场 '+route.minutes+' 分钟，作业 '+h.work+' 分钟，投入 '+h.cost+' 万元'});record(s);return job;}
 function predict(s,value){if(s.time||s.spent||s.prediction)throw new Error('请在推演或派遣前提交一次预测');if(!Number.isInteger(value)||value<0||value>1520)throw new Error('预测人口需为0–1520的整数');s.prediction={target:30,isolated:value};s.actions.push({type:'predict',at:s.time,value});}
 function initialScript(s){return copy(s.script);}
 function comparison(s){const key=JSON.stringify(s.script);let base=baselineCache.get(key);if(!base){base=create(s.script);baselineCache.set(key,base);}if(base.time>s.time){base=create(s.script);baselineCache.set(key,base);}if(base.time<s.time)advance(base,s.time-base.time);return snapshot(base);}
 function locked(s){return s.time>0||s.spent>0||!!s.prediction;}
 function circle(center,meters){return Array.from({length:49},(_,i)=>{const a=i*Math.PI/24;return [center[0]+Math.cos(a)*meters/(111320*Math.cos(center[1]*Math.PI/180)),center[1]+Math.sin(a)*meters/110574];});}
 function sceneData(){const s=current(),c=conditions(s),q=snapshot(s);return {time:s.time,roadFeatures:c.network.map(seg=>({type:'Feature',properties:{segment:seg.id,color:colors[c.statuses.get(seg.id)||'open'],state:c.statuses.get(seg.id)||'open'},geometry:{type:'LineString',coordinates:[seg.a,seg.b]}})),floodFeatures:s.script.hazards.filter(h=>s.time>=h.start&&s.repairs[h.id]===undefined).map(h=>({type:'Feature',properties:{id:h.id,depth:depth(s,h),height:Math.max(.05,depth(s,h)),color:h.damage?'#e68956':'#439bce'},geometry:{type:'Polygon',coordinates:[circle(h.center,radius(s,h))]}})),facilities:q.facilities,hazards:s.script.hazards.map(h=>({...h,depth:depth(s,h),radius:radius(s,h),active:s.time>=h.start&&s.repairs[h.id]===undefined,done:s.repairs[h.id]!==undefined,working:s.jobs.some(j=>j.hazard===h.id)})),jobs:s.jobs};}
 function report(){const s=current(),q=snapshot(s),b=comparison(s);return {format:'flood-real-road-evidence',version:1,script:initialScript(s),time:s.time,spent:s.spent,available:q.available,isolated:q.isolated,withoutIntervention:{available:b.available,isolated:b.isolated},prediction:s.prediction,actions:copy(s.actions),predictionObserved:s.history.find(t=>t.at===30)||null,history:copy(s.history),logs:copy(s.logs),note:'真实道路几何计算；人口、设施、灾情和积水增长为教学设定；未使用DEM或水动力求解。可达不代表完成救援。'};}
 function download(name,value){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 function view(){
  authorOpen=document.querySelector?.('.real-author')?.open??authorOpen;conditionsOpen=document.querySelector?.('.real-conditions')?.open??conditionsOpen;
  if(!window.FloodLocalGeoData)return '<section class="panel panel-body"><h2>正在准备真实道路数据</h2><p>地图加载后将自动进入实验。</p></section>'+FloodGeoScene.template('real');
  const s=current(),q=snapshot(s),h=s.script.hazards.find(h=>h.id===selected)||s.script.hazards[0];selected=h?.id;
  const b=comparison(s),p=s.prediction,ob=s.history.find(t=>t.at===30),gain=b.isolated-q.isolated;
  const stages=[['map','观察路况','定位断连与积水',false],['predict','记录预测',p?'判断已记录':'先写下T+30的判断',!!p],['dispatch','安排抢修',s.jobs.length?s.jobs.length+'项作业进行中':'权衡投入与恢复顺序',s.spent>0],['evidence','对照验证',s.time>=30?'可以查看预测验证':'比较同条件不干预',s.time>=30]];
  return `<section class="real-intro"><div><p>观察真实路网，预测灾情变化，再验证你的抢修决策。</p></div><span class="real-clock"><small>实验时刻</small><b>T+${String(s.time).padStart(3,'0')}<em> / 120 min</em></b></span></section>
  <div class="real-stage-path" aria-label="实景实验学习步骤">${stages.map(([id,title,desc,done],i)=>`<button data-real-scroll="${id}" class="${done?'recorded':''}"><span>${done?'✓':'0'+(i+1)}</span><div><b>${title}</b><small>${desc}</small></div><i aria-hidden="true">↗</i></button>`).join('')}</div>
  <div class="real-metrics" aria-label="实景实验当前指标">${[['灾后断连人口',q.isolated,'人','需关注通道恢复','alert'],['基地可达人口',q.available,'人','可达不等于已完成转运',''],['实际阻断路段',q.blocked,'段','参与当前绕行计算',''],['剩余预算',s.script.budget-s.spent,'万元','已投入 '+s.spent+' 万元','']].map(([title,value,unit,hint,cls])=>`<div class="${cls}"><small>${title}</small><b>${value}<em>${unit}</em></b><span>${hint}</span></div>`).join('')}</div>
  <details class="real-conditions panel" ${conditionsOpen?'open':''}><summary><span>实验条件</span><span>雨强 ${s.script.rain} mm/h · 预算 ${s.script.budget} 万元</span><b>调整 ⌄</b></summary><div class="real-setup"><div><span class="real-setup-label">初始条件</span><label>情景<select data-real-change="preset" ${locked(s)?'disabled':''}><option value="rising">湖滨积水演变</option><option value="compound" ${s.script.title==='湖滨复合阻断'?'selected':''}>湖滨复合阻断</option></select></label><label>雨强<input data-real-change="rain" aria-label="实景雨强" type="number" min="0" max="150" value="${s.script.rain}" ${locked(s)?'disabled':''}><span>mm/h</span></label><label>预算<input data-real-change="budget" aria-label="实景预算" type="number" min="20" max="200" value="${s.script.budget}" ${locked(s)?'disabled':''}><span>万元</span></label></div><span class="real-condition-state">${locked(s)?'已锁定 · 可重新实验':'预测或派遣后锁定'}</span></div></details>
  ${notice?`<p class="real-notice" role="status">${escape(notice)}</p>`:''}
  <div class="real-workspace"><div class="real-map-column" id="real-map">${FloodGeoScene.template('real')}<div class="real-playback"><div class="real-playback-clock"><small>推演进度</small><b>T+${s.time}<span> / 120 分钟</span></b><progress value="${s.time}" max="120" aria-label="当前推演进度"></progress></div><div class="real-controls"><button data-real="play" class="primary" ${s.time>=120?'disabled':''}>${timer?'Ⅱ 暂停推演':'▶ 播放推演'}</button><button data-real="step" ${s.time>=120?'disabled':''}>+5分钟</button><label><span class="sr-only">播放速度</span><select data-real-change="speed" aria-label="播放速度">${[1,2,4].map(v=>`<option ${v===speed?'selected':''} value="${v}">${v}× 速度</option>`).join('')}</select></label><button data-real="reset" class="subtle">重新实验</button></div></div><p class="real-map-help">点击道路查看通行状态，点击灾情标记选择作业。滚轮缩放，拉近后可切换三维建筑。</p></div>
  <aside class="real-side"><section class="panel real-prediction" id="real-predict"><div class="panel-head"><div><small>先判断，再行动</small><h2>你的T+30预测</h2></div><span class="tag">${p?(ob?'已验证':'已记录'):'待记录'}</span></div><div class="panel-body">${!p?`<label for="real-prediction">到T+30分钟，会有多少人因灾断连？</label><div class="real-prediction-entry"><input id="real-prediction" aria-label="T+30分钟断连人口预测" type="number" min="0" max="1520" step="1" value="0" ${locked(s)?'disabled':''}><span>人</span><button class="primary" data-real="predict" ${locked(s)?'disabled':''}>记录预测</button></div><p class="hint">${locked(s)?'本轮已开始，下一次实验可在派遣前记录预测。':'提交后保留原判断，初始条件锁定。'}</p>`:`<div class="real-prediction-result"><div><small>你的预测</small><b>${p.isolated}<em> 人</em></b></div><div><small>${ob?'T+30实际':'验证时刻'}</small><b>${ob?ob.isolated:'T+30'}${ob?'<em> 人</em>':''}</b></div></div><p class="hint">${ob?'T+30实际：'+ob.isolated+'人，绝对误差 '+Math.abs(p.isolated-ob.isolated)+' 人。结合操作证据解释偏差。':'继续推演，到T+30自动保留当时结果。'}</p>`}</div></section>
  <section class="panel real-task" id="real-dispatch"><div class="panel-head"><div><small>选择灾情，安排队伍</small><h2>灾情与抢修</h2></div><span class="tag">${s.jobs.length} / 2 作业</span></div><div class="panel-body"><div class="real-hazard-list">${s.script.hazards.map(z=>`<button data-real-select="${z.id}" aria-pressed="${selected===z.id}" class="${selected===z.id?'active':''}"><span class="real-hazard-code">${z.id}</span><span><b>${escape(z.title)}</b><small>${s.repairs[z.id]!==undefined?'✓ 已处理':s.jobs.some(j=>j.hazard===z.id)?'正在进场 / 作业':s.time<z.start?'T+'+z.start+' 发生':z.damage?'结构阻断':depth(s,z).toFixed(2)+'m 积水'}</small></span><em>${z.cost}<small>万元</small></em></button>`).join('')}</div>${h?`<div class="real-selected-task"><span class="eyebrow">当前选择 · ${h.id}</span><h3>${escape(h.title)}</h3><dl><div><dt>影响半径</dt><dd>约 ${Math.round(radius(s,h))} m</dd></div><div><dt>现场工期</dt><dd>${h.work} 分钟</dd></div><div><dt>作业投入</dt><dd>${h.cost} 万元</dd></div></dl><button data-real="dispatch" class="primary" ${s.time<h.start||s.repairs[h.id]!==undefined||s.jobs.some(j=>j.hazard===h.id)||s.jobs.length>=2||s.time>=120?'disabled':''}>派遣队伍处理 ${h.id} →</button><p class="hint">进场时间按当前路网另算。完成后，重叠灾情仍会影响通行。</p></div>`:''}${s.jobs.map(j=>`<div class="real-job"><b>${j.hazard} · ${s.time<j.arrival?'沿路进场':'现场作业'}</b><progress value="${s.time-j.start}" max="${j.end-j.start}" aria-label="${j.hazard}作业进度"></progress><small>T+${j.arrival} 到场 · T+${j.end} 完成</small></div>`).join('')}</div></section></aside></div>
  <div class="real-bottom" id="real-evidence"><section class="panel real-comparison"><div class="panel-head"><div><small>同一脚本 · 同一时刻</small><h2>这次决策带来了什么变化？</h2></div><span class="tag">T+${s.time}</span></div><div class="panel-body"><div class="real-comparison-values"><div><small>不干预时断连</small><b>${b.isolated}<em> 人</em></b></div><span aria-hidden="true">→</span><div><small>你的方案断连</small><b>${q.isolated}<em> 人</em></b></div></div><div class="real-gain"><span>少断连人口</span><b>${gain}<em> 人</em></b><small>累计投入 ${s.spent} 万元</small></div><div class="real-evidence-chart"><div class="real-evidence-legend"><span>你的方案</span><span>不干预</span></div><svg viewBox="0 0 560 150" role="img" aria-label="当前实验已记录时刻的可达人口变化，灰色虚线为不干预对照"><path d="M42 15V115H538" fill="none" stroke="#d5dfd9"/>${[0,760,1520].map(v=>`<text x="32" y="${119-v/1520*100}" text-anchor="end">${v}</text>`).join('')}${[['#147567',s.history],['#7d9190',baselineCache.get(JSON.stringify(s.script))?.history||[]]].map(([color,rows],i)=>rows.length?`<polyline points="${rows.filter(r=>r.at<=s.time).map(r=>`${42+r.at/Math.max(30,s.time)*496},${115-r.available/1520*100}`).join(' ')}" fill="none" stroke="${color}" stroke-width="2.5" ${i?'stroke-dasharray="5 4"':''}/>`:'').join('')}<text x="42" y="140">T+0</text><text x="538" y="140" text-anchor="end">T+${Math.max(30,s.time)} 分钟</text></svg></div><p class="hint">曲线表示基地可达人口，仅显示已经推演的时刻。对照只改变是否派遣；可达人数不等于实际救援人数。</p><button data-real="report">导出过程与对照证据 ↗</button></div></section>
  <section class="panel"><div class="panel-head"><div><small>从基地出发</small><h2>设施可达与绕行</h2></div><span class="tag">${q.facilities.filter(n=>n.status==='reachable').length} 处可达</span></div><div class="panel-body real-facilities">${q.facilities.map(n=>`<button data-real-facility="${n.id}" class="${n.status}"><span class="real-facility-code">${n.id}</span><span>${escape(n.name)}<small>${n.pop}人 · ${n.status==='unmapped'?'基线未接入，未计入灾后孤岛':n.status==='isolated'?'因灾断连':n.route.minutes+'分钟 · '+n.route.distanceKm+'km'}</small></span><b>${n.status==='reachable'?(n.route.minutes>n.baseline.minutes?'绕行 ↗':'查看路线 ↗'):n.status==='isolated'?'阻断':'未接入'}</b></button>`).join('')}</div></section></div>
  <details class="panel real-author" ${authorOpen?'open':''}><summary>学生出题 / 交换真实路网情景</summary><div class="panel-body"><p>在地图上设置灾情，导出给同伴处理；双方使用同样的道路数据。编辑在推演、预测或派遣前完成。</p><div class="real-controls"><button data-real="pick" ${locked(s)||s.script.hazards.length>=12?'disabled':''}>${picking?'请点击地图上的道路':'＋ 在地图上添加灾情'}</button><button data-real="export">导出情景给同伴</button><button data-real="import">导入同伴情景</button></div>${h?`<div class="real-controls"><label>当前灾情半径/m<input data-real-hazard="radius" type="number" min="40" max="400" value="${h.radius}" ${locked(s)?'disabled':''}></label><label>初始水深/m<input data-real-hazard="depth" type="number" min="0" max="1.5" step="0.01" value="${h.depth}" ${locked(s)?'disabled':''}></label><label>发生时刻/min<input data-real-hazard="start" type="number" min="0" max="119" value="${h.start}" ${locked(s)?'disabled':''}></label><label>工期/min<input data-real-hazard="work" type="number" min="5" max="90" value="${h.work}" ${locked(s)?'disabled':''}></label><label>费用/万元<input data-real-hazard="cost" type="number" min="1" max="50" value="${h.cost}" ${locked(s)?'disabled':''}></label><label><input data-real-hazard="damage" type="checkbox" ${h.damage?'checked':''} ${locked(s)?'disabled':''}>结构阻断</label><button data-real="delete" ${locked(s)||s.script.hazards.length<=1?'disabled':''}>删除此灾情</button></div>`:''}<input id="real-script-file" type="file" accept=".json,application/json" hidden><p class="hint">此入口交换真实路网脚本；原“双向脚本对战”仍用于角色任务训练，两类脚本不混用。</p></div></details>
  <details class="panel spaced"><summary>过程记录与模型依据</summary><div class="panel-body"><p>道路拓扑由本地公开地图机动车道几何构建，共${R.stats().vertices}个几何顶点、${R.stats().roadSegments}段。道路按双向25km/h、限行12.5km/h计算，接入段按5km/h估算；尚未建模单行、转向限制和交通信号。</p><p>教学积水：初始深度＋max(雨强−25,0)×0.00012×发生后分钟数；0.15m限行，0.30m阻断。水深增长带动设定影响半径扩大；结构阻断独立于水深。完成作业后移除此灾情影响，重叠灾情继续生效。</p><p>未接入数字高程模型（DEM），未求解二维水动力；蓝色范围不是实际淹没边界。人口和设施用途为教学设定。真实路网中的原有断连单独标记，不算作洪涝造成的孤岛。</p><ol>${s.logs.map(l=>`<li>T+${l.at} · ${escape(l.text)}</li>`).join('')}</ol></div></details>`;}
 function refresh(){save();if(renderCallback)renderCallback();window.dispatchEvent(new Event('flood-real-updated'));}
 function stop(){clearInterval(timer);timer=null;}
 function play(){stop();timer=setInterval(()=>{try{const before=current().jobs.length;advance(current(),1);if(current().time>=120||(before>0&&!current().jobs.length)){stop();notice='本次作业已完成或实验到达终点，推演已暂停。';}refresh();}catch(error){stop();notice=error.message;refresh();}},1000/speed);}
 function bind(render){renderCallback=render;}
 document.addEventListener('click',event=>{if(document.body?.dataset.page==='real-lab'&&event.target.closest('[data-action="save"]')){event.stopImmediatePropagation();notice='真实路网实验已保存到当前浏览器，刷新后可继续。';refresh();}},true);
 function select(id){selected=id;routeSelection=null;refresh();}
 function routeTo(id){const n=snapshot(current()).facilities.find(n=>n.id===id);return n?.route||null;}
 document.addEventListener('click',event=>{const jump=event.target.closest('[data-real-scroll]');if(jump){document.getElementById('real-'+jump.dataset.realScroll)?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});return;}const el=event.target.closest('[data-real],[data-real-select],[data-real-facility]');if(!el)return;try{init();notice='';if(el.dataset.realSelect){select(el.dataset.realSelect);FloodGeoScene.focusLocation(state.script.hazards.find(h=>h.id===selected).center);return;}if(el.dataset.realFacility){const id=el.dataset.realFacility;if(id==='S'){FloodGeoScene.focus('S');return;}routeSelection='node:'+id;refresh();FloodGeoScene.focus(id);return;}switch(el.dataset.real){
  case 'play':if(timer)stop();else play();break;
  case 'step':stop();advance(state,5);break;
  case 'reset':stop();state=create(state.script);selected=null;routeSelection=null;notice='已恢复同一脚本的初始状态。';break;
  case 'dispatch':dispatch(state,selected);speed=4;if(timer)play();notice='派遣成功，已切到4倍速。点击播放观察队伍沿真实道路进场和作业。';break;
  case 'predict':predict(state,Number(document.getElementById('real-prediction').value));notice='预测已提交，初始条件已锁定。';break;
  case 'delete':if(locked(state))throw new Error('实验条件已锁定');state.script.hazards=state.script.hazards.filter(h=>h.id!==selected);selected=null;break;
  case 'pick':if(locked(state))throw new Error('实验条件已锁定');picking=true;FloodGeoScene.setLocationPicker(value=>{try{const snap=R.snap(value.lngLat);if(!snap||snap.d>.12)throw new Error('请在已收录的机动车道路附近选点');const next=Math.max(0,...state.script.hazards.map(h=>Number(h.id.slice(1))))+1;state.script.hazards.push({id:'F'+next,title:'学生设置灾情 '+next,center:snap.point.slice(),radius:100,depth:.35,start:0,damage:false,cost:10,work:20});state.script=validateScript(state.script);selected='F'+next;picking=false;notice='已按实际道路位置设置灾情。';refresh();}catch(error){picking=false;notice=error.message;refresh();}});break;
  case 'export':download('真实路网情景.json',initialScript(state));notice='情景已导出，仅含初始条件，不含你的预测和解题过程。';break;
  case 'import':document.getElementById('real-script-file').click();return;
  case 'report':download('真实路网实验记录.json',report());break;
 }refresh();}catch(error){notice=error.message;refresh();}});
 document.addEventListener('change',async event=>{const el=event.target;try{if(el.id==='real-script-file'){const file=el.files?.[0];if(!file)return;if(file.size>100000)throw new Error('情景文件过大');const script=validateScript(JSON.parse(await file.text()));stop();state=create(script);selected=null;notice='已载入同伴情景，请先预测，再开始解决。';refresh();return;}if(!el.matches('[data-real-change],[data-real-hazard]'))return;init();if(el.dataset.realChange==='speed'){speed=Number(el.value);if(timer)play();return;}if(locked(state))throw new Error('初始条件已锁定，重新实验后可编辑');const draft=copy(state.script);if(el.dataset.realChange==='preset'){state=create(preset(el.value));selected=null;}else{if(el.dataset.realHazard){const h=draft.hazards.find(h=>h.id===selected);h[el.dataset.realHazard]=el.type==='checkbox'?el.checked:Number(el.value);}else draft[el.dataset.realChange]=Number(el.value);state=create(validateScript(draft));}notice='初始条件已更新。';refresh();}catch(error){notice=error.message;refresh();}});
 window.addEventListener('flood-map-ready',()=>{if(location.hash==='#real-lab'&&renderCallback)renderCallback();});
 window.addEventListener('hashchange',()=>{if(location.hash!=='#real-lab'){stop();picking=false;}});
 return {view,bind,stop,current,sceneData,selected:()=>routeSelection||selected,select,restore,routeTo,create,validateScript,conditions,snapshot,advance,dispatch,predict,report,depth,radius,preset};
})();

;
(function(){function install(){if(!window.FloodLocalGeoData?.roads?.features?.length)return;window.FloodLab.attachRoadRouting(window.FloodClassroomNetwork.create({router:window.FloodRoadRouting,points:window.FloodGeography.points,nodes:window.FloodLab.nodes,edges:window.FloodLab.edges,dataVersion:window.FloodRoadDataVersion}));}if(window.FloodLocalGeoData?.roads?.features?.length)install();else window.addEventListener('flood-map-ready',install,{once:true});})();
