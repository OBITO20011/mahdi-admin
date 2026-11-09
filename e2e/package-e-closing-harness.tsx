import React, {useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';
import '../src/index.css';
import {ShiftClosingReportModal} from '../src/features/shifts/ShiftClosingReportModal';
import {fetchCashShiftClosingReportFromSupabase} from '../src/services/supabase/expenses-shifts.service';
import type {CashShiftClosingResult} from '../src/services/supabase/salesOnlyShiftReport';

function Harness(){
  const [report,setReport]=useState<CashShiftClosingResult|null>(null);
  const [error,setError]=useState('');
  useEffect(()=>{void fetchCashShiftClosingReportFromSupabase('92600000-0000-4000-8000-000000000500')
    .then(setReport).catch(error=>setError(String(error)));},[]);
  return <ShiftClosingReportModal isOpen report={report} isLoading={!report&&!error} error={error}
    onClose={()=>undefined} onRetry={()=>undefined}/>;
}
createRoot(document.getElementById('root')!).render(<Harness/>);
