import {createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {functionEvents} from './build-phase5-authority-ledger.mjs';

const lf=s=>s.replace(/\r\n?/gu,'\n');
const sha=s=>createHash('sha256').update(s).digest('hex').toUpperCase();
const sorted=xs=>[...xs].sort((a,b)=>a<b?-1:a>b?1:0);

// Coordinates stay relative to pg_proc.prosrc. This is a lexical inspection,
// not a SQL type resolver, control-flow theorem or runtime lock certificate.
export function maskAdmissionSql(source) {
  let i=0;
  // Use UTF-16 offsets, like RegExp/String indexes (Arabic source is retained).
  const out=source.split('');
  const blank=(a,b)=>{for(let k=a;k<b;k++)if(out[k]!=='\n')out[k]=' ';};
  while(i<source.length){
    const start=i;
    if(source.slice(i,i+2)==='--'){
      i=source.indexOf('\n',i);if(i<0)i=source.length;blank(start,i);
    }else if(source.slice(i,i+2)==='/*'){
      i+=2;let depth=1;
      while(i<source.length&&depth){if(source.slice(i,i+2)==='/*'){depth++;i+=2;}
        else if(source.slice(i,i+2)==='*/'){depth--;i+=2;}else i++;}
      if(depth)throw new Error('ADMISSION_UNTERMINATED_COMMENT');blank(start,i);
    }else if(source[i]==="'"){
      const escaped=start>0&&/[eE]/u.test(source[start-1])&&(start<2||!/[\w$]/u.test(source[start-2]));
      i++;let closed=false;
      while(i<source.length){if(escaped&&source[i]==='\\'){i+=2;continue;}
        if(source[i]==="'"){if(source[i+1]==="'"){i+=2;continue;}i++;closed=true;break;}i++;}
      if(!closed)throw new Error('ADMISSION_UNTERMINATED_STRING');blank(start,i);
    }else if(source[i]==='$'){
      const tag=source.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/u)?.[0];
      if(tag){const end=source.indexOf(tag,i+tag.length);if(end<0)throw new Error('ADMISSION_UNTERMINATED_DOLLAR_STRING');i=end+tag.length;blank(start,i);}else i++;
    }else i++;
  }
  return out.join('');
}

export function inspectAdmissionBody(body,knownSignatures=[]) {
  const clean=maskAdmissionSql(body),line=i=>body.slice(0,i).split('\n').length;
  const writes=[];
  const writePattern=/\b(INSERT\s+INTO|UPDATE(?:\s+ONLY)?|DELETE\s+FROM|MERGE\s+INTO|TRUNCATE(?:\s+TABLE)?)\s+(public\.)?("?[a-z_][\w]*"?)/giu;
  for(const m of clean.matchAll(writePattern)){
    const prefix=clean.slice(Math.max(0,m.index-40),m.index);
    if(/^UPDATE/iu.test(m[1])&&/\bFOR\s+(?:NO\s+KEY\s+)?$/iu.test(prefix))continue;
    if(['set','of','nowait','skip','locked','loop'].includes(m[3].toLowerCase()))continue;
    writes.push({verb:m[1].replace(/\s+/gu,' ').toUpperCase(),relation:'public.'+m[3].replaceAll('"','').toLowerCase(),bodyLine:line(m.index),offset:m.index});
  }
  const calls=[];
  for(const m of clean.matchAll(/\b(public|phase5_private)\.([a-z_][\w]*)\s*\(/giu)){
    // INSERT table(column,...) is not a callable edge. Conflating it with a
    // function makes the graph falsely report unresolved wrappers.
    const prefix=clean.slice(Math.max(0,m.index-100),m.index);
    if(/\b(?:INSERT\s+INTO|UPDATE(?:\s+ONLY)?|DELETE\s+FROM|MERGE\s+INTO|TRUNCATE(?:\s+TABLE)?|REFERENCES)\s*$/iu.test(prefix))continue;
    const name=`${m[1].toLowerCase()}.${m[2].toLowerCase()}`;
    const candidates=sorted(knownSignatures.filter(s=>s.split('(')[0]===name));
    calls.push({name,bodyLine:line(m.index),offset:m.index,
      exactTarget:candidates.length===1?candidates[0]:null,candidates,
      resolution:candidates.length===1?'UNIQUE_NAME_SOURCE_TARGET':'OVERLOAD_OR_EXTERNAL_REVIEW_REQUIRED'});
  }
  const rowLocks=[...clean.matchAll(/\bFOR\s+(NO\s+KEY\s+UPDATE|KEY\s+SHARE|UPDATE|SHARE)\b/giu)]
    .map(m=>({mode:m[1].replace(/\s+/gu,' ').toUpperCase(),bodyLine:line(m.index),offset:m.index}));
  const gates=calls.filter(c=>/phase[23]_lock_inventory_products_internal$/u.test(c.name));
  const dynamicSql=[...clean.matchAll(/\bEXECUTE\b/giu)].map(m=>({bodyLine:line(m.index),offset:m.index}));
  return {writes,calls,rowLocks,gates,dynamicSql,firstOwnWrite:writes[0]??null};
}

// Testable diagnostic: an early delegated gate can be observed, but unknown
// call branches/implicit FK/default/trigger locks cannot thereby be qualified.
export function compareGateToBoundary(body,gateName,boundaryText) {
  const clean=maskAdmissionSql(body);
  const gate=clean.indexOf(gateName),boundary=clean.indexOf(boundaryText);
  const earlierLock=inspectAdmissionBody(body).rowLocks.find(l=>gate<0||l.offset<gate);
  return {gateFound:gate>=0,boundaryFound:boundary>=0,
    sourceOrder:gate<0?'GATE_ABSENT':boundary<0?'BOUNDARY_UNRESOLVED':gate<boundary?'GATE_PRECEDES_BOUNDARY':'GATE_AFTER_BOUNDARY',
    earlierRowLock:earlierLock??null,runtimeAdmissionProven:false,executionAuthority:false};
}

// Receipt source columns are observations of explicit INSERT statements only.
// Omitted defaults, generated values, FK locks and triggers are NOT resolved by
// this lexical reader. In particular a UUID/sequence candidate is not a claim.
export function inspectExplicitInsertColumns(body) {
  const clean=maskAdmissionSql(body);
  return inspectAdmissionBody(body).writes.filter(w=>w.verb==='INSERT INTO').map(w=>{
    const match=clean.slice(w.offset).match(/^INSERT\s+INTO\s+(?:public\.)?[a-z_][\w]*\s*\(/iu);
    if(!match)return {...w,columns:null,implicitColumnsQualified:false};
    const start=w.offset+match[0].length,end=clean.indexOf(')',start);
    if(end<0)throw new Error('ADMISSION_INSERT_COLUMNS_UNTERMINATED');
    const columns=clean.slice(start,end).split(',').map(s=>s.trim().toLowerCase());
    if(columns.some(s=>!/^\w+$/u.test(s))||new Set(columns).size!==columns.length)
      throw new Error('ADMISSION_INSERT_COLUMNS_UNRESOLVED');
    return {...w,columns,implicitColumnsQualified:false};
  });
}

// Bounded single-VALUES reader. Masking preserves UTF-16 coordinates while
// commas/parentheses inside SQL strings/comments cannot split expressions.
// This records source text only: it neither evaluates SQL nor resolves types.
export function inspectExplicitInsertValues(body) {
  const source=lf(body),clean=maskAdmissionSql(source);
  return inspectExplicitInsertColumns(source).map(write=>{
    if(!write.columns)throw new Error('ADMISSION_INSERT_VALUES_COLUMNS_UNRESOLVED');
    const head=clean.slice(write.offset).match(/^INSERT\s+INTO\s+(?:public\.)?[a-z_][\w]*\s*\(/iu);
    const columnsEnd=clean.indexOf(')',write.offset+head[0].length);
    const values=clean.slice(columnsEnd+1).match(/^\s*VALUES\s*\(/iu);
    if(!values)throw new Error('ADMISSION_INSERT_VALUES_FORM_UNRESOLVED');
    const start=columnsEnd+1+values[0].length;let depth=0,part=start,end=-1;
    const expressions=[];
    const capture=stop=>{
      const text=source.slice(part,stop),left=text.search(/\S/u);
      if(left<0||(!clean.slice(part,stop).trim()&&!/^'(?:[^']|'')*'$/u.test(text.trim())))
        throw new Error('ADMISSION_INSERT_VALUES_EMPTY');
      expressions.push({ordinal:expressions.length,offset:part+left,expression:text.trim()});
    };
    for(let i=start;i<clean.length;i++){
      if(clean[i]===';')throw new Error('ADMISSION_INSERT_VALUES_UNTERMINATED');
      if(clean[i]==='(')depth++;
      else if(clean[i]===')'){
        if(depth===0){capture(i);end=i;break;}depth--;
      }else if(clean[i]===','&&depth===0){capture(i);part=i+1;}
    }
    if(end<0)throw new Error('ADMISSION_INSERT_VALUES_UNTERMINATED');
    const tail=clean.slice(end+1);
    if(!/^\s*(?:;|RETURNING\b|ON\s+CONFLICT\b)/iu.test(tail))throw new Error('ADMISSION_INSERT_VALUES_TAIL_UNRESOLVED');
    if(expressions.length!==write.columns.length)throw new Error('ADMISSION_INSERT_VALUES_ARITY_INVALID');
    return {...write,bindings:expressions.map((value,i)=>({column:write.columns[i],...value})),valuesEvaluated:false};
  });
}

// Bounded UPDATE SET/WHERE source observation only. No SQL evaluation, aliases,
// UPDATE FROM, RETURNING or implicit trigger writes are admitted by this reader.
export function inspectExplicitUpdateValues(body) {
  const source=lf(body),clean=maskAdmissionSql(source);
  return inspectAdmissionBody(source).writes.filter(w=>w.verb==='UPDATE').map(write=>{
    const head=clean.slice(write.offset).match(/^UPDATE\s+(?:public\.)?[a-z_][\w]*\s+SET\s+/iu);
    if(!head)throw new Error('ADMISSION_UPDATE_FORM_UNRESOLVED');
    const start=write.offset+head[0].length;let part=start,depth=0,where=-1,end=-1;
    const parts=[];
    for(let n=start;n<clean.length;n++){
      if(clean[n]==='(')depth++;
      else if(clean[n]===')'){if(--depth<0)throw new Error('ADMISSION_UPDATE_FORM_UNRESOLVED');}
      if(depth===0&&/^FROM\b/iu.test(clean.slice(n))&&!/[\w]/u.test(clean[n-1]))throw new Error('ADMISSION_UPDATE_TAIL_UNRESOLVED');
      if(depth===0&&/^WHERE\b/iu.test(clean.slice(n))&&(n===0||!/[\w]/u.test(clean[n-1]))){parts.push([part,n]);where=n;break;}
      if(depth===0&&clean[n]===','){parts.push([part,n]);part=n+1;}
      if(clean[n]===';')throw new Error('ADMISSION_UPDATE_PREDICATE_UNRESOLVED');
    }
    if(where<0)throw new Error('ADMISSION_UPDATE_PREDICATE_UNRESOLVED');
    depth=0;
    for(let n=where+5;n<clean.length;n++){
      if(clean[n]==='(')depth++;else if(clean[n]===')')depth--;
      if(depth<0)throw new Error('ADMISSION_UPDATE_PREDICATE_UNRESOLVED');
      if(depth===0&&/^(?:FROM|RETURNING)\b/iu.test(clean.slice(n))&&!/[\w]/u.test(clean[n-1]))
        throw new Error('ADMISSION_UPDATE_TAIL_UNRESOLVED');
      if(depth===0&&clean[n]===';'){end=n;break;}
    }
    if(end<0||!clean.slice(where+5,end).trim())throw new Error('ADMISSION_UPDATE_PREDICATE_UNRESOLVED');
    const bindings=parts.map(([a,b],ordinal)=>{
      const match=clean.slice(a,b).match(/^\s*([a-z_][\w]*)\s*=/iu);
      if(!match)throw new Error('ADMISSION_UPDATE_ASSIGNMENT_UNRESOLVED');
      const valueStart=a+match[0].length,left=source.slice(valueStart,b).search(/\S/u);
      const offset=valueStart+Math.max(0,left),expression=source.slice(offset,b).trim();
      if(!expression)throw new Error('ADMISSION_UPDATE_ASSIGNMENT_UNRESOLVED');
      return {column:match[1].toLowerCase(),ordinal,offset,expression};
    });
    if(new Set(bindings.map(b=>b.column)).size!==bindings.length)throw new Error('ADMISSION_UPDATE_DUPLICATE_COLUMN');
    return {...write,bindings,predicate:{offset:where+5,expression:source.slice(where+5,end).trim()},valuesEvaluated:false};
  });
}

// Independently read latest source through127. These are bounded Receipt V2
// dependencies, not a complete trigger/default/invoker admission certificate.
// Body pins do not come from a caller-provided plan or live catalog fingerprint.
/** @type {Array<[string,string,string,string,boolean]>} */
const receiptV2Anchors=[
  ['attach_supplier_payment_to_open_shift()','113','4EBE9CD878BB928C5730206BD14F924CE47625C3B8953E4B4607E1A22D133F3F','DEFINER',false],
  ['assert_configurable_parcel_creation_allowed()','112','90875CD1E8136293145646EA8F2A2B6C8B297CDAD0532D0C7473A479D703323A','DEFINER',false],
  ['guard_new_configurable_parcel_row()','112','4B1DD677CFA24E954448B73461D442FB260BD30C3B452617F1435B5CFBB10FD0','DEFINER',false],
  ['validate_supplier_receipt_item_commercial_family()','112','83F006C212CD9B4CD95DE9E635A16EE1466072ABC981FF45B1FD6CAB51AE1DC7','DEFINER',false],
  ['assign_inventory_movement_mutation_sequence()','113','36116406B2A8E6C40FBD66ED19249F0CC166CB5E131DB07325FBBA9E66CFEA3C','DEFINER',false],
  ['phase2_allocate_largest_remainder_internal(bigint,jsonb)','113','B5042D17C1E6DEFD94DDBCFEF794942622F713AFC8F5B3C27601F4C59AB3C458','INVOKER',false],
  ['phase2_canonicalize_receipt_lines_internal(jsonb)','113','4AD838104DC17CCF0812767F2B47B8C826FD2A5DE80D0AA00D3B6CE451EA578D','INVOKER',false],
  ['phase2_request_fingerprint_internal(jsonb)','113','285F6A552D6C94D6B987162C07015CCF53A18BDC8E2FE34CEF01D7B33EF1808E','INVOKER',false],
  ['phase2_try_parse_uuid_internal(text)','113','25AD625F187C98D06C409F45C1DAEB2802E7BD8BEE35AE0F0A96C4D396856169','INVOKER',false],
  ['phase2_lock_inventory_products_internal(uuid[])','113','5B52C52D7DA7CCDCBC44B1C7A5C2864DF3AACF52EE067B92C4EAF85EA8663865','DEFINER',false],
  ['phase2_lock_payment_shift_internal(uuid,text,bigint)','113','0BB1C425E2C3FEC8D2B9DC5426AD3B838F542CAD0238618AA47A69B0E89B04EB','DEFINER',false],
  ['phase2_validate_receipt_lines_internal(jsonb)','113','3669C0007C3F547F8616250ADE36C94E4BA781D39837C1954AE556ACDF878DBA','DEFINER',false],
  ['phase2_apply_inventory_and_wac_internal(uuid,uuid,text,uuid,jsonb,uuid,text)','113','478DE04336B432E0F0E3E637193256C91130A450D5C0C322DC56CC654195F05C','DEFINER',false],
  ['create_direct_supplier_receipt_v2(uuid,uuid,uuid,text,date,timestamptz,bigint,bigint,bigint,bigint,text,text,text,text,text,jsonb)','113','17E5CD89F9B5A6D445FFE9A348A670545AEA02A19629890C64064F0216072030','DEFINER',true],
  ['receive_purchase_order_v2(uuid,uuid,text,date,timestamptz,bigint,bigint,bigint,bigint,text,text,text,text,text,jsonb)','113','22DA75271630B8124C0EE22742B01E2553BC68E2FA02F95B44B73FFBB5264D65','DEFINER',true],
  ['validate_purchase_receipt_item_family_v2()','113','88AAE725DE38F4C0879CBA69E85898547C87B7E8F85ED5BA6424718C125E5ED3','DEFINER',false],
  ['validate_phase2_inventory_movement_source()','113','06FDEB01285F07B9312F981086DAE8A707AC636238E0B9CAA3BE809E777BEB94','DEFINER',false],
  ['assert_phase2_receipt_reconciliation()','113','4AB06D43BE86F88A459472FD1686792E36A64325FA60F5A3BFB175DFA42D512E','DEFINER',false],
];
const receiptV2SchemaAnchors=[
  ['014_simple_inventory_operations.sql','4CD0C139FB18276982EA19119E01444489F2826DD837079204367A9ADCD471F7'],
  ['044_daily_shift_closing_report.sql','7FE9150B98B2CC5E77EE6A00C7BF8A9ACBD701037182A26C21DFE78CF0C11D35'],
  ['057_secure_n8n_automation_events.sql','F6BB003238A82972D449E7DFFF1BB636704B9AF282D883B55FFA7B0B896FD6A6'],
  ['099_advanced_monitoring_and_business_integrity.sql','6F90F4A3E27F81082FDDE1960D486D3BF1B87DE7184EBD3C182C5FBB45CEFCEE'],
  ['103_flavor_receiving_hardening.sql','95321E321E11FBB0C4B923A43A682535587FAD6E5C30EA256451A8FC8952B657'],
  ['112_configurable_parcel_foundation.sql','F169E9B1E5F2878A68CD02C294587C8A1C63689FBDAD95E40B145EB227AF57E3'],
  ['113_configurable_parcel_receiving_and_exact_wac.sql','833D1FF666FC70C399EF0CD838948B817B167F7BA9771AEC02E848E748627307'],
];

export function inspectReceiptV2SourceContract(sources,migrationSources) {
  const signatures=sorted([...sources.keys()]);
  const nodes=receiptV2Anchors.map(([name,prefix,hash,security,authenticated])=>{
    const signature='public.'+name,source=sources.get(signature);
    if(!source||!source.sourceMigration.startsWith(prefix+'_')||sha(lf(source.body))!==hash
      ||source.owner!=='postgres'||source.securityMode!==security||source.searchPath!=='public, pg_temp'
      ||JSON.stringify(source.acl)!==JSON.stringify({public:false,anon:false,authenticated,service_role:false}))
      throw new Error('ADMISSION_RECEIPT_V2_SOURCE_DRIFT:'+signature);
    return {signature,sourceMigration:source.sourceMigration,bodySha256:hash,
      securityMode:source.securityMode,sourceOwner:source.owner,searchPath:source.searchPath,directAcl:source.acl,
      observation:inspectAdmissionBody(lf(source.body),signatures),explicitInserts:inspectExplicitInsertColumns(lf(source.body))};
  });
  const schemaSources=receiptV2SchemaAnchors.map(([name,hash])=>{
    const source=migrationSources.get(name);
    if(typeof source!=='string'||sha(lf(source))!==hash)throw new Error('ADMISSION_RECEIPT_V2_SCHEMA_DRIFT:'+name);
    return {name,canonicalLfSha256:hash,installedDefaultTriggerFkClosure:false};
  });
  const entryNames=['create_direct_supplier_receipt_v2','receive_purchase_order_v2'];
  const entries=entryNames.map((name,index)=>{
    const node=nodes.find(n=>n.signature.startsWith('public.'+name+'('));
    const source=sources.get(node.signature),first=node.observation.firstOwnWrite;
    if(first?.relation!=='public.business_operations')throw new Error('ADMISSION_RECEIPT_V2_FIRST_WRITE_DRIFT');
    const earlyCalls=node.observation.calls.filter(c=>c.offset<first.offset);
    for(const required of ['phase2_lock_payment_shift_internal','phase2_lock_inventory_products_internal','phase2_validate_receipt_lines_internal'])
      if(!earlyCalls.some(c=>c.name==='public.'+required))throw new Error('ADMISSION_RECEIPT_V2_EARLY_SOURCE_EDGE_MISSING');
    const replayReturn=maskAdmissionSql(lf(source.body)).indexOf('RETURN v_existing_operation.result_snapshot;');
    return {kind:index===0?'DIRECT_V2':'PO_V2',signature:node.signature,firstOwnWrite:first,
      prewriteCalls:earlyCalls,prewriteRowLocks:node.observation.rowLocks.filter(l=>l.offset<first.offset),
      gateOrder:compareGateToBoundary(source.body,'public.phase2_lock_inventory_products_internal','INSERT INTO public.business_operations'),
      numberDomain:index===0?'supplier_receipt_seq / GRN-year-six-digit-nextval':'purchase_receipts / GRN-year-six-digit-random-collision-loop',
      idempotencyDomain:index===0?'supplier_receipt:<normalized-key> / cross-actor conflict / legacy UUID collision':'purchase_order_receipt_v2:<actor>:<normalized-key>',
      sourceAuthority:index===0?'request SKU plus active supplier/warehouse/optional branch and unit/config/family evidence':'stored PO/PO-item SKU or family/config/revision/composition and remaining capacity; whole PO completion',
      replayBeforePaymentAndSkuLocks:replayReturn>=0
        &&replayReturn<earlyCalls.find(c=>c.name==='public.phase2_lock_payment_shift_internal').offset,
      firstTransitiveWriteQualified:false};
  });
  const graphPins=new Set(nodes.map(n=>n.signature));
  return {version:1,scope:'SOURCE_BOUND_RECEIPT_V2_DOMAIN_CONTRACT_NOT_EXECUTION_AUTHORITY',nodes,schemaSources,entries,
    graphs:entries.map(e=>deriveAdmissionReachability(e.signature,sources,signatures,graphPins)),
    identityDomains:[
      {relation:'business_operations',identity:'server operation UUID + actor + normalized key + source-exact canonical request fingerprint',coverage:'one per receipt; immutable request BEFORE waits'},
      {relation:'supplier_receipts / purchase_receipts',identity:'server receipt UUID + kind-specific number domain + operation UUID',coverage:'one source-kind-specific header; explicit financial snapshots and timestamp plus omitted default fields'},
      {relation:'supplier_financial_invoice_identities',identity:'supplier + normalized invoice number; server UUID',coverage:'exactly one only for nonblank invoice; active absence fencing remains required'},
      {relation:'supplier_receipt_commercial_lines / purchase_receipt_commercial_lines',identity:'operation + canonical client_line_id; server commercial-line UUID',coverage:'one per client line in client UUID order, distinct from per-SKU WAC'},
      {relation:'supplier_receipt_items / purchase_receipt_items',identity:'operation + client_line_id + component product_id; server item UUID',coverage:'one per component occurrence; same SKU in different client lines MUST stay distinct'},
      {relation:'inventory_movements',identity:'operation + exact receipt-item UUID + source receipt kind/id + SKU + warehouse; server movement UUID',coverage:'one per component occurrence; ordered within SKU by client_line_id; running before/after quantity'},
      {relation:'phase2_receipt_wac_snapshots',identity:'operation + distinct SKU; server WAC snapshot UUID',coverage:'one per SKU, global ALL-warehouse opening quantity and exact WAC, six-decimal result, last ACTUAL movement sequence'},
      {relation:'inventory_balances',identity:'warehouse + distinct SKU; default UUID only for absent row',coverage:'zero INSERT may be attempted even for existing balance; ON CONFLICT does not prove absence/default ownership'},
      {relation:'supplier_payments',identity:'operation + source receipt + supplier; default payment UUID',coverage:'one only if amount>0; actual tender/reference and branch/open Shift trigger; not fabricated customer Order context'},
      {relation:'audit_logs',identity:'actor + receipt action/kind/id + operation + WAC result; default audit UUID',coverage:'source-specific final audit; default/time/FK and downstream audit effects remain open'},
      {relation:'stock_alerts / stock_alert_reads / automation_events / monitoring audit',identity:'actual SKU/warehouse alert state and outbox event key, existing read identities or future default IDs',coverage:'INSERT zero target balance and final UPDATE can produce different alert/read/outbox branches; qualify entire transitive graph'},
      {relation:'inventory_movement_mutation_seq / supplier_receipt_seq',identity:'actual NEXTVAL allocation at its authoritative sequence boundary',coverage:'two distinct sequences; no prediction from last_value; nontransactional sequence gaps are not durable business effects'},
    ],
    allocationContract:'net line weights -> discount/freight largest remainder, ties by client UUID; component explicit cost or base qty weights, ties by SKU; merchandise and acquisition allocations remain distinct; zero basis and numeric overflow reject',
    expectedTruth:'immutable captured request + actual supplier/PO/items/units/config/warehouse + global product/balance anchors; never derive expected identity from movement/WAC/effect rows under validation',
    breakMatrix:['DIRECT/PO/base-unit/parcel and unpaid/paid/absent/existing balance branches','same SKU in multiple client lines with equal qty/cost but distinct identities','equal-weight residual ties under reordered raw input','missing/extra/duplicate/swapped client-line/component identities','foreign PO item/family/config/revision/unit/warehouse or actor','SQL NULL/JSON null/malformed cost, zero basis and bigint overflow','zero cost retained, freight included and legacy tax excluded from WAC','global other-warehouse stock and exact versus rounded legacy cost','source membership/content drift during wait must retry before new locks/writes','default UUID collision/sequence versus random number ownership','stock alert insert/update/resolve, read deletion and outbox deduplication','actual modern RPC comparison plus app-role EXECUTE denial and full content rollback'],
    explicitOpenBoundaries:['full-row omitted defaults/FK/trigger qualification in installed schema','nested feature/role/stock/outbox/audit invoker and writer convergence','receipt V2 private discovery/after-wait revalidation and full resource acquisition','server future IDs, number/sequence/default/unique/absence claims','actual transaction-owned held context and ordered side-effect consumer','real modern RPC/runtime/adversarial and concurrency proof'],
    sourceTraceReviewed:true,fullRowIdentityDomainImplemented:false,allInvokersQualified:false,
    absencePredicatesFenced:false,runtimeAdmissionProven:false,executionAuthority:false};
}

// This is a pinned SOURCE obligation ledger, never an allocation/ownership permit.
// Sequence values are observed only at execution; rollback does not reclaim them.
// Transitive source facts are pinned independently of the captured catalog.
// NULL source owners remain unresolved; isolated catalog ownership is separate
// evidence, never inferred Production authority or future identity reservation.
export function inspectReceiptV2TriggerEffectContract(sources,migrationSources) {
  inspectReceiptV2SourceContract(sources,migrationSources);
  /** @type {Array<[string,string,string,string|null,string,string]>} */
  const pins=[
    ['public.sync_stock_alert(uuid,uuid,int,int)','014_simple_inventory_operations.sql','09198200F16E9D794C55CEBEF3937837F974EB8C8CD59F8E8681BBBC2FC1D85B',null,'DEFINER','public, pg_temp'],
    ['public.sync_stock_alert_from_balance()','014_simple_inventory_operations.sql','4CC1CC81424FD3FD35BF11F866801C454CACCF463572CC0D841B54614C90A3C8',null,'DEFINER','public, pg_temp'],
    ['public.enqueue_stock_automation_event()','057_secure_n8n_automation_events.sql','7A01822C986427FF5DD6A57C0E0599CC4799F3DE08C4608DD98FB59472D92049',null,'DEFINER','public, pg_temp'],
    ['public.enqueue_automation_event(text,text,uuid,jsonb)','099_advanced_monitoring_and_business_integrity.sql','2E8E7635B5754DD4BE7AB3BFBC7678637912EC1E70FBFF9DFCC2DA531E46F1D9',null,'DEFINER','public, pg_temp'],
    ['public.attach_supplier_payment_to_open_shift()','113_configurable_parcel_receiving_and_exact_wac.sql','4EBE9CD878BB928C5730206BD14F924CE47625C3B8953E4B4607E1A22D133F3F','postgres','DEFINER','public, pg_temp'],
    ['public.update_updated_at_column()','107_canonical_schema_reconciliation.sql','C10D3ECDB68D176C4EF7B01C3A1E54694EF57AB9C5DA8DB855E50997E3DFFF31',null,'INVOKER','public'],
  ];
  const nodes=pins.map(([signature,migration,hash,owner,securityMode,searchPath])=>{
    const s=sources.get(signature);
    if(!s||s.sourceMigration!==migration||sha(lf(s.body))!==hash||s.owner!==owner
      ||s.securityMode!==securityMode||s.searchPath!==searchPath
      ||!isDeepStrictEqual(s.acl,{public:false,anon:false,authenticated:false,service_role:false}))
      throw new Error('ADMISSION_RECEIPT_V2_TRIGGER_SOURCE_DRIFT:'+signature);
    return {signature,sourceMigration:migration,bodySha256:hash,sourceOwner:owner,
      securityMode,searchPath,directAcl:structuredClone(s.acl),observation:inspectAdmissionBody(s.body)};
  });
  return {version:1,scope:'RECEIPT_V2_TRANSITIVE_SOURCE_REQUIREMENTS_NOT_OWNERSHIP',nodes,
    stages:[
      {source:'inventory_balances INSERT zero ON CONFLICT DO NOTHING',effect:'AFTER INSERT alert only for actual inserted balance',identity:'warehouse + SKU; new balance/alert UUID default unclaimed'},
      {source:'inventory_balances UPDATE final quantity',effect:'alert create/update/resolve; severity transition deletes existing read identities',identity:'existing alert UUID or unclaimed default + exact stock_alert_id/user_id read set'},
      {source:'stock_alerts INSERT or UPDATE status/severity',effect:'active INSERT/reactivation/severity-change outbox; no resolve/same-severity emission',identity:'stock_alert:<actual-alert-id>:<severity>:<floor(actual-last_updated_at epoch)>'},
      {source:'automation_events INSERT ON CONFLICT event_key DO NOTHING',effect:'new default UUID or exact pre-existing event key; no implicit delivery row',identity:'actual alert identity + source event timestamp; event UUID default remains unclaimed'},
      {source:'supplier_payments INSERT cash/cliq',effect:'attach actual open Shift from kind-specific source branch',identity:'exact source receipt/PO branch + open Shift; no customer Order surrogate'},
    ],
    sourceOwnersResolved:nodes.every(n=>n.sourceOwner!==null),
    installedCatalogValidated:false,defaultsEvaluated:false,transitiveIdentityOwned:false,
    fullWriteTuplesQualified:false,locksHeld:false,executionAuthority:false};
}

// Bounded source-derived quantity/state decision. No UUID/time allocation,
// persistence, permission or financial policy is inferred by this pure model.
export function deriveReceiptV2AlertTransition(contract,input) {
  const fail=()=>{throw new Error('ADMISSION_RECEIPT_V2_ALERT_TRANSITION_INVALID');};
  if(contract?.scope!=='RECEIPT_V2_TRANSITIVE_SOURCE_REQUIREMENTS_NOT_OWNERSHIP'
    ||contract.executionAuthority!==false||contract.transitiveIdentityOwned!==false
    ||!input||Object.keys(input).sort().join('|')!=='active|available|previousSeverity|threshold'
    ||typeof input.active!=='boolean'||!Number.isSafeInteger(input.available)
    ||input.available<-(2**31)||input.available>2**31-1
    ||!(input.threshold===null||Number.isSafeInteger(input.threshold)&&input.threshold>=-(2**31)&&input.threshold<=2**31-1)
    ||![null,'low_stock','out_of_stock'].includes(input.previousSeverity))fail();
  const threshold=Math.max(input.threshold??0,0),previous=input.previousSeverity;
  if(!input.active)return {action:previous===null?'NONE':'RESOLVE_INACTIVE',severity:null,threshold,
    deleteReads:false,emitOutbox:false,newAlertIdentityRequired:false};
  if(input.available>threshold)return {action:previous===null?'NONE':'RESOLVE',severity:null,threshold,
    deleteReads:false,emitOutbox:false,newAlertIdentityRequired:false};
  const severity=input.available<=0?'out_of_stock':'low_stock';
  return {action:previous===null?'INSERT':'UPDATE',severity,threshold,
    deleteReads:previous!==null&&previous!==severity,emitOutbox:previous===null||previous!==severity,
    newAlertIdentityRequired:previous===null};
}

// Full transitive relation/column requirements from independently pinned DDL.
// No captured catalog/default can redefine the expected historical schema.
export function inspectReceiptV2TransitiveRowRequirements(sources,migrationSources,installed) {
  const contract=inspectReceiptV2TriggerEffectContract(sources,migrationSources);
  const time='timestamp with time zone';
  const uuidDefault='gen_random_uuid()';
  const schema={
    stock_alerts:[['id','uuid',true,uuidDefault],['product_id','uuid',true,null],['warehouse_id','uuid',true,null],
      ['severity','text',true,null],['status','text',true,"'active'::text"],['available_quantity','integer',true,null],
      ['threshold_quantity','integer',true,null],['first_triggered_at',time,true,'now()'],
      ['last_updated_at',time,true,'now()'],['resolved_at',time,false,null]],
    stock_alert_reads:[['stock_alert_id','uuid',true,null],['user_id','uuid',true,null],['read_at',time,true,'now()']],
    automation_events:[['id','uuid',true,uuidDefault],['event_key','text',true,null],['event_type','text',true,null],
      ['entity_id','uuid',true,null],['payload','jsonb',true,"'{}'::jsonb"],['created_at',time,true,'now()']],
  };
  const fail=()=>{throw new Error('ADMISSION_RECEIPT_V2_TRANSITIVE_SCHEMA_DRIFT');};
  if(!Array.isArray(installed)||!isDeepStrictEqual(sorted(installed.map(t=>t?.relation)),sorted(Object.keys(schema))))fail();
  const tables=Object.entries(schema).map(([relation,spec])=>{
    const observed=installed.find(t=>t.relation===relation);
    const expected=spec.map(([name,type,notNull,expression])=>({name,type,notNull,default:expression,identity:'',generated:''}));
    if(!observed||!isDeepStrictEqual(observed.columns,expected))fail();
    return {relation:'public.'+relation,columns:structuredClone(expected),
      schemaSource:relation==='automation_events'?'057_secure_n8n_automation_events.sql':'014_simple_inventory_operations.sql'};
  });
  const selected=['public.sync_stock_alert(uuid,uuid,int,int)','public.enqueue_automation_event(text,text,uuid,jsonb)'];
  const writes=selected.flatMap(signature=>{
    const body=sources.get(signature).body,node=contract.nodes.find(n=>n.signature===signature);
    const inserts=inspectExplicitInsertValues(body),updates=inspectExplicitUpdateValues(body);
    return inspectAdmissionBody(body).writes.map(w=>{
      const table=tables.find(t=>t.relation===w.relation);if(!table)fail();
      const binding=w.verb==='INSERT INTO'?inserts.find(i=>i.offset===w.offset)
        :w.verb==='UPDATE'?updates.find(i=>i.offset===w.offset):null;
      if(!['INSERT INTO','UPDATE','DELETE FROM'].includes(w.verb)||w.verb!=='DELETE FROM'&&!binding)fail();
      return {signature,sourceMigration:node.sourceMigration,bodySha256:node.bodySha256,
        relation:w.relation,verb:w.verb,offset:w.offset,
        columns:table.columns.map(c=>{
          const sourceBinding=binding?.bindings.find(b=>b.column===c.name)??null;
          const requirement=sourceBinding?'PINNED_SOURCE_EXPRESSION_NOT_EVALUATED'
            :w.verb!=='INSERT INTO'?'CAPTURED_BEFORE_ROW_OR_DELETE_IDENTITY'
            :c.default===uuidDefault?'ACTUAL_UUID_DEFAULT_ALLOCATION_AND_CLAIM_REQUIRED'
            :c.default==='now()'?'ACTUAL_TRANSACTION_TIMESTAMP_REQUIRED'
            :c.default===null?'OMITTED_SQL_NULL':'PINNED_TYPED_LITERAL_DEFAULT';
          if(w.verb==='INSERT INTO'&&!sourceBinding&&c.default===null&&c.notNull)fail();
          return {...c,requirement,sourceBinding,
            ...(requirement==='OMITTED_SQL_NULL'?{value:null}:{}),
            valueAllocated:false,typedValueQualified:false,ownershipQualified:false};
        }),
        predicate:binding?.predicate??null,
        identityRequirement:w.relation==='public.stock_alert_reads'?'EXACT_CAPTURED_STOCK_ALERT_ID_USER_ID_SET'
          :w.relation==='public.automation_events'?'EXACT_ACTUAL_ALERT_SEVERITY_SOURCE_TIME_EVENT_KEY'
          :'EXACT_SKU_WAREHOUSE_AND_EXISTING_OR_FUTURE_ALERT_ID',
      };
    });
  });
  if(!isDeepStrictEqual(writes.map(w=>[w.relation,w.verb]),[
    ['public.stock_alerts','UPDATE'],['public.stock_alerts','INSERT INTO'],['public.stock_alerts','UPDATE'],
    ['public.stock_alert_reads','DELETE FROM'],['public.stock_alerts','UPDATE'],['public.automation_events','INSERT INTO'],
  ]))fail();
  return {version:1,scope:'TRANSITIVE_COMPLETE_COLUMN_REQUIREMENTS_NOT_MATERIALIZED_OR_OWNED',tables,writes,
    stageRequirements:contract.stages,
    foreignKeyRequirements:[['public.stock_alerts','product_id','public.products','id'],
      ['public.stock_alerts','warehouse_id','public.warehouses','id'],
      ['public.stock_alert_reads','stock_alert_id','public.stock_alerts','id'],
      ['public.stock_alert_reads','user_id','public.profiles','id']],
    futureIdentitySetDerived:false,foreignKeysInstalledValidated:false,invokerClosureQualified:false,
    defaultsEvaluated:false,typedFullRowsQualified:false,durableIdentityClaimed:false,executionAuthority:false};
}

export function assertReceiptV2TransitiveRowRequirements(sources,migrationSources,installed,expected) {
  if(!isDeepStrictEqual(expected,inspectReceiptV2TransitiveRowRequirements(sources,migrationSources,installed)))
    throw new Error('ADMISSION_RECEIPT_V2_TRANSITIVE_REQUIREMENTS_CHANGED');
  return true;
}

// Symbolic full-column stock stages. Unknown execution time/UUIDs are explicit
// requirements, not invented values. A fresh DB source assertion remains the
// caller's obligation; this model is never a mutation permit.
export function deriveReceiptV2StockStages(sources,migrationSources,installed,snapshot) {
  const ledger=inspectReceiptV2TransitiveRowRequirements(sources,migrationSources,installed);
  const contract=inspectReceiptV2TriggerEffectContract(sources,migrationSources);
  const fail=()=>{throw new Error('ADMISSION_RECEIPT_V2_STOCK_STAGES_INVALID');};
  const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(v)
    &&v!=='00000000-0000-0000-0000-000000000000';
  const keys=(value,expected)=>value&&isDeepStrictEqual(Object.keys(value).sort(),[...expected].sort());
  if(!keys(snapshot,['targets','alerts','reads','events'])||!['targets','alerts','reads','events'].every(k=>Array.isArray(snapshot[k]))
    ||snapshot.targets.length===0)fail();
  const schema=new Map(ledger.tables.map(t=>[t.relation,t.columns]));
  const row=(relation,value)=>{
    const columns=schema.get(relation);if(!keys(value,columns.map(c=>c.name)))fail();
    for(const c of columns){const v=value[c.name];
      if(v===null){if(c.notNull)fail();continue;}
      if(c.type==='uuid'&&!uuid(v)||c.type==='integer'&&(!Number.isSafeInteger(v)||v<-(2**31)||v>2**31-1)
        ||['text','timestamp with time zone'].includes(c.type)&&typeof v!=='string'
        ||c.type==='jsonb'&&(typeof v!=='object'||Array.isArray(v)))fail();
    }
  };
  const targets=[...snapshot.targets].sort((a,b)=>String(a.productId).localeCompare(String(b.productId)));
  const seen=new Set(),alertIds=new Set(),readIds=new Set(),eventIds=new Set(),eventKeys=new Set();
  for(const t of targets){
    if(!keys(t,['productId','warehouseId','productName','warehouseName','active','threshold','beforeAvailable','afterAvailable'])
      ||!uuid(t.productId)||!uuid(t.warehouseId)||seen.has(t.productId)
      ||!['productName','warehouseName'].every(k=>t[k]===null||typeof t[k]==='string')
      ||!(t.beforeAvailable===null||Number.isSafeInteger(t.beforeAvailable)&&t.beforeAvailable>=-(2**31)&&t.beforeAvailable<=2**31-1)
      ||!Number.isSafeInteger(t.afterAvailable)||t.afterAvailable<=(t.beforeAvailable??0))fail();
    if(targets.some(other=>other.warehouseId!==t.warehouseId))fail();seen.add(t.productId);
    deriveReceiptV2AlertTransition(contract,{active:t.active,threshold:t.threshold,available:t.afterAvailable,previousSeverity:null});
  }
  for(const a of snapshot.alerts){row('public.stock_alerts',a);
    if(alertIds.has(a.id)||!targets.some(t=>t.productId===a.product_id&&t.warehouseId===a.warehouse_id)
      ||!['active','resolved'].includes(a.status)||!['low_stock','out_of_stock'].includes(a.severity))fail();alertIds.add(a.id);}
  for(const r of snapshot.reads){row('public.stock_alert_reads',r);const key=r.stock_alert_id+'|'+r.user_id;
    if(readIds.has(key)||!alertIds.has(r.stock_alert_id))fail();readIds.add(key);}
  for(const e of snapshot.events){row('public.automation_events',e);
    if(eventIds.has(e.id)||eventKeys.has(e.event_key)||!snapshot.alerts.some(a=>e.entity_id===a.id||e.event_key.startsWith('stock_alert:'+a.id+':')))fail();
    eventIds.add(e.id);eventKeys.add(e.event_key);}
  const value=v=>({requirement:'BOUND_CAPTURED_OR_SOURCE_VALUE',value:structuredClone(v)});
  const time={requirement:'ACTUAL_TRANSACTION_TIMESTAMP_AT_EXECUTION'};
  const stages=[],identityRequirements=[];
  for(const t of targets){
    const active=snapshot.alerts.filter(a=>a.product_id===t.productId&&a.warehouse_id===t.warehouseId&&a.status==='active');
    if(active.length>1)fail();let before=active[0]?Object.fromEntries(Object.entries(active[0]).map(([k,v])=>[k,value(v)])):null;
    let remainingReads=structuredClone(snapshot.reads);
    const amounts=[...(t.beforeAvailable===null?[{stage:'ZERO_INSERT',available:0}]:[]),{stage:'FINAL_UPDATE',available:t.afterAvailable}];
    for(const step of amounts){
      const decision=deriveReceiptV2AlertTransition(contract,{active:t.active,threshold:t.threshold,available:step.available,
        previousSeverity:before?.status.value==='active'?before.severity.value:null});
      if(decision.action==='NONE')continue;
      let after=before?structuredClone(before):null;
      if(decision.action==='INSERT'){
        const slot=`ALERT|${t.productId}|${t.warehouseId}|${step.stage}`;
        after={id:{requirement:'SERVER_UUID_ALLOCATION_AND_CLAIM',slot},product_id:value(t.productId),warehouse_id:value(t.warehouseId),
          severity:value(decision.severity),status:value('active'),available_quantity:value(step.available),threshold_quantity:value(decision.threshold),
          first_triggered_at:time,last_updated_at:time,resolved_at:value(null)};
        identityRequirements.push({relation:'public.stock_alerts',slot,condition:'ACTUAL_ALERT_INSERT_AFTER_FRESH_SOURCE_REVALIDATION'});
      }else {
        after.last_updated_at=time;after.resolved_at=decision.action.startsWith('RESOLVE')?time:value(null);
        if(decision.action.startsWith('RESOLVE'))after.status=value('resolved');
        if(decision.action!=='RESOLVE_INACTIVE'){
          after.available_quantity=value(step.available);after.threshold_quantity=value(decision.threshold);
          if(decision.severity!==null)after.severity=value(decision.severity);
        }
      }
      const deletedReads=decision.deleteReads?remainingReads.filter(r=>before.id.value===r.stock_alert_id):[];
      remainingReads=remainingReads.filter(r=>!deletedReads.some(d=>d.stock_alert_id===r.stock_alert_id&&d.user_id===r.user_id));
      const outbox=decision.emitOutbox?{
        relation:'public.automation_events',beforeCandidates:structuredClone(snapshot.events),
        columns:{id:{requirement:'EXISTING_EVENT_KEY_OR_SERVER_UUID_ALLOCATION_AND_CLAIM'},
          event_key:{requirement:'RESOLVE_EXACT_ALERT_SEVERITY_ACTUAL_EVENT_EPOCH',alert:after.id,severity:decision.severity},
          event_type:value(decision.severity),entity_id:after.id,
          payload:{requirement:'SOURCE_PAYLOAD_WITH_ACTUAL_ALERT_AND_TIME',fields:{stockAlertId:after.id,
            productId:value(t.productId),productName:value(t.productName??'صنف'),warehouseId:value(t.warehouseId),
            warehouseName:value(t.warehouseName??'المستودع'),availableQuantity:value(step.available),
            thresholdQuantity:value(decision.threshold),severity:value(decision.severity),updatedAt:time}},created_at:time},
        onConflict:'PRESERVE_EXACT_PREEXISTING_EVENT_CONTENT_NO_NEW_IDENTITY',
      }:null;
      if(outbox)identityRequirements.push({relation:'public.automation_events',slot:`OUTBOX|${t.productId}|${t.warehouseId}|${step.stage}|${decision.severity}`,
        condition:'ONLY_IF_RESOLVED_EXACT_EVENT_KEY_ABSENT_AFTER_ACTUAL_ALERT_UUID_AND_TIME'});
      if(!isDeepStrictEqual(Object.keys(after).sort(),schema.get('public.stock_alerts').map(c=>c.name).sort()))fail();
      stages.push({productId:t.productId,warehouseId:t.warehouseId,stage:step.stage,decision,
        alert:{relation:'public.stock_alerts',before,after},deletedReads:structuredClone(deletedReads),outbox});
      before=after;
    }
  }
  return {version:1,scope:'SYMBOLIC_STOCK_OLD_NEW_AND_CONDITIONAL_IDENTITY_REQUIREMENTS',stages,identityRequirements,
    retainedSnapshot:structuredClone(snapshot),sourcePlanValidationRequired:'FRESH_DB_ASSERT_WITH_CAPTURED_REQUEST_AND_ALLOCATION',
    sourcePlanValidatedByThisAnalysis:false,actualEventValuesAllocated:false,futureIdentitySetResolved:false,
    paymentUnionComplete:false,durableIdentityClaimed:false,locksHeld:false,executionAuthority:false};
}

export function assertReceiptV2StockStages(sources,migrationSources,installed,snapshot,expected) {
  if(!isDeepStrictEqual(expected,deriveReceiptV2StockStages(sources,migrationSources,installed,snapshot)))
    throw new Error('ADMISSION_RECEIPT_V2_STOCK_STAGES_CHANGED');
  return true;
}

// Resolve only identities already present in the freshly captured source.
// The clock must be captured from PostgreSQL in UTC at the execution boundary;
// this pure check proves representation consistency, never clock authority.
// New alert/event UUIDs and global key/UUID absence remain unclaimed requirements.
export function resolveReceiptV2CapturedAlertEvents(sources,migrationSources,installed,snapshot,clock) {
  const symbolic=deriveReceiptV2StockStages(sources,migrationSources,installed,snapshot);
  const fail=()=>{throw new Error('ADMISSION_RECEIPT_V2_EVENT_CLOCK_INVALID');};
  if(!clock||!isDeepStrictEqual(Object.keys(clock).sort(),['epochFloorSeconds','timestampUtc'])
    ||typeof clock.timestampUtc!=='string'||typeof clock.epochFloorSeconds!=='string'
    ||! /^(?:0|[1-9]\d*|-[1-9]\d*)$/u.test(clock.epochFloorSeconds))fail();
  const match=clock.timestampUtc.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(?:Z|\+00:00)$/u);
  if(!match||Number(match[1])<1000)fail();
  // Parse the whole second only: preserve all six fractional digits verbatim.
  // Round-trip rejects rollover dates and unsupported leap-second spellings.
  const whole=match.slice(1,7).map(Number),ms=Date.UTC(whole[0],whole[1]-1,whole[2],whole[3],whole[4],whole[5]);
  const date=new Date(ms);
  if(!Number.isSafeInteger(ms)||!isDeepStrictEqual(whole,[date.getUTCFullYear(),date.getUTCMonth()+1,
    date.getUTCDate(),date.getUTCHours(),date.getUTCMinutes(),date.getUTCSeconds()])
    ||BigInt(ms/1000).toString()!==clock.epochFloorSeconds)fail();
  const materialize=(bindings)=>Object.fromEntries(Object.entries(bindings).map(([key,b])=>{
    if(b.requirement==='BOUND_CAPTURED_OR_SOURCE_VALUE')return [key,structuredClone(b.value)];
    if(b.requirement==='ACTUAL_TRANSACTION_TIMESTAMP_AT_EXECUTION')return [key,clock.timestampUtc];
    throw new Error('ADMISSION_RECEIPT_V2_EVENT_BINDING_UNRESOLVED');
  }));
  const decisions=symbolic.stages.map((stage,index)=>{
    const identity=stage.alert.after.id;
    if(identity.requirement==='SERVER_UUID_ALLOCATION_AND_CLAIM')return {
      index,productId:stage.productId,warehouseId:stage.warehouseId,stage:stage.stage,
      status:'UNRESOLVED_FUTURE_ALERT_IDENTITY',alertSlot:identity.slot,eventKey:null,
    };
    const after=materialize(stage.alert.after),before=stage.alert.before===null?null:materialize(stage.alert.before);
    let outbox=null;
    if(stage.outbox){
      const eventKey=`stock_alert:${after.id}:${after.severity}:${clock.epochFloorSeconds}`;
      const captured=snapshot.events.filter(e=>e.event_key===eventKey);
      if(captured.length>1)throw new Error('ADMISSION_RECEIPT_V2_EVENT_KEY_DUPLICATE');
      outbox=captured.length===1?{action:'PRESERVE_EXACT_CAPTURED_EVENT',eventKey,
        capturedRow:structuredClone(captured[0]),newRowWithoutId:null,newIdentitySlot:null}
        :{action:'REQUIRE_SERVER_EVENT_UUID_AND_FRESH_ABSENCE_FENCE',eventKey,capturedRow:null,
          newRowWithoutId:{event_key:eventKey,event_type:after.severity,entity_id:after.id,
            payload:materialize(stage.outbox.columns.payload.fields),created_at:clock.timestampUtc},
          newIdentitySlot:`OUTBOX|${stage.productId}|${stage.warehouseId}|${stage.stage}|${after.severity}`};
    }
    return {index,productId:stage.productId,warehouseId:stage.warehouseId,stage:stage.stage,
      status:'CAPTURED_ALERT_KEY_RESOLVED_NOT_OWNED',before,after,deletedReads:structuredClone(stage.deletedReads),outbox};
  });
  return {version:1,scope:'CAPTURED_ALERT_EVENT_DECISIONS_NOT_FUTURE_ALLOCATION_OR_AUTHORITY',
    clock:structuredClone(clock),decisions,retainedSnapshot:structuredClone(snapshot),
    sourcePlanValidationRequired:'FRESH_DB_ASSERT_AND_DB_UTC_TRANSACTION_CLOCK_CAPTURE',
    sourcePlanValidatedByThisAnalysis:false,clockAuthorityQualified:false,futureIdentitySetResolved:false,
    absenceFenceHeld:false,durableIdentityClaimed:false,fullTypedWriteTuplesQualified:false,
    locksHeld:false,executionAuthority:false};
}

export function assertReceiptV2CapturedAlertEvents(sources,migrationSources,installed,snapshot,clock,expected) {
  if(!isDeepStrictEqual(expected,resolveReceiptV2CapturedAlertEvents(sources,migrationSources,installed,snapshot,clock)))
    throw new Error('ADMISSION_RECEIPT_V2_CAPTURED_EVENTS_CHANGED');
  return true;
}

// Independent candidate comparison, NEVER UUID minting/ownership authority.
// Full global event capture is separate from the source alert resource subset:
// even an unrelated entity can already own the exact UNIQUE event_key in 099.
export function resolveReceiptV2StockCandidateRequirements(sources,migrationSources,installed,snapshot,clock,allocation,globalEvents) {
  resolveReceiptV2CapturedAlertEvents(sources,migrationSources,installed,snapshot,clock);
  const symbolic=deriveReceiptV2StockStages(sources,migrationSources,installed,snapshot);
  const fail=()=>{throw new Error('ADMISSION_RECEIPT_V2_STOCK_CANDIDATE_INVALID');};
  const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(v)
    &&v!=='00000000-0000-0000-0000-000000000000';
  if(!Array.isArray(allocation)||allocation.length!==symbolic.stages.length||!Array.isArray(globalEvents))fail();
  const eventIds=new Set(),eventKeys=new Set();
  for(const e of globalEvents){
    if(!e||Array.isArray(e)||!isDeepStrictEqual(Object.keys(e).sort(),['created_at','entity_id','event_key','event_type','id','payload'])
      ||!uuid(e.id)||!uuid(e.entity_id)||typeof e.event_key!=='string'||typeof e.event_type!=='string'
      ||typeof e.created_at!=='string'||!e.payload||typeof e.payload!=='object'||Array.isArray(e.payload)
      ||eventIds.has(e.id)||eventKeys.has(e.event_key))fail();
    eventIds.add(e.id);eventKeys.add(e.event_key);
  }
  // The global capture must contain the exact previously retained event rows.
  for(const e of snapshot.events)if(!globalEvents.some(g=>isDeepStrictEqual(g,e)))fail();
  const occupied=new Set([...snapshot.targets.flatMap(t=>[t.productId,t.warehouseId]),
    ...snapshot.alerts.map(a=>a.id),...snapshot.reads.flatMap(r=>[r.stock_alert_id,r.user_id]),
    ...globalEvents.flatMap(e=>[e.id,e.entity_id])]);
  const allocated=new Set(),slots=new Map();
  const use=(id)=>{if(!uuid(id)||occupied.has(id)||allocated.has(id))fail();allocated.add(id);return id;};
  const materialize=bindings=>Object.fromEntries(Object.entries(bindings).map(([key,b])=>{
    if(b.requirement==='BOUND_CAPTURED_OR_SOURCE_VALUE')return [key,structuredClone(b.value)];
    if(b.requirement==='ACTUAL_TRANSACTION_TIMESTAMP_AT_EXECUTION')return [key,clock.timestampUtc];
    if(b.requirement==='SERVER_UUID_ALLOCATION_AND_CLAIM'&&slots.has(b.slot))return [key,slots.get(b.slot)];
    fail();
  }));
  const stages=symbolic.stages.map((s,index)=>{
    const ids=allocation[index];
    if(!ids||Array.isArray(ids)||!isDeepStrictEqual(Object.keys(ids).sort(),['alertId','eventId','productId','stage','warehouseId'])
      ||ids.productId!==s.productId||ids.warehouseId!==s.warehouseId||ids.stage!==s.stage)fail();
    if(s.decision.newAlertIdentityRequired)slots.set(s.alert.after.id.slot,use(ids.alertId));
    else if(ids.alertId!==null)fail();
    const before=s.alert.before===null?null:materialize(s.alert.before),after=materialize(s.alert.after);
    let eventKey=null,eventPayload=null,eventDisposition='NONE',storedEvent=null;
    if(s.outbox){
      eventKey=`stock_alert:${after.id}:${after.severity}:${clock.epochFloorSeconds}`;
      eventPayload=materialize(s.outbox.columns.payload.fields);
      const existing=globalEvents.find(e=>e.event_key===eventKey);
      if(existing){eventDisposition='REUSE_PREEXISTING';storedEvent=structuredClone(existing);
        if(ids.eventId!==null)fail();
      }else {eventDisposition='INSERT_NEW';storedEvent={id:use(ids.eventId),event_key:eventKey,event_type:after.severity,
        entity_id:after.id,payload:eventPayload,created_at:clock.timestampUtc};}
    }else if(ids.eventId!==null)fail();
    return {productId:s.productId,warehouseId:s.warehouseId,stage:s.stage,action:s.decision.action,before,after,
      deletedReads:structuredClone(s.deletedReads),eventKey,eventPayload,eventDisposition,storedEvent};
  });
  return {stages,allocation:structuredClone(allocation),clock:structuredClone(clock),
    scope:'INDEPENDENT_CANDIDATE_COMPARISON_NOT_ALLOCATION_AUTHORITY',
    sourcePlanValidatedByThisAnalysis:false,clockAuthorityQualified:false,durableIdentityClaimed:false,
    absencePredicatesFenced:false,afterWaitRevalidated:false,locksHeld:false,executionAuthority:false};
}

export function inspectReceiptV2DeferredValueContract(sources,migrationSources) {
  const contract=inspectReceiptV2SourceContract(sources,migrationSources);
  const modern=lf(migrationSources.get('113_configurable_parcel_receiving_and_exact_wac.sql'));
  const direct=contract.nodes.find(n=>n.signature.startsWith('public.create_direct_supplier_receipt_v2('));
  const po=contract.nodes.find(n=>n.signature.startsWith('public.receive_purchase_order_v2('));
  const inventory=contract.nodes.find(n=>n.signature.startsWith('public.phase2_apply_inventory_and_wac_internal('));
  if(!direct||!po||!inventory)throw new Error('ADMISSION_RECEIPT_V2_DEFERRED_SOURCE_MISSING');
  const directBody=lf(sources.get(direct.signature).body),poBody=lf(sources.get(po.signature).body);
  const inventoryBody=lf(sources.get(inventory.signature).body);
  if(!/LPAD\(NEXTVAL\('public\.supplier_receipt_seq'\)::TEXT, 6, '0'\)/u.test(directBody)
    ||! /LPAD\(FLOOR\(100000 \+ RANDOM\(\) \* 900000\)::BIGINT::TEXT, 6, '0'\)/u.test(poBody)
    ||! /WHERE receipt\.receipt_number = v_receipt_number/u.test(poBody)
    ||! /IF NEW\.mutation_sequence IS NULL THEN\s+NEW\.mutation_sequence := NEXTVAL\('public\.inventory_movement_mutation_seq'\)/u.test(modern)
    ||! /BEFORE INSERT ON public\.inventory_movements\s+FOR EACH ROW EXECUTE FUNCTION public\.assign_inventory_movement_mutation_sequence\(\)/u.test(modern)
    ||! /RETURNING mutation_sequence INTO v_last_movement_sequence/u.test(inventoryBody))
    throw new Error('ADMISSION_RECEIPT_V2_DEFERRED_VALUE_DRIFT');
  const writes=contract.nodes.flatMap(n=>n.explicitInserts.map(write=>({
    signature:n.signature,sourceMigration:n.sourceMigration,bodySha256:n.bodySha256,
    relation:write.relation,offset:write.offset,explicitColumns:write.columns,
    installedOmittedDefaultsQualified:false,generatedTupleComplete:false,
  })));
  return {version:1,scope:'SOURCE_OBLIGATIONS_NOT_RUNTIME_OWNERSHIP',writes,
    numberDomains:[
      {kind:'DIRECT_V2',source:direct.signature,allocation:'ACTUAL_NEXTVAL_supplier_receipt_seq',format:'GRN-year-LPAD6',rollbackReclaimsSequence:false},
      {kind:'PO_V2',source:po.signature,allocation:'ACTUAL_RANDOM_CANDIDATE_AND_ABSENCE_RECHECK',format:'GRN-year-six-digit-random',absenceFenced:false},
    ],
    movementSequence:{relation:'public.inventory_movements',field:'mutation_sequence',
      allocation:'NULL_ONLY_BEFORE_INSERT_TRIGGER',sequence:'public.inventory_movement_mutation_seq',
      consumer:'RETURNING mutation_sequence INTO v_last_movement_sequence',
      rollbackReclaimsSequence:false,callerSuppliedValueSafe:false},
    predictionAllowed:false,sequenceConsumed:false,numberClaimed:false,
    fullWriteTuplesQualified:false,stockPaymentEffectsQualified:false,
    durableIdentityClaimed:false,locksHeld:false,executionAuthority:false};
}

// Decode only a bounded literal grammar. Never execute SQL, coerce money to
// unsafe JS Number, or infer UUID/time/sequence values from catalog text.
export function decodeReceiptV2LiteralRequirement(expression,type) {
  if(typeof expression!=='string'||typeof type!=='string')throw new Error('ADMISSION_RECEIPT_V2_LITERAL_INVALID');
  if(type==='boolean'&&['true','false'].includes(expression))return {type,value:expression==='true',encoding:'BOOLEAN'};
  if(['smallint','integer','bigint'].includes(type)&&/^-?\d+$/u.test(expression)){
    const value=BigInt(expression),bits=type==='smallint'?16n:type==='integer'?32n:64n;
    if(value<-(1n<<(bits-1n))||value>(1n<<(bits-1n))-1n)throw new Error('ADMISSION_RECEIPT_V2_LITERAL_RANGE_INVALID');
    return {type,value:value.toString(),encoding:'EXACT_INTEGER_TEXT'};
  }
  if(/^numeric(?:\(\d+,\d+\))?$/u.test(type)&&/^-?\d+(?:\.\d+)?$/u.test(expression)){
    const precision=type.match(/^numeric\((\d+),(\d+)\)$/u);
    if(precision){
      const [whole,fraction='']=expression.replace(/^-/u,'').split('.');
      if(fraction.length>Number(precision[2])||whole.replace(/^0+/u,'').length>Number(precision[1])-Number(precision[2]))
        throw new Error('ADMISSION_RECEIPT_V2_LITERAL_PRECISION_UNRESOLVED');
    }
    return {type,value:expression,encoding:'EXACT_DECIMAL_TEXT'};
  }
  const literal=expression.match(/^'((?:[^']|'')*)'::(text|character varying|jsonb)$/u);
  if(literal&&literal[2]===type){
    const value=literal[1].replace(/''/gu,"'");
    // Backslash interpretation depends on server settings; no silent guessing.
    if(value.includes('\\'))throw new Error('ADMISSION_RECEIPT_V2_LITERAL_ESCAPE_UNRESOLVED');
    if(type==='jsonb'){
      // JSON numbers would be rounded by JSON.parse. Only empty containers are
      // presently source-qualified; other JSON defaults require a later codec.
      if(value!=='{}'&&value!=='[]')throw new Error('ADMISSION_RECEIPT_V2_LITERAL_JSON_UNRESOLVED');
      return {type,value:JSON.parse(value),encoding:'EMPTY_JSON_CONTAINER'};
    }
    return {type,value,encoding:'TEXT'};
  }
  throw new Error('ADMISSION_RECEIPT_V2_LITERAL_TYPE_UNRESOLVED');
}

// Independent historical anchors, not expectations copied from pg_attrdef.
// Only checkout line endings are canonicalized; any other source drift fails.
export function inspectReceiptV2LiteralSourcePins(migrationSources,observed) {
  const pins=[
    {relation:'public.supplier_receipts',column:'is_archived',type:'boolean',notNull:true,expression:'false',
      migration:'009_direct_goods_receiving.sql',sourceSha256:'1B7B34616BD79A4A1B121479E2CA3870EEFC586134D0F8A51CE1F237BD293B72',
      ddl:'CREATE TABLE IF NOT EXISTS public.supplier_receipts (',declaration:'  is_archived BOOLEAN NOT NULL DEFAULT false,'},
    {relation:'public.supplier_payments',column:'is_reversed',type:'boolean',notNull:true,expression:'false',
      migration:'016_safe_paid_supplier_receipt_reversal.sql',sourceSha256:'8D5642C733B42C275B94D6F05516DD97ECED31381EBF7D1FECB934DA8969A6A2',
      ddl:'ALTER TABLE public.supplier_payments',declaration:'  ADD COLUMN IF NOT EXISTS is_reversed BOOLEAN NOT NULL DEFAULT false,'},
    {relation:'public.supplier_financial_invoice_identities',column:'is_active',type:'boolean',notNull:true,expression:'true',
      migration:'113_configurable_parcel_receiving_and_exact_wac.sql',sourceSha256:'833D1FF666FC70C399EF0CD838948B817B167F7BA9771AEC02E848E748627307',
      ddl:'CREATE TABLE public.supplier_financial_invoice_identities (',declaration:'  is_active BOOLEAN NOT NULL DEFAULT true,'},
  ];
  for(const pin of pins){
    const raw=migrationSources.get(pin.migration);
    if(typeof raw!=='string'||sha(lf(raw))!==pin.sourceSha256)
      throw new Error('ADMISSION_RECEIPT_V2_LITERAL_SOURCE_DRIFT:'+pin.migration);
    const source=lf(raw),start=source.indexOf(pin.ddl),end=source.indexOf(';',start);
    if(start<0||end<0||!source.slice(start,end).split('\n').includes(pin.declaration))
      throw new Error('ADMISSION_RECEIPT_V2_LITERAL_DDL_UNRESOLVED');
  }
  const tuple=p=>[p?.relation,p?.column,p?.type,p?.notNull,p?.expression];
  const canonical=rows=>rows.map(p=>JSON.stringify(tuple(p))).sort();
  if(!Array.isArray(observed)||JSON.stringify(canonical(observed))!==JSON.stringify(canonical(pins)))
    throw new Error('ADMISSION_RECEIPT_V2_LITERAL_EXACT_SET_INVALID');
  return {version:1,scope:'HISTORICAL_LITERAL_PINS_ONLY',pins:pins.map(p=>({...p,
    decoded:decodeReceiptV2LiteralRequirement(p.expression,p.type)})),
    defaultsEvaluated:false,fullWriteTuplesQualified:false,ownershipQualified:false,executionAuthority:false};
}

// Classify every installed column for every pinned INSERT occurrence. This
// consumes catalog observations, never evaluates a default or grants ownership.
export function inspectReceiptV2InstalledValueRequirements(sources,migrationSources,installed) {
  const source=inspectReceiptV2DeferredValueContract(sources,migrationSources);
  const relations=sorted(new Set(source.writes.map(w=>w.relation.replace(/^public\./u,''))));
  if(!Array.isArray(installed)||JSON.stringify(sorted(installed.map(t=>t?.relation)))!==JSON.stringify(relations))
    throw new Error('ADMISSION_RECEIPT_V2_INSTALLED_RELATIONS_INVALID');
  const tables=new Map(installed.map(t=>[t.relation,t]));
  for(const table of installed){
    if(!Array.isArray(table.columns)||table.columns.length===0||new Set(table.columns.map(c=>c?.name)).size!==table.columns.length)
      throw new Error('ADMISSION_RECEIPT_V2_INSTALLED_COLUMNS_INVALID');
    for(const c of table.columns)if(!c||typeof c.name!=='string'||typeof c.type!=='string'||typeof c.notNull!=='boolean'
      ||c.identity!==''||!['','s'].includes(c.generated)||!(c.default===null||typeof c.default==='string'))
      throw new Error('ADMISSION_RECEIPT_V2_INSTALLED_COLUMN_INVALID');
  }
  const writes=source.writes.map(write=>{
    const table=tables.get(write.relation.replace(/^public\./u,''));
    if(!Array.isArray(write.explicitColumns)||write.explicitColumns.some(n=>!table.columns.some(c=>c.name===n)))
      throw new Error('ADMISSION_RECEIPT_V2_EXPLICIT_COLUMN_UNRESOLVED');
    const columns=table.columns.map(c=>{
      let domain;
      if(c.generated!==''){
        if(table.relation!=='inventory_balances'||c.name!=='available_quantity'||c.type!=='integer'
          ||c.default!=='(on_hand_quantity - reserved_quantity)'||write.explicitColumns.includes(c.name))
          throw new Error('ADMISSION_RECEIPT_V2_GENERATED_VALUE_UNRESOLVED');
        domain='GENERATED_AVAILABLE_QUANTITY';
      }else if(write.explicitColumns.includes(c.name))domain='EXPLICIT_SOURCE_VALUE';
      else if(table.relation==='inventory_movements'&&c.name==='mutation_sequence'){
        if(c.type!=='bigint'||c.default!==null)throw new Error('ADMISSION_RECEIPT_V2_MOVEMENT_SEQUENCE_UNRESOLVED');
        domain='ACTUAL_NULL_ONLY_BEFORE_INSERT_SEQUENCE';
      }else if(c.default===null){
        if(c.notNull)throw new Error('ADMISSION_RECEIPT_V2_REQUIRED_OMISSION_UNRESOLVED:'+table.relation+'.'+c.name);
        domain='OMITTED_NULL';
      }else if(c.default==='gen_random_uuid()'||c.default==='extensions.gen_random_uuid()'){
        if(c.type!=='uuid')throw new Error('ADMISSION_RECEIPT_V2_UUID_DEFAULT_TYPE_INVALID');
        domain='OMITTED_UUID_REQUIRES_SERVER_ALLOCATION_AND_CLAIM';
      }else if(c.default==='now()'||c.default==='CURRENT_TIMESTAMP'){
        if(c.type!=='timestamp with time zone')throw new Error('ADMISSION_RECEIPT_V2_TIME_DEFAULT_TYPE_INVALID');
        domain='OMITTED_ACTUAL_TRANSACTION_TIMESTAMP';
      }else if(/^(?:true|false|-?\d+(?:\.\d+)?|'(?:[^']|'')*'::[a-z_][\w .]*(?:\[\])?)$/u.test(c.default)){
        domain='OMITTED_LITERAL_DEFAULT_REQUIRES_TYPED_VALUE_PROOF';
      }else throw new Error('ADMISSION_RECEIPT_V2_DEFAULT_EXPRESSION_UNRESOLVED:'+table.relation+'.'+c.name);
      return {...c,domain,valueAllocated:false,ownershipQualified:false};
    });
    return {signature:write.signature,sourceMigration:write.sourceMigration,offset:write.offset,relation:write.relation,columns};
  });
  return {version:1,scope:'INSTALLED_PRIMARY_COLUMN_REQUIREMENTS_NOT_VALUE_OR_OWNERSHIP_AUTHORITY',writes,
    defaultsEvaluated:false,sequenceConsumed:false,fullWriteTuplesQualified:false,
    triggerEffectsQualified:false,durableIdentityClaimed:false,locksHeld:false,executionAuthority:false};
}

// Complete primary INSERT column requirements, not materialized rows or an
// execution permit. Runtime/default/trigger claims stay explicit and unfilled.
export function inspectReceiptV2RowRequirements(sources,migrationSources,installed) {
  const ledger=inspectReceiptV2InstalledValueRequirements(sources,migrationSources,installed);
  const observed=new Map();
  for(const write of ledger.writes)for(const c of write.columns)
    if(c.domain==='OMITTED_LITERAL_DEFAULT_REQUIRES_TYPED_VALUE_PROOF'){
      const key=write.relation+'|'+c.name;
      const tuple={relation:write.relation,column:c.name,type:c.type,notNull:c.notNull,expression:c.default};
      if(observed.has(key)&&JSON.stringify(observed.get(key))!==JSON.stringify(tuple))
        throw new Error('ADMISSION_RECEIPT_V2_ROW_LITERAL_INCONSISTENT');
      observed.set(key,tuple);
    }
  const pins=inspectReceiptV2LiteralSourcePins(migrationSources,[...observed.values()]);
  const literalPins=new Map(pins.pins.map(p=>[p.relation+'|'+p.column,p]));
  const inserts=new Map();
  for(const signature of new Set(ledger.writes.map(w=>w.signature)))
    for(const insert of inspectExplicitInsertValues(sources.get(signature).body))
      inserts.set(signature+'|'+insert.offset,insert);
  const writes=ledger.writes.map(write=>{
    const insert=inserts.get(write.signature+'|'+write.offset);
    if(!insert||insert.relation!==write.relation)throw new Error('ADMISSION_RECEIPT_V2_ROW_SOURCE_UNRESOLVED');
    const columns=write.columns.map(c=>{
      const base={name:c.name,type:c.type,notNull:c.notNull,domain:c.domain};
      if(c.domain==='EXPLICIT_SOURCE_VALUE'){
        const binding=insert.bindings.find(b=>b.column===c.name);
        if(!binding)throw new Error('ADMISSION_RECEIPT_V2_ROW_BINDING_MISSING');
        const expression=binding.expression;
        const requirement=expression==='NULL'?'EXPLICIT_SQL_NULL'
          :expression==='NOW()'?'ACTUAL_TRANSACTION_TIMESTAMP'
          :expression==='COALESCE(p_received_at, NOW())'?'CAPTURED_RECEIVED_AT_OR_ACTUAL_TRANSACTION_TIMESTAMP'
          :expression==='v_receipt_number'?'ACTUAL_SOURCE_KIND_RECEIPT_NUMBER'
          :expression==='v_last_movement_sequence'?'ACTUAL_MOVEMENT_RETURNING_SEQUENCE'
          :'PINNED_SOURCE_EXPRESSION_NOT_EVALUATED';
        return {...base,requirement,sourceBinding:binding,...(requirement==='EXPLICIT_SQL_NULL'?{value:null}:{})};
      }
      if(c.domain==='OMITTED_NULL')return {...base,requirement:'OMITTED_SQL_NULL',value:null};
      if(c.domain==='OMITTED_LITERAL_DEFAULT_REQUIRES_TYPED_VALUE_PROOF'){
        const pin=literalPins.get(write.relation+'|'+c.name);
        return {...base,requirement:'HISTORICAL_TYPED_LITERAL',value:pin.decoded.value,
          historicalSource:{migration:pin.migration,sourceSha256:pin.sourceSha256,declaration:pin.declaration}};
      }
      if(c.domain==='GENERATED_AVAILABLE_QUANTITY'){
        if(!['on_hand_quantity','reserved_quantity'].every(n=>write.columns.some(v=>v.name===n&&v.type==='integer')))
          throw new Error('ADMISSION_RECEIPT_V2_ROW_GENERATED_INPUTS_INVALID');
        return {...base,requirement:'SERVER_GENERATED_FROM_EXACT_ROW',
          expression:'(on_hand_quantity - reserved_quantity)',inputs:['on_hand_quantity','reserved_quantity']};
      }
      const requirements={
        OMITTED_UUID_REQUIRES_SERVER_ALLOCATION_AND_CLAIM:'ACTUAL_SERVER_UUID_AND_DURABLE_CLAIM_REQUIRED',
        OMITTED_ACTUAL_TRANSACTION_TIMESTAMP:'ACTUAL_TRANSACTION_TIMESTAMP',
        ACTUAL_NULL_ONLY_BEFORE_INSERT_SEQUENCE:'NULL_BEFORE_TRIGGER_ACTUAL_SEQUENCE_AFTER_INSERT',
      };
      const requirement=requirements[c.domain];
      if(!requirement)throw new Error('ADMISSION_RECEIPT_V2_ROW_DOMAIN_UNRESOLVED');
      return {...base,requirement,...(c.domain==='ACTUAL_NULL_ONLY_BEFORE_INSERT_SEQUENCE'
        ?{beforeInsertValue:null,afterInsertRequirement:'ACTUAL_TRIGGER_ASSIGNED_RETURNING_SEQUENCE'}:{})};
    });
    return {identity:write.signature+'|'+write.offset+'|'+write.relation,signature:write.signature,
      relation:write.relation,offset:write.offset,sourceMigration:write.sourceMigration,
      bodySha256:sha(lf(sources.get(write.signature).body)),columns};
  });
  return {version:1,scope:'COMPLETE_PRIMARY_INSERT_REQUIREMENTS_NOT_MATERIALIZED_ROWS',writes,
    completeInstalledColumnCoverage:true,sourceExpressionsEvaluated:false,defaultsEvaluated:false,
    actualEventValuesAllocated:false,fullWriteTuplesQualified:false,triggerEffectsQualified:false,
    durableIdentityClaimed:false,locksHeld:false,executionAuthority:false};
}

export function assertReceiptV2RowRequirements(sources,migrationSources,installed,expected) {
  if(!isDeepStrictEqual(expected,inspectReceiptV2RowRequirements(sources,migrationSources,installed)))
    throw new Error('ADMISSION_RECEIPT_V2_ROW_REQUIREMENTS_CHANGED');
  return true;
}

// Analysis bridge only. The source plan MUST be freshly asserted in PostgreSQL
// against the captured request/allocation before use; shape is not authority.
// Bind line/item columns, preserving unresolved event/default/claim obligations.
function bindReceiptV2ProjectedRow(contract,row,identity,deferred,fail,candidateId=null) {
  if(row===null||typeof row!=='object'||Array.isArray(row))fail();
  const omitted=new Set(deferred);
  if(omitted.size!==deferred.length||deferred.some(n=>!contract.columns.some(c=>c.name===n&&c.domain==='EXPLICIT_SOURCE_VALUE')))fail();
  const expectedKeys=contract.columns.filter(c=>c.domain==='EXPLICIT_SOURCE_VALUE'&&!omitted.has(c.name)).map(c=>c.name).sort();
  const values=structuredClone(row);
  if(candidateId!==null){
    const id=contract.columns.find(c=>c.name==='id');
    if(id?.requirement!=='ACTUAL_SERVER_UUID_AND_DURABLE_CLAIM_REQUIRED'||values.id!==candidateId)fail();
    delete values.id;
  }
  if(!isDeepStrictEqual(Object.keys(values).sort(),expectedKeys))fail();
  return {sourceOccurrence:contract.identity,relation:contract.relation,identity,
    ...(candidateId===null?{}:{candidateIdentity:{id:candidateId,durableClaimed:false,defaultOwnershipQualified:false}}),
    columns:contract.columns.map(c=>{
      if(Object.hasOwn(values,c.name)){
        const value=values[c.name];
        if(value===undefined||(value===null&&c.notNull)||(c.requirement==='EXPLICIT_SQL_NULL'&&value!==null)||typeof value==='number'
          &&(!Number.isFinite(value)||Number.isInteger(value)&&!Number.isSafeInteger(value)))fail();
        return {...c,requirement:'BOUND_SOURCE_PROJECTION_VALUE',value:structuredClone(value),
          projectionValidationRequired:true,typedValueFullyQualified:false};
      }
      return {...structuredClone(c),...(omitted.has(c.name)?{projectionValueDeferred:true}:{})};
    })};
}

export function bindReceiptV2ItemProjectionRequirements(sources,migrationSources,installed,kind,plan) {
  const fail=()=>{throw new Error('ADMISSION_RECEIPT_V2_ITEM_PROJECTION_INVALID');};
  const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
  const uuid=v=>typeof v==='string'&&v!=='00000000-0000-0000-0000-000000000000'
    &&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(v);
  if(!['DIRECT_V2','PO_V2'].includes(kind)||!object(plan)||plan.kind!==kind
    ||plan.version!=='phase5-receipt-v2-item-rows-v1')fail();
  const financial=plan.financialPlan,inventory=financial?.inventoryPlan,balance=inventory?.balancePlan,
    candidates=balance?.candidates,requirements=candidates?.requirements,prewrite=requirements?.prewrite;
  for(const [layer,version] of [[financial,'financial-rows'],[inventory,'inventory-rows'],[balance,'balance-rows']]){
    if(!object(layer)||layer.kind!==kind||layer.version!==`phase5-receipt-v2-${version}-v1`)fail();
  }
  for(const layer of [plan,financial,inventory,balance])for(const flag of ['fullWriteTuples','defaultsQualified',
    'stockEffectIdentitiesComplete','durableIdentityClaimed','numberClaimed','absencePredicatesFenced',
    'locksHeld','heldContextAuthority','executionAuthority'])if(layer[flag]!==false)fail();
  const allocation=prewrite?.allocation,operation=financial.operationWithoutResultAndTime,header=financial.headerWithoutEventValues;
  if(!object(allocation)||!object(operation)||!object(header)||!uuid(operation.id)||!uuid(header.id)
    ||header.operation_id!==operation.id||!Array.isArray(candidates?.identityBindings)
    ||!Array.isArray(allocation.lineBindings)||!Array.isArray(allocation.componentBindings)
    ||!Array.isArray(plan.commercialLines)||!Array.isArray(plan.items))fail();
  const slots=new Map();
  for(const slot of candidates.identityBindings){
    if(!object(slot)||typeof slot.slotKey!=='string'||!uuid(slot.id)||slots.has(slot.slotKey))fail();
    slots.set(slot.slotKey,slot.id);
  }
  if(new Set(slots.values()).size!==slots.size||slots.get('OPERATION')!==operation.id||slots.get('HEADER')!==header.id)fail();
  const lines=new Map(),components=new Map();
  for(const line of allocation.lineBindings){
    if(!object(line)||!uuid(line.clientLineId)||lines.has(line.clientLineId)||!slots.has('LINE|'+line.clientLineId))fail();
    lines.set(line.clientLineId,line);
  }
  for(const component of allocation.componentBindings){
    const identity=component?.clientLineId+'|'+component?.productId;
    if(!object(component)||!uuid(component.productId)||!lines.has(component.clientLineId)
      ||component.identity!==identity||components.has(identity)||!slots.has('ITEM|'+identity))fail();
    components.set(identity,component);
  }
  if(lines.size===0||components.size===0||plan.commercialLines.length!==lines.size||plan.items.length!==components.size)fail();
  const ledger=inspectReceiptV2RowRequirements(sources,migrationSources,installed);
  const signaturePrefix=kind==='DIRECT_V2'?'public.create_direct_supplier_receipt_v2(':'public.receive_purchase_order_v2(';
  const relationPrefix=kind==='DIRECT_V2'?'public.supplier_receipt':'public.purchase_receipt';
  const receiptField=kind==='DIRECT_V2'?'supplier_receipt_id':'purchase_receipt_id';
  const rowContract=relation=>{
    const matches=ledger.writes.filter(w=>w.signature.startsWith(signaturePrefix)&&w.relation===relation);
    if(matches.length!==1)fail();return matches[0];
  };
  const lineContract=rowContract(relationPrefix+'_commercial_lines'),itemContract=rowContract(relationPrefix+'_items');
  const bind=(contract,row,identity)=>bindReceiptV2ProjectedRow(contract,row,identity,
    contract.columns.filter(c=>c.domain==='EXPLICIT_SOURCE_VALUE'&&c.requirement==='ACTUAL_TRANSACTION_TIMESTAMP').map(c=>c.name),fail);
  const boundLines=[],boundItems=[],seenLines=new Set(),seenItems=new Set();
  for(const line of plan.commercialLines){
    const identity=line?.identity,row=line?.explicitRowWithoutFinalizedAt;
    if(!lines.has(identity)||seenLines.has(identity)||row?.client_line_id!==identity
      ||row?.id!==slots.get('LINE|'+identity)||row?.operation_id!==operation.id||row?.[receiptField]!==header.id)fail();
    seenLines.add(identity);boundLines.push(bind(lineContract,row,identity));
  }
  for(const item of plan.items){
    const identity=item?.identity,component=components.get(identity),row=item?.explicitRow;
    if(!component||seenItems.has(identity)||item.clientLineId!==component.clientLineId
      ||row?.product_id!==component.productId||row?.id!==slots.get('ITEM|'+identity)
      ||row?.commercial_line_id!==slots.get('LINE|'+component.clientLineId)
      ||row?.operation_id!==operation.id||row?.[receiptField]!==header.id)fail();
    seenItems.add(identity);boundItems.push(bind(itemContract,row,identity));
  }
  return {version:1,scope:'LINE_ITEM_PROJECTION_REQUIREMENTS_NOT_WRITABLE_ROWS',kind,
    operationId:operation.id,receiptId:header.id,commercialLines:boundLines,items:boundItems,
    sourcePlanValidationRequired:'FRESH_DB_ASSERT_WITH_CAPTURED_REQUEST_AND_ALLOCATION',
    sourcePlanValidatedByThisAnalysis:false,actualEventValuesAllocated:false,fullWriteTuplesQualified:false,
    triggerEffectsQualified:false,durableIdentityClaimed:false,locksHeld:false,executionAuthority:false};
}

export function assertReceiptV2ItemProjectionRequirements(sources,migrationSources,installed,kind,sourcePlan,expected) {
  if(!isDeepStrictEqual(expected,bindReceiptV2ItemProjectionRequirements(sources,migrationSources,installed,kind,sourcePlan)))
    throw new Error('ADMISSION_RECEIPT_V2_ITEM_BOUND_REQUIREMENTS_CHANGED');
  return true;
}

// Remaining primary financial/inventory INSERT projections. UUID defaults and
// partial result/audit composites are NOT materialized by this analysis bridge.
// Fresh PostgreSQL source-plan assertion is still a mandatory external boundary.
export function bindReceiptV2PrimaryProjectionRequirements(sources,migrationSources,installed,kind,plan) {
  const items=bindReceiptV2ItemProjectionRequirements(sources,migrationSources,installed,kind,plan);
  const fail=()=>{throw new Error('ADMISSION_RECEIPT_V2_PRIMARY_PROJECTION_INVALID');};
  const financial=plan.financialPlan,inventory=financial.inventoryPlan,candidates=inventory.balancePlan.candidates;
  const prewrite=candidates.requirements.prewrite,allocation=prewrite.allocation;
  const slots=new Map(candidates.identityBindings.map(s=>[s.slotKey,s.id]));
  const operation=financial.operationWithoutResultAndTime,header=financial.headerWithoutEventValues;
  const actor=prewrite.actorContract?.profile?.id;
  const op=operation.id,receipt=header.id,source=kind==='DIRECT_V2'?'supplier_receipt':'purchase_receipt';
  const fk=source+'_id';
  if(!actor||operation.initiated_by!==actor||header.received_by!==actor
    ||operation.idempotency_key!==prewrite.normalizedKey||operation.request_fingerprint!==prewrite.fingerprint
    ||operation.operation_type!==(kind==='DIRECT_V2'?'supplier_receipt_v2':'purchase_order_receipt_v2')
    ||header.supplier_id!==prewrite.effectiveSupplierId||header.warehouse_id!==prewrite.effectiveWarehouseId)fail();
  const ledger=inspectReceiptV2RowRequirements(sources,migrationSources,installed);
  const prefix=kind==='DIRECT_V2'?'public.create_direct_supplier_receipt_v2(':'public.receive_purchase_order_v2(';
  const contract=(relation,inventorySource=false)=>{
    const matches=ledger.writes.filter(w=>w.relation===relation&&w.signature.startsWith(inventorySource
      ?'public.phase2_apply_inventory_and_wac_internal(':prefix));
    if(matches.length!==1)fail();return matches[0];
  };
  const bind=(relation,row,identity,deferred=[],slot=null,inventorySource=false)=>{
    if(slot!==null&&!slots.has(slot))fail();
    return bindReceiptV2ProjectedRow(contract(relation,inventorySource),row,identity,deferred,fail,slot===null?null:slots.get(slot));
  };
  const boundOperation=bind('public.business_operations',operation,'OPERATION',['result_snapshot','completed_at']);
  const boundHeader=bind('public.'+source+'s',header,'HEADER',['receipt_number','received_at','phase2_finalized_at']);
  const optional=(row,slot,relation,deferred)=>{
    if(row===null){if(slots.has(slot))fail();return null;}
    if(!row||!slots.has(slot)||row.id!==slots.get(slot)||row.operation_id!==op
      ||row[fk]!==receipt||row.supplier_id!==header.supplier_id)fail();
    return bind(relation,row,slot,deferred,slot);
  };
  const invoice=optional(financial.invoiceWithoutDefaults,'INVOICE','public.supplier_financial_invoice_identities',[]);
  const payment=optional(financial.paymentWithoutNotesTimeAndTrigger,'PAYMENT','public.supplier_payments',['payment_date','notes']);
  if(payment&&financial.paymentWithoutNotesTimeAndTrigger.created_by!==actor)fail();
  const audit=financial.auditWithoutEventValues;
  const result=financial.resultWithoutReceiptNumber;
  if(!audit||audit.id!==slots.get('AUDIT')||audit.user_id!==actor||audit.entity_id!==receipt
    ||audit.entity_name!==source+'s'||audit.action!==(kind==='DIRECT_V2'?'CREATE_DIRECT_SUPPLIER_RECEIPT_V2':'RECEIVE_PURCHASE_ORDER_V2')
    ||audit.detailsWithoutReceiptNumberAndWac?.operation_id!==op||result?.operation_id!==op
    ||result.receipt_id!==receipt||result.success!==true||result.idempotent!==false)fail();
  const auditRow={...audit};delete auditRow.detailsWithoutReceiptNumberAndWac;
  const boundAudit=bind('public.audit_logs',auditRow,'AUDIT',['details'],'AUDIT');
  if(!Array.isArray(inventory.movements)||!Array.isArray(inventory.wacRows))fail();
  const components=new Map(allocation.componentBindings.map(c=>[c.identity,c]));
  const seen=new Set(),movements=[],products=new Map();
  const sortedComponents=[...components.values()].sort((a,b)=>a.productId.localeCompare(b.productId)||a.clientLineId.localeCompare(b.clientLineId));
  if(inventory.movements.length!==components.size)fail();
  for(const [index,movement] of inventory.movements.entries()){
    const identity=movement?.componentIdentity,c=components.get(identity),row=movement?.explicitRow;
    if(!c||seen.has(identity)||identity!==sortedComponents[index]?.identity||movement.slotKey!=='MOVEMENT|'+identity
      ||row?.id!==slots.get(movement.slotKey)||row?.operation_id!==op||row?.reference_id!==receipt
      ||row?.reference_type!==source||row?.created_by!==actor||row?.product_id!==c.productId
      ||row?.warehouse_id!==header.warehouse_id||row?.quantity!==c.baseQuantity||row?.movement_type!=='purchase_receipt'
      ||row?.[fk.replace('_id','_item_id')]!==slots.get('ITEM|'+identity)
      ||row?.[kind==='DIRECT_V2'?'purchase_receipt_item_id':'supplier_receipt_item_id']!==null
      ||movement.sequenceRequirement!=='ACTUAL_INSERT_TRIGGER_RETURNING_SEQUENCE'
      ||movement.eventTimeRequirement!=='ACTUAL_TRANSACTION_TIMESTAMP_AT_EXECUTION'||movement.actualReceiptNumberRequired!==true)fail();
    seen.add(identity);products.set(c.productId,movement.slotKey);
    movements.push(bind('public.inventory_movements',row,identity,['notes'],null,true));
  }
  const seenProducts=new Set(),wac=[];
  if(inventory.wacRows.length!==products.size)fail();
  for(const snapshot of inventory.wacRows){
    const row=snapshot?.explicitRow,product=row?.product_id;
    if(!products.has(product)||seenProducts.has(product)||snapshot.slotKey!=='WAC|'+product
      ||row.id!==slots.get(snapshot.slotKey)||row.operation_id!==op||row[fk]!==receipt
      ||row[kind==='DIRECT_V2'?'purchase_receipt_id':'supplier_receipt_id']!==null
      ||snapshot.lastMovementSlot!==products.get(product)
      ||snapshot.sequenceRequirement!=='ACTUAL_LAST_ORDERED_MOVEMENT_RETURNING_SEQUENCE'
      ||snapshot.eventTimeRequirement!=='ACTUAL_TRANSACTION_TIMESTAMP_AT_EXECUTION')fail();
    seenProducts.add(product);wac.push(bind('public.phase2_receipt_wac_snapshots',row,product,['receipt_movement_sequence_max'],snapshot.slotKey,true));
  }
  return {...items,scope:'PRIMARY_FINANCIAL_INVENTORY_PROJECTIONS_NOT_WRITABLE_ROWS',
    operation:boundOperation,header:boundHeader,invoice,payment,audit:boundAudit,movements,wac,
    deferredCompositeProjections:{resultWithoutReceiptNumber:structuredClone(result),
      auditDetailsWithoutReceiptNumberAndWac:structuredClone(audit.detailsWithoutReceiptNumberAndWac),
      finalCompositeValuesQualified:false},balanceAndUpdatePatchBindingsComplete:false,
    defaultOwnershipQualified:false,actualNumberAndSequenceQualified:false};
}

export function assertReceiptV2PrimaryProjectionRequirements(sources,migrationSources,installed,kind,sourcePlan,expected) {
  if(!isDeepStrictEqual(expected,bindReceiptV2PrimaryProjectionRequirements(sources,migrationSources,installed,kind,sourcePlan)))
    throw new Error('ADMISSION_RECEIPT_V2_PRIMARY_BOUND_REQUIREMENTS_CHANGED');
  return true;
}

export function inspectReceiptV2UpdateRequirements(sources,migrationSources) {
  inspectReceiptV2SourceContract(sources,migrationSources);
  const wanted=[['public.phase2_apply_inventory_and_wac_internal(',['public.products','public.inventory_balances']],
    ['public.create_direct_supplier_receipt_v2(',['public.suppliers']],
    ['public.receive_purchase_order_v2(',['public.purchase_order_items','public.suppliers','public.purchase_orders']]];
  const writes=[];
  for(const [prefix,relations] of wanted){
    const found=[...sources].filter(([s])=>s.startsWith(prefix));
    if(found.length!==1)throw new Error('ADMISSION_RECEIPT_V2_UPDATE_SOURCE_INVALID');
    const [signature,source]=found[0],updates=inspectExplicitUpdateValues(source.body);
    if(!isDeepStrictEqual(updates.map(w=>w.relation),relations))throw new Error('ADMISSION_RECEIPT_V2_UPDATE_SET_INVALID');
    for(const write of updates)writes.push({...write,signature,bodySha256:sha(lf(source.body)),
      identity:signature+'|'+write.offset+'|'+write.relation});
  }
  return {scope:'PINNED_PRIMARY_UPDATE_REQUIREMENTS_NOT_EXECUTION',writes,valuesEvaluated:false,executionAuthority:false};
}

// Complete primary UPDATE projections, not trigger effects or a held permission.
// As with INSERT bindings, freshly asserting the entire source plan in PostgreSQL
// against its captured request/allocation is required before analysis consumption.
export function bindReceiptV2UpdateProjectionRequirements(sources,migrationSources,installed,kind,plan) {
  const primary=bindReceiptV2PrimaryProjectionRequirements(sources,migrationSources,installed,kind,plan);
  const fail=()=>{throw new Error('ADMISSION_RECEIPT_V2_UPDATE_PROJECTION_INVALID');};
  const f=plan.financialPlan,i=f.inventoryPlan,b=i.balancePlan,p=b.candidates.requirements.prewrite;
  const ledger=inspectReceiptV2UpdateRequirements(sources,migrationSources);
  const inventoryPrefix='public.phase2_apply_inventory_and_wac_internal(';
  const publicPrefix=kind==='DIRECT_V2'?'public.create_direct_supplier_receipt_v2(':'public.receive_purchase_order_v2(';
  const contract=(relation,prefix=publicPrefix)=>{
    const matches=ledger.writes.filter(w=>w.relation===relation&&w.signature.startsWith(prefix));
    if(matches.length!==1)fail();return matches[0];
  };
  const bind=(relation,identity,before,patch,deferred=['updated_at'],prefix=publicPrefix)=>{
    const c=contract(relation,prefix);
    if(before===null||typeof before!=='object'||Array.isArray(before)||typeof identity!=='string'
      ||patch===null||typeof patch!=='object'||Array.isArray(patch))fail();
    if(!isDeepStrictEqual(Object.keys(patch).sort(),c.bindings.filter(v=>!deferred.includes(v.column)).map(v=>v.column).sort()))fail();
    for(const value of Object.values(patch))if(value===undefined||typeof value==='number'
      &&(!Number.isFinite(value)||Number.isInteger(value)&&!Number.isSafeInteger(value)))fail();
    return {relation,identity,sourceOccurrence:c.identity,predicate:structuredClone(c.predicate),before:structuredClone(before),
      assignments:c.bindings.map(v=>({...v,...(Object.hasOwn(patch,v.column)?{requirement:'BOUND_SOURCE_UPDATE_PROJECTION',value:structuredClone(patch[v.column])}
        :{requirement:v.column==='received_at'?'ACTUAL_TIME_IF_COMPLETED_ELSE_CAPTURED_PRIOR':'ACTUAL_TRANSACTION_TIMESTAMP'})})),
      sourcePlanValidationRequired:true,typedValueFullyQualified:false,executionAuthority:false};
  };
  const products=new Set(p.allocation.componentBindings.map(c=>c.productId));
  if(!Array.isArray(b.rows)||!Array.isArray(i.productPatches)||b.rows.length!==products.size||i.productPatches.length!==products.size)fail();
  const seenBalances=new Set(),seenProducts=new Set(),balances=[],productPatches=[];
  for(const row of b.rows){
    const after=row?.afterWithoutEventTime,id=row?.productId;
    if(!products.has(id)||seenBalances.has(id)||row.warehouseId!==p.effectiveWarehouseId
      ||after?.product_id!==id||after?.warehouse_id!==row.warehouseId
      ||row.eventTimeRequirement!=='ACTUAL_TRANSACTION_TIMESTAMP_AT_EXECUTION'||row.triggerEffectsQualified!==false
      ||!['on_hand_quantity','reserved_quantity','available_quantity'].every(n=>Number.isSafeInteger(after[n]))
      ||after.available_quantity!==after.on_hand_quantity-after.reserved_quantity)fail();
    const before=row.before,insert=row.insertWithoutEventTime;
    if(before===null){
      if(!insert||insert.id!==after.id||insert.product_id!==id||insert.warehouse_id!==row.warehouseId
        ||insert.on_hand_quantity!==0||insert.reserved_quantity!==0||insert.available_quantity!==0
        ||b.candidates.identityBindings.find(s=>s.slotKey==='BALANCE|'+id)?.id!==insert.id)fail();
    }else if(insert!==null||before?.id!==after.id||before.product_id!==id||before.warehouse_id!==row.warehouseId
      ||before.reserved_quantity!==after.reserved_quantity)fail();
    const start=before===null?insert:before;
    if(after.on_hand_quantity!==start.on_hand_quantity+row.receivedQuantity)fail();
    seenBalances.add(id);balances.push({...bind('public.inventory_balances',id+'|'+row.warehouseId,start,
      {on_hand_quantity:after.on_hand_quantity},['updated_at'],inventoryPrefix),
      beforeInsert:structuredClone(before),insertProjection:structuredClone(insert),afterProjection:structuredClone(after),
      insertDefaultAttemptOwnershipQualified:false,generatedValueOwnershipQualified:false});
  }
  for(const row of i.productPatches){
    if(!products.has(row.productId)||seenProducts.has(row.productId)||row.before?.id!==row.productId
      ||row.eventTimeRequirement!=='ACTUAL_TRANSACTION_TIMESTAMP_AT_EXECUTION')fail();
    seenProducts.add(row.productId);productPatches.push(bind('public.products',row.productId,row.before,row.patchWithoutEventTime,['updated_at'],inventoryPrefix));
  }
  const supplier=f.supplierPatchWithoutEventTime;
  if(supplier?.id!==p.effectiveSupplierId||supplier.before?.id!==supplier.id)fail();
  const supplierPatch=bind('public.suppliers',supplier.id,supplier.before,supplier.patchWithoutEventTime);
  const poItems=[],seenPo=new Set(),poIds=new Set(p.allocation.lineBindings.map(l=>l.purchaseOrderItemId).filter(Boolean));
  if(!Array.isArray(plan.purchaseOrderItemPatches)||plan.purchaseOrderItemPatches.length!==(kind==='PO_V2'?poIds.size:0))fail();
  for(const row of plan.purchaseOrderItemPatches){
    if(!poIds.has(row?.id)||seenPo.has(row.id)||row.before?.id!==row.id||row.before.purchase_order_id!==f.headerWithoutEventValues.purchase_order_id
      ||row.eventTimeRequirement!=='ACTUAL_TRANSACTION_TIMESTAMP_AT_EXECUTION')fail();
    seenPo.add(row.id);poItems.push(bind('public.purchase_order_items',row.id,row.before,row.patchWithoutEventTime));
  }
  let poHeader=null;
  if(kind==='PO_V2'){
    const id=f.headerWithoutEventValues.purchase_order_id;
    const candidates=p.resources?.filter(r=>r.relation==='public.purchase_orders'&&r.row?.id===id);
    if(candidates?.length!==1||typeof p.prospectivePoCompleted!=='boolean')fail();
    poHeader={...bind('public.purchase_orders',id,candidates[0].row,
      {status:p.prospectivePoCompleted?'received':'partially_received'},['updated_at','received_at']),
      priorReceivedAt:structuredClone(candidates[0].row.received_at),prospectiveCompleted:p.prospectivePoCompleted};
  }
  return {version:1,kind,scope:'PRIMARY_UPDATE_PROJECTIONS_NOT_WRITABLE_ROWS',operationId:primary.operationId,
    balances,productPatches,supplierPatch,poItems,poHeader,
    sourcePlanValidationRequired:'FRESH_DB_ASSERT_WITH_CAPTURED_REQUEST_AND_ALLOCATION',
    sourcePlanValidatedByThisAnalysis:false,actualEventValuesAllocated:false,triggerEffectsQualified:false,
    defaultOwnershipQualified:false,durableIdentityClaimed:false,locksHeld:false,executionAuthority:false};
}

export function assertReceiptV2UpdateProjectionRequirements(sources,migrationSources,installed,kind,sourcePlan,expected) {
  if(!isDeepStrictEqual(expected,bindReceiptV2UpdateProjectionRequirements(sources,migrationSources,installed,kind,sourcePlan)))
    throw new Error('ADMISSION_RECEIPT_V2_UPDATE_BOUND_REQUIREMENTS_CHANGED');
  return true;
}

// One structural bridge over the freshly rederived whole Receipt V2 plan.
// Global WAC/other-warehouse source resources remain retained even though stock
// effects target only the receipt warehouse. No captured result/effect row is
// used to derive expected product, balance, receipt or payment identity.
export function bindReceiptV2SourceEffectUnion(sources,migrationSources,primaryInstalled,transitiveInstalled,kind,plan) {
  const primary=bindReceiptV2PrimaryProjectionRequirements(sources,migrationSources,primaryInstalled,kind,plan);
  const updates=bindReceiptV2UpdateProjectionRequirements(sources,migrationSources,primaryInstalled,kind,plan);
  const f=plan.financialPlan,i=f.inventoryPlan,p=i.balancePlan.candidates.requirements.prewrite;
  const fail=()=>{throw new Error('ADMISSION_RECEIPT_V2_SOURCE_EFFECT_UNION_INVALID');};
  if(p.kind!==kind||!Array.isArray(p.resources)||!Array.isArray(p.paymentShiftRows))fail();
  const identities=new Set();
  for(const n of p.resources){
    const key=n?.relation+'|'+n?.id;
    if(typeof n?.relation!=='string'||typeof n?.id!=='string'||!n.row||identities.has(key))fail();
    const expected=n.relation==='public.stock_alert_reads'?n.row.stock_alert_id+'|'+n.row.user_id
      :n.relation==='public.user_roles'?n.row.user_id+'|'+n.row.role_id:n.row.id;
    if(n.id!==expected)fail();identities.add(key);
  }
  const rows=(relation)=>p.resources.filter(n=>n.relation===relation).map(n=>n.row);
  const warehouses=rows('public.warehouses').filter(w=>w.id===p.effectiveWarehouseId);
  if(warehouses.length!==1)fail();
  const targets=updates.balances.map(b=>{
    const product=i.productPatches.find(n=>n.productId===b.afterProjection.product_id);
    const source=rows('public.products').filter(n=>n.id===product?.productId);
    if(!product||source.length!==1||!isDeepStrictEqual(source[0],product.before)
      ||b.afterProjection.warehouse_id!==p.effectiveWarehouseId)fail();
    return {productId:product.productId,warehouseId:p.effectiveWarehouseId,productName:product.before.name_ar,
      warehouseName:warehouses[0].name_ar,active:product.before.is_active,threshold:product.before.min_stock_level,
      beforeAvailable:b.beforeInsert===null?null:b.beforeInsert.available_quantity,
      afterAvailable:b.afterProjection.available_quantity};
  });
  const alerts=rows('public.stock_alerts').filter(a=>targets.some(t=>t.productId===a.product_id&&t.warehouseId===a.warehouse_id));
  const reads=rows('public.stock_alert_reads').filter(r=>alerts.some(a=>a.id===r.stock_alert_id));
  const events=rows('public.automation_events').filter(e=>alerts.some(a=>e.entity_id===a.id||e.event_key.startsWith('stock_alert:'+a.id+':')));
  const stock=deriveReceiptV2StockStages(sources,migrationSources,transitiveInstalled,{targets,alerts,reads,events});
  let payment=null;
  if(primary.payment===null){if(p.paymentShiftRows.length!==0)fail();}
  else {
    const row=f.paymentWithoutNotesTimeAndTrigger,shift=p.paymentShiftRows[0];
    if(primary.payment.columns.filter(c=>c.name==='cash_shift_id'&&c.type==='uuid'&&c.notNull===false).length!==1)fail();
    const branch=kind==='DIRECT_V2'?f.headerWithoutEventValues.branch_id:
      rows('public.purchase_orders').find(po=>po.id===f.headerWithoutEventValues.purchase_order_id)?.branch_id;
    if(!['cash','cliq'].includes(row.payment_method)||!Number.isSafeInteger(row.amount_in_minor_units)||row.amount_in_minor_units<=0
      ||p.paymentShiftRows.length!==1||shift?.status!=='open'||!branch||branch!==p.effectiveBranchId||shift.branch_id!==branch
      ||rows('public.cash_shifts').filter(s=>s.id===shift.id&&isDeepStrictEqual(s,shift)).length!==1)fail();
    payment={...structuredClone(primary.payment),triggerShift:{requirement:'BOUND_SOURCE_OPEN_SHIFT',value:shift.id,
      branchId:branch,source:structuredClone(shift),sourceKind:kind},
      columns:primary.payment.columns.map(c=>c.name==='cash_shift_id'
        ?{...c,requirement:'BOUND_TRIGGER_SOURCE_SHIFT_VALUE',value:shift.id}:structuredClone(c)),
      actualTriggerAuthorityQualified:false};
  }
  return {version:1,scope:'RECEIPT_V2_SOURCE_STOCK_PAYMENT_REQUIREMENT_UNION',kind,
    operationId:primary.operationId,receiptId:primary.receiptId,primary,updates,stock,payment,
    retainedCompleteSourceResources:structuredClone(p.resources),
    sourcePlanValidationRequired:'FRESH_DB_ITEM_ROWS_ASSERT_WITH_CAPTURED_REQUEST_AND_ALLOCATION',
    sourcePlanValidatedByThisAnalysis:false,actualEventValuesAllocated:false,eventKeyResolutionComplete:false,
    futureIdentitySetResolved:false,durableIdentityClaimed:false,fullTypedWriteTuplesQualified:false,
    writerInvokerAbsenceConvergence:false,locksHeld:false,executionAuthority:false};
}

export function assertReceiptV2SourceEffectUnion(sources,migrationSources,primaryInstalled,transitiveInstalled,kind,plan,expected) {
  if(!isDeepStrictEqual(expected,bindReceiptV2SourceEffectUnion(sources,migrationSources,primaryInstalled,transitiveInstalled,kind,plan)))
    throw new Error('ADMISSION_RECEIPT_V2_SOURCE_EFFECT_UNION_CHANGED');
  return true;
}

// Extend the COMPLETE source union, never a stock-only substitute. Global
// UNIQUE-key ownership may belong to an unrelated entity under historical099.
// Observed absence is an acquisition requirement, not a held exclusion fence.
export function bindReceiptV2StockResourceUnion(sources,migrationSources,primaryInstalled,transitiveInstalled,kind,plan,clock,allocation,globalEvents) {
  const source=bindReceiptV2SourceEffectUnion(sources,migrationSources,primaryInstalled,transitiveInstalled,kind,plan);
  const stock=resolveReceiptV2StockCandidateRequirements(sources,migrationSources,transitiveInstalled,
    source.stock.retainedSnapshot,clock,allocation,globalEvents);
  const transitive=inspectReceiptV2TransitiveRowRequirements(sources,migrationSources,transitiveInstalled);
  const fail=()=>{throw new Error('ADMISSION_RECEIPT_V2_STOCK_RESOURCE_UNION_INVALID');};
  const resources=structuredClone(source.retainedCompleteSourceResources);
  const keys=new Set(),future=new Map(),keyRequirements=[];
  const retain=row=>{
    const prior=resources.find(r=>r.relation==='public.automation_events'&&r.id===row.id);
    if(prior){if(!isDeepStrictEqual(prior.row,row))fail();}
    else resources.push({relation:'public.automation_events',id:row.id,row:structuredClone(row)});
  };
  // Check *all* retained event resources, including other-warehouse/global-WAC
  // rows not present in the target stock snapshot. Capture disagreement fails.
  for(const r of resources.filter(r=>r.relation==='public.automation_events'))
    if(!globalEvents.some(e=>isDeepStrictEqual(e,r.row)))fail();
  for(const stage of stock.stages){
    const ids=stock.allocation.find(a=>a.productId===stage.productId&&a.warehouseId===stage.warehouseId&&a.stage===stage.stage);
    for(const [relation,id] of [['public.stock_alerts',ids.alertId],['public.automation_events',ids.eventId]]){
      if(id!==null){
        if(future.has(id)||resources.some(r=>r.id===id))fail();
        future.set(id,{relation,id,productId:stage.productId,warehouseId:stage.warehouseId,stage:stage.stage,
          requirement:'FRESH_GLOBAL_UUID_COLLISION_REVALIDATION_AND_DURABLE_CLAIM',owned:false});
      }
    }
    if(stage.eventKey!==null){
      if(keys.has(stage.eventKey))fail();keys.add(stage.eventKey);
      const reused=stage.eventDisposition==='REUSE_PREEXISTING';
      if(reused)retain(stage.storedEvent);
      keyRequirements.push({relation:'public.automation_events',column:'event_key',key:stage.eventKey,
        disposition:stage.eventDisposition,observedRow:reused?structuredClone(stage.storedEvent):null,
        candidateId:reused?null:stage.storedEvent.id,
        requirement:reused?'RETAIN_EXACT_GLOBAL_FIRST_OWNER_AND_REVALIDATE':'FRESH_EXACT_KEY_ABSENCE_REVALIDATION_AND_EXCLUSION_FENCE',
        afterWaitRevalidated:false,absenceFenced:false});
    }
  }
  return {version:1,scope:'RECEIPT_V2_COMPLETE_SOURCE_AND_CONDITIONAL_STOCK_RESOURCE_REQUIREMENTS',kind,
    source,stock,transitive,resources,keyRequirements,futureIdentityRequirements:[...future.values()],
    sourcePlanValidationRequired:'FRESH_DB_ITEM_AND_STOCK_CANDIDATE_ASSERT_WITH_CAPTURED_REQUEST_AND_ALLOCATION',
    sourcePlanValidatedByThisAnalysis:false,clockAuthorityQualified:false,foreignKeysInstalledValidated:false,
    typedFullRowsQualified:false,writerInvokerAbsenceConvergence:false,durableIdentityClaimed:false,
    absencePredicatesFenced:false,afterWaitRevalidated:false,locksHeld:false,executionAuthority:false};
}

export function assertReceiptV2StockResourceUnion(sources,migrationSources,primaryInstalled,transitiveInstalled,kind,plan,clock,allocation,globalEvents,expected) {
  if(!isDeepStrictEqual(expected,bindReceiptV2StockResourceUnion(sources,migrationSources,primaryInstalled,transitiveInstalled,kind,plan,clock,allocation,globalEvents)))
    throw new Error('ADMISSION_RECEIPT_V2_STOCK_RESOURCE_UNION_CHANGED');
  return true;
}

// Type/representation proof ONLY. No default expression evaluation, permissive
// SQL casts, financial policy, FK ownership or authority from a caller catalog.
export function qualifySourceScalarValue(column,value,nullKind='SQL_NULL') {
  const fail=()=>{throw new Error('ADMISSION_SOURCE_TYPED_VALUE_INVALID');};
  if(!column||typeof column.type!=='string'||typeof column.notNull!=='boolean')fail();
  const type=column.type;
  if(!['smallint','integer','bigint','uuid','boolean','text','date','timestamp with time zone','jsonb'].includes(type)
    &&! /^numeric\(\d+,\d+\)$/u.test(type)&&! /^character varying\(\d+\)$/u.test(type))
    throw new Error('ADMISSION_SOURCE_TYPE_UNRESOLVED:'+type);
  if(/^numeric/u.test(type)){
    const [,p,s]=/^numeric\((\d+),(\d+)\)$/u.exec(type);
    if(Number(p)<1||Number(p)>1000||Number(s)>Number(p))fail();
  }
  if(/^character varying/u.test(type)&&Number(type.match(/\d+/u)[0])<1)fail();
  if(value===null&&nullKind==='SQL_NULL'){
    if(column.notNull)fail();return {type,encoding:'SQL_NULL',value:null};
  }
  if(!['SQL_NULL','JSON_VALUE'].includes(nullKind)||value===undefined)fail();
  const text=v=>{
    if(typeof v!=='string'||v.includes('\0')||[...v].some(c=>c.length===1&&c.charCodeAt(0)>=0xD800&&c.charCodeAt(0)<=0xDFFF))fail();return v;
  };
  const date=s=>{
    const m=/^(\d{4})-(\d{2})-(\d{2})$/u.exec(s);if(!m)fail();
    const [year,month,day]=m.slice(1).map(Number),leap=year%4===0&&(year%100!==0||year%400===0);
    if(year<1000||month<1||month>12||day<1||day>[31,leap?29:28,31,30,31,30,31,31,30,31,30,31][month-1])fail();
  };
  let encoding;
  if(['smallint','integer','bigint'].includes(type)){
    if(typeof value==='number'&&!Number.isSafeInteger(value)||!['number','string'].includes(typeof value)||! /^-?(?:0|[1-9]\d*)$/u.test(String(value)))fail();
    const n=BigInt(value),bits=type==='smallint'?16n:type==='integer'?32n:64n;
    if(n<-(1n<<(bits-1n))||n>=(1n<<(bits-1n)))fail();encoding='EXACT_INTEGER';
  }else if(/^numeric\(\d+,\d+\)$/u.test(type)){
    const [,p,s]=/^numeric\((\d+),(\d+)\)$/u.exec(type),precision=Number(p),scale=Number(s);
    if(precision<1||precision>1000||scale<0||scale>precision||!['number','string'].includes(typeof value)
      ||typeof value==='number'&&!Number.isFinite(value))fail();
    const m=/^-?(0|[1-9]\d*)(?:\.(\d+))?$/u.exec(String(value));if(!m)fail();
    const fraction=m[2]??'',integerDigits=m[1]==='0'?0:m[1].length;
    if(integerDigits>precision-scale||fraction.length>scale)fail();
    if(typeof value==='number'&&(!Number.isInteger(value)&&BigInt(m[1]+fraction)>BigInt(Number.MAX_SAFE_INTEGER)
      ||Number.isInteger(value)&&!Number.isSafeInteger(value)))fail();encoding='EXACT_DECIMAL_NO_ROUNDING';
  }else if(type==='uuid'){
    if(typeof value!=='string'||! /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(value))fail();encoding='UUID_NOT_OWNERSHIP';
  }else if(type==='boolean'){if(typeof value!=='boolean')fail();encoding='BOOLEAN';
  }else if(type==='text'||/^character varying\(\d+\)$/u.test(type)){
    text(value);if(type!=='text'&&[...value].length>Number(type.match(/\d+/u)[0]))fail();encoding='UTF8_TEXT_NO_TRUNCATION';
  }else if(type==='date'){date(text(value));encoding='GREGORIAN_DATE';
  }else if(type==='timestamp with time zone'){
    const m=/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|\+00:00)$/u.exec(text(value));
    if(!m)fail();date(m[1]);if(Number(m[2])>23||Number(m[3])>59||Number(m[4])>59)fail();encoding='UTC_MICROSECOND_TEXT_NOT_CLOCK_AUTHORITY';
  }else if(type==='jsonb'){
    const seen=new Set();const check=v=>{
      if(v===null||typeof v==='boolean')return;
      if(typeof v==='string'){text(v);return;}
      if(typeof v==='number'){if(!Number.isFinite(v)||Number.isInteger(v)&&!Number.isSafeInteger(v))fail();return;}
      if(typeof v!=='object'||seen.has(v)||!Array.isArray(v)&&Object.getPrototypeOf(v)!==Object.prototype)fail();seen.add(v);
      if(!Array.isArray(v)&&Reflect.ownKeys(v).length!==Object.keys(v).length)fail();
      if(Array.isArray(v)){if(Object.keys(v).length!==v.length)fail();for(const n of v)check(n);}
      else for(const [k,n] of Object.entries(v)){text(k);check(n);}seen.delete(v);
    };check(value);encoding='JSON_VALUE';
  }else throw new Error('ADMISSION_SOURCE_TYPE_UNRESOLVED:'+type);
  return {type,encoding,value:structuredClone(value)};
}

// Whole installed-column requirement coverage with explicit unresolved values.
// Known values must come from a separately asserted DB source plan, never an
// arbitrary client row. SQL NULL and JSON null are distinct explicit inputs.
export function qualifyPreparedSourceRow(installed,relation,values,jsonNullColumns=[]) {
  const fail=()=>{throw new Error('ADMISSION_SOURCE_TYPED_ROW_INVALID');};
  const matches=installed.filter(t=>'public.'+t.relation===relation);
  if(matches.length!==1||!values||Array.isArray(values)||typeof values!=='object')fail();
  const table=matches[0],seen=new Set();
  if(!Array.isArray(table.columns)||new Set(table.columns.map(c=>c.name)).size!==table.columns.length
    ||!Array.isArray(jsonNullColumns)||new Set(jsonNullColumns).size!==jsonNullColumns.length)fail();
  for(const name of Object.keys(values))if(!table.columns.some(c=>c.name===name))fail();
  for(const name of jsonNullColumns)if(!Object.hasOwn(values,name)||values[name]!==null||!table.columns.some(c=>c.name===name&&c.type==='jsonb'))fail();
  const columns=table.columns.map(c=>{
    if(typeof c.name!=='string'||typeof c.type!=='string'||typeof c.notNull!=='boolean'||typeof c.identity!=='string'
      ||!['','s'].includes(c.generated)||!(c.default===null||typeof c.default==='string'))fail();
    // Generated subtraction is only qualified from exact complete input values.
    if(c.generated==='s'){
      if(relation!=='public.inventory_balances'||c.name!=='available_quantity'||c.type!=='integer'
        ||c.default!=='(on_hand_quantity - reserved_quantity)')fail();
      if(['on_hand_quantity','reserved_quantity'].every(n=>Object.hasOwn(values,n))){
        const left=qualifySourceScalarValue({type:'integer',notNull:true},values.on_hand_quantity);
        const right=qualifySourceScalarValue({type:'integer',notNull:true},values.reserved_quantity);
        const expected=(BigInt(left.value)-BigInt(right.value)).toString();
        if(Object.hasOwn(values,c.name)&&(values[c.name]===null||BigInt(qualifySourceScalarValue(c,values[c.name]).value)!==BigInt(expected)))fail();
        seen.add(c.name);return {...structuredClone(c),state:'EXACT_GENERATED_REQUIREMENT',typed:qualifySourceScalarValue(c,expected),ownershipQualified:false};
      }
      if(Object.hasOwn(values,c.name))fail();
    }
    if(Object.hasOwn(values,c.name)){
      seen.add(c.name);return {...structuredClone(c),state:'KNOWN_SOURCE_VALUE_TYPE_CHECKED',
        typed:qualifySourceScalarValue(c,values[c.name],jsonNullColumns.includes(c.name)?'JSON_VALUE':'SQL_NULL'),ownershipQualified:false};
    }
    return {...structuredClone(c),state:c.generated?'GENERATED_INPUT_REQUIREMENT':c.identity?'IDENTITY_PROVIDER_REQUIREMENT'
      :c.default===null?'EXPLICIT_SOURCE_OR_SQL_NULL_REQUIREMENT':'DEFAULT_SOURCE_AND_ACTUAL_VALUE_REQUIREMENT',ownershipQualified:false};
  });
  const unresolvedColumns=columns.filter(c=>!seen.has(c.name)).map(c=>c.name);
  return {relation,columns,unresolvedColumns,knownValueTypeChecksComplete:true,
    fullRowValuesPresent:unresolvedColumns.length===0,sourcePlanValidationRequired:true,
    postgresCastParityProven:false,defaultsEvaluated:false,foreignKeysQualified:false,
    fullTypedWriteTuplesQualified:false,durableIdentityClaimed:false,locksHeld:false,executionAuthority:false};
}

export function assertPreparedSourceRow(installed,relation,values,jsonNullColumns,expected) {
  if(!isDeepStrictEqual(expected,qualifyPreparedSourceRow(installed,relation,values,jsonNullColumns)))
    throw new Error('ADMISSION_SOURCE_TYPED_ROW_CHANGED');return true;
}

function constant(source,label) {
  const match=source.match(new RegExp(label+' JSONB := \\$([a-z_]+)\\$([\\s\\S]*?)\\$\\1\\$::JSONB;','u'));
  if(!match)throw new Error('ADMISSION_SOURCE_CONSTANT_MISSING:'+label);
  return JSON.parse(match[2]);
}

const families=[
  {id:'READ_MARK_SINGLE',entry:'mark_stock_alert_read',chain:['mark_stock_alert_read'],boundary:'INSERT INTO public.stock_alert_reads',
    identity:'existing alert id + server auth.uid()',resources:'selected product/warehouse/alert; all composite read rows and profile parents; actor role/MFA',
    constraint:'resolved alert remains valid; no current product gate',required:'derive full source set, enter existing inventory-product domain before read/FK write, freshly revalidate'},
  {id:'READ_MARK_BULK',entry:'mark_all_stock_alerts_read',chain:['mark_all_stock_alerts_read'],boundary:'INSERT INTO public.stock_alert_reads',
    identity:'all active alert ids + server auth.uid()',resources:'complete active membership, sorted products, warehouse/alert/read/profile parents',
    constraint:'empty active scope succeeds; membership may grow before writes',required:'sorted whole product union before write; changed membership retries without a late new gate'},
  {id:'PURCHASE_ORDER_RECEIVING',entry:'receive_purchase_order',chain:['receive_purchase_order','_receive_purchase_order_impl'],boundary:'INSERT INTO public.purchase_receipts',
    identity:'purchase order + purchase_order_item ids -> stored product ids',resources:'whole SKU set, PO header/items, warehouse/profile/FK parents and receipt identities',
    constraint:'wrapper SKU gate precedes delegate PO lock/header write; item validation continues after header write',required:'preplan complete PO-item/resource union and revalidate after waits; preserve exact WAC/zero-cost contract'},
  {id:'PRODUCT_CREATE_V4',entry:'create_product_with_opening_stock_v4',chain:['create_product_with_opening_stock_v4','create_product_with_opening_stock_v3','create_product_with_opening_stock_v2','create_product_with_opening_stock','_create_product_with_opening_stock_impl'],boundary:'INSERT INTO public.products',
    identity:'new product id currently generated at INSERT',resources:'preallocated product plus category/brand/unit/warehouse/profile and optional image/stock dependencies',
    constraint:'v4 rejects nonzero opening; existing-product inventory kernel cannot lock a not-yet-created id',required:'explicit server future identity before first INSERT; source-bound generated identity admission, no missing-product bypass'},
  {id:'PRODUCT_FLAVOR_CREATE',entry:'create_product_flavor_v1',chain:['create_product_flavor_v1','create_product_with_opening_stock_v4','create_product_with_opening_stock_v3','create_product_with_opening_stock_v2','create_product_with_opening_stock','_create_product_with_opening_stock_impl'],boundary:'INSERT INTO public.products',
    identity:'existing master + future child id + flavor identity',resources:'master/children/warehouse/profile/stock/image union',
    constraint:'master FOR UPDATE occurs before nested child creation',required:'complete existing/future product domain before master row lock; no late child gate'},
  {id:'PRODUCT_FAMILY_CREATE',entry:'create_product_family_with_flavors_v1',chain:['create_product_family_with_flavors_v1','create_product_with_opening_stock_v4','create_product_with_opening_stock_v3','create_product_with_opening_stock_v2','create_product_with_opening_stock','_create_product_with_opening_stock_impl'],boundary:'INSERT INTO public.products',
    identity:'future master plus all future child/flavor ids',resources:'whole batch identity/resource union before master INSERT',
    constraint:'master is inserted before the flavor loop; each child nests the same creation chain',required:'allocate/admit entire batch before first root write; record every branch, image/default/FK/stock dependency'},
];

// Independently reviewed support dependencies, outside the original fixed95.
// They have no own business DML. Nested delegates remain separately visible;
// lack of own DML never qualifies a wrapper as harmless or authorizes a caller.
const supportAnchors=[
  ['public.phase3_validate_configurable_parcel_internal(text,uuid,uuid,uuid,int,jsonb)',
    '114_configurable_parcel_sales_contracts_and_safety_primitives.sql','4053821B74A74A8E7D5922C6BB95C74D9E43EA787A03FFF0965A2846E7402C56',
    'configuration and family SHARE precede nested component SKU lock; preserve parent-composed union'],
  ['public.phase4_lock_order_inventory_internal(uuid)',
    '120_phase4_returns_refunds_foundation.sql','1C235FB01CE0BBFBB8103E8EA036C686B45FBF3D5295ABB8FB08302C4EA1E503',
    'derive original order item/component products; empty domain is legitimate; current physical leaf still needs source adapter'],
  ['public.phase4_lock_supplier_context_internal(uuid,uuid,uuid)',
    '120_phase4_returns_refunds_foundation.sql','62C48D4947893B08F6F7721E3BF96D2711F3A4F135FD40B471A77FE3B40507D8',
    'Shift advisory union/revalidation -> Shift rows -> SKU kernel -> supplier receipt/payment rows; merge before any future parent write'],
  ['public.phase4_lock_full_shift_context_internal(uuid)',
    '120_phase4_returns_refunds_foundation.sql','6106B891C6B6A892F142A439301544404CE5091CAB39625A85308B59411151B0',
    'Shift advisory/revalidation -> Shift and Order rows -> SKU kernel -> receipt/payment/expense rows; future batch must preclaim earlier child keys'],
  ['public.phase2_lock_receipt_payment_shifts_internal(uuid,uuid)',
    '120_phase4_returns_refunds_foundation.sql','907C7B2DDE386ACA365BDA5B5918D9D06ACBD79D24238D323B57CF3F3723CBCE',
    'role guard -> supplier context delegation; inherited guard must remain before any nested source write'],
  ['public.phase4_lock_customer_order_context_internal(uuid,bool,bool)',
    '120_phase4_returns_refunds_foundation.sql','F6417094A5218649F06FEED5C392AC6ADD87DB7414D55610E17FB52A80DEBD8A',
    'Order advisory -> current Shift row -> Order row -> optional inventory -> legacy GUC; GUC is not a Phase5 execution certificate'],
  ['public.reverse_supplier_payment(uuid,text,text)',
    '120_phase4_returns_refunds_foundation.sql','22C00F23DCE628FA4F46AC5E2BD633582BC27404401EFD490EAEDCF7263486CE',
    'owner authorization -> supplier context -> historical payment delegate; delegate source and batch lock coupling remain independently required'],
];

// Source qualification is separate from admission. These five callers were
// reviewed individually; the private primitives retain their closed inactive
// contracts. Their inclusion does not authorize a public invocation/cutover.
/** @type {Array<[string,string,string,string,string,boolean,string?]>} */
const financialAnchors=[
  ['public._record_customer_order_payment_before_phase42_financial_guard(uuid,bigint,text,text,text)',
    '120_phase4_returns_refunds_foundation.sql','7C803CD2409D6B6E40A59A037359BF66A8960B3F27F4676D54975D75B596C945','DEFINER','public, pg_temp',false],
  ['public.record_customer_order_payment(uuid,bigint,text,text,text)',
    '121_phase42_atomic_return_coordinator.sql','ED7125D48788E15925E3F9920F3B529814FD34AEDAE405515BC79F7865A2B300','DEFINER','public, pg_temp',true],
  ['phase5_private.commit_customer_collection_v1(uuid,uuid,uuid,bigint,text,text,text)',
    '125_phase5_collection_lock_lint_correction.sql','B0FC1EFB919534F674296783F3574369904EE09C0474727D7088605C24F2B7CB','INVOKER','pg_catalog',false],
  ['phase5_private.commit_customer_payment_reversal_v1(uuid,uuid,uuid,uuid,text,text,text,text)',
    '124_phase5_canonical_collection_reversal_writers.sql','32E6E89736AA539172E57E06CB677A46C1FF0A0E0E3EEC579E466D66F29068A1','INVOKER','pg_catalog',false],
  ['public.record_customer_order_payment_once(uuid,bigint,text,text,text,text)',
    '078_operational_accounting_integrity.sql','9BA2CF82AA6BD1695E8200C4DE554415CB82A96AEA2597FEB3BDC598177E1ECF','DEFINER','public, pg_temp',true,'NOT_PROVEN_FROM_SOURCE'],
];

export function deriveAdmissionReachability(entry,sources,knownSignatures,pinnedIdentities=new Set()) {
  const visited=new Set(),nodes=[],unresolved=[],cycles=[];
  const visit=(signature,path)=>{
    if(path.includes(signature)){cycles.push([...path,signature]);return;}
    if(visited.has(signature))return;
    const source=sources.get(signature);
    if(!source){unresolved.push({caller:path.at(-1)??null,target:signature,reason:'SOURCE_MISSING'});return;}
    visited.add(signature);
    const observation=inspectAdmissionBody(source.body,knownSignatures);
    nodes.push({signature,sourceMigration:source.sourceMigration,bodySha256:sha(source.body),
      sourcePinned:pinnedIdentities.has(signature),path:[...path,signature],observation});
    for(const call of observation.calls){
      if(call.exactTarget)visit(call.exactTarget,[...path,signature]);
      else unresolved.push({caller:signature,...call});
    }
  };
  visit(entry,[]);
  // The union is only potential reachability: conditional calls, SQL evaluation
  // order and implicit triggers/defaults cannot be declared ordered by DFS.
  return {entry,nodes,unresolved,cycles,potentialWriteRelations:sorted(new Set(nodes.flatMap(n=>n.observation.writes.map(w=>w.relation)))),
    implicitEffectsQualified:false,allBranchesOrdered:false,allowedInvokersQualified:false,
    runtimeAdmissionProven:false,executionAuthority:false};
}

export function buildWriterAdmissionMatrix(root=resolve(fileURLToPath(new URL('../..',import.meta.url)))) {
  const files=readdirSync(resolve(root,'supabase/migrations')).filter(n=>/^\d{3}_/u.test(n)&&Number(n.slice(0,3))<=127).sort();
  const migrationSources=new Map(files.map(filename=>[filename,lf(readFileSync(resolve(root,'supabase/migrations',filename),'utf8'))]));
  const historical=functionEvents([...migrationSources].map(([filename,source])=>({filename,source}))).state;
  const candidate=lf(readFileSync(resolve(root,'supabase/migrations/128_phase5_inactive_collection_preparation.sql'),'utf8'));
  const section=candidate.slice(candidate.indexOf('CREATE FUNCTION phase5_private.plan_inventory_parent_sources_v1()'));
  const pinned=constant(section,'expected_sources');
  const signatures=sorted([...historical.keys()]);
  const publicIdentities=constant(section,'expected_signatures');
  if(JSON.stringify(publicIdentities)!==JSON.stringify(signatures.filter(s=>s.startsWith('public.'))))
    throw new Error('ADMISSION_PUBLIC_CALLABLE_IDENTITY_DRIFT');
  const byName=name=>{const hits=[...historical.values()].filter(r=>r.signature.split('(')[0]===`public.${name}`);if(hits.length!==1)throw new Error('ADMISSION_BRANCH_TARGET_AMBIGUOUS:'+name);return hits[0];};
  const records=pinned.map(p=>{
    const source=historical.get(p.signature);
    if(!source)throw new Error('ADMISSION_HISTORICAL_SOURCE_MISSING:'+p.signature);
    let body=source.body;
    if(p.sourceTransform!==null){
      const fragment="\n    OR NULLIF(TRIM(p_street), '') IS NULL";
      const patch=lf(readFileSync(resolve(root,'supabase/migrations/090_optional_guest_delivery_details.sql'),'utf8'));
      if(source.functionName!=='submit_guest_customer_order_core'
        ||p.sourceTransform!=='090_optional_guest_delivery_details.sql:remove-exact-required-street-fragment'
        ||body.split(fragment).length!==2||!patch.includes('REPLACE(v_definition, v_required_fragment'))
        throw new Error('ADMISSION_GENERATED_SOURCE_TRANSFORM_UNRESOLVED:'+p.signature);
      body=body.replace(fragment,'');
    }
    if(sha(body).toLowerCase()!==p.bodySha256.toLowerCase())throw new Error('ADMISSION_HISTORICAL_SOURCE_DRIFT:'+p.signature);
    const observed=inspectAdmissionBody(body,signatures);
    return {signature:p.signature,sourceMigration:source.sourceMigration,sourceTransform:p.sourceTransform,bodySha256:sha(body),
      securityMode:source.securityMode,sourceOwner:source.owner??'NOT_PROVEN_FROM_SOURCE',searchPath:source.searchPath,
      directAcl:source.acl,observation:observed,
      disposition:families.some(f=>f.chain.includes(source.functionName))?'IN_REVIEWED_BRANCH_CHAIN':'REQUIRES_BRANCH_AND_INVOKER_REVIEW',
      firstTransitiveWriteQualified:false,earlyGateQualified:false,allowedInvokerClosure:false,runtimeAdmissionProven:false};
  });
  if(new Set(records.map(r=>r.signature)).size!==records.length)throw new Error('ADMISSION_DUPLICATE_PINNED_IDENTITY');
  const branches=families.map(f=>{
    const chain=f.chain.map(byName);
    for(let i=0;i<chain.length-1;i++){
      const target=chain[i+1].signature;
      if(!inspectAdmissionBody(chain[i].body,signatures).calls.some(c=>c.exactTarget===target))throw new Error('ADMISSION_BRANCH_EDGE_MISSING:'+target);
    }
    const leaf=chain.at(-1),first=inspectAdmissionBody(leaf.body,signatures).firstOwnWrite;
    if(!first||maskAdmissionSql(leaf.body).indexOf(f.boundary)!==first.offset)throw new Error('ADMISSION_FIRST_WRITE_DRIFT:'+f.id);
    const wrappers=chain.slice(0,-1).map((s,i)=>{const obs=inspectAdmissionBody(s.body,signatures),edge=obs.calls.find(c=>c.exactTarget===chain[i+1].signature);
      return {signature:s.signature,delegate:edge,ownWritesBeforeDelegate:obs.writes.filter(w=>w.offset<edge.offset),rowLocksBeforeDelegate:obs.rowLocks.filter(l=>l.offset<edge.offset),gatesBeforeDelegate:obs.gates.filter(g=>g.offset<edge.offset)};});
    return {...f,entrySignature:chain[0].signature,exactChain:chain.map(s=>s.signature),firstTransitiveWrite:{signature:leaf.signature,...first},wrappers,
      currentGateOrder:compareGateToBoundary(chain[0].body,'public.phase2_lock_inventory_products_internal',chain.length===1?f.boundary:`public.${chain[1].functionName}`),
      sourceTraceReviewed:true,firstTransitiveWriteQualified:false,earlyGateQualified:false,runtimeAdmissionProven:false,executionAuthority:false};
  });
  const supportDependencies=supportAnchors.map(([signature,migration,hash,contract])=>{
    const source=historical.get(signature);
    if(!source||sha(source.body)!==hash||source.sourceMigration!==migration||source.owner!=='postgres'
      ||source.securityMode!=='DEFINER'||source.searchPath!=='public, pg_temp'
      ||JSON.stringify(source.acl)!==JSON.stringify({public:false,anon:false,authenticated:signature==='public.reverse_supplier_payment(uuid,text,text)',service_role:false}))
      throw new Error('ADMISSION_SUPPORT_SOURCE_DRIFT:'+signature);
    const observation=inspectAdmissionBody(source.body,signatures);
    if(observation.writes.length)throw new Error('ADMISSION_SUPPORT_UNEXPECTED_WRITE:'+signature);
    return {signature,sourceMigration:migration,bodySha256:hash,contract,observation,
      actorAuthority:'CALLER_MUST_AUTHORIZE',runtimeAdmissionProven:false,executionAuthority:false};
  });
  const pinnedIdentities=new Set(records.map(r=>r.signature));
  const financialDependencies=financialAnchors.map(([signature,migration,hash,mode,path,authenticated,owner='postgres'])=>{
    const source=historical.get(signature);
    if(!source||source.sourceMigration!==migration||sha(source.body)!==hash||(source.owner??'NOT_PROVEN_FROM_SOURCE')!==owner
      ||source.securityMode!==mode||source.searchPath!==path
      ||JSON.stringify(source.acl)!==JSON.stringify({public:false,anon:false,authenticated,service_role:false}))
      throw new Error('ADMISSION_FINANCIAL_SOURCE_DRIFT:'+signature);
    return {signature,sourceMigration:migration,bodySha256:hash,sourceOwner:owner,securityMode:mode,searchPath:path,
      directAcl:source.acl,observation:inspectAdmissionBody(source.body,signatures),
      admissionQualified:false,runtimeAdmissionProven:false,executionAuthority:false};
  });
  const participatingIdentities=new Set([...pinnedIdentities,...supportDependencies.map(s=>s.signature),...financialDependencies.map(s=>s.signature)]);
  const correctedSources=new Map(historical);
  for(const r of records)if(r.sourceTransform!==null){
    const source=historical.get(r.signature);
    correctedSources.set(r.signature,{...source,body:source.body.replace("\n    OR NULLIF(TRIM(p_street), '') IS NULL",'')});
  }
  const reachableGraphs=records.map(r=>deriveAdmissionReachability(r.signature,correctedSources,signatures,participatingIdentities));
  const incomingCallerEdges=[];
  for(const [caller,source]of historical){
    for(const edge of inspectAdmissionBody(source.body,signatures).calls){
      if(edge.candidates.some(s=>participatingIdentities.has(s)))incomingCallerEdges.push({caller,
        callerSourceMigration:source.sourceMigration,callerBodySha256:sha(source.body),
        callerSourceQualified:participatingIdentities.has(caller),...edge});
    }
  }
  const unreviewedCallerFrontier=sorted(new Set(incomingCallerEdges.filter(e=>!e.callerSourceQualified).map(e=>e.caller)));
  const receiptV2=inspectReceiptV2SourceContract(historical,migrationSources);
  return {version:3,scope:'SOURCE_ADMISSION_MATRIX_NOT_RUNTIME_AUTHORITY',historicalCeiling:127,
    pinnedSourceIdentitySetSha256:sha(JSON.stringify(sorted(records.map(r=>r.signature)))),records,branches,supportDependencies,incomingCallerEdges,
    financialDependencies,reachableGraphs,unreviewedCallerFrontier,receiptV2,
    explicitOpenBoundaries:['remaining pinned branches and overload/default/trigger closure','direct and inherited privileges plus SECURITY DEFINER invocation','scheduled/dynamic and external caller evidence','server-generated product identities before first writes','all-writer absence-predicate convergence','transaction-owned held context and actual ordered side-effect consumption','full batch/Cash-CliQ/recovery integration','atomic activation and public exposure'],
    completeWriterLedger:false,writerClosed:false,absencePredicatesFenced:false,executionAuthority:false};
}

export function assertWriterAdmissionMatrix(actual,root) {
  const expected=buildWriterAdmissionMatrix(root);
  // Exact per-signature records and ordered source coordinates, not row totals.
  if(JSON.stringify(actual)!==JSON.stringify(expected))throw new Error('ADMISSION_MATRIX_CHANGED_OR_INCOMPLETE');
  return true;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const result=buildWriterAdmissionMatrix();
  if(process.argv.includes('--summary'))console.log(JSON.stringify({scope:result.scope,records:result.records.length,supportDependencies:result.supportDependencies.length,financialDependencies:result.financialDependencies.length,reachableGraphs:result.reachableGraphs.length,incomingEdges:result.incomingCallerEdges.length,unreviewedCallerFrontier:result.unreviewedCallerFrontier,receiptV2:{sourceNodes:result.receiptV2.nodes.length,schemaSources:result.receiptV2.schemaSources.length,identityDomains:result.receiptV2.identityDomains.length,contractSha256:sha(JSON.stringify(result.receiptV2)),runtimeAdmissionProven:result.receiptV2.runtimeAdmissionProven},branches:result.branches.map(b=>({id:b.id,firstWrite:b.firstTransitiveWrite.relation,gate:b.currentGateOrder.sourceOrder,locksBeforeDelegate:b.wrappers.flatMap(w=>w.rowLocksBeforeDelegate).length})),remaining:result.explicitOpenBoundaries,writerClosed:result.writerClosed},null,2));
  else console.log(JSON.stringify(result,null,2));
}
