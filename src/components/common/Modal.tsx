/**
 * Nawasrah Business Manager - iOS Sheet Modal Component
 */

import React, {useLayoutEffect, useId, useRef, useState} from 'react';
import {useDialogFocus} from '../../hooks/useDialogFocus';
import {FormFields, UiButton} from '../ui';
import { X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  maxHeight?: string;
  maxWidth?: string;
  closeDisabled?: boolean;
  confirmUnsavedClose?: boolean;
  /** Read-only search filters need no automatic unsaved-input tracking. Explicit busy/unsaved guards stay active. */
  trackChanges?: boolean;
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  maxHeight = 'max-h-[90vh]',
  maxWidth = 'max-w-lg',
  closeDisabled = false,
  confirmUnsavedClose = false,
  trackChanges = true,
}) => {
  const titleId = useId();
  const edited = useRef(false);
  const [showDiscard, setShowDiscard] = useState(false);
  useLayoutEffect(() => { edited.current = false; setShowDiscard(false); }, [isOpen]);
  const discardTitleId = useId();
  // Cleanup is LIFO: release the question before its form if both unmount.
  const discardPanel = useDialogFocus(isOpen && showDiscard, () => setShowDiscard(false));
  const panel = useDialogFocus(isOpen, () => {
    // Escape must not silently discard input or interrupt a submitting child.
    // Explicit Cancel/Save actions retain their existing workflow authority.
    if (closeDisabled || panel.current?.querySelector('[aria-busy="true"]')) return;
    if (edited.current || panel.current?.querySelector('[data-unsaved="true"]')) {
      if (confirmUnsavedClose) setShowDiscard(true);
      return;
    }
    onClose();
  }, false, true);
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-nw-side/80 backdrop-blur-sm p-0 sm:p-4">
          <motion.div
            ref={panel as React.RefObject<HTMLDivElement>}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            data-state="opening"
            tabIndex={-1}
            onInputCapture={() => { if(trackChanges) edited.current = true; }}
            onChangeCapture={() => { if(trackChanges) edited.current = true; }}
            initial={{ y: '100%', opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: '100%', opacity: 0 }}
            transition={{ type: 'spring', damping: 26, stiffness: 220 }}
            onAnimationStart={() => panel.current?.setAttribute('data-state', isOpen ? 'opening' : 'closing')}
            onAnimationComplete={() => panel.current?.setAttribute('data-state', isOpen ? 'open' : 'closed')}
            className={`w-full ${maxWidth} bg-nw-surface border border-nw-border rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col ${maxHeight} overflow-hidden`}
          >
            {/* Sheet Drag Handle Indicator */}
            <div className="w-12 h-1 bg-nw-mute-bg rounded-full mx-auto my-2 shrink-0 sm:hidden" />

            {/* Modal Header */}
            <div className="gap-3 px-5 py-3 border-b border-nw-border flex items-center justify-between shrink-0 bg-nw-surface">
              <div className="min-w-0 flex-1">
                <h3 id={titleId} className="text-sm font-bold text-nw-text">{title}</h3>
                {subtitle && <p className="text-[11px] text-nw-muted mt-0.5">{subtitle}</p>}
              </div>
              <UiButton variant="plain"
                type="button"
                disabled={closeDisabled}
                onClick={() => {
                  if (!closeDisabled && !panel.current?.querySelector('[aria-busy="true"]')) {
                    if (confirmUnsavedClose && edited.current) setShowDiscard(true);
                    else onClose();
                  }
                }}
                aria-label="إغلاق"
                className="h-11 w-11 shrink-0 !px-0 rounded-full bg-nw-surface hover:bg-nw-mute-bg text-nw-muted hover:text-nw-text flex items-center justify-center transition"
              >
                <X className="w-4 h-4" />
              </UiButton>
            </div>

            {/* Modal Scrollable Body */}
            <FormFields className="min-h-0 min-w-0 p-5 overflow-y-auto flex-1">{children}</FormFields>
            {showDiscard && (
              <div className="fixed inset-0 z-[70] flex items-center justify-center bg-nw-side/80 p-4">
                <section ref={discardPanel as React.RefObject<HTMLElement>} role="dialog" aria-modal="true"
                  aria-labelledby={discardTitleId} tabIndex={-1}
                  className="w-full max-w-sm rounded-2xl border border-nw-border bg-nw-surface p-5 text-nw-text shadow-2xl">
                  <h3 id={discardTitleId} className="text-base font-bold">تجاهل التعديلات؟</h3>
                  <p className="mt-2 text-sm text-nw-muted">التعديلات غير محفوظة. يمكنك الرجوع لإكمالها.</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <UiButton type="button" onClick={() => setShowDiscard(false)}>متابعة التعديل</UiButton>
                    <UiButton type="button" variant="danger" onClick={() => {
                      if (closeDisabled || panel.current?.querySelector('[aria-busy="true"]')) return;
                      setShowDiscard(false); onClose();
                    }}>تجاهل التعديلات</UiButton>
                  </div>
                </section>
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
