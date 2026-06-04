// Balance + progression math. Pure functions and frozen tables — no
// mutable state, no runtime side-effects. Every level-scaling formula and
// every hand-tuned cost table the rest of the game reads lives here so a
// single retune touches one file.
//
// Type-only imports from enemies / buildings keep this module at the
// BOTTOM of the dependency tree at runtime; downstream modules (enemy
// scaling wrapper, building cost lookups, wave manager) import from here
// without creating a cycle.
//
// Design notes:
//   - Stat scaling is FORMULAIC (one growth exponent per quantity). One
//     constant tunes the whole curve.
//   - Wave composition + boss roster live in `./waves/` — hand-tuned tables
//     belong with the wave system, not here.
//   - Building upgrade costs and core upgrade costs are hand-tuned
//     economy levers (not derivable from a clean formula without making
//     late levels feel like a tax), so they live here as readonly tables.
//   - The player power curve from L1 → L45 is shallow (~1.46× HP,
//     ~4× DPS at maxed builds). Enemy/building growth exponents below
//     are deliberately gentler than typical RPG curves so a maxed L5
//     enemy doesn't outpace a maxed player.
//
// Per CLAUDE.md: io-style arena game, multiplayer-ready core systems.
// All formulas here are server-derivable from `wave` + `kind` — no client
// state needed, so this module ports directly to a server snapshot world.

import type { EnemyKind } from './enemies/enemySystem';
import type { BuildingKind } from './buildings/buildingSystem';
import { TOTAL_XP_AT_LEVEL, MAX_LEVEL as MAX_PLAYER_LEVEL } from './stats';

// === Campaign structure ===
// 50 waves arranged as 5 cycles × 10 waves. The 10-row composition table
// (in ./waves/composition.ts) repeats across cycles; only the per-enemy
// LEVEL changes. Wave 10/20/30/40/50 are boss waves.
export const MAX_ENTITY_LEVEL = 5;
export const WAVES_PER_CYCLE = 10;
export const CAMPAIGN_WAVE_COUNT = MAX_ENTITY_LEVEL * WAVES_PER_CYCLE;

// === Stat-scaling growth exponents ===
// Per-level multiplier: `value(L) = base × GROWTH^(L-1)`. L1 = base; L5 caps.
//
// Calibrated against the player's actual progression curve (see plan
// document for the full math). Damage growth deliberately lower than HP
// growth — late-game player damage scales faster than late-game player HP,
// so enemies need disproportionate HP to feel tougher without 1-shotting
// the player.
export const ENEMY_HP_GROWTH = 1.4;          // L5 = 3.84× base HP
export const ENEMY_DAMAGE_GROWTH = 1.18;     // L5 = 1.94× base damage
export const BUILDING_HP_GROWTH = 1.4;       // L5 = 3.84×
export const BUILDING_BODY_DAMAGE_GROWTH = 1.18; // L5 = 1.94×
export const BUILDING_OUTPUT_GROWTH = 1.3;   // L5 = 2.86× — turret bullets, flux gen rate
export const BUILDING_PLACEMENT_GROWTH = 1.45; // L5 = 4.42× — placement cost

// XP per kill grows per level so killing tougher enemies feels
// proportionally rewarding. Tracks damage growth (1.18) plus a small
// bonus so per-kill XP doesn't trail behind enemy HP growth.
export const ENEMY_XP_GROWTH = 1.25;         // L5 = 2.44×

// Continue-mode (wave > 50): levels stay capped at L5, but per-row enemy
// counts scale up by this factor per cycle past the cap.
export const CONTINUE_COUNT_GROWTH_PER_CYCLE = 0.25;

// === Scaling primitives ===
// Single helper so any growth formula reads the same way everywhere.
// `level` is 1-indexed; level 1 returns `base` exactly.
function scaledByLevel(base: number, growth: number, level: number): number {
  return base * Math.pow(growth, Math.max(0, level - 1));
}

export function scaleEnemyHp(base: number, level: number): number {
  return scaledByLevel(base, ENEMY_HP_GROWTH, level);
}
export function scaleEnemyDamage(base: number, level: number): number {
  return scaledByLevel(base, ENEMY_DAMAGE_GROWTH, level);
}
export function scaleBuildingHp(base: number, level: number): number {
  return scaledByLevel(base, BUILDING_HP_GROWTH, level);
}
export function scaleBuildingBodyDamage(base: number, level: number): number {
  return scaledByLevel(base, BUILDING_BODY_DAMAGE_GROWTH, level);
}
export function scaleBuildingOutput(base: number, level: number): number {
  return scaledByLevel(base, BUILDING_OUTPUT_GROWTH, level);
}
export function scaleBuildingPlacementCost(base: number, level: number): number {
  return scaledByLevel(base, BUILDING_PLACEMENT_GROWTH, level);
}

// === Building upgrade costs ===
// Decoupled from placement cost because a kind can be free to PLACE at L1
// (e.g. the flux generator) but should still cost flux to UPGRADE — the
// upgrade is a pure power gain, not a deployment. Per-kind tuned because
// upgrade value differs sharply (turret L→L+1 doubles DPS; wall L→L+1
// just adds HP).
//
// Index k = cost to upgrade FROM level k+1 (i.e. `BUILDING_UPGRADE_COSTS.wall[0]`
// is the L1 → L2 cost). Array length 4 covers the 4 possible upgrades.
export const BUILDING_UPGRADE_COSTS: Record<BuildingKind, readonly [number, number, number, number]> = {
  wall:             [40, 80, 160, 320],
  turret:           [300, 600, 1200, 2400],
  'flux-generator': [200, 400, 800, 1600],
};

// Returns the flux cost to upgrade a building of `kind` from `fromLevel`
// to `fromLevel + 1`. Returns Infinity if `fromLevel` is already at cap.
export function buildingUpgradeCost(kind: BuildingKind, fromLevel: number): number {
  if (fromLevel < 1 || fromLevel >= MAX_ENTITY_LEVEL) return Infinity;
  return BUILDING_UPGRADE_COSTS[kind][fromLevel - 1];
}

// === Building placement costs ===
// L1 base prices. Flux gen is free-at-L1 by design (early-game economy
// bootstrap; see plan). Turret was a no-cost dev experiment; treat 0 as
// "single source of truth lives here from now on" — old constants like
// WALL_FLUX_COST etc. stay defined inside their kind modules for
// back-compat but should be considered deprecated as price sources.
//
// Higher-tier placement scales by BUILDING_PLACEMENT_GROWTH (1.45^(L-1)),
// so building straight at the current core-unlocked tier is more expensive
// than placing L1 and upgrading later. The upgrade path is the
// flux-efficient route; instant-place-at-tier is for "just need it now".
export const BUILDING_PLACEMENT_BASE_COST: Record<BuildingKind, number> = {
  wall: 10,
  turret: 0,
  'flux-generator': 0,
};

export function buildingPlacementCost(kind: BuildingKind, level: number): number {
  const base = BUILDING_PLACEMENT_BASE_COST[kind];
  if (base === 0) return 0; // free kinds stay free at every tier
  return Math.round(scaleBuildingPlacementCost(base, level));
}

// === Sell refund ===
// 50% of total flux invested. "Total invested" = the L1 placement cost
// + every upgrade cost paid to reach `currentLevel`. Free-at-L1 kinds
// have a placement contribution of 0, so an L1 flux gen sells for 0; an
// L2 flux gen sells for 50% of its single upgrade cost.
//
// Half-refund is the classic RTS lever: rewards investment, discourages
// rebuild-spam, and leaves room for tuning (lower → more permanence,
// higher → more flexibility). Tune via REFUND_FRACTION below.
export const REFUND_FRACTION = 0.5;

export function buildingSellValue(kind: BuildingKind, currentLevel: number): number {
  const lvl = Math.max(1, Math.min(MAX_ENTITY_LEVEL, currentLevel));
  let invested = buildingPlacementCost(kind, 1);
  for (let from = 1; from < lvl; from++) {
    invested += buildingUpgradeCost(kind, from);
  }
  return Math.floor(invested * REFUND_FRACTION);
}

// === Core upgrade costs ===
// Index = target level. `CORE_UPGRADE_COSTS[2]` is the L1 → L2 cost.
// Indices 0 and 1 are unused (the core starts at L1; you can't upgrade
// "to L1" or "to L0"). Calibrated so 8 L1 flux generators (free to place,
// 2 flux/s each) earn the L1 → L2 cost in ~9 waves at 120 s/wave.
export const CORE_UPGRADE_COSTS: readonly number[] = [
  0,       // L0 (unused)
  0,       // L1 (start state, no cost to "be at" L1)
  15_000,  // L1 → L2
  30_000,  // L2 → L3
  55_000,  // L3 → L4
  90_000,  // L4 → L5
];

// Cost in flux to upgrade the core FROM `fromLevel` to `fromLevel + 1`.
// Returns Infinity at cap so callers can compare ≤ flux without an
// explicit "is at cap" branch.
export function coreUpgradeCost(fromLevel: number): number {
  const target = fromLevel + 1;
  if (target < 2 || target > MAX_ENTITY_LEVEL) return Infinity;
  return CORE_UPGRADE_COSTS[target];
}

// === Wave / cycle helpers ===
// Wave numbers are 1-indexed. Cycle 1 = waves 1-10, cycle 2 = 11-20, ...
// cycle 5 = 41-50. Past wave 50 (continue mode), cycle keeps incrementing
// but `levelForWave` clamps at MAX_ENTITY_LEVEL.

export function cycleForWave(wave: number): number {
  return Math.max(1, Math.ceil(wave / WAVES_PER_CYCLE));
}

// Enemy level for the given wave. Same number as cycle, clamped to the
// 5-level cap. This is the value passed into `createEnemy({ level })` and
// the scaling formulas above.
export function levelForWave(wave: number): number {
  return Math.min(MAX_ENTITY_LEVEL, cycleForWave(wave));
}

// True at wave 10, 20, 30, 40, 50, and every 10th wave in continue mode.
export function isBossWave(wave: number): boolean {
  return wave > 0 && wave % WAVES_PER_CYCLE === 0;
}

// True only for wave 50 itself — the campaign climax that triggers the
// victory screen. Continue-mode waves past 50 are NOT victory waves.
export function isCampaignVictoryWave(wave: number): boolean {
  return wave === CAMPAIGN_WAVE_COUNT;
}

// Count multiplier applied to wave-composition rows once continue mode
// engages (wave > 50). Stays at 1× for waves 1-50 so the campaign matches
// the hand-tuned composition table exactly.
//   wave 51-60 → 1.25×, 61-70 → 1.50×, etc.
export function countMultiplierForWave(wave: number): number {
  if (wave <= CAMPAIGN_WAVE_COUNT) return 1;
  const cyclesPastCap = cycleForWave(wave) - MAX_ENTITY_LEVEL;
  return 1 + CONTINUE_COUNT_GROWTH_PER_CYCLE * cyclesPastCap;
}

// === Player XP targets ===
// Used by the wave manager + the XP-budget sanity check during balance
// tuning. `targetPlayerLevelForWave` is the EXPECTED player level at the
// END of wave N, assuming the player kills enough of the wave roster to
// hit budget. Real progression varies; this is the calibration anchor.

export function targetPlayerLevelForWave(wave: number): number {
  if (wave <= 0) return 1;
  // Linear curve: roughly L9 by wave 9, L45 (cap) by wave ~49.
  return Math.max(1, Math.min(MAX_PLAYER_LEVEL, Math.round(1 + 0.9 * wave)));
}

// Cumulative XP needed to BE at the given player level.
function totalXpAtPlayerLevel(level: number): number {
  const clamped = Math.max(1, Math.min(MAX_PLAYER_LEVEL, Math.floor(level)));
  return TOTAL_XP_AT_LEVEL[clamped - 1];
}

// XP the wave's enemy roster should award in total to land the player on
// `targetPlayerLevelForWave(wave)` cumulatively. Used both as a sanity
// check at tuning time and as the budget the per-kind XP table is back-
// solved against.
export function xpBudgetForWave(wave: number): number {
  if (wave <= 0) return 0;
  const here = totalXpAtPlayerLevel(targetPlayerLevelForWave(wave));
  const prev = totalXpAtPlayerLevel(targetPlayerLevelForWave(wave - 1));
  return Math.max(0, here - prev);
}

// === Per-enemy XP yield ===
// Boss isn't an EnemyKind today (bosses live in their own registry) but
// they appear in the XP ledger, so this union covers both. Base values
// are the L1 yield; per-kill XP scales by `ENEMY_XP_GROWTH^(L-1)`.
//
// Calibration: weighted-sum of waves 1-9 against the cumulative XP
// budget for `targetPlayerLevelForWave(9)` (= 211 XP). The values below
// produce ~243 raw XP across waves 1-9, leaving ~15% headroom for the
// reality that a player won't kill 100% of every wave's roster.
export type XpYieldKind = EnemyKind | 'boss';

export const XP_PER_ENEMY: Record<XpYieldKind, number> = {
  swarm: 2,
  rusher: 3,
  gunner: 4,
  sniper: 5,
  splitter: 10,
  boss: 40,
};

// XP awarded for killing one enemy of (kind, level). Scaling matches the
// damage / HP curve so killing a tougher enemy pays out proportionally.
export function xpForEnemyKill(kind: XpYieldKind, level: number): number {
  const base = XP_PER_ENEMY[kind] ?? 0;
  return Math.round(scaledByLevel(base, ENEMY_XP_GROWTH, level));
}
