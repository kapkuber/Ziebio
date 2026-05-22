// Entity logic and constants
export interface Vec2 { x: number; y: number }

export type EntityKind = 'square' | 'triangle' | 'pentagon'

export interface GameEntity {
  id: number;
  pos: Vec2;
  vel: Vec2;       // base drift velocity
  kick: Vec2;      // transient knockback that decays
  angle: number;   // radians
  angVel: number;  // radians per second
  size: number;    // visual size in px
  kind: EntityKind;
  fill: string;
  stroke: string;
  hp: number;
  maxHp: number;
  hitT?: number;
}

// Squares
export const SQUARE_FILL = "#ffe869";
export const SQUARE_STROKE = "#bfae4e";
export const SQUARE_SIZE = 38; // px (square)
export const SQUARE_MAX_COUNT = 18;
export const SQUARE_MAX_HP = 10;

// Triangles
export const TRIANGLE_FILL = "#fc7677";
export const TRIANGLE_STROKE = "#bd5859";
export const TRIANGLE_SIZE = 43;
export const TRIANGLE_MAX_COUNT = 5;
export const TRIANGLE_MAX_HP = 30;

// Pentagons
export const PENTAGON_FILL = "#768DFC";
export const PENTAGON_STROKE = "#5869BD";
export const PENTAGON_SIZE = 56;
export const PENTAGON_MAX_COUNT = 3;
export const PENTAGON_MAX_HP = 100;

// Movement
export const ENTITY_SPEED_MIN = 5;  // px/s
export const ENTITY_SPEED_MAX = 8; // px/s
export const ENTITY_ANG_MIN = -0.6; // rad/s
export const ENTITY_ANG_MAX = 0.6;  // rad/s
export const ENTITY_KICK_FRICTION = 6.0; // per-second damping for transient knockback
export const ENTITY_COLLISION_INSET = 3; // px inset for collision zone inside visible area
export const ENTITY_BOUNCE = 30; // generic bounce impulse for entity reactions
export const HIT_FLASH_DURATION = 0.06; // seconds for damage flash (fade in/out quickly)
export const HIT_FILL = '#ff2021';
export const HIT_STROKE = '#f01717';
// Player contact damage
// Death animation
export const DEATH_ANIM_DURATION = 0.06; // seconds

// Spawning / reproduction
export const REPRO_RATE = 0.05; // chance/sec each entity reproduces
export const REPRO_NEAR_MIN = 40; // px
export const REPRO_NEAR_MAX = 140; // px

export function computeEntityCollisionRadius(size: number): number {
  // Circle radius that fits into the shape minus inset
  return Math.max(0, (size * Math.SQRT2) / 2 - ENTITY_COLLISION_INSET);
}

// Geometry helpers for triangle collisions
export function triangleWorldVerts(pos: Vec2, angle: number, size: number): [Vec2, Vec2, Vec2] {
  const s = Math.max(1, size);
  const halfSide = s / 2;
  const height = (s * Math.sqrt(3)) / 2;
  const top: Vec2 = { x: 0, y: - (2 / 3) * height };
  const br: Vec2 = { x: halfSide, y: (1 / 3) * height };
  const bl: Vec2 = { x: -halfSide, y: (1 / 3) * height };
  const ca = Math.cos(angle), sa = Math.sin(angle);
  const rot = (p: Vec2): Vec2 => ({ x: p.x * ca - p.y * sa + pos.x, y: p.x * sa + p.y * ca + pos.y });
  return [rot(top), rot(br), rot(bl)];
}

export function squareWorldVerts(pos: Vec2, angle: number, size: number): [Vec2, Vec2, Vec2, Vec2] {
  const s = Math.max(1, size);
  const hs = s / 2;
  const local: Vec2[] = [
    { x: -hs, y: -hs },
    { x: hs, y: -hs },
    { x: hs, y: hs },
    { x: -hs, y: hs },
  ];
  const ca = Math.cos(angle), sa = Math.sin(angle);
  const rot = (p: Vec2): Vec2 => ({ x: p.x * ca - p.y * sa + pos.x, y: p.x * sa + p.y * ca + pos.y });
  return [rot(local[0]), rot(local[1]), rot(local[2]), rot(local[3])];
}

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

function traceShapePath(
  ctx: CanvasRenderingContext2D,
  kind: EntityKind,
  size: number,
  halfSize: number,
): void {
  if (kind === 'triangle') {
    const halfSide = size / 2;
    const height = (size * Math.sqrt(3)) / 2;
    const topY = - (2 / 3) * height;
    const baseY = (1 / 3) * height;
    ctx.moveTo(0, topY);
    ctx.lineTo(halfSide, baseY);
    ctx.lineTo(-halfSide, baseY);
    ctx.closePath();
  } else if (kind === 'pentagon') {
    const R = size / 2;
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i * Math.PI * 2) / 5;
      const x = Math.cos(a) * R;
      const y = Math.sin(a) * R;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  } else {
    ctx.rect(-halfSize, -halfSize, size, size);
  }
}

function pointInTriangle(p: Vec2, a: Vec2, b: Vec2, c: Vec2): boolean {
  // barycentric technique
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

export function pointInPolygon(p: Vec2, verts: Vec2[]): boolean {
  // ray casting
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

function entityKindStats(kind: EntityKind): {
  size: number;
  fill: string;
  stroke: string;
  maxHp: number;
  maxCount: number;
} {
  switch (kind) {
    case 'triangle':
      return { size: TRIANGLE_SIZE, fill: TRIANGLE_FILL, stroke: TRIANGLE_STROKE, maxHp: TRIANGLE_MAX_HP, maxCount: TRIANGLE_MAX_COUNT };
    case 'pentagon':
      return { size: PENTAGON_SIZE, fill: PENTAGON_FILL, stroke: PENTAGON_STROKE, maxHp: PENTAGON_MAX_HP, maxCount: PENTAGON_MAX_COUNT };
    default:
      return { size: SQUARE_SIZE, fill: SQUARE_FILL, stroke: SQUARE_STROKE, maxHp: SQUARE_MAX_HP, maxCount: SQUARE_MAX_COUNT };
  }
}

function countOfKind(entities: GameEntity[], kind: EntityKind): number {
  let n = 0;
  for (const e of entities) if (e.kind === kind) n++;
  return n;
}

export function spawnEntityRandomAvoidingPlayers(
  entities: GameEntity[],
  nextEntityIdRef: { current: number },
  playerPos: Vec2,
  mapW: number,
  mapH: number,
  safeRadius: number,
  kind: EntityKind = 'square',
): boolean {
  const stats = entityKindStats(kind);
  if (countOfKind(entities, kind) >= stats.maxCount) return false;
  for (let i = 0; i < 20; i++) {
    const x = Math.random() * mapW;
    const y = Math.random() * mapH;
    const dx = x - playerPos.x;
    const dy = y - playerPos.y;
    if (dx * dx + dy * dy < safeRadius * safeRadius) continue;

    const speed = ENTITY_SPEED_MIN + Math.random() * (ENTITY_SPEED_MAX - ENTITY_SPEED_MIN);
    const dir = Math.random() * Math.PI * 2;
    const angVel = ENTITY_ANG_MIN + Math.random() * (ENTITY_ANG_MAX - ENTITY_ANG_MIN);
    entities.push({
      id: nextEntityIdRef.current++,
      pos: { x, y },
      vel: { x: Math.cos(dir) * speed, y: Math.sin(dir) * speed },
      kick: { x: 0, y: 0 },
      angle: Math.random() * Math.PI * 2,
      angVel,
      size: stats.size,
      kind,
      fill: stats.fill,
      stroke: stats.stroke,
      hp: stats.maxHp,
      maxHp: stats.maxHp,
    });
    return true;
  }
  return false;
}

export function spawnEntityNearAvoidingPlayers(
  entities: GameEntity[],
  nextEntityIdRef: { current: number },
  baseX: number,
  baseY: number,
  playerPos: Vec2,
  mapW: number,
  mapH: number,
  safeRadius: number,
  kind: EntityKind = 'square',
): boolean {
  const stats = entityKindStats(kind);
  if (countOfKind(entities, kind) >= stats.maxCount) return false;
  const angle = Math.random() * Math.PI * 2;
  const dist = REPRO_NEAR_MIN + Math.random() * (REPRO_NEAR_MAX - REPRO_NEAR_MIN);
  const x = Math.max(0, Math.min(mapW, baseX + Math.cos(angle) * dist));
  const y = Math.max(0, Math.min(mapH, baseY + Math.sin(angle) * dist));
  const dx = x - playerPos.x;
  const dy = y - playerPos.y;
  if (dx * dx + dy * dy < safeRadius * safeRadius) return false;

  const speed = ENTITY_SPEED_MIN + Math.random() * (ENTITY_SPEED_MAX - ENTITY_SPEED_MIN);
  const dir = Math.random() * Math.PI * 2;
  const angVel = ENTITY_ANG_MIN + Math.random() * (ENTITY_ANG_MAX - ENTITY_ANG_MIN);
  entities.push({
    id: nextEntityIdRef.current++,
    pos: { x, y },
    vel: { x: Math.cos(dir) * speed, y: Math.sin(dir) * speed },
    kick: { x: 0, y: 0 },
    angle: Math.random() * Math.PI * 2,
    angVel,
    size: stats.size,
    kind,
    fill: stats.fill,
    stroke: stats.stroke,
    hp: stats.maxHp,
    maxHp: stats.maxHp,
  });
  return true;
}

export function updateEntities(
  dt: number,
  entities: GameEntity[],
  playerPos: Vec2,
  playerVel: Vec2,
  mapW: number,
  mapH: number,
  tankRadius: number,
  maybeSpawnNear: (x: number, y: number, kind: EntityKind) => void,
  onPlayerCollide?: (entity: GameEntity, dt: number) => void,
): void {
  for (const e of entities) {
    // integrate
    e.pos.x += (e.vel.x + e.kick.x) * dt;
    e.pos.y += (e.vel.y + e.kick.y) * dt;
    const kd = Math.max(0, 1 - ENTITY_KICK_FRICTION * dt);
    e.kick.x *= kd;
    e.kick.y *= kd;
    e.angle += e.angVel * dt;
    if (e.pos.x < 0) { e.pos.x = 0; e.vel.x = Math.abs(e.vel.x); }
    if (e.pos.x > mapW) { e.pos.x = mapW; e.vel.x = -Math.abs(e.vel.x); }
    if (e.pos.y < 0) { e.pos.y = 0; e.vel.y = Math.abs(e.vel.y); }
    if (e.pos.y > mapH) { e.pos.y = mapH; e.vel.y = -Math.abs(e.vel.y); }

    const insetSize = Math.max(1, e.size - 6);
    let verts: Vec2[];
    if (e.kind === 'triangle') {
      const [v0, v1, v2] = triangleWorldVerts(e.pos, e.angle, insetSize);
      verts = [v0, v1, v2];
    } else if (e.kind === 'pentagon') {
      const [p0, p1, p2, p3, p4] = pentagonWorldVerts(e.pos, e.angle, insetSize);
      verts = [p0, p1, p2, p3, p4];
    } else {
      const [r0, r1, r2, r3] = squareWorldVerts(e.pos, e.angle, insetSize);
      verts = [r0, r1, r2, r3];
    }
    const cp = closestPointOnPolygon(playerPos, verts);
    const ndx = playerPos.x - cp.x;
    const ndy = playerPos.y - cp.y;
    const d2 = ndx * ndx + ndy * ndy;
    if (d2 <= tankRadius * tankRadius) {
      const d = Math.max(1e-6, Math.sqrt(d2));
      const nx = ndx / d;
      const ny = ndy / d;
      const penetration = tankRadius - d;
      const push = penetration * 0.5;
      // separate
      playerPos.x += nx * push;
      playerPos.y += ny * push;
      e.pos.x -= nx * push;
      e.pos.y -= ny * push;
      // impulses
      const PLAYER_BOUNCE = 50;
      playerVel.x += nx * PLAYER_BOUNCE;
      playerVel.y += ny * PLAYER_BOUNCE;
      e.kick.x -= nx * ENTITY_BOUNCE;
      e.kick.y -= ny * ENTITY_BOUNCE;
      // Report contact damage every collision tick. Diep/arras have no
      // per-engagement cooldown — damage applies every frame of overlap,
      // with deathFactor and speed-impact scaling producing the "full-speed
      // insta-kill" vs "slow takes longer" feel.
      if (onPlayerCollide) onPlayerCollide(e, dt);
    }

    // reproduction chance (defer per-kind cap check to caller via maybeSpawnNear)
    if (Math.random() < REPRO_RATE * dt) {
      maybeSpawnNear(e.pos.x, e.pos.y, e.kind);
    }
    // decay hit flash timer
    if (e.hitT && e.hitT > 0) {
      e.hitT = Math.max(0, e.hitT - dt);
    }
  }
}

export function drawEntities(
  ctx: CanvasRenderingContext2D,
  viewW: number,
  viewH: number,
  camX: number,
  camY: number,
  entities: GameEntity[],
) {
  for (const e of entities) {
    const sx = e.pos.x - camX;
    const sy = e.pos.y - camY;
    const s = e.size;
    const hs = s / 2;
    if (sx < -s || sx > viewW + s || sy < -s || sy > viewH + s) continue;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(e.angle);
    ctx.fillStyle = e.fill;
    ctx.strokeStyle = e.stroke;
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    traceShapePath(ctx, e.kind, s, hs);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // red damage flash overlay with quick fade in/out
    if (e.hitT && e.hitT > 0) {
      const t = Math.max(0, Math.min(HIT_FLASH_DURATION, e.hitT));
      const phase = 1 - t / HIT_FLASH_DURATION; // 0 -> 1 over duration
      const alpha = Math.sin(phase * Math.PI);  // fade in/out
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(e.angle);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = HIT_FILL;
      ctx.strokeStyle = HIT_STROKE;
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      traceShapePath(ctx, e.kind, s, hs);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // health bar (only if damaged)
    if (e.hp < e.maxHp) {
      const ratio = Math.max(0, Math.min(1, e.hp / e.maxHp));
      const barW = Math.max(18, s * 1.1);
      const barH = 7; // track thickness
      const radius = barH / 2;
      const bx = sx - barW / 2;
      const by = sy + s / 2 + 11;
      // track
      ctx.fillStyle = '#555555';
      ctx.beginPath();
      ctx.moveTo(bx + radius, by);
      ctx.lineTo(bx + barW - radius, by);
      ctx.arc(bx + barW - radius, by + radius, radius, -Math.PI / 2, Math.PI / 2);
      ctx.lineTo(bx + radius, by + barH);
      ctx.arc(bx + radius, by + radius, radius, Math.PI / 2, -Math.PI / 2);
      ctx.closePath();
      ctx.fill();
      // thinner fill centered inside the track
      const innerH = 4; // thinner fill
      const innerR = innerH / 2;
      const pad = (barH - innerH) / 2;
      const innerX = bx + pad; // horizontal inset equals vertical inset
      const fy = by + pad; // vertical inset
      const innerW = barW - 2 * pad; // available width for the green fill

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
    }
  }
}

// --- Shape-on-shape collisions (SAT) ---

function normalize(v: Vec2): Vec2 {
  const len = Math.hypot(v.x, v.y) || 1e-6;
  return { x: v.x / len, y: v.y / len };
}

function dot(a: Vec2, b: Vec2): number { return a.x * b.x + a.y * b.y }

function edgeNormal(a: Vec2, b: Vec2): Vec2 {
  // outward normal of edge a->b
  const ex = b.x - a.x, ey = b.y - a.y;
  return normalize({ x: -ey, y: ex });
}

function projectPolygon(axis: Vec2, verts: Vec2[]): { min: number; max: number } {
  let min = dot(axis, verts[0]);
  let max = min;
  for (let i = 1; i < verts.length; i++) {
    const p = dot(axis, verts[i]);
    if (p < min) min = p; else if (p > max) max = p;
  }
  return { min, max };
}

function satMTV(vertsA: Vec2[], vertsB: Vec2[], centerAX: number, centerAY: number, centerBX: number, centerBY: number): Vec2 | null {
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
        // axis should point from A to B for consistent push
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

export function resolveEntityEntityCollisions(entities: GameEntity[]): void {
  const N = entities.length;
  if (N <= 1) return;
  const INSET = 6;
  const BOUNCE = 120; // impulse strength
  const vertsFor = (e: GameEntity, size: number): Vec2[] => {
    if (e.kind === 'triangle') {
      const [v0, v1, v2] = triangleWorldVerts(e.pos, e.angle, size);
      return [v0, v1, v2];
    }
    if (e.kind === 'pentagon') {
      const [p0, p1, p2, p3, p4] = pentagonWorldVerts(e.pos, e.angle, size);
      return [p0, p1, p2, p3, p4];
    }
    const [r0, r1, r2, r3] = squareWorldVerts(e.pos, e.angle, size);
    return [r0, r1, r2, r3];
  };
  for (let i = 0; i < N; i++) {
    const a = entities[i];
    const sizeA = Math.max(1, a.size - INSET);
    const vertsA = vertsFor(a, sizeA);
    for (let j = i + 1; j < N; j++) {
      const b = entities[j];
      const sizeB = Math.max(1, b.size - INSET);
      const vertsB = vertsFor(b, sizeB);

      const mtv = satMTV(vertsA, vertsB, a.pos.x, a.pos.y, b.pos.x, b.pos.y);
      if (!mtv) continue;
      // separate half along mtv
      a.pos.x -= mtv.x * 0.5;
      a.pos.y -= mtv.y * 0.5;
      b.pos.x += mtv.x * 0.5;
      b.pos.y += mtv.y * 0.5;
      // apply bounce impulses along separation axis
      const n = normalize(mtv);
      a.kick.x -= n.x * BOUNCE;
      a.kick.y -= n.y * BOUNCE;
      b.kick.x += n.x * BOUNCE;
      b.kick.y += n.y * BOUNCE;
    }
  }
}


// --- Death effects (expand + fade) ---

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
  // remove finished
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
    const hs = drawSize / 2;

    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(fx.angle);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = fx.fill;
    ctx.strokeStyle = fx.stroke;
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    traceShapePath(ctx, fx.kind, drawSize, hs);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}
