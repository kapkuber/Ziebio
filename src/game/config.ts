// Shared configuration values for the Tank Shooter game.

export const GRID_SIZE = 25; // px per grid cell
export const GRID_BG_COLOR = "#cccccc"; // grid background (inside map)
export const GRID_LINE_COLOR = "#c4c4c4"; // grid lines (inside map)
export const OUTSIDE_BG_COLOR = "#b7b7b7"; // grid background (outside map)
export const OUTSIDE_LINE_COLOR = "#adadad"; // grid lines (outside map)

export const MAP_WIDTH = 1500;
export const MAP_HEIGHT = 1500;

export const SPAWN_SAFE_RADIUS = 10 * GRID_SIZE; // no-spawn radius around player
export const MAX_SPAWNS_PER_FRAME = 2;

export interface CameraInfo {
  x: number;
  y: number;
  width: number;
  height: number;
  devicePixelRatio: number;
}
