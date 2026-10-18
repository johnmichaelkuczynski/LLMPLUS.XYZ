import { randomUUID } from 'node:crypto';

// The lease is stored with the existing session metadata. Unlike a PostgreSQL
// session advisory lock it survives connection pooling, and expires after a
// crashed worker. No database connection is reserved while a model is thinking.
const expiry = `CASE WHEN context_health#>>'{_generation,expiresAt}' ~ '^[0-9]+$'
  THEN (context_health#>>'{_generation,expiresAt}')::bigint ELSE 0 END`;
const clock = `(extract(epoch FROM clock_timestamp())*1000)::bigint`;

export async function acquireChatLease(pool,sessionId,lifetime,{leaseMs=30000,heartbeatMs=2000}={}) {
  const token=randomUUID();
  const acquired=await pool.query(`UPDATE sessions SET context_health=
    COALESCE(context_health,'{}'::jsonb) || jsonb_build_object('_generation',
      jsonb_build_object('token',$2::text,'expiresAt',${clock}+$3::bigint,'cancelRequested',false))
    WHERE id=$1 AND (${expiry})<${clock} RETURNING id`,[sessionId,token,leaseMs]);
  if(!acquired.rows.length) return null;
  let released=false,refreshing=false;
  const timer=setInterval(async()=>{
    if(released || refreshing) return;
    refreshing=true;
    try {
      const result=await pool.query(`UPDATE sessions SET context_health=jsonb_set(context_health,
        '{_generation,expiresAt}',to_jsonb(${clock}+$3::bigint))
        WHERE id=$1 AND context_health#>>'{_generation,token}'=$2
        RETURNING context_health#>>'{_generation,cancelRequested}' AS cancelled`,[sessionId,token,leaseMs]);
      if(!result.rows.length || result.rows[0].cancelled==='true') lifetime.stop();
    } catch {lifetime.stop();}
    finally {refreshing=false;}
  },heartbeatMs);
  timer.unref?.();
  return {
    token,
    async assertOwned() {
      lifetime.signal.throwIfAborted();
      const result=await pool.query(`SELECT id FROM sessions WHERE id=$1
        AND context_health#>>'{_generation,token}'=$2
        AND context_health#>>'{_generation,cancelRequested}'='false'`,[sessionId,token]);
      if(!result.rows.length) {lifetime.stop();lifetime.signal.throwIfAborted();}
    },
    async release() {
      if(released) return;
      released=true;clearInterval(timer);
      await pool.query(`UPDATE sessions SET context_health=context_health-'_generation'
        WHERE id=$1 AND context_health#>>'{_generation,token}'=$2`,[sessionId,token]);
    }
  };
}

export async function requestChatCancellation(pool,sessionId) {
  const result=await pool.query(`UPDATE sessions SET context_health=jsonb_set(context_health,
    '{_generation,cancelRequested}','true'::jsonb)
    WHERE id=$1 AND (${expiry})>${clock} RETURNING id`,[sessionId]);
  return result.rows.length>0;
}

export async function waitForChatRelease(pool,sessionId,timeoutMs=3500) {
  const deadline=Date.now()+timeoutMs;
  do {
    const result=await pool.query(`SELECT id FROM sessions
      WHERE id=$1 AND (${expiry})>${clock}`,[sessionId]);
    if(!result.rows.length)return true;
    await new Promise(resolve=>setTimeout(resolve,100));
  }while(Date.now()<deadline);
  return false;
}

export async function saveContextHealth(pool,health,sessionId,token=null) {
  // Health updates must never remove or overwrite the live generation fence.
  return pool.query(`UPDATE sessions SET context_health=$1::jsonb ||
    CASE WHEN context_health ? '_generation' THEN jsonb_build_object('_generation',context_health->'_generation')
    ELSE '{}'::jsonb END WHERE id=$2 AND ($3::text IS NULL OR context_health#>>'{_generation,token}'=$3)`,
    [JSON.stringify(health),sessionId,token]);
}
