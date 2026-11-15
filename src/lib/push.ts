/**
 * push.ts — Utilitaires notifications Push pour GestDepot.
 * Gère l'abonnement au Push Service, l'envoi de l'abonnement au serveur,
 * et le désabonnement.
 */

export interface PushSubscriptionState {
  isSupported: boolean;
  isSubscribed: boolean;
  permission: NotificationPermission;
  // Utilisation d'un type structurel inline pour éviter tout conflit avec le
  // type global `PushSubscription` de l'API DOM.
  subscription: {
    id: string;
    userId: string;
    endpoint: string;
    p256dh: string;
    auth: string;
    createdAt: string;
    active: boolean;
  } | null;
}

/**
 * Récupère la clé publique VAPID depuis le serveur (avec cache en mémoire).
 */
let cachedVapidPublicKey: string | null = null;

export async function fetchVapidPublicKey(): Promise<string | null> {
  if (cachedVapidPublicKey) return cachedVapidPublicKey;
  try {
    const res = await fetch('/api/push/vapid-public-key');
    if (!res.ok) return null;
    const data = await res.json();
    if (data.publicKey) {
      cachedVapidPublicKey = data.publicKey;
      return data.publicKey;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Convertit une clé VAPID base64 URL en Uint8Array pour l'API Push.
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}

/**
 * Vérifie si les notifications push sont supportées et l'état d'abonnement actuel.
 */
export async function getPushState(): Promise<PushSubscriptionState> {
  const isSupported =
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window;

  if (!isSupported) {
    return { isSupported: false, isSubscribed: false, permission: 'denied', subscription: null };
  }

  const permission = Notification.permission;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();

  return {
    isSupported: true,
    isSubscribed: !!subscription,
    permission,
    subscription: subscription
      ? {
          id: `ps-client-${Date.now()}`,
          userId: '', // côté client, on ne connaît pas l'ID serveur (renvoyé par l'API)
          endpoint: subscription.endpoint,
          p256dh: btoa(
            String.fromCharCode(...new Uint8Array(subscription.getKey('p256dh')!))
          ),
          auth: btoa(String.fromCharCode(...new Uint8Array(subscription.getKey('auth')!))),
          createdAt: new Date().toISOString(),
          active: true,
        }
      : null,
  };
}

/**
 * S'abonner aux notifications push et envoyer l'abonnement au serveur.
 * Retourne l'abonnement créé (avec id serveur).
 */
export async function subscribePush(): Promise<{
  ok: boolean;
  subscription?: PushSubscriptionState['subscription'];
  error?: string;
}> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return { ok: false, error: 'Service Worker non disponible.' };
  }

  const permission = Notification.permission;
  if (permission !== 'granted') {
    return { ok: false, error: 'Permission de notification refusée.' };
  }

  const vapidKey = await fetchVapidPublicKey();
  if (!vapidKey) {
    return { ok: false, error: 'Clé VAPID introuvable.' };
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey) as unknown as BufferSource,
    });

    const rawKey = subscription.getKey('p256dh');
    const rawAuth = subscription.getKey('auth');

    const res = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpoint: subscription.endpoint,
        p256dh: rawKey ? btoa(String.fromCharCode(...new Uint8Array(rawKey))) : '',
        auth: rawAuth ? btoa(String.fromCharCode(...new Uint8Array(rawAuth))) : '',
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { ok: false, error: err.error || 'Échec de l\'abonnement push.' };
    }

    const data = await res.json();
    return {
      ok: true,
      subscription: data.subscription as PushSubscriptionState['subscription'],
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Erreur inconnue lors de l\'abonnement.',
    };
  }
}

/**
 * Se désabonner des notifications push.
 */
export async function unsubscribePush(subscriptionId: string): Promise<{
  ok: boolean;
  error?: string;
}> {
  if (typeof window === 'undefined') {
    return { ok: false, error: 'Service Worker non disponible.' };
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      await subscription.unsubscribe();
    }

    const res = await fetch(`/api/push/unsubscribe/${subscriptionId}`, {
      method: 'DELETE',
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { ok: false, error: err.error || 'Échec du désabonnement.' };
    }

    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Erreur inconnue.',
    };
  }
}

/**
 * Demander la permission de notification au navigateur.
 */
export async function requestPermission(): Promise<NotificationPermission> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'denied';
  }
  return Notification.requestPermission();
}
