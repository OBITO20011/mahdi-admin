import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {lstatSync} from 'node:fs';
import {chmod, mkdir, mkdtemp, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const sha256 = value => createHash('sha256').update(value).digest('hex');
const inside = (parent, child) => {const relative=path.relative(parent,child);return !relative||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative));};
export function assertPrivateMapPath(target, dist) {
 assert.ok(!path.resolve(target).startsWith('\\\\'),'PRIVATE_MAPS_LOCAL_PATH_REQUIRED');
 assert.ok(!inside(path.resolve(dist),path.resolve(target)), 'PRIVATE_MAPS_PATH_INSIDE_DIST');
 for(let current=path.resolve(target);;current=path.dirname(current)){
  try {assert.ok(!lstatSync(current).isSymbolicLink(),'PRIVATE_MAPS_PATH_SYMLINK');}catch(error){if(error.code!=='ENOENT')throw error;}
  try {lstatSync(path.join(current,'.git'));assert.fail('PRIVATE_MAPS_PATH_INSIDE_GIT');}catch(error){if(error.code!=='ENOENT')throw error;}
  if(path.dirname(current)===current)break;
 }
}
export async function protectMapArchive(directory) {
 if(process.platform!=='win32'){await chmod(directory,0o700);return;}
 // A newly created empty directory only; no owner files or global ACL changes.
 const script=`$ErrorActionPreference='Stop'; $folder=$env:NAWASRAH_PRIVATE_MAPS_ACL_TARGET;
 $me=[System.Security.Principal.WindowsIdentity]::GetCurrent().User;
 $admin=[System.Security.Principal.SecurityIdentifier]::new('S-1-5-32-544');
 $acl=[System.Security.AccessControl.DirectorySecurity]::new();$acl.SetOwner($me);$acl.SetAccessRuleProtection($true,$false);
 foreach($sid in @($me,$admin)){$acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow'))};
 $directory=[System.IO.DirectoryInfo]::new($folder);$directory.SetAccessControl($acl);
 $actual=$directory.GetAccessControl();
 if(-not $actual.AreAccessRulesProtected){throw 'ACL_NOT_PROTECTED'};
 $rules=@($actual.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier]));
 if($rules.Count -ne 2){throw 'ACL_RULE_COUNT'};
 foreach($rule in $rules){if($rule.IsInherited -or $rule.AccessControlType -ne 'Allow' -or $rule.IdentityReference.Value -notin @($me.Value,$admin.Value) -or $rule.FileSystemRights -ne 'FullControl'){throw 'ACL_RULE_INVALID'}}`;
 try {execFileSync('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',script],{
  windowsHide:true,env:{...process.env,NAWASRAH_PRIVATE_MAPS_ACL_TARGET:directory},stdio:['ignore','ignore','pipe'],timeout:30000,
 });}catch{throw new Error('PRIVATE_MAPS_PROTECTION_FAILED');}
}
export function privateMapsEnabled(selected) {
 return !selected.isolated&&['production','prelaunch-trial'].includes(selected.environment);
}
export function privateSourceMaps(selected, root, app) {
 const enabled=privateMapsEnabled(selected);
 let dist=path.join(root,'dist');
 return {
  name:'nawasrah-private-source-maps',apply:'build',
  config(){return {build:{sourcemap:enabled?'hidden':false}};},
  configResolved(config){dist=path.resolve(config.root,config.build.outDir);assert.equal(config.build.sourcemap,enabled?'hidden':false,'PRIVATE_MAPS_BUILD_MODE_INVALID');},
  generateBundle:{order:'post',async handler(_options,bundle){
   if(!enabled)return;
   assert.match(selected.monitoring.release,/^[a-f0-9]{40}$/u,'PRIVATE_MAPS_RELEASE_REQUIRED');
   assert.ok(['admin','customer'].includes(app),'PRIVATE_MAPS_APP_INVALID');
   const maps=Object.entries(bundle).filter(([name])=>name.endsWith('.map'));
   assert.ok(maps.length>0,'PRIVATE_MAPS_NOT_GENERATED');
   const base=process.env.NAWASRAH_PRIVATE_SOURCE_MAPS_DIR||path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'.local','share'),'NawasrahPrivateSourceMaps');
   const parent=path.join(path.resolve(base),app,selected.monitoring.release,selected.environment);
   assertPrivateMapPath(parent,dist);await mkdir(parent,{recursive:true});
   const archive=await mkdtemp(path.join(parent,'build-'));await protectMapArchive(archive);
   const entries=[];
   for(const [name,asset] of maps){
    assert.ok(asset.type==='asset'&&!name.includes('..')&&!path.isAbsolute(name)&&/^[a-zA-Z0-9_./-]+\.map$/u.test(name),'PRIVATE_MAPS_FILENAME_INVALID');
    const source=typeof asset.source==='string'?Buffer.from(asset.source):Buffer.from(asset.source);
    const mapFile=path.join(archive,name);await mkdir(path.dirname(mapFile),{recursive:true,mode:0o700});await writeFile(mapFile,source,{flag:'wx',mode:0o600});
    const file=name.slice(0,-4),chunk=bundle[file];assert.ok(chunk?.type==='chunk','PRIVATE_MAPS_CHUNK_REQUIRED');
    entries.push({file,map:name,mapSha256:sha256(source),bundleSha256:sha256(chunk.code)});
    delete bundle[name]; // Removed BEFORE Rollup writes any publishable output.
   }
   const manifest={format:1,app,environment:selected.environment,release:selected.monitoring.release,entries};
   await writeFile(path.join(archive,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
   console.log(JSON.stringify({privateSourceMaps:true,app,release:selected.monitoring.release,maps:entries.length,manifest:path.join(archive,'manifest.json'),uploaded:false}));
  }},
 };
}
