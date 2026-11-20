import { useEffect, useState } from 'react';
import { fetchOrderReturnStates } from '../../services/supabase/orderReturnStates.service';
import type { OrderReturnState } from '../../utils/orderReturnState';

/** Badge states for the visible page only. A failed read shows no badge, never a wrong one. */
export function useOrderReturnStates(orderIds: readonly string[], refreshKey: unknown = 0): Map<string, OrderReturnState> {
  const key = [...orderIds].sort().join(',');
  const [states, setStates] = useState<Map<string, OrderReturnState>>(() => new Map());
  useEffect(() => {
    let active = true;
    const ids = key ? key.split(',') : [];
    if (!ids.length) { setStates(new Map()); return () => { active = false; }; }
    fetchOrderReturnStates(ids).then((next) => { if (active) setStates(next); }).catch(() => { if (active) setStates(new Map()); });
    return () => { active = false; };
  }, [key, refreshKey]);
  return states;
}
