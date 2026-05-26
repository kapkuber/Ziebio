// Buildings: structures the player builds inside their core's buildable
// zone. Walls today; turrets/generators/spawners follow the same pattern.
//
// Per CLAUDE.md: every building carries a teamId and reads its accent via
// getTeamPalette(teamId). Friend/foe is determined by teamId; ownerId is
// reserved for per-player attribution (e.g. "max N buildings per player").

import { GRID_SIZE } from './config';
import { aabbCircleMTV } from './core';
import type { Core } from './core';
import type { GameEntity, Vec2 } from './entities';
import { drawInnerHpBar } from './hpBar';
import { LOCAL_PLAYER_TEAM, getTeamPalette, type TeamId } from './teams';

// === Buildable zone ===
// Number of grid cells of buildable space extending OUT from each side of
// the core. With CORE_GRID_CELLS = 4 and 25 cells per side, the total
// buildable square is 4 + 2*25 = 54 cells on a side, centered on the core.
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

// === Wall constants ===
export const WALL_GRID_CELLS = 1;
export const WALL_SIZE = WALL_GRID_CELLS * GRID_SIZE; // 25 px square
export const WALL_MAX_HP = 100;

// Continuous-contact damage exchange — same model as core vs polygons.
// Walls hit harder per second than the core (they're meant to grind small
// shapes down) but die faster since they're cheaper to build.
export const WALL_BODY_DAMAGE_TO_ENTITY = 45;
export const WALL_BODY_DAMAGE_FROM_ENTITY = 6;

// === Building type ===
// Single shape for now. When turrets/generators/etc. arrive, either widen
// the `kind` union and let drawBuilding switch on it, or split into a
// tagged union if the per-kind fields diverge significantly.
export type BuildingKind = 'wall';

export interface Building {
  id: number;
  kind: BuildingKind;
  pos: Vec2;       // center
  size: number;    // px (square side length)
  hp: number;
  maxHp: number;
  ownerId: number;
  teamId: TeamId;
}

export function createWall(
  id: number,
  center: Vec2,
  teamId: TeamId = LOCAL_PLAYER_TEAM,
  ownerId: number = 0,
): Building {
  return {
    id,
    kind: 'wall',
    pos: { x: center.x, y: center.y },
    size: WALL_SIZE,
    hp: WALL_MAX_HP,
    maxHp: WALL_MAX_HP,
    ownerId,
    teamId,
  };
}

// Snap a world coordinate to the CENTER of the nearest GRID_SIZE cell.
// Works for any odd-cell-count building (1×1, 3×3, 5×5...).
export function snapBuildingCenter(x: number, y: number, cellsPerSide: number = 1): Vec2 {
  const sizePx = cellsPerSide * GRID_SIZE;
  const half = sizePx / 2;
  // For even cells, top-left snaps to grid; for odd cells, center sits
  // on a cell center. Same formula either way because we add `half`.
  const tlx = Math.round((x - half) / GRID_SIZE) * GRID_SIZE;
  const tly = Math.round((y - half) / GRID_SIZE) * GRID_SIZE;
  return { x: tlx + half, y: tly + half };
}

// === Placement validation ===
export type WallPlacementReason =
  | 'ok'
  | 'outside-zone'
  | 'core-overlap'
  | 'building-overlap'
  | 'entity-overlap';

export interface WallPlacementValidation {
  valid: boolean;
  reason: WallPlacementReason;
}

function aabbsOverlap(
  aMinX: number, aMinY: number, aMaxX: number, aMaxY: number,
  bMinX: number, bMinY: number, bMaxX: number, bMaxY: number,
): boolean {
  return aMaxX > bMinX && aMinX < bMaxX && aMaxY > bMinY && aMinY < bMaxY;
}

export function validateWallPlacement(
  center: Vec2,
  cores: Core[],
  buildings: Building[],
  entities: GameEntity[],
  teamId: TeamId,
): WallPlacementValidation {
  const half = WALL_SIZE / 2;
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
// reciprocal damage. Returns IDs of buildings that died this tick.
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

      e.hp = Math.max(0, e.hp - WALL_BODY_DAMAGE_TO_ENTITY * dt);
      b.hp = Math.max(0, b.hp - WALL_BODY_DAMAGE_FROM_ENTITY * dt);
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

// Push the tank out of any building it overlaps. Walls block movement but
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
interface DrawBuildingOptions {
  alpha?: number;     // < 1 = preview / ghost
  invalid?: boolean;  // red tint for invalid placement
  showHp?: boolean;
  hpRatio?: number;   // 0..1
}

export function drawBuilding(
  ctx: CanvasRenderingContext2D,
  building: Pick<Building, 'pos' | 'size' | 'teamId' | 'kind'>,
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

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(sx, sy);
  ctx.strokeStyle = '#575757';
  ctx.lineWidth = 2;

  // Plate
  ctx.fillStyle = plateFill;
  ctx.beginPath();
  ctx.rect(-half, -half, building.size, building.size);
  ctx.fill();
  ctx.stroke();

  // Small team accent in the center so even tiny walls read as friend/foe.
  const dotR = building.size * 0.22;
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(0, 0, dotR, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Inner HP bar — shared with cores and all future buildings. Sits flush
  // at the bottom interior so adjacent stacked tiles can't cover it.
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
