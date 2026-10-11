import React from 'react';
import { CheckCircle2, Info, XCircle } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

export interface AdminToastValue {
  message: string;
  type: 'success' | 'error' | 'info';
}

interface AdminToastProps {
  toast: AdminToastValue | null;
}

export const AdminToast: React.FC<AdminToastProps> = ({ toast }) => (
  <AnimatePresence>
    {toast && (
      <motion.div
        initial={{ opacity: 0, y: -20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -20, scale: 0.95 }}
        className="pointer-events-none absolute left-4 right-4 top-4 z-50"
      >
        <div
          data-ui="admin-toast"
          data-tone={toast.type}
          role={toast.type === 'error' ? 'alert' : 'status'}
          aria-atomic="true"
          className={`flex items-center gap-3 rounded-2xl border p-3.5 text-xs font-semibold shadow-2xl backdrop-blur-md ${
            toast.type === 'error'
              ? 'border-nw-bad bg-nw-bad-bg text-nw-bad'
              : toast.type === 'info'
                ? 'border-nw-info bg-nw-info-bg text-nw-info'
                : 'border-nw-ok bg-nw-ok-bg text-nw-ok'
          }`}
        >
          {toast.type === 'error' && <XCircle className="h-5 w-5 shrink-0 text-nw-bad" />}
          {toast.type === 'info' && <Info className="h-5 w-5 shrink-0 text-nw-info" />}
          {toast.type === 'success' && <CheckCircle2 className="h-5 w-5 shrink-0 text-nw-ok" />}
          <span className="flex-1 whitespace-pre-line">{toast.message}</span>
        </div>
      </motion.div>
    )}
  </AnimatePresence>
);
