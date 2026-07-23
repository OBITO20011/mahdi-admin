/**
 * Nawasrah Business Manager - Reports Center View
 */

import React from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { BarChart3, FileText, Download, Printer, Share2, Calendar } from 'lucide-react';
import { CURRENCY } from '../../constants';

export const ReportsCenterView: React.FC = () => {
  const { invoices, expenses, orders } = useAppStore();

  const totalSales = invoices.reduce((acc, i) => acc + i.totalAmount, 0);
  const totalExpenses = expenses.reduce((acc, e) => acc + e.amount, 0);

  const reportsList = [
    { title: 'تقرير المبيعات والربحية التفصيلي', desc: 'مبيعات المنتجات حسب الصنف والفرع وطريقة الدفع' },
    { title: 'كشف أعمار ديون العملاء (Aging Report)', desc: 'تحليل الذمم المدينة وتأخر السداد عن 30/60 يوم' },
    { title: 'تقرير حركة وتقييم المخزون', desc: 'قيمة بضاعة آخر المدة والأصناف الراكدة' },
    { title: 'تقرير حركة المقبوضات والصندوق (CliQ/Cash)', desc: 'مطابقة توريدات الخزينة والبنوك والورديات' },
  ];

  return (
    <div className="p-4 space-y-4 pb-24">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-black text-slate-100 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-purple-400" />
            <span>مركز التقارير التحليلية والمالية</span>
          </h2>
          <p className="text-[11px] text-slate-400">نظرة شاملة وتحليلية لأداء المنشأة في الأوقات الفعلية</p>
        </div>
      </div>

      {/* Report Cards Grid */}
      <div className="space-y-2.5">
        {reportsList.map((rep, idx) => (
          <div
            key={idx}
            className="bg-slate-900 border border-slate-800 p-4 rounded-2xl shadow text-xs space-y-2 hover:border-slate-700 transition"
          >
            <div className="flex items-center justify-between">
              <h4 className="font-bold text-slate-100 text-sm">{rep.title}</h4>
              <button
                onClick={() => alert(`جاري تصدير ${rep.title} بصيغة PDF...`)}
                className="bg-purple-600/20 text-purple-300 border border-purple-500/30 px-3 py-1.5 rounded-xl text-[11px] font-bold hover:bg-purple-600/30 transition flex items-center gap-1"
              >
                <Download className="w-3 h-3" />
                <span>تصدير PDF</span>
              </button>
            </div>
            <p className="text-slate-400 text-[11px]">{rep.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
};
