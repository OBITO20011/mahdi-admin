// Only old fixtures use this. Match the exact PostgREST absent-function reply.
const oldPriceReaders=new Set([
 'get_product_pricing_context225','get_receipt_pricing_warnings225',
 'search_pos_products225','get_pos_parcel_options225',
 'public_storefront_catalog_page225','public_storefront_merchandising225','get_public_parcel_options225',
]);

export function legacy224PriceRead(name:string){
 if(!oldPriceReaders.has(name))return null;
 return {status:404,data:null,error:{code:'PGRST202',message:`Could not find the function public.${name} in the schema cache`}};
}
