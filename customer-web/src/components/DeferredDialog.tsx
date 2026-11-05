import { Suspense, useEffect, useState, type ReactNode } from 'react';

/** Load on first use, then keep mounted so closing never resets a form or recovery state. */
export function DeferredDialog({ open, children }: { open: boolean; children: ReactNode }) {
  const [visited, setVisited] = useState(open);
  useEffect(() => { if (open) setVisited(true); }, [open]);
  if (!open && !visited) return null;
  return <Suspense fallback={open ? <p role="status" className="fixed bottom-24 inset-x-4 z-[80] rounded-xl bg-white p-3 text-center text-sm shadow">جارٍ تحميل النافذة…</p> : null}>{children}</Suspense>;
}
