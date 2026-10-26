// Same real Docker psql,kept alive to avoid ~6000 Windows docker startups.
// Both stdout and stderr use independent fences;no notices are synthesized.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {sqlLiteral as q} from '../operations/trial-reset-core.mjs';
class LocalSession{
 constructor(executor){
  this.pending=null;this.closed=false;this.buffers={stdout:'',stderr:''};
  this.child=spawn(executor.command,executor.args,{windowsHide:true,stdio:['pipe','pipe','pipe']});
  for(const stream of ['stdout','stderr'])this.child[stream].setEncoding('utf8');
  for(const stream of ['stdout','stderr'])this.child[stream].on('data',data=>{
   this.buffers[stream]+=data.toString('utf8');let end;
   while((end=this.buffers[stream].indexOf('\n'))>=0){const line=this.buffers[stream].slice(0,end).replace(/\r$/u,'');this.buffers[stream]=this.buffers[stream].slice(end+1);const p=this.pending;
    if(!p)continue;if(line===p.marker){p.done[stream]=true;}else p[stream].push(line);
    if(p.done.stdout&&p.done.stderr){this.pending=null;clearTimeout(p.timer);p.resolve({code:0,stdout:p.stdout.join('\n'),stderr:p.stderr.join('\n')});}
   }
  });
  const close=code=>{this.closed=true;const p=this.pending;if(p){this.pending=null;clearTimeout(p.timer);p.resolve({code:code??1,stdout:p.stdout.join('\n'),stderr:p.stderr.join('\n')});}};
  this.child.on('close',close);this.child.on('error',()=>close(1));this.child.stdin.on('error',()=>{});
 }
 query(input,token){
  assert.equal(this.pending,null,'ONE_LOCAL_SQL_WRITER');
  return new Promise(resolve=>{const marker='reset214_'+randomUUID().replaceAll('-','');
   const p={marker,resolve,stdout:[],stderr:[],done:{stdout:false,stderr:false},timer:null};
   p.timer=setTimeout(()=>{this.child.kill();},600000);this.pending=p;
   this.child.stdin.write(`ROLLBACK;RESET ROLE;RESET ALL;SET reset214.writer=${q(token)};\n${input}\n\\echo ${marker}\n\\warn ${marker}\n`);
  });
 }
 close(){this.child.stdin.end();this.child.kill();}
}
export function persistentLocalExecutor(base){
 assert.equal(base.command,'docker');assert.deepEqual(base.args.slice(0,2),['exec','-i']);
 assert.match(base.args[2],/^supabase_db_nawasrah-[a-z0-9-]+-test$/u);assert.equal(base.args[3],'psql');
 const sessions=new Map();
 return {...base,localOnly:true,localExecute:async(input,token)=>{let s=sessions.get(token);if(!s||s.closed){s=new LocalSession(base);sessions.set(token,s);}return s.query(input,token);},
  closeLocal:()=>{for(const s of sessions.values())s.close();sessions.clear();}};
}
