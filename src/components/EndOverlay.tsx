// Shared run-ended overlay. Used for both tank death (player can respawn)
// and core destruction (game over, reload to restart). Caller supplies the
// title, subtitle, button label, and click handler.

export interface EndOverlayProps {
  title: string;       // e.g. "You were killed by" or "Game Over"
  subtitle: string;    // killer name or "Core Destroyed"
  score: number;
  level: number;
  timeSeconds: number;
  buttonLabel: string;
  onButtonClick: () => void;
}

function formatTime(s: number): string {
  if (s >= 60) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${s}s`;
}

export function EndOverlay({
  title,
  subtitle,
  score,
  level,
  timeSeconds,
  buttonLabel,
  onButtonClick,
}: EndOverlayProps) {
  return (
    <div className="death-overlay">
      <div className="death-panel">
        <div className="death-killed-by">{title}</div>
        <div className="death-killer-name">{subtitle}</div>
        <div className="death-stats">
          <div className="death-stat-row">
            <span className="death-stat-label">Score:</span>
            <span className="death-stat-value">{score}</span>
          </div>
          <div className="death-stat-row">
            <span className="death-stat-label">Level:</span>
            <span className="death-stat-value">{level}</span>
          </div>
          <div className="death-stat-row">
            <span className="death-stat-label">Time:</span>
            <span className="death-stat-value">{formatTime(timeSeconds)}</span>
          </div>
        </div>
      </div>
      <button className="death-respawn-btn" onClick={onButtonClick}>
        {buttonLabel}
      </button>
    </div>
  );
}
