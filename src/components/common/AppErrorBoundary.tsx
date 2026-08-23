import React, { ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

const staleChunkReloadKey = 'nawasrah:stale-chunk-reload-at';
const staleChunkReloadCooldownMs = 30_000;

function isStaleChunkError(error: Error): boolean {
  return /failed to fetch dynamically imported module|importing a module script failed|error loading dynamically imported module/i.test(
    error.message,
  );
}

function recoverFromStaleChunk(): boolean {
  if (typeof window === 'undefined') return false;

  try {
    const now = Date.now();
    const lastReloadAt = Number(window.sessionStorage.getItem(staleChunkReloadKey));

    if (Number.isFinite(lastReloadAt) && now - lastReloadAt < staleChunkReloadCooldownMs) {
      return false;
    }

    window.sessionStorage.setItem(staleChunkReloadKey, String(now));
    window.location.reload();
    return true;
  } catch {
    return false;
  }
}

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  error: Error | null;
}

export class AppErrorBoundary extends React.Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  declare readonly props: AppErrorBoundaryProps;
  declare setState: (state: Partial<AppErrorBoundaryState>) => void;

  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (isStaleChunkError(error) && recoverFromStaleChunk()) return;

    console.error('[AppErrorBoundary]', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div
        dir="rtl"
        className="m-4 rounded-2xl border border-rose-800 bg-rose-950/60 p-5 text-xs text-rose-200"
      >
        <AlertTriangle className="mb-2 h-6 w-6 text-rose-400" />
        <h2 className="font-black text-white">تعذر عرض هذه الشاشة</h2>
        <p className="mt-1 leading-5">{this.state.error.message}</p>
        <button
          type="button"
          onClick={() => this.setState({ error: null })}
          className="mt-3 flex items-center gap-1.5 rounded-xl bg-slate-800 px-3 py-2 font-bold text-slate-200"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          إعادة المحاولة
        </button>
      </div>
    );
  }
}
