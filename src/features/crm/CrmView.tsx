import React, { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  UserPlus,
  Users,
  Users2,
} from 'lucide-react';
import {
  fetchCustomersCrmFromSupabase,
  softDeleteCustomerInSupabase,
  subscribeToCrmRealtime,
  toggleCustomerBlockStatusInSupabase,
} from '../../services/supabase/crm.service';
import {
  useAppStoreActions,
  useAppStoreSelector,
} from '../../stores/useAppStore';
import {
  CrmCustomer,
  CrmCustomerFilterParams,
  CustomerSortOption,
  CrmCustomerStatus,
} from '../../types/crm';
import { CustomerDetailView } from './CustomerDetailView';
import { CustomerFilters } from './CustomerFilters';
import { CustomerList } from './CustomerList';
import {DetailLayout, DetailPanel, MainColumn, formatCustomerCount} from '../../components/ui';
import {CustomerAgingSummary} from './CustomerAging';
import {useDirectoryAging} from '../../hooks/useCustomerAccounts';
import {useDialogFocus} from '../../hooks/useDialogFocus';

const subscribePhone = (listener: () => void) => {
  const media = window.matchMedia('(max-width: 767px)');
  media.addEventListener('change', listener);
  return () => media.removeEventListener('change', listener);
};

export const CrmView: React.FC = () => {
  const customerNavigationTarget = useAppStoreSelector(
    (state) => state.customerNavigationTarget
  );
  const { openModal, setToast, clearCustomerNavigationTarget } =
    useAppStoreActions();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<CrmCustomerStatus>('all');
  const [sortBy, setSortBy] = useState<CustomerSortOption>('latest');
  const [page, setPage] = useState(1);
  const pageSize = 8;
  const [customers, setCustomers] = useState<CrmCustomer[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(
    customerNavigationTarget
  );

  useEffect(() => {
    if (!customerNavigationTarget) return;
    setSelectedCustomerId(customerNavigationTarget);
    clearCustomerNavigationTarget();
  }, [clearCustomerNavigationTarget, customerNavigationTarget]);

  const loadCustomers = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      setError(null);
      const params: CrmCustomerFilterParams = {
        searchQuery,
        statusFilter,
        sortBy,
        page,
        pageSize,
      };
      const result = await fetchCustomersCrmFromSupabase(params);
      if (result.success) {
        setCustomers(result.customers);
        setTotalCount(result.totalCount);
        setTotalPages(result.totalPages);
      } else {
        setError(result.error || 'تعذر تحميل دليل العملاء.');
      }
      if (!silent) setLoading(false);
    },
    [page, searchQuery, sortBy, statusFilter]
  );

  useEffect(() => {
    loadCustomers();
    const unsubscribe = subscribeToCrmRealtime(() => loadCustomers(true));
    return unsubscribe;
  }, [loadCustomers]);

  const aging = useDirectoryAging(customers.map(customer => customer.id).join(','), customers);
  const phone = useSyncExternalStore(subscribePhone, () => window.matchMedia('(max-width: 767px)').matches, () => false);
  const detailFocus = useDialogFocus(phone && Boolean(selectedCustomerId), () => setSelectedCustomerId(null));
  const root = useRef<HTMLDivElement>(null);
  const returnPoint = useRef<{container: HTMLElement; scrollTop: number; id: string} | null>(null);
  const selectCustomer = (customer: CrmCustomer) => {
    let container = root.current?.parentElement;
    while (container && !/^(auto|scroll)$/.test(getComputedStyle(container).overflowY)) container = container.parentElement;
    if (container) returnPoint.current = {container, scrollTop: container.scrollTop, id: customer.id};
    setSelectedCustomerId(customer.id);
  };
  useLayoutEffect(() => {
    const point = returnPoint.current;
    if (!point || selectedCustomerId || loading) return;
    returnPoint.current = null;
    if (!point.container.isConnected) return;
    const active = document.activeElement;
    if (active && active !== document.body && !active.closest('[data-customer-detail]')) return;
    point.container.scrollTop = point.scrollTop;
    root.current?.querySelector<HTMLButtonElement>(`[data-customer-card="${CSS.escape(point.id)}"] button`)?.focus({preventScroll:true});
  }, [selectedCustomerId, loading]);

  const handleBlock = async (customer: CrmCustomer) => {
    const shouldBlock = !customer.isBlocked;
    if (
      !window.confirm(
        shouldBlock
          ? `هل تريد حظر العميل ${customer.fullName}؟`
          : `هل تريد إلغاء حظر العميل ${customer.fullName}؟`
      )
    ) {
      return;
    }
    const result = await toggleCustomerBlockStatusInSupabase(
      customer.id,
      shouldBlock
    );
    if (result.success) {
      setToast(
        shouldBlock ? 'تم حظر العميل.' : 'تم إلغاء حظر العميل.',
        'success'
      );
      loadCustomers(true);
    } else {
      setToast(result.error || 'تعذر تعديل حالة العميل.', 'error');
    }
  };

  const handleDelete = async (customer: CrmCustomer) => {
    if (
      !window.confirm(
        `هل تريد حذف ${customer.fullName} من الدليل؟ لن يسمح النظام بالحذف إذا كانت عليه ذمة.`
      )
    ) {
      return;
    }
    const result = await softDeleteCustomerInSupabase(customer.id);
    if (result.success) {
      setToast('تم حذف العميل من الدليل.', 'success');
      loadCustomers(true);
    } else {
      setToast(result.error || 'تعذر حذف العميل.', 'error');
    }
  };

  return (
    <div ref={root} dir="rtl" className="min-w-0 space-y-4 px-4 text-sm sm:px-6">
      <CustomerAgingSummary revision={customers} />
      <DetailLayout><MainColumn>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-1.5 text-sm font-black text-nw-text">
            <Users className="h-4 w-4 text-nw-primary" />
            دليل العملاء
          </h3>
          <p className="mt-0.5 text-[11px] text-nw-muted">
            {formatCustomerCount(totalCount)}
          </p>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <button
            type="button"
            onClick={() => loadCustomers()}
            className="rounded-xl border border-nw-border bg-nw-surface p-2.5 text-nw-text"
            aria-label="تحديث"
          >
            <RefreshCw
              className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`}
            />
          </button>
          <button
            type="button"
            onClick={() => openModal('add_customer')}
            className="flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl bg-nw-primary px-3 py-2.5 font-bold text-nw-on-primary"
          >
            <UserPlus className="h-4 w-4" />
            إضافة عميل
          </button>
        </div>
      </div>

      <CustomerFilters
        searchQuery={searchQuery}
        onSearchChange={(value) => {
          setSearchQuery(value);
          setPage(1);
        }}
        statusFilter={statusFilter}
        onStatusFilterChange={(value) => {
          setStatusFilter(value);
          setPage(1);
        }}
        sortBy={sortBy}
        onSortByChange={(value) => {
          setSortBy(value);
          setPage(1);
        }}
        totalResults={totalCount}
      />

      {loading && customers.length === 0 ? (
        <div className="rounded-2xl border border-nw-border bg-nw-surface p-9 text-center text-nw-muted">
          <RefreshCw className="mx-auto mb-2 h-7 w-7 animate-spin text-nw-primary" />
          جاري تحميل العملاء...
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-nw-bad bg-nw-bad-bg p-4 text-nw-bad">
          <AlertCircle className="mb-2 h-5 w-5" />
          {error}
        </div>
      ) : customers.length === 0 ? (
        <div className="rounded-2xl border border-nw-border bg-nw-surface p-8 text-center">
          <Users2 className="mx-auto mb-2 h-10 w-10 text-nw-muted" />
          <h4 className="font-black text-nw-text">لا يوجد عملاء مطابقون</h4>
          <p className="mt-1 text-[11px] text-nw-muted">
            أضف أول عميل أو غيّر البحث والفلترة.
          </p>
        </div>
      ) : (
        <CustomerList
          customers={customers}
          onSelectCustomer={selectCustomer}
          onBlockToggle={handleBlock}
          onSoftDelete={handleDelete}
          selectedCustomerId={selectedCustomerId}
          aging={aging}
        />
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between rounded-2xl border border-nw-border bg-nw-surface p-2 font-bold">
          <button
            type="button"
            onClick={() => setPage((value) => Math.max(1, value - 1))}
            disabled={page <= 1}
            className="flex items-center gap-1 rounded-xl bg-nw-surface px-3 py-2 text-nw-text disabled:opacity-40"
          >
            <ChevronRight className="h-4 w-4" />
            السابق
          </button>
          <span className="text-nw-muted">
            {page} / {totalPages}
          </span>
          <button
            type="button"
            onClick={() =>
              setPage((value) => Math.min(totalPages, value + 1))
            }
            disabled={page >= totalPages}
            className="flex items-center gap-1 rounded-xl bg-nw-surface px-3 py-2 text-nw-text disabled:opacity-40"
          >
            التالي
            <ChevronLeft className="h-4 w-4" />
          </button>
        </div>
      )}
      </MainColumn>{selectedCustomerId && <div ref={detailFocus as React.RefObject<HTMLDivElement>} role={phone ? 'dialog' : undefined} aria-modal={phone || undefined} aria-label="ملف العميل" tabIndex={phone ? -1 : undefined} className="fixed inset-0 z-40 h-[100dvh] overflow-y-auto bg-nw-bg md:contents" data-customer-detail><DetailPanel className="min-h-full rounded-none md:min-h-0 md:rounded-2xl">
        <CustomerDetailView customerId={selectedCustomerId} onBack={() => setSelectedCustomerId(null)} onRefreshList={() => loadCustomers(true)} />
      </DetailPanel></div>}</DetailLayout>
    </div>
  );
};
