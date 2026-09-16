import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createNativeChannel } from './native-channel';

test('真实 Win32 helper 的 Server 模式可重复编译探针与中文传输，不执行窗口操作', async () => {
  const channel = createNativeChannel(join(process.cwd(), 'desktop', 'cu-native.ps1'));
  try {
    assert.deepEqual(await channel.call({ operation: 'compile', marker: '编译探针一' }), { ok: true, marker: '编译探针一' });
    assert.deepEqual(await channel.call({ operation: 'compile', marker: '复用探针二🙂' }), { ok: true, marker: '复用探针二🙂' });
  } finally { channel.close(); }
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'flowdesk-native-channel-')); const script = join(directory, 'server.ps1');
  await writeFile(script, `param([switch]$Server)
$ErrorActionPreference = 'Stop'
while (($line = [Console]::In.ReadLine()) -ne $null) {
  $request = $line | ConvertFrom-Json
  if ($request.op -eq 'delay') { Start-Sleep -Milliseconds 100 }
  if ($request.op -eq 'stderr') { [Console]::Error.WriteLine('sentinel-secret') ; continue }
  if ($request.op -eq 'large') { [Console]::Out.Write(('x' * 25165825)); [Console]::Out.Write([Environment]::NewLine); [Console]::Out.Flush(); continue }
  $out = @{ value = $request.value; pid = $PID } | ConvertTo-Json -Compress
  [Console]::Out.WriteLine($out)
  [Console]::Out.Flush()
}
`, 'utf8');
  return { script, cleanup: () => rm(directory, { recursive: true, force: true }) };
}

test('同一持久 PowerShell 子进程顺序处理多条 NDJSON 请求', async (t) => {
  const f = await fixture(); t.after(f.cleanup); const channel = createNativeChannel(f.script); t.after(() => channel.close());
  const first = await channel.call({ value: 'one' }) as { value: string; pid: number }; const second = await channel.call({ value: 'two' }) as { value: string; pid: number };
  assert.equal(first.value, 'one'); assert.equal(second.value, 'two'); assert.equal(first.pid, second.pid);
});

test('重叠请求被拒绝，取消会拒绝在途请求', async (t) => {
  const f = await fixture(); t.after(f.cleanup); const aborter = new AbortController(); const channel = createNativeChannel(f.script, aborter.signal); t.after(() => channel.close());
  const pending = channel.call({ op: 'delay' }); await assert.rejects(channel.call({ value: 'second' }), /正在处理/); aborter.abort(); await assert.rejects(pending, /取消/);
});

test('关闭后请求被拒绝', async (t) => {
  const f = await fixture(); t.after(f.cleanup); const channel = createNativeChannel(f.script); channel.close(); await assert.rejects(channel.call({ value: 'no' }), /关闭/);
});

test('stderr 与超大输出只返回固定错误，不泄露脚本内容', async (t) => {
  const f = await fixture(); t.after(f.cleanup); const channel = createNativeChannel(f.script); t.after(() => channel.close());
  await assert.rejects(channel.call({ op: 'stderr' }), (error: Error) => !error.message.includes('sentinel-secret'));
});

test('超出 stdout 限制会关闭通道', async (t) => {
  const f = await fixture(); t.after(f.cleanup); const channel = createNativeChannel(f.script); t.after(() => channel.close());
  await assert.rejects(channel.call({ op: 'large' }), /输出超限/); await assert.rejects(channel.call({ value: 'after' }), /关闭/);
});
