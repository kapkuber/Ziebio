export type StatKey =
  | "maxHealth"
  | "healthRegen"
  | "bodyDamage"
  | "bulletSpeed"
  | "bulletPenetration"
  | "bulletDamage"
  | "reload"
  | "movementSpeed";

export interface StatPoints {
  maxHealth: number;
  healthRegen: number;
  bodyDamage: number;
  bulletSpeed: number;
  bulletPenetration: number;
  bulletDamage: number;
  reload: number;
  movementSpeed: number;
}

export const STAT_ORDER: StatKey[] = [
  "healthRegen",
  "maxHealth",
  "bodyDamage",
  "bulletSpeed",
  "bulletPenetration",
  "bulletDamage",
  "reload",
  "movementSpeed",
];

export const STAT_LABELS: Record<StatKey, string> = {
  healthRegen: "Health Regen",
  maxHealth: "Max Health",
  bodyDamage: "Body Damage",
  bulletSpeed: "Bullet Speed",
  bulletPenetration: "Bullet Penetration",
  bulletDamage: "Bullet Damage",
  reload: "Reload",
  movementSpeed: "Movement Speed",
};

export const MAX_STAT_POINTS = 7;
export const MAX_SKILL_POINTS = 33;
export const MAX_LEVEL = 45;

export const BASE_HP = 50;
export const HP_PER_LEVEL = 2;
export const HP_PER_POINT = 20;

export const SIZE_PER_LEVEL = 0.01;
export const FOV_SCALE = 0.003;

export const REGEN_BASE_FACTOR = 0.03;
export const REGEN_PER_POINT = 0.12;
// Hyper-regen kicks in after ~30s without damage (matches diep.io).
export const REGEN_HYPER_DELAY = 25; // seconds since last damage
// Hyper-regen adds a flat fraction of maxHp/sec on top of normal regen,
// independent of Health Regen points — matches diep.io's behavior where
// even a 0-point tank rapidly heals once hyper-regen triggers.
export const REGEN_HYPER_FRACTION = 0.1; // +10% maxHp/sec while hyper

export const BODY_DAMAGE_BASE = 5;
export const BODY_DAMAGE_MULT_SHAPE = 4;
export const BODY_DAMAGE_MULT_TANK = 6;
export const BODY_DAMAGE_MULT_PROJECTILE = 1;

export const BASE_BULLET_SPEED = 300;
export const BULLET_SPEED_PER_POINT = 0.1;

export const BASE_BULLET_HP = 7;
export const BULLET_PENETRATION_PER_POINT = 0.75;

export const BASE_BULLET_DAMAGE = 7;
export const BULLET_DAMAGE_PER_POINT = 0.42857;
export const BULLET_HIT_BULLET_REDUCTION = 0.25;

export const BASE_RELOAD_TICKS = 15;
export const RELOAD_POINT_FACTOR = 0.914;
export const TICK_DURATION = 0.04;

export const BASE_TANK_SPEED = 280;
export const SPEED_PER_POINT = 0.06;
export const LEVEL_SPEED_SLOWDOWN = 0.004;
export const MIN_LEVEL_SPEED_MULTIPLIER = 0.6;

export const HIGH_SPEED_DAMAGE_PENALTY = 0.08;

// Speed-dependent multiplier on per-tick body-damage exchanges.
//   impact = IMPACT_BASE + (speed / baseSpeed)^IMPACT_SPEED_EXPONENT * IMPACT_SPEED_BONUS
// IMPACT_BASE sets the floor — even at a standstill, contact still deals
// meaningful per-tick damage. IMPACT_SPEED_BONUS is the additional ceiling
// added at full speed. Lower exponents flatten the curve (more linear).
// With these defaults: standstill ~5×, half-speed ~12.5×, full-speed ~35×.
export const IMPACT_BASE = 17;
export const IMPACT_SPEED_BONUS = 30;
export const IMPACT_SPEED_EXPONENT = 2;

export type ShapeKind = "square" | "triangle" | "pentagon";

// Effective body damage dealt to bullets per hit. Tuned so a base bullet (HP =
// BASE_BULLET_HP, no penetration points) dies on a single polygon hit — matching
// diep.io's observed behavior where one base shot kills itself on any polygon.
// Penetration points scale BASE_BULLET_HP up, letting bullets pass through more.
export const SHAPE_BASE_DAMAGE: Record<ShapeKind, number> = {
  square: 7,
  triangle: 7,
  pentagon: 8,
};

// Body damage each polygon deals to the player tank on contact (per second of
// overlap — modulated by collision speed via impactMultiplierFromSpeed).
// Matches diep.io's displayed body damage values for shapes.
export const SHAPE_BODY_DAMAGE_TO_TANK: Record<ShapeKind, number> = {
  square: 8,
  triangle: 8,
  pentagon: 12,
};

export const XP_PER_KILL: Record<ShapeKind, number> = {
  square: 10,
  triangle: 25,
  pentagon: 130,
};

// Cumulative XP required to BE at the given level. Index = level - 1.
// Level 1 starts at 0 XP; level 45 is the cap.
export const TOTAL_XP_AT_LEVEL: readonly number[] = [
  0,      // L1
  4,      // L2
  13,     // L3
  28,     // L4
  50,     // L5
  78,     // L6
  113,    // L7
  157,    // L8
  211,    // L9
  275,    // L10
  350,    // L11
  437,    // L12
  538,    // L13
  655,    // L14
  787,    // L15
  948,    // L16
  1109,   // L17
  1301,   // L18
  1516,   // L19
  1767,   // L20
  2026,   // L21
  2325,   // L22
  2647,   // L23
  3035,   // L24
  3433,   // L25
  3883,   // L26
  4379,   // L27
  4925,   // L28
  5525,   // L29
  6184,   // L30
  6907,   // L31
  7698,   // L32
  8537,   // L33
  9426,   // L34
  10368,  // L35
  11367,  // L36
  12426,  // L37
  13549,  // L38
  14739,  // L39
  16000,  // L40
  17337,  // L41
  18754,  // L42
  20256,  // L43
  21849,  // L44
  23536,  // L45
];

export function clampStatPoints(points: StatPoints): StatPoints {
  return {
    maxHealth: Math.max(0, Math.min(MAX_STAT_POINTS, points.maxHealth)),
    healthRegen: Math.max(0, Math.min(MAX_STAT_POINTS, points.healthRegen)),
    bodyDamage: Math.max(0, Math.min(MAX_STAT_POINTS, points.bodyDamage)),
    bulletSpeed: Math.max(0, Math.min(MAX_STAT_POINTS, points.bulletSpeed)),
    bulletPenetration: Math.max(0, Math.min(MAX_STAT_POINTS, points.bulletPenetration)),
    bulletDamage: Math.max(0, Math.min(MAX_STAT_POINTS, points.bulletDamage)),
    reload: Math.max(0, Math.min(MAX_STAT_POINTS, points.reload)),
    movementSpeed: Math.max(0, Math.min(MAX_STAT_POINTS, points.movementSpeed)),
  };
}

export function sumStatPoints(points: StatPoints): number {
  return Object.values(points).reduce((total, value) => total + value, 0);
}

export function totalSkillPointsForLevel(level: number): number {
  const clampedLevel = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level)));
  const perLevel = Math.max(0, Math.min(27, clampedLevel - 1));
  const level30 = clampedLevel >= 30 ? 1 : 0;
  const threeLevelSteps = Math.max(0, Math.floor((clampedLevel - 33) / 3) + 1);
  const extra = Math.min(5, threeLevelSteps);
  return Math.min(MAX_SKILL_POINTS, perLevel + level30 + extra);
}

export function availableSkillPoints(level: number, points: StatPoints): number {
  return Math.max(0, totalSkillPointsForLevel(level) - sumStatPoints(points));
}

export function baseMaxHpForLevel(level: number): number {
  return BASE_HP + HP_PER_LEVEL * Math.max(0, level - 1);
}

export function xpForNextLevel(level: number): number {
  if (level < 1 || level >= MAX_LEVEL) return Infinity;
  return TOTAL_XP_AT_LEVEL[level] - TOTAL_XP_AT_LEVEL[level - 1];
}

export function totalXpAtLevel(level: number): number {
  const clamped = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level)));
  return TOTAL_XP_AT_LEVEL[clamped - 1];
}

export interface DerivedStats {
  sizeMultiplier: number;
  fovMultiplier: number;
  maxHp: number;
  regenPerSecond: number;
  bodyDamageShape: number;
  bodyDamageTank: number;
  bodyDamageProjectile: number;
  bulletSpeed: number;
  bulletSpeedMultiplier: number;
  bulletDamage: number;
  bulletHpMax: number;
  reloadTicks: number;
  reloadSeconds: number;
  moveSpeed: number;
}

export function computeDerivedStats(level: number, points: StatPoints): DerivedStats {
  const sizeMultiplier = 1 + SIZE_PER_LEVEL * Math.max(0, level - 1);
  const fovMultiplier = 1 + FOV_SCALE * Math.max(0, level - 1);
  const maxHp = baseMaxHpForLevel(level) + points.maxHealth * HP_PER_POINT;
  const regenPerSecond =
    (maxHp / 30) * (REGEN_BASE_FACTOR + REGEN_PER_POINT * points.healthRegen);
  const bodyBase = points.bodyDamage + BODY_DAMAGE_BASE;
  const bulletSpeedMultiplier = 1 + BULLET_SPEED_PER_POINT * points.bulletSpeed;
  const bulletSpeed = BASE_BULLET_SPEED * bulletSpeedMultiplier;
  const bulletDamageBase = BASE_BULLET_DAMAGE * (1 + BULLET_DAMAGE_PER_POINT * points.bulletDamage);
  const speedPenalty = 1 / (1 + Math.max(0, bulletSpeedMultiplier - 1) * HIGH_SPEED_DAMAGE_PENALTY);
  const bulletDamage = bulletDamageBase * speedPenalty;
  const bulletHpMax = BASE_BULLET_HP * (1 + BULLET_PENETRATION_PER_POINT * points.bulletPenetration);
  const reloadTicks = Math.ceil(BASE_RELOAD_TICKS * Math.pow(RELOAD_POINT_FACTOR, points.reload));
  const reloadSeconds = reloadTicks * TICK_DURATION;
  const levelSlowdown = Math.max(
    MIN_LEVEL_SPEED_MULTIPLIER,
    1 - LEVEL_SPEED_SLOWDOWN * Math.max(0, level - 1),
  );
  const moveSpeed = BASE_TANK_SPEED * levelSlowdown * (1 + SPEED_PER_POINT * points.movementSpeed);

  return {
    sizeMultiplier,
    fovMultiplier,
    maxHp,
    regenPerSecond,
    bodyDamageShape: bodyBase * BODY_DAMAGE_MULT_SHAPE,
    bodyDamageTank: bodyBase * BODY_DAMAGE_MULT_TANK,
    bodyDamageProjectile: bodyBase * BODY_DAMAGE_MULT_PROJECTILE,
    bulletSpeed,
    bulletSpeedMultiplier,
    bulletDamage,
    bulletHpMax,
    reloadTicks,
    reloadSeconds,
    moveSpeed,
  };
}

export function computeBulletHitDamage(
  bulletDamage: number,
  bulletHp: number,
  targetBaseDamage: number,
): number {
  if (bulletHp < targetBaseDamage) {
    return bulletDamage * (bulletHp / Math.max(1e-6, targetBaseDamage));
  }
  return bulletDamage;
}

export function impactMultiplierFromSpeed(speed: number): number {
  const ratio = Math.max(0, Math.min(1, speed / BASE_TANK_SPEED));
  return IMPACT_BASE + Math.pow(ratio, IMPACT_SPEED_EXPONENT) * IMPACT_SPEED_BONUS;
}

export function xpForKill(kind: ShapeKind, _maxHp: number): number {
  return XP_PER_KILL[kind] ?? 0;
}

export function scoreForKill(kind: ShapeKind, _maxHp: number): number {
  return XP_PER_KILL[kind] ?? 0;
}
