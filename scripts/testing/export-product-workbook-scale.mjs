// Local fixture authoring with the bundled public Artifact Tool API, never a DB.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';

const args=process.argv.slice(2);
assert.ok(args.length===4&&args[0]==='--model'&&args[2]==='--output','SCALE_EXPORT_FIXED_OPTIONS');
const model=JSON.parse(await fs.readFile(path.resolve(args[1]),'utf8'));
assert.equal(model.seed,0x5eed219);assert.equal(model.expected.parents,1000);assert.equal(model.expected.flavors,480);
const output=path.resolve(args[3]);
await fs.mkdir(output,{recursive:false});
const modules=process.env.NAWASRAH_ARTIFACT_MODULES??path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
await fs.symlink(modules,path.join(output,'node_modules'),process.platform==='win32'?'junction':'dir');
const dependency=createRequire(path.join(output,'fixture-author.mjs'));
const {Workbook,FileBlob,SpreadsheetFile}=await import(pathToFileURL(dependency.resolve('@oai/artifact-tool')));
const root=path.resolve(import.meta.dirname,'../..');
const columns=number=>{let s='';for(let n=number+1;n>0;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;};
const priceKeys=new Set(['sale_package_price','purchase_package_price','cost_per_base_unit','packet_price']);
const asNumber=(value,key)=>priceKeys.has(key)&&typeof value==='string'&&/^\d+(?:\.\d{1,3})?$/u.test(value)?Number(value):value;
const productKeys=model.columnKeys.products,flavorKeys=model.columnKeys.flavors;
const productsBook=async(sheets,name)=>{
  const wb=await SpreadsheetFile.importXlsx(await FileBlob.load(path.join(root,'docs/handover/templates/المنتجات.xlsx')));
  for(const [index,data]of sheets.entries()){
    const sheet=wb.worksheets.getItem(data.name);
    if(index===2)sheet.getUsedRange().unmerge();
    sheet.getUsedRange().clear({applyTo:'contents'});
    const keys=index===0?productKeys:index===1?flavorKeys:[];
    const rows=data.rows.map((r,i)=>r.map((v,c)=>i===0?v:asNumber(v,keys[c])));
    const end=columns(Math.max(...rows.map(r=>r.length))-1);
    sheet.getRange(`A1:${end}${rows.length}`).values=rows;
    sheet.getRange(`A1:${end}${rows.length}`).format.font={name:'Arial',size:11,color:'#24160B'};
    sheet.getRange(`A1:${end}${rows.length}`).format.verticalAlignment='center';
    sheet.getRange(`A1:${end}${rows.length}`).format.rowHeight=index===2?64:32;
    sheet.getRange(`A1:${end}${rows.length}`).format.wrapText=true;
    sheet.freezePanes.freezeRows(1);
    for(const [c,width]of (data.widths??[]).entries())sheet.getRange(`${columns(c)}1:${columns(c)}${rows.length}`).format.columnWidth=width;
    if(index<2){
      for(const[c,key]of keys.entries())sheet.getRange(`${columns(c)}2:${columns(c)}${rows.length}`).setNumberFormat(priceKeys.has(key)?'0.000':'@');
      sheet.getRange(`A1:${end}1`).format={fill:'#5B3E2B',font:{name:'Arial',size:11,bold:true,color:'#FFFFFF'},wrapText:true,rowHeight:64};
    }
    if(index===0){
      sheet.getRange(`D2:D${rows.length}`).dataValidation={rule:{type:'list',values:model.reference.categories.map(c=>c.name)}};
      for(const letter of ['E','F','H'])sheet.getRange(`${letter}2:${letter}${rows.length}`).dataValidation={rule:{type:'list',values:model.reference.units.map(u=>u.code)}};
      const method=columns(productKeys.indexOf('sale_method'));
      sheet.getRange(`${method}2:${method}${rows.length}`).dataValidation={rule:{type:'list',values:['طرد','باكيت مفرد','الاثنين']}};
    }
    if(index===2){
      sheet.getRange('A1:A20').format.columnWidth=72;
      sheet.getRange('B1:C20').format.columnWidth=3;
      sheet.getRange('D2:H4').values=[['الأقسام','الوحدات','وحدات الطرد','العلامات','المستودعات'],['شوكولاتة','PKT','CTN','علامة اختبار حجم وهمية','WH-MAIN'],['مشروبات وهمية','CTN','PKT','','']];
    }
  }
  wb.recalculate();
  for(const data of sheets){
    const end=data.name==='المنتجات'?'F':data.name==='النكهات'?'E':'A';
    const range=`A1:${end}${Math.min(7,data.rows.length)}`;
    const check=await wb.inspect({kind:'table',range:`'${data.name}'!${range}`,include:'values',tableMaxRows:7,tableMaxCols:6,maxChars:2200});
    await fs.writeFile(path.join(output,name+'-'+data.name+'-inspect.ndjson'),check.ndjson);
    if(process.env.NAWASRAH_SCALE_RENDER==='true'){
      const preview=await wb.render({sheetName:data.name,range:data.name==='تعليمات ومراجعة'?'A1:H7':range,scale:1.3,format:'png'});
      await fs.writeFile(path.join(output,name+'-'+data.name+'.png'),new Uint8Array(await preview.arrayBuffer()));
    }
  }
  await(await SpreadsheetFile.exportXlsx(wb)).save(path.join(output,name+'.xlsx'));
};
try{
  await productsBook(model.positive,'المنتجات-وهمي-1000');
  await productsBook(model.negative,'المنتجات-وهمي-أخطاء');
  for(const[name,sheets]of Object.entries(model.ancillary)){
    const wb=Workbook.create();
    for(const data of sheets){const sheet=wb.worksheets.add(data.name);const end=columns(data.rows[0].length-1);sheet.getRange(`A1:${end}${data.rows.length}`).values=data.rows;sheet.getRange(`A1:${end}${data.rows.length}`).format.columnWidth=28;sheet.getRange(`A1:${end}${data.rows.length}`).format.font={name:'Arial',size:11};sheet.getRange(`A1:${end}${data.rows.length}`).format.rowHeight=36;sheet.getRange(`A1:${end}${data.rows.length}`).format.wrapText=true;sheet.freezePanes.freezeRows(1);}
    wb.recalculate();await(await SpreadsheetFile.exportXlsx(wb)).save(path.join(output,name));
  }
  await fs.writeFile(path.join(output,'reference.json'),JSON.stringify(model.reference,null,2)+'\n');
  await fs.writeFile(path.join(output,'expected.json'),JSON.stringify({seed:model.seed,date:model.date,expected:model.expected,faults:model.faults,numericIdentifiers:model.numericIdentifiers},null,2)+'\n');
  console.log(JSON.stringify({ok:true,output,workbooks:5,seed:model.seed,parents:1000,flavors:480,network:false,databaseWrites:0}));
}catch(error){
  console.error(JSON.stringify({ok:false,code:'SCALE_EXPORT_FAILED',message:String(error?.message??'').slice(0,240)}));
  process.exitCode=1;
}finally{
  // Remove only our junction itself; never walk the bundled dependency target.
  const link=path.join(output,'node_modules');if((await fs.lstat(link)).isSymbolicLink())await fs.unlink(link);
}
