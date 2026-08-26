import React, { useCallback, useEffect, useState } from 'react';
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
} from '../../types/crm';
import { CustomerDetailView } from './CustomerDetailView';
import { CustomerFilters } from './CustomerFilters';
import { CustomerList } from './CustomerList';

export const CrmView: React.FC = () => {
  const customerNavigationTarget = useAppStoreSelector(
    (state) => state.customerNavigationTarget
  );
  const { openModal, setToast, clearCustomerNavigationTarget } =
    useAppStoreActions();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'vip' | 'active' | 'inactive' | 'blocked'
  >('all');
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

  if (selectedCustomerId) {
    return (
      <CustomerDetailView
        customerId={selectedCustomerId}
        onBack={() => setSelectedCustomerId(null)}
        onRefreshList={() => loadCustomers(true)}
      />
    );
  }

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
    <div dir="rtl" className="space-y-4 px-3 text-xs">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-1.5 text-sm font-black text-white">
            <Users className="h-4 w-4 text-indigo-400" />
            دليل العملاء
          </h3>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {totalCount} عميل — البيانات والعناوين والطلبات من Supabase
          </p>
        </div>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => loadCustomers()}
            className="rounded-xl border border-slate-700 bg-slate-800 p-2.5 text-slate-300"
            aria-label="تحديث"
          >
            <RefreshCw
              className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`}
            />
          </button>
          <button
            type="button"
            onClick={() => openModal('add_customer')}
            className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-2.5 font-bold text-white"
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
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-9 text-center text-slate-400">
          <RefreshCw className="mx-auto mb-2 h-7 w-7 animate-spin text-indigo-400" />
          جاري تحميل العملاء...
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-rose-800 bg-rose-950/50 p-4 text-rose-300">
          <AlertCircle className="mb-2 h-5 w-5" />
          {error}
        </div>
      ) : customers.length === 0 ? (
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-8 text-center">
          <Users2 className="mx-auto mb-2 h-10 w-10 text-slate-600" />
          <h4 className="font-black text-white">لا يوجد عملاء مطابقون</h4>
          <p className="mt-1 text-[11px] text-slate-500">
            أضف أول عميل أو غيّر البحث والفلترة.
          </p>
        </div>
      ) : (
        <CustomerList
          customers={customers}
          onSelectCustomer={(customer) => setSelectedCustomerId(customer.id)}
          onBlockToggle={handleBlock}
          onSoftDelete={handleDelete}
        />
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-900 p-2 font-bold">
          <button
            type="button"
            onClick={() => setPage((value) => Math.max(1, value - 1))}
            disabled={page <= 1}
            className="flex items-center gap-1 rounded-xl bg-slate-800 px-3 py-2 text-slate-300 disabled:opacity-40"
          >
            <ChevronRight className="h-4 w-4" />
            السابق
          </button>
          <span className="text-slate-400">
            {page} / {totalPages}
          </span>
          <button
            type="button"
            onClick={() =>
              setPage((value) => Math.min(totalPages, value + 1))
            }
            disabled={page >= totalPages}
            className="flex items-center gap-1 rounded-xl bg-slate-800 px-3 py-2 text-slate-300 disabled:opacity-40"
          >
            التالي
            <ChevronLeft className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
};
