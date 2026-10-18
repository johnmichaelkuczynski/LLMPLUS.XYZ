import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;
const settings = {
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
  statement_timeout: 20000,
  query_timeout: 25000,
  idle_in_transaction_session_timeout: 30000,
  keepAlive: true
};
const pool = new Pool(settings);
// A busy context-index transaction must not exhaust the connections used to
// validate a Google session, making a signed-in user appear to be logged out.
const authPool = new Pool({...settings,max:3});
for(const db of [pool,authPool]) db.on('error',error=>{
  console.error('[Database] Idle connection error:',error.code || error.name);
});

export { pool, authPool };
