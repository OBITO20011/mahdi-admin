/**
 * Nawasrah Business Manager - Enterprise CRM Module View
 * Complete real Supabase CRM for Customers, Search, Filters, Sorting, Details, Pagination & Realtime
 */

import React, { useState, useEffect, useCallback } from 'react';
import { CrmCustomer, CrmCustomerFilterParams, CustomerSortOption } from '../../types/crm';
import {
  fetchCustomersCrmFromSupabase,
  subscribeToCrmRealtime,
  toggleCustomerBlockStatusInSupabase,
  softDeleteCustomerInSupabase,
} from '../../services/supabase/crm.service';
import { CustomerFilters } from './CustomerFilters';
import { CustomerList } from './CustomerList';
import { CustomerDetailView } from './CustomerDetailView';
import { useAppStore } from '../../stores/useAppStore';
import {
  Users,
  Plus,
  RefreshCw,
  AlertCircle,
  Wifi,
  ChevronRight,
  ChevronLeft,
  UserPlus,
  Users2,
  ShieldCheck,
  Star,
} from 'lucide-react';

export const CrmView: React.FC = () => {
  const { openModal, setToast } = useAppStore();

  // Filter & Pagination state
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'vip' | 'active' | 'inactive' | 'blocked'>('all');
  const [sortBy, setSortBy] = useState<CustomerSortOption>('latest');
  const [page, setPage] = useState<number>(1);
  const pageSize = 8;

  // Data state
  const [customers, setCustomers] = useState<CrmCustomer[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  // Selected customer for detail view
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);

  // Load Customers from Supabase
  const loadCustomers = useCallback(
    async (isSilent = false) => {
      if (!isSilent) setLoading(true);
      setError(null);

      const params: CrmCustomerFilterParams = {
        searchQuery,
        statusFilter,
        sortBy,
        page,
        pageSize,
      };

      const res = await fetchCustomersCrmFromSupabase(params);

      if (res.success) {
        setCustomers(res.customers);
        setTotalCount(res.totalCount);
        setTotalPages(res.totalPages);
        setLastUpdated(new Date());
      } else {
        setError(res.error || 'فشل جلب قائمة العملاء من قاعدة بيانات Supabase.');
      }

      if (!isSilent) setLoading(false);
    },
    [searchQuery, statusFilter, sortBy, page, pageSize]
  );

  useEffect(() => {
    loadCustomers();

    // Subscribe to Supabase Realtime
    const unsubscribe = subscribeToCrmRealtime(() => {
      loadCustomers(true);
    });

    return () => {
      unsubscribe();
    };
  }, [loadCustomers]);

  // Reset page when filters change
  const handleSearchChange = (val: string) => {
    setSearchQuery(val);
    setPage(1);
  };

  const handleStatusFilterChange = (status: 'all' | 'vip' | 'active' | 'inactive' | 'blocked') => {
    setStatusFilter(status);
    setPage(1);
  };

  const handleSortByChange = (sort: CustomerSortOption) => {
    setSortBy(sort);
    setPage(1);
  };

  const handleBlockToggle = async (customer: CrmCustomer) => {
    const nextBlocked = !customer.isBlocked;
    if (!window.confirm(nextBlocked ? `حظر العميل ${customer.fullName}؟` : `إلغاء حظر العميل ${customer.fullName}؟`)) return;

    const res = await toggleCustomerBlockStatusInSupabase(customer.id, nextBlocked);
    if (res.success) {
      setToast(nextBlocked ? 'تم الحظر بنجاح' : 'تم إلغاء الحظر', 'success');
      loadCustomers(true);
    } else {
      setToast(res.error || 'حدث خطأ أثناء تعديل الحظر', 'error');
    }
  };

  const handleSoftDelete = async (customer: CrmCustomer) => {
    if (!window.confirm(`حذف العميل ${customer.fullName}؟`)) return;

    const res = await softDeleteCustomerInSupabase(customer.id);
    if (res.success) {
      setToast('تم حذف العميل', 'success');
      loadCustomers(true);
    } else {
      setToast(res.error || 'حدث خطأ أثناء الحذف', 'error');
    }
  };

  // If a customer is selected, render the detail view
  if (selectedCustomerId) {
    return (
      <CustomerDetailView
        customerId={selectedCustomerId}
        onBack={() => setSelectedCustomerId(null)}
        onRefreshList={() => loadCustomers(true)}
      />
    );
  }

  return (
    <div dir="rtl" className="p-3 sm:p-4 space-y-4 pb-24 max-w-7xl mx-auto text-xs">
      {/* 1. Header Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 p-4 sm:p-5 rounded-2xl border border-slate-800 shadow-xl relative overflow-hidden">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 relative z-10">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold text-indigo-300 uppercase tracking-widest bg-indigo-950/80 px-2.5 py-0.5 rounded-full border border-indigo-800">
                إدارة علاقات العملاء Enterprise CRM
              </span>
              <div className="flex items-center gap-1 bg-emerald-950/80 border border-emerald-800 text-emerald-300 text-[10px] font-bold px-2 py-0.5 rounded-full">
                <Wifi className="w-3 h-3 text-emerald-400 animate-pulse" />
                <span>Supabase مباشر</span>
              </div>
            </div>

            <h2 className="text-base sm:text-lg font-black text-white mt-1 flex items-center gap-2">
              <Users className="w-5 h-5 text-indigo-400" />
              <span>دليل العملاء والحسابات</span>
            </h2>
            <p className="text-[11px] text-slate-300 mt-0.5">
              متابعة ملفات العملاء، العناوين، العناوين الإحداثية، سجل الطلبات، ومؤشرات الإنفاق • تحديث:{' '}
              {lastUpdated.toLocaleTimeString('ar-JO', { hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              onClick={() => loadCustomers()}
              className="bg-slate-800 hover:bg-slate-700 text-slate-200 p-2.5 rounded-xl border border-slate-700 transition active:scale-95 flex items-center justify-center gap-1.5 font-bold"
              title="تحديث البيانات"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-blue-400' : ''}`} />
              <span className="hidden sm:inline">تحديث</span>
            </button>

            <button
              onClick={() => openModal('add_customer')}
              className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2.5 rounded-xl shadow-lg transition active:scale-95 flex items-center justify-center gap-1.5 font-bold shrink-0 flex-1 sm:flex-initial"
            >
              <UserPlus className="w-4 h-4" />
              <span>إضافة عميل جديد</span>
            </button>
          </div>
        </div>
      </div>

      {/* 2. Search & Filter Bar */}
      <CustomerFilters
        searchQuery={searchQuery}
        onSearchChange={handleSearchChange}
        statusFilter={statusFilter}
        onStatusFilterChange={handleStatusFilterChange}
        sortBy={sortBy}
        onSortByChange={handleSortByChange}
        totalResults={totalCount}
      />

      {/* 3. Loading State Skeleton */}
      {loading && customers.length === 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, idx) => (
            <div key={idx} className="h-40 bg-slate-900 border border-slate-800 rounded-2xl animate-pulse p-4 space-y-3">
              <div className="h-4 w-32 bg-slate-800 rounded-full" />
              <div className="h-6 w-48 bg-slate-800 rounded-lg" />
              <div className="h-10 bg-slate-800 rounded-xl" />
            </div>
          ))}
        </div>
      )}

      {/* 4. Error State */}
      {error && !loading && (
        <div className="bg-rose-950/80 border border-rose-800 p-6 rounded-2xl text-center space-y-3 shadow-2xl my-4">
          <AlertCircle className="w-8 h-8 text-rose-400 mx-auto" />
          <h3 className="text-sm font-bold text-white">خطأ في جلب بيانات العملاء من Supabase</h3>
          <p className="text-xs text-rose-300">{error}</p>
          <button
            onClick={() => loadCustomers()}
            className="bg-rose-600 hover:bg-rose-500 text-white font-bold px-5 py-2 rounded-xl text-xs flex items-center gap-1.5 mx-auto transition"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>إعادة المحاولة</span>
          </button>
        </div>
      )}

      {/* 5. Empty State */}
      {!loading && !error && customers.length === 0 && (
        <div className="bg-slate-900 border border-slate-800 p-8 rounded-2xl text-center space-y-3 my-4">
          <Users2 className="w-12 h-12 text-slate-600 mx-auto" />
          <h3 className="text-sm font-bold text-white">لم يتم العثور على أي عملاء</h3>
          <p className="text-xs text-slate-400 max-w-md mx-auto">
            {searchQuery || statusFilter !== 'all'
              ? 'لا توجد نتائج تطابق معايير البحث والفلترة المحددة. حاول تغيير الفلتر.'
              : 'لم يتم تسجيل أي زبون بعد في قاعدة البيانات. اضغط أدناه لإضافة أول عميل.'}
          </p>
          <button
            onClick={() => openModal('add_customer')}
            className="bg-blue-600 hover:bg-blue-500 text-white font-bold px-5 py-2.5 rounded-xl text-xs inline-flex items-center gap-1.5 shadow"
          >
            <UserPlus className="w-4 h-4" />
            <span>إضافة أول عميل الآن</span>
          </button>
        </div>
      )}

      {/* 6. Customer List Cards Grid */}
      {!loading && !error && customers.length > 0 && (
        <CustomerList
          customers={customers}
          onSelectCustomer={(c) => setSelectedCustomerId(c.id)}
          onBlockToggle={handleBlockToggle}
          onSoftDelete={handleSoftDelete}
        />
      )}

      {/* 7. Pagination Controls */}
      {!loading && !error && totalPages > 1 && (
        <div className="bg-slate-900 border border-slate-800 p-3 rounded-2xl flex items-center justify-between text-xs font-bold shadow-lg">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 px-3 py-2 rounded-xl transition flex items-center gap-1 border border-slate-700"
          >
            <ChevronRight className="w-4 h-4" />
            <span>الصفحة السابقة</span>
          </button>

          <span className="text-slate-300">
            صفحة <strong className="text-white">{page}</strong> من <strong className="text-white">{totalPages}</strong>
          </span>

          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 px-3 py-2 rounded-xl transition flex items-center gap-1 border border-slate-700"
          >
            <span>الصفحة التالية</span>
            <ChevronLeft className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
};
