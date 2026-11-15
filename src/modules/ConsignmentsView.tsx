import React, { useEffect, useMemo, useState } from 'react';
import { Check, Copy, Download, RotateCcw, Search, X } from 'lucide-react';
import { TablePagination, usePagination } from '../components/TablePagination';
import { useErp } from '../context/ErpContext';
import {
  daysSince,
  exportToCsv,
  formatDateTimeFR,
  formatFCFA,
  formatNumberFR,
} from '../lib/format';
import { PERMISSIONS, type ConsignmentMovement } from '../types/erp';

export const ConsignmentsView: React.FC = () => {
  const {
    snapshot,
    mutateApi,
    hasPerm,
    notify,
    navHint,
    clearNavHint,
    activeWarehouseId,
    selectedWarehouseId,
  } = useErp();
  const [search, setSearch] = useState('');
  const [onlyOverdue, setOnlyOverdue] = useState(false);
  const [zoneFilter, setZoneFilter] = useState('ALL');
  const [onlyHoldingCrates, setOnlyHoldingCrates] = useState(false);

  // Ledger filters
  const [ledgerSearch, setLedgerSearch] = useState('');
  const [movementTypeFilter, setMovementTypeFilter] = useState<'ALL' | ConsignmentMovement['movementType']>('ALL');

  useEffect(() => {
    if (navHint?.consignmentsOnlyOverdue) {
      setOnlyOverdue(true);
      clearNavHint();
    }
  }, [navHint, clearNavHint]);

  // Return form state
  const [customerId, setCustomerId] = useState('cust-tantiebea');
  const [packagingId, setPackagingId] = useState('pkg-bock-33');
  const [cratesIn, setCratesIn] = useState(5);
  const [bottlesMissing, setBottlesMissing] = useState(0);
  const [settlementMode, setSettlementMode] = useState<'REMBOURSEMENT_CAISSE' | 'AVOIR_CLIENT'>('AVOIR_CLIENT');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Dual-approval loss/adjustment state (Rule #3)
  const [showAdjustForm, setShowAdjustForm] = useState(false);
  const [adjType, setAdjType] = useState<'PERTE_CONSIGNE' | 'AJUSTEMENT_CONSIGNE'>('PERTE_CONSIGNE');
  const [adjCrates, setAdjCrates] = useState(1);
  const [adjReason, setAdjReason] = useState('');

  const activeCustomers = useMemo(
    () => (snapshot ? snapshot.customers.filter((c) => !c.deletedAt && c.id !== 'cust-comptoir') : []),
    [snapshot]
  );
  const availableZones = useMemo(
    () => Array.from(new Set(activeCustomers.map((c) => c.zone))).sort(),
    [activeCustomers]
  );
  const overdueLimit = snapshot?.company.consignmentOverdueDays ?? 14;

  const filteredCustomers = useMemo(() => {
    return activeCustomers.filter((c) => {
      if (zoneFilter !== 'ALL' && c.zone !== zoneFilter) return false;
      if (onlyHoldingCrates && c.consignmentCrates <= 0) return false;
      if (onlyOverdue && (!c.lastCrateOutDate || daysSince(c.lastCrateOutDate) <= overdueLimit || c.consignmentCrates === 0)) {
        return false;
      }
      if (search.trim()) {
        const q = search.toLowerCase();
        return c.name.toLowerCase().includes(q) || c.zone.toLowerCase().includes(q) || c.code.toLowerCase().includes(q);
      }
      return true;
    });
  }, [activeCustomers, zoneFilter, onlyHoldingCrates, onlyOverdue, overdueLimit, search]);

  const filteredConsignments = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.consignments.filter((m) => {
      if (selectedWarehouseId !== 'ALL' && m.warehouseId && m.warehouseId !== selectedWarehouseId) {
        return false;
      }
      if (movementTypeFilter !== 'ALL' && m.movementType !== movementTypeFilter) return false;
      if (ledgerSearch.trim()) {
        const q = ledgerSearch.toLowerCase();
        const cust = m.customerId ? snapshot.customers.find((c) => c.id === m.customerId) : null;
        const sup = m.supplierId ? snapshot.suppliers.find((s) => s.id === m.supplierId) : null;
        return (
          m.docNumber.toLowerCase().includes(q) ||
          m.referenceDoc.toLowerCase().includes(q) ||
          (cust?.name.toLowerCase().includes(q) ?? false) ||
          (sup?.name.toLowerCase().includes(q) ?? false)
        );
      }
      return true;
    });
  }, [snapshot, selectedWarehouseId, movementTypeFilter, ledgerSearch]);

  const customersPagination = usePagination(filteredCustomers, 6);
  const ledgerPagination = usePagination(filteredConsignments, 8);

  if (!snapshot) return null;

  const returnablePkgs = snapshot.packagings.filter((p) => p.isReturnable && !p.deletedAt);
  const totalDepositClients = activeCustomers.reduce((s, c) => s + c.consignmentDepositDue, 0);
  const totalCratesClients = activeCustomers.reduce((s, c) => s + c.consignmentCrates, 0);
  const clientsHoldingCrates = activeCustomers.filter((c) => c.consignmentCrates > 0);

  // Consistency check
  const totalCratesFromSuppliers = snapshot.suppliers.reduce((s, sup) => s + sup.cratesHeldFromSupplier, 0);
  const totalDepositAtSuppliers = snapshot.suppliers.reduce((s, sup) => s + sup.depositPaidToSupplier, 0);
  const scopedStocks = snapshot.stocks.filter(
    (st) => selectedWarehouseId === 'ALL' || st.warehouseId === selectedWarehouseId
  );
  const emptyCratesInDepot = scopedStocks.reduce((s, st) => s + st.emptyCratesOnHand, 0);
  const fullCratesInDepot = scopedStocks.reduce((s, st) => {
    const pkg = snapshot.packagings.find((p) => p.id === st.packagingId);
    return s + (pkg?.isReturnable ? st.qtyOnHand : 0);
  }, 0);
  const physicalAccounted = emptyCratesInDepot + fullCratesInDepot + totalCratesClients;

  const selectedPkg = returnablePkgs.find((p) => p.id === packagingId) || returnablePkgs[0];
  const grossRefund = selectedPkg ? cratesIn * selectedPkg.depositPerCrate : 0;
  const penalty = selectedPkg ? bottlesMissing * selectedPkg.depositPerBottle : 0;
  const netRefund = Math.max(0, grossRefund - penalty);

  const handleReturnSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPkg) return;
    const res = await mutateApi<{ pendingApproval?: boolean }>(
      '/api/consignments/return',
      'POST',
      {
        customerId,
        packagingId: selectedPkg.id,
        cratesIn,
        bottlesMissing,
        settlementMode,
        warehouseId: activeWarehouseId,
      },
      {
        actionType: 'CONSIGNMENT_RETURN',
        summary: `Retour ${cratesIn} casiers (${selectedPkg.label})`,
        optimisticUpdate: (prev) => {
          const next = structuredClone(prev);
          const cust = next.customers.find((c) => c.id === customerId);
          if (cust) {
            cust.consignmentCrates = Math.max(0, cust.consignmentCrates - cratesIn);
            cust.consignmentDepositDue = Math.max(0, cust.consignmentDepositDue - grossRefund);
          }
          const stk = next.stocks.find(
            (s) => s.packagingId === selectedPkg.id && s.warehouseId === activeWarehouseId
          );
          if (stk) stk.emptyCratesOnHand += cratesIn;
          return next;
        },
      }
    );
    if (res) {
      if (res.pendingApproval) {
        notify(
          'warning',
          `Remboursement > ${formatFCFA(snapshot.company.highDepositRefundThreshold)} soumis pour validation Propriétaire.`
        );
      } else {
        notify('success', `Retour de ${cratesIn} casier(s) enregistré (${formatFCFA(netRefund)}).`);
      }
      setBottlesMissing(0);
    }
  };

  const handleAdjustLossSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPkg || !adjReason.trim()) {
      notify('warning', 'Précisez le motif de perte ou d’ajustement.');
      return;
    }
    const res = await mutateApi('/api/consignments/adjust-loss', 'POST', {
      customerId,
      packagingId: selectedPkg.id,
      type: adjType,
      cratesQty: adjCrates,
      reason: adjReason.trim(),
    });
    if (res) {
      notify('warning', 'Demande enregistrée et soumise à l’approbation du Propriétaire.');
      setAdjReason('');
      setShowAdjustForm(false);
    }
  };

  const copyReminder = (custName: string, crates: number, deposit: number, days: number, id: string) => {
    const msg = `Bonjour ${custName}, rappel amical de ${snapshot.company.companyName} : vous détenez actuellement ${crates} casiers consignés depuis ${days} jours (caution : ${formatFCFA(deposit)}). Merci de prévoir leur retour lors de la prochaine tournée.`;
    navigator.clipboard?.writeText(msg);
    setCopiedId(id);
    notify('success', 'Message de relance WhatsApp/SMS copié.');
    setTimeout(() => setCopiedId(null), 2500);
  };

  const exportConsignments = () => {
    exportToCsv(
      `consignes-casiers-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Code', 'Client', 'Zone', 'Casiers détenus', 'Bouteilles', 'Caution due (FCFA)', 'Jours depuis sortie'],
      filteredCustomers.map((c) => [
        c.code,
        c.name,
        c.zone,
        c.consignmentCrates,
        c.consignmentBottles,
        c.consignmentDepositDue,
        c.lastCrateOutDate ? daysSince(c.lastCrateOutDate) : 0,
      ])
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            Consignes Casiers & Bouteilles
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Mon stock de cautions clients vaut{' '}
            <strong className="font-mono text-slate-900 tabular-nums dark:text-white">
              {formatFCFA(totalDepositClients)}
            </strong>{' '}
            ·{' '}
            <strong className="font-mono text-amber-700 tabular-nums dark:text-amber-400">
              {formatNumberFR(totalCratesClients)} casiers
            </strong>{' '}
            non revenus chez{' '}
            <strong className="font-mono tabular-nums">{clientsHoldingCrates.length} clients</strong>.
          </p>
        </div>

        <button
          type="button"
          onClick={exportConsignments}
          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
        >
          <Download className="h-3.5 w-3.5" />
          Exporter État Casiers
        </button>
      </div>

      {/* Consistency KPI strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs font-medium text-slate-500">Parc Dépôt (Pleins + Vides)</p>
          <p className="mt-1.5 font-mono text-xl font-bold text-slate-900 tabular-nums dark:text-white">
            {formatNumberFR(fullCratesInDepot + emptyCratesInDepot)} casiers
          </p>
          <p className="mt-1 text-xs text-slate-500 tabular-nums">
            {formatNumberFR(fullCratesInDepot)} pleins · {formatNumberFR(emptyCratesInDepot)} vides
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs font-medium text-slate-500">Chez Clients (Cautions dues)</p>
          <p className="mt-1.5 font-mono text-xl font-bold text-amber-700 tabular-nums dark:text-amber-400">
            {formatNumberFR(totalCratesClients)} casiers
          </p>
          <p className="mt-1 font-mono text-xs text-slate-500 tabular-nums">{formatFCFA(totalDepositClients)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs font-medium text-slate-500">Engagés Brasseries (Solibra / Brassivoire)</p>
          <p className="mt-1.5 font-mono text-xl font-bold text-slate-900 tabular-nums dark:text-white">
            {formatNumberFR(totalCratesFromSuppliers)} casiers
          </p>
          <p className="mt-1 font-mono text-xs text-slate-500 tabular-nums">
            Cautions versées : {formatFCFA(totalDepositAtSuppliers)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs font-medium text-slate-500">Contrôle cohérence parc global</p>
          <p className="mt-1.5 font-mono text-xl font-bold text-emerald-700 tabular-nums dark:text-emerald-400">
            {formatNumberFR(physicalAccounted)} casiers tracés
          </p>
          <p className="mt-1 text-xs text-slate-500 tabular-nums">
            Écart parc vs brasserie : {formatNumberFR(physicalAccounted - totalCratesFromSuppliers)}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Return Crates Form */}
        <form
          onSubmit={handleReturnSubmit}
          className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 lg:col-span-4 dark:border-slate-800 dark:bg-slate-900"
        >
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
            <RotateCcw className="h-4 w-4 text-emerald-700" />
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              Enregistrer un retour d’emballages
            </h2>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400">Client</label>
            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm dark:border-slate-700 dark:bg-slate-800"
            >
              {activeCustomers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.consignmentCrates} casiers)
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400">
              Type de casier consigné
            </label>
            <select
              value={packagingId}
              onChange={(e) => setPackagingId(e.target.value)}
              className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm dark:border-slate-700 dark:bg-slate-800"
            >
              {returnablePkgs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label} (Caution {formatFCFA(p.depositPerCrate)})
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400">
                Casiers vides rendus
              </label>
              <input
                type="number"
                min={1}
                value={cratesIn}
                onChange={(e) => setCratesIn(Math.max(1, Number(e.target.value)))}
                className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-200 px-3 font-mono text-sm font-bold tabular-nums dark:border-slate-700 dark:bg-slate-800"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400">
                Bouteilles manquantes
              </label>
              <input
                type="number"
                min={0}
                value={bottlesMissing}
                onChange={(e) => setBottlesMissing(Math.max(0, Number(e.target.value)))}
                className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-200 px-3 font-mono text-sm font-bold tabular-nums dark:border-slate-700 dark:bg-slate-800"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400">
              Mode de règlement de la caution
            </label>
            <div className="mt-1 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setSettlementMode('AVOIR_CLIENT')}
                className={`min-h-[42px] rounded-lg border px-3 text-xs font-semibold ${
                  settlementMode === 'AVOIR_CLIENT'
                    ? 'border-emerald-700 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-300'
                    : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300'
                }`}
              >
                Avoir / Déduction crédit
              </button>
              <button
                type="button"
                onClick={() => setSettlementMode('REMBOURSEMENT_CAISSE')}
                className={`min-h-[42px] rounded-lg border px-3 text-xs font-semibold ${
                  settlementMode === 'REMBOURSEMENT_CAISSE'
                    ? 'border-emerald-700 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-300'
                    : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300'
                }`}
              >
                Remboursement caisse
              </button>
            </div>
          </div>

          <div className="rounded-lg bg-slate-50 p-3 text-xs space-y-1 dark:bg-slate-800">
            <div className="flex justify-between">
              <span>Caution brute casiers</span>
              <span className="font-mono tabular-nums">{formatFCFA(grossRefund)}</span>
            </div>
            {penalty > 0 && (
              <div className="flex justify-between text-red-600">
                <span>Pénalité bouteilles manquantes</span>
                <span className="font-mono tabular-nums">-{formatFCFA(penalty)}</span>
              </div>
            )}
            <div className="flex justify-between pt-1 text-sm font-bold text-slate-900 dark:text-white">
              <span>Net déconsigné</span>
              <span className="font-mono tabular-nums">{formatFCFA(netRefund)}</span>
            </div>
          </div>

          <button
            type="submit"
            disabled={!hasPerm(PERMISSIONS.CONSIGNMENT_RETURN_IN)}
            className="min-h-[48px] w-full rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
          >
            {hasPerm(PERMISSIONS.CONSIGNMENT_RETURN_IN)
              ? 'Valider le retour de casiers'
              : 'Exécution réservée au Gérant de dépôt'}
          </button>

          <div className="border-t border-slate-100 pt-3 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setShowAdjustForm((v) => !v)}
              className="text-xs font-semibold text-amber-700 hover:underline dark:text-amber-400"
            >
              {showAdjustForm ? 'Masquer déclaration perte / ajustement' : 'Déclarer perte / ajustement consigne (Approbation Propriétaire)'}
            </button>

            {showAdjustForm && (
              <div className="mt-3 space-y-2.5 rounded-lg border border-amber-200 bg-amber-50/70 p-3 text-xs dark:border-amber-900 dark:bg-amber-950/30">
                <p className="font-semibold text-amber-900 dark:text-amber-200">
                  Validation Propriétaire requise avant écriture de perte ou ajustement
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={adjType}
                    onChange={(e) => setAdjType(e.target.value as 'PERTE_CONSIGNE' | 'AJUSTEMENT_CONSIGNE')}
                    className="min-h-[38px] rounded-lg border border-slate-200 bg-white px-2 dark:border-slate-700 dark:bg-slate-900"
                  >
                    <option value="PERTE_CONSIGNE">Perte client</option>
                    <option value="AJUSTEMENT_CONSIGNE">Ajustement solde</option>
                  </select>
                  <input
                    type="number"
                    min={1}
                    value={adjCrates}
                    onChange={(e) => setAdjCrates(Math.max(1, Number(e.target.value)))}
                    className="min-h-[38px] rounded-lg border border-slate-200 bg-white px-2 font-mono font-bold dark:border-slate-700 dark:bg-slate-900"
                  />
                </div>
                <input
                  type="text"
                  value={adjReason}
                  onChange={(e) => setAdjReason(e.target.value)}
                  placeholder="Motif détaillé (ex: Casiers perdus sinistre maquis)"
                  className="min-h-[38px] w-full rounded-lg border border-slate-200 bg-white px-2.5 dark:border-slate-700 dark:bg-slate-900"
                />
                <button
                  type="button"
                  disabled={!hasPerm(PERMISSIONS.CONSIGNMENT_LOSS)}
                  onClick={handleAdjustLossSubmit}
                  className="min-h-[38px] w-full rounded-lg bg-amber-700 px-3 font-semibold text-white hover:bg-amber-800 disabled:opacity-50"
                >
                  Soumettre au Propriétaire
                </button>
              </div>
            )}
          </div>
        </form>

        {/* Client Consignment Balances Table */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-8 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-4 grid grid-cols-1 gap-2.5 rounded-xl border border-slate-200/80 bg-slate-50/70 p-3 sm:grid-cols-2 lg:grid-cols-5 dark:border-slate-800 dark:bg-slate-800/40">
            <div className="relative lg:col-span-2">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filtrer client, maquis, code..."
                className="min-h-[38px] w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-xs dark:border-slate-700 dark:bg-slate-900"
              />
            </div>
            <select
              value={zoneFilter}
              onChange={(e) => setZoneFilter(e.target.value)}
              className="min-h-[38px] rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold dark:border-slate-700 dark:bg-slate-900"
            >
              <option value="ALL">Toutes zones</option>
              {availableZones.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setOnlyHoldingCrates((v) => !v)}
              className={`min-h-[38px] rounded-lg border px-2.5 text-xs font-semibold whitespace-nowrap ${
                onlyHoldingCrates
                  ? 'border-emerald-600 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200'
                  : 'border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
              }`}
            >
              Casiers &gt; 0
            </button>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setOnlyOverdue((v) => !v)}
                className={`min-h-[38px] flex-1 rounded-lg border px-2.5 text-xs font-semibold whitespace-nowrap ${
                  onlyOverdue
                    ? 'border-red-600 bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-300'
                    : 'border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
                }`}
              >
                Retard &gt; {overdueLimit}j
              </button>
              {(search || zoneFilter !== 'ALL' || onlyHoldingCrates || onlyOverdue) && (
                <button
                  type="button"
                  onClick={() => {
                    setSearch('');
                    setZoneFilter('ALL');
                    setOnlyHoldingCrates(false);
                    setOnlyOverdue(false);
                  }}
                  title="Réinitialiser filtres"
                  className="inline-flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:text-red-600 dark:border-slate-700 dark:bg-slate-900"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-medium text-slate-500 dark:border-slate-800">
                  <th className="py-2.5">Client · Zone</th>
                  <th className="py-2.5 text-right">Casiers</th>
                  <th className="py-2.5 text-right">Bouteilles</th>
                  <th className="py-2.5 text-right">Caution due</th>
                  <th className="py-2.5 text-right">Ancienneté</th>
                  <th className="py-2.5 text-right">Relance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {customersPagination.paginatedItems.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-xs text-slate-400">
                      Aucun client correspondant.
                    </td>
                  </tr>
                ) : (
                  customersPagination.paginatedItems.map((c) => {
                    const days = c.lastCrateOutDate ? daysSince(c.lastCrateOutDate) : 0;
                    const isLate = c.consignmentCrates > 0 && days > overdueLimit;
                    return (
                      <tr key={c.id} className="h-11 hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                        <td className="py-2">
                          <p className="font-semibold text-slate-900 dark:text-white">{c.name}</p>
                          <p className="text-xs text-slate-500">
                            {c.code} · {c.zone}
                          </p>
                        </td>
                        <td className="py-2 text-right font-mono font-bold tabular-nums">
                          {formatNumberFR(c.consignmentCrates)}
                        </td>
                        <td className="py-2 text-right font-mono text-slate-600 tabular-nums dark:text-slate-400">
                          {formatNumberFR(c.consignmentBottles)}
                        </td>
                        <td className="py-2 text-right font-mono font-semibold tabular-nums">
                          {formatFCFA(c.consignmentDepositDue)}
                        </td>
                        <td className="py-2 text-right">
                          <span
                            className={`font-mono text-xs font-semibold tabular-nums ${
                              isLate ? 'text-red-600' : 'text-slate-500'
                            }`}
                          >
                            {c.consignmentCrates > 0 ? `${days} j` : '—'}
                          </span>
                        </td>
                        <td className="py-2 text-right">
                          {c.consignmentCrates > 0 && (
                            <button
                              type="button"
                              onClick={() => copyReminder(c.name, c.consignmentCrates, c.consignmentDepositDue, days, c.id)}
                              className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400"
                            >
                              {copiedId === c.id ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                              WhatsApp
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <TablePagination
            page={customersPagination.page}
            totalPages={customersPagination.totalPages}
            pageSize={customersPagination.pageSize}
            totalItems={customersPagination.totalItems}
            startIndex={customersPagination.startIndex}
            endIndex={customersPagination.endIndex}
            onPageChange={customersPagination.setPage}
            onPageSizeChange={customersPagination.setPageSize}
            itemLabel="clients"
          />
        </div>
      </div>

      {/* Recent Consignment Ledger */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">
            Journal des mouvements d’emballages consignés
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={ledgerSearch}
                onChange={(e) => setLedgerSearch(e.target.value)}
                placeholder="Pièce, tiers, référence..."
                className="min-h-[36px] rounded-lg border border-slate-200 bg-white pl-8 pr-3 text-xs dark:border-slate-700 dark:bg-slate-800"
              />
            </div>
            <select
              value={movementTypeFilter}
              onChange={(e) => setMovementTypeFilter(e.target.value as 'ALL' | ConsignmentMovement['movementType'])}
              className="min-h-[36px] rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold dark:border-slate-700 dark:bg-slate-800"
            >
              <option value="ALL">Tous mouvements</option>
              <option value="SORTIE_VENTE">Sortie vente</option>
              <option value="RETOUR_CLIENT">Retour client</option>
              <option value="RECEPTION_BRASSERIE">Réception brasserie</option>
              <option value="RETOUR_BRASSERIE">Retour brasserie</option>
              <option value="CASSE_CONSIGNE">Casse / Perte consigne</option>
            </select>
            {(ledgerSearch || movementTypeFilter !== 'ALL') && (
              <button
                type="button"
                onClick={() => {
                  setLedgerSearch('');
                  setMovementTypeFilter('ALL');
                }}
                title="Réinitialiser"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:text-red-600 dark:border-slate-700"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-medium text-slate-500 dark:border-slate-800">
                <th className="py-2">Document</th>
                <th className="py-2">Date</th>
                <th className="py-2">Type</th>
                <th className="py-2">Tiers</th>
                <th className="py-2 text-right">Sortie</th>
                <th className="py-2 text-right">Entrée</th>
                <th className="py-2 text-right">Montant caution</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {ledgerPagination.paginatedItems.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-xs text-slate-400">
                    Aucun mouvement d’emballage correspondant.
                  </td>
                </tr>
              ) : (
                ledgerPagination.paginatedItems.map((m) => {
                  const cust = m.customerId ? snapshot.customers.find((c) => c.id === m.customerId) : null;
                  const sup = m.supplierId ? snapshot.suppliers.find((s) => s.id === m.supplierId) : null;
                  return (
                    <tr key={m.id} className="h-10">
                      <td className="py-2 font-mono text-xs font-semibold">{m.docNumber}</td>
                      <td className="py-2 text-xs text-slate-500 tabular-nums">{formatDateTimeFR(m.createdAt)}</td>
                      <td className="py-2 text-xs font-medium">{m.movementType}</td>
                      <td className="py-2 text-xs">{cust?.name || sup?.name || '—'}</td>
                      <td className="py-2 text-right font-mono text-amber-700 tabular-nums">
                        {m.cratesOut > 0 ? `-${m.cratesOut}` : '—'}
                      </td>
                      <td className="py-2 text-right font-mono text-emerald-700 tabular-nums">
                        {m.cratesIn > 0 ? `+${m.cratesIn}` : '—'}
                      </td>
                      <td className="py-2 text-right font-mono font-semibold tabular-nums">
                        {formatFCFA(m.depositAmount)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <TablePagination
          page={ledgerPagination.page}
          totalPages={ledgerPagination.totalPages}
          pageSize={ledgerPagination.pageSize}
          totalItems={ledgerPagination.totalItems}
          startIndex={ledgerPagination.startIndex}
          endIndex={ledgerPagination.endIndex}
          onPageChange={ledgerPagination.setPage}
          onPageSizeChange={ledgerPagination.setPageSize}
          itemLabel="mouvements"
        />
      </div>
    </div>
  );
};
