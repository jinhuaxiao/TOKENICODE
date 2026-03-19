import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';

// --- Types ---

export interface ChannelConfig {
  type: string;
  enabled: boolean;
  config: Record<string, unknown>;
}

export interface IMConfig {
  channels: ChannelConfig[];
  session_mode: 'shared' | 'per_chat';
  max_response_length: number;
  send_typing_indicator: boolean;
}

export interface ChannelStatus {
  channel_type: string;
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  error?: string;
}

export interface IMSession {
  chat_key: string;
  stdin_id: string;
  channel: string;
  chat_id: string;
  sender: string;
  created_at: number;
}

export interface IncomingMessage {
  channel: string;
  chat_id: string;
  sender: string;
  text: string;
  timestamp: number;
}

export interface NewChatEvent {
  chat_key: string;
  channel: string;
  chat_id: string;
  sender: string;
  text: string;
  timestamp: number;
}

// --- IPC Bridge ---

export const imBridge = {
  startChannel: (channelType: string, config: Record<string, unknown>) =>
    invoke<void>('im_start_channel', { channelType, config }),

  stopChannel: (channelType: string) =>
    invoke<void>('im_stop_channel', { channelType }),

  listChannels: () =>
    invoke<ChannelStatus[]>('im_list_channels'),

  getConfig: () =>
    invoke<IMConfig>('im_get_config'),

  saveConfig: (config: IMConfig) =>
    invoke<void>('im_save_config', { config }),

  getSessions: () =>
    invoke<IMSession[]>('im_get_sessions'),

  registerSession: (chatKey: string, stdinId: string, channel: string, chatId: string, sender: string) =>
    invoke<void>('im_register_session', { chatKey, stdinId, channel, chatId, sender }),

  unregisterSession: (chatKey: string, stdinId: string) =>
    invoke<void>('im_unregister_session', { chatKey, stdinId }),

  sendResponse: (channelType: string, chatId: string, text: string) =>
    invoke<void>('im_send_response', { channelType, chatId, text }),
};

// --- Event Listeners ---

export function onIMMessage(handler: (msg: IncomingMessage) => void): Promise<UnlistenFn> {
  return listen<IncomingMessage>('im:message', (event) => handler(event.payload));
}

export function onIMNewChat(handler: (event: NewChatEvent) => void): Promise<UnlistenFn> {
  return listen<NewChatEvent>('im:new_chat', (event) => handler(event.payload));
}

export function onIMRouteMessage(handler: (event: { chat_key: string; text: string; sender: string; timestamp: number }) => void): Promise<UnlistenFn> {
  return listen('im:route_message', (event) => handler(event.payload as any));
}

export interface IMResponseEvent {
  channel: string;
  chat_id: string;
  text: string;
}

export function onIMResponse(handler: (event: IMResponseEvent) => void): Promise<UnlistenFn> {
  return listen<IMResponseEvent>('im:response', (event) => handler(event.payload));
}
