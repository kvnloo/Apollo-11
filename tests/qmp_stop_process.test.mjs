// Public stop() API with live child processes. Not a real QEMU test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { newQemu, stop } from '../qemu/client.ts';

async function exercise(ignoresTerm, check) {
  const script = `${ignoresTerm ? "process.on('SIGTERM', () => {});" : ''} console.log('ready'); setInterval(() => {}, 1000);`;
  const child = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'ignore'] });
  try {
    await once(child.stdout, 'data');
    const vm = newQemu();
    vm.proc = child;
    return await check(vm, child);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const closed = once(child, 'close').catch(() => {});
      child.kill('SIGKILL');
      await Promise.race([closed, delay(1000)]);
    }
  }
}

async function outcome(vm, timeout) {
  const stopPromise = stop(vm).then(() => 'resolved');
  return Promise.race([stopPromise, delay(timeout, 'deadline')]);
}

test('stop rejects a VM without a child', async () => {
  await assert.rejects(stop(newQemu()), /not started/);
});

test('stop sends SIGTERM and reaps a cooperative child', { timeout: 5000 }, async () => {
  await exercise(false, async (vm, child) => {
    assert.equal(await outcome(vm, 1000), 'resolved');
    assert.equal(child.signalCode, 'SIGTERM');
    assert.equal(vm.proc, undefined);
  });
});

test('stop escalates SIGTERM-resistant child to SIGKILL', { timeout: 5000 }, async () => {
  await exercise(true, async (vm, child) => {
    assert.equal(await outcome(vm, 1200), 'resolved');
    assert.equal(child.signalCode, 'SIGKILL');
    assert.equal(vm.proc, undefined);
  });
});
