import {exactMinorText,exactUnitCostText} from './aftercare215Money';
import {readReplacementCase,type SupplierReplacementCase} from './supplierReplacement';
import {isSalesHistoryDate} from './salesHistory';

export const damage215States={pending_supplier:'بانتظار المورد',finished_supplier:'انتهى مع المورد',final_owner:'خسارة نهائية عليّ'} as const;
export type Damage215State=keyof typeof damage215States;
export interface Damage215Movement {id:string;action:string;quantity:number;occurredAt:string;reason:string;lossDeltaInMinorUnits?:string}
export interface Damage215Row {
  source:'damage'|'replacement'|'supplier';id:string;productId:string;productName:string;imageUrl:string|null;quantity:number;historicalParcelSize:number|null;parcelSizeKnown:boolean;
  registeredAt:string;occurredAt:string;reasonCode:string;reason:string;movements:Damage215Movement[];pendingQuantity:number;receivedQuantity:number;creditedQuantity:number;finishedSupplierQuantity:number;finalOwnerQuantity:number;financialOnly:boolean;
  states:Array<{state:Damage215State;quantity:number}>;document:{id:string;number:string;returnNumber:string|null}|null;
  owner?:{unitCostInMinorUnitsExact:string;periodLossInMinorUnits:string;costDifferenceInMinorUnits:string;cases:SupplierReplacementCase[];
    reclassification:{kind:'replacement'|'return';sourceId:string;blockedReason:string|null}|null};
}
export interface Damage215Page {page:number;pageSize:number;totalCount:number;totalPages:number;from:string;to:string;state:'all'|Damage215State;rows:Damage215Row[];
  quantitySummary:Array<{productId:string;productName:string;pending:number;finished:number;final:number}>;periodLossInMinorUnits?:string}
const invalid=()=>new Error('سجل التالف غير مكتمل أو لا يطابق صلاحية المستخدم. أعد تحميله.');
const record=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const text=(v:unknown)=>{if(typeof v!=='string'||!v.trim())throw invalid();return v;};
const nullableText=(v:unknown)=>v===null?null:text(v);
const uuid=(v:unknown)=>{const result=text(v);if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(result))throw invalid();return result;};
const integer=(v:unknown,min=0)=>{if(typeof v!=='number'||!Number.isSafeInteger(v)||v<min)throw invalid();return v;};
const date=(v:unknown)=>{const result=text(v);if(!Number.isFinite(Date.parse(result)))throw invalid();return result;};
const array=(v:unknown):unknown[]=>{if(!Array.isArray(v))throw invalid();return v;};
const stateName=(v:unknown):Damage215State=>{if(typeof v!=='string'||!Object.hasOwn(damage215States,v))throw invalid();return v as Damage215State;};
export function parseDamageLedger215(value:unknown,ownerAllowed:boolean):Damage215Page{
  if(!record(value)||value.contractVersion!==215)throw invalid();
  if(ownerAllowed!==(value.periodLossInMinorUnits!==undefined))throw invalid();
  const page=integer(value.page,1),pageSize=integer(value.pageSize,1),totalCount=integer(value.totalCount),totalPages=integer(value.totalPages,1);
  if(pageSize>100||totalPages!==Math.max(1,Math.ceil(totalCount/pageSize)))throw invalid();
  const rows=array(value.rows).map((v):Damage215Row=>{
    if(!record(v)||!['damage','replacement','supplier'].includes(String(v.source))||typeof v.parcelSizeKnown!=='boolean'||typeof v.financialOnly!=='boolean'||v.unitName!=='باكيت')throw invalid();
    const privateFields=['unitCostInMinorUnitsExact','periodLossInMinorUnits','costDifferenceInMinorUnits','actions'];
    if(ownerAllowed?!privateFields.every(k=>v[k]!==undefined):privateFields.some(k=>v[k]!==undefined)||v.financialOnly)throw invalid();
    const result:Damage215Row={source:v.source as Damage215Row['source'],id:uuid(v.id),productId:uuid(v.productId),productName:text(v.productName),imageUrl:nullableText(v.imageUrl),quantity:integer(v.quantity),
      historicalParcelSize:v.historicalParcelSize===null?null:integer(v.historicalParcelSize,1),parcelSizeKnown:v.parcelSizeKnown,
      registeredAt:date(v.registeredAt),occurredAt:date(v.occurredAt),reasonCode:text(v.reasonCode),reason:text(v.reason),pendingQuantity:integer(v.pendingQuantity),receivedQuantity:integer(v.receivedQuantity),creditedQuantity:integer(v.creditedQuantity),
      finishedSupplierQuantity:integer(v.finishedSupplierQuantity),finalOwnerQuantity:integer(v.finalOwnerQuantity),financialOnly:v.financialOnly,document:null,
      states:array(v.states).map(s=>{if(!record(s))throw invalid();return{state:stateName(s.state),quantity:integer(s.quantity,1)};}),
      movements:array(v.movements).map(m=>{if(!record(m)||ownerAllowed!==(m.lossDeltaInMinorUnits!==undefined))throw invalid();return{id:uuid(m.id),action:text(m.action),quantity:integer(m.quantity),occurredAt:date(m.occurredAt),reason:text(m.reason),
        ...(ownerAllowed?{lossDeltaInMinorUnits:exactMinorText(m.lossDeltaInMinorUnits,true)}:{})};})};
    if(result.parcelSizeKnown!==(result.historicalParcelSize!==null)||result.financialOnly!==(result.quantity===0)||result.pendingQuantity+result.finishedSupplierQuantity+result.finalOwnerQuantity!==result.quantity
      ||new Set(result.states.map(s=>s.state)).size!==result.states.length||result.states.reduce((s,x)=>s+x.quantity,0)!==result.quantity)throw invalid();
    for(const [state,q]of [['pending_supplier',result.pendingQuantity],['finished_supplier',result.finishedSupplierQuantity],['final_owner',result.finalOwnerQuantity]] as const)
      if((result.states.find(s=>s.state===state)?.quantity??0)!==q)throw invalid();
    if(v.document!==null){if(!record(v.document)||v.document.type!=='order')throw invalid();result.document={id:uuid(v.document.id),number:text(v.document.number),returnNumber:nullableText(v.document.returnNumber)};}
    if(ownerAllowed){if(!record(v.actions))throw invalid();const action=v.actions.reclassification;let reclassification:NonNullable<Damage215Row['owner']>['reclassification']=null;
      if(action!==null){if(!record(action)||!['replacement','return'].includes(String(action.kind)))throw invalid();reclassification={kind:action.kind as 'replacement'|'return',sourceId:uuid(action.sourceId),blockedReason:nullableText(action.blockedReason)};}
      result.owner={unitCostInMinorUnitsExact:exactUnitCostText(v.unitCostInMinorUnitsExact),periodLossInMinorUnits:exactMinorText(v.periodLossInMinorUnits,true),costDifferenceInMinorUnits:exactMinorText(v.costDifferenceInMinorUnits,true),cases:array(v.actions.cases).map(readReplacementCase),reclassification};
      if(result.movements.reduce((sum,m)=>sum+BigInt(m.lossDeltaInMinorUnits!),0n)!==BigInt(result.owner.periodLossInMinorUnits))throw invalid();
    }
    return result;
  });
  if(rows.length!==Math.max(0,Math.min(pageSize,totalCount-(page-1)*pageSize))||new Set(rows.map(r=>r.source+':'+r.id)).size!==rows.length)throw invalid();
  return{page,pageSize,totalCount,totalPages,from:date(value.from),to:date(value.to),state:value.state==='all'?'all':stateName(value.state),rows,
    quantitySummary:array(value.quantitySummary).map(s=>{if(!record(s))throw invalid();return{productId:uuid(s.product_id),productName:text(s.product_name),pending:integer(s.pending_quantity),finished:integer(s.finished_supplier_quantity),final:integer(s.final_owner_quantity)};}),
    ...(ownerAllowed?{periodLossInMinorUnits:exactMinorText(value.periodLossInMinorUnits,true)}:{})};
}

/** Preserve212 periods: today, preceding six days, month-to-date, inclusive
 * custom dates. Intl derives Amman midnight; the browser's timezone is unused. */
export function damageLedgerPeriod215(period:'today'|'week'|'month'|'range',from?:string,to?:string,now=new Date()):{from:string;to:string}{
  const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Amman',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
  const parts=(d:Date)=>Object.fromEntries(formatter.formatToParts(d).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
  const today=parts(now),todayText=`${today.year}-${today.month}-${today.day}`;
  const add=(s:string,n:number)=>{const d=new Date(s+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
  const first=period==='range'?from:period==='week'?add(todayText,-6):period==='month'?todayText.slice(0,8)+'01':todayText,last=period==='range'?to:todayText;
  if(!isSalesHistoryDate(first)||!isSalesHistoryDate(last)||first>last||Date.parse(last)-Date.parse(first)>366*86400000)throw new Error('اختر تاريخ البداية والنهاية بترتيب صحيح وبفترة لا تتجاوز سنة.');
  const midnight=(s:string)=>{const target=Date.parse(s+'T00:00:00Z');let instant=target;
    for(let i=0;i<2;i++){const p=parts(new Date(instant)),local=Date.UTC(Number(p.year),Number(p.month)-1,Number(p.day),Number(p.hour),Number(p.minute),Number(p.second));instant=target-(local-instant);}
    const p=parts(new Date(instant));if(`${p.year}-${p.month}-${p.day}`!==s||p.hour!=='00')throw new Error('تعذر إثبات بداية اليوم بتوقيت عمّان.');return new Date(instant).toISOString();};
  return{from:midnight(first),to:midnight(add(last,1))};
}
