// Guided review panel: site, then roof, walls, load paths, footings, wall design and bracing.
"use strict";

function stepState() {
  const p = project, geo = p.geo || {};
  const rows = loadPathRows(p, solved);
  const hasWalls = p.elements.some(e => e.type === "wall");
  const opts = footingOptions(p.siteClass, Number(p.bearing) || 0);
  const chosen = opts.find(o => o.id === (p.footing || {}).type);
  const br = bracingSummary(p, solved.results);
  return {
    site: !!(geo.reviewed && geo.windReviewed),
    roof: !!(p.roofType && p.roofForm),
    walls: !!p.construction,
    path: rows.length > 0 && rows.every(r => r.to),
    footing: !!(chosen && chosen.ok && (p.footing.depth || p.footing.type === "engineered")),
    bracing: hasWalls && br.length > 0 && br.every(s => s.x.ok && s.y.ok) && p.elements.filter(e => e.type === "wall").every(e => { const r = solved.results[e.id]; return r && r.ok; })
  };
}

function stepHead(n, title, done) {
  return `<summary class="step-head"><span class="step-tick ${done ? "done" : ""}" aria-label="${done ? "Complete" : "Open"}">${done ? "✓" : n}</span>${esc(title)}</summary>`;
}

function opt(value, label, cur) { return `<option value="${esc(value)}"${String(value) === String(cur) ? " selected" : ""}>${esc(label)}</option>`; }

function workflowPanel() {
  const p = project, s = stepState(), w = designWind(p), geo = p.geo || {}, f = p.footing || {};
  const open = id => (p.openStep || "site") === id ? " open" : "";
  const ysClass = siteClassFromYs(Number(geo.ys));
  const found = geo.found;
  const con = CONSTRUCTION[p.construction];
  const eq = con && con.eq;
  const opts = footingOptions(p.siteClass, Number(p.bearing) || 0);
  const chosen = opts.find(o => o.id === f.type);
  const lp = loadPathRows(p, solved), openEnds = lp.filter(r => !r.to);
  const br = bracingSummary(p, solved.results);
  const walls = p.elements.filter(e => e.type === "wall");
  const q = Number(p.vhu) ? classForSpeed(Number(p.vhu)) : null;

  return `
  ${draftCard()}
  <details class="step" data-step="site"${open("site")}>${stepHead(1, "Geotechnical report and wind speed", s.site)}
    <label class="field">Project reference<input data-pf-root="ref" data-k="ref" value="${esc(p.ref)}"></label>
    <label class="field">Address<input data-pf-root="address" data-k="address" value="${esc(p.address)}"></label>
    <label class="field">Engineer<input data-pf-root="engineer" data-k="engineer" value="${esc(p.engineer)}"></label>
    <h3>Geotechnical report</h3>
    <label class="btn small">Read a report PDF<input id="geoFile" type="file" accept="application/pdf" hidden></label>
    <p class="small-text">Searches the report text in this browser for values to confirm. Scanned reports have no text, so enter those by hand.</p>
    ${geo.fileName ? `<p class="small-text"><b>${esc(geo.fileName)}</b></p>` : ""}
    ${found ? `<div class="note">${found.none ? "No site class, movement, bearing or wind values were found in the text." : `Found in the report: ${[found.cls && `site class <b>${esc(found.cls)}</b> <button class="icon" data-act="applygeo" data-f2="siteClass" data-v="${esc(found.cls)}">Use</button>`, found.ys && `y<sub>s</sub> <b>${found.ys} mm</b> <button class="icon" data-act="applygeo" data-f2="ys" data-v="${found.ys}">Use</button>`, found.bearing && `bearing <b>${found.bearing} kPa</b> <button class="icon" data-act="applygeo" data-f2="bearing" data-v="${found.bearing}">Use</button>`, found.wind && `wind class <b>${esc(found.wind)}</b> <button class="icon" data-act="applygeo" data-f2="windClass" data-v="${esc(found.wind)}">Use</button>`].filter(Boolean).join("<br>")}<br>Check each one against the report.`}</div>` : ""}
    <div class="grid2">
      <label class="field">Site class<select data-pf-root="siteClass" data-k="siteClass">${SITE_CLASSES.map(k => opt(k, k, p.siteClass)).join("")}</select></label>
      <label class="field">Design bearing, kPa<input type="number" step="5" data-pf-root="bearing" data-k="bearing" data-num="1" value="${esc(p.bearing)}"></label>
      <label class="field">Surface movement y<sub>s</sub>, mm<input type="number" step="1" data-geo="ys" data-k="ys" value="${esc(geo.ys ?? "")}"></label>
      <label class="field">Report reference<input data-geo="ref" data-k="georef" value="${esc(geo.ref ?? "")}"></label>
    </div>
    ${ysClass && !p.siteClass.startsWith(ysClass) && !["A", "P"].includes(p.siteClass) ? `<div class="note">y<sub>s</sub> of ${esc(geo.ys)} mm gives Class ${ysClass} under AS 2870 Table 2.3, but the site class is set to ${esc(p.siteClass)}.</div>` : ""}
    <label class="check"><input type="checkbox" data-geo="reviewed" data-k="georev"${geo.reviewed ? " checked" : ""}> Geotechnical report reviewed, or none provided and assumptions noted</label>
    <h3>Wind</h3>
    <div class="grid2">
      <label class="field">Wind class<select data-pf-root="windClass" data-k="windClass">${Object.keys(WIND_CLASSES).map(k => opt(k, k, p.windClass)).join("")}</select></label>
      <label class="field">V<sub>h,u</sub> if given, m/s<input type="number" step="1" data-pf-root="vhu" data-k="vhu" data-num="1" value="${esc(p.vhu || "")}" placeholder="${WIND_CLASSES[p.windClass]}"></label>
    </div>
    ${q && q !== p.windClass && !w.cyclonic ? `<div class="note">${esc(p.vhu)} m/s falls within class ${q}. The speed you entered is used for pressures.</div>` : ""}
    <p class="small-text">q<sub>u</sub> = ${fmt(w.q, 2)} kPa. Net coefficients to AS 4055 Tables 3.1 and 3.2: roof −${w.cpRoof}, studs +${w.cpWall}. Roof uplift ${fmt(w.roofUp, 2)} kPa, stud pressure ${fmt(w.wall, 2)} kPa. Class comes from region, terrain, shielding and topography in AS 4055 Table 2.2. AS 4055 applies up to 8.5 m eaves height and 35° pitch; outside that use AS/NZS 1170.2.</p>
    <label class="check"><input type="checkbox" data-geo="windReviewed" data-k="windrev"${geo.windReviewed ? " checked" : ""}> Wind speed confirmed from the report or AS 4055</label>
  </details>

  <details class="step" data-step="roof"${open("roof")}>${stepHead(2, "Roof type", s.roof)}
    <p class="small-text">From the architectural drawings.</p>
    <div class="grid2">
      <label class="field">Roofing<select data-pf-root="roofType" data-k="roofType">${opt("", "Select", p.roofType)}${opt("roof-sheet", "Sheet / metal tile", p.roofType)}${opt("roof-tile", "Concrete or terracotta tile", p.roofType)}</select></label>
      <label class="field">Form<select data-pf-root="roofForm" data-k="roofForm">${opt("", "Select", p.roofForm)}${["Gable", "Hip", "Skillion", "Flat"].map(k => opt(k, k, p.roofForm)).join("")}</select></label>
      <label class="field">Pitch, °<input type="number" step="1" data-pf-root="pitch" data-k="pitch" data-num="1" value="${esc(p.pitch || "")}"></label>
      <label class="field">Framing<select data-pf-root="roofFrame" data-k="roofFrame">${["Trusses", "Rafters", "Steel"].map(k => opt(k, k, p.roofFrame)).join("")}</select></label>
    </div>
    ${p.roofType ? `<p class="small-text">New roof load widths default to this roofing. Net tie-down ${fmt(Math.max(0, w.roofUp - 0.9 * (p.surfaces.find(x => x.id === p.roofType) || { G: 0 }).G), 2)} kPa (W<sub>u</sub> − 0.9G).</p>` : ""}
    ${Number(p.pitch) > 35 ? `<div class="note">Pitch is over 35°, outside AS 4055. Use AS/NZS 1170.2.</div>` : ""}
  </details>

  <details class="step" data-step="walls"${open("walls")}>${stepHead(3, "Wall type", s.walls)}
    <label class="field">Construction<select data-pf-root="construction" data-k="construction">${opt("", "Select", p.construction)}${Object.keys(CONSTRUCTION).map(k => opt(k, CONSTRUCTION[k].label, p.construction)).join("")}</select></label>
    <div class="grid2">
      <label class="field">Storeys<select data-pf-root="storeys" data-k="storeys" data-num="1">${[1, 2].map(n => opt(n, n, p.storeys)).join("")}</select></label>
      <label class="field">Default wall height, m<input type="number" step="0.1" data-pf-root="wallH" data-k="wallH" data-num="1" value="${esc(p.wallH)}"></label>
    </div>
    ${eq ? `<p class="small-text">AS 2870 equivalent: <b>${esc(EQ_LABEL[eq])}</b>, differential deflection limit ${DIFF_DEFL[eq][0]} up to ${DIFF_DEFL[eq][1]} mm (Table 4.1). For construction not listed, use Table 3.1.</p>` : ""}
  </details>

  <details class="step" data-step="path"${open("path")}>${stepHead(4, "Load paths", s.path)}
    <p class="small-text">Draw walls, beams, columns and footings on the plan, then trace each load to the ground here. Link between levels with a load on the lower member.</p>
    ${lp.length ? `<table class="calc"><tr><th>From</th><th style="text-align:left">Carried by</th></tr>${lp.map(r => `<tr class="pick" data-pick="${r.id}"><td>${esc(r.from)}</td><td style="text-align:left" class="${r.to ? "" : "fail"}">${esc(r.to || "Unsupported")}</td></tr>`).join("")}</table>
    ${openEnds.length ? `<div class="note">${openEnds.length} load ${openEnds.length === 1 ? "path stops" : "paths stop"} with nothing beneath. Add a support, or link it to the level below.</div>` : ""}` : `<p class="small-text">Nothing drawn yet.</p>`}
  </details>

  <details class="step" data-step="footing"${open("footing")}>${stepHead(5, "Footing type to AS 2870", s.footing)}
    <p class="small-text">Class ${esc(p.siteClass)}, ${eq ? esc(EQ_LABEL[eq]) : "construction not set"}, design bearing ${esc(p.bearing)} kPa.</p>
    ${opts.map(o => `<label class="radio ${o.ok ? "" : "off"}"><input type="radio" name="ftg" data-ftg="${o.id}" data-k="ftg${o.id}"${f.type === o.id ? " checked" : ""}${o.ok ? "" : " disabled"}> <span><b>${esc(o.label)}</b> <span class="small-text">${esc(o.ref)}</span>${o.why ? `<br><span class="small-text">${esc(o.why)}</span>` : ""}</span></label>`).join("")}
    ${chosen && chosen.ok ? `
      <p class="small-text">${chosen.id === "engineered" ? "Enter the design outcome." : `Read the values for this class and construction from AS 2870 ${esc(chosen.ref)}, and confirm that combination is covered.`}</p>
      <div class="grid2">
        <label class="field">Beam or footing depth, mm<input type="number" step="25" data-fs="depth" data-k="fdepth" value="${esc(f.depth ?? "")}"></label>
        <label class="field">Width, mm<input type="number" step="25" data-fs="width" data-k="fwidth" value="${esc(f.width ?? "")}"></label>
        <label class="field">Max beam spacing, m<input type="number" step="0.5" data-fs="spacing" data-k="fspacing" value="${esc(f.spacing ?? "")}"></label>
        <label class="field">Bottom reinforcement<input data-fs="bars" data-k="fbars" value="${esc(f.bars ?? "")}"></label>
        <label class="field">Top reinforcement<input data-fs="top" data-k="ftop" value="${esc(f.top ?? "")}"></label>
        <label class="field">Slab mesh<input data-fs="mesh" data-k="fmesh" value="${esc(f.mesh ?? "")}"></label>
      </div>` : ""}
    ${p.siteClass.endsWith("-D") ? `<div class="note">Deep-seated movement: check Section 2 and the deep-moisture provisions of Section 5.</div>` : ""}
  </details>

  <details class="step" data-step="bracing"${open("bracing")}>${stepHead(6, "Wall design and bracing", s.bracing)}
    <p class="small-text">Timber to AS 1720.1 with bracing to AS 1684.2, masonry to AS 3700, racking to AS 4055 Section 5. Select a wall below to set its details.</p>
    ${walls.length ? `<table class="calc"><tr><th>Wall</th><th style="text-align:left">Type</th><th>Brace</th><th>Util</th></tr>${walls.map(e => { const r = solved.results[e.id]; return `<tr class="pick" data-pick="${e.id}"><td>${esc(e.tag)}</td><td style="text-align:left">${esc(r && !r.error ? r.name : "–")}</td><td>${e.brace ? "Yes" : "–"}</td><td class="${r && r.ok ? "pass" : "fail"}">${r && !r.error ? fmt(r.util * 100, 0) + "%" : "–"}</td></tr>`; }).join("")}</table>` : `<p class="small-text">Draw walls with the Wall tool. Beam ends that land on a wall pass their load to it.</p>`}
    <h3>Racking</h3>
    <label class="field">Racking pressure on elevation, kPa<input type="number" step="0.01" data-pf-root="rackP" data-k="rackP" data-num="1" value="${esc(p.rackP || "")}" placeholder="${fmt(w.rack, 2)}"></label>
    <p class="small-text">Blank uses 0.96q<sub>u</sub>, a conservative envelope. For a smaller value, read AS 4055 Tables 5.1 to 5.13 for the width, pitch and storey.</p>
    <label class="field">Max bracing wall spacing, m<input type="number" step="0.5" data-pf-root="braceSpacing" data-k="braceSpacing" data-num="1" value="${esc(p.braceSpacing)}"></label>
    ${br.map(b => {
      const pg = p.pages[b.page].bracing || {};
      return `<h3>Page ${b.page + 1}</h3>
      <div class="grid3">
        <label class="field">Plan X, m<input type="number" step="0.1" data-br="lenX" data-bp="${b.page}" data-k="b${b.page}x" value="${esc(pg.lenX || "")}" placeholder="${fmt(b.bx, 1)}"></label>
        <label class="field">Plan Y, m<input type="number" step="0.1" data-br="lenY" data-bp="${b.page}" data-k="b${b.page}y" value="${esc(pg.lenY || "")}" placeholder="${fmt(b.by, 1)}"></label>
        <label class="field">Elevation ht, m<input type="number" step="0.1" data-br="elevH" data-bp="${b.page}" data-k="b${b.page}h" value="${esc(pg.elevH || "")}" placeholder="${fmt(b.H, 1)}"></label>
      </div>
      <p class="small-text">Elevation height is half this storey plus everything above it, to AS 4055 Figures 5.1 to 5.3.</p>
      <table class="calc"><tr><th>Wind along</th><th>Racking kN</th><th>Bracing kN</th><th>Max gap m</th></tr>
        <tr><td>X walls</td><td>${fmt(b.x.F)}</td><td class="${b.x.ok ? "pass" : "fail"}">${fmt(b.x.cap)}</td><td class="${b.x.gap > (Number(p.braceSpacing) || 9) ? "fail" : ""}">${fmt(b.x.gap)}</td></tr>
        <tr><td>Y walls</td><td>${fmt(b.y.F)}</td><td class="${b.y.ok ? "pass" : "fail"}">${fmt(b.y.cap)}</td><td class="${b.y.gap > (Number(p.braceSpacing) || 9) ? "fail" : ""}">${fmt(b.y.gap)}</td></tr>
      </table>`;
    }).join("")}
  </details>`;
}

function draftCard() {
  const d = project.draftReport;
  return `<div class="draft-card">
    <button class="btn primary block" data-draft="run"${docInfo && docInfo.kind === "pdf" ? "" : " disabled"}>${d ? "Redraft from the plans" : "Draft mark-up from the plans"}</button>
    <p class="small-text">Reads the floor plans, then places and sizes lintels, walls, outdoor beams and posts. Your own members are kept. It is a starting point to check, and needs a CAD PDF, not a scan.</p>
    ${d ? `<div class="note"><b>Draft: ${d.count} items on ${d.plans.length} ${d.plans.length === 1 ? "sheet" : "sheets"}. Check before use.</b>
      ${d.general.length ? `<ul class="draft-list">${d.general.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
      ${d.plans.map(pl => `<p class="small-text"><b>Page ${pl.page + 1}, 1:${pl.scale}, ${esc(pl.level)}.</b> ${pl.placed} of ${pl.openings} openings placed${pl.span ? `, roof span ${fmt(pl.span, 1)} m` : ""}.</p>
      ${pl.review.length ? `<ul class="draft-list">${pl.review.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}`).join("")}</div>` : ""}
  </div>`;
}

function wallPanel(el) {
  const r = solved.results[el.id], grades = project.timberGrades;
  const g = grades[el.grade] || grades.MGP10;
  const masonry = el.wallType === "masonry";
  const bc = el.brace ? braceCapacity(el, r && !r.error ? r : null, project) : null;
  return `
    <h3>${esc(el.tag)} · ${fmt(wallLength(el, project), 2)} m wall</h3>
    ${statusBar(r)}
    <label class="field">Tag<input data-f="tag" data-k="tag" value="${esc(el.tag)}"></label>
    <label class="field">Wall type<select data-f="wallType" data-k="wallType">${Object.keys(WALL_TYPES).map(k => opt(k, WALL_TYPES[k], el.wallType)).join("")}</select></label>
    <label class="field">Height, m<input type="number" step="0.1" data-f="h" data-k="h" data-num="1" value="${esc(el.h)}"></label>
    ${masonry ? `
      <div class="grid2">
        <label class="field">Thickness, mm<input type="number" step="10" data-f="t" data-k="t" data-num="1" value="${esc(el.t || 110)}"></label>
        <label class="field">f'uc, MPa<input type="number" step="5" data-f="fuc" data-k="fuc" data-num="1" value="${esc(el.fuc || 20)}"></label>
        <label class="field">k<sub>m</sub><input type="number" step="0.1" data-f="km" data-k="km" data-num="1" value="${esc(el.km || 1.4)}"></label>
        <label class="field">f'mt, MPa<input type="number" step="0.05" data-f="fmt" data-k="fmt" data-num="1" value="${esc(el.fmt ?? 0.2)}"></label>
      </div>
      <label class="check"><input type="checkbox" data-f="topSupport" data-k="topSupport"${el.topSupport !== false ? " checked" : ""}> Laterally supported along the top</label>
      <label class="check"><input type="checkbox" data-f="slab" data-k="slab"${el.slab ? " checked" : ""}> Supports a concrete slab</label>` : `
      <div class="grid2">
        <label class="field">Stud grade<select data-f="grade" data-k="grade">${Object.keys(grades).map(k => opt(k, grades[k].label, el.grade)).join("")}</select></label>
        <label class="field">Stud size<select data-f="size" data-k="size">${g.sizes.map(s => opt(s, s, el.size)).join("")}</select></label>
        <label class="field">Spacing, mm<input type="number" step="50" data-f="spacing" data-k="spacing" data-num="1" value="${esc(el.spacing)}"></label>
        <label class="field">Noggings at, mm<input type="number" step="50" data-f="nog" data-k="nog" data-num="1" value="${esc(el.nog)}"></label>
        <label class="field">Studs under point loads<input type="number" step="1" min="1" data-f="concStuds" data-k="concStuds" data-num="1" value="${esc(el.concStuds)}"></label>
        <label class="field">Wind deflection h /<input type="number" step="50" data-f="deflOver" data-k="deflOver" data-num="1" value="${esc(el.deflOver)}"></label>
      </div>`}
    <h3>Load widths on the wall</h3>
    ${(el.loads || []).map((l, i) => `<div class="row">
      <select data-load="${i}" data-lf="surface" data-k="ls${i}" aria-label="Surface">${project.surfaces.map(s => opt(s.id, s.name, l.surface)).join("")}</select>
      <input type="number" step="0.05" min="0" data-load="${i}" data-lf="width" data-k="lw${i}" value="${esc(l.width)}" aria-label="Width in m">
      <button class="icon" data-act="pickwidth" data-i="${i}" title="Measure the width on the plan">⇔</button>
      <button class="icon" data-act="delload" data-i="${i}" aria-label="Remove">×</button></div>`).join("")}
    <button class="btn small" data-act="addload">+ Add load width</button>
    <h3>Loads from other levels</h3>
    ${pointRows(el, false)}
    <button class="btn small" data-act="addpoint">+ Add load</button>
    <h3>Bracing</h3>
    <label class="check"><input type="checkbox" data-f="brace" data-k="brace"${el.brace ? " checked" : ""}> Bracing wall</label>
    ${el.brace ? `
      <label class="field">Bracing length, m<input type="number" step="0.1" data-f="braceLen" data-k="braceLen" data-num="1" value="${esc(el.braceLen || "")}" placeholder="${fmt(wallLength(el, project), 2)}"></label>
      ${masonry ? "" : `<label class="field">Type, AS 1684.2 Table 8.18<select data-f="braceType" data-k="braceType">${BRACE_TYPES.map(b => opt(b.id, b.label + (b.kN ? `, ${b.kN} kN/m` : ""), el.braceType)).join("")}</select></label>
      ${el.braceType === "custom" ? `<label class="field">Capacity, kN/m<input type="number" step="0.1" data-f="braceKn" data-k="braceKn" data-num="1" value="${esc(el.braceKn || "")}"></label>` : ""}`}
      <p class="small-text">${fmt(bc.cap)} kN. ${esc(bc.detail)}.</p>` : ""}
    <h3>Footing under the wall</h3>
    <label class="check"><input type="checkbox" data-f="onGround" data-k="onGround"${el.onGround ? " checked" : ""}> Bears on a strip or edge beam</label>
    ${el.onGround ? `<div class="grid2">
      <label class="field">Width, mm<input type="number" step="25" data-f="stripB" data-k="stripB" data-num="1" value="${esc(el.stripB)}"></label>
      <label class="field">Depth, mm<input type="number" step="25" data-f="stripD" data-k="stripD" data-num="1" value="${esc(el.stripD)}"></label></div>` : ""}
    ${r && !r.error ? `
      <h3>Results</h3>
      <p class="small-text">Line loads kN/m incl. wall: G ${fmt(r.line.G)}, Q floor ${fmt(r.line.Qf)}, Q roof ${fmt(r.line.Qr)}, uplift ${fmt(r.line.Wu)}. Net tie-down ${fmt(r.netUp, 2)} kN/m.</p>
      <table class="calc"><tr><th>Check</th><th>Action</th><th>Capacity</th><th>Util</th></tr>
      ${r.rows.map(x => `<tr title="${esc(x.detail)}"><td>${esc(x.name)}</td><td>${fmt(x.star, 2)}</td><td>${fmt(x.cap, 2)} ${esc(x.units)}</td><td class="${x.u > 1 ? "fail" : ""}">${fmt(x.u * 100, 0)}%</td></tr>`).join("")}</table>` : ""}
    ${el.wallType === "veneer" ? `<p class="small-text">The veneer is carried on the footing, not the frame. Check wall ties to AS 3700 Cl 7.6.</p>` : ""}
    <p style="margin-top:.8rem"><button class="btn danger" data-act="delete">Delete wall</button></p>`;
}

// Scans report text for values for the engineer to confirm
async function readGeotech(file) {
  if (!window.pdfjsLib) { alert("The PDF library could not load. Check your internet connection and reload."); return; }
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  let text = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const c = await (await pdf.getPage(i)).getTextContent();
    text += c.items.map(t => t.str).join(" ") + "\n";
  }
  const cls = (text.match(/\bclass(?:ified|ification)?(?:\s+as)?\s*(?:class\s*)?["“]?(H1-D|H2-D|M-D|E-D|H1|H2|A|S|M|E|P)\b(?!-)/i) || [])[1];
  const ys = (text.match(/\by\s*s\b[^.\n]{0,60}?(\d{1,3}(?:\.\d)?)\s*mm/i) || text.match(/surface movement[^.\n]{0,60}?(\d{1,3}(?:\.\d)?)\s*mm/i) || [])[1];
  const bearing = (text.match(/bearing[^.\n]{0,80}?(\d{2,4})\s*kPa/i) || [])[1];
  const wind = (text.match(/\bwind\s*(?:speed\s*)?(?:class(?:ification)?)?[^.\n]{0,30}?\b(N[1-6]|C[1-4])\b/i) || [])[1];
  project.geo = { ...(project.geo || {}), fileName: file.name, found: {
    cls: cls && cls.toUpperCase(), ys: ys ? Number(ys) : null, bearing: bearing ? Number(bearing) : null, wind: wind && wind.toUpperCase(),
    none: !cls && !ys && !bearing && !wind
  } };
  update();
}
