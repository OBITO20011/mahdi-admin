/** Paired immutable object; no extra database column and no overwrite. */
export const productThumbnailPath = (original: string): string => `${original}-400.webp`;

/** Canvas decoders honor EXIF; the thumbnail contains upright pixels. */
export async function createProductThumbnail(file: File): Promise<Blob | null> {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  let source: ImageBitmap | HTMLImageElement | undefined;
  let objectUrl: string | undefined;
  try {
    if (typeof createImageBitmap === 'function') {
      source = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } else {
      objectUrl = URL.createObjectURL(file);
      const image = new Image(); image.src = objectUrl;
      await image.decode(); source = image;
    }
    const width = source instanceof HTMLImageElement ? source.naturalWidth : source.width;
    const height = source instanceof HTMLImageElement ? source.naturalHeight : source.height;
    if (!width || !height) return null;
    const ratio = Math.min(1, 400 / Math.max(width, height));
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.imageSmoothingQuality = 'high';
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    const result = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', .78));
    return result?.type === 'image/webp' && result.size < 300_000 ? result : null;
  } catch {
    // A missing thumbnail never makes the existing original unusable.
    return null;
  } finally {
    if (source && 'close' in source) source.close();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    canvas.width = 0; canvas.height = 0;
  }
}
