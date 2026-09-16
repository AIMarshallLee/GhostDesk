import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareUsbClipboard, type ClipboardAccess, type ClipboardData } from './usb-clipboard';

type Stored = ClipboardData[];
const clone = (data: Stored): Stored => data.map(item => Object.fromEntries(Object.entries(item).map(([type, value]) => [type, value instanceof Blob ? new Blob([value], { type: value.type }) : typeof value === 'string' ? new Blob([value], { type }) : { ...value }]))) as Stored;
function memory(initial: Stored) {
  let value = clone(initial); let writes = 0; let clears = 0;
  const access: ClipboardAccess = {
    async read() { return value.map(item => ({ types: Object.keys(item), async getType(type: string) { const entry = item[type]; if (entry === undefined || typeof entry === 'string') throw new Error('missing type'); return entry instanceof Blob ? new Blob([entry], { type: entry.type }) : { ...entry }; } })); },
    async write(data) { writes++; value = clone(data); }, clear() { clears++; value = []; },
  };
  return { access, set(data: Stored) { value = clone(data); }, value: () => clone(value), writes: () => writes, clears: () => clears };
}
const text = async (data: Stored, type = 'text/plain') => { const value = data[0]?.[type]; return value instanceof Blob ? value.text() : undefined; };

test('snapshot 后剪贴板被外部更新时拒绝覆盖', async () => {
  const memoryClipboard = memory([{ 'text/plain': new Blob(['原中文']) }]);
  await assert.rejects(prepareUsbClipboard('新中文', memoryClipboard.access, async () => memoryClipboard.set([{ 'text/plain': new Blob(['外部更新']) }])), /被更改/);
  assert.equal(await text(memoryClipboard.value()), '外部更新');
  assert.equal(memoryClipboard.writes(), 0);
});

test('写入 marker 后外部更新不会被 restore 覆盖', async () => {
  const memoryClipboard = memory([{ 'text/plain': new Blob(['原中文']) }]);
  const lease = await prepareUsbClipboard('待粘贴中文', memoryClipboard.access, async () => {});
  memoryClipboard.set([{ 'text/plain': new Blob(['用户新复制']) }]);
  await lease.restore();
  assert.equal(await text(memoryClipboard.value()), '用户新复制');
});

test('未变化时恢复中文、多格式与 bookmark', async () => {
  const original: Stored = [{
    'text/plain': new Blob(['原始中文'], { type: 'text/plain' }), 'text/html': new Blob(['<b>原始中文</b>'], { type: 'text/html' }),
    bookmark: { title: '资料', url: 'https://example.invalid/doc' },
  }];
  const memoryClipboard = memory(original);
  const lease = await prepareUsbClipboard('发送中文', memoryClipboard.access, async () => {});
  assert.equal(await text(memoryClipboard.value()), '发送中文');
  await lease.restore();
  const restored = memoryClipboard.value();
  assert.equal(await text(restored), '原始中文');
  assert.equal(await text(restored, 'text/html'), '<b>原始中文</b>');
  assert.deepEqual(restored[0].bookmark, { title: '资料', url: 'https://example.invalid/doc' });
  assert.equal(memoryClipboard.clears(), 0);
});
