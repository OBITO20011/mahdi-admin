// Deterministic derivatives of the owner's approved artwork. Never redraw/crop it.
// Usage: node scripts/assets/generate-trial-brand.mjs SOURCE_PNG ARCHIVE_WEBP SHARP_MODULE
// SHARP_MODULE may be an absolute installed sharp entrypoint; no runtime dependency.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {copyFileSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const [source,banner,sharpModule='sharp']=process.argv.slice(2);
assert.ok(source&&banner,'Provide the approved square logo and archived wide banner.');
const sharp=createRequire(import.meta.url)(sharpModule);
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const digest=f=>createHash('sha256').update(readFileSync(f)).digest('hex');
const background='#f6eee3',assets=[];
async function output(relative,size,format='png',maskable=false){
 const target=path.join(root,relative);mkdirSync(path.dirname(target),{recursive:true});
 let pipeline=sharp(source).rotate().resize(size,size,{fit:'contain',background});
 if(maskable){const inner=Math.floor(size*0.55);pipeline=sharp(await sharp(source).rotate().resize(inner,inner,{fit:'contain',background}).png().toBuffer()).extend({top:Math.floor((size-inner)/2),bottom:Math.ceil((size-inner)/2),left:Math.floor((size-inner)/2),right:Math.ceil((size-inner)/2),background});}
 await (format==='jpg'?pipeline.jpeg({quality:92,chromaSubsampling:'4:4:4'}):pipeline.png({compressionLevel:9})).toFile(target);
 assets.push({file:relative,width:size,height:size,sha256:digest(target),maskable});
}
for(const app of ['public','customer-web/public']){
 mkdirSync(path.join(root,app),{recursive:true});copyFileSync(source,path.join(root,app,'nawasrah-logo-square.png'));
 assets.push({file:app+'/nawasrah-logo-square.png',sha256:digest(source),original:true});
 for(const size of [48,96,192,512])await output(`${app}/favicon-${size}.png`,size);
 await output(`${app}/apple-touch-icon.png`,180);await output(`${app}/nawasrah-store-logo.jpg`,750,'jpg');
 await output(`${app}/nawasrah-receipt-logo.png`,256);await output(`${app}/icons/maskable-512.png`,512,'png',true);
}
for(const size of [192,512])await output(`public/icons/admin-icon-${size}.png`,size);
await output('public/icons/apple-touch-icon-180.png',180);
const archived='docs/assets/archive/nawasrah-banner-wide.webp';copyFileSync(banner,path.join(root,archived));
writeFileSync(path.join(root,'docs/assets/TRIAL_BRAND_ASSETS.json'),JSON.stringify({sourceSha256:digest(source),sourceFile:'nawasrah-logo-square.png',policy:'Owner-approved artwork preserved;contain resize,no crop;maskable artwork in central55percent;wide banner archive only',archive:{file:archived,sha256:digest(banner)},assets},null,2)+'\n');
console.log(JSON.stringify({assets:assets.length,sourceSha256:digest(source),archiveOnly:archived}));
