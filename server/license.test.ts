import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getMachineId, signLicense, verifyLicense, LicenseManager } from './license.ts';

const TEST_PRIV_KEY = `-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEIAfwdEPx/NPMsMjwbm/FmC3vBIG5XPgMP3qoc5JypDV+
-----END PRIVATE KEY-----`;

test('getMachineId returns consistent formatted machine ID', () => {
  const m1 = getMachineId();
  const m2 = getMachineId();
  assert.equal(m1, m2);
  assert.match(m1, /^FD-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
});

test('signLicense and verifyLicense validate genuine signatures', () => {
  const machineId = getMachineId();
  const payload = {
    machineId,
    expiry: new Date(Date.now() + 365 * 86400000).toISOString(),
    plan: 'pro' as const,
    issuedAt: new Date().toISOString()
  };
  const key = signLicense(payload, TEST_PRIV_KEY);
  assert.ok(key.startsWith('FD1_'));

  const result = verifyLicense(key, machineId);
  assert.equal(result.valid, true);
  assert.equal(result.payload?.machineId, machineId);
  assert.equal(result.payload?.plan, 'pro');
});

test('verifyLicense rejects mismatched machineId, expired tokens, and tampered signatures', () => {
  const machineId = getMachineId();
  
  // 1. Mismatched machine ID
  const otherPayload = {
    machineId: 'FD-1111-2222-3333',
    expiry: new Date(Date.now() + 365 * 86400000).toISOString(),
    plan: 'pro' as const,
    issuedAt: new Date().toISOString()
  };
  const keyOther = signLicense(otherPayload, TEST_PRIV_KEY);
  const resMismatch = verifyLicense(keyOther, machineId);
  assert.equal(resMismatch.valid, false);
  assert.match(resMismatch.error || '', /不匹配/);

  // 2. Expired token
  const expiredPayload = {
    machineId,
    expiry: new Date(Date.now() - 1000).toISOString(),
    plan: 'pro' as const,
    issuedAt: new Date(Date.now() - 2000).toISOString()
  };
  const keyExpired = signLicense(expiredPayload, TEST_PRIV_KEY);
  const resExpired = verifyLicense(keyExpired, machineId);
  assert.equal(resExpired.valid, false);
  assert.match(resExpired.error || '', /到期/);
});

test('LicenseManager enforces trial quota and unlocks upon activation', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'flowdesk-license-test-'));
  try {
    const lm = new LicenseManager(tempDir);
    await lm.init();

    const status1 = lm.getStatus();
    assert.equal(status1.licensed, false);
    assert.equal(status1.trialUsed, 0);
    assert.equal(status1.trialRemaining, 20);

    // Consume 2 quotas
    await lm.consumeQuota();
    await lm.consumeQuota();
    assert.equal(lm.getStatus().trialUsed, 2);
    assert.equal(lm.getStatus().trialRemaining, 18);

    // Activate with genuine key
    const machineId = lm.getStatus().machineId;
    const key = signLicense({
      machineId,
      expiry: new Date(Date.now() + 30 * 86400000).toISOString(),
      plan: 'pro',
      issuedAt: new Date().toISOString()
    }, TEST_PRIV_KEY);

    const actResult = await lm.activate(key);
    assert.equal(actResult.ok, true);
    assert.equal(lm.getStatus().licensed, true);

    // Consuming quota when licensed never throws or decrements trial
    await lm.consumeQuota();
    assert.equal(lm.getStatus().licensed, true);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
