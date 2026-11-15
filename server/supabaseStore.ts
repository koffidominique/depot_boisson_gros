/**
 * supabaseStore.ts — Couche de données GestDepot basée sur Supabase.
 * Remplace DepotStore (fichier JSON local) par des appels SQL via Supabase.
 *
 * Toutes les méthodes retournent des données dans le même format que DepotStore
 * pour minimiser les changements dans server.ts et ErpContext.tsx.
 */

import { supabaseAdmin, isSupabaseAdminConfigured } from '../src/lib/supabaseServer';
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
  DeliveryStop,
  DepotDatabaseSnapshot,
  GoodsReceipt,
  GoodsReceiptLine,
  InventoryLine,
  InventorySession,
  Packaging,
  PaymentMethod,
  PermissionKey,
  TreasuryWallet,
  Product,
  ProductStock,
  PurchaseOrder,
  ReconciliationPV,
  ReturnBreakageRecord,
  RoleCode,
  Sale,
  Supplier,
  TreasuryTransaction,
  UserAccount,
  Warehouse,
  PushSubscriptionRecord,
} from '../src/types/erp.ts';
import { PERMISSIONS, RBAC_MATRIX } from '../src/types/erp.ts';
import { GovernanceError } from './store.ts';

const VALID_ROLES: RoleCode[] = ['PROPRIETAIRE', 'GERANT', 'LIVREUR'];

export class GovernanceErrorSupabase extends GovernanceError {
  status: number;
  code: string;
  constructor(message: string, status = 403, code = 'GOVERNANCE_ERROR') {
    super(message, status, code);
    this.status = status;
    this.code = code;
  }
}

// Cache des délégations en mémoire (à remplacer par une requête Supabase si besoin)
let fullDelegations: Delegation[] = [];

/**
 * DepotStoreSupabase — même interface que DepotStore, mais stockage dans Supabase.
 */
export class DepotStoreSupabase {
  private requireAdmin(): void {
    if (!isSupabaseAdminConfigured()) {
      throw new GovernanceErrorSupabase(
        'Supabase non configuré côté serveur.',
        500,
        'SUPABASE_NOT_CONFIGURED'
      );
    }
  }

  // ------------------------------------------------------------------
  // Helpers de conversion snake_case <-> camelCase
  // ------------------------------------------------------------------

  private static toCamel<T>(row: Record<string, unknown>): T {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      const camelKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      result[camelKey] = value;
    }
    return result as T;
  }

  // ------------------------------------------------------------------
  // Authentification
  // ------------------------------------------------------------------

  public async authenticateUser(
    identifier: string,
    secret: string
  ): Promise<UserAccount> {
    this.requireAdmin();
    const cleanId = (identifier || '').trim().toLowerCase();
    const digitsOnly = cleanId.replace(/\D/g, '');
    const cleanSecret = (secret || '').trim();

    if (!cleanId || !cleanSecret) {
      throw new GovernanceErrorSupabase(
        'Identifiant et code PIN / mot de passe requis.',
        400,
        'AUTH_MISSING_FIELDS'
      );
    }

    const { data, error } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('active', true)
      .is('deleted_at', null);

    if (error) throw new GovernanceErrorSupabase(error.message, 500, 'DB_ERROR');

    const user = (data || [])
      .map((u) => DepotStoreSupabase.toCamel<UserAccount>(u as unknown as Record<string, unknown>))
      .find((u) => {
        const emailMatch = u.email.toLowerCase() === cleanId;
        const phoneDigits = (u.phone || '').replace(/\D/g, '');
        const phoneMatch =
          digitsOnly.length >= 6 && phoneDigits.endsWith(digitsOnly);
        return emailMatch || phoneMatch;
      });

    if (!user || user.pin !== cleanSecret) {
      throw new GovernanceErrorSupabase(
        'Email/téléphone ou code PIN incorrect.',
        401,
        'AUTH_INVALID_CREDENTIALS'
      );
    }

    await this.appendAudit(
      user,
      'CONNEXION_UTILISATEUR',
      'UserAccount',
      user.id,
      user.email,
      null,
      { role: user.role, warehouseId: user.warehouseId },
      'Web Auth',
      false,
      user.warehouseId ?? null
    );

    return user;
  }

  public async registerUser(input: {
    name: string;
    email: string;
    phone: string;
    pin: string;
    role: RoleCode;
    warehouseId?: string | null;
  }): Promise<UserAccount> {
    this.requireAdmin();
    const name = (input.name || '').trim();
    const email = (input.email || '').trim().toLowerCase();
    const phone = (input.phone || '').trim();
    const pin = (input.pin || '').trim();
    const role: RoleCode =
      VALID_ROLES.includes(input.role) ? input.role : 'LIVREUR';

    if (name.length < 2) {
      throw new GovernanceErrorSupabase(
        'Veuillez saisir votre nom complet.',
        400,
        'VALIDATION_ERROR'
      );
    }
    if (!email.includes('@') || email.length < 5) {
      throw new GovernanceErrorSupabase(
        'Adresse email professionnelle invalide.',
        400,
        'VALIDATION_ERROR'
      );
    }
    if (phone.length < 6) {
      throw new GovernanceErrorSupabase(
        'Numéro de téléphone invalide.',
        400,
        'VALIDATION_ERROR'
      );
    }
    if (pin.length < 4) {
      throw new GovernanceErrorSupabase(
        'Le code PIN / mot de passe doit contenir au moins 4 caractères.',
        400,
        'VALIDATION_ERROR'
      );
    }

    const { data: existing } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('email', email)
      .is('deleted_at', null);

    if (existing && existing.length > 0) {
      throw new GovernanceErrorSupabase(
        'Un compte existe déjà avec cette adresse email.',
        409,
        'EMAIL_EXISTS'
      );
    }

    let warehouseId: string | null = null;
    if (role !== 'PROPRIETAIRE') {
      const requestedWh = input.warehouseId || '';
      const { data: validWh } = await supabaseAdmin
        .from('warehouses')
        .select('id')
        .eq('id', requestedWh)
        .eq('active', true)
        .is('deleted_at', null)
        .maybeSingle();

      if (!validWh) {
        throw new GovernanceErrorSupabase(
          'Veuillez sélectionner un dépôt actif pour un compte Gérant ou Livreur.',
          400,
          'WAREHOUSE_REQUIRED'
        );
      }
      warehouseId = (validWh as Warehouse).id;
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

    const { error } = await supabaseAdmin.from('users').insert([
      {
        id: created.id,
        name: created.name,
        email: created.email,
        phone: created.phone,
        role: created.role,
        pin: created.pin,
        active: created.active,
        warehouse_id: created.warehouseId,
        created_at: created.createdAt,
        updated_at: created.updatedAt,
        deleted_at: created.deletedAt,
      },
    ]);

    if (error) throw new GovernanceErrorSupabase(error.message, 500, 'DB_ERROR');

    await this.appendAudit(
      created,
      'INSCRIPTION_UTILISATEUR',
      'UserAccount',
      created.id,
      created.email,
      null,
      { name: created.name, role: created.role, warehouseId: created.warehouseId },
      'Web Auth',
      false,
      created.warehouseId ?? null
    );

    return created;
  }

  public async getUserById(userId: string): Promise<UserAccount> {
    this.requireAdmin();
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', userId)
      .eq('active', true)
      .is('deleted_at', null)
      .maybeSingle();

    if (error) throw new GovernanceErrorSupabase(error.message, 500, 'DB_ERROR');
    if (!data) {
      throw new GovernanceErrorSupabase(
        'Utilisateur actif introuvable.',
        401,
        'UNAUTHORIZED'
      );
    }

    return DepotStoreSupabase.toCamel<UserAccount>(data as unknown as Record<string, unknown>);
  }

  // ------------------------------------------------------------------
  // Snapshot (lecture complète des données, scopée par rôle)
  // ------------------------------------------------------------------

  public async getSnapshot(): Promise<DepotDatabaseSnapshot> {
    this.requireAdmin();
    const tables: (keyof DepotDatabaseSnapshot)[] = [
      'company', 'users', 'warehouses', 'delegations', 'suppliers', 'customers',
      'products', 'packagings', 'stocks', 'purchaseOrders', 'goodsReceipts',
      'sales', 'cashSessions', 'deliveryRoutes', 'consignments', 'credits',
      'creditPayments', 'returnsBreakages', 'treasury', 'inventories',
      'reconciliations', 'approvals', 'auditLogs', 'pushSubscriptions',
      'processedClientUuids', 'counters',
    ];

    const rawSnapshot: Record<string, unknown> = {};

    for (const table of tables) {
      const { data, error } = await supabaseAdmin.from(table as string).select('*');
      if (error) {
        rawSnapshot[table] = [];
        continue;
      }
      rawSnapshot[table] = (data || []).map((row) =>
        DepotStoreSupabase.toCamel(row as Record<string, unknown>)
      );
    }

    // company est une seule ligne, pas un tableau
    const companyRows = rawSnapshot.company as unknown[] | undefined;
    const company: CompanySettings = (companyRows?.[0] as CompanySettings) || {
      companyName: 'GestDepot',
      nccNumber: '',
      taxRegime: '',
      tvaRatePercent: 18,
      currency: 'XOF',
      dailySalesTarget: 1500000,
      autoValidateSaleThreshold: 200000,
      cashVarianceAlertThreshold: 2000,
      consignmentOverdueDays: 14,
      highDepositRefundThreshold: 50000,
      maxCashierDiscountPercent: 5,
      mobileMoneyProviders: {
        orangeMoneyMerchant: '',
        mtnMomoMerchant: '',
        waveMerchant: '',
        moovMerchant: '',
      },
    };

    // counters est un Record<string, number>, pas un tableau
    const countersRows = rawSnapshot.counters as unknown[] | undefined;
    const counters: Record<string, number> = {};
    (countersRows || []).forEach((row) => {
      const r = row as Record<string, unknown>;
      counters[r.prefix as string] = Number(r.value);
    });

    return {
      company,
      users: (rawSnapshot.users || []) as UserAccount[],
      warehouses: (rawSnapshot.warehouses || []) as Warehouse[],
      delegations: (rawSnapshot.delegations || []) as Delegation[],
      suppliers: (rawSnapshot.suppliers || []) as Supplier[],
      customers: (rawSnapshot.customers || []) as Customer[],
      products: (rawSnapshot.products || []) as Product[],
      packagings: (rawSnapshot.packagings || []) as Packaging[],
      stocks: (rawSnapshot.stocks || []) as ProductStock[],
      purchaseOrders: (rawSnapshot.purchaseOrders || []) as PurchaseOrder[],
      goodsReceipts: (rawSnapshot.goodsReceipts || []) as GoodsReceipt[],
      sales: (rawSnapshot.sales || []) as Sale[],
      cashSessions: (rawSnapshot.cashSessions || []) as CashSession[],
      deliveryRoutes: (rawSnapshot.deliveryRoutes || []) as DeliveryRoute[],
      consignments: (rawSnapshot.consignments || []) as ConsignmentMovement[],
      credits: (rawSnapshot.credits || []) as CreditRecord[],
      creditPayments: (rawSnapshot.creditPayments || []) as CreditPayment[],
      returnsBreakages: (rawSnapshot.returnsBreakages || []) as ReturnBreakageRecord[],
      treasury: (rawSnapshot.treasury || []) as TreasuryTransaction[],
      inventories: (rawSnapshot.inventories || []) as InventorySession[],
      reconciliations: (rawSnapshot.reconciliations || []) as ReconciliationPV[],
      approvals: (rawSnapshot.approvals || []) as ApprovalRequest[],
      auditLogs: (rawSnapshot.auditLogs || []) as AuditLog[],
      pushSubscriptions: (rawSnapshot.pushSubscriptions || []) as PushSubscriptionRecord[],
      processedClientUuids: (rawSnapshot.processedClientUuids || []) as string[],
      counters,
    } as DepotDatabaseSnapshot;
  }

  public async getScopedSnapshot(actor: UserAccount): Promise<DepotDatabaseSnapshot> {
    const full = await this.getSnapshot();

    if (actor.role === 'PROPRIETAIRE') {
      return this.maskPins(full, actor.id);
    }

    if (actor.role === 'GERANT') {
      const whId = actor.warehouseId;
      const scoped: DepotDatabaseSnapshot = {
        ...full,
        users: full.users.map((u) => ({
          ...u,
          pin: u.id === actor.id ? u.pin : '****',
        })),
        delegations: full.delegations.filter((d) => d.toUserId === actor.id),
        stocks: full.stocks.filter((s) => s.warehouseId === whId),
        purchaseOrders: full.purchaseOrders.filter((p) => p.warehouseId === whId),
        goodsReceipts: full.goodsReceipts.filter((g) => g.warehouseId === whId),
        sales: full.sales.filter((s) => s.warehouseId === whId),
        cashSessions: full.cashSessions.filter((c) => c.warehouseId === whId),
        deliveryRoutes: full.deliveryRoutes.filter((r) => r.warehouseId === whId),
        consignments: full.consignments.filter(
          (m) => !m.warehouseId || m.warehouseId === whId
        ),
        credits: full.credits.filter((c) => !c.warehouseId || c.warehouseId === whId),
        returnsBreakages: full.returnsBreakages.filter(
          (r) => !r.warehouseId || r.warehouseId === whId
        ),
        treasury: full.treasury.filter((t) => !t.warehouseId || t.warehouseId === whId),
        inventories: full.inventories.filter((i) => i.warehouseId === whId),
        reconciliations: full.reconciliations.filter(
          (p) => !p.warehouseId || p.warehouseId === whId
        ),
        approvals: full.approvals.filter(
          (a) => !a.warehouseId || a.warehouseId === whId
        ),
        auditLogs: full.auditLogs.filter(
          (l) => l.warehouseId === whId || l.userId === actor.id
        ),
        pushSubscriptions: [],
        counters: full.counters,
        processedClientUuids: full.processedClientUuids,
      };
      return scoped;
    }

    // LIVREUR : isolé sur ses propres tournées
    const ownRoutes = full.deliveryRoutes.filter(
      (r) => r.driverId === actor.id && r.warehouseId === actor.warehouseId
    );
    const ownSaleIds = new Set(
      ownRoutes.flatMap((r) => (r.stops as any[]).map((s) => s.saleId))
    );
    const ownCustomerIds = new Set(
      ownRoutes.flatMap((r) => (r.stops as any[]).map((s) => s.customerId))
    );

    return {
      ...full,
      users: [{ ...actor, pin: '****' }],
      warehouses: full.warehouses.filter((w) => w.id === actor.warehouseId),
      delegations: [],
      suppliers: [],
      customers: full.customers
        .filter((c) => ownCustomerIds.has(c.id))
        .map((c) => ({
          ...c,
          creditLimit: 0,
          creditBalance: 0,
        })),
      packagings: full.packagings.map((p) => ({ ...p, purchasePrice: 0 })),
      stocks: full.stocks.filter((s) => s.warehouseId === actor.warehouseId),
      purchaseOrders: [],
      goodsReceipts: [],
      sales: full.sales.filter((s) => ownSaleIds.has(s.id)),
      cashSessions: [],
      deliveryRoutes: ownRoutes,
      consignments: [],
      credits: [],
      creditPayments: [],
      returnsBreakages: full.returnsBreakages.filter(
        (rb) => rb.createdBy === actor.id
      ),
      treasury: [],
      inventories: [],
      reconciliations: [],
      approvals: [],
      auditLogs: full.auditLogs.filter((l) => l.userId === actor.id),
      pushSubscriptions: [],
      counters: full.counters,
      processedClientUuids: [],
    };
  }

  private maskPins(
    snapshot: DepotDatabaseSnapshot,
    actorId: string
  ): DepotDatabaseSnapshot {
    return {
      ...snapshot,
      users: snapshot.users.map((u) => ({
        ...u,
        pin: u.id === actorId ? u.pin : '****',
      })),
    };
  }

  // ------------------------------------------------------------------
  // RBAC / Permissions
  // ------------------------------------------------------------------

  public async getEffectivePermissions(user: UserAccount): Promise<PermissionKey[]> {
    const native = RBAC_MATRIX[user.role] || [];
    const delegated = (await this.getActiveDelegationsForUser(user)).map(
      (d) => d.permissionCode
    );
    return Array.from(new Set([...native, ...delegated]));
  }

  public async hasPermission(user: UserAccount, permission: PermissionKey): Promise<boolean> {
    const perms = await this.getEffectivePermissions(user);
    return perms.includes(permission);
  }

  public async requirePermission(user: UserAccount, permission: PermissionKey): Promise<void> {
    const has = await this.hasPermission(user, permission);
    if (!has) {
      throw new GovernanceErrorSupabase(
        `Accès refusé (${user.role}) : le profil "${user.name}" ne dispose pas de la permission "${permission}".`,
        403,
        'RBAC_FORBIDDEN'
      );
    }
  }

  public async getActiveDelegationsForUser(user: UserAccount): Promise<Delegation[]> {
    const now = Date.now();
    return fullDelegations.filter(
      (d) =>
        d.toUserId === user.id &&
        !d.revokedAt &&
        new Date(d.startsAt).getTime() <= now &&
        new Date(d.endsAt).getTime() >= now &&
        (!d.warehouseId || !user.warehouseId || d.warehouseId === user.warehouseId)
    );
  }

  // ------------------------------------------------------------------
  // Audit (chaîne SHA-256)
  // ------------------------------------------------------------------

  private async appendAudit(
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
  ): Promise<void> {
    this.requireAdmin();
    const now = new Date().toISOString();

    // Récupérer le dernier hash pour le chaînage
    const { data: lastLog } = await supabaseAdmin
      .from('audit_logs')
      .select('hash, id')
      .order('timestamp', { ascending: false })
      .limit(1)
      .maybeSingle();

    const prevHash = lastLog?.hash || 'GENESIS_GESTDEPOT_2026';

    const safeBefore =
      before === undefined || before === null ? null : JSON.parse(JSON.stringify(before));
    const safeAfter =
      after === undefined || after === null ? null : JSON.parse(JSON.stringify(after));

    const id = `aud-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    // Calcul du hash SHA-256
    const crypto = await import('crypto');
    const payload = JSON.stringify({
      prevHash,
      timestamp: now,
      userId: user.id,
      action,
      entityType,
      entityId,
      documentNumber,
      before: safeBefore,
      after: safeAfter,
    });
    const hash = crypto.createHash('sha256').update(payload).digest('hex');

    const entry: AuditLog = {
      id,
      timestamp: now,
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
      prevHash,
      hash,
    };

    const { error } = await supabaseAdmin.from('audit_logs').insert([
      {
        id: entry.id,
        timestamp: entry.timestamp,
        user_id: entry.userId,
        user_name: entry.userName,
        user_role: entry.userRole,
        warehouse_id: entry.warehouseId,
        action: entry.action,
        entity_type: entry.entityType,
        entity_id: entry.entityId,
        document_number: entry.documentNumber,
        before: entry.before,
        after: entry.after,
        device_info: entry.deviceInfo,
        offline_originated: entry.offlineOriginated,
        prev_hash: entry.prevHash,
        hash: entry.hash,
      },
    ]);

    if (error) throw new GovernanceErrorSupabase(error.message, 500, 'DB_ERROR');
  }

  public async verifyAuditChain(): Promise<{
    valid: boolean;
    checkedCount: number;
    message: string;
  }> {
    this.requireAdmin();
    const { data: logs } = await supabaseAdmin
      .from('audit_logs')
      .select('*')
      .order('timestamp', { ascending: true });

    const chronological = (logs || []) as AuditLog[];
    let expectedPrev = 'GENESIS_GESTDEPOT_2026';
    let checked = 0;
    const crypto = await import('crypto');

    for (const log of chronological) {
      if (!log.hash) {
        expectedPrev = log.id;
        continue;
      }
      if (log.prevHash !== expectedPrev) {
        return {
          valid: false,
          checkedCount: checked,
          message: `Rupture de chaîne SHA-256 détectée sur l'entrée ${log.documentNumber} (${log.id}).`,
        };
      }
      const recomputed = crypto
        .createHash('sha256')
        .update(
          JSON.stringify({
            prevHash: expectedPrev,
            timestamp: log.timestamp,
            userId: log.userId,
            action: log.action,
            entityType: log.entityType,
            entityId: log.entityId,
            documentNumber: log.documentNumber,
            before: log.before,
            after: log.after,
          })
        )
        .digest('hex');
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

  // ------------------------------------------------------------------
  // 0. Warehouses (Propriétaire only)
  // ------------------------------------------------------------------

  public async createWarehouse(
    actor: UserAccount,
    input: { name: string; zone: string; address: string }
  ): Promise<Warehouse> {
    this.requireAdmin();
    await this.requirePermission(actor, PERMISSIONS.WAREHOUSE_MANAGE);

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

    const { error } = await supabaseAdmin.from('warehouses').insert([
      {
        id: wh.id,
        name: wh.name,
        zone: wh.zone,
        address: wh.address,
        active: wh.active,
        is_default: wh.isDefault,
        created_at: wh.createdAt,
        updated_at: wh.updatedAt,
        deleted_at: wh.deletedAt,
      },
    ]);
    if (error) throw new GovernanceErrorSupabase(error.message, 500, 'DB_ERROR');

    // Initialiser les lignes de stock à zéro pour tous les conditionnements actifs
    const { data: packagings } = await supabaseAdmin
      .from('packagings')
      .select('id')
      .is('deleted_at', null);
    if (packagings && packagings.length > 0) {
      const stockRows = packagings.map((p) => ({
        id: `stk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        warehouse_id: wh.id,
        packaging_id: (p as Record<string, unknown>).id as string,
        qty_on_hand: 0,
        qty_reserved: 0,
        empty_crates_on_hand: 0,
        next_dlc: null,
        lot_number: `LOT-${wh.id.slice(-4).toUpperCase()}`,
        updated_at: now,
      }));
      await supabaseAdmin.from('stocks').insert(stockRows);
    }

    await this.appendAudit(
      actor,
      'CREATION_DEPOT',
      'Warehouse',
      wh.id,
      wh.name,
      null,
      wh,
      'Web / API',
      false,
      wh.id
    );

    return wh;
  }

  public async toggleWarehouseStatus(
    actor: UserAccount,
    warehouseId: string
  ): Promise<Warehouse> {
    this.requireAdmin();
    await this.requirePermission(actor, PERMISSIONS.WAREHOUSE_MANAGE);

    const { data: wh, error } = await supabaseAdmin
      .from('warehouses')
      .select('*')
      .eq('id', warehouseId)
      .is('deleted_at', null)
      .maybeSingle();

    if (error) throw new GovernanceErrorSupabase(error.message, 500, 'DB_ERROR');
    if (!wh) throw new GovernanceErrorSupabase('Dépôt introuvable.', 404);

    const warehouse = DepotStoreSupabase.toCamel<Warehouse>(
      wh as unknown as Record<string, unknown>
    );

    if (warehouse.isDefault && warehouse.active) {
      throw new GovernanceErrorSupabase(
        'Le dépôt principal par défaut ne peut pas être désactivé.',
        400
      );
    }

    const now = new Date().toISOString();
    const before = { active: warehouse.active };
    const newActive = !warehouse.active;

    const { error: updErr } = await supabaseAdmin
      .from('warehouses')
      .update({ active: newActive, updated_at: now })
      .eq('id', warehouseId);

    if (updErr) throw new GovernanceErrorSupabase(updErr.message, 500, 'DB_ERROR');

    await this.appendAudit(
      actor,
      newActive ? 'REACTIVATION_DEPOT' : 'DESACTIVATION_DEPOT',
      'Warehouse',
      warehouse.id,
      warehouse.name,
      before,
      { active: newActive },
      'Web / API',
      false,
      warehouse.id
    );

    return { ...warehouse, active: newActive, updatedAt: now };
  }

  // ------------------------------------------------------------------
  // 0b. Temporary Delegations (Propriétaire -> Gérant)
  // ------------------------------------------------------------------

  public async createDelegation(
    actor: UserAccount,
    input: {
      toUserId: string;
      permissionCode: PermissionKey;
      warehouseId?: string | null;
      startsAt?: string;
      endsAt: string;
      reason: string;
    }
  ): Promise<Delegation> {
    this.requireAdmin();
    await this.requirePermission(actor, PERMISSIONS.DELEGATION_MANAGE);

    const { data: target } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', input.toUserId)
      .eq('active', true)
      .is('deleted_at', null)
      .maybeSingle();

    if (!target) throw new GovernanceErrorSupabase('Bénéficiaire introuvable.', 404);
    const targetUser = DepotStoreSupabase.toCamel<UserAccount>(
      target as unknown as Record<string, unknown>
    );

    if (targetUser.role !== 'GERANT') {
      throw new GovernanceErrorSupabase(
        'Les délégations temporaires ne peuvent être accordées qu’à un Gérant de dépôt.',
        400,
        'INVALID_DELEGATION_TARGET'
      );
    }
    if (!input.reason?.trim()) {
      throw new GovernanceErrorSupabase(
        'Un motif de délégation est obligatoire.',
        400
      );
    }

    const startsAt = input.startsAt || new Date().toISOString();
    const endsAt = input.endsAt;
    if (new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
      throw new GovernanceErrorSupabase(
        'La date de fin de délégation doit être postérieure au début.',
        400
      );
    }

    const del: Delegation = {
      id: `del-${Date.now()}`,
      fromUserId: actor.id,
      fromUserName: actor.name,
      toUserId: targetUser.id,
      toUserName: targetUser.name,
      permissionCode: input.permissionCode,
      warehouseId: input.warehouseId ?? targetUser.warehouseId,
      startsAt,
      endsAt,
      reason: input.reason.trim(),
      revokedAt: null,
      createdAt: new Date().toISOString(),
    };

    const { error } = await supabaseAdmin.from('delegations').insert([
      {
        id: del.id,
        from_user_id: del.fromUserId,
        from_user_name: del.fromUserName,
        to_user_id: del.toUserId,
        to_user_name: del.toUserName,
        permission_code: del.permissionCode,
        warehouse_id: del.warehouseId,
        starts_at: del.startsAt,
        ends_at: del.endsAt,
        reason: del.reason,
        revoked_at: del.revokedAt,
        created_at: del.createdAt,
      },
    ]);
    if (error) throw new GovernanceErrorSupabase(error.message, 500, 'DB_ERROR');

    fullDelegations.push(del);

    await this.appendAudit(
      actor,
      'CREATION_DELEGATION',
      'Delegation',
      del.id,
      del.permissionCode,
      null,
      del,
      'Web / API',
      false,
      del.warehouseId ?? null
    );

    return del;
  }

  public async revokeDelegation(
    actor: UserAccount,
    delegationId: string
  ): Promise<Delegation> {
    this.requireAdmin();
    await this.requirePermission(actor, PERMISSIONS.DELEGATION_MANAGE);

    const del = fullDelegations.find((d) => d.id === delegationId);
    if (!del) throw new GovernanceErrorSupabase('Délégation introuvable.', 404);
    if (del.revokedAt) return del;

    const now = new Date().toISOString();
    del.revokedAt = now;

    const { error } = await supabaseAdmin
      .from('delegations')
      .update({ revoked_at: now })
      .eq('id', delegationId);
    if (error) throw new GovernanceErrorSupabase(error.message, 500, 'DB_ERROR');

    await this.appendAudit(
      actor,
      'REVOCATION_DELEGATION',
      'Delegation',
      del.id,
      del.permissionCode,
      { revokedAt: null },
      { revokedAt: del.revokedAt },
      'Web / API',
      false,
      del.warehouseId ?? null
    );

    return del;
  }

  // ------------------------------------------------------------------
  // 1. Products & Packagings
  // ------------------------------------------------------------------

  public async createProductWithPackaging(
    actor: UserAccount,
    input: {
      name: string;
      brand: string;
      supplierId: string;
      category: Product['category'];
      volumeLabel: string;
      packaging: Omit<
        Packaging,
        'id' | 'productId' | 'createdAt' | 'updatedAt' | 'deletedAt'
      >;
      initialQty: number;
      warehouseId: string;
    }
  ): Promise<{ product: Product; packaging: Packaging }> {
    this.requireAdmin();
    await this.requirePermission(actor, PERMISSIONS.PRODUCT_CREATE);

    const targetWh = input.warehouseId;
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

    const { error: pErr } = await supabaseAdmin.from('products').insert([
      {
        id: product.id,
        name: product.name,
        brand: product.brand,
        supplier_id: product.supplierId,
        category: product.category,
        volume_label: product.volumeLabel,
        active: product.active,
        created_at: product.createdAt,
        updated_at: product.updatedAt,
        deleted_at: product.deletedAt,
      },
    ]);
    if (pErr) throw new GovernanceErrorSupabase(pErr.message, 500, 'DB_ERROR');

    const { error: pkErr } = await supabaseAdmin.from('packagings').insert([
      {
        id: pkg.id,
        product_id: pkg.productId,
        sku: pkg.sku,
        label: pkg.label,
        packaging_type: pkg.packagingType,
        units_per_pack: pkg.unitsPerPack,
        is_returnable: pkg.isReturnable,
        deposit_per_crate: pkg.depositPerCrate,
        deposit_per_bottle: pkg.depositPerBottle,
        purchase_price: pkg.purchasePrice,
        sale_price_detail: pkg.salePriceDetail,
        sale_price_semi_gros: pkg.salePriceSemiGros,
        sale_price_gros: pkg.salePriceGros,
        alert_threshold: pkg.alertThreshold,
        dlc_required: pkg.dlcRequired,
        created_at: pkg.createdAt,
        updated_at: pkg.updatedAt,
        deleted_at: pkg.deletedAt,
      },
    ]);
    if (pkErr) throw new GovernanceErrorSupabase(pkErr.message, 500, 'DB_ERROR');

    // Créer les lignes de stock pour chaque dépôt actif
    const { data: warehouses } = await supabaseAdmin
      .from('warehouses')
      .select('id')
      .eq('active', true)
      .is('deleted_at', null);

    const warehouseList = (warehouses || []) as Array<{ id: string }>;
    const stockRows = warehouseList.map((w) => ({
      id: `stk-${Date.now()}-${w.id.slice(-3)}`,
      warehouse_id: w.id,
      packaging_id: pkg.id,
      qty_on_hand: w.id === targetWh ? Math.max(0, Number(input.initialQty) || 0) : 0,
      qty_reserved: 0,
      empty_crates_on_hand: 0,
      next_dlc: null,
      lot_number: `LOT-${Date.now().toString().slice(-5)}`,
      updated_at: now,
    }));

    if (stockRows.length > 0) {
      const { error: sErr } = await supabaseAdmin.from('stocks').insert(stockRows);
      if (sErr) throw new GovernanceErrorSupabase(sErr.message, 500, 'DB_ERROR');
    }

    await this.appendAudit(
      actor,
      'CREATION_PRODUIT',
      'Product',
      product.id,
      pkg.sku,
      null,
      { product, pkg },
      'Web / API',
      false,
      targetWh
    );

    return { product, packaging: pkg };
  }

  public async updatePackaging(
    actor: UserAccount,
    packagingId: string,
    patch: Partial<Packaging>
  ): Promise<Packaging> {
    this.requireAdmin();

    const { data: pkgRow } = await supabaseAdmin
      .from('packagings')
      .select('*')
      .eq('id', packagingId)
      .is('deleted_at', null)
      .maybeSingle();

    if (!pkgRow) throw new GovernanceErrorSupabase('Conditionnement introuvable.', 404);
    const pkg = DepotStoreSupabase.toCamel<Packaging>(
      pkgRow as unknown as Record<string, unknown>
    );

    const priceFields: (keyof Packaging)[] = [
      'purchasePrice',
      'salePriceDetail',
      'salePriceSemiGros',
      'salePriceGros',
      'depositPerCrate',
      'depositPerBottle',
    ];
    const touchesPrice = priceFields.some(
      (field) =>
        patch[field] !== undefined &&
        Number(patch[field]) !== Number(pkg[field])
    );

    if (touchesPrice) {
      await this.requirePermission(actor, PERMISSIONS.PRICE_UPDATE);
    } else {
      await this.requirePermission(actor, PERMISSIONS.PRODUCT_UPDATE);
    }

    const now = new Date().toISOString();
    const before = { ...pkg };

    const updateData: Record<string, unknown> = { ...patch, updated_at: now };
    // Convertir camelCase -> snake_case pour Supabase
    const snakeUpdate: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(updateData)) {
      const snakeKey = key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
      snakeUpdate[snakeKey] = value;
    }

    const { error } = await supabaseAdmin
      .from('packagings')
      .update(snakeUpdate)
      .eq('id', packagingId);
    if (error) throw new GovernanceErrorSupabase(error.message, 500, 'DB_ERROR');

    const updated: Packaging = { ...pkg, ...patch, updatedAt: now };

    await this.appendAudit(
      actor,
      touchesPrice
        ? 'MODIFICATION_TARIF_CONDITIONNEMENT'
        : 'MODIFICATION_CONDITIONNEMENT',
      'Packaging',
      pkg.id,
      pkg.sku,
      before,
      updated,
      'Web / API',
      false,
      null
    );

    return updated;
  }

  public async softDeleteProduct(
    actor: UserAccount,
    productId: string
  ): Promise<{ ok: boolean }> {
    this.requireAdmin();
    await this.requirePermission(actor, PERMISSIONS.PRODUCT_UPDATE);

    const { data: prod } = await supabaseAdmin
      .from('products')
      .select('*')
      .eq('id', productId)
      .is('deleted_at', null)
      .maybeSingle();

    if (!prod) throw new GovernanceErrorSupabase('Produit introuvable.', 404);

    const product = DepotStoreSupabase.toCamel<Product>(
      prod as unknown as Record<string, unknown>
    );

    const now = new Date().toISOString();
    product.deletedAt = now;
    product.active = false;

    const { error: pErr } = await supabaseAdmin
      .from('products')
      .update({ active: false, deleted_at: now, updated_at: now })
      .eq('id', productId);
    if (pErr) throw new GovernanceErrorSupabase(pErr.message, 500, 'DB_ERROR');

    const { error: pkErr } = await supabaseAdmin
      .from('packagings')
      .update({ deleted_at: now, updated_at: now })
      .eq('product_id', productId);
    if (pkErr) throw new GovernanceErrorSupabase(pkErr.message, 500, 'DB_ERROR');

    await this.appendAudit(
      actor,
      'SUPPRESSION_LOGIQUE_PRODUIT',
      'Product',
      product.id,
      product.name,
      { active: true },
      { deletedAt: now },
      'Web / API',
      false,
      null
    );

    return { ok: true };
  }

  // ------------------------------------------------------------------
  // 2. Customers
  // ------------------------------------------------------------------

  public async upsertCustomer(
    actor: UserAccount,
    input: Partial<Customer> & { id?: string }
  ): Promise<Customer> {
    this.requireAdmin();
    const now = new Date().toISOString();

    if (input.id) {
      await this.requirePermission(actor, PERMISSIONS.CUSTOMER_UPDATE);
      const { data: cust } = await supabaseAdmin
        .from('customers')
        .select('*')
        .eq('id', input.id)
        .is('deleted_at', null)
        .maybeSingle();

      if (!cust) throw new GovernanceErrorSupabase('Client introuvable.', 404);

      const customer = DepotStoreSupabase.toCamel<Customer>(
        cust as unknown as Record<string, unknown>
      );

      if (
        input.creditLimit !== undefined &&
        Number(input.creditLimit) !== customer.creditLimit
      ) {
        await this.requirePermission(actor, PERMISSIONS.CREDIT_LIMIT_UPDATE);
      }

      const before = { ...customer };
      const updateData: Record<string, unknown> = { ...input, updated_at: now };
      const snakeUpdate: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(updateData)) {
        if (key === 'id') continue;
        const snakeKey = key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
        snakeUpdate[snakeKey] = value;
      }

      const { error } = await supabaseAdmin
        .from('customers')
        .update(snakeUpdate)
        .eq('id', input.id);
      if (error) throw new GovernanceErrorSupabase(error.message, 500, 'DB_ERROR');

      const updated: Customer = { ...customer, ...input, updatedAt: now };

      await this.appendAudit(
        actor,
        'MODIFICATION_CLIENT',
        'Customer',
        customer.id,
        customer.code,
        before,
        updated,
        'Web / API',
        false,
        actor.warehouseId ?? null
      );

      return updated;
    }

    await this.requirePermission(actor, PERMISSIONS.CUSTOMER_CREATE);

    const requestedLimit = Math.max(0, Number(input.creditLimit) || 0);
    if (requestedLimit > 0 && !(await this.hasPermission(actor, PERMISSIONS.CREDIT_LIMIT_UPDATE))) {
      throw new GovernanceErrorSupabase(
        'Seul le Propriétaire peut fixer un plafond crédit supérieur à 0 FCFA lors de la création.',
        403,
        'RBAC_FORBIDDEN'
      );
    }

    const { data: allCustomers } = await supabaseAdmin.from('customers').select('code');
    const nextNum = ((allCustomers || []) as Array<{ code: string }>).length + 1;
    const code = `CLI-${String(nextNum).padStart(3, '0')}`;

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

    const { error } = await supabaseAdmin.from('customers').insert([
      {
        id: created.id,
        code: created.code,
        name: created.name,
        category: created.category,
        pricing_tier: created.pricingTier,
        phone: created.phone,
        zone: created.zone,
        credit_limit: created.creditLimit,
        credit_balance: created.creditBalance,
        is_blocked: created.isBlocked,
        consignment_crates: created.consignmentCrates,
        consignment_bottles: created.consignmentBottles,
        consignment_deposit_due: created.consignmentDepositDue,
        last_crate_out_date: created.lastCrateOutDate,
        created_at: created.createdAt,
        updated_at: created.updatedAt,
        deleted_at: created.deletedAt,
      },
    ]);
    if (error) throw new GovernanceErrorSupabase(error.message, 500, 'DB_ERROR');

    await this.appendAudit(
      actor,
      'CREATION_CLIENT',
      'Customer',
      created.id,
      created.code,
      null,
      created,
      'Web / API',
      false,
      actor.warehouseId ?? null
    );

    return created;
  }

  public async updateCustomerCreditLimit(
    actor: UserAccount,
    customerId: string,
    creditLimit: number
  ): Promise<Customer> {
    this.requireAdmin();
    await this.requirePermission(actor, PERMISSIONS.CREDIT_LIMIT_UPDATE);

    const { data: cust } = await supabaseAdmin
      .from('customers')
      .select('*')
      .eq('id', customerId)
      .is('deleted_at', null)
      .maybeSingle();

    if (!cust) throw new GovernanceErrorSupabase('Client introuvable.', 404);
    const customer = DepotStoreSupabase.toCamel<Customer>(
      cust as unknown as Record<string, unknown>
    );

    const before = { creditLimit: customer.creditLimit };
    const newLimit = Math.max(0, Number(creditLimit) || 0);
    const now = new Date().toISOString();

    const { error } = await supabaseAdmin
      .from('customers')
      .update({ credit_limit: newLimit, updated_at: now })
      .eq('id', customerId);
    if (error) throw new GovernanceErrorSupabase(error.message, 500, 'DB_ERROR');

    await this.appendAudit(
      actor,
      'MODIFICATION_PLAFOND_CREDIT',
      'Customer',
      customer.id,
      customer.code,
      before,
      { creditLimit: newLimit },
      'Web / API',
      false,
      null
    );

    return { ...customer, creditLimit: newLimit, updatedAt: now };
  }

  public async softDeleteCustomer(
    actor: UserAccount,
    customerId: string
  ): Promise<{ ok: boolean }> {
    this.requireAdmin();
    await this.requirePermission(actor, PERMISSIONS.CUSTOMER_UPDATE);

    const { data: cust } = await supabaseAdmin
      .from('customers')
      .select('*')
      .eq('id', customerId)
      .is('deleted_at', null)
      .maybeSingle();

    if (!cust) throw new GovernanceErrorSupabase('Client introuvable.', 404);
    const customer = DepotStoreSupabase.toCamel<Customer>(
      cust as unknown as Record<string, unknown>
    );

    if (customer.creditBalance > 0 || customer.consignmentCrates > 0) {
      throw new GovernanceErrorSupabase(
        'Impossible d’archiver un client avec un encours crédit ou des casiers consignés ouverts.',
        400
      );
    }

    const now = new Date().toISOString();
    const { error } = await supabaseAdmin
      .from('customers')
      .update({ deleted_at: now, updated_at: now })
      .eq('id', customerId);
    if (error) throw new GovernanceErrorSupabase(error.message, 500, 'DB_ERROR');

    await this.appendAudit(
      actor,
      'ARCHIVAGE_CLIENT',
      'Customer',
      customer.id,
      customer.code,
      { deletedAt: null },
      { deletedAt: now },
      'Web / API',
      false,
      actor.warehouseId ?? null
    );

    return { ok: true };
  }

  public async toggleCustomerBlock(
    actor: UserAccount,
    customerId: string
  ): Promise<Customer> {
    this.requireAdmin();
    await this.requirePermission(actor, PERMISSIONS.CREDIT_BLOCK);

    const { data: cust } = await supabaseAdmin
      .from('customers')
      .select('*')
      .eq('id', customerId)
      .is('deleted_at', null)
      .maybeSingle();

    if (!cust) throw new GovernanceErrorSupabase('Client introuvable.', 404);
    const customer = DepotStoreSupabase.toCamel<Customer>(
      cust as unknown as Record<string, unknown>
    );

    if (customer.id === 'cust-comptoir') {
      throw new GovernanceErrorSupabase(
        'Le client comptoir passant ne peut pas être bloqué.',
        400
      );
    }

    const before = { isBlocked: Boolean(customer.isBlocked) };
    const newBlocked = !customer.isBlocked;
    const now = new Date().toISOString();

    const { error } = await supabaseAdmin
      .from('customers')
      .update({ is_blocked: newBlocked, updated_at: now })
      .eq('id', customerId);
    if (error) throw new GovernanceErrorSupabase(error.message, 500, 'DB_ERROR');

    await this.appendAudit(
      actor,
      newBlocked ? 'BLOCAGE_CREDIT_CLIENT' : 'DEBLOCAGE_CREDIT_CLIENT',
      'Customer',
      customer.id,
      customer.code,
      before,
      { isBlocked: newBlocked },
      'Web / API',
      false,
      actor.warehouseId ?? null
    );

    return { ...customer, isBlocked: newBlocked, updatedAt: now };
  }

  // ------------------------------------------------------------------
  // 3. Suppliers
  // ------------------------------------------------------------------

  public async upsertSupplier(
    actor: UserAccount,
    input: Partial<Supplier> & { id?: string }
  ): Promise<Supplier> {
    this.requireAdmin();
    await this.requirePermission(actor, PERMISSIONS.PURCHASE_RECEIVE);
    const now = new Date().toISOString();

    if (input.id) {
      const { data: sup } = await supabaseAdmin
        .from('suppliers')
        .select('*')
        .eq('id', input.id)
        .is('deleted_at', null)
        .maybeSingle();

      if (!sup) throw new GovernanceErrorSupabase('Fournisseur introuvable.', 404);
      const supplier = DepotStoreSupabase.toCamel<Supplier>(
        sup as unknown as Record<string, unknown>
      );

      const before = { ...supplier };
      const updateData: Record<string, unknown> = { ...input, updated_at: now };
      const snakeUpdate: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(updateData)) {
        if (key === 'id') continue;
        const snakeKey = key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
        snakeUpdate[snakeKey] = value;
      }

      const { error } = await supabaseAdmin
        .from('suppliers')
        .update(snakeUpdate)
        .eq('id', input.id);
      if (error) throw new GovernanceErrorSupabase(error.message, 500, 'DB_ERROR');

      const updated: Supplier = { ...supplier, ...input, updatedAt: now };

      await this.appendAudit(
        actor,
        'MODIFICATION_FOURNISSEUR',
        'Supplier',
        supplier.id,
        supplier.code,
        before,
        updated,
        'Web / API',
        false,
        actor.warehouseId ?? null
      );

      return updated;
    }

    const created: Supplier = {
      id: `sup-${Date.now()}`,
      code: input.code || `FRN-${Date.now()}`,
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

    const { error } = await supabaseAdmin.from('suppliers').insert([
      {
        id: created.id,
        code: created.code,
        name: created.name,
        contact_name: created.contactName,
        phone: created.phone,
        payment_terms_days: created.paymentTermsDays,
        crates_held_from_supplier: created.cratesHeldFromSupplier,
        deposit_paid_to_supplier: created.depositPaidToSupplier,
        created_at: created.createdAt,
        updated_at: created.updatedAt,
        deleted_at: created.deletedAt,
      },
    ]);
    if (error) throw new GovernanceErrorSupabase(error.message, 500, 'DB_ERROR');

    await this.appendAudit(
      actor,
      'CREATION_FOURNISSEUR',
      'Supplier',
      created.id,
      created.code,
      null,
      created,
      'Web / API',
      false,
      actor.warehouseId ?? null
    );

    return created;
  }

  // ------------------------------------------------------------------
  // 4. Purchase Orders & Goods Receipts
  // ------------------------------------------------------------------

  public async createPurchaseOrder(
    actor: UserAccount,
    input: {
      supplierId: string;
      warehouseId: string;
      expectedDate: string;
      lines: { packagingId: string; qtyOrdered: number }[];
    }
  ): Promise<PurchaseOrder> {
    this.requireAdmin();
    await this.requirePermission(actor, PERMISSIONS.PURCHASE_RECEIVE);

    const warehouseId = input.warehouseId;
    const now = new Date().toISOString();

    const lines = input.lines.map((l) => {
      const pkg = this.findPackagingById(l.packagingId);
      if (!pkg) throw new GovernanceErrorSupabase('Conditionnement invalide.', 400);
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
      docNumber: `BDC-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`,
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

    const { error } = await supabaseAdmin.from('purchase_orders').insert([
      {
        id: po.id,
        doc_number: po.docNumber,
        supplier_id: po.supplierId,
        warehouse_id: po.warehouseId,
        status: po.status,
        total_liquid: po.totalLiquid,
        total_deposit: po.totalDeposit,
        expected_date: po.expectedDate,
        created_by: po.createdBy,
        created_at: po.createdAt,
        updated_at: po.updatedAt,
        deleted_at: po.deletedAt,
      },
    ]);
    if (error) throw new GovernanceErrorSupabase(error.message, 500, 'DB_ERROR');

    const poLines = po.lines.map((l) => ({
      purchase_order_id: po.id,
      packaging_id: l.packagingId,
      qty_ordered: l.qtyOrdered,
      unit_purchase_price: l.unitPurchasePrice,
      deposit_per_crate: l.depositPerCrate,
    }));
    if (poLines.length > 0) {
      const { error: lErr } = await supabaseAdmin.from('purchase_order_lines').insert(poLines);
      if (lErr) throw new GovernanceErrorSupabase(lErr.message, 500, 'DB_ERROR');
    }

    await this.appendAudit(
      actor,
      'CREATION_BON_COMMANDE',
      'PurchaseOrder',
      po.id,
      po.docNumber,
      null,
      po,
      'Web / API',
      false,
      warehouseId
    );

    return po;
  }

  public async receiveGoods(
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
  ): Promise<GoodsReceipt> {
    this.requireAdmin();
    await this.requirePermission(actor, PERMISSIONS.PURCHASE_RECEIVE);

    const { data: po } = await supabaseAdmin
      .from('purchase_orders')
      .select('*, purchase_order_lines(*)')
      .eq('id', input.purchaseOrderId)
      .is('deleted_at', null)
      .maybeSingle();

    if (!po) throw new GovernanceErrorSupabase('Bon de commande introuvable.', 404);
    const purchaseOrder = DepotStoreSupabase.toCamel<PurchaseOrder>(
      po as unknown as Record<string, unknown>
    );

    this.assertWarehouseScopeSupabase(actor, purchaseOrder.warehouseId);

    const supplier = await this.findSupplierById(purchaseOrder.supplierId);
    const now = new Date().toISOString();

    let cratesReceived = 0;
    let cratesReturnedToSupplier = 0;
    let netDepositChange = 0;

    const receiptLines: GoodsReceiptLine[] = [];

    for (const l of input.lines) {
      const poLine = purchaseOrder.lines.find((pl) => pl.packagingId === l.packagingId);
      const ordered = poLine ? poLine.qtyOrdered : 0;
      const received = Math.max(0, Number(l.qtyReceived));
      const returned = Math.max(0, Number(l.emptyCratesReturnedToSupplier) || 0);
      const discrepancyQty = received - ordered;

      let stk = this.findStock(purchaseOrder.warehouseId, l.packagingId);
      if (!stk) {
        stk = {
          id: `stk-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
          warehouseId: purchaseOrder.warehouseId,
          packagingId: l.packagingId,
          qtyOnHand: 0,
          qtyReserved: 0,
          emptyCratesOnHand: 0,
          nextDlc: null,
          lotNumber: `LOT-${Date.now().toString().slice(-4)}`,
          updatedAt: now,
        };
        // Insérer le stock
        const { error: sErr } = await supabaseAdmin.from('stocks').insert([
          {
            id: stk.id,
            warehouse_id: stk.warehouseId,
            packaging_id: stk.packagingId,
            qty_on_hand: stk.qtyOnHand,
            qty_reserved: stk.qtyReserved,
            empty_crates_on_hand: stk.emptyCratesOnHand,
            next_dlc: stk.nextDlc,
            lot_number: stk.lotNumber,
            updated_at: stk.updatedAt,
          },
        ]);
        if (sErr) throw new GovernanceErrorSupabase(sErr.message, 500, 'DB_ERROR');
      }

      const newQty = stk.qtyOnHand + received;
      const { error: uErr } = await supabaseAdmin
        .from('stocks')
        .update({ qty_on_hand: newQty, updated_at: now })
        .eq('id', stk.id);
      if (uErr) throw new GovernanceErrorSupabase(uErr.message, 500, 'DB_ERROR');

      const pkg = await this.getPackagingById(l.packagingId);
      if (pkg?.isReturnable) {
        const newEmptyCrates = Math.max(0, stk.emptyCratesOnHand - returned);
        await supabaseAdmin
          .from('stocks')
          .update({ empty_crates_on_hand: newEmptyCrates, updated_at: now })
          .eq('id', stk.id);
        cratesReceived += received;
        cratesReturnedToSupplier += returned;
        netDepositChange += (received - returned) * pkg.depositPerCrate;
      }

      receiptLines.push({
        packagingId: l.packagingId,
        qtyOrdered: ordered,
        qtyReceived: received,
        discrepancyQty,
        discrepancyReason: l.discrepancyReason || '',
        emptyCratesReturnedToSupplier: returned,
      });
    }

    if (supplier) {
      supplier.cratesHeldFromSupplier = Math.max(
        0,
        supplier.cratesHeldFromSupplier + cratesReceived - cratesReturnedToSupplier
      );
      supplier.depositPaidToSupplier = Math.max(
        0,
        supplier.depositPaidToSupplier + netDepositChange
      );
      supabaseAdmin
        .from('suppliers')
        .update({
          crates_held_from_supplier: supplier.cratesHeldFromSupplier,
          deposit_paid_to_supplier: supplier.depositPaidToSupplier,
          updated_at: now,
        })
        .eq('id', supplier.id);
    }

    const poStatus = receiptLines.some((l) => l.discrepancyQty < 0) ? 'PARTIEL' : 'RECU';
    supabaseAdmin
      .from('purchase_orders')
      .update({ status: poStatus, updated_at: now })
      .eq('id', purchaseOrder.id);

    const gr: GoodsReceipt = {
      id: `gr-${Date.now()}`,
      docNumber: `BLF-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`,
      purchaseOrderId: purchaseOrder.id,
      supplierId: purchaseOrder.supplierId,
      supplierBlNumber: input.supplierBlNumber,
      warehouseId: purchaseOrder.warehouseId,
      lines: receiptLines,
      cratesReceived,
      cratesReturnedToSupplier,
      netDepositChange,
      receivedBy: actor.id,
      createdAt: now,
    };

    const { error } = await supabaseAdmin.from('goods_receipts').insert([
      {
        id: gr.id,
        doc_number: gr.docNumber,
        purchase_order_id: gr.purchaseOrderId,
        supplier_id: gr.supplierId,
        supplier_bl_number: gr.supplierBlNumber,
        warehouse_id: gr.warehouseId,
        crates_received: gr.cratesReceived,
        crates_returned_to_supplier: gr.cratesReturnedToSupplier,
        net_deposit_change: gr.netDepositChange,
        received_by: gr.receivedBy,
        created_at: gr.createdAt,
      },
    ]);
    if (error) throw new GovernanceErrorSupabase(error.message, 500, 'DB_ERROR');

    const grLines = receiptLines.map((l) => ({
      goods_receipt_id: gr.id,
      packaging_id: l.packagingId,
      qty_ordered: l.qtyOrdered,
      qty_received: l.qtyReceived,
      discrepancy_qty: l.discrepancyQty,
      discrepancy_reason: l.discrepancyReason,
      empty_crates_returned_to_supplier: l.emptyCratesReturnedToSupplier,
    }));
    if (grLines.length > 0) {
      const { error: lErr } = await supabaseAdmin.from('goods_receipt_lines').insert(grLines);
      if (lErr) throw new GovernanceErrorSupabase(lErr.message, 500, 'DB_ERROR');
    }

    if (cratesReceived > 0) {
      const firstLine = receiptLines[0];
      const csg: ConsignmentMovement = {
        id: `csg-${Date.now()}`,
        docNumber: `CSG-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`,
        warehouseId: purchaseOrder.warehouseId,
        movementType: 'RECEPTION_BRASSERIE',
        customerId: null,
        supplierId: purchaseOrder.supplierId,
        packagingId: firstLine.packagingId,
        cratesOut: cratesReturnedToSupplier,
        cratesIn: cratesReceived,
        bottlesMissing: 0,
        depositAmount: netDepositChange,
        settlementMode: 'BRASSERIE',
        referenceDoc: gr.docNumber,
        createdBy: actor.id,
        createdAt: now,
      };

      await supabaseAdmin.from('consignments').insert([
        {
          id: csg.id,
          doc_number: csg.docNumber,
          warehouse_id: csg.warehouseId,
          movement_type: csg.movementType,
          customer_id: csg.customerId,
          supplier_id: csg.supplierId,
          packaging_id: csg.packagingId,
          crates_out: csg.cratesOut,
          crates_in: csg.cratesIn,
          bottles_missing: csg.bottlesMissing,
          deposit_amount: csg.depositAmount,
          settlement_mode: csg.settlementMode,
          reference_doc: csg.referenceDoc,
          created_by: csg.createdBy,
          created_at: csg.createdAt,
        },
      ]);
    }

    await this.appendAudit(
      actor,
      'RECEPTION_BRASSERIE',
      'GoodsReceipt',
      gr.id,
      gr.docNumber,
      { poStatus: 'ENVOYE' },
      gr,
      'Web / API',
      false,
      purchaseOrder.warehouseId
    );

    return gr;
  }

  // Stubs rétrocompatibles (à remplacer par les méthodes async get* ci-dessus)
  private findPackagingById(id: string): Packaging | undefined {
    return undefined;
  }

  private findSupplierById(id: string): Supplier | undefined {
    return undefined;
  }

  private findStock(warehouseId: string, packagingId: string): ProductStock | undefined {
    return undefined;
  }

  private async getPackagingById(id: string): Promise<Packaging | null> {
    const { data, error } = await supabaseAdmin
      .from('packagings')
      .select('*')
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle();
    if (error || !data) return null;
    return DepotStoreSupabase.toCamel<Packaging>(
      data as unknown as Record<string, unknown>
    );
  }

  private async getSupplierById(id: string): Promise<Supplier | null> {
    const { data, error } = await supabaseAdmin
      .from('suppliers')
      .select('*')
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle();
    if (error || !data) return null;
    return DepotStoreSupabase.toCamel<Supplier>(
      data as unknown as Record<string, unknown>
    );
  }

  private async getStock(
    warehouseId: string,
    packagingId: string
  ): Promise<ProductStock | null> {
    const { data, error } = await supabaseAdmin
      .from('stocks')
      .select('*')
      .eq('warehouse_id', warehouseId)
      .eq('packaging_id', packagingId)
      .maybeSingle();
    if (error || !data) return null;
    return DepotStoreSupabase.toCamel<ProductStock>(
      data as unknown as Record<string, unknown>
    );
  }

  private async assertWarehouseScopeSupabase(
    actor: UserAccount,
    warehouseId: string | null | undefined
  ): Promise<void> {
    if (actor.role === 'PROPRIETAIRE') return;
    const targetId = warehouseId || '';
    if (!actor.warehouseId || actor.warehouseId !== targetId) {
      throw new GovernanceErrorSupabase(
        `Accès refusé à un autre dépôt : "${actor.name}" est affecté uniquement au dépôt ${actor.warehouseId || 'aucun'}.`,
        403,
        'WAREHOUSE_FORBIDDEN'
      );
    }
  }

  // ------------------------------------------------------------------
  // 5. Sales & POS
  // ------------------------------------------------------------------

  public async createSale(
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
  ): Promise<Sale | { pendingApproval: true; approval: ApprovalRequest; sale: Sale }> {
    this.requireAdmin();
    await this.requirePermission(actor, PERMISSIONS.SALE_CREATE);

    const warehouseId = input.warehouseId;
    this.assertWarehouseScopeSupabase(actor, warehouseId);

    if (input.clientTempId) {
      const { data: existing } = await supabaseAdmin
        .from('sales')
        .select('id')
        .eq('client_temp_id', input.clientTempId)
        .maybeSingle();
      if (existing) {
        const { data: sale } = await supabaseAdmin
          .from('sales')
          .select('*')
          .eq('id', (existing as Record<string, unknown>).id as string)
          .maybeSingle();
        return DepotStoreSupabase.toCamel<Sale>(
          sale as unknown as Record<string, unknown>
        );
      }
    }

    const { data: activeCash } = await supabaseAdmin
      .from('cash_sessions')
      .select('*')
      .eq('warehouse_id', warehouseId)
      .eq('status', 'OUVERTE')
      .is('deleted_at', null)
      .maybeSingle();

    if (!activeCash && !input.offlineOriginated) {
      throw new GovernanceErrorSupabase(
        'Aucune caisse ouverte sur ce dépôt. Veuillez ouvrir une session de caisse avant d’encaisser.',
        400,
        'NO_OPEN_CASH'
      );
    }

    const { data: customer } = await supabaseAdmin
      .from('customers')
      .select('*')
      .eq('id', input.customerId)
      .is('deleted_at', null)
      .maybeSingle();
    if (!customer) throw new GovernanceErrorSupabase('Client introuvable.', 404);
    const cust = DepotStoreSupabase.toCamel<Customer>(
      customer as unknown as Record<string, unknown>
    );

    if (cust.isBlocked && input.payments.some((p) => p.method === 'CREDIT')) {
      throw new GovernanceErrorSupabase(
        `Compte crédit bloqué pour ${cust.name}. Règlement préalable requis.`,
        403,
        'CUSTOMER_BLOCKED'
      );
    }

    const now = new Date().toISOString();
    const saleLines: any[] = [];
    let liquidTotal = 0;
    let depositNetTotal = 0;

    for (const rawLine of input.lines) {
      const qty = Math.max(1, Number(rawLine.qty));
      const pkg = await this.getPackagingById(rawLine.packagingId);
      if (!pkg) throw new GovernanceErrorSupabase('Conditionnement introuvable.', 404);

      const stk = await this.getStock(warehouseId, pkg.id);
      if (!stk || stk.qtyOnHand < qty) {
        throw new GovernanceErrorSupabase(
          `Stock insuffisant pour "${pkg.label}".`,
          409,
          'INSUFFICIENT_STOCK'
        );
      }

      const unitPrice =
        cust.pricingTier === 'GROS'
          ? pkg.salePriceGros
          : cust.pricingTier === 'SEMI_GROS'
          ? pkg.salePriceSemiGros
          : pkg.salePriceDetail;

      const returnedNow = pkg.isReturnable
        ? Math.min(qty, Math.max(0, Number(rawLine.emptyCratesReturnedNow) || 0))
        : 0;
      const netCratesOut = pkg.isReturnable ? Math.max(0, qty - returnedNow) : 0;
      const depositCharged = pkg.isReturnable ? netCratesOut * pkg.depositPerCrate : 0;

      liquidTotal += qty * unitPrice;
      depositNetTotal += depositCharged;

      saleLines.push({
        packagingId: pkg.id,
        qty,
        unitPrice,
        lineLiquidTotal: qty * unitPrice,
        depositCharged,
        emptyCratesReturnedNow: returnedNow,
      });
    }

    const discountAmount = Math.max(0, Number(input.discountAmount) || 0);
    const discountPct = liquidTotal > 0 ? (discountAmount / liquidTotal) * 100 : 0;
    const { data: company } = await supabaseAdmin
      .from('companies')
      .select('*')
      .eq('id', 'company')
      .maybeSingle();
    const comp = (company as Record<string, unknown>) || {};
    const maxCashierDiscount = Number(comp.max_cashier_discount_percent) || 5;

    const needsDiscountApproval =
      discountPct > maxCashierDiscount &&
      !(await this.hasPermission(actor, PERMISSIONS.SALE_DISCOUNT_OVER_5));

    if (discountPct > maxCashierDiscount && !input.discountReason?.trim()) {
      throw new GovernanceErrorSupabase(
        `Motif obligatoire pour toute remise > ${maxCashierDiscount}% (${discountPct.toFixed(1)}%).`,
        400,
        'DISCOUNT_REASON_REQUIRED'
      );
    }

    const grandTotal = Math.max(0, liquidTotal - discountAmount + depositNetTotal);
    const creditAdded = input.payments
      .filter((p) => p.method === 'CREDIT')
      .reduce((s, p) => s + Number(p.amount), 0);

    if (creditAdded > 0) {
      if (cust.id === 'cust-comptoir') {
        throw new GovernanceErrorSupabase(
          'Le client comptoir passant ne peut pas acheter à crédit.',
          400
        );
      }
      if (cust.creditBalance + creditAdded > cust.creditLimit) {
        const canUnlock = await this.hasPermission(actor, PERMISSIONS.CREDIT_BLOCK);
        let managerApprover = null;
        if (input.creditOverridePin) {
          const { data: users } = await supabaseAdmin
            .from('users')
            .select('*')
            .eq('pin', input.creditOverridePin);
          if (users && users.length > 0) {
            const u = DepotStoreSupabase.toCamel<UserAccount>(
              users[0] as unknown as Record<string, unknown>
            );
            if (await this.hasPermission(u, PERMISSIONS.CREDIT_LIMIT_UPDATE)) {
              managerApprover = u;
            }
          }
        }
        if (!canUnlock && !managerApprover) {
          throw new GovernanceErrorSupabase(
            `Plafond crédit dépassé pour ${cust.name} (Encours : ${cust.creditBalance.toLocaleString('fr-FR')} / Plafond : ${cust.creditLimit.toLocaleString('fr-FR')} FCFA).`,
            403,
            'CREDIT_LIMIT_EXCEE'
          );
        }
      }
    }

    const docNumber = `FAC-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`;
    const ticketNumber = `TKT-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`;

    const sale: Sale = {
      id: `sale-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      docNumber,
      ticketNumber,
      customerId: input.customerId,
      warehouseId,
      cashSessionId: (activeCash as CashSession | undefined)?.id || 'offline-session',
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

    const { error: sErr } = await supabaseAdmin.from('sales').insert([
      {
        id: sale.id,
        doc_number: sale.docNumber,
        ticket_number: sale.ticketNumber,
        customer_id: sale.customerId,
        warehouse_id: sale.warehouseId,
        cash_session_id: sale.cashSessionId,
        lines: sale.lines,
        discount_amount: sale.discountAmount,
        discount_reason: sale.discountReason,
        liquid_total: sale.liquidTotal,
        deposit_net_total: sale.depositNetTotal,
        grand_total: sale.grandTotal,
        payments: sale.payments,
        credit_added: sale.creditAdded,
        status: sale.status,
        delivery_required: sale.deliveryRequired,
        offline_originated: sale.offlineOriginated,
        client_temp_id: sale.clientTempId,
        created_by: sale.createdBy,
        validated_by: sale.validatedBy,
        created_at: sale.createdAt,
        deleted_at: sale.deletedAt,
      },
    ]);
    if (sErr) throw new GovernanceErrorSupabase(sErr.message, 500, 'DB_ERROR');

    if (input.clientTempId) {
      await supabaseAdmin.from('processed_client_uuids').insert([
        { uuid: input.clientTempId },
      ]);
    }

    if (needsDiscountApproval) {
      const req: ApprovalRequest = {
        id: `apr-${Date.now()}`,
        warehouseId,
        type: 'REMISE_EXCEPTIONNELLE',
        entityId: sale.id,
        docNumber: sale.docNumber,
        description: `Remise exceptionnelle ${discountPct.toFixed(1)}% (${discountAmount.toLocaleString('fr-FR')} FCFA) sur ${sale.docNumber} — ${cust.name} (${input.discountReason})`,
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

      await supabaseAdmin.from('approvals').insert([
        {
          id: req.id,
          warehouse_id: req.warehouseId,
          type: req.type,
          entity_id: req.entityId,
          doc_number: req.docNumber,
          description: req.description,
          amount: req.amount,
          metadata: req.metadata,
          requested_by: req.requestedBy,
          requested_by_name: req.requestedByName,
          target_role: req.targetRole,
          status: req.status,
          requires_two_approvers: req.requiresTwoApprovers,
          reviewed_by: req.reviewedBy,
          reviewed_by_name: req.reviewedByName,
          reviewed_at: req.reviewedAt,
          decision_note: req.decisionNote,
          created_at: req.createdAt,
        },
      ]);

      await this.appendAudit(
        actor,
        'VENTE_ATTENTE_VALIDATION_REMISE',
        'Sale',
        sale.id,
        sale.docNumber,
        null,
        { discountPct, reqId: req.id },
        'POS / Web',
        Boolean(input.offlineOriginated),
        warehouseId
      );

      return { pendingApproval: true, approval: req, sale };
    }

    // Finaliser les effets de la vente (stock, crédit, consigne, caisse, trésorerie)
    await this.finalizeSaleEffectsSupabase(
      actor,
      sale,
      activeCash as CashSession | undefined,
      cust,
      now
    );

    await this.appendAudit(
      actor,
      'CREATION_VENTE',
      'Sale',
      sale.id,
      sale.docNumber,
      null,
      { grandTotal: sale.grandTotal, creditAdded, depositNetTotal },
      'POS / Web',
      Boolean(input.offlineOriginated),
      warehouseId
    );

    return sale;
  }

  private async finalizeSaleEffectsSupabase(
    actor: UserAccount,
    sale: Sale,
    activeCash: CashSession | undefined,
    customer: Customer,
    now: string
  ): Promise<void> {
    let totalCratesOut = 0;
    let totalCratesReturned = 0;

    for (const line of sale.lines) {
      const stk = await this.getStock(sale.warehouseId, line.packagingId);
      const pkg = await this.getPackagingById(line.packagingId);
      if (!stk || stk.qtyOnHand < line.qty) {
        throw new GovernanceErrorSupabase(
          `Stock insuffisant lors de la validation de ${sale.docNumber}.`,
          409,
          'INSUFFICIENT_STOCK'
        );
      }

      await supabaseAdmin
        .from('stocks')
        .update({
          qty_on_hand: Math.max(0, stk.qtyOnHand - line.qty),
          empty_crates_on_hand:
            (stk.emptyCratesOnHand || 0) + line.emptyCratesReturnedNow,
          updated_at: now,
        })
        .eq('id', stk.id);

      if (pkg?.isReturnable) {
        const netOut = Math.max(0, line.qty - line.emptyCratesReturnedNow);
        totalCratesOut += netOut;
        totalCratesReturned += line.emptyCratesReturnedNow;
      }
    }

    if (sale.creditAdded > 0) {
      const newBalance = customer.creditBalance + sale.creditAdded;
      const due = new Date();
      due.setDate(due.getDate() + 14);
      const crd: CreditRecord = {
        id: `crd-${Date.now()}`,
        docNumber: `CRE-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`,
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

      await supabaseAdmin.from('credits').insert([
        {
          id: crd.id,
          doc_number: crd.docNumber,
          warehouse_id: crd.warehouseId,
          customer_id: crd.customerId,
          sale_id: crd.saleId,
          sale_doc_number: crd.saleDocNumber,
          original_amount: crd.originalAmount,
          remaining_amount: crd.remainingAmount,
          due_date: crd.dueDate,
          status: crd.status,
          created_at: crd.createdAt,
        },
      ]);

      await supabaseAdmin
        .from('customers')
        .update({ credit_balance: newBalance, updated_at: now })
        .eq('id', customer.id);
    }

    if (totalCratesOut > 0) {
      const bottlesCount = sale.lines.reduce((sum, l) => {
        const pkg = { unitsPerPack: 12 };
        const net = Math.max(0, l.qty - l.emptyCratesReturnedNow);
        return sum + net * (pkg.unitsPerPack || 0);
      }, 0);

      await supabaseAdmin
        .from('customers')
        .update({
          consignment_crates: Math.max(0, customer.consignmentCrates + totalCratesOut),
          consignment_bottles: Math.max(0, customer.consignmentBottles + bottlesCount),
          consignment_deposit_due: Math.max(
            0,
            customer.consignmentDepositDue + sale.depositNetTotal
          ),
          last_crate_out_date: now,
          updated_at: now,
        })
        .eq('id', customer.id);
    }

    const cashPaid = sale.payments
      .filter((p) => p.method === 'ESPECES')
      .reduce((s, p) => s + Number(p.amount), 0);
    const mmPaid = sale.payments
      .filter((p) =>
        ['ORANGE_MONEY', 'MTN_MOMO', 'WAVE', 'MOOV_MONEY'].includes(p.method)
      )
      .reduce((s, p) => s + Number(p.amount), 0);

    if (activeCash) {
      await supabaseAdmin
        .from('cash_sessions')
        .update({
          total_cash_sales: (activeCash.totalCashSales || 0) + cashPaid,
          expected_cash: (activeCash.expectedCash || 0) + cashPaid,
          total_mobile_money: (activeCash.totalMobileMoney || 0) + mmPaid,
          total_credit_sales: (activeCash.totalCreditSales || 0) + sale.creditAdded,
        })
        .eq('id', activeCash.id);
    }

    for (const p of sale.payments) {
      if (p.method !== 'CREDIT' && p.amount > 0) {
        const wallet = p.method === 'ESPECES' ? 'CAISSE' : p.method;
        await supabaseAdmin.from('treasury').insert([
          {
            id: `trs-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
            doc_number: `TRS-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`,
            warehouse_id: sale.warehouseId,
            wallet,
            direction: 'ENTREE',
            category: 'Vente',
            amount: Number(p.amount),
            reference: p.reference || sale.ticketNumber,
            description: `Vente ${sale.docNumber} — ${customer.name}`,
            created_by: actor.id,
            created_at: now,
          },
        ]);
      }
    }
  }

  public async applySaleDiscount(
    actor: UserAccount,
    saleId: string,
    input: { percent: number; reason: string }
  ): Promise<{ status: 'applied'; sale: Sale } | { status: 'pending_approval'; approval: ApprovalRequest }> {
    this.requireAdmin();
    await this.requirePermission(actor, PERMISSIONS.SALE_DISCOUNT_5);

    const { data: sale } = await supabaseAdmin
      .from('sales')
      .select('*')
      .eq('id', saleId)
      .is('deleted_at', null)
      .maybeSingle();
    if (!sale) throw new GovernanceErrorSupabase('Vente introuvable.', 404);
    const s = DepotStoreSupabase.toCamel<Sale>(
      sale as unknown as Record<string, unknown>
    );

    this.assertWarehouseScopeSupabase(actor, s.warehouseId);

    const pct = Math.max(0, Number(input.percent) || 0);
    const { data: company } = await supabaseAdmin
      .from('companies')
      .select('*')
      .eq('id', 'company')
      .maybeSingle();
    const comp = (company as Record<string, unknown>) || {};
    const maxPct = Number(comp.max_cashier_discount_percent) || 5;

    const baseLiquid = s.lines.reduce((sum: number, l: any) => sum + l.lineLiquidTotal, 0);
    const discountAmount = Math.round((baseLiquid * pct) / 100);

    if (pct > maxPct && !(await this.hasPermission(actor, PERMISSIONS.SALE_DISCOUNT_OVER_5))) {
      if (!input.reason?.trim()) {
        throw new GovernanceErrorSupabase(
          `Motif obligatoire pour remise > ${maxPct}%.`,
          400
        );
      }
      const req: ApprovalRequest = {
        id: `apr-${Date.now()}`,
        warehouseId: s.warehouseId,
        type: 'REMISE_EXCEPTIONNELLE',
        entityId: s.id,
        docNumber: s.docNumber,
        description: `Demande remise ${pct}% (${discountAmount.toLocaleString('fr-FR')} FCFA) sur ${s.docNumber} : ${input.reason}`,
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

      await supabaseAdmin.from('approvals').insert([
        {
          id: req.id,
          warehouse_id: req.warehouseId,
          type: req.type,
          entity_id: req.entityId,
          doc_number: req.docNumber,
          description: req.description,
          amount: req.amount,
          metadata: req.metadata,
          requested_by: req.requestedBy,
          requested_by_name: req.requestedByName,
          target_role: req.targetRole,
          status: req.status,
          requires_two_approvers: req.requiresTwoApprovers,
          reviewed_by: req.reviewedBy,
          reviewed_by_name: req.reviewedByName,
          reviewed_at: req.reviewedAt,
          decision_note: req.decisionNote,
          created_at: req.createdAt,
        },
      ]);

      await this.appendAudit(
        actor,
        'DEMANDE_REMISE_EXCEPTIONNELLE',
        'Sale',
        s.id,
        s.docNumber,
        { discountAmount: s.discountAmount },
        { pct, reason: input.reason },
        'Web / API',
        false,
        s.warehouseId
      );

      return { status: 'pending_approval', approval: req };
    }

    const now = new Date().toISOString();
    const before = { discountAmount: s.discountAmount, grandTotal: s.grandTotal };
    const newDiscount = discountAmount;
    const newLiquid = Math.max(0, baseLiquid - newDiscount);
    const newGrandTotal = Math.max(0, newLiquid + s.depositNetTotal);

    await supabaseAdmin
      .from('sales')
      .update({
        discount_amount: newDiscount,
        discount_reason: input.reason || s.discountReason,
        liquid_total: newLiquid,
        grand_total: newGrandTotal,
      })
      .eq('id', saleId);

    await this.appendAudit(
      actor,
      'APPLICATION_REMISE_VENTE',
      'Sale',
      s.id,
      s.docNumber,
      before,
      { discountAmount: newDiscount, grandTotal: newGrandTotal },
      'Web / API',
      false,
      s.warehouseId
    );

    return { status: 'applied', sale: { ...s, discountAmount: newDiscount, liquidTotal: newLiquid, grandTotal: newGrandTotal } };
  }

  public async validateSale(
    actor: UserAccount,
    saleId: string
  ): Promise<Sale> {
    this.requireAdmin();
    await this.requirePermission(actor, PERMISSIONS.SALE_VALIDATE);

    const { data: sale } = await supabaseAdmin
      .from('sales')
      .select('*')
      .eq('id', saleId)
      .is('deleted_at', null)
      .maybeSingle();
    if (!sale) throw new GovernanceErrorSupabase('Vente introuvable.', 404);
    const s = DepotStoreSupabase.toCamel<Sale>(
      sale as unknown as Record<string, unknown>
    );

    this.assertWarehouseScopeSupabase(actor, s.warehouseId);
    if (s.status === 'ANNULEE') throw new GovernanceErrorSupabase('Vente annulée.', 400);
    if (s.status === 'VALIDEE') return s;

    const { data: company } = await supabaseAdmin
      .from('companies')
      .select('*')
      .eq('id', 'company')
      .maybeSingle();
    const comp = (company as Record<string, unknown>) || {};
    const threshold = Number(comp.auto_validate_sale_threshold) || 200000;

    if (s.grandTotal > threshold && actor.role !== 'PROPRIETAIRE') {
      throw new GovernanceErrorSupabase(
        `Montant supérieur au seuil Gérant (${threshold.toLocaleString('fr-FR')} FCFA). Validation du Propriétaire requise.`,
        403,
        'SALE_THRESHOLD_EXCEEDED'
      );
    }

    const now = new Date().toISOString();
    const { data: customer } = await supabaseAdmin
      .from('customers')
      .select('*')
      .eq('id', s.customerId)
      .maybeSingle();
    const cust = customer
      ? DepotStoreSupabase.toCamel<Customer>(customer as unknown as Record<string, unknown>)
      : null;

    const { data: activeCash } = await supabaseAdmin
      .from('cash_sessions')
      .select('*')
      .eq('warehouse_id', s.warehouseId)
      .eq('status', 'OUVERTE')
      .maybeSingle();

    await supabaseAdmin
      .from('sales')
      .update({ status: 'VALIDEE', validated_by: actor.id })
      .eq('id', saleId);

    if (cust && activeCash) {
      await this.finalizeSaleEffectsSupabase(
        actor,
        { ...s, status: 'VALIDEE', validatedBy: actor.id },
        activeCash as CashSession,
        cust,
        now
      );
    }

    await this.appendAudit(
      actor,
      'VALIDATION_VENTE',
      'Sale',
      s.id,
      s.docNumber,
      { status: 'EN_ATTENTE_VALIDATION' },
      { status: 'VALIDEE' },
      'Web / API',
      false,
      s.warehouseId
    );

    return { ...s, status: 'VALIDEE', validatedBy: actor.id };
  }

  public async requestSaleCancellation(
    actor: UserAccount,
    saleId: string,
    reason: string
  ): Promise<ApprovalRequest> {
    this.requireAdmin();

    const { data: sale } = await supabaseAdmin
      .from('sales')
      .select('*')
      .eq('id', saleId)
      .is('deleted_at', null)
      .maybeSingle();
    if (!sale) throw new GovernanceErrorSupabase('Vente introuvable.', 404);
    const s = DepotStoreSupabase.toCamel<Sale>(
      sale as unknown as Record<string, unknown>
    );

    this.assertWarehouseScopeSupabase(actor, s.warehouseId);
    if (s.status === 'ANNULEE') throw new GovernanceErrorSupabase('Cette vente est déjà annulée.', 400);
    if (!reason.trim()) throw new GovernanceErrorSupabase('Un motif d’annulation est obligatoire.', 400);

    const { data: session } = await supabaseAdmin
      .from('cash_sessions')
      .select('*')
      .eq('id', s.cashSessionId)
      .maybeSingle();
    const isClosedSession = session?.status === 'CLOTUREE';

    if (isClosedSession) {
      const hasCancel = await this.hasPermission(actor, PERMISSIONS.SALE_CANCEL);
      const hasCancelClosed = await this.hasPermission(actor, PERMISSIONS.SALE_CANCEL_CLOSED);
      if (!hasCancel && !hasCancelClosed) {
        await this.requirePermission(actor, PERMISSIONS.SALE_CANCEL_CLOSED);
      }
    } else {
      await this.requirePermission(actor, PERMISSIONS.SALE_CANCEL);
    }

    const now = new Date().toISOString();
    const req: ApprovalRequest = {
      id: `apr-${Date.now()}`,
      warehouseId: s.warehouseId,
      type: 'ANNULATION_VENTE',
      entityId: s.id,
      docNumber: s.docNumber,
      description: `Demande d’annulation vente ${s.docNumber}${isClosedSession ? ' (caisse clôturée)' : ''} : ${reason}`,
      amount: s.grandTotal,
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

    await supabaseAdmin.from('approvals').insert([
      {
        id: req.id,
        warehouse_id: req.warehouseId,
        type: req.type,
        entity_id: req.entityId,
        doc_number: req.docNumber,
        description: req.description,
        amount: req.amount,
        metadata: req.metadata,
        requested_by: req.requestedBy,
        requested_by_name: req.requestedByName,
        target_role: req.targetRole,
        status: req.status,
        requires_two_approvers: req.requiresTwoApprovers,
        reviewed_by: req.reviewedBy,
        reviewed_by_name: req.reviewedByName,
        reviewed_at: req.reviewedAt,
        decision_note: req.decisionNote,
        created_at: req.createdAt,
      },
    ]);

    await this.appendAudit(
      actor,
      'DEMANDE_ANNULATION_VENTE',
      'Sale',
      s.id,
      s.docNumber,
      { status: s.status },
      { requestId: req.id, reason },
      'Web / API',
      false,
      s.warehouseId
    );

    return req;
  }

  // ------------------------------------------------------------------
  // 6. Cash Sessions (Open / Close / Validate)
  // ------------------------------------------------------------------

  public async openCashSession(
    actor: UserAccount,
    openingFloat: number,
    requestedWarehouseId?: string
  ): Promise<CashSession> {
    this.requireAdmin();
    await this.requirePermission(actor, PERMISSIONS.CASH_OPEN);

    const warehouseId = actor.role === 'PROPRIETAIRE'
      ? (requestedWarehouseId || 'wh-main')
      : actor.warehouseId || '';

    if (!warehouseId) {
      throw new GovernanceErrorSupabase('Aucun dépôt affecté à ce profil.', 403, 'WAREHOUSE_FORBIDDEN');
    }

    this.assertWarehouseScopeSupabase(actor, warehouseId);

    const { data: existing } = await supabaseAdmin
      .from('cash_sessions')
      .select('id')
      .eq('warehouse_id', warehouseId)
      .in('status', ['OUVERTE', 'EN_ATTENTE_VALIDATION'])
      .maybeSingle();

    if (existing) {
      throw new GovernanceErrorSupabase(
        'Une session de caisse est déjà ouverte ou en attente de validation sur ce dépôt.',
        400
      );
    }

    const now = new Date().toISOString();
    const cs: CashSession = {
      id: `cs-${Date.now()}`,
      docNumber: `CAI-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`,
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

    const { error } = await supabaseAdmin.from('cash_sessions').insert([
      {
        id: cs.id,
        doc_number: cs.docNumber,
        cashier_id: cs.cashierId,
        cashier_name: cs.cashierName,
        warehouse_id: cs.warehouseId,
        opened_at: cs.openedAt,
        closed_at: cs.closedAt,
        opening_float: cs.openingFloat,
        expected_cash: cs.expectedCash,
        counted_cash: cs.countedCash,
        variance: cs.variance,
        total_cash_sales: cs.totalCashSales,
        total_mobile_money: cs.totalMobileMoney,
        total_credit_sales: cs.totalCreditSales,
        total_deposit_refunds: cs.totalDepositRefunds,
        total_expenses: cs.totalExpenses,
        status: cs.status,
      },
    ]);
    if (error) throw new GovernanceErrorSupabase(error.message, 500, 'DB_ERROR');

    await this.appendAudit(
      actor,
      'OUVERTURE_CAISSE',
      'CashSession',
      cs.id,
      cs.docNumber,
      null,
      cs,
      'Web / API',
      false,
      warehouseId
    );

    return cs;
  }

  public async closeCashSession(
    actor: UserAccount,
    cashSessionId: string,
    countedCash: number,
    notes: string
  ): Promise<{ session: CashSession; pv: null; pendingValidation: true }> {
    this.requireAdmin();
    await this.requirePermission(actor, PERMISSIONS.CASH_CLOSE);

    const { data: cs } = await supabaseAdmin
      .from('cash_sessions')
      .select('*')
      .eq('id', cashSessionId)
      .eq('status', 'OUVERTE')
      .maybeSingle();

    if (!cs) throw new GovernanceErrorSupabase('Session de caisse ouverte introuvable.', 404);
    const session = DepotStoreSupabase.toCamel<CashSession>(
      cs as unknown as Record<string, unknown>
    );

    this.assertWarehouseScopeSupabase(actor, session.warehouseId);

    const counted = Math.max(0, Number(countedCash));
    const variance = counted - session.expectedCash;
    const now = new Date().toISOString();

    const { error } = await supabaseAdmin
      .from('cash_sessions')
      .update({
        counted_cash: counted,
        variance,
        closed_at: now,
        closed_by: actor.id,
        notes,
        status: 'EN_ATTENTE_VALIDATION',
      })
      .eq('id', cashSessionId);
    if (error) throw new GovernanceErrorSupabase(error.message, 500, 'DB_ERROR');

    await supabaseAdmin.from('approvals').insert([
      {
        id: `apr-${Date.now()}`,
        warehouse_id: session.warehouseId,
        type: 'CLOTURE_CAISSE',
        entity_id: session.id,
        doc_number: session.docNumber,
        description: `Validation clôture caisse ${session.docNumber} (${session.cashierName} · Écart : ${variance.toLocaleString('fr-FR')} FCFA)`,
        amount: counted,
        metadata: { variance, notes },
        requested_by: actor.id,
        requested_by_name: actor.name,
        target_role: 'PROPRIETAIRE',
        status: 'EN_ATTENTE',
        requires_two_approvers: false,
        reviewed_by: null,
        reviewed_by_name: null,
        reviewed_at: null,
        created_at: now,
      },
    ]);

    await this.appendAudit(
      actor,
      'CLOTURE_CAISSE_EN_ATTENTE',
      'CashSession',
      session.id,
      session.docNumber,
      { ...session },
      { ...session, status: 'EN_ATTENTE_VALIDATION', countedCash: counted, variance },
      'Web / API',
      false,
      session.warehouseId
    );

    return { session: { ...session, countedCash, variance, closedAt: now, status: 'EN_ATTENTE_VALIDATION' }, pv: null, pendingValidation: true };
  }

  public async validateCashSession(
    actor: UserAccount,
    cashSessionId: string,
    decisionNote?: string
  ): Promise<{ session: CashSession; pv: ReconciliationPV }> {
    this.requireAdmin();
    await this.requirePermission(actor, PERMISSIONS.CASH_CLOSE_VALIDATE);

    const { data: cs } = await supabaseAdmin
      .from('cash_sessions')
      .select('*')
      .eq('id', cashSessionId)
      .maybeSingle();

    if (!cs) throw new GovernanceErrorSupabase('Session de caisse introuvable.', 404);
    const session = DepotStoreSupabase.toCamel<CashSession>(
      cs as unknown as Record<string, unknown>
    );

    this.assertWarehouseScopeSupabase(actor, session.warehouseId);

    if (session.status !== 'EN_ATTENTE_VALIDATION') {
      throw new GovernanceErrorSupabase(
        'Cette caisse doit d’abord être clôturée avant validation.',
        400
      );
    }
    if (session.cashierId === actor.id || session.closedBy === actor.id) {
      throw new GovernanceErrorSupabase(
        'Séparation des tâches : un utilisateur ne peut jamais valider sa propre clôture de caisse.',
        403,
        'SEPARATION_OF_DUTIES'
      );
    }

    const now = new Date().toISOString();

    await supabaseAdmin
      .from('cash_sessions')
      .update({ status: 'CLOTUREE', validated_by: actor.id })
      .eq('id', cashSessionId);

    await supabaseAdmin
      .from('approvals')
      .update({ status: 'APPROUVE', reviewed_by: actor.id, reviewed_at: now, decision_note: decisionNote || '' })
      .eq('entity_id', cashSessionId)
      .eq('type', 'CLOTURE_CAISSE')
      .eq('status', 'EN_ATTENTE');

    const pv: ReconciliationPV = {
      id: `pv-${Date.now()}`,
      docNumber: `PV-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`,
      warehouseId: session.warehouseId,
      type: 'QUOTIDIENNE_CAISSE',
      periodLabel: `Clôture ${session.docNumber}`,
      systemValue: session.expectedCash,
      physicalOrExternalValue: session.countedCash ?? session.expectedCash,
      variance: (session.variance ?? 0),
      notes: decisionNote || session.notes || 'Clôture validée.',
      preparedBy: session.cashierName,
      signedBy: actor.name,
      signedRole: actor.role,
      signedAt: now,
    };

    await supabaseAdmin.from('reconciliations').insert([
      {
        id: pv.id,
        doc_number: pv.docNumber,
        warehouse_id: pv.warehouseId,
        type: pv.type,
        period_label: pv.periodLabel,
        system_value: pv.systemValue,
        physical_or_external_value: pv.physicalOrExternalValue,
        variance: pv.variance,
        notes: pv.notes,
        prepared_by: pv.preparedBy,
        signed_by: pv.signedBy,
        signed_role: pv.signedRole,
        signed_at: pv.signedAt,
      },
    ]);

    await this.appendAudit(
      actor,
      'CLOTURE_CAISSE_VALIDEE',
      'CashSession',
      session.id,
      session.docNumber,
      { status: session.status },
      { ...session, status: 'CLOTUREE' },
      'Web / API',
      false,
      session.warehouseId
    );

    return { session: { ...session, status: 'CLOTUREE', validatedBy: actor.id }, pv };
  }

  // ------------------------------------------------------------------
  // 7. Consignments (Return & Adjustment/Loss)
  // ------------------------------------------------------------------

  public async recordConsignmentReturn(
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
  ): Promise<ConsignmentMovement | { pendingApproval: true; approval: ApprovalRequest }> {
    this.requireAdmin();
    await this.requirePermission(actor, PERMISSIONS.CONSIGNMENT_RETURN_IN);

    const warehouseId = actor.role === 'PROPRIETAIRE'
      ? (input.warehouseId || 'wh-main')
      : actor.warehouseId || '';

    this.assertWarehouseScopeSupabase(actor, warehouseId);

    const { data: customer } = await supabaseAdmin
      .from('customers')
      .select('*')
      .eq('id', input.customerId)
      .is('deleted_at', null)
      .maybeSingle();
    if (!customer) throw new GovernanceErrorSupabase('Client introuvable.', 404);
    const cust = DepotStoreSupabase.toCamel<Customer>(
      customer as unknown as Record<string, unknown>
    );

    const pkg = await this.getPackagingById(input.packagingId);
    if (!pkg || !pkg.isReturnable) throw new GovernanceErrorSupabase('Conditionnement non consigné.', 400);

    const cratesIn = Math.max(1, Number(input.cratesIn));
    const bottlesMissing = Math.max(0, Number(input.bottlesMissing) || 0);
    const grossDeposit = cratesIn * pkg.depositPerCrate;
    const missingPenalty = bottlesMissing * pkg.depositPerBottle;
    const netRefund = Math.max(0, grossDeposit - missingPenalty);

    if (
      input.settlementMode === 'REMBOURSEMENT_CAISSE' &&
      netRefund > 50000 &&
      !(await this.hasPermission(actor, PERMISSIONS.CONSIGNMENT_LOSS_OVER))
    ) {
      const now = new Date().toISOString();
      const req: ApprovalRequest = {
        id: `apr-${Date.now()}`,
        warehouseId,
        type: 'REMBOURSEMENT_CAUTION',
        entityId: cust.id,
        docNumber: `CSG-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`,
        description: `Remboursement caution espèces > 50 000 FCFA : ${cratesIn}× ${pkg.label} pour ${cust.name}`,
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

      await supabaseAdmin.from('approvals').insert([
        {
          id: req.id,
          warehouse_id: req.warehouseId,
          type: req.type,
          entity_id: req.entityId,
          doc_number: req.docNumber,
          description: req.description,
          amount: req.amount,
          metadata: req.metadata,
          requested_by: req.requestedBy,
          requested_by_name: req.requestedByName,
          target_role: req.targetRole,
          status: req.status,
          requires_two_approvers: req.requiresTwoApprovers,
          reviewed_by: req.reviewedBy,
          reviewed_by_name: req.reviewedByName,
          reviewed_at: req.reviewedAt,
          decision_note: req.decisionNote,
          created_at: req.createdAt,
        },
      ]);

      await this.appendAudit(
        actor,
        'DEMANDE_REMBOURSEMENT_CAUTION',
        'Consignment',
        cust.id,
        req.docNumber,
        null,
        req,
        'Web / Terrain',
        false,
        warehouseId
      );

      return { pendingApproval: true, approval: req };
    }

    const now = new Date().toISOString();

    await supabaseAdmin
      .from('customers')
      .update({
        consignment_crates: Math.max(0, cust.consignmentCrates - cratesIn),
        consignment_bottles: Math.max(0, cust.consignmentBottles - (cratesIn * pkg.unitsPerPack - bottlesMissing)),
        consignment_deposit_due: Math.max(0, cust.consignmentDepositDue - grossDeposit),
        updated_at: now,
      })
      .eq('id', cust.id);

    const stk = await this.getStock(warehouseId, pkg.id);
    if (stk) {
      await supabaseAdmin
        .from('stocks')
        .update({ empty_crates_on_hand: (stk.emptyCratesOnHand || 0) + cratesIn, updated_at: now })
        .eq('id', stk.id);
    }

    const movement: ConsignmentMovement = {
      id: `csg-${Date.now()}`,
      docNumber: `CSG-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`,
      warehouseId,
      movementType: 'RETOUR_CLIENT',
      customerId: cust.id,
      supplierId: null,
      packagingId: pkg.id,
      cratesOut: 0,
      cratesIn,
      bottlesMissing,
      depositAmount: netRefund,
      settlementMode: input.settlementMode,
      referenceDoc: `RET-${cust.code}`,
      createdBy: actor.id,
      createdAt: now,
    };

    await supabaseAdmin.from('consignments').insert([
      {
        id: movement.id,
        doc_number: movement.docNumber,
        warehouse_id: movement.warehouseId,
        movement_type: movement.movementType,
        customer_id: movement.customerId,
        supplier_id: movement.supplierId,
        packaging_id: movement.packagingId,
        crates_out: movement.cratesOut,
        crates_in: movement.cratesIn,
        bottles_missing: movement.bottlesMissing,
        deposit_amount: movement.depositAmount,
        settlement_mode: movement.settlementMode,
        reference_doc: movement.referenceDoc,
        created_by: movement.createdBy,
        created_at: movement.createdAt,
      },
    ]);

    if (input.settlementMode === 'REMBOURSEMENT_CAISSE' && netRefund > 0) {
      const { data: activeCash } = await supabaseAdmin
        .from('cash_sessions')
        .select('*')
        .eq('warehouse_id', warehouseId)
        .eq('status', 'OUVERTE')
        .maybeSingle();

      if (activeCash) {
        const ac = DepotStoreSupabase.toCamel<CashSession>(
          activeCash as unknown as Record<string, unknown>
        );
        await supabaseAdmin
          .from('cash_sessions')
          .update({
            total_deposit_refunds: (ac.totalDepositRefunds || 0) + netRefund,
            expected_cash: Math.max(0, (ac.expectedCash || 0) - netRefund),
          })
          .eq('id', ac.id);
      }

      await supabaseAdmin.from('treasury').insert([
        {
          id: `trs-${Date.now()}`,
          doc_number: `TRS-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`,
          warehouse_id: warehouseId,
          wallet: 'CAISSE',
          direction: 'SORTIE',
          category: 'Remboursement caution',
          amount: netRefund,
          reference: movement.docNumber,
          description: `Retour ${cratesIn} casiers vides — ${cust.name}`,
          created_by: actor.id,
          created_at: now,
        },
      ]);
    }

    await this.appendAudit(
      actor,
      'RETOUR_CONSIGNE_CLIENT',
      'ConsignmentMovement',
      movement.id,
      movement.docNumber,
      null,
      movement,
      'Web / Terrain',
      Boolean(input.offlineOriginated),
      warehouseId
    );

    return movement;
  }

  public async requestConsignmentAdjustmentOrLoss(
    actor: UserAccount,
    input: {
      customerId: string;
      packagingId: string;
      type: 'AJUSTEMENT_CONSIGNE' | 'PERTE_CONSIGNE';
      cratesQty: number;
      reason: string;
    }
  ): Promise<ApprovalRequest> {
    this.requireAdmin();
    await this.requirePermission(actor, PERMISSIONS.CONSIGNMENT_LOSS);

    const { data: customer } = await supabaseAdmin
      .from('customers')
      .select('*')
      .eq('id', input.customerId)
      .is('deleted_at', null)
      .maybeSingle();
    if (!customer) throw new GovernanceErrorSupabase('Client introuvable.', 404);
    const cust = DepotStoreSupabase.toCamel<Customer>(
      customer as unknown as Record<string, unknown>
    );

    const pkg = await this.getPackagingById(input.packagingId);
    if (!pkg) throw new GovernanceErrorSupabase('Conditionnement introuvable.', 404);

    if (!input.reason.trim()) throw new GovernanceErrorSupabase('Motif obligatoire.', 400);

    const qty = Math.max(1, Number(input.cratesQty));
    const depositAmount = qty * pkg.depositPerCrate;
    const now = new Date().toISOString();
    const warehouseId = actor.role === 'PROPRIETAIRE' ? 'wh-main' : actor.warehouseId || '';

    const req: ApprovalRequest = {
      id: `apr-${Date.now()}`,
      warehouseId,
      type: input.type,
      entityId: cust.id,
      docNumber: `CSG-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`,
      description: `${input.type === 'PERTE_CONSIGNE' ? 'Perte / Casse client' : 'Ajustement consigne'} : ${qty}× ${pkg.label} chez ${cust.name} (${input.reason})`,
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

    await supabaseAdmin.from('approvals').insert([
      {
        id: req.id,
        warehouse_id: req.warehouseId,
        type: req.type,
        entity_id: req.entityId,
        doc_number: req.docNumber,
        description: req.description,
        amount: req.amount,
        metadata: req.metadata,
        requested_by: req.requestedBy,
        requested_by_name: req.requestedByName,
        target_role: req.targetRole,
        status: req.status,
        requires_two_approvers: req.requiresTwoApprovers,
        reviewed_by: req.reviewedBy,
        reviewed_by_name: req.reviewedByName,
        reviewed_at: req.reviewedAt,
        decision_note: req.decisionNote,
        created_at: req.createdAt,
      },
    ]);

    await this.appendAudit(
      actor,
      `DEMANDE_${input.type}`,
      'Consignment',
      cust.id,
      req.docNumber,
      null,
      req,
      'Web / API',
      false,
      warehouseId
    );

    return req;
  }

  // ------------------------------------------------------------------
  // 8. Delivery Routes (Tournées)
  // ------------------------------------------------------------------

  public async createDeliveryRoute(
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
  ): Promise<DeliveryRoute> {
    this.requireAdmin();
    await this.requirePermission(actor, PERMISSIONS.DELIVERY_PLAN);

    const warehouseId = actor.role === 'PROPRIETAIRE'
      ? (input.warehouseId || 'wh-main')
      : actor.warehouseId || '';

    this.assertWarehouseScopeSupabase(actor, warehouseId);

    const { data: driver } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', input.driverId)
      .eq('active', true)
      .is('deleted_at', null)
      .maybeSingle();
    if (!driver) throw new GovernanceErrorSupabase('Livreur introuvable.', 404);
    const driverUser = DepotStoreSupabase.toCamel<UserAccount>(
      driver as unknown as Record<string, unknown>
    );

    if (driverUser.role !== 'LIVREUR') {
      throw new GovernanceErrorSupabase(
        'Seul un utilisateur au rôle LIVREUR peut conduire une tournée.',
        400
      );
    }
    if (driverUser.warehouseId !== warehouseId) {
      throw new GovernanceErrorSupabase(
        'Le livreur sélectionné appartient à un autre dépôt.',
        403,
        'WAREHOUSE_FORBIDDEN'
      );
    }

    const now = new Date().toISOString();
    const stops: any[] = [];

    for (let idx = 0; idx < input.saleIds.length; idx++) {
      const saleId = input.saleIds[idx];
      const { data: sale } = await supabaseAdmin
        .from('sales')
        .select('*')
        .eq('id', saleId)
        .maybeSingle();
      if (!sale) throw new GovernanceErrorSupabase(`Vente ${saleId} introuvable.`, 404);
      const saleObj = DepotStoreSupabase.toCamel<Sale>(
        sale as unknown as Record<string, unknown>
      );
      if (saleObj.warehouseId !== warehouseId) {
        throw new GovernanceErrorSupabase(
          `La vente ${saleObj.docNumber} appartient à un autre dépôt.`,
          403,
          'WAREHOUSE_FORBIDDEN'
        );
      }

      const { data: cust } = await supabaseAdmin
        .from('customers')
        .select('*')
        .eq('id', saleObj.customerId)
        .maybeSingle();
      const customerName = cust
        ? (DepotStoreSupabase.toCamel<Customer>(cust as unknown as Record<string, unknown>)).name
        : 'Client';

      const crates = saleObj.lines.reduce((sum: number, l: any) => sum + l.qty, 0);

      stops.push({
        id: `stp-${Date.now()}-${idx}`,
        saleId: saleObj.id,
        saleDocNumber: saleObj.docNumber,
        customerId: saleObj.customerId,
        customerName,
        zone: cust ? (DepotStoreSupabase.toCamel<Customer>(cust as unknown as Record<string, unknown>)).zone : input.zone,
        orderIndex: idx + 1,
        cratesToDeliver: crates,
        amountDue: saleObj.creditAdded,
        status: 'PLANIFIE',
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
      });
    }

    const tourCashFloat = Math.max(0, Number(input.tourCashFloat) || 0);
    const tourEmptyCratesExpected = stops.reduce((s, st) => s + st.cratesToDeliver, 0);

    const route: DeliveryRoute = {
      id: `rte-${Date.now()}`,
      docNumber: `TRN-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`,
      warehouseId,
      driverId: driverUser.id,
      driverName: driverUser.name,
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

    const { error } = await supabaseAdmin.from('delivery_routes').insert([
      {
        id: route.id,
        doc_number: route.docNumber,
        warehouse_id: route.warehouseId,
        driver_id: route.driverId,
        driver_name: route.driverName,
        vehicle_type: route.vehicleType,
        vehicle_plate: route.vehiclePlate,
        zone: route.zone,
        route_date: route.routeDate,
        status: route.status,
        tour_cash_float: route.tourCashFloat,
        tour_cash_collected: route.tourCashCollected,
        tour_mobile_money_collected: route.tourMobileMoneyCollected,
        tour_expected_cash: route.tourExpectedCash,
        tour_handed_over_cash: route.tourHandedOverCash,
        tour_cash_variance: route.tourCashVariance,
        tour_empty_crates_expected: route.tourEmptyCratesExpected,
        tour_empty_crates_returned: route.tourEmptyCratesReturned,
        closed_by_driver_at: route.closedByDriverAt,
        validated_by_gerant_id: route.validatedByGerantId,
        validated_by_gerant_at: route.validatedByGerantAt,
        reassigned_from_driver_id: route.reassignedFromDriverId,
        created_by: route.createdBy,
        created_at: route.createdAt,
      },
    ]);
    if (error) throw new GovernanceErrorSupabase(error.message, 500, 'DB_ERROR');

    const stopRows = stops.map((s) => ({
      route_id: route.id,
      sale_id: s.saleId,
      sale_doc_number: s.saleDocNumber,
      customer_id: s.customerId,
      customer_name: s.customerName,
      zone: s.zone,
      order_index: s.orderIndex,
      crates_to_deliver: s.cratesToDeliver,
      amount_due: s.amountDue,
      status: s.status,
      delivered_at: s.deliveredAt,
      empty_crates_collected: s.emptyCratesCollected,
      cash_collected: s.cashCollected,
      payment_method_collected: s.paymentMethodCollected,
      signature_data_url: s.signatureDataUrl,
      is_non_compliant: s.isNonCompliant,
      gps_coords: s.gpsCoords,
      photo_data_url: s.photoDataUrl,
      breakage_bottles: s.breakageBottles,
      notes: s.notes,
    }));
    if (stopRows.length > 0) {
      const { error: sErr } = await supabaseAdmin.from('delivery_stops').insert(stopRows);
      if (sErr) throw new GovernanceErrorSupabase(sErr.message, 500, 'DB_ERROR');
    }

    await this.appendAudit(
      actor,
      'CREATION_TOURNEE_LIVRAISON',
      'DeliveryRoute',
      route.id,
      route.docNumber,
      null,
      route,
      'Web / API',
      false,
      warehouseId
    );

    return route;
  }

  public async completeDeliveryStop(
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
  ): Promise<DeliveryRoute> {
    this.requireAdmin();
    if (!(await this.hasPermission(actor, PERMISSIONS.BL_EMIT)) && !(await this.hasPermission(actor, PERMISSIONS.DELIVERY_COMPLETE))) {
      await this.requirePermission(actor, PERMISSIONS.BL_EMIT);
    }

    const { data: route } = await supabaseAdmin
      .from('delivery_routes')
      .select('*')
      .eq('id', routeId)
      .maybeSingle();
    if (!route) throw new GovernanceErrorSupabase('Tournée introuvable.', 404);
    const r = DepotStoreSupabase.toCamel<DeliveryRoute>(
      route as unknown as Record<string, unknown>
    );

    this.assertWarehouseScopeSupabase(actor, r.warehouseId);
    if (actor.role === 'LIVREUR' && r.driverId !== actor.id) {
      throw new GovernanceErrorSupabase(
        `Accès refusé : cette tournée appartient à ${r.driverName}.`,
        403,
        'OWN_ROUTE_FORBIDDEN'
      );
    }

    const stop = r.stops.find((s: any) => s.id === stopId);
    if (!stop) throw new GovernanceErrorSupabase('Point de livraison introuvable.', 404);
    if (stop.status === 'LIVRE' || stop.status === 'RETOUR_PARTIEL') {
      throw new GovernanceErrorSupabase('Ce point de livraison a déjà été validé.', 400);
    }

    const breakageBottles = Math.max(0, Number(input.breakageBottles) || 0);
    const targetStatus = input.status === 'RETOUR_PARTIEL' ? 'RETOUR_PARTIEL' : 'LIVRE';

    if ((targetStatus === 'RETOUR_PARTIEL' || breakageBottles > 0) && !input.photoDataUrl) {
      throw new GovernanceErrorSupabase(
        'Une photo justificative est obligatoire pour toute casse ou retour partiel en tournée.',
        400,
        'PHOTO_REQUIRED'
      );
    }

    const now = new Date().toISOString();
    const isNonCompliant = !input.signatureDataUrl;

    // Mettre à jour le stop
    await supabaseAdmin
      .from('delivery_stops')
      .update({
        status: targetStatus,
        delivered_at: now,
        empty_crates_collected: Math.max(0, Number(input.emptyCratesCollected) || 0),
        cash_collected: Math.max(0, Number(input.cashCollected) || 0),
        payment_method_collected: input.paymentMethodCollected,
        signature_data_url: input.signatureDataUrl,
        'is_non_compliant': isNonCompliant,
        gps_coords: input.gpsCoords || null,
        photo_data_url: input.photoDataUrl || null,
        breakage_bottles: breakageBottles,
        notes: input.notes || '',
      })
      .eq('id', stopId);

    // Mettre à jour les casiers du client
    const { data: cust } = await supabaseAdmin
      .from('customers')
      .select('*')
      .eq('id', stop.customerId)
      .maybeSingle();
    if (cust && stop.emptyCratesCollected > 0) {
      const customer = DepotStoreSupabase.toCamel<Customer>(
        cust as unknown as Record<string, unknown>
      );
      await supabaseAdmin
        .from('customers')
        .update({
          consignment_crates: Math.max(0, customer.consignmentCrates - stop.emptyCratesCollected),
          updated_at: now,
        })
        .eq('id', customer.id);
    }

    // Mettre à jour la tournée (mini-caisse)
    const updates: Record<string, unknown> = {};
    if (stop.cashCollected > 0) {
      const method = stop.paymentMethodCollected || 'ESPECES';
      const newCashCollected = r.tourCashCollected + stop.cashCollected;
      if (method === 'ESPECES' || method === 'CREDIT') {
        updates.tour_cash_collected = newCashCollected;
        updates.tour_expected_cash = r.tourCashFloat + newCashCollected;
      } else {
        updates.tour_mobile_money_collected = (r.tourMobileMoneyCollected || 0) + stop.cashCollected;
      }
    }

    const allStopsDelivered = r.stops.every(
      (s: any) => s.status === 'LIVRE' || s.status === 'RETOUR_PARTIEL'
    );
    if (allStopsDelivered) {
      updates.status = 'EN_ATTENTE_REMISE';
    }

    if (Object.keys(updates).length > 0) {
      await supabaseAdmin.from('delivery_routes').update(updates).eq('id', routeId);
    }

    // Créer un enregistrement de casse si nécessaire
    if (breakageBottles > 0) {
      const rb: ReturnBreakageRecord = {
        id: `rb-${Date.now()}`,
        docNumber: `CAS-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`,
        warehouseId: r.warehouseId,
        routeId: routeId,
        type: 'CASSE_COULAGE',
        customerId: stop.customerId,
        supplierId: null,
        packagingId: input.packagingIdForBreakage || 'pkg-bock-33',
        qtyPacks: 0,
        qtyBottles: breakageBottles,
        financialImpact: breakageBottles * 400,
        reason: `Casse déclarée sur tournée ${r.docNumber} (${stop.customerName}) : ${input.notes || 'transport'}`,
        photoDataUrl: input.photoDataUrl || null,
        settlement: 'PERTE_SECHE',
        status: 'EN_ATTENTE',
        createdBy: actor.id,
        validatedBy: null,
        createdAt: now,
      };

      await supabaseAdmin.from('returns_breakages').insert([
        {
          id: rb.id,
          doc_number: rb.docNumber,
          warehouse_id: rb.warehouseId,
          route_id: rb.routeId,
          type: rb.type,
          customer_id: rb.customerId,
          supplier_id: rb.supplierId,
          packaging_id: rb.packagingId,
          qty_packs: rb.qtyPacks,
          qty_bottles: rb.qtyBottles,
          financial_impact: rb.financialImpact,
          reason: rb.reason,
          photo_data_url: rb.photoDataUrl,
          settlement: rb.settlement,
          status: rb.status,
          created_by: rb.createdBy,
          validated_by: rb.validatedBy,
          created_at: rb.createdAt,
        },
      ]);

      await supabaseAdmin.from('approvals').insert([
        {
          id: `apr-${Date.now()}-brk`,
          warehouse_id: r.warehouseId,
          type: 'RETOUR_CASSE_LIVREUR',
          entity_id: rb.id,
          doc_number: rb.docNumber,
          description: `Casse tournée ${r.docNumber} (${breakageBottles} btl) — ${stop.customerName}`,
          amount: rb.financialImpact,
          metadata: { routeId, stopId },
          requested_by: actor.id,
          requested_by_name: actor.name,
          target_role: 'GERANT',
          status: 'EN_ATTENTE',
          requires_two_approvers: false,
          reviewed_by: null,
          reviewed_by_name: null,
          reviewed_at: null,
          created_at: now,
        },
      ]);
    }

    await this.appendAudit(
      actor,
      isNonCompliant ? 'LIVRAISON_NON_CONFORME_SANS_SIGNATURE' : 'VALIDATION_BON_LIVRAISON',
      'DeliveryRoute',
      routeId,
      stop.saleDocNumber,
      null,
      { stopId, status: stop.status, emptyCratesCollected: stop.emptyCratesCollected, cashCollected: stop.cashCollected, isNonCompliant },
      'Mobile Livreur',
      Boolean(input.offlineOriginated),
      r.warehouseId
    );

    return { ...r, stops: r.stops.map((s: any) => (s.id === stopId ? { ...s, status: targetStatus, deliveredAt: now, emptyCratesCollected: Math.max(0, Number(input.emptyCratesCollected) || 0), cashCollected: Math.max(0, Number(input.cashCollected) || 0), paymentMethodCollected: input.paymentMethodCollected, signatureDataUrl: input.signatureDataUrl, isNonCompliant, gpsCoords: input.gpsCoords || null, photoDataUrl: input.photoDataUrl || null, breakageBottles, notes: input.notes || '' } : s)) };
  }

  public async closeTourneeByDriver(
    actor: UserAccount,
    routeId: string,
    input: { handedOverCash: number; emptyCratesReturned: number; notes?: string }
  ): Promise<DeliveryRoute> {
    this.requireAdmin();
    await this.requirePermission(actor, PERMISSIONS.CASH_TOURNEE_CLOSE);

    const { data: route } = await supabaseAdmin
      .from('delivery_routes')
      .select('*')
      .eq('id', routeId)
      .maybeSingle();
    if (!route) throw new GovernanceErrorSupabase('Tournée introuvable.', 404);
    const r = DepotStoreSupabase.toCamel<DeliveryRoute>(
      route as unknown as Record<string, unknown>
    );

    this.assertWarehouseScopeSupabase(actor, r.warehouseId);
    if (actor.role === 'LIVREUR' && r.driverId !== actor.id) {
      throw new GovernanceErrorSupabase(
        `Accès refusé : cette tournée appartient à ${r.driverName}.`,
        403,
        'OWN_ROUTE_FORBIDDEN'
      );
    }
    if (r.status === 'CLOTUREE') {
      throw new GovernanceErrorSupabase('Cette tournée est déjà clôturée et validée par le Gérant.', 400);
    }

    const now = new Date().toISOString();
    const handedOverCash = Math.max(0, Number(input.handedOverCash) || 0);
    const emptyCratesReturned = Math.max(0, Number(input.emptyCratesReturned) || 0);
    const tourCashVariance = handedOverCash - r.tourExpectedCash;

    await supabaseAdmin
      .from('delivery_routes')
      .update({
        tour_handed_over_cash: handedOverCash,
        tour_cash_variance: tourCashVariance,
        tour_empty_crates_returned: emptyCratesReturned,
        closed_by_driver_at: now,
        status: 'EN_ATTENTE_REMISE',
      })
      .eq('id', routeId);

    await this.appendAudit(
      actor,
      'CLOTURE_MINI_CAISSE_LIVREUR',
      'DeliveryRoute',
      routeId,
      r.docNumber,
      null,
      {
        expectedCash: r.tourExpectedCash,
        handedOverCash,
        variance: tourCashVariance,
        emptyCratesReturned,
        notes: input.notes || '',
      },
      'Mobile Livreur',
      false,
      r.warehouseId
    );

    return {
      ...r,
      tourHandedOverCash: handedOverCash,
      tourCashVariance,
      tourEmptyCratesReturned: emptyCratesReturned,
      closedByDriverAt: now,
      status: 'EN_ATTENTE_REMISE',
    };
  }

  public async validateTourneeHandover(
    actor: UserAccount,
    routeId: string,
    input: { countedCash: number; emptyCratesCounted: number; notes?: string }
  ): Promise<DeliveryRoute> {
    this.requireAdmin();
    await this.requirePermission(actor, PERMISSIONS.DELIVERY_COMPLETE);

    const { data: route } = await supabaseAdmin
      .from('delivery_routes')
      .select('*')
      .eq('id', routeId)
      .maybeSingle();
    if (!route) throw new GovernanceErrorSupabase('Tournée introuvable.', 404);
    const r = DepotStoreSupabase.toCamel<DeliveryRoute>(
      route as unknown as Record<string, unknown>
    );

    this.assertWarehouseScopeSupabase(actor, r.warehouseId);
    if (r.status === 'CLOTUREE') {
      throw new GovernanceErrorSupabase('Tournée déjà clôturée.', 400);
    }

    const now = new Date().toISOString();
    const countedCash = Math.max(0, Number(input.countedCash) || 0);
    const emptyCratesCounted = Math.max(0, Number(input.emptyCratesCounted) || 0);
    const variance = countedCash - r.tourExpectedCash;

    await supabaseAdmin
      .from('delivery_routes')
      .update({
        tour_handed_over_cash: countedCash,
        tour_cash_variance: variance,
        tour_empty_crates_returned: emptyCratesCounted,
        validated_by_gerant_id: actor.id,
        validated_by_gerant_at: now,
        status: 'CLOTUREE',
      })
      .eq('id', routeId);

    if (countedCash > 0) {
      const { data: activeCash } = await supabaseAdmin
        .from('cash_sessions')
        .select('*')
        .eq('warehouse_id', r.warehouseId)
        .eq('status', 'OUVERTE')
        .maybeSingle();

      if (activeCash) {
        const ac = DepotStoreSupabase.toCamel<CashSession>(
          activeCash as unknown as Record<string, unknown>
        );
        await supabaseAdmin
          .from('cash_sessions')
          .update({ expected_cash: (ac.expectedCash || 0) + countedCash })
          .eq('id', ac.id);
      }

      await supabaseAdmin.from('treasury').insert([
        {
          id: `trs-${Date.now()}`,
          doc_number: `TRS-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`,
          warehouse_id: r.warehouseId,
          wallet: 'CAISSE',
          direction: 'ENTREE',
          category: 'Remise caisse tournée',
          amount: countedCash,
          reference: r.docNumber,
          description: `Remise espèces tournée ${r.docNumber} (${r.driverName})`,
          created_by: actor.id,
          created_at: now,
        },
      ]);
    }

    if (variance < 0) {
      await supabaseAdmin.from('approvals').insert([
        {
          id: `apr-${Date.now()}-ecart`,
          warehouse_id: r.warehouseId,
          type: 'ECART_TOURNEE',
          entity_id: routeId,
          doc_number: r.docNumber,
          description: `Manquant caisse tournée ${r.docNumber} (${r.driverName}) : ${variance.toLocaleString('fr-FR')} FCFA`,
          amount: Math.abs(variance),
          metadata: { driverId: r.driverId, expected: r.tourExpectedCash, counted: countedCash, notes: input.notes },
          requested_by: actor.id,
          requested_by_name: actor.name,
          target_role: 'PROPRIETAIRE',
          status: 'EN_ATTENTE',
          requires_two_approvers: false,
          reviewed_by: null,
          reviewed_by_name: null,
          reviewed_at: null,
          created_at: now,
        },
      ]);
    }

    await this.appendAudit(
      actor,
      'VALIDATION_REMISE_TOURNEE',
      'DeliveryRoute',
      routeId,
      r.docNumber,
      null,
      { expectedCash: r.tourExpectedCash, countedCash, variance, emptyCratesCounted, notes: input.notes || '' },
      'Web / Gérant',
      false,
      r.warehouseId
    );

    return {
      ...r,
      tourHandedOverCash: countedCash,
      tourCashVariance: variance,
      tourEmptyCratesReturned: emptyCratesCounted,
      validatedByGerantId: actor.id,
      validatedByGerantAt: now,
      status: 'CLOTUREE',
    };
  }

  // ------------------------------------------------------------------
  // 9. Credits (Payment & Write-Off)
  // ------------------------------------------------------------------

  public async recordCreditPayment(
    actor: UserAccount,
    input: {
      creditId: string;
      amount: number;
      method: Exclude<PaymentMethod, 'CREDIT'>;
      reference: string;
    }
  ): Promise<{ credit: CreditRecord; payment: CreditPayment }> {
    this.requireAdmin();
    await this.requirePermission(actor, PERMISSIONS.CREDIT_GRANT);

    const { data: crd } = await supabaseAdmin
      .from('credits')
      .select('*')
      .eq('id', input.creditId)
      .maybeSingle();
    if (!crd) throw new GovernanceErrorSupabase('Créance introuvable.', 404);
    const credit = DepotStoreSupabase.toCamel<CreditRecord>(
      crd as unknown as Record<string, unknown>
    );

    if (credit.warehouseId) {
      this.assertWarehouseScopeSupabase(actor, credit.warehouseId);
    }
    if (credit.status === 'ABANDONNE' || credit.status === 'SOLDE') {
      throw new GovernanceErrorSupabase('Cette créance est déjà clôturée.', 400);
    }

    const amount = Math.min(credit.remainingAmount, Math.max(1, Number(input.amount)));
    const now = new Date().toISOString();

    const newRemaining = credit.remainingAmount - amount;
    const newStatus = newRemaining <= 0 ? 'SOLDE' : 'PARTIEL';

    await supabaseAdmin
      .from('credits')
      .update({ remaining_amount: newRemaining, status: newStatus })
      .eq('id', input.creditId);

    const { data: cust } = await supabaseAdmin
      .from('customers')
      .select('*')
      .eq('id', credit.customerId)
      .maybeSingle();
    if (cust) {
      const customer = DepotStoreSupabase.toCamel<Customer>(
        cust as unknown as Record<string, unknown>
      );
      await supabaseAdmin
        .from('customers')
        .update({
          credit_balance: Math.max(0, customer.creditBalance - amount),
          updated_at: now,
        })
        .eq('id', customer.id);
    }

    const pay: CreditPayment = {
      id: `cp-${Date.now()}`,
      creditId: credit.id,
      customerId: credit.customerId,
      amount,
      method: input.method,
      reference: input.reference || `REG-${Date.now().toString().slice(-5)}`,
      createdBy: actor.id,
      createdAt: now,
    };

    await supabaseAdmin.from('credit_payments').insert([
      {
        id: pay.id,
        credit_id: pay.creditId,
        customer_id: pay.customerId,
        amount: pay.amount,
        method: pay.method,
        reference: pay.reference,
        created_by: pay.createdBy,
        created_at: pay.createdAt,
      },
    ]);

    const whId = credit.warehouseId || actor.warehouseId || 'wh-main';
    const { data: activeCash } = await supabaseAdmin
      .from('cash_sessions')
      .select('*')
      .eq('warehouse_id', whId)
      .eq('status', 'OUVERTE')
      .maybeSingle();

    if (activeCash && input.method === 'ESPECES') {
      const ac = DepotStoreSupabase.toCamel<CashSession>(
        activeCash as unknown as Record<string, unknown>
      );
      await supabaseAdmin
        .from('cash_sessions')
        .update({ expected_cash: (ac.expectedCash || 0) + amount })
        .eq('id', ac.id);
    }

    await supabaseAdmin.from('treasury').insert([
      {
        id: `trs-${Date.now()}`,
        doc_number: `TRS-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`,
        warehouse_id: whId,
        wallet: input.method === 'ESPECES' ? 'CAISSE' : input.method,
        direction: 'ENTREE',
        category: 'Recouvrement crédit',
        amount,
        reference: pay.reference,
        description: `Règlement ${credit.docNumber} — ${cust ? (DepotStoreSupabase.toCamel<Customer>(cust as unknown as Record<string, unknown>)).name : ''}`,
        created_by: actor.id,
        created_at: now,
      },
    ]);

    await this.appendAudit(
      actor,
      'RECOUVREMENT_CREDIT',
      'CreditRecord',
      credit.id,
      credit.docNumber,
      { remainingAmount: credit.remainingAmount, status: credit.status },
      { remainingAmount: newRemaining, amountPaid: amount },
      'Web / API',
      false,
      whId
    );

    return {
      credit: { ...credit, remainingAmount: newRemaining, status: newStatus },
      payment: pay,
    };
  }

  public async writeOffCredit(
    actor: UserAccount,
    creditId: string,
    reason: string
  ): Promise<CreditRecord> {
    this.requireAdmin();
    await this.requirePermission(actor, PERMISSIONS.CREDIT_WRITE_OFF);

    const { data: crd } = await supabaseAdmin
      .from('credits')
      .select('*')
      .eq('id', creditId)
      .maybeSingle();
    if (!crd) throw new GovernanceErrorSupabase('Créance introuvable.', 404);
    const credit = DepotStoreSupabase.toCamel<CreditRecord>(
      crd as unknown as Record<string, unknown>
    );

    if (credit.status === 'SOLDE' || credit.status === 'ABANDONNE') {
      throw new GovernanceErrorSupabase('Cette créance est déjà soldée ou abandonnée.', 400);
    }
    if (!reason?.trim()) throw new GovernanceErrorSupabase('Un motif d’abandon de créance est obligatoire.', 400);

    const now = new Date().toISOString();
    const before = { remainingAmount: credit.remainingAmount, status: credit.status };
    const writtenOffAmount = credit.remainingAmount;

    await supabaseAdmin
      .from('credits')
      .update({ remaining_amount: 0, status: 'ABANDONNE', write_off_reason: reason.trim(), written_off_by: actor.id })
      .eq('id', creditId);

    const { data: cust } = await supabaseAdmin
      .from('customers')
      .select('*')
      .eq('id', credit.customerId)
      .maybeSingle();
    if (cust) {
      const customer = DepotStoreSupabase.toCamel<Customer>(
        cust as unknown as Record<string, unknown>
      );
      await supabaseAdmin
        .from('customers')
        .update({ credit_balance: Math.max(0, customer.creditBalance - writtenOffAmount), updated_at: now })
        .eq('id', customer.id);
    }

    await this.appendAudit(
      actor,
      'ABANDON_CREANCE',
      'CreditRecord',
      credit.id,
      credit.docNumber,
      before,
      { status: 'ABANDONNE', writtenOffAmount, reason },
      'Web / API',
      false,
      credit.warehouseId ?? null
    );

    return { ...credit, remainingAmount: 0, status: 'ABANDONNE', writeOffReason: reason.trim(), writtenOffBy: actor.id };
  }

  public async requestCreditWriteOff(
    actor: UserAccount,
    creditId: string,
    reason: string
  ): Promise<ApprovalRequest> {
    this.requireAdmin();
    await this.requirePermission(actor, PERMISSIONS.CREDIT_GRANT);

    const { data: crd } = await supabaseAdmin
      .from('credits')
      .select('*')
      .eq('id', creditId)
      .maybeSingle();
    if (!crd) throw new GovernanceErrorSupabase('Créance introuvable.', 404);
    const credit = DepotStoreSupabase.toCamel<CreditRecord>(
      crd as unknown as Record<string, unknown>
    );

    if (credit.warehouseId) this.assertWarehouseScopeSupabase(actor, credit.warehouseId);
    if (!reason?.trim()) throw new GovernanceErrorSupabase('Motif obligatoire.', 400);

    const { data: custRow } = await supabaseAdmin
      .from('customers')
      .select('*')
      .eq('id', credit.customerId)
      .maybeSingle();
    const cust = custRow ? DepotStoreSupabase.toCamel<Customer>(custRow as unknown as Record<string, unknown>) : null;

    const req: ApprovalRequest = {
      id: `apr-${Date.now()}`,
      warehouseId: credit.warehouseId || actor.warehouseId || null,
      type: 'ABANDON_CREANCE',
      entityId: credit.id,
      docNumber: credit.docNumber,
      description: `Demande d’abandon de créance ${credit.docNumber} (${cust?.name || ''}) : ${reason}`,
      amount: credit.remainingAmount,
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

    await supabaseAdmin.from('approvals').insert([
      {
        id: req.id,
        warehouse_id: req.warehouseId,
        type: req.type,
        entity_id: req.entityId,
        doc_number: req.docNumber,
        description: req.description,
        amount: req.amount,
        metadata: req.metadata,
        requested_by: req.requestedBy,
        requested_by_name: req.requestedByName,
        target_role: req.targetRole,
        status: req.status,
        requires_two_approvers: req.requiresTwoApprovers,
        reviewed_by: req.reviewedBy,
        reviewed_by_name: req.reviewedByName,
        reviewed_at: req.reviewedAt,
        decision_note: req.decisionNote,
        created_at: req.createdAt,
      },
    ]);

    await this.appendAudit(
      actor,
      'DEMANDE_ABANDON_CREANCE',
      'CreditRecord',
      credit.id,
      credit.docNumber,
      null,
      req,
      'Web / API',
      false,
      req.warehouseId ?? null
    );

    return req;
  }

  // ------------------------------------------------------------------
  // 10. Inventories (Inventaire physique)
  // ------------------------------------------------------------------

  public async openInventorySession(
    actor: UserAccount,
    input: {
      warehouseId: string;
      lines: { packagingId: string; physicalQty: number }[];
    }
  ): Promise<InventorySession> {
    this.requireAdmin();
    await this.requirePermission(actor, PERMISSIONS.INVENTORY_OPEN);

    const warehouseId = actor.role === 'PROPRIETAIRE'
      ? input.warehouseId || 'wh-main'
      : actor.warehouseId || '';

    this.assertWarehouseScopeSupabase(actor, warehouseId);

    const now = new Date().toISOString();
    const scope: 'TOURNANT' | 'GENERAL' = input.lines.length > 1 ? 'GENERAL' : 'TOURNANT';

    const invLines: InventoryLine[] = input.lines.map((l) => ({
      packagingId: l.packagingId,
      theoreticalQty: 0,
      physicalQty: Math.max(0, Number(l.physicalQty) || 0),
      variance: 0,
      emptyCratesTheoretical: 0,
      emptyCratesPhysical: 0,
    }));

    // Remplir les theoreticalQty depuis le stock réel
    for (const line of invLines) {
      const stk = await this.getStock(warehouseId, line.packagingId);
      line.theoreticalQty = stk ? stk.qtyOnHand : 0;
    }

    const inv: InventorySession = {
      id: `inv-${Date.now()}`,
      docNumber: `INV-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`,
      warehouseId,
      scope,
      lines: invLines,
      status: 'BROUILLON',
      createdBy: actor.id,
      validatedBy: null,
      createdAt: now,
      validatedAt: null,
    };

    const { error } = await supabaseAdmin.from('inventories').insert([
      {
        id: inv.id,
        doc_number: inv.docNumber,
        warehouse_id: inv.warehouseId,
        scope: inv.scope,
        lines: inv.lines,
        status: inv.status,
        created_by: inv.createdBy,
        validated_by: inv.validatedBy,
        created_at: inv.createdAt,
        validated_at: inv.validatedAt,
      },
    ]);
    if (error) throw new GovernanceErrorSupabase(error.message, 500, 'DB_ERROR');

    await this.appendAudit(
      actor,
      'OUVERTURE_INVENTAIRE',
      'InventorySession',
      inv.id,
      inv.docNumber,
      null,
      inv,
      'Web / API',
      false,
      warehouseId
    );

    return inv;
  }

  public async closeInventorySession(
    actor: UserAccount,
    inventoryId: string,
    decisionNote?: string
  ): Promise<InventorySession> {
    this.requireAdmin();
    await this.requirePermission(actor, PERMISSIONS.INVENTORY_CLOSE);

    const { data: inv } = await supabaseAdmin
      .from('inventories')
      .select('*')
      .eq('id', inventoryId)
      .eq('status', 'BROUILLON')
      .maybeSingle();

    if (!inv) throw new GovernanceErrorSupabase('Session d’inventaire en brouillon introuvable.', 404);
    const inventory = DepotStoreSupabase.toCamel<InventorySession>(
      inv as unknown as Record<string, unknown>
    );

    this.assertWarehouseScopeSupabase(actor, inventory.warehouseId);

    if (inventory.validatedBy) {
      throw new GovernanceErrorSupabase('Cette session d’inventaire est déjà validée.', 400);
    }

    const now = new Date().toISOString();

    // Mettre à jour les stocks réels avec les quantités physiques
    for (const line of inventory.lines) {
      const stk = await this.getStock(inventory.warehouseId, line.packagingId);
      if (stk) {
        await supabaseAdmin
          .from('stocks')
          .update({ qty_on_hand: line.physicalQty, updated_at: now })
          .eq('id', stk.id);
      }
    }

    const updatedLines = inventory.lines.map((l) => ({
      ...l,
      variance: l.physicalQty - l.theoreticalQty,
    }));

    await supabaseAdmin
      .from('inventories')
      .update({
        validated_by: actor.id,
        validated_at: now,
        status: 'VALIDE',
        lines: updatedLines,
      })
      .eq('id', inventoryId);

    await this.appendAudit(
      actor,
      'CLOTURE_INVENTAIRE',
      'InventorySession',
      inventory.id,
      inventory.docNumber,
      { ...inventory },
      { ...inventory, status: 'VALIDE', validatedBy: actor.id },
      'Web / API',
      false,
      inventory.warehouseId
    );

    return {
      ...inventory,
      status: 'VALIDE',
      validatedBy: actor.id,
      validatedAt: now,
      lines: updatedLines,
    };
  }

  // ------------------------------------------------------------------
  // 11. Approvals (Approbations / Rejets)
  // ------------------------------------------------------------------

  public async listPendingApprovals(
    actor: UserAccount,
    warehouseId?: string
  ): Promise<ApprovalRequest[]> {
    this.requireAdmin();
    await this.requirePermission(actor, PERMISSIONS.APPROVAL_LIST);

    let q = supabaseAdmin
      .from('approvals')
      .select('*')
      .eq('status', 'EN_ATTENTE')
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (warehouseId) q = q.eq('warehouse_id', warehouseId);

    const { data, error } = await q;
    if (error) throw new GovernanceErrorSupabase(error.message, 500, 'DB_ERROR');

    return (data || []).map((d: Record<string, unknown>) =>
      DepotStoreSupabase.toCamel<ApprovalRequest>(d)
    );
  }

  public async approveRequest(
    actor: UserAccount,
    approvalId: string,
    decisionNote?: string
  ): Promise<ApprovalRequest> {
    this.requireAdmin();
    await this.requirePermission(actor, PERMISSIONS.APPROVAL_DECIDE);

    const { data: req } = await supabaseAdmin
      .from('approvals')
      .select('*')
      .eq('id', approvalId)
      .eq('status', 'EN_ATTENTE')
      .maybeSingle();

    if (!req) throw new GovernanceErrorSupabase('Demande d’approbation introuvable ou déjà traitée.', 404);

    const request = DepotStoreSupabase.toCamel<ApprovalRequest>(
      req as unknown as Record<string, unknown>
    );

    this.assertWarehouseScopeSupabase(actor, request.warehouseId);

    const now = new Date().toISOString();
    const before = { ...request };

    await supabaseAdmin
      .from('approvals')
      .update({ status: 'APPROUVE', reviewed_by: actor.id, reviewed_at: now, decision_note: decisionNote || '' })
      .eq('id', approvalId);

    // Effets métier selon le type
    await this.applyApprovalEffects(actor, request, now);

    await this.appendAudit(
      actor,
      'APPROBATION_DEMANDE',
      'ApprovalRequest',
      request.id,
      request.docNumber,
      before,
      { status: 'APPROUVE', decisionNote },
      'Web / API',
      false,
      request.warehouseId
    );

    return { ...request, status: 'APPROUVE', reviewedBy: actor.id, reviewedAt: now, decisionNote };
  }

  public async rejectRequest(
    actor: UserAccount,
    approvalId: string,
    decisionNote: string
  ): Promise<ApprovalRequest> {
    this.requireAdmin();
    await this.requirePermission(actor, PERMISSIONS.APPROVAL_DECIDE);

    const { data: req } = await supabaseAdmin
      .from('approvals')
      .select('*')
      .eq('id', approvalId)
      .eq('status', 'EN_ATTENTE')
      .maybeSingle();

    if (!req) throw new GovernanceErrorSupabase('Demande d’approbation introuvable ou déjà traitée.', 404);

    const request = DepotStoreSupabase.toCamel<ApprovalRequest>(
      req as unknown as Record<string, unknown>
    );

    this.assertWarehouseScopeSupabase(actor, request.warehouseId);

    if (!decisionNote.trim()) {
      throw new GovernanceErrorSupabase('Un motif de rejet est obligatoire.', 400);
    }

    const now = new Date().toISOString();
    const before = { ...request };

    await supabaseAdmin
      .from('approvals')
      .update({ status: 'REJETE', reviewed_by: actor.id, reviewed_at: now, decision_note: decisionNote })
      .eq('id', approvalId);

    await this.appendAudit(
      actor,
      'REJET_DEMANDE',
      'ApprovalRequest',
      request.id,
      request.docNumber,
      before,
      { status: 'REJETE', decisionNote },
      'Web / API',
      false,
      request.warehouseId
    );

    return { ...request, status: 'REJETE', reviewedBy: actor.id, reviewedAt: now, decisionNote };
  }

  private async applyApprovalEffects(
    actor: UserAccount,
    request: ApprovalRequest,
    now: string
  ): Promise<void> {
    switch (request.type) {
      case 'REMISE_EXCEPTIONNELLE': {
        // Appliquer la remise sur la vente concernée
        const { data: sale } = await supabaseAdmin
          .from('sales')
          .select('*')
          .eq('id', request.entityId)
          .maybeSingle();
        if (!sale) return;
        const s = DepotStoreSupabase.toCamel<Sale>(
          sale as unknown as Record<string, unknown>
        );
        const pct = Number(request.metadata?.discountPercent) || 0;
        const baseLiquid = s.lines.reduce((sum: number, l: any) => sum + l.lineLiquidTotal, 0);
        const discountAmount = Math.round((baseLiquid * pct) / 100);
        const newLiquid = Math.max(0, baseLiquid - discountAmount);
        const newGrandTotal = Math.max(0, newLiquid + s.depositNetTotal);

        await supabaseAdmin
          .from('sales')
          .update({
            status: 'VALIDEE',
            discount_amount: discountAmount,
            discount_reason: (request.metadata?.reason as string) || s.discountReason,
            liquid_total: newLiquid,
            grand_total: newGrandTotal,
            validated_by: actor.id,
          })
          .eq('id', request.entityId);
        break;
      }
      case 'ANNULATION_VENTE': {
        await supabaseAdmin
          .from('sales')
          .update({ status: 'ANNULEE' })
          .eq('id', request.entityId);
        break;
      }
      case 'CLOTURE_CAISSE': {
        await supabaseAdmin
          .from('cash_sessions')
          .update({ status: 'CLOTUREE', validated_by: actor.id })
          .eq('id', request.entityId);
        break;
      }
      case 'ABANDON_CREANCE': {
        await supabaseAdmin
          .from('credits')
          .update({ remaining_amount: 0, status: 'ABANDONNE' })
          .eq('id', request.entityId);
        break;
      }
      default:
        break;
    }
  }

  // ------------------------------------------------------------------
  // 12. Missing methods for server.ts compatibility
  // ------------------------------------------------------------------

  public async resetToDemo(actor?: UserAccount): Promise<DepotDatabaseSnapshot> {
    const a = actor || ({ id: 'usr-proprietaire', name: 'Propriétaire', email: 'proprietaire@gestdepot.ci', role: 'PROPRIETAIRE' as RoleCode, warehouseId: null, phone: '', address: '', active: true, pin: '', pinHash: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), deletedAt: null } as UserAccount);
    this.requireAdmin();
    await this.requirePermission(a, PERMISSIONS.SETTINGS_UPDATE);
    return this.getScopedSnapshot(a);
  }

  public async restoreSnapshot(
    snapshot: DepotDatabaseSnapshot,
    actor: UserAccount
  ): Promise<DepotDatabaseSnapshot> {
    this.requireAdmin();
    await this.requirePermission(actor, PERMISSIONS.SETTINGS_UPDATE);
    return this.getScopedSnapshot(actor);
  }

  public async isClientUuidProcessed(uuid: string): Promise<boolean> {
    const { data } = await supabaseAdmin
      .from('processed_client_uuids')
      .select('id')
      .eq('uuid', uuid)
      .maybeSingle();
    return !!data;
  }

  public async markClientUuidProcessed(uuid: string): Promise<void> {
    await supabaseAdmin.from('processed_client_uuids').insert([{ uuid }]);
  }

  public async getDeliveryRouteById(
    actor: UserAccount,
    routeId: string
  ): Promise<DeliveryRoute> {
    const { data: route } = await supabaseAdmin
      .from('delivery_routes')
      .select('*')
      .eq('id', routeId)
      .maybeSingle();
    if (!route) throw new GovernanceErrorSupabase('Tournée introuvable.', 404);
    const r = DepotStoreSupabase.toCamel<DeliveryRoute>(
      route as unknown as Record<string, unknown>
    );
    this.assertWarehouseScopeSupabase(actor, r.warehouseId);

    // Load stops
    const { data: stops } = await supabaseAdmin
      .from('delivery_stops')
      .select('*')
      .eq('route_id', routeId)
      .order('order_index', { ascending: true });
    const typedStops = (stops || []).map((s: Record<string, unknown>) =>
      DepotStoreSupabase.toCamel<DeliveryStop>(s)
    );

    return { ...r, stops: typedStops };
  }

  public async reassignDeliveryRoute(
    actor: UserAccount,
    routeId: string,
    newDriverId: string,
    reason: string
  ): Promise<DeliveryRoute> {
    this.requireAdmin();
    await this.requirePermission(actor, PERMISSIONS.DELIVERY_PLAN);

    const { data: route } = await supabaseAdmin
      .from('delivery_routes')
      .select('*')
      .eq('id', routeId)
      .maybeSingle();
    if (!route) throw new GovernanceErrorSupabase('Tournée introuvable.', 404);
    const r = DepotStoreSupabase.toCamel<DeliveryRoute>(
      route as unknown as Record<string, unknown>
    );
    this.assertWarehouseScopeSupabase(actor, r.warehouseId);

    const { data: newDriver } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', newDriverId)
      .eq('role', 'LIVREUR')
      .eq('active', true)
      .is('deleted_at', null)
      .maybeSingle();
    if (!newDriver) throw new GovernanceErrorSupabase('Nouveau livreur introuvable.', 404);
    const newDriverUser = DepotStoreSupabase.toCamel<UserAccount>(
      newDriver as unknown as Record<string, unknown>
    );

    const now = new Date().toISOString();
    await supabaseAdmin
      .from('delivery_routes')
      .update({
        driver_id: newDriverId,
        driver_name: newDriverUser.name,
        reassigned_from_driver_id: r.driverId,
      })
      .eq('id', routeId);

    await this.appendAudit(
      actor,
      'REASSIGNATION_TOURNEE',
      'DeliveryRoute',
      routeId,
      r.docNumber,
      { driverId: r.driverId },
      { newDriverId, reason },
      'Web / API',
      false,
      r.warehouseId
    );

    return { ...r, driverId: newDriverId, driverName: newDriverUser.name, reassignedFromDriverId: r.driverId };
  }

  public async submitInventorySession(
    actor: UserAccount,
    input: { warehouseId: string; lines: { packagingId: string; physicalQty: number }[] }
  ): Promise<InventorySession> {
    return this.openInventorySession(actor, input);
  }

  public async createReturnBreakage(
    actor: UserAccount,
    input: {
      warehouseId: string;
      type: ReturnBreakageRecord['type'];
      customerId?: string;
      supplierId?: string;
      packagingId: string;
      qtyPacks: number;
      qtyBottles: number;
      financialImpact: number;
      reason: string;
      photoDataUrl?: string | null;
      settlement: ReturnBreakageRecord['settlement'];
    }
  ): Promise<ReturnBreakageRecord> {
    this.requireAdmin();
    await this.requirePermission(actor, PERMISSIONS.BREAKAGE_REPORT);

    const warehouseId = actor.role === 'PROPRIETAIRE'
      ? input.warehouseId || 'wh-main'
      : actor.warehouseId || '';
    this.assertWarehouseScopeSupabase(actor, warehouseId);

    const now = new Date().toISOString();
    const rb: ReturnBreakageRecord = {
      id: `rb-${Date.now()}`,
      docNumber: `CAS-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`,
      warehouseId,
      type: input.type,
      customerId: input.customerId || null,
      supplierId: input.supplierId || null,
      packagingId: input.packagingId,
      qtyPacks: input.qtyPacks,
      qtyBottles: input.qtyBottles,
      financialImpact: input.financialImpact,
      reason: input.reason,
      photoDataUrl: input.photoDataUrl || null,
      settlement: input.settlement,
      status: 'EN_ATTENTE',
      createdBy: actor.id,
      validatedBy: null,
      createdAt: now,
    };

    await supabaseAdmin.from('returns_breakages').insert([
      {
        id: rb.id,
        doc_number: rb.docNumber,
        warehouse_id: rb.warehouseId,
        type: rb.type,
        customer_id: rb.customerId,
        supplier_id: rb.supplierId,
        packaging_id: rb.packagingId,
        qty_packs: rb.qtyPacks,
        qty_bottles: rb.qtyBottles,
        financial_impact: rb.financialImpact,
        reason: rb.reason,
        photo_data_url: rb.photoDataUrl,
        settlement: rb.settlement,
        status: rb.status,
        created_by: rb.createdBy,
        validated_by: rb.validatedBy,
        created_at: rb.createdAt,
      },
    ]);

    await this.appendAudit(
      actor,
      'CREATION_CASSE_CASSAGE',
      'ReturnBreakageRecord',
      rb.id,
      rb.docNumber,
      null,
      rb,
      'Web / API',
      false,
      warehouseId
    );

    return rb;
  }

  public async createTreasuryMovement(
    actor: UserAccount,
    input: {
      warehouseId: string;
      wallet: TreasuryWallet;
      direction: 'ENTREE' | 'SORTIE' | 'TRANSFERT';
      category: string;
      amount: number;
      reference: string;
      description: string;
    }
  ): Promise<TreasuryTransaction> {
    this.requireAdmin();
    await this.requirePermission(actor, PERMISSIONS.TREASURY_MANAGE);

    const warehouseId = actor.role === 'PROPRIETAIRE'
      ? input.warehouseId || 'wh-main'
      : actor.warehouseId || '';
    this.assertWarehouseScopeSupabase(actor, warehouseId);

    const now = new Date().toISOString();
    const tx: TreasuryTransaction = {
      id: `trs-${Date.now()}`,
      docNumber: `TRS-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`,
      warehouseId,
      wallet: input.wallet,
      direction: input.direction,
      category: input.category,
      amount: input.amount,
      reference: input.reference,
      description: input.description,
      createdBy: actor.id,
      createdAt: now,
    };

    await supabaseAdmin.from('treasury').insert([
      {
        id: tx.id,
        doc_number: tx.docNumber,
        warehouse_id: tx.warehouseId,
        wallet: tx.wallet,
        direction: tx.direction,
        category: tx.category,
        amount: tx.amount,
        reference: tx.reference,
        description: tx.description,
        created_by: tx.createdBy,
        created_at: tx.createdAt,
      },
    ]);

    await this.appendAudit(
      actor,
      'MOUVEMENT_TRESORERIE',
      'TreasuryTransaction',
      tx.id,
      tx.docNumber,
      null,
      tx,
      'Web / API',
      false,
      warehouseId
    );

    return tx;
  }

  public async createReconciliationPV(
    actor: UserAccount,
    input: {
      warehouseId: string;
      type: ReconciliationPV['type'];
      periodLabel: string;
      systemValue: number;
      physicalOrExternalValue: number;
      notes: string;
      preparedBy: string;
    }
  ): Promise<ReconciliationPV> {
    this.requireAdmin();
    await this.requirePermission(actor, PERMISSIONS.RECONCILIATION_SIGN);

    const warehouseId = actor.role === 'PROPRIETAIRE'
      ? input.warehouseId || 'wh-main'
      : actor.warehouseId || '';
    this.assertWarehouseScopeSupabase(actor, warehouseId);

    const now = new Date().toISOString();
    const pv: ReconciliationPV = {
      id: `pv-${Date.now()}`,
      docNumber: `PV-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`,
      warehouseId,
      type: input.type,
      periodLabel: input.periodLabel,
      systemValue: input.systemValue,
      physicalOrExternalValue: input.physicalOrExternalValue,
      variance: input.physicalOrExternalValue - input.systemValue,
      notes: input.notes,
      preparedBy: input.preparedBy,
      signedBy: actor.name,
      signedRole: actor.role,
      signedAt: now,
    };

    await supabaseAdmin.from('reconciliations').insert([
      {
        id: pv.id,
        doc_number: pv.docNumber,
        warehouse_id: pv.warehouseId,
        type: pv.type,
        period_label: pv.periodLabel,
        system_value: pv.systemValue,
        physical_or_external_value: pv.physicalOrExternalValue,
        variance: pv.variance,
        notes: pv.notes,
        prepared_by: pv.preparedBy,
        signed_by: pv.signedBy,
        signed_role: pv.signedRole,
        signed_at: pv.signedAt,
      },
    ]);

    await this.appendAudit(
      actor,
      'CREATION_PV_RECONCILIATION',
      'ReconciliationPV',
      pv.id,
      pv.docNumber,
      null,
      pv,
      'Web / API',
      false,
      warehouseId
    );

    return pv;
  }

  public async reviewApproval(
    actor: UserAccount,
    approvalId: string,
    decision: 'APPROUVE' | 'REJETE',
    decisionNote?: string
  ): Promise<ApprovalRequest> {
    if (decision === 'APPROUVE') {
      return this.approveRequest(actor, approvalId, decisionNote);
    }
    return this.rejectRequest(actor, approvalId, decisionNote || 'Rejeté sans motif.');
  }

  public async upsertUser(
    actor: UserAccount,
    input: {
      id?: string;
      name: string;
      email: string;
      role: RoleCode;
      warehouseId?: string;
      pin?: string;
      active?: boolean;
    }
  ): Promise<UserAccount> {
    this.requireAdmin();
    await this.requirePermission(actor, PERMISSIONS.USER_CREATE);

    const now = new Date().toISOString();
    const userId = input.id || `usr-${Date.now()}`;

    const { data: existing } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('id', userId)
      .maybeSingle();

    if (existing) {
      await supabaseAdmin
        .from('users')
        .update({
          name: input.name,
          email: input.email,
          role: input.role,
          warehouse_id: input.warehouseId || null,
          active: input.active !== undefined ? input.active : true,
          updated_at: now,
        })
        .eq('id', userId);
    } else {
      await supabaseAdmin.from('users').insert([
        {
          id: userId,
          name: input.name,
          email: input.email,
          role: input.role,
          warehouse_id: input.warehouseId || null,
          pin_hash: input.pin ? `sha256:${input.pin}` : '',
          active: input.active !== undefined ? input.active : true,
          created_at: now,
          updated_at: now,
        },
      ]);
    }

    const { data: user } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', userId)
      .maybeSingle();
    if (!user) throw new GovernanceErrorSupabase('Utilisateur introuvable après création.', 500);

    return DepotStoreSupabase.toCamel<UserAccount>(
      user as unknown as Record<string, unknown>
    );
  }

  public async updateCompanySettings(
    actor: UserAccount,
    settings: Partial<CompanySettings>
  ): Promise<CompanySettings> {
    this.requireAdmin();
    await this.requirePermission(actor, PERMISSIONS.SETTINGS_UPDATE);

    const now = new Date().toISOString();
    const { data: existing } = await supabaseAdmin
      .from('companies')
      .select('id')
      .maybeSingle();

    if (existing) {
      await supabaseAdmin
        .from('companies')
        .update({ ...settings, updated_at: now })
        .eq('id', 'company');
    } else {
      await supabaseAdmin.from('companies').insert([
        { id: 'company', ...settings, created_at: now, updated_at: now },
      ]);
    }

    const { data: company } = await supabaseAdmin
      .from('companies')
      .select('*')
      .eq('id', 'company')
      .maybeSingle();
    if (!company) throw new GovernanceErrorSupabase('Entreprise introuvable.', 500);

    return DepotStoreSupabase.toCamel<CompanySettings>(
      company as unknown as Record<string, unknown>
    );
  }

  public async subscribePush(
    actor: UserAccount,
    input: {
      endpoint: string;
      p256dh: string;
      auth: string;
      userId?: string;
    }
  ): Promise<PushSubscriptionRecord> {
    const now = new Date().toISOString();
    const sub: PushSubscriptionRecord = {
      id: `sub-${Date.now()}`,
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      userId: input.userId || actor.id,
      createdAt: now,
      active: true,
    };

    await supabaseAdmin.from('push_subscriptions').insert([
      {
        id: sub.id,
        endpoint: sub.endpoint,
        p256dh: sub.p256dh,
        auth: sub.auth,
        user_id: sub.userId,
        created_at: sub.createdAt,
        active: true,
      },
    ]);

    return sub;
  }

  public async unsubscribePush(
    actor: UserAccount,
    subscriptionId: string
  ): Promise<{ ok: boolean }> {
    await supabaseAdmin.from('push_subscriptions').delete().eq('id', subscriptionId);
    return { ok: true };
  }

  public async getPushSubscriptionsForUser(userId: string): Promise<PushSubscriptionRecord[]> {
    const { data } = await supabaseAdmin
      .from('push_subscriptions')
      .select('*')
      .eq('user_id', userId);
    return (data || []).map((d) => DepotStoreSupabase.toCamel<PushSubscriptionRecord>(d as Record<string, unknown>));
  }

  public async getAllPushSubscriptions(): Promise<PushSubscriptionRecord[]> {
    const { data } = await supabaseAdmin.from('push_subscriptions').select('*');
    return (data || []).map((d) => DepotStoreSupabase.toCamel<PushSubscriptionRecord>(d as Record<string, unknown>));
  }
}

export const depotStoreSupabase = new DepotStoreSupabase();
