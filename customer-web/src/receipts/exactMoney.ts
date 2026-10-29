/** Shared receipt/aftercare monetary text. Never pass it through Number. */
export function exactMinorText(value:unknown,signed=false):string {
  if(typeof value!=='string'||!(signed?/^-?(?:0|[1-9]\d*)$/u:/^(?:0|[1-9]\d*)$/u).test(value)) {
    throw new Error('AFTERCARE215_RESPONSE_INVALID: المبلغ المحفوظ غير مكتمل.');
  }
  return value;
}
export function exactUnitCostText(value:unknown):string {
  if(typeof value!=='string'||!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/u.test(value)) {
    throw new Error('AFTERCARE215_RESPONSE_INVALID: التكلفة التاريخية غير مكتملة.');
  }
  return value;
}
const grouped=(digits:string)=>digits.replace(/\B(?=(\d{3})+(?!\d))/gu,',');
export function formatExactMinorJod(value:string):string {
  const minor=BigInt(exactMinorText(value,true)),abs=minor<0n?-minor:minor;
  return `${minor<0n?'−':''}${grouped((abs/1000n).toString())}.${(abs%1000n).toString().padStart(3,'0')} د.أ`;
}
/** A unit-cost snapshot may contain a fraction of a fils. Keep it visible. */
export function formatExactUnitCostJod(value:string):string {
  const [whole,part='']=exactUnitCostText(value).split('.');
  const scaled=BigInt(whole)*1000000n+BigInt(part.padEnd(6,'0'));
  const fraction=(scaled%1000000000n).toString().padStart(9,'0').replace(/0+$/u,'').padEnd(3,'0');
  return `${grouped((scaled/1000000000n).toString())}.${fraction} د.أ`;
}
export function parcelPacketQuantity(quantity:number,historicalSize:number|null):string {
  if(!Number.isSafeInteger(quantity)||quantity<0||historicalSize!==null&&(!Number.isSafeInteger(historicalSize)||historicalSize<1)) {
    throw new Error('AFTERCARE215_RESPONSE_INVALID: الكمية المحفوظة غير مكتملة.');
  }
  if(!historicalSize||historicalSize===1)return `${quantity} باكيت`;
  const parcels=Math.floor(quantity/historicalSize),packets=quantity%historicalSize;
  return [parcels?`${parcels} طرد`:'',packets?`${packets} باكيت`:''].filter(Boolean).join(' + ')||'0 باكيت';
}
