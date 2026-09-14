export const MFA_STATUS_TIMEOUT_MS = 12_000;
export const MAX_MFA_STATUS_ORPHANED_REQUESTS = 2;

export class MfaStatusTimeoutError extends Error {
  constructor() {
    super('MFA status request timed out.');
    this.name = 'MfaStatusTimeoutError';
  }
}

export class MfaStatusRecoveryExhaustedError extends Error {
  constructor() {
    super('MFA status recovery attempts are exhausted.');
    this.name = 'MfaStatusRecoveryExhaustedError';
  }
}

export class MfaStatusStaleAttemptError extends Error {
  constructor() {
    super('MFA status request is stale.');
    this.name = 'MfaStatusStaleAttemptError';
  }
}

export interface MfaStatusAttempt {
  generation: number;
  isCurrent: () => boolean;
  assertCurrent: () => void;
}

export interface MfaStatusRequestDiagnostics {
  logicalCalls: number;
  generationsCreated: number;
  generationsTimedOut: number;
  acceptedResults: number;
  ignoredStaleResults: number;
  activeGeneration: number | null;
  orphanedRequests: number;
  maximumObservedUnderlyingRequests: number;
}

interface ActiveRequest<T> {
  generation: number;
  result: Promise<T>;
}

/**
 * Shares one bounded MFA status attempt between concurrent callers. A timeout
 * invalidates the complete generation, while an explicit later call can start
 * one fresh recovery attempt. The SDK promise cannot be cancelled, so stale
 * completions are consumed and ignored until they settle.
 */
export class RecoverableMfaStatusRequest<T> {
  private sequence = 0;
  private activeRequest: ActiveRequest<T> | null = null;
  private readonly orphanedGenerations = new Set<number>();
  private readonly diagnostics: MfaStatusRequestDiagnostics = {
    logicalCalls: 0,
    generationsCreated: 0,
    generationsTimedOut: 0,
    acceptedResults: 0,
    ignoredStaleResults: 0,
    activeGeneration: null,
    orphanedRequests: 0,
    maximumObservedUnderlyingRequests: 0,
  };

  constructor(
    private readonly timeoutMs = MFA_STATUS_TIMEOUT_MS,
    private readonly maxOrphanedRequests = MAX_MFA_STATUS_ORPHANED_REQUESTS
  ) {}

  run(factory: (attempt: MfaStatusAttempt) => Promise<T>): Promise<T> {
    this.diagnostics.logicalCalls += 1;
    if (this.activeRequest) return this.activeRequest.result;

    if (this.orphanedGenerations.size >= this.maxOrphanedRequests) {
      return Promise.reject(new MfaStatusRecoveryExhaustedError());
    }

    const generation = ++this.sequence;
    this.diagnostics.generationsCreated += 1;

    const attempt: MfaStatusAttempt = {
      generation,
      isCurrent: () => this.activeRequest?.generation === generation,
      assertCurrent: () => {
        if (this.activeRequest?.generation !== generation) {
          throw new MfaStatusStaleAttemptError();
        }
      },
    };

    // Deferring the factory lets activeRequest be assigned before the first
    // current-generation check runs.
    const underlyingRequest = Promise.resolve().then(() => factory(attempt));
    let timedOut = false;

    const result = new Promise<T>((resolve, reject) => {
      const timeoutId = globalThis.setTimeout(() => {
        if (this.activeRequest?.generation !== generation) return;

        timedOut = true;
        this.activeRequest = null;
        this.orphanedGenerations.add(generation);
        this.diagnostics.generationsTimedOut += 1;
        this.updateDiagnostics();
        reject(new MfaStatusTimeoutError());
      }, this.timeoutMs);

      underlyingRequest.then(
        (value) => {
          if (timedOut || this.activeRequest?.generation !== generation) {
            this.finishStaleGeneration(generation);
            return;
          }

          globalThis.clearTimeout(timeoutId);
          this.activeRequest = null;
          this.diagnostics.acceptedResults += 1;
          this.updateDiagnostics();
          resolve(value);
        },
        (error: unknown) => {
          if (timedOut || this.activeRequest?.generation !== generation) {
            this.finishStaleGeneration(generation);
            return;
          }

          globalThis.clearTimeout(timeoutId);
          this.activeRequest = null;
          this.updateDiagnostics();
          reject(error);
        }
      );
    });

    this.activeRequest = { generation, result };
    this.updateDiagnostics();
    return result;
  }

  getDiagnostics(): Readonly<MfaStatusRequestDiagnostics> {
    return { ...this.diagnostics };
  }

  private finishStaleGeneration(generation: number): void {
    if (this.orphanedGenerations.delete(generation)) {
      this.diagnostics.ignoredStaleResults += 1;
      this.updateDiagnostics();
    }
  }

  private updateDiagnostics(): void {
    this.diagnostics.activeGeneration = this.activeRequest?.generation ?? null;
    this.diagnostics.orphanedRequests = this.orphanedGenerations.size;
    this.diagnostics.maximumObservedUnderlyingRequests = Math.max(
      this.diagnostics.maximumObservedUnderlyingRequests,
      this.orphanedGenerations.size + (this.activeRequest ? 1 : 0)
    );
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
