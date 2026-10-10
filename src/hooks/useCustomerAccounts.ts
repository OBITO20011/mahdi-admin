import {useEffect, useState} from 'react';
import {fetchCustomerDebtAging, type CustomerDebtAging} from '../services/supabase/customerDebtAging.service';
import type {AgingSegment} from '../components/ui';

export function useDirectoryAging(customerIds: string, revision: unknown) {
  const [data, setData] = useState<Record<string, CustomerDebtAging>>({});
  useEffect(() => {
    let active = true;
    setData({});
    void Promise.all(customerIds.split(',').filter(Boolean).map(async id =>
      [id, await fetchCustomerDebtAging(id)] as const)).then(rows => {
      if (active) setData(Object.fromEntries(rows.filter((row): row is readonly [string, CustomerDebtAging] => row[1] !== null)));
    });
    return () => {active = false;};
  }, [customerIds, revision]);
  return data;
}

export function useCustomerAging(customerId: string | null, revision: unknown = null) {
  const [state, setState] = useState<{id: string | null; data: CustomerDebtAging | null}>({id: customerId, data: null});
  useEffect(() => {
    let active = true;
    setState({id: customerId, data: null});
    void fetchCustomerDebtAging(customerId).then(data => {if (active) setState({id: customerId, data});});
    return () => {active = false;};
  }, [customerId, revision]);
  return state.id === customerId ? state.data : null;
}

export const agingSegments = (data: CustomerDebtAging): AgingSegment[] => [
  {label: '0–7 أيام', amount: data.days_0_7_in_minor_units / 1000, tone: 'ok'},
  {label: '8–30 يوماً', amount: data.days_8_30_in_minor_units / 1000, tone: 'warn'},
  {label: 'أكثر من 30 يوماً', amount: data.days_over_30_in_minor_units / 1000, tone: 'bad'},
  {label: 'عمر غير متاح', amount: data.age_unavailable_in_minor_units / 1000, tone: 'mute'},
];
