import React from 'react';
import {createRoot} from 'react-dom/client';
import '../src/index.css';
import '../customer-web/src/index.css';
import {ProductCard} from '../customer-web/src/components/ProductCard';
import {ProductDetailsModal} from '../customer-web/src/components/ProductDetailsModal';
import {CartDrawer} from '../customer-web/src/components/CartDrawer';
import {PosProductCard} from '../src/features/pos/PosProductCard';
import {ProductsView} from '../src/features/products/ProductsView';
import {mapAdminProductRecord} from '../src/services/supabase/products.service';
import {inventoryProducts} from './package-f-inventory.fixture';
import {storeEngine,type AppState} from '../src/stores/useAppStore';
import type {CatalogProduct} from '../customer-web/src/types/catalog';
import {createCartItem} from '../customer-web/src/utils/cart';

const params=new URLSearchParams(location.search),tracked=params.has('full'),noop=()=>undefined;
const product:CatalogProduct={id:'94300000-0000-4000-8000-000000000201',sku:'PRICE-LONG',barcode:'',nameAr:'منتج السعر الطويل',description:'بيانات اختبار وهمية',categoryId:'drinks',categoryCode:'',categoryNameAr:'مشروبات',brandId:'',brandNameAr:'',unitId:'packet',unitNameAr:'باكيت',saleUnitId:'carton',saleUnitNameAr:'طرد',unitsPerSalePackage:20,parcelOnly:false,salePriceInMinorUnits:70000,salePackagePriceInMinorUnits:1234750,quantityTracked:tracked?undefined:false,availableQuantity:200,availableSalePackages:10,minimumOrderPackages:1,imageUrl:'',isAvailable:true,createdAt:'2026-11-14T00:00:00Z',soldPackagesLast90Days:0,isFlavorMaster:false,flavorMasterProductId:'',flavorNameAr:'',flavorSortOrder:0,variants:[]};
const family={...product,id:'94300000-0000-4000-8000-000000000202',nameAr:'عائلة نكهات السعر الطويل',sku:'PRICE-FAMILY',isFlavorMaster:true,variants:[{...product,id:'94300000-0000-4000-8000-000000000203',flavorNameAr:'تفاح',flavorMasterProductId:'94300000-0000-4000-8000-000000000202'}]};
const admin=mapAdminProductRecord({...inventoryProducts[0],default_sale_price_in_minor_units:1234750,sale_price_in_minor_units:70000,units_per_sale_unit:20});
const store=storeEngine as unknown as {state:AppState;getState:()=>AppState};store.state={...store.getState(),categories:[{id:'drinks',nameAr:'مشروبات'}],products:[admin]};
const fetchPage=async()=>({products:[admin],page:1,pageSize:24,totalCount:1,totalPages:1,metrics:{lowStock:0,outOfStock:0,inventoryCost:0,potentialProfit:0}});
const card=(item:CatalogProduct)=><ProductCard key={item.id} product={item} cartQuantity={0} isFavorite={false} onAdd={noop} onQuantityChange={noop} onOpenDetails={noop} onToggleFavorite={noop}/>;
const view=params.get('view')??'cards',columns=Number(params.get('columns')??4);
createRoot(document.getElementById('root')!).render(<main dir="rtl" className="mx-auto min-w-0 max-w-7xl p-3">
 {view==='cards'&&<div data-testid="price-grid" className="grid gap-3" style={{gridTemplateColumns:`repeat(${columns}, minmax(0, 1fr))`}}>{card(product)}{card(family)}{card({...product,id:'third'})}{card({...family,id:'fourth'})}</div>}
 {view==='details'&&<ProductDetailsModal product={product} cartQuantityByProduct={new Map()} reservedBaseUnits={new Map()} relatedProducts={[]} onClose={noop} onAddQuantity={noop} onAddBaseUnit={noop} onOpenParcelBuilder={noop} onOpenProduct={noop} storeWhatsAppNumber="" isFavorite={false} onToggleFavorite={noop} onOpenAssistant={noop}/>}
 {view==='cart'&&<CartDrawer isOpen items={[createCartItem(product)]} onClose={noop} onQuantityChange={noop} onRemove={noop} onEditParcel={noop} onDuplicateParcel={noop} onRemoveParcel={noop} lockedParcelInstanceIds={new Set()} lockedLineIds={new Set()} onClear={noop} onCheckout={noop}/>}
 {view==='pos'&&<div className="grid grid-cols-2 gap-3"><PosProductCard product={admin} quantityTracked={tracked} manualAvailable stock={200} parcelQuantity={0} unitQuantity={0} disabled={false} onAdd={noop} onReduce={noop}/></div>}
 {view==='admin'&&<ProductsView operatingMode={tracked?'full':'sales-only'} fetchProductPage={fetchPage}/>}
</main>);
