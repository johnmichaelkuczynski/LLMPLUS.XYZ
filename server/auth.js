import { pool } from './db.js';

export const OWNER_EMAIL = 'johnmichaelkuczynski@gmail.com';

export async function getOwnerUser() {
  const result = await pool.query(
    `SELECT id, username, email, display_name
       FROM users
      WHERE LOWER(email) = LOWER($1)
      ORDER BY id`,
    [OWNER_EMAIL]
  );

  if (result.rows.length !== 1) {
    throw new Error(
      `Expected exactly one owner record for ${OWNER_EMAIL}; found ${result.rows.length}`
    );
  }

  const row = result.rows[0];
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    displayName: row.display_name || null
  };
}

export function setupOwnerAccess(app) {
  // Explicitly retire every former sign-in/session route instead of allowing
  // the SPA catch-all to make an old login URL appear to work.
  app.all([
    '/auth/google',
    '/auth/google/callback',
    '/api/auth/google',
    '/api/auth/google/callback',
    '/api/auth/dev-login',
    '/api/auth/logout',
    '/api/auth/user',
    '/api/auth/me',
    '/api/admin/visits'
  ], function(_req, res) {
    res.status(404).json({ error: 'Login has been removed' });
  });
}