// Snapshot interpolation. Renders world state ~INTERP_DELAY ms behind the
// latest snapshot so motion is smooth at any refresh rate even though the
// server ticks at 25 Hz.
//
// Per-RAF, sampleAt(renderTime) walks the snapshot buffer, finds the pair
// bracketing renderTime, and lerps positions/angles/sizes between them.

import type { Snapshot, SnapEntity, SnapBullet } from "./protocol.ts";

const TWO_PI = Math.PI * 2;

export const INTERP_DELAY_MS = 100;
const BUF_CAPACITY = 8;

interface BufEntry {
  snap: Snapshot;
  recvTime: number; // performance.now() at receive
}

function lerpAngle(a: number, b: number, t: number): number {
  // Shortest-arc lerp — handles wrap across the 0/2π boundary.
  let d = b - a;
  while (d > Math.PI) d -= TWO_PI;
  while (d < -Math.PI) d += TWO_PI;
  return a + d * t;
}

function lerpSnapshots(p: Snapshot, n: Snapshot, alpha: number): Snapshot {
  const pEntsById = new Map<number, SnapEntity>();
  for (const e of p.entities) pEntsById.set(e.id, e);
  const pBulsById = new Map<number, SnapBullet>();
  for (const b of p.bullets) pBulsById.set(b.id, b);

  // 'next' defines membership — entities that no longer exist there have
  // already been culled / had a death fx queued by the server.
  const entities: SnapEntity[] = n.entities.map((ne) => {
    const pe = pEntsById.get(ne.id);
    if (!pe) return ne; // freshly spawned this tick — pop in at server position
    return {
      id: ne.id,
      kind: ne.kind,
      x: pe.x + (ne.x - pe.x) * alpha,
      y: pe.y + (ne.y - pe.y) * alpha,
      angle: lerpAngle(pe.angle, ne.angle, alpha),
      size: pe.size + (ne.size - pe.size) * alpha,
      hpRatio: ne.hpRatio,
      flags: ne.flags,
    };
  });

  const bullets: SnapBullet[] = n.bullets.map((nb) => {
    const pb = pBulsById.get(nb.id);
    if (!pb) return nb;
    return {
      id: nb.id,
      ownerEntityId: nb.ownerEntityId,
      x: pb.x + (nb.x - pb.x) * alpha,
      y: pb.y + (nb.y - pb.y) * alpha,
      radius: nb.radius,
      lifeFraction: nb.lifeFraction,
    };
  });

  return {
    tick: n.tick,
    player: n.player,    // HUD-facing data — no interpolation needed
    entities,
    bullets,
    deathFx: n.deathFx,  // server animates t down per tick; just use latest
  };
}

export class SnapshotBuffer {
  private buf: BufEntry[] = [];

  push(snap: Snapshot, now: number = performance.now()): void {
    this.buf.push({ snap, recvTime: now });
    if (this.buf.length > BUF_CAPACITY) this.buf.shift();
  }

  /** Returns the most recently received snapshot (no interpolation). */
  latest(): Snapshot | null {
    return this.buf.length > 0 ? this.buf[this.buf.length - 1].snap : null;
  }

  /** Sample the world at local time `t`. */
  sampleAt(t: number): Snapshot | null {
    if (this.buf.length === 0) return null;
    if (this.buf.length === 1) return this.buf[0].snap;

    let prev: BufEntry | null = null;
    let next: BufEntry | null = null;
    for (const e of this.buf) {
      if (e.recvTime <= t) prev = e;
      else { next = e; break; }
    }

    if (!prev) return this.buf[0].snap;
    if (!next) return prev.snap; // past the latest — hold rather than extrapolate

    const span = next.recvTime - prev.recvTime;
    const alpha = span > 0 ? Math.max(0, Math.min(1, (t - prev.recvTime) / span)) : 0;
    return lerpSnapshots(prev.snap, next.snap, alpha);
  }
}
