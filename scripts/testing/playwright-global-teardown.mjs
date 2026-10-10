import { verifyBrowserNetworkAudit } from './playwright-network-audit.mjs';
import {stopIsolatedVite} from './stop-isolated-vite.mjs';

export default async function teardown() {
  try {await verifyBrowserNetworkAudit();}
  finally {await Promise.all([stopIsolatedVite(4173), stopIsolatedVite(4174)]);}
}
