// Death-effect queue. When an entity dies anywhere in the codebase, the
// caller calls queueDeathEffectFromEntity(e) before removing it from the
// world; the queue holds the visual data and runs an expand+fade animation
// for DEATH_ANIM_DURATION seconds, then evicts.
//
// Independent concern from the main entity loop — runs on its own update
// tick and draws after the live entities so dying shapes appear on top.

import { getEntityDef, type EntityKind, type GameEntity } from './entitySystem';
import type { Vec2 } from '../geometry';

export const DEATH_ANIM_DURATION = 0.08;

export interface DeathEffect {
  pos: Vec2;
  angle: number;
  size: number;
  kind: EntityKind;
  fill: string;
  stroke: string;
  t: number; // remaining time
}

const deathEffects: DeathEffect[] = [];

export function queueDeathEffectFromEntity(e: GameEntity): void {
  deathEffects.push({
    pos: { x: e.pos.x, y: e.pos.y },
    angle: e.angle,
    size: e.size,
    kind: e.kind,
    fill: e.fill,
    stroke: e.stroke,
    t: DEATH_ANIM_DURATION,
  });
}

export function updateDeathEffects(dt: number): void {
  if (!deathEffects.length) return;
  for (const fx of deathEffects) {
    fx.t = Math.max(0, fx.t - dt);
  }
  // Sweep finished entries.
  for (let i = deathEffects.length - 1; i >= 0; i--) {
    if (deathEffects[i].t <= 0) deathEffects.splice(i, 1);
  }
}

export function drawDeathEffects(
  ctx: CanvasRenderingContext2D,
  viewW: number,
  viewH: number,
  camX: number,
  camY: number,
): void {
  if (!deathEffects.length) return;
  for (const fx of deathEffects) {
    const sx = fx.pos.x - camX;
    const sy = fx.pos.y - camY;
    const s = fx.size;
    if (sx < -s * 1.5 || sx > viewW + s * 1.5 || sy < -s * 1.5 || sy > viewH + s * 1.5) continue;

    const progress = 1 - (fx.t / DEATH_ANIM_DURATION);
    const scale = 1 + 0.4 * Math.max(0, Math.min(1, progress));
    const alpha = 1 - Math.max(0, Math.min(1, progress));

    const drawSize = fx.size * scale;

    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(fx.angle);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = fx.fill;
    ctx.strokeStyle = fx.stroke;
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    getEntityDef(fx.kind).tracePath(ctx, drawSize);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}
