import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {mkdir,mkdtemp,readFile,lstat,realpath,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {protectResetPath} from './reset214-private-state.mjs';
import {verifyBackupArchive} from '../backup/verify-backup.mjs';
import {stageABaseline225,assertStageABaseline225,stageBReadOnlySql225,verifyStageB225,stockAlertSnapshotSql225} from './two-stage225.mjs';
const root=path.resolve(import.meta.dirname,'../..'),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fileSha=async file=>{const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');};
async function external(file,{json=true}={}){
 const full=path.resolve(file),relative=path.relative(root,full);
 assert.ok(relative.startsWith('..'+path.sep)||path.isAbsolute(relative),'STAGE_B_INPUT_OUTSIDE_REPOSITORY_REQUIRED');
 assert.equal(await realpath(full),full,'STAGE_B_INPUT_LINK_REFUSED');
 const stat=await lstat(full);assert.ok(stat.isFile()&&!stat.isSymbolicLink(),'STAGE_B_INPUT_FILE_REQUIRED');
 if(!json)return full;
 assert.ok(stat.size<=32*1024**2,'STAGE_B_JSON_TOO_LARGE');return readFile(full);
}
async function outputFolder(file){
 const full=path.resolve(file);let parent=path.dirname(full);
 for(;;){try{await lstat(path.join(parent,'.git'));throw Error('STAGE_B_OUTPUT_IN_REPOSITORY_REFUSED');}catch(e){if(e.code!=='ENOENT')throw e;}const next=path.dirname(parent);if(next===parent)break;parent=next;}
 await mkdir(full,{mode:0o700});assert.equal(await realpath(full),full,'STAGE_B_OUTPUT_LINK_REFUSED');await protectResetPath(full,true);return full;
}
export function unwrapStageB225(value){
 if(Array.isArray(value)){assert.equal(value.length,1,'STAGE_B_SINGLE_RESULT_REQUIRED');assert.deepEqual(Object.keys(value[0]),['stage_b_snapshot'],'STAGE_B_RESULT_COLUMN_REQUIRED');return value[0].stage_b_snapshot;}
 return value;
}
export function unwrapStageAAlerts225(value){
 if(Array.isArray(value)){assert.equal(value.length,1,'STAGE_A_SINGLE_RESULT_REQUIRED');assert.deepEqual(Object.keys(value[0]),['stage_a_stock_alert_snapshot'],'STAGE_A_RESULT_COLUMN_REQUIRED');return value[0].stage_a_stock_alert_snapshot;}
 return value;
}
export async function runTwoStage225(args){
 const options=new Map();
 for(let i=0;i<args.length;i+=2){assert.ok(['--mode','--source-evidence','--backup-report','--archive','--stock-alerts','--baseline','--baseline-sha256','--observed','--output'].includes(args[i])&&args[i+1]&&!options.has(args[i]),'STAGE_B_OPTIONS_INVALID');options.set(args[i],args[i+1]);}
 const mode=options.get('--mode');assert.ok(['prepare','prepare-archive','alert-query','query','verify'].includes(mode),'STAGE_B_MODE_REQUIRED');assert.ok(options.has('--output'),'STAGE_B_OUTPUT_REQUIRED');
 const preparing=mode==='prepare'||mode==='prepare-archive';
 const expected=preparing?['--mode',...(mode==='prepare'?['--source-evidence']:[]),'--backup-report','--archive','--stock-alerts','--output']:mode==='alert-query'?['--mode','--output']:mode==='query'?['--mode','--baseline','--baseline-sha256','--output']:['--mode','--baseline','--baseline-sha256','--observed','--output'];
 assert.deepEqual([...options.keys()].sort(),expected.sort(),'STAGE_B_OPTIONS_FOR_MODE');
 if(mode==='alert-query'){
  const output=await outputFolder(options.get('--output')),text='SELECT ('+stockAlertSnapshotSql225()+') AS stage_a_stock_alert_snapshot;\n';
  await writeFile(path.join(output,'STAGE_A_STOCK_ALERT_READ_ONLY.sql'),text,{flag:'wx',mode:0o600});
  const report={ok:true,mode,offline:true,databaseWrites:0,querySha256:sha(text)};console.log(JSON.stringify(report));return report;
 }
 let baseline,verification;
 if(preparing){
  const stockAlerts=unwrapStageAAlerts225(JSON.parse((await external(options.get('--stock-alerts'))).toString('utf8')));
  const backup=JSON.parse((await external(options.get('--backup-report'))).toString('utf8'));
  const archive=await external(options.get('--archive'),{json:false}),archiveSha=await fileSha(archive);
  assert.equal(archiveSha,backup.sha256,'STAGE_A_ARCHIVE_SHA_MISMATCH');
  if(mode==='prepare'){
   const evidence=JSON.parse((await external(options.get('--source-evidence'))).toString('utf8'));baseline=stageABaseline225(evidence,backup,archiveSha,stockAlerts);
  }else{
   const passphrase=process.env.NAWASRAH_BACKUP_PASSPHRASE;assert.ok(passphrase&&passphrase.length>=16,'STAGE_A_ARCHIVE_PASSPHRASE_REQUIRED');
   const parent=await realpath(tmpdir()),temporary=await mkdtemp(path.join(parent,'nawasrah-stage-a225-'));await protectResetPath(temporary,true);
   try{
    const extracted=path.join(temporary,'verified');await verifyBackupArchive({archivePath:archive,passphrase,extractTo:extracted});
    const evidence=JSON.parse(await readFile(path.join(extracted,'database/source-evidence.json'),'utf8'));baseline=stageABaseline225(evidence,backup,archiveSha,stockAlerts);
   }finally{
    assert.equal(await realpath(temporary),temporary,'STAGE_A_TEMP_LINK_REFUSED');assert.equal(path.dirname(temporary),parent,'STAGE_A_TEMP_SCOPE_REFUSED');assert.ok(path.basename(temporary).startsWith('nawasrah-stage-a225-'),'STAGE_A_TEMP_SCOPE_REFUSED');
    await rm(temporary,{recursive:true,force:true});
   }
  }
 }else{
  const bytes=await external(options.get('--baseline'));assert.match(options.get('--baseline-sha256'),/^[a-f0-9]{64}$/u,'STAGE_B_APPROVED_BASELINE_SHA_REQUIRED');assert.equal(sha(bytes),options.get('--baseline-sha256'),'STAGE_B_BASELINE_SHA_MISMATCH');baseline=assertStageABaseline225(JSON.parse(bytes.toString('utf8')));
  if(mode==='verify')verification=verifyStageB225(baseline,unwrapStageB225(JSON.parse((await external(options.get('--observed'))).toString('utf8'))));
 }
 const output=await outputFolder(options.get('--output'));
 if(preparing){
  const text=JSON.stringify(baseline,null,2)+'\n';await writeFile(path.join(output,'stage-a-baseline.json'),text,{flag:'wx',mode:0o600});
  const report={ok:true,mode,offline:true,databaseWrites:0,archiveSha256:baseline.archiveSha256,baselineSha256:sha(text),protectedTables:Object.keys(baseline.tables).length};
  await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(report));return report;
 }
 if(mode==='query'){
  // A single SELECT makes its result visible in Supabase SQL Editor. The
  // rehearsal wraps this same SELECT in BEGIN READ ONLY to prove admission.
  const text=stageBReadOnlySql225(baseline)+' AS stage_b_snapshot;\n';
  await writeFile(path.join(output,'STAGE_B_READ_ONLY.sql'),text,{flag:'wx',mode:0o600});
  const report={ok:true,mode,offline:true,databaseWrites:0,querySha256:sha(text)};console.log(JSON.stringify(report));return report;
 }
 await writeFile(path.join(output,'stage-b-verified.json'),JSON.stringify(verification,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(verification));return verification;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){runTwoStage225(process.argv.slice(2)).catch(error=>{
 const code=/\bSTAGE_[AB]_[A-Z_]+(?::[a-z_0-9.]+)?/u.exec(String(error.message))?.[0]??'STAGE_B_LOCAL_CHECK_FAILED';
 console.error(JSON.stringify({ok:false,offline:true,databaseWrites:0,code,message:'توقف قبل الجرد: فشل فحص الفصل بين المرحلتين؛ راجع التقرير والنسخة المعتمدة.'}));process.exitCode=1;
});}
