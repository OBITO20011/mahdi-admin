export interface FinalCatalogSourcePin {before: string | null; after: string; beforeText: string | null}
export const finalCatalogSourceBase: string;
export const finalCatalogSourcePins: Readonly<Record<string, FinalCatalogSourcePin>>;
export function sourceBeforeFinalCatalog(file: string, text: string | null): string | null;
export function restoreFinalCatalogHashes<Row extends {file: string; sha256: string}>(rows: readonly Row[]): Row[];
export function pathsBeforeFinalCatalog(files: readonly string[]): string[];
