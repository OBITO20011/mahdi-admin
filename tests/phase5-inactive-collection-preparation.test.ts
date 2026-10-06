import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, readdirSync} from 'node:fs';
import {StringDecoder} from 'node:string_decoder';
import test from 'node:test';
import {functionEvents} from '../scripts/analysis/build-phase5-authority-ledger.mjs';

const read = (file: string) => readFileSync(file,'utf8').replace(/\r\n?/gu,'\n');
const migration = read('supabase/migrations/128_phase5_inactive_collection_preparation.sql');
const hash = (text: string | Buffer) => createHash('sha256').update(text).digest('hex').toUpperCase();
const state = JSON.parse(read('docs/agent/project-state.json'));
const task = JSON.parse(read('docs/agent/ACTIVE_TASK.json'));
// The new catalog reader is independently covered below. Its CHECK/FK strings
// contain ON DELETE metadata, not executable DML in the earlier discovery set.
const shiftDiscoveryEnd=migration.indexOf('-- Owner-approved source-resource overlay:');
// Retained pure-layer assertions must not scan the separately verified additive
// lock-acquisition layer. Prefix hashing below pins all prior SQL byte content.
const completionLockUnionStart=migration.indexOf('-- Complete source-qualified lock union preparation.');
// Earlier inquiry-only modules end before the independently tested acquiring
// receipt module. Its entire prior byte prefix is pinned in a separate test.
const receivingPrewriteStart=migration.indexOf('-- Receipt prewrite admission:');
const productCreationPrewriteStart=migration.indexOf('-- Whole-family prewrite allocation ONLY:');
const receivingFutureStart=migration.indexOf('-- Receipt future identities:');
const productAncillaryStart=migration.indexOf('-- Product ancillary future identities:');
const receiptV2AllocationStart=migration.indexOf('-- Modern Receipt V2 allocation discovery ONLY:');
const receiptV2PrewriteStart=migration.indexOf('-- Modern Receipt V2 header/resource discovery ONLY:');
const receiptV2IdentityStart=migration.indexOf('-- Modern Receipt V2 identity requirements ONLY:');
const receiptV2UuidStart=migration.indexOf('-- Modern Receipt V2 future UUID allocation ONLY:');
const receiptV2BalanceStart=migration.indexOf('-- Receipt V2 balance row projections ONLY;');
const receiptV2InventoryStart=migration.indexOf('-- Receipt V2 inventory/WAC explicit row projections ONLY;');
const receiptV2FinancialStart=migration.indexOf('-- Receipt V2 header/financial explicit projections ONLY;');
const receiptV2ItemStart=migration.indexOf('-- Receipt V2 commercial line/item explicit projections ONLY;');
const receiptV2StockCandidateStart=migration.indexOf('-- Receipt-specific alert/outbox candidates.');
const receiptV2StockResourceStart=migration.indexOf('-- Receipt V2 conditional resource union ONLY.');

test('Receipt V2 stock candidate preparation preserves the entire approved predecessor and private authority barriers',()=>{
  assert.ok(receiptV2StockCandidateStart>receiptV2ItemStart);
  assert.equal(hash(migration.slice(0,receiptV2StockCandidateStart)+'COMMIT;\n'),
    '5842A52768F8D7E6F56DA9B990EF69B733D0DAAF2F897C966C5148B1CB9ABCD6');
  const body=migration.slice(receiptV2StockCandidateStart,receiptV2StockResourceStart);
  for(const marker of ['derive_receipt_v2_item_rows_v1','transaction_timestamp()',
    'gen_random_uuid()','PHASE5_RECEIPT_V2_STOCK_DEFAULT_DRIFT','PHASE5_RECEIPT_V2_STOCK_SLOT_SET_INVALID',
    'PHASE5_RECEIPT_V2_STOCK_UNUSED_IDENTITY','PHASE5_RECEIPT_V2_STOCK_UUID_COLLISION_RETRY',
    'WHERE e.event_key=planned_key','REUSE_PREEXISTING',
    "'afterWaitRevalidated',FALSE","'durableIdentityClaimed',FALSE","'absencePredicatesFenced',FALSE",
    "'locksHeld',FALSE","'executionAuthority',FALSE"])assert.ok(body.includes(marker),marker);
  assert.doesNotMatch(body,/\b(?:INSERT INTO|UPDATE|DELETE FROM|TRUNCATE) public\.|pg_advisory|FOR UPDATE|FOR SHARE|SECURITY DEFINER|NEXTVAL/iu);
  assert.equal((body.match(/CREATE FUNCTION phase5_private\./gu)??[]).length,3);
  assert.equal((body.match(/FROM PUBLIC,anon,authenticated,service_role/gu)??[]).length,3);
  const runtime=read('scripts/testing/run-phase5-inactive-collection-preparation-runtime.mjs');
  for(const marker of ['qa_receipt_stock_candidates','QA_STOCK_FORGERY_ACCEPTED','QA_STOCK_UUID_RECHECK_ACCEPTED',
    'QA_STOCK_KEY_RECHECK_ACCEPTED','resolveReceiptV2StockCandidateRequirements',
    'whole request/resource/payment union retained'])assert.ok(runtime.includes(marker),marker);
});

test('Receipt V2 DB stock resource union preserves predecessor and cannot certify held ownership',()=>{
  assert.ok(receiptV2StockResourceStart>receiptV2StockCandidateStart);
  assert.equal(hash(migration.slice(0,receiptV2StockResourceStart)+'COMMIT;\n'),
    '30CE48D1F5BE5B6F3D8EB93E67388A9DD47C9DC15C119BC31904103D6182DE36');
  const body=migration.slice(receiptV2StockResourceStart);
  assert.equal((body.match(/CREATE FUNCTION phase5_private\./gu)??[]).length,2);
  assert.equal((body.match(/FROM PUBLIC,anon,authenticated,service_role/gu)??[]).length,2);
  for(const marker of ['derive_receipt_v2_stock_candidates_v1','REUSE_PREEXISTING',
    'PHASE5_RECEIPT_V2_STOCK_RESOURCE_SOURCE_CHANGED_RETRY','PHASE5_RECEIPT_V2_STOCK_RESOURCE_CONTENT_CHANGED_RETRY',
    'FRESH_EXACT_KEY_ABSENCE_REVALIDATION_AND_EXCLUSION_FENCE',"'owned',FALSE",
    "'afterWaitRevalidated',FALSE","'locksHeld',FALSE","'executionAuthority',FALSE"])
    assert.ok(body.includes(marker),marker);
  assert.doesNotMatch(body,/\b(?:INSERT INTO|UPDATE|DELETE FROM|TRUNCATE) public\.|pg_advisory|FOR UPDATE|FOR SHARE|SECURITY DEFINER|NEXTVAL/iu);
  const runtime=read('scripts/testing/run-phase5-inactive-collection-preparation-runtime.mjs');
  for(const marker of ['qa_receipt_stock_resource_union','receiptV2MultiSourceRuntime','QA_RESOURCE_FORGERY_ACCEPTED',
    'per-client/component public item identity','global unrelated key owner'])assert.ok(runtime.includes(marker),marker);
});

// These source traces do not grant runtime admission or execution authority.
const branchSection=read('docs/agent/evidence/phase5-slice5/PREPARATION_CHECKPOINT.md')
  .split('<!-- phase5-parent-branch-source-contract:start -->')[1]
  .split('<!-- phase5-parent-branch-source-contract:end -->')[0];
const branchContract=JSON.parse(branchSection.slice(branchSection.indexOf('{'),branchSection.lastIndexOf('}')+1));
const branchContractHash='06E77C6F3B1B9919BAC1ECDB4D1A0D77F6FF31A8357AB49EE59F66AFEB538FB6';
const historicalBranches=functionEvents(readdirSync('supabase/migrations')
  .filter(n=>/^\d{3}_/u.test(n)&&Number(n.slice(0,3))<=127).sort()
  .map(filename=>({filename,source:read('supabase/migrations/'+filename)}))).state;
const branchSource=(name:string)=>{
  const matches=[...historicalBranches].filter(([s])=>s.split('(')[0]==='public.'+name);
  assert.equal(matches.length,1,name);return matches[0][1];
};
const beforeSource=(body:string,earlier:string,later:string)=>{
  const a=body.indexOf(earlier),b=body.indexOf(later);
  assert.ok(a>=0,earlier);assert.ok(b>a,earlier+' must precede '+later);
};
// Literal discovery only; escaped/dynamic/unqualified/default/trigger paths
// remain OPEN. This scanner cannot certify the complete writer/invoker set.
const maskBranchSql=(text:string)=>{
  const chars=text.split('');let i=0;
  const erase=(a:number,b:number)=>{for(let k=a;k<b;k++)if(chars[k]!=='\n')chars[k]=' ';};
  while(i<text.length){
    if(text.slice(i,i+2)==='--'){const a=i;i=text.indexOf('\n',i);if(i<0)i=text.length;erase(a,i);}
    else if(text.slice(i,i+2)==='/*'){
      const a=i;let depth=1;i+=2;
      while(i<text.length&&depth){
        if(text.slice(i,i+2)==='/*'){depth++;i+=2;}
        else if(text.slice(i,i+2)==='*/'){depth--;i+=2;}
        else i++;
      }erase(a,i);
    }else if(text[i]==="'"){
      const a=i++;while(i<text.length){
        if(text[i]==="'"){if(text[i+1]==="'"){i+=2;continue;}i++;break;}i++;
      }erase(a,i);
    }else if(text[i]==='$'){
      const m=text.slice(i).match(/^\$(?:[a-zA-Z_][a-zA-Z0-9_]*)?\$/u);
      if(m){const a=i,tag=m[0],end=text.indexOf(tag,i+tag.length);i=end<0?text.length:end+tag.length;erase(a,i);}
      else i++;
    }else i++;
  }return chars.join('');
};

test('Receipt V2 runtime independently covers installed primary columns and live default/trigger obligations',()=>{
  const runtime=read('scripts/testing/run-phase5-inactive-collection-preparation-runtime.mjs');
  const start=runtime.indexOf('const receiptV2PrewriteRuntime =');
  const end=runtime.indexOf('const receiptV2AllocationRuntime =',start);
  const body=runtime.slice(start,end>start?end:undefined);
  assert.match(body,/a\.attnum>0 AND NOT a\.attisdropped/u);
  assert.match(body,/LEFT JOIN pg_attrdef/u);
  assert.match(body,/a\.attidentity/u);assert.match(body,/a\.attgenerated/u);
  assert.match(body,/\['available_quantity','integer','s','\(on_hand_quantity - reserved_quantity\)'\]/u);
  assert.match(body,/t\.tgenabled/u);assert.match(body,/t\.tgisinternal/u);
  assert.match(body,/p\.prosrc/u);assert.match(body,/p\.prosecdef/u);
  assert.match(body,/independently complete installed default capture/u);
  assert.match(body,/trg_assign_inventory_movement_mutation_sequence/u);
  assert.match(body,/trg_sync_stock_alert_from_balance/u);
  assert.match(body,/trg_supplier_payment_open_shift/u);
  assert.match(body,/assert\.equal\(await fingerprint\(\),baseline\)/u);
});

test('three-family transitive source contract rejects drift and never self-qualifies execution',()=>{
  assert.equal(hash(JSON.stringify(branchContract)),branchContractHash);
  assert.equal(branchContract.scope,'THREE_FAMILY_SOURCE_BRANCH_TRACE_NOT_RUNTIME_ADMISSION');
  assert.equal(branchContract.sourceCeiling,127);assert.equal(branchContract.anchors.length,17);
  assert.equal(new Set(branchContract.anchors.map((a:{signature:string})=>a.signature)).size,17);
  assert.deepEqual(branchContract.enforcementFlags,{
    sourceTraceReviewed:true,runtimeAdmissionProven:false,firstBusinessWriteQualified:false,
    earlyGateQualified:false,allowedInvokerClosure:false,completeWriterLedger:false,executionAuthority:false,
  });
  for(const a of branchContract.anchors){
    const actual=historicalBranches.get(a.signature);assert.ok(actual,a.signature);
    assert.equal(hash(actual.body),a.bodySha256,a.signature);
    assert.equal(actual.sourceMigration,a.source);assert.deepEqual(actual.acl,a.acl);
    assert.equal(actual.securityMode,a.securityMode);assert.equal(actual.searchPath,a.searchPath);
  }
  const changes=[
    (c:typeof branchContract)=>{c.anchors.pop();},
    (c:typeof branchContract)=>{c.anchors.push({...c.anchors[0]});},
    (c:typeof branchContract)=>{c.anchors[0].signature=c.anchors[1].signature;},
    (c:typeof branchContract)=>{c.qualifiedLiteralCallerEdges[0].bodyLine++;},
    (c:typeof branchContract)=>{c.enforcementFlags.executionAuthority=true;},
    (c:typeof branchContract)=>{c.enforcementFlags.allowedInvokerClosure=true;},
    (c:typeof branchContract)=>{c.readMarks.compositeIdentity=['stock_alert_id'];},
  ];
  for(const change of changes){
    const altered=structuredClone(branchContract);change(altered);
    assert.notEqual(hash(JSON.stringify(altered)),branchContractHash);
  }
  const names=['mark_stock_alert_read','mark_all_stock_alerts_read','receive_purchase_order',
    '_receive_purchase_order_impl','create_product_with_opening_stock','_create_product_with_opening_stock_impl',
    'create_product_with_opening_stock_v2','create_product_with_opening_stock_v3','create_product_with_opening_stock_v4',
    'create_product_family_with_flavors_v1','create_product_flavor_v1','update_product_flavor_v1',
    'sync_product_flavor_commercial_settings'];
  const edges=[];
  for(const [caller,source]of historicalBranches){
    const masked=maskBranchSql(source.body||'');
    for(const name of names){
      const targets=[...historicalBranches.keys()].filter(s=>s.split('(')[0]==='public.'+name);
      assert.equal(targets.length,1,name);
      for(const m of masked.matchAll(new RegExp('\\bpublic\\.'+name+'\\s*\\(','gu'))){
        edges.push({caller,target:targets[0],bodyLine:source.body.slice(0,m.index).split('\n').length});
      }
    }
  }
  edges.sort((a,b)=>a.caller<b.caller?-1:a.caller>b.caller?1:a.bodyLine-b.bodyLine);
  assert.deepEqual(edges,branchContract.qualifiedLiteralCallerEdges);assert.equal(edges.length,8);
  const canary='-- public.receive_purchase_order()\nSELECT \'public.receive_purchase_order()\';\n'
    +'/* outer /* public.receive_purchase_order() */ */\nSELECT $$public.receive_purchase_order()$$;';
  assert.doesNotMatch(maskBranchSql(canary),/public\.receive_purchase_order/u);
  const real='-- ignored\nPERFORM public.receive_purchase_order(1);';
  assert.equal(maskBranchSql(real).indexOf('public.receive_purchase_order'),real.indexOf('public.receive_purchase_order'));
  assert.equal(names.includes('stock_alert_reads'),false);
});

test('read-mark source branches preserve composite actor identity and empty/resolved semantics',()=>{
  const roles=['owner','admin','manager','accountant','sales','warehouse_keeper','delivery_driver'];
  assert.deepEqual(branchContract.readMarks.roles,roles);
  assert.deepEqual(branchContract.readMarks.compositeIdentity,['stock_alert_id','auth.uid()']);
  for(const name of ['mark_stock_alert_read','mark_all_stock_alerts_read']){
    const source=branchSource(name),body=source.body;
    const declared=[...body.slice(body.indexOf('ARRAY['),body.indexOf('],')).matchAll(/'([^']+)'/gu)].map(m=>m[1]);
    assert.deepEqual(declared,roles,name);
    beforeSource(body,'public.assert_erp_role','INSERT INTO public.stock_alert_reads');
    assert.match(body,/v_user_id UUID := auth\.uid\(\)/u);
    assert.match(body,/ON CONFLICT \(stock_alert_id, user_id\)\s+DO UPDATE SET read_at = EXCLUDED\.read_at/u);
    assert.doesNotMatch(maskBranchSql(body),/pg_advisory|phase2_lock|FOR UPDATE/u);
    assert.deepEqual(source.acl,{public:false,anon:false,authenticated:true,service_role:false});
  }
  const single=branchSource('mark_stock_alert_read').body,bulk=branchSource('mark_all_stock_alerts_read').body;
  assert.match(single,/WHERE id = p_stock_alert_id/u);assert.doesNotMatch(single,/status = 'active'/u);
  assert.match(bulk,/SELECT id, v_user_id, NOW\(\)\s+FROM public\.stock_alerts\s+WHERE status = 'active'/u);
  assert.doesNotMatch(bulk,/IF NOT FOUND|jsonb_array_length|PHASE2_PRODUCT_LOCK_SET_EMPTY/u);
  assert.match(bulk,/GET DIAGNOSTICS v_count = ROW_COUNT/u);assert.match(bulk,/'updatedCount', v_count/u);
  const schema=read('supabase/migrations/014_simple_inventory_operations.sql');
  const reads=schema.split('CREATE TABLE IF NOT EXISTS public.stock_alert_reads (')[1].split(');')[0];
  assert.match(reads,/REFERENCES public\.stock_alerts\(id\) ON DELETE CASCADE/u);
  assert.match(reads,/REFERENCES public\.profiles\(id\) ON DELETE CASCADE/u);
  assert.match(reads,/PRIMARY KEY \(stock_alert_id, user_id\)/u);
  assert.match(schema,/IF v_existing_severity IS DISTINCT FROM v_severity THEN\s+DELETE FROM public\.stock_alert_reads\s+WHERE stock_alert_id = v_existing_id/u);
  const actor=branchSource('assert_erp_role').body,mfa=branchSource('is_mfa_policy_satisfied').body;
  beforeSource(actor,'public.is_mfa_policy_satisfied()','JOIN public.user_roles');
  assert.match(actor,/p\.is_active = true/u);assert.match(actor,/r\.code = ANY\(p_allowed_roles\)/u);
  assert.match(mfa,/FROM auth\.mfa_factors/u);assert.match(mfa,/auth\.jwt\(\)/u);
  assert.doesNotMatch(maskBranchSql(actor+mfa),/\bINSERT\b|\bUPDATE\b|\bDELETE\b|FOR UPDATE|pg_advisory/u);
});

test('receiving first transitive source write is the delegate receipt, not wrapper WAC update',()=>{
  const wrapper=branchSource('receive_purchase_order').body,delegate=branchSource('_receive_purchase_order_impl');
  beforeSource(wrapper,'public.assert_erp_role','public.phase2_lock_inventory_products_internal');
  beforeSource(wrapper,'PHASE2_LEGACY_COST_REQUIRED','public.phase2_lock_inventory_products_internal');
  beforeSource(wrapper,'PHASE2_LEGACY_COST_INVALID','public.phase2_lock_inventory_products_internal');
  beforeSource(wrapper,'SELECT DISTINCT po_item.product_id','public.phase2_lock_inventory_products_internal');
  beforeSource(wrapper,'public.phase2_lock_inventory_products_internal','public._receive_purchase_order_impl');
  beforeSource(wrapper,'public._receive_purchase_order_impl','UPDATE public.products');
  assert.match(wrapper,/po_item\.id = \(item->>'purchase_order_item_id'\)::UUID\s+AND po_item\.purchase_order_id = p_purchase_order_id/u);
  assert.match(wrapper,/PERFORM \(item->>'product_id'\)::UUID/u);
  assert.doesNotMatch(wrapper,/SELECT DISTINCT \(item->>'product_id'\)/u);
  beforeSource(delegate.body,'FROM public.purchase_orders','INSERT INTO public.purchase_receipts');
  beforeSource(delegate.body,'INSERT INTO public.purchase_receipts','FROM public.purchase_order_items');
  beforeSource(delegate.body,'IF v_recv_qty <= 0 THEN','FROM public.purchase_order_items');
  assert.match(delegate.body,/v_po_item\.product_id/u);
  assert.doesNotMatch(maskBranchSql(delegate.body),/public\.assert_erp_role|phase2_lock_inventory/u);
  assert.deepEqual(delegate.acl,{public:false,anon:false,authenticated:false,service_role:false});
  const kernel=branchSource('phase2_lock_inventory_products_internal').body;
  beforeSource(kernel,"'inventory-product:'",'PERFORM balance.id');
  beforeSource(kernel,'PERFORM balance.id','PERFORM product.id');
  assert.match(kernel,/ORDER BY product_id/u);assert.match(kernel,/FOR NO KEY UPDATE/u);
  assert.match(kernel,/PHASE2_PRODUCT_NOT_FOUND/u);
  assert.equal(branchContract.enforcementFlags.earlyGateQualified,false);
  assert.equal(branchContract.enforcementFlags.allowedInvokerClosure,false);
});

test('product wrapper/family source branches expose generated identity before admission',()=>{
  const base=branchSource('create_product_with_opening_stock').body;
  beforeSource(base,'public.assert_erp_role','public._create_product_with_opening_stock_impl');
  const impl=branchSource('_create_product_with_opening_stock_impl').body;
  beforeSource(impl,'INSERT INTO public.products','RETURNING id INTO v_product_id');
  beforeSource(impl,'RETURNING id INTO v_product_id','INSERT INTO public.inventory_balances');
  assert.match(impl,/v_product_id UUID;/u);assert.doesNotMatch(impl,/v_product_id UUID :=/u);
  assert.match(read('supabase/migrations/001_initial_schema.sql'),/CREATE TABLE IF NOT EXISTS public\.products \(\s+id UUID PRIMARY KEY DEFAULT gen_random_uuid\(\)/u);
  const v2=branchSource('create_product_with_opening_stock_v2').body;
  beforeSource(v2,'public.create_product_with_opening_stock(','UPDATE public.products');
  const v3=branchSource('create_product_with_opening_stock_v3').body;
  beforeSource(v3,'public.create_product_with_opening_stock_v2','IF v_image_url IS NOT NULL THEN');
  beforeSource(v3,'IF v_image_url IS NOT NULL THEN','public.set_product_primary_image');
  beforeSource(branchSource('set_product_primary_image').body,'FROM public.products','UPDATE public.product_images');
  const v4=branchSource('create_product_with_opening_stock_v4').body;
  beforeSource(v4,'IF COALESCE(p_opening_quantity, 0) <> 0 THEN','public.create_product_with_opening_stock_v3');
  assert.match(v4,/p_max_stock_level, p_warehouse_id, 0, p_notes, p_image_url/u);
  const flavor=branchSource('create_product_flavor_v1').body;
  beforeSource(flavor,'FOR UPDATE;','public.create_product_with_opening_stock_v4');
  beforeSource(flavor,'public.create_product_with_opening_stock_v4','UPDATE public.products');
  const family=branchSource('create_product_family_with_flavors_v1').body;
  beforeSource(family,'public.create_product_with_opening_stock_v4','FOR v_flavor IN');
  beforeSource(family,'FOR v_flavor IN','public.create_product_flavor_v1');
  assert.equal(branchContract.creation.firstTransitiveWrite,'INSERT INTO public.products');
  assert.equal(branchContract.enforcementFlags.firstBusinessWriteQualified,false);
  assert.equal(branchContract.enforcementFlags.runtimeAdmissionProven,false);
});

test('private read-mark resource plan preserves its entire predecessor and remains inquiry-only',()=>{
  const start=migration.indexOf('-- Read-mark resource discovery/revalidation ONLY.');assert.ok(start>0);
  assert.equal(hash(migration.slice(0,start)+'COMMIT;\n'),'432DDD975555564DB13B868EFDE6DA0D8ABAD7F9F9ED819628A90668AD2C112D');
  const body=migration.slice(start,migration.indexOf('-- Receipt prewrite admission:'));
  for(const name of ['discover_read_mark_resources_v1','assert_read_mark_resources_v1']){
    assert.match(body,new RegExp(`CREATE FUNCTION phase5_private\\.${name}\\(`,'u'));
  }
  assert.equal((body.match(/VOLATILE SECURITY INVOKER SET search_path = pg_catalog/gu)??[]).length,2);
  assert.doesNotMatch(body,/INSERT INTO|UPDATE public\.|DELETE FROM|FOR UPDATE|pg_advisory|SECURITY DEFINER|\bset_config\b/u);
  for(const f of ['firstBusinessWriteQualified','earlyGateQualified','allowedInvokerClosure','completeWriterLedger',
    'writerClosed','absencePredicatesFenced','locksHeld','heldContextAuthority','executionAuthority'])
    assert.ok(body.includes(`'${f}',FALSE`),f);
  for(const sig of ['discover_read_mark_resources_v1(TEXT,UUID)','assert_read_mark_resources_v1(TEXT,UUID,JSONB)'])
    assert.ok(body.includes(`REVOKE ALL ON FUNCTION phase5_private.${sig} FROM PUBLIC,anon,authenticated,service_role;`));
});

test('receipt prewrite boundary is additive, private, exact and never an execution permit',()=>{
  const start=migration.indexOf('-- Receipt prewrite admission:');assert.ok(start>0);
  assert.equal(hash(migration.slice(0,start)+'COMMIT;\n'),'DBC24BFA98BDFB5BC1410219D6B292DAC91FF9268B9910923A962DBA40641C51');
  const body=migration.slice(start,productCreationPrewriteStart);
  assert.equal((body.match(/VOLATILE SECURITY INVOKER SET search_path = pg_catalog/gu)??[]).length,3);
  assert.doesNotMatch(body,/INSERT INTO|UPDATE public\.|DELETE FROM|SECURITY DEFINER|\bset_config\b/u);
  for(const name of ['discover_receiving_prewrite_v1','assert_receiving_prewrite_v1','acquire_receiving_prewrite_v1'])
    assert.match(body,new RegExp(`REVOKE ALL ON FUNCTION phase5_private\\.${name}\\([^;]+FROM PUBLIC,anon,authenticated,service_role;`,'u'));
  for(const flag of ['futureIdentityClaimed','numberClaimed','defaultsQualified','allowedInvokerClosure','absencePredicatesFenced',
    'writerClosed','heldContextAuthority','executionAuthority'])assert.ok(body.includes(`'${flag}',FALSE`),flag);
});

test('receipt source union and acquisition preserve independent PO authority and revalidate after waits',()=>{
  const body=migration.slice(migration.indexOf('-- Receipt prewrite admission:'),productCreationPrewriteStart);
  beforeSource(body,'PERFORM public.assert_erp_role','SELECT * INTO po');
  assert.match(body,/WHERE id=\(item->>'purchase_order_item_id'\)::UUID AND purchase_order_id=order_identity/u);
  assert.match(body,/FOR item IN SELECT value FROM JSONB_ARRAY_ELEMENTS\(items\)/u);
  assert.match(body,/SUM\(\(n->>'quantity'\)::BIGINT\)/u);
  assert.match(body,/public\.inventory_balances t WHERE product_id=ANY\(product_ids\)/u);
  assert.match(body,/public\.purchase_order_items t WHERE purchase_order_id=order_identity/u);
  assert.match(body,/p\.id=keys\.product_identity/u);
  assert.match(body,/b\.product_id=keys\.product_identity/u);
  assert.doesNotMatch(body,/p\.id=id|b\.product_id=id/u);
  assert.match(body,/SELECT 'public\.purchase_orders',TO_JSONB\(po\),'UPDATE',5/u);
  for(const table of ['stock_alert_reads','automation_events','suppliers','profiles','warehouses','roles','user_roles'])
    assert.ok(body.includes('public.'+table),table);
  const acquire=body.slice(body.indexOf('CREATE FUNCTION phase5_private.acquire_receiving_prewrite_v1'));
  beforeSource(acquire,'PHASE5_RECEIVING_LATE_ENTRY_RETRY','pg_advisory_xact_lock');
  beforeSource(acquire,'pg_advisory_xact_lock','FOR UPDATE NOWAIT');
  beforeSource(acquire,'FOR UPDATE NOWAIT','PERFORM phase5_private.assert_receiving_prewrite_v1');
  assert.ok(acquire.includes('PHASE5_RECEIVING_CONTENTION_RETRY'));
  assert.ok(acquire.includes("'inventoryGates'"));
  const runtime=read('scripts/testing/run-phase5-inactive-collection-preparation-runtime.mjs');
  for(const marker of ['--receiving-prewrite-focused','receivingPrewriteRuntime','S5-RECEIVING-PREWRITE-WAITER',
    "wait_event='advisory'",'must observe actual second-session advisory wait','PHASE5_RECEIVING_PREWRITE_CHANGED_RETRY'])
    assert.ok(runtime.includes(marker),marker);
});

test('whole-family allocation preserves the entire receipt predecessor and private non-authority boundary',()=>{
  assert.ok(productCreationPrewriteStart>receivingPrewriteStart);
  assert.equal(hash(migration.slice(0,productCreationPrewriteStart)+'COMMIT;\n'),'969155D04ED3FB10D1650D9A1A39649FE5F20A21EEFC8A12891165AC92A0E988');
  const body=migration.slice(productCreationPrewriteStart,receivingFutureStart);
  assert.equal((body.match(/VOLATILE SECURITY INVOKER SET search_path = pg_catalog/gu)??[]).length,4);
  assert.doesNotMatch(body,/INSERT INTO|UPDATE public\.|DELETE FROM|SECURITY DEFINER|\bset_config\b/u);
  for(const name of ['assert_product_creation_actor_v1','discover_product_creation_prewrite_v1','assert_product_creation_prewrite_v1',
    'allocate_and_acquire_product_prewrite_v1'])
    assert.match(body,new RegExp(`REVOKE ALL ON FUNCTION phase5_private\\.${name}\\([^;]+FROM PUBLIC,anon,authenticated,service_role;`,'u'));
  for(const field of ['durableIdentityClaimed','defaultsQualified','allowedInvokerClosure','absencePredicatesFenced',
    'writerClosed','heldContextAuthority','executionAuthority'])assert.ok(body.includes(`'${field}',FALSE`));
});

test('server mints all product identities before gates and validates entire union after row acquisition',()=>{
  const body=migration.slice(productCreationPrewriteStart,receivingFutureStart);
  const acquire=body.slice(body.indexOf('CREATE FUNCTION phase5_private.allocate_and_acquire_product_prewrite_v1'));
  beforeSource(acquire,'PERFORM phase5_private.assert_product_creation_actor_v1','gen_random_uuid()');
  beforeSource(acquire,'gen_random_uuid()','plan:=phase5_private.discover_product_creation_prewrite_v1');
  beforeSource(acquire,'plan:=phase5_private.discover_product_creation_prewrite_v1','pg_advisory_xact_lock');
  beforeSource(acquire,'pg_advisory_xact_lock','FOR NO KEY UPDATE NOWAIT');
  beforeSource(acquire,'FOR NO KEY UPDATE NOWAIT','PERFORM phase5_private.assert_product_creation_prewrite_v1');
  assert.doesNotMatch(acquire.slice(acquire.indexOf('pg_advisory_xact_lock')),/gen_random_uuid\(\)|clock_timestamp\(\)/u);
  assert.doesNotMatch(acquire,/\bi INTEGER/u); // integer FOR declares its own variable; no lint shadowing
  assert.match(acquire,/\(kind TEXT,request JSONB\)/u); // no caller-provided allocation
  for(const marker of ['inventory-product:','product_identifier:','flavor_master_product_id=root_id','product_images',
    'activeWarehouseSelection','existingMovements','sort_start+ordinal*10','PHASE5_PRODUCT_V4_OPENING_STOCK_FORBIDDEN'])
    assert.ok(body.includes(marker),marker);
  assert.match(body,/sku:=UPPER\(LEFT\(root->>'sku',42\)\|\|'-F-'\|\|SUBSTRING\(MD5\(flavor_name\|\|\(a->>'skuClockText'\)\),1,8\)\)/u);
  assert.match(body,/LOWER\(NULLIF\(BTRIM\(p\.barcode\),''\)\)=ANY\(keys\)/u);
  assert.match(body,/COUNT\(DISTINCT x\) FROM UNNEST\(ids\)/u);
  assert.match(body,/GROUP BY key HAVING COUNT\(DISTINCT identity\)>1/u);
  assert.match(body,/LOWER\(BTRIM\(p\.sku\)\) FROM public\.products p WHERE p\.id=ANY\(ids\)/u);
  assert.match(body,/LOWER\(BTRIM\(p\.barcode\)\) FROM public\.products p WHERE p\.id=ANY\(ids\)/u);
});

test('creation runtime requires real gate acquisition, independent anchors and observed after-wait drift rejection',()=>{
  const runtime=read('scripts/testing/run-phase5-inactive-collection-preparation-runtime.mjs');
  const section=runtime.slice(runtime.indexOf('const productCreationPrewriteRuntime'),runtime.indexOf('const readMarkResourcesRuntime'));
  for(const marker of ['--product-creation-prewrite-focused','S5-PRODUCT-PREWRITE-WAITER-','productCreationPrewriteRuntime'])
    assert.ok(runtime.includes(marker));
  for(const marker of ["wait_event='advisory'",'allGatesHeld','futureRows','creationFingerprint','private.assert_product_creation_prewrite_v1',
    'private.allocate_and_acquire_product_prewrite_v1','public.create_product_family_with_flavors_v1',"createHash('md5')",
    "['anon','authenticated','service_role']",'PHASE5_PRODUCT_ACTOR_CONTRACT_INVALID','PHASE5_PRODUCT_IDENTIFIER_CONFLICT'])
    assert.ok(section.includes(marker),marker);
  assert.doesNotMatch(section,/\.skip\(|setTimeout\(resolve,\s*(?:10000|60000)|statement_timeout|SET session_replication_role/u);
});

test('receiving identity preparation preserves all prior SQL and cannot mint execution authority',()=>{
  assert.ok(receivingFutureStart>productCreationPrewriteStart);
  assert.equal(hash(migration.slice(0,receivingFutureStart)+'COMMIT;\n'),'670D4ACBAFC38A166E51931A9407D7979A1C935B4106DF1AE4B45A7EC93B89AD');
  const body=migration.slice(receivingFutureStart,productAncillaryStart);
  assert.equal((body.match(/VOLATILE SECURITY INVOKER SET search_path = pg_catalog/gu)??[]).length,3);
  assert.doesNotMatch(body,/INSERT INTO|UPDATE public\.|DELETE FROM|SECURITY DEFINER|pg_advisory|FOR UPDATE|FOR SHARE|NEXTVAL|set_config/u);
  for(const name of ['derive_receiving_future_identities_v1','assert_receiving_future_identities_v1','allocate_receiving_future_identities_v1'])
    assert.match(body,new RegExp(`REVOKE ALL ON FUNCTION phase5_private\\.${name}\\([^;]+FROM PUBLIC,anon,authenticated,service_role;`,'u'));
  for(const flag of ['durableIdentityClaimed','numberClaimed','defaultsQualified','fullWriteTuples',
    'stockEffectIdentitiesComplete','absencePredicatesFenced','heldContextAuthority','executionAuthority'])assert.ok(body.includes(`'${flag}',FALSE`));
});

test('receipt future identities are per positive ordered source occurrence, not aggregate substitution',()=>{
  const body=migration.slice(receivingFutureStart,productAncillaryStart);
  assert.match(body,/ids->'ordinal' IS DISTINCT FROM line->'ordinal'/u);
  assert.match(body,/line->'source'->'id'/u);
  assert.match(body,/line->'source'->'product_id'/u);
  assert.match(body,/actual_products IS DISTINCT FROM wanted_products/u);
  assert.match(body,/r\.receipt_number=number_value/u);
  assert.doesNotMatch(body,/r\.receipt_number=receipt_number/u);
  assert.match(body,/CARDINALITY\(all_ids\)<>CARDINALITY\(seen\)/u);
  assert.match(body,/n->>'id'=ANY\(SELECT id::TEXT FROM UNNEST\(all_ids\)/u);
  const allocator=body.slice(body.indexOf('CREATE FUNCTION phase5_private.allocate_receiving_future_identities_v1'));
  beforeSource(allocator,'plan:=phase5_private.discover_receiving_prewrite_v1','gen_random_uuid()');
  assert.match(allocator,/1000\+RANDOM\(\)\*9000/u);
  assert.doesNotMatch(allocator,/expected JSONB|allocation JSONB\s*\)\s*RETURNS/u);
  const runtime=read('scripts/testing/run-phase5-inactive-collection-preparation-runtime.mjs');
  for(const marker of ['--receiving-future-identities-focused','receivingFutureIdentitiesRuntime','positive-occurrence-bijection',
    'missing-balance-owned-identity','zero-write-future-allocation','receipt-number-conflict','duplicate-masks-missing-receipt-identity'])
    assert.ok(runtime.includes(marker),marker);
});

test('product ancillary identities preserve all earlier SQL and never imply held execution',()=>{
  assert.ok(productAncillaryStart>receivingFutureStart);
  assert.equal(hash(migration.slice(0,productAncillaryStart)+'COMMIT;\n'),'A96F7CE69062341CC480C1682AF9A1EA96EA38409863933F0F6921D500A72BB1');
  const body=migration.slice(productAncillaryStart,receiptV2AllocationStart);
  assert.equal((body.match(/VOLATILE SECURITY INVOKER SET search_path = pg_catalog/gu)??[]).length,3);
  assert.doesNotMatch(body,/INSERT INTO|UPDATE public\.|DELETE FROM|SECURITY DEFINER|pg_advisory|FOR UPDATE|FOR SHARE|set_config/u);
  for(const name of ['derive_product_ancillary_identities_v1','assert_product_ancillary_identities_v1','allocate_product_ancillary_identities_v1'])
    assert.match(body,new RegExp(`REVOKE ALL ON FUNCTION phase5_private\\.${name}\\([^;]+FROM PUBLIC,anon,authenticated,service_role;`,'u'));
  for(const flag of ['durableIdentityClaimed','defaultsQualified','fullWriteTuples','stockEffectIdentitiesComplete',
    'absencePredicatesFenced','locksHeld','heldContextAuthority','executionAuthority'])assert.ok(body.includes(`'${flag}',FALSE`));
});

test('product ancillary membership is ordered per product with conditional exact source audit/image bindings',()=>{
  const body=migration.slice(productAncillaryStart,receiptV2AllocationStart);
  for(const marker of ["ids->'productId' IS DISTINCT FROM product_row->'id'",'PHASE5_PRODUCT_ANCILLARY_NOT_APPLICABLE',
    'CARDINALITY(all_ids)<>CARDINALITY(distinct_ids)',"plan->'resources'","plan->'futureProducts'",
    'CREATE_PRODUCT_WITH_PACKAGING','SET_PRODUCT_WHOLESALE_PRICE','SET_PRODUCT_PRIMARY_IMAGE','SET_PRODUCT_WHOLESALE_PACKAGE',
    'CREATE_PRODUCT_FLAVOR','CREATE_PRODUCT_FLAVOR_FAMILY',"request->'purchaseUnitId'","request->>'sku'",
    "'on_hand_quantity',0,'reserved_quantity',0","'is_primary',TRUE,'display_order',1"])
    assert.ok(body.includes(marker),marker);
  const allocator=body.slice(body.indexOf('CREATE FUNCTION phase5_private.allocate_product_ancillary_identities_v1'));
  assert.match(allocator,/\(kind TEXT,request JSONB\)/u);
  beforeSource(allocator,'PERFORM phase5_private.assert_product_creation_actor_v1','gen_random_uuid()');
  beforeSource(allocator,'plan:=phase5_private.discover_product_creation_prewrite_v1','FOR product_row IN SELECT value FROM JSONB_ARRAY_ELEMENTS(plan');
  const runtime=read('scripts/testing/run-phase5-inactive-collection-preparation-runtime.mjs');
  const section=runtime.slice(runtime.indexOf('const productAncillaryIdentitiesRuntime'),runtime.indexOf('const receivingFutureIdentitiesRuntime'));
  for(const marker of ['--product-ancillary-identities-focused','FOCUSED_PRODUCT_ANCILLARY_IDENTITIES'])assert.ok(runtime.includes(marker));
  for(const marker of ['per-product-ancillary-bijection','public-control-and-fault-rollback-exact-content','public.create_product_family_with_flavors_v1',
    "['anon','authenticated','service_role']",'noImageIds','swapped.products','copy.products[2]','assert_product_ancillary_identities_v1'])
    assert.ok(section.includes(marker),marker);
});

test('modern receipt allocation preserves predecessor and remains private lock-free discovery',()=>{
  assert.ok(receiptV2AllocationStart>productAncillaryStart);
  assert.equal(hash(migration.slice(0,receiptV2AllocationStart)+'COMMIT;\n'),'82618649FA611C7F9485743EBE16276AB64ADA46586176B003909369E99383B4');
  const body=migration.slice(receiptV2AllocationStart,receiptV2PrewriteStart);
  assert.equal((body.match(/VOLATILE SECURITY INVOKER SET search_path = pg_catalog/gu)??[]).length,3);
  assert.doesNotMatch(body,/INSERT INTO|UPDATE public\.|DELETE FROM|SECURITY DEFINER|pg_advisory|FOR UPDATE|FOR SHARE|set_config/u);
  assert.doesNotMatch(body,/PERFORM public\.phase2_validate_receipt_lines_internal/u);
  for(const name of ['assert_receipt_v2_allocation_sources_v1','derive_receipt_v2_line_allocation_v1','assert_receipt_v2_line_allocation_v1'])
    assert.match(body,new RegExp(`REVOKE ALL ON FUNCTION phase5_private\\.${name}\\([^;]+FROM PUBLIC,anon,authenticated,service_role;`,'u'));
  for(const flag of ['headerIdentityAdmitted','purchaseOrderCapacityQualified','featureEligibilityQualified','defaultsQualified',
    'stockEffectIdentitiesComplete','paymentDomainsQualified','futureIdentityClaimed','numberClaimed','locksHeld',
    'absencePredicatesFenced','allowedInvokerClosure','heldContextAuthority','executionAuthority'])assert.ok(body.includes(`'${flag}',FALSE`));
});

test('modern receipt allocation is per client-line/component, NULL-safe and source rederived',()=>{
  const body=migration.slice(receiptV2AllocationStart,receiptV2PrewriteStart);
  for(const marker of ['BA04C099B758F303DEC157E03E864A6FC36CF5B36FD1C249BA8D6EC94816EA67',
    'plan_inventory_parent_execute_v1','PHASE5_RECEIPT_V2_ALLOCATION_SOURCE_INVALID',
    "'identity',line->>'client_line_id'||'|'||product_identity::TEXT",'allWarehouseBalances',
    "line->>'commercial_quantity' IS NULL","componentBindings",'PHASE5_RECEIPT_V2_COMPONENT_ALLOCATION_BASIS_INVALID',
    'expected IS DISTINCT FROM phase5_private.derive_receipt_v2_line_allocation_v1',
    'ROUND(component_cost::NUMERIC/(component->>\'base_quantity\')::NUMERIC,6)'])assert.ok(body.includes(marker),marker);
  const runtime=read('scripts/testing/run-phase5-inactive-collection-preparation-runtime.mjs');
  for(const marker of ['--receipt-v2-allocation-focused','FOCUSED_RECEIPT_V2_ALLOCATION','client-line-component-bijection',
    'stable-largest-remainder-ties','independent-component-cost-truth','actual-public113-per-line-control'])assert.ok(runtime.includes(marker),marker);
});

test('modern receipt prewrite discovery preserves full allocation predecessor and no execution authority',()=>{
  assert.ok(receiptV2PrewriteStart>receiptV2AllocationStart);
  assert.equal(hash(migration.slice(0,receiptV2PrewriteStart)+'COMMIT;\n'),'E06F27C2568EB0449C7BD98306ED94BB39E763CC6BA64690A2096A9D1355A436');
  const body=migration.slice(receiptV2PrewriteStart,receiptV2IdentityStart);
  assert.equal((body.match(/VOLATILE SECURITY INVOKER SET search_path = pg_catalog/gu)??[]).length,2);
  assert.doesNotMatch(body,/INSERT INTO|UPDATE public\.|DELETE FROM|SECURITY DEFINER|pg_advisory|FOR UPDATE|FOR SHARE|set_config|NEXTVAL\(/u);
  assert.doesNotMatch(body,/PERFORM public\.phase2_validate_receipt_lines_internal|public\.has_erp_role\(/u);
  beforeSource(body,'source_contract:=phase5_private.assert_receipt_v2_allocation_sources_v1','assert_wire_keys_v1(request');
  beforeSource(body,"'EXISTING_PUBLIC_OUTCOME_OBSERVED'",'allocation:=phase5_private.derive_receipt_v2_line_allocation_v1');
  for(const name of ['discover_receipt_v2_prewrite_v1','assert_receipt_v2_prewrite_v1'])
    assert.match(body,new RegExp(`REVOKE ALL ON FUNCTION phase5_private\\.${name}\\([^;]+FROM PUBLIC,anon,authenticated,service_role;`,'u'));
  for(const flag of ['locksHeld','defaultsQualified','stockEffectIdentitiesComplete','futureIdentityClaimed','numberClaimed',
    'absencePredicatesFenced','allowedInvokerClosure','heldContextAuthority','executionAuthority','replayEvidenceQualified'])assert.ok(body.includes(`'${flag}',FALSE`));
});

test('modern receipt header captures exact key/capacity/tender/resources and rederives after drift',()=>{
  const body=migration.slice(receiptV2PrewriteStart,receiptV2IdentityStart);
  for(const marker of ['PHASE5_RECEIPT_V2_HEADER_SOURCE_INVALID','LEGACY_IDEMPOTENCY_IDENTITY_UNPROVEN','IDEMPOTENCY_CONFLICT',
    'PHASE5_RECEIPT_V2_PO_INVALID_OR_PREPAID','PHASE5_RECEIPT_V2_PO_CAPACITY_INVALID','PHASE5_RECEIPT_V2_PAYMENT_SHIFT_REQUIRED',
    'DUPLICATE_SUPPLIER_INVOICE',"'supplier_receipt:'||key","'purchase_order_receipt_v2:'||actor::TEXT||':'||key",
    'source.ordered_quantity IS NULL','source.received_quantity IS NULL',"'supplier_invoice:'||supplier_identity::TEXT",
    "purchase_order_id=po.id",'prospectivePoCompleted','inventory_movement_mutation_seq','absenceObservations',
    'expected IS DISTINCT FROM phase5_private.discover_receipt_v2_prewrite_v1'])assert.ok(body.includes(marker),marker);
  const runtime=read('scripts/testing/run-phase5-inactive-collection-preparation-runtime.mjs');
  for(const marker of ['--receipt-v2-prewrite-focused','FOCUSED_RECEIPT_V2_PREWRITE_DISCOVERY','whole-PO-completion-membership',
    'canonical-public113-request-parity','discovery-never-acquires-write-or-row-gates','owned-fixture-cleanup-exact-content'])assert.ok(runtime.includes(marker),marker);
});

test('modern receipt identity requirements preserve predecessor and exact per-component non-authority',()=>{
  assert.equal(hash(migration.slice(0,receiptV2IdentityStart)+'COMMIT;\n'),'B93BAD517B7B875440236D8237BA4D2A99D5029BCC04BF1F8F30B743DA942575');
  const body=migration.slice(receiptV2IdentityStart,receiptV2UuidStart);
  assert.equal((body.match(/VOLATILE SECURITY INVOKER SET search_path = pg_catalog/gu)??[]).length,2);
  assert.doesNotMatch(body,/INSERT INTO|UPDATE public\.|DELETE FROM|SECURITY DEFINER|pg_advisory|FOR UPDATE|FOR SHARE|NEXTVAL\(|gen_random_uuid\(/u);
  for(const marker of ["'ITEM|'||(n->>'identity')","'MOVEMENT|'||(n->>'identity')","'WAC|'||(n->>'productId')",
    "WHERE n->'row'='null'::JSONB",'ACTUAL_ALLOCATED_MOVEMENT_SEQUENCE_REQUIRED',
    'PHASE5_RECEIPT_V2_EXISTING_OUTCOME_NOT_NEW_IDENTITIES','expected IS DISTINCT FROM phase5_private.derive_receipt_v2_identity_requirements_v1'])assert.ok(body.includes(marker),marker);
  for(const flag of ['fullWriteTuples','defaultsQualified','stockEffectIdentitiesComplete','futureIdentityAllocated','durableIdentityClaimed',
    'numberClaimed','absencePredicatesFenced','locksHeld','allowedInvokerClosure','heldContextAuthority','executionAuthority'])assert.ok(body.includes(`'${flag}',FALSE`));
  for(const name of ['derive_receipt_v2_identity_requirements_v1','assert_receipt_v2_identity_requirements_v1'])
    assert.match(body,new RegExp(`REVOKE ALL ON FUNCTION phase5_private\\.${name}\\([^;]+FROM PUBLIC,anon,authenticated,service_role;`,'u'));
  const runtime=read('scripts/testing/run-phase5-inactive-collection-preparation-runtime.mjs');
  assert.ok(runtime.includes('independent-per-client-component-identity-set'));
});

test('modern receipt future UUIDs preserve exact predecessor, membership and private non-ownership',()=>{
  assert.equal(hash(migration.slice(0,receiptV2UuidStart)+'COMMIT;\n'),'159CAA0903317EF9C4B12D999456E3D5C8398BD6934477F8EE1ADDAD81A0CEB1');
  const body=migration.slice(receiptV2UuidStart,receiptV2BalanceStart);
  assert.equal((body.match(/VOLATILE SECURITY INVOKER SET search_path = pg_catalog/gu)??[]).length,3);
  assert.doesNotMatch(body,/INSERT INTO|UPDATE public\.|DELETE FROM|SECURITY DEFINER|pg_advisory|FOR UPDATE|FOR SHARE|NEXTVAL\(/u);
  for(const marker of ['actual_keys IS DISTINCT FROM expected_keys','identity=ANY(ids)','JSONB_PATH_QUERY(requirements',
    'PHASE5_RECEIPT_V2_UUID_COLLISION_RETRY','expected IS DISTINCT FROM phase5_private.derive_receipt_v2_future_uuids_v1'])assert.ok(body.includes(marker),marker);
  for(const flag of ['fullWriteTuples','defaultsQualified','stockEffectIdentitiesComplete','durableIdentityClaimed','numberClaimed',
    'absencePredicatesFenced','locksHeld','allowedInvokerClosure','heldContextAuthority','executionAuthority'])assert.ok(body.includes(`'${flag}',FALSE`));
  for(const name of ['derive_receipt_v2_future_uuids_v1','assert_receipt_v2_future_uuids_v1','allocate_receipt_v2_future_uuids_v1'])
    assert.match(body,new RegExp(`REVOKE ALL ON FUNCTION phase5_private\\.${name}\\([^;]+FROM PUBLIC,anon,authenticated,service_role;`,'u'));
  const allocator=body.slice(body.indexOf('CREATE FUNCTION phase5_private.allocate_receipt_v2_future_uuids_v1'));
  beforeSource(allocator,'requirements:=phase5_private.derive_receipt_v2_identity_requirements_v1','gen_random_uuid()');
});

test('Receipt V2 balance projections preserve predecessor and independently derive available quantity without time or execution claims',()=>{
  assert.ok(receiptV2BalanceStart>receiptV2UuidStart);
  assert.equal(hash(migration.slice(0,receiptV2BalanceStart)+'COMMIT;\n'),'48F456029357336FD5AB408E3A98A0501A4FD9B6C039F0186BB907020043E156');
  const body=migration.slice(receiptV2BalanceStart,receiptV2InventoryStart);
  assert.equal((body.match(/VOLATILE SECURITY INVOKER SET search_path = pg_catalog/gu)??[]).length,2);
  assert.match(body,/after_quantity-reserved/u);
  assert.match(body,/old_row->>'available_quantity'\)::BIGINT IS DISTINCT FROM opening-reserved/u);
  assert.match(body,/after_quantity>2147483647/u);
  assert.match(body,/expected IS DISTINCT FROM phase5_private\.derive_receipt_v2_balance_rows_v1/u);
  assert.match(body,/ACTUAL_TRANSACTION_TIMESTAMP_AT_EXECUTION/u);
  assert.doesNotMatch(body,/INSERT INTO|UPDATE public\.|DELETE FROM|SECURITY DEFINER|pg_advisory|FOR UPDATE|FOR SHARE|NEXTVAL\(|transaction_timestamp\(|NOW\(/u);
  for(const flag of ['fullWriteTuples','defaultsQualified','stockEffectIdentitiesComplete','durableIdentityClaimed',
    'numberClaimed','absencePredicatesFenced','locksHeld','heldContextAuthority','executionAuthority'])assert.ok(body.includes(`'${flag}',FALSE`));
});

test('Receipt V2 inventory projections preserve predecessor and per-component movements distinct from global per-SKU WAC',()=>{
  assert.ok(receiptV2InventoryStart>receiptV2BalanceStart);
  assert.equal(hash(migration.slice(0,receiptV2InventoryStart)+'COMMIT;\n'),'C1202D2D877246C3CAE72BCDF0E631297C471DE453E7BDAF501E30D36567B497');
  const body=migration.slice(receiptV2InventoryStart,receiptV2FinancialStart);
  assert.equal((body.match(/VOLATILE SECURITY INVOKER SET search_path = pg_catalog/gu)??[]).length,2);
  assert.match(body,/FROM public\.inventory_balances WHERE product_id=product_identity/u);
  assert.match(body,/opening::NUMERIC\*prior_exact\+cost::NUMERIC/u);
  assert.match(body,/ORDER BY \(value->>'clientLineId'\)::UUID/u);
  assert.match(body,/ACTUAL_LAST_ORDERED_MOVEMENT_RETURNING_SEQUENCE/u);
  assert.match(body,/actor:=\(plan->'actorContract'->'profile'->>'id'\)::UUID/u);
  assert.match(body,/expected IS DISTINCT FROM phase5_private\.derive_receipt_v2_inventory_rows_v1/u);
  assert.doesNotMatch(body,/INSERT INTO|UPDATE public\.|DELETE FROM|SECURITY DEFINER|pg_advisory|FOR UPDATE|FOR SHARE|NEXTVAL\(|transaction_timestamp\(|NOW\(/u);
  for(const flag of ['fullWriteTuples','defaultsQualified','stockEffectIdentitiesComplete','durableIdentityClaimed','numberClaimed',
    'absencePredicatesFenced','locksHeld','heldContextAuthority','executionAuthority'])assert.ok(body.includes(`'${flag}',FALSE`));
});

test('Receipt V2 financial projections preserve source arithmetic, case and exclusive identities without execution authority',()=>{
  assert.ok(receiptV2FinancialStart>receiptV2InventoryStart);
  assert.equal(hash(migration.slice(0,receiptV2FinancialStart)+'COMMIT;\n'),'73724C9605D4929DC63E21F8151B01E24A4B7702FFE6EDD3CB4BF5A5E0978EDD');
  const body=migration.slice(receiptV2FinancialStart,receiptV2ItemStart);
  assert.equal((body.match(/VOLATILE SECURITY INVOKER SET search_path = pg_catalog/gu)??[]).length,2);
  assert.match(body,/inventory_plan:=phase5_private\.derive_receipt_v2_inventory_rows_v1/u);
  assert.match(body,/invoice_number:=NULLIF\(BTRIM\(request->>'supplier_invoice_number'\),''\)/u);
  assert.match(body,/current_balance_in_minor_units'\)::BIGINT\+outstanding/u);
  assert.match(body,/expected IS DISTINCT FROM phase5_private\.derive_receipt_v2_financial_rows_v1/u);
  for(const key of ['headerWithoutEventValues','operationWithoutResultAndTime','resultWithoutReceiptNumber','invoiceWithoutDefaults',
    'paymentWithoutNotesTimeAndTrigger','supplierPatchWithoutEventTime','auditWithoutEventValues'])assert.ok(body.includes(`'${key}'`));
  assert.doesNotMatch(body,/INSERT INTO|UPDATE public\.|DELETE FROM|SECURITY DEFINER|pg_advisory|FOR UPDATE|FOR SHARE|NEXTVAL\(|transaction_timestamp\(|NOW\(/u);
  for(const flag of ['fullWriteTuples','defaultsQualified','stockEffectIdentitiesComplete','paymentTriggerEffectsQualified',
    'durableIdentityClaimed','numberClaimed','absencePredicatesFenced','locksHeld','heldContextAuthority','executionAuthority'])assert.ok(body.includes(`'${flag}',FALSE`));
});

test('Receipt V2 item projections preserve per-client component identities and Direct/PO source fields without execution',()=>{
  assert.ok(receiptV2ItemStart>receiptV2FinancialStart);
  assert.equal(hash(migration.slice(0,receiptV2ItemStart)+'COMMIT;\n'),'504271A39460C337CA28749A8F3F5158B96977647B67094A73BEBD87CEE87F39');
  const body=migration.slice(receiptV2ItemStart,receiptV2StockCandidateStart);
  assert.equal((body.match(/VOLATILE SECURITY INVOKER SET search_path = pg_catalog/gu)??[]).length,2);
  assert.match(body,/financial_plan:=phase5_private\.derive_receipt_v2_financial_rows_v1/u);
  assert.match(body,/clientLineId'\)::UUID=client_identity AND \(n->>'productId'\)::UUID=product_identity/u);
  assert.match(body,/GROUP BY \(l->>'purchase_order_item_id'\)::UUID/u);
  assert.match(body,/FROM public\.units WHERE id=\(product_row->>'purchase_unit_id'\)::UUID/u);
  assert.match(body,/expected IS DISTINCT FROM phase5_private\.derive_receipt_v2_item_rows_v1/u);
  for(const field of ['package_price_in_minor_units','purchase_order_item_id','configuration_revision','production_date','line_sequence','purchaseOrderItemPatches'])assert.ok(body.includes(`'${field}'`));
  assert.doesNotMatch(body,/INSERT INTO|UPDATE public\.|DELETE FROM|SECURITY DEFINER|pg_advisory|FOR UPDATE|FOR SHARE|NEXTVAL\(|transaction_timestamp\(|NOW\(/u);
  for(const flag of ['fullWriteTuples','defaultsQualified','stockEffectIdentitiesComplete','durableIdentityClaimed','locksHeld','executionAuthority'])assert.ok(body.includes(`'${flag}',FALSE`));
});

test('Receipt V2 literal runtime sends only predecoded bounded literals to PostgreSQL in rollback-only controls',()=>{
  const runtime=read('scripts/testing/run-phase5-inactive-collection-preparation-runtime.mjs');
  const start=runtime.indexOf('if(receiptV2LiteralValuesFocused){');
  const end=runtime.indexOf('if(receiptV2InstalledValuesFocused){',start);
  assert.ok(start>0&&end>start);
  const body=runtime.slice(start,end);
  assert.ok(body.indexOf('decodeReceiptV2LiteralRequirement(literal.expression,literal.type)')<body.indexOf('const actual=await json'));
  for(const marker of ['OMITTED_LITERAL_DEFAULT_REQUIRES_TYPED_VALUE_PROOF','literals.size>0',
    'EXACT_INTEGER_TEXT','::text','BEGIN;SELECT','ROLLBACK;',
    'literal-equivalence-never-mutates-durable-content','PostgreSQL bounded literal equivalence'])assert.ok(body.includes(marker),marker);
  assert.doesNotMatch(body,/INSERT INTO|UPDATE public|DELETE FROM|eval\(|retries\s*:/u);
});

test('Receipt V2 item binding runtime asserts real source truth before bridge and compares public RPC rows per identity',()=>{
  const runtime=read('scripts/testing/run-phase5-inactive-collection-preparation-runtime.mjs');
  const start=runtime.indexOf('if(receiptV2ItemBindingsFocused){');
  const end=runtime.indexOf('if(receiptV2InstalledValuesFocused){',start);
  const body=runtime.slice(start,end);assert.ok(start>0&&end>start);
  assert.ok(body.indexOf('assert.equal(proved.asserted,true)')<body.indexOf('const bound=bindReceiptV2ItemProjectionRequirements'));
  for(const marker of ['assert_receipt_v2_item_rows_v1','allocate_receipt_v2_future_uuids_v1',
    'sourceAssert(corruption)','items,1','allocated_cost_in_minor_units','public.create_direct_supplier_receipt_v2',
    'public.receive_purchase_order_v2','l.client_line_id::text','i.product_id::text','OMITTED_SQL_NULL',
    'DB source revalidation corruption zero-write','bound row public RPC scalar parity exact rollback',
    'ACTUAL_TRANSACTION_TIMESTAMP','typedValueFullyQualified'])assert.ok(body.includes(marker),marker);
  assert.ok(runtime.includes('--receipt-v2-item-bindings-focused'));
  assert.doesNotMatch(body,/retries\s*:|setTimeout\(|statement_timeout=/u);
});

test('Receipt V2 primary bridge runtime preserves deferred defaults/events and compares actual financial/inventory RPC identities',()=>{
  const runtime=read('scripts/testing/run-phase5-inactive-collection-preparation-runtime.mjs');
  const start=runtime.indexOf('if(receiptV2PrimaryBindingsFocused){');
  const end=runtime.indexOf('if(receiptV2InstalledValuesFocused){',start);
  const body=runtime.slice(start,end);assert.ok(start>0&&end>start);
  for(const marker of ['bindReceiptV2PrimaryProjectionRequirements','assertReceiptV2PrimaryProjectionRequirements',
    'ACTUAL_SERVER_UUID_AND_DURABLE_CLAIM_REQUIRED','primary DB source corruption zero-write',
    'qa_v2_primary_public','public.supplier_financial_invoice_identities','public.supplier_payments',
    'public.audit_logs','public.phase2_receipt_wac_snapshots','l.client_line_id::text',
    'stored result equals actual RPC result','primary public RPC exact content rollback',
    'finalCompositeValuesQualified','defaultOwnershipQualified','actualNumberAndSequenceQualified']){
    assert.ok(marker==='finalCompositeValuesQualified'
      ?read('scripts/analysis/inspect-phase5-writer-admission.mjs').includes(marker):body.includes(marker),marker);
  }
  assert.ok(runtime.includes('--receipt-v2-primary-bindings-focused'));
  assert.doesNotMatch(body,/UPDATE public|DELETE FROM|INSERT INTO public|retries\s*:|setTimeout\(|statement_timeout=/u);
});

test('Receipt V2 UPDATE/event runtime uses captured DB clock and actual public allocations without materializing future authority',()=>{
  const runtime=read('scripts/testing/run-phase5-inactive-collection-preparation-runtime.mjs');
  const start=runtime.indexOf('if(receiptV2EventsUpdatesFocused){');
  const end=runtime.indexOf('if(receiptV2InstalledValuesFocused){',start);
  const body=runtime.slice(start,end);assert.ok(start>0&&end>start);
  for(const marker of ['bindReceiptV2UpdateProjectionRequirements','assertReceiptV2UpdateProjectionRequirements',
    'inspectReceiptV2UpdateRequirements','UPDATE source corruption rejects zero-write',
    'event/patch public runtime exact rollback','actual transaction time','directBefore',
    'PO random number never consumes Direct sequence','actual last ordered INSERT RETURNING sequence',
    'cash_shift_id','actualEventValuesAllocated'])assert.ok(body.includes(marker),marker);
  for(const marker of ['qa_v2_primary_clock','NOW() tx_time','COALESCE(',"SET LOCAL TIME ZONE 'UTC'",'2001-02-03T04:05:06+03:00',
    '--receipt-v2-events-updates-focused'])assert.ok(runtime.includes(marker),marker);
  assert.doesNotMatch(body,/UPDATE public|DELETE FROM|INSERT INTO public|retries\s*:|setTimeout\(|statement_timeout=/u);
});

test('Receipt V2 runtime keeps original and cleanup errors without weakening its exact content assertion',()=>{
  const runtime=read('scripts/testing/run-phase5-inactive-collection-preparation-runtime.mjs');
  assert.ok(runtime.includes('const fingerprintContentQuery = fingerprintQuery'));
  assert.ok(runtime.includes('primaryFailure=error;'));
  assert.ok(runtime.includes('new AggregateError([primaryFailure,cleanupFailure].filter(Boolean)'));
  assert.ok(runtime.includes("assert.equal(await fingerprint(),outer,'installed-value-owned-fixture-cleanup-exact-content')"));
  assert.ok(runtime.includes('fingerprintContentDiff(outerContent,await fingerprintContent())'));
  const start=runtime.indexOf('const fingerprintContentDiff =');
  const end=runtime.indexOf('const money =',start);
  const diagnostics=runtime.slice(start,end);
  assert.ok(start>0&&end>start);
  assert.doesNotMatch(diagnostics,/console\.|\.filter\([^\n]*(?:stock|automation|supplier)/u);
});

test('Receipt V2 transitive runtime challenges real authenticated Direct/PO triggers under exact rollback',()=>{
  const runtime=read('scripts/testing/run-phase5-inactive-collection-preparation-runtime.mjs');
  const start=runtime.indexOf('const receiptV2TriggerEffectsRuntime =');
  const end=runtime.indexOf('const receiptV2PrewriteRuntime =',start);
  const body=runtime.slice(start,end);assert.ok(start>0&&end>start);
  for(const marker of ['inspectReceiptV2TriggerEffectContract','deriveReceiptV2AlertTransition',
    'shift_inventory_side_effect_catalog_v1','SET LOCAL ROLE authenticated','public.create_direct_supplier_receipt_v2',
    'public.receive_purchase_order_v2','assert_receipt_v2_prewrite_v1','absent-zero-insert-then-resolve',
    'out-to-low-delete-reads','same-low-retain-reads','existing-low-resolve-retain-reads','out-to-low-existing-event-dedup',
    'old event content preserved','exact operation-trigger event delta','entire trigger/payment/default public fixture exact rollback',
    "method:'cash'","method:'cliq'","method:'deferred'",'transitiveIdentityOwned'])assert.ok(body.includes(marker),marker);
  assert.ok(runtime.includes('--receipt-v2-trigger-effects-focused'));
  assert.doesNotMatch(body,/session_replication_role|DISABLE TRIGGER ALL|retries\s*:|statement_timeout=|setTimeout\(/u);
});

test('Receipt V2 transitive runtime captures complete columns and does not hide invalid or composite foreign keys',()=>{
  const runtime=read('scripts/testing/run-phase5-inactive-collection-preparation-runtime.mjs');
  const start=runtime.indexOf('const receiptV2TriggerEffectsRuntime =');
  const end=runtime.indexOf('const receiptV2PrewriteRuntime =',start);
  const body=runtime.slice(start,end);assert.ok(start>0&&end>start);
  for(const marker of ['inspectReceiptV2TransitiveRowRequirements','assertReceiptV2TransitiveRowRequirements',
    'transitiveInstalled','transitiveRequirements.writes.length,6','n+t.columns.length,0),19',
    "assert.equal(fk.validated,true)","assert.equal(fk.keyCount,1)","assert.equal(fk.parentKeyCount,1)",
    'transitiveFks.map(f=>f.tuple)','complete transitive requirements are read-only'])assert.ok(body.includes(marker),marker);
  const query=body.slice(body.indexOf('const transitiveFks='),body.indexOf('const tupleSort='));
  assert.doesNotMatch(query,/AND fk\.convalidated|AND cardinality\(fk\.conkey\)=1|AND cardinality\(fk\.confkey\)=1/u);
});

test('Receipt V2 stock OLD/NEW runtime expectations derive from pre-RPC snapshots rather than mutated evidence',()=>{
  const runtime=read('scripts/testing/run-phase5-inactive-collection-preparation-runtime.mjs');
  const start=runtime.indexOf('const receiptV2TriggerEffectsRuntime =');
  const end=runtime.indexOf('const receiptV2PrewriteRuntime =',start);
  const body=runtime.slice(start,end);assert.ok(start>0&&end>start);
  for(const marker of ['deriveReceiptV2StockStages','assertReceiptV2StockStages','beforeProduct','beforeWarehouse','beforeBalance',
    'beforeAlerts','beforeReads','(actual.beforeBalance?.available_quantity??0)+scenario.quantity',
    'symbolic OLD/NEW source-column parity','exact ordered source read deletion identity coverage',
    'paymentUnionComplete','futureIdentitySetResolved'])assert.ok(body.includes(marker),marker);
  const expected=body.slice(body.indexOf('const snapshot={'),body.indexOf('const staged='));
  assert.doesNotMatch(expected,/actual\.balance|actual\.alerts|actual\.payments|actual\.reads/u);
});

test('Receipt V2 source-effect union runtime asserts whole source plan before comparing real public effects',()=>{
  const runtime=read('scripts/testing/run-phase5-inactive-collection-preparation-runtime.mjs');
  const start=runtime.indexOf('const receiptV2TriggerEffectsRuntime =');
  const end=runtime.indexOf('const receiptV2PrewriteRuntime =',start);
  const body=runtime.slice(start,end);assert.ok(start>0&&end>start);
  for(const marker of ['allocate_receipt_v2_future_uuids','derive_receipt_v2_item_rows','assert_receipt_v2_item_rows',
    'sourceProjection','bindReceiptV2SourceEffectUnion','assertReceiptV2SourceEffectUnion',
    'union.payment.triggerShift.value,actual.expectedShift','whole source-plan union versus independent pre-RPC snapshot parity',
    'writerInvokerAbsenceConvergence','executionAuthority'])assert.ok(body.includes(marker),marker);
  assert.ok(body.indexOf('assert_receipt_v2_item_rows')<body.indexOf('SET LOCAL ROLE authenticated'));
  assert.doesNotMatch(body,/session_replication_role|DISABLE TRIGGER ALL|retries\s*:|statement_timeout=|setTimeout\(/u);
});

test('Receipt V2 captured event runtime derives exact keys from pre-RPC source and preserves unresolved future identities',()=>{
  const runtime=read('scripts/testing/run-phase5-inactive-collection-preparation-runtime.mjs');
  const start=runtime.indexOf('const receiptV2TriggerEffectsRuntime =');
  const end=runtime.indexOf('const receiptV2PrewriteRuntime =',start);
  const body=runtime.slice(start,end);assert.ok(start>0&&end>start);
  for(const marker of ['resolveReceiptV2CapturedAlertEvents','assertReceiptV2CapturedAlertEvents',
    'timestampUtc:actual.eventTime,epochFloorSeconds:actual.epoch','union.stock.retainedSnapshot',
    'new source alert UUID never borrowed from observed after-effect evidence',
    'captured alert full OLD/NEW actual transaction-time parity','resolved exact-key conflict preserves all captured event content',
    'independent source-derived event tuple except unallocated default UUID',
    'PostgreSQL microsecond/negative-epoch exact key parity','clock/key representation controls are content-zero-write',
    'clockAuthorityQualified','absenceFenceHeld'])assert.ok(body.includes(marker),marker);
  const derivation=body.slice(body.indexOf('const eventClock='),body.indexOf('for(const d of resolvedEvents.decisions)'));
  assert.doesNotMatch(derivation,/actual\.alerts|actual\.events|actual\.payments/u);
  assert.doesNotMatch(body,/session_replication_role|DISABLE TRIGGER ALL|retries\s*:|statement_timeout=|setTimeout\(/u);
});

test('complete Receipt V2 row requirement runtime binds source expressions without granting event or execution authority',()=>{
  const runtime=read('scripts/testing/run-phase5-inactive-collection-preparation-runtime.mjs');
  const start=runtime.indexOf('if(receiptV2RowRequirementsFocused){');
  const end=runtime.indexOf('if(receiptV2InstalledValuesFocused){',start);
  assert.ok(start>0&&end>start);
  const body=runtime.slice(start,end);
  for(const marker of ['inspectReceiptV2RowRequirements','assertReceiptV2RowRequirements','complete primary INSERT requirements',
    'binding.offset','binding.column','EXPLICIT_SQL_NULL','OMITTED_SQL_NULL','HISTORICAL_TYPED_LITERAL',
    'ACTUAL_MOVEMENT_RETURNING_SEQUENCE','beforeInsertValue=99','sourceExpressionsEvaluated',
    'complete-row-requirements-no-durable-mutation'])assert.ok(body.includes(marker),marker);
  assert.ok(runtime.includes('--receipt-v2-row-requirements-focused'));
  assert.doesNotMatch(body,/await sql\(|INSERT INTO|UPDATE public|DELETE FROM|eval\(|retries\s*:/u);
});

test('installed Receipt V2 value qualification has a dedicated focused gate without removing full prewrite coverage',()=>{
  const runtime=read('scripts/testing/run-phase5-inactive-collection-preparation-runtime.mjs');
  for(const marker of ['--receipt-v2-installed-values-focused','inspectReceiptV2InstalledValueRequirements',
    'every installed column per source occurrence','installed-value-classification-never-evaluates-defaults-or-writes',
    'ACTUAL_NULL_ONLY_BEFORE_INSERT_SEQUENCE','OMITTED_UUID_REQUIRES_SERVER_ALLOCATION_AND_CLAIM',
    'unknown-default','required-omission','wrong-generated','wrong-time-type',
    'installed-value-owned-fixture-cleanup-exact-content'])assert.ok(runtime.includes(marker),marker);
  const early=runtime.indexOf('if(receiptV2InstalledValuesFocused){');
  const continued=runtime.indexOf("assert.equal(d.mode,'NEW_REQUEST_DISCOVERED')",early);
  assert.ok(early>0 && continued>early,'full existing prewrite matrix remains after narrow catalog-only return');
  assert.ok(runtime.includes("process.argv.includes('--receipt-v2-prewrite-focused') || receiptV2InstalledValuesFocused"));
});

test('Receipt V2 positive metadata and multi-component Purchase Package branches compare real public writer tuples',()=>{
  const runtime=read('scripts/testing/run-phase5-inactive-collection-preparation-runtime.mjs');
  const start=runtime.indexOf('// Positive metadata / multi-component Purchase Package controls');
  const end=runtime.indexOf("for(const kind of ['DIRECT_V2','PO_V2'])",start);
  assert.ok(start>0 && end>start);
  const body=runtime.slice(start,end);
  for(const marker of ["['base-metadata','DIRECT_V2'","['base-metadata','PO_V2'",
    "['purchase-package','DIRECT_V2'","['purchase-package','PO_V2'",
    "production_date:'2026-01-02'","expiry_date:'2028-03-04'",
    'public.create_direct_supplier_receipt_v2','public.receive_purchase_order_v2',
    'assert_receipt_v2_item_rows_v1','l.operation_id=i.operation_id',
    'exact component identity','independent metadata','independently specified component quantities',
    'source patch identity','rollback exact content','ROLLBACK;'])assert.ok(body.includes(marker),marker);
  assert.doesNotMatch(body,/DISABLE TRIGGER|session_replication_role|retries\s*:|setTimeout/u);
});

test('modern receipt parcel feature runtime covers both sources and real actor policy with rollback',()=>{
  const runtime=read('scripts/testing/run-phase5-inactive-collection-preparation-runtime.mjs');
  const body=runtime.slice(runtime.indexOf('const receiptV2PrewriteRuntime'),runtime.indexOf('const receiptV2AllocationRuntime'));
  for(const marker of ["for(const kind of ['DIRECT_V2','PO_V2'])", "['OFF','OWNER_PILOT','ENABLED']",
    "['owner','warehouse_keeper']", "feature==='ENABLED'||(feature==='OWNER_PILOT'&&actorRole==='owner')",
    'FEATURE_ACTOR_FIXTURE_MISSING','public.assert_configurable_parcel_creation_allowed()',
    'parcel-feature-rollback-content','commercial_line_kind=\'configurable_parcel\'',
    'received_parcel_quantity=0','${setup(featureDirect)}','${assertion(featureDirect)}'])assert.ok(body.includes(marker),marker);
  assert.ok(body.includes('else await fails(`${prepare}SELECT ${discover(request,kind)};`,/CONFIGURABLE_PARCEL_DISABLED/u)'));
  assert.ok(body.includes('else await fails(`${prepare}SELECT public.assert_configurable_parcel_creation_allowed();`,/CONFIGURABLE_PARCEL_DISABLED/u)'));
});

test('read-mark resources are actor-first, exact/composite, scoped and freshly revalidated',()=>{
  const body=migration.slice(migration.indexOf('-- Read-mark resource discovery/revalidation ONLY.'));
  beforeSource(body,'PERFORM public.assert_erp_role',"IF action IS NULL");
  beforeSource(body,"IF action IS NULL",'FROM public.stock_alerts a WHERE');
  assert.match(body,/actor UUID:=auth\.uid\(\)/u);
  assert.match(body,/action='SINGLE' AND a\.id=alert_identity/u);
  assert.match(body,/action='ALL_ACTIVE' AND a\.status='active'/u);
  assert.match(body,/action='ALL_ACTIVE' AND alert_identity IS NOT NULL/u);
  assert.match(body,/ARRAY\[\]::UUID\[\]/u);
  assert.match(body,/'stock_alert_id',r\.stock_alert_id,'user_id',r\.user_id/u);
  assert.match(body,/SELECT actor id UNION SELECT r\.user_id/u);
  assert.match(body,/TO_JSONB\(p\)|TO_JSONB\(w\)|TO_JSONB\(a\)|TO_JSONB\(r\)/u);
  assert.match(body,/expected IS DISTINCT FROM actual/u);
  assert.match(body,/actual:=phase5_private\.discover_read_mark_resources_v1\(action,alert_identity\)/u);
  for(const name of ['assert_erp_role','is_mfa_policy_satisfied'])
    assert.ok(body.includes(hash(branchSource(name).body).toLowerCase()));
  const runtime=read('scripts/testing/run-phase5-inactive-collection-preparation-runtime.mjs');
  for(const marker of ['--read-mark-resources-focused','readMarkResourcesRuntime','READ_MARK_FAULT_NOT_INJECTED',
    'read-mark-same-count-substitution','read-mark-independent-session-drift','read-mark-empty-active',
    'read-mark-resolved-single','read-mark-other-actor','PHASE5_READ_MARK_RESOURCES_CHANGED_RETRY'])
    assert.ok(runtime.includes(marker),marker);
});

test('parent EXECUTE qualification is independently source-grounded and cannot certify early writes', () => {
  const start=migration.indexOf('-- Parent EXECUTE qualification');assert.ok(start>0);
  assert.equal(hash(migration.slice(0,start)+'COMMIT;\n'),'6EA77C40D15806A70752CB9B823398091A9F1B2948908520A52E2CFA2D898072');
  const body=migration.slice(start,receivingPrewriteStart);
  const contracts=JSON.parse(body.match(/\$execute_contract\$([\s\S]*?)\$execute_contract\$/u)![1]);
  const historical=readdirSync('supabase/migrations').filter(n=>/^\d{3}_/u.test(n)&&Number(n.slice(0,3))<=127)
    .sort().map(filename=>({filename,source:read('supabase/migrations/'+filename)}));
  const sources=functionEvents(historical).state;
  assert.equal(contracts.length,95);assert.equal(new Set(contracts.map((r:{signature:string})=>r.signature)).size,95);
  for(const r of contracts){
    const source=sources.get(r.signature);assert.ok(source,r.signature);
    assert.deepEqual(r.directAppAcl,source.acl,r.signature);
    assert.deepEqual(r.grantees,['postgres',...Object.entries(source.acl).filter(([,v])=>v).map(([k])=>k)].sort(),r.signature);
    assert.equal(r.triggerOnly,source.returnsTrigger,r.signature);
    assert.equal(r.allowedInvokerClosure,false);assert.equal(r.branchOrderQualified,false);assert.equal(r.executionAuthority,false);
  }
  assert.deepEqual(contracts.filter((r:{grantees:string[]})=>r.grantees.includes('public')).map((r:{signature:string,triggerOnly:boolean})=>[r.signature,r.triggerOnly]),
    [['public.sync_product_flavor_commercial_settings()',true]]);
  for(const marker of ['actual_grantees IS DISTINCT FROM',"a.privilege_type IS DISTINCT FROM 'EXECUTE'",'a.is_grantable',
    'has_function_privilege(root_role',"routine.prorettype='pg_catalog.trigger'",'PHASE5_PARENT_EFFECTIVE_EXECUTE_INVALID',
    'PHASE5_PARENT_EXECUTE_CONTRACT_INVALID','PHASE5_PARENT_EXECUTE_CHANGED_RETRY',"'firstBusinessWriteQualified',FALSE",
    "'allowedInvokerClosure',FALSE","'writerClosed',FALSE"]) assert.ok(body.includes(marker),marker);
  assert.doesNotMatch(body,/INSERT INTO|UPDATE public\.|DELETE FROM|FOR UPDATE|pg_advisory|SECURITY DEFINER|\bset_config\b/u);
  for(const signature of ['plan_inventory_parent_execute_v1()','assert_inventory_parent_execute_v1(JSONB)'])
    assert.ok(body.includes(`REVOKE ALL ON FUNCTION phase5_private.${signature} FROM PUBLIC,anon,authenticated,service_role;`));
});

test('parent participation sources are independently reconstructed, signature-exact and never execution authority', () => {
  const start=migration.indexOf('-- Parent/callable source participation preparation');
  assert.ok(start>0);
  assert.equal(hash(migration.slice(0,start)+'COMMIT;\n'),'4BEDFD3596CE6D657989AD5F8711475C7C4BC5FA096D85306A552CF46315FA9D');
  const section=migration.slice(start,receivingPrewriteStart);
  const sources=JSON.parse(section.match(/\$sources\$([\s\S]*?)\$sources\$/u)![1]);
  const signatures=JSON.parse(section.match(/\$signatures\$([\s\S]*?)\$signatures\$/u)![1]);
  const historical=readdirSync('supabase/migrations').filter(n=>/^\d{3}_/u.test(n)&&Number(n.slice(0,3))<=127)
    .sort().map(filename=>({filename,source:read('supabase/migrations/'+filename)}));
  const reconstructed=functionEvents(historical).state;
  assert.deepEqual(signatures,[...reconstructed.keys()].filter(s=>s.startsWith('public.')).sort());
  assert.equal(signatures.length,371);assert.equal(sources.length,95);
  assert.equal(new Set(sources.map((s:{signature:string})=>s.signature)).size,95);
  for(const source of sources) {
    const anchor=reconstructed.get(source.signature);assert.ok(anchor,source.signature);
    let body=anchor.body;
    if(source.sourceTransform!==null) {
      assert.equal(source.signature.split('(')[0],'public.submit_guest_customer_order_core');
      assert.equal(source.sourceTransform,'090_optional_guest_delivery_details.sql:remove-exact-required-street-fragment');
      const fragment="\n    OR NULLIF(TRIM(p_street), '') IS NULL";
      assert.equal(body.split(fragment).length,2);body=body.replace(fragment,'');
      assert.ok(read('supabase/migrations/090_optional_guest_delivery_details.sql').includes('REPLACE(v_definition, v_required_fragment'));
    }
    assert.equal(hash(body).toLowerCase(),source.bodySha256,source.signature);
    assert.equal(source.sourceMigration,anchor.sourceMigration);
    assert.equal(source.sourceLine,anchor.sourceLocation);
    assert.equal(source.searchPath,anchor.searchPath);
    assert.equal(source.earlyGateQualified,false);
  }
  for(const marker of ['actual_oids IS DISTINCT FROM expected_oids','PHASE5_PARENT_CALLABLE_SET_INVALID',
    'PHASE5_PARENT_SOURCE_CONTRACT_INVALID','PHASE5_PARENT_SOURCE_CHANGED_RETRY',
    "'branchOrderQualified',FALSE","'defaultCreationQualified',FALSE","'completeWriterLedger',FALSE",
    "'writerClosed',FALSE","'executionAuthority',FALSE"]) assert.ok(section.includes(marker),marker);
  assert.doesNotMatch(section,/INSERT INTO|UPDATE public\.|DELETE FROM|FOR UPDATE|pg_advisory|SECURITY DEFINER|\bset_config\b/u);
  assert.match("PERFORM set_config('request.jwt.claims','{}',true);",/\bset_config\b/u);
  assert.doesNotMatch('public.set_configurable_parcel_feature_state_v1(text)',/\bset_config\b/u);
  for(const signature of ['plan_inventory_parent_sources_v1()','assert_inventory_parent_sources_v1(JSONB)'])
    assert.ok(section.includes(`REVOKE ALL ON FUNCTION phase5_private.${signature} FROM PUBLIC,anon,authenticated,service_role;`));
});

test('stock writer source preparation independently pins the complete reviewed seven-routine subgraph', () => {
  const start=migration.indexOf('-- Fixed stock-trigger/read-mark source contract');
  assert.ok(start>0);
  assert.equal(hash(migration.slice(0,start)+'COMMIT;\n'),'97B56D2DA0559A940CDCFBDB68ED447099E09250297EF3E18BB6F7EC757FE81D');
  const body=migration.slice(start,receivingPrewriteStart);
  const roots=[['014_','sync_stock_alert'],['014_','sync_stock_alert_from_balance'],
    ['014_','sync_stock_alert_from_product'],['014_','mark_stock_alert_read'],
    ['014_','mark_all_stock_alerts_read'],['057_','enqueue_stock_automation_event'],['099_','enqueue_automation_event']];
  for(const [prefix,name] of roots) {
    const file=readdirSync('supabase/migrations').find(n=>n.startsWith(prefix));assert.ok(file);
    const source=read('supabase/migrations/'+file);
    const matches=[...source.matchAll(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\s*\\([\\s\\S]*?AS \\$\\$([\\s\\S]*?)\\$\\$;`,'gu'))];
    assert.equal(matches.length,1,name);assert.ok(body.includes(hash(matches[0][1]).toLowerCase()),name);
  }
  for(const marker of ['PHASE5_STOCK_WRITER_SOURCE_CONTRACT_INVALID','PHASE5_STOCK_WRITER_TRIGGER_CONTRACT_INVALID',
    'PHASE5_STOCK_WRITER_SOURCE_CHANGED_RETRY','actual_columns IS DISTINCT FROM entry.columns',
    'entry.proargdefaults IS NOT NULL',"trigger_row.tgenabled IS DISTINCT FROM 'O'",'trigger_row.tgqual IS NOT NULL',
    "'completeWriterLedger',FALSE","'earlyGateQualified',FALSE","'defaultsQualified',FALSE",
    "'writerClosed',FALSE","'executionAuthority',FALSE",'inventory_authority_catalog_v1()']) assert.ok(body.includes(marker),marker);
  assert.doesNotMatch(body,/INSERT INTO|UPDATE public\.|DELETE FROM|pg_advisory|FOR UPDATE|SECURITY DEFINER|\bset_config\b/u);
  for(const signature of ['plan_stock_writer_source_envelope_v1()','assert_stock_writer_source_envelope_v1(JSONB)'])
    assert.ok(body.includes(`REVOKE ALL ON FUNCTION phase5_private.${signature} FROM PUBLIC,anon,authenticated,service_role;`));
  const runtime=read('scripts/testing/run-phase5-inactive-collection-preparation-runtime.mjs');
  for(const marker of ['--stock-writer-source-focused','stockWriterSourceRuntime','SOURCE_FAULT_NOT_INJECTED',
    'OWNER_FAULT_NOT_INJECTED','mark_all_stock_alerts_read','EXTRA_STOCK_BINDING',"assert.equal(await fingerprint(),before)"])
    assert.ok(runtime.includes(marker),marker);
});

test('transport source preparation pins independent historical bodies and excludes mutable delivery truth', () => {
  const start=migration.indexOf('-- Transport admission preserves immutable event source');
  assert.ok(start>completionLockUnionStart);
  assert.equal(hash(migration.slice(0,start)+'COMMIT;\n'),'1753FABEE621782986B65B2EE487DD9DEF044F2BFFE92BEE6AF962F548376114');
  const transport=migration.slice(start,receivingPrewriteStart);
  const historical=read('supabase/migrations/'+readdirSync('supabase/migrations').find(n=>n.startsWith('096_')));
  const bodies=[...historical.matchAll(/AS \$\$([\s\S]*?)\$\$;/gu)].map(m=>hash(m[1]).toLowerCase());
  assert.equal(bodies.length,2);for(const digest of bodies)assert.ok(transport.includes(digest));
  for(const marker of ['PHASE5_TRANSPORT_RPC_CONTRACT_INVALID','PHASE5_TRANSPORT_SOURCE_CHANGED_RETRY',
    'COUNT(DISTINCT id)','ARRAY_POSITION(event_identities,NULL)','inventory_authority_catalog_v1',
    "'deliveryStateIsBusinessEvidence',FALSE","'writerClosed',FALSE","'executionAuthority',FALSE",
    "entry.proowner IS DISTINCT FROM 'postgres'::REGROLE","search_path=public, pg_temp"])
    assert.ok(transport.includes(marker),marker);
  assert.doesNotMatch(transport,/INSERT INTO|UPDATE public\.|DELETE FROM|FOR UPDATE|pg_advisory|SECURITY DEFINER|\bset_config\b/u);
  assert.doesNotMatch(transport,/FROM public\.automation_event_deliveries/u);
  for(const signature of ['plan_transport_source_envelope_v1(UUID[])','assert_transport_source_envelope_v1(UUID[],JSONB)'])
    assert.ok(transport.includes(`REVOKE ALL ON FUNCTION phase5_private.${signature} FROM PUBLIC,anon,authenticated,service_role;`));
  const runtime=read('scripts/testing/run-phase5-inactive-collection-preparation-runtime.mjs');
  for(const marker of ['--transport-source-focused','transportSourceRuntime','SET LOCAL ROLE service_role',
    'public.claim_automation_deliveries','public.complete_automation_delivery','dead_letter',"assert.deepEqual(result.source,result.current)"])
    assert.ok(runtime.includes(marker),marker);
});

test('complete lock union is source-qualified, composite-exact and private inactive acquisition only', () => {
  const start=migration.indexOf('-- Complete source-qualified lock union preparation.');
  assert.ok(start>0);
  assert.equal(hash(migration.slice(0,start)+'COMMIT;\n'),'4C4EB30F816616CE528C0BA0AC6488D4038A8A21FBFE5000F88A0482D89F2C6C');
  const body=migration.slice(start,migration.indexOf('-- Transport admission preserves immutable event source'));
  for(const marker of ['assert_customer_completion_execution_groups_v1','assert_legacy_completion_execution_groups_v1',
    "snapshot->'compositeResources'",'MAX(CASE',"COUNT(DISTINCT n->'row')<>1",'PHASE5_COMPLETION_LOCK_COVERAGE_INVALID',
    'PHASE5_COMPLETION_LOCK_LATE_ENTRY_RETRY','PHASE5_COMPLETION_LOCK_CONTENTION_RETRY',"generation=0",
    "'absencePredicatesFenced',FALSE","'heldContextAuthority',FALSE","'executionAuthority',FALSE",
    "'actualTransactionId',txid_current()::TEXT",'stock_alert_id=',"user_id=(n->'row'->>'user_id')::UUID",'FOR UPDATE NOWAIT']) assert.ok(body.includes(marker),marker);
  assert.doesNotMatch(body,/INSERT INTO|UPDATE public\.|DELETE FROM|EXECUTE|set_config|SECURITY DEFINER/u);
  const acquire=body.slice(body.indexOf('CREATE FUNCTION phase5_private.acquire_completion_lock_union_v1'));
  assert.ok(acquire.indexOf('plan_completion_lock_union_v1')<acquire.indexOf('FOR SHARE NOWAIT'));
  assert.ok(acquire.indexOf("plan->'rootGates'")<acquire.indexOf('FROM public.orders'));
  assert.ok(acquire.indexOf('FROM public.orders')<acquire.indexOf("plan->'inventoryGates'"));
  const runtime=read('scripts/testing/run-phase5-inactive-collection-preparation-runtime.mjs');
  for(const marker of ['completionLockUnionRuntime','S5-COMPLETION-UNION-WAITER','locktype',
    'PHASE5_COMPLETION_LOCK_PLAN_CHANGED','deadlockDelta']) assert.ok(runtime.includes(marker),marker);
});

test('Slice5 preparation is explicitly authorized, hash pinned, and not activation', () => {
  assert.equal(state.migrationCeiling,128);
  assert.equal(state.phase5PublicActivationAllowed,false);
  assert.equal(state.phase5Slice5Closed,false);
  assert.equal(state.phase5Slice5ImplementationStatus,'PRIVATE_INACTIVE_PREPARATION_IN_PROGRESS');
  assert.equal(state.migration128CanonicalLfSha256,hash(migration));
  const reviewed = hash(JSON.stringify(task.slice5TargetedDesignClosure));
  assert.equal(reviewed,'9A74EB14788EA668BDE88DAC95561AD8DA2F734EC47EAA87491AB0F181E06099');
  assert.equal(task.slice5ImplementationAuthorization.reviewedDesignSha256,reviewed);
  assert.equal(task.slice5ImplementationAuthorization.publicActivation,'NOT_AUTHORIZED');
  assert.equal(readdirSync('supabase/migrations').some((name) => /^129_/u.test(name)),false);
});

test('Shift future-parent and stock identity union is exact and independently rederived before claims', () => {
  const start=migration.indexOf('-- Compose already-rederived future parent and stock identities before any claim.');
  assert.ok(start>0);
  const body=migration.slice(start,migration.indexOf('-- Stock-trigger row samples compose the retained ordered source model'));
  assert.match(body,/phase5_private\.plan_shift_inventory_identity_manifest_v1\(/u);
  assert.match(body,/combined:=parent_rows\|\|stock_rows/u);
  assert.match(body,/n->'id' IS DISTINCT FROM n->'row'->'id'/u);
  assert.match(body,/HAVING COUNT\(DISTINCT n->'row'\)<>1/u);
  assert.match(body,/identities && existing_ids/u);
  assert.match(body,/shift_insert_fk_coverage_v1\(combined,existing\)/u);
  assert.match(body,/JSONB_POPULATE_RECORD\(NULL::public\.inventory_movements,row_value\)/u);
  assert.match(body,/expected IS DISTINCT FROM phase5_private\.plan_shift_inventory_identity_union_v1/u);
  assert.match(body,/'futureWriteOwnershipComplete',FALSE/u);
  assert.doesNotMatch(body,/\b(?:INSERT INTO|UPDATE|DELETE FROM|pg_advisory|FOR UPDATE)\b/u);
  const runtime=read('scripts/testing/run-phase5-inactive-collection-preparation-runtime.mjs');
  for(const marker of ['shiftInventoryIdentityUnionRuntime','{parentRows,1}','{stockRows,0,id}',
    '{foreignKeys,0,parentId}','{sourcePlan,identityManifest,eventKeyBindings}','PHASE5_IDENTITY_UNION_CHANGED_RETRY']) assert.ok(runtime.includes(marker),marker);
});

test('Customer and Legacy inventory unions preserve per-source identity without minting completion authority', () => {
  const body=migration.slice(migration.indexOf('-- Completion inventory parent union.'),migration.indexOf('-- Stock-trigger row samples compose the retained ordered source model'));
  assert.match(body,/COUNT\(DISTINCT n->'row'\)<>1/u);
  assert.match(body,/JSONB_EACH\(n->'row'\)/u);
  assert.match(body,/SOURCE_EXACT_SET_REQUIRED/u);
  assert.match(body,/ARRAY\['sourceId','movementId'\]/u);
  assert.match(body,/CARDINALITY\(ids\)<>\(SELECT COUNT\(DISTINCT id\)/u);
  assert.match(body,/derive_inventory_identity_manifest_v1\(actor,model,reserved\|\|ids\)/u);
  assert.match(body,/shift_insert_fk_coverage_v1\(combined,existing\)/u);
  for(const kind of ['customer','legacy']) {
    assert.ok(body.includes(`parent:=phase5_private.plan_${kind}_inventory_side_effects_v1(`));
    assert.ok(body.includes(`expected IS DISTINCT FROM phase5_private.plan_${kind}_inventory_identity_union_v1(`));
  }
  assert.match(body,/'reservation_id',CASE WHEN s->>'sourceKind'='CUSTOMER_COMPLETION' THEN s->'sourceId' ELSE 'null'::JSONB END/u);
  assert.match(body,/'futureCompletionInsertCoverageComplete',FALSE/u);
  assert.match(body,/'sourceBindingComplete',FALSE/u);
  assert.match(body,/s\|\|JSONB_BUILD_OBJECT\('relation','public\.cash_shifts','id',s->'row'->'id'\)/u);
  assert.doesNotMatch(body,/\b(?:INSERT INTO|UPDATE|DELETE FROM|pg_advisory|FOR UPDATE|nextval)\b/u);
  const runtime=read('scripts/testing/run-phase5-inactive-collection-preparation-runtime.mjs');
  for(const marker of ['completionInventoryIdentityUnionRuntime','{inventoryUnion,movementAllocation,1,sourceId}',
    '{inventoryUnion,movementAllocation,1,movementId}','{inventoryUnion,plannedRows,0,row,quantity}',
    'PHASE5_COMPLETION_UNION_CHANGED_RETRY','m.row.operation_id','m.row.reservation_id']) assert.ok(runtime.includes(marker),marker);
});

test('all historical migration content retains the LF-portable pre-implementation fingerprint', () => {
  const files = readdirSync('supabase/migrations').filter((name) => /^\d+_.*\.sql$/u.test(name)
    && Number.parseInt(name,10) <= 127).sort();
  assert.equal(files.length,127);
  assert.equal(hash(JSON.stringify(files.map((name) => ({name,
    sha256:hash(read(`supabase/migrations/${name}`))})))),
  '800C26C5603DD5EBDED5DE4BC70A2FA53592B90139C3A72773464840F50B5150');
});

test('completion control identity plans preserve typed Legacy absence and owned modern receipt FK identity', () => {
  const body=migration.slice(migration.indexOf('-- Completion control identities and direct FK projection.'),migration.indexOf('-- Completion business-row samples.'));
  assert.ok(body.startsWith('-- Completion control identities'));
  assert.match(body,/complete_completion_identity_plan_v1/u);
  assert.match(body,/discover_customer_completion_union_v1\(/u);
  assert.match(body,/p IS DISTINCT FROM inventory_plan->'sourcePlan'->'sourcePlan'/u);
  assert.match(body,/ARRAY\['contextId','operationId','parentAuditId','historyId'\]/u);
  assert.match(body,/ARRAY\['contextId','historyId','completionAuditId','settlementAuditId','receipt'\]/u);
  assert.match(body,/domain','phase5-customer-parent-child-context-v1'/u);
  assert.match(body,/CARDINALITY\(ids\)<>\(SELECT COUNT\(DISTINCT id\)/u);
  assert.match(body,/ids && reserved/u);
  assert.match(body,/combined:=u->'plannedRows'\|\|control_rows/u);
  assert.match(body,/GROUP BY n->>'relation',n->>'id' HAVING COUNT\(\*\)<>1/u);
  assert.match(body,/shift_insert_fk_coverage_v1\(combined,existing\)/u);
  assert.match(body,/candidates:=\(u->'existingResources'\)\|\|\(source_union->'resources'\)/u);
  assert.match(body,/serverPostLockTransactionSlot/u);
  assert.match(body,/serverPostLockCompletionOutcomeSlot/u);
  assert.match(body,/'fullRowSemanticsComplete',FALSE/u);
  assert.match(body,/'sourceBindingComplete',FALSE/u);
  for(const kind of ['customer','legacy'])assert.ok(body.includes(`expected IS DISTINCT FROM phase5_private.plan_${kind}_completion_identity_union_v1(`));
  assert.doesNotMatch(body,/\b(?:INSERT INTO|UPDATE|DELETE FROM|pg_advisory|FOR UPDATE|nextval|transaction_timestamp|clock_timestamp)\b/u);
  const runtime=read('scripts/testing/run-phase5-inactive-collection-preparation-runtime.mjs');
  for(const marker of ['completionControlIdentityUnionRuntime','sequenceSame','partial-cliq',
    "'{allocation,historyId}'","'{childLink,childContextId}'",'constraints.filter(c=>c.relation===row.relation)'])assert.ok(runtime.includes(marker),marker);
});

test('completion business rows remain hypothetical source-bound samples with exact identities and sequence catalog drift guards', () => {
  const body=migration.slice(migration.indexOf('-- Completion business-row samples.'),completionLockUnionStart);
  for(const marker of ['derive_customer_completion_deltas_v1','derive_customer_completion_writes_v1',
    'derive_customer_completion_child_link_v1','derive_legacy_completion_model_v1','derive_legacy_completion_writes_v1',
    'supplied_ids IS DISTINCT FROM source_ids','ROW_SAMPLE_SEQUENCE_EXACT_SET_REQUIRED','ROW_SAMPLE_COLUMNS_INVALID',
    'ROW_SAMPLE_IDENTITY_SET_INVALID','pg_attribute','pg_sequence','pg_depend','d.objid IN','d.refobjid IN',
    "'authorityQualified',FALSE","'valuesAllocated',FALSE","'sampleOnly',TRUE",
    "'clockAndSequenceValuesAuthoritative',FALSE","'stockTriggerRowsComplete',FALSE","'executionAuthority',FALSE",
    "'durableClaimsCreated',FALSE","'locksHeld',FALSE","'sourceBindingComplete',FALSE",'BUSINESS_ROWS_CHANGED_RETRY'])assert.ok(body.includes(marker),marker);
  for(const kind of ['customer','legacy']) {
    assert.ok(body.includes(`PERFORM phase5_private.assert_${kind}_completion_identity_union_v1(`));
    assert.ok(body.includes(`expected IS DISTINCT FROM phase5_private.plan_${kind}_completion_business_rows_v1(`));
  }
  const executable=body.replace(/'(?:[^']|'')*'|--[^\n]*/gu,'');
  assert.doesNotMatch(executable,/\b(?:INSERT INTO|UPDATE|DELETE FROM|pg_advisory|FOR UPDATE|nextval|transaction_timestamp|txid_current)\b/u);
  const runtime=read('scripts/testing/run-phase5-inactive-collection-preparation-runtime.mjs');
  for(const marker of ['--completion-rows-focused','completionBusinessRowsRuntime','qa_row_sequences','sequenceSame',
    '20261004','20261005','1234567','PHASE5_PREPARATION_ONLY',"'{movementSequences,1,sourceId}'",
    'INCREMENT BY 2','REVOKE ALL ON SEQUENCE public.customer_payment_number_seq FROM anon'])assert.ok(runtime.includes(marker),marker);
});

test('completion stock-trigger rows are full ordered source-bound samples, never execution authority', () => {
  const marker='-- Stock-trigger row samples compose the retained ordered source model';
  const start=migration.indexOf(marker);assert.ok(start>0);
  assert.equal(hash(migration.slice(0,start)+'COMMIT;\n'),'64F65B3DD83996F85C1AFC310C102471E135F2E7ED2EA2AD29A8D34A3B65447B');
  const body=migration.slice(start,completionLockUnionStart);
  for(const s of ['derive_inventory_identity_manifest_v1','shift_inventory_side_effect_catalog_v1',
    'TRIGGER_ROW_COLUMNS_INVALID','TRIGGER_ROW_INSERT_EXACT_SET_REQUIRED','COMPLETION_TRIGGER_CLOCK_INVALID',
    'COMPLETION_TRIGGER_SOURCE_EXACT_SET_REQUIRED','COMPLETION_TRIGGER_INSERT_EXACT_SET_REQUIRED',
    "step->'deletedReads'","step->>'eventDisposition'='INSERT_NEW'",'instruction->\'before\' IS DISTINCT FROM step->\'balanceBefore\'',
    'ordinal IS DISTINCT FROM JSONB_ARRAY_LENGTH',"'triggerIdentitiesConsumed',FALSE","'futureWriteOwnershipComplete',FALSE",
    "'executionAuthority',FALSE",'shift_insert_fk_coverage_v1(combined',"GROUP BY n->>'relation',n->>'id' HAVING COUNT(*)<>1"])assert.ok(body.includes(s),s);
  for(const kind of ['customer','legacy'])assert.ok(body.includes(`expected IS DISTINCT FROM phase5_private.plan_${kind}_completion_trigger_rows_v1(`));
  const executable=body.replace(/'(?:[^']|'')*'|--[^\n]*/gu,'');
  assert.doesNotMatch(executable,/\b(?:INSERT INTO|UPDATE|DELETE FROM|pg_advisory|FOR UPDATE|nextval|clock_timestamp)\b/u);
  const runtime=read('scripts/testing/run-phase5-inactive-collection-preparation-runtime.mjs');
  for(const s of ['completionTriggerRowsRuntime','--completion-trigger-rows-focused','TRIGGER_ALERT_FULL_ROW_MISMATCH',
    'TRIGGER_EVENT_FULL_ROW_MISMATCH',"'{triggerSample,steps,1}'",'real unchanged trigger comparison'])assert.ok(runtime.includes(s),s);
});

test('completion execution groups bind synchronous stock effects and full per-identity prefixes without progress authority', () => {
  const marker='-- Completion execution groups are a preparation protocol.';
  const start=migration.indexOf(marker);assert.ok(start>0);
  assert.equal(hash(migration.slice(0,start)+'COMMIT;\n'),'17F9D96395FE8DA70B7839AFA575977104C6D6C139CF169E7BBEFD988223FD96');
  const body=migration.slice(start,completionLockUnionStart);
  for(const s of ['CONTEXT_PRELUDE','BALANCE_WITH_SYNCHRONOUS_TRIGGERS','pg_index','WITH ORDINALITY',
    'GROUP_ORDER_INVALID','GROUP_SOURCE_INVALID','GROUP_KEY_INVALID','GROUP_COLUMNS_INVALID','GROUP_PREFIX_INVALID',
    'GROUP_INSERT_SET_INVALID',"states->key->'row' IS DISTINCT FROM instruction->'before'",
    'actual_inserts IS DISTINCT FROM expected_inserts',"'sourceBindingComplete',FALSE","'progressRecorded',FALSE",
    "'executionAuthority',FALSE","'durableClaimsCreated',FALSE"])assert.ok(body.includes(s),s);
  for(const kind of ['customer','legacy'])assert.ok(body.includes(`expected IS DISTINCT FROM phase5_private.plan_${kind}_completion_execution_groups_v1(`));
  const executable=body.replace(/'(?:[^']|'')*'|--[^\n]*/gu,'');
  assert.doesNotMatch(executable,/\b(?:INSERT INTO|UPDATE|DELETE FROM|pg_advisory|FOR UPDATE|nextval|clock_timestamp|txid_current)\b/u);
  const runtime=read('scripts/testing/run-phase5-inactive-collection-preparation-runtime.mjs');
  for(const s of ['completionExecutionGroupsRuntime','g.beforeStates,state','g.writes.slice(1),s.writes',
    'ordered(insertRows),ordered(p.rowSample.plannedInsertRows)','repeated[1].source.onHandBefore',"'{progressRecorded}'",
    'PHASE5_COMPLETION_GROUPS_CHANGED_RETRY','composite read deletion must be exercised',
    'every execution-group fault must actually change the source-bound sample'])assert.ok(runtime.includes(s),s);
});

test('inactive context progress reconstructs exact per-write ownership without minting durable authority', () => {
  const marker='-- Context progress storage and deterministic ownership protocol, still inactive.';
  const start=migration.indexOf(marker);assert.ok(start>0);
  assert.equal(hash(migration.slice(0,start)+'COMMIT;\n'),'7FAE0A1453BE8DD0CDB595AE0F2CAEF43070FB7A23477A61197873BBCB773D63');
  const body=migration.slice(start,completionLockUnionStart);
  assert.match(body,/ADD COLUMN side_effect_progress JSONB/u);
  assert.match(body,/side_effect_progress IS NULL OR/u);
  for(const s of ['BEGIN_GROUP','OBSERVE_WRITE','FINISH_GROUP','PROGRESS_BEGIN_INVALID','PROGRESS_WRITE_INVALID',
    'PROGRESS_FINISH_INVALID','PROGRESS_AFTER_COMPLETE','PROGRESS_STATE_INVALID','PROGRESS_INCOMPLETE',
    "e->'instruction' IS DISTINCT FROM w",'consumed IS DISTINCT FROM claims',
    "states IS DISTINCT FROM protocol->'finalStates'",'previous IS DISTINCT FROM phase5_private.model_completion_progress_v1',
    "'durableClaimsCreated',FALSE","'progressRecorded',FALSE","'locksHeld',FALSE","'executionAuthority',FALSE"])
    assert.ok(body.includes(s),s);
  const executable=body.replace(/'(?:[^']|'')*'|--[^\n]*/gu,'');
  assert.doesNotMatch(executable,/\b(?:INSERT INTO|UPDATE|DELETE FROM|pg_advisory|FOR UPDATE|nextval|clock_timestamp|txid_current)\b/u);
  assert.equal((migration.match(/CREATE TRIGGER phase5_context_immutable BEFORE UPDATE OR DELETE/gu)??[]).length,1);
  const runtime=read('scripts/testing/run-phase5-inactive-collection-preparation-runtime.mjs');
  for(const s of ['completionProgressRuntime','observedInsertClaims,p.expectedInsertClaims','contextsNull',
    'PROGRESS_INCOMPLETE','AFTER_COMPLETE','no durable claim, held locks, writes or authority'])assert.ok(runtime.includes(s),s);
});

test('isolated SQL transport preserves exact Arabic row content across every UTF-8 chunk split', () => {
  const text=JSON.stringify({notes:'دفعة مستلمة عند تسليم طلب V2',name:'نكهة أ',id:'row-identity'});
  const bytes=Buffer.from(text,'utf8');
  let brokenSplits=0;
  for(let i=1;i<bytes.length;i++) {
    const parts=[bytes.subarray(0,i),bytes.subarray(i)];
    const decoder=new StringDecoder('utf8');
    assert.equal(parts.map(p=>decoder.write(p)).join('')+decoder.end(),text);
    if(parts.map(p=>p.toString('utf8')).join('')!==text)brokenSplits++;
  }
  assert.ok(brokenSplits>0,'fixture must expose independent Buffer-decoding corruption');
  const runtime=read('scripts/testing/run-phase5-inactive-collection-preparation-runtime.mjs');
  assert.equal((runtime.match(/child\.stdout\.setEncoding\('utf8'\);child\.stderr\.setEncoding\('utf8'\);/gu)??[]).length,2);
});

test('private inactive preparation cannot change current public authority', () => {
  assert.match(migration,/^BEGIN;/u); assert.match(migration,/COMMIT;\s*$/u);
  assert.equal((migration.match(/CREATE TABLE phase5_private\./gu) ?? []).length,4);
  assert.equal((migration.match(/CREATE FUNCTION phase5_private\./gu) ?? []).length,195);
  assert.equal((migration.match(/FORCE ROW LEVEL SECURITY/gu) ?? []).length,4);
  assert.equal((migration.match(/BEFORE INSERT OR UPDATE OR DELETE ON phase5_private\./gu) ?? []).length,4);
  assert.doesNotMatch(migration,/CREATE OR REPLACE|CREATE FUNCTION public\.|CREATE TRIGGER[^;]*ON public\.|SECURITY DEFINER|CREATE POLICY/u);
  // Strip SQL literals/comments, not function bodies: inquiry strings can
  // contain WITH GRANT OPTION, but an actual GRANT anywhere still fails.
  const executable=migration.replace(/'(?:[^']|'')*'|--[^\n]*|\/\*[\s\S]*?\*\//gu,'');
  assert.doesNotMatch(executable,/\bGRANT\b/iu);
  const writerStart = migration.indexOf('CREATE FUNCTION phase5_private.create_customer_payment_prelocked_v1');
  const writerEnd = migration.indexOf('CREATE FUNCTION phase5_private.resolve_collection_attempt_v2');
  const writer = migration.slice(writerStart,writerEnd);
  const parentStart=migration.indexOf('CREATE FUNCTION phase5_private.execute_customer_completion_prelocked_v1');
  const parentEnd=migration.indexOf('REVOKE ALL ON FUNCTION phase5_private.complete_customer_completion_context_v1');
  const legacyStart=migration.indexOf('CREATE FUNCTION phase5_private.record_legacy_completion_payment_prelocked_v1');
  const legacyEnd=migration.indexOf('-- Historical resolution is NOT an execution permit.');
  assert.doesNotMatch(migration.slice(0,writerStart)+migration.slice(writerEnd,parentStart)+migration.slice(parentEnd,legacyStart)+migration.slice(legacyEnd),
    /\b(?:UPDATE|INSERT INTO|DELETE FROM) public\./u);
  assert.deepEqual(writer.match(/\b(?:UPDATE|INSERT INTO|DELETE FROM) public\.\w+/gu),[
    'INSERT INTO public.customer_payments','INSERT INTO public.audit_logs','UPDATE public.orders']);
  assert.doesNotMatch(migration,/\bEXECUTE\s+format/u);
  assert.match(migration,/TRUE,0,'PRIVATE_INACTIVE'/u);
  assert.match(migration,/PHASE5_PREPARATION_ONLY/u);
  const parentDml=migration.slice(parentStart,parentEnd).match(/\b(?:UPDATE|INSERT INTO|DELETE FROM) public\.\w+/gu)??[];
  assert.equal(parentDml.length,16);
  assert.deepEqual([...new Set(parentDml)].sort(),[
    'INSERT INTO public.phase3_customer_cost_finalization_guards','INSERT INTO public.phase3_customer_lifecycle_transition_guards',
    'UPDATE public.inventory_balances','UPDATE public.order_inventory_reservations','INSERT INTO public.inventory_movements',
    'UPDATE public.order_parcel_components','UPDATE public.order_parcel_instances','UPDATE public.order_items','UPDATE public.orders',
    'INSERT INTO public.business_operations','INSERT INTO public.order_status_history','INSERT INTO public.audit_logs',
    'INSERT INTO public.customer_payments','DELETE FROM public.phase3_customer_cost_finalization_guards',
    'DELETE FROM public.phase3_customer_lifecycle_transition_guards'].sort());
  assert.equal((migration.match(/SECURITY INVOKER SET search_path = pg_catalog/gu) ?? []).length,195);
  assert.equal((migration.match(/ALTER FUNCTION[^;]*OWNER TO postgres/gu) ?? []).length,195);
  assert.deepEqual(migration.slice(legacyStart,legacyEnd).match(/\b(?:UPDATE|INSERT INTO|DELETE FROM) public\.\w+/gu),[
    'INSERT INTO public.customer_payments','UPDATE public.orders','UPDATE public.inventory_balances',
    'INSERT INTO public.inventory_movements','INSERT INTO public.order_status_history','INSERT INTO public.audit_logs']);
  assert.match(migration,/FROM PUBLIC,anon,authenticated,service_role/u);
});

test('inventory authority snapshot cannot self-approve residual rights or activate public writers', () => {
  const body=migration.slice(migration.indexOf('-- Owner-approved non-row authority overlay.'),completionLockUnionStart);
  for(const marker of ['inventory_authority_catalog_v1','assert_inventory_authority_snapshot_v1',
    'assert_inventory_authority_target_v1','reject_inventory_truncate_v1','pg_auth_members',
    'inherit_option','set_option','pg_default_acl','pg_attribute','has_any_column_privilege',
    'has_parameter_privilege','pg_get_functiondef','cron.job','pg_inherits','MAINTAIN',
    "t.tgtype=34","t.tgenabled='A'",'PHASE5_INVENTORY_PROHIBITED_AUTHORITY',
    'PHASE5_INVENTORY_AUTHORITY_DRIFT','PHASE5_INVENTORY_TRUNCATE_GUARD_INVALID']) assert.ok(body.includes(marker),marker);
  for(const name of ['products','inventory_balances','stock_alerts','stock_alert_reads','automation_events'])
    assert.ok(body.includes(`'${name}'`));
  assert.match(body,/'writerClosed',FALSE,'activationReady',FALSE,'executionAllowed',FALSE/u);
  assert.match(body,/expected IS DISTINCT FROM phase5_private\.inventory_authority_catalog_v1\(\)/u);
  assert.match(body,/'maximum',s\.seqmax::TEXT/u);
  assert.match(body,/'membershipAdmin',EXISTS/u);
  assert.match(body,/'roleEscalation'/u);
  assert.doesNotMatch(body,/pg_advisory|FOR UPDATE|FOR SHARE|set_config|\bINSERT INTO\b|\bUPDATE public\b|\bDELETE FROM\b|CREATE TRIGGER/u);
  const guard=body.slice(body.indexOf('CREATE FUNCTION phase5_private.reject_inventory_truncate_v1'),
    body.indexOf('REVOKE ALL ON FUNCTION phase5_private.reject_inventory_truncate_v1'));
  assert.doesNotMatch(guard,/\bIF\b|current_setting|generation|context|\bRETURN\b/u);
  assert.match(guard,/ERRCODE='42501',MESSAGE='PHASE5_INVENTORY_TRUNCATE_FORBIDDEN'/u);
  const runtime=read('scripts/testing/run-phase5-inactive-collection-preparation-runtime.mjs');
  for(const marker of ['--inventory-authority-focused','inventoryAuthorityRuntime',
    'ENABLE ALWAYS TRIGGER','SET LOCAL session_replication_role=replica',
    'ALTER DEFAULT PRIVILEGES','claim_automation_deliveries','complete_automation_delivery',
    'authority-snapshot-zero-write','authority-target-rollback-only']) assert.ok(runtime.includes(marker),marker);
});

test('typed inventory identities prove source-step bijection while remaining private unclaimed preparation', () => {
  const body=migration.slice(migration.indexOf('-- Typed identity preparation after fresh source planning.'),completionLockUnionStart);
  assert.ok(body.length>0);
  for(const marker of ['derive_inventory_identity_manifest_v1','assert_inventory_identity_manifest_v1',
    'plan_shift_inventory_identity_manifest_v1','plan_customer_inventory_identity_manifest_v1',
    'plan_legacy_inventory_identity_manifest_v1','PHASE5_IDENTITY_MANIFEST_CHANGED_RETRY',
    'PHASE5_IDENTITY_MODEL_CHANGED_RETRY','PHASE5_IDENTITY_PARENT_COLLISION',
    'uuidClaims','eventKeyBindings','readDeletions','ownerOrdinal','ownerStepId','authoritySnapshot']) assert.ok(body.includes(marker),marker);
  assert.match(body,/fresh:=phase5_private\.model_inventory_alert_steps_v1\(actor,model->'sourceSteps',model->'allocation'\)/u);
  assert.match(body,/model IS DISTINCT FROM fresh/u);
  assert.match(body,/planned_rows IS DISTINCT FROM fresh->'plannedInserts'/u);
  assert.match(body,/expected IS DISTINCT FROM phase5_private\.derive_inventory_identity_manifest_v1/u);
  assert.match(body,/new_ids && reserved_identities/u);
  assert.match(body,/'source',step->'source','row',step->'alertAfter'/u);
  assert.match(body,/'source',step->'source','row',step->'storedEvent'/u);
  assert.match(body,/REUSE_EARLIER_PLANNED/u);
  assert.match(body,/first_claim:=NULL/u);
  assert.match(body,/'durableClaimsCreated',FALSE/u);
  assert.doesNotMatch(body,/pg_advisory|FOR UPDATE|FOR SHARE|set_config|\bINSERT INTO\b|\bUPDATE public\b|\bDELETE FROM\b|CREATE TRIGGER/u);
  for(const name of ['derive_inventory_identity_manifest_v1','assert_inventory_identity_manifest_v1',
    'plan_shift_inventory_identity_manifest_v1','plan_customer_inventory_identity_manifest_v1','plan_legacy_inventory_identity_manifest_v1']) {
    assert.match(body,new RegExp(`REVOKE ALL ON FUNCTION phase5_private\\.${name}[^;]*FROM PUBLIC,anon,authenticated,service_role;`,'u'));
  }
  const runtime=read('scripts/testing/run-phase5-inactive-collection-preparation-runtime.mjs');
  for(const marker of ['--inventory-identity-focused','inventoryIdentityManifestRuntime','FOCUSED_INVENTORY_IDENTITY_MANIFEST',
    'PHASE5_IDENTITY_PARENT_COLLISION','PHASE5_IDENTITY_ACTOR_UNAUTHORIZED',
    "'{identityManifest,uuidClaims,1}'","'{identityManifest,eventKeyBindings,0,ownerOrdinal}'",
    "'{identityManifest,durableClaimsCreated}'",'adversarial:scenario===\'missing-active-alert\'']) assert.ok(runtime.includes(marker),marker);
});

test('authority drift covers procedures, bidirectional sequence dependencies and job destinations', () => {
  const body=migration.slice(migration.indexOf('CREATE FUNCTION phase5_private.inventory_authority_catalog_v1'),completionLockUnionStart),
    runtime=read('scripts/testing/run-phase5-inactive-collection-preparation-runtime.mjs');
  assert.match(body,/p\.prokind IN \('f','p','w'\)/u);
  assert.match(body,/'kind',p\.prokind/u);
  assert.match(body,/'sequenceDependencies'/u);
  assert.match(body,/d\.classid='pg_catalog\.pg_class'::REGCLASS AND d\.objid IN/u);
  assert.match(body,/d\.refclassid='pg_catalog\.pg_class'::REGCLASS AND d\.refobjid IN/u);
  assert.match(body,/'nodeNameSha256',ENCODE\(extensions\.digest\(j\.nodename,'sha256'\),'hex'\),'nodePort',j\.nodeport/u);
  for(const marker of ['new-procedure','procedure-execute-grant','procedure-body','procedure-search-path',
    'procedure-owner','sequence-owned-by','sequence-ownership-removed','sequence-incoming-default',
    'sequence-incoming-default-removed','PROCEDURE_FAULT_NOT_INJECTED','SEQUENCE_FAULT_NOT_INJECTED',
    'JOB_FAULT_NOT_INJECTED',"for(const field of ['nodeport','nodename'])",'active:=false'])
    assert.ok(runtime.includes(marker),marker);
  assert.match(runtime,/fails\(`\$\{setup\} \$\{freeze\} \$\{mutation\} \$\{proof\} \$\{compare\}`/u);
  assert.ok(runtime.includes('Authority completeness probe failed: ${name}'));
});

test('callable authority is kind-complete with aggregate support closure and fail-closed structural validation', () => {
  const body=migration.slice(migration.indexOf('CREATE FUNCTION phase5_private.inventory_authority_catalog_v1'),completionLockUnionStart),
    runtime=read('scripts/testing/run-phase5-inactive-collection-preparation-runtime.mjs');
  assert.match(body,/routine_closure\(oid\) AS/u);
  assert.match(body,/FROM callable_closure r JOIN callable_edges e/u);
  assert.match(body,/e\.classid=r\.classid AND e\.objid=r\.oid/u);
  assert.match(body,/LEFT JOIN pg_catalog\.pg_aggregate a ON a\.aggfnoid=p\.oid/u);
  assert.match(body,/WHEN p\.prokind='a' THEN ENCODE\(extensions\.digest\(TO_JSONB\(a\)::TEXT,'sha256'\)/u);
  assert.match(body,/'catalogSha256',ENCODE\(extensions\.digest\(TO_JSONB\(p\)::TEXT,'sha256'\)/u);
  assert.match(body,/f->>'kind' NOT IN \('f','p','w','a'\)/u);
  assert.match(body,/PHASE5_INVENTORY_CALLABLE_KIND_UNSUPPORTED/u);
  assert.match(body,/'routineDependencies'/u);
  assert.match(body,/'routineOperators'/u);
  assert.match(body,/SELECT p\.pronamespace FROM pg_catalog\.pg_proc p WHERE p\.oid IN \(SELECT oid FROM routine_closure\)/u);
  assert.doesNotMatch(body,/WHERE[^;]*p\.prokind IN \('f','p'\)/u);
  for(const marker of ['new-window','window-execute-grant','window-body','window-config','window-owner',
    'new-aggregate','aggregate-execute-grant','aggregate-support-body','aggregate-support-owner',
    'aggregate-support-config','aggregate-support-acl','aggregate-owner','aggregate-definition-same-count',
    'aggregate-support-retarget','aggregate-metadata-same-oid','aggregate-support-schema-acl',
    'routine-operator-owner','routine-operator-support-body','OPERATOR_DEPENDENCY_NOT_BOUND',
    'WINDOW_NOT_EXECUTED','AGGREGATE_NOT_EXECUTED',
    'qa_callable_support','supportCaptured','aggregateCaptured','qa_forbidden_window',
    'qa_forbidden_aggregate',"SET prokind='x'",'DELETE FROM pg_catalog.pg_aggregate'])
    assert.ok(runtime.includes(marker),marker);
});

test('pinned direct catalog references cannot disappear behind missing pg_depend edges', () => {
  const body=migration.slice(migration.indexOf('CREATE FUNCTION phase5_private.inventory_authority_catalog_v1'),completionLockUnionStart),
    runtime=read('scripts/testing/run-phase5-inactive-collection-preparation-runtime.mjs');
  for(const field of ['aggtransfn','aggfinalfn','aggcombinefn','aggserialfn','aggdeserialfn',
    'aggmtransfn','aggminvtransfn','aggmfinalfn','aggsortop','prosupport',
    'oprcode','oprrest','oprjoin','oprcom','oprnegate']) assert.ok(body.includes(`.${field}`),field);
  assert.match(body,/callable_edges\(classid,objid,refclassid,refobjid\) AS/u);
  assert.match(body,/operator_closure\(oid\) AS/u);
  assert.match(body,/'callableReferences'/u);
  assert.match(body,/envelope->'referenceClosureValid' IS DISTINCT FROM 'true'::JSONB/u);
  assert.match(body,/PHASE5_INVENTORY_CALLABLE_REFERENCE_INVALID/u);
  assert.match(body,/o\.oid IN \(SELECT oid FROM operator_closure\)/u);
  for(const marker of ['pinned-support-config','pinned-support-owner','pinned-support-acl',
    'pinned-support-definition','pinned-sortop-implementation','pinned-sortop-restriction',
    'pinned-sortop-join','pinned-operator-support-config','pinned-routine-planner-support',
    'pinned-missing-reference','pinned-reference-wire','PINNED_REFERENCE_NOT_CAPTURED',
    'PINNED_FAULT_NOT_INJECTED']) assert.ok(runtime.includes(marker),marker);
});

test('owner-approved inventory-trigger resource overlay preserves the reviewed base and cannot become authority', () => {
  const delta=task.slice5ShiftSourceClosureDesignDelta;
  assert.equal(delta.baseReviewedDesignSha256,'9A74EB14788EA668BDE88DAC95561AD8DA2F734EC47EAA87491AB0F181E06099');
  assert.deepEqual(delta.activationFenceAdditionalRelations,['public.stock_alert_reads','public.stock_alerts']);
  assert.equal(delta.breakMatrix.length,13);
  const body=migration.slice(migration.indexOf('CREATE FUNCTION phase5_private.shift_inventory_side_effect_catalog_v1'),completionLockUnionStart);
  for(const marker of ['PG_GET_FUNCTIONDEF','PG_GET_TRIGGERDEF','PG_GET_CONSTRAINTDEF','pg_sequence',
    'PHASE5_SHIFT_SIDE_EFFECT_FUNCTION_DRIFT','PHASE5_SHIFT_SIDE_EFFECT_TRIGGER_DRIFT',
    'PHASE5_SHIFT_SIDE_EFFECT_FK_DRIFT','PHASE5_SHIFT_SIDE_EFFECT_INDEX_DRIFT',
    'PHASE5_SHIFT_SIDE_EFFECT_SEQUENCE_DRIFT','stock_alert_id','user_id',
    'futureAlertIdentityAllocated','futureOutboxKeyAllocated','EXISTING_INVENTORY_ALERT_TRIGGER_DOMAIN_ONLY']) assert.ok(body.includes(marker),marker);
  assert.ok(body.indexOf("public.assert_reversal_owner('")<body.indexOf('catalog:=phase5_private.shift_inventory_side_effect_catalog_v1()'));
  assert.match(body,/'maximum',s\.seqmax::TEXT/u);
  assert.match(body,/expected IS DISTINCT FROM phase5_private\.discover_shift_inventory_side_effects_v1/u);
  assert.doesNotMatch(body,/pg_advisory|FOR UPDATE|FOR SHARE|FOR KEY SHARE|\bINSERT INTO\b|\bDELETE FROM\b|\bUPDATE public\b|set_config|NEXTVAL\(/u);
  assert.match(migration,/'inventorySideEffects',side_effects,'compositeResources',side_effects->'compositeResources'/u);
  const runtime=read('scripts/testing/run-phase5-inactive-collection-preparation-runtime.mjs');
  for(const marker of ['shift-side-effect-domains','shift-side-effect-content-drift','shift-side-effect-catalog-drift',
    'shift-side-effect-public-trigger-regression','stockAlertReads','automationEvents']) assert.ok(runtime.includes(marker),marker);
});

test('future trigger UUID ownership review cannot masquerade as execution or completed source closure', () => {
  const alerts=read('supabase/migrations/014_simple_inventory_operations.sql');
  const automation=read('supabase/migrations/099_advanced_monitoring_and_business_integrity.sql');
  const stockTrigger=read('supabase/migrations/057_secure_n8n_automation_events.sql');
  assert.match(alerts,/id UUID PRIMARY KEY DEFAULT gen_random_uuid\(\)/u);
  assert.match(alerts,/INSERT INTO public\.stock_alerts \(\s*product_id,\s*warehouse_id,\s*severity,/u);
  assert.match(automation,/INSERT INTO public\.automation_events\(event_key, event_type, entity_id, payload\)/u);
  assert.match(automation,/ON CONFLICT \(event_key\) DO NOTHING/u);
  assert.ok(stockTrigger.includes("'stock_alert:' || NEW.id::TEXT || ':' || NEW.severity || ':'"));
  assert.ok(stockTrigger.includes('floor(extract(epoch FROM NEW.last_updated_at))::BIGINT::TEXT'));
  const runtime=read('scripts/testing/run-phase5-inactive-collection-preparation-runtime.mjs');
  const start=runtime.indexOf('const shiftTriggerIdentityReviewRuntime =');
  const end=runtime.indexOf('\nconst inventoryIdentityManifestRuntime =',start);
  assert.ok(start>0 && end>start);
  const review=runtime.slice(start,end);
  assert.match(review.trimEnd(),/\};$/u);
  for(const marker of ['existing-key','missing-outbox-key','missing-active-alert',
    'allocate_shift_context_plan_v1','reverse_cash_shift_with_operations','actualIdsOutsidePlannedInsertSet',
    'plannedNewAlertOrOutboxRows','eventWasPlanned','alertWasPlanned','stillPreparation',
    'keyMatchesActualAlertAndSourceTime','ROLLBACK','await fingerprint(),before']) assert.ok(review.includes(marker),marker);
  assert.ok(runtime.includes("'FOCUSED_SHIFT_TRIGGER_IDENTITY_SOURCE_REVIEW'"));
  assert.ok(runtime.includes('assertPhase5DbLint(lint.stdout)'));
  assert.doesNotMatch(review,/CREATE (?:OR REPLACE )?FUNCTION|ALTER (?:TABLE|FUNCTION)|DISABLE TRIGGER|session_replication_role|phase5_preallocated|authority_generation SET/u);
  assert.match(migration,/'sourceWriteTriggerClosureComplete',FALSE/u);
  assert.match(migration,/'futureWriteOwnershipComplete',FALSE/u);
});

test('shared inventory side-effect model binds ordered tuples and allocated identities without claiming execution', () => {
  const body=migration.slice(migration.indexOf('CREATE FUNCTION phase5_private.model_inventory_alert_steps_v1'),completionLockUnionStart);
  for(const marker of ['PHASE5_SIDE_EFFECT_BALANCE_CHAIN_INVALID','PHASE5_SIDE_EFFECT_ALLOCATION_EXACT_SET_REQUIRED',
    'PHASE5_SIDE_EFFECT_UNUSED_IDENTITY_INVALID','PHASE5_SIDE_EFFECT_FUTURE_ID_ALREADY_OWNED',
    'PHASE5_SIDE_EFFECT_EVENT_IDENTITY_CONFLICT','REUSE_PREEXISTING','REUSE_EARLIER_PLANNED',
    'transaction_timestamp()','deletedReads','eventInvocation','storedEvent','foreignKeys',
    'assert_shift_context_plan_v1','SIDE_EFFECT_IDENTITIES_NOT_CLAIMED']) assert.ok(body.includes(marker),marker);
  assert.ok(body.indexOf('actor IS DISTINCT FROM auth.uid()')<body.indexOf('FROM public.automation_events'));
  assert.match(body,/alert_id:=CASE WHEN allocation IS NULL THEN gen_random_uuid\(\) ELSE phase5_private\.wire_uuid_v1/u);
  assert.match(body,/balance_before->'on_hand_quantity' IS DISTINCT FROM step->'onHandBefore'/u);
  assert.match(body,/alloc->'stepId' IS DISTINCT FROM step->'stepId'/u);
  assert.match(body,/expected IS DISTINCT FROM phase5_private\.complete_shift_inventory_side_effect_plan_v1/u);
  assert.match(body,/'completeFor','HYPOTHETICAL_TYPED_TRANSITIONS_ONLY','sourceBindingComplete',FALSE/u);
  assert.match(body,/'executionAuthority',FALSE,'locksHeld',FALSE,'futureWriteOwnershipComplete',FALSE/u);
  assert.doesNotMatch(body,/\bINSERT INTO\b|\bUPDATE public\b|\bDELETE FROM\b|pg_advisory|FOR UPDATE|FOR SHARE|set_config|NEXTVAL\(/u);
  const runtime=read('scripts/testing/run-phase5-inactive-collection-preparation-runtime.mjs');
  for(const marker of ['--inventory-side-effect-plan-focused','inventory-side-effect-source-binding',
    'inventory-side-effect-ordered-model','inventory-side-effect-plan-corruption','inventory-side-effect-role-denial']) {
    assert.ok(runtime.includes(marker),marker);
  }
});

test('Customer and Legacy side-effect adapters derive per-source ordered transitions without widening public authority', () => {
  const auth=migration.slice(migration.indexOf('CREATE FUNCTION phase5_private.authorize_inventory_side_effect_actor_v1'),
    migration.indexOf('CREATE FUNCTION phase5_private.discover_inventory_side_effects_v1'));
  assert.ok(auth.indexOf('actor IS DISTINCT FROM auth.uid()')<auth.indexOf('public.assert_reversal_owner('));
  assert.match(auth,/WHEN 'CUSTOMER_COMPLETION' THEN\s+PERFORM phase5_private\.authorize_coordinator_actor_v1\(actor,TRUE\)/u);
  assert.match(auth,/r\.code IN \('owner','admin','manager','sales'\)/u);
  assert.ok(auth.includes('PHASE5_SIDE_EFFECT_SOURCE_KIND_INVALID'));
  const body=migration.slice(migration.indexOf('CREATE FUNCTION phase5_private.plan_customer_inventory_side_effects_v1'),completionLockUnionStart);
  for(const marker of ['discover_customer_completion_plan_v1','discover_legacy_completion_resources_v1',
    'CUSTOMER_SOURCE_ORDERED_SIDE_EFFECT_MODEL_ONLY','LEGACY_SOURCE_ORDERED_SIDE_EFFECT_MODEL_ONLY',
    'PRODUCT_THEN_RESERVATION_UUID','ORDER_ITEM_UUID','PHASE5_SIDE_EFFECT_SOURCE_CAPACITY_INVALID',
    'expected IS DISTINCT FROM phase5_private.plan_customer_inventory_side_effects_v1',
    'expected IS DISTINCT FROM phase5_private.plan_legacy_inventory_side_effects_v1']) assert.ok(body.includes(marker),marker);
  assert.match(body,/'operationId',parent->'creation'->'id'/u);
  assert.match(body,/'componentId',NULL,'operationId',NULL/u);
  assert.match(migration,/PHASE5_SIDE_EFFECT_LEGACY_IDENTITY_INVALID/u);
  assert.doesNotMatch(body,/\bINSERT INTO\b|\bUPDATE public\b|\bDELETE FROM\b|pg_advisory|FOR UPDATE|FOR SHARE|set_config|NEXTVAL\(/u);
  const runtime=read('scripts/testing/run-phase5-inactive-collection-preparation-runtime.mjs');
  assert.ok(runtime.includes('completionSideEffectAdaptersRuntime'));
  assert.ok(runtime.includes('completion-side-effect-source-binding'));
  const shiftWrapper=migration.slice(migration.indexOf('CREATE FUNCTION phase5_private.discover_shift_inventory_side_effects_v1'),
    migration.indexOf('CREATE FUNCTION phase5_private.assert_shift_inventory_side_effects_unchanged_v1'));
  assert.ok(shiftWrapper.indexOf('PHASE5_SHIFT_ACTOR_UNAUTHORIZED')<shiftWrapper.indexOf('RETURN phase5_private.discover_inventory_side_effects_v1'));
  assert.match(shiftWrapper,/actor IS NULL OR actor IS DISTINCT FROM auth.uid\(\)/u);
  assert.ok(runtime.includes('/42501.*PHASE5_SHIFT_ACTOR_UNAUTHORIZED/u'));
});

test('Shift payment instruction discovery is exact-source, explicit-tender, read-only and not complete batch authority', () => {
  const body=migration.slice(migration.indexOf('CREATE FUNCTION phase5_private.assert_shift_payment_instructions_v1'),shiftDiscoveryEnd);
  const discovery=body.slice(body.indexOf('CREATE FUNCTION phase5_private.discover_shift_payment_instructions_v1'));
  assert.match(body,/JSONB_TYPEOF\(instructions\) IS DISTINCT FROM 'array'/u);
  for(const identity of ['originalPaymentId','originalCollectionId','idempotencyKey']) {
    assert.ok(body.includes(`GROUP BY n->>'${identity}' HAVING COUNT(*)<>1`));
  }
  assert.ok(discovery.indexOf('actor IS DISTINCT FROM auth.uid()')<discovery.indexOf('FROM public.cash_shifts'));
  assert.ok(discovery.indexOf('assert_reversal_owner(')<discovery.indexOf('FROM public.cash_shifts'));
  assert.match(discovery,/actual IS DISTINCT FROM expected/u);
  assert.match(discovery,/p\.order_id IS DISTINCT FROM \(r->>'orderId'\)::UUID/u);
  assert.match(discovery,/c\.id IS DISTINCT FROM \(r->>'originalCollectionId'\)::UUID/u);
  assert.match(discovery,/read_order_financial_facts_v1\(p.order_id\)/u);
  assert.match(body,/r->'executionShiftId' IS DISTINCT FROM 'null'::JSONB/u);
  assert.match(discovery,/t\.id=\(r->>'executionShiftId'\)::UUID AND t.branch_id=o.branch_id AND t.status='open'/u);
  assert.match(discovery,/CUSTOMER_PAYMENT_SOURCE_BINDING_ONLY/u);
  assert.match(discovery,/phase4_full_shift_context_snapshot_internal\(shift_identity\)/u);
  assert.match(discovery,/expected IS DISTINCT FROM phase5_private\.discover_shift_payment_instructions_v1/u);
  assert.doesNotMatch(body,/pg_advisory|FOR UPDATE|FOR SHARE|FOR KEY SHARE|\bINSERT\b|\bUPDATE public\b|\bDELETE\b|set_config|anchor_existing_collection|lock_coordinator_context|coordinate_payment_reversal/u);
  const runtime=read('scripts/testing/run-phase5-inactive-collection-preparation-runtime.mjs');
  for(const marker of ['--shift-payment-discovery-focused','shiftInstructionRuntime',
    'shift-instruction-explicit-cross-tender','shift-instruction-exact-set',
    'shift-instruction-read-only','shift-instruction-source-drift','shift-instruction-role-denial']) {
    assert.ok(runtime.includes(marker),marker);
  }
});

test('Shift payment union validates complete per-Order candidate capacity and freezes a sorted partial resource domain', () => {
  const body=migration.slice(migration.indexOf('CREATE FUNCTION phase5_private.derive_payment_reversal_candidate_v1'),shiftDiscoveryEnd);
  assert.match(body,/WHERE s=n\)<>1/u);
  assert.match(body,/GROUP BY s->>'kind',s->>'sourceId' HAVING COUNT\(\*\)<>1/u);
  assert.match(body,/candidate := coverage - amount/u);
  assert.match(body,/outstanding := total - candidate - debt/u);
  assert.match(body,/collected_delivery := delivery - LEAST\(delivery,outstanding\)/u);
  assert.match(body,/candidate < refund \+ collected_delivery/u);
  assert.match(body,/amount := amount \+ phase5_private.money_v1\(n->'amountInMinorUnits'\)/u);
  assert.doesNotMatch(body,/partial.*amount\s+(?:BIGINT|NUMERIC)|amount_paid_in_minor_units|current.*WAC/u);
  assert.match(body,/discover_shift_payment_instructions_v1\(actor,shift_identity,instructions\)/u);
  assert.match(body,/collection_plan_resources_v2\(order_identity,facts\)/u);
  assert.match(body,/COUNT\(DISTINCT n->'row'\)<>1/u);
  assert.match(body,/THEN 'UPDATE' ELSE 'KEY_SHARE' END/u);
  for(const field of ['keyGates','rootGates','sharedGates','shifts','parents','actorRoles','capacities','resources']) {
    assert.ok(body.includes(`'${field}'`),field);
  }
  assert.match(body,/PHASE5_SHIFT_CHILD_KEY_ALREADY_OWNED/u);
  assert.match(body,/CUSTOMER_PAYMENT_REVERSAL_CHILDREN_ONLY/u);
  assert.match(body,/DISCOVERED_UNION_NOT_LOCKED/u);
  assert.doesNotMatch(body,/pg_advisory|FOR UPDATE|FOR SHARE|FOR KEY SHARE|\bINSERT\b|\bDELETE\b|\bUPDATE public\b|set_config|EXECUTE/u);
  const runtime=read('scripts/testing/run-phase5-inactive-collection-preparation-runtime.mjs');
  for(const marker of ['shift-payment-union-capacity','shift-payment-union-resources','shift-payment-union-drift',
    'shift-payment-union-multiple-roots-and-historical-Shift','addAnotherSale','historicalSource',
    'jointReversal','candidateCoverageInMinorUnits','assert_shift_payment_union_unchanged_v1']) assert.ok(runtime.includes(marker),marker);
});

test('retained Shift discovery freezes complete source rows and existing domains without eligibility or lock authority', () => {
  const body=migration.slice(migration.indexOf('CREATE FUNCTION phase5_private.discover_shift_retained_resources_v1'),shiftDiscoveryEnd);
  assert.ok(body.indexOf('public.assert_reversal_owner(')<body.indexOf('SELECT * INTO STRICT s'));
  assert.match(body,/phase4_supplier_context_snapshot_internal\(NULL,NULL,p.id\)/u);
  assert.match(body,/SELECT id FROM public.supplier_payments WHERE cash_shift_id=shift_identity UNION ALL/u);
  for(const relation of ['supplier_payments','supplier_payment_reversals','supplier_receipts','supplier_receipt_items',
    'supplier_receipt_commercial_lines','purchase_receipts','purchase_receipt_items','purchase_receipt_commercial_lines',
    'purchase_orders','purchase_order_items','suppliers','operational_expenses','pos_sale_reversals',
    'order_parcel_components','inventory_balances','inventory_movements','cash_shift_reversal_operations']) {
    assert.ok(body.includes(`public.${relation}`),relation);
  }
  assert.match(body,/public.inventory_balances t WHERE product_id=ANY\(product_ids\)/u);
  assert.match(body,/public.inventory_movements t WHERE product_id=ANY\(product_ids\)/u);
  assert.match(body,/supplier-payment-reversal:/u);
  assert.match(body,/RETAINED_SOURCE_RESOURCE_SNAPSHOT_ONLY/u);
  assert.match(body,/'executionAuthority',FALSE/u);
  assert.match(body,/expected IS DISTINCT FROM phase5_private.discover_shift_retained_resources_v1/u);
  assert.doesNotMatch(body,/pg_advisory|FOR UPDATE|FOR SHARE|\bINSERT\b|\bDELETE\b|\bUPDATE public\b|set_config|EXECUTE/u);
  const runtime=read('scripts/testing/run-phase5-inactive-collection-preparation-runtime.mjs');
  for(const marker of ['shift-retained-real-sources','shift-retained-content-drift','retainedWithSources',
    'discover_shift_retained_resources_v1','assert_shift_retained_resources_unchanged_v1']) assert.ok(runtime.includes(marker),marker);
});

test('Shift resource merge rejects contradictory content and fixes strongest modes/ranks without execution authority', () => {
  const body=migration.slice(migration.indexOf('CREATE FUNCTION phase5_private.merge_shift_resource_snapshots_v1'),shiftDiscoveryEnd);
  assert.match(body,/JSONB_TYPEOF\(rows_to_merge\) IS DISTINCT FROM 'array'/u);
  assert.match(body,/COUNT\(DISTINCT n->'row'\)<>1/u);
  assert.match(body,/wire_uuid_v1\(candidate->'id'\)/u);
  assert.match(body,/MAX\(CASE n->>'mode' WHEN 'UPDATE' THEN 4/u);
  assert.match(body,/ORDER BY rank,ordinal,relation_name COLLATE "C",identity COLLATE "C"/u);
  assert.match(body,/WHEN 'public.supplier_receipts' THEN 0 WHEN 'public.purchase_receipts' THEN 1/u);
  assert.match(body,/WHEN 'public.purchase_orders' THEN 2 WHEN 'public.suppliers' THEN 3/u);
  assert.match(body,/payments->'sourcePlan'->'sourceContext' IS DISTINCT FROM retained->'sourceContext'/u);
  assert.match(body,/payments->'actorRoles' IS DISTINCT FROM retained->'actorRoles'/u);
  assert.match(body,/'futureBatchChildIdentityComplete',FALSE/u);
  assert.match(body,/'executionAuthority',FALSE/u);
  assert.match(body,/MERGED_SOURCE_RESOURCES_ONLY/u);
  assert.match(body,/expected IS DISTINCT FROM phase5_private.discover_shift_merged_resources_v1/u);
  assert.doesNotMatch(body,/pg_advisory|FOR UPDATE|FOR SHARE|\bINSERT\b|\bDELETE\b|\bUPDATE public\b|set_config|EXECUTE/u);
  const runtime=read('scripts/testing/run-phase5-inactive-collection-preparation-runtime.mjs');
  for(const marker of ['shift-merged-exact-resources','shift-merged-pure-adversarial','shift-merged-drift',
    'discover_shift_merged_resources_v1','assert_shift_merged_resources_unchanged_v1']) assert.ok(runtime.includes(marker),marker);
});

test('Shift batch preallocation binds exact sources/request/keys and cannot claim execution or complete FK authority', () => {
  const body=migration.slice(migration.indexOf('CREATE FUNCTION phase5_private.derive_shift_batch_sources_v1'),shiftDiscoveryEnd);
  for(const kind of ['customer_payment','pos_sale','supplier_payment','operational_expense']) assert.ok(body.includes(`'${kind}'`));
  assert.match(body,/n->'row'->>'cash_shift_id'=plan->>'shiftId'/u);
  assert.match(body,/stripped IS DISTINCT FROM sources/u);
  assert.match(body,/COUNT\(DISTINCT id\) FROM UNNEST\(all_ids\)/u);
  assert.match(body,/expected->'request' IS DISTINCT FROM request/u);
  assert.match(body,/expected->'sourcePlan' IS DISTINCT FROM fresh/u);
  assert.match(body,/expected->'keyGates' IS DISTINCT FROM keys/u);
  assert.match(body,/PHASE5_SHIFT_BATCH_DUPLICATE_KEY/u);
  assert.match(body,/PHASE5_SHIFT_BATCH_FUTURE_ID_ALREADY_OWNED/u);
  for(const relation of ['cash_shift_reversals','cash_shift_reversal_operations','pos_sale_reversals',
    'supplier_payment_reversals','audit_logs','business_operations','financial_operation_events',
    'payment_reversal_events','mutation_contexts','collection_attempt_envelopes']) assert.ok(body.includes(relation));
  assert.match(body,/'shift:'\|\|batch_id::TEXT\|\|':pos:'/u);
  assert.match(body,/'shift:'\|\|batch_id::TEXT\|\|':supplier:'/u);
  assert.match(body,/BATCH_HEADER_CHILD_PRIMITIVE_IDENTITY_ONLY/u);
  assert.match(body,/PREALLOCATED_IDENTITIES_NOT_CLAIMED/u);
  assert.match(body,/'executionAuthority',FALSE/u);
  assert.doesNotMatch(body,/pg_advisory|FOR UPDATE|FOR SHARE|\bINSERT\b|\bDELETE\b|\bUPDATE public\b|set_config|EXECUTE/u);
  const runtime=read('scripts/testing/run-phase5-inactive-collection-preparation-runtime.mjs');
  for(const marker of ['shift-batch-identity-read-only','shift-batch-identity-adversarial',
    'allocate_shift_batch_identity_v1','assert_shift_batch_identity_v1']) assert.ok(runtime.includes(marker),marker);
});

test('Shift planned insert manifest proves per-item identities and catalog FK parents without admitting execution', () => {
  const body=migration.slice(migration.indexOf('CREATE FUNCTION phase5_private.shift_pos_inventory_identities_v1'),shiftDiscoveryEnd);
  assert.match(body,/phase3_pos_reversal_inventory_rows_internal/u);
  assert.match(body,/stripped IS DISTINCT FROM inventory/u);
  assert.match(body,/GROUP BY n->>'orderId',n->>'orderItemId',n->>'parcelComponentId'/u);
  assert.match(body,/pg_constraint/u); assert.match(body,/UNNEST\(fk.conkey,fk.confkey\)/u);
  assert.match(body,/PHASE5_SHIFT_FK_COLUMN_UNPLANNED/u);
  assert.match(body,/matches<>1/u); assert.match(body,/PHASE5_SHIFT_FK_PARTIAL_NULL_INVALID/u);
  assert.match(body,/serverPostLockEventSlot/u);
  assert.match(body,/'transactionContextComplete',FALSE/u);
  assert.match(body,/'sourceWriteTriggerClosureComplete',FALSE/u);
  assert.match(body,/PLANNED_INSERT_FK_AND_POS_INVENTORY_ONLY/u);
  assert.match(body,/expected IS DISTINCT FROM phase5_private.complete_shift_batch_manifest_v1/u);
  assert.doesNotMatch(body,/pg_advisory|FOR UPDATE|FOR SHARE|\bINSERT INTO\b|\bDELETE\b|\bUPDATE public\b|set_config|\bEXECUTE\b|CURRENT_TIMESTAMP|CLOCK_TIMESTAMP/u);
  const runtime=read('scripts/testing/run-phase5-inactive-collection-preparation-runtime.mjs');
  for(const marker of ['shift-manifest-exact-inventory','shift-manifest-fk-adversarial','shift-manifest-full-drift']) assert.ok(runtime.includes(marker),marker);
});

test('Shift-rooted private contexts preserve Order authority and exact transaction/actor/parent identity without activation', () => {
  const schema=migration.slice(migration.indexOf('CREATE TABLE phase5_private.mutation_contexts'),
    migration.indexOf('CREATE TABLE phase5_private.collection_attempt_envelopes'));
  assert.match(schema,/purpose <> 'SHIFT_REVERSAL' AND order_id IS NOT NULL/u);
  assert.match(schema,/shift_source_kind = 'BATCH' AND shift_source_id = shift_id AND order_id IS NULL/u);
  assert.match(schema,/shift_source_kind IN \('supplier_payment','operational_expense'\) AND order_id IS NULL/u);
  assert.match(schema,/parent_context_id IS NOT NULL AND parent_context_id <> id/u);
  assert.match(schema,/parent_context_kind IS NOT NULL AND parent_context_kind = 'BATCH'/u);
  assert.match(schema,/\(parent_context_id,transaction_id,generation,actor_id,shift_id,parent_context_kind\)/u);
  assert.match(schema,/shift_source_kind = 'pos_sale' AND order_id IS NOT NULL AND order_id = shift_source_id/u);
  const body=migration.slice(migration.indexOf('CREATE FUNCTION phase5_private.complete_shift_context_plan_v1'),completionLockUnionStart);
  assert.ok(body.indexOf('assert_shift_batch_manifest_v1')<body.indexOf('assert_wire_keys_v1(context_allocation'));
  assert.match(body,/stripped IS DISTINCT FROM expected_children/u);
  assert.match(body,/CONTEXT_ID_ALREADY_OWNED/u);
  assert.match(body,/serverPostLockTransactionSlot/u);
  assert.match(body,/TYPED_CONTEXT_IDENTITIES_AND_DIRECT_FKS_ONLY/u);
  assert.match(body,/'heldPlanComplete',FALSE/u);
  assert.match(body,/'sourceWriteTriggerClosureComplete',FALSE/u);
  assert.match(body,/expected IS DISTINCT FROM phase5_private.complete_shift_context_plan_v1/u);
  assert.doesNotMatch(body,/pg_advisory|FOR UPDATE|FOR SHARE|INSERT INTO|UPDATE public|DELETE FROM|set_config|txid_current\(|CLOCK_TIMESTAMP/u);
  const runtime=read('scripts/testing/run-phase5-inactive-collection-preparation-runtime.mjs');
  for(const marker of ['shift-context-typed-root','shift-context-parent-fk','shift-context-adversarial','shift-context-barrier']) assert.ok(runtime.includes(marker),marker);
});

test('collection union derives every resource from authorized requests and cannot mint parent/batch authority', () => {
  const union = migration.slice(migration.indexOf('CREATE FUNCTION phase5_private.discover_collection_union_plan_v1'),
    migration.indexOf('CREATE FUNCTION phase5_private.lock_customer_completion_generation_v1'));
  assert.match(union,/children JSONB := '\[\]'::JSONB/u);
  assert.match(union,/JSONB_TYPEOF\(requests\) IS DISTINCT FROM 'array'/u);
  assert.match(union,/JSONB_ARRAY_LENGTH\(requests\)=0/u);
  assert.ok(union.indexOf('authorize_collection_request_v2(r)') < union.indexOf('discover_collection_write_plan_v2(r)'));
  assert.match(union,/PHASE5_COLLECTION_UNION_DUPLICATE_KEY/u);
  assert.match(union,/COUNT\(DISTINCT n->'row'\)<>1/u);
  assert.match(union,/BOOL_OR\(s->>'mode'='UPDATE'\)/u);
  assert.match(union,/SUM\(\(p->'request'->>'amountInMinorUnits'\)::NUMERIC\)/u);
  assert.match(union,/PHASE5_COLLECTION_UNION_EXCEEDS_OUTSTANDING/u);
  assert.match(union,/'DISCOVERED_UNION_NOT_LOCKED'/u);
  assert.match(union,/'COLLECTION_CHILD_DISCOVERY_ONLY'/u);
  assert.match(union,/expected IS DISTINCT FROM phase5_private\.discover_collection_union_plan_v1\(requests\)/u);
  assert.doesNotMatch(union,/pg_advisory|FOR UPDATE|FOR SHARE|\bINSERT\b|\bUPDATE public\b|\bDELETE\b|EXECUTE|set_config/u);
  const runtime = read('scripts/testing/run-phase5-inactive-collection-preparation-runtime.mjs');
  for (const marker of ['UNION_DUPLICATE_KEY','UNION_EXCEEDS_OUTSTANDING','unionReversed','unionPlan.shifts',
    'unionPlan.capacities','assert_collection_union_unchanged_v1']) assert.ok(runtime.includes(marker),marker);
});

test('wire contracts require exact keys, decimal strings and relational request/result equality', () => {
  assert.match(migration,/JSONB_TYPEOF\(v\) IS DISTINCT FROM 'string'/u);
  assert.match(migration,/9223372036854775807/u);
  assert.match(migration,/actual IS DISTINCT FROM ordered/u);
  assert.match(migration,/outcome->'request' IS DISTINCT FROM r/u);
  assert.match(migration,/outcome->field IS DISTINCT FROM r->field/u);
  assert.match(migration,/before_amount < amount OR after_amount <> before_amount - amount/u);
  assert.match(migration,/UNIQUE \(actor_id,idempotency_key\)/u);
  assert.match(migration,/FOREIGN KEY\(context_id,actor_id,order_id,financial_operation_id\)/u);
  //014 clamps only the stock-warning threshold. The separately additive
  // product module preserves071's package clamp, never a financial fallback;
  // its whole predecessor is byte-pinned above. Retain the prior financial
  // no-clamp guard plus an explicit new-module no-money-clamp assertion.
  const stockThreshold="threshold:=GREATEST(COALESCE((p->>'min_stock_level')::INTEGER,0),0);";
  assert.equal(migration.split(stockThreshold).length-1,1);
  assert.doesNotMatch(migration.slice(0,productCreationPrewriteStart).replace(stockThreshold,''),/GREATEST\(|WHEN OTHERS/u);
  const familyClamp="GREATEST(0,COALESCE((n->>'openingSalePackages')::INT,0))";
  assert.equal(migration.slice(productCreationPrewriteStart).split(familyClamp).length-1,1);
  const receiptThreshold="threshold:=GREATEST(COALESCE((product_row->>'min_stock_level')::INTEGER,0),0);";
  assert.equal(migration.slice(receiptV2StockCandidateStart).split(receiptThreshold).length-1,1,
    'only the exact historical014 stock threshold clamp is admitted in the Receipt adapter');
  assert.doesNotMatch(migration.slice(productCreationPrewriteStart).replace(familyClamp,'').replace(receiptThreshold,''),/GREATEST\(|WHEN OTHERS/u);
  // Wire required fields never receive defaults. The separate parent model
  // reproduces explicit closed116 nullable request defaults, not wire fallbacks.
  const wire=migration.slice(0,migration.indexOf('CREATE TABLE phase5_private.authority_generation'));
  assert.doesNotMatch(wire,/COALESCE\((?:r|outcome)->/u);
});

test('Customer completion discovery uses immutable pre-completion anchors and the global existing SKU domain', () => {
  const body = migration.slice(migration.indexOf('CREATE FUNCTION phase5_private.discover_customer_completion_plan_v1'),
    migration.indexOf('CREATE FUNCTION phase5_private.lock_customer_completion_generation_v1'));
  assert.ok(body.indexOf('authorize_coordinator_actor_v1(actor,TRUE)') < body.indexOf('FROM public.orders'));
  assert.ok(body.indexOf("require_shift := LOWER(COALESCE(method,''))") < body.indexOf("IF tender='cash_on_delivery'"));
  assert.match(body,/creation\.result_snapshot->'subtotal'/u);
  assert.match(body,/expected IS DISTINCT FROM actual/u);
  assert.match(body,/PHASE5_COMPLETION_PHYSICAL_SET_INVALID/u);
  assert.match(body,/TO_JSONB\(role_row\)/u);
  assert.match(body,/SUM\(a\.reserved_quantity\)::NUMERIC/u);
  assert.match(body,/FROM public\.inventory_balances b WHERE b\.product_id=ANY\(products\)/u);
  assert.match(body,/'inventory-product:'/u);
  assert.match(body,/collected>0 AND collected<total/u);
  assert.match(body,/'CUSTOMER_COMPLETION_SOURCE_DISCOVERY_ONLY'/u);
  assert.match(body,/PHASE5_COMPLETION_PLAN_CHANGED_RETRY/u);
  assert.doesNotMatch(body,/read_order_financial|derive_financial_position|pg_advisory|FOR UPDATE|FOR SHARE|\bINSERT\b|UPDATE public|DELETE FROM|set_config/u);
  const runtime = read('scripts/testing/run-phase5-inactive-collection-preparation-runtime.mjs');
  for (const marker of ['completionPlan','completionBefore','OPEN_SHIFT_REQUIRED','completionDrift',
    'RESERVATION_IDENTITY_INVALID','allWarehouseBalances']) assert.ok(runtime.includes(marker),marker);
});

test('Customer parent owns partial child identity before DML and merges without completed-sale rediscovery', () => {
  const body = migration.slice(migration.indexOf('CREATE FUNCTION phase5_private.discover_customer_completion_union_core_v1'),
    migration.indexOf('CREATE FUNCTION phase5_private.lock_customer_completion_generation_v1'));
  assert.match(body,/parent:=phase5_private\.discover_customer_completion_plan_v1/u);
  const keyIdentity = body.slice(body.indexOf('identity_hash:='),body.indexOf("child_key:="));
  assert.match(keyIdentity,/'actorId',actor/u);
  assert.match(keyIdentity,/'orderId',order_identity/u);
  assert.match(keyIdentity,/'parentKey',parent->>'requestKey'/u);
  assert.doesNotMatch(keyIdentity,/amount|notes|reference|requestFingerprint/u);
  assert.match(body,/'operationId','paymentId','collectionId','auditId'/u);
  assert.match(body,/PHASE5_COMPLETION_CHILD_IDENTITY_OWNED/u);
  assert.match(body,/PHASE5_COMPLETION_PREEXISTING_FINANCIAL_EVIDENCE/u);
  assert.match(body,/f\.request_identity_snapshot->>'orderId'=order_identity::TEXT/u);
  assert.match(body,/WHEN 'public\.orders' THEN 0 WHEN 'public\.inventory_balances' THEN 1/u);
  assert.match(body,/WHEN 'public\.products' THEN 2/u);
  assert.match(body,/'parentRequestFingerprint',parent->>'requestFingerprint'/u);
  assert.match(body,/'initialCollectionInMinorUnits','0'/u);
  assert.match(body,/MAX\(CASE n->>'mode'/u);
  assert.match(body,/COUNT\(DISTINCT n->'row'\)<>1/u);
  assert.match(body,/'DISCOVERED_PARENT_CHILD_NOT_LOCKED'/u);
  assert.match(body,/'CUSTOMER_COMPLETION_PARENT_CHILD_DISCOVERY_ONLY'/u);
  assert.match(body,/expected IS DISTINCT FROM phase5_private\.discover_customer_completion_union_v1/u);
  assert.doesNotMatch(body,/read_order_financial|derive_financial_position|discover_collection_write_plan|pg_advisory|FOR UPDATE|FOR SHARE|\bINSERT\b|UPDATE public|DELETE FROM|set_config/u);
  const runtime = read('scripts/testing/run-phase5-inactive-collection-preparation-runtime.mjs');
  for (const marker of ['parentChildPlan','parentOwnedIdentity','CHILD_IDENTITY_OWNED',
    'parentChildCorruption','assert_customer_completion_union_unchanged_v1']) assert.ok(runtime.includes(marker),marker);
});

test('Customer parent acquisition is early, deterministic, fail-closed and never execution authority', () => {
  const body = migration.slice(migration.indexOf('CREATE FUNCTION phase5_private.lock_customer_completion_plan_v1'),
    migration.indexOf('CREATE FUNCTION phase5_private.derive_customer_completion_deltas_v1'));
  const markers = ['authorize_coordinator_actor_v1(actor,TRUE)','PHASE5_COMPLETION_LATE_ENTRY_RETRY',
    'lock_customer_completion_generation_v1()', 'discover_customer_completion_union_v1(',
    "plan->'keyGates'", "plan->'rootGates'", "plan->'sharedGates'", 'FROM public.cash_shifts',
    'FROM public.orders', "plan->'inventoryGates'", 'FROM public.inventory_balances', 'FROM public.products',
    'FROM public.business_operations', 'FROM auth.users', 'assert_customer_completion_union_unchanged_v1('];
  let previous=-1;
  for (const marker of markers) { const position=body.indexOf(marker); assert.ok(position>previous,marker); previous=position; }
  assert.match(body,/WITH ORDINALITY/u);
  assert.match(body,/ORDER BY ordinal/u);
  assert.match(body,/ns\.nspname IN \('public','auth','phase5_private'\)/u);
  assert.match(body,/FOR KEY SHARE NOWAIT/u);
  assert.match(body,/FOR NO KEY UPDATE NOWAIT/u);
  assert.match(body,/PHASE5_COMPLETION_CONTENTION_RETRY/u);
  assert.match(body,/'LOCKED_PARENT_RESOURCES_ONLY'/u);
  assert.doesNotMatch(body,/\bINSERT\b|UPDATE public|DELETE FROM|EXECUTE|enter_authority|lock_collection_|read_order_financial|set_config/u);
  const discovery=migration.slice(migration.indexOf('CREATE FUNCTION phase5_private.discover_customer_completion_plan_v1'),
    migration.indexOf('CREATE FUNCTION phase5_private.lock_customer_completion_generation_v1'));
  assert.match(discovery,/'auth.users',u\.id::TEXT,JSONB_BUILD_OBJECT\('id',u\.id\),'KEY_SHARE'/u);
  assert.doesNotMatch(discovery,/TO_JSONB\(u\)/u);
  assert.match(discovery,/public\.customer_addresses/u);
  const runtime=read('scripts/testing/run-phase5-inactive-collection-preparation-runtime.mjs');
  for (const marker of ['parentLockCall','parentLockHolder','COMPLETION_LATE_ENTRY_RETRY',
    'COMPLETION_CONTENTION_RETRY','LOCKED_PARENT_RESOURCES_ONLY']) assert.ok(runtime.includes(marker),marker);
});

test('collection discovery derives actor and marks the unheld plan explicitly, without context authority', () => {
  assert.match(migration,/actor UUID := auth\.uid\(\)/u);
  assert.match(migration,/authorize_coordinator_actor_v1\(actor, TRUE\)/u);
  assert.match(migration,/wire_uuid_v1\(r->'actorId'\) IS DISTINCT FROM actor/u);
  assert.match(migration,/'planState','DISCOVERED_NOT_LOCKED'/u);
  assert.match(migration,/facts := phase5_private\.read_order_financial_facts_v1/u);
  assert.match(migration,/position := phase5_private\.derive_financial_position_v1\(facts\)/u);
  assert.match(migration,/PHASE5_COLLECTION_SHIFT_AMBIGUOUS/u);
  assert.match(migration,/PHASE5_COLLECTION_SHIFT_EVIDENCE_MISSING/u);
  assert.match(migration,/PHASE5_COLLECTION_FK_PARENT_MISSING/u);
  assert.match(migration,/actual := phase5_private\.discover_collection_write_plan_v2\(r\)/u);
  assert.match(migration,/expected IS DISTINCT FROM actual/u);
  assert.match(migration,/ERRCODE = '40001', MESSAGE = 'PHASE5_COLLECTION_PLAN_CHANGED_RETRY'/u);
  assert.match(migration,/'resources',phase5_private\.collection_plan_resources_v2/u);
});

test('parent context freezes server identities and running deltas only after the complete canonical lock plan', () => {
  const delta = migration.slice(migration.indexOf('CREATE FUNCTION phase5_private.derive_customer_completion_deltas_v1'),
    migration.indexOf('CREATE FUNCTION phase5_private.enter_customer_completion_context_v1'));
  assert.match(delta,/previous_quantity:=CASE WHEN running/u);
  assert.match(delta,/ORDER BY value->'row'->>'product_id',value->>'id'/u);
  assert.match(delta,/phase3_allocate_parcel_cogs_internal\(inputs\)/u);
  assert.match(delta,/'reservationBefore',reservation,'reservationAfter'/u);
  assert.match(delta,/'collectionCoverageBeforeInMinorUnits','0'/u);
  assert.doesNotMatch(delta,/FROM public\.|pg_advisory|FOR UPDATE|FOR SHARE|INSERT INTO|UPDATE public|set_config/u);
  const entry = migration.slice(migration.indexOf('CREATE FUNCTION phase5_private.enter_customer_completion_context_v1'),
    migration.indexOf('CREATE FUNCTION phase5_private.assert_customer_completion_context_v1'));
  assert.ok(entry.indexOf('lock_customer_completion_plan_v1(') < entry.indexOf('INSERT INTO phase5_private.mutation_contexts'));
  assert.match(entry,/'LOCKED_PARENT_PREWRITE_CONTEXT_ONLY'/u);
  assert.match(entry,/gen_random_uuid\(\)/u);
  assert.match(entry,/tenderMethod'='cash' THEN plan->'child'->'shiftId' ELSE 'null'::JSONB/u);
  assert.doesNotMatch(entry,/INSERT INTO public|UPDATE public|set_config|lock_collection_|read_order_financial/u);
  const assertion = migration.slice(migration.indexOf('CREATE FUNCTION phase5_private.assert_customer_completion_context_v1'),
    migration.indexOf('CREATE FUNCTION phase5_private.validate_customer_completion_inventory_v1'));
  assert.match(assertion,/c\.transaction_id IS DISTINCT FROM txid_current\(\)/u);
  assert.match(assertion,/actual IS DISTINCT FROM expected/u);
  assert.match(assertion,/GROUP BY id HAVING COUNT\(\*\)<>1/u);
  assert.match(assertion,/PHASE5_PARENT_IDENTITY_DUPLICATE/u);
  assert.doesNotMatch(assertion,/pg_advisory|FOR UPDATE|FOR SHARE|INSERT INTO|UPDATE public|set_config/u);
  assert.match(migration,/c\.id IS DISTINCT FROM own_context/u);
  assert.match(migration,/own_row\.purpose IS DISTINCT FROM 'CUSTOMER_COMPLETION'/u);
  assert.match(migration,/NEW\.purpose='CUSTOMER_COMPLETION' THEN\s*PERFORM phase5_private\.complete_customer_completion_context_v1\(NEW\.id\)/u);
  assert.match(migration,/IF NOT EXISTS\(SELECT 1 FROM public\.orders WHERE id=c\.order_id AND status='completed'\)[\s\S]*?PHASE5_PARENT_COMPLETION_NOT_PREPARED/u);
  const runtime=read('scripts/testing/run-phase5-inactive-collection-preparation-runtime.mjs');
  for (const marker of ['parentContextInstrument','parentContextCorruption','mixedParentDeltas',
    'PARENT_COMPLETION_NOT_PREPARED','PARENT_IDENTITY_DUPLICATE']) assert.ok(runtime.includes(marker),marker);
});

test('standalone acquisition is actor/generation/key/root/Shift/source/FK ordered and late-entry fail-closed', () => {
  const body = migration.slice(migration.indexOf('CREATE FUNCTION phase5_private.lock_collection_write_plan_v2'),
    migration.indexOf('CREATE FUNCTION phase5_private.enter_authority_context_v1'));
  const markers = ['authorize_collection_request_v2(r)','PHASE5_COLLECTION_LATE_ENTRY_RETRY',
    'lock_collection_generation_v2(r)','phase5-idempotency|erp_user|',
    "'phase4-order|'",'discover_collection_write_plan_v2(r)',"'cash-shift-full-reversal:'",
    'FROM public.cash_shifts','FROM public.orders','plan->\'resources\'',
    'FROM public.branches','assert_collection_plan_unchanged_v2(r,plan)'];
  let previous = -1;
  for (const marker of markers) { const position = body.indexOf(marker); assert.ok(position>previous,marker); previous=position; }
  assert.match(body,/FROM pg_locks/u);
  assert.match(body,/pg_index index_parent ON index_parent\.indexrelid=c\.oid/u);
  assert.match(body,/COALESCE\(index_parent\.indrelid,c\.oid\) NOT IN/u);
  assert.match(body,/l\.locktype='advisory'/u);
  assert.match(body,/mutation_contexts'::REGCLASS AND l\.mode='ShareRowExclusiveLock'/u);
  assert.doesNotMatch(body,/l\.mode='RowExclusiveLock'|l\.mode='AccessExclusiveLock'/u);
  assert.match(body,/PHASE5_COLLECTION_EXISTING_ATTEMPT_REQUIRES_RESOLVER/u);
  assert.match(body,/'LOCKED_STANDALONE_COLLECTION'/u);
  assert.doesNotMatch(body,/\bINSERT\b|\bUPDATE public\.|\bDELETE\b|EXECUTE/u);
});

test('parent durable inventory validates per-reservation tuples and the complete ownership union without minting success', () => {
  const body=migration.slice(migration.indexOf('CREATE FUNCTION phase5_private.validate_customer_completion_inventory_v1'),
    migration.indexOf('CREATE FUNCTION phase5_private.validate_customer_completion_cost_v1'));
  assert.match(body,/creation IS DISTINCT FROM parent->'creation'/u);
  assert.match(body,/delta IS DISTINCT FROM phase5_private\.derive_customer_completion_deltas_v1\(p,event_at\)/u);
  assert.match(body,/expected_sources IS DISTINCT FROM frozen_sources/u);
  assert.match(body,/GROUP BY s->>'reservationId' HAVING COUNT\(\*\)<>1/u);
  assert.match(body,/GROUP BY value HAVING COUNT\(\*\)<>1/u);
  assert.match(body,/actual IS DISTINCT FROM step->'reservationAfter'/u);
  assert.match(body,/actual IS DISTINCT FROM expected/u);
  assert.match(body,/m\.operation_id=\(creation->>'id'\)::UUID/u);
  assert.match(body,/m\.reservation_id IN/u);
  assert.match(body,/AND NOT EXISTS\(SELECT 1 FROM JSONB_ARRAY_ELEMENTS\(delta->'inventorySteps'\)/u);
  assert.match(body,/'DURABLE_INVENTORY_STAGE_ONLY'/u);
  assert.doesNotMatch(body,/read_order_financial|FROM public\.inventory_balances|FROM public\.products|txid_current|pg_advisory|FOR UPDATE|FOR SHARE|INSERT INTO|UPDATE public|DELETE FROM|set_config/u);
  assert.match(migration,/NEW\.purpose='CUSTOMER_COMPLETION' THEN\s*PERFORM phase5_private\.complete_customer_completion_context_v1\(NEW\.id\)/u);
  assert.match(migration,/IF NOT EXISTS\(SELECT 1 FROM public\.orders WHERE id=c\.order_id AND status='completed'\)[\s\S]*?PHASE5_PARENT_COMPLETION_NOT_PREPARED/u);
  const runtime=read('scripts/testing/run-phase5-inactive-collection-preparation-runtime.mjs');
  for (const marker of ['parentInventoryStage','parentInventoryCorruption','INVENTORY_STAGE_ONLY',
    'same-quantity-source-substitution','extra-alternate-reference-movement','historical-balance-and-WAC-drift']) {
    assert.ok(runtime.includes(marker),marker);
  }
});

test('parent cost proof is full-tuple and bidirectional per-identity, readonly and never completion authority', () => {
  const body=migration.slice(migration.indexOf('CREATE FUNCTION phase5_private.validate_customer_completion_cost_v1'),
    migration.indexOf('CREATE FUNCTION phase5_private.derive_customer_completion_outcome_v1'));
  assert.match(body,/validate_customer_completion_inventory_v1\(context_identity\)/u);
  assert.match(body,/GROUP BY s->>'relation',s->>'id' HAVING COUNT\(\*\)<>1/u);
  assert.match(body,/expected_set IS DISTINCT FROM frozen_set/u);
  assert.match(body,/actual IS DISTINCT FROM expected/u);
  assert.match(body,/actual_set IS DISTINCT FROM expected_set/u);
  assert.match(body,/i\.operation_id=creation_identity/u);
  assert.match(body,/i\.order_item_id IN/u);
  assert.match(body,/'DURABLE_COST_STAGE_ONLY'/u);
  for (const relation of ['order_items','order_parcel_instances','order_parcel_components']) {
    assert.ok(body.includes(`JSONB_POPULATE_RECORD(NULL::public.${relation},step->'after')`));
  }
  assert.doesNotMatch(body,/FROM public\.products|FROM public\.inventory_balances|read_order_financial|pg_advisory|FOR UPDATE|FOR SHARE|INSERT INTO|UPDATE public|DELETE FROM|set_config|SUM\(/u);
  assert.match(migration,/NEW\.purpose='CUSTOMER_COMPLETION' THEN\s*PERFORM phase5_private\.complete_customer_completion_context_v1\(NEW\.id\)/u);
  assert.match(migration,/IF NOT EXISTS\(SELECT 1 FROM public\.orders WHERE id=c\.order_id AND status='completed'\)[\s\S]*?PHASE5_PARENT_COMPLETION_NOT_PREPARED/u);
  const runtime=read('scripts/testing/run-phase5-inactive-collection-preparation-runtime.mjs');
  for (const marker of ['parentCostStage','parentCostCorruption','COST_STAGE_ONLY','missing-cost-finalization',
    'extra-cost-item','cost_finalization_guards','QA_COST_GUC_ONLY_ACCEPTED']) assert.ok(runtime.includes(marker),marker);
});

test('parent outcome stage binds frozen financial/result/history/audit tuples without admitting execution or double collection', () => {
  const pure=migration.slice(migration.indexOf('CREATE FUNCTION phase5_private.derive_customer_completion_outcome_v1'),
    migration.indexOf('CREATE FUNCTION phase5_private.validate_customer_completion_outcome_v1'));
  assert.match(pure,/remaining IS DISTINCT FROM total-collected/u);
  assert.match(pure,/receipt->'identities' IS DISTINCT FROM child->'identities'/u);
  assert.match(pure,/receipt->'request' IS DISTINCT FROM child->'request'/u);
  assert.match(pure,/assert_collection_result_v2\(cr,child_wire\)/u);
  assert.match(pure,/'initialCollectionInMinorUnits',CASE WHEN child_expected='null'::JSONB THEN collected::TEXT ELSE '0' END/u);
  for (const relation of ['orders','customer_payments','business_operations','order_status_history','audit_logs']) {
    assert.ok(pure.includes(`JSONB_POPULATE_RECORD(NULL::public.${relation}`),relation);
  }
  assert.doesNotMatch(pure,/\bSELECT\b|pg_advisory|FOR UPDATE|FOR SHARE|INSERT INTO|UPDATE public|set_config|txid_current|read_order_financial/u);
  const central=migration.slice(migration.indexOf('CREATE FUNCTION phase5_private.validate_customer_completion_outcome_v1'),
    migration.indexOf('CREATE FUNCTION phase5_private.derive_customer_completion_child_link_v1'));
  assert.match(central,/validate_customer_completion_cost_v1\(context_identity\)/u);
  assert.match(central,/actual_history IS DISTINCT FROM expected_history/u);
  assert.match(central,/actual IS DISTINCT FROM expected->'operation'/u);
  assert.match(central,/actual IS DISTINCT FROM child->'payment'/u);
  assert.match(central,/validate_customer_collection_operation_v1/u);
  assert.match(central,/'DURABLE_PARENT_OUTCOME_STAGE_ONLY'/u);
  assert.doesNotMatch(central,/pg_advisory|FOR UPDATE|FOR SHARE|INSERT INTO|UPDATE public|DELETE FROM|set_config|txid_current|read_order_financial/u);
  assert.match(migration,/NEW\.purpose='CUSTOMER_COMPLETION' THEN\s*PERFORM phase5_private\.complete_customer_completion_context_v1\(NEW\.id\)/u);
  assert.match(migration,/IF NOT EXISTS\(SELECT 1 FROM public\.orders WHERE id=c\.order_id AND status='completed'\)[\s\S]*?PHASE5_PARENT_COMPLETION_NOT_PREPARED/u);
  const runtime=read('scripts/testing/run-phase5-inactive-collection-preparation-runtime.mjs');
  for (const marker of ['parentOutcomeStage','parentOutcomeCorruption','parentOutcomeCall',
    'DURABLE_PARENT_OUTCOME_STAGE_ONLY','QA_OUTCOME_READONLY_MUTATION','no-child-extra-payment']) assert.ok(runtime.includes(marker),marker);
});

test('parent-owned child context and envelope have exact frozen identity without standalone acquisition or operational adoption', () => {
  const pure=migration.slice(migration.indexOf('CREATE FUNCTION phase5_private.derive_customer_completion_child_link_v1'),
    migration.indexOf('CREATE FUNCTION phase5_private.enter_customer_completion_child_context_v1'));
  assert.match(pure,/derive_customer_completion_outcome_v1\(c\)/u);
  assert.match(pure,/'parentContextId',c->'id'/u);
  assert.match(pure,/'childOperationId',receipt->'identities'->'operationId'/u);
  assert.match(pure,/'operation_id',receipt->'identities'->'operationId'/u);
  assert.match(pure,/'transaction_id',c->'transaction_id'/u);
  assert.match(pure,/'LOCKED_PARENT_CHILD_PREWRITE_ONLY'/u);
  assert.match(pure,/'context_id',context_identity/u);
  assert.match(pure,/'result_snapshot',child->'wireResult'/u);
  assert.doesNotMatch(pure,/FROM (?:public|phase5_private)\.\w+\s|INSERT INTO|pg_advisory|FOR UPDATE|set_config|read_order_financial|gen_random_uuid|NEXTVAL/u);
  const entry=migration.slice(migration.indexOf('CREATE FUNCTION phase5_private.enter_customer_completion_child_context_v1'),
    migration.indexOf('CREATE FUNCTION phase5_private.validate_customer_completion_child_link_v1'));
  assert.ok(entry.indexOf('assert_customer_completion_context_v1(')<entry.indexOf('INSERT INTO phase5_private.mutation_contexts'));
  assert.match(entry,/PHASE5_PARENT_CHILD_NOT_REQUIRED/u);
  assert.doesNotMatch(entry,/lock_collection_|lock_customer_|pg_advisory|FOR UPDATE|FOR SHARE|INSERT INTO public|read_order_financial|set_config/u);
  const central=migration.slice(migration.indexOf('CREATE FUNCTION phase5_private.validate_customer_completion_child_link_v1'),
    migration.indexOf('CREATE FUNCTION phase5_private.derive_customer_completion_writes_v1'));
  assert.match(central,/validate_customer_completion_outcome_v1\(parent_context_identity,historical\)/u);
  assert.match(central,/actual IS DISTINCT FROM child/u);
  assert.match(central,/actual IS DISTINCT FROM envelope/u);
  assert.match(central,/t\.locked_plan->>'parentContextId'=c\.id::TEXT/u);
  assert.match(central,/'DURABLE_PARENT_CHILD_LINK_STAGE_ONLY'/u);
  assert.doesNotMatch(central,/pg_advisory|FOR UPDATE|FOR SHARE|INSERT INTO|UPDATE public|DELETE FROM|set_config|txid_current|read_order_financial/u);
  assert.match(migration,/NEW\.purpose='CUSTOMER_COMPLETION' THEN\s*PERFORM phase5_private\.complete_customer_completion_context_v1\(NEW\.id\)/u);
  assert.match(migration,/IF NOT EXISTS\(SELECT 1 FROM public\.orders WHERE id=c\.order_id AND status='completed'\)[\s\S]*?PHASE5_PARENT_COMPLETION_NOT_PREPARED/u);
  const runtime=read('scripts/testing/run-phase5-inactive-collection-preparation-runtime.mjs');
  for (const marker of ['parentChildLinkStage','parentChildLinkCorruption','parentChildLinkCall',
    'DURABLE_PARENT_CHILD_LINK_STAGE_ONLY','QA_PARENT_CHILD_LINK_READONLY_MUTATION',
    'parent-child-context-plan-is-not-standalone','child-context-before-parent-source']) assert.ok(runtime.includes(marker),marker);
});

test('parent source permission proves exact full-row ordered prefixes without admitting execution', () => {
  const pure=migration.slice(migration.indexOf('CREATE FUNCTION phase5_private.derive_customer_completion_writes_v1'),
    migration.indexOf('CREATE FUNCTION phase5_private.assert_customer_completion_permit_v1'));
  assert.match(pure,/derive_customer_completion_outcome_v1\(c\)/u);
  assert.match(pure,/derive_customer_completion_child_link_v1\(c\)/u);
  assert.match(pure,/derive_customer_completion_deltas_v1/u);
  assert.match(pure,/writes JSONB:='\[\]'::JSONB/u);
  assert.match(pure,/'before',s->'balanceBefore','after',s->'balanceAfter'/u);
  assert.match(pure,/'before',first_order,'after',e->'orderAfter'/u);
  assert.match(pure,/'amount_paid_in_minor_units',0,'payment_status','unpaid'/u);
  assert.doesNotMatch(pure,/FROM (?:public|phase5_private)\.\w+\s|pg_advisory|FOR UPDATE|INSERT INTO|UPDATE public|set_config|txid_current|read_order_financial/u);
  const permit=migration.slice(migration.indexOf('CREATE FUNCTION phase5_private.assert_customer_completion_permit_v1'),
    migration.indexOf('CREATE FUNCTION phase5_private.read_customer_completion_source_row_v1'));
  assert.ok(permit.indexOf('authorize_coordinator_actor_v1(')<permit.indexOf('SELECT * INTO STRICT c'));
  assert.match(permit,/c\.transaction_id IS DISTINCT FROM txid_current\(\)/u);
  assert.match(permit,/actual IS DISTINCT FROM p->'parent'->'creation'/u);
  assert.match(permit,/actual IS DISTINCT FROM child/u);
  assert.match(permit,/PHASE5_PARENT_SOURCE_CONTEXT_SET_INVALID/u);
  const prefix=migration.slice(migration.indexOf('CREATE FUNCTION phase5_private.assert_customer_completion_prefix_v1'),
    migration.indexOf('CREATE FUNCTION phase5_private.complete_customer_completion_context_v1'));
  assert.match(prefix,/states JSONB:='\{\}'::JSONB/u);
  assert.match(prefix,/COALESCE\(old_tuple,'null'::JSONB\) IS DISTINCT FROM step->'before'/u);
  assert.match(prefix,/new_tuple IS DISTINCT FROM step->'after'/u);
  assert.match(prefix,/IF i<write_ordinal THEN states:=JSONB_SET/u);
  assert.match(prefix,/IS DISTINCT FROM state->'row'/u);
  assert.match(prefix,/PHASE5_PARENT_SOURCE_PREFIX_INVALID/u);
  assert.doesNotMatch(permit+prefix,/discover_customer_|lock_collection_|pg_advisory|FOR UPDATE|FOR SHARE|INSERT INTO|UPDATE public|DELETE FROM|set_config|read_order_financial/u);
  const reader=migration.slice(migration.indexOf('CREATE FUNCTION phase5_private.read_customer_completion_source_row_v1'),
    migration.indexOf('CREATE FUNCTION phase5_private.assert_customer_completion_source_tuple_v1'));
  assert.equal((reader.match(/WHEN '(?:public|phase5_private)\.\w+' THEN SELECT/gu)??[]).length,14);
  assert.match(reader,/PHASE5_PARENT_SOURCE_RELATION_UNSUPPORTED/u);
  assert.doesNotMatch(reader,/\bEXECUTE\b|pg_advisory|FOR UPDATE|FOR SHARE/u);
  const runtime=read('scripts/testing/run-phase5-inactive-collection-preparation-runtime.mjs');
  for (const marker of ['parentPermissionStage','parentPermissionSetup','parentPermissionFaults',
    'QA_PARENT_PERMISSION_READONLY_MUTATION','skip-parent-write','repeat-parent-write',
    'parent-permission-extra-context','parent-permission-future-insert']) assert.ok(runtime.includes(marker),marker);
});

test('context is server-minted after prelocks and bound to full transaction, request and supported purpose', () => {
  const body = migration.slice(migration.indexOf('CREATE FUNCTION phase5_private.enter_authority_context_v1'),
    migration.indexOf('CREATE FUNCTION phase5_private.validate_collection_before_snapshot_v1'));
  assert.ok(body.indexOf('lock_collection_write_plan_v2(request)') < body.indexOf('INSERT INTO phase5_private.mutation_contexts'));
  assert.match(body,/purpose IS DISTINCT FROM 'CUSTOMER_COLLECTION'/u);
  assert.match(body,/assert_wire_keys_v1\(details,ARRAY\['request','operationId'\]\)/u);
  assert.match(body,/txid_current\(\)/u);
  assert.match(body,/c\.transaction_id IS DISTINCT FROM txid_current\(\)/u);
  assert.match(body,/c\.normalized_request IS DISTINCT FROM r/u);
  assert.match(body,/c\.locked_plan->>'planState' IS DISTINCT FROM 'LOCKED_STANDALONE_COLLECTION'/u);
  assert.match(body,/assert_collection_plan_unchanged_v2/u);
  assert.doesNotMatch(body,/set_config|GRANT|SECURITY DEFINER/u);
});

test('prelocked parent executor uses exact transitions and real116 guards; deferred proof is initial-only', () => {
  const completion=migration.slice(migration.indexOf('CREATE FUNCTION phase5_private.complete_customer_completion_context_v1'),
    migration.indexOf('CREATE FUNCTION phase5_private.execute_customer_completion_prelocked_v1'));
  assert.match(completion,/assert_customer_completion_prefix_v1\(context_identity,JSONB_ARRAY_LENGTH\(writes\)\+1\)/u);
  assert.ok(completion.indexOf('validate_customer_completion_child_link_v1(')<completion.indexOf('read_order_financial_position_v1('));
  assert.match(completion,/PHASE5_PARENT_COMPLETION_GUARD_LEAK/u);
  assert.match(completion,/collectionCoverageInMinorUnits/u);
  assert.doesNotMatch(completion,/pg_advisory|FOR UPDATE|FOR SHARE|INSERT INTO|UPDATE public|DELETE FROM|SET_CONFIG/u);
  const executor=migration.slice(migration.indexOf('CREATE FUNCTION phase5_private.execute_customer_completion_prelocked_v1'),
    migration.indexOf('REVOKE ALL ON FUNCTION phase5_private.complete_customer_completion_context_v1'));
  assert.ok(executor.indexOf('assert_customer_completion_context_v1(')<executor.indexOf('INSERT INTO public.'));
  assert.ok(executor.indexOf('enter_customer_completion_child_context_v1(')<executor.indexOf('INSERT INTO public.'));
  assert.ok(executor.indexOf('assert_customer_completion_source_tuple_v1(')<executor.indexOf('UPDATE public.'));
  assert.match(executor,/GET DIAGNOSTICS affected=ROW_COUNT/u);
  assert.match(executor,/IS DISTINCT FROM row_after/u);
  assert.match(executor,/pg_current_xact_id\(\),operation_identity,order_identity/u);
  assert.match(executor,/lifecycle_operation_id=operation_identity/u);
  assert.match(executor,/COALESCE\(previous_cost,''\)/u);
  assert.match(executor,/COALESCE\(previous_lifecycle,''\)/u);
  assert.match(executor,/RETURN phase5_private\.complete_customer_completion_context_v1/u);
  assert.doesNotMatch(executor,/lock_collection_|lock_customer_|pg_advisory|FOR UPDATE|FOR SHARE|\bEXECUTE\b|WHEN OTHERS|read_order_financial|record_customer_order_payment\(/u);
  const deferred=migration.slice(migration.indexOf('CREATE FUNCTION phase5_private.assert_source_completion_v1'),
    migration.indexOf('CREATE CONSTRAINT TRIGGER phase5_context_completion'));
  assert.match(deferred,/complete_customer_completion_context_v1\(NEW\.id\)/u);
  assert.match(deferred,/complete_customer_completion_context_v1\(parent_identity\)/u);
  assert.match(deferred,/complete_collection_attempt_v1\(operation_identity\)/u);
  const runtime=read('scripts/testing/run-phase5-inactive-collection-preparation-runtime.mjs');
  for (const marker of ['parentExecutorStage','parentExecutionFaults','QA_PARENT_AFTER_LAST_WRITE',
    'parent-executor-selector-restoration','parent-executor-initial-not-historical-replay']) assert.ok(runtime.includes(marker),marker);
  assert.match(runtime,/SELECT customer_notes INTO STRICT before_notes/u);
  assert.match(runtime,/RETURNING customer_notes INTO STRICT after_notes/u);
  assert.match(runtime,/QA_PARENT_CONTENT_MUTATION_MISSING/u);
  assert.match(runtime,/QA_PARENT_CAUGHT_FAILURE_PARTIAL_WRITE/u);
  assert.doesNotMatch(runtime,/UPDATE public\.orders SET updated_at=updated_at-interval/u);
});

test('historical Customer completion resolution shares durable identity proof without current-state mutation gates', () => {
  const resolver=migration.slice(migration.indexOf('CREATE FUNCTION phase5_private.resolve_customer_completion_v1'),
    migration.indexOf('-- First full-Shift preparation layer:'));
  assert.ok(resolver.indexOf('authorize_coordinator_actor_v1(')<resolver.indexOf('FROM phase5_private.mutation_contexts'));
  assert.match(resolver,/t\.actor_id=actor/u);
  assert.match(resolver,/c\.normalized_request IS DISTINCT FROM r/u);
  assert.match(resolver,/PHASE5_COMPLETION_IDEMPOTENCY_CONFLICT/u);
  assert.match(resolver,/validate_customer_completion_child_link_v1\(c\.id,TRUE\)/u);
  assert.match(resolver,/RETURN outcome/u);
  assert.doesNotMatch(resolver,/txid_current|clock_timestamp|read_order_financial|assert_customer_completion_permit|assert_customer_completion_prefix|discover_customer|pg_advisory|FOR UPDATE|FOR SHARE|INSERT INTO|UPDATE public|DELETE FROM|SET_CONFIG/u);
  assert.match(migration,/historical BOOLEAN DEFAULT FALSE/gu);
  assert.match(migration,/historical IS NULL[\s\S]*PHASE5_PARENT_PROOF_MODE_INVALID/u);
  assert.match(migration,/NOT historical AND actual IS DISTINCT FROM expected->'orderAfter'/u);
  assert.match(migration,/JSONB_ARRAY_ELEMENTS\(expected_history\)[\s\S]*WHERE a=h/u);
  assert.match(migration,/NOT historical AND t\.order_id=c\.order_id OR t\.financial_operation_id=/u);
  const runtime=read('scripts/testing/run-phase5-inactive-collection-preparation-runtime.mjs');
  for(const marker of ['historicalParentReplay','committedParentReplay','historical-parent-replay-zero-write',
    'QA_HISTORICAL_REPLAY_BUSINESS_LOCK','historical-replay-changed-state']) assert.ok(runtime.includes(marker),marker);
});

test('Legacy commercial discovery is type-first, actor-first and preserves the historical zero-amount Shift predicate', () => {
  const start=migration.indexOf('CREATE FUNCTION phase5_private.discover_legacy_completion_plan_v1');
  const end=migration.indexOf('CREATE FUNCTION phase5_private.discover_legacy_completion_resources_v1');
  const legacy=migration.slice(start,end);
  assert.ok(start>0);
  assert.ok(legacy.indexOf('PHASE5_LEGACY_ACTOR_UNAUTHORIZED')<legacy.indexOf('FROM public.orders'));
  assert.match(legacy,/r\.code IN \('owner','admin','manager','sales'\)/u);
  assert.match(legacy,/require_shift:=LOWER\(COALESCE\(method,''\)\) NOT IN \('debt',''\)/u);
  assert.ok(legacy.indexOf('require_shift:=')<legacy.indexOf("IF tender='cash_on_delivery'"));
  assert.match(legacy,/o\.source IS DISTINCT FROM 'website' OR o\.operation_id IS NOT NULL/u);
  for(const marker of ['order_inventory_reservations','order_parcel_instances','unit_cost_snapshot_in_minor_units_exact',
    'exact_cogs_snapshot_in_minor_units','PHASE5_LEGACY_MODERN_EVIDENCE_CONTRADICTION','LEGACY_COMMERCIAL_DISCOVERY_ONLY',
    "'locksHeld',FALSE,'executionAuthority',FALSE",'PHASE5_LEGACY_DISCOVERY_CHANGED_RETRY']) assert.ok(legacy.includes(marker),marker);
  assert.doesNotMatch(legacy,/read_order_financial|discover_customer_completion|validate_customer_completion|pg_advisory|FOR UPDATE|FOR SHARE|INSERT INTO|UPDATE public|DELETE FROM|SET_CONFIG|txid_current/u);
  const runtime=read('scripts/testing/run-phase5-inactive-collection-preparation-runtime.mjs');
  for(const marker of ['createLegacyReady','public.submit_guest_customer_order(','legacy-admission-rejections-zero-write',
    'legacy-commercial-discovery-zero-write','public.complete_website_order_with_settlement(${args})',
    '{units:5,price:5000}','deductionTuples:[{productId:product,warehouseId:legacySource.warehouseId,quantity:-5}]',
    'legacySource','legacyOpen']) assert.ok(runtime.includes(marker),marker);
});

test('Legacy acquisition freezes all nested source/FK resources and shares canonical domains without execution authority', () => {
  const resourceStart=migration.indexOf('CREATE FUNCTION phase5_private.discover_legacy_completion_resources_v1');
  const lockStart=migration.indexOf('CREATE FUNCTION phase5_private.lock_legacy_completion_plan_v1');
  const end=migration.indexOf('CREATE FUNCTION phase5_private.derive_legacy_completion_model_v1');
  const resources=migration.slice(resourceStart,lockStart);
  const locks=migration.slice(lockStart,end);
  assert.ok(resourceStart>0);
  assert.match(resources,/b\.product_id=ANY\(products\)/u);
  assert.match(resources,/b\.on_hand_quantity<d\.quantity/u);
  assert.match(resources,/JSONB_BUILD_OBJECT\('id',u\.id\),'KEY_SHARE'/u);
  for (const relation of ['order_items','order_status_history','audit_logs','inventory_balances','products','branches',
    'customers','customer_addresses','promotion_codes','warehouses','profiles','roles','user_roles']) {
    assert.ok(resources.includes(`public.${relation}`),relation);
    assert.ok(locks.includes(`public.${relation}`),relation);
  }
  const ordered=['discover_legacy_completion_resources_v1(', 'PHASE5_LEGACY_LATE_ENTRY_RETRY',
    'lock_customer_completion_generation_v1()', "plan->'rootGates'", "plan->'sharedGates'",
    'FROM public.cash_shifts', 'FROM public.orders', "plan->'inventoryGates'", "plan->'resources') WITH ORDINALITY",
    'assert_legacy_completion_resources_unchanged_v1('];
  let previous=-1;
  for(const marker of ordered) { const index=locks.indexOf(marker); assert.ok(index>previous,marker); previous=index; }
  assert.match(resources,/phase4-order\|/u); assert.match(resources,/cash-shift-full-reversal:/u);
  assert.match(resources,/inventory-product:/u);
  assert.match(locks,/FOR UPDATE NOWAIT/gu); assert.match(locks,/FOR NO KEY UPDATE NOWAIT/u);
  assert.match(locks,/FOR KEY SHARE NOWAIT/u); assert.match(locks,/WHEN LOCK_NOT_AVAILABLE/u);
  assert.match(locks,/'LEGACY_RESOURCES_LOCKED_ONLY','locksHeld',TRUE/u);
  assert.doesNotMatch(resources+locks,/\bGRANT\b|INSERT INTO|UPDATE public|DELETE FROM|enter_.*context|execute_.*prelocked|record_customer_order_payment|SET_CONFIG|complete_order\(/u);
  const runtime=read('scripts/testing/run-phase5-inactive-collection-preparation-runtime.mjs');
  for(const marker of ['legacyAcquisition','legacy-resources-zero-write','legacy-locks-zero-write',
    'S5-LEGACY-ROOT-WAITER','legacy-deadlock-delta','LEGACY_RESOURCES_CHANGED_RETRY']) assert.ok(runtime.includes(marker),marker);
});

test('Legacy prewrite context freezes historical identities and expectations but cannot admit incomplete completion', () => {
  const modelStart=migration.indexOf('CREATE FUNCTION phase5_private.derive_legacy_completion_model_v1');
  const enterStart=migration.indexOf('CREATE FUNCTION phase5_private.enter_legacy_completion_context_v1');
  const assertStart=migration.indexOf('CREATE FUNCTION phase5_private.assert_legacy_completion_permit_v1');
  const completeStart=migration.indexOf('CREATE FUNCTION phase5_private.complete_legacy_completion_context_v1');
  const model=migration.slice(modelStart,enterStart);
  const entry=migration.slice(enterStart,assertStart);
  const guard=migration.slice(assertStart,completeStart);
  assert.ok(modelStart>0 && enterStart>modelStart && assertStart>enterStart && completeStart>assertStart);
  assert.match(model,/FOR line IN SELECT value FROM JSONB_ARRAY_ELEMENTS\(c->'sourceItems'\)/u);
  assert.match(model,/'itemId',line->'id'/u);
  assert.match(model,/'reference_type','order'/u);
  assert.match(model,/'executionAuthority',FALSE/u);
  assert.match(model,/'orderCompletedBeforeReceipt'/u);
  assert.match(model,/'receiptTuple',CASE WHEN collected>0 AND remaining>0/u);
  assert.doesNotMatch(model,/read_order_financial|cost_snapshot|wac|INSERT INTO|UPDATE public|DELETE FROM|NEXTVAL|pg_advisory/u);
  assert.ok(entry.indexOf('lock_legacy_completion_plan_v1(')<entry.indexOf('NEXTVAL('));
  assert.ok(entry.indexOf('lock_legacy_completion_plan_v1(')<entry.indexOf('INSERT INTO phase5_private.mutation_contexts'));
  assert.match(entry,/'LEGACY_WEBSITE_COMPLETION',NULL/u);
  assert.match(entry,/'invocationId',context_identity/u);
  assert.match(guard,/c.transaction_id IS DISTINCT FROM txid_current\(\)/u);
  assert.match(guard,/c.operation_id IS NOT NULL/u);
  assert.match(guard,/fresh IS DISTINCT FROM/u);
  assert.match(guard,/l.granted AND l.mode='ExclusiveLock' AND l.objsubid=1/u);
  assert.match(guard,/JSONB_TYPEOF\(s.value\) IS DISTINCT FROM 'number'/u);
  assert.match(guard,/PHASE5_LEGACY_IDENTITY_DUPLICATE/u);
  assert.doesNotMatch(guard,/FOR UPDATE|FOR SHARE|pg_advisory_xact_lock|INSERT INTO|UPDATE public|DELETE FROM/u);
  assert.match(migration,/IF NEW.purpose='LEGACY_WEBSITE_COMPLETION' THEN\s+PERFORM phase5_private.complete_legacy_completion_context_v1\(NEW.id\)/u);
  assert.match(migration.slice(completeStart),/ERRCODE='55000',MESSAGE='PHASE5_LEGACY_COMPLETION_INCOMPLETE'/u);
  const runtime=read('scripts/testing/run-phase5-inactive-collection-preparation-runtime.mjs');
  for(const marker of ['legacyContext','legacy-context-rollback','legacy-context-no-business-write',
    'LEGACY_COMPLETION_INCOMPLETE','movementSequences','context-corrupt','legacy-duplicate-item-multiset']) {
    assert.ok(runtime.includes(marker),marker);
  }
});

test('Legacy receipt/source permissions reconstruct full typed rows and exact prefixes without activating a writer', () => {
  const start=migration.indexOf('CREATE FUNCTION phase5_private.derive_legacy_completion_writes_v1');
  const end=migration.indexOf('CREATE FUNCTION phase5_private.assert_legacy_completion_payment_v1');
  const body=migration.slice(start,end);
  assert.ok(start>0 && end>start);
  for(const marker of ['NULL::public.customer_payments','NULL::public.audit_logs','NULL::public.inventory_movements',
    'NULL::public.order_status_history',"'balance_before',b->'on_hand_quantity'","'balance_after',a->'on_hand_quantity'",
    "'RECORD_CUSTOMER_PAYMENT'","'COMPLETE_WEBSITE_ORDER_WITH_SETTLEMENT'",'assert_legacy_completion_permit_v1(',
    "c->'locked_plan'->'sourcePlan'->'resources'","IF i<write_ordinal",'actual IS DISTINCT FROM expected',
    "old_tuple,'null'::JSONB",'PHASE5_LEGACY_SOURCE_TUPLE_INVALID','PHASE5_LEGACY_SOURCE_PREFIX_INVALID']) {
    assert.ok(body.includes(marker),marker);
  }
  assert.match(body,/ORDER BY value->>'itemId' COLLATE "C"/u);
  assert.match(body,/payment_number=c->'locked_plan'->'receipt'->>'paymentNumber'/u);
  assert.doesNotMatch(body,/INSERT INTO|UPDATE public|DELETE FROM|NEXTVAL|pg_advisory_xact_lock|FOR UPDATE|FOR SHARE|\bEXECUTE\b|read_order_financial|collection_events|financial_operation_events/u);
  const permit=migration.slice(migration.indexOf('CREATE FUNCTION phase5_private.assert_legacy_completion_permit_v1'),
    migration.indexOf('CREATE FUNCTION phase5_private.assert_legacy_completion_context_v1'));
  assert.doesNotMatch(permit,/discover_legacy_completion_resources_v1\(/u);
  assert.match(permit,/RETURNS JSONB LANGUAGE plpgsql VOLATILE/u);
  assert.match(body,/assert_legacy_completion_prefix_v1\(context_identity UUID, write_ordinal INTEGER\)\s+RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE/u);
  assert.match(body,/old_tuple JSONB, new_tuple JSONB\s*\)\s+RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE/u);
  const complete=migration.slice(migration.indexOf('CREATE FUNCTION phase5_private.complete_legacy_completion_context_v1'),start);
  assert.match(complete,/assert_legacy_completion_permit_v1/u);
  assert.match(complete,/PHASE5_LEGACY_COMPLETION_INCOMPLETE/u);
  const runtime=read('scripts/testing/run-phase5-inactive-collection-preparation-runtime.mjs');
  for(const marker of ['legacySourcePermissions','legacy-source-prefix','legacy-source-staged-rollback',
    'legacy-receipt-full-row','legacy-source-role-denial','legacy-source-skip-repeat','legacy-source-extra-row']) {
    assert.ok(runtime.includes(marker),marker);
  }
});

test('private Legacy executor and deferred completion consume only the frozen exact full source set', () => {
  const body=migration.slice(migration.indexOf('CREATE FUNCTION phase5_private.assert_legacy_completion_payment_v1'),
    migration.indexOf('-- Historical resolution is NOT an execution permit.'));
  assert.match(body,/JSONB_ARRAY_LENGTH\(writes\)\+1/u);
  assert.match(body,/receipt_identity::TEXT IS DISTINCT FROM c->'locked_plan'->'receipt'->>'paymentId'/u);
  assert.match(body,/WITH ORDINALITY/u);
  assert.match(body,/assert_legacy_completion_source_tuple_v1/u);
  assert.match(body,/GET DIAGNOSTICS affected=ROW_COUNT/u);
  assert.match(body,/IF affected<>1/u);
  assert.ok(body.indexOf('assert_legacy_completion_context_v1(context_identity)')<body.indexOf('UPDATE public.orders'));
  assert.doesNotMatch(body,/FOR UPDATE|FOR SHARE|pg_advisory|NEXTVAL|\bEXECUTE\b|public\.complete_order|public\.record_customer|read_order_financial|INSERT INTO phase5_private/u);
  assert.match(body,/complete_legacy_completion_context_v1\(context_identity\)/u);
  assert.match(body,/FROM PUBLIC,anon,authenticated,service_role/u);
  const runtime=read('scripts/testing/run-phase5-inactive-collection-preparation-runtime.mjs');
  for(const marker of ['legacyExecutor','legacy-executor-exact-final','legacy-executor-after-every-write',
    'legacy-executor-deferred-corruption','legacy-executor-result-compatibility','legacy-executor-repeated-SKU']) {
    assert.ok(runtime.includes(marker),marker);
  }
});

test('private Legacy committed proof uses real transactions and observed operational races, preserving inactive public authority', () => {
  const runtime=read('scripts/testing/run-phase5-inactive-collection-preparation-runtime.mjs');
  const body=runtime.slice(runtime.indexOf('const legacyCommittedRuntime ='),runtime.indexOf('const shiftInstructionRuntime ='));
  for(const marker of ['legacy-committed-second-attempt-zero-write','legacy-caught-failure-deferred-COMMIT',
    'legacy-race-loser-zero-partial-content','legacy-close-first-loser-zero-partial',
    'legacy-operational-deadlockDelta',"['A-wins','B-wins']","['completion-first','close-first']",
    'LEGACY-WINNER-FINGERPRINT','LEGACY-CLOSE-FINGERPRINT','LEGACY_CONTEXT_INVALID',
    'public.close_cash_shift(',"waitForLock(name,'advisory')",'guardsBefore.map']) {
    assert.ok(body.includes(marker),marker);
  }
  assert.match(body,/SELECT result FROM legacy_commit_result; COMMIT/u);
  assert.match(body,/55000.*LEGACY_COMPLETION_INCOMPLETE/u);
  assert.match(body,/financial_operation|modern/u);
  assert.match(body,/movementIds\[item.id\]/u);
  assert.match(body,/generation=0,authority_state='PRIVATE_INACTIVE'/u);
  assert.doesNotMatch(body,/ALTER TABLE public\.[^;]*DISABLE|CREATE OR REPLACE FUNCTION public\.|GRANT EXECUTE/u);
});

test('historical completion runtime challenges real aftercare, closed Shift and actor isolation without weakening proof', () => {
  const runtime=read('scripts/testing/run-phase5-inactive-collection-preparation-runtime.mjs');
  for(const marker of ['historical-completion-after-real-return','historical-completion-after-real-replacement',
    'historical-completion-after-replacement-whole-parcel-return','historical-completion-after-public-shift-closure',
    'crossActorBefore','public.close_cash_shift(',"'returnSettlement'","'replacementSettlement'",
    'zero-write-including-aftercare']) assert.ok(runtime.includes(marker),marker);
  assert.match(runtime,/otherClaims[\s\S]*committedParentReplay[\s\S]*IS NULL/u);
  assert.match(runtime,/profiles SET is_active=false[\s\S]*42501.*ACTOR_UNAUTHORIZED/u);
  assert.doesNotMatch(runtime,/UPDATE public\.cash_shifts SET status='closed'/u);
});

test('Legacy current-authority intersections require real full-Shift and payment paths with complete loser fingerprints', () => {
  const runtime=read('scripts/testing/run-phase5-inactive-collection-preparation-runtime.mjs');
  const body=runtime.slice(runtime.indexOf('const legacyCommittedRuntime ='),runtime.indexOf('const shiftInstructionRuntime ='));
  for(const marker of ['public.reverse_cash_shift_with_operations(', 'public.preview_cash_shift_full_reversal(',
    'public.create_operational_expense(', 'public.record_customer_order_payment(',
    "['completion-first','reversal-first']", "['completion-first','payment-first']",
    'legacy-full-shift-reversal-loser-zero-partial-content',
    'legacy-completion-full-shift-loser-zero-partial-content',
    'legacy-ready-payment-zero-write', 'legacy-cross-sale-payment-loser-zero-partial-content',
    'S5-LEGACY-SAME-ROOT-PAYMENT', 'S5-LEGACY-CROSS-SALE-PAYMENT-WAITER',
    'PHASE4_LOCK_PLAN_CHANGED_RETRY', 'LEGACY_CONTENTION_RETRY', 'LEGACY_RESOURCES_CHANGED_RETRY']) {
    assert.ok(body.includes(marker),marker);
  }
  for(const table of ['cash_shift_reversals','cash_shift_reversal_operations','operational_expenses']) {
    assert.match(runtime.slice(runtime.indexOf('const fingerprintQuery'),runtime.indexOf('const fingerprint =')),
      new RegExp(`FROM public\\.${table} t`,'u'));
  }
  assert.match(body,/receipt\.order_id,id/u);
  assert.match(body,/initial\.id,result\.payment_id/u);
  assert.match(body,/durable\.operations\[0\]\.original_record_id,expense\.expenseId/u);
  assert.doesNotMatch(body,/ALTER TABLE public\.[^;]*DISABLE|CREATE OR REPLACE FUNCTION public\.|GRANT EXECUTE/u);
});

test('new-mutation generation fence is actor-first, NOWAIT and activation-receipt bound', () => {
  const body = migration.slice(migration.indexOf('CREATE FUNCTION phase5_private.lock_collection_generation_v2'),
    migration.indexOf('CREATE FUNCTION phase5_private.assert_collection_plan_unchanged_v2'));
  assert.ok(body.indexOf('authorize_collection_request_v2(r)') < body.indexOf('FOR SHARE NOWAIT'));
  assert.match(body,/g\.generation IS DISTINCT FROM 1/u);
  assert.match(body,/g\.authority_state IS DISTINCT FROM 'ACTIVE'/u);
  assert.match(body,/FROM phase5_private\.activation_receipts a/u);
  assert.match(body,/a\.generation = g\.generation AND a\.manifest_sha256 = g\.manifest_sha256/u);
  assert.match(body,/PHASE5_PREPARATION_ONLY/u);
  assert.match(body,/WHEN LOCK_NOT_AVAILABLE/u);
  assert.doesNotMatch(body,/INSERT|UPDATE|DELETE|pg_advisory|current_setting/u);
});

test('runtime preparation proof is fresh, fault-isolated, permission checked and strictly linted', () => {
  const runtime = read('scripts/testing/run-phase5-inactive-collection-preparation-runtime.mjs');
  assert.match(runtime,/NAWASRAH_MAX_MIGRATION: '128'/u);
  assert.match(runtime,/create_pos_sale_v2/u);
  assert.match(runtime,/record_customer_order_payment/u);
  assert.match(runtime,/permission denied/u);
  assert.match(runtime,/assertPhase5DbLint/u);
  assert.match(runtime,/ROLLBACK/u);
  assert.match(runtime,/stop', '--no-backup'/u);
  assert.doesNotMatch(runtime,/['"]quality['"]|run-canonical|runCanonical|retries\s*:/u);
});

test('prepared writer consumes server-minted identities after prewrite assertion and preserves old anchors', () => {
  const writer = migration.slice(migration.indexOf('CREATE FUNCTION phase5_private.create_customer_payment_prelocked_v1'),
    migration.indexOf('CREATE FUNCTION phase5_private.resolve_collection_attempt_v2'));
  assert.ok(writer.indexOf('assert_collection_context_v2') < writer.indexOf('INSERT INTO public.customer_payments'));
  for (const id of ['paymentId','collectionId','auditId']) assert.match(writer,new RegExp(id,'u'));
  assert.match(writer,/INSERT INTO phase5_private\.financial_operation_events/u);
  assert.match(writer,/INSERT INTO phase5_private\.collection_events/u);
  assert.match(writer,/INSERT INTO phase5_private\.collection_attempt_envelopes/u);
  assert.match(writer,/RETURN phase5_private\.complete_collection_attempt_v1/u);
  assert.doesNotMatch(writer,/set_config|pg_advisory|FOR UPDATE|FOR SHARE|record_customer_order_payment\(|commit_customer_collection_v1\(/u);
});

test('completion and replay share exact durable source/context/audit validation, not current admission', () => {
  const central = migration.slice(migration.indexOf('CREATE FUNCTION phase5_private.validate_collection_attempt_v1'),
    migration.indexOf('CREATE FUNCTION phase5_private.complete_collection_attempt_v1'));
  assert.match(central,/validate_customer_collection_operation_v1\(operation_identity\)/u);
  assert.match(central,/validate_collection_before_snapshot_v1/u);
  assert.match(central,/expected IS DISTINCT FROM e\.result_snapshot/u);
  assert.match(central,/a\.details IS DISTINCT FROM JSONB_BUILD_OBJECT/u);
  assert.match(central,/c\.locked_plan->>'paymentId' IS DISTINCT FROM p\.id::TEXT/u);
  const replay = migration.slice(migration.indexOf('CREATE FUNCTION phase5_private.resolve_collection_attempt_v2'),
    migration.indexOf('CREATE FUNCTION phase5_private.guard_collection_control_history_v1'));
  assert.match(replay,/authorize_collection_request_v2/u);
  assert.match(replay,/PHASE5_COLLECTION_IDEMPOTENCY_CONFLICT/u);
  assert.match(replay,/RETURN phase5_private\.validate_collection_attempt_v1/u);
  assert.doesNotMatch(replay+central,/txid_current\(|lock_collection_|FOR UPDATE|FOR SHARE|\bINSERT\b|\bUPDATE\b|\bDELETE\b/u);
  assert.equal((migration.match(/CREATE CONSTRAINT TRIGGER phase5_\w+_completion/gu) ?? []).length,2);
  assert.equal((migration.match(/DEFERRABLE INITIALLY DEFERRED FOR EACH ROW/gu) ?? []).length,2);
  assert.equal((migration.match(/BEFORE UPDATE OR DELETE ON phase5_private\./gu) ?? []).length,2);
  assert.match(migration,/PERFORM phase5_private\.complete_collection_attempt_v1\(operation_identity\)/u);
});

test('source permission proves a complete frozen tuple, not GUC/version/Shift marker authority', () => {
  const guard = migration.slice(migration.indexOf('CREATE FUNCTION phase5_private.assert_collection_permit_v1'),
    migration.indexOf('CREATE FUNCTION phase5_private.discover_collection_union_plan_v1'));
  assert.match(guard,/c\.transaction_id IS DISTINCT FROM txid_current\(\)/u);
  assert.match(guard,/c\.purpose IS DISTINCT FROM 'CUSTOMER_COLLECTION'/u);
  assert.match(guard,/c\.locked_plan->'request' IS DISTINCT FROM c\.normalized_request/u);
  assert.match(guard,/new_tuple IS DISTINCT FROM expected/u);
  assert.match(guard,/old_tuple IS NOT DISTINCT FROM c->'locked_plan'->'order'/u);
  assert.match(guard,/TO_JSONB\(o\) IS NOT DISTINCT FROM old_tuple/u);
  assert.match(guard,/validate_collection_attempt_v1\(\(c->>'operation_id'\)::UUID\)/u);
  assert.match(guard,/TG_TABLE_SCHEMA IS DISTINCT FROM 'public'/u);
  assert.match(guard,/WHERE transaction_id=txid_current\(\) AND actor_id=actor AND order_id=order_identity/u);
  assert.match(guard,/EXCEPTION WHEN NO_DATA_FOUND OR TOO_MANY_ROWS/u);
  assert.doesNotMatch(guard,/current_setting|set_config|pg_advisory|FOR UPDATE|FOR SHARE|\bINSERT INTO\b|\bUPDATE public\b/u);
  const writer = migration.slice(migration.indexOf('CREATE FUNCTION phase5_private.create_customer_payment_prelocked_v1'),
    migration.indexOf('CREATE FUNCTION phase5_private.resolve_collection_attempt_v2'));
  assert.ok(writer.indexOf("'customer_payments','INSERT'") < writer.indexOf('INSERT INTO public.customer_payments'));
  assert.ok(writer.indexOf("'orders','UPDATE'") < writer.indexOf('UPDATE public.orders'));
  assert.doesNotMatch(writer,/clock_timestamp\(|NEXTVAL\(/u);
  assert.match(writer,/event_at := \(c->'locked_plan'->>'paymentEventAt'\)::TIMESTAMPTZ/u);
  assert.doesNotMatch(migration,/CREATE (?:CONSTRAINT )?TRIGGER[^;]*guard_source_generation_v1/u);
  const runtime = read('scripts/testing/run-phase5-inactive-collection-preparation-runtime.mjs');
  assert.match(runtime,/writerSql\[2\]/u);
  assert.match(runtime,/QA_VALID_PROJECTION_TUPLE_REJECTED/u);
  assert.match(runtime,/QA_ACTUAL_SOURCE_DRIFT_ACCEPTED/u);
  const permittedCatalogFault='ALTER TABLE public.inventory_balances DISABLE TRIGGER trg_sync_stock_alert_from_balance;';
  const stockAuthorityStart=runtime.indexOf('const stockWriterSourceRuntime =');
  const stockAuthorityEnd=runtime.indexOf('\ntry {',stockAuthorityStart);
  assert.ok(stockAuthorityStart>0 && stockAuthorityEnd>stockAuthorityStart);
  assert.equal(runtime.slice(0,stockAuthorityStart).split(permittedCatalogFault).length-1,1);
  assert.equal(runtime.slice(stockAuthorityStart,stockAuthorityEnd).split(permittedCatalogFault).length-1,1);
  // The separate authority matrix intentionally simulates ACL/guard drift in
  // rollback-only transactions. Existing source adapters still cannot do so.
  const authorityStart=runtime.indexOf('const inventoryAuthorityRuntime =');
  const authorityEnd=runtime.indexOf('\ntry {',authorityStart);
  assert.ok(authorityStart>0 && authorityEnd>authorityStart);
  assert.ok(stockAuthorityStart>authorityStart && stockAuthorityEnd>stockAuthorityStart);
  // The new source/catalog fault matrix also uses rollback-only privileged
  // trigger drift. Keep all actual source executors under the original ban.
  const sourceRuntime=runtime.slice(0,authorityStart)+runtime.slice(stockAuthorityEnd);
  assert.doesNotMatch(sourceRuntime.replace(permittedCatalogFault,''),/ALTER TABLE public\.[^;]*DISABLE TRIGGER|session_replication_role/u);
  assert.ok(runtime.includes('[`'+permittedCatalogFault+'`,/23514.*SIDE_EFFECT_TRIGGER_DRIFT/u]'));
});
