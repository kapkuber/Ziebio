import type { Bullet } from "./tank";
import type { GameEntity } from "./entities";
import {
  SQUARE_SIZE,
  TRIANGLE_SIZE,
  PENTAGON_SIZE,
  computeEntityCollisionRadius,
  triangleWorldVerts,
  pentagonWorldVerts,
  ENTITY_COLLISION_INSET,
  HIT_FLASH_DURATION,
  ENTITY_BOUNCE,
} from "./entities";
import { circleIntersectsTriangle, circleIntersectsPolygon } from "./geometry";
import { BULLET_RADIUS } from "./tank";
import type { CameraInfo } from "./config";
import { SHAPE_BASE_DAMAGE, TICK_DURATION } from "./stats";
import { getTeamPalette } from "./teams";

const BULLET_OUTLINE_WIDTH = 2.7;
// Per-tick velocity impulse applied to a bullet while it overlaps an entity,
// directed away from the entity center. Friction-free, so it permanently bends
// the bullet's trajectory. Magnitude tuned so a base bullet glancing through a
// square barely deflects (~5°), while a slow high-pen bullet drilling a
// pentagon for many ticks deflects noticeably (~25°). Bullet speed naturally
// reduces the angular effect (same impulse, larger velocity = smaller angle).
const BULLET_BOUNCE = 35;

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

    // diep-style: per-tick body-damage exchange while bullet overlaps entity.
    // Each tick (TICK_DURATION = 40ms) the entity loses bullet.damage and the
    // bullet loses the entity's baseDamage. tickScale converts the per-tick
    // calibration to whatever dt the frame actually ran at, so balance is
    // framerate-independent. A base bullet (hp=7) vs a square (baseDamage=7)
    // dies in exactly one tick of overlap, matching the prior one-shot model;
    // a high-pen bullet keeps ticking until it loses contact or runs out of hp.
    const tickScale = dt / TICK_DURATION;

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
            if (bullet.life <= 0) continue bulletLoop;
            const applyHit = (baseDamage: number, dxh: number, dyh: number, kickSign: 1 | -1) => {
              let entityDmg = bullet.damage * tickScale;
              let bulletDmg = baseDamage * tickScale;
              // Mutual overkill scaling, mirroring diep's receiveDamage: when
              // either side would die before delivering its full damage, both
              // sides' contributions scale down by the same ratio. This is what
              // stops a high-pen bullet from paying full body damage to finish
              // off a polygon that only had a sliver of hp left — without it,
              // pure-pen builds out-trade balanced pen+speed builds because
              // they have more hp to waste on overkill ticks.
              const eHp = (entity as any).hp as number;
              if (entityDmg > eHp) {
                const scale = eHp / entityDmg;
                entityDmg *= scale;
                bulletDmg *= scale;
              } else if (bulletDmg > bullet.hp) {
                const scale = bullet.hp / bulletDmg;
                entityDmg *= scale;
                bulletDmg *= scale;
              }
              (entity as any).hp = Math.max(0, eHp - entityDmg);
              (entity as any).hitT = HIT_FLASH_DURATION;
              const len = Math.hypot(dxh, dyh) || 1;
              const nx = dxh / len;
              const ny = dyh / len;
              // kickSign * (nx, ny) always points from the bullet toward the
              // entity center, so the entity gets pushed away from the bullet
              // and the bullet gets pushed away from the entity (opposite sign).
              (entity as any).kick.x += kickSign * nx * ENTITY_BOUNCE * tickScale;
              (entity as any).kick.y += kickSign * ny * ENTITY_BOUNCE * tickScale;
              bullet.vel.x -= kickSign * nx * BULLET_BOUNCE * tickScale;
              bullet.vel.y -= kickSign * ny * BULLET_BOUNCE * tickScale;
              bullet.hp -= bulletDmg;
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
              }
            } else if (entity.kind === "pentagon") {
              const insetSize = Math.max(1, entity.size - 2 * ENTITY_COLLISION_INSET);
              const [p0, p1, p2, p3, p4] = pentagonWorldVerts(entity.pos, entity.angle, insetSize);
              if (circleIntersectsPolygon({ x: bullet.pos.x, y: bullet.pos.y }, bullet.radius, [p0, p1, p2, p3, p4])) {
                applyHit(SHAPE_BASE_DAMAGE.pentagon, entity.pos.x - bullet.pos.x, entity.pos.y - bullet.pos.y, 1);
              }
            } else {
              const dxp = bullet.pos.x - entity.pos.x;
              const dyp = bullet.pos.y - entity.pos.y;
              const radius = bullet.radius + computeEntityCollisionRadius(entity.size);
              if (dxp * dxp + dyp * dyp <= radius * radius) {
                applyHit(SHAPE_BASE_DAMAGE.square, dxp, dyp, -1);
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

  // Bullet-vs-bullet collisions (HP-swap model)
  // Each bullet reduces the other's hp by the other's pre-collision hp.
  // Equal hp -> both destroyed. Higher hp survives with the difference.
  // Bullets with the same owner pass through each other (friendly fire off).
  if (bullets.length > 1) {
    for (let i = 0; i < bullets.length; i++) {
      const a = bullets[i];
      if (a.life <= 0) continue;
      for (let j = i + 1; j < bullets.length; j++) {
        const b = bullets[j];
        if (b.life <= 0) continue;
        if (a.teamId === b.teamId) continue;
        const dx = a.pos.x - b.pos.x;
        const dy = a.pos.y - b.pos.y;
        const r = a.radius + b.radius;
        if (dx * dx + dy * dy > r * r) continue;
        const aHp = a.hp;
        const bHp = b.hp;
        a.hp -= bHp;
        b.hp -= aHp;
        if (a.hp <= 0) a.life = 0;
        if (b.hp <= 0) b.life = 0;
        const len = Math.hypot(dx, dy) || 1;
        const nx = dx / len;
        const ny = dy / len;
        const KNOCK = 60;
        a.vel.x += nx * KNOCK;
        a.vel.y += ny * KNOCK;
        b.vel.x -= nx * KNOCK;
        b.vel.y -= ny * KNOCK;
        if (a.life <= 0) break;
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
  ctx.lineWidth = BULLET_OUTLINE_WIDTH;
  // Fill/stroke set per-bullet from the firing team's palette. Cheap at
  // current bullet counts; group-by-team if it ever shows up in a profile.
  for (const bullet of bullets) {
    const palette = getTeamPalette(bullet.teamId);
    ctx.fillStyle = palette.bullet;
    ctx.strokeStyle = palette.accentDim;
    ctx.beginPath();
    ctx.arc(bullet.pos.x - camX, bullet.pos.y - camY, bullet.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}
