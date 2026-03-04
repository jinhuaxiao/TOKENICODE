import { useProviderStore } from '../stores/providerStore';
import type { ModelId } from '../stores/settingsStore';

/**
 * Result of model resolution — either a mapped model name or an error.
 */
export type ModelResolution =
  | { ok: true; model: string }
  | { ok: false; reason: 'no_mapping'; tier: string; providerName: string };

/**
 * Resolve the UI-selected model ID to the provider's actual model name,
 * returning an error if the provider has no mapping for the selected tier.
 */
export function resolveModelOrError(selectedModel: ModelId): ModelResolution {
  const provider = useProviderStore.getState().getActive();
  if (!provider) return { ok: true, model: selectedModel };

  // Map UI model ID to tier
  const tierMap: Record<ModelId, 'opus' | 'sonnet' | 'haiku'> = {
    'claude-opus-4-6': 'opus',
    'claude-sonnet-4-6': 'sonnet',
    'claude-haiku-4-5': 'haiku',
  };
  const tier = tierMap[selectedModel];
  if (!tier) return { ok: true, model: selectedModel };

  const mapping = provider.modelMappings.find(
    (m) => m.tier === tier && m.providerModel,
  );
  if (!mapping?.providerModel) {
    return { ok: false, reason: 'no_mapping', tier, providerName: provider.name };
  }
  return { ok: true, model: mapping.providerModel };
}

/**
 * Resolve the UI-selected model ID to the provider's actual model name.
 * When a provider is active, looks up the model mapping for the selected tier.
 * Returns the original model ID if no mapping is configured (silent fallback).
 */
export function resolveModelForProvider(selectedModel: ModelId): string {
  const r = resolveModelOrError(selectedModel);
  return r.ok ? r.model : selectedModel;
}

/**
 * Stable fingerprint of the current API provider config.
 * Any provider config change invalidates the pre-warmed session.
 */
export function envFingerprint(): string {
  const { activeProviderId, providers } = useProviderStore.getState();
  const provider = providers.find((p) => p.id === activeProviderId);
  return JSON.stringify({
    activeProviderId,
    updatedAt: provider?.updatedAt ?? 0,
  });
}
