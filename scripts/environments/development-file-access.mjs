import {existsSync, realpathSync} from 'node:fs';
import path from 'node:path';

// Files needed by the browser only. In particular, never allow a whole workspace
// or the checkout reached through a shared node_modules junction.
export function developmentFileAccess(root, sharedReceipts = false) {
 const dependencies = [path.join(root, 'node_modules'), path.join(root, '../node_modules')]
  .filter(existsSync).map(directory => realpathSync(directory));
 return {
  strict: true,
  allow: [...new Set([
   path.join(root, 'index.html'), path.join(root, 'src'), path.join(root, 'public'),
   ...(sharedReceipts ? [path.join(root, 'customer-web/src/receipts')] : []),
   ...dependencies,
  ])],
  // Vite6.4.4 checks some transformed IDs WITH the query attached. The trailing
  // * deliberately covers ?import&raw as well as the ordinary file path.
  deny: ['**/.env*', '**/*.{crt,pem,key,p12,pfx,nwb}*', '**/.git/**'],
 };
}
