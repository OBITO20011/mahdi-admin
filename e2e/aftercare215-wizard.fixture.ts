import type {Order} from '../src/types';
import type {AdminAftercareModernContext} from '../src/services/supabase/salesAftercare.service';
import {trialDOrder} from './trial-d-receipt.fixture';
const id=(n:number)=>`92600000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export const wizard215Order:Order={...structuredClone(trialDOrder),id:id(1),orderNumber:'POS-TEST-215',branchId:id(4),items:[{...trialDOrder.items[0],id:id(2),productId:id(3),productName:'عصير تجريبي',quantity:1,baseQuantity:12,unitsPerSalePackage:12,unitPrice:9,totalPrice:9}],subtotal:9,totalAmount:9,discount:0,deliveryFee:0,amountPaid:9,amountDue:0};
export const wizard215Context:AdminAftercareModernContext={contractVersion:403,supported:true,capability:'phase43_modern',serverTime:'2026-10-28T10:00:00Z',
  order:{id:id(1),orderNumber:'POS-TEST-215',status:'completed',saleContract:'phase3_pos_v2',branchId:id(4),warehouseId:id(5),completedAt:'2026-10-28T09:00:00Z',deadlineAt:'2026-10-30T09:00:00Z',withinWindow:true},
  financial:{merchandiseDebtInMinorUnits:0,refundableCollectedInMinorUnits:9000,deliveryFeeInMinorUnits:0},baseItems:[{orderItemId:id(2),productId:id(3),quantity:12,remainingQuantity:12,commercialLineKind:'legacy_single_sku_parcel',unitsPerParcel:12,commercialQuantity:1,
    physicalRepresentatives:[{sourceKind:'base_order_item',sourceId:id(2),productId:id(3),remainingQuantity:12,parentReplacementItemId:null}]}],parcelInstances:[],returns:[],replacements:[]};
