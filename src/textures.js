// Procedural canvas textures — no external image assets.
import * as THREE from 'three';

function cnv(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}
function tex(c, rx = 1, ry = 1) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.anisotropy = 8;
  return t;
}
let seed = 1234;
export function rnd() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }

function shade(hex, f) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(f);
  return '#' + c.getHexString();
}

const cache = new Map();
function memo(key, fn) { if (!cache.has(key)) cache.set(key, fn()); return cache.get(key); }

export function woodTexture(base = '#e2bd86') {
  return memo('wood' + base, () => {
    const [c, g] = cnv(512, 512);
    g.fillStyle = base; g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 90; i++) {
      const y = rnd() * 512, a = 0.05 + rnd() * 0.12;
      g.strokeStyle = `rgba(120,70,30,${a})`;
      g.lineWidth = 0.6 + rnd() * 2.2;
      g.beginPath();
      const f = 0.004 + rnd() * 0.01, ph = rnd() * 6, amp = 2 + rnd() * 7;
      for (let x = 0; x <= 512; x += 8) {
        const yy = y + Math.sin(x * f + ph) * amp + Math.sin(x * f * 3.1 + ph) * amp * 0.3;
        x ? g.lineTo(x, yy) : g.moveTo(x, yy);
      }
      g.stroke();
    }
    for (let i = 0; i < 4; i++) {
      const x = rnd() * 512, y = rnd() * 512;
      for (let r = 2; r < 14; r += 3) {
        g.strokeStyle = 'rgba(110,60,25,0.12)'; g.lineWidth = 1.2;
        g.beginPath(); g.ellipse(x, y, r * 2.4, r * 0.8, 0, 0, Math.PI * 2); g.stroke();
      }
    }
    return tex(c);
  });
}

export function floorTexture() {
  return memo('floor', () => {
    const [c, g] = cnv(1024, 1024);
    const rows = 8, rh = 1024 / rows;
    const tones = ['#c9935c', '#c48a52', '#d29d66', '#bd8550', '#cf9a61', '#c79058'];
    for (let r = 0; r < rows; r++) {
      let x = -rnd() * 400;
      while (x < 1024) {
        const w = 280 + rnd() * 420;
        g.fillStyle = tones[Math.floor(rnd() * tones.length)];
        g.fillRect(x, r * rh, w, rh);
        for (let i = 0; i < 14; i++) {
          g.strokeStyle = `rgba(90,50,20,${0.05 + rnd() * 0.1})`;
          g.lineWidth = 0.8 + rnd() * 1.6;
          const y = r * rh + rnd() * rh;
          g.beginPath(); g.moveTo(x, y);
          g.bezierCurveTo(x + w * 0.3, y + (rnd() - 0.5) * 10, x + w * 0.6, y + (rnd() - 0.5) * 10, x + w, y + (rnd() - 0.5) * 6);
          g.stroke();
        }
        g.fillStyle = 'rgba(60,30,10,0.55)'; g.fillRect(x, r * rh, 3, rh);
        x += w;
      }
      g.fillStyle = 'rgba(60,30,10,0.5)'; g.fillRect(0, r * rh, 1024, 3);
    }
    return tex(c, 4, 3.4);
  });
}

export function wallpaperTexture(base = '#cfe8f7', dot = '#ffffff') {
  return memo('wall' + base, () => {
    const [c, g] = cnv(512, 512);
    g.fillStyle = base; g.fillRect(0, 0, 512, 512);
    const star = (x, y, r, col) => {
      g.fillStyle = col; g.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r;
        g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      }
      g.fill();
    };
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      const x = i * 128 + (j % 2) * 64 + 32, y = j * 128 + 40;
      star(x, y, 13, 'rgba(255,255,255,0.75)');
      g.fillStyle = 'rgba(255,220,120,0.55)';
      g.beginPath(); g.arc(x + 50, y + 55, 5, 0, Math.PI * 2); g.fill();
      g.fillStyle = dot; g.globalAlpha = 0.5;
      g.beginPath(); g.arc(x - 30, y + 70, 3, 0, Math.PI * 2); g.fill();
      g.globalAlpha = 1;
    }
    return tex(c, 9, 5);
  });
}

// a soft round rug: cream centre, gentle pastel border, scattered little stars
export function rugTexture() {
  return memo('rug', () => {
    const [c, g] = cnv(1024, 1024);
    const ring = (r, col) => { g.fillStyle = col; g.beginPath(); g.arc(512, 512, r, 0, Math.PI * 2); g.fill(); };
    ring(512, '#f2c6cf'); ring(470, '#fbe7d9'); ring(452, '#cfe6f2'); ring(420, '#f7efe3');
    // scalloped trim
    g.fillStyle = '#f2c6cf';
    for (let i = 0; i < 48; i++) { const a = i / 48 * Math.PI * 2; g.beginPath(); g.arc(512 + Math.cos(a) * 470, 512 + Math.sin(a) * 470, 22, 0, Math.PI * 2); g.fill(); }
    ring(452, '#cfe6f2'); ring(420, '#f7efe3');
    const star = (x, y, r, col) => {
      g.fillStyle = col; g.beginPath();
      for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
      g.fill();
    };
    const cols = ['#f6c97a', '#f2b3c2', '#a9d3ec', '#b9e3c6'];
    for (let i = 0; i < 46; i++) {
      const a = rnd() * Math.PI * 2, d = 60 + rnd() * 330;
      star(512 + Math.cos(a) * d, 512 + Math.sin(a) * d, 9 + rnd() * 9, cols[i % cols.length]);
    }
    // woolly texture
    const img = g.getImageData(0, 0, 1024, 1024), px = img.data;
    for (let i = 0; i < px.length; i += 4) { const n = (rnd() - 0.5) * 18; px[i] += n; px[i + 1] += n; px[i + 2] += n; }
    g.putImageData(img, 0, 0);
    const tx = tex(c); tx.wrapS = tx.wrapT = THREE.ClampToEdgeWrapping;
    return tx;
  });
}

export function blanketTexture() {
  return memo('blanket', () => {
    const [c, g] = cnv(512, 512);
    const cols = ['#ffd6e0', '#c1e7ff', '#fff1b6', '#d4f5d0', '#e9d5ff', '#ffe0c2'];
    const n = 4, s = 512 / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      g.fillStyle = cols[(i * 3 + j * 2) % cols.length]; g.fillRect(i * s, j * s, s, s);
      g.strokeStyle = 'rgba(255,255,255,0.9)'; g.setLineDash([8, 6]); g.lineWidth = 3;
      g.strokeRect(i * s + 8, j * s + 8, s - 16, s - 16);
      g.setLineDash([]);
      if ((i + j) % 2 === 0) {
        g.fillStyle = 'rgba(255,255,255,0.7)';
        g.beginPath(); g.arc(i * s + s / 2, j * s + s / 2, 18, 0, Math.PI * 2); g.fill();
      }
    }
    return tex(c, 2, 3);
  });
}

export function skyTexture() {
  return memo('sky', () => {
    const [c, g] = cnv(512, 512);
    const gr = g.createLinearGradient(0, 0, 0, 512);
    gr.addColorStop(0, '#5fb6ff'); gr.addColorStop(0.7, '#bfe6ff'); gr.addColorStop(1, '#e9fbff');
    g.fillStyle = gr; g.fillRect(0, 0, 512, 512);
    const sun = g.createRadialGradient(380, 110, 10, 380, 110, 140);
    sun.addColorStop(0, 'rgba(255,250,210,1)'); sun.addColorStop(0.25, 'rgba(255,240,180,0.7)'); sun.addColorStop(1, 'rgba(255,240,180,0)');
    g.fillStyle = sun; g.fillRect(0, 0, 512, 512);
    g.fillStyle = 'rgba(255,255,255,0.95)';
    const cloud = (x, y, s) => { for (let i = 0; i < 6; i++) { g.beginPath(); g.ellipse(x + i * s * 0.32, y + Math.sin(i * 1.7) * s * 0.1, s * 0.36, s * 0.24, 0, 0, Math.PI * 2); g.fill(); } };
    cloud(60, 160, 120); cloud(250, 300, 90); cloud(40, 380, 70);
    // distant hills + tree
    g.fillStyle = '#8fd694'; g.beginPath(); g.moveTo(0, 470); g.quadraticCurveTo(160, 380, 330, 455); g.quadraticCurveTo(420, 420, 512, 440); g.lineTo(512, 512); g.lineTo(0, 512); g.fill();
    g.fillStyle = '#6cc070'; g.beginPath(); g.arc(430, 400, 36, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#8b5a2b'; g.fillRect(424, 420, 12, 40);
    return tex(c);
  });
}

export function posterTexture(kind) {
  return memo('poster' + kind, () => {
    const [c, g] = cnv(512, 512);
    if (kind === 'rocket') {
      g.fillStyle = '#23305e'; g.fillRect(0, 0, 512, 512);
      for (let i = 0; i < 70; i++) { g.fillStyle = `rgba(255,255,255,${0.4 + rnd() * 0.6})`; g.beginPath(); g.arc(rnd() * 512, rnd() * 512, rnd() * 2.4 + 0.5, 0, 7); g.fill(); }
      g.fillStyle = '#ffcf5c'; g.beginPath(); g.arc(400, 110, 50, 0, 7); g.fill();
      g.save(); g.translate(240, 280); g.rotate(-0.5);
      g.fillStyle = '#ff6b6b'; g.beginPath(); g.moveTo(0, -150); g.quadraticCurveTo(60, -80, 50, 60); g.lineTo(-50, 60); g.quadraticCurveTo(-60, -80, 0, -150); g.fill();
      g.fillStyle = '#e8eef9'; g.beginPath(); g.arc(0, -40, 26, 0, 7); g.fill();
      g.fillStyle = '#4cc9f0'; g.beginPath(); g.arc(0, -40, 18, 0, 7); g.fill();
      g.fillStyle = '#ffd166'; g.beginPath(); g.moveTo(-50, 60); g.lineTo(-90, 110); g.lineTo(-40, 90); g.fill(); g.beginPath(); g.moveTo(50, 60); g.lineTo(90, 110); g.lineTo(40, 90); g.fill();
      g.fillStyle = '#ff9f1c'; g.beginPath(); g.moveTo(-30, 70); g.quadraticCurveTo(0, 190, 30, 70); g.fill();
      g.restore();
    } else if (kind === 'rainbow') {
      g.fillStyle = '#fff8ec'; g.fillRect(0, 0, 512, 512);
      const cols = ['#ff6b6b', '#ff9f43', '#ffd23f', '#3ccf7a', '#4c8dff', '#9b6bff'];
      cols.forEach((col, i) => { g.strokeStyle = col; g.lineWidth = 30; g.beginPath(); g.arc(256, 390, 220 - i * 30, Math.PI, 0); g.stroke(); });
      g.fillStyle = '#ffffff';
      [[70, 390], [440, 390]].forEach(([x, y]) => { for (let i = 0; i < 4; i++) { g.beginPath(); g.arc(x - 40 + i * 26, y + (i % 2) * -10, 30, 0, 7); g.fill(); } });
    } else {
      g.fillStyle = '#fff3d6'; g.fillRect(0, 0, 512, 512);
      const L = ['A', 'B', 'C', '1', '2', '3'], cols = ['#ff6b6b', '#4c8dff', '#3ccf7a', '#ff9f43', '#9b6bff', '#ff77b7'];
      g.font = 'bold 120px "Fredoka", "Comic Sans MS", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      L.forEach((ch, i) => { g.fillStyle = cols[i]; g.fillText(ch, 100 + (i % 3) * 156, 150 + Math.floor(i / 3) * 210); });
    }
    g.strokeStyle = '#ffffff'; g.lineWidth = 18; g.strokeRect(0, 0, 512, 512);
    const t = tex(c); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t;
  });
}

// look: '' (each material's own), 'stripes', 'galaxy' or 'smiley' — only paint, the physics stay the material's
export function marbleTexture(color, kind, look = '') {
  return memo('marble' + color + kind + look, () => {
    const [c, g] = cnv(256, 128);
    const base = new THREE.Color(color);
    if (look === 'stripes') {
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, 256, 128);
      g.fillStyle = '#' + base.getHexString();
      for (let i = -2; i < 10; i++) { g.beginPath(); g.moveTo(i * 32, 0); g.lineTo(i * 32 + 16, 0); g.lineTo(i * 32 + 48, 128); g.lineTo(i * 32 + 32, 128); g.fill(); }
    } else if (look === 'galaxy') {
      const gr = g.createLinearGradient(0, 0, 256, 128); gr.addColorStop(0, '#1b1446'); gr.addColorStop(0.5, '#3a1f6b'); gr.addColorStop(1, '#0f2a5c');
      g.fillStyle = gr; g.fillRect(0, 0, 256, 128);
      g.fillStyle = 'rgba(255,170,240,0.35)'; for (let i = 0; i < 6; i++) { g.beginPath(); g.ellipse(rnd() * 256, rnd() * 128, 30, 10, rnd() * 3, 0, 7); g.fill(); }
      for (let i = 0; i < 90; i++) { g.fillStyle = `rgba(255,255,255,${0.4 + rnd() * 0.6})`; g.fillRect(rnd() * 256, rnd() * 128, 2, 2); }
    } else if (look === 'smiley') {
      g.fillStyle = '#ffd23f'; g.fillRect(0, 0, 256, 128);
      g.fillStyle = '#2b2d42';
      for (const x of [52, 180]) { g.beginPath(); g.arc(x - 12, 50, 7, 0, 7); g.arc(x + 12, 50, 7, 0, 7); g.fill(); g.lineWidth = 6; g.strokeStyle = '#2b2d42'; g.beginPath(); g.arc(x, 66, 22, 0.2, Math.PI - 0.2); g.stroke(); }
    } else if (kind === 'glass') {
      g.fillStyle = '#' + base.clone().lerp(new THREE.Color('#ffffff'), 0.35).getHexString(); g.fillRect(0, 0, 256, 128);
      for (let k = 0; k < 3; k++) {
        g.strokeStyle = k === 1 ? 'rgba(255,255,255,0.85)' : '#' + base.clone().multiplyScalar(0.7).getHexString();
        g.lineWidth = 12 - k * 3; g.beginPath();
        for (let x = 0; x <= 256; x += 4) { const y = 64 + Math.sin(x / 256 * Math.PI * 4 + k * 2) * 34; x ? g.lineTo(x, y) : g.moveTo(x, y); }
        g.stroke();
      }
    } else if (kind === 'wood') {
      g.drawImage(woodTexture('#d8ab6e').image, 0, 0, 256, 128);
      g.fillStyle = 'rgba(' + Math.round(base.r * 255) + ',' + Math.round(base.g * 255) + ',' + Math.round(base.b * 255) + ',0.25)'; g.fillRect(0, 0, 256, 128);
    } else if (kind === 'rubber') {
      g.fillStyle = '#' + base.getHexString(); g.fillRect(0, 0, 256, 128);
      g.fillStyle = '#ffffff'; g.fillRect(0, 54, 256, 20);
      g.fillStyle = '#' + base.clone().offsetHSL(0.4, 0, 0).getHexString(); g.fillRect(0, 60, 256, 8);
    } else if (kind === 'plastic') {
      g.fillStyle = '#' + base.clone().lerp(new THREE.Color('#ffffff'), 0.25).getHexString(); g.fillRect(0, 0, 256, 128);
      g.fillStyle = 'rgba(255,255,255,0.8)';
      for (let i = 0; i < 6; i++) { g.beginPath(); g.arc(20 + i * 44, 40 + (i % 2) * 48, 10, 0, 7); g.fill(); }
    } else {
      g.fillStyle = '#' + base.clone().lerp(new THREE.Color('#b08060'), 0.4).getHexString(); g.fillRect(0, 0, 256, 128);
      for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(0,0,0,${rnd() * 0.12})`; g.fillRect(rnd() * 256, rnd() * 128, 3, 3); }
    }
    const t = tex(c); return t;
  });
}

export function spiralTexture(colorA, colorB) {
  return memo('spiral' + colorA + colorB, () => {
    const [c, g] = cnv(512, 256);
    g.fillStyle = colorA; g.fillRect(0, 0, 512, 256);
    g.fillStyle = colorB;
    for (let i = -4; i < 12; i++) {
      g.beginPath(); g.moveTo(i * 64, 0); g.lineTo(i * 64 + 28, 0); g.lineTo(i * 64 + 28 + 128, 256); g.lineTo(i * 64 + 128, 256); g.fill();
    }
    const t = tex(c, 3, 1); return t;
  });
}

export function stripesTexture(cols) {
  return memo('stripes' + cols.join(), () => {
    const [c, g] = cnv(256, 256);
    cols.forEach((col, i) => { g.fillStyle = col; g.fillRect(0, i * 256 / cols.length, 256, 256 / cols.length + 1); });
    return tex(c);
  });
}

export function labelTexture(text, bg = '#ffffff', fg = '#333333', w = 256, h = 128, font = 72) {
  const [c, g] = cnv(w, h);
  if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, h); }
  g.fillStyle = fg; g.font = `bold ${font}px "Fredoka", "Segoe UI", sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 4);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// birch plywood face
export function plyTexture() {
  return memo('ply', () => {
    const [c, g] = cnv(256, 256);
    g.fillStyle = '#e9cf9f'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 40; i++) {
      g.strokeStyle = `rgba(150,100,50,${0.05 + rnd() * 0.08})`; g.lineWidth = 1 + rnd() * 2;
      const y = rnd() * 256; g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(80, y + (rnd() - 0.5) * 12, 170, y + (rnd() - 0.5) * 12, 256, y); g.stroke();
    }
    return tex(c);
  });
}
// laser-cut side plate: plywood with round and slot cut-outs (transparent), burnt edges
export function plyPlateTexture() {
  return memo('plyPlate', () => {
    const [c, g] = cnv(512, 128);
    g.drawImage(plyTexture().image, 0, 0, 512, 128);
    g.strokeStyle = 'rgba(90,50,20,0.55)'; g.lineWidth = 6; g.strokeRect(0, 0, 512, 128);
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 4; i++) {
      const x = 64 + i * 128;
      if (i % 2) { g.beginPath(); g.arc(x, 70, 24, 0, Math.PI * 2); g.fill(); }
      else { g.beginPath(); g.roundRect ? g.roundRect(x - 40, 52, 80, 36, 18) : g.rect(x - 40, 52, 80, 36); g.fill(); }
    }
    g.globalCompositeOperation = 'source-over';
    for (let i = 0; i < 4; i++) {
      const x = 64 + i * 128;
      g.strokeStyle = 'rgba(70,35,10,0.8)'; g.lineWidth = 3;
      g.beginPath();
      if (i % 2) g.arc(x, 70, 25, 0, Math.PI * 2); else if (g.roundRect) g.roundRect(x - 41, 51, 82, 38, 19); else g.rect(x - 41, 51, 82, 38);
      g.stroke();
    }
    const t = tex(c); t.wrapT = THREE.ClampToEdgeWrapping; return t;
  });
}
export function brickTexture(color) {
  return memo('brick' + color, () => {
    const [c, g] = cnv(256, 256);
    const base = new THREE.Color(color);
    g.fillStyle = '#efe6da'; g.fillRect(0, 0, 256, 256);
    for (let r = 0; r < 8; r++) for (let k = -1; k < 5; k++) {
      const x = k * 64 + (r % 2) * 32, y = r * 32;
      const f = 0.8 + rnd() * 0.3;
      g.fillStyle = '#' + base.clone().multiplyScalar(f).getHexString();
      g.fillRect(x + 3, y + 3, 58, 26);
    }
    return tex(c, 2, 1);
  });
}
export function dominoTexture(color) {
  return memo('domino' + color, () => {
    const [c, g] = cnv(64, 128);
    g.fillStyle = color; g.fillRect(0, 0, 64, 128);
    g.fillStyle = 'rgba(255,255,255,0.95)'; g.fillRect(4, 62, 56, 4);
    for (const [x, y] of [[20, 24], [44, 40], [32, 92], [20, 108], [44, 108]]) { g.beginPath(); g.arc(x, y, 6, 0, Math.PI * 2); g.fill(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  });
}
export function nightSkyTexture() {
  return memo('nightsky', () => {
    const [c, g] = cnv(512, 512);
    const gr = g.createLinearGradient(0, 0, 0, 512);
    gr.addColorStop(0, '#0b1240'); gr.addColorStop(0.75, '#26307a'); gr.addColorStop(1, '#3b3f8f');
    g.fillStyle = gr; g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 160; i++) { g.fillStyle = `rgba(255,255,255,${0.4 + rnd() * 0.6})`; g.beginPath(); g.arc(rnd() * 512, rnd() * 400, rnd() * 1.8 + 0.4, 0, Math.PI * 2); g.fill(); }
    const moon = g.createRadialGradient(370, 120, 10, 370, 120, 110);
    moon.addColorStop(0, 'rgba(255,250,220,0.9)'); moon.addColorStop(0.3, 'rgba(255,250,220,0.25)'); moon.addColorStop(1, 'rgba(255,250,220,0)');
    g.fillStyle = moon; g.fillRect(0, 0, 512, 512);
    g.fillStyle = '#fff8d6'; g.beginPath(); g.arc(370, 120, 34, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#1d2560'; g.beginPath(); g.moveTo(0, 470); g.quadraticCurveTo(160, 380, 330, 455); g.quadraticCurveTo(420, 420, 512, 440); g.lineTo(512, 512); g.lineTo(0, 512); g.fill();
    return tex(c);
  });
}
// glow-in-the-dark stars for the wallpaper (used as an emissive map at night)
export function wallStarsTexture() {
  return memo('wallstars', () => {
    const [c, g] = cnv(512, 512);
    g.fillStyle = '#000'; g.fillRect(0, 0, 512, 512);
    const star = (x, y, r) => {
      g.fillStyle = '#ffffff'; g.beginPath();
      for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
      g.fill();
    };
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      const x = i * 128 + (j % 2) * 64 + 32, y = j * 128 + 40;
      star(x, y, 13);
      g.beginPath(); g.arc(x + 50, y + 55, 5, 0, Math.PI * 2); g.fill();
    }
    return tex(c, 9, 5);
  });
}

// round badge with a short label (score counters, prediction end markers)
export function badgeTexture(text, bg = '#ff7a59', fg = '#ffffff') {
  return memo('badge' + text + bg + fg, () => {
    const [c, g] = cnv(128, 128);
    g.fillStyle = 'rgba(0,0,0,0.18)'; g.beginPath(); g.arc(64, 68, 52, 0, Math.PI * 2); g.fill();
    g.fillStyle = bg; g.beginPath(); g.arc(64, 62, 52, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#ffffff'; g.lineWidth = 9; g.stroke();
    g.fillStyle = fg; g.font = `bold ${text.length > 2 ? 44 : 60}px "Fredoka", "Segoe UI", sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 64, 65);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
}

export function blockTexture(letter, color) {
  return memo('block' + letter + color, () => {
    const [c, g] = cnv(128, 128);
    g.fillStyle = color; g.fillRect(0, 0, 128, 128);
    g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 8; g.strokeRect(10, 10, 108, 108);
    g.fillStyle = '#ffffff'; g.font = 'bold 76px "Fredoka", "Segoe UI", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(letter, 64, 70);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  });
}

// ---- the other rooms (kitchen, bathroom, garden, attic)
// one drawing, several repeats: each repeat gets its own texture over the same canvas
function repeated(key, rx, ry, draw) {
  const c = memo('canvas' + key, draw);
  return memo(key + '@' + rx + ',' + ry, () => tex(c, rx, ry));
}

// glazed square tiles with grout lines; the colours are laid out as a checkerboard
export function tilesTexture(cols = ['#ffffff'], grout = '#e3e7ea', n = 4, rx = 1, ry = 1) {
  return repeated('tiles' + cols.join() + grout + n, rx, ry, () => {
    const [c, g] = cnv(512, 512);
    const s = 512 / n;
    g.fillStyle = grout; g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const x = i * s + 3, y = j * s + 3, w = s - 6;
      g.fillStyle = shade(cols[(i + j) % cols.length], 0.96 + rnd() * 0.05); g.fillRect(x, y, w, w);
      // a soft glaze highlight across one corner
      const hl = g.createLinearGradient(x, y, x + w, y + w);
      hl.addColorStop(0, 'rgba(255,255,255,0.35)'); hl.addColorStop(0.45, 'rgba(255,255,255,0)');
      g.fillStyle = hl; g.fillRect(x, y, w, w);
    }
    return c;
  });
}

// gingham: two crossing sets of see-through bands, darker where they overlap
export function ginghamTexture(col = '#ff8fa3', n = 8, rx = 1, ry = 1) {
  return repeated('gingham' + col + n, rx, ry, () => {
    const [c, g] = cnv(256, 256);
    const s = 256 / n;
    g.fillStyle = '#fffaf4'; g.fillRect(0, 0, 256, 256);
    g.fillStyle = col; g.globalAlpha = 0.5;
    for (let i = 0; i < n; i += 2) { g.fillRect(i * s, 0, s, 256); g.fillRect(0, i * s, 256, s); }
    g.globalAlpha = 1;
    // woven threads
    g.strokeStyle = 'rgba(255,255,255,0.16)'; g.lineWidth = 1;
    for (let i = 0; i < 256; i += 4) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.stroke(); }
    return c;
  });
}

// lawn: soft mottling, lots of little blades and a few daisies
export function grassTexture(rx = 1, ry = 1) {
  return repeated('grass', rx, ry, () => {
    const [c, g] = cnv(512, 512);
    g.fillStyle = '#8fd17a'; g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 40; i++) {
      const x = rnd() * 512, y = rnd() * 512, r = 20 + rnd() * 50;
      g.fillStyle = rnd() < 0.5 ? 'rgba(110,185,90,0.3)' : 'rgba(175,228,135,0.3)';
      // drawn on every side of the seam so the tile repeats cleanly
      for (const dx of [-512, 0, 512]) for (const dy of [-512, 0, 512]) { g.beginPath(); g.arc(x + dx, y + dy, r, 0, Math.PI * 2); g.fill(); }
    }
    const blades = ['#6fbf5e', '#7fcb6a', '#9ad985', '#a9e08f', '#5fae52'];
    g.lineWidth = 2; g.lineCap = 'round';
    for (let i = 0; i < 2600; i++) {
      const x = rnd() * 512, y = rnd() * 512, l = 5 + rnd() * 9, a = -Math.PI / 2 + (rnd() - 0.5) * 0.9;
      g.strokeStyle = blades[i % blades.length];
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
    for (let i = 0; i < 14; i++) {
      const x = 20 + rnd() * 472, y = 20 + rnd() * 472;
      g.fillStyle = '#ffffff';
      for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; g.beginPath(); g.ellipse(x + Math.cos(a) * 4, y + Math.sin(a) * 4, 3.4, 1.8, a, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = '#ffd23f'; g.beginPath(); g.arc(x, y, 2.2, 0, Math.PI * 2); g.fill();
    }
    return c;
  });
}

// leafy noise for hedges and tree tops
export function leafTexture(base = '#5fb35a', rx = 1, ry = 1) {
  return repeated('leaf' + base, rx, ry, () => {
    const [c, g] = cnv(256, 256);
    g.fillStyle = base; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 420; i++) {
      g.fillStyle = shade(base, 0.75 + rnd() * 0.5);
      g.beginPath(); g.ellipse(rnd() * 256, rnd() * 256, 7 + rnd() * 5, 4 + rnd() * 3, rnd() * Math.PI, 0, Math.PI * 2); g.fill();
    }
    return c;
  });
}

// upright boards with dark seams and nail heads: one tile is about a metre (six boards)
export function planksTexture(base = '#dcb88a', rx = 1, ry = 1) {
  return repeated('planks' + base, rx, ry, () => {
    const [c, g] = cnv(512, 512);
    const n = 6, w = 512 / n;
    for (let i = 0; i < n; i++) {
      const x = i * w;
      g.fillStyle = shade(base, 0.88 + rnd() * 0.2); g.fillRect(x, 0, w, 512);
      for (let k = 0; k < 10; k++) {
        g.strokeStyle = `rgba(110,65,25,${0.05 + rnd() * 0.1})`; g.lineWidth = 0.8 + rnd() * 1.6;
        const gx = x + 6 + rnd() * (w - 12);
        g.beginPath(); g.moveTo(gx, 0); g.bezierCurveTo(gx + (rnd() - 0.5) * 12, 170, gx + (rnd() - 0.5) * 12, 340, gx, 512); g.stroke();
      }
      g.fillStyle = 'rgba(70,40,15,0.55)'; g.fillRect(x, 0, 3, 512);
      g.fillStyle = 'rgba(60,50,45,0.6)';
      for (const y of [44, 300]) for (const nx of [12, w - 12]) { g.beginPath(); g.arc(x + nx, y, 2.6, 0, Math.PI * 2); g.fill(); }
    }
    return c;
  });
}

// a moving box: fibres, packing tape down the middle and a marker label
export function cardboardTexture(label = '') {
  return memo('cardboard' + label, () => {
    const [c, g] = cnv(256, 256);
    g.fillStyle = '#d6a96c'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 600; i++) {
      g.fillStyle = rnd() < 0.5 ? `rgba(120,80,40,${0.06 + rnd() * 0.1})` : `rgba(240,210,160,${0.06 + rnd() * 0.1})`;
      g.fillRect(rnd() * 256, rnd() * 256, 1 + rnd() * 3, 1);
    }
    g.fillStyle = 'rgba(240,215,170,0.75)'; g.fillRect(104, 0, 48, 256);
    g.strokeStyle = 'rgba(120,80,40,0.35)'; g.lineWidth = 8; g.strokeRect(0, 0, 256, 256);
    if (label) {
      g.save(); g.translate(128, 196); g.rotate(-0.06);
      g.fillStyle = 'rgba(70,50,40,0.8)'; g.font = 'bold 42px "Fredoka", "Comic Sans MS", sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, 0, 0);
      g.restore();
    }
    const t = tex(c); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t;
  });
}

// the garden's sky dome: the top of the canvas is straight up, the middle is the horizon
export function skyDomeTexture(night = false) {
  return memo('skydome' + night, () => {
    const [c, g] = cnv(1024, 512);
    const gr = g.createLinearGradient(0, 0, 0, 512);
    if (night) { gr.addColorStop(0, '#070c2e'); gr.addColorStop(0.42, '#1d2a6b'); gr.addColorStop(0.5, '#3b4590'); gr.addColorStop(1, '#141a40'); }
    else { gr.addColorStop(0, '#4fa8f5'); gr.addColorStop(0.4, '#a9dcff'); gr.addColorStop(0.5, '#eef9ff'); gr.addColorStop(1, '#d2ecd2'); }
    g.fillStyle = gr; g.fillRect(0, 0, 1024, 512);
    if (night) {
      for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(255,255,255,${0.35 + rnd() * 0.65})`; g.beginPath(); g.arc(rnd() * 1024, rnd() * 240, rnd() * 1.6 + 0.4, 0, Math.PI * 2); g.fill(); }
      const moon = g.createRadialGradient(700, 150, 6, 700, 150, 90);
      moon.addColorStop(0, 'rgba(255,250,220,0.9)'); moon.addColorStop(0.3, 'rgba(255,250,220,0.25)'); moon.addColorStop(1, 'rgba(255,250,220,0)');
      g.fillStyle = moon; g.fillRect(560, 10, 280, 280);
      g.fillStyle = '#fff8d6'; g.beginPath(); g.arc(700, 150, 22, 0, Math.PI * 2); g.fill();
    } else {
      g.fillStyle = 'rgba(255,255,255,0.92)';
      for (let i = 0; i < 9; i++) {
        const x = rnd() * 1024, y = 130 + rnd() * 100, s = 50 + rnd() * 60;
        for (const dx of [-1024, 0, 1024]) for (let k = 0; k < 6; k++) {
          g.beginPath(); g.ellipse(x + dx + k * s * 0.32, y + Math.sin(k * 1.7) * s * 0.1, s * 0.36, s * 0.2, 0, 0, Math.PI * 2); g.fill();
        }
      }
    }
    const t = tex(c); t.wrapT = THREE.ClampToEdgeWrapping; return t;
  });
}
