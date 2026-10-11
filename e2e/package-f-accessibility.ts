import AxeBuilder from '@axe-core/playwright';
import type {Page} from './isolated-test';

// CSS transitions are native Animations too. Inspect settled rendering without
// disabling a rule or excluding a node. Preserve existing include/tag choices.
export async function waitForPackageFMotion(page:Page){
 return page.evaluate(async()=>{
  await document.fonts.ready;
  const startedAt=performance.now(),limitMs=5000;
  for(;;){
   await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
   const active=document.getAnimations().filter(animation=>{
    const finite=animation.effect instanceof KeyframeEffect&&animation.effect.getTiming().iterations!==Infinity;
    return finite&&(animation.pending||animation.playState==='running'||animation.playState==='paused');
   });
   const waitedMs=performance.now()-startedAt;
   if(!active.length)return waitedMs;
   if(waitedMs>=limitMs){
    const stuck=active.map(animation=>{
     const target=(animation.effect as KeyframeEffect).target;
     return {element:target instanceof Element?target.tagName+(target.id?'#'+target.id:''):String(target),
      property:animation instanceof CSSTransition?animation.transitionProperty:animation instanceof CSSAnimation?animation.animationName:'animation',
      playState:animation.playState,pending:animation.pending,currentTime:String(animation.currentTime)};
    });
    throw new Error('PACKAGE_F_MOTION_STUCK '+JSON.stringify({limitMs,waitedMs,stuck}));
   }
   // Re-discover native state on rendered frames: a captured finished promise
   // can remain pending after a CSS transition has actually finished.
   // Paused finite motion still blocks; infinite indicators remain axe targets.
  }
 });
}

export async function analyzePackageFAccessibility(page:Page,builder=new AxeBuilder({page})){
 const waitedMs=await waitForPackageFMotion(page);
 console.info('PACKAGE_F_MOTION_WAIT '+JSON.stringify({waitedMs}));
 return builder.analyze();
}
