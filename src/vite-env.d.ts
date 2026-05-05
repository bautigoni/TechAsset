/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AUTO_REFRESH_SECONDS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
