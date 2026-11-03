// UI: PDF viewer, drawing tools, member panel, schedule and exports.
"use strict";

if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

const $ = id => document.getElementById(id);
const SVGNS = "http://www.w3.org/2000/svg";
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (v, d = 1) => (v == null || !isFinite(v) ? "–" : Number(v).toFixed(d));
const AUTOSAVE_KEY = "rsm-autosave-v1";
const PT_TO_MM = 25.4 / 72;

const TOOLS = [
  { id: "select", label: "Select", key: "V", icon: '<path d="M5 3l12 8-5 1 3 6-2 1-3-6-4 3z" fill="currentColor"/>', hint: "Click a member to edit it. Drag it or its end handles to move. Del removes. Scroll to zoom; hold Space or the middle button to pan." },
  { id: "wall", label: "Wall", key: "W", icon: '<path d="M2 10h16" stroke="currentColor" stroke-width="6" opacity="0.6"/>', hint: "Click the start, then the end of a wall. Hold Shift for square lines. Beam ends that land on it pass their load to it." },
  { id: "beam", label: "Beam", key: "B", icon: '<path d="M2 10h16" stroke="currentColor" stroke-width="3"/>', hint: "Click the start, then the end. Hold Shift for square lines. Ends snap to other members; loads transfer where a member lands on another." },
  { id: "column", label: "Column", key: "C", icon: '<rect x="5" y="5" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5"/>', hint: "Click to place a column. Place it on a beam end to collect the reaction." },
  { id: "footing", label: "Footing", key: "F", icon: '<rect x="3" y="3" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="3 2"/>', hint: "Click to place a pad footing. Place it on a column or beam end to collect the load." },
  { id: "measure", label: "Measure", key: "M", icon: '<path d="M2 10h16M2 6v8M18 6v8" stroke="currentColor" stroke-width="2" fill="none"/>', hint: "Click two points to add a dimension to the plan." },
  { id: "note", label: "Note", key: "N", icon: '<path d="M4 4h12M10 4v12" stroke="currentColor" stroke-width="2.5"/>', hint: "Click to place a text note." }
];

const defaultProject = () => ({
  ref: "", address: "", engineer: "", windClass: "N2", cnet: "", vhu: "", rackP: "", siteClass: "M", bearing: 100, defaultLtop: 1800,
  geo: {}, roofType: "", roofForm: "", roofFrame: "Trusses", pitch: "", construction: "", storeys: 1, wallH: 2.4, footing: {}, braceSpacing: 9, openStep: "site",
  surfaces: JSON.parse(JSON.stringify(DEFAULT_SURFACES)),
  uses: JSON.parse(JSON.stringify(DEFAULT_USES)),
  timberGrades: JSON.parse(JSON.stringify(TIMBER_GRADES)),
  pages: [], elements: [], slabs: [], nextId: 1, counters: { beam: 0, column: 0, footing: 0, wall: 0 },
  lastBeam: null
});

// Saved projects keep their edited surfaces and gain any presets added since
function fromSaved(saved) {
  const p = { ...defaultProject(), ...saved };
  DEFAULT_SURFACES.forEach(s => { if (!p.surfaces.some(x => x.id === s.id)) p.surfaces.push({ ...s }); });
  return p;
}

let project = defaultProject();
let docInfo = null; // { kind: 'pdf'|'image'|'blank', name, bytes, mime, pdf, dims: [{w,h}] }
let view = { page: 0, zoom: 1 };
let tool = "select", selected = null, activeTab = "workflow";
let draft = null, drag = null, snapPt = null, pickWidth = null;
let solved = { results: {}, warnings: [] };
const undoStack = [], redoStack = [];
let renderTask = null, renderGen = 0, renderTimer = null, spaceDown = false, pan = null;

// ---------- Helpers ----------

const pageInfo = () => project.pages[view.page];
const mmPt = () => (pageInfo() ? pageInfo().mmPerPt : 1);
const elById = id => project.elements.find(e => e.id === id);
const fontSize = () => { const d = docInfo && docInfo.dims[view.page]; return d ? Math.max(d.w, d.h) / 135 : 10; };

function refreshProjectDerived() { project.windPressure = designWind(project).roofUp; }

function pushUndo() {
  undoStack.push(snapshot());
  if (undoStack.length > 80) undoStack.shift();
  redoStack.length = 0;
}
const snapshot = () => JSON.stringify({ elements: project.elements, pages: project.pages, counters: project.counters, nextId: project.nextId });
function restore(s) { Object.assign(project, JSON.parse(s)); if (selected && !elById(selected)) selected = null; update(); }
function undo() { if (undoStack.length) { redoStack.push(snapshot()); restore(undoStack.pop()); } }
function redo() { if (redoStack.length) { undoStack.push(snapshot()); restore(redoStack.pop()); } }

function autosave() {
  try { localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ project, docName: docInfo ? docInfo.name : null, docKind: docInfo ? docInfo.kind : null, dims: docInfo ? docInfo.dims : null })); } catch (e) { /* storage full or blocked */ }
}

// ---------- Opening plans ----------

async function openFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const hadWork = project.elements.length > 0;
  if (hadWork && !confirm("Open this plan and clear the current mark-up? Save the project first if you need it.")) return;
  project.elements = []; project.counters = { beam: 0, column: 0, footing: 0 }; project.nextId = 1; undoStack.length = 0;
  await loadDocument(file.type === "application/pdf" || /\.pdf$/i.test(file.name) ? "pdf" : "image", file.name, bytes, file.type);
  project.pages = docInfo.dims.map(() => ({ mmPerPt: PT_TO_MM * 100, ratio: "100" }));
  afterDocLoad();
}

async function loadDocument(kind, name, bytes, mime) {
  if (kind === "pdf") {
    if (!window.pdfjsLib) { alert("The PDF library could not load. Check your internet connection and reload."); throw new Error("no pdfjs"); }
    const pdf = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
    const dims = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const vp = (await pdf.getPage(i)).getViewport({ scale: 1 });
      dims.push({ w: vp.width, h: vp.height });
    }
    docInfo = { kind, name, bytes, pdf, dims };
  } else if (kind === "image") {
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    docInfo = { kind, name, bytes, mime, img, dims: [{ w: img.naturalWidth * 0.5, h: img.naturalHeight * 0.5 }] };
  } else {
    docInfo = { kind: "blank", name: name || "Blank sheet", dims: [{ w: 1191, h: 842 }] };
  }
}

function afterDocLoad() {
  view.page = 0; selected = null;
  $("empty").hidden = true; $("sheet").hidden = false;
  buildPageSelect();
  zoomFit();
  update();
}

function buildPageSelect() {
  const n = docInfo.dims.length;
  $("pageField").hidden = n < 2;
  $("pageSel").innerHTML = docInfo.dims.map((d, i) => `<option value="${i}">${i + 1} of ${n}</option>`).join("");
}

// ---------- Rendering the plan ----------

function scheduleRender() { clearTimeout(renderTimer); renderTimer = setTimeout(renderPage, 60); }

async function renderPage() {
  if (!docInfo) return;
  const d = docInfo.dims[view.page], cv = $("pdfCanvas"), ctx = cv.getContext("2d");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  // Canvases have a size limit; beyond it the browser scales the bitmap up.
  const q = Math.min(view.zoom * dpr, 4096 / Math.max(d.w, d.h));
  const cssW = d.w * view.zoom, cssH = d.h * view.zoom;
  $("sheet").style.width = cssW + "px"; $("sheet").style.height = cssH + "px";
  cv.style.width = cssW + "px"; cv.style.height = cssH + "px";
  const gen = ++renderGen;
  if (renderTask) { try { renderTask.cancel(); } catch (e) { /* already done */ } renderTask = null; }
  if (docInfo.kind === "pdf") {
    const page = await docInfo.pdf.getPage(view.page + 1);
    if (gen !== renderGen) return;
    const vp = page.getViewport({ scale: q });
    // Overlapping renders on one canvas corrupt its transform, so each draws off-screen first.
    const off = document.createElement("canvas");
    off.width = Math.floor(vp.width); off.height = Math.floor(vp.height);
    const task = page.render({ canvasContext: off.getContext("2d"), viewport: vp });
    renderTask = task;
    try { await task.promise; } catch (e) { if (e.name !== "RenderingCancelledException") console.error(e); return; }
    if (gen !== renderGen) return;
    cv.width = off.width; cv.height = off.height;
    ctx.drawImage(off, 0, 0);
  } else {
    cv.width = Math.floor(d.w * q); cv.height = Math.floor(d.h * q);
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height);
    if (docInfo.kind === "image") ctx.drawImage(docInfo.img, 0, 0, cv.width, cv.height);
    else {
      ctx.strokeStyle = "#e6eaee"; ctx.lineWidth = 1;
      const step = 28.3465 * q;
      for (let x = 0; x < cv.width; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, cv.height); ctx.stroke(); }
      for (let y = 0; y < cv.height; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(cv.width, y); ctx.stroke(); }
    }
  }
}

function setZoom(z, cx, cy) {
  const stage = $("stage");
  const nz = Math.min(8, Math.max(0.1, z));
  const rect = stage.getBoundingClientRect();
  const ax = cx == null ? rect.width / 2 : cx - rect.left, ay = cy == null ? rect.height / 2 : cy - rect.top;
  const px = (stage.scrollLeft + ax - 16) / view.zoom, py = (stage.scrollTop + ay - 16) / view.zoom;
  view.zoom = nz;
  $("zoomLabel").textContent = Math.round(nz * 100) + "%";
  const d = docInfo && docInfo.dims[view.page];
  if (d) { $("sheet").style.width = d.w * nz + "px"; $("sheet").style.height = d.h * nz + "px"; $("pdfCanvas").style.width = d.w * nz + "px"; $("pdfCanvas").style.height = d.h * nz + "px"; }
  stage.scrollLeft = px * nz + 16 - ax; stage.scrollTop = py * nz + 16 - ay;
  drawOverlay();
  scheduleRender();
}

function zoomFit() {
  if (!docInfo) return;
  const d = docInfo.dims[view.page], r = $("stage").getBoundingClientRect();
  setZoom(Math.min((r.width - 40) / d.w, (r.height - 40) / d.h));
  renderPage();
}

// ---------- Overlay ----------

function svgEl(name, attrs, parent, text) {
  const e = document.createElementNS(SVGNS, name);
  Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
  if (text != null) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

// Label as it appears on the plan and the exported PDF
function planLabel(el) {
  const r = solved.results[el.id];
  const sec = r && !r.error ? r.name : "?";
  // Repeated drafted items sit close together, so the schedule carries their size
  if (el.kind === "pad" || el.kind === "post" || el.typical) return el.tag;
  return `${el.tag} ${sec}`;
}

function drawOverlay() {
  const svg = $("overlay");
  if (!docInfo) return;
  const d = docInfo.dims[view.page], fs = fontSize();
  svg.setAttribute("viewBox", `0 0 ${d.w} ${d.h}`);
  svg.innerHTML = "";
  const sheet = view.sheet ? currentSheet() : null, shown = sheet ? new Set(sheet.members.map(e => e.id)) : null;
  project.elements.filter(e => e.page === view.page && (!shown || shown.has(e.id) || (["note", "measure"].includes(e.type) && !e.draft))).forEach(el => {
    const r = solved.results[el.id];
    const bad = r && (r.error || r.ok === false) ? " bad" : "";
    const sel = el.id === selected ? " m-sel" : "";
    const g = svgEl("g", { "data-id": el.id }, svg);
    if (el.type === "wall") {
      svgEl("line", { x1: el.x1, y1: el.y1, x2: el.x2, y2: el.y2, class: `m-wall${el.brace ? " brace" : ""}${bad}${sel}` }, g);
      svgEl("line", { x1: el.x1, y1: el.y1, x2: el.x2, y2: el.y2, class: "m-hit" }, g);
      const { x, y, ang } = labelPos(el, fs);
      svgEl("text", { x, y, "font-size": fs, class: `m-text wall-t${bad}`, "text-anchor": "middle", transform: `rotate(${ang} ${x} ${y})` }, g, wallLabel(el));
      if (el.id === selected) {
        svgEl("circle", { cx: el.x1, cy: el.y1, r: 6 / view.zoom, class: "m-handle", "data-end": 1 }, g);
        svgEl("circle", { cx: el.x2, cy: el.y2, r: 6 / view.zoom, class: "m-handle", "data-end": 2 }, g);
      }
    } else if (el.type === "beam") {
      svgEl("line", { x1: el.x1, y1: el.y1, x2: el.x2, y2: el.y2, class: `m-line${bad}${el.support === "cant" ? " cant" : ""}${sel}` }, g);
      svgEl("line", { x1: el.x1, y1: el.y1, x2: el.x2, y2: el.y2, class: "m-hit" }, g);
      const { x, y, ang } = labelPos(el, fs);
      svgEl("text", { x, y, "font-size": fs, class: `m-text${bad}`, "text-anchor": "middle", transform: `rotate(${ang} ${x} ${y})` }, g, planLabel(el));
      if (el.id === selected) {
        svgEl("circle", { cx: el.x1, cy: el.y1, r: 6 / view.zoom, class: "m-handle", "data-end": 1 }, g);
        svgEl("circle", { cx: el.x2, cy: el.y2, r: 6 / view.zoom, class: "m-handle", "data-end": 2 }, g);
      }
    } else if (el.type === "column") {
      const s = symbolSize(el, 300);
      svgEl("rect", { x: el.x - s / 2, y: el.y - s / 2, width: s, height: s, class: `m-col${bad}${sel}` }, g);
      svgEl("text", { x: el.x + s * 0.7, y: el.y - s * 0.7 - fs, "font-size": fs, class: `m-text${bad}` }, g, planLabel(el));
    } else if (el.type === "footing") {
      const s = (Number(el.B) || 600) / mmPt();
      svgEl("rect", { x: el.x - s / 2, y: el.y - s / 2, width: s, height: s, class: `m-ftg${bad}${sel}` }, g);
      svgEl("text", { x: el.x + s * 0.6, y: el.y + s * 0.6 + fs, "font-size": fs, class: `m-text${bad}` }, g, planLabel(el));
    } else if (el.type === "measure") {
      svgEl("line", { x1: el.x1, y1: el.y1, x2: el.x2, y2: el.y2, class: `m-dim${sel}` }, g);
      svgEl("line", { x1: el.x1, y1: el.y1, x2: el.x2, y2: el.y2, class: "m-hit" }, g);
      const { x, y, ang } = labelPos(el, fs);
      svgEl("text", { x, y, "font-size": fs, class: "m-text dim", "text-anchor": "middle", transform: `rotate(${ang} ${x} ${y})` }, g, Math.round(Math.hypot(el.x2 - el.x1, el.y2 - el.y1) * mmPt()) + " mm");
      if (el.id === selected) {
        svgEl("circle", { cx: el.x1, cy: el.y1, r: 6 / view.zoom, class: "m-handle", "data-end": 1 }, g);
        svgEl("circle", { cx: el.x2, cy: el.y2, r: 6 / view.zoom, class: "m-handle", "data-end": 2 }, g);
      }
    } else if (el.type === "note") {
      svgEl("text", { x: el.x, y: el.y, "font-size": fs, class: `m-text note-t${sel}` }, g, el.text);
    }
  });
  if (sheet) drawSheetExtras(svg, sheet);
  if (draft && draft.x2 != null) svgEl("line", { x1: draft.x1, y1: draft.y1, x2: draft.x2, y2: draft.y2, class: "m-ghost" }, svg);
  if (snapPt) svgEl("circle", { cx: snapPt.x, cy: snapPt.y, r: 7 / view.zoom, class: "m-snap" }, svg);
}

function wallLabel(el) {
  return `${el.tag}${el.brace ? " BR" : ""}`;
}

function symbolSize(el, fallbackMm) {
  const r = solved.results[el.id];
  const d = r && r.m ? Math.max(r.m.d || 0, r.m.b || 0) : 0;
  const px = (d || fallbackMm) / mmPt();
  return Math.max(px, 8 / view.zoom);
}

function labelPos(el, fs) {
  const mx = (el.x1 + el.x2) / 2, my = (el.y1 + el.y2) / 2;
  let ang = Math.atan2(el.y2 - el.y1, el.x2 - el.x1) * 180 / Math.PI;
  if (ang > 90) ang -= 180; if (ang <= -90) ang += 180;
  const rad = (ang - 90) * Math.PI / 180, off = fs * 0.5;
  return { x: mx + Math.cos(rad) * off, y: my + Math.sin(rad) * off, ang };
}

// ---------- Pointer handling ----------

function toPage(evt) {
  const svg = $("overlay"), p = svg.createSVGPoint();
  p.x = evt.clientX; p.y = evt.clientY;
  const q = p.matrixTransform(svg.getScreenCTM().inverse());
  return { x: q.x, y: q.y };
}

function snap(pt, excludeId) {
  const radius = 12 / view.zoom;
  let best = null, bestD = radius;
  const consider = (x, y, weight = 1) => { const d = Math.hypot(pt.x - x, pt.y - y) * weight; if (d < bestD) { bestD = d; best = { x, y }; } };
  project.elements.filter(e => e.page === view.page && e.id !== excludeId).forEach(e => {
    if (e.type === "beam" || e.type === "wall") { consider(e.x1, e.y1, 0.6); consider(e.x2, e.y2, 0.6); }
    if (e.type === "column" || e.type === "footing") consider(e.x, e.y, 0.5);
  });
  if (!best) {
    project.elements.filter(e => (e.type === "beam" || e.type === "wall") && e.page === view.page && e.id !== excludeId).forEach(e => {
      const p = projectOn(pt, { x: e.x1, y: e.y1 }, { x: e.x2, y: e.y2 });
      if (p.t > 0 && p.t < 1) consider(e.x1 + p.t * (e.x2 - e.x1), e.y1 + p.t * (e.y2 - e.y1));
    });
  }
  return best;
}

function ortho(pt, a) {
  return Math.abs(pt.x - a.x) > Math.abs(pt.y - a.y) ? { x: pt.x, y: a.y } : { x: a.x, y: pt.y };
}

function newId() { return "e" + (project.nextId++); }

function addElement(fields) {
  pushUndo();
  const el = { id: newId(), page: view.page, ...fields };
  const prefix = { beam: "B", column: "C", footing: "F", wall: "W" }[el.type];
  if (prefix) { project.counters[el.type] = (project.counters[el.type] || 0) + 1; el.tag = prefix + project.counters[el.type]; }
  project.elements.push(el);
  selected = el.id;
  if (activeTab !== "member") setTab("member");
  update();
  return el;
}

function wallDefault() {
  const eq = (CONSTRUCTION[project.construction] || {}).eq;
  return eq === "MV" || eq === "AMV" ? "veneer" : eq === "AFM" || eq === "FM" ? "masonry" : "timber";
}

function beamDefaults() {
  const d = project.lastBeam || { mat: "steel", sec: "200UB25.4", grade: "MGP12", size: "240x45", plies: 1, use: "floor" };
  return { support: "ss", loads: [], points: [], Ltop: 0, Lbot: 0, ...JSON.parse(JSON.stringify(d)) };
}

function onPointerDown(evt) {
  if (!docInfo) return;
  if (evt.button === 1 || spaceDown) { startPan(evt); return; }
  if (evt.button !== 0) return;
  const raw = toPage(evt);

  if (pickWidth) {
    if (!pickWidth.start) { pickWidth.start = snap(raw) || raw; draft = { x1: pickWidth.start.x, y1: pickWidth.start.y }; return; }
    const end = evt.shiftKey ? ortho(raw, pickWidth.start) : raw;
    const mm = Math.hypot(end.x - pickWidth.start.x, end.y - pickWidth.start.y) * mmPt();
    pickWidth.apply(+(mm / 1000).toFixed(2));
    pickWidth = null; draft = null; setHint(); update(); return;
  }

  if (tool === "select") {
    const handle = evt.target.closest ? evt.target.closest(".m-handle") : null;
    const group = evt.target.closest ? evt.target.closest("g[data-id]") : null;
    if (group) {
      selected = group.getAttribute("data-id");
      const el = elById(selected);
      drag = { el, start: raw, orig: JSON.parse(JSON.stringify(el)), end: handle ? Number(handle.getAttribute("data-end")) : 0, moved: false };
      if (activeTab !== "member") setTab("member");
      update();
      $("overlay").setPointerCapture(evt.pointerId);
    } else { selected = null; update(); }
    return;
  }

  const s = snap(raw);
  let pt = s || raw;
  if (tool === "beam" || tool === "wall" || tool === "measure" || tool === "calibrate") {
    if (!draft) { draft = { x1: pt.x, y1: pt.y }; return; }
    if (evt.shiftKey && !s) pt = ortho(raw, { x: draft.x1, y: draft.y1 });
    const seg = { x1: draft.x1, y1: draft.y1, x2: pt.x, y2: pt.y };
    draft = null; snapPt = null;
    if (Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1) < 2) { drawOverlay(); return; }
    if (tool === "beam") addElement({ type: "beam", ...beamDefaults(), ...seg });
    else if (tool === "wall") addElement({ type: "wall", wallType: wallDefault(), h: Number(project.wallH) || 2.4, grade: "MGP10", size: "90x35", plies: 1, spacing: 450, nog: 1350, concStuds: 3, deflOver: 200, t: 110, fuc: 20, loads: [], points: [], brace: false, braceType: "h", onGround: false, stripB: 300, stripD: 300, ...seg });
    else if (tool === "measure") addElement({ type: "measure", ...seg });
    else finishCalibrate(seg);
    return;
  }
  if (tool === "column") addElement({ type: "column", x: pt.x, y: pt.y, mat: "steel", sec: "89x89x5 SHS", grade: "MGP12", size: "90x90", plies: 1, height: 2.7, ke: 1, points: [] });
  if (tool === "footing") addElement({ type: "footing", x: pt.x, y: pt.y, B: 600, Lf: 600, D: 400, qa: project.bearing, points: [] });
  if (tool === "note") {
    $("noteText").value = "";
    const dlg = $("noteDialog");
    dlg.returnValue = "";
    dlg.onclose = () => { const t = $("noteText").value.trim(); if (dlg.returnValue === "ok" && t) addElement({ type: "note", x: pt.x, y: pt.y, text: t }); };
    dlg.showModal();
  }
}

function onPointerMove(evt) {
  if (pan) { $("stage").scrollLeft = pan.sl - (evt.clientX - pan.x); $("stage").scrollTop = pan.st - (evt.clientY - pan.y); return; }
  if (!docInfo) return;
  const raw = toPage(evt);
  if (drag) {
    const dx = raw.x - drag.start.x, dy = raw.y - drag.start.y, o = drag.orig, el = drag.el;
    if (!drag.moved && Math.hypot(dx, dy) * view.zoom < 3) return;
    if (!drag.moved) { pushUndo(); drag.moved = true; }
    if (drag.end) {
      const p = snap(raw, el.id) || raw;
      snapPt = p === raw ? null : p;
      if (drag.end === 1) { el.x1 = p.x; el.y1 = p.y; } else { el.x2 = p.x; el.y2 = p.y; }
    } else if (el.x1 != null) { el.x1 = o.x1 + dx; el.y1 = o.y1 + dy; el.x2 = o.x2 + dx; el.y2 = o.y2 + dy; }
    else { const p = el.type === "note" ? null : snap(raw, el.id); snapPt = p; el.x = p ? p.x : o.x + dx; el.y = p ? p.y : o.y + dy; }
    recompute(); drawOverlay();
    return;
  }
  if (tool !== "select" || pickWidth) {
    const anchor = pickWidth ? pickWidth.start : draft && { x: draft.x1, y: draft.y1 };
    const s = pickWidth ? null : snap(raw);
    snapPt = s;
    if (draft && anchor) {
      const p = s || (evt.shiftKey ? ortho(raw, anchor) : raw);
      draft.x2 = p.x; draft.y2 = p.y;
      const len = Math.hypot(p.x - anchor.x, p.y - anchor.y) * mmPt();
      $("hint").textContent = `Length ${Math.round(len)} mm`;
    }
    drawOverlay();
  }
}

function onPointerUp() {
  if (pan) { pan = null; $("stage").style.cursor = ""; return; }
  if (drag) { const moved = drag.moved; drag = null; snapPt = null; if (moved) update(); }
}

function startPan(evt) {
  evt.preventDefault();
  pan = { x: evt.clientX, y: evt.clientY, sl: $("stage").scrollLeft, st: $("stage").scrollTop };
  $("stage").style.cursor = "grabbing";
}

function finishCalibrate(seg) {
  const lenPt = Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1);
  const dlg = $("calDialog");
  $("calMm").value = "";
  dlg.returnValue = "";
  dlg.onclose = () => {
    const mm = Number($("calMm").value);
    if (dlg.returnValue === "ok" && mm > 0) {
      pushUndo();
      pageInfo().mmPerPt = mm / lenPt; pageInfo().ratio = "custom";
    }
    setTool("select"); update();
  };
  dlg.showModal();
}

// ---------- Tools and tabs ----------

function setTool(t) {
  tool = t; draft = null; snapPt = null; pickWidth = null;
  document.querySelectorAll(".tool").forEach(b => b.classList.toggle("active", b.dataset.tool === t));
  $("overlay").style.cursor = t === "select" ? "default" : "crosshair";
  setHint();
  drawOverlay();
}

function setHint(text) {
  const t = TOOLS.find(x => x.id === tool);
  $("hint").textContent = text || (tool === "calibrate" ? "Click both ends of a dimension you know, then enter its real length." : t ? t.hint : "");
}

function setTab(t) {
  activeTab = t;
  document.querySelectorAll(".tab").forEach(b => b.classList.toggle("active", b.dataset.tab === t));
  renderSide();
}

// ---------- Update cycle ----------

function recompute() {
  refreshProjectDerived();
  solved = solveAll(project);
}

function update() {
  recompute();
  drawOverlay();
  renderSide();
  renderSchedule();
  renderScaleBar();
  autosave();
}

function renderScaleBar() {
  const p = pageInfo();
  if (!p) return;
  const sel = $("scaleSel");
  sel.value = p.ratio || "custom";
  $("scaleInfo").textContent = p.ratio === "custom" ? `${(p.mmPerPt).toFixed(2)} mm/pt` : "";
  $("pageSel").value = view.page;
}

// ---------- Side panel ----------

function renderSide() {
  const body = $("tabBody");
  const focus = document.activeElement && body.contains(document.activeElement) ? document.activeElement.getAttribute("data-k") : null;
  if (activeTab === "workflow") body.innerHTML = workflowPanel();
  else if (activeTab === "project") body.innerHTML = projectPanel();
  else if (activeTab === "library") body.innerHTML = libraryPanel();
  else body.innerHTML = memberPanel();
  if (focus) { const f = body.querySelector(`[data-k="${focus}"]`); if (f) f.focus(); }
}

function memberPanel() {
  const warn = solved.warnings.map(w => `<div class="note">${esc(w)}</div>`).join("");
  const el = selected && elById(selected);
  if (!el) {
    return warn + `<p class="small-text">Select a member on the plan or in the schedule, or draw one with the tools on the left.</p>`;
  }
  if (el.type === "wall") return warn + wallPanel(el);
  if (el.type === "beam") return warn + beamPanel(el);
  if (el.type === "column") return warn + columnPanel(el);
  if (el.type === "footing") return warn + footingPanel(el);
  if (el.type === "note") return `<h3>Note</h3><label class="field">Text<textarea data-k="text" data-f="text" rows="3">${esc(el.text)}</textarea></label><button class="btn danger" data-act="delete">Delete</button>`;
  return `<h3>Dimension</h3><p>${Math.round(Math.hypot(el.x2 - el.x1, el.y2 - el.y1) * mmPt())} mm</p><button class="btn danger" data-act="delete">Delete</button>`;
}

function statusBar(r) {
  if (!r) return "";
  if (r.error) return `<div class="status bad">${esc(r.error)}</div>`;
  return `<div class="status ${r.ok ? "ok" : "bad"}"><span>${r.ok ? "Pass" : "Fail"}</span><span>Utilisation ${fmt(r.util * 100, 0)}%</span></div>`;
}

function steelOptions(sel, isColumn) {
  const fams = isColumn ? ["UB", "UC", "PFC", "SHS", "RHS"] : ["UB", "UC", "PFC", "SHS", "RHS", "Flat", "Angle"];
  return fams.map(f => `<optgroup label="${f}">` + Object.values(SECTIONS).filter(s => s.family === f).map(s => `<option value="${esc(s.name)}"${s.name === sel ? " selected" : ""}>${esc(s.name)}</option>`).join("") + "</optgroup>").join("");
}

function sectionFields(el, isColumn) {
  const grades = project.timberGrades;
  const g = grades[el.grade] || Object.values(grades)[0];
  let sizes = g.sizes.slice();
  if (isColumn) sizes = [...new Set(["90x90", "120x120", "140x140", ...sizes])];
  const timber = `
    <div class="grid2">
      <label class="field">Grade<select data-f="grade" data-k="grade">${Object.keys(grades).map(k => `<option value="${esc(k)}"${k === el.grade ? " selected" : ""}>${esc(grades[k].label)}</option>`).join("")}</select></label>
      <label class="field">Depth x breadth<select data-f="size" data-k="size">${sizes.map(s => `<option${s === el.size ? " selected" : ""}>${esc(s)}</option>`).join("")}</select></label>
    </div>
    <label class="field">Plies<select data-f="plies" data-k="plies" data-num="1">${[1, 2, 3].map(n => `<option${n === Number(el.plies || 1) ? " selected" : ""}>${n}</option>`).join("")}</select></label>`;
  return `
    <label class="field">Material<select data-f="mat" data-k="mat">
      <option value="steel"${el.mat === "steel" ? " selected" : ""}>Steel</option>
      <option value="timber"${el.mat === "timber" ? " selected" : ""}>Timber</option></select></label>
    ${el.mat === "timber" ? timber : `<label class="field">Section<select data-f="sec" data-k="sec">${steelOptions(el.sec, isColumn)}</select></label>`}
    <button class="btn block" data-act="autosize">Suggest lightest passing size</button>`;
}

function pointRows(el, withX) {
  const others = project.elements.filter(e => e.id !== el.id && (e.type === "beam" || e.type === "column"));
  const srcOpts = cur => `<option value="">Manual</option>` + others.map(o => {
    if (o.type === "column") return `<option value="${o.id}"${cur === o.id ? " selected" : ""}>${esc(o.tag)} (pg ${o.page + 1})</option>`;
    return [1, 2].map(n => `<option value="${o.id}:${n}"${cur === `${o.id}:${n}` ? " selected" : ""}>${esc(o.tag)} end ${n} (pg ${o.page + 1})</option>`).join("");
  }).join("");
  return (el.points || []).map((p, i) => `
    <div class="row"><select data-pt="${i}" data-pf="src" data-k="pt${i}src" aria-label="Source">${srcOpts(p.src || "")}</select>
    ${withX ? `<input type="number" step="0.1" data-pt="${i}" data-pf="x" data-k="pt${i}x" value="${esc(p.x ?? 0)}" title="Distance from end 1 (m)" aria-label="Position in m">` : ""}
    <button class="icon" data-act="delpoint" data-i="${i}" aria-label="Remove">×</button></div>
    ${p.src ? "" : `<div class="grid3 small-grid">
      ${["G", "Qf", "Qr"].map(c => `<label class="field">${c} kN<input type="number" step="0.1" data-pt="${i}" data-pf="${c}" data-k="pt${i}${c}" value="${esc(p[c] ?? 0)}"></label>`).join("")}
    </div><label class="field">Wind uplift kN<input type="number" step="0.1" data-pt="${i}" data-pf="Wu" data-k="pt${i}Wu" value="${esc(p.Wu ?? 0)}"></label>`}`).join("");
}

function beamPanel(el) {
  const r = solved.results[el.id];
  const inbound = (solved.conn && solved.conn.onBeam[el.id]) || [];
  const L = Math.hypot(el.x2 - el.x1, el.y2 - el.y1) * mmPt() / 1000;
  const res = r && !r.error ? `
    <h3>Results</h3>
    <table class="calc">
      <tr><th>Combination</th><th>M* kNm</th><th>φM</th><th>V* kN</th><th>φV</th></tr>
      ${r.rows.map(x => `<tr title="${esc(x.detail)}"><td>${esc(x.name)}</td><td class="${x.uM > 1 ? "fail" : ""}">${fmt(x.M)}</td><td>${fmt(x.phiM)}</td><td class="${x.uV > 1 ? "fail" : ""}">${fmt(x.V)}</td><td>${fmt(x.phiV)}</td></tr>`).join("")}
    </table>
    <p class="small-text">${esc(r.gov.detail)}${r.cls ? "; section " + r.cls : ""}. Trib. area ${fmt(r.area)} m², category ${r.cat}.</p>
    <table class="calc">
      <tr><td>Deflection [G + ψQ] incl. creep</td><td class="${r.uD > 1 ? "fail" : ""}">${fmt(Math.abs(r.dPeak))} mm</td><td>limit ${fmt(r.dLimit)} mm</td></tr>
      <tr><td>Required I for deflection</td><td colspan="2">${fmt(r.reqI)} ×10⁶ mm⁴</td></tr>
      <tr><td>Required Z at this capacity</td><td colspan="2">${fmt(r.reqZ, 0)} ×10³ mm³</td></tr>
    </table>
    <h3>Unfactored reactions, kN</h3>
    <table class="calc">
      <tr><th>End</th><th>G</th><th>Q floor</th><th>Q roof</th><th>Uplift</th><th>Factored</th></tr>
      <tr><td>1</td><td>${fmt(r.r1.G)}</td><td>${fmt(r.r1.Qf)}</td><td>${fmt(r.r1.Qr)}</td><td>${fmt(r.r1.Wu)}</td><td>${fmt(r.r1u)}</td></tr>
      ${el.support === "cant" ? "" : `<tr><td>2</td><td>${fmt(r.r2.G)}</td><td>${fmt(r.r2.Qf)}</td><td>${fmt(r.r2.Qr)}</td><td>${fmt(r.r2.Wu)}</td><td>${fmt(r.r2u)}</td></tr>`}
    </table>` : "";
  return `
    <h3>${esc(el.tag)} · span ${fmt(L, 2)} m</h3>
    ${statusBar(r)}
    <label class="field">Tag<input data-f="tag" data-k="tag" value="${esc(el.tag)}"></label>
    <div class="grid2">
      <label class="field">Use<select data-f="use" data-k="use">${Object.keys(project.uses).map(k => `<option value="${k}"${k === el.use ? " selected" : ""}>${esc(project.uses[k].label)}</option>`).join("")}</select></label>
      <label class="field">Support<select data-f="support" data-k="support">
        <option value="ss"${el.support === "ss" ? " selected" : ""}>Simply supported</option>
        <option value="cant"${el.support === "cant" ? " selected" : ""}>Cantilever (fixed at end 1)</option></select></label>
    </div>
    ${sectionFields(el, false)}
    <div class="grid2" style="margin-top:.45rem">
      <label class="field">Top restraint at, mm<input type="number" step="100" data-f="Ltop" data-k="Ltop" data-num="1" value="${esc(el.Ltop || "")}" placeholder="${project.defaultLtop}"></label>
      <label class="field">Bottom restraint at, mm<input type="number" step="100" data-f="Lbot" data-k="Lbot" data-num="1" value="${esc(el.Lbot || "")}" placeholder="full span"></label>
    </div>
    <h3>Load widths</h3>
    ${(el.loads || []).map((l, i) => `<div class="row">
      <select data-load="${i}" data-lf="surface" data-k="ls${i}" aria-label="Surface">${project.surfaces.map(s => `<option value="${esc(s.id)}"${s.id === l.surface ? " selected" : ""}>${esc(s.name)}</option>`).join("")}</select>
      <input type="number" step="0.05" min="0" data-load="${i}" data-lf="width" data-k="lw${i}" value="${esc(l.width)}" aria-label="Width in m" title="Width in m">
      <button class="icon" data-act="pickwidth" data-i="${i}" title="Measure the width on the plan">⇔</button>
      <button class="icon" data-act="delload" data-i="${i}" aria-label="Remove">×</button></div>`).join("")}
    <button class="btn small" data-act="addload">+ Add load width</button>
    <label class="field" style="margin-top:.45rem">Masonry over opening, 45° triangle, kPa<input type="number" step="0.1" min="0" data-f="archKpa" data-k="archKpa" data-num="1" value="${esc(el.archKpa || "")}" placeholder="none"></label>
    <p class="small-text">About 2.0 kPa for a 110 mm leaf. Needs enough masonry above and beside the opening to arch; otherwise add the full height as a load width. Veneer lintels bear at least 150 mm.</p>
    <h3>Point loads</h3>
    ${inbound.length ? `<p class="small-text">Auto from members landing here: ${inbound.map(c => `${esc(elById(c.from).tag)} at ${fmt(c.x, 2)} m`).join(", ")}.</p>` : ""}
    ${pointRows(el, true)}
    <button class="btn small" data-act="addpoint">+ Add point load</button>
    ${res}
    <p style="margin-top:.8rem"><button class="btn danger" data-act="delete">Delete member</button></p>`;
}

function columnPanel(el) {
  const r = solved.results[el.id];
  return `
    <h3>${esc(el.tag)} column</h3>
    ${statusBar(r)}
    <label class="field">Tag<input data-f="tag" data-k="tag" value="${esc(el.tag)}"></label>
    ${sectionFields(el, true)}
    <div class="grid2" style="margin-top:.45rem">
      <label class="field">Height, m<input type="number" step="0.1" data-f="height" data-k="height" data-num="1" value="${esc(el.height)}"></label>
      <label class="field">Effective length factor<input type="number" step="0.05" data-f="ke" data-k="ke" data-num="1" value="${esc(el.ke)}"></label>
    </div>
    <h3>Loads from other levels or manual</h3>
    ${pointRows(el, false)}
    <button class="btn small" data-act="addpoint">+ Add load</button>
    ${r && !r.error ? `
      <h3>Results</h3>
      <p class="small-text">From: ${esc((r.feeds || []).join(", ") || "nothing yet")}. Unfactored G ${fmt(r.N.G)}, Q floor ${fmt(r.N.Qf)}, Q roof ${fmt(r.N.Qr)}, uplift ${fmt(r.N.Wu)} kN.</p>
      <table class="calc"><tr><th>Check</th><th>N* kN</th><th>φN kN</th><th>Util</th></tr>
      ${r.rows.map(x => `<tr title="${esc(x.detail)}"><td>${esc(x.name)}</td><td>${fmt(x.star)}</td><td>${isFinite(x.cap) ? fmt(x.cap) : "–"}</td><td class="${x.u > 1 ? "fail" : ""}">${fmt(x.u * 100, 0)}%</td></tr>`).join("")}</table>
      <p class="small-text">${esc(r.rows[0].detail)}. Axial only; add moments from eccentric bearing by hand.</p>` : ""}
    <p style="margin-top:.8rem"><button class="btn danger" data-act="delete">Delete member</button></p>`;
}

function footingPanel(el) {
  const r = solved.results[el.id];
  return `
    <h3>${esc(el.tag)} pad footing</h3>
    ${statusBar(r)}
    <label class="field">Tag<input data-f="tag" data-k="tag" value="${esc(el.tag)}"></label>
    <div class="grid3">
      <label class="field">Width, mm<input type="number" step="50" data-f="B" data-k="B" data-num="1" value="${esc(el.B)}"></label>
      <label class="field">Length, mm<input type="number" step="50" data-f="Lf" data-k="Lf" data-num="1" value="${esc(el.Lf)}"></label>
      <label class="field">Depth, mm<input type="number" step="50" data-f="D" data-k="D" data-num="1" value="${esc(el.D)}"></label>
    </div>
    <label class="field">Allowable bearing, kPa<input type="number" step="5" data-f="qa" data-k="qa" data-num="1" value="${esc(el.qa)}"></label>
    <h3>Loads from other levels or manual</h3>
    ${pointRows(el, false)}
    <button class="btn small" data-act="addpoint">+ Add load</button>
    ${r && !r.error ? `
      <h3>Results</h3>
      <p class="small-text">From: ${esc((r.feeds || []).join(", ") || "nothing yet")}.</p>
      <table class="calc">
        <tr><td>Service load incl. footing</td><td>${fmt(r.service)} kN</td></tr>
        <tr><td>Bearing pressure</td><td class="${r.uB > 1 ? "fail" : ""}">${fmt(r.pressure, 0)} / ${fmt(r.qa, 0)} kPa</td></tr>
        <tr><td>Square side needed for bearing</td><td>${fmt(r.reqSide, 0)} mm</td></tr>
        <tr><td>Net uplift</td><td class="${r.uU > 1 ? "fail" : ""}">${fmt(r.netUp)} kN</td></tr>
        <tr><td>Depth needed to resist uplift by weight</td><td>${fmt(r.reqD, 0)} mm</td></tr>
      </table>
      <p class="small-text">Sizing check only. Reinforcement, founding depth and any AS 2870 site-class requirements are not designed here.</p>` : ""}
    <p style="margin-top:.8rem"><button class="btn danger" data-act="delete">Delete footing</button></p>`;
}

// Reads the whole set, replaces any earlier draft and sizes each new member
async function runDraft() {
  if (!docInfo || docInfo.kind !== "pdf") return;
  setHint("Reading the plans...");
  const pages = [];
  for (let i = 1; i <= docInfo.pdf.numPages; i++) pages.push(await readPlanPage(await docInfo.pdf.getPage(i)));
  const infos = pages.map(planInfo), plans = infos.map((inf, i) => ({ inf, i })).filter(x => x.inf.isPlan);
  if (!plans.length) { alert("No floor plan with opening tags such as A1218 was found. Draw this set by hand."); update(); return; }
  pushUndo();
  const f = readSetFacts(pages), general = [];
  const adopt = (key, val, label) => { if (!project[key] && val) { project[key] = val; general.push(`${label} read from the drawings. Confirm in Review.`); } };
  adopt("roofType", f.roofType, "Roofing"); adopt("construction", f.construction, "Wall construction");
  if (f.roofFrame && f.roofFrame !== project.roofFrame) { project.roofFrame = f.roofFrame; general.push(`${f.roofFrame} read from the drawings. Confirm in Review.`); }
  if (!project.roofForm) { project.roofForm = "Gable"; general.push("Roof form assumed to be Gable. Change it in Review and redraft if not."); }
  if (!project.roofType) { project.roofType = "roof-sheet"; general.push("Roofing not found, so a sheet roof is assumed."); }
  if (f.pitches.length > 1) general.push(`Drawings give several pitches: ${f.pitches.join("°, ")}°. Confirm them.`);
  general.push(`Wind class ${project.windClass} and site class ${project.siteClass} come from Review, not the drawings. Confirm them first.`);
  general.push("Internal bracing walls, connections, retaining walls and girder trusses are not drafted.");
  project.elements = project.elements.filter(e => !e.draft);
  project.pages.forEach(pg => { delete pg.draft; });
  docInfo.planPages = pages;
  refreshProjectDerived();

  const report = [], made = [], hasUpper = plans.some(p => p.inf.level === "upper");
  plans.forEach(({ inf, i }) => {
    const scale = inf.scale || 100;
    project.pages[i].mmPerPt = PT_TO_MM * scale; project.pages[i].ratio = String(scale);
    const res = draftPlan(pages[i], inf, PT_TO_MM * scale, {
      eave: f.eave || 0.45, form: project.roofForm, roof: project.roofType, roofFrame: project.roofFrame, grade: "F17", wallType: wallDefault(),
      wallH: inf.ceiling || Number(project.wallH) || 2.4, level: inf.level, floorAbove: inf.level === "ground" && hasUpper, floorSurface: f.bondek ? "bondek-140" : "floor-timber",
      lowest: inf.level !== "upper", stripB: (project.footing || {}).width, stripD: (project.footing || {}).depth
    });
    project.pages[i].draft = res.read.geom || null;
    if (!inf.scale) res.review.unshift("No scale found on this sheet, so 1:100 is assumed. Calibrate it.");
    res.elements.forEach(e => { const { code, ...rest } = e; made.push({ id: newId(), page: i, draft: true, ...rest, code }); });
    report.push({ page: i, scale, level: inf.level === "single" ? "single level" : inf.level, openings: inf.openings.length, placed: res.read.placed || 0, span: res.read.span, review: res.review });
  });

  project.elements.push(...made);
  made.forEach(el => { const pick = sizeDraft(el, project); if (pick) { Object.assign(el, pick); if (pick.blockwork) report.find(r => r.page === el.page).review.push("A lower wall has no passing stud, so it is set to 190 blockwork. Confirm this against the architecturals."); } else if (el.kind !== "post" && el.kind !== "pad" && el.wallType !== "masonry") report.find(r => r.page === el.page).review.push(el.kind === "wall" ? "A wall has no passing stud under its load. Set it to masonry or size it by hand; failing walls show in the schedule." : `${el.code || el.kind}: no standard size passes. Size it by hand.`); });
  // A wall that passed alone may not once beams land on it
  const firstPass = solveAll(project).results;
  made.filter(e => e.kind === "wall" && firstPass[e.id] && firstPass[e.id].ok === false).forEach(e => { const pick = sizeDraft(e, project, true); if (pick) { Object.assign(e, pick); if (pick.blockwork) report.find(r => r.page === e.page).review.push("A lower wall carrying floor beams has no passing stud, so it is set to 190 blockwork. Confirm this against the architecturals."); } });
  // Pads take the size their column needs, once every load is on them
  const loaded = solveAll(project).results;
  made.filter(e => e.kind === "pad").forEach(e => {
    const r = loaded[e.id];
    if (!r || r.error) return;
    const fits = [450, 600, 750, 900, 1050, 1200, 1500].flatMap(side => [300, 400, 500, 600].map(D => ({ B: side, Lf: side, D }))).find(s => checkFooting({ ...e, ...s }, r.N, project).ok);
    if (fits) Object.assign(e, fits); else report.find(x => x.page === e.page).review.push("A pad needs more than 1500 square by 600 deep. Size it by hand.");
  });
  // The footing system and any Bondek strip are chosen once, for the engineer to change in Review
  const firstOk = footingOptions(project.siteClass, Number(project.bearing) || 0).filter(o => o.ok);
  const footPick = f.timberFloor && !f.bondek ? firstOk.find(o => o.id === "strip") || firstOk[0] : firstOk[0];
  if (!(project.footing || {}).type && footPick) { project.footing = { ...(project.footing || {}), type: footPick.id }; general.push(`${footPick.label} chosen for Class ${project.siteClass}. Confirm it in Review and enter its size and reinforcement from AS 2870 ${footPick.ref}.`); }
  const bondekGaps = plans.flatMap(({ i }) => ((project.pages[i].draft || {}).floor || {}).bondek ? project.pages[i].draft.floor.gaps : []);
  if (bondekGaps.length && !(project.slabs || []).length) project.slabs = [{ tag: "S1", D: 140, span: Number(Math.max(...bondekGaps.map(x => x.span)).toFixed(2)), db: 16, spacing: 150, cover: 20, continuous: true }];
  tagDrafts(made);
  placeDraftNotes(plans, f);
  project.draftReport = { count: made.length, general, plans: report };
  view.page = plans[0].i; $("pageSel").value = String(view.page); selected = null;
  setTool("select"); setTab("workflow"); zoomFit(); update();
  bracingSummary(project, solved.results).forEach(b => {
    const r = report.find(x => x.page === b.page);
    if (r && (!b.x.ok || !b.y.ok)) r.review.push(`Bracing falls short on the external walls alone: X ${fmt(b.x.cap, 0)} of ${fmt(b.x.F, 0)} kN, Y ${fmt(b.y.cap, 0)} of ${fmt(b.y.F, 0)} kN. Add internal bracing walls.`);
  });
  update();
}

// One tag for each size, as a framing schedule would have it
function tagDrafts(made) {
  const groups = { lintel: "L", outdoorBeam: "VB", floorBeam: "B", post: "C", wall: "W", pad: "F", rafter: "R", ridge: "RB", joist: "J", bearer: "DB" }, seen = {};
  const label = el => el.mat === "timber" ? `${el.plies > 1 ? el.plies + "/" : ""}${el.size} ${el.grade}` : el.sec || "";
  const depth = el => parseSize(el.size || "0").d * (el.plies || 1);
  ["lintel", "outdoorBeam", "floorBeam", "post", "rafter", "ridge", "joist", "bearer"].forEach(kind => {
    const els = made.filter(e => e.kind === kind), sizes = [...new Set(els.slice().sort((a, b) => depth(a) - depth(b)).map(label))];
    els.forEach(e => { e.tag = groups[kind] + (sizes.indexOf(label(e)) + 1); });
  });
  made.filter(e => e.kind === "wall" || e.kind === "pad").forEach(e => { seen[e.kind] = (seen[e.kind] || 0) + 1; e.tag = groups[e.kind] + seen[e.kind]; });
  ["beam", "column", "footing", "wall"].forEach(t => { project.counters[t] = Math.max(project.counters[t] || 0, 100); });
}

// Sheet notes along the top margin, with the schedule an engineer would letter on
function placeDraftNotes(plans, f) {
  const veneer = (CONSTRUCTION[project.construction] || {}).eq === "AMV" || (CONSTRUCTION[project.construction] || {}).eq === "MV";
  const sched = veneer ? masonryLintelSchedule(project) : [];
  plans.forEach(({ i, inf }) => {
    const size = docInfo.dims[i], fs = Math.max(size.w, size.h) / 135, x = size.w * 0.035;
    const lines = [
      "DRAFT MARK-UP. NOT FOR CONSTRUCTION UNTIL REVIEWED BY THE ENGINEER.",
      `${inf.level === "upper" ? "FIRST FLOOR" : inf.level === "ground" ? "GROUND FLOOR" : "FLOOR"}: SITE CLASS ${project.siteClass}, WIND ${project.windClass}. ${f.roofFrame === "Trusses" ? "TRUSSES TO MANUFACTURER'S SPECIFICATION." : ""}`,
      ...(veneer ? [`MASONRY LINTELS: ${sched.map(s => `TO ${s.span} ${s.section}`).join("; ")}. MIN 150 BEARING.`] : [])
    ];
    lines.forEach((text, n) => project.elements.push({ id: newId(), page: i, draft: true, type: "note", x, y: size.h * 0.03 + n * fs * 1.5, text }));
  });
}

function slabPanel() {
  const num = (i, f, label, v, ph, step) => `<label class="field">${label}<input type="number" step="${step || 1}" data-slab="${i}" data-sl="${f}" data-k="sl${i}${f}" value="${esc(v ?? "")}" placeholder="${ph}"></label>`;
  return `
    <h3>Bondek slabs, one-way strip</h3>
    ${(project.slabs || []).map((s, i) => {
      const r = checkBondek(s);
      return `<div class="member-slab">
      <div class="row"><input data-slab="${i}" data-sl="tag" data-k="sl${i}tag" value="${esc(s.tag)}" aria-label="Slab tag"><button class="icon" data-slabact="del" data-i="${i}" aria-label="Remove slab">×</button></div>
      <div class="grid3 small-grid">${num(i, "D", "Depth, mm", s.D, 140, 5)}${num(i, "span", "Span, m", s.span, "", 0.05)}${num(i, "Q", "Q, kPa", s.Q, 1.5, 0.5)}</div>
      <div class="grid3 small-grid">${num(i, "db", "Top bar, mm", s.db, 16, 1)}${num(i, "spacing", "At, mm", s.spacing, 150, 25)}${num(i, "cover", "Cover, mm", s.cover, 20, 5)}</div>
      <div class="grid3 small-grid">${num(i, "Gsup", "Added G, kPa", s.Gsup, 0.15, 0.05)}${num(i, "phiMsup", "Supplier φM+, kNm/m", s.phiMsup, "", 0.5)}${num(i, "maxSpan", "Supplier max span, m", s.maxSpan, "", 0.1)}</div>
      <label class="field"><span><input type="checkbox" data-slab="${i}" data-sl="continuous" data-k="sl${i}c"${s.continuous !== false ? " checked" : ""}> Continuous over a support</span></label>
      <div class="status ${r.fails ? "bad" : r.ok ? "ok" : ""}"><span>${r.fails ? "Fail" : r.ok ? "Pass" : "Incomplete"}</span><span>Utilisation ${fmt(r.util * 100, 0)}%</span></div>
      <table class="calc"><tr><th>Check</th><th>Action</th><th>Capacity</th></tr>${r.rows.map(x => `<tr title="${esc(x.detail)}"><td>${esc(x.name)}</td><td class="${x.u > 1 ? "fail" : ""}">${fmt(x.star)}</td><td>${fmt(x.cap)}</td></tr>`).join("")}</table>
      <p class="small-text">G ${fmt(r.G, 2)} kPa, w* ${fmt(r.wu, 2)} kPa. ${r.open.map(esc).join(". ")}${r.open.length ? "." : ""}</p></div>`;
    }).join("")}
    <button class="btn small" data-slabact="add">+ Add Bondek slab</button>
    <p class="small-text">Load supporting beams with a Bondek surface above. Bar extension, crack control and propping are not checked.</p>`;
}

function projectPanel() {
  return `
    <label class="field">Default top-edge restraint spacing, mm<input type="number" step="100" data-pf-root="defaultLtop" data-k="defaultLtop" data-num="1" value="${esc(project.defaultLtop)}"></label>
    <label class="field">Net roof uplift Cp override<input type="number" step="0.05" data-pf-root="cnet" data-k="cnet" data-num="1" value="${esc(project.cnet)}" placeholder="${designWind(project).cpRoof}"></label>
    <h3>Surface loads, kPa</h3>
    <table class="calc"><tr><th>Surface</th><th>G</th><th>Qf</th><th>Qr</th></tr>
    ${project.surfaces.map((s, i) => `<tr><td>${esc(s.name)}${s.wind ? " ↑" : ""}</td>${["G", "Qf", "Qr"].map(c => `<td><input style="width:50px" type="number" step="0.05" data-sf="${i}" data-sc="${c}" data-k="sf${i}${c}" value="${esc(s[c])}" aria-label="${esc(s.name)} ${c}"></td>`).join("")}</tr>`).join("")}
    </table>
    <p class="small-text">↑ takes wind uplift. Q values are from AS/NZS 1170.1 Tables 3.1 and 3.2. G values are typical allowances; change them to suit the job.</p>
    ${slabPanel()}
    <h3>Deflection limits, [G + ψQ]</h3>
    <table class="calc"><tr><th>Use</th><th>Span /</th><th>Max mm</th></tr>
    ${Object.keys(project.uses).map(k => `<tr><td>${esc(project.uses[k].label)}</td><td><input style="width:56px" type="number" data-use="${k}" data-uc="spanOver" data-k="u${k}s" value="${esc(project.uses[k].spanOver)}" aria-label="Span ratio"></td><td><input style="width:50px" type="number" data-use="${k}" data-uc="maxMm" data-k="u${k}m" value="${esc(project.uses[k].maxMm || "")}" aria-label="Maximum mm"></td></tr>`).join("")}
    </table>`;
}

function libraryPanel() {
  const rows = Object.values(SECTIONS).map(s => `<tr><td>${esc(s.name)}</td><td>${fmt(s.mass)}</td><td>${fmt(s.Ix / 1e6, 1)}</td><td>${fmt(steelZe(s).Ze / 1e3, 0)}</td><td>${s.fy}</td></tr>`).join("");
  return `
    <div class="note">Check this library against current supplier tables before relying on it. Replace the LVL placeholder with your supplier's data.</div>
    <h3>Timber grades (editable JSON)</h3>
    <textarea class="lib-json" id="gradesJson" spellcheck="false">${esc(JSON.stringify(project.timberGrades, null, 1))}</textarea>
    <button class="btn small" data-act="savegrades">Apply grades</button>
    <button class="btn small" data-act="resetgrades">Reset to defaults</button>
    <p class="small-text">bands: [max depth mm, fb, fs, fc]. phi: [category 1, category 2].</p>
    <h3>Steel (calculated from dimensions)</h3>
    <table class="calc"><tr><th>Section</th><th>kg/m</th><th>Ix 10⁶</th><th>Ze 10³</th><th>fy</th></tr>${rows}</table>`;
}

function onSideChange(evt) {
  const t = evt.target;
  if (t.id === "geoFile") { if (t.files[0]) readGeotech(t.files[0]).catch(err => { console.error(err); alert("Could not read that report: " + err.message); }); return; }
  if (t.dataset.geo) { project.geo = project.geo || {}; project.geo[t.dataset.geo] = t.type === "checkbox" ? t.checked : t.value; update(); return; }
  if (t.dataset.fs) { project.footing[t.dataset.fs] = t.value; update(); return; }
  if (t.dataset.ftg) { project.footing.type = t.dataset.ftg; update(); return; }
  if (t.dataset.br) { const pg = project.pages[Number(t.dataset.bp)]; pg.bracing = pg.bracing || {}; pg.bracing[t.dataset.br] = Number(t.value) || 0; update(); return; }
  const val = t.type === "checkbox" ? t.checked : t.type === "number" || t.dataset.num ? (t.value === "" ? 0 : Number(t.value)) : t.value;
  if (t.dataset.slab != null) { project.slabs[Number(t.dataset.slab)][t.dataset.sl] = t.dataset.sl === "tag" || t.type === "checkbox" ? val : t.value === "" ? "" : Number(t.value); update(); return; }
  if (t.dataset.pfRoot) { project[t.dataset.pfRoot] = val; update(); return; }
  if (t.dataset.sf != null) { project.surfaces[Number(t.dataset.sf)][t.dataset.sc] = val; update(); return; }
  if (t.dataset.use) { project.uses[t.dataset.use][t.dataset.uc] = val; update(); return; }
  const el = selected && elById(selected);
  if (!el) return;
  pushUndo();
  if (t.dataset.f) {
    el[t.dataset.f] = val;
    if (t.dataset.f === "grade" && !project.timberGrades[val].sizes.includes(el.size) && el.type === "beam") el.size = project.timberGrades[val].sizes[0];
    if (t.dataset.f === "mat" && val === "timber" && !el.grade) { el.grade = "MGP12"; el.size = el.type === "column" ? "90x90" : "240x45"; el.plies = 1; }
    if (t.dataset.f === "mat" && val === "steel" && !el.sec) el.sec = el.type === "column" ? "89x89x5 SHS" : "200UB25.4";
    if (el.type === "beam" && ["mat", "sec", "grade", "size", "plies", "use"].includes(t.dataset.f)) {
      project.lastBeam = { mat: el.mat, sec: el.sec, grade: el.grade, size: el.size, plies: el.plies, use: el.use };
    }
  } else if (t.dataset.load != null) el.loads[Number(t.dataset.load)][t.dataset.lf] = val;
  else if (t.dataset.pt != null) el.points[Number(t.dataset.pt)][t.dataset.pf] = val;
  update();
}

function onSideClick(evt) {
  const pick = evt.target.closest("[data-pick]");
  if (pick) { selected = pick.dataset.pick; setTab("member"); update(); return; }
  if (evt.target.closest("[data-draft]")) { runDraft().catch(err => { console.error(err); alert("Could not draft from this plan: " + err.message); }); return; }
  const sb = evt.target.closest("[data-slabact]");
  if (sb) {
    project.slabs = project.slabs || [];
    if (sb.dataset.slabact === "add") project.slabs.push({ tag: `S${project.slabs.length + 1}`, D: 140, span: 4, db: 16, spacing: 150, cover: 20, continuous: true });
    else project.slabs.splice(Number(sb.dataset.i), 1);
    update(); return;
  }
  const b = evt.target.closest("[data-act]");
  if (!b) return;
  const act = b.dataset.act, i = Number(b.dataset.i), el = selected && elById(selected);
  if (act === "applygeo") {
    if (b.dataset.f2 === "ys") project.geo.ys = b.dataset.v;
    else if (b.dataset.f2 === "bearing") project.bearing = Number(b.dataset.v);
    else project[b.dataset.f2] = b.dataset.v;
    update(); return;
  }
  if (act === "savegrades") {
    try { project.timberGrades = JSON.parse($("gradesJson").value); update(); }
    catch (e) { alert("That is not valid JSON: " + e.message); }
    return;
  }
  if (act === "resetgrades") { project.timberGrades = JSON.parse(JSON.stringify(TIMBER_GRADES)); update(); return; }
  if (!el) return;
  if (act === "delete") { deleteSelected(); return; }
  if (act === "pickwidth") {
    setTool("select");
    pickWidth = { apply: w => { pushUndo(); el.loads[i].width = w; } };
    $("overlay").style.cursor = "crosshair";
    setHint("Click the two sides of the load width on the plan. Shift keeps it square.");
    return;
  }
  pushUndo();
  if (act === "addload") { (el.loads = el.loads || []).push({ surface: el.type === "wall" || el.use === "roof" ? (project.roofType || "roof-sheet") : "floor-timber", width: 1 }); }
  if (act === "delload") el.loads.splice(i, 1);
  if (act === "addpoint") { (el.points = el.points || []).push({ src: "", x: 0, G: 0, Qf: 0, Qr: 0, Wu: 0 }); }
  if (act === "delpoint") el.points.splice(i, 1);
  if (act === "autosize") {
    const pick = autoSize(el, project);
    if (pick) Object.assign(el, pick);
    else { undoStack.pop(); alert("No section in this family passes. Try another family, grade or more plies."); return; }
  }
  update();
}

function deleteSelected() {
  if (!selected) return;
  pushUndo();
  project.elements = project.elements.filter(e => e.id !== selected);
  selected = null;
  update();
}

// ---------- Schedule ----------

function scheduleRows() {
  return project.elements.filter(e => ["beam", "column", "footing", "wall"].includes(e.type)).map(el => {
    const r = solved.results[el.id];
    const good = r && !r.error;
    const base = { id: el.id, tag: el.tag, page: el.page + 1, type: el.type, section: good ? r.name : "–", ok: good && r.ok, util: good ? r.util : null };
    if (!good) return { ...base, span: "", R1: "", R2: "", uplift: "", M: "", V: "", defl: "" };
    if (el.type === "beam") return { ...base, span: fmt(r.L, 2), R1: fmt(r.r1u), R2: el.support === "cant" ? "–" : fmt(r.r2u), uplift: fmt(Math.max(upliftReaction(r.r1), upliftReaction(r.r2))), M: `${fmt(Math.abs(r.gov.M))} / ${fmt(r.gov.phiM)}`, V: `${fmt(Math.abs(r.gov.V))} / ${fmt(r.gov.phiV)}`, defl: `${fmt(Math.abs(r.dPeak))} / ${fmt(r.dLimit)}` };
    if (el.type === "wall") return { ...base, span: fmt(r.h, 2), R1: fmt(r.line.G + r.line.Qf) + " /m", R2: "–", uplift: fmt(r.netUp) + " /m", M: "–", V: "–", defl: "–" };
    if (el.type === "column") return { ...base, span: fmt(r.h, 2), R1: fmt(r.Nstar), R2: "–", uplift: fmt(r.up), M: "–", V: "–", defl: "–" };
    return { ...base, span: "–", R1: fmt(r.service), R2: "–", uplift: fmt(r.netUp), M: "–", V: "–", defl: "–" };
  });
}

function renderSchedule() {
  const rows = scheduleRows();
  const fails = rows.filter(r => !r.ok).length;
  $("scheduleSum").textContent = rows.length ? `${rows.length} members, ${fails ? fails + " not passing" : "all passing"}` : "";
  $("scheduleBody").innerHTML = rows.length ? `<table><thead><tr>
    <th class="l">Tag</th><th class="l">Pg</th><th class="l">Type</th><th class="l">Section</th><th>Span / ht m</th>
    <th>End 1 kN</th><th>End 2 kN</th><th>Uplift kN</th><th>M* / φM kNm</th><th>V* / φV kN</th><th>δ / limit mm</th><th>Util</th>
    </tr></thead><tbody>${rows.map(r => `<tr data-id="${r.id}" class="${r.id === selected ? "sel" : ""}">
      <td class="l"><b>${esc(r.tag)}</b></td><td class="l">${r.page}</td><td class="l">${r.type}</td><td class="l">${esc(r.section)}</td>
      <td>${r.span}</td><td>${r.R1}</td><td>${r.R2}</td><td>${r.uplift}</td><td>${r.M}</td><td>${r.V}</td><td>${r.defl}</td>
      <td class="${r.ok ? "pass" : "fail"}" style="color:var(--${r.ok ? "pass" : "fail"})">${r.util == null ? "–" : fmt(r.util * 100, 0) + "%"}</td></tr>`).join("")}</tbody></table>`
    : `<p class="small-text">Members you draw are listed here. End reactions are factored; column and footing rows show N* and service load.</p>`;
}

function exportCsv() {
  const head = ["Tag", "Page", "Type", "Section", "Span or height (m)", "End 1 (kN)", "End 2 (kN)", "Uplift (kN)", "M* / phiM (kNm)", "V* / phiV (kN)", "Deflection / limit (mm)", "Utilisation %", "Status"];
  const cell = v => {
    let s = String(v == null ? "" : v);
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s)) s = "'" + s;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const lines = [head.map(cell).join(",")].concat(scheduleRows().map(r => [r.tag, r.page, r.type, r.section, r.span, r.R1, r.R2, r.uplift, r.M, r.V, r.defl, r.util == null ? "" : fmt(r.util * 100, 0), r.ok ? "PASS" : "FAIL"].map(cell).join(",")));
  download(new Blob([lines.join("\r\n")], { type: "text/csv" }), `${baseName()}-schedule.csv`);
}

function baseName() { return (project.ref || (docInfo && docInfo.name.replace(/\.[^.]+$/, "")) || "markup").replace(/[^\w.-]+/g, "_"); }

function download(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ---------- Save and load ----------

function b64encode(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function b64decode(str) {
  const s = atob(str), a = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
  return a;
}

function saveProject() {
  if (!docInfo) { alert("Open a plan first."); return; }
  const data = { version: 1, project, doc: { kind: docInfo.kind, name: docInfo.name, mime: docInfo.mime, bytes: docInfo.bytes ? b64encode(docInfo.bytes) : null } };
  download(new Blob([JSON.stringify(data)], { type: "application/json" }), `${baseName()}.markup.json`);
}

async function loadProjectFile(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch (e) { alert("That file is not a saved project."); return; }
  if (!data.project || !data.doc) { alert("That file is not a saved project."); return; }
  project = fromSaved(data.project);
  await loadDocument(data.doc.kind, data.doc.name, data.doc.bytes ? b64decode(data.doc.bytes) : null, data.doc.mime);
  undoStack.length = 0;
  afterDocLoad();
}

async function restoreAutosave() {
  let saved;
  try { saved = JSON.parse(localStorage.getItem(AUTOSAVE_KEY)); } catch (e) { return; }
  if (!saved || !saved.project || !saved.project.elements.length) return;
  if (saved.docKind === "blank") {
    project = fromSaved(saved.project);
    await loadDocument("blank", saved.docName);
    afterDocLoad();
  } else {
    const empty = $("empty");
    const box = document.createElement("div");
    box.className = "note";
    box.innerHTML = `Your last mark-up of <b>${esc(saved.docName)}</b> (${saved.project.elements.length} items) is saved in this browser. <button class="btn small" id="restoreBtn">Reopen the plan and restore it</button>`;
    empty.appendChild(box);
    const input = document.createElement("input");
    input.type = "file"; input.accept = "application/pdf,image/png,image/jpeg"; input.hidden = true;
    box.appendChild(input);
    $("restoreBtn").onclick = () => input.click();
    input.onchange = async () => {
      if (!input.files[0]) return;
      const f = input.files[0], bytes = new Uint8Array(await f.arrayBuffer());
      await loadDocument(f.type === "application/pdf" || /\.pdf$/i.test(f.name) ? "pdf" : "image", f.name, bytes, f.type);
      if (docInfo.dims.length !== saved.project.pages.length) { alert("This file has a different number of pages from the saved mark-up, so it was not restored."); docInfo = null; return; }
      box.remove();
      project = fromSaved(saved.project);
      afterDocLoad();
    };
  }
}

// ---------- PDF export ----------

async function exportPdf() {
  if (!docInfo) { alert("Open a plan first."); return; }
  if (!window.PDFLib) { alert("The PDF library could not load. Check your internet connection and reload."); return; }
  const { PDFDocument, rgb, StandardFonts, degrees } = PDFLib;
  let doc, viewports = [];
  if (docInfo.kind === "pdf") {
    doc = await PDFDocument.load(docInfo.bytes.slice(), { ignoreEncryption: true });
    for (let i = 0; i < docInfo.dims.length; i++) viewports.push((await docInfo.pdf.getPage(i + 1)).getViewport({ scale: 1 }));
  } else {
    doc = await PDFDocument.create();
    const d = docInfo.dims[0], p = doc.addPage([d.w, d.h]);
    if (docInfo.kind === "image") {
      const im = /png/i.test(docInfo.mime) ? await doc.embedPng(docInfo.bytes) : await doc.embedJpg(docInfo.bytes);
      p.drawImage(im, { x: 0, y: 0, width: d.w, height: d.h });
    }
  }
  const font = await doc.embedFont(StandardFonts.HelveticaBold), plain = await doc.embedFont(StandardFonts.Helvetica);
  const blue = rgb(0.04, 0.36, 0.68), red = rgb(0.75, 0.22, 0.17), brown = rgb(0.54, 0.35, 0), purple = rgb(0.35, 0.18, 0.57), ink = rgb(0.1, 0.14, 0.19);
  const pages = doc.getPages();
  const safe = s => String(s).replace(/[–—]/g, "-").replace(/[^\x20-\x7E]/g, "?");

  docInfo.dims.forEach((d, pi) => {
    const page = pages[pi], vp = viewports[pi];
    const pageRot = vp ? vp.rotation : 0;
    const map = (x, y) => { if (vp) { const q = vp.convertToPdfPoint(x, y); return { x: q[0], y: q[1] }; } return { x, y: d.h - y }; };
    const fs = Math.max(d.w, d.h) / 135;
    const text = (t, x, y, color, ang = 0, center = false) => {
      const str = safe(t), w = font.widthOfTextAtSize(str, fs);
      const a = ang * Math.PI / 180;
      const sx = center ? x - Math.cos(a) * w / 2 : x, sy = center ? y - Math.sin(a) * w / 2 : y;
      const o = map(sx, sy);
      page.drawText(str, { x: o.x, y: o.y, size: fs, font, color, rotate: degrees(-ang + pageRot) });
    };
    const scale = project.pages[pi].mmPerPt;
    project.elements.filter(e => e.page === pi).forEach(el => {
      const r = solved.results[el.id];
      const bad = r && (r.error || r.ok === false);
      if (el.type === "beam" || el.type === "measure" || el.type === "wall") {
        const a = map(el.x1, el.y1), b = map(el.x2, el.y2);
        const color = el.type === "measure" ? purple : bad ? red : el.type === "wall" ? rgb(0.12, 0.48, 0.3) : blue;
        page.drawLine({ start: a, end: b, thickness: el.type === "measure" ? 0.8 : el.type === "wall" ? 3.5 : 2, color, dashArray: el.support === "cant" || el.brace ? [8, 3] : undefined });
        const { x, y, ang } = labelPos(el, fs);
        const label = el.type === "measure" ? Math.round(Math.hypot(el.x2 - el.x1, el.y2 - el.y1) * scale) + " mm" : el.type === "wall" ? wallLabel(el) : planLabel(el);
        text(label, x, y, color, ang, true);
      } else if (el.type === "column" || el.type === "footing") {
        const isCol = el.type === "column";
        const dim = isCol ? (r && r.m ? Math.max(r.m.d || 0, r.m.b || 0) : 300) : (Number(el.B) || 600);
        const s = Math.max(dim / scale, 4);
        const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(c => map(el.x + c[0] * s / 2, el.y + c[1] * s / 2));
        const color = bad ? red : isCol ? blue : brown;
        corners.forEach((c, i) => page.drawLine({ start: c, end: corners[(i + 1) % 4], thickness: 1.2, color, dashArray: isCol ? undefined : [5, 3] }));
        if (isCol) text(planLabel(el), el.x + s * 0.7, el.y - s * 0.7 - fs, color);
        else text(planLabel(el), el.x + s * 0.6, el.y + s * 0.6 + fs, color);
      } else if (el.type === "note") {
        text(el.text, el.x, el.y, ink);
      }
    });
  });

  addSchedulePages(doc, plain, font, rgb, safe);
  const bytes = await doc.save();
  download(new Blob([bytes], { type: "application/pdf" }), `${baseName()}-marked-up.pdf`);
}

function addSchedulePages(doc, plain, bold, rgb, safe) {
  const rows = scheduleRows();
  if (!rows.length) return;
  const W = 842, H = 595, M = 36;
  const cols = [["Tag", 40], ["Pg", 22], ["Type", 50], ["Section", 118], ["Span/ht m", 55], ["End 1 kN", 50], ["End 2 kN", 50], ["Uplift kN", 50], ["M*/phiM kNm", 85], ["V*/phiV kN", 85], ["Defl/limit mm", 80], ["Util", 35]];
  let page, y;
  const start = () => {
    page = doc.addPage([W, H]); y = H - M;
    page.drawText("Member schedule", { x: M, y, size: 14, font: bold }); y -= 15;
    const meta = [project.ref, project.address, `Wind ${project.windClass}`, `Site class ${project.siteClass}`].filter(Boolean).join("  |  ");
    page.drawText(safe(meta), { x: M, y, size: 9, font: plain }); y -= 18;
    let x = M;
    cols.forEach(c => { page.drawText(c[0], { x, y, size: 8, font: bold }); x += c[1]; });
    y -= 4;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.7 });
    y -= 11;
  };
  start();
  rows.forEach(r => {
    if (y < M + 40) start();
    const vals = [r.tag, r.page, r.type, r.section, r.span, r.R1, r.R2, r.uplift, r.M, r.V, r.defl, r.util == null ? "-" : fmt(r.util * 100, 0) + "%"];
    let x = M;
    vals.forEach((v, i) => {
      page.drawText(safe(v), { x, y, size: 8, font: i === 0 ? bold : plain, color: i === 11 && !r.ok ? rgb(0.75, 0.22, 0.17) : rgb(0, 0, 0) });
      x += cols[i][1];
    });
    y -= 12;
  });
  page.drawText("Preliminary design aid. All results to be verified and certified by a qualified structural engineer. End reactions factored.", { x: M, y: M - 8, size: 7.5, font: plain });
}

// ---------- Print report ----------

function designBasis() {
  const p = project, w = designWind(p), g = p.geo || {}, f = p.footing || {}, con = CONSTRUCTION[p.construction];
  const opt = footingOptions(p.siteClass, Number(p.bearing) || 0).find(o => o.id === f.type);
  return `<p>${esc(p.ref)} ${esc(p.address)}<br>Engineer: ${esc(p.engineer) || "–"} · ${new Date().toLocaleDateString("en-AU")}</p>
    <h2>Design basis</h2>
    <table>
      <tr><td>Geotechnical report</td><td class="l">${esc(g.ref || g.fileName || "Not recorded")}${g.reviewed ? "" : " (not marked as reviewed)"}</td></tr>
      <tr><td>Site</td><td class="l">Class ${esc(p.siteClass)}${g.ys ? `, ys ${esc(g.ys)} mm` : ""}, design bearing ${esc(p.bearing)} kPa</td></tr>
      <tr><td>Wind</td><td class="l">${esc(p.windClass)}, Vh,u ${w.Vu} m/s, qu ${fmt(w.q, 2)} kPa, roof uplift ${fmt(w.roofUp, 2)} kPa, stud pressure ${fmt(w.wall, 2)} kPa${g.windReviewed ? "" : " (not marked as confirmed)"}</td></tr>
      <tr><td>Roof</td><td class="l">${esc((p.surfaces.find(s => s.id === p.roofType) || {}).name || "Not set")}, ${esc(p.roofForm || "form not set")}, ${esc(p.pitch || "?")}°, ${esc(p.roofFrame || "")}</td></tr>
      <tr><td>Walls</td><td class="l">${esc(con ? con.label : "Not set")}${con ? `, AS 2870 equivalent ${esc(EQ_LABEL[con.eq])}` : ""}, ${esc(p.storeys)} storey</td></tr>
      <tr><td>Footing</td><td class="l">${opt ? `${esc(opt.label)} (AS 2870 ${esc(opt.ref)}): depth ${esc(f.depth || "?")} mm, width ${esc(f.width || "?")} mm, spacing ${esc(f.spacing || "?")} m, bottom ${esc(f.bars || "?")}, top ${esc(f.top || "–")}, mesh ${esc(f.mesh || "?")}` : "Not selected"}</td></tr>
    </table>`;
}

function bracingReport() {
  const br = bracingSummary(project, solved.results);
  if (!br.length) return "";
  return `<h2>Bracing</h2><table><tr><th>Page</th><th>Direction</th><th>Racking kN</th><th>Capacity kN</th><th>Max gap m</th><th class="l">Walls</th></tr>${br.flatMap(b => [["X", b.x], ["Y", b.y]].map(([d, v]) => `<tr><td>${b.page + 1}</td><td>${d}</td><td>${fmt(v.F)}</td><td class="${v.ok ? "" : "fail"}">${fmt(v.cap)}</td><td>${fmt(v.gap)}</td><td class="l">${esc(v.items.map(i => i.tag).join(", "))}</td></tr>`)).join("")}</table>`;
}

function slabReport() {
  if (!(project.slabs || []).length) return "";
  return `<h2>Bondek slabs</h2>${project.slabs.map(s => {
    const r = checkBondek(s);
    return `<div class="member"><h3>${esc(s.tag)}: ${esc(s.D)} mm, span ${fmt(Number(s.span), 2)} m (${r.fails ? "FAIL" : r.ok ? "PASS" : "INCOMPLETE"})</h3><p>G ${fmt(r.G, 2)} kPa, Q ${fmt(r.Q, 2)} kPa, w* ${fmt(r.wu, 2)} kPa.${r.open.length ? " Open: " + r.open.map(esc).join("; ") + "." : ""}</p>
      <table><tr><th>Check</th><th>Action</th><th>Capacity</th><th class="l">Basis</th></tr>${r.rows.map(x => `<tr><td>${esc(x.name)}</td><td>${fmt(x.star)}</td><td>${fmt(x.cap)}</td><td class="l">${esc(x.detail)}</td></tr>`).join("")}</table></div>`;
  }).join("")}`;
}

function buildReport() {
  const rows = scheduleRows();
  const members = project.elements.filter(e => ["beam", "column", "footing", "wall"].includes(e.type)).map(el => {
    const r = solved.results[el.id];
    if (!r || r.error) return `<div class="member"><h2>${esc(el.tag)}</h2><p>${esc(r ? r.error : "Not solved")}</p></div>`;
    const head = `<h2>${esc(el.tag)}: ${esc(r.name)} (${r.ok ? "PASS" : "FAIL"}, ${fmt(r.util * 100, 0)}%)</h2>`;
    if (el.type === "beam") {
      return `<div class="member">${head}
        <p>Span ${fmt(r.L, 2)} m ${el.support === "cant" ? "cantilever" : "simply supported"}. Line loads, kN/m incl. self-weight: G ${fmt(r.w.G, 2)}, Q floor ${fmt(r.w.Qf, 2)}, Q roof ${fmt(r.w.Qr, 2)}, uplift ${fmt(r.w.Wu, 2)}.${Number(el.archKpa) > 0 && el.support !== "cant" ? ` Masonry over, 45° triangle at ${fmt(el.archKpa, 1)} kPa.` : ""}
        ${r.points.length ? "Point loads: " + r.points.map(p => `${esc(p.label)} at ${fmt(p.x, 2)} m (G ${fmt(p.vec.G)}, Qf ${fmt(p.vec.Qf)}, Qr ${fmt(p.vec.Qr)}, W ${fmt(p.vec.Wu)})`).join("; ") + "." : ""}</p>
        <table><tr><th>Combination</th><th>M* kNm</th><th>φM kNm</th><th>V* kN</th><th>φV kN</th><th class="l">Basis</th></tr>
        ${r.rows.map(x => `<tr><td>${esc(x.name)}</td><td>${fmt(x.M)}</td><td>${fmt(x.phiM)}</td><td>${fmt(x.V)}</td><td>${fmt(x.phiV)}</td><td class="l">${esc(x.detail)}</td></tr>`).join("")}</table>
        <p>Deflection ${fmt(Math.abs(r.dPeak))} mm vs limit ${fmt(r.dLimit)} mm. Reactions, unfactored G / Qf / Qr / W: end 1 ${fmt(r.r1.G)} / ${fmt(r.r1.Qf)} / ${fmt(r.r1.Qr)} / ${fmt(r.r1.Wu)} kN${el.support === "cant" ? "" : `; end 2 ${fmt(r.r2.G)} / ${fmt(r.r2.Qf)} / ${fmt(r.r2.Qr)} / ${fmt(r.r2.Wu)} kN`}.</p></div>`;
    }
    if (el.type === "wall") {
      return `<div class="member">${head}<p>${esc(WALL_TYPES[el.wallType] || "")}, height ${fmt(r.h, 2)} m, length ${fmt(r.L, 2)} m. Line loads incl. wall, kN/m: G ${fmt(r.line.G)}, Qf ${fmt(r.line.Qf)}, Qr ${fmt(r.line.Qr)}, W ${fmt(r.line.Wu)}.${el.brace ? " Bracing wall: " + esc(braceCapacity(el, r, project).detail) + "." : ""}</p>
        <table><tr><th>Check</th><th>Action</th><th>Capacity</th><th class="l">Basis</th></tr>${r.rows.map(x => `<tr><td>${esc(x.name)}</td><td>${fmt(x.star, 2)}</td><td>${fmt(x.cap, 2)} ${esc(x.units)}</td><td class="l">${esc(x.detail)}</td></tr>`).join("")}</table></div>`;
    }
    if (el.type === "column") {
      return `<div class="member">${head}<p>Height ${fmt(r.h, 2)} m. Loads from ${esc((r.feeds || []).join(", ") || "none")}: G ${fmt(r.N.G)}, Qf ${fmt(r.N.Qf)}, Qr ${fmt(r.N.Qr)}, W ${fmt(r.N.Wu)} kN.</p>
        <table><tr><th>Check</th><th>N* kN</th><th>φN kN</th><th class="l">Basis</th></tr>${r.rows.map(x => `<tr><td>${esc(x.name)}</td><td>${fmt(x.star)}</td><td>${isFinite(x.cap) ? fmt(x.cap) : "-"}</td><td class="l">${esc(x.detail)}</td></tr>`).join("")}</table></div>`;
    }
    return `<div class="member">${head}<p>Loads from ${esc((r.feeds || []).join(", ") || "none")}. Service load ${fmt(r.service)} kN incl. ${fmt(r.Wf)} kN footing; bearing ${fmt(r.pressure, 0)} / ${fmt(r.qa, 0)} kPa. Net uplift ${fmt(r.netUp)} kN.</p></div>`;
  }).join("");
  $("report").innerHTML = `
    <h1>Structural mark-up calculations</h1>
    ${designBasis()}
    <h2>Schedule</h2>
    <table><tr><th>Tag</th><th class="l">Section</th><th>Span/ht</th><th>End 1</th><th>End 2</th><th>Uplift</th><th>M*/φM</th><th>V*/φV</th><th>δ/limit</th><th>Util</th></tr>
    ${rows.map(r => `<tr><td>${esc(r.tag)}</td><td class="l">${esc(r.section)}</td><td>${r.span}</td><td>${r.R1}</td><td>${r.R2}</td><td>${r.uplift}</td><td>${r.M}</td><td>${r.V}</td><td>${r.defl}</td><td class="${r.ok ? "" : "fail"}">${r.util == null ? "–" : fmt(r.util * 100, 0) + "%"}</td></tr>`).join("")}</table>
    ${bracingReport()}
    ${slabReport()}
    ${members}
    <div class="disclaimer">Preliminary design aid. Actions to AS/NZS 1170.0 and 1170.1, wind to AS 4055, steel to AS 4100:2020, timber to AS 1720.1, masonry to AS 3700:2018, bracing to AS 1684.2, footings selected under AS 2870. Results must be verified and certified by a qualified structural engineer. Connections, bearing, downward wind, shear distribution, diaphragm action, tie design and footing reinforcement design are not checked.</div>`;
}

// ---------- Wiring ----------

function init() {
  $("tools").innerHTML = TOOLS.map(t => `<button class="tool" data-tool="${t.id}" title="${esc(t.label)} (${t.key})"><svg viewBox="0 0 20 20">${t.icon}</svg>${esc(t.label)}<kbd>${t.key}</kbd></button>`).join("");
  $("tools").addEventListener("click", e => { const b = e.target.closest(".tool"); if (b) setTool(b.dataset.tool); });
  document.querySelector(".tabs").addEventListener("click", e => { const b = e.target.closest(".tab"); if (b) setTab(b.dataset.tab); });

  $("fileInput").addEventListener("change", e => { if (e.target.files[0]) openFile(e.target.files[0]).catch(err => { console.error(err); alert("Could not open that file: " + err.message); }); e.target.value = ""; });
  $("loadInput").addEventListener("change", e => { if (e.target.files[0]) loadProjectFile(e.target.files[0]).catch(err => { console.error(err); alert("Could not load that project: " + err.message); }); e.target.value = ""; });
  $("blankBtn").addEventListener("click", async () => {
    if (project.elements.length && !confirm("Start a blank sheet and clear the current mark-up?")) return;
    project.elements = []; project.counters = { beam: 0, column: 0, footing: 0 }; project.nextId = 1; undoStack.length = 0;
    await loadDocument("blank", "Blank sheet");
    project.pages = [{ mmPerPt: PT_TO_MM * 100, ratio: "100" }];
    afterDocLoad();
  });
  $("saveBtn").addEventListener("click", saveProject);
  $("pdfBtn").addEventListener("click", () => exportPdf().catch(err => { console.error(err); alert("Export failed: " + err.message); }));
  $("sheetsBtn").addEventListener("click", () => exportSheets().catch(err => { console.error(err); alert("Export failed: " + err.message); }));
  $("sheetSel").addEventListener("change", e => { view.sheet = e.target.value; selected = null; update(); });
  $("csvBtn").addEventListener("click", exportCsv);
  $("printBtn").addEventListener("click", () => { buildReport(); window.print(); });

  $("pageSel").addEventListener("change", e => { view.page = Number(e.target.value); selected = null; draft = null; zoomFit(); update(); });
  $("scaleSel").addEventListener("change", e => {
    const p = pageInfo();
    if (!p) return;
    if (e.target.value === "custom") { setTool("calibrate"); renderScaleBar(); return; }
    pushUndo();
    p.ratio = e.target.value; p.mmPerPt = PT_TO_MM * Number(e.target.value);
    update();
  });
  $("calBtn").addEventListener("click", () => { if (docInfo) setTool("calibrate"); });
  $("zoomIn").addEventListener("click", () => setZoom(view.zoom * 1.25));
  $("zoomOut").addEventListener("click", () => setZoom(view.zoom / 1.25));
  $("zoomFit").addEventListener("click", zoomFit);

  const ov = $("overlay");
  ov.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  $("stage").addEventListener("wheel", e => {
    if (!docInfo) return;
    e.preventDefault();
    setZoom(view.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX, e.clientY);
  }, { passive: false });
  $("stage").addEventListener("mousedown", e => { if (e.button === 1) e.preventDefault(); });

  $("tabBody").addEventListener("change", onSideChange);
  $("tabBody").addEventListener("click", onSideClick);
  $("tabBody").addEventListener("toggle", e => { if (e.target.open && e.target.dataset.step) project.openStep = e.target.dataset.step; }, true);
  $("scheduleToggle").addEventListener("click", () => {
    const c = $("schedule").classList.toggle("closed");
    $("scheduleToggle").setAttribute("aria-expanded", String(!c));
  });
  $("scheduleBody").addEventListener("click", e => {
    const tr = e.target.closest("tr[data-id]");
    if (!tr) return;
    selected = tr.dataset.id;
    const el = elById(selected);
    if (el.page !== view.page) { view.page = el.page; zoomFit(); }
    setTab("member"); update();
  });

  window.addEventListener("keydown", e => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.target.isContentEditable;
    if (e.code === "Space" && !typing) { spaceDown = true; e.preventDefault(); }
    if (typing) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "Escape") { draft = null; pickWidth = null; snapPt = null; setTool("select"); return; }
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); deleteSelected(); return; }
    const t = TOOLS.find(x => x.key.toLowerCase() === e.key.toLowerCase());
    if (t && docInfo) setTool(t.id);
  });
  window.addEventListener("keyup", e => { if (e.code === "Space") spaceDown = false; });
  window.addEventListener("resize", () => drawOverlay());

  setTool("select");
  refreshProjectDerived();
  renderSide();
  renderSchedule();
  restoreAutosave().catch(console.error);
}

init();
