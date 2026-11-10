// Explicit absence of parallel READERS on the unchanged219 fixture. Writers
// and unknown functions are never swallowed by this compatibility response.
export const legacy219ReadRpcNames=Object.freeze([
 'lite1_shift_movements2','lite1_preview_shift_reversal2','lite1_shift_closing2',
 'lite1_reporting_report2','lite1_reporting_home2','lite1_operational_orders_page2',
 'lite1_preview_guest2','lite1_catalog_page2','lite1_parcel_options2','lite1_merchandising2',
 'lite1_operating_mode','lite1_statement_dispatch2','lite1_public_pos_receipt2',
]);
export const legacy219MissingRpcName=(pathname:string)=>legacy219ReadRpcNames.find(name=>pathname===`/rest/v1/rpc/${name}`);
interface LegacyRoute {
 request():{url():string};
 fulfill(response:{status:number;json:{code:string;message:string}}):Promise<unknown>;
}
export async function replyLegacy219MissingRpc(route:LegacyRoute){
 const name=legacy219MissingRpcName(new URL(route.request().url()).pathname);
 if(!name)return false;
 await route.fulfill({status:404,json:{code:'PGRST202',message:`Could not find public.${name} in the legacy219 fixture`}});
 return true;
}
