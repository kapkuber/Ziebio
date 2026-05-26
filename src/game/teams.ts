// Team palettes. The single source of truth for any color that says "this
// belongs to side X" — core accents, tank fills, building accents, bullets.
//
// Adding a new team or mode is a one-line edit to TEAMS. Adding a new
// renderable that needs team coloring just imports getTeamPalette(teamId)
// and reads the field it needs — never hard-code an accent at the call
// site.
//
// Today the only friendly team is the local player's. When multiplayer /
// team modes arrive, LOCAL_PLAYER_TEAM gets set from the server/lobby
// state instead of being a constant.

export type TeamId = 'blue' | 'red' | 'green' | 'yellow' | 'neutral';

export interface TeamPalette {
  id: TeamId;
  name: string;
  accent: string;     // primary fill on team-owned visuals (diamond, barrel, etc.)
  accentDim: string;  // darker variant — secondary accents, charge bars, glows
  bullet: string;     // projectile fill (typically === accent)
}

// Saturated diep-style team colors. accentDim is a ~35% darker shade used
// for outlines and secondary accents so a tank reads as e.g. "blue body
// with a darker blue outline" instead of needing a separate hard-coded
// outline color at every call site.
export const TEAMS: Record<TeamId, TeamPalette> = {
  blue:    { id: 'blue',    name: 'Blue',    accent: '#00b2e1', accentDim: '#0085a8', bullet: '#00b2e1' },
  red:     { id: 'red',     name: 'Red',     accent: '#f14e54', accentDim: '#b1383d', bullet: '#f14e54' },
  green:   { id: 'green',   name: 'Green',   accent: '#00e16e', accentDim: '#0a9a4a', bullet: '#00e16e' },
  yellow:  { id: 'yellow',  name: 'Yellow',  accent: '#f1c540', accentDim: '#b89028', bullet: '#f1c540' },
  neutral: { id: 'neutral', name: 'Neutral', accent: '#9a9a9a', accentDim: '#5a5a5a', bullet: '#9a9a9a' },
};

// In single-player MVP, the local player is hard-coded to blue. In a future
// multiplayer/team-mode build this becomes server-driven.
export const LOCAL_PLAYER_TEAM: TeamId = 'blue';

export function getTeamPalette(teamId: TeamId): TeamPalette {
  return TEAMS[teamId] ?? TEAMS.neutral;
}
