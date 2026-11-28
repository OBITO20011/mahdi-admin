export function CatalogGridPlaceholder({ searching = false }: { searching?: boolean }) {
  return (
    <>
      {searching && (
        <p role="status" className="catalog-search-status rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700">
          جاري البحث…
        </p>
      )}
      <div className="catalog-card-grid motion-safe:animate-pulse" aria-hidden="true" data-testid="catalog-loading-grid">
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index} className="overflow-hidden rounded-2xl border border-slate-200 bg-white sm:rounded-[1.75rem]">
            <div className="aspect-square bg-slate-100 sm:aspect-[4/3]" />
            <div className="catalog-card-body space-y-3 p-2.5 sm:p-4">
              <div className="catalog-card-title space-y-1.5">
                <div className="h-2 w-3/4 rounded bg-slate-100" />
                <div className="h-2 w-1/2 rounded bg-slate-100" />
              </div>
              <div className="h-12 rounded bg-slate-100" />
              <div className="h-10 rounded bg-slate-100" />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
