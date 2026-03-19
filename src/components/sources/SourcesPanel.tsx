import { useTeamStore } from '../../stores/teamStore';
import { useT } from '../../lib/i18n';
import { SourceCard } from './SourceCard';

export function SourcesPanel() {
  const t = useT();
  const sources = useTeamStore((s) => s.sources);
  const rounds = useTeamStore((s) => s.rounds);

  if (sources.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full
        text-text-tertiary gap-3 px-6">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="1.5" className="opacity-40">
          <circle cx="11" cy="11" r="8" />
          <path d="M21 21l-4.35-4.35" strokeLinecap="round" />
        </svg>
        <p className="text-[13px] text-center">{t('team.noSources')}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="px-3 py-2 flex items-center justify-between
        border-b border-border-subtle">
        <span className="text-[13px] font-medium text-text-primary">
          {t('team.sources')}
        </span>
        <span className="text-[11px] text-text-tertiary bg-bg-secondary
          px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
          {sources.length}
        </span>
      </div>

      <div className="flex flex-col gap-4 p-3">
        {rounds.map((round) => {
          const roundSources = sources.filter((s) => s.round === round.round);
          if (roundSources.length === 0) return null;

          return (
            <div key={round.round} className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-medium text-text-tertiary">
                  {t('team.round')} {round.round}
                </span>
                {round.query && (
                  <span className="text-[11px] text-text-muted truncate italic">
                    "{round.query}"
                  </span>
                )}
                {round.status === 'searching' && (
                  <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                {roundSources.map((source) => (
                  <SourceCard key={source.id} source={source} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
