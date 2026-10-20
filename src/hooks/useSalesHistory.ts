import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {fetchSalesHistoryPageFromSupabase} from '../services/supabase/salesHistory.service';
import {subscribeToOrdersInSupabase} from '../services/supabase/orders.service';
import type {SalesHistoryInput,SalesHistoryPage} from '../utils/salesHistory';
export interface SalesHistoryReadState {data:SalesHistoryPage|null;loading:boolean;error:string|null;unavailable:boolean;reload:()=>Promise<void>}
export function useSalesHistory(input:SalesHistoryInput,enabled:boolean,identity=''):SalesHistoryReadState {
  const {page,pageSize,period,fromDate,toDate,paymentMethod,source,customerSearch,numberSearch,salesOnly}=input;
  // Identity scopes the request lifecycle and is never sent to the RPC.
  const query=useMemo(()=>({identity,input:{page,pageSize,period,fromDate,toDate,paymentMethod,source,customerSearch,numberSearch,salesOnly}}),[identity,page,pageSize,period,fromDate,toDate,paymentMethod,source,customerSearch,numberSearch,salesOnly]);
  const [data,setData]=useState<SalesHistoryPage|null>(null),[loading,setLoading]=useState(enabled),[error,setError]=useState<string|null>(null),[unavailable,setUnavailable]=useState(false);
  const version=useRef(0),controller=useRef<AbortController|null>(null);
  const reload=useCallback(async()=>{
    const current=++version.current;controller.current?.abort();
    if(!enabled){setData(null);setLoading(false);setError(null);return;}
    const abort=new AbortController();controller.current=abort;
    setLoading(true);setError(null);setUnavailable(false);setData(null);
    const result=await fetchSalesHistoryPageFromSupabase(query.input,abort.signal);
    if(current!==version.current||abort.signal.aborted)return;
    if(result.success)setData(result.data);else {setError(result.error);setUnavailable(result.unavailable??false);}
    setLoading(false);
  // Identity changes also invalidate a request when both users have a reader role.
  },[enabled,query]);
  const invalidate=useCallback(()=>{++version.current;controller.current?.abort();},[]);
  useEffect(()=>{void reload();return invalidate;},[reload,invalidate]);
  useEffect(()=>enabled?subscribeToOrdersInSupabase(()=>void reload()):undefined,[enabled,reload]);
  return {data,loading,error,unavailable,reload};
}
