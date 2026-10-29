import type { ReceiptParcel } from '../receipts/commercialReceipt';
import type {ExchangeReceiptFunding} from '../receipts/exchangeFunding';

export interface PublicPosReceiptItem {
  productName: string;
  sku: string;
  packageQuantity: number;
  packageName: string;
  unitsPerPackage: number;
  packagePriceInMinorUnits: number;
  lineTotalInMinorUnits: number;
  commercialLineKind?: string;
  baseQuantity?: number;
  baseUnitName?: string;
  parcelInstances?: ReceiptParcel[];
}

export interface PublicPosReceipt {
  exchangeFunding?:ExchangeReceiptFunding;
  orderNumber: string;
  createdAt: string;
  status: string;
  paymentMethod: string;
  paymentStatus: string;
  amountPaidInMinorUnits?:number;
  remainingInMinorUnits?:number;
  initialPaymentMethod?:'cash'|'cliq';
  subtotalInMinorUnits: number;
  discountInMinorUnits: number;
  totalInMinorUnits: number;
  branch: {
    name: string;
    address: string;
    phone: string;
  };
  items: PublicPosReceiptItem[];
}
