import {independentParcelPriceError,parcelDiscountInMinorUnits} from './independentParcelPrices';
import {formatJod} from '../components/ui/uiFormat';

export function offParcelPricePresentation(units:number,single:number,parcel:number,unit:string){
  const name=unit.trim()||'باكيت';
  const error=independentParcelPriceError(units,single,parcel);
  const formula=Number.isSafeInteger(units)&&units>=2&&Number.isSafeInteger(single)&&single>0
    ? units+' '+name+' × '+formatJod(single/1000)+' = '+formatJod(units*single/1000)+' د.أ'
    : '';
  if(error)return {formula,detail:error,tone:'error' as const};
  const discount=parcelDiscountInMinorUnits(units,single,parcel);
  return {
    formula,
    detail:discount>0
      ? 'خصم '+formatJod(discount/1000)+' د.أ — '+name+' داخل الطرد بـ'+formatJod(parcel/units/1000)
      : 'بدون خصم',
    tone:discount>0?'discount' as const:'equal' as const,
  };
}
