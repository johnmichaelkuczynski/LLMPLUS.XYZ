#!/usr/bin/env node
// Idea Diary regression check. Exercises the public API with no login cookie,
// leaves no synthetic projects behind, and keeps model work to the minimum
// needed to verify capture, memory, extraction, analysis, and normal chat.

const APP_URL = (process.env.APP_URL ||
  (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : 'http://localhost:5000')).replace(/\/$/, '');
const TIMEOUT_MS = Number.parseInt(process.env.IDEA_DIARY_CHECK_TIMEOUT_MS || '120000', 10);
const runId = `idea-diary-check-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdProjects = [];

function fail(message) {
  throw new Error(message);
}

async function request(path, { method = 'GET', body, sse = false } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(APP_URL + path, {
      method,
      headers: { 'Content-Type': 'application/json' }, // Intentionally no Cookie header.
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      fail(`${method} ${path} returned ${response.status}: ${detail.slice(0, 400)}`);
    }
    if (sse) return readSSE(response);
    const contentType = response.headers.get('content-type') || '';
    return contentType.includes('application/json') ? response.json() : response.text();
  } finally {
    clearTimeout(timer);
  }
}

// Handles arbitrary chunk boundaries, LF/CRLF delimiters, and multi-line data
// fields rather than assuming one JSON event arrives in one reader chunk.
async function readSSE(response) {
  if (!response.body) fail('SSE response has no body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events = [];
  let buffer = '';
  const consume = (block) => {
    const data = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
    if (!data.length) return;
    const raw = data.join('\n');
    if (raw === '[DONE]') return;
    try {
      events.push(JSON.parse(raw));
    } catch {
      events.push({ type: 'unparseable', raw });
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let match;
    while ((match = buffer.match(/\r?\n\r?\n/))) {
      consume(buffer.slice(0, match.index));
      buffer = buffer.slice(match.index + match[0].length);
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) consume(buffer);
  const errors = events.filter((event) => event.type === 'error');
  if (errors.length) fail(`SSE error: ${JSON.stringify(errors[0])}`);
  const bad = events.find((event) => event.type === 'unparseable');
  if (bad) fail(`unparseable SSE data: ${bad.raw.slice(0, 400)}`);
  return events;
}

const eventText = (events) => events
  .filter((event) => event.type === 'text' || event.type === 'token')
  .map((event) => event.text || '')
  .join('')
  .trim();

async function createProject(name, projectType) {
  const project = await request('/api/projects', { method: 'POST', body: { name, projectType } });
  if (!project?.id || project.project_type !== projectType) {
    fail(`creation did not return ${projectType}: ${JSON.stringify(project)}`);
  }
  createdProjects.push(project.id);
  return project;
}

async function createSession(project, title) {
  const session = await request(`/api/projects/${project.id}/sessions`, { method: 'POST', body: { title } });
  if (!session?.id) fail(`session creation failed for ${project.name}`);
  return session;
}

async function getProject(projectId) {
  const projects = await request('/api/projects');
  return projects.find((project) => project.id === projectId);
}

async function getSession(projectId, sessionId) {
  const sessions = await request(`/api/projects/${projectId}/sessions`);
  return sessions.find((session) => session.id === sessionId);
}

async function chat(projectId, sessionId, message, respond) {
  return request('/api/chat', {
    method: 'POST',
    sse: true,
    body: { projectId, sessionId, message, respond, model: 'claude', responseLength: 'concise' },
  });
}

async function main() {
  const alpha = 'Tidal lattice garden: arrange rooftop planters as tide-responsive hexagonal cells.';
  const beta = 'Solar archive kiosk: lend neighborhood oral-history recordings through a sunlight-powered booth.';
  const isolated = 'Forbidden cobalt zeppelin: catalog cloud shadows from a blue airship.';

  try {
    console.log(`[1] public API at ${APP_URL} (no login cookie)`);
    const standard = await createProject(`${runId}-standard`, 'standard');
    const diary = await createProject(`${runId}-diary`, 'idea_diary');
    const otherDiary = await createProject(`${runId}-other-diary`, 'idea_diary');
    const standardSession = await createSession(standard, `${runId}-standard-session`);
    const diarySession = await createSession(diary, `${runId}-diary-session`);
    const otherSession = await createSession(otherDiary, `${runId}-other-session`);

    const persisted = await Promise.all([getProject(standard.id), getProject(diary.id), getProject(otherDiary.id)]);
    for (const [project, expected] of [[persisted[0], 'standard'], [persisted[1], 'idea_diary'], [persisted[2], 'idea_diary']]) {
      if (!project || project.project_type !== expected) fail(`project type was not persisted as ${expected}`);
    }
    console.log('[2] project types returned and persisted');

    const silentEvents = await chat(diary.id, diarySession.id, `${alpha}\n${beta}`, false);
    if (!silentEvents.some((event) => event.type === 'saved') ||
        !silentEvents.some((event) => event.type === 'complete') ||
        silentEvents.some((event) => event.type === 'text' || event.type === 'token')) {
      fail(`silent diary SSE contract failed: ${JSON.stringify(silentEvents)}`);
    }
    const silentTranscript = (await getSession(diary.id, diarySession.id))?.transcript;
    if (!Array.isArray(silentTranscript) || silentTranscript.length !== 1 ||
        silentTranscript[0].role !== 'user' || silentTranscript[0].content !== `${alpha}\n${beta}`) {
      fail(`silent diary transcript must contain only its user entry: ${JSON.stringify(silentTranscript)}`);
    }
    console.log('[3] silent capture saved without assistant text');

    const updatedDiary = await getProject(diary.id);
    if (!updatedDiary?.tractatus_tree || Object.keys(updatedDiary.tractatus_tree).length === 0) {
      fail('diary memory remained empty after tractatus update');
    }
    console.log('[4] silent entry persisted into diary memory');

    const replyEvents = await chat(diary.id, diarySession.id, 'Briefly reflect on the two ideas I just recorded.', true);
    const reply = eventText(replyEvents);
    if (!reply) fail('respond:true diary chat emitted no assistant text');
    const replyTranscript = (await getSession(diary.id, diarySession.id))?.transcript;
    if (!Array.isArray(replyTranscript) || !replyTranscript.some((entry) => entry.role === 'assistant' && String(entry.content || '').trim())) {
      fail(`respond:true diary chat did not persist an assistant entry: ${JSON.stringify(replyTranscript)}`);
    }

    const otherEvents = await chat(otherDiary.id, otherSession.id, isolated, false);
    if (!otherEvents.some((event) => event.type === 'saved')) fail('second diary did not save its isolated entry');

    const listEvents = await request('/api/idea-diary/list', {
      method: 'POST', sse: true, body: { projectId: diary.id, model: 'claude' },
    });
    const list = eventText(listEvents);
    const lines = list.split(/\r?\n/).filter(Boolean);
    if (!list || !lines.length || !lines.every((line, index) => new RegExp(`^${index + 1}\\.\\s+\\S`).test(line))) {
      fail(`idea list is not exclusively sequential numbered lines: ${JSON.stringify(list)}`);
    }
    if (!/tidal\s+lattice/i.test(list) || !/solar\s+archive/i.test(list) || /forbidden\s+cobalt\s+zeppelin/i.test(list)) {
      fail(`idea list did not preserve both concepts or leaked isolated content: ${JSON.stringify(list)}`);
    }
    console.log('[5] idea list is numbered, complete, and isolated');

    const analyticsEvents = await request('/api/idea-diary/analytics', {
      method: 'POST', sse: true, body: { projectId: diary.id, model: 'claude' },
    });
    const report = eventText(analyticsEvents);
    if (!report || !/(?:evidence|entry|entries|diary|themes?|ideas?)/i.test(report) ||
        !/(?:non-clinical|not[\s\S]{0,180}(?:clinical|mental.health|diagnos)|(?:clinical|mental.health)[\s\S]{0,80}assessment)/i.test(report)) {
      fail(`analytics lacks descriptive evidence or explicit non-clinical boundary: ${JSON.stringify(report)}`);
    }
    console.log('[6] analytics report is descriptive and explicitly non-clinical');

    const standardEvents = await chat(standard.id, standardSession.id, 'Reply with one short sentence confirming standard chat works.', true);
    if (!eventText(standardEvents)) fail('standard chat emitted no response');
    console.log('\nRESULT: PASS — Idea Diary capture, memory, response, list, analytics, isolation, and standard chat verified.');
  } finally {
    for (const projectId of createdProjects.reverse()) {
      try {
        await request(`/api/projects/${projectId}`, { method: 'DELETE' });
      } catch (error) {
        console.error(`[cleanup] failed to delete ${projectId}: ${error.message}`);
      }
    }
  }
}

main().catch((error) => {
  console.error(`\nRESULT: FAIL — ${error.message}`);
  process.exitCode = 1;
});