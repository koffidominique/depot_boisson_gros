import type { DepotDatabaseSnapshot } from '../src/types/erp.ts';

/**
 * seedData.ts — Données de démarrage (VIDE).
 *
 * Toutes les données fictives/mock ont été supprimées. L'application utilise
 * désormais Supabase comme base de données réelle. Cette fonction retourne un
 * snapshot vide qui sert de structure initiale si aucune donnée n'existe encore.
 */

export function createInitialSeedData(): DepotDatabaseSnapshot {
  const now = new Date().toISOString();

  return {
    company: {
      companyName: '',
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
    },
    users: [],
    warehouses: [],
    delegations: [],
    suppliers: [],
    customers: [],
    products: [],
    packagings: [],
    stocks: [],
    purchaseOrders: [],
    goodsReceipts: [],
    sales: [],
    cashSessions: [],
    deliveryRoutes: [],
    consignments: [],
    credits: [],
    creditPayments: [],
    returnsBreakages: [],
    treasury: [],
    inventories: [],
    reconciliations: [],
    approvals: [],
    auditLogs: [],
    pushSubscriptions: [],
    counters: {},
    processedClientUuids: [],
  };
}
