// Builds a course pack for the course game from the organisers' KML/KMZ route
// file and a SkiTour 3D pack (terrain heights + OpenStreetMap buildings,
// forests, roads, lifts) covering the area.
//   node scripts/build-course.cjs <doc.kml> <skitour-pack.json> <out.json> "<name>"
// The pack is cut down to the course area (plus a margin) so the game only
// downloads what it needs. Map data (c) OpenStreetMap contributors (ODbL);
// heights: Copernicus GLO-30.
const fs = require('fs');

const [kmlFile, packFile, outFile, title = 'Course'] = process.argv.slice(2);
const MARGIN = 1500; // metres of scenery around the course
const FAR_MARGIN = 12000; // horizon terrain
const NEAR = 35; // an obstacle within this many metres of a course belongs to it
const M_LAT = 111320, RAD = Math.PI / 180;
const r5 = (v) => Math.round(v * 1e5) / 1e5;

// ---------------------------------------------------------------- the KML
function parseKml(src) {
  const items = [];
  const folders = [];
  const re = /<(\/?)(Folder|Placemark)\b[^>]*>|<name>([^<]*)<\/name>|<coordinates>([\s\S]*?)<\/coordinates>|<(Point|LineString|Polygon)>/g;
  let m, pm = null, pendingFolder = false;
  while ((m = re.exec(src))) {
    if (m[2] === 'Folder') {
      if (m[1]) folders.pop(); else { folders.push(''); pendingFolder = true; }
    } else if (m[2] === 'Placemark') {
      if (m[1]) { items.push(pm); pm = null; } else { pm = { folders: folders.filter(Boolean), coords: [] }; pendingFolder = false; }
    } else if (m[3] !== undefined) {
      const name = m[3].replace(/​/g, '').replace(/\s+/g, ' ').trim();
      if (pm) pm.name = name;
      else if (pendingFolder) { folders[folders.length - 1] = name; pendingFolder = false; }
    } else if (m[5] && pm) pm.type = m[5];
    else if (m[4] && pm) pm.coords.push(...m[4].trim().split(/\s+/).map((p) => { const [lo, la] = p.split(',').map(Number); return [la, lo]; }));
  }
  return items;
}

const kml = parseKml(fs.readFileSync(kmlFile, 'utf8'));
const pack = JSON.parse(fs.readFileSync(packFile, 'utf8'));

// Local metres around the course centre: x east, y north.
const all = kml.flatMap((k) => k.coords);
const lat0 = all.reduce((a, p) => a + p[0], 0) / all.length, lon0 = all.reduce((a, p) => a + p[1], 0) / all.length;
const kx = M_LAT * Math.cos(lat0 * RAD);
const toXY = ([la, lo]) => [(lo - lon0) * kx, (la - lat0) * M_LAT];

function along(line) {
  const d = [0];
  for (let i = 1; i < line.length; i++) { const a = toXY(line[i - 1]), b = toXY(line[i]); d.push(d[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
  return d;
}
// nearest point on a line: {dist, at (metres along)}
function nearest(line, cum, p) {
  const q = toXY(p);
  let best = { dist: Infinity, at: 0 };
  for (let i = 1; i < line.length; i++) {
    const a = toXY(line[i - 1]), b = toXY(line[i]);
    const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / l2)) : 0;
    const d = Math.hypot(q[0] - a[0] - t * dx, q[1] - a[1] - t * dy);
    if (d < best.dist) best = { dist: d, at: cum[i - 1] + t * Math.sqrt(l2) };
  }
  return best;
}
// every separate pass of a line near p (a long course can come back past the same spot)
function passes(line, cum, p, within) {
  const q = toXY(p), hits = [];
  for (let i = 1; i < line.length; i++) {
    const a = toXY(line[i - 1]), b = toXY(line[i]);
    const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / l2)) : 0;
    const d = Math.hypot(q[0] - a[0] - t * dx, q[1] - a[1] - t * dy);
    if (d < within) hits.push({ dist: d, at: cum[i - 1] + t * Math.sqrt(l2) });
  }
  // group hits closer than 300 m along the course into one pass, keep the nearest of each
  hits.sort((a, b) => a.at - b.at);
  const out = [];
  for (const h of hits) {
    const last = out[out.length - 1];
    if (last && h.at - last.at < 300) { if (h.dist < last.dist) Object.assign(last, h); } else out.push({ ...h });
  }
  return out;
}

const clean = (n) => n.replace(/^#\d+\s*/, '').replace(/\s+/g, ' ').trim();
const isLine = (k) => k.type === 'LineString';
const points = kml.filter((k) => k.type === 'Point');
const inFolder = (k, f) => k.folders.some((x) => x.toUpperCase() === f);

// The courses, longest first. Kids' courses start at the kids' START.
const COURSES = [
  { id: 'ultra', match: 'UWC 26', name: 'Ultra', start: 'Start Ultra' },
  { id: 'beast', match: 'BEAST26', name: 'Beast', start: 'START' },
  { id: 'super', match: 'SUPER26', name: 'Super', start: 'START' },
  { id: 'sprint', match: 'SPRINT26', name: 'Sprint', start: 'START' },
  { id: 'kids10', match: 'KIDS 10-14', name: 'Kids 10–14', start: 'START', kids: true },
  { id: 'kids7', match: 'KIDS 7- 9', name: 'Kids 7–9', start: 'START', kids: true },
  { id: 'kids4', match: 'KIDS 4 - 6', name: 'Kids 4–6', start: 'START', kids: true },
];

const obstacles = points.filter((k) => inFolder(k, 'OBSTACLES') || inFolder(k, 'OBSTACLES KIDS'));
const kidsObstacle = (k) => inFolder(k, 'OBSTACLES KIDS');
const water = points.filter((k) => inFolder(k, 'WATER STATION'));
const penalty = kml.filter((k) => inFolder(k, 'PENALTY LOOP') && isLine(k));
const burpeeAreas = kml.filter((k) => k.type === 'Polygon' && /BURPEE/i.test(k.name));

// Penalty loops are named after their obstacle ("PL 2 APE HANGER"); where
// two fit (the spear throws) the one nearest the obstacle wins.
function penaltyFor(name, pos) {
  const n = name.toUpperCase().replace(/ULTRA|BEAST/g, '').replace(/[^A-Z]/g, '');
  const key = (s) => s.toUpperCase().replace(/^PL\s*\d*\s*/, '').replace(/ULTRA|TRHOW|THROW/g, '').replace(/[^A-Z]/g, '');
  const fits = penalty.filter((p) => { const k = key(p.name); return k.length > 3 && (n.includes(k) || k.includes(n)); });
  const q = toXY(pos), gap = (p) => Math.min(...p.coords.map((c) => Math.hypot(toXY(c)[0] - q[0], toXY(c)[1] - q[1])));
  const pl = fits.sort((a, b) => gap(a) - gap(b))[0];
  return pl && gap(pl) < 400 ? pl.name : null;
}

const out = { name: title, lat0, lon0, courses: [], penaltyLoops: {}, scenery: {} };

for (const c of COURSES) {
  const k = kml.find((x) => isLine(x) && (x.name === c.match || x.name.startsWith(c.match + ' ')));
  if (!k) { console.log('missing course', c.match); continue; }
  let line = k.coords;
  const start = points.find((p) => p.name === c.start && (c.kids ? inFolder(p, 'KIDS') : !inFolder(p, 'KIDS')));
  if (start) {
    const d0 = Math.hypot(...toXY(line[0]).map((v, i) => v - toXY(start.coords[0])[i]));
    const d1 = Math.hypot(...toXY(line[line.length - 1]).map((v, i) => v - toXY(start.coords[0])[i]));
    if (d1 < d0) line = line.slice().reverse();
  }
  const cum = along(line);
  const obs = [];
  for (const o of obstacles) {
    if (!!c.kids !== kidsObstacle(o)) continue;
    // kids' obstacles are grouped by age; the 10-14 course has all, the others theirs
    if (c.kids) {
      const grp = o.folders[o.folders.length - 1] || '';
      if (c.id === 'kids4' && !/4 - 6/.test(grp)) continue;
      if (c.id === 'kids7' && !/4 - 6|7 - 9/.test(grp)) continue;
    }
    // the course's closest pass (in the busy festival area other passes go by within metres)
    const p = nearest(line, cum, o.coords[0]);
    if (p.dist > (c.kids ? 60 : NEAR)) continue;
    const name = clean(o.name);
    obs.push({ name, at: Math.round(p.at), off: Math.round(p.dist), pos: o.coords[0].map(r5), penalty: c.kids ? null : penaltyFor(name, o.coords[0]) });
  }
  obs.sort((a, b) => a.at - b.at);
  // the same obstacle twice within 150 m is one obstacle
  const ob2 = obs.filter((o, i) => !obs.slice(0, i).some((p) => p.name === o.name && Math.abs(p.at - o.at) < 150));
  const ws = water.flatMap((w) => passes(line, cum, w.coords[0], 60).map((p) => ({ name: w.name.replace(/\s*\(.*$/, '').trim(), at: Math.round(p.at), pos: w.coords[0].map(r5) })));
  ws.sort((a, b) => a.at - b.at);
  out.courses.push({ id: c.id, name: c.name, kids: !!c.kids, length: Math.round(cum[cum.length - 1]), line: line.map((p) => p.map(r5)), obstacles: ob2, water: ws });
  console.log(`${c.name}: ${(cum[cum.length - 1] / 1000).toFixed(1)} km, ${ob2.length} obstacles, ${ws.length} water stations`);
}
for (const p of penalty) out.penaltyLoops[p.name] = p.coords.map((q) => q.map(r5));
out.burpeeAreas = burpeeAreas.map((b) => b.coords.map((q) => q.map(r5)));
// Landmarks and course furniture from the file (shown as scenery)
const LAND = points.filter((p) => !p.folders.some((f) => /OBSTACLES|WATER|SIGNALEURS|BNSSA|MEDICAL|CUT OFF|TIMING/i.test(f)));
out.scenery = {
  landmarks: LAND.filter((p) => !/^(START|FINISH|Start Ultra|Finish ULTRA)$/i.test(p.name)).map((p) => [r5(p.coords[0][0]), r5(p.coords[0][1]), p.name]),
  marshals: points.filter((p) => inFolder(p, 'SIGNALEURS')).map((p) => p.coords[0].map(r5)),
  medical: points.filter((p) => inFolder(p, 'MEDICAL')).map((p) => p.coords[0].map(r5)),
  timing: points.filter((p) => inFolder(p, 'TIMING')).map((p) => [r5(p.coords[0][0]), r5(p.coords[0][1]), p.name.replace(/\s*\(.*$/, '')]),
  arches: points.filter((p) => /^(START|FINISH|Start Ultra|Finish ULTRA)$/i.test(p.name)).map((p) => [r5(p.coords[0][0]), r5(p.coords[0][1]), /start/i.test(p.name) ? 'START' : 'FINISH']),
};

// ---------------------------------------------------------------- the terrain and map features
const lats = all.map((p) => p[0]), lons = all.map((p) => p[1]);
const box = (m) => [Math.min(...lats) - m / M_LAT, Math.min(...lons) - m / kx, Math.max(...lats) + m / M_LAT, Math.max(...lons) + m / kx];
function cropGrid(g, [s, w, n, e]) {
  const [S, W] = g.bbox;
  const i0 = Math.max(0, Math.floor((s - S) / g.dLat)), i1 = Math.min(g.nLat - 1, Math.ceil((n - S) / g.dLat));
  const j0 = Math.max(0, Math.floor((w - W) / g.dLon)), j1 = Math.min(g.nLon - 1, Math.ceil((e - W) / g.dLon));
  const src = Buffer.from(g.h, 'base64'), nLat = i1 - i0 + 1, nLon = j1 - j0 + 1, dst = Buffer.alloc(nLat * nLon * 2);
  for (let i = 0; i < nLat; i++) src.copy(dst, i * nLon * 2, ((i0 + i) * g.nLon + j0) * 2, ((i0 + i) * g.nLon + j1 + 1) * 2);
  return { bbox: [S + i0 * g.dLat, W + j0 * g.dLon], step: g.step, nLat, nLon, dLat: g.dLat, dLon: g.dLon, h: dst.toString('base64') };
}
const near = box(MARGIN);
const inBox = ([la, lo], [s, w, n, e]) => la >= s && la <= n && lo >= w && lo <= e;
out.terrain = cropGrid(pack, near);
out.far = cropGrid(pack.far, box(FAR_MARGIN));
out.map = {
  buildings: pack.buildings.filter((b) => inBox(b, near)),
  forests: pack.forests.filter((f) => f.some((p) => inBox(p, near))),
  roads: pack.roads.filter((r) => r[1].some((p) => inBox(p, near))),
  pylons: pack.pylons.filter((p) => inBox(p, near)),
  stations: pack.stations.filter((p) => inBox(p, near)),
  water: (pack.water || []).filter((w) => w[0].some((p) => inBox(p, near))),
  rivers: (pack.rivers || []).filter((r) => r[1].some((p) => inBox(p, near))),
  peaks: (pack.peaks || []).filter((p) => inBox(p, box(FAR_MARGIN))),
};
fs.writeFileSync(outFile, JSON.stringify(out));
const m = out.map;
console.log(`wrote ${outFile}: ${(fs.statSync(outFile).size / 1e6).toFixed(1)} MB; terrain ${out.terrain.nLon}x${out.terrain.nLat}, ${m.buildings.length} buildings, ${m.forests.length} forests, ${m.roads.length} roads, ${m.pylons.length} pylons, ${m.water.length} lakes, ${m.peaks.length} peaks`);
