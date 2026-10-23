import {supabase,isSupabaseConfigured} from '../../lib/supabase';
import {replacementRecord,readReplacementPage,readReplacementResult,type SupplierReplacementAction,type SupplierReplacementPayload} from '../../utils/supplierReplacement';
import {withAdminActionLock} from './adminCustomerV2Lifecycle';
import {markReplacementAttempt,prepareReplacementAttempt,readReplacementAttempt} from './supplierReplacementIntent';
const client=()=>{if(!supabase||!isSupabaseConfigured)throw new Error('خدمة استبدال المورد غير متاحة.');return supabase;};
const actor=async()=>{const {data,error}=await client().auth.getUser();if(error||!data.user)throw new Error('تعذر التحقق من المستخدم.');return data.user.id;};
const messages:Record<string,string>={
  SUPPLIER_REPLACEMENT_ROLE_DENIED:'لا تملك صلاحية استبدال المورد.',SUPPLIER_REPLACEMENT_OWNER_ONLY:'هذه العملية متاحة للمالك فقط.',
  SUPPLIER_REPLACEMENT_STOCK_RESERVED:'الكمية أكبر من المخزون المتاح غير المحجوز.',SUPPLIER_REPLACEMENT_EXCEEDS_PENDING:'الكمية أكبر من المعلّق المتبقي.',
  SUPPLIER_REPLACEMENT_LATER_MOVEMENT:'تحرك المخزون أو الحجز أو التكلفة بعد الحدث؛ العكس غير متاح.',SUPPLIER_REPLACEMENT_INVENTORY_CHANGED:'تغير رصيد المخزون أو تكلفته؛ العكس غير متاح.',
  SUPPLIER_REPLACEMENT_DEPENDENCY:'للحدث عمليات لاحقة. راجع السجل واعكس المسموح من الأحدث.',SUPPLIER_REPLACEMENT_ALREADY_REVERSED:'الحدث معكوس بالفعل.',
  SUPPLIER_REPLACEMENT_PARENT_BUSY_RETRY:'المورد مشغول بعملية أخرى. أعد المحاولة بعد انتهائها.',
  SUPPLIER_REPLACEMENT_EVIDENCE_INVALID:'تعذر إثبات سلامة سجل العملية. يلزم مراجعته مع المالك قبل المتابعة.',
  SUPPLIER_REPLACEMENT_IDEMPOTENCY_CONFLICT:'المفتاح يخص طلباً مختلفاً. استعد المحاولة المحفوظة وراجعها.',
  SUPPLIER_REPLACEMENT_RETURN_IDENTITY_CONFLICT:'تمت تسوية هذا المرتجع بمسار آخر. لا يمكن إضافة معلّق المورد إليه.',
  SUPPLIER_REPLACEMENT_SUPPLIER_INVALID:'اختر مورداً نشطاً وأعد المعاينة.',SUPPLIER_REPLACEMENT_WAREHOUSE_INVALID:'المستودع غير متاح. أعد اختياره.',
  SUPPLIER_REPLACEMENT_PRODUCT_INVALID:'الصنف غير متاح للحركة.',SUPPLIER_REPLACEMENT_QUANTITY_INVALID:'أدخل كمية صحيحة أكبر من صفر.',
  SUPPLIER_REPLACEMENT_REASON_INVALID:'اكتب سبباً من 3 إلى 500 حرف.',SUPPLIER_REPLACEMENT_RETURN_ASSIGNMENTS_MISMATCH:'مصير القطع التالفة غير متطابق مع المرتجع. أعد مراجعته.',
  AFTERCARE211_ALREADY_CLASSIFIED:'سبق تحويل هذا التالف للمورد. راجع قضيته الحالية؛ لا يمكن تحويله مرة ثانية.',
  AFTERCARE211_DEPENDENCY:'البديل الذي أعطيته استُخدم في مرتجع أو استبدال لاحق؛ التحويل غير متاح.',
  AFTERCARE211_PREVIEW_REQUIRED:'عاين التحويل أولاً قبل الاعتماد.',AFTERCARE211_PREVIEW_CHANGED:'تغيّر دليل التحويل. أعد المعاينة قبل الاعتماد.',
  AFTERCARE211_SOURCE_INVALID:'التالف المطلوب غير متاح أو لم يثبت إصداره.',AFTERCARE211_EVIDENCE_INVALID:'دليل تحويل التالف غير متطابق. راجع المالك قبل المتابعة.',
  AFTERCARE211_STANDALONE_IDENTITY:'سُجّل هذا الاستبدال مسبقاً كتالف نهائي. استخدم تحويل التالف من الخيارات الإضافية.',
};
const rpcError=(error:{message?:string;code?:string})=>new Error(['42883','PGRST202'].includes(error.code??'')?'قدرة استبدال المورد غير متاحة بعد. يلزم تحديث قاعدة البيانات للإصدار الحالي.':
  messages[(error.message??'').split(':')[0].trim()]??(['22P02','22003'].includes(error.code??'')?'بيانات العملية غير صالحة. أعد فتحها ومراجعتها.':error.message||'تعذر قراءة استبدال المورد.'));
export async function fetchSupplierReplacementPage(supplierId?:string,status:'pending'|'closed'|'all'='pending',page=1,branchId?:string) {
  const {data,error}=await client().rpc('get_supplier_replacements_page_v1',{p_supplier_id:supplierId||null,p_branch_id:branchId||null,p_status:status,p_page:page,p_page_size:25});
  if(error)throw rpcError(error);return readReplacementPage(data);
}
export interface ReplacementOptions {
  products:Array<{id:string;name:string;sku:string;baseUnitName:string;unitsPerParcel:number;imageUrl?:string|null;availableQuantity?:number}>;
  suppliers:Array<{id:string;name:string}>;warehouses:Array<{id:string;name:string;branchId:string}>;
  lastSuppliers:Array<{productId:string;supplierId:string|null;supplierName:string|null}>;
}
export async function fetchSupplierReplacementOptions(action:SupplierReplacementAction,productSearch='',supplierSearch='',productId?:string):Promise<ReplacementOptions> {
  const {data,error}=await client().rpc('get_supplier_replacement_options_v1',{p_action:action,p_product_search:productSearch,p_supplier_search:supplierSearch,p_product_id:productId||null});
  if(error)throw rpcError(error);
  if(!replacementRecord(data)||data.contractVersion!==208||!Array.isArray(data.products)||!Array.isArray(data.suppliers)||!Array.isArray(data.warehouses)||!Array.isArray(data.lastSuppliers))throw new Error('خيارات الاستبدال غير مكتملة.');
  for(const rows of [data.products,data.suppliers,data.warehouses])if(rows.some(v=>!replacementRecord(v)||typeof v.id!=='string'||typeof v.name!=='string'))throw new Error('خيارات الاستبدال غير مكتملة.');
  if(data.products.some(v=>!replacementRecord(v)||typeof v.baseUnitName!=='string'||!Number.isSafeInteger(v.unitsPerParcel)||Number(v.unitsPerParcel)<1)
    ||data.warehouses.some(v=>!replacementRecord(v)||typeof v.branchId!=='string')
    ||data.lastSuppliers.some(v=>!replacementRecord(v)||typeof v.productId!=='string'||(v.supplierId!==null&&typeof v.supplierId!=='string')||(v.supplierName!==null&&typeof v.supplierName!=='string')))throw new Error('خيارات الاستبدال غير مكتملة.');
  if(data.products.some(v=>!replacementRecord(v)||(v.imageUrl!==undefined&&v.imageUrl!==null&&typeof v.imageUrl!=='string')
    ||(v.availableQuantity!==undefined&&(!Number.isSafeInteger(v.availableQuantity)||Number(v.availableQuantity)<0))))throw new Error('صور وأرصدة خيارات الصنف غير صالحة.');
  return {products:data.products,suppliers:data.suppliers,warehouses:data.warehouses,lastSuppliers:data.lastSuppliers} as ReplacementOptions;
}
export async function fetchSupplierReplacementPreview(action:SupplierReplacementAction,payload:SupplierReplacementPayload) {
  const {data,error}=await client().rpc('preview_supplier_replacement_v1',{p_action:action,p_payload:payload});if(error)throw rpcError(error);
  if(!replacementRecord(data)||data.contractVersion!==208||data.action!==action||typeof data.eligible!=='boolean'||(data.blockedReason!==null&&typeof data.blockedReason!=='string'))throw new Error('معاينة الاستبدال غير مكتملة.');
  return data;
}
export async function supplierReplacementRecovery(scope:string) {return readReplacementAttempt(await actor(),scope);}
export async function submitSupplierReplacement(scope:string,request?:{action:SupplierReplacementAction;payload:SupplierReplacementPayload;expectedNonce:string|null}) {
  const actorId=await actor();
  return withAdminActionLock(`supplier-replacement208:${actorId}:${scope}`,async()=>{
    if(await actor()!==actorId)throw new Error('تغيّر المستخدم. أعد فتح الشاشة.');
    const attempt=request?await prepareReplacementAttempt(actorId,scope,request.action,request.payload,request.expectedNonce):await readReplacementAttempt(actorId,scope);
    if(!attempt)throw new Error('لا توجد محاولة محفوظة لاستعادتها.');
    if(attempt.status==='rejected')throw new Error('المحاولة مرفوضة. راجع البيانات وابدأ عملية جديدة.');
    const wasPrepared=attempt.status==='prepared';
    if(attempt.status!=='succeeded')await markReplacementAttempt(attempt,'unknown');
    let response;
    try{
      if(['replacement_supplier','reclassify_replacement','reclassify_return'].includes(attempt.action))response=await client().rpc('execute_aftercare_supplier_v1',{p_action:attempt.action,p_payload:attempt.payload,p_idempotency_key:attempt.key});
      else response=await client().rpc('execute_supplier_replacement_v1',{p_action:attempt.action,p_payload:attempt.payload,p_idempotency_key:attempt.key});
    }
    catch{throw new Error('نتيجة العملية غير محسومة. استعد نفس المحاولة دون تسجيل طلب جديد.');}
    if(response.error){
      if(wasPrepared&&['P0001','42501','22023','23514','40001','40P01','22P02','22003'].includes(response.error.code??''))await markReplacementAttempt(attempt,'rejected');
      throw rpcError(response.error);
    }
    const result=readReplacementResult(response.data,attempt.action,attempt.key);
    await markReplacementAttempt(attempt,'succeeded');
    if(await actor()!==actorId)throw new Error('تغيّر المستخدم بعد العملية. أعد فتح الشاشة.');
    return result;
  });
}

export interface AftercareDamageCandidate {
  kind:'replacement'|'return';id:string;productId:string;productName:string;quantity:number;occurredAt:string;blockedReason:string|null;
}
export interface AftercareSupplierPreview {
  eligible:boolean;blockedReason:string|null;previewFingerprint:string;quantity:number;reclassifiedInMinorUnits:number;
}
export async function fetchAftercareDamageCandidates(orderId:string):Promise<AftercareDamageCandidate[]> {
  const {data,error}=await client().rpc('get_aftercare_damage_candidates_v1',{p_order_id:orderId});if(error)throw rpcError(error);
  if(!replacementRecord(data)||data.contractVersion!==211||!Array.isArray(data.candidates)||data.candidates.some(v=>!replacementRecord(v)
    ||!['replacement','return'].includes(String(v.kind))||typeof v.id!=='string'||typeof v.productId!=='string'||typeof v.productName!=='string'
    ||!Number.isSafeInteger(v.quantity)||Number(v.quantity)<1||typeof v.occurredAt!=='string'||(v.blockedReason!==null&&typeof v.blockedReason!=='string')))throw new Error('سجل التالف غير مكتمل. أعد تحميله.');
  return data.candidates as AftercareDamageCandidate[];
}
export async function fetchAftercareSupplierPreview(candidate:AftercareDamageCandidate,supplierId:string):Promise<AftercareSupplierPreview> {
  const {data,error}=await client().rpc('preview_aftercare_supplier_v1',{p_kind:candidate.kind,p_source_id:candidate.id,p_supplier_id:supplierId});if(error)throw rpcError(error);
  if(!replacementRecord(data)||data.contractVersion!==211||data.sourceId!==candidate.id||data.sourceKind!==candidate.kind||data.supplierId!==supplierId
    ||typeof data.eligible!=='boolean'||(data.blockedReason!==null&&typeof data.blockedReason!=='string')||typeof data.previewFingerprint!=='string'
    ||!/^[0-9a-f]{64}$/u.test(data.previewFingerprint)||!Number.isSafeInteger(data.quantity)||Number(data.quantity)<1
    ||!Number.isSafeInteger(data.reclassifiedInMinorUnits)||Number(data.reclassifiedInMinorUnits)<0)throw new Error('معاينة تحويل التالف غير مكتملة.');
  return data as unknown as AftercareSupplierPreview;
}
export const aftercareSupplierBlockedMessage=(code:string)=>messages[code]??'التحويل غير متاح. حدّث السجل وراجع المالك.';
