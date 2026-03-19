import { memo } from 'react';
import type { Source } from '../../stores/teamStore';
import { bridge } from '../../lib/tauri-bridge';

interface Props {
  source: Source;
  compact?: boolean;
}

export const SourceCard = memo(function SourceCard({ source, compact = false }: Props) {
  const handleClick = () => {
    bridge.openWithDefaultApp(source.url).catch(console.error);
  };

  if (compact) {
    return (
      <button
        onClick={handleClick}
        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg
          bg-bg-secondary hover:bg-bg-tertiary transition-smooth
          text-[11px] text-text-muted hover:text-text-primary
          flex-shrink-0 max-w-[180px] group"
        title={source.title || source.url}
      >
        <img
          src={`https://www.google.com/s2/favicons?domain=${source.domain}&sz=16`}
          alt=""
          width={12}
          height={12}
          className="flex-shrink-0 rounded-sm"
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
        <span className="truncate">{source.domain}</span>
      </button>
    );
  }

  return (
    <button
      onClick={handleClick}
      className="w-full text-left p-3 rounded-xl bg-bg-secondary
        hover:bg-bg-tertiary transition-smooth group cursor-pointer
        border border-transparent hover:border-border-subtle"
    >
      <div className="flex items-center gap-2 mb-1.5">
        <img
          src={`https://www.google.com/s2/favicons?domain=${source.domain}&sz=32`}
          alt=""
          width={14}
          height={14}
          className="flex-shrink-0 rounded-sm"
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
        <span className="text-[11px] text-text-tertiary truncate">
          {source.domain}
        </span>
      </div>
      <div className="text-[13px] font-medium text-text-primary
        group-hover:text-accent transition-smooth leading-snug
        line-clamp-2">
        {source.title}
      </div>
      {source.snippet && (
        <div className="text-[11px] text-text-muted mt-1 leading-relaxed
          line-clamp-2">
          {source.snippet}
        </div>
      )}
    </button>
  );
});
