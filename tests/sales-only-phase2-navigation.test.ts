import assert from 'node:assert/strict';
import test from 'node:test';
import {ADMIN_NAVIGATION_GROUPS,canUseNavigationAction} from '../src/features/more/adminNavigation.config';
import {allowsOperatingDestination,operatingNavigation} from '../src/features/operatingMode/navigationPolicy';
import {disableFullAccountingWithClient} from '../src/services/supabase/operatingModeCommand';

test('full navigation unchanged;lite excludes stock/suppliers/profit assistant but retains all approved money and commercial paths',()=>{
 assert.deepEqual(operatingNavigation(ADMIN_NAVIGATION_GROUPS,'full'),ADMIN_NAVIGATION_GROUPS);
 const lite=operatingNavigation(ADMIN_NAVIGATION_GROUPS,'sales-only').flatMap(g=>g.items);
 for(const id of ['sales-pos','sales-orders','sales-history','customer-accounts','customer-returns','catalog-products','parcel-configuration','finance-shifts','finance-expenses','finance-withdrawals','finance-cheques','finance-reports','admin-go-live','admin-storefront'])assert.ok(lite.some(i=>i.id===id),id);
 for(const id of ['inventory-current','supplier-receiving','inventory-damage','supplier-replacement','admin-assistant'])assert.ok(!lite.some(i=>i.id===id),id);
 for(const destination of ['adjust_stock','receive_goods','warehouse_transfer','stock_count','inventory_opening_setup','supplier_replacement']){
  assert.equal(allowsOperatingDestination('modal',destination,'sales-only'),false);
  assert.equal(allowsOperatingDestination('modal',destination,'full'),true);
 }
 assert.equal(canUseNavigationAction({type:'tab',destination:'purchases'},'view_only'),false);
 assert.equal(canUseNavigationAction({type:'tab',destination:'pos'},'view_only'),false);
 assert.match(lite.find(i=>i.id==='finance-reports')!.description,/دون تكلفة أو أرباح/);
});

test('owner mode command verifies same actor plus AAL2;one OFF RPC,never ON or automatic retry',async()=>{
 for(const scenario of ['ok','aal1','actor-before','actor-after','lost','invalid'] as const){
  let identities=0,writes=0;
  const client={auth:{getUser:async()=>({data:{user:{id:scenario==='actor-before'||scenario==='actor-after'&&++identities===2?'other':'owner'}},error:null}),
   mfa:{getAuthenticatorAssuranceLevel:async()=>({data:{currentLevel:scenario==='aal1'?'aal1':'aal2'},error:null})}},
   rpc:async(name:string,args:unknown)=>{writes++;assert.equal(name,'lite1_set_mode2');assert.deepEqual(args,{p_full:false});if(scenario==='lost')throw Error('PRIVATE TOKEN');return {data:{fullAccounting:scenario==='invalid'},error:null};}};
  if(scenario==='ok')await disableFullAccountingWithClient(client,'owner');
  else await assert.rejects(disableFullAccountingWithClient(client,'owner'));
  assert.equal(writes,['ok','lost','invalid'].includes(scenario)?1:0);
 }
});
