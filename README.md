# ziebio

This is a canvas rendered .io style arena game in the diep/arras lineage. Still in Single player development phase, designed so server authoritative multiplayer (4 teams + FFA) can be added eventually.

## Game Loop

You drop a **core** (your base), grow your **tank** by farming polygons for XP, build **flux generators / walls / turrets** around the core, and survive a **50-wave campaign** with a boss every 10 waves. After wave 50 you can roll into endless mode where enemy counts keep scaling but levels cap at 5.

Currently there are five enemy archetypes (swarm, gunner, sniper, rusher, splitter), three building kinds (wall, flux generator, turret), and five tiers for every enemy / building / core. Tier scaling is formula driven (see [src/game/balance.ts](src/game/balance.ts)) so a single retune touches the whole curve.

## Core loop

1. **Place a core** with `C` — it's the only structure you actually defend. Losing it ends the run.
2. **Farm polygons** (square / triangle / pentagon: neutral world resources, not team bound) for XP to level your tank and unlock skill points.
3. **Earn flux** from generators around your core.
4. **Build defenses** walls, turrets, more generators: gated by the core's tier.
5. **Upgrade the core** with flux to unlock the next tier of buildings. Click any friendly building or the core to open the upgrade/sell popup.
6. **Survive each wave** 60s prep timer between waves (`Space` to skip). Every 10th wave is a boss.

## Controls

| Input | Action |
|---|---|
| `WASD` | Move tank |
| Mouse | Aim |
| Left click | Shoot, or open the upgrade popup on a friendly structure |
| `E` | Toggle auto-fire |
| `C` / `V` / `X` / `T` | Place core / wall / flux generator / turret |
| `1`-`8` | Spend skill points (max-health, body damage, bullet damage, etc.) |
| `Space` | Skip the wave prep timer |
| `Escape` | Close the upgrade popup |

Dev-only:

| Input | Action |
|---|---|
| `P` / `O` / `I` / `U` / `Y` | Spawn swarm / gunner / sniper / rusher / splitter at the cursor |
| `K` | Deal 10% max-HP damage to the structure under the cursor |
| ⏸ button (top-right) | Pause everything except the camera — `WASD` pans the camera around the frozen world |

## Running locally

```bash
npm install
npm run dev      # vite dev server with HMR
npm run build    # type-check + production bundle into dist/
npm run preview  # serve the production build locally
npm run lint     # eslint
```

Node 20+ recommended.

## Project structure

```
src/
  TankShooter.tsx                # main canvas component + frame loop + input routing
  components/
    Hud.tsx                      # pills (score / level / flux / wave) + stat panel
    BuildingActionPopup.tsx      # click-a-structure upgrade / sell dialog
    EndOverlay.tsx               # death / game-over screens
  hooks/
    usePlacementController.ts    # generic "press key to toggle placement, click to drop" controller
  game/
    balance.ts                   # per-tier scaling formulas + upgrade / sell costs + XP curves
    stats.ts                     # base player stats + XP curve + derived-stat math
    tank.ts                      # player tank movement, shooting, HP
    bulletSystem.ts              # bullet vs polygon / vs bullet pipeline
    core.ts                      # base structure: HP, leveling, placement, hit-test
    teams.ts                     # team palette + friend / foe rules
    waves/
      composition.ts             # 10-wave roster table (repeats per cycle)
      bosses.ts                  # boss registry (one per cycle, currently placeholder splitters)
      waveSystem.ts              # prep → active → cleared loop + drip-spawning
    enemies/
      enemySystem.ts             # shared Enemy interface + per-frame update + draw
      swarm.ts gunner.ts sniper.ts rusher.ts splitter.ts
    buildings/
      buildingSystem.ts          # shared Building interface + placement validation + upgrade / sell
      wall.ts fluxGenerator.ts turret.ts
    entities/                    # polygons (square / triangle / pentagon)
```

## Architectural notes

- **Game loop = canvas + refs**, not React components. React state drives the HUD and overlays. Game entities live in `useRef` arrays. Mutations happen in named system functions (`updateBullets`, `resolveCoreEntityCollisions`, etc.) but never inside render. This keeps the data shape ready to be replaced by server snapshots without a rendering rewrite.
- **`teamId` vs `ownerId`**: every ownable thing (cores, tanks, buildings, bullets) carries both. `teamId` drives visuals + friend/foe. `ownerId` is per player attribution (kill credit, per player caps). They match in FFA, differ in team modes.
- **Polygons are neutral** world resources, not team-bound. Wave enemies are team bound (currently always hostile to `LOCAL_PLAYER_TEAM`).
- **Per-level visuals** branch on `enemy.level` / `building.level` inside each kind's draw callback.

## Tech

React 19 · Vite 7 · TypeScript · Zustand (for HUD-side state primitives) · Tailwind 4 · Canvas 2D. No game engine library. The game systems are vanilla TS modules under `src/game/`.
