const base = 'https://' + process.env.REPLIT_DEV_DOMAIN;
const createdGlobals = [];
let project = null;

async function api(path, options = {}) {
  const response = await fetch(base + path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${path} ${response.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : {};
}

async function saveDoc(name, text) {
  const saved = await api('/api/documents/save-artifact', {
    method: 'POST',
    body: JSON.stringify({ projectId: project.id, name, text })
  });
  createdGlobals.push(saved.id);
}

function parseSSE(raw) {
  const events = [];
  for (const line of raw.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    const data = line.slice(6).trim();
    if (!data || data === '[DONE]') continue;
    try { events.push(JSON.parse(data)); } catch {}
  }
  return events;
}

async function sendChat(sessionId, message) {
  const response = await fetch(base + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId,
      projectId: project.id,
      message,
      model: 'claude',
      responseLength: 'concise',
      responseFormat: 'prose'
    })
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`chat ${response.status}: ${raw.slice(0, 500)}`);
  return parseSSE(raw);
}

async function sendCompare(sessionId, message) {
  const response = await fetch(base + '/api/chat/compare', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId,
      projectId: project.id,
      message,
      stanceA: 'neutral',
      stanceB: 'mildly_critical',
      model: 'claude',
      responseLength: 'concise',
      responseFormat: 'prose'
    })
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`compare ${response.status}: ${raw.slice(0, 500)}`);
  return parseSSE(raw);
}

function assert(condition, message) {
  if (!condition) throw new Error('ASSERTION FAILED: ' + message);
}

try {
  project = await api('/api/projects', {
    method: 'POST',
    body: JSON.stringify({ name: 'Grounding Regression ' + Date.now() })
  });
  const passSession = await api(`/api/projects/${project.id}/sessions`, {
    method: 'POST',
    body: JSON.stringify({ title: 'old-source-pass' })
  });

  await saveDoc(
    'Cobalt Ledger - controlling source.txt',
    'The Cobalt Ledger establishes the following facts. Federal case 1:24-cv-11111 contains all 47 exhibits and proof of proper service. Federal case 1:24-cv-22222 contains only a skeletal complaint and has not been served. These identifiers must not be reversed.'
  );
  for (let i = 1; i <= 10; i++) {
    await saveDoc(
      `newer-decoy-${i}.txt`,
      `Routine scheduling note ${i}. This file contains no controlling filing details and no Cobalt Ledger facts.`
    );
  }

  const question = 'Which federal case in the Cobalt Ledger contains all 47 exhibits and proper service? Answer with the case number and one short explanation.';
  const passEvents = await sendChat(passSession.id, question);
  const verifiedIndex = passEvents.findIndex(event => event.type === 'grounding_verified');
  const firstTextIndex = passEvents.findIndex(event => event.type === 'text');
  const verified = passEvents.find(event => event.type === 'grounding_verified');
  const passAnswer = passEvents.filter(event => event.type === 'text').map(event => event.text).join('');
  assert(passEvents.some(event => event.type === 'status' && event.status === 'retrieving_sources'), 'retrieval status missing');
  assert(passEvents.some(event => event.type === 'status' && event.status === 'verifying'), 'verification status missing');
  assert(verifiedIndex >= 0, 'verified event missing');
  assert(firstTextIndex > verifiedIndex, 'answer text became visible before verification');
  assert(verified.totalDocuments === 11, `expected 11 searched documents, got ${verified.totalDocuments}`);
  assert(passAnswer.includes('1:24-cv-11111'), 'verified answer omitted controlling case number');

  const passSessions = await api(`/api/projects/${project.id}/sessions`);
  const savedPass = passSessions.find(session => session.id === passSession.id);
  assert(savedPass.transcript.length === 2, `pass transcript expected 2 entries, got ${savedPass.transcript.length}`);
  assert(savedPass.transcript[1].content.includes('1:24-cv-11111'), 'verified answer was not saved');
  assert(savedPass.transcript[1].grounding && savedPass.transcript[1].grounding.status === 'verified', 'verified metadata was not persisted');

  const compareSession = await api(`/api/projects/${project.id}/sessions`, {
    method: 'POST',
    body: JSON.stringify({ title: 'compare-source-pass' })
  });
  const compareEvents = await sendCompare(compareSession.id, question);
  for (const lane of ['A', 'B']) {
    const laneVerifiedIndex = compareEvents.findIndex(event => event.type === 'lane_verified' && event.lane === lane);
    const laneFirstTextIndex = compareEvents.findIndex(event => event.type === 'text' && event.lane === lane);
    const laneAnswer = compareEvents.filter(event => event.type === 'text' && event.lane === lane).map(event => event.text).join('');
    assert(laneVerifiedIndex >= 0, `compare lane ${lane} verification missing`);
    assert(laneFirstTextIndex > laneVerifiedIndex, `compare lane ${lane} leaked text before verification`);
    assert(laneAnswer.includes('1:24-cv-11111'), `compare lane ${lane} omitted controlling case number`);
    assert(!compareEvents.some(event => event.type === 'lane_alarm' && event.lane === lane), `compare lane ${lane} raised an unexpected alarm`);
  }

  const failSession = await api(`/api/projects/${project.id}/sessions`, {
    method: 'POST',
    body: JSON.stringify({ title: 'missing-source-fail' })
  });
  const failEvents = await sendChat(
    failSession.id,
    'According to the Zorbax Mandate, what did Judge Quasar order on April 44, 2099?'
  );
  const alarm = failEvents.find(event => event.type === 'grounding_alarm');
  assert(alarm, 'missing-source alarm event missing');
  assert(!failEvents.some(event => event.type === 'text'), 'unverified missing-source answer leaked as text');
  const failSessions = await api(`/api/projects/${project.id}/sessions`);
  const savedFail = failSessions.find(session => session.id === failSession.id);
  assert(savedFail.transcript.length === 2, `alarm transcript expected 2 entries, got ${savedFail.transcript.length}`);
  assert(savedFail.transcript[1].content.startsWith('⚠️ SOURCE CHECK FAILED'), 'persistent alarm was not saved');
  assert(savedFail.transcript[1].grounding && savedFail.transcript[1].grounding.status === 'failed', 'alarm metadata was not persisted');

  const generalSession = await api(`/api/projects/${project.id}/sessions`, {
    method: 'POST',
    body: JSON.stringify({ title: 'general-control' })
  });
  const generalEvents = await sendChat(
    generalSession.id,
    'Calculate seventeen multiplied by three. Answer with only the result.'
  );
  const generalAnswer = generalEvents.filter(event => event.type === 'text').map(event => event.text).join('');
  assert(!generalEvents.some(event => event.type === 'grounding_alarm'), 'general control inherited a project-source alarm');
  assert(/51/.test(generalAnswer), 'general control did not answer 51');

  console.log(JSON.stringify({
    ok: true,
    oldDocumentSearch: {
      searchedDocuments: verified.totalDocuments,
      selectedSources: verified.selectedSources.length,
      claimsChecked: verified.claimsChecked
    },
    comparisonVerified: true,
    missingSourceAlarm: alarm.code,
    generalControlIsolated: true
  }, null, 2));
} finally {
  if (project) {
    try { await api(`/api/projects/${project.id}`, { method: 'DELETE' }); } catch (error) {
      console.error('cleanup project:', error.message);
    }
  }
  for (const id of createdGlobals) {
    try { await api(`/api/documents/global/${id}`, { method: 'DELETE' }); } catch (error) {
      console.error('cleanup global:', error.message);
    }
  }
}