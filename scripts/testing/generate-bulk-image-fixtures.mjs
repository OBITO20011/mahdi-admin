// Synthetic pictures only;no files from the owner's business or network.
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..'),out=path.join(root,'tests/fixtures/bulk-images');
await mkdir(out,{recursive:true});
const browser=await chromium.launch();
try{
 const page=await browser.newPage();await page.route('**/*',route=>route.abort());
 for(const [mime,filename] of [['image/jpeg','landscape.jpg'],['image/png','sample.png'],['image/webp','sample.webp']]){
  const encoded=await page.evaluate(type=>{const canvas=document.createElement('canvas');canvas.width=80;canvas.height=40;const c=canvas.getContext('2d');c.fillStyle='#ff0000';c.fillRect(0,0,40,40);c.fillStyle='#0000ff';c.fillRect(40,0,40,40);return canvas.toDataURL(type,0.98).split(',')[1];},mime);
  const bytes=Buffer.from(encoded,'base64');await writeFile(path.join(out,filename),bytes);
  if(mime==='image/jpeg'){
   const exif=Buffer.from('ffe1002245786966000049492a0008000000010012010300010000000600000000000000','hex');
   await writeFile(path.join(out,'rotate90.jpg'),Buffer.concat([bytes.subarray(0,2),exif,bytes.subarray(2)]));
  }
 }
 console.log(JSON.stringify({ok:true,synthetic:true,fixtures:4,hostedCalls:0}));
}finally{await browser.close();}
