// Turret defense building. Active defender: auto-aims at hostile tanks and
// wave enemies in range, then fires 1.5×-base bullets at 1.5× rate. Polygons
// (square/triangle/pentagon) are world resources, not threats — the turret
// ignores them entirely for target acquisition. Stray hits from a shot that
// happens to clip a polygon mid-flight are fine (handled by the bullet system),
// but the turret will never CHOOSE a polygon as its target.
//
// Visual is a tank-style turret head on the shared chassis plate: rotating
// circular cap + barrel echo the player tank silhouette so the structure
// reads as "active weapon" at a glance.

import { GRID_SIZE } from '../config';
import type { Vec2 } from '../entities';
import {
  BASE_BULLET_DAMAGE,
  BASE_BULLET_HP,
  BASE_BULLET_SPEED,
  BASE_RELOAD_TICKS,
  TICK_DURATION,
} from '../stats';
import { BULLET_LIFETIME, BULLET_RADIUS, type Bullet } from '../tank';
import { LOCAL_PLAYER_TEAM, type TeamId } from '../teams';
import type { Building, BuildingDef } from './buildingSystem';

// === Constants ===
export const TURRET_GRID_CELLS = 4;
export const TURRET_SIZE = TURRET_GRID_CELLS * GRID_SIZE;
export const TURRET_MAX_HP = 400;
// Same family as the flux generator: stout chassis, modest reciprocal body
// damage to polygons. The real threat output is the barrel, not the plate.
export const TURRET_BODY_DAMAGE_TO_ENTITY = 20;
export const TURRET_BODY_DAMAGE_FROM_ENTITY = 8;
export const TURRET_FLUX_COST = 0;
export const TURRET_MAX_COUNT = 8;

// Bullet stats — 1.5× a base lvl-1 player tank shot on damage / penetration /
// speed / fire-rate. Diep/arras stat language treats "reload" as a positive
// (more = faster), so 1.5× reload = 1.5× shots/sec = BASE_RELOAD / 1.5
// seconds between shots. Bullets are 2× the visual radius of a base shot.
export const TURRET_BULLET_DAMAGE = BASE_BULLET_DAMAGE * 1.5;
export const TURRET_BULLET_HP = BASE_BULLET_HP * 1.5;
export const TURRET_BULLET_SPEED = BASE_BULLET_SPEED * 1.5;
export const TURRET_RELOAD_SECONDS = (BASE_RELOAD_TICKS * TICK_DURATION) / 1;
export const TURRET_BULLET_RADIUS = BULLET_RADIUS * 2;
export const TURRET_BULLET_LIFETIME = BULLET_LIFETIME;

// Acquisition + aim tuning.
export const TURRET_RANGE = 600;            // px — ~24 grid cells
export const TURRET_TURN_RATE = 6;          // rad/sec
export const TURRET_FIRE_TOLERANCE = 0.12;  // rad — must be in cone to fire

// Visual layout. The interior is drawn in a "design-space" coordinate system
// where the octagonal base's flat sides sit at ±75.76 units (matches the
// reference mock). DESIGN_SCALE maps that to half the chassis pixel size so
// the octagon's flat edges exactly touch the chassis edges — leaving the
// four chassis corners as small triangular wedges around it.
//
// BARREL_TIP_FRAC also feeds the bullet spawn distance in updateTurrets,
// so the muzzle the player sees IS where bullets come from. It's set just
// past the chassis diagonal (sqrt(2)/2 ≈ 0.707) so bullets always spawn
// outside the building's AABB regardless of aim angle.
const DESIGN_HALF = 75.76;              // octagon flat-side extent in design units
const BARREL_TIP_FRAC = 0.55;           // muzzle position = bullet spawn
const BARREL_BASE_FRAC = 0.08;          // barrel breech tucked under the cylinder
const CYLINDER_DESIGN_R = 38;           // central head radius (design units)
const INNER_RING_DESIGN_R = 13;         // inner mechanism ring radius
const CORE_DIM_DESIGN_R = 7;            // accentDim core
const CORE_BRIGHT_DESIGN_R = 6;         // accent core (team color)
const BARREL_HALF_W_DESIGN = 18;        // barrel half-width perpendicular to aim

// === Factory ===
export function createTurret(
  id: number,
  center: Vec2,
  teamId: TeamId = LOCAL_PLAYER_TEAM,
  ownerId: number = 0,
): Building {
  return {
    id,
    kind: 'turret',
    pos: { x: center.x, y: center.y },
    size: TURRET_SIZE,
    hp: TURRET_MAX_HP,
    maxHp: TURRET_MAX_HP,
    ownerId,
    teamId,
    aimAngle: -Math.PI / 2, // default barrel points up
    reloadRemaining: 0,
  };
}

// === Target acquisition + per-frame update ===
// A target is anything the turret should shoot at: enemy tanks, wave enemies.
// Polygons are intentionally NOT included by the caller — they're world
// resources, not threats.
export interface TurretTarget {
  pos: Vec2;
  teamId: TeamId;
}

// Walks turret buildings, picks the nearest hostile target in range, smooth-
// rotates toward it, and fires a 1.5× bullet from the barrel tip when reload
// is up and the aim is inside the firing cone. Pushes new bullets into the
// caller's array so they participate in the existing pipeline (bullet-vs-
// entity damage, bullet-vs-bullet HP swap, friend/foe via teamId).
export function updateTurrets(
  buildings: Building[],
  bullets: Bullet[],
  bulletIdRef: { current: number },
  dt: number,
  targets: TurretTarget[],
): void {
  for (const b of buildings) {
    if (b.kind !== 'turret' || b.hp <= 0) continue;
    // Tick reload regardless of target — the next shot is ready the moment
    // something walks into range.
    b.reloadRemaining = Math.max(0, (b.reloadRemaining ?? 0) - dt);

    // Find nearest hostile target inside range.
    let bestT: TurretTarget | null = null;
    let bestD2 = TURRET_RANGE * TURRET_RANGE;
    for (const t of targets) {
      if (t.teamId === b.teamId) continue;
      const dx = t.pos.x - b.pos.x;
      const dy = t.pos.y - b.pos.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) { bestD2 = d2; bestT = t; }
    }
    if (!bestT) continue;

    const desired = Math.atan2(bestT.pos.y - b.pos.y, bestT.pos.x - b.pos.x);
    const current = b.aimAngle ?? desired;
    // Shortest-path angular delta in (-PI, PI].
    let delta = desired - current;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta));
    const maxStep = TURRET_TURN_RATE * dt;
    const step = Math.max(-maxStep, Math.min(maxStep, delta));
    b.aimAngle = current + step;

    if (Math.abs(delta) <= TURRET_FIRE_TOLERANCE && (b.reloadRemaining ?? 0) <= 0) {
      const dirX = Math.cos(b.aimAngle);
      const dirY = Math.sin(b.aimAngle);
      const barrelTipDist = TURRET_SIZE * BARREL_TIP_FRAC;
      bullets.push({
        id: bulletIdRef.current++,
        pos: {
          x: b.pos.x + dirX * barrelTipDist,
          y: b.pos.y + dirY * barrelTipDist,
        },
        vel: {
          x: dirX * TURRET_BULLET_SPEED,
          y: dirY * TURRET_BULLET_SPEED,
        },
        radius: TURRET_BULLET_RADIUS,
        life: TURRET_BULLET_LIFETIME,
        hp: TURRET_BULLET_HP,
        maxHp: TURRET_BULLET_HP,
        damage: TURRET_BULLET_DAMAGE,
        teamId: b.teamId,
        attributable: false,
      });
      b.reloadRemaining = TURRET_RELOAD_SECONDS;
    }
  }
}

// === Interior render ===
// Drawn after the shared chassis plate; origin already at tile center, default
// stroke style set. Barrel rotates with the building's aimAngle (defaults
// pointing up for placement previews that have no live aim yet).
//
// Layout (bottom → top):
//   1. Octagonal armored base (fills the chassis; chassis corners show as
//      small triangular wedges around it).
//   2. Inner octagon outline + 4 corner bolts (decorative armor plating).
//   3. Barrel — short stubby rect, rotates with aim; muzzle vent at the tip.
//   4. Central head cylinder + inner mechanism ring (gray two-tone).
//   5. Core — accentDim ring + accent bright dot (the only team-colored
//      elements; pulls the eye to "side X owns this" first).
function drawTurretInterior(
  ctx: CanvasRenderingContext2D,
  size: number,
  accent: string,
  accentDim: string,
  invalid: boolean,
  aimAngle?: number,
): void {
  const aim = aimAngle ?? -Math.PI / 2;
  const half = size / 2;
  // Maps reference design units → chassis pixels. With the octagon's flat
  // sides at ±DESIGN_HALF in design space, S * DESIGN_HALF = half, so the
  // octagon's flat edges land exactly on the chassis edges.
  const S = half / DESIGN_HALF;

  const STROKE = '#575757';
  const baseFill = invalid ? '#bd8c8c' : '#909295';   // octagon: darker than chassis
  const ringFill = invalid ? '#9e7575' : '#909295';   // inner mechanism ring
  const hardware = invalid ? '#bd8c8c' : '#a1a3a6';   // barrel + central cylinder

  // === Octagonal base ===
  ctx.fillStyle = baseFill;
  ctx.strokeStyle = STROKE;
  ctx.lineWidth = 3;
  const oct: ReadonlyArray<readonly [number, number]> = [
    [75.76, 31.38], [31.38, 75.76], [-31.38, 75.76], [-75.76, 31.38],
    [-75.76, -31.38], [-31.38, -75.76], [31.38, -75.76], [75.76, -31.38],
  ];
  ctx.beginPath();
  ctx.moveTo(oct[0][0] * S, oct[0][1] * S);
  for (let i = 1; i < 8; i++) ctx.lineTo(oct[i][0] * S, oct[i][1] * S);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Inner octagon outline — armor plating cue.
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 1.5;
  const innerOct: ReadonlyArray<readonly [number, number]> = [
    [59.13, 24.49], [24.49, 59.13], [-24.49, 59.13], [-59.13, 24.49],
    [-59.13, -24.49], [-24.49, -59.13], [24.49, -59.13], [59.13, -24.49],
  ];
  ctx.beginPath();
  ctx.moveTo(innerOct[0][0] * S, innerOct[0][1] * S);
  for (let i = 1; i < 8; i++) ctx.lineTo(innerOct[i][0] * S, innerOct[i][1] * S);
  ctx.closePath();
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Corner bolts on four alternating octagon vertices.
  ctx.fillStyle = STROKE;
  const bolts: ReadonlyArray<readonly [number, number]> = [
    [64.67, 26.79], [-26.79, 64.67], [-64.67, -26.79], [26.79, -64.67],
  ];
  for (const [bx, by] of bolts) {
    ctx.beginPath();
    ctx.arc(bx * S, by * S, 3.5 * S, 0, Math.PI * 2);
    ctx.fill();
  }

  // === Barrel (rotates with aim) ===
  // Drawn pointing along +x so ctx.rotate(aim) lines it up with the aim
  // vector. Tip lands at BARREL_TIP_FRAC * size — same value the bullet
  // spawn in updateTurrets uses, so the visible muzzle IS the shot origin.
  // Breech tucks under the central cylinder; only the protruding length
  // is visible.
  ctx.save();
  ctx.rotate(aim);
  const barrelTip = size * BARREL_TIP_FRAC;
  const barrelBase = size * BARREL_BASE_FRAC;
  const barrelHalfW = BARREL_HALF_W_DESIGN * S;

  ctx.fillStyle = hardware;
  ctx.strokeStyle = STROKE;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.rect(barrelBase, -barrelHalfW, barrelTip - barrelBase, barrelHalfW * 2);
  ctx.fill();
  ctx.stroke();

  // Muzzle vent — short dark band at the tip.
  ctx.fillStyle = STROKE;
  ctx.globalAlpha = 0.4;
  const ventLen = 6 * S;
  ctx.beginPath();
  ctx.rect(barrelTip - ventLen, -10 * S, ventLen, 20 * S);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.restore();

  // === Central head cylinder ===
  ctx.fillStyle = hardware;
  ctx.strokeStyle = STROKE;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, 0, CYLINDER_DESIGN_R * S, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Inner mechanism ring — smaller concentric disc.
  ctx.fillStyle = ringFill;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, INNER_RING_DESIGN_R * S, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // === Core (team color) ===
  // Two-tone team accent at dead center — the only friend/foe cue on the
  // turret. accentDim is the outer ring, accent the bright inner glow.
  ctx.fillStyle = accentDim;
  ctx.beginPath();
  ctx.arc(0, 0, CORE_DIM_DESIGN_R * S, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(0, 0, CORE_BRIGHT_DESIGN_R * S, 0, Math.PI * 2);
  ctx.fill();
}

// === Registry def ===
export const TURRET_DEF: BuildingDef = {
  kind: 'turret',
  gridCells: TURRET_GRID_CELLS,
  size: TURRET_SIZE,
  maxHp: TURRET_MAX_HP,
  bodyDamageToEntity: TURRET_BODY_DAMAGE_TO_ENTITY,
  bodyDamageFromEntity: TURRET_BODY_DAMAGE_FROM_ENTITY,
  drawInterior: drawTurretInterior,
};
