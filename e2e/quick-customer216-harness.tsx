import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import '../src/index.css';
import {AddCustomerModalContent, type CreatedCustomer} from '../src/features/crm/AddCustomerModalContent';
function Harness() {
  const [open, setOpen] = useState(true), [customer, setCustomer] = useState<CreatedCustomer | null>(null);
  return <main className="mx-auto max-w-lg p-4">
    {open && <AddCustomerModalContent quick onClose={() => setOpen(false)} onCreated={setCustomer}/>}
    {customer && <p role="status">اختير {customer.name} · {customer.phone}</p>}
    <p data-testid="closed">{String(!open)}</p>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Harness/>);
