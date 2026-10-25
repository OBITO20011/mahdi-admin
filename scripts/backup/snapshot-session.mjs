// Persistent native psql session; exported snapshot remains alive until every dump finishes.
// No shell, password argument, SQL output or server error is printed.
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {postgresDiagnostic,diagnosticError} from './postgres-diagnostic.mjs';
export class SnapshotSession {
  #stderr='';
  constructor(command,args,env=process.env,{tool='psql',stage='snapshot'}={}){
    this.child=spawn(command,args,{env,windowsHide:true,stdio:['pipe','pipe','pipe']});
    this.buffer='';this.lines=[];this.pending=null;this.closed=false;this.failure=null;
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data',chunk=>{this.buffer+=chunk;let end;
      while((end=this.buffer.indexOf('\n'))>=0){const line=this.buffer.slice(0,end).replace(/\r$/u,'');this.buffer=this.buffer.slice(end+1);
        if(this.pending&&line===this.pending.marker){const pending=this.pending;this.pending=null;clearTimeout(pending.timer);pending.resolve(this.lines.join('\n'));this.lines=[];}
        else this.lines.push(line);
      }
    });
    this.child.stderr.on('data',chunk=>{this.#stderr=(this.#stderr+chunk.toString('utf8')).slice(-16384);});
    const fail=(error,exitCode=null,signal=null)=>{
      this.closed=true;
      if(!this.failure)this.failure=diagnosticError('BACKUP_SQL_SESSION_FAILED',postgresDiagnostic(error,{tool,stage,stderr:this.#stderr,exitCode,signal}));
      this.#stderr='';this.buffer='';this.lines=[];
      if(this.pending){clearTimeout(this.pending.timer);this.pending.reject(this.failure);this.pending=null;}
    };
    this.child.on('error',error=>fail(error));
    // close runs after stderr is drained. EPIPE often arrives before TLS's stderr;
    // do not replace the actual connection cause with that secondary pipe error.
    this.child.on('close',(code,signal)=>fail({code:'CLIENT_EARLY_EXIT'},code,signal));
    this.child.stdin.on('error',()=>{});
  }
  query(sql){
    if(this.closed)throw this.failure??new Error('BACKUP_SQL_SESSION_UNAVAILABLE');
    if(this.pending)throw new Error('BACKUP_SQL_SESSION_UNAVAILABLE');
    return new Promise((resolve,reject)=>{const marker='backup_'+randomUUID().replaceAll('-','');
      const timer=setTimeout(()=>{this.failure=diagnosticError('BACKUP_SQL_TIMEOUT',postgresDiagnostic({code:'BACKUP_SQL_TIMEOUT'},{tool:'psql',stage:'snapshot'}));this.child.kill();reject(this.failure);},600_000);
      this.pending={marker,resolve,reject,timer};this.child.stdin.write(sql+'\n\\echo '+marker+'\n');
    });
  }
  async close(){try{if(!this.closed&&!this.pending)await this.query('ROLLBACK;');}finally{this.child.stdin.end();this.child.kill();}}
}
