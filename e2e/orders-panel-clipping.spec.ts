import {test,expect} from './isolated-test';

for(const theme of ['light','dark'])for(const width of [820,1024,1440]){
 test(`Orders detail panel ${theme} ${width}: internal scroll reaches the final section`,async({page})=>{
  await page.setViewportSize({width,height:900});await page.goto(`/e2e/package-f-orders-harness.html?theme=${theme}&select&long`);
  const panel=page.getByTestId('order-detail-panel'),scroll=page.getByTestId('order-detail-scroll');
  await expect(panel).toBeVisible();await page.evaluate(()=>document.fonts.ready);
  // Challenge the real layout with all existing disclosure sections expanded.
  await panel.locator('details').evaluateAll(nodes=>nodes.forEach(node=>{(node as HTMLDetailsElement).open=true;}));
  const measured=await panel.evaluate(e=>{
   const box=e.getBoundingClientRect(),clip:string[]=[],walker=document.createTreeWalker(e,NodeFilter.SHOW_TEXT);
   while(walker.nextNode()){
    const node=walker.currentNode,p=node.parentElement;if(!p||!node.textContent?.trim()||p.closest('.sr-only,svg,style,option')||!p.getClientRects().length)continue;
    const range=document.createRange();range.selectNodeContents(node);
    // Vertical content may be offscreen inside the intended scroller; horizontal
    // text must remain within the panel, even when all disclosures are expanded.
    if(Array.from(range.getClientRects()).some(r=>r.width&&(r.left<box.left-2||r.right>box.right+2)))clip.push(node.textContent!.trim());
   }
   return {panel:[box.left,box.top,box.width,box.height],clip:Array.from(new Set(clip))};
  });console.info(JSON.stringify({event:'OrdersPanelGeometry',theme,width,...measured}));expect(measured.clip).toEqual([]);
  expect(await scroll.evaluate(e=>getComputedStyle(e).overflowY)).toBe('auto');
  await panel.scrollIntoViewIfNeeded();
  const primary=panel.getByRole('button',{name:'بدء التوصيل وتحديد وقت الوصول',exact:true});await primary.scrollIntoViewIfNeeded();await expect(primary).toBeInViewport();
  await scroll.evaluate(e=>{e.scrollTop=e.scrollHeight;});
  const last=panel.getByRole('heading',{name:'سجل حالة الطلب',exact:true});await expect(last).toBeInViewport();
  await expect(primary).toBeInViewport();
  const finalRow=last.locator('..').locator(':scope > div').last();await expect(finalRow).toBeInViewport();
  const bounds=await finalRow.evaluate(e=>{const r=e.getBoundingClientRect(),s=e.closest('[data-testid="order-detail-scroll"]')!.getBoundingClientRect();return {bottom:r.bottom,viewport:s.bottom};});
  expect(bounds.bottom).toBeLessThanOrEqual(bounds.viewport+1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 });
}
