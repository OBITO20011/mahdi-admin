import React from 'react';
import { formatJod } from './uiFormat';

const wholeAmount = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export interface SalesBarPoint {
  id: string;
  label: string;
  amount: number;
  current?: boolean;
}

/** Signed values are kept visible; a loss is never rendered as positive sales. */
export const SalesBarChart: React.FC<{ points: readonly SalesBarPoint[]; label: string }> = ({ points, label }) => {
  const max = Math.max(1, ...points.map((point) => Math.abs(point.amount)));
  return (
    <figure className="m-0" aria-label={label}>
      <div className="flex gap-2 sm:gap-4">
        {points.map((point) => (
          <div key={point.id} className="min-w-0 flex-1 text-center">
            <div className="flex h-44 flex-col justify-end gap-2">
              <bdi dir="ltr" data-chart-amount className="whitespace-nowrap text-[10px] tabular-nums text-nw-muted sm:text-xs"
                title={`${point.label}: ${formatJod(point.amount)} د.أ`}
                aria-label={`${point.label}: ${formatJod(point.amount)} د.أ`}>
                {wholeAmount.format(point.amount === 0 ? 0 : point.amount)}
              </bdi>
              <div
                aria-hidden="true"
                className={`mx-auto w-full max-w-11 rounded-t-lg ${point.amount < 0 ? 'bg-nw-bad' : point.current ? 'bg-nw-accent' : 'bg-nw-chart-bar'}`}
                style={{ height: `${Math.abs(point.amount) / max * 130}px`, minHeight: point.amount === 0 ? 0 : 2 }}
              />
            </div>
            <p className="mt-2 break-words text-[10px] text-nw-muted sm:text-xs">{point.label}</p>
          </div>
        ))}
      </div>
      <figcaption className="sr-only">{label}؛ القيم السالبة خصم من صافي المبيعات.</figcaption>
    </figure>
  );
};
