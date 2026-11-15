import 'dotenv/config';
import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { depotStore, GovernanceError } from './server/store.ts';
import { PERMISSIONS } from './src/types/erp.ts';
import type { OfflineQueueItem, UserAccount } from './src/types/erp.ts';

const PORT = Number(process.env.PORT) || 3000;

function getActor(req: express.Request): UserAccount {
  const userId = (req.headers['x-user-id'] as string) || 'usr-proprietaire';
  return depotStore.getUserById(userId);
}

function handleApiError(res: express.Response, err: unknown) {
  if (err instanceof GovernanceError) {
    return res.status(err.status).json({ error: err.message, code: err.code });
  }
  const message = err instanceof Error ? err.message : 'Erreur interne du serveur';
  return res.status(500).json({ error: message, code: 'INTERNAL_ERROR' });
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '6mb' }));

  // Health
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'GestDepot API', timestamp: new Date().toISOString() });
  });

  // Scoped snapshot (respects Propriétaire multi-dépôts, Gérant 1 dépôt, Livreur propres tournées)
  app.get('/api/snapshot', (req, res) => {
    try {
      const actor = getActor(req);
      res.json(depotStore.getScopedSnapshot(actor));
    } catch (err) {
      handleApiError(res, err);
    }
  });

  // Public profile switcher list (without PINs)
  app.get('/api/demo-profiles', (_req, res) => {
    const snap = depotStore.getSnapshot();
    res.json({
      profiles: snap.users
        .filter((u) => !u.deletedAt && u.active)
        .map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          role: u.role,
          warehouseId: u.warehouseId,
        })),
    });
  });

  // Public active warehouses list for registration form
  app.get('/api/auth/warehouses', (_req, res) => {
    const snap = depotStore.getSnapshot();
    res.json({
      warehouses: snap.warehouses
        .filter((w) => !w.deletedAt && w.active)
        .map((w) => ({ id: w.id, name: w.name, zone: w.zone })),
    });
  });

  // Login
  app.post('/api/auth/login', (req, res) => {
    try {
      const user = depotStore.authenticateUser(req.body?.identifier, req.body?.pin);
      const snapshot = depotStore.getScopedSnapshot(user);
      res.json({
        user: { ...user, pin: '****' },
        snapshot,
      });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  // Register
  app.post('/api/auth/register', (req, res) => {
    try {
      const user = depotStore.registerUser(req.body);
      const snapshot = depotStore.getScopedSnapshot(user);
      res.status(201).json({
        user: { ...user, pin: '****' },
        snapshot,
      });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  // Logout
  app.post('/api/auth/logout', (_req, res) => {
    res.json({ ok: true });
  });

  // Reset demo data (Propriétaire uniquement)
  app.post('/api/system/reset-demo', (req, res) => {
    try {
      const actor = getActor(req);
      depotStore.requirePermission(actor, PERMISSIONS.SETTINGS_UPDATE);
      const snapshot = depotStore.resetToDemo();
      res.json(snapshot);
    } catch (err) {
      handleApiError(res, err);
    }
  });

  // Restore backup (Propriétaire uniquement)
  app.post('/api/system/restore', (req, res) => {
    try {
      const actor = getActor(req);
      const snapshot = depotStore.restoreSnapshot(req.body, actor);
      res.json(snapshot);
    } catch (err) {
      handleApiError(res, err);
    }
  });

  // Bidirectional Offline Sync Endpoint
  app.post('/api/sync', (req, res) => {
    try {
      const actor = getActor(req);
      const items = (req.body?.items || []) as OfflineQueueItem[];
      const results: { id: string; status: 'SYNCED' | 'CONFLICT'; error?: string }[] = [];

      for (const item of items) {
        try {
          if (depotStore.isClientUuidProcessed(item.id)) {
            results.push({ id: item.id, status: 'SYNCED' });
            continue;
          }
          const itemActor = item.userId ? depotStore.getUserById(item.userId) : actor;
          if (item.actionType === 'CREATE_SALE') {
            depotStore.createSale(itemActor, {
              ...(item.payload as Parameters<typeof depotStore.createSale>[1]),
              offlineOriginated: true,
              clientTempId: item.id,
            });
          } else if (item.actionType === 'CONSIGNMENT_RETURN') {
            depotStore.recordConsignmentReturn(itemActor, {
              ...(item.payload as Parameters<typeof depotStore.recordConsignmentReturn>[1]),
              offlineOriginated: true,
            });
            depotStore.markClientUuidProcessed(item.id);
          } else if (item.actionType === 'DELIVERY_COMPLETE') {
            const p = item.payload as {
              routeId: string;
              stopId: string;
              data: Parameters<typeof depotStore.completeDeliveryStop>[3];
            };
            depotStore.completeDeliveryStop(itemActor, p.routeId, p.stopId, {
              ...p.data,
              offlineOriginated: true,
            });
            depotStore.markClientUuidProcessed(item.id);
          }
          results.push({ id: item.id, status: 'SYNCED' });
        } catch (itemErr) {
          results.push({
            id: item.id,
            status: 'CONFLICT',
            error: itemErr instanceof Error ? itemErr.message : 'Conflit de synchronisation',
          });
        }
      }

      res.json({ results, snapshot: depotStore.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  // Warehouses (Propriétaire only)
  app.post('/api/warehouses', (req, res) => {
    try {
      const actor = getActor(req);
      const warehouse = depotStore.createWarehouse(actor, req.body);
      res.json({ warehouse, snapshot: depotStore.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  app.patch('/api/warehouses/:id', (req, res) => {
    try {
      const actor = getActor(req);
      const warehouse = depotStore.toggleWarehouseStatus(actor, req.params.id);
      res.json({ warehouse, snapshot: depotStore.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  // Temporary Delegations (Propriétaire only)
  app.post('/api/delegations', (req, res) => {
    try {
      const actor = getActor(req);
      const delegation = depotStore.createDelegation(actor, req.body);
      res.json({ delegation, snapshot: depotStore.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  app.delete('/api/delegations/:id', (req, res) => {
    try {
      const actor = getActor(req);
      const delegation = depotStore.revokeDelegation(actor, req.params.id);
      res.json({ delegation, snapshot: depotStore.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  // Products & Packagings
  app.post('/api/products', (req, res) => {
    try {
      const actor = getActor(req);
      const created = depotStore.createProductWithPackaging(actor, req.body);
      res.json({ created, snapshot: depotStore.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  app.patch('/api/packagings/:id', (req, res) => {
    try {
      const actor = getActor(req);
      const updated = depotStore.updatePackaging(actor, req.params.id, req.body);
      res.json({ updated, snapshot: depotStore.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  app.delete('/api/products/:id', (req, res) => {
    try {
      const actor = getActor(req);
      depotStore.softDeleteProduct(actor, req.params.id);
      res.json({ snapshot: depotStore.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  // Customers & Credit Limits
  app.post('/api/customers', (req, res) => {
    try {
      const actor = getActor(req);
      const customer = depotStore.upsertCustomer(actor, req.body);
      res.json({ customer, snapshot: depotStore.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  app.patch('/api/customers/:id/credit-limit', (req, res) => {
    try {
      const actor = getActor(req);
      const customer = depotStore.updateCustomerCreditLimit(actor, req.params.id, req.body.creditLimit);
      res.json({ customer, snapshot: depotStore.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  app.delete('/api/customers/:id', (req, res) => {
    try {
      const actor = getActor(req);
      depotStore.softDeleteCustomer(actor, req.params.id);
      res.json({ snapshot: depotStore.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  app.post('/api/customers/:id/toggle-block', (req, res) => {
    try {
      const actor = getActor(req);
      const customer = depotStore.toggleCustomerBlock(actor, req.params.id);
      res.json({ customer, snapshot: depotStore.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  // Suppliers
  app.post('/api/suppliers', (req, res) => {
    try {
      const actor = getActor(req);
      const supplier = depotStore.upsertSupplier(actor, req.body);
      res.json({ supplier, snapshot: depotStore.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  // Purchase Orders & Goods Receipts
  app.post('/api/purchase-orders', (req, res) => {
    try {
      const actor = getActor(req);
      const po = depotStore.createPurchaseOrder(actor, req.body);
      res.json({ po, snapshot: depotStore.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  app.post('/api/goods-receipts', (req, res) => {
    try {
      const actor = getActor(req);
      const gr = depotStore.receiveGoods(actor, req.body);
      res.json({ gr, snapshot: depotStore.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  // Sales & POS
  app.post('/api/sales', (req, res) => {
    try {
      const actor = getActor(req);
      const sale = depotStore.createSale(actor, req.body);
      res.json({ sale, snapshot: depotStore.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  app.post('/api/sales/:id/discount', (req, res) => {
    try {
      const actor = getActor(req);
      const result = depotStore.applySaleDiscount(actor, req.params.id, req.body);
      res.json({ ...result, snapshot: depotStore.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  app.post('/api/sales/:id/validate', (req, res) => {
    try {
      const actor = getActor(req);
      const sale = depotStore.validateSale(actor, req.params.id);
      res.json({ sale, snapshot: depotStore.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  app.post('/api/sales/:id/cancel-request', (req, res) => {
    try {
      const actor = getActor(req);
      const approval = depotStore.requestSaleCancellation(actor, req.params.id, req.body.reason || '');
      res.json({ approval, snapshot: depotStore.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  // Cash Sessions
  app.post('/api/cash-sessions/open', (req, res) => {
    try {
      const actor = getActor(req);
      const session = depotStore.openCashSession(actor, req.body.openingFloat, req.body.warehouseId);
      res.json({ session, snapshot: depotStore.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  app.post('/api/cash-sessions/:id/close', (req, res) => {
    try {
      const actor = getActor(req);
      const result = depotStore.closeCashSession(actor, req.params.id, req.body.countedCash, req.body.notes || '');
      res.json({ ...result, snapshot: depotStore.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  app.post('/api/cash-sessions/:id/validate', (req, res) => {
    try {
      const actor = getActor(req);
      const result = depotStore.validateCashSession(actor, req.params.id, req.body?.decisionNote);
      res.json({ ...result, snapshot: depotStore.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  // Consignments
  app.post('/api/consignments/return', (req, res) => {
    try {
      const actor = getActor(req);
      const result = depotStore.recordConsignmentReturn(actor, req.body);
      if ('pendingApproval' in result) {
        return res.json({ ...result, snapshot: depotStore.getScopedSnapshot(actor) });
      }
      res.json({ movement: result, snapshot: depotStore.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  app.post('/api/consignments/adjust-loss', (req, res) => {
    try {
      const actor = getActor(req);
      const approval = depotStore.requestConsignmentAdjustmentOrLoss(actor, req.body);
      res.json({ approval, snapshot: depotStore.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  // Delivery Routes & OwnRouteGuard & Mini-Caisse
  app.get('/api/deliveries/routes/:routeId', (req, res) => {
    try {
      const actor = getActor(req);
      const route = depotStore.getDeliveryRouteById(actor, req.params.routeId);
      res.json({ route });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  app.post('/api/deliveries/routes', (req, res) => {
    try {
      const actor = getActor(req);
      const route = depotStore.createDeliveryRoute(actor, req.body);
      res.json({ route, snapshot: depotStore.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  app.post('/api/deliveries/routes/:routeId/reassign', (req, res) => {
    try {
      const actor = getActor(req);
      const route = depotStore.reassignDeliveryRoute(
        actor,
        req.params.routeId,
        req.body.newDriverId,
        req.body.reason || ''
      );
      res.json({ route, snapshot: depotStore.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  app.post('/api/deliveries/routes/:routeId/stops/:stopId/complete', (req, res) => {
    try {
      const actor = getActor(req);
      const route = depotStore.completeDeliveryStop(actor, req.params.routeId, req.params.stopId, req.body);
      res.json({ route, snapshot: depotStore.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  app.post('/api/deliveries/routes/:routeId/close-tournee', (req, res) => {
    try {
      const actor = getActor(req);
      const route = depotStore.closeTourneeByDriver(actor, req.params.routeId, req.body);
      res.json({ route, snapshot: depotStore.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  app.post('/api/deliveries/routes/:routeId/validate-tournee', (req, res) => {
    try {
      const actor = getActor(req);
      const route = depotStore.validateTourneeHandover(actor, req.params.routeId, req.body);
      res.json({ route, snapshot: depotStore.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  // Credits & Write-off
  app.post('/api/credits/pay', (req, res) => {
    try {
      const actor = getActor(req);
      const result = depotStore.recordCreditPayment(actor, req.body);
      res.json({ ...result, snapshot: depotStore.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  app.post('/api/credits/:id/write-off', (req, res) => {
    try {
      const actor = getActor(req);
      const credit = depotStore.writeOffCredit(actor, req.params.id, req.body.reason || '');
      res.json({ credit, snapshot: depotStore.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  app.post('/api/credits/:id/write-off-request', (req, res) => {
    try {
      const actor = getActor(req);
      const approval = depotStore.requestCreditWriteOff(actor, req.params.id, req.body.reason || '');
      res.json({ approval, snapshot: depotStore.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  // Inventory
  app.post('/api/inventories', (req, res) => {
    try {
      const actor = getActor(req);
      const session = depotStore.submitInventorySession(actor, req.body);
      res.json({ session, snapshot: depotStore.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  // Returns & Breakages
  app.post('/api/returns-breakages', (req, res) => {
    try {
      const actor = getActor(req);
      const record = depotStore.createReturnBreakage(actor, req.body);
      res.json({ record, snapshot: depotStore.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  // Treasury
  app.post('/api/treasury', (req, res) => {
    try {
      const actor = getActor(req);
      const tx = depotStore.createTreasuryMovement(actor, req.body);
      res.json({ tx, snapshot: depotStore.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  // Reconciliations
  app.post('/api/reconciliations', (req, res) => {
    try {
      const actor = getActor(req);
      const pv = depotStore.createReconciliationPV(actor, req.body);
      res.json({ pv, snapshot: depotStore.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  // Approvals (Separation of duties)
  app.post('/api/approvals/:id/review', (req, res) => {
    try {
      const actor = getActor(req);
      const approval = depotStore.reviewApproval(actor, req.params.id, req.body.decision, req.body.decisionNote);
      res.json({ approval, snapshot: depotStore.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  // Audit SHA-256 Chain Verification
  app.get('/api/audit/verify', (req, res) => {
    try {
      const actor = getActor(req);
      if (
        !depotStore.hasPermission(actor, PERMISSIONS.AUDIT_VIEW_ALL) &&
        !depotStore.hasPermission(actor, PERMISSIONS.AUDIT_VIEW_WAREHOUSE) &&
        !depotStore.hasPermission(actor, PERMISSIONS.AUDIT_VIEW_OWN)
      ) {
        depotStore.requirePermission(actor, PERMISSIONS.AUDIT_VIEW_ALL);
      }
      res.json(depotStore.verifyAuditChain());
    } catch (err) {
      handleApiError(res, err);
    }
  });

  // Users & Settings
  app.post('/api/users', (req, res) => {
    try {
      const actor = getActor(req);
      const user = depotStore.upsertUser(actor, req.body);
      res.json({ user, snapshot: depotStore.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  app.patch('/api/settings', (req, res) => {
    try {
      const actor = getActor(req);
      const company = depotStore.updateCompanySettings(actor, req.body);
      res.json({ company, snapshot: depotStore.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  // Vite dev middleware or static production serving
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`GestDepot server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
