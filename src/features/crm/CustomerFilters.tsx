import React from 'react';
import {SearchField, FilterChips, UiButton} from '../../components/ui';
import {CustomerSortOption} from '../../types/crm';

interface CustomerFiltersProps {
  searchQuery: string; onSearchChange: (value: string) => void;
  statusFilter: 'all' | 'vip' | 'active' | 'inactive' | 'blocked';
  onStatusFilterChange: (status: 'all' | 'vip' | 'active' | 'inactive' | 'blocked') => void;
  sortBy: CustomerSortOption; onSortByChange: (sort: CustomerSortOption) => void;
  totalResults: number;
}
export const CustomerFilters: React.FC<CustomerFiltersProps> = ({searchQuery,onSearchChange,statusFilter,onStatusFilterChange,sortBy,onSortByChange,totalResults}) => <div className="space-y-3">
  <FilterChips touchSize label="فئات العملاء" value={statusFilter} onChange={onStatusFilterChange} options={[
    {value:'all',label:'كل العملاء'},{value:'active',label:'النشطون'},{value:'vip',label:'VIP'},
    {value:'inactive',label:'غير النشطين'},{value:'blocked',label:'المحظورون'},
  ]} />
  <div className="flex flex-wrap gap-2"><SearchField label="البحث في العملاء" placeholder="ابحث بالاسم أو الهاتف أو البريد" value={searchQuery}
    onChange={(event) => onSearchChange(event.target.value)} className="min-w-0 flex-1" />
    {searchQuery && <UiButton onClick={() => onSearchChange('')} aria-label="مسح البحث">مسح</UiButton>}
    <label className="flex min-h-11 items-center gap-2 text-sm text-nw-muted"><span className="sr-only">ترتيب العملاء</span><select value={sortBy}
      onChange={(event) => onSortByChange(event.target.value as CustomerSortOption)} className="min-h-11 rounded-xl border border-nw-border bg-nw-surface px-3 text-nw-text">
      <option value="latest">الأحدث تسجيلًا</option><option value="highest_spending">الأعلى شراءً</option><option value="most_orders">الأكثر طلبًا</option>
    </select></label></div>
  <p className="m-0 text-xs text-nw-muted">النتائج: <b className="nw-num">{totalResults}</b> عميل</p>
</div>;
