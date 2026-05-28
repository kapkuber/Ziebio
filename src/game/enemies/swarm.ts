// Swarm enemy. The cheapest wave threat: a smaller, weaker tank silhouette
// that walks toward the nearest hostile core, stops a small gap short of any
// blocking enemy building, and auto-fires weak bullets at the nearest hostile
// in range (player tank, hostile building, or core).
//
// Sized / statted relative to a fresh lvl-1 player tank — everything is 1.5×
// weaker than a base tank's equivalent value:
//   - 1.5× smaller body + barrel
//   - 1.5× less max HP
//   - 1.5× less body damage to tanks
//   - 1.5× less bullet damage / speed / HP / radius
//   - 1.5× slower reload (longer between shots)
//
// Per CLAUDE.md: swarms carry teamId (drives accent + friend/foe) and
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
import {
  BARREL_LENGTH,
  BARREL_WIDTH,
  BULLET_LIFETIME,
  BULLET_RADIUS,
  TANK_RADIUS,
} from '../tank';
import {
  applyBuildingGapToVelocity,
  applyCoreContact,
  enforceBuildingGap,
  type Enemy,
  type EnemyDef,
  type EnemyUpdateContext,
} from './enemySystem';

const SHRINK = 1.5;

// === Sizing ===
export const SWARM_RADIUS = TANK_RADIUS / SHRINK;
export const SWARM_BARREL_LENGTH = BARREL_LENGTH / SHRINK;
export const SWARM_BARREL_WIDTH = BARREL_WIDTH / SHRINK;

// === Stats ===
export const SWARM_MAX_HP = BASE_HP / SHRINK;

// Lvl-1 base body damage to a tank = BODY_DAMAGE_BASE * BODY_DAMAGE_MULT_TANK.
// Swarm carries 1/SHRINK of that, multiplied by impactMultiplierFromSpeed at
// the call site (same model polygons use).
export const SWARM_BODY_DAMAGE_TO_TANK =
  (BODY_DAMAGE_BASE * BODY_DAMAGE_MULT_TANK) / SHRINK;

// Per-second damage applied to a hostile core while the swarm overlaps it.
// Tuned so a single swarm alone is a slow threat (~100s on a fresh core); the
// wave system pushes groups, not singletons.
export const SWARM_BODY_DAMAGE_TO_CORE = 10;

// Per-tick HP loss a swarm inflicts on a bullet that hits it. Matches the
// polygon SHAPE_BASE_DAMAGE values — a base shot dies in one tick the way it
// does on a square, high-pen shots keep ticking.
export const SWARM_BULLET_REDUCTION = 7;

// === Movement / AI ===
export const SWARM_SPEED = 110;          // px/s linear cruise
export const SWARM_TURN_RATE = 4;        // rad/s — barrel eases toward target
// Soft buffer the swarm keeps in front of any hostile building. The inward
// velocity component is stripped when the swarm enters this gap, so it slides
// along walls instead of pushing into them.
export const SWARM_FRONT_GAP = 14;

// === Firing ===
// Range within which the swarm aims at + fires on the closest hostile target.
// Aim range slightly wider than fire range so the chassis pre-aligns before
// the target is shootable — feels less twitchy on engagement.
export const SWARM_AIM_RANGE = 520;
export const SWARM_FIRE_RANGE = 480;
export const SWARM_FIRE_TOLERANCE = 0.18; // rad — must be in cone to shoot

// Bullet stats — all 1/SHRINK of a base lvl-1 player tank shot.
export const SWARM_BULLET_SPEED = BASE_BULLET_SPEED / SHRINK;
export const SWARM_BULLET_DAMAGE = BASE_BULLET_DAMAGE / SHRINK;
export const SWARM_BULLET_HP = BASE_BULLET_HP / SHRINK;
export const SWARM_BULLET_RADIUS = BULLET_RADIUS / SHRINK;
export const SWARM_BULLET_LIFETIME = BULLET_LIFETIME;
// Reload is SLOWER by SHRINK (longer between shots) — keeps the "1.5× less
// offensive output" theme consistent across damage AND fire rate.
export const SWARM_RELOAD_SECONDS = BASE_RELOAD_TICKS * TICK_DURATION * 1;

// === AI ===
// 1. Scan player / hostile buildings / hostile cores for the nearest target
//    inside SWARM_AIM_RANGE. That's the engage target (aim + fire).
// 2. If no engage target, fall back to the nearest hostile core as the
//    movement-only target. Without a target at all, idle.
// 3. Ease aimAngle toward the chosen target.
// 4. Velocity = aim direction * SWARM_SPEED, gated by the building gap.
// 5. Integrate, hard-enforce the gap, apply core-contact damage.
// 6. Fire if engage target is inside SWARM_FIRE_RANGE, aim is on target, and
//    reload is up. Bullet spawns at the muzzle (radius + barrel) and carries
//    the swarm's teamId so friendly-fire follows the same rules as the
//    player's bullets.
function updateSwarm(enemy: Enemy, ctx: EnemyUpdateContext): void {
  let aimX = 0, aimY = 0;
  let hasAim = false;
  let bestAimD2 = SWARM_AIM_RANGE * SWARM_AIM_RANGE;
  let bestFireD2 = SWARM_FIRE_RANGE * SWARM_FIRE_RANGE;
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

  // Movement fallback when nothing's in aim range: head to the nearest core.
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

  // Aim — ease aimAngle toward the target.
  const desired = Math.atan2(aimY - enemy.pos.y, aimX - enemy.pos.x);
  let delta = desired - enemy.aimAngle;
  delta = Math.atan2(Math.sin(delta), Math.cos(delta));
  const maxStep = SWARM_TURN_RATE * ctx.dt;
  enemy.aimAngle += Math.max(-maxStep, Math.min(maxStep, delta));

  // Walk forward in aim direction; strip inward component vs hostile
  // buildings so we slide rather than bump.
  const fx = Math.cos(enemy.aimAngle);
  const fy = Math.sin(enemy.aimAngle);
  enemy.vel.x = fx * SWARM_SPEED;
  enemy.vel.y = fy * SWARM_SPEED;
  applyBuildingGapToVelocity(enemy, ctx.buildings, SWARM_FRONT_GAP, enemy.vel);
  enemy.pos.x += enemy.vel.x * ctx.dt;
  enemy.pos.y += enemy.vel.y * ctx.dt;
  enforceBuildingGap(enemy, ctx.buildings, SWARM_FRONT_GAP);
  applyCoreContact(
    enemy, ctx.cores, ctx.dt, SWARM_BODY_DAMAGE_TO_CORE, ctx.onCoreDamaged,
  );

  // Fire if aim landed on a target inside firing range and reload is up.
  if (
    hasFire &&
    Math.abs(delta) <= SWARM_FIRE_TOLERANCE &&
    enemy.reloadRemaining <= 0
  ) {
    const muzzleDist = SWARM_RADIUS + SWARM_BARREL_LENGTH;
    const dirX = Math.cos(enemy.aimAngle);
    const dirY = Math.sin(enemy.aimAngle);
    ctx.bullets.push({
      id: ctx.bulletIdRef.current++,
      pos: {
        x: enemy.pos.x + dirX * muzzleDist,
        y: enemy.pos.y + dirY * muzzleDist,
      },
      vel: { x: dirX * SWARM_BULLET_SPEED, y: dirY * SWARM_BULLET_SPEED },
      radius: SWARM_BULLET_RADIUS,
      life: SWARM_BULLET_LIFETIME,
      hp: SWARM_BULLET_HP,
      maxHp: SWARM_BULLET_HP,
      damage: SWARM_BULLET_DAMAGE,
      teamId: enemy.teamId,
    });
    enemy.reloadRemaining = SWARM_RELOAD_SECONDS;
  }
}

// === Interior render ===
// Two-tone team accent at the center — the only friend/foe cue on the
// chassis, matching the turret's "team accent at the core" signal.
function drawSwarmInterior(
  ctx: CanvasRenderingContext2D,
  _enemy: Enemy,
  accent: string,
  accentDim: string,
): void {
  ctx.fillStyle = accentDim;
  ctx.beginPath();
  ctx.arc(0, 0, SWARM_RADIUS * 0.34, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(0, 0, SWARM_RADIUS * 0.26, 0, Math.PI * 2);
  ctx.fill();
}

export const SWARM_DEF: EnemyDef = {
  kind: 'swarm',
  radius: SWARM_RADIUS,
  maxHp: SWARM_MAX_HP,
  bodyDamageToTank: SWARM_BODY_DAMAGE_TO_TANK,
  bodyDamageToCore: SWARM_BODY_DAMAGE_TO_CORE,
  bulletReduction: SWARM_BULLET_REDUCTION,
  barrelLength: SWARM_BARREL_LENGTH,
  barrelWidth: SWARM_BARREL_WIDTH,
  update: updateSwarm,
  drawInterior: drawSwarmInterior,
};
