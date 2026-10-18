import assert from 'node:assert/strict';
import {sourceBeforeUnitTerminology} from '../scripts/audit/source-before-unit-terminology.mjs';
const hunks:Record<string,readonly string[]>={
 'src/features/goLive/GoLiveSetupView.tsx':[
  "import {OpeningChequesCard} from './OpeningChequesCard';\n",
  '        {status && <OpeningChequesCard branchId={status.mainBranchId} locked={locked} onSaved={() => void refresh()} />}\n',
 ],
 'e2e/package-f-go-live-harness.tsx':[
  "import {installOpeningChequeHarness} from './package-f-opening-cheques.fixture';\n",
  'installOpeningChequeHarness(client,state,customers.map(c=>({id:c.id,name:c.full_name,phone:c.phone})),suppliers.map(s=>({id:s.id,name:s.company_name,phone:s.phone})));\n',
 ],
};
export function approvedOpening196Source(file:string,source:string):string{
 source=sourceBeforeUnitTerminology(file,source) ?? source;
 source=source.replaceAll('\r\n','\n');
 for(const hunk of hunks[file]??[]){assert.equal(source.split(hunk).length-1,1,'EXACT_APPROVED_OPENING196_HUNK:'+file);source=source.replace(hunk,'');}
 return source;
}
