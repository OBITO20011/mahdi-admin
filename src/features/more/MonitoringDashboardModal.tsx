import React, {useEffect, useMemo, useState} from 'react';
import {Activity, AlertTriangle, CheckCircle2, CircleHelp, RefreshCw, XCircle} from 'lucide-react';
import {getMonitoringDashboard} from '../../services/supabase/monitoring.service';
import type {MonitoringCheck, MonitoringDashboard, MonitoringHealthStatus} from '../../types/monitoring';

const statusMeta: Record<MonitoringHealthStatus, {label: string; className: string; icon: React.ComponentType<{className?: string}>}> = {
  healthy: {label: 'سليم', className: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300', icon: CheckCircle2},
  warning: {label: 'تنبيه', className: 'border-amber-500/25 bg-amber-500/10 text-amber-300', icon: AlertTriangle},
  critical: {label: 'حرج', className: 'border-rose-500/25 bg-rose-500/10 text-rose-300', icon: XCircle},
  unknown: {label: 'غير معروف', className: 'border-slate-600 bg-slate-800 text-slate-300', icon: CircleHelp},
};

const categoryLabels: Record<string, string> = {
  database: 'قاعدة البيانات', inventory: 'المخزون', accounting: 'المحاسبة', orders: 'الطلبات',
  shifts: 'الورديات', automation: 'الأتمتة', performance: 'الأداء', security: 'الأمان',
  runtime: 'أخطاء التشغيل', backup: 'النسخ والاستعادة', infrastructure: 'Docker وn8n', deployment: 'CI والنشر',
};

const groupChecks = (checks: MonitoringCheck[]) => checks.reduce<Record<string, MonitoringCheck[]>>((groups, item) => {
  (groups[item.category] ??= []).push(item);
  return groups;
}, {});

export const MonitoringDashboardModal: React.FC = () => {
  const [dashboard, setDashboard] = useState<MonitoringDashboard | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    setError('');
    try { setDashboard(await getMonitoringDashboard()); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'تعذر تحميل حالة المراقبة.'); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);
  const groups: Record<string, MonitoringCheck[]> = useMemo(
    () => groupChecks(dashboard?.checks ?? []),
    [dashboard],
  );

  if (loading) return <div className="flex min-h-56 items-center justify-center text-sm text-slate-300">جاري قراءة آخر فحوص المراقبة…</div>;
  if (error) return <div className="space-y-4 rounded-2xl border border-rose-500/25 bg-rose-950/30 p-5 text-center"><p className="text-sm font-bold text-rose-200">{error}</p><button type="button" onClick={() => void load()} className="min-h-11 rounded-xl bg-slate-100 px-4 text-xs font-black text-slate-950">إعادة المحاولة</button></div>;

  const overall = statusMeta[dashboard?.overallStatus ?? 'unknown'];
  const OverallIcon = overall.icon;
  return (
    <div dir="rtl" className="space-y-4">
      <section className={`rounded-2xl border p-4 ${overall.className}`}>
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-sm font-black"><OverallIcon className="h-5 w-5" />الحالة العامة: {overall.label}</span>
          <button type="button" onClick={() => void load()} className="flex min-h-11 items-center gap-2 rounded-xl border border-current/20 px-3 text-xs font-bold"><RefreshCw className="h-4 w-4" />تحديث</button>
        </div>
        <p className="mt-2 text-[11px] opacity-80">آخر فحص: {dashboard?.lastScanAt ? new Date(dashboard.lastScanAt).toLocaleString('ar-JO') : 'غير متاح'}</p>
      </section>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(Object.keys(statusMeta) as MonitoringHealthStatus[]).map((status) => {
          const meta = statusMeta[status]; const Icon = meta.icon;
          return <div key={status} className={`rounded-xl border p-3 ${meta.className}`}><Icon className="mb-1 h-4 w-4" /><strong className="block text-lg">{dashboard?.counts[status] ?? 0}</strong><span className="text-[10px] font-bold">{meta.label}</span></div>;
        })}
      </div>

      <div className="space-y-3">
        {(Object.entries(groups) as Array<[string, MonitoringCheck[]]>).map(([category, checks]) => (
          <section key={category} className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/70">
            <h3 className="flex items-center gap-2 border-b border-slate-800 px-4 py-3 text-xs font-black text-slate-100"><Activity className="h-4 w-4 text-blue-300" />{categoryLabels[category] ?? category}</h3>
            <div className="divide-y divide-slate-800">
              {checks.map((item) => { const meta=statusMeta[item.status]; const Icon=meta.icon; return (
                <div key={item.key} className="flex items-start justify-between gap-3 p-3">
                  <div className="min-w-0"><p className="text-xs font-bold text-slate-200">{item.summary}</p><p className="mt-1 text-[10px] text-slate-500">آخر تحقق: {new Date(item.checkedAt).toLocaleString('ar-JO')}</p></div>
                  <span className={`flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-[9px] font-black ${meta.className}`}><Icon className="h-3 w-3" />{meta.label}{item.issueCount > 0 ? ` · ${item.issueCount}` : ''}</span>
                </div>
              );})}
            </div>
          </section>
        ))}
      </div>
      <p className="text-center text-[10px] leading-5 text-slate-500">اللوحة للقراءة فقط ولا تُجري أي إصلاح تلقائي. التفاصيل الحساسة لا تُعرض هنا.</p>
    </div>
  );
};
