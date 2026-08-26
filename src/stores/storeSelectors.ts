export type SelectorEquality<T> = (previous: T, next: T) => boolean;

export interface SelectorCache<T> {
  hasValue: boolean;
  value?: T;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const shallowEqual = <T,>(previous: T, next: T): boolean => {
  if (Object.is(previous, next)) return true;
  if (!isRecord(previous) || !isRecord(next)) return false;

  const previousKeys = Object.keys(previous);
  const nextKeys = Object.keys(next);
  if (previousKeys.length !== nextKeys.length) return false;

  return previousKeys.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(next, key) &&
      Object.is(previous[key], next[key])
  );
};

export function updateSelectorCache<T>(
  cache: SelectorCache<T>,
  nextSelection: T,
  isEqual: SelectorEquality<T>
): { selection: T; changed: boolean } {
  if (cache.hasValue && isEqual(cache.value as T, nextSelection)) {
    return { selection: cache.value as T, changed: false };
  }

  cache.hasValue = true;
  cache.value = nextSelection;
  return { selection: nextSelection, changed: true };
}
