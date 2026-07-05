// Storage layer used by server/auth.js (the canonical authentication implementation).
// Maps the auth code's storage interface onto this app's existing pg tables
// (users, login_events) without any ORM.
import { pool } from './db.js';

function mapUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    googleId: row.google_id || null,
    email: row.email || null,
    displayName: row.display_name || null
  };
}

export const storage = {
  async getUserById(id) {
    const r = await pool.query(
      'SELECT id, username, google_id, email, display_name FROM users WHERE id = $1',
      [id]
    );
    return mapUser(r.rows[0]);
  },

  async getUserByGoogleId(googleId) {
    const r = await pool.query(
      'SELECT id, username, google_id, email, display_name FROM users WHERE google_id = $1',
      [googleId]
    );
    return mapUser(r.rows[0]);
  },

  async getUserByEmail(email) {
    if (!email) return null;
    const r = await pool.query(
      'SELECT id, username, google_id, email, display_name FROM users WHERE LOWER(email) = LOWER($1)',
      [email]
    );
    return mapUser(r.rows[0]);
  },

  async createUserWithGoogle({ username, googleId, email, displayName }) {
    let base = String(username || 'user').slice(0, 60);
    let candidate = base;
    let n = 1;
    while (true) {
      const ex = await pool.query('SELECT id FROM users WHERE LOWER(username) = LOWER($1)', [candidate]);
      if (ex.rows.length === 0) break;
      n++;
      candidate = base.slice(0, 55) + '_' + n;
    }
    const r = await pool.query(
      `INSERT INTO users (username, password_hash, google_id, email, display_name)
       VALUES ($1, NULL, $2, $3, $4)
       RETURNING id, username, google_id, email, display_name`,
      [candidate, googleId, email, displayName]
    );
    return mapUser(r.rows[0]);
  },

  async updateUserGoogle(id, fields) {
    const sets = [];
    const vals = [];
    let i = 1;
    if (Object.prototype.hasOwnProperty.call(fields, 'googleId')) {
      sets.push('google_id = $' + i++);
      vals.push(fields.googleId);
    }
    if (Object.prototype.hasOwnProperty.call(fields, 'displayName')) {
      sets.push('display_name = $' + i++);
      vals.push(fields.displayName);
    }
    if (sets.length === 0) return this.getUserById(id);
    vals.push(id);
    const r = await pool.query(
      'UPDATE users SET ' + sets.join(', ') + ' WHERE id = $' + i +
      ' RETURNING id, username, google_id, email, display_name',
      vals
    );
    return mapUser(r.rows[0]);
  },

  async recordVisit(userId, email) {
    await pool.query(
      'INSERT INTO login_events (user_id, email) VALUES ($1, $2)',
      [userId, email]
    );
  },

  async getVisits(limit) {
    const r = await pool.query(
      'SELECT id, email, created_at AS "visitedAt" FROM login_events ORDER BY created_at DESC LIMIT $1',
      [limit || 500]
    );
    return r.rows;
  },

  async getVisitTimestampsSince(since) {
    const r = since
      ? await pool.query('SELECT created_at FROM login_events WHERE created_at >= $1', [since])
      : await pool.query('SELECT created_at FROM login_events');
    return r.rows.map(function (row) { return row.created_at; });
  }
};
