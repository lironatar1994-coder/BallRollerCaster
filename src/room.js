// The kid's room: furniture, toys, lights — and their physics colliders.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/RoundedBoxGeometry.js';
import { PlaneCollider, BoxCollider, SphereCollider, CylinderCollider, SURFACES } from './physics.js';
import * as TX from './textures.js';

// The room is modelled in "design" metres and then shrunk as a whole: a toddler-sized room
// makes the coaster (whose physics stay in real metres) big and readable in it.
export const ROOM_SCALE = 0.7;
const DESIGN = { x0: -2.4, x1: 2.4, z0: -2.0, z1: 2.0, h: 2.6 };
export const ROOM = { x0: DESIGN.x0 * ROOM_SCALE, x1: DESIGN.x1 * ROOM_SCALE, z0: DESIGN.z0 * ROOM_SCALE, z1: DESIGN.z1 * ROOM_SCALE, h: DESIGN.h * ROOM_SCALE };

// colliders are built in design units like the meshes, then scaled once at the end
export function scaleCollider(c, s) {
  const sv = (v) => v && v.multiplyScalar(s);
  if (c instanceof PlaneCollider) { c.d *= s; return; }
  for (const k of ['cx', 'cy', 'cz', 'hx', 'hy', 'hz', 'R', 'y0', 'y1']) if (typeof c[k] === 'number') c[k] *= s;
  sv(c.min); sv(c.max);
}

export function buildRoom(scene) {
  const group = new THREE.Group();
  group.name = 'room';
  group.scale.setScalar(ROOM_SCALE);
  scene.add(group);
  const colliders = [], placeables = [], solids = [];

  // the studio reflections are for the toys; walls and furniture only take a little of them
  const std = (o) => new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.75, metalness: 0, envMapIntensity: 0.25 }, o));
  const M = {
    white: std({ color: '#f6f1e9', roughness: 0.6 }),
    furniture: std({ color: '#fbf7f0', roughness: 0.55 }),
    wood: std({ map: TX.woodTexture('#e6c28e'), roughness: 0.6 }),
    darkwood: std({ map: TX.woodTexture('#b98454'), roughness: 0.6 }),
    blue: std({ color: '#7fb8ff', roughness: 0.5 }),
    pink: std({ color: '#ff9fc0', roughness: 0.6 }),
    yellow: std({ color: '#ffd45e', roughness: 0.5 }),
    green: std({ color: '#7fdc9b', roughness: 0.6 }),
    mint: std({ color: '#a8ecd6', roughness: 0.6 }),
    teddy: std({ color: '#c8925a', roughness: 0.95 }),
    teddyLight: std({ color: '#ecc9a0', roughness: 0.95 }),
    black: std({ color: '#2b2b33', roughness: 0.4 }),
  };

  const mesh = (geo, mat, x, y, z, o = {}) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    if (o.ry) m.rotation.y = o.ry;
    if (o.rx) m.rotation.x = o.rx;
    if (o.rz) m.rotation.z = o.rz;
    m.castShadow = o.cast !== false; m.receiveShadow = true;
    if (o.place) { m.userData.place = true; placeables.push(m); }
    if (o.solid !== false) { m.userData.solid = true; solids.push(m); }
    group.add(m);
    return m;
  };
  const box = (w, h, d, x, y, z, mat, o = {}) => {
    const geo = o.round ? new RoundedBoxGeometry(w, h, d, 3, Math.min(o.round, w / 2, h / 2, d / 2)) : new THREE.BoxGeometry(w, h, d);
    const m = mesh(geo, mat, x, y, z, o);
    if (o.surf) { const c = new BoxCollider(x, y, z, w / 2, h / 2, d / 2, o.ry || 0, o.surf); c.room = true; colliders.push(c); }
    return m;
  };
  const cyl = (r, h, x, y0, z, mat, o = {}) => {
    const m = mesh(new THREE.CylinderGeometry(o.rTop ?? r, r, h, o.seg || 28), mat, x, y0 + h / 2, z, o);
    if (o.surf) { const c = new CylinderCollider(x, z, y0, y0 + h, Math.max(r, o.rTop ?? r), o.surf); c.room = true; colliders.push(c); }
    return m;
  };
  const ball = (r, x, y, z, mat, o = {}) => {
    const m = mesh(new THREE.SphereGeometry(r, 32, 20), mat, x, y, z, o);
    if (o.surf) { const c = new SphereCollider(x, y, z, r, o.surf); c.room = true; colliders.push(c); }
    return m;
  };

  const { x0, x1, z0, z1, h } = DESIGN;
  const W = x1 - x0, D = z1 - z0;

  // ---- floor & walls
  const floor = mesh(new THREE.PlaneGeometry(W, D), std({ map: TX.floorTexture(), roughness: 0.5 }), 0, 0, 0, { rx: -Math.PI / 2, cast: false, place: true });
  floor.userData.surface = 'floor';
  colliders.push(new PlaneCollider(0, 1, 0, 0, SURFACES.floor));

  // the wallpaper stars glow in the dark (emissive map, switched on at night)
  const wallMat = std({ map: TX.wallpaperTexture('#cde9fb'), roughness: 0.9, emissiveMap: TX.wallStarsTexture(), emissive: '#fff4b0', emissiveIntensity: 0 });
  const wallMat2 = std({ map: TX.wallpaperTexture('#fde3ec', '#ffd0e0'), roughness: 0.9, emissiveMap: TX.wallStarsTexture(), emissive: '#fff4b0', emissiveIntensity: 0 });
  const glow = [];
  const wall = (w, hh, x, y, z, ry, mat) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, hh), mat);
    m.position.set(x, y, z); m.rotation.y = ry; m.receiveShadow = true; group.add(m);
    return m;
  };
  wall(W, h, 0, h / 2, z0, 0, wallMat);
  wall(W, h, 0, h / 2, z1, Math.PI, wallMat);
  wall(D, h, x0, h / 2, 0, Math.PI / 2, wallMat2);
  wall(D, h, x1, h / 2, 0, -Math.PI / 2, wallMat2);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, D), std({ color: '#fffaf2', roughness: 1 }));
  ceil.position.set(0, h, 0); ceil.rotation.x = Math.PI / 2; group.add(ceil);
  colliders.push(new PlaneCollider(0, 0, 1, z0, SURFACES.wall), new PlaneCollider(0, 0, -1, -z1, SURFACES.wall));
  colliders.push(new PlaneCollider(1, 0, 0, x0, SURFACES.wall), new PlaneCollider(-1, 0, 0, -x1, SURFACES.wall));
  colliders.push(new PlaneCollider(0, -1, 0, -h, SURFACES.wall));
  for (const c of colliders) c.room = true;
  // skirting boards
  box(W, 0.08, 0.015, 0, 0.04, z0 + 0.0075, M.white, { solid: false });
  box(W, 0.08, 0.015, 0, 0.04, z1 - 0.0075, M.white, { solid: false });
  box(0.015, 0.08, D, x0 + 0.0075, 0.04, 0, M.white, { solid: false });
  box(0.015, 0.08, D, x1 - 0.0075, 0.04, 0, M.white, { solid: false });

  // ---- rug
  const rugR = 1.15, rugX = 0.1, rugZ = 0.35;
  const rug = new THREE.Mesh(new THREE.CylinderGeometry(rugR, rugR, 0.012, 96), [std({ color: '#f3c6d3', roughness: 1 }), std({ map: TX.rugTexture(), roughness: 1 }), std({ color: '#f3c6d3' })]);
  rug.position.set(rugX, 0.006, rugZ); rug.receiveShadow = true; rug.userData.place = true; rug.userData.solid = true;
  placeables.push(rug); solids.push(rug); group.add(rug);
  { const c = new CylinderCollider(rugX, rugZ, 0, 0.012, rugR, SURFACES.carpet); c.room = true; colliders.push(c); }

  // ---- bed (right wall)
  const bx = 1.875, bz = -0.975;
  box(1.05, 0.28, 2.05, bx, 0.15, bz, M.furniture, { round: 0.03, surf: SURFACES.wood });
  for (const [lx, lz] of [[1.39, 0.02], [2.36, 0.02], [1.39, -1.97], [2.36, -1.97]]) cyl(0.03, 0.02, lx, 0, lz, M.darkwood, { solid: false });
  box(1.0, 0.16, 2.0, bx, 0.37, bz, M.white, { round: 0.04, place: true, surf: SURFACES.soft });
  const blanket = box(1.08, 0.04, 1.5, bx, 0.465, bz + 0.27, std({ map: TX.blanketTexture(), roughness: 0.95 }), { round: 0.018, place: true, surf: SURFACES.soft });
  blanket.userData.surface = 'bed';
  box(0.62, 0.11, 0.32, bx, 0.51, -1.72, std({ color: '#fffdf8', roughness: 0.95 }), { round: 0.05, surf: SURFACES.soft });
  const head = box(1.1, 0.95, 0.05, bx, 0.475, -1.99, M.blue, { round: 0.02, surf: SURFACES.wood });
  // headboard stars
  for (let i = 0; i < 5; i++) {
    const s = new THREE.Mesh(new THREE.CircleGeometry(0.045, 5), M.yellow);
    s.position.set(bx - 0.4 + i * 0.2, 0.8 + (i % 2) * 0.06, -1.963); s.rotation.z = i; group.add(s);
  }
  // teddy bear
  const tx = 2.12, tz = -1.32;
  ball(0.105, tx, 0.58, tz, M.teddy, { surf: SURFACES.soft });
  ball(0.075, tx, 0.74, tz - 0.01, M.teddy, { surf: SURFACES.soft });
  ball(0.03, tx - 0.06, 0.8, tz - 0.01, M.teddy);
  ball(0.03, tx + 0.06, 0.8, tz - 0.01, M.teddy);
  ball(0.032, tx, 0.725, tz + 0.06, M.teddyLight);
  ball(0.012, tx, 0.735, tz + 0.09, M.black);
  ball(0.009, tx - 0.028, 0.765, tz + 0.06, M.black);
  ball(0.009, tx + 0.028, 0.765, tz + 0.06, M.black);
  ball(0.05, tx - 0.11, 0.6, tz + 0.04, M.teddy);
  ball(0.05, tx + 0.11, 0.6, tz + 0.04, M.teddy);
  ball(0.05, tx - 0.06, 0.5, tz + 0.1, M.teddy);
  ball(0.05, tx + 0.06, 0.5, tz + 0.1, M.teddy);
  // string lights above bed
  {
    const bulbCols = ['#ffd166', '#ff8fa3', '#8bd3ff', '#b8f2a0'];
    for (let i = 0; i <= 18; i++) {
      const t = i / 18, z = -1.9 + t * 1.8, y = 1.75 - Math.sin(t * Math.PI) * 0.18 + Math.sin(t * Math.PI * 3) * 0.04;
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.016, 12, 8), new THREE.MeshStandardMaterial({ color: bulbCols[i % 4], emissive: bulbCols[i % 4], emissiveIntensity: 1.6 }));
      b.position.set(x1 - 0.02, y, z); group.add(b);
      glow.push([b.material, 1.6, 5]);
    }
  }
  // rainbow poster over bed
  {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.5), std({ map: TX.posterTexture('rainbow'), roughness: 0.8 }));
    p.position.set(x1 - 0.003, 1.35, -0.95); p.rotation.y = -Math.PI / 2; group.add(p);
  }

  // ---- desk + chair under the window (left wall)
  const dx = -2.09, dz = -0.3, dTop = 0.65;
  box(0.62, 0.03, 1.3, dx, dTop - 0.015, dz, M.wood, { round: 0.008, place: true, surf: SURFACES.wood });
  for (const [lx, lz] of [[-2.36, 0.31], [-1.82, 0.31]]) box(0.04, dTop - 0.03, 0.04, lx, (dTop - 0.03) / 2, lz, M.furniture, { surf: SURFACES.wood });
  box(0.56, dTop - 0.03, 0.46, -2.1, (dTop - 0.03) / 2, -0.7, M.furniture, { round: 0.01, surf: SURFACES.wood });
  for (let i = 0; i < 3; i++) {
    box(0.005, 0.15, 0.4, -1.818, 0.1 + i * 0.2, -0.7, [M.pink, M.yellow, M.mint][i], { solid: false, cast: false });
    cyl(0.012, 0.02, -1.8, 0.16 + i * 0.2, -0.7, M.white, { solid: false, rx: Math.PI / 2 });
  }
  // desk lamp
  cyl(0.06, 0.02, -2.25, dTop, -0.82, M.yellow, { surf: SURFACES.plastic });
  {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.36), M.yellow);
    arm.position.set(-2.22, dTop + 0.18, -0.78); arm.rotation.x = 0.25; arm.castShadow = true; group.add(arm);
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.1, 24, 1, true), new THREE.MeshStandardMaterial({ color: '#ffd45e', side: THREE.DoubleSide }));
    shade.position.set(-2.18, dTop + 0.36, -0.72); shade.rotation.x = -0.9; group.add(shade);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.022, 12, 8), new THREE.MeshStandardMaterial({ color: '#fff', emissive: '#fff4c0', emissiveIntensity: 3 }));
    bulb.position.set(-2.17, dTop + 0.33, -0.69); group.add(bulb);
    glow.push([bulb.material, 3, 8]);
  }
  // books + pencil cup on desk
  const bookCols = ['#ff6b6b', '#4c8dff', '#3ccf7a', '#ffd23f', '#9b6bff', '#ff9f43', '#ff77b7', '#2ec4b6'];
  for (let i = 0; i < 4; i++) box(0.22 - i * 0.02, 0.03, 0.16 - i * 0.01, -2.25, dTop + 0.015 + i * 0.03, 0.12, std({ color: bookCols[i] }), { ry: i * 0.12, surf: SURFACES.wood });
  cyl(0.035, 0.09, -2.3, dTop, -0.15, M.pink, { surf: SURFACES.plastic });
  for (let i = 0; i < 4; i++) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.16), std({ color: bookCols[i + 2] }));
    p.position.set(-2.3 + (i - 1.5) * 0.012, dTop + 0.1, -0.15 + (i % 2 - 0.5) * 0.015); p.rotation.z = (i - 1.5) * 0.12; group.add(p);
  }
  // chair
  const cx = -1.62, cz = -0.2;
  box(0.38, 0.035, 0.38, cx, 0.4, cz, M.mint, { round: 0.012, place: true, surf: SURFACES.wood });
  box(0.035, 0.45, 0.38, cx + 0.19, 0.64, cz, M.mint, { round: 0.012, surf: SURFACES.wood });
  for (const [lx, lz] of [[-0.16, -0.16], [0.16, -0.16], [-0.16, 0.16], [0.16, 0.16]]) cyl(0.014, 0.385, cx + lx, 0, cz + lz, M.white, { surf: SURFACES.wood });

  // window
  const skyMat = new THREE.MeshBasicMaterial({ map: TX.skyTexture() });
  {
    const wz = -0.3, wy = 1.5, ww = 0.95, wh = 1.0;
    const sky = new THREE.Mesh(new THREE.PlaneGeometry(ww, wh), skyMat);
    sky.position.set(x0 + 0.002, wy, wz); sky.rotation.y = Math.PI / 2; group.add(sky);
    const fr = M.white;
    box(0.05, 0.05, ww + 0.1, x0 + 0.025, wy + wh / 2 + 0.025, wz, fr, { solid: false });
    box(0.05, 0.05, ww + 0.1, x0 + 0.025, wy - wh / 2 - 0.025, wz, fr, { solid: false });
    box(0.05, wh, 0.05, x0 + 0.025, wy, wz - ww / 2 - 0.025, fr, { solid: false });
    box(0.05, wh, 0.05, x0 + 0.025, wy, wz + ww / 2 + 0.025, fr, { solid: false });
    box(0.03, wh, 0.025, x0 + 0.015, wy, wz, fr, { solid: false, cast: false });
    box(0.03, 0.025, ww, x0 + 0.015, wy, wz, fr, { solid: false, cast: false });
    box(0.14, 0.03, ww + 0.18, x0 + 0.07, wy - wh / 2 - 0.06, wz, fr, { place: true, surf: SURFACES.wood });
    // curtains
    const curtain = (side) => {
      const g = new THREE.PlaneGeometry(0.3, 1.4, 16, 1);
      const pos = g.attributes.position;
      for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.sin(pos.getX(i) * 40) * 0.025);
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: '#ffb3c7', roughness: 1, side: THREE.DoubleSide }));
      m.position.set(x0 + 0.08, wy + 0.05, wz + side * (ww / 2 + 0.2)); m.rotation.y = Math.PI / 2; group.add(m);
    };
    curtain(1); curtain(-1);
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, ww + 0.8), M.darkwood);
    rod.rotation.x = Math.PI / 2; rod.position.set(x0 + 0.08, wy + 0.75, wz); group.add(rod);
  }

  // ---- bookshelf (back wall)
  {
    const sx = -0.8, sw = 0.9, sd = 0.3, sh = 1.25, szc = z0 + sd / 2;
    box(0.02, sh, sd, sx - sw / 2 + 0.01, sh / 2, szc, M.furniture, { surf: SURFACES.wood });
    box(0.02, sh, sd, sx + sw / 2 - 0.01, sh / 2, szc, M.furniture, { surf: SURFACES.wood });
    box(sw, sh, 0.01, sx, sh / 2, z0 + 0.005, M.pink, { surf: SURFACES.wood, solid: false });
    const levels = [0.0, 0.36, 0.68, 1.0, sh - 0.02];
    levels.forEach((ly, i) => box(sw, 0.02, sd, sx, ly + 0.01, szc, M.furniture, { surf: SURFACES.wood, place: i === levels.length - 1 }));
    for (let l = 0; l < 3; l++) {
      let bxp = sx - sw / 2 + 0.04;
      const top = levels[l] + 0.02;
      while (bxp < sx + sw / 2 - 0.08) {
        const bw = 0.025 + TX.rnd() * 0.03, bh = 0.18 + TX.rnd() * 0.1;
        box(bw, bh, 0.2, bxp + bw / 2, top + bh / 2, z0 + 0.13, std({ color: bookCols[Math.floor(TX.rnd() * bookCols.length)], roughness: 0.7 }), { solid: false, rz: (TX.rnd() - 0.5) * 0.04 });
        bxp += bw + 0.004;
        if (TX.rnd() < 0.12) bxp += 0.08;
      }
      // one collider per row of books
      const c = new BoxCollider(sx, top + 0.12, z0 + 0.13, sw / 2 - 0.02, 0.12, 0.1, 0, SURFACES.wood); c.room = true; colliders.push(c);
    }
    // toys on top
    ball(0.06, sx - 0.25, sh + 0.06, szc, M.green, { surf: SURFACES.plastic });
    box(0.12, 0.12, 0.12, sx + 0.2, sh + 0.06, szc, std({ map: TX.blockTexture('Z', '#ff6b6b') }), { round: 0.01, surf: SURFACES.wood, ry: 0.4 });
  }

  // ---- toy box
  {
    const tbx = 0.6, tbz = -1.77;
    box(0.6, 0.4, 0.4, tbx, 0.2, tbz, std({ map: TX.stripesTexture(['#ff8fa3', '#ffd166', '#8bd3ff', '#b8f2a0']) }), { round: 0.02, surf: SURFACES.wood });
    box(0.62, 0.03, 0.42, tbx, 0.415, tbz, M.yellow, { round: 0.012, surf: SURFACES.wood, place: true });
    const star = new THREE.Mesh(new THREE.CircleGeometry(0.07, 5), M.white);
    star.position.set(tbx, 0.22, tbz + 0.202); group.add(star);
  }

  // ---- toys on the floor / rug
  const blocks = [
    ['A', '#ff6b6b', 0.82, 0.88, 0.3], ['B', '#4c8dff', 0.92, 0.95, 1.1], ['C', '#3ccf7a', -0.6, 1.15, 0.7],
    ['1', '#ffd23f', -0.75, 1.05, 0.1], ['2', '#9b6bff', -0.72, 1.1, 0.5],
  ];
  for (const [ch, col, x, z, ry] of blocks) box(0.065, 0.065, 0.065, x, 0.012 + 0.0325, z, std({ map: TX.blockTexture(ch, col), roughness: 0.5 }), { round: 0.006, ry, place: true, surf: SURFACES.wood });
  box(0.065, 0.065, 0.065, -0.74, 0.012 + 0.0325 + 0.065, 1.06, std({ map: TX.blockTexture('3', '#ff77b7') }), { round: 0.006, ry: 0.5, place: true, surf: SURFACES.wood });
  // beach ball
  ball(0.14, -1.55, 0.14, 1.45, std({ map: TX.stripesTexture(['#ff6b6b', '#ffffff', '#4c8dff', '#ffffff', '#ffd23f', '#ffffff']), roughness: 0.35 }), { surf: SURFACES.plastic });
  // rocket toy
  {
    const rx = -0.05, rz = -1.7;
    cyl(0.05, 0.3, rx, 0.02, rz, M.white, { surf: SURFACES.plastic });
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.12, 24), std({ color: '#ff6b6b' }));
    cone.position.set(rx, 0.38, rz); cone.castShadow = true; group.add(cone);
    for (let i = 0; i < 3; i++) {
      const f = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.09, 0.06), std({ color: '#ff6b6b' }));
      const a = i * Math.PI * 2 / 3;
      f.position.set(rx + Math.cos(a) * 0.065, 0.065, rz + Math.sin(a) * 0.065); f.rotation.y = -a; f.castShadow = true; group.add(f);
    }
    const win = new THREE.Mesh(new THREE.CircleGeometry(0.02, 20), std({ color: '#4cc9f0' }));
    win.position.set(rx, 0.24, rz + 0.051); group.add(win);
  }
  // plant
  cyl(0.11, 0.24, 2.15, 0, 1.75, std({ color: '#ff9f6b' }), { rTop: 0.13, surf: SURFACES.plastic });
  for (let i = 0; i < 9; i++) {
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), std({ color: i % 2 ? '#4fbf6a' : '#66d17f' }));
    const a = i * 0.7;
    leaf.scale.set(0.5, 1.4, 0.5);
    leaf.position.set(2.15 + Math.cos(a) * 0.07, 0.38 + (i % 3) * 0.07, 1.75 + Math.sin(a) * 0.07);
    leaf.rotation.set(Math.cos(a) * 0.5, 0, Math.sin(a) * 0.5); leaf.castShadow = true; group.add(leaf);
  }
  // door + poster
  {
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.85, 2.05, 0.04), std({ color: '#fff4e0' }));
    door.position.set(-1.2, 1.025, z1 - 0.02); door.receiveShadow = true; group.add(door);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.025, 16, 12), std({ color: '#ffcf5c', metalness: 0.6, roughness: 0.3 }));
    knob.position.set(-0.86, 1.0, z1 - 0.05); group.add(knob);
    const p = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), std({ map: TX.posterTexture('abc') }));
    p.position.set(0.5, 1.45, z1 - 0.003); p.rotation.y = Math.PI; group.add(p);
    const p2 = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.75), std({ map: TX.posterTexture('rocket') }));
    p2.position.set(0.55, 1.45, z0 + 0.003); group.add(p2);
  }
  // cloud ceiling lamp
  {
    const lampMat = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#fff3d6', emissiveIntensity: 1.2 });
    glow.push([lampMat, 1.2, 2.2]);
    for (let i = 0; i < 5; i++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.12 + (i % 2) * 0.04, 20, 14), lampMat);
      s.position.set(-0.2 + i * 0.1, h - 0.12 + (i % 2) * 0.03, 0); group.add(s);
    }
  }

  // ---- lights
  // lights live in the scene, so their positions are scaled by hand
  const S = ROOM_SCALE;
  const hemi = new THREE.HemisphereLight('#e6f3ff', '#ffe4c8', 0.75);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff0d4', 2.4);
  sun.position.set(-3.6 * S, 3.4 * S, 0.4 * S);
  sun.target.position.set(0.4 * S, 0, -0.1 * S);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -3.2, right: 3.2, top: 3.2, bottom: -3.2, near: 0.5, far: 9 });
  sun.shadow.bias = -0.0002; sun.shadow.normalBias = 0.012;
  scene.add(sun, sun.target);
  const lamp = new THREE.PointLight('#ffd9a8', 2.2, 7, 1.2);
  lamp.position.set(0, (h - 0.3) * S, 0);
  scene.add(lamp);
  const fill = new THREE.DirectionalLight('#dbe8ff', 0.5);
  fill.position.set(2 * S, 2 * S, 3 * S);
  scene.add(fill);
  // the desk lamp only matters at night
  const deskLight = new THREE.SpotLight('#ffd27a', 0, 3, 0.9, 0.6, 1.2);
  deskLight.position.set(-2.17 * S, 0.95 * S, -0.69 * S);
  deskLight.target.position.set(-1.9 * S, 0.62 * S, -0.4 * S);
  scene.add(deskLight, deskLight.target);

  const setNight = (on) => {
    sun.intensity = on ? 0.35 : 2.4; sun.color.set(on ? '#8fa8ff' : '#fff0d4');
    hemi.intensity = on ? 0.14 : 0.75; hemi.color.set(on ? '#7d8cff' : '#e6f3ff'); hemi.groundColor.set(on ? '#2b1f3a' : '#ffe4c8');
    lamp.intensity = on ? 1.3 : 2.2; lamp.color.set(on ? '#ffb86b' : '#ffd9a8');
    fill.intensity = on ? 0.05 : 0.5;
    deskLight.intensity = on ? 4 : 0;
    skyMat.map = on ? TX.nightSkyTexture() : TX.skyTexture(); skyMat.needsUpdate = true;
    wallMat.emissiveIntensity = wallMat2.emissiveIntensity = on ? 0.55 : 0;
    for (const [m, day, night] of glow) m.emissiveIntensity = on ? night : day;
    scene.background.set(on ? '#14132a' : '#f3eee6');
  };

  for (const c of colliders) scaleCollider(c, S);
  const lights = [hemi, sun, sun.target, lamp, fill, deskLight, deskLight.target];
  const V = (x, y, z) => new THREE.Vector3(x, y, z).multiplyScalar(S);
  return {
    kind: 'kids', name: "Kid's Room", group, colliders, placeables, solids, sun, setNight, scale: S, bounds: ROOM,
    teddy: V(tx, 0.82, tz),
    // where toy spectators can sit (world coordinates), and where a visitor comes in
    seats: [V(1.55, 0.485, -0.25), V(-0.8, 1.25, -1.86), V(-2.05, 0.65, -0.5), V(0.45, 0.43, -1.77), V(1.05, 0.012, 1.45), V(-1.9, 0.012, 1.2)],
    door: { p: V(-1.2, 0, z1 - 0.25), out: V(-1.2, 0, z1 + 0.4) },
    water: [],
    dispose() { scene.remove(group, ...lights); disposeTree(group); },
  };
}
export function disposeTree(root) {
  root.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    for (const m of [].concat(o.material || [])) { for (const k of ['map', 'emissiveMap']) if (m[k]) m[k].dispose(); m.dispose(); }
  });
}
