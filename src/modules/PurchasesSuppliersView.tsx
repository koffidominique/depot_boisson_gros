import React, { useMemo, useState } from 'react';
import { Check, FileCheck2, Plus, Search, X } from 'lucide-react';
import { TablePagination, usePagination } from '../components/TablePagination';
import { useErp } from '../context/ErpContext';
import { formatDateFR, formatDateTimeFR, formatFCFA, formatNumberFR } from '../lib/format';
import { PERMISSIONS, type PurchaseOrder } from '../types/erp';

export const PurchasesView: React.FC = () => {
  const { snapshot, mutateApi, hasPerm, notify, activeWarehouseId, selectedWarehouseId } = useErp();
  const [showNewPo, setShowNewPo] = useState(false);
  const [supplierId, setSupplierId] = useState('sup-solibra');
  const [pkgId, setPkgId] = useState('pkg-bock-33');
  const [qtyOrdered, setQtyOrdered] = useState(50);

  // Filters
  const [poSearch, setPoSearch] = useState('');
  const [poStatus, setPoStatus] = useState<'ALL' | PurchaseOrder['status']>('ALL');
  const [grSearch, setGrSearch] = useState('');

  // Reception wizard
  const [receivingPo, setReceivingPo] = useState<PurchaseOrder | null>(null);
  const [supplierBl, setSupplierBl] = useState('');
  const [recvLines, setRecvLines] = useState<
    Record<string, { qtyReceived: number; discrepancyReason: string; emptyCratesReturnedToSupplier: number }>
  >({});

  const filteredPOs = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.purchaseOrders.filter((po) => {
      if (selectedWarehouseId !== 'ALL' && po.warehouseId !== selectedWarehouseId) return false;
      if (poStatus !== 'ALL' && po.status !== poStatus) return false;
      if (poSearch.trim()) {
        const q = poSearch.toLowerCase();
        const sup = snapshot.suppliers.find((s) => s.id === po.supplierId);
        return (
          po.docNumber.toLowerCase().includes(q) ||
          (sup?.name.toLowerCase().includes(q) ?? false) ||
          (sup?.code.toLowerCase().includes(q) ?? false)
        );
      }
      return true;
    });
  }, [snapshot, selectedWarehouseId, poSearch, poStatus]);

  const filteredGRs = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.goodsReceipts.filter((gr) => {
      if (selectedWarehouseId !== 'ALL' && gr.warehouseId !== selectedWarehouseId) return false;
      if (!grSearch.trim()) return true;
      const q = grSearch.toLowerCase();
      return gr.docNumber.toLowerCase().includes(q) || gr.supplierBlNumber.toLowerCase().includes(q);
    });
  }, [snapshot, selectedWarehouseId, grSearch]);

  const poPagination = usePagination(filteredPOs, 5);
  const grPagination = usePagination(filteredGRs, 5);

  if (!snapshot) return null;

  const handleCreatePo = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await mutateApi('/api/purchase-orders', 'POST', {
      supplierId,
      warehouseId: activeWarehouseId,
      expectedDate: new Date().toISOString(),
      lines: [{ packagingId: pkgId, qtyOrdered }],
    });
    if (res) {
      notify('success', 'Bon de commande fournisseur émis.');
      setShowNewPo(false);
    }
  };

  const openReception = (po: PurchaseOrder) => {
    const init: Record<string, { qtyReceived: number; discrepancyReason: string; emptyCratesReturnedToSupplier: number }> = {};
    po.lines.forEach((l) => {
      init[l.packagingId] = {
        qtyReceived: l.qtyOrdered,
        discrepancyReason: '',
        emptyCratesReturnedToSupplier: l.depositPerCrate > 0 ? l.qtyOrdered : 0,
      };
    });
    setRecvLines(init);
    setSupplierBl(`SOL-BL-${Date.now().toString().slice(-5)}`);
    setReceivingPo(po);
  };

  const handleConfirmReception = async () => {
    if (!receivingPo) return;
    const lines = receivingPo.lines.map((l) => ({
      packagingId: l.packagingId,
      ...(recvLines[l.packagingId] || {
        qtyReceived: l.qtyOrdered,
        discrepancyReason: '',
        emptyCratesReturnedToSupplier: 0,
      }),
    }));
    const res = await mutateApi('/api/goods-receipts', 'POST', {
      purchaseOrderId: receivingPo.id,
      supplierBlNumber: supplierBl,
      lines,
    });
    if (res) {
      notify('success', 'Réception BL brasserie enregistrée · Stock & consignes mis à jour.');
      setReceivingPo(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            Achats & Réceptions Brasseries
          </h1>
          <p className="text-xs text-slate-500">
            Bons de commande (BDC), contrôle des BL fournisseurs, écarts de livraison & reprise casiers vides
          </p>
        </div>
        {hasPerm(PERMISSIONS.PURCHASE_RECEIVE) && (
          <button
            type="button"
            onClick={() => setShowNewPo((v) => !v)}
            className="inline-flex min-h-[42px] items-center gap-1.5 rounded-lg bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800 whitespace-nowrap shrink-0"
          >
            <Plus className="h-4 w-4" />
            Nouveau BDC Brasserie
          </button>
        )}
      </div>

      {showNewPo && (
        <form
          onSubmit={handleCreatePo}
          className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-5 sm:grid-cols-4 dark:border-slate-800 dark:bg-slate-900"
        >
          <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="min-h-[42px] rounded-lg border border-slate-200 px-3 text-sm dark:border-slate-700 dark:bg-slate-800">
            {snapshot.suppliers.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <select value={pkgId} onChange={(e) => setPkgId(e.target.value)} className="min-h-[42px] rounded-lg border border-slate-200 px-3 text-sm dark:border-slate-700 dark:bg-slate-800">
            {snapshot.packagings.filter((p) => !p.deletedAt).map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
          <input type="number" min={1} value={qtyOrdered} onChange={(e) => setQtyOrdered(Number(e.target.value))} className="min-h-[42px] rounded-lg border border-slate-200 px-3 font-mono text-sm dark:border-slate-700 dark:bg-slate-800" />
          <button type="submit" className="min-h-[42px] rounded-lg bg-emerald-700 px-4 text-xs font-semibold text-white">
            Émettre le BDC
          </button>
        </form>
      )}

      {receivingPo && (
        <div className="rounded-xl border border-emerald-300 bg-white p-5 dark:border-emerald-800 dark:bg-slate-900">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3 dark:border-slate-800">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                Réception BL Brasserie · {receivingPo.docNumber}
              </h2>
              <p className="text-xs text-slate-500">Saisissez les quantités réelles déchargées et les casiers vides rendus au camion</p>
            </div>
            <input
              type="text"
              value={supplierBl}
              onChange={(e) => setSupplierBl(e.target.value)}
              placeholder="N° BL Brasserie"
              className="min-h-[38px] rounded-lg border border-slate-200 px-3 font-mono text-xs dark:border-slate-700 dark:bg-slate-800"
            />
          </div>

          <div className="mt-4 space-y-3">
            {receivingPo.lines.map((l) => {
              const pkg = snapshot.packagings.find((p) => p.id === l.packagingId);
              const val = recvLines[l.packagingId];
              if (!val) return null;
              return (
                <div key={l.packagingId} className="grid grid-cols-1 gap-3 rounded-lg bg-slate-50 p-3 sm:grid-cols-5 dark:bg-slate-800">
                  <div className="sm:col-span-2">
                    <p className="text-sm font-semibold">{pkg?.label}</p>
                    <p className="font-mono text-xs text-slate-500">Commandé : {l.qtyOrdered}</p>
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-500">Qté reçue</label>
                    <input
                      type="number"
                      min={0}
                      value={val.qtyReceived}
                      onChange={(e) =>
                        setRecvLines((prev) => ({
                          ...prev,
                          [l.packagingId]: { ...val, qtyReceived: Number(e.target.value) },
                        }))
                      }
                      className="mt-0.5 w-full rounded border border-slate-200 bg-white px-2 py-1.5 font-mono text-sm dark:border-slate-700 dark:bg-slate-900"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-500">Vides rendus brasserie</label>
                    <input
                      type="number"
                      min={0}
                      value={val.emptyCratesReturnedToSupplier}
                      onChange={(e) =>
                        setRecvLines((prev) => ({
                          ...prev,
                          [l.packagingId]: { ...val, emptyCratesReturnedToSupplier: Number(e.target.value) },
                        }))
                      }
                      className="mt-0.5 w-full rounded border border-slate-200 bg-white px-2 py-1.5 font-mono text-sm dark:border-slate-700 dark:bg-slate-900"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-500">Motif écart (si écart)</label>
                    <input
                      type="text"
                      value={val.discrepancyReason}
                      onChange={(e) =>
                        setRecvLines((prev) => ({
                          ...prev,
                          [l.packagingId]: { ...val, discrepancyReason: e.target.value },
                        }))
                      }
                      placeholder="Ex: Casse quai"
                      className="mt-0.5 w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900"
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setReceivingPo(null)} className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold">Annuler</button>
            <button type="button" onClick={handleConfirmReception} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-4 py-2 text-xs font-semibold text-white">
              <Check className="h-4 w-4" />
              Valider la réception
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">Bons de commande fournisseurs</h2>
            <div className="flex items-center gap-1.5">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={poSearch}
                  onChange={(e) => setPoSearch(e.target.value)}
                  placeholder="N° BDC, brasserie..."
                  className="min-h-[34px] w-36 rounded-lg border border-slate-200 bg-white pl-8 pr-2 text-xs dark:border-slate-700 dark:bg-slate-800"
                />
              </div>
              <select
                value={poStatus}
                onChange={(e) => setPoStatus(e.target.value as 'ALL' | PurchaseOrder['status'])}
                className="min-h-[34px] rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold dark:border-slate-700 dark:bg-slate-800"
              >
                <option value="ALL">Tous</option>
                <option value="BROUILLON">Brouillon</option>
                <option value="ENVOYE">Envoyé</option>
                <option value="PARTIEL">Partiel</option>
                <option value="RECU">Reçu</option>
              </select>
              {(poSearch || poStatus !== 'ALL') && (
                <button
                  type="button"
                  onClick={() => {
                    setPoSearch('');
                    setPoStatus('ALL');
                  }}
                  className="inline-flex h-[34px] w-[34px] items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:text-red-600 dark:border-slate-700"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
          <div className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
            {poPagination.paginatedItems.length === 0 ? (
              <p className="py-6 text-center text-xs text-slate-400">Aucun BDC correspondant.</p>
            ) : (
              poPagination.paginatedItems.map((po) => {
                const sup = snapshot.suppliers.find((s) => s.id === po.supplierId);
                return (
                  <div key={po.id} className="flex items-center justify-between py-3">
                    <div>
                      <p className="font-mono text-sm font-bold text-slate-900 dark:text-white">
                        {po.docNumber} · <span className="font-sans font-semibold">{sup?.code}</span>
                      </p>
                      <p className="text-xs text-slate-500 tabular-nums">
                        {formatDateFR(po.createdAt)} · Liquide : {formatFCFA(po.totalLiquid)} · Cautions : {formatFCFA(po.totalDeposit)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-slate-600">{po.status}</span>
                      {po.status !== 'RECU' && hasPerm(PERMISSIONS.PURCHASE_RECEIVE) && (
                        <button
                          type="button"
                          onClick={() => openReception(po)}
                          className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 whitespace-nowrap shrink-0"
                        >
                          Réceptionner BL
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
          <TablePagination
            page={poPagination.page}
            totalPages={poPagination.totalPages}
            pageSize={poPagination.pageSize}
            totalItems={poPagination.totalItems}
            startIndex={poPagination.startIndex}
            endIndex={poPagination.endIndex}
            onPageChange={poPagination.setPage}
            onPageSizeChange={poPagination.setPageSize}
            itemLabel="BDC"
          />
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">Historique réceptions & écarts BL</h2>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={grSearch}
                onChange={(e) => setGrSearch(e.target.value)}
                placeholder="N° réception ou BL..."
                className="min-h-[34px] w-44 rounded-lg border border-slate-200 bg-white pl-8 pr-2 text-xs dark:border-slate-700 dark:bg-slate-800"
              />
            </div>
          </div>
          <div className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
            {grPagination.paginatedItems.length === 0 ? (
              <p className="py-6 text-center text-xs text-slate-400">Aucune réception correspondante.</p>
            ) : (
              grPagination.paginatedItems.map((gr) => (
                <div key={gr.id} className="py-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-bold">{gr.docNumber} (BL {gr.supplierBlNumber})</span>
                    <span className="text-xs text-slate-500 tabular-nums">{formatDateTimeFR(gr.createdAt)}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-600 tabular-nums dark:text-slate-400">
                    Reçus : {gr.cratesReceived} · Vides rendus : {gr.cratesReturnedToSupplier} · Variation caution : {formatFCFA(gr.netDepositChange)}
                  </p>
                  {gr.lines.some((l) => l.discrepancyQty !== 0) && (
                    <p className="mt-1 text-xs font-medium text-amber-700">
                      Écart signalé : {gr.lines.filter((l) => l.discrepancyQty !== 0).map((l) => `${l.discrepancyQty} (${l.discrepancyReason})`).join(', ')}
                    </p>
                  )}
                </div>
              ))
            )}
          </div>
          <TablePagination
            page={grPagination.page}
            totalPages={grPagination.totalPages}
            pageSize={grPagination.pageSize}
            totalItems={grPagination.totalItems}
            startIndex={grPagination.startIndex}
            endIndex={grPagination.endIndex}
            onPageChange={grPagination.setPage}
            onPageSizeChange={grPagination.setPageSize}
            itemLabel="réceptions"
          />
        </div>
      </div>
    </div>
  );
};

export const SuppliersView: React.FC = () => {
  const { snapshot, mutateApi, hasPerm, notify, activeWarehouseId } = useErp();
  const [name, setName] = useState('');
  const [contactName, setContactName] = useState('');
  const [phone, setPhone] = useState('');
  const [showAdd, setShowAdd] = useState(false);

  // Monthly reconciliation PV state
  const [externalBrasserieCrates, setExternalBrasserieCrates] = useState(645);
  const [notes, setNotes] = useState('Rapprochement mensuel factures, BL et état des casiers Solibra/Brassivoire.');

  if (!snapshot) return null;

  const totalSystemCrates = snapshot.suppliers.reduce((s, sup) => s + sup.cratesHeldFromSupplier, 0);

  const handleCreateSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await mutateApi('/api/suppliers', 'POST', { name, contactName, phone, paymentTermsDays: 15 });
    if (res) {
      notify('success', 'Brasserie / fournisseur enregistré.');
      setShowAdd(false);
      setName('');
    }
  };

  const handleSignMonthlyPV = async () => {
    const res = await mutateApi('/api/reconciliations', 'POST', {
      warehouseId: activeWarehouseId,
      type: 'MENSUELLE_BRASSERIE',
      periodLabel: `Rapprochement Brasserie ${new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}`,
      systemValue: totalSystemCrates,
      physicalOrExternalValue: externalBrasserieCrates,
      notes,
    });
    if (res) notify('success', 'PV de rapprochement mensuel brasserie signé et archivé.');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            Fournisseurs / Brasseries & Rapprochement Mensuel
          </h1>
          <p className="text-xs text-slate-500">Solibra, Brassivoire · Solde d’emballages consignés et PV de réconciliation</p>
        </div>
        {hasPerm(PERMISSIONS.PURCHASE_RECEIVE) && (
          <button
            type="button"
            onClick={() => setShowAdd((v) => !v)}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-emerald-700 px-3.5 py-2 text-xs font-semibold text-white whitespace-nowrap shrink-0"
          >
            <Plus className="h-4 w-4" />
            Ajouter fournisseur
          </button>
        )}
      </div>

      {showAdd && (
        <form onSubmit={handleCreateSupplier} className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-4 dark:border-slate-800 dark:bg-slate-900">
          <input required placeholder="Nom brasserie" value={name} onChange={(e) => setName(e.target.value)} className="min-h-[40px] rounded-lg border border-slate-200 px-3 text-sm dark:border-slate-700 dark:bg-slate-800" />
          <input placeholder="Contact commercial" value={contactName} onChange={(e) => setContactName(e.target.value)} className="min-h-[40px] rounded-lg border border-slate-200 px-3 text-sm dark:border-slate-700 dark:bg-slate-800" />
          <input placeholder="Téléphone" value={phone} onChange={(e) => setPhone(e.target.value)} className="min-h-[40px] rounded-lg border border-slate-200 px-3 text-sm dark:border-slate-700 dark:bg-slate-800" />
          <button type="submit" className="min-h-[40px] rounded-lg bg-emerald-700 px-4 text-xs font-semibold text-white">Enregistrer</button>
        </form>
      )}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {snapshot.suppliers.map((s) => (
          <div key={s.id} className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start justify-between">
              <div>
                <p className="font-mono text-xs text-slate-500">{s.code} · Délai {s.paymentTermsDays} jours</p>
                <h2 className="mt-0.5 text-lg font-bold text-slate-900 dark:text-white">{s.name}</h2>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">{s.contactName} · {s.phone}</p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4 dark:border-slate-800">
              <div>
                <p className="text-xs text-slate-500">Casiers dus à la brasserie</p>
                <p className="font-mono text-xl font-bold text-slate-900 tabular-nums dark:text-white">
                  {formatNumberFR(s.cratesHeldFromSupplier)} casiers
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Cautions versées</p>
                <p className="font-mono text-xl font-bold text-emerald-700 tabular-nums dark:text-emerald-400">
                  {formatFCFA(s.depositPaidToSupplier)}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Monthly Brewery Reconciliation */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-2">
          <FileCheck2 className="h-5 w-5 text-emerald-700" />
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            Rapprochement mensuel global avec les brasseries (PV signé)
          </h2>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800">
            <p className="text-xs text-slate-500">Solde casiers système (GestDepot)</p>
            <p className="mt-1 font-mono text-lg font-bold tabular-nums">{formatNumberFR(totalSystemCrates)} casiers</p>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600">Relevé contradictoire brasserie (casiers)</label>
            <input
              type="number"
              value={externalBrasserieCrates}
              onChange={(e) => setExternalBrasserieCrates(Number(e.target.value))}
              className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-200 px-3 font-mono text-sm font-bold tabular-nums dark:border-slate-700 dark:bg-slate-800"
            />
          </div>
          <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800">
            <p className="text-xs text-slate-500">Écart constaté</p>
            <p className={`mt-1 font-mono text-lg font-bold tabular-nums ${externalBrasserieCrates !== totalSystemCrates ? 'text-amber-700' : 'text-emerald-700'}`}>
              {externalBrasserieCrates - totalSystemCrates} casiers
            </p>
          </div>
        </div>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row">
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="min-h-[42px] flex-1 rounded-lg border border-slate-200 px-3 text-sm dark:border-slate-700 dark:bg-slate-800"
          />
          <button
            type="button"
            disabled={!hasPerm(PERMISSIONS.RECONCILIATION_SIGN)}
            onClick={handleSignMonthlyPV}
            className="min-h-[42px] rounded-lg bg-emerald-700 px-4 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
          >
            Signer PV Mensuel Brasserie
          </button>
        </div>
      </div>
    </div>
  );
};
