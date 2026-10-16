import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {approvedCheques195Source} from './approved-cheques195-source';

// Exact reviewed PR3 additions ONLY. Historical parity continues to pin every
// other byte/call/guard. New writers/readers have their own runtime contracts.
const entries:Record<string,readonly (readonly [string,string])[]>=JSON.parse(readFileSync(
 new URL('./fixtures/approved-withdrawals182-source.json',import.meta.url),'utf8'));
export const withdrawals182Files=Object.freeze(Object.keys(entries));
export function approvedWithdrawals182Source(file:string,source:string):string{
 source=approvedCheques195Source(file,source);
 for(const [current,legacy] of entries[file]??[]){
  assert.equal(source.split(current).length-1,1,'EXACT_APPROVED_WITHDRAWALS_HUNK:'+file);
  source=source.replace(current,legacy);
 }
 return source;
}
