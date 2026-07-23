export const providerIcons = {
  gemini: new URL("../../assets/svg/googlegemini.svg", import.meta.url).href,
  openai: new URL("../../assets/svg/openai.svg", import.meta.url).href,
  anthropic: new URL("../../assets/svg/anthropic.svg", import.meta.url).href,
  grok: new URL("../../assets/svg/grok.svg", import.meta.url).href,
  doubao: new URL("../../assets/svg/bytedance.svg", import.meta.url).href,
  qwen: new URL("../../assets/svg/qwen.svg", import.meta.url).href,
  deepseek: new URL("../../assets/svg/deepseek.svg", import.meta.url).href,
  zhipu: new URL("../../assets/svg/zhipu.svg", import.meta.url).href
} as const;

export type ProviderIconName = keyof typeof providerIcons;
