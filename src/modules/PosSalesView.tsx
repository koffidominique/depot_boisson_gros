import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Check,
  CheckCircle2,
  Download,
  Filter,
  Lock,
  Minus,
  Plus,
  Printer,
  RotateCcw,
  ScanBarcode,
  Search,
  ShoppingCart,
  Trash2,
  Unlock,
  Volume2,
  VolumeX,
  X,
  Zap,
} from 'lucide-react';
import { TablePagination, usePagination } from '../components/TablePagination';
import { useErp } from '../context/ErpContext';
import {
  isPosFeedbackEnabled,
  setPosFeedbackEnabled,
  triggerPosFeedback,
} from '../lib/feedback';
import {
  exportToCsv,
  formatDateTimeFR,
  formatFCFA,
  PAYMENT_METHOD_LABELS,
} from '../lib/format';
import { PERMISSIONS, type PaymentMethod, type PaymentSplit, type ProductCategory, type Sale } from '../types/erp';

interface CartItem {
  packagingId: string;
  qty: number;
  emptyCratesReturnedNow: number;
}

export const PosSalesView: React.FC = () => {
  const {
    snapshot,
    mutateApi,
    hasPerm,
    isOnline,
    notify,
    navHint,
    clearNavHint,
    currentUser,
    activeWarehouseId,
    selectedWarehouseId,
  } = useErp();
  const [subTab, setSubTab] = useState<'pos' | 'history' | 'cash'>(() =>
    currentUser?.role === 'PROPRIETAIRE' ? 'history' : 'pos'
  );
  const [search, setSearch] = useState('');
  const [historySearch, setHistorySearch] = useState('');
  const [historyStatus, setHistoryStatus] = useState<'ALL' | Sale['status']>('ALL');
  const [historyPayment, setHistoryPayment] = useState<'ALL' | PaymentMethod>('ALL');
  const [historyFlag, setHistoryFlag] = useState<'ALL' | 'OFFLINE' | 'DELIVERY' | 'WITH_DEPOSIT'>('ALL');
  const [historyDateFrom, setHistoryDateFrom] = useState('');
  const [historyDateTo, setHistoryDateTo] = useState('');
  const [catFilter, setCatFilter] = useState<'ALL' | ProductCategory>('ALL');
  const [customerId, setCustomerId] = useState('cust-comptoir');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [discountAmount, setDiscountAmount] = useState(0);
  const [discountReason, setDiscountReason] = useState('');
  const [deliveryRequired, setDeliveryRequired] = useState(false);
  const [creditOverridePin, setCreditOverridePin] = useState('');

  // Quick-Scan / Barcode inline entry (no modal)
  const [quickScanEnabled, setQuickScanEnabled] = useState(true);
  const [continuousScan, setContinuousScan] = useState(true);
  const [feedbackEnabled, setFeedbackEnabled] = useState<boolean>(() => isPosFeedbackEnabled());
  const [scanFeedbackState, setScanFeedbackState] = useState<'idle' | 'success' | 'error'>('idle');
  const [scanCode, setScanCode] = useState('');
  const [scanQty, setScanQty] = useState(1);
  const [lastScanNotice, setLastScanNotice] = useState<string | null>(null);
  const scanInputRef = useRef<HTMLInputElement | null>(null);

  // Split payments
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod>('ESPECES');
  const [paymentRef, setPaymentRef] = useState('');
  const [splits, setSplits] = useState<PaymentSplit[]>([]);

  // Cash register open/close
  const [openingFloat, setOpeningFloat] = useState(100000);
  const [countedCash, setCountedCash] = useState<string>('');
  const [closeNotes, setCloseNotes] = useState('');

  // Receipt & Cancel request modals
  const [receiptSale, setReceiptSale] = useState<Sale | null>(null);
  const [cancelSaleTarget, setCancelSaleTarget] = useState<Sale | null>(null);
  const [cancelReason, setCancelReason] = useState('');

  const activeCash = snapshot?.cashSessions.find(
    (c) => c.warehouseId === activeWarehouseId && c.status === 'OUVERTE'
  );
  const pendingValidationCash = snapshot?.cashSessions.find(
    (c) => c.warehouseId === activeWarehouseId && c.status === 'EN_ATTENTE_VALIDATION'
  );
  const selectedCustomer = snapshot?.customers.find((c) => c.id === customerId) || snapshot?.customers[0];
  const isOwnerReadOnly = currentUser?.role === 'PROPRIETAIRE';

  // Apply deep-link hints from Global Search or Urgent Shortcuts
  useEffect(() => {
    if (!navHint) return;
    if (navHint.salesTab) setSubTab(navHint.salesTab);
    if (navHint.searchQuery) {
      if (navHint.salesTab === 'history') setHistorySearch(navHint.searchQuery);
      else setSearch(navHint.searchQuery);
    }
    if (navHint.focusQuickScan) {
      setSubTab('pos');
      setQuickScanEnabled(true);
      setTimeout(() => scanInputRef.current?.focus(), 120);
    }
    clearNavHint();
  }, [navHint, clearNavHint]);

  // F2 keyboard shortcut to focus Quick Scan input
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F2' && subTab === 'pos') {
        e.preventDefault();
        setQuickScanEnabled(true);
        setTimeout(() => scanInputRef.current?.focus(), 40);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [subTab]);

  const catalog = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.packagings
      .filter((pkg) => !pkg.deletedAt)
      .map((pkg) => {
        const product = snapshot.products.find((p) => p.id === pkg.productId);
        const stock = snapshot.stocks.find(
          (s) => s.packagingId === pkg.id && s.warehouseId === activeWarehouseId
        );
        return { pkg, product, stock };
      })
      .filter(({ pkg, product }) => {
        if (!product || product.deletedAt) return false;
        if (catFilter !== 'ALL' && product.category !== catFilter) return false;
        if (search.trim()) {
          const q = search.toLowerCase();
          return (
            pkg.label.toLowerCase().includes(q) ||
            pkg.sku.toLowerCase().includes(q) ||
            product.name.toLowerCase().includes(q)
          );
        }
        return true;
      });
  }, [snapshot, activeWarehouseId, catFilter, search]);

  // Parse quick-scan code: supports "5*BOCK-33-C24" or "BOCK-33-C24" or partial label/SKU
  const quickScanMatches = useMemo(() => {
    if (!snapshot) return [];
    const raw = scanCode.trim();
    if (!raw) return [];
    const parts = raw.includes('*') ? raw.split('*') : [raw];
    const token = (parts.length > 1 ? parts[1] : parts[0]).trim().toLowerCase();
    if (!token) return [];
    return snapshot.packagings
      .filter((p) => !p.deletedAt)
      .map((pkg) => {
        const prod = snapshot.products.find((pr) => pr.id === pkg.productId && !pr.deletedAt);
        const stock = snapshot.stocks.find(
          (s) => s.packagingId === pkg.id && s.warehouseId === activeWarehouseId
        );
        return { pkg, prod, stock };
      })
      .filter(({ pkg, prod }) => {
        if (!prod) return false;
        return (
          pkg.sku.toLowerCase().includes(token) ||
          pkg.id.toLowerCase().includes(token) ||
          pkg.label.toLowerCase().includes(token) ||
          prod.name.toLowerCase().includes(token)
        );
      })
      .slice(0, 5);
  }, [snapshot, activeWarehouseId, scanCode]);

  // Advanced multi-criteria filtering for Sales History
  const filteredSales = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.sales.filter((s) => {
      if (selectedWarehouseId !== 'ALL' && s.warehouseId !== selectedWarehouseId) return false;
      if (historyStatus !== 'ALL' && s.status !== historyStatus) return false;
      if (historyPayment !== 'ALL' && !s.payments.some((p) => p.method === historyPayment)) return false;
      if (historyFlag === 'OFFLINE' && !s.offlineOriginated) return false;
      if (historyFlag === 'DELIVERY' && !s.deliveryRequired) return false;
      if (historyFlag === 'WITH_DEPOSIT' && s.depositNetTotal <= 0) return false;
      const saleDay = s.createdAt.slice(0, 10);
      if (historyDateFrom && saleDay < historyDateFrom) return false;
      if (historyDateTo && saleDay > historyDateTo) return false;
      if (historySearch.trim()) {
        const q = historySearch.toLowerCase();
        const cust = snapshot.customers.find((c) => c.id === s.customerId);
        const matchesLine = s.lines.some((l) => {
          const pkg = snapshot.packagings.find((p) => p.id === l.packagingId);
          return pkg?.sku.toLowerCase().includes(q) || pkg?.label.toLowerCase().includes(q);
        });
        return (
          s.docNumber.toLowerCase().includes(q) ||
          s.ticketNumber.toLowerCase().includes(q) ||
          (cust?.name.toLowerCase().includes(q) ?? false) ||
          matchesLine
        );
      }
      return true;
    });
  }, [snapshot, selectedWarehouseId, historySearch, historyStatus, historyPayment, historyFlag, historyDateFrom, historyDateTo]);

  const salesPagination = usePagination(filteredSales, 8);

  if (!snapshot) return null;

  const getUnitPrice = (pkgId: string) => {
    const pkg = snapshot.packagings.find((p) => p.id === pkgId);
    if (!pkg || !selectedCustomer) return 0;
    if (selectedCustomer.pricingTier === 'GROS') return pkg.salePriceGros;
    if (selectedCustomer.pricingTier === 'SEMI_GROS') return pkg.salePriceSemiGros;
    return pkg.salePriceDetail;
  };

  const flashScanState = (state: 'success' | 'error') => {
    setScanFeedbackState(state);
    setTimeout(() => setScanFeedbackState('idle'), 900);
  };

  const toggleFeedback = () => {
    const next = !feedbackEnabled;
    setFeedbackEnabled(next);
    setPosFeedbackEnabled(next);
    if (next) triggerPosFeedback('scan_success');
  };

  const addToCart = (pkgId: string, qtyToAdd = 1, withSound = false) => {
    const qty = Math.max(1, qtyToAdd);
    setCart((prev) => {
      const idx = prev.findIndex((i) => i.packagingId === pkgId);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty: next[idx].qty + qty };
        return next;
      }
      return [...prev, { packagingId: pkgId, qty, emptyCratesReturnedNow: 0 }];
    });
    if (withSound) {
      triggerPosFeedback('scan_success');
    }
  };

  const handleQuickScanSubmit = (e?: React.FormEvent, explicitPkgId?: string) => {
    if (e) e.preventDefault();
    const raw = scanCode.trim();
    if (!raw && !explicitPkgId) {
      triggerPosFeedback('error');
      flashScanState('error');
      setLastScanNotice('Saisissez ou scannez un code SKU / code-barres.');
      setTimeout(() => setLastScanNotice(null), 2200);
      return;
    }

    let qtyToUse = Math.max(1, scanQty);
    let token = raw.toLowerCase();
    if (raw.includes('*')) {
      const [qStr, codeStr] = raw.split('*');
      const parsedQ = Number(qStr.trim());
      if (Number.isNaN(parsedQ) || parsedQ <= 0) {
        triggerPosFeedback('error');
        flashScanState('error');
        notify('error', `Quantité invalide dans le code « ${raw} ».`);
        return;
      }
      qtyToUse = parsedQ;
      token = (codeStr || '').trim().toLowerCase();
    }

    const chosen = explicitPkgId
      ? snapshot.packagings.find((p) => p.id === explicitPkgId && !p.deletedAt)
      : snapshot.packagings.find((p) => !p.deletedAt && p.sku.toLowerCase() === token) ||
        quickScanMatches[0]?.pkg;

    if (!chosen) {
      triggerPosFeedback('error');
      flashScanState('error');
      setLastScanNotice(`Code inconnu : ${raw}`);
      notify('error', `Aucun produit trouvé pour le code « ${raw} ».`);
      setTimeout(() => setLastScanNotice(null), 2600);
      return;
    }

    const stk = snapshot.stocks.find(
      (s) => s.packagingId === chosen.id && s.warehouseId === activeWarehouseId
    );
    if (isOnline && (stk?.qtyOnHand ?? 0) <= 0) {
      triggerPosFeedback('error');
      flashScanState('error');
      setLastScanNotice(`Stock épuisé : ${chosen.label}`);
      notify('warning', `Stock épuisé pour ${chosen.label} (${chosen.sku}).`);
      setTimeout(() => setLastScanNotice(null), 2600);
      return;
    }

    addToCart(chosen.id, qtyToUse);
    triggerPosFeedback('scan_success');
    flashScanState('success');
    setLastScanNotice(`+${qtyToUse} × ${chosen.label} (${chosen.sku})`);
    setScanCode('');
    setScanQty(1);
    setTimeout(() => setLastScanNotice(null), 2600);
    if (continuousScan) {
      scanInputRef.current?.focus();
    }
  };

  const updateCartItem = (pkgId: string, patch: Partial<CartItem>) => {
    setCart((prev) =>
      prev
        .map((i) => (i.packagingId === pkgId ? { ...i, ...patch } : i))
        .filter((i) => i.qty > 0)
    );
  };

  const totals = cart.reduce(
    (acc, item) => {
      const pkg = snapshot.packagings.find((p) => p.id === item.packagingId);
      if (!pkg) return acc;
      const unit = getUnitPrice(pkg.id);
      const liq = unit * item.qty;
      const returned = pkg.isReturnable ? Math.min(item.qty, item.emptyCratesReturnedNow) : 0;
      const dep = pkg.isReturnable ? Math.max(0, item.qty - returned) * pkg.depositPerCrate : 0;
      acc.liquid += liq;
      acc.deposit += dep;
      return acc;
    },
    { liquid: 0, deposit: 0 }
  );

  const grandTotal = Math.max(0, totals.liquid - discountAmount + totals.deposit);
  const splitsTotal = splits.reduce((s, p) => s + p.amount, 0);
  const remainingToPay = Math.max(0, grandTotal - splitsTotal);

  const addSplitPayment = (amountToAdd: number) => {
    if (amountToAdd <= 0) return;
    setSplits((prev) => [
      ...prev,
      { method: selectedMethod, amount: amountToAdd, reference: paymentRef || undefined },
    ]);
    setPaymentRef('');
  };

  const handleCheckout = async () => {
    if (cart.length === 0) {
      triggerPosFeedback('error');
      notify('warning', 'Ajoutez au moins un article au panier.');
      return;
    }
    const finalPayments: PaymentSplit[] =
      splits.length > 0
        ? remainingToPay > 0
          ? [...splits, { method: selectedMethod, amount: remainingToPay, reference: paymentRef || undefined }]
          : splits
        : [{ method: selectedMethod, amount: grandTotal, reference: paymentRef || undefined }];

    const payload = {
      customerId,
      warehouseId: activeWarehouseId,
      lines: cart,
      discountAmount,
      discountReason,
      payments: finalPayments,
      deliveryRequired,
      creditOverridePin: creditOverridePin || undefined,
    };

    let offlineCreatedSale: Sale | null = null;

    const res = await mutateApi<{
      sale?: Sale & { pendingApproval?: boolean };
      offlineQueued?: boolean;
    }>(
      '/api/sales',
      'POST',
      payload,
      {
        actionType: 'CREATE_SALE',
        summary: `Vente ${selectedCustomer?.name || 'Comptoir'} · ${formatFCFA(grandTotal)}`,
        optimisticUpdate: (prev) => {
          const next = structuredClone(prev);
          const now = new Date().toISOString();
          const tempDoc = `OFF-${Date.now().toString().slice(-5)}`;
          const newSale: Sale = {
            id: `off-sale-${Date.now()}`,
            docNumber: tempDoc,
            ticketNumber: tempDoc,
            customerId,
            warehouseId: activeWarehouseId,
            cashSessionId: activeCash?.id || 'offline',
            lines: cart.map((c) => {
              const pkg = next.packagings.find((p) => p.id === c.packagingId)!;
              const u = getUnitPrice(c.packagingId);
              const dep = pkg.isReturnable ? Math.max(0, c.qty - c.emptyCratesReturnedNow) * pkg.depositPerCrate : 0;
              return {
                packagingId: c.packagingId,
                qty: c.qty,
                unitPrice: u,
                lineLiquidTotal: u * c.qty,
                depositCharged: dep,
                emptyCratesReturnedNow: c.emptyCratesReturnedNow,
              };
            }),
            discountAmount,
            discountReason: discountReason || undefined,
            liquidTotal: Math.max(0, totals.liquid - discountAmount),
            depositNetTotal: totals.deposit,
            grandTotal,
            payments: finalPayments,
            creditAdded: finalPayments.filter((p) => p.method === 'CREDIT').reduce((s, p) => s + p.amount, 0),
            status: 'VALIDEE',
            deliveryRequired,
            offlineOriginated: true,
            createdBy: 'offline',
            createdAt: now,
            deletedAt: null,
          };
          offlineCreatedSale = newSale;
          next.sales.unshift(newSale);
          cart.forEach((c) => {
            const stk = next.stocks.find(
              (s) => s.packagingId === c.packagingId && s.warehouseId === activeWarehouseId
            );
            if (stk) stk.qtyOnHand = Math.max(0, stk.qtyOnHand - c.qty);
          });
          return next;
        },
      }
    );

    if (res) {
      if (res.sale) {
        if (res.sale.pendingApproval || res.sale.status === 'EN_ATTENTE_VALIDATION') {
          triggerPosFeedback('sale_success');
          notify(
            'warning',
            `Vente ${res.sale.docNumber} enregistrée en attente d’approbation Propriétaire (Remise > ${snapshot.company.maxCashierDiscountPercent}%).`
          );
        } else {
          triggerPosFeedback('sale_success');
          setReceiptSale(res.sale);
          notify('success', `Vente validée : ${res.sale.docNumber} (${formatFCFA(res.sale.grandTotal)})`);
        }
      } else if (res.offlineQueued && offlineCreatedSale) {
        triggerPosFeedback('sale_success');
        setReceiptSale(offlineCreatedSale);
      }
      setCart([]);
      setSplits([]);
      setDiscountAmount(0);
      setDiscountReason('');
      setCreditOverridePin('');
      setPaymentRef('');
    } else {
      triggerPosFeedback('error');
    }
  };

  const handleValidateSale = async (saleId: string, docNumber: string) => {
    const res = await mutateApi(`/api/sales/${saleId}/validate`, 'POST', {});
    if (res) {
      triggerPosFeedback('sale_success');
      notify('success', `Vente ${docNumber} validée et déstockée.`);
    } else {
      triggerPosFeedback('error');
    }
  };

  const handleOpenCash = async () => {
    const res = await mutateApi('/api/cash-sessions/open', 'POST', {
      openingFloat,
      warehouseId: activeWarehouseId,
    });
    if (res) {
      triggerPosFeedback('sale_success');
      notify('success', 'Session de caisse ouverte.');
    } else {
      triggerPosFeedback('error');
    }
  };

  const handleCloseCash = async () => {
    if (!activeCash) return;
    const val = Number(countedCash);
    if (Number.isNaN(val) || countedCash === '') {
      triggerPosFeedback('error');
      notify('warning', 'Saisissez le montant physique compté en caisse.');
      return;
    }
    const res = await mutateApi<{ pendingValidation?: boolean }>(`/api/cash-sessions/${activeCash.id}/close`, 'POST', {
      countedCash: val,
      notes: closeNotes,
    });
    if (res) {
      triggerPosFeedback('sale_success');
      if (res.pendingValidation) {
        notify('warning', 'Clôture enregistrée en attente de validation Propriétaire (séparation des tâches).');
      } else {
        notify('success', 'Caisse clôturée et Rapport Z généré.');
      }
      setCountedCash('');
      setCloseNotes('');
    } else {
      triggerPosFeedback('error');
    }
  };

  const handleValidateCashSession = async (cashId: string, docNumber: string) => {
    const res = await mutateApi(`/api/cash-sessions/${cashId}/validate`, 'POST', {
      decisionNote: 'Clôture Z vérifiée et validée.',
    });
    if (res) {
      triggerPosFeedback('sale_success');
      notify('success', `Session ${docNumber} clôturée et PV quotidien généré.`);
    } else {
      triggerPosFeedback('error');
    }
  };

  const handleRequestCancelSale = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cancelSaleTarget) return;
    if (!cancelReason.trim()) {
      triggerPosFeedback('error');
      notify('warning', 'Le motif d’annulation est obligatoire.');
      return;
    }
    const res = await mutateApi(`/api/sales/${cancelSaleTarget.id}/cancel-request`, 'POST', {
      reason: cancelReason.trim(),
    });
    if (res) {
      notify('success', `Demande d’annulation pour ${cancelSaleTarget.docNumber} transmise au Gérant/Admin.`);
      setCancelSaleTarget(null);
      setCancelReason('');
    }
  };

  const handleExportSales = () => {
    exportToCsv(
      `ventes-gestdepot-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Document', 'Ticket', 'Date', 'Client', 'Liquide (FCFA)', 'Caution (FCFA)', 'Total TTC', 'Crédit ajouté', 'Statut'],
      snapshot.sales.map((s) => {
        const cust = snapshot.customers.find((c) => c.id === s.customerId);
        return [
          s.docNumber,
          s.ticketNumber,
          formatDateTimeFR(s.createdAt),
          cust?.name || s.customerId,
          s.liquidTotal,
          s.depositNetTotal,
          s.grandTotal,
          s.creditAdded,
          s.status,
        ];
      })
    );
  };

  const hasActiveHistoryFilters =
    Boolean(historySearch.trim()) ||
    historyStatus !== 'ALL' ||
    historyPayment !== 'ALL' ||
    historyFlag !== 'ALL' ||
    Boolean(historyDateFrom) ||
    Boolean(historyDateTo);

  const resetHistoryFilters = () => {
    setHistorySearch('');
    setHistoryStatus('ALL');
    setHistoryPayment('ALL');
    setHistoryFlag('ALL');
    setHistoryDateFrom('');
    setHistoryDateTo('');
  };

  return (
    <div className="space-y-5">
      <div className={receiptSale ? 'no-print space-y-5' : 'space-y-5'}>
        {/* Sub-navigation segmented bar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            Ventes, Caisse POS & Tickets
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Tarification automatique par catégorie client · Calcul caution casiers · Compatible hors-ligne
          </p>
        </div>

        <div className="flex items-center gap-1 rounded-lg bg-slate-200/70 p-1 shadow-inner dark:bg-slate-800">
          {(
            [
              ['pos', 'Comptoir POS'],
              ['history', `Historique (${snapshot.sales.length})`],
              ['cash', 'Caisse & Rapport Z'],
            ] as const
          ).map(([tabKey, tabLabel]) => {
            const active = subTab === tabKey;
            return (
              <button
                key={tabKey}
                type="button"
                onClick={() => setSubTab(tabKey)}
                className={`relative min-h-[40px] rounded-md px-3.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  active ? 'text-slate-900 dark:text-white' : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="posSubTabBg"
                    transition={{ type: 'spring', stiffness: 450, damping: 32 }}
                    className="absolute inset-0 rounded-md bg-white shadow-sm dark:bg-slate-900"
                  />
                )}
                <span className="relative z-10">{tabLabel}</span>
              </button>
            );
          })}
        </div>
      </div>

      {isOwnerReadOnly && subTab === 'pos' && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-200">
          <span>
            Mode supervision Propriétaire : la saisie comptoir et l’ouverture/clôture de caisse sont exécutées par le Gérant de dépôt. Vous pouvez superviser l’historique et valider les clôtures Z / remises &gt; 5%.
          </span>
          <button
            type="button"
            onClick={() => setSubTab('history')}
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-emerald-700 whitespace-nowrap shrink-0"
          >
            Voir l’historique des ventes
          </button>
        </div>
      )}

      {!activeCash && !isOwnerReadOnly && isOnline && subTab === 'pos' && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-sm dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <span>Aucune session de caisse ouverte sur ce dépôt. Ouvrez la caisse pour encaisser au comptoir.</span>
          <button
            type="button"
            onClick={() => setSubTab('cash')}
            className="rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-800 whitespace-nowrap shrink-0"
          >
            Ouvrir la caisse
          </button>
        </div>
      )}

      {subTab === 'pos' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Left: Quick Scan + Product Grid (7 cols) */}
          <div className="space-y-4 lg:col-span-7">
            {/* Inline Quick Scan / Barcode Entry (No Modal) */}
            <motion.div
              animate={
                scanFeedbackState === 'error'
                  ? { x: [0, -5, 5, -3, 3, 0] }
                  : scanFeedbackState === 'success'
                  ? { scale: [1, 1.01, 1] }
                  : { x: 0, scale: 1 }
              }
              transition={{ duration: 0.25 }}
              className={`rounded-xl border bg-white p-3.5 shadow-md shadow-emerald-950/5 transition-colors dark:bg-slate-900 ${
                scanFeedbackState === 'error'
                  ? 'border-red-400 bg-red-50/40 dark:border-red-700 dark:bg-red-950/20'
                  : scanFeedbackState === 'success'
                  ? 'border-emerald-500 bg-emerald-50/30 dark:border-emerald-600 dark:bg-emerald-950/20'
                  : 'border-emerald-200/80 dark:border-emerald-900/60'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <ScanBarcode className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
                  <span className="text-xs font-bold text-slate-900 dark:text-white">
                    Saisie rapide · Scan code-barres / SKU (F2)
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={toggleFeedback}
                    title="Activer ou couper les bips sonores et vibrations haptiques POS"
                    className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold transition-colors ${
                      feedbackEnabled
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300'
                        : 'border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400'
                    }`}
                  >
                    {feedbackEnabled ? <Volume2 className="h-3 w-3" /> : <VolumeX className="h-3 w-3" />}
                    <span>{feedbackEnabled ? 'Son & Haptique' : 'Muet'}</span>
                  </button>
                  <label className="flex cursor-pointer items-center gap-1.5 text-[11px] font-medium text-slate-600 dark:text-slate-400">
                    <input
                      type="checkbox"
                      checked={continuousScan}
                      onChange={(e) => setContinuousScan(e.target.checked)}
                      className="h-3.5 w-3.5 accent-emerald-700"
                    />
                    Scan continu
                  </label>
                  <button
                    type="button"
                    onClick={() => setQuickScanEnabled((v) => !v)}
                    className="text-[11px] font-semibold text-emerald-700 hover:underline dark:text-emerald-400"
                  >
                    {quickScanEnabled ? 'Réduire' : 'Déplier'}
                  </button>
                </div>
              </div>

              <AnimatePresence initial={false}>
                {quickScanEnabled && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.18 }}
                    className="overflow-hidden"
                  >
                    <form onSubmit={(e) => handleQuickScanSubmit(e)} className="mt-2.5 flex flex-wrap items-center gap-2">
                      <div className="relative min-w-[200px] flex-1">
                        <Zap className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-emerald-600" />
                        <input
                          ref={scanInputRef}
                          type="text"
                          value={scanCode}
                          onChange={(e) => setScanCode(e.target.value)}
                          placeholder="Scanner ou saisir SKU / Qté*SKU (ex: BOCK-33-C24 ou 5*AWA-150-P6) + Entrée"
                          className="min-h-[42px] w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-3 font-mono text-xs text-slate-900 placeholder:font-sans placeholder:text-slate-400 focus:border-emerald-600 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        />
                      </div>
                      <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-1.5 py-1 dark:border-slate-700 dark:bg-slate-800">
                        <span className="text-[11px] font-medium text-slate-500 pl-1">Qté</span>
                        <input
                          type="number"
                          min={1}
                          value={scanQty}
                          onChange={(e) => setScanQty(Math.max(1, Number(e.target.value)))}
                          className="w-12 bg-transparent text-center font-mono text-xs font-bold tabular-nums focus:outline-none"
                        />
                      </div>
                      <motion.button
                        type="submit"
                        whileHover={{ scale: 1.03 }}
                        whileTap={{ scale: 0.97 }}
                        className="inline-flex min-h-[42px] items-center gap-1.5 rounded-lg bg-emerald-700 px-3.5 text-xs font-semibold text-white shadow-sm hover:bg-emerald-800 whitespace-nowrap shrink-0"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Ajouter
                      </motion.button>
                    </form>

                    {/* Instant inline suggestions strip (zero modal) */}
                    {quickScanMatches.length > 0 && (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {quickScanMatches.map(({ pkg, stock }) => (
                          <button
                            key={pkg.id}
                            type="button"
                            onClick={() => handleQuickScanSubmit(undefined, pkg.id)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-800 hover:border-emerald-500 hover:bg-emerald-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                          >
                            <span className="font-mono font-bold text-emerald-700 dark:text-emerald-400">{pkg.sku}</span>
                            <span>{pkg.label}</span>
                            <span className="font-mono text-slate-400">({stock?.qtyOnHand ?? 0})</span>
                          </button>
                        ))}
                      </div>
                    )}

                    <AnimatePresence>
                      {lastScanNotice && (
                        <motion.p
                          initial={{ opacity: 0, y: -4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0 }}
                          className={`mt-2 text-xs font-semibold ${
                            scanFeedbackState === 'error'
                              ? 'text-red-700 dark:text-red-400'
                              : 'text-emerald-700 dark:text-emerald-400'
                          }`}
                        >
                          {scanFeedbackState === 'error' ? lastScanNotice : `Ajouté au ticket : ${lastScanNotice}`}
                        </motion.p>
                      )}
                    </AnimatePresence>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Rechercher Bock, Castel, World Cola, Awa, SKU..."
                  className="min-h-[44px] w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-900 shadow-xs placeholder:text-slate-400 focus:border-emerald-600 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                />
              </div>
              <div className="flex items-center gap-1 overflow-x-auto rounded-lg bg-slate-200/60 p-1 dark:bg-slate-800">
                {(
                  [
                    ['ALL', 'Tous'],
                    ['BIERE', 'Bières'],
                    ['SODA', 'Sodas'],
                    ['EAU', 'Eaux'],
                    ['ENERGISANT', 'Énergie'],
                  ] as const
                ).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setCatFilter(k)}
                    className={`min-h-[36px] rounded-md px-3 py-1 text-xs font-semibold whitespace-nowrap shrink-0 ${
                      catFilter === k
                        ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {catalog.map(({ pkg, product, stock }) => {
                const price = getUnitPrice(pkg.id);
                const qtyAvail = stock?.qtyOnHand ?? 0;
                const low = qtyAvail <= pkg.alertThreshold;
                return (
                  <motion.button
                    key={pkg.id}
                    type="button"
                    whileHover={{ scale: 1.02, y: -2 }}
                    whileTap={{ scale: 0.98 }}
                    transition={{ type: 'spring', stiffness: 420, damping: 28 }}
                    disabled={qtyAvail <= 0 && isOnline}
                    onClick={() => addToCart(pkg.id, 1, true)}
                    className="flex min-h-[92px] flex-col justify-between rounded-xl border border-slate-200 bg-white p-3.5 text-left shadow-sm transition-shadow hover:border-emerald-600 hover:shadow-md disabled:opacity-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-emerald-500"
                  >
                    <div className="flex w-full items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-bold text-slate-900 dark:text-white">{pkg.label}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {product?.brand} · <span className="font-mono">{pkg.sku}</span>
                        </p>
                      </div>
                      <span
                        className={`font-mono text-xs font-semibold tabular-nums ${
                          qtyAvail <= 0
                            ? 'text-red-600'
                            : low
                            ? 'text-amber-600'
                            : 'text-emerald-700 dark:text-emerald-400'
                        }`}
                      >
                        Stock : {qtyAvail}
                      </span>
                    </div>
                    <div className="mt-2 flex w-full items-center justify-between">
                      <span className="font-mono text-base font-bold text-slate-900 tabular-nums dark:text-white">
                        {formatFCFA(price)}
                      </span>
                      <span className="text-[11px] font-medium text-slate-500 tabular-nums">
                        {pkg.isReturnable ? `+ Caution ${formatFCFA(pkg.depositPerCrate)}` : 'Emballage perdu'}
                      </span>
                    </div>
                  </motion.button>
                );
              })}
            </div>
          </div>

          {/* Right: Ticket & Checkout (5 cols) */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 lg:col-span-5 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <ShoppingCart className="h-4 w-4 text-emerald-700" />
                <h2 className="text-base font-bold text-slate-900 dark:text-white">Ticket de vente</h2>
              </div>
              <span className="font-mono text-xs text-slate-500">
                Tarif : {selectedCustomer?.pricingTier}
              </span>
            </div>

            {/* Customer selector */}
            <div className="mt-3">
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400">
                Client (Tarif & Plafond crédit auto)
              </label>
              <select
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-medium text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              >
                {snapshot.customers
                  .filter((c) => !c.deletedAt)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.pricingTier}) — {c.zone}
                    </option>
                  ))}
              </select>
              {selectedCustomer && selectedCustomer.id !== 'cust-comptoir' && (
                <div className="mt-1.5 flex flex-wrap gap-3 text-xs text-slate-500 tabular-nums dark:text-slate-400">
                  <span>
                    Crédit : {formatFCFA(selectedCustomer.creditBalance)} / {formatFCFA(selectedCustomer.creditLimit)}
                  </span>
                  <span>·</span>
                  <span>Casiers détenus : {selectedCustomer.consignmentCrates}</span>
                  {selectedCustomer.isBlocked && (
                    <>
                      <span>·</span>
                      <span className="font-semibold text-red-600">Crédit bloqué</span>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Cart lines */}
            <div className="mt-4 max-h-64 space-y-2.5 overflow-y-auto pr-1">
              {cart.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-400">
                  Touchez un produit à gauche pour commencer le ticket.
                </p>
              ) : (
                cart.map((item) => {
                  const pkg = snapshot.packagings.find((p) => p.id === item.packagingId);
                  if (!pkg) return null;
                  const unit = getUnitPrice(pkg.id);
                  const netCrates = pkg.isReturnable ? Math.max(0, item.qty - item.emptyCratesReturnedNow) : 0;
                  return (
                    <div
                      key={pkg.id}
                      className="rounded-lg border border-slate-200 bg-slate-50/70 p-2.5 dark:border-slate-800 dark:bg-slate-800/40"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-slate-900 dark:text-white">{pkg.label}</p>
                          <p className="font-mono text-xs text-slate-500 tabular-nums">
                            {formatFCFA(unit)} × {item.qty} = {formatFCFA(unit * item.qty)}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => updateCartItem(pkg.id, { qty: 0 })}
                          className="p-1 text-slate-400 hover:text-red-600"
                          aria-label="Retirer"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>

                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => updateCartItem(pkg.id, { qty: item.qty - 1 })}
                            className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                          >
                            <Minus className="h-3.5 w-3.5" />
                          </button>
                          <span className="w-8 text-center font-mono text-sm font-bold tabular-nums">
                            {item.qty}
                          </span>
                          <button
                            type="button"
                            onClick={() => updateCartItem(pkg.id, { qty: item.qty + 1 })}
                            className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                        </div>

                        {pkg.isReturnable && (
                          <div className="flex items-center gap-2 text-xs">
                            <span className="text-slate-600 dark:text-slate-400">Vides rendus :</span>
                            <input
                              type="number"
                              min={0}
                              max={item.qty}
                              value={item.emptyCratesReturnedNow}
                              onChange={(e) =>
                                updateCartItem(pkg.id, {
                                  emptyCratesReturnedNow: Math.min(item.qty, Math.max(0, Number(e.target.value))),
                                })
                              }
                              className="w-14 rounded border border-slate-200 bg-white px-2 py-1 text-center font-mono text-xs font-semibold tabular-nums dark:border-slate-700 dark:bg-slate-900"
                            />
                            <span className="font-mono text-amber-700 tabular-nums dark:text-amber-400">
                              +{formatFCFA(netCrates * pkg.depositPerCrate)}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Discount + Delivery toggle */}
            <div className="mt-4 space-y-2 border-t border-slate-100 pt-3 dark:border-slate-800">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-medium text-slate-500">Remise (FCFA)</label>
                  <input
                    type="number"
                    min={0}
                    value={discountAmount}
                    onChange={(e) => setDiscountAmount(Math.max(0, Number(e.target.value)))}
                    className="mt-1 min-h-[38px] w-full rounded-lg border border-slate-200 px-2.5 font-mono text-xs tabular-nums dark:border-slate-700 dark:bg-slate-800"
                  />
                </div>
                <label className="flex cursor-pointer items-center gap-2 pt-5 text-xs font-medium text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={deliveryRequired}
                    onChange={(e) => setDeliveryRequired(e.target.checked)}
                    className="h-4 w-4 accent-emerald-700"
                  />
                  À livrer en tournée
                </label>
              </div>
              {discountAmount > 0 && (
                <div>
                  <input
                    type="text"
                    value={discountReason}
                    onChange={(e) => setDiscountReason(e.target.value)}
                    placeholder={`Motif de la remise (obligatoire si > ${snapshot.company.maxCashierDiscountPercent}%)`}
                    className="min-h-[38px] w-full rounded-lg border border-slate-200 px-2.5 text-xs dark:border-slate-700 dark:bg-slate-800"
                  />
                </div>
              )}
            </div>

            {/* Totals */}
            <div className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-sm dark:border-slate-800">
              <div className="flex justify-between text-slate-600 dark:text-slate-400">
                <span>Sous-total liquide</span>
                <span className="font-mono tabular-nums">{formatFCFA(totals.liquid)}</span>
              </div>
              <div className="flex justify-between text-slate-600 dark:text-slate-400">
                <span>Cautions casiers nettes</span>
                <span className="font-mono tabular-nums">{formatFCFA(totals.deposit)}</span>
              </div>
              {discountAmount > 0 && (
                <div className="flex justify-between text-red-600">
                  <span>Remise</span>
                  <span className="font-mono tabular-nums">-{formatFCFA(discountAmount)}</span>
                </div>
              )}
              <div className="flex justify-between pt-1 text-lg font-bold text-slate-900 dark:text-white">
                <span>Total à payer</span>
                <span className="font-mono tabular-nums">{formatFCFA(grandTotal)}</span>
              </div>
            </div>

            {/* Payment modes */}
            <div className="mt-3 space-y-2 border-t border-slate-100 pt-3 dark:border-slate-800">
              <p className="text-xs font-semibold text-slate-600 dark:text-slate-400">Mode d’encaissement</p>
              <div className="grid grid-cols-3 gap-1.5">
                {(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setSelectedMethod(m)}
                    className={`min-h-[40px] rounded-lg border px-2 py-1.5 text-[11px] font-semibold transition-colors ${
                      selectedMethod === m
                        ? 'border-emerald-700 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-300'
                        : 'border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                    }`}
                  >
                    {PAYMENT_METHOD_LABELS[m]}
                  </button>
                ))}
              </div>

              {selectedMethod !== 'ESPECES' && selectedMethod !== 'CREDIT' && (
                <input
                  type="text"
                  value={paymentRef}
                  onChange={(e) => setPaymentRef(e.target.value)}
                  placeholder={`Référence transaction ${PAYMENT_METHOD_LABELS[selectedMethod]}`}
                  className="min-h-[40px] w-full rounded-lg border border-slate-200 px-3 text-xs dark:border-slate-700 dark:bg-slate-800"
                />
              )}

              {selectedMethod === 'CREDIT' &&
                selectedCustomer &&
                selectedCustomer.creditBalance + grandTotal > selectedCustomer.creditLimit && (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300">
                    <p className="font-semibold">Plafond crédit dépassé !</p>
                    <input
                      type="password"
                      value={creditOverridePin}
                      onChange={(e) => setCreditOverridePin(e.target.value)}
                      placeholder="Code PIN Gérant (ex: 1111) pour déblocage"
                      className="mt-1.5 w-full rounded border border-red-300 bg-white px-2.5 py-1.5 text-xs text-slate-900"
                    />
                  </div>
                )}

              {grandTotal > 0 && remainingToPay > 0 && (
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => addSplitPayment(Math.round(remainingToPay / 2))}
                    className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300"
                  >
                    Paiement mixte (50%)
                  </button>
                  {splits.length > 0 && (
                    <span className="font-mono text-xs text-emerald-700 tabular-nums">
                      Déjà saisi : {formatFCFA(splitsTotal)} · Reste : {formatFCFA(remainingToPay)}
                    </span>
                  )}
                </div>
              )}

              {splits.length > 0 && (
                <div className="space-y-1 rounded-lg bg-slate-50 p-2 text-xs dark:bg-slate-800">
                  {splits.map((sp, idx) => (
                    <div key={idx} className="flex items-center justify-between">
                      <span>{PAYMENT_METHOD_LABELS[sp.method]}</span>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-semibold tabular-nums">{formatFCFA(sp.amount)}</span>
                        <button
                          type="button"
                          onClick={() => setSplits((p) => p.filter((_, i) => i !== idx))}
                          className="text-red-600"
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <button
                type="button"
                disabled={cart.length === 0 || !hasPerm(PERMISSIONS.SALE_CREATE)}
                onClick={handleCheckout}
                className="mt-2 flex min-h-[50px] w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Check className="h-4 w-4" />
                {!hasPerm(PERMISSIONS.SALE_CREATE)
                  ? 'Mode supervision (Gérant uniquement)'
                  : isOnline
                  ? `Encaisser & Émettre Ticket (${formatFCFA(grandTotal)})`
                  : `Valider Hors-Ligne (${formatFCFA(grandTotal)})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {subTab === 'history' && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                Journal des ventes & factures
              </h2>
              <p className="text-xs text-slate-500 tabular-nums">
                {filteredSales.length} vente(s) correspondante(s) sur {snapshot.sales.length}
              </p>
            </div>
            <button
              type="button"
              onClick={handleExportSales}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200"
            >
              <Download className="h-3.5 w-3.5" />
              Exporter CSV / Excel
            </button>
          </div>

          {/* Advanced Multi-Criteria Filter Bar */}
          <div className="mb-4 grid grid-cols-1 gap-2.5 rounded-xl border border-slate-200/80 bg-slate-50/70 p-3 sm:grid-cols-2 lg:grid-cols-6 dark:border-slate-800 dark:bg-slate-800/40">
            <div className="relative lg:col-span-2">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
                placeholder="Facture, ticket, client, SKU..."
                className="min-h-[36px] w-full rounded-lg border border-slate-200 bg-white pl-8 pr-3 text-xs dark:border-slate-700 dark:bg-slate-900"
              />
            </div>
            <select
              value={historyStatus}
              onChange={(e) => setHistoryStatus(e.target.value as 'ALL' | Sale['status'])}
              className="min-h-[36px] rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium dark:border-slate-700 dark:bg-slate-900"
            >
              <option value="ALL">Tous statuts</option>
              <option value="VALIDEE">Validée</option>
              <option value="EN_ATTENTE_VALIDATION">En attente</option>
              <option value="ANNULEE">Annulée</option>
            </select>
            <select
              value={historyPayment}
              onChange={(e) => setHistoryPayment(e.target.value as 'ALL' | PaymentMethod)}
              className="min-h-[36px] rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium dark:border-slate-700 dark:bg-slate-900"
            >
              <option value="ALL">Tous paiements</option>
              {(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map((m) => (
                <option key={m} value={m}>
                  {PAYMENT_METHOD_LABELS[m]}
                </option>
              ))}
            </select>
            <select
              value={historyFlag}
              onChange={(e) => setHistoryFlag(e.target.value as 'ALL' | 'OFFLINE' | 'DELIVERY' | 'WITH_DEPOSIT')}
              className="min-h-[36px] rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium dark:border-slate-700 dark:bg-slate-900"
            >
              <option value="ALL">Tous types de vente</option>
              <option value="WITH_DEPOSIT">Avec caution casiers</option>
              <option value="DELIVERY">À livrer en tournée</option>
              <option value="OFFLINE">Origine Hors-ligne</option>
            </select>
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                aria-label="Date début"
                value={historyDateFrom}
                onChange={(e) => setHistoryDateFrom(e.target.value)}
                className="min-h-[36px] w-full rounded-lg border border-slate-200 bg-white px-2 font-mono text-[11px] dark:border-slate-700 dark:bg-slate-900"
              />
              <input
                type="date"
                aria-label="Date fin"
                value={historyDateTo}
                onChange={(e) => setHistoryDateTo(e.target.value)}
                className="min-h-[36px] w-full rounded-lg border border-slate-200 bg-white px-2 font-mono text-[11px] dark:border-slate-700 dark:bg-slate-900"
              />
              {hasActiveHistoryFilters && (
                <button
                  type="button"
                  onClick={resetHistoryFilters}
                  title="Réinitialiser les filtres"
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:text-red-600 dark:border-slate-700 dark:bg-slate-900"
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
                  <th className="py-2.5">Facture / Ticket</th>
                  <th className="py-2.5">Date</th>
                  <th className="py-2.5">Client</th>
                  <th className="py-2.5">Statut</th>
                  <th className="py-2.5 text-right">Liquide</th>
                  <th className="py-2.5 text-right">Caution</th>
                  <th className="py-2.5 text-right">Total TTC</th>
                  <th className="py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {salesPagination.paginatedItems.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-xs text-slate-400">
                      <Filter className="mx-auto mb-1.5 h-5 w-5 opacity-50" />
                      Aucune vente ne correspond à ces critères de recherche.
                    </td>
                  </tr>
                ) : (
                  salesPagination.paginatedItems.map((s) => {
                    const cust = snapshot.customers.find((c) => c.id === s.customerId);
                    return (
                      <tr key={s.id} className="h-11 hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                        <td className="py-2 font-mono text-xs font-semibold text-slate-900 dark:text-white">
                          {s.docNumber}
                          {s.offlineOriginated && (
                            <span className="ml-1.5 text-[10px] font-medium text-amber-700">· Hors-ligne</span>
                          )}
                        </td>
                        <td className="py-2 text-xs text-slate-500 tabular-nums">{formatDateTimeFR(s.createdAt)}</td>
                        <td className="py-2 font-medium text-slate-800 dark:text-slate-200">{cust?.name}</td>
                        <td className="py-2 text-xs font-semibold">
                          <span className={s.status === 'ANNULEE' ? 'text-red-600' : 'text-emerald-700 dark:text-emerald-400'}>
                            {s.status}
                          </span>
                        </td>
                        <td className="py-2 text-right font-mono tabular-nums">{formatFCFA(s.liquidTotal)}</td>
                        <td className="py-2 text-right font-mono text-amber-700 tabular-nums">
                          {formatFCFA(s.depositNetTotal)}
                        </td>
                        <td className="py-2 text-right font-mono font-bold tabular-nums">{formatFCFA(s.grandTotal)}</td>
                        <td className="py-2 text-right">
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => setReceiptSale(s)}
                              className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 whitespace-nowrap"
                            >
                              <Printer className="h-3.5 w-3.5" />
                              Imprimer Ticket
                            </button>
                            {s.status === 'EN_ATTENTE_VALIDATION' && hasPerm(PERMISSIONS.SALE_VALIDATE) && (
                              <button
                                type="button"
                                onClick={() => handleValidateSale(s.id, s.docNumber)}
                                className="inline-flex items-center gap-1 rounded bg-emerald-700 px-2 py-1 text-xs font-semibold text-white hover:bg-emerald-800 whitespace-nowrap"
                              >
                                <Check className="h-3.5 w-3.5" />
                                Valider
                              </button>
                            )}
                            {s.status === 'VALIDEE' &&
                              (hasPerm(PERMISSIONS.SALE_CANCEL) || hasPerm(PERMISSIONS.SALE_CANCEL_CLOSED)) && (
                                <button
                                  type="button"
                                  onClick={() => setCancelSaleTarget(s)}
                                  className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 whitespace-nowrap"
                                  title="Demander l’annulation (approbation requise)"
                                >
                                  <RotateCcw className="h-3.5 w-3.5" />
                                  Annuler
                                </button>
                              )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <TablePagination
            page={salesPagination.page}
            totalPages={salesPagination.totalPages}
            pageSize={salesPagination.pageSize}
            totalItems={salesPagination.totalItems}
            startIndex={salesPagination.startIndex}
            endIndex={salesPagination.endIndex}
            onPageChange={salesPagination.setPage}
            onPageSizeChange={salesPagination.setPageSize}
            itemLabel="ventes"
          />
        </div>
      )}

      {subTab === 'cash' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              {activeCash ? `Caisse ouverte : ${activeCash.docNumber}` : 'Ouvrir une session de caisse'}
            </h2>
            {activeCash ? (
              <div className="mt-4 space-y-3">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800">
                    <p className="text-xs text-slate-500">Fond de caisse initial</p>
                    <p className="mt-1 font-mono font-bold tabular-nums">{formatFCFA(activeCash.openingFloat)}</p>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800">
                    <p className="text-xs text-slate-500">Ventes espèces</p>
                    <p className="mt-1 font-mono font-bold tabular-nums">{formatFCFA(activeCash.totalCashSales)}</p>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800">
                    <p className="text-xs text-slate-500">Encaissements Mobile Money</p>
                    <p className="mt-1 font-mono font-bold tabular-nums">{formatFCFA(activeCash.totalMobileMoney)}</p>
                  </div>
                  <div className="rounded-lg bg-emerald-50 p-3 dark:bg-emerald-950/40">
                    <p className="text-xs text-emerald-800 dark:text-emerald-300">Espèces théoriques attendues</p>
                    <p className="mt-1 font-mono text-lg font-bold text-emerald-900 tabular-nums dark:text-emerald-200">
                      {formatFCFA(activeCash.expectedCash)}
                    </p>
                  </div>
                </div>

                {hasPerm(PERMISSIONS.CASH_CLOSE) ? (
                  <div className="space-y-3 border-t border-slate-100 pt-4 dark:border-slate-800">
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Comptage physique espèces (FCFA)
                    </label>
                    <input
                      type="number"
                      value={countedCash}
                      onChange={(e) => setCountedCash(e.target.value)}
                      placeholder="Ex: 348000"
                      className="min-h-[44px] w-full rounded-lg border border-slate-200 px-3 font-mono text-base font-bold tabular-nums dark:border-slate-700 dark:bg-slate-800"
                    />
                    {countedCash !== '' && (
                      <p
                        className={`font-mono text-xs font-semibold tabular-nums ${
                          Math.abs(Number(countedCash) - activeCash.expectedCash) >
                          snapshot.company.cashVarianceAlertThreshold
                            ? 'text-red-600'
                            : 'text-emerald-700'
                        }`}
                      >
                        Écart calculé : {formatFCFA(Number(countedCash) - activeCash.expectedCash)}
                      </p>
                    )}
                    <input
                      type="text"
                      value={closeNotes}
                      onChange={(e) => setCloseNotes(e.target.value)}
                      placeholder="Observations de clôture (justificatif d’écart éventuel)"
                      className="min-h-[40px] w-full rounded-lg border border-slate-200 px-3 text-sm dark:border-slate-700 dark:bg-slate-800"
                    />
                    <button
                      type="button"
                      onClick={handleCloseCash}
                      className="flex min-h-[46px] w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 dark:bg-emerald-700"
                    >
                      <Lock className="h-4 w-4" />
                      Clôturer caisse & Générer Rapport Z
                    </button>
                  </div>
                ) : (
                  <p className="text-xs text-amber-700">
                    Mode supervision : la clôture physique de caisse est effectuée par le Gérant du dépôt.
                  </p>
                )}
              </div>
            ) : pendingValidationCash ? (
              <div className="mt-4 space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                <p className="font-semibold">
                  Session {pendingValidationCash.docNumber} en attente de validation Propriétaire
                </p>
                <p className="tabular-nums">
                  Compté : {formatFCFA(pendingValidationCash.countedCash || 0)} · Écart :{' '}
                  {formatFCFA(pendingValidationCash.variance || 0)}. Un valideur distinct (Propriétaire ou Gérant délégué) doit confirmer la clôture Z.
                </p>
                {hasPerm(PERMISSIONS.CASH_CLOSE_VALIDATE) &&
                  pendingValidationCash.cashierId !== currentUser?.id &&
                  pendingValidationCash.closedBy !== currentUser?.id && (
                    <button
                      type="button"
                      onClick={() =>
                        handleValidateCashSession(pendingValidationCash.id, pendingValidationCash.docNumber)
                      }
                      className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-emerald-700 px-3.5 text-xs font-semibold text-white hover:bg-emerald-800"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      Valider la clôture Z
                    </button>
                  )}
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                <label className="block text-xs font-semibold text-slate-600">Fond de caisse initial (FCFA)</label>
                <input
                  type="number"
                  value={openingFloat}
                  onChange={(e) => setOpeningFloat(Number(e.target.value))}
                  className="min-h-[44px] w-full rounded-lg border border-slate-200 px-3 font-mono text-base font-bold tabular-nums dark:border-slate-700 dark:bg-slate-800"
                />
                <button
                  type="button"
                  disabled={!hasPerm(PERMISSIONS.CASH_OPEN)}
                  onClick={handleOpenCash}
                  className="flex min-h-[46px] w-full items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                >
                  <Unlock className="h-4 w-4" />
                  {hasPerm(PERMISSIONS.CASH_OPEN)
                    ? 'Ouvrir la caisse'
                    : 'Ouverture réservée au Gérant de dépôt'}
                </button>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              Historique des Rapports Z (Sessions clôturées)
            </h2>
            <div className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
              {snapshot.cashSessions
                .filter((cs) => selectedWarehouseId === 'ALL' || cs.warehouseId === selectedWarehouseId)
                .map((cs) => (
                  <div key={cs.id} className="py-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono font-semibold text-slate-900 dark:text-white">
                        {cs.docNumber} · {cs.cashierName}
                      </span>
                      <span
                        className={`text-xs font-semibold ${
                          cs.status === 'OUVERTE'
                            ? 'text-emerald-700'
                            : cs.status === 'EN_ATTENTE_VALIDATION'
                            ? 'text-amber-700'
                            : 'text-slate-500'
                        }`}
                      >
                        {cs.status}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500 tabular-nums">
                      Ouverture : {formatDateTimeFR(cs.openedAt)} · Attendu : {formatFCFA(cs.expectedCash)}
                      {cs.countedCash !== null &&
                        ` · Compté : ${formatFCFA(cs.countedCash)} · Écart : ${formatFCFA(cs.variance || 0)}`}
                    </p>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}

      {/* Cancel Sale Request Modal (Separation of duties) */}
      {cancelSaleTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <form
            onSubmit={handleRequestCancelSale}
            className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-800 dark:bg-slate-900"
          >
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              Demande d’annulation · {cancelSaleTarget.docNumber}
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              Séparation des tâches : un Gérant ou Administrateur distinct devra approuver cette annulation avant la remise en stock.
            </p>
            <textarea
              required
              rows={3}
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Motif exact de l’annulation (ex: Erreur de saisie client / Retour immédiat)"
              className="mt-3 w-full rounded-lg border border-slate-200 p-2.5 text-sm dark:border-slate-700 dark:bg-slate-800"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setCancelSaleTarget(null);
                  setCancelReason('');
                }}
                className="min-h-[40px] rounded-lg border border-slate-200 px-4 text-xs font-semibold dark:border-slate-700"
              >
                Fermer
              </button>
              <button
                type="submit"
                className="min-h-[40px] rounded-lg bg-red-600 px-4 text-xs font-semibold text-white hover:bg-red-700"
              >
                Soumettre pour validation
              </button>
            </div>
          </form>
        </div>
      )}
      </div>

      {/* Confirmed Sale View & Dedicated 80mm Thermal Receipt Print Layout */}
      {receiptSale && (() => {
        const cust = snapshot.customers.find((c) => c.id === receiptSale.customerId);
        const cashierUser = snapshot.users.find((u) => u.id === receiptSale.createdBy);
        const warehouse = snapshot.warehouses.find((w) => w.id === receiptSale.warehouseId);
        const grossLiquid = receiptSale.lines.reduce((s, l) => s + l.lineLiquidTotal, 0);

        return (
          <div className="ticket-80mm-overlay fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/65 p-4 backdrop-blur-xs">
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ type: 'spring', stiffness: 420, damping: 30 }}
              className="ticket-80mm-card w-full max-w-[390px] rounded-2xl border border-slate-200 bg-white p-5 text-slate-900 shadow-2xl"
            >
              {/* Screen-only Confirmation Header */}
              <div className="no-print mb-4 flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50/90 px-3.5 py-2.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-700" />
                  <div className="min-w-0">
                    <p className="truncate text-xs font-bold text-emerald-950">
                      Vente validée et confirmée
                    </p>
                    <p className="font-mono text-[11px] text-emerald-800">
                      {receiptSale.docNumber} · Format ticket 80mm prêt
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setReceiptSale(null)}
                  className="rounded-lg p-1 text-emerald-800 hover:bg-emerald-100"
                  aria-label="Fermer confirmation"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Dedicated 80mm Thermal Paper Receipt Layout */}
              <div className="ticket-80mm-sheet mx-auto w-[80mm] max-w-full rounded-lg border border-dashed border-slate-300 bg-white p-3.5 font-mono text-[11px] leading-snug text-black">
                <div className="border-b border-dashed border-black pb-2.5 text-center">
                  <p className="text-sm font-bold uppercase tracking-tight">
                    {snapshot.company.companyName}
                  </p>
                  <p className="text-[10px]">
                    NCC : {snapshot.company.nccNumber} · {snapshot.company.taxRegime}
                  </p>
                  <p className="text-[10px]">
                    {warehouse?.name || 'Dépôt Principal Abidjan'}
                  </p>
                </div>

                <div className="space-y-0.5 border-b border-dashed border-black py-2 text-[10px]">
                  <div className="flex justify-between">
                    <span>TICKET N° :</span>
                    <span className="font-bold">{receiptSale.ticketNumber}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>FACTURE N° :</span>
                    <span className="font-bold">{receiptSale.docNumber}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>DATE :</span>
                    <span className="tabular-nums">{formatDateTimeFR(receiptSale.createdAt)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>CAISSIER :</span>
                    <span>{cashierUser?.name || receiptSale.createdBy}</span>
                  </div>
                  {(receiptSale.offlineOriginated || receiptSale.deliveryRequired) && (
                    <div className="pt-0.5 text-center font-bold">
                      {receiptSale.offlineOriginated ? '[SAISIE HORS-LIGNE]' : ''}
                      {receiptSale.offlineOriginated && receiptSale.deliveryRequired ? ' ' : ''}
                      {receiptSale.deliveryRequired ? '[À LIVRER EN TOURNÉE]' : ''}
                    </div>
                  )}
                </div>

                <div className="border-b border-dashed border-black py-2 text-[10px]">
                  <p className="font-bold">
                    CLIENT : {cust?.name || 'Client Comptoir'}
                  </p>
                  <p>
                    Code : {cust?.code || 'CPT'} · Tarif : {cust?.pricingTier || 'DETAIL'}
                  </p>
                  {cust && cust.id !== 'cust-comptoir' && (
                    <p>
                      {cust.zone} · {cust.phone}
                    </p>
                  )}
                </div>

                <div className="border-b border-dashed border-black py-2">
                  <div className="mb-1 flex justify-between border-b border-dotted border-slate-400 pb-0.5 text-[10px] font-bold">
                    <span>ARTICLE × QTÉ</span>
                    <span>MONTANT</span>
                  </div>
                  <div className="space-y-1.5">
                    {receiptSale.lines.map((l, idx) => {
                      const pkg = snapshot.packagings.find((p) => p.id === l.packagingId);
                      return (
                        <div key={idx} className="text-[11px]">
                          <div className="flex justify-between gap-2 font-semibold">
                            <span>
                              {l.qty}× {pkg?.label || l.packagingId}
                            </span>
                            <span className="shrink-0 tabular-nums">
                              {formatFCFA(l.lineLiquidTotal)}
                            </span>
                          </div>
                          <div className="flex justify-between text-[10px] text-slate-700">
                            <span>
                              {pkg?.sku} @ {formatFCFA(l.unitPrice)}
                            </span>
                            {pkg?.isReturnable && (
                              <span className="tabular-nums">
                                Vides:{l.emptyCratesReturnedNow} · Caut:{formatFCFA(l.depositCharged)}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-0.5 border-b border-dashed border-black py-2 text-[11px]">
                  {receiptSale.discountAmount > 0 && (
                    <>
                      <div className="flex justify-between">
                        <span>Sous-total liquide</span>
                        <span className="tabular-nums">{formatFCFA(grossLiquid)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Remise{receiptSale.discountReason ? ` (${receiptSale.discountReason})` : ''}</span>
                        <span className="tabular-nums">-{formatFCFA(receiptSale.discountAmount)}</span>
                      </div>
                    </>
                  )}
                  <div className="flex justify-between">
                    <span>Total Liquide</span>
                    <span className="tabular-nums">{formatFCFA(receiptSale.liquidTotal)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Cautions Casiers Nettes</span>
                    <span className="tabular-nums">{formatFCFA(receiptSale.depositNetTotal)}</span>
                  </div>
                  <div className="mt-1 flex justify-between border-t border-black pt-1 text-sm font-bold">
                    <span>NET À PAYER</span>
                    <span className="tabular-nums">{formatFCFA(receiptSale.grandTotal)}</span>
                  </div>
                </div>

                <div className="space-y-0.5 border-b border-dashed border-black py-2 text-[10px]">
                  <p className="font-bold">RÈGLEMENT(S) :</p>
                  {receiptSale.payments.map((p, i) => (
                    <div key={i} className="flex justify-between">
                      <span>
                        {PAYMENT_METHOD_LABELS[p.method]}
                        {p.reference ? ` (${p.reference})` : ''}
                      </span>
                      <span className="font-semibold tabular-nums">{formatFCFA(p.amount)}</span>
                    </div>
                  ))}
                  {receiptSale.creditAdded > 0 && (
                    <div className="flex justify-between font-bold">
                      <span>Ajouté au compte crédit :</span>
                      <span className="tabular-nums">{formatFCFA(receiptSale.creditAdded)}</span>
                    </div>
                  )}
                </div>

                {cust && cust.id !== 'cust-comptoir' && (
                  <div className="border-b border-dashed border-black py-1.5 text-[10px]">
                    <div className="flex justify-between">
                      <span>Parc casiers client :</span>
                      <span className="font-bold tabular-nums">{cust.consignmentCrates} casiers</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Encours crédit total :</span>
                      <span className="font-bold tabular-nums">{formatFCFA(cust.creditBalance)}</span>
                    </div>
                  </div>
                )}

                <div className="pt-2 text-center text-[10px]">
                  <p className="font-bold">Merci pour votre confiance !</p>
                  <p>Conservez ce ticket pour le retour de vos casiers consignés.</p>
                  <p className="mt-1 text-[9px] text-slate-600">
                    GestDepot ERP · DGI Côte d’Ivoire · {receiptSale.status}
                  </p>
                </div>
              </div>

              {/* Screen-only Action Buttons */}
              <div className="no-print mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex min-h-[42px] flex-1 items-center justify-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-white shadow-sm hover:bg-slate-800 whitespace-nowrap"
                >
                  <Printer className="h-4 w-4" />
                  Imprimer Ticket
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setReceiptSale(null);
                    setSubTab('pos');
                    setQuickScanEnabled(true);
                    setTimeout(() => scanInputRef.current?.focus(), 80);
                  }}
                  className="min-h-[42px] rounded-xl bg-emerald-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-800 whitespace-nowrap"
                >
                  Nouvelle vente
                </button>
                <button
                  type="button"
                  onClick={() => setReceiptSale(null)}
                  className="min-h-[42px] rounded-xl border border-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                >
                  Fermer
                </button>
              </div>
            </motion.div>
          </div>
        );
      })()}
    </div>
  );
};
