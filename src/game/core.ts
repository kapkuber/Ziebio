// Core: the player's base. Placed by the player, takes contact damage from
// polygons, and when destroyed ends the run.
import { GRID_SIZE } from './config';
import type { GameEntity, Vec2 } from './entities';
import { aabbCircleMTV } from './geometry';
import { drawInnerHpBar } from './hpBar';
import type { Bullet } from './tank';
import { LOCAL_PLAYER_TEAM, getTeamPalette, type TeamId } from './teams';

export const CORE_GRID_CELLS = 8;
export const CORE_SIZE = CORE_GRID_CELLS * GRID_SIZE;

export const CORE_MAX_HP = 1000;

// Center-to-center spacing required between any two cores. Picked so two
// cores can never share placement footprints with a comfortable buffer.
export const CORE_MIN_SEPARATION = CORE_SIZE * 15;

// Lvl 1 structural palette. The diamond accent is NOT defined here — it
// comes from the owning team's palette (see ./teams.ts) so red-team cores
// get red accents, green-team cores get green accents, etc.
export const CORE_PLATE_FILL = '#909295';
export const CORE_OUTLINE = '#575757';
const CORE_OUTLINE_WIDTH = 3.5; // slightly thinner than polygons; structures read as static

// Reciprocal body damage on overlap. Same continuous-contact model as the
// player vs polygons — applied every overlap tick, scaled by dt.
export const CORE_BODY_DAMAGE_TO_ENTITY = 60;
export const CORE_BODY_DAMAGE_FROM_ENTITY = 8;

export interface Core {
  id: number;
  pos: Vec2;       // center
  size: number;    // square side length (px)
  hp: number;
  maxHp: number;
  ownerId: number; // 0 = local player; reserved for per-player attribution
  teamId: TeamId;  // drives accent color via getTeamPalette
}

export function createCore(
  id: number,
  center: Vec2,
  teamId: TeamId = LOCAL_PLAYER_TEAM,
  ownerId: number = 0,
): Core {
  return {
    id,
    pos: { x: center.x, y: center.y },
    size: CORE_SIZE,
    hp: CORE_MAX_HP,
    maxHp: CORE_MAX_HP,
    ownerId,
    teamId,
  };
}

// Snap a world coordinate so the core's bounding box aligns to the GRID_SIZE
// grid. For an odd cell count (5) the resulting center sits at half-cell
// offsets, which keeps the outer edges flush with grid lines.
export function snapCoreCenter(x: number, y: number): Vec2 {
  const half = CORE_SIZE / 2;
  const tlx = Math.round((x - half) / GRID_SIZE) * GRID_SIZE;
  const tly = Math.round((y - half) / GRID_SIZE) * GRID_SIZE;
  return { x: tlx + half, y: tly + half };
}

export type PlacementReason = 'ok' | 'outside-map' | 'too-close-to-core' | 'entity-overlap';

export interface PlacementValidation {
  valid: boolean;
  reason: PlacementReason;
}

export function validateCorePlacement(
  center: Vec2,
  cores: Core[],
  entities: GameEntity[],
  mapW: number,
  mapH: number,
): PlacementValidation {
  const half = CORE_SIZE / 2;
  if (
    center.x - half < 0 ||
    center.x + half > mapW ||
    center.y - half < 0 ||
    center.y + half > mapH
  ) {
    return { valid: false, reason: 'outside-map' };
  }
  for (const c of cores) {
    const dx = c.pos.x - center.x;
    const dy = c.pos.y - center.y;
    if (dx * dx + dy * dy < CORE_MIN_SEPARATION * CORE_MIN_SEPARATION) {
      return { valid: false, reason: 'too-close-to-core' };
    }
  }
  const minX = center.x - half;
  const maxX = center.x + half;
  const minY = center.y - half;
  const maxY = center.y + half;
  for (const e of entities) {
    const r = e.size * 0.5;
    const closestX = Math.max(minX, Math.min(e.pos.x, maxX));
    const closestY = Math.max(minY, Math.min(e.pos.y, maxY));
    const dx = e.pos.x - closestX;
    const dy = e.pos.y - closestY;
    if (dx * dx + dy * dy < r * r) {
      return { valid: false, reason: 'entity-overlap' };
    }
  }
  return { valid: true, reason: 'ok' };
}

// Push polygons out of any live core's AABB and apply reciprocal contact
// damage. Splices killed entities out in-place. Returns the IDs of cores
// that died this tick so the caller can filter and trigger game-over.
export function resolveCoreEntityCollisions(
  cores: Core[],
  entities: GameEntity[],
  dt: number,
  onEntityKilled: (e: GameEntity) => void,
): number[] {
  if (!cores.length || !entities.length) return [];
  const KICK = 80;
  const deadCoreIds: number[] = [];
  // Walk entities backwards so splicing during iteration is safe.
  for (let ei = entities.length - 1; ei >= 0; ei--) {
    const e = entities[ei];
    const r = e.size * 0.5;
    for (const c of cores) {
      if (c.hp <= 0) continue;
      const half = c.size * 0.5;
      const mtv = aabbCircleMTV(
        c.pos.x - half, c.pos.y - half, c.pos.x + half, c.pos.y + half,
        e.pos.x, e.pos.y, r,
      );
      if (!mtv) continue;
      e.pos.x += mtv.nx * mtv.pen;
      e.pos.y += mtv.ny * mtv.pen;
      e.kick.x += mtv.nx * KICK;
      e.kick.y += mtv.ny * KICK;

      e.hp = Math.max(0, e.hp - CORE_BODY_DAMAGE_TO_ENTITY * dt);
      c.hp = Math.max(0, c.hp - CORE_BODY_DAMAGE_FROM_ENTITY * dt);
      if (c.hp <= 0) deadCoreIds.push(c.id);
      if (e.hp <= 0) {
        onEntityKilled(e);
        entities.splice(ei, 1);
        break; // entity gone; stop checking it against other cores
      }
    }
  }
  return deadCoreIds;
}

// Hostile bullets vs cores. Each overlapping bullet dies on impact and the
// core takes the bullet's full damage. Same friend/foe model as everywhere
// else — bullets of the core's own team pass through (no friendly fire).
// Returns IDs of cores that died this tick so the caller can filter and
// trigger game-over, matching the resolveCoreEntityCollisions pattern.
export function resolveCoreBulletCollisions(
  cores: Core[],
  bullets: Bullet[],
): number[] {
  if (!cores.length || !bullets.length) return [];
  const deadCoreIds: number[] = [];
  for (const b of bullets) {
    if (b.life <= 0) continue;
    for (const c of cores) {
      if (c.hp <= 0 || c.teamId === b.teamId) continue;
      const half = c.size * 0.5;
      const closestX = Math.max(c.pos.x - half, Math.min(b.pos.x, c.pos.x + half));
      const closestY = Math.max(c.pos.y - half, Math.min(b.pos.y, c.pos.y + half));
      const dx = b.pos.x - closestX;
      const dy = b.pos.y - closestY;
      if (dx * dx + dy * dy > b.radius * b.radius) continue;
      c.hp = Math.max(0, c.hp - b.damage);
      b.life = 0;
      if (c.hp <= 0) deadCoreIds.push(c.id);
      break; // one bullet only hits one core
    }
  }
  return deadCoreIds;
}

// Player-vs-core collision: push the tank out of any core it overlaps,
// no damage either way. Velocity's inward component is zeroed so the tank
// settles flush against the wall instead of vibrating when WASD is held
// into it.
export function resolvePlayerCoreCollisions(
  cores: Core[],
  playerPos: Vec2,
  playerVel: Vec2,
  tankRadius: number,
): void {
  if (!cores.length) return;
  for (const c of cores) {
    if (c.hp <= 0) continue;
    const half = c.size * 0.5;
    const mtv = aabbCircleMTV(
      c.pos.x - half, c.pos.y - half, c.pos.x + half, c.pos.y + half,
      playerPos.x, playerPos.y, tankRadius,
    );
    if (!mtv) continue;
    playerPos.x += mtv.nx * mtv.pen;
    playerPos.y += mtv.ny * mtv.pen;
    // Strip the velocity component pointing INTO the surface (vIn < 0).
    const vIn = playerVel.x * mtv.nx + playerVel.y * mtv.ny;
    if (vIn < 0) {
      playerVel.x -= mtv.nx * vIn;
      playerVel.y -= mtv.ny * vIn;
    }
  }
}

interface DrawCoreOptions {
  alpha?: number;     // < 1 = preview / ghost
  invalid?: boolean;  // tinted red when preview is in an invalid spot
  showHp?: boolean;
  hpRatio?: number;   // 0..1
}

export function drawCore(
  ctx: CanvasRenderingContext2D,
  core: Pick<Core, 'pos' | 'size' | 'teamId'>,
  camera: { x: number; y: number; width: number; height: number },
  options: DrawCoreOptions = {},
): void {
  const sx = core.pos.x - camera.x;
  const sy = core.pos.y - camera.y;
  const half = core.size / 2;
  if (sx + half < 0 || sx - half > camera.width ||
      sy + half < 0 || sy - half > camera.height) return;

  const alpha = options.alpha ?? 1;
  const invalid = !!options.invalid;
  const palette = getTeamPalette(core.teamId);
  const plateFill = invalid ? '#d8a8a8' : CORE_PLATE_FILL;
  // Invalid-placement always reads as red regardless of team — it's a
  // "blocked" signal, not a team color. Future polish: pick a contrasting
  // warning hue if the local team itself is red.
  const accentFill = invalid ? '#e07070' : palette.accent;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(sx, sy);
  ctx.strokeStyle = CORE_OUTLINE;
  ctx.lineWidth = CORE_OUTLINE_WIDTH;

  // Outer square plate
  ctx.fillStyle = plateFill;
  ctx.beginPath();
  ctx.rect(-half, -half, core.size, core.size);
  ctx.fill();
  ctx.stroke();

  // === Corner panels ===
  // 4 hexagonal panels with one chamfered outer corner each. Each hugs a
  // plate corner and wraps around the closest two diamond edges, leaving
  // small gaps along the cardinal axes for directional arrows.
  const diamondR = core.size * 0.34;
  const platePad = core.size * 0.05;     // panel inset from the plate outline
  const axisGap = core.size * 0.07;      // gap from the central X/Y axes
  const outerChamfer = core.size * 0.12; // chamfer at the panel's outer plate-corner
  const innerOff = core.size * 0.06;     // gap from the diamond's edge
  const dxIn = diamondR + innerOff * Math.SQRT2;

  // TR panel vertices (clockwise, all in the +x, -y quadrant).
  // Mirror across each axis to produce the other three quadrants.
  const panelVertsTR: [number, number][] = [
    [axisGap, -half + platePad],                              // top edge, near central axis
    [half - platePad - outerChamfer, -half + platePad],       // top edge, before outer chamfer
    [half - platePad, -half + platePad + outerChamfer],       // after outer chamfer
    [half - platePad, -axisGap],                              // right edge, near central axis
    [dxIn - axisGap, -axisGap],                               // inner-bottom (corner of L)
    [axisGap, axisGap - dxIn],                                // inner-top (end of diagonal)
  ];
  const panels: [number, number][][] = [
    panelVertsTR,
    panelVertsTR.map(([x, y]) => [-x, y] as [number, number]),   // TL
    panelVertsTR.map(([x, y]) => [-x, -y] as [number, number]),  // BL
    panelVertsTR.map(([x, y]) => [x, -y] as [number, number]),   // BR
  ];

  ctx.fillStyle = '#a1a3a6';
  ctx.strokeStyle = CORE_OUTLINE;
  ctx.lineWidth = 3;
  for (const verts of panels) {
    ctx.beginPath();
    ctx.moveTo(verts[0][0], verts[0][1]);
    for (let i = 1; i < verts.length; i++) {
      ctx.lineTo(verts[i][0], verts[i][1]);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  // Inner diamond — the identifying accent mark
  ctx.fillStyle = accentFill;
  ctx.strokeStyle = CORE_OUTLINE;
  ctx.lineWidth = CORE_OUTLINE_WIDTH;
  ctx.beginPath();
  ctx.moveTo(0, -diamondR);
  ctx.lineTo(diamondR, 0);
  ctx.lineTo(0, diamondR);
  ctx.lineTo(-diamondR, 0);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // === Directional arrows ===
  // Small filled triangles in the gap between each diamond vertex and the
  // plate edge, pointing outward along the cardinal axis.
  const arrowDist = (half + diamondR) / 2;
  const arrowLen = core.size * 0.07;
  const arrowHalfBase = core.size * 0.035;
  const drawArrow = (cx: number, cy: number, dx: number, dy: number) => {
    const tipX = cx + dx * arrowLen * 0.5;
    const tipY = cy + dy * arrowLen * 0.5;
    const baseCX = cx - dx * arrowLen * 0.5;
    const baseCY = cy - dy * arrowLen * 0.5;
    const px = -dy;
    const py = dx;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(baseCX + px * arrowHalfBase, baseCY + py * arrowHalfBase);
    ctx.lineTo(baseCX - px * arrowHalfBase, baseCY - py * arrowHalfBase);
    ctx.closePath();
    ctx.fill();
  };
  ctx.fillStyle = CORE_OUTLINE;
  drawArrow(0, -arrowDist, 0, -1); // top
  drawArrow(arrowDist, 0, 1, 0);    // right
  drawArrow(0, arrowDist, 0, 1);    // bottom
  drawArrow(-arrowDist, 0, -1, 0);  // left

  // Shared inner HP bar — same renderer all structures (walls, future
  // turrets/generators) use, so the damage indicator looks identical
  // everywhere.
  if (options.showHp && options.hpRatio !== undefined) {
    drawInnerHpBar(ctx, core.size, options.hpRatio);
  }

  ctx.restore();
}
