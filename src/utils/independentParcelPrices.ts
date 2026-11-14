/** Minor units only: the saved parcel price never derives the saved single price. */
export function independentParcelPriceError(units:number,single:number,parcel:number):string|null{
 if(!Number.isSafeInteger(units)||units<1||units>2147483647)return 'أدخل عدداً صحيحاً لوحدات الطرد.';
 if(!Number.isSafeInteger(single)||!Number.isSafeInteger(parcel)||single<=0||parcel<=0)return 'أدخل السعرين الموجبين بثلاث خانات عشرية كحد أقصى.';
 if(units===1)return single===parcel?null:'البيع المفرد له سعر واحد؛ اجعل السعرين متطابقين.';
 if(single===parcel)return 'لا يمكن بيع عدة وحدات بسعر وحدة واحدة.';
 if(BigInt(parcel)>BigInt(units)*BigInt(single))return 'سعر الطرد لا يتجاوز العدد مضروباً في سعر الوحدة.';
 return null;
}

export function parcelDiscountInMinorUnits(units:number,single:number,parcel:number):number{
 if(independentParcelPriceError(units,single,parcel))return 0;
 const discount=BigInt(units)*BigInt(single)-BigInt(parcel);
 return discount>0n&&discount<=BigInt(Number.MAX_SAFE_INTEGER)?Number(discount):0;
}
