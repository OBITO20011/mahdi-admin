import { CartItem } from '../types/catalog';
import {
  GuestOrderReceipt,
  GuestOrderRequest,
  PersistedCheckoutAttemptV2,
} from '../types/checkout';
import { submitGuestCustomerOrder } from './orders.service';
import {
  CommerceStorageRepository,
  CommerceStorageSnapshot,
} from './commerceStorage';

type DurableRequest = Omit<GuestOrderRequest, 'turnstileToken'>;

export type CheckoutCoordinatorResult =
  | {
      status: 'RECONCILED' | 'SERVER_SUCCEEDED_PENDING' | 'BLOCKED_CART' | 'REVIEW_REQUIRED';
      receipt?: GuestOrderReceipt;
      snapshot: CommerceStorageSnapshot;
    }
  | {
      status: 'UNKNOWN' | 'REJECTED';
      snapshot: CommerceStorageSnapshot;
      message: string;
    }
  | {
      status: 'SERVER_SUCCESS_MEMORY_ONLY';
      receipt: GuestOrderReceipt;
      attempt: PersistedCheckoutAttemptV2;
      message: string;
    };

export interface CheckoutGateway {
  (request: GuestOrderRequest): Promise<GuestOrderReceipt>;
}

const DEFAULT_GATEWAY_OUTCOME_TIMEOUT_MS = 30_000;

class GatewayOutcomeTimeoutError extends Error {
  readonly outcomeUnknown = true;

  constructor() {
    super('انتهت مهلة انتظار الرد بعد إرسال الطلب. حالة الطلب غير معروفة؛ أعد التحقق بنفس المحاولة.');
    this.name = 'GatewayOutcomeTimeoutError';
  }
}

async function waitForGatewayOutcome<T>(request: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new GatewayOutcomeTimeoutError()), timeoutMs);
  });
  try {
    return await Promise.race([request, timeout]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function newId(): string {
  if (!globalThis.crypto?.randomUUID) {
    throw new Error('المتصفح لا يدعم إنشاء هوية آمنة لمحاولة الطلب.');
  }
  return globalThis.crypto.randomUUID();
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : 'تعذر إرسال الطلب.';
}

function outcomeUnknown(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'outcomeUnknown' in error &&
    (error as { outcomeUnknown?: unknown }).outcomeUnknown === true
  );
}

function nextAttempt(
  attempt: PersistedCheckoutAttemptV2,
  patch: Partial<PersistedCheckoutAttemptV2>
): PersistedCheckoutAttemptV2 {
  return {
    ...attempt,
    ...patch,
    version: 2,
    revision: attempt.revision + 1,
    attemptId: attempt.attemptId,
    submissionGeneration: attempt.submissionGeneration,
    idempotencyKey: attempt.idempotencyKey,
    clientSessionId: attempt.clientSessionId,
    request: attempt.request,
    submittedItems: attempt.submittedItems,
    createdAt: attempt.createdAt,
    updatedAt: Date.now(),
  };
}

export class CheckoutRecoveryCoordinator {
  constructor(
    private readonly repository: CommerceStorageRepository,
    private readonly gateway: CheckoutGateway = submitGuestCustomerOrder,
    private readonly gatewayOutcomeTimeoutMs = DEFAULT_GATEWAY_OUTCOME_TIMEOUT_MS
  ) {}

  read(): CommerceStorageSnapshot {
    return this.repository.readSnapshot();
  }

  async dismissResolved(attemptId: string): Promise<void> {
    await this.repository.clearResolvedAttempt(attemptId);
  }

  async prepare(request: DurableRequest, submittedItems: CartItem[]): Promise<PersistedCheckoutAttemptV2> {
    const snapshot = this.repository.readSnapshot();
    if (!this.repository.isSafeCoordinationSupported()) {
      throw new Error('هذا المتصفح لا يدعم تنسيقًا آمنًا لمحاولة الطلب.');
    }
    if (snapshot.reviewReason || snapshot.journalPending) {
      throw new Error('توجد حالة حفظ تحتاج مراجعة قبل بدء طلب جديد.');
    }
    if (snapshot.attempt.status === 'VALID' && snapshot.attempt.attempt) {
      const current = snapshot.attempt.attempt;
      const terminal =
        current.serverState === 'REJECTED' ||
        current.serverState === 'ABANDONED' ||
        (current.serverState === 'SUCCEEDED' && current.reconciliationState === 'APPLIED');
      if (!terminal) throw new Error('يوجد طلب سابق غير محسوم. استكمل استرداده أولًا.');
      await this.repository.clearResolvedAttempt(current.attemptId);
      if (this.repository.readSnapshot().attempt.status !== 'ABSENT') {
        throw new Error('لا يمكن بدء طلب جديد قبل إثبات تسوية المحاولة السابقة وتنظيفها بأمان.');
      }
    } else if (snapshot.attempt.status !== 'ABSENT') {
      throw new Error('دليل محاولة سابقة يحتاج مراجعة قبل المتابعة.');
    }
    if (!snapshot.cart.envelope || !['VALID', 'VALID_EMPTY', 'ABSENT'].includes(snapshot.cart.status)) {
      throw new Error('السلة المحفوظة تحتاج معالجة صريحة قبل إتمام الطلب.');
    }
    const now = Date.now();
    const attempt: PersistedCheckoutAttemptV2 = {
      version: 2,
      revision: 1,
      attemptId: newId(),
      submissionGeneration: newId(),
      serverState: 'PREPARED',
      reconciliationState: 'NOT_STARTED',
      idempotencyKey: request.idempotencyKey,
      clientSessionId: request.clientSessionId,
      request: clone(request),
      submittedItems: clone(submittedItems),
      createdAt: now,
      updatedAt: now,
    };
    return this.repository.persistAttempt(attempt);
  }

  async submit(attemptId: string, turnstileToken: string): Promise<CheckoutCoordinatorResult> {
    return this.repository.withSubmissionLock(attemptId, async () => {
      const resumed = await this.resume(attemptId, true);
      if (resumed && resumed.status !== 'UNKNOWN') return resumed;

      const snapshot = this.repository.readSnapshot();
      if (snapshot.attempt.status !== 'VALID' || !snapshot.attempt.attempt) {
        return { status: 'REVIEW_REQUIRED', snapshot };
      }
      const authoritative = snapshot.attempt.attempt;
      if (authoritative.attemptId !== attemptId) {
        return { status: 'REVIEW_REQUIRED', snapshot };
      }
      if (!['PREPARED', 'UNKNOWN'].includes(authoritative.serverState)) {
        return { status: 'REVIEW_REQUIRED', snapshot };
      }

      const inFlight = nextAttempt(authoritative, {
        serverState: 'IN_FLIGHT',
        reconciliationState: 'NOT_STARTED',
        reviewRequired: undefined,
      });
      await this.repository.persistAttempt(inFlight);

      let receipt: GuestOrderReceipt;
      const gatewayRequest = this.gateway({ ...inFlight.request, turnstileToken });
      try {
        receipt = await waitForGatewayOutcome(
          gatewayRequest,
          this.gatewayOutcomeTimeoutMs
        );
      } catch (error) {
        if (outcomeUnknown(error)) {
          void gatewayRequest.then(
            (lateReceipt) => this.acceptLateGatewaySuccess(inFlight, lateReceipt),
            () => undefined
          );
        }
        const latest = this.repository.readSnapshot();
        if (latest.successEvidence?.attemptId === attemptId) {
          return this.applyDurableSuccess(attemptId);
        }
        if (latest.attempt.status !== 'VALID' || !latest.attempt.attempt) {
          return { status: 'REVIEW_REQUIRED', snapshot: latest };
        }
        const current = latest.attempt.attempt;
        if (current.serverState === 'SUCCEEDED') return this.applyDurableSuccess(attemptId);
        if (current.submissionGeneration !== inFlight.submissionGeneration) {
          return { status: 'REVIEW_REQUIRED', snapshot: latest };
        }
        const next = nextAttempt(current, {
          serverState: outcomeUnknown(error) ? 'UNKNOWN' : 'REJECTED',
          reconciliationState: 'NOT_STARTED',
          terminalMessage: messageFrom(error),
        });
        try {
          await this.repository.persistAttempt(next);
        } catch {
          const afterConflict = this.repository.readSnapshot();
          if (afterConflict.successEvidence?.attemptId === attemptId) {
            return this.applyDurableSuccess(attemptId);
          }
          return { status: 'REVIEW_REQUIRED', snapshot: afterConflict };
        }
        return {
          status: next.serverState === 'UNKNOWN' ? 'UNKNOWN' : 'REJECTED',
          snapshot: this.repository.readSnapshot(),
          message: next.terminalMessage || 'تعذر إرسال الطلب.',
        };
      }

      try {
        await this.repository.recordServerSuccess(inFlight, receipt);
      } catch {
        return {
          status: 'SERVER_SUCCESS_MEMORY_ONLY',
          receipt,
          attempt: inFlight,
          message: 'تم تسجيل الطلب في الخادم، لكن تعذر تثبيت دليل النجاح على هذا الجهاز. لا تعِد الإرسال.',
        };
      }
      return this.applyDurableSuccess(attemptId);
    });
  }

  async resume(
    attemptId?: string,
    submissionLockHeld = false
  ): Promise<CheckoutCoordinatorResult | null> {
    const journal = await this.repository.recoverPendingJournal();
    if (journal.status === 'REVIEW_REQUIRED') {
      return { status: 'REVIEW_REQUIRED', snapshot: this.repository.readSnapshot() };
    }
    const snapshot = this.repository.readSnapshot();
    const attempt = snapshot.attempt.status === 'VALID' ? snapshot.attempt.attempt : null;
    if (!attempt || (attemptId && attempt.attemptId !== attemptId)) return null;
    if (
      attempt.serverState === 'SUCCEEDED' &&
      attempt.reconciliationState === 'WRITE_OUTCOME_UNKNOWN'
    ) {
      return { status: 'REVIEW_REQUIRED', receipt: attempt.receipt, snapshot };
    }
    if (
      attempt.serverState === 'SUCCEEDED' &&
      attempt.receipt &&
      !snapshot.successEvidence
    ) {
      // Version-1 stored SUCCESS included the server receipt, request identity,
      // and immutable submitted snapshot. Promote that existing evidence; do
      // not infer a result for legacy WRITE_OUTCOME_UNKNOWN records.
      try {
        await this.repository.recordServerSuccess(attempt, attempt.receipt);
      } catch {
        return { status: 'REVIEW_REQUIRED', receipt: attempt.receipt, snapshot: this.repository.readSnapshot() };
      }
      return this.applyDurableSuccess(attempt.attemptId);
    }
    if (snapshot.successEvidence?.attemptId === attempt.attemptId || attempt.serverState === 'SUCCEEDED') {
      return this.applyDurableSuccess(attempt.attemptId);
    }
    if (attempt.serverState === 'IN_FLIGHT') {
      // Cooperating tabs serialize on the attempt lock. If another tab still
      // owns the live request, this waits for it to finish instead of
      // prematurely downgrading its IN_FLIGHT state to UNKNOWN.
      const resolveAfterLock = async (): Promise<CheckoutCoordinatorResult | null> => {
        const latest = this.repository.readSnapshot();
        const current = latest.attempt.status === 'VALID' ? latest.attempt.attempt : null;
        if (!current || current.attemptId !== attempt.attemptId) {
          return { status: 'REVIEW_REQUIRED', snapshot: latest };
        }
        if (
          latest.successEvidence?.attemptId === current.attemptId ||
          current.serverState === 'SUCCEEDED'
        ) {
          return this.applyDurableSuccess(current.attemptId);
        }
        if (current.serverState !== 'IN_FLIGHT') {
          if (current.serverState === 'UNKNOWN') {
            return {
              status: 'UNKNOWN',
              snapshot: latest,
              message: current.terminalMessage || 'حالة المحاولة غير معروفة.',
            };
          }
          return null;
        }
        const unknown = nextAttempt(current, { serverState: 'UNKNOWN' });
        try {
          await this.repository.persistAttempt(unknown);
        } catch {
          return { status: 'REVIEW_REQUIRED', snapshot: this.repository.readSnapshot() };
        }
        return {
          status: 'UNKNOWN',
          snapshot: this.repository.readSnapshot(),
          message: 'حالة المحاولة غير معروفة. تحقق من نفس الطلب باستخدام نفس الهوية.',
        };
      };
      return submissionLockHeld
        ? resolveAfterLock()
        : this.repository.withSubmissionLock(attempt.attemptId, resolveAfterLock);
    }
    if (attempt.serverState === 'UNKNOWN') {
      return {
        status: 'UNKNOWN',
        snapshot,
        message: attempt.terminalMessage || 'حالة المحاولة غير معروفة.',
      };
    }
    return null;
  }

  private async acceptLateGatewaySuccess(
    attempt: PersistedCheckoutAttemptV2,
    receipt: GuestOrderReceipt
  ): Promise<void> {
    try {
      await this.repository.recordServerSuccess(attempt, receipt);
      await this.applyDurableSuccess(attempt.attemptId);
    } catch {
      // The authoritative persisted state remains unchanged on conflict. The
      // next explicit recovery surfaces REVIEW_REQUIRED instead of replacing
      // newer evidence or issuing another request automatically.
    }
  }

  private async applyDurableSuccess(attemptId: string): Promise<CheckoutCoordinatorResult> {
    let snapshot = this.repository.readSnapshot();
    if (!snapshot.successEvidence || snapshot.successEvidence.attemptId !== attemptId) {
      return { status: 'REVIEW_REQUIRED', snapshot };
    }
    if (snapshot.attempt.status !== 'VALID' || !snapshot.attempt.attempt) {
      return { status: 'REVIEW_REQUIRED', snapshot };
    }
    const current = snapshot.attempt.attempt;
    if (current.serverState !== 'SUCCEEDED') {
      const succeeded = nextAttempt(current, {
        serverState: 'SUCCEEDED',
        reconciliationState: 'PENDING',
        receipt: clone(snapshot.successEvidence.receipt),
        terminalMessage: undefined,
        reviewRequired: undefined,
      });
      try {
        await this.repository.persistAttempt(succeeded);
      } catch {
        snapshot = this.repository.readSnapshot();
        if (
          snapshot.attempt.status !== 'VALID' ||
          snapshot.attempt.attempt?.serverState !== 'SUCCEEDED'
        ) return { status: 'REVIEW_REQUIRED', snapshot };
      }
    }
    const reconciled = await this.repository.reconcileSuccessfulAttempt(attemptId);
    if (reconciled.status === 'RECONCILED') {
      return {
        status: 'RECONCILED',
        receipt: reconciled.snapshot.successEvidence?.receipt,
        snapshot: reconciled.snapshot,
      };
    }
    if (reconciled.status === 'BLOCKED_CART') {
      return {
        status: 'BLOCKED_CART',
        receipt: reconciled.snapshot.successEvidence?.receipt,
        snapshot: reconciled.snapshot,
      };
    }
    if (reconciled.status === 'REVIEW_REQUIRED') {
      return {
        status: 'REVIEW_REQUIRED',
        receipt: reconciled.snapshot.successEvidence?.receipt,
        snapshot: reconciled.snapshot,
      };
    }
    return {
      status: 'SERVER_SUCCEEDED_PENDING',
      receipt: reconciled.snapshot.successEvidence?.receipt,
      snapshot: reconciled.snapshot,
    };
  }
}
