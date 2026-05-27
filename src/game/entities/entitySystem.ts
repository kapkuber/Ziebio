// Entity manager. Owns the shared types every entity kind conforms to and
// the kind-agnostic pipelines (spawning, integration, drawing, entity-vs-
// entity collision). Per-kind modules (./square, ./triangle, ./pentagon)
// plug in via the ENTITY_DEFS registry.
//
// Adding a new entity kind is two steps:
//   1. Create ./<kind>.ts exporting constants, worldVerts, and an EntityDef.
//   2. Import the def here and add it to ENTITY_DEFS below.
// Spawning, drawing, and entity-vs-entity SAT collision all work without
// further changes — they look the def up at runtime.

import { satMTV, type Vec2 } from '../geometry';

import { SQUARE_DEF } from './square';
import { TRIANGLE_DEF } from './triangle';
import { PENTAGON_DEF } from './pentagon';

// Re-exported so external code can keep `import { Vec2 } from './game/entities'`.
export type { Vec2 };

// === Shared types ===

export type EntityKind = 'square' | 'triangle' | 'pentagon';

export interface GameEntity {
  id: number;
  pos: Vec2;
  vel: Vec2;       // base drift velocity
  kick: Vec2;      // transient knockback that decays
  angle: number;   // radians
  angVel: number;  // radians per second
  size: number;    // visual size in px
  kind: EntityKind;
  fill: string;
  stroke: string;
  hp: number;
  maxHp: number;
  hitT?: number;
}

// Per-kind contract used by the cross-kind logic in this file. Kind-internal
// constants (SQUARE_FILL, TRIANGLE_SIZE, etc.) stay exported from the per-
// kind module so callers that need a specific value can import it directly.
export interface EntityDef {
  kind: EntityKind;
  size: number;
  maxHp: number;
  maxCount: number;
  fill: string;
  stroke: string;
  // World-space vertices at the given pose. Caller passes a possibly-inset
  // size for collision; the def's exported tuple-typed variant (e.g.
  // squareWorldVerts) gives stronger typing when the kind is known statically.
  worldVerts: (pos: Vec2, angle: number, size: number) => Vec2[];
  // Trace the path centered at the canvas origin. Caller handles
  // translate/rotate/fill/stroke; tracePath only emits path ops.
  tracePath: (ctx: CanvasRenderingContext2D, size: number) => void;
}

// === Per-kind registry ===
export const ENTITY_DEFS: Record<EntityKind, EntityDef> = {
  square: SQUARE_DEF,
  triangle: TRIANGLE_DEF,
  pentagon: PENTAGON_DEF,
};

export function getEntityDef(kind: EntityKind): EntityDef {
  return ENTITY_DEFS[kind];
}

// === Physics / movement constants ===
export const ENTITY_SPEED_MIN = 5;
export const ENTITY_SPEED_MAX = 8;
export const ENTITY_ANG_MIN = -0.6;
export const ENTITY_ANG_MAX = 0.6;
export const ENTITY_KICK_FRICTION = 6.0;
export const ENTITY_COLLISION_INSET = 3;
export const ENTITY_BOUNCE = 30;

// === Damage-flash visuals (shared with the tank's hit overlay) ===
export const HIT_FLASH_DURATION = 0.06;
export const HIT_FILL = '#ff2021';
export const HIT_STROKE = '#f01717';

// === Reproduction ===
export const REPRO_RATE = 0.05;       // per-second chance each entity reproduces
export const REPRO_NEAR_MIN = 40;     // px
export const REPRO_NEAR_MAX = 140;    // px

// Visual size → inscribed-circle radius used as a uniform collision proxy
// for fast bullet-vs-square checks. Insets so the visible corner doesn't
// trigger hits earlier than the body.
export function computeEntityCollisionRadius(size: number): number {
  return Math.max(0, (size * Math.SQRT2) / 2 - ENTITY_COLLISION_INSET);
}

// === Spawning ===

function countOfKind(entities: GameEntity[], kind: EntityKind): number {
  let n = 0;
  for (const e of entities) if (e.kind === kind) n++;
  return n;
}

export function spawnEntityRandomAvoidingPlayers(
  entities: GameEntity[],
  nextEntityIdRef: { current: number },
  playerPos: Vec2,
  mapW: number,
  mapH: number,
  safeRadius: number,
  kind: EntityKind = 'square',
): boolean {
  const def = getEntityDef(kind);
  if (countOfKind(entities, kind) >= def.maxCount) return false;
  for (let i = 0; i < 20; i++) {
    const x = Math.random() * mapW;
    const y = Math.random() * mapH;
    const dx = x - playerPos.x;
    const dy = y - playerPos.y;
    if (dx * dx + dy * dy < safeRadius * safeRadius) continue;

    const speed = ENTITY_SPEED_MIN + Math.random() * (ENTITY_SPEED_MAX - ENTITY_SPEED_MIN);
    const dir = Math.random() * Math.PI * 2;
    const angVel = ENTITY_ANG_MIN + Math.random() * (ENTITY_ANG_MAX - ENTITY_ANG_MIN);
    entities.push({
      id: nextEntityIdRef.current++,
      pos: { x, y },
      vel: { x: Math.cos(dir) * speed, y: Math.sin(dir) * speed },
      kick: { x: 0, y: 0 },
      angle: Math.random() * Math.PI * 2,
      angVel,
      size: def.size,
      kind,
      fill: def.fill,
      stroke: def.stroke,
      hp: def.maxHp,
      maxHp: def.maxHp,
    });
    return true;
  }
  return false;
}

export function spawnEntityNearAvoidingPlayers(
  entities: GameEntity[],
  nextEntityIdRef: { current: number },
  baseX: number,
  baseY: number,
  playerPos: Vec2,
  mapW: number,
  mapH: number,
  safeRadius: number,
  kind: EntityKind = 'square',
): boolean {
  const def = getEntityDef(kind);
  if (countOfKind(entities, kind) >= def.maxCount) return false;
  const angle = Math.random() * Math.PI * 2;
  const dist = REPRO_NEAR_MIN + Math.random() * (REPRO_NEAR_MAX - REPRO_NEAR_MIN);
  const x = Math.max(0, Math.min(mapW, baseX + Math.cos(angle) * dist));
  const y = Math.max(0, Math.min(mapH, baseY + Math.sin(angle) * dist));
  const dx = x - playerPos.x;
  const dy = y - playerPos.y;
  if (dx * dx + dy * dy < safeRadius * safeRadius) return false;

  const speed = ENTITY_SPEED_MIN + Math.random() * (ENTITY_SPEED_MAX - ENTITY_SPEED_MIN);
  const dir = Math.random() * Math.PI * 2;
  const angVel = ENTITY_ANG_MIN + Math.random() * (ENTITY_ANG_MAX - ENTITY_ANG_MIN);
  entities.push({
    id: nextEntityIdRef.current++,
    pos: { x, y },
    vel: { x: Math.cos(dir) * speed, y: Math.sin(dir) * speed },
    kick: { x: 0, y: 0 },
    angle: Math.random() * Math.PI * 2,
    angVel,
    size: def.size,
    kind,
    fill: def.fill,
    stroke: def.stroke,
    hp: def.maxHp,
    maxHp: def.maxHp,
  });
  return true;
}

// === Per-frame integration + player-contact ===
// Walks every entity once: integrates pos/vel/kick, bounces off the map
// edges, runs reproduction roll, dispatches a player-contact callback if the
// entity overlaps the tank, and decays the hit-flash timer.

import { closestPointOnPolygon } from '../geometry';

export function updateEntities(
  dt: number,
  entities: GameEntity[],
  playerPos: Vec2,
  playerVel: Vec2,
  mapW: number,
  mapH: number,
  tankRadius: number,
  maybeSpawnNear: (x: number, y: number, kind: EntityKind) => void,
  onPlayerCollide?: (entity: GameEntity, dt: number) => void,
): void {
  for (const e of entities) {
    // Integrate
    e.pos.x += (e.vel.x + e.kick.x) * dt;
    e.pos.y += (e.vel.y + e.kick.y) * dt;
    const kd = Math.max(0, 1 - ENTITY_KICK_FRICTION * dt);
    e.kick.x *= kd;
    e.kick.y *= kd;
    e.angle += e.angVel * dt;
    if (e.pos.x < 0) { e.pos.x = 0; e.vel.x = Math.abs(e.vel.x); }
    if (e.pos.x > mapW) { e.pos.x = mapW; e.vel.x = -Math.abs(e.vel.x); }
    if (e.pos.y < 0) { e.pos.y = 0; e.vel.y = Math.abs(e.vel.y); }
    if (e.pos.y > mapH) { e.pos.y = mapH; e.vel.y = -Math.abs(e.vel.y); }

    // Player contact — use the kind's inset polygon so visual corners don't
    // poke into the tank before the body does.
    const insetSize = Math.max(1, e.size - 6);
    const verts = getEntityDef(e.kind).worldVerts(e.pos, e.angle, insetSize);
    const cp = closestPointOnPolygon(playerPos, verts);
    const ndx = playerPos.x - cp.x;
    const ndy = playerPos.y - cp.y;
    const d2 = ndx * ndx + ndy * ndy;
    if (d2 <= tankRadius * tankRadius) {
      const d = Math.max(1e-6, Math.sqrt(d2));
      const nx = ndx / d;
      const ny = ndy / d;
      const penetration = tankRadius - d;
      const push = penetration * 0.5;
      playerPos.x += nx * push;
      playerPos.y += ny * push;
      e.pos.x -= nx * push;
      e.pos.y -= ny * push;
      const PLAYER_BOUNCE = 50;
      playerVel.x += nx * PLAYER_BOUNCE;
      playerVel.y += ny * PLAYER_BOUNCE;
      e.kick.x -= nx * ENTITY_BOUNCE;
      e.kick.y -= ny * ENTITY_BOUNCE;
      // Diep-style continuous body damage — no per-engagement cooldown.
      // Caller scales by dt + deathFactor + impact multiplier.
      if (onPlayerCollide) onPlayerCollide(e, dt);
    }

    // Reproduction roll (caller enforces per-kind population cap).
    if (Math.random() < REPRO_RATE * dt) {
      maybeSpawnNear(e.pos.x, e.pos.y, e.kind);
    }
    if (e.hitT && e.hitT > 0) {
      e.hitT = Math.max(0, e.hitT - dt);
    }
  }
}

// === Drawing ===
// Body + hit-flash overlay + (if damaged) HP bar. Per-kind path comes from
// the registry; the shared chrome (translate/rotate, fill/stroke, hp bar)
// lives here.

export function drawEntities(
  ctx: CanvasRenderingContext2D,
  viewW: number,
  viewH: number,
  camX: number,
  camY: number,
  entities: GameEntity[],
) {
  for (const e of entities) {
    const sx = e.pos.x - camX;
    const sy = e.pos.y - camY;
    const s = e.size;
    if (sx < -s || sx > viewW + s || sy < -s || sy > viewH + s) continue;
    const def = getEntityDef(e.kind);

    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(e.angle);
    ctx.fillStyle = e.fill;
    ctx.strokeStyle = e.stroke;
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    def.tracePath(ctx, s);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // Red damage flash overlay using the same kind path.
    if (e.hitT && e.hitT > 0) {
      const t = Math.max(0, Math.min(HIT_FLASH_DURATION, e.hitT));
      const phase = 1 - t / HIT_FLASH_DURATION;
      const alpha = Math.sin(phase * Math.PI);
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(e.angle);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = HIT_FILL;
      ctx.strokeStyle = HIT_STROKE;
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      def.tracePath(ctx, s);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // HP bar (only if damaged). Pill-shaped track with an inner fill.
    if (e.hp < e.maxHp) {
      const ratio = Math.max(0, Math.min(1, e.hp / e.maxHp));
      const barW = Math.max(18, s * 1.1);
      const barH = 7;
      const radius = barH / 2;
      const bx = sx - barW / 2;
      const by = sy + s / 2 + 11;
      ctx.fillStyle = '#555555';
      ctx.beginPath();
      ctx.moveTo(bx + radius, by);
      ctx.lineTo(bx + barW - radius, by);
      ctx.arc(bx + barW - radius, by + radius, radius, -Math.PI / 2, Math.PI / 2);
      ctx.lineTo(bx + radius, by + barH);
      ctx.arc(bx + radius, by + radius, radius, Math.PI / 2, -Math.PI / 2);
      ctx.closePath();
      ctx.fill();
      const innerH = 4;
      const innerR = innerH / 2;
      const pad = (barH - innerH) / 2;
      const innerX = bx + pad;
      const fy = by + pad;
      const innerW = barW - 2 * pad;
      const fillLen = Math.max(innerR * 2, innerW * ratio);
      ctx.fillStyle = '#85e37d';
      ctx.beginPath();
      ctx.moveTo(innerX + innerR, fy);
      ctx.lineTo(innerX + fillLen - innerR, fy);
      ctx.arc(innerX + fillLen - innerR, fy + innerR, innerR, -Math.PI / 2, Math.PI / 2);
      ctx.lineTo(innerX + innerR, fy + innerH);
      ctx.arc(innerX + innerR, fy + innerR, innerR, Math.PI / 2, -Math.PI / 2);
      ctx.closePath();
      ctx.fill();
    }
  }
}

// === Entity-vs-entity collision (SAT + spatial hash) ===
// Spatial hashing reduces candidate pairs from O(N²) to ~O(N). Each entity
// is inserted into every cell its bounding box overlaps; only entities
// sharing a cell are SAT-tested.

const COLLISION_CELL_SIZE = 64;
const COLLISION_CELL_OFFSET = 1 << 15;
const COLLISION_CELL_STRIDE = 1 << 16;

export function resolveEntityEntityCollisions(entities: GameEntity[]): void {
  const N = entities.length;
  if (N <= 1) return;
  const INSET = 6;
  const BOUNCE = 120;

  // Spatial hash build.
  const buckets = new Map<number, number[]>();
  const cellKey = (cx: number, cy: number) =>
    (cx + COLLISION_CELL_OFFSET) * COLLISION_CELL_STRIDE + (cy + COLLISION_CELL_OFFSET);

  for (let i = 0; i < N; i++) {
    const e = entities[i];
    const r = e.size * 0.5 + 2;
    const minX = Math.floor((e.pos.x - r) / COLLISION_CELL_SIZE);
    const maxX = Math.floor((e.pos.x + r) / COLLISION_CELL_SIZE);
    const minY = Math.floor((e.pos.y - r) / COLLISION_CELL_SIZE);
    const maxY = Math.floor((e.pos.y + r) / COLLISION_CELL_SIZE);
    for (let cy = minY; cy <= maxY; cy++) {
      for (let cx = minX; cx <= maxX; cx++) {
        const key = cellKey(cx, cy);
        let bucket = buckets.get(key);
        if (!bucket) {
          bucket = [];
          buckets.set(key, bucket);
        }
        bucket.push(i);
      }
    }
  }

  // Lazy verts cache — an entity in K cells would otherwise have its polygon
  // rebuilt K times. Compute on first use and reuse for the rest of the frame.
  const vertsCache: (Vec2[] | null)[] = new Array(N).fill(null);
  const getVerts = (idx: number): Vec2[] => {
    const cached = vertsCache[idx];
    if (cached) return cached;
    const e = entities[idx];
    const v = getEntityDef(e.kind).worldVerts(e.pos, e.angle, Math.max(1, e.size - INSET));
    vertsCache[idx] = v;
    return v;
  };

  // Pair dedup — sharing two cells would otherwise check the same pair twice.
  const seenPairs = new Set<number>();

  for (const bucket of buckets.values()) {
    const len = bucket.length;
    if (len < 2) continue;
    for (let a = 0; a < len; a++) {
      const i = bucket[a];
      for (let b = a + 1; b < len; b++) {
        const j = bucket[b];
        const lo = i < j ? i : j;
        const hi = i < j ? j : i;
        const pairKey = lo * N + hi;
        if (seenPairs.has(pairKey)) continue;
        seenPairs.add(pairKey);

        const eA = entities[lo];
        const eB = entities[hi];
        // Bounding-circle reject — sharing a cell doesn't mean overlapping.
        const dx = eA.pos.x - eB.pos.x;
        const dy = eA.pos.y - eB.pos.y;
        const reach = (eA.size + eB.size) * 0.5;
        if (dx * dx + dy * dy > reach * reach) continue;

        const mtv = satMTV(getVerts(lo), getVerts(hi), eA.pos.x, eA.pos.y, eB.pos.x, eB.pos.y);
        if (!mtv) continue;
        eA.pos.x -= mtv.x * 0.5;
        eA.pos.y -= mtv.y * 0.5;
        eB.pos.x += mtv.x * 0.5;
        eB.pos.y += mtv.y * 0.5;
        const len2 = Math.hypot(mtv.x, mtv.y) || 1e-6;
        const nx = mtv.x / len2;
        const ny = mtv.y / len2;
        eA.kick.x -= nx * BOUNCE;
        eA.kick.y -= ny * BOUNCE;
        eB.kick.x += nx * BOUNCE;
        eB.kick.y += ny * BOUNCE;
      }
    }
  }
}
