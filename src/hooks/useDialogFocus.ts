import {useLayoutEffect, useRef} from 'react';
import {activateDialog} from '../utils/dialogFocus';

export function useDialogFocus(open: boolean, onEscape: () => void, protectUnsaved = false, inertWhenClosed = false) {
  const panel = useRef<HTMLElement>(null);
  const escape = useRef(onEscape);
  escape.current = onEscape;
  // Commit-phase registration/removal prevents a previous dialog stealing input.
  useLayoutEffect(() => {
    if (!open || !panel.current) return;
    const element = panel.current;
    if (inertWhenClosed) element.inert = false;
    let edited = false;
    const markEdited = () => { edited = true; };
    element.addEventListener('input', markEdited);
    element.addEventListener('change', markEdited);
    const deactivate = activateDialog(element, () => {
      if (!protectUnsaved || !edited) escape.current();
    });
    return () => {
      element.removeEventListener('input', markEdited);
      element.removeEventListener('change', markEdited);
      // AnimatePresence retains an exiting panel in the DOM. It must not
      // regain focus during the commit after we restore its live opener.
      if (inertWhenClosed) element.inert = true;
      deactivate();
    };
  }, [open, protectUnsaved, inertWhenClosed]);
  return panel;
}
