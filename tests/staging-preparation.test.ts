import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('Arabic staging guide prepares exactly the five functions with the existing JWT policy',()=>{
 const text=readFileSync('docs/operations/STAGING_FRANKFURT_AR.md','utf8');
 const config=readFileSync('supabase/config.toml','utf8');
 const commands=text.split(/\r?\n/u).filter(l=>l.startsWith('npx supabase functions deploy '));
 assert.equal(commands.length,5);
 for(const command of commands){const name=command.split(' ')[4];
  assert.ok(command.includes('--project-ref kzevmysfydaslxcerogt'));
  const verify=config.match(new RegExp(`\\[functions\\.${name}\\]\\s*verify_jwt = (true|false)`,'u'))?.[1];
  assert.ok(verify);assert.equal(command.includes('--no-verify-jwt'),verify==='false');
 }
 assert.ok(text.includes('`GEMINI_API_KEY` غير مضبوط'));assert.match(text,/Allow new users to sign up/u);
 for(const name of ['GUEST_ORDER_HASH_SECRET','TURNSTILE_SECRET_KEY','TURNSTILE_ALLOWED_HOSTNAMES','WEB_PUSH_VAPID_PRIVATE_KEY','WEB_PUSH_VAPID_PUBLIC_KEY','WEB_PUSH_SUBJECT','NAWASRAH_AUTOMATION_SECRET'])assert.ok(text.includes(name));
});
test('staging instructions fail closed on old CSP/SEO,require Access,and use preview not main',()=>{
 const text=readFileSync('docs/operations/STAGING_FRANKFURT_AR.md','utf8');
 assert.ok(text.includes('customer-web/scripts/generate-seo-pages.mjs'));
 assert.ok(text.includes('public/_headers'));assert.ok(text.includes('customer-web/public/_headers'));
 assert.ok(text.includes('wss://kzevmysfydaslxcerogt.supabase.co'));
 assert.match(text,/النشر محجوب/u);assert.match(text,/incognito/u);assert.match(text,/Bypass/u);
 const commands=text.split(/\r?\n/u).filter(l=>l.startsWith('npx wrangler pages deploy'));
 assert.equal(commands.length,2);assert.ok(commands.every(c=>c.endsWith('--branch=staging-frankfurt')));
 assert.match(text,/Push-Location customer-web/u);assert.match(text,/pop-location/iu);
 assert.match(text,/product-images/u);assert.match(text,/13 جدولاً/u);
});
