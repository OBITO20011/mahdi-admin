import AxeBuilder from '@axe-core/playwright';
import {analyzePackageFAccessibility} from './package-f-accessibility';
import {checkLayout as checkClipping} from './package-f-layout';
import {test,expect,type Page} from './isolated-test';

const url=(query:string)=>'/e2e/package-f-product-edit-conflict-harness.html?'+query;
const productId='88888888-8888-4888-8888-000000000001',flavorId='88888888-8888-4888-8888-000000000006';
type Row={id:string;name_ar:string;default_sale_price_in_minor_units:number;is_active:boolean;flavor_name_ar?:string;barcode?:string;updated_at:string};
type Call={name:string;args:Record<string,unknown>};
const db=(page:Page)=>page.evaluate(()=>(window as unknown as {__db:()=>Row[]}).__db());
const calls=(page:Page,name:string)=>page.evaluate(n=>(window as unknown as {__editCalls:Call[]}).__editCalls.filter(c=>c.name===n),name);
const row=async(page:Page,id:string)=>(await db(page)).find(r=>r.id===id)!;
const save=(page:Page)=>page.getByRole('button',{name:'حفظ التعديلات'}).click();

async function checkLayout(page:Page){
  const root=page.getByTestId('product-edit-conflict');
  await checkClipping(page,root);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await expect(root).not.toContainText(/[٠-٩]/u);
  const small=await root.evaluate(element=>Array.from(element.querySelectorAll('button'))
    .filter(control=>{const box=control.getBoundingClientRect();return box.width>0&&box.height<43.5;}).map(control=>control.outerHTML.slice(0,90)));
  expect(small).toEqual([]);
}
async function axe(page:Page){
  const result=await analyzePackageFAccessibility(page,new AxeBuilder({page}).include('[data-testid="product-edit-conflict"]')
    .withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']));
  expect(result.violations.filter(v=>v.impact==='serious'||v.impact==='critical')
    .map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))).toEqual([]);
}

for(const theme of ['light','dark'] as const)for(const width of [390,820,1440]){
  test(`تعارض تعديل المنتج بين تبويبين ${theme} ${width}: رفض بالعربي، عرض القيم الحالية، إعادة التطبيق والحفظ`,async({page,context})=>{
    const height=width===390?844:900;
    await page.setViewportSize({width,height});
    await page.goto(url(`theme=${theme}&reset=1`));
    const other=await context.newPage();await other.setViewportSize({width,height});
    await other.goto(url(`theme=${theme}`));
    const opened=(await row(page,productId)).updated_at;

    // Tab B (other user) renames and saves first.
    await other.getByLabel('اسم المنتج').fill('عصير برتقال - تعديل الزميل');
    await save(other);
    await expect(other.getByTestId('product-edit-closed')).toBeVisible();
    expect((await row(page,productId)).name_ar).toBe('عصير برتقال - تعديل الزميل');

    // Tab A still holds the old version: changes the sale price and saves.
    await page.getByLabel('سعر بيع الطرد').fill('23.5');
    await save(page);
    const panel=page.getByTestId('product-edit-conflict');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('عدّل مستخدم آخر هذا المنتج قبل قليل');
    const [refused]=await calls(page,'update_product_master_v4');
    expect(refused.args.p_expected_updated_at).toBe(opened);
    expect((await row(page,productId)).name_ar,'nothing was overwritten').toBe('عصير برتقال - تعديل الزميل');
    expect((await row(page,productId)).default_sale_price_in_minor_units).toBe(21600);

    await panel.getByRole('button',{name:'عرض القيم الحالية'}).click();
    const values=page.getByTestId('product-edit-conflict-values');
    await expect(values.getByRole('row',{name:/اسم المنتج/u})).toContainText('غيّره مستخدم آخر');
    await expect(values.getByRole('row',{name:/اسم المنتج/u})).toContainText('عصير برتقال - تعديل الزميل');
    await expect(values.getByRole('row',{name:/سعر بيع الطرد/u})).toContainText('غيّرته أنت');
    await checkLayout(page);await axe(page);

    await panel.getByRole('button',{name:'إعادة تطبيق تعديلاتي'}).click();
    await expect(page.getByTestId('product-edit-reapplied')).toBeVisible();
    await expect(page.getByLabel('اسم المنتج')).toHaveValue('عصير برتقال - تعديل الزميل');
    await expect(page.getByLabel('سعر بيع الطرد')).toHaveValue('23.5');
    await save(page);
    await expect(page.getByTestId('product-edit-closed')).toBeVisible();
    const final=await row(page,productId);
    expect(final.name_ar,'the other user\'s change survives').toBe('عصير برتقال - تعديل الزميل');
    expect(final.default_sale_price_in_minor_units,'my change is applied').toBe(23500);
    const saves=await calls(page,'update_product_master_v4');
    expect(saves).toHaveLength(2);
    expect(saves[1].args.p_expected_updated_at).not.toBe(opened);
  });
}

test('حالة الإخفاء التي غيّرها مستخدم آخر لا تُعاد تفعيلها بصمت من نموذج التعديل',async({page})=>{
  await page.goto(url('theme=light&reset=1'));
  await page.evaluate(id=>(window as unknown as {__otherUserEdit:(id:string,c:Record<string,unknown>)=>void}).__otherUserEdit(id,{is_active:false}),productId);
  await page.getByText('متقدم: التغليف والمخزون والصورة',{exact:true}).click();
  await page.getByLabel('حد الطلب').fill('3');
  await save(page);
  const panel=page.getByTestId('product-edit-conflict');
  await expect(panel).toBeVisible();
  await panel.getByRole('button',{name:'عرض القيم الحالية'}).click();
  await expect(page.getByTestId('product-edit-conflict-values').getByRole('row',{name:/الحالة/u})).toContainText('مخفي');
  await panel.getByRole('button',{name:'إعادة تطبيق تعديلاتي'}).click();
  await save(page);
  await expect(page.getByTestId('product-edit-closed')).toBeVisible();
  const final=await row(page,productId);
  expect(final.is_active,'the hidden status from the other user is kept').toBe(false);
  expect((await calls(page,'update_product_master_v4')).at(-1)?.args.p_is_active).toBe(false);
});

test('تعديل النكهة من تبويبين: الثاني يرى القيم الحالية ويعيد التطبيق دون مسح تعديل الأول',async({page,context})=>{
  await page.goto(url('theme=dark&view=detail&reset=1'));
  const other=await context.newPage();await other.goto(url('theme=dark&view=detail'));
  for(const tab of [page,other])await tab.getByRole('button',{name:'تعديل النكهة'}).click();
  await other.getByRole('textbox',{name:'باركود نكهة جبنة'}).fill('6251234500999');
  await other.getByRole('button',{name:'حفظ التعديل'}).click();
  await expect.poll(async()=>(await row(page,flavorId)).barcode).toBe('6251234500999');

  const nameInput=page.locator('label',{hasText:'اسم النكهة'}).locator('input');
  await nameInput.fill('جبنة حارة');
  await page.getByRole('button',{name:'حفظ التعديل'}).click();
  const panel=page.getByTestId('product-edit-conflict');
  await expect(panel).toContainText('عدّل مستخدم آخر هذا المنتج قبل قليل');
  await panel.getByRole('button',{name:'عرض القيم الحالية'}).click();
  await expect(page.getByTestId('product-edit-conflict-values').getByRole('row',{name:/الباركود/u})).toContainText('6251234500999');
  await panel.getByRole('button',{name:'إعادة تطبيق تعديلاتي'}).click();
  await page.getByRole('button',{name:'حفظ التعديل'}).click();
  await expect.poll(async()=>(await row(page,flavorId)).flavor_name_ar).toBe('جبنة حارة');
  expect((await row(page,flavorId)).barcode,'the first tab\'s barcode survives').toBe('6251234500999');
});
