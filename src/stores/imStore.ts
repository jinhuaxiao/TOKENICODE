import { create } from 'zustand';
import { imBridge, onIMMessage, onIMNewChat, onIMRouteMessage, type IMConfig, type ChannelConfig, type ChannelStatus, type IMSession, type IncomingMessage, type NewChatEvent } from '../lib/im-bridge';
import { useChatStore } from './chatStore';
import { useSessionStore } from './sessionStore';
import { bridge } from '../lib/tauri-bridge';

interface IMState {
  // Config (from im_channels.json)
  config: IMConfig;
  configLoaded: boolean;

  // Runtime
  channelStatuses: ChannelStatus[];
  imSessions: IMSession[];

  // Actions
  loadConfig: () => Promise<void>;
  saveConfig: (config: IMConfig) => Promise<void>;
  updateChannelConfig: (channelType: string, update: Partial<ChannelConfig>) => void;
  startChannel: (channelType: string) => Promise<void>;
  stopChannel: (channelType: string) => Promise<void>;
  refreshStatuses: () => Promise<void>;
  refreshSessions: () => Promise<void>;

  // Helpers
  getChannelStatus: (channelType: string) => string;
  getChannelConfig: (channelType: string) => ChannelConfig | undefined;
}

const DEFAULT_CONFIG: IMConfig = {
  channels: [],
  session_mode: 'per_chat',
  max_response_length: 4000,
  send_typing_indicator: true,
};

export const useIMStore = create<IMState>((set, get) => ({
  config: DEFAULT_CONFIG,
  configLoaded: false,
  channelStatuses: [],
  imSessions: [],

  loadConfig: async () => {
    try {
      const config = await imBridge.getConfig();
      set({ config, configLoaded: true });
    } catch (e) {
      console.error('[IM] Failed to load config:', e);
      set({ config: DEFAULT_CONFIG, configLoaded: true });
    }
  },

  saveConfig: async (config: IMConfig) => {
    try {
      await imBridge.saveConfig(config);
      set({ config });
    } catch (e) {
      console.error('[IM] Failed to save config:', e);
    }
  },

  updateChannelConfig: (channelType: string, update: Partial<ChannelConfig>) => {
    const { config } = get();
    const idx = config.channels.findIndex((c) => c.type === channelType);
    const newChannels = [...config.channels];
    if (idx >= 0) {
      newChannels[idx] = { ...newChannels[idx], ...update };
    } else {
      newChannels.push({
        type: channelType,
        enabled: false,
        config: {},
        ...update,
      });
    }
    const newConfig = { ...config, channels: newChannels };
    set({ config: newConfig });
    imBridge.saveConfig(newConfig).catch(console.error);
  },

  startChannel: async (channelType: string) => {
    const { config } = get();
    const chConfig = config.channels.find((c) => c.type === channelType);
    if (!chConfig) {
      throw new Error(`No config for channel: ${channelType}`);
    }
    await imBridge.startChannel(channelType, chConfig.config as Record<string, unknown>);
    await get().refreshStatuses();
  },

  stopChannel: async (channelType: string) => {
    await imBridge.stopChannel(channelType);
    await get().refreshStatuses();
  },

  refreshStatuses: async () => {
    try {
      const statuses = await imBridge.listChannels();
      set({ channelStatuses: statuses });
    } catch (e) {
      console.error('[IM] Failed to refresh statuses:', e);
    }
  },

  refreshSessions: async () => {
    try {
      const sessions = await imBridge.getSessions();
      set({ imSessions: sessions });
    } catch (e) {
      console.error('[IM] Failed to refresh sessions:', e);
    }
  },

  getChannelStatus: (channelType: string) => {
    const status = get().channelStatuses.find((s) => s.channel_type === channelType);
    return status?.status || 'disconnected';
  },

  getChannelConfig: (channelType: string) => {
    return get().config.channels.find((c) => c.type === channelType);
  },
}));

// --- IM Event Listeners (initialized once) ---

let _imListenersInitialized = false;

// Track IM chat_key → stdinId mapping in the frontend
const _imChatToStdin = new Map<string, string>();
// Track sessions being created to avoid duplicate creation
const _imCreatingSessions = new Set<string>();
// Queue messages that arrive while session is being created
const _imPendingMessages = new Map<string, string[]>();
// Pending IM source info for route registration after InputBar creates the real session
let _pendingIMRouteInfo: { channel: string; chatId: string; sender: string } | null = null;

/** Called by InputBar after it creates a session, to register the real stdinId for IM routing */
export function registerIMRouteForSession(stdinId: string) {
  if (!_pendingIMRouteInfo) return;
  const { channel, chatId, sender } = _pendingIMRouteInfo;
  const chatKey = `${channel}:${chatId}`;
  _pendingIMRouteInfo = null;

  console.log('[IM] Registering real stdinId for IM route:', stdinId, chatKey);

  // Unregister the placeholder route
  const oldStdinId = _imChatToStdin.get(chatKey);
  if (oldStdinId) {
    imBridge.unregisterSession(chatKey, oldStdinId).catch(() => {});
  }

  // Register with the real stdinId
  _imChatToStdin.set(chatKey, stdinId);
  imBridge.registerSession(chatKey, stdinId, channel, chatId, sender).catch(console.error);
}

export function initIMListeners() {
  if (_imListenersInitialized) return;
  _imListenersInitialized = true;

  // Auto-connect enabled IM channels on startup
  (async () => {
    try {
      const store = useIMStore.getState();
      await store.loadConfig();
      const { config } = useIMStore.getState();
      for (const ch of config.channels) {
        if (ch.enabled && ch.config) {
          console.log('[IM] Auto-connecting channel:', ch.type);
          try {
            await store.startChannel(ch.type);
            console.log('[IM] Auto-connected:', ch.type);
          } catch (e) {
            console.error('[IM] Auto-connect failed for', ch.type, e);
          }
        }
      }
    } catch (e) {
      console.error('[IM] Failed to auto-connect channels:', e);
    }
  })();

  // Helper: create a new IM session as a proper app session (like "新建任务")
  async function createIMSession(text: string, channel: string, chatId: string, sender: string) {
    const chatKey = `${channel}:${chatId}`;
    if (_imCreatingSessions.has(chatKey)) {
      const pending = _imPendingMessages.get(chatKey) || [];
      pending.push(text);
      _imPendingMessages.set(chatKey, pending);
      console.log('[IM] Queued message for pending session:', chatKey);
      return;
    }
    _imCreatingSessions.add(chatKey);

    console.log('[IM] Creating session for', channel, chatId, sender);

    try {
      const homeDir = await import('@tauri-apps/api/path').then(m => m.homeDir());

      // Create a draft session in the sidebar (same as "新建任务")
      const draftId = `draft_im_${Date.now()}`;
      useSessionStore.getState().addDraftSession(draftId, homeDir);
      // Select this session so it becomes active
      useSessionStore.getState().setSelectedSession(draftId);
      // Reset chat state for the new session
      useChatStore.getState().resetSession();

      // Store IM route info — will be registered with the real stdinId
      // after InputBar's handleSubmit creates the actual CLI session
      _pendingIMRouteInfo = { channel, chatId, sender };

      // Trigger InputBar's handleSubmit by setting imPendingSubmit
      // InputBar will create the CLI session with proper stream listeners
      useChatStore.getState().setImPendingSubmit({
        text,
        imSource: { channel, chatId, sender },
      });

      console.log('[IM] Draft session created, submit triggered:', draftId);

      // Send queued messages after a delay (let the session initialize first)
      const pending = _imPendingMessages.get(chatKey) || [];
      _imPendingMessages.delete(chatKey);
      if (pending.length > 0) {
        setTimeout(async () => {
          for (const pendingText of pending) {
            const stdinId = useChatStore.getState().sessionMeta.stdinId;
            if (stdinId) {
              try {
                await bridge.sendStdin(stdinId, pendingText);
              } catch (e) {
                console.error('[IM] Failed to send queued message:', e);
              }
            }
          }
        }, 3000);
      }
    } catch (e) {
      console.error('[IM] Failed to create session for', chatKey, e);
      try {
        await imBridge.sendResponse(channel, chatId, `[Error] Failed to start session: ${e}`);
      } catch (_) { /* ignore */ }
      _imChatToStdin.delete(chatKey);
    } finally {
      _imCreatingSessions.delete(chatKey);
    }
  }

  // Listen for incoming IM messages — skip commands, don't add to chat (stream processor handles display)
  onIMMessage((msg: IncomingMessage) => {
    if (msg.text.trim().startsWith('/new')) return;
    // Don't add user messages here — they'll come through the normal stream processing
    // when InputBar sends the message to the CLI session.
    // But we DO need to show messages that are sent to an EXISTING session
    // (follow-up messages routed via im:route_message).
  });

  // Listen for new IM chats — create a proper session (like "新建任务")
  onIMNewChat(async (event: NewChatEvent) => {
    await createIMSession(event.text, event.channel, event.chat_id, event.sender);
  });

  // Listen for messages routed to existing IM sessions
  onIMRouteMessage(async (event) => {
    const text = event.text.trim();

    // Handle /new command — reset session and start fresh
    if (text.startsWith('/new')) {
      const stdinId = _imChatToStdin.get(event.chat_key);
      if (stdinId) {
        console.log('[IM] /new command — resetting session for', event.chat_key);
        try { await bridge.killSession(stdinId); } catch (_) { /* ignore */ }
        try { await imBridge.unregisterSession(event.chat_key, stdinId); } catch (_) { /* ignore */ }
        _imChatToStdin.delete(event.chat_key);
      }

      const newPrompt = text.slice(4).trim();
      const [channel, chatId] = event.chat_key.split(':');

      if (newPrompt) {
        await imBridge.sendResponse(channel, chatId, '🔄 New conversation started.');
        await createIMSession(newPrompt, channel, chatId, event.sender);
      } else {
        await imBridge.sendResponse(channel, chatId, '🔄 Conversation reset. Send a message to start a new one.');
      }
      return;
    }

    // Send follow-up message to existing CLI session via stdin
    const stdinId = _imChatToStdin.get(event.chat_key);
    if (!stdinId) {
      console.warn('[IM] No session found for chat_key:', event.chat_key);
      return;
    }

    const [channel, chatId] = event.chat_key.split(':');

    try {
      // Use the same imPendingSubmit mechanism so the message goes through
      // InputBar's full handleSubmit flow (adds user bubble, sends via stdin)
      useChatStore.getState().setImPendingSubmit({
        text: event.text,
        imSource: { channel, chatId, sender: event.sender },
      });
      console.log('[IM] Triggered follow-up submit for', event.chat_key);
    } catch (e) {
      console.error('[IM] Failed to send message to CLI:', e);
    }
  });
}
