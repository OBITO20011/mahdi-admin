import {productThumbnailUrl} from '../utils/productThumbnail';
import { useState } from 'react';
import { ImageOff } from 'lucide-react';

interface ProductImageProps {
  src?: string | null;
  alt: string;
  priority?: boolean;
  useThumbnail?: boolean;
  imageClassName: string;
  fallbackClassName?: string;
  fallbackLabel?: string;
}

/** Keeps broken or missing product media inside the same calm visual treatment. */
export function ProductImage({
  src,
  alt,
  priority = false,
  useThumbnail = true,
  imageClassName,
  fallbackClassName = 'grid h-full w-full place-items-center text-slate-300',
  fallbackLabel,
}: ProductImageProps) {
  const [failure, setFailure] = useState<{src: string; stage: number} | null>(null);
  const thumbnail = src ? (useThumbnail ? productThumbnailUrl(src) : src) : '';
  const stage = failure?.src === thumbnail ? failure.stage : 0;
  const displayed = stage === 0 ? thumbnail : src;
  const failed = stage >= (thumbnail === src ? 1 : 2);

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
      src={displayed ?? undefined}
      alt={alt}
      loading={priority ? 'eager' : 'lazy'}
      fetchPriority={priority ? 'high' : undefined}
      width={400}
      height={400}
      decoding="async"
      onError={() => setFailure({src: thumbnail, stage: stage + 1})}
      className={imageClassName}
    />
  );
}
