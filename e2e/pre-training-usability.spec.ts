import {test,expect} from './isolated-test';
test.use({timezoneId:'UTC'});
test('report defaults to Amman today,keeps explicit session selection and Today shortcut at390',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.clock.setFixedTime(new Date('2026-11-02T22:30:00Z'));
 await page.goto('/e2e/package-f-financial-harness.html?view=reports');
 const from=page.getByLabel('من تاريخ',{exact:true}),to=page.getByLabel('إلى تاريخ',{exact:true});await expect(from).toHaveValue('2026-11-03');await expect(to).toHaveValue('2026-11-03');
 await from.fill('2026-10-01');await to.fill('2026-10-15');await page.getByRole('button',{name:'المصروفات',exact:true}).click();await page.getByRole('button',{name:'التقارير',exact:true}).click();await expect(from).toHaveValue('2026-10-01');await expect(to).toHaveValue('2026-10-15');
 await page.reload();await expect(from).toHaveValue('2026-10-01');await expect(to).toHaveValue('2026-10-15');await page.getByRole('button',{name:'اليوم',exact:true}).click();await expect(from).toHaveValue('2026-11-03');await expect(to).toHaveValue('2026-11-03');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('customer search precedes debt summary,visible390 and focuses only after deliberate tap',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto('/e2e/package-f-customers-harness.html');const search=page.getByLabel('البحث في العملاء');await expect(search).toBeInViewport();await expect(search).not.toBeFocused();
 const summary=page.getByTestId('customer-aging-summary');expect(await search.evaluate((e,summary)=>Boolean(e.compareDocumentPosition(document.querySelector(summary)!)&Node.DOCUMENT_POSITION_FOLLOWING),'[data-testid="customer-aging-summary"]')).toBe(true);await expect(summary).toBeAttached();
 await search.click();await expect(search).toBeFocused();await search.fill('غير موجود');await expect(page.getByText('لا يوجد عملاء مطابقون',{exact:false})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
