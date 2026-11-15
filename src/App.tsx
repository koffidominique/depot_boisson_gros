import React, { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertTriangle,
  ArchiveRestore,
  BarChart3,
  Boxes,
  Building2,
  CreditCard,
  Factory,
  FileSpreadsheet,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Package,
  RefreshCw,
  RotateCcw,
  ScanBarcode,
  ScrollText,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Sun,
  Truck,
  Users,
  Wallet,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import {
  canRoleAccessModule,
  ErpProvider,
  useErp,
  type NavModuleId,
} from './context/ErpContext';
import { AuthView } from './components/AuthView';
import { GlobalSearchBar } from './components/GlobalSearchBar';
import { PWAInstallButton } from './components/PWAInstallButton';
import { DashboardView } from './modules/DashboardView';
import { PosSalesView } from './modules/PosSalesView';
import { ConsignmentsView } from './modules/ConsignmentsView';
import { DeliveriesView } from './modules/DeliveriesView';
import { ProductsView, StockView } from './modules/ProductsStockView';
import { PurchasesView, SuppliersView } from './modules/PurchasesSuppliersView';
import { CustomersView, CreditsView } from './modules/CustomersCreditsView';
import { ReturnsBreakagesView, TreasuryView } from './modules/TreasuryReturnsView';
import {
  AuditLogsView,
  ReportsView,
  SettingsView,
  UsersRbacView,
} from './modules/GovernanceReportsView';
import { PERMISSIONS, ROLE_LABELS } from './types/erp';
import { formatDateFR } from './lib/format';

interface NavGroup {
  title: string;
  items: { id: NavModuleId; label: string; driverLabel?: string; icon: React.ComponentType<{ className?: string }> }[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    title: 'Pilotage & Opérations',
    items: [
      { id: 'dashboard', label: 'Tableau de bord', icon: LayoutDashboard },
      { id: 'sales', label: 'Ventes / Caisse POS', icon: ShoppingBag },
      { id: 'deliveries', label: 'Livraisons & Tournées', driverLabel: 'Ma tournée du jour', icon: Truck },
      { id: 'consignments', label: 'Consignes Casiers', icon: RotateCcw },
    ],
  },
  {
    title: 'Catalogue & Stocks',
    items: [
      { id: 'products', label: 'Produits & Cautions', driverLabel: 'Catalogue produits', icon: Package },
      { id: 'stock', label: 'Stock & Inventaires', icon: Boxes },
      { id: 'purchases', label: 'Achats & Réceptions', icon: ArchiveRestore },
      { id: 'suppliers', label: 'Brasseries', icon: Factory },
    ],
  },
  {
    title: 'Clients & Finance',
    items: [
      { id: 'customers', label: 'Clients', icon: Users },
      { id: 'credits', label: 'Crédits & Balance âgée', icon: CreditCard },
      { id: 'returns', label: 'Retours & Casse', driverLabel: 'Casse & Retour tournée', icon: AlertTriangle },
      { id: 'treasury', label: 'Trésorerie', icon: Wallet },
    ],
  },
  {
    title: 'Gouvernance & Exports',
    items: [
      { id: 'reports', label: 'Rapports & Exports', icon: FileSpreadsheet },
      { id: 'users', label: 'Utilisateurs & RBAC', icon: ShieldCheck },
      { id: 'audit', label: 'Journal d’audit', driverLabel: 'Mon journal terrain', icon: ScrollText },
      { id: 'settings', label: 'Paramétrage & Dépôts', icon: Settings },
    ],
  },
];

const MODULE_TITLES: Record<NavModuleId, string> = {
  dashboard: 'Tableau de bord',
  sales: 'Ventes / Caisse POS',
  deliveries: 'Livraisons & Tournées',
  consignments: 'Consignes Casiers & Bouteilles',
  products: 'Produits & Conditionnements',
  stock: 'Stock & Inventaires',
  purchases: 'Achats & Réceptions',
  suppliers: 'Fournisseurs / Brasseries',
  customers: 'Clients',
  credits: 'Crédits & Recouvrement',
  returns: 'Retours, Avoirs & Casse',
  treasury: 'Trésorerie',
  reports: 'Rapports & Exports',
  users: 'Utilisateurs, Rôles & Délégations',
  audit: 'Journal d’audit',
  settings: 'Paramétrage & Dépôts',
};

const ErpShell: React.FC = () => {
  const {
    isAuthenticated,
    logout,
    snapshot,
    loading,
    activeModule,
    setActiveModule,
    navigateWithHint,
    currentUser,
    switchableProfiles,
    switchUser,
    hasPerm,
    activeDelegations,
    selectedWarehouseId,
    setSelectedWarehouseId,
    isOnline,
    simulatedOffline,
    setSimulatedOffline,
    offlineQueue,
    syncNow,
    toasts,
    dismissToast,
    darkMode,
    toggleDarkMode,
  } = useErp();

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const visibleGroups = useMemo(() => {
    return NAV_GROUPS.map((g) => ({
      ...g,
      items: g.items.filter((it) =>
        canRoleAccessModule(currentUser, it.id, snapshot?.delegations)
      ),
    })).filter((g) => g.items.length > 0);
  }, [currentUser, snapshot?.delegations]);

  if (!isAuthenticated) {
    return (
      <>
        <AuthView />
        <div className="no-print fixed bottom-4 right-4 z-50 flex max-w-sm flex-col gap-2">
          <AnimatePresence>
            {toasts.map((t) => (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, y: 16, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, x: 24, scale: 0.95 }}
                transition={{ type: 'spring', stiffness: 420, damping: 28 }}
                className={`flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-xs font-semibold shadow-xl ${
                  t.type === 'error'
                    ? 'border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200'
                    : t.type === 'warning'
                    ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200'
                    : 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200'
                }`}
              >
                <span>{t.message}</span>
                <button type="button" onClick={() => dismissToast(t.id)} className="shrink-0 opacity-70 hover:opacity-100">
                  ×
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </>
    );
  }

  if (loading && !snapshot) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="space-y-3 text-center">
          <BarChart3 className="mx-auto h-8 w-8 animate-pulse text-emerald-700" />
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
            Chargement de GestDepot ERP...
          </p>
        </div>
      </div>
    );
  }

  const pendingSyncCount = offlineQueue.filter((q) => q.status === 'PENDING').length;
  const pendingApprovalsCount =
    currentUser?.role === 'LIVREUR'
      ? 0
      : snapshot?.approvals.filter(
          (a) =>
            a.status === 'EN_ATTENTE' &&
            (currentUser?.role === 'PROPRIETAIRE' || a.targetRole === 'GERANT')
        ).length || 0;

  const isDriver = currentUser?.role === 'LIVREUR';
  const isOwner = currentUser?.role === 'PROPRIETAIRE';
  const currentWarehouseName =
    snapshot?.warehouses.find((w) => w.id === currentUser?.warehouseId)?.name ||
    'Tous les dépôts';

  const renderModule = () => {
    switch (activeModule) {
      case 'dashboard':
        return <DashboardView />;
      case 'sales':
        return <PosSalesView />;
      case 'deliveries':
        return <DeliveriesView />;
      case 'consignments':
        return <ConsignmentsView />;
      case 'products':
        return <ProductsView />;
      case 'stock':
        return <StockView />;
      case 'purchases':
        return <PurchasesView />;
      case 'suppliers':
        return <SuppliersView />;
      case 'customers':
        return <CustomersView />;
      case 'credits':
        return <CreditsView />;
      case 'returns':
        return <ReturnsBreakagesView />;
      case 'treasury':
        return <TreasuryView />;
      case 'reports':
        return <ReportsView />;
      case 'users':
        return <UsersRbacView />;
      case 'audit':
        return <AuditLogsView />;
      case 'settings':
        return <SettingsView />;
      default:
        return <DashboardView />;
    }
  };

  const sidebarContent = (
    <div className="flex h-full flex-col bg-slate-900 text-slate-100">
      <div className="flex h-16 items-center justify-between border-b border-slate-800 px-5">
        <button
          type="button"
          onClick={() => {
            setActiveModule(isDriver ? 'deliveries' : 'dashboard');
            setMobileMenuOpen(false);
          }}
          className="font-display text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0"
        >
          GestDepot
        </button>
        <button
          type="button"
          onClick={() => setMobileMenuOpen(false)}
          className="rounded-lg p-1 text-slate-400 hover:text-white lg:hidden"
          aria-label="Fermer menu"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
        {visibleGroups.map((group) => (
          <div key={group.title}>
            <p className="mb-1.5 px-3 text-[11px] font-semibold text-slate-400">{group.title}</p>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = activeModule === item.id;
                const label = isDriver && item.driverLabel ? item.driverLabel : item.label;
                return (
                  <motion.button
                    key={item.id}
                    type="button"
                    whileHover={{ x: 3 }}
                    whileTap={{ scale: 0.98 }}
                    transition={{ type: 'spring', stiffness: 450, damping: 30 }}
                    onClick={() => {
                      setActiveModule(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`relative flex min-h-[40px] w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] font-medium transition-colors whitespace-nowrap ${
                      active
                        ? 'text-white'
                        : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
                    }`}
                  >
                    {active && (
                      <motion.span
                        layoutId="activeNavPill"
                        transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                        className="absolute inset-0 rounded-lg bg-emerald-700 shadow-md shadow-emerald-950/40"
                      />
                    )}
                    <Icon className="relative z-10 h-4 w-4 shrink-0" />
                    <span className="relative z-10 truncate">{label}</span>
                  </motion.button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Active User & 3-Profile Role Switcher */}
      <div className="border-t border-slate-800 p-3.5">
        <div className="flex items-center gap-2.5">
          <img
            src="/src/assets/images/avatar_gerant_1794729186364.jpg"
            alt={currentUser?.name || 'Utilisateur'}
            referrerPolicy="no-referrer"
            className="h-9 w-9 rounded-full object-cover bg-slate-700 shrink-0"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-white">{currentUser?.name}</p>
            <p className="truncate text-[11px] text-emerald-400">
              {currentUser ? ROLE_LABELS[currentUser.role] : ''}
            </p>
            <p className="truncate text-[10px] text-slate-400">
              {isOwner ? 'Vue multi-dépôts' : currentWarehouseName}
            </p>
          </div>
        </div>
        {switchableProfiles.length > 0 && (
          <select
            aria-label="Changer de profil actif"
            value={currentUser?.id || ''}
            onChange={(e) => switchUser(e.target.value)}
            className="mt-2.5 min-h-[36px] w-full rounded-lg border border-slate-700 bg-slate-800 px-2.5 text-xs text-slate-200 focus:border-emerald-500 focus:outline-none"
          >
            {switchableProfiles.map((u) => {
              const whLabel = u.warehouseId
                ? snapshot?.warehouses.find((w) => w.id === u.warehouseId)?.name.replace('Dépôt ', '') || u.warehouseId
                : 'Tous dépôts';
              return (
                <option key={u.id} value={u.id}>
                  {u.name} · {u.role} ({whLabel})
                </option>
              );
            })}
          </select>
        )}
        <button
          type="button"
          onClick={() => {
            setMobileMenuOpen(false);
            logout();
          }}
          className="mt-2 flex min-h-[36px] w-full items-center justify-center gap-1.5 rounded-lg border border-slate-700/80 bg-slate-800/60 px-3 text-xs font-semibold text-slate-300 transition-colors hover:border-red-500/60 hover:bg-red-950/50 hover:text-red-200"
        >
          <LogOut className="h-3.5 w-3.5" />
          <span>Déconnexion</span>
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      {/* Desktop Sidebar */}
      <aside className="no-print hidden w-64 shrink-0 lg:block">
        <div className="sticky top-0 h-screen">{sidebarContent}</div>
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="no-print fixed inset-0 z-50 flex lg:hidden">
          <div className="fixed inset-0 bg-black/50" onClick={() => setMobileMenuOpen(false)} />
          <div className="relative z-10 w-64 max-w-[82vw]">{sidebarContent}</div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top Bar */}
        <header className="no-print sticky top-0 z-30 flex h-16 items-center justify-between gap-2 border-b border-slate-200 bg-white/95 px-4 shadow-[0_2px_14px_-4px_rgba(15,23,42,0.08)] backdrop-blur-md sm:px-6 dark:border-slate-800 dark:bg-slate-900/95">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 text-slate-700 lg:hidden dark:border-slate-700 dark:text-slate-200"
              aria-label="Ouvrir le menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="hidden font-semibold text-slate-400 lg:inline">GestDepot</span>
              <span className="hidden text-slate-300 lg:inline">/</span>
              <span className="truncate font-semibold text-slate-900 dark:text-white">
                {isDriver && activeModule === 'deliveries'
                  ? 'Ma tournée du jour'
                  : MODULE_TITLES[activeModule]}
              </span>
            </div>
          </div>

          <GlobalSearchBar />

          <div className="flex items-center gap-2 shrink-0">
            {/* Multi-warehouse selector for Propriétaire vs Locked Depot indicator for Gérant/Livreur */}
            {snapshot && (
              isOwner ? (
                <div className="hidden md:flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-800">
                  <Building2 className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-400 shrink-0" />
                  <select
                    aria-label="Filtrer par dépôt"
                    value={selectedWarehouseId}
                    onChange={(e) => setSelectedWarehouseId(e.target.value)}
                    className="bg-transparent text-xs font-semibold text-slate-800 focus:outline-none dark:text-slate-100"
                  >
                    <option value="ALL">Tous les dépôts ({snapshot.warehouses.filter((w) => !w.deletedAt && w.active).length})</option>
                    {snapshot.warehouses
                      .filter((w) => !w.deletedAt)
                      .map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                  </select>
                </div>
              ) : (
                <div className="hidden md:flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-700 whitespace-nowrap dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                  <Building2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                  <span className="max-w-[160px] truncate">{currentWarehouseName}</span>
                </div>
              )
            )}

            {pendingApprovalsCount > 0 && (
              <motion.button
                type="button"
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.96 }}
                onClick={() => navigateWithHint('dashboard', { scrollToApprovals: true })}
                title="Validations sensibles en attente"
                className="hidden xl:inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 text-xs font-semibold text-amber-900 shadow-xs hover:bg-amber-100 whitespace-nowrap shrink-0 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-200"
              >
                <ShieldCheck className="h-3.5 w-3.5 text-amber-700 dark:text-amber-400" />
                <span>Validations ({pendingApprovalsCount})</span>
              </motion.button>
            )}

            <button
              type="button"
              onClick={() => setSimulatedOffline(!simulatedOffline)}
              title="Basculer simulation mode hors-ligne terrain"
              className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                isOnline
                  ? 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'
                  : 'border-amber-400 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/60 dark:text-amber-200'
              }`}
            >
              {isOnline ? (
                <>
                  <Wifi className="h-3.5 w-3.5 text-emerald-600" />
                  <span className="hidden xl:inline">En ligne</span>
                </>
              ) : (
                <>
                  <WifiOff className="h-3.5 w-3.5 text-amber-600" />
                  <span>Hors-ligne ({pendingSyncCount})</span>
                </>
              )}
            </button>

            {pendingSyncCount > 0 && isOnline && (
              <motion.button
                type="button"
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.96 }}
                onClick={syncNow}
                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-amber-600 px-3 text-xs font-semibold text-white shadow-sm whitespace-nowrap shrink-0"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Synchro ({pendingSyncCount})
              </motion.button>
            )}

            <PWAInstallButton />

            <button
              type="button"
              onClick={toggleDarkMode}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              aria-label="Changer thème"
            >
              {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>

            {hasPerm(PERMISSIONS.SALE_CREATE) ? (
              <motion.button
                type="button"
                whileHover={{ scale: 1.03, y: -1 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => navigateWithHint('sales', { salesTab: 'pos', focusQuickScan: true })}
                className="hidden sm:inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-emerald-700 px-3.5 text-xs font-semibold text-white shadow-sm shadow-emerald-900/20 hover:bg-emerald-800 whitespace-nowrap shrink-0"
              >
                <ScanBarcode className="h-3.5 w-3.5" />
                <span>Caisse / Scan</span>
              </motion.button>
            ) : isDriver ? (
              <motion.button
                type="button"
                whileHover={{ scale: 1.03, y: -1 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => setActiveModule('deliveries')}
                className="hidden sm:inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-emerald-700 px-3.5 text-xs font-semibold text-white shadow-sm shadow-emerald-900/20 hover:bg-emerald-800 whitespace-nowrap shrink-0"
              >
                <Truck className="h-3.5 w-3.5" />
                <span>Ma tournée</span>
              </motion.button>
            ) : (
              <motion.button
                type="button"
                whileHover={{ scale: 1.03, y: -1 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => navigateWithHint('dashboard', { scrollToApprovals: true })}
                className="hidden sm:inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 text-xs font-semibold text-white shadow-sm hover:bg-slate-800 whitespace-nowrap shrink-0 dark:bg-emerald-700"
              >
                <ShieldCheck className="h-3.5 w-3.5" />
                <span>Supervision</span>
              </motion.button>
            )}
          </div>
        </header>

        {/* Active Delegation Banner for Gérant */}
        {activeDelegations.length > 0 && (
          <div className="no-print flex flex-wrap items-center justify-between gap-2 border-b border-blue-200 bg-blue-50 px-4 py-2 text-xs font-medium text-blue-900 sm:px-6 dark:border-blue-900 dark:bg-blue-950/60 dark:text-blue-200">
            <span className="flex items-center gap-2">
              <KeyRound className="h-3.5 w-3.5 text-blue-600 shrink-0" />
              Délégation temporaire active :{' '}
              <strong>{activeDelegations.map((d) => `${d.permissionCode} (jusqu’au ${formatDateFR(d.endsAt)})`).join(' · ')}</strong>
            </span>
            <span className="text-[11px] text-blue-700 dark:text-blue-300">
              Accordée par {activeDelegations[0].fromUserName}
            </span>
          </div>
        )}

        {/* Offline Banner */}
        {!isOnline && (
          <div className="no-print flex flex-wrap items-center justify-between gap-2 bg-amber-600 px-4 py-2 text-xs font-semibold text-white sm:px-6">
            <span>
              Mode Hors-Ligne Terrain actif — Les ventes POS, livraisons signées et retours de casiers sont stockés dans IndexedDB.
            </span>
            <span className="font-mono">{pendingSyncCount} en file</span>
          </div>
        )}

        {/* Viewport */}
        <main className="mx-auto w-full max-w-[1440px] flex-1 p-4 sm:p-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeModule}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            >
              {renderModule()}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      {/* Toast Stack */}
      <div className="no-print fixed bottom-4 right-4 z-50 flex max-w-sm flex-col gap-2">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 16, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 24, scale: 0.95 }}
              transition={{ type: 'spring', stiffness: 420, damping: 28 }}
              className={`flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-xs font-semibold shadow-xl ${
                t.type === 'error'
                  ? 'border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200'
                  : t.type === 'warning'
                  ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200'
                  : 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200'
              }`}
            >
              <span>{t.message}</span>
              <button type="button" onClick={() => dismissToast(t.id)} className="shrink-0 opacity-70 hover:opacity-100">
                ×
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default function App() {
  return (
    <ErpProvider>
      <ErpShell />
    </ErpProvider>
  );
}
