/**
 * Nawasrah Business Manager - iOS Sheet Modal Component
 */

import React, {useEffect, useId, useRef} from 'react';
import {useDialogFocus} from '../../hooks/useDialogFocus';
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
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/80 backdrop-blur-sm p-0 sm:p-4">
          <motion.div
            ref={panel as React.RefObject<HTMLDivElement>}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            onInputCapture={() => { edited.current = true; }}
            onChangeCapture={() => { edited.current = true; }}
            initial={{ y: '100%', opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: '100%', opacity: 0 }}
            transition={{ type: 'spring', damping: 26, stiffness: 220 }}
            className={`w-full ${maxWidth} bg-slate-900 border border-slate-800 rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col ${maxHeight} overflow-hidden`}
          >
            {/* Sheet Drag Handle Indicator */}
            <div className="w-12 h-1 bg-slate-700 rounded-full mx-auto my-2 shrink-0 sm:hidden" />

            {/* Modal Header */}
            <div className="px-5 py-3 border-b border-slate-800 flex items-center justify-between shrink-0 bg-slate-900/80">
              <div>
                <h3 id={titleId} className="text-sm font-bold text-slate-100">{title}</h3>
                {subtitle && <p className="text-[11px] text-slate-400 mt-0.5">{subtitle}</p>}
              </div>
              <button
                type="button"
                disabled={closeDisabled}
                onClick={() => {
                  if (!closeDisabled && !panel.current?.querySelector('[aria-busy="true"]')) onClose();
                }}
                aria-label="إغلاق"
                className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-100 flex items-center justify-center transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Scrollable Body */}
            <div className="p-5 overflow-y-auto flex-1">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
