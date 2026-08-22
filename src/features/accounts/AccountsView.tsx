import React, { useEffect, useState } from 'react';
import { BookUser, ReceiptText, Users } from 'lucide-react';
import { useAppStore } from '../../stores/useAppStore';
import { CrmView } from '../crm/CrmView';
import { CustomerBalancesView } from './CustomerBalancesView';

type CustomerSection = 'directory' | 'balances';

export const AccountsView: React.FC = () => {
  const [section, setSection] = useState<CustomerSection>('directory');
  const { customerNavigationTarget } = useAppStore();

  useEffect(() => {
    if (customerNavigationTarget) {
      setSection('directory');
    }
  }, [customerNavigationTarget]);

  return (
    <div dir="rtl" className="space-y-3 pb-24">
      <div className="mx-3 mt-3 rounded-2xl border border-slate-800 bg-gradient-to-l from-teal-950/80 to-slate-900 p-4">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-teal-500/30 bg-teal-500/10 text-teal-300">
            <Users className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-black text-white">
              العملاء والذمم
            </h2>
            <p className="text-[11px] text-slate-400">
              ملف العميل في الدليل، والمبالغ المستحقة في التحصيل
            </p>
          </div>
        </div>
      </div>

      <div className="mx-3 grid grid-cols-2 gap-1 rounded-2xl border border-slate-800 bg-slate-900 p-1 text-xs font-bold">
        <button
          type="button"
          onClick={() => setSection('directory')}
          className={`flex items-center justify-center gap-1.5 rounded-xl py-2.5 transition ${
            section === 'directory'
              ? 'bg-teal-600 text-white shadow'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <BookUser className="h-4 w-4" />
          دليل العملاء
        </button>
        <button
          type="button"
          onClick={() => setSection('balances')}
          className={`flex items-center justify-center gap-1.5 rounded-xl py-2.5 transition ${
            section === 'balances'
              ? 'bg-teal-600 text-white shadow'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <ReceiptText className="h-4 w-4" />
          الذمم والتحصيل
        </button>
      </div>

      {section === 'directory' ? <CrmView /> : <CustomerBalancesView />}
    </div>
  );
};
