// Test database fixture only. No owner connection/tool accepts this executor.
import assert from 'node:assert/strict';
import {executeInput} from '../operations/build-empty-supabase.mjs';
import {publicFingerprint} from '../operations/reset214-write-guard.mjs';
import {pgNetIdentitySql} from './reset219-dependency-probe.mjs';
export async function frankfurtPgNetFixture(executor){
 assert.equal(executor.command,'docker');assert.deepEqual(executor.args.slice(0,2),['exec','-i']);
 assert.match(executor.args[2],/^supabase_db_nawasrah-[a-z0-9-]+-test$/u);
 const native={command:'docker',args:[...executor.args]};
 assert.equal(native.args[native.args.indexOf('-U')+1],'postgres');
 native.args[native.args.indexOf('-U')+1]='supabase_admin';
 const sql=async text=>{const r=await executeInput(native,text);assert.equal(r.code,0,'FRANKFURT_PG_NET_FIXTURE_FAILED');return r.stdout.trim();};
 const before=JSON.parse(await sql(pgNetIdentitySql));
 const fingerprint=await publicFingerprint(executor);
 const versions=JSON.parse(await sql("SELECT jsonb_agg(version) FROM pg_available_extension_versions WHERE name='pg_net';"));
 assert.ok(versions.includes('0.20.4'),'FRANKFURT_PG_NET_0204_NOT_AVAILABLE');
 if(before?.schema!=='public'||before?.version!=='0.20.4')
  await sql("BEGIN;DROP EXTENSION IF EXISTS pg_net;CREATE EXTENSION pg_net WITH SCHEMA public VERSION '0.20.4';COMMIT;");
 const after=JSON.parse(await sql(pgNetIdentitySql));
 assert.equal(after.schema,'public');assert.equal(after.version,'0.20.4');assert.equal(after.owner,'supabase_admin');
 assert.equal(after.netSchema,'net');assert.equal(after.httpFunctions.length,3);
 assert.deepEqual(await publicFingerprint(executor),fingerprint,'FIXTURE_MUST_NOT_CHANGE_APPLICATION_ROWS');
 return {before,after,exactFrankfurtVersion:true,applicationRowsUnchanged:true};
}
