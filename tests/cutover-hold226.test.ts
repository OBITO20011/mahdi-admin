import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {cutoverHoldJobs,cutoverHoldWithExecutor,parseCutoverHoldArgs,runCutoverHold225} from '../scripts/operations/frankfurt-owner-cutover-hold225.mjs';
import {TARGET} from '../scripts/operations/frankfurt-owner-build.mjs';
import {operationalManifest} from '../scripts/operations/operational-schema.mjs';
import {manifestDigest,sha256} from '../scripts/testing/maintenance-db-contract.mjs';
import {documentedCutoverCommands} from '../scripts/testing/cutover-command-contract.mjs';
import {stageABaseline225,stageBReadOnlySql225,verifyStageB225} from '../scripts/operations/two-stage225.mjs';
import {backupSourceEvidenceSha256} from '../scripts/backup/complete-backup.mjs';

const manifest=await operationalManifest();
const history=manifest.map((m:{name:string})=>m.name.slice(0,3));
const cleanup='cleanup-guest-order-gateway-requests';

test('the current owner command requires 226 and both protection files for RESET transition',async()=>{
 const plan=await runCutoverHold225(['--hold-reset','--plan']);
 assert.equal(plan.historyCeiling,226);
 assert.equal(plan.networkAccess,false);
 assert.equal((await runCutoverHold225(['--hold-upgrade','--plan'])).historyCeiling,220);
 assert.throws(()=>parseCutoverHoldArgs(['--hold-reset','--apply','--verify-report','proof']),/RESET_BACKUP226_EVIDENCE_REQUIRED/u);
 assert.throws(()=>parseCutoverHoldArgs(['--hold-reset','--verify','--backup-evidence','backup']),/RESET_BACKUP226_EVIDENCE_REQUIRED/u);
 assert.equal(parseCutoverHoldArgs(['--hold-reset','--dry-run','--verify-report','proof','--backup-evidence','backup']).mode,'dry-run');
 assert.throws(()=>parseCutoverHoldArgs(['--hold-reset','--plan','--ceiling','225']),/CUTOVER_HOLD_UNKNOWN_OPTION/u);
});

test('current RESET hold accepts exact 226 and refuses older, missing, duplicate and extra migrations before any write',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'cutover226-test-'));
 try{
  const binding={user:'postgres',database:'postgres',port:5432,host:'localhost'};
  const jobs=[...cutoverHoldJobs].sort().map((name,id)=>({id:id+1,name,schedule:'* * * * *',command:'SELECT 1;',
   host:'localhost',port:5432,database:'postgres',username:'postgres',active:name===cleanup}));
  const trigger={schema:'public',table:'orders',name:'trg_notify_new_website_order_push',definition:'fixture',enabled:'D'};
  const notifications={jobs,trigger};
  const reference={manifest,appliedVersions:history,notificationSnapshot:notifications};
  const base={notifications,binding,ordersClosed:true,singleSetting:true,leaseIdle:true,dispatchOff:true};
  const evidenceFile=path.join(dir,'hold.json'),verification=path.join(dir,'verify.json'),backupEvidence=path.join(dir,'backup.json');
  const original={ordersClosed:false,triggerEnabled:'O',dispatchEnabled:true,historyCeiling:220,historyFiles:181,jobs};
  await writeFile(evidenceFile,JSON.stringify({format:1,projectRef:TARGET.id,original,
   baseManifestDigest:manifestDigest(manifest.filter((m:{name:string})=>m.name.slice(0,3)<='220')),
   inventorySha256:sha256(JSON.stringify({binding,trigger:{...trigger,enabled:null},jobs:jobs.map(j=>({...j,active:null}))}))}));
  const archiveName='nawasrah-backup-2026-11-26T00-00-00Z.nwb',archivePath=path.join(dir,archiveName);
  const bytes=Buffer.from('local fixture bytes'),archiveSha=createHash('sha256').update(bytes).digest('hex');
  await writeFile(archivePath,bytes);
  const sourceEvidenceSha256='a'.repeat(64);
  const backup={ok:true,projectRef:TARGET.id,formatVersion:2,historyCeiling:226,historyFiles:186,sha256:archiveSha,
   sourceEvidenceSha256,finishedAt:new Date().toISOString(),archivePath,archiveName,archiveBytes:bytes.length};
  await writeFile(backupEvidence,JSON.stringify(backup));
  const report={projectRef:TARGET.id,mode:'verify-only',ok:true,complete:true,targetCeiling:226,
   remoteWriteAttempted:false,protectionPending:false,protection:{strictIsolatedRestore:true,complete:true,
    afterArchiveSha256:archiveSha,afterSourceEvidenceSha256:sourceEvidenceSha256}};
  await writeFile(verification,JSON.stringify(report));
  const run=(observed:string[],{mode='apply',resetCeiling=226,expected=reference,proof=backupEvidence}={})=>cutoverHoldWithExecutor({
   executor:{command:process.execPath,args:['-e',
    "let s='';process.stdin.setEncoding('utf8');process.stdin.on('data',x=>s+=x);process.stdin.on('end',()=>{if(!s.startsWith('BEGIN READ ONLY;'))process.exit(42);process.stdout.write(process.argv[1]);});",
    JSON.stringify({...base,history:observed})]},
   reference:expected,phase:'reset',mode,resetCeiling,evidenceFile,verification,backupEvidence:proof,
  });
  assert.equal(history.length,186);assert.equal(history.includes('221'),false);
  assert.equal((await run(history,{mode:'dry-run'})).before?.historyCeiling,226);
  const accepted=await run(history);
  assert.equal(accepted.noOp,true);assert.equal(accepted.remoteWriteAttempted,false);
  assert.equal((await run(history,{mode:'verify'})).historyFiles,186);
  for(const bad of [history.slice(0,181),history.slice(0,184),history.slice(0,185),
   [...history.slice(0,25),...history.slice(26)], [...history,'227'],
   [...history.slice(0,183),'221','225','226'],[...history.slice(0,185),'225']]){
   await assert.rejects(()=>run(bad),/CUTOVER_HOLD_HISTORY_MISMATCH/u);
  }
  await assert.rejects(()=>run(history,{expected:{...reference,appliedVersions:history.slice(0,185)}}),/CUTOVER_HOLD_REFERENCE_HISTORY_INVALID/u);
  await writeFile(verification,JSON.stringify({...report,targetCeiling:225}));
  await assert.rejects(()=>run(history),/CUTOVER_HOLD_VERIFIED_226_REQUIRED/u);
  const legacy=await run(history.slice(0,185),{resetCeiling:225,expected:{...reference,appliedVersions:history.slice(0,185)}});
  assert.equal(legacy.historyCeiling,225);
  await writeFile(verification,JSON.stringify({...report,protection:{...report.protection,afterArchiveSha256:'b'.repeat(64)}}));
  await assert.rejects(()=>run(history),/CUTOVER_HOLD_BACKUP226_ARCHIVE_CHANGED/u);
  await writeFile(verification,JSON.stringify(report));
  await writeFile(archivePath,Buffer.alloc(bytes.length));
  await assert.rejects(()=>run(history),/BACKUP_HASH_CHANGED/u);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('stage A/B accepts the 226 archive with the existing protected-table rules',()=>{
 const fixture=JSON.parse(readFileSync(new URL('./fixtures/two-stage225-reference-tables.json',import.meta.url),'utf8'));
 const catalog=fixture.catalog,empty={rows:0,hash:'d41d8cd98f00b204e9800998ecf8427e'};
 const tables=Object.fromEntries(catalog.tables.filter((t:{kind:string})=>['r','p'].includes(t.kind))
  .map((t:{schema:string;name:string})=>[t.schema+'.'+t.name,{...empty}]));
 const evidence={catalog,history,tables},stockAlerts={full:{...empty},withoutLastUpdated:{...empty},rowHashes:{}};
 const backup={ok:true,projectRef:TARGET.id,historyCeiling:226,historyFiles:186,sha256:'a'.repeat(64),
  sourceEvidenceSha256:backupSourceEvidenceSha256(evidence)};
 const baseline=stageABaseline225(evidence,backup,backup.sha256,stockAlerts);
 assert.equal(baseline.ceiling,226);
 assert.match(stageBReadOnlySql225(baseline),/'ceiling',226/u);
 const observed={format:1,ceiling:226,history,catalog,modeOn:true,setupOpen:true,ordersClosed:true,positiveBalances:0,
  tables:structuredClone(tables),stockAlerts,products:[{id:'fixture',sku:'NW-0001'}]};
 assert.equal(verifyStageB225(baseline,observed).ok,true);
 assert.throws(()=>verifyStageB225(baseline,{...observed,ceiling:225}),/STAGE_B_OBSERVED_CEILING/u);
 const bad={...evidence,history:[...history.slice(0,183),'221','225','226']};
 assert.throws(()=>stageABaseline225(bad,{...backup,sourceEvidenceSha256:backupSourceEvidenceSha256(bad)},backup.sha256,stockAlerts),/STAGE_A_HISTORY/u);
 observed.tables['public.orders']={rows:1,hash:'f'.repeat(32)};
 assert.throws(()=>verifyStageB225(baseline,observed),/OPERATIONAL_DATA_CHANGED:public.orders/u);
});

test('current cutover runbook orders 226 protection before RESET hold and leaves a bounded recovery path',()=>{
 const raw=readFileSync('docs/operations/GO_LIVE_CUTOVER_AR.md','utf8');
 const commands=documentedCutoverCommands({GO_LIVE_CUTOVER_AR:raw});
 const relevant=commands.map(x=>x.command).filter(x=>/upgrade226|--hold-reset|reset226/u.test(x));
 let earlier=-1;
 for(const marker of ['upgrade226.mjs --dry-run','upgrade226.mjs --preflight-registration','upgrade226.mjs --apply',
  'upgrade226.mjs --verify-only','upgrade226.mjs --resume-registration','--hold-reset --plan','--hold-reset --dry-run',
  '--hold-reset --apply','--hold-reset --verify','reset226.mjs --plan','reset226.mjs --dry-run','reset226.mjs --apply']){
  const after=relevant.findIndex(line=>line.includes(marker));assert.ok(after>earlier,marker);earlier=after;
 }
 for(const line of relevant.filter(x=>/--hold-reset --(?:apply|dry-run)/u.test(x)))parseCutoverHoldArgs(line.split(' ').slice(2).join(' ').match(/'[^']*'|\S+/gu)!);
 assert.match(raw,/SQL_APPLIED_REGISTRATION_PENDING[\s\S]*نقطة الرجوع هي Backup225/u);
 assert.doesNotMatch(raw,/frankfurt-owner-reset225\.mjs/u);
});
