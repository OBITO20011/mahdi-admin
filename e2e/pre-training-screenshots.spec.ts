import {test,expect} from './isolated-test';
for(const view of ['reports','customers'])test(`pretraining ${view} synthetic390 screenshot`,async({page},info)=>{
 await page.setViewportSize({width:390,height:844});await page.clock.setFixedTime(new Date('2026-11-02T22:30:00Z'));
 await page.goto(view==='reports'?'/e2e/package-f-financial-harness.html?view=reports':'/e2e/package-f-customers-harness.html');
 await expect(page.getByRole('heading',{name:view==='reports'?'التقارير والحسابات':'العملاء والذمم',exact:true})).toBeVisible();
 if(view==='customers')await expect(page.getByLabel('البحث في العملاء')).toBeVisible();else await expect(page.getByRole('button',{name:'طباعة / PDF'})).toBeEnabled();
 await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:info.outputPath(view+'-390.png'),fullPage:true});
});
