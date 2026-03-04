import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { pool } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '..', 'client'), { etag: false, maxAge: 0 }));

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const CLAUDE_MODEL = 'claude-sonnet-4-20250514';
const MAX_TOKENS = 8192;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  tractatus_tree JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT,
  transcript JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS project_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  raw_content TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS global_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  raw_content TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS document_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'pending',
  original_text TEXT,
  global_skeleton JSONB,
  final_output TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS document_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID REFERENCES document_jobs(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  chunk_text TEXT,
  chunk_output TEXT,
  chunk_delta JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
`;

async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(SCHEMA_SQL);
    console.log('Database schema initialized');
    var projects = await client.query('SELECT id FROM projects LIMIT 1');
    if (projects.rows.length === 0) {
      await client.query("INSERT INTO projects (name, tractatus_tree) VALUES ('Main', '{}')");
      console.log('Default project "Main" created');
    }
  } finally {
    client.release();
  }
}

async function callClaude(messages, systemPrompt, streaming, maxTokens) {
  var body = {
    model: CLAUDE_MODEL,
    max_tokens: maxTokens || MAX_TOKENS,
    messages: messages
  };
  if (systemPrompt) body.system = systemPrompt;
  if (streaming) body.stream = true;

  var response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    var errText = await response.text();
    throw new Error('Anthropic API error ' + response.status + ': ' + errText);
  }

  if (streaming) return response;
  var data = await response.json();
  return data.content[0].text;
}

function buildSystemPrompt(tree) {
  var prompt = 'You are Claude, an AI assistant in LLM Plus. Be helpful, thorough, and precise.';
  prompt += '\n\nTractatus Tree Definition: A numbered hierarchical outline stored per-project. Keys are strings like "1.0", "1.1", "1.1.1", "2.0". Values are summary strings. Tags: ASSERTS:, REJECTS:, ASSUMES:, OPEN:, RESOLVED:, DOCUMENT:, QUESTION:. Follow this format strictly whenever updating the tree.';
  if (tree && Object.keys(tree).length > 0) {
    prompt += '\n\nCurrent Tractatus tree for this project (follow format rules strictly):\n' + JSON.stringify(tree, null, 2);
  }
  return prompt;
}

app.get('/api/projects', async function(req, res) {
  try {
    var result = await pool.query('SELECT * FROM projects ORDER BY created_at ASC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/projects', async function(req, res) {
  try {
    var name = req.body.name;
    var result = await pool.query(
      "INSERT INTO projects (name, tractatus_tree) VALUES ($1, '{}') RETURNING *",
      [name]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/projects/:id/tractatus', async function(req, res) {
  try {
    var result = await pool.query('SELECT tractatus_tree FROM projects WHERE id = $1', [req.params.id]);
    res.json(result.rows[0] ? result.rows[0].tractatus_tree || {} : {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/projects/:id/sessions', async function(req, res) {
  try {
    var result = await pool.query(
      'SELECT * FROM sessions WHERE project_id = $1 ORDER BY created_at DESC',
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/projects/:id/sessions', async function(req, res) {
  try {
    var title = req.body.title || 'New Session';
    var result = await pool.query(
      "INSERT INTO sessions (project_id, title, transcript) VALUES ($1, $2, '[]'::jsonb) RETURNING *",
      [req.params.id, title]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sessions/:id/title', async function(req, res) {
  try {
    var title = req.body.title;
    await pool.query('UPDATE sessions SET title = $1 WHERE id = $2', [title, req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/projects/:id/name', async function(req, res) {
  try {
    var name = req.body.name;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Name required' });
    await pool.query('UPDATE projects SET name = $1 WHERE id = $2', [name.trim(), req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sessions/:id/auto-title', async function(req, res) {
  try {
    var userMessage = req.body.userMessage || '';
    var assistantResponse = req.body.assistantResponse || '';
    var userExcerpt = userMessage.length > 500 ? userMessage.substring(0, 500) : userMessage;
    var assistantExcerpt = assistantResponse.length > 500 ? assistantResponse.substring(0, 500) : assistantResponse;

    var result = await callClaude(
      [{ role: 'user', content: 'Generate a short, descriptive chat title (3-7 words, no quotes) based on this exchange:\n\nUser: ' + userExcerpt + '\n\nAssistant: ' + assistantExcerpt + '\n\nRespond with ONLY the title, nothing else.' }],
      'You generate concise chat titles. Output only the title text, no quotes, no punctuation at the end.',
      false,
      50
    );

    var title = result.trim().replace(/^["']|["']$/g, '').substring(0, 60);
    await pool.query('UPDATE sessions SET title = $1 WHERE id = $2', [title, req.params.id]);
    res.json({ title: title });
  } catch (err) {
    console.error('Auto-title error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sessions/:id/transcript', async function(req, res) {
  try {
    var messages = req.body.messages;
    var session = await pool.query('SELECT transcript FROM sessions WHERE id = $1', [req.params.id]);
    var transcript = session.rows[0] ? (session.rows[0].transcript || []) : [];
    for (var i = 0; i < messages.length; i++) {
      transcript.push(messages[i]);
    }
    await pool.query('UPDATE sessions SET transcript = $1 WHERE id = $2', [JSON.stringify(transcript), req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/chat', async function(req, res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    var sessionId = req.body.sessionId;
    var projectId = req.body.projectId;
    var message = req.body.message;

    var projectResult = await pool.query('SELECT tractatus_tree FROM projects WHERE id = $1', [projectId]);
    var tree = projectResult.rows[0] ? projectResult.rows[0].tractatus_tree || {} : {};

    var sessionResult = await pool.query('SELECT transcript FROM sessions WHERE id = $1', [sessionId]);
    var transcript = sessionResult.rows[0] ? (sessionResult.rows[0].transcript || []) : [];

    var otherSessions = await pool.query(
      'SELECT title, transcript FROM sessions WHERE project_id = $1 AND id != $2 ORDER BY created_at DESC LIMIT 10',
      [projectId, sessionId]
    );
    var crossSessionContext = '';
    for (var os = 0; os < otherSessions.rows.length; os++) {
      var otherT = otherSessions.rows[os].transcript || [];
      if (otherT.length > 0) {
        var otherTitle = otherSessions.rows[os].title || 'Untitled Chat';
        var otherRecent = otherT.slice(-6);
        var summary = '';
        for (var om = 0; om < otherRecent.length; om++) {
          var role = otherRecent[om].role === 'user' ? 'User' : 'Assistant';
          var snippet = (otherRecent[om].content || '').substring(0, 300);
          summary += role + ': ' + snippet + '\n';
        }
        crossSessionContext += '\n--- Previous chat: "' + otherTitle + '" ---\n' + summary + '\n';
      }
    }

    var systemPrompt = buildSystemPrompt(tree);
    if (crossSessionContext) {
      systemPrompt += '\n\n## Context from previous chats in this project\nThe user has had other conversations in this project. Here are excerpts so you can maintain continuity:\n' + crossSessionContext;
    }

    var msgs = [];
    var recent = transcript.slice(-20);
    for (var i = 0; i < recent.length; i++) {
      msgs.push({ role: recent[i].role, content: recent[i].content });
    }
    msgs.push({ role: 'user', content: message });

    var anthropicRes = await callClaude(msgs, systemPrompt, true);
    var reader = anthropicRes.body.getReader();
    var decoder = new TextDecoder();
    var buffer = '';
    var fullText = '';

    while (true) {
      var chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      var lines = buffer.split('\n');
      buffer = lines.pop();
      for (var j = 0; j < lines.length; j++) {
        var line = lines[j];
        if (line.startsWith('data: ')) {
          var data = line.slice(6).trim();
          if (!data || data === '[DONE]') continue;
          try {
            var parsed = JSON.parse(data);
            if (parsed.type === 'content_block_delta' && parsed.delta && parsed.delta.type === 'text_delta') {
              fullText += parsed.delta.text;
              res.write('data: ' + JSON.stringify({ type: 'text', text: parsed.delta.text }) + '\n\n');
            }
          } catch (e) {}
        }
      }
    }

    var existingTranscript = transcript.slice();
    existingTranscript.push({ role: 'user', content: message });
    existingTranscript.push({ role: 'assistant', content: fullText });
    await pool.query('UPDATE sessions SET transcript = $1 WHERE id = $2',
      [JSON.stringify(existingTranscript), sessionId]);

    res.write('data: ' + JSON.stringify({ type: 'tractatus_trigger', projectId: projectId, userMessage: message, assistantResponse: fullText.substring(0, 8000) }) + '\n\n');
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    console.error('Chat error:', err);
    res.write('data: ' + JSON.stringify({ type: 'error', error: err.message }) + '\n\n');
    res.end();
  }
});

app.post('/api/tractatus/update', async function(req, res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  function send(obj) {
    res.write('data: ' + JSON.stringify(obj) + '\n\n');
  }

  try {
    var projectId = req.body.projectId;
    var userMessage = req.body.userMessage || '';
    var assistantResponse = req.body.assistantResponse || '';

    var projectResult = await pool.query('SELECT tractatus_tree FROM projects WHERE id = $1', [projectId]);
    var existingTree = projectResult.rows[0] ? projectResult.rows[0].tractatus_tree || {} : {};

    var userExcerpt = userMessage.length > 4000 ? userMessage.substring(0, 4000) + '...[truncated]' : userMessage;
    var assistantExcerpt = assistantResponse.length > 8000 ? assistantResponse.substring(0, 8000) + '...[truncated]' : assistantResponse;

    var prompt = 'Based on this conversation exchange, generate a Tractatus tree update in strict JSON format.\n\n';
    prompt += 'User said: "' + userExcerpt + '"\n';
    prompt += 'Assistant said: "' + assistantExcerpt + '"\n\n';
    var treeStr = JSON.stringify(existingTree);
    if (treeStr.length > 8000) {
      var treeKeys = Object.keys(existingTree);
      var recentKeys = treeKeys.slice(-30);
      var recentTree = {};
      for (var rk = 0; rk < recentKeys.length; rk++) {
        recentTree[recentKeys[rk]] = existingTree[recentKeys[rk]];
      }
      treeStr = JSON.stringify(recentTree);
      prompt += 'Existing tree (last 30 of ' + treeKeys.length + ' nodes shown):\n' + treeStr + '\n\n';
      prompt += 'Total existing node count: ' + treeKeys.length + '. Add new numbered nodes continuing from the highest existing key.\n\n';
    } else {
      prompt += 'Existing tree:\n' + treeStr + '\n\n';
    }
    prompt += 'Rules:\n';
    prompt += '- Keys are strings like "1.0", "1.1", "1.1.1", "2.0" etc.\n';
    prompt += '- Values are strings containing the summary text\n';
    prompt += '- Use tags: ASSERTS:, REJECTS:, ASSUMES:, OPEN:, RESOLVED:, DOCUMENT:, QUESTION:\n';
    prompt += '- Only return the JSON object, no commentary, no markdown fences.\n';
    prompt += '- Merge with existing tree: add new nodes, update existing ones, flag conflicts.';

    send({ type: 'status', message: 'Updating project memory...' });

    var anthropicRes = await callClaude(
      [{ role: 'user', content: prompt }],
      'You output only valid JSON objects. No markdown, no commentary, no fences.',
      true,
      4096
    );

    var reader = anthropicRes.body.getReader();
    var decoder = new TextDecoder();
    var buffer = '';
    var fullText = '';

    while (true) {
      var chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      var lines = buffer.split('\n');
      buffer = lines.pop();
      for (var j = 0; j < lines.length; j++) {
        var line = lines[j];
        if (line.startsWith('data: ')) {
          var data = line.slice(6).trim();
          if (!data || data === '[DONE]') continue;
          try {
            var parsed = JSON.parse(data);
            if (parsed.type === 'content_block_delta' && parsed.delta && parsed.delta.type === 'text_delta') {
              fullText += parsed.delta.text;
              send({ type: 'text', text: parsed.delta.text });
            } else if (parsed.type === 'error') {
              console.error('Anthropic stream error in tractatus:', JSON.stringify(parsed));
            }
          } catch (e) {}
        }
      }
    }

    var cleanedText = fullText.trim();
    if (cleanedText.startsWith('```')) {
      cleanedText = cleanedText.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    }

    var newTree;
    try {
      newTree = JSON.parse(cleanedText);
    } catch (e) {
      var jsonMatch = cleanedText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          newTree = JSON.parse(jsonMatch[0]);
        } catch (e2) {
          console.error('Tractatus JSON parse failed (extracted):', e2.message, 'Text:', jsonMatch[0].substring(0, 200));
          send({ type: 'error', message: 'Failed to parse tree update' });
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }
      } else {
        console.error('Tractatus no JSON found in:', cleanedText.substring(0, 200));
        send({ type: 'error', message: 'Failed to parse tree update' });
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }
    }

    var merged = Object.assign({}, existingTree, newTree);
    var nodeCount = Object.keys(merged).length;
    await pool.query('UPDATE projects SET tractatus_tree = $1 WHERE id = $2', [JSON.stringify(merged), projectId]);
    send({ type: 'complete', nodes: nodeCount });
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    console.error('Tractatus stream error:', err.message, err.stack);
    try { send({ type: 'error', message: err.message }); } catch(e2) {}
    res.write('data: [DONE]\n\n');
    res.end();
  }
});

async function streamClaudeToSSE(messages, systemPrompt, sendFn, maxTokens) {
  var anthropicRes = await callClaude(messages, systemPrompt, true, maxTokens || 8192);
  var reader = anthropicRes.body.getReader();
  var decoder = new TextDecoder();
  var buffer = '';
  var fullText = '';

  while (true) {
    var chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    var lines = buffer.split('\n');
    buffer = lines.pop();
    for (var j = 0; j < lines.length; j++) {
      var line = lines[j];
      if (line.startsWith('data: ')) {
        var data = line.slice(6).trim();
        if (!data || data === '[DONE]') continue;
        try {
          var parsed = JSON.parse(data);
          if (parsed.type === 'content_block_delta' && parsed.delta && parsed.delta.type === 'text_delta') {
            fullText += parsed.delta.text;
            sendFn({ type: 'token', text: parsed.delta.text });
          }
        } catch (e) {}
      }
    }
  }
  return fullText;
}

function splitIntoChunks(text, targetWords) {
  targetWords = targetWords || 500;
  var paragraphs = text.split(/\n\n+/);
  var chunks = [];
  var current = '';
  var currentWords = 0;

  for (var i = 0; i < paragraphs.length; i++) {
    var para = paragraphs[i].trim();
    if (!para) continue;
    var paraWords = para.split(/\s+/).length;
    if (currentWords + paraWords > targetWords && current) {
      chunks.push(current.trim());
      current = '';
      currentWords = 0;
    }
    current += (current ? '\n\n' : '') + para;
    currentWords += paraWords;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

function sleep(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

app.post('/api/coherence', async function(req, res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  function send(obj) {
    res.write('data: ' + JSON.stringify(obj) + '\n\n');
  }

  try {
    var sessionId = req.body.sessionId;
    var projectId = req.body.projectId;
    var title = req.body.title || '';
    var instructions = req.body.instructions || '';
    var targetWords = parseInt(req.body.wordcount) || 10000;
    var doctype = req.body.doctype || 'paper';

    var projectResult = await pool.query('SELECT tractatus_tree FROM projects WHERE id = $1', [projectId]);
    var tree = projectResult.rows[0] ? projectResult.rows[0].tractatus_tree || {} : {};

    var sessionResult = await pool.query('SELECT transcript FROM sessions WHERE id = $1', [sessionId]);
    var transcript = sessionResult.rows[0] ? (sessionResult.rows[0].transcript || []) : [];

    var docResult = await pool.query('SELECT name, raw_content FROM project_documents WHERE project_id = $1', [projectId]);
    var projectDocs = docResult.rows;

    var sourceContent = '';
    if (projectDocs.length > 0) {
      for (var d = 0; d < projectDocs.length; d++) {
        var docContent = projectDocs[d].raw_content || '';
        sourceContent += '--- Document: ' + projectDocs[d].name + ' (' + docContent.split(/\s+/).length + ' words) ---\n';
        sourceContent += docContent.length > 10000 ? docContent.substring(0, 10000) + '...[truncated]' : docContent;
        sourceContent += '\n\n';
      }
    }

    var treeContext = '';
    if (Object.keys(tree).length > 0) {
      treeContext = 'Project knowledge (Tractatus tree):\n' + JSON.stringify(tree).substring(0, 5000) + '\n\n';
    }

    var userRequest = 'Generate a ' + targetWords + '-word ' + doctype.replace(/_/g, ' ');
    if (title) userRequest += ' titled "' + title + '"';
    if (instructions) userRequest += '\n\nInstructions: ' + instructions;

    var jobResult = await pool.query(
      "INSERT INTO document_jobs (session_id, original_text, status) VALUES ($1, $2, 'outline') RETURNING *",
      [sessionId, userRequest]
    );
    var jobId = jobResult.rows[0].id;

    if (targetWords <= 5000) {
      send({ type: 'status', pass: 1, message: 'Generating ' + targetWords + '-word document...' });
      send({ type: 'progress', current: 1, total: 1 });

      var singlePrompt = 'Write a ' + doctype.replace(/_/g, ' ');
      if (title) singlePrompt += ' titled "' + title + '"';
      singlePrompt += '.\n\n';
      if (instructions) singlePrompt += '=== USER INSTRUCTIONS (follow these exactly) ===\n' + instructions + '\n=== END INSTRUCTIONS ===\n\n';
      singlePrompt += 'TARGET LENGTH: exactly ' + targetWords + ' words. Do NOT exceed this. Do NOT write less.\n\n';
      if (treeContext) singlePrompt += treeContext;
      if (sourceContent) singlePrompt += 'Source documents for reference:\n' + sourceContent.substring(0, 15000) + '\n\n';
      singlePrompt += 'CRITICAL: Follow the user\'s instructions EXACTLY. Write EXACTLY ' + targetWords + ' words. Output ONLY the document text.';

      var singleResult = await streamClaudeToSSE(
        [{ role: 'user', content: singlePrompt }],
        'You are writing a ' + doctype.replace(/_/g, ' ') + '. Follow the user\'s instructions precisely. Write exactly the requested number of words. Output ONLY the document — no meta-commentary.',
        send,
        8192
      );

      var singleWords = singleResult.split(/\s+/).length;

      await pool.query(
        "UPDATE document_jobs SET status = 'complete', final_output = $1, global_skeleton = $2 WHERE id = $3",
        [singleResult, JSON.stringify([{ title: title, content: singleResult }]), jobId]
      );

      await pool.query(
        'INSERT INTO document_chunks (job_id, chunk_index, chunk_text, chunk_output, chunk_delta) VALUES ($1, $2, $3, $4, $5)',
        [jobId, 0, title, singleResult, JSON.stringify({ title: title, words: singleWords })]
      );

      send({ type: 'complete', jobId: jobId, totalWords: singleWords });
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    send({ type: 'status', pass: 1, message: 'Pass 1: Creating detailed outline...' });

    var wordsPerSection = 1500;
    var numSections = Math.max(3, Math.ceil(targetWords / wordsPerSection));

    var outlinePrompt = 'Create a detailed section-by-section outline for a ' + targetWords + '-word ' + doctype.replace(/_/g, ' ') + '.\n\n';
    if (title) outlinePrompt += 'Title: ' + title + '\n';
    if (instructions) outlinePrompt += '=== USER INSTRUCTIONS (follow these exactly) ===\n' + instructions + '\n=== END INSTRUCTIONS ===\n\n';
    outlinePrompt += 'Target: approximately ' + numSections + ' sections, each roughly ' + wordsPerSection + ' words.\n\n';
    if (treeContext) outlinePrompt += treeContext;
    if (sourceContent) outlinePrompt += 'Source documents for reference:\n' + sourceContent.substring(0, 15000) + '\n\n';
    outlinePrompt += 'Return ONLY a JSON array of section objects:\n';
    outlinePrompt += '[{"title": "Section Title", "description": "What this section covers", "key_points": ["point1", "point2"], "target_words": ' + wordsPerSection + '}]\n';
    outlinePrompt += 'Include all major sections. Return ONLY the JSON array.';

    var outlineRaw = await callClaude(
      [{ role: 'user', content: outlinePrompt }],
      'You output only valid JSON arrays. No markdown fences, no commentary.',
      false
    );

    var outline;
    try {
      outline = JSON.parse(outlineRaw);
    } catch (e) {
      var arrMatch = outlineRaw.match(/\[[\s\S]*\]/);
      outline = arrMatch ? JSON.parse(arrMatch[0]) : [];
    }

    if (outline.length === 0) {
      throw new Error('Failed to generate outline');
    }

    await pool.query(
      "UPDATE document_jobs SET global_skeleton = $1, status = 'writing' WHERE id = $2",
      [JSON.stringify(outline), jobId]
    );

    send({ type: 'status', pass: 1, message: 'Outline complete: ' + outline.length + ' sections planned.' });
    send({ type: 'status', pass: 2, message: 'Pass 2: Writing sections...' });

    var allSections = [];
    var totalWordsSoFar = 0;

    for (var i = 0; i < outline.length; i++) {
      send({ type: 'progress', current: i + 1, total: outline.length });

      var section = outline[i];
      var sectionTargetWords = section.target_words || wordsPerSection;
      var remainingWords = targetWords - totalWordsSoFar;
      if (i === outline.length - 1) {
        sectionTargetWords = Math.max(sectionTargetWords, remainingWords);
      }

      var prevSectionSummaries = '';
      if (allSections.length > 0) {
        prevSectionSummaries = 'Previously written sections (for continuity):\n';
        for (var p = 0; p < allSections.length; p++) {
          var prevExcerpt = allSections[p].length > 500 
            ? allSections[p].substring(0, 250) + '...' + allSections[p].substring(allSections[p].length - 250)
            : allSections[p];
          prevSectionSummaries += '--- Section ' + (p + 1) + ' ---\n' + prevExcerpt + '\n\n';
        }
      }

      var sectionPrompt = 'You are writing section ' + (i + 1) + ' of ' + outline.length + ' for a ' + doctype.replace(/_/g, ' ') + '.\n\n';
      sectionPrompt += '## Section: ' + section.title + '\n';
      sectionPrompt += 'Description: ' + section.description + '\n';
      if (section.key_points && section.key_points.length > 0) {
        sectionPrompt += 'Key points to cover: ' + section.key_points.join('; ') + '\n';
      }
      if (title) sectionPrompt += '\nOverall paper title: ' + title + '\n';
      if (instructions) sectionPrompt += 'Overall instructions: ' + instructions + '\n\n';
      if (prevSectionSummaries) sectionPrompt += prevSectionSummaries + '\n';

      if (sourceContent) {
        sectionPrompt += 'Source material (draw from this heavily, quote and cite extensively):\n' + sourceContent.substring(0, 15000) + '\n\n';
      }

      sectionPrompt += '\n\n=== CRITICAL LENGTH REQUIREMENT ===\n';
      sectionPrompt += 'You MUST write AT LEAST ' + sectionTargetWords + ' words for this section. This is non-negotiable.\n';
      sectionPrompt += 'DO NOT summarize. DO NOT abbreviate. DO NOT give an overview.\n';
      sectionPrompt += 'Write DENSE, DETAILED, SUBSTANTIVE academic prose with:\n';
      sectionPrompt += '- Multiple paragraphs (at least 8-10 paragraphs)\n';
      sectionPrompt += '- Detailed analysis and argumentation\n';
      sectionPrompt += '- Specific examples, evidence, and citations from source material\n';
      sectionPrompt += '- Extended discussion of each point\n';
      sectionPrompt += '- Transitions between ideas\n';
      sectionPrompt += 'Fill the ENTIRE response with substantive content. Use ALL available output space.\n';
      sectionPrompt += 'Output ONLY the section text. No headers saying "Section X". No meta-commentary. Just the prose.\n';

      var sysPrompt = 'You are a prolific academic writer producing a ' + doctype.replace(/_/g, ' ') + '. ';
      sysPrompt += 'You write LONG, DETAILED sections. Your minimum output for any section is ' + sectionTargetWords + ' words. ';
      sysPrompt += 'You never summarize when you can elaborate. You never abbreviate when you can expand. ';
      sysPrompt += 'You use every available token to produce rich, substantive, scholarly content. ';
      sysPrompt += 'Output ONLY the section text — no JSON, no markdown headers, no meta-commentary.';

      send({ type: 'section_start', index: i, title: section.title });
      var sectionText = await streamClaudeToSSE(
        [{ role: 'user', content: sectionPrompt }],
        sysPrompt,
        send,
        8192
      );

      var sectionWordCount = sectionText.split(/\s+/).length;
      var minAcceptable = Math.min(sectionTargetWords * 0.5, 800);

      if (sectionWordCount < minAcceptable) {
        send({ type: 'status', pass: 2, message: 'Section ' + (i + 1) + ' too short (' + sectionWordCount + ' words). Expanding...' });

        var expandPrompt = 'The following section is only ' + sectionWordCount + ' words. It MUST be at least ' + sectionTargetWords + ' words.\n\n';
        expandPrompt += 'Current text:\n' + sectionText + '\n\n';
        expandPrompt += 'EXPAND this section to ' + sectionTargetWords + ' words minimum. Add:\n';
        expandPrompt += '- More detailed analysis and examples\n';
        expandPrompt += '- Additional evidence and argumentation\n';
        expandPrompt += '- Deeper exploration of each point\n';
        expandPrompt += '- More transitions and connective prose\n';
        if (sourceContent) expandPrompt += '\nSource material to draw from:\n' + sourceContent.substring(0, 10000) + '\n';
        expandPrompt += '\nOutput ONLY the expanded section text. No meta-commentary.';

        send({ type: 'section_start', index: i, title: section.title + ' (expanding)' });
        var expandedText = await streamClaudeToSSE(
          [{ role: 'user', content: expandPrompt }],
          sysPrompt,
          send,
          8192
        );

        if (expandedText.split(/\s+/).length > sectionWordCount) {
          sectionText = expandedText;
          sectionWordCount = sectionText.split(/\s+/).length;
        }
      }

      allSections.push(sectionText);
      totalWordsSoFar += sectionWordCount;

      await pool.query(
        'INSERT INTO document_chunks (job_id, chunk_index, chunk_text, chunk_output, chunk_delta) VALUES ($1, $2, $3, $4, $5)',
        [jobId, i, section.title, sectionText, JSON.stringify({ title: section.title, words: sectionText.split(/\s+/).length })]
      );

      send({ type: 'section_end', index: i, words: sectionWordCount });

      await pool.query(
        "UPDATE document_jobs SET status = $1 WHERE id = $2",
        ['section_' + (i + 1) + '_of_' + outline.length, jobId]
      );

      if (i < outline.length - 1) {
        await sleep(5000);
      }
    }

    send({ type: 'status', pass: 3, message: 'Pass 3: Coherence review (' + totalWordsSoFar + ' words generated)...' });

    var finalOutput = allSections.join('\n\n');

    await pool.query(
      "UPDATE document_jobs SET final_output = $1, status = 'complete' WHERE id = $2",
      [finalOutput, jobId]
    );

    var sessTranscript = transcript.slice();
    sessTranscript.push({ role: 'user', content: userRequest });
    sessTranscript.push({ role: 'assistant', content: finalOutput.substring(0, 50000) });
    await pool.query('UPDATE sessions SET transcript = $1 WHERE id = $2',
      [JSON.stringify(sessTranscript), sessionId]);

    send({ type: 'complete', jobId: jobId, totalWords: totalWordsSoFar, coherence: 'pass' });
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    console.error('Coherence engine error:', err);
    send({ type: 'error', error: err.message });
    res.end();
  }
});

app.get('/api/download/:jobId/:format', async function(req, res) {
  try {
    var jobId = req.params.jobId;
    var format = req.params.format;
    var job = await pool.query('SELECT final_output FROM document_jobs WHERE id = $1', [jobId]);
    if (!job.rows[0]) return res.status(404).json({ error: 'Job not found' });

    var text = job.rows[0].final_output;

    if (format === 'txt') {
      res.setHeader('Content-Type', 'text/plain');
      res.setHeader('Content-Disposition', 'attachment; filename=document.txt');
      res.send(text);
    } else if (format === 'docx') {
      var docxModule = await import('docx');
      var Document = docxModule.Document;
      var Packer = docxModule.Packer;
      var Paragraph = docxModule.Paragraph;
      var TextRun = docxModule.TextRun;
      var paragraphs = text.split('\n').map(function(line) {
        return new Paragraph({ children: [new TextRun(line)] });
      });
      var doc = new Document({ sections: [{ children: paragraphs }] });
      var buffer = await Packer.toBuffer(doc);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', 'attachment; filename=document.docx');
      res.send(Buffer.from(buffer));
    } else if (format === 'pdf') {
      var PDFDocument = (await import('pdfkit')).default;
      var pdfDoc = new PDFDocument();
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename=document.pdf');
      pdfDoc.pipe(res);
      pdfDoc.font('Helvetica').fontSize(11);
      var pdfLines = text.split('\n');
      for (var k = 0; k < pdfLines.length; k++) {
        pdfDoc.text(pdfLines[k], { width: 470, align: 'left' });
      }
      pdfDoc.end();
    } else {
      res.status(400).json({ error: 'Unsupported format. Use txt, docx, or pdf.' });
    }
  } catch (err) {
    console.error('Download error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/projects/:id/documents', async function(req, res) {
  try {
    var result = await pool.query(
      "SELECT id, name, created_at, array_length(regexp_split_to_array(raw_content, '\\s+'), 1) as word_count FROM project_documents WHERE project_id = $1 ORDER BY created_at DESC",
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/documents/global', async function(req, res) {
  try {
    var result = await pool.query("SELECT id, name, created_at, array_length(regexp_split_to_array(raw_content, '\\s+'), 1) as word_count FROM global_documents ORDER BY created_at DESC");
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/documents/global/:id/download', async function(req, res) {
  try {
    var result = await pool.query('SELECT name, raw_content FROM global_documents WHERE id = $1', [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Document not found' });
    var doc = result.rows[0];
    var filename = doc.name.replace(/\.[^.]+$/, '') + '.txt';
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename.replace(/"/g, '\\"') + '"');
    res.send(doc.raw_content || '');
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/documents/save-generated', async function(req, res) {
  try {
    var jobId = req.body.jobId;
    var name = req.body.name || 'Generated Document';
    var job = await pool.query('SELECT final_output FROM document_jobs WHERE id = $1', [jobId]);
    if (!job.rows[0]) return res.status(404).json({ error: 'Job not found' });
    var content = job.rows[0].final_output || '';
    var result = await pool.query(
      'INSERT INTO global_documents (name, raw_content) VALUES ($1, $2) RETURNING id, name, created_at',
      [name, content]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/documents/upload', upload.single('file'), async function(req, res) {
  try {
    var file = req.file;
    var projectId = req.body.projectId;
    if (!file) return res.status(400).json({ error: 'No file provided' });

    var ext = path.extname(file.originalname).toLowerCase();
    var rawContent = '';

    if (ext === '.txt') {
      rawContent = file.buffer.toString('utf-8');
    } else if (ext === '.pdf') {
      var pdfMod = await import('pdf-parse');
      var uint8 = new Uint8Array(file.buffer);
      var parser = new pdfMod.PDFParse(uint8);
      await parser.load();
      var pdfData = await parser.getText();
      rawContent = pdfData.text;
    } else if (ext === '.docx' || ext === '.doc') {
      var mammoth = await import('mammoth');
      var mammothResult = await mammoth.extractRawText({ buffer: file.buffer });
      rawContent = mammothResult.value;
    } else if (['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff', '.tif', '.webp'].indexOf(ext) !== -1) {
      var visionKey = process.env.GOOGLE_CLOUD_VISION_API_KEY;
      if (!visionKey) return res.status(500).json({ error: 'Google Cloud Vision API key not configured' });
      var base64Image = file.buffer.toString('base64');
      var visionResp = await fetch('https://vision.googleapis.com/v1/images:annotate?key=' + visionKey, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{
            image: { content: base64Image },
            features: [
              { type: 'TEXT_DETECTION', maxResults: 1 },
              { type: 'DOCUMENT_TEXT_DETECTION', maxResults: 1 }
            ]
          }]
        })
      });
      if (!visionResp.ok) {
        var errBody = await visionResp.text();
        console.error('Vision API error:', errBody);
        var errDetail = 'OCR failed';
        try {
          var errJson = JSON.parse(errBody);
          if (errJson.error && errJson.error.message) errDetail = errJson.error.message;
        } catch(e) {}
        return res.status(500).json({ error: errDetail });
      }
      var visionData = await visionResp.json();
      var annotations = visionData.responses && visionData.responses[0];
      if (annotations && annotations.fullTextAnnotation) {
        rawContent = annotations.fullTextAnnotation.text;
      } else if (annotations && annotations.textAnnotations && annotations.textAnnotations.length > 0) {
        rawContent = annotations.textAnnotations[0].description;
      } else {
        rawContent = '[No text detected in image]';
      }
    } else {
      return res.status(400).json({ error: 'Unsupported file type. Use PDF, DOCX, DOC, TXT, or image files (PNG, JPG, GIF, BMP, TIFF, WebP).' });
    }

    if (projectId) {
      var result = await pool.query(
        'INSERT INTO project_documents (project_id, name, raw_content) VALUES ($1, $2, $3) RETURNING id, name, created_at',
        [projectId, file.originalname, rawContent]
      );
      res.json({ id: result.rows[0].id, name: result.rows[0].name, created_at: result.rows[0].created_at, raw_content: rawContent, scope: 'project' });
    } else {
      var gResult = await pool.query(
        'INSERT INTO global_documents (name, raw_content) VALUES ($1, $2) RETURNING id, name, created_at',
        [file.originalname, rawContent]
      );
      res.json({ id: gResult.rows[0].id, name: gResult.rows[0].name, created_at: gResult.rows[0].created_at, raw_content: rawContent, scope: 'global' });
    }
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/documents/insert', async function(req, res) {
  try {
    var docId = req.body.docId;
    var scope = req.body.scope;
    var result;
    if (scope === 'global') {
      result = await pool.query('SELECT name, raw_content FROM global_documents WHERE id = $1', [docId]);
    } else {
      result = await pool.query('SELECT name, raw_content FROM project_documents WHERE id = $1', [docId]);
    }
    if (!result.rows[0]) return res.status(404).json({ error: 'Document not found' });
    res.json({ name: result.rows[0].name, raw_content: result.rows[0].raw_content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sessions/:id/move', async function(req, res) {
  try {
    var sessionId = req.params.id;
    var targetProjectId = req.body.targetProjectId;
    await pool.query('UPDATE sessions SET project_id = $1 WHERE id = $2', [targetProjectId, sessionId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/documents/copy-to-project', async function(req, res) {
  try {
    var docId = req.body.docId;
    var targetProjectId = req.body.targetProjectId;
    var result = await pool.query('SELECT name, raw_content FROM project_documents WHERE id = $1', [docId]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Document not found' });
    var doc = result.rows[0];
    var pResult = await pool.query(
      'INSERT INTO project_documents (project_id, name, raw_content) VALUES ($1, $2, $3) RETURNING id, name, created_at',
      [targetProjectId, doc.name, doc.raw_content]
    );
    res.json(pResult.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/documents/copy-to-global', async function(req, res) {
  try {
    var docId = req.body.docId;
    var projectId = req.body.projectId;
    var result = await pool.query('SELECT name, raw_content FROM project_documents WHERE id = $1', [docId]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Document not found' });
    var doc = result.rows[0];
    var gResult = await pool.query(
      'INSERT INTO global_documents (name, raw_content) VALUES ($1, $2) RETURNING id, name, created_at',
      [doc.name, doc.raw_content]
    );
    res.json(gResult.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/{*splat}', function(req, res) {
  res.sendFile(path.join(__dirname, '..', 'client', 'index.html'));
});

var PORT = parseInt(process.env.PORT || '5000', 10);

initDB().then(function() {
  app.listen(PORT, '0.0.0.0', function() {
    console.log('LLM Plus server running on port ' + PORT);
  });
}).catch(function(err) {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
