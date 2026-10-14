// Orquestación: bienvenida ligera → permisos dentro del gesto del usuario → vista AR.
// Three.js y el resto del runtime se cargan en diferido (import dinámico) para que la
// primera pantalla sea rápida.
import { CONFIG } from "./config.js";
import { parseLatLng, computeTargets, haversineDistance } from "./geo.js";
import {
  SOURCES, needsIOSPermission, requestOrientationPermission, startOrientation, startCamera,
  GpsTracker, resolvePosition, keepScreenOn, screenAngle,
} from "./sensors.js";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const flag = (name) => params.has(name) && !["0", "false"].includes(params.get(name));
const FLAGS = { debug: flag("debug"), mock: flag("mock") };
const originOverride = parseLatLng(params.get("origin"));
const ORIGIN = originOverride ? { ...CONFIG.origin, ...originOverride, name: "Origen de prueba (?origin=)" } : CONFIG.origin;

// Los PNG pueden tener espacios en el nombre: se codifican al construir la URL.
const siteRoot = new URL("../", import.meta.url);
const imageUrl = (file) => new URL(encodeURIComponent(file), siteRoot).href;

/* ---------- Precarga (mientras el usuario lee la bienvenida) ---------- */

// Descarga + recorte + realce de contraste de los 4 PNG (en un Web Worker si es posible).
let images = null;
function prepareImages() {
  images ??= import("./images.js")
    .then((m) => m.prepareImages(CONFIG, imageUrl))
    .catch((err) => {
      images = null;
      throw err;
    });
  return images;
}

let runtime = null;
function loadRuntime() {
  runtime ??= Promise.all([import("./orientation.js"), import("./ar-scene.js"), import("./ui.js")])
    .then(([o, a, u]) => ({ ...o, ...a, ...u }))
    .catch((err) => {
      runtime = null;
      throw err;
    });
  return runtime;
}

// La precarga (≈1,3 MB entre Three.js y los PNG) espera unos segundos tras `load` para no
// competir con el primer render, o arranca antes si el usuario ya está tocando la pantalla.
let prefetched = false;
function prefetch() {
  if (prefetched) return;
  prefetched = true;
  prepareImages().catch(() => {});
  loadRuntime().catch(() => {});
}
const PREFETCH_DELAY_MS = 3000;
const whenIdle = (fn) => ("requestIdleCallback" in window ? requestIdleCallback(fn, { timeout: 1500 }) : setTimeout(fn, 300));
const schedulePrefetch = () => setTimeout(() => whenIdle(prefetch), PREFETCH_DELAY_MS);
if (document.readyState === "complete") schedulePrefetch();
else addEventListener("load", schedulePrefetch, { once: true });
addEventListener("pointerdown", prefetch, { once: true, passive: true });

/* ---------- Bienvenida ---------- */

const IN_APP_RE = /Instagram|FBAN|FBAV|FB_IAB|FBIOS|WhatsApp|MicroMessenger|WeChat|LinkedInApp|Line\//i;

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch { /* se intenta el método antiguo */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

function showWelcomeMessage(text) {
  const el = $("welcome-msg");
  el.textContent = text;
  el.hidden = false;
}

function initWelcome() {
  if (!window.isSecureContext) {
    showWelcomeMessage("Esta experiencia necesita una conexión segura (HTTPS) para usar la cámara, la brújula y el GPS. Abre el enlace https:// del código QR.");
  }
  if (IN_APP_RE.test(navigator.userAgent)) {
    $("inapp-banner").hidden = false;
    $("copy-link").addEventListener("click", async () => {
      const ok = await copyText(location.href);
      $("copy-link").textContent = ok ? "¡Enlace copiado!" : location.href;
    });
  }
  if (FLAGS.mock) $("start-btn").textContent = "Comenzar (demo)";
  $("start-btn").addEventListener("click", onStart);
}

function onStart() {
  // (a) DEBE ser lo primero del handler, antes de cualquier await: iOS exige el gesto del usuario.
  const orientationPermission = FLAGS.mock ? Promise.resolve("skipped") : requestOrientationPermission();
  const btn = $("start-btn");
  btn.disabled = true;
  btn.textContent = "Preparando…";
  start(orientationPermission).catch((err) => {
    console.error(err);
    $("ar").hidden = true;
    $("welcome").hidden = false;
    btn.disabled = false;
    btn.textContent = "Reintentar";
    showWelcomeMessage(`No se pudo iniciar la experiencia (${err?.message ?? err}). Comprueba tu conexión e inténtalo de nuevo.`);
  });
}

/* ---------- Arranque de la vista AR ---------- */

async function start(orientationPermission) {
  const permission = await orientationPermission;
  const imagesPromise = prepareImages();
  const runtimePromise = loadRuntime();
  const status = { camera: "off", permission };

  // (b) Cámara trasera. Sin cámara → fondo de cielo (CSS) y todo lo demás funciona igual.
  const video = $("cam");
  if (FLAGS.mock) {
    video.hidden = true;
    status.camera = "mock";
  } else {
    try {
      await startCamera(video);
      status.camera = "ok";
    } catch (err) {
      video.hidden = true;
      status.camera = err?.name === "NotAllowedError" ? "denegada" : "no disponible";
    }
  }

  // (c) GPS: opcional. Denegado o sin fix → se usa el origen fijo, sin avisos de error.
  let onGps = () => {};
  const gps = new GpsTracker(CONFIG, () => onGps());
  if (!FLAGS.mock && CONFIG.positionMode !== "fixed") gps.start();

  // (d) Pantalla siempre encendida.
  const wake = keepScreenOn();

  const rt = await runtimePromise;
  $("welcome").hidden = true;
  $("ar").hidden = false;

  const fusion = new rt.OrientationFusion(CONFIG);
  const scene = new rt.ArScene($("gl"), CONFIG);

  // Ajuste fino por punto (?debug=1 → "Ajuste fino por punto"): solo bearingOffsetDeg pasa por
  // computeTargets (afecta displayBearing, no el trueBearing geodésico); elevación y ancho
  // angular se aplican directo sobre el sprite en ar-scene.js.
  const bearingOverrides = new Map(CONFIG.points.map((p) => [p.id, p.bearingOffsetDeg || 0]));
  const pointsWithOverrides = () => CONFIG.points.map((p) => ({ ...p, bearingOffsetDeg: bearingOverrides.get(p.id) }));

  const ui = new rt.Ui({
    config: CONFIG, fusion, scene, copyText,
    getDiagnostics: () => diagnostics(),
    onFovChange: (v) => {
      scene.setLongSideFov(v);
      ui.resize();
    },
    onPointOverride: (id, field, value) => {
      if (field === "elevationDeg") scene.setElevation(id, value);
      else if (field === "angularWidthDeg") scene.setAngularWidth(id, value);
      else if (field === "bearingOffsetDeg") {
        bearingOverrides.set(id, value);
        targets = computeTargets(effective.position, pointsWithOverrides(), CONFIG);
        scene.setTargets(targets, true);
        ui.setTargets(targets);
      }
    },
  });

  // Posición efectiva y rumbos.
  let effective = resolvePosition(CONFIG, ORIGIN, gps);
  let targets = computeTargets(effective.position, pointsWithOverrides(), CONFIG);
  ui.setTargets(targets);

  // Sprites: cada imagen se añade en cuanto termina su preparación (normalmente ya está lista
  // porque se procesó durante la bienvenida); el arranque no espera por ellas.
  const preparedImages = await imagesPromise;
  let pendingImages = CONFIG.points.length;
  const slowNotice = setTimeout(() => pendingImages && ui.toast("Preparando imágenes…", 8000), 600);
  const missing = [];
  CONFIG.points.forEach((p, i) => {
    preparedImages
      .get(p.id)
      .then((variants) => {
        scene.addPoint(p, variants, i, ui.contrastMode);
        scene.setTargets(targets.filter((t) => t.id === p.id));
      })
      .catch((err) => {
        console.warn(`No se pudo preparar ${p.image}:`, err);
        missing.push(p.label);
      })
      .finally(() => {
        if (--pendingImages) return;
        clearTimeout(slowNotice);
        if (missing.length) ui.toast(`No se pudo cargar: ${missing.join(", ")}`, 6000);
        else if (!ui.toastEl.hidden && ui.toastEl.textContent.startsWith("Preparando")) ui.toast("Imágenes listas", 1200);
      });
  });
  onGps = () => {
    const next = resolvePosition(CONFIG, ORIGIN, gps, effective.usingGps);
    const moved = next.usingGps && effective.usingGps && haversineDistance(next.position, effective.position) > 5;
    if (next.usingGps !== effective.usingGps || moved) {
      if (next.usingGps && !effective.usingGps) ui.toast("Estás lejos del punto de escaneo; las direcciones se ajustaron a tu ubicación.", 6000);
      effective = next;
      targets = computeTargets(effective.position, pointsWithOverrides(), CONFIG);
      scene.setTargets(targets, true);
      ui.setTargets(targets);
    } else {
      effective = { ...effective, distanceToOriginM: next.distanceToOriginM };
    }
  };
  onGps();

  // Orientación: detección de la mejor fuente disponible.
  let orientationDiag = null;
  let orientation = null;
  if (!FLAGS.mock && permission !== "denied") {
    orientation = await startOrientation(
      (s) => fusion.onSample(s),
      (err) => console.warn("Error del sensor de orientación:", err),
    );
    orientationDiag = orientation.diag;
  }
  let drag = null;
  if (orientation?.source) {
    fusion.setSource(orientation.source);
  } else {
    fusion.setSource(SOURCES.MOUSE);
    drag = new rt.DragInput($("gl"), fusion, () => scene.hFovDeg / scene.width);
  }
  ui.setSource(fusion.source, { iosDenied: permission === "denied" });

  // Reintento en segundo plano: en frío, algunos teléfonos tardan varios segundos en entregar
  // la primera lectura del sensor. Si seguimos en modo arrastre sin que el permiso haya sido
  // denegado, se reintenta unas veces y, si aparece, se cambia de fuente sin recargar la página.
  if (!FLAGS.mock && fusion.source === SOURCES.MOUSE && permission !== "denied") {
    let attempts = 0;
    const MAX_ATTEMPTS = 5;
    const retry = async () => {
      if (fusion.source !== SOURCES.MOUSE || ++attempts > MAX_ATTEMPTS) return;
      const found = await startOrientation((s) => fusion.onSample(s), () => {});
      orientationDiag = found.diag;
      if (found.source && fusion.source === SOURCES.MOUSE) {
        fusion.setSource(found.source);
        ui.setSource(fusion.source, { iosDenied: false });
        ui.toast(`Brújula detectada (${found.source}). Ya no necesitas arrastrar.`, 4500);
        return;
      }
      if (attempts < MAX_ATTEMPTS) setTimeout(retry, 5000);
    };
    setTimeout(retry, 5000);
  }

  if (FLAGS.debug) ui.initDebug();

  const onResize = () => {
    scene.resize();
    ui.resize();
  };
  addEventListener("resize", onResize);
  addEventListener("orientationchange", () => setTimeout(onResize, 250));
  screen.orientation?.addEventListener?.("change", onResize);

  let last = performance.now();
  const frame = (now) => {
    const dt = now - last;
    last = now;
    const q = fusion.update(dt);
    // Las imágenes aparecen al pasar al paso "Dirección" del asistente (para poder comparar).
    if (!scene.shown && fusion.hasSample && fusion.headingKnown && ui.spritesAllowed) scene.show();
    const t = now / 1000;
    scene.render(q, t);
    ui.update(fusion.heading, scene.project(t));
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // Mensajes según el modo resultante.
  if (fusion.source === SOURCES.MOUSE) {
    if (FLAGS.mock) {
      ui.toast("Modo demo: arrastra (o usa las flechas) para girar la vista.", 4000);
    } else if (permission === "denied" && needsIOSPermission()) {
      ui.showStatus(
        "Sin acceso al movimiento del teléfono. Puedes arrastrar para girar, o activarlo en Ajustes → Safari → Movimiento y orientación y recargar la página.",
        [{ label: "Recargar", onClick: () => location.reload() }],
      );
    } else {
      ui.toast("No se detectó brújula todavía: arrastra para girar. Seguimos buscando en segundo plano.", 6000);
    }
  } else {
    // Asistente obligatorio al entrar (cada paso se puede omitir, salvo alinear si no hay norte).
    await ui.runGuide({ start: "calibrate" });
  }

  if (status.camera === "denegada" || status.camera === "no disponible") {
    ui.showStatus(
      status.camera === "denegada"
        ? "Sin acceso a la cámara: verás las imágenes sobre un cielo de referencia. Para usar la cámara, permite el acceso en el navegador y recarga."
        : "No se encontró cámara: verás las imágenes sobre un cielo de referencia.",
      status.camera === "denegada" ? [{ label: "Recargar", primary: true, onClick: () => location.reload() }] : [],
    );
  }

  function diagnostics() {
    const qc = fusion.qCurrent;
    const { pitch } = rt.pitchRollOf(qc);
    const heading = fusion.heading;
    return {
      time: new Date().toISOString(),
      userAgent: navigator.userAgent,
      flags: FLAGS,
      source: fusion.source,
      permission: status.permission,
      raw: {
        alpha: fusion.raw.alpha, beta: fusion.raw.beta, gamma: fusion.raw.gamma,
        quaternion: fusion.raw.q, compassHeading: fusion.raw.compassHeading, compassAccuracy: fusion.raw.compassAccuracy,
      },
      screenAngle: screenAngle(),
      magneticHeading: fusion.magneticHeading,
      declinationDeg: fusion.declinationDeg,
      iosYawOffsetDeg: fusion.iosYawOffsetDeg,
      iosOffsetProvisional: fusion.iosOffsetProvisional,
      userYawOffsetDeg: fusion.userYawOffsetDeg,
      trueHeading: heading,
      pitch,
      interference: { warning: fusion.interference.warning, spread: fusion.interference.spread },
      compassQuality: fusion.compassQuality,
      orientationDiag,
      motionDeg: fusion.motionDeg,
      contrastMode: ui.contrastMode,
      textureSizes: [...scene.items.values()].map((it) => it.textureSize),
      gps: { status: gps.status, fix: gps.fix, last: gps.last },
      positionMode: CONFIG.positionMode,
      usingGps: effective.usingGps,
      position: effective.position,
      distanceToOriginM: effective.distanceToOriginM,
      origin: ORIGIN,
      targets: targets.map((t) => ({
        id: t.id, label: t.label, image: t.image,
        trueBearing: t.trueBearing, displayBearing: t.displayBearing,
        offsetFromView: ((t.displayBearing - heading + 540) % 360) - 180,
        distanceKm: t.distanceM / 1000,
      })),
      // Valores efectivos actuales por punto (base de config.js + ajustes en vivo del panel).
      pointOverrides: CONFIG.points.map((p) => {
        const item = scene.items.get(p.id);
        return {
          id: p.id, label: p.label,
          elevationDeg: item?.elevationDeg ?? p.elevationDeg,
          angularWidthDeg: item?.angularWidthDeg ?? p.angularWidthDeg,
          bearingOffsetDeg: bearingOverrides.get(p.id) ?? 0,
        };
      }),
      fovV: scene.vFovDeg,
      fovH: scene.hFovDeg,
      longSideFovDeg: scene.longSideFovDeg,
      camera: status.camera,
      wakeLock: wake.active,
      fps: ui.fps,
    };
  }

  // API de pruebas en escritorio (?mock=1 o ?debug=1).
  if (FLAGS.mock || FLAGS.debug) {
    window.cuatroPuntos = {
      /** Fija el rumbo (modo arrastre) y actualiza la cámara de forma síncrona. */
      setHeading(heading, pitch = 0) {
        drag?.set(heading, pitch);
        fusion.snap();
        scene.render(fusion.update(0), performance.now() / 1000);
        return fusion.heading;
      },
      get heading() {
        return fusion.heading;
      },
      project: () => scene.project(performance.now() / 1000),
      openGuide: (start = "calibrate") => ui.runGuide({ start }),
      diagnostics,
    };
  }
}

initWelcome();
