import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {SEO_BRAND} from '../customer-web/src/config/seoBrand';
import {execFileSync} from 'node:child_process';
import {storeIdentityPins,sourceBeforeStoreIdentity} from '../scripts/audit/source-before-store-sharing-identity.mjs';

test('share image is 1200x630 JPEG below300KB and original square logo is byte-identical',()=>{
 const jpeg=readFileSync('customer-web/public/nawasrah-social-card.jpg');assert.ok(jpeg.length<300_000);
 let i=2,dimensions:number[]=[];
 while(i<jpeg.length){assert.equal(jpeg[i],255);const marker=jpeg[i+1],length=jpeg.readUInt16BE(i+2);if([192,193,194].includes(marker)){dimensions=[jpeg.readUInt16BE(i+7),jpeg.readUInt16BE(i+5)];break;}i+=2+length;}
 assert.deepEqual(dimensions,[1200,630]);
 assert.equal(createHash('sha256').update(readFileSync('customer-web/public/nawasrah-logo-square.png')).digest('hex'),'10160ee26ebc78fcd2b2d40830fc533b4eee55c9f04d0184cf6dc625936a57c0');
 assert.equal(SEO_BRAND.defaultImagePath,'/nawasrah-social-card.jpg');assert.equal(SEO_BRAND.logoImagePath,'/nawasrah-store-logo.jpg');
});
test('reproducible card contains approved text and symbol crop,no phone or external dependency',()=>{
 const source=readFileSync('customer-web/brand/social-card.html','utf8');
 for(const text of ['النواصرة','لتجارة الجملة والمواد الغذائية','مواد غذائية ومشروبات بالجملة — الرمثا'])assert.ok(source.includes(text));
 assert.ok(source.includes('left:-125px;top:-110px'));assert.ok(source.includes('height:330px'));
 assert.doesNotMatch(source,/محلات|https?:|07\d{8}|\+962/u);
 const generator=readFileSync('customer-web/scripts/generate-social-card.mjs','utf8');assert.ok(generator.includes("from 'playwright'"));assert.ok(generator.includes('route.abort()'));
});
test('active UI/manifest/receipt/Telegram text has no old store name;PWA short name remains permitted',()=>{
 const roots=['src','customer-web/src'];let checked=0;
 function walk(dir:string){for(const entry of readdirSync(dir,{withFileTypes:true})){const file=dir+'/'+entry.name;if(entry.isDirectory())walk(file);else if(/\.(tsx?|html)$/u.test(file)){assert.doesNotMatch(readFileSync(file,'utf8'),/محلات النواصرة(?: التجارية)?|مستخدم نواصرة/u,file);checked++;}}}
 roots.forEach(walk);assert.ok(checked>300);
 for(const file of ['index.html','customer-web/index.html','public/manifest.webmanifest','customer-web/public/site.webmanifest','automation/n8n/workflows/frankfurt-owner-business-alerts.json']){const source=readFileSync(file,'utf8');assert.ok(source.includes(SEO_BRAND.officialName),file);assert.doesNotMatch(source,/محلات النواصرة(?: التجارية)?/u,file);}
});
test('exact identity adapter preserves every prior source byte and rejects extra UI/auth edits',()=>{
 for(const [file] of Object.entries(storeIdentityPins)){
  const before=execFileSync('git',['show','f95ff0458f90298edc21e39859d3268c7f7ccac7:'+file],{encoding:'utf8',maxBuffer:8*1024**2}).replaceAll('\r\n','\n');
  const source=readFileSync(file,'utf8');assert.equal(sourceBeforeStoreIdentity(file,source),before,file);
  if(file.startsWith('src/')||file.startsWith('customer-web/'))assert.throws(()=>sourceBeforeStoreIdentity(file,source+'\nvoid unapproved;'),/HANDOVER214_UNREVIEWED_SOURCE:STORE_IDENTITY/u);
 }
 assert.equal(execFileSync('git',['diff','--name-only','f95ff0458f90298edc21e39859d3268c7f7ccac7','--','supabase','scripts/audit/*-hunks.json','scripts/audit/*-inverse.json'],{encoding:'utf8'}).trim(),'');
});
