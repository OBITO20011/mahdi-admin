import React, { useEffect, useState } from 'react';
import {PageHeader, SegmentedControl} from '../../components/ui';
import { useAppStoreSelector } from '../../stores/useAppStore';
import { CrmView } from '../crm/CrmView';
import { CustomerBalancesView } from './CustomerBalancesView';

type CustomerSection = 'directory' | 'balances';

export const AccountsView: React.FC = () => {
  const [section, setSection] = useState<CustomerSection>('directory');
  const customerNavigationTarget = useAppStoreSelector(
    (state) => state.customerNavigationTarget
  );

  useEffect(() => {
    if (customerNavigationTarget) {
      setSection('directory');
    }
  }, [customerNavigationTarget]);

  return (
    <div dir="rtl" className="min-w-0 space-y-4 bg-nw-bg pb-28 text-nw-text" data-testid="customers-workbench">
      <div data-ui="accounts-header"><PageHeader title="العملاء والذمم" description="ملف العميل وعمر الدين وتسجيل الدفعات على الطلبات المستحقة." /></div>
      <div className="px-4 sm:px-6"><SegmentedControl label="أقسام العملاء" touchSize value={section} onChange={setSection}
        options={[{value:'directory',label:'دليل العملاء'},{value:'balances',label:'الذمم والتحصيل'}]} /></div>

      {section === 'directory' ? <CrmView /> : <CustomerBalancesView />}
    </div>
  );
};
