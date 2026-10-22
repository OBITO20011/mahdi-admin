import type {Order,OrderItem} from '../src/types';

const line=(id:string,name:string,kind:string,quantity:number,baseQuantity:number,unit:string,price:number):OrderItem=>({
  id,productId:`product-${id}`,productName:name,sku:`OLD-${id}`,productImage:'',commercialLineKind:kind,
  quantity,baseQuantity,baseUnitName:unit,unit:'تغليف محفوظ قديم',salePackage:'تغليف محفوظ قديم',
  unitPrice:price,costPrice:999,discount:0,totalPrice:quantity*price,
});
export const trialDItems:OrderItem[]=[
  line('chips','شيبس - حار','legacy_single_sku_parcel',1,10,'باكيت',15),
  line('juice','عصير','legacy_single_sku_parcel',2,10,'باكيت',6),
  {...line('mix','عصير المراعي','configurable_parcel',1,6,'قنينة',7),parcelInstances:[{
    id:'private-instance',sequence:1,unitName:'طرد',components:[
      {id:'private-berry',productId:'berry',name:'عصير المراعي - توت',sku:'PRIVATE-BERRY',unitName:'قنينة',quantity:5},
      {id:'private-orange',productId:'orange',name:'عصير المراعي - برتقال',sku:'PRIVATE-ORANGE',unitName:'قنينة',quantity:1},
    ],
  }]},
  line('redbull','ريد بول','base_unit',3,3,'باكيت',1),
];
export const trialDOrder:Order={id:'93400000-0000-4000-8000-000000000001',orderNumber:'POS-TRIAL-D',
  customerName:'زبون التجربة',customerPhone:'',governorate:'إربد',region:'الرمثا',address:'عنوان التجهيز',
  items:trialDItems,subtotal:37,discount:1,deliveryFee:0,totalAmount:36,amountPaid:36,amountDue:0,
  paymentMethod:'cash',paymentStatus:'paid',status:'completed',source:'pos',branchId:'trial-d-branch',isNew:false,
  createdAt:'2026-10-22T08:30:00Z',updatedAt:'2026-10-22T08:30:00Z',statusHistory:[],
  publicReceiptUrl:'https://alnawasreh.com/#receipt=93400000-0000-4000-8000-000000000099',
};
export const trialDDescriptions=['1 طرد (10 باكيت)','2 طرد (10 باكيت)','1 طرد مشكّل (5 توت + 1 برتقال)','3 باكيت'];
