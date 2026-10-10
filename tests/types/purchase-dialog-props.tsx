/** Compile-only negative assertions: tsc must reject each invalid contract.
 * These components must remain typed even if React.FC declarations are absent.
 * No invalid fixture is imported or executed by the application.
 */
import {ReceiveGoodsModal} from '../../src/features/purchases/ReceiveGoodsModal';
import {SupplierPaymentModal} from '../../src/features/purchases/SupplierPaymentModal';
import type {PurchaseOrder} from '../../src/types/purchases';
type IsAny<T> = 0 extends (1 & T) ? true : false;
const noop=()=>undefined;
const po=null as PurchaseOrder|null;
export const receivePropsMustBeTyped:IsAny<Parameters<typeof ReceiveGoodsModal>[0]>=false;
export const paymentPropsMustBeTyped:IsAny<Parameters<typeof SupplierPaymentModal>[0]>=false;
export const validReceive=<ReceiveGoodsModal isOpen={false} po={po} onClose={noop} onSuccess={noop}/>;
export const validPayment=<SupplierPaymentModal isOpen={false} supplierId="fixture" onClose={noop} onSuccess={noop}/>;
// @ts-expect-error Negative contract: required isOpen cannot disappear.
export const missingReceiveOpen=<ReceiveGoodsModal po={po} onClose={noop} onSuccess={noop}/>;
// @ts-expect-error Negative contract: required isOpen cannot disappear.
export const missingPaymentOpen=<SupplierPaymentModal onClose={noop} onSuccess={noop}/>;
// @ts-expect-error Negative contract: unsupported caller alias must fail.
export const wrongSupplierAlias=<SupplierPaymentModal isOpen={false} preselectedSupplier={{id:'fixture'}} onClose={noop} onSuccess={noop}/>;
// @ts-expect-error Negative contract: onSuccess remains required.
export const missingReceiveSuccess=<ReceiveGoodsModal isOpen={false} po={po} onClose={noop}/>;
// @ts-expect-error Negative contract: purchase order prop is required,even if null.
export const missingReceivePo=<ReceiveGoodsModal isOpen={false} onClose={noop} onSuccess={noop}/>;
// @ts-expect-error Negative contract: onClose remains required.
export const missingReceiveClose=<ReceiveGoodsModal isOpen={false} po={po} onSuccess={noop}/>;
// @ts-expect-error Negative contract: onClose remains required.
export const missingPaymentClose=<SupplierPaymentModal isOpen={false} onSuccess={noop}/>;
// @ts-expect-error Negative contract: onSuccess remains required.
export const missingPaymentSuccess=<SupplierPaymentModal isOpen={false} onClose={noop}/>;
