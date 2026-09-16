import { createHash, randomBytes } from 'node:crypto';
import type { ClipboardLease } from './usb-input';

type Bookmark = { title: string; url: string };
export type ClipboardData = Record<string, Blob | Bookmark | string>;
interface Item { types: readonly string[]; getType(type: string): Promise<Blob | Bookmark> }
export interface ClipboardAccess { read(): Promise<Item[]>; write(data: ClipboardData[]): Promise<void>; clear(): void }
const markerFormat = 'web application/x-flowdesk-paste';

async function snapshot(access: ClipboardAccess) {
  const items = await access.read(); let bytes = 0; const data: ClipboardData[] = []; const hash = createHash('sha256');
  if (items.length > 16) throw new Error('剪贴板条目过多，未覆盖。');
  for (const item of items) {
    if (item.types.length > 32) throw new Error('剪贴板格式过多，未覆盖。');
    const entry: ClipboardData = {}; hash.update('item');
    for (const type of [...item.types].sort()) {
      const payload = await item.getType(type); hash.update(JSON.stringify(type));
      if (payload instanceof Blob) {
        bytes += payload.size; if (bytes > 16 * 1024 * 1024) throw new Error('剪贴板内容过大，未覆盖。');
        const buffer = await payload.arrayBuffer(); hash.update(Buffer.from(buffer)); entry[type] = new Blob([buffer], { type: payload.type });
      } else {
        const text = JSON.stringify(payload); bytes += text.length; if (bytes > 16 * 1024 * 1024) throw new Error('剪贴板内容过大，未覆盖。');
        hash.update(text); entry[type] = { ...payload };
      }
    }
    data.push(entry);
  }
  return { data, digest: hash.digest('hex') };
}

export async function prepareUsbClipboard(text: string, access: ClipboardAccess, beforeWrite: () => Promise<void>): Promise<ClipboardLease> {
  const saved = await snapshot(access);
  await beforeWrite();
  const current = await snapshot(access);
  if (current.digest !== saved.digest) throw new Error('准备粘贴时剪贴板被更改，未覆盖。');
  const marker = randomBytes(16).toString('hex');
  await access.write([{ 'text/plain': text, [markerFormat]: marker }]);
  const unchanged = async () => {
    const items = await access.read(); const item = items.find(value => value.types.includes(markerFormat) && value.types.includes('text/plain'));
    if (!item) return false;
    const token = await item.getType(markerFormat), content = await item.getType('text/plain');
    return token instanceof Blob && content instanceof Blob && await token.text() === marker && await content.text() === text;
  };
  return { unchanged, async restore() { if (await unchanged()) { if (saved.data.length) await access.write(saved.data); else access.clear(); } } };
}
