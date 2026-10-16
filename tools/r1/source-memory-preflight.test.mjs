import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { runSourceMemoryPreflight, classifyCheckError, preflightExitCode } from './source-memory-preflight.mjs';
import { transactionPool } from '../fixtures/transaction-pool.mjs';
import { sourceMemoryHistory, proceduralUpdate } from '../fixtures/source-memory.mjs';

test('assertion failures cannot be mistaken for provider blocks', () => {
  const error = new assert.AssertionError({message:'rate limit unavailable',actual:1,expected:2});
  error.status = 429;
  assert.equal(classifyCheckError(error),'assertion_failure');
  assert.equal(classifyCheckError({status:429}),'rate_limited');
  for (const status of [401,403,502,503,504,529]) {
    assert.equal(classifyCheckError({status}),'provider_unavailable');
  }
  assert.equal(classifyCheckError(new Error('database not reachable')),'harness_error');
  assert.equal(preflightExitCode('passed'),0);
  assert.equal(preflightExitCode('assertion_failure'),2);
  for (const status of ['rate_limited','provider_unavailable','harness_error',undefined]) {
    assert.equal(preflightExitCode(status),3);
  }
});

test('index commits and failures cannot end the outer fixture transaction', async () => {
  const queries = [];
  const client = {query:async (...args) => {queries.push(args); return {rows:[]};}};
  const pool = transactionPool(client);
  await pool.query('SELECT fixture', [1]);
  const first = await pool.connect();
  await first.query('BEGIN');
  await first.query('SELECT source', [2]);
  await first.query('COMMIT');
  first.release();
  const failed = await pool.connect();
  await failed.query('BEGIN');
  await failed.query('ROLLBACK');
  failed.release();
  assert.deepEqual(queries, [
    ['SELECT fixture',[1]], ['SAVEPOINT fixture_index_1'], ['SELECT source',[2]],
    ['RELEASE SAVEPOINT fixture_index_1'], ['SAVEPOINT fixture_index_2'],
    ['ROLLBACK TO SAVEPOINT fixture_index_2'], ['RELEASE SAVEPOINT fixture_index_2'],
  ]);
});

test('synthetic fixtures are reusable and include older pending status and later correction', () => {
  const first = sourceMemoryHistory(), second = sourceMemoryHistory();
  assert.deepEqual(first,second);
  assert.notEqual(first,second);
  assert.match(first[0].content,/not yet completed/);
  assert.equal(first.at(-1).content,proceduralUpdate);
  assert.match(first.at(-2).content,/Correction: Avery is the judge, not the trustee/);
  assert.equal(first.filter(m=>m.content.startsWith('Unrelated')).length,100);
});

async function withChild(scriptBody, fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'source-memory-preflight-'));
  const script = path.join(dir,'child.mjs');
  await fs.writeFile(script,`import fs from 'node:fs/promises';\n${scriptBody}`);
  try { await fn(dir,script); }
  finally { await fs.rm(dir,{recursive:true,force:true}); }
}

for (const status of ['passed','assertion_failure','rate_limited','provider_unavailable','harness_error']) {
  test(`preflight preserves ${status} evidence and exit category`, async () => {
    const report = {status,cleanup:'rolled_back',results:[{name:'synthetic check',passed:status==='passed'}]};
    await withChild(`
      await fs.writeFile(process.env.MEMORY_CONTEXT_REPORT,JSON.stringify(${JSON.stringify(report)}));
      console.log('raw synthetic check evidence');
      process.exitCode=${preflightExitCode(status)};
    `, async (dir,script) => {
      const actual = await runSourceMemoryPreflight(dir,{script});
      assert.equal(actual.status,status);
      assert.equal(actual.exitCode,preflightExitCode(status));
      assert.deepEqual(actual.results,report.results);
      assert.match(await fs.readFile(path.join(dir,'source-memory.log'),'utf8'),/raw synthetic check evidence/);
    });
  });
}

test('crashed, malformed, cleanup-failed and missing child reports never pass', async () => {
  for (const body of [
    `process.exitCode=1;`,
    `await fs.writeFile(process.env.MEMORY_CONTEXT_REPORT,'not json');`,
    `await fs.writeFile(process.env.MEMORY_CONTEXT_REPORT,JSON.stringify({status:'passed',results:[],cleanup:'rolled_back'}));`,
    `await fs.writeFile(process.env.MEMORY_CONTEXT_REPORT,JSON.stringify({status:'passed',results:[{}],cleanup:'failed'}));`,
    `await fs.writeFile(process.env.MEMORY_CONTEXT_REPORT,JSON.stringify({status:'passed',results:[{}],cleanup:'rolled_back'})); process.exitCode=1;`,
  ]) {
    await withChild(body, async (dir,script) => {
      const result = await runSourceMemoryPreflight(dir,{script});
      assert.equal(result.status,'harness_error');
      assert.equal(result.exitCode,3);
      assert.equal(JSON.parse(await fs.readFile(result.reportPath,'utf8')).status,'harness_error');
    });
  }
});

test('timeout stops preflight and reports a harness block', async () => {
  await withChild(`setInterval(()=>{},1000);`, async (dir,script) => {
    const result = await runSourceMemoryPreflight(dir,{script,timeoutMs:150});
    assert.equal(result.status,'harness_error');
    assert.match(result.error,/timed out/);
    assert.equal(result.exitCode,3);
  });
});
