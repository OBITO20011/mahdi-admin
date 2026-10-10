const names = ['سوبرماركت الأمل','سوبرماركت النور','بقالة أبو خالد','ميني ماركت السلام','بقالة الريان','كافة الحي','مخبز الفرح','محمد العذري'];
const balances = [1980000,1245000,860500,640000,420000,312500,95000,58000];
export const customersFixture = names.map((full_name,index) => ({
  id: `fa000000-0000-4000-8000-${String(index + 1).padStart(12,'0')}`,full_name,
  phone:'0791234567',email:'',governorate:'الرمثا',notes:'عميل المحل',customer_type:index<6?'wholesale':'retail',
  is_active:index!==6,is_vip:index===1,is_blocked:index===7,is_deleted:false,
  credit_limit_in_minor_units:index===2?800000:2000000,current_balance_in_minor_units:balances[index],
  total_spending_in_minor_units:4500000,total_orders_count:24,created_at:'2026-01-01T10:00:00Z',updated_at:'2026-10-09T10:00:00Z',
}));
export const customerAgingFixture = (id: string | null) => {
  if (!id) return {total_in_minor_units:5611000,days_0_7_in_minor_units:5211000,
    days_8_30_in_minor_units:150000,days_over_30_in_minor_units:200000,age_unavailable_in_minor_units:50000,
    overdue_customer_count:1,over_limit_customer_count:1};
  const customer = customersFixture.find(row => row.id===id);
  const total=customer?.current_balance_in_minor_units??0;
  const mixed=id===customersFixture[2].id;
  return {customer_id:id,total_in_minor_units:total,days_0_7_in_minor_units:mixed?460500:total,
    days_8_30_in_minor_units:mixed?150000:0,days_over_30_in_minor_units:mixed?200000:0,age_unavailable_in_minor_units:mixed?50000:0,
    oldest_debt_at:mixed?null:'2026-10-08T10:00:00Z',oldest_debt_age_days:mixed?null:2,last_payment_at:'2026-10-02T10:00:00Z'};
};
