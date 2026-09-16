export type AutoMode = 'rules' | 'live';
export type ReplyMode = 'auto' | 'manual';
export type JobStatus = 'queued' | 'generating' | 'retrying' | 'ready' | 'copied' | 'sent' | 'failed' | 'handoff';
export interface SandboxConversation { id: string; name: string; topic: string; enabled: boolean }
export interface SandboxMessage { id: string; conversationId: string; role: 'customer' | 'assistant' | 'human'; text: string; createdAt: string; replyTo?: string; deliveryKey?: string; source?: 'rules' | 'live' | 'human' }
export interface AutoJob { id: string; conversationId: string; messageId: string; status: JobStatus; attempts: number; reply?: string; error?: string; nextAttemptAt?: number }
export interface SandboxState {
  version: 1;
  conversations: SandboxConversation[];
  messages: SandboxMessage[];
  jobs: AutoJob[];
  automation: { status: 'running' | 'paused' | 'stopped'; mode: AutoMode; replyMode: ReplyMode; processing: boolean };
  faults: { generateFailures: number; sendFailures: number; ackLosses: number; delayMs: number };
  stats: { received: number; sent: number; duplicates: number; failed: number; handoff: number; pending: number };
  events: Array<{ at: string; type: string; detail: string }>;
  provider: { configured: boolean; baseUrl: string; model: string };
}

export function isSandboxRequest(value: unknown): value is { method: 'GET' | 'POST'; path: string; body?: unknown } {
  if (!value || typeof value !== 'object') return false;
  const request = value as { method?: unknown; path?: unknown };
  if (request.method === 'GET') return request.path === '/sandbox/state';
  return request.method === 'POST' && typeof request.path === 'string' && (
    ['/sandbox/messages', '/sandbox/control', '/sandbox/faults', '/sandbox/copy'].includes(request.path)
    || /^\/sandbox\/conversations\/(lin|chen|zhou)$/.test(request.path)
  );
}
