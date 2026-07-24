/**
 * Nawasrah Business Manager - Enterprise CRM Customer Filters & Search Bar
 * Search by Name, Phone, Email. Filter by VIP, Active, Inactive, Blocked. Sort by Latest, Highest Spending, Most Orders.
 */

import React from 'react';
import { CustomerSortOption } from '../../types/crm';
import { Search, X, SlidersHorizontal, ArrowUpDown, ShieldAlert, Star, CheckCircle2, UserX } from 'lucide-react';

interface CustomerFiltersProps {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  statusFilter: 'all' | 'vip' | 'active' | 'inactive' | 'blocked';
  onStatusFilterChange: (status: 'all' | 'vip' | 'active' | 'inactive' | 'blocked') => void;
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
}) => {
  return (
    <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-2xl shadow-lg space-y-3">
      {/* Search Bar Input */}
      <div className="relative">
        <Search className="w-4 h-4 text-slate-400 absolute right-3.5 top-3.5" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="ابحث بالاسم، رقم الهاتف، أو البريد الإلكتروني..."
          className="w-full bg-slate-950 border border-slate-800 text-slate-100 placeholder-slate-500 rounded-xl py-2.5 pr-10 pl-9 text-xs focus:outline-none focus:border-blue-500 transition"
        />
        {searchQuery && (
          <button
            onClick={() => onSearchChange('')}
            className="absolute left-3 top-3 text-slate-400 hover:text-white p-0.5 rounded-full bg-slate-800"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Filter Chips & Sorting Row */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 pt-1 border-t border-slate-800/80">
        {/* Status Segment Chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0 no-scrollbar text-xs">
          <button
            onClick={() => onStatusFilterChange('all')}
            className={`px-3 py-1.5 rounded-xl font-bold transition shrink-0 flex items-center gap-1 border ${
              statusFilter === 'all'
                ? 'bg-blue-600 text-white border-blue-500 shadow'
                : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'
            }`}
          >
            <span>جميع العملاء</span>
          </button>

          <button
            onClick={() => onStatusFilterChange('vip')}
            className={`px-3 py-1.5 rounded-xl font-bold transition shrink-0 flex items-center gap-1 border ${
              statusFilter === 'vip'
                ? 'bg-amber-600 text-white border-amber-500 shadow'
                : 'bg-slate-950 text-amber-400/80 border-slate-800 hover:text-amber-300'
            }`}
          >
            <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
            <span>عملاء VIP</span>
          </button>

          <button
            onClick={() => onStatusFilterChange('active')}
            className={`px-3 py-1.5 rounded-xl font-bold transition shrink-0 flex items-center gap-1 border ${
              statusFilter === 'active'
                ? 'bg-emerald-600 text-white border-emerald-500 shadow'
                : 'bg-slate-950 text-emerald-400/80 border-slate-800 hover:text-emerald-300'
            }`}
          >
            <CheckCircle2 className="w-3 h-3" />
            <span>نشطون</span>
          </button>

          <button
            onClick={() => onStatusFilterChange('inactive')}
            className={`px-3 py-1.5 rounded-xl font-bold transition shrink-0 flex items-center gap-1 border ${
              statusFilter === 'inactive'
                ? 'bg-slate-700 text-white border-slate-600 shadow'
                : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-300'
            }`}
          >
            <UserX className="w-3 h-3" />
            <span>غير نشطين</span>
          </button>

          <button
            onClick={() => onStatusFilterChange('blocked')}
            className={`px-3 py-1.5 rounded-xl font-bold transition shrink-0 flex items-center gap-1 border ${
              statusFilter === 'blocked'
                ? 'bg-rose-600 text-white border-rose-500 shadow'
                : 'bg-slate-950 text-rose-400/80 border-slate-800 hover:text-rose-300'
            }`}
          >
            <ShieldAlert className="w-3 h-3" />
            <span>محظورون</span>
          </button>
        </div>

        {/* Sorting Dropdown & Results Counter */}
        <div className="flex items-center justify-between sm:justify-end gap-2 w-full sm:w-auto text-xs border-t sm:border-t-0 border-slate-800 pt-1.5 sm:pt-0">
          <span className="text-[11px] text-slate-400 font-medium">
            النتائج: <strong className="text-white font-black">{totalResults}</strong> عميل
          </span>

          <div className="flex items-center gap-1 bg-slate-950 border border-slate-800 px-2.5 py-1 rounded-xl">
            <ArrowUpDown className="w-3 h-3 text-slate-400" />
            <select
              value={sortBy}
              onChange={(e) => onSortByChange(e.target.value as CustomerSortOption)}
              className="bg-transparent text-slate-200 font-bold focus:outline-none cursor-pointer"
            >
              <option value="latest">الأحدث تسجيلاً</option>
              <option value="highest_spending">الأعلى إنفاقاً (Spending)</option>
              <option value="most_orders">الأكثر طلباً (Orders)</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
};
