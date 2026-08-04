/// <reference types="vite/client" />
// Derived from cubiq/Mellon-client and modified by the MoDiff project.

interface ImportMetaEnv {
  readonly VITE_SERVER_ADDRESS: string;
  readonly VITE_MODIFF_TEMPLATE_ASSET_MODE?: 'local' | 'huggingface';
  readonly VITE_MODIFF_TEMPLATE_ASSET_REPO?: string;
  readonly VITE_MODIFF_TEMPLATE_ASSET_REVISION?: string;
  readonly VITE_MODIFF_TEMPLATE_ASSET_SET_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
