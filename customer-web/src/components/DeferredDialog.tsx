import { Suspense, cloneElement, useEffect, useState, type ReactElement } from 'react';

type DialogElement = ReactElement<{isOpen: boolean}>;
/** Emulate the original hidden first commit, including StrictMode effect replay.
 * A newly loaded form must not restore focus after the user has begun typing.
 * This subtree commits only after its lazy child has resolved. */
function MountedDialog({children}: {children: DialogElement}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  return cloneElement(children, {isOpen: mounted && children.props.isOpen});
}
/** Load on first use, then keep mounted so closing never resets a form or recovery state. */
export function DeferredDialog({ open, children }: { open: boolean; children: DialogElement }) {
  const [visited, setVisited] = useState(open);
  useEffect(() => { if (open) setVisited(true); }, [open]);
  if (!open && !visited) return null;
  return <Suspense fallback={open ? <p role="status" className="fixed bottom-24 inset-x-4 z-[80] rounded-xl bg-white p-3 text-center text-sm shadow">جارٍ تحميل النافذة…</p> : null}><MountedDialog>{children}</MountedDialog></Suspense>;
}
