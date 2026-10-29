const id=(n:number)=>`92700000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export const damage215Row={source:'damage',id:id(1),productId:id(2),productName:'عصير تجريبي',imageUrl:null,quantity:14,historicalParcelSize:12,parcelSizeKnown:true,unitName:'باكيت',
  registeredAt:'2026-10-28T08:00:00Z',occurredAt:'2026-10-28T09:00:00Z',reasonCode:'customer_return_final',reason:'فحص مرتجع تجريبي',pendingQuantity:1,receivedQuantity:1,creditedQuantity:0,finishedSupplierQuantity:1,finalOwnerQuantity:12,financialOnly:false,
  states:[{state:'pending_supplier',quantity:1},{state:'finished_supplier',quantity:1},{state:'final_owner',quantity:12}],document:{type:'order',id:id(3),number:'POS-TEST-215',returnNumber:'SRT-TEST-215'},
  movements:[{id:id(10),action:'customer_return_final',quantity:14,occurredAt:'2026-10-28T08:00:00Z',reason:'تالف المرتجع',lossDeltaInMinorUnits:'7000'},
    {id:id(11),action:'supplier_send',quantity:2,occurredAt:'2026-10-28T08:30:00Z',reason:'أُرسل للمورد',lossDeltaInMinorUnits:'-1000'},
    {id:id(12),action:'supplier_received',quantity:1,occurredAt:'2026-10-28T09:00:00Z',reason:'وصل البديل',lossDeltaInMinorUnits:'0'}],
  unitCostInMinorUnitsExact:'500.000000',periodLossInMinorUnits:'6000',costDifferenceInMinorUnits:'0',actions:{cases:[],reclassification:{kind:'return',sourceId:id(1),blockedReason:'SUPPLIER_REPLACEMENT_ALREADY_LINKED'}}};
export const damage215Page={contractVersion:215,from:'2026-10-27T21:00:00.000Z',to:'2026-10-28T21:00:00.000Z',state:'all',page:1,pageSize:25,totalCount:1,totalPages:1,rows:[damage215Row],
  quantitySummary:[{product_id:id(2),product_name:'عصير تجريبي',pending_quantity:1,finished_supplier_quantity:1,final_owner_quantity:12}],periodLossInMinorUnits:'6000'};
export function nonOwnerDamage215Page(){
  const raw=structuredClone(damage215Page) as unknown as Record<string,unknown>;delete raw.periodLossInMinorUnits;
  raw.rows=(raw.rows as Array<Record<string,unknown>>).map(row=>{for(const k of ['unitCostInMinorUnitsExact','periodLossInMinorUnits','costDifferenceInMinorUnits','actions'])delete row[k];row.movements=(row.movements as Array<Record<string,unknown>>).map(m=>{delete m.lossDeltaInMinorUnits;return m;});return row;});return raw;
}
