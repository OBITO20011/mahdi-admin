import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// Owner-approved cheque additions only. Rewind exact, single-occurrence hunks
// so all previous whole-AST and payload/validation contracts remain unchanged.
const entries:Record<string,readonly (readonly [string,string])[]>=JSON.parse(readFileSync(
  new URL('./fixtures/approved-cheques195-source.json',import.meta.url),'utf8'));
export const cheques195Files=Object.freeze(Object.keys(entries));
export function approvedCheques195Source(file:string,source:string):string {
  source=source.replaceAll('\r\n','\n');
  for(const [current,legacy] of entries[file]??[]){
    assert.equal(source.split(current).length-1,1,'EXACT_APPROVED_CHEQUES_HUNK:'+file);
    source=source.replace(current,()=>legacy);
  }
  return source;
}
