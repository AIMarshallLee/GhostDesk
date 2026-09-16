import assert from 'node:assert/strict';
import { app } from 'electron';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createWindowsComputerUseDriver } from './cu-windows.ts';
import { createDesktopRepliesFixture } from './replies-fixture.ts';

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** Uses real PrintWindow and SendInput only against the app-owned fictional fixture. */
export async function runDesktopRepliesNativeSmoke(scriptPath: string) {
  if (process.platform !== 'win32') throw new Error('Desktop replies native smoke requires Windows.');
  const fixture = await createDesktopRepliesFixture(false);
  const aborter = new AbortController();
  try {
    await fixture.driver.activate(); await wait(250);
    const stage = async (label: string) => {
      const result = await fixture.result();
      console.log(`Native fixture ${label}: ${JSON.stringify({ dom: await fixture.diagnostic(), activeConversation: result.activeConversationName, sent: result.sent.length, composers: result.conversations.map(item => [item.name, item.composer]) })}`);
    };
    await stage('fixture-activated');
    const driver = await createWindowsComputerUseDriver(fixture.nativeTarget(), scriptPath, aborter.signal, true);
    const capture = await driver.observe();
    const png = Buffer.from(capture.base64, 'base64');
    const diagnostic = join(app.getPath('userData'), 'native-fixture.png');
    await writeFile(diagnostic, png); console.log(`Native fixture capture: ${capture.width}x${capture.height} ${diagnostic}`);
    assert.ok(capture.width > 100 && capture.height > 100, 'PrintWindow must return physical fixture dimensions');
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], 'native capture must be PNG');
    await fixture.driver.activate();
    await stage('before-native-activate');
    await driver.activate(); await driver.check(); await stage('native-activated');
    // Composer and send stay separate; no Enter key is used.
    await driver.execute({ kind: 'click', x: .605, y: .80, button: 'left', count: 1 }); await driver.check(); await stage('first-composer-click');
    await driver.execute({ kind: 'type', text: '第一条虚构中文回复' }); await driver.check(); await stage('first-typed');
    await driver.execute({ kind: 'click', x: .88, y: .92, button: 'left', count: 1 }); await wait(250); await stage('first-send-click');
    let result = await fixture.result();
    if (!result.sent.length) console.log(`Native fixture diagnostic: ${JSON.stringify(result)}`);
    assert.equal(result.sent.length, 1, 'first fictional conversation must send exactly once');
    assert.deepEqual(result.sent[0] && [result.sent[0].conversation, result.sent[0].text], ['林小雨', '第一条虚构中文回复']);
    // The second calibrated row is still inside the application-owned sidebar.
    await driver.check(); await driver.execute({ kind: 'click', x: .12, y: .315, button: 'left', count: 1 }); await wait(120); await stage('second-conversation-click');
    await driver.check(); await driver.execute({ kind: 'click', x: .605, y: .80, button: 'left', count: 1 }); await driver.check(); await stage('second-composer-click');
    await driver.execute({ kind: 'type', text: '第二条虚构中文回复' }); await driver.check(); await stage('second-typed');
    await driver.execute({ kind: 'click', x: .88, y: .92, button: 'left', count: 1 }); await wait(250); await stage('second-send-click');
    result = await fixture.result();
    assert.equal(result.sent.length, 2, 'second fixture conversation must add one, not duplicate the first');
    assert.deepEqual(result.sent.map(item => [item.conversation, item.text]), [['林小雨', '第一条虚构中文回复'], ['陈先生', '第二条虚构中文回复']]);
    assert.equal(result.conversations.find(item => item.name === '林小雨')?.composer, '');
    assert.equal(result.conversations.find(item => item.name === '陈先生')?.composer, '');
    console.log(`FlowDesk desktop replies native smoke passed. PrintWindow ${capture.width}x${capture.height}; two isolated fictional sends.`);
  } finally { aborter.abort(); }
  // Keep the fixture alive until the Electron smoke owner calls app.exit().
}
