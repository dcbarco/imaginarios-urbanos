// Adquisición de datos de los sensores del dispositivo: orientación, GPS, cámara y wake lock.
// No depende de Three.js (se carga con la pantalla de bienvenida); la fusión y los
// marcos de referencia se resuelven en orientation.js.
import { haversineDistance } from "./geo.js";

export const SOURCES = {
  AOS: "AbsoluteOrientationSensor",
  DOA: "deviceorientationabsolute",
  DO_ABS: "deviceorientation (absolute)",
  IOS: "iOS webkit",
  DO_REL: "deviceorientation (relativo)",
  MOUSE: "mouse",
};

export function needsIOSPermission() {
  return typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function";
}

/**
 * Pide permiso de orientación en iOS. DEBE llamarse de forma síncrona dentro del handler
 * del clic, antes de cualquier `await`: Safari exige un gesto de usuario activo.
 * Resuelve "granted" | "denied" | "not-required".
 */
export function requestOrientationPermission() {
  if (!needsIOSPermission()) return Promise.resolve("not-required");
  try {
    return DeviceOrientationEvent.requestPermission().then(
      (r) => (r === "granted" ? "granted" : "denied"),
      () => "denied",
    );
  } catch {
    return Promise.resolve("denied");
  }
}

export function screenAngle() {
  const a = screen.orientation?.angle ?? window.orientation ?? 0;
  return Number(a) || 0;
}

/**
 * Detecta en runtime la mejor fuente de orientación y empieza a emitir muestras en `onSample`.
 * Prioridad: AbsoluteOrientationSensor → deviceorientationabsolute → deviceorientation con
 * absolute===true → iOS (webkitCompassHeading) → deviceorientation relativo.
 * Resuelve { source, absolute, stop, diag } — `source` es null si no hay sensores (→ modo
 * arrastre); `diag` explica por qué, para depurar en dispositivos reales (ver ?debug=1).
 */
export async function startOrientation(onSample, onError = () => {}) {
  const aosDiag = {};
  const aos = await tryAbsoluteOrientationSensor(onSample, onError, 2500, aosDiag);
  if (aos) return { ...aos, diag: { aos: aosDiag } };
  const eventsDiag = {};
  const events = await tryOrientationEvents(onSample, 3500, 700, eventsDiag);
  if (events) return { ...events, diag: { aos: aosDiag, events: eventsDiag } };
  return { source: null, diag: { aos: aosDiag, events: eventsDiag } };
}

async function tryAbsoluteOrientationSensor(onSample, onError, timeoutMs, diag) {
  if (!("AbsoluteOrientationSensor" in window)) {
    diag.supported = false;
    return null;
  }
  diag.supported = true;
  if (navigator.permissions?.query) {
    const entries = await Promise.all(
      ["accelerometer", "gyroscope", "magnetometer"].map((name) =>
        navigator.permissions.query({ name }).then((r) => [name, r.state], () => [name, "unknown"]),
      ),
    );
    diag.permissions = Object.fromEntries(entries);
    if (entries.some(([, state]) => state === "denied")) {
      diag.result = "permiso denegado";
      return null;
    }
  }
  return new Promise((resolve) => {
    let sensor;
    let settled = false;
    try {
      // referenceFrame "screen": el cuaternión ya compensa la rotación de pantalla.
      sensor = new window.AbsoluteOrientationSensor({ frequency: 60, referenceFrame: "screen" });
    } catch (err) {
      diag.result = `constructor lanzó: ${err?.name ?? err}`;
      resolve(null);
      return;
    }
    const settle = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (ok) {
        diag.result = "ok";
        resolve({ source: SOURCES.AOS, absolute: true, stop: () => sensor.stop() });
      } else {
        try { sensor.stop(); } catch { /* ya detenido */ }
        diag.result ??= "sin lectura antes del tiempo límite";
        resolve(null);
      }
    };
    const timer = setTimeout(() => settle(false), timeoutMs);
    sensor.addEventListener("reading", () => {
      const q = sensor.quaternion;
      if (!q) return;
      settle(true);
      onSample({ source: SOURCES.AOS, kind: "quat", q: Array.from(q), absolute: true, t: performance.now() });
    });
    sensor.addEventListener("error", (e) => {
      diag.result = `error del sensor: ${e.error?.name ?? e.error ?? e}`;
      if (settled) onError(e.error ?? e);
      settle(false);
    });
    try {
      sensor.start();
    } catch (err) {
      diag.result = `start() lanzó: ${err?.name ?? err}`;
      settle(false);
    }
  });
}

function tryOrientationEvents(onSample, maxWaitMs, settleMs, diag) {
  return new Promise((resolve) => {
    const hasDOA = "ondeviceorientationabsolute" in window;
    diag.hasDeviceOrientationAbsoluteApi = hasDOA;
    diag.doaEventsTotal = 0;
    diag.doEventsTotal = 0;
    diag.doaEventsValid = 0;
    diag.doEventsValid = 0;
    const seen = new Set();
    let chosen = null;
    let firstEventAt = null;
    const valid = (e) => e.alpha != null && e.beta != null && e.gamma != null;
    const emit = (e, source, absolute) =>
      onSample({
        source, kind: "euler", absolute, alpha: e.alpha, beta: e.beta, gamma: e.gamma,
        compassHeading: e.webkitCompassHeading, compassAccuracy: e.webkitCompassAccuracy,
        screenAngle: screenAngle(), t: performance.now(),
      });

    const onDOA = (e) => {
      diag.doaEventsTotal++;
      if (!valid(e)) return;
      diag.doaEventsValid++;
      if (!chosen) choose(SOURCES.DOA);
      if (chosen === SOURCES.DOA) emit(e, SOURCES.DOA, true);
    };
    const onDO = (e) => {
      diag.doEventsTotal++;
      if (!valid(e)) return;
      diag.doEventsValid++;
      let kind;
      if (e.webkitCompassHeading !== undefined) kind = SOURCES.IOS;
      else if (e.absolute === true) kind = SOURCES.DO_ABS;
      else kind = SOURCES.DO_REL;
      seen.add(kind);
      firstEventAt ??= performance.now();
      // iOS nunca emite deviceorientationabsolute; un DO absoluto sin DOA disponible tampoco tiene rival.
      if (!chosen && (kind === SOURCES.IOS || (kind === SOURCES.DO_ABS && !hasDOA))) choose(kind);
      if (chosen === kind) emit(e, kind, kind !== SOURCES.DO_REL);
    };

    const started = performance.now();
    const poll = setInterval(() => {
      const now = performance.now();
      const waitedEnough = firstEventAt != null && now - firstEventAt > settleMs;
      if (!chosen && (waitedEnough || now - started > maxWaitMs)) {
        if (seen.has(SOURCES.DO_ABS)) choose(SOURCES.DO_ABS);
        else if (seen.has(SOURCES.DO_REL)) choose(SOURCES.DO_REL);
        else choose(null);
      }
    }, 100);

    function choose(source) {
      chosen = source ?? "none";
      diag.result = source ?? (diag.doaEventsTotal + diag.doEventsTotal === 0
        ? "ningún evento de orientación llegó (revisa el permiso de sensores de movimiento del sitio)"
        : "llegaron eventos pero nunca con alpha/beta/gamma válidos a la vez");
      clearInterval(poll);
      if (source !== SOURCES.DOA) window.removeEventListener("deviceorientationabsolute", onDOA);
      if (source === SOURCES.DOA || !source) window.removeEventListener("deviceorientation", onDO);
      if (!source) return resolve(null);
      resolve({
        source,
        absolute: source !== SOURCES.DO_REL,
        stop: () => {
          window.removeEventListener("deviceorientationabsolute", onDOA);
          window.removeEventListener("deviceorientation", onDO);
        },
      });
    }

    if (hasDOA) window.addEventListener("deviceorientationabsolute", onDOA);
    window.addEventListener("deviceorientation", onDO);
  });
}

/** Cámara trasera en un <video playsinline muted autoplay>. Lanza si no hay cámara o permiso. */
export async function startCamera(video) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("getUserMedia no disponible");
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  await video.play().catch(() => {});
  return stream;
}

/** GPS con filtrado por precisión y media ponderada (1/accuracy²) de los últimos N fixes. */
export class GpsTracker {
  constructor(config, onChange = () => {}) {
    this.cfg = config;
    this.onChange = onChange;
    this.status = "off"; // off | waiting | ok | poor | denied | unavailable
    this.fixes = [];
    this.last = null;  // último fix crudo
    this.fix = null;   // posición promediada {lat, lng, accuracy}
  }

  start() {
    if (!("geolocation" in navigator)) {
      this.status = "unavailable";
      return;
    }
    this.status = "waiting";
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => this.#onFix(pos),
      (err) => this.#onError(err),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 },
    );
  }

  stop() {
    if (this.watchId != null) navigator.geolocation.clearWatch(this.watchId);
  }

  #onFix(pos) {
    const { latitude: lat, longitude: lng, accuracy } = pos.coords;
    this.last = { lat, lng, accuracy, t: pos.timestamp };
    if (!(accuracy <= this.cfg.gpsMaxAccuracyM)) {
      if (!this.fix) this.status = "poor";
      this.onChange(this);
      return;
    }
    this.fixes.push(this.last);
    if (this.fixes.length > this.cfg.gpsAverageFixes) this.fixes.shift();
    let sw = 0, sLat = 0, sLng = 0;
    for (const f of this.fixes) {
      const w = 1 / Math.max(1, f.accuracy) ** 2;
      sw += w;
      sLat += w * f.lat;
      sLng += w * f.lng;
    }
    this.fix = { lat: sLat / sw, lng: sLng / sw, accuracy: 1 / Math.sqrt(sw) };
    this.status = "ok";
    this.onChange(this);
  }

  #onError(err) {
    if (err.code === 1) {
      this.status = "denied";
      this.stop();
    } else if (!this.fix) {
      this.status = err.code === 3 ? "waiting" : "unavailable";
    }
    this.onChange(this);
  }
}

/**
 * Posición efectiva desde la que se calculan los rumbos, según `positionMode`.
 * En "hybrid" hay histéresis (80 % del radio) para no oscilar en el borde.
 */
export function resolvePosition(config, origin, gps, wasUsingGps = false) {
  const fromOrigin = { position: origin, usingGps: false, distanceToOriginM: null };
  const fix = gps?.fix;
  if (config.positionMode === "fixed" || !fix) return fromOrigin;
  const d = haversineDistance(origin, fix);
  if (config.positionMode === "gps") return { position: fix, usingGps: true, distanceToOriginM: d };
  const threshold = wasUsingGps ? config.hybridRadiusM * 0.8 : config.hybridRadiusM;
  return d > threshold
    ? { position: fix, usingGps: true, distanceToOriginM: d }
    : { ...fromOrigin, distanceToOriginM: d };
}

/** Mantiene la pantalla encendida; re-solicita al volver a la pestaña. */
export function keepScreenOn() {
  let lock = null;
  const request = async () => {
    if (!("wakeLock" in navigator) || document.visibilityState !== "visible" || lock) return;
    try {
      lock = await navigator.wakeLock.request("screen");
      lock.addEventListener("release", () => (lock = null));
    } catch {
      lock = null;
    }
  };
  document.addEventListener("visibilitychange", request);
  request();
  return { get active() { return !!lock; } };
}
