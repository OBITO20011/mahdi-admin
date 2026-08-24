interface StoreLogoMarkProps {
  className?: string;
}

export function StoreLogoMark({
  className = 'h-12 w-12',
}: StoreLogoMarkProps) {
  return (
    <span
      aria-hidden="true"
      className={`relative block shrink-0 overflow-hidden rounded-2xl border border-amber-200/70 bg-[#f6eee3] shadow-lg shadow-blue-900/15 ${className}`}
    >
      <img
        src="/nawasrah-store-logo.jpg"
        alt=""
        decoding="async"
        className="absolute left-1/2 top-0 h-auto w-[160%] max-w-none -translate-x-1/2 -translate-y-[7%]"
      />
    </span>
  );
}
