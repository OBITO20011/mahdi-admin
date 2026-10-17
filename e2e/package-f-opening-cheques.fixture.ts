// Browser presentation fixture only;real money/integrity tests use local SQL196.
type Row=Record<string,unknown>;
interface State {finished:boolean;mainBranchId:string|null;customerEntries:Row[];supplierEntries:Row[];calls:{name:string;args:Row}[]}
interface Party {id:string;name:string;phone?:string}
export function installOpeningChequeHarness(client:{rpc:(name:string,args?:Row)=>unknown},state:State,customers:Party[],suppliers:Party[]){
 const previous=client.rpc.bind(client),entries:Row[]=[],keys=new Map<string,{identity:string;result:Row}>();let sequence=0;
 const ok=(data:unknown)=>Promise.resolve({data,error:null});
 const fail=(message:string)=>Promise.resolve({data:null,error:{message,code:'P0001',details:null,hint:null}});
 const party=(r:Row,kind:'customer'|'supplier'|'endorsed')=>kind==='customer'
  ?customers.find(c=>r.customer_id?c.id===r.customer_id:r.customer_phone?c.phone===r.customer_phone:c.name===r.customer_name)
  :suppliers.find(s=>kind==='supplier'?(r.supplier_id?s.id===r.supplier_id:s.name===r.supplier_name):(r.endorsed_supplier_id?s.id===r.endorsed_supplier_id:s.name===r.endorsed_supplier_name));
 const preview=(rows:Row[])=>{
  const errors:{row:number;message:string}[]=[],totals=new Map<string,{kind:string;id:string;name:string;enteredInMinorUnits:number;existingChequesInMinorUnits:number;proposedChequesInMinorUnits:number}>();
  const seen=new Set<string>();
  for(let index=0;index<rows.length;index++){
   const r=rows[index],c=r.direction==='incoming'?party(r,'customer'):null,s=r.direction==='outgoing'?party(r,'supplier'):r.initial_status==='endorsed'?party(r,'endorsed'):null;
   if((r.direction==='incoming'&&!c)||(r.direction==='outgoing'&&!s)||(r.initial_status==='endorsed'&&!s)){
    errors.push({row:Number(r.sourceRow??index+1),message:'الطرف غير موجود أو غير فريد.'});continue;}
   for(const [kind,p] of [['customer',c],['supplier',s]] as const){if(!p)continue;
    const duplicate=`${kind}:${p.id}:${String(r.bank_name).trim().toLowerCase()}:${String(r.cheque_number).trim()}`;
    if(seen.has(duplicate)||entries.some(e=>(kind==='customer'?e.customer_id:e.supplier_id??e.endorsed_supplier_id)===p.id&&e.bank_name===r.bank_name&&e.cheque_number===r.cheque_number))errors.push({row:Number(r.sourceRow??index+1),message:'الشيك مكرر للطرف والبنك والرقم.'});
    seen.add(duplicate);const id=kind+':'+p.id;
    if(!totals.has(id))totals.set(id,{kind,id:p.id,name:p.name,enteredInMinorUnits:(kind==='customer'?state.customerEntries:state.supplierEntries)
     .filter(e=>!e.isReversed&&(kind==='customer'?e.customerId:e.supplierId)===p.id).reduce((n,e)=>n+Number(e.amountInMinorUnits)*(e.direction==='advance'?-1:1),0),
     existingChequesInMinorUnits:entries.filter(e=>['pending','endorsed'].includes(String(e.status))&&(kind==='customer'?e.customer_id:e.supplier_id??e.endorsed_supplier_id)===p.id).reduce((n,e)=>n+Number(e.amount_in_minor_units),0),proposedChequesInMinorUnits:0});
    totals.get(id)!.proposedChequesInMinorUnits+=Number(r.amount_in_minor_units);
   }
  }
  return {errors,rowCount:rows.length,validCount:rows.length-errors.length,parties:[...totals.values()].map(p=>({...p,chequesInMinorUnits:p.existingChequesInMinorUnits+p.proposedChequesInMinorUnits,beforeChequesInMinorUnits:p.enteredInMinorUnits+p.existingChequesInMinorUnits+p.proposedChequesInMinorUnits})),balanceEffectInMinorUnits:0};
 };
 client.rpc=(name,args={})=>{
  if(!['get_go_live_cheques_v1','preview_go_live_cheques_v1','record_go_live_cheques_v1'].includes(name))return previous(name,args);
  state.calls.push({name,args});
  if(name==='get_go_live_cheques_v1'){
   const page=Number(args.p_page??1),size=Number(args.p_page_size??25),sum=(direction:string,status:string)=>entries.filter(e=>e.direction===direction&&e.status===status).reduce((n,e)=>n+Number(e.amount_in_minor_units),0);
   return ok({entries:[...entries].reverse().slice((page-1)*size,page*size),page,pageSize:size,totalCount:entries.length,hasMore:entries.length>page*size,incomingPendingInMinorUnits:sum('incoming','pending'),outgoingPendingInMinorUnits:sum('outgoing','pending'),endorsedInMinorUnits:sum('incoming','endorsed')});
  }
  const rows=args.p_rows as Row[],data=preview(rows);
  if(name==='preview_go_live_cheques_v1')return ok(data);
  const key=String(args.p_idempotency_key),identity=JSON.stringify({branch:args.p_branch_id,rows}),prior=keys.get(key);
  if(prior)return identity===prior.identity?ok({...prior.result,idempotentReplay:true}):fail('GO_LIVE_BATCH_KEY_CONFLICT');
  if(state.finished)return fail('GO_LIVE_SETUP_FINISHED: تم إنهاء بداية التشغيل.');
  if(data.errors.length)return fail('GO_LIVE_CHEQUE_ROWS_INVALID');
  const created=rows.map(r=>{
   const number=++sequence,c=r.direction==='incoming'?party(r,'customer'):null,s=r.direction==='outgoing'?party(r,'supplier'):null,e=r.initial_status==='endorsed'?party(r,'endorsed'):null,id=`opening-fixture-${number}`;
   const row={id,tracking_number:`CHQ-${String(number).padStart(8,'0')}`,origin:'opening',direction:r.direction,status:r.initial_status??'pending',version:1,
    bank_name:r.bank_name,cheque_number:r.cheque_number,due_date:r.due_date,amount_in_minor_units:Number(r.amount_in_minor_units),branch_id:args.p_branch_id,
    customer_id:c?.id??null,supplier_id:s?.id??null,endorsed_supplier_id:e?.id??null,customer_name:c?.name??null,supplier_name:s?.name??null,endorsed_supplier_name:e?.name??null};
   entries.push(row);return {id,trackingNumber:row.tracking_number};
  });
  const result={success:true,idempotentReplay:false,created,balanceEffectInMinorUnits:0};keys.set(key,{identity,result});return ok(result);
 };
}
