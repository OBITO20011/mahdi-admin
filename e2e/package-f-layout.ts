import {expect,type Page} from './isolated-test';

type Locator=ReturnType<Page['locator']>;

// Additive guard: existing per-screen containment/axe checks remain intact.
// Measure every clipping ancestor,not only the text's immediate box.
export async function checkLayout(page:Page,root:Locator){
 await page.evaluate(()=>document.fonts.ready);
 const clipped=await root.evaluate(element=>{
  const failures:string[]=[],walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT);
  while(walker.nextNode()){
   const node=walker.currentNode,parent=node.parentElement;
   if(!parent||!node.textContent?.trim()||parent.closest('.sr-only,option,script,style,svg')||!parent.getClientRects().length)continue;
   if(getComputedStyle(parent).visibility==='hidden')continue;
   // Closed native disclosures can retain Range geometry despite not painting.
   // Their summary remains visible and must still be checked (including nested details).
   let concealed=false;
   for(let a:HTMLElement|null=parent;a;a=a.parentElement){
    if(a instanceof HTMLDetailsElement&&!a.open){
     const summary=Array.from(a.children).find(child=>child.tagName==='SUMMARY');
     if(!summary?.contains(parent)){concealed=true;break;}
    }
    if(a===element)break;
   }
   if(concealed)continue;
   const range=document.createRange();range.selectNodeContents(node);
   for(const rect of range.getClientRects()){
    if(!rect.width||!rect.height)continue;
    let left=rect.left,right=rect.right,top=rect.top,bottom=rect.bottom;
    for(let ancestor:HTMLElement|null=parent;ancestor;ancestor=ancestor.parentElement){
     const style=getComputedStyle(ancestor),box=ancestor.getBoundingClientRect();
     const intentional=ancestor.classList.contains('truncate')||Array.from(ancestor.classList).some(c=>/^line-clamp-\d+$/u.test(c));
     if(intentional){
      // Intentional ellipsis/clamp may hide characters inside its own box,
      // but must not conceal the entire box escaping a higher clipping parent.
      left=Math.max(left,box.left);right=Math.min(right,box.right);
      top=Math.max(top,box.top);bottom=Math.min(bottom,box.bottom);
     }else{
      const clipX=['hidden','clip'].includes(style.overflowX),clipY=['hidden','clip'].includes(style.overflowY);
      if((clipX&&(left<box.left-2||right>box.right+2))||(clipY&&(top<box.top-3||bottom>box.bottom+3))){
       failures.push(`${node.textContent!.trim().slice(0,80)} clipped by ${ancestor.tagName.toLowerCase()}.${ancestor.className} ${JSON.stringify({ink:[left,top,right,bottom],clip:[box.left,box.top,box.right,box.bottom],overflow:[style.overflowX,style.overflowY]})}`);break;
      }
     }
     // Scrollable viewports deliberately expose only the current portion.
     // Check local hidden clipping first,then project visible ink before
     // inspecting outer shells;do not exempt any text inside that scroller.
     if(['auto','scroll'].includes(style.overflowX)){left=Math.max(left,box.left);right=Math.min(right,box.right);}
     if(['auto','scroll'].includes(style.overflowY)){top=Math.max(top,box.top);bottom=Math.min(bottom,box.bottom);}
     if(right<=left||bottom<=top)break;
     if(ancestor===element)break;
    }
   }
  }return failures;
 });expect(clipped,'Unintended text clipping through overflow-hidden/clip ancestors').toEqual([]);
}
