import type {Page} from './isolated-test';
const id=(n:number)=>`94300000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const base={id:id(1),sku:'TEST-DISCOUNT',nameAr:'صنف باكيت وطرد مخفض',description:'24 حبة',categoryId:id(10),categoryCode:'TEST',categoryNameAr:'قسم وهمي',unitId:id(20),unitNameAr:'باكيت',saleUnitId:id(21),saleUnitNameAr:'طرد',unitsPerSalePackage:10,salePriceInMinorUnits:1850,salePackagePriceInMinorUnits:15000,quantityTracked:false,manualAvailable:true,availableQuantity:null,availableSalePackages:null,isAvailable:true,minimumOrderPackages:1,isFlavorMaster:false,flavorMasterProductId:null,flavorNameAr:null,imageUrl:''};
export const offPriceProducts=[base,
 {...base,id:id(2),sku:'TEST-SINGLE',nameAr:'صنف باكيت مفرد',unitsPerSalePackage:1,salePriceInMinorUnits:1900,salePackagePriceInMinorUnits:1900,description:'وصف عادي'},
 {...base,id:id(3),sku:'TEST-PARCEL-ONLY',nameAr:'صنف طرد فقط',parcelOnly:true},
 {...base,id:id(4),sku:'TEST-FAMILY',nameAr:'عائلة النكهات الوهمية',isFlavorMaster:true},
 {...base,id:id(5),sku:'TEST-FLAVOR-1',nameAr:'عائلة النكهات الوهمية تفاح',flavorMasterProductId:id(4),flavorNameAr:'تفاح',salePriceInMinorUnits:1750,salePackagePriceInMinorUnits:17000},
 {...base,id:id(6),sku:'TEST-FLAVOR-2',nameAr:'عائلة النكهات الوهمية برتقال',flavorMasterProductId:id(4),flavorNameAr:'برتقال'},
];
export async function mockOffPriceCatalog(page:Page){
 const result={contractVersion:'lite2-catalog-v1',quantityTracked:false,items:offPriceProducts,categories:[],brands:[],saleUnits:[],summary:{quantityTracked:false,availableProducts:4,availableSalePackages:null,lowStockProducts:0},total:4,limit:24,offset:0};
 await page.route('**/rest/v1/rpc/lite1_catalog_page2',route=>route.fulfill({json:result}));
 await page.route('**/rest/v1/rpc/lite1_merchandising2',route=>route.fulfill({json:{contractVersion:'lite2-merchandising-v1',quantityTracked:false,newest:[],bestSellers:[],offers:[],lowStock:[]}}));
 await page.route('**/rest/v1/rpc/lite1_parcel_options2',route=>route.fulfill({json:{contractVersion:'lite2-parcel-options-v1',quantityTracked:false,featureState:'OFF',options:[]}}));
 await page.emulateMedia({reducedMotion:'reduce'});
}
