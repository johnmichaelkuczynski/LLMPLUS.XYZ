// Resolve against live originals, not the memory index: a saved reference must
// stop working as soon as its chat is moved or deleted.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const unavailable = 'Source unavailable in this project. It may have been moved, deleted, or changed.';

export function registerSourceInspector(app, db) {
  app.get('/api/projects/:projectId/source', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const { projectId } = req.params;
    const { sessionId, documentId, ordinal, offsetChars, quote } = req.query;
    const number = value => typeof value === 'string' && /^\d+$/.test(value) && Number.isSafeInteger(Number(value));
    if (!UUID.test(projectId) || Boolean(sessionId) === Boolean(documentId) ||
        (sessionId && (!UUID.test(sessionId) || !number(ordinal) || Number(ordinal) < 1 || Number(ordinal) > 2147483647)) ||
        (documentId && !UUID.test(documentId)) ||
        (offsetChars !== undefined && !number(offsetChars)) ||
        (quote !== undefined && (typeof quote !== 'string' || quote.length > 5000))) {
      return res.status(400).json({ error: 'Invalid source reference.' });
    }
    if (!req.userId) return res.status(401).json({ error: 'Sign in to inspect this source.' });
    try {
      let row, text, timestamp = null, attribution;
      if (sessionId) {
        row = (await db.query(`SELECT s.title, s.transcript->($4::int-1) AS message
          FROM sessions s JOIN projects p ON p.id=s.project_id
          WHERE s.id=$1 AND s.project_id=$2 AND p.user_id=$3`,
        [sessionId, projectId, req.userId, Number(ordinal)])).rows[0];
        if (!row || !row.message || !['user','assistant'].includes(row.message.role) ||
            typeof row.message.content !== 'string') return res.status(404).json({ error: unavailable });
        text = row.message.content;
        // Never display the synthetic memory-index time as a historical date.
        if (typeof row.message.timestamp === 'string' &&
            /^\d{4}-\d{2}-\d{2}T/.test(row.message.timestamp) &&
            Number.isFinite(Date.parse(row.message.timestamp))) timestamp = row.message.timestamp;
        attribution = row.message.role === 'assistant' ? 'Assistant assertion — not independent verification' :
          /^\s*\[Attached document:/i.test(text) ? 'Attached document text — not independent verification' :
          'User report — not independent verification';
      } else {
        row = (await db.query(`SELECT d.name AS title,d.raw_content AS content
          FROM project_documents d JOIN projects p ON p.id=d.project_id
          WHERE d.id=$1 AND d.project_id=$2 AND p.user_id=$3`,
        [documentId, projectId, req.userId])).rows[0];
        if (!row || typeof row.content !== 'string' || !row.content.length) {
          return res.status(404).json({ error: unavailable });
        }
        text = row.content;
        attribution = 'Document text — not independent verification';
      }
      let focus = Number(offsetChars || 0);
      // Indexed offsets are PostgreSQL character positions, not UTF-16 offsets.
      const chars = Array.from(text);
      if (focus >= chars.length && focus !== 0) return res.status(404).json({ error: unavailable });
      if (quote) {
        const found = text.indexOf(quote);
        if (found < 0) return res.status(404).json({ error: unavailable });
        focus = Array.from(text.slice(0, found)).length;
      }
      const start = Math.max(0, focus - 1200);
      const end = Math.min(chars.length, Math.max(focus + 5600, start + 8000));
      res.json({
        title: row.title || (sessionId ? 'Untitled chat' : 'Untitled document'),
        attribution, role: row.message?.role || 'document', timestamp,
        timestampLabel: timestamp ? 'Recorded message timestamp' : 'Historical timestamp not recorded',
        passage: chars.slice(start, end).join(''), excerpt: start > 0 || end < chars.length,
        startChars: start, endChars: end, totalChars: chars.length,
        location: sessionId ? 'Message ' + ordinal : 'Extracted document text; original page numbers are not preserved'
      });
    } catch (err) {
      console.error('[Source inspector]', err.message);
      res.status(500).json({ error: 'Could not load this source. Try again.' });
    }
  });
}
