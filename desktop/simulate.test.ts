import test from 'node:test';
import assert from 'node:assert/strict';
import { runSimulation } from './simulate';

test('runSimulation executes default skill in quiet mode and returns metrics', async () => {
  const result = await runSimulation(undefined, {
    interactiveDelayMs: 0,
    quiet: true,
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.skillId, 'skill_order_to_excel');
  assert.equal(result.totalSteps, 4);
  assert.equal(result.completedSteps, 4);
  assert.equal(result.ghostChannelActions, 2);
  assert.equal(result.fastChannelActions, 2);
  assert.ok(result.totalTokensSaved >= 700);
});

test('runSimulation executes specific skill and triggers self-healing blockage recovery', async () => {
  const result = await runSimulation('skill_tax_invoice_export', {
    interactiveDelayMs: 0,
    simulateBlockage: true,
    quiet: true,
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.skillId, 'skill_tax_invoice_export');
  assert.equal(result.totalSteps, 5);
  assert.equal(result.recoveredBlockages, 1);
  assert.equal(result.fastChannelActions, 5);
  assert.ok(result.totalTokensSaved >= 1750);
});
