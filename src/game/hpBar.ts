// Shared inner-HP-bar helper used by every player-placed structure
// (cores, walls, future turrets/generators/spawners). Drawn flush at the
// bottom interior of the structure so adjacent stacked tiles can never
// cover it — the visual issue an external bar would have.
//
// The caller must have already translated the canvas to the structure's
// center; this helper draws in local coordinates around (0, 0).

export function drawInnerHpBar(
  ctx: CanvasRenderingContext2D,
  size: number,
  hpRatio: number,
): void {
  const ratio = Math.max(0, Math.min(1, hpRatio));
  if (ratio >= 1) return;

  const half = size / 2;
  const insetX = size * 0.06;
  const barW = size - insetX * 2;
  const barH = Math.max(4, size * 0.1);
  const radius = barH / 2;
  const bx = -half + insetX;
  const by = half - insetX - barH;

  // Outer pill (dark track + black outline). Drawn as straight top/bottom
  // edges with semicircle caps — same construction as the entity/tank
  // HP bars, just sized to live inside the building.
  ctx.beginPath();
  ctx.moveTo(bx + radius, by);
  ctx.lineTo(bx + barW - radius, by);
  ctx.arc(bx + barW - radius, by + radius, radius, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(bx + radius, by + barH);
  ctx.arc(bx + radius, by + radius, radius, Math.PI / 2, -Math.PI / 2);
  ctx.closePath();
  ctx.fillStyle = '#333333';
  ctx.fill();
  ctx.lineWidth = Math.max(1, barH * 0.25);

  // Inner pill (green fill) — slightly thinner and centered inside the
  // track, then clipped to ratio width.
  const innerH = Math.max(2, barH * 0.55);
  const innerR = innerH / 2;
  const pad = (barH - innerH) / 2;
  const innerX = bx + pad;
  const fy = by + pad;
  const innerW = barW - 2 * pad;
  const fillLen = Math.max(innerR * 2, innerW * ratio);
  ctx.beginPath();
  ctx.moveTo(innerX + innerR, fy);
  ctx.lineTo(innerX + fillLen - innerR, fy);
  ctx.arc(innerX + fillLen - innerR, fy + innerR, innerR, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(innerX + innerR, fy + innerH);
  ctx.arc(innerX + innerR, fy + innerR, innerR, Math.PI / 2, -Math.PI / 2);
  ctx.closePath();
  ctx.fillStyle = '#85e37d';
  ctx.fill();
}
