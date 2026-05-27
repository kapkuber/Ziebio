// Pentagon polygon. Top-tier enemy: high HP, rare, big XP/score on kill.

import { scaleCount } from '../config';
import type { Vec2 } from '../geometry';
import type { EntityDef } from './entitySystem';

// === Constants ===
export const PENTAGON_FILL = '#768DFC';
export const PENTAGON_STROKE = '#5869BD';
export const PENTAGON_SIZE = 56;
export const PENTAGON_MAX_COUNT = scaleCount(2);
export const PENTAGON_MAX_HP = 100;

// === Geometry ===
// Regular pentagon inscribed in a circle of radius size/2, top vertex up
// at angle=0, vertices clockwise.
export function pentagonWorldVerts(
  pos: Vec2,
  angle: number,
  size: number,
): [Vec2, Vec2, Vec2, Vec2, Vec2] {
  const R = Math.max(1, size) / 2;
  const ca = Math.cos(angle), sa = Math.sin(angle);
  const verts: Vec2[] = [];
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i * Math.PI * 2) / 5;
    const lx = Math.cos(a) * R;
    const ly = Math.sin(a) * R;
    verts.push({ x: lx * ca - ly * sa + pos.x, y: lx * sa + ly * ca + pos.y });
  }
  return [verts[0], verts[1], verts[2], verts[3], verts[4]];
}

// === Render path ===
function tracePath(ctx: CanvasRenderingContext2D, size: number): void {
  const R = size / 2;
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i * Math.PI * 2) / 5;
    const x = Math.cos(a) * R;
    const y = Math.sin(a) * R;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

// === Registry def ===
export const PENTAGON_DEF: EntityDef = {
  kind: 'pentagon',
  size: PENTAGON_SIZE,
  maxHp: PENTAGON_MAX_HP,
  maxCount: PENTAGON_MAX_COUNT,
  fill: PENTAGON_FILL,
  stroke: PENTAGON_STROKE,
  worldVerts: pentagonWorldVerts,
  tracePath,
};
