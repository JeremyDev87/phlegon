import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { CliError } from './report.mjs';

export async function runHost(command, args, request) {
  const remaining = request.deadline - performance.now();
  if (remaining <= 0) throw new CliError('Request timed out before starting host.', 124);
  const child = spawn(command, args, { cwd: request.cwd, detached: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
  let failure;
  const output = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let escalation;
  const kill = signal => {
    if (!child.pid) return;
    try { process.kill(-child.pid, signal); }
    catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error; }
  };
  const stop = error => {
    failure ??= error;
    if (escalation) return;
    kill('SIGTERM');
    escalation = delay(150).then(() => kill('SIGKILL'));
  };
  const interrupt = () => stop(new CliError('Interrupted; owned host process group terminated.', 130));
  const terminate = () => stop(new CliError('Terminated; owned host process group terminated.', 143));
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', terminate);
  const timer = setTimeout(() => stop(new CliError('Host timed out; owned process group terminated. Increase --timeout if appropriate.', 124)), Math.max(0, request.deadline - performance.now()));
  child.stdout.on('data', chunk => {
    stdoutBytes += chunk.length;
    if (stdoutBytes > 1024 * 1024) stop(new CliError('Host stdout exceeded 1 MiB; output discarded.'));
    else output.push(chunk);
  });
  child.stderr.on('data', chunk => {
    stderrBytes += chunk.length;
    if (stderrBytes > 65536) stop(new CliError('Host stderr exceeded 64 KiB; output discarded.'));
  });
  child.stdin.on('error', error => stop(new CliError(error.code === 'EPIPE' ? 'Host closed its input before completing the request.' : 'Unable to write host input.')));
  try {
    const code = await new Promise(resolve => {
      child.once('error', error => {
        failure = new CliError(error.code === 'ENOENT' ? 'Selected host binary is missing from PATH. Install it and authenticate separately.' : 'Selected host could not start. Check PATH and executable permissions.');
        resolve(null);
      });
      child.once('exit', resolve);
      child.stdin.end(request.prompt);
    });
    clearTimeout(timer);
    stop(failure);
    await escalation;
    child.stdout.destroy();
    child.stderr.destroy();
    child.stdin.destroy();
    if (failure) throw failure;
    if (code !== 0) throw new CliError(`Host failed (exit ${Number.isInteger(code) ? code : 'signal'}). Check host authentication, supported flags and permissions separately; raw logs were withheld.`);
    return Buffer.concat(output).toString('utf8');
  } finally {
    clearTimeout(timer);
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', terminate);
  }
}
