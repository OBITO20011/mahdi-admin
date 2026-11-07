import assert from 'node:assert/strict';
import {readFile, stat} from 'node:fs/promises';
import path from 'node:path';
import {gzipSync} from 'node:zlib';
import ts from 'typescript';

// Fixed cold-entry budgets plus a separate cap for the deferred mobile hero video.
export const storefrontBudget = Object.freeze({initialJsBytes: 700_000, initialJsGzip: 200_000, cssGzip: 19_000, fonts: 0, initialScriptRequests: 5, mobileHeroVideoBytes: 1_000_000});
export async function measureStorefrontBudget(dist) {
  const root = path.resolve(dist), html = await readFile(path.join(root,'index.html'),'utf8');
  const resolve = (specifier, parent = path.join(root,'index.html')) => {
    assert.ok(!/^(?:https?:|data:|\/\/)/u.test(specifier),'STOREFRONT_EXTERNAL_INITIAL_ASSET');
    const file = specifier.startsWith('/') ? path.resolve(root,'.'+specifier) : path.resolve(path.dirname(parent),specifier);
    assert.ok(file.startsWith(root+path.sep),'STOREFRONT_ASSET_OUTSIDE_DIST');
    return file;
  };
  const entries = [...html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)=["']([^"']+\.js)["'][^>]*>/gu)].map(match=>resolve(match[1]));
  assert.ok(entries.length,'STOREFRONT_ENTRY_REQUIRED');
  const seen = new Set(), chunks = [];
  async function visit(file) {
    if(seen.has(file))return;
    seen.add(file);
    const bytes = await readFile(file), source = ts.createSourceFile(file,bytes.toString('utf8'),ts.ScriptTarget.Latest,false,ts.ScriptKind.JS);
    chunks.push({file:path.relative(root,file).replaceAll('\\','/'),bytes:bytes.length,gzip:gzipSync(bytes).length});
    for(const statement of source.statements)if((ts.isImportDeclaration(statement)||ts.isExportDeclaration(statement))&&statement.moduleSpecifier&&ts.isStringLiteral(statement.moduleSpecifier))await visit(resolve(statement.moduleSpecifier.text,file));
  }
  for(const file of entries)await visit(file);
  const css = [...html.matchAll(/<link\b[^>]*href=["']([^"']+\.css)["'][^>]*>/gu)].map(match=>resolve(match[1]));
  let cssGzip = 0, fonts = 0;
  for(const file of css){const bytes=await readFile(file);cssGzip+=gzipSync(bytes).length;fonts+=[...bytes.toString('utf8').matchAll(/url\([^)]*\.(?:woff2?|ttf|otf)[^)]*\)/gu)].length;}
  const mobileHeroVideo = await stat(path.join(root, 'nawasrah-hero-mobile.mp4'));
  assert.ok(mobileHeroVideo.isFile() && mobileHeroVideo.size > 0, 'STOREFRONT_MOBILE_HERO_VIDEO_REQUIRED');
  const mobileHeroVideoBytes = mobileHeroVideo.size;
  return {chunks,mobileHeroVideoBytes,initialJsBytes:chunks.reduce((sum,item)=>sum+item.bytes,0),initialJsGzip:chunks.reduce((sum,item)=>sum+item.gzip,0),cssGzip,fonts,initialScriptRequests:chunks.length};
}
export function assertStorefrontBudget(report) {
  for(const [key,limit]of Object.entries(storefrontBudget))assert.ok(report[key]<=limit,`STOREFRONT_BUDGET_${key}:${report[key]}>${limit}`);
  return report;
}
export const storefrontRequestBudget = Object.freeze({home: {rpc:4,total:45},category: {rpc:3,total:80},product: {rpc:4,total:65},cart: {rpc:3,total:65}});
export function assertStorefrontRequests(page, report) {
  const limit=storefrontRequestBudget[page];assert.ok(limit,'STOREFRONT_UNKNOWN_PAGE');
  assert.ok(report.rpc<=limit.rpc,`STOREFRONT_RPC_REQUEST_BUDGET:${page}:${report.rpc}>${limit.rpc}`);
  assert.ok(report.total<=limit.total,`STOREFRONT_TOTAL_REQUEST_BUDGET:${page}:${report.total}>${limit.total}`);
  assert.equal(report.fonts,0,'STOREFRONT_UNEXPECTED_FONT_REQUEST');
}
export function storefrontBudgetPlugin() {
  let dist;
  return {name:'nawasrah-storefront-budget',apply:'build',configResolved(config){dist=path.resolve(config.root,config.build.outDir);},async closeBundle(){const report=assertStorefrontBudget(await measureStorefrontBudget(dist));console.log(JSON.stringify({storefrontBudget:report}));}};
}

