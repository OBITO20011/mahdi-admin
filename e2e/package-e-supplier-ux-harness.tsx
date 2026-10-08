import React from 'react';
import {createRoot} from 'react-dom/client';
import '../src/index.css';
import {CancelSupplierReceiptDialog} from '../src/features/directReceiving/CancelSupplierReceiptDialog';
import {SupplierPaymentModal} from '../src/features/purchases/SupplierPaymentModal';
import type {SupplierReceipt} from '../src/types/directReceiving';
import type {PurchaseOrder} from '../src/types/purchases';

const receipt = {id: '92600000-0000-4000-8000-000000009001', receiptNumber: 'SR-1000', supplierName: 'مورد التأكيد', items: []} as unknown as SupplierReceipt;
const po = {id: '92600000-0000-4000-8000-000000009002', supplierId: '92600000-0000-4000-8000-000000009003', amountDue: 1, totalAmount: 1, purchaseOrderNumber: 'PO-1000'} as PurchaseOrder;
const root = createRoot(document.getElementById('root')!);
root.render(new URLSearchParams(location.search).has('payment')
  ? <SupplierPaymentModal isOpen po={po} onClose={() => root.unmount()} onSuccess={() => undefined}/>
  : <CancelSupplierReceiptDialog receipt={receipt} onClose={() => root.unmount()} onSuccess={() => undefined}/>);
