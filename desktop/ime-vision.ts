import type { ImeScene } from '../shared/ime';

function json(raw: string): unknown {
  return JSON.parse(raw.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, ''));
}

function boundedText(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length <= maximum;
}

export function parseImeScene(raw: string): ImeScene {
  const value = json(raw) as Record<string, unknown>;
  const field = value?.field as Record<string, unknown> | undefined;
  if (!value || typeof value.focused !== 'boolean' || typeof value.blocked !== 'boolean'
    || !field || !boundedText(value.text, 4096) || !boundedText(value.composition, 256)
    || !Array.isArray(value.candidates) || value.candidates.length > 9
    || !Number.isFinite(value.confidence) || (value.confidence as number) < 0 || (value.confidence as number) > 1) throw new Error('无法可靠识别输入法状态。');
  const rect = { x: field.x, y: field.y, width: field.width, height: field.height };
  if (!Object.values(rect).every(Number.isFinite) || (rect.x as number) < 0 || (rect.y as number) < 0
    || (rect.width as number) <= 0 || (rect.height as number) <= 0
    || (rect.x as number) + (rect.width as number) > 1 || (rect.y as number) + (rect.height as number) > 1) throw new Error('输入框位置无效。');
  const keys = new Set<string>();
  const candidates = value.candidates.map((item) => {
    const candidate = item as Record<string, unknown> | undefined;
    if (!candidate || !boundedText(candidate.key, 1) || !/^[1-9]$/.test(candidate.key)
      || !boundedText(candidate.text, 256) || !candidate.text.trim() || keys.has(candidate.key)) throw new Error('输入法候选词无效。');
    keys.add(candidate.key); return { key: candidate.key, text: candidate.text };
  });
  if (candidates.reduce((total, candidate) => total + candidate.text.length, 0) > 2048) throw new Error('输入法候选词过长。');
  if (value.composition && candidates.length === 0 && !value.blocked) throw new Error('输入法候选页不完整。');
  return { focused: value.focused, field: rect as ImeScene['field'], text: value.text, composition: value.composition, candidates, confidence: value.confidence as number, blocked: value.blocked };
}
