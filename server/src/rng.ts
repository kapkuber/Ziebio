// xorshift32 — deterministic, cheap, seedable. Replaces every Math.random()
// in the server simulation so the world is reproducible (essential for the
// position-hash determinism check in Step 3 and for any future replay/rollback).

export class Rng {
  private state: number;

  constructor(seed: number = 0xdeadbeef) {
    this.state = seed >>> 0;
    if (this.state === 0) this.state = 1;
  }

  /** Raw 32-bit unsigned step. */
  nextU32(): number {
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return this.state;
  }

  /** Float in [0, 1). */
  nextFloat(): number {
    return this.nextU32() / 0x100000000;
  }

  /** Float in [min, max). */
  range(min: number, max: number): number {
    return min + this.nextFloat() * (max - min);
  }

  /** Integer in [0, n). */
  intLT(n: number): number {
    return Math.floor(this.nextFloat() * n);
  }
}
