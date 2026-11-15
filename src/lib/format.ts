import { RBAC_MATRIX } from '../types/erp';
import type { Delegation, PaymentMethod, PermissionKey, RoleCode, UserAccount } from '../types/erp';

export function formatFCFA(amount: number): string {
  const rounded = Math.round(amount || 0);
  return `${rounded.toLocaleString('fr-FR')} FCFA`;
}

export function formatNumberFR(value: number): string {
  return Math.round(value || 0).toLocaleString('fr-FR');
}

export function formatDateTimeFR(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDateFR(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function daysSince(iso: string | null | undefined): number {
  if (!iso) return 0;
  const diff = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
}

export function getActiveDelegationsForUser(
  user: UserAccount | null | undefined,
  delegations: Delegation[] = []
): Delegation[] {
  if (!user) return [];
  const now = Date.now();
  return delegations.filter(
    (d) =>
      d.toUserId === user.id &&
      !d.revokedAt &&
      new Date(d.startsAt).getTime() <= now &&
      new Date(d.endsAt).getTime() >= now &&
      (!d.warehouseId || !user.warehouseId || d.warehouseId === user.warehouseId)
  );
}

export function canUser(
  user: UserAccount | null | undefined,
  perm: PermissionKey,
  delegations: Delegation[] = []
): boolean {
  if (!user) return false;
  if ((RBAC_MATRIX[user.role as RoleCode] || []).includes(perm)) return true;
  return getActiveDelegationsForUser(user, delegations).some((d) => d.permissionCode === perm);
}

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  ESPECES: 'Espèces',
  ORANGE_MONEY: 'Orange Money',
  MTN_MOMO: 'MTN MoMo',
  WAVE: 'Wave',
  MOOV_MONEY: 'Moov Money',
  CREDIT: 'Crédit client',
};

export function exportToCsv(filename: string, headers: string[], rows: (string | number)[][]): void {
  const escape = (cell: string | number) => {
    const str = String(cell ?? '');
    if (str.includes(';') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };
  const csvContent =
    '\uFEFF' +
    [headers.map(escape).join(';'), ...rows.map((r) => r.map(escape).join(';'))].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
