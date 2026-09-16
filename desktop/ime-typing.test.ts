import assert from 'node:assert/strict';
import test from 'node:test';
import { typeWithPinyin } from './ime-typing.ts';
import type { ImeScene } from '../shared/ime.ts';

type Mode = 'zh' | 'en';
function fake(options: { mode?: Mode; pages?: string[][]; focused?: boolean; blocked?: boolean; confidence?: number; separated?: boolean } = {}) {
  let mode = options.mode ?? 'zh'; let text = ''; let composition = ''; let page = 0;
  const commands: string[] = []; const field = { x: .1, y: .2, width: .3, height: .08 };
  const read = async (): Promise<ImeScene> => ({ focused: options.focused ?? true, field, text, composition: options.separated ? composition.replace(/(.{5})(?=.)/g, "$1'") : composition, candidates: composition ? (options.pages?.[page] ?? [composition]).map((value, i) => ({ key: String(i + 1), text: value })) : [], confidence: options.confidence ?? 1, blocked: options.blocked ?? false });
  const select = (value: string) => { const candidate = options.pages?.[page]?.[Number(value) - 1] ?? composition; if (!candidate) throw new Error('bad candidate'); text += candidate; composition = ''; page = 0; };
  const command = async (frame: string) => { commands.push(frame); const [kind, value] = frame.split('\t'); if (kind === 'text') { if (mode === 'zh' && /^[a-z]$/.test(value)) composition += value; else if (mode === 'zh' && /^[1-9]$/.test(value) && composition) select(value); else text += (mode === 'zh' ? ({ '!': '！', ',': '，', '.': '。', '?': '？' }[value] ?? value) : value); return; } if (value === 'shift') { mode = mode === 'zh' ? 'en' : 'zh'; return; } if (value === 'escape') { composition = ''; page = 0; return; } if (value === 'backspace') { text = text.slice(0, -1); return; } if (value === 'pagedown') { page++; return; } if (/^[1-9]$/.test(value)) throw new Error('protocol rejects key-number'); };
  return { read, command, commands, text: () => text, mode: () => mode, field };
}

test('中文逐键输入，只选择精确匹配的非首候选', async () => {
  const ime = fake({ pages: [['重', '重庆']] });
  await typeWithPinyin('重庆', { ...ime, check: async () => {} });
  assert.equal(ime.text(), '重庆');
  assert.ok(ime.commands.includes('text\t2'));
  assert.ok(!ime.commands.some(value => value.includes('paste') || value.includes('enter')));
});

test('找词时翻页，最多使用候选数字键', async () => {
  const ime = fake({ pages: [['虫庆'], ['重庆']] });
  await typeWithPinyin('重庆', { ...ime, check: async () => {} });
  assert.ok(ime.commands.includes('key\tpagedown'));
  assert.ok(ime.commands.includes('text\t1'));
});

test('兼容带分隔符的拼音、第三位候选和长 ASCII 前缀', async () => {
  const ime = fake({ mode: 'en', separated: true, pages: [['虫庆', '重情', '重庆']] });
  await typeWithPinyin('abc12重庆', { ...ime, check: async () => {} });
  assert.equal(ime.text(), 'abc12重庆');
  assert.ok(ime.commands.includes('text\t3'));
});

test('候选重复、六页后仍无精确候选和实质输入框变化均停止', async () => {
  const repeated = fake({ pages: [['虫庆'], ['虫庆']] });
  await assert.rejects(() => typeWithPinyin('重庆', { ...repeated, check: async () => {} }), /重复/);
  const pages = fake({ pages: Array.from({ length: 6 }, (_, index) => [`候选${index}`]) });
  await assert.rejects(() => typeWithPinyin('重庆', { ...pages, check: async () => {} }), /找不到/);
  const moved = fake(); let reads = 0;
  const read = async () => { const scene = await moved.read(); return ++reads > 1 ? { ...scene, field: { ...scene.field, x: .2 } } : scene; };
  await assert.rejects(() => typeWithPinyin('a', { read, command: moved.command, check: async () => {} }), /范围已变化/);
});

test('英文状态能打 ASCII，并在混合文本时切换回中文', async () => {
  const ime = fake({ mode: 'en', pages: [['重庆']] });
  await typeWithPinyin('hi, 重庆！', { ...ime, check: async () => {} });
  assert.equal(ime.text(), 'hi, 重庆！');
  assert.ok(ime.commands.includes('key\tshift'));
  assert.equal(ime.mode(), 'en');
});

test('成功后恢复探测到的初始输入法，候选选择前取消不按数字', async () => {
  const chineseStart = fake({ pages: [['重庆']] });
  await typeWithPinyin('重庆a', { ...chineseStart, check: async () => {} });
  assert.equal(chineseStart.mode(), 'zh');
  const controller = new AbortController(); const ime = fake({ pages: [['重庆']] });
  const read = async () => { const scene = await ime.read(); if (scene.candidates.some(item => item.text === '重庆')) controller.abort(); return scene; };
  await assert.rejects(() => typeWithPinyin('重庆', { read, command: ime.command, check: async () => {}, signal: controller.signal, delay: async () => {} }), /取消/);
  assert.ok(!ime.commands.includes('text\t1'));
  assert.ok(!ime.commands.some(value => /send|enter/u.test(value)));
});

test('候选缺失、视觉读取或单键传输失败后均不发送消息且不再发键', async () => {
  const forbidden = (commands: string[]) => assert.ok(!commands.some(value => /send|enter|paste/u.test(value)));
  const missing = fake({ pages: [['虫庆']] });
  await assert.rejects(() => typeWithPinyin('重庆', { ...missing, check: async () => {}, delay: async () => {} }), /候选/);
  const missingCount = missing.commands.length; await new Promise(resolve => setImmediate(resolve));
  assert.equal(missing.commands.length, missingCount); forbidden(missing.commands);
  const readFailure = fake(); let reads = 0;
  await assert.rejects(() => typeWithPinyin('a', { read: async () => { if (++reads === 2) throw new Error('model read failed'); return readFailure.read(); }, command: readFailure.command, check: async () => {}, delay: async () => {} }), /model read failed/);
  const readCount = readFailure.commands.length; await new Promise(resolve => setImmediate(resolve));
  assert.equal(readFailure.commands.length, readCount); forbidden(readFailure.commands);
  const commandFailure = fake();
  await assert.rejects(() => typeWithPinyin('a', { read: commandFailure.read, command: async frame => { if (frame === 'text\ta') throw new Error('wire failed'); await commandFailure.command(frame); }, check: async () => {}, delay: async () => {} }), /wire failed/);
  assert.equal(commandFailure.commands.length, 0); forbidden(commandFailure.commands);
});

test('候选窗被裁切为 blocked 时，在输入前停止', async () => {
  const ime = fake({ pages: [['重庆']] });
  const read = async () => { const scene = await ime.read(); return scene.composition ? { ...scene, blocked: true } : scene; };
  await assert.rejects(() => typeWithPinyin('重庆', { read, command: ime.command, check: async () => {}, delay: async () => {} }), /视觉/);
  assert.ok(!ime.commands.some(value => /send|enter|paste/u.test(value)));
});

test('没有精确候选、视觉不确定、人工草稿或焦点变化都会停止', async () => {
  const missing = fake({ pages: [['虫庆']] });
  await assert.rejects(() => typeWithPinyin('重庆', { ...missing, check: async () => {} }), /候选/);
  const uncertain = fake({ confidence: .94 });
  await assert.rejects(() => typeWithPinyin('x', { ...uncertain, check: async () => {} }), /视觉/);
  const draft = fake(); draft.command = async () => { throw new Error('不应发键'); };
  const read = async () => ({ ...(await draft.read()), text: '人工草稿' });
  await assert.rejects(() => typeWithPinyin('x', { read, command: draft.command, check: async () => {} }), /空白/);
});

test('英文状态无法切出中文输入法会清理探针并报人工处理', async () => {
  const ime = fake({ mode: 'en' });
  const command = async (frame: string) => { if (frame === 'key\tshift') return; await ime.command(frame); };
  await assert.rejects(() => typeWithPinyin('中', { read: ime.read, command, check: async () => {} }), /中文全拼/);
  assert.equal(ime.text(), '');
});

test('拒绝换行和 emoji，等待期间取消后不再发键', async () => {
  const ime = fake();
  await assert.rejects(() => typeWithPinyin('a\nb', { ...ime, check: async () => {} }), /换行/);
  await assert.rejects(() => typeWithPinyin('🙂', { ...ime, check: async () => {} }), /不支持/);
  const controller = new AbortController(); let release!: () => void; const delay = () => new Promise<void>(resolve => { release = resolve; });
  const pending = typeWithPinyin('ab', { ...ime, check: async () => {}, signal: controller.signal, delay });
  await new Promise(resolve => setImmediate(resolve)); controller.abort(); release();
  await assert.rejects(() => pending, /取消/);
  assert.equal(ime.commands.filter(value => value.startsWith('text\t')).length, 3);
});
