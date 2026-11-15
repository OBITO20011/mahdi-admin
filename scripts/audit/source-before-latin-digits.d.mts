export interface LatinDigitsSourcePin {
  before: string | null;
  after: string;
  beforeText: string | null;
  binary?: boolean;
}
export const latinDigitsSourceBase: string;
export const latinDigitsSourcePins: Readonly<Record<string, LatinDigitsSourcePin>>;
export function sourceBeforeLatinDigits(file: string, text: string | null): string | null;
export function restoreLatinDigitsHashes<Row extends {file: string; sha256: string}>(rows: readonly Row[]): Row[];
export function pathsBeforeLatinDigits(files: readonly string[]): string[];
