// Site, footing selection, wall and bracing logic. No DOM access.
"use strict";

// AS 4055:2012 Table 2.1A/B, serviceability speeds (m/s); ultimate speeds are in WIND_CLASSES
const WIND_SLS = { N1: 26, N2: 26, N3: 32, N4: 39, N5: 47, N6: 55, C1: 32, C2: 39, C3: 47, C4: 55 };

// AS 4055:2012 Tables 3.1 and 3.2(A): net coefficients for general roof areas and studs
function designWind(project) {
  const cls = project.windClass, cyclonic = /^C/.test(cls);
  const Vu = Number(project.vhu) || WIND_CLASSES[cls] || 0;
  const Vs = WIND_SLS[cls] || 0;
  const q = 0.6 * Vu * Vu / 1000, qs = 0.6 * Vs * Vs / 1000;
  const cpRoof = Number(project.cnet) || (cyclonic ? 1.44 : 1.0);
  const cpWall = cyclonic ? 1.22 : 0.9;
  // Tables 5.1 to 5.13 stay at or below about 0.96 q on the area of elevation
  const rack = Number(project.rackP) || 0.96 * q;
  return { Vu, Vs, q, qs, cpRoof, cpWall, roofUp: q * cpRoof, wall: q * cpWall, wallS: qs * 0.9, rack, cyclonic };
}

function classForSpeed(v) {
  return ["N1", "N2", "N3", "N4", "N5", "N6"].find(c => WIND_CLASSES[c] >= v) || null;
}

// AS 2870:2011 Table 2.3
function siteClassFromYs(ys) {
  if (!(ys > 0)) return null;
  return ys <= 20 ? "S" : ys <= 40 ? "M" : ys <= 60 ? "H1" : ys <= 75 ? "H2" : "E";
}

// AS 2870:2011 Table 3.1: actual construction to the equivalent used for footing selection
const CONSTRUCTION = {
  CF: { label: "Clad frame", eq: "CF" },
  ACF: { label: "Articulated rendered or sheet clad frame", eq: "AMV" },
  AMV: { label: "Articulated masonry veneer", eq: "AMV" },
  MV: { label: "Masonry veneer", eq: "MV" },
  AFM: { label: "Articulated full masonry", eq: "AFM" },
  FM: { label: "Full masonry", eq: "FM" },
  FMF: { label: "Full masonry external, framed internal", eq: "AFM" },
  AFMF: { label: "Articulated full masonry external, framed internal", eq: "MV" },
  SLF: { label: "Other single-leaf masonry, framed internal", eq: "AFM" },
  SLM: { label: "Other single-leaf masonry, masonry internal", eq: "FM" },
  PC: { label: "Reinforced precast panels, framed internal", eq: "AMV" }
};
const EQ_LABEL = { CF: "Clad frame", AMV: "Articulated masonry veneer", MV: "Masonry veneer", AFM: "Articulated full masonry", FM: "Full masonry" };

// AS 2870:2011 Table 4.1: maximum differential deflection
const DIFF_DEFL = { CF: ["L/300", 40], AMV: ["L/400", 30], MV: ["L/600", 20], AFM: ["L/800", 15], FM: ["L/2000", 10] };

// AS 2870:2011 Sections 2 to 4. Depths and reinforcement are read from the figure named.
function footingOptions(siteClass, bearing) {
  const out = [];
  const add = (id, label, ref, ok, why) => out.push({ id, label, ref, ok, why: why || "" });
  const engineered = siteClass === "E" || siteClass === "E-D" || siteClass === "P";
  const low50 = bearing < 50, low100 = bearing < 100;
  if (engineered) {
    add("engineered", "Engineered raft or piered system", siteClass === "P" ? "Section 4; Class P needs site-specific advice" : "Section 4, Cl 4.4 or 4.5 (beam spacing max 5 m on Class E)", true);
    return out;
  }
  const b50 = low50 ? "Bearing below the 50 kPa minimum under beams and slab panels (Cl 2.5)" : "";
  if (siteClass === "A") add("slab", "Footing slab", "Figure 3.2 or 3.3", !low50, b50);
  if (siteClass === "S") add("slab", "Footing slab", "Figure 3.3", !low50, b50);
  add("raft", "Stiffened raft", "Figure 3.1, Cl 3.2", !low50, b50);
  add("waffle", "Waffle raft", "Figure 3.4, Cl 3.4", !low50, b50);
  const noStrip = ["H1-D", "H2", "H2-D"].includes(siteClass);
  add("strip", "Strip footing system", "Figure 3.6, Cl 3.6", !noStrip && !low100,
    noStrip ? "Figure 3.6 has no design for this class; use Section 4" : low100 ? "Bearing below the 100 kPa minimum for strip and pad footings" : "");
  return out;
}

const WALL_TYPES = {
  timber: "Timber frame, clad",
  veneer: "Timber frame + masonry veneer",
  masonry: "Unreinforced masonry, loadbearing"
};

// AS 1684.2:2021 Table 8.18 unit capacities (kN/m at up to 2.7 m); check the grade, thickness and fixing conditions
const BRACE_TYPES = [
  { id: "a", label: "(a) Diagonal angle braces", kN: 0.8 },
  { id: "b", label: "(b) Tensioned metal straps", kN: 1.5 },
  { id: "c", label: "(c) Timber or metal angle braces", kN: 1.5 },
  { id: "d", label: "(d) Tensioned straps with stud straps", kN: 3.0 },
  { id: "h", label: "(h) Plywood, lowest tabled value", kN: 5.2 },
  { id: "i", label: "(i) Plywood, lower tabled value", kN: 6.6 },
  { id: "j", label: "(j) Decorative plywood, nailed", kN: 1.8 },
  { id: "k", label: "(k) Decorative plywood, glued and nailed", kN: 4.6 },
  { id: "custom", label: "Other, enter kN/m", kN: 0 }
];

// AS 3700:2018 Cl 3.3.2, Table 3.1 factor for clay or concrete, full bedding, M3 mortar; kh = 1 for 76/10 joints
function masonryFm(fuc, km) { return (km || 1.4) * Math.sqrt(fuc || 20); }

// AS 3700:2018 Cl 7.3.3.3
function masonryK(Srs, slab) {
  return slab ? Math.min(0.67, 0.67 - 0.02 * (Srs - 14)) : Math.min(0.67, 0.67 - 0.025 * (Srs - 10));
}

function wallLength(el, project) { return Math.hypot(el.x2 - el.x1, el.y2 - el.y1) * mmPerPt(project, el.page) / 1000; }

function checkWall(el, Nin, L, conc, project) {
  const wind = designWind(project), h = Number(el.h) || 2.4;
  const rows = [], type = el.wallType || "timber";
  const line = { G: Nin.G / L, Qf: Nin.Qf / L, Qr: Nin.Qr / L, Wu: Nin.Wu / L };
  const add = (name, star, cap, detail, units) => rows.push({ name, star, cap, u: cap > 0 ? Math.abs(star) / cap : (star > 0 ? 9.99 : 0), detail, units });
  const N = { ...Nin };
  let name;

  if (type === "masonry") {
    const t = Number(el.t) || 110, fm = masonryFm(el.fuc, el.km), phiC = 0.75, phiF = 0.6;
    const self = 19 * t * 1e-3 * h;
    const G = line.G + self / 2;
    const Srs = (el.topSupport === false ? 2.5 : 1) * h * 1000 / t;
    const k = Math.max(0, masonryK(Srs, !!el.slab));
    const Fd = Math.max(1.35 * (line.G + self), 1.2 * (line.G + self) + 1.5 * line.Qf, 1.2 * (line.G + self) + 1.5 * line.Qr + 0.4 * line.Qf);
    add("Compression, simple rules", Fd, k * phiC * fm * t, `f'm = ${fm.toFixed(2)} MPa, Srs = ${Srs.toFixed(1)}, k = ${k.toFixed(2)}. Cl 7.3.3`, "kN/m");
    const Zd = 1000 * t * t / 6, fmt = el.fmt == null ? 0.2 : Number(el.fmt);
    const fd = Math.min(0.36, Math.max(0, 0.9 * G - line.Wu) / t);
    const Mcv = Math.min(phiF * fmt * Zd + fd * Zd, 3 * phiF * fmt * Zd) * 1e-6;
    const Mdv = wind.wall * h * h / (el.topSupport === false ? 2 : 8);
    add("Face wind, vertical bending", Mdv, Mcv, `f'mt = ${fmt} MPa, fd = ${fd.toFixed(3)} MPa. Cl 7.4.2, one-way only`, "kNm/m");
    const concU = factoredReaction(conc);
    if (concU > 0) {
      const b = Math.max(0.3, Number(el.bearLen) || 0.45);
      add("Point load over bearing length", concU / b + Fd, k * phiC * fm * t, `Over ${b} m without the bearing factor; refine to Cl 7.3.5`, "kN/m");
    }
    N.G += self * L;
    name = `${t} masonry f'uc ${el.fuc || 20}`;
  } else {
    const size = el.size || "90x35", grade = el.grade || "MGP10";
    const s = (Number(el.spacing) || 450) / 1000, plies = Number(el.plies) || 1;
    const m = timberProps(project.timberGrades, grade, size, plies, 1);
    if (!m) return { error: "Choose a stud size" };
    const frame = 0.4 * h, nog = Math.min(Number(el.nog) || 1350, h * 1000);
    const n = Math.max(1, Number(el.concStuds) || 3);
    const G = (line.G + frame) * s + conc.G / n, Qf = line.Qf * s + conc.Qf / n, Qr = line.Qr * s + conc.Qr / n;
    // AS 1720.1 Cl 3.3.2: S3 = Lax/d about the major axis, S4 = Lay/b between noggings
    const k12Of = S => { const x = m.rhoC * S; return x <= 10 ? 1 : x <= 20 ? 1.5 - 0.05 * x : 200 / (x * x); };
    const kx = { k12: k12Of(h * 1000 / m.d) }, ky = { k12: k12Of(nog / m.B) };
    const cap = (k1, k12) => m.phi * k1 * k12 * m.fc * m.A * 1e-3;
    [["1.35G", 1.35 * G, 0.57], ["1.2G + 1.5Q(floor)", 1.2 * G + 1.5 * Qf, 0.8], ["1.2G + 1.5Q(roof) + 0.4Q(floor)", 1.2 * G + 1.5 * Qr + 0.4 * Qf, 0.94]].forEach(([n, st, k1]) => {
      add("Stud axial " + n, st, Math.min(cap(k1, kx.k12), cap(k1, ky.k12)), `k1 = ${k1}, k12 = ${Math.min(kx.k12, ky.k12).toFixed(2)}. Cl 3.3`, "kN");
    });
    const Mw = wind.wall * s * h * h / 8, Nw = 1.2 * G + 0.4 * Qf;
    const kb = k12Beam(m, nog, true);
    const Md = m.phi * 1.0 * kb.k12 * m.fb * m.Zx * 1e-6;
    const i1 = (Mw / Md) ** 2 + Nw / cap(1, ky.k12), i2 = Mw / Md + Nw / cap(1, kx.k12);
    rows.push({ name: "Stud wind + axial, Eq 3.5(1)", star: i1, cap: 1, u: i1, detail: `M* = ${Mw.toFixed(2)} kNm, phiM = ${Md.toFixed(2)} kNm, N* = ${Nw.toFixed(1)} kN`, units: "ratio" });
    rows.push({ name: "Stud wind + axial, Eq 3.5(2)", star: i2, cap: 1, u: i2, detail: "1.2G + Wu + 0.4Q(floor), k1 = 1.0", units: "ratio" });
    const dw = 5 * wind.wallS * s * h ** 4 / 384 * 1e12 / (m.E * m.Ix);
    add("Stud wind deflection", dw, h * 1000 / (Number(el.deflOver) || 200), `Ws = ${wind.wallS.toFixed(2)} kPa`, "mm");
    N.G += (type === "veneer" ? 2.2 : 0.4) * h * L;
    name = `${plies > 1 ? plies + "/" : ""}${size} ${grade} @ ${Math.round(s * 1000)}${type === "veneer" ? " + veneer" : ""}`;
  }

  const netUp = Math.max(0, line.Wu - 0.9 * (N.G / L));
  let strip = null;
  if (el.onGround) {
    const B = Number(el.stripB) || 300, D = Number(el.stripD) || 300, qa = Number(project.bearing) || 100;
    const lineS = N.G / L + Math.max(line.Qf, line.Qr) + 24 * B * D * 1e-6;
    strip = { B, D, qa, line: lineS, pressure: lineS / (B / 1000), reqB: lineS / qa * 1000 };
    add("Strip footing bearing", strip.pressure, qa, `Service line load ${lineS.toFixed(1)} kN/m; width needed ${Math.ceil(strip.reqB)} mm`, "kPa");
  }
  const util = rows.reduce((a, b) => Math.max(a, b.u), 0);
  return { type: "wall", name, N, L, h, rows, util, ok: util <= 1, netUp, strip, line: { G: N.G / L, Qf: line.Qf, Qr: line.Qr, Wu: line.Wu } };
}

// In-plane capacity of one wall panel, kN
function braceCapacity(el, res, project) {
  const L = Number(el.braceLen) || wallLength(el, project), h = Number(el.h) || 2.4;
  if ((el.wallType || "timber") === "masonry") {
    const t = Number(el.t) || 110, fmt = el.fmt == null ? 0.2 : Number(el.fmt);
    const fms = Math.min(0.35, Math.max(0.15, 1.25 * fmt));
    const G = res ? res.N.G * L / res.L : 0, Up = res ? res.N.Wu * L / res.L : 0;
    const Ad = L * 1000 * t, Fmin = Math.max(0, 0.9 * G - Up);
    const fd = Math.min(2, Fmin * 1000 / Ad);
    const Vs = 0.6 * fms * Ad * 1e-3 + 0.3 * fd * Ad * 1e-3;
    const Vot = Fmin * (L / 2) / h;
    return { cap: Math.min(Vs, Vot), detail: `AS 3700 Cl 7.5.4 V = ${Vs.toFixed(1)} kN; overturning about the toe ${Vot.toFixed(1)} kN`, L };
  }
  const bt = BRACE_TYPES.find(b => b.id === el.braceType) || BRACE_TYPES[0];
  const unit = bt.id === "custom" ? Number(el.braceKn) || 0 : bt.kN;
  const adj = Math.min(1, 2.7 / h);
  return { cap: unit * adj * L, detail: `AS 1684.2 Table 8.18 ${bt.id}: ${unit} kN/m x ${adj.toFixed(2)} x ${L.toFixed(2)} m`, L };
}

// AS 4055:2012 Cl 5.1: racking force = area of elevation x pressure, each direction, each storey
function bracingSummary(project, results) {
  const wind = designWind(project);
  return project.pages.map((pg, i) => {
    const b = pg.bracing || {};
    const walls = project.elements.filter(e => e.type === "wall" && e.page === i);
    const mm = mmPerPt(project, i) / 1000;
    const xs = walls.flatMap(w => [w.x1, w.x2]), ys = walls.flatMap(w => [w.y1, w.y2]);
    const extX = xs.length ? (Math.max(...xs) - Math.min(...xs)) * mm : 0, extY = ys.length ? (Math.max(...ys) - Math.min(...ys)) * mm : 0;
    const bx = Number(b.lenX) || extX, by = Number(b.lenY) || extY, H = Number(b.elevH) || 2.2;
    const gapLimit = Number(project.braceSpacing) || 9;
    const dir = horizontal => {
      const list = walls.filter(w => w.brace && (Math.abs(w.x2 - w.x1) >= Math.abs(w.y2 - w.y1)) === horizontal);
      const F = wind.rack * H * (horizontal ? by : bx);
      const items = list.map(w => ({ tag: w.tag, ...braceCapacity(w, results[w.id], project) }));
      const cap = items.reduce((s, x) => s + x.cap, 0);
      const pos = list.map(w => (horizontal ? (w.y1 + w.y2) / 2 : (w.x1 + w.x2) / 2) * mm).sort((a, c) => a - c);
      let gap = 0; for (let k = 1; k < pos.length; k++) gap = Math.max(gap, pos[k] - pos[k - 1]);
      return { F, cap, items, gap, ok: F > 0 && cap >= F && gap <= gapLimit, n: list.length };
    };
    return { page: i, H, bx, by, x: dir(true), y: dir(false), walls: walls.length };
  }).filter(s => s.walls > 0);
}

// Every beam, column and wall: where its load goes next
function loadPathRows(project, solved) {
  const rows = [], conn = solved.conn;
  if (!conn) return rows;
  const carriers = {};
  Object.entries(conn.onBeam).forEach(([host, list]) => list.forEach(c => { (carriers[c.from] = carriers[c.from] || []).push({ end: c.end, to: host }); }));
  Object.entries(conn.onSupport).forEach(([host, list]) => list.forEach(c => { (carriers[c.from] = carriers[c.from] || []).push({ end: c.end, to: host }); }));
  const tag = id => (project.elements.find(e => e.id === id) || {}).tag;
  const referenced = new Set();
  project.elements.forEach(e => (e.points || []).forEach(p => { if (p.src) referenced.add(String(p.src)); }));
  project.elements.forEach(e => {
    if (e.type === "beam") {
      const n = e.support === "cant" ? [1] : [1, 2];
      n.forEach(end => {
        const c = (carriers[e.id] || []).find(x => x.end === end);
        const linked = referenced.has(`${e.id}:${end}`);
        rows.push({ id: e.id, from: `${e.tag} end ${end}`, to: c ? tag(c.to) : linked ? "linked to another level" : null });
      });
    } else if (e.type === "column" || e.type === "wall") {
      const c = (carriers[e.id] || [])[0];
      const lower = referenced.has(e.id);
      const ground = e.type === "wall" && e.onGround;
      const unloaded = e.type === "wall" && !(e.loads || []).length && !(e.points || []).length && !(conn.onSupport[e.id] || []).length;
      rows.push({ id: e.id, from: e.tag, to: c ? tag(c.to) : lower ? "linked to another level" : ground ? "strip footing" : unloaded ? "non-loadbearing, on the floor" : null });
    }
  });
  return rows;
}
