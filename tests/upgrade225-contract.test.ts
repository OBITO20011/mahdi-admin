import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {assert225SourceRowsPreserved} from '../scripts/operations/upgrade225-data.mjs';
import {assert225History,upgrade225Arguments} from '../scripts/operations/frankfurt-owner-upgrade225.mjs';
import {checkRegistration225} from '../scripts/operations/upgrade225-registration.mjs';
import {operationalManifest} from '../scripts/operations/operational-schema.mjs';
import {assertSupportedUpgrade225,supportedPriorUpgrades225} from '../scripts/operations/supported-upgrades225.mjs';

const versions=(await operationalManifest()).filter((row:{name:string})=>Number(row.name.slice(0,3))<=224).map((row:{name:string})=>row.name.slice(0,3));
assert.equal(versions.length,184);
assert.equal(versions.at(-1),'224');
const reference={prefixes:{224:{appliedVersions:versions},225:{appliedVersions:[...versions,'225']}},appliedVersions:[...versions,'225']};
const empty={rows:0,hash:createHash('md5').update('').digest('hex')};

test('225 admits only the closed222/223/224 upgrade sequence under its exact command and ceiling',()=>{
 assert.deepEqual(supportedPriorUpgrades225,[222,223,224]);
 const schema={ceiling:225,upgradeCommand:'frankfurt-owner-upgrade225',legacyArchiveCeilings:[220,222,223,224]};
 for(const version of [222,223,224])assert.doesNotThrow(()=>assertSupportedUpgrade225(version,schema));
 for(const version of [219,220,221,225,226])assert.throws(()=>assertSupportedUpgrade225(version,schema),/UPGRADE_ADAPTER_NOT_CURRENT/u);
 for(const bad of [{...schema,ceiling:226},{...schema,upgradeCommand:'other'},{...schema,legacyArchiveCeilings:[222,223]}])
  assert.throws(()=>assertSupportedUpgrade225(224,bad),/UPGRADE_ADAPTER_NOT_CURRENT/u);
});

test('225 accepts only the exact completed224 prefix followed by its one migration',()=>{
 assert.deepEqual(assert225History(versions,reference),['225']);
 assert.deepEqual(assert225History(reference.appliedVersions,reference),[]);
 for(const wrong of [versions.slice(0,-1),[...versions,'221'],[...versions,'225','226'],[...versions.slice(1),'224']])
  assert.throws(()=>assert225History(wrong,reference));
});

test('225 adds only an empty private pricing-state table and preserves all prior business rows',()=>{
 const before:{tables:Record<string,{rows:number;hash:string}>}={tables:{'public.products':{rows:2,hash:'products'},'sales_lite3.product_counters':{rows:1,hash:'counter'},'supabase_migrations.schema_migrations':{rows:184,hash:'old'}}};
 const after:{tables:Record<string,{rows:number;hash:string}>}={tables:{...before.tables,'public.product_sale_pricing_state225':empty,'supabase_migrations.schema_migrations':{rows:185,hash:'new'}}};
 assert.doesNotThrow(()=>assert225SourceRowsPreserved(before,after));
 for(const change of ['nonempty','missing','old-row','unknown-table']){
  const bad=structuredClone(after);
  if(change==='nonempty')bad.tables['public.product_sale_pricing_state225']={rows:1,hash:'written'};
  if(change==='missing')delete bad.tables['public.product_sale_pricing_state225'];
  if(change==='old-row')bad.tables['public.products'].hash='changed';
  if(change==='unknown-table')bad.tables['public.unknown']=empty;
  assert.throws(()=>assert225SourceRowsPreserved(before,bad),change);
 }
 assert.throws(()=>assert225SourceRowsPreserved(after,after),/ALREADY_EXISTS/u);
});

test('225 registration preflight reads exact184/224 before apply and185/225 after registration',async()=>{
 let observed:string[]=[];
 const cli=async(args:string[])=>{
  assert.deepEqual(args,['migration','list','--linked','--output-format','json']);
  return {stdout:JSON.stringify({migrations:observed.map(remote=>({local:remote,remote}))})};
 };
 observed=versions;
 assert.deepEqual(await checkRegistration225({cli,reference,mode:'--apply'}),{ceiling:224,files:184});
 assert.deepEqual(await checkRegistration225({cli,reference,mode:'--resume-registration'}),{ceiling:224,files:184});
 observed=reference.appliedVersions;
 assert.deepEqual(await checkRegistration225({cli,reference,mode:'--verify-only'}),{ceiling:225,files:185});
 await assert.rejects(()=>checkRegistration225({cli,reference,mode:'--apply'}),/UPGRADE_REGISTRATION_PREFLIGHT_FAILED/u);
 observed=versions.slice(1);
 await assert.rejects(()=>checkRegistration225({cli,reference,mode:'--apply'}),/UPGRADE_REGISTRATION_PREFLIGHT_FAILED/u);
 const unavailable=async()=>{throw new Error('sensitive CLI text must not escape');};
 await assert.rejects(()=>checkRegistration225({cli:unavailable,reference,mode:'--apply'}),error=>error instanceof Error&&error.message==='UPGRADE_REGISTRATION_PREFLIGHT_FAILED');
});

test('225 apply, resume and verify require their exact explicit protection evidence',()=>{
 for(const args of [['--apply'],['--resume-registration','--backup-evidence','b'],['--verify-only','--backup-evidence','b'],['--dry-run','--backup-evidence','b'],['--apply','--verify-only','--backup-evidence','b']])
  assert.throws(()=>upgrade225Arguments(args));
 assert.deepEqual(upgrade225Arguments(['--apply','--backup-evidence','b']).forward,['--apply']);
 assert.deepEqual(upgrade225Arguments(['--resume-registration','--backup-evidence','b','--registration-state','r']).forward,['--resume-registration']);
 assert.deepEqual(upgrade225Arguments(['--verify-only','--backup-evidence','b','--restore-evidence','r','--upgrade-report','u']).forward,['--verify-only']);
});
