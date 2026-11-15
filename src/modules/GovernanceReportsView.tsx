import React, { useMemo, useState } from 'react';
import {
  Building2,
  Check,
  CheckCircle2,
  Clock,
  Download,
  Printer,
  RefreshCw,
  RotateCcw,
  Search,
  Shield,
  ShieldCheck,
  Upload,
  X,
} from 'lucide-react';
import { TablePagination, usePagination } from '../components/TablePagination';
import { useErp } from '../context/ErpContext';
import { exportToCsv, formatDateTimeFR, formatFCFA, formatNumberFR } from '../lib/format';
import {
  PERMISSIONS,
  RBAC_MATRIX,
  ROLE_LABELS,
  type PermissionKey,
  type ReconciliationPV,
  type RoleCode,
} from '../types/erp';

export const ReportsView: React.FC = () => {
  const { snapshot, hasPerm, selectedWarehouseId } = useErp();
  const [pvSearch, setPvSearch] = useState('');
  const [pvTypeFilter, setPvTypeFilter] = useState<'ALL' | ReconciliationPV['type']>('ALL');

  const scopedSales = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.sales.filter(
      (s) =>
        s.status === 'VALIDEE' &&
        (selectedWarehouseId === 'ALL' || s.warehouseId === selectedWarehouseId)
    );
  }, [snapshot, selectedWarehouseId]);

  const scopedCredits = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.credits.filter(
      (c) =>
        selectedWarehouseId === 'ALL' || !c.warehouseId || c.warehouseId === selectedWarehouseId
    );
  }, [snapshot, selectedWarehouseId]);

  const filteredReconciliations = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.reconciliations.filter((pv) => {
      if (selectedWarehouseId !== 'ALL' && pv.warehouseId && pv.warehouseId !== selectedWarehouseId) {
        return false;
      }
      if (pvTypeFilter !== 'ALL' && pv.type !== pvTypeFilter) return false;
      if (pvSearch.trim()) {
        const q = pvSearch.toLowerCase();
        return (
          pv.docNumber.toLowerCase().includes(q) ||
          pv.periodLabel.toLowerCase().includes(q) ||
          pv.signedBy.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [snapshot, selectedWarehouseId, pvSearch, pvTypeFilter]);

  const pvPagination = usePagination(filteredReconciliations, 6);

  if (!snapshot) return null;

  const totalCa = scopedSales.reduce((sum, s) => sum + s.liquidTotal, 0);
  const totalCost = scopedSales.reduce((sum, s) => {
    return (
      sum +
      s.lines.reduce((ls, line) => {
        const pkg = snapshot.packagings.find((p) => p.id === line.packagingId);
        return ls + (pkg ? pkg.purchasePrice * line.qty : 0);
      }, 0)
    );
  }, 0);
  const margin = totalCa - totalCost;
  const totalDepositsClients = snapshot.customers.reduce((s, c) => s + c.consignmentDepositDue, 0);

  const exportGlobalSummary = () => {
    exportToCsv(
      `rapport-synthese-${selectedWarehouseId}-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Indicateur', 'Valeur'],
      [
        ['Périmètre dépôt', selectedWarehouseId === 'ALL' ? 'Tous dépôts' : selectedWarehouseId],
        ['Chiffre d’affaires liquide cumulé', totalCa],
        ['Coût d’achat marchandises', totalCost],
        ['Marge brute cumulée', margin],
        ['Cautions casiers dues par clients', totalDepositsClients],
        ['Créances clients ouvertes', scopedCredits.reduce((s, c) => s + c.remainingAmount, 0)],
        ['PV de réconciliation signés', filteredReconciliations.length],
      ]
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            Rapports Décisionnels, PV & Exports
          </h1>
          <p className="text-xs text-slate-500">
            Synthèse comptable Sage/Excel, Rapports Z, PV quotidiens/hebdomadaires/mensuels brasserie
          </p>
        </div>
        <div className="no-print flex gap-2">
          {hasPerm(PERMISSIONS.ACCOUNTING_EXPORT) && (
            <button
              type="button"
              onClick={exportGlobalSummary}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 whitespace-nowrap shrink-0"
            >
              <Download className="h-3.5 w-3.5" />
              Export Comptable CSV
            </button>
          )}
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 text-xs font-semibold text-white dark:bg-emerald-700 whitespace-nowrap shrink-0"
          >
            <Printer className="h-3.5 w-3.5" />
            Imprimer / PDF
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs text-slate-500">CA Liquide Cumulé</p>
          <p className="mt-1 font-mono text-xl font-bold tabular-nums">{formatFCFA(totalCa)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs text-slate-500">Marge Brute Cumulée</p>
          <p className="mt-1 font-mono text-xl font-bold text-emerald-700 tabular-nums">{formatFCFA(margin)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs text-slate-500">Taux de marge moyen</p>
          <p className="mt-1 font-mono text-xl font-bold tabular-nums">
            {totalCa > 0 ? ((margin / totalCa) * 100).toFixed(1) : '0.0'} %
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs text-slate-500">PV Réconciliations signés</p>
          <p className="mt-1 font-mono text-xl font-bold tabular-nums">{filteredReconciliations.length}</p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            Procès-Verbaux de Réconciliation Signés (Quotidien, Hebdo, Mensuel Brasserie)
          </h2>
          <div className="no-print flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={pvSearch}
                onChange={(e) => setPvSearch(e.target.value)}
                placeholder="N° PV, période, signataire..."
                className="min-h-[36px] rounded-lg border border-slate-200 bg-white pl-8 pr-3 text-xs dark:border-slate-700 dark:bg-slate-800"
              />
            </div>
            <select
              value={pvTypeFilter}
              onChange={(e) => setPvTypeFilter(e.target.value as 'ALL' | ReconciliationPV['type'])}
              className="min-h-[36px] rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold dark:border-slate-700 dark:bg-slate-800"
            >
              <option value="ALL">Tous types de PV</option>
              <option value="QUOTIDIENNE_CAISSE">Quotidienne Caisse</option>
              <option value="HEBDOMADAIRE_STOCK">Hebdomadaire Stock</option>
              <option value="MENSUELLE_BRASSERIE">Mensuelle Brasserie</option>
            </select>
            {(pvSearch || pvTypeFilter !== 'ALL') && (
              <button
                type="button"
                onClick={() => {
                  setPvSearch('');
                  setPvTypeFilter('ALL');
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
                <th className="py-2">PV N°</th>
                <th className="py-2">Type · Période</th>
                <th className="py-2 text-right">Système</th>
                <th className="py-2 text-right">Physique / Externe</th>
                <th className="py-2 text-right">Écart</th>
                <th className="py-2">Signataire</th>
                <th className="py-2">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {pvPagination.paginatedItems.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-xs text-slate-400">
                    Aucun PV correspondant.
                  </td>
                </tr>
              ) : (
                pvPagination.paginatedItems.map((pv) => (
                  <tr key={pv.id} className="h-11">
                    <td className="py-2 font-mono text-xs font-bold">{pv.docNumber}</td>
                    <td className="py-2">
                      <p className="text-xs font-semibold">{pv.type}</p>
                      <p className="text-xs text-slate-500">{pv.periodLabel}</p>
                    </td>
                    <td className="py-2 text-right font-mono text-xs tabular-nums">{formatNumberFR(pv.systemValue)}</td>
                    <td className="py-2 text-right font-mono text-xs tabular-nums">{formatNumberFR(pv.physicalOrExternalValue)}</td>
                    <td className={`py-2 text-right font-mono text-xs font-bold tabular-nums ${pv.variance !== 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
                      {pv.variance}
                    </td>
                    <td className="py-2 text-xs">{pv.signedBy} ({pv.signedRole})</td>
                    <td className="py-2 text-xs text-slate-500 tabular-nums">{formatDateTimeFR(pv.signedAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <TablePagination
          page={pvPagination.page}
          totalPages={pvPagination.totalPages}
          pageSize={pvPagination.pageSize}
          totalItems={pvPagination.totalItems}
          startIndex={pvPagination.startIndex}
          endIndex={pvPagination.endIndex}
          onPageChange={pvPagination.setPage}
          onPageSizeChange={pvPagination.setPageSize}
          itemLabel="PV"
        />
      </div>
    </div>
  );
};

const PERMISSION_LABELS: { key: PermissionKey; label: string }[] = [
  { key: PERMISSIONS.WAREHOUSE_MANAGE, label: 'Gérer dépôts / entrepôts' },
  { key: PERMISSIONS.USER_CREATE, label: 'Créer / administrer utilisateurs' },
  { key: PERMISSIONS.PRICE_UPDATE, label: 'Modifier tarifs & consignes' },
  { key: PERMISSIONS.CREDIT_LIMIT_UPDATE, label: 'Modifier plafonds de crédit' },
  { key: PERMISSIONS.CREDIT_WRITE_OFF, label: 'Abandonner une créance irrécouvrable' },
  { key: PERMISSIONS.DELEGATION_MANAGE, label: 'Accorder délégations temporaires' },
  { key: PERMISSIONS.ACCOUNTING_EXPORT, label: 'Export comptable global CSV' },
  { key: PERMISSIONS.CASH_CLOSE_VALIDATE, label: 'Valider clôtures Z & écarts tournée' },
  { key: PERMISSIONS.SALE_DISCOUNT_OVER_5, label: 'Valider remise > 5%' },
  { key: PERMISSIONS.STOCK_ADJUST_OVER_5, label: 'Valider écart inventaire > 5%' },
  { key: PERMISSIONS.SALE_CREATE, label: 'Créer vente comptoir POS' },
  { key: PERMISSIONS.CASH_OPEN, label: 'Ouvrir / Clôturer session caisse' },
  { key: PERMISSIONS.PURCHASE_RECEIVE, label: 'Réceptionner BL brasserie' },
  { key: PERMISSIONS.DELIVERY_PLAN, label: 'Planifier & valider remises tournées' },
  { key: PERMISSIONS.ROUTE_VIEW_OWN, label: 'Voir sa propre tournée (OwnRouteGuard)' },
  { key: PERMISSIONS.PAYMENT_COLLECT, label: 'Encaisser en caisse de tournée isolée' },
  { key: PERMISSIONS.BREAKAGE_REPORT, label: 'Déclarer casse terrain (+ photo)' },
  { key: PERMISSIONS.AUDIT_VIEW_ALL, label: 'Consulter journal d’audit global' },
];

const DELEGATABLE_PERMISSIONS: { key: PermissionKey; label: string }[] = [
  { key: PERMISSIONS.CASH_CLOSE_VALIDATE, label: 'Valider clôture caisse Z & écarts tournée' },
  { key: PERMISSIONS.SALE_DISCOUNT_OVER_5, label: 'Approuver remise exceptionnelle > 5%' },
  { key: PERMISSIONS.STOCK_ADJUST_OVER_5, label: 'Valider écart inventaire > 5%' },
  { key: PERMISSIONS.SALE_CANCEL_CLOSED, label: 'Annuler vente sur session clôturée' },
  { key: PERMISSIONS.CONSIGNMENT_LOSS_OVER, label: 'Approuver perte/remboursement caution > seuil' },
];

export const UsersRbacView: React.FC = () => {
  const { snapshot, currentUser, switchUser, mutateApi, hasPerm, notify } = useErp();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<RoleCode>('GERANT');
  const [warehouseId, setWarehouseId] = useState<string>('wh-main');
  const [pin, setPin] = useState('1234');

  // Delegation form
  const [delToUserId, setDelToUserId] = useState('usr-gerant-abobo');
  const [delPerm, setDelPerm] = useState<PermissionKey>(PERMISSIONS.CASH_CLOSE_VALIDATE);
  const [delEndsAt, setDelEndsAt] = useState(() => {
    const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
    return d.toISOString().slice(0, 16);
  });
  const [delReason, setDelReason] = useState('');

  if (!snapshot) return null;

  const activeWarehouses = snapshot.warehouses.filter((w) => !w.deletedAt && w.active);
  const activeGerants = snapshot.users.filter((u) => !u.deletedAt && u.active && u.role === 'GERANT');

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await mutateApi('/api/users', 'POST', {
      name,
      email,
      role,
      pin,
      warehouseId: role === 'PROPRIETAIRE' ? null : warehouseId,
    });
    if (res) {
      notify('success', 'Compte utilisateur créé.');
      setName('');
      setEmail('');
    }
  };

  const handleCreateDelegation = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await mutateApi('/api/delegations', 'POST', {
      toUserId: delToUserId,
      permissionCode: delPerm,
      endsAt: new Date(delEndsAt).toISOString(),
      reason: delReason.trim(),
    });
    if (res) {
      notify('success', 'Délégation temporaire activée.');
      setDelReason('');
    }
  };

  const handleRevokeDelegation = async (id: string) => {
    const res = await mutateApi(`/api/delegations/${id}`, 'DELETE');
    if (res) notify('success', 'Délégation révoquée.');
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
          Gouvernance 3 Profils, Délégations & Matrice RBAC
        </h1>
        <p className="text-xs text-slate-500">
          Architecture stricte : Propriétaire (Multi-dépôts), Gérant de dépôt (Isolation 1 dépôt), Livreur (Propre tournée uniquement)
        </p>
      </div>

      {/* User Cards + Role Switcher */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {snapshot.users
          .filter((u) => !u.deletedAt)
          .map((u) => {
            const isCurrent = u.id === currentUser?.id;
            const wh = snapshot.warehouses.find((w) => w.id === u.warehouseId);
            return (
              <div
                key={u.id}
                className={`rounded-xl border p-4 transition-colors ${
                  isCurrent
                    ? 'border-emerald-700 bg-emerald-50/50 dark:border-emerald-500 dark:bg-emerald-950/30'
                    : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-bold text-slate-900 dark:text-white">{u.name}</p>
                    <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                      {ROLE_LABELS[u.role]}
                    </p>
                    <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                      {wh ? `Dépôt : ${wh.name}` : 'Périmètre : Tous dépôts'}
                    </p>
                    <p className="mt-0.5 font-mono text-xs text-slate-500">
                      {u.email}
                      {currentUser?.role === 'PROPRIETAIRE' && ` · PIN ${u.pin}`}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => switchUser(u.id)}
                    className={`min-h-[36px] rounded-lg px-3 text-xs font-semibold whitespace-nowrap shrink-0 ${
                      isCurrent
                        ? 'bg-emerald-700 text-white'
                        : 'border border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200'
                    }`}
                  >
                    {isCurrent ? 'Session active' : 'Activer'}
                  </button>
                </div>
              </div>
            );
          })}
      </div>

      {hasPerm(PERMISSIONS.USER_CREATE) && (
        <form
          onSubmit={handleCreateUser}
          className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
        >
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">
            Créer un compte utilisateur (Propriétaire uniquement)
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-6">
            <input
              required
              placeholder="Nom complet"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="min-h-[40px] rounded-lg border border-slate-200 px-3 text-sm dark:border-slate-700 dark:bg-slate-800"
            />
            <input
              required
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="min-h-[40px] rounded-lg border border-slate-200 px-3 text-sm dark:border-slate-700 dark:bg-slate-800"
            />
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as RoleCode)}
              className="min-h-[40px] rounded-lg border border-slate-200 px-3 text-sm dark:border-slate-700 dark:bg-slate-800"
            >
              {(Object.keys(ROLE_LABELS) as RoleCode[]).map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
            <select
              disabled={role === 'PROPRIETAIRE'}
              value={role === 'PROPRIETAIRE' ? '' : warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
              className="min-h-[40px] rounded-lg border border-slate-200 px-3 text-sm disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800"
            >
              {role === 'PROPRIETAIRE' ? (
                <option value="">Multi-dépôts (Aucun dépôt fixe)</option>
              ) : (
                activeWarehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))
              )}
            </select>
            <input
              placeholder="PIN 4 chiffres"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              className="min-h-[40px] rounded-lg border border-slate-200 px-3 font-mono text-sm dark:border-slate-700 dark:bg-slate-800"
            />
            <button
              type="submit"
              className="min-h-[40px] rounded-lg bg-emerald-700 text-xs font-semibold text-white hover:bg-emerald-800 whitespace-nowrap"
            >
              Créer utilisateur
            </button>
          </div>
        </form>
      )}

      {/* Temporary Delegations */}
      {hasPerm(PERMISSIONS.DELEGATION_MANAGE) && (
        <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-emerald-700" />
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                Délégations Temporaires Bornées dans le Temps
              </h2>
              <p className="text-xs text-slate-500">
                Permet au Propriétaire de déléguer une validation sensible à un Gérant pour une durée limitée (ex: congés, déplacement). L’auto-validation reste bloquée.
              </p>
            </div>
          </div>

          <form onSubmit={handleCreateDelegation} className="grid grid-cols-1 gap-3 sm:grid-cols-5">
            <select
              value={delToUserId}
              onChange={(e) => setDelToUserId(e.target.value)}
              className="min-h-[40px] rounded-lg border border-slate-200 px-3 text-xs font-semibold dark:border-slate-700 dark:bg-slate-800"
            >
              {activeGerants.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} ({snapshot.warehouses.find((w) => w.id === g.warehouseId)?.zone || g.warehouseId})
                </option>
              ))}
            </select>
            <select
              value={delPerm}
              onChange={(e) => setDelPerm(e.target.value as PermissionKey)}
              className="min-h-[40px] rounded-lg border border-slate-200 px-3 text-xs font-semibold dark:border-slate-700 dark:bg-slate-800"
            >
              {DELEGATABLE_PERMISSIONS.map((dp) => (
                <option key={dp.key} value={dp.key}>
                  {dp.label}
                </option>
              ))}
            </select>
            <input
              type="datetime-local"
              value={delEndsAt}
              onChange={(e) => setDelEndsAt(e.target.value)}
              className="min-h-[40px] rounded-lg border border-slate-200 px-2.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-800"
            />
            <input
              required
              placeholder="Motif de la délégation..."
              value={delReason}
              onChange={(e) => setDelReason(e.target.value)}
              className="min-h-[40px] rounded-lg border border-slate-200 px-3 text-xs dark:border-slate-700 dark:bg-slate-800"
            />
            <button
              type="submit"
              className="min-h-[40px] rounded-lg bg-slate-900 px-3 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-emerald-700 whitespace-nowrap"
            >
              Accorder délégation
            </button>
          </form>

          {snapshot.delegations.length > 0 && (
            <div className="divide-y divide-slate-100 rounded-lg border border-slate-100 dark:divide-slate-800 dark:border-slate-800">
              {snapshot.delegations.map((del) => {
                const nowMs = Date.now();
                const isExpired = new Date(del.endsAt).getTime() <= nowMs;
                const isRevoked = Boolean(del.revokedAt);
                const statusLabel = isRevoked ? 'Révoquée' : isExpired ? 'Expirée' : 'Active';
                return (
                  <div key={del.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-xs">
                    <div>
                      <p className="font-semibold text-slate-900 dark:text-white">
                        {del.toUserName} · <span className="font-mono text-emerald-700">{del.permissionCode}</span>
                      </p>
                      <p className="text-slate-500">
                        {del.reason} · Expire le {formatDateTimeFR(del.endsAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`font-semibold ${
                          isRevoked || isExpired ? 'text-slate-400' : 'text-emerald-700 dark:text-emerald-400'
                        }`}
                      >
                        {statusLabel}
                      </span>
                      {!isRevoked && !isExpired && (
                        <button
                          type="button"
                          onClick={() => handleRevokeDelegation(del.id)}
                          className="rounded border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-50"
                        >
                          Révoquer
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* RBAC Matrix */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-3 flex items-center gap-2">
          <Shield className="h-5 w-5 text-emerald-700" />
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            Matrice des Permissions (3 Profils × Actions)
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500 dark:border-slate-800">
                <th className="py-2.5">Permission / Contrôle</th>
                {(Object.keys(ROLE_LABELS) as RoleCode[]).map((r) => (
                  <th key={r} className="py-2.5 text-center font-semibold">
                    {r}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {PERMISSION_LABELS.map((p) => (
                <tr key={p.key} className="h-9">
                  <td className="py-1.5 font-medium text-slate-800 dark:text-slate-200">{p.label}</td>
                  {(Object.keys(ROLE_LABELS) as RoleCode[]).map((r) => {
                    const allowed = RBAC_MATRIX[r].includes(p.key);
                    return (
                      <td key={r} className="py-1.5 text-center">
                        {allowed ? (
                          <Check className="mx-auto h-4 w-4 text-emerald-600" />
                        ) : (
                          <span className="text-slate-300 dark:text-slate-700">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Golden Governance Rules */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-3 flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-emerald-700 dark:text-emerald-400" />
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            Règles d’Or de Gouvernance — Enforcées côté serveur (Express)
          </h2>
        </div>
        <div className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2 lg:grid-cols-3">
          {[
            ['1. Propriétaire ≠ Opérateur comptoir', 'Le Propriétaire ne passe pas de vente POS ni d’ouverture/clôture de caisse : il contrôle, configure les prix/plafonds et valide.'],
            ['2. Isolation Dépôt (WarehouseScopeGuard)', 'Un Gérant est strictement cloisonné sur son dépôt (403 WAREHOUSE_FORBIDDEN sur tout autre dépôt).'],
            ['3. Isolation Tournée (OwnRouteGuard)', 'Un Livreur ne voit ni les marges/achats ni la caisse centrale, et uniquement sa propre tournée assignée.'],
            ['4. Mini-caisse de tournée isolée', 'Les encaissements terrain restent dans la caisse de tournée jusqu’au comptage contradictoire du Gérant.'],
            ['5. Remises > 5% & Écarts inventaire > 5%', 'Toute remise exceptionnelle > 5%, écart d’inventaire > 5% ou clôture Z est routé vers le Propriétaire.'],
            ['6. Preuve photo & non-conformité BL', 'Toute casse ou retour partiel livreur exige une photo obligatoire ; un BL sans signature déclenche une alerte audit.'],
          ].map(([title, desc]) => (
            <div key={title} className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-800/40">
              <p className="font-bold text-slate-900 dark:text-white">{title}</p>
              <p className="mt-1 text-slate-600 dark:text-slate-400">{desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export const AuditLogsView: React.FC = () => {
  const { snapshot, hasPerm, currentUser, notify, selectedWarehouseId } = useErp();
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'ALL' | RoleCode>('ALL');
  const [originFilter, setOriginFilter] = useState<'ALL' | 'OFFLINE' | 'ONLINE'>('ALL');
  const [entityFilter, setEntityFilter] = useState<string>('ALL');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [chainStatus, setChainStatus] = useState<{ valid: boolean; checkedCount: number; message: string } | null>(null);
  const [verifying, setVerifying] = useState(false);

  const entityTypes = useMemo(() => {
    if (!snapshot) return [];
    return Array.from(new Set(snapshot.auditLogs.map((l) => l.entityType))).sort();
  }, [snapshot]);

  const logs = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.auditLogs.filter((l) => {
      if (selectedWarehouseId !== 'ALL' && l.warehouseId && l.warehouseId !== selectedWarehouseId) return false;
      if (roleFilter !== 'ALL' && l.userRole !== roleFilter) return false;
      if (originFilter === 'OFFLINE' && !l.offlineOriginated) return false;
      if (originFilter === 'ONLINE' && l.offlineOriginated) return false;
      if (entityFilter !== 'ALL' && l.entityType !== entityFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        return (
          l.action.toLowerCase().includes(q) ||
          l.userName.toLowerCase().includes(q) ||
          l.documentNumber.toLowerCase().includes(q) ||
          l.entityType.toLowerCase().includes(q) ||
          l.deviceInfo.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [snapshot, selectedWarehouseId, roleFilter, originFilter, entityFilter, search]);

  const auditPagination = usePagination(logs, 10);

  if (!snapshot) return null;

  const canViewAudit =
    hasPerm(PERMISSIONS.AUDIT_VIEW_ALL) ||
    hasPerm(PERMISSIONS.AUDIT_VIEW_WAREHOUSE) ||
    hasPerm(PERMISSIONS.AUDIT_VIEW_OWN);

  if (!canViewAudit) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
        Accès restreint : votre profil ne dispose pas d’accès au journal d’audit.
      </div>
    );
  }

  const verifyChain = async () => {
    setVerifying(true);
    try {
      const res = await fetch('/api/audit/verify', {
        headers: { 'X-User-Id': currentUser?.id || 'usr-proprietaire' },
      });
      const data = await res.json();
      if (!res.ok) {
        notify('error', data.error || 'Vérification impossible.');
      } else {
        setChainStatus(data);
        notify(data.valid ? 'success' : 'error', data.message);
      }
    } catch {
      notify('error', 'Erreur réseau lors de la vérification SHA-256.');
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            Journal d’Audit Inviolable (Chaînage SHA-256)
          </h1>
          <p className="text-xs text-slate-500">
            {currentUser?.role === 'LIVREUR'
              ? 'Périmètre personnel : vos propres actions et événements de tournée'
              : currentUser?.role === 'GERANT'
              ? 'Périmètre dépôt : traces horodatées de votre entrepôt uniquement'
              : 'Périmètre global : traçabilité multi-dépôts · Chaînage cryptographique prevHash → hash'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={verifying}
            onClick={verifyChain}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-emerald-700 px-3.5 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            {verifying ? 'Vérification...' : 'Vérifier intégrité SHA-256'}
          </button>
          <button
            type="button"
            onClick={() =>
              exportToCsv(
                `audit-gestdepot-${new Date().toISOString().slice(0, 10)}.csv`,
                ['Horodatage', 'Utilisateur', 'Rôle', 'Action', 'Document', 'Entité', 'Hash SHA-256', 'Hors-ligne'],
                logs.map((l) => [
                  l.timestamp,
                  l.userName,
                  l.userRole,
                  l.action,
                  l.documentNumber,
                  l.entityType,
                  l.hash || '',
                  l.offlineOriginated ? 'Oui' : 'Non',
                ])
              )
            }
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 whitespace-nowrap shrink-0"
          >
            <Download className="h-3.5 w-3.5" />
            Exporter Audit CSV
          </button>
        </div>
      </div>

      {chainStatus && (
        <div
          className={`flex items-center gap-2 rounded-xl border px-4 py-3 text-xs font-semibold ${
            chainStatus.valid
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200'
              : 'border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200'
          }`}
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{chainStatus.message}</span>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-4 grid grid-cols-1 gap-2.5 rounded-xl border border-slate-200/80 bg-slate-50/70 p-3 sm:grid-cols-2 lg:grid-cols-5 dark:border-slate-800 dark:bg-slate-800/40">
          <div className="relative lg:col-span-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Action, utilisateur, N° document, appareil..."
              className="min-h-[38px] w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-xs dark:border-slate-700 dark:bg-slate-900"
            />
          </div>
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as 'ALL' | RoleCode)}
            className="min-h-[38px] rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold dark:border-slate-700 dark:bg-slate-900"
          >
            <option value="ALL">Tous rôles</option>
            {(Object.keys(ROLE_LABELS) as RoleCode[]).map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <select
            value={entityFilter}
            onChange={(e) => setEntityFilter(e.target.value)}
            className="min-h-[38px] rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold dark:border-slate-700 dark:bg-slate-900"
          >
            <option value="ALL">Toutes entités</option>
            {entityTypes.map((et) => (
              <option key={et} value={et}>
                {et}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-1.5">
            <select
              value={originFilter}
              onChange={(e) => setOriginFilter(e.target.value as 'ALL' | 'OFFLINE' | 'ONLINE')}
              className="min-h-[38px] w-full rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold dark:border-slate-700 dark:bg-slate-900"
            >
              <option value="ALL">Toutes origines</option>
              <option value="ONLINE">En ligne</option>
              <option value="OFFLINE">Hors-ligne sync</option>
            </select>
            {(search || roleFilter !== 'ALL' || entityFilter !== 'ALL' || originFilter !== 'ALL') && (
              <button
                type="button"
                onClick={() => {
                  setSearch('');
                  setRoleFilter('ALL');
                  setEntityFilter('ALL');
                  setOriginFilter('ALL');
                }}
                title="Réinitialiser filtres"
                className="inline-flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:text-red-600 dark:border-slate-700 dark:bg-slate-900"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {auditPagination.paginatedItems.length === 0 ? (
            <p className="py-8 text-center text-xs text-slate-400">
              Aucune trace d’audit correspondante.
            </p>
          ) : (
            auditPagination.paginatedItems.map((log) => (
              <div key={log.id} className="py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">
                      <span className="font-mono text-xs text-emerald-700 dark:text-emerald-400">{log.action}</span> ·{' '}
                      {log.documentNumber}
                    </p>
                    <p className="text-xs text-slate-500 tabular-nums">
                      {formatDateTimeFR(log.timestamp)} · {log.userName} ({log.userRole}) · {log.deviceInfo}
                      {log.offlineOriginated && ' · Origine Hors-Ligne'}
                      {log.hash && (
                        <span className="ml-2 font-mono text-[11px] text-slate-400">
                          · SHA-256: {log.hash.slice(0, 12)}…
                        </span>
                      )}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                    className="text-xs font-semibold text-slate-600 hover:text-slate-900 dark:text-slate-400"
                  >
                    {expandedId === log.id ? 'Masquer JSON' : 'Inspecter Avant / Après'}
                  </button>
                </div>
                {expandedId === log.id && (
                  <div className="mt-2 space-y-2 rounded-lg bg-slate-50 p-3 font-mono text-[11px] dark:bg-slate-800">
                    {log.hash && (
                      <div className="border-b border-slate-200 pb-2 text-[10px] text-slate-500 dark:border-slate-700">
                        <p>prevHash: {log.prevHash}</p>
                        <p>hash: {log.hash}</p>
                      </div>
                    )}
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <div>
                        <p className="mb-1 font-semibold text-slate-500">Avant :</p>
                        <pre className="overflow-x-auto whitespace-pre-wrap">{JSON.stringify(log.before, null, 2)}</pre>
                      </div>
                      <div>
                        <p className="mb-1 font-semibold text-slate-500">Après :</p>
                        <pre className="overflow-x-auto whitespace-pre-wrap">{JSON.stringify(log.after, null, 2)}</pre>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        <TablePagination
          page={auditPagination.page}
          totalPages={auditPagination.totalPages}
          pageSize={auditPagination.pageSize}
          totalItems={auditPagination.totalItems}
          startIndex={auditPagination.startIndex}
          endIndex={auditPagination.endIndex}
          onPageChange={auditPagination.setPage}
          onPageSizeChange={auditPagination.setPageSize}
          itemLabel="traces d’audit"
        />
      </div>
    </div>
  );
};

export const SettingsView: React.FC = () => {
  const {
    snapshot,
    mutateApi,
    hasPerm,
    notify,
    offlineQueue,
    syncNow,
    simulatedOffline,
    setSimulatedOffline,
  } = useErp();

  const [companyName, setCompanyName] = useState(snapshot?.company.companyName || '');
  const [nccNumber, setNccNumber] = useState(snapshot?.company.nccNumber || '');
  const [consignmentDays, setConsignmentDays] = useState(snapshot?.company.consignmentOverdueDays || 14);
  const [cashThreshold, setCashThreshold] = useState(snapshot?.company.cashVarianceAlertThreshold || 2000);
  const [autoValidateSaleThreshold, setAutoValidateSaleThreshold] = useState(
    snapshot?.company.autoValidateSaleThreshold || 200000
  );

  // Warehouse management (Propriétaire only)
  const [whName, setWhName] = useState('');
  const [whZone, setWhZone] = useState('');
  const [whAddress, setWhAddress] = useState('');

  if (!snapshot) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await mutateApi('/api/settings', 'PATCH', {
      companyName,
      nccNumber,
      consignmentOverdueDays: consignmentDays,
      cashVarianceAlertThreshold: cashThreshold,
      autoValidateSaleThreshold,
    });
    if (res) notify('success', 'Paramètres de gouvernance mis à jour.');
  };

  const handleCreateWarehouse = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await mutateApi('/api/warehouses', 'POST', {
      name: whName,
      zone: whZone,
      address: whAddress,
    });
    if (res) {
      notify('success', 'Nouvel entrepôt créé et initialisé sur le catalogue.');
      setWhName('');
      setWhZone('');
      setWhAddress('');
    }
  };

  const handleToggleWarehouse = async (id: string) => {
    const res = await mutateApi(`/api/warehouses/${id}`, 'PATCH');
    if (res) notify('success', 'Statut du dépôt mis à jour.');
  };

  const handleDownloadBackup = () => {
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gestdepot-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleRestoreFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const res = await mutateApi('/api/system/restore', 'POST', json);
      if (res) notify('success', 'Sauvegarde restaurée.');
    } catch {
      notify('error', 'Fichier JSON de sauvegarde invalide.');
    }
  };

  const handleResetDemo = async () => {
    const res = await mutateApi('/api/system/reset-demo', 'POST');
    if (res) notify('success', 'Données de démonstration Solibra / Brassivoire réinitialisées.');
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
          Paramétrage Société, Dépôts & Sauvegardes
        </h1>
        <p className="text-xs text-slate-500">
          Conformité fiscale DGI Côte d’Ivoire, gestion multi-dépôts, seuils de contrôle interne & mode hors-ligne PWA
        </p>
      </div>

      {/* Multi-Depot Management (Propriétaire only) */}
      {hasPerm(PERMISSIONS.WAREHOUSE_MANAGE) && (
        <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-emerald-700" />
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              Gestion des Dépôts / Entrepôts (Propriétaire uniquement)
            </h2>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {snapshot.warehouses
              .filter((w) => !w.deletedAt)
              .map((w) => (
                <div
                  key={w.id}
                  className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3.5 dark:border-slate-700 dark:bg-slate-800/60"
                >
                  <div>
                    <p className="text-sm font-bold text-slate-900 dark:text-white">
                      {w.name}
                      {w.isDefault && <span className="ml-1.5 text-[11px] font-medium text-emerald-700">(Principal)</span>}
                    </p>
                    <p className="text-xs text-slate-600 dark:text-slate-300">{w.zone}</p>
                    <p className="mt-0.5 text-[11px] text-slate-500">{w.address}</p>
                  </div>
                  <button
                    type="button"
                    disabled={w.isDefault}
                    onClick={() => handleToggleWarehouse(w.id)}
                    className={`rounded-lg px-2.5 py-1 text-xs font-semibold whitespace-nowrap shrink-0 disabled:opacity-40 ${
                      w.active
                        ? 'border border-emerald-200 bg-emerald-50 text-emerald-800'
                        : 'border border-slate-300 bg-white text-slate-600'
                    }`}
                  >
                    {w.active ? 'Actif' : 'Inactif'}
                  </button>
                </div>
              ))}
          </div>

          <form onSubmit={handleCreateWarehouse} className="grid grid-cols-1 gap-3 border-t border-slate-100 pt-3 sm:grid-cols-4 dark:border-slate-800">
            <input
              required
              placeholder="Nom du dépôt (ex: Dépôt Marcory)"
              value={whName}
              onChange={(e) => setWhName(e.target.value)}
              className="min-h-[40px] rounded-lg border border-slate-200 px-3 text-sm dark:border-slate-700 dark:bg-slate-800"
            />
            <input
              required
              placeholder="Zone (ex: Marcory Zone 4)"
              value={whZone}
              onChange={(e) => setWhZone(e.target.value)}
              className="min-h-[40px] rounded-lg border border-slate-200 px-3 text-sm dark:border-slate-700 dark:bg-slate-800"
            />
            <input
              required
              placeholder="Adresse"
              value={whAddress}
              onChange={(e) => setWhAddress(e.target.value)}
              className="min-h-[40px] rounded-lg border border-slate-200 px-3 text-sm dark:border-slate-700 dark:bg-slate-800"
            />
            <button
              type="submit"
              className="min-h-[40px] rounded-lg bg-emerald-700 px-4 text-xs font-semibold text-white hover:bg-emerald-800 whitespace-nowrap"
            >
              Ajouter un dépôt
            </button>
          </form>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <form onSubmit={handleSave} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-base font-bold">Identité fiscale & Seuils d’alerte</h2>
          <div>
            <label className="text-xs font-semibold text-slate-600">Raison sociale</label>
            <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} className="mt-1 min-h-[40px] w-full rounded-lg border border-slate-200 px-3 text-sm dark:border-slate-700 dark:bg-slate-800" />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-600">N° Compte Contribuable (NCC DGI CI)</label>
            <input value={nccNumber} onChange={(e) => setNccNumber(e.target.value)} className="mt-1 min-h-[40px] w-full rounded-lg border border-slate-200 px-3 font-mono text-sm dark:border-slate-700 dark:bg-slate-800" />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="text-xs font-semibold text-slate-600">Alerte casier (jours)</label>
              <input type="number" value={consignmentDays} onChange={(e) => setConsignmentDays(Number(e.target.value))} className="mt-1 min-h-[40px] w-full rounded-lg border border-slate-200 px-3 font-mono text-sm dark:border-slate-700 dark:bg-slate-800" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600">Seuil écart caisse</label>
              <input type="number" value={cashThreshold} onChange={(e) => setCashThreshold(Number(e.target.value))} className="mt-1 min-h-[40px] w-full rounded-lg border border-slate-200 px-3 font-mono text-sm dark:border-slate-700 dark:bg-slate-800" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600">Seuil validation vente</label>
              <input type="number" value={autoValidateSaleThreshold} onChange={(e) => setAutoValidateSaleThreshold(Number(e.target.value))} className="mt-1 min-h-[40px] w-full rounded-lg border border-slate-200 px-3 font-mono text-sm dark:border-slate-700 dark:bg-slate-800" />
            </div>
          </div>
          <button
            type="submit"
            disabled={!hasPerm(PERMISSIONS.SETTINGS_UPDATE)}
            className="min-h-[42px] rounded-lg bg-emerald-700 px-4 text-xs font-semibold text-white disabled:opacity-50"
          >
            Enregistrer les paramètres
          </button>
        </form>

        <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-base font-bold">Mode Offline-First & Sauvegardes</h2>
          <div className="rounded-lg bg-slate-50 p-3 text-xs space-y-2 dark:bg-slate-800">
            <div className="flex items-center justify-between">
              <span className="font-semibold">File d’attente IndexedDB</span>
              <span className="font-mono font-bold">{offlineQueue.length} opération(s)</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setSimulatedOffline(!simulatedOffline)}
                className={`rounded-lg px-3 py-1.5 font-semibold ${
                  simulatedOffline
                    ? 'bg-amber-600 text-white'
                    : 'border border-slate-300 bg-white text-slate-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200'
                }`}
              >
                {simulatedOffline ? 'Désactiver simulation hors-ligne' : 'Simuler coupure réseau terrain'}
              </button>
              <button
                type="button"
                onClick={syncNow}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-1.5 font-semibold text-white"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Synchroniser maintenant
              </button>
            </div>
          </div>

          <div className="space-y-2 border-t border-slate-100 pt-3 dark:border-slate-800">
            <p className="text-xs font-semibold text-slate-600">Sauvegarde & Restauration complète (JSON)</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleDownloadBackup}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold hover:bg-slate-50 dark:border-slate-700"
              >
                <Download className="h-3.5 w-3.5" />
                Télécharger Dump JSON
              </button>
              {hasPerm(PERMISSIONS.SETTINGS_UPDATE) && (
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold hover:bg-slate-50 dark:border-slate-700">
                  <Upload className="h-3.5 w-3.5" />
                  Restaurer JSON
                  <input type="file" accept=".json" onChange={handleRestoreFile} className="hidden" />
                </label>
              )}
              {hasPerm(PERMISSIONS.SETTINGS_UPDATE) && (
                <button
                  type="button"
                  onClick={handleResetDemo}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Réinitialiser démo Solibra
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
