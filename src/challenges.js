// Challenge missions. Each one sets up the room, then scores 0–3 stars from what happened.
// C (tracked by main.js): { goals: [{ ride, pieceId, loop, teddy, tramp, air }], dominoes, maxNotes, maxLifts, teddy }
// n = number of pieces the player placed.
const best = (arr, f) => arr.reduce((m, g) => Math.max(m, f(g)), 0);
const lockedBasketOnBed = { id: 9001, type: 'basket', port: { x: 1.295, y: 0.3395, z: -0.385, psi: Math.PI, phi: 0 }, slope: 0.05236, style: 'channel', color: 'pink', opts: { height: 0 }, locked: true };
const lockedDominoes = { id: 9002, type: 'dominoes', port: { x: 0.63, y: 0, z: -0.875, psi: Math.PI, phi: 0 }, slope: 0.05236, style: 'channel', color: 'wood', opts: { count: 10 }, locked: true };

export const CHALLENGES = [
  {
    id: 'first', icon: '🎯', title: 'First Goal', goal: 'Get a ball into a Goal Cup.',
    stars: ['Score a goal', '10 pieces or fewer', '6 pieces or fewer'],
    score: (C, n) => C.goals.length ? 1 + (n <= 10) + (n <= 6) : 0,
  },
  {
    id: 'bed', icon: '🛏️', title: 'Delivery to Bed', goal: 'Get a ball into the basket on the bed.',
    stars: ['Basket!', '12 pieces or fewer', '8 pieces or fewer'],
    setup: () => [lockedBasketOnBed],
    score: (C, n) => C.goals.some(g => g.pieceId === 9001) ? 1 + (n <= 12) + (n <= 8) : 0,
  },
  {
    id: 'loop', icon: '🌀', title: 'Loop-the-Loop', goal: 'Send a ball upside-down through a loop, then score.',
    stars: ['Through the loop and score', '12 pieces or fewer', 'Goal within 6 s'],
    score: (C, n) => { const gs = C.goals.filter(g => g.loop); return gs.length ? 1 + (n <= 12) + gs.some(g => g.ride <= 6) : 0; },
  },
  {
    id: 'long', icon: '⏳', title: 'Longest Ride', goal: 'Make one ball ride as long as possible before it scores.',
    stars: ['10 s ride', '20 s ride', '30 s ride'],
    score: (C) => { const t = best(C.goals, g => g.ride); return (t >= 10) + (t >= 20) + (t >= 30); },
    progress: (C) => ['Best ride: {0} s', best(C.goals, g => g.ride).toFixed(1)],
  },
  {
    id: 'air', icon: '🚀', title: 'Big Air', goal: 'Launch a ball through the air and catch it in a goal.',
    stars: ['0.3 s in the air', '0.5 s in the air', '0.7 s in the air'],
    score: (C) => { const a = best(C.goals, g => g.air); return (a >= 0.3) + (a >= 0.5) + (a >= 0.7); },
    progress: (C) => ['Best flight into a goal: {0} s', best(C.goals, g => g.air).toFixed(2)],
  },
  {
    id: 'teddy', icon: '🧸', title: 'Over the Teddy', goal: 'Fly a ball right over the teddy bear on the bed.',
    stars: ['Fly over Teddy', 'Then score a goal', '10 pieces or fewer'],
    score: (C, n) => C.teddy ? 1 + C.goals.some(g => g.teddy) + (n <= 10) : 0,
  },
  {
    id: 'domino', icon: '🁢', title: 'Domino Effect', goal: 'Knock down every domino.',
    stars: ['All dominoes down', '10 pieces or fewer', '6 pieces or fewer'],
    setup: () => [lockedDominoes],
    score: (C, n) => C.dominoes ? 1 + (n <= 10) + (n <= 6) : 0,
  },
  {
    id: 'music', icon: '🎵', title: 'Music Maker', goal: 'Play as many xylophone notes as you can with ONE ball.',
    stars: ['8 notes', '16 notes', '24 notes'],
    score: (C) => (C.maxNotes >= 8) + (C.maxNotes >= 16) + (C.maxNotes >= 24),
    progress: (C) => ['Most notes by one ball: {0}', C.maxNotes],
  },
  {
    id: 'forever', icon: '♾️', title: 'Forever Machine', goal: 'Build a loop where one ball rides a lift again and again.',
    stars: ['2 lift rides', '3 lift rides', '5 lift rides'],
    score: (C) => (C.maxLifts >= 2) + (C.maxLifts >= 3) + (C.maxLifts >= 5),
    progress: (C) => ['Most lift rides by one ball: {0}', C.maxLifts],
  },
  {
    id: 'moon', icon: '🌙', title: 'Moon Bounce', goal: 'On the Moon, bounce a ball off a trampoline into a goal.', gravity: 1.62,
    stars: ['Bounce into a goal', '10 pieces or fewer', '6 pieces or fewer'],
    score: (C, n) => C.goals.some(g => g.tramp) ? 1 + (n <= 10) + (n <= 6) : 0,
  },
  {
    id: 'critic', icon: '🧸', title: "Critics' Choice", goal: 'Make the Toy Critics happy: a fun ride that is not too dizzy.',
    stars: ['Fun 6+', 'Fun 7.5+', 'Fun 9+ and Dizzy under 5'],
    score: (C) => { const b = C.best; return b ? (b.fun >= 6) + (b.fun >= 7.5) + (b.fun >= 9 && b.dizzy < 5) : 0; },
    progress: (C) => ['Best fun so far: {0}', C.best ? C.best.fun.toFixed(1) : '—'],
  },
  {
    id: 'parts', icon: '📦', title: 'Parts Box', goal: 'Score using only the pieces in the box.',
    parts: { start: 1, straight: 4, curveL: 2, curveR: 2, helixL: 1, cup: 1 },
    stars: ['Score a goal', 'Ride 6 s or longer', 'Ride 9 s or longer'],
    score: (C) => { const t = best(C.goals, g => g.ride); return C.goals.length ? 1 + (t >= 6) + (t >= 9) : 0; },
    progress: (C) => ['Best ride: {0} s', best(C.goals, g => g.ride).toFixed(1)],
  },
  // ---- kitchen
  {
    id: 'k-marathon', room: 'kitchen', icon: '🍳', title: 'Kitchen Marathon', goal: 'A long ride across the kitchen that ends in a goal.',
    stars: ['8 s ride into a goal', '15 s ride', '12 pieces or fewer'],
    score: (C, n) => { const t = best(C.goals, g => g.ride); return t >= 8 ? 1 + (t >= 15) + (n <= 12) : 0; },
    progress: (C) => ['Best ride: {0} s', best(C.goals, g => g.ride).toFixed(1)],
  },
  {
    id: 'k-gadgets', room: 'kitchen', icon: '⚙️', title: 'Gadget Show', goal: 'One ball meets 3 different gadgets (bell, xylophone, brake, booster, sensor…) and scores.',
    stars: ['3 gadgets + goal', '5 gadgets + goal', '14 pieces or fewer'],
    score: (C, n) => { const g = best(C.goals, x => x.gadgets || 0); return g >= 3 ? 1 + (g >= 5) + (n <= 14) : 0; },
    progress: (C) => ['Most gadgets in one scoring ride: {0}', best(C.goals, x => x.gadgets || 0)],
  },
  {
    id: 'k-box', room: 'kitchen', icon: '📦', title: 'Lunch Box', goal: 'Score with only the pieces in the lunch box.',
    parts: { start: 1, straight: 3, curveL: 2, curveR: 2, booster: 1, brake: 1, cup: 1 },
    stars: ['Score a goal', 'Ride 5 s or longer', 'Ride 8 s or longer'],
    score: (C) => { const t = best(C.goals, g => g.ride); return C.goals.length ? 1 + (t >= 5) + (t >= 8) : 0; },
  },
  // ---- bathroom
  {
    id: 'b-splash', room: 'bath', icon: '🛁', title: 'Splash Down', goal: 'Splash a ball into the water.',
    stars: ['Splash!', 'Splash after a 6 s ride', '8 pieces or fewer'],
    score: (C, n) => C.splashes.length ? 1 + C.splashes.some(s => s.ride >= 6) + (n <= 8) : 0,
  },
  {
    id: 'b-photo', room: 'bath', icon: '📸', title: 'Say Cheese!', goal: 'Photograph the same ball with Photo Booths.',
    stars: ['1 photo', '2 photos of one ball', '3 photos of one ball'],
    score: (C) => (C.maxPhotos >= 1) + (C.maxPhotos >= 2) + (C.maxPhotos >= 3),
    progress: (C) => ['Most photos of one ball: {0}', C.maxPhotos],
  },
  {
    id: 'b-critic', room: 'bath', icon: '🫧', title: 'Bubble Bath Critics', goal: 'Get a great rating from the Toy Critics.',
    stars: ['Fun 6+', 'Fun 8+', 'Fun 9+'],
    score: (C) => { const b = C.best; return b ? (b.fun >= 6) + (b.fun >= 8) + (b.fun >= 9) : 0; },
    progress: (C) => ['Best fun so far: {0}', C.best ? C.best.fun.toFixed(1) : '—'],
  },
  // ---- garden
  {
    id: 'g-pond', room: 'garden', icon: '🌊', title: 'Pond Plunge', goal: 'Fly a ball through the air and splash into the water.',
    stars: ['Splash!', '0.3 s in the air first', '10 pieces or fewer'],
    score: (C, n) => C.splashes.length ? 1 + C.splashes.some(s => s.air >= 0.3) + (n <= 10) : 0,
  },
  {
    id: 'g-race', room: 'garden', icon: '🏁', title: 'Garden Race', goal: 'Build two towers and race them (🔁 ▸ Race): both balls must score.',
    stars: ['A race with 2 goals', 'Photo finish: under 1 s apart', '16 pieces or fewer'],
    score: (C, n) => C.race && C.race.goals >= 2 ? 1 + (C.race.gap !== null && C.race.gap < 1) + (n <= 16) : 0,
  },
  {
    id: 'g-marathon', room: 'garden', icon: '🌻', title: 'Garden Marathon', goal: 'Make one ball ride for a long time before it scores.',
    stars: ['15 s ride', '25 s ride', '40 s ride'],
    score: (C) => { const t = best(C.goals, g => g.ride); return (t >= 15) + (t >= 25) + (t >= 40); },
    progress: (C) => ['Best ride: {0} s', best(C.goals, g => g.ride).toFixed(1)],
  },
  // ---- attic
  {
    id: 'a-machine', room: 'attic', icon: '♾️', title: 'Attic Machine', goal: 'Lifts, screws or elevators carry one ball up again and again.',
    stars: ['2 rides up', '4 rides up', '6 rides up'],
    score: (C) => (C.maxLifts >= 2) + (C.maxLifts >= 4) + (C.maxLifts >= 6),
    progress: (C) => ['Most rides up by one ball: {0}', C.maxLifts],
  },
  {
    id: 'a-lights', room: 'attic', icon: '💡', title: 'Night Lights', goal: 'At night (🌙), a Sensor set to 💡 Lights flashes and the ball scores.',
    stars: ['Lights at night', 'Then score a goal', '10 pieces or fewer'],
    score: (C, n) => C.lights ? 1 + (C.goals.length > 0) + (n <= 10) : 0,
  },
  {
    id: 'a-critic', room: 'attic', icon: '🏅', title: 'Masterpiece', goal: 'The best ride you can build: lots of fun, not too wild.',
    stars: ['Fun 7.5+', 'Fun 9+', 'Fun 9.5+ and Thrill 4–7'],
    score: (C) => { const b = C.best; return b ? (b.fun >= 7.5) + (b.fun >= 9) + (b.fun >= 9.5 && b.thrill >= 4 && b.thrill <= 7) : 0; },
    progress: (C) => ['Best fun so far: {0}', C.best ? C.best.fun.toFixed(1) : '—'],
  },
];

// stars needed before a room's missions open up (building there is always allowed)
export const ROOM_UNLOCK = { kids: 0, kitchen: 3, bath: 6, garden: 10, attic: 14 };

// one puzzle a day, the same for everyone: a basket somewhere in the kid's room and a piece budget
const SPOTS = [
  { x: 1.295, y: 0.3395, z: -0.385, psi: Math.PI }, { x: 0.45, y: 0.0084, z: 0.95, psi: 0 }, { x: -0.95, y: 0.0084, z: 0.75, psi: 0.6 },
  { x: 1.05, y: 0.0084, z: 0.55, psi: -0.4 }, { x: 0.42, y: 0.3015, z: -1.239, psi: 0 }, { x: -1.42, y: 0.455, z: -0.1, psi: 1.57 },
];
export function dailyChallenge(day = new Date()) {
  const key = day.toISOString().slice(0, 10);
  let h = 2166136261;
  for (const c of key) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  const spot = SPOTS[h % SPOTS.length], limit = 5 + (h >> 8) % 5;
  const basket = { id: 9101, type: 'basket', port: { ...spot, phi: 0 }, slope: 0.05236, style: 'channel', color: 'purple', opts: { height: 0 }, locked: true };
  return {
    id: 'daily-' + key, daily: true, icon: '📅', title: 'Daily Puzzle', goal: ['Get a ball into today’s basket. Fewer pieces = more stars.'],
    stars: ['Basket!', ['{0} pieces or fewer', limit + 4], ['{0} pieces or fewer', limit]],
    setup: () => [basket],
    score: (C, n) => C.goals.some(g => g.pieceId === 9101) ? 1 + (n <= limit + 4) + (n <= limit) : 0,
  };
}
