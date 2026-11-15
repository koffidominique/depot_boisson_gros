# RAPPORT D'ANALYSE COMPLÈTE — PROJET `depot_boisson_gros`

**Produit :** GestDepot — ERP & Caisse terrain pour Dépôts de Boissons (Côte d’Ivoire)  
**Branche analysée :** `arena/7feb5f46-depot-boisson-gros` (basée sur `main`, commit `b162711`)  
**Statut :** actif, working tree propre, 1 seul commit d’initialisation  
**Dernier passage santé :** `npm install` ✅ · `tsc --noEmit` ✅ (0 erreur) · `vite build` ✅ (PWA générée)

---

## 1. Identité & Positionnement

GestDepot est une application **ERP omnicanal et caisse terrain « offline-first »** destinée aux dépôts de boissons en Côte d’Ivoire. Elle couvre la chaîne complète : catalogue produits/conditionnements, stocks multi-dépôts, achats/réceptions brasseries, ventes comptoir & POS, tournées de livraison (tricycle/pickup), consignes casiers/bouteilles, crédits clients, recouvrement, trésorerie, inventaires, réconciliations de caisse, gouvernance RBAC et journal d’audit crypté.

Contexte métier fortement localisé : devises en **FCFA (XOF)**, opérateurs Mobile Money ivoiriens (Orange Money, MTN MoMo, Wave, Moov Money), brasseries SOLIBRA / BRASSIVOIRE, zones d’Abidjan (Yopougon, Abobo, Cocody), produits Bock, Castel, 33 Export, Drogba, World Cola, Orangina, Awa, Lifa, Ferox.

---

## 2. Stack Technique

| Couche | Technologie | Version | Rôle |
|--------|-------------|---------|------|
| Langage | TypeScript | 7 (tsconfig) | Typage strict, `noEmit`, paths `@/*` |
| Frontend | React | 19.0.1 | SPA, rendu client |
| Build tool | Vite | 8.3.0 | Dev server + build production (Rolldown) |
| Styling | Tailwind CSS | 4.3.3 (`@tailwindcss/vite`) | Design system, dark mode, tickets 80 mm |
| Animations | motion | 12.23.24 | Transitions de modules, micro-interactions |
| Icônes | lucide-react | 0.546.0 | UI |
| Backend | Express | 4.21.2 | API REST, serveur unifié (dev via vite middleware, prod via `dist/`) |
| Runtime serveur | tsx | 4.21.0 | `tsx server.ts` en dev |
| IA | @google/genai | 2.4.0 | Gemini (capacité déclarée `MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API`) |
| PWA | vite-plugin-pwa | 2.0.0 | Service Worker Workbox, précache 15 entrées, installable |
| Stockage hors-ligne | IndexedDB (+ localStorage fallback) | — | Snapshot cache + file d’attente de sync |
| Base de données | Fichier JSON plat | `data/gestdepot-db.json` | Persistance fichier (save atomique `.tmp` → rename) |

Scripts `package.json` : `dev` (`tsx server.ts`), `build` (`vite build`), `start` (`node server.ts`), `lint` (`tsc --noEmit`), `clean`.

---

## 3. Architecture Globale

### 3.1 Couche serveur (`server.ts` + `server/store.ts`)
Un seul fichier Express de 632 lignes expose toute l’API REST (`/api/*`). La logique métier réside dans `server/store.ts` (2 914 lignes, classe `DepotStore`) qui manipule un snapshot JSON chargé depuis `data/gestdepot-db.json`.

**Points d’architecture notables :**
- **Authentification par en-tête** `X-User-Id` (pas de JWT/cookie : modèle démo mono-session, acteur résolu côté serveur).
- **Snapshot scopé par rôle :** `getScopedSnapshot(actor)` filtre les données selon le profil (Propriétaire = tout ; Gérant = son dépôt seulement ; Livreur = ses tournées, prix d’achat masqués, aucune donnée financière globale).
- **Chaîne d’audit SHA-256 :** chaque mutation ajoute un `AuditLog` en tête de liste, chaîné par `prevHash`/`hash` depuis la genèse `GENESIS_GESTDEPOT_2026`. Endpoint `/api/audit/verify` recompute et valide l’intégrité.
- **Déduplication hors-ligne** via `processedClientUuids` (clientTempId) pour éviter les doubles créations de vente après reconnexion.
- **Soft-delete** partout (`deletedAt`), pas de suppression dure.

### 3.2 Couche client (`src/`)
- `main.tsx` : racine React + enregistrement du Service Worker PWA.
- `App.tsx` (626 lignes) : shell applicatif — barre latérale responsive, switcher de profils, bannière délégation, bannière hors-ligne, bouton de sync, bouton caisse rapide, toast stack, impression tickets 80 mm (`@page ticket80mm`).
- `context/ErpContext.tsx` (736 lignes) : provider global gérant authentification, snapshot, hors-ligne, file d’attente de synchronisation, mutations API (`mutateApi`), notifications, thème.
- `src/modules/` : 14 vues métiers (voir §4).
- `src/lib/` : `offlineDb.ts` (IndexedDB), `format.ts` (FCFA, dates FR, export CSV), `feedback.ts` (bips/vibrations caisse).

---

## 4. Modules Fonctionnels (14 vues)

| # | Module | Vue(s) | Couverture métier |
|---|--------|--------|-------------------|
| 1 | Tableau de bord | `DashboardView` | KPIs, cible de ventes, alertes |
| 2 | Ventes / Caisse POS | `PosSalesView` | Panier, multi-paiement (espèces/OM/MoMo/Wave/Crédit), remises, tickets, scan |
| 3 | Livraisons & Tournées | `DeliveriesView` | Création tournée, arrêt livraison, encaissement tournée, mini-caisse isolée, casse/retour partiel avec photo |
| 4 | Consignes Casiers | `ConsignmentsView` | Entrée/sortie consigne, retours clients, remboursement caution / avoir |
| 5 | Produits & Conditionnements | `ProductsStockView` (`ProductsView`) | Catalogue, tarifs par tarif (détail/semi-gros/gros), cautions |
| 6 | Stock & Inventaires | `ProductsStockView` (`StockView`) | Stocks par dépôt, inventaire tournant/général, seuils d’alerte |
| 7 | Achats & Réceptions | `PurchasesSuppliersView` (`PurchasesView`) | Bons de commande, réceptions BL, écarts, dépôts-consigne fournisseurs |
| 8 | Fournisseurs / Brasseries | `PurchasesSuppliersView` (`SuppliersView`) | SOLIBRA, BRASSIVOIRE, conditions de paiement, consignes tenues |
| 9 | Clients | `CustomersCreditsView` (`CustomersView`) | Fiche client, catégorie, tranche tarifaire, blocage crédit |
| 10 | Crédits & Balance âgée | `CustomersCreditsView` (`CreditsView`) | Créances, échéances, retards, recouvrement, abandon de créance |
| 11 | Retours & Casse / Trésorerie | `TreasuryReturnsView` (`ReturnsBreakagesView`, `TreasuryView`) | Casse/coulage, retours client/fournisseur, mouvements de caisse, transferts portefeuille |
| 12 | Rapports & Exports | `GovernanceReportsView` (`ReportsView`) | Exports CSV, rapports d’activité |
| 13 | Utilisateurs & RBAC | `GovernanceReportsView` (`UsersRbacView`) | Création utilisateurs, rôles, délégations temporaires |
| 14 | Journal d’audit | `GovernanceReportsView` (`AuditLogsView`) | Consultation des logs, vérification chaîne SHA-256 |
| 15 | Paramétrage | `GovernanceReportsView` (`SettingsView`) | Paramètres société (NCC, TVA, seuils), gestion des dépôts |

---

## 5. Modèle de Données (`DepotDatabaseSnapshot`)

22 collections dans le snapshot JSON :

**Référentiel** : `company`, `users`, `warehouses`, `delegations`, `suppliers`, `customers`, `products`, `packagings`, `stocks`  
**Achats** : `purchaseOrders`, `goodsReceipts`  
**Ventes & Caisse** : `sales`, `cashSessions`, `treasury`, `reconciliations`  
**Livraison** : `deliveryRoutes` (+ `stops`)  
**Consigne & Crédit** : `consignments`, `credits`, `creditPayments`  
**Retours / Qualité** : `returnsBreakages`  
**Inventaire & Gouvernance** : `inventories`, `approvals`, `auditLogs`  
**Système** : `counters` (numérotation des documents FAC/TKT/BDC/BLF/TRN/CSG/CRE/CAS/TRS/INV/PV/CAI/DEM), `processedClientUuids`

Chaque document porte un `docNumber` préfixé (ex: `FAC-2026-0301`, `TRN-2026-0084`, `PV-2026-0029`).

---

## 6. Sécurité & Gouvernance (points forts du projet)

### 6.1 RBAC à 3 profils stricts
- **PROPRIETAIRE** : multi-dépôts, configuration, utilisateurs, prix, plafonds de crédit, écritures sensibles, validation des clôtures de caisse, audit global. *Ne crée pas de ventes ni n’ouvre de caisse (séparation des tâches).*
- **GERANT** : un seul dépôt attribué ; exécute l’opérationnel quotidien (ventes, achats, caisse, tournées, inventaire) ; valide dans ses seuils ; demande approbation Propriétaire au-delà.
- **LIVREUR** : 100 % terrain, uniquement ses propres tournées (`OwnRouteGuard`), mini-caisse isolée, prix d’achat masqués, aucun accès financier global.

### 6.2 Mécanismes de contrôle
- **Délégations temporaires** (Propriétaire → Gérant) avec fenêtre de validité et scopage dépôt.
- **Séparation des tâches** : impossible de valider sa propre clôture de caisse ou sa propre demande d’approbation.
- **Seuils** : remise max caissier (5 %), seuil de validation vente Gérant (200 000 FCFA), écart inventaire > 5 % requiert approbation, remboursement caution > seuil requiert approbation.
- **Chaîne d’audit SHA-256** immuable, vérifiable via `/api/audit/verify`.
- **Soft-delete** et protection des comptes systémes (ex: « Client Comptoir » non bloquable, dépôt principal non désactivable).

---

## 7. Mode Hors-Ligne & PWA

- **PWA installable** (manifest, icônes 192/512, maskable, service worker Workbox, `registerSW` immédiat).
- **Cache snapshot** dans IndexedDB (`gestdepot_offline_db`) avec fallback `localStorage` → login et consultation hors-ligne possibles sur données en cache.
- **File d’attente de sync** (`/api/sync`) : opérations `CREATE_SALE`, `CONSIGNMENT_RETURN`, `DELIVERY_COMPLETE` mises en file `PENDING`, rejouées à la reconnexion avec détection de conflits (`CONFLICT`).
- **Bannière hors-ligne** et bouton de synchronisation manuelle dans le shell.
- **Feedback sensoriel caisse** (bips scan/erreur/vente, vibration) via Web Audio API.

---

## 8. Endpoints API Principaux

`GET /api/health` — `GET /api/snapshot` — `GET /api/demo-profiles` — `GET /api/auth/warehouses` — `POST /api/auth/login|register|logout` — `POST /api/system/reset-demo|restore` — `POST /api/sync` — `POST /api/warehouses` — `PATCH /api/warehouses/:id` — `POST /api/delegations` — `DELETE /api/delegations/:id` — `POST /api/products` — `PATCH /api/packagings/:id` — `DELETE /api/products/:id` — `POST /api/customers` (+ crédit, blocage, suppression) — `POST /api/suppliers` — `POST /api/purchase-orders` — `POST /api/goods-receipts` — `POST /api/sales` (+ discount, validate, cancel-request) — `POST /api/cash-sessions/open|close|validate` — `POST /api/consignments/return|adjust-loss` — `POST /api/deliveries/routes` (+ reassign, stop complete, close-tournee, validate-tournee) — `POST /api/credits/pay|write-off|write-off-request` — `POST /api/inventories` — `POST /api/returns-breakages` — `POST /api/treasury` — `POST /api/reconciliations` — `POST /api/approvals/:id/review` — `GET /api/audit/verify` — `POST /api/users` — `PATCH /api/settings`

Chaque mutation retourne le snapshot (ou le snapshot scopé) pour resynchroniser le client.

---

## 9. Données de Démarrage (Seed — `server/seedData.ts`)

Jeu réaliste préchargé :
- **2 dépôts** : Yopougon (principal) et Abobo (annexe).
- **6 utilisateurs** : 1 Propriétaire (Koffi Dominique, PIN 0000), 2 Gérants (Bamba Sékou / Koné Awa), 3 Livreurs (Diallo Moussa, Coulibaly Ibrahim, Touré Bakary).
- **2 fournisseurs** : SOLIBRA, BRASSIVOIRE.
- **8 clients** avec crédits, encours et consignes ouvertes (Maquis Le Privilège, Chez Tantie Béa, Éts Kouadio & Frères, Boutique La Paix, Espace Lounge Cocody, Alimentation Soleil d’Abobo + comptoir passant).
- **14 produits × 14 conditionnements** (casier consigné, pack PET, carton canettes) avec prix d’achat/vente 3 tarifs et cautions.
- **Stocks initialisés** sur les 2 dépôts, DLC, numéros de lot.
- **3 bons de commande** (1 reçu, 2 envoyés), **1 réception** avec écarts, **3 sessions de caisse** (1 clôturée validée, 2 ouvertes), **6 ventes**, **3 tournées** en cours, **4 mouvements de consigne**, **5 crédits** (dont 3 en retard), **1 retours/casse**, **8 mouvements de trésorerie**, **1 inventaire**, **1 PV de rapprochement**, **1 approbation en attente** (remise 8 %), **3 logs d’audit** déjà chaînés.

---

## 10. État de Santé & Qualité

| Vérification | Résultat |
|--------------|----------|
| `npm install` (legacy-peer-deps) | ✅ 479 paquets |
| `tsc --noEmit` | ✅ 0 erreur de typage |
| `vite build` (production) | ✅ 682 ms, PWA + SW générés, 1 warning chunk > 500 kB (index JS) |
| Working tree | ✅ propre, 1 commit |

**Remarque :** le projet utilise un fichier `bun.lock` mais l’environnement ne dispose que de `npm`/`node` ; l’installation nécessite `--legacy-peer-deps` à cause d’un conflit de peer sur `vite@8` (déclaré `^8.3.0` alors que certains plugins visent `^5.2.0 || ^6 || ^7 || ^8`). Ceci est purement une contrainte d’outillage, pas un défaut métier.

---

## 11. Limites & Points d’Attention

1. **Authentification légère** : identification par `X-User-Id` sans jeton ni expiration — adapté à une démo / monoposte, insuffisant pour un multi-utilisateurs distant sans ajout d’auth (JWT/session).
2. **Base JSON fichier** : pas de véritable SGBD ; concurrence d’écriture non verrouillée (risque si plusieurs processus écrivent `gestdepot-db.json` simultanément).
3. **Gros bundle client** (~709 kB JS minifié) — le warning de chunk > 500 kB suggère un code-splitting par module pour les gros écrans de gouvernance.
4. **`typescript@^7.0.2`** dans `devDependencies` est inhabituel (la version stable publique est 5.x) — à vérifier selon le registre visé.
5. **Pas de tests** (ni unitaires, ni d’intégration, ni E2E) dans le repo.
6. **`@google/genai`** est déclaré mais je n’ai pas trouvé d’appel effectif dans le code parcouru — capacité IA déclarée dans `metadata.json` mais usage à confirmer.

---

## 12. Recommandations (pistes d’évolution)

- Ajouter une authentification JWT/cookie sécurisée et remplacer l’en-tête `X-User-Id` par un sujet vérifié.
- Migrer le stockage JSON vers SQLite (ou Supabase, app connectée dans ce contexte) pour la concurrence et l’intégrité relationnelle.
- Implémenter le code-splitting dynamique des modules de gouvernance pour réduire le bundle initial.
- Ajouter une suite de tests (vitest + supertest sur les endpoints `/api/`).
- Compléter l’usage de `@google/genai` (ex: assistant vocal caisse, prédiction de stock) si la capacité IA doit être activée.
- Documenter les PIN par défaut du seed (0000/1111/4444…) pour les démonstrations.

---

**En résumé :** GestDepot est un ERP métier complet, déjà très avancé pour un projet initialisé en un seul commit, avec une modélisation domaine soignée (multi-dépôts, consignes, crédits, tournées, chaîne d’audit SHA-256, hors-ligne PWA). Le code est cohérent, typé, et compile/build proprement. Les prochains investissements prioritaires concernent l’authentification, la base de données et la couverture de tests.