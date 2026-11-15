import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  enqueueOfflineItem,
  getOfflineQueue,
  loadCachedSnapshot,
  removeOfflineItems,
  saveCachedSnapshot,
  updateOfflineItem,
} from '../lib/offlineDb';
import type {
  Delegation,
  DepotDatabaseSnapshot,
  OfflineQueueItem,
  PermissionKey,
  RoleCode,
  UserAccount,
} from '../types/erp';
import { PERMISSIONS } from '../types/erp';
import { canUser, getActiveDelegationsForUser } from '../lib/format';

export type NavModuleId =
  | 'dashboard'
  | 'sales'
  | 'deliveries'
  | 'consignments'
  | 'products'
  | 'stock'
  | 'purchases'
  | 'suppliers'
  | 'customers'
  | 'credits'
  | 'returns'
  | 'treasury'
  | 'reports'
  | 'users'
  | 'audit'
  | 'settings';

export interface SwitchableProfile {
  id: string;
  name: string;
  email?: string;
  role: RoleCode;
  warehouseId: string | null;
}

export interface AuthWarehouseOption {
  id: string;
  name: string;
  zone: string;
}

export interface ToastNotice {
  id: string;
  type: 'success' | 'error' | 'warning';
  message: string;
}

export interface NavHint {
  salesTab?: 'pos' | 'history' | 'cash';
  focusQuickScan?: boolean;
  consignmentsOnlyOverdue?: boolean;
  searchQuery?: string;
  scrollToApprovals?: boolean;
  nonce: number;
}

export function canRoleAccessModule(
  user: UserAccount | null | undefined,
  module: NavModuleId,
  delegations: Delegation[] = []
): boolean {
  if (!user) return false;
  if (user.role === 'LIVREUR') {
    return ['deliveries', 'returns', 'products', 'audit'].includes(module);
  }
  switch (module) {
    case 'dashboard':
      return true;
    case 'sales':
      return (
        canUser(user, PERMISSIONS.SALE_CREATE, delegations) ||
        canUser(user, PERMISSIONS.SALE_VALIDATE, delegations) ||
        user.role === 'PROPRIETAIRE'
      );
    case 'deliveries':
      return (
        canUser(user, PERMISSIONS.DELIVERY_PLAN, delegations) ||
        canUser(user, PERMISSIONS.DELIVERY_COMPLETE, delegations) ||
        canUser(user, PERMISSIONS.ROUTE_VIEW_OWN, delegations)
      );
    case 'consignments':
      return (
        canUser(user, PERMISSIONS.CONSIGNMENT_RETURN_IN, delegations) ||
        canUser(user, PERMISSIONS.CONSIGNMENT_LOSS_OVER, delegations) ||
        user.role === 'PROPRIETAIRE'
      );
    case 'products':
    case 'stock':
      return (
        canUser(user, PERMISSIONS.PRODUCT_UPDATE, delegations) ||
        canUser(user, PERMISSIONS.PRICE_UPDATE, delegations) ||
        canUser(user, PERMISSIONS.STOCK_INVENTORY, delegations)
      );
    case 'purchases':
    case 'suppliers':
      return canUser(user, PERMISSIONS.PURCHASE_RECEIVE, delegations) || user.role === 'PROPRIETAIRE';
    case 'customers':
    case 'credits':
      return (
        canUser(user, PERMISSIONS.CUSTOMER_UPDATE, delegations) ||
        canUser(user, PERMISSIONS.CREDIT_GRANT, delegations) ||
        canUser(user, PERMISSIONS.CREDIT_LIMIT_UPDATE, delegations)
      );
    case 'returns':
      return (
        canUser(user, PERMISSIONS.STOCK_ADJUST, delegations) ||
        canUser(user, PERMISSIONS.BREAKAGE_REPORT, delegations) ||
        user.role === 'PROPRIETAIRE'
      );
    case 'treasury':
      return canUser(user, PERMISSIONS.TREASURY_MANAGE, delegations) || user.role === 'PROPRIETAIRE';
    case 'reports':
      return (
        canUser(user, PERMISSIONS.REPORT_VIEW_WAREHOUSE, delegations) ||
        canUser(user, PERMISSIONS.ACCOUNTING_EXPORT, delegations)
      );
    case 'users':
      return (
        canUser(user, PERMISSIONS.USER_CREATE, delegations) ||
        canUser(user, PERMISSIONS.DELEGATION_MANAGE, delegations)
      );
    case 'audit':
      return (
        canUser(user, PERMISSIONS.AUDIT_VIEW_ALL, delegations) ||
        canUser(user, PERMISSIONS.AUDIT_VIEW_WAREHOUSE, delegations) ||
        canUser(user, PERMISSIONS.AUDIT_VIEW_OWN, delegations)
      );
    case 'settings':
      return (
        canUser(user, PERMISSIONS.SETTINGS_UPDATE, delegations) ||
        canUser(user, PERMISSIONS.WAREHOUSE_MANAGE, delegations)
      );
    default:
      return false;
  }
}

interface ErpContextValue {
  isAuthenticated: boolean;
  authWarehouses: AuthWarehouseOption[];
  login: (identifier: string, pin: string) => Promise<{ ok: boolean; error?: string }>;
  register: (input: {
    name: string;
    email: string;
    phone: string;
    pin: string;
    role: RoleCode;
    warehouseId?: string | null;
  }) => Promise<{ ok: boolean; error?: string }>;
  quickDemoLogin: (userId: string) => Promise<void>;
  logout: () => void;
  snapshot: DepotDatabaseSnapshot | null;
  loading: boolean;
  activeModule: NavModuleId;
  setActiveModule: (m: NavModuleId) => void;
  navHint: NavHint | null;
  navigateWithHint: (m: NavModuleId, hint?: Omit<NavHint, 'nonce'>) => void;
  clearNavHint: () => void;
  currentUser: UserAccount | null;
  switchableProfiles: SwitchableProfile[];
  switchUser: (userId: string) => void;
  hasPerm: (perm: PermissionKey) => boolean;
  activeDelegations: Delegation[];
  selectedWarehouseId: string;
  setSelectedWarehouseId: (whId: string) => void;
  activeWarehouseId: string;
  canViewFinancials: boolean;
  isOnline: boolean;
  simulatedOffline: boolean;
  setSimulatedOffline: (val: boolean) => void;
  offlineQueue: OfflineQueueItem[];
  syncNow: () => Promise<void>;
  refreshSnapshot: (userIdOverride?: string) => Promise<void>;
  mutateApi: <T = unknown>(
    url: string,
    method: 'POST' | 'PATCH' | 'DELETE',
    body?: unknown,
    offlineFallback?: {
      actionType: OfflineQueueItem['actionType'];
      summary: string;
      payload?: Record<string, unknown>;
      optimisticUpdate?: (prev: DepotDatabaseSnapshot) => DepotDatabaseSnapshot;
    }
  ) => Promise<T | null>;
  toasts: ToastNotice[];
  notify: (type: ToastNotice['type'], message: string) => void;
  dismissToast: (id: string) => void;
  darkMode: boolean;
  toggleDarkMode: () => void;
}

const ErpContext = createContext<ErpContextValue | null>(null);

export const ErpProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(
    () => localStorage.getItem('gestdepot_authenticated') === 'true'
  );
  const [snapshot, setSnapshot] = useState<DepotDatabaseSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeModule, setActiveModule] = useState<NavModuleId>('dashboard');
  const [currentUserId, setCurrentUserId] = useState<string>(
    () => localStorage.getItem('gestdepot_user_id') || 'usr-proprietaire'
  );
  const [switchableProfiles, setSwitchableProfiles] = useState<SwitchableProfile[]>([]);
  const [authWarehouses, setAuthWarehouses] = useState<AuthWarehouseOption[]>([]);
  const [ownerWarehouseFilter, setOwnerWarehouseFilter] = useState<string>('ALL');
  const [browserOnline, setBrowserOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [simulatedOffline, setSimulatedOffline] = useState<boolean>(false);
  const [offlineQueue, setOfflineQueue] = useState<OfflineQueueItem[]>([]);
  const [toasts, setToasts] = useState<ToastNotice[]>([]);
  const [darkMode, setDarkMode] = useState<boolean>(() => localStorage.getItem('gestdepot_dark') === 'true');
  const [navHint, setNavHint] = useState<NavHint | null>(null);

  const navigateWithHint = useCallback((m: NavModuleId, hint?: Omit<NavHint, 'nonce'>) => {
    setActiveModule(m);
    if (hint) {
      setNavHint({ ...hint, nonce: Date.now() });
    } else {
      setNavHint(null);
    }
  }, []);

  const clearNavHint = useCallback(() => setNavHint(null), []);

  const isOnline = browserOnline && !simulatedOffline;

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    localStorage.setItem('gestdepot_dark', String(darkMode));
  }, [darkMode]);

  const toggleDarkMode = () => setDarkMode((d) => !d);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const notify = useCallback(
    (type: ToastNotice['type'], message: string) => {
      const id = `tst-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
      setToasts((prev) => [...prev.slice(-3), { id, type, message }]);
      setTimeout(() => dismissToast(id), 5000);
    },
    [dismissToast]
  );

  useEffect(() => {
    const onOnline = () => setBrowserOnline(true);
    const onOffline = () => setBrowserOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const fetchProfiles = useCallback(async () => {
    try {
      const [profRes, whRes] = await Promise.all([
        fetch('/api/demo-profiles'),
        fetch('/api/auth/warehouses'),
      ]);
      if (profRes.ok) {
        const data = await profRes.json();
        if (Array.isArray(data.profiles)) {
          setSwitchableProfiles(data.profiles);
        }
      }
      if (whRes.ok) {
        const whData = await whRes.json();
        if (Array.isArray(whData.warehouses)) {
          setAuthWarehouses(whData.warehouses);
        }
      }
    } catch {
      // Ignore offline
    }
  }, []);

  const refreshSnapshot = useCallback(
    async (userIdOverride?: string) => {
      const uid = userIdOverride || currentUserId;
      try {
        let res = await fetch('/api/snapshot', {
          headers: { 'X-User-Id': uid },
        });
        if (res.status === 401 && uid !== 'usr-proprietaire') {
          setCurrentUserId('usr-proprietaire');
          localStorage.setItem('gestdepot_user_id', 'usr-proprietaire');
          res = await fetch('/api/snapshot', {
            headers: { 'X-User-Id': 'usr-proprietaire' },
          });
        }
        if (!res.ok) throw new Error('Erreur réseau');
        const data = (await res.json()) as DepotDatabaseSnapshot;
        setSnapshot(data);
        if (data.users.length > 1) {
          setSwitchableProfiles(
            data.users
              .filter((u) => !u.deletedAt && u.active)
              .map((u) => ({
                id: u.id,
                name: u.name,
                email: u.email,
                role: u.role,
                warehouseId: u.warehouseId,
              }))
          );
        }
        await saveCachedSnapshot(data);
      } catch {
        const cached = await loadCachedSnapshot();
        if (cached) {
          setSnapshot(cached);
        }
      } finally {
        setLoading(false);
      }
    },
    [currentUserId]
  );

  useEffect(() => {
    fetchProfiles();
    refreshSnapshot();
    getOfflineQueue().then(setOfflineQueue);
  }, [fetchProfiles, refreshSnapshot]);

  const currentUser =
    snapshot?.users.find((u) => u.id === currentUserId && !u.deletedAt && u.active) ||
    snapshot?.users[0] ||
    null;

  // Enforce allowed module when switching user or loading
  useEffect(() => {
    if (!currentUser || !snapshot) return;
    if (!canRoleAccessModule(currentUser, activeModule, snapshot.delegations)) {
      setActiveModule(currentUser.role === 'LIVREUR' ? 'deliveries' : 'dashboard');
    }
  }, [currentUser, snapshot, activeModule]);

  const switchUser = useCallback(
    (userId: string) => {
      setCurrentUserId(userId);
      localStorage.setItem('gestdepot_user_id', userId);
      localStorage.setItem('gestdepot_authenticated', 'true');
      setIsAuthenticated(true);
      const found =
        switchableProfiles.find((u) => u.id === userId) ||
        snapshot?.users.find((u) => u.id === userId);
      if (found) {
        notify('success', `Profil actif : ${found.name} (${found.role})`);
        if (found.role === 'LIVREUR') {
          setActiveModule('deliveries');
        } else {
          setActiveModule('dashboard');
        }
      }
      refreshSnapshot(userId);
    },
    [switchableProfiles, snapshot, notify, refreshSnapshot]
  );

  const login = useCallback(
    async (identifier: string, pin: string): Promise<{ ok: boolean; error?: string }> => {
      if (!isOnline) {
        const cached = await loadCachedSnapshot();
        const cleanId = identifier.trim().toLowerCase();
        const digits = cleanId.replace(/\D/g, '');
        const found = cached?.users.find(
          (u) =>
            !u.deletedAt &&
            u.active &&
            (u.email.toLowerCase() === cleanId ||
              (digits.length >= 6 && u.phone.replace(/\D/g, '').endsWith(digits))) &&
            u.pin === pin.trim()
        );
        if (found && cached) {
          setCurrentUserId(found.id);
          localStorage.setItem('gestdepot_user_id', found.id);
          localStorage.setItem('gestdepot_authenticated', 'true');
          setIsAuthenticated(true);
          setSnapshot(cached);
          setActiveModule(found.role === 'LIVREUR' ? 'deliveries' : 'dashboard');
          notify('success', `Connexion hors-ligne : ${found.name}`);
          return { ok: true };
        }
        return {
          ok: false,
          error: 'Mode hors-ligne actif : identifiants introuvables dans le cache local.',
        };
      }

      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifier, pin }),
        });
        const data = await res.json();
        if (!res.ok) {
          return { ok: false, error: data.error || 'Identifiants invalides.' };
        }
        const user = data.user as UserAccount;
        setCurrentUserId(user.id);
        localStorage.setItem('gestdepot_user_id', user.id);
        localStorage.setItem('gestdepot_authenticated', 'true');
        setIsAuthenticated(true);
        if (data.snapshot) {
          setSnapshot(data.snapshot);
          await saveCachedSnapshot(data.snapshot);
        }
        setActiveModule(user.role === 'LIVREUR' ? 'deliveries' : 'dashboard');
        notify('success', `Bienvenue ${user.name} (${user.role})`);
        fetchProfiles();
        return { ok: true };
      } catch {
        return { ok: false, error: 'Impossible de joindre le serveur GestDepot.' };
      }
    },
    [isOnline, notify, fetchProfiles]
  );

  const register = useCallback(
    async (input: {
      name: string;
      email: string;
      phone: string;
      pin: string;
      role: RoleCode;
      warehouseId?: string | null;
    }): Promise<{ ok: boolean; error?: string }> => {
      if (!isOnline) {
        return {
          ok: false,
          error: 'La création d’un nouveau compte nécessite une connexion serveur.',
        };
      }
      try {
        const res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        });
        const data = await res.json();
        if (!res.ok) {
          return { ok: false, error: data.error || 'Erreur lors de l’inscription.' };
        }
        const user = data.user as UserAccount;
        setCurrentUserId(user.id);
        localStorage.setItem('gestdepot_user_id', user.id);
        localStorage.setItem('gestdepot_authenticated', 'true');
        setIsAuthenticated(true);
        if (data.snapshot) {
          setSnapshot(data.snapshot);
          await saveCachedSnapshot(data.snapshot);
        }
        setActiveModule(user.role === 'LIVREUR' ? 'deliveries' : 'dashboard');
        notify('success', `Compte créé avec succès : ${user.name}`);
        fetchProfiles();
        return { ok: true };
      } catch {
        return { ok: false, error: 'Impossible de joindre le serveur GestDepot.' };
      }
    },
    [isOnline, notify, fetchProfiles]
  );

  const quickDemoLogin = useCallback(
    async (userId: string) => {
      setCurrentUserId(userId);
      localStorage.setItem('gestdepot_user_id', userId);
      localStorage.setItem('gestdepot_authenticated', 'true');
      setIsAuthenticated(true);
      const found = switchableProfiles.find((u) => u.id === userId);
      if (found) {
        setActiveModule(found.role === 'LIVREUR' ? 'deliveries' : 'dashboard');
        notify('success', `Session démo ouverte : ${found.name}`);
      }
      await refreshSnapshot(userId);
    },
    [switchableProfiles, notify, refreshSnapshot]
  );

  const logout = useCallback(() => {
    localStorage.removeItem('gestdepot_authenticated');
    setIsAuthenticated(false);
    fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    notify('warning', 'Session fermée. Connectez-vous pour continuer.');
  }, [notify]);

  const activeDelegations = useMemo(
    () => getActiveDelegationsForUser(currentUser, snapshot?.delegations),
    [currentUser, snapshot?.delegations]
  );

  const hasPerm = useCallback(
    (perm: PermissionKey) => canUser(currentUser, perm, snapshot?.delegations),
    [currentUser, snapshot?.delegations]
  );

  const selectedWarehouseId =
    currentUser?.role === 'PROPRIETAIRE'
      ? ownerWarehouseFilter
      : currentUser?.warehouseId || 'wh-main';

  const setSelectedWarehouseId = useCallback(
    (whId: string) => {
      if (currentUser?.role === 'PROPRIETAIRE') {
        setOwnerWarehouseFilter(whId);
      }
    },
    [currentUser?.role]
  );

  const activeWarehouseId = useMemo(() => {
    if (selectedWarehouseId !== 'ALL') return selectedWarehouseId;
    return (
      snapshot?.warehouses.find((w) => w.isDefault && !w.deletedAt)?.id ||
      snapshot?.warehouses[0]?.id ||
      'wh-main'
    );
  }, [selectedWarehouseId, snapshot?.warehouses]);

  const canViewFinancials = currentUser?.role !== 'LIVREUR';

  const syncNow = useCallback(async () => {
    if (!isOnline) {
      notify('warning', 'Connexion indisponible : impossible de synchroniser maintenant.');
      return;
    }
    const queue = await getOfflineQueue();
    const pending = queue.filter((q) => q.status === 'PENDING');
    if (pending.length === 0) {
      await refreshSnapshot();
      notify('success', 'Base synchronisée à jour.');
      return;
    }

    try {
      const res = await fetch('/api/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': currentUser?.id || 'usr-proprietaire',
        },
        body: JSON.stringify({ items: pending }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Échec de synchronisation');

      const syncedIds: string[] = [];
      let conflictCount = 0;

      for (const r of data.results || []) {
        if (r.status === 'SYNCED') {
          syncedIds.push(r.id);
        } else {
          conflictCount++;
          const orig = pending.find((p) => p.id === r.id);
          if (orig) {
            await updateOfflineItem({ ...orig, status: 'CONFLICT', errorMessage: r.error });
          }
        }
      }

      if (syncedIds.length > 0) {
        await removeOfflineItems(syncedIds);
      }
      const nextQueue = await getOfflineQueue();
      setOfflineQueue(nextQueue);

      if (data.snapshot) {
        setSnapshot(data.snapshot);
        await saveCachedSnapshot(data.snapshot);
      }

      if (conflictCount > 0) {
        notify('warning', `${syncedIds.length} opération(s) synchronisée(s), ${conflictCount} conflit(s) à vérifier.`);
      } else {
        notify('success', `${syncedIds.length} opération(s) hors-ligne synchronisée(s) avec succès.`);
      }
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Erreur de synchronisation');
    }
  }, [isOnline, currentUser, refreshSnapshot, notify]);

  useEffect(() => {
    if (isOnline && offlineQueue.some((i) => i.status === 'PENDING')) {
      syncNow();
    }
  }, [isOnline, offlineQueue, syncNow]);

  const mutateApi = useCallback(
    async <T = unknown,>(
      url: string,
      method: 'POST' | 'PATCH' | 'DELETE',
      body?: unknown,
      offlineFallback?: {
        actionType: OfflineQueueItem['actionType'];
        summary: string;
        payload?: Record<string, unknown>;
        optimisticUpdate?: (prev: DepotDatabaseSnapshot) => DepotDatabaseSnapshot;
      }
    ): Promise<T | null> => {
      if (!isOnline) {
        if (!offlineFallback) {
          notify('error', 'Mode hors-ligne actif : cette opération d’administration nécessite une connexion serveur.');
          return null;
        }
        const item: OfflineQueueItem = {
          id: `off-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          createdAt: new Date().toISOString(),
          actionType: offlineFallback.actionType,
          payload: offlineFallback.payload ?? ((body || {}) as Record<string, unknown>),
          userId: currentUser?.id || 'usr-gerant',
          summary: offlineFallback.summary,
          status: 'PENDING',
        };
        const nextQ = await enqueueOfflineItem(item);
        setOfflineQueue(nextQ);
        if (offlineFallback.optimisticUpdate && snapshot) {
          const updated = offlineFallback.optimisticUpdate(snapshot);
          setSnapshot(updated);
          await saveCachedSnapshot(updated);
        }
        notify('warning', `Enregistré localement (Hors-ligne) : ${offlineFallback.summary}`);
        return { offlineQueued: true, offlineId: item.id } as unknown as T;
      }

      try {
        const res = await fetch(url, {
          method,
          headers: {
            'Content-Type': 'application/json',
            'X-User-Id': currentUser?.id || 'usr-proprietaire',
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });
        const data = await res.json();
        if (!res.ok) {
          notify('error', data.error || 'Opération refusée');
          return null;
        }
        if (data.snapshot) {
          setSnapshot(data.snapshot);
          await saveCachedSnapshot(data.snapshot);
          if (data.snapshot.users?.length > 1) {
            setSwitchableProfiles(
              data.snapshot.users
                .filter((u: UserAccount) => !u.deletedAt && u.active)
                .map((u: UserAccount) => ({
                  id: u.id,
                  name: u.name,
                  role: u.role,
                  warehouseId: u.warehouseId,
                }))
            );
          }
        } else if (url === '/api/system/reset-demo' || url === '/api/system/restore') {
          setSnapshot(data);
          await saveCachedSnapshot(data);
        }
        return data as T;
      } catch (err) {
        notify('error', err instanceof Error ? err.message : 'Erreur réseau');
        return null;
      }
    },
    [isOnline, currentUser, snapshot, notify]
  );

  return (
    <ErpContext.Provider
      value={{
        isAuthenticated,
        authWarehouses,
        login,
        register,
        quickDemoLogin,
        logout,
        snapshot,
        loading,
        activeModule,
        setActiveModule,
        navHint,
        navigateWithHint,
        clearNavHint,
        currentUser,
        switchableProfiles,
        switchUser,
        hasPerm,
        activeDelegations,
        selectedWarehouseId,
        setSelectedWarehouseId,
        activeWarehouseId,
        canViewFinancials,
        isOnline,
        simulatedOffline,
        setSimulatedOffline,
        offlineQueue,
        syncNow,
        refreshSnapshot,
        mutateApi,
        toasts,
        notify,
        dismissToast,
        darkMode,
        toggleDarkMode,
      }}
    >
      {children}
    </ErpContext.Provider>
  );
};

export function useErp(): ErpContextValue {
  const ctx = useContext(ErpContext);
  if (!ctx) throw new Error('useErp must be used within ErpProvider');
  return ctx;
}
