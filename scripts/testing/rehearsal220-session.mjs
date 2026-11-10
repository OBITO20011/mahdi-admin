// Local-only psql transport, same dual stdout/stderr fences as reset214 CI.
// Fingerprints are PostgreSQL NOTICE output: never replace or discard them.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
export class Rehearsal220Session{
 constructor(args){
  this.pending=null;this.closed=false;this.buffers={stdout:'',stderr:''};
  this.child=spawn('docker',args,{windowsHide:true,stdio:['pipe','pipe','pipe']});
  for(const stream of ['stdout','stderr']){
   this.child[stream].setEncoding('utf8');
   this.child[stream].on('data',data=>{
    this.buffers[stream]+=data;let end;
    while((end=this.buffers[stream].indexOf('\n'))>=0){
     const line=this.buffers[stream].slice(0,end).replace(/\r$/u,'');this.buffers[stream]=this.buffers[stream].slice(end+1);
     const p=this.pending;if(!p)continue;
     if(line===p.marker)p.done[stream]=true;else p[stream].push(line);
     if(p.done.stdout&&p.done.stderr){this.pending=null;clearTimeout(p.timer);p.resolve({code:0,stdout:p.stdout.join('\n'),stderr:p.stderr.join('\n')});}
    }
   });
  }
  this.completion=new Promise(resolve=>{this.child.on('close',code=>{this.closed=true;const p=this.pending;this.pending=null;if(p){clearTimeout(p.timer);p.resolve({code:code||1,stdout:p.stdout.join('\n'),stderr:p.stderr.join('\n')});}resolve();});});
  this.child.on('error',()=>{this.closed=true;const p=this.pending;this.pending=null;if(p){clearTimeout(p.timer);p.resolve({code:1,stdout:'',stderr:'REHEARSAL_SQL_TRANSPORT_FAILED'});}});
  this.child.stdin.on('error',()=>{});
 }
 query(input){
  assert.equal(this.closed,false,'REHEARSAL_SQL_SESSION_CLOSED');assert.equal(this.pending,null,'ONE_REHEARSAL_SQL_WRITER');
  return new Promise(resolve=>{
   const marker='rehearsal220_'+randomUUID().replaceAll('-','');
   const p={marker,resolve,stdout:[],stderr:[],done:{stdout:false,stderr:false},timer:null};
   p.timer=setTimeout(()=>this.child.kill(),600000);this.pending=p;
   this.child.stdin.write(input+'\n\\echo '+marker+'\n\\warn '+marker+'\n');
  });
 }
 async close(){if(!this.closed){this.child.stdin.end();await this.completion;}}
}
