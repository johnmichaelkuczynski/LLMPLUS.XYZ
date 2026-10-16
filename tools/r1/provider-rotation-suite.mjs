import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
const checkPath = fileURLToPath(new URL('../provider-rotation-check.mjs', import.meta.url));
const guardPath = fileURLToPath(new URL('./isolated-provider-checks.mjs', import.meta.url));

export async function runProviderRotationSuite({ script = checkPath, timeout = 30_000 } = {}) {
  const started = Date.now();
  let stdout = '', stderr = '', error = null;
  try {
    ({ stdout, stderr } = await execute(process.execPath, ['--import', guardPath, script], {
      // Do not inherit provider keys, database access, session secrets or NODE_OPTIONS.
      env: { NODE_ENV: 'test', SESSION_SECRET: 'r1-isolated-fixture-session-not-a-real-secret' },
      timeout, maxBuffer: 1024 * 1024,
    }));
  } catch (err) {
    stdout = err.stdout || '';
    stderr = err.stderr || '';
    error = err.killed ? 'Fixture subprocess timed out or was killed' : `Fixture subprocess failed (${err.code || err.signal || 'unknown'})`;
  }
  const checks = stdout.split(/\r?\n/).filter(line => line.startsWith('PASS ')).map(line => line.slice(5));
  const summary = stdout.trim().match(/(?:^|\n)(\d+) credential-rotation checks passed$/);
  if (!error && (!summary || Number(summary[1]) !== checks.length || !checks.length)) {
    error = 'Fixture subprocess did not produce a complete, nonempty check summary';
  }
  return {
    name: 'Credential rotation (isolated fixtures)',
    status: error ? 'FAIL' : 'PASS',
    checks, error, stdout, stderr, durationMs: Date.now() - started,
    evidence: 'Injected provider responses and database recorder; network blocked; no live credential health claim.',
  };
}
