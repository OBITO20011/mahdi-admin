import {test,expect} from './isolated-test';
const id=(n:number)=>`92600000-0000-4000-8000-${String(n).padStart(12,'0')}`,actor=id(1),order=id(2);
const request={payload:{orderId:order,items:[{sourceKind:'base_order_item',sourceId:id(3),quantity:12,goodQuantity:11,supplierId:null}],reason:'فحص الراجع',notes:null},previewFingerprint:'a'.repeat(64)};
const result={success:true,contractVersion:215,operationId:id(4),orderId:order,replacementId:id(5),issuedQuantity:12,restockedQuantity:11,badQuantity:1,caseIds:[],moneyDifferenceInMinorUnits:0};
const shell=async(page:import('@playwright/test').Page)=>{
  await page.route('http://127.0.0.1:4173/',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ar" dir="rtl"><body></body></html>'}));
  await page.goto('http://127.0.0.1:4173/');
};
test('215 real IndexedDB blocks all other modes after a lost response and replays the exact request',async({page})=>{
  await shell(page);
  const proof=await page.evaluate(async({actor,order,request,result})=>{
    // @ts-expect-error Live isolated Vite module.
    const {runAdminAftercareMutation}=await import('/src/services/supabase/adminAftercareRecovery.ts');
    const client={auth:{getUser:async()=>({data:{user:{id:actor}},error:null})}};
    let savedKey='',savedRequest:unknown,blocked=0,replays=0;
    try{await runAdminAftercareMutation(client as never,order,'inspected_replacement','START_NEW',request,async(key:string,body:unknown)=>{savedKey=key;savedRequest=body;throw Error('lost reply');});}catch{/* Simulated lost transport. */}
    for(const action of ['return','replacement','sealed_return','inspected_replacement','exchange']){
      const body=action==='exchange'?{...request,payload:{returnRequest:{orderId:order}}}:request;
      try{await runAdminAftercareMutation(client as never,order,action,'START_NEW',body,async()=>{throw Error('must never invoke');});}
      catch(cause){if(cause instanceof Error&&cause.message.startsWith('AFTERCARE_OUTCOME_UNKNOWN:'))blocked++;else throw cause;}
    }
    const response=await runAdminAftercareMutation(client as never,order,'inspected_replacement','RECOVER_EXISTING',null,async(key:string,body:unknown)=>{
      if(key!==savedKey||JSON.stringify(body)!==JSON.stringify(savedRequest))throw Error('identity changed');replays++;return{data:{...result,idempotentReplay:true},error:null};
    });
    const record=JSON.parse(localStorage.getItem(`nawasrah:admin:phase43-aftercare:v2:${actor}:${order}:inspected_replacement`)!);
    return{blocked,replays,success:response.data?.success,status:record.status,generation:record.generation,privateValues:/unitCost|profit|ownerValues|Cogs/.test(JSON.stringify(record))};
  },{actor,order,request,result});
  expect(proof).toEqual({blocked:5,replays:1,success:true,status:'SUCCEEDED',generation:2,privateValues:false});
});
for(const legacyFirst of [false,true])test(`215 actual two-tab lock blocks changed mode; ${legacyFirst?'legacy':'new'} coordinator starts first`,async({page,context})=>{
  const second=await context.newPage();await Promise.all([shell(page),shell(second)]);
  const firstRequest=legacyFirst?{items:[{sourceKind:'base_order_item',sourceId:id(3),quantity:1}],reason:'معيب',notes:null}:request;
  await page.evaluate(async({actor,order,request,legacyFirst})=>{
    // @ts-expect-error Live isolated Vite module.
    const {runAdminAftercareMutation}=await import('/src/services/supabase/adminAftercareRecovery.ts');
    const state=window as typeof window&{first?:Promise<string>;release?:()=>void;invoked?:boolean};
    state.first=runAdminAftercareMutation({auth:{getUser:async()=>({data:{user:{id:actor}},error:null})}} as never,order,legacyFirst?'replacement':'inspected_replacement','START_NEW',request,async()=>{
      state.invoked=true;await new Promise<void>(resolve=>{state.release=resolve;});throw Error('lost reply');
    }).then(()=>'unexpected',(cause:unknown)=>cause instanceof Error?cause.message:String(cause));
  },{actor,order,request:firstRequest,legacyFirst});
  await expect.poll(()=>page.evaluate(()=>(window as typeof window&{invoked?:boolean}).invoked)).toBe(true);
  await second.evaluate(async({actor,order,request,legacyFirst})=>{
    // @ts-expect-error Live isolated Vite module.
    const {runAdminAftercareMutation}=await import('/src/services/supabase/adminAftercareRecovery.ts');
    const state=window as typeof window&{second?:Promise<string>;calls?:number};state.calls=0;
    state.second=runAdminAftercareMutation({auth:{getUser:async()=>({data:{user:{id:actor}},error:null})}} as never,order,legacyFirst?'inspected_replacement':'replacement','START_NEW',request,async()=>{
      state.calls!++;return{data:null,error:null};
    }).then(()=>'unexpected',(cause:unknown)=>cause instanceof Error?cause.message:String(cause));
  },{actor,order,request,legacyFirst});
  await page.evaluate(()=>(window as typeof window&{release?:()=>void}).release?.());
  expect(await page.evaluate(()=>(window as typeof window&{first?:Promise<string>}).first)).toBe('lost reply');
  const proof=await second.evaluate(async()=>({message:await(window as typeof window&{second?:Promise<string>}).second,calls:(window as typeof window&{calls?:number}).calls}));
  expect(proof.message).toMatch(/^AFTERCARE_OUTCOME_UNKNOWN:/);expect(proof.calls).toBe(0);
});
test('215 IndexedDB fence refuses a new operation even with an empty stale localStorage view',async({page})=>{
  await shell(page);
  const proof=await page.evaluate(async({actor,order,request})=>{
    // @ts-expect-error Live isolated Vite module.
    const {runAdminAftercareMutation,readAdminAftercareRecoveryState}=await import('/src/services/supabase/adminAftercareRecovery.ts');
    const client={auth:{getUser:async()=>({data:{user:{id:actor}},error:null})}};
    try{await runAdminAftercareMutation(client as never,order,'inspected_replacement','START_NEW',request,async()=>{throw Error('lost');});}catch{/* Simulated lost transport. */}
    Object.defineProperty(Storage.prototype,'getItem',{configurable:true,value:()=>null});
    let calls=0,start='',recovery='';
    try{await runAdminAftercareMutation(client as never,order,'return','START_NEW',{},async()=>{calls++;return{data:null,error:null};});}catch(cause){start=(cause as Error).message;}
    try{await readAdminAftercareRecoveryState(client as never,order,'inspected_replacement');}catch(cause){recovery=(cause as Error).message;}
    return{calls,start,recovery};
  },{actor,order,request});
  expect(proof.calls).toBe(0);expect(proof.start).toMatch(/^AFTERCARE_OUTCOME_UNKNOWN:/);expect(proof.recovery).toMatch(/^AFTERCARE_REVIEW_REQUIRED:/);
});
