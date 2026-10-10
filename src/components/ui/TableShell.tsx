/**
 * Package F table shell. Tables scroll inside their own box so the page
 * never scrolls sideways on a phone (spec §9).
 */

import React from 'react';

const join = (...parts: Array<string | false | null | undefined>) =>
  parts.filter(Boolean).join(' ');

/** Native table composition for existing forms; preserves head/body and field handlers. */
export const DataTable: React.FC<React.TableHTMLAttributes<HTMLTableElement> & {caption:string}> =
  ({caption,className,children,style,...rest}) => (
    <div tabIndex={0} role="region" aria-label={caption} className="min-w-0 max-w-full overflow-x-auto rounded-xl border border-nw-border bg-nw-surface">
      <table {...rest} style={{minWidth:720,...style}} className={join('w-full text-right text-sm text-nw-text',className)}>
        <caption className="sr-only">{caption}</caption>{children}
      </table>
    </div>
  );

interface TableShellProps {
  caption: string;
  /** Minimum table width before it scrolls inside the box. */
  minWidth?: number;
  head: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export const TableShell: React.FC<TableShellProps> = ({ caption, minWidth = 720, head, children, footer }) => (
  <div className="overflow-x-auto rounded-2xl border border-nw-border bg-nw-surface">
    <table className="w-full border-collapse text-sm text-nw-text" style={{ minWidth }}>
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr className="bg-nw-surface-2 text-right text-xs text-nw-muted">{head}</tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
    {footer && (
      <div className="flex items-center justify-between gap-3 border-t border-nw-border px-[18px] py-3 text-[13px] text-nw-muted">
        {footer}
      </div>
    )}
  </div>
);

export const Th: React.FC<React.ThHTMLAttributes<HTMLTableCellElement>> = ({ className, children, ...rest }) => (
  <th {...rest} scope="col" className={join('px-3 py-3 font-semibold first:ps-[18px] last:pe-[18px]', className)}>
    {children}
  </th>
);

interface RowProps extends React.HTMLAttributes<HTMLTableRowElement> {
  selected?: boolean;
}

export const Tr: React.FC<RowProps> = ({ selected = false, className, children, ...rest }) => (
  <tr
    {...rest}
    aria-selected={selected || undefined}
    className={join('border-t border-nw-border', selected && 'bg-nw-sel-row', className)}
  >
    {children}
  </tr>
);

export const Td: React.FC<React.TdHTMLAttributes<HTMLTableCellElement>> = ({ className, children, ...rest }) => (
  <td {...rest} className={join('px-3 py-3 first:ps-[18px] last:pe-[18px]', className)}>
    {children}
  </td>
);
