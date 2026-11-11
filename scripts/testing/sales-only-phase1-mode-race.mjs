import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';

export async function verifyModeTransition(c,branch) {
 c.assertOwned();
 const child=spawn(c.executor.command,c.executor.args,{windowsHide:true,stdio:['pipe','pipe','pipe']});
 let stdout='',stderr='',readyResolve,readyReject;
 const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
 const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>{if(code===0)resolve();else reject(Error(stderr));readyReject(Error('MODE_LATCH_CLOSED'));});});
 void done.catch(()=>undefined);
 child.stdout.on('data',chunk=>{stdout+=chunk;if(stdout.includes('LITE1_MODE_LOCK_READY'))readyResolve();});child.stderr.on('data',chunk=>{stderr+=chunk;});
 try {
  child.stdin.write(c.auth(`SELECT public.open_cash_shift(${c.q(branch)},0);`).replace('COMMIT;',"SELECT 'LITE1_MODE_LOCK_READY';\n"));
  await ready;
  // Refuse NOWAIT instead of queuing an exclusive mode lock behind legacy
  // financial locks. The independent full transaction still holds FOR SHARE.
  await c.fail('lite1_set_mode(false)',/LITE1_MODE_BUSY/);
  child.stdin.end('COMMIT;\n');await done;
  await c.fail('lite1_set_mode(false)',/LITE1_MODE_REQUIRES_QUIESCENCE/);
  assert.equal(await c.json('SELECT to_jsonb(full_accounting) FROM sales_lite1.mode WHERE id;'),true);
  const shift=await c.json("SELECT to_jsonb(id) FROM public.cash_shifts WHERE status='open';");
  await c.rpc(`close_cash_shift(${c.q(shift)},0,NULL)`);
 } finally {
  if(child.exitCode===null){child.stdin.end('ROLLBACK;\n');await done.catch(()=>undefined);}
 }
}
