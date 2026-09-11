import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

const releaseId =
  process.env.NAWASRAH_ADMIN_RELEASE_ID ??
  process.env.CF_PAGES_COMMIT_SHA ??
  process.env.GITHUB_SHA;

if (releaseId && !/^[0-9a-f]{40}$/iu.test(releaseId)) {
  throw new Error('Admin release ID must be a full Git commit SHA.');
}

const buildId = releaseId?.toLowerCase() ?? 'local-dev';

export default defineConfig(() => {
  return {
    define: {
      __NAWASRAH_BUILD_ID__: JSON.stringify(buildId),
    },
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;
            if (id.includes('@sentry')) return 'monitoring';
            if (id.includes('@supabase') || id.includes('realtime-js')) {
              return 'supabase';
            }
            if (id.includes('html5-qrcode')) return 'scanner';
            if (id.includes('recharts') || id.includes('d3-')) return 'charts';
            if (id.includes('lucide-react')) return 'icons';
            if (id.includes('motion')) return 'motion';
            if (id.includes('react')) return 'react';
            return 'vendor';
          },
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
