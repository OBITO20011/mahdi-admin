interface StoreLogoMarkProps {
  className?: string;
}

export function StoreLogoMark({
  className = 'h-14 w-[4.5rem]',
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
        className="h-full w-full object-contain p-0.5"
      />
    </span>
  );
}
