// Shows a mark-up sheet over the plan and exports the set as a PDF.
"use strict";

const rgbCss = c => `rgb(${c.map(v => Math.round(v * 255)).join(",")})`;

function currentSheet() {
  const t = SHEET_TOPICS.find(x => x.id === view.sheet);
  return buildSheet(project, solved, { topic: t.id, title: t.title, page: view.page }, docInfo.dims[view.page], docInfo.planPages && docInfo.planPages[view.page]);
}

// The lines and notes a sheet adds to its members, as they will export
function drawSheetExtras(svg, sheet) {
  const g = svgEl("g", { "pointer-events": "none" }, svg);
  const dash = p => p.dash ? { "stroke-dasharray": p.dash.join(" ") } : {};
  sheet.prims.forEach(p => {
    if (p.t === "line") svgEl("line", { x1: p.x1, y1: p.y1, x2: p.x2, y2: p.y2, stroke: rgbCss(p.color), "stroke-width": p.w, ...dash(p) }, g);
    else if (p.t === "rect") svgEl("rect", { x: p.x, y: p.y, width: p.w, height: p.h, fill: "none", stroke: rgbCss(p.color), "stroke-width": p.thick || 1, ...dash(p) }, g);
    else svgEl("text", { x: p.x, y: p.y, "font-size": p.size, fill: rgbCss(p.color), "font-family": "Arial, sans-serif", "font-weight": p.bold ? 700 : 400, "text-anchor": p.center ? "middle" : "start" }, g, p.s);
  });
  const b = sheet.panel;
  if (b) {
    svgEl("rect", { x: b.x, y: b.y, width: b.w, height: b.h, fill: "#fff", stroke: "#1c2530", "stroke-width": 0.6 }, g);
    b.lines.forEach((l, i) => svgEl("text", { x: b.x + b.size * 0.75, y: b.y + b.size * 1.3 * (i + 1), "font-size": b.size, fill: rgbCss(l.color || SHEET_INK), "font-family": "Arial, sans-serif", "font-weight": l.bold ? 700 : 400 }, g, l.s));
  } else setHint("The notes for this sheet do not fit on the plan, so they export on their own page.");
}

// One drawing per topic and level, each on its own copy of the architect's plan sheet
async function buildSheetPdf() {
  const list = sheetList(project, solved.conn);
  const { PDFDocument, rgb, StandardFonts, degrees } = PDFLib;
  const src = await PDFDocument.load(docInfo.bytes.slice(), { ignoreEncryption: true }), doc = await PDFDocument.create();
  const bold = await doc.embedFont(StandardFonts.HelveticaBold), plain = await doc.embedFont(StandardFonts.Helvetica);
  const safe = s => String(s).replace(/[–—]/g, "-").replace(/[^\x20-\x7E]/g, "?"), col = c => rgb(c[0], c[1], c[2]);
  docInfo.planPages = docInfo.planPages || [];
  for (const item of list) {
    const pi = item.page, d = docInfo.dims[pi], pdfPage = await docInfo.pdf.getPage(pi + 1), vp = pdfPage.getViewport({ scale: 1 });
    if (!docInfo.planPages[pi]) docInfo.planPages[pi] = await readPlanPage(pdfPage);
    const sheet = buildSheet(project, solved, item, d, docInfo.planPages[pi]);
    const [page] = await doc.copyPages(src, [pi]);
    doc.addPage(page);
    const map = (x, y) => { const q = vp.convertToPdfPoint(x, y); return { x: q[0], y: q[1] }; };
    const write = (s, x, y, size, color, isBold, center, ang = 0) => {
      const str = safe(s), font = isBold ? bold : plain, a = ang * Math.PI / 180, w = center ? font.widthOfTextAtSize(str, size) : 0;
      page.drawText(str, { ...map(x - Math.cos(a) * w / 2, y - Math.sin(a) * w / 2), size, font, color, rotate: degrees(-ang + vp.rotation) });
    };
    const fs = Math.max(d.w, d.h) / 150;
    sheet.members.forEach(el => {
      const r = solved.results[el.id], bad = r && (r.error || r.ok === false);
      if (el.type === "beam" || el.type === "wall") {
        const color = bad ? col(SHEET_RED) : el.type === "wall" ? col(SHEET_GREEN) : col(SHEET_BLUE);
        page.drawLine({ start: map(el.x1, el.y1), end: map(el.x2, el.y2), thickness: el.type === "wall" ? 2.5 : 1.8, color, dashArray: el.support === "cant" ? [8, 3] : undefined });
        const { x, y, ang } = labelPos(el, fs);
        write(el.tag, x, y, fs, color, true, true, ang);
      } else {
        const isCol = el.type === "column", dim = isCol ? (r && r.m ? Math.max(r.m.d || 0, r.m.b || 0) : 300) : (Number(el.B) || 600);
        const s = Math.max(dim / project.pages[pi].mmPerPt, 4), color = bad ? col(SHEET_RED) : isCol ? col(SHEET_BLUE) : col(SHEET_BROWN);
        const c = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(k => map(el.x + k[0] * s / 2, el.y + k[1] * s / 2));
        c.forEach((q, i) => page.drawLine({ start: q, end: c[(i + 1) % 4], thickness: 1.2, color, dashArray: isCol ? undefined : [5, 3] }));
        write(el.tag, el.x + s * 0.6, isCol ? el.y - s * 0.6 : el.y + s * 0.6 + fs, fs, color, true);
      }
    });
    project.elements.filter(e => e.page === pi && e.type === "note" && !e.draft).forEach(e => write(e.text, e.x, e.y, fs, col(SHEET_INK), false));
    sheet.prims.forEach(p => {
      if (p.t === "line") page.drawLine({ start: map(p.x1, p.y1), end: map(p.x2, p.y2), thickness: p.w, color: col(p.color), dashArray: p.dash });
      else if (p.t === "rect") {
        const c = [[p.x, p.y], [p.x + p.w, p.y], [p.x + p.w, p.y + p.h], [p.x, p.y + p.h]].map(k => map(k[0], k[1]));
        c.forEach((q, i) => page.drawLine({ start: q, end: c[(i + 1) % 4], thickness: p.thick || 1, color: col(p.color), dashArray: p.dash }));
      } else write(p.s, p.x, p.y, p.size, col(p.color), p.bold, p.center);
    });
    if (sheet.panel) {
      const b = sheet.panel, A = map(b.x, b.y), B = map(b.x + b.w, b.y + b.h);
      page.drawRectangle({ x: Math.min(A.x, B.x), y: Math.min(A.y, B.y), width: Math.abs(B.x - A.x), height: Math.abs(B.y - A.y), color: rgb(1, 1, 1), borderColor: col(SHEET_INK), borderWidth: 0.6 });
      b.lines.forEach((l, i) => write(l.s, b.x + b.size * 0.75, b.y + b.size * 1.3 * (i + 1), b.size, col(l.color || SHEET_INK), l.bold));
    } else {
      write("NOTES AND SCHEDULE ON THE NEXT PAGE", fs, d.h - fs, fs, col(SHEET_RED), true);
      addSheetNotesPage(doc, sheet, plain, bold, col, safe);
    }
  }
  addSchedulePages(doc, plain, bold, rgb, safe);
  return { bytes: await doc.save(), sheets: list.length };
}

async function exportSheets() {
  if (!docInfo) { alert("Open a plan first."); return; }
  if (docInfo.kind !== "pdf") { alert("The sheet set needs a PDF plan."); return; }
  if (!window.PDFLib) { alert("The PDF library could not load. Check your internet connection and reload."); return; }
  if (!sheetList(project, solved.conn).length) { alert("Nothing to issue yet. Draft or draw the mark-up first."); return; }
  const { bytes, sheets } = await buildSheetPdf();
  download(new Blob([bytes], { type: "application/pdf" }), `${baseName()}-sheets.pdf`);
  setHint(`Sheet set exported: ${sheets} sheets plus the member schedule.`);
}

// Notes too long for clear space on the plan go on an A3 page straight after it
function addSheetNotesPage(doc, sheet, plain, bold, col, safe) {
  const W = 1191, H = 842, M = 40, size = 9, colW = (W - 3 * M) / 2, page = doc.addPage([W, H]);
  page.drawText(safe(`${sheet.heading} - NOTES AND SCHEDULE`), { x: M, y: H - M, size: 14, font: bold });
  let x = M, y = H - M - 26;
  wrapPanel(sheet.lines, colW, size).forEach(l => {
    if (y < M) { x += colW + M; y = H - M - 26; }
    page.drawText(safe(l.s), { x, y, size, font: l.bold ? bold : plain, color: col(l.color || SHEET_INK) });
    y -= size * 1.4;
  });
}
