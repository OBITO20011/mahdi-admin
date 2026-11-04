import {readFile, stat, readdir, mkdir, writeFile, chmod, lstat} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {checkFiles,arabicReport,INPUT_FILES,type FileInput,type Kind,type ImageInput} from './check';

export async function run(argv:string[]) {
 const options=new Map<string,string>();for(let i=0;i<argv.length;i+=2){if(!['--folder','--reference','--images','--output','--no-opening-cheques'].includes(argv[i])||!argv[i+1]||options.has(argv[i]))throw new Error('CHECK_INPUT_OPTIONS_INVALID');options.set(argv[i],argv[i+1]);}
 const folder=path.resolve(options.get('--folder')??'');if(!options.has('--folder'))throw new Error('CHECK_FOLDER_REQUIRED');
 const inputs:Partial<Record<Kind,FileInput>>={};
 for(const kind of Object.keys(INPUT_FILES) as Kind[]){const file=path.join(folder,INPUT_FILES[kind]);try{const info=await lstat(file);if(!info.isFile()||info.isSymbolicLink()||info.size>5*1024**2)continue;inputs[kind]={name:INPUT_FILES[kind],bytes:await readFile(file)};}catch{/* Missing or unreadable file is reported without its content. */}}
 let reference:unknown=null;const ref=path.resolve(options.get('--reference')??path.join(folder,'reference.json'));
 try{const s=await stat(ref);if(s.isFile()&&s.size<=5*1024**2)reference=JSON.parse(await readFile(ref,'utf8'));}catch{/* Incomplete reference fails closed in report. */}
 let images:ImageInput[]|undefined;
 if(options.has('--images')){images=[];const imageRoot=path.resolve(options.get('--images')!);const dirs=[imageRoot];while(dirs.length){const dir=dirs.pop()!;const entries=await readdir(dir,{withFileTypes:true});for(const e of entries){const full=path.join(dir,e.name);if(e.isSymbolicLink())throw new Error('CHECK_IMAGE_LINK_REFUSED');if(e.isDirectory())dirs.push(full);else if(e.isFile()){images.push({name:e.name,size:(await stat(full)).size});if(images.length>500)throw new Error('CHECK_IMAGE_BATCH_OVER_500');}}}}
 const report=await checkFiles(inputs,reference,images,undefined,{noOpeningCheques:options.get('--no-opening-cheques')==='true'});
 const output=path.resolve(options.get('--output')??path.join(folder,'تقرير-الفحص-'+new Date().toISOString().replace(/[:.]/gu,'-')));
 // Never write a report into a checkout; it may contain owner financial totals.
 let parent=output;while(true){try{await lstat(path.join(parent,'.git'));throw new Error('CHECK_REPORT_IN_REPOSITORY_REFUSED');}catch(e){if(e instanceof Error&&e.message==='CHECK_REPORT_IN_REPOSITORY_REFUSED')throw e;}const next=path.dirname(parent);if(next===parent)break;parent=next;}
 await mkdir(output,{recursive:false,mode:0o700});
 if(process.platform==='win32'){const user=execFileSync('whoami',[],{encoding:'utf8',windowsHide:true}).trim();execFileSync('icacls',[output,'/inheritance:r','/grant:r',user+':(OI)(CI)F','*S-1-5-32-544:(OI)(CI)F'],{windowsHide:true,stdio:'pipe'});}else await chmod(output,0o700);
 await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
 await writeFile(path.join(output,'تقرير-الفحص.md'),arabicReport(report),{flag:'wx',mode:0o600});
 // Only fixed status/counts in terminal. Owner data stay in the protected report.
 console.log(JSON.stringify({ok:report.ok,errors:report.issues.filter(i=>i.severity==='error').length,incomplete:report.issues.filter(i=>i.severity==='incomplete').length,warnings:report.issues.filter(i=>i.severity==='warning').length,reportDirectory:output,databaseWrites:0,offline:true}));return report.ok?0:1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)run(process.argv.slice(2)).then(code=>{process.exitCode=code;}).catch(()=>{console.error(JSON.stringify({ok:false,code:'CHECK_LOCAL_INPUT_OR_REPORT_FAILED',offline:true,databaseWrites:0}));process.exitCode=2;});
