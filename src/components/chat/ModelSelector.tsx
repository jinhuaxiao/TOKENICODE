import { useState, useRef, useEffect, useMemo } from 'react';
import { useSettingsStore, MODEL_OPTIONS, type ModelId } from '../../stores/settingsStore';
import { useChatStore, generateMessageId } from '../../stores/chatStore';
import { useProviderStore } from '../../stores/providerStore';

/** Tier mapping from ModelId to provider tier key */
const TIER_MAP: Record<ModelId, 'opus' | 'sonnet' | 'haiku'> = {
  'claude-opus-4-6': 'opus',
  'claude-sonnet-4-6': 'sonnet',
  'claude-haiku-4-5': 'haiku',
};

export function ModelSelector({ disabled = false }: { disabled?: boolean }) {
  const selectedModel = useSettingsStore((s) => s.selectedModel);
  const setSelectedModel = useSettingsStore((s) => s.setSelectedModel);
  const activeProvider = useProviderStore((s) => {
    if (!s.activeProviderId) return null;
    return s.providers.find((p) => p.id === s.activeProviderId) ?? null;
  });
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Build display options: show real model names when a provider with mappings is active
  const displayOptions = useMemo(() => {
    if (!activeProvider || activeProvider.modelMappings.length === 0) {
      return MODEL_OPTIONS.map((m) => ({ ...m, mapped: false }));
    }
    return MODEL_OPTIONS.map((m) => {
      const tier = TIER_MAP[m.id];
      const mapping = activeProvider.modelMappings.find((mm) => mm.tier === tier);
      if (mapping?.providerModel) {
        return { ...m, label: mapping.providerModel, short: mapping.providerModel, mapped: true };
      }
      return { ...m, mapped: false };
    });
  }, [activeProvider]);

  const current = displayOptions.find((m) => m.id === selectedModel) || displayOptions[0];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg
          text-xs text-text-muted hover:text-text-primary
          hover:bg-bg-secondary transition-smooth
          disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
          stroke="currentColor" strokeWidth="1.5" className="flex-shrink-0">
          <circle cx="8" cy="8" r="5.5" />
          <path d="M8 5v3l2 1.5" strokeLinecap="round" />
        </svg>
        {current.short}
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>

      {open && (
        <div className="absolute bottom-full right-0 mb-1 w-48
          bg-bg-card border border-border-subtle rounded-xl shadow-lg
          py-1 z-50 animate-in fade-in slide-in-from-bottom-1 duration-150">
          {displayOptions.map((option) => (
            <button
              key={option.id}
              onClick={() => {
                if (option.id !== selectedModel) {
                  const oldShort = current.short;
                  const newShort = option.short;
                  setSelectedModel(option.id);
                  // Insert model-switch tag into chat immediately
                  useChatStore.getState().addMessage({
                    id: generateMessageId(),
                    role: 'system',
                    type: 'text',
                    content: `${oldShort} → ${newShort}`,
                    commandType: 'model-switch',
                    timestamp: Date.now(),
                  });
                }
                setOpen(false);
              }}
              className={`w-full text-left px-3 py-2 text-xs
                transition-smooth flex items-center justify-between
                ${option.id === selectedModel
                  ? 'text-accent bg-accent/5'
                  : 'text-text-muted hover:text-text-primary hover:bg-bg-secondary'
                }`}
            >
              <div>
                <div className={`font-medium ${option.mapped ? 'font-mono' : ''}`}>{option.label}</div>
              </div>
              {option.id === selectedModel && (
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none"
                  stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M3 8l3.5 3.5L13 5" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
