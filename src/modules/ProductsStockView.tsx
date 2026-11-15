import React, { useEffect, useMemo, useState } from 'react';
import { ClipboardCheck, Download, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { TablePagination, usePagination } from '../components/TablePagination';
import { useErp } from '../context/ErpContext';
import { exportToCsv, formatDateFR, formatFCFA, formatNumberFR } from '../lib/format';
import { PERMISSIONS, type InventorySession, type Packaging, type PackagingType, type ProductCategory } from '../types/erp';

export const ProductsView: React.FC = () => {
  const {
    snapshot,
    mutateApi,
    hasPerm,
    notify,
    navHint,
    clearNavHint,
    activeWarehouseId,
    selectedWarehouseId,
    canViewFinancials,
  } = useErp();
  const [search, setSearch] = useState('');
  const [cat, setCat] = useState<'ALL' | ProductCategory>('ALL');
  const [pkgTypeFilter, setPkgTypeFilter] = useState<'ALL' | PackagingType>('ALL');
  const [supplierFilter, setSupplierFilter] = useState<'ALL' | string>('ALL');
  const [stockAlertOnly, setStockAlertOnly] = useState(false);
  const [showForm, setShowForm] = useState(false);

  // Price editing modal (Propriétaire only: PERMISSIONS.PRICE_UPDATE)
  const [editingPkg, setEditingPkg] = useState<Packaging | null>(null);
  const [editPurchase, setEditPurchase] = useState(0);
  const [editGros, setEditGros] = useState(0);
  const [editSemiGros, setEditSemiGros] = useState(0);
  const [editDetail, setEditDetail] = useState(0);
  const [editDeposit, setEditDeposit] = useState(0);

  useEffect(() => {
    if (navHint?.searchQuery) {
      setSearch(navHint.searchQuery);
      clearNavHint();
    }
  }, [navHint, clearNavHint]);

  const [name, setName] = useState('');
  const [brand, setBrand] = useState('Solibra');
  const [supplierId, setSupplierId] = useState('sup-solibra');
  const [category, setCategory] = useState<ProductCategory>('BIERE');
  const [volumeLabel, setVolumeLabel] = useState('33cl');
  const [sku, setSku] = useState('');
  const [label, setLabel] = useState('');
  const [packagingType, setPackagingType] = useState<PackagingType>('CASIER_CONSIGNE');
  const [unitsPerPack, setUnitsPerPack] = useState(24);
  const [depositPerCrate, setDepositPerCrate] = useState(3000);
  const [purchasePrice, setPurchasePrice] = useState(8000);
  const [salePriceDetail, setSalePriceDetail] = useState(10200);
  const [salePriceSemiGros, setSalePriceSemiGros] = useState(9600);
  const [salePriceGros, setSalePriceGros] = useState(9200);
  const [initialQty, setInitialQty] = useState(20);

  const rows = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.packagings
      .filter((p) => !p.deletedAt)
      .map((pkg) => {
        const prod = snapshot.products.find((pr) => pr.id === pkg.productId);
        const scopedStocks = snapshot.stocks.filter(
          (s) =>
            s.packagingId === pkg.id &&
            (selectedWarehouseId === 'ALL' || s.warehouseId === selectedWarehouseId)
        );
        const qtyOnHand = scopedStocks.reduce((sum, s) => sum + s.qtyOnHand, 0);
        return { pkg, prod, qtyOnHand };
      })
      .filter(({ pkg, prod, qtyOnHand }) => {
        if (!prod || prod.deletedAt) return false;
        if (cat !== 'ALL' && prod.category !== cat) return false;
        if (pkgTypeFilter !== 'ALL' && pkg.packagingType !== pkgTypeFilter) return false;
        if (supplierFilter !== 'ALL' && prod.supplierId !== supplierFilter) return false;
        if (stockAlertOnly && qtyOnHand > pkg.alertThreshold) return false;
        if (search.trim()) {
          const q = search.toLowerCase();
          return (
            pkg.label.toLowerCase().includes(q) ||
            pkg.sku.toLowerCase().includes(q) ||
            prod.brand.toLowerCase().includes(q) ||
            prod.name.toLowerCase().includes(q)
          );
        }
        return true;
      });
  }, [snapshot, selectedWarehouseId, cat, pkgTypeFilter, supplierFilter, stockAlertOnly, search]);

  const pagination = usePagination(rows, 8);

  if (!snapshot) return null;

  const hasFilters =
    Boolean(search.trim()) ||
    cat !== 'ALL' ||
    pkgTypeFilter !== 'ALL' ||
    supplierFilter !== 'ALL' ||
    stockAlertOnly;

  const resetFilters = () => {
    setSearch('');
    setCat('ALL');
    setPkgTypeFilter('ALL');
    setSupplierFilter('ALL');
    setStockAlertOnly(false);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const isReturnable = packagingType === 'CASIER_CONSIGNE';
    const res = await mutateApi('/api/products', 'POST', {
      name,
      brand,
      supplierId,
      category,
      volumeLabel,
      warehouseId: activeWarehouseId,
      initialQty,
      packaging: {
        sku: sku || `SKU-${Date.now().toString().slice(-4)}`,
        label: label || `${name} ${volumeLabel}`,
        packagingType,
        unitsPerPack,
        isReturnable,
        depositPerCrate: isReturnable ? depositPerCrate : 0,
        depositPerBottle: isReturnable ? Math.round(depositPerCrate / Math.max(1, unitsPerPack)) : 0,
        purchasePrice,
        salePriceDetail,
        salePriceSemiGros,
        salePriceGros,
        alertThreshold: 20,
        dlcRequired: true,
      },
    });
    if (res) {
      notify('success', 'Produit & conditionnement ajoutés.');
      setShowForm(false);
      setName('');
      setSku('');
      setLabel('');
    }
  };

  const openPriceEditor = (pkg: Packaging) => {
    setEditingPkg(pkg);
    setEditPurchase(pkg.purchasePrice);
    setEditGros(pkg.salePriceGros);
    setEditSemiGros(pkg.salePriceSemiGros);
    setEditDetail(pkg.salePriceDetail);
    setEditDeposit(pkg.depositPerCrate);
  };

  const handleSavePrice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPkg) return;
    const res = await mutateApi(`/api/packagings/${editingPkg.id}`, 'PATCH', {
      purchasePrice: editPurchase,
      salePriceGros: editGros,
      salePriceSemiGros: editSemiGros,
      salePriceDetail: editDetail,
      depositPerCrate: editingPkg.isReturnable ? editDeposit : 0,
      depositPerBottle: editingPkg.isReturnable
        ? Math.round(editDeposit / Math.max(1, editingPkg.unitsPerPack))
        : 0,
    });
    if (res) {
      notify('success', `Tarifs mis à jour pour ${editingPkg.label}.`);
      setEditingPkg(null);
    }
  };

  const handleSoftDelete = async (productId: string, prodName: string) => {
    const res = await mutateApi(`/api/products/${productId}`, 'DELETE');
    if (res) notify('success', `Produit "${prodName}" archivé (soft-delete traçable).`);
  };

  const handleExport = () => {
    exportToCsv(
      'catalogue-conditionnements.csv',
      canViewFinancials
        ? ['SKU', 'Libellé', 'Marque', 'Type', 'Unités', 'Achat', 'Détail', 'Semi-Gros', 'Gros', 'Caution Casier', 'Stock']
        : ['SKU', 'Libellé', 'Marque', 'Type', 'Unités', 'Détail', 'Semi-Gros', 'Gros', 'Caution Casier', 'Stock'],
      rows.map(({ pkg, prod, qtyOnHand }) =>
        canViewFinancials
          ? [
              pkg.sku,
              pkg.label,
              prod?.brand || '',
              pkg.packagingType,
              pkg.unitsPerPack,
              pkg.purchasePrice,
              pkg.salePriceDetail,
              pkg.salePriceSemiGros,
              pkg.salePriceGros,
              pkg.depositPerCrate,
              qtyOnHand,
            ]
          : [
              pkg.sku,
              pkg.label,
              prod?.brand || '',
              pkg.packagingType,
              pkg.unitsPerPack,
              pkg.salePriceDetail,
              pkg.salePriceSemiGros,
              pkg.salePriceGros,
              pkg.depositPerCrate,
              qtyOnHand,
            ]
      )
    );
  };

  const showActionsCol = hasPerm(PERMISSIONS.PRICE_UPDATE) || hasPerm(PERMISSIONS.PRODUCT_UPDATE);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            Produits & Conditionnements
          </h1>
          <p className="text-xs text-slate-500">
            Modélisation multi-conditionnements (Casier verre consigné, Pack PET, Carton canettes) · Tarifs Gros / Semi-gros / Détail
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleExport}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 whitespace-nowrap shrink-0"
          >
            <Download className="h-3.5 w-3.5" />
            Exporter CSV
          </button>
          {hasPerm(PERMISSIONS.PRODUCT_CREATE) && (
            <button
              type="button"
              onClick={() => setShowForm((v) => !v)}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-emerald-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-800 whitespace-nowrap shrink-0"
            >
              <Plus className="h-4 w-4" />
              Nouveau conditionnement
            </button>
          )}
        </div>
      </div>

      {!hasPerm(PERMISSIONS.PRICE_UPDATE) && canViewFinancials && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-300">
          Consultation tarifs : la modification des prix de vente et consignes est strictement réservée au Propriétaire.
        </div>
      )}

      {showForm && (
        <form
          onSubmit={handleCreate}
          className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
        >
          <h2 className="text-base font-bold text-slate-900 dark:text-white">Ajouter un produit & conditionnement</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <input required placeholder="Nom produit (ex: Flag Spéciale)" value={name} onChange={(e) => setName(e.target.value)} className="min-h-[40px] rounded-lg border border-slate-200 px-3 text-sm dark:border-slate-700 dark:bg-slate-800" />
            <input placeholder="Marque (ex: Solibra)" value={brand} onChange={(e) => setBrand(e.target.value)} className="min-h-[40px] rounded-lg border border-slate-200 px-3 text-sm dark:border-slate-700 dark:bg-slate-800" />
            <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="min-h-[40px] rounded-lg border border-slate-200 px-3 text-sm dark:border-slate-700 dark:bg-slate-800">
              {snapshot.suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <select value={category} onChange={(e) => setCategory(e.target.value as ProductCategory)} className="min-h-[40px] rounded-lg border border-slate-200 px-3 text-sm dark:border-slate-700 dark:bg-slate-800">
              <option value="BIERE">Bière</option>
              <option value="SODA">Soda / Gazeux</option>
              <option value="EAU">Eau minérale</option>
              <option value="ENERGISANT">Énergisant</option>
              <option value="JUS_SIROP">Jus / Sirop</option>
            </select>
            <input required placeholder="Libellé colis (ex: Flag 65cl · Casier ×12)" value={label} onChange={(e) => setLabel(e.target.value)} className="min-h-[40px] rounded-lg border border-slate-200 px-3 text-sm sm:col-span-2 dark:border-slate-700 dark:bg-slate-800" />
            <input placeholder="Code SKU" value={sku} onChange={(e) => setSku(e.target.value)} className="min-h-[40px] rounded-lg border border-slate-200 px-3 font-mono text-sm dark:border-slate-700 dark:bg-slate-800" />
            <select value={packagingType} onChange={(e) => setPackagingType(e.target.value as PackagingType)} className="min-h-[40px] rounded-lg border border-slate-200 px-3 text-sm dark:border-slate-700 dark:bg-slate-800">
              <option value="CASIER_CONSIGNE">Casier verre consigné</option>
              <option value="PACK_PET">Pack PET perdu</option>
              <option value="CARTON_CANETTES">Carton canettes</option>
            </select>
            <div>
              <label className="text-[11px] text-slate-500">Prix achat</label>
              <input type="number" value={purchasePrice} onChange={(e) => setPurchasePrice(Number(e.target.value))} className="min-h-[40px] w-full rounded-lg border border-slate-200 px-3 font-mono text-sm dark:border-slate-700 dark:bg-slate-800" />
            </div>
            <div>
              <label className="text-[11px] text-slate-500">Prix Gros</label>
              <input type="number" value={salePriceGros} onChange={(e) => setSalePriceGros(Number(e.target.value))} className="min-h-[40px] w-full rounded-lg border border-slate-200 px-3 font-mono text-sm dark:border-slate-700 dark:bg-slate-800" />
            </div>
            <div>
              <label className="text-[11px] text-slate-500">Prix Semi-Gros</label>
              <input type="number" value={salePriceSemiGros} onChange={(e) => setSalePriceSemiGros(Number(e.target.value))} className="min-h-[40px] w-full rounded-lg border border-slate-200 px-3 font-mono text-sm dark:border-slate-700 dark:bg-slate-800" />
            </div>
            <div>
              <label className="text-[11px] text-slate-500">Prix Détail</label>
              <input type="number" value={salePriceDetail} onChange={(e) => setSalePriceDetail(Number(e.target.value))} className="min-h-[40px] w-full rounded-lg border border-slate-200 px-3 font-mono text-sm dark:border-slate-700 dark:bg-slate-800" />
            </div>
            <div>
              <label className="text-[11px] text-slate-500">Unités / colis</label>
              <input type="number" value={unitsPerPack} onChange={(e) => setUnitsPerPack(Number(e.target.value))} className="min-h-[40px] w-full rounded-lg border border-slate-200 px-3 font-mono text-sm dark:border-slate-700 dark:bg-slate-800" />
            </div>
            <div>
              <label className="text-[11px] text-slate-500">Caution casier (FCFA)</label>
              <input type="number" value={depositPerCrate} onChange={(e) => setDepositPerCrate(Number(e.target.value))} className="min-h-[40px] w-full rounded-lg border border-slate-200 px-3 font-mono text-sm dark:border-slate-700 dark:bg-slate-800" />
            </div>
            <div>
              <label className="text-[11px] text-slate-500">Stock initial</label>
              <input type="number" value={initialQty} onChange={(e) => setInitialQty(Number(e.target.value))} className="min-h-[40px] w-full rounded-lg border border-slate-200 px-3 font-mono text-sm dark:border-slate-700 dark:bg-slate-800" />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold">Annuler</button>
            <button type="submit" className="rounded-lg bg-emerald-700 px-4 py-2 text-xs font-semibold text-white">Enregistrer</button>
          </div>
        </form>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-4 grid grid-cols-1 gap-2.5 rounded-xl border border-slate-200/80 bg-slate-50/70 p-3 sm:grid-cols-2 lg:grid-cols-6 dark:border-slate-800 dark:bg-slate-800/40">
          <div className="relative lg:col-span-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher produit, SKU, marque..."
              className="min-h-[38px] w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-xs dark:border-slate-700 dark:bg-slate-900"
            />
          </div>
          <select
            value={cat}
            onChange={(e) => setCat(e.target.value as 'ALL' | ProductCategory)}
            className="min-h-[38px] rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold dark:border-slate-700 dark:bg-slate-900"
          >
            <option value="ALL">Toutes catégories</option>
            <option value="BIERE">Bières</option>
            <option value="SODA">Sodas</option>
            <option value="EAU">Eaux</option>
            <option value="ENERGISANT">Énergisants</option>
            <option value="JUS_SIROP">Jus / Sirops</option>
          </select>
          <select
            value={pkgTypeFilter}
            onChange={(e) => setPkgTypeFilter(e.target.value as 'ALL' | PackagingType)}
            className="min-h-[38px] rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold dark:border-slate-700 dark:bg-slate-900"
          >
            <option value="ALL">Tous conditionnements</option>
            <option value="CASIER_CONSIGNE">Casier consigné</option>
            <option value="PACK_PET">Pack PET perdu</option>
            <option value="CARTON_CANETTES">Carton canettes</option>
          </select>
          <select
            value={supplierFilter}
            onChange={(e) => setSupplierFilter(e.target.value)}
            className="min-h-[38px] rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold dark:border-slate-700 dark:bg-slate-900"
          >
            <option value="ALL">Toutes brasseries</option>
            {snapshot.suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setStockAlertOnly((v) => !v)}
              className={`min-h-[38px] flex-1 rounded-lg border px-2.5 text-xs font-semibold whitespace-nowrap ${
                stockAlertOnly
                  ? 'border-amber-500 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200'
                  : 'border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
              }`}
            >
              Stock critique
            </button>
            {hasFilters && (
              <button
                type="button"
                onClick={resetFilters}
                title="Réinitialiser les filtres"
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
                <th className="py-2.5">SKU · Conditionnement</th>
                <th className="py-2.5">Type</th>
                {canViewFinancials && <th className="py-2.5 text-right">Achat</th>}
                <th className="py-2.5 text-right">Gros</th>
                <th className="py-2.5 text-right">Semi-Gros</th>
                <th className="py-2.5 text-right">Détail</th>
                <th className="py-2.5 text-right">Caution</th>
                <th className="py-2.5 text-right">Stock</th>
                {showActionsCol && <th className="py-2.5 text-right">Action</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {pagination.paginatedItems.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-xs text-slate-400">
                    Aucun conditionnement ne correspond à ces critères.
                  </td>
                </tr>
              ) : (
                pagination.paginatedItems.map(({ pkg, prod, qtyOnHand }) => (
                  <tr key={pkg.id} className="h-11 hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                    <td className="py-2">
                      <p className="font-semibold text-slate-900 dark:text-white">{pkg.label}</p>
                      <p className="font-mono text-xs text-slate-500">{pkg.sku} · {prod?.brand}</p>
                    </td>
                    <td className="py-2 text-xs text-slate-600 dark:text-slate-400">
                      {pkg.isReturnable ? 'Verre consigné' : 'Emballage perdu'}
                    </td>
                    {canViewFinancials && (
                      <td className="py-2 text-right font-mono text-xs tabular-nums">{formatFCFA(pkg.purchasePrice)}</td>
                    )}
                    <td className="py-2 text-right font-mono text-xs tabular-nums">{formatFCFA(pkg.salePriceGros)}</td>
                    <td className="py-2 text-right font-mono text-xs tabular-nums">{formatFCFA(pkg.salePriceSemiGros)}</td>
                    <td className="py-2 text-right font-mono text-xs font-semibold tabular-nums">{formatFCFA(pkg.salePriceDetail)}</td>
                    <td className="py-2 text-right font-mono text-xs text-amber-700 tabular-nums">
                      {pkg.isReturnable ? formatFCFA(pkg.depositPerCrate) : '—'}
                    </td>
                    <td className="py-2 text-right font-mono font-bold tabular-nums">{qtyOnHand}</td>
                    {showActionsCol && (
                      <td className="py-2 text-right">
                        <div className="inline-flex items-center gap-1">
                          {hasPerm(PERMISSIONS.PRICE_UPDATE) && (
                            <button
                              type="button"
                              onClick={() => openPriceEditor(pkg)}
                              title="Modifier les tarifs (Propriétaire)"
                              className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 whitespace-nowrap"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              Tarifs
                            </button>
                          )}
                          {hasPerm(PERMISSIONS.PRODUCT_UPDATE) && (
                            <button
                              type="button"
                              onClick={() => handleSoftDelete(prod!.id, prod!.name)}
                              title="Archiver (soft-delete)"
                              className="p-1.5 text-slate-400 hover:text-red-600"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <TablePagination
          page={pagination.page}
          totalPages={pagination.totalPages}
          pageSize={pagination.pageSize}
          totalItems={pagination.totalItems}
          startIndex={pagination.startIndex}
          endIndex={pagination.endIndex}
          onPageChange={pagination.setPage}
          onPageSizeChange={pagination.setPageSize}
          itemLabel="références"
        />
      </div>

      {/* Price Edit Modal (Propriétaire only) */}
      {editingPkg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <form
            onSubmit={handleSavePrice}
            className="w-full max-w-md space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-800 dark:bg-slate-900"
          >
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                Modifier tarifs · {editingPkg.label}
              </h3>
              <p className="text-xs text-slate-500">Réservé au Propriétaire · Modification journalisée dans l’audit</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-slate-600">Prix achat</label>
                <input type="number" min={0} value={editPurchase} onChange={(e) => setEditPurchase(Number(e.target.value))} className="mt-1 min-h-[40px] w-full rounded-lg border border-slate-200 px-3 font-mono text-sm dark:border-slate-700 dark:bg-slate-800" />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600">Tarif Gros</label>
                <input type="number" min={0} value={editGros} onChange={(e) => setEditGros(Number(e.target.value))} className="mt-1 min-h-[40px] w-full rounded-lg border border-slate-200 px-3 font-mono text-sm dark:border-slate-700 dark:bg-slate-800" />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600">Tarif Semi-Gros</label>
                <input type="number" min={0} value={editSemiGros} onChange={(e) => setEditSemiGros(Number(e.target.value))} className="mt-1 min-h-[40px] w-full rounded-lg border border-slate-200 px-3 font-mono text-sm dark:border-slate-700 dark:bg-slate-800" />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600">Tarif Détail</label>
                <input type="number" min={0} value={editDetail} onChange={(e) => setEditDetail(Number(e.target.value))} className="mt-1 min-h-[40px] w-full rounded-lg border border-slate-200 px-3 font-mono text-sm dark:border-slate-700 dark:bg-slate-800" />
              </div>
              {editingPkg.isReturnable && (
                <div className="col-span-2">
                  <label className="text-xs font-semibold text-slate-600">Caution casier (FCFA)</label>
                  <input type="number" min={0} value={editDeposit} onChange={(e) => setEditDeposit(Number(e.target.value))} className="mt-1 min-h-[40px] w-full rounded-lg border border-slate-200 px-3 font-mono text-sm dark:border-slate-700 dark:bg-slate-800" />
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setEditingPkg(null)} className="min-h-[40px] rounded-lg border border-slate-200 px-4 text-xs font-semibold dark:border-slate-700">
                Annuler
              </button>
              <button type="submit" className="min-h-[40px] rounded-lg bg-emerald-700 px-4 text-xs font-semibold text-white hover:bg-emerald-800">
                Enregistrer les tarifs
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export const StockView: React.FC = () => {
  const { snapshot, mutateApi, hasPerm, notify, activeWarehouseId, selectedWarehouseId } = useErp();
  const [inventoryMode, setInventoryMode] = useState(false);
  const [scope, setScope] = useState<'TOURNANT' | 'GENERAL'>('TOURNANT');
  const [counts, setCounts] = useState<Record<string, { full: number; empty: number }>>({});
  const [stockSearch, setStockSearch] = useState('');
  const [stockStateFilter, setStockStateFilter] = useState<'ALL' | 'CRITIQUE' | 'NOMINAL'>('ALL');
  const [returnableOnly, setReturnableOnly] = useState(false);

  const scopedStocks = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.stocks.filter(
      (s) => selectedWarehouseId === 'ALL' || s.warehouseId === selectedWarehouseId
    );
  }, [snapshot, selectedWarehouseId]);

  const activeDepotStocks = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.stocks.filter((s) => s.warehouseId === activeWarehouseId);
  }, [snapshot, activeWarehouseId]);

  const filteredStocks = useMemo(() => {
    if (!snapshot) return [];
    return scopedStocks
      .map((s) => ({
        s,
        pkg: snapshot.packagings.find((p) => p.id === s.packagingId && !p.deletedAt),
      }))
      .filter(({ s, pkg }) => {
        if (!pkg) return false;
        const isLow = s.qtyOnHand <= pkg.alertThreshold;
        if (stockStateFilter === 'CRITIQUE' && !isLow) return false;
        if (stockStateFilter === 'NOMINAL' && isLow) return false;
        if (returnableOnly && !pkg.isReturnable) return false;
        if (stockSearch.trim()) {
          const q = stockSearch.toLowerCase();
          return (
            pkg.label.toLowerCase().includes(q) ||
            pkg.sku.toLowerCase().includes(q) ||
            s.lotNumber.toLowerCase().includes(q)
          );
        }
        return true;
      });
  }, [snapshot, scopedStocks, stockSearch, stockStateFilter, returnableOnly]);

  const stockPagination = usePagination(filteredStocks, 8);

  if (!snapshot) return null;

  const startInventory = () => {
    const initial: Record<string, { full: number; empty: number }> = {};
    activeDepotStocks.forEach((s) => {
      initial[s.packagingId] = { full: s.qtyOnHand, empty: s.emptyCratesOnHand };
    });
    setCounts(initial);
    setInventoryMode(true);
  };

  const submitInventory = async () => {
    const lines = Object.entries(counts).map(([packagingId, val]) => ({
      packagingId,
      physicalQty: val.full,
      emptyCratesPhysical: val.empty,
    }));
    const res = await mutateApi<{ session?: InventorySession }>('/api/inventories', 'POST', {
      warehouseId: activeWarehouseId,
      scope,
      lines,
    });
    if (res) {
      if (res.session?.status === 'EN_ATTENTE_VALIDATION') {
        notify(
          'warning',
          'Inventaire soumis avec écart > 5% — en attente de validation du Propriétaire.'
        );
      } else {
        notify('success', 'Inventaire validé et stock mis à jour.');
      }
      setInventoryMode(false);
    }
  };

  const signWeeklyPV = async () => {
    const totalSystemVal = activeDepotStocks.reduce((sum, s) => {
      const pkg = snapshot.packagings.find((p) => p.id === s.packagingId);
      return sum + s.qtyOnHand * (pkg?.purchasePrice || 0);
    }, 0);
    const res = await mutateApi('/api/reconciliations', 'POST', {
      warehouseId: activeWarehouseId,
      type: 'HEBDOMADAIRE_STOCK',
      periodLabel: `Contrôle stock semaine ${new Date().toISOString().slice(0, 10)}`,
      systemValue: totalSystemVal,
      physicalOrExternalValue: totalSystemVal,
      notes: 'Réconciliation hebdomadaire tournante signée électroniquement.',
    });
    if (res) notify('success', 'PV de réconciliation hebdomadaire signé.');
  };

  const totalStockValue = scopedStocks.reduce((sum, s) => {
    const pkg = snapshot.packagings.find((p) => p.id === s.packagingId);
    return sum + s.qtyOnHand * (pkg?.purchasePrice || 0);
  }, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            Stock, Lots FEFO & Inventaires
          </h1>
          <p className="text-xs text-slate-500 tabular-nums">
            Valorisation stock liquide (prix achat) : <strong className="font-mono">{formatFCFA(totalStockValue)}</strong>
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {hasPerm(PERMISSIONS.RECONCILIATION_SIGN) && (
            <button
              type="button"
              onClick={signWeeklyPV}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 whitespace-nowrap shrink-0"
            >
              <ClipboardCheck className="h-4 w-4 text-emerald-700" />
              Signer PV Hebdo
            </button>
          )}
          {hasPerm(PERMISSIONS.STOCK_INVENTORY) && (
            <button
              type="button"
              onClick={startInventory}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800 whitespace-nowrap shrink-0"
            >
              Saisir un inventaire
            </button>
          )}
        </div>
      </div>

      {inventoryMode && (
        <div className="rounded-xl border border-emerald-300 bg-white p-5 dark:border-emerald-800 dark:bg-slate-900">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              Comptage physique d’inventaire ({snapshot.warehouses.find((w) => w.id === activeWarehouseId)?.name})
            </h2>
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as 'TOURNANT' | 'GENERAL')}
              className="min-h-[38px] rounded-lg border border-slate-200 px-3 text-xs font-semibold dark:border-slate-700 dark:bg-slate-800"
            >
              <option value="TOURNANT">Inventaire tournant</option>
              <option value="GENERAL">Inventaire général</option>
            </select>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-medium text-slate-500">
                  <th className="py-2">Conditionnement</th>
                  <th className="py-2 text-right">Théorique (Pleins)</th>
                  <th className="py-2 text-right">Compté (Pleins)</th>
                  <th className="py-2 text-right">Écart</th>
                  <th className="py-2 text-right">Vides comptés</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {activeDepotStocks.map((stk) => {
                  const pkg = snapshot.packagings.find((p) => p.id === stk.packagingId);
                  if (!pkg || pkg.deletedAt) return null;
                  const c = counts[stk.packagingId] || { full: stk.qtyOnHand, empty: stk.emptyCratesOnHand };
                  const diff = c.full - stk.qtyOnHand;
                  return (
                    <tr key={stk.id} className="h-11">
                      <td className="py-2 font-medium">{pkg.label}</td>
                      <td className="py-2 text-right font-mono tabular-nums">{stk.qtyOnHand}</td>
                      <td className="py-2 text-right">
                        <input
                          type="number"
                          min={0}
                          value={c.full}
                          onChange={(e) =>
                            setCounts((prev) => ({
                              ...prev,
                              [stk.packagingId]: { ...c, full: Number(e.target.value) },
                            }))
                          }
                          className="w-20 rounded border border-slate-200 px-2 py-1 text-right font-mono text-sm tabular-nums dark:border-slate-700 dark:bg-slate-800"
                        />
                      </td>
                      <td className={`py-2 text-right font-mono font-bold tabular-nums ${diff !== 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
                        {diff > 0 ? `+${diff}` : diff}
                      </td>
                      <td className="py-2 text-right">
                        {pkg.isReturnable ? (
                          <input
                            type="number"
                            min={0}
                            value={c.empty}
                            onChange={(e) =>
                              setCounts((prev) => ({
                                ...prev,
                                [stk.packagingId]: { ...c, empty: Number(e.target.value) },
                              }))
                            }
                            className="w-20 rounded border border-slate-200 px-2 py-1 text-right font-mono text-sm tabular-nums dark:border-slate-700 dark:bg-slate-800"
                          />
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setInventoryMode(false)} className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold">Annuler</button>
            <button type="button" onClick={submitInventory} className="rounded-lg bg-emerald-700 px-4 py-2 text-xs font-semibold text-white">Soumettre inventaire</button>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-4 grid grid-cols-1 gap-2.5 rounded-xl border border-slate-200/80 bg-slate-50/70 p-3 sm:grid-cols-4 dark:border-slate-800 dark:bg-slate-800/40">
          <div className="relative sm:col-span-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={stockSearch}
              onChange={(e) => setStockSearch(e.target.value)}
              placeholder="Rechercher conditionnement, SKU, lot FEFO..."
              className="min-h-[38px] w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-xs dark:border-slate-700 dark:bg-slate-900"
            />
          </div>
          <select
            value={stockStateFilter}
            onChange={(e) => setStockStateFilter(e.target.value as 'ALL' | 'CRITIQUE' | 'NOMINAL')}
            className="min-h-[38px] rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold dark:border-slate-700 dark:bg-slate-900"
          >
            <option value="ALL">Tous états de stock</option>
            <option value="CRITIQUE">Stock critique uniquement</option>
            <option value="NOMINAL">Stock nominal</option>
          </select>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setReturnableOnly((v) => !v)}
              className={`min-h-[38px] flex-1 rounded-lg border px-2.5 text-xs font-semibold whitespace-nowrap ${
                returnableOnly
                  ? 'border-emerald-600 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200'
                  : 'border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
              }`}
            >
              Casiers consignés
            </button>
            {(stockSearch || stockStateFilter !== 'ALL' || returnableOnly) && (
              <button
                type="button"
                onClick={() => {
                  setStockSearch('');
                  setStockStateFilter('ALL');
                  setReturnableOnly(false);
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
                <th className="py-2.5">Conditionnement · Lot FEFO</th>
                <th className="py-2.5">Dépôt · Prochaine DLC</th>
                <th className="py-2.5 text-right">Pleins dispo</th>
                <th className="py-2.5 text-right">Vides parc</th>
                <th className="py-2.5 text-right">Seuil alerte</th>
                <th className="py-2.5 text-right">État</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {stockPagination.paginatedItems.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-xs text-slate-400">
                    Aucune ligne de stock trouvée.
                  </td>
                </tr>
              ) : (
                stockPagination.paginatedItems.map(({ s, pkg }) => {
                  if (!pkg) return null;
                  const isLow = s.qtyOnHand <= pkg.alertThreshold;
                  const wh = snapshot.warehouses.find((w) => w.id === s.warehouseId);
                  return (
                    <tr key={s.id} className="h-11 hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                      <td className="py-2">
                        <p className="font-semibold text-slate-900 dark:text-white">{pkg.label}</p>
                        <p className="font-mono text-xs text-slate-500">{s.lotNumber} · {pkg.sku}</p>
                      </td>
                      <td className="py-2 text-xs text-slate-600 tabular-nums dark:text-slate-400">
                        {wh?.zone || s.warehouseId} · {s.nextDlc ? formatDateFR(s.nextDlc) : 'Non périssable'}
                      </td>
                      <td className="py-2 text-right font-mono font-bold tabular-nums">{formatNumberFR(s.qtyOnHand)}</td>
                      <td className="py-2 text-right font-mono text-slate-600 tabular-nums dark:text-slate-400">
                        {pkg.isReturnable ? formatNumberFR(s.emptyCratesOnHand) : '—'}
                      </td>
                      <td className="py-2 text-right font-mono text-xs text-slate-500 tabular-nums">{pkg.alertThreshold}</td>
                      <td className="py-2 text-right">
                        <span className={`text-xs font-semibold ${isLow ? 'text-amber-700' : 'text-emerald-700'}`}>
                          {isLow ? 'Stock critique' : 'Nominal'}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <TablePagination
          page={stockPagination.page}
          totalPages={stockPagination.totalPages}
          pageSize={stockPagination.pageSize}
          totalItems={stockPagination.totalItems}
          startIndex={stockPagination.startIndex}
          endIndex={stockPagination.endIndex}
          onPageChange={stockPagination.setPage}
          onPageSizeChange={stockPagination.setPageSize}
          itemLabel="lots"
        />
      </div>
    </div>
  );
};
