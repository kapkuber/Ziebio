import type { Bullet } from "./tank";
import type { GameEntity } from "./entities";
import {
  SQUARE_SIZE,
  TRIANGLE_SIZE,
  PENTAGON_SIZE,
  computeEntityCollisionRadius,
  triangleWorldVerts,
  pentagonWorldVerts,
  circleIntersectsTriangle,
  circleIntersectsPolygon,
  ENTITY_COLLISION_INSET,
  HIT_FLASH_DURATION,
  ENTITY_BOUNCE,
} from "./entities";
import { BULLET_RADIUS } from "./tank";
import type { CameraInfo } from "./config";
import { SHAPE_BASE_DAMAGE, computeBulletHitDamage } from "./stats";

const BULLET_FILL = "#00b2e1";
const BULLET_STROKE = "#0085a8";
const BULLET_OUTLINE_WIDTH = 2.7;

export interface BulletUpdateParams {
  bullets: Bullet[];
  entities: GameEntity[];
  dt: number;
  camera: CameraInfo;
  spawnsThisFrame: number;
  maxSpawnsPerFrame: number;
  spawnSquare: (entities: GameEntity[]) => boolean;
  spawnTriangle: (entities: GameEntity[]) => boolean;
  spawnPentagon: (entities: GameEntity[]) => boolean;
  queueDeathEffect: (entity: GameEntity) => void;
  onEntityKilled?: (entity: GameEntity) => void;
}

export interface BulletUpdateResult {
  bullets: Bullet[];
  entities: GameEntity[];
  spawnsThisFrame: number;
}

export function updateBullets({
  bullets,
  entities,
  dt,
  camera,
  spawnsThisFrame,
  maxSpawnsPerFrame,
  spawnSquare,
  spawnTriangle,
  spawnPentagon,
  queueDeathEffect,
  onEntityKilled,
}: BulletUpdateParams): BulletUpdateResult {
  bullets.forEach((b) => {
    b.pos.x += b.vel.x * dt;
    b.pos.y += b.vel.y * dt;
    b.life -= dt;
  });

  if (entities.length && bullets.length) {
    let maxBulletRadius = BULLET_RADIUS;
    for (const bullet of bullets) {
      if (bullet.radius > maxBulletRadius) maxBulletRadius = bullet.radius;
    }
    const cellSize = Math.max(SQUARE_SIZE, TRIANGLE_SIZE, PENTAGON_SIZE, maxBulletRadius * 2);
    const bins = new Map<number, GameEntity[]>();
    const key = (cx: number, cy: number) => ((cx << 16) ^ (cy & 0xffff)) | 0;

    for (const entity of entities) {
      const cx = Math.floor(entity.pos.x / cellSize);
      const cy = Math.floor(entity.pos.y / cellSize);
      const k = key(cx, cy);
      let bucket = bins.get(k);
      if (!bucket) {
        bucket = [];
        bins.set(k, bucket);
      }
      bucket.push(entity);
    }

    const removed = new Set<number>();
    let removedSquares = 0;
    let removedTriangles = 0;
    let removedPentagons = 0;

    bulletLoop: for (const bullet of bullets) {
      if (bullet.life <= 0) continue;
      const cx = Math.floor(bullet.pos.x / cellSize);
      const cy = Math.floor(bullet.pos.y / cellSize);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const bucket = bins.get(key(cx + dx, cy + dy));
          if (!bucket) continue;
          for (const entity of bucket) {
            if (removed.has(entity.id)) continue;
            const applyHit = (baseDamage: number, dxh: number, dyh: number, kickSign: 1 | -1) => {
              const actualDamage = computeBulletHitDamage(bullet.damage, bullet.hp, baseDamage);
              (entity as any).hp = Math.max(0, (entity as any).hp - actualDamage);
              (entity as any).hitT = HIT_FLASH_DURATION;
              const len = Math.hypot(dxh, dyh) || 1;
              (entity as any).kick.x += kickSign * (dxh / len) * ENTITY_BOUNCE;
              (entity as any).kick.y += kickSign * (dyh / len) * ENTITY_BOUNCE;
              bullet.hp -= baseDamage;
              if (bullet.hp <= 0) bullet.life = 0;
              if ((entity as any).hp <= 0) {
                queueDeathEffect(entity);
                removed.add(entity.id);
                if (entity.kind === "triangle") removedTriangles += 1;
                else if (entity.kind === "pentagon") removedPentagons += 1;
                else removedSquares += 1;
                if (onEntityKilled) onEntityKilled(entity);
              }
            };
            if (entity.kind === "triangle") {
              const insetSize = Math.max(1, entity.size - 2 * ENTITY_COLLISION_INSET);
              const [v0, v1, v2] = triangleWorldVerts(entity.pos, entity.angle, insetSize);
              if (circleIntersectsTriangle({ x: bullet.pos.x, y: bullet.pos.y }, bullet.radius, v0, v1, v2)) {
                applyHit(SHAPE_BASE_DAMAGE.triangle, entity.pos.x - bullet.pos.x, entity.pos.y - bullet.pos.y, 1);
                continue bulletLoop;
              }
            } else if (entity.kind === "pentagon") {
              const insetSize = Math.max(1, entity.size - 2 * ENTITY_COLLISION_INSET);
              const [p0, p1, p2, p3, p4] = pentagonWorldVerts(entity.pos, entity.angle, insetSize);
              if (circleIntersectsPolygon({ x: bullet.pos.x, y: bullet.pos.y }, bullet.radius, [p0, p1, p2, p3, p4])) {
                applyHit(SHAPE_BASE_DAMAGE.pentagon, entity.pos.x - bullet.pos.x, entity.pos.y - bullet.pos.y, 1);
                continue bulletLoop;
              }
            } else {
              const dxp = bullet.pos.x - entity.pos.x;
              const dyp = bullet.pos.y - entity.pos.y;
              const radius = bullet.radius + computeEntityCollisionRadius(entity.size);
              if (dxp * dxp + dyp * dyp <= radius * radius) {
                applyHit(SHAPE_BASE_DAMAGE.square, dxp, dyp, -1);
                continue bulletLoop;
              }
            }
          }
        }
      }
    }

    if (removed.size) {
      entities = entities.filter((entity) => !removed.has(entity.id));
      let spawned = 0;
      while (removedSquares > 0 && spawned < maxSpawnsPerFrame) {
        if (spawnSquare(entities)) {
          removedSquares -= 1;
          spawned += 1;
          spawnsThisFrame++;
        } else {
          break;
        }
      }
      while (removedTriangles > 0 && spawned < maxSpawnsPerFrame) {
        if (spawnTriangle(entities)) {
          removedTriangles -= 1;
          spawned += 1;
          spawnsThisFrame++;
        } else {
          break;
        }
      }
      while (removedPentagons > 0 && spawned < maxSpawnsPerFrame) {
        if (spawnPentagon(entities)) {
          removedPentagons -= 1;
          spawned += 1;
          spawnsThisFrame++;
        } else {
          break;
        }
      }
    }
  }

  const { x: camX, y: camY, width, height } = camera;
  const nextBullets: Bullet[] = [];
  for (const bullet of bullets) {
    if (bullet.life <= 0) continue;
    const sx = bullet.pos.x - camX;
    const sy = bullet.pos.y - camY;
    if (sx > -40 && sx < width + 40 && sy > -40 && sy < height + 40) {
      nextBullets.push(bullet);
    }
  }

  return {
    bullets: nextBullets,
    entities,
    spawnsThisFrame,
  };
}

export function renderBullets(
  ctx: CanvasRenderingContext2D,
  bullets: Bullet[],
  camera: CameraInfo,
): void {
  const { x: camX, y: camY } = camera;
  ctx.fillStyle = BULLET_FILL;
  ctx.strokeStyle = BULLET_STROKE;
  ctx.lineWidth = BULLET_OUTLINE_WIDTH;
  for (const bullet of bullets) {
    ctx.beginPath();
    ctx.arc(bullet.pos.x - camX, bullet.pos.y - camY, bullet.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}
