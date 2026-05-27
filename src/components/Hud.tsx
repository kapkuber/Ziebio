// Persistent HUD: top-left hint, score/level/flux pills, stats panel.
// Pure display — no event handlers. Skill-point allocation keys live in
// TankShooter; this component just reads `stats` and `level` to render
// the bars and the available-points counter.

import {
  MAX_STAT_POINTS,
  STAT_LABELS,
  STAT_ORDER,
  availableSkillPoints,
  xpForNextLevel,
  type StatKey,
  type StatPoints,
} from '../game/stats';

const STAT_COLORS: Record<StatKey, string> = {
  healthRegen: '#EF99C3',
  maxHealth: '#8D6ADF',
  bodyDamage: '#D83848',
  bulletSpeed: '#3CA4CB',
  bulletPenetration: '#B9E87E',
  bulletDamage: '#FDF380',
  reload: '#E7896D',
  movementSpeed: '#70D1CA',
};

export interface HudProps {
  hint: string;
  score: number;
  flux: number;
  level: number;
  xp: number;
  stats: StatPoints;
}

export function Hud({ hint, score, flux, level, xp, stats }: HudProps) {
  const skillPointsAvailable = availableSkillPoints(level, stats);
  const xpPct = Math.min(100, (xp / Math.max(1, xpForNextLevel(level))) * 100);

  return (
    <>
      <div className="fixed top-3 left-3 text-xs bg-white/80 rounded-md px-2 py-1 shadow">
        {hint}
      </div>

      <div id="hud-score-level" data-hud="score-level" className="hud-score-level">
        <div className="hud-pill hud-pill-score">
          <div className="hud-pill-fill score" />
          <span className="hud-dot score" />
          <span className="hud-text">Score: {score}</span>
        </div>
        <div className="hud-pill hud-pill-level">
          <div className="hud-pill-fill level" style={{ width: `${xpPct}%` }} />
          <span className="hud-dot level" />
          <span className="hud-text">Lvl {level} Tank</span>
        </div>
        <div className="hud-pill hud-pill-flux">
          <div className="hud-pill-fill flux" />
          <span className="hud-dot flux" />
          <span className="hud-text">Flux: {flux}</span>
        </div>
      </div>

      <div
        id="hud-stats"
        data-hud="stats"
        className={`hud-stats${skillPointsAvailable === 0 ? ' hud-stats--idle' : ''}`}
      >
        <div className="hud-stats-wrap">
          <div className="hud-skill-points">x{skillPointsAvailable}</div>
          {STAT_ORDER.map((key, idx) => {
            const value = stats[key];
            const color = STAT_COLORS[key];
            const maxed = value >= MAX_STAT_POINTS;
            const fillPct = (value / MAX_STAT_POINTS) * 100;
            return (
              <div
                key={key}
                className={`hud-stat-row${maxed ? ' maxed' : ''}`}
                style={{
                  ['--stat-color' as string]: color,
                  ['--stat-segments' as string]: MAX_STAT_POINTS,
                }}
              >
                <div className="hud-stat-bar">
                  <div className="hud-stat-track">
                    <div className="hud-stat-fill" style={{ width: `${fillPct}%`, background: color }} />
                    <div className="hud-stat-segments">
                      {Array.from({ length: MAX_STAT_POINTS }, (_, i) => (
                        <div key={i} className="hud-stat-segment" />
                      ))}
                    </div>
                  </div>
                  <span className="hud-stat-label">{STAT_LABELS[key]}</span>
                  <span className="hud-stat-key">[{idx + 1}]</span>
                </div>
                <div className="hud-stat-value">{maxed ? 'MAX' : `+${value}`}</div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
