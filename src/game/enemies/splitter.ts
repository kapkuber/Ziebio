// Splitter enemy. Boss-tier twin-barrel tank that fractures into 4 swarm
// children on death. Large chassis (2.5× tank radius), heavy HP, but bullets
// are exactly a fresh lvl-1 player tank shot — the threat is durability
// plus the secondary swarm wave it leaves behind, not bullet power.
//
// Sized / statted relative to a fresh lvl-1 player tank:
//   - 1.8× larger body
//   - 8× max HP
//   - 2× higher body damage to tanks
//   - bullet damage / HP / speed / reload all = base values (twin barrels
//     fire simultaneously, so DPS effectively doubles relative to a single-
//     barrel base shooter)
//
// Visual layout matches the SVG mock the user provided. The mock is drawn
// pointing UP (svg -y = forward); decorative constants below remap to the
// canvas frame where +x = aim direction. All proportions are expressed as
// `(svg unit) * SCALE` where SCALE maps the mock's body radius (82) onto
// SPLITTER_RADIUS so the silhouette stays faithful even if SPLITTER_RADIUS
// changes later.
//
// Per CLAUDE.md: splitters carry teamId (drives accent + friend/foe) and
// ownerId (reserved for kill attribution). Children inherit both fields
// from the parent so kill credit and friend/foe stay consistent across the
// split.

import {
  BASE_BULLET_DAMAGE,
  BASE_BULLET_HP,
  BASE_BULLET_SPEED,
  BASE_HP,
  BASE_RELOAD_TICKS,
  BODY_DAMAGE_BASE,
  BODY_DAMAGE_MULT_TANK,
  TICK_DURATION,
} from '../stats';
import { BULLET_LIFETIME, BULLET_RADIUS, TANK_RADIUS } from '../tank';
import {
  applyBuildingGapToVelocity,
  applyCoreContact,
  createEnemy,
  enforceBuildingGap,
  type Enemy,
  type EnemyDef,
  type EnemyUpdateContext,
} from './enemySystem';

// === Sizing ===
const SIZE_SCALE = 1.8;
export const SPLITTER_RADIUS = TANK_RADIUS * SIZE_SCALE;

// Maps the SVG mock's "body radius = 82" reference into our actual chassis
// pixels. Every decorative dimension below is `(svg value) * SCALE` so the
// silhouette stays faithful at any SPLITTER_RADIUS.
const SCALE = SPLITTER_RADIUS / 82;

// Twin barrels — derived from the SVG mock. In the mock the barrels point
// UP (svgY = -108 → -68); we remap (svgX, svgY) → (-svgY, svgX) into the
// canvas frame where +x = aim direction. Both barrels share the same
// forward extent; only their perpendicular (y) offset differs.
//
//   mock left barrel:  svg x ∈ [-22, -2], y ∈ [-108, -68]
//   mock right barrel: svg x ∈ [  2, 22], y ∈ [-108, -68]
//   → canvas left barrel:  x ∈ [68, 108], y ∈ [-22,  -2]
//   → canvas right barrel: x ∈ [68, 108], y ∈ [  2,  22]
//
// Barrel centers sit at canvas y = ±12*SCALE; barrel half-width = 10*SCALE.
const BARREL_FORWARD_NEAR = 68 * SCALE;
const BARREL_FORWARD_TIP = 108 * SCALE;
const BARREL_HALF_W = 10 * SCALE;
const BARREL_CENTER_OFFSET = 12 * SCALE;
// Dim highlight stripe at the muzzle (mock's inset rect, opacity 0.3).
const MUZZLE_HIGHLIGHT_LEN = 5 * SCALE;
const MUZZLE_HIGHLIGHT_HALF_W = 8 * SCALE;

// Fracture cross — two perpendicular dashed lines through the body center,
// previewing the seams along which the body will split.
const FRACTURE_HALF_LEN = 78 * SCALE;

// 4 child minion previews — solid discs at the quadrants. Mirrors the
// spawn offsets in splitOnDeath below so the visible "internal minions"
// land exactly where they'll appear on death.
const CHILD_OFFSET = 38 * SCALE;
const CHILD_OUTER_R = 22 * SCALE;
const CHILD_RING_R = 5 * SCALE;
const CHILD_DOT_R = 2.5 * SCALE;

// Central team accent — three concentric layers (instead of the swarm /
// gunner's two) so the cue scales with the boss-sized chassis.
const ACCENT_OUTER_R = 16 * SCALE;
const ACCENT_MID_R = 11 * SCALE;
const ACCENT_INNER_R = 7 * SCALE;

// Reported to the manager. `barrelLength` is the visible extent PAST the
// chassis edge (used by drawEnemy's cull margin). The full barrel length
// from breech to tip is BARREL_FORWARD_TIP - BARREL_FORWARD_NEAR; the
// breech sits inside the chassis so the body circle covers it.
export const SPLITTER_BARREL_LENGTH = BARREL_FORWARD_TIP - SPLITTER_RADIUS;
export const SPLITTER_BARREL_WIDTH = BARREL_HALF_W * 2;

// === Stats ===
// Big sack of HP. 8× a fresh lvl-1 player tank — the "boss" of the wave.
// Designed to take significant pressure before splitting, and the 4 swarm
// children mean even a successful kill still leaves work to do.
export const SPLITTER_MAX_HP = BASE_HP * 8;

// Boss-tier body damage to the tank. Higher than the gunner — getting
// rammed by the splitter should feel decisive.
export const SPLITTER_BODY_DAMAGE_TO_TANK =
  BODY_DAMAGE_BASE * BODY_DAMAGE_MULT_TANK * 2;

// Per-second damage applied while overlapping a hostile core. Heaviest of
// any wave enemy per second of contact, matching its strategic weight.
export const SPLITTER_BODY_DAMAGE_TO_CORE = 24;

// Per-tick HP loss inflicted on bullets that hit it. Base shots still die
// in one tick (same as the polygon SHAPE_BASE_DAMAGE pentagon value), but
// high-pen builds trade a touch more HP per hit than against a gunner.
export const SPLITTER_BULLET_REDUCTION = 10;

// === Movement / AI ===
// Slowest cruise of any wave enemy. Big body, lots of momentum. Front gap
// also wider so the visual buffer scales with the chassis radius.
export const SPLITTER_SPEED = 60;
export const SPLITTER_TURN_RATE = 2;
export const SPLITTER_FRONT_GAP = 22;

// === Firing ===
// Aim/fire envelope wider than the gunner — the splitter pressures from
// outside the usual engagement range. Fire tolerance is tight because each
// reload commits both barrels; loose aim would waste shots in pairs.
export const SPLITTER_AIM_RANGE = 680;
export const SPLITTER_FIRE_RANGE = 640;
export const SPLITTER_FIRE_TOLERANCE = 0.18;

// Bullet stats — exact match of a fresh lvl-1 player tank shot, per the
// design brief. Both barrels fire the same shot simultaneously, so
// effective DPS is 2× a base shooter at the same reload.
export const SPLITTER_BULLET_SPEED = BASE_BULLET_SPEED;
export const SPLITTER_BULLET_DAMAGE = BASE_BULLET_DAMAGE;
export const SPLITTER_BULLET_HP = BASE_BULLET_HP;
export const SPLITTER_BULLET_RADIUS = BULLET_RADIUS;
export const SPLITTER_BULLET_LIFETIME = BULLET_LIFETIME;
export const SPLITTER_RELOAD_SECONDS = BASE_RELOAD_TICKS * TICK_DURATION;

// === Death split ===
// Spawns 4 swarm children at the four quadrant offsets shown in the mock.
// Children inherit teamId + ownerId so friend/foe and kill attribution
// match the parent. The caller invokes this BEFORE the dead-enemy filter
// so the splitter's final position is still available.
export function splitOnDeath(
  splitter: Enemy,
  enemies: Enemy[],
  nextEnemyIdRef: { current: number },
): void {
  const offsets: ReadonlyArray<readonly [number, number]> = [
    [ CHILD_OFFSET,  CHILD_OFFSET],
    [-CHILD_OFFSET,  CHILD_OFFSET],
    [-CHILD_OFFSET, -CHILD_OFFSET],
    [ CHILD_OFFSET, -CHILD_OFFSET],
  ];
  for (const [dx, dy] of offsets) {
    enemies.push(createEnemy(
      nextEnemyIdRef.current++,
      'swarm',
      { x: splitter.pos.x + dx, y: splitter.pos.y + dy },
      { teamId: splitter.teamId, ownerId: splitter.ownerId },
    ));
  }
}

// === AI ===
// Same target-selection / movement / fire-gate shape as the swarm + gunner.
// The one wrinkle is the firing path: one shot from EACH barrel per reload,
// both flying along the same aim direction. Muzzles are offset
// ±BARREL_CENTER_OFFSET perpendicular to aim so the bullets emerge from
// the visible muzzles instead of the chassis center.
function updateSplitter(enemy: Enemy, ctx: EnemyUpdateContext): void {
  let aimX = 0, aimY = 0;
  let hasAim = false;
  let bestAimD2 = SPLITTER_AIM_RANGE * SPLITTER_AIM_RANGE;
  let bestFireD2 = SPLITTER_FIRE_RANGE * SPLITTER_FIRE_RANGE;
  let hasFire = false;

  const consider = (tx: number, ty: number) => {
    const dx = tx - enemy.pos.x;
    const dy = ty - enemy.pos.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestAimD2) {
      bestAimD2 = d2;
      aimX = tx; aimY = ty;
      hasAim = true;
    }
    if (d2 < bestFireD2) {
      bestFireD2 = d2;
      hasFire = true;
    }
  };
  if (ctx.playerPos && ctx.playerTeamId !== enemy.teamId) {
    consider(ctx.playerPos.x, ctx.playerPos.y);
  }
  for (const b of ctx.buildings) {
    if (b.hp <= 0 || b.teamId === enemy.teamId) continue;
    consider(b.pos.x, b.pos.y);
  }
  for (const c of ctx.cores) {
    if (c.hp <= 0 || c.teamId === enemy.teamId) continue;
    consider(c.pos.x, c.pos.y);
  }

  // Movement fallback — nothing engageable in aim range, head for the core.
  if (!hasAim) {
    let bestD2 = Infinity;
    for (const c of ctx.cores) {
      if (c.hp <= 0 || c.teamId === enemy.teamId) continue;
      const dx = c.pos.x - enemy.pos.x;
      const dy = c.pos.y - enemy.pos.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) { bestD2 = d2; aimX = c.pos.x; aimY = c.pos.y; hasAim = true; }
    }
    if (!hasAim) {
      enemy.vel.x = 0; enemy.vel.y = 0;
      return;
    }
  }

  // Aim ease.
  const desired = Math.atan2(aimY - enemy.pos.y, aimX - enemy.pos.x);
  let delta = desired - enemy.aimAngle;
  delta = Math.atan2(Math.sin(delta), Math.cos(delta));
  const maxStep = SPLITTER_TURN_RATE * ctx.dt;
  enemy.aimAngle += Math.max(-maxStep, Math.min(maxStep, delta));

  // Walk forward in aim direction; building-gap stripping keeps the
  // splitter from grinding into walls.
  const fx = Math.cos(enemy.aimAngle);
  const fy = Math.sin(enemy.aimAngle);
  enemy.vel.x = fx * SPLITTER_SPEED;
  enemy.vel.y = fy * SPLITTER_SPEED;
  applyBuildingGapToVelocity(enemy, ctx.buildings, SPLITTER_FRONT_GAP, enemy.vel);
  enemy.pos.x += enemy.vel.x * ctx.dt;
  enemy.pos.y += enemy.vel.y * ctx.dt;
  enforceBuildingGap(enemy, ctx.buildings, SPLITTER_FRONT_GAP);
  applyCoreContact(
    enemy, ctx.cores, ctx.dt, SPLITTER_BODY_DAMAGE_TO_CORE, ctx.onCoreDamaged,
  );

  // Twin-barrel fire — one shot from each muzzle per reload, both flying
  // along the same aim direction. The perpendicular axis in canvas-local
  // space is (-dirY, dirX); multiplying by ±BARREL_CENTER_OFFSET lands
  // each shot at the visible muzzle position.
  if (
    hasFire &&
    Math.abs(delta) <= SPLITTER_FIRE_TOLERANCE &&
    enemy.reloadRemaining <= 0
  ) {
    const dirX = Math.cos(enemy.aimAngle);
    const dirY = Math.sin(enemy.aimAngle);
    const perpX = -dirY;
    const perpY = dirX;
    for (const sign of [-1, 1] as const) {
      const muzzleX = enemy.pos.x + dirX * BARREL_FORWARD_TIP + perpX * sign * BARREL_CENTER_OFFSET;
      const muzzleY = enemy.pos.y + dirY * BARREL_FORWARD_TIP + perpY * sign * BARREL_CENTER_OFFSET;
      ctx.bullets.push({
        id: ctx.bulletIdRef.current++,
        pos: { x: muzzleX, y: muzzleY },
        vel: { x: dirX * SPLITTER_BULLET_SPEED, y: dirY * SPLITTER_BULLET_SPEED },
        radius: SPLITTER_BULLET_RADIUS,
        life: SPLITTER_BULLET_LIFETIME,
        hp: SPLITTER_BULLET_HP,
        maxHp: SPLITTER_BULLET_HP,
        damage: SPLITTER_BULLET_DAMAGE,
        teamId: enemy.teamId,
      });
    }
    enemy.reloadRemaining = SPLITTER_RELOAD_SECONDS;
  }
}

// === Twin barrels ===
// Canvas is already translated to the chassis center and rotated by
// aimAngle (+x = aim direction). Both barrels protrude forward; their
// breeches sit at BARREL_FORWARD_NEAR (inside the chassis radius) so the
// body circle, drawn AFTER drawBarrel, covers the breech end.
function drawSplitterBarrels(ctx: CanvasRenderingContext2D, _enemy: Enemy): void {
  ctx.fillStyle = '#999999';
  ctx.strokeStyle = '#727272';
  ctx.lineWidth = 3;
  ctx.lineJoin = 'miter';
  for (const sign of [-1, 1] as const) {
    const yCenter = sign * BARREL_CENTER_OFFSET;
    ctx.beginPath();
    ctx.rect(
      BARREL_FORWARD_NEAR,
      yCenter - BARREL_HALF_W,
      BARREL_FORWARD_TIP - BARREL_FORWARD_NEAR,
      BARREL_HALF_W * 2,
    );
    ctx.fill();
    ctx.stroke();
  }

  // Dim muzzle highlight — short stripe at each barrel tip, matching the
  // mock's "outline @ 0.3 opacity" inset rect.
  ctx.fillStyle = '#575757';
  ctx.globalAlpha = 0.3;
  for (const sign of [-1, 1] as const) {
    const yCenter = sign * BARREL_CENTER_OFFSET;
    ctx.fillRect(
      BARREL_FORWARD_TIP - MUZZLE_HIGHLIGHT_LEN,
      yCenter - MUZZLE_HIGHLIGHT_HALF_W,
      MUZZLE_HIGHLIGHT_LEN,
      MUZZLE_HIGHLIGHT_HALF_W * 2,
    );
  }
  ctx.globalAlpha = 1;
}

// === Interior render ===
// Layered, bottom-up:
//   1. Fracture cross — two dashed perpendicular lines through the body
//      center, signaling the seams along which the body will fracture.
//   2. Four child minion previews in the quadrants — solid discs with a
//      team-accent dot at the center. Matches the spawn offsets in
//      splitOnDeath so the visible children land where the mock implies.
//   3. Central three-layer team accent (the friend/foe cue every enemy
//      uses, scaled up for the boss-sized chassis).
function drawSplitterInterior(
  ctx: CanvasRenderingContext2D,
  _enemy: Enemy,
  accent: string,
  accentDim: string,
): void {
  // Fracture lines — dashed, low-opacity outline color.
  ctx.save();
  ctx.strokeStyle = '#575757';
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = 0.55;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(-FRACTURE_HALF_LEN, 0);
  ctx.lineTo( FRACTURE_HALF_LEN, 0);
  ctx.moveTo(0, -FRACTURE_HALF_LEN);
  ctx.lineTo(0,  FRACTURE_HALF_LEN);
  ctx.stroke();
  ctx.restore();

  // Quadrant child previews — outer disc, inner ring, accent dot.
  const childOffsets: ReadonlyArray<readonly [number, number]> = [
    [ CHILD_OFFSET,  CHILD_OFFSET],
    [-CHILD_OFFSET,  CHILD_OFFSET],
    [-CHILD_OFFSET, -CHILD_OFFSET],
    [ CHILD_OFFSET, -CHILD_OFFSET],
  ];
  for (const [cx, cy] of childOffsets) {
    ctx.fillStyle = '#737578';
    ctx.strokeStyle = '#575757';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, CHILD_OUTER_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#909295';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, CHILD_RING_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(cx, cy, CHILD_DOT_R, 0, Math.PI * 2);
    ctx.fill();
  }

  // Central team accent — darker outer disc, dim ring, bright core. Three
  // layers (vs the swarm/gunner's two) so the cue reads at the larger
  // chassis size.
  ctx.fillStyle = '#737578';
  ctx.strokeStyle = '#575757';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, 0, ACCENT_OUTER_R, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = accentDim;
  ctx.beginPath();
  ctx.arc(0, 0, ACCENT_MID_R, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(0, 0, ACCENT_INNER_R, 0, Math.PI * 2);
  ctx.fill();
}

export const SPLITTER_DEF: EnemyDef = {
  kind: 'splitter',
  radius: SPLITTER_RADIUS,
  maxHp: SPLITTER_MAX_HP,
  bodyDamageToTank: SPLITTER_BODY_DAMAGE_TO_TANK,
  bodyDamageToCore: SPLITTER_BODY_DAMAGE_TO_CORE,
  bulletReduction: SPLITTER_BULLET_REDUCTION,
  barrelLength: SPLITTER_BARREL_LENGTH,
  barrelWidth: SPLITTER_BARREL_WIDTH,
  update: updateSplitter,
  drawInterior: drawSplitterInterior,
  drawBarrel: drawSplitterBarrels,
};
