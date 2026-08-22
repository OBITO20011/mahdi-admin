import React from 'react';
import { ArrowUpDown, Search, SlidersHorizontal, X } from 'lucide-react';
import { CustomerSortOption } from '../../types/crm';

interface CustomerFiltersProps {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  statusFilter: 'all' | 'vip' | 'active' | 'inactive' | 'blocked';
  onStatusFilterChange: (
    status: 'all' | 'vip' | 'active' | 'inactive' | 'blocked'
  ) => void;
  sortBy: CustomerSortOption;
  onSortByChange: (sort: CustomerSortOption) => void;
  totalResults: number;
}

export const CustomerFilters: React.FC<CustomerFiltersProps> = ({
  searchQuery,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  sortBy,
  onSortByChange,
  totalResults,
}) => (
  <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-3 shadow">
    <div className="relative">
      <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
      <input
        value={searchQuery}
        onChange={(event) => onSearchChange(event.target.value)}
        placeholder="ابحث بالاسم أو الهاتف أو البريد"
        className="w-full rounded-xl border border-slate-800 bg-slate-950 py-2.5 pl-9 pr-9 text-xs text-white outline-none focus:border-indigo-500"
      />
      {searchQuery && (
        <button
          type="button"
          onClick={() => onSearchChange('')}
          className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-slate-800 p-1 text-slate-400"
          aria-label="مسح البحث"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>

    <div className="grid grid-cols-2 gap-2">
      <label className="relative">
        <SlidersHorizontal className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-indigo-400" />
        <select
          value={statusFilter}
          onChange={(event) =>
            onStatusFilterChange(
              event.target.value as
                | 'all'
                | 'vip'
                | 'active'
                | 'inactive'
                | 'blocked'
            )
          }
          className="w-full rounded-xl border border-slate-800 bg-slate-950 py-2 pl-2 pr-8 text-[11px] font-bold text-slate-200"
        >
          <option value="all">جميع العملاء</option>
          <option value="active">النشطون</option>
          <option value="vip">عملاء VIP</option>
          <option value="inactive">غير النشطين</option>
          <option value="blocked">المحظورون</option>
        </select>
      </label>

      <label className="relative">
        <ArrowUpDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-teal-400" />
        <select
          value={sortBy}
          onChange={(event) =>
            onSortByChange(event.target.value as CustomerSortOption)
          }
          className="w-full rounded-xl border border-slate-800 bg-slate-950 py-2 pl-2 pr-8 text-[11px] font-bold text-slate-200"
        >
          <option value="latest">الأحدث تسجيلًا</option>
          <option value="highest_spending">الأعلى شراءً</option>
          <option value="most_orders">الأكثر طلبًا</option>
        </select>
      </label>
    </div>

    <p className="text-[10px] text-slate-500">
      النتائج: <strong className="text-slate-200">{totalResults}</strong> عميل
    </p>
  </div>
);
