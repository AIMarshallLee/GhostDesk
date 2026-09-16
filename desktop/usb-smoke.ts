import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createUsbChannel } from './usb-channel';
import { createUsbDevice } from './usb-device';
import { createUsbInputDriver } from './usb-input';
import { typeWithPinyin } from './ime-typing';
import { createGeminiImeReader } from './gemini-client';
import { createReplyModel } from './reply-model';
import { runDesktopRepliesSmoke } from './replies-smoke';
import { runDesktopRepliesSoak } from './replies-soak';
import type { DesktopRepliesFixture } from './replies-fixture';

/** No COM port, system clipboard, native SendInput or external account is used by this test. */
export async function runUsbRepliesSmoke(soak = false, gemini = false, nativePersistent = false) {
  let armed = false, session = '', leaseUntil = 0, lastId = 0;
  let x = 30, y = 30;
  let fixture: DesktopRepliesFixture | undefined;
  const styles = ['microsoft', 'wechat', 'sogou', 'baidu'] as const;
  const testedStyles = new Set<string>();
  let typingRuns = 0;
  const counts = { commands: 0, moves: 0, clicks: 0, keyCharacters: 0, imeKeys: 0, imeScreenshots: 0, pings: 0, disarms: 0, sessions: 0 };
  let imeFailure: Error | undefined;
  const imeProvider = createServer(async (request, response) => {
    try {
      assert.equal(request.method, 'POST'); assert.equal(request.url, gemini ? '/v1beta/interactions' : '/v1/chat/completions');
      const chunks: Buffer[] = []; let bytes = 0;
      for await (const chunk of request) { bytes += chunk.length; if (bytes > 2_000_000) throw new Error('IME request too large'); chunks.push(Buffer.from(chunk)); }
      const body = JSON.parse(Buffer.concat(chunks).toString());
      assert.ok(fixture); counts.imeScreenshots++;
      const observed = await fixture.imeScene();
      response.writeHead(200, { 'content-type': 'application/json' });
      if (gemini) {
        assert.equal(body.model, 'gemini-ime-loopback'); assert.equal(body.store, false);
        assert.ok(body.system_instruction.includes('FLOWDESK_IME_SCENE'));
        const image = body.input[0]?.content?.find((item: any) => item.type === 'image');
        assert.equal(image?.mime_type, 'image/png'); assert.ok(typeof image?.data === 'string');
        assert.ok(Buffer.from(image.data, 'base64').subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])));
        response.end(JSON.stringify({ id: 'gemini-ime-loopback', status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: JSON.stringify(observed) }] }] }));
      } else {
        assert.equal(body.model, 'flowdesk-ime-loopback');
        assert.ok(body.messages[0].content.startsWith('FLOWDESK_IME_SCENE'));
        const url = body.messages[1].content.find((item: any) => item.type === 'image_url')?.image_url?.url;
        assert.ok(typeof url === 'string' && url.startsWith('data:image/png;base64,'));
        assert.ok(Buffer.from(url.slice(22), 'base64').subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])));
        response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(observed) } }] }));
      }
    } catch (error) { imeFailure = error instanceof Error ? error : new Error('IME loopback failed'); response.writeHead(400).end(); }
  });
  await new Promise<void>(resolve => imeProvider.listen(0, '127.0.0.1', resolve));
  const imeBaseUrl = `http://127.0.0.1:${(imeProvider.address() as AddressInfo).port}`;
  const readIme = gemini
    ? createGeminiImeReader({ baseUrl: imeBaseUrl, model: 'gemini-ime-loopback', apiKey: 'fictional-loopback-key' })
    : createReplyModel({ baseUrl: `${imeBaseUrl}/v1`, model: 'flowdesk-ime-loopback' }).readIme;
  const device = createUsbDevice('unused-virtual-device', { channel: () => createUsbChannel('unused-virtual-device', 'COM9999', undefined, { transport: {
    close() {},
    async request(request) {
      const [idText, operation, token, arg1, arg2] = request.frame.split('\t'); const id = Number(idText);
      counts.commands++;
      if (session && Date.now() >= leaseUntil) { session = ''; armed = false; }
      if (operation === 'disarm') { counts.disarms++; session = ''; armed = false; }
      else if (operation === 'begin') { assert.ok(!armed && !session); assert.match(token, /^[0-9a-f]{16}$/); armed = true; session = token; leaseUntil = Date.now() + 10000; lastId = 0; counts.sessions++; }
      else if (operation === 'ping') { assert.equal(token, session); assert.ok(armed && session); leaseUntil = Date.now() + 10000; counts.pings++; }
      else if (!['status', 'hello'].includes(operation)) {
        assert.equal(token, session); assert.ok(armed && session); assert.ok(id > lastId); lastId = id;
        assert.ok(fixture, 'fixture must exist before any HID report');
        if (operation === 'move') { x += Math.round(Number(arg1) * 1.5); y += Math.round(Number(arg2) * 1.5); counts.moves++; }
        else if (operation === 'click') { counts.clicks++; await fixture.driver.execute({ kind: 'click', x: x / 999, y: y / 699, button: arg1 as 'left', count: 1 }); }
        else if (operation === 'wheel') await fixture.driver.execute({ kind: 'scroll', x: x / 999, y: y / 699, direction: Number(arg1) > 0 ? 'up' : 'down', amount: Math.abs(Number(arg1)) });
        else if (operation === 'text' || operation === 'key') {
          if (operation === 'text') { assert.equal(arg1.length, 1); counts.keyCharacters++; } else counts.imeKeys++;
          await fixture.imeKey(`${operation}\t${arg1}`);
        } else throw new Error(`Unexpected simulated HID operation: ${operation}`);
      }
      return { id, ok: true, protocol: 4, device: 'FlowDesk USB Bridge', firmware: '0.5.0', board: 'pico', armed, session, leaseMs: session ? Math.max(0, leaseUntil - Date.now()) : 0 };
    },
  } }) });
  await device.connect('COM9999');
  const driverFactory = async (target: DesktopRepliesFixture, signal: AbortSignal, nativeReadIme?: typeof readIme) => {
    fixture = target;
    return createUsbInputDriver({ signal, observer: { ...target.driver, async pointer(px, py) { return { x, y, targetX: Math.floor(px * 999), targetY: Math.floor(py * 699), inside: true }; } },
      begin: async () => { await device.disarm(); return device.begin(signal); },
      delay: async () => {},
      typeText: async (text, command, check) => {
        const style = styles[typingRuns++ % styles.length];
        await target.setImeStyle(style); testedStyles.add(style);
        try { await typeWithPinyin(text, { command, check, signal, delay: async () => {}, read: async () => { const value = await (nativeReadIme ?? readIme)(await target.driver.observe(), signal); if (nativeReadIme) counts.imeScreenshots++; return value; } }); }
        catch (error) { console.error('Fictional IME typing failed:', error); throw error; }
      },
    });
  };
  try {
    const report = soak ? await runDesktopRepliesSoak(300, driverFactory) : await runDesktopRepliesSmoke(driverFactory, nativePersistent);
    await device.disarm();
    if (imeFailure) throw imeFailure;
    assert.ok(counts.moves > 0 && counts.clicks > 0 && counts.keyCharacters > 20 && counts.imeScreenshots > 10 && counts.pings > 0 && counts.disarms > 0);
    assert.equal(armed, false); assert.equal(session, '');
    assert.equal(testedStyles.size, 4);
    console.log(`FlowDesk USB replies ${soak ? 'soak' : 'smoke'} passed. ${JSON.stringify({ ...counts, simulatedImeStyles: [...testedStyles], imeProvider: gemini ? 'gemini-native-loopback' : 'openai-loopback', model: report, io: 'virtual USB and rendered fictional IME; no clipboard; app-owned window only' })}`);
  } finally { await device.disconnect(); imeProvider.closeAllConnections(); await new Promise<void>(resolve => imeProvider.close(() => resolve())); }
}
