import type { ApiRequest, CropRect } from '../shared/types.ts';
import { isSandboxRequest } from '../shared/autopilot.ts';

const API_PATHS: Record<ApiRequest['method'], readonly string[]> = {
  GET: ['/health', '/state', '/export'],
  POST: ['/import', '/knowledge', '/workflows', '/tasks', '/provider/test', '/learning/collect'],
  PUT: ['/settings', '/learning/settings'],
  DELETE: ['/knowledge/', '/workflows/', '/provider/key']
};

export function isAllowedRequest(value: unknown): value is ApiRequest {
  if (!value || typeof value !== 'object') return false;
  const request = value as ApiRequest;
  if (!Object.hasOwn(API_PATHS, request.method) || typeof request.path !== 'string' || !request.path.startsWith('/')) return false;
  if (isSandboxRequest(request)) return true;
  if (request.method === 'POST' && /^\/learning\/[^/]+\/(approve|reject)$/.test(request.path)) return true;
  if (request.method === 'POST' && /^\/tasks\/[^/]+\/(generate|approve|complete|archive|restore)$/.test(request.path)) return true;
  if (request.method === 'PUT' && /^\/(knowledge|workflows|tasks)\/[^/]+$/.test(request.path)) return true;
  return API_PATHS[request.method].some((path) => path.endsWith('/') ? request.path.startsWith(path) : request.path === path);
}

export function validCrop(crop: CropRect | undefined, width: number, height: number): boolean {
  if (!crop) return true;
  return [crop.x, crop.y, crop.width, crop.height].every(Number.isInteger)
    && crop.x >= 0 && crop.y >= 0 && crop.width > 0 && crop.height > 0
    && crop.x + crop.width <= width && crop.y + crop.height <= height;
}

export function windowHandleFromSource(sourceId: string): string | undefined {
  const match = /^window:(\d+):/.exec(sourceId);
  return match?.[1];
}

export function sameWindowIdentity(captured: { sourceId: string; name: string; hwnd?: string; process?: string }, current: { title: string; hwnd: string; process?: string }): boolean {
  return captured.hwnd === current.hwnd && captured.name === current.title
    && (!captured.process || !current.process || captured.process === current.process);
}

export function sameProcessIdentity(captured: { pid?: number; startedAt?: string }, current: { pid?: number; startedAt?: string }): boolean {
  return captured.pid === current.pid && (!captured.startedAt || !current.startedAt || captured.startedAt === current.startedAt);
}

export function isAllowedRendererUrl(url: string, rendererUrl: string): boolean {
  try {
    const actual = new URL(url); const expected = new URL(rendererUrl);
    return ['file:', 'flowdesk:'].includes(actual.protocol) && actual.protocol === expected.protocol
      && actual.host === expected.host && actual.pathname === expected.pathname && !actual.username && !actual.password && !actual.search;
  } catch { return false; }
}

export function isUsbBridgeReply(value: unknown): value is { ok: true; protocol: 1; device: 'FlowDesk USB Bridge'; armed: boolean } {
  return !!value && typeof value === 'object' && (value as Record<string, unknown>).ok === true
    && (value as Record<string, unknown>).protocol === 1 && (value as Record<string, unknown>).device === 'FlowDesk USB Bridge'
    && typeof (value as Record<string, unknown>).armed === 'boolean';
}

export function hasUsbArmState(value: unknown, armed: boolean): boolean {
  return isUsbBridgeReply(value) && value.armed === armed;
}
