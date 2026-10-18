import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool } from '../server/db.js';
import { acquireChatLease, requestChatCancellation, saveContextHealth } from '../server/chat-lease.js';

let user,project,session;const leases=[];
let passed=0;
const lifetime=()=>{const c=new AbortController();return {signal:c.signal,stop:()=>c.abort(new DOMException('Stopped','AbortError'))};};
async function check(name,run){await run();passed++;console.log('PASS '+name);}
async function acquire(life=lifetime(),options){const lease=await acquireChatLease(pool,session,life,options);if(lease)leases.push(lease);return lease;}
try {
  user=(await pool.query('INSERT INTO users(anonymous_id) VALUES($1) RETURNING id',[randomUUID()])).rows[0].id;
  project=(await pool.query("INSERT INTO projects(name,user_id) VALUES('Isolated lease fixture',$1) RETURNING id",[user])).rows[0].id;
  session=(await pool.query("INSERT INTO sessions(project_id,title,transcript) VALUES($1,'Lease fixture','[]') RETURNING id",[project])).rows[0].id;
  await check('Two independent workers cannot acquire the same chat concurrently',async()=>{
    const results=await Promise.all([acquire(),acquire()]);
    assert.equal(results.filter(Boolean).length,1);
    await results.find(Boolean).release();
  });
  await check('A completed or stopped request immediately releases its lease for the next request',async()=>{
    const first=await acquire();await first.release();
    const second=await acquire();assert.ok(second);await second.release();
  });
  await check('A crashed worker expires automatically; its later cleanup cannot release a new owner',async()=>{
    const first=await acquire(lifetime(),{leaseMs:100,heartbeatMs:60000});
    await new Promise(r=>setTimeout(r,150));
    const next=await acquire();assert.ok(next);
    await first.release();
    await next.assertOwned();
    await next.release();
  });
  await check('A cancellation from another worker aborts the owning request',async()=>{
    const life=lifetime();const lease=await acquire(life,{leaseMs:2000,heartbeatMs:25});
    assert.equal(await requestChatCancellation(pool,session),true);
    await new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(Error('Remote cancellation was not observed')),1500);
      life.signal.addEventListener('abort',()=>{clearTimeout(timeout);resolve();},{once:true});
      if(life.signal.aborted){clearTimeout(timeout);resolve();}
    });
    await assert.rejects(lease.assertOwned(),{name:'AbortError'});
    await lease.release();
  });
  await check('Updating memory diagnostics cannot erase the active chat lease',async()=>{
    const lease=await acquire();
    await saveContextHealth(pool,{status:'complete',historyMessagesIncluded:42},session);
    await lease.assertOwned();
    assert.equal(await acquire(),null);
    const row=(await pool.query('SELECT context_health FROM sessions WHERE id=$1',[session])).rows[0].context_health;
    assert.equal(row.historyMessagesIncluded,42);
    await lease.release();
  });
  await check('An old advisory lock does not block the new connection-independent lease',async()=>{
    const client=await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[session]);
      const lease=await acquire();assert.ok(lease);await lease.release();
      await client.query('COMMIT');
    } catch(error){await client.query('ROLLBACK');throw error;}
    finally{client.release();}
  });
  console.log(passed+' lease checks passed');
}finally{
  for(const lease of leases)await lease.release().catch(()=>{});
  if(project)await pool.query('DELETE FROM projects WHERE id=$1',[project]);
  if(user)await pool.query('DELETE FROM users WHERE id=$1',[user]);
  await pool.end();
}
