import type {OperatingMode,OperatingModeInfo} from '../../services/supabase/operatingMode.service';

export interface ModeSnapshot {
 actorId:string|null;mode:OperatingMode|null;installed:boolean|null;status:'idle'|'loading'|'ready'|'error';
 errorCode:'OPERATING_MODE_UNVERIFIED'|null;
}
/** No cached mode crosses actors. An old request can neither overwrite a later
 * refresh nor authorize writes after a failed read. Retaining the last mode
 * while refreshing lets the UI preserve carts/forms instead of remounting. */
export function createModeReader(read:()=>Promise<OperatingModeInfo>){
 let state:ModeSnapshot={actorId:null,mode:null,installed:null,status:'idle',errorCode:null},version=0;
 let pending:{actorId:string;promise:Promise<void>;version:number}|null=null;
 const listeners=new Set<()=>void>();
 const emit=(next:ModeSnapshot)=>{state=next;for(const listener of listeners)listener();};
 const reset=()=>{version++;pending=null;emit({actorId:null,mode:null,installed:null,status:'idle',errorCode:null});};
 const load=(actorId:string,force=false):Promise<void>=>{
  if(!actorId){reset();return Promise.resolve();}
  if(!force&&pending?.actorId===actorId)return pending.promise;
  const token=++version;
  emit({actorId,mode:state.actorId===actorId?state.mode:null,installed:state.actorId===actorId?state.installed:null,status:'loading',errorCode:null});
  // A microtask boundary makes synchronous reader failures follow the same path.
  const promise=Promise.resolve().then(read).then(info=>{
   if(token===version)emit({actorId,mode:info.mode,installed:info.installed,status:'ready',errorCode:null});
  },()=>{
   if(token===version)emit({actorId,mode:state.actorId===actorId?state.mode:null,installed:state.actorId===actorId?state.installed:null,status:'error',errorCode:'OPERATING_MODE_UNVERIFIED'});
  }).then(()=>{if(pending?.version===token)pending=null;});
  pending={actorId,promise,version:token};return promise;
 };
 return {getSnapshot:()=>state,subscribe:(listener:()=>void)=>{listeners.add(listener);return()=>listeners.delete(listener);},load,reset};
}
