export const MFA_STATUS_TIMEOUT_MS = 12_000;

export class MfaStatusTimeoutError extends Error {
  constructor() {
    super('MFA status request timed out.');
    this.name = 'MfaStatusTimeoutError';
  }
}

export class LatestMfaStatusRequest {
  private sequence = 0;
  private activeRequestId: number | null = null;

  begin(): number | null {
    if (this.activeRequestId !== null) return null;

    this.activeRequestId = ++this.sequence;
    return this.activeRequestId;
  }

  complete(requestId: number): boolean {
    if (this.activeRequestId !== requestId) return false;

    this.activeRequestId = null;
    return true;
  }

  cancel(): void {
    this.sequence += 1;
    this.activeRequestId = null;
  }
}

export class SingleFlightRequest<T> {
  private activeRequest: Promise<T> | null = null;

  run(factory: () => Promise<T>): Promise<T> {
    if (this.activeRequest) return this.activeRequest;

    const request = factory().finally(() => {
      if (this.activeRequest === request) this.activeRequest = null;
    });
    this.activeRequest = request;
    return request;
  }
}

export function withMfaStatusTimeout<T>(
  request: Promise<T>,
  timeoutMs = MFA_STATUS_TIMEOUT_MS
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timeoutId = globalThis.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new MfaStatusTimeoutError());
    }, timeoutMs);

    request.then(
      (value) => {
        if (settled) return;
        settled = true;
        globalThis.clearTimeout(timeoutId);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        globalThis.clearTimeout(timeoutId);
        reject(error);
      }
    );
  });
}
