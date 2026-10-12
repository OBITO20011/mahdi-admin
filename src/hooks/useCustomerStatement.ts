import {useCallback,useEffect,useRef,useState} from 'react';
import {fetchCustomerStatement} from '../services/supabase/customerStatement.service';
import {appendCustomerStatementPage,type CustomerStatementPage} from '../utils/customerStatement';

export function useCustomerStatement(customerId:string,revision:unknown) {
  const [data,setData]=useState<CustomerStatementPage|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
  const [refresh,setRefresh]=useState(0),generation=useRef(0),inFlight=useRef(false);
  useEffect(()=>{
    const request=++generation.current;inFlight.current=true;setBusy(true);setError(null);setData(null);
    void (async()=>{
      try{
        const result=await fetchCustomerStatement(customerId);
        if(request!==generation.current)return;
        if(result?.customer_id===customerId)setData(result);
        else setError('كشف الحساب غير متاح؛ تعذر التحقق من بياناته أو صلاحية قراءته.');
      }finally{if(request===generation.current){inFlight.current=false;setBusy(false);}}
    })();
    return ()=>{generation.current=request+1;inFlight.current=false;};
  },[customerId,revision,refresh]);
  const loadMore=useCallback(async()=>{
    if(!data?.has_more||inFlight.current)return;
    const request=generation.current;inFlight.current=true;setBusy(true);setError(null);
    try{
      const next=await fetchCustomerStatement(customerId,data.page+1);
      if(request!==generation.current)return;
      const joined=next&&appendCustomerStatementPage(data,next);
      if(joined)setData(joined);
      else setError('تغيّرت الحركات أو تعذر تحميلها؛ حدّث كشف الحساب قبل المتابعة.');
    }finally{if(request===generation.current){inFlight.current=false;setBusy(false);}}
  },[customerId,data]);
  return {data,busy,error,loadMore,reload:()=>setRefresh(value=>value+1)};
}
