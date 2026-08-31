import { useState } from 'react';
import { ImageOff } from 'lucide-react';

interface ProductImageProps {
  src?: string | null;
  alt: string;
  imageClassName: string;
  fallbackClassName?: string;
  fallbackLabel?: string;
}

/** Keeps broken or missing product media inside the same calm visual treatment. */
export function ProductImage({
  src,
  alt,
  imageClassName,
  fallbackClassName = 'grid h-full w-full place-items-center text-slate-300',
  fallbackLabel,
}: ProductImageProps) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <span className={fallbackClassName} role="img" aria-label={fallbackLabel ?? `لا توجد صورة لـ${alt}`}>
        <span className="grid place-items-center gap-1 text-center">
          <ImageOff className="h-6 w-6" aria-hidden="true" />
          {fallbackLabel && <span className="text-[10px] font-bold">{fallbackLabel}</span>}
        </span>
      </span>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className={imageClassName}
    />
  );
}
