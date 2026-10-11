import AxeBuilder from '@axe-core/playwright';
import type {Page} from './isolated-test';

// CSS transitions are native Animations too. Inspect settled rendering without
// disabling a rule or excluding a node. Preserve existing include/tag choices.
export async function waitForPackageFMotion(page:Page){
 await page.evaluate(async()=>{
  await document.fonts.ready;
  for(;;){
   await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
   const active=document.getAnimations().filter(animation=>{
    const finite=animation.effect instanceof KeyframeEffect&&animation.effect.getTiming().iterations!==Infinity;
    return finite&&(animation.pending||animation.playState==='running'||animation.playState==='paused');
   });
   if(!active.length)return;
   // Cancellation may replace an animation;re-discover on the next frame.
   // Infinite loading indicators cannot settle;axe still inspects their nodes.
   await Promise.all(active.map(animation=>animation.finished.catch(()=>undefined)));
  }
 });
}

export async function analyzePackageFAccessibility(page:Page,builder=new AxeBuilder({page})){
 await waitForPackageFMotion(page);
 return builder.analyze();
}
