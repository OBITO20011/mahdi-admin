// Fixed fresh224 test stack only; no URL, archive or arbitrary target argument.
import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
import {SnapshotSession} from '../backup/snapshot-session.mjs';
import {startInventory224Local} from './inventory224-local.mjs';
import {proveRawDefaultAclRestore} from './restore-raw-default-acl-proof.mjs';
assert.equal(process.argv.length,2,'RAW_ACL_RUNTIME_NO_TARGET_ARGUMENTS');
await mkdir('test-results/restore-raw-default-acl',{recursive:true});
let local,session;const report={ok:false,hostedConnectionsMade:false};
try{
 local=await startInventory224Local(224,'reference');
 session=new SnapshotSession('docker',['exec','-i',local.container,'psql','-U','supabase_admin','-d','postgres','-X','-q','-A','-t','-w','-v','ON_ERROR_STOP=1']);
 await session.query('SELECT cron.alter_job(jobid,active:=false) FROM cron.job;');
 Object.assign(report,await proveRawDefaultAclRestore(session));
}catch(error){report.error=error.code??error.message.split('\n')[0];report.stage=error.proofStage??'bootstrap';report.message=error.message.split('\n')[0].slice(0,180);if(typeof error.actual==='number')report.actual=error.actual;if(typeof error.expected==='number')report.expected=error.expected;if(error.actual instanceof Error)report.rejectedError={message:error.actual.message.split('\n')[0].slice(0,160),diagnostic:error.actual.diagnostic};process.exitCode=1;}
finally{
 await session?.close();await local?.stop();
 await writeFile('test-results/restore-raw-default-acl/report.json',JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report));
}
