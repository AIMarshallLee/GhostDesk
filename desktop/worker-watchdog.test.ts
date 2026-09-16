import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkerWatchdog } from './worker-watchdog';

test('watchdog arms and disarms without triggering when finished in time', async () => {
  let timeoutTriggered = false;
  const watchdog = new WorkerWatchdog({
    timeoutMs: 50,
    onTimeout: () => {
      timeoutTriggered = true;
    },
  });

  watchdog.arm();
  assert.equal(watchdog.isRunning(), true);

  // Complete quickly before timeout
  await new Promise((resolve) => setTimeout(resolve, 10));
  watchdog.disarm();
  assert.equal(watchdog.isRunning(), false);

  // Wait beyond original timeout to verify no late call
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(timeoutTriggered, false);
});

test('watchdog triggers timeout handler when deadline is exceeded', async () => {
  let timeoutReason: string | undefined;
  const watchdog = new WorkerWatchdog({
    timeoutMs: 20,
    onTimeout: (reason) => {
      timeoutReason = reason;
    },
  });

  watchdog.arm();
  await new Promise((resolve) => setTimeout(resolve, 35));

  assert.ok(timeoutReason);
  assert.match(timeoutReason, /Watchdog timeout/);
  assert.equal(watchdog.getAlerts().length, 1);
});

test('heartbeat extends timeout deadline', async () => {
  let timeoutTriggered = false;
  const watchdog = new WorkerWatchdog({
    timeoutMs: 30,
    onTimeout: () => {
      timeoutTriggered = true;
    },
  });

  watchdog.arm();

  // Send heartbeat after 20ms
  await new Promise((resolve) => setTimeout(resolve, 20));
  watchdog.heartbeat();

  // Wait 15ms more (total 35ms > original 30ms, but within reset deadline)
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(timeoutTriggered, false);

  watchdog.disarm();
});
