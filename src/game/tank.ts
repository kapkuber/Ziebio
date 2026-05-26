// Player tank logic and constants
export interface Vec2 { x: number; y: number }
import { HIT_FILL, HIT_STROKE, HIT_FLASH_DURATION } from './entities';
import { getTeamPalette, type TeamId } from './teams';

export interface Bullet {
  id: number;
  pos: Vec2;
  vel: Vec2;
  radius: number;
  life: number;
  hp: number;
  maxHp: number;
  damage: number;
  teamId: TeamId; // drives bullet color and same-team pass-through
}

export const TANK_RADIUS = 24;
export const BARREL_LENGTH = 28;
export const BARREL_WIDTH = 22;
export const TANK_MAX_HP = 50;

export const BULLET_SPEED = 300; // px/s
export const BULLET_RADIUS = 11;
export const BULLET_LIFETIME = 2.2; // seconds
export const BULLET_COOLDOWN = 0.6; // seconds between shots
export const BULLET_SPREAD_DEG = 5; // degrees

export const RECOIL_IMPULSE = 20; // px/s

export const TANK_SPEED = 280; // px/s (max)
export const TANK_ACCEL = 600; // px/s^2
export const TANK_FRICTION = 2; // 1/s

export interface BulletSpawnStats {
  speed: number;
  damage: number;
  hp: number;
  lifetime: number;
  radius: number;
}

export function spawnBullet(
  bullets: Bullet[],
  nextIdRef: { current: number },
  tankPos: Vec2,
  tankVel: Vec2,
  mouse: Vec2,
  viewW: number,
  viewH: number,
  teamId: TeamId,
  stats: BulletSpawnStats = {
    speed: BULLET_SPEED,
    damage: 7,
    hp: 2,
    lifetime: BULLET_LIFETIME,
    radius: BULLET_RADIUS,
  },
) {
  const baseAngle = Math.atan2(mouse.y - viewH / 2, mouse.x - viewW / 2);
  const spreadRad = (BULLET_SPREAD_DEG * Math.PI) / 180;
  const deviation = (Math.random() * 2 - 1) * spreadRad;
  const angle = baseAngle + deviation;
  const dir: Vec2 = { x: Math.cos(angle), y: Math.sin(angle) };
  const spawn: Vec2 = {
    x: tankPos.x + dir.x * (TANK_RADIUS + BARREL_LENGTH),
    y: tankPos.y + dir.y * (TANK_RADIUS + BARREL_LENGTH),
  };
  bullets.push({
    id: nextIdRef.current++,
    pos: spawn,
    vel: { x: dir.x * stats.speed, y: dir.y * stats.speed },
    radius: stats.radius,
    life: stats.lifetime,
    hp: stats.hp,
    maxHp: stats.hp,
    damage: stats.damage,
    teamId,
  });
  tankVel.x -= dir.x * RECOIL_IMPULSE;
  tankVel.y -= dir.y * RECOIL_IMPULSE;
}

export function drawTank(
  ctx: CanvasRenderingContext2D,
  viewW: number,
  viewH: number,
  mouse: Vec2,
  teamId: TeamId,
  sizeMultiplier: number = 1,
) {
  const palette = getTeamPalette(teamId);
  const angle = Math.atan2(mouse.y - viewH / 2, mouse.x - viewW / 2);
  const radius = TANK_RADIUS * sizeMultiplier;
  const barrelLength = BARREL_LENGTH * sizeMultiplier;
  const barrelWidth = BARREL_WIDTH * sizeMultiplier;
  ctx.save();
  ctx.translate(viewW / 2, viewH / 2);
  ctx.rotate(angle);
  // Barrel stays team-neutral (gray) — it's structural metal, not livery.
  ctx.fillStyle = "#999999";
  ctx.strokeStyle = "#727272";
  ctx.lineWidth = 3.5;
  const x = radius - 6 * sizeMultiplier;
  ctx.beginPath();
  ctx.rect(x, -barrelWidth / 2, barrelLength, barrelWidth);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // Body fill + outline from the team palette.
  ctx.fillStyle = palette.accent;
  ctx.strokeStyle = palette.accentDim;
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.arc(viewW / 2, viewH / 2, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

export function drawTankHealthBar(
  ctx: CanvasRenderingContext2D,
  viewW: number,
  viewH: number,
  hp: number,
  maxHp: number = TANK_MAX_HP,
  tankRadius: number = TANK_RADIUS,
) {
  const clampedHp = Math.max(0, Math.min(maxHp, hp));
  if (clampedHp >= maxHp) return; // invisible until damaged

  const ratio = clampedHp / maxHp;
  // mirror entity bar styling and placement (below the tank)
  const s = tankRadius * 2; // approximate size like entity 's'
  const barW = Math.max(18, s * 1.1);
  const barH = 7;
  const barRadius = barH / 2;
  const bx = viewW / 2 - barW / 2;
  const by = viewH / 2 + tankRadius + 11;

  // track
  ctx.save();
  ctx.fillStyle = '#555555';
  ctx.beginPath();
  ctx.moveTo(bx + barRadius, by);
  ctx.lineTo(bx + barW - barRadius, by);
  ctx.arc(bx + barW - barRadius, by + barRadius, barRadius, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(bx + barRadius, by + barH);
  ctx.arc(bx + barRadius, by + barRadius, barRadius, Math.PI / 2, -Math.PI / 2);
  ctx.closePath();
  ctx.fill();

  // inner thin fill (same as entities)
  const innerH = 4;
  const innerR = innerH / 2;
  const pad = (barH - innerH) / 2;
  const innerX = bx + pad;
  const fy = by + pad;
  const innerW = barW - 2 * pad;
  const fillLen = Math.max(innerR * 2, innerW * ratio);
  ctx.fillStyle = '#85e37d';
  ctx.beginPath();
  ctx.moveTo(innerX + innerR, fy);
  ctx.lineTo(innerX + fillLen - innerR, fy);
  ctx.arc(innerX + fillLen - innerR, fy + innerR, innerR, -Math.PI/2, Math.PI/2);
  ctx.lineTo(innerX + innerR, fy + innerH);
  ctx.arc(innerX + innerR, fy + innerR, innerR, Math.PI/2, -Math.PI/2);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export function drawTankDamageFlash(
  ctx: CanvasRenderingContext2D,
  viewW: number,
  viewH: number,
  hitT: number,
  radius: number = TANK_RADIUS,
) {
  if (!hitT || hitT <= 0) return;
  const t = Math.max(0, Math.min(HIT_FLASH_DURATION, hitT));
  const phase = 1 - t / HIT_FLASH_DURATION; // 0 -> 1
  const alpha = Math.sin(phase * Math.PI);  // ease in/out
  // overlay just the tank body (circle) similar to entity hit overlay
  ctx.save();
  ctx.translate(viewW / 2, viewH / 2);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = HIT_FILL;
  ctx.strokeStyle = HIT_STROKE;
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

export function applyTankDamage(currentHp: number, damage: number, maxHp: number = TANK_MAX_HP): number {
  return Math.max(0, Math.min(maxHp, currentHp - Math.max(0, damage)));
}

export function applyTankHeal(currentHp: number, heal: number, maxHp: number = TANK_MAX_HP): number {
  return Math.max(0, Math.min(maxHp, currentHp + Math.max(0, heal)));
}

export function integrateTank(
  dt: number,
  inputX: number,
  inputY: number,
  vel: Vec2,
  pos: Vec2,
  mapW: number,
  mapH: number,
  margin: number,
  maxSpeed: number = TANK_SPEED,
) {
  let ix = inputX;
  let iy = inputY;
  if (ix !== 0 || iy !== 0) {
    const ilen = Math.hypot(ix, iy) || 1;
    ix /= ilen; iy /= ilen;
  }
  vel.x += ix * TANK_ACCEL * dt;
  vel.y += iy * TANK_ACCEL * dt;
  const damp = Math.max(0, 1 - TANK_FRICTION * dt);
  vel.x *= damp; vel.y *= damp;
  const sp = Math.hypot(vel.x, vel.y);
  if (sp > maxSpeed) {
    const s = maxSpeed / sp; vel.x *= s; vel.y *= s;
  }
  const nextX = pos.x + vel.x * dt;
  const nextY = pos.y + vel.y * dt;
  const clampedX = Math.max(-margin, Math.min(mapW + margin, nextX));
  const clampedY = Math.max(-margin, Math.min(mapH + margin, nextY));
  if (clampedX !== nextX) vel.x = 0;
  if (clampedY !== nextY) vel.y = 0;
  pos.x = clampedX; pos.y = clampedY;
}
