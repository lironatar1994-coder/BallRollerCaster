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
];
