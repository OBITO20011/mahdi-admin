export class RequestTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RequestTimeoutError';
  }
}

/**
 * Runs one browser request with a hard deadline and aborts the underlying fetch.
 * This keeps operational screens from displaying an endless loading skeleton
 * when the device changes network or Supabase temporarily stops responding.
 */
export function runWithTimeout<T>(
  operation: (signal: AbortSignal) => PromiseLike<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  const controller = new AbortController();

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      callback();
    };

    const timer = window.setTimeout(() => {
      controller.abort();
      settle(() => reject(new RequestTimeoutError(timeoutMessage)));
    }, timeoutMs);

    try {
      Promise.resolve(operation(controller.signal)).then(
        (value) => settle(() => resolve(value)),
        (error: unknown) => settle(() => reject(error)),
      );
    } catch (error) {
      settle(() => reject(error));
    }
  });
}

