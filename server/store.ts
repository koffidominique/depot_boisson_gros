import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { createInitialSeedData } from './seedData.ts';
import type {
  ApprovalRequest,
  AuditLog,
  CashSession,
  CompanySettings,
  ConsignmentMovement,
  CreditPayment,
  CreditRecord,
  Customer,
  Delegation,
  DeliveryRoute,
  DepotDatabaseSnapshot,
  GoodsReceipt,
  InventorySession,
  Packaging,
  PaymentMethod,
  PermissionKey,
  Product,
  PurchaseOrder,
  PushSubscriptionRecord,
  ReconciliationPV,
  ReturnBreakageRecord,
  RoleCode,
  Sale,
  Supplier,
  TreasuryTransaction,
  UserAccount,
  Warehouse,
} from '../src/types/erp.ts';
import { PERMISSIONS, RBAC_MATRIX } from '../src/types/erp.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'gestdepot-db.json');

export class GovernanceError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 403, code = 'GOVERNANCE_ERROR') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const VALID_ROLES: RoleCode[] = ['PROPRIETAIRE', 'GERANT', 'LIVREUR'];

class DepotStore {
  private db: DepotDatabaseSnapshot;

  constructor() {
    this.db = this.load();
  }

  private load(): DepotDatabaseSnapshot {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        const parsed = JSON.parse(raw) as DepotDatabaseSnapshot;
        const hasLegacyRoles =
          !Array.isArray(parsed.users) ||
          parsed.users.some((u) => !VALID_ROLES.includes(u.role as RoleCode));
        const missingDelegations = !Array.isArray(parsed.delegations);
        const missingThreshold = typeof parsed.company?.autoValidateSaleThreshold !== 'number';
        const missingPush = !Array.isArray(parsed.pushSubscriptions);
        if (!hasLegacyRoles && !missingDelegations && !missingThreshold && !missingPush) {
          if (typeof parsed.company.dailySalesTarget !== 'number') {
            parsed.company.dailySalesTarget = 1500000;
          }
          return parsed;
        }
        console.warn('Legacy 6-role DB detected on disk — migrating to 3-profile architecture seed.');
      }
    } catch (err) {
      console.error('Failed to read DB file, regenerating seed:', err);
    }
    const seed = createInitialSeedData();
    this.save(seed);
    return seed;
  }

  private save(snapshot: DepotDatabaseSnapshot = this.db): void {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const tmpFile = `${DB_FILE}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(snapshot, null, 2), 'utf-8');
    fs.renameSync(tmpFile, DB_FILE);
  }

  public getSnapshot(): DepotDatabaseSnapshot {
    return this.db;
  }

  public getScopedSnapshot(actor: UserAccount): DepotDatabaseSnapshot {
    if (actor.role === 'PROPRIETAIRE') {
      return this.db;
    }

    if (actor.role === 'GERANT') {
      const whId = actor.warehouseId;
      return {
        ...this.db,
        users: this.db.users.map((u) => ({ ...u, pin: u.id === actor.id ? u.pin : '****' })),
        delegations: this.db.delegations.filter((d) => d.toUserId === actor.id),
        stocks: this.db.stocks.filter((s) => s.warehouseId === whId),
        purchaseOrders: this.db.purchaseOrders.filter((p) => p.warehouseId === whId),
        goodsReceipts: this.db.goodsReceipts.filter((g) => g.warehouseId === whId),
        sales: this.db.sales.filter((s) => s.warehouseId === whId),
        cashSessions: this.db.cashSessions.filter((c) => c.warehouseId === whId),
        deliveryRoutes: this.db.deliveryRoutes.filter((r) => r.warehouseId === whId),
        consignments: this.db.consignments.filter((m) => !m.warehouseId || m.warehouseId === whId),
        credits: this.db.credits.filter((c) => !c.warehouseId || c.warehouseId === whId),
        returnsBreakages: this.db.returnsBreakages.filter((r) => !r.warehouseId || r.warehouseId === whId),
        treasury: this.db.treasury.filter((t) => !t.warehouseId || t.warehouseId === whId),
        inventories: this.db.inventories.filter((i) => i.warehouseId === whId),
        reconciliations: this.db.reconciliations.filter((p) => !p.warehouseId || p.warehouseId === whId),
        approvals: this.db.approvals.filter((a) => !a.warehouseId || a.warehouseId === whId),
        auditLogs: this.db.auditLogs.filter(
          (l) => l.warehouseId === whId || l.userId === actor.id
        ),
        pushSubscriptions: [],
      };
    }

    // LIVREUR : 100% isolé sur ses propres tournées, prix d'achat masqués, aucune info financière globale
    const ownRoutes = this.db.deliveryRoutes.filter(
      (r) => r.driverId === actor.id && r.warehouseId === actor.warehouseId
    );
    const ownSaleIds = new Set(ownRoutes.flatMap((r) => r.stops.map((s) => s.saleId)));
    const ownCustomerIds = new Set(ownRoutes.flatMap((r) => r.stops.map((s) => s.customerId)));

    return {
      ...this.db,
      users: [{ ...actor, pin: '****' }],
      warehouses: this.db.warehouses.filter((w) => w.id === actor.warehouseId),
      delegations: [],
      suppliers: [],
      customers: this.db.customers
        .filter((c) => ownCustomerIds.has(c.id))
        .map((c) => ({
          ...c,
          creditLimit: 0,
          creditBalance: 0,
        })),
      packagings: this.db.packagings.map((p) => ({
        ...p,
        purchasePrice: 0,
      })),
      stocks: this.db.stocks.filter((s) => s.warehouseId === actor.warehouseId),
      purchaseOrders: [],
      goodsReceipts: [],
      sales: this.db.sales.filter((s) => ownSaleIds.has(s.id)),
      cashSessions: [],
      deliveryRoutes: ownRoutes,
      consignments: [],
      credits: [],
      creditPayments: [],
      returnsBreakages: this.db.returnsBreakages.filter(
        (rb) => rb.createdBy === actor.id
      ),
      treasury: [],
      inventories: [],
      reconciliations: [],
      approvals: [],
      auditLogs: this.db.auditLogs.filter((l) => l.userId === actor.id),
      pushSubscriptions: [],
    };
  }

  public isClientUuidProcessed(uuid?: string): boolean {
    if (!uuid) return false;
    return Boolean(this.db.processedClientUuids?.includes(uuid));
  }

  public markClientUuidProcessed(uuid?: string): void {
    if (!uuid) return;
    if (!this.db.processedClientUuids) this.db.processedClientUuids = [];
    if (!this.db.processedClientUuids.includes(uuid)) {
      this.db.processedClientUuids.push(uuid);
      this.save();
    }
  }

  public resetToDemo(): DepotDatabaseSnapshot {
    this.db = createInitialSeedData();
    this.save();
    return this.db;
  }

  public restoreSnapshot(snapshot: DepotDatabaseSnapshot, actor: UserAccount): DepotDatabaseSnapshot {
    this.requirePermission(actor, PERMISSIONS.SETTINGS_UPDATE);
    if (!snapshot || !Array.isArray(snapshot.products) || !Array.isArray(snapshot.users)) {
      throw new GovernanceError('Fichier de sauvegarde invalide.', 400, 'INVALID_BACKUP');
    }
    this.db = snapshot;
    this.appendAudit(
      actor,
      'RESTAURATION_SAUVEGARDE',
      'System',
      'db',
      'BACKUP-RESTORE',
      null,
      { restoredAt: new Date().toISOString() },
      'Serveur',
      false,
      null
    );
    this.save();
    return this.db;
  }

  public getUserById(userId: string): UserAccount {
    const user = this.db.users.find((u) => u.id === userId && !u.deletedAt && u.active);
    if (!user) {
      throw new GovernanceError('Utilisateur actif introuvable.', 401, 'UNAUTHORIZED');
    }
    return user;
  }

  public getActiveDelegationsForUser(user: UserAccount): Delegation[] {
    const now = Date.now();
    return (this.db.delegations || []).filter(
      (d) =>
        d.toUserId === user.id &&
        !d.revokedAt &&
        new Date(d.startsAt).getTime() <= now &&
        new Date(d.endsAt).getTime() >= now &&
        (!d.warehouseId || !user.warehouseId || d.warehouseId === user.warehouseId)
    );
  }

  public getEffectivePermissions(user: UserAccount): PermissionKey[] {
    const native = RBAC_MATRIX[user.role] || [];
    const delegated = this.getActiveDelegationsForUser(user).map((d) => d.permissionCode);
    return Array.from(new Set([...native, ...delegated]));
  }

  public hasPermission(user: UserAccount, permission: PermissionKey): boolean {
    return this.getEffectivePermissions(user).includes(permission);
  }

  public requirePermission(user: UserAccount, permission: PermissionKey): void {
    if (!this.hasPermission(user, permission)) {
      this.appendAudit(
        user,
        'TENTATIVE_NON_AUTORISEE',
        'RBAC',
        permission,
        'SEC-BLOCK',
        null,
        { role: user.role, missingPermission: permission },
        'API Guard',
        false,
        user.warehouseId
      );
      this.save();
      throw new GovernanceError(
        `Accès refusé (${user.role}) : le profil "${user.name}" ne dispose pas de la permission "${permission}".`,
        403,
        'RBAC_FORBIDDEN'
      );
    }
  }

  public assertWarehouseScope(actor: UserAccount, warehouseId: string): void {
    if (actor.role === 'PROPRIETAIRE') return;
    if (!actor.warehouseId || actor.warehouseId !== warehouseId) {
      this.appendAudit(
        actor,
        'TENTATIVE_DEPOT_INTERDIT',
        'WarehouseScope',
        warehouseId,
        'WH-BLOCK',
        null,
        { actorWarehouseId: actor.warehouseId, targetWarehouseId: warehouseId },
        'API Guard',
        false,
        actor.warehouseId
      );
      this.save();
      throw new GovernanceError(
        `Accès refusé à un autre dépôt : "${actor.name}" est affecté uniquement au dépôt ${actor.warehouseId || 'aucun'}.`,
        403,
        'WAREHOUSE_FORBIDDEN'
      );
    }
  }

  private resolveWarehouseId(actor: UserAccount, requestedWarehouseId?: string): string {
    if (actor.role === 'PROPRIETAIRE') {
      const target =
        requestedWarehouseId ||
        this.db.warehouses.find((w) => w.isDefault && !w.deletedAt)?.id ||
        this.db.warehouses[0]?.id ||
        'wh-main';
      return target;
    }
    if (!actor.warehouseId) {
      throw new GovernanceError('Aucun dépôt affecté à ce profil.', 403, 'WAREHOUSE_FORBIDDEN');
    }
    if (requestedWarehouseId && requestedWarehouseId !== actor.warehouseId) {
      this.assertWarehouseScope(actor, requestedWarehouseId);
    }
    return actor.warehouseId;
  }

  public assertOwnRoute(actor: UserAccount, route: DeliveryRoute): void {
    this.assertWarehouseScope(actor, route.warehouseId);
    if (actor.role === 'LIVREUR' && route.driverId !== actor.id) {
      this.appendAudit(
        actor,
        'TENTATIVE_TOURNEE_AUTRUI',
        'DeliveryRoute',
        route.id,
        route.docNumber,
        null,
        { routeDriverId: route.driverId, actorId: actor.id },
        'API Guard',
        false,
        actor.warehouseId
      );
      this.save();
      throw new GovernanceError(
        `Accès refusé : cette tournée appartient à ${route.driverName}. Un livreur ne peut accéder qu'à ses propres tournées.`,
        403,
        'OWN_ROUTE_FORBIDDEN'
      );
    }
  }

  private nextDoc(prefix: string): string {
    const current = (this.db.counters[prefix] || 0) + 1;
    this.db.counters[prefix] = current;
    const year = new Date().getFullYear();
    return `${prefix}-${year}-${String(current).padStart(4, '0')}`;
  }

  private computeAuditHash(prevHash: string, entry: Omit<AuditLog, 'hash' | 'prevHash'>): string {
    const payload = JSON.stringify({
      prevHash,
      timestamp: entry.timestamp,
      userId: entry.userId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      documentNumber: entry.documentNumber,
      before: entry.before,
      after: entry.after,
    });
    return crypto.createHash('sha256').update(payload).digest('hex');
  }

  public verifyAuditChain(): { valid: boolean; checkedCount: number; message: string } {
    const chronological = [...this.db.auditLogs].reverse();
    let expectedPrev = 'GENESIS_GESTDEPOT_2026';
    let checked = 0;
    for (const log of chronological) {
      if (!log.hash) {
        expectedPrev = log.id;
        continue;
      }
      if (log.prevHash !== expectedPrev) {
        return {
          valid: false,
          checkedCount: checked,
          message: `Rupture de chaîne SHA-256 détectée sur l’entrée ${log.documentNumber} (${log.id}).`,
        };
      }
      const recomputed = this.computeAuditHash(expectedPrev, {
        id: log.id,
        timestamp: log.timestamp,
        userId: log.userId,
        userName: log.userName,
        userRole: log.userRole,
        action: log.action,
        entityType: log.entityType,
        entityId: log.entityId,
        documentNumber: log.documentNumber,
        before: log.before,
        after: log.after,
        deviceInfo: log.deviceInfo,
        offlineOriginated: log.offlineOriginated,
      });
      if (recomputed !== log.hash) {
        return {
          valid: false,
          checkedCount: checked,
          message: `Altération de hash détectée sur ${log.documentNumber}.`,
        };
      }
      expectedPrev = log.hash;
      checked++;
    }
    return {
      valid: true,
      checkedCount: checked,
      message: `Chaîne cryptographique SHA-256 intacte (${checked} entrée(s) vérifiée(s)).`,
    };
  }

  private appendAudit(
    user: UserAccount,
    action: string,
    entityType: string,
    entityId: string,
    documentNumber: string,
    before: unknown,
    after: unknown,
    deviceInfo = 'Web / API',
    offlineOriginated = false,
    warehouseId: string | null = user.warehouseId ?? null
  ): void {
    const latest = this.db.auditLogs[0];
    const prevHash = latest?.hash || (latest ? latest.id : 'GENESIS_GESTDEPOT_2026');
    const safeBefore = before === undefined || before === null ? null : JSON.parse(JSON.stringify(before));
    const safeAfter = after === undefined || after === null ? null : JSON.parse(JSON.stringify(after));
    const baseEntry = {
      id: `aud-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      userId: user.id,
      userName: user.name,
      userRole: user.role,
      warehouseId,
      action,
      entityType,
      entityId,
      documentNumber,
      before: safeBefore,
      after: safeAfter,
      deviceInfo,
      offlineOriginated,
    };
    const hash = this.computeAuditHash(prevHash, baseEntry);
    const entry: AuditLog = {
      ...baseEntry,
      prevHash,
      hash,
    };
    this.db.auditLogs.unshift(entry);
  }

  // 0. Warehouses (Propriétaire only)
  public createWarehouse(
    actor: UserAccount,
    input: { name: string; zone: string; address: string }
  ): Warehouse {
    this.requirePermission(actor, PERMISSIONS.WAREHOUSE_MANAGE);
    const now = new Date().toISOString();
    const wh: Warehouse = {
      id: `wh-${Date.now()}`,
      name: input.name.trim(),
      zone: input.zone.trim(),
      address: input.address.trim(),
      active: true,
      isDefault: false,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    this.db.warehouses.push(wh);
    // Initialize zero stock lines for all active packagings
    for (const pkg of this.db.packagings.filter((p) => !p.deletedAt)) {
      this.db.stocks.push({
        id: `stk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        warehouseId: wh.id,
        packagingId: pkg.id,
        qtyOnHand: 0,
        qtyReserved: 0,
        emptyCratesOnHand: 0,
        nextDlc: null,
        lotNumber: `LOT-${wh.id.slice(-4).toUpperCase()}`,
        updatedAt: now,
      });
    }
    this.appendAudit(actor, 'CREATION_DEPOT', 'Warehouse', wh.id, wh.name, null, wh, 'Web / API', false, wh.id);
    this.save();
    return wh;
  }

  public toggleWarehouseStatus(actor: UserAccount, warehouseId: string): Warehouse {
    this.requirePermission(actor, PERMISSIONS.WAREHOUSE_MANAGE);
    const wh = this.db.warehouses.find((w) => w.id === warehouseId && !w.deletedAt);
    if (!wh) throw new GovernanceError('Dépôt introuvable.', 404);
    if (wh.isDefault && wh.active) {
      throw new GovernanceError('Le dépôt principal par défaut ne peut pas être désactivé.', 400);
    }
    const before = { active: wh.active };
    wh.active = !wh.active;
    wh.updatedAt = new Date().toISOString();
    this.appendAudit(actor, wh.active ? 'REACTIVATION_DEPOT' : 'DESACTIVATION_DEPOT', 'Warehouse', wh.id, wh.name, before, { active: wh.active }, 'Web / API', false, wh.id);
    this.save();
    return wh;
  }

  // 0b. Temporary Delegations (Propriétaire -> Gérant)
  public createDelegation(
    actor: UserAccount,
    input: {
      toUserId: string;
      permissionCode: PermissionKey;
      warehouseId?: string | null;
      startsAt?: string;
      endsAt: string;
      reason: string;
    }
  ): Delegation {
    this.requirePermission(actor, PERMISSIONS.DELEGATION_MANAGE);
    const target = this.db.users.find((u) => u.id === input.toUserId && !u.deletedAt && u.active);
    if (!target) throw new GovernanceError('Bénéficiaire introuvable.', 404);
    if (target.role !== 'GERANT') {
      throw new GovernanceError('Les délégations temporaires ne peuvent être accordées qu’à un Gérant de dépôt.', 400, 'INVALID_DELEGATION_TARGET');
    }
    if (!input.reason?.trim()) {
      throw new GovernanceError('Un motif de délégation est obligatoire.', 400);
    }
    const startsAt = input.startsAt || new Date().toISOString();
    const endsAt = input.endsAt;
    if (new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
      throw new GovernanceError('La date de fin de délégation doit être postérieure au début.', 400);
    }

    const del: Delegation = {
      id: `del-${Date.now()}`,
      fromUserId: actor.id,
      fromUserName: actor.name,
      toUserId: target.id,
      toUserName: target.name,
      permissionCode: input.permissionCode,
      warehouseId: input.warehouseId ?? target.warehouseId,
      startsAt,
      endsAt,
      reason: input.reason.trim(),
      revokedAt: null,
      createdAt: new Date().toISOString(),
    };
    this.db.delegations.unshift(del);
    this.appendAudit(actor, 'CREATION_DELEGATION', 'Delegation', del.id, del.permissionCode, null, del, 'Web / API', false, del.warehouseId);
    this.save();
    return del;
  }

  public revokeDelegation(actor: UserAccount, delegationId: string): Delegation {
    this.requirePermission(actor, PERMISSIONS.DELEGATION_MANAGE);
    const del = this.db.delegations.find((d) => d.id === delegationId);
    if (!del) throw new GovernanceError('Délégation introuvable.', 404);
    if (del.revokedAt) return del;
    del.revokedAt = new Date().toISOString();
    this.appendAudit(actor, 'REVOCATION_DELEGATION', 'Delegation', del.id, del.permissionCode, { revokedAt: null }, { revokedAt: del.revokedAt }, 'Web / API', false, del.warehouseId);
    this.save();
    return del;
  }

  // 1. Products & Packagings
  public createProductWithPackaging(
    actor: UserAccount,
    input: {
      name: string;
      brand: string;
      supplierId: string;
      category: Product['category'];
      volumeLabel: string;
      packaging: Omit<Packaging, 'id' | 'productId' | 'createdAt' | 'updatedAt' | 'deletedAt'>;
      initialQty: number;
      warehouseId: string;
    }
  ) {
    this.requirePermission(actor, PERMISSIONS.PRODUCT_CREATE);
    const targetWh = this.resolveWarehouseId(actor, input.warehouseId);
    const now = new Date().toISOString();
    const product: Product = {
      id: `prd-${Date.now()}`,
      name: input.name,
      brand: input.brand,
      supplierId: input.supplierId,
      category: input.category,
      volumeLabel: input.volumeLabel,
      active: true,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    const pkg: Packaging = {
      ...input.packaging,
      id: `pkg-${Date.now()}`,
      productId: product.id,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    this.db.products.push(product);
    this.db.packagings.push(pkg);

    for (const wh of this.db.warehouses.filter((w) => !w.deletedAt)) {
      this.db.stocks.push({
        id: `stk-${Date.now()}-${wh.id.slice(-3)}`,
        warehouseId: wh.id,
        packagingId: pkg.id,
        qtyOnHand: wh.id === targetWh ? Math.max(0, Number(input.initialQty) || 0) : 0,
        qtyReserved: 0,
        emptyCratesOnHand: 0,
        nextDlc: null,
        lotNumber: `LOT-${Date.now().toString().slice(-5)}`,
        updatedAt: now,
      });
    }

    this.appendAudit(actor, 'CREATION_PRODUIT', 'Product', product.id, pkg.sku, null, { product, pkg }, 'Web / API', false, targetWh);
    this.save();
    return { product, packaging: pkg };
  }

  public updatePackaging(actor: UserAccount, packagingId: string, patch: Partial<Packaging>) {
    const pkg = this.db.packagings.find((p) => p.id === packagingId && !p.deletedAt);
    if (!pkg) throw new GovernanceError('Conditionnement introuvable.', 404);

    const priceFields: (keyof Packaging)[] = [
      'purchasePrice',
      'salePriceDetail',
      'salePriceSemiGros',
      'salePriceGros',
      'depositPerCrate',
      'depositPerBottle',
    ];
    const touchesPrice = priceFields.some(
      (field) => patch[field] !== undefined && Number(patch[field]) !== Number(pkg[field])
    );

    if (touchesPrice) {
      this.requirePermission(actor, PERMISSIONS.PRICE_UPDATE);
    } else {
      this.requirePermission(actor, PERMISSIONS.PRODUCT_UPDATE);
    }

    const before = { ...pkg };
    Object.assign(pkg, patch, { updatedAt: new Date().toISOString() });
    this.appendAudit(
      actor,
      touchesPrice ? 'MODIFICATION_TARIF_CONDITIONNEMENT' : 'MODIFICATION_CONDITIONNEMENT',
      'Packaging',
      pkg.id,
      pkg.sku,
      before,
      pkg,
      'Web / API',
      false,
      null
    );
    this.save();
    return pkg;
  }

  public softDeleteProduct(actor: UserAccount, productId: string) {
    this.requirePermission(actor, PERMISSIONS.PRODUCT_UPDATE);
    const prod = this.db.products.find((p) => p.id === productId && !p.deletedAt);
    if (!prod) throw new GovernanceError('Produit introuvable.', 404);
    const now = new Date().toISOString();
    prod.deletedAt = now;
    prod.active = false;
    this.db.packagings.filter((p) => p.productId === productId).forEach((p) => {
      p.deletedAt = now;
    });
    this.appendAudit(actor, 'SUPPRESSION_LOGIQUE_PRODUIT', 'Product', prod.id, prod.name, { active: true }, { deletedAt: now }, 'Web / API', false, null);
    this.save();
    return { ok: true };
  }

  // 2. Customers
  public upsertCustomer(actor: UserAccount, input: Partial<Customer> & { id?: string }) {
    const now = new Date().toISOString();
    if (input.id) {
      this.requirePermission(actor, PERMISSIONS.CUSTOMER_UPDATE);
      const cust = this.db.customers.find((c) => c.id === input.id && !c.deletedAt);
      if (!cust) throw new GovernanceError('Client introuvable.', 404);
      if (input.creditLimit !== undefined && Number(input.creditLimit) !== cust.creditLimit) {
        this.requirePermission(actor, PERMISSIONS.CREDIT_LIMIT_UPDATE);
      }
      const before = { ...cust };
      Object.assign(cust, input, { updatedAt: now });
      this.appendAudit(actor, 'MODIFICATION_CLIENT', 'Customer', cust.id, cust.code, before, cust, 'Web / API', false, actor.warehouseId);
      this.save();
      return cust;
    }

    this.requirePermission(actor, PERMISSIONS.CUSTOMER_CREATE);
    const requestedLimit = Math.max(0, Number(input.creditLimit) || 0);
    if (requestedLimit > 0 && !this.hasPermission(actor, PERMISSIONS.CREDIT_LIMIT_UPDATE)) {
      throw new GovernanceError(
        'Seul le Propriétaire peut fixer un plafond crédit supérieur à 0 FCFA lors de la création.',
        403,
        'RBAC_FORBIDDEN'
      );
    }

    const code = `CLI-${String(this.db.customers.length + 1).padStart(3, '0')}`;
    const created: Customer = {
      id: `cust-${Date.now()}`,
      code,
      name: input.name || 'Nouveau Client',
      category: input.category || 'BOUTIQUE',
      pricingTier: input.pricingTier || 'DETAIL',
      phone: input.phone || '',
      zone: input.zone || 'Abidjan',
      creditLimit: requestedLimit,
      creditBalance: 0,
      consignmentCrates: 0,
      consignmentBottles: 0,
      consignmentDepositDue: 0,
      lastCrateOutDate: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    this.db.customers.push(created);
    this.appendAudit(actor, 'CREATION_CLIENT', 'Customer', created.id, created.code, null, created, 'Web / API', false, actor.warehouseId);
    this.save();
    return created;
  }

  public updateCustomerCreditLimit(actor: UserAccount, customerId: string, creditLimit: number): Customer {
    this.requirePermission(actor, PERMISSIONS.CREDIT_LIMIT_UPDATE);
    const cust = this.db.customers.find((c) => c.id === customerId && !c.deletedAt);
    if (!cust) throw new GovernanceError('Client introuvable.', 404);
    const before = { creditLimit: cust.creditLimit };
    cust.creditLimit = Math.max(0, Number(creditLimit) || 0);
    cust.updatedAt = new Date().toISOString();
    this.appendAudit(actor, 'MODIFICATION_PLAFOND_CREDIT', 'Customer', cust.id, cust.code, before, { creditLimit: cust.creditLimit }, 'Web / API', false, null);
    this.save();
    return cust;
  }

  public softDeleteCustomer(actor: UserAccount, customerId: string) {
    this.requirePermission(actor, PERMISSIONS.CUSTOMER_UPDATE);
    const cust = this.db.customers.find((c) => c.id === customerId && !c.deletedAt);
    if (!cust) throw new GovernanceError('Client introuvable.', 404);
    if (cust.creditBalance > 0 || cust.consignmentCrates > 0) {
      throw new GovernanceError('Impossible d’archiver un client avec un encours crédit ou des casiers consignés ouverts.', 400);
    }
    cust.deletedAt = new Date().toISOString();
    this.appendAudit(actor, 'ARCHIVAGE_CLIENT', 'Customer', cust.id, cust.code, { deletedAt: null }, { deletedAt: cust.deletedAt }, 'Web / API', false, actor.warehouseId);
    this.save();
    return { ok: true };
  }

  public toggleCustomerBlock(actor: UserAccount, customerId: string) {
    this.requirePermission(actor, PERMISSIONS.CREDIT_BLOCK);
    const cust = this.db.customers.find((c) => c.id === customerId && !c.deletedAt);
    if (!cust) throw new GovernanceError('Client introuvable.', 404);
    if (cust.id === 'cust-comptoir') throw new GovernanceError('Le client comptoir passant ne peut pas être bloqué.', 400);
    const before = { isBlocked: Boolean(cust.isBlocked) };
    cust.isBlocked = !cust.isBlocked;
    cust.updatedAt = new Date().toISOString();
    this.appendAudit(
      actor,
      cust.isBlocked ? 'BLOCAGE_CREDIT_CLIENT' : 'DEBLOCAGE_CREDIT_CLIENT',
      'Customer',
      cust.id,
      cust.code,
      before,
      { isBlocked: cust.isBlocked },
      'Web / API',
      false,
      actor.warehouseId
    );
    this.save();
    return cust;
  }

  // 3. Suppliers & Purchase Orders & Goods Receipts
  public upsertSupplier(actor: UserAccount, input: Partial<Supplier> & { id?: string }) {
    this.requirePermission(actor, PERMISSIONS.PURCHASE_RECEIVE);
    const now = new Date().toISOString();
    if (input.id) {
      const sup = this.db.suppliers.find((s) => s.id === input.id && !s.deletedAt);
      if (!sup) throw new GovernanceError('Fournisseur introuvable.', 404);
      const before = { ...sup };
      Object.assign(sup, input, { updatedAt: now });
      this.appendAudit(actor, 'MODIFICATION_FOURNISSEUR', 'Supplier', sup.id, sup.code, before, sup, 'Web / API', false, actor.warehouseId);
      this.save();
      return sup;
    }
    const created: Supplier = {
      id: `sup-${Date.now()}`,
      code: input.code || `FRN-${this.db.suppliers.length + 1}`,
      name: input.name || 'Nouvelle Brasserie',
      contactName: input.contactName || '',
      phone: input.phone || '',
      paymentTermsDays: Number(input.paymentTermsDays) || 15,
      cratesHeldFromSupplier: 0,
      depositPaidToSupplier: 0,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    this.db.suppliers.push(created);
    this.appendAudit(actor, 'CREATION_FOURNISSEUR', 'Supplier', created.id, created.code, null, created, 'Web / API', false, actor.warehouseId);
    this.save();
    return created;
  }

  public createPurchaseOrder(
    actor: UserAccount,
    input: {
      supplierId: string;
      warehouseId: string;
      expectedDate: string;
      lines: { packagingId: string; qtyOrdered: number }[];
    }
  ) {
    this.requirePermission(actor, PERMISSIONS.PURCHASE_RECEIVE);
    const warehouseId = this.resolveWarehouseId(actor, input.warehouseId);
    const now = new Date().toISOString();
    const lines = input.lines.map((l) => {
      const pkg = this.db.packagings.find((p) => p.id === l.packagingId);
      if (!pkg) throw new GovernanceError('Conditionnement invalide.', 400);
      return {
        packagingId: l.packagingId,
        qtyOrdered: Number(l.qtyOrdered),
        unitPurchasePrice: pkg.purchasePrice,
        depositPerCrate: pkg.isReturnable ? pkg.depositPerCrate : 0,
      };
    });
    const totalLiquid = lines.reduce((s, l) => s + l.qtyOrdered * l.unitPurchasePrice, 0);
    const totalDeposit = lines.reduce((s, l) => s + l.qtyOrdered * l.depositPerCrate, 0);
    const po: PurchaseOrder = {
      id: `po-${Date.now()}`,
      docNumber: this.nextDoc('BDC'),
      supplierId: input.supplierId,
      warehouseId,
      status: 'ENVOYE',
      lines,
      totalLiquid,
      totalDeposit,
      expectedDate: input.expectedDate || now,
      createdBy: actor.id,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    this.db.purchaseOrders.unshift(po);
    this.appendAudit(actor, 'CREATION_BON_COMMANDE', 'PurchaseOrder', po.id, po.docNumber, null, po, 'Web / API', false, warehouseId);
    this.save();
    return po;
  }

  public receiveGoods(
    actor: UserAccount,
    input: {
      purchaseOrderId: string;
      supplierBlNumber: string;
      lines: {
        packagingId: string;
        qtyReceived: number;
        discrepancyReason: string;
        emptyCratesReturnedToSupplier: number;
      }[];
    }
  ) {
    this.requirePermission(actor, PERMISSIONS.PURCHASE_RECEIVE);
    const po = this.db.purchaseOrders.find((p) => p.id === input.purchaseOrderId && !p.deletedAt);
    if (!po) throw new GovernanceError('Bon de commande introuvable.', 404);
    this.assertWarehouseScope(actor, po.warehouseId);
    const supplier = this.db.suppliers.find((s) => s.id === po.supplierId);
    const now = new Date().toISOString();

    let cratesReceived = 0;
    let cratesReturnedToSupplier = 0;
    let netDepositChange = 0;

    const receiptLines = input.lines.map((l) => {
      const poLine = po.lines.find((pl) => pl.packagingId === l.packagingId);
      const pkg = this.db.packagings.find((p) => p.id === l.packagingId);
      const ordered = poLine ? poLine.qtyOrdered : 0;
      const received = Math.max(0, Number(l.qtyReceived));
      const returned = Math.max(0, Number(l.emptyCratesReturnedToSupplier) || 0);
      const discrepancyQty = received - ordered;

      let stk = this.db.stocks.find((s) => s.warehouseId === po.warehouseId && s.packagingId === l.packagingId);
      if (!stk) {
        stk = {
          id: `stk-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
          warehouseId: po.warehouseId,
          packagingId: l.packagingId,
          qtyOnHand: 0,
          qtyReserved: 0,
          emptyCratesOnHand: 0,
          nextDlc: null,
          lotNumber: `LOT-${Date.now().toString().slice(-4)}`,
          updatedAt: now,
        };
        this.db.stocks.push(stk);
      }
      stk.qtyOnHand += received;
      if (pkg?.isReturnable) {
        stk.emptyCratesOnHand = Math.max(0, stk.emptyCratesOnHand - returned);
        cratesReceived += received;
        cratesReturnedToSupplier += returned;
        netDepositChange += (received - returned) * pkg.depositPerCrate;
      }
      stk.updatedAt = now;

      return {
        packagingId: l.packagingId,
        qtyOrdered: ordered,
        qtyReceived: received,
        discrepancyQty,
        discrepancyReason: l.discrepancyReason || '',
        emptyCratesReturnedToSupplier: returned,
      };
    });

    if (supplier) {
      supplier.cratesHeldFromSupplier = Math.max(0, supplier.cratesHeldFromSupplier + cratesReceived - cratesReturnedToSupplier);
      supplier.depositPaidToSupplier = Math.max(0, supplier.depositPaidToSupplier + netDepositChange);
      supplier.updatedAt = now;
    }

    po.status = receiptLines.some((l) => l.discrepancyQty < 0) ? 'PARTIEL' : 'RECU';
    po.updatedAt = now;

    const gr: GoodsReceipt = {
      id: `gr-${Date.now()}`,
      docNumber: this.nextDoc('BLF'),
      purchaseOrderId: po.id,
      supplierId: po.supplierId,
      supplierBlNumber: input.supplierBlNumber,
      warehouseId: po.warehouseId,
      lines: receiptLines,
      cratesReceived,
      cratesReturnedToSupplier,
      netDepositChange,
      receivedBy: actor.id,
      createdAt: now,
    };
    this.db.goodsReceipts.unshift(gr);

    if (cratesReceived > 0) {
      const csg: ConsignmentMovement = {
        id: `csg-${Date.now()}`,
        docNumber: this.nextDoc('CSG'),
        warehouseId: po.warehouseId,
        movementType: 'RECEPTION_BRASSERIE',
        customerId: null,
        supplierId: po.supplierId,
        packagingId: receiptLines[0].packagingId,
        cratesOut: cratesReturnedToSupplier,
        cratesIn: cratesReceived,
        bottlesMissing: 0,
        depositAmount: netDepositChange,
        settlementMode: 'BRASSERIE',
        referenceDoc: gr.docNumber,
        createdBy: actor.id,
        createdAt: now,
      };
      this.db.consignments.unshift(csg);
    }

    this.appendAudit(actor, 'RECEPTION_BRASSERIE', 'GoodsReceipt', gr.id, gr.docNumber, { poStatus: 'ENVOYE' }, gr, 'Web / API', false, po.warehouseId);
    this.save();
    return gr;
  }

  // 4. Sales & POS
  private finalizeSaleEffects(
    actor: UserAccount,
    sale: Sale,
    activeCash: CashSession | undefined,
    customer: Customer,
    now: string
  ) {
    let totalCratesOut = 0;
    let totalCratesReturned = 0;

    for (const line of sale.lines) {
      const stk = this.db.stocks.find((s) => s.warehouseId === sale.warehouseId && s.packagingId === line.packagingId);
      const pkg = this.db.packagings.find((p) => p.id === line.packagingId);
      if (!stk || stk.qtyOnHand < line.qty) {
        throw new GovernanceError(`Stock insuffisant lors de la validation de ${sale.docNumber}.`, 409, 'INSUFFICIENT_STOCK');
      }
      stk.qtyOnHand = Math.max(0, stk.qtyOnHand - line.qty);
      stk.emptyCratesOnHand += line.emptyCratesReturnedNow;
      if (pkg?.isReturnable) {
        const netOut = Math.max(0, line.qty - line.emptyCratesReturnedNow);
        stk.qtyConsignedOut = (stk.qtyConsignedOut || 0) + netOut;
        totalCratesOut += netOut;
        totalCratesReturned += line.emptyCratesReturnedNow;
      }
      stk.updatedAt = now;
    }

    if (sale.creditAdded > 0) {
      customer.creditBalance += sale.creditAdded;
      const due = new Date();
      due.setDate(due.getDate() + 14);
      const crd: CreditRecord = {
        id: `crd-${Date.now()}`,
        docNumber: this.nextDoc('CRE'),
        warehouseId: sale.warehouseId,
        customerId: customer.id,
        saleId: sale.id,
        saleDocNumber: sale.docNumber,
        originalAmount: sale.creditAdded,
        remainingAmount: sale.creditAdded,
        dueDate: due.toISOString(),
        status: 'OUVERT',
        createdAt: now,
      };
      this.db.credits.unshift(crd);
    }

    if (totalCratesOut > 0) {
      const bottlesCount = sale.lines.reduce((sum, l) => {
        const pkg = this.db.packagings.find((p) => p.id === l.packagingId);
        const net = pkg?.isReturnable ? Math.max(0, l.qty - l.emptyCratesReturnedNow) : 0;
        return sum + net * (pkg?.unitsPerPack || 0);
      }, 0);
      customer.consignmentCrates += totalCratesOut;
      customer.consignmentBottles += bottlesCount;
      customer.consignmentDepositDue += sale.depositNetTotal;
      customer.lastCrateOutDate = now;
      customer.updatedAt = now;

      const firstReturnableLine = sale.lines.find((l) => l.depositCharged > 0) || sale.lines[0];
      this.db.consignments.unshift({
        id: `csg-${Date.now()}`,
        docNumber: this.nextDoc('CSG'),
        warehouseId: sale.warehouseId,
        movementType: 'SORTIE_VENTE',
        customerId: customer.id,
        supplierId: null,
        packagingId: firstReturnableLine.packagingId,
        cratesOut: totalCratesOut,
        cratesIn: totalCratesReturned,
        bottlesMissing: 0,
        depositAmount: sale.depositNetTotal,
        settlementMode: 'CAUTION_DUE',
        referenceDoc: sale.docNumber,
        createdBy: actor.id,
        createdAt: now,
      });
    }

    const cashPaid = sale.payments.filter((p) => p.method === 'ESPECES').reduce((s, p) => s + Number(p.amount), 0);
    const mmPaid = sale.payments
      .filter((p) => ['ORANGE_MONEY', 'MTN_MOMO', 'WAVE', 'MOOV_MONEY'].includes(p.method))
      .reduce((s, p) => s + Number(p.amount), 0);

    if (activeCash) {
      activeCash.totalCashSales += cashPaid;
      activeCash.expectedCash += cashPaid;
      activeCash.totalMobileMoney += mmPaid;
      activeCash.totalCreditSales += sale.creditAdded;
    }

    for (const p of sale.payments) {
      if (p.method !== 'CREDIT' && p.amount > 0) {
        const wallet = p.method === 'ESPECES' ? 'CAISSE' : p.method;
        this.db.treasury.unshift({
          id: `trs-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
          docNumber: this.nextDoc('TRS'),
          warehouseId: sale.warehouseId,
          wallet,
          direction: 'ENTREE',
          category: 'Vente',
          amount: Number(p.amount),
          reference: p.reference || sale.ticketNumber,
          description: `Vente ${sale.docNumber} — ${customer.name}`,
          createdBy: actor.id,
          createdAt: now,
        });
      }
    }
  }

  public createSale(
    actor: UserAccount,
    input: {
      customerId: string;
      warehouseId: string;
      lines: { packagingId: string; qty: number; emptyCratesReturnedNow: number }[];
      discountAmount?: number;
      discountReason?: string;
      payments: { method: PaymentMethod; amount: number; reference?: string }[];
      deliveryRequired?: boolean;
      offlineOriginated?: boolean;
      clientTempId?: string;
      creditOverridePin?: string;
    }
  ) {
    this.requirePermission(actor, PERMISSIONS.SALE_CREATE);
    const warehouseId = this.resolveWarehouseId(actor, input.warehouseId);

    if (input.clientTempId) {
      if (!this.db.processedClientUuids) this.db.processedClientUuids = [];
      if (this.db.processedClientUuids.includes(input.clientTempId)) {
        const existing = this.db.sales.find((s) => s.clientTempId === input.clientTempId);
        if (existing) return existing;
      }
    }

    const activeCash = this.db.cashSessions.find(
      (cs) => cs.warehouseId === warehouseId && cs.status === 'OUVERTE'
    );
    if (!activeCash && !input.offlineOriginated) {
      throw new GovernanceError(
        'Aucune caisse ouverte sur ce dépôt. Veuillez ouvrir une session de caisse avant d’encaisser.',
        400,
        'NO_OPEN_CASH'
      );
    }

    const customer = this.db.customers.find((c) => c.id === input.customerId && !c.deletedAt);
    if (!customer) throw new GovernanceError('Client introuvable.', 404);
    if (customer.isBlocked && input.payments.some((p) => p.method === 'CREDIT')) {
      throw new GovernanceError(`Compte crédit bloqué pour ${customer.name}. Règlement préalable requis.`, 403, 'CUSTOMER_BLOCKED');
    }

    const now = new Date().toISOString();
    const saleLines = [];
    let liquidTotal = 0;
    let depositNetTotal = 0;

    for (const rawLine of input.lines) {
      const qty = Math.max(1, Number(rawLine.qty));
      const pkg = this.db.packagings.find((p) => p.id === rawLine.packagingId && !p.deletedAt);
      if (!pkg) throw new GovernanceError('Conditionnement introuvable.', 404);
      const stock = this.db.stocks.find((s) => s.warehouseId === warehouseId && s.packagingId === pkg.id);
      if (!stock || stock.qtyOnHand < qty) {
        const alt = this.db.stocks
          .filter((s) => s.warehouseId === warehouseId && s.qtyOnHand >= qty && s.packagingId !== pkg.id)
          .map((s) => this.db.packagings.find((p) => p.id === s.packagingId)?.label)
          .filter(Boolean)
          .slice(0, 2);
        const hint = alt.length > 0 ? ` Substitution possible : ${alt.join(' ou ')}.` : '';
        throw new GovernanceError(
          `Stock insuffisant pour "${pkg.label}" (Disponible : ${stock?.qtyOnHand ?? 0}, Demandé : ${qty}). Vente rejetée.${hint}`,
          409,
          'INSUFFICIENT_STOCK'
        );
      }

      const unitPrice =
        customer.pricingTier === 'GROS'
          ? pkg.salePriceGros
          : customer.pricingTier === 'SEMI_GROS'
          ? pkg.salePriceSemiGros
          : pkg.salePriceDetail;

      const lineLiquidTotal = qty * unitPrice;
      const returnedNow = pkg.isReturnable ? Math.min(qty, Math.max(0, Number(rawLine.emptyCratesReturnedNow) || 0)) : 0;
      const netCratesOut = pkg.isReturnable ? Math.max(0, qty - returnedNow) : 0;
      const depositCharged = pkg.isReturnable ? netCratesOut * pkg.depositPerCrate : 0;

      liquidTotal += lineLiquidTotal;
      depositNetTotal += depositCharged;

      saleLines.push({
        packagingId: pkg.id,
        qty,
        unitPrice,
        lineLiquidTotal,
        depositCharged,
        emptyCratesReturnedNow: returnedNow,
      });
    }

    const discountAmount = Math.max(0, Number(input.discountAmount) || 0);
    const discountPct = liquidTotal > 0 ? (discountAmount / liquidTotal) * 100 : 0;
    const needsDiscountApproval =
      discountPct > this.db.company.maxCashierDiscountPercent &&
      !this.hasPermission(actor, PERMISSIONS.SALE_DISCOUNT_OVER_5);

    if (discountPct > this.db.company.maxCashierDiscountPercent && !input.discountReason?.trim()) {
      throw new GovernanceError(
        `Motif obligatoire pour toute remise > ${this.db.company.maxCashierDiscountPercent}% (${discountPct.toFixed(1)}%).`,
        400,
        'DISCOUNT_REASON_REQUIRED'
      );
    }

    const grandTotal = Math.max(0, liquidTotal - discountAmount + depositNetTotal);
    const creditAdded = input.payments.filter((p) => p.method === 'CREDIT').reduce((s, p) => s + Number(p.amount), 0);

    if (creditAdded > 0) {
      if (customer.id === 'cust-comptoir') {
        throw new GovernanceError('Le client comptoir passant ne peut pas acheter à crédit.', 400);
      }
      if (customer.creditBalance + creditAdded > customer.creditLimit) {
        const canUnlock = this.hasPermission(actor, PERMISSIONS.CREDIT_BLOCK);
        const managerApprover = input.creditOverridePin
          ? this.db.users.find((u) => u.pin === input.creditOverridePin && this.hasPermission(u, PERMISSIONS.CREDIT_LIMIT_UPDATE))
          : null;
        if (!canUnlock && !managerApprover) {
          throw new GovernanceError(
            `Plafond crédit dépassé pour ${customer.name} (Encours : ${customer.creditBalance.toLocaleString('fr-FR')} / Plafond : ${customer.creditLimit.toLocaleString('fr-FR')} FCFA).`,
            403,
            'CREDIT_LIMIT_EXCEEDED'
          );
        }
      }
    }

    const docNumber = this.nextDoc('FAC');
    const ticketNumber = this.nextDoc('TKT');

    const sale: Sale = {
      id: `sale-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      docNumber,
      ticketNumber,
      customerId: customer.id,
      warehouseId,
      cashSessionId: activeCash?.id || 'offline-session',
      lines: saleLines,
      discountAmount,
      discountReason: input.discountReason,
      liquidTotal: Math.max(0, liquidTotal - discountAmount),
      depositNetTotal,
      grandTotal,
      payments: input.payments,
      creditAdded,
      status: needsDiscountApproval ? 'EN_ATTENTE_VALIDATION' : 'VALIDEE',
      deliveryRequired: Boolean(input.deliveryRequired),
      offlineOriginated: Boolean(input.offlineOriginated),
      clientTempId: input.clientTempId,
      createdBy: actor.id,
      validatedBy: needsDiscountApproval ? undefined : actor.id,
      createdAt: now,
      deletedAt: null,
    };
    this.db.sales.unshift(sale);
    if (input.clientTempId) {
      if (!this.db.processedClientUuids) this.db.processedClientUuids = [];
      this.db.processedClientUuids.push(input.clientTempId);
    }

    if (needsDiscountApproval) {
      const req: ApprovalRequest = {
        id: `apr-${Date.now()}`,
        warehouseId,
        type: 'REMISE_EXCEPTIONNELLE',
        entityId: sale.id,
        docNumber: sale.docNumber,
        description: `Remise exceptionnelle ${discountPct.toFixed(1)}% (${discountAmount.toLocaleString('fr-FR')} FCFA) sur ${sale.docNumber} — ${customer.name} (${input.discountReason})`,
        amount: discountAmount,
        metadata: { discountPercent: Number(discountPct.toFixed(2)), reason: input.discountReason },
        requestedBy: actor.id,
        requestedByName: actor.name,
        targetRole: 'PROPRIETAIRE',
        status: 'EN_ATTENTE',
        requiresTwoApprovers: false,
        reviewedBy: null,
        reviewedByName: null,
        reviewedAt: null,
        createdAt: now,
      };
      this.db.approvals.unshift(req);
      this.appendAudit(actor, 'VENTE_ATTENTE_VALIDATION_REMISE', 'Sale', sale.id, sale.docNumber, null, { discountPct, reqId: req.id }, 'POS / Web', Boolean(input.offlineOriginated), warehouseId);
      this.save();
      return { ...sale, pendingApproval: true, approval: req };
    }

    this.finalizeSaleEffects(actor, sale, activeCash, customer, now);
    this.appendAudit(actor, 'CREATION_VENTE', 'Sale', sale.id, sale.docNumber, null, { grandTotal: sale.grandTotal, creditAdded, depositNetTotal }, 'POS / Web', Boolean(input.offlineOriginated), warehouseId);
    this.save();
    return sale;
  }

  public applySaleDiscount(
    actor: UserAccount,
    saleId: string,
    input: { percent: number; reason: string }
  ) {
    this.requirePermission(actor, PERMISSIONS.SALE_DISCOUNT_5);
    const sale = this.db.sales.find((s) => s.id === saleId && !s.deletedAt);
    if (!sale) throw new GovernanceError('Vente introuvable.', 404);
    this.assertWarehouseScope(actor, sale.warehouseId);
    const pct = Math.max(0, Number(input.percent) || 0);
    const maxPct = this.db.company.maxCashierDiscountPercent;
    const baseLiquid = sale.lines.reduce((s, l) => s + l.lineLiquidTotal, 0);
    const discountAmount = Math.round((baseLiquid * pct) / 100);

    if (pct > maxPct && !this.hasPermission(actor, PERMISSIONS.SALE_DISCOUNT_OVER_5)) {
      if (!input.reason?.trim()) {
        throw new GovernanceError(`Motif obligatoire pour remise > ${maxPct}%.`, 400);
      }
      const req: ApprovalRequest = {
        id: `apr-${Date.now()}`,
        warehouseId: sale.warehouseId,
        type: 'REMISE_EXCEPTIONNELLE',
        entityId: sale.id,
        docNumber: sale.docNumber,
        description: `Demande remise ${pct}% (${discountAmount.toLocaleString('fr-FR')} FCFA) sur ${sale.docNumber} : ${input.reason}`,
        amount: discountAmount,
        metadata: { discountPercent: pct, reason: input.reason, applyToExistingSale: true },
        requestedBy: actor.id,
        requestedByName: actor.name,
        targetRole: 'PROPRIETAIRE',
        status: 'EN_ATTENTE',
        requiresTwoApprovers: false,
        reviewedBy: null,
        reviewedByName: null,
        reviewedAt: null,
        createdAt: new Date().toISOString(),
      };
      this.db.approvals.unshift(req);
      this.appendAudit(actor, 'DEMANDE_REMISE_EXCEPTIONNELLE', 'Sale', sale.id, sale.docNumber, { discountAmount: sale.discountAmount }, { pct, reason: input.reason }, 'Web / API', false, sale.warehouseId);
      this.save();
      return { status: 'pending_approval' as const, approval: req };
    }

    const before = { discountAmount: sale.discountAmount, grandTotal: sale.grandTotal };
    sale.discountAmount = discountAmount;
    sale.discountReason = input.reason || sale.discountReason;
    sale.liquidTotal = Math.max(0, baseLiquid - discountAmount);
    sale.grandTotal = Math.max(0, sale.liquidTotal + sale.depositNetTotal);
    this.appendAudit(actor, 'APPLICATION_REMISE_VENTE', 'Sale', sale.id, sale.docNumber, before, { discountAmount: sale.discountAmount, grandTotal: sale.grandTotal }, 'Web / API', false, sale.warehouseId);
    this.save();
    return { status: 'applied' as const, sale };
  }

  public validateSale(actor: UserAccount, saleId: string) {
    this.requirePermission(actor, PERMISSIONS.SALE_VALIDATE);
    const sale = this.db.sales.find((s) => s.id === saleId && !s.deletedAt);
    if (!sale) throw new GovernanceError('Vente introuvable.', 404);
    this.assertWarehouseScope(actor, sale.warehouseId);
    if (sale.status === 'ANNULEE') throw new GovernanceError('Vente annulée.', 400);
    if (sale.status === 'VALIDEE') return sale;

    const threshold = this.db.company.autoValidateSaleThreshold || 200000;
    if (sale.grandTotal > threshold && actor.role !== 'PROPRIETAIRE') {
      throw new GovernanceError(
        `Montant supérieur au seuil Gérant (${threshold.toLocaleString('fr-FR')} FCFA). Validation du Propriétaire requise.`,
        403,
        'SALE_THRESHOLD_EXCEEDED'
      );
    }

    const now = new Date().toISOString();
    const customer = this.db.customers.find((c) => c.id === sale.customerId);
    const activeCash = this.db.cashSessions.find(
      (cs) => cs.warehouseId === sale.warehouseId && cs.status === 'OUVERTE'
    );
    sale.status = 'VALIDEE';
    sale.validatedBy = actor.id;
    if (customer) {
      this.finalizeSaleEffects(actor, sale, activeCash, customer, now);
    }
    this.appendAudit(actor, 'VALIDATION_VENTE', 'Sale', sale.id, sale.docNumber, { status: 'EN_ATTENTE_VALIDATION' }, { status: 'VALIDEE' }, 'Web / API', false, sale.warehouseId);
    this.save();
    return sale;
  }

  public requestSaleCancellation(actor: UserAccount, saleId: string, reason: string) {
    const sale = this.db.sales.find((s) => s.id === saleId && !s.deletedAt);
    if (!sale) throw new GovernanceError('Vente introuvable.', 404);
    this.assertWarehouseScope(actor, sale.warehouseId);
    if (sale.status === 'ANNULEE') throw new GovernanceError('Cette vente est déjà annulée.', 400);
    if (!reason.trim()) throw new GovernanceError('Un motif d’annulation est obligatoire.', 400);

    const session = this.db.cashSessions.find((c) => c.id === sale.cashSessionId);
    const isClosedSession = session?.status === 'CLOTUREE';

    if (isClosedSession) {
      if (!this.hasPermission(actor, PERMISSIONS.SALE_CANCEL) && !this.hasPermission(actor, PERMISSIONS.SALE_CANCEL_CLOSED)) {
        this.requirePermission(actor, PERMISSIONS.SALE_CANCEL_CLOSED);
      }
    } else {
      this.requirePermission(actor, PERMISSIONS.SALE_CANCEL);
    }

    const now = new Date().toISOString();
    const req: ApprovalRequest = {
      id: `apr-${Date.now()}`,
      warehouseId: sale.warehouseId,
      type: 'ANNULATION_VENTE',
      entityId: sale.id,
      docNumber: sale.docNumber,
      description: `Demande d’annulation vente ${sale.docNumber}${isClosedSession ? ' (caisse clôturée)' : ''} : ${reason}`,
      amount: sale.grandTotal,
      metadata: { reason, isClosedSession },
      requestedBy: actor.id,
      requestedByName: actor.name,
      targetRole: 'PROPRIETAIRE',
      status: 'EN_ATTENTE',
      requiresTwoApprovers: false,
      reviewedBy: null,
      reviewedByName: null,
      reviewedAt: null,
      createdAt: now,
    };
    this.db.approvals.unshift(req);
    this.appendAudit(actor, 'DEMANDE_ANNULATION_VENTE', 'Sale', sale.id, sale.docNumber, { status: sale.status }, { requestId: req.id, reason }, 'Web / API', false, sale.warehouseId);
    this.save();
    return req;
  }

  // 5. Cash Session Open / Close / Validate
  public openCashSession(actor: UserAccount, openingFloat: number, requestedWarehouseId?: string) {
    this.requirePermission(actor, PERMISSIONS.CASH_OPEN);
    const warehouseId = this.resolveWarehouseId(actor, requestedWarehouseId);
    const existing = this.db.cashSessions.find(
      (c) => c.warehouseId === warehouseId && (c.status === 'OUVERTE' || c.status === 'EN_ATTENTE_VALIDATION')
    );
    if (existing) {
      throw new GovernanceError('Une session de caisse est déjà ouverte ou en attente de validation sur ce dépôt.', 400);
    }
    const now = new Date().toISOString();
    const cs: CashSession = {
      id: `cs-${Date.now()}`,
      docNumber: this.nextDoc('CAI'),
      cashierId: actor.id,
      cashierName: actor.name,
      warehouseId,
      openedAt: now,
      closedAt: null,
      openingFloat: Math.max(0, Number(openingFloat) || 0),
      expectedCash: Math.max(0, Number(openingFloat) || 0),
      countedCash: null,
      variance: null,
      totalCashSales: 0,
      totalMobileMoney: 0,
      totalCreditSales: 0,
      totalDepositRefunds: 0,
      totalExpenses: 0,
      status: 'OUVERTE',
    };
    this.db.cashSessions.unshift(cs);
    this.appendAudit(actor, 'OUVERTURE_CAISSE', 'CashSession', cs.id, cs.docNumber, null, cs, 'Web / API', false, warehouseId);
    this.save();
    return cs;
  }

  public closeCashSession(actor: UserAccount, cashSessionId: string, countedCash: number, notes: string) {
    this.requirePermission(actor, PERMISSIONS.CASH_CLOSE);
    const cs = this.db.cashSessions.find((c) => c.id === cashSessionId && c.status === 'OUVERTE');
    if (!cs) throw new GovernanceError('Session de caisse ouverte introuvable.', 404);
    this.assertWarehouseScope(actor, cs.warehouseId);

    const counted = Math.max(0, Number(countedCash));
    const variance = counted - cs.expectedCash;
    const now = new Date().toISOString();
    const before = { ...cs };
    cs.countedCash = counted;
    cs.variance = variance;
    cs.closedAt = now;
    cs.closedBy = actor.id;
    cs.notes = notes;
    cs.status = 'EN_ATTENTE_VALIDATION';

    this.db.approvals.unshift({
      id: `apr-${Date.now()}`,
      warehouseId: cs.warehouseId,
      type: 'CLOTURE_CAISSE',
      entityId: cs.id,
      docNumber: cs.docNumber,
      description: `Validation clôture caisse ${cs.docNumber} (${cs.cashierName} · Écart : ${variance.toLocaleString('fr-FR')} FCFA)`,
      amount: counted,
      metadata: { variance, notes },
      requestedBy: actor.id,
      requestedByName: actor.name,
      targetRole: 'PROPRIETAIRE',
      status: 'EN_ATTENTE',
      requiresTwoApprovers: false,
      reviewedBy: null,
      reviewedByName: null,
      reviewedAt: null,
      createdAt: now,
    });

    this.appendAudit(actor, 'CLOTURE_CAISSE_EN_ATTENTE', 'CashSession', cs.id, cs.docNumber, before, cs, 'Web / API', false, cs.warehouseId);
    this.save();
    return { session: cs, pv: null, pendingValidation: true };
  }

  public validateCashSession(actor: UserAccount, cashSessionId: string, decisionNote?: string) {
    this.requirePermission(actor, PERMISSIONS.CASH_CLOSE_VALIDATE);
    const cs = this.db.cashSessions.find((c) => c.id === cashSessionId);
    if (!cs) throw new GovernanceError('Session de caisse introuvable.', 404);
    this.assertWarehouseScope(actor, cs.warehouseId);

    if (cs.status !== 'EN_ATTENTE_VALIDATION') {
      throw new GovernanceError('Cette caisse doit d’abord être clôturée avant validation.', 400);
    }
    if (cs.cashierId === actor.id || cs.closedBy === actor.id) {
      throw new GovernanceError(
        'Séparation des tâches : un utilisateur ne peut jamais valider sa propre clôture de caisse.',
        403,
        'SEPARATION_OF_DUTIES'
      );
    }

    const now = new Date().toISOString();
    const before = { status: cs.status };
    cs.status = 'CLOTUREE';
    cs.validatedBy = actor.id;

    const approval = this.db.approvals.find(
      (a) => a.type === 'CLOTURE_CAISSE' && a.entityId === cs.id && a.status === 'EN_ATTENTE'
    );
    if (approval) {
      approval.status = 'APPROUVE';
      approval.reviewedBy = actor.id;
      approval.reviewedByName = actor.name;
      approval.reviewedAt = now;
      approval.decisionNote = decisionNote || null;
    }

    const pv: ReconciliationPV = {
      id: `pv-${Date.now()}`,
      docNumber: this.nextDoc('PV'),
      warehouseId: cs.warehouseId,
      type: 'QUOTIDIENNE_CAISSE',
      periodLabel: `Clôture ${cs.docNumber}`,
      systemValue: cs.expectedCash,
      physicalOrExternalValue: cs.countedCash ?? cs.expectedCash,
      variance: cs.variance ?? 0,
      notes: decisionNote || cs.notes || 'Clôture validée.',
      preparedBy: cs.cashierName,
      signedBy: actor.name,
      signedRole: actor.role,
      signedAt: now,
    };
    this.db.reconciliations.unshift(pv);
    this.appendAudit(actor, 'CLOTURE_CAISSE_VALIDEE', 'CashSession', cs.id, cs.docNumber, before, cs, 'Web / API', false, cs.warehouseId);
    this.save();
    return { session: cs, pv };
  }

  // 6. Consignments Return & Sensitive Adjustments/Loss
  public requestConsignmentAdjustmentOrLoss(
    actor: UserAccount,
    input: {
      customerId: string;
      packagingId: string;
      type: 'AJUSTEMENT_CONSIGNE' | 'PERTE_CONSIGNE';
      cratesQty: number;
      reason: string;
    }
  ) {
    this.requirePermission(actor, PERMISSIONS.CONSIGNMENT_LOSS);
    const customer = this.db.customers.find((c) => c.id === input.customerId && !c.deletedAt);
    const pkg = this.db.packagings.find((p) => p.id === input.packagingId);
    if (!customer || !pkg) throw new GovernanceError('Client ou conditionnement introuvable.', 404);
    if (!input.reason.trim()) throw new GovernanceError('Motif obligatoire pour perte ou ajustement de consigne.', 400);

    const qty = Math.max(1, Number(input.cratesQty));
    const depositAmount = qty * pkg.depositPerCrate;
    const now = new Date().toISOString();
    const warehouseId = this.resolveWarehouseId(actor);

    const req: ApprovalRequest = {
      id: `apr-${Date.now()}`,
      warehouseId,
      type: input.type,
      entityId: customer.id,
      docNumber: this.nextDoc('CSG'),
      description: `${input.type === 'PERTE_CONSIGNE' ? 'Perte / Casse client' : 'Ajustement consigne'} : ${qty}× ${pkg.label} chez ${customer.name} (${input.reason})`,
      amount: depositAmount,
      metadata: { packagingId: pkg.id, cratesQty: qty, reason: input.reason },
      requestedBy: actor.id,
      requestedByName: actor.name,
      targetRole: 'PROPRIETAIRE',
      status: 'EN_ATTENTE',
      requiresTwoApprovers: false,
      reviewedBy: null,
      reviewedByName: null,
      reviewedAt: null,
      createdAt: now,
    };
    this.db.approvals.unshift(req);
    this.appendAudit(actor, `DEMANDE_${input.type}`, 'Consignment', customer.id, req.docNumber, null, req, 'Web / API', false, warehouseId);
    this.save();
    return req;
  }

  public recordConsignmentReturn(
    actor: UserAccount,
    input: {
      customerId: string;
      packagingId: string;
      cratesIn: number;
      bottlesMissing: number;
      settlementMode: 'REMBOURSEMENT_CAISSE' | 'AVOIR_CLIENT';
      warehouseId?: string;
      offlineOriginated?: boolean;
    }
  ) {
    this.requirePermission(actor, PERMISSIONS.CONSIGNMENT_RETURN_IN);
    const warehouseId = this.resolveWarehouseId(actor, input.warehouseId);
    const customer = this.db.customers.find((c) => c.id === input.customerId && !c.deletedAt);
    if (!customer) throw new GovernanceError('Client introuvable.', 404);
    const pkg = this.db.packagings.find((p) => p.id === input.packagingId);
    if (!pkg || !pkg.isReturnable) throw new GovernanceError('Conditionnement non consigné.', 400);

    const cratesIn = Math.max(1, Number(input.cratesIn));
    const bottlesMissing = Math.max(0, Number(input.bottlesMissing) || 0);
    const grossDeposit = cratesIn * pkg.depositPerCrate;
    const missingPenalty = bottlesMissing * pkg.depositPerBottle;
    const netRefund = Math.max(0, grossDeposit - missingPenalty);

    if (
      input.settlementMode === 'REMBOURSEMENT_CAISSE' &&
      netRefund > this.db.company.highDepositRefundThreshold &&
      !this.hasPermission(actor, PERMISSIONS.CONSIGNMENT_LOSS_OVER)
    ) {
      const now = new Date().toISOString();
      const req: ApprovalRequest = {
        id: `apr-${Date.now()}`,
        warehouseId,
        type: 'REMBOURSEMENT_CAUTION',
        entityId: customer.id,
        docNumber: this.nextDoc('CSG'),
        description: `Remboursement caution espèces > ${this.db.company.highDepositRefundThreshold.toLocaleString('fr-FR')} FCFA : ${cratesIn}× ${pkg.label} pour ${customer.name}`,
        amount: netRefund,
        metadata: { ...input, warehouseId, grossDeposit, netRefund },
        requestedBy: actor.id,
        requestedByName: actor.name,
        targetRole: 'PROPRIETAIRE',
        status: 'EN_ATTENTE',
        requiresTwoApprovers: false,
        reviewedBy: null,
        reviewedByName: null,
        reviewedAt: null,
        createdAt: now,
      };
      this.db.approvals.unshift(req);
      this.appendAudit(actor, 'DEMANDE_REMBOURSEMENT_CAUTION', 'Consignment', customer.id, req.docNumber, null, req, 'Web / API', false, warehouseId);
      this.save();
      return { pendingApproval: true, approval: req };
    }

    const now = new Date().toISOString();
    customer.consignmentCrates = Math.max(0, customer.consignmentCrates - cratesIn);
    customer.consignmentBottles = Math.max(0, customer.consignmentBottles - (cratesIn * pkg.unitsPerPack - bottlesMissing));
    customer.consignmentDepositDue = Math.max(0, customer.consignmentDepositDue - grossDeposit);
    if (input.settlementMode === 'AVOIR_CLIENT' && customer.creditBalance > 0) {
      customer.creditBalance = Math.max(0, customer.creditBalance - netRefund);
    }
    customer.updatedAt = now;

    const stk = this.db.stocks.find((s) => s.warehouseId === warehouseId && s.packagingId === pkg.id);
    if (stk) {
      stk.emptyCratesOnHand += cratesIn;
      stk.updatedAt = now;
    }

    const movement: ConsignmentMovement = {
      id: `csg-${Date.now()}`,
      docNumber: this.nextDoc('CSG'),
      warehouseId,
      movementType: 'RETOUR_CLIENT',
      customerId: customer.id,
      supplierId: null,
      packagingId: pkg.id,
      cratesOut: 0,
      cratesIn,
      bottlesMissing,
      depositAmount: netRefund,
      settlementMode: input.settlementMode,
      referenceDoc: `RET-${customer.code}`,
      createdBy: actor.id,
      createdAt: now,
    };
    this.db.consignments.unshift(movement);

    if (input.settlementMode === 'REMBOURSEMENT_CAISSE' && netRefund > 0) {
      const activeCash = this.db.cashSessions.find((c) => c.warehouseId === warehouseId && c.status === 'OUVERTE');
      if (activeCash) {
        activeCash.totalDepositRefunds += netRefund;
        activeCash.expectedCash = Math.max(0, activeCash.expectedCash - netRefund);
      }
      this.db.treasury.unshift({
        id: `trs-${Date.now()}`,
        docNumber: this.nextDoc('TRS'),
        warehouseId,
        wallet: 'CAISSE',
        direction: 'SORTIE',
        category: 'Remboursement caution',
        amount: netRefund,
        reference: movement.docNumber,
        description: `Retour ${cratesIn} casiers vides — ${customer.name}`,
        createdBy: actor.id,
        createdAt: now,
      });
    }

    this.appendAudit(actor, 'RETOUR_CONSIGNE_CLIENT', 'ConsignmentMovement', movement.id, movement.docNumber, null, movement, 'Web / Terrain', Boolean(input.offlineOriginated), warehouseId);
    this.save();
    return movement;
  }

  // 7. Delivery Routes, OwnRouteGuard & Isolated Mini-Caisse
  public getDeliveryRouteById(actor: UserAccount, routeId: string): DeliveryRoute {
    const route = this.db.deliveryRoutes.find((r) => r.id === routeId);
    if (!route) throw new GovernanceError('Tournée introuvable.', 404);
    this.assertOwnRoute(actor, route);
    return route;
  }

  public createDeliveryRoute(
    actor: UserAccount,
    input: {
      driverId: string;
      warehouseId?: string;
      vehicleType: DeliveryRoute['vehicleType'];
      vehiclePlate: string;
      zone: string;
      tourCashFloat?: number;
      saleIds: string[];
    }
  ) {
    this.requirePermission(actor, PERMISSIONS.DELIVERY_PLAN);
    const warehouseId = this.resolveWarehouseId(actor, input.warehouseId);
    const driver = this.db.users.find((u) => u.id === input.driverId && !u.deletedAt && u.active);
    if (!driver) throw new GovernanceError('Livreur introuvable.', 404);
    if (driver.role !== 'LIVREUR') {
      throw new GovernanceError('Seul un utilisateur au rôle LIVREUR peut conduire une tournée.', 400);
    }
    if (driver.warehouseId !== warehouseId) {
      throw new GovernanceError('Le livreur sélectionné appartient à un autre dépôt.', 403, 'WAREHOUSE_FORBIDDEN');
    }

    const now = new Date().toISOString();
    const stops = input.saleIds.map((saleId, idx) => {
      const sale = this.db.sales.find((s) => s.id === saleId);
      if (!sale) throw new GovernanceError(`Vente ${saleId} introuvable.`, 404);
      if (sale.warehouseId !== warehouseId) {
        throw new GovernanceError(`La vente ${sale.docNumber} appartient à un autre dépôt.`, 403, 'WAREHOUSE_FORBIDDEN');
      }
      const cust = this.db.customers.find((c) => c.id === sale.customerId);
      const crates = sale.lines.reduce((s, l) => s + l.qty, 0);
      return {
        id: `stp-${Date.now()}-${idx}`,
        saleId: sale.id,
        saleDocNumber: sale.docNumber,
        customerId: sale.customerId,
        customerName: cust?.name || 'Client',
        zone: cust?.zone || input.zone,
        orderIndex: idx + 1,
        cratesToDeliver: crates,
        amountDue: sale.creditAdded,
        status: 'PLANIFIE' as const,
        deliveredAt: null,
        emptyCratesCollected: 0,
        cashCollected: 0,
        paymentMethodCollected: null,
        signatureDataUrl: null,
        isNonCompliant: false,
        gpsCoords: null,
        photoDataUrl: null,
        breakageBottles: 0,
        notes: '',
      };
    });

    const tourCashFloat = Math.max(0, Number(input.tourCashFloat) || 0);
    const tourEmptyCratesExpected = stops.reduce((s, st) => s + st.cratesToDeliver, 0);

    const route: DeliveryRoute = {
      id: `rte-${Date.now()}`,
      docNumber: this.nextDoc('TRN'),
      warehouseId,
      driverId: driver.id,
      driverName: driver.name,
      vehicleType: input.vehicleType,
      vehiclePlate: input.vehiclePlate,
      zone: input.zone,
      routeDate: now.slice(0, 10),
      status: 'EN_TOURNEE',
      tourCashFloat,
      tourCashCollected: 0,
      tourMobileMoneyCollected: 0,
      tourExpectedCash: tourCashFloat,
      tourHandedOverCash: null,
      tourCashVariance: null,
      tourEmptyCratesExpected,
      tourEmptyCratesReturned: null,
      closedByDriverAt: null,
      validatedByGerantId: null,
      validatedByGerantAt: null,
      reassignedFromDriverId: null,
      stops,
      createdBy: actor.id,
      createdAt: now,
    };
    this.db.deliveryRoutes.unshift(route);
    this.appendAudit(actor, 'CREATION_TOURNEE_LIVRAISON', 'DeliveryRoute', route.id, route.docNumber, null, route, 'Web / API', false, warehouseId);
    this.save();
    return route;
  }

  public reassignDeliveryRoute(
    actor: UserAccount,
    routeId: string,
    newDriverId: string,
    reason: string
  ): DeliveryRoute {
    this.requirePermission(actor, PERMISSIONS.DELIVERY_PLAN);
    const route = this.db.deliveryRoutes.find((r) => r.id === routeId);
    if (!route) throw new GovernanceError('Tournée introuvable.', 404);
    this.assertWarehouseScope(actor, route.warehouseId);
    if (route.status === 'CLOTUREE') {
      throw new GovernanceError('Impossible de réaffecter une tournée déjà clôturée.', 400);
    }
    const newDriver = this.db.users.find((u) => u.id === newDriverId && !u.deletedAt && u.active);
    if (!newDriver || newDriver.role !== 'LIVREUR') {
      throw new GovernanceError('Nouveau livreur invalide.', 400);
    }
    if (newDriver.warehouseId !== route.warehouseId) {
      throw new GovernanceError('Le livreur de remplacement doit appartenir au même dépôt.', 403, 'WAREHOUSE_FORBIDDEN');
    }

    const before = { driverId: route.driverId, driverName: route.driverName };
    route.reassignedFromDriverId = route.driverId;
    route.driverId = newDriver.id;
    route.driverName = newDriver.name;
    this.appendAudit(
      actor,
      'REASSIGNATION_TOURNEE_PANNE',
      'DeliveryRoute',
      route.id,
      route.docNumber,
      before,
      { driverId: newDriver.id, driverName: newDriver.name, reason: reason || 'Panne véhicule / urgence' },
      'Web / API',
      false,
      route.warehouseId
    );
    this.save();
    return route;
  }

  public completeDeliveryStop(
    actor: UserAccount,
    routeId: string,
    stopId: string,
    input: {
      emptyCratesCollected: number;
      cashCollected: number;
      paymentMethodCollected: PaymentMethod | null;
      signatureDataUrl: string | null;
      status?: 'LIVRE' | 'RETOUR_PARTIEL';
      gpsCoords?: string | null;
      photoDataUrl?: string | null;
      breakageBottles?: number;
      packagingIdForBreakage?: string;
      notes: string;
      offlineOriginated?: boolean;
    }
  ) {
    if (!this.hasPermission(actor, PERMISSIONS.BL_EMIT) && !this.hasPermission(actor, PERMISSIONS.DELIVERY_COMPLETE)) {
      this.requirePermission(actor, PERMISSIONS.BL_EMIT);
    }
    const route = this.db.deliveryRoutes.find((r) => r.id === routeId);
    if (!route) throw new GovernanceError('Tournée introuvable.', 404);
    this.assertOwnRoute(actor, route);

    const stop = route.stops.find((s) => s.id === stopId);
    if (!stop) throw new GovernanceError('Point de livraison introuvable.', 404);
    if (stop.status === 'LIVRE' || stop.status === 'RETOUR_PARTIEL') {
      throw new GovernanceError('Ce point de livraison a déjà été validé.', 400);
    }

    const breakageBottles = Math.max(0, Number(input.breakageBottles) || 0);
    const targetStatus = input.status === 'RETOUR_PARTIEL' ? 'RETOUR_PARTIEL' : 'LIVRE';

    if ((targetStatus === 'RETOUR_PARTIEL' || breakageBottles > 0) && !input.photoDataUrl) {
      throw new GovernanceError(
        'Une photo justificative est obligatoire pour toute casse ou retour partiel en tournée.',
        400,
        'PHOTO_REQUIRED'
      );
    }

    const now = new Date().toISOString();
    const isNonCompliant = !input.signatureDataUrl;

    stop.status = targetStatus;
    stop.deliveredAt = now;
    stop.emptyCratesCollected = Math.max(0, Number(input.emptyCratesCollected) || 0);
    stop.cashCollected = Math.max(0, Number(input.cashCollected) || 0);
    stop.paymentMethodCollected = input.paymentMethodCollected;
    stop.signatureDataUrl = input.signatureDataUrl;
    stop.isNonCompliant = isNonCompliant;
    stop.gpsCoords = input.gpsCoords || null;
    stop.photoDataUrl = input.photoDataUrl || null;
    stop.breakageBottles = breakageBottles;
    stop.notes = input.notes || '';

    const cust = this.db.customers.find((c) => c.id === stop.customerId);
    if (cust && stop.emptyCratesCollected > 0) {
      cust.consignmentCrates = Math.max(0, cust.consignmentCrates - stop.emptyCratesCollected);
      cust.updatedAt = now;
    }

    // Mini-caisse isolée : les espèces restent dans tourCashCollected jusqu'à la remise physique au Gérant
    if (stop.cashCollected > 0) {
      if (cust) {
        cust.creditBalance = Math.max(0, cust.creditBalance - stop.cashCollected);
      }
      const method = stop.paymentMethodCollected || 'ESPECES';
      if (method === 'ESPECES' || method === 'CREDIT') {
        route.tourCashCollected += stop.cashCollected;
        route.tourExpectedCash = route.tourCashFloat + route.tourCashCollected;
      } else {
        route.tourMobileMoneyCollected += stop.cashCollected;
      }
    }

    if (breakageBottles > 0) {
      const pkgId = input.packagingIdForBreakage || 'pkg-bock-33';
      const rb: ReturnBreakageRecord = {
        id: `rb-${Date.now()}`,
        docNumber: this.nextDoc('CAS'),
        warehouseId: route.warehouseId,
        routeId: route.id,
        type: 'CASSE_COULAGE',
        customerId: stop.customerId,
        supplierId: null,
        packagingId: pkgId,
        qtyPacks: 0,
        qtyBottles: breakageBottles,
        financialImpact: breakageBottles * 400,
        reason: `Casse déclarée sur tournée ${route.docNumber} (${stop.customerName}) : ${input.notes || 'transport'}`,
        photoDataUrl: input.photoDataUrl || null,
        settlement: 'PERTE_SECHE',
        status: 'EN_ATTENTE',
        createdBy: actor.id,
        validatedBy: null,
        createdAt: now,
      };
      this.db.returnsBreakages.unshift(rb);
      this.db.approvals.unshift({
        id: `apr-${Date.now()}-brk`,
        warehouseId: route.warehouseId,
        type: 'RETOUR_CASSE_LIVREUR',
        entityId: rb.id,
        docNumber: rb.docNumber,
        description: `Casse tournée ${route.docNumber} (${breakageBottles} btl) — ${stop.customerName}`,
        amount: rb.financialImpact,
        metadata: { routeId: route.id, stopId: stop.id },
        requestedBy: actor.id,
        requestedByName: actor.name,
        targetRole: 'GERANT',
        status: 'EN_ATTENTE',
        requiresTwoApprovers: false,
        reviewedBy: null,
        reviewedByName: null,
        reviewedAt: null,
        createdAt: now,
      });
    }

    if (isNonCompliant) {
      this.appendAudit(
        actor,
        'LIVRAISON_NON_CONFORME_SANS_SIGNATURE',
        'DeliveryRoute',
        route.id,
        stop.saleDocNumber,
        null,
        { stopId, customerName: stop.customerName, warning: 'BL livré sans signature tactile client' },
        'Mobile Livreur',
        Boolean(input.offlineOriginated),
        route.warehouseId
      );
    }

    if (route.stops.every((s) => s.status === 'LIVRE' || s.status === 'RETOUR_PARTIEL')) {
      route.status = 'EN_ATTENTE_REMISE';
    }

    this.appendAudit(
      actor,
      'VALIDATION_BON_LIVRAISON',
      'DeliveryRoute',
      route.id,
      stop.saleDocNumber,
      null,
      {
        stopId,
        status: stop.status,
        emptyCratesCollected: stop.emptyCratesCollected,
        cashCollected: stop.cashCollected,
        isNonCompliant,
      },
      'Mobile Livreur',
      Boolean(input.offlineOriginated),
      route.warehouseId
    );
    this.save();
    return route;
  }

  public closeTourneeByDriver(
    actor: UserAccount,
    routeId: string,
    input: { handedOverCash: number; emptyCratesReturned: number; notes?: string }
  ): DeliveryRoute {
    this.requirePermission(actor, PERMISSIONS.CASH_TOURNEE_CLOSE);
    const route = this.db.deliveryRoutes.find((r) => r.id === routeId);
    if (!route) throw new GovernanceError('Tournée introuvable.', 404);
    this.assertOwnRoute(actor, route);
    if (route.status === 'CLOTUREE') {
      throw new GovernanceError('Cette tournée est déjà clôturée et validée par le Gérant.', 400);
    }

    const now = new Date().toISOString();
    const handedOverCash = Math.max(0, Number(input.handedOverCash) || 0);
    const emptyCratesReturned = Math.max(0, Number(input.emptyCratesReturned) || 0);
    route.tourHandedOverCash = handedOverCash;
    route.tourCashVariance = handedOverCash - route.tourExpectedCash;
    route.tourEmptyCratesReturned = emptyCratesReturned;
    route.closedByDriverAt = now;
    route.status = 'EN_ATTENTE_REMISE';

    this.appendAudit(
      actor,
      'CLOTURE_MINI_CAISSE_LIVREUR',
      'DeliveryRoute',
      route.id,
      route.docNumber,
      null,
      {
        expectedCash: route.tourExpectedCash,
        handedOverCash,
        variance: route.tourCashVariance,
        emptyCratesReturned,
        notes: input.notes || '',
      },
      'Mobile Livreur',
      false,
      route.warehouseId
    );
    this.save();
    return route;
  }

  public validateTourneeHandover(
    actor: UserAccount,
    routeId: string,
    input: { countedCash: number; emptyCratesCounted: number; notes?: string }
  ): DeliveryRoute {
    this.requirePermission(actor, PERMISSIONS.DELIVERY_COMPLETE);
    const route = this.db.deliveryRoutes.find((r) => r.id === routeId);
    if (!route) throw new GovernanceError('Tournée introuvable.', 404);
    this.assertWarehouseScope(actor, route.warehouseId);
    if (route.status === 'CLOTUREE') {
      throw new GovernanceError('Tournée déjà clôturée.', 400);
    }

    const now = new Date().toISOString();
    const countedCash = Math.max(0, Number(input.countedCash) || 0);
    const emptyCratesCounted = Math.max(0, Number(input.emptyCratesCounted) || 0);
    const variance = countedCash - route.tourExpectedCash;

    route.tourHandedOverCash = countedCash;
    route.tourCashVariance = variance;
    route.tourEmptyCratesReturned = emptyCratesCounted;
    route.validatedByGerantId = actor.id;
    route.validatedByGerantAt = now;
    route.status = 'CLOTUREE';

    if (countedCash > 0) {
      const activeCash = this.db.cashSessions.find(
        (c) => c.warehouseId === route.warehouseId && c.status === 'OUVERTE'
      );
      if (activeCash) {
        activeCash.expectedCash += countedCash;
      }
      this.db.treasury.unshift({
        id: `trs-${Date.now()}`,
        docNumber: this.nextDoc('TRS'),
        warehouseId: route.warehouseId,
        wallet: 'CAISSE',
        direction: 'ENTREE',
        category: 'Remise caisse tournée',
        amount: countedCash,
        reference: route.docNumber,
        description: `Remise espèces tournée ${route.docNumber} (${route.driverName})`,
        createdBy: actor.id,
        createdAt: now,
      });
    }

    if (route.tourMobileMoneyCollected > 0) {
      this.db.treasury.unshift({
        id: `trs-${Date.now()}-mm`,
        docNumber: this.nextDoc('TRS'),
        warehouseId: route.warehouseId,
        wallet: 'ORANGE_MONEY',
        direction: 'ENTREE',
        category: 'Encaissement Mobile Money tournée',
        amount: route.tourMobileMoneyCollected,
        reference: route.docNumber,
        description: `Mobile Money tournée ${route.docNumber} (${route.driverName})`,
        createdBy: actor.id,
        createdAt: now,
      });
    }

    if (variance < 0) {
      this.db.approvals.unshift({
        id: `apr-${Date.now()}-ecart`,
        warehouseId: route.warehouseId,
        type: 'ECART_TOURNEE',
        entityId: route.id,
        docNumber: route.docNumber,
        description: `Manquant caisse tournée ${route.docNumber} (${route.driverName}) : ${variance.toLocaleString('fr-FR')} FCFA`,
        amount: Math.abs(variance),
        metadata: { driverId: route.driverId, expected: route.tourExpectedCash, counted: countedCash, notes: input.notes },
        requestedBy: actor.id,
        requestedByName: actor.name,
        targetRole: 'PROPRIETAIRE',
        status: 'EN_ATTENTE',
        requiresTwoApprovers: false,
        reviewedBy: null,
        reviewedByName: null,
        reviewedAt: null,
        createdAt: now,
      });
    }

    this.appendAudit(
      actor,
      'VALIDATION_REMISE_TOURNEE',
      'DeliveryRoute',
      route.id,
      route.docNumber,
      null,
      {
        expectedCash: route.tourExpectedCash,
        countedCash,
        variance,
        emptyCratesCounted,
        notes: input.notes || '',
      },
      'Web / Gérant',
      false,
      route.warehouseId
    );
    this.save();
    return route;
  }

  // 8. Credit Payment & Write-Off
  public recordCreditPayment(
    actor: UserAccount,
    input: {
      creditId: string;
      amount: number;
      method: Exclude<PaymentMethod, 'CREDIT'>;
      reference: string;
    }
  ) {
    this.requirePermission(actor, PERMISSIONS.CREDIT_GRANT);
    const crd = this.db.credits.find((c) => c.id === input.creditId);
    if (!crd) throw new GovernanceError('Créance introuvable.', 404);
    if (crd.warehouseId) {
      this.assertWarehouseScope(actor, crd.warehouseId);
    }
    if (crd.status === 'ABANDONNE' || crd.status === 'SOLDE') {
      throw new GovernanceError('Cette créance est déjà clôturée.', 400);
    }

    const amount = Math.min(crd.remainingAmount, Math.max(1, Number(input.amount)));
    const now = new Date().toISOString();

    const before = { remainingAmount: crd.remainingAmount, status: crd.status };
    crd.remainingAmount -= amount;
    crd.status = crd.remainingAmount <= 0 ? 'SOLDE' : 'PARTIEL';

    const cust = this.db.customers.find((c) => c.id === crd.customerId);
    if (cust) {
      cust.creditBalance = Math.max(0, cust.creditBalance - amount);
      cust.updatedAt = now;
    }

    const pay: CreditPayment = {
      id: `cp-${Date.now()}`,
      creditId: crd.id,
      customerId: crd.customerId,
      amount,
      method: input.method,
      reference: input.reference || `REG-${Date.now().toString().slice(-5)}`,
      createdBy: actor.id,
      createdAt: now,
    };
    this.db.creditPayments.unshift(pay);

    const whId = crd.warehouseId || actor.warehouseId || 'wh-main';
    const activeCash = this.db.cashSessions.find((c) => c.warehouseId === whId && c.status === 'OUVERTE');
    if (activeCash && input.method === 'ESPECES') {
      activeCash.expectedCash += amount;
    }

    this.db.treasury.unshift({
      id: `trs-${Date.now()}`,
      docNumber: this.nextDoc('TRS'),
      warehouseId: whId,
      wallet: input.method === 'ESPECES' ? 'CAISSE' : input.method,
      direction: 'ENTREE',
      category: 'Recouvrement crédit',
      amount,
      reference: pay.reference,
      description: `Règlement ${crd.docNumber} — ${cust?.name || ''}`,
      createdBy: actor.id,
      createdAt: now,
    });

    this.appendAudit(actor, 'RECOUVREMENT_CREDIT', 'CreditRecord', crd.id, crd.docNumber, before, { remainingAmount: crd.remainingAmount, amountPaid: amount }, 'Web / API', false, whId);
    this.save();
    return { credit: crd, payment: pay };
  }

  public writeOffCredit(actor: UserAccount, creditId: string, reason: string): CreditRecord {
    this.requirePermission(actor, PERMISSIONS.CREDIT_WRITE_OFF);
    const crd = this.db.credits.find((c) => c.id === creditId);
    if (!crd) throw new GovernanceError('Créance introuvable.', 404);
    if (crd.status === 'SOLDE' || crd.status === 'ABANDONNE') {
      throw new GovernanceError('Cette créance est déjà soldée ou abandonnée.', 400);
    }
    if (!reason?.trim()) throw new GovernanceError('Un motif d’abandon de créance est obligatoire.', 400);

    const now = new Date().toISOString();
    const before = { remainingAmount: crd.remainingAmount, status: crd.status };
    const writtenOffAmount = crd.remainingAmount;
    crd.remainingAmount = 0;
    crd.status = 'ABANDONNE';
    crd.writeOffReason = reason.trim();
    crd.writtenOffBy = actor.id;

    const cust = this.db.customers.find((c) => c.id === crd.customerId);
    if (cust) {
      cust.creditBalance = Math.max(0, cust.creditBalance - writtenOffAmount);
      cust.updatedAt = now;
    }

    this.appendAudit(actor, 'ABANDON_CREANCE', 'CreditRecord', crd.id, crd.docNumber, before, { status: 'ABANDONNE', writtenOffAmount, reason }, 'Web / API', false, crd.warehouseId || null);
    this.save();
    return crd;
  }

  public requestCreditWriteOff(actor: UserAccount, creditId: string, reason: string): ApprovalRequest {
    this.requirePermission(actor, PERMISSIONS.CREDIT_GRANT);
    const crd = this.db.credits.find((c) => c.id === creditId);
    if (!crd) throw new GovernanceError('Créance introuvable.', 404);
    if (crd.warehouseId) this.assertWarehouseScope(actor, crd.warehouseId);
    if (!reason?.trim()) throw new GovernanceError('Motif obligatoire.', 400);
    const cust = this.db.customers.find((c) => c.id === crd.customerId);
    const req: ApprovalRequest = {
      id: `apr-${Date.now()}`,
      warehouseId: crd.warehouseId || actor.warehouseId || null,
      type: 'ABANDON_CREANCE',
      entityId: crd.id,
      docNumber: crd.docNumber,
      description: `Demande d’abandon de créance ${crd.docNumber} (${cust?.name || ''}) : ${reason}`,
      amount: crd.remainingAmount,
      metadata: { reason },
      requestedBy: actor.id,
      requestedByName: actor.name,
      targetRole: 'PROPRIETAIRE',
      status: 'EN_ATTENTE',
      requiresTwoApprovers: false,
      reviewedBy: null,
      reviewedByName: null,
      reviewedAt: null,
      createdAt: new Date().toISOString(),
    };
    this.db.approvals.unshift(req);
    this.appendAudit(actor, 'DEMANDE_ABANDON_CREANCE', 'CreditRecord', crd.id, crd.docNumber, null, req, 'Web / API', false, req.warehouseId || null);
    this.save();
    return req;
  }

  // 9. Inventory & Stock Adjustment
  public submitInventorySession(
    actor: UserAccount,
    input: {
      warehouseId: string;
      scope: 'TOURNANT' | 'GENERAL';
      lines: { packagingId: string; physicalQty: number; emptyCratesPhysical: number }[];
    }
  ) {
    this.requirePermission(actor, PERMISSIONS.STOCK_INVENTORY);
    const warehouseId = this.resolveWarehouseId(actor, input.warehouseId);
    const now = new Date().toISOString();
    const lines = input.lines.map((l) => {
      const stk = this.db.stocks.find((s) => s.warehouseId === warehouseId && s.packagingId === l.packagingId);
      const theo = stk?.qtyOnHand ?? 0;
      const empTheo = stk?.emptyCratesOnHand ?? 0;
      return {
        packagingId: l.packagingId,
        theoreticalQty: theo,
        physicalQty: Math.max(0, Number(l.physicalQty)),
        variance: Number(l.physicalQty) - theo,
        emptyCratesTheoretical: empTheo,
        emptyCratesPhysical: Math.max(0, Number(l.emptyCratesPhysical)),
      };
    });

    const hasOver5PctVariance = lines.some(
      (l) => l.theoreticalQty > 0 && Math.abs(l.variance) / l.theoreticalQty > 0.05
    );
    const canAutoValidate = hasOver5PctVariance
      ? this.hasPermission(actor, PERMISSIONS.STOCK_ADJUST_OVER_5)
      : this.hasPermission(actor, PERMISSIONS.STOCK_ADJUST);

    const session: InventorySession = {
      id: `inv-${Date.now()}`,
      docNumber: this.nextDoc('INV'),
      warehouseId,
      scope: input.scope,
      lines,
      status: canAutoValidate ? 'VALIDE' : 'EN_ATTENTE_VALIDATION',
      createdBy: actor.id,
      validatedBy: canAutoValidate ? actor.id : null,
      createdAt: now,
      validatedAt: canAutoValidate ? now : null,
    };
    this.db.inventories.unshift(session);

    if (canAutoValidate) {
      for (const line of lines) {
        const stk = this.db.stocks.find((s) => s.warehouseId === warehouseId && s.packagingId === line.packagingId);
        if (stk) {
          stk.qtyOnHand = line.physicalQty;
          stk.emptyCratesOnHand = line.emptyCratesPhysical;
          stk.updatedAt = now;
        }
      }
    } else {
      this.db.approvals.unshift({
        id: `apr-${Date.now()}`,
        warehouseId,
        type: 'AJUSTEMENT_INVENTAIRE',
        entityId: session.id,
        docNumber: session.docNumber,
        description: `Validation inventaire ${input.scope} (${lines.filter((l) => l.variance !== 0).length} écarts${hasOver5PctVariance ? ' > 5% — Approbation Propriétaire requise' : ''})`,
        amount: lines.reduce((s, l) => s + Math.abs(l.variance), 0),
        requestedBy: actor.id,
        requestedByName: actor.name,
        targetRole: 'PROPRIETAIRE',
        status: 'EN_ATTENTE',
        requiresTwoApprovers: false,
        reviewedBy: null,
        reviewedByName: null,
        reviewedAt: null,
        createdAt: now,
      });
    }

    this.appendAudit(actor, 'SAISIE_INVENTAIRE', 'InventorySession', session.id, session.docNumber, null, session, 'Web / API', false, warehouseId);
    this.save();
    return session;
  }

  // 10. Returns & Breakages
  public createReturnBreakage(
    actor: UserAccount,
    input: Omit<ReturnBreakageRecord, 'id' | 'docNumber' | 'status' | 'createdBy' | 'validatedBy' | 'createdAt'>
  ) {
    const isDriver = actor.role === 'LIVREUR';
    if (isDriver) {
      this.requirePermission(actor, PERMISSIONS.BREAKAGE_REPORT);
      if (!input.photoDataUrl) {
        throw new GovernanceError('Une photo justificative est obligatoire pour toute déclaration livreur.', 400, 'PHOTO_REQUIRED');
      }
    } else {
      this.requirePermission(actor, PERMISSIONS.STOCK_ADJUST);
    }

    const warehouseId = this.resolveWarehouseId(actor, input.warehouseId);
    const now = new Date().toISOString();
    const autoValidate = !isDriver;

    const record: ReturnBreakageRecord = {
      ...input,
      warehouseId,
      id: `rb-${Date.now()}`,
      docNumber: this.nextDoc('CAS'),
      status: autoValidate ? 'VALIDE' : 'EN_ATTENTE',
      createdBy: actor.id,
      validatedBy: autoValidate ? actor.id : null,
      createdAt: now,
    };
    this.db.returnsBreakages.unshift(record);

    if (autoValidate && record.type === 'CASSE_COULAGE') {
      const stk = this.db.stocks.find((s) => s.warehouseId === warehouseId && s.packagingId === record.packagingId);
      if (stk && record.qtyPacks > 0) {
        stk.qtyOnHand = Math.max(0, stk.qtyOnHand - record.qtyPacks);
        stk.updatedAt = now;
      }
    }

    if (isDriver) {
      this.db.approvals.unshift({
        id: `apr-${Date.now()}-rb`,
        warehouseId,
        type: 'RETOUR_CASSE_LIVREUR',
        entityId: record.id,
        docNumber: record.docNumber,
        description: `Déclaration ${record.type} par livreur ${actor.name} (${record.qtyPacks} packs, ${record.qtyBottles} btl) : ${record.reason}`,
        amount: record.financialImpact,
        metadata: { packagingId: record.packagingId, qtyPacks: record.qtyPacks },
        requestedBy: actor.id,
        requestedByName: actor.name,
        targetRole: 'GERANT',
        status: 'EN_ATTENTE',
        requiresTwoApprovers: false,
        reviewedBy: null,
        reviewedByName: null,
        reviewedAt: null,
        createdAt: now,
      });
    }

    this.appendAudit(actor, 'DECLARATION_RETOUR_CASSE', 'ReturnBreakage', record.id, record.docNumber, null, record, 'Web / API', false, warehouseId);
    this.save();
    return record;
  }

  // 11. Treasury Transfer / Expense
  public createTreasuryMovement(
    actor: UserAccount,
    input: {
      warehouseId?: string;
      wallet: TreasuryTransaction['wallet'];
      direction: TreasuryTransaction['direction'];
      targetWallet?: TreasuryTransaction['targetWallet'];
      category: string;
      amount: number;
      reference: string;
      description: string;
    }
  ) {
    this.requirePermission(actor, PERMISSIONS.TREASURY_MANAGE);
    const warehouseId = this.resolveWarehouseId(actor, input.warehouseId);
    const now = new Date().toISOString();
    const amount = Math.max(1, Number(input.amount));
    const tx: TreasuryTransaction = {
      id: `trs-${Date.now()}`,
      docNumber: this.nextDoc('TRS'),
      warehouseId,
      wallet: input.wallet,
      direction: input.direction,
      targetWallet: input.targetWallet,
      category: input.category,
      amount,
      reference: input.reference || `OP-${Date.now().toString().slice(-5)}`,
      description: input.description,
      createdBy: actor.id,
      createdAt: now,
    };
    this.db.treasury.unshift(tx);

    if (input.direction === 'SORTIE' && input.wallet === 'CAISSE') {
      const activeCash = this.db.cashSessions.find((c) => c.warehouseId === warehouseId && c.status === 'OUVERTE');
      if (activeCash) {
        activeCash.totalExpenses += amount;
        activeCash.expectedCash = Math.max(0, activeCash.expectedCash - amount);
      }
    }
    this.appendAudit(actor, 'MOUVEMENT_TRESORERIE', 'Treasury', tx.id, tx.docNumber, null, tx, 'Web / API', false, warehouseId);
    this.save();
    return tx;
  }

  // 12. Reconciliations
  public createReconciliationPV(
    actor: UserAccount,
    input: {
      warehouseId?: string;
      type: ReconciliationPV['type'];
      periodLabel: string;
      systemValue: number;
      physicalOrExternalValue: number;
      notes: string;
    }
  ) {
    this.requirePermission(actor, PERMISSIONS.RECONCILIATION_SIGN);
    const warehouseId = this.resolveWarehouseId(actor, input.warehouseId);
    const now = new Date().toISOString();
    const pv: ReconciliationPV = {
      id: `pv-${Date.now()}`,
      docNumber: this.nextDoc('PV'),
      warehouseId,
      type: input.type,
      periodLabel: input.periodLabel,
      systemValue: Number(input.systemValue),
      physicalOrExternalValue: Number(input.physicalOrExternalValue),
      variance: Number(input.physicalOrExternalValue) - Number(input.systemValue),
      notes: input.notes,
      preparedBy: actor.name,
      signedBy: actor.name,
      signedRole: actor.role,
      signedAt: now,
    };
    this.db.reconciliations.unshift(pv);
    this.appendAudit(actor, 'SIGNATURE_PV_RECONCILIATION', 'ReconciliationPV', pv.id, pv.docNumber, null, pv, 'Web / API', false, warehouseId);
    this.save();
    return pv;
  }

  // 13. Approvals (Strict Role + Delegation + Separation of Duties)
  private canActorApproveRequest(actor: UserAccount, req: ApprovalRequest): boolean {
    if (req.warehouseId) {
      this.assertWarehouseScope(actor, req.warehouseId);
    }
    if (req.requestedBy === actor.id) {
      throw new GovernanceError(
        'Séparation des tâches : un utilisateur ne peut jamais valider sa propre demande.',
        403,
        'SEPARATION_OF_DUTIES'
      );
    }
    if (actor.role === 'PROPRIETAIRE') return true;
    if (req.targetRole === 'GERANT' && actor.role === 'GERANT') return true;

    const permMap: Record<ApprovalRequest['type'], PermissionKey> = {
      REMISE_EXCEPTIONNELLE: PERMISSIONS.SALE_DISCOUNT_OVER_5,
      ANNULATION_VENTE: PERMISSIONS.SALE_CANCEL_CLOSED,
      AJUSTEMENT_INVENTAIRE: PERMISSIONS.STOCK_ADJUST_OVER_5,
      DEBLOCAGE_CREDIT: PERMISSIONS.CREDIT_LIMIT_UPDATE,
      ABANDON_CREANCE: PERMISSIONS.CREDIT_WRITE_OFF,
      REMBOURSEMENT_CAUTION: PERMISSIONS.CONSIGNMENT_LOSS_OVER,
      AJUSTEMENT_CONSIGNE: PERMISSIONS.CONSIGNMENT_LOSS_OVER,
      PERTE_CONSIGNE: PERMISSIONS.CONSIGNMENT_LOSS_OVER,
      CLOTURE_CAISSE: PERMISSIONS.CASH_CLOSE_VALIDATE,
      RETOUR_CASSE_LIVREUR: PERMISSIONS.DELIVERY_COMPLETE,
      ECART_TOURNEE: PERMISSIONS.CASH_CLOSE_VALIDATE,
    };
    const needed = permMap[req.type];
    return this.hasPermission(actor, needed);
  }

  public reviewApproval(
    actor: UserAccount,
    approvalId: string,
    decision: 'APPROUVE' | 'REJETE',
    decisionNote?: string
  ) {
    const req = this.db.approvals.find((a) => a.id === approvalId);
    if (!req) throw new GovernanceError('Demande introuvable.', 404);
    if (req.status !== 'EN_ATTENTE') throw new GovernanceError('Demande déjà clôturée.', 400);

    if (!this.canActorApproveRequest(actor, req)) {
      throw new GovernanceError(
        `Accès refusé : cette approbation (${req.type}) requiert le profil ${req.targetRole} ou une délégation active.`,
        403,
        'RBAC_FORBIDDEN'
      );
    }

    const now = new Date().toISOString();

    if (decision === 'REJETE') {
      req.status = 'REJETE';
      req.reviewedBy = actor.id;
      req.reviewedByName = actor.name;
      req.reviewedAt = now;
      req.decisionNote = decisionNote || null;

      if (req.type === 'CLOTURE_CAISSE') {
        const cs = this.db.cashSessions.find((c) => c.id === req.entityId);
        if (cs) cs.status = 'OUVERTE';
      } else if (req.type === 'REMISE_EXCEPTIONNELLE') {
        const sale = this.db.sales.find((s) => s.id === req.entityId);
        if (sale && sale.status === 'EN_ATTENTE_VALIDATION') {
          sale.status = 'ANNULEE';
        }
      }

      this.appendAudit(actor, 'VALIDATION_REJETE', 'ApprovalRequest', req.id, req.docNumber, { status: 'EN_ATTENTE' }, req, 'Web / API', false, req.warehouseId || null);
      this.save();
      return req;
    }

    req.reviewedBy = actor.id;
    req.reviewedByName = actor.name;
    req.reviewedAt = now;
    req.decisionNote = decisionNote || null;
    req.status = 'APPROUVE';

    if (req.type === 'REMISE_EXCEPTIONNELLE') {
      const sale = this.db.sales.find((s) => s.id === req.entityId);
      if (sale) {
        const meta = (req.metadata || {}) as { applyToExistingSale?: boolean };
        if (meta.applyToExistingSale) {
          const baseLiquid = sale.lines.reduce((s, l) => s + l.lineLiquidTotal, 0);
          sale.discountAmount = req.amount;
          sale.liquidTotal = Math.max(0, baseLiquid - req.amount);
          sale.grandTotal = Math.max(0, sale.liquidTotal + sale.depositNetTotal);
          sale.validatedBy = actor.id;
        } else if (sale.status === 'EN_ATTENTE_VALIDATION') {
          const customer = this.db.customers.find((c) => c.id === sale.customerId);
          const activeCash = this.db.cashSessions.find(
            (c) => c.warehouseId === sale.warehouseId && c.status === 'OUVERTE'
          );
          sale.status = 'VALIDEE';
          sale.validatedBy = actor.id;
          if (customer) {
            this.finalizeSaleEffects(actor, sale, activeCash, customer, now);
          }
        }
      }
    } else if (req.type === 'DEBLOCAGE_CREDIT') {
      const cust = this.db.customers.find((c) => c.id === req.entityId);
      if (cust) {
        cust.creditLimit += req.amount;
        cust.isBlocked = false;
        cust.updatedAt = now;
      }
    } else if (req.type === 'ABANDON_CREANCE') {
      const crd = this.db.credits.find((c) => c.id === req.entityId);
      if (crd && crd.status !== 'ABANDONNE') {
        const amt = crd.remainingAmount;
        crd.remainingAmount = 0;
        crd.status = 'ABANDONNE';
        crd.writtenOffBy = actor.id;
        crd.writeOffReason = String((req.metadata as { reason?: string })?.reason || decisionNote || 'Approuvé par le Propriétaire');
        const cust = this.db.customers.find((c) => c.id === crd.customerId);
        if (cust) {
          cust.creditBalance = Math.max(0, cust.creditBalance - amt);
          cust.updatedAt = now;
        }
      }
    } else if (req.type === 'AJUSTEMENT_INVENTAIRE') {
      const inv = this.db.inventories.find((i) => i.id === req.entityId);
      if (inv) {
        inv.status = 'VALIDE';
        inv.validatedBy = actor.id;
        inv.validatedAt = now;
        for (const line of inv.lines) {
          const stk = this.db.stocks.find((s) => s.warehouseId === inv.warehouseId && s.packagingId === line.packagingId);
          if (stk) {
            stk.qtyOnHand = line.physicalQty;
            stk.emptyCratesOnHand = line.emptyCratesPhysical;
            stk.updatedAt = now;
          }
        }
      }
    } else if (req.type === 'ANNULATION_VENTE') {
      const sale = this.db.sales.find((s) => s.id === req.entityId);
      if (sale && sale.status !== 'ANNULEE') {
        const beforeSale = { status: sale.status };
        sale.status = 'ANNULEE';
        sale.validatedBy = actor.id;
        const cust = this.db.customers.find((c) => c.id === sale.customerId);
        for (const line of sale.lines) {
          const stk = this.db.stocks.find((s) => s.warehouseId === sale.warehouseId && s.packagingId === line.packagingId);
          if (stk) {
            stk.qtyOnHand += line.qty;
            stk.emptyCratesOnHand = Math.max(0, stk.emptyCratesOnHand - line.emptyCratesReturnedNow);
            stk.updatedAt = now;
          }
        }
        if (cust) {
          cust.creditBalance = Math.max(0, cust.creditBalance - sale.creditAdded);
          const netCrates = sale.lines.reduce((sum, l) => sum + Math.max(0, l.qty - l.emptyCratesReturnedNow), 0);
          if (sale.depositNetTotal > 0) {
            cust.consignmentCrates = Math.max(0, cust.consignmentCrates - netCrates);
            cust.consignmentDepositDue = Math.max(0, cust.consignmentDepositDue - sale.depositNetTotal);
          }
          cust.updatedAt = now;
        }
        this.appendAudit(actor, 'ANNULATION_VENTE_EFFECTUEE', 'Sale', sale.id, sale.docNumber, beforeSale, { status: 'ANNULEE', approver: actor.name }, 'Web / API', false, sale.warehouseId);
      }
    } else if (req.type === 'CLOTURE_CAISSE') {
      const cs = this.db.cashSessions.find((c) => c.id === req.entityId);
      if (cs && cs.status === 'EN_ATTENTE_VALIDATION') {
        cs.status = 'CLOTUREE';
        cs.validatedBy = actor.id;
        const pv: ReconciliationPV = {
          id: `pv-${Date.now()}`,
          docNumber: this.nextDoc('PV'),
          warehouseId: cs.warehouseId,
          type: 'QUOTIDIENNE_CAISSE',
          periodLabel: `Clôture ${cs.docNumber}`,
          systemValue: cs.expectedCash,
          physicalOrExternalValue: cs.countedCash ?? cs.expectedCash,
          variance: cs.variance ?? 0,
          notes: decisionNote || cs.notes || 'Clôture validée.',
          preparedBy: cs.cashierName,
          signedBy: actor.name,
          signedRole: actor.role,
          signedAt: now,
        };
        this.db.reconciliations.unshift(pv);
      }
    } else if (req.type === 'AJUSTEMENT_CONSIGNE' || req.type === 'PERTE_CONSIGNE') {
      const cust = this.db.customers.find((c) => c.id === req.entityId);
      const meta = (req.metadata || {}) as { packagingId?: string; cratesQty?: number; reason?: string };
      if (cust && meta.cratesQty) {
        cust.consignmentCrates = Math.max(0, cust.consignmentCrates - meta.cratesQty);
        cust.consignmentDepositDue = Math.max(0, cust.consignmentDepositDue - req.amount);
        cust.updatedAt = now;
        this.db.consignments.unshift({
          id: `csg-${Date.now()}`,
          docNumber: req.docNumber,
          warehouseId: req.warehouseId || undefined,
          movementType: 'CASSE_CONSIGNE',
          customerId: cust.id,
          supplierId: null,
          packagingId: meta.packagingId || 'pkg-bock-33',
          cratesOut: 0,
          cratesIn: meta.cratesQty,
          bottlesMissing: 0,
          depositAmount: req.amount,
          settlementMode: 'CAUTION_DUE',
          referenceDoc: `${req.type} (${meta.reason || ''})`,
          createdBy: actor.id,
          createdAt: now,
        });
      }
    } else if (req.type === 'REMBOURSEMENT_CAUTION') {
      const meta = (req.metadata || {}) as Parameters<DepotStore['recordConsignmentReturn']>[1];
      this.recordConsignmentReturn(actor, meta);
    } else if (req.type === 'RETOUR_CASSE_LIVREUR') {
      const rb = this.db.returnsBreakages.find((r) => r.id === req.entityId);
      if (rb && rb.status === 'EN_ATTENTE') {
        rb.status = 'VALIDE';
        rb.validatedBy = actor.id;
        if (rb.type === 'CASSE_COULAGE' && rb.qtyPacks > 0) {
          const stk = this.db.stocks.find(
            (s) => s.warehouseId === (rb.warehouseId || req.warehouseId) && s.packagingId === rb.packagingId
          );
          if (stk) {
            stk.qtyOnHand = Math.max(0, stk.qtyOnHand - rb.qtyPacks);
            stk.updatedAt = now;
          }
        }
      }
    }

    this.appendAudit(actor, `VALIDATION_${decision}`, 'ApprovalRequest', req.id, req.docNumber, { status: 'EN_ATTENTE' }, req, 'Web / API', false, req.warehouseId || null);
    this.save();
    return req;
  }

  // 14. Push Notifications Subscriptions
  public subscribePush(
    actor: UserAccount,
    input: { endpoint: string; p256dh: string; auth: string }
  ): PushSubscriptionRecord {
    const now = new Date().toISOString();
    // Supprimer un ancien abonnement pour ce même utilisateur/endpoint s'il existe
    this.db.pushSubscriptions = this.db.pushSubscriptions.filter(
      (s) => s.userId === actor.id && s.endpoint !== input.endpoint
    );

    const sub: PushSubscriptionRecord = {
      id: `ps-${Date.now()}`,
      userId: actor.id,
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      createdAt: now,
      active: true,
    };
    this.db.pushSubscriptions.push(sub);
    this.appendAudit(
      actor,
      'ABONNEMENT_PUSH',
      'PushSubscription',
      sub.id,
      sub.endpoint,
      null,
      { userId: actor.id, active: true },
      'Web / API',
      false,
      actor.warehouseId ?? null
    );
    this.save();
    return sub;
  }

  public unsubscribePush(actor: UserAccount, subscriptionId: string): { ok: boolean } {
    const idx = this.db.pushSubscriptions.findIndex((s) => s.id === subscriptionId);
    if (idx === -1) throw new GovernanceError('Abonnement push introuvable.', 404);
    const sub = this.db.pushSubscriptions[idx];
    if (sub.userId !== actor.id && actor.role !== 'PROPRIETAIRE') {
      throw new GovernanceError('Vous ne pouvez pas supprimer cet abonnement.', 403, 'RBAC_FORBIDDEN');
    }
    this.db.pushSubscriptions.splice(idx, 1);
    this.appendAudit(
      actor,
      'DESABONNEMENT_PUSH',
      'PushSubscription',
      subscriptionId,
      sub.endpoint,
      { active: true },
      { active: false },
      'Web / API',
      false,
      actor.warehouseId ?? null
    );
    this.save();
    return { ok: true };
  }

  public getPushSubscriptionsForUser(userId: string): PushSubscriptionRecord[] {
    return this.db.pushSubscriptions.filter((s) => s.userId === userId && s.active);
  }

  public getAllPushSubscriptions(): PushSubscriptionRecord[] {
    return this.db.pushSubscriptions.filter((s) => s.active);
  }

  // 15. Users & Settings
  public upsertUser(actor: UserAccount, input: Partial<UserAccount> & { id?: string }) {
    const now = new Date().toISOString();
    if (input.id) {
      this.requirePermission(actor, PERMISSIONS.USER_UPDATE);
      const u = this.db.users.find((x) => x.id === input.id && !x.deletedAt);
      if (!u) throw new GovernanceError('Utilisateur introuvable.', 404);
      const nextRole = (input.role || u.role) as RoleCode;
      const nextWh = nextRole === 'PROPRIETAIRE' ? null : (input.warehouseId ?? u.warehouseId);
      if (nextRole !== 'PROPRIETAIRE' && !nextWh) {
        throw new GovernanceError('Un dépôt est obligatoire pour les profils Gérant et Livreur.', 400);
      }
      const before = { ...u, pin: '***' };
      Object.assign(u, input, { role: nextRole, warehouseId: nextWh, updatedAt: now });
      this.appendAudit(actor, 'MODIFICATION_UTILISATEUR', 'UserAccount', u.id, u.email, before, { ...u, pin: '***' }, 'Web / API', false, u.warehouseId);
      this.save();
      return u;
    }

    this.requirePermission(actor, PERMISSIONS.USER_CREATE);
    const role: RoleCode = (input.role as RoleCode) || 'LIVREUR';
    const warehouseId = role === 'PROPRIETAIRE' ? null : (input.warehouseId || null);
    if (role !== 'PROPRIETAIRE' && !warehouseId) {
      throw new GovernanceError('Un dépôt d’affectation est obligatoire pour créer un Gérant ou un Livreur.', 400);
    }

    const created: UserAccount = {
      id: `usr-${Date.now()}`,
      name: input.name || 'Nouvel Utilisateur',
      email: input.email || 'user@gestdepot.ci',
      phone: input.phone || '+225 07 00 00 00 00',
      role,
      pin: input.pin || '1234',
      active: true,
      warehouseId,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    this.db.users.push(created);
    this.appendAudit(actor, 'CREATION_UTILISATEUR', 'UserAccount', created.id, created.email, null, { ...created, pin: '***' }, 'Web / API', false, created.warehouseId);
    this.save();
    return created;
  }

  public updateCompanySettings(actor: UserAccount, patch: Partial<CompanySettings>) {
    this.requirePermission(actor, PERMISSIONS.SETTINGS_UPDATE);
    const before = { ...this.db.company };
    this.db.company = { ...this.db.company, ...patch };
    this.appendAudit(actor, 'MODIFICATION_PARAMETRES', 'CompanySettings', 'company', this.db.company.nccNumber, before, this.db.company, 'Web / API', false, null);
    this.save();
    return this.db.company;
  }

  // 15. Authentification & Inscription
  public authenticateUser(identifier: string, secret: string): UserAccount {
    const cleanId = (identifier || '').trim().toLowerCase();
    const digitsOnly = cleanId.replace(/\D/g, '');
    const cleanSecret = (secret || '').trim();
    if (!cleanId || !cleanSecret) {
      throw new GovernanceError('Identifiant et code PIN / mot de passe requis.', 400, 'AUTH_MISSING_FIELDS');
    }

    const user = this.db.users.find((u) => {
      if (u.deletedAt || !u.active) return false;
      const emailMatch = u.email.toLowerCase() === cleanId;
      const phoneDigits = u.phone.replace(/\D/g, '');
      const phoneMatch = digitsOnly.length >= 6 && phoneDigits.endsWith(digitsOnly);
      return emailMatch || phoneMatch;
    });

    if (!user || user.pin !== cleanSecret) {
      throw new GovernanceError('Email/téléphone ou code PIN incorrect.', 401, 'AUTH_INVALID_CREDENTIALS');
    }

    this.appendAudit(
      user,
      'CONNEXION_UTILISATEUR',
      'UserAccount',
      user.id,
      user.email,
      null,
      { role: user.role, warehouseId: user.warehouseId },
      'Web Auth',
      false,
      user.warehouseId
    );
    this.save();
    return user;
  }

  public registerUser(input: {
    name: string;
    email: string;
    phone: string;
    pin: string;
    role: RoleCode;
    warehouseId?: string | null;
  }): UserAccount {
    const name = (input.name || '').trim();
    const email = (input.email || '').trim().toLowerCase();
    const phone = (input.phone || '').trim();
    const pin = (input.pin || '').trim();
    const role: RoleCode = VALID_ROLES.includes(input.role) ? input.role : 'LIVREUR';

    if (name.length < 2) {
      throw new GovernanceError('Veuillez saisir votre nom complet.', 400, 'VALIDATION_ERROR');
    }
    if (!email.includes('@') || email.length < 5) {
      throw new GovernanceError('Adresse email professionnelle invalide.', 400, 'VALIDATION_ERROR');
    }
    if (phone.length < 6) {
      throw new GovernanceError('Numéro de téléphone invalide.', 400, 'VALIDATION_ERROR');
    }
    if (pin.length < 4) {
      throw new GovernanceError('Le code PIN / mot de passe doit contenir au moins 4 caractères.', 400, 'VALIDATION_ERROR');
    }

    const exists = this.db.users.some((u) => !u.deletedAt && u.email.toLowerCase() === email);
    if (exists) {
      throw new GovernanceError('Un compte existe déjà avec cette adresse email.', 409, 'EMAIL_EXISTS');
    }

    let warehouseId: string | null = null;
    if (role !== 'PROPRIETAIRE') {
      const requestedWh = input.warehouseId || '';
      const validWh = this.db.warehouses.find((w) => w.id === requestedWh && !w.deletedAt && w.active);
      if (!validWh) {
        throw new GovernanceError(
          'Veuillez sélectionner un dépôt actif pour un compte Gérant ou Livreur.',
          400,
          'WAREHOUSE_REQUIRED'
        );
      }
      warehouseId = validWh.id;
    }

    const now = new Date().toISOString();
    const created: UserAccount = {
      id: `usr-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      name,
      email,
      phone,
      role,
      pin,
      active: true,
      warehouseId,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    this.db.users.push(created);
    this.appendAudit(
      created,
      'INSCRIPTION_UTILISATEUR',
      'UserAccount',
      created.id,
      created.email,
      null,
      { name: created.name, role: created.role, warehouseId: created.warehouseId },
      'Web Auth',
      false,
      created.warehouseId
    );
    this.save();
    return created;
  }
}

export const depotStore = new DepotStore();
