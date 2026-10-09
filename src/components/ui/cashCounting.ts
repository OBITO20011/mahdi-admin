export const cashDenominations = [50,20,10,5,1] as const;
/** Local counting aid only. Never calculates authoritative expected cash. */
export function countedCashMinorUnits(counts: readonly string[], coins: string): number | undefined {
  if(counts.length!==cashDenominations.length || counts.some(v=>v!==''&&!/^\d+$/u.test(v)))return undefined;
  if(coins!==''&&!/^\d+(?:\.\d{0,3})?$/u.test(coins))return undefined;
  const [whole='0',fraction='']=coins.split('.');
  const total=counts.reduce((sum,v,i)=>sum+Number(v||0)*cashDenominations[i]*1000,0)
    +Number(whole||0)*1000+Number(fraction.padEnd(3,'0')||0);
  return Number.isSafeInteger(total)&&total>=0?total:undefined;
}
