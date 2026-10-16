export const chequeBranch='94600000-0000-4000-8000-000000000001';
export const chequeCustomer='94600000-0000-4000-8000-000000000002';
export const chequeSupplier='94600000-0000-4000-8000-000000000003';
export const chequeClaim='94600000-0000-4000-8000-000000000004';
export interface ChequeFixtureRow {
  id:string;tracking_number:string;direction:'incoming'|'outgoing';origin:'operational'|'opening';cheque_number:string;
  bank_name:string;due_date:string;amount_in_minor_units:number;customer_id:string|null;supplier_id:string|null;endorsed_supplier_id:string|null;
  branch_id:string;status:'pending'|'endorsed'|'cleared'|'returned'|'cancelled';version:number;customer_name:string;supplier_name:string;endorsed_supplier_name:string;
}
export const chequeRows:ChequeFixtureRow[]=[
  {id:'94600000-0000-4000-8000-000000000101',tracking_number:'CHQ-00001001',direction:'incoming',origin:'operational',
    cheque_number:'0000123456789',bank_name:'البنك التجاري الأردني — فرع الرمثا',due_date:'2026-10-18',amount_in_minor_units:100000,
    customer_id:chequeCustomer,supplier_id:null,endorsed_supplier_id:null,branch_id:chequeBranch,status:'pending',version:1,
    customer_name:'محمد أحمد العلي',supplier_name:'',endorsed_supplier_name:''},
  {id:'94600000-0000-4000-8000-000000000102',tracking_number:'CHQ-00001002',direction:'outgoing',origin:'operational',
    cheque_number:'OUT-10500',bank_name:'البنك الأردني',due_date:'2026-10-17',amount_in_minor_units:80000,
    customer_id:null,supplier_id:chequeSupplier,endorsed_supplier_id:null,branch_id:chequeBranch,status:'pending',version:1,
    customer_name:'',supplier_name:'شركة توريد المواد الغذائية',endorsed_supplier_name:''},
  {id:'94600000-0000-4000-8000-000000000103',tracking_number:'CHQ-00001003',direction:'incoming',origin:'operational',
    cheque_number:'END-10501',bank_name:'البنك الأردني',due_date:'2026-10-15',amount_in_minor_units:50000,
    customer_id:chequeCustomer,supplier_id:null,endorsed_supplier_id:chequeSupplier,branch_id:chequeBranch,status:'endorsed',version:2,
    customer_name:'محمد أحمد العلي',supplier_name:'',endorsed_supplier_name:'شركة توريد المواد الغذائية'},
  {id:'94600000-0000-4000-8000-000000000104',tracking_number:'CHQ-00001004',direction:'outgoing',origin:'operational',
    cheque_number:'RET-10502',bank_name:'البنك الأردني',due_date:'2026-10-12',amount_in_minor_units:70000,
    customer_id:null,supplier_id:chequeSupplier,endorsed_supplier_id:null,branch_id:chequeBranch,status:'returned',version:2,
    customer_name:'',supplier_name:'شركة توريد المواد الغذائية',endorsed_supplier_name:''},
];
export const chequeResult=(cheque:ChequeFixtureRow)=>({success:true,idempotentReplay:false,cheque,claims:cheque.status==='returned'?[{
  id:chequeClaim,party_kind:cheque.direction==='incoming'?'customer':'supplier',reference:`شيك راجع رقم ${cheque.cheque_number}`,
  amount_in_minor_units:cheque.amount_in_minor_units,original_debt_at:'2026-07-01T09:00:00Z',reason:'الشيك رجع من البنك',claim_kind:'returned',
}]:cheque.status==='cancelled'?[{id:chequeClaim,party_kind:cheque.direction==='incoming'?'customer':'supplier',reference:`إلغاء تسجيل شيك رقم ${cheque.cheque_number}`,
  amount_in_minor_units:cheque.amount_in_minor_units,original_debt_at:'2026-07-01T09:00:00Z',reason:'تسجيل خاطئ',claim_kind:'cancelled'}]:[]});
