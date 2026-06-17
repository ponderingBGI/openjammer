/**
 * PWA Hooks - Progressive Web App functionality
 *
 * Features:
 * - Install prompt detection and triggering
 * - Online/offline status
 * - Service worker update handling
 */

import { useState, useEffect, useCallback } from 'react';

// ============================================================================
// Types
// ============================================================================

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

declare global {
  interface WindowEventMap {
    beforeinstallprompt: BeforeInstallPromptEvent;
  }
}

// ============================================================================
// Install Prompt Hook
// ============================================================================

export interface UseInstallPromptResult {
  /** Whether the install prompt is available */
  canInstall: boolean;
  /** Whether the app is already installed */
  isInstalled: boolean;
  /** Whether we're on iOS (needs manual install instructions) */
  isIOS: boolean;
  /** Trigger the install prompt */
  promptInstall: () => Promise<boolean>;
}

/**
 * Hook for PWA install prompt
 */
export function useInstallPrompt(): UseInstallPromptResult {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);

  // Detect iOS
  const isIOS = typeof navigator !== 'undefined' &&
    /iPad|iPhone|iPod/.test(navigator.userAgent) &&
    !(window as unknown as { MSStream?: unknown }).MSStream;

  useEffect(() => {
    // Check if already installed (standalone mode)
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setIsInstalled(true);
      return;
    }

    // Listen for install prompt
    const handleBeforeInstall = (e: BeforeInstallPromptEvent) => {
      e.preventDefault();
      setInstallPrompt(e);
    };

    // Listen for successful installation
    const handleAppInstalled = () => {
      setIsInstalled(true);
      setInstallPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const promptInstall = useCallback(async (): Promise<boolean> => {
    if (!installPrompt) return false;

    try {
      await installPrompt.prompt();
      const { outcome } = await installPrompt.userChoice;

      if (outcome === 'accepted') {
        setInstallPrompt(null);
        return true;
      }
      return false;
    } catch (err) {
      console.error('Install prompt failed:', err);
      return false;
    }
  }, [installPrompt]);

  return {
    canInstall: !!installPrompt && !isInstalled,
    isInstalled,
    isIOS,
    promptInstall,
  };
}

// ============================================================================
// Online Status Hook
// ============================================================================

/**
 * Hook for online/offline status with reactive updates
 */
export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}

// ============================================================================
// Service Worker Update Hook
// ============================================================================

export interface UseServiceWorkerResult {
  /** Whether the app is ready for offline use */
  offlineReady: boolean;
  /** Whether a new version is available */
  needRefresh: boolean;
  /** Update to the new version */
  updateServiceWorker: () => void;
  /** Dismiss the update notification */
  dismissUpdate: () => void;
}

/**
 * Hook for service worker updates
 * Note: This integrates with vite-plugin-pwa's virtual module
 */
export function useServiceWorker(): UseServiceWorkerResult {
  const [offlineReady, setOfflineReady] = useState(false);
  const [needRefresh, setNeedRefresh] = useState(false);
  const [updateSW, setUpdateSW] = useState<(() => void) | null>(null);

  useEffect(() => {
    // Dynamic import to avoid issues during SSR/testing
    import('virtual:pwa-register').then(({ registerSW }) => {
      const update = registerSW({
        onNeedRefresh() {
          setNeedRefresh(true);
        },
        onOfflineReady() {
          setOfflineReady(true);
        },
        onRegistered(_registration: ServiceWorkerRegistration | undefined) {
          // SW registered successfully
        },
        onRegisterError(error: Error) {
          console.error('[SW] Registration error:', error);
        },
      });
      setUpdateSW(() => update);
    }).catch(() => {
      // PWA not available (dev mode or unsupported)
    });
  }, []);

  const updateServiceWorker = useCallback(() => {
    if (updateSW) {
      updateSW();
    }
  }, [updateSW]);

  const dismissUpdate = useCallback(() => {
    setOfflineReady(false);
    setNeedRefresh(false);
  }, []);

  return {
    offlineReady,
    needRefresh,
    updateServiceWorker,
    dismissUpdate,
  };
}
