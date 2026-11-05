// Fictional public catalog; no DB, account, environment files or hosted requests.
export const speedId=n=>'93000000-0000-4000-8000-'+String(n).padStart(12,'0');
export const speedCategories=Array.from({length:6},(_,i)=>({id:speedId(1001+i),code:'speed-'+i,nameAr:['مشروبات','شوكولاتة','سكاكر','مواد تموينية','بسكويت','معلبات'][i],imageUrl:'http://127.0.0.1:4174/fixture-images/'+i+'.jpg',productCount:50,availableProductCount:50}));
export const speedProducts=Array.from({length:300},(_,i)=>({id:speedId(i+1),sku:'SPEED-'+String(i).padStart(4,'0'),barcode:'000990'+String(i).padStart(7,'0'),nameAr:'منتج وهمي '+i+' '+speedCategories[i%6].nameAr,description:'كتالوج اختبار محلي فقط، ليس بضاعة المحل.',categoryId:speedCategories[i%6].id,categoryCode:speedCategories[i%6].code,categoryNameAr:speedCategories[i%6].nameAr,brandId:speedId(2001),brandNameAr:'علامة وهمية',unitId:speedId(2002),unitNameAr:'باكيت',saleUnitId:speedId(2003),saleUnitNameAr:'طرد',unitsPerSalePackage:12,parcelOnly:false,salePriceInMinorUnits:500,salePackagePriceInMinorUnits:6000,availableQuantity:240,availableSalePackages:20,minimumOrderPackages:1,lowStockThreshold:12,isAvailable:true,imageUrl:'http://127.0.0.1:4174/fixture-images/'+i+'.jpg',variants:[]}));
export function speedRpc(name,args={}){
 if(name==='get_public_storefront_settings')return{storeNameAr:'النواصرة لتجارة الجملة والمواد الغذائية',ordersEnabled:true,minimumOrderInMinorUnits:0,insideRamthaDeliveryFeeInMinorUnits:0,outsideRamthaDeliveryFeeInMinorUnits:0,showNewestProducts:true,showBestSellers:true,showOffers:true,showLowStock:true,announcementText:'كتالوج سرعة وهمي محلي فقط'};
 if(name==='get_public_storefront_offers')return{success:true,offers:[]};
 if(name==='get_public_storefront_merchandising')return{newest:speedProducts.slice(0,6),bestSellers:speedProducts.slice(6,12),offers:[],lowStock:[]};
 if(name==='get_public_configurable_parcel_options')return{featureState:'OFF',items:[]};
 if(name==='get_public_storefront_catalog_page'){
  const rows=speedProducts.filter(p=>(!args.p_category_id||p.categoryId===args.p_category_id)&&(!args.p_search||p.sku.includes(args.p_search)||p.nameAr.includes(args.p_search))&&(!args.p_product_ids||args.p_product_ids.includes(p.id)));
  const offset=args.p_offset??0,limit=args.p_limit??24;return{items:rows.slice(offset,offset+limit),categories:speedCategories,brands:[{id:speedId(2001),nameAr:'علامة وهمية',productCount:300}],saleUnits:[{id:speedId(2003),nameAr:'طرد',productCount:300}],summary:{availableProducts:300,availableSalePackages:6000,lowStockProducts:0},total:rows.length,offset,limit};
 }
 throw Error('STOREFRONT_SPEED_UNEXPECTED_RPC:'+name);
}
