import {freemem} from 'node:os';

// Local browser QA runs two apps plus browser engines. Keep headroom instead
// of assuming CPU count implies available RAM. CI never calls this branch.
export function localBrowserWorkerLimit(freeBytes = freemem()) {
  return Number.isFinite(freeBytes) && freeBytes >= 4 * 1024 ** 3 ? 2 : 1;
}
