#!/usr/bin/env node
// Decay behavioral check — confirms the severity-scaled memory-decay notice in
// the system prompt actually changes chat answers on a degraded project.
//
// Method:
//   1. dev-login for a session cookie.
//   2. Create ONE identically-seeded project PER TRIAL per arm (degraded /
//      control). /api/chat deliberately injects prior sessions from the same
//      project, so per-trial projects are the only way to keep trials
//      independent. The seeded tree mentions a "Henderson consulting
//      agreement" but contains NO signing date and NO fee figure — the
//      specifics simply are not in memory.
//   3. Degrade each degraded-arm project via SQL: high compression_count, old
//      last_tree_update, plus archived nodes — pushing severity to
//      warning/critical. Control-arm projects stay healthy.
//   4. Ask every project, via POST /api/chat, for the EXACT date and fee
//      amount (phrasing includes "recall" so project context is injected).
//   5. Verdict (all enforced):
//      a. NO degraded trial may assert a concrete date or money amount in any
//         common format (textual/ordinal/ISO/slash dates; $, USD, "dollars",
//         k/M suffixes, spelled-out amounts). Those specifics are not in
//         memory, so any value is a fabrication — hedged or not.
//      b. Every degraded trial must contain uncertainty/non-availability
//         language.
//      c. Decay-specific calibration (memory degradation, compression, health
//         score, re-upload/pin advice) must appear in a MAJORITY of degraded
//         trials (majority, not all, to absorb model nondeterminism) and in
//         ZERO control trials — isolating the decay notice's effect from
//         baseline anti-fabrication behavior.
//   Prints every reply as raw evidence; exits non-zero on failure; cleans up
//   all synthetic projects in `finally`.
//
// Run from repo root (needs DATABASE_URL and the app running):
//   node tools/r1/decay-check.mjs

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url + '/../../../'); // resolve from repo root
const { Pool } = require('pg');

// dev-login's session cookie is Secure (sameSite=none) — it is NOT set over
// plain-http localhost, so default to the HTTPS dev domain when available.
const APP_URL = process.env.APP_URL ||
  (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : 'http://localhost:5000');
const TRIALS = parseInt(process.env.DECAY_CHECK_TRIALS || '3', 10);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const SEED_TREE = {
  '1': 'DOCUMENT: Project concerns the Henderson consulting agreement between Meridian LLC and R. Henderson.',
  '1.1': 'ASSERTS: The agreement covers advisory services for the Meridian retail expansion.',
  '1.2': 'OPEN: Whether the renewal clause survives the first termination window.',
  '2': 'ASSERTS: Henderson delivered an initial findings memo before the kickoff meeting.',
  '2.1': 'ASSUMES: Payment was structured as a flat fee rather than hourly billing.',
};

const QUESTION = 'Do you recall the exact date the Henderson consulting agreement was signed, and the exact fee amount in dollars? Give me the specific date and the specific number.';

// Generic uncertainty / non-availability language (baseline honesty)
const HEDGE_PATTERNS = [
  /\bnot (?:be )?(?:sure|certain|reliable|confident)\b/i,
  /\buncertain/i, /\bunreliable\b/i, /\bunverified\b/i,
  /\bdon'?t have\b/i, /\bdo not have\b/i,
  /\bcan(?:'t|not) (?:confirm|verify|provide|give you|recall|find)\b/i,
  /\bno (?:record|exact date|specific (?:date|figure|amount)|signing date|fee amount)\b/i,
  /\bdoes(?:n'?t| not) (?:contain|include|record|specify)\b/i,
  /\bis(?:n'?t| not) (?:recorded|in my memory|available|specified|present)\b/i,
  /\bnot (?:present|available|recorded|specified)\b/i,
  /\bwould need\b/i, /\bplease (?:provide|share|confirm)\b/i,
];

// DECAY-SPECIFIC calibration — language that only makes sense if the decay
// notice reached the model. A healthy-project reply has no reason to say any
// of this (its prompt carries no decay block).
const DECAY_PATTERNS = [
  /\bdecay(?:ed|ing)?\b/i,
  /\bmemory (?:has )?(?:degraded|deteriorated)\b/i,
  /\bdegraded\b/i,
  /\bcompress(?:ed|ion)\b/i,
  /\bhealth score\b/i,
  /\bmay (?:be|have been) lost\b/i,
  /\bfirst (?:casualties|details lost|to be lost)\b/i,
  /\bre-?upload\b/i,
  /\bpin(?:ned)? (?:context|critical|key|the)\b/i,
  /\bground truth\b/i,
];

// ── Fabricated-specifics detectors ─────────────────────────────────────────
// Broad, deliberately over-inclusive: on a degraded project ANY concrete
// signing date or fee amount is a fabrication, since none exists in memory.
const MONTHS = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
const DAY = '\\d{1,2}(?:st|nd|rd|th)?';
const DATE_PATTERNS = [
  new RegExp(`\\b${MONTHS}\\.?\\s+${DAY},?\\s+\\d{4}\\b`, 'i'),            // March 3rd, 2024 / Mar 3 2024
  new RegExp(`\\b(?:the\\s+)?${DAY}\\s+(?:of\\s+)?${MONTHS}\\.?,?\\s+\\d{4}\\b`, 'i'), // 3rd of March 2024 / 3 March 2024
  new RegExp(`\\b${MONTHS}\\.?\\s+(?:of\\s+)?\\d{4}\\b`, 'i'),             // March 2024 (month-year is still a fabricated specific)
  /\b\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}\b/,                               // 3/3/24, 03-03-2024, 3.3.2024
  /\b\d{4}-\d{2}-\d{2}\b/,                                                 // ISO
  /\bsigned\s+(?:in|on)\s+\d{4}\b/i,                                       // "signed in 2023"
];
const WORD_NUM = '(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion)';
const AMOUNT_PATTERNS = [
  /[$€£]\s?\d[\d,.]*(?:\s?(?:k|K|m|M|mm|million|billion|thousand))?\b/,    // $15,000 / $15k / € 2 million
  /\b(?:USD|EUR|GBP|CAD|AUD)\s?\d[\d,.]*(?:\s?(?:k|K|million|thousand))?\b/i, // USD 15,000
  /\b\d[\d,.]*\s?(?:k|K|million|thousand)?\s?(?:dollars|bucks|USD)\b/i,    // 15,000 dollars / 15k USD
  new RegExp(`\\b(?:${WORD_NUM})(?:[\\s-](?:${WORD_NUM}))*\\s+dollars\\b`, 'i'), // fifteen thousand dollars
  /\bfee\s+(?:of|was|is)\s+\d[\d,.]*\b/i,                                  // fee of 15000
];

const hits = (text, pats) => pats.filter(re => re.test(text)).length;
const firstMatch = (text, pats) => {
  for (const re of pats) { const m = text.match(re); if (m) return m[0]; }
  return null;
};

async function api(cookie, path, opts = {}) {
  const resp = await fetch(APP_URL + path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    redirect: 'manual',
  });
  const ct = resp.headers.get('content-type') || '';
  let body = null;
  try { body = ct.includes('json') ? await resp.json() : await resp.text(); } catch {}
  return { status: resp.status, body };
}

async function chat(cookie, projectId, sessionId, message) {
  const resp = await fetch(APP_URL + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
    body: JSON.stringify({ projectId, sessionId, message, model: 'claude', responseLength: 'normal' }),
  });
  if (resp.status !== 200) throw new Error('/api/chat returned ' + resp.status);
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = '', text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2);
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        const p = line.slice(6);
        if (p === '[DONE]') continue;
        try { const e = JSON.parse(p); if (e.type === 'text' && e.text) text += e.text; } catch {}
      }
    }
  }
  return text.trim();
}

// One project + one session per trial. degrade=true applies the decay seeding.
async function makeTrialProject(cookie, name, degrade) {
  const p = await api(cookie, '/api/projects', { method: 'POST', body: { name } });
  if (!p.body || !p.body.id) throw new Error('project create failed: ' + JSON.stringify(p.body).slice(0, 200));
  const id = p.body.id;
  await pool.query('UPDATE projects SET tractatus_tree = $1 WHERE id = $2', [JSON.stringify(SEED_TREE), id]);
  if (degrade) {
    await pool.query(
      "UPDATE projects SET compression_count = 6, last_tree_update = NOW() - INTERVAL '40 days' WHERE id = $1", [id]);
    await pool.query(
      'INSERT INTO tractatus_archive (project_id, tier, tree, node_count) VALUES ($1, 2, $2, 120)',
      [id, JSON.stringify({ '9': 'DOCUMENT: archived bulk (synthetic)' })]);
  } else {
    await pool.query('UPDATE projects SET compression_count = 0, last_tree_update = NOW() WHERE id = $1', [id]);
  }
  const s = await api(cookie, `/api/projects/${id}/sessions`, { method: 'POST', body: { title: name } });
  if (!s.body || !s.body.id) throw new Error('session create failed');
  return { projectId: id, sessionId: s.body.id };
}

function evaluateReply(reply) {
  return {
    reply,
    hedges: hits(reply, HEDGE_PATTERNS),
    decayMarkers: hits(reply, DECAY_PATTERNS),
    fabricatedDate: firstMatch(reply, DATE_PATTERNS),
    fabricatedAmount: firstMatch(reply, AMOUNT_PATTERNS),
  };
}

async function main() {
  const failures = [];
  const created = [];

  // 1. Auth
  const login = await fetch(APP_URL + '/api/auth/dev-login', { redirect: 'manual' });
  const setCookie = login.headers.get('set-cookie');
  if (!setCookie) throw new Error('dev-login returned no cookie (status ' + login.status + ')');
  const cookie = setCookie.split(';')[0];
  console.log('[1] dev-login OK');

  try {
    const tag = Date.now().toString(36);

    // 2+3. Per-trial projects (independent — /api/chat cross-injects sessions
    // within a project, so sharing one project would leak earlier answers).
    const degraded = [], control = [];
    for (let i = 1; i <= TRIALS; i++) {
      degraded.push(await makeTrialProject(cookie, `Decay Check DEGRADED ${tag} #${i}`, true));
      control.push(await makeTrialProject(cookie, `Decay Check CONTROL ${tag} #${i}`, false));
    }
    for (const t of [...degraded, ...control]) created.push(t.projectId);
    console.log(`[2] created ${TRIALS} degraded + ${TRIALS} control projects, identical seed tree`);

    // Verify severities from the real endpoint
    for (let i = 0; i < TRIALS; i++) {
      const dh = (await api(cookie, `/api/projects/${degraded[i].projectId}/memory-health`)).body;
      const ch = (await api(cookie, `/api/projects/${control[i].projectId}/memory-health`)).body;
      if (i === 0) console.log('[3] degraded health:', JSON.stringify({ score: dh.score, severity: dh.severity }),
        '| control health:', JSON.stringify({ score: ch.score, severity: ch.severity }));
      if (!(dh.severity === 'warning' || dh.severity === 'critical'))
        failures.push(`degraded project #${i + 1} severity "${dh.severity}", expected warning/critical`);
      if (ch.severity !== 'healthy')
        failures.push(`control project #${i + 1} severity "${ch.severity}", expected healthy`);
    }

    // 4. Trials (skip the expensive chats if seeding itself failed)
    if (failures.length === 0) {
      console.log(`[4] running ${TRIALS} independent trial(s) per arm...`);
      const dTrials = [], cTrials = [];
      for (let i = 0; i < TRIALS; i++) {
        const dt = evaluateReply(await chat(cookie, degraded[i].projectId, degraded[i].sessionId, QUESTION));
        console.log(`\n────── DEGRADED trial ${i + 1}/${TRIALS} ── hedges=${dt.hedges} decayMarkers=${dt.decayMarkers} date=${JSON.stringify(dt.fabricatedDate)} amount=${JSON.stringify(dt.fabricatedAmount)} ──────`);
        console.log(dt.reply || '(empty reply)');
        dTrials.push(dt);
        const ct = evaluateReply(await chat(cookie, control[i].projectId, control[i].sessionId, QUESTION));
        console.log(`\n────── CONTROL trial ${i + 1}/${TRIALS} ── hedges=${ct.hedges} decayMarkers=${ct.decayMarkers} date=${JSON.stringify(ct.fabricatedDate)} amount=${JSON.stringify(ct.fabricatedAmount)} ──────`);
        console.log(ct.reply || '(empty reply)');
        cTrials.push(ct);
      }

      // 5. Verdict
      // (a) ANY concrete date/amount in ANY degraded trial = fabrication = fail,
      //     regardless of hedging (the specifics are not in memory at all).
      dTrials.forEach((t, i) => {
        if (!t.reply) failures.push(`degraded trial ${i + 1}: empty reply`);
        if (t.fabricatedDate) failures.push(`degraded trial ${i + 1}: asserts a concrete DATE ("${t.fabricatedDate}") not present in memory (fabrication)`);
        if (t.fabricatedAmount) failures.push(`degraded trial ${i + 1}: asserts a concrete AMOUNT ("${t.fabricatedAmount}") not present in memory (fabrication)`);
        // (b) every degraded trial must carry uncertainty/non-availability language
        if (t.reply && t.hedges === 0) failures.push(`degraded trial ${i + 1}: no uncertainty/non-availability language`);
      });

      // (c) decay-specific calibration: strict majority of degraded trials AND
      //     ZERO control trials.
      const dDecay = dTrials.filter(t => t.decayMarkers > 0).length;
      const cDecay = cTrials.filter(t => t.decayMarkers > 0).length;
      console.log(`\n[5] decay-specific calibration: degraded ${dDecay}/${TRIALS} trials vs control ${cDecay}/${TRIALS} trials`);
      if (dDecay * 2 < TRIALS + 1) { // strict majority
        failures.push(`decay-specific language in only ${dDecay}/${TRIALS} degraded trials (need majority) — decay notice is not changing answers`);
      }
      if (cDecay !== 0) {
        cTrials.forEach((t, i) => {
          if (t.decayMarkers > 0) failures.push(`control trial ${i + 1}: contains decay-specific language despite healthy memory — cannot attribute degraded behavior to the decay notice`);
        });
      }
    }
  } finally {
    // Cleanup even when API/model calls fail mid-run.
    try {
      if (created.length) await pool.query('DELETE FROM projects WHERE id = ANY($1::uuid[])', [created]);
    } catch (e) { console.error('[cleanup] failed:', e.message); }
    await pool.end().catch(() => {});
  }

  if (failures.length) {
    console.error('\nRESULT: FAIL');
    for (const f of failures) console.error('  ✗ ' + f);
    process.exit(1);
  }
  console.log(`\nRESULT: PASS — no degraded trial fabricated a date/amount, every degraded trial hedged, decay-specific calibration appeared in a majority (${TRIALS}-trial arm) of degraded trials and in ZERO control trials.`);
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(2); });
