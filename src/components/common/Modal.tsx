/**
 * Nawasrah Business Manager - iOS Sheet Modal Component
 */

import React, {useEffect, useId, useRef} from 'react';
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
}) => {
  const titleId = useId();
  const edited = useRef(false);
  useEffect(() => { edited.current = false; }, [isOpen]);
  const panel = useDialogFocus(isOpen, () => {
    // Escape must not silently discard input or interrupt a submitting child.
    // Explicit Cancel/Save actions retain their existing workflow authority.
    if (!edited.current && !closeDisabled
      && !panel.current?.querySelector('[aria-busy="true"], [data-unsaved="true"]')) onClose();
  });
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
            onInputCapture={() => { edited.current = true; }}
            onChangeCapture={() => { edited.current = true; }}
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
                  if (!closeDisabled && !panel.current?.querySelector('[aria-busy="true"]')) onClose();
                }}
                aria-label="إغلاق"
                className="h-11 w-11 shrink-0 !px-0 rounded-full bg-nw-surface hover:bg-nw-mute-bg text-nw-muted hover:text-nw-text flex items-center justify-center transition"
              >
                <X className="w-4 h-4" />
              </UiButton>
            </div>

            {/* Modal Scrollable Body */}
            <FormFields className="min-h-0 min-w-0 p-5 overflow-y-auto flex-1">{children}</FormFields>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
