import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {readPublicSupabaseConfig} from '../scripts/backup/create-backup.mjs';
import {BACKUP_PROJECT_REF,backupPublicConfigForProject,assertBackupDatabaseProject} from '../scripts/backup/backup-public-config.mjs';
test('nightly backup never follows frontend Frankfurt defaults and rejects any other linked project before network',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'nawasrah-backup-project-'));
 try{
  await mkdir(path.join(dir,'supabase/.temp'),{recursive:true});await mkdir(path.join(dir,'src/config'),{recursive:true});
  await writeFile(path.join(dir,'src/config/supabase-public-config.ts'),"throw new Error('FRONTEND_CONFIG_MUST_NOT_BE_READ');");
  const link=path.join(dir,'supabase/.temp/project-ref');await writeFile(link,BACKUP_PROJECT_REF+'\n');
  const actual=await readPublicSupabaseConfig(dir);assert.equal(actual.url,'https://acjtabdqqnpwhdvbvnyw.supabase.co');
  assert.equal(actual.publishableKey,'sb_publishable_XYq8HBYT6Pxa2VdRdi69CA_012vvfp5');
  const frontend=await readFile('src/config/supabase-public-config.ts','utf8');assert.ok(!frontend.includes('supabase.co'));assert.ok(frontend.includes('__NAWASRAH_PUBLIC_CONFIG__'));
  await writeFile(link,'kzevmysfydaslxcerogt');await assert.rejects(()=>readPublicSupabaseConfig(dir),/BACKUP_PROJECT_MISMATCH/u);
  await rm(link);await assert.rejects(()=>readPublicSupabaseConfig(dir),{code:'ENOENT'});
  assert.throws(()=>backupPublicConfigForProject(''),/BACKUP_PROJECT_MISMATCH/u);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('native database connection must name the same reviewed backup project',()=>{
 assert.doesNotThrow(()=>assertBackupDatabaseProject(`postgresql://postgres.${BACKUP_PROJECT_REF}@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`));
 assert.doesNotThrow(()=>assertBackupDatabaseProject(`postgresql://postgres@db.${BACKUP_PROJECT_REF}.supabase.co:5432/postgres`));
 for(const connection of ['postgresql://postgres.kzevmysfydaslxcerogt@aws-0-eu-central-1.pooler.supabase.com:5432/postgres','postgresql://postgres@db.kzevmysfydaslxcerogt.supabase.co:5432/postgres','postgresql://postgres.acjtabdqqnpwhdvbvnyw@example.invalid/postgres'])
  assert.throws(()=>assertBackupDatabaseProject(connection),/BACKUP_DATABASE_PROJECT_MISMATCH/u);
});
test('backup validates Storage/database identity before either dump provider and preflight shares that source',async()=>{
 const code=await readFile('scripts/backup/create-backup.mjs','utf8'),entry=code.slice(code.indexOf('export async function createBackup'));
 assert.ok(entry.indexOf('await readPublicSupabaseConfig(projectRoot)')<entry.indexOf('await runNativePostgresDumps'));
 assert.ok(entry.indexOf('await readPublicSupabaseConfig(projectRoot)')<entry.indexOf('await runSupabaseDump'));
 assert.equal([...entry.matchAll(/await readPublicSupabaseConfig\(projectRoot\)/gu)].length,1);
 const preflight=await readFile('scripts/backup/preflight.mjs','utf8');assert.match(preflight,/await readPublicSupabaseConfig\(projectRoot\)/u);
});
