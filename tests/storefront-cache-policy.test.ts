import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';

function headersFor(text:string, route:string) {
 const headers:Record<string,string[]>={};let matches=false;
 for(const line of text.split(/\r?\n/u)){
  if(!line.trim()||line.trim().startsWith('#'))continue;
  if(!/^\s/u.test(line)){
   const expression=line.trim().split('*').map(value=>value.replace(/[.*+?^${}()|[\]\\]/gu,'\\$&')).join('.*');
   matches=new RegExp('^'+expression+'$','u').test(route);continue;
  }
  if(!matches)continue;
  const colon=line.indexOf(':');assert.ok(colon>0);
  const name=line.slice(0,colon).trim().toLowerCase(),value=line.slice(colon+1).trim();
  (headers[name]??=[]).push(value);
 }
 return headers;
}
test('Pages cache rules never join no-cache with immutable and retain every security directive',()=>{
 const text=readFileSync('customer-web/public/_headers','utf8');
 const before=execFileSync('git',['show','d102074583c7369502954eaf8ea70d2595f6a19c:customer-web/public/_headers'],{encoding:'utf8'});
 const assets=headersFor(text,'/assets/index-abcdefgh.js');assert.deepEqual(assets['cache-control'],['public, max-age=31536000, immutable']);
 for(const route of ['/','/index.html','/product/SPEED-0000/','/category/speed-0/','/products/','/about/','/offers/','/sw.js','/service-worker.js','/site.webmanifest','/nawasrah-environment.json','/sitemap.xml','/robots.txt','/nawasrah-hero-poster.webp','/nawasrah-hero-mobile.mp4'])assert.deepEqual(headersFor(text,route)['cache-control'],['no-cache'],route);
 for(const route of ['/','/assets/index-abcdefgh.js','/product/SPEED-0000/']){
  const security=(input:string)=>Object.fromEntries(Object.entries(headersFor(input,route)).filter(([name])=>name!=='cache-control'));
  assert.deepEqual(security(text),security(before),route);
 }
 assert.throws(()=>assert.deepEqual(headersFor('/*\n  Cache-Control: no-cache\n'+text,'/assets/index-abcdefgh.js')['cache-control'],assets['cache-control']),/Assertion/u,'Pages joins duplicate headers; a broad cache rule is a real negative control');
});
