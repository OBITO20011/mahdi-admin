import React from 'react';
import {SearchField, FilterChips, UiButton, formatCustomerCount} from '../../components/ui';
import {CustomerSortOption, CrmCustomerStatus} from '../../types/crm';

const PRIMARY_FILTERS:Array<{value:CrmCustomerStatus;label:string}>=[
  {value:'all',label:'كل العملاء'},{value:'has_debt',label:'عليهم دين'},{value:'overdue',label:'متأخرون'},
];
const MORE_FILTERS:Array<{value:CrmCustomerStatus;label:string}>=[
  {value:'active',label:'النشطون'},{value:'vip',label:'VIP'},{value:'inactive',label:'غير النشطين'},
  {value:'blocked',label:'المحظورون'},{value:'over_limit',label:'تجاوز الحد'},{value:'wholesale',label:'جملة'},
];

interface CustomerFiltersProps {
  searchQuery: string; onSearchChange: (value: string) => void;
  statusFilter: CrmCustomerStatus;
  onStatusFilterChange: (status: CrmCustomerStatus) => void;
  sortBy: CustomerSortOption; onSortByChange: (sort: CustomerSortOption) => void;
  totalResults: number;
}
export const CustomerFilters: React.FC<CustomerFiltersProps> = ({searchQuery,onSearchChange,statusFilter,onStatusFilterChange,sortBy,onSortByChange,totalResults}) => <div className="space-y-3">
  <div className="flex flex-wrap gap-2"><SearchField label="البحث في العملاء" placeholder="ابحث بالاسم أو الهاتف أو البريد" value={searchQuery}
    onChange={(event) => onSearchChange(event.target.value)} className="min-w-0 flex-1" />
    {searchQuery && <UiButton onClick={() => onSearchChange('')} aria-label="مسح البحث">مسح</UiButton>}
    <label className="flex min-h-11 items-center gap-2 text-sm text-nw-muted"><span className="sr-only">ترتيب العملاء</span><select value={sortBy}
      onChange={(event) => onSortByChange(event.target.value as CustomerSortOption)} className="min-h-11 rounded-xl border border-nw-border bg-nw-surface px-3 text-nw-text">
      <option value="latest">الأحدث تسجيلًا</option><option value="highest_spending">الأعلى شراءً</option><option value="most_orders">الأكثر طلبًا</option>
    </select></label></div>
  {/* Owner UX batch F: three everyday chips; the rarer groups live in one list. */}
  <div className="flex flex-wrap items-center gap-2">
    <FilterChips touchSize label="فئات العملاء" value={statusFilter} onChange={onStatusFilterChange} options={PRIMARY_FILTERS} />
    <label className="flex min-h-11 items-center"><span className="sr-only">فلاتر أخرى</span><select aria-label="فلاتر أخرى"
      value={MORE_FILTERS.some(item=>item.value===statusFilter)?statusFilter:''}
      onChange={(event) => onStatusFilterChange((event.target.value || 'all') as CrmCustomerStatus)}
      className="min-h-11 rounded-xl border border-nw-border bg-nw-surface px-3 text-sm text-nw-text">
      <option value="">المزيد</option>
      {MORE_FILTERS.map(item=><option key={item.value} value={item.value}>{item.label}</option>)}
    </select></label>
  </div>
  <p className="m-0 text-xs text-nw-muted">النتائج: <b className="nw-num">{formatCustomerCount(totalResults)}</b></p>
</div>;
