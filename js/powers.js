// Power-ups, shared by the race screen and the phones.
// Marbles grab one by rolling through a vape pickup; the power is picked at
// random, weighted by race position (the further back, the nastier the power).
// A marble holds one power at a time: grabbing a new one replaces it.

export const POWERS = {
  turbo:      { name: 'Turbo',          icon: '🚀', color: '#ff7a1a', desc: 'Huge burst of speed' },
  ghost:      { name: 'Ghost',          icon: '👻', color: '#c9d6ff', desc: 'Pass through marbles and pegs for 3s' },
  magnet:     { name: 'Magnet',         icon: '🧲', color: '#ff3355', desc: 'Get dragged toward the marble ahead' },
  shield:     { name: 'Shield',         icon: '🛡️', color: '#3de1ff', desc: 'Blocks the next attack and slow patches' },
  sandbomb:   { name: 'Sand Bomb',      icon: '💣', color: '#e3b56b', desc: 'Dump a slow patch on the track behind you' },
  bonk:       { name: 'Bonk',           icon: '🥊', color: '#ff5a5a', desc: 'Knock the marble ahead into the wall' },
  freeze:     { name: 'Freeze',         icon: '🧊', color: '#7fd8ff', desc: 'Freezes the race leader for 2s' },
  swap:       { name: 'Swap',           icon: '🔄', color: '#b06bff', desc: 'Trade places with a random marble ahead' },
  scramble:   { name: 'Steer Scramble', icon: '🌀', color: '#5cff9d', desc: "Flips everyone else's tilt steering for 5s" },
  earthquake: { name: 'Earthquake',     icon: '🌋', color: '#ffb000', desc: 'Shakes up every other marble' },
};

// weight of each power for a marble at race position p (0 = leader, 1 = last)
export function powerWeights(p, tilt) {
  return {
    turbo: 1 + 2 * p,
    ghost: 1,
    magnet: 0.5 + 1.5 * p,
    shield: 1.6 - 1.1 * p,
    sandbomb: 1.6 - 1.1 * p,
    bonk: 0.5 + 1.5 * p,
    freeze: 0.3 + 1.7 * p,
    swap: 3 * p * p,
    scramble: tilt ? 0.5 + p : 0,
    earthquake: 0.3 + 0.9 * p,
  };
}

export function rollPower(p, tilt, rand = Math.random) {
  const w = powerWeights(p, tilt);
  let total = 0; for (const k in w) total += w[k];
  let x = rand() * total;
  for (const k in w) { x -= w[k]; if (x <= 0) return k; }
  return 'turbo';
}
