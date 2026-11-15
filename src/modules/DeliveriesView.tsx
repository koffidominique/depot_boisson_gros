import React, { useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  MapPin,
  Plus,
  RefreshCw,
  Truck,
  Wallet,
} from 'lucide-react';
import { useErp } from '../context/ErpContext';
import { formatDateTimeFR, formatFCFA, PAYMENT_METHOD_LABELS } from '../lib/format';
import { PERMISSIONS } from '../types/erp';
import type { DeliveryRoute, DeliveryStop, PaymentMethod, VehicleType } from '../types/erp';

export const DeliveriesView: React.FC = () => {
  const { snapshot, mutateApi, hasPerm, currentUser, activeWarehouseId, selectedWarehouseId, notify } = useErp();

  // Route creation form (Gérant)
  const [showNewRoute, setShowNewRoute] = useState(false);
  const [driverId, setDriverId] = useState('');
  const [vehicleType, setVehicleType] = useState<VehicleType>('TRICYCLE');
  const [vehiclePlate, setVehiclePlate] = useState('CI-4829-ABJ');
  const [zone, setZone] = useState('Yopougon / Niangon');
  const [tourCashFloat, setTourCashFloat] = useState(0);
  const [selectedSales, setSelectedSales] = useState<string[]>([]);

  // Active stop completion modal with Signature Canvas, GPS, Breakage & Photo
  const [activeStop, setActiveStop] = useState<{ routeId: string; stop: DeliveryStop } | null>(null);
  const [stopStatus, setStopStatus] = useState<'LIVRE' | 'RETOUR_PARTIEL'>('LIVRE');
  const [emptyCratesCollected, setEmptyCratesCollected] = useState(0);
  const [cashCollected, setCashCollected] = useState(0);
  const [payMethod, setPayMethod] = useState<PaymentMethod>('ESPECES');
  const [breakageBottles, setBreakageBottles] = useState(0);
  const [gpsCoords, setGpsCoords] = useState<string | null>(null);
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawing = useRef(false);
  const [hasSigned, setHasSigned] = useState(false);

  // Driver closing mini-caisse modal
  const [closingRoute, setClosingRoute] = useState<DeliveryRoute | null>(null);
  const [driverHandedCash, setDriverHandedCash] = useState(0);
  const [driverReturnedCrates, setDriverReturnedCrates] = useState(0);
  const [driverCloseNotes, setDriverCloseNotes] = useState('');

  // Gérant validation & handover modal
  const [validatingRoute, setValidatingRoute] = useState<DeliveryRoute | null>(null);
  const [gerantCountedCash, setGerantCountedCash] = useState(0);
  const [gerantCountedCrates, setGerantCountedCrates] = useState(0);
  const [gerantValNotes, setGerantValNotes] = useState('');

  // Breakdown Reassignment modal (Gérant)
  const [reassignRoute, setReassignRoute] = useState<DeliveryRoute | null>(null);
  const [newDriverId, setNewDriverId] = useState('');
  const [reassignReason, setReassignReason] = useState('Panne véhicule en tournée');

  if (!snapshot || !currentUser) return null;

  const isDriver = currentUser.role === 'LIVREUR';
  const driversInDepot = snapshot.users.filter(
    (u) => !u.deletedAt && u.active && u.role === 'LIVREUR' && u.warehouseId === activeWarehouseId
  );
  const deliverableSales = snapshot.sales
    .filter((s) => s.status === 'VALIDEE' && s.warehouseId === activeWarehouseId)
    .slice(0, 12);

  const visibleRoutes = snapshot.deliveryRoutes.filter((r) => {
    if (isDriver) return r.driverId === currentUser.id;
    if (selectedWarehouseId !== 'ALL') return r.warehouseId === selectedWarehouseId;
    return true;
  });

  const startDraw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    isDrawing.current = true;
    ctx.beginPath();
    ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
  };

  const moveDraw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#0f172a';
    ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
    ctx.stroke();
    setHasSigned(true);
  };

  const endDraw = () => {
    isDrawing.current = false;
  };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasSigned(false);
  };

  const handleCaptureGps = () => {
    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const coords = `${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`;
          setGpsCoords(coords);
          notify('success', `Position GPS capturée : ${coords}`);
        },
        () => {
          const fallback = '5.34840, -4.08220 (Abidjan Zone)';
          setGpsCoords(fallback);
          notify('warning', `GPS navigateur indisponible — point de zone enregistré (${fallback}).`);
        },
        { timeout: 3500 }
      );
    } else {
      setGpsCoords('5.34840, -4.08220 (Abidjan Zone)');
    }
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setPhotoDataUrl(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleCreateRoute = async (e: React.FormEvent) => {
    e.preventDefault();
    const chosenDriver = driverId || driversInDepot[0]?.id;
    if (!chosenDriver) {
      notify('error', 'Aucun livreur actif affecté à ce dépôt.');
      return;
    }
    if (selectedSales.length === 0) {
      notify('warning', 'Sélectionnez au moins un bon / facture à livrer.');
      return;
    }
    const res = await mutateApi('/api/deliveries/routes', 'POST', {
      driverId: chosenDriver,
      warehouseId: activeWarehouseId,
      vehicleType,
      vehiclePlate,
      zone,
      tourCashFloat,
      saleIds: selectedSales,
    });
    if (res) {
      notify('success', 'Tournée de livraison planifiée.');
      setShowNewRoute(false);
      setSelectedSales([]);
    }
  };

  const handleCompleteStop = async () => {
    if (!activeStop) return;
    if ((stopStatus === 'RETOUR_PARTIEL' || breakageBottles > 0) && !photoDataUrl) {
      notify('error', 'Photo obligatoire pour toute casse ou retour partiel sur tournée.');
      return;
    }
    const signatureDataUrl = hasSigned && canvasRef.current ? canvasRef.current.toDataURL('image/png') : null;
    const payload = {
      status: stopStatus,
      emptyCratesCollected,
      cashCollected,
      paymentMethodCollected: cashCollected > 0 ? payMethod : null,
      signatureDataUrl,
      gpsCoords,
      photoDataUrl,
      breakageBottles,
      notes,
    };

    const res = await mutateApi(
      `/api/deliveries/routes/${activeStop.routeId}/stops/${activeStop.stop.id}/complete`,
      'POST',
      payload,
      {
        actionType: 'DELIVERY_COMPLETE',
        summary: `BL ${activeStop.stop.saleDocNumber} (${activeStop.stop.customerName})`,
        payload: { routeId: activeStop.routeId, stopId: activeStop.stop.id, data: payload },
        optimisticUpdate: (prev) => {
          const next = structuredClone(prev);
          const rte = next.deliveryRoutes.find((r) => r.id === activeStop.routeId);
          const stp = rte?.stops.find((s) => s.id === activeStop.stop.id);
          if (stp && rte) {
            stp.status = stopStatus;
            stp.deliveredAt = new Date().toISOString();
            stp.emptyCratesCollected = emptyCratesCollected;
            stp.cashCollected = cashCollected;
            stp.signatureDataUrl = signatureDataUrl;
            stp.isNonCompliant = !signatureDataUrl;
            if (cashCollected > 0 && (payMethod === 'ESPECES' || payMethod === 'CREDIT')) {
              rte.tourCashCollected += cashCollected;
              rte.tourExpectedCash = rte.tourCashFloat + rte.tourCashCollected;
            }
          }
          return next;
        },
      }
    );

    if (res) {
      if (!signatureDataUrl) {
        notify('warning', `BL ${activeStop.stop.saleDocNumber} validé SANS signature (marqué Non-Conforme).`);
      } else {
        notify('success', `Livraison ${activeStop.stop.saleDocNumber} confirmée avec signature.`);
      }
      setActiveStop(null);
      setHasSigned(false);
    }
  };

  const handleCloseTourneeDriver = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!closingRoute) return;
    const res = await mutateApi(`/api/deliveries/routes/${closingRoute.id}/close-tournee`, 'POST', {
      handedOverCash: driverHandedCash,
      emptyCratesReturned: driverReturnedCrates,
      notes: driverCloseNotes,
    });
    if (res) {
      notify('success', 'Mini-caisse de tournée clôturée et transmise au Gérant pour comptage.');
      setClosingRoute(null);
    }
  };

  const handleValidateTourneeGerant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validatingRoute) return;
    const res = await mutateApi(`/api/deliveries/routes/${validatingRoute.id}/validate-tournee`, 'POST', {
      countedCash: gerantCountedCash,
      emptyCratesCounted: gerantCountedCrates,
      notes: gerantValNotes,
    });
    if (res) {
      const variance = gerantCountedCash - validatingRoute.tourExpectedCash;
      if (variance < 0) {
        notify('warning', `Remise validée avec manquant de ${formatFCFA(Math.abs(variance))} (alerte Propriétaire créée).`);
      } else {
        notify('success', 'Remise tournée validée et transférée en caisse dépôt.');
      }
      setValidatingRoute(null);
    }
  };

  const handleReassignDriver = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reassignRoute || !newDriverId) return;
    const res = await mutateApi(`/api/deliveries/routes/${reassignRoute.id}/reassign`, 'POST', {
      newDriverId,
      reason: reassignReason,
    });
    if (res) {
      notify('success', `Tournée ${reassignRoute.docNumber} réaffectée (mini-caisse conservée).`);
      setReassignRoute(null);
    }
  };

  const driverTotalExpectedCash = visibleRoutes
    .filter((r) => r.status !== 'CLOTUREE')
    .reduce((s, r) => s + r.tourExpectedCash, 0);
  const driverTotalMM = visibleRoutes
    .filter((r) => r.status !== 'CLOTUREE')
    .reduce((s, r) => s + r.tourMobileMoneyCollected, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            {isDriver ? 'Ma tournée du jour' : 'Livraisons & Tournées Terrain'}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {isDriver
              ? 'Bons de livraison tactiles · Mini-caisse de tournée isolée · Retour casiers vides'
              : 'Tricycle, Pick-up & Camionnette · Caisse de tournée isolée & remise au Gérant'}
          </p>
        </div>

        {hasPerm(PERMISSIONS.DELIVERY_PLAN) && (
          <button
            type="button"
            onClick={() => {
              if (!driverId && driversInDepot[0]) setDriverId(driversInDepot[0].id);
              setShowNewRoute((v) => !v);
            }}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 whitespace-nowrap shrink-0"
          >
            <Plus className="h-4 w-4" />
            Planifier une tournée
          </button>
        )}
      </div>

      {/* Driver isolated mini-caisse summary */}
      {isDriver && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 dark:border-emerald-900 dark:bg-emerald-950/30">
            <div className="flex items-center justify-between text-xs font-semibold text-emerald-800 dark:text-emerald-300">
              <span>Ma mini-caisse espèces (isolée)</span>
              <Wallet className="h-4 w-4" />
            </div>
            <p className="mt-1.5 font-mono text-2xl font-bold text-slate-900 tabular-nums dark:text-white">
              {formatFCFA(driverTotalExpectedCash)}
            </p>
            <p className="mt-1 text-[11px] text-slate-600 dark:text-slate-400">
              À remettre physiquement au Gérant au retour
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <p className="text-xs font-medium text-slate-500">Mobile Money encaissé (tournée)</p>
            <p className="mt-1.5 font-mono text-2xl font-bold text-slate-900 tabular-nums dark:text-white">
              {formatFCFA(driverTotalMM)}
            </p>
            <p className="mt-1 text-[11px] text-slate-500">Traçabilité Orange / MTN / Wave</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <p className="text-xs font-medium text-slate-500">Tournées en cours</p>
            <p className="mt-1.5 font-mono text-2xl font-bold text-slate-900 tabular-nums dark:text-white">
              {visibleRoutes.filter((r) => r.status !== 'CLOTUREE').length}
            </p>
            <p className="mt-1 text-[11px] text-slate-500">Strictement isolées à votre profil</p>
          </div>
        </div>
      )}

      {/* New Route Form (Gérant / Propriétaire) */}
      {showNewRoute && hasPerm(PERMISSIONS.DELIVERY_PLAN) && (
        <form
          onSubmit={handleCreateRoute}
          className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
        >
          <h2 className="text-base font-bold text-slate-900 dark:text-white">Nouvelle feuille de tournée</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
            <div>
              <label className="block text-xs font-semibold text-slate-600">Livreur (dépôt actif)</label>
              <select
                value={driverId || driversInDepot[0]?.id || ''}
                onChange={(e) => setDriverId(e.target.value)}
                className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-200 px-3 text-sm dark:border-slate-700 dark:bg-slate-800"
              >
                {driversInDepot.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600">Véhicule</label>
              <select
                value={vehicleType}
                onChange={(e) => setVehicleType(e.target.value as VehicleType)}
                className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-200 px-3 text-sm dark:border-slate-700 dark:bg-slate-800"
              >
                <option value="TRICYCLE">Tricycle</option>
                <option value="PICKUP">Pick-up</option>
                <option value="CAMIONNETTE">Camionnette</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600">Immatriculation</label>
              <input
                type="text"
                value={vehiclePlate}
                onChange={(e) => setVehiclePlate(e.target.value)}
                className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-200 px-3 font-mono text-sm dark:border-slate-700 dark:bg-slate-800"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600">Secteur / Zone</label>
              <input
                type="text"
                value={zone}
                onChange={(e) => setZone(e.target.value)}
                className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-200 px-3 text-sm dark:border-slate-700 dark:bg-slate-800"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600">Fonds monnaie (FCFA)</label>
              <input
                type="number"
                min={0}
                value={tourCashFloat}
                onChange={(e) => setTourCashFloat(Math.max(0, Number(e.target.value)))}
                className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-200 px-3 font-mono text-sm tabular-nums dark:border-slate-700 dark:bg-slate-800"
              />
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold text-slate-600">Factures / BL à embarquer :</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {deliverableSales.map((s) => {
                const cust = snapshot.customers.find((c) => c.id === s.customerId);
                const checked = selectedSales.includes(s.id);
                return (
                  <label
                    key={s.id}
                    className={`flex cursor-pointer items-center gap-2 rounded-lg border p-2.5 text-xs ${
                      checked ? 'border-emerald-700 bg-emerald-50 dark:bg-emerald-950/40' : 'border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setSelectedSales((prev) =>
                          checked ? prev.filter((x) => x !== s.id) : [...prev, s.id]
                        )
                      }
                      className="h-4 w-4 accent-emerald-700"
                    />
                    <div>
                      <p className="font-mono font-bold">{s.docNumber}</p>
                      <p className="text-slate-600 dark:text-slate-400">
                        {cust?.name} · {cust?.zone}
                      </p>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowNewRoute(false)}
              className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold"
            >
              Annuler
            </button>
            <button
              type="submit"
              className="rounded-lg bg-emerald-700 px-4 py-2 text-xs font-semibold text-white"
            >
              Lancer la tournée
            </button>
          </div>
        </form>
      )}

      {/* Active Routes */}
      <div className="space-y-4">
        {visibleRoutes.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">
            Aucune tournée affectée pour ce périmètre.
          </div>
        ) : (
          visibleRoutes.map((route) => {
            const whName = snapshot.warehouses.find((w) => w.id === route.warehouseId)?.name;
            const canValidateStop =
              (isDriver && route.driverId === currentUser.id && hasPerm(PERMISSIONS.BL_EMIT)) ||
              hasPerm(PERMISSIONS.DELIVERY_COMPLETE);

            return (
              <div
                key={route.id}
                className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3 dark:border-slate-800">
                  <div className="flex items-center gap-3">
                    <Truck className="h-5 w-5 text-emerald-700 shrink-0" />
                    <div>
                      <h2 className="text-base font-bold text-slate-900 dark:text-white">
                        {route.docNumber} · {route.driverName} ({route.vehicleType} {route.vehiclePlate})
                      </h2>
                      <p className="text-xs text-slate-500">
                        {whName ? `${whName} · ` : ''}Zone : {route.zone} · {route.routeDate} · {route.stops.length} arrêts
                        {route.reassignedFromDriverId ? ' · Réaffectée suite panne' : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`text-xs font-bold ${
                        route.status === 'CLOTUREE'
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : route.status === 'EN_ATTENTE_REMISE'
                          ? 'text-amber-700 dark:text-amber-400'
                          : 'text-blue-700 dark:text-blue-400'
                      }`}
                    >
                      {route.status}
                    </span>

                    {route.status !== 'CLOTUREE' && hasPerm(PERMISSIONS.DELIVERY_PLAN) && (
                      <button
                        type="button"
                        onClick={() => {
                          setReassignRoute(route);
                          const alt = driversInDepot.find((d) => d.id !== route.driverId);
                          setNewDriverId(alt?.id || route.driverId);
                        }}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        Réaffecter
                      </button>
                    )}

                    {route.status !== 'CLOTUREE' &&
                      isDriver &&
                      route.driverId === currentUser.id &&
                      hasPerm(PERMISSIONS.CASH_TOURNEE_CLOSE) && (
                        <button
                          type="button"
                          onClick={() => {
                            setClosingRoute(route);
                            setDriverHandedCash(route.tourExpectedCash);
                            setDriverReturnedCrates(
                              route.stops.reduce((s, st) => s + st.emptyCratesCollected, 0)
                            );
                            setDriverCloseNotes('');
                          }}
                          className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700"
                        >
                          Clôturer & Remettre caisse
                        </button>
                      )}

                    {route.status !== 'CLOTUREE' && hasPerm(PERMISSIONS.DELIVERY_COMPLETE) && (
                      <button
                        type="button"
                        onClick={() => {
                          setValidatingRoute(route);
                          setGerantCountedCash(route.tourHandedOverCash ?? route.tourExpectedCash);
                          setGerantCountedCrates(
                            route.tourEmptyCratesReturned ??
                              route.stops.reduce((s, st) => s + st.emptyCratesCollected, 0)
                          );
                          setGerantValNotes('');
                        }}
                        className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800"
                      >
                        Valider remise dépôt
                      </button>
                    )}
                  </div>
                </div>

                {/* Mini-caisse strip */}
                <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-3 text-xs sm:grid-cols-4 dark:bg-slate-800/60">
                  <div>
                    <span className="text-slate-500">Fonds initial :</span>{' '}
                    <strong className="font-mono tabular-nums">{formatFCFA(route.tourCashFloat)}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500">Espèces terrain :</span>{' '}
                    <strong className="font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                      {formatFCFA(route.tourCashCollected)}
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-500">Mobile Money :</span>{' '}
                    <strong className="font-mono tabular-nums">{formatFCFA(route.tourMobileMoneyCollected)}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500">Attendu remise :</span>{' '}
                    <strong className="font-mono tabular-nums">{formatFCFA(route.tourExpectedCash)}</strong>
                    {route.tourCashVariance !== null && route.tourCashVariance !== undefined && (
                      <span
                        className={`ml-2 font-mono font-bold ${
                          route.tourCashVariance < 0 ? 'text-red-600' : 'text-emerald-600'
                        }`}
                      >
                        (Écart {formatFCFA(route.tourCashVariance)})
                      </span>
                    )}
                  </div>
                </div>

                {/* Stops */}
                <div className="mt-4 divide-y divide-slate-100 dark:divide-slate-800">
                  {route.stops.map((stop) => {
                    const isDone = stop.status === 'LIVRE' || stop.status === 'RETOUR_PARTIEL';
                    return (
                      <div
                        key={stop.id}
                        className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div>
                          <p className="text-sm font-semibold text-slate-900 dark:text-white">
                            Arrêt #{stop.orderIndex} — {stop.customerName} ({stop.zone})
                          </p>
                          <p className="font-mono text-xs text-slate-500 tabular-nums">
                            BL {stop.saleDocNumber} · {stop.cratesToDeliver} colis · À encaisser :{' '}
                            {formatFCFA(stop.amountDue)}
                          </p>
                          {isDone && (
                            <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-400 tabular-nums">
                              {stop.status === 'RETOUR_PARTIEL' ? 'Retour partiel' : 'Livré'} le{' '}
                              {formatDateTimeFR(stop.deliveredAt)} · Vides repris : {stop.emptyCratesCollected} ·
                              Encaissé : {formatFCFA(stop.cashCollected)}
                              {stop.gpsCoords ? ` · GPS ${stop.gpsCoords}` : ''}
                              {stop.isNonCompliant && (
                                <span className="ml-2 font-bold text-red-600">
                                  · NON-CONFORME (sans signature)
                                </span>
                              )}
                            </p>
                          )}
                        </div>

                        <div className="flex items-center gap-3 shrink-0">
                          {stop.signatureDataUrl && (
                            <img
                              src={stop.signatureDataUrl}
                              alt="Signature client"
                              className="h-10 w-24 rounded border border-slate-200 bg-white object-contain"
                            />
                          )}
                          {!isDone ? (
                            <button
                              type="button"
                              disabled={!canValidateStop || route.status === 'CLOTUREE'}
                              onClick={() => {
                                setActiveStop({ routeId: route.id, stop });
                                setStopStatus('LIVRE');
                                setEmptyCratesCollected(0);
                                setCashCollected(stop.amountDue);
                                setPayMethod('ESPECES');
                                setBreakageBottles(0);
                                setGpsCoords(null);
                                setPhotoDataUrl(null);
                                setNotes('');
                                setHasSigned(false);
                              }}
                              className="min-h-[44px] rounded-lg bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-40 whitespace-nowrap"
                            >
                              Valider BL & Signer
                            </button>
                          ) : (
                            <span
                              className={`inline-flex items-center gap-1 text-xs font-semibold ${
                                stop.isNonCompliant ? 'text-amber-700' : 'text-emerald-700'
                              }`}
                            >
                              {stop.isNonCompliant ? (
                                <AlertTriangle className="h-4 w-4" />
                              ) : (
                                <CheckCircle2 className="h-4 w-4" />
                              )}
                              {stop.isNonCompliant ? 'Livré sans signature' : 'Signé & Livré'}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Stop Completion Modal */}
      {activeStop && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 overflow-y-auto">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">
              Bon de Livraison · {activeStop.stop.saleDocNumber}
            </h3>
            <p className="text-xs text-slate-500">
              {activeStop.stop.customerName} · {activeStop.stop.cratesToDeliver} colis livrés
            </p>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setStopStatus('LIVRE')}
                className={`min-h-[38px] rounded-lg border text-xs font-semibold ${
                  stopStatus === 'LIVRE'
                    ? 'border-emerald-700 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200'
                    : 'border-slate-200 text-slate-600 dark:border-slate-700'
                }`}
              >
                Livraison complète
              </button>
              <button
                type="button"
                onClick={() => setStopStatus('RETOUR_PARTIEL')}
                className={`min-h-[38px] rounded-lg border text-xs font-semibold ${
                  stopStatus === 'RETOUR_PARTIEL'
                    ? 'border-amber-600 bg-amber-50 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200'
                    : 'border-slate-200 text-slate-600 dark:border-slate-700'
                }`}
              >
                Retour partiel (photo req.)
              </button>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                  Casiers vides repris
                </label>
                <input
                  type="number"
                  min={0}
                  value={emptyCratesCollected}
                  onChange={(e) => setEmptyCratesCollected(Math.max(0, Number(e.target.value)))}
                  className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-200 px-2.5 font-mono text-sm font-bold tabular-nums dark:border-slate-700 dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                  Encaissement (FCFA)
                </label>
                <input
                  type="number"
                  min={0}
                  value={cashCollected}
                  onChange={(e) => setCashCollected(Math.max(0, Number(e.target.value)))}
                  className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-200 px-2.5 font-mono text-sm font-bold tabular-nums dark:border-slate-700 dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                  Casse (bouteilles)
                </label>
                <input
                  type="number"
                  min={0}
                  value={breakageBottles}
                  onChange={(e) => setBreakageBottles(Math.max(0, Number(e.target.value)))}
                  className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-200 px-2.5 font-mono text-sm font-bold tabular-nums dark:border-slate-700 dark:bg-slate-800"
                />
              </div>
            </div>

            {cashCollected > 0 && (
              <div className="mt-3">
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400">
                  Mode encaissement terrain (vers mini-caisse isolée)
                </label>
                <select
                  value={payMethod}
                  onChange={(e) => setPayMethod(e.target.value as PaymentMethod)}
                  className="mt-1 min-h-[40px] w-full rounded-lg border border-slate-200 px-3 text-sm dark:border-slate-700 dark:bg-slate-800"
                >
                  {(['ESPECES', 'ORANGE_MONEY', 'MTN_MOMO', 'WAVE', 'MOOV_MONEY'] as PaymentMethod[]).map((m) => (
                    <option key={m} value={m}>
                      {PAYMENT_METHOD_LABELS[m]}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* GPS & Photo capture */}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleCaptureGps}
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200"
              >
                <MapPin className="h-3.5 w-3.5 text-emerald-700" />
                {gpsCoords ? `GPS : ${gpsCoords}` : 'Capturer GPS'}
              </button>

              <label className="inline-flex min-h-[36px] cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200">
                <Camera className="h-3.5 w-3.5 text-amber-600" />
                <span>{photoDataUrl ? 'Photo jointe' : 'Joindre photo'}</span>
                <input type="file" accept="image/*" onChange={handlePhotoUpload} className="hidden" />
              </label>
              {(breakageBottles > 0 || stopStatus === 'RETOUR_PARTIEL') && !photoDataUrl && (
                <span className="text-[11px] font-semibold text-red-600">Photo obligatoire</span>
              )}
            </div>

            <div className="mt-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                  Signature tactile client (obligatoire — sinon Non-Conforme)
                </label>
                <button type="button" onClick={clearSignature} className="text-xs font-semibold text-red-600">
                  Effacer
                </button>
              </div>
              <canvas
                ref={canvasRef}
                width={380}
                height={120}
                onPointerDown={startDraw}
                onPointerMove={moveDraw}
                onPointerUp={endDraw}
                onPointerLeave={endDraw}
                className="mt-1.5 w-full touch-none rounded-lg border border-dashed border-slate-300 bg-slate-50"
              />
            </div>

            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Observations livraison (ex: 1 bouteille cassée, client absent...)"
              className="mt-3 min-h-[40px] w-full rounded-lg border border-slate-200 px-3 text-xs dark:border-slate-700 dark:bg-slate-800"
            />

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={handleCompleteStop}
                className="min-h-[44px] flex-1 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
              >
                Confirmer livraison
              </button>
              <button
                type="button"
                onClick={() => setActiveStop(null)}
                className="min-h-[44px] rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-300"
              >
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Driver Close Mini-Caisse Modal */}
      {closingRoute && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <form
            onSubmit={handleCloseTourneeDriver}
            className="w-full max-w-md space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900"
          >
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">
              Clôturer ma mini-caisse · {closingRoute.docNumber}
            </h3>
            <p className="text-xs text-slate-500">
              Attendu espèces (fonds + encaissements) :{' '}
              <strong className="font-mono">{formatFCFA(closingRoute.tourExpectedCash)}</strong>
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-600">Espèces remises (FCFA)</label>
                <input
                  type="number"
                  min={0}
                  value={driverHandedCash}
                  onChange={(e) => setDriverHandedCash(Math.max(0, Number(e.target.value)))}
                  className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-200 px-3 font-mono text-sm font-bold dark:border-slate-700 dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600">Casiers vides ramenés</label>
                <input
                  type="number"
                  min={0}
                  value={driverReturnedCrates}
                  onChange={(e) => setDriverReturnedCrates(Math.max(0, Number(e.target.value)))}
                  className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-200 px-3 font-mono text-sm font-bold dark:border-slate-700 dark:bg-slate-800"
                />
              </div>
            </div>
            <input
              type="text"
              value={driverCloseNotes}
              onChange={(e) => setDriverCloseNotes(e.target.value)}
              placeholder="Observations retour tournée..."
              className="min-h-[40px] w-full rounded-lg border border-slate-200 px-3 text-xs dark:border-slate-700 dark:bg-slate-800"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setClosingRoute(null)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold"
              >
                Annuler
              </button>
              <button
                type="submit"
                className="rounded-lg bg-amber-600 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-700"
              >
                Transmettre au Gérant
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Gérant Validation & Handover Modal */}
      {validatingRoute && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <form
            onSubmit={handleValidateTourneeGerant}
            className="w-full max-w-md space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900"
          >
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">
              Réception & Contrôle Tournée · {validatingRoute.docNumber}
            </h3>
            <p className="text-xs text-slate-500">
              Livreur : {validatingRoute.driverName} · Attendu espèces :{' '}
              <strong className="font-mono">{formatFCFA(validatingRoute.tourExpectedCash)}</strong>
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-600">Espèces comptées (FCFA)</label>
                <input
                  type="number"
                  min={0}
                  value={gerantCountedCash}
                  onChange={(e) => setGerantCountedCash(Math.max(0, Number(e.target.value)))}
                  className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-200 px-3 font-mono text-sm font-bold dark:border-slate-700 dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600">Casiers vides comptés</label>
                <input
                  type="number"
                  min={0}
                  value={gerantCountedCrates}
                  onChange={(e) => setGerantCountedCrates(Math.max(0, Number(e.target.value)))}
                  className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-200 px-3 font-mono text-sm font-bold dark:border-slate-700 dark:bg-slate-800"
                />
              </div>
            </div>
            {gerantCountedCash !== validatingRoute.tourExpectedCash && (
              <p className="rounded-lg bg-amber-50 p-2.5 text-xs font-semibold text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
                Écart constaté : {formatFCFA(gerantCountedCash - validatingRoute.tourExpectedCash)}
                {gerantCountedCash < validatingRoute.tourExpectedCash && ' (alerte Propriétaire déclenchée)'}
              </p>
            )}
            <input
              type="text"
              value={gerantValNotes}
              onChange={(e) => setGerantValNotes(e.target.value)}
              placeholder="Note de contrôle Gérant..."
              className="min-h-[40px] w-full rounded-lg border border-slate-200 px-3 text-xs dark:border-slate-700 dark:bg-slate-800"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setValidatingRoute(null)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold"
              >
                Annuler
              </button>
              <button
                type="submit"
                className="rounded-lg bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800"
              >
                Valider & Encaisser en Dépôt
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Breakdown Driver Reassignment Modal */}
      {reassignRoute && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <form
            onSubmit={handleReassignDriver}
            className="w-full max-w-md space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900"
          >
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">
              Réaffecter tournée · {reassignRoute.docNumber}
            </h3>
            <p className="text-xs text-slate-500">
              En cas de panne tricycle/véhicule, la mini-caisse et les BL restants sont transférés au livreur de relais.
            </p>
            <div>
              <label className="block text-xs font-semibold text-slate-600">Nouveau livreur (même dépôt)</label>
              <select
                value={newDriverId}
                onChange={(e) => setNewDriverId(e.target.value)}
                className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-200 px-3 text-sm dark:border-slate-700 dark:bg-slate-800"
              >
                {driversInDepot.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600">Motif de réaffectation</label>
              <input
                type="text"
                value={reassignReason}
                onChange={(e) => setReassignReason(e.target.value)}
                className="mt-1 min-h-[40px] w-full rounded-lg border border-slate-200 px-3 text-xs dark:border-slate-700 dark:bg-slate-800"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setReassignRoute(null)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold"
              >
                Annuler
              </button>
              <button
                type="submit"
                className="rounded-lg bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800"
              >
                Confirmer le relais
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
