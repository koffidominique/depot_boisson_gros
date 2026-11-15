import 'dotenv/config';
import express from 'express';
import path from 'path';
import * as webpush from 'web-push';
import { depotStore, GovernanceError } from './server/store.ts';
import { depotStoreSupabase } from './server/supabaseStore.ts';
import { PERMISSIONS } from './src/types/erp.ts';
import type { OfflineQueueItem, PushSubscriptionRecord, UserAccount } from './src/types/erp.ts';

const PORT = Number(process.env.PORT) || 3000;
const USE_SUPABASE = process.env.USE_SUPABASE === 'true';

// Store métier : Supabase si USE_SUPABASE=true, sinon store JSON local
const store = USE_SUPABASE ? depotStoreSupabase : depotStore;

// Clés VAPID pour les notifications push (générées au démarrage si absent)
let vapidPublicKey: string | null = null;
let vapidPrivateKey: string | null = null;

function ensureVapidKeys(): void {
  if (!vapidPublicKey || !vapidPrivateKey) {
    const keys = webpush.generateVAPIDKeys();
    vapidPublicKey = keys.publicKey;
    vapidPrivateKey = keys.privateKey;
    webpush.setVapidDetails(
      'mailto:admin@gestdepot.ci',
      vapidPublicKey,
      vapidPrivateKey
    );
    console.log('[PWA] VAPID keys generated.');
  }
}

function getVapidPublicKey(): string {
  ensureVapidKeys();
  return vapidPublicKey!;
}

async function getActor(req: express.Request): Promise<UserAccount> {
  const userId = (req.headers['x-user-id'] as string) || 'usr-proprietaire';
  return await store.getUserById(userId);
}

function handleApiError(res: express.Response, err: unknown) {
  if (err instanceof GovernanceError) {
    return res.status(err.status).json({ error: err.message, code: err.code });
  }
  const message = err instanceof Error ? err.message : 'Erreur interne du serveur';
  return res.status(500).json({ error: message, code: 'INTERNAL_ERROR' });
}

export const app = express();
app.use(express.json({ limit: '6mb' }));

export async function startServer() {
  // Health
  app.get('/api/health', async (_req, res) => {
    res.json({ ok: true, service: 'GestDepot API', timestamp: new Date().toISOString() });
  });

  // Scoped snapshot (respects Propriétaire multi-dépôts, Gérant 1 dépôt, Livreur propres tournées)
  app.get('/api/snapshot', async (req, res) => {
    try {
      const actor = await getActor(req);
      res.json(store.getScopedSnapshot(actor));
    } catch (err) {
      handleApiError(res, err);
    }
  });

  // Public profile switcher list (without PINs)
  app.get('/api/demo-profiles', async (_req, res) => {
    const snap = await store.getSnapshot();
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
  app.get('/api/auth/warehouses', async (_req, res) => {
    const snap = await store.getSnapshot();
    res.json({
      warehouses: snap.warehouses
        .filter((w) => !w.deletedAt && w.active)
        .map((w) => ({ id: w.id, name: w.name, zone: w.zone })),
    });
  });

  // Login
  app.post('/api/auth/login', async (req, res) => {
    try {
      const user = await store.authenticateUser(req.body?.identifier, req.body?.pin);
      const snapshot = await store.getScopedSnapshot(user);
      res.json({
        user: { ...user, pin: '****' },
        snapshot,
      });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  // Register
  app.post('/api/auth/register', async (req, res) => {
    try {
      const user = await store.registerUser(req.body);
      const snapshot = await store.getScopedSnapshot(user);
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
  app.post('/api/system/reset-demo', async (req, res) => {
    try {
      const actor = await getActor(req);
      await store.requirePermission(actor, PERMISSIONS.SETTINGS_UPDATE);
      const snapshot = await store.resetToDemo();
      res.json(snapshot);
    } catch (err) {
      handleApiError(res, err);
    }
  });

  // Restore backup (Propriétaire uniquement)
  app.post('/api/system/restore', async (req, res) => {
    try {
      const actor = await getActor(req);
      const snapshot = await store.restoreSnapshot(req.body, actor);
      res.json(snapshot);
    } catch (err) {
      handleApiError(res, err);
    }
  });

  // Bidirectional Offline Sync Endpoint
  app.post('/api/sync', async (req, res) => {
    try {
      const actor = await getActor(req);
      const items = (req.body?.items || []) as OfflineQueueItem[];
      const results: { id: string; status: 'SYNCED' | 'CONFLICT'; error?: string }[] = [];

      for (const item of items) {
        try {
          if (store.isClientUuidProcessed(item.id)) {
            results.push({ id: item.id, status: 'SYNCED' });
            continue;
          }
          const itemActor = item.userId ? await store.getUserById(item.userId) : actor;
          if (item.actionType === 'CREATE_SALE') {
            await store.createSale(itemActor, {
              ...(item.payload as Parameters<typeof store.createSale>[1]),
              offlineOriginated: true,
              clientTempId: item.id,
            });
          } else if (item.actionType === 'CONSIGNMENT_RETURN') {
            await store.recordConsignmentReturn(itemActor, {
              ...(item.payload as Parameters<typeof store.recordConsignmentReturn>[1]),
              offlineOriginated: true,
            });
            await store.markClientUuidProcessed(item.id);
          } else if (item.actionType === 'DELIVERY_COMPLETE') {
            const p = item.payload as {
              routeId: string;
              stopId: string;
              data: Parameters<typeof store.completeDeliveryStop>[3];
            };
            await store.completeDeliveryStop(itemActor, p.routeId, p.stopId, {
              ...p.data,
              offlineOriginated: true,
            });
            await store.markClientUuidProcessed(item.id);
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

      res.json({ results, snapshot: await store.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  // Warehouses (Propriétaire only)
  app.post('/api/warehouses', async (req, res) => {
    try {
      const actor = await getActor(req);
      const warehouse = await store.createWarehouse(actor, req.body);
      res.json({ warehouse, snapshot: await store.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  app.patch('/api/warehouses/:id', async (req, res) => {
    try {
      const actor = await getActor(req);
      const warehouse = await store.toggleWarehouseStatus(actor, req.params.id);
      res.json({ warehouse, snapshot: await store.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  // Temporary Delegations (Propriétaire only)
  app.post('/api/delegations', async (req, res) => {
    try {
      const actor = await getActor(req);
      const delegation = await store.createDelegation(actor, req.body);
      res.json({ delegation, snapshot: await store.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  app.delete('/api/delegations/:id', async (req, res) => {
    try {
      const actor = await getActor(req);
      const delegation = await store.revokeDelegation(actor, req.params.id);
      res.json({ delegation, snapshot: await store.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  // Products & Packagings
  app.post('/api/products', async (req, res) => {
    try {
      const actor = await getActor(req);
      const created = await store.createProductWithPackaging(actor, req.body);
      res.json({ created, snapshot: await store.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  app.patch('/api/packagings/:id', async (req, res) => {
    try {
      const actor = await getActor(req);
      const updated = await store.updatePackaging(actor, req.params.id, req.body);
      res.json({ updated, snapshot: await store.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  app.delete('/api/products/:id', async (req, res) => {
    try {
      const actor = await getActor(req);
      await store.softDeleteProduct(actor, req.params.id);
      res.json({ snapshot: await store.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  // Customers & Credit Limits
  app.post('/api/customers', async (req, res) => {
    try {
      const actor = await getActor(req);
      const customer = await store.upsertCustomer(actor, req.body);
      res.json({ customer, snapshot: await store.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  app.patch('/api/customers/:id/credit-limit', async (req, res) => {
    try {
      const actor = await getActor(req);
      const customer = await store.updateCustomerCreditLimit(actor, req.params.id, req.body.creditLimit);
      res.json({ customer, snapshot: await store.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  app.delete('/api/customers/:id', async (req, res) => {
    try {
      const actor = await getActor(req);
      await store.softDeleteCustomer(actor, req.params.id);
      res.json({ snapshot: await store.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  app.post('/api/customers/:id/toggle-block', async (req, res) => {
    try {
      const actor = await getActor(req);
      const customer = await store.toggleCustomerBlock(actor, req.params.id);
      res.json({ customer, snapshot: await store.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  // Suppliers
  app.post('/api/suppliers', async (req, res) => {
    try {
      const actor = await getActor(req);
      const supplier = await store.upsertSupplier(actor, req.body);
      res.json({ supplier, snapshot: await store.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  // Purchase Orders & Goods Receipts
  app.post('/api/purchase-orders', async (req, res) => {
    try {
      const actor = await getActor(req);
      const po = await store.createPurchaseOrder(actor, req.body);
      res.json({ po, snapshot: await store.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  app.post('/api/goods-receipts', async (req, res) => {
    try {
      const actor = await getActor(req);
      const gr = await store.receiveGoods(actor, req.body);
      res.json({ gr, snapshot: await store.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  // Sales & POS
  app.post('/api/sales', async (req, res) => {
    try {
      const actor = await getActor(req);
      const sale = await store.createSale(actor, req.body);
      res.json({ sale, snapshot: await store.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  app.post('/api/sales/:id/discount', async (req, res) => {
    try {
      const actor = await getActor(req);
      const result = await store.applySaleDiscount(actor, req.params.id, req.body);
      res.json({ ...result, snapshot: await store.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  app.post('/api/sales/:id/validate', async (req, res) => {
    try {
      const actor = await getActor(req);
      const sale = await store.validateSale(actor, req.params.id);
      res.json({ sale, snapshot: await store.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  app.post('/api/sales/:id/cancel-request', async (req, res) => {
    try {
      const actor = await getActor(req);
      const approval = await store.requestSaleCancellation(actor, req.params.id, req.body.reason || '');
      res.json({ approval, snapshot: await store.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  // Cash Sessions
  app.post('/api/cash-sessions/open', async (req, res) => {
    try {
      const actor = await getActor(req);
      const session = await store.openCashSession(actor, req.body.openingFloat, req.body.warehouseId);
      res.json({ session, snapshot: await store.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  app.post('/api/cash-sessions/:id/close', async (req, res) => {
    try {
      const actor = await getActor(req);
      const result = await store.closeCashSession(actor, req.params.id, req.body.countedCash, req.body.notes || '');
      res.json({ ...result, snapshot: await store.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  app.post('/api/cash-sessions/:id/validate', async (req, res) => {
    try {
      const actor = await getActor(req);
      const result = await store.validateCashSession(actor, req.params.id, req.body?.decisionNote);
      res.json({ ...result, snapshot: await store.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  // Consignments
  app.post('/api/consignments/return', async (req, res) => {
    try {
      const actor = await getActor(req);
      const result = await store.recordConsignmentReturn(actor, req.body);
      if ('pendingApproval' in result) {
        return res.json({ ...result, snapshot: await store.getScopedSnapshot(actor) });
      }
      res.json({ movement: result, snapshot: await store.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  app.post('/api/consignments/adjust-loss', async (req, res) => {
    try {
      const actor = await getActor(req);
      const approval = await store.requestConsignmentAdjustmentOrLoss(actor, req.body);
      res.json({ approval, snapshot: await store.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  // Delivery Routes & OwnRouteGuard & Mini-Caisse
  app.get('/api/deliveries/routes/:routeId', async (req, res) => {
    try {
      const actor = await getActor(req);
      const route = await store.getDeliveryRouteById(actor, req.params.routeId);
      res.json({ route });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  app.post('/api/deliveries/routes', async (req, res) => {
    try {
      const actor = await getActor(req);
      const route = await store.createDeliveryRoute(actor, req.body);
      res.json({ route, snapshot: await store.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  app.post('/api/deliveries/routes/:routeId/reassign', async (req, res) => {
    try {
      const actor = await getActor(req);
      const route = await store.reassignDeliveryRoute(
        actor,
        req.params.routeId,
        req.body.newDriverId,
        req.body.reason || ''
      );
      res.json({ route, snapshot: await store.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  app.post('/api/deliveries/routes/:routeId/stops/:stopId/complete', async (req, res) => {
    try {
      const actor = await getActor(req);
      const route = await store.completeDeliveryStop(actor, req.params.routeId, req.params.stopId, req.body);
      res.json({ route, snapshot: await store.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  app.post('/api/deliveries/routes/:routeId/close-tournee', async (req, res) => {
    try {
      const actor = await getActor(req);
      const route = await store.closeTourneeByDriver(actor, req.params.routeId, req.body);
      res.json({ route, snapshot: await store.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  app.post('/api/deliveries/routes/:routeId/validate-tournee', async (req, res) => {
    try {
      const actor = await getActor(req);
      const route = await store.validateTourneeHandover(actor, req.params.routeId, req.body);
      res.json({ route, snapshot: await store.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  // Credits & Write-off
  app.post('/api/credits/pay', async (req, res) => {
    try {
      const actor = await getActor(req);
      const result = await store.recordCreditPayment(actor, req.body);
      res.json({ ...result, snapshot: await store.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  app.post('/api/credits/:id/write-off', async (req, res) => {
    try {
      const actor = await getActor(req);
      const credit = await store.writeOffCredit(actor, req.params.id, req.body.reason || '');
      res.json({ credit, snapshot: await store.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  app.post('/api/credits/:id/write-off-request', async (req, res) => {
    try {
      const actor = await getActor(req);
      const approval = await store.requestCreditWriteOff(actor, req.params.id, req.body.reason || '');
      res.json({ approval, snapshot: await store.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  // Inventory
  app.post('/api/inventories', async (req, res) => {
    try {
      const actor = await getActor(req);
      const session = await store.submitInventorySession(actor, req.body);
      res.json({ session, snapshot: await store.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  // Returns & Breakages
  app.post('/api/returns-breakages', async (req, res) => {
    try {
      const actor = await getActor(req);
      const record = await store.createReturnBreakage(actor, req.body);
      res.json({ record, snapshot: await store.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  // Treasury
  app.post('/api/treasury', async (req, res) => {
    try {
      const actor = await getActor(req);
      const tx = await store.createTreasuryMovement(actor, req.body);
      res.json({ tx, snapshot: await store.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  // Reconciliations
  app.post('/api/reconciliations', async (req, res) => {
    try {
      const actor = await getActor(req);
      const pv = await store.createReconciliationPV(actor, req.body);
      res.json({ pv, snapshot: await store.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  // Approvals (Separation of duties)
  app.post('/api/approvals/:id/review', async (req, res) => {
    try {
      const actor = await getActor(req);
      const approval = await store.reviewApproval(actor, req.params.id, req.body.decision, req.body.decisionNote);
      res.json({ approval, snapshot: await store.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  // Audit SHA-256 Chain Verification
  app.get('/api/audit/verify', async (req, res) => {
    try {
      const actor = await getActor(req);
      if (
        !store.hasPermission(actor, PERMISSIONS.AUDIT_VIEW_ALL) &&
        !store.hasPermission(actor, PERMISSIONS.AUDIT_VIEW_WAREHOUSE) &&
        !store.hasPermission(actor, PERMISSIONS.AUDIT_VIEW_OWN)
      ) {
        await store.requirePermission(actor, PERMISSIONS.AUDIT_VIEW_ALL);
      }
      res.json(store.verifyAuditChain());
    } catch (err) {
      handleApiError(res, err);
    }
  });

  // Users & Settings
  app.post('/api/users', async (req, res) => {
    try {
      const actor = await getActor(req);
      const user = await store.upsertUser(actor, req.body);
      res.json({ user, snapshot: await store.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  app.patch('/api/settings', async (req, res) => {
    try {
      const actor = await getActor(req);
      const company = await store.updateCompanySettings(actor, req.body);
      res.json({ company, snapshot: await store.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  // Clé publique VAPID pour l'abonnement push client
  app.get("*", async (_req, res) => {
    res.json({ publicKey: getVapidPublicKey() });
  });

  // S'abonner aux notifications push
  app.post('/api/push/subscribe', async (req, res) => {
    try {
      const actor = await getActor(req);
      const sub = await store.subscribePush(actor, req.body);
      res.json({ subscription: sub, snapshot: await store.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  // Se désabonner des notifications push
  app.delete('/api/push/unsubscribe/:id', async (req, res) => {
    try {
      const actor = await getActor(req);
      const result = await store.unsubscribePush(actor, req.params.id);
      res.json({ ...result, snapshot: await store.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  // Envoyer une notification push (Propriétaire uniquement)
  app.post('/api/push/send', async (req, res) => {
    try {
      const actor = await getActor(req);
      await store.requirePermission(actor, PERMISSIONS.SETTINGS_UPDATE);

      const { userId, title, body, url } = req.body || {};
      ensureVapidKeys();
      webpush.setVapidDetails('mailto:admin@gestdepot.ci', vapidPublicKey!, vapidPrivateKey!);

      const subscriptions = userId
        ? await store.getPushSubscriptionsForUser(userId)
        : await store.getAllPushSubscriptions();

      const results: { id: string; status: 'SENT' | 'FAILED'; error?: string }[] = [];

      for (const sub of subscriptions) {
        const payload = JSON.stringify({
          title,
          body,
          url: url || '/',
          timestamp: new Date().toISOString(),
        });
        try {
          webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload
          );
          results.push({ id: sub.id, status: 'SENT' });
        } catch (err) {
          results.push({
            id: sub.id,
            status: 'FAILED',
            error: err instanceof Error ? err.message : 'Échec envoi push',
          });
          // Si l'abonnement est expiré/invalide, le désactiver
          if (err instanceof Error && ((err as { statusCode?: number }).statusCode === 410 || (err as { statusCode?: number }).statusCode === 404)) {
            await store.unsubscribePush(actor, sub.id);
          }
        }
      }

      res.json({ results, snapshot: await store.getScopedSnapshot(actor) });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  // Vite dev middleware or static production serving
  if (process.env.NODE_ENV !== 'production') {
    const viteModule = await import('vite');
    const vite = await viteModule.createServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get("*", async (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  if (!process.env.VERCEL) {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`GestDepot server listening on http://0.0.0.0:${PORT}`);
    });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startServer();
}
