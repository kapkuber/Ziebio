// Building manager. Owns the shared types every building kind conforms to,
// the kind-agnostic placement/collision/draw pipelines, and the registry that
// the per-kind modules (./wall, ./fluxGenerator, ...) plug into.
//
// Adding a new building kind is two steps:
//   1. Create ./<kind>.ts exporting constants, a factory, and a BuildingDef.
//   2. Import the def here and add it to BUILDING_DEFS below.
// No changes to validation, collisions, or the draw dispatcher are needed.
//
// Per CLAUDE.md: every building carries a teamId and reads its accent via
// getTeamPalette(teamId). Friend/foe is determined by teamId; ownerId is
// reserved for per-player attribution.

import {
  MAX_ENTITY_LEVEL,
  buildingSellValue,
  buildingUpgradeCost,
  scaleBuildingBodyDamage,
  scaleBuildingHp,
  scaleBuildingOutput,
} from '../balance';
import { GRID_SIZE } from '../config';
import type { Core } from '../core';
import type { GameEntity, Vec2 } from '../entities';
import { aabbCircleMTV } from '../geometry';
import { drawInnerHpBar } from '../hpBar';
import type { Bullet } from '../tank';
import { getTeamPalette, type TeamId } from '../teams';

import { WALL_DEF } from './wall';
import { FLUX_GEN_DEF } from './fluxGenerator';
import { TURRET_DEF } from './turret';

// === Shared types ===

export type BuildingKind = 'wall' | 'flux-generator' | 'turret';

export interface Building {
  id: number;
  kind: BuildingKind;
  pos: Vec2;       // center
  size: number;    // px (square side length)
  hp: number;
  maxHp: number;
  ownerId: number;
  teamId: TeamId;
  // Per-kind runtime state. Only the turret uses these today; left optional so
  // walls / flux generators don't have to carry the fields. New kinds with
  // their own state can extend here rather than introducing a parallel struct.
  aimAngle?: number;        // turret: current barrel angle (radians)
  reloadRemaining?: number; // turret: seconds until next shot can fire
  // === Level + per-level scaled stats ===
  // `level` is the building tier (1..MAX_ENTITY_LEVEL). The damage / output
  // numbers below are pre-scaled at spawn from `def × balance.ts growth`,
  // so update code reads from the BUILDING (not from compile-time
  // constants) and leveling drives behavior without touching kind code.
  //
  // To add per-level VISUALS later, branch on `building.level` inside the
  // kind's drawInterior — it receives the building as its first arg.
  // E.g.: `if (building.level >= 3) drawTierBPlate(ctx); else drawTierA(ctx);`
  level: number;
  bodyDamageToEntity: number;
  bodyDamageFromEntity: number;
  // Optional bullet stats — populated only for kinds that fire (turret).
  bulletDamage?: number;
  bulletHp?: number;
  // Optional production rate — populated only for kinds that yield flux.
  fluxPerSecond?: number;
}

// Per-kind contract used by cross-kind logic. Anything kind-specific that the
// MANAGER needs goes here. Kind-internal constants (flux cost, max-count,
// etc.) stay as exports on the per-kind module and are imported directly by
// callers that care.
//
// All stat fields here are L1 BASE values — per-level growth in `balance.ts`
// scales them at creation and stores the result on the Building.
export interface BuildingDef {
  kind: BuildingKind;
  gridCells: number;
  size: number;                 // gridCells * GRID_SIZE
  maxHp: number;
  bodyDamageToEntity: number;   // dealt to polygons per second of overlap
  bodyDamageFromEntity: number; // taken from polygons per second of overlap
  // Optional bullet stats — populated only for kinds that fire (turret).
  // Both damage AND hp scale with level so high-level turret shots are
  // both harder-hitting AND harder to shoot down.
  bulletDamage?: number;
  bulletHp?: number;
  // Optional production rate — populated only for kinds that produce flux
  // (flux-generator). Scales with the building output growth exponent.
  fluxPerSecond?: number;
  // Renders the kind-specific interior. The caller has translated the
  // canvas origin to the building center and set a default stroke style.
  // The (Pick of) `building` arg gives the renderer access to `size`,
  // `level`, and `aimAngle` — branch on `building.level` to swap visuals
  // per tier without changing the def shape. New per-level visual data
  // (e.g. evolution stage, palette override) can be added to the Pick
  // without touching every callsite.
  drawInterior: (
    ctx: CanvasRenderingContext2D,
    building: Pick<Building, 'size' | 'level' | 'aimAngle'>,
    accent: string,
    accentDim: string,
    invalid: boolean,
  ) => void;
}

// === Factory ===
// Shared builder for all building kinds. Per-kind `create*` factories call
// through to this with their kind, so the level-scaling logic lives in one
// place. Optional bullet / flux fields stay 0 / undefined for kinds whose
// def doesn't supply them — callers that read those fields branch on the
// presence (turret reads bulletDamage/bulletHp, flux-gen reads fluxPerSecond).
export interface CreateBuildingOptions {
  teamId?: TeamId;
  ownerId?: number;
  // Building tier (1..MAX_ENTITY_LEVEL). Defaults to 1; slice 4's wave +
  // core systems will pass the current-unlocked tier. Clamped silently.
  level?: number;
}

export function createBuilding(
  id: number,
  kind: BuildingKind,
  center: Vec2,
  options: CreateBuildingOptions = {},
): Building {
  const def = getBuildingDef(kind);
  const level = Math.max(1, Math.min(MAX_ENTITY_LEVEL, options.level ?? 1));
  const maxHp = scaleBuildingHp(def.maxHp, level);
  const building: Building = {
    id,
    kind,
    pos: { x: center.x, y: center.y },
    size: def.size,
    hp: maxHp,
    maxHp,
    ownerId: options.ownerId ?? 0,
    teamId: options.teamId ?? ('red' as TeamId),
    level,
    bodyDamageToEntity: scaleBuildingBodyDamage(def.bodyDamageToEntity, level),
    bodyDamageFromEntity: scaleBuildingBodyDamage(def.bodyDamageFromEntity, level),
  };
  // Output / bullet fields land on the building only when the def provides
  // them. Output growth differs from body-damage growth (1.3 vs 1.18) so
  // late-game flux generators / turrets feel like real upgrades.
  if (def.bulletDamage !== undefined) {
    building.bulletDamage = scaleBuildingOutput(def.bulletDamage, level);
  }
  if (def.bulletHp !== undefined) {
    building.bulletHp = scaleBuildingOutput(def.bulletHp, level);
  }
  if (def.fluxPerSecond !== undefined) {
    building.fluxPerSecond = scaleBuildingOutput(def.fluxPerSecond, level);
  }
  return building;
}

// === Per-kind registry ===
// Explicit object so adding a kind is one new entry — no side-effect
// registration, no load-order surprises.
export const BUILDING_DEFS: Record<BuildingKind, BuildingDef> = {
  'wall': WALL_DEF,
  'flux-generator': FLUX_GEN_DEF,
  'turret': TURRET_DEF,
};

export function getBuildingDef(kind: BuildingKind): BuildingDef {
  return BUILDING_DEFS[kind];
}

// === Upgrade / sell ===
// Stat preview for the action-popup. Returns the before/after numbers
// the popup needs to render its "current → next" rows. Returns null when
// the building is already at the level cap or when upgrading would
// exceed the supplied core-level gate (player hasn't upgraded the core
// far enough to unlock the next tier).
//
// Per-kind stat fields populated only when the def supplies the
// corresponding L1 base (e.g. flux-gen → fluxPerSecond, turret →
// bulletDamage). The popup component renders whichever fields are
// present; non-applicable rows are absent rather than zeroed.
export interface BuildingUpgradePreview {
  fromLevel: number;
  toLevel: number;
  cost: number;
  // Always populated.
  hpBefore: number;
  hpAfter: number;
  hpDelta: number;
  bodyDamageBefore: number;
  bodyDamageAfter: number;
  bodyDamageDelta: number;
  // Turret-only.
  bulletDamageBefore?: number;
  bulletDamageAfter?: number;
  bulletDamageDelta?: number;
  // Flux-gen-only.
  fluxPerSecondBefore?: number;
  fluxPerSecondAfter?: number;
  fluxPerSecondDelta?: number;
}

export function previewBuildingUpgrade(
  building: Building,
  coreLevelCap: number,
): BuildingUpgradePreview | null {
  if (building.level >= MAX_ENTITY_LEVEL) return null;
  const toLevel = building.level + 1;
  if (toLevel > coreLevelCap) return null;
  const def = getBuildingDef(building.kind);
  const cost = buildingUpgradeCost(building.kind, building.level);
  const hpAfter = scaleBuildingHp(def.maxHp, toLevel);
  const bdAfter = scaleBuildingBodyDamage(def.bodyDamageToEntity, toLevel);
  const preview: BuildingUpgradePreview = {
    fromLevel: building.level,
    toLevel,
    cost,
    hpBefore: building.maxHp,
    hpAfter,
    hpDelta: hpAfter - building.maxHp,
    bodyDamageBefore: building.bodyDamageToEntity,
    bodyDamageAfter: bdAfter,
    bodyDamageDelta: bdAfter - building.bodyDamageToEntity,
  };
  if (def.bulletDamage !== undefined) {
    const after = scaleBuildingOutput(def.bulletDamage, toLevel);
    const before = building.bulletDamage ?? 0;
    preview.bulletDamageBefore = before;
    preview.bulletDamageAfter = after;
    preview.bulletDamageDelta = after - before;
  }
  if (def.fluxPerSecond !== undefined) {
    const after = scaleBuildingOutput(def.fluxPerSecond, toLevel);
    const before = building.fluxPerSecond ?? 0;
    preview.fluxPerSecondBefore = before;
    preview.fluxPerSecondAfter = after;
    preview.fluxPerSecondDelta = after - before;
  }
  return preview;
}

// Mutates the building in place: bumps level, re-scales every stat field
// using the same balance formulas createBuilding uses, full-heals to the
// new maxHp. Caller deducts flux BEFORE calling. Returns true on success.
//
// Re-running the scaling formulas (rather than applying deltas) is
// deliberately idempotent: tweaking a growth exponent in balance.ts
// retroactively gives consistent values for any upgrade that runs after
// the change. Mid-game stat drift on a hot-reload is fine; what we want
// to avoid is drift between two L3 buildings that took different upgrade
// paths.
export function upgradeBuilding(building: Building, coreLevelCap: number): boolean {
  if (building.level >= MAX_ENTITY_LEVEL) return false;
  if (building.level + 1 > coreLevelCap) return false;
  const def = getBuildingDef(building.kind);
  building.level += 1;
  building.maxHp = scaleBuildingHp(def.maxHp, building.level);
  building.hp = building.maxHp;
  building.bodyDamageToEntity = scaleBuildingBodyDamage(def.bodyDamageToEntity, building.level);
  building.bodyDamageFromEntity = scaleBuildingBodyDamage(def.bodyDamageFromEntity, building.level);
  if (def.bulletDamage !== undefined) {
    building.bulletDamage = scaleBuildingOutput(def.bulletDamage, building.level);
  }
  if (def.bulletHp !== undefined) {
    building.bulletHp = scaleBuildingOutput(def.bulletHp, building.level);
  }
  if (def.fluxPerSecond !== undefined) {
    building.fluxPerSecond = scaleBuildingOutput(def.fluxPerSecond, building.level);
  }
  return true;
}

// Flux refund for selling a building. Just a re-export so callers reading
// "what does this sell for" don't have to know the formula lives in
// balance.ts. The actual removal is done by the caller (filter out by id).
export function buildingSellRefund(building: Building): number {
  return buildingSellValue(building.kind, building.level);
}

// === Click hit-test ===
// Returns the friendly building whose AABB contains the world-space
// point, or null. Used by the action-popup click handler to detect
// whether the player clicked a building to open its upgrade dialog.
// Hostile buildings are skipped — clicking them never opens a popup.
// Walks back-to-front so the topmost match wins if overlap ever happens.
export function findBuildingAtPoint(
  buildings: Building[],
  teamId: TeamId,
  x: number,
  y: number,
): Building | null {
  for (let i = buildings.length - 1; i >= 0; i--) {
    const b = buildings[i];
    if (b.hp <= 0 || b.teamId !== teamId) continue;
    const half = b.size * 0.5;
    if (x >= b.pos.x - half && x <= b.pos.x + half &&
        y >= b.pos.y - half && y <= b.pos.y + half) {
      return b;
    }
  }
  return null;
}

// === Buildable zone ===
// Number of grid cells of buildable space extending OUT from each side of
// the core. With CORE_GRID_CELLS = 4 and BUILDABLE_CELLS_FROM_CORE cells per
// side, the total buildable square is 4 + 2*N cells, centered on the core.
export const BUILDABLE_CELLS_FROM_CORE = 25;

export interface BuildableZone {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function getBuildableZone(core: Pick<Core, 'pos' | 'size'>): BuildableZone {
  const half = core.size / 2;
  const ext = BUILDABLE_CELLS_FROM_CORE * GRID_SIZE;
  return {
    minX: core.pos.x - half - ext,
    minY: core.pos.y - half - ext,
    maxX: core.pos.x + half + ext,
    maxY: core.pos.y + half + ext,
  };
}

// Snap a world coordinate to the CENTER of the nearest GRID_SIZE-aligned
// footprint of `cellsPerSide` cells. Works for any cell count.
export function snapBuildingCenter(x: number, y: number, cellsPerSide: number = 1): Vec2 {
  const sizePx = cellsPerSide * GRID_SIZE;
  const half = sizePx / 2;
  const tlx = Math.round((x - half) / GRID_SIZE) * GRID_SIZE;
  const tly = Math.round((y - half) / GRID_SIZE) * GRID_SIZE;
  return { x: tlx + half, y: tly + half };
}

// === Placement validation ===
// Kind-agnostic — caller passes the footprint size and (optionally) a per-kind
// instance cap. New building kinds reuse this directly; no new validator per kind.
export type BuildingPlacementReason =
  | 'ok'
  | 'outside-zone'
  | 'core-overlap'
  | 'building-overlap'
  | 'entity-overlap'
  | 'max-reached';

export interface BuildingPlacementValidation {
  valid: boolean;
  reason: BuildingPlacementReason;
}

function aabbsOverlap(
  aMinX: number, aMinY: number, aMaxX: number, aMaxY: number,
  bMinX: number, bMinY: number, bMaxX: number, bMaxY: number,
): boolean {
  return aMaxX > bMinX && aMinX < bMaxX && aMaxY > bMinY && aMinY < bMaxY;
}

export function validateBuildingPlacement(
  center: Vec2,
  size: number,
  cores: Core[],
  buildings: Building[],
  entities: GameEntity[],
  teamId: TeamId,
  maxOfKind?: { kind: BuildingKind; max: number },
): BuildingPlacementValidation {
  // Per-kind instance cap. Checked first so the player gets clear feedback
  // before any geometry probing.
  if (maxOfKind) {
    let count = 0;
    for (const b of buildings) {
      if (b.kind === maxOfKind.kind && b.teamId === teamId) count++;
    }
    if (count >= maxOfKind.max) return { valid: false, reason: 'max-reached' };
  }

  const half = size / 2;
  const wMinX = center.x - half;
  const wMaxX = center.x + half;
  const wMinY = center.y - half;
  const wMaxY = center.y + half;

  // Must lie fully inside SOME friendly core's buildable zone.
  let insideAnyZone = false;
  for (const c of cores) {
    if (c.teamId !== teamId) continue;
    const z = getBuildableZone(c);
    if (wMinX >= z.minX && wMaxX <= z.maxX && wMinY >= z.minY && wMaxY <= z.maxY) {
      insideAnyZone = true;
      break;
    }
  }
  if (!insideAnyZone) return { valid: false, reason: 'outside-zone' };

  // Must not overlap any core (own or otherwise).
  for (const c of cores) {
    const halfC = c.size / 2;
    if (aabbsOverlap(
      wMinX, wMinY, wMaxX, wMaxY,
      c.pos.x - halfC, c.pos.y - halfC, c.pos.x + halfC, c.pos.y + halfC,
    )) return { valid: false, reason: 'core-overlap' };
  }

  // Must not overlap any other building.
  for (const b of buildings) {
    const halfB = b.size / 2;
    if (aabbsOverlap(
      wMinX, wMinY, wMaxX, wMaxY,
      b.pos.x - halfB, b.pos.y - halfB, b.pos.x + halfB, b.pos.y + halfB,
    )) return { valid: false, reason: 'building-overlap' };
  }

  // Must not overlap any polygon (AABB vs entity bounding circle).
  for (const e of entities) {
    const r = e.size * 0.5;
    const closestX = Math.max(wMinX, Math.min(e.pos.x, wMaxX));
    const closestY = Math.max(wMinY, Math.min(e.pos.y, wMaxY));
    const dx = e.pos.x - closestX;
    const dy = e.pos.y - closestY;
    if (dx * dx + dy * dy < r * r) {
      return { valid: false, reason: 'entity-overlap' };
    }
  }

  return { valid: true, reason: 'ok' };
}

// === Collisions ===
// Same continuous-contact model as cores: polygons get pushed + take/deal
// reciprocal damage. Per-kind damage values come from BUILDING_DEFS. Returns
// IDs of buildings that died this tick.
export function resolveBuildingEntityCollisions(
  buildings: Building[],
  entities: GameEntity[],
  dt: number,
  onEntityKilled: (e: GameEntity) => void,
): number[] {
  if (!buildings.length || !entities.length) return [];
  const KICK = 80;
  const deadIds: number[] = [];
  for (let ei = entities.length - 1; ei >= 0; ei--) {
    const e = entities[ei];
    const r = e.size * 0.5;
    for (const b of buildings) {
      if (b.hp <= 0) continue;
      const half = b.size * 0.5;
      const mtv = aabbCircleMTV(
        b.pos.x - half, b.pos.y - half, b.pos.x + half, b.pos.y + half,
        e.pos.x, e.pos.y, r,
      );
      if (!mtv) continue;
      e.pos.x += mtv.nx * mtv.pen;
      e.pos.y += mtv.ny * mtv.pen;
      e.kick.x += mtv.nx * KICK;
      e.kick.y += mtv.ny * KICK;

      // Scaled body damage stored on the building at spawn — kind-agnostic
      // here, and level-aware without a per-frame def lookup.
      e.hp = Math.max(0, e.hp - b.bodyDamageToEntity * dt);
      b.hp = Math.max(0, b.hp - b.bodyDamageFromEntity * dt);
      if (b.hp <= 0) deadIds.push(b.id);
      if (e.hp <= 0) {
        onEntityKilled(e);
        entities.splice(ei, 1);
        break;
      }
    }
  }
  return deadIds;
}

// Hostile bullets vs buildings. Each overlapping bullet dies on impact and
// the building takes the bullet's full damage. Bullets of the same team pass
// through (no friendly fire). Returns IDs of buildings that died this tick
// so the caller can filter, matching the resolveBuildingEntityCollisions
// pattern.
export function resolveBuildingBulletCollisions(
  buildings: Building[],
  bullets: Bullet[],
): number[] {
  if (!buildings.length || !bullets.length) return [];
  const deadIds: number[] = [];
  for (const b of bullets) {
    if (b.life <= 0) continue;
    for (const bld of buildings) {
      if (bld.hp <= 0 || bld.teamId === b.teamId) continue;
      const half = bld.size * 0.5;
      const closestX = Math.max(bld.pos.x - half, Math.min(b.pos.x, bld.pos.x + half));
      const closestY = Math.max(bld.pos.y - half, Math.min(b.pos.y, bld.pos.y + half));
      const dx = b.pos.x - closestX;
      const dy = b.pos.y - closestY;
      if (dx * dx + dy * dy > b.radius * b.radius) continue;
      bld.hp = Math.max(0, bld.hp - b.damage);
      b.life = 0;
      if (bld.hp <= 0) deadIds.push(bld.id);
      break; // one bullet only hits one building
    }
  }
  return deadIds;
}

// Push the tank out of any building it overlaps. Buildings block movement but
// deal no damage to friendlies (matches the core's behavior).
export function resolvePlayerBuildingCollisions(
  buildings: Building[],
  playerPos: Vec2,
  playerVel: Vec2,
  tankRadius: number,
): void {
  if (!buildings.length) return;
  for (const b of buildings) {
    if (b.hp <= 0) continue;
    const half = b.size * 0.5;
    const mtv = aabbCircleMTV(
      b.pos.x - half, b.pos.y - half, b.pos.x + half, b.pos.y + half,
      playerPos.x, playerPos.y, tankRadius,
    );
    if (!mtv) continue;
    playerPos.x += mtv.nx * mtv.pen;
    playerPos.y += mtv.ny * mtv.pen;
    const vIn = playerVel.x * mtv.nx + playerVel.y * mtv.ny;
    if (vIn < 0) {
      playerVel.x -= mtv.nx * vIn;
      playerVel.y -= mtv.ny * vIn;
    }
  }
}

// === Rendering ===
export interface DrawBuildingOptions {
  alpha?: number;     // < 1 = preview / ghost
  invalid?: boolean;  // red tint for invalid placement
  showHp?: boolean;
  hpRatio?: number;   // 0..1
}

// `building` carries level so per-kind drawInterior can branch on tier
// for visuals. Placement previews construct an ad-hoc partial; they pass
// the level the player would PLACE at (current core unlock cap, or 1 in
// the pre-wave era).
export function drawBuilding(
  ctx: CanvasRenderingContext2D,
  building: Pick<Building, 'pos' | 'size' | 'teamId' | 'kind' | 'aimAngle' | 'level'>,
  camera: { x: number; y: number; width: number; height: number },
  options: DrawBuildingOptions = {},
): void {
  const sx = building.pos.x - camera.x;
  const sy = building.pos.y - camera.y;
  const half = building.size / 2;
  if (sx + half < 0 || sx - half > camera.width ||
      sy + half < 0 || sy - half > camera.height) return;

  const alpha = options.alpha ?? 1;
  const invalid = !!options.invalid;
  const palette = getTeamPalette(building.teamId);
  const plateFill = invalid ? '#d8a8a8' : '#a1a3a6';
  const accent = invalid ? '#e07070' : palette.accent;
  const accentDim = invalid ? '#7a4747' : palette.accentDim;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(sx, sy);
  ctx.strokeStyle = '#575757';
  ctx.lineWidth = 3.5;

  // Shared chassis plate.
  ctx.fillStyle = plateFill;
  ctx.beginPath();
  ctx.rect(-half, -half, building.size, building.size);
  ctx.fill();
  ctx.stroke();

  // Per-kind interior. The def encapsulates everything kind-specific about
  // the visual; this dispatch is the single point of variance. The
  // `building` slice exposes size + level + aimAngle so kinds can branch
  // on level for per-tier visuals.
  getBuildingDef(building.kind).drawInterior(
    ctx, building, accent, accentDim, invalid,
  );

  // Inner HP bar — shared with cores and all future buildings.
  if (options.showHp && options.hpRatio !== undefined) {
    drawInnerHpBar(ctx, building.size, options.hpRatio);
  }

  ctx.restore();
}

// Dashed outline of the buildable zone, drawn during placement modes so
// the player sees where they can build. Team-tinted via the core's palette.
export function drawBuildableZone(
  ctx: CanvasRenderingContext2D,
  core: Pick<Core, 'pos' | 'size' | 'teamId'>,
  camera: { x: number; y: number; width: number; height: number },
): void {
  const palette = getTeamPalette(core.teamId);
  const z = getBuildableZone(core);
  ctx.save();
  ctx.strokeStyle = palette.accent;
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 2;
  ctx.setLineDash([10, 6]);
  ctx.strokeRect(z.minX - camera.x, z.minY - camera.y, z.maxX - z.minX, z.maxY - z.minY);
  ctx.restore();
}
