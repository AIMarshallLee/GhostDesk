import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createComputerUseController } from './computer-use';
import { createComputerUseFixture } from './cu-fixture';
import { runUsbRepliesSmoke } from './usb-smoke';

/** Official SDK over loopback, rendered app-owned windows and virtual USB only. */
export async function runGeminiSmoke() {
  await runUsbRepliesSmoke(false, true);
  const fixture = await createComputerUseFixture(true);
  let requests = 0, screenshots = 0, confirmations = 0, writes = 0;
  let failure: unknown;
  const captures: string[] = [];
  const call = (id: string, name: string, args: Record<string, unknown>) => ({ type: 'function_call', id, name, arguments: { intent: '仅在虚构窗口执行', ...args } });
  const thought = { type: 'thought', signature: 'fictional-native-signature' };
  const submit = call('submit', 'click', { x: 840, y: 730, safety_decision: { decision: 'require_confirmation', explanation: '确认向虚构测试窗口提交测试回复' } });
  const predictions = [
    { status: 'requires_action', steps: [thought, call('focus', 'click', { x: 400, y: 500 })] },
    { status: 'requires_action', steps: [call('type', 'type', { text: '收到测试消息。', press_enter: false })] },
    { status: 'requires_action', steps: [submit] },
    { status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: '虚构回复已提交' }] }] },
    { status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: '手动复制测试草稿' }] }] },
  ];
  const provider = createServer(async (request, response) => {
    try {
      assert.equal(request.url, '/v1beta/interactions');
      assert.equal(request.headers['x-goog-api-key'], 'fictional-native-key');
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString());
      assert.equal(body.store, false); assert.equal(body.tools[0].environment, 'desktop');
      assert.equal(body.tools[0].enable_prompt_injection_detection, true);
      const images = body.input.flatMap((step: any) => step.content ?? step.result ?? []).filter((part: any) => part.type === 'image');
      assert.ok(images.length);
      for (const image of images) {
        assert.equal(image.mime_type, 'image/png');
        assert.ok(Buffer.from(image.data, 'base64').subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));
        screenshots++;
      }
      if (requests > 0 && requests < 4) assert.deepEqual(body.input[1], thought);
      if (requests === 3) {
        const result = body.input.find((step: any) => step.type === 'function_result' && step.call_id === 'submit');
        assert.equal(JSON.parse(result.result[0].text).safety_acknowledgement, true);
        assert.equal(confirmations, 1);
      }
      assert.ok(predictions[requests], 'unexpected model retry');
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ id: `native-fixture-${requests}`, ...predictions[requests++] }));
    } catch (error) { failure = error; response.writeHead(400).end(); }
  });
  await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve));
  const controller = createComputerUseController({
    getCredentials: async () => ({ baseUrl: `http://127.0.0.1:${(provider.address() as AddressInfo).port}`, model: 'gemini-fixture', apiKey: 'fictional-native-key', modelFamily: 'gemini' }),
    createDriver: async () => ({ ...fixture.driver,
      observe: async () => { const image = await fixture.driver.observe(); captures.push(image.base64); return image; },
      execute: async action => { writes++; await fixture.driver.execute(action); } }),
    getKnowledge: async () => '仅回复虚构测试消息',
  });
  // Approval is supplied exclusively by this fictional smoke, never by production IPC.
  const approval = setInterval(() => {
    const pending = controller.state().pendingConfirmation;
    if (!pending) return;
    try {
      assert.equal(pending.actions.length, 1); assert.match(pending.actions[0], /左键点击/);
      confirmations++; controller.confirm({ id: pending.id, approved: true });
    } catch (error) { failure = error; controller.stop(); }
  }, 20);
  try {
    await controller.start({ targetId: fixture.driver.target.id, instruction: '回复收到测试消息。并在虚构窗口提交', mode: 'auto', maxSteps: 8, allowModel: true, knowledgeIds: [] });
    await controller.waitForIdle();
    if (failure) throw failure;
    assert.equal(controller.state().status, 'completed', JSON.stringify(controller.state()));
    assert.deepEqual(await fixture.result(), { count: 1, reply: '收到测试消息。' });
    assert.equal(writes, 3); assert.equal(confirmations, 1); assert.equal(requests, 4);
    await controller.start({ targetId: fixture.driver.target.id, instruction: '生成可复制测试草稿', mode: 'manual', maxSteps: 8, allowModel: true, knowledgeIds: [] });
    await controller.waitForIdle();
    if (failure) throw failure;
    assert.equal(controller.state().status, 'completed'); assert.equal(controller.state().draft, '手动复制测试草稿');
    assert.equal(writes, 3); assert.equal(requests, 5);
    assert.equal((await fixture.result()).count, 1);
    console.log(`FlowDesk Gemini native smoke passed. ${JSON.stringify({ requests, screenshots, confirmations, writes, fictionalSends: 1, manualWrites: 0, nativeImeVirtualUsb: true })}`);
  } catch (error) {
    if (process.env.FLOWDESK_SMOKE_DIR) {
      for (let i = 0; i < captures.length; i++) await writeFile(join(process.env.FLOWDESK_SMOKE_DIR, `gemini-fixture-${i}.png`), Buffer.from(captures[i], 'base64'));
      console.error(`Fictional capture diagnostics: ${process.env.FLOWDESK_SMOKE_DIR}`);
    }
    throw error;
  } finally {
    clearInterval(approval); controller.stop(); await controller.waitForIdle(); fixture.close();
    provider.closeAllConnections(); await new Promise<void>(resolve => provider.close(() => resolve()));
  }
}
