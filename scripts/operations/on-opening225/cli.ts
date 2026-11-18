import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,lstat,realpath} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {readProductWorkbook} from '../../../src/features/goLive/productWorkbook';
import {readXlsxSheet,writeXlsx} from '../../../src/lib/xlsx';
import {validReference} from '../go-live-files/check';
import {OWNER_CATALOG225_SHA256,openingCatalog225,ownerPriceRows225,ownerStockRows225,convertOpening225} from './model';

const root=path.resolve(import.meta.dirname,'../../..');
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
async function externalInput(file:string){
 const name=path.resolve(file),relative=path.relative(root,name);
 assert.ok(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative),'ON225_OWNER_INPUT_OUTSIDE_REPOSITORY_REQUIRED');
 const stat=await lstat(name);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=5*1024**2,'ON225_INPUT_FILE_REQUIRED');
 assert.equal(await realpath(name),name,'ON225_INPUT_LINK_REFUSED');return readFile(name);
}
async function privateOutput(folder:string){
 const output=path.resolve(folder);let parent=output;
 for(;;){try{await lstat(path.join(parent,'.git'));throw Error('ON225_OUTPUT_IN_REPOSITORY_REFUSED');}catch(e){if(e instanceof Error&&e.message==='ON225_OUTPUT_IN_REPOSITORY_REFUSED')throw e;}const next=path.dirname(parent);if(next===parent)break;parent=next;}
 await mkdir(output,{mode:0o700});assert.equal(await realpath(output),output,'ON225_OUTPUT_LINK_REFUSED');
 if(process.platform==='win32'){
  const user=execFileSync('whoami',[],{encoding:'utf8',windowsHide:true}).trim();
  execFileSync('icacls',[output,'/inheritance:r','/grant:r',user+':(OI)(CI)F','*S-1-5-32-544:(OI)(CI)F'],{windowsHide:true,stdio:'pipe'});
 }
 return output;
}
export async function runOpening225(args:string[],{expectedSourceSha=OWNER_CATALOG225_SHA256}={}){
 const options=new Map<string,string>();
 for(let i=0;i<args.length;i+=2){assert.ok(['--mode','--source','--filled','--reference','--output'].includes(args[i])&&args[i+1]&&!options.has(args[i]),'ON225_OPTIONS_INVALID');options.set(args[i],args[i+1]);}
 const mode=options.get('--mode');assert.ok(mode==='template'||mode==='convert','ON225_MODE_REQUIRED');
 for(const key of ['--source','--reference','--output'])assert.ok(options.get(key),'ON225_REQUIRED_OPTION:'+key);
 assert.equal(mode==='convert',options.has('--filled'),'ON225_FILLED_CONVERT_ONLY');
 const source=await externalInput(options.get('--source')!),before=hash(source);
 assert.equal(before,expectedSourceSha,'ON225_IMMUTABLE_SOURCE_SHA_MISMATCH');
 const reference=JSON.parse((await externalInput(options.get('--reference')!)).toString('utf8'));
 assert.ok(validReference(reference),'ON225_LOCAL_REFERENCE_INVALID');
 assert.equal(reference.products.length,0,'ON225_INITIAL_IMPORT_REQUIRES_EMPTY_PRODUCT_REFERENCE');
 const book=await readProductWorkbook(source),catalog=openingCatalog225(book.products,book.flavors,reference.units);
 const sourceProof={sha256:before,sourceFile:path.basename(options.get('--source')!),counts:{products:catalog.products.length,families:catalog.products.filter(p=>p.flavors.length).length,flavors:catalog.products.reduce((n,p)=>n+p.flavors.length,0),sellable:catalog.sellable.length}};
 const output=await privateOutput(options.get('--output')!);
 const save=(name:string,value:unknown)=>writeFile(path.join(output,name),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
 if(mode==='template'){
  await save('owner-workbook-input.json',{format:2,source:sourceProof,prices:ownerPriceRows225(catalog),stock:ownerStockRows225(catalog),units:reference.units,warehouses:reference.warehouses??[],settings:{defaultWarehouse:'',valuationThreshold:'0.100'}});
  await save('report.json',{ok:true,mode,offline:true,databaseWrites:0,source:sourceProof});
  console.log(JSON.stringify({ok:true,mode,offline:true,databaseWrites:0,counts:sourceProof.counts,output}));return 0;
 }
 const filled=await externalInput(options.get('--filled')!);
 const settingsSheet=await readXlsxSheet(filled,'الإعدادات');
 const settings=new Map(settingsSheet.slice(1).map(row=>[row[0],row[1]??'']));
 const result=convertOpening225(catalog,await readXlsxSheet(filled,'التكلفة'),await readXlsxSheet(filled,'الجرد'),{
  defaultWarehouse:settings.get('رمز المستودع الأساسي')??'',valuationThreshold:settings.get('حد تنبيه فرق التقييم (د.أ)')??'',
 },reference);
 const report={...result,source:sourceProof,filledSha256:hash(filled),offline:true,databaseWrites:0};
 if(report.ok){
  const productFile=writeXlsx([{name:'المنتجات',rows:result.productRows},{name:'النكهات',rows:result.flavorRows}]);
  await writeFile(path.join(output,'المنتجات.xlsx'),productFile,{flag:'wx',mode:0o600});
  const stockManifest=[];
  for(const[index,file]of result.stockFiles.entries()){
   const folder='المستودع-'+String(index+1).padStart(2,'0'),name=folder+'/البضاعة-الموجودة.xlsx';await mkdir(path.join(output,folder),{mode:0o700});
   const bytes=writeXlsx([{name:'البيانات',rows:file.rows}]);await writeFile(path.join(output,name),bytes,{flag:'wx',mode:0o600});
   stockManifest.push({warehouse:file.warehouse,file:name,sha256:hash(bytes),rows:file.rows.length-1});
  }
  await save('import-manifest.json',{sourceSha256:before,productFile:'المنتجات.xlsx',productSha256:hash(productFile),stock:stockManifest,order:['تعريف الوحدات والأقسام','استيراد المنتجات ومطابقتها','استيراد ملف كل مستودع من البضاعة الموجودة','عد الدرج0 ثم إنهاء البداية'],operatingMode:'full',migrationCeiling:225});
 }
 assert.equal(hash(await externalInput(options.get('--source')!)),before,'ON225_SOURCE_CHANGED_DURING_CONVERSION');
 await save('report.json',report);
 console.log(JSON.stringify({ok:report.ok,mode,offline:true,databaseWrites:0,counts:result.counts,errors:result.errors.length,warnings:result.warnings.length,output}));
 return report.ok?0:1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 runOpening225(process.argv.slice(2)).then(code=>{process.exitCode=code;}).catch(error=>{
  const code=/\bON225_[A-Z_]+/u.exec(String(error.message))?.[0]??'ON225_LOCAL_INPUT_OR_OUTPUT_FAILED';
  console.error(JSON.stringify({ok:false,code,offline:true,databaseWrites:0}));process.exitCode=2;
 });
}
