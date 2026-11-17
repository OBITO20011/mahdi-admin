import React from 'react';
import {createRoot} from 'react-dom/client';
import '../src/index.css';
import '../customer-web/src/index.css';
import {ProductCard} from '../customer-web/src/components/ProductCard';
import {ProductDetailsModal} from '../customer-web/src/components/ProductDetailsModal';
import {CartDrawer} from '../customer-web/src/components/CartDrawer';
import {mapCatalogProduct} from '../customer-web/src/services/catalog.service';
import {createCartItem,createBaseUnitCartItem} from '../customer-web/src/utils/cart';

const params=new URLSearchParams(location.search),view=params.get('view'),noop=()=>undefined;
const product=mapCatalogProduct({id:'12800000-0000-4000-8000-000000000001',sku:'ON-UNIT',nameAr:'مياه اختبار وهمية',unitNameAr:'قنينة',saleUnitNameAr:'صندوق',unitsPerSalePackage:12,salePackagePriceInMinorUnits:12000,salePriceInMinorUnits:1000,availableQuantity:48,availableSalePackages:4,isAvailable:true});
const items=[createCartItem(product),createBaseUnitCartItem(product)];
createRoot(document.getElementById('root')!).render(<main dir="rtl" className="mx-auto max-w-lg p-3">
 {view==='cart'?<CartDrawer isOpen items={items} presentationProducts={[product]} onClose={noop} onQuantityChange={noop} onRemove={noop} onEditParcel={noop} onDuplicateParcel={noop} onRemoveParcel={noop} lockedParcelInstanceIds={new Set()} lockedLineIds={new Set()} onClear={noop} onCheckout={noop}/>
 :view==='details'?<ProductDetailsModal product={product} cartQuantityByProduct={new Map()} reservedBaseUnits={new Map()} relatedProducts={[]} onClose={noop} onAddQuantity={noop} onAddBaseUnit={noop} onOpenParcelBuilder={noop} onOpenProduct={noop} storeWhatsAppNumber="" isFavorite={false} onToggleFavorite={noop} onOpenAssistant={noop}/>
 :<ProductCard product={product} cartQuantity={0} isFavorite={false} onAdd={noop} onQuantityChange={noop} onOpenDetails={noop} onToggleFavorite={noop}/>}
</main>);
