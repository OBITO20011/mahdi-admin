import { useEffect, useState } from 'react';
import { fetchAccountingHome } from '../../services/supabase/reportingDispatch.service';
import { useAppStoreSelector } from '../../stores/useAppStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { canUseNavigationAction } from '../more/adminNavigation.config';

/**
 * Owner trial item 10 (2026-11-20): the orders-page server summary computed
 * Σ(total − paid) and ignored return debt reductions (showed 4.000 instead of 1.000).
 * The orders centre now shows the canonical customer receivables of the home
 * reader instead. Roles that cannot read the home reader see no figure at all.
 * Returns JOD (major units) or null while unknown.
 */
export function useOrdersReceivables(refreshKey: unknown): number | null {
  const branchId = useAppStoreSelector((state) => state.activeBranch.id);
  const { roleName, roles } = useAuthStore();
  const allowed = canUseNavigationAction({ type: 'tab', destination: 'home' }, roleName, roles);
  const [value, setValue] = useState<number | null>(null);
  useEffect(() => {
    let active = true;
    if (!allowed || !branchId) { setValue(null); return () => { active = false; }; }
    fetchAccountingHome(branchId)
      .then((home) => { if (active) setValue(home.summary.customerReceivablesInMinorUnits / 1000); })
      .catch(() => { if (active) setValue(null); });
    return () => { active = false; };
  }, [allowed, branchId, refreshKey]);
  return value;
}
