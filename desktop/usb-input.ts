import type { ChatDriver } from './chat-surface';
import type { ComputerUseAction } from '../shared/computer-use';
import type { UsbSession } from './usb-device';

export interface PointerPosition { x: number; y: number; targetX: number; targetY: number; inside: boolean }
export interface UsbWindowObserver extends Omit<ChatDriver, 'execute'> {
  pointer(x: number, y: number): Promise<PointerPosition>;
}
export interface ClipboardLease { unchanged(): Promise<boolean>; restore(): Promise<void> }
const keys = new Set(['enter', 'tab', 'backspace', 'delete', 'left', 'right', 'up', 'down', 'home', 'end', 'ctrl+a']);

export function createUsbInputDriver(options: {
  observer: UsbWindowObserver; begin(): Promise<UsbSession>; signal?: AbortSignal;
  delay?: (ms: number) => Promise<void>;
  typeText?: (text: string, command: (frame: string) => Promise<void>, check: () => Promise<void>) => Promise<void>;
}): ChatDriver {
  const { observer, signal } = options;
  let session: UsbSession | undefined; let closed = false; let active = false;
  const delay = options.delay ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const check = async () => { signal?.throwIfAborted(); if (closed) throw new Error('USB 操作已停止。'); await observer.check(); session?.check(); signal?.throwIfAborted(); };
  const command = async (value: string) => { await check(); if (!session) throw new Error('USB 会话尚未启动。'); await session.command(value); await check(); };
  const pointer = async (x: number, y: number) => {
    if (![x, y].every(value => Number.isFinite(value) && value >= 0 && value <= 1)) throw new Error('USB 点击坐标无效。');
    for (let attempt = 0; attempt < 100; attempt++) {
      await check(); const point = await observer.pointer(x, y);
      if (![point.x, point.y, point.targetX, point.targetY].every(Number.isInteger) || !point.inside) throw new Error('目标坐标被其他窗口遮挡。');
      const dx = point.targetX - point.x, dy = point.targetY - point.y;
      if (Math.abs(dx) <= 2 && Math.abs(dy) <= 2) return;
      // Read back the actual cursor after each HID move; do not assume Windows acceleration is 1:1.
      const step = (delta: number) => Math.sign(delta) * Math.max(1, Math.min(80, Math.floor(Math.abs(delta) / 3)));
      await command(`move\t${dx ? step(dx) : 0}\t${dy ? step(dy) : 0}`); await delay(8);
    }
    throw new Error('USB 鼠标未到达目标，已停止点击。');
  };
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => {
    if (closing) return closing;
    closed = true; signal?.removeEventListener('abort', onAbort);
    closing = (async () => {
      try { await session?.stop(); }
      finally { await observer.close?.(); }
    })();
    void closing.catch(() => {});
    return closing;
  };
  const onAbort = () => { void close().catch(() => {}); };
  signal?.addEventListener('abort', onAbort, { once: true });
  return {
    target: observer.target, check, close,
    async activate() {
      signal?.throwIfAborted(); if (closed || session) throw new Error('USB 窗口会话不可重复启动。');
      try {
        await observer.activate(); await check();
        const candidate = await options.begin();
        if (closed || signal?.aborted) { await candidate.stop(); throw new Error('USB 启动已取消。'); }
        session = candidate; await check();
      } catch (error) { await close().catch(() => {}); throw error; }
    },
    async focus() {
      signal?.throwIfAborted();
      if (closed) throw new Error('USB 操作已停止。');
      if (!session) throw new Error('请先启动 USB 会话。');
      await observer.activate(); await check();
    },
    async observe() { await check(); const image = await observer.observe(); await check(); return image; },
    async execute(action: ComputerUseAction) {
      if (active) throw new Error('USB 正在执行上一动作。'); active = true;
      try {
        await check(); if (!session) throw new Error('请先启动 USB 会话。');
        if (action.kind === 'move') {
          await pointer(action.x, action.y);
        } else if (action.kind === 'click') {
          if (!['left', 'right'].includes(action.button) || ![1, 2].includes(action.count)) throw new Error('USB 点击参数无效。');
          for (let i = 0; i < action.count; i++) {
            await pointer(action.x, action.y);
            const ready = await observer.pointer(action.x, action.y);
            if (!ready.inside || Math.abs(ready.x - ready.targetX) > 2 || Math.abs(ready.y - ready.targetY) > 2) throw new Error('鼠标位置已改变，取消点击。');
            await command(`click\t${action.button}`);
          }
        } else if (action.kind === 'scroll') {
          if (!Number.isInteger(action.amount) || action.amount < 1 || action.amount > 20 || !['up', 'down'].includes(action.direction)) throw new Error('USB 滚动参数无效。');
          await pointer(action.x, action.y); await command(`wheel\t${action.direction === 'up' ? action.amount : -action.amount}`);
        } else if (action.kind === 'key') {
          if (!keys.has(action.key)) throw new Error('USB 按键不受支持。'); await command(`key\t${action.key}`);
        } else if (action.kind === 'type') {
          if (typeof action.text !== 'string' || !action.text.length || action.text.length > 4096 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(action.text)) throw new Error('USB 输入文本无效。');
          if (!options.typeText) throw new Error('逐键输入尚未配置候选词识别，请检查视觉模型设置。');
          await options.typeText(action.text, command, check);
        } else throw new Error('USB 动作不受支持。');
      } catch (error) { await close().catch(() => {}); throw error; } finally { active = false; }
    },
  };
}
