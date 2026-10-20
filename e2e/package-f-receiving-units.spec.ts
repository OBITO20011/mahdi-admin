import AxeBuilder from '@axe-core/playwright';
import {test,expect} from './isolated-test';
import {analyzePackageFAccessibility} from './package-f-accessibility';
import {checkLayout} from './package-f-layout';
const url=(theme:string,view:string)=>`/e2e/package-f-purchasing-harness.html?theme=${theme}&view=${view}&receivingUnits=1`;
async function addProduct(page:import('./isolated-test').Page,name='عصير برتقال 250مل'){
 const search=page.getByRole('textbox',{name:/ابحث/}).first();await search.fill(name);
 await page.locator('[data-receiving-product-result]').filter({hasText:name}).first().click();
}
for(const theme of ['light','dark'])for(const width of [390,820,1440])test(`receiving units ${theme} ${width}: clear named modes,containment and axe`,async({page})=>{
 await page.setViewportSize({width,height:900});
 await page.goto(url(theme,'create-direct'));await addProduct(page);
 const row=page.locator('[data-receiving-line]').first();
 await expect(page.getByText(/الكمية التي ستدخل المخزون/)).toHaveCount(0);
 await expect(row.getByText(/تكلفة شوال المحسوبة/)).toBeVisible();
 await expect(row.getByRole('radio',{name:'طرد',exact:true})).toHaveAttribute('aria-checked','true');
 await row.getByRole('button',{name:'تعديل محتوى الطرد',exact:true}).click();
 await expect(row.getByLabel('كم شوال بالطرد؟',{exact:true})).toHaveValue('24');
 await row.getByRole('button',{name:'تم',exact:true}).click();
 await row.getByRole('radio',{name:'شوال',exact:true}).click();
 await expect(row.getByLabel('كم شوال بالطرد؟',{exact:true})).toHaveCount(0);
 await expect(row.getByLabel('كم شوال؟',{exact:true})).toHaveValue('1');
 await expect(row.getByLabel('سعر شوال',{exact:true})).toHaveValue('0.042');
 await expect(row.getByText('سيدخل المخزون: 1 شوال',{exact:true})).toBeVisible();
 await expect(page.getByText(/الكمية التي ستدخل المخزون/)).toHaveCount(0);
 await checkLayout(page,page.getByTestId('purchasing-workbench'));
 const audit=await analyzePackageFAccessibility(page,new AxeBuilder({page}));
 expect(audit.violations.filter(v=>v.impact==='serious'||v.impact==='critical')).toEqual([]);
 await row.getByRole('radio',{name:'طرد',exact:true}).click();await expect(row.getByLabel('سعر طرد',{exact:true})).toHaveValue('1');
 await row.getByRole('button',{name:'تعديل محتوى الطرد',exact:true}).click();
 await expect(row.getByLabel('كم شوال بالطرد؟',{exact:true})).toHaveValue('24');
 await page.goto(url(theme,'receive'));
 const po=page.locator('[data-receiving-line]').first();await expect(po.getByRole('radio',{name:'طرد',exact:true})).toBeVisible();
 await expect(page.getByText(/الكمية التي ستدخل المخزون/)).toHaveCount(0);
 await po.getByRole('radio',{name:'طرد',exact:true}).click();
 await po.getByRole('button',{name:'تعديل محتوى الطرد',exact:true}).click();
 await expect(po.getByLabel('كم شوال بالطرد؟',{exact:true})).toHaveValue('24');
 await expect(po.getByLabel('سعر طرد',{exact:true})).toHaveValue('1');
 await checkLayout(page,page.getByTestId('purchasing-workbench'));
 const poAudit=await analyzePackageFAccessibility(page,new AxeBuilder({page}));
 expect(poAudit.violations.filter(v=>v.impact==='serious'||v.impact==='critical')).toEqual([]);
});
test('direct base choice cannot send package contents;no-package bottle and repeated SKU preserve exact physical/gross fields',async({page})=>{
 const captured:Record<string,unknown>[]=[];
 await page.route('**/rest/v1/rpc/create_direct_supplier_receipt_v2',route=>{captured.push(route.request().postDataJSON());return route.fulfill({status:400,json:{message:'ISOLATED_UNIT_PROBE_REJECTION',code:'P0001'}});});
 await page.goto(url('light','create-direct'));await addProduct(page);await addProduct(page);
 const rows=page.locator('[data-receiving-line]');await expect(rows).toHaveCount(2);
 await rows.nth(1).getByRole('radio',{name:'شوال',exact:true}).click();
 await rows.nth(1).getByLabel('كم شوال؟',{exact:true}).fill('2');
 await rows.nth(1).getByLabel('سعر شوال',{exact:true}).fill('0.050');
 await page.getByRole('button',{name:'حفظ واستلام البضاعة',exact:true}).click();
 await expect.poll(()=>captured.length).toBe(1);
 const lines=captured[0].p_lines as Array<{commercial_quantity:number;gross_amount_in_minor_units:number;components:Array<{product_id:string;base_quantity:number}>}>;
 expect(lines.map(line=>[line.commercial_quantity,line.gross_amount_in_minor_units,line.components[0].base_quantity])).toEqual([[24,1000,24],[2,100,2]]);
 expect(lines[0].components[0].product_id).toBe(lines[1].components[0].product_id);
 await page.goto(url('dark','create-direct'));await addProduct(page,'مياه معدنية 600مل');
 const bottle=page.locator('[data-receiving-line]').first();
 await expect(bottle.getByRole('radio',{name:'قنينة',exact:true})).toBeVisible();await expect(bottle.getByRole('radio',{name:'طرد',exact:true})).toHaveCount(0);
 await expect(bottle.getByLabel('كم قنينة؟',{exact:true})).toHaveValue('1');
});
test('PO package sends exact gross1.000 and physical24;switch to base preserves old per-unit payload',async({page})=>{
 const captured:Record<string,unknown>[]=[];
 await page.route('**/rest/v1/rpc/receive_purchase_order_v2',route=>{captured.push(route.request().postDataJSON());return route.fulfill({status:400,json:{message:'ISOLATED_UNIT_PROBE_REJECTION',code:'P0001'}});});
 await page.goto(url('light','receive'));const row=page.locator('[data-receiving-line]').first();
 await row.getByRole('radio',{name:'طرد',exact:true}).click();await row.getByLabel('كم طرد؟',{exact:true}).fill('1');
 await page.getByRole('button',{name:'تأكيد الاستلام وزيادة المخزون',exact:true}).click();await expect.poll(()=>captured.length).toBe(1);
 await row.getByRole('radio',{name:'شوال',exact:true}).click();await row.getByLabel('كم شوال؟',{exact:true}).fill('2');await row.getByLabel('سعر شوال',{exact:true}).fill('0.050');
 await page.getByRole('button',{name:'تأكيد الاستلام وزيادة المخزون',exact:true}).click();await expect.poll(()=>captured.length).toBe(2);
 expect(captured.map(payload=>payload.p_lines)).toEqual([
  [expect.objectContaining({line_kind:'base_unit',commercial_quantity:24,gross_amount_in_minor_units:1000,line_discount_in_minor_units:0,components:[{product_id:expect.any(String),base_quantity:24}]})],
  [expect.objectContaining({line_kind:'base_unit',commercial_quantity:2,gross_amount_in_minor_units:100,line_discount_in_minor_units:0,components:[{product_id:expect.any(String),base_quantity:2}]})],
 ]);
});
