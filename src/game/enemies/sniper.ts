// Sniper enemy. Modeled after the sniper class in diep/arras: long thin
// barrel with a scope housing partway down, fragile chassis, and one heavy
// bullet at a time. Unlike the swarm/gunner — both of which path straight
// at their target — the sniper KITES: it picks a stand-off range and tries
// to hold it, backing up when the target closes and stepping forward when
// the target drifts out. Aim and movement are decoupled (always face the
// target; move toward / away to maintain distance).
//
// Sized / statted relative to the other enemies:
//   - body slightly smaller than the gunner (1.0× tank radius vs 1.1×)
//   - lower max HP than the gunner (75 vs 150)
//   - higher bullet damage (2× base), higher bullet HP / "penetration"
//     (2.5× base), higher bullet speed (1.8× base)
//   - slower reload (2× the base interval) — heavy precise shots, not spray
//   - tight fire cone (±0.1 rad) and no per-shot spread
//   - much wider aim + fire ranges (900 / 850) so it threatens from across
//     the field
//
// Visual layout follows the SVG mock the user provided (skip the dashed
// targeting ring per their instruction). All decorative dimensions are
// `(svg-unit) * SCALE` where SCALE maps the mock's body radius (36) onto
// SNIPER_RADIUS, so the silhouette stays faithful at any chassis size.
//
// Per CLAUDE.md: snipers carry teamId (drives accent + friend/foe) and
// ownerId (reserved for kill attribution).

import {
  BASE_BULLET_DAMAGE,
  BASE_BULLET_HP,
  BASE_BULLET_SPEED,
  BASE_HP,
  BASE_RELOAD_TICKS,
  BODY_DAMAGE_BASE,
  BODY_DAMAGE_MULT_TANK,
  TICK_DURATION,
} from '../stats';
import { BULLET_LIFETIME, BULLET_RADIUS, TANK_RADIUS } from '../tank';
import {
  applyBuildingGapToVelocity,
  applyCoreContact,
  enforceBuildingGap,
  type Enemy,
  type EnemyDef,
  type EnemyUpdateContext,
} from './enemySystem';

// === Sizing ===
const SIZE_SCALE = 1.0;
export const SNIPER_RADIUS = TANK_RADIUS * SIZE_SCALE;

// Maps the SVG mock's "body radius = 36" reference into chassis pixels.
const SCALE = SNIPER_RADIUS / 36;

// Barrel geometry — derived from the mock's rect at x=-11, y=-100, w=22,
// h=75 (so y from -100 to -25), rotated so +x = aim direction. Breech sits
// inside the body (BARREL_BREECH_X < SNIPER_RADIUS) so the chassis covers
// the breech when drawn afterward.
const BARREL_BREECH_X = 25 * SCALE;
const BARREL_MUZZLE_X = 100 * SCALE;
const BARREL_HALF_W = 11 * SCALE;
// Dark muzzle band — outline-color stripe inset from the very tip
// (mock rect x=-8, y=-100, w=16, h=6).
const MUZZLE_BAND_LEN = 6 * SCALE;
const MUZZLE_BAND_HALF_W = 8 * SCALE;
// Scope housing — small lighter-gray cross-piece on the barrel about a
// third of the way back from the muzzle (mock rect x=-9, y=-70, w=18, h=5).
const SCOPE_BREECH_X = 65 * SCALE;
const SCOPE_MUZZLE_X = 70 * SCALE;
const SCOPE_HALF_W = 9 * SCALE;
// Forward-pointing red threat chevron inside the chassis (mock path
// M -8 -16 L 0 -22 L 8 -16). After rotation: (16, ±8) at the back, (22, 0)
// at the tip — points down the barrel direction.
const CHEVRON_BACK_X = 16 * SCALE;
const CHEVRON_FRONT_X = 22 * SCALE;
const CHEVRON_HALF_W = 8 * SCALE;
// Centered team accent (mock's "EnemyCore r=9"). Inner ring slightly smaller
// than the outer for the same friend/foe two-tone the swarm + gunner use.
const ACCENT_OUTER_R = 9 * SCALE;
const ACCENT_INNER_R = 7 * SCALE;

// Reported to the manager. `barrelLength` covers the polygon's full length
// along its axis (breech to muzzle); the cull check then adds the chassis
// radius and a safety margin.
export const SNIPER_BARREL_LENGTH = BARREL_MUZZLE_X - BARREL_BREECH_X;
export const SNIPER_BARREL_WIDTH = BARREL_HALF_W * 2;

// === Stats ===
// Half of a gunner's HP — snipers can't trade up close, they have to keep
// distance to survive.
export const SNIPER_MAX_HP = BASE_HP * 1.5;

export const SNIPER_BODY_DAMAGE_TO_TANK =
  BODY_DAMAGE_BASE * BODY_DAMAGE_MULT_TANK * 1.0;

// Snipers should rarely reach a core (they're trying to stand off), so the
// per-second core damage is low — a sniper in your face is the failure mode,
// not the design target.
export const SNIPER_BODY_DAMAGE_TO_CORE = 6;

// Per-tick HP loss a sniper inflicts on a bullet that hits it. Same as the
// swarm — fragile chassis, a base shot drops it fast.
export const SNIPER_BULLET_REDUCTION = 7;

// === Movement / AI ===
export const SNIPER_SPEED = 70;
export const SNIPER_TURN_RATE = 4;
export const SNIPER_FRONT_GAP = 14;

// Stand-off behavior. The sniper tries to hold SNIPER_DESIRED_DISTANCE from
// its firing target. KITE_BUFFER is the half-width of the dead band around
// it where the sniper just stands still — without a buffer the chassis would
// jitter forward/back at the boundary.
export const SNIPER_DESIRED_DISTANCE = 500;
export const SNIPER_KITE_BUFFER = 60;

// === Firing ===
// Much wider engagement envelope than the other enemies — snipers threaten
// from across the field. Aim tolerance is tight because precision IS the
// fantasy; combined with no per-shot spread, every shot is deliberate.
export const SNIPER_AIM_RANGE = 900;
export const SNIPER_FIRE_RANGE = 850;
export const SNIPER_FIRE_TOLERANCE = 0.1;

// Bullet stats — fast, hard-hitting, high "penetration" (high bullet HP).
export const SNIPER_BULLET_SPEED = BASE_BULLET_SPEED * 1.8;
export const SNIPER_BULLET_DAMAGE = BASE_BULLET_DAMAGE * 2.0;
export const SNIPER_BULLET_HP = BASE_BULLET_HP * 2.5;
export const SNIPER_BULLET_RADIUS = BULLET_RADIUS;
export const SNIPER_BULLET_LIFETIME = BULLET_LIFETIME;
// Twice as slow as a base tank's reload — half the shots/sec. The user
// explicitly asked for slow reload; this is the headline "deliberate shot"
// stat for the sniper.
export const SNIPER_RELOAD_SECONDS = BASE_RELOAD_TICKS * TICK_DURATION * 2;

// === AI ===
// Same target acquisition as the other tank-style enemies, but movement
// decouples from aim:
//   - Aim eases toward the chosen target every frame (same as swarm/gunner).
//   - Movement = +forward when too far from the engage target, -forward
//     when too close, zero in the sweet spot. Without an engage target,
//     close on the fallback core at full speed.
// The "+forward" direction is just `cos/sin(aimAngle)` — since aim always
// points at the target, forward = toward target and backward = away.
function updateSniper(enemy: Enemy, ctx: EnemyUpdateContext): void {
  let aimX = 0, aimY = 0;
  let hasAim = false;
  let bestAimD2 = SNIPER_AIM_RANGE * SNIPER_AIM_RANGE;
  let bestFireD2 = SNIPER_FIRE_RANGE * SNIPER_FIRE_RANGE;
  let hasFire = false;

  const consider = (tx: number, ty: number) => {
    const dx = tx - enemy.pos.x;
    const dy = ty - enemy.pos.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestAimD2) {
      bestAimD2 = d2;
      aimX = tx; aimY = ty;
      hasAim = true;
    }
    if (d2 < bestFireD2) {
      bestFireD2 = d2;
      hasFire = true;
    }
  };
  if (ctx.playerPos && ctx.playerTeamId !== enemy.teamId) {
    consider(ctx.playerPos.x, ctx.playerPos.y);
  }
  for (const b of ctx.buildings) {
    if (b.hp <= 0 || b.teamId === enemy.teamId) continue;
    consider(b.pos.x, b.pos.y);
  }
  for (const c of ctx.cores) {
    if (c.hp <= 0 || c.teamId === enemy.teamId) continue;
    consider(c.pos.x, c.pos.y);
  }

  // Movement fallback — nothing in aim range, head for the nearest core so
  // the sniper eventually engages something instead of idling at spawn.
  if (!hasAim) {
    let bestD2 = Infinity;
    for (const c of ctx.cores) {
      if (c.hp <= 0 || c.teamId === enemy.teamId) continue;
      const dx = c.pos.x - enemy.pos.x;
      const dy = c.pos.y - enemy.pos.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) { bestD2 = d2; aimX = c.pos.x; aimY = c.pos.y; hasAim = true; }
    }
    if (!hasAim) {
      enemy.vel.x = 0; enemy.vel.y = 0;
      return;
    }
  }

  // Aim ease — always tracks the chosen target, even when standing still
  // in the kite sweet spot.
  const desired = Math.atan2(aimY - enemy.pos.y, aimX - enemy.pos.x);
  let delta = desired - enemy.aimAngle;
  delta = Math.atan2(Math.sin(delta), Math.cos(delta));
  const maxStep = SNIPER_TURN_RATE * ctx.dt;
  enemy.aimAngle += Math.max(-maxStep, Math.min(maxStep, delta));

  // Kiting movement. If there's an engage target, hold SNIPER_DESIRED_DISTANCE
  // from it; otherwise we only have a fallback core target, so just close.
  // `speedMul`: +1 = move toward, -1 = away, 0 = hold.
  let speedMul = 1;
  if (hasFire) {
    const dist = Math.sqrt(bestAimD2);
    if (dist < SNIPER_DESIRED_DISTANCE - SNIPER_KITE_BUFFER) speedMul = -1;
    else if (dist > SNIPER_DESIRED_DISTANCE + SNIPER_KITE_BUFFER) speedMul = 1;
    else speedMul = 0;
  }
  const fx = Math.cos(enemy.aimAngle);
  const fy = Math.sin(enemy.aimAngle);
  enemy.vel.x = fx * SNIPER_SPEED * speedMul;
  enemy.vel.y = fy * SNIPER_SPEED * speedMul;
  applyBuildingGapToVelocity(enemy, ctx.buildings, SNIPER_FRONT_GAP, enemy.vel);
  enemy.pos.x += enemy.vel.x * ctx.dt;
  enemy.pos.y += enemy.vel.y * ctx.dt;
  enforceBuildingGap(enemy, ctx.buildings, SNIPER_FRONT_GAP);
  applyCoreContact(
    enemy, ctx.cores, ctx.dt, SNIPER_BODY_DAMAGE_TO_CORE, ctx.onCoreDamaged,
  );

  // Fire — no per-shot spread (the sniper is precise by design). Tight
  // FIRE_TOLERANCE keeps the chassis from snapping off shots while still
  // rotating onto the target.
  if (
    hasFire &&
    Math.abs(delta) <= SNIPER_FIRE_TOLERANCE &&
    enemy.reloadRemaining <= 0
  ) {
    const dirX = Math.cos(enemy.aimAngle);
    const dirY = Math.sin(enemy.aimAngle);
    ctx.bullets.push({
      id: ctx.bulletIdRef.current++,
      pos: {
        x: enemy.pos.x + dirX * BARREL_MUZZLE_X,
        y: enemy.pos.y + dirY * BARREL_MUZZLE_X,
      },
      vel: { x: dirX * SNIPER_BULLET_SPEED, y: dirY * SNIPER_BULLET_SPEED },
      radius: SNIPER_BULLET_RADIUS,
      life: SNIPER_BULLET_LIFETIME,
      hp: SNIPER_BULLET_HP,
      maxHp: SNIPER_BULLET_HP,
      damage: SNIPER_BULLET_DAMAGE,
      teamId: enemy.teamId,
    });
    enemy.reloadRemaining = SNIPER_RELOAD_SECONDS;
  }
}

// === Long thin barrel + scope + muzzle band ===
// Canvas is already translated to the chassis center and rotated by aimAngle,
// so +x points down the barrel. Layered breech-to-muzzle: main rect, then
// dark muzzle band on top at the tip, then the lighter scope housing
// crosspiece partway down the barrel.
function drawSniperBarrel(ctx: CanvasRenderingContext2D, _enemy: Enemy): void {
  // Long thin barrel.
  ctx.fillStyle = '#999999';
  ctx.strokeStyle = '#727272';
  ctx.lineWidth = 3;
  ctx.lineJoin = 'miter';
  ctx.beginPath();
  ctx.rect(
    BARREL_BREECH_X,
    -BARREL_HALF_W,
    BARREL_MUZZLE_X - BARREL_BREECH_X,
    BARREL_HALF_W * 2,
  );
  ctx.fill();
  ctx.stroke();

  // Dark muzzle band — outline-color stripe at 0.3 opacity, slightly
  // narrower than the barrel.
  ctx.fillStyle = '#575757';
  ctx.globalAlpha = 0.3;
  ctx.fillRect(
    BARREL_MUZZLE_X - MUZZLE_BAND_LEN,
    -MUZZLE_BAND_HALF_W,
    MUZZLE_BAND_LEN,
    MUZZLE_BAND_HALF_W * 2,
  );
  ctx.globalAlpha = 1;

  // Scope housing — small lighter-gray bar across the barrel partway down,
  // with its own thinner outline (the mock uses strokeWidth=1.5 vs the
  // barrel's 3).
  ctx.fillStyle = '#a8aaad';
  ctx.strokeStyle = '#575757';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.rect(
    SCOPE_BREECH_X,
    -SCOPE_HALF_W,
    SCOPE_MUZZLE_X - SCOPE_BREECH_X,
    SCOPE_HALF_W * 2,
  );
  ctx.fill();
  ctx.stroke();
}

// === Interior render ===
// Forward-pointing red chevron + centered two-tone team accent. The chevron
// sits inside the chassis between the accent and the barrel, pointing in
// +x — it rotates with the chassis so it always reads as "the sniper is
// looking THAT way".
function drawSniperInterior(
  ctx: CanvasRenderingContext2D,
  _enemy: Enemy,
  accent: string,
  accentDim: string,
): void {
  // Red threat chevron — stroke only, no fill, 0.7 opacity to feel like a
  // tactical sight marker rather than a solid decal.
  ctx.strokeStyle = '#D83848';
  ctx.lineWidth = 2;
  ctx.lineJoin = 'miter';
  ctx.lineCap = 'butt';
  ctx.globalAlpha = 0.7;
  ctx.beginPath();
  ctx.moveTo(CHEVRON_BACK_X, -CHEVRON_HALF_W);
  ctx.lineTo(CHEVRON_FRONT_X, 0);
  ctx.lineTo(CHEVRON_BACK_X, CHEVRON_HALF_W);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Two-tone team accent — same friend/foe cue the swarm + gunner + turret
  // use.
  ctx.fillStyle = accentDim;
  ctx.beginPath();
  ctx.arc(0, 0, ACCENT_OUTER_R, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(0, 0, ACCENT_INNER_R, 0, Math.PI * 2);
  ctx.fill();
}

export const SNIPER_DEF: EnemyDef = {
  kind: 'sniper',
  radius: SNIPER_RADIUS,
  maxHp: SNIPER_MAX_HP,
  bodyDamageToTank: SNIPER_BODY_DAMAGE_TO_TANK,
  bodyDamageToCore: SNIPER_BODY_DAMAGE_TO_CORE,
  bulletReduction: SNIPER_BULLET_REDUCTION,
  barrelLength: SNIPER_BARREL_LENGTH,
  barrelWidth: SNIPER_BARREL_WIDTH,
  update: updateSniper,
  drawInterior: drawSniperInterior,
  drawBarrel: drawSniperBarrel,
};
