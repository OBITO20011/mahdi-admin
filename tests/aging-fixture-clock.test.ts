import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {fixtureCommand} from '../scripts/testing/aging-fixture-transaction.mjs';
import {midnightProjection} from '../scripts/testing/aging-midnight-proof.mjs';

test('aging transport preserves read-only and rollback guards without ending the fixture clock',()=>{
 const read=fixtureCommand('BEGIN READ ONLY; SELECT CURRENT_TIMESTAMP;ROLLBACK;',1);
 assert.match(read.sql,/SAVEPOINT aging_request_1/u);
 assert.match(read.sql,/SET LOCAL transaction_read_only=on/u);
 assert.match(read.sql,/SELECT CURRENT_TIMESTAMP/u);
 assert.match(read.sql,/ROLLBACK TO SAVEPOINT aging_request_1/u);
 assert.doesNotMatch(read.sql,/\b(?:COMMIT|BEGIN)\s*;/u);
 const write=fixtureCommand("BEGIN;DO $$BEGIN RAISE NOTICE 'begin';END$$; SELECT 1;COMMIT;",2);
 assert.match(write.sql,/DO \$\$BEGIN RAISE NOTICE/u);
 assert.doesNotMatch(write.sql,/transaction_read_only=on/u);
 assert.match(write.sql,/\\if :ERROR\s+ROLLBACK TO SAVEPOINT aging_request_2/u);
 assert.throws(()=>fixtureCommand('BEGIN; SELECT 1;',3),/explicit end/u);
});

test('midnight proof only binds a clock in read-only CTE projections and keeps real reader boundaries',()=>{
 for(const [number,file,directory] of [[136,'136_package_f_customer_debt_aging',false],[137,'137_package_f_crm_financial_filters',true]] as const){
  const source=readFileSync(`supabase/migrations/${file}.sql`,'utf8');
  const query=midnightProjection(source,{customer:'92600000-0000-4000-8000-000000000980',directory});
  assert.match(query,/proof_as_of AT TIME ZONE 'Asia\/Amman'/u,`${number}`);
  assert.match(query,/FROM allocated/u);
  assert.doesNotMatch(query,/CREATE (?:OR REPLACE )?FUNCTION|EXECUTE|UPDATE|DELETE/u);
 }
 const source=readFileSync('scripts/testing/aging-midnight-proof.mjs','utf8');
 assert.match(source,/realRpcBoundaries:\[30,31\]/u);
 assert.match(source,/public\.get_customer_debt_aging/u);
 assert.match(source,/public\.get_crm_customer_page/u);
 assert.match(source,/SET LOCAL transaction_read_only=on/u);
 assert.doesNotMatch(source,/setTimeout|pg_sleep|retry/u);
});

test('136 and137 age fixtures and all oracles use one real database transaction',()=>{
 for(const name of ['debt-aging','crm-filters']){
  const source=readFileSync(`scripts/testing/run-package-f-${name}-runtime.mjs`,'utf8');
  assert.match(source,/fixtureTransaction\?fixtureTransaction\.sql/u);
  assert.match(source,/fixtureTransaction=await openAgingFixtureTransaction/u);
  assert.match(source,/await fixtureTransaction\.close\(\)/u);
 }
 const helper=readFileSync('scripts/testing/aging-fixture-transaction.mjs','utf8');
 assert.match(helper,/Every aging fixture\/oracle shares one PostgreSQL clock and backend/u);
 assert.doesNotMatch(helper,/retry|setTimeout|statement_timeout='(?:0|\d+m)'/u);
});
