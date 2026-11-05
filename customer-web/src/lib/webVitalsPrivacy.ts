import type { init } from '@sentry/react';
type MonitoringOptions = NonNullable<Parameters<typeof init>[0]>;
export type VitalSpan = Parameters<NonNullable<MonitoringOptions['beforeSendSpan']>>[0];
export type VitalTransaction = Parameters<NonNullable<MonitoringOptions['beforeSendTransaction']>>[0];
import { monitoringScreen } from './monitoringPrivacy';

export const WEB_VITALS_SAMPLE_RATE = 0.05;
export function sampleWebVitals(environment: string | undefined, configured: boolean, random: number): boolean {
  return configured && environment === 'production' && Number.isFinite(random) && random >= 0 && random < WEB_VITALS_SAMPLE_RATE;
}
const hex = (value: unknown, length: number) => typeof value === 'string' && new RegExp(`^[a-f0-9]{${length}}$`, 'u').test(value) ? value : '0'.repeat(length);
const time = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
function measurements(input: VitalSpan['measurements']): VitalSpan['measurements'] {
  const safe: NonNullable<VitalSpan['measurements']> = {};
  for (const key of ['lcp', 'cls', 'inp'] as const) {
    const item = input?.[key];
    if (item && typeof item.value === 'number' && Number.isFinite(item.value) && item.value >= 0 && item.value <= (key === 'cls' ? 100 : 600_000)) {
      safe[key] = { value: item.value, unit: key === 'cls' ? '' : 'millisecond' };
    }
  }
  return safe;
}
/** Fresh objects only: never preserve DOM selectors, input, URLs, HTTP spans or scope. */
export function sanitizeVitalSpan(span: VitalSpan): VitalSpan {
  const op = ['pageload', 'ui.interaction.click', 'ui.interaction.press', 'ui.interaction.hover', 'ui.interaction.drag', 'ui.webvital.lcp', 'ui.webvital.cls'].includes(span.op ?? '') ? span.op : 'ui.webvital';
  return { trace_id: hex(span.trace_id, 32), span_id: hex(span.span_id, 16), start_timestamp: time(span.start_timestamp), timestamp: time(span.timestamp), op, description: 'WEB_VITAL', data: {}, measurements: measurements(span.measurements) };
}
export function sanitizeVitalTransaction(event: VitalTransaction, screen: unknown): VitalTransaction | null {
  if (event.contexts?.trace?.op !== 'pageload') return null;
  return {
    type: 'transaction', platform: 'javascript', transaction: monitoringScreen(screen), transaction_info: { source: 'custom' },
    event_id: hex(event.event_id, 32), start_timestamp: time(event.start_timestamp), timestamp: time(event.timestamp),
    release: /^[a-f0-9]{40}$/u.test(event.release ?? '') ? event.release : undefined,
    environment: event.environment === 'production' ? 'production' : undefined,
    contexts: { trace: { trace_id: hex(event.contexts.trace.trace_id, 32), span_id: hex(event.contexts.trace.span_id, 16), op: 'pageload' } },
    measurements: measurements(event.measurements), spans: [],
  };
}
