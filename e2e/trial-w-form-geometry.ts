import {expect,type Page} from './isolated-test';

export async function fieldGeometry(page:Page){
  for(const dialog of await page.getByRole('dialog').filter({visible:true}).all()){
    if(await dialog.getAttribute('data-state')!==null)await expect(dialog).toHaveAttribute('data-state','open');
  }
  await page.evaluate(()=>document.fonts.ready);
  const bad=await page.locator('.nw-form-fields').evaluateAll(roots=>[...new Set(roots.flatMap(root=>Array.from(root.querySelectorAll('input,select,textarea'))))]
    .filter((node):node is HTMLInputElement=>node instanceof HTMLInputElement||node instanceof HTMLSelectElement||node instanceof HTMLTextAreaElement)
    .filter(node=>!['checkbox','radio','range','file','hidden','search'].includes(node.type)&&node.getBoundingClientRect().height>0)
    .flatMap(node=>{const rect=node.getBoundingClientRect(),style=getComputedStyle(node),parent=node.parentElement;
      const label=parent?.tagName==='LABEL'?parent:null;
      return rect.height<44||rect.width<44||Number.parseFloat(style.borderTopWidth)<1||
        node.tagName==='TEXTAREA'&&rect.height<96||label&&(getComputedStyle(label).flexDirection!=='column'||rect.width<label.clientWidth-2)
        ?[{field:node.getAttribute('aria-label')??parent?.textContent?.slice(0,40),height:rect.height,width:rect.width,border:style.borderTopWidth}]:[];}));
  expect(bad).toEqual([]);
  if((page.viewportSize()?.width??1440)<=767){
    const small=await page.locator('input,select,textarea').evaluateAll(nodes=>nodes.filter(node=>node.getBoundingClientRect().height>0&&Number.parseFloat(getComputedStyle(node).fontSize)<16).map(node=>({field:node.getAttribute('aria-label')??node.getAttribute('name'),font:getComputedStyle(node).fontSize})));
    expect(small).toEqual([]);
    const keyboards=await page.locator('input[type="number"]').evaluateAll(nodes=>nodes.filter(node=>node.getBoundingClientRect().height>0&&(!['numeric','decimal'].includes(node.getAttribute('inputmode')??'')||!node.getAttribute('enterkeyhint'))).map(node=>node.outerHTML));
    expect(keyboards).toEqual([]);
    const clippedNative=await page.locator('.nw-form-fields select:not([multiple])').evaluateAll(nodes=>nodes.filter(node=>getComputedStyle(node).appearance!=='none').map(node=>node.outerHTML));
    expect(clippedNative).toEqual([]);
  }
}

/** WebKit emulation: preserve zoom permission and layout across focus and a
 * keyboard-sized viewport. Actual iPhone keyboard remains an owner device check. */
export async function focusWithKeyboardSpace(page:Page){
  const viewport=page.viewportSize()!;
  const zoom=await page.evaluate(()=>visualViewport?.scale??1);
  const fields=page.locator('input:not([type="hidden"]):not([type="file"]):not([type="checkbox"]):not([type="radio"]),textarea').filter({visible:true});
  if(await fields.count())await fields.last().focus();
  await page.setViewportSize({width:390,height:500});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(await page.evaluate(()=>visualViewport?.scale??1)).toBe(zoom);
  const meta=await page.locator('meta[name="viewport"]').getAttribute('content');
  expect(meta??'').not.toMatch(/maximum-scale|user-scalable\s*=\s*(?:no|0)/i);
  await page.setViewportSize(viewport);
}
