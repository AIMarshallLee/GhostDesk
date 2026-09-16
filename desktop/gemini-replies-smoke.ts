import { runUsbRepliesSmoke } from './usb-smoke';

/** Rendered FlowDesk-only fixture, native loopback SDK, virtual Pico channel and full-pinyin IME. */
export async function runGeminiRepliesSmoke() { await runUsbRepliesSmoke(false, true, true); console.log('FlowDesk Gemini persistent replies smoke passed.'); }
