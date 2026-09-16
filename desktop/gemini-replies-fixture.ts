import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createGeminiRepliesDriver, createGeminiReplyModel } from './gemini-replies';
import { createDesktopChatSurface, type ChatDriver } from './chat-surface';
import { defaultReplyLayout, type VisibleChatMessage } from '../shared/desktop-replies';
import type { ComputerUseAction } from '../shared/computer-use';

const complete = (text: string) => ({ id: 'done', status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text }] }] });
const call = (name: string, args: object, id = 'call') => ({ type: 'function_call', id, name, arguments: { intent: 'fictional permitted step', ...args } });
export async function createGeminiRepliesFixture(mutate?: (calls: any[]) => any[], changeImage = false) {
  let active = 0, composer = '', revision = 0, captures = 0;
  const names = ['虚构小林', '虚构小周'];
  const messages: VisibleChatMessage[][] = names.map(() => [{ direction: 'incoming', text: '虚构询问', stamp: '10:00' }]);
  const requests: any[] = [], writes: ComputerUseAction[] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const part of req) chunks.push(Buffer.from(part));
    const body = JSON.parse(Buffer.concat(chunks).toString()); requests.push({ body, key: req.headers['x-goog-api-key'], path: req.url });
    let reply: unknown;
    if (body.tools) {
      if (body.input.some((step: any) => step.type === 'function_result')) reply = complete('步骤完成');
      else {
        const text = body.input[0].content[0].text;
        const approved = JSON.parse(text.match(/authorized exactly this one action: (.*?)\. Use the native/s)[1]);
        const args = approved.kind === 'type' ? { text: approved.text, press_enter: false }
          : { x: Math.round(approved.x * 1000), y: Math.round(approved.y * 1000) };
        const calls = [call(approved.kind === 'type' ? 'type' : 'click', args)];
        reply = { id: 'actions', status: 'requires_action', steps: mutate ? mutate(calls) : calls };
      }
    } else if (body.system_instruction.startsWith('FLOWDESK_CHAT_SCENE')) {
      reply = complete(JSON.stringify({ activeConversationName: names[active], conversations: names.map((name, i) => ({ name, x: .12, y: .2 + i * .1 })), messages: messages[active], composerText: composer, confidence: 1, deliveryState: 'clear', blocked: false, atBottom: true }));
    } else if (body.system_instruction.startsWith('FLOWDESK_IME_SCENE')) {
      reply = complete(JSON.stringify({ focused: true, field: defaultReplyLayout.composer, text: '', composition: '', candidates: [], confidence: 1, blocked: false }));
    } else reply = complete('虚构回复');
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(reply));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const credentials = { baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, apiKey: 'fictional-only', model: 'gemini-fictional' };
  const image = () => ({ base64: Buffer.from(`fictional-image-${revision}-${changeImage ? captures++ : 0}`).toString('base64'), width: 1000, height: 1000 });
  const driver: ChatDriver = { target: { id: 'fictional', name: '虚构多会话', kind: 'test' }, activate: async () => {}, check: async () => {}, observe: async () => image(),
    execute: async action => {
      writes.push(action); revision++;
      if (action.kind === 'type') composer = action.text;
      if (action.kind === 'click' && action.x < .25) active = action.y < .25 ? 0 : 1;
      if (action.kind === 'click' && action.y > .89) { messages[active].push({ direction: 'outgoing', text: composer, stamp: '10:01' }); composer = ''; }
    },
  };
  const signal = new AbortController().signal;
  const model = createGeminiReplyModel(credentials);
  const native = createGeminiRepliesDriver(driver, credentials, signal);
  const surface = createDesktopChatSurface({ target: driver.target, layout: defaultReplyLayout, readScene: model.readScene, createDriver: async () => native });
  await surface.open(signal);
  return { model, native, surface, requests, writes, signal, image, names, async close() { surface.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}
