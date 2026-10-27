import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import {chromium} from 'playwright';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const original=await readFile(path.join(root,'public/nawasrah-logo-square.png'));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
assert.equal(digest(original),'10160ee26ebc78fcd2b2d40830fc533b4eee55c9f04d0184cf6dc625936a57c0','APPROVED_LOGO_CHANGED');
const browser=await chromium.launch();
try{
 const page=await browser.newPage({viewport:{width:1200,height:630},deviceScaleFactor:1});
 await page.route('**/*',route=>route.request().url().startsWith('file:')?route.continue():route.abort());
 await page.goto(pathToFileURL(path.join(root,'brand/social-card.html')).href);
 await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(image=>image.decode()));});
 assert.equal(await page.locator('h1').innerText(),'النواصرة\nلتجارة الجملة والمواد الغذائية');
 const output=await page.screenshot({type:'jpeg',quality:90});
 assert(output.length<300_000,'SHARE_IMAGE_TOO_LARGE');
 await writeFile(path.join(root,'public/nawasrah-social-card.jpg'),output);
 assert.equal(digest(await readFile(path.join(root,'public/nawasrah-logo-square.png'))),digest(original));
 console.log(JSON.stringify({width:1200,height:630,bytes:output.length,sha256:digest(output),logoUnchanged:true}));
}finally{await browser.close();}
