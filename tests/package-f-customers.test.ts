import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {readCustomerDebtAging} from '../src/utils/customerDebtAging';

const baseline=[
  {
    "file": "src/features/accounts/AccountsView.tsx",
    "callHash": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
    "changeHash": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
    "calls": 0,
    "changes": 0,
    "handlers": {}
  },
  {
    "file": "src/features/crm/CrmView.tsx",
    "callHash": "c2181cab340b2abd32a0bd18c7b9b9e92c3708f70972d00c6036f98555cf3277",
    "changeHash": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
    "calls": 5,
    "changes": 0,
    "handlers": {
      "loadCustomers": "5bb588cdb83351963355815759ef2d7237ea72ca44cb82a518d05984a7dfb7eb",
      "handleBlock": "dd8fe886f8c4f17d5a4087bddbf8c7b9e17fd306a0231ca0d32a1e48b4251a5a",
      "handleDelete": "7be6c2b97c3969e70c1f7b4596e7c2d33544cd53d350e5c839336d00f1de8145"
    }
  },
  {
    "file": "src/features/crm/CustomerList.tsx",
    "callHash": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
    "changeHash": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
    "calls": 0,
    "changes": 0,
    "handlers": {}
  },
  {
    "file": "src/features/crm/CustomerFilters.tsx",
    "callHash": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
    "changeHash": "e54af68d50a8c71d44f06844e314b565ff947e659a3e41d42006cfcfc2d88efd",
    "calls": 0,
    "changes": 3,
    "handlers": {}
  },
  {
    "file": "src/features/crm/CustomerDetailView.tsx",
    "callHash": "877efc7c81502aa64abe83db9d1b57ddaf2b7d7da6b002538e911a6b4e2fc40d",
    "changeHash": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
    "calls": 5,
    "changes": 0,
    "handlers": {
      "load": "46d4370e855eba556672361ff8e8d7d1bab5b574dcf7899af342d96400f3f17b",
      "loadMoreHistory": "b6de46b32b20f41f80862c1193ae177313b089b0f73cc2779bc25ef5b8256d5d",
      "refresh": "4ecbc1c06a499dd749587d097ff4c95d6e9bea5462aceae994aa971cc1ea228b"
    }
  },
  {
    "file": "src/features/accounts/CustomerBalancesView.tsx",
    "callHash": "8d07ddd38acc1a201cd5bdd0cdd2651dd180378546b8a2b3ce4588dd742d2f7d",
    "changeHash": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
    "calls": 1,
    "changes": 0,
    "handlers": {
      "loadBalances": "5cf26d03ab2bf8a8f6d3b342937b8c7aea15c1f374b279f33fc18cddef36861a"
    }
  },
  {
    "file": "src/features/accounts/RecordCustomerPaymentModal.tsx",
    "callHash": "43bb8b47d6f76553a95c2194edd573d65681d3918834d8a362c3c95310ae68ba",
    "changeHash": "0f9c914d5043aa2f7ef0fe58192e2c068bc778e7404218b2c75c601d7db312ab",
    "calls": 1,
    "changes": 6,
    "handlers": {
      "handleOrderChange": "8dc89e98d0c4b6ceb3b463932bcff8ead85c52f3a536f8e27f730d46160c629b",
      "handleSubmit": "06b200d7697818e9b61abcaf8f48a11cb39470877e8ddc8ac8b17e0b528a6e68"
    }
  }
] as const;
const printer=ts.createPrinter({removeComments:true});
const hash=(value:unknown)=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');

test('Customers existing business calls and financial/load handlers match d70cd575 after hook separation',()=>{
  for(const expected of baseline){
    const ast=ts.createSourceFile(expected.file,readFileSync(expected.file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    const calls:string[]=[],changes:string[]=[],handlers:Record<string,string>={};
    function visit(n:ts.Node){
      if(ts.isAwaitExpression(n)||ts.isCallExpression(n)&&/(?:FromSupabase|Service|\.rpc$|^run[A-Z]|^openModal$)/u.test(n.expression.getText(ast)))calls.push(printer.printNode(ts.EmitHint.Unspecified,n,ast));
      if(ts.isJsxAttribute(n)&&n.name.getText(ast)==='onChange'&&n.initializer)changes.push(printer.printNode(ts.EmitHint.Unspecified,n.initializer,ast));
      if(ts.isVariableDeclaration(n)&&/^handle|^load$|^loadCustomers$|^loadBalances$|^loadMoreHistory$|^refresh$/u.test(n.name.getText(ast))&&n.initializer)handlers[n.name.getText(ast)]=hash(printer.printNode(ts.EmitHint.Unspecified,n.initializer,ast));
      ts.forEachChild(n,visit);
    }
    visit(ast);
    assert.equal(calls.length,expected.calls,expected.file);
    assert.equal(hash(calls.sort()),expected.callHash,expected.file);
    assert.deepEqual(handlers,expected.handlers,expected.file);
    if(expected.file.endsWith('AccountsView.tsx')){
      // Existing directory/balances buttons become the shared segmented control.
      assert.deepEqual(changes,['{setSection}']);
    }else if(!expected.file.endsWith('CustomerFilters.tsx')){
      assert.equal(changes.length,expected.changes,expected.file);
      assert.equal(hash(changes.sort()),expected.changeHash,expected.file);
    }else{
      // Only the approved select-to-chip presentation differs; search/sort retain exact value forwarding.
      assert.deepEqual(changes.sort(),[
        '{(event) => onSearchChange(event.target.value)}',
        '{(event) => onSortByChange(event.target.value as CustomerSortOption)}',
        '{onStatusFilterChange}',
      ].sort());
    }
  }
});

test('aging hooks and segment conversion were literally moved without logic changes',()=>{
  const ast=ts.createSourceFile('useCustomerAccounts.ts',readFileSync('src/hooks/useCustomerAccounts.ts','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  const exported=ast.statements.filter(n=>n.getText(ast).startsWith('export function use')||n.getText(ast).startsWith('export const agingSegments'));
  assert.deepEqual(exported.map(n=>hash(printer.printNode(ts.EmitHint.Unspecified,n,ast))),["fa927b9aa2b6df6acb2cb25f548bef533c8ea97c7bf9f7d84c43fb05b8f994aa","274b5e76cba97b820634a2c423e97b2b4140c9d5e7c4a3fbeea03781d49a4a09","09be152cb3e14a383b7ec200f6ddc8eef5cdc787b2983663a3027cbe2308b879"]);
  assert.doesNotMatch(readFileSync('src/features/crm/CustomerAging.tsx','utf8'),/export (?:function use|const agingSegments)|eslint-disable/u);
});

test('aging read evidence rejects missing/incoherent financial amounts rather than inventing zero or dates',()=>{
  const valid={total_in_minor_units:1000,days_0_7_in_minor_units:400,days_8_30_in_minor_units:200,days_over_30_in_minor_units:300,age_unavailable_in_minor_units:100,oldest_debt_at:null};
  assert.deepEqual(readCustomerDebtAging(valid),valid);
  for(const value of [null,{}, {...valid,total_in_minor_units:999},{...valid,days_0_7_in_minor_units:-1},{...valid,days_8_30_in_minor_units:'200'},{...valid,overdue_customer_count:-1},{...valid,last_payment_at:'not a date'},{...valid,oldest_debt_age_days:1.5}])assert.equal(readCustomerDebtAging(value),null);
  assert.equal(readCustomerDebtAging({...valid,days_over_30_in_minor_units:undefined}),null);
});

test('Customers migrated surfaces use tokens,never fake financial filters or unavailable balances',()=>{
  for(const {file} of baseline)assert.doesNotMatch(readFileSync(file,'utf8'),/(?:bg|text|border)-(?:slate|gray|blue|emerald|rose|amber|indigo|cyan|orange)-\d/u);
  const filters=readFileSync('src/features/crm/CustomerFilters.tsx','utf8');
  assert.doesNotMatch(filters,/عليهم دين|متأخرين|تجاوز الحد|الجملة/u);
  assert.match(readFileSync('src/features/crm/CustomerDetailView.tsx','utf8'),/سجل طلبات المتجر/u);
});
