import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertCircle,
  ArrowRight,
  Building2,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Mail,
  Moon,
  Phone,
  ShieldCheck,
  Sun,
  Truck,
  User,
  UserPlus,
  WifiOff,
} from 'lucide-react';
import { useErp } from '../context/ErpContext';
import { ROLE_DESCRIPTIONS, ROLE_LABELS, type RoleCode } from '../types/erp';

const DEMO_CARDS: {
  id: string;
  name: string;
  role: RoleCode;
  email: string;
  pin: string;
  scope: string;
}[] = [
  {
    id: 'usr-proprietaire',
    name: 'Koffi Dominique',
    role: 'PROPRIETAIRE',
    email: 'koffi.dominique@gestdepot.ci',
    pin: '0000',
    scope: 'Multi-dépôts · Gouvernance',
  },
  {
    id: 'usr-gerant',
    name: 'Bamba Sékou',
    role: 'GERANT',
    email: 'bamba.sekou@gestdepot.ci',
    pin: '1111',
    scope: 'Dépôt Yopougon · Caisse & Stock',
  },
  {
    id: 'usr-livreur',
    name: 'Diallo Moussa',
    role: 'LIVREUR',
    email: 'diallo.moussa@gestdepot.ci',
    pin: '4444',
    scope: 'Tournée · Mini-caisse terrain',
  },
];

export const AuthView: React.FC = () => {
  const {
    login,
    register,
    quickDemoLogin,
    authWarehouses,
    isOnline,
    darkMode,
    toggleDarkMode,
  } = useErp();

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [imgFailed, setImgFailed] = useState(false);

  // Login fields
  const [identifier, setIdentifier] = useState('bamba.sekou@gestdepot.ci');
  const [loginPin, setLoginPin] = useState('1111');
  const [showLoginPin, setShowLoginPin] = useState(false);

  // Register fields
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPhone, setRegPhone] = useState('+225 07 ');
  const [regRole, setRegRole] = useState<RoleCode>('GERANT');
  const [regWarehouseId, setRegWarehouseId] = useState<string>('');
  const [regPin, setRegPin] = useState('');
  const [regPinConfirm, setRegPinConfirm] = useState('');
  const [showRegPin, setShowRegPin] = useState(false);

  useEffect(() => {
    if (!regWarehouseId && authWarehouses.length > 0) {
      setRegWarehouseId(authWarehouses[0].id);
    }
  }, [authWarehouses, regWarehouseId]);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!identifier.trim() || !loginPin.trim()) {
      setErrorMsg('Veuillez saisir votre identifiant et votre code PIN / mot de passe.');
      return;
    }
    setSubmitting(true);
    const res = await login(identifier, loginPin);
    setSubmitting(false);
    if (!res.ok) {
      setErrorMsg(res.error || 'Connexion refusée.');
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (regName.trim().length < 2) {
      setErrorMsg('Veuillez indiquer votre nom complet.');
      return;
    }
    if (!regEmail.includes('@')) {
      setErrorMsg('Adresse email professionnelle invalide.');
      return;
    }
    if (regPhone.trim().length < 6) {
      setErrorMsg('Numéro de téléphone invalide.');
      return;
    }
    if (regPin.trim().length < 4) {
      setErrorMsg('Le code PIN / mot de passe doit contenir au moins 4 caractères.');
      return;
    }
    if (regPin.trim() !== regPinConfirm.trim()) {
      setErrorMsg('La confirmation du code PIN ne correspond pas.');
      return;
    }
    if (regRole !== 'PROPRIETAIRE' && !regWarehouseId) {
      setErrorMsg('Sélectionnez un dépôt d’affectation pour ce profil.');
      return;
    }

    setSubmitting(true);
    const res = await register({
      name: regName.trim(),
      email: regEmail.trim(),
      phone: regPhone.trim(),
      pin: regPin.trim(),
      role: regRole,
      warehouseId: regRole === 'PROPRIETAIRE' ? null : regWarehouseId,
    });
    setSubmitting(false);
    if (!res.ok) {
      setErrorMsg(res.error || 'Inscription impossible.');
    }
  };

  return (
    <div className="grid min-h-screen grid-cols-1 bg-slate-50 text-slate-900 lg:grid-cols-12 dark:bg-slate-950 dark:text-slate-100">
      {/* Left Brand & Domain Showcase Panel */}
      <div className="relative flex flex-col justify-between overflow-hidden bg-slate-900 p-8 text-white lg:col-span-5 lg:p-12">
        {!imgFailed && (
          <img
            src="/src/assets/images/casiers_bouteilles_depot_1794729186392.jpg"
            alt="Entrepôt de boissons et casiers consignés"
            referrerPolicy="no-referrer"
            onError={() => setImgFailed(true)}
            className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-25"
          />
        )}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-900/90 to-slate-900/80" />

        <div className="relative z-10 flex items-center justify-between">
          <span className="font-display text-2xl font-bold tracking-tight text-white">
            GestDepot
          </span>
          <span className="font-mono text-xs text-emerald-400">ERP · XOF</span>
        </div>

        <div className="relative z-10 my-10 space-y-6">
          <div className="space-y-3">
            <p className="text-xs font-semibold tracking-wide text-emerald-400">
              Distribution & Dépôts de Boissons
            </p>
            <h1 className="font-display text-3xl font-bold leading-tight tracking-tight text-white sm:text-4xl">
              Maîtrisez vos caisses, casiers consignés et tournées terrain.
            </h1>
            <p className="max-w-md text-sm leading-relaxed text-slate-300">
              Une plateforme unifiée conçue pour les dépôts de Côte d’Ivoire : facturation rapide au comptoir, suivi des emballages brasserie, mini-caisses livreurs et gouvernance multi-dépôts.
            </p>
          </div>

          <div className="space-y-3 border-t border-slate-800 pt-6 text-xs text-slate-300">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
              <div>
                <p className="font-semibold text-white">Gouvernance 3 profils & séparation des tâches</p>
                <p className="text-slate-400">Propriétaire multi-dépôts, Gérant d’agence et Livreur isolé sur sa tournée.</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
              <div>
                <p className="font-semibold text-white">Consignes casiers & stocks en temps réel</p>
                <p className="text-slate-400">Calcul automatique des cautions, alertes de rupture et réceptions brasserie.</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Truck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
              <div>
                <p className="font-semibold text-white">Mode terrain offline-first</p>
                <p className="text-slate-400">Ventes POS et signatures de livraison enregistrées localement puis synchronisées.</p>
              </div>
            </div>
          </div>
        </div>

        <div className="relative z-10 flex flex-wrap items-center gap-2 text-xs text-slate-400">
          <span>Dépôt Lagunes Distribution</span>
          <span aria-hidden="true">·</span>
          <span>Journal d’audit SHA-256</span>
          <span aria-hidden="true">·</span>
          <span>Synchronisation IndexedDB</span>
        </div>
      </div>

      {/* Right Authentication Workspace */}
      <div className="flex flex-col justify-between p-6 sm:p-10 lg:col-span-7 lg:p-14">
        <div className="flex items-center justify-between">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {!isOnline ? (
              <span className="inline-flex items-center gap-1.5 font-semibold text-amber-700 dark:text-amber-400">
                <WifiOff className="h-3.5 w-3.5" />
                Mode hors-ligne détecté (connexion par cache local disponible)
              </span>
            ) : (
              <span>Accès sécurisé · Serveur actif</span>
            )}
          </div>
          <button
            type="button"
            onClick={toggleDarkMode}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
            aria-label="Basculer thème clair ou sombre"
          >
            {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </div>

        <div className="mx-auto my-8 w-full max-w-lg">
          {/* Segmented Switch: Connexion / Inscription */}
          <div className="mb-6 flex items-center gap-1 rounded-xl bg-slate-200/70 p-1 dark:bg-slate-900">
            {(
              [
                ['login', 'Connexion'],
                ['register', 'Créer un compte'],
              ] as const
            ).map(([tabKey, label]) => {
              const active = mode === tabKey;
              return (
                <button
                  key={tabKey}
                  type="button"
                  onClick={() => {
                    setMode(tabKey);
                    setErrorMsg(null);
                  }}
                  className={`relative min-h-[42px] flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition-colors whitespace-nowrap ${
                    active
                      ? 'text-slate-900 dark:text-white'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="authTabIndicator"
                      transition={{ type: 'spring', stiffness: 450, damping: 32 }}
                      className="absolute inset-0 rounded-lg bg-white shadow-sm dark:bg-slate-800"
                    />
                  )}
                  <span className="relative z-10">{label}</span>
                </button>
              );
            })}
          </div>

          <AnimatePresence>
            {errorMsg && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="mb-5 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-semibold text-red-900 dark:border-red-900/70 dark:bg-red-950/50 dark:text-red-200"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
                <span>{errorMsg}</span>
              </motion.div>
            )}
          </AnimatePresence>

          {mode === 'login' ? (
            <motion.div
              key="login-panel"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8 dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="mb-6">
                <h2 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
                  Connexion à votre espace
                </h2>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Entrez votre email professionnel (ou téléphone) et votre code PIN d’accès.
                </p>
              </div>

              <form onSubmit={handleLoginSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Email professionnel ou téléphone
                  </label>
                  <div className="relative mt-1.5">
                    <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={identifier}
                      onChange={(e) => setIdentifier(e.target.value)}
                      placeholder="nom@gestdepot.ci ou +225 07..."
                      autoComplete="username"
                      className="min-h-[44px] w-full rounded-lg border border-slate-200 bg-slate-50 pl-10 pr-3 text-sm text-slate-900 focus:border-emerald-600 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Code PIN / Mot de passe
                  </label>
                  <div className="relative mt-1.5">
                    <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      type={showLoginPin ? 'text' : 'password'}
                      value={loginPin}
                      onChange={(e) => setLoginPin(e.target.value)}
                      placeholder="••••"
                      autoComplete="current-password"
                      className="min-h-[44px] w-full rounded-lg border border-slate-200 bg-slate-50 pl-10 pr-11 font-mono text-sm text-slate-900 focus:border-emerald-600 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    />
                    <button
                      type="button"
                      onClick={() => setShowLoginPin((v) => !v)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                      aria-label={showLoginPin ? 'Masquer le code' : 'Afficher le code'}
                    >
                      {showLoginPin ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex min-h-[46px] w-full items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-800 disabled:opacity-60"
                >
                  <span>{submitting ? 'Vérification...' : 'Se connecter'}</span>
                  <ArrowRight className="h-4 w-4" />
                </button>
              </form>

              {/* Quick Demo Profiles */}
              <div className="mt-7 border-t border-slate-100 pt-5 dark:border-slate-800">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                    Accès rapide démonstration (1 clic)
                  </p>
                  <span className="font-mono text-[11px] text-slate-400">3 profils</span>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {DEMO_CARDS.map((card) => (
                    <button
                      key={card.id}
                      type="button"
                      onClick={() => quickDemoLogin(card.id)}
                      className="flex flex-col justify-between rounded-xl border border-slate-200 bg-slate-50/70 p-3 text-left transition-colors hover:border-emerald-600 hover:bg-emerald-50/40 dark:border-slate-800 dark:bg-slate-800/50 dark:hover:border-emerald-500"
                    >
                      <div>
                        <p className="text-xs font-bold text-slate-900 dark:text-white">{card.name}</p>
                        <p className="mt-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                          {card.role}
                        </p>
                      </div>
                      <div className="mt-2 border-t border-slate-200/70 pt-1.5 dark:border-slate-700/70">
                        <p className="truncate text-[10px] text-slate-500">{card.scope}</p>
                        <p className="mt-0.5 font-mono text-[10px] font-semibold text-slate-600 dark:text-slate-300">
                          PIN : {card.pin}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="register-panel"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8 dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="mb-5">
                <h2 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
                  Créer un compte collaborateur
                </h2>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Enregistrez un profil Propriétaire, Gérant de dépôt ou Livreur terrain.
                </p>
              </div>

              <form onSubmit={handleRegisterSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Nom complet
                  </label>
                  <div className="relative mt-1.5">
                    <User className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={regName}
                      onChange={(e) => setRegName(e.target.value)}
                      placeholder="Ex: Kouyaté Mariam"
                      className="min-h-[44px] w-full rounded-lg border border-slate-200 bg-slate-50 pl-10 pr-3 text-sm text-slate-900 focus:border-emerald-600 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Email professionnel
                    </label>
                    <div className="relative mt-1.5">
                      <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input
                        type="email"
                        value={regEmail}
                        onChange={(e) => setRegEmail(e.target.value)}
                        placeholder="prenom.nom@gestdepot.ci"
                        className="min-h-[44px] w-full rounded-lg border border-slate-200 bg-slate-50 pl-10 pr-3 text-sm text-slate-900 focus:border-emerald-600 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Téléphone
                    </label>
                    <div className="relative mt-1.5">
                      <Phone className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input
                        type="tel"
                        value={regPhone}
                        onChange={(e) => setRegPhone(e.target.value)}
                        placeholder="+225 07 00 00 00 00"
                        className="min-h-[44px] w-full rounded-lg border border-slate-200 bg-slate-50 pl-10 pr-3 text-sm text-slate-900 focus:border-emerald-600 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Profil d’accès (RBAC)
                  </label>
                  <div className="mt-1.5 grid grid-cols-3 gap-1.5">
                    {(['GERANT', 'LIVREUR', 'PROPRIETAIRE'] as RoleCode[]).map((role) => (
                      <button
                        key={role}
                        type="button"
                        onClick={() => setRegRole(role)}
                        className={`min-h-[40px] rounded-lg border px-2.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap ${
                          regRole === role
                            ? 'border-emerald-700 bg-emerald-50 text-emerald-900 dark:border-emerald-500 dark:bg-emerald-950/60 dark:text-emerald-300'
                            : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                        }`}
                      >
                        {role === 'PROPRIETAIRE' ? 'Propriétaire' : role === 'GERANT' ? 'Gérant' : 'Livreur'}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                    <span className="font-semibold text-slate-700 dark:text-slate-300">{ROLE_LABELS[regRole]}</span> ·{' '}
                    {ROLE_DESCRIPTIONS[regRole]}
                  </p>
                </div>

                {regRole !== 'PROPRIETAIRE' && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Dépôt d’affectation obligatoire
                    </label>
                    <div className="relative mt-1.5">
                      <Building2 className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <select
                        value={regWarehouseId}
                        onChange={(e) => setRegWarehouseId(e.target.value)}
                        className="min-h-[44px] w-full rounded-lg border border-slate-200 bg-slate-50 pl-10 pr-3 text-sm text-slate-900 focus:border-emerald-600 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      >
                        {authWarehouses.map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.name} ({w.zone})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Code PIN / Mot de passe
                    </label>
                    <div className="relative mt-1.5">
                      <KeyRound className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input
                        type={showRegPin ? 'text' : 'password'}
                        value={regPin}
                        onChange={(e) => setRegPin(e.target.value)}
                        placeholder="Min. 4 caractères"
                        className="min-h-[44px] w-full rounded-lg border border-slate-200 bg-slate-50 pl-10 pr-10 font-mono text-sm text-slate-900 focus:border-emerald-600 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      />
                      <button
                        type="button"
                        onClick={() => setShowRegPin((v) => !v)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:text-slate-700"
                        aria-label="Basculer affichage PIN"
                      >
                        {showRegPin ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Confirmer le code PIN
                    </label>
                    <div className="relative mt-1.5">
                      <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input
                        type={showRegPin ? 'text' : 'password'}
                        value={regPinConfirm}
                        onChange={(e) => setRegPinConfirm(e.target.value)}
                        placeholder="Répéter le PIN"
                        className="min-h-[44px] w-full rounded-lg border border-slate-200 bg-slate-50 pl-10 pr-3 font-mono text-sm text-slate-900 focus:border-emerald-600 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      />
                    </div>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex min-h-[46px] w-full items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-800 disabled:opacity-60"
                >
                  <UserPlus className="h-4 w-4" />
                  <span>{submitting ? 'Création en cours...' : 'Créer le compte et accéder'}</span>
                </button>
              </form>
            </motion.div>
          )}
        </div>

        <p className="text-center text-xs text-slate-400">
          GestDepot ERP · Contrôle interne et traçabilité comptable Côte d’Ivoire
        </p>
      </div>
    </div>
  );
};
