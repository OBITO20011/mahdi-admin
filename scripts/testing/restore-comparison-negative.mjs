// Explicit synthetic archive mutation ONLY. Never accepts an owner archive path.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,stat,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {verifyBackupArchive} from '../backup/verify-backup.mjs';
import {encryptFile} from '../backup/backup-crypto.mjs';
import {restoreCompleteBackup} from '../backup/complete-backup.mjs';
const exec=promisify(execFile);
export async function proveComparisonRejectsSyntheticDifference({archivePath,passphrase,output}){
  assert.ok(path.basename(output).startsWith('nawasrah-dual-backup-proof-'));
  assert.ok(path.resolve(archivePath).startsWith(path.resolve(output)+path.sep),'ONLY_DISPOSABLE_TEST_ARCHIVE');
  const work=await mkdtemp(path.join(tmpdir(),'nawasrah-comparison-negative-')),content=path.join(work,'content');
  const secret='PRIVATE_SYNTHETIC_EVIDENCE_VALUE_NEVER_PERSIST';
  try{
    await verifyBackupArchive({archivePath,passphrase,extractTo:content});
    const evidenceFile=path.join(content,'database','source-evidence.json'),before=JSON.parse(await readFile(evidenceFile,'utf8'));
    // An intentional mismatch in the expected oracle. The restore must stay failed,
    // preserving every other original comparison and never "repair" source data.
    before.tables['public.orders'].rows+=1;before.tables['public.orders'].hash=secret;
    before.roles.find(r=>r.name==='postgres').config=['private.fixture='+secret];
    await writeFile(evidenceFile,JSON.stringify(before)+'\n');
    const manifestFile=path.join(content,'manifest.json'),manifest=JSON.parse(await readFile(manifestFile,'utf8'));
    const entry=manifest.files.find(f=>f.path==='database/source-evidence.json');
    entry.size=(await stat(evidenceFile)).size;entry.sha256=createHash('sha256').update(await readFile(evidenceFile)).digest('hex');
    await writeFile(manifestFile,JSON.stringify(manifest)+'\n');
    const tar=path.join(work,'synthetic.tar'),archive=path.join(work,'synthetic.nwb');
    await exec(process.platform==='win32'?'tar.exe':'tar',['-cf',tar,'-C',content,'.'],{windowsHide:true});await encryptFile(tar,archive,passphrase);
    const reportPath=path.join(output,'intentional-comparison-failure.json');let failure;
    try{await restoreCompleteBackup({archivePath:archive,passphrase,reportPath});}catch(error){failure=error;}
    assert.ok(failure,'INTENTIONAL_DIFFERENCE_MUST_FAIL');
    assert.equal(failure.diagnostic.comparisonCode,'RESTORE_TABLES_DIFFER');assert.ok(!JSON.stringify(failure).includes(secret));
    const report=JSON.parse(await readFile(reportPath,'utf8'));assert.equal(report.ok,false);assert.equal(report.diagnostic.stage,'compare-data-catalog-acl');assert.equal(report.diagnostic.comparisonCode,'RESTORE_TABLES_DIFFER');
    let privateReport;
    if(process.platform!=='win32'){
      assert.equal(report.logs.saved,true);assert.ok(report.logs.files.includes('comparison-sanitized.json'));
      const file=path.join(report.logs.folder,'comparison-sanitized.json'),text=await readFile(file,'utf8');privateReport=JSON.parse(text);
      assert.ok(!text.includes(secret));assert.ok(!text.includes('private.fixture'));assert.deepEqual(privateReport.failedComparisons,['RESTORE_TABLES_DIFFER','RESTORE_ROLES_DIFFER']);
      assert.equal(privateReport.tables.find(t=>t.name==='public.orders').hashDifferent,true);assert.ok(privateReport.roles.find(r=>r.name==='postgres').fields.includes('config'));
      assert.equal((await stat(report.logs.folder)).mode&0o777,0o700);assert.equal((await stat(file)).mode&0o777,0o600);
    }
    return {ok:true,intentionalSyntheticMismatchRejected:true,comparisonCode:report.diagnostic.comparisonCode,privateReportSaved:report.logs.saved,privateReportChecked:!!privateReport,rawValuesNeverPersisted:true,hostedConnectionsMade:false};
  }finally{await rm(work,{recursive:true,force:true});}
}
