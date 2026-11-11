import {useCallback,useEffect,useMemo,useState,useSyncExternalStore,type ReactNode} from 'react';
import {useAuthStore} from '../../stores/useAuthStore';
import {fetchOperatingMode} from '../../services/supabase/operatingMode.service';
import {createModeReader} from './modeReader';
import {OperatingModeContext} from './operatingModeContext';

export function OperatingModeProvider({children}:{children:ReactNode}){
 const auth=useAuthStore();const actorId=auth.isAuthenticated?auth.user?.id??'':'';
 const [reader]=useState(()=>createModeReader(fetchOperatingMode));
 const snapshot=useSyncExternalStore(reader.subscribe,reader.getSnapshot,reader.getSnapshot);
 useEffect(()=>{if(actorId)void reader.load(actorId);else reader.reset();},[actorId,reader]);
 const refresh=useCallback(()=>actorId?reader.load(actorId,true):Promise.resolve(),[actorId,reader]);
 useEffect(()=>{
  const check=()=>{if(actorId&&document.visibilityState==='visible')void reader.load(actorId);};
  window.addEventListener('focus',check);document.addEventListener('visibilitychange',check);
  return()=>{window.removeEventListener('focus',check);document.removeEventListener('visibilitychange',check);};
 },[actorId,reader]);
 // Actor switches cannot display even one render of the previous actor's mode.
 const visible=actorId===snapshot.actorId?snapshot:{actorId:actorId||null,mode:null,installed:null,status:'loading' as const,errorCode:null};
 const value=useMemo(()=>({actorId:visible.actorId,mode:visible.mode,installed:visible.installed,status:visible.status,
  errorCode:visible.errorCode,verified:visible.status==='ready',refresh}),[visible.actorId,visible.mode,visible.installed,visible.status,visible.errorCode,refresh]);
 return <OperatingModeContext.Provider value={value}>{children}</OperatingModeContext.Provider>;
}
