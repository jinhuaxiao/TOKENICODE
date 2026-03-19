import { memo } from 'react';
import { useTeamStore } from '../../stores/teamStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useT } from '../../lib/i18n';

export const TeamProgressBar = memo(function TeamProgressBar() {
  const t = useT();
  const rounds = useTeamStore((s) => s.rounds);
  const maxRounds = useTeamStore((s) => s.maxRounds);
  const teamModeEnabled = useSettingsStore((s) => s.teamModeEnabled);

  if (!teamModeEnabled) return null;

  const activeRound = rounds.find((r) => r.status === 'searching');
  if (!activeRound) return null;

  const currentRound = activeRound.round;

  return (
    <div className="flex items-center gap-2 px-4 py-1.5
      bg-accent/5 border-b border-accent/10 text-[12px]">
      <span className="text-accent font-medium">
        [{t('team.round')} {currentRound}/{maxRounds}]
      </span>
      <span className="text-text-muted truncate">
        {t('team.searching')}: "{activeRound.query}"
      </span>
      <div className="flex items-center gap-1 ml-auto flex-shrink-0">
        {Array.from({ length: maxRounds }, (_, i) => (
          <span
            key={i}
            className={`w-1.5 h-1.5 rounded-full transition-smooth ${
              i < currentRound
                ? 'bg-accent'
                : i === currentRound - 1
                ? 'bg-accent animate-pulse'
                : 'bg-text-tertiary/30'
            }`}
          />
        ))}
      </div>
    </div>
  );
});
