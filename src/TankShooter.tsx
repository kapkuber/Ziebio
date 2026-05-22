import { useEffect, useRef, useState } from "react";
import type { Vec2 as EntVec2, GameEntity } from "./game/entities";
import {
  SQUARE_MAX_COUNT,
  TRIANGLE_MAX_COUNT,
  PENTAGON_MAX_COUNT,
  HIT_FLASH_DURATION,
  resolveEntityEntityCollisions,
  spawnEntityRandomAvoidingPlayers as entsSpawnRandom,
  spawnEntityNearAvoidingPlayers as entsSpawnNear,
  updateEntities as entsUpdate,
  drawEntities as entsDraw,
  queueDeathEffectFromEntity as entsQueueDeathFx,
  updateDeathEffects as entsDeathUpdate,
  drawDeathEffects as entsDeathDraw,
} from "./game/entities";
import type { Bullet } from "./game/tank";
import {
  TANK_RADIUS,
  BULLET_LIFETIME,
  BULLET_RADIUS,
  spawnBullet as tankSpawnBullet,
  drawTank as tankDraw,
  drawTankHealthBar as tankDrawHp,
  drawTankDamageFlash as tankDrawHit,
  integrateTank,
} from "./game/tank";
import {
  GRID_SIZE,
  MAP_HEIGHT,
  MAP_WIDTH,
  SPAWN_SAFE_RADIUS,
  MAX_SPAWNS_PER_FRAME,
  type CameraInfo,
} from "./game/config";
import { createGridPatterns, drawGrid, type GridPatterns } from "./game/grid";
import { updateBullets, renderBullets } from "./game/bulletSystem";
import {
  STAT_ORDER,
  STAT_LABELS,
  MAX_STAT_POINTS,
  MAX_LEVEL,
  REGEN_HYPER_DELAY,
  REGEN_HYPER_FRACTION,
  availableSkillPoints,
  baseMaxHpForLevel,
  computeDerivedStats,
  impactMultiplierFromSpeed,
  scoreForKill,
  xpForKill,
  xpForNextLevel,
  SHAPE_BODY_DAMAGE_TO_TANK,
  type StatKey,
  type StatPoints,
} from "./game/stats";

/**
 * Suggested repo setup (outside this file):
 * - Vite + React + TypeScript
 * - ESLint + Prettier
 */

// Utility types
type Vec2 = EntVec2;

type SquareEntity = GameEntity;

const INITIAL_STATS: StatPoints = {
  maxHealth: 0,
  healthRegen: 0,
  bodyDamage: 0,
  bulletSpeed: 0,
  bulletPenetration: 0,
  bulletDamage: 0,
  reload: 0,
  movementSpeed: 0,
};

const STAT_COLORS: Record<StatKey, string> = {
  healthRegen: "#EF99C3",
  maxHealth: "#8D6ADF",
  bodyDamage: "#D83848",
  bulletSpeed: "#3CA4CB",
  bulletPenetration: "#B9E87E",
  bulletDamage: "#FDF380",
  reload: "#E7896D",
  movementSpeed: "#70D1CA",
};

export default function TankShooter() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const bulletsRef = useRef<Bullet[]>([]);
  const bulletIdRef = useRef(1);
  const lastTsRef = useRef<number | null>(null);
  // Pick a random world position for the tank, kept some margin away from the
  // map edges. Entity seeding (below) uses this position with SPAWN_SAFE_RADIUS,
  // so entities will avoid spawning on top of the player.
  const initialTankPos = (() => {
    const margin = 4 * GRID_SIZE;
    return {
      x: margin + Math.random() * (MAP_WIDTH - 2 * margin),
      y: margin + Math.random() * (MAP_HEIGHT - 2 * margin),
    };
  })();
  const tankPosRef = useRef<Vec2>(initialTankPos); // player's WORLD position
  const tankVelRef = useRef<Vec2>({ x: 0, y: 0 }); // player's WORLD velocity
  const tankHpRef = useRef<number>(baseMaxHpForLevel(1));
  const tankHitTRef = useRef<number>(0);
  const keysRef = useRef<Set<string>>(new Set());
  const mouseRef = useRef<Vec2>({ x: 0, y: 0 });
  const mouseDownRef = useRef<boolean>(false);
  const cooldownRemainingRef = useRef<number>(0);
  const gridPatternsRef = useRef<GridPatterns>({ inside: null, outside: null });
  const spawnsThisFrameRef = useRef<number>(0);
  const entitiesRef = useRef<SquareEntity[]>([]);
  const nextEntityIdRef = useRef<number>(1);
  const playerStatsRef = useRef<StatPoints>({ ...INITIAL_STATS });
  const playerProgressRef = useRef({ level: 1, xp: 0 });
  const pendingXpRef = useRef<number>(0);
  const pendingScoreRef = useRef<number>(0);
  const timeSinceDamageRef = useRef<number>(0);
  // Visually-lagged HP — lerps toward tankHpRef each frame so the health
  // bar slides smoothly instead of snapping on each damage/regen tick.
  const tankDisplayHpRef = useRef<number>(baseMaxHpForLevel(1));
  // Camera zoom modifier driven by death state: eases toward 1/1.5 ≈ 0.667
  // when dead (1.5× zoom-out from the death position) and back to 1 on
  // respawn. Multiplied into the normal stat-derived zoom each frame.
  const deathZoomRef = useRef<number>(1);

  const [playerStats, setPlayerStats] = useState<StatPoints>({ ...INITIAL_STATS });
  const [playerProgress, setPlayerProgress] = useState({ level: 1, xp: 0 });
  const [score, setScore] = useState(0);
  // Alive flag is a ref for the frame loop (no re-render needed), and a
  // mirror state to drive the death overlay UI.
  const aliveRef = useRef(true);
  const [isDead, setIsDead] = useState(false);
  const [deathInfo, setDeathInfo] = useState<{ level: number; score: number } | null>(null);

  // Seed a few entities on mount so something draws immediately.
  // Pass the actual tankPosRef so spawn placement respects SPAWN_SAFE_RADIUS
  // around the player's randomly-chosen start position.
  useEffect(() => {
    const playerPos = tankPosRef.current;
    let seeds = 0;
    while (seeds < 6) {
      if (entsSpawnRandom(entitiesRef.current as any, nextEntityIdRef as any, playerPos, MAP_WIDTH, MAP_HEIGHT, SPAWN_SAFE_RADIUS, 'square')) {
        seeds++;
      } else break;
    }
    let tris = 0;
    while (tris < 2) {
      if (entsSpawnRandom(entitiesRef.current as any, nextEntityIdRef as any, playerPos, MAP_WIDTH, MAP_HEIGHT, SPAWN_SAFE_RADIUS, 'triangle')) {
        tris++;
      } else break;
    }
    let pents = 0;
    while (pents < PENTAGON_MAX_COUNT) {
      if (entsSpawnRandom(entitiesRef.current as any, nextEntityIdRef as any, playerPos, MAP_WIDTH, MAP_HEIGHT, SPAWN_SAFE_RADIUS, 'pentagon')) {
        pents++;
      } else break;
    }
  }, []);
  function spawnBullet() {
    if (!aliveRef.current) return;
    const tank = tankPosRef.current;
    const derived = computeDerivedStats(playerProgressRef.current.level, playerStatsRef.current);
    const zoom = 1 / Math.max(0.6, derived.fovMultiplier);
    const canvas = canvasRef.current;
    const rect = canvas ? canvas.getBoundingClientRect() : { width: window.innerWidth, height: window.innerHeight };
    const w = rect.width / zoom;
    const h = rect.height / zoom;
    const m = { x: mouseRef.current.x / zoom, y: mouseRef.current.y / zoom };
    const bulletRadius = BULLET_RADIUS * derived.sizeMultiplier;
    tankSpawnBullet(bulletsRef.current as any, bulletIdRef as any, tank, tankVelRef.current, m, w, h, {
      speed: derived.bulletSpeed,
      damage: derived.bulletDamage,
      hp: derived.bulletHpMax,
      lifetime: BULLET_LIFETIME,
      radius: bulletRadius,
    });
  }

  // Resize canvas to full window and account for devicePixelRatio
  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;

    function resize() {
      const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // scale drawing ops to CSS pixels
      gridPatternsRef.current = createGridPatterns();
    }

    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  // Mouse tracking & shooting
  useEffect(() => {
    function onMove(e: MouseEvent) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const p = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      mouseRef.current = p;
    }
    function onDown(e: MouseEvent) {
      if (e.button !== 0) return; // left click only
      mouseDownRef.current = true;
      // Respect global cooldown
      if (cooldownRemainingRef.current <= 0) {
        spawnBullet();
        const derived = computeDerivedStats(playerProgressRef.current.level, playerStatsRef.current);
        cooldownRemainingRef.current = derived.reloadSeconds;
      }
    }
    function onUp(e: MouseEvent) {
      if (e.button !== 0) return;
      mouseDownRef.current = false;
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  // WASD keyboard movement
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const k = e.key.toLowerCase();
      if (k === 'w' || k === 'a' || k === 's' || k === 'd') {
        keysRef.current.add(k);
      }
    }
    function onKeyUp(e: KeyboardEvent) {
      const k = e.key.toLowerCase();
      if (k === 'w' || k === 'a' || k === 's' || k === 'd') {
        keysRef.current.delete(k);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  // Skill point allocation with number keys 1-8
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.repeat) return;
      if (e.key.toLowerCase() === 'm') {
        const current = playerProgressRef.current;
        if (current.level < MAX_LEVEL) {
          const nextLevel = current.level + 1;
          const nextProgress = { level: nextLevel, xp: 0 };
          playerProgressRef.current = nextProgress;
          setPlayerProgress(nextProgress);
        }
        return;
      }
      const idx = Number.parseInt(e.key, 10);
      if (!Number.isFinite(idx) || idx < 1 || idx > STAT_ORDER.length) return;
      const key = STAT_ORDER[idx - 1];
      const current = playerStatsRef.current[key];
      if (current >= MAX_STAT_POINTS) return;
      const maxedCount = Object.values(playerStatsRef.current).filter((value) => value >= MAX_STAT_POINTS).length;
      if (current === MAX_STAT_POINTS - 1 && maxedCount >= 4) return;
      const available = availableSkillPoints(playerProgressRef.current.level, playerStatsRef.current);
      if (available <= 0) return;
      const nextStats = { ...playerStatsRef.current, [key]: current + 1 };
      playerStatsRef.current = nextStats;
      setPlayerStats(nextStats);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Main loop
  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;

    const getCamera = (zoom: number): CameraInfo => {
      const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
      const width = canvas.width / (dpr * zoom);
      const height = canvas.height / (dpr * zoom);
      return {
        x: tankPosRef.current.x - width / 2,
        y: tankPosRef.current.y - height / 2,
        width,
        height,
        devicePixelRatio: dpr,
      };
    };

    function frame(ts: number) {
      const last = lastTsRef.current;
      lastTsRef.current = ts;
      const dt = last ? Math.min((ts - last) / 1000, 0.05) : 0; // clamp to avoid huge jumps
      spawnsThisFrameRef.current = 0;

      const alive = aliveRef.current;
      // movement from WASD (world space) with drift/inertia — gated on alive
      let ix = 0;
      let iy = 0;
      if (alive) {
        const keys = keysRef.current;
        if (keys.has('w')) iy -= 1;
        if (keys.has('s')) iy += 1;
        if (keys.has('a')) ix -= 1;
        if (keys.has('d')) ix += 1;
      }
      const margin = 4 * GRID_SIZE;
      const derived = computeDerivedStats(playerProgressRef.current.level, playerStatsRef.current);
      const sizeMultiplier = derived.sizeMultiplier;
      const tankRadius = TANK_RADIUS * sizeMultiplier;
      const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
      // Ease the death-zoom modifier toward its target (1 alive, 1/1.5 dead).
      // ZOOM_EASE_RATE ≈ 3 closes ~95% of the gap in ~1 s, framerate-independent.
      const ZOOM_EASE_RATE = 3;
      const targetDeathZoom = alive ? 1 : 1 / 1.2;
      const zoomAlpha = 1 - Math.exp(-ZOOM_EASE_RATE * dt);
      deathZoomRef.current +=
        (targetDeathZoom - deathZoomRef.current) * zoomAlpha;
      const zoom = (1 / Math.max(0.6, derived.fovMultiplier)) * deathZoomRef.current;
      ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, 0, 0);
      if (alive) {
        integrateTank(
          dt,
          ix,
          iy,
          tankVelRef.current,
          tankPosRef.current,
          MAP_WIDTH,
          MAP_HEIGHT,
          margin,
          derived.moveSpeed,
        );
      } else {
        // While dead, drag velocity to a halt so camera doesn't keep drifting.
        tankVelRef.current.x *= 0.85;
        tankVelRef.current.y *= 0.85;
      }

      // Tick down global cooldown
      cooldownRemainingRef.current = Math.max(0, cooldownRemainingRef.current - dt);
      // Tick down tank damage flash timer before collision step (so new hits start fresh)
      tankHitTRef.current = Math.max(0, tankHitTRef.current - dt);
      // Continuous fire handling with cooldown (max 1 per 0.6s)
      if (alive && mouseDownRef.current && cooldownRemainingRef.current <= 0) {
        spawnBullet();
        cooldownRemainingRef.current = derived.reloadSeconds;
      }

      const camera = getCamera(zoom);
      drawGrid(ctx, camera, gridPatternsRef.current);
      // Entities update/draw via module
      const KIND_CAPS: Record<'square'|'triangle'|'pentagon', number> = {
        square: SQUARE_MAX_COUNT,
        triangle: TRIANGLE_MAX_COUNT,
        pentagon: PENTAGON_MAX_COUNT,
      };
      const maybeSpawnNear = (x: number, y: number, kind: 'square'|'triangle'|'pentagon') => {
        const count = entitiesRef.current.filter(e => e.kind === kind).length;
        if (count >= KIND_CAPS[kind]) return;
        if (spawnsThisFrameRef.current >= MAX_SPAWNS_PER_FRAME) return;
        if (entsSpawnNear(entitiesRef.current as any, nextEntityIdRef as any, x, y, tankPosRef.current, MAP_WIDTH, MAP_HEIGHT, SPAWN_SAFE_RADIUS, kind)) {
          spawnsThisFrameRef.current++;
        }
      };
      let tookDamage = false;
      const killedByBody = new Set<number>();
      let bodyRemovedSquares = 0;
      let bodyRemovedTriangles = 0;
      let bodyRemovedPentagons = 0;
      const onPlayerCollide = (entity: GameEntity, overlapDt: number) => {
        // Dead tank can't damage or take damage from polygons.
        if (!aliveRef.current) return;
        // Per-tick body-damage exchange (matches diep/arras — no cooldown,
        // damage applies every frame of overlap). deathFactor scales the
        // dying side's reciprocal damage so insta-killing a low-HP polygon
        // only costs you a sliver of HP. The IMPACT_SPEED_BONUS scaling
        // makes full-speed rams resolve in 1-2 ticks, while slow contact
        // accrues damage gradually across many ticks.
        const speed = Math.hypot(tankVelRef.current.x, tankVelRef.current.y);
        const impact = impactMultiplierFromSpeed(speed);

        const proposedToEntity = derived.bodyDamageShape * impact * overlapDt;
        const proposedToTank = (SHAPE_BODY_DAMAGE_TO_TANK[entity.kind] ?? 0) * impact * overlapDt;

        const entityDeathFactor =
          proposedToEntity > 0 && proposedToEntity > entity.hp
            ? entity.hp / proposedToEntity
            : 1;
        const tankDeathFactor =
          proposedToTank > 0 && proposedToTank > tankHpRef.current
            ? tankHpRef.current / proposedToTank
            : 1;

        const actualToEntity = proposedToEntity * tankDeathFactor;
        const actualToTank = proposedToTank * entityDeathFactor;

        tankHpRef.current = Math.max(0, tankHpRef.current - actualToTank);
        tankHitTRef.current = HIT_FLASH_DURATION;
        tookDamage = true;

        entity.hp = Math.max(0, entity.hp - actualToEntity);
        entity.hitT = HIT_FLASH_DURATION;
        if (entity.hp <= 0) {
          killedByBody.add(entity.id);
          entsQueueDeathFx(entity);
          pendingXpRef.current += xpForKill(entity.kind, entity.maxHp);
          pendingScoreRef.current += scoreForKill(entity.kind, entity.maxHp);
          if (entity.kind === "triangle") bodyRemovedTriangles += 1;
          else if (entity.kind === "pentagon") bodyRemovedPentagons += 1;
          else bodyRemovedSquares += 1;
        }
      };
      entsUpdate(
        dt,
        entitiesRef.current as any,
        tankPosRef.current,
        tankVelRef.current,
        MAP_WIDTH,
        MAP_HEIGHT,
        tankRadius,
        maybeSpawnNear,
        onPlayerCollide,
      );
      if (killedByBody.size) {
        entitiesRef.current = entitiesRef.current.filter((entity) => !killedByBody.has(entity.id));
        const replenish = (count: number, kind: 'square'|'triangle'|'pentagon') => {
          while (count > 0 && spawnsThisFrameRef.current < MAX_SPAWNS_PER_FRAME) {
            if (entsSpawnRandom(
              entitiesRef.current as any,
              nextEntityIdRef as any,
              tankPosRef.current,
              MAP_WIDTH,
              MAP_HEIGHT,
              SPAWN_SAFE_RADIUS,
              kind,
            )) {
              spawnsThisFrameRef.current++;
              count -= 1;
            } else {
              break;
            }
          }
        };
        replenish(bodyRemovedSquares, 'square');
        replenish(bodyRemovedTriangles, 'triangle');
        replenish(bodyRemovedPentagons, 'pentagon');
      }
      resolveEntityEntityCollisions(entitiesRef.current as any);
      entsDeathUpdate(dt);
      entsDraw(ctx, camera.width, camera.height, camera.x, camera.y, entitiesRef.current as any);
      entsDeathDraw(ctx, camera.width, camera.height, camera.x, camera.y);

      const bulletResult = updateBullets({
        bullets: bulletsRef.current,
        entities: entitiesRef.current as any,
        dt,
        camera,
        spawnsThisFrame: spawnsThisFrameRef.current,
        maxSpawnsPerFrame: MAX_SPAWNS_PER_FRAME,
        spawnSquare: (list) => entsSpawnRandom(list as any, nextEntityIdRef as any, tankPosRef.current, MAP_WIDTH, MAP_HEIGHT, SPAWN_SAFE_RADIUS, 'square'),
        spawnTriangle: (list) => entsSpawnRandom(list as any, nextEntityIdRef as any, tankPosRef.current, MAP_WIDTH, MAP_HEIGHT, SPAWN_SAFE_RADIUS, 'triangle'),
        spawnPentagon: (list) => entsSpawnRandom(list as any, nextEntityIdRef as any, tankPosRef.current, MAP_WIDTH, MAP_HEIGHT, SPAWN_SAFE_RADIUS, 'pentagon'),
        queueDeathEffect: entsQueueDeathFx,
        onEntityKilled: (entity) => {
          pendingXpRef.current += xpForKill(entity.kind, entity.maxHp);
          pendingScoreRef.current += scoreForKill(entity.kind, entity.maxHp);
        },
      });

      bulletsRef.current = bulletResult.bullets;
      entitiesRef.current = bulletResult.entities as any;
      spawnsThisFrameRef.current = bulletResult.spawnsThisFrame;

      renderBullets(ctx, bulletsRef.current, camera);
      const mouseWorld = { x: mouseRef.current.x / zoom, y: mouseRef.current.y / zoom };
      if (alive) {
        tankDraw(ctx, camera.width, camera.height, mouseWorld, sizeMultiplier);
        if (tookDamage) {
          timeSinceDamageRef.current = 0;
        } else {
          timeSinceDamageRef.current += dt;
          if (timeSinceDamageRef.current > 0) {
            const isHyper = timeSinceDamageRef.current >= REGEN_HYPER_DELAY;
            const hyperBonus = isHyper ? derived.maxHp * REGEN_HYPER_FRACTION : 0;
            const regen = derived.regenPerSecond + hyperBonus;
            tankHpRef.current = Math.min(derived.maxHp, tankHpRef.current + regen * dt);
          }
        }
        tankHpRef.current = Math.min(derived.maxHp, tankHpRef.current);

        // Death trigger — fires once when HP first reaches 0.
        if (tankHpRef.current <= 0) {
          aliveRef.current = false;
          tankHpRef.current = 0;
          // Capture final state for the respawn overlay.
          const finalLevel = playerProgressRef.current.level;
          const finalScore = score + pendingScoreRef.current;
          setDeathInfo({ level: finalLevel, score: finalScore });
          setIsDead(true);
        }

        // Lerp the displayed HP toward the real HP so the bar slides smoothly.
        // alpha = 1 - exp(-rate * dt) gives framerate-independent exponential
        // easing; HP_LERP_RATE ≈ 10 means ~half the gap closes every ~70 ms.
        const HP_LERP_RATE = 10;
        const alpha = 1 - Math.exp(-HP_LERP_RATE * dt);
        tankDisplayHpRef.current +=
          (tankHpRef.current - tankDisplayHpRef.current) * alpha;

        tankDrawHp(ctx, camera.width, camera.height, tankDisplayHpRef.current, derived.maxHp, tankRadius);
        // red tank flash overlay
        tankDrawHit(ctx, camera.width, camera.height, tankHitTRef.current, tankRadius);
      }
      // screen flash removed per request; only tank flash remains
      if (pendingXpRef.current > 0 && playerProgressRef.current.level < MAX_LEVEL) {
        let xp = playerProgressRef.current.xp + pendingXpRef.current;
        let level = playerProgressRef.current.level;
        pendingXpRef.current = 0;
        while (level < MAX_LEVEL) {
          const need = xpForNextLevel(level);
          if (xp < need) break;
          xp -= need;
          level += 1;
        }
        if (level !== playerProgressRef.current.level || xp !== playerProgressRef.current.xp) {
          playerProgressRef.current = { level, xp };
          setPlayerProgress({ level, xp });
        }
      }
      if (pendingScoreRef.current > 0) {
        const gain = pendingScoreRef.current;
        pendingScoreRef.current = 0;
        setScore((prev) => prev + gain);
      }
      requestAnimationFrame(frame);
    }

    const raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const handleRespawn = () => {
    const deathLevel = playerProgressRef.current.level;
    const newLevel = Math.max(1, Math.floor(deathLevel / 2));
    const newStats = { ...INITIAL_STATS };
    // Pick a fresh random spawn position.
    const margin = 4 * GRID_SIZE;
    tankPosRef.current = {
      x: margin + Math.random() * (MAP_WIDTH - 2 * margin),
      y: margin + Math.random() * (MAP_HEIGHT - 2 * margin),
    };
    tankVelRef.current = { x: 0, y: 0 };
    // Reset progression and stats.
    playerProgressRef.current = { level: newLevel, xp: 0 };
    setPlayerProgress({ level: newLevel, xp: 0 });
    playerStatsRef.current = newStats;
    setPlayerStats(newStats);
    // Restore HP to the new level's max.
    const newMaxHp = baseMaxHpForLevel(newLevel);
    tankHpRef.current = newMaxHp;
    tankDisplayHpRef.current = newMaxHp;
    tankHitTRef.current = 0;
    timeSinceDamageRef.current = 0;
    pendingXpRef.current = 0;
    pendingScoreRef.current = 0;
    // Clear bullets so old shots don't linger.
    bulletsRef.current = [];
    // Reset score for the new life.
    setScore(0);
    // Hide overlay and resume play.
    setIsDead(false);
    setDeathInfo(null);
    aliveRef.current = true;
  };

  return (
    <div style={{ position: "fixed", inset: 0, overflow: "hidden" }}>
      <canvas ref={canvasRef} style={{ display: "block" }} />
      <div className="fixed top-3 left-3 text-xs bg-white/80 rounded-md px-2 py-1 shadow">Left click to shoot - Move mouse to aim</div>
      <div id="hud-score-level" data-hud="score-level" className="hud-score-level">
        <div className="hud-pill hud-pill-score">
          <div className="hud-pill-fill score" />
          <span className="hud-dot score" />
          <span className="hud-text">Score: {score}</span>
        </div>
        <div className="hud-pill hud-pill-level">
          <div
            className="hud-pill-fill level"
            style={{ width: `${Math.min(100, (playerProgress.xp / Math.max(1, xpForNextLevel(playerProgress.level))) * 100)}%` }}
          />
          <span className="hud-dot level" />
          <span className="hud-text">Lvl {playerProgress.level} Tank</span>
        </div>
      </div>
      <div
        id="hud-stats"
        data-hud="stats"
        className={`hud-stats${availableSkillPoints(playerProgress.level, playerStats) === 0 ? " hud-stats--idle" : ""}`}
      >
        <div className="hud-stats-wrap">
          <div className="hud-skill-points">
            x{availableSkillPoints(playerProgress.level, playerStats)}
          </div>
          {STAT_ORDER.map((key, idx) => {
            const value = playerStats[key];
            const color = STAT_COLORS[key];
            const maxed = value >= MAX_STAT_POINTS;
            const fillPct = (value / MAX_STAT_POINTS) * 100;
            return (
              <div
                key={key}
                className={`hud-stat-row${maxed ? " maxed" : ""}`}
                style={{
                  ["--stat-color" as string]: color,
                  ["--stat-segments" as string]: MAX_STAT_POINTS,
                }}
              >
                <div className="hud-stat-bar">
                  <div className="hud-stat-track">
                    <div
                      className="hud-stat-fill"
                      style={{ width: `${fillPct}%`, background: color }}
                    />
                    <div className="hud-stat-segments">
                      {Array.from({ length: MAX_STAT_POINTS }, (_, i) => (
                        <div key={i} className="hud-stat-segment" />
                      ))}
                    </div>
                  </div>
                  <span className="hud-stat-label">{STAT_LABELS[key]}</span>
                  <span className="hud-stat-key">[{idx + 1}]</span>
                </div>
                <div className="hud-stat-value">
                  {maxed ? "MAX" : `+${value}`}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {isDead && deathInfo && (
        <div className="death-overlay">
          <div className="death-panel">
            <h1 className="death-title">You Died</h1>
            <div className="death-stats">
              <div className="death-stat-row">
                <span className="death-stat-label">Score</span>
                <span className="death-stat-value">{deathInfo.score}</span>
              </div>
              <div className="death-stat-row">
                <span className="death-stat-label">Level Reached</span>
                <span className="death-stat-value">{deathInfo.level}</span>
              </div>
              <div className="death-stat-row">
                <span className="death-stat-label">Respawn Level</span>
                <span className="death-stat-value">
                  {Math.max(1, Math.floor(deathInfo.level / 2))}
                </span>
              </div>
            </div>
            <button className="death-respawn-btn" onClick={handleRespawn}>
              Respawn
            </button>
          </div>
        </div>
      )}
    </div>
  );
}


