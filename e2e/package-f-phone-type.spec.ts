import AxeBuilder from '@axe-core/playwright';
import {test,expect,type Page} from './isolated-test';
import {checkLayout} from './package-f-layout';
import {analyzePackageFAccessibility,waitForPackageFMotion} from './package-f-accessibility';

const screens=[
  ['home',''],['orders',''],['pos',''],['inventory',''],['cash',''],['customers',''],
  ['more',''],['products',''],['purchasing',''],['financial',''],['administration',''],
  ['auth-assistant','&view=assistant'],['auth-assistant','&view=login'],
  ['administration','&view=settings'],['administration','&view=monitoring'],
  ['administration','&view=promotions'],['more','&view=profile'],
] as const;

async function smallVisibleText(page:Page) {
  return page.locator('body').evaluate(root=>{
    const small:string[]=[],walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
    while(walker.nextNode()) {
      const node=walker.currentNode,parent=node.parentElement;
      if(!parent||!node.textContent?.trim()||parent.closest('script,style,option,.sr-only,[inert],[aria-hidden="true"]'))continue;
      const style=getComputedStyle(parent);
      if(style.visibility!=='visible'||!parent.getClientRects().length)continue;
      let hidden=false;
      for(let ancestor:Element|null=parent;ancestor;ancestor=ancestor.parentElement) {
        if(ancestor instanceof HTMLDetailsElement&&!ancestor.open) {
          const summary=Array.from(ancestor.children).find(child=>child.tagName==='SUMMARY');
          if(!summary?.contains(parent)){hidden=true;break;}
        }
      }
      if(!hidden&&parseFloat(style.fontSize)<12)small.push(`${node.textContent!.trim().slice(0,65)}:${style.fontSize}:${parent.className}`);
    }return small;
  });
}

for(const theme of ['light','dark'])for(const [screen,extra] of screens) {
  test(`phone type ${theme} ${screen}${extra}: functional text12px,axe and no clipping`,async({page})=>{
    await page.setViewportSize({width:390,height:900});
    await page.goto(`/e2e/package-f-${screen}-harness.html?theme=${theme}${extra}`);
    await waitForPackageFMotion(page);
    await page.evaluate(()=>document.fonts.ready);
    const result=await analyzePackageFAccessibility(page,new AxeBuilder({page}));
    expect(result.violations.filter(v=>v.impact==='serious'||v.impact==='critical')).toEqual([]);
    await checkLayout(page,page.locator('body'));
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect(await smallVisibleText(page)).toEqual([]);
  });
}

for(const theme of ['light','dark'])test(`phone typography floor ${theme} preserves tablet larger text,desktop and print`,async({page})=>{
  await page.goto(`/e2e/package-f-auth-assistant-harness.html?theme=${theme}&view=assistant`);
  await page.evaluate(()=>{
    const probe=document.createElement('div');probe.id='type-proof';
    probe.innerHTML='<span class="text-[9px]">small</span><span class="text-[11px] sm:text-sm">responsive</span><span class="text-[16px]">larger</span><span class="text-[0.55em]">currency</span>';
    document.body.append(probe);
  });
  const sizes=()=>page.locator('#type-proof span').evaluateAll(es=>es.map(e=>getComputedStyle(e).fontSize));
  // Vite bundles imported CSS into index.css. Toggle ONLY the two phone-type
  // media blocks in its real CSSOM,not the combined stylesheet or any token.
  const phoneRules=await page.evaluate(()=>{
    const matches:Array<{sheet:number;index:number;css:string;media:string}>=[];
    Array.from(document.styleSheets).forEach((sheet,sheetIndex)=>{
      Array.from(sheet.cssRules).forEach((rule,index)=>{
        if(!(rule instanceof CSSMediaRule))return;
        const selectors=Array.from(rule.cssRules).map(child=>child instanceof CSSStyleRule?child.selectorText:'').join(' ');
        if(selectors.includes('.text-\\[8px\\]')
          && (selectors.includes('.text-\\[0\\.55em\\]')||selectors.includes('.sm\\:text-sm'))) {
          matches.push({sheet:sheetIndex,index,css:rule.cssText,media:rule.media.mediaText});
        }
      });
    });return matches;
  });
  expect(phoneRules).toHaveLength(2);
  const togglePhoneRules=(enabled:boolean)=>page.evaluate(({rules,enabled})=>{
    for(const item of rules) {
      const rule=document.styleSheets[item.sheet].cssRules[item.index];
      if(!(rule instanceof CSSMediaRule))throw Error('Phone CSSOM rule identity changed');
      rule.media.mediaText=enabled?item.media:'not all';
    }
  },{rules:phoneRules,enabled});
  await page.setViewportSize({width:390,height:900});expect(await sizes()).toEqual(['12px','12px','16px','12px']);
  await page.setViewportSize({width:820,height:900});expect(await sizes()).toEqual(['12px','14px','16px','12px']);
  for(const width of [1024,1440]) {
    await page.setViewportSize({width,height:900});
    await togglePhoneRules(false);const before=await sizes();
    await togglePhoneRules(true);expect(await sizes()).toEqual(before);
  }
  await page.setViewportSize({width:390,height:900});await page.emulateMedia({media:'print'});
  await togglePhoneRules(false);const beforePrint=await sizes();
  await togglePhoneRules(true);expect(await sizes()).toEqual(beforePrint);
  // Prove the control really removes this floor rather than silently doing
  // nothing;portrait fails the12px requirement without the two media blocks.
  await page.emulateMedia({media:'screen'});
  await togglePhoneRules(false);expect(parseFloat((await sizes())[0])).toBeLessThan(12);
  await togglePhoneRules(true);expect(await sizes()).toEqual(['12px','12px','16px','12px']);
});
