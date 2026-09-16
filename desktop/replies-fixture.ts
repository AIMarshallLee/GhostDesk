import { BrowserWindow } from 'electron';
import { randomUUID } from 'node:crypto';
import { pinyin } from 'pinyin-pro';
import type { ComputerUseAction, ComputerUseTarget } from '../shared/computer-use.ts';
import type { VisibleChatMessage } from '../shared/desktop-replies.ts';
import type { ImeScene } from '../shared/ime.ts';

const fixtureUrl = 'flowdesk://app/desktop-chat-fixture.html';
const imeTerms = ['林小雨', '陈先生', '周女士', '自动', '回复', '恢复', '谢谢', '收到', '团队协作', '安排演示', '资料', '虚构测试', 'soak', '阿', '啊'];

function imeDictionary() {
  const entries = new Map<string, string[]>();
  const add = (spelling: string, word: string) => {
    if (!spelling || !word) return;
    const words = entries.get(spelling) ?? []; if (!words.includes(word)) words.push(word); entries.set(spelling, words);
  };
  for (const term of imeTerms) {
    const segments = new Intl.Segmenter('zh-CN', { granularity: 'word' }).segment(term);
    for (const item of segments) {
      if (!/[\u3400-\u9fff]/u.test(item.segment)) continue;
      const spelling = pinyin(item.segment, { toneType: 'none', type: 'array' }).join('').replace(/ü/g, 'v').toLowerCase();
      add(spelling, item.segment);
      for (let index = 1; index <= spelling.length; index++) add(spelling.slice(0, index), item.segment);
    }
  }
  entries.set('a', ['阿', '啊']);
  entries.set('huifu', ['恢复', '回复']);
  return [...entries].map(([spelling, candidates]) => ({ spelling, candidates }));
}

export type FixtureDeliveryState = 'clear' | 'pending' | 'failed' | 'unknown';
export interface DesktopRepliesFixtureResult {
  activeConversationName: string;
  conversations: Array<{ id: string; name: string; unread: number; composer: string; messages: VisibleChatMessage[] }>;
  sent: Array<{ conversation: string } & VisibleChatMessage>;
  fault: { mode: 'normal' | 'no_send' | 'delay'; delayMs: number; blocked: boolean; deliveryState: FixtureDeliveryState };
  sceneBlocked: boolean;
  deliveryState: FixtureDeliveryState;
}
export interface DesktopRepliesFixture {
  driver: {
    target: ComputerUseTarget;
    activate(): Promise<void>;
    observe(): Promise<{ base64: string; width: number; height: number }>;
    execute(action: ComputerUseAction): Promise<void>;
    check(): Promise<void>;
  };
  result(): Promise<DesktopRepliesFixtureResult>;
  diagnostic(): Promise<{ activeElement: string; composerValue: string; sendBounds: { x: number; y: number; width: number; height: number }; focused: boolean; visible: boolean; nativeFocused: boolean }>;
  imeKey(command: string): Promise<void>;
  imeScene(): Promise<ImeScene>;
  setImeStyle(style: 'microsoft' | 'wechat' | 'sogou' | 'baidu'): Promise<void>;
  inject(name: string, text: string, stamp?: string): Promise<VisibleChatMessage>;
  setComposer(text: string, name?: string): Promise<void>;
  manualSend(text?: string, name?: string): Promise<{ sent: boolean; reason?: string; message?: VisibleChatMessage }>;
  switchConversation(name: string): Promise<string>;
  fault(input: Partial<{ mode: 'normal' | 'no_send' | 'delay'; delayMs: number; blocked: boolean; close: boolean }>): Promise<void>;
  nativeTarget(): ComputerUseTarget;
  close(): void;
  isClosed(): boolean;
}

export async function createDesktopRepliesFixture(hidden = false): Promise<DesktopRepliesFixture> {
  const window = new BrowserWindow({
    title: 'FlowDesk 多会话虚构测试窗口', width: 1000, height: 700, useContentSize: true,
    show: false, resizable: false, autoHideMenuBar: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, offscreen: hidden },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  await window.loadURL(fixtureUrl);
  await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))');

  const target: ComputerUseTarget = { id: `test:desktop-replies:${randomUUID()}`, name: 'FlowDesk 多会话虚构测试窗口', kind: 'test' };
  const ensure = () => {
    if (window.isDestroyed() || window.webContents.getURL() !== fixtureUrl) throw new Error('多会话测试窗口已关闭。');
  };
  const pageCall = async <T>(method: string, args: unknown[] = []): Promise<T> => {
    ensure();
    const source = `window.desktopRepliesFixture.${method}(...${JSON.stringify(args)})`;
    return window.webContents.executeJavaScript(source, true) as Promise<T>;
  };
  await pageCall('configureIme', [imeDictionary()]);
  const point = (action: { x: number; y: number }) => {
    if (![action.x, action.y].every(value => Number.isFinite(value) && value >= 0 && value <= 1)) throw new Error('测试坐标无效。');
    const [width, height] = window.getContentSize();
    return { x: Math.min(width - 1, Math.round(action.x * width)), y: Math.min(height - 1, Math.round(action.y * height)) };
  };
  const driver = {
    target,
    async activate() { ensure(); if (!hidden) { window.show(); window.focus(); } window.webContents.focus(); },
    async focus() { ensure(); if (!hidden) { window.show(); window.focus(); } window.webContents.focus(); },
    async check() { ensure(); },
    async observe() {
      ensure();
      const capture = hidden
        ? await new Promise<Electron.NativeImage>((resolve, reject) => {
          const onPaint = (_event: Electron.Event, _dirty: Electron.Rectangle, image: Electron.NativeImage) => {
            // The fixture's top-left sidebar is #1f2937; NativeImage bitmap bytes are BGRA.
            const pixel = image.toBitmap();
            if (pixel[0] !== 55 || pixel[1] !== 41 || pixel[2] !== 31) return;
            clearTimeout(timer); window.webContents.removeListener('paint', onPaint); resolve(image);
          };
          const timer = setTimeout(() => { window.webContents.removeListener('paint', onPaint); reject(new Error('多会话测试窗口绘制超时。')); }, 5000);
          window.webContents.on('paint', onPaint);
          window.webContents.invalidate();
        })
        : await window.webContents.capturePage(undefined, { stayAwake: true });
      const { width, height } = capture.getSize();
      if (!width || !height) throw new Error('多会话测试窗口截图失败。');
      return { base64: capture.toPNG().toString('base64'), width, height };
    },
    async execute(action: ComputerUseAction) {
      ensure();
      if (action.kind === 'move') {
        window.webContents.sendInputEvent({ type: 'mouseMove', ...point(action) });
      } else if (action.kind === 'click') {
        const position = point(action);
        window.webContents.sendInputEvent({ type: 'mouseMove', ...position });
        for (let clickCount = 1; clickCount <= action.count; clickCount++) {
          window.webContents.sendInputEvent({ type: 'mouseDown', ...position, button: action.button, clickCount });
          window.webContents.sendInputEvent({ type: 'mouseUp', ...position, button: action.button, clickCount });
        }
      } else if (action.kind === 'type') {
        await window.webContents.insertText(action.text);
      } else if (action.kind === 'scroll') {
        window.webContents.sendInputEvent({ type: 'mouseWheel', ...point(action), deltaX: 0, deltaY: (action.direction === 'down' ? -1 : 1) * action.amount * 40 });
      } else {
        const keys: Record<string, string> = { enter: 'Return', tab: 'Tab', backspace: 'Backspace', delete: 'Delete', left: 'Left', right: 'Right', up: 'Up', down: 'Down', home: 'Home', end: 'End', 'ctrl+a': 'A' };
        if (!keys[action.key]) throw new Error('测试按键不受支持。');
        const modifiers: Array<'control'> = action.key === 'ctrl+a' ? ['control'] : [];
        window.webContents.sendInputEvent({ type: 'keyDown', keyCode: keys[action.key], modifiers });
        window.webContents.sendInputEvent({ type: 'keyUp', keyCode: keys[action.key], modifiers });
      }
    },
  };
  if (!hidden) window.show();
  return {
    driver,
    result: () => pageCall<DesktopRepliesFixtureResult>('result'),
    diagnostic: async () => {
      ensure();
      const dom = await window.webContents.executeJavaScript(`(() => { const composer = document.querySelector('#composer'); const send = document.querySelector('#send'); const box = send.getBoundingClientRect(); return { activeElement: document.activeElement?.id || document.activeElement?.tagName || '', composerValue: composer?.value || '', sendBounds: { x: box.x, y: box.y, width: box.width, height: box.height }, focused: document.hasFocus(), visible: !document.hidden }; })()`, true);
      return { ...dom, nativeFocused: window.isFocused() };
    },
    imeKey: command => pageCall<void>('imeKey', [command]),
    imeScene: () => pageCall<ImeScene>('imeScene'),
    setImeStyle: style => pageCall<void>('setImeStyle', [style]),
    inject: (name, text, stamp) => pageCall<VisibleChatMessage>('inject', [name, text, stamp]),
    async setComposer(text, name) {
      if (name) await pageCall<string>('switchConversation', [name]);
      await pageCall('setComposer', [text]);
    },
    async manualSend(text, name) {
      if (name) await pageCall<string>('switchConversation', [name]);
      return pageCall<{ sent: boolean; reason?: string; message?: VisibleChatMessage }>('manualSend', [text]);
    },
    switchConversation: name => pageCall<string>('switchConversation', [name]),
    async fault(input) {
      if (input.close) { if (!window.isDestroyed()) window.destroy(); return; }
      const { close: _close, ...settings } = input;
      await pageCall('setFault', [settings]);
    },
    nativeTarget: () => {
      ensure();
      const handle = window.getNativeWindowHandle();
      if (handle.length < 8) throw new Error('测试窗口句柄无效。');
      const hwnd = handle.readBigUInt64LE().toString();
      if (hwnd === '0') throw new Error('测试窗口句柄无效。');
      return { id: `window:${hwnd}:0`, name: window.getTitle(), kind: 'window' };
    },
    close: () => { if (!window.isDestroyed()) window.destroy(); },
    isClosed: () => window.isDestroyed(),
  };
}
