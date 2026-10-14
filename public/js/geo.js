// Matemática geográfica pura, sin dependencias (se ejecuta también en Node: tools/test-geo.mjs).
//
// Convención del mundo Three.js usada en todo el proyecto:
//   +X = Este, +Y = Arriba, −Z = Norte  (la cámara de Three mira hacia −Z por defecto,
//   así que una cámara sin rotar mira al Norte geográfico).
// Rumbos: grados verdaderos 0–360 desde el norte geográfico, sentido horario.

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
export const EARTH_RADIUS_M = 6371008.8; // radio medio IUGG

export function normalizeAngle(deg) {
  const a = deg % 360;
  return a < 0 ? a + 360 : a;
}

/** Diferencia angular más corta de `from` a `to`, en [−180, 180). */
export function shortestAngleDiff(from, to) {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

/** Media circular (opcionalmente ponderada). Devuelve NaN si los ángulos se anulan. */
export function circularMean(anglesDeg, weights) {
  let s = 0, c = 0;
  anglesDeg.forEach((a, i) => {
    const w = weights ? weights[i] : 1;
    s += w * Math.sin(a * D2R);
    c += w * Math.cos(a * D2R);
  });
  if (Math.hypot(s, c) < 1e-9) return NaN;
  return normalizeAngle(Math.atan2(s, c) * R2D);
}

/** Interpolación por el camino angular más corto (media circular exponencial con t = alfa). */
export function circularLerp(a, b, t) {
  return normalizeAngle(a + shortestAngleDiff(a, b) * t);
}

/** Rumbo inicial de círculo máximo de `from` a `to` ({lat, lng} en grados). */
export function initialBearing(from, to) {
  const φ1 = from.lat * D2R, φ2 = to.lat * D2R;
  const Δλ = (to.lng - from.lng) * D2R;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) * R2D + 360) % 360;
}

/** Distancia haversine en metros. */
export function haversineDistance(from, to) {
  const φ1 = from.lat * D2R, φ2 = to.lat * D2R;
  const Δφ = φ2 - φ1, Δλ = (to.lng - from.lng) * D2R;
  const h = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Posición en el mundo Three.js de un punto a rumbo θ y elevación `el` sobre una esfera de radio R. */
export function worldPosition(bearingDeg, elevationDeg, R) {
  const θ = bearingDeg * D2R, el = elevationDeg * D2R;
  return {
    x: R * Math.cos(el) * Math.sin(θ),
    y: R * Math.sin(el),
    z: -R * Math.cos(el) * Math.cos(θ),
  };
}

/** Ancho en unidades de mundo que subtiende `angularWidthDeg` a distancia R. */
export function angularSizeToWorld(angularWidthDeg, R) {
  return 2 * R * Math.tan((angularWidthDeg * D2R) / 2);
}

/** Tamaño angular (grados) de un tamaño de mundo a distancia R. Inversa de la anterior. */
export function worldSizeToAngular(size, R) {
  return 2 * Math.atan(size / 2 / R) * R2D;
}

/**
 * Calcula rumbo verdadero, distancia y rumbo de visualización de cada punto desde `position`.
 * layoutMode "cardinal": conserva el orden angular real pero reparte los puntos a 360°/n
 * a partir de `cardinalBaseDeg` (o de la base que minimiza la desviación si es null).
 */
export function computeTargets(position, points, { layoutMode = "real", cardinalBaseDeg = null } = {}) {
  const targets = points.map((p) => ({
    ...p,
    trueBearing: initialBearing(position, p),
    distanceM: haversineDistance(position, p),
  }));
  if (layoutMode !== "cardinal") {
    // bearingOffsetDeg: corrección manual por punto (ver config.js); no altera trueBearing.
    targets.forEach((t) => (t.displayBearing = normalizeAngle(t.trueBearing + (t.bearingOffsetDeg || 0))));
    return targets;
  }
  const step = 360 / targets.length;
  const sorted = [...targets].sort((a, b) => a.trueBearing - b.trueBearing);
  let base = cardinalBaseDeg;
  if (base == null || !Number.isFinite(base)) {
    base = circularMean(sorted.map((t, k) => t.trueBearing - k * step));
    if (!Number.isFinite(base)) base = sorted[0].trueBearing;
  }
  sorted.forEach((t, k) => (t.displayBearing = normalizeAngle(base + k * step)));
  return targets;
}

const CARDINALS_ES = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];
export function cardinalName(deg) {
  return CARDINALS_ES[Math.round(normalizeAngle(deg) / 45) % 8];
}

export function formatDistance(m) {
  const fmt = (v, d) => new Intl.NumberFormat("es-CO", { maximumFractionDigits: d, minimumFractionDigits: d }).format(v);
  if (m < 1000) return `≈ ${fmt(Math.round(m / 10) * 10, 0)} m`;
  if (m < 10000) return `≈ ${fmt(m / 1000, 1)} km`;
  return `≈ ${fmt(m / 1000, 0)} km`;
}

/** Parsea "lat,lng" (p. ej. del parámetro ?origin=). Devuelve null si no es válido. */
export function parseLatLng(str) {
  if (!str) return null;
  const parts = String(str).split(",").map((s) => Number(s.trim()));
  if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n))) return null;
  const [lat, lng] = parts;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}
