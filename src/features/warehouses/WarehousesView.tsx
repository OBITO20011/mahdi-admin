import {useCallback,useEffect,useState,type FormEvent} from 'react';
import {Plus,Pencil} from 'lucide-react';
import {Card,FormFields,PageHeader,StatusBadge,UiButton} from '../../components/ui';
import {Modal} from '../../components/common/Modal';
import {useAuthStore} from '../../stores/useAuthStore';
import {useAppStoreActions} from '../../stores/useAppStore';
import {fetchWarehouseAdministration,saveWarehouse,type ManagedWarehouse,type WarehouseAdministration,type SaveWarehouseInput} from '../../services/supabase/warehouses.service';

export function WarehousesView(){
  const {roleName}=useAuthStore();const {refreshReferenceDataFromSupabase}=useAppStoreActions();
  const [data,setData]=useState<WarehouseAdministration>({branches:[],warehouses:[]});
  const [loading,setLoading]=useState(false),[error,setError]=useState('');
  const [form,setForm]=useState<SaveWarehouseInput|null>(null),[editing,setEditing]=useState<ManagedWarehouse|null>(null);
  const [saving,setSaving]=useState(false),[saveError,setSaveError]=useState('');
  const refresh=useCallback(async()=>{if(roleName!=='owner')return;setLoading(true);setError('');
    try{setData(await fetchWarehouseAdministration());}catch(e){setError(e instanceof Error?e.message:'تعذر تحميل المستودعات.');}finally{setLoading(false);}
  },[roleName]);
  useEffect(()=>{void refresh();},[refresh]);
  if(roleName!=='owner')return <Card className="p-5"><p>إدارة الفروع والمستودعات متاحة للمالك فقط.</p></Card>;
  const open=(warehouse:ManagedWarehouse|null)=>{
    const id=warehouse?.id??crypto.randomUUID();setEditing(warehouse);setSaveError('');
    const activeBranches=data.branches.filter(b=>b.isActive);
    setForm({id,code:warehouse?.code??`WH-${id.replaceAll('-','').slice(0,16).toUpperCase()}`,name:warehouse?.name??'',
      branchId:warehouse?.branchId??(activeBranches.length===1?activeBranches[0].id:''),
      isActive:warehouse?.isActive??true,expectedUpdatedAt:warehouse?.updatedAt??null});
  };
  const submit=async(event:FormEvent)=>{event.preventDefault();if(!form||saving)return;setSaving(true);setSaveError('');
    try{await saveWarehouse(form);await refreshReferenceDataFromSupabase();setForm(null);await refresh();}
    catch(e){setSaveError(e instanceof Error?e.message:'تعذر حفظ المستودع.');}finally{setSaving(false);}
  };
  return <section dir="rtl" className="space-y-4 p-4 text-nw-text" aria-label="الفروع والمستودعات">
    <PageHeader title="الفروع والمستودعات" description="مستودعات المحل وربطها بالفرع"
      actions={<UiButton onClick={()=>open(null)} disabled={loading||!data.branches.some(b=>b.isActive)}><Plus size={18} aria-hidden="true"/>مستودع جديد</UiButton>}/>
    {loading&&<p role="status">جاري تحميل المستودعات…</p>}
    {error&&<Card className="p-4"><p role="alert" className="text-nw-bad">{error}</p><UiButton onClick={()=>void refresh()}>إعادة التحميل</UiButton></Card>}
    <div className="grid gap-3 lg:grid-cols-2">
      {data.warehouses.map(w=><Card key={w.id} data-testid={`warehouse-${w.id}`} className="min-w-0 p-4">
        <div className="flex items-start justify-between gap-3"><h2 className="min-w-0 break-words text-base font-bold">{w.name}</h2>
          <StatusBadge tone={w.isActive?'ok':'mute'}>{w.isActive?'نشط':'متوقف'}</StatusBadge></div>
        <p className="mt-2 text-sm text-nw-muted">{data.branches.find(b=>b.id===w.branchId)?.name??'بلا فرع'}</p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs"><span>{w.hasStockOrReservations?'لديه رصيد أو حجز':'بلا رصيد أو حجز'}</span>
          {w.hasMovements&&<span>له حركات سابقة</span>}{w.hasProductAssociations&&<span>مرتبط بأصناف</span>}</div>
        {!w.isActive&&w.hasStockOrReservations&&<p className="mt-2 text-sm text-nw-warn">المستودع متوقف ولديه بضاعة؛ فعّله ليظهر في اختيارات البيع والاستلام.</p>}
        <UiButton className="mt-3" variant="secondary" onClick={()=>open(w)}><Pencil size={16} aria-hidden="true"/>تعديل المستودع</UiButton>
      </Card>)}
    </div>
    {!loading&&!error&&!data.warehouses.length&&<Card className="p-5"><p>لا يوجد مستودع. أضف مستودع المحل للبدء.</p></Card>}
    <Card className="p-4"><h2 className="font-bold">الفروع</h2><ul className="mt-2 space-y-2">{data.branches.map(b=><li key={b.id} className="flex flex-wrap items-center gap-2">
      <span>{b.name}</span><span className="text-xs text-nw-muted">{b.isActive?'نشط':'متوقف'}</span></li>)}</ul></Card>
    <Modal isOpen={form!==null} onClose={()=>{if(!saving)setForm(null);}} title={editing?'تعديل المستودع':'مستودع جديد'} closeDisabled={saving} confirmUnsavedClose>
      {form&&<form onSubmit={event=>void submit(event)} aria-busy={saving}><FormFields className="space-y-4 p-4">
        <label className="block space-y-2"><span>اسم المستودع</span><input required maxLength={120} minLength={2} value={form.name}
          onChange={event=>setForm({...form,name:event.target.value})} disabled={saving}/></label>
        {data.branches.filter(b=>b.isActive).length===1&&data.branches.find(b=>b.isActive)?.id===form.branchId&&!editing?.hasMovements?<p>الفرع: {data.branches.find(b=>b.id===form.branchId)?.name}</p>:
          <label className="block space-y-2"><span>الفرع</span><select required value={form.branchId} disabled={saving||editing?.hasMovements}
            onChange={event=>setForm({...form,branchId:event.target.value})}><option value="">اختر الفرع</option>
            {data.branches.filter(b=>b.isActive||b.id===form.branchId).map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>}
        {editing?.hasMovements&&<p className="text-sm text-nw-muted">لا يتغير الفرع بعد حركة مخزون. يمكنك تغيير الاسم.</p>}
        <label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={form.isActive} disabled={saving||!!(editing?.isActive&&(editing.hasStockOrReservations||editing.hasMovements||editing.hasProductAssociations))}
          onChange={event=>setForm({...form,isActive:event.target.checked})}/><span>المستودع نشط</span></label>
        {editing?.hasStockOrReservations&&<p className="text-sm text-nw-muted">لا يمكن التعطيل ما دام يوجد رصيد أو حجز.</p>}
        {editing?.hasMovements&&<p className="text-sm text-nw-muted">لا يمكن التعطيل بعد أي حركة مخزون، حتى لو كان الرصيد صفراً. تغيير الاسم مسموح.</p>}
        {editing?.hasProductAssociations&&<p className="text-sm text-nw-muted">لا يمكن تعطيل مستودع مرتبط بصنف، حتى برصيد صفر ودون حركة. تغيير الاسم مسموح.</p>}
        {saveError&&<p role="alert" className="text-nw-bad">{saveError}</p>}
        <UiButton type="submit" disabled={saving||form.name.trim().length<2||!form.branchId} className="w-full">{saving?'جاري الحفظ…':'حفظ المستودع'}</UiButton>
      </FormFields></form>}
    </Modal>
  </section>;
}
