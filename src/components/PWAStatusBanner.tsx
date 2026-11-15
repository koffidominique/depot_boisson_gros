import React, { useCallback, useEffect, useState } from 'react';
import { Wifi, WifiOff } from 'lucide-react';
import { useErp } from '../context/ErpContext';
import { isOnline, isStandalone } from '../lib/pwa';

/**
 * PWAStatusBanner — Bannière d'état de connexion en bas de l'écran.
 * Affiche :
 * - En ligne / hors-ligne (réel navigator.onLine)
 * - Prêt hors-ligne (Service Worker + cache)
 * - Installé (mode autonome) — indicateur discret
 */
export function PWAStatusBanner(): React.ReactElement | null {
  const { setSimulatedOffline, simulatedOffline, offlineQueue, syncNow } = useErp();
  const [realOnline, setRealOnline] = useState(isOnline());
  const [offlineReady, setOfflineReady] = useState(false);
  const [installed, setInstalled] = useState(isStandalone());

  const pendingCount = offlineQueue.filter((q) => q.status === 'PENDING').length;

  const handleOnline = useCallback(() => setRealOnline(true), []);
  const handleOffline = useCallback(() => setRealOnline(false), []);

  useEffect(() => {
    setInstalled(isStandalone());
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [handleOnline, handleOffline]);

  const effectiveOnline = realOnline && !simulatedOffline;

  if (effectiveOnline && !offlineReady && pendingCount === 0 && installed) {
    return null;
  }

  if (effectiveOnline && pendingCount > 0) {
    return (
      <div
        className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900 shadow-lg dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-200"
        role="status"
        aria-label="Opérations hors-ligne en attente"
      >
        <Wifi className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
        <span>{pendingCount} opération(s) en file d'attente</span>
        <button
          type="button"
          onClick={syncNow}
          className="min-h-[30px] rounded border border-amber-300 bg-amber-600 px-2 text-[10px] font-semibold text-white hover:bg-amber-700 shrink-0"
        >
          Synchroniser
        </button>
      </div>
    );
  }

  if (!effectiveOnline) {
    return (
      <div
        className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-900 shadow-lg dark:border-red-900 dark:bg-red-950/60 dark:text-red-200"
        role="status"
        aria-label="Mode hors-ligne actif"
      >
        <WifiOff className="h-3.5 w-3.5 text-red-500 shrink-0" />
        <span>Mode hors-ligne — Données en cache</span>
        {pendingCount > 0 && (
          <span className="font-mono">{pendingCount} en attente</span>
        )}
      </div>
    );
  }

  // Prêt hors-ligne uniquement (en ligne, SW prêt, pas de file d'attente)
  if (offlineReady && installed) {
    return (
      <div
        className="fixed bottom-4 left-4 z-50 flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[10px] font-semibold text-emerald-900 shadow-md dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-200"
        role="status"
        aria-label="Application installée et prête hors-ligne"
      >
        <span className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
          PWA installée · Hors-ligne disponible
        </span>
      </div>
    );
  }

  return null;
}
