export interface PublicPosReceiptItem {
  productName: string;
  sku: string;
  packageQuantity: number;
  packageName: string;
  unitsPerPackage: number;
  packagePriceInMinorUnits: number;
  lineTotalInMinorUnits: number;
}

export interface PublicPosReceipt {
  orderNumber: string;
  createdAt: string;
  status: string;
  paymentMethod: string;
  paymentStatus: string;
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
