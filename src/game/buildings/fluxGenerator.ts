// Flux generator building. Level-1 production tile: generates flux (the
// build/upgrade currency) at a fixed rate while alive. Capped per team so
// income has a ceiling. Visuals echo the core's diamond motif so the
// player reads it as "same family" while staying clearly distinct from
// walls (which are just plate + dot).

import { GRID_SIZE } from '../config';
import type { Vec2 } from '../entities';
import { LOCAL_PLAYER_TEAM, type TeamId } from '../teams';
import {
  createBuilding,
  type Building,
  type BuildingDef,
} from './buildingSystem';

// === Constants ===
export const FLUX_GEN_GRID_CELLS = 4;
export const FLUX_GEN_SIZE = FLUX_GEN_GRID_CELLS * GRID_SIZE;
export const FLUX_GEN_MAX_HP = 250;
// Sturdier than walls because losing one stalls economy, but body damage to
// polygons is low — they're producers, not grinders.
export const FLUX_GEN_BODY_DAMAGE_TO_ENTITY = 20;
export const FLUX_GEN_BODY_DAMAGE_FROM_ENTITY = 8;
export const FLUX_GEN_MAX_COUNT = 8;
// 1 flux per 0.5s per generator = 2 flux/sec. Production is summed across all
// live generators of the same team in fluxProducedThisFrame.
export const FLUX_GEN_RATE_PER_SECOND = 2;

// === Factory ===
// Delegates to the shared createBuilding so level scaling lives in one
// place. Each generator carries its level-scaled `fluxPerSecond`, set
// from FLUX_GEN_RATE_PER_SECOND × balance growth at spawn.
export function createFluxGenerator(
  id: number,
  center: Vec2,
  teamId: TeamId = LOCAL_PLAYER_TEAM,
  ownerId: number = 0,
  level: number = 1,
): Building {
  return createBuilding(id, 'flux-generator', center, { teamId, ownerId, level });
}

// === Production ===
// Sum flux produced this frame across all live, friendly generators.
// Reads the per-building `fluxPerSecond` (level-scaled at spawn) so mixed
// tiers in the same farm compose correctly. Production is fractional
// per frame; the caller floors for display.
export function fluxProducedThisFrame(buildings: Building[], teamId: TeamId, dt: number): number {
  let total = 0;
  for (const b of buildings) {
    if (b.kind !== 'flux-generator' || b.teamId !== teamId || b.hp <= 0) continue;
    total += b.fluxPerSecond ?? 0;
  }
  return total * dt;
}

// === Interior render ===
// Drawn after the manager's shared plate; origin already at the tile center.
// Recessed octagonal panel with a central team-accent diamond — the inner
// darker core pulses to signal active flux production.
//
// `building.level` is available for per-tier visuals — e.g. extra rings
// on the diamond at L3+, or a denser pulse on L5. Branch here when
// adding tier variants.
function drawFluxGeneratorInterior(
  ctx: CanvasRenderingContext2D,
  building: Pick<Building, 'size' | 'level' | 'aimAngle'>,
  accent: string,
  accentDim: string,
  invalid: boolean,
): void {
  const size = building.size;
  const half = size / 2;

  // Recessed octagonal panel (darker plate, matches the core's main plate).
  const innerInset = size * 0.13;
  const innerHalf = half - innerInset;
  const chamfer = size * 0.18;
  ctx.fillStyle = invalid ? '#bd8c8c' : '#909295';
  ctx.strokeStyle = '#575757';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-innerHalf + chamfer, -innerHalf);
  ctx.lineTo(innerHalf - chamfer, -innerHalf);
  ctx.lineTo(innerHalf, -innerHalf + chamfer);
  ctx.lineTo(innerHalf, innerHalf - chamfer);
  ctx.lineTo(innerHalf - chamfer, innerHalf);
  ctx.lineTo(-innerHalf + chamfer, innerHalf);
  ctx.lineTo(-innerHalf, innerHalf - chamfer);
  ctx.lineTo(-innerHalf, -innerHalf + chamfer);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Central team-accent diamond — the "energy cell".
  const diamondR = size * 0.22;
  ctx.fillStyle = accent;
  ctx.strokeStyle = '#575757';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, -diamondR);
  ctx.lineTo(diamondR, 0);
  ctx.lineTo(0, diamondR);
  ctx.lineTo(-diamondR, 0);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Inner darker core — pulses to signal active flux production. Period 1s
  // (one peak every 0.5s) so the rhythm matches FLUX_GEN_RATE_PER_SECOND = 2.
  // All generators share performance.now() so they pulse in sync.
  const pulse = (Math.sin(performance.now() * 0.001 * Math.PI * 2) + 1) * 0.5;
  const coreR = diamondR * (0.30 + 0.18 * pulse);
  ctx.fillStyle = accentDim;
  ctx.beginPath();
  ctx.arc(0, 0, coreR, 0, Math.PI * 2);
  ctx.fill();
}

// === Registry def ===
export const FLUX_GEN_DEF: BuildingDef = {
  kind: 'flux-generator',
  gridCells: FLUX_GEN_GRID_CELLS,
  size: FLUX_GEN_SIZE,
  maxHp: FLUX_GEN_MAX_HP,
  bodyDamageToEntity: FLUX_GEN_BODY_DAMAGE_TO_ENTITY,
  bodyDamageFromEntity: FLUX_GEN_BODY_DAMAGE_FROM_ENTITY,
  fluxPerSecond: FLUX_GEN_RATE_PER_SECOND,
  drawInterior: drawFluxGeneratorInterior,
};
