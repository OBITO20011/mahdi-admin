import {pathsBeforeHandover213} from '../scripts/audit/source-before-handover213.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {trialHPins,sourceBeforeTrialH} from '../scripts/audit/source-before-trial-brand.mjs';
import {APP_NAME_AR} from '../src/constants';
import {SEO_BRAND} from '../customer-web/src/config/seoBrand';
const official='النواصرة لتجارة الجملة والمواد الغذائية';
const hash=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');
const read=(p:string)=>readFileSync(p,'utf8');
test('H approved original and every icon derivative have exact provenance and valid dimensions',()=>{
 const proof=JSON.parse(read('docs/assets/TRIAL_BRAND_ASSETS.json'));
 assert.equal(proof.sourceSha256,'10160ee26ebc78fcd2b2d40830fc533b4eee55c9f04d0184cf6dc625936a57c0');
 assert.equal(proof.assets.length,21);
 for(const item of proof.assets){const buffer=readFileSync(item.file);assert.equal(hash(buffer),item.sha256,item.file);
  if(item.original){assert.equal(item.sha256,proof.sourceSha256);continue;}
  if(item.file.endsWith('.png')){assert.equal(buffer.subarray(1,4).toString(),'PNG');assert.equal(buffer.readUInt32BE(16),item.width);assert.equal(buffer.readUInt32BE(20),item.height);}
 }
 assert.equal(hash(readFileSync(proof.archive.file)),proof.archive.sha256);
 for(const app of ['public','customer-web/public']){
  const manifest=JSON.parse(read(app+'/'+(app==='public'?'manifest.webmanifest':'site.webmanifest')));
  assert.ok(manifest.name.includes(official));assert.equal(manifest.short_name,official);
  assert.equal(manifest.icons.filter((i:{purpose:string})=>i.purpose==='maskable').length,1);
  for(const icon of manifest.icons)assert.ok(proof.assets.some((a:{file:string})=>a.file===app+icon.src));
 }
 assert.match(read('customer-web/src/receipts/ReceiptDocument.tsx'),/src="\/nawasrah-receipt-logo\.png"/u);
});
test('H live identity is official while trial contacts, video and historical SQL/pins are unchanged',()=>{
 assert.equal(APP_NAME_AR,official);assert.equal(SEO_BRAND.officialName,official);assert.equal(SEO_BRAND.alternateName,official);
 assert.match(read('customer-web/src/config/store.ts'),/DEFAULT_STORE_WHATSAPP_NUMBER = '0772838886'/u);
 const changed=execFileSync('git',['diff','--name-only','6a7d99e48d6fff5299eb2bc4550d67a8b8908bfb','--','supabase/migrations','scripts/audit/*-hunks.json','customer-web/public/*.mp4','customer-web/public/nawasrah-hero-poster.webp'],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
 const approvedR='supabase/migrations/212_trial_readable_cash_product_choices_damage_history.sql';
 assert.deepEqual(pathsBeforeHandover213(changed).filter(f=>!['scripts/audit/trial-brand-hunks.json','scripts/audit/trial-owner-w-hunks.json','scripts/audit/trial-owner-r-hunks.json',approvedR].includes(f)),[]);
 assert.equal(hash(read(approvedR).replaceAll('\r\n','\n')),'6bdbc906b38b4fd29dd4c5115e040cb1954b1bdb5abe0ee3aedaae634b6ce619','Only the exact owner-approved read-only212 is admitted');
 for(const f of ['customer-web/src/App.tsx','customer-web/src/config/seoBrand.ts','customer-web/src/components/StoreHero.tsx'])assert.ok(!read(f).includes('nawasrah-banner-wide.webp'));
 assert.match(read('docs/operations/GO_LIVE_CUTOVER_AR.md'),/962785857700/u);
});
test('H exact outer inverse preserves delivered211 sources and rejects any unapproved mutation',()=>{
 const base='6a7d99e48d6fff5299eb2bc4550d67a8b8908bfb';
 for(const [file,pin] of Object.entries(trialHPins) as [string,{added?:boolean}][]){
  const current=read(file),restored=sourceBeforeTrialH(file,current);assert.throws(()=>sourceBeforeTrialH(file,current+'\nvoid unapproved;\n'));
  if(pin.added)assert.equal(restored,null);else{const before=execFileSync('git',['show',base+':'+file],{encoding:'utf8',maxBuffer:32*1024**2}).replaceAll('\r\n','\n');assert.equal(restored,before,file);assert.throws(()=>sourceBeforeTrialH(file,before+'\nvoid unapproved;\n'));}
 }
});
