export interface PresetProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiFormat: 'anthropic' | 'openai';
  extra_env: Record<string, string>;
  /** Default model for all tiers (non-Claude providers) */
  defaultModel?: string;
}

export const PROVIDER_PRESETS: PresetProvider[] = [
  {
    id: 'anthropic',
    name: 'Anthropic (官方)',
    baseUrl: 'https://api.anthropic.com',
    apiFormat: 'anthropic',
    extra_env: {},
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    apiFormat: 'openai',
    extra_env: {},
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/anthropic',
    apiFormat: 'anthropic',
    extra_env: {},
    defaultModel: 'glm-5',
  },
  {
    id: 'qwen-coder',
    name: 'Qwen Coder',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiFormat: 'openai',
    extra_env: {},
  },
  {
    id: 'kimi',
    name: 'Kimi',
    baseUrl: 'https://api.kimi.com/coding/',
    apiFormat: 'anthropic',
    extra_env: {},
    defaultModel: 'kimi-for-coding',
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    baseUrl: 'https://api.minimaxi.com/anthropic',
    apiFormat: 'anthropic',
    extra_env: {},
    defaultModel: 'MiniMax-M2.5',
  },
];
