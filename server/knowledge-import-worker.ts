import { parentPort } from 'node:worker_threads';
import { parseKnowledgeImport } from './knowledge-import';

if (!parentPort) throw new Error('知识导入 worker 必须由 Worker 线程启动');

parentPort.once('message', async input => {
  try {
    parentPort!.postMessage({ ok: true, result: await parseKnowledgeImport(input) });
  } catch (error) {
    parentPort!.postMessage({ ok: false, error: error instanceof Error ? error.message : '知识导入解析失败' });
  }
});
