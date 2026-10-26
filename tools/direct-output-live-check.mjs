import assert from 'node:assert/strict';
import {pool} from '../server/db.js';
const base='https://'+process.env.REPLIT_DEV_DOMAIN;
let project;
try{
  const auth=await(await fetch(base+'/api/auth/me')).json();
  project=(await pool.query("INSERT INTO projects(name,user_id,created_at) VALUES('Isolated direct-output check',$1,'2000-01-01') RETURNING id",[auth.user.id])).rows[0].id;
  const session=(await pool.query("INSERT INTO sessions(project_id,title,transcript) VALUES($1,'Direct output fixture','[]') RETURNING id",[project])).rows[0].id;
  const response=await fetch(base+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({projectId:project,sessionId:session,model:'claude',message:'In what year was Albert Einstein born? Give the year and a brief answer.',responseLength:'normal',responseFormat:'prose',stance:'neutral'}),
    signal:AbortSignal.timeout(90000)});
  assert.equal(response.status,200);
  const wire=await response.text();
  let text='',finished;
  for(const line of wire.split('\n')){
    if(!line.startsWith('data: '))continue;
    const raw=line.slice(6).trim();if(raw==='[DONE]')continue;
    const event=JSON.parse(raw);
    assert.notEqual(event.type,'replace_text','No second generation may rewrite the provider response');
    if(event.type==='error')throw Error(event.error);
    if(event.type==='text')text+=event.text;
    if(event.type==='answer_complete')finished=event;
  }
  assert.match(text,/1879/,'The app must allow general knowledge that is absent from project documents');
  assert.ok(finished);assert.equal(finished.text,text);assert.equal(finished.model,'claude');
  const saved=(await pool.query('SELECT transcript FROM sessions WHERE id=$1',[session])).rows[0].transcript.at(-1);
  assert.equal(saved.content,text);assert.equal(saved.model,'claude');
  console.log('PASS: A real Claude answer uses general knowledge without a project-only restriction');
  console.log('PASS: The streamed response, final displayed snapshot and saved answer are identical, with no replacement or appended ending');
}finally{
  if(project)await pool.query('DELETE FROM projects WHERE id=$1',[project]);
  await pool.end();
}
