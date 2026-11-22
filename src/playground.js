// Playground: a play mat and a box of toys, in 3D.
//
// Not a 3D editor. A carpet with roads on it, and simple toys to put on top: blocks,
// cardboard-box buildings, cars, trees, peg people, letter blocks. Pick a toy and it
// plops onto the mat; drag it around (toys stack on each other), turn it, resize it,
// give it a colour. Drag the empty floor to look around. "Save picture" downloads what
// you see. What you build is kept in this browser.
//
// Kid test: build something, then press "Release the kids!". A crowd of small children
// charges across the mat for a few seconds, shoving and climbing on everything (with real
// physics: toys topple and tumble). When they leave, you see how much is still standing.
//
// openPlayground({ boardId, addImage(blob, name) or null, toast(message) })

import * as THREE from '../vendor/three/three.module.min.js';
import { OrbitControls } from '../vendor/three/OrbitControls.js';
import * as CANNON from '../vendor/cannon-es.js';

// Primary colours, leaning on Melti's own pink and blue.
const CARD = '#c8a06a';   // plain cardboard
const COLOURS = ['#ff3fa9', '#3d7bff', '#ffd23f', '#ff5a4f', '#3ecf8e', '#ff9a3d', '#f6f3ff', '#24222e', CARD];
const ROAD = '#3b3850', LINE = '#f6f3ff';
let MAT_W = 30, MAT_D = 20;     // the carpet, in toy units (a block is 1); it can be made bigger
const PATTERN = 1.5;            // how big the town picture is drawn: a road is two cars wide
const SIZES = { small: [30, 30], medium: [45, 30], big: [60, 45], huge: [90, 60] };
const KID = 5;                  // the kids are real children: giants next to the toys
const KID_R = 1.2;              // how wide a kid is when bumping into things

const KEY = (id, mode = 'free') => (mode === 'herd' ? `playground.herd.${id}` : `playground.scene.${id}`);

// ---------- The carpet ----------

// The town, as a plan in carpet units (0,0 is the top-left corner): a ring road, a street every 10 units,
// and something in every block. The picture, the random town and the driving cars all read this plan.
// (patternPlan works in the picture's own units; townPlan gives the same plan in toy units.)
function patternPlan(W, H) {
  const xs = [1.7], ys = [1.7];
  for (let x = 10; x < W - 5; x += 10) xs.push(x);
  for (let y = 10; y < H - 5; y += 10) ys.push(y);
  xs.push(W - 1.7); ys.push(H - 1.7);
  const plan = { W, H, xs, ys, rounds: [], zebras: [], plots: [], ponds: [], lots: [], pitches: [], fairs: [] };
  for (let i = 1; i < xs.length - 1; i++) for (let j = 1; j < ys.length - 1; j++) {
    const round = (i + j) % 2 === 1, x = xs[i], y = ys[j], o = round ? 2.6 : 2.1;
    if (round) plan.rounds.push([x, y]);
    plan.zebras.push([x - o, y, true], [x + o, y, true], [x, y - o, false], [x, y + o, false]);
  }
  const kinds = ['pond', 'plotsA', 'plotsB', 'plotsB', 'lot', 'fair', 'plotsA', 'plotsB', 'pond', 'plotsA', 'lot', 'plotsB', 'plotsB', 'fair', 'plotsA'];
  const tints = ['#ffd0ea', '#ffd23f', '#ff9a3d'];
  let n = 0, tint = 0;
  for (let r = 0; r < ys.length - 1; r++) for (let c = 0; c < xs.length - 1; c++) {
    const x = xs[c] + 1.3, y = ys[r] + 1.3, w = xs[c + 1] - xs[c] - 2.6, h = ys[r + 1] - ys[r] - 2.6, kind = kinds[n++ % kinds.length];
    const row = (yy, hh, count) => { const pw = (w - 0.5 * (count - 1)) / count; for (let k = 0; k < count; k++) plan.plots.push({ x: x + k * (pw + 0.5), y: yy, w: pw, h: hh, col: tints[tint++ % 3] }); };
    const half = (h - 0.6) / 2;
    if (kind === 'pond') plan.ponds.push({ x: x + w / 2, y: y + h / 2, rx: w * 0.42, ry: h * 0.27 });
    else if (kind === 'plotsA') { row(y, half, w > 6.5 ? 3 : 2); row(y + half + 0.6, half, 2); }
    else if (kind === 'plotsB') { row(y, half, 2); row(y + half + 0.6, half, 1); }
    else if (kind === 'lot') { plan.lots.push({ x, y, w, h: half }); plan.pitches.push({ x, y: y + half + 0.6, w, h: half }); }
    else plan.fairs.push({ x, y, w, h });
  }
  return plan;
}
function townPlan(W, H) {
  const k = PATTERN, plan = patternPlan(W / k, H / k), box = (q) => ({ ...q, x: q.x * k, y: q.y * k, w: q.w * k, h: q.h * k });
  return { ...plan, W, H, xs: plan.xs.map((v) => v * k), ys: plan.ys.map((v) => v * k), rounds: plan.rounds.map(([x, y]) => [x * k, y * k]), zebras: plan.zebras.map(([x, y, v]) => [x * k, y * k, v]),
    plots: plan.plots.map(box), lots: plan.lots.map(box), pitches: plan.pitches.map(box), fairs: plan.fairs.map(box), ponds: plan.ponds.map((q) => ({ x: q.x * k, y: q.y * k, rx: q.rx * k, ry: q.ry * k })) };
}

function carpetTexture(style, W, H) {
  const u = Math.floor(Math.min(80, 3072 / W));   // pixels per toy unit (less on a huge carpet, to go easy on phones)
  const c = document.createElement('canvas');
  c.width = Math.round(W * u); c.height = Math.round(H * u);
  const g = c.getContext('2d');
  g.scale(u * PATTERN, u * PATTERN);   // from here on, everything is drawn in the picture's own units
  W /= PATTERN; H /= PATTERN;
  if (style === 'plain') {
    g.fillStyle = '#3ecf8e'; g.fillRect(0, 0, W, H);
  } else if (style === 'grid') {
    for (let y = 0; y < H / 2; y++) for (let x = 0; x < W / 2; x++) { g.fillStyle = (x + y) % 2 ? '#f6f3ff' : '#ffd0ea'; g.fillRect(x * 2, y * 2, 2, 2); }
  } else {
    const plan = patternPlan(W, H), { xs, ys } = plan;
    g.fillStyle = '#58d6a0'; g.fillRect(0, 0, W, H);
    const road = (draw) => { g.strokeStyle = ROAD; g.lineWidth = 1.5; g.lineCap = 'round'; g.lineJoin = 'round'; g.setLineDash([]); g.beginPath(); draw(); g.stroke(); };
    const dashes = (draw) => { g.strokeStyle = LINE; g.lineWidth = 0.08; g.setLineDash([0.46, 0.4]); g.beginPath(); draw(); g.stroke(); g.setLineDash([]); };
    const ring = () => { g.roundRect(1.7, 1.7, W - 3.4, H - 3.4, 2.2); };
    const streets = () => { for (const x of xs.slice(1, -1)) { g.moveTo(x, 1.7); g.lineTo(x, H - 1.7); } for (const y of ys.slice(1, -1)) { g.moveTo(1.7, y); g.lineTo(W - 1.7, y); } };
    road(ring); road(streets);
    dashes(ring); dashes(streets);
    for (const [x, y] of plan.rounds) {
      g.fillStyle = ROAD; g.beginPath(); g.arc(x, y, 1.7, 0, 7); g.fill();
      g.fillStyle = '#ff3fa9'; g.beginPath(); g.arc(x, y, 0.78, 0, 7); g.fill();
      g.strokeStyle = LINE; g.lineWidth = 0.08; g.beginPath(); g.arc(x, y, 1.24, 0, 7); g.setLineDash([0.4, 0.34]); g.stroke(); g.setLineDash([]);
    }
    g.fillStyle = LINE;
    for (const [x, y, vertical] of plan.zebras) for (let i = -3; i <= 3; i++) vertical ? g.fillRect(x - 0.3, y + i * 0.2 - 0.06, 0.6, 0.12) : g.fillRect(x + i * 0.2 - 0.06, y - 0.3, 0.12, 0.6);
    for (const p of plan.ponds) {
      g.fillStyle = '#3d7bff'; g.beginPath(); g.ellipse(p.x, p.y, p.rx, p.ry, -0.2, 0, 7); g.fill();
      g.fillStyle = '#8fb6ff'; g.beginPath(); g.ellipse(p.x - p.rx * 0.2, p.y - p.ry * 0.25, p.rx * 0.4, p.ry * 0.28, -0.2, 0, 7); g.fill();
    }
    for (const p of plan.lots) {
      g.fillStyle = '#4a4763'; g.beginPath(); g.roundRect(p.x, p.y, p.w, p.h, 0.26); g.fill();
      g.strokeStyle = LINE; g.lineWidth = 0.06;
      for (let bx = p.x + 0.97; bx < p.x + p.w - 0.3; bx += 0.97) { g.beginPath(); g.moveTo(bx, p.y + 0.1); g.lineTo(bx, p.y + 1); g.moveTo(bx, p.y + p.h - 1); g.lineTo(bx, p.y + p.h - 0.1); g.stroke(); }
    }
    for (const p of plan.pitches) {
      g.fillStyle = '#7be3b4'; g.beginPath(); g.roundRect(p.x, p.y, p.w, p.h, 0.2); g.fill();
      g.strokeStyle = LINE; g.lineWidth = 0.07; g.beginPath(); g.roundRect(p.x + 0.25, p.y + 0.25, p.w - 0.5, p.h - 0.5, 0.1);
      g.moveTo(p.x + p.w / 2, p.y + 0.25); g.lineTo(p.x + p.w / 2, p.y + p.h - 0.25); g.moveTo(p.x + p.w / 2 + 0.55, p.y + p.h / 2); g.arc(p.x + p.w / 2, p.y + p.h / 2, 0.55, 0, 7); g.stroke();
    }
    // The fairground: a pale pad with a dotted edge, like sawdust.
    for (const p of plan.fairs) {
      g.fillStyle = '#ffe9b8'; g.beginPath(); g.roundRect(p.x, p.y, p.w, p.h, 0.6); g.fill();
      g.strokeStyle = '#ff3fa9'; g.lineWidth = 0.12; g.lineCap = 'round'; g.setLineDash([0.01, 0.5]); g.beginPath(); g.roundRect(p.x + 0.3, p.y + 0.3, p.w - 0.6, p.h - 0.6, 0.4); g.stroke(); g.setLineDash([]);
    }
    for (const p of plan.plots) { g.fillStyle = p.col; g.globalAlpha = 0.55; g.beginPath(); g.roundRect(p.x, p.y, p.w, p.h, 0.22); g.fill(); g.globalAlpha = 1; }
    // A stitched border, like a real play mat.
    g.strokeStyle = '#2f9f73'; g.lineWidth = 0.1; g.lineCap = 'butt'; g.setLineDash([0.26, 0.2]); g.strokeRect(0.34, 0.34, W - 0.68, H - 0.68); g.setLineDash([]);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// ---------- The toys ----------
// Every toy is a group standing on y = 0, with one main material (toy.userData.paint)
// that takes its colour.

const lambert = (color) => new THREE.MeshLambertMaterial({ color });
const part = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; return m; };
const wheelMat = lambert('#24222e'), hubMat = lambert('#f6f3ff'), skin = lambert('#ffe0c2'), trunk = lambert('#a86b3c'), glass = lambert('#bfe3ff'), roof = lambert('#ff5a4f');

function wheels(g, xs, z, r = 0.2) {
  const geo = new THREE.CylinderGeometry(r, r, 0.14, 18);
  for (const x of xs) for (const s of [-1, 1]) {
    const w = part(geo, wheelMat, x, r, s * z);
    w.rotation.x = Math.PI / 2;
    g.add(w, part(new THREE.CylinderGeometry(r * 0.45, r * 0.45, 0.16, 12), hubMat, x, r, s * z).rotateX(Math.PI / 2));
  }
}
function windowTexture() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 192;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, 128, 192);
  g.fillStyle = 'rgba(40,36,60,0.55)';
  for (let y = 0; y < 3; y++) for (let x = 0; x < 2; x++) g.fillRect(20 + x * 52, 22 + y * 56, 36, 38);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function letterTexture(ch) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(40,36,60,0.35)'; g.lineWidth = 8; g.strokeRect(8, 8, 112, 112);
  g.fillStyle = 'rgba(30,26,50,0.85)'; g.font = '700 86px Fredoka, system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(ch, 64, 70);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// Cardboard: faint corrugation and worn edges and, if you draw on it, wobbly marker windows and a door.
function cardTexture(cols, rows, door, drawn) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(70,45,10,0.07)'; g.lineWidth = 2;
  for (let x = 6; x < 256; x += 9) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 256); g.stroke(); }
  g.strokeStyle = 'rgba(70,45,10,0.22)'; g.lineWidth = 10; g.strokeRect(0, 0, 256, 256);
  if (drawn) {
    let seed = cols * 7 + rows * 13 + 5;
    const wob = () => { seed = (seed * 16807) % 2147483647; return (seed / 2147483647 - 0.5) * 6; };
    const pen = (pts) => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x + wob(), y + wob()) : g.moveTo(x + wob(), y + wob()))); g.stroke(); };
    g.strokeStyle = 'rgba(35,30,60,0.9)'; g.lineWidth = 5.5; g.lineCap = 'round'; g.lineJoin = 'round';
    const top = 26, bottom = door ? 150 : 230, cw = 204 / cols, ch = (bottom - top) / rows;
    for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
      const x = 26 + q * cw + cw * 0.16, y = top + r * ch + ch * 0.14, w = cw * 0.68, h = ch * 0.72;
      pen([[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y], [x + w * 0.3, y]]);   // a box, the pen overshooting a little
      pen([[x + w / 2, y], [x + w / 2, y + h]]); pen([[x, y + h / 2], [x + w, y + h / 2]]);
    }
    if (door) { pen([[104, 250], [104, 172], [152, 172], [152, 250]]); g.beginPath(); g.arc(142, 214, 3, 0, 7); g.stroke(); }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
// A cardboard box: marker drawings go on the walls (or just front and back, for a thin box), never on the top.
function cardBox(m, opts, w, h, d, cols, rows, door, thin) {
  m.userData.card = [cols, rows, door];
  m.map = cardTexture(cols, rows, door, opts.drawn);
  const plain = lambert(m.color); plain.map = cardTexture(cols, rows, door, false);
  m.userData.twin = plain;   // takes the same colour
  return part(new THREE.BoxGeometry(w, h, d), thin ? [plain, plain, plain, plain, m, m] : [m, m, plain, plain, m, m], 0, h / 2, 0);
}
const tape = lambert('#efe2c4');

// Put the coaster cars where they are along the track, nose first.
function rideTo(ride) {
  for (const { car, back } of ride.cars) {
    const t = ((ride.t - back) % 1 + 1) % 1, q = ride.curve.getPointAt(t), d = ride.curve.getTangentAt(t);
    car.position.copy(q);
    car.rotation.set(-Math.asin(Math.max(-1, Math.min(1, d.y))), Math.atan2(d.x, d.z), 0, 'YXZ');
  }
}
// The toy box is sorted into four drawers.
const DRAWERS = { Blocks: ['block', 'brick', 'tube', 'cone', 'ball', 'arch', 'ramp', 'letter'], Town: ['box', 'house', 'car', 'truck', 'bus', 'tree', 'pine', 'person'], Cardboard: ['carton', 'cereal', 'shoebox', 'roll'], Fair: ['ferris', 'carousel', 'coaster', 'tent', 'balloons'], Traps: ['jam', 'tramp', 'jar'] };
// Kid herd mode: what is in the box at the start, and what a round can win you.
const START_BOX = { block: 6, brick: 4, arch: 1, cone: 2, carton: 3, cereal: 1, shoebox: 2, house: 2, box: 1, tree: 3, pine: 2, car: 2, person: 2 };
// What a toy costs once your box has run out of it. Coins are won in battles.
const PRICE = { block: 1, brick: 1, tube: 1, cone: 1, ball: 2, arch: 2, ramp: 2, letter: 1, tree: 2, pine: 2, person: 2, car: 3, truck: 4, bus: 4, house: 5, box: 7, carton: 3, cereal: 3, shoebox: 3, roll: 1, jam: 6, tramp: 8, jar: 8, balloons: 4, tent: 8, carousel: 12, ferris: 16, coaster: 18 };
// The town grows up as more people live in it, and each step makes you stronger in battle.
const LEVELS = [{ name: 'Hamlet', at: 0 }, { name: 'Village', at: 16, gives: 'traps, and a fourth kick' }, { name: 'Town', at: 30, gives: 'the fair, and the big carpet' }, { name: 'City', at: 48, gives: 'a fifth kick, and the huge carpet' }, { name: 'Metropolis', at: 70, gives: 'a sixth kick' }];
const DRAWER_LEVEL = { Traps: 1, Fair: 2 }, SIZE_LEVEL = { big: 2, huge: 3 };
const PRIZES = { common: ['block', 'brick', 'carton', 'cereal', 'shoebox', 'tree', 'pine', 'car', 'person', 'cone', 'tube', 'arch', 'roll'], good: ['house', 'box', 'truck', 'bus', 'tent', 'balloons', 'carousel'], traps: ['jam', 'tramp', 'jar'] };
// A dice you can seed, so the first town is always the same one.
const dice = (seed) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

const TRAPS = ['jam', 'tramp', 'jar'];
const TILT = 0.32;
const GREEN = ['tree', 'pine'], FUN = ['ferris', 'carousel', 'coaster', 'tent', 'balloons'];

const TOYS = {
  block: { label: 'Block', colour: '#ff3fa9', make: (m) => [part(new THREE.BoxGeometry(1, 1, 1), m, 0, 0.5, 0)] },
  brick: { label: 'Brick', colour: '#3d7bff', make: (m) => [part(new THREE.BoxGeometry(2, 0.6, 1), m, 0, 0.3, 0)] },
  box: { label: 'Box building', colour: '#ff9a3d', make: (m) => { m.map = windowTexture(); return [part(new THREE.BoxGeometry(1.6, 2.4, 1.6), m, 0, 1.2, 0)]; } },
  tube: { label: 'Tube', colour: '#ffd23f', make: (m) => [part(new THREE.CylinderGeometry(0.5, 0.5, 1.2, 28), m, 0, 0.6, 0)] },
  cone: { label: 'Cone', colour: '#ff5a4f', make: (m) => [part(new THREE.ConeGeometry(0.55, 1.2, 28), m, 0, 0.6, 0)] },
  ball: { label: 'Ball', colour: '#3ecf8e', make: (m) => [part(new THREE.SphereGeometry(0.5, 28, 18), m, 0, 0.5, 0)] },
  arch: { label: 'Arch', colour: '#3d7bff', make: (m) => [part(new THREE.BoxGeometry(0.4, 1.3, 0.8), m, -0.8, 0.65, 0), part(new THREE.BoxGeometry(0.4, 1.3, 0.8), m, 0.8, 0.65, 0), part(new THREE.BoxGeometry(2, 0.4, 0.8), m, 0, 1.5, 0)] },
  ramp: { label: 'Ramp', colour: '#ffd23f', make: (m) => {
    const s = new THREE.Shape(); s.moveTo(-1, 0); s.lineTo(1, 0); s.lineTo(1, 0.8); s.closePath();
    const geo = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false }); geo.translate(0, 0, -0.5);
    return [part(geo, m)];
  } },
  car: { label: 'Car', colour: '#ff3fa9', make: (m, g) => { wheels(g, [-0.5, 0.5], 0.42); return [part(new THREE.BoxGeometry(1.6, 0.36, 0.8), m, 0, 0.38, 0), part(new THREE.BoxGeometry(0.8, 0.34, 0.7), m, -0.05, 0.72, 0), part(new THREE.BoxGeometry(0.82, 0.2, 0.62), glass, -0.05, 0.74, 0)]; } },
  truck: { label: 'Truck', colour: '#3d7bff', make: (m, g) => { wheels(g, [-0.7, 0.1, 0.75], 0.46, 0.22); return [part(new THREE.BoxGeometry(0.6, 0.8, 0.86), m, 0.8, 0.62, 0), part(new THREE.BoxGeometry(0.3, 0.3, 0.7), glass, 0.98, 0.78, 0), part(new THREE.BoxGeometry(1.5, 0.95, 0.9), lambert('#f6f3ff'), -0.3, 0.7, 0)]; } },
  bus: { label: 'Bus', colour: '#ffd23f', make: (m, g) => { wheels(g, [-0.8, 0.8], 0.44, 0.22); return [part(new THREE.BoxGeometry(2.4, 0.95, 0.86), m, 0, 0.7, 0), part(new THREE.BoxGeometry(2.1, 0.3, 0.88), glass, 0, 0.86, 0)]; } },
  tree: { label: 'Tree', colour: '#3ecf8e', make: (m) => [part(new THREE.CylinderGeometry(0.12, 0.16, 0.7, 12), trunk, 0, 0.35, 0), part(new THREE.SphereGeometry(0.62, 22, 14), m, 0, 1.15, 0)] },
  pine: { label: 'Pine', colour: '#3ecf8e', make: (m) => [part(new THREE.CylinderGeometry(0.1, 0.14, 0.5, 12), trunk, 0, 0.25, 0), part(new THREE.ConeGeometry(0.6, 1.5, 20), m, 0, 1.2, 0)] },
  house: { label: 'House', colour: '#f6f3ff', make: (m) => { const r = part(new THREE.ConeGeometry(1.15, 0.8, 4), roof, 0, 1.5, 0); r.rotation.y = Math.PI / 4; return [part(new THREE.BoxGeometry(1.5, 1.1, 1.5), m, 0, 0.55, 0), r, part(new THREE.BoxGeometry(0.32, 0.56, 0.06), lambert('#24222e'), 0, 0.28, 0.76)]; } },
  person: { label: 'Person', colour: '#3d7bff', make: (m) => [part(new THREE.CylinderGeometry(0.2, 0.3, 0.8, 20), m, 0, 0.4, 0), part(new THREE.SphereGeometry(0.24, 20, 14), skin, 0, 1.02, 0)] },
  carton: { label: 'Packing box', colour: CARD, make: (m, g, opts) => [cardBox(m, opts, 2, 1.6, 1.6, 2, 1, true), part(new THREE.BoxGeometry(2.02, 0.02, 0.24), tape, 0, 1.6, 0)] },
  cereal: { label: 'Cereal box', colour: CARD, make: (m, g, opts) => [cardBox(m, opts, 1.4, 2.2, 0.55, 2, 3, true, true)] },
  shoebox: { label: 'Shoe box', colour: CARD, make: (m, g, opts) => { const b = cardBox(m, opts, 2.2, 0.75, 1.2, 3, 1, false); return [b, part(new THREE.BoxGeometry(2.3, 0.2, 1.3), m.userData.twin, 0, 0.8, 0)]; } },
  roll: { label: 'Paper roll', colour: CARD, make: (m) => [part(new THREE.CylinderGeometry(0.34, 0.34, 1.7, 24), m, 0, 0.85, 0), part(new THREE.CylinderGeometry(0.27, 0.27, 0.02, 20), lambert('#5a4326'), 0, 1.7, 0)] },
  // The fair. When things are set moving, the wheel turns, the carousel spins and the coaster cars run their track.
  ferris: { label: 'Big wheel', colour: '#ff3fa9', make: (m) => {
    const R = 2, hubY = 2.5, white = lambert('#f6f3ff'), out = [], spin = [];
    for (const side of [-1, 1]) for (const lean of [-1, 1]) { const leg = part(new THREE.CylinderGeometry(0.07, 0.09, 2.78, 8), white, lean * 0.6, hubY / 2, side * 0.45); leg.rotation.z = lean * 0.447; out.push(leg); }
    const wheel = new THREE.Group(); wheel.position.set(0, hubY, 0);
    for (const side of [-1, 1]) {
      wheel.add(part(new THREE.TorusGeometry(R, 0.06, 8, 48), m, 0, 0, side * 0.3));
      for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, sp = part(new THREE.CylinderGeometry(0.025, 0.025, R, 6), white, Math.cos(a) * R / 2, Math.sin(a) * R / 2, side * 0.3); sp.rotation.z = a - Math.PI / 2; wheel.add(sp); }
    }
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4, hang = new THREE.Group(); hang.position.set(Math.cos(a) * R, Math.sin(a) * R, 0);
      hang.add(part(new THREE.BoxGeometry(0.44, 0.36, 0.46), lambert(COLOURS[i % 6]), 0, -0.3, 0), part(new THREE.CylinderGeometry(0.03, 0.03, 0.62, 6), white).rotateX(Math.PI / 2));
      wheel.add(hang); spin.push({ o: hang, a: 'z', v: -0.45 });   // the seats stay level
    }
    spin.push({ o: wheel, a: 'z', v: 0.45 });
    m.userData.spin = spin;
    return [...out, wheel, part(new THREE.CylinderGeometry(0.14, 0.14, 1.05, 12), white, 0, hubY, 0).rotateX(Math.PI / 2)];
  } },
  carousel: { label: 'Carousel', colour: '#ffd23f', make: (m) => {
    const white = lambert('#f6f3ff'), turn = new THREE.Group();
    turn.add(part(new THREE.CylinderGeometry(0.12, 0.12, 1.9, 10), white, 0, 1.1, 0), part(new THREE.ConeGeometry(1.75, 0.9, 12), m, 0, 2.4, 0), part(new THREE.CylinderGeometry(1.75, 1.75, 0.14, 28), white, 0, 1.9, 0), part(new THREE.CylinderGeometry(1.4, 1.4, 0.1, 28), lambert('#ff3fa9'), 0, 0.23, 0));
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3, h = new THREE.Group(), up = 0.75 + (i % 2) * 0.22, col = lambert(COLOURS[(i + 1) % 6]);
      h.position.set(Math.cos(a) * 1.05, 0, Math.sin(a) * 1.05); h.rotation.y = -a - Math.PI / 2;
      h.add(part(new THREE.CylinderGeometry(0.03, 0.03, 1.6, 6), white, 0, 1.05, 0), part(new THREE.BoxGeometry(0.5, 0.24, 0.18), col, 0, up, 0), part(new THREE.BoxGeometry(0.14, 0.26, 0.15), col, 0.24, up + 0.2, 0));
      turn.add(h);
    }
    m.userData.spin = [{ o: turn, a: 'y', v: 0.7 }];
    return [part(new THREE.CylinderGeometry(1.5, 1.5, 0.18, 28), white, 0, 0.09, 0), turn];
  } },
  coaster: { label: 'Roller coaster', colour: '#3d7bff', make: (m) => {
    const white = lambert('#f6f3ff'), out = [];
    const curve = new THREE.CatmullRomCurve3([[-2.3, 0.5, -1], [-0.8, 2.5, -1.15], [0.8, 0.9, -1.15], [2.2, 1.7, -0.85], [2.65, 1.1, 0.3], [1.7, 0.55, 1.05], [0, 1.4, 1.15], [-1.7, 0.5, 1.05], [-2.7, 0.4, 0.15]].map((q) => new THREE.Vector3(...q)), true);
    out.push(part(new THREE.TubeGeometry(curve, 160, 0.08, 6, true), m));
    for (let i = 0; i < 20; i++) { const q = curve.getPointAt(i / 20); out.push(part(new THREE.CylinderGeometry(0.035, 0.035, q.y, 6), white, q.x, q.y / 2, q.z)); }
    const cars = [0, 0.045, 0.09].map((back, i) => { const car = new THREE.Group(); car.add(part(new THREE.BoxGeometry(0.4, 0.26, 0.56), lambert(['#ffd23f', '#ff3fa9', '#3ecf8e'][i]), 0, 0.2, 0)); out.push(car); return { car, back }; });
    m.userData.ride = { curve, cars, t: 0.12, length: curve.getLength() };
    rideTo(m.userData.ride);
    return out;
  } },
  tent: { label: 'Circus tent', colour: '#ff5a4f', make: (m) => [part(new THREE.CylinderGeometry(1.5, 1.5, 1.1, 20), lambert('#f6f3ff'), 0, 0.55, 0), part(new THREE.ConeGeometry(1.8, 1.4, 20), m, 0, 1.8, 0), part(new THREE.BoxGeometry(0.5, 0.75, 0.08), lambert('#24222e'), 0, 0.38, 1.47), part(new THREE.CylinderGeometry(0.025, 0.025, 0.6, 6), lambert('#f6f3ff'), 0, 2.75, 0), part(new THREE.BoxGeometry(0.4, 0.22, 0.03), lambert('#ffd23f'), 0.2, 2.92, 0)] },
  balloons: { label: 'Balloons', colour: '#ff3fa9', make: (m) => {
    const out = [part(new THREE.BoxGeometry(0.36, 0.2, 0.36), lambert('#24222e'), 0, 0.1, 0)];
    [[m, -0.32, 1.75, 0.1], [lambert('#ffd23f'), 0.3, 1.95, -0.12], [lambert('#3d7bff'), 0.02, 2.25, 0.16]].forEach(([mat, x, y, z]) => {
      const len = Math.hypot(x, y - 0.5, z), str = part(new THREE.CylinderGeometry(0.012, 0.012, len, 5), lambert('#f6f3ff'), x / 2, (y - 0.3) / 2 + 0.1, z / 2);
      str.rotation.set(Math.atan2(z, y), 0, -Math.atan2(x, y));
      const b = part(new THREE.SphereGeometry(0.34, 18, 14), mat, x, y, z); b.scale.y = 1.15;
      out.push(str, b);
    });
    return out;
  } },
  // Traps. They only do something to kids: jam slows them down, a trampoline throws them off, a cookie jar is all they can think about.
  jam: { label: 'Jam puddle', colour: '#ff5a4f', make: (m) => { const blob = part(new THREE.CylinderGeometry(1.5, 1.6, 0.07, 28), m, 0, 0.035, 0); blob.castShadow = false; const shine = part(new THREE.CylinderGeometry(0.5, 0.5, 0.02, 18), lambert('#ffd0ea'), -0.5, 0.075, -0.4); shine.castShadow = false; shine.scale.z = 0.5; return [blob, shine]; } },
  tramp: { label: 'Trampoline', colour: '#3d7bff', make: (m) => { const out = [part(new THREE.TorusGeometry(1.05, 0.11, 8, 28), m, 0, 0.5, 0).rotateX(Math.PI / 2), part(new THREE.CylinderGeometry(1, 1, 0.04, 28), lambert('#24222e'), 0, 0.5, 0)]; for (let i = 0; i < 4; i++) out.push(part(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 6), lambert('#f6f3ff'), Math.cos(i * 1.57 + 0.78) * 0.95, 0.25, Math.sin(i * 1.57 + 0.78) * 0.95)); return out; } },
  jar: { label: 'Cookie jar', colour: '#ffd23f', make: (m) => { const out = [part(new THREE.CylinderGeometry(0.5, 0.45, 0.9, 20), glass, 0, 0.45, 0), part(new THREE.CylinderGeometry(0.54, 0.54, 0.14, 20), m, 0, 0.97, 0), part(new THREE.SphereGeometry(0.13, 10, 8), m, 0, 1.1, 0)]; for (const [x, y, z] of [[0.1, 0.25, 0.48], [-0.2, 0.5, 0.44], [0.25, 0.62, 0.42]]) out.push(part(new THREE.CylinderGeometry(0.15, 0.15, 0.05, 10), lambert('#a86b3c'), x, y, z).rotateX(Math.PI / 2)); return out; } },
  letter: { label: 'Letter', colour: '#ffd23f', make: (m, g, opts) => { m.map = letterTexture(opts.letter || 'A'); return [part(new THREE.BoxGeometry(0.9, 0.9, 0.9), m, 0, 0.45, 0)]; } },
};

function makeToy(kind, opts = {}) {
  const def = TOYS[kind];
  if (!def) return null;
  const g = new THREE.Group();
  const paint = lambert(opts.color || def.colour);
  g.add(...def.make(paint, g, opts));
  g.userData = { kind, paint, broken: !!opts.b, drawn: !!opts.drawn, letter: opts.letter || (kind === 'letter' ? 'A' : undefined) };
  g.position.set(opts.x || 0, opts.y || 0, opts.z || 0);
  g.rotation.y = opts.r || 0;
  g.rotation.z = opts.b ? TILT : 0;   // a broken toy leans
  g.scale.setScalar(opts.s || 1);
  return g;
}

// ---------- The playground itself ----------

let open = null;

export function playgroundOpen() { return !!open; }

export function openPlayground({ boardId, addImage, toast, standalone = false }) {
  if (open) return;
  const el = document.createElement('div');
  el.id = 'playground';
  el.innerHTML = `
    <div class="pg-top">
      <strong>Playground</strong>
      <span class="pg-mode"><button data-m="herd" title="The game: grow a toy city, and defend it when the kids come">City</button><button data-m="free" title="No rules: build anything, with every toy">Free<i> play</i></button></span>
      <span class="pg-hint">Pick a toy. Drag toys to move them (they stack). Drag the floor to look around.</span>
      <span class="pg-space"></span>
      <button data-a="lock" title="Lock the toys in place, so you can look around freely (L)">Lock toys</button>
      <select data-a="kids" title="How many kids"><option value="3">A few kids</option><option value="6" selected>A class of kids</option><option value="10">Far too many kids</option></select>
      <span class="pg-round" hidden></span>
      <button data-a="release" class="primary">Release the kids!</button>
      <button data-a="rebuild" title="Put everything back the way you built it" hidden>Rebuild</button>
      <i class="pg-div"></i>
      <button data-a="go" title="Set the town moving: cars drive, people stroll, the fair turns">Go!</button>
      <button data-a="walk" title="Walk around inside your town">Walk</button>
      <button data-a="more" title="Carpet, random town, clear">More</button>
      <button data-a="close" title="Close (Esc)">✕</button>
    </div>
    <div class="pg-more" hidden>
      <select data-a="carpet" title="The carpet"><option value="town">Town carpet</option><option value="grid">Checker carpet</option><option value="plain">Plain carpet</option></select>
      <select data-a="size" title="How big the carpet is"><option value="small">Small carpet</option><option value="medium">Medium carpet</option><option value="big">Big carpet</option><option value="huge">Huge carpet</option></select>
      <button data-a="top">From above</button>
      <button data-a="random" title="Build a whole random town">Random town</button>
      <button data-a="clear">Clear</button>
      <button data-a="heart" title="Buy back a lost heart">Buy a heart · 15c</button>
      <button data-a="restart" title="Begin the city again from round 1">Start over</button>
      <button data-a="shot">${addImage ? 'Put on board' : 'Save picture'}</button>
    </div>
    <div class="pg-sel" hidden>
      <span class="pg-colours"></span>
      <button data-s="left" title="Turn left (Q)">⟲</button><button data-s="right" title="Turn right (E)">⟳</button>
      <button data-s="smaller" title="Smaller ([)">−</button><button data-s="bigger" title="Bigger (])">+</button>
      <span class="pg-info" hidden></span><button data-s="repair" title="Mend it" hidden>Repair</button><button data-s="fav" title="Your favourite toy: the one the kids must not knock over">Favourite</button><button data-s="draw" title="Draw windows and a door on it with a marker" hidden>Draw windows</button><button data-s="copy" title="Another one (Ctrl/⌘ + D)">Copy</button><button data-s="delete" title="Put it away (Delete)">Remove</button>
    </div>
    <div class="pg-box"></div>
    <div class="pg-census" hidden></div>
    <button class="pg-repair" hidden></button>
    <div class="pg-clock" hidden></div>
    <div class="pg-kick" hidden></div>
    <div class="pg-powers" hidden>
      <button data-p="freeze" title="Statues! Every kid freezes for a few seconds. Once per round.">Freeze!</button>
      <button class="pg-shoo" title="Blast the kids off the carpet. The toys feel nothing. Once per round. (Space)">Boom!</button>
      <button data-p="lure" title="Drop an ice cream on the carpet: the kids forget your toys and go for it. Once per round.">Ice cream</button>
    </div>
    <div class="pg-walk" hidden>
      <i class="pg-stick" data-stick="L"><b></b></i><i class="pg-stick" data-stick="R"><b></b></i>
    </div>
    <div class="pg-walkbar" hidden><button data-w="exit" title="Back to building (Esc)">Build</button><button data-w="view" title="See yourself from behind, or through your own eyes (V)">View</button><button data-w="ride" hidden>Ride</button><button data-w="release" class="primary">Release the kids!</button></div>
    <button class="pg-foot" title="Kick whoever is in front of you. Nobody there? Punt the nearest toy. (F)" hidden>Kick</button>
    <div class="pg-result" hidden></div>`;
  document.body.appendChild(el);

  const dark = document.body.dataset.tone !== 'light';
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  el.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(dark ? '#16151c' : '#f3f1f4');
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 500);
  // Where the camera starts: far enough back to see the whole carpet, further on a tall, narrow screen.
  const fit = () => Math.max(1, Math.min(3.4, 1.5 / camera.aspect));
  const big = () => Math.max(MAT_W / 30, MAT_D / 20);   // how much bigger than the medium carpet
  const homeView = () => new THREE.Vector3(0, 21, 27).multiplyScalar(fit() * big());
  const topView = () => new THREE.Vector3(0, 40 * fit() * big(), 0.01);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0.5);
  controls.maxPolarAngle = Math.PI / 2 - 0.08;
  controls.minDistance = 2.5; controls.maxDistance = 130;   // from down in the street to the whole room
  controls.screenSpacePanning = false;   // panning slides over the floor
  controls.zoomToCursor = true;
  controls.enableDamping = true; controls.dampingFactor = 0.12;

  scene.add(new THREE.HemisphereLight('#ffffff', dark ? '#3a3560' : '#c9c2dd', 1.5));
  const sun = new THREE.DirectionalLight('#fff4e6', 2.1);
  sun.position.set(11, 22, 9);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.radius = 2;
  Object.assign(sun.shadow.camera, { left: -24, right: 24, top: 20, bottom: -20, near: 1, far: 70 });
  sun.shadow.bias = -0.0005;
  scene.add(sun);

  // The room's floor (so there's somewhere beyond the carpet), and the carpet on it.
  const room = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshLambertMaterial({ color: dark ? '#221f2d' : '#e6e1ec' }));
  room.rotation.x = -Math.PI / 2; room.position.y = -0.06; room.receiveShadow = true;
  scene.add(room);
  const carpetMat = new THREE.MeshLambertMaterial({ color: '#ffffff' });
  const carpet = new THREE.Mesh(new THREE.BoxGeometry(MAT_W, 0.06, MAT_D), [lambert('#2f9f73'), lambert('#2f9f73'), carpetMat, lambert('#2f9f73'), lambert('#2f9f73'), lambert('#2f9f73')]);
  carpet.position.y = -0.03; carpet.receiveShadow = true;
  scene.add(carpet);

  const toys = [];
  let selected = null, drag = null, needs = true, raf = 0, nextLetter = 0, locked = false;
  const state = { carpet: 'town', size: 'medium' };
  let mode = 'free', herd = null, fav = null;   // herd: { round, box: { kind: how many }, streak, best }
  const star = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.5, 4), new THREE.MeshBasicMaterial({ color: '#ff3fa9' }));   // hovers over your favourite
  star.rotation.x = Math.PI; star.scale.setScalar(1.5); star.visible = false;
  scene.add(star);
  const cross = new THREE.Group(), crosses = [];
  for (const a of [0.785, -0.785]) { const bar = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.16, 0.04), new THREE.MeshBasicMaterial({ color: '#ff5a4f', depthTest: false })); bar.rotation.z = a; bar.renderOrder = 6; cross.add(bar); }
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.02, 48), new THREE.MeshBasicMaterial({ color: '#ff3fa9', transparent: true, opacity: 0.95, depthTest: false }));
  ring.rotation.x = -Math.PI / 2; ring.visible = false; ring.renderOrder = 5;
  scene.add(ring);

  const setCarpet = (style) => { state.carpet = style; carpetMat.map?.dispose(); carpetMat.map = carpetTexture(style, MAT_W, MAT_D); carpetMat.needsUpdate = true; needs = true; };
  // A bigger or smaller carpet: the cloth, its picture, the light and how far the camera may go all follow.
  const setSize = (key) => {
    if (!SIZES[key]) key = 'medium';
    state.size = key;
    [MAT_W, MAT_D] = SIZES[key];
    carpet.geometry.dispose();
    carpet.geometry = new THREE.BoxGeometry(MAT_W, 0.06, MAT_D);
    const k = big();
    sun.position.set(11 * k, 22 * k, 9 * k);
    Object.assign(sun.shadow.camera, { left: -24 * k, right: 24 * k, top: 20 * k, bottom: -20 * k, near: 1, far: 70 * k });
    sun.shadow.camera.updateProjectionMatrix();
    controls.maxDistance = 130 * k;
    setCarpet(state.carpet);
  };

  // --- saving
  const save = () => {
    const at = (t) => t.userData.mv?.home ?? { p: t.position, r: t.rotation.y };   // a toy that is driving about is saved where it started
    const data = { v: 2, carpet: state.carpet, size: state.size, toys: toys.map((t) => ({ kind: t.userData.kind, x: +at(t).p.x.toFixed(3), y: +at(t).p.y.toFixed(3), z: +at(t).p.z.toFixed(3), r: +at(t).r.toFixed(3), s: +t.scale.x.toFixed(3), color: `#${t.userData.paint.color.getHexString()}`, ...(t.userData.letter ? { letter: t.userData.letter } : {}), ...(t.userData.drawn ? { drawn: 1 } : {}), ...(t.userData.broken ? { b: 1 } : {}) })) };
    if (mode === 'herd') Object.assign(data, { herd, fav: toys.indexOf(fav) });
    try { localStorage.setItem(KEY(boardId, mode), JSON.stringify(data)); localStorage.setItem(`playground.mode.${boardId}`, mode); } catch {}
  };

  // --- toys
  // Measured from the real shape (precise), so a turned roof does not make the toy seem wider than it is.
  // Remembered until the toy moves, turns or changes size: measuring a wheel or a track is slow.
  const boxOf = (t) => {
    const key = `${t.position.x},${t.position.y},${t.position.z},${t.quaternion.x},${t.quaternion.y},${t.quaternion.z},${t.scale.x},${t.scale.y}`;
    if (t.userData.boxKey !== key) { t.userData.boxKey = key; t.userData.box = new THREE.Box3().setFromObject(t, true); }
    return t.userData.box.clone();
  };
  // Where a toy rests at this spot: on the carpet, or on top of whatever is under it.
  const restingHeight = (toy, x, z) => {
    if (toy.userData.kind === 'jam') return 0;   // jam is spilt on the floor, never on a roof
    let y = 0;
    for (const o of toys) {
      if (o === toy) continue;
      const b = boxOf(o);
      if (x > b.min.x - 0.05 && x < b.max.x + 0.05 && z > b.min.z - 0.05 && z < b.max.z + 0.05) y = Math.max(y, b.max.y);
    }
    return y;
  };
  const select = (toy) => {
    selected = toy;
    ring.visible = !!toy;
    el.querySelector('.pg-sel').hidden = !toy;
    const favBtn = el.querySelector('[data-s="fav"]');
    favBtn.hidden = mode !== 'herd' || TRAPS.includes(toy?.userData.kind);
    favBtn.classList.toggle('on', !!toy && toy === fav);
    showInfo();
    const drawBtn = el.querySelector('[data-s="draw"]');
    drawBtn.hidden = !toy?.userData.paint.userData.card;
    drawBtn.textContent = toy?.userData.drawn ? 'Rub out' : 'Draw windows';
    placeRing();
    needs = true;
  };
  const placeRing = () => {
    if (!selected) return;
    const b = boxOf(selected), r = Math.max(b.max.x - b.min.x, b.max.z - b.min.z) * 0.62 + 0.15;
    ring.position.set(selected.position.x, selected.position.y + 0.03, selected.position.z);
    ring.scale.setScalar(r);
  };
  // A toy lands with a little bounce.
  const plop = (toy) => {
    const s = toy.scale.x, t0 = performance.now();
    const step = () => {
      const t = Math.min(1, (performance.now() - t0) / 380);
      const k = 1 + Math.sin(t * Math.PI * 2.2) * 0.16 * (1 - t);
      toy.scale.set(s * (2 - k), s * k * (0.55 + 0.45 * Math.min(1, t * 2.4)), s * (2 - k));
      needs = true;
      if (t < 1) requestAnimationFrame(step); else { toy.scale.setScalar(s); placeRing(); }
    };
    step();
  };
  const addToy = (kind, opts = {}, { quiet = false } = {}) => {
    if (kind === 'letter' && !opts.letter) opts.letter = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[nextLetter++ % 26];
    const toy = makeToy(kind, opts);
    if (!toy) return null;
    if (opts.x === undefined) {
      // Somewhere near what you're looking at, not on top of the last one.
      const a = toys.length * 2.4, r = 1.4 + (toys.length % 6) * 0.9;
      toy.position.set(controls.target.x + Math.cos(a) * r, 0, controls.target.z + Math.sin(a) * r);
      toy.position.y = restingHeight(toy, toy.position.x, toy.position.z);
    }
    scene.add(toy);
    toys.push(toy);
    if (!quiet) { select(toy); plop(toy); save(); }
    return toy;
  };
  const removeToy = (toy) => {
    if (mode === 'herd') { if (!toy.userData.broken) herd.box[toy.userData.kind] = (herd.box[toy.userData.kind] || 0) + 1; if (toy === fav) fav = null; showBox(); }   // back in the box, unless it was broken: then it is thrown away
    scene.remove(toy);
    toys.splice(toys.indexOf(toy), 1);
    if (selected === toy) select(null);
    showCensus(); showRepair();
    needs = true;
    save();
  };

  // --- the toy box
  const box = el.querySelector('.pg-box');
  // Four drawers; only the open one shows its toys.
  const tabRow = box.appendChild(Object.assign(document.createElement('div'), { className: 'pg-tabs' })), toyRow = box.appendChild(Object.assign(document.createElement('div'), { className: 'pg-toys' }));
  const openDrawer = (name) => { toyRow.scrollLeft = 0; for (const b of box.querySelectorAll('button')) { if (b.dataset.drawer) b.hidden = b.dataset.drawer !== name; if (b.dataset.tab) b.classList.toggle('on', b.dataset.tab === name); } };
  for (const name of Object.keys(DRAWERS)) {
    const tab = document.createElement('button');
    tab.className = 'pg-tab'; tab.dataset.tab = name; tab.textContent = name;
    tab.addEventListener('click', () => {
      if (mode === 'herd' && (DRAWER_LEVEL[name] || 0) > herd.level) { const need = LEVELS[DRAWER_LEVEL[name]]; toast(`${name} opens when your town is a ${need.name}: ${need.at} residents.`); return; }
      drawer = name; showBox();
    });
    tabRow.appendChild(tab);
  }
  for (const [name, kinds] of Object.entries(DRAWERS)) for (const kind of kinds) {
    const def = TOYS[kind], b = document.createElement('button');
    b.dataset.drawer = name; b.dataset.kind = kind;
    b.innerHTML = `<i style="--c:${def.colour}" data-shape="${kind}"></i><span>${def.label}</span>`;
    // Pick a toy up and it stays in your hand: every tap on the carpet puts one down, until you tap the toy again.
    b.addEventListener('click', () => {
      hand = hand === kind ? null : kind;
      if (hand) { select(null); if (!taught) { taught = true; toast('Tap the carpet to put it down, as many as you like. Tap the toy again when you are done.'); } }
      showBox();
    });
    toyRow.appendChild(b);
  }
  // In kid herd mode the box holds only what you own, with how many of each.
  let drawer = 'Town', surprise = null, hand = null, taught = false, tap = null;
  const placeAt = (x, z) => {
    const kind = hand, def = TOYS[kind];
    if (mode === 'herd') {
      // From your box if you have one, otherwise bought with coins.
      if (herd.box[kind] > 0) herd.box[kind]--;
      else if (herd.coins >= PRICE[kind]) herd.coins -= PRICE[kind];
      else { toast(`A ${def.label.toLowerCase()} costs ${PRICE[kind]} coins. Win some in a battle.`); hand = null; showBox(); return; }
    }
    const toy = addToy(kind, { x, y: 0, z, r: 0 }, { quiet: true });
    toy.position.y = restingHeight(toy, x, z);
    plop(toy);
    if (HOMES[kind]) { const n = homeLife(toy).n; pop(new THREE.Vector3(x, toy.position.y + 2.4, z), `${n} ${n === 1 ? 'resident' : 'residents'}`); }
    showBox(); showCensus();
    if (mode === 'herd') { growTown(); showRound(); }
    needs = true;
    save();
  };
  const empty = toyRow.appendChild(Object.assign(document.createElement('span'), { className: 'pg-empty', textContent: 'Your box is empty. Release the kids!', hidden: true }));
  const showBox = () => {
    empty.hidden = true;
    surprise.hidden = mode === 'herd';
    if (mode === 'herd' && (DRAWER_LEVEL[drawer] || 0) > herd.level) drawer = 'Town';
    openDrawer(drawer);
    for (const b of tabRow.querySelectorAll('[data-tab]')) b.classList.toggle('locked', mode === 'herd' && (DRAWER_LEVEL[b.dataset.tab] || 0) > herd.level);
    for (const b of toyRow.querySelectorAll('button')) {
      const kind = b.dataset.kind, n = mode === 'herd' ? herd.box[kind] || 0 : 0;
      b.querySelector('span').textContent = mode !== 'herd' ? TOYS[kind].label : n ? `${TOYS[kind].label} × ${n}` : `${TOYS[kind].label} · ${PRICE[kind]}c`;
      b.classList.toggle('on', kind === hand);
      b.classList.toggle('buy', mode === 'herd' && !n);
      b.classList.toggle('poor', mode === 'herd' && !n && herd.coins < PRICE[kind]);
    }
  };
  // Surprise: a random toy, somewhere on the carpet.
  surprise = document.createElement('button');
  surprise.className = 'pg-surprise';
  surprise.textContent = 'Surprise!';
  surprise.title = 'A random toy, somewhere on the carpet';
  surprise.addEventListener('click', () => {
    const kinds = Object.keys(TOYS), kind = kinds[Math.floor(Math.random() * kinds.length)];
    const x = (Math.random() - 0.5) * (MAT_W - 4), z = (Math.random() - 0.5) * (MAT_D - 4);
    const toy = addToy(kind, { x, y: 0, z, r: Math.floor(Math.random() * 8) * Math.PI / 4, ...(TOYS[kind].colour === CARD ? { drawn: Math.random() < 0.5 } : { color: COLOURS[Math.floor(Math.random() * 6)] }) });
    toy.position.y = restingHeight(toy, x, z);
    placeRing(); save();
  });
  tabRow.prepend(surprise);
  const swatches = el.querySelector('.pg-colours');
  for (const c of COLOURS) {
    const b = document.createElement('button');
    b.className = 'pg-swatch';
    b.style.background = c;
    b.title = 'Colour';
    b.addEventListener('click', () => { if (selected) { selected.userData.paint.color.set(c); selected.userData.paint.userData.twin?.color.set(c); needs = true; save(); } });
    swatches.appendChild(b);
  }
  const act = {
    left: () => { selected.rotation.y += Math.PI / 4; },
    right: () => { selected.rotation.y -= Math.PI / 4; },
    smaller: () => { selected.scale.setScalar(Math.max(0.3, selected.scale.x / 1.2)); },
    bigger: () => { selected.scale.setScalar(Math.min(6, selected.scale.x * 1.2)); },
    repair: () => {
      const t = selected, cost = repairCost(t);
      if (herd.coins < cost) { toast(`Mending it costs ${cost} coins.`); return; }
      herd.coins -= cost; mend(t);
      showRound(); showBox(); showRepair(); showInfo(); growTown();
    },
    fav: () => { fav = fav === selected ? null : selected; el.querySelector('[data-s="fav"]').classList.toggle('on', fav === selected); },
    draw: () => {
      const u = selected.userData, m = u.paint;
      u.drawn = !u.drawn;
      m.map.dispose(); m.map = cardTexture(...m.userData.card, u.drawn); m.needsUpdate = true;
      el.querySelector('[data-s="draw"]').textContent = u.drawn ? 'Rub out' : 'Draw windows';
    },
    copy: () => { const t = selected; addToy(t.userData.kind, { drawn: t.userData.drawn, color: `#${t.userData.paint.color.getHexString()}`, r: t.rotation.y, s: t.scale.x, letter: t.userData.letter, x: t.position.x + 1.2, z: t.position.z + 0.6, y: 0 }); selected.position.y = restingHeight(selected, selected.position.x, selected.position.z); },
    delete: () => removeToy(selected),
  };
  const run = (name) => { if (!selected) return; if (mode === 'herd' && ['copy', 'smaller', 'bigger'].includes(name)) return; act[name](); placeRing(); needs = true; save(); };
  el.querySelectorAll('[data-s]').forEach((b) => b.addEventListener('click', () => run(b.dataset.s)));

  // --- moving toys with the mouse
  const ray = new THREE.Raycaster(), mouse = new THREE.Vector2(), floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3();
  const aim = (e) => {
    const r = renderer.domElement.getBoundingClientRect();
    mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(mouse, camera);
  };
  const toyAt = (e) => {
    aim(e);
    const found = ray.intersectObjects(toys, true)[0];
    let o = found?.object;
    while (o && !toys.includes(o)) o = o.parent;
    return o || null;
  };
  const cv = renderer.domElement;
  // Two fingers always mean "look around": a toy under a finger is let go and put back.
  const fingers = new Set();
  const letGo = () => { if (!drag) return; drag.toy.position.copy(drag.from); drag = null; controls.enabled = true; placeRing(); needs = true; };
  cv.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') fingers.add(e.pointerId); if (fingers.size > 1) letGo(); }, true);
  for (const t of ['pointerup', 'pointercancel']) cv.addEventListener(t, (e) => fingers.delete(e.pointerId), true);
  cv.addEventListener('pointerdown', (e) => { if (game && e.button === 0 && kick(e)) e.stopImmediatePropagation(); }, true);
  const onKickUp = (e) => kickUp(e);
  window.addEventListener('pointerup', onKickUp, true);
  cv.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || game || locked || fingers.size > 1) return;
    tap = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
    const toy = toyAt(e);
    select(hand ? null : toy);   // with a toy in your hand, a tap builds; it does not pick things
    if (!toy) return;
    // Slide it along the height it's standing at, keeping it under the mouse.
    floor.constant = -toy.position.y;
    ray.ray.intersectPlane(floor, hit);
    drag = { toy, from: toy.position.clone(), dx: toy.position.x - hit.x, dz: toy.position.z - hit.z };
    controls.enabled = false;
    cv.setPointerCapture(e.pointerId);
  });
  cv.addEventListener('pointermove', (e) => {
    if (!drag) { cv.style.cursor = !locked && toyAt(e) ? 'grab' : ''; return; }
    aim(e);
    floor.constant = 0;
    if (!ray.ray.intersectPlane(floor, hit)) return;
    const x = Math.max(-40, Math.min(40, hit.x + drag.dx)), z = Math.max(-40, Math.min(40, hit.z + drag.dz));
    drag.toy.position.set(x, restingHeight(drag.toy, x, z), z);
    cv.style.cursor = 'grabbing';
    placeRing();
    needs = true;
  });
  const drop = () => {
    if (!drag) return;
    const toy = drag.toy;
    drag = null;
    controls.enabled = true;
    if (toy.userData.mv) Object.assign(toy.userData.mv, { home: { p: toy.position.clone(), r: toy.rotation.y }, to: null, from: null, tx: null });
    // Where a thing stands matters to the people living around it.
    const before = population();
    showCensus(); showInfo(); growTown();
    const life = HOMES[toy.userData.kind] && !toy.userData.broken ? homeLife(toy) : null;
    if (life) pop(new THREE.Vector3(toy.position.x, toy.position.y + 2.4, toy.position.z), `${life.n} ${life.n === 1 ? 'resident' : 'residents'}`);
    else if (population() !== before) pop(new THREE.Vector3(toy.position.x, toy.position.y + 2.4, toy.position.z), population() > before ? `+${population() - before}` : `${population() - before}`);
    plop(toy);
    save();
  };
  cv.addEventListener('pointerup', (e) => {
    // A quick tap with a toy in your hand: put one down right there, on the carpet or on top of what is there.
    const t = tap;
    tap = null;
    if (!hand || !t || t.id !== e.pointerId || game || locked) return;
    if (Math.hypot(e.clientX - t.x, e.clientY - t.y) > 8 || performance.now() - t.t > 450) return;
    aim(e);
    const on = ray.intersectObjects(toys, true)[0];
    floor.constant = 0;
    if (on) placeAt(on.point.x, on.point.z);
    else if (ray.ray.intersectPlane(floor, hit)) placeAt(hit.x, hit.z);
  });
  cv.addEventListener('pointerup', drop);
  cv.addEventListener('pointercancel', drop);

  // --- keys (kept away from the board underneath)
  const onKey = (e) => {
    if (e.target.closest?.('select, input')) return;
    e.stopPropagation();
    if (walk) {
      if (e.key === 'Escape') exitWalk();
      else if (e.code === 'Space' && game) { e.preventDefault(); shoo(); }
      else if (e.code === 'KeyF' && game) footKick();
      else if (e.code === 'KeyV') setView();
      else if (e.code === 'KeyE' && !game) hop();
      else { walkKeys.add(e.code); if (e.key.startsWith('Arrow')) e.preventDefault(); }
      return;
    }
    const mod = e.metaKey || e.ctrlKey;
    if (e.code === 'Space' && game) { e.preventDefault(); shoo(); return; }
    if (e.key === 'Escape' && hand) { hand = null; showBox(); return; }
    if (e.key === 'Escape') { if (game) return; if (selected) select(null); else if (!standalone) close(); return; }
    if (e.code === 'KeyL' && !mod && selected?.userData.kind !== 'letter') { setLocked(!locked); return; }
    if (!selected || game) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); run('delete'); }
    else if (mod && e.code === 'KeyD') { e.preventDefault(); run('copy'); }
    else if (e.key === '[') run('smaller');
    else if (e.key === ']') run('bigger');
    else if (selected.userData.kind === 'letter' && !mod && /^[a-z0-9?!&]$/i.test(e.key)) {
      // A letter block shows whatever letter you type.
      selected.userData.letter = e.key.toUpperCase();
      selected.userData.paint.map?.dispose();
      selected.userData.paint.map = letterTexture(selected.userData.letter);
      selected.userData.paint.needsUpdate = true;
      needs = true; save();
    }
    else if (e.code === 'KeyQ') run('left');
    else if (e.code === 'KeyE') run('right');
    else if (e.key.startsWith('Arrow')) {
      e.preventDefault();
      selected.position.x += { ArrowLeft: -0.25, ArrowRight: 0.25 }[e.key] || 0;
      selected.position.z += { ArrowUp: -0.25, ArrowDown: 0.25 }[e.key] || 0;
      selected.position.y = restingHeight(selected, selected.position.x, selected.position.z);
      placeRing(); needs = true; save();
    }
  };
  window.addEventListener('keydown', onKey, true);
  const onKeyUp = (e) => walkKeys.delete(e.code);
  window.addEventListener('keyup', onKeyUp, true);
  window.addEventListener('blur', () => walkKeys.clear());

  // --- the buttons along the top
  el.querySelector('[data-a="carpet"]').addEventListener('change', (e) => { setCarpet(e.target.value); save(); });
  const more = el.querySelector('.pg-more'), moreBtn = el.querySelector('[data-a="more"]');
  const setMore = (on) => { more.hidden = !on; moreBtn.classList.toggle('on', on); };
  moreBtn.addEventListener('click', () => setMore(more.hidden));
  renderer.domElement.addEventListener('pointerdown', () => setMore(false), true);
  el.querySelector('[data-a="size"]').addEventListener('change', (e) => {
    stopMotion();
    setSize(e.target.value);
    if (mode === 'herd') showRound();
    camera.position.copy(homeView()); controls.target.set(0, 0, 0.5); controls.update();
    startMotion(true);
    save();
  });

  // ---------- Random town ----------
  // Reads the town plan: buildings on the plots, trees by the pond, cars on the roads, the fair on its pad.
  const buildTown = (rnd = Math.random) => {
    const plan = townPlan(MAT_W, MAT_D), ox = -MAT_W / 2, oz = -MAT_D / 2;
    const pick = (list) => list[Math.floor(rnd() * list.length)];
    const bright = () => pick(COLOURS.slice(0, 6));
    const put = (kind, x, z, o = {}) => (toys.length < 150 ? addToy(kind, { y: 0, r: 0, ...o, x: x + ox, z: z + oz }, { quiet: true }) : null);
    for (const p of plan.plots) for (const f of p.w > 6.6 ? [0.27, 0.73] : [0.5]) {
      const x = p.x + p.w * f, z = p.y + p.h / 2, roll = rnd();
      if (roll < 0.1) continue;
      if (roll < 0.32) put('house', x, z, { color: pick(['#f6f3ff', '#ffd23f', '#ff9a3d', '#3d7bff']) });
      else if (roll < 0.52) put('box', x, z, { color: bright() });
      else if (roll < 0.66) { put('carton', x, z, { drawn: true }); if (rnd() < 0.6) put('shoebox', x, z, { y: 1.62, drawn: true }); }
      else if (roll < 0.74) put('cereal', x, z, { drawn: true });
      else if (roll < 0.84) { put('block', x, z, { color: bright() }); put('block', x, z, { y: 1, color: bright() }); if (rnd() < 0.5) put('cone', x, z, { y: 2, color: bright() }); }
      else if (roll < 0.9 && !plan.fairs.length) put(pick(['carousel', 'tent']), x, z);
      else { put('tree', x - 0.5, z - 0.2); put('pine', x + 0.6, z + 0.3); }
      if (rnd() < 0.3) put('person', x + 0.2, p.y + p.h + 0.1, { color: bright() });
    }
    for (const p of plan.ponds) for (let i = 0; i < 3; i++) { const a = rnd() * 6.3; put(pick(['tree', 'pine', 'tree']), p.x + Math.cos(a) * (p.rx + 0.5), p.y + Math.sin(a) * (p.ry + 0.6)); }
    for (const p of plan.lots) for (let bx = p.x + 0.73; bx < p.x + p.w - 0.7; bx += 0.97 * PATTERN) if (rnd() < 0.4) put('car', bx, p.y + 0.9, { r: Math.PI / 2, color: bright() });
    for (const p of plan.pitches) { put('ball', p.x + p.w / 2, p.y + p.h / 2, { s: 0.5 }); put('person', p.x + p.w * 0.3, p.y + p.h * 0.4, { color: '#ff5a4f' }); put('person', p.x + p.w * 0.7, p.y + p.h * 0.6, { color: '#3d7bff' }); }
    for (const p of plan.fairs) {
      const sc = p.w < 6.4 ? 0.74 : 1;   // a smaller coaster on a smaller pad
      put('ferris', p.x + 0.9, p.y + p.h * 0.45, { r: Math.PI / 2 });
      put('carousel', p.x + p.w - 1.95, p.y + 1.95);
      put('coaster', p.x + p.w - 0.35 - 2.75 * sc, p.y + p.h - 0.3 - 1.25 * sc, { s: sc });
      put('balloons', p.x + 2.3, p.y + 0.8);
    }
    // Traffic: on the right-hand side of the road.
    const { xs, ys } = plan;
    for (const y of ys) for (let i = 0; i < xs.length - 1; i++) if (rnd() < 0.3) put(pick(['car', 'car', 'bus', 'truck']), (xs[i] + xs[i + 1]) / 2, y + 0.55, { color: bright() });
    for (const x of xs) for (let j = 0; j < ys.length - 1; j++) if (rnd() < 0.22) put(pick(['car', 'car', 'truck']), x - 0.55, (ys[j] + ys[j + 1]) / 2, { r: -Math.PI / 2, color: bright() });
    for (const [x, y] of plan.zebras) if (rnd() < 0.18) put('person', x, y, { color: bright() });
  };
  const randomBtn = el.querySelector('[data-a="random"]');
  let randomTimer = 0;
  const randomRest = () => { clearTimeout(randomTimer); randomBtn.textContent = 'Random town'; randomBtn.classList.remove('on'); };
  randomBtn.addEventListener('click', () => {
    // It replaces what you built, so it asks first, on the button itself.
    if (toys.length && !randomBtn.classList.contains('on')) { randomBtn.textContent = 'Replace this one?'; randomBtn.classList.add('on'); randomTimer = setTimeout(randomRest, 3000); return; }
    randomRest();
    stopMotion();
    for (const t of [...toys]) scene.remove(t);
    toys.length = 0;
    select(null);
    if (state.carpet !== 'town') { setCarpet('town'); el.querySelector('[data-a="carpet"]').value = 'town'; }
    buildTown();
    startMotion(true);
    setMore(false);
    needs = true;
    save();
  });

  // ---------- Go! ----------
  // A first try at a town that moves: vehicles follow the roads, people stroll near where you put them,
  // and the fair turns. Press Stop and everything goes back to where you placed it.
  let moving = false, moveLast = 0, net = null;
  const goBtn = el.querySelector('[data-a="go"]');
  const roadNet = () => {
    const { xs, ys } = townPlan(MAT_W, MAT_D), nodes = [];
    for (let j = 0; j < ys.length; j++) for (let i = 0; i < xs.length; i++) {
      const cornerX = i === 0 ? 0.96 : i === xs.length - 1 ? -0.96 : 0, cornerY = j === 0 ? 0.96 : j === ys.length - 1 ? -0.96 : 0, corner = cornerX && cornerY;   // the ring road cuts its corners
      const next = [];
      if (i > 0) next.push(j * xs.length + i - 1); if (i < xs.length - 1) next.push(j * xs.length + i + 1);
      if (j > 0) next.push((j - 1) * xs.length + i); if (j < ys.length - 1) next.push((j + 1) * xs.length + i);
      nodes.push({ x: xs[i] - MAT_W / 2 + (corner ? cornerX : 0), z: ys[j] - MAT_D / 2 + (corner ? cornerY : 0), next });
    }
    return nodes;
  };
  const DRIVES = { car: 3.4, truck: 2.6, bus: 2.4 };
  // The people who live here. Every home brings a few; they stroll about, visit each other, and pop indoors.
  const HOMES = { house: 2, box: 3, carton: 1, cereal: 1, shoebox: 1, tent: 2 };
  let folk = [], folkCheck = 0;
  const census = el.querySelector('.pg-census');
  let planKey = '', planNow = null;
  // What a home has within reach. Each of the three brings one more person to live there.
  const homeLife = (home) => {
    const x = home.position.x, z = home.position.z;
    let road = false, green = false, fun = false;
    if (state.carpet === 'town') {
      if (planKey !== state.size) { planKey = state.size; planNow = townPlan(MAT_W, MAT_D); }
      const px = x + MAT_W / 2, pz = z + MAT_D / 2;
      road = planNow.xs.some((v) => Math.abs(v - px) < 4.5) || planNow.ys.some((v) => Math.abs(v - pz) < 4.5);
      green = planNow.ponds.some((q) => Math.hypot(q.x - px, q.y - pz) < q.rx + 3.5);
      fun = planNow.pitches.some((q) => Math.hypot(q.x + q.w / 2 - px, q.y + q.h / 2 - pz) < 8);
    }
    for (const t of toys) {
      if (t === home || t.userData.broken) continue;
      const d = Math.hypot(t.position.x - x, t.position.z - z);
      if (d < 4.5 && GREEN.includes(t.userData.kind)) green = true;
      if (d < 9 && FUN.includes(t.userData.kind)) fun = true;
    }
    return { road, green, fun, n: HOMES[home.userData.kind] + road + green + fun };
  };
  const population = () => toys.reduce((n, t) => n + (HOMES[t.userData.kind] && !t.userData.broken ? homeLife(t).n : 0), 0);
  const showInfo = () => {
    const info = el.querySelector('.pg-info'), t = selected, repairBtn = el.querySelector('[data-s="repair"]');
    const broken = !!t?.userData.broken, home = t && HOMES[t.userData.kind] && !broken ? homeLife(t) : null, tick = (ok) => (ok ? '✓' : '✗');
    info.hidden = !home && !broken;
    info.textContent = broken ? 'Broken by the kids' : home ? `${home.n} ${home.n === 1 ? 'resident' : 'residents'} · road ${tick(home.road)} · green ${tick(home.green)} · fun ${tick(home.fun)}` : '';
    repairBtn.hidden = !broken || mode !== 'herd';
    if (broken) repairBtn.textContent = `Repair · ${repairCost(t)}c`;
  };
  // Broken toys lean, hold no one, and need mending.
  const repairCost = (t) => Math.max(1, Math.ceil(PRICE[t.userData.kind] / 2));
  const breakToy = (t) => { t.userData.broken = true; t.rotation.z = TILT; };
  const mend = (t) => { t.userData.broken = false; t.rotation.z = 0; needs = true; };
  const repairAll = el.querySelector('.pg-repair');
  const showRepair = () => {
    const broken = toys.filter((t) => t.userData.broken), cost = broken.reduce((n, t) => n + repairCost(t), 0);
    repairAll.hidden = mode !== 'herd' || !broken.length;
    repairAll.textContent = `Repair all ${broken.length} · ${cost}c`;
  };
  repairAll.addEventListener('click', () => {
    // As many as the coins allow, cheapest first.
    let left = 0;
    for (const t of toys.filter((q) => q.userData.broken).sort((a, b) => repairCost(a) - repairCost(b))) { if (herd.coins >= repairCost(t)) { herd.coins -= repairCost(t); mend(t); } else left++; }
    if (left) toast(`Not enough coins for the last ${left}. Win some more in a battle.`);
    showRound(); showBox(); showRepair(); showInfo(); growTown(); save();
  });
  // The little sign at the top left: who lives here, and in kid herd what the town is and what it is growing into.
  const showCensus = () => {
    const n = population(), people = n === 1 ? '1 resident' : `${n} residents`;
    census.hidden = !n && mode !== 'herd';
    if (mode !== 'herd') { census.textContent = people; return; }
    const next = LEVELS[herd.level + 1];
    census.textContent = `${LEVELS[herd.level].name} · ${people}${next ? ` · ${next.name} at ${next.at}` : ''}`;
  };
  // More people, a bigger place. A step up is kept even if homes are lost later.
  const growTown = () => {
    if (mode !== 'herd') return;
    const n = population();
    while (LEVELS[herd.level + 1] && n >= LEVELS[herd.level + 1].at) {
      herd.level++;
      const lv = LEVELS[herd.level];
      toast(`Your town is now a ${lv.name}! New: ${lv.gives}.`);
      pop(new THREE.Vector3(0, 5, 0), `${lv.name}!`);
    }
    showCensus();
  };
  const clearFolk = () => { for (const f of folk) scene.remove(f.mesh); folk = []; };
  const startMotion = (quiet = false) => {
    if (moving || game) return;
    if (state.carpet !== 'town' && !quiet) toast('Cars need the town carpet to find the roads. The rest still moves.');
    moving = true; moveLast = performance.now(); net = state.carpet === 'town' ? roadNet() : null;
    goBtn.textContent = 'Stop'; goBtn.classList.add('on');
  };
  const stopMotion = () => {
    if (!moving) return;
    moving = false;
    clearFolk();
    for (const t of toys) if (t.userData.mv) { t.position.copy(t.userData.mv.home.p); t.rotation.set(0, t.userData.mv.home.r, t.userData.broken ? TILT : 0); delete t.userData.mv; }
    goBtn.textContent = 'Go!'; goBtn.classList.remove('on');
    placeRing(); needs = true;
  };
  const motionStep = (now) => {
    const dt = Math.min(0.05, (now - moveLast) / 1000), time = now / 1000;
    moveLast = now;
    for (const t of toys) {
      const u = t.userData, kind = u.kind, m = u.paint.userData;
      if (m.spin) for (const q of m.spin) q.o.rotation[q.a] += q.v * dt;
      if (m.ride) { const r = m.ride, y = r.curve.getPointAt(r.t).y; r.t = (r.t + ((1.6 + (2.6 - y) * 1.5) * dt) / r.length) % 1; rideTo(r); }   // faster downhill
      if (t === drag?.toy) continue;
      if (u.broken || u.driven) continue;
      const drives = DRIVES[kind] && net, strolls = kind === 'person';
      if (!drives && !strolls) continue;
      if (!u.mv) { if (t.position.y > 0.05) continue; u.mv = { home: { p: t.position.clone(), r: t.rotation.y }, to: null, from: null, tx: null, wait: Math.random() * 2 }; }
      const mv = u.mv;
      if (drives) {
        if (mv.to === null) { let best = 1e9; net.forEach((nd, i) => { const d = Math.hypot(nd.x - t.position.x, nd.z - t.position.z); if (d < best) { best = d; mv.to = i; } }); mv.from = null; }
        const a = mv.from === null ? null : net[mv.from], b = net[mv.to];
        // Aim for the right-hand lane of the stretch being driven.
        let tx = b.x, tz = b.z;
        if (a) { const lx = b.x - a.x, lz = b.z - a.z, ll = Math.hypot(lx, lz) || 1; tx += (-lz / ll) * 0.55; tz += (lx / ll) * 0.55; }
        const dx = tx - t.position.x, dz = tz - t.position.z, d = Math.hypot(dx, dz), step = DRIVES[kind] * dt;
        if (d <= step + 0.02) {
          const choices = b.next.filter((i) => i !== mv.from);
          mv.from = mv.to; mv.to = (choices.length ? choices : b.next)[Math.floor(Math.random() * (choices.length || b.next.length))];
        } else {
          t.position.x += (dx / d) * step; t.position.z += (dz / d) * step;
          let turn = Math.atan2(-dz, dx) - t.rotation.y;
          turn = Math.atan2(Math.sin(turn), Math.cos(turn));
          t.rotation.y += turn * Math.min(1, dt * 7);
        }
      } else {
        if (mv.tx === null) { if ((mv.wait -= dt) > 0) continue; const a = Math.random() * 6.3, r = 0.6 + Math.random() * 2.2; mv.tx = mv.home.p.x + Math.cos(a) * r; mv.tz = mv.home.p.z + Math.sin(a) * r; }
        const dx = mv.tx - t.position.x, dz = mv.tz - t.position.z, d = Math.hypot(dx, dz), step = 0.9 * dt;
        if (d <= step) { mv.tx = null; mv.wait = 0.5 + Math.random() * 2.5; t.position.y = mv.home.p.y; t.rotation.z = 0; }
        else { t.position.x += (dx / d) * step; t.position.z += (dz / d) * step; t.position.y = mv.home.p.y + Math.abs(Math.sin(time * 9 + mv.home.p.x)) * 0.06; t.rotation.z = Math.sin(time * 9 + mv.home.p.x) * 0.08; }
      }
    }
    // Residents: the right number for the homes there are, each on its own little errand.
    if ((folkCheck -= dt) <= 0) {
      folkCheck = 1.5;
      const homes = toys.filter((t) => HOMES[t.userData.kind] && !t.userData.broken && t.position.y < 0.05), want = Math.min(30, population());   // no more than thirty walking about at once
      folk = folk.filter((f) => (toys.includes(f.home) && folk.indexOf(f) < want ? true : (scene.remove(f.mesh), false)));
      while (folk.length < want && homes.length) {
        const home = homes[Math.floor(Math.random() * homes.length)], mesh = makeToy('person', { color: COLOURS[Math.floor(Math.random() * 7)], s: 0.62 });
        mesh.position.set(home.position.x, 0, home.position.z); mesh.visible = false;
        scene.add(mesh);
        folk.push({ mesh, home, tx: null, tz: 0, wait: Math.random() * 3, inside: true, phase: Math.random() * 6 });
      }
      showCensus();
    }
    for (const f of folk) {
      if (f.tx === null) {
        if ((f.wait -= dt) > 0) continue;
        // Off to see a neighbour, or just a turn around the block.
        const visit = Math.random() < 0.55, other = toys[Math.floor(Math.random() * toys.length)];
        const to = visit && other && HOMES[other.userData.kind] ? other : null, a = Math.random() * 6.3, r = 1.5 + Math.random() * 4;
        f.tx = to ? to.position.x : f.home.position.x + Math.cos(a) * r; f.tz = to ? to.position.z : f.home.position.z + Math.sin(a) * r; f.indoors = !!to;
        if (f.inside) { f.inside = false; f.mesh.visible = true; }
      }
      const dx = f.tx - f.mesh.position.x, dz = f.tz - f.mesh.position.z, d = Math.hypot(dx, dz), step = 1.5 * dt;
      if (d <= step + 0.6 * (f.indoors ? 1 : 0)) { f.tx = null; f.wait = 1 + Math.random() * 4; f.mesh.position.y = 0; f.mesh.rotation.z = 0; if (f.indoors) { f.inside = true; f.mesh.visible = false; } }
      else { f.mesh.position.x += (dx / d) * step; f.mesh.position.z += (dz / d) * step; f.mesh.position.y = Math.abs(Math.sin(time * 10 + f.phase)) * 0.05; f.mesh.rotation.z = Math.sin(time * 10 + f.phase) * 0.09; }
    }
    if (selected) placeRing();
  };
  goBtn.addEventListener('click', () => (moving ? stopMotion() : startMotion()));
  const lockBtn = el.querySelector('[data-a="lock"]');
  const setLocked = (on) => {
    locked = on;
    lockBtn.classList.toggle('on', on);
    lockBtn.textContent = on ? 'Toys locked' : 'Lock toys';
    if (on) { select(null); toast('Toys are locked. Drag, pinch and zoom freely.'); }
  };
  lockBtn.addEventListener('click', () => setLocked(!locked));
  el.querySelector('[data-a="top"]').addEventListener('click', (e) => {
    const above = e.currentTarget.dataset.on !== '1';
    e.currentTarget.dataset.on = above ? '1' : '';
    e.currentTarget.textContent = above ? 'From the side' : 'From above';
    camera.position.copy(above ? topView() : homeView());
    controls.target.set(0, 0, above ? 0 : 0.5);
    controls.update();
    needs = true;
  });
  // Clear asks on the button itself: press once, it says "Sure?", press again within a few seconds.
  const clearBtn = el.querySelector('[data-a="clear"]');
  let clearTimer = 0;
  const clearRest = () => { clearTimeout(clearTimer); clearBtn.textContent = 'Clear'; clearBtn.classList.remove('on'); };
  clearBtn.addEventListener('click', () => {
    if (!toys.length) { toast('The carpet is already empty.'); return; }
    if (!clearBtn.classList.contains('on')) { clearBtn.textContent = 'Sure?'; clearBtn.classList.add('on'); clearTimer = setTimeout(clearRest, 3000); return; }
    clearRest();
    for (const t of [...toys]) scene.remove(t);
    toys.length = 0;
    select(null);
    needs = true;
    save();
  });
  el.querySelector('[data-a="shot"]').addEventListener('click', () => {
    const was = ring.visible;
    ring.visible = false;
    renderer.render(scene, camera);
    cv.toBlob(async (blob) => {
      ring.visible = was; needs = true;
      if (!blob) return;
      if (addImage) { await addImage(blob, 'Playground'); toast('A picture of the playground is on your board.'); return; }
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'Playground.png' });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }, 'image/png');
  });
  // ---------- Walk mode ----------
  // Down in the street, like a video game: the left thumb walks, the right thumb looks around.
  // With a keyboard: W A S D (or the arrows) to walk, drag the mouse to look.
  let walk = null;
  const walkKeys = new Set();
  const walkPad = el.querySelector('.pg-walk'), walkBar = el.querySelector('.pg-walkbar');
  const EYE = 1.05, STICK = 46;   // eye height of a peg person; how far a thumb stick travels, in pixels
  const sticks = {};
  for (const side of ['L', 'R']) sticks[side] = { el: walkPad.querySelector(`[data-stick="${side}"]`), id: null, ox: 0, oy: 0, x: 0, y: 0 };
  const drawStick = (st) => {
    st.el.classList.toggle('on', st.id !== null);
    st.el.style.left = st.id !== null ? `${st.ox}px` : ''; st.el.style.top = st.id !== null ? `${st.oy}px` : '';
    st.el.firstChild.style.transform = `translate(${st.x * STICK}px, ${st.y * STICK}px)`;
  };
  const enterWalk = () => {
    if (walk) return;
    select(null); setMore(false);
    const dir = camera.getWorldDirection(new THREE.Vector3());
    walk = { x: Math.max(-MAT_W / 2, Math.min(MAT_W / 2, controls.target.x)), z: Math.max(-MAT_D / 2, Math.min(MAT_D / 2, controls.target.z)), yaw: Math.atan2(-dir.x, -dir.z), pitch: 0, look: null, last: performance.now(), fresh: true, back: { p: camera.position.clone(), t: controls.target.clone(), fov: camera.fov } };
    Object.assign(walk, { third: true, ride: null, near: null, stun: 0, safe: 0, y: 0 });
    controls.enabled = false;
    camera.fov = 50; camera.updateProjectionMatrix();
    el.classList.add('pg-walking');
    walkPad.hidden = false; walkBar.hidden = false;
    toast(matchMedia('(pointer: coarse)').matches ? 'You are a toy now. Left thumb walks, right thumb looks around.' : 'You are a toy now. W A S D to walk, drag to look around, V to change the view.');
  };
  const exitWalk = () => {
    if (!walk) return;
    if (walk.ride) hop();
    const b = walk.back;
    walk = null; walkKeys.clear();
    self.visible = false; rideBtn.hidden = true;
    for (const st of Object.values(sticks)) { st.id = null; st.x = st.y = 0; drawStick(st); }
    camera.fov = b.fov; camera.updateProjectionMatrix();
    camera.position.copy(b.p); controls.target.copy(b.t);
    controls.enabled = true; controls.update();
    el.classList.remove('pg-walking');
    walkPad.hidden = true; walkBar.hidden = true;
    needs = true;
  };
  // Your toy self: a peg person with a crown, seen from behind unless you switch to its eyes.
  const self = makeToy('person', { color: '#ff3fa9' });
  self.add(part(new THREE.CylinderGeometry(0.2, 0.15, 0.16, 6), lambert('#ffd23f'), 0, 1.3, 0));
  self.visible = false;
  scene.add(self);
  const rideBtn = walkBar.querySelector('[data-w="ride"]'), SEATS = ['coaster', 'ferris', 'carousel'], tmpSeat = new THREE.Vector3();
  // Hop on what you are standing next to: drive a car, or take a seat on a ride. The same button hops off.
  const hop = () => {
    if (!walk || game) return;
    if (walk.ride) {
      const r = walk.ride;
      walk.ride = null;
      if (r.type === 'drive') { delete r.toy.userData.driven; save(); }
      walk.x += Math.cos(walk.yaw) * 2.2; walk.z -= Math.sin(walk.yaw) * 2.2; walk.y = 0;   // step out to the side
      walk.fresh = true;
      return;
    }
    const t = walk.near;
    if (!t) return;
    if (DRIVES[t.userData.kind]) {
      delete t.userData.mv; t.userData.driven = true;   // it is yours now, not part of the traffic
      walk.ride = { type: 'drive', toy: t };
      walk.x = t.position.x; walk.z = t.position.z;
    } else {
      const m = t.userData.paint.userData, kind = t.userData.kind;
      walk.ride = { type: 'seat', toy: t, obj: kind === 'coaster' ? m.ride.cars[0].car : kind === 'ferris' ? m.spin[0].o : m.spin[0].o.children[4] };
      if (!moving) startMotion(true);
    }
    walk.fresh = true;
  };
  rideBtn.addEventListener('click', hop);
  const setView = () => { if (!walk) return; walk.third = !walk.third; camera.fov = walk.third ? 50 : 62; camera.updateProjectionMatrix(); walk.fresh = true; };
  walkBar.querySelector('[data-w="view"]').addEventListener('click', setView);
  const walkStep = (now) => {
    const dt = Math.min(0.05, (now - walk.last) / 1000);
    walk.last = now;
    const k = (...codes) => (codes.some((c) => walkKeys.has(c)) ? 1 : 0);
    let mx = sticks.L.x + k('KeyD') - k('KeyA'), my = sticks.L.y + k('KeyS', 'ArrowDown') - k('KeyW', 'ArrowUp');
    const lx = sticks.R.x + k('ArrowRight') - k('ArrowLeft'), ly = sticks.R.y;
    const m = Math.hypot(mx, my);
    if (m > 1) { mx /= m; my /= m; }
    const stunned = !!game && walk.stun > game.t, ride = walk.ride, seat = ride?.type === 'seat';
    if (stunned || seat) { mx = 0; my = 0; }   // knocked flat, or sitting on a ride: your legs are not in charge
    if (!mx && !my) { walk.vx = 0; walk.vz = 0; }
    if (!mx && !my && !lx && !ly && !walk.fresh && !seat && !stunned) return false;
    walk.fresh = false;
    walk.yaw -= lx * 2.3 * dt;
    walk.pitch = Math.max(-1.2, Math.min(1.2, walk.pitch - ly * 1.5 * dt));
    const sin = Math.sin(walk.yaw), cos = Math.cos(walk.yaw), gx = sin * my + cos * mx, gz = cos * my - sin * mx;
    if (seat) { ride.obj.getWorldPosition(tmpSeat); walk.x = tmpSeat.x; walk.z = tmpSeat.z; walk.y = tmpSeat.y; }
    else if (game?.me) {
      // In a battle you are a small body among giants: you run faster, and you bump into things.
      const v = k('ShiftLeft', 'ShiftRight') ? 11 : 7.5;
      walk.vx = gx * v; walk.vz = gz * v; walk.y = 0;
    } else {
      const v = (ride ? 12 : k('ShiftLeft', 'ShiftRight') ? 10 : 5) * dt;
      walk.x = Math.max(-MAT_W / 2 - 12, Math.min(MAT_W / 2 + 12, walk.x + gx * v));
      walk.z = Math.max(-MAT_D / 2 - 12, Math.min(MAT_D / 2 + 12, walk.z + gz * v));
      walk.y = 0;
      if (ride && (mx || my)) {
        // Driving: the car goes where you go, and turns its nose that way.
        const t = ride.toy;
        t.position.set(walk.x, 0, walk.z);
        let turn = Math.atan2(-gz, gx) - t.rotation.y;
        turn = Math.atan2(Math.sin(turn), Math.cos(turn));
        t.rotation.y += turn * Math.min(1, dt * 9);
      }
    }
    self.visible = walk.third && !ride;
    self.position.set(walk.x, walk.y + (mx || my ? Math.abs(Math.sin(now / 90)) * 0.09 : 0), walk.z);
    self.rotation.set(stunned ? Math.PI / 2 : 0, walk.yaw, 0);   // flat on your back when a kid runs you over
    if (walk.third) {
      // From behind and a little above; looking up or down swings the camera lower or higher.
      const dist = seat ? 7.5 : ride ? 6.5 : 4.8, lift = Math.max(0.06, Math.min(1.35, 0.36 - walk.pitch));
      camera.position.set(walk.x + sin * Math.cos(lift) * dist, walk.y + 1.1 + Math.sin(lift) * dist, walk.z + cos * Math.cos(lift) * dist);
      camera.lookAt(walk.x, walk.y + 1.1, walk.z);
    } else {
      camera.position.set(walk.x, walk.y + (seat ? 0.6 : ride ? 0.95 : EYE), walk.z);
      camera.rotation.set(walk.pitch, walk.yaw, stunned ? Math.sin(now / 60) * 0.25 : 0, 'YXZ');
    }
    // Is there something here to get on?
    walk.near = null;
    if (!game && !ride) {
      let best = 3.6;
      for (const t of toys) { if (t.userData.broken || t.position.y > 0.05 || !(DRIVES[t.userData.kind] || SEATS.includes(t.userData.kind))) continue; const d = Math.hypot(t.position.x - walk.x, t.position.z - walk.z) - (SEATS.includes(t.userData.kind) ? 1.8 : 0); if (d < best) { best = d; walk.near = t; } }
    }
    rideBtn.hidden = !!game || (!ride && !walk.near);
    if (!rideBtn.hidden) rideBtn.textContent = ride ? 'Hop off' : DRIVES[walk.near.userData.kind] ? 'Drive' : 'Ride';
    return true;
  };
  walkPad.addEventListener('pointerdown', (e) => {
    if (game && kick(e)) return;   // a tap on a kid is a kick, also from down in the street
    walkPad.setPointerCapture(e.pointerId);
    if (e.pointerType !== 'touch') { walk.look = { id: e.pointerId, x: e.clientX, y: e.clientY }; return; }
    const st = sticks[e.clientX < walkPad.clientWidth / 2 ? 'L' : 'R'];
    if (st.id !== null) return;
    Object.assign(st, { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: 0, y: 0 });
    drawStick(st);
  });
  walkPad.addEventListener('pointermove', (e) => {
    if (!walk) return;
    if (walk.look?.id === e.pointerId) {
      walk.yaw -= (e.clientX - walk.look.x) * 0.005; walk.pitch = Math.max(-1.2, Math.min(1.2, walk.pitch - (e.clientY - walk.look.y) * 0.005));
      walk.look.x = e.clientX; walk.look.y = e.clientY; walk.fresh = true;
      return;
    }
    const st = Object.values(sticks).find((q) => q.id === e.pointerId);
    if (!st) return;
    let x = (e.clientX - st.ox) / STICK, y = (e.clientY - st.oy) / STICK;
    const d = Math.hypot(x, y);
    if (d > 1) { x /= d; y /= d; }
    st.x = x; st.y = y;
    drawStick(st);
  });
  const walkUp = (e) => {
    if (walk?.look?.id === e.pointerId) walk.look = null;
    const st = Object.values(sticks).find((q) => q.id === e.pointerId);
    if (st) { st.id = null; st.x = st.y = 0; drawStick(st); }
  };
  walkPad.addEventListener('pointerup', walkUp);
  walkPad.addEventListener('pointercancel', walkUp);
  el.querySelector('[data-a="walk"]').addEventListener('click', enterWalk);
  walkBar.querySelector('[data-w="exit"]').addEventListener('click', exitWalk);
  walkBar.querySelector('[data-w="release"]').addEventListener('click', () => releaseKids());

  // ---------- Kid test ----------
  let lastBuild = null;
  const rebuildBtn = el.querySelector('[data-a="rebuild"]');
  rebuildBtn.addEventListener('click', () => {
    stopMotion();
    for (const b of lastBuild || []) if (toys.includes(b.toy)) { b.toy.position.copy(b.p); b.toy.quaternion.copy(b.q); }
    rebuildBtn.hidden = true;
    select(null); startMotion(true);
    needs = true;
    save();
  });
  let game = null, shoo = () => {}, kick = () => false, kickUp = () => {}, footKick = () => {};
  el.querySelector('.pg-foot').addEventListener('click', () => footKick());
  const KID_COLOURS = ['#ff3fa9', '#3d7bff', '#ffd23f', '#ff5a4f', '#3ecf8e', '#ff9a3d'];
  // Three kinds of kid: the usual one, a runner in a cap (small, fast, goes straight for your favourite)
  // and a big kid (slow, strong, and one kick is not enough).
  const makeKid = (i, type) => {
    const g = new THREE.Group();
    const col = lambert(type === 'big' ? '#6b4bd6' : type === 'runner' ? '#ff5a4f' : KID_COLOURS[i % KID_COLOURS.length]);
    g.add(part(new THREE.CylinderGeometry(0.16, 0.26, 0.5, 14), col, 0, 0.25, 0), part(new THREE.SphereGeometry(0.25, 16, 12), skin, 0, 0.68, 0));
    // Two dots for eyes, so you can see which way they're charging.
    for (const sx of [-0.09, 0.09]) g.add(part(new THREE.SphereGeometry(0.035, 8, 6), wheelMat, sx, 0.72, 0.22));
    // Arms up, obviously.
    for (const sx of [-1, 1]) { const arm = part(new THREE.CylinderGeometry(0.04, 0.04, 0.3, 8), col, sx * 0.24, 0.5, 0); arm.rotation.z = sx * -0.7; g.add(arm); }
    if (type === 'runner') g.add(part(new THREE.SphereGeometry(0.265, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), lambert('#ffd23f'), 0, 0.7, 0), part(new THREE.BoxGeometry(0.3, 0.03, 0.2), lambert('#ffd23f'), 0, 0.74, 0.28));
    if (type === 'big') g.add(part(new THREE.TorusGeometry(0.25, 0.035, 8, 20), lambert('#24222e'), 0, 0.76, 0).rotateX(Math.PI / 2));
    g.scale.setScalar(KID * (type === 'big' ? 1.35 : type === 'runner' ? 0.72 : 1));
    return g;
  };
  // A word that pops up over the action and floats away.
  const pop = (where, text) => {
    const v = where.clone().project(camera), d = el.appendChild(Object.assign(document.createElement('div'), { className: 'pg-pop', textContent: text }));
    d.style.left = `${((v.x + 1) / 2) * el.clientWidth}px`; d.style.top = `${((1 - v.y) / 2) * el.clientHeight}px`;
    setTimeout(() => d.remove(), 850);
  };
  const shake = () => renderer.domElement.animate?.([{ transform: 'translate(5px, -3px)' }, { transform: 'translate(-4px, 3px)' }, { transform: 'translate(2px, 1px)' }, { transform: 'none' }], { duration: 170 });
  const releaseKids = () => {
    if (game) return;
    if (!toys.some((t) => !TRAPS.includes(t.userData.kind))) { toast('Build something first, then let them at it.'); return; }
    if (mode === 'herd' && !fav) { toast('Tap the toy you love most and make it your favourite.'); return; }
    if (mode === 'herd' && fav.userData.broken) { toast('Your favourite is broken. Mend it, or choose another.'); return; }
    const rent = mode === 'herd' ? Math.floor(population() / 4) : 0;
    if (walk?.ride) hop();
    if (walk) { walk.stun = 0; walk.safe = 0; }
    const wasAlive = moving;
    stopMotion();
    setMore(false);
    select(null);
    save();
    el.classList.add('pg-playing');
    el.querySelector('.pg-result').hidden = true;
    const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -22, 0) });
    world.allowSleep = false;
    world.defaultContactMaterial.friction = 0.55;
    world.defaultContactMaterial.restitution = 0.05;
    // Kids slide over the floor without friction (they are steered, not rolled); otherwise the floor holds them still.
    const floorMat = new CANNON.Material({ friction: 1 }), kidMat = new CANNON.Material({ friction: 0 });
    world.addBody(new CANNON.Body({ mass: 0, material: floorMat, collisionFilterGroup: 2, shape: new CANNON.Plane(), quaternion: new CANNON.Quaternion().setFromEuler(-Math.PI / 2, 0, 0) }));
    // Every toy becomes a solid box the size of the toy (a ball becomes a ball).
    // Jam and trampolines stay put and only act on kids; everything else can be knocked about.
    const traps = toys.filter((t) => t.userData.kind === 'jam' || t.userData.kind === 'tramp').map((toy) => ({ toy, kind: toy.userData.kind, r: (toy.userData.kind === 'jam' ? 1.6 : 1.1) * toy.scale.x, ready: 0 }));
    const items = toys.filter((t) => t.userData.kind !== 'jam' && t.userData.kind !== 'tramp').map((toy) => {
      const start = { p: toy.position.clone(), q: toy.quaternion.clone() };
      const q = toy.quaternion.clone();
      toy.quaternion.identity();
      toy.updateMatrixWorld(true);
      const b = boxOf(toy);
      toy.quaternion.copy(q);
      toy.updateMatrixWorld(true);
      const half = b.getSize(new THREE.Vector3()).multiplyScalar(0.5);
      const centre = b.getCenter(new THREE.Vector3()).sub(toy.position);   // from its foot to its middle, unturned
      const kind = toy.userData.kind;
      const shape = kind === 'ball' ? new CANNON.Sphere(half.y) : new CANNON.Box(new CANNON.Vec3(Math.max(0.05, half.x), Math.max(0.05, half.y), Math.max(0.05, half.z)));
      const heavy = { house: 1.6, box: 1.1, truck: 1.3, bus: 1.3, tree: 0.6, pine: 0.6, person: 0.5, ball: 0.5, carton: 0.35, cereal: 0.35, shoebox: 0.35, roll: 0.35, ferris: 0.15, carousel: 0.4, coaster: 0.12, tent: 0.5, balloons: 0.2, jar: 0.8 }[kind] || 1;
      const body = new CANNON.Body({ mass: Math.max(0.4, half.x * half.y * half.z * 8 * 0.9 * heavy), shape, linearDamping: 0.08, angularDamping: 0.25 });
      const c = centre.clone().applyQuaternion(q);
      body.position.set(toy.position.x + c.x, toy.position.y + c.y, toy.position.z + c.z);
      body.quaternion.set(q.x, q.y, q.z, q.w);
      world.addBody(body);
      return { toy, body, centre, start };
    });
    const lures = items.filter((it) => it.toy.userData.kind === 'jar');
    lastBuild = items.map((it) => ({ toy: it.toy, p: it.start.p.clone(), q: it.start.q.clone() }));
    rebuildBtn.hidden = true; hand = null; showBox();
    const LENGTH = mode === 'herd' ? 16 : 11;   // seconds of mayhem
    // The kids come in from every side of the carpet.
    const count = mode === 'herd' ? herdKids() : Math.round((Number(el.querySelector('[data-a="kids"]').value) || 6) * Math.sqrt((MAT_W * MAT_D) / 1350));   // more kids for a bigger carpet
    const kids = [];
    let bunchAt = 0, bunchWants = null;
    for (let i = 0; i < count; i++) {
      // They come in bunches of four, each bunch from its own side and after the same toy at first.
      const bunch = Math.floor(i / 4), bunches = Math.ceil(count / 4);
      if (i % 4 === 0) { bunchAt = Math.random() * 6.3; bunchWants = items[Math.floor(Math.random() * items.length)]; }
      const a = bunchAt + ((i % 4) - 1.5) * 0.13;
      const round = mode === 'herd' ? herd.round : 9, roll = Math.random();
      const type = roll < (mode !== 'herd' ? 0.14 : round >= 2 ? 0.25 : 0) ? 'runner' : roll > (mode !== 'herd' ? 0.9 : round >= 3 ? 0.82 : 1) ? 'big' : 'kid';
      const mesh = makeKid(i, type);
      scene.add(mesh);
      const body = new CANNON.Body({ mass: 6, material: kidMat, shape: new CANNON.Sphere(KID_R), linearDamping: 0.3, fixedRotation: true });
      body.position.set(Math.cos(a) * (MAT_W / 2 + 4 + Math.random() * 4), KID_R, Math.sin(a) * (MAT_D / 2 + 4 + Math.random() * 4));
      // In kid herd they don't all come at once: you have to keep watching.
      const start = mode === 'herd' ? (bunch / bunches) * LENGTH * 0.6 : 0;
      mesh.visible = false;
      kids.push({ mesh, body, start, type, wants: bunchWants, hp: type === 'big' ? 2 : 1, push: type === 'big' ? 2.2 : 1, in: false, target: null, until: 0, speed: (5.4 + Math.random() * 2.6) * (type === 'runner' ? 1.7 : type === 'big' ? 0.7 : 1), phase: Math.random() * 6, face: 0 });
    }
    const clock = el.querySelector('.pg-clock');
    clock.hidden = false;
    game = { world, items, kids, t: 0, last: performance.now(), leaving: false, shoo: -1, kicked: 0, strikes: 0, freeze: -1, lure: null, armed: false };
    const favItem = items.find((it) => it.toy === fav);
    const powers = el.querySelector('.pg-powers'), freezeBtn = powers.querySelector('[data-p="freeze"]'), lureBtn = powers.querySelector('[data-p="lure"]');
    powers.hidden = false; freezeBtn.disabled = false; lureBtn.disabled = false; lureBtn.classList.remove('on');
    // Boom! Your one special move per test: a blast that only kids feel. They fly out of sight, land, and run back.
    const shooBtn = el.querySelector('.pg-shoo');
    shooBtn.disabled = false;
    const wave = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 64), new THREE.MeshBasicMaterial({ color: '#ff3fa9', transparent: true, depthWrite: false }));
    wave.rotation.x = -Math.PI / 2; wave.position.y = 0.05; wave.visible = false; wave.renderOrder = 5;
    scene.add(wave);
    shoo = () => {
      if (!game || game.leaving || game.shoo >= 0) return;
      const kids = game.kids.filter((k) => k.in && !k.out);   // only the ones on the floor
      game.shoo = game.t;
      shooBtn.disabled = true;
      let cx = 0, cz = 0;
      for (const k of kids) { cx += k.body.position.x / kids.length; cz += k.body.position.z / kids.length; }
      wave.position.set(cx, 0.05, cz);
      shake();
      pop(new THREE.Vector3(cx, 3, cz), 'BOOM!');
      for (const k of kids) {
        // Away from the middle of the crowd, and up. In the air a kid passes through toys and other kids.
        const a = Math.atan2(k.body.position.z - cz, k.body.position.x - cx) + (Math.random() - 0.5) * 1.2, out = 16 + Math.random() * 9;
        k.body.velocity.set(Math.cos(a) * out, 20 + Math.random() * 9, Math.sin(a) * out);
        k.body.collisionFilterMask = 2; k.body.linearDamping = 0.02;
        k.fly = true; k.flyAt = game.t; k.spin = (Math.random() < 0.5 ? -1 : 1) * (5 + Math.random() * 6); k.target = null;
      }
    };
    // Kick! Tap a kid and it is lobbed away from you, out for the round. Swipe across a kid and it is sent
    // skidding low in that direction, knocking out every kid in its way. Your foot needs a moment between kicks.
    const kickBar = el.querySelector('.pg-kick');
    // You only have three kicks, and they come back slowly: one kid at a time will not do it.
    const lv = mode === 'herd' ? herd.level : 0, KICKS = 3 + (lv >= 1) + (lv >= 3) + (lv >= 4), REFILL = 2.6;
    game.kicks = KICKS; game.refill = 0;
    const showKicks = () => { kickBar.textContent = `${'●'.repeat(game.kicks)}${'○'.repeat(KICKS - game.kicks)}${game.kicked ? `  ${game.kicked} out` : walk ? '  Face a kid and kick' : '  Swipe a kid into the others'}`; kickBar.classList.toggle('wait', !game.kicks); };
    kickBar.hidden = false; showKicks();
    let lastKick = -9, aimKid = null;
    const head = (k) => new THREE.Vector3(k.body.position.x, k.body.position.y + 3.2, k.body.position.z);
    const launch = (k, dx, dz, flat, chain) => {
      if (k.hp > 1) { k.hp--; k.dizzy = game.t + 1.8; k.body.velocity.set(dx * 6, 6, dz * 6); pop(head(k), 'Oof!'); return; }   // a big kid shrugs off the first one
      const out = flat ? 27 : 20 + Math.random() * 6;
      k.body.velocity.set(dx * out, flat ? 8.5 : 17 + Math.random() * 6, dz * out);
      k.body.collisionFilterMask = 2; k.body.linearDamping = 0.02;
      Object.assign(k, { fly: true, out: true, bowl: flat, dirx: dx, dirz: dz, chain, flyAt: game.t, spin: (Math.random() < 0.5 ? -1 : 1) * (6 + Math.random() * 6), target: null });
      game.kicked++;
      showKicks();
      if (chain) game.strikes++;
      pop(head(k), ['Pow!', 'Double!', 'Triple!', 'STRIKE!'][Math.min(3, chain)]);
    };
    kick = (e) => {
      if (!game || game.leaving) return false;
      aim(e);
      if (game.armed) {
        // The ice cream lands where you tap, and for a few seconds nothing else matters to them.
        floor.constant = 0;
        if (!ray.ray.intersectPlane(floor, hit)) return true;
        const cone = new THREE.Group();
        cone.add(part(new THREE.ConeGeometry(0.3, 0.8, 14), lambert('#c8a06a'), 0, 0.4, 0).rotateX(Math.PI), part(new THREE.SphereGeometry(0.34, 16, 12), lambert('#ffd0ea'), 0, 0.95, 0), part(new THREE.SphereGeometry(0.27, 16, 12), lambert('#f6f3ff'), 0, 1.36, 0));
        cone.scale.setScalar(2.4); cone.position.set(hit.x, 0, hit.z);
        scene.add(cone);
        game.armed = false; game.lure = { x: hit.x, z: hit.z, until: game.t + 4.5, mesh: cone };
        lureBtn.classList.remove('on'); lureBtn.disabled = true;
        showKicks();
        pop(new THREE.Vector3(hit.x, 3, hit.z), 'Ice cream!');
        return true;
      }
      const live = game.kids.filter((k) => k.in && !k.out);
      let o = ray.intersectObjects(live.map((k) => k.mesh), true)[0]?.object;
      while (o && !live.some((k) => k.mesh === o)) o = o.parent;
      if (!o) return false;
      const k = live.find((q) => q.mesh === o);
      if (walk && Math.hypot(k.body.position.x - walk.x, k.body.position.z - walk.z) > REACH) { pop(head(k), 'Too far!'); return true; }   // on foot you have to get close
      aimKid = { k, x: e.clientX, y: e.clientY, id: e.pointerId };
      return true;
    };
    kickUp = (e) => {
      if (!aimKid || e.pointerId !== aimKid.id) return;
      const { k, x, y } = aimKid;
      aimKid = null;
      if (!game || game.leaving || k.out || game.t - lastKick < 0.25) return;
      if (!game.kicks) { pop(head(k), 'No kicks left!'); return; }
      game.kicks--; showKicks();
      const sx = e.clientX - x, sy = e.clientY - y, swipe = Math.hypot(sx, sy) > 14;
      let dx = k.body.position.x - camera.position.x, dz = k.body.position.z - camera.position.z;   // a tap: away from you
      if (swipe) {
        // A swipe: the way your finger went, laid flat on the carpet.
        const f = camera.getWorldDirection(new THREE.Vector3()); f.y = 0; f.normalize();
        dx = -f.z * sx - f.x * sy; dz = f.x * sx - f.z * sy;
      }
      const d = Math.hypot(dx, dz) || 1;
      lastKick = game.t;
      launch(k, dx / d, dz / d, swipe, 0);
      shake();
    };
    // On foot: kick whoever is in front of you. With nobody in reach, you punt the nearest toy instead,
    // and a toy at speed takes kids out too (at the price of the toy).
    const REACH = 6.5;
    let lastPunt = -9;
    const ahead = (x, z, far) => { const dx = x - walk.x, dz = z - walk.z, d = Math.hypot(dx, dz) || 1; return d > far ? 9 : Math.acos(Math.max(-1, Math.min(1, (dx * -Math.sin(walk.yaw) + dz * -Math.cos(walk.yaw)) / d))); };
    footKick = () => {
      if (!game || game.leaving || !walk || walk.stun > game.t) return;
      const fx = -Math.sin(walk.yaw), fz = -Math.cos(walk.yaw);
      let kid = null, best = 0.75;
      for (const k of kids) { if (!k.in || k.out || k.fly) continue; const a = ahead(k.body.position.x, k.body.position.z, REACH); if (a < best) { best = a; kid = k; } }
      if (kid) {
        if (game.t - lastKick < 0.25) return;
        if (!game.kicks) { pop(head(kid), 'No kicks left!'); return; }
        game.kicks--; lastKick = game.t;
        launch(kid, fx, fz, true, 0);
        showKicks(); shake();
        return;
      }
      let toy = null; best = 0.7;
      for (const it of items) { const a = ahead(it.body.position.x, it.body.position.z, 4); if (a < best) { best = a; toy = it; } }
      if (!toy || game.t - lastPunt < 0.4) return;
      lastPunt = game.t;
      toy.body.velocity.set(fx * 24, 5, fz * 24);
      toy.body.angularVelocity.set((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8);
      toy.punt = game.t; toy.hits = 0;
      pop(new THREE.Vector3(toy.body.position.x, toy.body.position.y + 1.5, toy.body.position.z), 'Punt!');
      shake();
    };
    const footBtn = el.querySelector('.pg-foot');
    freezeBtn.onclick = () => { if (!game || game.leaving || game.freeze >= 0) return; game.freeze = game.t + 3.2; freezeBtn.disabled = true; pop(new THREE.Vector3(0, 4, 0), 'Statues!'); };
    lureBtn.onclick = () => { if (!game || game.leaving || game.lure || game.armed) return; game.armed = true; lureBtn.classList.add('on'); kickBar.textContent = 'Tap the carpet to drop the ice cream'; };
    const tmpQ = new THREE.Quaternion(), tmpV = new THREE.Vector3();
    const step = () => {
      if (!game) return;
      const now = performance.now();
      const dt = Math.min(0.05, (now - game.last) / 1000);
      game.last = now;
      game.t += dt;
      const left = LENGTH - game.t;
      game.leaving = left <= 0;
      const away = game.leaving;
      if (game.leaving) powers.hidden = true;
      if (game.lure && game.t > game.lure.until) { scene.remove(game.lure.mesh); game.lure = { ...game.lure, mesh: null, done: true }; }
      const lure = game.lure && !game.lure.done ? game.lure : null;
      if (lure) lure.mesh.rotation.y += dt * 2;
      const w = game.shoo >= 0 ? (game.t - game.shoo) / 0.9 : 2;
      wave.visible = w < 1;
      if (w < 1) { wave.scale.setScalar(1 + w * 40); wave.material.opacity = 0.9 * (1 - w); }
      if (game.kicks < KICKS && (game.refill += dt) >= REFILL) { game.refill = 0; game.kicks++; showKicks(); }
      // Everyone kicked out? Then it is over early.
      const allOut = kids.every((k) => k.out);
      if (allOut && !game.leaving && game.t < LENGTH - 0.01) game.t = Math.max(game.t, LENGTH + 0.6);
      clock.textContent = allOut ? 'All out!' : left > 0 ? `${Math.ceil(left)}` : 'Home time!';
      for (const k of kids) {
        if (!k.in) { if (game.t < k.start || game.leaving) continue; k.in = true; k.mesh.visible = true; world.addBody(k.body); k.target = k.wants; k.until = game.t + 3 + Math.random() * 1.5; }
        if (k.gone) continue;
        if (k.out) {
          // Kicked: gone for this round. One sent skidding takes others with it.
          if (k.bowl && game.t - k.flyAt < 1.5 && k.body.position.y < KID_R * 3) for (const q of kids) if (q !== k && q.in && !q.out && !q.fly && Math.hypot(q.body.position.x - k.body.position.x, q.body.position.z - k.body.position.z) < KID_R * 2.1) launch(q, k.dirx, k.dirz, true, k.chain + 1);
          if (game.t - k.flyAt > 1.7) { k.gone = true; k.mesh.visible = false; world.removeBody(k.body); }
          continue;
        }
        if (k.fly) {
          // Blown into the air: nothing to steer until they land.
          if (game.t - k.flyAt > 0.4 && k.body.position.y < KID_R + 0.1) { k.fly = false; k.body.collisionFilterMask = -1; k.body.linearDamping = 0.3; }
          else continue;
        }
        // Pick something to go for, and change your mind often.
        // Frozen like a statue, or seeing stars after a kick that was not quite enough.
        k.still = game.t < game.freeze || game.t < (k.dizzy || 0);
        if (k.still) { k.body.velocity.x *= 0.8; k.body.velocity.z *= 0.8; continue; }
        // Traps: a trampoline throws a kid off the carpet, jam makes every step slow and sticky.
        let sticky = 1;
        for (const tr of traps) {
          if (Math.hypot(k.body.position.x - tr.toy.position.x, k.body.position.z - tr.toy.position.z) > tr.r + KID_R * 0.5) continue;
          if (tr.kind === 'jam') sticky = 0.22;
          else if (game.t > tr.ready && !game.leaving && k.body.position.y < KID_R + 0.3) {
            tr.ready = game.t + 0.5;
            const a = Math.atan2(k.body.position.z - tr.toy.position.z, k.body.position.x - tr.toy.position.x) + (Math.random() - 0.5), out = 9 + Math.random() * 5;
            k.body.velocity.set(Math.cos(a) * out, 15 + Math.random() * 5, Math.sin(a) * out);
            k.body.collisionFilterMask = 2; k.body.linearDamping = 0.02;
            k.fly = true; k.flyAt = game.t; k.spin = (Math.random() < 0.5 ? -1 : 1) * (4 + Math.random() * 5); k.target = null;
            pop(head(k), 'Boing!');
          }
        }
        if (k.fly) continue;
        // A cookie jar is hard to ignore.
        if (!away && (!k.target || game.t > k.until)) { k.target = k.type === 'runner' && favItem ? favItem : lures.length && Math.random() < 0.6 ? lures[Math.floor(Math.random() * lures.length)] : items[Math.floor(Math.random() * items.length)]; k.until = game.t + 2.2 + Math.random() * 2.5; }
        let tx, tz;
        if (away) { const a = Math.atan2(k.body.position.z, k.body.position.x); tx = Math.cos(a) * 80; tz = Math.sin(a) * 80; }
        else if (lure) { tx = lure.x; tz = lure.z; }
        else { tx = k.target.body.position.x; tz = k.target.body.position.z; }
        const dx = tx - k.body.position.x, dz = tz - k.body.position.z, d = Math.hypot(dx, dz) || 1;
        const off = Math.abs(k.body.position.x) > MAT_W / 2 + 2 || Math.abs(k.body.position.z) > MAT_D / 2 + 2;   // off the carpet: hurry back
        const sp = k.speed * (game.leaving ? 1.6 : off ? 2.6 : 1) * sticky;
        k.body.velocity.x += ((dx / d) * sp - k.body.velocity.x) * Math.min(1, dt * 6);
        k.body.velocity.z += ((dz / d) * sp - k.body.velocity.z) * Math.min(1, dt * 6);
        // Up close: shove it, and now and then jump at it.
        if (!away && !lure && d < KID_R + 1.2) {
          const push = (5 + Math.random() * 6) * k.push;
          k.target.body.applyImpulse(new CANNON.Vec3((dx / d) * push * dt * 9, push * dt * 2.5, (dz / d) * push * dt * 9), new CANNON.Vec3(k.body.position.x, k.target.body.position.y + 0.3, k.body.position.z));
          if (sticky === 1 && Math.random() < dt * 1.6 && k.body.position.y < KID_R + 0.2) k.body.velocity.y = 7 + Math.random() * 4;
        }
        k.face = Math.atan2(k.body.velocity.x, k.body.velocity.z);
      }
      // A punted toy is a missile: any kid it reaches at speed is out.
      for (const it of items) {
        if (it.punt === undefined || game.t - it.punt > 2.5 || it.body.position.y > 3.5) continue;
        const v = it.body.velocity, sp = Math.hypot(v.x, v.z);
        if (sp < 7) continue;
        for (const q of kids) if (q.in && !q.out && !q.fly && Math.hypot(q.body.position.x - it.body.position.x, q.body.position.z - it.body.position.z) < KID_R + 1) launch(q, v.x / sp, v.z / sp, true, it.hits++);
      }
      // You, when you are down in the street: a small body that the giants (and the toys) can push about.
      if (walk && !game.me) { game.me = new CANNON.Body({ mass: 5, material: kidMat, shape: new CANNON.Sphere(0.55), linearDamping: 0.2, fixedRotation: true }); game.me.position.set(walk.x, 0.55, walk.z); world.addBody(game.me); showKicks(); }
      else if (!walk && game.me) { world.removeBody(game.me); game.me = null; showKicks(); }
      if (game.me) { game.me.velocity.x = walk.vx || 0; game.me.velocity.z = walk.vz || 0; }
      footBtn.hidden = !walk || game.leaving;
      world.step(1 / 60, dt, 3);
      if (game.me && walk) {
        walk.x = game.me.position.x; walk.z = game.me.position.z; walk.fresh = true;
        // A running kid that reaches you bowls you over for a moment.
        if (game.t > walk.safe && !game.leaving) for (const q of kids) if (q.in && !q.out && !q.fly && !q.still && Math.hypot(q.body.position.x - walk.x, q.body.position.z - walk.z) < KID_R + 0.85 && Math.hypot(q.body.velocity.x, q.body.velocity.z) > 2.5) {
          walk.stun = game.t + 1.1; walk.safe = game.t + 2.8;
          pop(new THREE.Vector3(walk.x, 2.2, walk.z), 'Ouch!'); shake();
          break;
        }
      }
      for (const it of items) {
        tmpQ.set(it.body.quaternion.x, it.body.quaternion.y, it.body.quaternion.z, it.body.quaternion.w);
        tmpV.copy(it.centre).applyQuaternion(tmpQ);
        it.toy.quaternion.copy(tmpQ);
        it.toy.position.set(it.body.position.x - tmpV.x, it.body.position.y - tmpV.y, it.body.position.z - tmpV.z);
      }
      for (const k of kids) {
        if (!k.in || k.gone) continue;
        // A waddle: they bob and rock as they run.
        k.mesh.position.set(k.body.position.x, k.body.position.y - KID_R + (k.still ? 0 : Math.abs(Math.sin(game.t * 9 + k.phase)) * 0.4), k.body.position.z);
        if (k.still && !k.fly) { if (game.t < (k.dizzy || 0)) k.mesh.rotation.y += dt * 9; continue; }
        if (k.fly) { k.mesh.position.y = k.body.position.y - KID_R * 0.4; k.mesh.rotation.set((game.t - k.flyAt) * k.spin, k.face, 0); }   // tumbling through the air
        else k.mesh.rotation.set(0, k.face, Math.sin(game.t * 9 + k.phase) * 0.14);
      }
      needs = true;
      if (game.t < LENGTH + 2.2) requestAnimationFrame(step); else finish();
    };
    const finish = () => {
      const g = game;
      game = null;
      clock.hidden = true;
      for (const k of g.kids) scene.remove(k.mesh);
      scene.remove(wave); powers.hidden = true; kickBar.hidden = true; footBtn.hidden = true;
      if (walk) { walk.vx = 0; walk.vz = 0; }
      if (g.lure?.mesh) scene.remove(g.lure.mesh);
      // Still standing: upright, and close to where you put it. Traps don't count.
      const up = new THREE.Vector3();
      let ok = 0, total = 0, favOk = false;
      for (const it of g.items) {
        if (TRAPS.includes(it.toy.userData.kind)) { it.stands = true; continue; }
        if (it.toy.userData.broken) { total++; continue; }   // already broken: it could not be saved
        up.set(0, 1, 0).applyQuaternion(it.toy.quaternion);
        const moved = Math.hypot(it.toy.position.x - it.start.p.x, it.toy.position.z - it.start.p.z);
        const stands = it.toy.userData.kind === 'ball' ? moved < 2 : up.y > 0.8 && moved < 2 && Math.abs(it.toy.position.y - it.start.p.y) < 0.4;
        total++;
        it.stands = stands;
        if (stands) { ok++; if (it.toy === fav) favOk = true; }
      }
      const pct = Math.round((ok / total) * 100);
      const verdict = pct >= 90 ? 'Kid-proof!' : pct >= 70 ? 'It held. Mostly.' : pct >= 40 ? 'They made a dent.' : pct > 0 ? 'Flattened.' : 'There was a town here once.';
      const res = el.querySelector('.pg-result');
      res.hidden = false;
      const restore = () => { for (const it of g.items) { it.toy.position.copy(it.start.p); it.toy.quaternion.copy(it.start.q); } needs = true; };
      const done = () => { res.hidden = true; el.classList.remove('pg-playing'); save(); if (wasAlive) startMotion(true); };
      if (mode === 'herd') {
        // Kid herd: your favourite decides how good the prizes are, and losing it costs a heart.
        herd.streak = favOk ? herd.streak + 1 : 0;
        if (!favOk) herd.hearts--;
        const tally = `Round ${herd.round}: ${ok} of ${total} toys still standing${g.kicked ? `, ${g.kicked} kids kicked out` : ''}`;
        if (herd.hearts <= 0) {
          const best = Math.max(herd.best || 0, herd.round);
          res.innerHTML = `<strong>The kids win.</strong><span>${tally}</span><span>You made it to round ${herd.round}${best > herd.round ? `. Your best is round ${best}` : herd.round > 1 ? '. Your best yet!' : ''}</span><div><button data-r="new" class="primary">Play again</button></div>`;
          res.querySelector('[data-r="new"]').addEventListener('click', () => { restore(); res.hidden = true; el.classList.remove('pg-playing'); load('herd', true); herd.best = best; save(); });
        } else {
          // Coins for how well you fought. They buy the town its next pieces.
          const pay = [[favOk ? 6 : 0, 'favourite safe'], [g.kicked, 'kids kicked out'], [g.strikes * 2, g.strikes === 1 ? '1 strike' : `${g.strikes} strikes`], [Math.floor(ok / 2), 'toys standing'], [rent, 'rent'], [2 + herd.round, 'for turning up']].filter(([n]) => n > 0);
          const won = pay.reduce((n, [c]) => n + c, 0);
          herd.coins += won;
          res.innerHTML = `<strong>${favOk ? 'Your favourite made it!' : 'They got your favourite.'}</strong><span>${tally}${herd.streak > 1 ? `. ${herd.streak} rounds safe in a row` : ''}</span><em>+ ${won} coins</em><span class="pg-pay">${pay.map(([n, what]) => `${what} +${n}`).join(' · ')}</span><div><button data-r="next" class="primary">Rebuild and carry on</button></div>`;
          res.querySelector('[data-r="next"]').addEventListener('click', () => {
            herd.round++;
            // Everything goes back the way you built it.
            restore();
            showBox(); showRound(); showRepair(); done();
            toast(`Rebuilt. You have ${herd.coins} coins to spend. Round ${herd.round} brings ${herdKids()} kids.`);
          });
        }
        showRound();
      } else {
        res.innerHTML = `<strong>${verdict}</strong><span>${ok} of ${total} toys still standing (${pct}%)${g.kicked ? `, ${g.kicked} kids kicked out` : ''}</span><div><button data-r="back" class="primary">Rebuild</button><button data-r="keep">Keep the mess</button><button data-r="again">Again!</button></div>`;
        res.querySelector('[data-r="back"]').addEventListener('click', () => { restore(); done(); });
        res.querySelector('[data-r="again"]').addEventListener('click', () => { restore(); done(); releaseKids(); });
        res.querySelector('[data-r="keep"]').addEventListener('click', () => {
          // Toys stay where they fell, but stand up again (they only turn on the spot when you build).
          for (const it of g.items) { const e = new THREE.Euler().setFromQuaternion(it.toy.quaternion, 'YXZ'); it.toy.rotation.set(0, e.y, 0); it.toy.position.y = 0; }
          for (const it of g.items) it.toy.position.y = restingHeight(it.toy, it.toy.position.x, it.toy.position.z);
          needs = true;
          done();
          rebuildBtn.hidden = false;   // changed your mind? One tap rebuilds it
        });
      }
      needs = true;
    };
    step();
  };
  el.querySelector('[data-a="release"]').addEventListener('click', releaseKids);
  el.querySelector('.pg-shoo').addEventListener('click', () => shoo());

  const close = () => {
    if (game) return;
    save();
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('keyup', onKeyUp, true);
    window.removeEventListener('pointerup', onKickUp, true);
    window.removeEventListener('resize', size);
    controls.dispose();
    scene.traverse((o) => { o.geometry?.dispose?.(); });
    renderer.dispose();
    el.remove();
    open = null;
  };
  el.querySelector('[data-a="close"]').addEventListener('click', close);
  if (standalone) el.querySelector('[data-a="close"]').remove();   // the page is the playground
  for (const t of ['pointerdown', 'wheel', 'dblclick', 'contextmenu']) el.addEventListener(t, (e) => e.stopPropagation());

  // --- start
  const size = () => {
    const w = el.clientWidth, h = el.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
    needs = true;
  };
  window.addEventListener('resize', size);
  // You can wander around the room, but not lose the carpet.
  controls.addEventListener('change', () => {
    const t = controls.target, lx = MAT_W / 2 + 10, lz = MAT_D / 2 + 10;
    const dx = Math.max(-lx, Math.min(lx, t.x)) - t.x, dz = Math.max(-lz, Math.min(lz, t.z)) - t.z;
    if (dx || dz || t.y) { camera.position.x += dx; camera.position.z += dz; t.x += dx; t.z += dz; t.y = 0; }
    needs = true;
  });
  // ---------- Free play and kid herd ----------
  // Two towns, kept apart: the one you build freely, and the one you defend round after round.
  const herdKids = () => Math.min(40, Math.round((1 + 3 * herd.round) * Math.sqrt((MAT_W * MAT_D) / 1350)));   // more of them every round, and on a bigger carpet
  const showRound = () => {
    const on = mode === 'herd';
    el.classList.toggle('pg-herd', on);
    el.querySelector('[data-a="kids"]').hidden = on;
    const label = el.querySelector('.pg-round');
    label.hidden = !on;
    if (on) label.textContent = `Round ${herd.round} · ${herdKids()} kids · ${'♥'.repeat(Math.max(0, herd.hearts))} · ${herd.coins}c`;
    for (const o of el.querySelectorAll('[data-a="size"] option')) o.disabled = on && (SIZE_LEVEL[o.value] || 0) > herd.level;
    const heartBtn = el.querySelector('[data-a="heart"]');
    heartBtn.disabled = !on || herd.hearts >= 3 || herd.coins < 15;
    showCensus();
    for (const b of el.querySelectorAll('[data-m]')) b.classList.toggle('on', b.dataset.m === mode);
  };
  const load = (m, fresh = false) => {
    stopMotion();
    for (const t of [...toys]) scene.remove(t);
    toys.length = 0; fav = null; select(null);
    hand = null; lastBuild = null; rebuildBtn.hidden = true;
    mode = m;
    let saved = null;
    if (!fresh) try { saved = JSON.parse(localStorage.getItem(KEY(boardId, m)) || 'null'); } catch {}
    herd = m === 'herd' ? saved?.herd || { round: 1, box: { ...START_BOX }, streak: 0, best: 0, hearts: 3, coins: 10, level: 0 } : null;
    if (herd && !(herd.hearts > 0)) herd.hearts = 3;
    if (herd) { herd.coins ??= 10; herd.level ??= 0; }
    state.carpet = m === 'herd' ? 'town' : saved?.carpet || 'town';
    setSize(saved?.size || 'medium');
    el.querySelector('[data-a="carpet"]').value = state.carpet;
    el.querySelector('[data-a="size"]').value = state.size;
    if (saved && !saved.v) { for (const t of saved.toys || []) { t.x *= PATTERN; t.z *= PATTERN; } }   // saved when the picture was smaller: spread out to match
    if (saved?.toys?.length) for (const t of saved.toys) addToy(t.kind, t, { quiet: true });
    else if (m === 'free' && !saved) buildTown(dice(4));   // a first town, so the mat isn't empty (always the same one)
    if (m === 'herd') { fav = toys[saved?.fav] || null; growTown(); }
    showRepair();
    showBox(); showRound();
    startMotion(true);   // the town is alive unless you stop it
    camera.position.copy(homeView()); controls.target.set(0, 0, 0.5); controls.update();
    needs = true;
  };
  for (const b of el.querySelectorAll('[data-m]')) b.addEventListener('click', () => {
    if (b.dataset.m === mode || game) return;
    save();
    load(b.dataset.m);
    save();
    if (mode === 'herd' && herd.round === 1 && !toys.length) welcome();
  });
  el.querySelector('[data-a="heart"]').addEventListener('click', () => { if (mode !== 'herd' || herd.hearts >= 3 || herd.coins < 15) return; herd.coins -= 15; herd.hearts++; showRound(); showBox(); save(); });
  const welcome = () => toast('Build your toy city. When the kids come, fight them off: battles win coins, and coins grow the city.');
  const restartBtn = el.querySelector('[data-a="restart"]');
  let restartTimer = 0;
  const restartRest = () => { clearTimeout(restartTimer); restartBtn.textContent = 'Start over'; restartBtn.classList.remove('on'); };
  restartBtn.addEventListener('click', () => {
    if (!restartBtn.classList.contains('on')) { restartBtn.textContent = 'Sure?'; restartBtn.classList.add('on'); restartTimer = setTimeout(restartRest, 3000); return; }
    restartRest(); setMore(false);
    const best = herd?.best || 0;
    load('herd', true);
    herd.best = best;
    save();
  });
  let lastMode = 'herd';
  try { lastMode = localStorage.getItem(`playground.mode.${boardId}`) === 'free' ? 'free' : 'herd'; } catch {}
  size();
  load(lastMode);
  if (mode === 'herd' && herd.round === 1 && !toys.length) welcome();
  const loop = (now) => {
    raf = requestAnimationFrame(loop);
    if (moving) { motionStep(now || performance.now()); needs = true; }
    // The marker over your favourite follows it, even when it is sent flying.
    // A red cross floats over anything broken.
    let nb = 0;
    for (const t of toys) if (t.userData.broken) {
      const mark = crosses[nb] || (crosses[nb] = scene.add(cross.clone()) && scene.children[scene.children.length - 1]);
      const b = boxOf(t);
      mark.visible = true; mark.position.set((b.min.x + b.max.x) / 2, b.max.y + 0.5, (b.min.z + b.max.z) / 2); mark.quaternion.copy(camera.quaternion);
      nb++;
    }
    for (let i = nb; i < crosses.length; i++) crosses[i].visible = false;
    star.visible = !!fav;
    if (fav) { const b = boxOf(fav), y = b.max.y + 0.7 + Math.sin((now || 0) / 300) * 0.08; if (star.position.x !== fav.position.x || star.position.z !== fav.position.z || Math.abs(star.position.y - y) > 0.002) { star.position.set((b.min.x + b.max.x) / 2, y, (b.min.z + b.max.z) / 2); star.rotation.y = (now || 0) / 500; needs = true; } }
    const moved = walk ? walkStep(now || performance.now()) : controls.update();
    if (moved || needs) { needs = false; renderer.render(scene, camera); }
  };
  loop();
  open = { close };
  // Letters use the display font once it's loaded.
  document.fonts?.load('700 40px Fredoka').then(() => { for (const t of toys) if (t.userData.kind === 'letter') { t.userData.paint.map = letterTexture(t.userData.letter); t.userData.paint.needsUpdate = true; } needs = true; }).catch(() => {});
}

export function closePlayground() { open?.close(); }
