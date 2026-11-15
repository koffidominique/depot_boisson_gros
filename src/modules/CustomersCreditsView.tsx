import React, { useEffect, useMemo, useState } from 'react';
import { Download, Lock, Pencil, Plus, Search, Trash2, Unlock, X } from 'lucide-react';
import { TablePagination, usePagination } from '../components/TablePagination';
import { useErp } from '../context/ErpContext';
import {
  daysSince,
  exportToCsv,
  formatDateFR,
  formatFCFA,
  formatNumberFR,
  PAYMENT_METHOD_LABELS,
} from '../lib/format';
import { PERMISSIONS, type CreditRecord, type Customer, type CustomerCategory, type PaymentMethod, type PricingTier } from '../types/erp';

export const CustomersView: React.FC = () => {
  const { snapshot, mutateApi, hasPerm, notify, navHint, clearNavHint } = useErp();
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'ALL' | CustomerCategory>('ALL');
  const [tierFilter, setTierFilter] = useState<'ALL' | PricingTier>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'BLOQUE' | 'ALERTE_PLAFOND' | 'AVEC_CASIERS' | 'ACTIF'>('ALL');
  const [showAdd, setShowAdd] = useState(false);

  // Credit Limit Edit Modal (Propriétaire only)
  const [limitTarget, setLimitTarget] = useState<Customer | null>(null);
  const [limitInput, setLimitInput] = useState(0);

  useEffect(() => {
    if (navHint?.searchQuery) {
      setSearch(navHint.searchQuery);
      clearNavHint();
    }
  }, [navHint, clearNavHint]);

  const [name, setName] = useState('');
  const [category, setCategory] = useState<CustomerCategory>('MAQUIS');
  const [pricingTier, setPricingTier] = useState<PricingTier>('SEMI_GROS');
  const [phone, setPhone] = useState('+225 07 ');
  const [zone, setZone] = useState('Yopougon');
  const [creditLimit, setCreditLimit] = useState(() => (hasPerm(PERMISSIONS.CREDIT_LIMIT_UPDATE) ? 250000 : 0));

  const customers = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.customers
      .filter((c) => !c.deletedAt)
      .filter((c) => {
        if (categoryFilter !== 'ALL' && c.category !== categoryFilter) return false;
        if (tierFilter !== 'ALL' && c.pricingTier !== tierFilter) return false;
        if (statusFilter === 'BLOQUE' && !c.isBlocked) return false;
        if (statusFilter === 'ALERTE_PLAFOND' && !(c.creditLimit > 0 && c.creditBalance >= c.creditLimit * 0.9)) {
          return false;
        }
        if (statusFilter === 'AVEC_CASIERS' && c.consignmentCrates <= 0) return false;
        if (statusFilter === 'ACTIF' && c.isBlocked) return false;
        if (search.trim()) {
          const q = search.toLowerCase();
          return (
            c.name.toLowerCase().includes(q) ||
            c.zone.toLowerCase().includes(q) ||
            c.code.toLowerCase().includes(q) ||
            c.phone.toLowerCase().includes(q)
          );
        }
        return true;
      });
  }, [snapshot, categoryFilter, tierFilter, statusFilter, search]);

  const customersPagination = usePagination(customers, 8);

  if (!snapshot) return null;

  const canSetCreditLimit = hasPerm(PERMISSIONS.CREDIT_LIMIT_UPDATE);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await mutateApi('/api/customers', 'POST', {
      name,
      category,
      pricingTier,
      phone,
      zone,
      creditLimit: canSetCreditLimit ? creditLimit : 0,
    });
    if (res) {
      notify('success', 'Client ajouté.');
      setShowAdd(false);
      setName('');
    }
  };

  const handleSaveCreditLimit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!limitTarget) return;
    const res = await mutateApi(`/api/customers/${limitTarget.id}/credit-limit`, 'PATCH', {
      creditLimit: limitInput,
    });
    if (res) {
      notify('success', `Plafond crédit mis à jour pour ${limitTarget.name} (${formatFCFA(limitInput)}).`);
      setLimitTarget(null);
    }
  };

  const handleArchive = async (id: string, custName: string) => {
    const res = await mutateApi(`/api/customers/${id}`, 'DELETE');
    if (res) notify('success', `Client "${custName}" archivé.`);
  };

  const handleToggleBlock = async (id: string, custName: string, currentlyBlocked?: boolean) => {
    const res = await mutateApi(`/api/customers/${id}/toggle-block`, 'POST');
    if (res) {
      notify('success', currentlyBlocked ? `Crédit débloqué pour ${custName}.` : `Crédit bloqué pour ${custName}.`);
    }
  };

  const handleExport = () => {
    exportToCsv(
      'clients-gestdepot.csv',
      ['Code', 'Nom', 'Catégorie', 'Tarif', 'Zone', 'Plafond Crédit', 'Encours Crédit', 'Casiers', 'Caution Due'],
      customers.map((c) => [
        c.code,
        c.name,
        c.category,
        c.pricingTier,
        c.zone,
        c.creditLimit,
        c.creditBalance,
        c.consignmentCrates,
        c.consignmentDepositDue,
      ])
    );
  };

  const showActionsCol =
    hasPerm(PERMISSIONS.CUSTOMER_UPDATE) || hasPerm(PERMISSIONS.CREDIT_BLOCK) || canSetCreditLimit;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            Clients, Maquis & Semi-Grossistes
          </h1>
          <p className="text-xs text-slate-500">
            Grilles tarifaires (Gros, Semi-Gros, Détail), plafonds de crédit (Propriétaire) & solde consignes
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleExport}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 whitespace-nowrap shrink-0"
          >
            <Download className="h-3.5 w-3.5" />
            Exporter CSV
          </button>
          {hasPerm(PERMISSIONS.CUSTOMER_CREATE) && (
            <button
              type="button"
              onClick={() => setShowAdd((v) => !v)}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-emerald-700 px-3.5 text-xs font-semibold text-white whitespace-nowrap shrink-0"
            >
              <Plus className="h-4 w-4" />
              Nouveau client
            </button>
          )}
        </div>
      </div>

      {showAdd && (
        <form onSubmit={handleAdd} className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-5 sm:grid-cols-3 dark:border-slate-800 dark:bg-slate-900">
          <input required placeholder="Raison sociale / Nom maquis" value={name} onChange={(e) => setName(e.target.value)} className="min-h-[40px] rounded-lg border border-slate-200 px-3 text-sm dark:border-slate-700 dark:bg-slate-800" />
          <select value={category} onChange={(e) => setCategory(e.target.value as CustomerCategory)} className="min-h-[40px] rounded-lg border border-slate-200 px-3 text-sm dark:border-slate-700 dark:bg-slate-800">
            <option value="MAQUIS">Maquis</option>
            <option value="BAR_RESTO">Bar / Restaurant</option>
            <option value="BOUTIQUE">Boutique / Alimentation</option>
            <option value="SEMI_GROSSISTE">Semi-Grossiste</option>
          </select>
          <select value={pricingTier} onChange={(e) => setPricingTier(e.target.value as PricingTier)} className="min-h-[40px] rounded-lg border border-slate-200 px-3 text-sm dark:border-slate-700 dark:bg-slate-800">
            <option value="DETAIL">Tarif Détail</option>
            <option value="SEMI_GROS">Tarif Semi-Gros</option>
            <option value="GROS">Tarif Gros</option>
          </select>
          <input placeholder="Téléphone" value={phone} onChange={(e) => setPhone(e.target.value)} className="min-h-[40px] rounded-lg border border-slate-200 px-3 text-sm dark:border-slate-700 dark:bg-slate-800" />
          <input placeholder="Zone / Quartier" value={zone} onChange={(e) => setZone(e.target.value)} className="min-h-[40px] rounded-lg border border-slate-200 px-3 text-sm dark:border-slate-700 dark:bg-slate-800" />
          <div>
            <input
              type="number"
              disabled={!canSetCreditLimit}
              placeholder="Plafond crédit (FCFA)"
              value={canSetCreditLimit ? creditLimit : 0}
              onChange={(e) => setCreditLimit(Number(e.target.value))}
              className="min-h-[40px] w-full rounded-lg border border-slate-200 px-3 font-mono text-sm disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800"
            />
            {!canSetCreditLimit && (
              <p className="mt-1 text-[10px] text-slate-500">Plafond initial à 0 FCFA (fixé ensuite par le Propriétaire).</p>
            )}
          </div>
          <div className="sm:col-span-3 flex justify-end gap-2">
            <button type="button" onClick={() => setShowAdd(false)} className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold">Annuler</button>
            <button type="submit" className="rounded-lg bg-emerald-700 px-4 py-2 text-xs font-semibold text-white">Créer client</button>
          </div>
        </form>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-4 grid grid-cols-1 gap-2.5 rounded-xl border border-slate-200/80 bg-slate-50/70 p-3 sm:grid-cols-2 lg:grid-cols-5 dark:border-slate-800 dark:bg-slate-800/40">
          <div className="relative lg:col-span-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher client, zone, code, téléphone..."
              className="min-h-[38px] w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-xs dark:border-slate-700 dark:bg-slate-900"
            />
          </div>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as 'ALL' | CustomerCategory)}
            className="min-h-[38px] rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold dark:border-slate-700 dark:bg-slate-900"
          >
            <option value="ALL">Toutes catégories</option>
            <option value="MAQUIS">Maquis</option>
            <option value="BAR_RESTO">Bar / Restaurant</option>
            <option value="BOUTIQUE">Boutique</option>
            <option value="SEMI_GROSSISTE">Semi-Grossiste</option>
            <option value="PARTICULIER">Particulier</option>
          </select>
          <select
            value={tierFilter}
            onChange={(e) => setTierFilter(e.target.value as 'ALL' | PricingTier)}
            className="min-h-[38px] rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold dark:border-slate-700 dark:bg-slate-900"
          >
            <option value="ALL">Tous tarifs</option>
            <option value="GROS">Tarif Gros</option>
            <option value="SEMI_GROS">Tarif Semi-Gros</option>
            <option value="DETAIL">Tarif Détail</option>
          </select>
          <div className="flex items-center gap-1.5">
            <select
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as 'ALL' | 'BLOQUE' | 'ALERTE_PLAFOND' | 'AVEC_CASIERS' | 'ACTIF')
              }
              className="min-h-[38px] w-full rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold dark:border-slate-700 dark:bg-slate-900"
            >
              <option value="ALL">Tous états</option>
              <option value="ACTIF">Crédit autorisé</option>
              <option value="BLOQUE">Crédit bloqué</option>
              <option value="ALERTE_PLAFOND">Alerte plafond (&ge;90%)</option>
              <option value="AVEC_CASIERS">Détient des casiers</option>
            </select>
            {(search || categoryFilter !== 'ALL' || tierFilter !== 'ALL' || statusFilter !== 'ALL') && (
              <button
                type="button"
                onClick={() => {
                  setSearch('');
                  setCategoryFilter('ALL');
                  setTierFilter('ALL');
                  setStatusFilter('ALL');
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
                <th className="py-2.5">Client · Catégorie</th>
                <th className="py-2.5">Zone · Téléphone</th>
                <th className="py-2.5">Tarif</th>
                <th className="py-2.5 text-right">Encours / Plafond</th>
                <th className="py-2.5 text-right">Casiers · Caution</th>
                {showActionsCol && <th className="py-2.5 text-right">Action</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {customersPagination.paginatedItems.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-xs text-slate-400">
                    Aucun client ne correspond à ces filtres.
                  </td>
                </tr>
              ) : (
                customersPagination.paginatedItems.map((c) => {
                  const over = c.creditLimit > 0 && c.creditBalance >= c.creditLimit * 0.9;
                  return (
                    <tr key={c.id} className="h-12 hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                      <td className="py-2">
                        <p className="font-semibold text-slate-900 dark:text-white">
                          {c.name}
                          {c.isBlocked && (
                            <span className="ml-2 text-xs font-semibold text-red-600">· Crédit bloqué</span>
                          )}
                        </p>
                        <p className="font-mono text-xs text-slate-500">{c.code} · {c.category}</p>
                      </td>
                      <td className="py-2 text-xs text-slate-600 dark:text-slate-400">
                        {c.zone} · {c.phone}
                      </td>
                      <td className="py-2 text-xs font-semibold text-slate-700 dark:text-slate-300">{c.pricingTier}</td>
                      <td className="py-2 text-right font-mono text-xs tabular-nums">
                        <span className={over ? 'font-bold text-red-600' : 'text-slate-900 dark:text-white'}>
                          {formatFCFA(c.creditBalance)}
                        </span>
                        <span className="text-slate-400"> / {formatFCFA(c.creditLimit)}</span>
                      </td>
                      <td className="py-2 text-right font-mono text-xs tabular-nums">
                        {formatNumberFR(c.consignmentCrates)} casiers · {formatFCFA(c.consignmentDepositDue)}
                      </td>
                      {showActionsCol && (
                        <td className="py-2 text-right">
                          {c.id !== 'cust-comptoir' && (
                            <div className="inline-flex items-center gap-1">
                              {canSetCreditLimit && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setLimitTarget(c);
                                    setLimitInput(c.creditLimit);
                                  }}
                                  className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 whitespace-nowrap"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                  Plafond
                                </button>
                              )}
                              {hasPerm(PERMISSIONS.CREDIT_BLOCK) && (
                                <button
                                  type="button"
                                  onClick={() => handleToggleBlock(c.id, c.name, c.isBlocked)}
                                  title={c.isBlocked ? 'Débloquer le crédit' : 'Bloquer le crédit'}
                                  className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold whitespace-nowrap ${
                                    c.isBlocked
                                      ? 'text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400'
                                      : 'text-amber-700 hover:bg-amber-50 dark:text-amber-400'
                                  }`}
                                >
                                  {c.isBlocked ? <Unlock className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
                                  {c.isBlocked ? 'Débloquer' : 'Bloquer'}
                                </button>
                              )}
                              {hasPerm(PERMISSIONS.CUSTOMER_UPDATE) && (
                                <button
                                  type="button"
                                  onClick={() => handleArchive(c.id, c.name)}
                                  className="p-1.5 text-slate-400 hover:text-red-600"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      )}
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

      {limitTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <form
            onSubmit={handleSaveCreditLimit}
            className="w-full max-w-sm space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-800 dark:bg-slate-900"
          >
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                Plafond crédit · {limitTarget.name}
              </h3>
              <p className="text-xs text-slate-500">
                Encours actuel : {formatFCFA(limitTarget.creditBalance)} · Modification réservée au Propriétaire
              </p>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600">Nouveau plafond (FCFA)</label>
              <input
                type="number"
                min={0}
                value={limitInput}
                onChange={(e) => setLimitInput(Math.max(0, Number(e.target.value)))}
                className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-200 px-3 font-mono text-sm font-bold dark:border-slate-700 dark:bg-slate-800"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setLimitTarget(null)} className="min-h-[40px] rounded-lg border border-slate-200 px-4 text-xs font-semibold dark:border-slate-700">
                Annuler
              </button>
              <button type="submit" className="min-h-[40px] rounded-lg bg-emerald-700 px-4 text-xs font-semibold text-white">
                Enregistrer
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export const CreditsView: React.FC = () => {
  const { snapshot, mutateApi, hasPerm, notify, selectedWarehouseId } = useErp();
  const [payingId, setPayingId] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState(0);
  const [payMethod, setPayMethod] = useState<Exclude<PaymentMethod, 'CREDIT'>>('ESPECES');
  const [payRef, setPayRef] = useState('');
  const [creditSearch, setCreditSearch] = useState('');
  const [creditStatusFilter, setCreditStatusFilter] = useState<'ALL' | CreditRecord['status']>('ALL');
  const [agingFilter, setAgingFilter] = useState<'ALL' | '0_7' | '8_30' | '31_60' | '60_PLUS'>('ALL');

  // Write-off modal
  const [writeOffTarget, setWriteOffTarget] = useState<CreditRecord | null>(null);
  const [writeOffReason, setWriteOffReason] = useState('');

  const scopedCredits = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.credits.filter(
      (c) => selectedWarehouseId === 'ALL' || !c.warehouseId || c.warehouseId === selectedWarehouseId
    );
  }, [snapshot, selectedWarehouseId]);

  const filteredCredits = useMemo(() => {
    if (!snapshot) return [];
    return scopedCredits.filter((crd) => {
      if (creditStatusFilter !== 'ALL' && crd.status !== creditStatusFilter) return false;
      if (agingFilter !== 'ALL') {
        const age = daysSince(crd.createdAt);
        if (agingFilter === '0_7' && age > 7) return false;
        if (agingFilter === '8_30' && (age <= 7 || age > 30)) return false;
        if (agingFilter === '31_60' && (age <= 30 || age > 60)) return false;
        if (agingFilter === '60_PLUS' && age <= 60) return false;
      }
      if (creditSearch.trim()) {
        const q = creditSearch.toLowerCase();
        const cust = snapshot.customers.find((c) => c.id === crd.customerId);
        return (
          crd.docNumber.toLowerCase().includes(q) ||
          crd.saleDocNumber.toLowerCase().includes(q) ||
          (cust?.name.toLowerCase().includes(q) ?? false)
        );
      }
      return true;
    });
  }, [snapshot, scopedCredits, creditSearch, creditStatusFilter, agingFilter]);

  const creditsPagination = usePagination(filteredCredits, 8);

  if (!snapshot) return null;

  const openCredits = scopedCredits.filter((c) => c.remainingAmount > 0 && c.status !== 'ABANDONNE');
  const buckets = { b0_7: 0, b8_30: 0, b31_60: 0, b60p: 0 };
  openCredits.forEach((c) => {
    const age = daysSince(c.createdAt);
    if (age <= 7) buckets.b0_7 += c.remainingAmount;
    else if (age <= 30) buckets.b8_30 += c.remainingAmount;
    else if (age <= 60) buckets.b31_60 += c.remainingAmount;
    else buckets.b60p += c.remainingAmount;
  });

  const handlePay = async () => {
    if (!payingId || payAmount <= 0) return;
    const res = await mutateApi('/api/credits/pay', 'POST', {
      creditId: payingId,
      amount: payAmount,
      method: payMethod,
      reference: payRef,
    });
    if (res) {
      notify('success', `Règlement de ${formatFCFA(payAmount)} encaissé.`);
      setPayingId(null);
      setPayRef('');
    }
  };

  const handleWriteOffSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!writeOffTarget || !writeOffReason.trim()) return;
    const canDirectWriteOff = hasPerm(PERMISSIONS.CREDIT_WRITE_OFF);
    const url = canDirectWriteOff
      ? `/api/credits/${writeOffTarget.id}/write-off`
      : `/api/credits/${writeOffTarget.id}/write-off-request`;
    const res = await mutateApi(url, 'POST', { reason: writeOffReason.trim() });
    if (res) {
      notify(
        canDirectWriteOff ? 'success' : 'warning',
        canDirectWriteOff
          ? `Créance ${writeOffTarget.docNumber} passée en perte (ABANDONNE).`
          : `Demande d’abandon de créance ${writeOffTarget.docNumber} transmise au Propriétaire.`
      );
      setWriteOffTarget(null);
      setWriteOffReason('');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            Crédits Clients & Balance Âgée
          </h1>
          <p className="text-xs text-slate-500">
            Suivi des encours, blocage automatique au plafond, balance âgée, recouvrement & abandons (Propriétaire)
          </p>
        </div>
        <button
          type="button"
          onClick={() =>
            exportToCsv(
              'balance-agee-credits.csv',
              ['Dossier', 'Facture', 'Client', 'Montant initial', 'Reste dû', 'Échéance', 'Âge (jours)', 'Statut'],
              scopedCredits.map((c) => {
                const cust = snapshot.customers.find((x) => x.id === c.customerId);
                return [
                  c.docNumber,
                  c.saleDocNumber,
                  cust?.name || '',
                  c.originalAmount,
                  c.remainingAmount,
                  formatDateFR(c.dueDate),
                  daysSince(c.createdAt),
                  c.status,
                ];
              })
            )
          }
          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 whitespace-nowrap shrink-0"
        >
          <Download className="h-3.5 w-3.5" />
          Exporter Balance Âgée
        </button>
      </div>

      {/* Balance âgée */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs font-medium text-slate-500">0 – 7 jours</p>
          <p className="mt-1 font-mono text-xl font-bold text-slate-900 tabular-nums dark:text-white">{formatFCFA(buckets.b0_7)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs font-medium text-slate-500">8 – 30 jours</p>
          <p className="mt-1 font-mono text-xl font-bold text-amber-700 tabular-nums dark:text-amber-400">{formatFCFA(buckets.b8_30)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs font-medium text-slate-500">31 – 60 jours</p>
          <p className="mt-1 font-mono text-xl font-bold text-red-600 tabular-nums">{formatFCFA(buckets.b31_60)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs font-medium text-slate-500">60+ jours (Contentieux)</p>
          <p className="mt-1 font-mono text-xl font-bold text-red-700 tabular-nums">{formatFCFA(buckets.b60p)}</p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-4 grid grid-cols-1 gap-2.5 rounded-xl border border-slate-200/80 bg-slate-50/70 p-3 sm:grid-cols-4 dark:border-slate-800 dark:bg-slate-800/40">
          <div className="relative sm:col-span-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={creditSearch}
              onChange={(e) => setCreditSearch(e.target.value)}
              placeholder="Rechercher dossier, facture, client..."
              className="min-h-[38px] w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-xs dark:border-slate-700 dark:bg-slate-900"
            />
          </div>
          <select
            value={creditStatusFilter}
            onChange={(e) => setCreditStatusFilter(e.target.value as 'ALL' | CreditRecord['status'])}
            className="min-h-[38px] rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold dark:border-slate-700 dark:bg-slate-900"
          >
            <option value="ALL">Tous statuts</option>
            <option value="OUVERT">Ouvert</option>
            <option value="PARTIEL">Partiel</option>
            <option value="EN_RETARD">En retard</option>
            <option value="SOLDE">Soldé</option>
            <option value="ABANDONNE">Abandonné</option>
          </select>
          <div className="flex items-center gap-1.5">
            <select
              value={agingFilter}
              onChange={(e) => setAgingFilter(e.target.value as 'ALL' | '0_7' | '8_30' | '31_60' | '60_PLUS')}
              className="min-h-[38px] w-full rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold dark:border-slate-700 dark:bg-slate-900"
            >
              <option value="ALL">Toutes tranches d’âge</option>
              <option value="0_7">0 – 7 jours</option>
              <option value="8_30">8 – 30 jours</option>
              <option value="31_60">31 – 60 jours</option>
              <option value="60_PLUS">60+ jours</option>
            </select>
            {(creditSearch || creditStatusFilter !== 'ALL' || agingFilter !== 'ALL') && (
              <button
                type="button"
                onClick={() => {
                  setCreditSearch('');
                  setCreditStatusFilter('ALL');
                  setAgingFilter('ALL');
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
                <th className="py-2.5">Dossier · Facture</th>
                <th className="py-2.5">Client</th>
                <th className="py-2.5">Échéance</th>
                <th className="py-2.5 text-right">Initial</th>
                <th className="py-2.5 text-right">Reste dû</th>
                <th className="py-2.5 text-right">Statut</th>
                <th className="py-2.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {creditsPagination.paginatedItems.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-xs text-slate-400">
                    Aucun dossier crédit trouvé.
                  </td>
                </tr>
              ) : (
                creditsPagination.paginatedItems.map((crd) => {
                  const cust = snapshot.customers.find((c) => c.id === crd.customerId);
                  return (
                    <tr key={crd.id} className="h-11">
                      <td className="py-2 font-mono text-xs font-semibold">
                        {crd.docNumber} · {crd.saleDocNumber}
                      </td>
                      <td className="py-2 font-medium">{cust?.name}</td>
                      <td className="py-2 text-xs text-slate-500 tabular-nums">{formatDateFR(crd.dueDate)}</td>
                      <td className="py-2 text-right font-mono text-xs tabular-nums">{formatFCFA(crd.originalAmount)}</td>
                      <td className="py-2 text-right font-mono font-bold tabular-nums">{formatFCFA(crd.remainingAmount)}</td>
                      <td className="py-2 text-right text-xs font-semibold">
                        <span
                          className={
                            crd.status === 'EN_RETARD'
                              ? 'text-red-600'
                              : crd.status === 'SOLDE'
                              ? 'text-emerald-700'
                              : crd.status === 'ABANDONNE'
                              ? 'text-slate-400 line-through'
                              : 'text-amber-700'
                          }
                        >
                          {crd.status}
                        </span>
                      </td>
                      <td className="py-2 text-right">
                        {crd.remainingAmount > 0 && crd.status !== 'ABANDONNE' && (
                          <div className="inline-flex items-center gap-1.5">
                            {hasPerm(PERMISSIONS.CREDIT_GRANT) && (
                              <button
                                type="button"
                                onClick={() => {
                                  setPayingId(crd.id);
                                  setPayAmount(crd.remainingAmount);
                                }}
                                className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 whitespace-nowrap"
                              >
                                Encaisser
                              </button>
                            )}
                            {(hasPerm(PERMISSIONS.CREDIT_WRITE_OFF) || hasPerm(PERMISSIONS.CREDIT_GRANT)) && (
                              <button
                                type="button"
                                onClick={() => setWriteOffTarget(crd)}
                                className="rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 whitespace-nowrap"
                              >
                                {hasPerm(PERMISSIONS.CREDIT_WRITE_OFF) ? 'Abandonner' : 'Demander abandon'}
                              </button>
                            )}
                          </div>
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
          page={creditsPagination.page}
          totalPages={creditsPagination.totalPages}
          pageSize={creditsPagination.pageSize}
          totalItems={creditsPagination.totalItems}
          startIndex={creditsPagination.startIndex}
          endIndex={creditsPagination.endIndex}
          onPageChange={creditsPagination.setPage}
          onPageSizeChange={creditsPagination.setPageSize}
          itemLabel="créances"
        />
      </div>

      {payingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">Encaisser un règlement crédit</h3>
            <div className="mt-4 space-y-3">
              <div>
                <label className="text-xs font-semibold text-slate-600">Montant encaissé (FCFA)</label>
                <input
                  type="number"
                  min={1}
                  value={payAmount}
                  onChange={(e) => setPayAmount(Number(e.target.value))}
                  className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-200 px-3 font-mono text-sm font-bold dark:border-slate-700 dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600">Mode de règlement</label>
                <select
                  value={payMethod}
                  onChange={(e) => setPayMethod(e.target.value as Exclude<PaymentMethod, 'CREDIT'>)}
                  className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-200 px-3 text-sm dark:border-slate-700 dark:bg-slate-800"
                >
                  {(['ESPECES', 'ORANGE_MONEY', 'MTN_MOMO', 'WAVE', 'MOOV_MONEY'] as const).map((m) => (
                    <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>
                  ))}
                </select>
              </div>
              <input
                type="text"
                value={payRef}
                onChange={(e) => setPayRef(e.target.value)}
                placeholder="Référence reçu / Mobile Money"
                className="min-h-[40px] w-full rounded-lg border border-slate-200 px-3 text-xs dark:border-slate-700 dark:bg-slate-800"
              />
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={handlePay} className="min-h-[42px] flex-1 rounded-lg bg-emerald-700 text-xs font-semibold text-white">Confirmer</button>
                <button type="button" onClick={() => setPayingId(null)} className="min-h-[42px] rounded-lg border border-slate-200 px-4 text-xs font-semibold">Annuler</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {writeOffTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <form
            onSubmit={handleWriteOffSubmit}
            className="w-full max-w-md space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-800 dark:bg-slate-900"
          >
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                Abandon de créance · {writeOffTarget.docNumber}
              </h3>
              <p className="text-xs text-slate-500">
                Montant restant : {formatFCFA(writeOffTarget.remainingAmount)}.{' '}
                {hasPerm(PERMISSIONS.CREDIT_WRITE_OFF)
                  ? 'Exécution directe Propriétaire (irréversible).'
                  : 'La demande sera soumise au Propriétaire pour approbation.'}
              </p>
            </div>
            <textarea
              required
              rows={3}
              value={writeOffReason}
              onChange={(e) => setWriteOffReason(e.target.value)}
              placeholder="Motif exact (ex: Fermeture définitive du point de vente, impayé > 90j)..."
              className="w-full rounded-lg border border-slate-200 p-2.5 text-sm dark:border-slate-700 dark:bg-slate-800"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setWriteOffTarget(null);
                  setWriteOffReason('');
                }}
                className="min-h-[40px] rounded-lg border border-slate-200 px-4 text-xs font-semibold dark:border-slate-700"
              >
                Annuler
              </button>
              <button
                type="submit"
                className="min-h-[40px] rounded-lg bg-red-600 px-4 text-xs font-semibold text-white hover:bg-red-700"
              >
                {hasPerm(PERMISSIONS.CREDIT_WRITE_OFF) ? 'Passer en perte' : 'Soumettre au Propriétaire'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
