// Shared shape math. Pure functions — no game state, no canvas. Lives
// outside ./entities and ./buildings so any collidable system (polygons,
// projectiles, future custom shapes) can import the helpers without
// reaching into another module's internals.
//
// Vec2 owns its home here because every helper that takes a point or
// returns one needs the type; re-exported through ./entities for the
// barrel so existing callers don't have to change imports.

export interface Vec2 { x: number; y: number }

// === Triangle ===

function pointInTriangle(p: Vec2, a: Vec2, b: Vec2, c: Vec2): boolean {
  // Barycentric technique. Numerically stable for triangles that aren't
  // degenerate; we add 1e-8 in the denominator just in case.
  const v0x = c.x - a.x, v0y = c.y - a.y;
  const v1x = b.x - a.x, v1y = b.y - a.y;
  const v2x = p.x - a.x, v2y = p.y - a.y;
  const dot00 = v0x * v0x + v0y * v0y;
  const dot01 = v0x * v1x + v0y * v1y;
  const dot02 = v0x * v2x + v0y * v2y;
  const dot11 = v1x * v1x + v1y * v1y;
  const dot12 = v1x * v2x + v1y * v2y;
  const invDen = 1 / Math.max(1e-8, (dot00 * dot11 - dot01 * dot01));
  const u = (dot11 * dot02 - dot01 * dot12) * invDen;
  const v = (dot00 * dot12 - dot01 * dot02) * invDen;
  return u >= 0 && v >= 0 && (u + v) <= 1;
}

function closestPointOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const abx = b.x - a.x, aby = b.y - a.y;
  const apx = p.x - a.x, apy = p.y - a.y;
  const ab2 = abx * abx + aby * aby;
  const t = ab2 > 0 ? Math.max(0, Math.min(1, (apx * abx + apy * aby) / ab2)) : 0;
  return { x: a.x + abx * t, y: a.y + aby * t };
}

export function closestPointOnTriangle(p: Vec2, a: Vec2, b: Vec2, c: Vec2): Vec2 {
  if (pointInTriangle(p, a, b, c)) return { x: p.x, y: p.y };
  const p1 = closestPointOnSegment(p, a, b);
  const p2 = closestPointOnSegment(p, b, c);
  const p3 = closestPointOnSegment(p, c, a);
  const d1 = (p1.x - p.x) ** 2 + (p1.y - p.y) ** 2;
  const d2 = (p2.x - p.x) ** 2 + (p2.y - p.y) ** 2;
  const d3 = (p3.x - p.x) ** 2 + (p3.y - p.y) ** 2;
  if (d1 <= d2 && d1 <= d3) return p1;
  if (d2 <= d1 && d2 <= d3) return p2;
  return p3;
}

export function circleIntersectsTriangle(center: Vec2, radius: number, a: Vec2, b: Vec2, c: Vec2): boolean {
  const q = closestPointOnTriangle(center, a, b, c);
  const dx = center.x - q.x, dy = center.y - q.y;
  return (dx * dx + dy * dy) <= radius * radius;
}

// === Generic convex polygon ===

export function pointInPolygon(p: Vec2, verts: Vec2[]): boolean {
  // Ray casting. Handles any simple polygon, convex or not.
  let inside = false;
  for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
    const xi = verts[i].x, yi = verts[i].y;
    const xj = verts[j].x, yj = verts[j].y;
    const intersect = ((yi > p.y) !== (yj > p.y)) && (p.x < ((xj - xi) * (p.y - yi)) / (yj - yi + 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

export function closestPointOnPolygon(p: Vec2, verts: Vec2[]): Vec2 {
  if (pointInPolygon(p, verts)) return { x: p.x, y: p.y };
  let best: Vec2 | null = null;
  let bestD = Infinity;
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % verts.length];
    const q = closestPointOnSegment(p, a, b);
    const dx = q.x - p.x, dy = q.y - p.y;
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = q; }
  }
  return best || { x: p.x, y: p.y };
}

export function circleIntersectsPolygon(center: Vec2, radius: number, verts: Vec2[]): boolean {
  const q = closestPointOnPolygon(center, verts);
  const dx = center.x - q.x, dy = center.y - q.y;
  return (dx * dx + dy * dy) <= radius * radius;
}

// === Circle vs axis-aligned bounding box ===
// Minimum translation vector (MTV) for a circle of radius r at (cx, cy)
// overlapping an AABB. Returns null if no overlap. The normal points from
// the closest AABB point toward the circle center; when the center sits
// inside the AABB it ejects along the shortest face axis.
//
// Used by core + building collision (both are AABB chassis pushed against
// circular polygons + the circular tank). Lives here rather than next to
// either caller so the two systems share one implementation.
export function aabbCircleMTV(
  rectMinX: number,
  rectMinY: number,
  rectMaxX: number,
  rectMaxY: number,
  cx: number,
  cy: number,
  r: number,
): { nx: number; ny: number; pen: number } | null {
  const closestX = Math.max(rectMinX, Math.min(cx, rectMaxX));
  const closestY = Math.max(rectMinY, Math.min(cy, rectMaxY));
  const dx = cx - closestX;
  const dy = cy - closestY;
  const d2 = dx * dx + dy * dy;
  if (d2 >= r * r) return null;
  if (d2 > 1e-6) {
    const d = Math.sqrt(d2);
    return { nx: dx / d, ny: dy / d, pen: r - d };
  }
  // Center is inside the box — eject along the shortest face axis.
  const exitL = cx - rectMinX;
  const exitR = rectMaxX - cx;
  const exitT = cy - rectMinY;
  const exitB = rectMaxY - cy;
  const exit = Math.min(exitL, exitR, exitT, exitB);
  if (exit === exitL) return { nx: -1, ny: 0, pen: r + exit };
  if (exit === exitR) return { nx:  1, ny: 0, pen: r + exit };
  if (exit === exitT) return { nx: 0, ny: -1, pen: r + exit };
  return { nx: 0, ny: 1, pen: r + exit };
}

// === SAT (Separating Axis Theorem) for convex polygon vs convex polygon ===
// Returns the minimum translation vector to separate B from A (points from
// A toward B), or null if they don't overlap. Used for entity-entity
// collision resolution; reusable for any other rotated-rect / rotated-poly
// collision pair (e.g. future rotating walls).

function normalize(v: Vec2): Vec2 {
  const len = Math.hypot(v.x, v.y) || 1e-6;
  return { x: v.x / len, y: v.y / len };
}

function dot(a: Vec2, b: Vec2): number { return a.x * b.x + a.y * b.y; }

function edgeNormal(a: Vec2, b: Vec2): Vec2 {
  // Outward normal of edge a->b (perpendicular, rotated 90° CCW).
  const ex = b.x - a.x, ey = b.y - a.y;
  return normalize({ x: -ey, y: ex });
}

function projectPolygon(axis: Vec2, verts: Vec2[]): { min: number; max: number } {
  let min = dot(axis, verts[0]);
  let max = min;
  for (let i = 1; i < verts.length; i++) {
    const p = dot(axis, verts[i]);
    if (p < min) min = p;
    else if (p > max) max = p;
  }
  return { min, max };
}

export function satMTV(
  vertsA: Vec2[],
  vertsB: Vec2[],
  centerAX: number,
  centerAY: number,
  centerBX: number,
  centerBY: number,
): Vec2 | null {
  let minOverlap = Infinity;
  let mtvAxis: Vec2 = { x: 0, y: 0 };
  let found = false;
  const testAxesFrom = (verts: Vec2[]) => {
    for (let i = 0; i < verts.length; i++) {
      const a = verts[i];
      const b = verts[(i + 1) % verts.length];
      const axis = edgeNormal(a, b);
      const pa = projectPolygon(axis, vertsA);
      const pb = projectPolygon(axis, vertsB);
      const overlap = Math.min(pa.max, pb.max) - Math.max(pa.min, pb.min);
      if (overlap <= 0) return false;
      if (overlap < minOverlap) {
        minOverlap = overlap;
        // Axis should point from A to B for consistent push direction.
        const dirX = centerBX - centerAX;
        const dirY = centerBY - centerAY;
        const sign = (dot(axis, { x: dirX, y: dirY }) < 0) ? -1 : 1;
        mtvAxis = { x: axis.x * sign, y: axis.y * sign };
        found = true;
      }
    }
    return true;
  };
  if (!testAxesFrom(vertsA)) return null;
  if (!testAxesFrom(vertsB)) return null;
  if (!found || !isFinite(minOverlap)) return null;
  return { x: mtvAxis.x * minOverlap, y: mtvAxis.y * minOverlap };
}
