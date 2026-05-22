// v1 binary protocol — encoders only on the server. Mirror decoders ship with
// the client in Step 5 (client/protocol.ts). Wire format is little-endian.
//
// Quantization choices (all unsigned):
//   pos      : x*4, y*4 → uint16  (map ≤ 16384 px at 1/4-px resolution)
//   angle    : (a mod 2π)/(2π) * 65535 → uint16
//   size     : size*16 → uint16    (up to 4096 px shape)
//   hp ratio : (hp/maxHp)*255 → uint8
//
// Opcodes:
//   0x01 INPUT     (client → server, defined in Step 6)
//   0x80 WELCOME   (server → client, one-shot)
//   0x81 SNAPSHOT  (server → client, every tick)

import type { Bullet, DeathFx, Entity, PlayerInput, World } from "./world.ts";

export const OP_INPUT = 0x01;
export const OP_WELCOME = 0x80;
export const OP_SNAPSHOT = 0x81;

export const PROTOCOL_VERSION = 1;

// INPUT packet layout (10 bytes, fixed):
//   u8  opcode = 0x01
//   u32 seq
//   i8  move_x  (-1, 0, 1)
//   i8  move_y
//   u16 aim_angle  (mapping [0, 2π) → [0, 65535])
//   u8  flags
// flags & 0x02 → next byte is stat_slot (Step 9). Not present in v1.
function s8(b: number): number {
  return b > 127 ? b - 256 : b;
}

export function decodeInput(buf: Uint8Array): PlayerInput | null {
  if (buf.length < 10 || buf[0] !== OP_INPUT) return null;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const flags = buf[9];
  const allocStat = flags & 0x02 ? (buf.length >= 11 ? buf[10] : null) : null;
  return {
    seq: dv.getUint32(1, true),
    moveX: s8(buf[5]),
    moveY: s8(buf[6]),
    aimAngle: (dv.getUint16(7, true) / 65535) * (Math.PI * 2),
    flags,
    allocStat,
  };
}

// ---------------------------------------------------------------------------
// BufferWriter — appends little-endian primitives, grows on demand.
// ---------------------------------------------------------------------------
export class BufferWriter {
  private buf: Uint8Array;
  private view: DataView;
  private off = 0;

  constructor(initial = 1024) {
    this.buf = new Uint8Array(initial);
    this.view = new DataView(this.buf.buffer);
  }

  private ensure(n: number): void {
    if (this.off + n <= this.buf.length) return;
    let cap = this.buf.length;
    while (cap < this.off + n) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf);
    this.buf = next;
    this.view = new DataView(this.buf.buffer);
  }

  u8(v: number): void {
    this.ensure(1);
    this.buf[this.off++] = v & 0xff;
  }

  u16(v: number): void {
    this.ensure(2);
    this.view.setUint16(this.off, v & 0xffff, true);
    this.off += 2;
  }

  u32(v: number): void {
    this.ensure(4);
    this.view.setUint32(this.off, v >>> 0, true);
    this.off += 4;
  }

  /** Unsigned LEB128 (varint). 1–5 bytes for u32. */
  varU(v: number): void {
    this.ensure(5);
    let x = v >>> 0;
    while (x >= 0x80) {
      this.buf[this.off++] = (x & 0x7f) | 0x80;
      x >>>= 7;
    }
    this.buf[this.off++] = x;
  }

  /** Returns a view over the bytes written (no copy). */
  bytes(): Uint8Array {
    return this.buf.subarray(0, this.off);
  }
}

// ---------------------------------------------------------------------------
// Quantizers
// ---------------------------------------------------------------------------
const TWO_PI = Math.PI * 2;

export function quantPos(p: number): number {
  // Clamp + round. Server enforces map bounds elsewhere; this is belt-and-braces.
  const q = Math.round(p * 4);
  return q < 0 ? 0 : q > 0xffff ? 0xffff : q;
}

export function quantAngle(a: number): number {
  let x = a % TWO_PI;
  if (x < 0) x += TWO_PI;
  return Math.round((x / TWO_PI) * 0xffff) & 0xffff;
}

export function quantSize(s: number): number {
  const q = Math.round(s * 16);
  return q < 0 ? 0 : q > 0xffff ? 0xffff : q;
}

export function quantHpRatio(hp: number, maxHp: number): number {
  if (maxHp <= 0) return 0;
  const r = Math.max(0, Math.min(1, hp / maxHp));
  return Math.round(r * 255);
}

// ---------------------------------------------------------------------------
// Encoders
// ---------------------------------------------------------------------------
export interface WelcomeParams {
  clientId: number;
  tankEntityId: number; // 0 if no tank yet (Step 6 fills this in)
  mapW: number;
  mapH: number;
  tickHz: number;
}

export function encodeWelcome(p: WelcomeParams): Uint8Array {
  const w = new BufferWriter(16);
  w.u8(OP_WELCOME);
  w.u32(p.clientId);
  w.u32(p.tankEntityId);
  w.u16(p.mapW);
  w.u16(p.mapH);
  w.u16(p.tickHz);
  w.u8(PROTOCOL_VERSION);
  return w.bytes();
}

export interface PlayerSnapshotBlock {
  hpQ: number; // (hp / maxHp) * 255
  maxHp: number; // raw, u16
  xp: number;
  score: number;
  level: number; // 1..45
  statPoints: readonly number[]; // length 8, each 0..7
  skillPointsAvail: number;
}

export const EMPTY_PLAYER_BLOCK: PlayerSnapshotBlock = {
  hpQ: 0,
  maxHp: 0,
  xp: 0,
  score: 0,
  level: 1,
  statPoints: [0, 0, 0, 0, 0, 0, 0, 0],
  skillPointsAvail: 0,
};

function writeEntity(w: BufferWriter, e: Entity): void {
  w.u32(e.id);
  w.u8(e.kind);
  w.u16(quantPos(e.pos.x));
  w.u16(quantPos(e.pos.y));
  w.u16(quantAngle(e.angle));
  w.u16(quantSize(e.size));
  w.u8(quantHpRatio(e.hp, e.maxHp));
  w.u8(e.hitT > 0 ? 0x01 : 0x00);
}

// DeathFx: 10 bytes each.
function writeDeathFx(w: BufferWriter, fx: DeathFx): void {
  w.u8(fx.kind);
  w.u16(quantPos(fx.pos.x));
  w.u16(quantPos(fx.pos.y));
  w.u16(quantAngle(fx.angle));
  w.u16(quantSize(fx.size));
  const tq = fx.maxT > 0 ? Math.round((fx.t / fx.maxT) * 255) : 0;
  w.u8(tq < 0 ? 0 : tq > 0xff ? 0xff : tq);
}

// Bullets: 14 bytes each.
function writeBullet(w: BufferWriter, b: Bullet): void {
  w.u32(b.id);
  w.u32(b.ownerEntityId);
  w.u16(quantPos(b.pos.x));
  w.u16(quantPos(b.pos.y));
  // radius in 1/2-px units (u8 covers up to 127.5 px — plenty)
  const rq = Math.round(b.radius * 2);
  w.u8(rq < 0 ? 0 : rq > 0xff ? 0xff : rq);
  // life as fraction of lifetime
  const lq = b.lifetime > 0 ? Math.round((b.life / b.lifetime) * 255) : 0;
  w.u8(lq < 0 ? 0 : lq > 0xff ? 0xff : lq);
}

export function encodeSnapshot(world: World, player: PlayerSnapshotBlock): Uint8Array {
  // Pre-size: 1 op + 4 tick + 22 player + varU count + 13/entity + 2 varU zeros.
  const initial = 64 + world.entities.length * 13;
  const w = new BufferWriter(initial);

  w.u8(OP_SNAPSHOT);
  w.u32(world.tick);

  // Player block (always 22 bytes).
  w.u16(player.hpQ);
  w.u16(player.maxHp & 0xffff);
  w.u32(player.xp);
  w.u32(player.score);
  w.u8(player.level);
  for (let i = 0; i < 8; i++) w.u8(player.statPoints[i] ?? 0);
  w.u8(player.skillPointsAvail);

  // Entities.
  w.varU(world.entities.length);
  for (const e of world.entities) writeEntity(w, e);

  // Bullets.
  w.varU(world.bullets.length);
  for (const b of world.bullets) writeBullet(w, b);

  // Death effects.
  w.varU(world.deathFx.length);
  for (const fx of world.deathFx) writeDeathFx(w, fx);

  return w.bytes();
}
