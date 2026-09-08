export type MonitoringHealthStatus = 'healthy' | 'warning' | 'critical' | 'unknown';

export interface MonitoringCheck {
  key: string;
  category: string;
  source: 'database' | 'external';
  status: MonitoringHealthStatus;
  severity: 'low' | 'medium' | 'high' | 'critical';
  issueCount: number;
  summary: string;
  details: Record<string, unknown>;
  checkedAt: string;
  changedAt: string;
}

export interface MonitoringDashboard {
  overallStatus: MonitoringHealthStatus;
  counts: Record<MonitoringHealthStatus, number>;
  lastScanAt: string | null;
  scanErrorCode: string | null;
  checks: MonitoringCheck[];
}
