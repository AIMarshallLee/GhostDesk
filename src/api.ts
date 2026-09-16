import type { ApiRequest, AppState } from '../shared/types';

let bootstrapped = false;
export async function api<T>(method: ApiRequest['method'], path: string, body?: unknown): Promise<T> {
  if (window.flowdesk) return window.flowdesk.request({ method, path, body }) as Promise<T>;
  if (!bootstrapped) {
    const response = await fetch('/api/bootstrap', { credentials: 'same-origin' });
    if (!response.ok) throw new Error('本地服务尚未启动，请运行启动脚本后重试。');
    bootstrapped = true;
  }
  const response = await fetch(`/api${path}`, {
    method, credentials: 'same-origin',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json().catch(() => ({ error: '服务返回了无法读取的响应。' }));
  if (!response.ok) { if (response.status === 401) bootstrapped = false; throw new Error(result.error || result.message || '操作失败，请重试。'); }
  return result as T;
}
export const getState = () => api<AppState>('GET', '/state');
export const navigate = (path = 'app') => { window.location.hash = path; };
export async function copyText(text: string) {
  if (window.flowdesk) return window.flowdesk.copyText(text);
  await navigator.clipboard.writeText(text);
}
export function downloadJson(data: unknown, name: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
