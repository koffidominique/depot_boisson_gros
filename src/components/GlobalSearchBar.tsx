import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  FileText,
  Package,
  Search,
  ShoppingBag,
  Truck,
  Users,
  X,
} from 'lucide-react';
import { useErp, type NavModuleId } from '../context/ErpContext';
import { formatFCFA } from '../lib/format';

interface SearchResultItem {
  id: string;
  group: 'Produits' | 'Clients' | 'Ventes & Commandes';
  title: string;
  subtitle: string;
  meta: string;
  targetModule: NavModuleId;
  hint?: {
    salesTab?: 'pos' | 'history' | 'cash';
    focusQuickScan?: boolean;
    searchQuery?: string;
  };
}

export const GlobalSearchBar: React.FC = () => {
  const { snapshot, navigateWithHint, currentUser, activeWarehouseId } = useErp();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Ctrl+K / Cmd+K shortcut
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Close on outside click
  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, []);

  const results = useMemo<SearchResultItem[]>(() => {
    if (!snapshot) return [];
    const q = query.trim().toLowerCase();
    if (!q) return [];

    const list: SearchResultItem[] = [];
    const isDriver = currentUser?.role === 'LIVREUR';

    // 1. Products & Packagings
    snapshot.packagings
      .filter((p) => !p.deletedAt)
      .forEach((pkg) => {
        const prod = snapshot.products.find((pr) => pr.id === pkg.productId && !pr.deletedAt);
        if (!prod) return;
        const match =
          pkg.label.toLowerCase().includes(q) ||
          pkg.sku.toLowerCase().includes(q) ||
          prod.name.toLowerCase().includes(q) ||
          prod.brand.toLowerCase().includes(q);
        if (match) {
          const stk = snapshot.stocks.find(
            (s) => s.packagingId === pkg.id && s.warehouseId === activeWarehouseId
          );
          list.push({
            id: `prod-${pkg.id}`,
            group: 'Produits',
            title: pkg.label,
            subtitle: `${pkg.sku} · ${prod.brand}`,
            meta: `${formatFCFA(pkg.salePriceDetail)} · Stock ${stk?.qtyOnHand ?? 0}`,
            targetModule: 'products',
            hint: { searchQuery: pkg.sku },
          });
        }
      });

    // 2. Customers (hidden for Livreur except via own routes)
    if (!isDriver) {
      snapshot.customers
        .filter((c) => !c.deletedAt)
        .forEach((c) => {
          const match =
            c.name.toLowerCase().includes(q) ||
            c.code.toLowerCase().includes(q) ||
            c.zone.toLowerCase().includes(q) ||
            c.phone.toLowerCase().includes(q);
          if (match) {
            list.push({
              id: `cust-${c.id}`,
              group: 'Clients',
              title: c.name,
              subtitle: `${c.code} · ${c.zone} · ${c.pricingTier}`,
              meta: c.creditBalance > 0 ? `Crédit ${formatFCFA(c.creditBalance)}` : `${c.consignmentCrates} casiers`,
              targetModule: 'customers',
              hint: { searchQuery: c.name },
            });
          }
        });
    }

    // 3. Sales, Purchase Orders & Delivery Routes
    if (!isDriver) {
      snapshot.sales.forEach((s) => {
        const cust = snapshot.customers.find((c) => c.id === s.customerId);
        const match =
          s.docNumber.toLowerCase().includes(q) ||
          s.ticketNumber.toLowerCase().includes(q) ||
          (cust?.name.toLowerCase().includes(q) ?? false);
        if (match) {
          list.push({
            id: `sale-${s.id}`,
            group: 'Ventes & Commandes',
            title: `${s.docNumber} · ${cust?.name || 'Comptoir'}`,
            subtitle: `Ticket ${s.ticketNumber} · ${s.status}`,
            meta: formatFCFA(s.grandTotal),
            targetModule: 'sales',
            hint: { salesTab: 'history', searchQuery: s.docNumber },
          });
        }
      });

      snapshot.purchaseOrders.forEach((po) => {
        const sup = snapshot.suppliers.find((x) => x.id === po.supplierId);
        if (po.docNumber.toLowerCase().includes(q) || (sup?.name.toLowerCase().includes(q) ?? false)) {
          list.push({
            id: `po-${po.id}`,
            group: 'Ventes & Commandes',
            title: `${po.docNumber} · ${sup?.name || 'Fournisseur'}`,
            subtitle: `Bon de commande brasserie · ${po.status}`,
            meta: formatFCFA(po.totalLiquid),
            targetModule: 'purchases',
          });
        }
      });
    }

    snapshot.deliveryRoutes.forEach((r) => {
      if (
        r.docNumber.toLowerCase().includes(q) ||
        r.driverName.toLowerCase().includes(q) ||
        r.zone.toLowerCase().includes(q)
      ) {
        list.push({
          id: `rte-${r.id}`,
          group: 'Ventes & Commandes',
          title: `${r.docNumber} · Tournée ${r.zone}`,
          subtitle: `${r.driverName} · ${r.vehiclePlate}`,
          meta: r.status,
          targetModule: 'deliveries',
        });
      }
    });

    return list.slice(0, 10);
  }, [snapshot, query, currentUser, activeWarehouseId]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const handleSelect = (item: SearchResultItem) => {
    navigateWithHint(item.targetModule, item.hint);
    setOpen(false);
    setQuery('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
      return;
    }
    if (results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => (prev + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) => (prev - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const chosen = results[activeIndex];
      if (chosen) handleSelect(chosen);
    }
  };

  const groupIcon = (group: SearchResultItem['group']) => {
    if (group === 'Produits') return <Package className="h-4 w-4 text-emerald-600 shrink-0" />;
    if (group === 'Clients') return <Users className="h-4 w-4 text-blue-600 shrink-0" />;
    return <FileText className="h-4 w-4 text-amber-600 shrink-0" />;
  };

  const [mobileOpen, setMobileOpen] = useState(false);

  const renderDropdown = () => (
    <AnimatePresence>
      {open && query.trim().length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: -6, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -4, scale: 0.98 }}
          transition={{ type: 'spring', stiffness: 460, damping: 32 }}
          className="absolute left-0 right-0 top-11 z-50 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl ring-1 ring-slate-900/5 dark:border-slate-700 dark:bg-slate-900 dark:ring-white/10"
        >
          {results.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-slate-500 dark:text-slate-400">
              Aucun résultat pour « {query} » dans le dépôt.
            </div>
          ) : (
            <div className="max-h-96 overflow-y-auto divide-y divide-slate-100 p-1.5 dark:divide-slate-800">
              {results.map((item, idx) => {
                const isActive = idx === activeIndex;
                return (
                  <motion.button
                    key={item.id}
                    type="button"
                    whileHover={{ scale: 1.01, x: 2 }}
                    whileTap={{ scale: 0.99 }}
                    onMouseEnter={() => setActiveIndex(idx)}
                    onClick={() => {
                      handleSelect(item);
                      setMobileOpen(false);
                    }}
                    className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                      isActive
                        ? 'bg-emerald-50 text-emerald-950 dark:bg-emerald-950/60 dark:text-emerald-100'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      {groupIcon(item.group)}
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-slate-900 dark:text-white">
                          {item.title}
                        </p>
                        <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                          {item.group} · {item.subtitle}
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="font-mono text-[11px] font-semibold text-slate-600 tabular-nums dark:text-slate-300">
                        {item.meta}
                      </span>
                      {item.targetModule === 'sales' ? (
                        <ShoppingBag className="h-3.5 w-3.5 text-slate-400" />
                      ) : item.targetModule === 'deliveries' ? (
                        <Truck className="h-3.5 w-3.5 text-slate-400" />
                      ) : null}
                    </div>
                  </motion.button>
                );
              })}
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );

  return (
    <div ref={containerRef} className="relative flex items-center md:flex-1 md:max-w-md md:mx-2">
      {/* Mobile icon button */}
      <button
        type="button"
        onClick={() => {
          setMobileOpen((v) => !v);
          setOpen(true);
          setTimeout(() => inputRef.current?.focus(), 50);
        }}
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 md:hidden dark:border-slate-700 dark:text-slate-300"
        aria-label="Recherche globale"
      >
        <Search className="h-4 w-4" />
      </button>

      {/* Desktop inline input + mobile dropdown bar */}
      <div
        className={`${
          mobileOpen
            ? 'fixed left-3 right-3 top-16 z-50 block rounded-xl border border-slate-200 bg-white p-2 shadow-2xl md:static md:block md:w-full md:border-0 md:bg-transparent md:p-0 md:shadow-none dark:border-slate-700 dark:bg-slate-900'
            : 'hidden md:block md:w-full'
        }`}
      >
        <div className="relative flex items-center">
          <Search className="pointer-events-none absolute left-3 h-4 w-4 text-slate-400" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onFocus={() => setOpen(true)}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Rechercher produit, SKU, client, facture, BDC... (Ctrl+K)"
            className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50/90 pl-9 pr-14 text-xs text-slate-900 shadow-xs transition-all placeholder:text-slate-400 focus:border-emerald-600 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800/90 dark:text-white dark:focus:bg-slate-900"
          />
          {query || mobileOpen ? (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setMobileOpen(false);
                setOpen(false);
              }}
              className="absolute right-2 rounded p-0.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              aria-label="Effacer recherche"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : (
            <kbd className="pointer-events-none absolute right-2 hidden rounded border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-400 lg:inline-block dark:border-slate-700 dark:bg-slate-900">
              Ctrl K
            </kbd>
          )}
        </div>
        {renderDropdown()}
      </div>
    </div>
  );
};
