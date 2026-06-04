// Themed action popup that opens when the player left-clicks a friendly
// building or core. Shows current stats, what an upgrade would change
// (`+X` inline in green next to the current value), the upgrade cost,
// and a sell option (buildings only — the core can't be sold).
//
// Pure display + callbacks: parent owns the popup state and the actual
// upgrade / sell mutations. This keeps the game logic in TankShooter.tsx
// + the system modules, and the popup as a stateless React widget.
//
// === Position is NOT a React prop ===
// The outer div is exposed via forwardRef. The parent's canvas frame
// loop reads the ref and writes `style.transform` directly each frame
// from the same camera math the canvas uses — so the popup is glued to
// its target in lockstep with the canvas render, no React-commit lag.
// React only owns content (HP / affordability / buttons).
//
// Visual language matches the game chassis: gray plate background
// (`#909295`-family with translucency), hard `#575757` outlines, corner
// bolts mirroring the turret's armored corners, plate-style buttons
// with HUD-palette accent stripes (score-green `#5cf2a6` for upgrade,
// HUD-bodyDamage-red `#D83848` for sell). No close button — Escape or
// clicking outside the popup dismisses it (handled by the parent).

import { forwardRef } from 'react';

// Pretty-prints a number for the stat row. Integers render bare, fractions
// with one decimal — keeps `Flux/s: 2 → 2.6` readable without committing
// to 2.00-style padding.
function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : (Math.round(n * 10) / 10).toString();
}

// Renders "current +delta" with the delta in score-green. Used by the HP
// row and every extra-stat row so the format stays uniform. `delta` is
// only rendered when positive — at-cap or no-upgrade rows show the bare
// current value.
function ValueWithDelta({
  current,
  delta,
  maxValue,
}: {
  current: number;
  delta: number;
  maxValue?: number;
}) {
  return (
    <span className="action-popup-value-cell">
      <span className="action-popup-value">
        {fmt(current)}{maxValue !== undefined ? `/${fmt(maxValue)}` : ''}
      </span>
      {delta > 0 && (
        <span className="action-popup-delta">+{fmt(delta)}</span>
      )}
    </span>
  );
}

// Common upgrade summary the popup needs regardless of variant. `null`
// means upgrade is unavailable (at cap, or core-gated — see the parent's
// blocked-reason string for the human-readable reason).
export interface UpgradeBuildingSummary {
  cost: number;
  hpDelta: number;
  bulletDamageDelta?: number;   // turret-only
  fluxPerSecondDelta?: number;  // flux-gen-only
  affordable: boolean;
}

export interface UpgradeCoreSummary {
  cost: number;
  hpDelta: number;
  affordable: boolean;
}

// === Building variant ===
export interface BuildingPopupProps {
  kind: 'building';
  name: string;             // e.g. "Turret" — CSS uppercases
  level: number;            // shown as "Level N"
  currentHp: number;
  maxHp: number;
  // Current per-kind stats. Optional because not every building has them
  // (walls have no bullet damage, etc.). When present they render under
  // the HP bar in the same `current +delta` format.
  bulletDamage?: number;
  fluxPerSecond?: number;
  upgrade: UpgradeBuildingSummary | null;
  // Empty string when the upgrade is available + affordable. When set,
  // appears as a small muted line under the buttons (e.g.
  // "Upgrade core to L3 to unlock"). Insufficient-flux state is NOT
  // shown here — the disabled button + visible cost on the button
  // communicate that condition.
  blockedReason: string;
  sellRefund: number;
  onUpgrade: () => void;
  onSell: () => void;
}

// === Core variant ===
export interface CorePopupProps {
  kind: 'core';
  name: string;             // "Core"
  level: number;
  currentHp: number;
  maxHp: number;
  upgrade: UpgradeCoreSummary | null;
  blockedReason: string;
  onUpgrade: () => void;
}

export type ActionPopupProps = BuildingPopupProps | CorePopupProps;

// forwardRef so the parent can hold a DOM ref to the outer div and write
// its position directly each frame (see comment at the top of the file).
export const ActionPopup = forwardRef<HTMLDivElement, ActionPopupProps>(function ActionPopup(props, ref) {
  const hpDelta = props.upgrade?.hpDelta ?? 0;

  // Extra stat rows shown under the HP bar — only present when the kind
  // has a value AND we want to display it. Walls show HP only (cleanest
  // for the simplest building).
  type Extra = { label: string; current: number; delta: number };
  const extras: Extra[] = [];
  if (props.kind === 'building') {
    if (props.bulletDamage !== undefined) {
      extras.push({
        label: 'Bullet DMG',
        current: props.bulletDamage,
        delta: props.upgrade?.bulletDamageDelta ?? 0,
      });
    }
    if (props.fluxPerSecond !== undefined) {
      extras.push({
        label: 'Flux / s',
        current: props.fluxPerSecond,
        delta: props.upgrade?.fluxPerSecondDelta ?? 0,
      });
    }
  }

  const atCap = props.upgrade === null && !props.blockedReason;
  const upgradeDisabled = props.upgrade === null || !props.upgrade.affordable;

  // Stop click propagation so clicking inside the popup doesn't bubble to
  // the global mousedown handler that fires bullets or dismisses popups.
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  const hpPct = Math.max(0, Math.min(100, (props.currentHp / props.maxHp) * 100));

  return (
    <div
      ref={ref}
      className="action-popup"
      onMouseDown={stop}
      onClick={stop}
    >
      {/* Corner bolts — visual reference to the turret's armored corner
          bolts. Pure decoration, zero state. */}
      <span className="action-popup-bolt action-popup-bolt-tl" />
      <span className="action-popup-bolt action-popup-bolt-tr" />
      <span className="action-popup-bolt action-popup-bolt-bl" />
      <span className="action-popup-bolt action-popup-bolt-br" />

      <div className="action-popup-header">
        <div className="action-popup-title">{props.name}</div>
        <div className="action-popup-subtitle">Level {props.level}</div>
      </div>

      <div className="action-popup-stats">
        <div className="action-popup-stat-row">
          <span className="action-popup-stat-label">HP</span>
          <ValueWithDelta current={props.currentHp} delta={hpDelta} maxValue={props.maxHp} />
        </div>
        <div className="action-popup-hp-track">
          <div className="action-popup-hp-fill" style={{ width: `${hpPct}%` }} />
        </div>
        {extras.map((e) => (
          <div className="action-popup-stat-row" key={e.label}>
            <span className="action-popup-stat-label">{e.label}</span>
            <ValueWithDelta current={e.current} delta={e.delta} />
          </div>
        ))}
      </div>

      <div className="action-popup-actions">
        <button
          className={`action-popup-btn action-popup-btn-upgrade${upgradeDisabled ? ' is-disabled' : ''}`}
          disabled={upgradeDisabled}
          onClick={props.onUpgrade}
        >
          <span className="action-popup-btn-label">
            {atCap ? 'Max' : 'Upgrade'}
          </span>
          <span className="action-popup-btn-cost">
            {props.upgrade ? `${props.upgrade.cost} flux` : '—'}
          </span>
        </button>
        {props.kind === 'building' && (
          <button
            className="action-popup-btn action-popup-btn-sell"
            onClick={props.onSell}
          >
            <span className="action-popup-btn-label">Sell</span>
            <span className="action-popup-btn-cost">+{props.sellRefund} flux</span>
          </button>
        )}
      </div>

      {props.blockedReason && (
        <div className="action-popup-blocked">{props.blockedReason}</div>
      )}
    </div>
  );
});
