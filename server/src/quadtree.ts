// Simple loose quadtree. Built fresh each tick (cheap at N≈30) and queried by
// every collision system. Items straddling a split boundary stay at the
// current level, so a single query catches anything overlapping its AABB.

export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface QtItem<T> {
  bounds: Bounds;
  ref: T;
}

export class Quadtree<T> {
  private items: QtItem<T>[] = [];
  private children: Quadtree<T>[] | null = null;

  constructor(
    public readonly bounds: Bounds,
    public readonly maxItems: number = 8,
    public readonly maxDepth: number = 5,
    public readonly depth: number = 0,
  ) {}

  clear(): void {
    this.items.length = 0;
    this.children = null;
  }

  private childIndex(b: Bounds): number {
    const cx = this.bounds.x + this.bounds.w / 2;
    const cy = this.bounds.y + this.bounds.h / 2;
    const left = b.x + b.w <= cx;
    const right = b.x >= cx;
    const top = b.y + b.h <= cy;
    const bottom = b.y >= cy;
    if (top) {
      if (left) return 0;
      if (right) return 1;
    } else if (bottom) {
      if (left) return 2;
      if (right) return 3;
    }
    return -1; // straddles split
  }

  private subdivide(): void {
    const hw = this.bounds.w / 2;
    const hh = this.bounds.h / 2;
    const x = this.bounds.x;
    const y = this.bounds.y;
    this.children = [
      new Quadtree({ x, y, w: hw, h: hh }, this.maxItems, this.maxDepth, this.depth + 1),
      new Quadtree({ x: x + hw, y, w: hw, h: hh }, this.maxItems, this.maxDepth, this.depth + 1),
      new Quadtree({ x, y: y + hh, w: hw, h: hh }, this.maxItems, this.maxDepth, this.depth + 1),
      new Quadtree({ x: x + hw, y: y + hh, w: hw, h: hh }, this.maxItems, this.maxDepth, this.depth + 1),
    ];
  }

  insert(b: Bounds, ref: T): void {
    if (this.children) {
      const idx = this.childIndex(b);
      if (idx >= 0) {
        this.children[idx].insert(b, ref);
        return;
      }
    }
    this.items.push({ bounds: b, ref });
    if (!this.children && this.items.length > this.maxItems && this.depth < this.maxDepth) {
      this.subdivide();
      const remaining: QtItem<T>[] = [];
      for (const it of this.items) {
        const idx = this.childIndex(it.bounds);
        if (idx >= 0) this.children![idx].insert(it.bounds, it.ref);
        else remaining.push(it);
      }
      this.items = remaining;
    }
  }

  query(b: Bounds, cb: (ref: T) => void): void {
    if (!this.intersects(b)) return;
    for (const it of this.items) {
      const ib = it.bounds;
      if (ib.x < b.x + b.w && ib.x + ib.w > b.x && ib.y < b.y + b.h && ib.y + ib.h > b.y) {
        cb(it.ref);
      }
    }
    if (this.children) for (const c of this.children) c.query(b, cb);
  }

  private intersects(b: Bounds): boolean {
    return (
      b.x < this.bounds.x + this.bounds.w &&
      b.x + b.w > this.bounds.x &&
      b.y < this.bounds.y + this.bounds.h &&
      b.y + b.h > this.bounds.y
    );
  }
}
