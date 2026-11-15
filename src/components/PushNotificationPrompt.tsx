import React, { useCallback, useState } from 'react';
import { Bell, Loader2 } from 'lucide-react';
import { useErp } from '../context/ErpContext';

/**
 * PushNotificationPrompt — Bouton pour s'abonner / se désabonner aux notifications push.
 * Affiche l'état actuel et permet d'activer/désactiver les notifications.
 */
export function PushNotificationPrompt(): React.ReactElement | null {
  const {
    pushState,
    pushSubscription,
    subscribePush,
    unsubscribePush,
    isOnline,
  } = useErp();

  const [isLoading, setIsLoading] = React.useState(false);

  const handleSubscribe = useCallback(async () => {
    setIsLoading(true);
    try {
      await subscribePush();
    } finally {
      setIsLoading(false);
    }
  }, [subscribePush]);

  const handleUnsubscribe = useCallback(async () => {
    setIsLoading(true);
    try {
      await unsubscribePush();
    } finally {
      setIsLoading(false);
    }
  }, [unsubscribePush]);

  if (!pushState.isSupported) {
    return null;
  }

  const isSubscribed = pushState.isSubscribed || !!pushSubscription;

  if (isSubscribed) {
    return (
      <button
        type="button"
        onClick={handleUnsubscribe}
        disabled={isLoading || !isOnline}
        className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-900 transition-colors hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-200"
      >
        <Bell className="h-3.5 w-3.5" />
        <span>Notifications activées</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleSubscribe}
      disabled={isLoading || !isOnline || pushState.permission === 'denied'}
      className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors disabled:opacity-50 ${
        pushState.permission === 'denied'
          ? 'border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400'
          : 'border-emerald-200 bg-emerald-50 text-emerald-900 hover:bg-emerald-100 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-200'
      }`}
    >
      {isLoading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Bell className="h-3.5 w-3.5" />
      )}
      <span>
        {pushState.permission === 'denied' ? 'Notifications bloquées' : 'Activer les notifications'}
      </span>
    </button>
  );
}
