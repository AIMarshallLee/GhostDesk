import { existsSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import type { KnowledgeDraft, KnowledgeImportInput } from '../shared/knowledge';

export interface KnowledgeImportIsolationOptions { workerPath?: string; timeoutMs?: number }
const defaultTimeoutMs = 8_000;

function defaultWorkerPath() {
  const directory = typeof __dirname === 'string' ? __dirname : dirname(fileURLToPath(import.meta.url));
  const bundled = join(directory, 'knowledge-import-worker.cjs');
  return existsSync(bundled) ? bundled : join(directory, 'knowledge-import-worker.ts');
}

/**
 * Runs untrusted document parsing off the desktop's main thread.
 * Packaged callers use the default sibling `knowledge-import-worker.cjs`.
 * Source callers may pass the `.ts` worker path explicitly when their runner does not inherit tsx.
 */
export function parseKnowledgeImportIsolated(input: KnowledgeImportInput, options: KnowledgeImportIsolationOptions = {}): Promise<{ rows: KnowledgeDraft[]; warnings: string[] }> {
  const workerPath = options.workerPath ?? defaultWorkerPath();
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000) return Promise.reject(new Error('知识导入隔离超时必须在 100 至 60000 毫秒之间'));
  const worker = new Worker(workerPath, { resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 }, ...(extname(workerPath) === '.ts' ? { execArgv: ['--import', 'tsx'] } : {}) });
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (callback: () => void) => { if (done) return; done = true; clearTimeout(timer); callback(); };
    const timer = setTimeout(() => finish(() => { void worker.terminate(); reject(new Error(`知识导入解析超过 ${timeoutMs}ms，已终止隔离 worker`)); }), timeoutMs);
    worker.once('message', (message: { ok?: boolean; result?: { rows: KnowledgeDraft[]; warnings: string[] }; error?: string }) => finish(() => {
      void worker.terminate();
      if (message?.ok && message.result) resolve(message.result);
      else reject(new Error(message?.error || '知识导入解析 worker 返回无效结果'));
    }));
    worker.once('error', error => finish(() => reject(new Error(`知识导入解析 worker 异常：${error instanceof Error ? error.message : '未知错误'}`))));
    worker.once('exit', code => { if (!done && code !== 0) finish(() => reject(new Error(`知识导入解析 worker 意外退出（${code}）`))); });
    worker.postMessage(input);
  });
}
