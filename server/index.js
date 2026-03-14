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
const MAX_TOKENS = 16384;

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
CREATE TABLE IF NOT EXISTS tractatus_archive (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  tier INTEGER NOT NULL DEFAULT 1,
  tree JSONB NOT NULL,
  node_count INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
`;

async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(SCHEMA_SQL);
    try {
      await client.query("ALTER TABLE projects ADD COLUMN IF NOT EXISTS tractatus_tier INTEGER DEFAULT 1");
      await client.query("ALTER TABLE projects ADD COLUMN IF NOT EXISTS parent_project_id UUID");
      try {
        await client.query("ALTER TABLE projects ADD CONSTRAINT fk_parent_project FOREIGN KEY (parent_project_id) REFERENCES projects(id) ON DELETE CASCADE");
      } catch (fkErr) { /* constraint may already exist */ }
    } catch (e) { /* columns may already exist */ }
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

function extractRequestedWordCount(text) {
  var t = text.toLowerCase();
  var kMatch = t.match(/(\d+)\s*k\s*(?:words?|word)/);
  if (kMatch) {
    var kn = parseInt(kMatch[1], 10) * 1000;
    if (kn >= 500 && kn <= 100000) return kn;
  }
  var patterns = [
    /(\d[\d,]*)\s*(?:words?\s+long|word\s+(?:essay|paper|document|summary|analysis|brief|letter|memo|report|review|article|response|answer))/,
    /(?:around|about|approximately|roughly|at\s+least|minimum|up\s+to)\s+(\d[\d,]*)\s*words/,
    /(\d[\d,]*)\s*words/,
    /(\d[\d,]*)\s*-?\s*word/
  ];
  for (var i = 0; i < patterns.length; i++) {
    var m = t.match(patterns[i]);
    if (m) {
      var n = parseInt(m[1].replace(/,/g, ''), 10);
      if (n >= 500 && n <= 100000) return n;
    }
  }
  return 0;
}

function isLongformRequest(text) {
  var t = text.toLowerCase();
  var keywords = [
    'complete summary', 'complete analysis', 'comprehensive', 'detailed analysis',
    'thorough', 'in-depth', 'full summary', 'full analysis', 'exhaustive',
    'write a complete', 'write a full', 'write a detailed', 'write a thorough',
    'write a comprehensive', 'long form', 'longform', 'lengthy',
    'write me a', 'draft a', 'compose a',
    'motion to', 'legal brief', 'memorandum', 'complaint',
    'research paper', 'white paper', 'case study', 'literature review'
  ];
  for (var i = 0; i < keywords.length; i++) {
    if (t.indexOf(keywords[i]) !== -1) return true;
  }
  return false;
}

function extractSectionOutline(text) {
  var lines = text.split('\n');
  var outline = [];
  var sectionCount = 0;
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;
    var isHeading = false;
    var headingText = '';
    if (/^#{1,4}\s+(.+)/.test(line)) {
      headingText = line.replace(/^#+\s+/, '').replace(/\*\*/g, '');
      isHeading = true;
    } else if (/^[IVXLC]+\.\s+/.test(line)) {
      headingText = line;
      isHeading = true;
    } else if (/^[A-Z][A-Z\s,'\-]{8,}$/.test(line) && line.length < 120) {
      headingText = line;
      isHeading = true;
    } else if (/^\d+\.\s+[A-Z]/.test(line) && line.length < 120 && line.length > 10) {
      var restOfLine = line.replace(/^\d+\.\s+/, '');
      var upperRatio = (restOfLine.match(/[A-Z]/g) || []).length / restOfLine.length;
      if (upperRatio > 0.5 || /\*\*/.test(lines[i])) {
        headingText = line.replace(/\*\*/g, '');
        isHeading = true;
      }
    }
    if (isHeading && headingText.length > 3) {
      sectionCount++;
      outline.push(sectionCount + '. ' + headingText);
    }
  }
  if (outline.length === 0) {
    var paragraphs = text.split(/\n\n+/);
    for (var p = 0; p < Math.min(paragraphs.length, 20); p++) {
      var firstSentence = paragraphs[p].trim().split(/[.!?]/)[0];
      if (firstSentence && firstSentence.length > 10 && firstSentence.length < 150) {
        outline.push('- Topic: ' + firstSentence.substring(0, 100));
      }
    }
  }
  return outline.join('\n') || '(no clear section structure detected)';
}

function buildSystemPrompt(tree, tieredMemory) {
  var prompt = 'You are Claude, an AI assistant in LLM Plus. Be helpful, thorough, and precise.';
  prompt += '\n\nIMPORTANT WRITING RULES:';
  prompt += '\n- When the user asks you to write, draft, or compose anything (motions, briefs, letters, essays, papers, code, etc.), write the FULL, COMPLETE document. Do NOT summarize. Do NOT abbreviate. Do NOT use placeholders like "[continue here]" or "[additional arguments]".';
  prompt += '\n- Write as long as needed. If a legal motion needs 20 pages, write 20 pages. If a letter needs 3 paragraphs, write 3 paragraphs. Match the length to the task.';
  prompt += '\n- If the user specifies a word count (e.g. "10000 words"), you MUST write that many words. Do not stop early. Fill every section with deep, substantive, original analysis. Use as many tokens as you have available. The system will automatically request continuation if you run out of tokens.';
  prompt += '\n- Use proper formatting for the document type: legal documents should have proper caption, headings, numbered paragraphs, signature blocks, etc. Letters should have proper salutation and closing. Academic papers should have sections, citations, etc.';
  prompt += '\n- Never cut yourself short. If you run out of space, the system will automatically continue your response. Use ALL available tokens before stopping.';
  prompt += '\n\nTractatus Tree Definition: A numbered hierarchical outline stored per-project. Keys are strings like "1.0", "1.1", "1.1.1", "2.0". Values are summary strings. Tags: ASSERTS:, REJECTS:, ASSUMES:, OPEN:, RESOLVED:, DOCUMENT:, QUESTION:. Follow this format strictly whenever updating the tree.';

  if (tieredMemory && tieredMemory.tiers && tieredMemory.tiers.length > 0) {
    prompt += '\n\n## Project Memory (Tiered Tractatus)';
    for (var t = 0; t < tieredMemory.tiers.length; t++) {
      var tier = tieredMemory.tiers[t];
      var tierLabel = tier.tier === 1 ? 'Tier 1 — recent, high resolution' :
                      tier.tier === 2 ? 'Tier 2 — summary, medium resolution' :
                      tier.tier === 3 ? 'Tier 3 — archive, lower resolution' :
                      'Tier ' + tier.tier + ' — deep archive';
      prompt += '\n\n### ' + tierLabel + ' (' + tier.nodes + ' nodes):\n';
      var treeStr = JSON.stringify(tier.tree, null, 1);
      var maxLen = tier.tier === 1 ? 12000 : tier.tier === 2 ? 6000 : 3000;
      prompt += treeStr.length > maxLen ? treeStr.substring(0, maxLen) + '\n[...truncated...]' : treeStr;
    }
  } else if (tree && Object.keys(tree).length > 0) {
    prompt += '\n\nCurrent Tractatus tree for this project (follow format rules strictly):\n' + JSON.stringify(tree, null, 2);
  }
  return prompt;
}

app.get('/api/projects', async function(req, res) {
  try {
    var result = await pool.query('SELECT * FROM projects WHERE tractatus_tier = 1 OR tractatus_tier IS NULL ORDER BY created_at ASC');
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

app.delete('/api/projects/:id', async function(req, res) {
  try {
    await pool.query('DELETE FROM projects WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/sessions/:id', async function(req, res) {
  try {
    await pool.query('DELETE FROM sessions WHERE id = $1', [req.params.id]);
    res.json({ success: true });
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

app.get('/api/projects/:id/memory-hierarchy', async function(req, res) {
  try {
    var memory = await loadTieredMemory(req.params.id);
    res.json(memory);
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

app.get('/api/sessions/:id/download', async function(req, res) {
  try {
    var sResult = await pool.query('SELECT s.title, s.transcript, p.name as project_name FROM sessions s LEFT JOIN projects p ON s.project_id = p.id WHERE s.id = $1', [req.params.id]);
    if (!sResult.rows[0]) return res.status(404).json({ error: 'Session not found' });
    var session = sResult.rows[0];
    var transcript = session.transcript || [];
    var lines = [];
    lines.push('Chat Session: ' + (session.title || 'Untitled'));
    if (session.project_name) lines.push('Project: ' + session.project_name);
    lines.push('Exported: ' + new Date().toISOString());
    lines.push('');
    lines.push('='.repeat(60));
    lines.push('');
    for (var i = 0; i < transcript.length; i++) {
      var msg = transcript[i];
      var role = msg.role === 'user' ? 'USER' : 'ASSISTANT';
      lines.push(role + ':');
      lines.push('');
      lines.push(msg.content || '');
      lines.push('');
      lines.push('-'.repeat(60));
      lines.push('');
    }
    var text = lines.join('\n');
    var safeTitle = (session.title || 'chat').replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="' + safeTitle + '.txt"');
    res.send(text);
  } catch (err) {
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

    var tieredMemory = await loadTieredMemory(projectId);

    var sessionResult = await pool.query('SELECT transcript FROM sessions WHERE id = $1', [sessionId]);
    var transcript = sessionResult.rows[0] ? (sessionResult.rows[0].transcript || []) : [];

    var otherSessions = await pool.query(
      'SELECT title, transcript FROM sessions WHERE project_id = $1 AND id != $2 ORDER BY created_at DESC LIMIT 10',
      [projectId, sessionId]
    );
    var crossSessionContext = '';
    var crossContextBudget = 15000;
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
        if (crossSessionContext.length > crossContextBudget) {
          crossSessionContext = crossSessionContext.substring(0, crossContextBudget) + '\n[...truncated...]';
          break;
        }
      }
    }

    var systemPrompt = buildSystemPrompt(tree, tieredMemory);
    if (crossSessionContext) {
      systemPrompt += '\n\n## Context from previous chats in this project\nThe user has had other conversations in this project. Here are excerpts so you can maintain continuity:\n' + crossSessionContext;
    }

    var msgs = [];
    var recent = transcript.slice(-20);
    var maxMsgChars = 12000;
    var totalChars = 0;
    var charBudget = 150000;
    for (var i = recent.length - 1; i >= 0; i--) {
      var content = recent[i].content || '';
      if (content.length > maxMsgChars) {
        content = content.substring(0, maxMsgChars) + '\n\n[...content truncated for context length...]';
      }
      totalChars += content.length;
      if (totalChars > charBudget) break;
      msgs.unshift({ role: recent[i].role, content: content });
    }
    var userContent = message;
    if (userContent.length > 80000) {
      userContent = userContent.substring(0, 80000) + '\n\n[...content truncated for context length...]';
    }
    msgs.push({ role: 'user', content: userContent });

    var requestedWords = extractRequestedWordCount(userContent);
    var fullText = '';
    var maxContinuations = 40;
    var continuationCount = 0;

    async function streamOneCall(callMsgs) {
      try {
        var anthropicRes = await callClaude(callMsgs, systemPrompt, true);
        if (!anthropicRes.ok) {
          var errBody = await anthropicRes.text();
          console.error('[streamOneCall] API error: ' + anthropicRes.status + ' ' + errBody.substring(0, 500));
          res.write('data: ' + JSON.stringify({ type: 'text', text: '\n\n[Error: API returned ' + anthropicRes.status + ']\n\n' }) + '\n\n');
          return { segmentText: '', stopReason: 'error' };
        }
        var reader = anthropicRes.body.getReader();
        var decoder = new TextDecoder();
        var buffer = '';
        var segmentText = '';
        var stopReason = 'end_turn';

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
                  segmentText += parsed.delta.text;
                  res.write('data: ' + JSON.stringify({ type: 'text', text: parsed.delta.text }) + '\n\n');
                } else if (parsed.type === 'message_delta' && parsed.delta && parsed.delta.stop_reason) {
                  stopReason = parsed.delta.stop_reason;
                } else if (parsed.type === 'error') {
                  console.error('[streamOneCall] Stream error:', JSON.stringify(parsed));
                }
              } catch (e) {}
            }
          }
        }
        return { segmentText: segmentText, stopReason: stopReason };
      } catch (err) {
        console.error('[streamOneCall] Exception:', err.message);
        return { segmentText: '', stopReason: 'error' };
      }
    }

    function getLastNWords(text, n) {
      var words = text.split(/\s+/);
      if (words.length <= n) return text;
      return '...' + words.slice(-n).join(' ');
    }

    function countWords(text) {
      return text.split(/\s+/).filter(function(w) { return w.length > 0; }).length;
    }

    console.log('[Chat] requestedWords=' + requestedWords + ' isLongform=' + isLongformRequest(userContent));
    var lastResult = await streamOneCall(msgs);
    fullText = lastResult.segmentText;
    continuationCount = 1;
    console.log('[Chat first call] words=' + countWords(fullText) + ' stopReason=' + lastResult.stopReason);

    while (continuationCount < maxContinuations) {
      var currentWords = countWords(fullText);
      var needsMore = false;

      if (lastResult.stopReason === 'max_tokens') {
        needsMore = true;
        console.log('[Chat] continuing: max_tokens hit');
      } else if (lastResult.stopReason === 'end_turn' && requestedWords > 0 && currentWords < requestedWords * 0.75) {
        needsMore = true;
        console.log('[Chat] continuing: end_turn but only ' + currentWords + '/' + requestedWords + ' words');
      } else if (lastResult.stopReason === 'end_turn' && requestedWords === 0 && isLongformRequest(userContent) && currentWords < 3000 && continuationCount === 1) {
        needsMore = true;
        console.log('[Chat] continuing: longform request with only ' + currentWords + ' words');
      } else {
        console.log('[Chat] stopping: stopReason=' + lastResult.stopReason + ' words=' + currentWords + ' requestedWords=' + requestedWords);
      }

      if (!needsMore) break;

      var remaining = requestedWords > 0 ? requestedWords - currentWords : 5000;
      var tailContext = getLastNWords(fullText, 300);

      var sectionOutline = extractSectionOutline(fullText);

      var continuePrompt = '';

      if (requestedWords > 0) {
        continuePrompt = 'You are writing a long document. Progress: ' + currentWords + ' / ' + requestedWords + ' words (' + Math.round(currentWords / requestedWords * 100) + '%). You need approximately ' + remaining + ' more words.\n\n';
        continuePrompt += 'SECTIONS ALREADY WRITTEN (DO NOT REPEAT THESE):\n' + sectionOutline + '\n\n';
        continuePrompt += 'The document currently ends with:\n"""\n' + tailContext + '\n"""\n\n';
        continuePrompt += 'CRITICAL RULES:\n';
        continuePrompt += '1. Continue EXACTLY where the text above ends. Pick up mid-sentence if needed.\n';
        continuePrompt += '2. NEVER repeat or rephrase content from the sections listed above. Each section heading and argument should appear ONCE in the entire document.\n';
        continuePrompt += '3. Move to ENTIRELY NEW topics, arguments, evidence, and analysis that have NOT been covered.\n';
        continuePrompt += '4. Do NOT restate the same point with different wording — that is padding, not substance.\n';
        continuePrompt += '5. Do NOT add meta-commentary like "Continuing from where I left off."\n';
        continuePrompt += '6. Write at LEAST ' + Math.min(remaining, 4000) + ' more words of genuinely NEW content.\n';
        continuePrompt += '7. Do NOT conclude or summarize until the target word count is reached.\n';
        continuePrompt += '8. Use ALL available tokens.';
      } else {
        continuePrompt = 'You are writing a comprehensive document. Progress: approximately ' + currentWords + ' words so far.\n\n';
        continuePrompt += 'SECTIONS ALREADY WRITTEN (DO NOT REPEAT):\n' + sectionOutline + '\n\n';
        continuePrompt += 'The document currently ends with:\n"""\n' + tailContext + '\n"""\n\n';
        continuePrompt += 'Continue EXACTLY where you left off with ENTIRELY NEW content. Do NOT repeat any section or argument listed above. Use ALL available tokens.';
      }

      var origContext = userContent.length > 6000 ? userContent.substring(0, 6000) + '\n[...truncated for continuation...]' : userContent;
      var continuationMsgs = [
        { role: 'user', content: origContext + '\n\n[SYSTEM: Target ~' + (requestedWords || 'many thousands of') + ' words. Continue the document — do NOT repeat prior sections.]' },
        { role: 'assistant', content: tailContext },
        { role: 'user', content: continuePrompt }
      ];

      var lastResult = await streamOneCall(continuationMsgs);
      fullText += lastResult.segmentText;
      continuationCount++;

      console.log('[Continuation ' + continuationCount + '] Words so far: ' + countWords(fullText) + ' / target: ' + (requestedWords || 'auto') + ' | stop_reason: ' + lastResult.stopReason);
    }

    if (requestedWords > 0) {
      var finalWords = countWords(fullText);
      console.log('[Chat complete] Total words: ' + finalWords + ' / requested: ' + requestedWords + ' | continuations: ' + continuationCount);
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

app.post('/api/report/scopes', async function(req, res) {
  try {
    var projectId = req.body.projectId;
    var scopes = [{ value: 'project', label: 'Entire Project' }];

    var sessions = await pool.query(
      'SELECT id, title FROM sessions WHERE project_id = $1 ORDER BY created_at DESC',
      [projectId]
    );
    for (var i = 0; i < sessions.rows.length; i++) {
      var s = sessions.rows[i];
      scopes.push({ value: 'chat:' + s.id, label: 'Chat: ' + (s.title || 'Untitled') });
    }

    var archives = await pool.query(
      'SELECT id, tier, node_count, created_at FROM tractatus_archive WHERE project_id = $1 ORDER BY created_at DESC',
      [projectId]
    );
    for (var a = 0; a < archives.rows.length; a++) {
      var arch = archives.rows[a];
      var archDate = new Date(arch.created_at).toLocaleDateString();
      var label = 'Since ' + (a + 1) + ' tree' + (a + 1 > 1 ? 's' : '') + ' ago (' + archDate + ', ' + (arch.node_count || '?') + ' nodes)';
      scopes.push({ value: 'since:' + arch.id, label: label });
    }

    res.json(scopes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/report/generate', async function(req, res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  function send(obj) {
    res.write('data: ' + JSON.stringify(obj) + '\n\n');
  }

  try {
    var projectId = req.body.projectId;
    var scope = req.body.scope || 'project';
    var instructions = req.body.instructions || '';

    var projectResult = await pool.query('SELECT name, tractatus_tree FROM projects WHERE id = $1', [projectId]);
    var projectName = projectResult.rows[0] ? projectResult.rows[0].name : 'Project';

    send({ type: 'status', message: 'Gathering data for report...' });

    var contextParts = [];
    var currentTree = projectResult.rows[0] ? projectResult.rows[0].tractatus_tree || {} : {};

    if (scope === 'project') {
      var tieredMemory = await loadTieredMemory(projectId);
      for (var t = 0; t < tieredMemory.tiers.length; t++) {
        var tier = tieredMemory.tiers[t];
        var tierLabel = tier.tier === 1 ? 'Current Memory (Tier 1)' : 'Summary Memory (Tier ' + tier.tier + ')';
        contextParts.push('=== ' + tierLabel + ' (' + tier.nodes + ' nodes) ===\n' + JSON.stringify(tier.tree, null, 1));
      }

      var allSessions = await pool.query(
        'SELECT title, transcript FROM sessions WHERE project_id = $1 ORDER BY created_at ASC',
        [projectId]
      );
      var sessionSummary = '';
      for (var si = 0; si < allSessions.rows.length; si++) {
        var sess = allSessions.rows[si];
        var transcript = sess.transcript || [];
        if (transcript.length === 0) continue;
        sessionSummary += '\n--- Chat: "' + (sess.title || 'Untitled') + '" (' + transcript.length + ' messages) ---\n';
        var recent = transcript.slice(-10);
        for (var mi = 0; mi < recent.length; mi++) {
          var role = recent[mi].role === 'user' ? 'User' : 'Assistant';
          sessionSummary += role + ': ' + (recent[mi].content || '').substring(0, 500) + '\n';
        }
      }
      if (sessionSummary) contextParts.push('=== Chat History ===\n' + sessionSummary.substring(0, 30000));

      var docs = await pool.query('SELECT name, raw_content FROM project_documents WHERE project_id = $1', [projectId]);
      if (docs.rows.length > 0) {
        var docList = 'Project has ' + docs.rows.length + ' documents: ' + docs.rows.map(function(d) { return d.name; }).join(', ');
        contextParts.push('=== Documents ===\n' + docList);
      }

    } else if (scope.startsWith('chat:')) {
      var chatId = scope.substring(5);
      var chatResult = await pool.query('SELECT title, transcript FROM sessions WHERE id = $1 AND project_id = $2', [chatId, projectId]);
      if (chatResult.rows.length > 0) {
        var chatTitle = chatResult.rows[0].title || 'Untitled';
        var chatTranscript = chatResult.rows[0].transcript || [];
        var chatContent = '';
        for (var ci = 0; ci < chatTranscript.length; ci++) {
          var cRole = chatTranscript[ci].role === 'user' ? 'User' : 'Assistant';
          chatContent += cRole + ': ' + (chatTranscript[ci].content || '').substring(0, 2000) + '\n\n';
        }
        contextParts.push('=== Chat: "' + chatTitle + '" (' + chatTranscript.length + ' messages) ===\n' + chatContent.substring(0, 60000));
      }

      if (Object.keys(currentTree).length > 0) {
        contextParts.push('=== Current Project Memory ===\n' + JSON.stringify(currentTree, null, 1).substring(0, 8000));
      }

    } else if (scope.startsWith('since:')) {
      var archiveId = scope.substring(6);
      var archResult = await pool.query('SELECT tree, node_count, created_at FROM tractatus_archive WHERE id = $1 AND project_id = $2', [archiveId, projectId]);
      if (archResult.rows.length > 0) {
        var archTree = archResult.rows[0].tree || {};
        var archDate = new Date(archResult.rows[0].created_at);
        contextParts.push('=== Archived Tree Snapshot (from ' + archDate.toLocaleDateString() + ', ' + (archResult.rows[0].node_count || '?') + ' nodes) ===\n' + JSON.stringify(archTree, null, 1));
      }

      if (Object.keys(currentTree).length > 0) {
        contextParts.push('=== Current Active Memory (' + Object.keys(currentTree).length + ' nodes) ===\n' + JSON.stringify(currentTree, null, 1));
      }

      var tieredMem = await loadTieredMemory(projectId);
      for (var tm = 0; tm < tieredMem.tiers.length; tm++) {
        if (tieredMem.tiers[tm].tier > 1) {
          contextParts.push('=== Tier ' + tieredMem.tiers[tm].tier + ' Summary (' + tieredMem.tiers[tm].nodes + ' nodes) ===\n' +
            JSON.stringify(tieredMem.tiers[tm].tree, null, 1).substring(0, 5000));
        }
      }
    }

    var contextText = contextParts.join('\n\n');
    if (contextText.length > 80000) contextText = contextText.substring(0, 80000) + '\n[...truncated...]';

    send({ type: 'status', message: 'Generating report...' });
    send({ type: 'progress', current: 1, total: 2 });

    var scopeDesc = scope === 'project' ? 'the entire project "' + projectName + '"' :
                    scope.startsWith('chat:') ? 'a specific chat in "' + projectName + '"' :
                    'recent activity in "' + projectName + '" (since a previous memory checkpoint)';

    var prompt = 'Write a comprehensive report covering ' + scopeDesc + '.\n\n';
    prompt += 'Write in normal prose — complete sentences and paragraphs. NOT in numbered Tractatus-style nodes.\n';
    prompt += 'This is a narrative report, not a tree or outline.\n\n';
    if (instructions) prompt += '=== USER INSTRUCTIONS ===\n' + instructions + '\n=== END INSTRUCTIONS ===\n\n';
    prompt += 'Here is all the available context:\n\n' + contextText + '\n\n';
    prompt += 'Write a thorough, well-organized report covering:\n';
    prompt += '- Key findings and facts\n';
    prompt += '- Important assertions and evidence\n';
    prompt += '- Open questions and unresolved issues\n';
    prompt += '- Notable conflicts or contradictions\n';
    prompt += '- Timeline of significant developments (if applicable)\n';
    prompt += '- Conclusions and actionable next steps\n\n';
    prompt += 'ABSOLUTELY NO MARKDOWN. No #, ##, **, *, ---. Write in clean plain text only.\n';
    prompt += 'For section headings, just write the heading text on its own line. No hash symbols.\n';
    prompt += 'Write as long as needed to be thorough. Output ONLY the report.';

    var sysPrompt = 'You are a skilled report writer producing a comprehensive narrative report. ';
    sysPrompt += 'Write in flowing prose — complete sentences and paragraphs. ';
    sysPrompt += 'Do NOT use Tractatus-style numbered nodes. Do NOT use markdown formatting. ';
    sysPrompt += 'Organize with clear section headings (plain text, no # symbols) and substantive paragraphs.';

    var reportText = await streamClaudeToSSE(
      [{ role: 'user', content: prompt }],
      sysPrompt,
      send,
      16384
    );

    reportText = stripMarkdownFromOutput(reportText);
    send({ type: 'progress', current: 2, total: 2 });
    send({ type: 'complete', totalWords: reportText.split(/\s+/).length, cleanedText: reportText });
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    console.error('Report generation error:', err.message);
    send({ type: 'error', error: err.message });
    res.write('data: [DONE]\n\n');
    res.end();
  }
});

app.post('/api/tractator/generate', async function(req, res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  function send(obj) {
    res.write('data: ' + JSON.stringify(obj) + '\n\n');
  }

  try {
    var content = req.body.content || '';
    var docName = req.body.docName || 'Document';
    var depth = parseInt(req.body.depth) || 0;

    var wordCount = content.split(/\s+/).length;
    send({ type: 'status', message: 'Analyzing "' + docName + '" (' + wordCount.toLocaleString() + ' words) at depth ' + depth + '...' });

    var depthLabels = ['broad strokes (whole numbers: 1, 2, 3)', 'one decimal (1.0, 1.1, 1.2, 2.0, 2.1)', 'two decimals (1.0, 1.1, 1.11, 1.12, 2.0)', 'three decimals (1.0, 1.1, 1.11, 1.111, 1.112)'];
    var depthExamples = [
      '{"1": "ASSERTS: First major thesis", "2": "ASSERTS: Second major thesis", "3": "ASSERTS: Third major thesis"}',
      '{"1.0": "ASSERTS: First major thesis", "1.1": "ASSERTS: Sub-point of first thesis", "1.2": "ASSERTS: Another sub-point", "2.0": "ASSERTS: Second major thesis", "2.1": "ASSERTS: Sub-point"}',
      '{"1.0": "ASSERTS: First major thesis", "1.1": "ASSERTS: Sub-point", "1.11": "ASSERTS: Detail of 1.1", "1.12": "ASSERTS: Another detail of 1.1", "2.0": "ASSERTS: Second thesis", "2.1": "ASSERTS: Sub-point", "2.11": "DOCUMENT: Supporting evidence"}',
      '{"1.0": "ASSERTS: First major thesis", "1.1": "ASSERTS: Sub-point", "1.11": "ASSERTS: Detail", "1.111": "ASSERTS: Fine-grained point", "1.112": "DOCUMENT: Specific evidence", "2.0": "ASSERTS: Second thesis"}'
    ];

    var maxChars = 60000;
    var segments = [];
    if (content.length > maxChars) {
      var paragraphs = content.split(/\n\s*\n/);
      var seg = '';
      for (var i = 0; i < paragraphs.length; i++) {
        if (seg.length + paragraphs[i].length > maxChars && seg.length > 0) {
          segments.push(seg.trim());
          seg = '';
        }
        seg += paragraphs[i] + '\n\n';
      }
      if (seg.trim()) segments.push(seg.trim());
    } else {
      segments.push(content);
    }

    var partialTrees = [];

    for (var s = 0; s < segments.length; s++) {
      if (segments.length > 1) {
        send({ type: 'status', message: 'Processing segment ' + (s + 1) + ' of ' + segments.length + '...' });
        send({ type: 'progress', current: s + 1, total: segments.length });
      }

      var prompt = 'Create a Tractatus-style propositional tree for the following text.\n\n';
      prompt += 'DEPTH LEVEL: ' + depthLabels[depth] + '\n\n';
      prompt += 'RULES:\n';
      prompt += '- Each node is a key-value pair where the key is the numbering and the value starts with a TYPE prefix\n';
      prompt += '- Types: ASSERTS (claims/theses), DOCUMENT (facts/evidence), REJECTS (counter-arguments), OPEN (unresolved questions)\n';
      prompt += '- The tree should capture the logical structure and argumentative flow of the document\n';
      prompt += '- Be comprehensive — cover ALL major points in the text\n\n';
      prompt += 'EXAMPLE at this depth level:\n' + depthExamples[depth] + '\n\n';
      if (segments.length > 1) prompt += '(This is segment ' + (s + 1) + ' of ' + segments.length + ' — focus on the content in THIS segment)\n\n';
      prompt += 'TEXT TO ANALYZE:\n' + segments[s] + '\n\n';
      prompt += 'Return ONLY a valid JSON object with the Tractatus tree. No markdown fences, no commentary.';

      var treeRaw = await callClaude(
        [{ role: 'user', content: prompt }],
        'You output only valid JSON objects. No markdown fences, no commentary. Create comprehensive Tractatus-style propositional trees.',
        false
      );

      try {
        var parsed = JSON.parse(treeRaw);
        partialTrees.push(parsed);
      } catch (e) {
        var jsonMatch = treeRaw.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try { partialTrees.push(JSON.parse(jsonMatch[0])); } catch (e2) { console.error('Tractator parse error:', e2.message); }
        }
      }

      if (s < segments.length - 1) await sleep(3000);
    }

    var finalTree;
    if (partialTrees.length === 0) {
      throw new Error('Failed to generate Tractatus tree');
    } else if (partialTrees.length === 1) {
      finalTree = partialTrees[0];
    } else {
      send({ type: 'status', message: 'Merging ' + partialTrees.length + ' partial trees into unified tree...' });

      var mergePrompt = 'Merge these ' + partialTrees.length + ' partial Tractatus trees into ONE unified, coherent tree.\n\n';
      mergePrompt += 'DEPTH LEVEL: ' + depthLabels[depth] + '\n';
      mergePrompt += 'Renumber all nodes sequentially. Eliminate exact duplicates. Maintain logical flow.\n\n';
      for (var mt = 0; mt < partialTrees.length; mt++) {
        mergePrompt += '--- Segment ' + (mt + 1) + ' tree ---\n' + JSON.stringify(partialTrees[mt]) + '\n\n';
      }
      mergePrompt += 'Return ONLY the merged JSON object.';

      var mergeRaw = await callClaude(
        [{ role: 'user', content: mergePrompt }],
        'You output only valid JSON objects. No markdown fences, no commentary.',
        false
      );

      try {
        finalTree = JSON.parse(mergeRaw);
      } catch (e3) {
        var m3 = mergeRaw.match(/\{[\s\S]*\}/);
        finalTree = m3 ? JSON.parse(m3[0]) : partialTrees[0];
      }
    }

    var nodeCount = Object.keys(finalTree).length;
    send({ type: 'complete', tree: finalTree, nodeCount: nodeCount, docName: docName, depth: depth });
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    console.error('Tractator error:', err);
    send({ type: 'error', error: err.message });
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

    if (nodeCount >= 500) {
      send({ type: 'status', message: 'Tree reached ' + nodeCount + ' nodes. Compressing to higher tier...' });
      try {
        await compressTractatusTier(projectId, merged, nodeCount, send);
      } catch (compErr) {
        console.error('Tractatus compression error:', compErr.message);
        send({ type: 'status', message: 'Compression deferred: ' + compErr.message });
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    console.error('Tractatus stream error:', err.message, err.stack);
    try { send({ type: 'error', message: err.message }); } catch(e2) {}
    res.write('data: [DONE]\n\n');
    res.end();
  }
});

async function compressTractatusTier(projectId, fullTree, nodeCount, sendFn) {
  console.log('[Tractatus] Compressing ' + nodeCount + ' nodes for project ' + projectId);

  var projectResult = await pool.query('SELECT name, tractatus_tier FROM projects WHERE id = $1', [projectId]);
  var projectName = projectResult.rows[0] ? projectResult.rows[0].name : 'Unknown';
  var currentTier = projectResult.rows[0] ? (projectResult.rows[0].tractatus_tier || 1) : 1;

  var compressPrompt = 'Below is a Tractatus tree with ' + nodeCount + ' nodes from a project called "' + projectName + '".\n\n';
  compressPrompt += JSON.stringify(fullTree, null, 1) + '\n\n';
  compressPrompt += 'Generate a compressed second-order Tractatus tree that captures ALL key information at a higher level of abstraction.\n';
  compressPrompt += 'Rules:\n';
  compressPrompt += '- Reduce to roughly 50-80 nodes maximum\n';
  compressPrompt += '- Preserve all critical facts, assertions, evidence, and unresolved questions\n';
  compressPrompt += '- Use the same tagging system: ASSERTS:, REJECTS:, ASSUMES:, OPEN:, RESOLVED:, DOCUMENT:, QUESTION:\n';
  compressPrompt += '- Merge related nodes, eliminate redundancy, synthesize patterns\n';
  compressPrompt += '- Use standard Tractatus numbering: "1.0", "1.1", "1.1.1", etc.\n';
  compressPrompt += '- Return ONLY the JSON object. No markdown, no commentary.';

  var summaryRaw = await callClaude(
    [{ role: 'user', content: compressPrompt }],
    'You output only valid JSON objects. No markdown, no commentary, no fences.',
    false,
    8192
  );

  var summaryTree;
  try {
    var cleaned = summaryRaw;
    if (typeof cleaned === 'object' && cleaned.content) {
      cleaned = cleaned.content.map(function(c) { return c.text || ''; }).join('');
    }
    if (typeof cleaned === 'string' && cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    }
    summaryTree = JSON.parse(cleaned);
  } catch (e) {
    var match = (typeof summaryRaw === 'string' ? summaryRaw : JSON.stringify(summaryRaw)).match(/\{[\s\S]*\}/);
    if (match) {
      summaryTree = JSON.parse(match[0]);
    } else {
      throw new Error('Failed to parse compression result');
    }
  }

  var summaryNodeCount = Object.keys(summaryTree).length;
  console.log('[Tractatus] Compressed ' + nodeCount + ' nodes → ' + summaryNodeCount + ' summary nodes');

  var summaryTier = currentTier + 1;
  var txClient = await pool.connect();
  try {
    await txClient.query('BEGIN');

    await txClient.query(
      'INSERT INTO tractatus_archive (project_id, tier, tree, node_count) VALUES ($1, $2, $3, $4)',
      [projectId, currentTier, JSON.stringify(fullTree), nodeCount]
    );

    var existingSummaries = await txClient.query(
      'SELECT id, tractatus_tree FROM projects WHERE parent_project_id = $1 AND tractatus_tier = $2',
      [projectId, summaryTier]
    );

    var recurseTarget = null;
    if (existingSummaries.rows.length > 0) {
      var existingSummary = existingSummaries.rows[0].tractatus_tree || {};
      var mergedSummary = Object.assign({}, existingSummary, summaryTree);
      var mergedCount = Object.keys(mergedSummary).length;
      await txClient.query(
        'UPDATE projects SET tractatus_tree = $1 WHERE id = $2',
        [JSON.stringify(mergedSummary), existingSummaries.rows[0].id]
      );
      console.log('[Tractatus] Merged into existing Tier ' + summaryTier + ' summary (' + mergedCount + ' nodes)');
      if (mergedCount >= 500) {
        recurseTarget = { id: existingSummaries.rows[0].id, tree: mergedSummary, count: mergedCount };
      }
    } else {
      var dateStr = new Date().toISOString().split('T')[0];
      var summaryName = projectName + ' — Tier ' + summaryTier + ' Summary (' + dateStr + ')';
      await txClient.query(
        'INSERT INTO projects (name, tractatus_tree, tractatus_tier, parent_project_id) VALUES ($1, $2, $3, $4)',
        [summaryName, JSON.stringify(summaryTree), summaryTier, projectId]
      );
      console.log('[Tractatus] Created new Tier ' + summaryTier + ' summary project');
    }

    await txClient.query(
      "UPDATE projects SET tractatus_tree = '{}' WHERE id = $1",
      [projectId]
    );

    await txClient.query('COMMIT');

    if (recurseTarget) {
      console.log('[Tractatus] Tier ' + summaryTier + ' also hit 500, recursing...');
      await compressTractatusTier(recurseTarget.id, recurseTarget.tree, recurseTarget.count, sendFn);
    }
  } catch (txErr) {
    await txClient.query('ROLLBACK');
    throw txErr;
  } finally {
    txClient.release();
  }

  if (sendFn) {
    sendFn({ type: 'status', message: 'Memory compressed: ' + nodeCount + ' → ' + summaryNodeCount + ' nodes (Tier ' + summaryTier + ')' });
    sendFn({ type: 'compressed', tier: summaryTier, originalNodes: nodeCount, summaryNodes: summaryNodeCount });
  }
}

async function loadTieredMemory(projectId) {
  var tiers = [];

  var mainResult = await pool.query('SELECT tractatus_tree, tractatus_tier, name FROM projects WHERE id = $1', [projectId]);
  if (mainResult.rows.length > 0) {
    var mainTree = mainResult.rows[0].tractatus_tree || {};
    if (Object.keys(mainTree).length > 0) {
      tiers.push({
        tier: mainResult.rows[0].tractatus_tier || 1,
        label: 'recent',
        name: mainResult.rows[0].name,
        tree: mainTree,
        nodes: Object.keys(mainTree).length
      });
    }
  }

  var queue = [projectId];
  var visited = {};
  visited[projectId] = true;
  while (queue.length > 0) {
    var parentId = queue.shift();
    var children = await pool.query(
      'SELECT id, name, tractatus_tree, tractatus_tier FROM projects WHERE parent_project_id = $1 ORDER BY tractatus_tier ASC, created_at ASC',
      [parentId]
    );
    for (var i = 0; i < children.rows.length; i++) {
      var child = children.rows[i];
      if (visited[child.id]) continue;
      visited[child.id] = true;
      var cTree = child.tractatus_tree || {};
      if (Object.keys(cTree).length > 0) {
        var tierNum = child.tractatus_tier || 2;
        tiers.push({
          tier: tierNum,
          label: tierNum === 2 ? 'summary' : tierNum === 3 ? 'archive' : 'deep-archive',
          name: child.name,
          tree: cTree,
          nodes: Object.keys(cTree).length,
          childProjectId: child.id
        });
      }
      queue.push(child.id);
    }
  }

  var archives = await pool.query(
    'SELECT tier, tree, node_count, created_at FROM tractatus_archive WHERE project_id = $1 ORDER BY tier ASC, created_at DESC LIMIT 10',
    [projectId]
  );

  tiers.sort(function(a, b) { return a.tier - b.tier; });
  return { tiers: tiers, archives: archives.rows };
}

async function streamClaudeToSSE(messages, systemPrompt, sendFn, maxTokens) {
  var anthropicRes = await callClaude(messages, systemPrompt, true, maxTokens || 16384);
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

async function streamClaudeWithContinuation(messages, systemPrompt, sendFn, maxTokens, targetWords, maxContinuations) {
  targetWords = targetWords || 1500;
  maxContinuations = maxContinuations || 8;
  var fullText = '';

  fullText = await streamClaudeToSSE(messages, systemPrompt, sendFn, maxTokens || 16384);
  var wordCount = fullText.split(/\s+/).length;

  var attempt = 0;
  while (wordCount < targetWords * 0.85 && attempt < maxContinuations) {
    attempt++;
    var remaining = targetWords - wordCount;
    console.log('[Section continuation ' + attempt + '] Words: ' + wordCount + '/' + targetWords + ', need ~' + remaining + ' more');
    sendFn({ type: 'status', message: 'Continuing section... (' + wordCount + '/' + targetWords + ' words)' });

    var lastParagraph = fullText.substring(fullText.length - 500);
    var contPrompt = 'You were writing a section and stopped at ' + wordCount + ' words. You need to write ' + remaining + ' MORE words to reach ' + targetWords + ' total.\n\n';
    contPrompt += 'Here is where you left off (last paragraph):\n"""' + lastParagraph + '"""\n\n';
    contPrompt += 'CONTINUE writing from EXACTLY where you left off. Do NOT repeat any content. Do NOT start over.\n';
    contPrompt += 'Write at least ' + remaining + ' more words of substantive, detailed content.\n';
    contPrompt += 'Output ONLY the continuation text — no headers, no meta-commentary.\n';
    contPrompt += 'ABSOLUTELY NO MARKDOWN. No #, ##, **, *, ---. Plain text only.';

    var contText = await streamClaudeToSSE(
      [{ role: 'user', content: contPrompt }],
      systemPrompt,
      sendFn,
      maxTokens || 16384
    );

    if (contText.split(/\s+/).length < 50) break;
    fullText += '\n\n' + contText;
    wordCount = fullText.split(/\s+/).length;

    if (attempt < maxContinuations && wordCount < targetWords * 0.85) {
      await sleep(2000);
    }
  }

  console.log('[Section complete] Final words: ' + wordCount + ' (target: ' + targetWords + ')');
  return fullText;
}

function stripMarkdownFromOutput(text) {
  return text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(?<!\w)\*([^*]+)\*(?!\w)/g, '$1')
    .replace(/(?<!\w)__([^_]+)__(?!\w)/g, '$1')
    .replace(/(?<!\w)_([^_]+)_(?!\w)/g, '$1')
    .replace(/^---+$/gm, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1');
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

async function fetchWithTimeout(url, timeoutMs) {
  var controller = new AbortController();
  var timer = setTimeout(function() { controller.abort(); }, timeoutMs);
  try {
    var resp = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'LLMPlus/1.0 (mailto:jmkuczynski@yahoo.com)' } });
    clearTimeout(timer);
    if (!resp.ok) return null;
    return await resp.json();
  } catch (e) {
    clearTimeout(timer);
    return null;
  }
}

async function searchSemanticScholar(query) {
  var results = [];
  try {
    var data = await fetchWithTimeout(
      'https://api.semanticscholar.org/graph/v1/paper/search?query=' + encodeURIComponent(query) + '&fields=title,abstract,year,authors&limit=5',
      10000
    );
    if (data && data.data) {
      for (var i = 0; i < data.data.length; i++) {
        var p = data.data[i];
        if (p.abstract) {
          results.push({
            source: 'Semantic Scholar',
            title: p.title || '',
            abstract: p.abstract || '',
            year: p.year || '',
            authors: (p.authors || []).map(function(a) { return a.name; }).join(', ')
          });
        }
      }
    }
  } catch (e) { console.error('SemanticScholar error:', e.message); }
  return results;
}

async function searchOpenAlex(query) {
  var results = [];
  try {
    var data = await fetchWithTimeout(
      'https://api.openalex.org/works?search=' + encodeURIComponent(query) + '&per-page=5&mailto=jmkuczynski@yahoo.com',
      10000
    );
    if (data && data.results) {
      for (var i = 0; i < data.results.length; i++) {
        var w = data.results[i];
        var abText = '';
        if (w.abstract_inverted_index) {
          var words = [];
          var idx = w.abstract_inverted_index;
          for (var word in idx) {
            for (var j = 0; j < idx[word].length; j++) {
              words[idx[word][j]] = word;
            }
          }
          abText = words.filter(Boolean).join(' ');
        }
        if (abText || w.title) {
          results.push({
            source: 'OpenAlex',
            title: w.title || '',
            abstract: abText,
            year: w.publication_year || '',
            authors: (w.authorships || []).slice(0, 5).map(function(a) { return a.author ? a.author.display_name : ''; }).join(', '),
            doi: w.doi || ''
          });
        }
      }
    }
  } catch (e) { console.error('OpenAlex error:', e.message); }
  return results;
}

async function searchCrossRef(query) {
  var results = [];
  try {
    var data = await fetchWithTimeout(
      'https://api.crossref.org/works?query=' + encodeURIComponent(query) + '&rows=5&mailto=jmkuczynski@yahoo.com',
      10000
    );
    if (data && data.message && data.message.items) {
      for (var i = 0; i < data.message.items.length; i++) {
        var item = data.message.items[i];
        var abstr = item.abstract || '';
        abstr = abstr.replace(/<[^>]+>/g, '');
        if (abstr || item.title) {
          results.push({
            source: 'CrossRef',
            title: Array.isArray(item.title) ? item.title[0] : (item.title || ''),
            abstract: abstr,
            year: item.published && item.published['date-parts'] ? item.published['date-parts'][0][0] : '',
            authors: (item.author || []).slice(0, 5).map(function(a) { return (a.given || '') + ' ' + (a.family || ''); }).join(', '),
            doi: item.DOI || ''
          });
        }
      }
    }
  } catch (e) { console.error('CrossRef error:', e.message); }
  return results;
}

async function fetchTextWithTimeout(url, timeoutMs) {
  var controller = new AbortController();
  var timer = setTimeout(function() { controller.abort(); }, timeoutMs);
  try {
    var resp = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'LLMPlus/1.0 (mailto:jmkuczynski@yahoo.com)' } });
    clearTimeout(timer);
    if (!resp.ok) return null;
    return await resp.text();
  } catch (e) {
    clearTimeout(timer);
    return null;
  }
}

async function searchPubMed(query) {
  var results = [];
  try {
    var searchData = await fetchWithTimeout(
      'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=' + encodeURIComponent(query) + '&retmax=5&retmode=json&email=jmkuczynski@yahoo.com',
      10000
    );
    if (searchData && searchData.esearchresult && searchData.esearchresult.idlist && searchData.esearchresult.idlist.length > 0) {
      var ids = searchData.esearchresult.idlist;
      var idStr = ids.join(',');
      var rawText = await fetchTextWithTimeout(
        'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=' + idStr + '&retmode=text&rettype=abstract&email=jmkuczynski@yahoo.com',
        12000
      );
      if (rawText) {
        var entries = rawText.split(/\n\n(?=\d+\.\s)/);
        if (entries.length <= 1) entries = [rawText];
        for (var i = 0; i < entries.length && i < ids.length; i++) {
          var entry = entries[i].trim();
          if (entry.length > 20) {
            var titleMatch = entry.match(/\n([^\n]+)\.\n/);
            results.push({
              source: 'PubMed',
              title: titleMatch ? titleMatch[1].trim() : 'PMID:' + ids[i],
              abstract: entry.substring(0, 2000),
              year: '',
              authors: '',
              pmid: ids[i]
            });
          }
        }
      }
    }
  } catch (e) { console.error('PubMed error:', e.message); }
  return results;
}

async function fetchScholarlyResearch(queries, sendFn) {
  var allResults = [];
  var seenTitles = {};

  for (var q = 0; q < queries.length; q++) {
    var query = queries[q];
    if (sendFn) sendFn({ type: 'research_status', message: 'Searching: "' + query + '" (' + (q + 1) + '/' + queries.length + ')' });

    var apiResults = await Promise.all([
      searchSemanticScholar(query),
      searchOpenAlex(query),
      searchCrossRef(query),
      searchPubMed(query)
    ]);

    for (var a = 0; a < apiResults.length; a++) {
      for (var r = 0; r < apiResults[a].length; r++) {
        var result = apiResults[a][r];
        var titleKey = (result.title || '').toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 60);
        if (titleKey && !seenTitles[titleKey]) {
          seenTitles[titleKey] = true;
          allResults.push(result);
        }
      }
    }

    if (q < queries.length - 1) await sleep(500);
  }

  return allResults;
}

function formatResearchForPrompt(results, charBudget) {
  if (!results || results.length === 0) return '';
  var text = '';
  var count = 0;
  for (var i = 0; i < results.length && text.length < charBudget; i++) {
    var r = results[i];
    text += '\n[' + (count + 1) + '] ';
    if (r.authors) text += r.authors;
    if (r.year) text += ' (' + r.year + ')';
    text += '. "' + r.title + '".';
    if (r.doi) text += ' DOI: ' + r.doi + '.';
    if (r.pmid) text += ' PMID: ' + r.pmid + '.';
    text += ' [' + r.source + ']';
    if (r.abstract) text += '\n   Abstract: ' + r.abstract.substring(0, 800);
    text += '\n';
    count++;
  }
  return text;
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
    var rawWc = parseInt(req.body.wordcount);
    var autoLength = !rawWc || rawWc <= 0;
    var targetWords = autoLength ? 0 : rawWc;
    var doctype = req.body.doctype || 'paper';
    var fetchResearchFlag = req.body.fetchResearch || false;

    var projectResult = await pool.query('SELECT tractatus_tree FROM projects WHERE id = $1', [projectId]);
    var tree = projectResult.rows[0] ? projectResult.rows[0].tractatus_tree || {} : {};

    var sessionResult = await pool.query('SELECT transcript FROM sessions WHERE id = $1', [sessionId]);
    var transcript = sessionResult.rows[0] ? (sessionResult.rows[0].transcript || []) : [];

    var selectedDocs = req.body.selectedDocs || [];
    var sourceContent = '';

    if (selectedDocs.length > 0) {
      for (var sd = 0; sd < selectedDocs.length; sd++) {
        var docRow;
        if (selectedDocs[sd].source === 'global') {
          docRow = await pool.query('SELECT name, raw_content FROM global_documents WHERE id = $1', [selectedDocs[sd].id]);
        } else {
          docRow = await pool.query('SELECT name, raw_content FROM project_documents WHERE id = $1 AND project_id = $2', [selectedDocs[sd].id, projectId]);
        }
        if (docRow.rows.length > 0) {
          var docContent = docRow.rows[0].raw_content || '';
          sourceContent += '--- Document: ' + docRow.rows[0].name + ' (' + docContent.split(/\s+/).length + ' words) ---\n';
          sourceContent += docContent;
          sourceContent += '\n\n';
        }
      }
    } else {
      var docResult = await pool.query('SELECT name, raw_content FROM project_documents WHERE project_id = $1', [projectId]);
      var projectDocs = docResult.rows;
      if (projectDocs.length > 0) {
        for (var d = 0; d < projectDocs.length; d++) {
          var docContent = projectDocs[d].raw_content || '';
          sourceContent += '--- Document: ' + projectDocs[d].name + ' (' + docContent.split(/\s+/).length + ' words) ---\n';
          sourceContent += docContent;
          sourceContent += '\n\n';
        }
      }
    }

    var treeContext = '';
    if (Object.keys(tree).length > 0) {
      treeContext = 'Project knowledge (Tractatus tree):\n' + JSON.stringify(tree).substring(0, 5000) + '\n\n';
    }

    var userRequest = autoLength
      ? 'Generate a ' + doctype.replace(/_/g, ' ') + ' (auto length)'
      : 'Generate a ' + targetWords + '-word ' + doctype.replace(/_/g, ' ');
    if (title) userRequest += ' titled "' + title + '"';
    if (instructions) userRequest += '\n\nInstructions: ' + instructions.substring(0, 500);

    var jobResult = await pool.query(
      "INSERT INTO document_jobs (session_id, original_text, status) VALUES ($1, $2, 'outline') RETURNING *",
      [sessionId, userRequest]
    );
    var jobId = jobResult.rows[0].id;

    if (autoLength || targetWords <= 5000) {
      var lengthNote = autoLength ? 'appropriate length (use your judgment)' : targetWords + ' words';
      send({ type: 'status', pass: 1, message: autoLength ? 'Generating document (auto length)...' : 'Generating ' + targetWords + '-word document...' });
      send({ type: 'progress', current: 1, total: 1 });

      var singlePrompt = 'Write a ' + doctype.replace(/_/g, ' ');
      if (title) singlePrompt += ' titled "' + title + '"';
      singlePrompt += '.\n\n';
      if (instructions) singlePrompt += '=== USER INSTRUCTIONS (follow these exactly) ===\n' + instructions + '\n=== END INSTRUCTIONS ===\n\n';
      if (autoLength) {
        singlePrompt += 'LENGTH: Use your best judgment for how long this document should be. Write as much as is needed to be thorough and complete.\n\n';
      } else {
        singlePrompt += 'TARGET LENGTH: exactly ' + targetWords + ' words. Do NOT exceed this. Do NOT write less.\n\n';
      }
      if (treeContext) singlePrompt += treeContext;
      if (sourceContent) singlePrompt += 'Source documents for reference:\n' + sourceContent.substring(0, 15000) + '\n\n';
      singlePrompt += 'ABSOLUTELY NO MARKDOWN FORMATTING. Do NOT use #, ##, ###, **, *, ---, ``` or any markdown syntax.\n';
      singlePrompt += 'Use plain text only. For headings, just write the heading text on its own line (no # symbols). For emphasis, use the words themselves — no asterisks or underscores.\n';
      singlePrompt += 'For lists, use "1." or "a)" or dashes, but never markdown bullet syntax.\n\n';
      singlePrompt += autoLength
        ? 'CRITICAL: Follow the user\'s instructions EXACTLY. Write a complete, thorough document. Output ONLY the document text — plain text, no markdown.'
        : 'CRITICAL: Follow the user\'s instructions EXACTLY. Write EXACTLY ' + targetWords + ' words. Output ONLY the document text — plain text, no markdown.';

      var singleSysPrompt = 'You are writing a ' + doctype.replace(/_/g, ' ') + '. Follow the user\'s instructions precisely. '
        + (autoLength ? 'Write a thorough, complete document of appropriate length.' : 'Write exactly the requested number of words.')
        + ' Output ONLY the document — no meta-commentary. NEVER use markdown formatting (no #, ##, **, *, ---, ```). Use plain text only.';
      var singleResult = autoLength
        ? await streamClaudeToSSE(
            [{ role: 'user', content: singlePrompt }],
            singleSysPrompt,
            send,
            16384
          )
        : await streamClaudeWithContinuation(
            [{ role: 'user', content: singlePrompt }],
            singleSysPrompt,
            send,
            16384,
            targetWords,
            6
          );

      singleResult = stripMarkdownFromOutput(singleResult);
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

    var totalSourceWords = sourceContent.split(/\s+/).length;
    var outline;

    if (totalSourceWords > 80000) {
      send({ type: 'status', pass: 0, message: 'Pass 0: Input is ' + totalSourceWords.toLocaleString() + ' words. Splitting into segments for skeleton extraction...' });

      var paragraphs = sourceContent.split(/\n\s*\n/);
      var segments = [];
      var currentSegment = '';
      var currentWords = 0;
      var segmentLimit = 20000;

      for (var si = 0; si < paragraphs.length; si++) {
        var paraWords = paragraphs[si].split(/\s+/).length;
        if (currentWords + paraWords > segmentLimit && currentWords > 0) {
          segments.push(currentSegment.trim());
          currentSegment = '';
          currentWords = 0;
        }
        currentSegment += paragraphs[si] + '\n\n';
        currentWords += paraWords;
      }
      if (currentSegment.trim()) segments.push(currentSegment.trim());

      send({ type: 'status', pass: 0, message: 'Split into ' + segments.length + ' segments. Extracting skeletons...' });

      var wordsPerSection = targetWords > 20000 ? 3000 : targetWords > 10000 ? 2000 : 1500;
      var numSections = Math.max(3, Math.ceil(targetWords / wordsPerSection));
      var partialSkeletons = [];

      for (var sg = 0; sg < segments.length; sg++) {
        send({ type: 'status', pass: 0, message: 'Extracting skeleton from segment ' + (sg + 1) + ' of ' + segments.length + '...' });
        send({ type: 'progress', current: sg + 1, total: segments.length });

        var segContent = segments[sg].length > 60000 ? segments[sg].substring(0, 60000) : segments[sg];
        var segPrompt = 'You are analyzing segment ' + (sg + 1) + ' of ' + segments.length + ' from a large document.\n\n';
        segPrompt += 'Create a partial outline for a ' + targetWords + '-word ' + doctype.replace(/_/g, ' ') + ' based on the content in this segment.\n\n';
        if (title) segPrompt += 'Overall document title: ' + title + '\n';
        if (instructions) segPrompt += 'Instructions: ' + instructions + '\n\n';
        segPrompt += 'Segment content:\n' + segContent + '\n\n';
        segPrompt += 'Return ONLY a JSON array of section objects covering the themes in this segment:\n';
        segPrompt += '[{"title": "Section Title", "description": "What this section covers", "key_points": ["point1", "point2"], "target_words": ' + wordsPerSection + '}]\n';
        segPrompt += 'Return ONLY the JSON array.';

        try {
          var segOutline = await callClaude(
            [{ role: 'user', content: segPrompt }],
            'You output only valid JSON arrays. No markdown fences, no commentary.',
            false
          );
          var parsed;
          try { parsed = JSON.parse(segOutline); } catch(e2) {
            var m2 = segOutline.match(/\[[\s\S]*\]/);
            parsed = m2 ? JSON.parse(m2[0]) : [];
          }
          if (parsed.length > 0) partialSkeletons.push(parsed);
        } catch (segErr) {
          console.error('Segment ' + (sg + 1) + ' skeleton error:', segErr.message);
        }

        if (sg < segments.length - 1) await sleep(3000);
      }

      send({ type: 'status', pass: 0, message: 'Merging ' + partialSkeletons.length + ' partial skeletons into unified outline...' });

      var mergePrompt = 'You have ' + partialSkeletons.length + ' partial outlines from different segments of a large document.\n';
      mergePrompt += 'Merge them into ONE unified, coherent outline for a ' + targetWords + '-word ' + doctype.replace(/_/g, ' ') + '.\n\n';
      if (title) mergePrompt += 'Title: ' + title + '\n';
      if (instructions) mergePrompt += 'Instructions: ' + instructions + '\n\n';
      mergePrompt += 'Target: approximately ' + numSections + ' sections, each roughly ' + wordsPerSection + ' words.\n\n';
      if (treeContext) mergePrompt += treeContext;
      mergePrompt += 'Partial outlines:\n';
      for (var ms = 0; ms < partialSkeletons.length; ms++) {
        mergePrompt += '\n--- Segment ' + (ms + 1) + ' outline ---\n' + JSON.stringify(partialSkeletons[ms]) + '\n';
      }
      mergePrompt += '\nMerge these into one unified outline. Eliminate duplicates, ensure logical flow, consolidate related topics.\n';
      mergePrompt += 'Return ONLY a JSON array:\n';
      mergePrompt += '[{"title": "Section Title", "description": "What this section covers", "key_points": ["point1", "point2"], "target_words": ' + wordsPerSection + '}]\n';
      mergePrompt += 'Return ONLY the JSON array.';

      var mergeRaw = await callClaude(
        [{ role: 'user', content: mergePrompt }],
        'You output only valid JSON arrays. No markdown fences, no commentary.',
        false
      );

      try {
        outline = JSON.parse(mergeRaw);
      } catch (e3) {
        var m3 = mergeRaw.match(/\[[\s\S]*\]/);
        outline = m3 ? JSON.parse(m3[0]) : [];
      }

      if (outline.length === 0) {
        throw new Error('Failed to merge outlines from segments');
      }

      await pool.query(
        "UPDATE document_jobs SET global_skeleton = $1, status = 'writing' WHERE id = $2",
        [JSON.stringify(outline), jobId]
      );

      send({ type: 'status', pass: 0, message: 'Pass 0 complete: merged into ' + outline.length + ' sections.' });

    } else {

      send({ type: 'status', pass: 1, message: 'Pass 1: Creating detailed outline...' });

      var wordsPerSection = targetWords > 20000 ? 3000 : targetWords > 10000 ? 2000 : 1500;
      var numSections = Math.max(3, Math.ceil(targetWords / wordsPerSection));

      var outlinePrompt = 'Create a detailed section-by-section outline for a ' + targetWords + '-word ' + doctype.replace(/_/g, ' ') + '.\n\n';
      if (title) outlinePrompt += 'Title: ' + title + '\n';
      if (instructions) outlinePrompt += '=== USER INSTRUCTIONS (follow these exactly) ===\n' + instructions + '\n=== END INSTRUCTIONS ===\n\n';
      outlinePrompt += 'Target: approximately ' + numSections + ' sections, each roughly ' + wordsPerSection + ' words.\n\n';
      if (treeContext) outlinePrompt += treeContext;
      if (sourceContent) outlinePrompt += 'Source documents for reference:\n' + sourceContent.substring(0, 40000) + '\n\n';
      outlinePrompt += 'Return ONLY a JSON array of section objects:\n';
      outlinePrompt += '[{"title": "Section Title", "description": "What this section covers", "key_points": ["point1", "point2"], "target_words": ' + wordsPerSection + '}]\n';
      outlinePrompt += 'Include all major sections. Return ONLY the JSON array.';

      var outlineRaw = await callClaude(
        [{ role: 'user', content: outlinePrompt }],
        'You output only valid JSON arrays. No markdown fences, no commentary.',
        false
      );

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
    }
    var sectionResearch = {};

    if (fetchResearchFlag && outline.length > 0) {
      send({ type: 'status', pass: 'research', message: 'Research Phase: Generating search queries for ' + outline.length + ' sections...' });

      var queryGenPrompt = 'You are preparing to write a ' + doctype.replace(/_/g, ' ') + '.\n\n';
      queryGenPrompt += 'Here is the outline:\n';
      for (var oq = 0; oq < outline.length; oq++) {
        queryGenPrompt += (oq + 1) + '. ' + outline[oq].title + ': ' + (outline[oq].description || '') + '\n';
      }
      queryGenPrompt += '\nFor EACH section, generate 3-5 academic search queries that would find real scholarly papers, case law, or data relevant to that section.\n';
      queryGenPrompt += 'Return ONLY a JSON object where keys are section indices (0-based) and values are arrays of search query strings.\n';
      queryGenPrompt += 'Example: {"0": ["query1", "query2", "query3"], "1": ["query4", "query5"]}\n';
      queryGenPrompt += 'Make queries specific and academic. Return ONLY the JSON.';

      try {
        var queryGenRaw = await callClaude(
          [{ role: 'user', content: queryGenPrompt }],
          'You output only valid JSON. No markdown fences, no commentary.',
          false
        );
        var sectionQueries;
        try { sectionQueries = JSON.parse(queryGenRaw); } catch (qe) {
          var qMatch = queryGenRaw.match(/\{[\s\S]*\}/);
          sectionQueries = qMatch ? JSON.parse(qMatch[0]) : {};
        }

        var totalQueries = 0;
        for (var sqk in sectionQueries) {
          if (Array.isArray(sectionQueries[sqk])) totalQueries += sectionQueries[sqk].length;
        }
        send({ type: 'status', pass: 'research', message: 'Research Phase: ' + totalQueries + ' queries across ' + Object.keys(sectionQueries).length + ' sections. Fetching from 4 academic APIs...' });

        for (var si = 0; si < outline.length; si++) {
          var queries = sectionQueries[String(si)] || sectionQueries[si] || [];
          if (queries.length === 0) continue;

          send({ type: 'research_status', message: 'Researching section ' + (si + 1) + '/' + outline.length + ': "' + outline[si].title + '" (' + queries.length + ' queries)' });

          var results = await fetchScholarlyResearch(queries, send);
          if (results.length > 0) {
            sectionResearch[si] = results;
            send({ type: 'research_status', message: 'Section ' + (si + 1) + ': found ' + results.length + ' sources' });
          } else {
            var rephrasedQueries = queries.map(function(q) {
              return q.replace(/\b(analysis|study|research)\b/gi, 'review').replace(/\b(impact|effect)\b/gi, 'influence');
            });
            send({ type: 'research_status', message: 'Section ' + (si + 1) + ': no results, trying rephrased queries...' });
            var retryResults = await fetchScholarlyResearch(rephrasedQueries, null);
            if (retryResults.length > 0) {
              sectionResearch[si] = retryResults;
              send({ type: 'research_status', message: 'Section ' + (si + 1) + ': found ' + retryResults.length + ' sources on retry' });
            } else {
              send({ type: 'research_status', message: 'Section ' + (si + 1) + ': no external sources found' });
            }
          }

          if (si < outline.length - 1) await sleep(1000);
        }

        var totalSources = 0;
        for (var srk in sectionResearch) totalSources += sectionResearch[srk].length;
        send({ type: 'status', pass: 'research', message: 'Research complete: ' + totalSources + ' unique sources fetched across ' + Object.keys(sectionResearch).length + ' sections.' });

      } catch (researchErr) {
        console.error('Research phase error:', researchErr.message);
        send({ type: 'research_status', message: 'Research phase encountered errors, continuing with available material...' });
      }
    }

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

      var researchForSection = sectionResearch[i];
      if (researchForSection && researchForSection.length > 0) {
        var researchText = formatResearchForPrompt(researchForSection, 30000);
        sectionPrompt += '=== FETCHED SCHOLARLY SOURCES (use these as the basis for expansion) ===\n';
        sectionPrompt += researchText + '\n';
        sectionPrompt += '=== END SCHOLARLY SOURCES ===\n\n';
        sectionPrompt += 'CRITICAL: Ground your writing in the scholarly sources above. Cite each source inline (author, year). ';
        sectionPrompt += 'Do NOT fabricate citations. Every substantive claim should reference one of the sources above. ';
        sectionPrompt += 'If a source is relevant, discuss its findings in detail — quote key phrases, explain methodology, compare results.\n\n';
      }

      if (sourceContent) {
        var sectionKeywords = (section.title + ' ' + section.description + ' ' + (section.key_points || []).join(' ')).toLowerCase().split(/\s+/);
        var sourceParagraphs = sourceContent.split(/\n\n+/);
        var scored = sourceParagraphs.map(function(para, idx) {
          var paraLower = para.toLowerCase();
          var hits = 0;
          for (var kw = 0; kw < sectionKeywords.length; kw++) {
            if (sectionKeywords[kw].length > 3 && paraLower.indexOf(sectionKeywords[kw]) !== -1) hits++;
          }
          return { text: para, score: hits, idx: idx };
        });
        scored.sort(function(a, b) { return b.score - a.score || a.idx - b.idx; });
        var relevantSource = '';
        var srcCharBudget = 50000;
        for (var rs = 0; rs < scored.length && relevantSource.length < srcCharBudget; rs++) {
          if (scored[rs].text.trim()) relevantSource += scored[rs].text + '\n\n';
        }
        sectionPrompt += 'Source material (draw from this heavily, quote and cite extensively):\n' + relevantSource + '\n\n';
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
      sectionPrompt += 'ABSOLUTELY NO MARKDOWN. Do NOT use #, ##, ###, **, *, ---, ``` or any markdown syntax.\n';
      sectionPrompt += 'Write in plain text only. For emphasis, use the words themselves. No asterisks, no underscores, no hash symbols.\n';

      var sysPrompt = 'You are a prolific academic writer producing a ' + doctype.replace(/_/g, ' ') + '. ';
      sysPrompt += 'You write LONG, DETAILED sections. Your minimum output for any section is ' + sectionTargetWords + ' words. ';
      sysPrompt += 'You never summarize when you can elaborate. You never abbreviate when you can expand. ';
      sysPrompt += 'You use every available token to produce rich, substantive, scholarly content. ';
      sysPrompt += 'Output ONLY the section text — no JSON, no meta-commentary. ';
      sysPrompt += 'NEVER use markdown formatting — no #, ##, **, *, ---, ```. Write in clean plain text only.';

      send({ type: 'section_start', index: i, title: section.title });
      var sectionText = await streamClaudeWithContinuation(
        [{ role: 'user', content: sectionPrompt }],
        sysPrompt,
        send,
        16384,
        sectionTargetWords,
        6
      );

      var sectionWordCount = sectionText.split(/\s+/).length;

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

    var finalOutput = stripMarkdownFromOutput(allSections.join('\n\n'));

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

app.post('/api/coherence/revise', async function(req, res) {
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
    var previousOutput = req.body.previousOutput || '';
    var revisionInstructions = req.body.revisionInstructions || '';
    var title = req.body.title || '';
    var doctype = req.body.doctype || 'paper';

    send({ type: 'status', message: 'Revising document...' });

    var treeContext = '';
    var projectResult = await pool.query('SELECT tractatus_tree FROM projects WHERE id = $1', [projectId]);
    var tree = projectResult.rows[0] ? projectResult.rows[0].tractatus_tree || {} : {};
    if (Object.keys(tree).length > 0) {
      treeContext = 'Project knowledge (Tractatus tree):\n' + JSON.stringify(tree).substring(0, 5000) + '\n\n';
    }

    var revPrompt = 'Here is a previously generated ' + doctype.replace(/_/g, ' ');
    if (title) revPrompt += ' titled "' + title + '"';
    revPrompt += ':\n\n=== CURRENT DOCUMENT ===\n' + previousOutput + '\n=== END CURRENT DOCUMENT ===\n\n';
    revPrompt += '=== REVISION INSTRUCTIONS ===\n' + revisionInstructions + '\n=== END REVISION INSTRUCTIONS ===\n\n';
    if (treeContext) revPrompt += treeContext;
    revPrompt += 'CRITICAL RULES:\n';
    revPrompt += '1. Apply ONLY the changes described in the revision instructions.\n';
    revPrompt += '2. Keep everything else EXACTLY the same — same structure, same wording, same tone, same length.\n';
    revPrompt += '3. Do NOT rewrite sections that the user did not ask to change.\n';
    revPrompt += '4. Do NOT add meta-commentary. Output ONLY the revised document.\n';
    revPrompt += '5. Preserve the overall length unless the revision instructions specifically ask to change it.';

    var revResult = await streamClaudeToSSE(
      [{ role: 'user', content: revPrompt }],
      'You are revising a ' + doctype.replace(/_/g, ' ') + '. Apply only the requested changes and leave everything else intact. Output ONLY the revised document — no commentary, no explanations.',
      send,
      16384
    );

    var revWords = revResult.split(/\s+/).length;

    var jobResult = await pool.query(
      "INSERT INTO document_jobs (session_id, original_text, status, final_output, global_skeleton) VALUES ($1, $2, 'complete', $3, $4) RETURNING *",
      [sessionId, 'Revision: ' + revisionInstructions.substring(0, 200), revResult, 'Revised version']
    );

    send({ type: 'complete', totalWords: revWords, jobId: jobResult.rows[0].id });
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    console.error('Revision error:', err);
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
    var safeFilename = filename.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '');
    res.setHeader('Content-Disposition', 'attachment; filename="' + safeFilename + '"');
    res.send(doc.raw_content || '');
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/documents/global/:id/content', async function(req, res) {
  try {
    var result = await pool.query('SELECT name, raw_content FROM global_documents WHERE id = $1', [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Document not found' });
    res.json({ name: result.rows[0].name, raw_content: result.rows[0].raw_content || '' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/documents/global/:id', async function(req, res) {
  try {
    var result = await pool.query('DELETE FROM global_documents WHERE id = $1 RETURNING id', [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Document not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/projects/documents/:id/content', async function(req, res) {
  try {
    var result = await pool.query('SELECT name, raw_content FROM project_documents WHERE id = $1', [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Document not found' });
    res.json({ name: result.rows[0].name, raw_content: result.rows[0].raw_content || '' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/projects/documents/:id/download', async function(req, res) {
  try {
    var result = await pool.query('SELECT name, raw_content FROM project_documents WHERE id = $1', [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Document not found' });
    var doc = result.rows[0];
    var filename = doc.name.replace(/\.[^.]+$/, '') + '.txt';
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    var safeFilename = filename.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '');
    res.setHeader('Content-Disposition', 'attachment; filename="' + safeFilename + '"');
    res.send(doc.raw_content || '');
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/projects/documents/:id', async function(req, res) {
  try {
    var result = await pool.query('DELETE FROM project_documents WHERE id = $1 RETURNING id', [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Document not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/projects/documents/:id/move', async function(req, res) {
  try {
    var targetProjectId = req.body.targetProjectId;
    if (!targetProjectId) return res.status(400).json({ error: 'targetProjectId required' });
    var result = await pool.query('UPDATE project_documents SET project_id = $1 WHERE id = $2 RETURNING id, name', [targetProjectId, req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Document not found' });
    res.json({ success: true, name: result.rows[0].name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/projects/documents/:id/copy-to-global', async function(req, res) {
  try {
    var result = await pool.query('SELECT name, raw_content FROM project_documents WHERE id = $1', [req.params.id]);
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

app.post('/api/documents/save-artifact', async function(req, res) {
  try {
    var text = req.body.text || '';
    var name = req.body.name || 'Document';
    var result = await pool.query(
      'INSERT INTO global_documents (name, raw_content) VALUES ($1, $2) RETURNING id, name, created_at',
      [name, text]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/artifact/docx', async function(req, res) {
  try {
    var text = req.body.text || '';
    var title = req.body.title || 'Document';
    var docxModule = await import('docx');
    var Document = docxModule.Document;
    var Packer = docxModule.Packer;
    var Paragraph = docxModule.Paragraph;
    var TextRun = docxModule.TextRun;
    var HeadingLevel = docxModule.HeadingLevel;

    var children = [];
    var lines = text.split('\n');
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (/^# (.+)/.test(line)) {
        children.push(new Paragraph({ text: line.replace(/^# /, ''), heading: HeadingLevel.HEADING_1 }));
      } else if (/^## (.+)/.test(line)) {
        children.push(new Paragraph({ text: line.replace(/^## /, ''), heading: HeadingLevel.HEADING_2 }));
      } else if (/^### (.+)/.test(line)) {
        children.push(new Paragraph({ text: line.replace(/^### /, ''), heading: HeadingLevel.HEADING_3 }));
      } else if (line.trim() === '') {
        children.push(new Paragraph({ text: '' }));
      } else {
        var runs = [];
        var parts = line.split(/(\*\*[^*]+\*\*)/);
        for (var p = 0; p < parts.length; p++) {
          if (/^\*\*(.+)\*\*$/.test(parts[p])) {
            runs.push(new TextRun({ text: parts[p].replace(/\*\*/g, ''), bold: true }));
          } else if (parts[p]) {
            runs.push(new TextRun({ text: parts[p] }));
          }
        }
        children.push(new Paragraph({ children: runs }));
      }
    }

    var doc = new Document({ sections: [{ children: children }] });
    var buffer = await Packer.toBuffer(doc);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    var safeTitle = title.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '');
    res.setHeader('Content-Disposition', 'attachment; filename="' + safeTitle + '.docx"');
    res.send(buffer);
  } catch (err) {
    console.error('DOCX error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/artifact/pdf', async function(req, res) {
  try {
    var text = req.body.text || '';
    var title = req.body.title || 'Document';
    var PDFDocument = (await import('pdfkit')).default;
    var doc = new PDFDocument({ margin: 72, size: 'LETTER' });
    var buffers = [];
    doc.on('data', function(chunk) { buffers.push(chunk); });
    doc.on('end', function() {
      try {
        var pdfBuf = Buffer.concat(buffers);
        res.setHeader('Content-Type', 'application/pdf');
        var safePdfTitle = title.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '');
        res.setHeader('Content-Disposition', 'attachment; filename="' + safePdfTitle + '.pdf"');
        res.send(pdfBuf);
      } catch (err) {
        console.error('PDF send error:', err);
        if (!res.headersSent) res.status(500).json({ error: err.message });
      }
    });

    var lines = text.split('\n');
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (/^# (.+)/.test(line)) {
        doc.fontSize(18).font('Helvetica-Bold').text(line.replace(/^# /, ''), { align: 'center' });
        doc.moveDown(0.5);
      } else if (/^## (.+)/.test(line)) {
        doc.fontSize(14).font('Helvetica-Bold').text(line.replace(/^## /, '').toUpperCase());
        doc.moveDown(0.3);
      } else if (/^### (.+)/.test(line)) {
        doc.fontSize(12).font('Helvetica-Bold').text(line.replace(/^### /, ''));
        doc.moveDown(0.2);
      } else if (/^---+$/.test(line.trim())) {
        doc.moveDown(0.3);
        doc.moveTo(72, doc.y).lineTo(540, doc.y).stroke();
        doc.moveDown(0.3);
      } else if (line.trim() === '') {
        doc.moveDown(0.4);
      } else {
        var cleaned = line.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1');
        doc.fontSize(11).font('Times-Roman').text(cleaned, { align: 'justify', width: 468 });
      }
    }

    doc.end();
  } catch (err) {
    console.error('PDF error:', err);
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

    console.log('Upload: file=' + file.originalname + ' ext=' + ext + ' size=' + file.buffer.length);

    if (ext === '.txt') {
      rawContent = file.buffer.toString('utf-8');
    } else if (ext === '.pdf') {
      try {
        var pdfMod = await import('pdf-parse');
        var uint8 = new Uint8Array(file.buffer);
        var parser = new pdfMod.PDFParse(uint8, { verbosity: 0 });
        await parser.load();
        var pdfData = await parser.getText();
        rawContent = pdfData.text || '';
        if (!rawContent.trim()) {
          rawContent = '[PDF contained no extractable text. It may be a scanned document — try uploading as an image for OCR.]';
        }
      } catch (pdfErr) {
        console.error('PDF parse error:', pdfErr.message);
        rawContent = '[Failed to extract text from PDF: ' + pdfErr.message + ']';
      }
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
      console.log('Upload success: project doc, content length=' + rawContent.length);
      res.json({ id: result.rows[0].id, name: result.rows[0].name, created_at: result.rows[0].created_at, raw_content: rawContent, scope: 'project' });
    } else {
      var gResult = await pool.query(
        'INSERT INTO global_documents (name, raw_content) VALUES ($1, $2) RETURNING id, name, created_at',
        [file.originalname, rawContent]
      );
      console.log('Upload success: global doc, content length=' + rawContent.length);
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
