import React, { useState } from 'react';
import { useAppStoreSelector } from '../stores/useAppStore';

/**
 * Owner decision 4 (2026-10-15): a cash supplier payment or cash expense larger
 * than the drawer's expected cash is warned about, never blocked. The first
 * submit shows «بالدرج X دينار فقط، متأكد؟»; submitting the same amount again
 * continues. Database payment/expense logic is unchanged.
 */
export function useDrawerShortfallConfirm() {
  const currentShift = useAppStoreSelector(state => state.currentShift);
  const [acknowledged, setAcknowledged] = useState<number | null>(null);
  const [warning, setWarning] = useState('');

  /** True when the submit may proceed; false after showing the warning once. */
  const confirmCash = (amountJod: number, isCash: boolean, branchId?: string | null): boolean => {
    const shift = currentShift;
    if (!isCash || !shift || (branchId && shift.branchId !== branchId) || !(amountJod > shift.expectedCash + 0.0005)) {
      setWarning(''); setAcknowledged(null);
      return true;
    }
    if (acknowledged === amountJod) { setWarning(''); setAcknowledged(null); return true; }
    setAcknowledged(amountJod);
    setWarning(`بالدرج ${Math.max(shift.expectedCash, 0).toFixed(3)} دينار فقط، متأكد؟ اضغط التأكيد مرة أخرى للمتابعة.`);
    return false;
  };

  const reset = () => { setWarning(''); setAcknowledged(null); };
  const warningNode = warning
    ? <p role="alert" data-testid="drawer-shortfall-warning" className="m-0 rounded-xl border border-nw-border bg-nw-warn-bg p-2 text-sm font-bold text-nw-warn">{warning}</p>
    : null;

  return { confirmCash, reset, warningNode };
}
