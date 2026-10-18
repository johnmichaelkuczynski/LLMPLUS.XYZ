import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const source=await fs.readFile(new URL('./run.mjs',import.meta.url),'utf8');
const start=source.indexOf('async function f1_loadHomeChat(');
const end=source.indexOf('async function f2_projectsList(',start);
assert.ok(start>0 && end>start);
const definition=source.slice(start,end);
for(const target of ['fixture','personal-project','personal-session']) {
  let sent=0;
  const apiFetch=async(_context,path,options)=>{
    if(options?.method==='POST'&&path==='/api/projects') return {status:200,body:{id:'fixture'}};
    if(path==='/api/projects/fixture/sessions') return {status:200,body:[{id:'fixture-session'}]};
    throw Error('Unexpected fixture request');
  };
  const fn=vm.compileFunction('return '+definition,
    ['state','apiFetch','RUN_TIMESTAMP','log','sendChatViaUI'])({},apiFetch,'synthetic',()=>{},async(_page,_context,pid,sid)=>{
    assert.equal(pid,'fixture');assert.equal(sid,'fixture-session');sent++;
  });
  const page={
    evaluate:async(_fn,arg)=>arg?undefined:{pid:target==='personal-project'?target:'fixture',sid:target==='personal-session'?target:'fixture-session'},
    reload:async()=>{},waitForSelector:async()=>{}
  };
  if(target==='fixture'){await fn(page,{});assert.equal(sent,1);}
  else {await assert.rejects(fn(page,{}),/refusing/);assert.equal(sent,0);}
}
const config=await fs.readFile(new URL('../../.replit',import.meta.url),'utf8');
const project=config.split('name = "Project"')[1].split('[[workflows.workflow]]')[0];
assert.ok(project.includes('args = "Start application"'));
assert.ok(!project.includes('R1 Beta Test'));
assert.ok(config.includes('name = "R1 Beta Test"'));
console.log('PASS: R1 home chat uses its isolated project and session, rejects personal targets, and no longer starts automatically with the application');
