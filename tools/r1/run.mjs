#!/usr/bin/env node
// R1 — Synthetic User Agent for LLMPlus
// Produces raw, reviewable evidence — never pass/fail theater.

import { chromium } from 'playwright';
import Anthropic from '@anthropic-ai/sdk';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ─── Config ─────────────────────────────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_URL = process.env.APP_URL || 'http://localhost:5000';
const HEADLESS = process.env.HEADLESS === 'true';
const TYPE_DELAY_MS = parseInt(process.env.TYPE_DELAY_MS || '15', 10);
const LIVE_VIEW_PORT = parseInt(process.env.LIVE_VIEW_PORT || '7777', 10);
const SKIP_FUNCTIONS = new Set((process.env.SKIP_FUNCTIONS || '').split(',').filter(Boolean));
const COMPRESSION_TEST_MAX_ITERATIONS = parseInt(process.env.COMPRESSION_TEST_MAX_ITERATIONS || '60', 10);
const LONG_DOC_TARGET_WORDS = parseInt(process.env.LONG_DOC_TARGET_WORDS || '2000', 10);
const R1_MODEL = process.env.R1_MODEL || 'claude-sonnet-4-5-20250929';
const R1_USERNAME = process.env.R1_USERNAME || 'JMK';
const R1_PASSWORD = process.env.R1_PASSWORD || 'r1test';

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('FATAL: ANTHROPIC_API_KEY not set');
  process.exit(3);
}

const RUN_TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-');
const OUTPUT_DIR = path.join(__dirname, 'runs', RUN_TIMESTAMP);
const SCREENSHOT_DIR = path.join(OUTPUT_DIR, 'screenshots');
const TREE_SNAPSHOT_DIR = path.join(OUTPUT_DIR, 'tree-snapshots');
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
fs.mkdirSync(TREE_SNAPSHOT_DIR, { recursive: true });

const TRANSCRIPT_PATH = path.join(OUTPUT_DIR, 'transcript.jsonl');
const NETWORK_LOG_PATH = path.join(OUTPUT_DIR, 'network.log');
const CONSOLE_LOG_PATH = path.join(OUTPUT_DIR, 'console.log');
const REPORT_PATH = path.join(OUTPUT_DIR, 'report.html');
const FAILURES_PATH = path.join(OUTPUT_DIR, 'failures.md');
const DIAGNOSTIC_PATH = path.join(OUTPUT_DIR, 'diagnostic.json');
const SUMMARY_PATH = path.join(OUTPUT_DIR, 'run-summary.txt');

const VALID_TAGS = ['ASSERTS', 'REJECTS', 'ASSUMES', 'OPEN', 'RESOLVED', 'DOCUMENT', 'QUESTION'];
const DECIMAL_KEY_RE = /^\d+(\.\d+)*$/;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Global state ───────────────────────────────────────────────────────────
const state = {
  startedAt: new Date().toISOString(),
  status: 'starting',
  currentFunction: null,
  currentStep: null,
  url: '',
  r1Approach: '',
  r1Reasoning: '',
  r1Input: '',
  typedMirror: '',
  appResponseStream: '',
  recentApiCalls: [],
  judgeCritique: '',
  treeDelta: null,
  latestScreenshot: '',
  completed: [],
  testProjectId: null,
  testProjectName: null,
  sessionCookie: null,
};
const interactions = [];
const judgeConcerns = [];
const violations = [];      // critical
const sanityFailures = [];
const networkCalls = [];    // mirror; full log written to file

let stepCounter = 0;
let screenshotCounter = 0;
const consoleLog = fs.createWriteStream(CONSOLE_LOG_PATH, { flags: 'a' });
const transcriptStream = fs.createWriteStream(TRANSCRIPT_PATH, { flags: 'a' });
const networkLogStream = fs.createWriteStream(NETWORK_LOG_PATH, { flags: 'a' });

function log(...args) {
  const line = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
  console.log(line);
  consoleLog.write(line + '\n');
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function shortenBody(body, maxLen = 50000) {
  if (typeof body !== 'string') {
    try { body = JSON.stringify(body); } catch { body = String(body); }
  }
  if (body.length > maxLen) return { body: body.substring(0, maxLen), truncated: true };
  return { body, truncated: false };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Live view HTTP server ──────────────────────────────────────────────────
function startLiveView() {
  const server = http.createServer((req, res) => {
    if (req.url === '/' || req.url === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(LIVE_VIEW_HTML);
    } else if (req.url === '/state.json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ...state,
        completed: state.completed.slice(-30),
        recentApiCalls: state.recentApiCalls.slice(-12),
        latestScreenshotUrl: state.latestScreenshot
          ? `/screenshot/${path.basename(state.latestScreenshot)}` : null,
      }));
    } else if (req.url.startsWith('/screenshot/')) {
      const f = path.join(SCREENSHOT_DIR, path.basename(req.url));
      if (fs.existsSync(f)) {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        fs.createReadStream(f).pipe(res);
      } else { res.writeHead(404); res.end(); }
    } else if (req.url === '/done') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<!doctype html><meta http-equiv="refresh" content="0;url=/"><body>done</body>`);
    } else { res.writeHead(404); res.end('not found'); }
  });
  server.listen(LIVE_VIEW_PORT, () => {
    log(`Live view: http://localhost:${LIVE_VIEW_PORT}`);
  });
  return server;
}

const LIVE_VIEW_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>R1 Live View</title>
<style>
* { box-sizing: border-box; }
body { margin:0; padding:0; background:#0a0a0a; color:#e5e7eb; font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 13px; }
.layout { display:grid; grid-template-rows: auto 1fr auto; height:100vh; }
.panel { padding:10px 14px; border-bottom:1px solid #1f2937; overflow:auto; }
.top { background:#0f172a; }
.mid { background:#0a0a0a; }
.bot { background:#0f172a; max-height:30vh; }
.h { color:#9ca3af; font-size:11px; text-transform:uppercase; letter-spacing:1px; margin:0 0 6px 0; }
.big { font-size:16px; color:#fde047; margin:0 0 4px 0; }
.url { color:#60a5fa; font-size:11px; }
.mirror { background:#000; color:#86efac; padding:6px; border-radius:4px; white-space:pre-wrap; min-height:1.4em; font-size:12px; }
.stream { background:#000; color:#d1d5db; padding:6px; border-radius:4px; white-space:pre-wrap; max-height:24vh; overflow:auto; font-size:12px; }
.shot { max-width:300px; max-height:200px; border:1px solid #374151; }
.split { display:grid; grid-template-columns: 1fr 1fr; gap:10px; }
.api { font-size:11px; padding:3px 6px; border-radius:3px; margin-bottom:2px; }
.api.ok { background:#064e3b; }
.api.bad { background:#7f1d1d; }
.tree { background:#064e3b; padding:8px; border-radius:4px; }
.tree.bad { background:#7f1d1d; color:#fee2e2; }
.critique { background:#1e293b; padding:8px; border-radius:4px; font-style:italic; color:#cbd5e1; font-size:12px; }
.row { display:flex; gap:8px; align-items:flex-start; margin-bottom:6px; }
.tag-vio { color:#fca5a5; font-weight:bold; }
.tag-ok { color:#86efac; }
.complog { font-size:11px; color:#9ca3af; padding:3px 0; border-bottom:1px solid #1f2937; }
.banner-done { position:fixed; top:0; left:0; right:0; background:#16a34a; color:#fff; padding:16px; font-size:18px; text-align:center; z-index:999; }
</style></head>
<body><div class="layout">
<div class="panel top">
  <p class="h">Current step</p>
  <p class="big" id="curfn">—</p>
  <p id="curstep">—</p>
  <p class="url" id="cururl">—</p>
  <p class="h" style="margin-top:8px">R1 approach</p>
  <p id="approach">—</p>
  <p class="h" style="margin-top:8px">R1 reasoning</p>
  <p id="reasoning" style="font-style:italic; color:#cbd5e1">—</p>
  <p class="h" style="margin-top:8px">Live keystrokes</p>
  <div class="mirror" id="mirror"></div>
  <div id="shotholder" style="margin-top:8px"></div>
</div>
<div class="panel mid">
  <div class="split">
    <div>
      <p class="h">App streaming response</p>
      <div class="stream" id="stream"></div>
    </div>
    <div>
      <p class="h">Recent /api/* calls</p>
      <div id="apilist"></div>
      <p class="h" style="margin-top:8px">Tractatus tree state</p>
      <div id="tree" class="tree">no exchange yet</div>
      <p class="h" style="margin-top:8px">Judge critique</p>
      <div class="critique" id="critique">—</div>
    </div>
  </div>
</div>
<div class="panel bot">
  <p class="h">Completed interactions (newest first)</p>
  <div id="complog"></div>
</div>
</div>
<div id="donebanner"></div>
<script>
async function tick() {
  try {
    const r = await fetch('/state.json'); const s = await r.json();
    document.getElementById('curfn').textContent = (s.currentFunction || 'idle') + ' — ' + (s.status || '');
    document.getElementById('curstep').textContent = s.currentStep || '—';
    document.getElementById('cururl').textContent = s.url || '—';
    document.getElementById('approach').textContent = s.r1Approach || '—';
    document.getElementById('reasoning').textContent = s.r1Reasoning || '—';
    document.getElementById('mirror').textContent = s.typedMirror || '—';
    document.getElementById('stream').textContent = s.appResponseStream || '—';
    document.getElementById('critique').textContent = s.judgeCritique || '—';
    const ah = document.getElementById('apilist'); ah.innerHTML='';
    (s.recentApiCalls||[]).slice().reverse().forEach(c=>{
      const d=document.createElement('div'); d.className='api '+(c.status>=400?'bad':'ok');
      d.textContent = c.method+' '+c.url.replace(/^.*\\/api/,'/api')+' → '+c.status+' ('+(c.ms||0)+'ms)';
      ah.appendChild(d);
    });
    const tr=document.getElementById('tree'); const td=s.treeDelta;
    if (td) {
      const bad = !td.allTagsValid || !td.allIdsValid || td.delta<1 || td.delta>8;
      tr.className = 'tree '+(bad?'bad':'');
      tr.innerHTML='nodes: '+td.nodesBefore+' → '+td.nodesAfter+' (Δ '+td.delta+')<br>'+
        'new ids: '+(td.newNodeIds||[]).join(', ')+'<br>'+
        'new tags: '+(td.newNodeTags||[]).join(', ')+'<br>'+
        'tags valid: '+(td.allTagsValid?'<span class=tag-ok>yes</span>':'<span class=tag-vio>NO</span>')+
        ' · ids valid: '+(td.allIdsValid?'<span class=tag-ok>yes</span>':'<span class=tag-vio>NO</span>')+
        (td.violationNote? '<br><span class=tag-vio>'+td.violationNote+'</span>':'');
    } else tr.textContent='no exchange yet';
    const sh=document.getElementById('shotholder');
    if (s.latestScreenshotUrl) {
      const u=s.latestScreenshotUrl+'?t='+Date.now();
      sh.innerHTML='<img class=shot src="'+u+'">';
    }
    const cl=document.getElementById('complog'); cl.innerHTML='';
    (s.completed||[]).slice().reverse().forEach(c=>{
      const d=document.createElement('div'); d.className='complog';
      d.textContent='['+c.functionNumber+'] '+c.stepDescription+(c.violation?' ⚠ '+c.violation:'');
      cl.appendChild(d);
    });
    if (s.status==='done') {
      document.getElementById('donebanner').className='banner-done';
      document.getElementById('donebanner').textContent='✓ RUN COMPLETE — open report.html in runs/ directory';
    }
  } catch (e) { console.error(e); }
}
setInterval(tick, 1500); tick();
</script>
</body></html>`;

// ─── R1 brain & Judge ───────────────────────────────────────────────────────
async function r1Brain(systemPrompt, userPrompt, maxTokens = 1200) {
  try {
    const resp = await anthropic.messages.create({
      model: R1_MODEL,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });
    return resp.content[0]?.text || '';
  } catch (err) {
    log('[r1Brain] error:', err.message);
    return '';
  }
}

async function r1ComposeInput(approachHint, contextSummary) {
  const sys = `You are R1, a synthetic beta tester for LLMPlus (a scholarly chat app with Tractatus tree memory).
Pick ONE testing approach and craft ONE chat input. Output JSON ONLY:
{"approach":"...","reasoning":"...","input":"..."}
Approach choices: substantive_question, tag_probe_RESOLVED, tag_probe_OPEN, tag_probe_REJECTS, memory_callback, minimum_viable, long_contextualized, hallucination_probe.
Keep input under 240 chars, plain prose, no markdown.`;
  const txt = await r1Brain(sys, `Hint: ${approachHint}\nContext: ${contextSummary}`, 600);
  try {
    const m = txt.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
  } catch {}
  return { approach: 'substantive_question', reasoning: '(brain returned malformed JSON; fallback used)', input: approachHint || 'Briefly explain Wittgenstein\'s picture theory of language.' };
}

async function judge(interaction) {
  const sys = `You are an unsparing reviewer of a synthetic user agent's beta test of LLMPlus. Output strict JSON:
{"critique":"<2-5 sentences of PROSE — never a boolean>","concerns":["..."],"violations":["..."]}
Reference the tractatus delta, response coherence, streaming, and tag validity. concerns = qualitative issues. violations = hard rule breaks (no tag, malformed id, no stream, 5xx, missing expected route).`;
  const body = JSON.stringify({
    function: interaction.functionName,
    step: interaction.stepDescription,
    expected_routes: interaction.expectedRoutes,
    r1_input: interaction.r1Input,
    network_calls: (interaction.appResponse.networkCalls || []).map(c => ({ m: c.method, u: c.url.replace(/^.*\/api/, '/api'), s: c.status })),
    sse_events: (interaction.appResponse.sseEvents || []).slice(0, 30),
    response_excerpt: (interaction.appResponse.pageTextAfter || '').slice(0, 1200),
    tractatus_delta: interaction.tractatusDelta,
    console_errors: interaction.appResponse.errorsInConsole || [],
  }).slice(0, 12000);
  const txt = await r1Brain(sys, body, 700);
  try {
    const m = txt.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
  } catch {}
  return { critique: txt || '(judge returned no JSON; raw text included)', concerns: [], violations: [] };
}

// ─── Tree helpers ───────────────────────────────────────────────────────────
function flattenTree(tree, prefix = '', out = {}) {
  if (!tree || typeof tree !== 'object') return out;
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out[key] = v;
    else if (v && typeof v === 'object') {
      if (typeof v.value === 'string') out[key] = v.value;
      if (v.children) flattenTree(v.children, key, out);
      else flattenTree(v, key, out);
    }
  }
  return out;
}

function tagOf(value) {
  if (!value) return null;
  const m = String(value).match(/^([A-Z]+)\b/);
  return m ? m[1] : null;
}

function computeTreeDelta(before, after) {
  const flatB = flattenTree(before);
  const flatA = flattenTree(after);
  const keysB = new Set(Object.keys(flatB));
  const newKeys = Object.keys(flatA).filter(k => !keysB.has(k));
  const newTags = newKeys.map(k => tagOf(flatA[k])).filter(Boolean);
  const allTagsValid = newKeys.length === 0
    ? true
    : newKeys.every(k => VALID_TAGS.includes(tagOf(flatA[k])));
  const allIdsValid = newKeys.length === 0
    ? true
    : newKeys.every(k => DECIMAL_KEY_RE.test(k.split('.').slice(-1)[0]) || DECIMAL_KEY_RE.test(k));
  const delta = Object.keys(flatA).length - Object.keys(flatB).length;
  let violationNote = '';
  if (delta < 1) violationNote = 'Invariant A: tree did not grow';
  else if (delta > 8) violationNote = 'Invariant A: tree grew by more than 8';
  else if (!allTagsValid) violationNote = 'Invariant A: invalid tag prefix on new node';
  else if (!allIdsValid) violationNote = 'Invariant A: non-decimal node id';
  return {
    nodesBefore: Object.keys(flatB).length,
    nodesAfter: Object.keys(flatA).length,
    delta,
    newNodeIds: newKeys,
    newNodeTags: newTags,
    allTagsValid,
    allIdsValid,
    violationNote,
  };
}

// ─── Network capture ────────────────────────────────────────────────────────
function attachNetworkCapture(page) {
  const pending = new Map();
  page.on('request', req => {
    if (!req.url().includes('/api/')) return;
    pending.set(req, { startedAt: Date.now() });
  });
  page.on('response', async resp => {
    const req = resp.request();
    if (!req.url().includes('/api/')) return;
    const meta = pending.get(req) || { startedAt: Date.now() };
    pending.delete(req);
    let bodyText = '';
    let truncated = false;
    try {
      const buf = await resp.body();
      const s = buf.toString('utf-8');
      const cleaned = shortenBody(s);
      bodyText = cleaned.body;
      truncated = cleaned.truncated;
    } catch (e) {
      bodyText = `<body unavailable: ${e.message}>`;
    }
    let postData = '';
    try { postData = req.postData() || ''; } catch {}
    const entry = {
      ts: new Date().toISOString(),
      method: req.method(),
      url: req.url(),
      status: resp.status(),
      ms: Date.now() - meta.startedAt,
      request_body: shortenBody(postData, 8000).body,
      response_body: bodyText,
      response_truncated: truncated,
    };
    networkLogStream.write(JSON.stringify(entry) + '\n');
    networkCalls.push(entry);
    state.recentApiCalls.push({ method: entry.method, url: entry.url, status: entry.status, ms: entry.ms });
    if (state.recentApiCalls.length > 30) state.recentApiCalls.shift();
  });
  page.on('console', msg => {
    if (msg.type() === 'error') log('[browser-console-error]', msg.text());
  });
}

// ─── App helpers ────────────────────────────────────────────────────────────
async function screenshot(page, label) {
  screenshotCounter++;
  const n = String(screenshotCounter).padStart(4, '0');
  const filename = `${n}-${label}.png`;
  const full = path.join(SCREENSHOT_DIR, filename);
  try {
    await page.screenshot({ path: full, fullPage: false });
    state.latestScreenshot = full;
    return `screenshots/${filename}`;
  } catch (e) {
    log('[screenshot] failed:', e.message);
    return null;
  }
}

async function getCookieHeader(context) {
  const cookies = await context.cookies();
  return cookies.map(c => `${c.name}=${c.value}`).join('; ');
}

async function apiFetch(context, urlPath, options = {}) {
  const cookieHeader = await getCookieHeader(context);
  const url = APP_URL + urlPath;
  const resp = await fetch(url, {
    method: options.method || 'GET',
    headers: { 'Content-Type': 'application/json', 'Cookie': cookieHeader, ...(options.headers || {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  let body;
  const ct = resp.headers.get('content-type') || '';
  try {
    body = ct.includes('json') ? await resp.json() : await resp.text();
  } catch { body = null; }
  // Also log via the network log (these are off-band; record them too)
  networkLogStream.write(JSON.stringify({
    ts: new Date().toISOString(), method: options.method || 'GET', url,
    status: resp.status, ms: 0, source: 'off-band',
    request_body: options.body ? JSON.stringify(options.body).slice(0, 8000) : '',
    response_body: typeof body === 'string' ? body.slice(0, 50000) : JSON.stringify(body).slice(0, 50000),
  }) + '\n');
  return { status: resp.status, body, headers: resp.headers };
}

async function getTractatus(context, projectId) {
  const { body } = await apiFetch(context, `/api/projects/${projectId}/tractatus`);
  return body || {};
}

async function snapshotTree(projectId, label, tree) {
  const n = String(stepCounter).padStart(4, '0');
  const fn = `${n}-${label}.json`;
  fs.writeFileSync(path.join(TREE_SNAPSHOT_DIR, fn), JSON.stringify(tree, null, 2));
  return fn;
}

async function waitForTreeGrowth(context, projectId, beforeCount, timeoutMs = 45000) {
  const start = Date.now();
  let last = beforeCount;
  while (Date.now() - start < timeoutMs) {
    const t = await getTractatus(context, projectId);
    const c = Object.keys(flattenTree(t)).length;
    if (c > beforeCount) return t;
    last = c;
    await sleep(1500);
  }
  // Return whatever we have; caller will see delta of 0 and log violation
  return await getTractatus(context, projectId);
}

// Read a SSE response stream from raw fetch (used for diagnostic, coherence direct calls)
async function readSSE(resp, onEvent) {
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const events = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2);
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6);
        if (payload === '[DONE]') { events.push({ raw: '[DONE]' }); continue; }
        try { const parsed = JSON.parse(payload); events.push(parsed); if (onEvent) onEvent(parsed); }
        catch { events.push({ raw: payload }); }
      }
    }
  }
  return events;
}

// ─── Per-interaction recording ─────────────────────────────────────────────
function recordInteraction(rec) {
  interactions.push(rec);
  transcriptStream.write(JSON.stringify(rec) + '\n');
  state.completed.push({
    functionNumber: rec.functionNumber,
    stepDescription: rec.stepDescription,
    violation: (rec.invariantViolations && rec.invariantViolations.length) ? rec.invariantViolations[0] : null,
  });
  // Sanity check: route-specific
  if (rec.isInteractive) {
    for (const route of rec.expectedRoutes || []) {
      const [mth, pat] = route.split(' ');
      const matched = (rec.appResponse.networkCalls || []).some(c => c.method === mth && new RegExp('^' + pat.replace(/:[^/]+/g, '[^/]+') + '$').test(new URL(c.url).pathname));
      if (!matched) {
        sanityFailures.push({ interaction: rec.functionNumber + ' ' + rec.stepDescription, reason: `expected route not seen: ${route}` });
      }
    }
    if ((rec.r1Input || '').length < 10) {
      sanityFailures.push({ interaction: rec.functionNumber + ' ' + rec.stepDescription, reason: `r1_input < 10 chars` });
    }
    if ((rec.screenshots || []).length < 3) {
      sanityFailures.push({ interaction: rec.functionNumber + ' ' + rec.stepDescription, reason: `interactive step has < 3 screenshots` });
    }
  }
  if ((rec.judgeCritique || '').split(/\s+/).filter(Boolean).length < 30) {
    sanityFailures.push({ interaction: rec.functionNumber + ' ' + rec.stepDescription, reason: `judge_critique < 30 words` });
  }
  if (rec.functionName.toLowerCase().includes('chat') && rec.tractatusDelta == null) {
    sanityFailures.push({ interaction: rec.functionNumber + ' ' + rec.stepDescription, reason: `chat interaction missing tractatus_delta` });
  }
  for (const v of rec.invariantViolations || []) violations.push({ interaction: rec.functionNumber + ' ' + rec.stepDescription, violation: v });
  for (const c of rec.judgeConcerns || []) judgeConcerns.push({ interaction: rec.functionNumber + ' ' + rec.stepDescription, concern: c });
}

// Get the network calls that landed during a given window
function networkCallsSince(sinceIdx) {
  return networkCalls.slice(sinceIdx).map(c => ({
    method: c.method, url: c.url, status: c.status, ms: c.ms,
    request_body_excerpt: (c.request_body || '').slice(0, 400),
    response_body_excerpt: (c.response_body || '').slice(0, 1500),
  }));
}

// Parse SSE events out of a recorded chat response body
function sseEventsFromBody(body) {
  if (!body) return [];
  const out = [];
  for (const line of body.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    const p = line.slice(6);
    if (p === '[DONE]') { out.push({ type: '[DONE]' }); continue; }
    try { out.push(JSON.parse(p)); } catch { out.push({ raw: p.slice(0, 200) }); }
  }
  return out;
}

function assembleStreamedText(sseEvents) {
  const parts = [];
  for (const e of sseEvents) {
    if (e.type === 'text' && e.text) parts.push(e.text);
    if (e.type === 'token' && e.text) parts.push(e.text);
    if (e.type === 'section_token' && e.text) parts.push(e.text);
  }
  return parts.join('');
}

// ─── Helper: send a chat via the UI and capture everything ─────────────────
async function sendChatViaUI(page, context, projectId, sessionId, opts) {
  const { functionNumber, functionName, stepDescription, approachHint } = opts;
  stepCounter++;
  const startNetIdx = networkCalls.length;
  state.currentFunction = `Function ${functionNumber} — ${functionName}`;
  state.currentStep = stepDescription;
  state.url = page.url();
  state.judgeCritique = '';
  state.treeDelta = null;
  state.appResponseStream = '';

  // Capture tree before
  const treeBefore = projectId ? await getTractatus(context, projectId) : {};
  const nodesBefore = Object.keys(flattenTree(treeBefore)).length;
  if (projectId) await snapshotTree(projectId, `f${functionNumber}-${stepCounter}-before`, treeBefore);

  // R1 composes input
  const composed = await r1ComposeInput(approachHint, stepDescription);
  state.r1Approach = composed.approach;
  state.r1Reasoning = composed.reasoning;
  state.r1Input = composed.input;
  state.typedMirror = '';

  // Before screenshot
  const sBefore = await screenshot(page, `f${functionNumber}-${stepCounter}-before`);

  // Type input
  const inputSel = '#chat-input';
  await page.waitForSelector(inputSel, { timeout: 15000 });
  // Safety: ensure SOME session is active in the UI; if not, click the requested session.
  await page.waitForSelector('.sidebar-item.active[data-testid^="session-"]', { timeout: 8000 }).catch(async () => {
    log('[sendChatViaUI] no active session in UI; clicking requested session');
    await page.evaluate((sid) => {
      const el = document.querySelector(`[data-testid="session-${sid}"]`);
      if (el) el.click();
    }, sessionId).catch(()=>{});
    await sleep(600);
  });
  await page.click(inputSel);
  await page.fill(inputSel, ''); // clear
  for (const ch of composed.input) {
    await page.type(inputSel, ch, { delay: TYPE_DELAY_MS });
    state.typedMirror += ch;
  }
  const sTyped = await screenshot(page, `f${functionNumber}-${stepCounter}-typed`);

  // Click send, wait for chat response
  let chatRespBody = '';
  const chatRespP = page.waitForResponse(r => r.url().includes('/api/chat') && r.request().method() === 'POST', { timeout: 90000 });
  await page.click('#btn-send').catch(()=>{});
  let chatResp;
  try {
    chatResp = await chatRespP;
    try { chatRespBody = await chatResp.text(); } catch {}
  } catch (e) {
    log('[sendChatViaUI] no /api/chat response captured:', e.message);
  }

  // Wait for streaming to finish — poll for the [DONE] marker in the assistant message
  // The UI removes the cursor-blink span when streaming ends.
  await page.waitForFunction(() => {
    const msgs = document.querySelectorAll('.msg-assistant .msg-text');
    if (!msgs.length) return false;
    const last = msgs[msgs.length - 1];
    return !last.querySelector('.cursor-blink');
  }, { timeout: 90000 }).catch(()=>{});

  // Live-stream the assistant text into state
  const assistantText = await page.evaluate(() => {
    const msgs = document.querySelectorAll('.msg-assistant .msg-text');
    if (!msgs.length) return '';
    return (msgs[msgs.length - 1].innerText || '').trim();
  }).catch(()=> '');
  state.appResponseStream = assistantText;

  // After screenshot
  const sAfter = await screenshot(page, `f${functionNumber}-${stepCounter}-after`);

  // Wait briefly for tractatus update SSE to fire+complete
  let treeAfter = treeBefore, delta = null;
  if (projectId) {
    treeAfter = await waitForTreeGrowth(context, projectId, nodesBefore, 45000);
    await snapshotTree(projectId, `f${functionNumber}-${stepCounter}-after`, treeAfter);
    delta = computeTreeDelta(treeBefore, treeAfter);
    state.treeDelta = delta;
  }

  // Console errors
  const calls = networkCallsSince(startNetIdx);
  const sseEvents = chatRespBody ? sseEventsFromBody(chatRespBody) : [];
  const invariantViolations = [];
  if (delta) {
    if (delta.delta < 1) invariantViolations.push('Invariant A: tree grew by 0 after chat exchange');
    if (delta.delta > 8) invariantViolations.push(`Invariant A: tree grew by ${delta.delta} (>8)`);
    if (!delta.allTagsValid) invariantViolations.push('Invariant A: at least one new node has invalid tag prefix');
    if (!delta.allIdsValid) invariantViolations.push('Invariant A: at least one new node id is not decimal-formatted');
  }
  for (const c of calls) if (c.status >= 500) invariantViolations.push(`HTTP ${c.status} on ${c.method} ${new URL(c.url).pathname}`);

  const interaction = {
    timestamp: new Date().toISOString(),
    functionNumber, functionName, stepDescription,
    url: page.url(),
    isInteractive: true,
    expectedRoutes: ['POST /api/chat'],
    r1Approach: composed.approach,
    r1Reasoning: composed.reasoning,
    r1Input: composed.input,
    appResponse: {
      pageTextAfter: assistantText,
      errorsInConsole: [],
      networkCalls: calls,
      sseEvents,
    },
    tractatusDelta: delta,
    screenshots: [sBefore, sTyped, sAfter].filter(Boolean),
    invariantViolations,
  };
  const j = await judge(interaction);
  interaction.judgeCritique = j.critique;
  interaction.judgeConcerns = j.concerns || [];
  for (const v of j.violations || []) interaction.invariantViolations.push(v);
  state.judgeCritique = j.critique;

  recordInteraction(interaction);
  return { interaction, treeAfter, nodesAfter: delta ? delta.nodesAfter : nodesBefore };
}

// ─── Generic non-chat interactive step recorder ─────────────────────────────
async function recordStep(page, opts, fn) {
  const { functionNumber, functionName, stepDescription, expectedRoutes, isInteractive } = opts;
  stepCounter++;
  const startNetIdx = networkCalls.length;
  state.currentFunction = `Function ${functionNumber} — ${functionName}`;
  state.currentStep = stepDescription;
  state.url = page.url();
  state.judgeCritique = '';
  state.appResponseStream = '';
  state.r1Approach = opts.r1Approach || 'navigation';
  state.r1Reasoning = opts.r1Reasoning || stepDescription;
  state.r1Input = opts.r1Input || '';
  state.typedMirror = '';

  const screenshots = [];
  const sBefore = await screenshot(page, `f${functionNumber}-${stepCounter}-before`);
  if (sBefore) screenshots.push(sBefore);

  let fnResult = {};
  try { fnResult = (await fn(screenshots)) || {}; } catch (e) {
    log(`[recordStep f${functionNumber}] error:`, e.message);
    fnResult = { error: e.message };
  }

  if (isInteractive && screenshots.length < 3) {
    // Capture "after typing" + "after response" if caller didn't
    const sExtra = await screenshot(page, `f${functionNumber}-${stepCounter}-mid`);
    if (sExtra) screenshots.push(sExtra);
  }
  const sAfter = await screenshot(page, `f${functionNumber}-${stepCounter}-after`);
  if (sAfter) screenshots.push(sAfter);

  const calls = networkCallsSince(startNetIdx);
  const invariantViolations = [];
  for (const c of calls) if (c.status >= 500) invariantViolations.push(`HTTP ${c.status} on ${c.method} ${new URL(c.url).pathname}`);
  if (fnResult.violation) invariantViolations.push(fnResult.violation);

  const pageText = await page.evaluate(() => document.body.innerText.slice(0, 4000)).catch(()=> '');
  state.appResponseStream = pageText.slice(0, 1500);

  const interaction = {
    timestamp: new Date().toISOString(),
    functionNumber, functionName, stepDescription,
    url: page.url(),
    isInteractive: !!isInteractive,
    expectedRoutes: expectedRoutes || [],
    r1Approach: opts.r1Approach || 'navigation',
    r1Reasoning: opts.r1Reasoning || stepDescription,
    r1Input: opts.r1Input || '',
    appResponse: {
      pageTextAfter: pageText,
      errorsInConsole: [],
      networkCalls: calls,
      sseEvents: fnResult.sseEvents || [],
      extra: fnResult.extra || null,
    },
    tractatusDelta: null,
    screenshots,
    invariantViolations,
  };
  const j = await judge(interaction);
  interaction.judgeCritique = j.critique;
  interaction.judgeConcerns = j.concerns || [];
  for (const v of j.violations || []) interaction.invariantViolations.push(v);
  state.judgeCritique = j.critique;
  recordInteraction(interaction);
  return { interaction, fnResult };
}

// ─── Functions 1–14 ─────────────────────────────────────────────────────────
async function f1_loadHomeChat(page, context) {
  state.status = 'f1';
  // We are already on the app after login; do NOT re-goto.
  // Wait for the sidebar to populate (an active project sidebar-item + active session sidebar-item).
  await page.waitForSelector('[data-testid^="project-"]', { timeout: 30000 }).catch(()=>{});
  await page.waitForSelector('[data-testid^="session-"]', { timeout: 30000 }).catch(()=>{});
  // Read the currently-active session from DOM (the active sidebar-item under session list).
  const ctx = await page.evaluate(() => {
    const activeSession = document.querySelector('.sidebar-item.active[data-testid^="session-"]');
    const sid = activeSession ? activeSession.getAttribute('data-testid').replace(/^session-/, '') : null;
    const activeProject = document.querySelector('.sidebar-item.active[data-testid^="project-"]');
    const pid = activeProject ? activeProject.getAttribute('data-testid').replace(/^project-/, '') : null;
    return { pid, sid };
  });
  let mainProjectId = ctx.pid;
  let sessionId = ctx.sid;
  if (!mainProjectId) {
    const { body: projects } = await apiFetch(context, '/api/projects');
    if (!projects || !projects.length) { log('[f1] no projects'); return; }
    mainProjectId = projects[0].id;
  }
  if (!sessionId) {
    log('[f1] no active session in UI; creating via API and reloading');
    const created = await apiFetch(context, `/api/projects/${mainProjectId}/sessions`, { method: 'POST', body: { title: 'R1 home chat' } });
    sessionId = created.body.id;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid^="session-"]', { timeout: 15000 }).catch(()=>{});
  }
  log(`[f1] using project ${mainProjectId} session ${sessionId}`);
  const mainProject = { id: mainProjectId };
  await sendChatViaUI(page, context, mainProject.id, sessionId, {
    functionNumber: 1,
    functionName: 'Home chat (default project)',
    stepDescription: 'Send a simple chat from a freshly-loaded page',
    approachHint: 'substantive_question — ask a clear scholarly question to test happy-path streaming',
  });
}

async function f2_projectsList(page, context) {
  state.status = 'f2';
  await recordStep(page, {
    functionNumber: 2, functionName: 'Projects list',
    stepDescription: 'Confirm sidebar project count equals GET /api/projects count',
    expectedRoutes: ['GET /api/projects'],
    isInteractive: false,
    r1Reasoning: 'Reconcile UI render with backend list',
  }, async () => {
    const { body: apiList } = await apiFetch(context, '/api/projects');
    const uiCount = await page.evaluate(() => document.querySelectorAll('[data-testid^="project-"]').length).catch(()=> -1);
    return { extra: { apiCount: apiList.length, uiCount }, violation: (uiCount === -1 || uiCount < apiList.length) ? `UI shows ${uiCount} projects but API returned ${apiList.length}` : null };
  });
}

async function f3_createProject(page, context) {
  state.status = 'f3';
  const projectName = `R1 Test Project ${Date.now().toString(36)}`;
  stepCounter++;
  const startIdx = networkCalls.length;
  state.currentFunction = 'Function 3 — Create project';
  state.currentStep = `Click + New Project and type "${projectName}"`;
  state.r1Approach = 'create_project'; state.r1Reasoning = 'Use the real sidebar button so the UI path is exercised'; state.r1Input = projectName;
  const sBefore = await screenshot(page, `f3-${stepCounter}-before`);

  // The new-project flow opens a modal: #project-modal with #project-name-input + #confirm-project
  await page.click('#btn-new-project').catch(()=>{});
  await page.waitForSelector('#project-modal.active', { timeout: 5000 }).catch(()=>{});
  await page.fill('#project-name-input', projectName);
  // Watch for the POST then click confirm
  const postP = page.waitForResponse(r => r.url().endsWith('/api/projects') && r.request().method() === 'POST', { timeout: 15000 });
  await page.click('#confirm-project').catch(()=>{});
  let projectId = null;
  try {
    const resp = await postP;
    const body = await resp.json().catch(()=>null);
    if (body && body.id) projectId = body.id;
  } catch (e) { log('[f3] no POST captured:', e.message); }
  await sleep(1500);
  const sAfter = await screenshot(page, `f3-${stepCounter}-after`);
  const sAfter2 = await screenshot(page, `f3-${stepCounter}-after2`);

  // Verify it appears in list
  const { body: list } = await apiFetch(context, '/api/projects');
  const found = list && list.find(p => p.id === projectId);
  const calls = networkCallsSince(startIdx);
  state.testProjectId = projectId;
  state.testProjectName = projectName;

  const interaction = {
    timestamp: new Date().toISOString(),
    functionNumber: 3, functionName: 'Create project',
    stepDescription: state.currentStep, url: page.url(),
    isInteractive: true,
    expectedRoutes: ['POST /api/projects'],
    r1Approach: state.r1Approach, r1Reasoning: state.r1Reasoning, r1Input: projectName,
    appResponse: { pageTextAfter: '', errorsInConsole: [], networkCalls: calls, sseEvents: [], extra: { projectId, found: !!found } },
    tractatusDelta: null,
    screenshots: [sBefore, sAfter, sAfter2].filter(Boolean),
    invariantViolations: found ? [] : ['Created project not present in GET /api/projects'],
  };
  const j = await judge(interaction);
  interaction.judgeCritique = j.critique; interaction.judgeConcerns = j.concerns || [];
  for (const v of j.violations || []) interaction.invariantViolations.push(v);
  recordInteraction(interaction);
  return projectId;
}

async function f4_projectChat(page, context, projectId) {
  state.status = 'f4';
  // Ensure a session exists
  const { body: sessions } = await apiFetch(context, `/api/projects/${projectId}/sessions`);
  let sessionId = (sessions && sessions[0]) ? sessions[0].id : null;
  if (!sessionId) {
    const created = await apiFetch(context, `/api/projects/${projectId}/sessions`, { method: 'POST', body: { title: 'R1 main' } });
    sessionId = created.body.id;
  }
  // Click the project in the sidebar
  await page.evaluate((pid) => {
    const el = document.querySelector(`[data-testid="project-${pid}"]`)
      || Array.from(document.querySelectorAll('[data-testid^="project-"]')).find(e => e.textContent.includes('R1 Test'));
    if (el) el.click();
  }, projectId).catch(()=>{});
  await sleep(800);

  const hints = [
    'tag_probe_OPEN — ask an open-ended scholarly question with no resolution',
    'tag_probe_RESOLVED — ask a yes/no question that has a definite answer',
    'tag_probe_REJECTS — pose a contradictory follow-up to the previous answer',
  ];
  for (let i = 0; i < 3; i++) {
    await sendChatViaUI(page, context, projectId, sessionId, {
      functionNumber: 4, functionName: 'Project chat',
      stepDescription: `Exchange #${i+1} in test project (Invariant A check)`,
      approachHint: hints[i],
    });
  }
  return sessionId;
}

async function f5_memoryHierarchy(page, context, projectId) {
  state.status = 'f5';
  await recordStep(page, {
    functionNumber: 5, functionName: 'Memory hierarchy viewer',
    stepDescription: 'Click 🧠 Memory Hierarchy button; reconcile UI tiers with API',
    expectedRoutes: ['GET /api/projects/:id/memory-hierarchy'],
    isInteractive: true,
    r1Reasoning: 'Confirm rendered tiers match the memory-hierarchy API',
  }, async (screenshots) => {
    const postP = page.waitForResponse(r => /\/api\/projects\/[^/]+\/memory-hierarchy/.test(r.url()), { timeout: 15000 });
    await page.click('#btn-memory-hierarchy').catch(()=>{});
    let apiResp = null;
    try { const r = await postP; apiResp = await r.json().catch(()=>null); } catch (e) { log('[f5]', e.message); }
    await sleep(1200);
    const s = await screenshot(page, `f5-${stepCounter}-modal`);
    if (s) screenshots.push(s);
    const modalText = await page.evaluate(() => {
      const m = document.querySelector('.memory-hierarchy-modal, .modal-content, .memory-modal');
      return m ? m.innerText.slice(0, 3000) : document.body.innerText.slice(0, 3000);
    }).catch(()=> '');
    await page.keyboard.press('Escape').catch(()=>{});
    await sleep(300);
    return { extra: { apiTierCount: apiResp ? (apiResp.tiers || []).length : null, modalTextExcerpt: modalText.slice(0, 800) } };
  });
}

async function f6_crossSessionPersistence(page, context, projectId) {
  state.status = 'f6';
  const SECRET = 'XQ-77-blue';
  // Get a fresh session for the seed
  const { body: sessions0 } = await apiFetch(context, `/api/projects/${projectId}/sessions`);
  const seedSessionId = sessions0 && sessions0[0] ? sessions0[0].id : null;
  if (!seedSessionId) { log('[f6] no seed session'); return; }

  // Plant the secret via UI
  await sendChatViaUI(page, context, projectId, seedSessionId, {
    functionNumber: 6, functionName: 'Cross-session persistence (seed)',
    stepDescription: `Plant distinctive fact: "${SECRET}"`,
    approachHint: `Send EXACT input: "Remember this for later: the test code is ${SECRET}. Acknowledge that you have it."`,
  });
  // Override input — we need the secret in plaintext, not whatever R1 paraphrases
  // (Re-do via direct API to guarantee the literal string is there)
  await sleep(2000);
  const directPayload = `Remember this for later: the test code is ${SECRET}. Please acknowledge.`;
  // Plant by calling /api/chat + /api/tractatus/update directly so tree is updated
  await callChatDirect(context, projectId, seedSessionId, directPayload);

  // Wait for tree to contain it
  let found = false;
  for (let i = 0; i < 20; i++) {
    const tree = await getTractatus(context, projectId);
    const flat = flattenTree(tree);
    if (Object.values(flat).some(v => String(v).includes(SECRET))) { found = true; break; }
    await sleep(2000);
  }

  // Open a brand-new session
  const created = await apiFetch(context, `/api/projects/${projectId}/sessions`, { method: 'POST', body: { title: 'R1 recall test' } });
  const newSid = created.body.id;
  // Click into it in the UI
  await page.evaluate((sid) => {
    const el = document.querySelector(`[data-testid="session-${sid}"]`);
    if (el) el.click();
  }, newSid).catch(()=>{});
  await sleep(600);

  // Ask via UI for the test code
  stepCounter++;
  const startIdx = networkCalls.length;
  state.currentFunction = 'Function 6 — Cross-session recall';
  state.currentStep = 'In a brand-new session, ask: "What was the test code I mentioned earlier?"';
  const ask = 'What was the test code I asked you to remember earlier? Reply with just the code.';
  state.r1Input = ask; state.r1Approach = 'memory_callback'; state.r1Reasoning = 'Force cross-session memory injection via tree';
  const sB = await screenshot(page, `f6-recall-${stepCounter}-before`);
  await page.fill('#chat-input', '');
  for (const ch of ask) await page.type('#chat-input', ch, { delay: TYPE_DELAY_MS });
  const sT = await screenshot(page, `f6-recall-${stepCounter}-typed`);
  const respP = page.waitForResponse(r => r.url().includes('/api/chat') && r.request().method() === 'POST', { timeout: 90000 });
  await page.click('#btn-send').catch(()=>{});
  let body = '';
  try { const r = await respP; body = await r.text(); } catch (e) { log('[f6]', e.message); }
  await page.waitForFunction(() => {
    const m = document.querySelectorAll('.msg-assistant .msg-text'); if (!m.length) return false;
    return !m[m.length-1].querySelector('.cursor-blink');
  }, { timeout: 90000 }).catch(()=>{});
  const text = await page.evaluate(() => {
    const m = document.querySelectorAll('.msg-assistant .msg-text'); return m.length ? (m[m.length-1].innerText || '').trim() : '';
  });
  const sA = await screenshot(page, `f6-recall-${stepCounter}-after`);

  const recalled = text.toLowerCase().includes(SECRET.toLowerCase());
  const calls = networkCallsSince(startIdx);
  const interaction = {
    timestamp: new Date().toISOString(),
    functionNumber: 6, functionName: 'Cross-session recall test',
    stepDescription: 'In a brand-new session, recall the secret', url: page.url(),
    isInteractive: true, expectedRoutes: ['POST /api/chat'],
    r1Approach: 'memory_callback', r1Reasoning: 'Test Invariant C', r1Input: ask,
    appResponse: { pageTextAfter: text, errorsInConsole: [], networkCalls: calls, sseEvents: sseEventsFromBody(body), extra: { secret: SECRET, secret_in_tree_before_ask: found, recalled } },
    tractatusDelta: null,
    screenshots: [sB, sT, sA].filter(Boolean),
    invariantViolations: recalled ? [] : [`Invariant C VIOLATION: new session failed to recall "${SECRET}"`],
  };
  const j = await judge(interaction);
  interaction.judgeCritique = j.critique; interaction.judgeConcerns = j.concerns || [];
  for (const v of j.violations || []) interaction.invariantViolations.push(v);
  recordInteraction(interaction);
}

// Call /api/chat directly + trigger /api/tractatus/update (mirrors what the browser client does)
async function callChatDirect(context, projectId, sessionId, message) {
  const cookieHeader = await getCookieHeader(context);
  const resp = await fetch(APP_URL + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': cookieHeader },
    body: JSON.stringify({ projectId, sessionId, message, model: 'claude', responseLength: 'concise' }),
  });
  let assistant = ''; let userMsgForTree = message;
  const events = await readSSE(resp, (e) => {
    if (e.type === 'text' && e.text) assistant += e.text;
  });
  networkLogStream.write(JSON.stringify({
    ts: new Date().toISOString(), method: 'POST', url: APP_URL + '/api/chat',
    status: resp.status, source: 'off-band', request_body: JSON.stringify({ projectId, sessionId, message }).slice(0,8000),
    response_body: 'SSE-events:' + events.length + ' assistant-chars:' + assistant.length,
  }) + '\n');
  // Trigger tree update
  try {
    const r2 = await fetch(APP_URL + '/api/tractatus/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': cookieHeader },
      body: JSON.stringify({ projectId, userMessage: userMsgForTree, assistantResponse: assistant }),
    });
    await readSSE(r2, () => {});
  } catch (e) { log('[callChatDirect] update failed:', e.message); }
  return { assistant, sseCount: events.length };
}

async function f7_compression(page, context, projectId) {
  state.status = 'f7';
  if (SKIP_FUNCTIONS.has('7')) { log('[f7] SKIPPED'); return; }
  log('[f7] Compression test — sending up to', COMPRESSION_TEST_MAX_ITERATIONS, 'messages...');
  const { body: sessions } = await apiFetch(context, `/api/projects/${projectId}/sessions`);
  const sid = sessions[0].id;

  let nodes = Object.keys(flattenTree(await getTractatus(context, projectId))).length;
  log('[f7] start node count:', nodes);
  let crossedAt = -1; let compressionFired = false; let postCrossNodes = nodes;
  for (let i = 1; i <= COMPRESSION_TEST_MAX_ITERATIONS; i++) {
    state.currentFunction = `Function 7 — Compression`;
    state.currentStep = `Exchange #${i}, tree now ${nodes} nodes`;
    state.r1Input = `Tell me fact #${i} about Wittgenstein's life or philosophy in one sentence.`;
    await callChatDirect(context, projectId, sid, state.r1Input);
    nodes = Object.keys(flattenTree(await getTractatus(context, projectId))).length;
    log(`[f7] after #${i}: ${nodes} nodes`);
    if (crossedAt < 0 && nodes >= 200) crossedAt = i;
    if (crossedAt >= 0) {
      // Check compression: live tree trimmed to ~30 OR archive appeared
      if (nodes < 60) { compressionFired = true; postCrossNodes = nodes; break; }
      if (i - crossedAt >= 5) break;
    }
  }
  // Check memory hierarchy for archive tier
  const { body: mem } = await apiFetch(context, `/api/projects/${projectId}/memory-hierarchy`);
  const archiveTierPresent = mem && Array.isArray(mem.tiers) && mem.tiers.some(t => (t.tier || t.tier_number || 1) >= 2);
  const violationsLocal = [];
  if (crossedAt < 0) {
    sanityFailures.push({ interaction: 'f7', reason: `Compression test never crossed 200 nodes (max iters ${COMPRESSION_TEST_MAX_ITERATIONS}; final ${nodes})` });
  } else {
    if (!compressionFired) violationsLocal.push('Invariant B VIOLATION: compression did not fire within 5 exchanges of crossing 200');
    if (compressionFired && (postCrossNodes < 20 || postCrossNodes > 50)) violationsLocal.push(`Invariant B WARNING: live tree post-compression is ${postCrossNodes} (expected 20-50)`);
    if (!archiveTierPresent) violationsLocal.push('Invariant B VIOLATION: no archive tier appeared via memory-hierarchy');
  }
  for (const v of violationsLocal) violations.push({ interaction: 'f7 compression', violation: v });

  const interaction = {
    timestamp: new Date().toISOString(),
    functionNumber: 7, functionName: 'Compression at >=200 nodes',
    stepDescription: `Force-grew tree, observed ${nodes} final nodes; crossed at ${crossedAt}; compressed: ${compressionFired}`,
    url: APP_URL, isInteractive: false, expectedRoutes: [],
    r1Approach: 'force_grow_then_observe', r1Reasoning: 'Repeated short exchanges via direct API to trigger compression',
    r1Input: `${COMPRESSION_TEST_MAX_ITERATIONS} iterations of single-fact prompts`,
    appResponse: { pageTextAfter: '', errorsInConsole: [], networkCalls: [], sseEvents: [], extra: { crossedAt, compressionFired, postCrossNodes, archiveTierPresent } },
    tractatusDelta: null, screenshots: [],
    invariantViolations: violationsLocal,
  };
  interaction.judgeCritique = `Compression test: crossed 200 at iteration ${crossedAt}; live tree settled at ${postCrossNodes} nodes; archive tier present: ${archiveTierPresent}. ` +
    (violationsLocal.length ? `Violations: ${violationsLocal.join('; ')}` : 'Behavior matches blueprint within tolerance.');
  recordInteraction(interaction);
}

async function f8_longDoc(page, context, projectId) {
  state.status = 'f8';
  if (SKIP_FUNCTIONS.has('8')) { log('[f8] SKIPPED'); return; }
  const { body: sessions } = await apiFetch(context, `/api/projects/${projectId}/sessions`);
  const sid = sessions[0].id;
  stepCounter++;
  const startIdx = networkCalls.length;
  state.currentFunction = 'Function 8 — Long document (coherence)';
  state.currentStep = `Generate a ${LONG_DOC_TARGET_WORDS}-word paper directly via /api/coherence`;
  state.r1Approach = 'coherence_call'; state.r1Reasoning = 'Verify outline → section → complete event lifecycle';
  state.r1Input = `Title: "A Brief Tractatus Reading Guide" · ${LONG_DOC_TARGET_WORDS} words`;
  const sB = await screenshot(page, `f8-${stepCounter}-before`);

  const cookieHeader = await getCookieHeader(context);
  const resp = await fetch(APP_URL + '/api/coherence', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': cookieHeader },
    body: JSON.stringify({
      projectId, sessionId: sid,
      title: 'A Brief Tractatus Reading Guide',
      instructions: 'Give a 2000-word reading guide to Wittgenstein\'s Tractatus aimed at advanced undergraduates.',
      wordcount: LONG_DOC_TARGET_WORDS, doctype: 'paper', fetchResearch: false,
    }),
  });
  const events = [];
  let totalText = '';
  await readSSE(resp, (e) => {
    events.push(e);
    if (e.type === 'section_token' && e.text) totalText += e.text;
    if (e.type === 'status' || e.type === 'progress' || e.type === 'section_start' || e.type === 'section_end' || e.type === 'complete') {
      state.appResponseStream = `[${e.type}] ${e.message || e.title || ''}`.slice(0, 400);
    }
  });
  const sA = await screenshot(page, `f8-${stepCounter}-after`);
  const wordCount = totalText.split(/\s+/).filter(Boolean).length;
  const sawTypes = new Set(events.map(e => e.type));
  const missing = ['status', 'section_start', 'section_end', 'complete'].filter(t => !sawTypes.has(t));
  const calls = networkCallsSince(startIdx);

  // Wait for tractatus to gain a DOCUMENT node
  await sleep(3000);
  const tree = await getTractatus(context, projectId);
  const docTagSeen = Object.values(flattenTree(tree)).some(v => String(v).startsWith('DOCUMENT'));

  const violationsLocal = [];
  if (missing.length) violationsLocal.push(`Coherence missing event types: ${missing.join(', ')}`);
  if (wordCount < LONG_DOC_TARGET_WORDS * 0.5) violationsLocal.push(`Word count ${wordCount} far below target ${LONG_DOC_TARGET_WORDS}`);

  const interaction = {
    timestamp: new Date().toISOString(),
    functionNumber: 8, functionName: 'Long document generator',
    stepDescription: state.currentStep, url: APP_URL,
    isInteractive: true,
    expectedRoutes: ['POST /api/coherence'],
    r1Approach: 'coherence_call', r1Reasoning: state.r1Reasoning, r1Input: state.r1Input,
    appResponse: { pageTextAfter: totalText.slice(0, 4000), errorsInConsole: [], networkCalls: calls, sseEvents: events.slice(-50), extra: { wordCount, eventTypes: [...sawTypes], document_node_seen: docTagSeen } },
    tractatusDelta: null, screenshots: [sB, sA].filter(Boolean),
    invariantViolations: violationsLocal,
  };
  const j = await judge(interaction);
  interaction.judgeCritique = j.critique; interaction.judgeConcerns = j.concerns || [];
  recordInteraction(interaction);
}

async function f9_sessions(page, context, projectId) {
  state.status = 'f9';
  await recordStep(page, {
    functionNumber: 9, functionName: 'Multiple sessions per project',
    stepDescription: 'GET /api/projects/:id/sessions; switch between sessions in UI',
    expectedRoutes: ['GET /api/projects/:id/sessions'],
    isInteractive: true,
    r1Reasoning: 'Confirm each session loads independently',
  }, async (screenshots) => {
    const { body: sessions } = await apiFetch(context, `/api/projects/${projectId}/sessions`);
    const uiCount = await page.evaluate(() => document.querySelectorAll('[data-testid^="session-"]').length).catch(()=> 0);
    if (sessions && sessions.length >= 2) {
      // Click each
      for (let i = 0; i < Math.min(2, sessions.length); i++) {
        await page.evaluate((sid) => {
          const el = document.querySelector(`[data-testid="session-${sid}"]`);
          if (el) el.click();
        }, sessions[i].id).catch(()=>{});
        await sleep(500);
        const s = await screenshot(page, `f9-${stepCounter}-session-${i}`);
        if (s) screenshots.push(s);
      }
    }
    return { extra: { apiSessions: sessions ? sessions.length : 0, uiSessions: uiCount } };
  });
}

async function f10_renameProject(page, context, projectId) {
  state.status = 'f10';
  const newName = state.testProjectName + ' (renamed)';
  await recordStep(page, {
    functionNumber: 10, functionName: 'Rename project',
    stepDescription: `Rename via POST /api/projects/:id/name to "${newName}"`,
    expectedRoutes: ['POST /api/projects/:id/name'],
    isInteractive: true,
    r1Input: newName, r1Approach: 'rename_via_api', r1Reasoning: 'UI rename uses inline edit + POST; we call directly for determinism + reload to verify',
  }, async (screenshots) => {
    await apiFetch(context, `/api/projects/${projectId}/name`, { method: 'POST', body: { name: newName } });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await sleep(800);
    const s = await screenshot(page, `f10-${stepCounter}-reloaded`);
    if (s) screenshots.push(s);
    const seenInUI = await page.evaluate((n) => document.body.innerText.includes(n), newName);
    return { extra: { seenInUI }, violation: seenInUI ? null : 'Renamed name does not appear in UI after reload' };
  });
}

async function f11_treeViz(page, context, projectId) {
  state.status = 'f11';
  await recordStep(page, {
    functionNumber: 11, functionName: 'Tractatus tree visualization',
    stepDescription: 'Open Memory Hierarchy modal and visually inspect tree structure',
    expectedRoutes: ['GET /api/projects/:id/memory-hierarchy'],
    isInteractive: true,
    r1Reasoning: 'Judge inspects: hierarchical structure, tag colors, decimal IDs',
  }, async (screenshots) => {
    await page.click('#btn-memory-hierarchy').catch(()=>{});
    await sleep(1500);
    const s = await screenshot(page, `f11-${stepCounter}-modal`);
    if (s) screenshots.push(s);
    const txt = await page.evaluate(() => {
      const m = document.querySelector('.memory-hierarchy-modal, .modal-content');
      return m ? m.innerText.slice(0, 4000) : '';
    });
    await page.keyboard.press('Escape').catch(()=>{});
    return { extra: { modal_excerpt: txt.slice(0, 1200) } };
  });
}

async function f12_deleteProject(page, context, projectId) {
  state.status = 'f12';
  await recordStep(page, {
    functionNumber: 12, functionName: 'Project deletion (cleanup)',
    stepDescription: `DELETE /api/projects/${projectId} and verify it no longer appears`,
    expectedRoutes: ['DELETE /api/projects/:id'],
    isInteractive: true,
    r1Approach: 'cleanup', r1Reasoning: 'Final cleanup, verify cascade',
    r1Input: `DELETE /api/projects/${projectId}`,
  }, async (screenshots) => {
    const del = await apiFetch(context, `/api/projects/${projectId}`, { method: 'DELETE' });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await sleep(800);
    const s = await screenshot(page, `f12-${stepCounter}-after`);
    if (s) screenshots.push(s);
    const { body: list } = await apiFetch(context, '/api/projects');
    const stillThere = list && list.some(p => p.id === projectId);
    return { extra: { delete_status: del.status, stillThere }, violation: stillThere ? 'Project still appears in GET /api/projects after delete' : null };
  });
}

async function f13_voice(page, context) {
  state.status = 'f13';
  await recordStep(page, {
    functionNumber: 13, functionName: 'Voice (limited — no audio source)',
    stepDescription: 'Confirm #btn-mic exists and clicking it requests mic permission (no audio sent)',
    expectedRoutes: [],
    isInteractive: false,
    r1Reasoning: 'R1 cannot speak; verifies button presence + that /api/transcribe exists',
  }, async () => {
    const hasBtn = await page.evaluate(() => !!document.querySelector('#btn-mic'));
    // Don't click — would trigger a permission prompt we can't dismiss in headless.
    // Verify /api/transcribe rejects empty multipart with 400 (proves route exists & is wired)
    const cookieHeader = await getCookieHeader(context);
    const r = await fetch(APP_URL + '/api/transcribe', { method: 'POST', headers: { 'Cookie': cookieHeader } });
    return { extra: { hasMicButton: hasBtn, transcribe_empty_post_status: r.status } };
  });
}

async function f14_diagnostic(page, context) {
  state.status = 'f14';
  await recordStep(page, {
    functionNumber: 14, functionName: 'Diagnostic endpoint',
    stepDescription: 'POST /api/diagnostic/run and capture full pass/fail grid',
    expectedRoutes: ['POST /api/diagnostic/run'],
    isInteractive: true,
    r1Reasoning: 'Server self-check; failing checks become CRITICAL violations',
  }, async (screenshots) => {
    const cookieHeader = await getCookieHeader(context);
    const resp = await fetch(APP_URL + '/api/diagnostic/run', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Cookie': cookieHeader } });
    const events = await readSSE(resp, () => {});
    const results = events.filter(e => e.type === 'result');
    const failed = results.filter(r => r.status === 'fail');
    fs.writeFileSync(DIAGNOSTIC_PATH, JSON.stringify(events, null, 2));
    const s = await screenshot(page, `f14-${stepCounter}-page`);
    if (s) screenshots.push(s);
    for (const f of failed) violations.push({ interaction: 'f14 diagnostic', violation: `Diagnostic FAIL: ${f.category}/${f.name} — ${f.message}` });
    return { extra: { total: results.length, failed_count: failed.length, failed_names: failed.map(f => `${f.category}/${f.name}`) } };
  });
}

// ─── Login ─────────────────────────────────────────────────────────────────
async function login(page) {
  state.status = 'loading app';
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  // Login was removed from the app — it auto-starts with the default user.
  await page.waitForSelector('#chat-input', { timeout: 15000 });
  log('App loaded (no login required)');
}

// ─── Report generation ─────────────────────────────────────────────────────
function buildReportHTML() {
  const grouped = {};
  for (const i of interactions) {
    const k = `Function ${i.functionNumber} — ${i.functionName}`;
    (grouped[k] = grouped[k] || []).push(i);
  }
  const toc = Object.keys(grouped).map(k => `<li><a href="#${escapeHtml(k.replace(/\W+/g, '-'))}">${escapeHtml(k)}</a></li>`).join('');
  const sections = Object.entries(grouped).map(([k, list]) => {
    const items = list.map((i, idx) => {
      const shots = (i.screenshots || []).map(s => `<img src="${escapeHtml(s)}" style="max-width:520px;display:block;margin:6px 0;border:1px solid #ccc">`).join('');
      const calls = (i.appResponse.networkCalls || []).map(c =>
        `<tr><td>${escapeHtml(c.method)}</td><td>${escapeHtml(new URL(c.url).pathname)}</td><td>${c.status}</td><td>${c.ms}ms</td><td><code>${escapeHtml((c.response_body_excerpt||'').slice(0,400))}</code></td></tr>`
      ).join('');
      const sse = (i.appResponse.sseEvents || []).slice(0, 60).map(e => `<code>${escapeHtml(JSON.stringify(e)).slice(0,250)}</code>`).join('<br>');
      const td = i.tractatusDelta;
      const tdBlock = td ? `<div style="background:#f0fdf4;border:1px solid #16a34a;padding:10px;margin:6px 0;border-radius:4px">
        <b>Tractatus delta</b><br>
        nodes: ${td.nodesBefore} → ${td.nodesAfter} (Δ ${td.delta})<br>
        new ids: ${td.newNodeIds.join(', ') || '(none)'}<br>
        new tags: ${td.newNodeTags.join(', ') || '(none)'}<br>
        tags valid: <b style="color:${td.allTagsValid?'#16a34a':'#dc2626'}">${td.allTagsValid?'YES':'NO'}</b> ·
        ids valid: <b style="color:${td.allIdsValid?'#16a34a':'#dc2626'}">${td.allIdsValid?'YES':'NO'}</b>
        ${td.violationNote ? `<div style="color:#dc2626;font-weight:bold">⚠ ${escapeHtml(td.violationNote)}</div>` : ''}
      </div>` : '';
      const violationsBlock = (i.invariantViolations || []).length ? `<div style="background:#fef2f2;border:1px solid #dc2626;padding:8px;margin:6px 0;border-radius:4px"><b style="color:#dc2626">INVARIANT VIOLATIONS</b><ul>${i.invariantViolations.map(v=>`<li>${escapeHtml(v)}</li>`).join('')}</ul></div>` : '';
      const concernsBlock = (i.judgeConcerns || []).length ? `<div style="background:#fffbeb;border:1px solid #d97706;padding:8px;margin:6px 0;border-radius:4px"><b>Judge concerns</b><ul>${i.judgeConcerns.map(c=>`<li>${escapeHtml(c)}</li>`).join('')}</ul></div>` : '';
      return `<div style="border-top:1px solid #ddd;padding:14px 0">
        <h3>${escapeHtml(i.stepDescription)}</h3>
        <p><b>R1 approach:</b> ${escapeHtml(i.r1Approach)}</p>
        <p><b>R1 reasoning:</b> <i>${escapeHtml(i.r1Reasoning)}</i></p>
        <p><b>R1 input (verbatim):</b></p><pre style="background:#f3f4f6;padding:8px;border-radius:4px;white-space:pre-wrap">${escapeHtml(i.r1Input)}</pre>
        <p><b>App page text after:</b></p><pre style="background:#f9fafb;padding:8px;border-radius:4px;white-space:pre-wrap;max-height:400px;overflow:auto">${escapeHtml((i.appResponse.pageTextAfter||'').slice(0,3000))}</pre>
        ${tdBlock}
        <p><b>Network calls</b></p>
        <table style="width:100%;font-size:12px;border-collapse:collapse"><thead><tr><th>method</th><th>path</th><th>status</th><th>ms</th><th>response excerpt</th></tr></thead><tbody>${calls}</tbody></table>
        <p><b>SSE events observed (${(i.appResponse.sseEvents||[]).length})</b></p>
        <div style="font-size:11px;max-height:200px;overflow:auto;background:#0f172a;color:#e5e7eb;padding:8px;border-radius:4px">${sse || '(none)'}</div>
        ${violationsBlock}
        ${concernsBlock}
        <p><b>Judge critique</b></p>
        <div style="background:#eff6ff;padding:10px;border-left:4px solid #2563eb;font-style:italic">${escapeHtml(i.judgeCritique||'')}</div>
        <p><b>Screenshots</b></p>${shots || '(none)'}
      </div>`;
    }).join('');
    return `<section id="${escapeHtml(k.replace(/\W+/g,'-'))}"><h2>${escapeHtml(k)}</h2>${items}</section>`;
  }).join('');

  return `<!doctype html><html><head><meta charset="utf-8"><title>R1 Report — ${RUN_TIMESTAMP}</title>
<style>body{font-family:-apple-system,sans-serif;max-width:1100px;margin:0 auto;padding:20px;color:#111}
nav{position:sticky;top:0;background:#fff;padding:10px;border-bottom:2px solid #2563eb;z-index:10}
table,th,td{border:1px solid #ddd;padding:4px}th{background:#f3f4f6;text-align:left}
h1{margin:0}h2{margin-top:30px;border-bottom:2px solid #2563eb;padding-bottom:6px}
</style></head><body>
<h1>R1 Run Report — ${RUN_TIMESTAMP}</h1>
<p>Interactions: <b>${interactions.length}</b> · Critical violations: <b style="color:#dc2626">${violations.length}</b> · Judge concerns: <b style="color:#d97706">${judgeConcerns.length}</b> · Sanity failures: <b>${sanityFailures.length}</b></p>
<nav><b>Table of contents:</b> <ul>${toc}</ul></nav>
${sections}
</body></html>`;
}

function buildFailuresMD() {
  let md = `# R1 Failures — ${RUN_TIMESTAMP}\n\n`;
  md += `## CRITICAL INVARIANT VIOLATIONS (${violations.length})\n\n`;
  if (!violations.length) md += '_None._\n\n';
  for (const v of violations) md += `- **${v.interaction}** — ${v.violation}\n`;
  md += `\n## Judge concerns (${judgeConcerns.length})\n\n`;
  if (!judgeConcerns.length) md += '_None._\n\n';
  for (const c of judgeConcerns) md += `- **${c.interaction}** — ${c.concern}\n`;
  md += `\n## Harness sanity failures (${sanityFailures.length})\n\n`;
  if (!sanityFailures.length) md += '_None._\n\n';
  for (const s of sanityFailures) md += `- **${s.interaction}** — ${s.reason}\n`;
  return md;
}

function buildSummary() {
  return `INTERACTIONS: ${interactions.length}
JUDGE CONCERNS RAISED: ${judgeConcerns.length}
CRITICAL INVARIANT VIOLATIONS: ${violations.length}
TREE INVARIANT VIOLATIONS: ${violations.filter(v => /Invariant [AB]/.test(v.violation)).length}
HARNESS SANITY FAILURES: ${sanityFailures.length}
`;
}

// ─── Main ───────────────────────────────────────────────────────────────────
(async () => {
  console.log(`\nR1 is running.`);
  console.log(`Live view:    http://localhost:${LIVE_VIEW_PORT}`);
  console.log(`Output dir:   ${OUTPUT_DIR}`);
  console.log(`Watch the live view; do not trust summary output alone.\n`);

  startLiveView();
  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  attachNetworkCapture(page);

  let projectId = null;
  try {
    await login(page);
    if (!SKIP_FUNCTIONS.has('1')) await f1_loadHomeChat(page, context);
    if (!SKIP_FUNCTIONS.has('2')) await f2_projectsList(page, context);
    if (!SKIP_FUNCTIONS.has('3')) projectId = await f3_createProject(page, context);
    if (projectId && !SKIP_FUNCTIONS.has('4')) await f4_projectChat(page, context, projectId);
    if (projectId && !SKIP_FUNCTIONS.has('5')) await f5_memoryHierarchy(page, context, projectId);
    if (projectId && !SKIP_FUNCTIONS.has('6')) await f6_crossSessionPersistence(page, context, projectId);
    if (projectId && !SKIP_FUNCTIONS.has('7')) await f7_compression(page, context, projectId);
    if (projectId && !SKIP_FUNCTIONS.has('8')) await f8_longDoc(page, context, projectId);
    if (projectId && !SKIP_FUNCTIONS.has('9')) await f9_sessions(page, context, projectId);
    if (projectId && !SKIP_FUNCTIONS.has('10')) await f10_renameProject(page, context, projectId);
    if (projectId && !SKIP_FUNCTIONS.has('11')) await f11_treeViz(page, context, projectId);
    if (!SKIP_FUNCTIONS.has('13')) await f13_voice(page, context);
    if (!SKIP_FUNCTIONS.has('14')) await f14_diagnostic(page, context);
    if (projectId && !SKIP_FUNCTIONS.has('12')) await f12_deleteProject(page, context, projectId);
  } catch (err) {
    log('[fatal] R1 harness crashed:', err.message, err.stack);
    sanityFailures.push({ interaction: 'harness', reason: 'Uncaught exception: ' + err.message });
  }

  // Write artifacts
  fs.writeFileSync(REPORT_PATH, buildReportHTML());
  fs.writeFileSync(FAILURES_PATH, buildFailuresMD());
  fs.writeFileSync(SUMMARY_PATH, buildSummary());

  state.status = 'done';
  log(`\nR1 finished.`);
  log(`Open the report:     ${REPORT_PATH}`);
  log(`Open the failures:   ${FAILURES_PATH}`);
  log(`Tree snapshots:      ${TREE_SNAPSHOT_DIR}`);
  log(`Raw transcript:      ${TRANSCRIPT_PATH}`);
  log(`Raw network log:     ${NETWORK_LOG_PATH}`);
  log(`\n${buildSummary()}`);

  // Hold live view for 60s
  await sleep(60_000);

  await context.close();
  await browser.close();
  consoleLog.end(); transcriptStream.end(); networkLogStream.end();

  let exit = 0;
  if (sanityFailures.length) exit = 3;
  else if (violations.length) exit = 2;
  else if (judgeConcerns.length) exit = 1;
  process.exit(exit);
})();
