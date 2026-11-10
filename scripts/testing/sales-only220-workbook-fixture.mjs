// Deterministic owner-shaped workbook:820 product rows,72 families,345 flavors.
// Zero real names/phones,zero stock/cost fields. No file read from owner folders.
export function lite220WorkbookFixture(model){
 const P=model.productWorkbookColumns('sales-only'),F=model.flavorWorkbookColumns('sales-only');
 const categories=Array.from({length:14},(_,i)=>({code:'L220-C'+String(i+1).padStart(2,'0'),name:'قسم بروفة '+String(i+1).padStart(2,'0')}));
 const rows=[P.map(c=>c.header)],flavors=[F.map(c=>c.header)];let flavorCount=0;
 for(let i=0;i<820;i++){
  const values={sku:'L220-'+String(i).padStart(4,'0'),name_ar:i%7===0?'ﺑﺮﺍﻭﻧﻲ  بروفة '+i:'صنف بروفة '+i,barcode:i<72||i%3===0?'':'00'+String(8800000000+i),category_name:categories[i%14].name,base_unit_name:'PKT',purchase_unit_name:'CTN',units_per_purchase_unit:'6',sale_unit_name:'CTN',units_per_sale_unit:'6',sale_package_price:'6.000',sale_method:['الاثنين','طرد','باكيت مفرد'][i%3],packet_price:i%3===1?'':'1.000',description:'بيانات وهمية حتمية للبروفة فقط'};
  rows.push(P.map(c=>values[c.key]??''));
  if(i<72)for(let n=0;n<(i<57?5:4);n++){const f={master_sku:values.sku,name:n===0?'ﺑﺮﺗﻘﺎﻝ':'نكهة '+n,barcode:n%2===0?'':'000'+String(9900000000+flavorCount),sku:''};flavors.push(F.map(c=>f[c.key]??''));flavorCount++;}
 }
 if(flavorCount!==345)throw Error('FIXTURE_FLAVOR_COUNT');
 return{categories,sheets:[{name:'المنتجات',rows},{name:'النكهات',rows:flavors}],expected:{productRows:820,families:72,flavors:345,totalIdentities:1165,sellable:1093}};
}
