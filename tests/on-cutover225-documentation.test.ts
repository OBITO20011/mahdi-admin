import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {canonicalLf,sha256} from '../scripts/testing/maintenance-db-contract.mjs';
import {onCutover225Pins,sourceBeforeOnCutover225} from '../scripts/audit/source-before-on-cutover225.mjs';
import {extractCutoverActivation} from '../scripts/testing/rehearsal220-activation.mjs';
import {classifyCutover225Command,cutover225CommandDocuments} from '../scripts/testing/cutover-command225.mjs';
import {documentedCutoverCommands} from '../scripts/testing/cutover-command-contract.mjs';

const read=(file:string)=>canonicalLf(readFileSync(file,'utf8'));
const plan='docs/operations/GO_LIVE_CUTOVER_AR.md';
const card='docs/handover/ورقة-يوم-التشغيل.md';
const html=card.replace('.md','.html');
const baseline='7482f86d5d62140c5605a6e6c3fb3c3e68a46aed';

test('225 ON cutover keeps all protected upgrades, RESET, signed ON, import, stock and open in order',()=>{
 const document=read(plan);
 const order=['--hold-upgrade --apply','220/181 إلى 222/182','222/182 إلى 223/183','223/183 إلى 224/184',
  '224/184 إلى 225/185','أعد مطابقة مرجع D−1/225','RESET224_STORAGE_CAPABILITY_READ_ONLY.sql',
  '--hold-reset --apply','خذ Backup225 فاصلة','13. اتبع [RESET225]','الوضع ON مُثبت',
  '15. من «بداية التشغيل»','16. ارفع','17. عدّ الدرج','18. بعد قبول الكتالوج','21. افتح الطلبات'];
 let previous=-1;
 for(const marker of order){
  const at=document.indexOf(marker);
  assert.ok(at>previous,marker);
  previous=at;
 }
 assert.match(document,/policy_configuration_allows=true/u);
 assert.match(document,/غير مستخدم في هذا القطع/u);
 assert.match(document,/لا ديون قديمة ولا شيكات افتتاحية. الدرج 0 دينار/u);
 for(const name of ['A','B']) assert.equal(extractCutoverActivation(document,name),
  extractCutoverActivation(read('docs/operations/GO_LIVE_CUTOVER_OFF_ARCHIVE_AR.md'),name));
 assert.match(read(card),/الوضع ON مُثبت/u);
 assert.equal((read(html).match(/<article class="print-page">/gu)??[]).length,2);
 assert.doesNotMatch(read(html),/<script|<iframe|<link\b|<img\b|url\(/iu);
});

test('cutover retains exact archived runbook and card and never projects unknown bytes away',()=>{
 for(const [file,archive] of [[plan,'docs/operations/GO_LIVE_CUTOVER_OFF_ARCHIVE_AR.md'],
  [card,card.replace('.md','-OFF-أرشيف.md')],[html,html.replace('.html','-OFF-أرشيف.html')]]){
  const historical=execFileSync('git',['show',baseline+':'+file],{maxBuffer:16*1024**2});
  assert.equal(read(archive),canonicalLf(historical.toString('utf8')),archive);
 }
 for(const [file,pin] of Object.entries(onCutover225Pins)){
  const current=read(file);
  assert.equal(sha256(current),pin.after,file);
  assert.equal(sourceBeforeOnCutover225(file,current),pin.beforeText,file);
  assert.equal(sourceBeforeOnCutover225(file,current+'\nUNKNOWN_BYTE'),current+'\nUNKNOWN_BYTE',file);
 }
});

test('current ON225 documented commands have explicit versioned offline or connected admission',()=>{
 const documents=Object.fromEntries(cutover225CommandDocuments.map(name=>[name,read('docs/operations/'+name+'.md')]));
 const commands=documentedCutoverCommands(documents);
 for(const row of commands) assert.ok(classifyCutover225Command(row.command).kind,row.command);
 for(const command of [
  'frankfurt-owner-cutover-hold225.mjs --hold-reset --apply',
  'frankfurt-owner-upgrade225.mjs --preflight-registration',
  'frankfurt-owner-upgrade225.mjs --resume-registration',
  'frankfurt-owner-reset225.mjs --plan',
  'd1-reference225-kit.ps1',
  'on-opening225/cli.ts --mode convert',
 ]) assert.ok(commands.some(row=>row.command.includes(command)),command);
 assert.throws(()=>classifyCutover225Command('node scripts/operations/frankfurt-owner-upgrade226.mjs --dry-run'),/CUTOVER_COMMAND_UNREVIEWED/u);
});
