import {useLayoutEffect, useRef} from 'react';
import {activateDialog} from '../utils/dialogFocus';

export function useDialogFocus(open: boolean, onEscape: () => void) {
  const panel = useRef<HTMLElement>(null);
  const escape = useRef(onEscape);
  escape.current = onEscape;
  // Install/remove guards in the display commit, before typing is possible.
  useLayoutEffect(() => {
    if (open && panel.current) return activateDialog(panel.current, () => escape.current());
  }, [open]);
  return panel;
}
