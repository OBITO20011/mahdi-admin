import {
  Dispatch,
  SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { CartItem } from '../types/catalog';
import {
  PersistedCheckoutAttemptV2,
} from '../types/checkout';
import { CartStorageRecovery } from '../utils/cart';
import {
  COMMERCE_STORAGE_EVENT,
  CommerceStorageRepository,
  CommerceStorageSnapshot,
} from '../services/commerceStorage';
import { CheckoutRecoveryCoordinator } from '../services/checkoutRecoveryCoordinator';

interface CustomerCommerceState {
  snapshot: CommerceStorageSnapshot;
  cartItems: CartItem[];
  cartRecovery: CartStorageRecovery | null;
  attempt: PersistedCheckoutAttemptV2 | null;
  lastError: string | null;
}

function derive(repository: CommerceStorageRepository, lastError: string | null): CustomerCommerceState {
  const snapshot = repository.readSnapshot();
  const cartRecovery = snapshot.cart.status === 'INVALID' ||
    snapshot.cart.status === 'PARTIALLY_INVALID' ||
    snapshot.cart.status === 'UNSUPPORTED_VERSION'
    ? snapshot.cart.recovery
    : null;
  return {
    snapshot,
    cartItems: snapshot.cart.envelope?.items ?? cartRecovery?.validItems ?? [],
    cartRecovery,
    attempt: snapshot.attempt.status === 'VALID' ? snapshot.attempt.attempt : null,
    lastError,
  };
}

export function useCustomerCommerce() {
  const repository = useMemo(() => new CommerceStorageRepository(window.localStorage), []);
  const coordinator = useMemo(() => new CheckoutRecoveryCoordinator(repository), [repository]);
  const [state, setState] = useState<CustomerCommerceState>(() => derive(repository, null));

  const refresh = useCallback((error: string | null = null) => {
    setState(derive(repository, error));
  }, [repository]);

  useEffect(() => {
    let active = true;
    void coordinator.resume().finally(() => {
      if (active) refresh();
    });
    const sync = () => refresh();
    window.addEventListener('storage', sync);
    window.addEventListener(COMMERCE_STORAGE_EVENT, sync);
    return () => {
      active = false;
      window.removeEventListener('storage', sync);
      window.removeEventListener(COMMERCE_STORAGE_EVENT, sync);
    };
  }, [coordinator, refresh]);

  const setCartItems: Dispatch<SetStateAction<CartItem[]>> = useCallback((action) => {
    void repository.mutateCart((current) =>
      typeof action === 'function'
        ? (action as (items: CartItem[]) => CartItem[])(current)
        : action
    ).then(() => refresh()).catch((error: unknown) => {
      refresh(error instanceof Error ? error.message : 'تعذر حفظ تعديل السلة.');
    });
  }, [refresh, repository]);

  const replaceCart = useCallback(async (items: CartItem[]) => {
    await repository.mutateCart(() => items);
    refresh();
  }, [refresh, repository]);

  const mutateCart = useCallback(async (
    mutate: (items: CartItem[]) => CartItem[],
    expectedRevision?: number
  ) => {
    const envelope = await repository.mutateCart(mutate, expectedRevision);
    refresh();
    return envelope.items;
  }, [refresh, repository]);

  const resolveCartRecovery = useCallback(async (
    recovery: CartStorageRecovery,
    action: 'KEEP_VALID_ITEMS' | 'RESET_CART'
  ) => {
    await repository.resolveCartRecovery(recovery, action);
    const attempt = repository.readSnapshot().attempt;
    if (attempt.status === 'VALID' && attempt.attempt?.serverState === 'SUCCEEDED') {
      await coordinator.resume(attempt.attempt.attemptId);
    }
    refresh();
  }, [coordinator, refresh, repository]);

  return {
    ...state,
    repository,
    coordinator,
    refresh,
    setCartItems,
    mutateCart,
    replaceCart,
    resolveCartRecovery,
  };
}
