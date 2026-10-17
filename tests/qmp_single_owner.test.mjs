// Fork QA: real Node child + Unix QMP socket stand-in, not real QEMU.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { newQemu, start, stop } from '../qemu/client.ts';

const fakeQemu = `#!/usr/bin/env node
const net = require('node:net');
const value = process.argv[process.argv.indexOf('-qmp') + 1];
const path = /^unix:(.*),server=on,wait=off$/.exec(value)?.[1];
if (!path) process.exit(7);
const server = net.createServer(socket => {
  socket.write('{"QMP":{}}\\n');
  let buffered = '';
  socket.on('data', data => {
    buffered += data.toString();
    const lines = buffered.split('\\n');
    buffered = lines.pop();
    for (const line of lines) {
      if (line.trim()) socket.write(JSON.stringify({ id: JSON.parse(line).id, return: {} }) + '\\n');
    }
  });
});
server.listen(path);
process.on('SIGTERM', () => server.close(() => process.exit(0)));
`;

async function dispose(child) {
  if (!child) return;
  if (child.exitCode === null && child.signalCode === null) {
    const closed = once(child, 'close').catch(() => {});
    child.kill('SIGKILL');
    await Promise.race([closed, delay(1000)]);
  }
}

test('start rejects a missing disk', async () => {
  await assert.rejects(start(newQemu()), /no disk/);
});

test('a second start cannot replace a live VM child', { timeout: 6000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'apollo-single-owner-'));
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  const exe = join(bin, 'qemu-system-x86_64');
  writeFileSync(exe, fakeQemu);
  chmodSync(exe, 0o755);
  const oldPath = process.env.PATH;
  process.env.PATH = `${bin}:${oldPath}`;
  const vm = newQemu();
  vm.diskPath = join(dir, 'disk.qcow2');
  let owner;
  try {
    await start(vm);
    owner = vm.proc;
    assert.ok(owner?.pid, 'stand-in VM must actually start');
    await assert.rejects(start(vm), /already started/);
    assert.strictEqual(vm.proc, owner, 'first child must retain ownership');
    assert.equal(owner.exitCode, null, 'first child must remain live');
    await stop(vm);
    assert.equal(vm.proc, undefined, 'explicit stop releases ownership');
    await start(vm);
    assert.ok(vm.proc?.pid, 'start after stop launches another VM');
    assert.notStrictEqual(vm.proc, owner, 'restarted VM must own a new child');
  } finally {
    vm.qmp?.destroy();
    await dispose(vm.proc && vm.proc !== owner ? vm.proc : undefined);
    await dispose(owner);
    process.env.PATH = oldPath;
    rmSync(dir, { recursive: true, force: true });
  }
});
