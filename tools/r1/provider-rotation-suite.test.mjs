import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runProviderRotationSuite } from './provider-rotation-suite.mjs';

const execute = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const artifacts = path.resolve(here, '../../generated-artifacts');

async function fixture(t, source) {
  await fs.mkdir(artifacts, { recursive: true });
  const dir = await fs.mkdtemp(path.join(artifacts, 'rotation-integration-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const script = path.join(dir, 'provider-rotation-check.mjs');
  await fs.writeFile(script, source);
  return { dir, script };
}

test('the unchanged real fixture suite passes all 20 checks with network access blocked', async () => {
  const result = await runProviderRotationSuite();
  assert.equal(result.status, 'PASS', result.stderr);
  assert.equal(result.checks.length, 20);
});

test('child process receives only synthetic environment and cannot contact a provider', async t => {
  const { script } = await fixture(t, `
    import assert from 'node:assert/strict';
    import net from 'node:net';
    assert.deepEqual(Object.keys(process.env).sort(), ['NODE_ENV', 'SESSION_SECRET']);
    assert.equal(process.env.SESSION_SECRET, 'r1-isolated-fixture-session-not-a-real-secret');
    assert.throws(() => fetch('https://api.anthropic.com/v1/messages'), /must not access the network/);
    assert.throws(() => net.connect(443, 'api.anthropic.com'), /must not access the network/);
    console.log('PASS isolated environment and transport');
    console.log('1 credential-rotation checks passed');
  `);
  assert.equal((await runProviderRotationSuite({ script })).status, 'PASS');
});

test('nonzero exits, empty/partial output, missing scripts and timeouts fail closed', async t => {
  for (const source of [
    `throw new Error('synthetic assertion failure');`,
    '',
    `console.log('PASS partial');`,
    `console.log('PASS partial\\n2 credential-rotation checks passed');`,
    `console.log('PASS partial\\n1 credential-rotation checks passed'); process.exit(1);`,
    `setInterval(() => {}, 1000);`,
  ]) {
    const { script } = await fixture(t, source);
    const result = await runProviderRotationSuite({ script, timeout: source.includes('setInterval') ? 200 : 5000 });
    assert.equal(result.status, 'FAIL', source);
    assert.ok(result.error);
  }
  assert.equal((await runProviderRotationSuite({ script: '/nonexistent/rotation-fixture.mjs' })).status, 'FAIL');
});

async function runHarness(t, source, args = ['--credential-rotation-only'], { memoryExit = 0, preflightOnly = false } = {}) {
  const { dir } = await fixture(t, source);
  const runnerDir = path.join(dir, 'r1');
  await fs.mkdir(runnerDir);
  for (const name of ['run.mjs', 'provider-rotation-suite.mjs', 'isolated-provider-checks.mjs']) {
    await fs.copyFile(path.join(here, name), path.join(runnerDir, name));
  }
  // Keep the merged source-memory preflight injected too: integration tests
  // must not reach a real database or depend on workspace credentials.
  await fs.writeFile(path.join(runnerDir, 'source-memory-preflight.mjs'), `
    export async function runSourceMemoryPreflight() {
      return {
        status: ${JSON.stringify(memoryExit === 2 ? 'assertion_failure' : memoryExit ? 'harness_error' : 'passed')},
        results: [{name: 'synthetic memory check'}],
        exitCode: ${memoryExit},
        reportPath: 'source-memory.json'
      };
    }
  `);
  let output, code = 0;
  try {
    output = await execute(process.execPath, [path.join(runnerDir, 'run.mjs'), ...args], {
      env: {
        SKIP_FUNCTIONS: '1,2,3,4,5,6,7,8,9,10,11,12,13,14',
        R1_PREFLIGHT_ONLY: String(preflightOnly),
      }, timeout: 10_000,
    });
  } catch (err) {
    output = err;
    code = err.code;
  }
  const [run] = await fs.readdir(path.join(runnerDir, 'runs'));
  const reports = {};
  for (const name of ['report.html', 'failures.md', 'run-summary.txt', 'credential-rotation.json', 'network.log']) {
    reports[name] = await fs.readFile(path.join(runnerDir, 'runs', run, name), 'utf8');
  }
  return { code, stdout: output.stdout, reports };
}

test('the real harness reports success in every output without app requests or a reviewer key', async t => {
  const { code, stdout, reports } = await runHarness(t, `
    console.log('PASS synthetic check');
    console.log('1 credential-rotation checks passed');
  `);
  assert.equal(code, 0);
  assert.match(stdout, /credential rotation\] PASS/);
  assert.match(reports['report.html'], /Credential rotation — PASS/);
  assert.match(reports['failures.md'], /Credential rotation — PASS/);
  assert.match(reports['run-summary.txt'], /CREDENTIAL ROTATION: PASS \(1 checks passed\)/);
  assert.match(reports['run-summary.txt'], /browser checks not run/);
  assert.equal(JSON.parse(reports['credential-rotation.json']).status, 'PASS');
  assert.equal(reports['network.log'], '');
});

test('an injected regression visibly fails the beta report and exit status', async t => {
  const { code, stdout, reports } = await runHarness(t, `
    console.log('PASS earlier check');
    throw new Error('Synthetic same-model backup assertion failed <unsafe>');
  `);
  assert.equal(code, 2);
  assert.match(stdout, /credential rotation\] FAIL/);
  assert.match(reports['report.html'], /Credential rotation — FAIL/);
  assert.match(reports['report.html'], /Synthetic same-model backup assertion failed &lt;unsafe&gt;/);
  assert.match(reports['failures.md'], /Synthetic same-model backup assertion failed/);
  assert.match(reports['run-summary.txt'], /CRITICAL INVARIANT VIOLATIONS: 1/);
  assert.match(reports['run-summary.txt'], /CREDENTIAL ROTATION: FAIL/);
  assert.equal(JSON.parse(reports['credential-rotation.json']).status, 'FAIL');
  assert.equal(reports['network.log'], '');
});

test('regular mode runs fixtures despite SKIP_FUNCTIONS and preserves results if reviewer setup fails', async t => {
  const { code, reports } = await runHarness(t, `
    console.log('PASS unskippable check');
    console.log('1 credential-rotation checks passed');
  `, []);
  assert.equal(code, 3);
  assert.match(reports['run-summary.txt'], /CREDENTIAL ROTATION: PASS/);
  assert.match(reports['failures.md'], /ANTHROPIC_API_KEY not set/);
  assert.equal(reports['network.log'], '');
});

for (const memoryExit of [2, 3]) {
  test(`memory preflight failure (${memoryExit}) preserves both suites and prevents browser generation`, async t => {
    const { code, reports } = await runHarness(t, `
      console.log('PASS rotation still ran');
      console.log('1 credential-rotation checks passed');
    `, [], { memoryExit });
    assert.equal(code, memoryExit);
    assert.match(reports['run-summary.txt'], /CREDENTIAL ROTATION: PASS/);
    assert.match(reports['run-summary.txt'], /SOURCE MEMORY: (assertion_failure|harness_error)/);
    assert.match(reports['failures.md'], /source-memory preflight/);
    assert.equal(reports['network.log'], '');
  });
}

test('preflight-only mode runs both deterministic suites without requiring a reviewer', async t => {
  const { code, reports } = await runHarness(t, `
    console.log('PASS rotation still ran');
    console.log('1 credential-rotation checks passed');
  `, [], { preflightOnly: true });
  assert.equal(code, 0);
  assert.match(reports['run-summary.txt'], /SOURCE MEMORY: passed/);
  assert.match(reports['run-summary.txt'], /CREDENTIAL ROTATION: PASS/);
  assert.match(reports['run-summary.txt'], /deterministic preflights only; browser checks not run/);
  assert.equal(reports['network.log'], '');
});

test('rotation failures still fail preflight-only mode alongside successful memory checks', async t => {
  const { code, reports } = await runHarness(t, `throw new Error('synthetic rotation failure');`,
    [], { preflightOnly: true });
  assert.equal(code, 2);
  assert.match(reports['run-summary.txt'], /SOURCE MEMORY: passed/);
  assert.match(reports['run-summary.txt'], /CREDENTIAL ROTATION: FAIL/);
});
