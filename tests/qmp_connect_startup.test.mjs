import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { newQemu, start, stop } from '../qemu/client.ts';

const fakebin = resolve(fileURLToPath(new URL('./fakebin/', import.meta.url)));
const oldPath = process.env.PATH;
const oldMode = process.env.APOLLO_FAKE_MODE;
const oldPid = process.env.APOLLO_FAKE_PID_FILE;

function withEnvironment(t, mode) {
  const dir = mkdtempSync(join(tmpdir(), 'qmp-connect-check-'));
  const pidFile = join(dir, 'pid.txt');
  process.env.PATH = `${fakebin}:${oldPath}`;
  process.env.APOLLO_FAKE_MODE = mode;
  process.env.APOLLO_FAKE_PID_FILE = pidFile;
  t.after(() => {
    process.env.PATH = oldPath;
    if (oldMode === undefined) delete process.env.APOLLO_FAKE_MODE;
    else process.env.APOLLO_FAKE_MODE = oldMode;
    if (oldPid === undefined) delete process.env.APOLLO_FAKE_PID_FILE;
    else process.env.APOLLO_FAKE_PID_FILE = oldPid;
    rmSync(dir, { recursive: true, force: true });
  });
  return { dir, pidFile };
}

// This requires the public start() to release a child that runs but never
// makes its socket available. The OLD code waits indefinitely.
test('start rejects an unavailable QMP socket and reaps its process', { timeout: 12000 }, async (t) => {
  const { dir, pidFile } = withEnvironment(t, 'nosocket');
  const vm = newQemu(); vm.diskPath = join(dir, 'disk.qcow2');
  const action = start(vm);
  action.catch(() => {});
  // The outer guard is a TEST fixture, not a production deadline.
  const verdict = await Promise.race([
    action.then(() => ({ success: true }), error => ({ error })),
    new Promise(resolve => setTimeout(() => resolve({ hung: true }), 6400)),
  ]);
  if (verdict.hung) {
    vm.proc?.kill('SIGKILL');
    await action.catch(() => {});
  }
  assert.equal(Boolean(verdict.hung), false, 'start() did not settle after QMP socket failure');
  assert.match(String(verdict.error?.message), /QMP socket startup timed out/);
  assert.equal(vm.proc, undefined);
  assert.equal(vm.qmp, undefined);
  const pid = Number(readFileSync(pidFile, 'utf8'));
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});

test('a delayed valid QMP server still starts and stops', { timeout: 5000 }, async (t) => {
  const { dir } = withEnvironment(t, 'serve');
  const vm = newQemu(); vm.diskPath = join(dir, 'disk.qcow2');
  await start(vm);
  assert.ok(vm.proc?.pid);
  assert.ok(vm.qmp && !vm.qmp.destroyed);
  await stop(vm);
  assert.equal(vm.proc, undefined);
  assert.equal(vm.qmp, undefined);
});

test('a child exiting before its socket appears rejects promptly', { timeout: 5000 }, async (t) => {
  const { dir } = withEnvironment(t, 'exit');
  const vm = newQemu(); vm.diskPath = join(dir, 'disk.qcow2');
  await assert.rejects(start(vm), /QEMU exited: 19/);
  assert.equal(vm.proc, undefined);
  assert.equal(vm.qmp, undefined);
});
