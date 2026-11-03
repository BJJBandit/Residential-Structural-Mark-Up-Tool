// Builds one mark-up drawing per topic and level, as plain lines, rectangles and text. No DOM access.
"use strict";

const SHEET_TOPICS = [
  { id: "path", title: "LOAD PATHS" },
  { id: "roof", title: "ROOF FRAMING" },
  { id: "walls", title: "WALL FRAMING AND BRACING" },
  { id: "footing", title: "FOOTINGS" },
  { id: "floor", title: "FLOOR FRAMING AND SLAB" }
];
const SHEET_RED = [0.75, 0.13, 0.11], SHEET_INK = [0.1, 0.14, 0.19], SHEET_BLUE = [0.04, 0.36, 0.68], SHEET_GREEN = [0.1, 0.45, 0.28], SHEET_BROWN = [0.54, 0.35, 0], SHEET_PALE = [0.72, 0.6, 0.42];

// Which sheet a member belongs on. Drafted members say; drawn ones go by use, and a column goes with what lands on it.
function topicOf(el, project, conn) {
  if (el.sheet) return el.sheet;
  if (el.type === "wall") return "walls";
  if (el.type === "footing") return "footing";
  if (el.type === "beam") return el.use === "lintel" ? "walls" : el.use === "floor" || el.use === "masonry" ? "floor" : "roof";
  if (el.type === "column") {
    const on = conn && conn.onSupport ? conn.onSupport[el.id] || [] : [];
    const beam = on.map(c => project.elements.find(e => e.id === c.from)).find(Boolean);
    return beam ? topicOf(beam, project, conn) : "roof";
  }
  return "";
}

const levelName = g => (g && g.level === "upper" ? "FIRST FLOOR" : g && g.level === "ground" ? "GROUND FLOOR" : "FLOOR");

// The sheets to issue: footings on the lowest level only, and a roof sheet only where something is framed with rafters
function sheetList(project, conn) {
  const out = [];
  const pages = project.pages.map((pg, i) => ({ i, g: pg.draft })).filter(p => p.g || project.elements.some(e => e.page === p.i && topicOf(e, project, conn)));
  SHEET_TOPICS.forEach(t => pages.forEach(({ i, g }) => {
    const has = project.elements.some(e => e.page === i && (t.id === "path" ? e.type !== "note" && e.type !== "measure" : topicOf(e, project, conn) === t.id));
    const wanted = t.id === "footing" ? has || (g && g.lowest) : t.id === "floor" ? has || (g && (g.lowest || g.floor)) : has;
    if (wanted) out.push({ topic: t.id, title: t.title, page: i });
  }));
  return out;
}

// ---------- Drawing helpers ----------

function arrow(p, x1, y1, x2, y2, color, size, w = 0.9) {
  p.push({ t: "line", x1, y1, x2, y2, w, color });
  const a = Math.atan2(y2 - y1, x2 - x1);
  [0.45, -0.45].forEach(d => p.push({ t: "line", x1: x2, y1: y2, x2: x2 - size * Math.cos(a + d), y2: y2 - size * Math.sin(a + d), w, color }));
}

// Parallel 45 degree lines clipped to a rectangle
function hatchRect(p, x, y, w, h, gap, color) {
  for (let c = gap; c < w + h; c += gap) {
    const a = c <= h ? [x, y + c] : [x + c - h, y + h], b = c <= w ? [x + c, y] : [x + w, y + c - w];
    p.push({ t: "line", x1: a[0], y1: a[1], x2: b[0], y2: b[1], w: 0.35, color });
  }
}

const boxOf = g => ({ x: g.left, y: g.top, w: g.right - g.left, h: g.bottom - g.top });

// Articulation joints along one wall, moved back to an opening edge where one is close. Positions in page points.
function articulationJoints(a, b, jambs, spacing) {
  const out = [], sp = Math.max(spacing, 1);
  let cur = a;
  while (b - cur > sp * 1.02) {
    const target = cur + sp;
    const edge = jambs.filter(j => j > cur + sp * 0.5 && j <= target).sort((x, y) => y - x)[0];
    cur = edge != null ? edge : target;
    out.push(cur);
  }
  return out;
}

// True where articulation applies: articulated or unreinforced construction, except Class A and S sites
function articulationApplies(project) {
  const eq = (CONSTRUCTION[project.construction] || {}).eq;
  return !!eq && eq !== "CF" && !["A", "S"].includes(project.siteClass);
}

// ---------- Text panel ----------

const panelLine = (s, opts = {}) => ({ s, ...opts });

// Splits lines to a column width, using an average Helvetica character width
function wrapPanel(lines, width, size) {
  const max = Math.max(10, Math.floor(width / (size * 0.5))), out = [];
  lines.forEach(l => {
    let cur = "";
    String(l.s).split(" ").forEach(word => {
      if (cur && (cur + " " + word).length > max) { out.push({ ...l, s: cur }); cur = word; }
      else cur = cur ? cur + " " + word : word;
    });
    out.push({ ...l, s: cur });
  });
  return out;
}

// Grid of cells already drawn on, from the plan's own linework and text and from this sheet's drawing
function occupancy(W, H, pageData, prims) {
  const nx = 48, ny = 34, grid = new Uint8Array(nx * ny);
  const mark = (x, y) => { const i = Math.floor(x / W * nx), j = Math.floor(y / H * ny); if (i >= 0 && j >= 0 && i < nx && j < ny) grid[j * nx + i] = 1; };
  const seg = (x1, y1, x2, y2) => { const n = Math.ceil(Math.hypot(x2 - x1, y2 - y1) / Math.min(W / nx, H / ny)) + 1; for (let k = 0; k <= n; k++) mark(x1 + (x2 - x1) * k / n, y1 + (y2 - y1) * k / n); };
  if (pageData) {
    // The sheet frame runs around everything, so it does not count
    pageData.segs.forEach(s => { if (Math.abs(s.x2 - s.x1) < W * 0.8 && Math.abs(s.y2 - s.y1) < H * 0.8) seg(s.x1, s.y1, s.x2, s.y2); });
    (pageData.marks || []).forEach(k => { for (let y = k.y; y <= k.y + k.h; y += Math.max(1, H / ny / 2)) seg(k.x, y, k.x + k.w, y); });
    pageData.text.forEach(t => seg(t.x, t.y, t.vertical ? t.x : t.x + t.w, t.vertical ? t.y + (t.up ? -t.w : t.w) : t.y));
  }
  prims.forEach(p => { if (p.t === "line") seg(p.x1, p.y1, p.x2, p.y2); else if (p.t === "text") seg(p.x, p.y, p.x + String(p.s).length * p.size * 0.5, p.y); else if (p.t === "rect") { seg(p.x, p.y, p.x + p.w, p.y); seg(p.x, p.y + p.h, p.x + p.w, p.y + p.h); } });
  return { grid, nx, ny };
}

// Top left corner of a clear rectangle, preferring the bottom left of the sheet, or null
function clearSpot(occ, W, H, w, h) {
  const cw = Math.ceil(w / W * occ.nx), ch = Math.ceil(h / H * occ.ny), m = 1;
  for (let j = occ.ny - ch - m; j >= m; j--) {
    for (let i = m; i <= occ.nx - cw - m; i++) {
      let free = true;
      for (let b = j; free && b < j + ch; b++) for (let a = i; a < i + cw; a++) if (occ.grid[b * occ.nx + a]) { free = false; break; }
      if (free) return { x: i * W / occ.nx, y: j * H / occ.ny };
    }
  }
  return null;
}

// ---------- Sheet content ----------

// One line per size, listing the tags that share it
function memberSchedule(members, results, describe) {
  const groups = new Map();
  members.filter(e => e.tag).forEach(e => {
    const r = results[e.id], text = describe ? describe(e, r) : r && !r.error ? r.name : "not sized";
    const key = text, g = groups.get(key) || { text, tags: [], bad: false };
    if (!g.tags.includes(e.tag)) g.tags.push(e.tag);
    if (r && (r.error || r.ok === false)) g.bad = true;
    groups.set(key, g);
  });
  const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true });
  return [...groups.values()].sort((a, b) => natural(a.tags[0], b.tags[0])).map(g => {
    const tags = g.tags.sort(natural), label = tags.length > 4 ? `${tags[0]} to ${tags[tags.length - 1]}` : tags.join(", ");
    return panelLine(`${label}: ${g.text}${g.bad ? " - FAILS, RESIZE" : ""}`, g.bad ? { color: SHEET_RED } : {});
  });
}

const KIND_NAME = { lintel: "LINTEL", rafter: "RAFTERS AT 900 CTRS", ridge: "RIDGE BEAM", outdoorBeam: "VERANDAH BEAM", floorBeam: "FLOOR BEAM", joist: "JOISTS", bearer: "BEARER", post: "COLUMN", pad: "PAD FOOTING" };
const describeMember = (e, r) => {
  const name = r && !r.error ? r.name : "not sized";
  return KIND_NAME[e.kind] ? `${name} ${KIND_NAME[e.kind]}${e.kind === "joist" ? ` AT ${Math.round((e.loads[0] ? e.loads[0].width : 0.45) * 1000)} CTRS` : ""}` : name;
};

function sheetPath(project, solved, page, g, prims, lines, size) {
  const conn = solved.conn, results = solved.results;
  const on = project.elements.filter(e => e.page === page);
  const rows = loadPathRows(project, solved).filter(r => on.some(e => e.id === r.id));
  const tagOf = id => (project.elements.find(e => e.id === id) || {}).tag;
  const to = {};
  [conn.onBeam, conn.onSupport].forEach(map => Object.entries(map || {}).forEach(([host, list]) => list.forEach(c => { to[`${c.from}:${c.end}`] = host; })));
  // Roof load direction: from the centre line down to each bearing wall
  if (g) {
    const b = boxOf(g), n = 4, mid = g.spanAcrossY ? b.y + b.h / 2 : b.x + b.w / 2;
    for (let k = 1; k <= n; k++) {
      const along = g.spanAcrossY ? b.x + b.w * k / (n + 1) : b.y + b.h * k / (n + 1);
      if (g.spanAcrossY) { arrow(prims, along, mid, along, b.y + size, SHEET_RED, size); arrow(prims, along, mid, along, b.y + b.h - size, SHEET_RED, size); }
      else { arrow(prims, mid, along, b.x + size, along, SHEET_RED, size); arrow(prims, mid, along, b.x + b.w - size, along, SHEET_RED, size); }
    }
    const lx = g.spanAcrossY ? b.x + b.w * 0.5 : mid, ly = g.spanAcrossY ? mid : b.y + b.h * 0.5;
    prims.push({ t: "text", x: lx, y: ly - size * 0.4, s: `ROOF LOAD WIDTH ${g.main.toFixed(2)} M EACH SIDE`, size, color: SHEET_RED, center: true });
  }
  // Each end of each member says what it delivers and to what
  on.forEach(e => {
    const r = results[e.id];
    if (!r || r.error) return;
    if (e.type === "beam" && e.kind !== "lintel" && !e.typical) {
      [[1, e.x1, e.y1, r.r1u], [2, e.x2, e.y2, r.r2u]].forEach(([end, x, y, kN]) => {
        if (e.support === "cant" && end === 2) return;
        const host = to[`${e.id}:${end}`];
        prims.push({ t: "text", x: x + size * 0.3, y: y - size * 0.4, s: `${kN.toFixed(1)} kN${host ? " > " + tagOf(host) : " > ?"}`, size: size * 0.8, color: host ? SHEET_RED : SHEET_RED, bold: !host });
      });
    } else if (e.type === "column") {
      const host = to[`${e.id}:1`] || to[`${e.id}:undefined`];
      prims.push({ t: "text", x: e.x + size * 0.6, y: e.y + size * 1.4, s: `${(r.Nstar || 0).toFixed(1)} kN${host ? " > " + tagOf(host) : ""}`, size: size * 0.8, color: SHEET_RED });
    } else if (e.type === "wall") {
      const mx = (e.x1 + e.x2) / 2, my = (e.y1 + e.y2) / 2, horiz = Math.abs(e.x2 - e.x1) >= Math.abs(e.y2 - e.y1);
      prims.push({ t: "text", x: horiz ? mx : mx + size * 0.6, y: horiz ? my + size * 1.6 : my + size, s: `${(r.line.G + Math.max(r.line.Qf, r.line.Qr)).toFixed(1)} kN/m${e.onGround ? " > FOOTING" : " > LEVEL BELOW"}`, size: size * 0.8, color: SHEET_RED });
    }
  });
  // Upper walls bear on the level below, which the note says is not linked
  const open = rows.filter(r => !r.to && !(g && g.level === "upper" && on.some(e => e.id === r.id && e.type === "wall")));
  open.forEach(r => { const e = on.find(x => x.id === r.id); if (e) { const x = e.x1 != null ? e.x1 : e.x, y = e.y1 != null ? e.y1 : e.y; prims.push({ t: "rect", x: x - size, y: y - size, w: size * 2, h: size * 2, color: SHEET_RED, thick: 1.5 }); } });
  lines.push(panelLine("LOAD PATH", { bold: true }));
  lines.push(panelLine("Roof to rafters or trusses, to walls and lintels, to studs or blockwork, to footing. Upper floor to beams and walls, to columns, to footing."));
  lines.push(panelLine("Beam end figures are factored reactions and where they land. Wall figures are service kN/m, G + Q."));
  if (g && g.level === "upper") lines.push(panelLine("Walls on this level bear on the level below. Those loads are not linked between sheets; check them against the level below.", { color: SHEET_RED }));
  if (open.length) { lines.push(panelLine(`${open.length} UNSUPPORTED:`, { bold: true, color: SHEET_RED })); open.slice(0, 14).forEach(r => lines.push(panelLine(r.from, { color: SHEET_RED }))); }
  else if (rows.length) lines.push(panelLine("Every member on this sheet lands on a support."));
}

function sheetRoof(project, solved, page, g, members, prims, lines, size, mm) {
  const rafters = project.roofFrame === "Rafters", gap = 900 / mm;
  if (g) {
    const b = boxOf(g);
    if (rafters && g.ridge) {
      // Thin lines at the rafter spacing over both slopes
      const a0 = g.ridge.from, a1 = g.ridge.to, walls = g.spanAcrossY ? [b.y, b.y + b.h] : [b.x, b.x + b.w];
      for (let c = a0 + gap / 2; c < a1; c += gap) walls.forEach(w => prims.push(g.spanAcrossY ? { t: "line", x1: c, y1: g.ridge.at, x2: c, y2: w, w: 0.3, color: SHEET_BLUE } : { t: "line", x1: g.ridge.at, y1: c, x2: w, y2: c, w: 0.3, color: SHEET_BLUE }));
    } else if (!rafters) {
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2, half = (g.spanAcrossY ? b.h : b.w) * 0.4;
      if (g.spanAcrossY) arrow(prims, cx, cy - half, cx, cy + half, SHEET_BLUE, size); else arrow(prims, cx - half, cy, cx + half, cy, SHEET_BLUE, size);
      prims.push({ t: "text", x: cx, y: cy, s: "TR1 TRUSSES TO MANUFACTURER'S SPECIFICATION", size, color: SHEET_BLUE, center: true });
    }
    const o = g.outdoor;
    if (o) {
      for (let c = o.a + gap / 2; c < o.b; c += gap) prims.push(o.horizontal ? { t: "line", x1: c, y1: o.wallAt, x2: c, y2: o.edgeAt, w: 0.3, color: SHEET_BLUE } : { t: "line", x1: o.wallAt, y1: c, x2: o.edgeAt, y2: c, w: 0.3, color: SHEET_BLUE });
      prims.push(o.horizontal ? { t: "line", x1: o.a, y1: o.wallAt, x2: o.b, y2: o.wallAt, w: 2, color: SHEET_BLUE } : { t: "line", x1: o.wallAt, y1: o.a, x2: o.wallAt, y2: o.b, w: 2, color: SHEET_BLUE });
      prims.push({ t: "text", x: o.horizontal ? o.a + size : o.wallAt + size * 0.4, y: o.horizontal ? o.wallAt - size * 0.4 : o.a + size, s: "RL1", size, color: SHEET_BLUE, bold: true });
    }
  }
  lines.push(panelLine("ROOF FRAMING SCHEDULE", { bold: true }));
  if (!rafters) lines.push(panelLine("TR1: TRUSSES TO MANUFACTURER'S SPECIFICATION."));
  lines.push(...memberSchedule(members, solved.results, describeMember));
  if (g && g.outdoor) lines.push(panelLine("RL1: RAFTER LEDGER FIXED TO WALL, NOT LESS THAN RAFTER DEPTH. FIXINGS BY ENGINEER."));
  lines.push(panelLine("NOTES", { bold: true }));
  lines.push(panelLine(`Roofing: ${(project.surfaces.find(s => s.id === project.roofType) || { name: "not set" }).name}. Wind ${project.windClass}.`));
  const w = designWind(project), G = (project.surfaces.find(s => s.id === project.roofType) || { G: 0 }).G;
  lines.push(panelLine(`Net uplift for tie-down ${Math.max(0, w.roofUp - 0.9 * G).toFixed(2)} kPa. Tie down each rafter and beam; connections are not designed here.`));
  if (g && g.outdoor) lines.push(panelLine(`${g.outdoor.label}: check roofing, which may differ from the main roof.`));
}

function sheetWalls(project, solved, page, g, members, prims, lines, size, mm) {
  const results = solved.results, spacingM = Number(project.ajSpacing) || 6, jointsOn = articulationApplies(project);
  let joints = 0, blocks = 0;
  members.filter(e => e.type === "wall").forEach(e => {
    const horiz = Math.abs(e.x2 - e.x1) >= Math.abs(e.y2 - e.y1);
    const pt = v => horiz ? { x: v, y: e.y1 } : { x: e.x1, y: v };
    (e.panels || []).forEach(p => {
      const A = pt(p.a), B = pt(p.b);
      prims.push({ t: "line", x1: A.x, y1: A.y, x2: B.x, y2: B.y, w: 3.5, color: SHEET_GREEN, dash: [6, 2] });
      prims.push({ t: "text", x: horiz ? (p.a + p.b) / 2 : e.x1 + size * 0.4, y: horiz ? e.y1 + size * 1.5 : (p.a + p.b) / 2, s: `${e.braceType || "d"} - ${Math.round(p.len * 1000)}`, size: size * 0.8, color: SHEET_GREEN, center: horiz });
    });
    if (e.wallType === "masonry") {
      blocks++;
      const a = horiz ? Math.min(e.x1, e.x2) : Math.min(e.y1, e.y2), b = horiz ? Math.max(e.x1, e.x2) : Math.max(e.y1, e.y2), t = (Number(e.t) || 190) / mm;
      hatchRect(prims, horiz ? a : e.x1 - t / 2, horiz ? e.y1 - t / 2 : a, horiz ? b - a : t, horiz ? t : b - a, Math.max(t * 0.7, 3), SHEET_BROWN);
    }
    if (jointsOn) {
      const a = horiz ? Math.min(e.x1, e.x2) : Math.min(e.y1, e.y2), b = horiz ? Math.max(e.x1, e.x2) : Math.max(e.y1, e.y2), tick = size * 0.9;
      articulationJoints(a, b, e.jambs || [], spacingM * 1000 / mm).forEach(v => {
        joints++;
        const P = pt(v);
        prims.push(horiz ? { t: "line", x1: P.x, y1: P.y - tick, x2: P.x, y2: P.y + tick, w: 1.4, color: SHEET_RED } : { t: "line", x1: P.x - tick, y1: P.y, x2: P.x + tick, y2: P.y, w: 1.4, color: SHEET_RED });
        prims.push({ t: "text", x: P.x + (horiz ? size * 0.25 : tick), y: P.y - (horiz ? tick : size * 0.2), s: "AJ", size: size * 0.8, color: SHEET_RED, bold: true });
      });
    }
  });
  lines.push(panelLine("WALL FRAMING SCHEDULE", { bold: true }));
  lines.push(...memberSchedule(members.filter(e => e.kind === "lintel" || (e.type === "beam" && !e.kind)), results, describeMember));
  lines.push(...memberSchedule(members.filter(e => e.type === "wall"), results));
  lines.push(panelLine("RACKING", { bold: true }));
  const br = bracingSummary(project, results).find(b => b.page === page);
  if (br) {
    [["X", br.x], ["Y", br.y]].forEach(([d, v]) => lines.push(panelLine(`Wind along ${d}: racking ${v.F.toFixed(1)} kN, bracing ${v.cap.toFixed(1)} kN, largest gap ${v.gap.toFixed(1)} m${v.ok ? "" : " - SHORT. ADD INTERNAL BRACING WALLS."}`, v.ok ? {} : { color: SHEET_RED })));
    lines.push(panelLine("d - 2400 is AS 1684.2 Table 8.18 type (d), 2400 long. External walls only; internal bracing is not drafted."));
  }
  if (blocks) lines.push(panelLine(`Hatched walls are blockwork, checked as unreinforced to AS 3700. Design any core filling, reinforcement or retaining separately.`));
  lines.push(panelLine("ARTICULATION", { bold: true }));
  if (jointsOn) lines.push(panelLine(`AJ: vertical articulation joints at max ${spacingM} m, moved to the side of an opening where one is close. Spacing is an entered value; confirm it against AS 4773 for Class ${project.siteClass}. Also carry them onto the elevations.`));
  else lines.push(panelLine(!project.construction ? "Set the wall construction in Review to place articulation joints." : `None shown: ${["A", "S"].includes(project.siteClass) ? `not required on a Class ${project.siteClass} site` : "clad frame"}.`));
  const eq = (CONSTRUCTION[project.construction] || {}).eq;
  if (eq === "AMV" || eq === "MV") {
    lines.push(panelLine("MASONRY LINTEL SCHEDULE", { bold: true }));
    masonryLintelSchedule(project).forEach(s => lines.push(panelLine(`To ${s.span}: ${s.section}`)));
    lines.push(panelLine("All lintels to bear min 150 into brickwork."));
  }
  lines.push(panelLine("Unless noted otherwise, internal walls are non-loadbearing. Bracing materials and fixings to AS 1684.2."));
}

function sheetFooting(project, solved, page, g, members, prims, lines, size, mm) {
  const f = project.footing || {}, opts = footingOptions(project.siteClass, Number(project.bearing) || 0);
  const chosen = opts.find(o => o.id === f.type) || opts.find(o => o.ok), geo = project.geo || {};
  const isSlab = chosen && ["raft", "waffle", "slab", "engineered"].includes(chosen.id);
  const walls = project.elements.filter(e => e.page === page && e.type === "wall" && e.onGround);
  const band = (walls.length ? Math.max(...walls.map(e => Number(e.stripB) || 300)) : Number(f.width) || 300) / mm;
  walls.forEach(e => {
    const horiz = Math.abs(e.x2 - e.x1) >= Math.abs(e.y2 - e.y1), band = (Number(e.stripB) || 300) / mm;
    const a = horiz ? Math.min(e.x1, e.x2) : Math.min(e.y1, e.y2), b = horiz ? Math.max(e.x1, e.x2) : Math.max(e.y1, e.y2);
    const r = horiz ? { x: a, y: e.y1 - band / 2, w: b - a, h: band } : { x: e.x1 - band / 2, y: a, w: band, h: b - a };
    prims.push({ t: "rect", ...r, color: SHEET_BROWN, thick: 0.8 });
    hatchRect(prims, r.x, r.y, r.w, r.h, Math.max(band * 0.5, 3), SHEET_BROWN);
  });
  if (walls[0]) prims.push({ t: "text", x: walls[0].x1 + size, y: walls[0].y1 - band - size * 0.4, s: isSlab ? "EB1" : "SF1", size, color: SHEET_BROWN, bold: true });
  // Internal beams on a raft, at the entered spacing or 4 m until one is read from the figure
  const beamed = chosen && chosen.id === "raft" && g;
  if (beamed) {
    const b = boxOf(g), sp = (Number(f.spacing) || 4) * 1000 / mm;
    const nx = Math.max(0, Math.ceil(b.w / sp - 0.01) - 1), ny = Math.max(0, Math.ceil(b.h / sp - 0.01) - 1);
    for (let i = 1; i <= nx; i++) { const x = b.x + b.w * i / (nx + 1); prims.push({ t: "line", x1: x, y1: b.y, x2: x, y2: b.y + b.h, w: 0.9, color: SHEET_BROWN, dash: [5, 3] }); }
    for (let j = 1; j <= ny; j++) { const y = b.y + b.h * j / (ny + 1); prims.push({ t: "line", x1: b.x, y1: y, x2: b.x + b.w, y2: y, w: 0.9, color: SHEET_BROWN, dash: [5, 3] }); }
    if (nx || ny) prims.push({ t: "text", x: nx ? b.x + b.w / (nx + 1) + size * 0.3 : b.x + size, y: ny ? b.y + b.h / (ny + 1) - size * 0.4 : b.y + size * 1.5, s: "IB1", size, color: SHEET_BROWN, bold: true });
  }
  const val = v => v || null, enter = chosen ? `ENTER FROM AS 2870 ${chosen.ref}` : "SELECT A FOOTING TYPE IN REVIEW";
  const need = (label, ...vals) => vals.every(val) ? panelLine(`${label} ${vals.join(", ")}`) : panelLine(`${label} ${enter}`, { color: SHEET_RED, bold: true });
  lines.push(panelLine("SITE", { bold: true }));
  lines.push(panelLine(`AS 2870-2011 site classification: ${project.siteClass}${geo.ys ? `, ys ${geo.ys} mm` : ""}. Design bearing ${project.bearing} kPa.${geo.ref ? ` Geotechnical report: ${geo.ref}.` : ""}`));
  if (!geo.reviewed) lines.push(panelLine("Geotechnical report not yet marked as reviewed.", { color: SHEET_RED }));
  lines.push(panelLine("FOOTING SCHEDULE", { bold: true }));
  lines.push(panelLine(chosen ? `${chosen.label}, AS 2870 ${chosen.ref}${f.type ? "" : " - FIRST OPTION FOR THIS CLASS, CONFIRM"}.` : "No footing system available for this class and bearing.", chosen ? {} : { color: SHEET_RED }));
  if (chosen && chosen.id === "engineered") lines.push(panelLine("This class needs an engineered system. The layout below is indicative only.", { color: SHEET_RED }));
  const size2 = f.width && f.depth ? `${f.width}W x ${f.depth}D` : "";
  lines.push(need(isSlab ? "EB1 edge beam:" : "SF1 strip:", size2, f.bars));
  if (walls.length) lines.push(panelLine(`Bearing needs a width of at least ${Math.round(band * mm)} under the most heavily loaded wall, as drawn.`));
  if (g && g.level === "upper") lines.push(panelLine("Only pads are shown on this level. Where it also sits on the ground, as on a split-level site, add its edge and internal beams.", { color: SHEET_RED }));
  if (f.top) lines.push(panelLine(`Top reinforcement: ${f.top}`));
  if (beamed) { lines.push(need("IB1 internal beam:", size2, f.bars)); if (!f.spacing) lines.push(panelLine("Beams drawn at 4 m until the spacing is entered in Review.", { color: SHEET_RED })); }
  if (isSlab) lines.push(need("Slab mesh:", f.mesh));
  lines.push(...memberSchedule(members, solved.results, describeMember));
  lines.push(panelLine("NOTES", { bold: true }));
  ["Site preparation and fill to AS 2870 and AS 3798.", "Step footings to AS 2870 Cl 5.4.3.", "All ground levels to slope away from footings; provide site drainage before excavation.", "Base of all trenches to fall away from buildings.", "Owner to maintain the site to CSIRO Building Technology File 18."].forEach(s => lines.push(panelLine(s)));
}

function sheetFloor(project, solved, page, g, members, prims, lines, size, mm) {
  const f = project.footing || {}, opts = footingOptions(project.siteClass, Number(project.bearing) || 0);
  const chosen = opts.find(o => o.id === f.type) || opts.find(o => o.ok);
  const onGround = g && g.lowest && chosen && chosen.id !== "strip";
  lines.push(panelLine("FLOOR SCHEDULE", { bold: true }));
  if (g) {
    const b = boxOf(g);
    if (onGround) {
      hatchRect(prims, b.x, b.y, b.w, b.h, 300 / mm * 4, SHEET_PALE);
      prims.push({ t: "text", x: b.x + b.w / 2, y: b.y + b.h * 0.3, s: "S0 SLAB ON GROUND", size, color: SHEET_BROWN, center: true, bold: true });
      lines.push(panelLine(`S0: slab on ground to AS 2870 ${chosen.ref}. Mesh ${f.mesh || "- ENTER IN REVIEW"}, min 25 MPa unless the figure requires otherwise.`, f.mesh ? {} : { color: SHEET_RED }));
    }
    const fl = g.floor;
    if (fl) {
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      fl.gaps.forEach(gp => {
        const mid = (gp.a + gp.b) / 2, half = (gp.b - gp.a) * 0.32;
        if (fl.acrossY) arrow(prims, cx, mid - half, cx, mid + half, SHEET_BLUE, size); else arrow(prims, mid - half, cy, mid + half, cy, SHEET_BLUE, size);
        if (fl.acrossY) arrow(prims, cx, mid + half, cx, mid - half, SHEET_BLUE, size); else arrow(prims, mid + half, cy, mid - half, cy, SHEET_BLUE, size);
        if (fl.bondek) prims.push({ t: "text", x: fl.acrossY ? cx + size * 0.5 : mid, y: fl.acrossY ? mid : cy - size * 0.5, s: `S1 ${gp.span.toFixed(1)} M SPAN`, size, color: SHEET_BLUE, bold: true });
      });
      if (fl.bondek) {
        prims.push({ t: "rect", x: b.x, y: b.y, w: b.w, h: b.h, color: SHEET_BLUE, thick: 1.2, dash: [8, 3] });
        const slab = (project.slabs || [])[0], r = slab ? checkBondek(slab) : null;
        lines.push(panelLine(`S1: ${slab ? slab.D : 140} THICK BONDEK OVER THIS LEVEL. Top bars N${slab ? slab.db : 16} at ${slab ? slab.spacing : 150} over supports. Max span ${Math.max(...fl.gaps.map(x => x.span)).toFixed(1)} m.`));
        lines.push(panelLine(r && r.ok ? "Slab check passes." : "Slab check incomplete: enter the supplier's capacity and span on the Loads tab.", r && r.ok ? {} : { color: SHEET_RED, bold: true }));
        lines.push(panelLine("Slab extent drawn to this level's outline. Check it against the floor plan above."));
      }
    }
    if (g.outdoor && g.outdoor.timberDeck) lines.push(panelLine(`${g.outdoor.label}: timber deck on joists and a bearer on the deck columns.`));
  }
  lines.push(...memberSchedule(members, solved.results, describeMember));
  if (!g || (!onGround && !g.floor && !members.length)) lines.push(panelLine("No floor framing drafted on this level."));
  lines.push(panelLine("NOTES", { bold: true }));
  lines.push(panelLine("Floor loads: 1.5 kPa, decks and balconies 1 m or more above ground 2.0 kPa. Vibration, fire and propping are not checked."));
}

// One sheet: members to draw, added lines and text, and the note panel with its place on the page
function buildSheet(project, solved, sheet, dims, pageData) {
  const { topic, page, title } = sheet, g = project.pages[page].draft || null, mm = mmPerPt(project, page);
  const W = dims.w, H = dims.h, size = Math.max(W, H) / 150, prims = [], lines = [];
  const conn = solved.conn;
  const on = project.elements.filter(e => e.page === page && ["beam", "wall", "column", "footing"].includes(e.type));
  const members = on.filter(e => topic === "path" || topicOf(e, project, conn) === topic);
  if (topic === "path") sheetPath(project, solved, page, g, prims, lines, size);
  else if (topic === "roof") sheetRoof(project, solved, page, g, members, prims, lines, size, mm);
  else if (topic === "walls") sheetWalls(project, solved, page, g, members, prims, lines, size, mm);
  else if (topic === "footing") sheetFooting(project, solved, page, g, members, prims, lines, size, mm);
  else sheetFloor(project, solved, page, g, members, prims, lines, size, mm);
  lines.push(panelLine("DRAFT. NOT FOR CONSTRUCTION UNTIL REVIEWED BY THE ENGINEER.", { bold: true, color: SHEET_RED }));

  const heading = `${levelName(g)} - ${title}`, occ = occupancy(W, H, pageData, prims.concat(members.flatMap(e => e.x1 != null ? [{ t: "line", x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2 }] : [{ t: "line", x1: e.x, y1: e.y, x2: e.x + 1, y2: e.y }])));
  const spot = clearSpot(occ, W, H, heading.length * size * 0.75, size * 2);
  const headAt = spot ? { x: spot.x + size * 0.3, y: spot.y + size * 1.6 } : { x: W * 0.035, y: H * 0.03 };
  prims.push({ t: "text", x: headAt.x, y: headAt.y, s: heading, size: size * 1.3, color: SHEET_INK, bold: true });
  if (spot) { const cw = W / occ.nx, ch = H / occ.ny, i0 = Math.floor(spot.x / cw), j0 = Math.floor(spot.y / ch); for (let j = j0; j < j0 + Math.ceil(size * 2 / ch); j++) for (let i = i0; i < i0 + Math.ceil(heading.length * size * 0.75 / cw); i++) if (j < occ.ny && i < occ.nx) occ.grid[j * occ.nx + i] = 1; }

  // The panel keeps the plan's scale and paper by going in clear space, at a smaller size if it must, or else on its own page
  for (const textSize of [size * 0.8, size * 0.7]) {
    const pw = W * 0.3, wrapped = wrapPanel(lines, pw - textSize * 1.5, textSize), ph = wrapped.length * textSize * 1.3 + textSize * 1.5, at = clearSpot(occ, W, H, pw, ph);
    if (at) return { ...sheet, heading, members, prims, panel: { x: at.x, y: at.y, w: pw, h: ph, size: textSize, lines: wrapped }, lines };
  }
  return { ...sheet, heading, members, prims, panel: null, lines };
}
