import {isSupabaseConfigured, supabase} from '../../lib/supabase';
import type {MonitoringDashboard} from '../../types/monitoring';

const emptyDashboard: MonitoringDashboard = {
  overallStatus: 'unknown',
  counts: {healthy: 0, warning: 0, critical: 0, unknown: 0},
  lastScanAt: null,
  scanErrorCode: null,
  checks: [],
};

export async function getMonitoringDashboard(): Promise<MonitoringDashboard> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('خدمة المراقبة غير متاحة حاليًا.');
  }
  const {data, error} = await supabase.rpc('get_advanced_monitoring_dashboard');
  if (error) throw new Error('تعذر تحميل حالة المراقبة. أعد المحاولة بعد قليل.');
  if (!data || typeof data !== 'object') return emptyDashboard;
  return data as unknown as MonitoringDashboard;
}
