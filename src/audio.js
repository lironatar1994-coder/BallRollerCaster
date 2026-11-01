// Synthesized sound (Web Audio): rolling per surface, clacks, instruments and background music.

// rolling voices: each surface family has its own filtered-noise "rumble"
const ROLL = {
  wood:    { f: 520, q: 0.9, k: 300 },
  plastic: { f: 900, q: 1.3, k: 450 },
  glass:   { f: 1700, q: 3.0, k: 700 },
  metal:   { f: 2600, q: 7.0, k: 900 },
  floor:   { f: 330, q: 0.8, k: 160 },
  soft:    { f: 170, q: 0.7, k: 60 },
};
export const ROLL_FAMILY = { wood: 'wood', plastic: 'plastic', glass: 'glass', metal: 'metal', floor: 'floor', wall: 'floor', soft: 'soft', boing: 'soft', bumper: 'plastic', bell: 'metal' };

export class Sound {
  constructor() {
    this.ctx = null; this.on = true; this.last = 0; this.budget = 0;
    this.music = null; this.musicOn = false; this.night = false;
  }
  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      const ctx = this.ctx = new AC();
      this.master = ctx.createGain(); this.master.gain.value = 0.8;
      const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
      this.master.connect(comp); comp.connect(ctx.destination);
      const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
      let b = 0;
      for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b = 0.97 * b + 0.03 * w; d[i] = w * 0.6 + b * 2; }
      this.noise = buf;
      this.voices = {};
      for (const [k, p] of Object.entries(ROLL)) {
        const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = p.q; bp.frequency.value = p.f;
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3500;
        const g = ctx.createGain(); g.gain.value = 0;
        src.connect(bp); bp.connect(lp); lp.connect(g); g.connect(this.master);
        src.start(0, Math.random() * 1.5);
        this.voices[k] = { bp, g, p };
      }
      this.music = new Music(ctx, this.master);
      if (this.musicOn) this.music.start(this.night);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return true;
  }
  setOn(v) { this.on = v; if (this.master) this.master.gain.value = v ? 0.8 : 0; }
  setMusic(v) { this.musicOn = v; if (!this.music) return; if (v) this.music.start(this.night); else this.music.stop(); }
  setNight(v) { this.night = v; if (this.music && this.musicOn) { this.music.stop(); this.music.start(v); } }
  ok() { return this.ctx && this.on && this.ctx.state === 'running'; }
  // levels: { family: { level, speed } }
  rolling(levels) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const [k, v] of Object.entries(this.voices)) {
      const L = levels[k];
      v.g.gain.setTargetAtTime(this.on && L ? Math.min(0.45, L.level) : 0, t, 0.06);
      if (L) v.bp.frequency.setTargetAtTime(v.p.f + L.speed * v.p.k, t, 0.08);
    }
  }
  tone(freq, dur, type = 'sine', vol = 0.3, when = 0, slide = 0, dest) {
    const ctx = this.ctx, t = ctx.currentTime + when;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest || this.master); o.start(t); o.stop(t + dur + 0.02);
  }
  burst(freq, q, dur, vol, when = 0) {
    const ctx = this.ctx, t = ctx.currentTime + when;
    const s = ctx.createBufferSource(); s.buffer = this.noise; s.playbackRate.value = 1 + Math.random() * 0.2;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t, Math.random()); s.stop(t + dur + 0.02);
  }
  // throttled impact sound; v = impact speed (m/s)
  impact(v, kind, ball, dist = 1) {
    if (!this.ok()) return;
    const now = performance.now();
    if (now - this.last > 50) { this.budget = 6; this.last = now; }
    if (this.budget-- <= 0) return;
    const vol = Math.min(0.5, v * 0.35) / (1 + dist * dist * 0.6);
    if (vol < 0.01) return;
    const bk = ball || 'glass';
    if (kind === 'boing') { this.tone(180 + Math.random() * 40, 0.35, 'sine', vol * 1.4, 0, 2.6); return; }
    if (kind === 'soft') { this.burst(220, 1.2, 0.08, vol * 0.8); return; }
    if (kind === 'bell' || kind === 'bumper') return; // they have their own voices
    const pitchBall = { glass: 1.6, wood: 0.8, rubber: 0.5, plastic: 1.2, clay: 0.35 }[bk] || 1;
    const base = { wood: 1100, plastic: 1500, glass: 2600, floor: 700, wall: 600, metal: 2200 }[kind] || 1000;
    const f = base * pitchBall * (0.9 + Math.random() * 0.2);
    if (bk === 'clay') { this.burst(300, 1, 0.06, vol); return; }
    this.burst(f, 3, 0.05, vol * 0.9);
    if (bk === 'glass' || kind === 'glass' || kind === 'metal') this.tone(f * 1.9, 0.12, 'sine', vol * 0.35);
    else this.tone(f * 0.6, 0.05, 'triangle', vol * 0.4);
  }
  clack(v) {
    if (!this.ok()) return;
    this.tone(2400 + Math.random() * 600, 0.07, 'sine', Math.min(0.25, v * 0.2));
    this.burst(3000, 4, 0.03, Math.min(0.2, v * 0.2));
  }
  note(k) {
    if (!this.ok()) return;
    const scale = [523.25, 587.33, 659.25, 698.46, 783.99, 880.0, 987.77, 1046.5];
    const f = scale[k % 8];
    this.tone(f, 0.9, 'sine', 0.28); this.tone(f * 4, 0.15, 'sine', 0.06); this.tone(f * 2.76, 0.3, 'sine', 0.05);
  }
  bell(size = 1, v = 1) {
    if (!this.ok()) return;
    const f = 1320 / size, vol = Math.min(0.3, 0.1 + v * 0.1);
    [[1, 1, 2.2], [2.76, 0.5, 1.4], [5.4, 0.25, 0.8], [8.93, 0.12, 0.5]].forEach(([m, a, d]) => this.tone(f * m, d, 'sine', vol * a));
  }
  bumper() { if (!this.ok()) return; this.tone(320, 0.18, 'square', 0.08, 0, 2.2); this.tone(880, 0.12, 'sine', 0.15, 0.02, 1.4); }
  domino(i) { if (!this.ok()) return; this.burst(2600 + i * 90, 6, 0.03, 0.18); this.tone(1400 + i * 60, 0.04, 'triangle', 0.06); }
  thunk(v) { if (!this.ok()) return; this.burst(420, 2, 0.08, Math.min(0.3, v * 0.06)); this.tone(160, 0.1, 'sine', Math.min(0.25, v * 0.05)); }
  goal() {
    if (!this.ok()) return;
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.25, 'triangle', 0.22, i * 0.07));
    this.tone(1568, 0.5, 'sine', 0.12, 0.3);
  }
  fanfare() {
    if (!this.ok()) return;
    [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.35, 'triangle', 0.2, i * 0.11));
  }
  star(i) { if (!this.ok()) return; this.tone(880 * Math.pow(1.26, i), 0.4, 'sine', 0.25); this.tone(1760 * Math.pow(1.26, i), 0.2, 'sine', 0.08); }
  shutter() { if (!this.ok()) return; this.burst(4000, 1, 0.05, 0.3); this.burst(2000, 1, 0.08, 0.2, 0.06); }
  place() { if (!this.ok()) return; this.tone(520, 0.12, 'sine', 0.3, 0, 0.55); this.burst(1800, 2, 0.03, 0.15); }
  remove() { if (!this.ok()) return; this.tone(420, 0.2, 'triangle', 0.18, 0, 0.4); }
  click() { if (!this.ok()) return; this.tone(1200, 0.04, 'sine', 0.12); }
  error() { if (!this.ok()) return; this.tone(180, 0.18, 'square', 0.08); }
  release() { if (!this.ok()) return; this.tone(700, 0.1, 'sine', 0.2, 0, 1.6); this.burst(2400, 3, 0.04, 0.12); }
  switchFlip() { if (!this.ok()) return; this.burst(3500, 6, 0.025, 0.12); this.tone(1800, 0.03, 'square', 0.03); }
  lift() { if (!this.ok()) return; this.burst(900, 5, 0.04, 0.1); }
}

// gentle generative background music: day = bright marimba, night = slow music box
const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);
class Music {
  constructor(ctx, dest) {
    this.ctx = ctx;
    this.out = ctx.createGain(); this.out.gain.value = 0.13; this.out.connect(dest);
    this.timer = null; this.step = 0; this.next = 0; this.mel = 72;
  }
  start(night) {
    this.stop();
    this.night = night;
    this.bpm = night ? 66 : 96;
    // chord roots (MIDI) and their notes
    this.prog = night ? [[57, [57, 60, 64]], [53, [53, 57, 60]], [48, [48, 52, 55]], [55, [55, 59, 62]]] : [[48, [48, 52, 55]], [55, [55, 59, 62]], [57, [57, 60, 64]], [53, [53, 57, 60]]];
    this.step = 0; this.next = this.ctx.currentTime + 0.1;
    this.timer = setInterval(() => this.tick(), 30);
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
  voice(freq, t, dur, vol, kind) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = kind === 'bass' ? 'triangle' : 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + (kind === 'pad' ? 0.25 : 0.006)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.out); o.start(t); o.stop(t + dur + 0.05);
    if (kind === 'mel') { // a bright overtone makes it sound like a marimba / music box
      const o2 = ctx.createOscillator(), g2 = ctx.createGain();
      o2.frequency.value = freq * (this.night ? 2 : 3.98);
      g2.gain.setValueAtTime(vol * 0.25, t); g2.gain.exponentialRampToValueAtTime(0.0001, t + dur * 0.35);
      o2.connect(g2); g2.connect(this.out); o2.start(t); o2.stop(t + dur);
    }
  }
  tick() {
    const ctx = this.ctx, spb = 60 / this.bpm / 2; // eighth notes
    while (this.next < ctx.currentTime + 0.15) {
      const t = this.next, s = this.step % 8, bar = Math.floor(this.step / 8) % this.prog.length;
      const [root, chord] = this.prog[bar];
      if (s === 0) for (const n of chord) this.voice(NOTE(n + 12), t, spb * 8, 0.05, 'pad');
      if (!this.night && (s === 0 || s === 4)) this.voice(NOTE(root - 12), t, spb * 2.5, 0.22, 'bass');
      if (this.night && s === 0) this.voice(NOTE(root - 12), t, spb * 6, 0.16, 'bass');
      const p = this.night ? [0.9, 0, 0.3, 0, 0.6, 0, 0.3, 0.1][s] : [1, 0.2, 0.6, 0.15, 0.9, 0.3, 0.6, 0.35][s];
      if (Math.random() < p) {
        // wander through the chord tones and the pentatonic scale
        const pool = [0, 2, 4, 7, 9, 12, 14, 16].map(x => 60 + x).concat(chord.map(n => n + 12), chord.map(n => n + 24));
        const near = pool.filter(n => Math.abs(n - this.mel) <= 5);
        this.mel = near[Math.floor(Math.random() * near.length)] || 72;
        this.voice(NOTE(this.mel), t, this.night ? 1.4 : 0.5, this.night ? 0.14 : 0.12, 'mel');
      }
      this.next += spb; this.step++;
    }
  }
}
