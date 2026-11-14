import {test,expect} from './isolated-test';
import type {Locator} from '@playwright/test';
import {formatJod} from '../customer-web/src/utils/money';

test.describe.configure({retries:0});
const price=formatJod(1234750);
async function completePrice(locator:Locator,expected=price){
 await expect(locator).toBeVisible();
 const box=await locator.evaluate(element=>{
  let node=element as HTMLElement;
  while(node.clientWidth===0&&node.parentElement)node=node.parentElement;
  const range=document.createRange();range.selectNodeContents(element);
  const rects=[...range.getClientRects()];
  let left=0,right=innerWidth;
  for(let parent=element.parentElement;parent;parent=parent.parentElement){
   const style=getComputedStyle(parent);
   if(['hidden','clip','auto','scroll'].includes(style.overflowX)){
    const bounds=parent.getBoundingClientRect();left=Math.max(left,bounds.left);right=Math.min(right,bounds.right);
   }
  }
  return{text:element.textContent,width:node.clientWidth,scroll:node.scrollWidth,style:getComputedStyle(node).textOverflow,
   priceClipped:rects.some(rect=>rect.width>0&&(rect.left<left-1||rect.right>right+1))};
 });
 expect(box.text).toContain(expected);expect(box.width).toBeGreaterThan(0);
 expect(box.scroll).toBeLessThanOrEqual(box.width);expect(box.style).not.toBe('ellipsis');
 expect(box.priceClipped).toBe(false);
}
for(const width of [320,390,1280])for(const mode of ['OFF','ON']){
 test(`${mode} complete long prices across all product surfaces at ${width}`,async({page},info)=>{
  await page.setViewportSize({width,height:1000});const suffix=mode==='ON'?'&full':'';
  for(const columns of [4,1,2,3]){
   await page.goto(`/e2e/price-visibility-harness.html?view=cards&columns=${columns}${suffix}`);
   const prices=page.getByTestId('price-grid').getByText(price,{exact:true});await expect(prices).toHaveCount(4);
   await page.screenshot({path:info.outputPath(`cards-${width}-${mode}-${columns}.png`),fullPage:true});
   for(const item of await prices.all())await completePrice(item);
  }
  for(const view of ['details','cart','pos','admin']){
   await page.goto(`/e2e/price-visibility-harness.html?view=${view}${suffix}`);
   const expected=view==='pos'||view==='admin'?'1,234.750':price;
   const prices=page.getByText(expected,{exact:false});
   await expect(prices.first()).toBeVisible();
   for(const item of await prices.all())if(await item.isVisible())await completePrice(item,expected);
   await page.screenshot({path:info.outputPath(`${view}-${width}-${mode}.png`),fullPage:true});
  }
 });
}
