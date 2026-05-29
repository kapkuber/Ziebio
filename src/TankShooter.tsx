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
  type StatPoints,
} from "./game/stats";
import {
  CORE_SIZE,
  createCore,
  drawCore,
  resolveCoreBulletCollisions,
  resolveCoreEntityCollisions,
  resolvePlayerCoreCollisions,
  snapCoreCenter,
  validateCorePlacement,
  type Core,
} from "./game/core";
import {
  WALL_SIZE,
  WALL_GRID_CELLS,
  WALL_FLUX_COST,
  FLUX_GEN_SIZE,
  FLUX_GEN_GRID_CELLS,
  FLUX_GEN_MAX_COUNT,
  TURRET_SIZE,
  TURRET_GRID_CELLS,
  TURRET_FLUX_COST,
  TURRET_MAX_COUNT,
  createWall,
  createFluxGenerator,
  createTurret,
  drawBuilding,
  drawBuildableZone,
  fluxProducedThisFrame,
  resolveBuildingBulletCollisions,
  resolveBuildingEntityCollisions,
  resolvePlayerBuildingCollisions,
  snapBuildingCenter,
  updateTurrets,
  validateBuildingPlacement,
  type Building,
  type TurretTarget,
} from "./game/buildings";
import { LOCAL_PLAYER_TEAM } from "./game/teams";
import {
  createEnemy,
  drawEnemy,
  resolveBulletPlayerCollisions,
  resolveEnemyBulletCollisions,
  resolvePlayerEnemyCollisions,
  updateEnemies,
  type Enemy,
  type EnemyKind,
} from "./game/enemies";
import { Hud } from "./components/Hud";
import { EndOverlay } from "./components/EndOverlay";
import { usePlacementController } from "./hooks/usePlacementController";

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
  // Auto-fire toggle (default off). 'e' flips it; the frame loop fires every
  // reload tick while this is on, same gate the held-mouse path uses. Mirror
  // state drives the hint so the player can see whether it's armed.
  const autoFireRef = useRef<boolean>(false);
  const [autoFire, setAutoFire] = useState(false);
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

  // Cores owned by the local player. The frame loop reads coresRef; React
  // state mirrors its length so the HUD/overlay can react to placements.
  const coresRef = useRef<Core[]>([]);
  const nextCoreIdRef = useRef<number>(1);
  // Each player gets exactly one core for the run. hasPlacedCoreRef both
  // gates further placement attempts and arms the game-over condition (only
  // fires once a core has actually been placed, so the pre-placement free-
  // play loop is not interrupted). Mirror state drives the placement hint.
  const hasPlacedCoreRef = useRef<boolean>(false);
  const [hasPlacedCore, setHasPlacedCore] = useState(false);
  // Per-mode preview refs — each frame the active mode's tick (registered
  // with usePlacementController below) computes the snapped position and
  // whether the spot is legal; the onClick callback reads its ref to decide
  // whether to actually place. The mode toggle / active state itself is
  // owned by the controller, not by these refs.
  const previewCoreRef = useRef<{ center: Vec2; valid: boolean } | null>(null);
  const previewWallRef = useRef<{ center: Vec2; valid: boolean } | null>(null);
  const previewFluxGenRef = useRef<{ center: Vec2; valid: boolean } | null>(null);
  const previewTurretRef = useRef<{ center: Vec2; valid: boolean } | null>(null);
  // Buildings (walls + flux generators today; turrets/spawners later).
  const buildingsRef = useRef<Building[]>([]);
  const nextBuildingIdRef = useRef<number>(1);
  // Flux currency. Generators add fractional flux every frame; the integer
  // floor is mirrored to React state for the HUD pill (React skips re-renders
  // when the value is identical, so this is effectively rate-limited to whole-
  // flux changes — ~16/sec at the 8-generator cap).
  const fluxRef = useRef<number>(0);
  const [flux, setFlux] = useState<number>(0);
  // Dev-only: 'k' tags this each press; the frame loop consumes the flag
  // and damages whatever building/core sits under the cursor (10% of its
  // max HP). Lets us exercise the damage / game-over flows without having
  // to lure polygons onto every test target.
  const pendingDevDamageRef = useRef<boolean>(false);
  // Dev-only: per-kind hotkeys ('p' = swarm, 'o' = gunner) tag this with
  // the kind to spawn next frame; the frame loop reads + clears it and
  // drops one enemy at the cursor's world position. Lives here until the
  // real wave system lands so each kind's AI / damage / rendering path can
  // be exercised one enemy at a time.
  const pendingEnemySpawnRef = useRef<EnemyKind | null>(null);
  const enemiesRef = useRef<Enemy[]>([]);
  const nextEnemyIdRef = useRef<number>(1);
  // Game-over (core destroyed) state. Ref drives the loop, state drives JSX.
  const coreDestroyedRef = useRef<boolean>(false);
  const [coreDestroyed, setCoreDestroyed] = useState(false);
  const [coreDestroyedInfo, setCoreDestroyedInfo] = useState<{
    level: number;
    score: number;
    timeSeconds: number;
  } | null>(null);

  const [playerStats, setPlayerStats] = useState<StatPoints>({ ...INITIAL_STATS });
  const [playerProgress, setPlayerProgress] = useState({ level: 1, xp: 0 });
  const [score, setScore] = useState(0);
  // Alive flag is a ref for the frame loop (no re-render needed), and a
  // mirror state to drive the death overlay UI.
  const aliveRef = useRef(true);
  const [isDead, setIsDead] = useState(false);
  const [deathInfo, setDeathInfo] = useState<{
    killerName: string;
    level: number;
    score: number;
    timeSeconds: number;
  } | null>(null);
  // Most recent damage source — set whenever a collision deals damage, used
  // to attribute the kill on the death screen.
  const lastDamageSourceRef = useRef<string>("Unnamed Tank");
  // Real time (ms) when the current life started, for the death-screen Time stat.
  const lifeStartMsRef = useRef<number>(Date.now());

  // === Placement modes ===
  // The controller owns "which mode is active" + keyboard/click dispatch +
  // mutual exclusion + game-over auto-exit. Each mode below supplies:
  //   - key:        keyboard letter that toggles it
  //   - canEnter:   gate that blocks entry (e.g., must have placed a core)
  //   - sticky:     stay in mode after a successful drop (true = walls/flux,
  //                 false = core which is one-shot per run)
  //   - tick:       render the preview ghost + write the preview ref
  //   - onClick:    perform the placement, return true if it happened
  //   - onExit:     clean up the preview ref when the mode leaves
  // Adding a new placement mode is one config entry — no new refs, no new
  // key handler branches, no new mouse handler branches, no game-over cleanup.
  const placement = usePlacementController(
    {
      core: {
        key: 'c',
        canEnter: () => !hasPlacedCoreRef.current,
        sticky: false,
        tick: (ctx, camera, mouseWorld) => {
          const snapped = snapCoreCenter(mouseWorld.x, mouseWorld.y);
          const v = validateCorePlacement(
            snapped, coresRef.current, entitiesRef.current as any, MAP_WIDTH, MAP_HEIGHT,
          );
          previewCoreRef.current = { center: snapped, valid: v.valid };
          drawCore(
            ctx,
            { pos: snapped, size: CORE_SIZE, teamId: LOCAL_PLAYER_TEAM },
            camera,
            { alpha: 0.45, invalid: !v.valid },
          );
        },
        onClick: () => {
          const p = previewCoreRef.current;
          if (!p || !p.valid || hasPlacedCoreRef.current) return false;
          coresRef.current = [
            ...coresRef.current,
            createCore(nextCoreIdRef.current++, p.center),
          ];
          hasPlacedCoreRef.current = true;
          setHasPlacedCore(true);
          return true;
        },
        onExit: () => { previewCoreRef.current = null; },
      },
      wall: {
        key: 'v',
        canEnter: () => hasPlacedCoreRef.current,
        sticky: true,
        tick: (ctx, camera, mouseWorld) => {
          const snapped = snapBuildingCenter(mouseWorld.x, mouseWorld.y, WALL_GRID_CELLS);
          const v = validateBuildingPlacement(
            snapped, WALL_SIZE, coresRef.current, buildingsRef.current,
            entitiesRef.current as any, LOCAL_PLAYER_TEAM,
          );
          const canAfford = fluxRef.current >= WALL_FLUX_COST;
          const valid = v.valid && canAfford;
          previewWallRef.current = { center: snapped, valid };
          drawBuilding(
            ctx,
            { pos: snapped, size: WALL_SIZE, teamId: LOCAL_PLAYER_TEAM, kind: 'wall' },
            camera,
            { alpha: 0.5, invalid: !valid },
          );
        },
        onClick: () => {
          const p = previewWallRef.current;
          if (!p || !p.valid || fluxRef.current < WALL_FLUX_COST) return false;
          fluxRef.current -= WALL_FLUX_COST;
          buildingsRef.current = [
            ...buildingsRef.current,
            createWall(nextBuildingIdRef.current++, p.center),
          ];
          return true;
        },
        onExit: () => { previewWallRef.current = null; },
      },
      fluxgen: {
        key: 'x',
        canEnter: () => hasPlacedCoreRef.current,
        sticky: true,
        tick: (ctx, camera, mouseWorld) => {
          const snapped = snapBuildingCenter(mouseWorld.x, mouseWorld.y, FLUX_GEN_GRID_CELLS);
          const v = validateBuildingPlacement(
            snapped, FLUX_GEN_SIZE, coresRef.current, buildingsRef.current,
            entitiesRef.current as any, LOCAL_PLAYER_TEAM,
            { kind: 'flux-generator', max: FLUX_GEN_MAX_COUNT },
          );
          previewFluxGenRef.current = { center: snapped, valid: v.valid };
          drawBuilding(
            ctx,
            { pos: snapped, size: FLUX_GEN_SIZE, teamId: LOCAL_PLAYER_TEAM, kind: 'flux-generator' },
            camera,
            { alpha: 0.5, invalid: !v.valid },
          );
        },
        onClick: () => {
          const p = previewFluxGenRef.current;
          if (!p || !p.valid) return false;
          buildingsRef.current = [
            ...buildingsRef.current,
            createFluxGenerator(nextBuildingIdRef.current++, p.center),
          ];
          return true;
        },
        onExit: () => { previewFluxGenRef.current = null; },
      },
      turret: {
        key: 'b',
        canEnter: () => hasPlacedCoreRef.current,
        sticky: true,
        tick: (ctx, camera, mouseWorld) => {
          const snapped = snapBuildingCenter(mouseWorld.x, mouseWorld.y, TURRET_GRID_CELLS);
          const v = validateBuildingPlacement(
            snapped, TURRET_SIZE, coresRef.current, buildingsRef.current,
            entitiesRef.current as any, LOCAL_PLAYER_TEAM,
            { kind: 'turret', max: TURRET_MAX_COUNT },
          );
          const canAfford = fluxRef.current >= TURRET_FLUX_COST;
          const valid = v.valid && canAfford;
          previewTurretRef.current = { center: snapped, valid };
          drawBuilding(
            ctx,
            { pos: snapped, size: TURRET_SIZE, teamId: LOCAL_PLAYER_TEAM, kind: 'turret' },
            camera,
            { alpha: 0.5, invalid: !valid },
          );
        },
        onClick: () => {
          const p = previewTurretRef.current;
          if (!p || !p.valid || fluxRef.current < TURRET_FLUX_COST) return false;
          fluxRef.current -= TURRET_FLUX_COST;
          buildingsRef.current = [
            ...buildingsRef.current,
            createTurret(nextBuildingIdRef.current++, p.center),
          ];
          return true;
        },
        onExit: () => { previewTurretRef.current = null; },
      },
    },
    () => aliveRef.current && !coreDestroyedRef.current,
  );

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
    tankSpawnBullet(
      bulletsRef.current as any,
      bulletIdRef as any,
      tank,
      tankVelRef.current,
      m,
      w,
      h,
      LOCAL_PLAYER_TEAM,
      {
        speed: derived.bulletSpeed,
        damage: derived.bulletDamage,
        hp: derived.bulletHpMax,
        lifetime: BULLET_LIFETIME,
        radius: bulletRadius,
      },
    );
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
      // Placement mode hijacks left-click: the controller routes to the
      // active mode's onClick. Returns true if a mode consumed the click
      // (even if placement failed) so we don't fall through to shooting or
      // arm mouseDownRef — releasing the mode key mid-hold would auto-fire.
      if (placement.handleClick()) return;
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
      const k = e.key.toLowerCase();
      // Placement-mode toggles (c/v/x) are routed through the controller.
      // It handles mutual exclusion, canEnter gates, sticky/non-sticky exits,
      // and game-over auto-disable. Returns true if `k` matched a registered
      // mode (so we short-circuit the rest of the key handler).
      if (placement.toggleByKey(k)) return;
      if (k === 'k') {
        // Dev: damage the structure under the cursor next frame.
        if (!aliveRef.current || coreDestroyedRef.current) return;
        pendingDevDamageRef.current = true;
        return;
      }
      if (k === 'p') {
        // Dev: spawn a single swarm enemy at the cursor next frame.
        if (!aliveRef.current || coreDestroyedRef.current) return;
        pendingEnemySpawnRef.current = 'swarm';
        return;
      }
      if (k === 'o') {
        // Dev: spawn a single gunner enemy at the cursor next frame.
        if (!aliveRef.current || coreDestroyedRef.current) return;
        pendingEnemySpawnRef.current = 'gunner';
        return;
      }
      if (k === 'i') {
        // Dev: spawn a single sniper enemy at the cursor next frame.
        if (!aliveRef.current || coreDestroyedRef.current) return;
        pendingEnemySpawnRef.current = 'sniper';
        return;
      }
      if (k === 'e') {
        // Auto-fire toggle. Held-mouse fire still works in parallel; either
        // signal triggers the per-reload shot in the frame loop.
        autoFireRef.current = !autoFireRef.current;
        setAutoFire(autoFireRef.current);
        return;
      }
      if (k === 'm') {
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
      // Continuous fire handling with cooldown. Either holding LMB or having
      // auto-fire toggled on triggers a shot every reload tick. Auto-fire is
      // suppressed while a placement mode is open so the tank doesn't keep
      // shooting at the cursor while the player is dropping walls/turrets.
      const autoFireArmed =
        autoFireRef.current && placement.active() === null;
      if (
        alive &&
        (mouseDownRef.current || autoFireArmed) &&
        cooldownRemainingRef.current <= 0
      ) {
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
        // Attribute any future kill to this entity (capitalize the kind).
        lastDamageSourceRef.current =
          entity.kind.charAt(0).toUpperCase() + entity.kind.slice(1);
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
      // Polygon-core contact: push entities out of any live core and apply
      // reciprocal body damage. Runs before entity-entity resolution so an
      // entity pushed out of a core can then settle against neighbours.
      // Note: core kills grant score only, not XP — the player gets credit
      // for defenses they built, but XP comes from kills the player makes.
      if (coresRef.current.length > 0) {
        const deadCoreIds = resolveCoreEntityCollisions(
          coresRef.current,
          entitiesRef.current as any,
          dt,
          (e) => {
            entsQueueDeathFx(e);
            pendingScoreRef.current += scoreForKill(e.kind, e.maxHp);
          },
        );
        if (deadCoreIds.length > 0) {
          const dead = new Set(deadCoreIds);
          coresRef.current = coresRef.current.filter((c) => !dead.has(c.id));
          // Game-over fires only once all of the player's placed cores are
          // gone — supports the future "multiple cores per player" case.
          if (
            !coreDestroyedRef.current &&
            hasPlacedCoreRef.current &&
            coresRef.current.length === 0
          ) {
            coreDestroyedRef.current = true;
            aliveRef.current = false;
            const finalLevel = playerProgressRef.current.level;
            const finalScore = score + pendingScoreRef.current;
            const timeSeconds = Math.max(
              0,
              Math.floor((Date.now() - lifeStartMsRef.current) / 1000),
            );
            setCoreDestroyedInfo({ level: finalLevel, score: finalScore, timeSeconds });
            setCoreDestroyed(true);
            // Exit any placement mode (controller fires each mode's onExit
            // so preview refs are cleared).
            placement.exitAll();
          }
        }
      }
      // Polygon-building contact: same continuous-contact model as cores.
      // Buildings that die this tick are filtered out below; score-only
      // (no XP) to match the "kills you didn't actually make" rule.
      if (buildingsRef.current.length > 0) {
        const deadBuildingIds = resolveBuildingEntityCollisions(
          buildingsRef.current,
          entitiesRef.current as any,
          dt,
          (e) => {
            entsQueueDeathFx(e);
            pendingScoreRef.current += scoreForKill(e.kind, e.maxHp);
          },
        );
        if (deadBuildingIds.length > 0) {
          const dead = new Set(deadBuildingIds);
          buildingsRef.current = buildingsRef.current.filter((b) => !dead.has(b.id));
        }
      }
      // Flux production. Sums every live friendly generator's per-frame yield
      // (FLUX_GEN_RATE_PER_SECOND * dt) and accumulates into the float ref;
      // the integer floor is mirrored to React state below for the HUD pill.
      // Gated on alive / not-game-over so a destroyed core stops income even
      // before its surviving generators fall.
      if (aliveRef.current && !coreDestroyedRef.current && buildingsRef.current.length > 0) {
        fluxRef.current += fluxProducedThisFrame(buildingsRef.current, LOCAL_PLAYER_TEAM, dt);
      }
      // Wave enemies. Pathing + firing + building gap + core-contact damage
      // live inside each kind's update fn (see ./game/enemies). Player-vs-
      // enemy and bullet-vs-enemy are separate passes below so they fit into
      // the existing damage / death pipeline.
      if (enemiesRef.current.length > 0) {
        updateEnemies(enemiesRef.current, {
          cores: coresRef.current,
          buildings: buildingsRef.current,
          bullets: bulletsRef.current,
          bulletIdRef,
          playerPos: aliveRef.current ? tankPosRef.current : null,
          playerTeamId: LOCAL_PLAYER_TEAM,
          dt,
        });
        // Game-over check — an enemy can finish off a core just like a
        // polygon. Mirrors the polygon-vs-core game-over trigger.
        if (
          !coreDestroyedRef.current &&
          hasPlacedCoreRef.current &&
          coresRef.current.some((c) => c.hp <= 0)
        ) {
          coresRef.current = coresRef.current.filter((c) => c.hp > 0);
          if (coresRef.current.length === 0) {
            coreDestroyedRef.current = true;
            aliveRef.current = false;
            const finalLevel = playerProgressRef.current.level;
            const finalScore = score + pendingScoreRef.current;
            const timeSeconds = Math.max(
              0,
              Math.floor((Date.now() - lifeStartMsRef.current) / 1000),
            );
            setCoreDestroyedInfo({ level: finalLevel, score: finalScore, timeSeconds });
            setCoreDestroyed(true);
            placement.exitAll();
          }
        }
      }
      // Player-vs-enemy contact: reciprocal continuous body damage + push.
      // Mirrors the polygon-vs-tank pipeline so HP, hit flash, and kill
      // attribution all match. Kill attribution uses the enemy kind name.
      if (enemiesRef.current.length > 0 && aliveRef.current) {
        const speed = Math.hypot(tankVelRef.current.x, tankVelRef.current.y);
        const impact = impactMultiplierFromSpeed(speed);
        const hits = resolvePlayerEnemyCollisions(
          enemiesRef.current,
          tankPosRef.current,
          tankVelRef.current,
          LOCAL_PLAYER_TEAM,
          tankRadius,
          derived.bodyDamageTank,
          impact,
          tankHpRef.current,
          dt,
        );
        for (const hit of hits) {
          if (hit.tankDamage > 0) {
            tankHpRef.current = Math.max(0, tankHpRef.current - hit.tankDamage);
            tankHitTRef.current = HIT_FLASH_DURATION;
            tookDamage = true;
            lastDamageSourceRef.current =
              hit.enemy.kind.charAt(0).toUpperCase() + hit.enemy.kind.slice(1);
          }
        }
      }
      // Turret aim + fire. Target list is hostile tanks + wave enemies —
      // polygons are world resources, not threats, so they're intentionally
      // absent.
      if (buildingsRef.current.length > 0) {
        const turretTargets: TurretTarget[] = [];
        for (const e of enemiesRef.current) {
          if (e.hp <= 0) continue;
          turretTargets.push({ pos: e.pos, teamId: e.teamId });
        }
        updateTurrets(
          buildingsRef.current,
          bulletsRef.current,
          bulletIdRef,
          dt,
          turretTargets,
        );
      }
      // Dev spawn: 'p' = swarm, 'o' = gunner. The wave system will eventually
      // take over enemy spawning; these hotkeys live here so each kind's AI /
      // damage / rendering path can be exercised one enemy at a time without
      // the wave scaffolding. Adding a new kind is a one-line key handler +
      // adding the kind to EnemyKind / ENEMY_DEFS — this dispatch is
      // kind-agnostic.
      if (pendingEnemySpawnRef.current && aliveRef.current && !coreDestroyedRef.current) {
        const kind = pendingEnemySpawnRef.current;
        pendingEnemySpawnRef.current = null;
        const mwx = camera.x + mouseRef.current.x / zoom;
        const mwy = camera.y + mouseRef.current.y / zoom;
        enemiesRef.current = [
          ...enemiesRef.current,
          createEnemy(nextEnemyIdRef.current++, kind, { x: mwx, y: mwy }),
        ];
      }
      // Dev: 'k' damages whatever structure sits under the cursor by 10% of
      // its max HP. Buildings first (they sit visually on top of cores);
      // falls through to the core if no building was hit. Mirrors the
      // game-over trigger so a dev-killed last core still ends the run.
      if (pendingDevDamageRef.current && aliveRef.current && !coreDestroyedRef.current) {
        pendingDevDamageRef.current = false;
        const mwx = camera.x + mouseRef.current.x / zoom;
        const mwy = camera.y + mouseRef.current.y / zoom;
        const containsPoint = (pos: Vec2, size: number) => {
          const h = size / 2;
          return mwx >= pos.x - h && mwx <= pos.x + h && mwy >= pos.y - h && mwy <= pos.y + h;
        };
        let hit: 'building' | 'core' | null = null;
        for (const b of buildingsRef.current) {
          if (containsPoint(b.pos, b.size)) {
            b.hp = Math.max(0, b.hp - b.maxHp * 0.1);
            hit = 'building';
            break;
          }
        }
        if (!hit) {
          for (const c of coresRef.current) {
            if (containsPoint(c.pos, c.size)) {
              c.hp = Math.max(0, c.hp - c.maxHp * 0.1);
              hit = 'core';
              break;
            }
          }
        }
        if (hit === 'building') {
          buildingsRef.current = buildingsRef.current.filter((b) => b.hp > 0);
        } else if (hit === 'core') {
          const before = coresRef.current.length;
          coresRef.current = coresRef.current.filter((c) => c.hp > 0);
          if (
            coresRef.current.length < before &&
            !coreDestroyedRef.current &&
            hasPlacedCoreRef.current &&
            coresRef.current.length === 0
          ) {
            coreDestroyedRef.current = true;
            aliveRef.current = false;
            const finalLevel = playerProgressRef.current.level;
            const finalScore = score + pendingScoreRef.current;
            const timeSeconds = Math.max(
              0,
              Math.floor((Date.now() - lifeStartMsRef.current) / 1000),
            );
            setCoreDestroyedInfo({ level: finalLevel, score: finalScore, timeSeconds });
            setCoreDestroyed(true);
            placement.exitAll();
          }
        }
      }
      // Player-core contact: push the tank out of any core it overlaps. No
      // damage — friendly cores are solid walls, not threats.
      if (coresRef.current.length > 0 && aliveRef.current) {
        resolvePlayerCoreCollisions(
          coresRef.current,
          tankPosRef.current,
          tankVelRef.current,
          tankRadius,
        );
      }
      // Player-building contact: walls block movement but deal no damage.
      if (buildingsRef.current.length > 0 && aliveRef.current) {
        resolvePlayerBuildingCollisions(
          buildingsRef.current,
          tankPosRef.current,
          tankVelRef.current,
          tankRadius,
        );
      }
      resolveEntityEntityCollisions(entitiesRef.current as any);
      entsDeathUpdate(dt);
      entsDraw(ctx, camera.width, camera.height, camera.x, camera.y, entitiesRef.current as any);
      entsDeathDraw(ctx, camera.width, camera.height, camera.x, camera.y);

      // Buildable-zone outline: shown only while a building placement mode is
      // open, so the player can see where they can drop. Any non-core
      // placement mode needs the outline (every building lives inside the
      // zone); core itself never needs it — you can't enter core mode once
      // a core is placed, and without a core there's no zone to outline.
      // Using `!== 'core'` instead of listing each building mode means new
      // placement modes pick this up automatically.
      const activeMode = placement.active();
      if (activeMode !== null && activeMode !== 'core'
          && aliveRef.current && !coreDestroyedRef.current) {
        for (const c of coresRef.current) {
          drawBuildableZone(ctx, c, camera);
        }
      }
      // Draw all placed cores (under bullets/tank so projectiles read on top).
      for (const c of coresRef.current) {
        drawCore(ctx, c, camera, { showHp: true, hpRatio: c.hp / c.maxHp });
      }
      // Draw all buildings.
      for (const b of buildingsRef.current) {
        drawBuilding(ctx, b, camera, { showHp: true, hpRatio: b.hp / b.maxHp });
      }
      // Draw enemies after buildings so they read on top of the chassis but
      // below bullets/the player tank (which render later in the frame).
      for (const e of enemiesRef.current) {
        drawEnemy(ctx, e, camera);
      }
      // Per-mode preview rendering. The controller dispatches to the active
      // mode's tick, which computes its snapped position, validates, writes
      // its preview ref, and draws the ghost. Modes not active render nothing.
      const cursorWorld = { x: camera.x + mouseRef.current.x / zoom, y: camera.y + mouseRef.current.y / zoom };
      placement.tickActive(ctx, camera, cursorWorld);

      const bulletResult = updateBullets({
        bullets: bulletsRef.current,
        entities: entitiesRef.current as any,
        dt,
        camera,
        spawnsThisFrame: spawnsThisFrameRef.current,
        maxSpawnsPerFrame: MAX_SPAWNS_PER_FRAME,
        playerTeamId: LOCAL_PLAYER_TEAM,
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

      // Bullet-vs-structure passes run BEFORE bullet-vs-enemy / bullet-vs-
      // player so a bullet that hits a wall dies on the wall instead of
      // punching through to whatever's behind it. Each pass team-filters via
      // teamId (no friendly fire).
      if (buildingsRef.current.length > 0 && bulletsRef.current.length > 0) {
        const deadBuildingIds = resolveBuildingBulletCollisions(
          buildingsRef.current,
          bulletsRef.current,
        );
        if (deadBuildingIds.length > 0) {
          const dead = new Set(deadBuildingIds);
          buildingsRef.current = buildingsRef.current.filter((b) => !dead.has(b.id));
        }
      }
      if (coresRef.current.length > 0 && bulletsRef.current.length > 0) {
        const deadCoreIds = resolveCoreBulletCollisions(
          coresRef.current,
          bulletsRef.current,
        );
        if (deadCoreIds.length > 0) {
          const dead = new Set(deadCoreIds);
          coresRef.current = coresRef.current.filter((c) => !dead.has(c.id));
          // Same game-over trigger the polygon / enemy paths use — fires once
          // when the last placed core falls.
          if (
            !coreDestroyedRef.current &&
            hasPlacedCoreRef.current &&
            coresRef.current.length === 0
          ) {
            coreDestroyedRef.current = true;
            aliveRef.current = false;
            const finalLevel = playerProgressRef.current.level;
            const finalScore = score + pendingScoreRef.current;
            const timeSeconds = Math.max(
              0,
              Math.floor((Date.now() - lifeStartMsRef.current) / 1000),
            );
            setCoreDestroyedInfo({ level: finalLevel, score: finalScore, timeSeconds });
            setCoreDestroyed(true);
            placement.exitAll();
          }
        }
      }

      // Bullet-vs-enemy runs AFTER the bullet/entity pipeline so a bullet
      // that already died on a polygon this frame can't also hit an enemy.
      // Dead enemies are filtered next.
      if (enemiesRef.current.length > 0 && bulletsRef.current.length > 0) {
        resolveEnemyBulletCollisions(enemiesRef.current, bulletsRef.current, dt);
      }
      if (enemiesRef.current.some((e) => e.hp <= 0)) {
        enemiesRef.current = enemiesRef.current.filter((e) => e.hp > 0);
      }

      // Hostile bullets damaging the player. Any bullet whose teamId differs
      // from the local player's hits the tank on overlap and dies. Sources
      // include wave enemies today (and any future hostile turret fed by the
      // same bullet list).
      if (bulletsRef.current.length > 0 && aliveRef.current) {
        const hits = resolveBulletPlayerCollisions(
          bulletsRef.current,
          tankPosRef.current,
          LOCAL_PLAYER_TEAM,
          tankRadius,
        );
        if (hits.length > 0) {
          // Bullets are marked life=0 inside resolve; cull them now so they
          // don't render or carry into the next frame.
          bulletsRef.current = bulletsRef.current.filter((b) => b.life > 0);
          for (const hit of hits) {
            tankHpRef.current = Math.max(0, tankHpRef.current - hit.damage);
            tankHitTRef.current = HIT_FLASH_DURATION;
            tookDamage = true;
            lastDamageSourceRef.current = 'Swarm Bullet';
          }
        }
      }

      renderBullets(ctx, bulletsRef.current, camera);
      const mouseWorld = { x: mouseRef.current.x / zoom, y: mouseRef.current.y / zoom };
      if (alive) {
        tankDraw(ctx, camera.width, camera.height, mouseWorld, LOCAL_PLAYER_TEAM, sizeMultiplier);
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
          const timeSeconds = Math.max(
            0,
            Math.floor((Date.now() - lifeStartMsRef.current) / 1000),
          );
          setDeathInfo({
            killerName: lastDamageSourceRef.current,
            level: finalLevel,
            score: finalScore,
            timeSeconds,
          });
          setIsDead(true);
        }

        // Lerp the displayed HP toward the real HP so the bar slides smoothly.
        // alpha = 1 - exp(-rate * dt) gives framerate-independent exponential
        // easing; HP_LERP_RATE ≈ 10 means ~half the gap closes every ~70 ms.
        const HP_LERP_RATE = 10;
        const alpha = 1 - Math.exp(-HP_LERP_RATE * dt);
        tankDisplayHpRef.current +=
          (tankHpRef.current - tankDisplayHpRef.current) * alpha;
        // Exponential easing never quite reaches the target — snap to max once
        // we're close so the bar can hide cleanly the moment real HP fills.
        if (tankHpRef.current >= derived.maxHp && tankDisplayHpRef.current > derived.maxHp - 0.5) {
          tankDisplayHpRef.current = derived.maxHp;
        }

        // Hide the bar at full HP — matches the entity/building pattern. The
        // gate uses real HP (not the lagged display value) so future regen
        // mechanics work the same way: bar shows the moment damage is taken,
        // hides the moment real HP refills.
        if (tankHpRef.current < derived.maxHp) {
          tankDrawHp(ctx, camera.width, camera.height, tankDisplayHpRef.current, derived.maxHp, tankRadius);
        }
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
      // Mirror integer flux to state. setFlux with the same value is a React
      // no-op, so this only triggers a HUD re-render at whole-flux boundaries
      // (~16/sec at the 8-gen cap).
      setFlux(Math.floor(fluxRef.current));
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
    // Reset run-tracking refs for the new life.
    lastDamageSourceRef.current = "Unnamed Tank";
    lifeStartMsRef.current = Date.now();
    // Hide overlay and resume play.
    setIsDead(false);
    setDeathInfo(null);
    aliveRef.current = true;
  };

  // Hint text is the one HUD bit that depends on placement state — derived
  // from the controller's active-mode state (which re-renders on transition).
  const activeMode = placement.activeMode;
  const hint = activeMode === 'core'
    ? "Left click to place core — press [C] to cancel"
    : activeMode === 'wall'
      ? `Left click to place wall (${WALL_FLUX_COST} flux) — press [V] to exit`
      : activeMode === 'fluxgen'
        ? "Left click to place flux generator — press [X] to exit"
        : activeMode === 'turret'
          ? `Left click to place turret (${TURRET_FLUX_COST} flux) — press [T] to exit`
          : hasPlacedCore
            ? `Left click to shoot · WASD to move · [E] auto-fire: ${autoFire ? 'ON' : 'OFF'} · [V] walls · [X] flux generators · [T] turrets`
            : `Left click to shoot · WASD to move · [E] auto-fire: ${autoFire ? 'ON' : 'OFF'} · [C] to place core`;

  return (
    <div style={{ position: "fixed", inset: 0, overflow: "hidden" }}>
      <canvas ref={canvasRef} style={{ display: "block" }} />
      <Hud
        hint={hint}
        score={score}
        flux={flux}
        level={playerProgress.level}
        xp={playerProgress.xp}
        stats={playerStats}
      />
      {isDead && deathInfo && !coreDestroyed && (
        <EndOverlay
          title="You were killed by"
          subtitle={deathInfo.killerName}
          score={deathInfo.score}
          level={deathInfo.level}
          timeSeconds={deathInfo.timeSeconds}
          buttonLabel="Respawn"
          onButtonClick={handleRespawn}
        />
      )}
      {coreDestroyed && coreDestroyedInfo && (
        <EndOverlay
          title="Game Over"
          subtitle="Core Destroyed"
          score={coreDestroyedInfo.score}
          level={coreDestroyedInfo.level}
          timeSeconds={coreDestroyedInfo.timeSeconds}
          buttonLabel="Restart"
          onButtonClick={() => window.location.reload()}
        />
      )}
    </div>
  );
}


