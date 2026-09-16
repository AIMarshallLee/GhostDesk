import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ComputerUseSettings, ComputerUseSettingsInput } from '../shared/computer-use.ts';

type Secrets = { get(): Promise<string | undefined>; set(key: string): Promise<void>; delete(): Promise<void> };
export const geminiRootBaseUrl = 'https://generativelanguage.googleapis.com';
export const geminiRecommendedModel = 'gemini-3.8-flash';
const empty = { baseUrl: geminiRootBaseUrl, model: geminiRecommendedModel, modelFamily: 'gemini' as const };
export function validateComputerUseSettings(input: unknown): ComputerUseSettingsInput {
  if (!input || typeof input !== 'object') throw new Error('电脑操作模型配置无效。');
  const value = input as ComputerUseSettingsInput;
  if (typeof value.baseUrl !== 'string' || value.baseUrl.length > 500 || typeof value.model !== 'string' || !value.model.trim() || value.model.length > 200 || !['ui-tars', 'doubao', 'gemini'].includes(value.modelFamily)) throw new Error('请填写模型服务地址、模型 ID 和动作协议。');
  const url = new URL(value.baseUrl.trim());
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) || url.username || url.password || url.search || url.hash) throw new Error('模型地址必须是 HTTPS 或本机 HTTP，不能携带账号或查询参数。');
  if (value.modelFamily === 'gemini' && (url.origin !== geminiRootBaseUrl || url.pathname !== '/')) throw new Error('Gemini Computer Use 必须使用原生接口根地址 https://generativelanguage.googleapis.com，不能使用 OpenAI 兼容或 /v1beta/openai 路径。');
  if (value.apiKey !== undefined && (typeof value.apiKey !== 'string' || value.apiKey.length > 1000)) throw new Error('API Key 格式无效。');
  return { baseUrl: value.baseUrl.trim().replace(/\/$/, ''), model: value.model.trim(), modelFamily: value.modelFamily, ...(value.apiKey?.trim() ? { apiKey: value.apiKey.trim() } : {}) };
}
export async function createComputerUseSettings(directory: string, secrets: Secrets) {
  const file = join(directory, 'computer-use-settings.json');
  let stored = { ...empty } as Omit<ComputerUseSettings, 'hasKey'>;
  try { const loaded = validateComputerUseSettings(JSON.parse(await readFile(file, 'utf8'))); stored = { baseUrl: loaded.baseUrl, model: loaded.model, modelFamily: loaded.modelFamily }; } catch { /* Fresh or invalid configuration requires reconfiguration. */ }
  const readKey = async () => {
    try {
      const value = JSON.parse(await secrets.get() ?? '{}');
      return value.baseUrl === stored.baseUrl && typeof value.apiKey === 'string' ? value.apiKey : undefined;
    } catch { return undefined; }
  };
  const settings = async (): Promise<ComputerUseSettings> => ({ ...stored, hasKey: Boolean(await readKey()) });
  return {
    settings,
    async save(input: unknown) {
      const value = validateComputerUseSettings(input);
      const next = { baseUrl: value.baseUrl, model: value.model, modelFamily: value.modelFamily };
      await mkdir(directory, { recursive: true });
      const temporary = `${file}.tmp`;
      await writeFile(temporary, JSON.stringify(next, null, 2));
      // Bind the encrypted credential to its endpoint even if a config-file rename fails.
      if (value.apiKey) await secrets.set(JSON.stringify({ baseUrl: value.baseUrl, apiKey: value.apiKey }));
      else if (value.baseUrl !== stored.baseUrl) await secrets.delete();
      await rename(temporary, file);
      stored = next;
      return settings();
    },
    async clearKey() { await secrets.delete(); return settings(); },
    async credentials() {
      const apiKey = await readKey();
      if (!apiKey || !stored.baseUrl || !stored.model) throw new Error(stored.modelFamily === 'gemini' ? '请先配置 Gemini 原生 Computer Use 的 API Key。' : '请先配置兼容 UI-TARS 动作协议的模型和 API Key。');
      return { ...stored, apiKey };
    },
  };
}
