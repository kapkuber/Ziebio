// Controller for all "press key to toggle placement, click to drop" modes
// (core, walls, flux generators, future turrets/spawners). Owns the
// active-mode state + keyboard/mouse dispatch + game-over auto-exit; each
// mode supplies a small config so the boilerplate doesn't multiply with
// every new building kind.
//
// Modes are mutually exclusive by construction — only one can be active at
// a time. Switching modes fires the previous mode's onExit so it can clear
// its preview ref.

import { useRef, useState } from 'react';
import type { CameraInfo } from '../game/config';
import type { Vec2 } from '../game/entities';

export interface PlacementModeConfig {
  // Single-character keyboard key that toggles this mode (lowercased).
  key: string;
  // Optional gate that blocks ENTERING the mode (returns false). Toggling
  // off (exiting) is always allowed. Use for "must have placed a core",
  // "max instances reached", etc.
  canEnter?: () => boolean;
  // True = remain in the mode after a successful placement (walls, flux-gen).
  // False = exit after one drop (core).
  sticky?: boolean;
  // Called every frame while this mode is active. Compute the preview from
  // the cursor, write it to your own ref, and render the ghost on the canvas.
  tick: (ctx: CanvasRenderingContext2D, camera: CameraInfo, mouseWorld: Vec2) => void;
  // Called on left-click while this mode is active. Read your preview ref,
  // attempt the placement, and return true if a placement happened (so the
  // controller can exit non-sticky modes).
  onClick: () => boolean;
  // Optional cleanup when the mode transitions from active to inactive
  // (toggled off, switched away, or auto-exited on game-over). Null out
  // preview refs here so stale ghosts don't render.
  onExit?: () => void;
}

export interface PlacementController<Name extends string> {
  // Live state for JSX consumers (hint text, etc.). Re-renders on transition.
  activeMode: Name | null;
  // Ref-style accessor for the frame loop — no re-render coupling.
  active: () => Name | null;
  isAnyActive: () => boolean;
  // Toggle a mode by its bound key. Returns true if `key` matched a registered
  // mode (so the caller can `return` to short-circuit further key handling),
  // even if the toggle was blocked by canEnter or `enabled`.
  toggleByKey: (key: string) => boolean;
  // Returns true if a placement mode is active and consumed the click — even
  // if the placement failed. Caller should `return` to suppress its own
  // click handling (e.g., shooting).
  handleClick: () => boolean;
  // Run once per frame after camera is computed; dispatches to the active
  // mode's tick. Also auto-exits if `enabled()` flipped to false this frame.
  tickActive: (ctx: CanvasRenderingContext2D, camera: CameraInfo, mouseWorld: Vec2) => void;
  // Force-exit any active mode. Use on game-over so the player can't keep
  // building over a corpse.
  exitAll: () => void;
}

export function usePlacementController<Name extends string>(
  modes: Record<Name, PlacementModeConfig>,
  enabled: () => boolean,
): PlacementController<Name> {
  const [activeMode, setActiveMode] = useState<Name | null>(null);
  const activeRef = useRef<Name | null>(null);
  // Refresh modes ref every render so callbacks always see the latest
  // closures (which may capture refs/state that change over time).
  const modesRef = useRef(modes);
  modesRef.current = modes;

  const setActive = (next: Name | null) => {
    const prev = activeRef.current;
    if (prev === next) return;
    if (prev !== null) {
      const onExit = modesRef.current[prev].onExit;
      if (onExit) onExit();
    }
    activeRef.current = next;
    setActiveMode(next);
  };

  const findByKey = (key: string): Name | null => {
    const map = modesRef.current;
    for (const name of Object.keys(map) as Name[]) {
      if (map[name].key === key) return name;
    }
    return null;
  };

  const toggleByKey = (key: string): boolean => {
    const target = findByKey(key);
    if (target === null) return false;
    if (!enabled()) return true; // consumed but blocked
    if (activeRef.current === target) {
      setActive(null);
      return true;
    }
    const cfg = modesRef.current[target];
    if (cfg.canEnter && !cfg.canEnter()) return true;
    setActive(target);
    return true;
  };

  const handleClick = (): boolean => {
    const mode = activeRef.current;
    if (mode === null) return false;
    if (!enabled()) return true;
    const cfg = modesRef.current[mode];
    const placed = cfg.onClick();
    if (placed && !cfg.sticky) setActive(null);
    return true;
  };

  const tickActive = (ctx: CanvasRenderingContext2D, camera: CameraInfo, mouseWorld: Vec2) => {
    const mode = activeRef.current;
    if (mode === null) return;
    if (!enabled()) {
      setActive(null);
      return;
    }
    modesRef.current[mode].tick(ctx, camera, mouseWorld);
  };

  return {
    activeMode,
    active: () => activeRef.current,
    isAnyActive: () => activeRef.current !== null,
    toggleByKey,
    handleClick,
    tickActive,
    exitAll: () => setActive(null),
  };
}
