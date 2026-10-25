import assert from 'node:assert/strict';
import {classifiedError} from './postgres-diagnostic.mjs';
const qi=v=>'"'+v.replaceAll('"','""')+'"';
const q=v=>"'"+String(v).replaceAll("'","''")+"'";
export function partitionRestoreToc(list){
  const lines=String(list).split(/\r?\n/u).filter(line=>line.trim()&&!line.startsWith(';'));
  const entries=lines.map(line=>({line,match:line.match(/^(\d+);\s+\d+\s+\d+\s+(.+)$/u)}));
  assert.ok(entries.every(e=>e.match),'RESTORE_TOC_UNPARSED_ENTRY');
  assert.ok(entries.length>0,'RESTORE_TOC_EMPTY');
  const ids=entries.map(e=>e.match[1]);assert.equal(new Set(ids).size,ids.length,'RESTORE_TOC_DUPLICATE');
  const schemas=entries.filter(e=>e.match[2].startsWith('SCHEMA '));
  const remainder=entries.filter(e=>!e.match[2].startsWith('SCHEMA '));
  const covered=[...schemas,...remainder].map(e=>e.match[1]);assert.equal(covered.length,ids.length);assert.equal(new Set(covered).size,ids.length);
  const extensions=entries.filter(e=>e.match[2].startsWith('EXTENSION ')).map(e=>{
    const parts=e.match[2].split(/\s+/u);assert.equal(parts[1],'-');assert.match(parts[2],/^[a-zA-Z0-9_-]+$/u);return parts[2];
  });
  return {schemas:schemas.map(e=>e.line).join('\n')+'\n',remainder:remainder.map(e=>e.line).join('\n')+'\n',extensions,proof:{totalEntries:ids.length,schemaEntries:schemas.length,remainingEntries:remainder.length,omittedEntries:0,duplicatedEntries:0}};
}
export async function prepareRestoreExtensions(session,before,available,tocExtensions){
  const captured=before.catalog.extensions??[];
  for(const e of captured){
    if(!available.some(a=>a.name===e.name&&a.version===e.version))throw classifiedError('RESTORE_EXTENSION_UNAVAILABLE',{stage:'restore-extension-preflight',tool:'pg_restore',toc:{type:'EXTENSION',schema:null,name:e.name},restoreErrorCode:available.some(a=>a.name===e.name)?'EXTENSION_VERSION':'MISSING_EXTENSION'});
    assert.match(e.name,/^[a-zA-Z0-9_-]+$/u);assert.match(e.version,/^[a-zA-Z0-9_.+-]+$/u);assert.ok(before.roles.some(r=>r.name===e.owner),'RESTORE_EXTENSION_OWNER_MISSING');
  }
  assert.deepEqual([...new Set(tocExtensions)].sort(),captured.filter(e=>e.name!=='plpgsql').map(e=>e.name).sort(),'RESTORE_EXTENSION_TOC_COVERAGE');
  for(const name of tocExtensions){
    const e=captured.find(e=>e.name===name),owner=before.roles.find(r=>r.name===e.owner);
    // No catalog UPDATE:extension members are born under the captured owner.
    // Privilege elevation is confined to this network-none disposable cluster;
    // the original exact role flags are restored even if CREATE fails.
    try{
      if(!owner.super)await session.query(`ALTER ROLE ${qi(e.owner)} SUPERUSER;`);
      await session.query(`SET SESSION AUTHORIZATION ${qi(e.owner)};CREATE EXTENSION ${qi(e.name)} WITH SCHEMA ${qi(e.schema)} VERSION ${q(e.version)};RESET SESSION AUTHORIZATION;`);
    }finally{
      await session.query('RESET SESSION AUTHORIZATION;');
      if(!owner.super)await session.query(`ALTER ROLE ${qi(e.owner)} NOSUPERUSER;`);
    }
  }
  const actual=JSON.parse((await session.query("SELECT jsonb_agg(jsonb_build_object('name',e.extname,'version',e.extversion,'schema',n.nspname,'owner',pg_get_userbyid(e.extowner)) ORDER BY e.extname) FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace;")).trim());
  assert.deepEqual(actual,captured,'RESTORE_EXTENSION_OWNER_SCHEMA_VERSION_DIFFER');
  return {extensions:captured.length,exactVersions:true,exactOwners:true,exactSchemas:true,roleFlagsRestored:true};
}
