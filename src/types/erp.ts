export type RoleCode = 'PROPRIETAIRE' | 'GERANT' | 'LIVREUR';

export const PERMISSIONS = {
  // Configuration & Gouvernance (Propriétaire uniquement)
  SETTINGS_UPDATE: 'settings.update',
  WAREHOUSE_MANAGE: 'warehouse.manage',
  USER_CREATE: 'user.create',
  USER_UPDATE: 'user.update',
  PRICE_UPDATE: 'price.update',
  CREDIT_LIMIT_UPDATE: 'credit_limit.update',
  CREDIT_WRITE_OFF: 'credit.write_off',
  AUDIT_VIEW_ALL: 'audit.view_all',
  SNAPSHOT_EXPORT: 'snapshot.export',
  APPROVAL_LIST: 'approval.list',
  APPROVAL_DECIDE: 'approval.decide',
  ACCOUNTING_EXPORT: 'accounting.export',
  DELEGATION_MANAGE: 'delegation.manage',
  SALE_CANCEL_CLOSED: 'sale.cancel_closed',
  SALE_DISCOUNT_OVER_5: 'sale.discount_over_5',
  STOCK_ADJUST_OVER_5: 'stock.adjust_over_5',
  CONSIGNMENT_LOSS_OVER: 'consignment.loss_over',
  CASH_CLOSE_VALIDATE: 'cash.close_validate',

  // Référentiel (Propriétaire + Gérant)
  PRODUCT_CREATE: 'product.create',
  PRODUCT_UPDATE: 'product.update',
  CUSTOMER_CREATE: 'customer.create',
  CUSTOMER_UPDATE: 'customer.update',

  // Opérations quotidiennes (Gérant sur son dépôt)
  PURCHASE_RECEIVE: 'purchase.receive',
  STOCK_INVENTORY: 'stock.inventory',
  INVENTORY_OPEN: 'inventory.open',
  INVENTORY_CLOSE: 'inventory.close',
  STOCK_ADJUST: 'stock.adjust',
  SALE_CREATE: 'sale.create',
  SALE_VALIDATE: 'sale.validate',
  SALE_DISCOUNT_5: 'sale.discount_5',
  SALE_CANCEL: 'sale.cancel',
  CASH_OPEN: 'cash.open',
  CASH_CLOSE: 'cash.close',
  CONSIGNMENT_SALE_OUT: 'consignment.sale_out',
  CONSIGNMENT_RETURN_IN: 'consignment.return_in',
  CONSIGNMENT_LOSS: 'consignment.loss',
  CREDIT_GRANT: 'credit.grant',
  CREDIT_BLOCK: 'credit.block',
  DELIVERY_PLAN: 'delivery.plan',
  DELIVERY_COMPLETE: 'delivery.complete',
  TREASURY_MANAGE: 'treasury.manage',
  RECONCILIATION_SIGN: 'reconciliation.sign',
  REPORT_VIEW_WAREHOUSE: 'report.view_warehouse',
  AUDIT_VIEW_WAREHOUSE: 'audit.view_warehouse',

  // Terrain (Livreur uniquement sur sa tournée)
  ROUTE_VIEW_OWN: 'route.view_own',
  BL_EMIT: 'bl.emit',
  PAYMENT_COLLECT: 'payment.collect',
  CASH_TOURNEE_CLOSE: 'cash.tournee_close',
  BREAKAGE_REPORT: 'breakage.report',
  AUDIT_VIEW_OWN: 'audit.view_own',
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ROLE_LABELS: Record<RoleCode, string> = {
  PROPRIETAIRE: 'Propriétaire (Multi-dépôts)',
  GERANT: 'Gérant de dépôt',
  LIVREUR: 'Livreur terrain',
};

export const ROLE_DESCRIPTIONS: Record<RoleCode, string> = {
  PROPRIETAIRE: 'Je vois tout, je décide, je valide — mais je n’exécute pas au comptoir.',
  GERANT: 'J’exécute tout sur mon dépôt, je valide le quotidien, je demande approbation pour le sensible.',
  LIVREUR: 'Je livre ma tournée, j’encaisse en mini-caisse isolée, je ramène les casiers.',
};

export const RBAC_MATRIX: Record<RoleCode, PermissionKey[]> = {
  // Propriétaire : voit tout, configure, exporte et valide les opérations graves — ne crée pas de ventes ni n'ouvre de caisse
  PROPRIETAIRE: [
    PERMISSIONS.SETTINGS_UPDATE,
    PERMISSIONS.WAREHOUSE_MANAGE,
    PERMISSIONS.USER_CREATE,
    PERMISSIONS.USER_UPDATE,
    PERMISSIONS.PRICE_UPDATE,
    PERMISSIONS.CREDIT_LIMIT_UPDATE,
    PERMISSIONS.CREDIT_WRITE_OFF,
    PERMISSIONS.AUDIT_VIEW_ALL,
    PERMISSIONS.ACCOUNTING_EXPORT,
    PERMISSIONS.DELEGATION_MANAGE,
    PERMISSIONS.SALE_CANCEL_CLOSED,
    PERMISSIONS.SALE_DISCOUNT_OVER_5,
    PERMISSIONS.STOCK_ADJUST_OVER_5,
    PERMISSIONS.CONSIGNMENT_LOSS_OVER,
    PERMISSIONS.CASH_CLOSE_VALIDATE,
    PERMISSIONS.PRODUCT_CREATE,
    PERMISSIONS.PRODUCT_UPDATE,
    PERMISSIONS.CUSTOMER_CREATE,
    PERMISSIONS.CUSTOMER_UPDATE,
    PERMISSIONS.STOCK_INVENTORY,
    PERMISSIONS.SALE_VALIDATE,
    PERMISSIONS.CREDIT_GRANT,
    PERMISSIONS.CREDIT_BLOCK,
    PERMISSIONS.DELIVERY_PLAN,
    PERMISSIONS.TREASURY_MANAGE,
    PERMISSIONS.RECONCILIATION_SIGN,
    PERMISSIONS.REPORT_VIEW_WAREHOUSE,
    PERMISSIONS.AUDIT_VIEW_WAREHOUSE,
  ],
  // Gérant : chef d'orchestre sur 1 dépôt unique (isolation multi-dépôts stricte)
  GERANT: [
    PERMISSIONS.PRODUCT_CREATE,
    PERMISSIONS.PRODUCT_UPDATE,
    PERMISSIONS.CUSTOMER_CREATE,
    PERMISSIONS.CUSTOMER_UPDATE,
    PERMISSIONS.PURCHASE_RECEIVE,
    PERMISSIONS.STOCK_INVENTORY,
    PERMISSIONS.STOCK_ADJUST,
    PERMISSIONS.SALE_CREATE,
    PERMISSIONS.SALE_VALIDATE,
    PERMISSIONS.SALE_DISCOUNT_5,
    PERMISSIONS.SALE_CANCEL,
    PERMISSIONS.CASH_OPEN,
    PERMISSIONS.CASH_CLOSE,
    PERMISSIONS.CONSIGNMENT_SALE_OUT,
    PERMISSIONS.CONSIGNMENT_RETURN_IN,
    PERMISSIONS.CONSIGNMENT_LOSS,
    PERMISSIONS.CREDIT_GRANT,
    PERMISSIONS.CREDIT_BLOCK,
    PERMISSIONS.DELIVERY_PLAN,
    PERMISSIONS.DELIVERY_COMPLETE,
    PERMISSIONS.TREASURY_MANAGE,
    PERMISSIONS.RECONCILIATION_SIGN,
    PERMISSIONS.REPORT_VIEW_WAREHOUSE,
    PERMISSIONS.AUDIT_VIEW_WAREHOUSE,
  ],
  // Livreur : 100% terrain, uniquement sa propre tournée + mini-caisse isolée + son audit
  LIVREUR: [
    PERMISSIONS.ROUTE_VIEW_OWN,
    PERMISSIONS.BL_EMIT,
    PERMISSIONS.PAYMENT_COLLECT,
    PERMISSIONS.CASH_TOURNEE_CLOSE,
    PERMISSIONS.BREAKAGE_REPORT,
    PERMISSIONS.AUDIT_VIEW_OWN,
  ],
};

export interface Delegation {
  id: string;
  fromUserId: string;
  fromUserName: string;
  toUserId: string;
  toUserName: string;
  permissionCode: PermissionKey;
  warehouseId: string | null;
  startsAt: string;
  endsAt: string;
  reason: string;
  revokedAt: string | null;
  createdAt: string;
}

export interface UserAccount {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: RoleCode;
  pin: string;
  active: boolean;
  // Null uniquement pour PROPRIETAIRE (transverse multi-dépôts); obligatoire pour GERANT & LIVREUR
  warehouseId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface Warehouse {
  id: string;
  name: string;
  zone: string;
  address: string;
  active: boolean;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export type ProductCategory = 'BIERE' | 'SODA' | 'EAU' | 'ENERGISANT' | 'JUS_SIROP';
export type PackagingType = 'CASIER_CONSIGNE' | 'PACK_PET' | 'CARTON_CANETTES';

export interface Packaging {
  id: string;
  productId: string;
  sku: string;
  label: string;
  packagingType: PackagingType;
  unitsPerPack: number;
  isReturnable: boolean;
  depositPerCrate: number;
  depositPerBottle: number;
  purchasePrice: number;
  salePriceDetail: number;
  salePriceSemiGros: number;
  salePriceGros: number;
  alertThreshold: number;
  dlcRequired: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface Product {
  id: string;
  name: string;
  brand: string;
  supplierId: string;
  category: ProductCategory;
  volumeLabel: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface ProductStock {
  id: string;
  warehouseId: string;
  packagingId: string;
  qtyOnHand: number;
  qtyReserved: number;
  emptyCratesOnHand: number;
  qtyConsignedOut?: number;
  nextDlc: string | null;
  lotNumber: string;
  updatedAt: string;
}

export type CustomerCategory = 'MAQUIS' | 'BAR_RESTO' | 'BOUTIQUE' | 'SEMI_GROSSISTE' | 'PARTICULIER';
export type PricingTier = 'GROS' | 'SEMI_GROS' | 'DETAIL';

export interface Customer {
  id: string;
  code: string;
  name: string;
  category: CustomerCategory;
  pricingTier: PricingTier;
  phone: string;
  zone: string;
  creditLimit: number;
  creditBalance: number;
  isBlocked?: boolean;
  consignmentCrates: number;
  consignmentBottles: number;
  consignmentDepositDue: number;
  lastCrateOutDate: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface Supplier {
  id: string;
  code: string;
  name: string;
  contactName: string;
  phone: string;
  paymentTermsDays: number;
  cratesHeldFromSupplier: number;
  depositPaidToSupplier: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface PurchaseOrderLine {
  packagingId: string;
  qtyOrdered: number;
  unitPurchasePrice: number;
  depositPerCrate: number;
}

export interface PurchaseOrder {
  id: string;
  docNumber: string;
  supplierId: string;
  warehouseId: string;
  status: 'BROUILLON' | 'ENVOYE' | 'PARTIEL' | 'RECU';
  lines: PurchaseOrderLine[];
  totalLiquid: number;
  totalDeposit: number;
  expectedDate: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface GoodsReceiptLine {
  packagingId: string;
  qtyOrdered: number;
  qtyReceived: number;
  discrepancyQty: number;
  discrepancyReason: string;
  emptyCratesReturnedToSupplier: number;
}

export interface GoodsReceipt {
  id: string;
  docNumber: string;
  purchaseOrderId: string;
  supplierId: string;
  supplierBlNumber: string;
  warehouseId: string;
  lines: GoodsReceiptLine[];
  cratesReceived: number;
  cratesReturnedToSupplier: number;
  netDepositChange: number;
  receivedBy: string;
  createdAt: string;
}

export type PaymentMethod =
  | 'ESPECES'
  | 'ORANGE_MONEY'
  | 'MTN_MOMO'
  | 'WAVE'
  | 'MOOV_MONEY'
  | 'CREDIT';

export interface PaymentSplit {
  method: PaymentMethod;
  amount: number;
  reference?: string;
}

export interface SaleLine {
  packagingId: string;
  qty: number;
  unitPrice: number;
  lineLiquidTotal: number;
  depositCharged: number;
  emptyCratesReturnedNow: number;
}

export interface Sale {
  id: string;
  docNumber: string;
  ticketNumber: string;
  customerId: string;
  warehouseId: string;
  cashSessionId: string;
  lines: SaleLine[];
  discountAmount: number;
  discountReason?: string;
  liquidTotal: number;
  depositNetTotal: number;
  grandTotal: number;
  payments: PaymentSplit[];
  creditAdded: number;
  status: 'VALIDEE' | 'ANNULEE' | 'EN_ATTENTE_VALIDATION';
  deliveryRequired: boolean;
  offlineOriginated?: boolean;
  clientTempId?: string;
  createdBy: string;
  validatedBy?: string;
  createdAt: string;
  deletedAt: string | null;
}

export interface CashSession {
  id: string;
  docNumber: string;
  cashierId: string;
  cashierName: string;
  warehouseId: string;
  openedAt: string;
  closedAt: string | null;
  openingFloat: number;
  expectedCash: number;
  countedCash: number | null;
  variance: number | null;
  totalCashSales: number;
  totalMobileMoney: number;
  totalCreditSales: number;
  totalDepositRefunds: number;
  totalExpenses: number;
  status: 'OUVERTE' | 'EN_ATTENTE_VALIDATION' | 'CLOTUREE';
  closedBy?: string;
  validatedBy?: string;
  notes?: string;
}

export type VehicleType = 'TRICYCLE' | 'PICKUP' | 'CAMIONNETTE';

export interface DeliveryStop {
  id: string;
  saleId: string;
  saleDocNumber: string;
  customerId: string;
  customerName: string;
  zone: string;
  orderIndex: number;
  cratesToDeliver: number;
  amountDue: number;
  status: 'PLANIFIE' | 'EN_COURS' | 'LIVRE' | 'RETOUR_PARTIEL';
  deliveredAt: string | null;
  emptyCratesCollected: number;
  cashCollected: number;
  paymentMethodCollected: PaymentMethod | null;
  signatureDataUrl: string | null;
  isNonCompliant?: boolean;
  gpsCoords?: string | null;
  photoDataUrl?: string | null;
  breakageBottles?: number;
  notes: string;
}

export interface DeliveryRoute {
  id: string;
  docNumber: string;
  warehouseId: string;
  driverId: string;
  driverName: string;
  vehicleType: VehicleType;
  vehiclePlate: string;
  zone: string;
  routeDate: string;
  status: 'PLANIFIEE' | 'EN_TOURNEE' | 'EN_ATTENTE_REMISE' | 'CLOTUREE';
  stops: DeliveryStop[];
  // Mini-caisse de tournée isolée (fonds initial 0 par défaut)
  tourCashFloat: number;
  tourCashCollected: number;
  tourMobileMoneyCollected: number;
  tourExpectedCash: number;
  tourHandedOverCash: number | null;
  tourCashVariance: number | null;
  tourEmptyCratesExpected: number;
  tourEmptyCratesReturned: number | null;
  closedByDriverAt: string | null;
  validatedByGerantId: string | null;
  validatedByGerantAt: string | null;
  reassignedFromDriverId?: string | null;
  createdBy: string;
  createdAt: string;
}

export interface ConsignmentMovement {
  id: string;
  docNumber: string;
  warehouseId?: string;
  movementType:
    | 'SORTIE_VENTE'
    | 'RETOUR_CLIENT'
    | 'RECEPTION_BRASSERIE'
    | 'RETOUR_BRASSERIE'
    | 'CASSE_CONSIGNE';
  customerId: string | null;
  supplierId: string | null;
  packagingId: string;
  cratesOut: number;
  cratesIn: number;
  bottlesMissing: number;
  depositAmount: number;
  settlementMode: 'REMBOURSEMENT_CAISSE' | 'AVOIR_CLIENT' | 'CAUTION_DUE' | 'BRASSERIE';
  referenceDoc: string;
  createdBy: string;
  createdAt: string;
}

export interface CreditRecord {
  id: string;
  docNumber: string;
  warehouseId?: string;
  customerId: string;
  saleId: string;
  saleDocNumber: string;
  originalAmount: number;
  remainingAmount: number;
  dueDate: string;
  status: 'OUVERT' | 'PARTIEL' | 'SOLDE' | 'EN_RETARD' | 'ABANDONNE';
  writeOffReason?: string;
  writtenOffBy?: string;
  createdAt: string;
}

export interface CreditPayment {
  id: string;
  creditId: string;
  customerId: string;
  amount: number;
  method: Exclude<PaymentMethod, 'CREDIT'>;
  reference: string;
  createdBy: string;
  createdAt: string;
}

export interface ReturnBreakageRecord {
  id: string;
  docNumber: string;
  warehouseId?: string;
  routeId?: string | null;
  type: 'RETOUR_CLIENT' | 'RETOUR_FOURNISSEUR' | 'CASSE_COULAGE';
  customerId: string | null;
  supplierId: string | null;
  packagingId: string;
  qtyPacks: number;
  qtyBottles: number;
  financialImpact: number;
  reason: string;
  photoDataUrl?: string | null;
  settlement: 'AVOIR' | 'REMBOURSEMENT' | 'PERTE_SECHE' | 'RECLAMATION';
  status: 'EN_ATTENTE' | 'VALIDE';
  createdBy: string;
  validatedBy: string | null;
  createdAt: string;
}

export type TreasuryWallet = 'CAISSE' | 'ORANGE_MONEY' | 'MTN_MOMO' | 'WAVE' | 'MOOV_MONEY' | 'BANQUE';

export interface TreasuryTransaction {
  id: string;
  docNumber: string;
  warehouseId?: string;
  wallet: TreasuryWallet;
  direction: 'ENTREE' | 'SORTIE' | 'TRANSFERT';
  targetWallet?: TreasuryWallet;
  category: string;
  amount: number;
  reference: string;
  description: string;
  createdBy: string;
  createdAt: string;
}

export interface InventoryLine {
  packagingId: string;
  theoreticalQty: number;
  physicalQty: number;
  variance: number;
  emptyCratesTheoretical: number;
  emptyCratesPhysical: number;
}

export interface InventorySession {
  id: string;
  docNumber: string;
  warehouseId: string;
  scope: 'TOURNANT' | 'GENERAL';
  lines: InventoryLine[];
  status: 'BROUILLON' | 'EN_ATTENTE_VALIDATION' | 'VALIDE';
  createdBy: string;
  validatedBy: string | null;
  createdAt: string;
  validatedAt: string | null;
}

export interface ReconciliationPV {
  id: string;
  docNumber: string;
  warehouseId?: string;
  type: 'QUOTIDIENNE_CAISSE' | 'HEBDOMADAIRE_STOCK' | 'MENSUELLE_BRASSERIE';
  periodLabel: string;
  systemValue: number;
  physicalOrExternalValue: number;
  variance: number;
  notes: string;
  preparedBy: string;
  signedBy: string;
  signedRole: RoleCode;
  signedAt: string;
}

export interface ApprovalRequest {
  id: string;
  warehouseId?: string | null;
  type:
    | 'REMISE_EXCEPTIONNELLE'
    | 'ANNULATION_VENTE'
    | 'AJUSTEMENT_INVENTAIRE'
    | 'DEBLOCAGE_CREDIT'
    | 'ABANDON_CREANCE'
    | 'REMBOURSEMENT_CAUTION'
    | 'AJUSTEMENT_CONSIGNE'
    | 'PERTE_CONSIGNE'
    | 'CLOTURE_CAISSE'
    | 'RETOUR_CASSE_LIVREUR'
    | 'ECART_TOURNEE';
  entityId: string;
  docNumber: string;
  description: string;
  amount: number;
  metadata?: Record<string, unknown>;
  requestedBy: string;
  requestedByName: string;
  targetRole: RoleCode;
  status: 'EN_ATTENTE' | 'APPROUVE' | 'REJETE';
  requiresTwoApprovers?: boolean;
  reviewedBy: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  decisionNote?: string | null;
  secondReviewerId?: string | null;
  secondReviewerName?: string | null;
  secondReviewedAt?: string | null;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  timestamp: string;
  userId: string;
  userName: string;
  userRole: RoleCode;
  warehouseId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  documentNumber: string;
  before: unknown;
  after: unknown;
  deviceInfo: string;
  offlineOriginated: boolean;
  prevHash?: string;
  hash?: string;
}

export interface CompanySettings {
  companyName: string;
  nccNumber: string;
  taxRegime: string;
  tvaRatePercent: number;
  currency: 'XOF';
  dailySalesTarget?: number;
  autoValidateSaleThreshold: number;
  cashVarianceAlertThreshold: number;
  consignmentOverdueDays: number;
  highDepositRefundThreshold: number;
  maxCashierDiscountPercent: number;
  mobileMoneyProviders: {
    orangeMoneyMerchant: string;
    mtnMomoMerchant: string;
    waveMerchant: string;
    moovMerchant: string;
  };
}

export interface OfflineQueueItem {
  id: string;
  createdAt: string;
  actionType: 'CREATE_SALE' | 'CONSIGNMENT_RETURN' | 'DELIVERY_COMPLETE' | 'CASH_SESSION_ACTION';
  payload: Record<string, unknown>;
  userId: string;
  summary: string;
  status: 'PENDING' | 'SYNCED' | 'CONFLICT';
  errorMessage?: string;
}

export interface PushSubscriptionRecord {
  id: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  createdAt: string;
  active: boolean;
}

export interface DepotDatabaseSnapshot {
  company: CompanySettings;
  users: UserAccount[];
  warehouses: Warehouse[];
  delegations: Delegation[];
  suppliers: Supplier[];
  customers: Customer[];
  products: Product[];
  packagings: Packaging[];
  stocks: ProductStock[];
  purchaseOrders: PurchaseOrder[];
  goodsReceipts: GoodsReceipt[];
  sales: Sale[];
  cashSessions: CashSession[];
  deliveryRoutes: DeliveryRoute[];
  consignments: ConsignmentMovement[];
  credits: CreditRecord[];
  creditPayments: CreditPayment[];
  returnsBreakages: ReturnBreakageRecord[];
  treasury: TreasuryTransaction[];
  inventories: InventorySession[];
  reconciliations: ReconciliationPV[];
  approvals: ApprovalRequest[];
  auditLogs: AuditLog[];
  pushSubscriptions: PushSubscriptionRecord[];
  counters: Record<string, number>;
  processedClientUuids?: string[];
}
