// Rusher enemy. Spinning melee tank — no barrel, just a constantly rotating
// chassis ringed with blades. Walks straight at the nearest hostile target
// at high speed and detonates on contact, dealing a big burst of damage and
// self-destructing.
//
// === The "low HP, huge damage" paradox ===
// The shared collision helpers (resolvePlayerEnemyCollisions, applyCoreContact)
// scale an enemy's outgoing damage by its death-factor when the incoming
// damage would kill it that frame — so a 35-HP body normally can't deliver
// 100+ damage to a tank, because the enemy "died" before delivering full
// output. That clamping is correct for trading-style contact (you don't pay
// full body damage to finish off a sliver-HP polygon), but it breaks the
// kamikaze fantasy.
//
// Workaround: the rusher does its OWN contact resolution inside updateRusher.
// On overlap with any hostile structure or the player tank, it applies a
// fixed burst of damage directly (no scaling) and sets enemy.hp = 0. The
// shared resolvePlayerEnemyCollisions and applyCoreContact then skip it
// (hp <= 0 guards), so no double-hit.
//
// Per CLAUDE.md: rushers carry teamId (drives accent + friend/foe) and
// ownerId (reserved for kill attribution).

import { BASE_HP } from '../stats';
import { TANK_RADIUS } from '../tank';
import {
  type Enemy,
  type EnemyDef,
  type EnemyUpdateContext,
} from './enemySystem';

// === Sizing ===
const SIZE_SCALE = 0.9;
export const RUSHER_RADIUS = TANK_RADIUS * SIZE_SCALE;

// Spike pattern around the chassis. Drawn in the drawBarrel slot (under the
// chassis), so the chassis circle covers the spike bases and only the tips
// poke out as visible blades. SPIKE_BASE_R sits just inside the chassis
// edge so the cover is clean.
const SPIKE_COUNT = 16;
const SPIKE_TIP_R = RUSHER_RADIUS * 1.35;
const SPIKE_BASE_R = RUSHER_RADIUS * 0.92;
// Used for the cull check in drawEnemy — how far the visual extends past
// the chassis edge.
const SPIKE_REACH = SPIKE_TIP_R - RUSHER_RADIUS;

// Concentric lighter-gray disc inside the chassis, decorative.
const INNER_RING_R = RUSHER_RADIUS * 0.65;
// Two-tone team accent at center, same cue every enemy uses.
const ACCENT_OUTER_R = RUSHER_RADIUS * 0.22;
const ACCENT_INNER_R = RUSHER_RADIUS * 0.16;

// === Stats ===
// Low HP — the rusher is a glass-cannon kamikaze. Base bullets cut it down
// fast, so the threat is speed + burst, not durability.
export const RUSHER_MAX_HP = BASE_HP * 0.7;

// Continuous body damage values are intentionally 0 — the rusher does its
// own contact resolution in updateRusher, and zeroing these prevents the
// shared resolvePlayerEnemyCollisions / applyCoreContact paths from also
// dealing damage on the same frame the rusher detonates.
export const RUSHER_BODY_DAMAGE_TO_TANK = 0;
export const RUSHER_BODY_DAMAGE_TO_CORE = 0;

// Per-tick HP loss the rusher inflicts on a bullet that hits it. Low — base
// bullets cut through with plenty of penetration, matching the fragile-
// chassis vibe.
export const RUSHER_BULLET_REDUCTION = 5;

// === Movement ===
// Fastest enemy by a wide margin. Combined with no building-gap behavior
// (rusher WANTS to collide), this lets it close on targets aggressively.
export const RUSHER_SPEED = 200;
// Constant spin in radians/sec. Drives aimAngle, which drawEnemy rotates the
// whole chassis by — so the spike ring appears to whirl around the body.
export const RUSHER_SPIN_RATE = 8;

// === Kamikaze burst ===
// One-shot damage applied on contact, ignoring the death-factor scaling
// that would normally clamp damage to the rusher's current HP. Sized so:
//   - Tank: kills a fresh lvl-1 player tank; dents a maxed-HP build.
//   - Building: instakills a wall (100 HP), big chunk of a turret (400 HP).
//   - Core:  ~22% of a fresh 1000-HP core, so ~5 rushers crack a clean core.
export const RUSHER_KAMIKAZE_TO_TANK = 100;
export const RUSHER_KAMIKAZE_TO_BUILDING = 180;
export const RUSHER_KAMIKAZE_TO_CORE = 220;

// === AI ===
// 1. Spin the chassis (constant aimAngle increment, visual rotation only).
// 2. Pick the nearest hostile target across player / hostile buildings /
//    hostile cores. No range gate — rushers commit from anywhere.
// 3. Walk straight at the target at high speed, NO building gap (rusher
//    wants to collide). Movement direction is independent of aimAngle.
// 4. After integration, check overlap with hostile cores → buildings →
//    player. First hit consumes the rusher: apply burst damage, set hp = 0,
//    return. Subsequent collision passes this frame skip dead enemies.
function updateRusher(enemy: Enemy, ctx: EnemyUpdateContext): void {
  // Constant spin — the visual signature.
  enemy.aimAngle += RUSHER_SPIN_RATE * ctx.dt;

  // Nearest hostile target across everything in the world.
  let targetX = 0, targetY = 0;
  let bestD2 = Infinity;
  let hasTarget = false;
  const consider = (tx: number, ty: number) => {
    const dx = tx - enemy.pos.x;
    const dy = ty - enemy.pos.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) {
      bestD2 = d2;
      targetX = tx; targetY = ty;
      hasTarget = true;
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
  if (!hasTarget) {
    enemy.vel.x = 0; enemy.vel.y = 0;
    return;
  }

  // Straight-line movement — independent of aimAngle, which is just spin.
  const dx = targetX - enemy.pos.x;
  const dy = targetY - enemy.pos.y;
  const dlen = Math.hypot(dx, dy) || 1;
  const dirX = dx / dlen;
  const dirY = dy / dlen;
  enemy.vel.x = dirX * RUSHER_SPEED;
  enemy.vel.y = dirY * RUSHER_SPEED;
  enemy.pos.x += enemy.vel.x * ctx.dt;
  enemy.pos.y += enemy.vel.y * ctx.dt;

  // Contact resolution after integration. Single-target: the first hit
  // consumes the rusher. Priority: core (the strategic prize) → buildings
  // → player.
  const r2 = RUSHER_RADIUS * RUSHER_RADIUS;
  for (const c of ctx.cores) {
    if (c.teamId === enemy.teamId || c.hp <= 0) continue;
    const half = c.size * 0.5;
    const cx = Math.max(c.pos.x - half, Math.min(enemy.pos.x, c.pos.x + half));
    const cy = Math.max(c.pos.y - half, Math.min(enemy.pos.y, c.pos.y + half));
    const ddx = enemy.pos.x - cx;
    const ddy = enemy.pos.y - cy;
    if (ddx * ddx + ddy * ddy < r2) {
      c.hp = Math.max(0, c.hp - RUSHER_KAMIKAZE_TO_CORE);
      ctx.onCoreDamaged?.(c, RUSHER_KAMIKAZE_TO_CORE);
      enemy.hp = 0;
      return;
    }
  }
  for (const b of ctx.buildings) {
    if (b.teamId === enemy.teamId || b.hp <= 0) continue;
    const half = b.size * 0.5;
    const cx = Math.max(b.pos.x - half, Math.min(enemy.pos.x, b.pos.x + half));
    const cy = Math.max(b.pos.y - half, Math.min(enemy.pos.y, b.pos.y + half));
    const ddx = enemy.pos.x - cx;
    const ddy = enemy.pos.y - cy;
    if (ddx * ddx + ddy * ddy < r2) {
      b.hp = Math.max(0, b.hp - RUSHER_KAMIKAZE_TO_BUILDING);
      enemy.hp = 0;
      return;
    }
  }
  if (ctx.playerPos && ctx.playerTeamId !== enemy.teamId && ctx.damagePlayer) {
    const playerR = ctx.playerRadius ?? TANK_RADIUS;
    const pdx = ctx.playerPos.x - enemy.pos.x;
    const pdy = ctx.playerPos.y - enemy.pos.y;
    const reach = RUSHER_RADIUS + playerR;
    if (pdx * pdx + pdy * pdy < reach * reach) {
      ctx.damagePlayer(RUSHER_KAMIKAZE_TO_TANK, 'Rusher');
      enemy.hp = 0;
      return;
    }
  }
}

// === Spike ring (drawn in the drawBarrel slot, under the chassis) ===
// The drawBarrel callback isn't strictly a barrel for every kind — the
// enemy manager runs it as the "below-chassis layer" so it gets covered by
// the chassis circle. For the rusher, that layer is a 16-tooth star polygon;
// the chassis covers the bases, leaving only the tips visible as sharp
// blades poking out of the body. Because drawEnemy applies the aimAngle
// rotation around the whole transform, this polygon visibly whirls as
// updateRusher increments aimAngle.
function drawRusherBlades(ctx: CanvasRenderingContext2D, _enemy: Enemy): void {
  ctx.fillStyle = '#999999';
  ctx.strokeStyle = '#727272';
  ctx.lineWidth = 3;
  ctx.lineJoin = 'miter';
  ctx.beginPath();
  for (let i = 0; i < SPIKE_COUNT * 2; i++) {
    const angle = (i / (SPIKE_COUNT * 2)) * Math.PI * 2;
    const r = i % 2 === 0 ? SPIKE_TIP_R : SPIKE_BASE_R;
    const x = Math.cos(angle) * r;
    const y = Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

// === Interior render ===
// Concentric lighter-gray disc + the standard two-tone team accent. The
// disc reads as the rusher's "armor plate" inside the chassis. Both rotate
// with the chassis but are radially symmetric, so they appear stationary
// while the spike ring around them spins.
function drawRusherInterior(
  ctx: CanvasRenderingContext2D,
  _enemy: Enemy,
  accent: string,
  accentDim: string,
): void {
  ctx.fillStyle = '#999999';
  ctx.strokeStyle = '#727272';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, INNER_RING_R, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = accentDim;
  ctx.beginPath();
  ctx.arc(0, 0, ACCENT_OUTER_R, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(0, 0, ACCENT_INNER_R, 0, Math.PI * 2);
  ctx.fill();
}

export const RUSHER_DEF: EnemyDef = {
  kind: 'rusher',
  radius: RUSHER_RADIUS,
  maxHp: RUSHER_MAX_HP,
  bodyDamageToTank: RUSHER_BODY_DAMAGE_TO_TANK,
  bodyDamageToCore: RUSHER_BODY_DAMAGE_TO_CORE,
  bulletReduction: RUSHER_BULLET_REDUCTION,
  // The drawBarrel slot is overloaded for the rusher: drawBarrel renders
  // the spike ring (not a barrel). barrelLength reports the visual extent
  // PAST the chassis so the cull check accounts for the spike tips.
  barrelLength: SPIKE_REACH,
  barrelWidth: 0,
  update: updateRusher,
  drawInterior: drawRusherInterior,
  drawBarrel: drawRusherBlades,
};
