import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createServer, normalizePath, searchForWorkspaceRoot} from 'vite';

// Also imported imperatively by browser harnesses, outside Vite's entry scan.
export const isolatedViteDependencies = Object.freeze([
  'react', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'lucide-react',
]);

export async function startIsolatedVite({root, port, env = {}, logger = undefined, config = {}, controlledStop = false}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('INVALID_VITE_TEST_PORT');
  const ownedDirectory = await mkdtemp(path.join(tmpdir(), `nawasrah-vite-${port}-`));
  // Keep generated bundles under node_modules so React/Babel excludes prebundles
  // exactly as it does for the default cache, while still outside the checkout.
  const cacheDir = path.join(ownedDirectory, 'node_modules', '.vite');
  const previous = new Map(Object.keys(env).map(key => [key, process.env[key]]));
  let server;
  let closing;
  const close = () => closing ??= (async () => {
    // Remove only this mkdtemp-owned directory, after Vite releases its workers.
    await server?.close();
    await rm(ownedDirectory, {recursive: true, force: true});
  })();
  try {
    Object.assign(process.env, env);
    server = await createServer({
      ...config, root, cacheDir, ...(logger ? {customLogger: logger} : {}),
      optimizeDeps: {...config.optimizeDeps, include: [...new Set([
        ...isolatedViteDependencies, ...(config.optimizeDeps?.include ?? []),
      ])]},
      server: {...config.server, host: '127.0.0.1', port, strictPort: true,
        fs: {...config.server?.fs, allow: [searchForWorkspaceRoot(root), cacheDir]}},
      plugins: [...(config.plugins ?? []), {
        name: 'isolated-harness-cache',
        configureServer(vite) {
          vite.middlewares.use((request, response, next) => {
            // Windows taskkill cannot deliver a graceful signal. The test teardown
            // closes only our loopback QA servers before Playwright kills processes.
            if (controlledStop && request.method === 'POST' && request.url === '/__isolated_vite_shutdown') {
              response.setHeader('content-type', 'application/json');
              response.end(JSON.stringify({ownedDirectory}));
              void close();
              return;
            }
            // Preserve old harness URLs, but never read a shared .vite directory.
            const prefix = '/node_modules/.vite/deps/';
            if (request.url?.startsWith(prefix)) {
              request.url = `/@fs/${normalizePath(cacheDir)}/deps/${request.url.slice(prefix.length)}`;
            }
            response.once('finish', () => {
              if (response.statusCode === 504) console.error(JSON.stringify({
                event: 'ISOLATED_VITE_504', port, statusMessage: response.statusMessage,
                // Never record query parameters, auth headers or environment.
                path: request.url?.split('?')[0],
              }));
            });
            next();
          });
        },
      }],
    });
  } catch (error) {
    await close();
    throw error;
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
  try {await server.listen();} catch (error) {await close(); throw error;}
  return {server, cacheDir, close};
}
