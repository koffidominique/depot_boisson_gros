import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CheckCircle2,
  CreditCard,
  FileSpreadsheet,
  KeyRound,
  Lock,
  Package,
  Pencil,
  RotateCcw,
  ScanBarcode,
  ShieldCheck,
  Target,
  Truck,
  Wallet,
  XCircle,
} from 'lucide-react';
import { useErp } from '../context/ErpContext';
import { daysSince, formatDateTimeFR, formatFCFA, formatNumberFR } from '../lib/format';
import { PERMISSIONS } from '../types/erp';
import type { ApprovalRequest } from '../types/erp';

export const DashboardView: React.FC = () => {
  const {
    snapshot,
    setActiveModule,
    navigateWithHint,
    navHint,
    clearNavHint,
    mutateApi,
    hasPerm,
    currentUser,
    selectedWarehouseId,
    setSelectedWarehouseId,
    canViewFinancials,
    notify,
  } = useErp();
  const approvalsRef = useRef<HTMLDivElement | null>(null);
  const [decisionNotes, setDecisionNotes] = useState<Record<string, string>>({});
  const [editingTarget, setEditingTarget] = useState(false);
  const [targetInput, setTargetInput] = useState<string>('');

  useEffect(() => {
    if (navHint?.scrollToApprovals) {
      setTimeout(() => {
        approvalsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 150);
      clearNavHint();
    }
  }, [navHint, clearNavHint]);

  if (!snapshot || !currentUser) return null;

  // Livreur ne doit pas voir le CA global / marges / finances
  if (!canViewFinancials || currentUser.role === 'LIVREUR') {
    const myRoutes = snapshot.deliveryRoutes.filter((r) => r.driverId === currentUser.id);
    const totalStops = myRoutes.reduce((s, r) => s + r.stops.length, 0);
    const doneStops = myRoutes.reduce(
      (s, r) => s + r.stops.filter((st) => st.status === 'LIVRE' || st.status === 'RETOUR_PARTIEL').length,
      0
    );
    const cashOnHand = myRoutes.reduce((s, r) => s + r.tourExpectedCash, 0);

    return (
      <div className="space-y-6">
        <div>
          <p className="text-xs font-medium text-slate-500">Espace terrain · {currentUser.name}</p>
          <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Ma tournée du jour
          </h1>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <p className="text-xs font-medium text-slate-500">Tournées affectées</p>
            <p className="mt-2 font-mono text-2xl font-bold tabular-nums">{myRoutes.length}</p>
            <p className="mt-1 text-xs text-slate-500">{doneStops}/{totalStops} points livrés</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <p className="text-xs font-medium text-slate-500">Mini-caisse tournée (Espèces)</p>
            <p className="mt-2 font-mono text-2xl font-bold text-emerald-700 tabular-nums dark:text-emerald-400">
              {formatFCFA(cashOnHand)}
            </p>
            <p className="mt-1 text-xs text-slate-500">Isolée — à remettre au Gérant</p>
          </div>
          <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50/70 p-5 dark:border-emerald-900 dark:bg-emerald-950/30">
            <div>
              <p className="text-sm font-bold text-slate-900 dark:text-white">Feuille de route</p>
              <p className="text-xs text-slate-600 dark:text-slate-400">Valider BL & encaisser</p>
            </div>
            <button
              type="button"
              onClick={() => setActiveModule('deliveries')}
              className="rounded-lg bg-emerald-700 px-4 py-2.5 text-xs font-semibold text-white hover:bg-emerald-800"
            >
              Ouvrir
            </button>
          </div>
        </div>
      </div>
    );
  }

  const isOwner = currentUser.role === 'PROPRIETAIRE';
  const matchWh = (whId?: string | null) =>
    selectedWarehouseId === 'ALL' || !whId || whId === selectedWarehouseId;

  const scopedSales = snapshot.sales.filter((s) => matchWh(s.warehouseId));
  const scopedStocks = snapshot.stocks.filter((s) => matchWh(s.warehouseId));
  const scopedCashSessions = snapshot.cashSessions.filter((c) => matchWh(c.warehouseId));
  const scopedCredits = snapshot.credits.filter((c) => matchWh(c.warehouseId));
  const scopedRoutes = snapshot.deliveryRoutes.filter((r) => matchWh(r.warehouseId));
  const scopedApprovals = snapshot.approvals.filter((a) => matchWh(a.warehouseId));

  const todayPrefix = new Date().toISOString().slice(0, 10);
  const todaySales = scopedSales.filter(
    (s) => s.status === 'VALIDEE' && s.createdAt.slice(0, 10) === todayPrefix
  );
  const caJour = todaySales.reduce((sum, s) => sum + s.liquidTotal, 0);

  const margeJour = todaySales.reduce((sum, s) => {
    const cost = s.lines.reduce((lSum, line) => {
      const pkg = snapshot.packagings.find((p) => p.id === line.packagingId);
      return lSum + (pkg ? pkg.purchasePrice * line.qty : 0);
    }, 0);
    return sum + (s.liquidTotal - cost);
  }, 0);

  const activeCustomers = snapshot.customers.filter((c) => !c.deletedAt);
  const totalClientCratesOut = activeCustomers.reduce((s, c) => s + c.consignmentCrates, 0);
  const totalClientDepositDue = activeCustomers.reduce((s, c) => s + c.consignmentDepositDue, 0);
  const overdueCrateCustomers = activeCustomers.filter(
    (c) =>
      c.consignmentCrates > 0 &&
      c.lastCrateOutDate &&
      daysSince(c.lastCrateOutDate) > snapshot.company.consignmentOverdueDays
  );

  const overdueCredits = scopedCredits.filter(
    (c) =>
      c.remainingAmount > 0 &&
      c.status !== 'ABANDONNE' &&
      (c.status === 'EN_RETARD' || new Date(c.dueDate) < new Date())
  );
  const totalOverdueAmount = overdueCredits.reduce((s, c) => s + c.remainingAmount, 0);

  const lowStockItems = scopedStocks
    .map((stk) => {
      const pkg = snapshot.packagings.find((p) => p.id === stk.packagingId && !p.deletedAt);
      return pkg && stk.qtyOnHand <= pkg.alertThreshold ? { stk, pkg } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  // Dynamic Widget 1: Objectif de vente du jour
  const activeDepotsCount = Math.max(
    1,
    snapshot.warehouses.filter((w) => !w.deletedAt && w.active).length
  );
  const perDepotTarget = snapshot.company.dailySalesTarget || 1500000;
  const dailyTargetAmount =
    selectedWarehouseId === 'ALL' ? perDepotTarget * activeDepotsCount : perDepotTarget;
  const targetRatio = dailyTargetAmount > 0 ? caJour / dailyTargetAmount : 0;
  const targetPct = Math.min(999, Math.round(targetRatio * 100));
  const counterSalesToday = todaySales
    .filter((s) => !s.deliveryRequired)
    .reduce((sum, s) => sum + s.liquidTotal, 0);
  const deliverySalesToday = todaySales
    .filter((s) => s.deliveryRequired)
    .reduce((sum, s) => sum + s.liquidTotal, 0);

  // Dynamic Widget 2: Taux de remplissage des casiers (Emballages consignés)
  const returnablePkgIds = new Set(
    snapshot.packagings.filter((p) => !p.deletedAt && p.isReturnable).map((p) => p.id)
  );
  const fullCratesInStock = scopedStocks
    .filter((s) => returnablePkgIds.has(s.packagingId))
    .reduce((sum, s) => sum + s.qtyOnHand, 0);
  const emptyCratesInDepot = scopedStocks
    .filter((s) => returnablePkgIds.has(s.packagingId))
    .reduce((sum, s) => sum + s.emptyCratesOnHand, 0);
  const totalDepotCrates = fullCratesInStock + emptyCratesInDepot;
  const crateFillRatePct =
    totalDepotCrates > 0 ? Math.round((fullCratesInStock / totalDepotCrates) * 100) : 0;

  // Dynamic Widget 3: Alerte rapide produits proches de la rupture (<= 1.5x seuil)
  const nearStockoutItems = scopedStocks
    .map((stk) => {
      const pkg = snapshot.packagings.find((p) => p.id === stk.packagingId && !p.deletedAt);
      if (!pkg) return null;
      const nearLimit = Math.ceil(pkg.alertThreshold * 1.5);
      if (stk.qtyOnHand > nearLimit) return null;
      const whName = snapshot.warehouses.find((w) => w.id === stk.warehouseId)?.name || stk.warehouseId;
      const severity: 'OUT' | 'CRITICAL' | 'NEAR' =
        stk.qtyOnHand <= 0 ? 'OUT' : stk.qtyOnHand <= pkg.alertThreshold ? 'CRITICAL' : 'NEAR';
      const ratio = stk.qtyOnHand / Math.max(1, pkg.alertThreshold);
      return { stk, pkg, whName, severity, ratio };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => a.ratio - b.ratio);

  const handleSaveDailyTarget = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = Math.max(50000, Number(targetInput) || perDepotTarget);
    const res = await mutateApi('/api/settings', 'PATCH', { dailySalesTarget: val });
    if (res) {
      notify('success', `Objectif journalier mis à jour : ${formatFCFA(val)} / dépôt.`);
      setEditingTarget(false);
    }
  };

  const activeCash = scopedCashSessions.find((c) => c.status === 'OUVERTE');
  const pendingCashValidation = scopedCashSessions.find((c) => c.status === 'EN_ATTENTE_VALIDATION');
  const lastClosedCash = scopedCashSessions.find((c) => c.status === 'CLOTUREE');
  const pendingDriverReturns = scopedRoutes.filter((r) => r.status === 'EN_ATTENTE_REMISE');

  // Top 5 products
  const productRevenueMap: Record<string, { label: string; qty: number; revenue: number }> = {};
  scopedSales
    .filter((s) => s.status === 'VALIDEE')
    .forEach((s) => {
      s.lines.forEach((l) => {
        const pkg = snapshot.packagings.find((p) => p.id === l.packagingId);
        if (!pkg) return;
        if (!productRevenueMap[pkg.id]) {
          productRevenueMap[pkg.id] = { label: pkg.label, qty: 0, revenue: 0 };
        }
        productRevenueMap[pkg.id].qty += l.qty;
        productRevenueMap[pkg.id].revenue += l.lineLiquidTotal;
      });
    });
  const topProducts = Object.values(productRevenueMap)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);

  // Top 5 customers
  const custRevMap: Record<string, { name: string; zone: string; revenue: number; crates: number }> = {};
  scopedSales
    .filter((s) => s.status === 'VALIDEE' && s.customerId !== 'cust-comptoir')
    .forEach((s) => {
      const c = snapshot.customers.find((x) => x.id === s.customerId);
      if (!c) return;
      if (!custRevMap[c.id]) {
        custRevMap[c.id] = { name: c.name, zone: c.zone, revenue: 0, crates: c.consignmentCrates };
      }
      custRevMap[c.id].revenue += s.liquidTotal;
    });
  const topCustomers = Object.values(custRevMap)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);

  const last7Days = Array.from({ length: 7 }, (_, idx) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - idx));
    const key = d.toISOString().slice(0, 10);
    const label = d.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit' });
    const dayTotal = scopedSales
      .filter((s) => s.status === 'VALIDEE' && s.createdAt.slice(0, 10) === key)
      .reduce((sum, s) => sum + s.liquidTotal, 0);
    return { key, label, total: dayTotal };
  });
  const maxDayRev = Math.max(100000, ...last7Days.map((d) => d.total));

  const pendingApprovals = scopedApprovals.filter((a) => a.status === 'EN_ATTENTE');

  const canApproveRequest = (apr: ApprovalRequest): boolean => {
    if (apr.requestedBy === currentUser.id) return false;
    if (isOwner) return true;
    if (apr.targetRole === 'GERANT' && currentUser.role === 'GERANT') return true;
    if (apr.type === 'CLOTURE_CAISSE' || apr.type === 'ECART_TOURNEE') {
      return hasPerm(PERMISSIONS.CASH_CLOSE_VALIDATE);
    }
    if (apr.type === 'REMISE_EXCEPTIONNELLE') return hasPerm(PERMISSIONS.SALE_DISCOUNT_OVER_5);
    if (apr.type === 'AJUSTEMENT_INVENTAIRE') return hasPerm(PERMISSIONS.STOCK_ADJUST_OVER_5);
    if (apr.type === 'ABANDON_CREANCE') return hasPerm(PERMISSIONS.CREDIT_WRITE_OFF);
    return false;
  };

  const handleApproval = async (id: string, decision: 'APPROUVE' | 'REJETE') => {
    const res = await mutateApi<{ approval?: { status: string } }>(
      `/api/approvals/${id}/review`,
      'POST',
      { decision, decisionNote: decisionNotes[id] || '' }
    );
    if (res) {
      if (decision === 'REJETE') {
        notify('warning', 'Demande rejetée.');
      } else {
        notify('success', 'Opération validée et appliquée.');
      }
    }
  };

  const selectedDepotLabel =
    selectedWarehouseId === 'ALL'
      ? `Consolidé (${snapshot.warehouses.filter((w) => !w.deletedAt && w.active).length} dépôts)`
      : snapshot.warehouses.find((w) => w.id === selectedWarehouseId)?.name || 'Dépôt';

  return (
    <div className="space-y-6">
      {/* Header strip */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            {snapshot.company.companyName} · {selectedDepotLabel}
          </p>
          <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            {isOwner ? 'Supervision Multi-Dépôts & Gouvernance' : 'Pilotage Dépôt & Opérations'}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {hasPerm(PERMISSIONS.SALE_CREATE) ? (
            <button
              type="button"
              onClick={() => setActiveModule('sales')}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-800 whitespace-nowrap shrink-0"
            >
              Ouvrir Caisse POS
              <ArrowRight className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setActiveModule('reports')}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-800 whitespace-nowrap shrink-0"
            >
              <FileSpreadsheet className="h-4 w-4" />
              Rapports & Export Compta
            </button>
          )}
          <button
            type="button"
            onClick={() => setActiveModule('consignments')}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Suivi Casiers & Cautions
          </button>
        </div>
      </div>

      {/* Multi-Depot Comparison (Propriétaire only) */}
      {isOwner && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                Comparatif Multi-Dépôts en temps réel
              </h2>
            </div>
            {selectedWarehouseId !== 'ALL' && (
              <button
                type="button"
                onClick={() => setSelectedWarehouseId('ALL')}
                className="text-xs font-semibold text-emerald-700 hover:underline dark:text-emerald-400"
              >
                Revenir à la vue consolidée
              </button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 dark:border-slate-800">
                  <th className="py-2 pr-3">Dépôt</th>
                  <th className="py-2 pr-3">Gérant</th>
                  <th className="py-2 pr-3 text-right">Stock Plein</th>
                  <th className="py-2 pr-3 text-right">CA Liquide (Jour)</th>
                  <th className="py-2 pr-3 text-right">Caisse Active</th>
                  <th className="py-2 pr-3 text-right">Approbations</th>
                  <th className="py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {snapshot.warehouses
                  .filter((w) => !w.deletedAt)
                  .map((w) => {
                    const whManager = snapshot.users.find(
                      (u) => !u.deletedAt && u.role === 'GERANT' && u.warehouseId === w.id
                    );
                    const whStock = snapshot.stocks
                      .filter((s) => s.warehouseId === w.id)
                      .reduce((sum, s) => sum + s.qtyOnHand, 0);
                    const whCa = snapshot.sales
                      .filter(
                        (s) =>
                          s.warehouseId === w.id &&
                          s.status === 'VALIDEE' &&
                          s.createdAt.slice(0, 10) === todayPrefix
                      )
                      .reduce((sum, s) => sum + s.liquidTotal, 0);
                    const whCash = snapshot.cashSessions.find(
                      (c) => c.warehouseId === w.id && (c.status === 'OUVERTE' || c.status === 'EN_ATTENTE_VALIDATION')
                    );
                    const whPending = snapshot.approvals.filter(
                      (a) => a.warehouseId === w.id && a.status === 'EN_ATTENTE'
                    ).length;
                    const isFocused = selectedWarehouseId === w.id;
                    return (
                      <tr key={w.id} className={isFocused ? 'bg-emerald-50/50 dark:bg-emerald-950/20' : ''}>
                        <td className="py-2.5 pr-3 font-semibold text-slate-900 dark:text-white">
                          {w.name}
                          <span className="ml-2 text-[11px] font-normal text-slate-500">
                            · {w.active ? 'Actif' : 'Inactif'}
                          </span>
                        </td>
                        <td className="py-2.5 pr-3 text-slate-600 dark:text-slate-300">
                          {whManager?.name || 'Non affecté'}
                        </td>
                        <td className="py-2.5 pr-3 text-right font-mono tabular-nums">
                          {formatNumberFR(whStock)} colis
                        </td>
                        <td className="py-2.5 pr-3 text-right font-mono font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                          {formatFCFA(whCa)}
                        </td>
                        <td className="py-2.5 pr-3 text-right font-mono tabular-nums">
                          {whCash ? `${formatFCFA(whCash.expectedCash)} (${whCash.status})` : 'Fermée'}
                        </td>
                        <td className="py-2.5 pr-3 text-right font-mono tabular-nums">
                          <span className={whPending > 0 ? 'font-bold text-amber-700 dark:text-amber-400' : 'text-slate-400'}>
                            {whPending}
                          </span>
                        </td>
                        <td className="py-2.5 text-right">
                          <button
                            type="button"
                            onClick={() => setSelectedWarehouseId(isFocused ? 'ALL' : w.id)}
                            className="font-semibold text-emerald-700 hover:underline dark:text-emerald-400"
                          >
                            {isFocused ? 'Tous' : 'Filtrer'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Pending driver tour handovers alert for Gérant */}
      {pendingDriverReturns.length > 0 && hasPerm(PERMISSIONS.DELIVERY_COMPLETE) && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/40">
          <div className="flex items-center gap-3">
            <Truck className="h-5 w-5 text-amber-700 dark:text-amber-400 shrink-0" />
            <div>
              <p className="text-sm font-bold text-slate-900 dark:text-white">
                {pendingDriverReturns.length} tournée(s) en attente de remise caisse & casiers
              </p>
              <p className="text-xs text-slate-600 dark:text-slate-300">
                {pendingDriverReturns
                  .map((r) => `${r.docNumber} (${r.driverName} · ${formatFCFA(r.tourExpectedCash)})`)
                  .join(' · ')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setActiveModule('deliveries')}
            className="rounded-lg bg-amber-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-amber-800 whitespace-nowrap"
          >
            Réceptionner & Valider
          </button>
        </div>
      )}

      {/* Urgent & Primordial Task Shortcuts */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xs font-bold tracking-wide text-slate-500 uppercase dark:text-slate-400">
            Raccourcis tâches urgentes & primordiales
          </h2>
          <span className="text-[11px] text-slate-400">
            {isOwner ? 'Mode supervision Propriétaire' : 'Accès direct 1-clic aux opérations critiques'}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
          {hasPerm(PERMISSIONS.SALE_CREATE) ? (
            <motion.button
              type="button"
              whileHover={{ scale: 1.03, y: -2 }}
              whileTap={{ scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 420, damping: 26 }}
              onClick={() => navigateWithHint('sales', { salesTab: 'pos', focusQuickScan: true })}
              className="flex flex-col justify-between rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 text-left shadow-xs hover:border-emerald-500 hover:shadow-md dark:border-emerald-900/70 dark:bg-emerald-950/30"
            >
              <div className="flex items-center justify-between">
                <ScanBarcode className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
                <span className="font-mono text-[10px] font-bold text-emerald-700 dark:text-emerald-400">F2</span>
              </div>
              <div className="mt-2">
                <p className="text-xs font-bold text-slate-900 dark:text-white">Vente / Scan Express</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">Saisie rapide POS</p>
              </div>
            </motion.button>
          ) : (
            <motion.button
              type="button"
              whileHover={{ scale: 1.03, y: -2 }}
              whileTap={{ scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 420, damping: 26 }}
              onClick={() => setActiveModule('users')}
              className="flex flex-col justify-between rounded-xl border border-blue-200 bg-blue-50/70 p-3 text-left shadow-xs hover:border-blue-500 hover:shadow-md dark:border-blue-900/70 dark:bg-blue-950/30"
            >
              <div className="flex items-center justify-between">
                <KeyRound className="h-4 w-4 text-blue-700 dark:text-blue-400" />
                <span className="font-mono text-[10px] font-bold text-blue-700 dark:text-blue-400">RBAC</span>
              </div>
              <div className="mt-2">
                <p className="text-xs font-bold text-slate-900 dark:text-white">Délégations & Accès</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">Mandats temporaires</p>
              </div>
            </motion.button>
          )}

          {hasPerm(PERMISSIONS.CASH_OPEN) || hasPerm(PERMISSIONS.CASH_CLOSE) ? (
            <motion.button
              type="button"
              whileHover={{ scale: 1.03, y: -2 }}
              whileTap={{ scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 420, damping: 26 }}
              onClick={() => navigateWithHint('sales', { salesTab: 'cash' })}
              className={`flex flex-col justify-between rounded-xl border p-3 text-left shadow-xs hover:shadow-md ${
                !activeCash
                  ? 'border-amber-300 bg-amber-50/80 hover:border-amber-500 dark:border-amber-900 dark:bg-amber-950/30'
                  : 'border-slate-200 bg-slate-50/60 hover:border-emerald-500 dark:border-slate-800 dark:bg-slate-800/40'
              }`}
            >
              <div className="flex items-center justify-between">
                <Lock className={`h-4 w-4 ${!activeCash ? 'text-amber-700 dark:text-amber-400' : 'text-slate-600 dark:text-slate-300'}`} />
                <span className="font-mono text-[10px] font-bold text-slate-500">
                  {activeCash ? 'OUVERTE' : pendingCashValidation ? 'ATTENTE' : 'FERMÉE'}
                </span>
              </div>
              <div className="mt-2">
                <p className="text-xs font-bold text-slate-900 dark:text-white">
                  {activeCash ? 'Clôturer Caisse Z' : 'Ouvrir Caisse'}
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">Contrôle espèces</p>
              </div>
            </motion.button>
          ) : (
            <motion.button
              type="button"
              whileHover={{ scale: 1.03, y: -2 }}
              whileTap={{ scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 420, damping: 26 }}
              onClick={() => setActiveModule('products')}
              className="flex flex-col justify-between rounded-xl border border-slate-200 bg-slate-50/60 p-3 text-left shadow-xs hover:border-emerald-500 hover:shadow-md dark:border-slate-800 dark:bg-slate-800/40"
            >
              <div className="flex items-center justify-between">
                <Package className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
                <span className="font-mono text-[10px] font-bold text-slate-500">TARIFS</span>
              </div>
              <div className="mt-2">
                <p className="text-xs font-bold text-slate-900 dark:text-white">Tarifs & Cautions</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">Grille prix officielle</p>
              </div>
            </motion.button>
          )}

          <motion.button
            type="button"
            whileHover={{ scale: 1.03, y: -2 }}
            whileTap={{ scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 420, damping: 26 }}
            onClick={() => approvalsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
            className={`flex flex-col justify-between rounded-xl border p-3 text-left shadow-xs hover:shadow-md ${
              pendingApprovals.length > 0
                ? 'border-amber-300 bg-amber-50/80 hover:border-amber-500 dark:border-amber-900 dark:bg-amber-950/30'
                : 'border-slate-200 bg-slate-50/60 hover:border-emerald-500 dark:border-slate-800 dark:bg-slate-800/40'
            }`}
          >
            <div className="flex items-center justify-between">
              <ShieldCheck className={`h-4 w-4 ${pendingApprovals.length > 0 ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400'}`} />
              <span className="font-mono text-xs font-bold tabular-nums text-amber-700 dark:text-amber-400">
                {pendingApprovals.length}
              </span>
            </div>
            <div className="mt-2">
              <p className="text-xs font-bold text-slate-900 dark:text-white">Validations sensibles</p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">Double contrôle</p>
            </div>
          </motion.button>

          <motion.button
            type="button"
            whileHover={{ scale: 1.03, y: -2 }}
            whileTap={{ scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 420, damping: 26 }}
            onClick={() => navigateWithHint('consignments', { consignmentsOnlyOverdue: true })}
            className="flex flex-col justify-between rounded-xl border border-slate-200 bg-slate-50/60 p-3 text-left shadow-xs hover:border-amber-500 hover:shadow-md dark:border-slate-800 dark:bg-slate-800/40"
          >
            <div className="flex items-center justify-between">
              <RotateCcw className="h-4 w-4 text-amber-700 dark:text-amber-400" />
              <span className="font-mono text-xs font-bold tabular-nums text-amber-700 dark:text-amber-400">
                {overdueCrateCustomers.length}
              </span>
            </div>
            <div className="mt-2">
              <p className="text-xs font-bold text-slate-900 dark:text-white">Relancer Casiers</p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">Retards &gt; {snapshot.company.consignmentOverdueDays}j</p>
            </div>
          </motion.button>

          <motion.button
            type="button"
            whileHover={{ scale: 1.03, y: -2 }}
            whileTap={{ scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 420, damping: 26 }}
            onClick={() => setActiveModule('credits')}
            className="flex flex-col justify-between rounded-xl border border-slate-200 bg-slate-50/60 p-3 text-left shadow-xs hover:border-red-500 hover:shadow-md dark:border-slate-800 dark:bg-slate-800/40"
          >
            <div className="flex items-center justify-between">
              <CreditCard className="h-4 w-4 text-red-600" />
              <span className="font-mono text-xs font-bold tabular-nums text-red-600">
                {overdueCredits.length}
              </span>
            </div>
            <div className="mt-2">
              <p className="text-xs font-bold text-slate-900 dark:text-white">Recouvrer Crédits</p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">Échéances dépassées</p>
            </div>
          </motion.button>

          <motion.button
            type="button"
            whileHover={{ scale: 1.03, y: -2 }}
            whileTap={{ scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 420, damping: 26 }}
            onClick={() => setActiveModule('stock')}
            className="flex flex-col justify-between rounded-xl border border-slate-200 bg-slate-50/60 p-3 text-left shadow-xs hover:border-amber-500 hover:shadow-md dark:border-slate-800 dark:bg-slate-800/40"
          >
            <div className="flex items-center justify-between">
              <Package className="h-4 w-4 text-amber-600" />
              <span className="font-mono text-xs font-bold tabular-nums text-amber-600">
                {lowStockItems.length}
              </span>
            </div>
            <div className="mt-2">
              <p className="text-xs font-bold text-slate-900 dark:text-white">Alerte Stock Bas</p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">Réapprovisionner</p>
            </div>
          </motion.button>
        </div>
      </div>

      {/* 4-column KPI strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, delay: 0.02 }}
          whileHover={{ scale: 1.02, y: -2 }}
          className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
        >
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>Chiffre d’affaires (Jour)</span>
            <span className="font-mono">{todaySales.length} ventes</span>
          </div>
          <p className="mt-2 font-mono text-2xl font-bold text-slate-900 tabular-nums dark:text-white">
            {formatFCFA(caJour)}
          </p>
          <p className="mt-1.5 text-xs text-emerald-700 dark:text-emerald-400 font-medium tabular-nums">
            Marge brute estimée : {formatFCFA(margeJour)}
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, delay: 0.06 }}
          whileHover={{ scale: 1.02, y: -2 }}
          className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
        >
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>Cautions clients en circulation</span>
            <span className="font-mono">{formatNumberFR(totalClientCratesOut)} casiers</span>
          </div>
          <p className="mt-2 font-mono text-2xl font-bold text-slate-900 tabular-nums dark:text-white">
            {formatFCFA(totalClientDepositDue)}
          </p>
          <p className="mt-1.5 text-xs font-medium text-amber-700 dark:text-amber-400 tabular-nums">
            {overdueCrateCustomers.length} client(s) en retard &gt; {snapshot.company.consignmentOverdueDays}j
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, delay: 0.1 }}
          whileHover={{ scale: 1.02, y: -2 }}
          className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
        >
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>Créances en retard</span>
            <span className="font-mono">{overdueCredits.length} dossiers</span>
          </div>
          <p className="mt-2 font-mono text-2xl font-bold text-red-700 tabular-nums dark:text-red-400">
            {formatFCFA(totalOverdueAmount)}
          </p>
          <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
            Encours global : {formatFCFA(activeCustomers.reduce((s, c) => s + c.creditBalance, 0))}
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, delay: 0.14 }}
          whileHover={{ scale: 1.02, y: -2 }}
          className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
        >
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>Caisse & Écart</span>
            <span className="font-mono">{activeCash ? activeCash.docNumber : pendingCashValidation ? pendingCashValidation.docNumber : 'Fermée'}</span>
          </div>
          <p className="mt-2 font-mono text-2xl font-bold text-slate-900 tabular-nums dark:text-white">
            {formatFCFA(
              activeCash
                ? activeCash.expectedCash
                : pendingCashValidation
                ? pendingCashValidation.countedCash || pendingCashValidation.expectedCash
                : lastClosedCash?.countedCash || 0
            )}
          </p>
          <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-400 tabular-nums">
            {activeCash
              ? `Ouverte par ${activeCash.cashierName}`
              : pendingCashValidation
              ? 'Clôture en attente de validation Propriétaire'
              : `Dernier écart Z : ${formatFCFA(lastClosedCash?.variance || 0)}`}
          </p>
        </motion.div>
      </div>

      {/* 3-Column Dynamic Operational Summary Widgets */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Widget 1: Objectifs de vente du jour */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, delay: 0.16 }}
          className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
        >
          <div>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Target className="h-4 w-4 text-emerald-700 dark:text-emerald-400 shrink-0" />
                <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                  Objectif de vente du jour
                </h2>
              </div>
              {hasPerm(PERMISSIONS.SETTINGS_UPDATE) && (
                <button
                  type="button"
                  onClick={() => {
                    setTargetInput(String(perDepotTarget));
                    setEditingTarget((v) => !v);
                  }}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:underline dark:text-emerald-400"
                >
                  <Pencil className="h-3 w-3" />
                  <span>{editingTarget ? 'Fermer' : 'Ajuster'}</span>
                </button>
              )}
            </div>

            {editingTarget && (
              <form onSubmit={handleSaveDailyTarget} className="mt-3 flex items-center gap-2">
                <input
                  type="number"
                  min={50000}
                  step={50000}
                  value={targetInput}
                  onChange={(e) => setTargetInput(e.target.value)}
                  className="min-h-[36px] flex-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 font-mono text-xs tabular-nums dark:border-slate-700 dark:bg-slate-800"
                />
                <button
                  type="submit"
                  className="min-h-[36px] rounded-lg bg-emerald-700 px-3 text-xs font-semibold text-white hover:bg-emerald-800 whitespace-nowrap"
                >
                  Valider
                </button>
              </form>
            )}

            <div className="mt-4 flex items-baseline justify-between gap-2">
              <p className="font-mono text-2xl font-bold text-slate-900 tabular-nums dark:text-white">
                {targetPct}%
              </p>
              <p className="font-mono text-xs text-slate-500 tabular-nums dark:text-slate-400">
                {formatFCFA(caJour)} / {formatFCFA(dailyTargetAmount)}
              </p>
            </div>

            <div className="mt-2.5 h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <motion.div
                initial={{ scaleX: 0 }}
                animate={{ scaleX: Math.min(1, targetRatio) }}
                transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
                style={{ originX: 0 }}
                className={`h-full w-full rounded-full ${
                  targetRatio >= 1
                    ? 'bg-emerald-600'
                    : targetRatio >= 0.6
                    ? 'bg-emerald-500'
                    : 'bg-amber-500'
                }`}
              />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs text-slate-500 tabular-nums dark:border-slate-800 dark:text-slate-400">
            <span>
              {caJour >= dailyTargetAmount
                ? `Surplus : +${formatFCFA(caJour - dailyTargetAmount)}`
                : `Reste : ${formatFCFA(dailyTargetAmount - caJour)}`}
            </span>
            <span>
              Comptoir {formatFCFA(counterSalesToday)} · Tournées {formatFCFA(deliverySalesToday)}
            </span>
          </div>
        </motion.div>

        {/* Widget 2: Jauge de taux de remplissage des casiers */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, delay: 0.2 }}
          className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
        >
          <div>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <RotateCcw className="h-4 w-4 text-emerald-700 dark:text-emerald-400 shrink-0" />
                <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                  Jauge de remplissage casiers
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setActiveModule('consignments')}
                className="text-xs font-semibold text-emerald-700 hover:underline dark:text-emerald-400 whitespace-nowrap"
              >
                Consignes
              </button>
            </div>

            <div className="mt-3 flex items-center gap-4">
              <div className="relative h-20 w-20 shrink-0">
                <svg viewBox="0 0 80 80" className="h-20 w-20 -rotate-90">
                  <circle
                    cx="40"
                    cy="40"
                    r="32"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="8"
                    className="text-amber-100 dark:text-slate-800"
                  />
                  <motion.circle
                    cx="40"
                    cy="40"
                    r="32"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="8"
                    strokeLinecap="round"
                    strokeDasharray={2 * Math.PI * 32}
                    initial={{ strokeDashoffset: 2 * Math.PI * 32 }}
                    animate={{
                      strokeDashoffset:
                        2 * Math.PI * 32 * (1 - Math.max(0, Math.min(1, crateFillRatePct / 100))),
                    }}
                    transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
                    className={
                      crateFillRatePct >= 65
                        ? 'text-emerald-600'
                        : crateFillRatePct >= 35
                        ? 'text-amber-500'
                        : 'text-red-600'
                    }
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="font-mono text-base font-bold text-slate-900 tabular-nums dark:text-white">
                    {crateFillRatePct}%
                  </span>
                </div>
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  Disponibilité emballages pleins
                </p>
                <p className="font-mono text-sm font-bold text-slate-900 tabular-nums dark:text-white">
                  {formatNumberFR(fullCratesInStock)} / {formatNumberFR(totalDepotCrates)} casiers
                </p>
                <p className="text-[11px] text-slate-500 tabular-nums dark:text-slate-400">
                  {crateFillRatePct >= 65
                    ? 'Rotation saine prête au comptoir'
                    : 'Rotation vides → brasserie requise'}
                </p>
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2 border-t border-slate-100 pt-3 text-xs tabular-nums dark:border-slate-800">
            <div>
              <p className="text-slate-400">Pleins</p>
              <p className="font-mono font-bold text-emerald-700 dark:text-emerald-400">
                {formatNumberFR(fullCratesInStock)}
              </p>
            </div>
            <div>
              <p className="text-slate-400">Vides dépôt</p>
              <p className="font-mono font-bold text-amber-700 dark:text-amber-400">
                {formatNumberFR(emptyCratesInDepot)}
              </p>
            </div>
            <div>
              <p className="text-slate-400">Chez clients</p>
              <p className="font-mono font-bold text-slate-800 dark:text-slate-200">
                {formatNumberFR(totalClientCratesOut)}
              </p>
            </div>
          </div>
        </motion.div>

        {/* Widget 3: Liste prioritaire d'alertes pour produits en stock critique */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, delay: 0.24 }}
          className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
        >
          <div>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <AlertTriangle
                  className={`h-4 w-4 shrink-0 ${
                    nearStockoutItems.length > 0 ? 'text-amber-600' : 'text-emerald-600'
                  }`}
                />
                <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                  Alertes prioritaires · Stock critique
                </h2>
              </div>
              <span className="font-mono text-xs font-semibold text-slate-500 tabular-nums">
                {nearStockoutItems.length} réf.
              </span>
            </div>

            {nearStockoutItems.length === 0 ? (
              <p className="mt-5 text-xs text-slate-500 dark:text-slate-400">
                Aucun produit sous 1,5× du seuil d’alerte. Niveau de stock nominal sur ce périmètre.
              </p>
            ) : (
              <div className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
                {nearStockoutItems.slice(0, 4).map(({ stk, pkg, whName, severity }, idx) => (
                  <div key={stk.id} className="flex items-center justify-between gap-2 py-1.5">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="font-mono text-[10px] font-bold text-slate-400 tabular-nums">
                        P{idx + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-slate-900 dark:text-white">
                          {pkg.label}
                        </p>
                        <p className="font-mono text-[11px] text-slate-500 tabular-nums">
                          {stk.qtyOnHand} / seuil {pkg.alertThreshold}
                          {selectedWarehouseId === 'ALL' ? ` · ${whName.replace('Dépôt ', '')}` : ''}
                        </p>
                      </div>
                    </div>
                    <span
                      className={`text-[11px] font-bold whitespace-nowrap shrink-0 ${
                        severity === 'OUT'
                          ? 'text-red-700 dark:text-red-400'
                          : severity === 'CRITICAL'
                          ? 'text-amber-700 dark:text-amber-400'
                          : 'text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      {severity === 'OUT' ? 'Rupture' : severity === 'CRITICAL' ? 'Critique' : 'Proche'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setActiveModule('stock')}
              className="text-xs font-semibold text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
            >
              Voir tout le stock
            </button>
            <button
              type="button"
              onClick={() => setActiveModule(hasPerm(PERMISSIONS.PURCHASE_RECEIVE) ? 'purchases' : 'stock')}
              className="inline-flex items-center gap-1 rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-800 whitespace-nowrap shrink-0"
            >
              {hasPerm(PERMISSIONS.PURCHASE_RECEIVE) ? 'Commander' : 'Contrôler'}
            </button>
          </div>
        </motion.div>
      </div>

      {/* Main grid: Revenue chart + Alerts */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-2 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                Activité commerciale sur 7 jours (Liquide hors cautions)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Ventes validées au comptoir et en tournée · Devise XOF
              </p>
            </div>
            <button
              type="button"
              onClick={() => setActiveModule('reports')}
              className="text-xs font-semibold text-emerald-700 hover:underline dark:text-emerald-400 whitespace-nowrap"
            >
              Voir rapports Z
            </button>
          </div>

          <div className="mt-6 flex h-48 items-end gap-3">
            {last7Days.map((day, idx) => {
              const pct = Math.max(4, Math.round((day.total / maxDayRev) * 100));
              return (
                <div key={day.key} className="flex flex-1 flex-col items-center gap-2">
                  <span className="font-mono text-[11px] font-medium text-slate-600 tabular-nums dark:text-slate-400">
                    {day.total > 0 ? `${Math.round(day.total / 1000)}k` : '0'}
                  </span>
                  <div className="flex h-32 w-full items-end rounded-md bg-slate-100 p-1 shadow-inner dark:bg-slate-800">
                    <motion.div
                      initial={{ scaleY: 0 }}
                      animate={{ scaleY: 1 }}
                      whileHover={{ scaleY: 1.05, filter: 'brightness(1.08)' }}
                      transition={{ duration: 0.45, delay: idx * 0.05, ease: [0.22, 1, 0.36, 1] }}
                      style={{ height: `${pct}%`, originY: 1 }}
                      className="w-full rounded bg-gradient-to-t from-emerald-700 to-emerald-500 shadow-sm"
                    />
                  </div>
                  <span className="text-[11px] font-medium text-slate-500 capitalize dark:text-slate-400">
                    {day.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Alertes contrôle interne
            </h2>
            <span className="font-mono text-xs text-slate-500 tabular-nums">
              {lowStockItems.length + overdueCrateCustomers.length + overdueCredits.length} actives
            </span>
          </div>

          <div className="mt-4 divide-y divide-slate-100 dark:divide-slate-800">
            {lowStockItems.slice(0, 3).map(({ stk, pkg }) => (
              <button
                key={stk.id}
                type="button"
                onClick={() => setActiveModule('stock')}
                className="flex w-full items-start justify-between py-3 text-left hover:bg-slate-50/70 dark:hover:bg-slate-800/40"
              >
                <div className="flex items-start gap-2.5">
                  <Package className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  <div>
                    <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                      Stock bas · {pkg.label}
                    </p>
                    <p className="text-xs text-slate-500 tabular-nums">
                      Reste {stk.qtyOnHand} / Seuil {pkg.alertThreshold}
                    </p>
                  </div>
                </div>
                <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">Alerte</span>
              </button>
            ))}

            {overdueCrateCustomers.slice(0, 2).map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setActiveModule('consignments')}
                className="flex w-full items-start justify-between py-3 text-left hover:bg-slate-50/70 dark:hover:bg-slate-800/40"
              >
                <div className="flex items-start gap-2.5">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                  <div>
                    <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                      Casiers non revenus · {c.name}
                    </p>
                    <p className="text-xs text-slate-500 tabular-nums">
                      {c.consignmentCrates} casiers · {daysSince(c.lastCrateOutDate)} jours
                    </p>
                  </div>
                </div>
                <span className="text-xs font-semibold text-red-700 dark:text-red-400">Relancer</span>
              </button>
            ))}

            {overdueCredits.slice(0, 2).map((crd) => {
              const cust = snapshot.customers.find((x) => x.id === crd.customerId);
              return (
                <button
                  key={crd.id}
                  type="button"
                  onClick={() => setActiveModule('credits')}
                  className="flex w-full items-start justify-between py-3 text-left hover:bg-slate-50/70 dark:hover:bg-slate-800/40"
                >
                  <div className="flex items-start gap-2.5">
                    <Wallet className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                    <div>
                      <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                        Échéance dépassée · {cust?.name}
                      </p>
                      <p className="font-mono text-xs text-slate-500 tabular-nums">
                        {crd.docNumber} · {formatFCFA(crd.remainingAmount)}
                      </p>
                    </div>
                  </div>
                  <span className="text-xs font-semibold text-red-700 dark:text-red-400">Recouvrer</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Pending Approvals (Separation of duties) */}
      {pendingApprovals.length > 0 && (
        <div ref={approvalsRef} className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-emerald-700 dark:text-emerald-400" />
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                Boîte de validation à distance ({pendingApprovals.length})
              </h2>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Séparation des tâches : le demandeur ne peut jamais approuver sa propre opération.
            </p>
          </div>
          <div className="mt-4 divide-y divide-slate-100 dark:divide-slate-800">
            {pendingApprovals.map((apr) => {
              const isSelf = apr.requestedBy === currentUser.id;
              const allowed = canApproveRequest(apr);
              const whName = snapshot.warehouses.find((w) => w.id === apr.warehouseId)?.name;
              return (
                <div
                  key={apr.id}
                  className="flex flex-col gap-3 py-3 lg:flex-row lg:items-center lg:justify-between"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">
                      {apr.docNumber} · {apr.description}
                    </p>
                    <p className="text-xs text-slate-500 tabular-nums">
                      Demandé par {apr.requestedByName}
                      {whName ? ` · ${whName}` : ''} · {formatDateTimeFR(apr.createdAt)} · Montant / Impact :{' '}
                      {formatNumberFR(apr.amount)} · Cible : {apr.targetRole}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {allowed ? (
                      <>
                        <input
                          type="text"
                          value={decisionNotes[apr.id] || ''}
                          onChange={(e) =>
                            setDecisionNotes((prev) => ({ ...prev, [apr.id]: e.target.value }))
                          }
                          placeholder="Note de décision (optionnelle)"
                          className="min-h-[38px] rounded-lg border border-slate-200 px-2.5 text-xs dark:border-slate-700 dark:bg-slate-800"
                        />
                        <button
                          type="button"
                          onClick={() => handleApproval(apr.id, 'APPROUVE')}
                          className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 whitespace-nowrap"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Approuver
                        </button>
                        <button
                          type="button"
                          onClick={() => handleApproval(apr.id, 'REJETE')}
                          className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 whitespace-nowrap"
                        >
                          <XCircle className="h-3.5 w-3.5" />
                          Rejeter
                        </button>
                      </>
                    ) : (
                      <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
                        {isSelf ? 'Auto-validation interdite' : `En attente ${apr.targetRole}`}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Top 5 Products & Top 5 Customers */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">
            Top 5 Conditionnements (Chiffre d’affaires)
          </h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-medium text-slate-500 dark:border-slate-800">
                  <th className="py-2">Conditionnement</th>
                  <th className="py-2 text-right">Volume</th>
                  <th className="py-2 text-right">CA Liquide</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {topProducts.map((p) => (
                  <tr key={p.label} className="h-10">
                    <td className="py-2 font-medium text-slate-900 dark:text-slate-100">{p.label}</td>
                    <td className="py-2 text-right font-mono text-slate-600 tabular-nums dark:text-slate-400">
                      {formatNumberFR(p.qty)} colis
                    </td>
                    <td className="py-2 text-right font-mono font-semibold text-slate-900 tabular-nums dark:text-white">
                      {formatFCFA(p.revenue)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">
            Top 5 Clients & Casiers détenus
          </h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-medium text-slate-500 dark:border-slate-800">
                  <th className="py-2">Client / Zone</th>
                  <th className="py-2 text-right">Casiers</th>
                  <th className="py-2 text-right">CA Cumulé</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {topCustomers.map((c) => (
                  <tr key={c.name} className="h-10">
                    <td className="py-2">
                      <span className="font-medium text-slate-900 dark:text-slate-100">{c.name}</span>
                      <span className="ml-2 text-xs text-slate-500">· {c.zone}</span>
                    </td>
                    <td className="py-2 text-right font-mono text-slate-600 tabular-nums dark:text-slate-400">
                      {c.crates}
                    </td>
                    <td className="py-2 text-right font-mono font-semibold text-slate-900 tabular-nums dark:text-white">
                      {formatFCFA(c.revenue)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Ground Operations Visual Cards */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="relative h-44 w-full bg-slate-200 dark:bg-slate-800">
            <img
              src="/src/assets/images/casiers_bouteilles_depot_1794729186392.jpg"
              alt="Parc de casiers de boissons au dépôt principal"
              referrerPolicy="no-referrer"
              className="h-full w-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/30 to-transparent" />
            <div className="absolute bottom-3 left-4 right-4 text-white">
              <p className="text-xs font-medium text-slate-200">Entrepôt & Parc Emballages</p>
              <p className="text-base font-semibold">
                {formatNumberFR(scopedStocks.reduce((s, x) => s + x.qtyOnHand, 0))} colis pleins ·{' '}
                {formatNumberFR(scopedStocks.reduce((s, x) => s + x.emptyCratesOnHand, 0))} casiers vides au parc
              </p>
            </div>
          </div>
          <div className="flex items-center justify-between p-4">
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Suivi FIFO / FEFO & inventaires tournants
            </span>
            <button
              type="button"
              onClick={() => setActiveModule('stock')}
              className="text-xs font-semibold text-emerald-700 hover:underline dark:text-emerald-400"
            >
              Gérer le stock
            </button>
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="relative h-44 w-full bg-slate-200 dark:bg-slate-800">
            <img
              src="/src/assets/images/livraison_tricycle_boissons_1794729188155.jpg"
              alt="Véhicule de livraison chargé de casiers de boissons"
              referrerPolicy="no-referrer"
              className="h-full w-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/30 to-transparent" />
            <div className="absolute bottom-3 left-4 right-4 text-white">
              <p className="text-xs font-medium text-slate-200">Logistique & Tournées Terrain</p>
              <p className="text-base font-semibold">
                {scopedRoutes.filter((r) => r.status === 'EN_TOURNEE').length} tournée(s) active(s) ·
                Signature BL mobile
              </p>
            </div>
          </div>
          <div className="flex items-center justify-between p-4">
            <span className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <Truck className="h-3.5 w-3.5" />
              Tricycles, pick-ups & camionnettes
            </span>
            <button
              type="button"
              onClick={() => setActiveModule('deliveries')}
              className="text-xs font-semibold text-emerald-700 hover:underline dark:text-emerald-400"
            >
              Ouvrir les tournées
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
