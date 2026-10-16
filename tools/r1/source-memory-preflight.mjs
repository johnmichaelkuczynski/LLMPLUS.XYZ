import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));

// An answered-but-wrong check is always a regression, even if its wording
// happens to include "rate limit" or "unavailable".
export function classifyCheckError(error) {
  if (error?.code === 'ERR_ASSERTION' || error?.name === 'AssertionError') return 'assertion_failure';
  const status = Number(error?.status || error?.statusCode);
  if (status === 429) return 'rate_limited';
  if ([401,403,502,503,504,529].includes(status)) return 'provider_unavailable';
  return 'harness_error';
}

export function preflightExitCode(status) {
  return status === 'passed' ? 0 : status === 'assertion_failure' ? 2 : 3;
}

export async function runSourceMemoryPreflight(outputDir, {
  script = path.join(root, 'tools/memory-context-check.mjs'),
  timeoutMs = 180_000,
} = {}) {
  const reportPath = path.join(outputDir, 'source-memory.json');
  await fs.mkdir(outputDir, {recursive:true});
  const child = spawn(process.execPath, [script], {
    cwd:root,
    env:{...process.env, MEMORY_CONTEXT_REPORT:reportPath},
    stdio:['ignore','pipe','pipe'],
  });
  let stdout = '', stderr = '', timedOut = false;
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
  let launchError;
  const code = await new Promise(resolve => {
    child.on('error', error => { launchError = error; resolve(null); });
    child.on('close', resolve);
  });
  clearTimeout(timer);
  await fs.writeFile(path.join(outputDir, 'source-memory.log'), stdout+stderr);
  let report;
  try { report = JSON.parse(await fs.readFile(reportPath, 'utf8')); }
  catch { /* No report is a harness failure, never a pass. */ }
  const validStatuses = ['passed','assertion_failure','rate_limited','provider_unavailable','harness_error'];
  if (timedOut || launchError || !report || !validStatuses.includes(report.status) ||
    !Array.isArray(report.results) || (report.status === 'passed' && (!report.results.length || report.cleanup !== 'rolled_back')) ||
    (code !== preflightExitCode(report.status))) {
    report = {...report, status:'harness_error', error:timedOut ? 'Source-memory preflight timed out' :
      launchError?.message || `Source-memory preflight exited ${code} without a valid completion report`};
    await fs.writeFile(reportPath, JSON.stringify(report,null,2));
  }
  return {...report, exitCode:preflightExitCode(report.status), reportPath};
}
