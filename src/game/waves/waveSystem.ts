// Wave system. Drives the 50-wave campaign + continue mode.
//
// Lifecycle per wave:
//   prep (60 s timer)  →  active (spawns drip in)  →  cleared  →  next prep
// The whole loop is driven by `updateWaveSystem(state, ctx)` called once
// per frame. State is a plain object held in a ref by the parent.
//
// Pacing knobs (PREP_DURATION, SPAWN_INTERVAL) live here. Composition
// (which kinds, how many) lives in ./composition.ts. Per-level scaling
// lives in ../balance.ts. The manager is the conductor — every other
// module owns its own concern.
//
// Wave 50 special-cases: clearing it sets `victoryPending = true`
// rather than auto-advancing. The parent reads that flag, shows a
// victory overlay, and calls `chooseContinue()` or initiates a restart.

import {
  CAMPAIGN_WAVE_COUNT,
  MAX_ENTITY_LEVEL,
  countMultiplierForWave,
  cycleForWave,
  isCampaignVictoryWave,
  levelForWave,
} from '../balance';
import { createEnemy, type Enemy, type EnemyKind } from '../enemies/enemySystem';
import type { Vec2 } from '../entities';
import { bossForCycle } from './bosses';
import { compositionForWave, rosterFromSpec } from './composition';

// === Pacing constants ===

// Prep phase duration in seconds. User-locked at 60 s (skippable via
// Space for dev / fast pacing — the manager just zeroes the timer).
export const PREP_DURATION = 60;

// Seconds between drip spawns within the active phase. Picked so a 15-
// enemy wave fully spawns in ~22 s, leaving the player most of their
// active phase to actually fight and kill rather than waiting for more.
export const SPAWN_INTERVAL = 1.5;

// Initial cooldown when entering the active phase. Gives the player a
// beat to brace before the first enemy appears, instead of a spawn
// landing on the same frame the prep timer hits zero.
export const FIRST_SPAWN_DELAY = 1.5;

// Distance from the tank to spawn new enemies at. ~1100 px puts them
// just outside the lvl-1 camera FOV; they walk in from off-screen which
// feels like a wave INVADING, not teleporting onto the player.
export const SPAWN_DIST = 1100;

// === Types ===

export type WavePhase = 'prep' | 'active' | 'cleared' | 'idle';

export interface PendingSpawn {
  kind: EnemyKind;
  level: number;
}

export interface WaveState {
  // Has the campaign begun? False until the player places their first
  // core — there's nothing to defend before that, so wave 1's prep
  // timer is gated on core placement.
  started: boolean;
  waveNumber: number;     // 1-indexed campaign progress (wave 1 = first)
  phase: WavePhase;
  // Counts down in `prep`. `idle` and `cleared` are transient one-frame
  // phases (cleared → next prep happens in the same update tick); their
  // timers are unused.
  phaseTimer: number;
  // Drained left-to-right in `active`. Empty → the wave is "fully
  // spawned" but not necessarily complete (existing enemies still need
  // to die).
  spawnQueue: PendingSpawn[];
  spawnCooldown: number;
  // Set on the wave-50 clear. The parent should render its victory
  // overlay and call `chooseContinue()` or trigger a restart.
  victoryPending: boolean;
  // True once the player picks Continue past the wave-50 cap. Past this
  // point the manager keeps advancing waves but per-row counts scale up
  // (`countMultiplierForWave`) while levels stay capped at L5.
  continueMode: boolean;
}

// Context the manager needs per-frame. The parent supplies the live
// enemy list (so the manager can push spawns + observe clears), an id
// allocator, the tank's world position (for spawn anchoring), and the
// map bounds (so spawns stay inside the world).
export interface WaveUpdateContext {
  dt: number;
  enemies: Enemy[];
  nextEnemyIdRef: { current: number };
  tankPos: Vec2;
  mapWidth: number;
  mapHeight: number;
  // True only when the player has a live core to defend and isn't dead.
  // The manager pauses (no timer decrement, no spawning) when false.
  active: boolean;
}

// === Factory ===

export function createWaveState(): WaveState {
  return {
    started: false,
    waveNumber: 0,           // pre-game; first beginCampaign() sets to 1
    phase: 'idle',
    phaseTimer: 0,
    spawnQueue: [],
    spawnCooldown: 0,
    victoryPending: false,
    continueMode: false,
  };
}

// Begins the campaign. Call this once when the player places their
// first core. Subsequent calls are no-ops so repeated core placement
// doesn't restart waves.
export function beginCampaign(state: WaveState): void {
  if (state.started) return;
  state.started = true;
  state.waveNumber = 1;
  state.phase = 'prep';
  state.phaseTimer = PREP_DURATION;
}

// Skip the prep timer (Space hotkey). No-op outside prep. Triggers an
// immediate transition to active on the next update tick.
export function skipPrep(state: WaveState): void {
  if (state.phase === 'prep') state.phaseTimer = 0;
}

// Player chose Continue from the victory screen. Clears the pending
// flag, sets continueMode, and advances to wave 51's prep.
export function chooseContinue(state: WaveState): void {
  if (!state.victoryPending) return;
  state.victoryPending = false;
  state.continueMode = true;
  enterPrep(state, state.waveNumber + 1);
}

// === Helpers ===

function enterPrep(state: WaveState, waveNumber: number): void {
  state.waveNumber = waveNumber;
  state.phase = 'prep';
  state.phaseTimer = PREP_DURATION;
  state.spawnQueue = [];
  state.spawnCooldown = 0;
}

// Builds the spawn queue for `waveNumber` from the composition table +
// boss registry. Boss is appended LAST so the escort walks in first and
// the boss arrives as the climax (mirroring the wave-10 row's pacing).
//
// Level for each entry comes from `levelForWave` (cycle level, clamped
// at MAX_ENTITY_LEVEL). Boss gets a per-cycle bonus on top.
function buildSpawnQueue(waveNumber: number): PendingSpawn[] {
  const spec = compositionForWave(waveNumber);
  const cycleLevel = levelForWave(waveNumber);
  const cycle = cycleForWave(waveNumber);
  // In continue mode (wave > 50), per-row counts scale up.
  const countMult = countMultiplierForWave(waveNumber);
  const baseRoster = rosterFromSpec(spec);
  const queue: PendingSpawn[] = [];
  for (const kind of baseRoster) {
    queue.push({ kind, level: cycleLevel });
  }
  // Apply count multiplier by duplicating entries. Floor keeps the
  // first cycle past cap at exactly the table values.
  if (countMult > 1) {
    const extras = baseRoster.flatMap((kind) => {
      const dup = Math.floor((countMult - 1) * 100) / 100; // 0.25 → 0.25
      return Math.random() < dup ? [{ kind, level: cycleLevel }] : [];
    });
    queue.push(...extras);
  }
  if (spec.boss) {
    const boss = bossForCycle(cycle);
    const bossLevel = Math.min(MAX_ENTITY_LEVEL, cycleLevel + boss.levelBonus);
    queue.push({ kind: boss.kind, level: bossLevel });
  }
  return queue;
}

// Picks a spawn point ~SPAWN_DIST from the tank at a random angle,
// clamped inside the map. Multiple attempts handle the rare case where
// the tank is near a map corner and the random angle would place the
// spawn out of bounds.
function pickSpawnPoint(
  tankPos: Vec2,
  mapWidth: number,
  mapHeight: number,
): Vec2 {
  const MARGIN = 80;
  for (let i = 0; i < 12; i++) {
    const angle = Math.random() * Math.PI * 2;
    const x = tankPos.x + Math.cos(angle) * SPAWN_DIST;
    const y = tankPos.y + Math.sin(angle) * SPAWN_DIST;
    if (x >= MARGIN && x <= mapWidth - MARGIN &&
        y >= MARGIN && y <= mapHeight - MARGIN) {
      return { x, y };
    }
  }
  // Fallback — clamp to map even if it lands close to the tank.
  return {
    x: Math.max(MARGIN, Math.min(mapWidth - MARGIN, tankPos.x + SPAWN_DIST)),
    y: Math.max(MARGIN, Math.min(mapHeight - MARGIN, tankPos.y)),
  };
}

// True iff a wave is fully spawned AND all spawned enemies are dead.
// "Spawned and dead" is the cleanest signal we can read without
// tracking per-wave enemy IDs — dev-spawn hotkeys briefly inflate the
// list, but the wave manager treats that as "still in active" and
// waits for the player to clean up. Acceptable trade-off.
function isWaveCleared(state: WaveState, enemies: Enemy[]): boolean {
  if (state.spawnQueue.length > 0) return false;
  return enemies.every((e) => e.hp <= 0);
}

// === Main update ===
// Called once per frame from the parent's render loop.
export function updateWaveSystem(state: WaveState, ctx: WaveUpdateContext): void {
  // Pause on game-over / pre-core. Timers freeze, spawns stop.
  if (!ctx.active || !state.started) return;
  // Victory holds: no further spawns / advancement until the parent
  // resolves the dialog by calling chooseContinue() or restarting.
  if (state.victoryPending) return;

  if (state.phase === 'prep') {
    state.phaseTimer -= ctx.dt;
    if (state.phaseTimer <= 0) {
      // Transition prep → active. Build queue from the wave's row.
      state.phase = 'active';
      state.phaseTimer = 0;
      state.spawnQueue = buildSpawnQueue(state.waveNumber);
      state.spawnCooldown = FIRST_SPAWN_DELAY;
    }
    return;
  }

  if (state.phase === 'active') {
    // Drip spawns. When the queue empties the wave continues "active"
    // until every spawned enemy is dead — only then do we advance.
    if (state.spawnQueue.length > 0) {
      state.spawnCooldown -= ctx.dt;
      if (state.spawnCooldown <= 0) {
        const next = state.spawnQueue.shift()!;
        const pos = pickSpawnPoint(ctx.tankPos, ctx.mapWidth, ctx.mapHeight);
        ctx.enemies.push(createEnemy(
          ctx.nextEnemyIdRef.current++,
          next.kind,
          pos,
          { level: next.level },
        ));
        state.spawnCooldown = SPAWN_INTERVAL;
      }
    }
    if (isWaveCleared(state, ctx.enemies)) {
      // Wave 50 clear → hold for victory dialog. Otherwise drop a
      // single-frame `cleared` marker (the parent can listen for it if
      // it wants to play a clear effect) then enter the next prep.
      if (isCampaignVictoryWave(state.waveNumber)) {
        state.phase = 'cleared';
        state.victoryPending = true;
        return;
      }
      state.phase = 'cleared';
    }
    return;
  }

  if (state.phase === 'cleared') {
    // Immediate transition to the next prep. The single-frame `cleared`
    // phase exists so observers can detect the boundary; if you don't
    // need that signal, collapsing this into the prior block is safe.
    enterPrep(state, state.waveNumber + 1);
    return;
  }
}

// === Read helpers for HUD ===
// Pure derivations the HUD can call without poking around the state.

export function waveProgressLabel(state: WaveState): string {
  if (!state.started) return '—';
  const cap = CAMPAIGN_WAVE_COUNT;
  if (state.continueMode) return `Wave ${state.waveNumber} · Endless`;
  return `Wave ${state.waveNumber}/${cap}`;
}

export function prepRemainingSeconds(state: WaveState): number | null {
  if (state.phase !== 'prep') return null;
  return Math.max(0, Math.ceil(state.phaseTimer));
}
