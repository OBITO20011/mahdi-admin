// Persistent native psql session; exported snapshot remains alive until every dump finishes.
// No shell, password argument, SQL output or server error is printed.
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
export class SnapshotSession {
  constructor(command,args,env=process.env){
    this.child=spawn(command,args,{env,windowsHide:true,stdio:['pipe','pipe','pipe']});
    this.buffer='';this.lines=[];this.pending=null;this.closed=false;
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data',chunk=>{this.buffer+=chunk;let end;
      while((end=this.buffer.indexOf('\n'))>=0){const line=this.buffer.slice(0,end).replace(/\r$/u,'');this.buffer=this.buffer.slice(end+1);
        if(this.pending&&line===this.pending.marker){const pending=this.pending;this.pending=null;clearTimeout(pending.timer);pending.resolve(this.lines.join('\n'));this.lines=[];}
        else this.lines.push(line);
      }
    });
    this.child.stderr.on('data',()=>{}); // Database errors may contain customer data or secrets.
    const fail=()=>{this.closed=true;if(this.pending){clearTimeout(this.pending.timer);this.pending.reject(new Error('BACKUP_SQL_SESSION_FAILED'));this.pending=null;}};
    this.child.on('error',fail);this.child.on('close',fail);this.child.stdin.on('error',fail);
  }
  query(sql){
    if(this.pending||this.closed)throw new Error('BACKUP_SQL_SESSION_UNAVAILABLE');
    return new Promise((resolve,reject)=>{const marker='backup_'+randomUUID().replaceAll('-','');
      const timer=setTimeout(()=>{this.child.kill();reject(new Error('BACKUP_SQL_TIMEOUT'));},600_000);
      this.pending={marker,resolve,reject,timer};this.child.stdin.write(sql+'\n\\echo '+marker+'\n');
    });
  }
  async close(){try{if(!this.closed&&!this.pending)await this.query('ROLLBACK;');}finally{this.child.stdin.end();this.child.kill();}}
}
