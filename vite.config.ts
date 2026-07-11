import { defineConfig, mergeConfig, UserConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const backendProxyTarget = process.env.VITE_BACKEND_PROXY_TARGET || 'http://127.0.0.1:8088';
const backendProxyPaths = [
  '/ws',
  '/nodes',
  '/hf_cache',
  '/local_models',
  '/model_cache',
  '/runtime',
  '/health',
  '/model_capabilities',
  '/auto_resource',
  '/studio_outputs',
  '/studio',
  '/workflow_shares',
  '/workflows',
  '/hf_hub',
  '/hf_download',
  '/custom_modules',
  '/cache',
  '/preview',
  '/stream',
  '/file',
  '/fields',
  '/listdir',
  '/listgraphs',
  '/queue',
  '/graph',
  '/stop',
  '/favicon.ico',
];

const backendProxy = Object.fromEntries(
  backendProxyPaths.map((route) => [
    route,
    {
      target: backendProxyTarget,
      changeOrigin: true,
      ws: route === '/ws',
    },
  ]),
);

const baseConfig: UserConfig = {
  plugins: [react(), tailwindcss()],
  server: {
    proxy: backendProxy,
    hmr: process.env.MODIFF_GALLERY_STABLE !== '1',
  },
  build: {
    emptyOutDir: true,
    modulePreload: false,
    target: 'esnext',
    chunkSizeWarningLimit: 2000,
    commonjsOptions: {
      strictRequires: 'auto',
    },
    rollupOptions: {
      treeshake: true,
      output: {
        chunkFileNames: (chunkInfo) => {
          const customFieldPath = path.resolve(__dirname, 'src/custom-fields');
          if (chunkInfo.facadeModuleId?.startsWith(customFieldPath)) {
            return 'user/[name].js';
          }

          return 'assets/[name].js';
        },
        entryFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name].[ext]',
      },
    },
  },
  resolve: {
    alias: {
      '@custom-fields': path.resolve(__dirname, 'src/custom-fields'),
    },
  },
};

// Load local config if it exists
const loadLocalConfig = async () => {
  const localConfigPath = path.resolve(__dirname, 'vite.config.local.ts');

  if (fs.existsSync(localConfigPath)) {
    return (await import(pathToFileURL(localConfigPath).href)).default;
  }
  return {};
};
const localConfig = await loadLocalConfig();

export default defineConfig(mergeConfig(baseConfig, localConfig));
