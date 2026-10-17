// Isolated diagnostics UI checks: synthetic status only; no database or provider calls.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { registerContextDiagnostics } from '../server/context-diagnostics.js';

const routes = new Map();
registerContextDiagnostics({ get: (path, handler) => routes.set(path, handler) }, null, req => req.owner);
const healthRoute = routes.get('/api/admin/provider-health');
function response() {
  return {
    statusCode: 200, headers: {}, body: null,
    status(code) { this.statusCode = code; return this; },
    set(key, value) { this.headers[key] = value; return this; },
    json(body) { this.body = body; return this; }
  };
}
const denied = response();
await healthRoute({ owner: false }, denied);
assert.equal(denied.statusCode, 403);
assert.deepEqual(denied.body, { error: 'Owner access required' });
const allowed = response();
const originalFetch = globalThis.fetch;
globalThis.fetch = () => { throw new Error('Health must not probe providers'); };
try { await healthRoute({ owner: true }, allowed); }
finally { globalThis.fetch = originalFetch; }
assert.equal(allowed.statusCode, 200);
assert.equal(allowed.headers['Cache-Control'], 'no-store');
for (const provider of allowed.body.providers) {
  for (const credential of provider.credentials) {
    assert.deepEqual(Object.keys(credential).sort(), ['alias', 'lastHttpStatus', 'retryAfterSeconds', 'status']);
  }
}

const [app, html, css] = await Promise.all([
  readFile(new URL('../client/app.js', import.meta.url), 'utf8'),
  readFile(new URL('../client/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../client/style.css', import.meta.url), 'utf8')
]);
// Exercise the actual modal, styles, and event handlers without opening user chats.
const diagnosticCode = app.slice(app.indexOf('\n  var contextDiagnosticsButton ='),
  app.indexOf('\n  async function createChatWithRules'));
assert.ok(diagnosticCode.includes('async function loadProviderHealth()'));
const modal = html.slice(html.indexOf('      <div id="context-diagnostics-modal"'),
  html.indexOf('      <div id="compare-picker-modal"'));
const fixture = {
  providers: [
    { label: 'Claude', configuredCredentials: 3, availableCredentials: 2, credentials: [
      { alias: 'ANTHROPIC_API_KEY', status: 'cooling_down', lastHttpStatus: 429, retryAfterSeconds: 60 },
      { alias: 'ANTHROPIC_API_KEY_BACKUP', status: 'last_attempt_succeeded', lastHttpStatus: 200, retryAfterSeconds: 0 },
      { alias: 'ANTHROPIC_API_KEY_2', status: 'not_yet_tested', lastHttpStatus: null, retryAfterSeconds: 0 }
    ] },
    { label: 'ChatGPT', configuredCredentials: 1, availableCredentials: 1, credentials: [
      { alias: 'OPENAI_API_KEY', status: 'ready_to_retry', lastHttpStatus: 401, retryAfterSeconds: 0 }
    ] },
    { label: 'DeepSeek', configuredCredentials: 0, availableCredentials: 0, credentials: [] }
  ], modelSubstitution: false,
  secret: 'EXTRA_FIELDS_MUST_NOT_RENDER'
};
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let healthCalls = 0;
  let indexFails = false;
  let healthStatus = 200;
  let healthFixture = fixture;
  let holdHealth = null;
  const unexpected = [];
  await page.route('**/*', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/') return route.fulfill({ contentType: 'text/html', body:
      '<style>' + css + '</style><button id="btn-context-diagnostics">Context diagnostics</button>' + modal });
    if (path === '/api/admin/provider-health') {
      healthCalls++;
      assert.equal(route.request().method(), 'GET');
      if (holdHealth) await holdHealth;
      return route.fulfill({ status: healthStatus, json: healthFixture });
    }
    if (path === '/api/admin/context-diagnostics') {
      return route.fulfill({ status: indexFails ? 500 : 200, json: indexFails ? {} : [] });
    }
    unexpected.push(path);
    return route.abort();
  });
  await page.goto('http://diagnostics.test/');
  await page.addScriptTag({ content: `
    var state = { access: { owner: true } };
    var contextDiagnosticsRequestToken = 0, contextDiagnosticsTraces = [], contextDiagnosticsData = null;
    var contextComparisonPending = false, contextComparisonRequestToken = 0;
    ${diagnosticCode}
  ` });
  assert.equal(healthCalls, 0, 'No health fetch before opening the dialog');
  await page.click('#btn-context-diagnostics');
  await page.waitForFunction(() => document.getElementById('provider-health-status').textContent.includes('Snapshot:'));
  assert.equal(await page.locator('#context-diagnostics-modal > .modal-content').evaluate(el =>
    getComputedStyle(el).backgroundColor), 'rgb(255, 255, 255)');
  assert.match(await page.textContent('#context-diagnostics-body'), /No context traces/);
  assert.match(await page.textContent('#provider-health-body'), /3 configured · 2 available · 2 backups configured/);
  await page.locator('#provider-health-body summary').first().click();
  for (const text of ['ANTHROPIC_API_KEY_BACKUP', 'Successfully used (HTTP success)',
    'Not yet tested', 'No recorded outcome', 'HTTP 429', '60 seconds']) {
    assert.ok((await page.textContent('#provider-health-body')).includes(text), text);
  }
  assert.match(await page.textContent('#provider-health-body'), /Ready to retry · not yet recovered/);
  assert.match(await page.textContent('#provider-health-body'), /0 configured · 0 available · No backup configured/);
  assert.ok(!(await page.textContent('#provider-health-body')).includes(fixture.secret));

  // Manual refresh failures clear stale claims, then allow recovery.
  healthStatus = 403;
  await page.click('#provider-health-refresh');
  await page.waitForFunction(() => document.getElementById('provider-health-status').textContent.includes('HTTP 403'));
  assert.equal(await page.textContent('#provider-health-body'), '');
  healthStatus = 200;
  healthFixture = { providers: null };
  await page.click('#provider-health-refresh');
  await page.waitForFunction(() => document.getElementById('provider-health-status').textContent.includes('Invalid'));
  healthFixture = fixture;
  await page.click('#provider-health-refresh');
  await page.waitForFunction(() => document.getElementById('provider-health-status').textContent.includes('Snapshot:'));
  assert.equal(healthCalls, 4);

  await page.click('#close-context-diagnostics');
  assert.equal(await page.textContent('#provider-health-body'), '');
  indexFails = true;
  await page.click('#btn-context-diagnostics');
  await page.waitForFunction(() => document.getElementById('provider-health-status').textContent.includes('Snapshot:'));
  await page.waitForFunction(() => document.getElementById('context-diagnostics-body').textContent.includes('Could not load'));
  assert.match(await page.textContent('#provider-health-body'), /Claude/);

  // Closing during a pending request cannot repopulate the closed dialog.
  let release;
  holdHealth = new Promise(resolve => { release = resolve; });
  await page.click('#provider-health-refresh');
  await page.waitForFunction(() => document.getElementById('provider-health-refresh').disabled);
  await page.click('#close-context-diagnostics');
  release();
  holdHealth = null;
  await page.waitForTimeout(100);
  assert.equal(await page.textContent('#provider-health-body'), '');
  assert.equal(await page.textContent('#provider-health-status'), '');

  // Nonowners cannot initiate the request, even by triggering the hidden action.
  const beforeNonowner = healthCalls;
  await page.evaluate(() => { state.access.owner = false; });
  await page.click('#btn-context-diagnostics');
  assert.equal(healthCalls, beforeNonowner);
  assert.ok(await page.locator('#context-diagnostics-modal').evaluate(el => el.classList.contains('hidden')));
  await page.evaluate(() => { state.access.owner = true; });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click('#btn-context-diagnostics');
  await page.waitForFunction(() => document.getElementById('provider-health-status').textContent.includes('Snapshot:'));
  await page.locator('#provider-health-body summary').first().click();
  assert.ok(await page.locator('#provider-health-refresh').isVisible());
  assert.ok(await page.locator('#close-context-diagnostics').isVisible());
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  assert.deepEqual(errors, []);
  assert.deepEqual(unexpected, []);
  console.log('PASS: owner-only read-only endpoint; real diagnostics UI states, refresh, errors, close, access guard, and mobile layout.');
} finally {
  await browser.close();
}
