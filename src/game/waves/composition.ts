// Wave composition table — the hand-tuned roster for each of the 10
// waves in a cycle. The same composition repeats across cycles (waves
// 11-20 = waves 1-10 with all enemies at level 2, etc.); only the
// per-enemy LEVEL changes from cycle to cycle.
//
// Lookup: `wave N` → `WAVE_COMPOSITIONS[(N - 1) % 10]`.
//
// Boss waves (wave % 10 === 0) carry `boss: true`. The roster row's
// non-boss counts become the boss's escort. The boss itself is resolved
// via `./bosses.ts` from the current cycle.
//
// Counts were back-tuned against the player-DPS / wave-duration sanity
// check in `balance.ts`'s plan doc — totals scale gradually across the
// 10-wave arc so each cycle has the same shape: warm-up swarms → mixed
// pressure → boss climax.

import type { EnemyKind } from '../enemies/enemySystem';

// One row of the composition table. Counts are non-negative integers.
// `boss` is true on row 10 (wave 10 of a cycle); the wave manager
// spawns ONE boss in addition to the per-kind counts shown here.
export interface WaveSpec {
  swarm: number;
  gunner: number;
  sniper: number;
  rusher: number;
  splitter: number;
  boss: boolean;
}

export const WAVE_COMPOSITIONS: readonly WaveSpec[] = [
  // W1: pure warm-up — small swarm group only.
  { swarm: 4, gunner: 0, sniper: 0, rusher: 0, splitter: 0, boss: false },
  // W2: more swarms — player learns to manage volume.
  { swarm: 7, gunner: 0, sniper: 0, rusher: 0, splitter: 0, boss: false },
  // W3: first gunner — player needs a turret by now.
  { swarm: 6, gunner: 1, sniper: 0, rusher: 0, splitter: 0, boss: false },
  // W4: gunner pressure ramps.
  { swarm: 5, gunner: 2, sniper: 0, rusher: 0, splitter: 0, boss: false },
  // W5: first sniper — forces cover usage.
  { swarm: 4, gunner: 2, sniper: 1, rusher: 0, splitter: 0, boss: false },
  // W6: mid-cycle peak of "standard" pressure.
  { swarm: 6, gunner: 3, sniper: 1, rusher: 0, splitter: 0, boss: false },
  // W7: first rusher — punishes naked low-HP players.
  { swarm: 5, gunner: 3, sniper: 2, rusher: 1, splitter: 0, boss: false },
  // W8: big mixed wave — last "normal" wave before splitter intro.
  { swarm: 7, gunner: 4, sniper: 2, rusher: 2, splitter: 0, boss: false },
  // W9: splitter intro — preview of boss-tier durability + post-death swarms.
  { swarm: 6, gunner: 4, sniper: 3, rusher: 1, splitter: 1, boss: false },
  // W10: boss wave — light escort to give the boss runway.
  { swarm: 2, gunner: 0, sniper: 0, rusher: 0, splitter: 0, boss: true },
];

// Resolves a wave number (1-indexed) to the cycle index (1-indexed).
// Cycle 1 = waves 1-10, cycle 2 = waves 11-20, etc. Past the campaign
// cap (50), the cycle keeps incrementing — `levelForWave` in balance.ts
// clamps the per-enemy level at MAX_ENTITY_LEVEL, so continue-mode
// cycles cycle through compositions with capped-level enemies.
export function compositionForWave(wave: number): WaveSpec {
  const idx = ((Math.max(1, wave) - 1) % WAVE_COMPOSITIONS.length);
  return WAVE_COMPOSITIONS[idx];
}

// Flattens a WaveSpec into an explicit list of enemy kinds. Boss isn't
// included here — the wave manager appends it via `./bosses.ts` so the
// boss's resolved kind (and any future escort spawns) live in one place.
export function rosterFromSpec(spec: WaveSpec): EnemyKind[] {
  const out: EnemyKind[] = [];
  for (let i = 0; i < spec.swarm; i++) out.push('swarm');
  for (let i = 0; i < spec.gunner; i++) out.push('gunner');
  for (let i = 0; i < spec.sniper; i++) out.push('sniper');
  for (let i = 0; i < spec.rusher; i++) out.push('rusher');
  for (let i = 0; i < spec.splitter; i++) out.push('splitter');
  return out;
}
