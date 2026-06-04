// Wall building. Level-1 defensive tile: cheap, small, durable enough to
// grind down low-HP polygons. Visuals are a plain plate with a small team
// accent dot in the center.

import { GRID_SIZE } from '../config';
import type { Vec2 } from '../entities';
import { LOCAL_PLAYER_TEAM, type TeamId } from '../teams';
import {
  createBuilding,
  type Building,
  type BuildingDef,
} from './buildingSystem';

// === Constants ===
export const WALL_GRID_CELLS = 2;
export const WALL_SIZE = WALL_GRID_CELLS * GRID_SIZE;
export const WALL_MAX_HP = 100;

// Continuous-contact damage exchange — same model as core vs polygons.
// Walls hit harder per second than the core (they're meant to grind small
// shapes down) but die faster since they're cheaper to build.
export const WALL_BODY_DAMAGE_TO_ENTITY = 45;
export const WALL_BODY_DAMAGE_FROM_ENTITY = 6;
// Flux cost to place a wall. Deducted on successful placement; preview turns
// red when the player can't afford it.
export const WALL_FLUX_COST = 10;

// === Factory ===
// Delegates to the shared createBuilding so level scaling lives in one
// place. The kind / size / base HP come from WALL_DEF; only id + center +
// team / owner / level differ per call.
export function createWall(
  id: number,
  center: Vec2,
  teamId: TeamId = LOCAL_PLAYER_TEAM,
  ownerId: number = 0,
  level: number = 1,
): Building {
  return createBuilding(id, 'wall', center, { teamId, ownerId, level });
}

// === Interior render ===
// Drawn after the manager's shared plate; origin already at the tile center
// with a default stroke style set. Wall interior is a single team-accent dot
// — minimal because the plate's small footprint doesn't need more detail.
//
// `building` carries `level` for per-tier visuals. To add a different look
// at higher tiers, branch on `building.level` here:
//   if (building.level >= 3) drawWallTierB(ctx, building.size, accent);
//   else drawWallTierA(ctx, building.size, accent);
function drawWallInterior(
  ctx: CanvasRenderingContext2D,
  building: Pick<Building, 'size' | 'level' | 'aimAngle'>,
  accent: string,
  _accentDim: string,
  _invalid: boolean,
): void {
  const dotR = building.size * 0.22;
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(0, 0, dotR, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.stroke();
}

// === Registry def ===
export const WALL_DEF: BuildingDef = {
  kind: 'wall',
  gridCells: WALL_GRID_CELLS,
  size: WALL_SIZE,
  maxHp: WALL_MAX_HP,
  bodyDamageToEntity: WALL_BODY_DAMAGE_TO_ENTITY,
  bodyDamageFromEntity: WALL_BODY_DAMAGE_FROM_ENTITY,
  drawInterior: drawWallInterior,
};
