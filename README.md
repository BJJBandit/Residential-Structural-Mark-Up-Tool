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
| `walls.js` | Wind, AS 2870 selection, wall checks, bracing, load path review. No DOM access |
| `workflow.js` | Review tab steps, wall panel, geotechnical report search |
| `app.js` | PDF viewer, drawing tools, member panel, schedule, exports |
| `tests.html` | Browser test page for the engine |
| `serve.ps1` | Minimal local static server |

## Order of operations

The Review tab follows the design order. A step is ticked once its information is complete.

1. **Geotechnical report and wind speed.** Read the report PDF for values to confirm, or enter site
   class, surface movement and design bearing by hand. Set the wind class or the given V_h,u.
2. **Roof type** from the architecturals: roofing, form, pitch and framing.
3. **Wall type**: construction, with its AS 2870 Table 3.1 equivalent and Table 4.1 deflection limit.
4. **Load paths**: draw the structure, then trace each load to the ground. Anything unsupported is flagged.
5. **Footing type**: AS 2870 options for the site class and bearing, with the figure to read. Enter the
   depth and reinforcement from that figure.
6. **Wall design and bracing**: stud or masonry checks per wall, then racking against bracing capacity
   for each storey and direction.

## Drawing

- **Open plan**, or use a blank sheet. Multi-page PDFs are one level per page.
- **Set the scale** per page from the list, or use **Calibrate** on a known dimension. Scanned or
  re-plotted PDFs should always be calibrated.
- **Draw** with the tools (`W` wall, `B` beam, `C` column, `F` footing, `M` measure, `N` note,
  `V` select). Shift keeps lines square. Ends snap to other members.
- **Set up each member** in the panel: section, load widths (⇔ measures one on the plan) and restraint
  spacing. **Suggest lightest passing size** picks from the same family.
- **Export**: marked-up PDF (the original vector plan plus a schedule page), schedule CSV, or print the
  calculations, which open with the design basis. **Save project** keeps everything in one JSON file.

Keys: `Ctrl+Z` undo, `Ctrl+Y` redo, `Del` delete, `Esc` cancel. Scroll zooms; Space-drag or
middle-drag pans.

## Load path

Members within 100 mm of each other on the same page connect automatically:

- A beam end landing part-way along another beam becomes a point load on it.
- A beam end on a column, wall or footing is carried by that element, and a column passes down to a
  footing beneath it, including its self-weight.
- Between pages, add a point load to the lower element and choose the upper member as its source.

Unfactored G, floor Q, roof Q and wind uplift are carried separately so each member applies its own
combinations. Beam ends that land on nothing are reported as reactions, for example onto a wall.

## What it calculates

**Actions (AS/NZS 1170.0, 1170.1)**

- Strength: 1.35G; 1.2G + 1.5Q floor; 1.2G + 1.5Q roof + 0.4Q floor (ψc from Table 4.1); 0.9G + Wu;
  1.2G + 1.5P with concentrated 1.8 kN on floors, 1.1 kN on house roofs (Table 3.2 Note 3).
- Imposed: 1.5 kPa floors, 2.0 kPa balconies ≥ 1 m, 0.25 kPa house roofs, 0.5 kPa roof spaces.
- Wind: q = 0.6 V²h,u. Net coefficients from AS 4055 Tables 3.1 and 3.2(A): roof −1.0 (N) or −1.44 (C),
  studs +0.9 or +1.22. Only general areas are used, so edge and corner zones need a separate check.
- Serviceability per Table C1 Note 1: j2(G + 0.4Q floor) + the greater of 0.3Q floor or 0.7Q roof.
  Limits are editable: L/300 roof and floor, L/500 under masonry, L/240 and 12 mm for lintels.
  Cantilevers are checked against twice their length.

**Steel (AS 4100:2020)**: section classification and Ze, member moment capacity with αm and αs, shear,
and axial compression with kf and αc. Default sections use 300PLUS; hollow sections use C450.

**Timber walls (AS 1720.1)**: stud compression, and wind with axial load to Equations 3.5(1) and 3.5(2),
and wind deflection. Point loads share over the number of studs you set.

**Masonry walls (AS 3700:2018)**: compression by simple rules (Cl 7.3.3), one-way vertical bending from
face wind (Cl 7.4.2), and in-plane shear with overturning for bracing (Cl 7.5.4). Unreinforced only.

**Bracing**: racking = pressure × area of elevation (AS 4055 Cl 5.1), per storey and direction. Blank
pressure uses 0.96q, an envelope of the tables spot-checked; enter a table value to refine it. Timber
capacity uses AS 1684.2 Table 8.18, reduced by 2.7/h above 2.7 m. Bracing wall spacing is checked against
an editable limit, 9 m by default.

**AS 2870**: site class from surface movement (Table 2.3), bearing minimums of 100 and 50 kPa, equivalent
construction (Table 3.1), available footing systems and deflection limits (Table 4.1).

**Timber (AS 1720.1:2010)**: φ by category (auto category 2 above 25 m² trib. area), k1 by combination,
k12 by restraint and loaded edge, Table H2.1/H3.1 values by depth, j2 = 2 for seasoned timber. k4, k6,
k9 are taken as 1.0.

**Footings**: bearing pressure against an entered allowable, and resistance of uplift by footing
weight (0.9 × 24 kN/m³). Reports the size needed. No reinforcement design.

## Verification status

- Clauses were checked against AS 4100:2020, AS 4055:2012, AS 3700:2018, AS 2870:2011, AS 1720.1:2010,
  AS 1684.2:2021 and AS/NZS 1170.0 and 1170.1. Some tables extracted poorly, so check the timber grades
  and bracing types in the app against the tables.
- AS 2870 Figures 3.1, 3.4 and 3.6 and AS 4055 Tables 5.1 to 5.13 are deliberately not reproduced in this
  public repository. Read those values from your licensed copy.
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
- Sloped members use their plan span, so rafter deflection is understated on steep roofs. Hips and valleys
  are not modelled. Veneer above a lintel is not added automatically; add it as a load width.
- Wall loads are shared uniformly along the wall. Openings, lintels and jamb studs need their own members.
- Racking is shared by capacity only. Diaphragms, torsion and bracing wall connections are not checked.
- Masonry is unreinforced, one-way, solid or cored, with no engaged piers. Two-way bending (Cl 7.4.4),
  cavity and veneer ties (Cl 7.6) and concentrated bearing (Cl 7.3.5) are not designed.
- AS 4055 applies within its limits on height and pitch. Other houses need AS/NZS 1170.2 values entered.
- Reading a geotechnical report is a text search for values to confirm, not a review of the report.
