// Square polygon. Cheapest/fastest-spawning enemy, lowest XP reward.

import { scaleCount } from '../config';
import type { Vec2 } from '../geometry';
import type { EntityDef } from './entitySystem';

// === Constants ===
export const SQUARE_FILL = '#ffe869';
export const SQUARE_STROKE = '#bfae4e';
export const SQUARE_SIZE = 38;
export const SQUARE_MAX_COUNT = scaleCount(18);
export const SQUARE_MAX_HP = 10;

// === Geometry ===
// Axis-aligned square in local space, rotated into world space.
export function squareWorldVerts(pos: Vec2, angle: number, size: number): [Vec2, Vec2, Vec2, Vec2] {
  const s = Math.max(1, size);
  const hs = s / 2;
  const local: Vec2[] = [
    { x: -hs, y: -hs },
    { x:  hs, y: -hs },
    { x:  hs, y:  hs },
    { x: -hs, y:  hs },
  ];
  const ca = Math.cos(angle), sa = Math.sin(angle);
  const rot = (p: Vec2): Vec2 => ({ x: p.x * ca - p.y * sa + pos.x, y: p.x * sa + p.y * ca + pos.y });
  return [rot(local[0]), rot(local[1]), rot(local[2]), rot(local[3])];
}

// === Render path ===
// Drawn at the canvas origin; caller has translated/rotated.
function tracePath(ctx: CanvasRenderingContext2D, size: number): void {
  const hs = size / 2;
  ctx.rect(-hs, -hs, size, size);
}

// === Registry def ===
export const SQUARE_DEF: EntityDef = {
  kind: 'square',
  size: SQUARE_SIZE,
  maxHp: SQUARE_MAX_HP,
  maxCount: SQUARE_MAX_COUNT,
  fill: SQUARE_FILL,
  stroke: SQUARE_STROKE,
  worldVerts: squareWorldVerts,
  tracePath,
};
