// Fusión de orientación: convierte las muestras crudas de sensors.js en el cuaternión de la
// cámara virtual en el mundo Three.js (+X Este, +Y Arriba, −Z Norte VERDADERO), aplicando
// offset de yaw de iOS, declinación magnética, alineación manual y suavizado.
import { Quaternion, Euler, Vector3, MathUtils } from "three";
import { SOURCES, screenAngle } from "./sensors.js";
import { normalizeAngle, shortestAngleDiff, circularLerp } from "./geo.js";

const D2R = MathUtils.DEG2RAD;
const R2D = MathUtils.RAD2DEG;

// Marco terrestre W3C (X Este, Y Norte, Z Arriba) → mundo Three (X Este, Y Arriba, Z Sur).
// Es una rotación de −90° sobre X: (x, y, z) → (x, z, −y).
const Q_EARTH_TO_WORLD = new Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2);
// Como en DeviceOrientationControls: tras el Euler (beta, alpha, −gamma) 'YXZ' el marco
// describe el teléfono tumbado; −90° sobre X hace que la cámara mire por la cara trasera
// (−Z local = fuera de la espalda del teléfono, +Y local = borde superior).
const Q_BACK_CAMERA = new Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2);
const Y_AXIS = new Vector3(0, 1, 0);
const Z_AXIS = new Vector3(0, 0, 1);

const _v = new Vector3();
const _v2 = new Vector3();
const _q = new Quaternion();
const _qz = new Quaternion();
const _euler = new Euler();

/** Cuaternión de dispositivo a partir de alpha/beta/gamma (grados) y ángulo de pantalla. */
export function eulerToQuaternion(alpha, beta, gamma, screenAngleDeg, out) {
  _euler.set(beta * D2R, alpha * D2R, -gamma * D2R, "YXZ");
  out.setFromEuler(_euler);
  out.multiply(Q_BACK_CAMERA);
  out.multiply(_qz.setFromAxisAngle(Z_AXIS, -screenAngleDeg * D2R));
  return out;
}

/**
 * Rumbo (0–360, horario desde −Z) hacia donde mira la cámara, proyectado al plano horizontal.
 * Con −Z = Norte: rumbo = atan2(f.x, −f.z). Si la cámara mira casi en vertical se usa el
 * borde superior del teléfono, igual que hace la brújula del sistema con el teléfono plano.
 */
export function headingOf(q) {
  const f = _v.set(0, 0, -1).applyQuaternion(q);
  if (Math.hypot(f.x, f.z) > 0.1) return normalizeAngle(Math.atan2(f.x, -f.z) * R2D);
  const u = _v2.set(0, 1, 0).applyQuaternion(q);
  const s = f.y < 0 ? 1 : -1; // mirando abajo: el borde superior apunta "adelante"
  return normalizeAngle(Math.atan2(s * u.x, -s * u.z) * R2D);
}

/** Cabeceo (asin de la componente vertical de la mirada) y alabeo, en grados. */
export function pitchRollOf(q) {
  const f = _v.set(0, 0, -1).applyQuaternion(q);
  const pitch = Math.asin(MathUtils.clamp(f.y, -1, 1)) * R2D;
  const r = _v2.set(1, 0, 0).applyQuaternion(q);
  const roll = Math.asin(MathUtils.clamp(r.y, -1, 1)) * R2D;
  return { pitch, roll };
}

/** Detecta brújula inestable: el rumbo oscila con el teléfono quieto (cabeceo/alabeo estables). */
class InterferenceMonitor {
  constructor(cfg) {
    this.cfg = cfg;
    this.samples = [];
    this.warning = false;
    this.spread = 0;
  }
  push(t, heading, pitch, roll) {
    if (!Number.isFinite(heading)) return;
    const { windowMs, headingSpreadDeg, stillToleranceDeg } = this.cfg;
    this.samples.push({ t, heading, pitch, roll });
    while (this.samples.length && this.samples[0].t < t - windowMs) this.samples.shift();
    if (this.samples.length < 5 || t - this.samples[0].t < windowMs * 0.9) return;
    let pMin = Infinity, pMax = -Infinity, rMin = Infinity, rMax = -Infinity, hMin = 0, hMax = 0;
    const h0 = this.samples[0].heading;
    for (const s of this.samples) {
      pMin = Math.min(pMin, s.pitch); pMax = Math.max(pMax, s.pitch);
      rMin = Math.min(rMin, s.roll); rMax = Math.max(rMax, s.roll);
      const d = shortestAngleDiff(h0, s.heading);
      hMin = Math.min(hMin, d); hMax = Math.max(hMax, d);
    }
    const still = pMax - pMin < stillToleranceDeg && rMax - rMin < stillToleranceDeg;
    this.spread = hMax - hMin;
    this.warning = still && this.spread > headingSpreadDeg;
  }
}

function loadStored(key) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? {};
  } catch {
    return {};
  }
}
function saveStored(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify({ ...loadStored(key), ...data }));
  } catch {
    /* almacenamiento no disponible (modo privado, etc.) */
  }
}

export class OrientationFusion {
  constructor(config) {
    this.cfg = config;
    this.source = null;
    this.declinationDeg = config.magneticDeclinationDeg;
    this.userYawOffsetDeg = 0;
    this.iosYawOffsetDeg = null;      // null hasta la primera lectura de webkitCompassHeading
    this.iosOffsetProvisional = true; // true hasta la primera lectura con el teléfono vertical
    this.aligned = false;             // alineación manual hecha en esta sesión
    this.compassPoor = false;
    this.raw = {};
    this.hasSample = false;

    this.qDevice = new Quaternion();  // dispositivo en el marco de su sensor (magnético o relativo)
    this.qTarget = new Quaternion();  // corregido a norte verdadero, tras filtro de saltos
    this.qCurrent = new Quaternion(); // suavizado: el que usa la cámara
    this._candidate = new Quaternion();
    this._prevDevice = new Quaternion();
    this._hasPrev = false;
    this.motionDeg = 0;
    this._acceptedHeading = null;
    this._jumpSince = null;
    this._snap = true;

    this.interference = new InterferenceMonitor(config.interference);
  }

  setSource(source) {
    this.source = source;
    // La alineación guardada solo tiene sentido si el marco es absoluto (mismo norte entre sesiones).
    if (this.persistsOffset) {
      const stored = Number(loadStored(this.cfg.storageKey).userYawOffsetDeg);
      this.userYawOffsetDeg = Number.isFinite(stored) ? stored : 0;
    }
    this._snap = true;
  }

  get persistsOffset() {
    return this.source !== SOURCES.DO_REL && this.source !== SOURCES.MOUSE;
  }

  /** ¿Hay rumbo absoluto utilizable? Si no, la alineación manual es obligatoria. */
  get headingKnown() {
    if (this.source === SOURCES.DO_REL) return this.aligned;
    if (this.source === SOURCES.IOS) return this.iosYawOffsetDeg != null || this.aligned;
    return this.source != null;
  }

  /**
   * Estado de la brújula para el HUD: "good" | "fair" | "poor" | "manual" | null (modo arrastre).
   * iOS usa webkitCompassAccuracy; en Android solo se detecta la interferencia.
   */
  get compassQuality() {
    if (!this.source || this.source === SOURCES.MOUSE) return null;
    if (this.source === SOURCES.DO_REL) return "manual";
    if (this.interference.warning) return "poor";
    if (this.source === SOURCES.IOS) {
      const acc = this.raw.compassAccuracy;
      if (this.iosYawOffsetDeg == null || (acc != null && (acc < 0 || acc > this.cfg.ios.maxCompassAccuracyDeg))) return "poor";
      if (this.iosOffsetProvisional || (acc != null && acc > this.cfg.ios.maxCompassAccuracyDeg * 0.6)) return "fair";
    }
    return "good";
  }

  /** Corrección total de rumbo (grados, horaria) que se aplica al yaw de la escena. */
  get correctionDeg() {
    switch (this.source) {
      // Arrastre: ya es rumbo verdadero; la corrección manual solo sirve para probar el asistente.
      case SOURCES.MOUSE:
      case SOURCES.DO_REL: return this.userYawOffsetDeg; // relativo: la alineación absorbe todo
      case SOURCES.IOS: return (this.iosYawOffsetDeg ?? 0) + this.declinationDeg + this.userYawOffsetDeg;
      default: return this.declinationDeg + this.userYawOffsetDeg;
    }
  }

  /** Rumbo verdadero de la cámara tal como se dibuja (el mismo que muestra el HUD). */
  get heading() {
    return headingOf(this.qCurrent);
  }

  /** Rumbo magnético del dispositivo (debug). */
  get magneticHeading() {
    if (this.source === SOURCES.MOUSE || this.source === SOURCES.DO_REL) return null;
    const h = headingOf(this.qDevice);
    return normalizeAngle(this.source === SOURCES.IOS ? h + (this.iosYawOffsetDeg ?? 0) : h);
  }

  onSample(s) {
    if (s.source !== this.source) return;
    this.raw = s;
    if (s.kind === "quat") {
      // AbsoluteOrientationSensor (referenceFrame "screen"): pantalla → marco terrestre.
      // El marco de pantalla coincide con el local de la cámara, así que basta con pasar al mundo.
      this.qDevice.set(s.q[0], s.q[1], s.q[2], s.q[3]).premultiply(Q_EARTH_TO_WORLD);
    } else if (s.kind === "euler") {
      eulerToQuaternion(s.alpha, s.beta, s.gamma, s.screenAngle ?? screenAngle(), this.qDevice);
    } else if (s.kind === "drag") {
      // Rumbo h (horario) = rotación −h sobre +Y; luego cabeceo sobre X local.
      _euler.set(s.pitch * D2R, -s.heading * D2R, 0, "YXZ");
      this.qDevice.setFromEuler(_euler);
    }

    // Giro acumulado del teléfono (grados), para medir el progreso de la calibración "dibuja un 8".
    if (this._hasPrev) {
      const step = this._prevDevice.angleTo(this.qDevice) * R2D;
      if (step < 45) this.motionDeg += step;
    }
    this._prevDevice.copy(this.qDevice);
    this._hasPrev = true;

    const deviceHeading = headingOf(this.qDevice);
    if (this.source === SOURCES.IOS) this.#updateIosOffset(s, deviceHeading);

    if (this.source !== SOURCES.MOUSE && this.source !== SOURCES.DO_REL) {
      const { pitch, roll } = pitchRollOf(this.qDevice);
      const magHeading = this.source === SOURCES.IOS ? s.compassHeading : deviceHeading;
      this.interference.push(s.t ?? performance.now(), magHeading, pitch, roll);
    }

    this.hasSample = true;
    this.#recompute(s.t ?? performance.now());
  }

  /**
   * iOS: alpha es relativo a una referencia arbitraria. webkitCompassHeading da el rumbo
   * magnético; su diferencia con el rumbo relativo de la cámara es el offset de yaw, que se
   * estabiliza con media circular exponencial.
   * VALIDAR EN iPHONE REAL: que webkitCompassHeading con el teléfono vertical corresponda a
   * la dirección de la cámara trasera (se muestra en ?debug=1).
   */
  #updateIosOffset(s, deviceHeading) {
    const { betaMinDeg, betaMaxDeg, maxCompassAccuracyDeg } = this.cfg.ios;
    const ch = s.compassHeading;
    const acc = s.compassAccuracy;
    this.compassPoor = acc != null && (acc < 0 || acc > maxCompassAccuracyDeg);
    if (typeof ch !== "number" || !Number.isFinite(ch) || ch < 0) return;
    const sample = normalizeAngle(ch - deviceHeading);
    const vertical = s.beta >= betaMinDeg && s.beta <= betaMaxDeg;
    // En paisaje no está claro si iOS compensa webkitCompassHeading: solo se estima en retrato.
    const usable = vertical && !this.compassPoor && (s.screenAngle ?? 0) === 0;
    if (this.iosYawOffsetDeg == null) {
      // Primera estimación (provisional): con el teléfono inclinado sin alabeo, la cámara y el
      // borde superior apuntan al mismo azimut, así que es válida aunque aún no esté vertical.
      this.iosYawOffsetDeg = sample;
      this.iosOffsetProvisional = !usable;
    } else if (usable) {
      this.iosYawOffsetDeg = this.iosOffsetProvisional
        ? sample
        : circularLerp(this.iosYawOffsetDeg, sample, this.cfg.smoothing.yawOffsetAlpha);
      this.iosOffsetProvisional = false;
    }
  }

  #recompute(now = performance.now()) {
    const c = this._candidate.copy(this.qDevice).premultiply(_q.setFromAxisAngle(Y_AXIS, -this.correctionDeg * D2R));
    // Filtro de saltos espurios de rumbo (> umbral en un frame) durante jumpHoldMs.
    const h = headingOf(c);
    const { jumpThresholdDeg, jumpHoldMs } = this.cfg.smoothing;
    if (!this._snap && this._acceptedHeading != null && Math.abs(shortestAngleDiff(this._acceptedHeading, h)) > jumpThresholdDeg) {
      this._jumpSince ??= now;
      if (now - this._jumpSince < jumpHoldMs) return;
    }
    this._jumpSince = null;
    this._acceptedHeading = h;
    this.qTarget.copy(c);
  }

  /** Avanza el suavizado un frame. Devuelve el cuaternión de la cámara. */
  update(dtMs) {
    if (!this.hasSample) return this.qCurrent;
    if (this._snap) {
      this.qCurrent.copy(this.qTarget);
      this._snap = false;
      return this.qCurrent;
    }
    if (this.qCurrent.angleTo(this.qTarget) * R2D < this.cfg.smoothing.deadZoneDeg) return this.qCurrent;
    const k = 1 - Math.pow(1 - this.cfg.smoothing.orientationSlerp, Math.min(dtMs, 100) / (1000 / 60));
    this.qCurrent.slerp(this.qTarget, k);
    return this.qCurrent;
  }

  /** Salta el suavizado en el próximo frame (cambios de offset, pruebas). */
  snap() {
    this._snap = true;
    this.#recompute();
  }

  /** Alineación manual: hace que el rumbo actual de la cámara sea `trueBearingDeg`. */
  alignTo(trueBearingDeg) {
    const current = headingOf(this.qTarget);
    this.setUserYawOffset(this.userYawOffsetDeg + shortestAngleDiff(current, trueBearingDeg));
    this.aligned = true;
  }

  setUserYawOffset(deg) {
    this.userYawOffsetDeg = shortestAngleDiff(0, deg);
    if (this.persistsOffset) saveStored(this.cfg.storageKey, { userYawOffsetDeg: this.userYawOffsetDeg });
    this.snap();
  }

  resetUserYawOffset() {
    this.aligned = false;
    this.setUserYawOffset(0);
  }

  setDeclination(deg) {
    this.declinationDeg = deg;
    this.snap();
  }
}

/** Modo sin sensores: arrastrar con ratón/dedo (y flechas del teclado) para girar la vista. */
export class DragInput {
  constructor(element, fusion, getDegPerPx) {
    this.fusion = fusion;
    this.heading = 0;
    this.pitch = 0;
    this.getDegPerPx = getDegPerPx;
    let last = null;
    element.style.touchAction = "none";
    element.addEventListener("pointerdown", (e) => {
      last = { x: e.clientX, y: e.clientY };
      element.setPointerCapture?.(e.pointerId);
    });
    element.addEventListener("pointermove", (e) => {
      if (!last) return;
      const k = this.getDegPerPx();
      this.set(this.heading - (e.clientX - last.x) * k, this.pitch + (e.clientY - last.y) * k);
      last = { x: e.clientX, y: e.clientY };
    });
    const end = () => (last = null);
    element.addEventListener("pointerup", end);
    element.addEventListener("pointercancel", end);
    window.addEventListener("keydown", (e) => {
      const step = e.shiftKey ? 10 : 1;
      const map = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
      const d = map[e.key];
      if (!d || e.target.closest?.("input, select, textarea")) return;
      e.preventDefault();
      this.set(this.heading + d[0], this.pitch + d[1]);
    });
    this.set(0, 0);
  }

  set(heading, pitch) {
    this.heading = normalizeAngle(heading);
    this.pitch = MathUtils.clamp(pitch, -80, 80);
    this.fusion.onSample({ source: SOURCES.MOUSE, kind: "drag", heading: this.heading, pitch: this.pitch, t: performance.now() });
  }
}
