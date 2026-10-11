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
 await page.getByRole('button',{name:`فريق العمل (${staffRows.length})`,exact:true}).evaluate(button=>button.setAttribute('data-motion-control','users'));
 await page.addStyleTag({content:'button[data-motion-control="users"] {transition-duration: 10s !important}'});
 const evidence=await page.evaluate(async()=>{
  const button=Array.from(document.querySelectorAll('button')).find(e=>e.textContent?.includes('فريق العمل ('))!;
  const audit=Array.from(document.querySelectorAll('button')).find(e=>e.textContent?.includes('سجل الأمان ('))!;
  void getComputedStyle(button).color;
  audit.click();await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
  const animations=button.getAnimations();
  const state=window as typeof window & {waitObserved?:boolean;releaseTransitions?:()=>void;nativeTransitions?:Animation[]};
  state.nativeTransitions=animations;
  for(const animation of animations){
   animation.pause();animation.currentTime=Number(animation.effect!.getTiming().duration)*.5;
  }
  const getAnimations=document.getAnimations.bind(document);
  document.getAnimations=()=>{state.waitObserved=true;return getAnimations();};
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
 expect(await page.evaluate(()=>(window as typeof window & {nativeTransitions?:Animation[]}).nativeTransitions!.every(animation=>animation.playState==='finished'))).toBe(true);
 expect(result.violations.filter(v=>v.impact==='serious'||v.impact==='critical')).toEqual([]);
 const final=await page.getByRole('button',{name:`فريق العمل (${staffRows.length})`,exact:true}).evaluate(button=>{
  const fg=getComputedStyle(button).color,bg=getComputedStyle(button.parentElement!).backgroundColor;
  const lum=(s:string)=>s.match(/[\d.]+/gu)!.slice(0,3).map(Number).map(c=>{const n=c/255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;}).reduce((s,n,i)=>s+n*[.2126,.7152,.0722][i],0);
  const a=lum(fg),b=lum(bg);return {fg,bg,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
 });
 console.info('USERS_SETTLED_CONTRAST '+JSON.stringify({theme,held:evidence,final}));
 expect(final.ratio).toBeGreaterThanOrEqual(4.5);
});

for(const theme of ['light','dark'])test(`unintended button with long running motion fails the guard ${theme}`,async({page})=>{
 await page.setContent('<!doctype html><html lang="en"><head><title>Unintended motion control</title><style>#unintended-motion{color:#111;transition:color 10s}#unintended-motion.changed{color:#222}</style></head><body><main><h1>Control</h1><button id="asserted-control">Intended control</button><button id="unintended-motion">Other control</button></main></body></html>');
 await waitForPackageFMotion(page);
 await page.evaluate(async()=>{
  const button=document.getElementById('unintended-motion')!;
  void getComputedStyle(button).color;button.classList.add('changed');
  await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
  if(!button.getAnimations().some(animation=>animation instanceof CSSTransition&&animation.transitionProperty==='color'&&animation.playState==='running'))throw new Error('MISSING_UNINTENDED_RUNNING_TRANSITION');
 });
 const builder=new AxeBuilder({page}),original=builder.analyze.bind(builder);let analyses=0;
 builder.analyze=async()=>{analyses++;return original();};
 await expect(analyzePackageFAccessibility(page,builder)).rejects.toThrow(/PACKAGE_F_MOTION_STUCK.*"limitMs":5000.*BUTTON#unintended-motion.*"property":"color".*"playState":"running"/u);
 expect(analyses,'unintended long motion must fail closed without running axe').toBe(0);
});

for(const theme of ['light','dark'])test(`axe waits for native state despite a stale finished promise ${theme}`,async({page})=>{
 await page.setContent('<!doctype html><html lang="en"><head><title>Native motion control</title><style>button{color:#eee;background:#fff;transition:color 10s}button.settled{color:#111}</style></head><body><main><h1>Control</h1><button>Native transition</button></main></body></html>');
 await waitForPackageFMotion(page);
 await page.evaluate(async()=>{
  const button=document.querySelector('button')!;
  void getComputedStyle(button).color;
  button.classList.add('settled');
  await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
  const animations=button.getAnimations();
  if(!animations.some(animation=>animation instanceof CSSTransition&&animation.transitionProperty==='color'))throw new Error('MISSING_NATIVE_COLOR_TRANSITION');
  const state=window as typeof window & {waitObserved?:boolean;releaseTransitions?:()=>void;nativeTransitions?:Animation[]};
  state.nativeTransitions=animations;
  for(const animation of animations){
   animation.pause();animation.currentTime=Number(animation.effect!.getTiming().duration)*.5;
   Object.defineProperty(animation,'finished',{get:()=>new Promise<Animation>(()=>{})});
  }
  const getAnimations=document.getAnimations.bind(document);
  document.getAnimations=()=>{state.waitObserved=true;return getAnimations();};
  state.releaseTransitions=()=>{for(const animation of animations)animation.finish();};
 });
 const builder=new AxeBuilder({page}),original=builder.analyze.bind(builder);let analyses=0;
 builder.analyze=async()=>{analyses++;return original();};
 const pending=analyzePackageFAccessibility(page,builder);
 await expect.poll(()=>page.evaluate(()=>(window as typeof window & {waitObserved?:boolean}).waitObserved??false)).toBe(true);
 expect(analyses,'a stale promise must not permit analysis of paused motion').toBe(0);
 await page.evaluate(()=>(window as typeof window & {releaseTransitions?:()=>void}).releaseTransitions?.());
 const result=await pending;
 expect(analyses).toBe(1);
 expect(await page.evaluate(()=>(window as typeof window & {nativeTransitions?:Animation[]}).nativeTransitions!.every(animation=>animation.playState==='finished'))).toBe(true);
 expect(await page.locator('button').evaluate(button=>getComputedStyle(button).color)).toBe('rgb(17, 17, 17)');
 expect(result.violations.filter(v=>v.impact==='serious'||v.impact==='critical')).toEqual([]);
});

test('paused native motion fails closed at the frame deadline with actionable evidence',async({page})=>{
 await page.setContent('<!doctype html><html lang="en"><head><title>Paused motion</title><style>button{color:#111;transition:color 10s}button.changed{color:#222}</style></head><body><main><h1>Control</h1><button id="paused-control">Paused transition</button></main></body></html>');
 await waitForPackageFMotion(page);
 await page.evaluate(async()=>{
  const button=document.querySelector('button')!;
  void getComputedStyle(button).color;button.classList.add('changed');
  await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
  const transitions=button.getAnimations();
  if(!transitions.some(animation=>animation instanceof CSSTransition&&animation.transitionProperty==='color'))throw new Error('MISSING_NATIVE_COLOR_TRANSITION');
  for(const animation of transitions){animation.pause();animation.currentTime=500;}
 });
 const builder=new AxeBuilder({page}),original=builder.analyze.bind(builder);let analyses=0;
 builder.analyze=async()=>{analyses++;return original();};
 await expect(analyzePackageFAccessibility(page,builder)).rejects.toThrow(/PACKAGE_F_MOTION_STUCK.*"limitMs":5000.*BUTTON#paused-control.*"property":"color".*"playState":"paused".*"currentTime":"500"/u);
 expect(analyses,'deadline failure must never silently run axe').toBe(0);
});

test('settled real low contrast is still reported,never excluded by the shared helper',async({page})=>{
 await page.setContent('<!doctype html><html lang="en"><head><title>Contrast control</title></head><body><main><h1>Control</h1><p style="color:#eee;background:#fff">This settled text must fail contrast.</p></main></body></html>');
 const result=await analyzePackageFAccessibility(page);
 await checkLayout(page,page.locator('main'));
 expect(result.violations.filter(v=>v.id==='color-contrast'&&v.impact==='serious')).toHaveLength(1);
});
