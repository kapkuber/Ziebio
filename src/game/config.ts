// Shared configuration values for the Tank Shooter game.

export const GRID_SIZE = 25; // px per grid cell
export const GRID_BG_COLOR = "#cccccc"; // grid background (inside map)
export const GRID_LINE_COLOR = "#c4c4c4"; // grid lines (inside map)
export const OUTSIDE_BG_COLOR = "#b7b7b7"; // grid background (outside map)
export const OUTSIDE_LINE_COLOR = "#adadad"; // grid lines (outside map)

export const MAP_WIDTH = 3000;
export const MAP_HEIGHT = 3000;

// Reference area the entity counts and per-frame spawn budget were tuned
// against. MAP_AREA_SCALE === 1 at 1500×1500; grows linearly with map area so
// density and replenishment rate stay constant as the map is resized.
export const REFERENCE_MAP_AREA = 1500 * 1500;
export const MAP_AREA_SCALE = (MAP_WIDTH * MAP_HEIGHT) / REFERENCE_MAP_AREA;

export const SPAWN_SAFE_RADIUS = 10 * GRID_SIZE; // no-spawn radius around player
export const MAX_SPAWNS_PER_FRAME = Math.max(2, Math.round(2 * MAP_AREA_SCALE));

export interface CameraInfo {
  x: number;
  y: number;
  width: number;
  height: number;
  devicePixelRatio: number;
}
