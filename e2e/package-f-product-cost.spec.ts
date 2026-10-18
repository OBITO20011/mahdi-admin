import AxeBuilder from '@axe-core/playwright';
import {analyzePackageFAccessibility} from './package-f-accessibility';
import {checkLayout as checkClipping} from './package-f-layout';
import {test,expect,type Page} from './isolated-test';

const url=(query:string)=>'/e2e/package-f-product-edit-conflict-harness.html?'+query;
type Call={name:string;args:Record<string,unknown>};
const calls=(page:Page,name:string)=>page.evaluate(n=>(window as unknown as {__editCalls:Call[]}).__editCalls.filter(c=>c.name===n),name);

async function audit(page:Page,testId:string){
  const root=page.getByTestId(testId);
  await checkClipping(page,root);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await expect(root).not.toContainText(/[٠-٩]/u);
  const small=await root.evaluate(element=>Array.from(element.querySelectorAll('button,input,select,textarea'))
    .filter(control=>{const box=control.getBoundingClientRect();return box.width>0&&box.height<43.5;}).map(control=>control.outerHTML.slice(0,90)));
  expect(small).toEqual([]);
  const result=await analyzePackageFAccessibility(page,new AxeBuilder({page}).include(`[data-testid="${testId}"]`)
    .withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']));
  expect(result.violations.filter(v=>v.impact==='serious'||v.impact==='critical').map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))).toEqual([]);
}

for(const theme of ['light','dark'] as const)for(const width of [390,820,1440]){
  test(`التكلفة ${theme} ${width}: متوسط التكلفة للعرض فقط في نموذج منتج له حركة، وتصحيح المالك بسبب`,async({page})=>{
    await page.setViewportSize({width,height:width===390?844:900});
    await page.goto(url(`theme=${theme}&reset=1&costHistory=1`));
    const average=page.getByTestId('product-average-cost');
    await expect(average).toContainText('متوسط التكلفة الحالي — يتحدّث من الاستلام');
    await expect(average).toContainText('2.501');
    await expect(average.locator('input')).toHaveCount(0);
    await audit(page,'product-average-cost');

    await page.goto(url(`theme=${theme}&costHistory=1&view=detail&plain=1`));
    await page.getByRole('button',{name:'تصحيح التكلفة'}).click();
    const panel=page.getByTestId('product-cost-correction');
    await expect(panel.getByTestId('product-cost-current')).toContainText('2.501');
    await panel.getByLabel('التكلفة الصحيحة لكل باكيت (د.أ) *').fill('2.6');
    await panel.getByLabel('سبب التصحيح *').fill('قصير');
    await panel.getByRole('button',{name:'حفظ التصحيح'}).click();
    await expect(panel.getByRole('alert')).toContainText('5 إلى 500');
    expect(await calls(page,'correct_product_cost_v1')).toHaveLength(0);
    await audit(page,'product-cost-correction');
    await panel.getByLabel('سبب التصحيح *').fill('تصحيح بعد مراجعة فاتورة المورد');
    await panel.getByRole('button',{name:'حفظ التصحيح'}).click();
    await expect(panel).toHaveCount(0);
    const [sent]=await calls(page,'correct_product_cost_v1');
    expect(sent.args.p_unit_cost_in_minor_units).toBe(2600);
    expect(sent.args.p_reason).toBe('تصحيح بعد مراجعة فاتورة المورد');
    expect(String(sent.args.p_idempotency_key)).toMatch(/^cost-correction-/u);
  });
}

test('منتج جديد بلا حركة: لا عرض لمتوسط التكلفة ويبقى سعر الشراء يحدد التكلفة كما كان',async({page})=>{
  await page.goto(url('theme=light&reset=1'));
  await expect(page.getByLabel('سعر شراء باكيت',{exact:true})).toBeVisible();
  await expect(page.getByTestId('product-average-cost')).toHaveCount(0);
});

test('زر تصحيح التكلفة للمالك فقط',async({page})=>{
  for(const role of ['admin','manager','warehouse_keeper']){
    await page.goto(url(`theme=light&reset=1&costHistory=1&view=detail&plain=1&role=${role}`));
    await expect(page.getByRole('button',{name:'إخفاء المنتج'})).toBeVisible();
    await expect(page.getByRole('button',{name:'تصحيح التكلفة'})).toHaveCount(0);
  }
});

test('عائلة النكهات: التصحيح يختار النكهة لأن العائلة بلا مخزون',async({page})=>{
  await page.goto(url('theme=dark&reset=1&costHistory=1&view=detail'));
  await page.getByRole('button',{name:'تصحيح التكلفة'}).click();
  const panel=page.getByTestId('product-cost-correction');
  // One flavor in the fixture: no picker, the flavor itself is the target.
  await expect(panel.getByRole('heading')).toContainText('جبنة');
  await expect(panel.getByLabel('النكهة')).toHaveCount(0);
  await panel.getByLabel('التكلفة الصحيحة لكل باكيت (د.أ) *').fill('1.25');
  await panel.getByLabel('سبب التصحيح *').fill('تصحيح تكلفة نكهة الجبنة');
  await panel.getByRole('button',{name:'حفظ التصحيح'}).click();
  await expect(panel).toHaveCount(0);
  const [sent]=await calls(page,'correct_product_cost_v1');
  expect(sent.args.p_product_id).toBe('88888888-8888-4888-8888-000000000006');
  expect(sent.args.p_unit_cost_in_minor_units).toBe(1250);
});
