import React, { useMemo, useState } from 'react';
import { ArrowRightLeft, Camera, Download, Plus, Search, X } from 'lucide-react';
import { TablePagination, usePagination } from '../components/TablePagination';
import { useErp } from '../context/ErpContext';
import { exportToCsv, formatDateTimeFR, formatFCFA } from '../lib/format';
import { PERMISSIONS, type ReturnBreakageRecord, type TreasuryTransaction, type TreasuryWallet } from '../types/erp';

const WALLET_LABELS: Record<TreasuryWallet, string> = {
  CAISSE: 'Caisse Espèces',
  ORANGE_MONEY: 'Orange Money',
  MTN_MOMO: 'MTN MoMo',
  WAVE: 'Wave CI',
  MOOV_MONEY: 'Moov Money',
  BANQUE: 'Compte Banque SGBCI',
};

export const TreasuryView: React.FC = () => {
  const { snapshot, mutateApi, hasPerm, notify, activeWarehouseId, selectedWarehouseId } = useErp();
  const [wallet, setWallet] = useState<TreasuryWallet>('CAISSE');
  const [direction, setDirection] = useState<'ENTREE' | 'SORTIE' | 'TRANSFERT'>('SORTIE');
  const [targetWallet, setTargetWallet] = useState<TreasuryWallet>('BANQUE');
  const [category, setCategory] = useState('Carburant / Dépense tournée');
  const [amount, setAmount] = useState(10000);
  const [description, setDescription] = useState('');

  // Filters
  const [txSearch, setTxSearch] = useState('');
  const [walletFilter, setWalletFilter] = useState<'ALL' | TreasuryWallet>('ALL');
  const [directionFilter, setDirectionFilter] = useState<'ALL' | TreasuryTransaction['direction']>('ALL');

  const scopedTreasury = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.treasury.filter(
      (tx) => selectedWarehouseId === 'ALL' || !tx.warehouseId || tx.warehouseId === selectedWarehouseId
    );
  }, [snapshot, selectedWarehouseId]);

  const filteredTreasury = useMemo(() => {
    return scopedTreasury.filter((tx) => {
      if (walletFilter !== 'ALL' && tx.wallet !== walletFilter && tx.targetWallet !== walletFilter) return false;
      if (directionFilter !== 'ALL' && tx.direction !== directionFilter) return false;
      if (txSearch.trim()) {
        const q = txSearch.toLowerCase();
        return (
          tx.docNumber.toLowerCase().includes(q) ||
          tx.description.toLowerCase().includes(q) ||
          tx.category.toLowerCase().includes(q) ||
          tx.reference.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [scopedTreasury, txSearch, walletFilter, directionFilter]);

  const txPagination = usePagination(filteredTreasury, 8);

  if (!snapshot) return null;

  const balances: Record<TreasuryWallet, number> = {
    CAISSE: 0,
    ORANGE_MONEY: 0,
    MTN_MOMO: 0,
    WAVE: 0,
    MOOV_MONEY: 0,
    BANQUE: 0,
  };

  scopedTreasury.forEach((tx) => {
    if (tx.direction === 'ENTREE') balances[tx.wallet] += tx.amount;
    else if (tx.direction === 'SORTIE') balances[tx.wallet] -= tx.amount;
    else if (tx.direction === 'TRANSFERT') {
      balances[tx.wallet] -= tx.amount;
      if (tx.targetWallet) balances[tx.targetWallet] += tx.amount;
    }
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await mutateApi('/api/treasury', 'POST', {
      warehouseId: activeWarehouseId,
      wallet,
      direction,
      targetWallet: direction === 'TRANSFERT' ? targetWallet : undefined,
      category,
      amount,
      reference: `TRS-${Date.now().toString().slice(-4)}`,
      description: description || category,
    });
    if (res) {
      notify('success', 'Mouvement de trésorerie enregistré.');
      setDescription('');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            Trésorerie (Caisse, Mobile Money & Banque)
          </h1>
          <p className="text-xs text-slate-500">
            Soldes temps réel multi-comptes · Transferts inter-caisses & dépenses d’exploitation
          </p>
        </div>
        <button
          type="button"
          onClick={() =>
            exportToCsv(
              'tresorerie-gestdepot.csv',
              ['Document', 'Date', 'Portefeuille', 'Direction', 'Catégorie', 'Montant (FCFA)', 'Description'],
              scopedTreasury.map((t) => [
                t.docNumber,
                formatDateTimeFR(t.createdAt),
                WALLET_LABELS[t.wallet],
                t.direction,
                t.category,
                t.amount,
                t.description,
              ])
            )
          }
          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 whitespace-nowrap shrink-0"
        >
          <Download className="h-3.5 w-3.5" />
          Exporter Trésorerie
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {(Object.keys(WALLET_LABELS) as TreasuryWallet[]).map((w) => (
          <div key={w} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <p className="text-xs font-medium text-slate-500">{WALLET_LABELS[w]}</p>
            <p className="mt-1.5 font-mono text-base font-bold text-slate-900 tabular-nums dark:text-white">
              {formatFCFA(balances[w])}
            </p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <form
          onSubmit={handleSubmit}
          className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 lg:col-span-4 dark:border-slate-800 dark:bg-slate-900"
        >
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
            <ArrowRightLeft className="h-4 w-4 text-emerald-700" />
            <h2 className="text-base font-bold">Nouveau mouvement / transfert</h2>
          </div>
          <select value={direction} onChange={(e) => setDirection(e.target.value as 'ENTREE' | 'SORTIE' | 'TRANSFERT')} className="min-h-[40px] w-full rounded-lg border border-slate-200 px-3 text-sm dark:border-slate-700 dark:bg-slate-800">
            <option value="SORTIE">Décaissement / Dépense</option>
            <option value="TRANSFERT">Transfert Caisse ↔ Banque / MoMo</option>
            <option value="ENTREE">Apport / Entrée diverse</option>
          </select>
          <select value={wallet} onChange={(e) => setWallet(e.target.value as TreasuryWallet)} className="min-h-[40px] w-full rounded-lg border border-slate-200 px-3 text-sm dark:border-slate-700 dark:bg-slate-800">
            {(Object.keys(WALLET_LABELS) as TreasuryWallet[]).map((w) => (
              <option key={w} value={w}>Source : {WALLET_LABELS[w]}</option>
            ))}
          </select>
          {direction === 'TRANSFERT' && (
            <select value={targetWallet} onChange={(e) => setTargetWallet(e.target.value as TreasuryWallet)} className="min-h-[40px] w-full rounded-lg border border-slate-200 px-3 text-sm dark:border-slate-700 dark:bg-slate-800">
              {(Object.keys(WALLET_LABELS) as TreasuryWallet[]).map((w) => (
                <option key={w} value={w}>Destination : {WALLET_LABELS[w]}</option>
              ))}
            </select>
          )}
          <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Catégorie" className="min-h-[40px] w-full rounded-lg border border-slate-200 px-3 text-sm dark:border-slate-700 dark:bg-slate-800" />
          <input type="number" min={1} value={amount} onChange={(e) => setAmount(Number(e.target.value))} className="min-h-[40px] w-full rounded-lg border border-slate-200 px-3 font-mono text-sm font-bold dark:border-slate-700 dark:bg-slate-800" />
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Motif détaillé" className="min-h-[40px] w-full rounded-lg border border-slate-200 px-3 text-sm dark:border-slate-700 dark:bg-slate-800" />
          <button
            type="submit"
            disabled={!hasPerm(PERMISSIONS.TREASURY_MANAGE)}
            className="min-h-[44px] w-full rounded-lg bg-emerald-700 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
          >
            Enregistrer l’opération
          </button>
        </form>

        <div className="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-8 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-bold">Journal des flux financiers</h2>
            <span className="font-mono text-xs text-slate-500 tabular-nums">
              {filteredTreasury.length} opération(s)
            </span>
          </div>

          <div className="mb-4 grid grid-cols-1 gap-2 rounded-xl border border-slate-200/80 bg-slate-50/70 p-2.5 sm:grid-cols-4 dark:border-slate-800 dark:bg-slate-800/40">
            <div className="relative sm:col-span-2">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={txSearch}
                onChange={(e) => setTxSearch(e.target.value)}
                placeholder="Pièce, libellé, catégorie, réf..."
                className="min-h-[36px] w-full rounded-lg border border-slate-200 bg-white pl-8 pr-3 text-xs dark:border-slate-700 dark:bg-slate-900"
              />
            </div>
            <select
              value={walletFilter}
              onChange={(e) => setWalletFilter(e.target.value as 'ALL' | TreasuryWallet)}
              className="min-h-[36px] rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold dark:border-slate-700 dark:bg-slate-900"
            >
              <option value="ALL">Tous comptes</option>
              {(Object.keys(WALLET_LABELS) as TreasuryWallet[]).map((w) => (
                <option key={w} value={w}>{WALLET_LABELS[w]}</option>
              ))}
            </select>
            <div className="flex items-center gap-1.5">
              <select
                value={directionFilter}
                onChange={(e) => setDirectionFilter(e.target.value as 'ALL' | TreasuryTransaction['direction'])}
                className="min-h-[36px] w-full rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold dark:border-slate-700 dark:bg-slate-900"
              >
                <option value="ALL">Tous sens</option>
                <option value="ENTREE">Entrée</option>
                <option value="SORTIE">Sortie</option>
                <option value="TRANSFERT">Transfert</option>
              </select>
              {(txSearch || walletFilter !== 'ALL' || directionFilter !== 'ALL') && (
                <button
                  type="button"
                  onClick={() => {
                    setTxSearch('');
                    setWalletFilter('ALL');
                    setDirectionFilter('ALL');
                  }}
                  title="Réinitialiser"
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:text-red-600 dark:border-slate-700 dark:bg-slate-900"
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
                  <th className="py-2">Pièce</th>
                  <th className="py-2">Date</th>
                  <th className="py-2">Compte</th>
                  <th className="py-2">Libellé</th>
                  <th className="py-2 text-right">Montant</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {txPagination.paginatedItems.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-xs text-slate-400">
                      Aucune opération financière correspondante.
                    </td>
                  </tr>
                ) : (
                  txPagination.paginatedItems.map((tx) => (
                    <tr key={tx.id} className="h-10">
                      <td className="py-2 font-mono text-xs font-semibold">{tx.docNumber}</td>
                      <td className="py-2 text-xs text-slate-500 tabular-nums">{formatDateTimeFR(tx.createdAt)}</td>
                      <td className="py-2 text-xs font-medium">{WALLET_LABELS[tx.wallet]}</td>
                      <td className="py-2 text-xs">{tx.description}</td>
                      <td
                        className={`py-2 text-right font-mono font-semibold tabular-nums ${
                          tx.direction === 'ENTREE' ? 'text-emerald-700' : tx.direction === 'SORTIE' ? 'text-red-600' : 'text-slate-700'
                        }`}
                      >
                        {tx.direction === 'ENTREE' ? '+' : tx.direction === 'SORTIE' ? '-' : '↔ '}
                        {formatFCFA(tx.amount)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <TablePagination
            page={txPagination.page}
            totalPages={txPagination.totalPages}
            pageSize={txPagination.pageSize}
            totalItems={txPagination.totalItems}
            startIndex={txPagination.startIndex}
            endIndex={txPagination.endIndex}
            onPageChange={txPagination.setPage}
            onPageSizeChange={txPagination.setPageSize}
            itemLabel="opérations"
          />
        </div>
      </div>
    </div>
  );
};

export const ReturnsBreakagesView: React.FC = () => {
  const { snapshot, mutateApi, hasPerm, notify, activeWarehouseId, selectedWarehouseId, currentUser, canViewFinancials } = useErp();
  const [type, setType] = useState<ReturnBreakageRecord['type']>('CASSE_COULAGE');
  const [packagingId, setPackagingId] = useState('pkg-bock-33');
  const [qtyPacks, setQtyPacks] = useState(0);
  const [qtyBottles, setQtyBottles] = useState(4);
  const [reason, setReason] = useState('Bouteilles cassées lors de la manutention en chambre');
  const [settlement, setSettlement] = useState<ReturnBreakageRecord['settlement']>('PERTE_SECHE');
  const [photoDataUrl, setPhotoDataUrl] = useState<string>('');
  const [rbSearch, setRbSearch] = useState('');
  const [rbTypeFilter, setRbTypeFilter] = useState<'ALL' | ReturnBreakageRecord['type']>('ALL');

  const isDriver = currentUser?.role === 'LIVREUR';
  const canRecordReturn = hasPerm(PERMISSIONS.STOCK_ADJUST) || hasPerm(PERMISSIONS.BREAKAGE_REPORT);

  const filteredReturns = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.returnsBreakages.filter((rb) => {
      if (selectedWarehouseId !== 'ALL' && rb.warehouseId && rb.warehouseId !== selectedWarehouseId) {
        return false;
      }
      if (rbTypeFilter !== 'ALL' && rb.type !== rbTypeFilter) return false;
      if (rbSearch.trim()) {
        const q = rbSearch.toLowerCase();
        const p = snapshot.packagings.find((x) => x.id === rb.packagingId);
        return (
          rb.docNumber.toLowerCase().includes(q) ||
          rb.reason.toLowerCase().includes(q) ||
          (p?.label.toLowerCase().includes(q) ?? false)
        );
      }
      return true;
    });
  }, [snapshot, selectedWarehouseId, rbSearch, rbTypeFilter]);

  const rbPagination = usePagination(filteredReturns, 8);

  if (!snapshot) return null;

  const pkg = snapshot.packagings.find((p) => p.id === packagingId);
  const estimatedImpact = pkg
    ? qtyPacks * pkg.purchasePrice + qtyBottles * Math.round(pkg.purchasePrice / Math.max(1, pkg.unitsPerPack))
    : 0;

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setPhotoDataUrl(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isDriver && !photoDataUrl) {
      notify('warning', 'Une photo justificative est obligatoire pour toute déclaration livreur.');
      return;
    }
    const res = await mutateApi<{ record?: ReturnBreakageRecord }>('/api/returns-breakages', 'POST', {
      warehouseId: activeWarehouseId,
      type,
      customerId: type === 'RETOUR_CLIENT' ? 'cust-privilege' : null,
      supplierId: type === 'RETOUR_FOURNISSEUR' ? 'sup-solibra' : null,
      packagingId,
      qtyPacks,
      qtyBottles,
      financialImpact: estimatedImpact,
      reason,
      photoDataUrl: photoDataUrl || null,
      settlement,
    });
    if (res) {
      notify(
        isDriver ? 'warning' : 'success',
        isDriver
          ? 'Incident enregistré et transmis au Gérant pour validation.'
          : 'Déclaration enregistrée et validée.'
      );
      setPhotoDataUrl('');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
          Retours, Avoirs & Casse / Coulage
        </h1>
        <p className="text-xs text-slate-500">
          {isDriver
            ? 'Déclaration terrain avec preuve photo obligatoire · Validation requise par le Gérant'
            : 'Traçabilité des avaries, réclamations brasseries, avoirs clients et pertes sèches'}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <form
          onSubmit={handleSubmit}
          className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 lg:col-span-4 dark:border-slate-800 dark:bg-slate-900"
        >
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
            <Plus className="h-4 w-4 text-emerald-700" />
            <h2 className="text-base font-bold">Déclarer un incident / retour</h2>
          </div>
          <select value={type} onChange={(e) => setType(e.target.value as ReturnBreakageRecord['type'])} className="min-h-[40px] w-full rounded-lg border border-slate-200 px-3 text-sm dark:border-slate-700 dark:bg-slate-800">
            <option value="CASSE_COULAGE">Casse / Coulage {isDriver ? 'tournée' : 'dépôt'}</option>
            <option value="RETOUR_CLIENT">Retour client (produit défectueux)</option>
            {!isDriver && <option value="RETOUR_FOURNISSEUR">Réclamation brasserie (avarie)</option>}
          </select>
          <select value={packagingId} onChange={(e) => setPackagingId(e.target.value)} className="min-h-[40px] w-full rounded-lg border border-slate-200 px-3 text-sm dark:border-slate-700 dark:bg-slate-800">
            {snapshot.packagings.filter((p) => !p.deletedAt).map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] text-slate-500">Colis / Casiers</label>
              <input type="number" min={0} value={qtyPacks} onChange={(e) => setQtyPacks(Number(e.target.value))} className="mt-1 min-h-[40px] w-full rounded-lg border border-slate-200 px-3 font-mono text-sm dark:border-slate-700 dark:bg-slate-800" />
            </div>
            <div>
              <label className="text-[11px] text-slate-500">Bouteilles isolées</label>
              <input type="number" min={0} value={qtyBottles} onChange={(e) => setQtyBottles(Number(e.target.value))} className="mt-1 min-h-[40px] w-full rounded-lg border border-slate-200 px-3 font-mono text-sm dark:border-slate-700 dark:bg-slate-800" />
            </div>
          </div>
          <select value={settlement} onChange={(e) => setSettlement(e.target.value as ReturnBreakageRecord['settlement'])} className="min-h-[40px] w-full rounded-lg border border-slate-200 px-3 text-sm dark:border-slate-700 dark:bg-slate-800">
            <option value="PERTE_SECHE">Perte sèche</option>
            <option value="AVOIR">Avoir client</option>
            <option value="REMBOURSEMENT">Remboursement</option>
            {!isDriver && <option value="RECLAMATION">Réclamation fournisseur</option>}
          </select>
          <input required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motif & justificatif" className="min-h-[40px] w-full rounded-lg border border-slate-200 px-3 text-sm dark:border-slate-700 dark:bg-slate-800" />

          <div>
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2.5 text-xs font-semibold text-slate-700 hover:border-emerald-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
              <Camera className="h-4 w-4 text-emerald-700" />
              {photoDataUrl
                ? 'Photo justificative jointe (modifier)'
                : isDriver
                ? 'Joindre photo obligatoire *'
                : 'Joindre photo (optionnel)'}
              <input type="file" accept="image/*" capture="environment" onChange={handlePhotoUpload} className="hidden" />
            </label>
          </div>

          {canViewFinancials && (
            <p className="font-mono text-xs font-semibold text-red-700 tabular-nums">
              Impact valorisé : {formatFCFA(estimatedImpact)}
            </p>
          )}
          <button
            type="submit"
            disabled={!canRecordReturn}
            className="min-h-[44px] w-full rounded-lg bg-emerald-700 text-xs font-semibold text-white disabled:opacity-50"
          >
            {canRecordReturn ? 'Enregistrer la déclaration' : 'Consultation uniquement (Propriétaire)'}
          </button>
        </form>

        <div className="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-8 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-bold">Registre des retours & casses</h2>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={rbSearch}
                  onChange={(e) => setRbSearch(e.target.value)}
                  placeholder="Pièce, produit, motif..."
                  className="min-h-[36px] rounded-lg border border-slate-200 bg-white pl-8 pr-3 text-xs dark:border-slate-700 dark:bg-slate-800"
                />
              </div>
              <select
                value={rbTypeFilter}
                onChange={(e) => setRbTypeFilter(e.target.value as 'ALL' | ReturnBreakageRecord['type'])}
                className="min-h-[36px] rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold dark:border-slate-700 dark:bg-slate-800"
              >
                <option value="ALL">Tous types</option>
                <option value="CASSE_COULAGE">Casse / Coulage</option>
                <option value="RETOUR_CLIENT">Retour client</option>
                <option value="RETOUR_FOURNISSEUR">Retour brasserie</option>
              </select>
              {(rbSearch || rbTypeFilter !== 'ALL') && (
                <button
                  type="button"
                  onClick={() => {
                    setRbSearch('');
                    setRbTypeFilter('ALL');
                  }}
                  title="Réinitialiser"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:text-red-600 dark:border-slate-700"
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
                  <th className="py-2">Pièce</th>
                  <th className="py-2">Type · Statut</th>
                  <th className="py-2">Produit</th>
                  <th className="py-2">Motif</th>
                  {canViewFinancials && <th className="py-2 text-right">Impact</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {rbPagination.paginatedItems.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-xs text-slate-400">
                      Aucun incident ou retour enregistré.
                    </td>
                  </tr>
                ) : (
                  rbPagination.paginatedItems.map((rb) => {
                    const p = snapshot.packagings.find((x) => x.id === rb.packagingId);
                    return (
                      <tr key={rb.id} className="h-10">
                        <td className="py-2 font-mono text-xs font-semibold">{rb.docNumber}</td>
                        <td className="py-2 text-xs">
                          <span className="font-medium">{rb.type}</span>
                          <span
                            className={`ml-1.5 font-semibold ${
                              rb.status === 'EN_ATTENTE' ? 'text-amber-700' : 'text-emerald-700'
                            }`}
                          >
                            · {rb.status}
                          </span>
                        </td>
                        <td className="py-2 text-xs">{p?.label} ({rb.qtyPacks} col / {rb.qtyBottles} btl)</td>
                        <td className="py-2 text-xs text-slate-600 dark:text-slate-400">
                          {rb.reason}
                          {rb.photoDataUrl && <span className="ml-1.5 text-[11px] font-semibold text-emerald-700">[Photo jointe]</span>}
                        </td>
                        {canViewFinancials && (
                          <td className="py-2 text-right font-mono font-semibold text-red-600 tabular-nums">
                            {formatFCFA(rb.financialImpact)}
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
            page={rbPagination.page}
            totalPages={rbPagination.totalPages}
            pageSize={rbPagination.pageSize}
            totalItems={rbPagination.totalItems}
            startIndex={rbPagination.startIndex}
            endIndex={rbPagination.endIndex}
            onPageChange={rbPagination.setPage}
            onPageSizeChange={rbPagination.setPageSize}
            itemLabel="déclarations"
          />
        </div>
      </div>
    </div>
  );
};
