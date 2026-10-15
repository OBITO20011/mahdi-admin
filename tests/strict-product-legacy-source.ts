// Historic source pins include erased annotations and pre-narrowing spellings.
// Restore only this approved batch's spellings for those old pins. The separate
// strict-product-parity test verifies the real emitted bodies against f2c37bd.
export function strictProductLegacySource(file:string,source:string):string {
  source=source.replaceAll('\r\n','\n');
  if(file.endsWith('/CustomerDetailView.tsx'))source=source
    .replace('      const loadedCustomer = result.customer;\n','')
    .replaceAll('loadedCustomer','result.customer');
  if(file.endsWith('/DirectReceivingView.tsx'))source=source.replaceAll('Set<string | undefined>','Set<string>');
  if(file.endsWith('/ProductFormModal.tsx'))source=source
    .replace('file?: File | null','file?: File')
    .replace('let result: Awaited<ReturnType<typeof createProductFamilyWithFlavorsInSupabase>>;','let result;');
  if(file.endsWith('/CreatePurchaseOrderModal.tsx'))source=source
    .replace('let res: Awaited<ReturnType<typeof createPurchaseOrderInSupabase>>;','let res;');
  if(file.endsWith('/useAppStore.ts'))source=source.replaceAll("NonNullable<User['notificationSettings']>","User['notificationSettings']");
  if(file.startsWith('src/services/supabase/'))source=source
    .replaceAll('  const client = supabase;\n','')
    .replaceAll('!client','!supabase').replaceAll('client.','supabase.')
    .replaceAll('= client\n','= supabase\n').replaceAll('(client,','(supabase,');
  if(file.endsWith('/adminAssistant.service.ts'))source=source.replace("  if (!supabase) {\n    throw new Error('تعذر التواصل مع المساعد الآن.');\n  }\n\n",'');
  return source;
}

// Owner-approved 2026-10-15: the customer profile's payment entry became the
// unified «تحصيل من الزبون» dialog. Map exactly these four spellings back (each
// with its exact count) so every other emitted call, payload and guard stays pinned.
export function approvedUnifiedCollectionSource(file:string,source:string):string {
  if(!file.endsWith('/CustomerDetailView.tsx'))return source;
  const approved:Array<[string,string,number]>=[
    ["import {CustomerCollectionModal} from './CustomerCollectionModal';","import {RecordCustomerPaymentModal} from '../accounts/RecordCustomerPaymentModal';",1],
    ['>تحصيل من الزبون</UiButton>','>تسجيل دفعة · اختيار الطلب</UiButton>',2],
    ['title="تحصيل من الزبون"','title="تسجيل دفعة على طلب مستحق"',1],
    ['<CustomerCollectionModal customerId={customer.id} onClose={() => setPaymentOpen(false)} onSuccess={refresh} />',
      '<RecordCustomerPaymentModal onClose={() => setPaymentOpen(false)} onSuccess={refresh} />',1],
  ];
  for(const [current,legacy,count] of approved){
    const found=source.split(current).length-1;
    if(found!==count)throw new Error(`Approved collection change must occur exactly ${count}x: ${current} (${found})`);
    source=source.replaceAll(current,legacy);
  }
  return source;
}
