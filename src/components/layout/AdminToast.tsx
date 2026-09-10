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
              ? 'border-red-800 bg-red-950/95 text-red-200'
              : toast.type === 'info'
                ? 'border-blue-800 bg-blue-950/95 text-blue-200'
                : 'border-emerald-800 bg-emerald-950/95 text-emerald-200'
          }`}
        >
          {toast.type === 'error' && <XCircle className="h-5 w-5 shrink-0 text-red-400" />}
          {toast.type === 'info' && <Info className="h-5 w-5 shrink-0 text-blue-400" />}
          {toast.type === 'success' && <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" />}
          <span className="flex-1">{toast.message}</span>
        </div>
      </motion.div>
    )}
  </AnimatePresence>
);
