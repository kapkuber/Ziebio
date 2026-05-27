// Triangle polygon. Mid-tier enemy: more HP, fewer instances, more XP per kill.

import { scaleCount } from '../config';
import type { Vec2 } from '../geometry';
import type { EntityDef } from './entitySystem';

// === Constants ===
export const TRIANGLE_FILL = '#fc7677';
export const TRIANGLE_STROKE = '#bd5859';
export const TRIANGLE_SIZE = 43;
export const TRIANGLE_MAX_COUNT = scaleCount(6);
export const TRIANGLE_MAX_HP = 30;

// === Geometry ===
// Equilateral triangle with the apex pointing up in local space (angle=0),
// centered on its centroid.
export function triangleWorldVerts(pos: Vec2, angle: number, size: number): [Vec2, Vec2, Vec2] {
  const s = Math.max(1, size);
  const halfSide = s / 2;
  const height = (s * Math.sqrt(3)) / 2;
  const top: Vec2 = { x: 0, y: -(2 / 3) * height };
  const br: Vec2  = { x:  halfSide, y: (1 / 3) * height };
  const bl: Vec2  = { x: -halfSide, y: (1 / 3) * height };
  const ca = Math.cos(angle), sa = Math.sin(angle);
  const rot = (p: Vec2): Vec2 => ({ x: p.x * ca - p.y * sa + pos.x, y: p.x * sa + p.y * ca + pos.y });
  return [rot(top), rot(br), rot(bl)];
}

// === Render path ===
function tracePath(ctx: CanvasRenderingContext2D, size: number): void {
  const halfSide = size / 2;
  const height = (size * Math.sqrt(3)) / 2;
  const topY = -(2 / 3) * height;
  const baseY = (1 / 3) * height;
  ctx.moveTo(0, topY);
  ctx.lineTo(halfSide, baseY);
  ctx.lineTo(-halfSide, baseY);
  ctx.closePath();
}

// === Registry def ===
export const TRIANGLE_DEF: EntityDef = {
  kind: 'triangle',
  size: TRIANGLE_SIZE,
  maxHp: TRIANGLE_MAX_HP,
  maxCount: TRIANGLE_MAX_COUNT,
  fill: TRIANGLE_FILL,
  stroke: TRIANGLE_STROKE,
  worldVerts: triangleWorldVerts,
  tracePath,
};
