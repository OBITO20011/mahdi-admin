import AxeBuilder from '@axe-core/playwright';
import {test,expect} from './isolated-test';
import {analyzePackageFAccessibility,waitForPackageFMotion} from './package-f-accessibility';
import {staffRows} from './package-f-administration.fixture';
import {checkLayout} from './package-f-layout';

for(const theme of ['light','dark'])test(`axe waits for paused native Users CSS transitions ${theme}`,async({page})=>{
 await page.goto(`/e2e/package-f-administration-harness.html?theme=${theme}`);
 await expect(page.getByText('أحمد النواصرة',{exact:true})).toBeVisible();
 await waitForPackageFMotion(page);
 await checkLayout(page,page.getByTestId('administration-workbench'));
 // Fixture-only duration control allows deterministic pausing in both browsers.
 // No product,timeout,retry or contrast-rule change.
 await page.addStyleTag({content:'button {transition-duration: 10s !important}'});
 const evidence=await page.evaluate(async()=>{
  const button=Array.from(document.querySelectorAll('button')).find(e=>e.textContent?.includes('فريق العمل ('))!;
  const audit=Array.from(document.querySelectorAll('button')).find(e=>e.textContent?.includes('سجل الأمان ('))!;
  void getComputedStyle(button).color;
  audit.click();await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
  const animations=button.getAnimations();
  const state=window as typeof window & {waitObserved?:boolean;releaseTransitions?:()=>void};
  for(const animation of animations){
   animation.pause();animation.currentTime=Number(animation.effect!.getTiming().duration)*.5;
   const finished=animation.finished;
   Object.defineProperty(animation,'finished',{get(){state.waitObserved=true;return finished;}});
  }
  state.releaseTransitions=()=>{for(const animation of animations)animation.finish();};
  return {properties:animations.map(a=>a instanceof CSSTransition?a.transitionProperty:'animation'),color:getComputedStyle(button).color,background:getComputedStyle(button).backgroundColor};
 });
 expect(evidence.properties).toContain('color');expect(evidence.properties).toContain('background-color');
 const builder=new AxeBuilder({page}),original=builder.analyze.bind(builder);let analyses=0;
 builder.analyze=async()=>{analyses++;return original();};
 const pending=analyzePackageFAccessibility(page,builder);
 await expect.poll(()=>page.evaluate(()=>(window as typeof window & {waitObserved?:boolean}).waitObserved??false)).toBe(true);
 expect(analyses,'axe must not inspect a paused,unfinished CSS transition').toBe(0);
 await page.evaluate(()=>(window as typeof window & {releaseTransitions?:()=>void}).releaseTransitions?.());
 const result=await pending;
 expect(analyses).toBe(1);
 expect(result.violations.filter(v=>v.impact==='serious'||v.impact==='critical')).toEqual([]);
 const final=await page.getByRole('button',{name:`فريق العمل (${staffRows.length})`,exact:true}).evaluate(button=>{
  const fg=getComputedStyle(button).color,bg=getComputedStyle(button.parentElement!).backgroundColor;
  const lum=(s:string)=>s.match(/[\d.]+/gu)!.slice(0,3).map(Number).map(c=>{const n=c/255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;}).reduce((s,n,i)=>s+n*[.2126,.7152,.0722][i],0);
  const a=lum(fg),b=lum(bg);return {fg,bg,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
 });
 console.info('USERS_SETTLED_CONTRAST '+JSON.stringify({theme,held:evidence,final}));
 expect(final.ratio).toBeGreaterThanOrEqual(4.5);
});

test('settled real low contrast is still reported,never excluded by the shared helper',async({page})=>{
 await page.setContent('<!doctype html><html lang="en"><head><title>Contrast control</title></head><body><main><h1>Control</h1><p style="color:#eee;background:#fff">This settled text must fail contrast.</p></main></body></html>');
 const result=await analyzePackageFAccessibility(page);
 await checkLayout(page,page.locator('main'));
 expect(result.violations.filter(v=>v.id==='color-contrast'&&v.impact==='serious')).toHaveLength(1);
});
