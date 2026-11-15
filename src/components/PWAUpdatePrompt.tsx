import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { useErp } from '../context/ErpContext';

/**
 * PWAUpdatePrompt — Affiche une bannière quand une nouvelle version du Service Worker est prête.
 *
 * Écoute l'événement personnalisé `gestdepot:pwa-update` dispatché depuis main.tsx
 * (via le callback `onNeedRefresh` de registerSW) et depuis ErpContext.
 *
 * Comportement :
 * 1. Quand le SW détecte une nouvelle version, onNeedRefresh est appelé → event dispatché.
 * 2. La bannière s'affiche avec "Actualiser" pour installer la nouvelle version.
 * 3. Le rechargement active le nouveau SW.
 */
export function PWAUpdatePrompt(): React.ReactElement | null {
  const { notify: appNotify } = useErp();
  const [showUpdate, setShowUpdate] = useState(false);

  const handleRefresh = useCallback(() => {
    // Le nouveau SW est en attente ; recharger pour l'activer.
    window.location.reload();
  }, []);

  const handleDismiss = useCallback(() => {
    setShowUpdate(false);
  }, []);

  useEffect(() => {
    const onPWAUpdate = () => {
      appNotify('warning', 'Une nouvelle version de GestDepot est disponible.');
      setShowUpdate(true);
    };

    window.addEventListener('gestdepot:pwa-update', onPWAUpdate);
    return () => window.removeEventListener('gestdepot:pwa-update', onPWAUpdate);
  }, [appNotify]);

  if (!showUpdate) {
    return null;
  }

  return (
    <div
      className="fixed bottom-4 left-4 z-50 flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-900 shadow-lg dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-200"
      role="status"
      aria-label="Mise à jour disponible"
    >
      <AlertCircle className="h-4 w-4 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="leading-tight">Nouvelle version de GestDepot disponible</p>
        <p className="mt-0.5 text-[10px] text-amber-700 dark:text-amber-300">
          Actualisez pour profiter des dernières améliorations.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleRefresh}
          className="min-h-[32px] rounded-lg border border-amber-300 bg-amber-600 px-2.5 text-xs font-semibold text-white hover:bg-amber-700 shrink-0"
        >
          <RefreshCw className="h-3 w-3 mr-1" /> Actualiser
        </button>
        <button
          type="button"
          onClick={handleDismiss}
          className="min-h-[32px] rounded-lg border border-transparent px-2.5 text-xs font-semibold text-amber-500 hover:bg-amber-100/50 shrink-0"
        >
          Plus tard
        </button>
      </div>
    </div>
  );
}
