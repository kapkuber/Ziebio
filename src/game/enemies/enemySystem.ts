// Enemy manager. Owns the shared types every enemy kind conforms to and the
// kind-agnostic pipelines (factory, draw, bullet-vs-enemy, player-vs-enemy,
// hostile-bullet-vs-player). Per-kind modules (./swarm, future ./shooter,
// ./bomber, etc.) plug in via the ENEMY_DEFS registry.
//
// Adding a new enemy kind is two steps:
//   1. Create ./<kind>.ts exporting its constants, an `update` fn, an
//      optional `drawInterior` fn, and a SOMETHING_DEF: EnemyDef.
//   2. Import the def here and add it to ENEMY_DEFS below.
// No changes to draw, bullet collision, player collision, or factory needed.
//
// Per CLAUDE.md: enemies carry teamId (drives accent + friend/foe) and
// ownerId (reserved for kill attribution). They live OUTSIDE the polygon
// entity pipeline — polygons are neutral world resources, enemies are
// team-bound.

import type { Building } from '../buildings';
import type { Core } from '../core';
import { HIT_FLASH_DURATION } from '../entities';
import { aabbCircleMTV, type Vec2 } from '../geometry';
import { TICK_DURATION } from '../stats';
import type { Bullet } from '../tank';
import { getTeamPalette, type TeamId } from '../teams';

import { SWARM_DEF } from './swarm';

// === Shared types ===

export type EnemyKind = 'swarm';

export interface Enemy {
  id: number;
  kind: EnemyKind;
  pos: Vec2;
  vel: Vec2;
  hp: number;
  maxHp: number;
  hitT?: number;
  aimAngle: number;          // radians — barrel direction, eases toward target
  reloadRemaining: number;   // seconds until the next shot can fire
  teamId: TeamId;
  ownerId: number;
}

// Context the per-kind update fn receives. Centralizes everything any AI
// might consider (targets to attack, obstacles to navigate, the bullet list
// to fire into, the player tank) so adding a new behavior doesn't require
// threading new params through every kind.
export interface EnemyUpdateContext {
  cores: Core[];
  buildings: Building[];
  bullets: Bullet[];
  bulletIdRef: { current: number };
  playerPos: Vec2 | null;       // null if player is dead / not yet present
  playerTeamId: TeamId;
  dt: number;
  onCoreDamaged?: (core: Core, dmg: number) => void;
}

// Per-kind contract used by the manager. Kind-internal constants live on the
// kind module and are imported directly by callers that care.
export interface EnemyDef {
  kind: EnemyKind;
  radius: number;
  maxHp: number;
  bodyDamageToTank: number;       // dealt per second of contact * impact
  bodyDamageToCore: number;       // dealt per second of contact
  bulletReduction: number;        // per-tick HP loss to bullets that hit us
  barrelLength: number;           // 0 = no barrel (e.g. melee-only kind)
  barrelWidth: number;
  // Per-kind movement / AI / firing. Mutates the enemy in place; bullets it
  // fires are pushed into `ctx.bullets`.
  update: (enemy: Enemy, ctx: EnemyUpdateContext) => void;
  // Body interior (the mark inside the shared chassis circle). Caller has
  // already translated to the enemy center; draw in local coords.
  drawInterior: (
    ctx: CanvasRenderingContext2D,
    enemy: Enemy,
    accent: string,
    accentDim: string,
  ) => void;
}

// === Per-kind registry ===
export const ENEMY_DEFS: Record<EnemyKind, EnemyDef> = {
  swarm: SWARM_DEF,
};

export function getEnemyDef(kind: EnemyKind): EnemyDef {
  return ENEMY_DEFS[kind];
}

// === Factory ===
export interface CreateEnemyOptions {
  teamId?: TeamId;
  ownerId?: number;
}

export function createEnemy(
  id: number,
  kind: EnemyKind,
  center: Vec2,
  options: CreateEnemyOptions = {},
): Enemy {
  const def = getEnemyDef(kind);
  return {
    id,
    kind,
    pos: { x: center.x, y: center.y },
    vel: { x: 0, y: 0 },
    hp: def.maxHp,
    maxHp: def.maxHp,
    aimAngle: 0,
    reloadRemaining: 0,
    teamId: options.teamId ?? 'red',
    ownerId: options.ownerId ?? 0,
  };
}

// === Per-frame update ===
// Walks every enemy once: decays hit flash + reload, then dispatches the
// kind's AI fn. The kind owns movement, gap behavior, and firing.
export function updateEnemies(
  enemies: Enemy[],
  ctx: EnemyUpdateContext,
): void {
  for (const e of enemies) {
    if (e.hp <= 0) continue;
    if (e.hitT && e.hitT > 0) e.hitT = Math.max(0, e.hitT - ctx.dt);
    e.reloadRemaining = Math.max(0, e.reloadRemaining - ctx.dt);
    getEnemyDef(e.kind).update(e, ctx);
  }
}

// === Bullet vs enemy ===
// Per-tick body damage exchange with mutual overkill scaling — mirrors the
// bullet-vs-polygon pipeline in bulletSystem.ts so behavior reads the same
// across enemies and polygons. Friendly bullets pass through.
export function resolveEnemyBulletCollisions(
  enemies: Enemy[],
  bullets: Bullet[],
  dt: number,
  onKilled?: (e: Enemy) => void,
): void {
  if (!enemies.length || !bullets.length) return;
  const tickScale = dt / TICK_DURATION;
  for (const b of bullets) {
    if (b.life <= 0) continue;
    for (const e of enemies) {
      if (e.hp <= 0) continue;
      if (e.teamId === b.teamId) continue;
      const def = getEnemyDef(e.kind);
      const dx = b.pos.x - e.pos.x;
      const dy = b.pos.y - e.pos.y;
      const reach = b.radius + def.radius;
      if (dx * dx + dy * dy > reach * reach) continue;
      let toEnemy = b.damage * tickScale;
      let toBullet = def.bulletReduction * tickScale;
      if (toEnemy > e.hp) {
        const sc = e.hp / toEnemy;
        toEnemy *= sc; toBullet *= sc;
      } else if (toBullet > b.hp) {
        const sc = b.hp / toBullet;
        toEnemy *= sc; toBullet *= sc;
      }
      e.hp = Math.max(0, e.hp - toEnemy);
      e.hitT = HIT_FLASH_DURATION;
      b.hp -= toBullet;
      if (b.hp <= 0) b.life = 0;
      if (e.hp <= 0) {
        onKilled?.(e);
        break;
      }
    }
  }
}

// === Player vs enemy contact ===
// Circle-vs-circle push apart + reciprocal continuous body damage. Caller
// supplies the player's outgoing body-damage rate (already includes
// BODY_DAMAGE_MULT_TANK) and the speed-derived impact multiplier; both sides
// scale together so an overkill blow doesn't waste damage on either party.
export interface EnemyPlayerHit {
  enemy: Enemy;
  tankDamage: number;
  enemyDamage: number;
  killed: boolean;
}

export function resolvePlayerEnemyCollisions(
  enemies: Enemy[],
  playerPos: Vec2,
  playerVel: Vec2,
  playerTeamId: TeamId,
  tankRadius: number,
  playerBodyDamageToTank: number,
  impact: number,
  tankHp: number,
  dt: number,
): EnemyPlayerHit[] {
  const hits: EnemyPlayerHit[] = [];
  for (const e of enemies) {
    if (e.hp <= 0 || e.teamId === playerTeamId) continue;
    const def = getEnemyDef(e.kind);
    const dx = playerPos.x - e.pos.x;
    const dy = playerPos.y - e.pos.y;
    const reach = def.radius + tankRadius;
    const d2 = dx * dx + dy * dy;
    if (d2 > reach * reach) continue;
    const d = Math.max(1e-6, Math.sqrt(d2));
    const nx = dx / d, ny = dy / d;
    const pen = reach - d;
    const push = pen * 0.5;
    playerPos.x += nx * push;
    playerPos.y += ny * push;
    e.pos.x -= nx * push;
    e.pos.y -= ny * push;
    const BOUNCE = 60;
    playerVel.x += nx * BOUNCE;
    playerVel.y += ny * BOUNCE;
    e.vel.x -= nx * BOUNCE;
    e.vel.y -= ny * BOUNCE;
    const proposedToTank = def.bodyDamageToTank * impact * dt;
    const proposedToEnemy = playerBodyDamageToTank * impact * dt;
    const tankDF =
      proposedToTank > 0 && proposedToTank > tankHp ? tankHp / proposedToTank : 1;
    const enemyDF =
      proposedToEnemy > 0 && proposedToEnemy > e.hp ? e.hp / proposedToEnemy : 1;
    const actualToTank = proposedToTank * enemyDF;
    const actualToEnemy = proposedToEnemy * tankDF;
    e.hp = Math.max(0, e.hp - actualToEnemy);
    e.hitT = HIT_FLASH_DURATION;
    hits.push({
      enemy: e,
      tankDamage: actualToTank,
      enemyDamage: actualToEnemy,
      killed: e.hp <= 0,
    });
  }
  return hits;
}

// === Hostile bullet vs player tank ===
// Any bullet whose teamId differs from the player's deals its full damage to
// the player on overlap and dies. Bullet source (enemy tank, hostile turret,
// future allies in team modes) is irrelevant — friendly is determined by
// teamId only. Lives in the enemy module because today every hostile bullet
// originates from an enemy fire path; if hostile turrets get introduced,
// this same fn covers them.
export interface BulletPlayerHit {
  bullet: Bullet;
  damage: number;
}

export function resolveBulletPlayerCollisions(
  bullets: Bullet[],
  playerPos: Vec2,
  playerTeamId: TeamId,
  tankRadius: number,
): BulletPlayerHit[] {
  const hits: BulletPlayerHit[] = [];
  for (const b of bullets) {
    if (b.life <= 0 || b.teamId === playerTeamId) continue;
    const dx = b.pos.x - playerPos.x;
    const dy = b.pos.y - playerPos.y;
    const reach = b.radius + tankRadius;
    if (dx * dx + dy * dy > reach * reach) continue;
    hits.push({ bullet: b, damage: b.damage });
    b.life = 0;
  }
  return hits;
}

// === Draw ===
// Shared chassis + barrel + flash + HP bar render. Per-kind drawInterior
// fills in the central mark; the rest is identical across kinds so the
// visual language stays consistent.
export function drawEnemy(
  ctx: CanvasRenderingContext2D,
  enemy: Enemy,
  camera: { x: number; y: number; width: number; height: number },
): void {
  const def = getEnemyDef(enemy.kind);
  const sx = enemy.pos.x - camera.x;
  const sy = enemy.pos.y - camera.y;
  const cull = def.radius + def.barrelLength + 12;
  if (sx + cull < 0 || sx - cull > camera.width ||
      sy + cull < 0 || sy - cull > camera.height) return;

  const palette = getTeamPalette(enemy.teamId);

  // Barrel — drawn under the chassis so its breech tucks beneath the body.
  if (def.barrelLength > 0) {
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(enemy.aimAngle);
    ctx.fillStyle = '#999999';
    ctx.strokeStyle = '#727272';
    ctx.lineWidth = 3;
    const bx = def.radius - 4;
    ctx.beginPath();
    ctx.rect(bx, -def.barrelWidth / 2, def.barrelLength, def.barrelWidth);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // Chassis + per-kind interior.
  ctx.save();
  ctx.translate(sx, sy);
  ctx.fillStyle = '#909295';
  ctx.strokeStyle = '#575757';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, 0, def.radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  def.drawInterior(ctx, enemy, palette.accent, palette.accentDim);
  ctx.restore();

  // Damage flash overlay on the body.
  if (enemy.hitT && enemy.hitT > 0) {
    const t = Math.max(0, Math.min(HIT_FLASH_DURATION, enemy.hitT));
    const phase = 1 - t / HIT_FLASH_DURATION;
    const alpha = Math.sin(phase * Math.PI);
    ctx.save();
    ctx.translate(sx, sy);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#ff2021';
    ctx.strokeStyle = '#f01717';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, def.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // HP bar (only when damaged) — matches the polygon entity styling.
  if (enemy.hp < enemy.maxHp) {
    const ratio = Math.max(0, Math.min(1, enemy.hp / enemy.maxHp));
    const sZ = def.radius * 2;
    const barW = Math.max(18, sZ * 1.1);
    const barH = 7;
    const radius = barH / 2;
    const px = sx - barW / 2;
    const py = sy + def.radius + 11;
    ctx.fillStyle = '#555555';
    ctx.beginPath();
    ctx.moveTo(px + radius, py);
    ctx.lineTo(px + barW - radius, py);
    ctx.arc(px + barW - radius, py + radius, radius, -Math.PI / 2, Math.PI / 2);
    ctx.lineTo(px + radius, py + barH);
    ctx.arc(px + radius, py + radius, radius, Math.PI / 2, -Math.PI / 2);
    ctx.closePath();
    ctx.fill();
    const innerH = 4;
    const innerR = innerH / 2;
    const pad = (barH - innerH) / 2;
    const innerX = px + pad;
    const fy = py + pad;
    const innerW = barW - 2 * pad;
    const fillLen = Math.max(innerR * 2, innerW * ratio);
    ctx.fillStyle = '#85e37d';
    ctx.beginPath();
    ctx.moveTo(innerX + innerR, fy);
    ctx.lineTo(innerX + fillLen - innerR, fy);
    ctx.arc(innerX + fillLen - innerR, fy + innerR, innerR, -Math.PI / 2, Math.PI / 2);
    ctx.lineTo(innerX + innerR, fy + innerH);
    ctx.arc(innerX + innerR, fy + innerR, innerR, Math.PI / 2, -Math.PI / 2);
    ctx.closePath();
    ctx.fill();
  }
}

// === Shared AI helpers ===
// Reusable building / core handling for kinds whose movement wants a soft
// gap in front of hostile structures plus core-contact damage. Both are
// opt-in per kind — a future ranged-only enemy might want a much larger gap
// (or none at all) and skip core contact entirely.

// Strip the inward velocity component vs every hostile building inside a
// circle of `radius + gap`. Sliding tangentially still works; bumping head-on
// is cancelled out.
export function applyBuildingGapToVelocity(
  enemy: Enemy,
  buildings: Building[],
  gap: number,
  vel: Vec2,
): void {
  const probeR = getEnemyDef(enemy.kind).radius + gap;
  for (const b of buildings) {
    if (b.hp <= 0) continue;
    if (b.teamId === enemy.teamId) continue;
    const half = b.size * 0.5;
    const mtv = aabbCircleMTV(
      b.pos.x - half, b.pos.y - half, b.pos.x + half, b.pos.y + half,
      enemy.pos.x, enemy.pos.y, probeR,
    );
    if (!mtv) continue;
    const vIn = vel.x * mtv.nx + vel.y * mtv.ny;
    if (vIn < 0) {
      vel.x -= mtv.nx * vIn;
      vel.y -= mtv.ny * vIn;
    }
  }
}

// Hard-push out of the gap zone — catches the case where the enemy starts
// the frame already inside it (spawned next to a wall, wall placed onto it).
export function enforceBuildingGap(
  enemy: Enemy,
  buildings: Building[],
  gap: number,
): void {
  const probeR = getEnemyDef(enemy.kind).radius + gap;
  for (const b of buildings) {
    if (b.hp <= 0) continue;
    if (b.teamId === enemy.teamId) continue;
    const half = b.size * 0.5;
    const mtv = aabbCircleMTV(
      b.pos.x - half, b.pos.y - half, b.pos.x + half, b.pos.y + half,
      enemy.pos.x, enemy.pos.y, probeR,
    );
    if (!mtv) continue;
    enemy.pos.x += mtv.nx * mtv.pen;
    enemy.pos.y += mtv.ny * mtv.pen;
  }
}

// Push out of any hostile core by exactly the enemy's radius (no gap, so the
// enemy sits flush) and apply continuous core damage while in contact.
export function applyCoreContact(
  enemy: Enemy,
  cores: Core[],
  dt: number,
  bodyDamageToCore: number,
  onCoreDamaged?: (core: Core, dmg: number) => void,
): void {
  const r = getEnemyDef(enemy.kind).radius;
  for (const c of cores) {
    if (c.teamId === enemy.teamId || c.hp <= 0) continue;
    const half = c.size * 0.5;
    const mtv = aabbCircleMTV(
      c.pos.x - half, c.pos.y - half, c.pos.x + half, c.pos.y + half,
      enemy.pos.x, enemy.pos.y, r,
    );
    if (!mtv) continue;
    enemy.pos.x += mtv.nx * mtv.pen;
    enemy.pos.y += mtv.ny * mtv.pen;
    const dmg = bodyDamageToCore * dt;
    c.hp = Math.max(0, c.hp - dmg);
    onCoreDamaged?.(c, dmg);
  }
}
