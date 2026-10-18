import assert from 'node:assert/strict';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { pool, authPool } from '../server/db.js';
import { setupGoogleAuth } from '../server/auth.js';

let user,server,store;const sessionIds=new Set();
try {
  user=(await pool.query('INSERT INTO users(anonymous_id) VALUES($1) RETURNING id',[randomUUID()])).rows[0].id;
  const app=express();app.set('trust proxy',1);
  setupGoogleAuth(app);
  // This route exists only on this test's loopback fixture, never on the app.
  app.post('/fixture-sign-in',(req,res,next)=>req.login({id:user},error=>{
    if(error)return next(error);
    store=req.sessionStore;sessionIds.add(req.sessionID);
    req.session.save(error=>error?next(error):res.json({ok:true}));
  }));
  server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const base='http://127.0.0.1:'+server.address().port;
  const headers={'x-forwarded-proto':'https','x-forwarded-host':'llmplus.ink'};
  const signed=await fetch(base+'/fixture-sign-in',{method:'POST',headers});
  assert.equal(signed.status,200);
  const cookieHeader=signed.headers.get('set-cookie');
  assert.ok(cookieHeader.includes('HttpOnly'));
  assert.ok(cookieHeader.includes('Secure'));
  let cookie=cookieHeader.split(';')[0];
  for(let n=0;n<4;n++) {
    await new Promise(resolve=>setTimeout(resolve,1000));
    const response=await fetch(base+'/api/auth/me',{headers:{...headers,Cookie:cookie}});
    const result=await response.json();
    assert.equal(result.developmentPreview,undefined,'This check must not use the development owner bypass');
    assert.equal(result.authenticated,true);
    assert.equal(result.user.id,user);
    const renewal=response.headers.get('set-cookie');
    assert.ok(renewal,'An active signed-in session should renew its cookie');
    cookie=renewal.split(';')[0];
  }
  console.log('PASS: Production authentication middleware retains a real signed session beyond two seconds and renews its secure HttpOnly cookie');
  // Exhaust the chat pool without denying the separate session-store pool.
  const occupied=await Promise.all(Array.from({length:pool.options.max},()=>pool.connect()));
  try {
    const response=await fetch(base+'/api/auth/me',{headers:{...headers,Cookie:cookie},signal:AbortSignal.timeout(3000)});
    assert.equal((await response.json()).authenticated,true);
    console.log('PASS: A fully occupied chat database pool does not log out the signed-in user');
  }finally{occupied.forEach(client=>client.release());}
  const logout=await fetch(base+'/api/auth/logout',{method:'POST',headers:{...headers,Cookie:cookie}});
  assert.equal(logout.status,204);
  assert.equal((await(await fetch(base+'/api/auth/me',{headers:{...headers,Cookie:cookie}})).json()).authenticated,false);
  console.log('PASS: Deliberate Sign out still ends only the fixture session');
}finally{
  if(server)await new Promise(resolve=>server.close(resolve));
  store?.close();
  for(const sid of sessionIds)await authPool.query('DELETE FROM google_sessions_v2 WHERE sid=$1',[sid]);
  if(user)await pool.query('DELETE FROM users WHERE id=$1',[user]);
  await Promise.all([pool.end(),authPool.end()]);
}
