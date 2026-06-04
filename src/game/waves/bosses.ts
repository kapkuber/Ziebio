// Boss registry — one entry per cycle (1..5). The wave manager calls
// `bossForCycle(cycle)` on every wave 10/20/30/40/50 to resolve which
// boss to spawn.
//
// PLACEHOLDER: each cycle currently spawns a scaled splitter as its
// boss. The cycle-by-cycle entries below are deliberate seams — when
// real bosses are designed, swap one entry at a time without touching
// the wave manager or composition table.
//
// Continue-mode (wave > 50) reuses cycle 5's boss; cycle 1's intro boss
// is never repeated.

import type { EnemyKind } from '../enemies/enemySystem';

export interface BossDef {
  // Enemy kind the boss is spawned as. For now every cycle uses
  // 'splitter' (the toughest standard enemy + on-death swarm
  // punishment). Future bosses can introduce a dedicated boss kind by
  // registering it in EnemyKind + ENEMY_DEFS first, then pointing this
  // field at the new key.
  kind: EnemyKind;
  // Bonus levels added to the cycle level when computing the boss's
  // tier. 0 = boss matches cycle level; +1 = boss is one tier above the
  // current cycle's standard enemies. Result is clamped to
  // MAX_ENTITY_LEVEL by the wave manager.
  //
  // Reasoning: a wave-10 boss in cycle 1 fighting alongside L1 enemies
  // would feel anticlimactic at L1. +1 keeps the boss "the most
  // dangerous thing in the wave" without breaking the per-cycle tier
  // curve.
  levelBonus: number;
}

// Five unique boss slots. All point to the splitter placeholder for
// now; replace entries as unique bosses are designed.
export const BOSS_REGISTRY: Record<1 | 2 | 3 | 4 | 5, BossDef> = {
  1: { kind: 'splitter', levelBonus: 1 },
  2: { kind: 'splitter', levelBonus: 1 },
  3: { kind: 'splitter', levelBonus: 1 },
  4: { kind: 'splitter', levelBonus: 1 },
  5: { kind: 'splitter', levelBonus: 1 },
};

// Resolves the boss for the given cycle. Cycles past 5 (continue mode)
// loop back to cycle 5's boss so the player always faces SOMETHING at
// wave 60, 70, etc.
export function bossForCycle(cycle: number): BossDef {
  const clamped = Math.max(1, Math.min(5, cycle)) as 1 | 2 | 3 | 4 | 5;
  return BOSS_REGISTRY[clamped];
}
