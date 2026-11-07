import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {DEPLOYMENT_FRESHNESS,expectedDeploymentFromCommits} from '../scripts/monitoring/deployment-impact.mjs';

const read=(file:string)=>readFileSync(file,'utf8');
const readme=read('README.md'),arabic=read('docs/README_AR.md');

test('GitHub README is an English maintenance entry with valid local documentation links',()=>{
 assert.match(readme,/^# Nawasrah ERP\r?\n/u);
 assert.ok(readme.includes('Arabic RTL wholesale ERP: admin back-office, POS, and customer storefront.'));
 for(const section of ['Overview','Key features','Architecture','Core principles','Local development','Quality commands','Repository layout','Documentation','Ownership and license'])assert.ok(readme.includes('## '+section));
 for(const file of ['README.md','docs/README_AR.md']){
  const text=read(file);
  for(const match of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)){
   const link=match[1];assert.ok(!/^(?:https?:|\/|[a-z]:)/iu.test(link),'ENTRY_LINKS_ARE_REPOSITORY_RELATIVE');
   assert.ok(existsSync(path.resolve(path.dirname(file),link.split('#')[0])),file+': '+link);
  }
 }
 for(const link of ['docs/MAINTAINER_GUIDE_AR.md','AGENTS.md','docs/agent/PROJECT_OVERVIEW.md','docs/README_AR.md'])assert.ok(readme.includes(']('+link+')'));
 assert.match(readme,/Operational and maintenance documentation is maintained in Arabic/u);
 assert.match(readme,/Proprietary — all rights reserved/u);
 assert.match(readme,/No open-source license is granted/u);
});

test('setup commands exist and Arabic operational requirements remain available without public environment identifiers',()=>{
 const scripts=JSON.parse(read('package.json')).scripts,store=JSON.parse(read('customer-web/package.json')).scripts;
 for(const command of readme.matchAll(/npm\.cmd (?:--prefix (customer-web) )?run ([a-z][\w:-]*)/gu))assert.ok((command[1]?store:scripts)[command[2]],command[0]);
 for(const script of readme.matchAll(/node (scripts\/[a-z0-9/.-]+\.mjs)/gu))assert.ok(existsSync(script[1]),script[1]);
 for(const term of ['PostgreSQL','RPC','service_role','migrations','supabase db reset','Factory Reset','junction','نشر','سياق','quality'])assert.ok(arabic.includes(term),term);
 for(const text of [readme,arabic]){
  assert.doesNotMatch(text,/\b[a-z]{20}\.supabase\.co\b|projectRef\s*[:=]|C:\\Users\\|Chat\s*ID\s*[:=]|\b\d{8,}:\w{20,}\b/iu);
  assert.doesNotMatch(text,/\b(?:sb_secret_|sb_publishable_)[\w-]+|-----BEGIN .*PRIVATE KEY-----/u);
 }
 assert.ok(readme.includes('explicit environment'));assert.ok(readme.includes('fixture artifacts must not be deployed'));
});

test('both app deployment checks treat the README and Arabic companion as documentation only',()=>{
 const deployed='a'.repeat(40),main='b'.repeat(40);
 for(const app of ['admin','customer'] as const){
  const result=expectedDeploymentFromCommits({app,deployedSha:deployed,mainSha:main,commits:[{sha:main,files:['README.md','docs/README_AR.md','tests/readme-documentation.test.ts'],adminPackageImpact:false}]});
  assert.equal(result.status,DEPLOYMENT_FRESHNESS.CURRENT);
 }
});
