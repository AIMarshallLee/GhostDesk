import { createHash } from 'node:crypto';
import type { ComputerUseAction, ComputerUseTarget } from '../shared/computer-use';
import type { ChatObservation, NormalizedRect, ReplyConversation, ReplyLayout } from '../shared/desktop-replies';
import { TransientChatChange, type DesktopChatSurface } from './replies-contract';
import type { ChatImage, ChatScene } from './reply-model';

export interface ChatDriver {
  target: ComputerUseTarget; observe(): Promise<ChatImage>; execute(action: ComputerUseAction): Promise<void>;
  activate(): Promise<void>; check(): Promise<void>;
  focus?(): Promise<void>;
  close?(): void | Promise<void>;
}
const center = (rect: NormalizedRect) => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
const inside = (rect: NormalizedRect, point: { x: number; y: number }) => point.x > rect.x && point.x < rect.x + rect.width && point.y > rect.y && point.y < rect.y + rect.height;
const transcript = (observation: ChatObservation) => JSON.stringify([observation.conversationName, observation.messages]);
const delay = (signal: AbortSignal, ms = 250) => new Promise<void>((resolve, reject) => {
  signal.throwIfAborted();
  const abort = () => { clearTimeout(timer); reject(new Error('持续回复已取消。')); };
  const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
  signal.addEventListener('abort', abort, { once: true });
});

export function createDesktopChatSurface(options: {
  target: ComputerUseTarget; layout: ReplyLayout;
  createDriver(signal: AbortSignal): Promise<ChatDriver>;
  readScene(image: ChatImage, layout: ReplyLayout, signal: AbortSignal): Promise<ChatScene>;
}): DesktopChatSurface {
  let driver: ChatDriver | undefined;
  let closed = false;
  let cached: { hash: string; scene: ChatScene; at: number } | undefined;
  function ready(signal: AbortSignal): ChatDriver {
    signal.throwIfAborted();
    if (!driver || closed) throw new Error('目标窗口已停止。');
    return driver;
  }
  async function scene(signal: AbortSignal, fresh = false): Promise<ChatScene> {
    const active = ready(signal); await active.check();
    const image = await active.observe(); signal.throwIfAborted();
    const hash = createHash('sha256').update(image.base64).digest('hex');
    const value = !fresh && cached?.hash === hash && Date.now() - cached.at < 15000 ? cached.scene
      : await options.readScene(image, options.layout, signal);
    signal.throwIfAborted(); await active.check();
    if (value.blocked || value.confidence < .95) throw new Error('会话界面有遮挡或无法可靠识别，已停止操作。');
    cached = { hash, scene: value, at: Date.now() };
    return value;
  }
  async function execute(action: ComputerUseAction, signal: AbortSignal) {
    const active = ready(signal); await active.check(); signal.throwIfAborted();
    await active.execute(action); cached = undefined; signal.throwIfAborted();
  }
  async function click(point: { x: number; y: number }, signal: AbortSignal) {
    await execute({ kind: 'click', ...point, button: 'left', count: 1 }, signal);
    await delay(signal);
  }
  function observation(value: ChatScene, name: string): ChatObservation {
    if (value.activeConversationName !== name || !value.atBottom) throw new Error('会话标题或最新消息位置未通过复核。');
    return { conversationName: name, messages: structuredClone(value.messages), composerText: value.composerText, observedAt: new Date().toISOString() };
  }
  async function observe(conversation: ReplyConversation, signal: AbortSignal): Promise<ChatObservation> {
    let current = await scene(signal);
    if (current.activeConversationName !== conversation.name) {
      if (current.composerText) throw new Error('检测到未发送的人工草稿，已停止切换会话。');
      let rows = current.conversations.filter(row => row.name === conversation.name);
      // Search only the calibrated list. Never use global shortcuts or navigate to another app.
      for (let page = 0; !rows.length && page < 6; page++) {
        await execute({ kind: 'scroll', ...center(options.layout.conversations), direction: page === 0 ? 'up' : 'down', amount: page === 0 ? 20 : 4 }, signal);
        cached = undefined; await delay(signal); current = await scene(signal);
        rows = current.conversations.filter(row => row.name === conversation.name);
      }
      if (rows.length !== 1 || !inside(options.layout.conversations, rows[0])) throw new Error('找不到唯一的已配置会话，请检查精确备注名和列表区域。');
      await click(rows[0], signal); current = await scene(signal, true);
    } else if (current.conversations.filter(row => row.name === conversation.name).length > 1) throw new Error('检测到重名会话，请设置唯一备注名。');
    for (let attempt = 0; current.activeConversationName === conversation.name && !current.atBottom && attempt < 3; attempt++) {
      await execute({ kind: 'scroll', ...center(options.layout.messages), direction: 'down', amount: 10 }, signal);
      cached = undefined; await delay(signal); current = await scene(signal, true);
    }
    const first = observation(current, conversation.name);
    // Independent second observation establishes header and transcript stability before accepting a checkpoint.
    const second = observation(await scene(signal, true), conversation.name);
    if (transcript(first) !== transcript(second) && first.composerText === second.composerText) throw new TransientChatChange();
    if (transcript(first) !== transcript(second) || first.composerText !== second.composerText) throw new Error('消息界面正在变化，等待下一次确认。');
    return second;
  }
  return {
    target: options.target,
    async open(signal) {
      const candidate = await options.createDriver(signal);
      try { signal.throwIfAborted(); if (closed) throw new Error('目标窗口已停止。'); driver = candidate; await candidate.activate(); signal.throwIfAborted(); await candidate.check(); }
      catch (error) { driver = undefined; await candidate.close?.(); throw error; }
    },
    observe,
    async deliver(conversation, expected, reply, signal) {
      if (!reply.trim() || reply.length > 4096) throw new Error('回复文本无效。');
      const before = await observe(conversation, signal);
      if (transcript(before) !== transcript(expected) || before.composerText) return { status: 'stale', observation: before };
      // The engine persists `sending` before entering here. Once input starts, all failures are uncertain.
      try {
        await click(center(options.layout.composer), signal);
        await execute({ kind: 'type', text: reply }, signal);
        const typedScene = await scene(signal, true);
        const typed = observation(typedScene, conversation.name);
        if (transcript(before) !== transcript(typed) || typed.composerText !== reply || typedScene.deliveryState !== 'clear') return { status: 'uncertain', observation: typed };
        // The calibrated send control is the only submitting action, issued exactly once.
        await click(center(options.layout.send), signal);
        for (let attempt = 0; attempt < 3; attempt++) {
          const visible = await scene(signal, true);
          const after = observation(visible, conversation.name);
          const tail = after.messages.at(-1);
          // Require a new outgoing bubble after an unchanged transcript suffix. Never treat an old identical bubble as an ACK.
          const previous = before.messages;
          const withoutLast = after.messages.slice(0, -1);
          const overlap = Math.min(previous.length, withoutLast.length);
          const anchored = previous.length === 0 ? withoutLast.length === 0 : overlap > 0
            && JSON.stringify(previous.slice(-overlap)) === JSON.stringify(withoutLast.slice(-overlap));
          if (!after.composerText && visible.deliveryState === 'clear' && tail?.direction === 'outgoing' && tail.text === reply && anchored
            && transcript(after) !== transcript(before)) {
            const confirmation = await scene(signal, true);
            const confirmed = observation(confirmation, conversation.name);
            if (transcript(confirmed) === transcript(after) && !confirmed.composerText && confirmation.deliveryState === 'clear') return { status: 'visually_confirmed', observation: confirmed };
          }
          await delay(signal, 500);
        }
        return { status: 'uncertain' };
      } catch { return { status: 'uncertain' }; }
    },
    async close() { closed = true; cached = undefined; const previous = driver; driver = undefined; await previous?.close?.(); },
  };
}
