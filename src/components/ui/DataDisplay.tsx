/**
 * Package F data display: KPI cards, status pills, money, stock and
 * debt-age bars. Spec §2, §5, §7.
 */

import React from 'react';
import {
  formatJod,
  ratioToPercent,
  toneClasses,
  toneFillClasses,
  toneTextClasses,
  type UiTone,
} from './uiFormat';

const join = (...parts: Array<string | false | null | undefined>) =>
  parts.filter(Boolean).join(' ');

interface MoneyTextProps {
  amount: number;
  /** Show the smaller muted "د.أ" suffix. */
  currency?: boolean;
  className?: string;
}

/** Dinar amount with three decimals, isolated LTR and tabular digits. */
export const MoneyText: React.FC<MoneyTextProps> = ({ amount, currency = false, className }) => (
  <bdi dir="ltr" className={join('nw-num', className)}>
    {formatJod(amount)}
    {currency && <span className="ms-1 text-[0.55em] font-medium text-nw-muted">د.أ</span>}
  </bdi>
);

interface StatusBadgeProps {
  tone: UiTone;
  children: React.ReactNode;
  className?: string;
}

/** Pill with a token tone; the Arabic label always carries the meaning. */
export const StatusBadge: React.FC<StatusBadgeProps> = ({ tone, children, className }) => (
  <span
    className={join(
      'inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold',
      toneClasses[tone],
      className,
    )}
  >
    {children}
  </span>
);

interface KpiCardProps {
  label: React.ReactNode;
  value: React.ReactNode;
  note?: React.ReactNode;
  /** Optional trend or status pill shown next to the label. */
  badge?: React.ReactNode;
  valueTone?: UiTone;
  className?: string;
}

/** Muted label, large tabular value, small note. */
export const KpiCard: React.FC<KpiCardProps> = ({ label, value, note, badge, valueTone, className }) => (
  <div
    className={join(
      'flex min-w-0 flex-col gap-1.5 rounded-2xl border border-nw-border bg-nw-surface px-[18px] py-4',
      className,
    )}
  >
    <div className="flex items-start justify-between gap-2">
      <span className="text-[13px] text-nw-muted">{label}</span>
      {badge}
    </div>
    <div
      className={join(
        'nw-num truncate text-right text-2xl font-bold',
        valueTone ? toneTextClasses[valueTone] : 'text-nw-text',
      )}
    >
      {value}
    </div>
    {note && <span className="text-xs text-nw-muted">{note}</span>}
  </div>
);

/** Responsive KPI grid: as many 210px+ columns as fit. */
export const KpiGrid: React.FC<React.HTMLAttributes<HTMLDivElement> & { phonePairs?: boolean }> = ({ phonePairs = false, className, children, ...rest }) => (
  <div {...rest} className={join('grid gap-3.5', phonePairs ? 'grid-cols-2 lg:grid-cols-[repeat(auto-fit,minmax(210px,1fr))]' : 'grid-cols-[repeat(auto-fit,minmax(210px,1fr))]', className)}>
    {children}
  </div>
);

interface StockBarProps {
  value: number;
  max: number;
  tone: UiTone;
  label?: string;
}

/** 6px progress bar for stock against its reorder ceiling or debt vs limit. */
export const StockBar: React.FC<StockBarProps> = ({ value, max, tone, label }) => (
  <div
    role="meter"
    aria-label={label}
    aria-valuemin={0}
    aria-valuemax={max}
    aria-valuenow={Math.max(0, Math.min(value, max))}
    className="h-1.5 overflow-hidden rounded-full bg-nw-track"
  >
    <div className={join('h-full rounded-full', toneFillClasses[tone])} style={{ width: ratioToPercent(value, max) }} />
  </div>
);

export interface AgingSegment {
  label: string;
  amount: number;
  tone: UiTone;
}

interface AgingBarProps {
  segments: readonly AgingSegment[];
  caption?: string;
}

/** Stacked debt-age bar with a legend of labels and amounts (spec §7). */
export const AgingBar: React.FC<AgingBarProps> = ({ segments, caption }) => {
  const total = segments.reduce((sum, segment) => sum + Math.max(0, segment.amount), 0);
  return (
    <figure className="m-0 flex flex-col gap-3">
      <div className="flex h-3.5 gap-[3px] overflow-hidden rounded-full bg-nw-track" aria-hidden="true">
        {total > 0 &&
          segments
            .filter((segment) => segment.amount > 0)
            .map((segment) => (
              <div
                key={segment.label}
                className={toneFillClasses[segment.tone]}
                style={{ flexGrow: segment.amount, flexBasis: 0 }}
              />
            ))}
      </div>
      <figcaption className="flex flex-wrap gap-x-7 gap-y-2 text-[13px]">
        {caption && <span className="sr-only">{caption}</span>}
        {segments.map((segment) => (
          <span key={segment.label} className="inline-flex items-center gap-2">
            <span className={join('h-2.5 w-2.5 rounded-[3px]', toneFillClasses[segment.tone])} />
            <span className="text-nw-muted">{segment.label}</span>
            <MoneyText amount={segment.amount} className="font-bold" />
          </span>
        ))}
      </figcaption>
    </figure>
  );
};
