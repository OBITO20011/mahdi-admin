import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {read139Input} from '../scripts/operations/frankfurt-migration139.mjs';
import {buildEmptyProjectInput} from '../scripts/operations/build-empty-supabase.mjs';

test('139 is a pinned explicit one-function body;Vault URL has no default or activation',async()=>{
 const unit=await read139Input(process.cwd()),sql=unit.input.toString('utf8');
 assert.equal((sql.match(/CREATE OR REPLACE FUNCTION/gu)??[]).length,1);
 assert.match(sql,/SET search_path = public, vault, net, pg_temp/u);
 assert.match(sql,/WHERE name = 'order_push_webhook_url'/u);assert.match(sql,/url := v_url/u);
 assert.match(sql,/NULLIF\(TRIM\(v_url\), ''\) IS NULL/u);
 assert.match(sql,/ALTER FUNCTION public.enqueue_order_push_webhook\(JSONB\) OWNER TO postgres/u);
 assert.match(sql,/FROM PUBLIC, anon, authenticated/u);
 assert.doesNotMatch(sql,/https?:|acjtabdqqnpwhdvbvnyw|create_secret|update_secret|CREATE TABLE|ALTER TABLE|cron\.|GRANT EXECUTE|pg_get_functiondef|EXECUTE\s/iu);
 const original=await readFile('supabase/migrations/033_order_web_push_notifications.sql','utf8');
 const shared="body := p_payload,\n    headers := jsonb_build_object(\n      'Content-Type', 'application/json',\n      'x-order-push-secret', v_secret\n    ),\n    timeout_milliseconds := 5000";
 for(const body of [sql,original.replaceAll('\r\n','\n')])assert.ok(body.includes(shared));
 const build=await buildEmptyProjectInput(process.cwd());
 assert.equal(build.manifest.length,138);assert.ok(!build.manifest.some(m=>m.name===unit.name));
});

test('later owner139 command cannot replay138 or activate delivery;verify-only stays138',async()=>{
 const source=await readFile('scripts/operations/frankfurt-owner-build.mjs','utf8');
 const start=source.indexOf("if(mode==='apply-139'){\n   // Owner-only");
 assert.ok(start>0);const end=source.indexOf("stage='empty-target-guard'",start);
 const branch=source.slice(start,end);
 assert.match(branch,/VERIFY138_MUST_PASS_FIRST/u);assert.match(branch,/await verifyCatalogReadOnly/u);
 assert.match(branch,/await apply139/u);assert.match(branch,/migration.*repair.*139/u);
 assert.match(branch,/functionReference\(executor,139\)/u);assert.match(branch,/report.ok=true;return report/u);
 assert.doesNotMatch(branch,/transitionNotifications\(|create_secret|update_secret|cliCall\(\['link'/u);
 const helper=await readFile('scripts/operations/frankfurt-migration139.mjs','utf8');
 assert.ok(helper.indexOf('EXACT138_HISTORY_REQUIRED')<helper.indexOf('beforeWrite();'));
 assert.ok(helper.indexOf("assert.equal(applied.code,0")<helper.indexOf('await repair()'));
 assert.match(helper,/139_EXPECTS_ONE_FUNCTION_DELTA/u);assert.match(helper,/139_FUNCTION_METADATA_CHANGED/u);
 assert.match(helper,/139_NOTIFICATION_HOLD_CHANGED/u);
 assert.ok(helper.indexOf('report.catalogDifferences=catalogDifference')<helper.indexOf('139_EXPECTS_ONE_FUNCTION_DELTA'));
});

test('139 transport fixture uses the extension owner only for rollback-only stub,no new grants',async()=>{
 const sql=await readFile('scripts/testing/order-push-url-runtime.sql','utf8');
 assert.ok(sql.indexOf('SET LOCAL ROLE postgres;')<sql.indexOf('public.enqueue_order_push_webhook(payload)'));
 assert.ok(sql.indexOf('RESET ROLE;')<sql.indexOf('CREATE OR REPLACE FUNCTION net.http_post'));
 assert.ok(sql.indexOf('SET LOCAL ROLE postgres;',sql.indexOf('RESET ROLE;'))>sql.indexOf('CREATE OR REPLACE FUNCTION net.http_post'));
 assert.match(sql,/ROLLBACK;\s*$/u);assert.doesNotMatch(sql,/\bGRANT\b[^\n]*;/u);
 const runner=await readFile('scripts/testing/run-order-push-url-runtime.mjs','utf8');
 assert.match(runner,/PROBE_MUST_RESTORE_FULL_CATALOG/u);
 assert.match(runner,/fixtureExecutor\.args\[fixtureExecutor\.args\.indexOf\('-U'\)\+1\]='supabase_admin'/u);
});
