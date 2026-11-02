// Structural engine: section properties, load path and member checks. No DOM access.
// Units: kN, m for actions; mm, MPa for sections.
"use strict";

const COMPONENTS = ["G", "Qf", "Qr", "Wu"];
const TRANSFER_TOL_MM = 100;
const STATIONS = 200;
const zeroVec = () => ({ G: 0, Qf: 0, Qr: 0, Wu: 0 });
const addVec = (a, b, f = 1) => { COMPONENTS.forEach(c => { a[c] += (b[c] || 0) * f; }); return a; };

// ---------- Section properties ----------

function fyHotRolled(t) { return t <= 11 ? 320 : t <= 17 ? 300 : 280; } // 300PLUS

function iSection(name, d, b, tf, tw, r, mass, family) {
  const fa = (1 - Math.PI / 4) * r * r, h = d - 2 * tf;
  const yf = d / 2 - tf - 0.2234 * r, xf = tw / 2 + 0.2234 * r;
  const Ix = (b * d ** 3 - (b - tw) * h ** 3) / 12 + 4 * fa * yf ** 2;
  const Iy = (2 * tf * b ** 3 + h * tw ** 3) / 12 + 4 * fa * xf ** 2;
  const Sx = b * tf * (d - tf) + tw * h * h / 4 + 4 * fa * yf;
  const s = {
    name, family, shape: "I", mass, d, b, tf, tw, r,
    A: 2 * b * tf + h * tw + 4 * fa, Ix, Iy, Zx: Ix / (d / 2), Sx,
    J: (2 * b * tf ** 3 + (d - tf) * tw ** 3) / 3, Iw: Iy * (d - tf) ** 2 / 4,
    fy: fyHotRolled(tf), fyw: fyHotRolled(tw), E: 200000, alphaB: 0,
    Aw: d * tw, flangeOutstand: (b - tw - 2 * r) / 2, webClear: h - 2 * r
  };
  return s;
}

function pfcSection(name, d, b, tf, tw, r, mass) {
  const fa = (1 - Math.PI / 4) * r * r, h = d - 2 * tf;
  const yf = d / 2 - tf - 0.2234 * r, xf = tw + 0.2234 * r;
  const A = 2 * b * tf + h * tw + 2 * fa;
  const xc = (2 * b * tf * b / 2 + h * tw * tw / 2 + 2 * fa * xf) / A;
  const Ix = (b * d ** 3 - (b - tw) * h ** 3) / 12 + 2 * fa * yf ** 2;
  const Iy = 2 * (tf * b ** 3 / 12 + b * tf * (b / 2 - xc) ** 2) + h * tw ** 3 / 12 + h * tw * (tw / 2 - xc) ** 2 + 2 * fa * (xf - xc) ** 2;
  const Sx = b * tf * (d - tf) + tw * h * h / 4 + 2 * fa * yf;
  const bw = b - tw / 2, df = d - tf;
  const Iw = tf * bw ** 3 * df ** 2 / 12 * (3 * bw * tf + 2 * df * tw) / (6 * bw * tf + df * tw);
  return {
    name, family: "PFC", shape: "I", mass, d, b, tf, tw, r, A, Ix, Iy, Zx: Ix / (d / 2), Sx,
    J: (2 * b * tf ** 3 + (d - tf) * tw ** 3) / 3, Iw,
    fy: fyHotRolled(tf), fyw: fyHotRolled(tw), E: 200000, alphaB: 0.5,
    Aw: d * tw, flangeOutstand: b - tw - r, webClear: h - 2 * r
  };
}

function rhsSection(d, b, t) {
  const ro = t <= 3 ? 2 * t : 2.5 * t, ri = ro - t;
  const solid = (D, B, R, axisDepth) => {
    const ca = (1 - Math.PI / 4) * R * R, y = axisDepth / 2 - 0.2234 * R;
    return { A: D * B - 4 * ca, I: B * D ** 3 / 12 - 4 * ca * y * y, S: B * D * D / 4 - 4 * ca * y };
  };
  const o = solid(d, b, ro, d), i = solid(d - 2 * t, b - 2 * t, ri, d - 2 * t);
  const oy = solid(b, d, ro, b), iy = solid(b - 2 * t, d - 2 * t, ri, b - 2 * t);
  const A = o.A - i.A, Ix = o.I - i.I, Iy = oy.I - iy.I;
  const am = (d - t) * (b - t) - (4 - Math.PI) * (ro - t / 2) ** 2;
  const pm = 2 * (d + b - 2 * t) - (8 - 2 * Math.PI) * (ro - t / 2);
  const name = (d === b ? `${d}x${b}x${t} SHS` : `${d}x${b}x${t} RHS`);
  return {
    name, family: d === b ? "SHS" : "RHS", shape: "RHS", mass: A * 7850e-6, d, b, t, A, Ix, Iy,
    Zx: Ix / (d / 2), Sx: o.S - i.S, J: 4 * am * am * t / pm, Iw: 0,
    fy: 450, fyw: 450, E: 200000, alphaB: -0.5, Aw: 2 * (d - 2 * t) * t,
    flangeOutstand: b - 2 * t, webClear: d - 2 * t, tf: t, tw: t
  };
}

const SECTIONS = {};
STEEL_UB.forEach(r => { SECTIONS[r[0]] = iSection(r[0], r[1], r[2], r[3], r[4], r[5], r[6], "UB"); });
STEEL_UC.forEach(r => { SECTIONS[r[0]] = iSection(r[0], r[1], r[2], r[3], r[4], r[5], r[6], "UC"); });
STEEL_PFC.forEach(r => { SECTIONS[r[0]] = pfcSection(r[0], r[1], r[2], r[3], r[4], r[5], r[6]); });
STEEL_RHS.forEach(r => { const s = rhsSection(r[0], r[1], r[2]); SECTIONS[s.name] = s; });

// AS 4100 Cl 5.2: effective section modulus
function steelZe(s) {
  const k = Math.sqrt(s.fy / 250);
  const hollow = s.shape === "RHS";
  const lf = s.flangeOutstand / s.tf * k;
  const lep = hollow ? 30 : 9, ley = hollow ? 40 : 16;
  const lw = s.webClear / s.tw * Math.sqrt(s.fyw / 250);
  const rf = lf / ley, rw = lw / 115;
  const Zc = Math.min(s.Sx, 1.5 * s.Zx);
  if (lf <= lep && lw <= 82) return { Ze: Zc, cls: "compact" };
  if (rf >= rw) {
    if (lf <= ley) return { Ze: s.Zx + (ley - lf) / (ley - lep) * (Zc - s.Zx), cls: "non-compact" };
    return { Ze: s.Zx * ley / lf, cls: "slender" };
  }
  if (lw <= 115) return { Ze: s.Zx + (115 - lw) / (115 - 82) * (Zc - s.Zx), cls: "non-compact" };
  return { Ze: s.Zx * 115 / lw, cls: "slender" };
}

// AS 4100 Cl 5.6.1.1(a): member moment capacity
function steelMb(s, Le, alphaM) {
  const Ze = steelZe(s).Ze, Ms = s.fy * Ze;
  const G = 80000, pi2 = Math.PI ** 2;
  const Mo = Math.sqrt(pi2 * s.E * s.Iy / (Le * Le) * (G * s.J + pi2 * s.E * s.Iw / (Le * Le)));
  const r = Ms / Mo;
  const alphaS = Math.min(1, 0.6 * (Math.sqrt(r * r + 3) - r));
  return { Ms: 0.9 * Ms * 1e-6, Mb: 0.9 * Math.min(Ms, alphaM * alphaS * Ms) * 1e-6, alphaS, Mo: Mo * 1e-6 };
}

// AS 4100 Cl 5.11: shear yield capacity, with the Cl 5.11.5.1 stocky-web limit flagged
function steelVu(s) {
  const slender = s.webClear / s.tw > 82 * Math.sqrt(250 / s.fyw);
  let Vw = 0.6 * s.fyw * s.Aw;
  if (slender) { Vw *= Math.min(1, (82 / (s.webClear / s.tw * Math.sqrt(s.fyw / 250))) ** 2); }
  return 0.9 * Vw * 1e-3;
}

// AS 4100 Cl 6.3.3: member section constant. alphaC from lambda_n and alpha_b.
function alphaC(lambdaN, alphaB) {
  const aa = 2100 * (lambdaN - 13.5) / (lambdaN * lambdaN - 15.3 * lambdaN + 2050);
  const lam = lambdaN + aa * alphaB;
  const eta = Math.max(0, 0.00326 * (lam - 13.5));
  const q = (lam / 90) ** 2;
  const xi = (q + 1 + eta) / (2 * q);
  return Math.min(1, xi * (1 - Math.sqrt(Math.max(0, 1 - (90 / (xi * lam)) ** 2))));
}

// AS 4100 Cl 6.2 form factor by effective widths of the plate elements
function steelKf(s) {
  const k = Math.sqrt(s.fy / 250), kw = Math.sqrt(s.fyw / 250);
  if (s.shape === "RHS") {
    const le = s.flangeOutstand / s.t * k, lw = s.webClear / s.t * k;
    const lost = 2 * s.t * (s.flangeOutstand * Math.max(0, 1 - 40 / le) + s.webClear * Math.max(0, 1 - 40 / lw));
    return Math.max(0.1, 1 - lost / s.A);
  }
  const lf = s.flangeOutstand / s.tf * k, lw = s.webClear / s.tw * kw;
  const nOut = s.family === "PFC" ? 2 : 4;
  const lost = nOut * s.tf * s.flangeOutstand * Math.max(0, 1 - 16 / lf) + s.tw * s.webClear * Math.max(0, 1 - 45 / lw);
  return Math.max(0.1, 1 - lost / s.A);
}

function steelColumn(s, heightM, ke) {
  const Le = heightM * 1000 * ke, kf = steelKf(s);
  const fy = Math.min(s.fy, s.fyw);
  const Ns = kf * s.A * fy;
  const rmin = Math.sqrt(Math.min(s.Ix, s.Iy) / s.A);
  const lambdaN = Le / rmin * Math.sqrt(kf) * Math.sqrt(fy / 250);
  const ac = lambdaN < 10 ? 1 : alphaC(lambdaN, s.alphaB);
  return { phiNs: 0.9 * Ns * 1e-3, phiNc: 0.9 * ac * Ns * 1e-3, phiNt: 0.9 * s.A * fy * 1e-3, kf, lambdaN, ac };
}

// ---------- Timber (AS 1720.1:2010) ----------

function parseSize(size) { const [d, b] = String(size).split("x").map(Number); return { d, b }; }

function timberProps(grades, grade, size, plies, cat) {
  const g = grades[grade];
  if (!g) return null;
  const { d, b } = parseSize(size), n = plies || 1, B = b * n;
  const band = g.bands.find(x => d <= x[0]) || g.bands[g.bands.length - 1];
  const k11 = g.sizeFactor && d > 300 ? (300 / d) ** 0.167 : 1;
  return {
    grade, d, b, B, n, E: g.E, fb: band[1] * k11, fs: band[2], fc: band[3], j2: g.j2, rhoB: g.rhoB, rhoC: g.rhoC,
    phi: g.phi[cat === 2 ? 1 : 0], A: B * d, Ix: B * d ** 3 / 12, Zx: B * d * d / 6,
    swKnPerM: g.density * B * d * 1e-6 * 9.81e-3,
    name: `${n > 1 ? n + "/" : ""}${size} ${grade}`
  };
}

function k12Beam(t, Lay, compEdgeLoaded) {
  if (Lay / t.d <= 64 * (t.B / t.d) ** 2) { if (compEdgeLoaded) return { S1: 0, k12: 1 }; }
  const S1 = compEdgeLoaded ? 1.25 * (t.d / t.B) * Math.sqrt(Lay / t.d)
    : (t.d / t.B) ** 1.35 * (Lay / t.d) ** 0.25;
  const x = t.rhoB * S1;
  return { S1, k12: x <= 10 ? 1 : x <= 20 ? 1.5 - 0.05 * x : 200 / (x * x) };
}

function k12Column(t, Lmm) {
  const S = Lmm / Math.min(t.d, t.B), x = t.rhoC * S;
  return { S, k12: x <= 10 ? 1 : x <= 20 ? 1.5 - 0.05 * x : 200 / (x * x) };
}

// ---------- Beam analysis ----------

function memberProps(el, grades, cat) {
  if (el.mat === "timber") {
    const t = timberProps(grades, el.grade, el.size, el.plies, cat);
    return t ? { ...t, kind: "timber", I: t.Ix, swKnPerM: t.swKnPerM } : null;
  }
  const s = SECTIONS[el.sec];
  return s ? { ...s, kind: "steel", I: s.Ix, swKnPerM: s.mass * 9.81e-3 } : null;
}

function shape(L, cant, udl, points) {
  const n = STATIONS, M = new Float64Array(n + 1), V = new Float64Array(n + 1);
  const R = { r1: 0, r2: 0, mRoot: 0 };
  for (let i = 0; i <= n; i++) {
    const x = L * i / n;
    if (cant) {
      M[i] = -udl * (L - x) ** 2 / 2; V[i] = udl * (L - x);
      points.forEach(p => { if (p.x >= x) { M[i] -= p.P * (p.x - x); V[i] += p.P; } });
    } else {
      M[i] = udl * x * (L - x) / 2; V[i] = udl * (L / 2 - x);
      points.forEach(p => {
        const ra = p.P * (L - p.x) / L;
        M[i] += x <= p.x ? ra * x : ra * x - p.P * (x - p.x);
        V[i] += x < p.x ? ra : ra - p.P;
      });
    }
  }
  if (cant) {
    R.r1 = udl * L + points.reduce((s, p) => s + p.P, 0);
    R.mRoot = M[0];
  } else {
    R.r1 = udl * L / 2 + points.reduce((s, p) => s + p.P * (L - p.x) / L, 0);
    R.r2 = udl * L / 2 + points.reduce((s, p) => s + p.P * p.x / L, 0);
  }
  return { M, V, R };
}

// Double integration of M: returns peak deflection per unit 1/EI (kN.m^3)
function deflShape(M, L, cant) {
  const n = STATIONS, h = L / n, th = new Float64Array(n + 1), y = new Float64Array(n + 1);
  for (let i = 1; i <= n; i++) th[i] = th[i - 1] - (M[i - 1] + M[i]) / 2 * h;
  for (let i = 1; i <= n; i++) y[i] = y[i - 1] + (th[i - 1] + th[i]) / 2 * h;
  if (!cant) { const end = y[n]; for (let i = 0; i <= n; i++) y[i] -= end * i / n; }
  return y;
}

function comboList(concFloor, concRoof) {
  return [
    { name: "1.35G", f: { G: 1.35 }, k1: 0.57 },
    { name: "1.2G + 1.5Q(floor)", f: { G: 1.2, Qf: 1.5 }, k1: 0.80 },
    { name: "1.2G + 1.5Q(roof) + 0.4Q(floor)", f: { G: 1.2, Qr: 1.5, Qf: 0.4 }, k1: 0.94 },
    { name: "0.9G + Wu (uplift)", f: { G: 0.9, Wu: -1 }, k1: 1.0 },
    { name: `1.2G + 1.5P (${concFloor ? "1.8 kN floor" : "1.1 kN roof"})`, f: { G: 1.2, conc: 1.5 }, k1: concFloor ? 0.80 : 0.94, skip: !concFloor && !concRoof }
  ];
}

function analyseBeam(el, L, loadsVec, pointLoads, project) {
  const area = Number(el.area) || totalWidth(el, project) * L;
  const cat = area > 25 ? 2 : 1;
  const m = memberProps(el, project.timberGrades, cat);
  if (!m) return { error: "Choose a section" };
  const cant = el.support === "cant";
  const w = { ...loadsVec }; w.G += m.swKnPerM;
  const shapes = {};
  COMPONENTS.forEach(c => {
    shapes[c] = shape(L, cant, w[c], pointLoads.map(p => ({ x: p.x, P: p.vec[c] || 0 })));
  });
  const hasFloor = w.Qf > 0 || pointLoads.some(p => p.vec.Qf > 0);
  const hasRoof = w.Qr > 0 || pointLoads.some(p => p.vec.Qr > 0);
  const concP = hasFloor ? 1.8 : 1.1;
  shapes.conc = shape(L, cant, 0, [{ x: cant ? L : L / 2, P: concP }]);
  const combos = comboList(hasFloor, hasRoof).filter(c => !c.skip);

  const Ltop = (Number(el.Ltop) || project.defaultLtop || L * 1000);
  const Lbot = Number(el.Lbot) || L * 1000;
  const hasPts = pointLoads.length > 0;
  let vu = m.kind === "steel" ? steelVu(m) : 0;
  const rows = combos.map(c => {
    let Mpeak = 0, Vpeak = 0;
    for (let i = 0; i <= STATIONS; i++) {
      let Mi = 0, Vi = 0;
      Object.keys(c.f).forEach(k => { Mi += c.f[k] * shapes[k].M[i]; Vi += c.f[k] * shapes[k].V[i]; });
      if (Math.abs(Mi) > Math.abs(Mpeak)) Mpeak = Mi;
      if (Math.abs(Vi) > Math.abs(Vpeak)) Vpeak = Vi;
    }
    // Sagging puts the top edge in compression; loads sit on the top edge.
    const topComp = Mpeak >= 0, Lr = Math.min(topComp ? Ltop : Lbot, L * 1000);
    let phiM, phiV, detail;
    if (m.kind === "steel") {
      // AS 4100 Table 5.6.3(B): top flange load, FU segment 2.0, otherwise 1.4 when the top flange is compressed
      const kl = cant && Lr >= L * 1000 - 1 ? 2.0 : topComp ? 1.4 : 1.0;
      const am = (!cant && !hasPts && Lr >= L * 1000 - 1) ? 1.13 : 1.0;
      const r = steelMb(m, Math.max(Lr, 1) * kl, am);
      phiM = r.Mb; phiV = vu;
      detail = `Le = ${(Lr * kl / 1000).toFixed(2)} m, am = ${am}, as = ${r.alphaS.toFixed(2)}, phiMs = ${r.Ms.toFixed(1)} kNm`;
    } else {
      const k = k12Beam(m, Lr, topComp);
      phiM = m.phi * c.k1 * k.k12 * m.fb * m.Zx * 1e-6;
      phiV = m.phi * c.k1 * m.fs * (2 / 3) * m.A * 1e-3;
      detail = `phi = ${m.phi}, k1 = ${c.k1}, k12 = ${k.k12.toFixed(2)}, fb = ${m.fb.toFixed(1)} MPa`;
    }
    return { name: c.name, M: Mpeak, V: Vpeak, phiM, phiV, uM: Math.abs(Mpeak) / phiM, uV: Math.abs(Vpeak) / phiV, detail, Lr };
  });

  // Serviceability, AS/NZS 1170.0 Table C1 Note 1
  const use = project.uses[el.use] || project.uses.floor;
  const y = {}; COMPONENTS.forEach(c => { y[c] = deflShape(shapes[c].M, L, cant); });
  const j2 = m.kind === "timber" ? m.j2 : 1;
  const k = 1e12 / (m.E * m.I);
  let dPeak = 0;
  for (let i = 0; i <= STATIONS; i++) {
    const creep = y.G[i] + 0.4 * y.Qf[i];
    const inc = Math.max(0.3 * y.Qf[i], 0.7 * y.Qr[i]);
    const d = (j2 * creep + inc) * k;
    if (Math.abs(d) > Math.abs(dPeak)) dPeak = d;
  }
  const spanForLimit = (cant ? 2 : 1) * L * 1000;
  let dLimit = spanForLimit / use.spanOver;
  if (use.maxMm) dLimit = Math.min(dLimit, use.maxMm);
  const uD = Math.abs(dPeak) / dLimit;

  const gov = rows.reduce((a, b) => (Math.max(b.uM, b.uV) > Math.max(a.uM, a.uV) ? b : a));
  const util = Math.max(uD, gov.uM, gov.uV);
  const r1 = zeroVec(), r2 = zeroVec();
  COMPONENTS.forEach(c => { r1[c] = shapes[c].R.r1; r2[c] = shapes[c].R.r2; });
  const Mstar = rows.reduce((a, b) => Math.max(a, Math.abs(b.M)), 0);
  const Vstar = rows.reduce((a, b) => Math.max(a, Math.abs(b.V)), 0);
  return {
    type: "beam", name: m.name, L, cat, area, m, w, rows, gov, Mstar, Vstar, dPeak, dLimit, uD, util, ok: util <= 1,
    r1, r2, r1u: factoredReaction(r1), r2u: cant ? 0 : factoredReaction(r2),
    reqI: m.I * uD * 1e-6, reqZ: m.Zx * Math.max(gov.uM, 0) * 1e-3,
    cls: m.kind === "steel" ? steelZe(m).cls : "", swKnPerM: m.swKnPerM, mass: m.kind === "steel" ? m.mass : m.swKnPerM / 9.81e-3
  };
}

function totalWidth(el, project) {
  return (el.loads || []).reduce((s, l) => {
    const sf = project.surfaces.find(x => x.id === l.surface);
    return s + (sf && sf.wind ? (Number(l.width) || 0) : (sf && (sf.Qf > 0) ? (Number(l.width) || 0) : 0));
  }, 0);
}

function factoredReaction(v) { return Math.max(1.35 * v.G, 1.2 * v.G + 1.5 * v.Qf, 1.2 * v.G + 1.5 * v.Qr + 0.4 * v.Qf); }
function upliftReaction(v) { return Math.max(0, v.Wu - 0.9 * v.G); }

function checkColumn(el, N, project) {
  const h = Number(el.height) || 2.7, Nstar = factoredReaction(N), up = upliftReaction(N);
  const m = memberProps(el, project.timberGrades, 1);
  if (!m) return { error: "Choose a section" };
  const rows = [];
  if (m.kind === "steel") {
    const c = steelColumn(m, h, Number(el.ke) || 1);
    rows.push({ name: "Compression", star: Nstar, cap: c.phiNc, u: Nstar / c.phiNc, detail: `lambda_n = ${c.lambdaN.toFixed(0)}, alpha_c = ${c.ac.toFixed(2)}, kf = ${c.kf.toFixed(2)}` });
    rows.push({ name: "Uplift (tension)", star: up, cap: c.phiNt, u: up / c.phiNt, detail: "Gross yield; check connections" });
  } else {
    const k = k12Column(m, h * 1000 * (Number(el.ke) || 1));
    [["1.35G", 1.35 * N.G, 0.57], ["1.2G + 1.5Q(floor)", 1.2 * N.G + 1.5 * N.Qf, 0.8], ["1.2G + 1.5Q(roof) + 0.4Q(floor)", 1.2 * N.G + 1.5 * N.Qr + 0.4 * N.Qf, 0.94]].forEach(([name, star, k1]) => {
      const cap = m.phi * k1 * k.k12 * m.fc * m.A * 1e-3;
      rows.push({ name, star, cap, u: star / cap, detail: `S = ${k.S.toFixed(1)}, k12 = ${k.k12.toFixed(2)}, k1 = ${k1}` });
    });
    rows.push({ name: "Uplift", star: up, cap: Infinity, u: 0, detail: "Check connections for this tension" });
  }
  const util = rows.reduce((a, b) => Math.max(a, b.u), 0);
  return { type: "column", name: m.name, N, Nstar, up, rows, util, ok: util <= 1, h, m };
}

function checkFooting(el, N, project) {
  const B = Number(el.B) || 600, L = Number(el.Lf) || B, D = Number(el.D) || 400, qa = Number(el.qa) || project.bearing || 100;
  const area = B * L * 1e-6, Wf = area * D * 1e-3 * 24;
  const service = N.G + Math.max(N.Qf, N.Qr) + Wf;
  const pressure = service / area, uB = pressure / qa;
  const netUp = Math.max(0, N.Wu - 0.9 * N.G);
  const uU = netUp > 0 ? netUp / (0.9 * Wf) : 0;
  const util = Math.max(uB, uU);
  const reqA = service / qa;
  const reqD = netUp > 0 ? netUp / (0.9 * area * 24) * 1000 : 0;
  return { type: "footing", name: `${B}x${L}x${D} pad`, N, Wf, service, pressure, qa, uB, uU, util, ok: util <= 1, netUp, reqSide: Math.sqrt(reqA) * 1000, reqD, B, L, D };
}

// ---------- Load path ----------

function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

function projectOn(pt, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
  if (!len2) return { t: 0, d: dist(pt, a), len: 0 };
  const t = ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / len2;
  const q = { x: a.x + t * dx, y: a.y + t * dy };
  return { t, d: dist(pt, q), len: Math.sqrt(len2) };
}

const ends = el => [{ x: el.x1, y: el.y1 }, { x: el.x2, y: el.y2 }];

// Finds which member each beam end and column lands on, within TRANSFER_TOL_MM on the same page.
function buildConnections(project) {
  const onBeam = {}, onSupport = {};
  const add = (map, key, item) => { (map[key] = map[key] || []).push(item); };
  const els = project.elements;
  els.filter(e => e.type === "beam").forEach(b => {
    const mm = mmPerPt(project, b.page), tol = TRANSFER_TOL_MM / mm;
    ends(b).forEach((pt, i) => {
      if (b.support === "cant" && i === 1) return;
      const sup = els.find(e => (e.type === "column" || e.type === "footing") && e.page === b.page && dist(e, pt) <= tol)
        || null;
      const col = els.find(e => e.type === "column" && e.page === b.page && dist(e, pt) <= tol) || sup;
      if (col) { add(onSupport, col.id, { from: b.id, end: i + 1 }); return; }
      const wall = els.find(o => {
        if (o.type !== "wall" || o.page !== b.page) return false;
        const a = ends(o), p = projectOn(pt, a[0], a[1]);
        return p.d <= tol && p.t >= -0.02 && p.t <= 1.02;
      });
      if (wall) { add(onSupport, wall.id, { from: b.id, end: i + 1 }); return; }
      const host = els.find(o => {
        if (o.type !== "beam" || o.id === b.id || o.page !== b.page) return false;
        const a = ends(o), p = projectOn(pt, a[0], a[1]);
        if (p.d > tol || p.t < 0 || p.t > 1) return false;
        return p.t * p.len > tol && (1 - p.t) * p.len > tol;
      });
      if (host) {
        const a = ends(host), p = projectOn(pt, a[0], a[1]);
        add(onBeam, host.id, { from: b.id, end: i + 1, x: p.t * p.len * mmPerPt(project, host.page) / 1000 });
      }
    });
  });
  els.filter(e => e.type === "column").forEach(c => {
    const mm = mmPerPt(project, c.page), tol = TRANSFER_TOL_MM / mm;
    const f = els.find(e => e.type === "footing" && e.page === c.page && dist(e, c) <= tol);
    if (f) add(onSupport, f.id, { from: c.id });
  });
  return { onBeam, onSupport };
}

function mmPerPt(project, page) { return (project.pages[page] && project.pages[page].mmPerPt) || 25.4 / 72 * 100; }

function surfaceLoad(el, project) {
  const w = zeroVec();
  (el.loads || []).forEach(l => {
    const s = project.surfaces.find(x => x.id === l.surface);
    const b = Number(l.width) || 0;
    if (!s) return;
    w.G += s.G * b; w.Qf += s.Qf * b; w.Qr += s.Qr * b;
    if (s.wind) w.Wu += project.windPressure * b;
  });
  return w;
}

// Wind pressure: q = 0.6 V^2 (Pa) x net Cp, in kPa upward
function windPressure(cls, cnet) { const v = WIND_CLASSES[cls] || 0; return 0.6 * v * v / 1000 * cnet; }

function solveAll(project) {
  const conn = buildConnections(project);
  const byId = Object.fromEntries(project.elements.map(e => [e.id, e]));
  const out = {}, state = {}, warnings = [];

  const manualVec = p => ({ G: Number(p.G) || 0, Qf: Number(p.Qf) || 0, Qr: Number(p.Qr) || 0, Wu: Number(p.Wu) || 0 });
  const srcVec = (p, owner) => {
    if (!p.src) return manualVec(p);
    const [id, end] = String(p.src).split(":");
    if (!byId[id]) return zeroVec();
    const r = solve(id, owner);
    if (!r || r.error) return zeroVec();
    if (r.type === "beam") return end === "2" ? r.r2 : r.r1;
    return r.N || zeroVec();
  };

  function solve(id, from) {
    if (state[id] === 2) return out[id];
    if (state[id] === 1) { warnings.push(`Circular load path through ${byId[id].tag} (from ${byId[from] ? byId[from].tag : "?"}).`); return null; }
    state[id] = 1;
    const el = byId[id];
    let res;
    if (el.type === "beam") {
      const mm = mmPerPt(project, el.page);
      const L = Math.hypot(el.x2 - el.x1, el.y2 - el.y1) * mm / 1000;
      const pts = [];
      (conn.onBeam[id] || []).forEach(c => {
        const r = solve(c.from, id);
        if (r && !r.error) pts.push({ x: Math.min(L, Math.max(0, c.x)), vec: c.end === 2 ? r.r2 : r.r1, label: byId[c.from].tag });
      });
      (el.points || []).forEach(p => {
        pts.push({ x: Math.min(L, Math.max(0, Number(p.x) || 0)), vec: srcVec(p, id), label: p.src ? "transfer" : "manual" });
      });
      if (L <= 0) res = { error: "Zero length" };
      else {
        res = analyseBeam(el, L, surfaceLoad(el, project), pts, project);
        res.points = pts;
      }
    } else if (el.type === "wall") {
      const L = wallLength(el, project), N = zeroVec();
      let conc = zeroVec();
      (conn.onSupport[id] || []).forEach(c => {
        const r = solve(c.from, id);
        if (!r || r.error || r.type !== "beam") return;
        const v = c.end === 2 ? r.r2 : r.r1;
        addVec(N, v); if (factoredReaction(v) > factoredReaction(conc)) conc = { ...v };
      });
      addVec(N, surfaceLoad(el, project), L);
      (el.points || []).forEach(p => addVec(N, srcVec(p, id)));
      res = L > 0 ? checkWall(el, N, L, conc, project) : { error: "Zero length" };
    } else if (el.type === "column" || el.type === "footing") {
      const N = zeroVec(), feeds = [];
      (conn.onSupport[id] || []).forEach(c => {
        const r = solve(c.from, id);
        if (!r || r.error) return;
        if (r.type === "beam") { addVec(N, c.end === 2 ? r.r2 : r.r1); feeds.push(`${byId[c.from].tag} end ${c.end}`); }
        else { addVec(N, r.N); if (r.type === "column") addVec(N, { G: r.m.swKnPerM * r.h }); feeds.push(byId[c.from].tag); }
      });
      (el.points || []).forEach(p => { addVec(N, srcVec(p, id)); feeds.push(p.src ? "transfer" : "manual"); });
      res = el.type === "column" ? checkColumn(el, N, project) : checkFooting(el, N, project);
      res.feeds = feeds;
    } else res = null;
    state[id] = 2;
    out[id] = res;
    return res;
  }
  project.elements.forEach(e => { if (["beam", "column", "footing", "wall"].includes(e.type)) solve(e.id); });
  return { results: out, warnings, conn };
}

// Lightest section in the same material family that passes
function autoSize(el, project) {
  const candidates = el.mat === "timber"
    ? (project.timberGrades[el.grade] ? project.timberGrades[el.grade].sizes.flatMap(size => [1, 2, 3].map(plies => ({ size, plies }))) : [])
    : Object.values(SECTIONS).filter(s => s.family === (SECTIONS[el.sec] || {}).family).sort((a, b) => a.mass - b.mass).map(s => ({ sec: s.name }));
  const test = JSON.parse(JSON.stringify(project));
  const t = test.elements.find(e => e.id === el.id);
  const ranked = candidates.map(c => {
    Object.assign(t, c);
    const r = solveAll(test).results[el.id];
    return { c, r };
  }).filter(x => x.r && !x.r.error);
  const passing = ranked.filter(x => x.r.ok).sort((a, b) => massOf(a.r) - massOf(b.r));
  return passing.length ? passing[0].c : null;
}
function massOf(r) { return r.type === "beam" ? r.mass : r.m ? (r.m.mass || r.m.swKnPerM / 9.81e-3) : 0; }
