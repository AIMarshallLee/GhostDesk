import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createComputerUseController } from './computer-use.ts';
import { createComputerUseFixture } from './cu-fixture.ts';

/** Packaged runtime acceptance: only our fictional window and loopback model stub. */
export async function runComputerUseSmoke() {
  const fixture = await createComputerUseFixture(true);
  const initialCapture = await fixture.driver.observe();
  console.log(`CU fixture capture ready: ${initialCapture.width}x${initialCapture.height}; ${initialCapture.base64.length} base64 bytes.`);
  // UI-TARS 1.5 uses pixel coordinates on its 28-pixel-aligned model canvas.
  const modelWidth = Math.round(initialCapture.width / 28) * 28;
  const modelHeight = Math.round(initialCapture.height / 28) * 28;
  const predictions = [
    `Thought: Focus the reply box.\nAction: click(start_box='(${Math.round(modelWidth * .4)}, ${Math.round(modelHeight * .5)})')`,
    "Thought: Enter the fictional reply.\nAction: type(content='收到测试消息。')",
    `Thought: Send in the fictional test window.\nAction: click(start_box='(${Math.round(modelWidth * .84)}, ${Math.round(modelHeight * .73)})')`,
    "Thought: The test is complete.\nAction: finished()",
  ];
  let requests = 0;
  let screenshots = 0;
  let observations = 0;
  const provider = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    assert.equal(req.url, '/v1/chat/completions');
    assert.equal(body.model, 'flowdesk-loopback-fixture');
    const images = body.messages.flatMap((message: any) => Array.isArray(message.content) ? message.content : []).filter((part: any) => part.type === 'image_url');
    assert.ok(images.length > 0, 'SDK must send actual fixture screenshots');
    screenshots += images.length;
    const content = predictions[requests++] ?? 'Action: call_user()';
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: `fixture-${requests}`, object: 'chat.completion', created: 0, model: body.model, choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
  });
  await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve));
  const port = (provider.address() as AddressInfo).port;
  const controller = createComputerUseController({
    getCredentials: async () => ({ baseUrl: `http://127.0.0.1:${port}/v1`, model: 'flowdesk-loopback-fixture', modelFamily: 'ui-tars', apiKey: 'local-fixture-only' }),
    createDriver: async () => ({ ...fixture.driver, observe: async () => { observations++; return fixture.driver.observe(); } }),
    getKnowledge: async () => '',
  });
  try {
    await controller.start({ targetId: fixture.driver.target.id, instruction: '在当前虚构测试窗口回复收到测试消息。并点击发送测试回复。', mode: 'auto', maxSteps: 8, allowModel: true, knowledgeIds: [] });
    await controller.waitForIdle();
    const state = controller.state();
    assert.equal(state.status, 'completed', `${state.message}; observations=${observations}; requests=${requests}; steps=${JSON.stringify(state.steps)}`);
    assert.equal(requests, 4);
    const result = await fixture.result();
    assert.deepEqual(result, { count: 1, reply: '收到测试消息。' });
    assert.equal(state.steps.filter(step => step.outcome === 'executed').length, 3);
    console.log(`FlowDesk Computer Use SDK smoke passed. ${requests} loopback model calls; ${screenshots} screenshot attachments; 3 GUI actions; exactly 1 fictional send.`);
  } finally {
    controller.stop();
    provider.closeAllConnections();
    await new Promise<void>(resolve => provider.close(() => resolve()));
    // Main exits immediately after this check; keep fixture alive until then.
  }
}
