// Owner-approved219 projection only. Historical SQL files remain immutable.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {canonicalLf,sha256} from './maintenance-db-contract.mjs';

export const home219Columns=Object.freeze(['id','customer_id','branch_id','status',
  'payment_method','delivery_fee_in_minor_units','total_in_minor_units','source',
  'created_at','amount_paid_in_minor_units','operation_id']);
const wide='SELECT o.*, fc.at AS completion_at';
export const home219Projection='SELECT '+home219Columns.map(name=>'o.'+name).join(', ')+', fc.at AS completion_at';
export function narrowHome219Definition(input){
  const sql=canonicalLf(input);
  assert.equal(sql.split(wide).length,2,'HOME219_EXACT_SINGLE_ORDER_SCOPE_REQUIRED');
  const result=sql.replace(wide,home219Projection);
  assert.equal(result.replace(home219Projection,wide),sql,'HOME219_PROJECTION_ONLY');
  return result;
}
export async function originalHomeFactsDefinition(root,version,{privateName=false}={}){
  assert.ok([195,197,201,202,203].includes(version),'HOME219_REVIEWED_SOURCE_VERSION');
  const {readdir}=await import('node:fs/promises');
  const directory=path.join(root,'supabase/migrations');
  const name=(await readdir(directory)).find(name=>name.startsWith(version+'_')&&name.endsWith('.sql'));
  assert.ok(name,'HOME219_ORIGINAL_MIGRATION_REQUIRED');
  const source=canonicalLf(await readFile(path.join(directory,name),'utf8'));
  const state=JSON.parse(await readFile(path.join(root,'docs/agent/project-state.json'),'utf8'));
  assert.equal(sha256(source).toUpperCase(),state[`migration${version}CanonicalLfSha256`],
    'HOME219_ORIGINAL_MIGRATION_CHANGED');
  const header='CREATE OR REPLACE FUNCTION public.phase6_financial_facts_internal(';
  const start=source.indexOf(header),end=source.indexOf('\n$$;',start);
  assert.ok(start>=0&&end>start,'HOME219_ORIGINAL_DEFINITION_REQUIRED');
  let definition=source.slice(start,end+4);
  if(privateName)definition=definition.replace(header,
    'CREATE OR REPLACE FUNCTION public.phase6_financial_facts_before208_internal(');
  return definition;
}
