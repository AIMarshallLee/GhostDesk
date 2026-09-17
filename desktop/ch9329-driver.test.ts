import test from 'node:test';
import assert from 'node:assert/strict';
import { Ch9329Protocol } from './ch9329-driver';

test('CH9329 protocol calculates valid checksum', () => {
  // Test frame: 0x57 0xAB 0x00 0x01 0x00 -> sum = 0x57 + 0xAB + 0x01 = 0x103 -> & 0xFF = 0x03
  const frame = Ch9329Protocol.buildFrame(0x01, new Uint8Array(0));
  assert.equal(frame[0], 0x57);
  assert.equal(frame[1], 0xAB);
  assert.equal(frame[2], 0x00);
  assert.equal(frame[3], 0x01);
  assert.equal(frame[4], 0x00);
  assert.equal(frame[5], 0x03);
});

test('CH9329 builds keyboard press and release frames', () => {
  // Key press: Ctrl + Enter
  const keyFrame = Ch9329Protocol.buildKeyFrame({
    modifier: 0x01, // LCtrl
    reserved: 0,
    keys: [0x28, 0, 0, 0, 0, 0], // 0x28 = Enter
  });

  assert.equal(keyFrame.length, 14); // 5 header + 8 payload + 1 checksum
  assert.equal(keyFrame[3], Ch9329Protocol.CMD_SEND_KEY);
  assert.equal(keyFrame[5], 0x01); // Modifier
  assert.equal(keyFrame[7], 0x28); // Key 1

  // Key release
  const releaseFrame = Ch9329Protocol.buildReleaseAllKeysFrame();
  assert.equal(releaseFrame.length, 14);
  assert.equal(releaseFrame[5], 0x00);
  assert.equal(releaseFrame[7], 0x00);
});

test('CH9329 builds relative mouse movement and click frames', () => {
  const mouseFrame = Ch9329Protocol.buildMouseRelativeFrame({
    buttons: 0x01, // Left click
    deltaX: 10,
    deltaY: -20,
    wheel: 0,
  });

  assert.equal(mouseFrame.length, 11); // 5 header + 5 payload + 1 checksum
  assert.equal(mouseFrame[3], Ch9329Protocol.CMD_SEND_REL_MOUSE);
  assert.equal(mouseFrame[5], 0x01); // Relative mode
  assert.equal(mouseFrame[6], 0x01); // Left button
  assert.equal(mouseFrame[7], 10);
  assert.equal(mouseFrame[8], 236); // -20 in uint8 is 256 - 20 = 236
});

test('CH9329 builds ASCII text string frame', () => {
  const asciiFrame = Ch9329Protocol.buildAsciiTextFrame('GhostDesk');
  assert.equal(asciiFrame[0], 0x57);
  assert.equal(asciiFrame[1], 0xAB);
  assert.equal(asciiFrame[3], Ch9329Protocol.CMD_SEND_ASCII);
  assert.equal(asciiFrame[4], 9); // 'GhostDesk'.length = 9
});

test('CH9329 builds named automation keys', () => {
  const enterFrame = Ch9329Protocol.buildNamedKeyFrame('enter');
  assert.ok(enterFrame);
  assert.equal(enterFrame[5], 0); // modifier
  assert.equal(enterFrame[7], 0x28); // keycode for Enter

  const ctrlVFrame = Ch9329Protocol.buildNamedKeyFrame('ctrl+v');
  assert.ok(ctrlVFrame);
  assert.equal(ctrlVFrame[5], 0x01); // LCtrl
  assert.equal(ctrlVFrame[7], 0x19); // 'v'

  const unknown = Ch9329Protocol.buildNamedKeyFrame('fictional-key');
  assert.equal(unknown, undefined);
});

