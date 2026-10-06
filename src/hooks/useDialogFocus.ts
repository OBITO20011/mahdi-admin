import {useEffect, useRef} from 'react';
import {activateDialog} from '../utils/dialogFocus';

export function useDialogFocus(open: boolean, onEscape: () => void, protectUnsaved = false) {
  const panel = useRef<HTMLElement>(null);
  const escape = useRef(onEscape);
  escape.current = onEscape;
  useEffect(() => {
    if (!open || !panel.current) return;
    const element = panel.current;
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
      deactivate();
    };
  }, [open, protectUnsaved]);
  return panel;
}
