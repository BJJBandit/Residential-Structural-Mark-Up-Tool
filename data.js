// Design data: sections, timber grades, surfaces and limits. Everything here is a default the
// project can review; see README for where each value comes from and what to verify.
"use strict";

// Hot-rolled sections: name, d, b, tf, tw, r1 (mm), mass (kg/m)
const STEEL_UB = [
  ["150UB14.0",150,75,7.0,5.0,8,14.0],["150UB18.0",155,75,9.5,6.0,8,18.0],
  ["180UB16.1",173,90,7.0,4.5,8.9,16.1],["180UB18.1",175,90,8.0,5.0,8.9,18.1],["180UB22.2",179,90,10.0,6.0,8.9,22.2],
  ["200UB18.2",198,99,7.0,4.5,11,18.2],["200UB22.3",202,133,7.0,5.0,8.9,22.3],["200UB25.4",203,133,7.8,5.8,8.9,25.4],["200UB29.8",207,134,9.6,6.3,8.9,29.8],
  ["250UB25.7",248,124,8.0,5.0,12,25.7],["250UB31.4",252,146,8.6,6.1,8.9,31.4],["250UB37.3",256,146,10.9,6.4,8.9,37.3],
  ["310UB32.0",298,149,8.0,5.5,13,32.0],["310UB40.4",304,165,10.2,6.1,11.4,40.4],["310UB46.2",307,166,11.8,6.7,11.4,46.2],
  ["360UB44.7",352,171,9.7,6.9,11.4,44.7],["360UB50.7",356,171,11.5,7.3,11.4,50.7],["360UB56.7",359,172,13.0,8.0,11.4,56.7],
  ["410UB53.7",403,178,10.9,7.6,11.4,53.7],["410UB59.7",406,178,12.8,7.8,11.4,59.7]
];
const STEEL_UC = [
  ["100UC14.8",97,99,7.0,5.0,10,14.8],["150UC23.4",152,152,6.8,6.1,8.9,23.4],["150UC30.0",158,153,9.4,6.6,8.9,30.0],["150UC37.2",162,154,11.5,8.1,8.9,37.2],
  ["200UC46.2",203,203,11.0,7.3,11.4,46.2]
];
const STEEL_PFC = [
  ["100PFC",100,50,6.7,4.2,8,8.33],["125PFC",125,65,7.5,4.7,8,11.9],["150PFC",150,75,9.5,6.0,10,17.7],["180PFC",180,75,11.0,6.0,11,20.9],
  ["200PFC",200,75,12.0,6.0,12,22.9],["230PFC",230,75,12.0,6.5,12,25.1],["250PFC",250,90,15.0,8.0,12,35.5],["300PFC",300,90,16.0,8.0,14,40.1]
];
// Cold-formed hollow sections: d, b, t (mm); mass is calculated
const STEEL_RHS = [
  [65,65,3],[75,75,3],[75,75,4],[75,75,5],[75,75,6],[89,89,3.5],[89,89,5],[89,89,6],[100,100,4],[100,100,5],[100,100,6],[125,125,5],[125,125,6],[150,150,5],[150,150,6],
  [100,50,3],[100,50,4],[100,50,5],[125,75,4],[125,75,5],[150,50,4],[150,50,5],[150,100,5],[150,100,6],[200,100,5],[200,100,6]
];

// AS 1720.1:2010 Tables H2.1, H3.1, 7.1 (Cl 7.3) and E1/E2. bands = [max depth, fb, fs, fc] (MPa).
// phi = [Category 1, Category 2] from Table 2.1. rhoB, rhoC are the seasoned material constants.
const TIMBER_GRADES = {
  "MGP10": { label: "MGP10", E: 10000, density: 500, phi: [0.90, 0.70], rhoB: 0.75, rhoC: 0.96, j2: 2,
    bands: [[140,17,2.6,18],[190,16,2.5,18],[240,15,2.4,17],[9999,14,2.3,16]],
    sizes: ["90x35","90x45","120x35","120x45","140x35","140x45","190x35","190x45","240x35","240x45","290x45"] },
  "MGP12": { label: "MGP12", E: 12700, density: 540, phi: [0.90, 0.70], rhoB: 0.85, rhoC: 0.98, j2: 2,
    bands: [[140,28,3.5,24],[190,25,3.3,23],[240,24,3.2,22],[9999,22,3.1,22]],
    sizes: ["90x35","90x45","120x35","120x45","140x35","140x45","190x35","190x45","240x35","240x45","290x45"] },
  "MGP15": { label: "MGP15", E: 15200, density: 570, phi: [0.95, 0.85], rhoB: 0.91, rhoC: 0.99, j2: 2,
    bands: [[140,39,4.3,30],[190,36,4.1,29],[240,33,4.0,28],[9999,31,3.8,27]],
    sizes: ["90x35","90x45","140x35","140x45","190x35","190x45","240x35","240x45","290x45"] },
  "F7": { label: "F7 softwood", E: 7900, density: 550, phi: [0.90, 0.70], rhoB: 0.86, rhoC: 0.91, j2: 2, sizeFactor: true,
    bands: [[9999,18,1.9,13]], sizes: ["90x35","90x45","140x45","190x45","240x45"] },
  "F17": { label: "F17 seasoned hardwood", E: 14000, density: 1000, phi: [0.95, 0.85], rhoB: 0.98, rhoC: 1.00, j2: 2, sizeFactor: true,
    bands: [[9999,42,3.6,34]], sizes: ["90x35","90x45","120x35","120x45","140x35","140x45","190x35","190x45","240x45","290x45"] },
  "GL13": { label: "GL13 glulam", E: 13300, density: 650, phi: [0.95, 0.85], rhoB: 0.89, rhoC: 1.08, j2: 2, sizeFactor: true,
    bands: [[9999,33,4.2,26]], sizes: ["130x65","195x65","260x65","325x65","195x85","260x85","325x85","390x85","260x135","325x135","390x135","455x135","520x135"] },
  "GL17": { label: "GL17 glulam", E: 16700, density: 650, phi: [0.95, 0.85], rhoB: 0.89, rhoC: 1.08, j2: 2, sizeFactor: true,
    bands: [[9999,40,4.2,33]], sizes: ["130x65","195x65","260x65","325x65","195x85","260x85","325x85","390x85","260x135","325x135","390x135","455x135","520x135"] },
  "LVL13": { label: "LVL E13 (PLACEHOLDER: use supplier data)", E: 13200, density: 650, phi: [0.95, 0.90], rhoB: 1.00, rhoC: 1.10, j2: 2, sizeFactor: true,
    bands: [[9999,42,4.6,38]], sizes: ["150x35","150x45","200x35","200x45","240x35","240x45","300x45","360x45","400x45"] }
};

// Loads per m² of the load width entered on the member. G, Qf (floor imposed), Qr (roof imposed), wind = takes uplift.
// Qf/Qr: AS/NZS 1170.1 Tables 3.1 and 3.2 (Note 3 for house roofs). G values are typical allowances to confirm per job.
const DEFAULT_SURFACES = [
  { id: "roof-sheet", name: "Sheet roof + ceiling (roof trib.)", G: 0.40, Qf: 0, Qr: 0.25, wind: true },
  { id: "roof-tile", name: "Tile roof + ceiling (roof trib.)", G: 0.90, Qf: 0, Qr: 0.25, wind: true },
  { id: "floor-timber", name: "Timber floor + ceiling", G: 0.50, Qf: 1.5, Qr: 0, wind: false },
  { id: "floor-tiled", name: "Tiled timber floor (wet area)", G: 1.00, Qf: 1.5, Qr: 0, wind: false },
  { id: "floor-slab", name: "100 mm concrete slab + finishes", G: 2.90, Qf: 1.5, Qr: 0, wind: false },
  { id: "balcony-low", name: "Timber deck < 1 m above ground", G: 0.40, Qf: 1.5, Qr: 0, wind: false },
  { id: "balcony", name: "Timber deck / balcony >= 1 m", G: 0.40, Qf: 2.0, Qr: 0, wind: false },
  { id: "balcony-tiled", name: "Tiled balcony >= 1 m", G: 1.20, Qf: 2.0, Qr: 0, wind: false },
  { id: "roof-space", name: "Non-habitable roof space", G: 0.20, Qf: 0.5, Qr: 0, wind: false },
  { id: "wall-stud", name: "Stud wall, lined (width = height)", G: 0.40, Qf: 0, Qr: 0, wind: false },
  { id: "wall-veneer", name: "Brick veneer wall (width = height)", G: 2.20, Qf: 0, Qr: 0, wind: false },
  { id: "wall-brick", name: "Double brick wall (width = height)", G: 4.00, Qf: 0, Qr: 0, wind: false },
  { id: "line-g", name: "Custom dead line load (width = kN/m)", G: 1.00, Qf: 0, Qr: 0, wind: false }
];

// Ultimate design gust speeds for wind classes, V_h,u (m/s)
const WIND_CLASSES = { N1: 34, N2: 40, N3: 50, N4: 61, N5: 74, N6: 86, C1: 50, C2: 61, C3: 74, C4: 86 };

// AS/NZS 1170.0 Table C1 suggested limits, applied to [G, psi_l Q] incl. creep.
const DEFAULT_USES = {
  roof: { label: "Roof beam", spanOver: 300, maxMm: 0 },
  floor: { label: "Floor beam", spanOver: 300, maxMm: 0 },
  masonry: { label: "Floor beam under masonry", spanOver: 500, maxMm: 0 },
  lintel: { label: "Lintel", spanOver: 240, maxMm: 12 }
};

const SITE_CLASSES = ["A", "S", "M", "M-D", "H1", "H1-D", "H2", "H2-D", "E", "E-D", "P"];
