import React from 'react';
import {Phone, MessageCircle} from 'lucide-react';
import {Card, TableShell, Th, Tr, Td, StatusBadge, StockBar, MoneyText, UiButton, formatUiDate, type UiTone} from '../../components/ui';
import {CrmCustomer} from '../../types/crm';
import type {CustomerDebtAging} from '../../services/supabase/customerDebtAging.service';

interface CustomerListProps {
  customers: CrmCustomer[];
  onSelectCustomer: (customer: CrmCustomer) => void;
  onBlockToggle: (customer: CrmCustomer) => void;
  onSoftDelete: (customer: CrmCustomer) => void;
  selectedCustomerId?: string | null;
  aging?: Record<string, CustomerDebtAging>;
}
function jordanWhatsappNumber(phone: string) {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('962')) return digits;
  if (digits.startsWith('0')) return `962${digits.slice(1)}`;
  return `962${digits}`;
}
function customerStatus(customer: CrmCustomer, age?: CustomerDebtAging): {label: string; tone: UiTone} {
  if (customer.isBlocked) return {label:'محظور',tone:'bad'};
  if (!customer.isActive) return {label:'غير نشط',tone:'mute'};
  if (customer.creditLimit > 0 && customer.currentBalance > customer.creditLimit) return {label:'تجاوز الحد',tone:'bad'};
  if (age && age.days_over_30_in_minor_units > 0) return {label:'متأخر',tone:'bad'};
  if (customer.isVip) return {label:'VIP',tone:'warn'};
  return {label:'نشط',tone:'ok'};
}
export const CustomerList: React.FC<CustomerListProps> = ({customers, onSelectCustomer, onBlockToggle, onSoftDelete, selectedCustomerId, aging = {}}) => {
  const debt = (customer: CrmCustomer) => <div className="min-w-[130px] space-y-2">
    <p className="m-0 flex flex-wrap items-baseline gap-2"><MoneyText amount={customer.currentBalance} className="font-bold" />
      <span className="text-xs text-nw-muted">/ {customer.creditLimit > 0 ? <MoneyText amount={customer.creditLimit} /> : 'بلا حد محدد'}</span></p>
    {customer.creditLimit > 0 && <StockBar label={`الدين مقابل حد ${customer.fullName}`} value={customer.currentBalance} max={customer.creditLimit} tone={customer.currentBalance > customer.creditLimit ? 'bad' : 'ok'} />}
  </div>;
  const actions = (customer: CrmCustomer) => <div className="flex flex-wrap items-center gap-2">
    {customer.phone && <><a href={`tel:${customer.phone}`} aria-label={`اتصال ${customer.fullName}`} className="flex h-11 w-11 items-center justify-center rounded-xl border border-nw-border text-nw-primary"><Phone className="h-4 w-4" /></a>
      <a href={`https://wa.me/${jordanWhatsappNumber(customer.whatsapp || customer.phone)}`} target="_blank" rel="noreferrer" aria-label={`واتساب ${customer.fullName}`} className="flex h-11 w-11 items-center justify-center rounded-xl border border-nw-border text-nw-ok"><MessageCircle className="h-4 w-4" /></a></>}
    <UiButton onClick={() => onBlockToggle(customer)}>{customer.isBlocked ? 'إلغاء الحظر' : 'حظر'}</UiButton>
    <UiButton onClick={() => onSoftDelete(customer)} variant="danger">حذف</UiButton>
  </div>;
  const ageLabel = (customer: CrmCustomer) => {
    const row = aging[customer.id];
    if (!row) return 'غير متاح';
    if (row.total_in_minor_units === 0) return 'لا يوجد دين';
    if (row.oldest_debt_age_days == null) return 'عمر غير متاح';
    return `${row.oldest_debt_age_days} يوم`;
  };
  return <>
    <div className="space-y-3 md:hidden">{customers.map(customer => {
      const status = customerStatus(customer, aging[customer.id]);
      return <Card key={customer.id} data-customer-card={customer.id} className={selectedCustomerId === customer.id ? 'bg-nw-sel-row' : ''}>
        <button onClick={() => onSelectCustomer(customer)} aria-label={`فتح ملف ${customer.fullName}`} className="w-full space-y-3 text-right">
          <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0 flex-1"><h3 className="m-0 break-words text-base font-bold">{customer.fullName}</h3><p className="m-0 mt-1 text-xs text-nw-muted">{customer.governorate} · {customer.customerType === 'wholesale' ? 'جملة' : 'تجزئة'}</p></div><StatusBadge tone={status.tone}>{status.label}</StatusBadge></div>
          {debt(customer)}<p className="m-0 text-xs text-nw-muted">أقدم دين: {ageLabel(customer)} · {customer.totalOrdersCount} طلب</p>
        </button><div className="mt-3">{actions(customer)}</div>
      </Card>;
    })}</div>
    <div className="hidden md:block"><TableShell caption="العملاء والذمم" minWidth={690} head={<>{['العميل والمنطقة','النوع','الدين / الحد','أقدم دين','آخر دفعة','الحالة','الإجراءات'].map(label => <Th key={label}>{label}</Th>)}</>}>
      {customers.map(customer => {const status = customerStatus(customer, aging[customer.id]); return <Tr key={customer.id} selected={selectedCustomerId === customer.id}>
        <Td className="max-w-[190px]"><UiButton onClick={() => onSelectCustomer(customer)} aria-label={`فتح ملف ${customer.fullName}`} className="h-auto min-h-11 max-w-full px-0 text-right"><span className="break-words">{customer.fullName}</span></UiButton><p className="m-0 text-xs text-nw-muted">{customer.governorate}</p></Td>
        <Td><StatusBadge tone="mute">{customer.customerType === 'wholesale' ? 'جملة' : 'تجزئة'}</StatusBadge></Td><Td>{debt(customer)}</Td>
        <Td className="whitespace-nowrap">{ageLabel(customer)}</Td><Td className="whitespace-nowrap text-xs text-nw-muted">{aging[customer.id]?.last_payment_at ? formatUiDate(aging[customer.id].last_payment_at!, {day:'numeric',month:'short'}) : 'غير متاح'}</Td>
        <Td><StatusBadge tone={status.tone}>{status.label}</StatusBadge></Td><Td>{actions(customer)}</Td>
      </Tr>;})}
    </TableShell></div>
  </>;
};
