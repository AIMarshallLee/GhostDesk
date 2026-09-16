import { BrowserWindow } from 'electron';
import { randomUUID } from 'node:crypto';
import type { ComputerUseAction, ComputerUseTarget } from '../shared/computer-use.ts';

const fixtureUrl = 'flowdesk://app/cu-fixture.html';
export async function createComputerUseFixture(hidden = false) {
  const window = new BrowserWindow({
    title: 'FlowDesk CU 虚构测试窗口', width: 760, height: 540, useContentSize: true,
    show: false, resizable: false, autoHideMenuBar: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, offscreen: hidden },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  await window.loadURL(fixtureUrl);
  await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))');
  const target: ComputerUseTarget = { id: `test:${randomUUID()}`, name: 'FlowDesk CU 虚构测试窗口', kind: 'test' };
  const ensure = () => {
    if (window.isDestroyed() || window.webContents.getURL() !== fixtureUrl) throw new Error('测试窗口已关闭。');
  };
  const point = (action: { x: number; y: number }) => {
    if (![action.x, action.y].every(n => Number.isFinite(n) && n >= 0 && n <= 1)) throw new Error('测试坐标无效。');
    const [width, height] = window.getContentSize();
    return { x: Math.min(width - 1, Math.round(action.x * width)), y: Math.min(height - 1, Math.round(action.y * height)) };
  };
  const driver = {
    target,
    async activate() { ensure(); if (!hidden) { window.show(); window.focus(); } window.webContents.focus(); },
    async focus() { ensure(); if (!hidden) { window.show(); window.focus(); } window.webContents.focus(); },
    async observe() {
      ensure();
      // insertText/sendInputEvent can finish before Chromium paints the new editor.
      // Drain queued rendering before listening for the fresh invalidated frame.
      await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))');
      ensure();
      const capture = hidden
        ? await new Promise<Electron.NativeImage>((resolve, reject) => {
          const onPaint = (_event: Electron.Event, _dirty: Electron.Rectangle, image: Electron.NativeImage) => {
            // Ignore the initial blank compositor frame; the fixture header is #22332a.
            const pixel = image.toBitmap();
            if (pixel[0] !== 42 || pixel[1] !== 51 || pixel[2] !== 34) return;
            clearTimeout(timer); window.webContents.removeListener('paint', onPaint); resolve(image);
          };
          const timer = setTimeout(() => { window.webContents.removeListener('paint', onPaint); reject(new Error('测试窗口绘制超时。')); }, 5000);
          window.webContents.on('paint', onPaint);
          window.webContents.invalidate();
        })
        : await window.webContents.capturePage(undefined, { stayAwake: true });
      const { width, height } = capture.getSize();
      if (!width || !height) throw new Error('测试窗口截图失败。');
      return { base64: capture.toPNG().toString('base64'), width, height };
    },
    async execute(action: ComputerUseAction) {
      ensure();
      if (action.kind === 'move') {
        window.webContents.sendInputEvent({ type: 'mouseMove', ...point(action) });
      } else if (action.kind === 'click') {
        const position = point(action);
        window.webContents.sendInputEvent({ type: 'mouseMove', ...position });
        for (let i = 1; i <= action.count; i++) {
          window.webContents.sendInputEvent({ type: 'mouseDown', ...position, button: action.button, clickCount: i });
          window.webContents.sendInputEvent({ type: 'mouseUp', ...position, button: action.button, clickCount: i });
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
    nativeTarget(): ComputerUseTarget { ensure(); return { kind: 'window', name: window.getTitle(), id: `window:${window.getNativeWindowHandle().readBigUInt64LE().toString()}:0` }; },
    driver,
    isClosed: () => window.isDestroyed(),
    close: () => { if (!window.isDestroyed()) window.destroy(); },
    result: async (): Promise<{ count: number; reply: string }> => {
      ensure();
      // This reads only the application-owned, fictional fixture in an isolated smoke test.
      return window.webContents.executeJavaScript('({count: Number(document.querySelector("#sent-count").textContent), reply: document.querySelector("#last-reply").textContent})');
    },
  };
}
