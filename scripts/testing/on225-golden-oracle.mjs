// Independent accounting oracle: integer arithmetic, no ERP/SQL/service imports.
// Input prices are fils; inventory value and the saved WAC have six decimal
// places within a fils. Financial totals round per posted line to one fils.
const scale=1_000_000n;
export function round225Ratio(value,divisor){
 if(divisor<=0n)throw Error('ORACLE_POSITIVE_DIVISOR_REQUIRED');
 const sign=value<0n?-1n:1n,absolute=value*sign;
 return sign*((absolute+divisor/2n)/divisor);
}
const money=value=>round225Ratio(value,scale);
const number=value=>{const result=Number(value);if(!Number.isSafeInteger(result))throw Error('ORACLE_SAFE_INTEGER_REQUIRED');return result;};
export function golden225AccountingOracle(currentPriceAtReturn=1200){
 let quantity=10n,wac=800n*scale;
 const openingCapital=8000n,receipts=12n*800n+2n*850n+2n*1000n;
 let revenue=0n,cogs=0n;
 const sales=[];
 // Each posting values the remaining stock at the saved six-place WAC.
 function receive(units,acquisition){
  wac=round225Ratio(quantity*wac+acquisition*scale,quantity+units);
  quantity+=units;
 }
 receive(14n,12n*800n+2n*850n);
 const firstWac=wac;
 function sell(kind,units,paid){
  const saved={kind,units,paid,unitCostMicro:wac,cogsMicro:units*wac};
  quantity-=units;revenue+=paid;cogs+=money(saved.cogsMicro);sales.push(saved);return saved;
 }
 const original=sell('base',2n,2000n);
 sell('parcel',12n,11000n);sell('loss-base',1n,500n);
 // Receipt changes current WAC BEFORE the old invoice is partially returned.
 receive(2n,2000n);const costAtReturn=wac;
 const returnedUnits=1n,refund=original.paid*returnedUnits/original.units;
 const reversedCost=original.unitCostMicro*returnedUnits;
 wac=round225Ratio(quantity*wac+reversedCost,quantity+returnedUnits);
 quantity+=returnedUnits;
 revenue-=refund;cogs-=money(reversedCost);
 const value=quantity*wac,profit=revenue-cogs,cash=revenue,inventory=money(value);
 return {openingCapital:number(openingCapital),supplierPayable:number(receipts),
  quantity:number(quantity),inventoryValue:number(inventory),inventoryValueMicro:value.toString(),
  firstWacMicro:firstWac.toString(),costAtReturnMicro:costAtReturn.toString(),finalWacMicro:wac.toString(),
  revenue:number(revenue),cogs:number(cogs),profit:number(profit),cash:number(cash),
  refund:number(refund),returnCogs:number(money(reversedCost)),currentPriceAtReturn,
  loss:number(sales[2].paid-money(sales[2].cogsMicro)),
  saleCogs:sales.map(row=>number(money(row.cogsMicro))),
  assets:number(cash+inventory),liabilitiesAndEquity:number(receipts+openingCapital+profit)};
}
