# Residential Structural Mark-Up

A static web tool for marking up residential architectural plans with structural members. Open a PDF
or image, set the scale, draw beams, columns and pad footings, and the tool calculates spans, load
paths and member checks. It exports the marked-up PDF, a member schedule and printable calculations.

Plans stay in your browser. Nothing is uploaded. The page loads pdf.js and pdf-lib from cdnjs, so it
needs internet access when it opens.

## Running it

No build step. Host the folder as a static site (GitHub Pages or Render, publish directory `.`), or
locally:

```
powershell -ExecutionPolicy Bypass -File serve.ps1
```

then browse to http://localhost:8766/. Engine tests are at `/tests.html`.

## Files

| File | Purpose |
| --- | --- |
| `index.html`, `style.css` | Page and styling |
| `data.js` | Section dimensions, timber grades, surface loads, wind classes, deflection limits |
| `calc.js` | Section properties, load path and member checks. No DOM access |
| `app.js` | PDF viewer, drawing tools, member panel, schedule, exports |
| `tests.html` | Browser test page for the engine |
| `serve.ps1` | Minimal local static server |

## Workflow

1. **Open plan**, or use a blank sheet. Multi-page PDFs are one level per page.
2. **Set the scale** per page from the list, or use **Calibrate** on a known dimension. Scanned or
   re-plotted PDFs should always be calibrated.
3. **Draw** with the tools (`B` beam, `C` column, `F` footing, `M` measure, `N` note, `V` select).
   Shift keeps lines square. Ends snap to other members.
4. **Set up each member** in the panel: use, section, load widths (⇔ measures one on the plan) and
   lateral restraint spacing. **Suggest lightest passing size** picks from the same family.
5. **Export**: marked-up PDF (the original vector plan plus a schedule page), schedule CSV, or print
   the calculations. **Save project** keeps the plan and mark-up in one JSON file.

Keys: `Ctrl+Z` undo, `Ctrl+Y` redo, `Del` delete, `Esc` cancel. Scroll zooms; Space-drag or
middle-drag pans.

## Load path

Members within 100 mm of each other on the same page connect automatically:

- A beam end landing part-way along another beam becomes a point load on it.
- A beam end on a column or footing is carried by that element, and a column passes down to a
  footing beneath it, including its self-weight.
- Between pages, add a point load to the lower element and choose the upper member as its source.

Unfactored G, floor Q, roof Q and wind uplift are carried separately so each member applies its own
combinations. Beam ends that land on nothing are reported as reactions, for example onto a wall.

## What it calculates

**Actions (AS/NZS 1170.0, 1170.1)**

- Strength: 1.35G; 1.2G + 1.5Q floor; 1.2G + 1.5Q roof + 0.4Q floor (ψc from Table 4.1); 0.9G + Wu;
  1.2G + 1.5P with concentrated 1.8 kN on floors, 1.1 kN on house roofs (Table 3.2 Note 3).
- Imposed: 1.5 kPa floors, 2.0 kPa balconies ≥ 1 m, 0.25 kPa house roofs, 0.5 kPa roof spaces.
- Wind uplift: q = 0.6 V²h,u from the wind class, times an editable net Cp. Applies to roof surfaces.
- Serviceability per Table C1 Note 1: j2(G + 0.4Q floor) + the greater of 0.3Q floor or 0.7Q roof.
  Limits are editable: L/300 roof and floor, L/500 under masonry, L/240 and 12 mm for lintels.
  Cantilevers are checked against twice their length.

**Steel (AS 4100)**: section classification and Ze, member moment capacity with αm and αs, shear,
and axial compression with kf and αc. Default sections use 300PLUS; hollow sections use C450.

**Timber (AS 1720.1:2010)**: φ by category (auto category 2 above 25 m² trib. area), k1 by combination,
k12 by restraint and loaded edge, Table H2.1/H3.1 values by depth, j2 = 2 for seasoned timber. k4, k6,
k9 are taken as 1.0.

**Footings**: bearing pressure against an entered allowable, and resistance of uplift by footing
weight (0.9 × 24 kN/m³). Reports the size needed. No reinforcement design.

## Verification status

- Timber values, combination factors and imposed actions were read from AS 1720.1, AS/NZS 1170.0 and
  1170.1. Some table text extracted poorly, so check the grade values in the Library tab.
- **The AS 4100 and AS 4055 copies available were damaged, so steel clauses and wind speeds are from
  working knowledge and have not been checked against the text.** Please review them.
- Steel properties are calculated from section dimensions and tested against a sample of tabulated
  values. Section dimensions were not checked against a current catalogue.
- **The LVL13 grade is a placeholder.** Replace it with your supplier's data.
- Surface G values and the net Cp are typical allowances, not standard values.

## Assumptions and limits

Preliminary design aid. All results must be verified and certified by a qualified structural engineer.

- Beams are single-span simply supported or cantilever. Continuous beams are not modelled, and
  backspan effects on cantilevers are ignored.
- Load widths apply as full-length uniform loads. Partial loads need manual point loads.
- Load widths are entered, not derived from roof or floor geometry. Roof widths are plan projection.
- Downward wind (1.2G + Wu + ψcQ) and serviceability wind are not checked, and neither is wall wind,
  bracing or racking.
- Columns are axial only. Eccentric bearing moments and biaxial or combined actions are not checked.
- Connections, bearing, web crippling, floor vibration, fire and durability are not checked.
- Steel αm is 1.13 for a UDL on a full unrestrained span and otherwise 1.0. Load height factor kl is
  1.4 for the top edge in compression. Twist restraint factors are 1.0.
- PFCs are treated as loaded through the shear centre. Check eccentric loading by hand.
- Balcony edge load of 1.5 kN/m and earthquake actions are not included.
