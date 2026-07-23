/**
 * Nawasrah Business Manager - iOS iPhone Frame Wrapper & Container
 */

import React, { useState } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import {
  Wifi,
  Battery,
  ShieldCheck,
  Smartphone,
  Maximize2,
  Minimize2,
  Scan,
  RefreshCw,
  X,
  Bell,
  Radio,
  Sliders,
  CheckCircle2,
  XCircle,
  Info,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface IPhoneContainerProps {
  children: React.ReactNode;
}

export const IPhoneContainer: React.FC<IPhoneContainerProps> = ({ children }) => {
  const {
    isLockedWithFaceId,
    unlockFaceId,
    isOffline,
    toggleOfflineMode,
    toast,
    databaseMode,
    simulateNewIncomingWebsiteOrder,
    currentUser,
    switchRole,
  } = useAppStore();

  const [isFrameMode, setIsFrameMode] = useState<boolean>(true);
  const [showRoleSwitcher, setShowRoleSwitcher] = useState<boolean>(false);

  return (
    <div
      dir="rtl"
      className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-0 md:p-4 font-sans select-none overflow-x-hidden"
    >
      {/* Top Outer Control Toolbar for AI Studio Preview & QA Testers */}
      <div className="w-full max-w-5xl bg-slate-900/90 backdrop-blur-md border border-slate-800 rounded-2xl p-3 mb-3 hidden md:flex items-center justify-between shadow-2xl text-xs text-slate-300">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-blue-950/80 border border-blue-800/60 text-blue-300 px-3 py-1.5 rounded-full font-semibold">
            <Smartphone className="w-4 h-4 text-blue-400" />
            <span>Expo Go / iOS Standalone App</span>
          </div>
          <button
            onClick={() => setIsFrameMode(!isFrameMode)}
            className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-xl border border-slate-700 transition"
          >
            {isFrameMode ? (
              <>
                <Maximize2 className="w-3.5 h-3.5" /> <span>عرض ملء الشاشة</span>
              </>
            ) : (
              <>
                <Minimize2 className="w-3.5 h-3.5" /> <span>إطار iPhone 16 Pro</span>
              </>
            )}
          </button>
          <button
            onClick={toggleOfflineMode}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border transition ${
              isOffline
                ? 'bg-amber-950/80 border-amber-700 text-amber-300'
                : 'bg-emerald-950/80 border-emerald-700 text-emerald-300'
            }`}
          >
            <Radio className="w-3.5 h-3.5 animate-pulse" />
            <span>{isOffline ? 'وضع بدون إنترنت (Offline)' : 'متصل بالسيرفر (Online)'}</span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          {/* Incoming Order Simulator Button */}
          <button
            onClick={simulateNewIncomingWebsiteOrder}
            className="flex items-center gap-1.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white px-3 py-1.5 rounded-xl font-medium shadow-md transition"
          >
            <Bell className="w-3.5 h-3.5 animate-bounce text-amber-300" />
            <span>محاكاة وصول طلب أونلاين</span>
          </button>

          {/* Role Switcher Guard Debug */}
          <button
            onClick={() => setShowRoleSwitcher(!showRoleSwitcher)}
            className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-xl border border-slate-700 text-slate-300 transition"
          >
            <Sliders className="w-3.5 h-3.5 text-blue-400" />
            <span>الدور الحالي: {currentUser.role}</span>
          </button>
        </div>
      </div>

      {/* Role Quick Switcher Drawer */}
      <AnimatePresence>
        {showRoleSwitcher && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="w-full max-w-5xl bg-slate-900 border border-slate-800 rounded-2xl p-4 mb-3 text-xs grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2"
          >
            {[
              'Owner',
              'Admin',
              'Accountant',
              'Cashier',
              'Sales Employee',
              'Warehouse Employee',
              'Orders Employee',
              'Delivery Driver',
              'View Only',
            ].map((role) => (
              <button
                key={role}
                onClick={() => {
                  switchRole(role as any);
                  setShowRoleSwitcher(false);
                }}
                className={`p-2 rounded-xl text-right font-medium transition border ${
                  currentUser.role === role
                    ? 'bg-blue-600 border-blue-400 text-white'
                    : 'bg-slate-800 border-slate-700 hover:bg-slate-750 text-slate-300'
                }`}
              >
                {role}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Device Outer Housing */}
      <div
        className={`relative transition-all duration-300 ${
          isFrameMode
            ? 'w-full max-w-[420px] h-[880px] rounded-[54px] border-[10px] border-slate-800 bg-slate-900 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.9)] p-0 overflow-hidden ring-1 ring-slate-700'
            : 'w-full max-w-4xl h-[90vh] rounded-3xl border border-slate-800 bg-slate-900 shadow-2xl overflow-hidden'
        }`}
      >
        {/* Dynamic Island / iPhone Notch */}
        {isFrameMode && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 w-32 h-7 bg-black rounded-full z-50 flex items-center justify-between px-3 text-white pointer-events-none shadow-md">
            <div className="w-2.5 h-2.5 bg-blue-500 rounded-full animate-pulse" />
            <div className="w-3.5 h-3.5 bg-slate-800 rounded-full border border-slate-700 flex items-center justify-center">
              <div className="w-1.5 h-1.5 bg-slate-900 rounded-full" />
            </div>
          </div>
        )}

        {/* iOS Top Status Bar */}
        <div className="bg-slate-900 text-slate-200 px-6 pt-3 pb-1 flex items-center justify-between text-xs font-semibold z-40 select-none border-b border-slate-800/50">
          <span>9:41</span>
          <div className="flex items-center gap-2">
            {isOffline && <span className="text-[10px] text-amber-400 font-bold bg-amber-950/80 px-1.5 py-0.5 rounded">Off</span>}
            <Wifi className="w-3.5 h-3.5 text-slate-300" />
            <Battery className="w-4 h-4 text-emerald-400" />
          </div>
        </div>

        {/* Screen Content Wrapper */}
        <div className="relative w-full h-[calc(100%-28px)] bg-slate-950 text-slate-100 overflow-hidden flex flex-col">
          {children}

          {/* Toast Notification Container */}
          <AnimatePresence>
            {toast && (
              <motion.div
                initial={{ opacity: 0, y: -20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -20, scale: 0.95 }}
                className="absolute top-4 left-4 right-4 z-50 pointer-events-none"
              >
                <div
                  className={`flex items-center gap-3 p-3.5 rounded-2xl shadow-2xl backdrop-blur-md border text-xs font-semibold ${
                    toast.type === 'error'
                      ? 'bg-red-950/95 border-red-800 text-red-200'
                      : toast.type === 'info'
                      ? 'bg-blue-950/95 border-blue-800 text-blue-200'
                      : 'bg-emerald-950/95 border-emerald-800 text-emerald-200'
                  }`}
                >
                  {toast.type === 'error' && <XCircle className="w-5 h-5 text-red-400 shrink-0" />}
                  {toast.type === 'info' && <Info className="w-5 h-5 text-blue-400 shrink-0" />}
                  {toast.type === 'success' && <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />}
                  <span className="flex-1">{toast.message}</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Face ID Biometric Lock Overlay */}
          <AnimatePresence>
            {isLockedWithFaceId && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 z-50 bg-slate-950/95 backdrop-blur-xl flex flex-col items-center justify-center p-6 text-center"
              >
                <div className="w-20 h-20 bg-blue-600/20 rounded-full border border-blue-500/40 flex items-center justify-center mb-6 shadow-inner">
                  <Scan className="w-10 h-10 text-blue-400 animate-pulse" />
                </div>
                <h3 className="text-lg font-bold text-slate-100 mb-1">Face ID مصفحة بالأمان</h3>
                <p className="text-xs text-slate-400 mb-8 max-w-xs leading-relaxed">
                  تطبيق Nawasrah Business Manager مغلق. يرجى تأكيد الهوية بالوجه للدخول.
                </p>
                <button
                  onClick={unlockFaceId}
                  className="w-full max-w-xs bg-blue-600 hover:bg-blue-500 text-white font-bold py-3.5 px-6 rounded-2xl shadow-lg transition active:scale-98 flex items-center justify-center gap-2 text-sm"
                >
                  <ShieldCheck className="w-4 h-4" />
                  <span>تأكيد الهوية بـ Face ID</span>
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* iOS Home Indicator Bar */}
        {isFrameMode && (
          <div className="absolute bottom-1 left-1/2 -translate-x-1/2 w-32 h-1 bg-slate-500 rounded-full z-50 pointer-events-none" />
        )}
      </div>
    </div>
  );
};
