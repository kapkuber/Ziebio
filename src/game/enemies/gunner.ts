// Gunner enemy. Modeled after the machine-gunner tank class in diep/arras:
// big chassis, flared trapezoidal barrel with a dark muzzle band, parallel
// armor-plate detailing at the rear of the hull, high fire rate with
// noticeable spread, beefier bullets. The wave-mid threat — slower than the
// swarm but each one chews through cover quickly.
//
// Sized / statted relative to a fresh lvl-1 player tank:
//   - 1.4× larger body
//   - 3× max HP
//   - 1.5× higher body damage to tanks
//   - 1.2× bullet damage / HP, 1.1× bullet speed
//   - 2× faster reload (half the time between shots = "more reload" in
//     diep's positive-stat language)
//   - ±12° bullet spread (vs the player's ±5° default), giving the
//     machine-gun "spray" feel even at full aim
//
// Visual layout matches the SVG mock the user provided — all decorative
// proportions are expressed as `(svg-unit) * SCALE` where SCALE maps the
// mock's body radius (48) onto GUNNER_RADIUS, so the silhouette stays
// faithful even if GUNNER_RADIUS changes later.
//
// Per CLAUDE.md: gunners carry teamId (drives accent + friend/foe) and
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
const SIZE_SCALE = 1.1;
export const GUNNER_RADIUS = TANK_RADIUS * SIZE_SCALE;

// Maps the SVG mock's "body radius = 48" reference into our actual chassis
// pixels. Every decorative dimension below is `(svg value) * SCALE` so the
// silhouette stays faithful at any GUNNER_RADIUS.
const SCALE = GUNNER_RADIUS / 48;

// Barrel geometry — derived from the mock's polygon points
// "-14,-32 -26,-92 26,-92 14,-32" rotated so +x = aim direction.
// Breech sits INSIDE the body (BARREL_BREECH_X < GUNNER_RADIUS) so the
// chassis circle, drawn after the barrel, covers the breech end.
const BARREL_BREECH_X = 32 * SCALE;
const BARREL_MUZZLE_X = 92 * SCALE;
const BARREL_BREECH_HALF_W = 14 * SCALE;
const BARREL_MUZZLE_HALF_W = 26 * SCALE;
// Dark band at the muzzle tip (rect at "y=-92, h=6, w=44" in the mock).
const MUZZLE_BAND_LEN = 6 * SCALE;
const MUZZLE_BAND_HALF_W = 22 * SCALE;
// Two parallel armor plates behind the chassis (rects at "y=20" and "y=26",
// w=60, h=3 in the mock). In our rotated frame these sit at negative x —
// behind the tank, opposite the barrel direction.
const PLATE_INNER_X = -20 * SCALE;  // edge nearer the chassis center
const PLATE_OUTER_X = -26 * SCALE;  // edge of the second plate, further back
const PLATE_THICKNESS = 3 * SCALE;
const PLATE_HALF_W = 30 * SCALE;
// Centered team accent (mock's "EnemyCore r=10").
const ACCENT_OUTER_R = 10 * SCALE;
const ACCENT_INNER_R = 7 * SCALE;

// Reported to the manager. `barrelLength` covers the polygon's full length
// along its axis (breech to muzzle); the cull check in drawEnemy then adds
// the chassis radius and a safety margin, which leaves enough headroom even
// though the breech is tucked inside the body.
export const GUNNER_BARREL_LENGTH = BARREL_MUZZLE_X - BARREL_BREECH_X;
export const GUNNER_BARREL_WIDTH = BARREL_MUZZLE_HALF_W * 2;

// === Stats ===
export const GUNNER_MAX_HP = BASE_HP * 3;

export const GUNNER_BODY_DAMAGE_TO_TANK =
  BODY_DAMAGE_BASE * BODY_DAMAGE_MULT_TANK * 1.5;

// Per-second damage to a hostile core in contact. Heavier than the swarm
// (10/s) because a gunner is a bigger investment; if it reaches your core,
// it should feel that way.
export const GUNNER_BODY_DAMAGE_TO_CORE = 18;

// Per-tick HP loss a gunner inflicts on a bullet that hits it. Slightly
// above the polygon SHAPE_BASE_DAMAGE values — a base shot still dies on
// one tick but base-pen builds trade HP a bit faster against gunners than
// swarms.
export const GUNNER_BULLET_REDUCTION = 8;

// === Movement / AI ===
// Slower cruise and slower turn rate than the swarm: bigger body, more
// momentum. Front gap also wider so the visual buffer scales with the body.
export const GUNNER_SPEED = 75;
export const GUNNER_TURN_RATE = 3;
export const GUNNER_FRONT_GAP = 18;

// === Firing ===
// Wider engagement envelope than the swarm — gunners pressure from range.
// Aim tolerance is loose because spread randomization happens at fire time
// anyway; tightening the cone would just cost shots without improving aim.
export const GUNNER_AIM_RANGE = 620;
export const GUNNER_FIRE_RANGE = 580;
export const GUNNER_FIRE_TOLERANCE = 0.25;
// Half-cone of bullet spread, in degrees. Each shot picks a uniform random
// deviation in ±GUNNER_SPREAD_DEG from the current aim direction.
export const GUNNER_SPREAD_DEG = 12;

// Bullet stats — all scaled UP from a base lvl-1 player tank shot.
export const GUNNER_BULLET_SPEED = BASE_BULLET_SPEED * 1.1;
export const GUNNER_BULLET_DAMAGE = BASE_BULLET_DAMAGE * 1.2;
export const GUNNER_BULLET_HP = BASE_BULLET_HP * 1.2;
export const GUNNER_BULLET_RADIUS = BULLET_RADIUS;
export const GUNNER_BULLET_LIFETIME = BULLET_LIFETIME;
// Twice as fast as a base tank's reload — the headline machine-gunner stat.
// "Reload" in diep speak is positive (more = faster), so dividing the base
// interval by 2 means 2× shots per second.
export const GUNNER_RELOAD_SECONDS = (BASE_RELOAD_TICKS * TICK_DURATION) / 2;

// === AI ===
// Same target-selection / movement / fire-gate shape as the swarm: aim at
// the nearest hostile in range; fall back to nearest core for movement only
// when nothing's in aim range; walk forward with the building-gap slide,
// fire when in range + aim is on target + reload is up. The two material
// differences from swarm are the bigger numbers (range, HP, damage, reload
// pace) and the per-shot spread randomization at fire time.
function updateGunner(enemy: Enemy, ctx: EnemyUpdateContext): void {
  let aimX = 0, aimY = 0;
  let hasAim = false;
  let bestAimD2 = GUNNER_AIM_RANGE * GUNNER_AIM_RANGE;
  let bestFireD2 = GUNNER_FIRE_RANGE * GUNNER_FIRE_RANGE;
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

  // Movement fallback — nothing engageable in range, head for the core.
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

  // Aim ease.
  const desired = Math.atan2(aimY - enemy.pos.y, aimX - enemy.pos.x);
  let delta = desired - enemy.aimAngle;
  delta = Math.atan2(Math.sin(delta), Math.cos(delta));
  const maxStep = GUNNER_TURN_RATE * ctx.dt;
  enemy.aimAngle += Math.max(-maxStep, Math.min(maxStep, delta));

  // Walk forward in aim direction; building-gap stripping keeps the gunner
  // from grinding into walls.
  const fx = Math.cos(enemy.aimAngle);
  const fy = Math.sin(enemy.aimAngle);
  enemy.vel.x = fx * GUNNER_SPEED;
  enemy.vel.y = fy * GUNNER_SPEED;
  applyBuildingGapToVelocity(enemy, ctx.buildings, GUNNER_FRONT_GAP, enemy.vel);
  enemy.pos.x += enemy.vel.x * ctx.dt;
  enemy.pos.y += enemy.vel.y * ctx.dt;
  enforceBuildingGap(enemy, ctx.buildings, GUNNER_FRONT_GAP);
  applyCoreContact(
    enemy, ctx.cores, ctx.dt, GUNNER_BODY_DAMAGE_TO_CORE, ctx.onCoreDamaged,
  );

  // Fire — each shot picks a fresh random deviation inside ±SPREAD_DEG so
  // the bullets fan out into a cone instead of forming a perfect line. The
  // bullet itself flies straight; the spray comes from per-shot randomness.
  if (
    hasFire &&
    Math.abs(delta) <= GUNNER_FIRE_TOLERANCE &&
    enemy.reloadRemaining <= 0
  ) {
    const spreadRad = (GUNNER_SPREAD_DEG * Math.PI) / 180;
    const deviation = (Math.random() * 2 - 1) * spreadRad;
    const fireAngle = enemy.aimAngle + deviation;
    const dirX = Math.cos(fireAngle);
    const dirY = Math.sin(fireAngle);
    // Spawn at the visible muzzle tip — matches BARREL_MUZZLE_X in the
    // render so the bullet emerges from the dark muzzle band.
    ctx.bullets.push({
      id: ctx.bulletIdRef.current++,
      pos: {
        x: enemy.pos.x + dirX * BARREL_MUZZLE_X,
        y: enemy.pos.y + dirY * BARREL_MUZZLE_X,
      },
      vel: { x: dirX * GUNNER_BULLET_SPEED, y: dirY * GUNNER_BULLET_SPEED },
      radius: GUNNER_BULLET_RADIUS,
      life: GUNNER_BULLET_LIFETIME,
      hp: GUNNER_BULLET_HP,
      maxHp: GUNNER_BULLET_HP,
      damage: GUNNER_BULLET_DAMAGE,
      teamId: enemy.teamId,
    });
    enemy.reloadRemaining = GUNNER_RELOAD_SECONDS;
  }
}

// === Trapezoidal barrel + muzzle band ===
// Canvas is already translated to the chassis center and rotated by aimAngle,
// so +x points down the barrel. Layered so the muzzle band reads as a dark
// ring at the tip on top of the barrel polygon.
function drawGunnerBarrel(ctx: CanvasRenderingContext2D, _enemy: Enemy): void {
  // Flared trapezoid: narrow at the breech, wide at the muzzle.
  ctx.fillStyle = '#999999';
  ctx.strokeStyle = '#727272';
  ctx.lineWidth = 3;
  ctx.lineJoin = 'miter';
  ctx.beginPath();
  ctx.moveTo(BARREL_BREECH_X, -BARREL_BREECH_HALF_W);
  ctx.lineTo(BARREL_MUZZLE_X, -BARREL_MUZZLE_HALF_W);
  ctx.lineTo(BARREL_MUZZLE_X, BARREL_MUZZLE_HALF_W);
  ctx.lineTo(BARREL_BREECH_X, BARREL_BREECH_HALF_W);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Dark muzzle band — outline-color stripe inset from the very tip,
  // matching the mock's "outline @ 0.3 opacity" detail.
  ctx.fillStyle = '#575757';
  ctx.globalAlpha = 0.3;
  ctx.fillRect(
    BARREL_MUZZLE_X - MUZZLE_BAND_LEN,
    -MUZZLE_BAND_HALF_W,
    MUZZLE_BAND_LEN,
    MUZZLE_BAND_HALF_W * 2,
  );
  ctx.globalAlpha = 1;
}

// === Interior render ===
// Two armor-plate stripes at the rear of the chassis (opposite the barrel)
// and the centered two-tone team accent. Both rotate with the chassis so
// the plates always sit "behind" the gun.
function drawGunnerInterior(
  ctx: CanvasRenderingContext2D,
  _enemy: Enemy,
  accent: string,
  accentDim: string,
): void {
  // Armor plates — two parallel stripes behind the chassis center, drawn at
  // outline color with 0.4 opacity so they read as recessed plating instead
  // of bright decals. PLATE_INNER_X / PLATE_OUTER_X are negative (rear of
  // the rotated tank).
  ctx.fillStyle = '#575757';
  ctx.globalAlpha = 0.4;
  ctx.fillRect(
    PLATE_INNER_X - PLATE_THICKNESS,
    -PLATE_HALF_W,
    PLATE_THICKNESS,
    PLATE_HALF_W * 2,
  );
  ctx.fillRect(
    PLATE_OUTER_X - PLATE_THICKNESS,
    -PLATE_HALF_W,
    PLATE_THICKNESS,
    PLATE_HALF_W * 2,
  );
  ctx.globalAlpha = 1;

  // Two-tone team accent — same friend/foe cue the swarm + turret use.
  ctx.fillStyle = accentDim;
  ctx.beginPath();
  ctx.arc(0, 0, ACCENT_OUTER_R, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(0, 0, ACCENT_INNER_R, 0, Math.PI * 2);
  ctx.fill();
}

export const GUNNER_DEF: EnemyDef = {
  kind: 'gunner',
  radius: GUNNER_RADIUS,
  maxHp: GUNNER_MAX_HP,
  bodyDamageToTank: GUNNER_BODY_DAMAGE_TO_TANK,
  bodyDamageToCore: GUNNER_BODY_DAMAGE_TO_CORE,
  bulletReduction: GUNNER_BULLET_REDUCTION,
  barrelLength: GUNNER_BARREL_LENGTH,
  // Custom drawBarrel replaces the default rect, so this width is only the
  // outer dimension (muzzle width) for any future code that asks for it.
  barrelWidth: GUNNER_BARREL_WIDTH,
  update: updateGunner,
  drawInterior: drawGunnerInterior,
  drawBarrel: drawGunnerBarrel,
};
