import {useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import {Modal} from '../../components/common/Modal';
import {ProductFormModal} from '../products/ProductFormModal';
import {fetchAdminProductById} from '../../services/supabase/products.service';
import type {Product} from '../../types';
import {storeEngine} from '../../stores/useAppStore';
interface Props {productId:string;onClose:()=>void;onSavedOrClosed:()=>void}
/** Portal keeps the existing product form out of the receipt form and retains its rows. */
export function ReceivingProductPriceEditor(p:Props){
  const [state,setState]=useState<{product:Product|null;error:string|null}>({product:null,error:null});
  useEffect(()=>{let active=true;fetchAdminProductById(p.productId).then(product=>{if(active){if(product)storeEngine.cacheProductPage([product]);setState({product,error:product?null:'تعذر إيجاد المنتج لتعديل سعره.'});}}).catch(()=>{if(active)setState({product:null,error:'تعذر تحميل المنتج لتعديل سعره.'});});return ()=>{active=false;};},[p.productId]);
  const close=()=>{p.onSavedOrClosed();p.onClose();};
  return createPortal(<Modal isOpen onClose={close} title="تعديل سعر البيع مع إبقاء الاستلام" maxWidth="max-w-2xl" confirmUnsavedClose>
    {state.error?<p role="alert" className="text-nw-bad">{state.error}</p>:state.product?<ProductFormModal key={state.product.id} initialProduct={state.product} onClose={close}/>:<p role="status">جارٍ تحميل بطاقة المنتج…</p>}
  </Modal>,document.body);
}
