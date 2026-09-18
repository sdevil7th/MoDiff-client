// Derived from cubiq/Mellon-client and modified by the MoDiff project.

import { defineConfig, loadEnv, mergeConfig, type Plugin, type UserConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { minify } from 'terser';
import { createHash } from 'node:crypto';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import {
  resolveTemplateAssetViteContract,
  serializeTemplateAssetSource,
  type TemplateAssetSourceContract,
} from './scripts/template-asset-source-contract.ts';

const backendProxyTarget = process.env.VITE_BACKEND_PROXY_TARGET || 'http://127.0.0.1:8088';
const checkedInTemplateAssetSource = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, 'src/studio/templateAssetSource.json'), 'utf8'),
);

function templateAssetSourceIdentityPlugin(source: TemplateAssetSourceContract): Plugin {
  return {
    name: 'modiff-template-asset-source-identity',
    apply: 'build',
    buildStart() {
      this.emitFile({
        type: 'asset',
        fileName: 'assets/template-asset-source.v1.json',
        source: serializeTemplateAssetSource(source),
      });
    },
  };
}

function shellPublicAssetsPlugin(): Plugin {
  let emitBuildAssets = false;
  const publicFiles = new Map([
    ['THIRD_PARTY_LICENSES.txt', 'text/plain; charset=utf-8'],
    ['favicon.ico', 'image/vnd.microsoft.icon'],
    ['assets/modiff-icon.svg', 'image/svg+xml; charset=utf-8'],
    ['assets/modiff-icon-64.png', 'image/png'],
    ['assets/modiff-icon-128.png', 'image/png'],
    ['assets/modiff-icon-256.png', 'image/png'],
    // Locally authored editorial card, not a Gallery generation/publication.
    ['assets/minimax-chamber-pop.card-poster.png', 'image/png'],
  ]);
  return {
    name: 'modiff-shell-public-assets',
    configResolved(config) {
      emitBuildAssets = config.command === 'build';
    },
    buildStart() {
      if (!emitBuildAssets) return;
      for (const fileName of publicFiles.keys()) {
        this.emitFile({
          type: 'asset',
          fileName,
          source: fs.readFileSync(path.resolve(__dirname, 'public', fileName)),
        });
      }
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
        const fileName = pathname.startsWith('/') ? pathname.slice(1) : pathname;
        const contentType = publicFiles.get(fileName);
        if (!contentType) {
          next();
          return;
        }
        response.statusCode = 200;
        response.setHeader('Content-Type', contentType);
        response.setHeader('Cache-Control', 'no-cache');
        response.end(fs.readFileSync(path.resolve(__dirname, 'public', fileName)));
      });
    },
  };
}

function compactProductionChunksPlugin(): Plugin {
  return {
    name: 'modiff-compact-production-chunks',
    apply: 'build',
    async generateBundle(_options, bundle) {
      // Preserve Vite's fast Oxc transform, then make one standards-safe
      // module/toplevel pass over finalized chunks. Avoid Terser's `unsafe_*`
      // rewrites: this pass is a size optimization, not a semantics tradeoff.
      await Promise.all(
        Object.values(bundle).map(async (item) => {
          if (item.type !== 'chunk') return;
          const result = await minify(item.code, {
            compress: {
              passes: 10,
              pure_getters: 'strict',
              // Runtime node/graph contracts intentionally distinguish JSON
              // booleans from numeric 0/1. `booleans_as_integers` rewrote
              // Cluster presentation state into a schema-invalid payload in
              // production even though development builds remained valid.
              // Keep errors, but omit development-only connection, progress,
              // and stale-event diagnostics from production bundles.
              drop_console: ['debug', 'info', 'warn'],
            },
            ecma: 2022,
            module: true,
            mangle: true,
            toplevel: true,
          });
          if (!result.code) throw new Error(`Terser produced no code for ${item.fileName}.`);
          item.code = result.code;
        }),
      );
    },
  };
}

function shellAssetVersionPlugin(): Plugin {
  return {
    name: 'modiff-shell-asset-version',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const shellFiles = Object.entries(bundle)
        .filter(([fileName]) => /^assets\/.+\.(?:css|js)$/.test(fileName))
        .sort(([left], [right]) => left.localeCompare(right));
      const digest = createHash('sha256');
      for (const [fileName, item] of shellFiles) {
        digest.update(fileName);
        digest.update('\0');
        digest.update(item.type === 'chunk' ? item.code : item.source);
        digest.update('\0');
      }
      const version = digest.digest('hex').slice(0, 16);
      const shellPaths = new Set(shellFiles.map(([fileName]) => fileName));
      const versionReference = (source: string) =>
        source.replace(
          /(["'`])((?:\.\/|\/?assets\/)[^"'`?$\s\\]+\.(?:css|js))\1/g,
          (original, quote: string, url: string) => {
            const fileName = url.startsWith('./') ? `assets/${url.slice(2)}` : url.replace(/^\//, '');
            return shellPaths.has(fileName) ? `${quote}${url}?v=${version}${quote}` : original;
          },
        );

      for (const [, item] of shellFiles) {
        if (item.type === 'chunk') item.code = versionReference(item.code);
      }
      const index = bundle['index.html'];
      if (!index || index.type !== 'asset' || typeof index.source !== 'string') {
        throw new Error('Production build did not emit a versionable index.html shell.');
      }
      index.source = versionReference(index.source);
    },
  };
}

function adjacentSupervisorTarget(backendTarget: string) {
  try {
    const url = new URL(backendTarget);
    const backendPort = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
    url.protocol = 'http:';
    url.port = String(backendPort + 1);
    url.pathname = '';
    url.search = '';
    url.hash = '';
    return url.origin;
  } catch {
    return backendTarget;
  }
}

const supervisorControlTarget =
  process.env.VITE_SUPERVISOR_CONTROL_ADDRESS || adjacentSupervisorTarget(backendProxyTarget);
const backendProxyPaths = [
  '/ws',
  '/nodes',
  '/hf_token',
  '/hf_cache',
  '/local_models',
  '/model_cache',
  '/runtime',
  '/health',
  '/model_capabilities',
  '/operations',
  '/media',
  '/auto_resource',
  '/studio_outputs',
  '/studio',
  '/workflow_shares',
  '/workflows',
  '/hf_hub',
  '/hf_download',
  '/huggingface',
  '/template_gallery',
  '/custom_modules',
  '/custom_modular',
  '/cache',
  '/preview',
  '/stream',
  '/file',
  '/fields',
  '/listdir',
  '/listgraphs',
  '/queue',
  '/runs',
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
  // Concurrent qualification frontends must not replace each other's
  // optimized dependency files and trigger navigation during a gesture.
  cacheDir: process.env.MODIFF_VITE_CACHE_DIR || 'node_modules/.vite',
  plugins: [react(), tailwindcss(), compactProductionChunksPlugin(), shellAssetVersionPlugin()],
  server: {
    proxy: backendProxy,
    hmr: process.env.MODIFF_GALLERY_STABLE !== '1',
    watch: {
      // Playwright can emit tens of thousands of trace resources during a
      // long-running model qualification. They are neither source nor HMR
      // inputs, and watching them can exhaust the host's inotify limit.
      ignored: ['**/artifacts/**', '**/test-results*/**', '**/playwright-report*/**', '**/blob-report/**'],
    },
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
        codeSplitting: {
          groups: [
            {
              // These related composition surfaces stay deferred. Share their
              // small chunk overhead without pulling their eager store dependencies.
              name: 'block-composition-tools',
              test: /\/src\/(?:studio\/(?:graphFixer|workflowAutoExecutionV2|workflowResourceAssessmentV2)\.ts|components\/(?:GraphFixDialog|WorkspacePanel|BlockDetailDialogV2|BlockInterfaceDialogContentV2|BlockSaveDialogContentV2|CreateUserBlockDialog|LegacyUserBlockNode)\.tsx)$/,
              includeDependenciesRecursively: false,
              priority: 10,
            },
            {
              name: (moduleId) => {
                // Keep already-eager Studio catalogs/contracts and graph stores together so their
                // repeated vocabulary compresses once within the bundle budget,
                // without changing load timing.
                if (
                  moduleId.endsWith('/src/App.tsx') ||
                  moduleId.endsWith('/src/studio/templates.ts') ||
                  moduleId.endsWith('/src/studio/huggingFaceClusterFork.ts') ||
                  moduleId.endsWith('/src/studio/legacyBlockMovementV2.ts') ||
                  moduleId.endsWith('/src/studio/blockSelectionMovesV2.ts') ||
                  moduleId.endsWith('/src/types/api.ts') ||
                  moduleId.endsWith('/src/stores/websocketMessageHandler.ts') ||
                  moduleId.endsWith('/src/studio/modelUsagePolicies.ts') ||
                  moduleId.endsWith('/src/studio/nodeCatalog.ts') ||
                  moduleId.endsWith('/src/studio/templateBackendCapabilities.ts') ||
                  moduleId.endsWith('/src/studio/managedControlPolicy.ts') ||
                  moduleId.endsWith('/src/stores/useFlowStore.ts') ||
                  moduleId.endsWith('/src/stores/useWebsocketStore.ts') ||
                  moduleId.endsWith('/src/studio/modularComposition.ts') ||
                  moduleId.endsWith('/src/components/NodeContent.tsx') ||
                  moduleId.endsWith('/src/studio/graphFixMaterialization.ts') ||
                  /\/src\/studio\/reviewed(?:BlockContext|LoopConnections|LoopDiagnostics|LoopRepair|StateContract|StateDiagnostics|StateRepair|ValuePorts)V2\.ts$/.test(
                    moduleId,
                  ) ||
                  moduleId.endsWith('/src/studio/reviewedModularGraphV2.ts')
                ) {
                  return 'studio-templates';
                }
                if (
                  moduleId.includes('/node_modules/@xyflow/') ||
                  moduleId.includes('/node_modules/react/') ||
                  moduleId.includes('/node_modules/react-dom/') ||
                  // Lazy panels keep module-level icon descriptors. Icons must
                  // initialize with vendor dependencies, not be hoisted into
                  // an application entry that imports those panels cyclically.
                  moduleId.includes('/node_modules/lucide-react/') ||
                  moduleId.includes('/node_modules/scheduler/') ||
                  moduleId.includes('/node_modules/@headlessui/') ||
                  moduleId.includes('/node_modules/@floating-ui/')
                ) {
                  return 'graph-vendor';
                }
                return undefined;
              },
            },
          ],
        },
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

export default defineConfig(({ mode, command }) => {
  const templateAssetContract = resolveTemplateAssetViteContract(
    checkedInTemplateAssetSource,
    loadEnv(mode, __dirname, 'VITE_MODIFF_TEMPLATE_ASSET_'),
    process.env,
  );
  const usesRemoteTemplateAssets = templateAssetContract.source.mode === 'huggingface';
  const assetConfig: UserConfig = {
    plugins: [
      templateAssetSourceIdentityPlugin(templateAssetContract.source),
      ...(usesRemoteTemplateAssets ? [shellPublicAssetsPlugin()] : []),
    ],
    // Remote Gallery builds must never duplicate the Dataset payload into dist
    // (and later into the backend's web bundle). Offline/local builds explicitly
    // opt back into Vite's normal public-directory copy.
    publicDir: templateAssetContract.publicDir,
    define: {
      ...templateAssetContract.runtimeDefines,
      // Vite's development origin differs from the backend. Production must
      // derive recovery from its serving origin (or an explicit override),
      // rather than bake the developer's proxy/default port into the bundle.
      ...(command === 'serve'
        ? {
            'import.meta.env.VITE_BACKEND_PROXY_TARGET': JSON.stringify(backendProxyTarget),
            'import.meta.env.VITE_SUPERVISOR_CONTROL_ADDRESS': JSON.stringify(supervisorControlTarget),
          }
        : {}),
    },
  };
  const mergedConfig = mergeConfig(mergeConfig(baseConfig, assetConfig), localConfig);

  // Workstation-local config remains extensible, but it cannot split the
  // asset payload, emitted identity, and compiled runtime source apart.
  return {
    ...mergedConfig,
    publicDir: templateAssetContract.publicDir,
    define: {
      ...mergedConfig.define,
      ...templateAssetContract.runtimeDefines,
    },
  };
});
