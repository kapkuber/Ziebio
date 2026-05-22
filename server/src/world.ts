import { Rng } from "./rng.ts";
import type { Vec2 } from "./math.ts";
import type { DerivedStats } from "../../src/game/stats.ts";

// Default map dimensions. Override per-world if needed.
export const MAP_WIDTH = 1500;
export const MAP_HEIGHT = 1500;

export const enum EntityKind {
  Square = 0,
  Triangle = 1,
  Tank = 2,
}

// Unified entity record. Tanks live in the same list as shapes (dispatched by
// kind). This eliminates the "player as loose ref" pattern that TankShooter.tsx
// uses today.
export interface Entity {
  id: number;
  kind: EntityKind;
  pos: Vec2;
  vel: Vec2;
  kick: Vec2;
  angle: number;
  angVel: number;
  size: number;
  hp: number;
  maxHp: number;
  hitT: number;
  ownerClientId: number; // 0 if neutral; client_id for tanks
}

export interface PlayerInput {
  seq: number;
  moveX: number; // -1, 0, +1
  moveY: number;
  aimAngle: number; // radians, [0, 2π)
  flags: number;
  /** When (flags & 0x02), the stat slot 0..7 to allocate this tick. */
  allocStat: number | null;
}

export interface PlayerProgress {
  level: number; // 1..MAX_LEVEL
  xp: number;    // toward next level
}

export interface WorldClient {
  clientId: number;
  tankEntityId: number;
  latestInput: PlayerInput | null;

  cooldownTicks: number;

  progress: PlayerProgress;
  score: number;
  /** Indexed by STAT_ORDER (healthRegen=0 … movementSpeed=7), each 0..MAX_STAT_POINTS. */
  statPoints: number[];

  /** Buffered between systems; drained by processProgression each tick. */
  pendingXp: number;
  pendingScore: number;

  /** Seconds since this client's tank was last damaged. Drives hyper-regen. */
  timeSinceDamage: number;

  /** Derived stats, recomputed each tick from (level, statPoints). */
  derived: DerivedStats;
}

export interface Bullet {
  id: number;
  ownerEntityId: number; // tank entity that fired it
  pos: Vec2;
  vel: Vec2;
  radius: number;
  life: number;     // seconds remaining
  lifetime: number; // seconds (max)
  hp: number;       // damage budget; reduced per hit (Step 8)
  maxHp: number;
  damage: number;
}

export interface DeathFx {
  pos: Vec2;
  angle: number;
  size: number;
  kind: EntityKind;
  t: number;    // seconds remaining
  maxT: number; // duration
}

export interface World {
  tick: number;
  rng: Rng;
  entities: Entity[];
  bullets: Bullet[];
  deathFx: DeathFx[];
  clients: WorldClient[];
  nextEntityId: number;
  nextBulletId: number;
  mapW: number;
  mapH: number;
  spawnsThisTick: number;
}

export function createWorld(seed: number = 0xdeadbeef): World {
  return {
    tick: 0,
    rng: new Rng(seed),
    entities: [],
    bullets: [],
    deathFx: [],
    clients: [],
    nextEntityId: 1,
    nextBulletId: 1,
    mapW: MAP_WIDTH,
    mapH: MAP_HEIGHT,
    spawnsThisTick: 0,
  };
}

// Cheap polynomial hash over all entity positions. Used by the headless run to
// confirm two identical seeds produce identical world evolution (determinism
// check).
export function positionHash(world: World): string {
  let h = 0x811c9dc5 >>> 0;
  for (const e of world.entities) {
    // multiply positions to int-ish to capture sub-px drift
    const xi = Math.round(e.pos.x * 1000) | 0;
    const yi = Math.round(e.pos.y * 1000) | 0;
    h = Math.imul(h ^ e.id, 0x01000193) >>> 0;
    h = Math.imul(h ^ xi, 0x01000193) >>> 0;
    h = Math.imul(h ^ yi, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
