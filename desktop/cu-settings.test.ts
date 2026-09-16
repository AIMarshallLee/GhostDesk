import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createComputerUseSettings, geminiRecommendedModel, geminiRootBaseUrl, validateComputerUseSettings } from './cu-settings.ts';

test('empty CU settings recommend Gemini native Computer Use without a stored secret', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'flowdesk-cu-settings-gemini-default-'));
  const secrets = { get: async () => undefined, set: async () => {}, delete: async () => {} };
  try {
    const store = await createComputerUseSettings(dir, secrets);
    assert.deepEqual(await store.settings(), { baseUrl: geminiRootBaseUrl, model: geminiRecommendedModel, modelFamily: 'gemini', hasKey: false });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('CU settings keep keys out of public state and config, and clear key on endpoint change', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'flowdesk-cu-settings-'));
  let key: string | undefined;
  const secrets = { get: async () => key, set: async (value: string) => { key = value; }, delete: async () => { key = undefined; } };
  try {
    const store = await createComputerUseSettings(dir, secrets);
    const input = { baseUrl: 'https://model.example/v1', model: 'test-cu', modelFamily: 'ui-tars' as const };
    const state = await store.save({ ...input, apiKey: 'sentinel-never-in-config' });
    assert.equal(state.hasKey, true);
    assert.equal(JSON.stringify(state).includes('sentinel'), false);
    assert.equal((await readFile(join(dir, 'computer-use-settings.json'), 'utf8')).includes('sentinel'), false);
    assert.equal((await store.credentials()).apiKey, 'sentinel-never-in-config');
    await store.save({ ...input, model: 'another-model' });
    assert.equal((await store.settings()).hasKey, true);
    await store.save({ ...input, baseUrl: 'https://new.example/v1' });
    assert.equal((await store.settings()).hasKey, false);
    await assert.rejects(store.credentials());
    const reloaded = await createComputerUseSettings(dir, secrets);
    assert.equal((await reloaded.settings()).baseUrl, 'https://new.example/v1');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('failed config replacement cannot pair a new provider key with the previous endpoint', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'flowdesk-cu-settings-failure-'));
  let secret: string | undefined;
  const secrets = { get: async () => secret, set: async (value: string) => { secret = value; }, delete: async () => { secret = undefined; } };
  try {
    const store = await createComputerUseSettings(dir, secrets);
    await store.save({ baseUrl: 'https://old.example/v1', model: 'cu', modelFamily: 'ui-tars', apiKey: 'old-provider-key' });
    const file = join(dir, 'computer-use-settings.json');
    await rename(file, `${file}.backup`);
    await mkdir(file);
    await assert.rejects(store.save({ baseUrl: 'https://new.example/v1', model: 'cu', modelFamily: 'ui-tars', apiKey: 'new-provider-key' }));
    await assert.rejects(store.credentials());
    assert.equal((await store.settings()).hasKey, false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('CU endpoint validation rejects credentials, queries, insecure remote HTTP and invalid protocols', () => {
  const config = { model: 'test', modelFamily: 'ui-tars' };
  for (const baseUrl of ['http://model.example/v1', 'https://user:pass@model.example/v1', 'https://model.example/v1?key=secret', 'file:///tmp/model', 'https://model.example/v1#key']) assert.throws(() => validateComputerUseSettings({ ...config, baseUrl }));
  assert.equal(validateComputerUseSettings({ ...config, baseUrl: 'http://127.0.0.1:1234/v1' }).model, 'test');
});

test('Gemini keeps only its native root endpoint and never exposes its API key', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'flowdesk-cu-settings-gemini-'));
  let key: string | undefined;
  const secrets = { get: async () => key, set: async (value: string) => { key = value; }, delete: async () => { key = undefined; } };
  try {
    const store = await createComputerUseSettings(dir, secrets);
    const saved = await store.save({ baseUrl: geminiRootBaseUrl, model: 'gemini-custom', modelFamily: 'gemini', apiKey: 'gemini-secret' });
    assert.equal(saved.hasKey, true);
    assert.equal(JSON.stringify(saved).includes('gemini-secret'), false);
    assert.equal((await readFile(join(dir, 'computer-use-settings.json'), 'utf8')).includes('gemini-secret'), false);
    assert.equal((await store.credentials()).apiKey, 'gemini-secret');
    for (const baseUrl of [
      'https://generativelanguage.googleapis.com/v1beta/openai',
      'https://generativelanguage.googleapis.com/v1beta/openai/',
      'https://proxy.example/v1beta/openai',
      'https://generativelanguage.googleapis.com/v1beta/models',
    ]) assert.throws(() => validateComputerUseSettings({ baseUrl, model: 'gemini-custom', modelFamily: 'gemini' }));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
