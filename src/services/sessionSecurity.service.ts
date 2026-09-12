export const ADMIN_IDLE_LOCK_MS = 15 * 60 * 1_000;
export const ADMIN_ABSOLUTE_SESSION_MS = 12 * 60 * 60 * 1_000;

const SESSION_SECURITY_VERSION = 1;
const SESSION_SECURITY_STORAGE_PREFIX = 'nawasrah_admin_session_security_v1:';
const CLOCK_ROLLBACK_TOLERANCE_MS = 60_000;

export interface AdminSessionSecuritySnapshot {
  version: typeof SESSION_SECURITY_VERSION;
  userId: string;
  absoluteSessionStartedAt: number;
  lastActivityAt: number;
  lockedAt: number | null;
}

export type AdminSessionSecurityStatus =
  | 'active'
  | 'idle_locked'
  | 'absolute_expired'
  | 'clock_invalid';

const isFiniteTimestamp = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

export function getAdminSessionSecurityStorageKey(userId: string) {
  return `${SESSION_SECURITY_STORAGE_PREFIX}${userId}`;
}

export function createAdminSessionSecuritySnapshot(
  userId: string,
  now = Date.now(),
): AdminSessionSecuritySnapshot {
  return {
    version: SESSION_SECURITY_VERSION,
    userId,
    absoluteSessionStartedAt: now,
    lastActivityAt: now,
    lockedAt: null,
  };
}

export function parseAdminSessionSecuritySnapshot(
  value: string | null,
  expectedUserId: string,
): AdminSessionSecuritySnapshot | null {
  if (!value || !expectedUserId) return null;

  try {
    const parsed = JSON.parse(value) as Partial<AdminSessionSecuritySnapshot>;
    if (
      parsed.version !== SESSION_SECURITY_VERSION ||
      parsed.userId !== expectedUserId ||
      !isFiniteTimestamp(parsed.absoluteSessionStartedAt) ||
      !isFiniteTimestamp(parsed.lastActivityAt) ||
      !(
        parsed.lockedAt === null ||
        isFiniteTimestamp(parsed.lockedAt)
      )
    ) {
      return null;
    }

    return parsed as AdminSessionSecuritySnapshot;
  } catch {
    return null;
  }
}

export function evaluateAdminSessionSecurity(
  snapshot: AdminSessionSecuritySnapshot,
  now = Date.now(),
): AdminSessionSecurityStatus {
  if (
    snapshot.absoluteSessionStartedAt - now > CLOCK_ROLLBACK_TOLERANCE_MS ||
    snapshot.lastActivityAt - now > CLOCK_ROLLBACK_TOLERANCE_MS ||
    (snapshot.lockedAt !== null &&
      snapshot.lockedAt - now > CLOCK_ROLLBACK_TOLERANCE_MS)
  ) {
    return 'clock_invalid';
  }

  if (
    now - snapshot.absoluteSessionStartedAt >= ADMIN_ABSOLUTE_SESSION_MS
  ) {
    return 'absolute_expired';
  }

  if (
    snapshot.lockedAt !== null ||
    now - snapshot.lastActivityAt >= ADMIN_IDLE_LOCK_MS
  ) {
    return 'idle_locked';
  }

  return 'active';
}

export function recordAdminSessionActivity(
  snapshot: AdminSessionSecuritySnapshot,
  now = Date.now(),
): AdminSessionSecuritySnapshot {
  if (evaluateAdminSessionSecurity(snapshot, now) !== 'active') return snapshot;

  return {
    ...snapshot,
    lastActivityAt: now,
  };
}

export function lockAdminSession(
  snapshot: AdminSessionSecuritySnapshot,
  now = Date.now(),
): AdminSessionSecuritySnapshot {
  if (snapshot.lockedAt !== null) return snapshot;

  return {
    ...snapshot,
    lockedAt: now,
  };
}

export function unlockAdminSession(
  snapshot: AdminSessionSecuritySnapshot,
  now = Date.now(),
): AdminSessionSecuritySnapshot {
  return {
    ...snapshot,
    lastActivityAt: now,
    lockedAt: null,
  };
}

export function readAdminSessionSecuritySnapshot(userId: string) {
  if (!userId || typeof localStorage === 'undefined') return null;

  try {
    return parseAdminSessionSecuritySnapshot(
      localStorage.getItem(getAdminSessionSecurityStorageKey(userId)),
      userId,
    );
  } catch {
    return null;
  }
}

export function writeAdminSessionSecuritySnapshot(
  snapshot: AdminSessionSecuritySnapshot,
) {
  if (typeof localStorage === 'undefined') return false;

  try {
    localStorage.setItem(
      getAdminSessionSecurityStorageKey(snapshot.userId),
      JSON.stringify(snapshot),
    );
    return true;
  } catch {
    return false;
  }
}

export function removeAdminSessionSecuritySnapshot(userId: string) {
  if (!userId || typeof localStorage === 'undefined') return;

  try {
    localStorage.removeItem(getAdminSessionSecurityStorageKey(userId));
  } catch {
    // The Supabase sign-out remains authoritative even if storage is blocked.
  }
}
