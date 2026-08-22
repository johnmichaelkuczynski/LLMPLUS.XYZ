import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import { Passport } from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { pool } from './db.js';

const SESSION_COOKIE = 'llmplus.sid.v2';
const CALLBACK_PATH = '/auth/google/callback';
const PERSONAL_OWNER_EMAIL = 'johnmichaelkuczynski@gmail.com';

function cleanSecret(value) {
  return (value || '').replace(/[\u00A0\u200B\u200C\u200D\uFEFF]/g, '').trim();
}

function publicUser(row) {
  return {
    id: row.id,
    username: row.username || null,
    email: row.email || null,
    displayName: row.display_name || null
  };
}

async function getUserById(id) {
  const result = await pool.query(
    `SELECT id, username, email, display_name, google_id
       FROM users
      WHERE id = $1`,
    [id]
  );
  return result.rows.length === 1 ? result.rows[0] : null;
}

async function findExistingUserForGoogle(profile) {
  const emailEntry = Array.isArray(profile.emails)
    ? profile.emails.find((entry) => entry && entry.value)
    : null;
  const email = emailEntry ? emailEntry.value.trim().toLowerCase() : '';
  const emailVerified = profile._json?.email_verified === true || emailEntry?.verified === true;

  if (!email || !emailVerified) {
    throw new Error('Google did not provide a verified email address');
  }

  if (email !== PERSONAL_OWNER_EMAIL) {
    throw new Error('This Google account is not authorized for this personal workspace');
  }

  const matches = await pool.query(
    `SELECT id, username, email, display_name, google_id
       FROM users
      WHERE LOWER(email) = LOWER($1)
      ORDER BY id`,
    [PERSONAL_OWNER_EMAIL]
  );

  if (matches.rows.length !== 1) {
    throw new Error(`No unique existing user is authorized for ${email}`);
  }

  const user = matches.rows[0];
  if (user.google_id && user.google_id !== profile.id) {
    throw new Error('This user is already linked to a different Google account');
  }

  const conflictingGoogleId = await pool.query(
    'SELECT id FROM users WHERE google_id = $1 AND id <> $2',
    [profile.id, user.id]
  );
  if (conflictingGoogleId.rows.length > 0) {
    throw new Error('This Google account is already linked to another user');
  }

  if (!user.google_id) {
    await pool.query(
      'UPDATE users SET google_id = $1 WHERE id = $2 AND google_id IS NULL',
      [profile.id, user.id]
    );
    user.google_id = profile.id;
  }

  return user;
}

function callbackUrlForRequest(req) {
  const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
  const requestHost = (forwardedHost || req.get('host') || '').toLowerCase();
  const devHost = String(process.env.REPLIT_DEV_DOMAIN || '').trim().toLowerCase();
  const deploymentHosts = String(process.env.REPLIT_DOMAINS || '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  const trustedHosts = new Set(['llmplus.ink', 'www.llmplus.ink', devHost, ...deploymentHosts]);

  let host = requestHost;
  if ((host.startsWith('localhost:') || host.startsWith('127.0.0.1:')) && devHost) {
    host = devHost;
  }
  if (!trustedHosts.has(host) && !host.startsWith('localhost:') && !host.startsWith('127.0.0.1:')) {
    throw new Error('Untrusted OAuth request host');
  }

  const isLocal = host.startsWith('localhost:') || host.startsWith('127.0.0.1:');
  return `${isLocal ? 'http' : 'https'}://${host}${CALLBACK_PATH}`;
}

function isDevelopmentPreviewRequest(req) {
  const developmentHost = String(process.env.REPLIT_DEV_DOMAIN || '').trim().toLowerCase();
  const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim().toLowerCase();
  const requestHost = forwardedHost || String(req.get('host') || '').toLowerCase();
  const isLocalPreview = requestHost.startsWith('localhost:') || requestHost.startsWith('127.0.0.1:');
  return process.env.NODE_ENV === 'development' &&
    ((Boolean(developmentHost) && requestHost === developmentHost) || isLocalPreview);
}

async function getPersonalOwner() {
  const result = await pool.query(
    `SELECT id, username, email, display_name, google_id
       FROM users
      WHERE LOWER(email) = LOWER($1)
      ORDER BY id`,
    [PERSONAL_OWNER_EMAIL]
  );
  if (result.rows.length !== 1) {
    throw new Error('Personal workspace owner is unavailable');
  }
  return result.rows[0];
}

export function setupGoogleAuth(app) {
  const clientID = cleanSecret(process.env.GOOGLE_CLIENT_ID);
  const clientSecret = cleanSecret(process.env.GOOGLE_CLIENT_SECRET);
  const sessionSecret = cleanSecret(process.env.SESSION_SECRET);

  if (!clientID || !clientSecret) {
    throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required');
  }
  if (!sessionSecret) {
    throw new Error('SESSION_SECRET is required');
  }

  const PgSession = connectPgSimple(session);
  app.use(session({
    name: SESSION_COOKIE,
    store: new PgSession({
      pool,
      tableName: 'google_sessions_v2',
      createTableIfMissing: false,
      errorLog: (...args) => console.error('Google session store error:', ...args)
    }),
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production' || Boolean(process.env.REPLIT_DEV_DOMAIN),
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000
    }
  }));

  const passport = new Passport();
  app.use(passport.initialize());
  app.use(passport.session());

  passport.serializeUser((user, done) => done(null, user.id));
  passport.deserializeUser(async (id, done) => {
    try {
      const user = await getUserById(id);
      done(null, user || false);
    } catch (error) {
      done(error);
    }
  });

  passport.use(new GoogleStrategy(
    {
      clientID,
      clientSecret,
      callbackURL: `https://llmplus.ink${CALLBACK_PATH}`,
      state: true
    },
    async (_accessToken, _refreshToken, profile, done) => {
      try {
        done(null, await findExistingUserForGoogle(profile));
      } catch (error) {
        console.error('Google sign-in rejected:', error.message);
        done(null, false, { message: 'This Google account is not authorized' });
      }
    }
  ));

  const beginGoogleLogin = (req, res, next) => {
    let callbackURL;
    try {
      callbackURL = callbackUrlForRequest(req);
    } catch (error) {
      return res.status(400).json({ error: 'Invalid sign-in origin' });
    }
    return passport.authenticate('google', {
      scope: ['openid', 'email', 'profile'],
      prompt: 'select_account',
      callbackURL
    })(req, res, next);
  };

  app.get('/api/auth/google', beginGoogleLogin);

  app.get(CALLBACK_PATH, (req, res, next) => {
    let callbackURL;
    try {
      callbackURL = callbackUrlForRequest(req);
    } catch (error) {
      return res.redirect('/?authError=invalid_origin');
    }
    return passport.authenticate('google', {
      callbackURL,
      failureRedirect: '/?authError=unauthorized'
    })(req, res, next);
  }, (req, res) => {
    if (req.user) {
      pool.query(
        `INSERT INTO login_events (user_id, google_id, email, name)
         VALUES ($1, $2, $3, $4)`,
        [req.user.id, req.user.google_id, req.user.email, req.user.display_name]
      ).catch((error) => console.error('Login event write failed:', error.message));
    }
    req.session.save((error) => {
      if (error) {
        console.error('Google session save failed:', error.message);
        return res.redirect('/?authError=session');
      }
      res.redirect('/');
    });
  });

  app.get('/api/auth/me', async (req, res) => {
    if (isDevelopmentPreviewRequest(req)) {
      try {
        const owner = await getPersonalOwner();
        res.set('Cache-Control', 'no-store');
        return res.json({ authenticated: true, user: publicUser(owner), developmentPreview: true });
      } catch (error) {
        console.error('Development preview owner lookup failed:', error.message);
        return res.status(503).json({ authenticated: false, user: null });
      }
    }
    if (!req.isAuthenticated() || !req.user) {
      res.set('Cache-Control', 'no-store');
      return res.json({ authenticated: false, user: null });
    }
    res.set('Cache-Control', 'no-store');
    res.json({ authenticated: true, user: publicUser(req.user) });
  });

  app.post('/api/auth/logout', (req, res, next) => {
    const origin = String(req.headers.origin || '');
    const expectedOrigin = String(req.protocol || 'https') + '://' + String(req.get('host') || '');
    if (origin && origin !== expectedOrigin) {
      return res.status(403).json({ error: 'Cross-site request blocked' });
    }
    req.logout((logoutError) => {
      if (logoutError) return next(logoutError);
      req.session.destroy((sessionError) => {
        if (sessionError) return next(sessionError);
        res.clearCookie(SESSION_COOKIE, { path: '/' });
        res.status(204).end();
      });
    });
  });

  console.log('Fresh Google authentication configured');
}

export async function requireGoogleAuth(req, res, next) {
  if (isDevelopmentPreviewRequest(req)) {
    try {
      const owner = await getPersonalOwner();
      req.user = owner;
      req.userId = owner.id;
      return next();
    } catch (error) {
      console.error('Development preview owner lookup failed:', error.message);
      return res.status(503).json({ error: 'Personal workspace is unavailable' });
    }
  }
  if (
    !req.isAuthenticated?.() ||
    !req.user ||
    String(req.user.email || '').toLowerCase() !== PERSONAL_OWNER_EMAIL
  ) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  req.userId = req.user.id;
  next();
}