import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {financialUiContract} from '../scripts/testing/package-f-financial-ui-contract.mjs';
import {readCustomerStatement,appendCustomerStatementPage} from '../src/utils/customerStatement';
import {customerStatementFixture} from '../e2e/customer-statement.fixture';
import {strictProductLegacySource} from './strict-product-legacy-source';

test('statement adapter validates balance evidence and joins only consistent chronological pages',()=>{
  const first=customerStatementFixture('customer',860500,1),second=customerStatementFixture('customer',860500,2);
  assert.deepEqual(readCustomerStatement(first),first);assert.deepEqual(readCustomerStatement(second),second);
  const joined=appendCustomerStatementPage(first,second);assert.ok(joined);assert.equal(joined.movements.length,28);
  assert.equal(joined.page_opening_balance_in_minor_units,0);assert.equal(joined.closing_balance_in_minor_units,860500);
  for(const bad of [null,{}, {...first,page:0},{...first,page_size:101},{...first,closing_balance_in_minor_units:0},
    {...first,movements:[{...first.movements[0],balance_in_minor_units:999}]},
    {...first,movements:[{...first.movements[0],occurred_at:'invalid'}]},
    {...first,movements:[{...first.movements[0],credit_in_minor_units:'2500'}]},
    {...first,movements:[first.movements[0],first.movements[0]]}])assert.equal(readCustomerStatement(bad),null);
  for(const bad of [{...second,customer_id:'other'},{...second,page:3},{...second,total_count:29},
    {...second,closing_balance_in_minor_units:861000},{...second,page_closing_balance_in_minor_units:0}])
    assert.equal(appendCustomerStatementPage(first,bad),null);
});
test('statement addition leaves every original CRM business/event/value/confirmation AST unchanged',()=>{
  const file='src/features/crm/CustomerDetailView.tsx';
  const before=execFileSync('git',['show',`d75f60932634c7966e45c8ea67f7fad55bd28bee:${file}`],{encoding:'utf8'});
  const after=strictProductLegacySource(file,readFileSync(file,'utf8'));
  assert.equal([...after.matchAll(/<CustomerStatement customerId=\{customer\.id\} revision=\{customer\} \/>/g)].length,1);
  const normalized=after.replace(/<MobileTabSection value="statement"><CustomerStatement customerId=\{customer\.id\} revision=\{customer\} \/><\/MobileTabSection>/g,'');
  assert.deepEqual(financialUiContract(file,normalized),financialUiContract(file,before));
  const service=readFileSync('src/services/supabase/customerStatement.service.ts','utf8');
  assert.equal([...service.matchAll(/supabase\.rpc\(/g)].length,1);assert.match(service,/'get_customer_statement'/);
  assert.match(service,/p_customer_id:customerId,p_page:page,p_page_size:25/);
  assert.doesNotMatch(service,/\.from\(|insert\(|update\(|delete\(/);
});
