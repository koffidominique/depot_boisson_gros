/**
 * pwa.ts — Utilitaires PWA pour GestDepot.
 * Gère l'enregistrement du Service Worker avec callbacks,
 * la détection de la disponibilité hors-ligne et la notification de mise à jour.
 */

import type { RegisterSWOptions } from 'vite-plugin-pwa/types';
import { registerSW } from 'virtual:pwa-register';

let refreshCallback: (() => void) | null = null;
let offlineReadyCallback: (() => void) | null = null;

/**
 * Enregistre le Service Worker avec gestion des mises à jour et de l'état hors-ligne.
 * @param onNeedRefresh  Appelé quand une nouvelle version du SW est prête (à afficher dans l'UI).
 * @param onOfflineReady Appelé quand l'application est prête à fonctionner hors-ligne.
 * @returns La fonction de rechargement retournée par registerSW.
 */
export function registerPWA(
  onNeedRefresh?: () => void,
  onOfflineReady?: () => void
): ((reloadPage?: boolean) => Promise<void>) | null {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }

  refreshCallback = onNeedRefresh ?? null;
  offlineReadyCallback = onOfflineReady ?? null;

  const options: RegisterSWOptions = {
    immediate: true,
    onNeedRefresh() {
      refreshCallback?.();
    },
    onOfflineReady() {
      offlineReadyCallback?.();
    },
    onRegisterError(err: unknown) {
      console.warn('[PWA] Erreur d\'enregistrement du SW:', err);
    },
  };

  return registerSW(options);
}

/**
 * Vérifie si l'application est installée en mode autonome (PWA lancé depuis l'écran d'accueil).
 */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: minimal-ui)').matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

/**
 * Vérifie si le navigateur est actuellement en ligne.
 */
export function isOnline(): boolean {
  if (typeof navigator === 'undefined') return true;
  return navigator.onLine;
}
