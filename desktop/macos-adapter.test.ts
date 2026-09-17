import test from 'node:test';
import assert from 'node:assert/strict';
import { isMacOS, translateKeyToMac, getMacOSAppActivateScript, listMacOSUsbSerialPorts, executeAppleScript } from './macos-adapter';

test('isMacOS accurately reflects current process platform', () => {
  assert.equal(isMacOS(), process.platform === 'darwin');
});

test('translateKeyToMac maps Windows keys to Mac equivalents', () => {
  assert.equal(translateKeyToMac('ctrl'), 'command');
  assert.equal(translateKeyToMac('Control'), 'command');
  assert.equal(translateKeyToMac('alt'), 'option');
  assert.equal(translateKeyToMac('win'), 'command');
  assert.equal(translateKeyToMac('enter'), 'return');
  assert.equal(translateKeyToMac('backspace'), 'delete');
  assert.equal(translateKeyToMac('shift'), 'shift');
  assert.equal(translateKeyToMac('c'), 'c');
});

test('getMacOSAppActivateScript formats clean AppleScript', () => {
  assert.equal(getMacOSAppActivateScript('WeChat'), 'tell application "WeChat" to activate');
  assert.equal(getMacOSAppActivateScript('WeChat.app'), 'tell application "WeChat" to activate');
  assert.equal(getMacOSAppActivateScript('Google Chrome.app'), 'tell application "Google Chrome" to activate');
  assert.equal(getMacOSAppActivateScript('Feishu'), 'tell application "Feishu" to activate');
});

test('executeAppleScript fails gracefully on non-macOS environment', async () => {
  if (process.platform !== 'darwin') {
    const res = await executeAppleScript('beep');
    assert.equal(res.ok, false);
    assert.match(res.error || '', /only available on macOS/);
  }
});

test('listMacOSUsbSerialPorts returns empty array on non-macOS environment', async () => {
  if (process.platform !== 'darwin') {
    const ports = await listMacOSUsbSerialPorts();
    assert.deepEqual(ports, []);
  }
});

test('portOk correctly validates both Windows COM and macOS usbmodem serial paths', async () => {
  const { portOk } = await import('./usb-channel');
  assert.equal(portOk('COM1'), true);
  assert.equal(portOk('COM23'), true);
  assert.equal(portOk('/dev/cu.usbmodem1101'), true);
  assert.equal(portOk('/dev/tty.usbmodem2101'), true);
  assert.equal(portOk('/dev/cu.usbserial-1410'), true);
  assert.equal(portOk('invalid_port'), false);
  assert.equal(portOk('/dev/null'), false);
});

