import type {Plugin} from 'vite';
export interface StorefrontMeasurement {
  chunks: Array<{file: string; bytes: number; gzip: number}>;
  initialJsBytes: number; initialJsGzip: number; cssGzip: number; fonts: number; initialScriptRequests: number;
}
export const storefrontBudget: Readonly<Record<Exclude<keyof StorefrontMeasurement, 'chunks'>, number>>;
export function measureStorefrontBudget(dist: string): Promise<StorefrontMeasurement>;
export function assertStorefrontBudget<T extends StorefrontMeasurement>(report: T): T;
export const storefrontRequestBudget: Readonly<Record<string, {rpc: number; total: number}>>;
export function assertStorefrontRequests(page: string, report: {rpc: number; total: number; fonts: number}): void;
export function storefrontBudgetPlugin(): Plugin;
