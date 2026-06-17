/// <reference types="vite/client" />

/**
 * App version inlined at build time from package.json (the release-please SSOT)
 * via the `__APP_VERSION__` define in `vite.config.ts`. May be `undefined` under
 * a non-Vite runner (e.g. vitest), so read it defensively.
 */
declare const __APP_VERSION__: string;

/** App-specific Vite env vars. */
interface ImportMetaEnv {
  /** Selects the ojcore transport: 'ojcore-native' or 'ojcore-wasm'. */
  readonly VITE_OJ_EXECUTOR?: string;
  /** Set on canary builds (mirrors DevLogPanel / useCommandSources gating). */
  readonly VITE_OJ_CANARY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/**
 * Type declarations for vite-plugin-pwa virtual modules
 * @see https://vite-pwa-org.netlify.app/guide/register-service-worker.html
 */
declare module 'virtual:pwa-register' {
  export interface RegisterSWOptions {
    immediate?: boolean;
    onNeedRefresh?: () => void;
    onOfflineReady?: () => void;
    onRegistered?: (registration: ServiceWorkerRegistration | undefined) => void;
    onRegisteredSW?: (swScriptUrl: string, registration: ServiceWorkerRegistration | undefined) => void;
    onRegisterError?: (error: Error) => void;
  }

  export function registerSW(options?: RegisterSWOptions): (reloadPage?: boolean) => Promise<void>;
}
