// Drafts a mark-up from the text and linework of a CAD plan, for the engineer to review.
// readPlanPage touches pdf.js; everything else works on plain data and has no DOM access.
"use strict";

const OPENING_RE = /^(A|AW|SD|SW|F|FD|D|W|CSD|BD|GD|RD)(\d{2})(\d{2})$/;
const OUTDOOR_RE = /^(ALFRESCO|DECK|VERANDAH|PORCH|BALCONY|PATIO)\b/i;
const PT_MM = 25.4 / 72;

// Opening codes read height then width in hundreds of mm: A1254 is 1200 high, 5400 wide
function parseOpening(s) {
  const m = OPENING_RE.exec(String(s).trim());
  if (!m) return null;
  const width = Number(m[3]) * 100, height = Number(m[2]) * 100;
  return width >= 300 ? { code: m[0], height, width } : null;
}

async function readPlanPage(pg) {
  const vp = pg.getViewport({ scale: 1 }), tc = await pg.getTextContent();
  const text = tc.items.filter(t => t.str.trim()).map(t => {
    const [x, y] = vp.convertToViewportPoint(t.transform[4], t.transform[5]);
    const [ax, ay] = vp.convertToViewportPoint(t.transform[4] + t.transform[0], t.transform[5] + t.transform[1]);
    const vertical = Math.abs(ay - y) > Math.abs(ax - x);
    return { s: t.str.trim(), x, y, w: t.width, vertical, up: vertical && ay < y };
  });
  const ops = await pg.getOperatorList(), O = pdfjsLib.OPS, segs = [], stack = [];
  const mul = (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
  let ctm = vp.transform.slice(), lw = 1, dash = false;
  const add = (m, x1, y1, x2, y2) => segs.push({ x1: m[0] * x1 + m[2] * y1 + m[4], y1: m[1] * x1 + m[3] * y1 + m[5], x2: m[0] * x2 + m[2] * y2 + m[4], y2: m[1] * x2 + m[3] * y2 + m[5], lw, dash });
  ops.fnArray.forEach((f, i) => {
    const a = ops.argsArray[i];
    if (f === O.save) stack.push([ctm, lw, dash]);
    else if (f === O.restore) { const s = stack.pop(); if (s) [ctm, lw, dash] = s; }
    else if (f === O.transform) ctm = mul(ctm, a);
    else if (f === O.setLineWidth) lw = a[0];
    else if (f === O.setDash) dash = !!(a[0] && a[0].length);
    else if (f === O.paintFormXObjectBegin) { stack.push([ctm, lw, dash]); if (a[0]) ctm = mul(ctm, a[0]); }
    else if (f === O.paintFormXObjectEnd) { const s = stack.pop(); if (s) [ctm, lw, dash] = s; }
    else if (f === O.constructPath) {
      let k = 0, cx = 0, cy = 0;
      a[0].forEach(c => {
        const v = a[1];
        if (c === O.moveTo) { cx = v[k++]; cy = v[k++]; }
        else if (c === O.lineTo) { const nx = v[k++], ny = v[k++]; add(ctm, cx, cy, nx, ny); cx = nx; cy = ny; }
        else if (c === O.rectangle) { const X = v[k++], Y = v[k++], W = v[k++], H = v[k++]; add(ctm, X, Y, X + W, Y); add(ctm, X + W, Y, X + W, Y + H); add(ctm, X + W, Y + H, X, Y + H); add(ctm, X, Y + H, X, Y); }
        else if (c === O.curveTo) k += 6;
        else if (c === O.curveTo2 || c === O.curveTo3) k += 4;
      });
    }
  });
  return { w: vp.width, h: vp.height, text, segs };
}

// A floor plan has its title and at least three opening tags; the tags also rule out the cover and schedules
function planInfo(page) {
  const joined = page.text.map(t => t.s).join(" ");
  const openings = page.text.map(t => { const o = parseOpening(t.s); return o && openingAt(t, o); }).filter(Boolean);
  const isPlan = /FLOOR PLAN/i.test(joined) && !/ELECTRICAL|DRAINAGE|SETOUT/i.test(joined) && openings.length >= 3;
  const scaleText = page.text.find(t => /^1\s*:\s*\d{2,3}$/.test(t.s));
  const scale = scaleText ? Number(scaleText.s.split(":")[1]) : Number((joined.match(/\b1\s*:\s*(\d{2,3})\b/) || [])[1]) || 0;
  const level = /\b(FIRST|SECOND|UPPER)\s+FLOOR\s+PLAN/i.test(joined) ? "upper" : /\b(GROUND|LOWER)\s+FLOOR\s+PLAN/i.test(joined) ? "ground" : "single";
  const ceiling = page.text.map(t => /^CL\s*(\d{4})$/.exec(t.s)).filter(Boolean).map(m => Number(m[1]) / 1000)[0] || 0;
  return { isPlan, scale, level, ceiling, openings };
}

function openingAt(t, o) {
  // The tag sits beside the opening, so its centre gives the position along the wall
  const cx = t.vertical ? t.x : t.x + t.w / 2, cy = t.vertical ? t.y + (t.up ? -t.w / 2 : t.w / 2) : t.y;
  return { ...o, x: cx, y: cy, horizontal: !t.vertical };
}

// Reads what the whole set says about the roof, walls and eaves, for the engineer to confirm
function readSetFacts(pages) {
  const text = pages.map(p => p.text.map(t => t.s).join(" ")).join(" ");
  const pitches = [...text.matchAll(/(\d{1,2}(?:\.\d)?)\s*°/g)].map(m => Number(m[1])).filter(n => n > 0 && n < 60);
  const eave = (text.match(/(\d{3})\s*(?:mm\s*)?(?:wide\s*)?eaves/i) || [])[1];
  return {
    roofType: /colorbond|metal roof|sheet roof/i.test(text) ? "roof-sheet" : /\btiled? roof|roof tiles?\b/i.test(text) ? "roof-tile" : "",
    roofFrame: /raked (timber )?rafters/i.test(text) ? "Rafters" : /\btrusses\b/i.test(text) ? "Trusses" : /rafters/i.test(text) ? "Rafters" : "",
    pitches: [...new Set(pitches)],
    eave: eave ? Number(eave) / 1000 : 0,
    construction: /brick veneer/i.test(text) ? "AMV" : /double brick|cavity brick/i.test(text) ? "AFM" : /cladding/i.test(text) ? "CF" : "",
    bondek: /\bbondek\b/i.test(text)
  };
}

// Joins line pieces on one axis. Each result: { at, a, b, lw }
function joinLines(segs, horizontal, gap) {
  const ls = [];
  segs.forEach(s => {
    const dx = Math.abs(s.x2 - s.x1), dy = Math.abs(s.y2 - s.y1);
    if (horizontal ? dy > 0.5 || dx < 2 : dx > 0.5 || dy < 2) return;
    ls.push(horizontal ? { at: (s.y1 + s.y2) / 2, a: Math.min(s.x1, s.x2), b: Math.max(s.x1, s.x2), lw: s.lw } : { at: (s.x1 + s.x2) / 2, a: Math.min(s.y1, s.y2), b: Math.max(s.y1, s.y2), lw: s.lw });
  });
  ls.sort((p, q) => Math.round(p.at) - Math.round(q.at) || p.a - q.a);
  const out = [];
  ls.forEach(l => {
    const m = out.find(o => Math.abs(o.at - l.at) <= 1.5 && l.a <= o.b + gap && l.b >= o.a - gap);
    if (m) { m.a = Math.min(m.a, l.a); m.b = Math.max(m.b, l.b); m.lw = Math.max(m.lw, l.lw); m.ink += l.b - l.a; }
    else out.push({ ...l, ink: l.b - l.a });
  });
  return out;
}

// Finds the external walls. The heaviest long lines are the walls; the outermost lines with openings near them bound the house.
function findOutline(page, openings, mm) {
  // Everything inside the sheet margins, without the sheet frame and title block borders
  const mx = page.w * 0.03, my = page.h * 0.03;
  const inBox = page.segs.filter(s => Math.min(s.x1, s.x2) >= mx && Math.max(s.x1, s.x2) <= page.w - mx && Math.min(s.y1, s.y2) >= my && Math.max(s.y1, s.y2) <= page.h - my && Math.abs(s.x2 - s.x1) < page.w * 0.9 && Math.abs(s.y2 - s.y1) < page.h * 0.8);
  const min = 2000 / mm;
  const long = inBox.filter(s => Math.hypot(s.x2 - s.x1, s.y2 - s.y1) >= min);
  if (!long.length) return null;
  const heavy = Math.max(...long.map(s => s.lw));
  const walls = inBox.filter(s => s.lw >= heavy * 0.8 && !s.dash);
  // Dashed lines are outlines of the floor above or roof over, not walls
  const solidLine = l => l.b - l.a >= min && l.ink >= 0.6 * (l.b - l.a);
  const hs0 = joinLines(walls, true, 40).filter(solidLine), vs0 = joinLines(walls, false, 40).filter(solidLine);
  if (!hs0.length || !vs0.length) return null;
  // An eave line runs just outside a wall at the same weight, so a line with a parallel one close inside it is dropped
  const dropEaves = (ls, centre) => ls.filter(l => !ls.some(o => {
    const gap = Math.abs(o.at - l.at) * mm, inside = Math.abs(o.at - centre) < Math.abs(l.at - centre), overlap = Math.min(l.b, o.b) - Math.max(l.a, o.a);
    return inside && gap >= 250 && gap <= 950 && overlap >= 0.3 * (l.b - l.a);
  }));
  const mean = (ls, f) => ls.reduce((s, l) => s + f(l) * (l.b - l.a), 0) / ls.reduce((s, l) => s + l.b - l.a, 0);
  // Borders and other drawings on the sheet do not touch the house, so keep only lines joined to a wall beside an opening
  const touches = (h, v) => v.at >= h.a - 6 && v.at <= h.b + 6 && h.at >= v.a - 6 && h.at <= v.b + 6;
  const keepH = new Set(hs0.filter(l => openings.some(p => p.horizontal && Math.abs(p.y - l.at) < 35 && p.x >= l.a - 15 && p.x <= l.b + 15)));
  const keepV = new Set(vs0.filter(l => openings.some(p => !p.horizontal && Math.abs(p.x - l.at) < 35 && p.y >= l.a - 15 && p.y <= l.b + 15)));
  for (let grew = true; grew;) {
    grew = false;
    hs0.forEach(h => { if (!keepH.has(h) && [...keepV].some(v => touches(h, v))) { keepH.add(h); grew = true; } });
    vs0.forEach(v => { if (!keepV.has(v) && [...keepH].some(h => touches(h, v))) { keepV.add(v); grew = true; } });
  }
  if (!keepH.size || !keepV.size) return null;
  const hs1 = [...keepH], vs1 = [...keepV];
  const hs = dropEaves(hs1, mean(hs1, l => l.at)), vs = dropEaves(vs1, mean(vs1, l => l.at));
  const near = (ls, horizontal) => ls.filter(l => openings.some(o => o.horizontal === horizontal && Math.abs((horizontal ? o.y : o.x) - l.at) < 30 && (horizontal ? o.x : o.y) >= l.a - 15 && (horizontal ? o.x : o.y) <= l.b + 15));
  const bound = (ls, horizontal) => {
    const c = near(ls, horizontal), spread = c.length ? Math.max(...c.map(l => l.at)) - Math.min(...c.map(l => l.at)) : 0;
    // Openings on only one side of the house say nothing about its other side
    const use = c.length >= 2 && spread * mm >= 3000 ? c : ls, top = Math.max(...use.map(l => l.b - l.a));
    const big = use.filter(l => l.b - l.a >= 0.2 * top);
    return [Math.min(...big.map(l => l.at)), Math.max(...big.map(l => l.at))];
  };
  const [top, bottom] = bound(hs, true), [left, right] = bound(vs, false);
  const minor = (horizontal) => joinLines(inBox, horizontal, 40).filter(l => l.b - l.a >= 1000 / mm);
  return { left, right, top, bottom, hs, vs, inBox, minorH: minor(true), minorV: minor(false) };
}

// Puts each opening on its wall and decides whether that wall carries the roof
function placeOpenings(openings, o, mm, opts) {
  const spanAcrossY = o.right - o.left >= o.bottom - o.top; // roof spans the short way
  const span = (spanAcrossY ? o.bottom - o.top : o.right - o.left) * mm / 1000, eave = opts.eave || 0.45;
  const main = span / 2 + eave, endW = opts.form === "Hip" ? main : eave, placed = [], skipped = [];
  openings.forEach(p => {
    const lines = p.horizontal ? o.hs : o.vs, along = p.horizontal ? p.x : p.y, across = p.horizontal ? p.y : p.x;
    const closest = ls => ls.filter(l => along >= l.a - 15 && along <= l.b + 15 && Math.abs(l.at - across) < 35).sort((a, b) => Math.abs(a.at - across) - Math.abs(b.at - across))[0];
    // A tag well away from every heavy line is on a lighter wall, such as a recess behind a deck
    let c = closest(lines);
    if (!c || Math.abs(c.at - across) > 20) c = closest((p.horizontal ? o.minorH : o.minorV).filter(l => Math.abs(l.at - across) <= 20)) || c;
    if (!c) { skipped.push(`${p.code}: no wall found beside the tag`); return; }
    const onEdge = p.horizontal ? Math.abs(c.at - o.top) < 6 || Math.abs(c.at - o.bottom) < 6 : Math.abs(c.at - o.left) < 6 || Math.abs(c.at - o.right) < 6;
    const carries = p.horizontal === spanAcrossY;
    if (!carries && !onEdge) { skipped.push(`${p.code}: internal wall parallel to the roof span, taken as non-loadbearing`); return; }
    const half = (p.width + 100) / 2 / mm;
    placed.push({ ...p, wallAt: c.at, wall: c, a: along - half, b: along + half, loadW: carries ? main : endW, carries });
  });
  return { placed, skipped, span, main, endW, spanAcrossY, eave };
}

// Solid wall between openings makes bracing panels of the standard lengths
function bracingLength(a, b, on, mm) {
  let cur = a, total = 0;
  const gap = to => { const m = (to - cur) * mm; if (m >= 2400) total += 2.4; else if (m >= 1800) total += 1.8; };
  on.slice().sort((x, y) => x.a - y.a).forEach(p => { gap(p.a); cur = Math.max(cur, p.b); });
  gap(b);
  return total;
}

const lineEl = (horizontal, at, a, b) => horizontal ? { x1: a, y1: at, x2: b, y2: at } : { x1: at, y1: a, x2: at, y2: b };

// Builds the draft elements for one plan. Tags and ids are added by the caller.
function draftPlan(page, info, mm, opts) {
  const out = { elements: [], review: [], read: {} };
  const o = findOutline(page, info.openings, mm);
  if (!o) { out.review.push("The external walls could not be found in the linework. Draw this level by hand."); return out; }
  const pl = placeOpenings(info.openings, o, mm, opts);
  out.read = { openings: info.openings.length, placed: pl.placed.length, span: pl.span, main: pl.main, lengthM: (Math.max(o.right - o.left, o.bottom - o.top)) * mm / 1000 };
  pl.skipped.forEach(s => out.review.push(s));
  out.review.push(`Roof taken to span the short way, ${pl.span.toFixed(1)} m, onto the ${pl.spanAcrossY ? "long" : "end"} walls${opts.roofFrame === "Rafters" ? ". Ridge beams and their posts are not drafted" : ""}. Check this, especially on an L-shaped or stepped house.`);
  const roof = opts.roof, floorW = opts.floorAbove ? pl.span / 2 : 0;
  const withFloor = w => (floorW ? [{ surface: opts.floorSurface, width: floorW }] : []).concat(w ? [{ surface: roof, width: w }] : []);

  pl.placed.forEach(p => out.elements.push({
    kind: "lintel", type: "beam", ...lineEl(p.horizontal, p.wallAt, p.a, p.b), use: "lintel", support: "ss", mat: "timber", grade: opts.grade, size: "140x35", plies: 1,
    loads: withFloor(p.loadW).filter(l => p.carries || l.surface === roof), points: [], Ltop: opts.roofFrame === "Trusses" ? 900 : 0, Lbot: 0, code: p.code
  }));

  // Perimeter walls, with the load width reduced where a lintel already takes the load to the jambs
  const perimeter = [...o.hs.filter(l => Math.abs(l.at - o.top) < 1.5 || Math.abs(l.at - o.bottom) < 1.5).map(l => ({ l, h: true })), ...o.vs.filter(l => Math.abs(l.at - o.left) < 1.5 || Math.abs(l.at - o.right) < 1.5).map(l => ({ l, h: false }))];
  perimeter.forEach(({ l, h }) => {
    const a = Math.max(l.a, h ? o.left : o.top), b = Math.min(l.b, h ? o.right : o.bottom);
    if (b - a < 1000 / mm) return;
    const on = pl.placed.filter(p => p.horizontal === h && Math.abs(p.wallAt - l.at) < 6);
    const open = on.reduce((s, p) => s + (p.b - p.a), 0), solid = Math.max(0.2, 1 - open / (b - a));
    const carries = h === pl.spanAcrossY, w = (carries ? pl.main : pl.endW) * solid, braceLen = bracingLength(a, b, on, mm);
    out.elements.push({
      kind: "wall", type: "wall", ...lineEl(h, l.at, a, b), wallType: opts.wallType, h: opts.wallH, grade: "MGP10", size: "90x35", spacing: 450, nog: 1350, concStuds: 3, deflOver: 200,
      loads: withFloor(w).map(x => x.surface === roof ? x : { ...x, width: x.width * solid }), points: [], brace: braceLen > 0, braceType: "d", braceLen, onGround: opts.lowest, stripB: Number(opts.stripB) || 300, stripD: Number(opts.stripD) || 400
    });
  });

  // Outdoor roof: the longest line beyond the wall on the label's side is the outer beam line
  const labels = opts.floorAbove ? [] : page.text.filter(t => OUTDOOR_RE.test(t.s));
  let missedOutdoor = "";
  labels.forEach(t => {
    const below = t.y > o.bottom + 5, above = t.y < o.top - 5, right = t.x > o.right + 5, left = t.x < o.left - 5;
    if (!(below || above || right || left)) return;
    const horizontal = below || above, wallAt = below ? o.bottom : above ? o.top : right ? o.right : o.left;
    // Labels far from the house are on another drawing on the same sheet
    if (Math.abs((horizontal ? t.y : t.x) - wallAt) * mm > 6000) return;
    const cands = joinLines(o.inBox.concat(page.segs), horizontal, 40).filter(l => {
      const d = Math.abs(l.at - wallAt) * mm, side = below ? l.at > wallAt : above ? l.at < wallAt : right ? l.at > wallAt : l.at < wallAt;
      const pos = horizontal ? t.x : t.y;
      return side && d >= 1000 && d <= 6000 && (l.b - l.a) * mm >= 3000 && pos >= l.a - 5 && pos <= l.b + 5 && (horizontal ? t.y >= Math.min(l.at, wallAt) && t.y <= Math.max(l.at, wallAt) || below && t.y <= l.at || above && t.y >= l.at : true);
    }).sort((p, q) => Math.abs(p.at - wallAt) - Math.abs(q.at - wallAt));
    // A heavy side wall running out past the house stops at the outer beam line; otherwise the nearest line past the label
    const sideEnds = (horizontal ? o.vs : o.hs).flatMap(l => [l.a, l.b]);
    const edge = cands.find(l => sideEnds.some(e => Math.abs(e - l.at) < 4)) || cands[0];
    if (!edge) { missedOutdoor = t.s; return; }
    if (out.read.outdoor) return;
    const depth = Math.abs(edge.at - wallAt) * mm / 1000, spanMm = (edge.b - edge.a) * mm, n = Math.max(1, Math.ceil(spanMm / 3000 - 0.01)), bay = (edge.b - edge.a) / n;
    const w = depth / 2 + 0.15;
    out.read.outdoor = { label: t.s, depth, length: spanMm / 1000, bays: n };
    for (let i = 0; i < n; i++) {
      out.elements.push({ kind: "outdoorBeam", type: "beam", ...lineEl(horizontal, edge.at, edge.a + i * bay, edge.a + (i + 1) * bay), use: "roof", support: "ss", mat: "timber", grade: opts.grade, size: "140x45", plies: 1, loads: [{ surface: roof, width: w }], points: [], Ltop: 900, Lbot: 0 });
    }
    for (let i = 0; i <= n; i++) {
      const c = edge.a + i * bay, pt = horizontal ? { x: c, y: edge.at } : { x: edge.at, y: c };
      out.elements.push({ kind: "post", type: "column", ...pt, mat: "steel", sec: "89x89x3.5 SHS", height: opts.wallH, ke: 1, points: [] });
      out.elements.push({ kind: "pad", type: "footing", ...pt, B: 600, Lf: 600, D: 400, points: [] });
    }
    out.review.push(`${t.s}: beams along the outer line, ${n} bays over ${(spanMm / 1000).toFixed(1)} m and ${depth.toFixed(1)} m deep. Check its roofing, which may differ from the main roof, and whether the main roof also bears on it.`);
  });

  if (missedOutdoor && !out.read.outdoor) out.review.push(`${missedOutdoor}: found the label but no outer beam line. Draw its beams and posts by hand.`);

  // Architect's labels on a lower level mark steel floor beams, for example 250UB
  if (opts.floorAbove) {
    const dashes = joinLines(page.segs, true, 25).concat(joinLines(page.segs, false, 25).map(l => ({ ...l, v: true })));
    const found = page.text.filter(t => /^\d{3}\s*(UB|PFC|UC)\b/i.test(t.s)).map(t => {
      const horizontal = !t.vertical, tx = t.x + (horizontal ? t.w / 2 : 0), ty = t.y;
      const line = dashes.filter(l => !!l.v === !horizontal && Math.abs(l.at - (horizontal ? ty : tx)) < 16 && (horizontal ? tx : ty) >= l.a && (horizontal ? tx : ty) <= l.b && (l.b - l.a) * mm >= 2000)
        .sort((p, q) => Math.abs(p.at - (horizontal ? ty : tx)) - Math.abs(q.at - (horizontal ? ty : tx)) || (q.b - q.a) - (p.b - p.a))[0];
      if (!line) out.review.push(`${t.s}: found the label but not its line. Draw this beam by hand.`);
      return line ? { t, line, horizontal } : null;
    }).filter(Boolean);
    found.forEach(({ t, line, horizontal }) => {
      const n = Math.max(1, Math.ceil((line.b - line.a) * mm / 4000 - 0.01)), bay = (line.b - line.a) / n, fam = /UB/i.test(t.s) ? "250UB31.4" : /UC/i.test(t.s) ? "150UC30.0" : "200PFC";
      // Each bay takes half the clear distance to the next beam or wall on each side, which can differ along the line
      const widths = [];
      for (let i = 0; i < n; i++) {
        const a = line.a + i * bay, b = a + bay;
        const sides = found.filter(f => f.horizontal === horizontal && f.line !== line && Math.min(f.line.b, b) - Math.max(f.line.a, a) > 0.5 * bay).map(f => f.line.at).concat(horizontal ? [o.top, o.bottom] : [o.left, o.right]);
        const before = Math.max(...sides.filter(s => s < line.at - 1), -Infinity), after = Math.min(...sides.filter(s => s > line.at + 1), Infinity);
        const width = (isFinite(before) && isFinite(after) ? (after - before) / 2 : pl.span / 2 / mm) * mm / 1000;
        widths.push(width);
        out.elements.push({ kind: "floorBeam", type: "beam", ...lineEl(horizontal, line.at, a, b), use: "floor", support: "ss", mat: "steel", sec: fam, loads: [{ surface: opts.floorSurface, width }], points: [], Ltop: 600, Lbot: 0 });
      }
      for (let i = 0; i <= n; i++) { const c = line.a + i * bay; out.elements.push({ kind: "post", type: "column", ...(horizontal ? { x: c, y: line.at } : { x: line.at, y: c }), mat: "steel", sec: "89x89x5 SHS", height: opts.wallH, ke: 1, points: [] }); }
      out.review.push(`${t.s}: floor beam from the architect's label, in ${n} simply supported bays with load widths of ${[...new Set(widths.map(w => w.toFixed(1)))].join(" and ")} m. Check the load widths, continuity and post positions.`);
    });
    out.review.push("Upper walls and roof are not linked to this level automatically. Load widths here allow for the floor and roof on the same wall line.");
  }
  return out;
}

// Sizes one drafted element in its family and sets its tag prefix group
function sizeDraft(el, project) {
  if (el.kind === "wall") {
    const ladder = [["MGP10", "90x35", 450], ["MGP10", "90x45", 450], ["MGP12", "90x45", 450], ["MGP12", "90x35", 300], ["F17", "90x35", 450], ["F17", "90x45", 450], ["F17", "90x45", 300]];
    const t = JSON.parse(JSON.stringify(project)); t.elements = [JSON.parse(JSON.stringify(el))];
    for (const [grade, size, spacing] of ladder) {
      Object.assign(t.elements[0], { grade, size, spacing });
      const r = solveAll(t).results[el.id];
      if (r && r.ok) return { grade, size, spacing };
    }
    return null;
  }
  if (el.type !== "beam") return null;
  const t = JSON.parse(JSON.stringify(project)); t.elements = [JSON.parse(JSON.stringify(el))];
  return autoSize(t.elements[0], t);
}

// Lightest flat or angle that passes per span band, for the veneer lintel schedule. The horizontal leg must carry the leaf.
function masonryLintelSchedule(project) {
  return [900, 1500, 2400, 3300].map(span => {
    const test = { ...project, pages: [{ mmPerPt: 1 }], elements: [] };
    const fits = Object.values(SECTIONS).filter(s => s.restrained && s.b >= 75).sort((a, b) => a.mass - b.mass).find(s => {
      const el = { id: "m", tag: "M", type: "beam", page: 0, x1: 0, y1: 0, x2: span, y2: 0, mat: "steel", sec: s.name, use: "lintel", support: "ss", loads: [], points: [], archKpa: 2 };
      const r = solveAll({ ...test, elements: [el] }).results.m;
      return r && r.ok;
    });
    return { span, section: fits ? fits.name : "by design" };
  });
}
