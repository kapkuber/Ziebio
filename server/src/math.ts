export interface Vec2 {
  x: number;
  y: number;
}

export const vzero = (): Vec2 => ({ x: 0, y: 0 });
export const vlen = (v: Vec2): number => Math.hypot(v.x, v.y);
export const vclone = (v: Vec2): Vec2 => ({ x: v.x, y: v.y });
