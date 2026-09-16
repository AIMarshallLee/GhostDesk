import { pinyin } from 'pinyin-pro';
import type { ImeScene } from '../shared/ime.ts';

export type ImeTypingOptions = {
  read(): Promise<ImeScene>;
  command(frame: string): Promise<void>;
  check(): Promise<void>;
  signal?: AbortSignal;
  delay?: (ms: number) => Promise<void>;
};

type Field = ImeScene['field'];
type Mode = 'zh' | 'en';
const chinese = /[\u3400-\u9fff]/u;
const ascii = /^[\x20-\x7e]$/;
const punctuation: Record<string, string> = { '，': ',', '。': '.', '！': '!', '？': '?', '：': ':', '；': ';', '（': '(', '）': ')', '“': '"', '”': '"', '‘': "'", '’': "'", '、': '\\', '《': '<', '》': '>' };

function validField(field: Field) { return [field.x, field.y, field.width, field.height].every(value => Number.isFinite(value) && value >= 0 && value <= 1) && field.width > 0 && field.height > 0 && field.x + field.width <= 1 && field.y + field.height <= 1; }
function sameField(a: Field, b: Field) { return [a.x - b.x, a.y - b.y, a.x + a.width - b.x - b.width, a.y + a.height - b.y - b.height].every(value => Math.abs(value) <= .003); }
function normalizedComposition(value: string) { return value.toLowerCase().replace(/[\s']/gu, '').replace(/ü/gu, 'v'); }
function cancelled(signal?: AbortSignal) { if (signal?.aborted) throw new Error('输入已取消或暂停。'); }
function allowed(text: string) {
  if (/\r|\n/u.test(text)) throw new Error('逐键输入不支持换行，不能发送 Enter。');
  for (const char of text) if (!chinese.test(char) && !ascii.test(char) && !(char in punctuation)) throw new Error(`不支持字符：${char}`);
}

export async function typeWithPinyin(original: string, options: ImeTypingOptions): Promise<void> {
  allowed(original); if (!original) return;
  let field: Field | undefined; let prefix = ''; let mode: Mode;
  const verify = async (expected: string | null = prefix, composition?: string) => {
    cancelled(options.signal); await options.check(); cancelled(options.signal);
    const scene = await options.read(); cancelled(options.signal); await options.check(); cancelled(options.signal);
    if (!scene.focused || scene.blocked || scene.confidence < .95) throw new Error('视觉状态不确定、被遮挡或焦点已丢失，已停止输入。');
    if (!validField(scene.field)) throw new Error('输入框范围不符合归一化视觉契约，已停止输入。');
    if (!field) field = scene.field; else if (!sameField(field, scene.field)) throw new Error('输入框范围已变化，已停止输入。');
    if (expected !== null && scene.text !== expected) throw new Error(expected ? '输入框内容与已确认前缀不一致，已停止输入。' : '起始输入框不是确定的空白草稿，已停止输入。');
    if (composition !== undefined && normalizedComposition(scene.composition) !== normalizedComposition(composition)) throw new Error('拼音组合状态不确定，已停止输入。');
    return scene;
  };
  const send = async (frame: string) => { cancelled(options.signal); await options.check(); cancelled(options.signal); await options.command(frame); cancelled(options.signal); await options.check(); cancelled(options.signal); };
  const pause = async (ms: number) => {
    cancelled(options.signal); await options.check(); cancelled(options.signal);
    if (!options.delay) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(done, ms);
        const abort = () => { clearTimeout(timer); done(new Error('输入已取消或暂停。')); };
        function done(error?: Error) { options.signal?.removeEventListener('abort', abort); error ? reject(error) : resolve(); }
        options.signal?.addEventListener('abort', abort, { once: true });
      });
      cancelled(options.signal); await options.check(); cancelled(options.signal); return;
    }
    const wait = options.delay;
    if (options.signal) {
      let abort!: () => void;
      const stopped = new Promise<never>((_, reject) => { abort = () => reject(new Error('输入已取消或暂停。')); options.signal!.addEventListener('abort', abort, { once: true }); });
      try { await Promise.race([wait(ms), stopped]); } finally { options.signal.removeEventListener('abort', abort); }
    } else await wait(ms);
    cancelled(options.signal); await options.check(); cancelled(options.signal);
  };
  const probe = async (): Promise<Mode> => {
    await verify(prefix, ''); await send('text\ta'); const scene = await verify(null);
    if (scene.text === prefix && scene.composition === 'a') { await send('key\tescape'); await verify(prefix, ''); return 'zh'; }
    if (scene.text === `${prefix}a` && scene.composition === '') { await send('key\tbackspace'); await verify(prefix, ''); return 'en'; }
    throw new Error('输入法探针结果不确定，已停止输入。');
  };
  await verify('', ''); mode = await probe(); const initialMode = mode;
  const chineseRequired = [...original].some(char => chinese.test(char) || char in punctuation);
  const ensureChinese = async () => {
    if (mode === 'zh') return;
    await send('key\tshift'); mode = await probe();
    if (mode !== 'zh') throw new Error('未检测到中文全拼输入法，请人工启用后再继续。');
  };
  const ensureEnglish = async () => { if (mode === 'en') return; await send('key\tshift'); mode = await probe(); if (mode !== 'en') throw new Error('无法切换到英文输入状态，已停止输入。'); };
  if (chineseRequired) await ensureChinese();

  const chars = [...original]; const readings = pinyin(original, { toneType: 'none', type: 'array' });
  if (readings.length !== chars.length) throw new Error('拼音库未返回逐字读音，已停止输入。');
  const segments = new Intl.Segmenter('zh-CN', { granularity: 'word' }).segment(original);
  for (const segment of segments) {
    const word = segment.segment;
    if ([...word].every(char => chinese.test(char))) {
      for (let offset = 0; offset < word.length; offset += 4) {
        const expected = word.slice(offset, offset + 4); const start = [...original.slice(0, segment.index + offset)].length;
        const spelling = readings.slice(start, start + [...expected].length).join('').replace(/ü/g, 'v');
        await ensureChinese();
        for (const letter of spelling) { await send(`text\t${letter}`); await pause(80); }
        let scene = await verify(prefix, spelling); let seen = new Set<string>(); let found: string | undefined;
        for (let page = 0; page < 6; page++) {
          const signature = JSON.stringify(scene.candidates);
          if (!scene.candidates.length || seen.has(signature)) throw new Error('候选词页面不确定或重复，已停止输入。'); seen.add(signature);
          const candidate = scene.candidates.find(item => item.text === expected && /^[1-9]$/.test(item.key));
          if (candidate) { found = candidate.key; break; }
          if (page === 5) break;
          await send('key\tpagedown'); scene = await verify(prefix, spelling);
        }
        if (!found) throw new Error(`找不到精确候选词“${expected}”，请人工处理。`);
        await send(`text\t${found}`); prefix += expected; await verify(prefix, ''); await pause(80);
      }
      continue;
    }
    for (const char of word) {
      const mapped = punctuation[char];
      if (mapped) { await ensureChinese(); await send(`text\t${mapped}`); prefix += char; await verify(prefix, ''); await pause(/[。！？]/u.test(char) ? 160 : 80); continue; }
      await ensureEnglish(); await send(`text\t${char}`); prefix += char; await verify(prefix, ''); await pause(45);
    }
  }
  await verify(original, '');
  if (mode !== initialMode) { await send('key\tshift'); mode = await probe(); if (mode !== initialMode) throw new Error('无法恢复初始输入法状态，已停止输入。'); }
  await verify(original, '');
}
