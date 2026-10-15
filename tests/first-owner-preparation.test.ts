import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {bindFirstOwnerSql,validateFirstOwner} from '../scripts/operations/first-owner-core.mjs';
import {firstOwnerArguments} from '../scripts/operations/frankfurt-first-owner.mjs';
const input={ownerId:'92600000-0000-4000-8000-000000000001',email:'owner@example.test',name:'المالك',branchCode:'BR-MAIN',branchName:'الفرع الرئيسي'};
test('first owner is a guarded data bootstrap,not an unauthenticated RPC or a second-owner bypass',()=>{
 const sql=bindFirstOwnerSql(input);for(const guard of ['FIRST_OWNER_AUTH_IDENTITY_NOT_CONFIRMED','FIRST_OWNER_ALREADY_INITIALIZED','FIRST_OWNER_REQUIRES_UNUSED_BUSINESS','FIRST_OWNER_BRANCH_MISMATCH'])assert.ok(sql.includes(guard));
 assert.match(sql,/pg_advisory_xact_lock/u);assert.match(sql,/ISOLATION LEVEL SERIALIZABLE/u);assert.match(sql,/email_confirmed_at IS NULL/u);
 assert.match(sql,/r.code='owner'/u);assert.match(sql,/FIRST_OWNER_BOOTSTRAP/u);
 assert.doesNotMatch(sql,/CREATE (?:OR REPLACE )?FUNCTION|GRANT |REVOKE |INSERT INTO auth\.|UPDATE auth\.|mfa_factors/iu);
 assert.throws(()=>validateFirstOwner({...input,ownerId:"';DROP SCHEMA auth;--"}));
 assert.throws(()=>validateFirstOwner({...input,branchCode:'x;DROP TABLE'}));
 assert.match(bindFirstOwnerSql({...input,name:"علي'سليم"}),/علي''سليم/u);
});
test('first owner dry-run cannot request a password or access the project',()=>{
 assert.equal(firstOwnerArguments([]).apply,false);assert.throws(()=>firstOwnerArguments(['--apply']));
 assert.throws(()=>firstOwnerArguments(['--apply','--dry-run']));assert.throws(()=>firstOwnerArguments(['--email','one','--email','two']));
 const source=readFileSync('scripts/operations/frankfurt-first-owner.mjs','utf8');assert.ok(source.indexOf('if(!options.apply)')<source.indexOf('await ownerPassword()'));
 assert.match(source,/connectionFromLink/u);assert.match(source,/reference.appliedVersions/u);assert.match(source,/FIRST_OWNER_SCHEMA_OR_PERMISSION_CHANGED/u);
});
