// Explicit local arguments for the new reader sites;protected owner probe helpers
// stay byte-for-byte unchanged. No arbitrary identifier fallback.
export function productWorkbookProbeScope(entry,scope,id){
 if(entry.file!=='src/services/supabase/productWorkbook.service.ts')return scope;
 if(entry.function==='readProductImportSnapshot')return{...scope,id:id(101)};
 if(entry.function==='findTemporary')return{...scope,sku:'LOCAL-AUDIT-ABSENT-SKU'};
 return scope;
}
