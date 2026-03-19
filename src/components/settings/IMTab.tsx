import { useEffect, useState, useCallback } from 'react';
import { useIMStore } from '../../stores/imStore';
import { useT } from '../../lib/i18n';

export function IMTab() {
  const t = useT();
  const {
    config,
    configLoaded,
    channelStatuses,
    loadConfig,
    saveConfig,
    updateChannelConfig,
    startChannel,
    stopChannel,
    refreshStatuses,
    getChannelStatus,
    getChannelConfig,
  } = useIMStore();

  const [botToken, setBotToken] = useState('');
  const [allowedChatIds, setAllowedChatIds] = useState('');
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState('');
  const [testSuccess, setTestSuccess] = useState(false);

  // Load config on mount
  useEffect(() => {
    if (!configLoaded) loadConfig();
  }, [configLoaded, loadConfig]);

  // Refresh statuses periodically
  useEffect(() => {
    refreshStatuses();
    const interval = setInterval(refreshStatuses, 5000);
    return () => clearInterval(interval);
  }, [refreshStatuses]);

  // Sync form state with config
  useEffect(() => {
    const tgConfig = getChannelConfig('telegram');
    if (tgConfig) {
      setBotToken((tgConfig.config as any)?.bot_token || '');
      const ids = (tgConfig.config as any)?.allowed_chat_ids;
      setAllowedChatIds(ids ? ids.join(', ') : '');
    }
  }, [config, getChannelConfig]);

  const tgStatus = getChannelStatus('telegram');
  const isConnected = tgStatus === 'connected';
  const isConnecting = tgStatus === 'connecting';
  const hasError = tgStatus === 'error';
  const tgStatusObj = channelStatuses.find((s) => s.channel_type === 'telegram');

  const handleSaveTelegram = useCallback(() => {
    const parsedIds = allowedChatIds
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map(Number)
      .filter((n) => !isNaN(n));

    updateChannelConfig('telegram', {
      enabled: true,
      config: {
        bot_token: botToken,
        allowed_chat_ids: parsedIds.length > 0 ? parsedIds : undefined,
      },
    });
    setTestSuccess(false);
    setTestError('');
  }, [botToken, allowedChatIds, updateChannelConfig]);

  const handleConnect = useCallback(async () => {
    setTesting(true);
    setTestError('');
    setTestSuccess(false);
    try {
      handleSaveTelegram();
      await startChannel('telegram');
      setTestSuccess(true);
    } catch (e) {
      setTestError(String(e));
    } finally {
      setTesting(false);
    }
  }, [handleSaveTelegram, startChannel]);

  const handleDisconnect = useCallback(async () => {
    try {
      await stopChannel('telegram');
    } catch (e) {
      setTestError(String(e));
    }
  }, [stopChannel]);

  const handleSessionModeChange = useCallback(
    (mode: 'shared' | 'per_chat') => {
      saveConfig({ ...config, session_mode: mode });
    },
    [config, saveConfig]
  );

  return (
    <div className="space-y-6">
      {/* Section: Telegram */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <TelegramIcon />
          <h3 className="text-sm font-semibold text-text-primary">Telegram</h3>
          <StatusBadge status={tgStatus} />
        </div>

        <div className="space-y-3">
          {/* Bot Token */}
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">
              {t('im.telegram.botToken')}
            </label>
            <div className="flex gap-2">
              <input
                type="password"
                value={botToken}
                onChange={(e) => setBotToken(e.target.value)}
                placeholder="123456:ABC-DEF..."
                className="flex-1 px-3 py-1.5 text-sm rounded-lg border border-border-subtle
                  bg-bg-primary text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
            <p className="mt-1 text-[11px] text-text-tertiary">
              {t('im.telegram.botTokenHint')}
            </p>
          </div>

          {/* Allowed Chat IDs */}
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">
              {t('im.telegram.allowedChats')}
            </label>
            <input
              type="text"
              value={allowedChatIds}
              onChange={(e) => setAllowedChatIds(e.target.value)}
              placeholder="12345, -100123456"
              className="w-full px-3 py-1.5 text-sm rounded-lg border border-border-subtle
                bg-bg-primary text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <p className="mt-1 text-[11px] text-text-tertiary">
              {t('im.telegram.allowedChatsHint')}
            </p>
          </div>

          {/* Connect / Disconnect buttons */}
          <div className="flex items-center gap-2 pt-1">
            {!isConnected ? (
              <button
                onClick={handleConnect}
                disabled={!botToken || testing || isConnecting}
                className="px-3 py-1.5 text-xs font-medium rounded-lg
                  bg-accent text-text-inverse hover:bg-accent-hover
                  disabled:opacity-50 disabled:cursor-not-allowed transition-smooth"
              >
                {testing || isConnecting ? (
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-3 border-[1.5px] border-white/30 border-t-white rounded-full animate-spin" />
                    {t('im.connecting')}
                  </span>
                ) : (
                  t('im.connect')
                )}
              </button>
            ) : (
              <button
                onClick={handleDisconnect}
                className="px-3 py-1.5 text-xs font-medium rounded-lg
                  border border-red-500/30 text-red-500 hover:bg-red-500/10 transition-smooth"
              >
                {t('im.disconnect')}
              </button>
            )}

            {testSuccess && (
              <span className="text-xs text-green-500 font-medium">{t('im.connected')}</span>
            )}
          </div>

          {/* Error display */}
          {(testError || hasError) && (
            <div className="p-2 rounded-lg bg-red-500/10 border border-red-500/20">
              <p className="text-xs text-red-500">
                {testError || tgStatusObj?.error || t('im.error')}
              </p>
            </div>
          )}
        </div>
      </section>

      {/* Divider */}
      <div className="border-t border-border-subtle" />

      {/* Section: Session Mode */}
      <section>
        <h3 className="text-sm font-semibold text-text-primary mb-3">
          {t('im.sessionMode')}
        </h3>
        <div className="space-y-2">
          <label className="flex items-start gap-2 p-2 rounded-lg hover:bg-bg-secondary cursor-pointer transition-smooth">
            <input
              type="radio"
              name="session_mode"
              checked={config.session_mode === 'per_chat'}
              onChange={() => handleSessionModeChange('per_chat')}
              className="mt-0.5 accent-accent"
            />
            <div>
              <p className="text-xs font-medium text-text-primary">{t('im.perChat')}</p>
              <p className="text-[11px] text-text-tertiary">{t('im.perChatDesc')}</p>
            </div>
          </label>
          <label className="flex items-start gap-2 p-2 rounded-lg hover:bg-bg-secondary cursor-pointer transition-smooth">
            <input
              type="radio"
              name="session_mode"
              checked={config.session_mode === 'shared'}
              onChange={() => handleSessionModeChange('shared')}
              className="mt-0.5 accent-accent"
            />
            <div>
              <p className="text-xs font-medium text-text-primary">{t('im.shared')}</p>
              <p className="text-[11px] text-text-tertiary">{t('im.sharedDesc')}</p>
            </div>
          </label>
        </div>
      </section>

      {/* Divider */}
      <div className="border-t border-border-subtle" />

      {/* Coming soon channels */}
      <section>
        <h3 className="text-sm font-semibold text-text-primary mb-3">
          {t('im.moreChannels')}
        </h3>
        <div className="grid grid-cols-2 gap-2">
          {[
            { name: 'Discord', icon: <DiscordIcon /> },
            { name: 'Slack', icon: <SlackIcon /> },
            { name: 'Feishu', icon: <FeishuIcon /> },
            { name: 'Matrix', icon: <MatrixIcon /> },
          ].map((ch) => (
            <div
              key={ch.name}
              className="flex items-center gap-2 p-2.5 rounded-lg border border-border-subtle
                bg-bg-secondary/30 opacity-60"
            >
              {ch.icon}
              <span className="text-xs text-text-muted">{ch.name}</span>
              <span className="ml-auto text-[10px] text-text-tertiary px-1.5 py-0.5
                rounded-full bg-bg-tertiary">
                {t('im.comingSoon')}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

// --- Status Badge ---

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    connected: 'bg-green-500',
    connecting: 'bg-amber-500 animate-pulse',
    error: 'bg-red-500',
    disconnected: 'bg-gray-400',
  };

  return (
    <span className={`w-2 h-2 rounded-full ${colors[status] || colors.disconnected}`} />
  );
}

// --- Icons ---

function TelegramIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path
        d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"
        fill="currentColor"
        className="text-[#229ED9]"
      />
    </svg>
  );
}

function DiscordIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2">
      <path d="M6 7.5a.75.75 0 100 1.5.75.75 0 000-1.5zM10 7.5a.75.75 0 100 1.5.75.75 0 000-1.5z" fill="currentColor" />
      <path d="M13.36 3.2A12.5 12.5 0 0010.13 2a8.87 8.87 0 00-.39.8 11.6 11.6 0 00-3.48 0A8.87 8.87 0 005.87 2 12.5 12.5 0 002.64 3.2 13.17 13.17 0 002 12.8a12.6 12.6 0 003.86 1.95c.31-.42.59-.87.83-1.35a8.16 8.16 0 01-1.31-.63l.32-.25a8.97 8.97 0 007.6 0l.32.25c-.42.25-.86.46-1.31.63.24.48.52.93.83 1.35a12.6 12.6 0 003.86-1.95 13.17 13.17 0 00-.64-9.6z" />
    </svg>
  );
}

function SlackIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
      <path d="M5.5 2v3M5.5 5H3a1 1 0 010-2h1.5M10.5 14v-3M10.5 11H13a1 1 0 010 2h-1.5M2 10.5h3M5 10.5V13a1 1 0 01-2 0v-1.5M14 5.5h-3M11 5.5V3a1 1 0 012 0v1.5" />
    </svg>
  );
}

function FeishuIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 4l5 8 5-8M3 4l5 4 5-4" />
    </svg>
  );
}

function MatrixIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2">
      <rect x="2" y="2" width="12" height="12" rx="1" />
      <path d="M5 6h2v4H5zM9 6h2v4H9z" fill="currentColor" />
    </svg>
  );
}
