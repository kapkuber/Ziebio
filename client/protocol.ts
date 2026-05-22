// Client-side mirror of server/src/protocol.ts. Decoders only — encoders for
// INPUT land in Step 6.

export const OP_INPUT = 0x01;
export const OP_WELCOME = 0x80;
export const OP_SNAPSHOT = 0x81;

const TWO_PI = Math.PI * 2;

export const FLAG_SHOOT = 0x01;
export const FLAG_ALLOC_STAT = 0x02;
export const FLAG_LEVEL_UP_DEBUG = 0x04;

export interface InputPacket {
  seq: number;
  moveX: number; // -1, 0, +1
  moveY: number;
  aimAngle: number; // radians, any value (will be wrapped)
  flags: number;
  /** When (flags & FLAG_ALLOC_STAT), the stat slot 0..7. */
  allocStat?: number | null;
}

export function encodeInput(input: InputPacket): Uint8Array {
  const hasAlloc =
    (input.flags & FLAG_ALLOC_STAT) !== 0 &&
    input.allocStat !== undefined &&
    input.allocStat !== null;
  const buf = new Uint8Array(hasAlloc ? 11 : 10);
  const dv = new DataView(buf.buffer);
  buf[0] = OP_INPUT;
  dv.setUint32(1, input.seq >>> 0, true);
  buf[5] = input.moveX & 0xff;
  buf[6] = input.moveY & 0xff;
  let a = input.aimAngle % TWO_PI;
  if (a < 0) a += TWO_PI;
  dv.setUint16(7, Math.round((a / TWO_PI) * 65535) & 0xffff, true);
  buf[9] = input.flags & 0xff;
  if (hasAlloc) buf[10] = (input.allocStat as number) & 0xff;
  return buf;
}

class Reader {
  private off = 0;
  private view: DataView;
  constructor(public buf: Uint8Array) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  u8(): number { return this.buf[this.off++]; }
  u16(): number { const v = this.view.getUint16(this.off, true); this.off += 2; return v; }
  u32(): number { const v = this.view.getUint32(this.off, true); this.off += 4; return v; }
  varU(): number {
    let r = 0, s = 0, b: number;
    do {
      b = this.buf[this.off++];
      r |= (b & 0x7f) << s;
      s += 7;
    } while (b & 0x80);
    return r >>> 0;
  }
  remaining(): number { return this.buf.length - this.off; }
}

export interface Welcome {
  clientId: number;
  tankEntityId: number;
  mapW: number;
  mapH: number;
  tickHz: number;
  protocolVer: number;
}

export function decodeWelcome(buf: Uint8Array): Welcome {
  const r = new Reader(buf);
  if (r.u8() !== OP_WELCOME) throw new Error("not a WELCOME");
  return {
    clientId: r.u32(),
    tankEntityId: r.u32(),
    mapW: r.u16(),
    mapH: r.u16(),
    tickHz: r.u16(),
    protocolVer: r.u8(),
  };
}

export const enum EntityKind {
  Square = 0,
  Triangle = 1,
  Tank = 2,
}

export interface SnapEntity {
  id: number;
  kind: EntityKind;
  x: number;       // dequantized world px
  y: number;
  angle: number;   // radians [0, 2π)
  size: number;    // px
  hpRatio: number; // 0..1
  flags: number;
}

export interface SnapPlayer {
  hpRatio: number;
  maxHp: number;
  xp: number;
  score: number;
  level: number;
  statPoints: number[];
  skillPointsAvail: number;
}

export interface SnapBullet {
  id: number;
  ownerEntityId: number;
  x: number;
  y: number;
  radius: number;     // px
  lifeFraction: number; // 0..1
}

export interface SnapDeathFx {
  kind: EntityKind;
  x: number;
  y: number;
  angle: number;        // radians [0, 2π)
  size: number;         // px
  tFraction: number;    // 0..1 (1 = just spawned, 0 = expired)
}

export interface Snapshot {
  tick: number;
  player: SnapPlayer;
  entities: SnapEntity[];
  bullets: SnapBullet[];
  deathFx: SnapDeathFx[];
}

export function decodeSnapshot(buf: Uint8Array): Snapshot {
  const r = new Reader(buf);
  if (r.u8() !== OP_SNAPSHOT) throw new Error("not a SNAPSHOT");
  const tick = r.u32();
  const player: SnapPlayer = {
    hpRatio: r.u16() / 65535,
    maxHp: r.u16(),
    xp: r.u32(),
    score: r.u32(),
    level: r.u8(),
    statPoints: [r.u8(), r.u8(), r.u8(), r.u8(), r.u8(), r.u8(), r.u8(), r.u8()],
    skillPointsAvail: r.u8(),
  };
  const n = r.varU();
  const entities: SnapEntity[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const id = r.u32();
    const kind = r.u8() as EntityKind;
    const x = r.u16() / 4;
    const y = r.u16() / 4;
    const angle = (r.u16() / 65535) * TWO_PI;
    const size = r.u16() / 16;
    const hpRatio = r.u8() / 255;
    const flags = r.u8();
    entities[i] = { id, kind, x, y, angle, size, hpRatio, flags };
  }
  const nb = r.varU();
  const bullets: SnapBullet[] = new Array(nb);
  for (let i = 0; i < nb; i++) {
    bullets[i] = {
      id: r.u32(),
      ownerEntityId: r.u32(),
      x: r.u16() / 4,
      y: r.u16() / 4,
      radius: r.u8() / 2,
      lifeFraction: r.u8() / 255,
    };
  }
  const nf = r.varU();
  const deathFx: SnapDeathFx[] = new Array(nf);
  for (let i = 0; i < nf; i++) {
    deathFx[i] = {
      kind: r.u8() as EntityKind,
      x: r.u16() / 4,
      y: r.u16() / 4,
      angle: (r.u16() / 65535) * TWO_PI,
      size: r.u16() / 16,
      tFraction: r.u8() / 255,
    };
  }
  return { tick, player, entities, bullets, deathFx };
}
