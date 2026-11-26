interface CatalogRequest {
  key: string;
  controller: AbortController;
  completion: Promise<void>;
}

export const CATALOG_SEARCH_DEBOUNCE_MS = 200;

export function createCatalogRequestGate() {
  let active: CatalogRequest | undefined;

  function cancel() {
    const previous = active;
    active = undefined;
    previous?.controller.abort();
  }

  return {
    cancel,
    run(key: string, work: (signal: AbortSignal) => Promise<void>) {
      if (active?.key === key) return active.completion;
      cancel();

      const controller = new AbortController();
      const completion = Promise.resolve().then(async () => {
        if (!controller.signal.aborted) await work(controller.signal);
      }).finally(() => {
        if (active?.controller === controller) active = undefined;
      });
      active = { key, controller, completion };
      return completion;
    },
  };
}
