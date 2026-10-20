import {useEffect,useRef,useState} from 'react';
import {fetchReceivingPurchaseContexts} from '../services/supabase/receivingPurchaseContext.service';
import {useAuthStore} from '../stores/useAuthStore';
import type {LastPurchaseQuote} from '../utils/receivingPurchaseContext';
interface ReadState {key:string;status:'loading'|'ready'|'error';quotes:Record<string,LastPurchaseQuote|null>;error:string|null}
export function useReceivingPurchaseContexts(productIds:string[],enabled=true){
  const {user,roles,roleName}=useAuthStore(),identity=JSON.stringify([user?.id??'',roles,roleName]);
  const key=JSON.stringify([identity,enabled,Array.from(new Set(productIds)).sort()]);
  const [state,setState]=useState<ReadState>({key:'',status:'loading',quotes:{},error:null});
  const version=useRef(0);
  useEffect(()=>{
    const current=++version.current,controller=new AbortController();
    const [,active,ids]=JSON.parse(key) as [string,boolean,string[]];
    if(!active||!ids.length){setState({key,status:'ready',quotes:{},error:null});return ()=>controller.abort();}
    setState({key,status:'loading',quotes:{},error:null});
    fetchReceivingPurchaseContexts(ids,controller.signal).then(quotes=>{
      if(version.current===current&&!controller.signal.aborted)setState({key,status:'ready',quotes,error:null});
    }).catch((error:unknown)=>{
      if(version.current===current&&!controller.signal.aborted)setState({key,status:'error',quotes:{},error:error instanceof Error?error.message:'تعذر قراءة آخر شراء.'});
    });
    return ()=>{controller.abort();};
    // The canonical key includes every input and prevents stale identity/row reads.
  },[key]);
  return state.key===key?state:{key,status:'loading' as const,quotes:{},error:null};
}
