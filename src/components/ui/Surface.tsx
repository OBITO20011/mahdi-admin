/**
 * Package F surfaces: cards, side detail panels and floating action bars.
 * Spec: docs/design/package-f/PACKAGE_F_DESIGN_SPEC.md §3, §5.
 */

import React from 'react';

type DivProps = React.HTMLAttributes<HTMLDivElement>;

const join = (...parts: Array<string | false | null | undefined>) =>
  parts.filter(Boolean).join(' ');

/** White (light) / navy (dark) card with a hairline border and 16px radius. */
export const Card: React.FC<DivProps & { padded?: boolean }> = ({
  padded = true,
  className,
  children,
  ...rest
}) => (
  <div
    {...rest}
    className={join(
      'rounded-2xl border border-nw-border bg-nw-surface text-nw-text',
      padded && 'p-4 sm:p-5',
      className,
    )}
  >
    {children}
  </div>
);

interface SectionHeaderProps {
  id?: string;
  title: React.ReactNode;
  hint?: React.ReactNode;
  action?: React.ReactNode;
}

/** Card title row: bold title, optional muted hint and a trailing action. */
export const SectionHeader: React.FC<SectionHeaderProps> = ({ id, title, hint, action }) => (
  <div className="flex flex-wrap items-center justify-between gap-2">
    <div className="min-w-0">
      <h2 id={id} className="m-0 text-[15px] font-bold text-nw-text">
        {title}
      </h2>
      {hint && <p className="m-0 mt-0.5 text-xs text-nw-muted">{hint}</p>}
    </div>
    {action}
  </div>
);

interface PageHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}

/** Page header bar: 22px title, short description, wrapping actions. */
export const PageHeader: React.FC<PageHeaderProps> = ({ title, description, actions }) => (
  <header className="flex flex-wrap items-center justify-between gap-3 border-b border-nw-border bg-nw-surface px-4 py-4 sm:px-8 sm:py-5">
    <div className="min-w-0">
      <h1 className="m-0 text-[22px] font-bold text-nw-text">{title}</h1>
      {description && <p className="m-0 mt-1 text-[13px] text-nw-muted">{description}</p>}
    </div>
    {actions && <div className="flex flex-wrap gap-2.5">{actions}</div>}
  </header>
);

/**
 * Side detail panel next to a table. Wraps under the table on narrow
 * screens because its parent row uses flex-wrap (see DetailLayout).
 */
export const DetailPanel: React.FC<DivProps> = ({ className, children, ...rest }) => (
  <aside
    {...rest}
    className={join(
      'flex min-w-0 flex-[1_1_340px] flex-col overflow-hidden rounded-2xl border border-nw-border bg-nw-surface text-nw-text lg:max-w-[400px]',
      className,
    )}
  >
    {children}
  </aside>
);

/** Row that holds a main list (grows) and a DetailPanel (wraps when narrow). */
export const DetailLayout: React.FC<DivProps> = ({ className, children, ...rest }) => (
  <div {...rest} className={join('flex flex-wrap items-start gap-5', className)}>
    {children}
  </div>
);

/** The growing main column inside DetailLayout. */
export const MainColumn: React.FC<DivProps> = ({ className, children, ...rest }) => (
  <section {...rest} className={join('flex min-w-0 flex-[999_1_560px] flex-col gap-3.5', className)}>
    {children}
  </section>
);

/**
 * Floating bar pinned above the phone tab bar (cart, customer payment,
 * close shift). Sits 90px from the bottom so the tab bar stays reachable.
 */
export const StickyActionBar: React.FC<DivProps> = ({ className, children, ...rest }) => (
  <div
    {...rest}
    className={join(
      'fixed inset-x-3 bottom-[calc(90px+env(safe-area-inset-bottom))] z-30 flex flex-col gap-2.5 rounded-[18px] border border-nw-border bg-nw-surface p-3 text-nw-text shadow-[0_12px_30px_rgba(11,18,32,0.18)] lg:hidden',
      className,
    )}
  >
    {children}
  </div>
);
