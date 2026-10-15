import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readTables150,removed150} from '../scripts/testing/table-read-privileges150-contract.mjs';

test('150 exactly implements the named approved26grants and200revocations,no writes or parallel lane',async()=>{
 const sql=await readFile('supabase/migrations/150_explicit_application_table_read_privileges.sql','utf8');
 const code=sql.replace(/--[^\n]*/gu,'');
 const baseline=JSON.parse(await readFile('docs/operations/TABLE_ACCESS_DIAGNOSTIC.json','utf8'));
 const grants=[...code.matchAll(/GRANT SELECT ON TABLE public\.([a-z_]+) TO ([a-z_]+);/gu)].map(m=>[m[1],m[2]].join(':')).sort();
 assert.deepEqual(grants,baseline.proposal.filter((p:{action:string})=>p.action==='PROPOSE_GRANT').map((p:{table:string;role:string})=>p.table+':'+p.role).sort());
 assert.deepEqual(grants,[...readTables150.map(t=>t+':authenticated'),'orders:service_role'].sort());
 assert.equal(grants.length,26);
 const revoke=code.match(/REVOKE ([A-Z, ]+) ON TABLE([\s\S]+?)FROM anon, authenticated;/u);assert.ok(revoke);
 assert.deepEqual(revoke[1].split(/,\s*/u),removed150);
 assert.deepEqual([...revoke[2].matchAll(/public\.([a-z_]+)/gu)].map(m=>m[1]),readTables150);
 const excess=baseline.access.filter((a:{role:string})=>['anon','authenticated'].includes(a.role)).flatMap((a:{table:string;role:string;privileges:Record<string,boolean>})=>
  Object.entries(a.privileges).filter(([p,v])=>v&&removed150.includes(p)).map(([p])=>[a.table,a.role,p].join(':'))).sort();
 assert.deepEqual(excess,readTables150.flatMap(t=>['anon','authenticated'].flatMap(r=>removed150.map(p=>[t,r,p].join(':')))).sort());assert.equal(excess.length,200);
 assert.match(code,/ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public\s+REVOKE ALL PRIVILEGES ON TABLES FROM anon, authenticated;/u);
 assert.doesNotMatch(code,/\b(?:FUNCTION|SEQUENCE|EXECUTE|INSERT|UPDATE|DELETE|CASCADE|POLICY|CREATE)\b/iu);
 assert.doesNotMatch(code,/\bGRANT[^;]+TO anon\b/iu);
 assert.match(code,/^\s*BEGIN;[\s\S]+COMMIT;\s*$/u);
});
