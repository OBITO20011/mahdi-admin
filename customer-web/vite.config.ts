import {storefrontBudgetPlugin} from '../scripts/testing/storefront-budget.mjs';
import {selectedViteEnvironment,environmentDefines,environmentAssets} from '../scripts/environments/vite-environment.mjs';
import {developmentFileAccess} from '../scripts/environments/development-file-access.mjs';
import {privateSourceMaps} from '../scripts/environments/private-source-maps.mjs';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig(({mode}) => {
 const selected=selectedViteEnvironment(mode,__dirname);return {
  define:environmentDefines(selected),
  plugins: [react(), tailwindcss(),environmentAssets(selected,__dirname),privateSourceMaps(selected,__dirname,'customer'),storefrontBudgetPlugin()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('@sentry')) return 'monitoring';
          if (id.includes('@supabase') || id.includes('realtime-js')) {
            return 'supabase';
          }
          if (id.includes('lucide-react')) return 'icons';
          if (id.includes('react')) return 'react';
          return 'vendor';
        },
      },
    },
  },
  server: {
    fs: developmentFileAccess(__dirname),
    port: 3002,
  },
};});
