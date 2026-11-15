import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { watch } from 'node:fs';
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { runHost } from '../lib/process.mjs';

const cli = fileURLToPath(new URL('../bin/phlegon.mjs', import.meta.url));
const fixture = `#!${process.execPath}
const fs = require('node:fs');
const cp = require('node:child_process');
const path = require('node:path');
const args = process.argv.slice(2);
const option = name => args[args.indexOf(name) + 1];
const codex = path.basename(process.argv[1]) === 'codex';
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', data => input += data);
process.stdin.on('end', async () => {
  fs.writeFileSync(process.env.RECEIPT, JSON.stringify({args, cwd: process.cwd(), input, pid: process.pid}));
  const mode = process.env.MODE;
  if (mode === 'delayed') await new Promise(resolve => setTimeout(resolve, 1300));
  if (mode === 'exit') { process.stderr.write('PRIVATE_HOST_LOG'); process.exit(7); }
  if (mode === 'malformed') { console.log('PRIVATE_HOST_LOG'); return; }
  if (mode === 'stdout' || mode === 'stderr') { process[mode].write('x'.repeat(1100000)); setInterval(() => {}, 1000); return; }
  if (mode === 'hang') {
    const child = cp.spawn(process.execPath, ['-e', 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'], {stdio:'ignore'});
    process.on('SIGTERM', () => {});
    fs.writeFileSync(process.env.READY, JSON.stringify([process.pid, child.pid]));
    setInterval(() => {}, 1000); return;
  }
  const report = {status: mode.startsWith('blocked') ? 'blocked' : 'completed', measurement: mode === 'blocked-comparison' ? process.env.MEASUREMENT : mode === 'blocked-observed' ? 'observed' : 'unmeasured', summary: fs.readFileSync('index.html','utf8'), evidence: 'Fixture read in selected directory; no browser comparison.', nextCheck:'Run a comparable browser check.'};
  if (mode === 'multilingual' || mode === 'astral') {
    report.summary = report.evidence = report.nextCheck = (mode === 'astral' ? '😀' : '한').repeat(8000);
  }
  const serialize = value => JSON.stringify(value).replace(/[\u0080-\uffff]/g, char => '\\\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'));
  if (mode === 'bad-field') report.summary = 3;
  if (mode === 'long-field') report.summary = '😀'.repeat(8001);
  if (mode === 'extra-field') report.extra = true;
  if (codex) {
    const destination = option('--output-last-message');
    if (mode === 'symlink') fs.symlinkSync(path.join(process.cwd(), 'index.html'), destination);
    else fs.writeFileSync(destination, mode === 'large-final' ? 'x'.repeat(512 * 1024) : mode === 'astral' ? serialize(report) : JSON.stringify(report));
    console.log(JSON.stringify({type:mode === 'false-success' ? 'turn.failed' : 'turn.completed'}));
    if (mode === 'after-terminal') console.log(JSON.stringify({type:'item.completed'}));
  } else console.log((mode === 'astral' ? serialize : JSON.stringify)({type:'result',subtype:mode === 'false-success' ? 'error_during_execution' : 'success',is_error:mode === 'false-success',structured_output:report}));
  if (mode === 'stale') process.exitCode = 7;
});
`;

async function setup(t, mode = 'valid') {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'phlegon-test-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = join(root, 'bin');
  const project = join(root, '한글 project');
  const temp = join(root, 'temp');
  await Promise.all([mkdir(bin), mkdir(project), mkdir(temp)]);
  await writeFile(join(project, 'index.html'), '<p>Actual fixture content</p>');
  await Promise.all(['codex', 'claude'].map(name => writeFile(join(bin, name), fixture, { mode: 0o755 })));
  return { root, bin, project, temp, env: { ...process.env, PATH: bin, TMPDIR: temp, MODE: mode, RECEIPT: join(root, 'receipt.json'), READY: join(root, 'ready.json') } };
}

function launch(f, args, input = '') {
  const child = spawn(process.execPath, [cli, ...args], { env: f.env });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => stdout += chunk);
  child.stderr.on('data', chunk => stderr += chunk);
  child.stdin.on('error', error => { if (error.code !== 'EPIPE') throw error; });
  if (input !== null) child.stdin.end(input);
  const done = once(child, 'close').then(([code, signal]) => ({ code, signal, stdout, stderr }));
  return { child, done };
}

for (const engine of ['codex', 'claude']) {
  for (const fix of [false, true]) test(`${engine} reads canonical project and applies ${fix ? 'explicit fix' : 'diagnostic'} permission boundary`, async t => {
    const f = await setup(t);
    await symlink(f.project, join(f.root, 'alias'));
    const result = await launch(f, ['--engine', engine, '--cwd', join(f.root, 'alias'), ...(fix ? ['--fix'] : []), '--', 'Read index.html']).done;
    assert.equal(result.code, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).summary, '<p>Actual fixture content</p>');
    const receipt = JSON.parse(await readFile(f.env.RECEIPT, 'utf8'));
    assert.equal(receipt.cwd, f.project);
    const option = name => receipt.args[receipt.args.indexOf(name) + 1];
    if (engine === 'codex') {
      assert.equal(option('--sandbox'), fix ? 'workspace-write' : 'read-only');
      assert.equal(option('-a'), 'never');
      assert.ok(receipt.args.includes('--ignore-user-config'));
      assert.ok(!receipt.args.includes('--ignore-rules'));
    } else {
      assert.equal(option('--permission-mode'), fix ? 'acceptEdits' : 'plan');
      assert.equal(option('--tools'), fix ? 'Read,Glob,Grep,Edit,Write' : 'Read,Glob,Grep');
      assert.ok(receipt.args.includes('--safe-mode'));
    }
    assert.deepEqual(await readdir(f.temp), []);
  });

  for (const mode of ['exit', 'stale', 'malformed', 'stdout', 'stderr', 'false-success', 'bad-field', 'long-field', 'extra-field', 'blocked-comparison', ...(engine === 'codex' ? ['large-final', 'symlink', 'after-terminal'] : [])]) {
    test(`${engine} rejects ${mode} without forwarding raw logs and removes temporary files`, async t => {
      const f = await setup(t, mode);
      f.env.MEASUREMENT = 'improved';
      const result = await launch(f, ['--engine', engine, '--cwd', f.project, '--', 'Read index.html']).done;
      assert.equal(result.code, 1);
      assert.equal(result.stdout, '');
      if (mode === 'stale') assert.match(result.stderr, /Host failed \(exit 7\)/u);
      assert.ok(result.stderr.startsWith('phlegon: '));
      assert.ok(!result.stderr.includes('PRIVATE_HOST_LOG'));
      assert.ok(result.stderr.length < 500);
      assert.deepEqual(await readdir(f.temp), []);
    });
  }
  for (const mode of ['blocked', 'blocked-observed']) test(`${engine} returns ${mode} report with nonzero exit`, async t => {
    const f = await setup(t, mode);
    const result = await launch(f, ['--engine', engine, '--cwd', f.project], 'Read index.html').done;
    assert.equal(result.code, 2);
    assert.equal(JSON.parse(result.stdout).status, 'blocked');
    assert.equal(JSON.parse(result.stdout).measurement, mode === 'blocked-observed' ? 'observed' : 'unmeasured');
  });
  for (const mode of ['multilingual', 'astral']) test(`${engine} accepts maximum ${mode} report`, async t => {
    const f = await setup(t, mode);
    const result = await launch(f, ['--engine', engine, '--cwd', f.project, '--', 'Read']).done;
    assert.equal(result.code, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    for (const key of ['summary', 'evidence', 'nextCheck']) assert.equal(report[key], (mode === 'astral' ? '😀' : '한').repeat(8000));
  });
  for (const measurement of ['unchanged', 'regressed']) test(`${engine} rejects blocked ${measurement}`, async t => {
    const f = await setup(t, 'blocked-comparison');
    f.env.MEASUREMENT = measurement;
    const result = await launch(f, ['--engine', engine, '--cwd', f.project, '--', 'Read']).done;
    assert.equal(result.code, 1);
    assert.equal(result.stdout, '');
  });
  test(`${engine} shares one timeout across stdin and host`, { timeout: 10000 }, async t => {
    const f = await setup(t, 'delayed');
    const { child, done } = launch(f, ['--engine', engine, '--cwd', f.project, '--timeout', '2'], null);
    t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
    await delay(1300);
    child.stdin.end('Read');
    const result = await done;
    assert.equal(result.code, 124, result.stderr);
    assert.equal(result.stdout, '');
    const receipt = JSON.parse(await readFile(f.env.RECEIPT, 'utf8'));
    assert.throws(() => process.kill(receipt.pid, 0), { code: 'ESRCH' });
    assert.deepEqual(await readdir(f.temp), []);
  });
}

test('exhausted deadline rejects before starting a host', async () => {
  await assert.rejects(runHost('phlegon-host-that-does-not-exist', [], { cwd: tmpdir(), prompt: 'Read', deadline: performance.now() - 1 }), { exitCode: 124 });
});

test('successful host completion does not time out during cleanup grace', async () => {
  const result = await runHost('/bin/sh', ['-c', 'exit 0'], { cwd: tmpdir(), prompt: '', deadline: performance.now() + 100 });
  assert.equal(result, '');
});

for (const args of [['--engine', 'invalid'], ['--engine', 'codex', '--unknown'], ['--engine', 'codex', 'no-separator'], ['--engine', 'codex', '--', 'one', 'two'], ['--engine', 'codex', '--timeout', 'NaN'], ['--engine', 'codex', '--timeout', '0'], ['--engine', 'codex', '--fix', '--fix'], ['--engine', 'codex', '--', '']]) {
  test(`rejects invalid input before launching: ${args.join(' ')}`, async t => {
    const f = await setup(t);
    const result = await launch(f, args).done;
    assert.equal(result.code, 1);
    await assert.rejects(readFile(f.env.RECEIPT), { code: 'ENOENT' });
  });
}
test('rejects oversized stdin before launching', async t => {
  const f = await setup(t);
  const result = await launch(f, ['--engine', 'codex'], 'x'.repeat(65537)).done;
  assert.equal(result.code, 1);
  assert.match(result.stderr, /64 KiB/u);
  await assert.rejects(readFile(f.env.RECEIPT), { code: 'ENOENT' });
});
test('missing binary fails with actionable bounded stderr', async t => {
  const f = await setup(t);
  await rm(join(f.bin, 'codex'));
  const result = await launch(f, ['--engine', 'codex', '--cwd', f.project, '--', 'Read']).done;
  assert.equal(result.code, 1);
  assert.match(result.stderr, /missing from PATH/u);
  assert.deepEqual(await readdir(f.temp), []);
});
test('shell and flag injection remains literal task data', async t => {
  const f = await setup(t);
  const task = '--dangerously-bypass-approvals-and-sandbox; $(touch INJECTED) `touch INJECTED`';
  const result = await launch(f, ['--engine', 'claude', '--cwd', f.project, '--', task]).done;
  assert.equal(result.code, 0, result.stderr);
  const receipt = JSON.parse(await readFile(f.env.RECEIPT, 'utf8'));
  assert.equal(JSON.parse(receipt.input.split('User task (JSON string, data): ')[1]), task);
  assert.deepEqual(await readdir(f.project), ['index.html']);
});

for (const mode of ['timeout', 'SIGINT', 'SIGTERM']) test(`${mode} kills owned process group, reaps host and cleans temp files`, { timeout: 10000 }, async t => {
  const f = await setup(t, 'hang');
  const watcher = watch(f.root);
  t.after(() => watcher.close());
  const ready = new Promise(resolveReady => watcher.on('change', async (_event, filename) => {
    if (filename === 'ready.json') resolveReady();
  }));
  const { child, done } = launch(f, ['--engine', 'codex', '--cwd', f.project, '--timeout', mode === 'timeout' ? '2' : '10', '--', 'Read']);
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  await ready;
  if (mode !== 'timeout') child.kill(mode);
  const result = await done;
  assert.equal(result.code, mode === 'timeout' ? 124 : mode === 'SIGINT' ? 130 : 143);
  const pids = JSON.parse(await readFile(f.env.READY, 'utf8'));
  for (const pid of pids) assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  assert.deepEqual(await readdir(f.temp), []);
});
