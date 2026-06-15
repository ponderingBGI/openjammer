/// <reference types="vite/client" />

/** App-specific Vite env vars (U9). */
interface ImportMetaEnv {
  /** Selects the audio executor backend. Only 'webaudio' is implemented. */
  readonly VITE_OJ_EXECUTOR?: string;
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
