// HUD y paneles de la vista AR: brújula, indicadores de borde, etiquetas de distancia,
// asistente de calibración (brújula → dirección con la mira), estado de la brújula,
// contraste de las imágenes, ayuda, avisos y panel de debug (?debug=1).
import { shortestAngleDiff, cardinalName, formatDistance, normalizeAngle } from "./geo.js";
import { SOURCES } from "./sensors.js";
import { CONTRAST_MODES, CONTRAST_LABELS } from "./enhance.js";

const $ = (id) => document.getElementById(id);
const WARNING_COOLDOWN_MS = 20000;
const QUALITY_LABELS = { good: "Brújula OK", fair: "Brújula regular", poor: "Calibrar brújula", manual: "Brújula manual" };
const fmtDeg = (v, digits = 1) => `${new Intl.NumberFormat("es-CO", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v)}°`;

function loadPref(key, name) {
  try {
    return JSON.parse(localStorage.getItem(key))?.[name];
  } catch {
    return undefined;
  }
}
function savePref(key, name, value) {
  try {
    const data = JSON.parse(localStorage.getItem(key)) ?? {};
    data[name] = value;
    localStorage.setItem(key, JSON.stringify(data));
  } catch { /* almacenamiento no disponible */ }
}

export class Ui {
  /** deps: { config, fusion, scene, copyText, getDiagnostics, onFovChange } */
  constructor(deps) {
    Object.assign(this, deps);
    this.ar = $("ar");
    this.targets = [];
    this.labels = new Map();
    this.lastWarningAt = 0;
    this.fps = 0;
    this._frames = 0;
    this._fpsSince = performance.now();
    this._tapeHeading = null;
    this._slowTick = 0;
    this.guide = null;

    this.tape = $("compass-tape");
    this.tapeCtx = this.tape.getContext("2d");
    this.toastEl = $("toast");
    this.statusEl = $("status-card");

    const stored = loadPref(this.config.storageKey, "contrastMode");
    this.contrastMode = CONTRAST_MODES.includes(stored) ? stored : this.config.contrast.mode;
    this.ar.style.setProperty("--cam-dim", this.config.contrast.cameraDim);
    this.ar.dataset.contrast = this.contrastMode;

    this.#initGuide();
    this.#initActions();
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = this.tape.getBoundingClientRect();
    this.tape.width = Math.round(r.width * dpr);
    this.tape.height = Math.round(r.height * dpr);
    this.tapeCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._tapeHeading = null;
  }

  setTargets(targets) {
    this.targets = targets;
    const labelsEl = $("labels");
    for (const t of targets) {
      let el = this.labels.get(t.id);
      if (!el) {
        el = document.createElement("div");
        el.className = "dist-label";
        el.hidden = true;
        labelsEl.appendChild(el);
        this.labels.set(t.id, el);
      }
      el.textContent = formatDistance(t.distanceM);
    }
    this._tapeHeading = null;
  }

  setSource(source, { iosDenied = false } = {}) {
    const sensorless = source === SOURCES.MOUSE;
    $("help-source").textContent = source ?? "ninguno";
    $("help-ios").hidden = !(iosDenied || source === SOURCES.IOS);
    $("btn-align").hidden = sensorless;
    $("btn-compass").hidden = sensorless;
    $("help-calibrate").hidden = sensorless;
  }

  /* ---------- Por frame ---------- */

  update(heading, projections) {
    this.#countFps();
    $("heading-deg").textContent = `${Math.round(normalizeAngle(heading)) % 360}°`;
    $("heading-card").textContent = cardinalName(heading);
    if (this._tapeHeading == null || Math.abs(shortestAngleDiff(this._tapeHeading, heading)) > 0.1) {
      this.#drawTape(heading);
      this._tapeHeading = heading;
    }

    const shown = this.scene.shown;
    let nearest = null;
    for (const p of projections) {
      const label = this.labels.get(p.id);
      const visible = shown && this.config.showDistanceLabel && p.onScreen && p.label.inFront;
      if (label) {
        label.hidden = !visible;
        if (visible) label.style.transform = `translate(${p.label.x}px, ${p.label.y}px) translate(-50%, 0)`;
      }
      if (!p.onScreen) {
        const d = shortestAngleDiff(heading, p.bearing);
        if (!nearest || Math.abs(d) < Math.abs(nearest.d)) nearest = { id: p.id, d };
      }
    }
    // Indicador hacia el punto fuera de pantalla más cercano angularmente.
    const showEdge = shown && nearest && Math.abs(nearest.d) > this.scene.hFovDeg / 2;
    const target = showEdge ? this.targets.find((t) => t.id === nearest.id) : null;
    this.#setEdge($("edge-left"), target && nearest.d < 0 ? target.label : null);
    this.#setEdge($("edge-right"), target && nearest.d >= 0 ? target.label : null);
    const anyOnScreen = projections.some((p) => p.onScreen);
    $("edge-left").style.opacity = $("edge-right").style.opacity = anyOnScreen ? "0.7" : "1";

    if (this.guide) this.#tickGuide(heading);
    if (performance.now() - this._slowTick > 400) {
      this._slowTick = performance.now();
      this.#updateCompassStatus();
    }
  }

  #setEdge(el, name) {
    el.hidden = !name;
    if (name) el.querySelector(".edge-name").textContent = name;
  }

  #countFps() {
    this._frames++;
    const now = performance.now();
    if (now - this._fpsSince >= 1000) {
      this.fps = (this._frames * 1000) / (now - this._fpsSince);
      this._frames = 0;
      this._fpsSince = now;
    }
  }

  #drawTape(heading) {
    const ctx = this.tapeCtx;
    const w = this.tape.clientWidth, h = this.tape.clientHeight;
    const span = 120; // grados visibles en la cinta
    const pxPerDeg = w / span;
    const x = (deg) => w / 2 + shortestAngleDiff(heading, deg) * pxPerDeg;
    ctx.clearRect(0, 0, w, h);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineCap = "round";

    const start = Math.floor((heading - span / 2) / 5) * 5;
    for (let d = start; d <= heading + span / 2; d += 5) {
      const deg = normalizeAngle(d);
      const px = x(deg);
      const major = deg % 45 === 0;
      const mid = deg % 15 === 0;
      ctx.strokeStyle = "rgba(255,255,255,0.75)";
      ctx.lineWidth = major ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(px, h);
      ctx.lineTo(px, h - (major ? 12 : mid ? 8 : 5));
      ctx.stroke();
      if (major) {
        const name = cardinalName(deg);
        ctx.font = `800 11px Montserrat, system-ui, sans-serif`;
        ctx.fillStyle = name === "N" ? "#ff8a5c" : "rgba(255,255,255,0.9)";
        ctx.fillText(name, px, 8);
      }
    }

    ctx.font = "600 10px Montserrat, system-ui, sans-serif";
    for (const t of this.targets) {
      const px = x(t.displayBearing);
      if (px < -40 || px > w + 40) continue;
      ctx.fillStyle = "#ff8a5c";
      ctx.beginPath();
      ctx.moveTo(px, h - 14);
      ctx.lineTo(px - 5, h - 22);
      ctx.lineTo(px + 5, h - 22);
      ctx.closePath();
      ctx.fill();
      ctx.fillText(t.label, px, h - 22);
    }

    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(w / 2, h);
    ctx.lineTo(w / 2, h - 16);
    ctx.stroke();
  }

  /* ---------- Avisos ---------- */

  toast(message, ms = 4000) {
    clearTimeout(this._toastTimer);
    this.toastEl.textContent = message;
    this.toastEl.hidden = false;
    this._toastTimer = setTimeout(() => (this.toastEl.hidden = true), ms);
  }

  /** Tarjeta persistente con texto y botones [{label, onClick, primary}]. Los botones la cierran. */
  showStatus(text, actions = [], { dismissible = true } = {}) {
    this.statusEl.replaceChildren();
    const p = document.createElement("div");
    p.textContent = text;
    this.statusEl.appendChild(p);
    const all = dismissible ? [...actions, { label: "Cerrar" }] : actions;
    for (const a of all) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `btn btn-small${a.primary ? " btn-primary" : ""}`;
      b.textContent = a.label;
      b.addEventListener("click", () => {
        this.hideStatus();
        a.onClick?.();
      });
      this.statusEl.appendChild(b);
    }
    this.statusEl.hidden = false;
  }

  hideStatus() {
    this.statusEl.hidden = true;
  }

  #updateCompassStatus() {
    const q = this.fusion.compassQuality;
    const btn = $("btn-compass");
    if (!q) return;
    if (btn.dataset.quality !== q) {
      btn.dataset.quality = q;
      $("compass-label").textContent = QUALITY_LABELS[q];
      btn.setAttribute("aria-label", `${QUALITY_LABELS[q]}. Toca para calibrar`);
    }
    // Aviso accionable si la brújula se degrada durante la experiencia.
    const now = performance.now();
    if (q === "poor" && !this.guide && this.scene.shown && now - this.lastWarningAt > WARNING_COOLDOWN_MS) {
      this.lastWarningAt = now;
      const msg = this.fusion.interference.warning
        ? "La brújula está inestable (¿metal o parlantes cerca?). Aléjate un poco y calíbrala."
        : "La precisión de la brújula es baja. Calíbrala dibujando un 8 con el teléfono.";
      this.showStatus(msg, [{ label: "Calibrar", primary: true, onClick: () => this.runGuide({ start: "calibrate" }) }]);
    }
  }

  /* ---------- Contraste ---------- */

  #setContrast(mode, announce = true) {
    this.contrastMode = mode;
    this.ar.dataset.contrast = mode;
    this.scene.setContrastMode(mode);
    savePref(this.config.storageKey, "contrastMode", mode);
    $("btn-contrast").setAttribute("aria-label", `Contraste: ${CONTRAST_LABELS[mode]}. Toca para cambiar`);
    if (announce) this.toast(`Contraste: ${CONTRAST_LABELS[mode]}`, 1800);
  }

  /* ---------- Acciones y ayuda ---------- */

  #initActions() {
    $("btn-contrast").addEventListener("click", () => {
      const i = CONTRAST_MODES.indexOf(this.contrastMode);
      this.#setContrast(CONTRAST_MODES[(i + 1) % CONTRAST_MODES.length]);
    });
    this.#setContrast(this.contrastMode, false);
    $("btn-align").addEventListener("click", () => this.runGuide({ start: "verify" }));
    $("btn-compass").addEventListener("click", () => this.runGuide({ start: "calibrate" }));
    $("btn-help").addEventListener("click", () => ($("help-panel").hidden = false));
    $("help-close").addEventListener("click", () => ($("help-panel").hidden = true));
    $("help-calibrate").addEventListener("click", () => {
      $("help-panel").hidden = true;
      this.runGuide({ start: "calibrate" });
    });
  }

  /* ---------- Asistente de calibración ---------- */

  #initGuide() {
    const select = $("verify-point");
    for (const p of this.config.points) {
      const o = document.createElement("option");
      o.value = p.id;
      o.textContent = p.label;
      select.appendChild(o);
    }
    const ref = this.config.calibration.referencePointId;
    select.value = this.config.points.some((p) => p.id === ref) ? ref : this.config.points[0].id;
    select.addEventListener("change", () => this.#refreshVerifyText());

    const toVerify = () => this.#showStep("verify");
    $("calib-skip").addEventListener("click", toVerify);
    $("calib-next").addEventListener("click", toVerify);

    $("verify-align").addEventListener("click", () => {
      const t = this.#referenceTarget();
      if (!t || !this.guide) return;
      this.fusion.alignTo(t.trueBearing);
      this.guide.aligned = true;
      this.#refreshFine();
      this.toast(`Alineado con ${t.label}. Si hace falta, ajusta con ◀ ▶`, 3500);
    });
    // Subir el offset hace que la cámara "crea" mirar más al este → las imágenes se mueven a la izquierda.
    $("fine-left").addEventListener("click", () => this.#nudge(+1));
    $("fine-right").addEventListener("click", () => this.#nudge(-1));
    $("verify-reset").addEventListener("click", () => {
      if (!this.guide) return;
      this.fusion.resetUserYawOffset();
      this.guide.aligned = false;
      this.#refreshFine();
      this.toast("Corrección manual restablecida", 2000);
    });
    const finish = () => this.#finishGuide();
    $("verify-ok").addEventListener("click", finish);
    $("verify-skip").addEventListener("click", finish);
  }

  /**
   * Abre el asistente. start: "calibrate" (brújula y luego dirección) o "verify" (solo dirección).
   * Devuelve una promesa que se resuelve al terminar. Si no hay rumbo absoluto, no se puede
   * terminar sin alinear.
   */
  runGuide({ start = "calibrate" } = {}) {
    if (this.guide) {
      this.#showStep(start);
      return this.guide.promise;
    }
    let resolve;
    const promise = new Promise((r) => (resolve = r));
    this.guide = { promise, resolve, step: null, aligned: false };
    $("help-panel").hidden = true;
    this.hideStatus();
    this.ar.dataset.guide = "open";
    $("guide").hidden = false;
    this.#showStep(start);
    return promise;
  }

  get guideOpen() {
    return !!this.guide;
  }

  /** Las imágenes se muestran fuera del asistente o desde su paso "Dirección". */
  get spritesAllowed() {
    return !this.guide || this.guide.step === "verify";
  }

  #showStep(step) {
    const g = this.guide;
    g.step = step;
    for (const li of document.querySelectorAll(".guide-steps li")) {
      li.classList.toggle("active", li.dataset.step === step);
      li.classList.toggle("done", step === "verify" && li.dataset.step === "calibrate");
    }
    $("guide-calibrate").hidden = step !== "calibrate";
    $("guide-verify").hidden = step !== "verify";
    $("reticle").toggleAttribute("hidden", step !== "verify"); // SVG: sin propiedad .hidden
    if (step === "calibrate") {
      g.calib = { startMotion: this.fusion.motionDeg, startTime: performance.now(), complete: false, advanceAt: null };
      $("calib-bar").style.width = "0%";
      $("calib-bar").classList.remove("complete");
      $("calib-next").disabled = true;
      $("calib-status").textContent = "Empieza a mover el teléfono…";
    } else {
      this.#refreshVerifyText();
      this.#refreshFine();
    }
  }

  #tickGuide(heading) {
    const g = this.guide;
    const now = performance.now();
    if (g.step === "calibrate") {
      const c = g.calib;
      const { motionTargetDeg, minMs, allowContinueAfterMs } = this.config.calibration;
      const progress = Math.min(1, (this.fusion.motionDeg - c.startMotion) / motionTargetDeg);
      const elapsed = now - c.startTime;
      const isIOS = this.fusion.source === SOURCES.IOS;
      const acc = this.fusion.raw.compassAccuracy;
      const accKnown = isIOS && typeof acc === "number";
      const accOk = !isIOS || (accKnown && acc >= 0 && acc <= this.config.ios.maxCompassAccuracyDeg);
      const accText = accKnown ? (acc < 0 ? " · precisión: sin calibrar" : ` · precisión ±${Math.round(acc)}°`) : "";
      const complete = progress >= 1 && elapsed >= minMs && accOk;

      $("calib-bar").style.width = `${Math.round(progress * 100)}%`;
      $("calib-bar").parentElement.setAttribute("aria-valuenow", Math.round(progress * 100));
      if (complete && !c.complete) {
        c.complete = true;
        c.advanceAt = now + 900;
        $("calib-bar").classList.add("complete");
        $("calib-status").textContent = `✓ Brújula calibrada${accText}`;
        $("calib-next").disabled = false;
      } else if (!c.complete) {
        let text;
        if (progress < 0.05) text = "Empieza a mover el teléfono…";
        else if (progress < 1) text = `Sigue así… ${Math.round(progress * 100)} %${accText}`;
        else text = `Un poco más: la precisión aún es baja${accText}`;
        if (elapsed > allowContinueAfterMs) {
          text += " · puedes continuar";
          $("calib-next").disabled = false;
        }
        $("calib-status").textContent = text;
      }
      if (c.advanceAt && now >= c.advanceAt) this.#showStep("verify");
    } else if (g.step === "verify" && now - (g.lastVerifyText ?? 0) > 120) {
      g.lastVerifyText = now;
      this.#refreshVerifyState(heading);
    }
  }

  #referenceTarget() {
    return this.targets.find((t) => t.id === $("verify-point").value);
  }

  #refreshVerifyText() {
    const p = this.config.points.find((x) => x.id === $("verify-point").value);
    if (p) $("verify-place").textContent = p.place;
  }

  #refreshVerifyState(heading) {
    const t = this.#referenceTarget();
    const known = this.fusion.headingKnown;
    const el = $("verify-offset");
    $("verify-mandatory").hidden = known;
    $("verify-ok").disabled = !known;
    $("verify-skip").hidden = !known;
    $("verify-align").classList.toggle("btn-primary", !known);
    $("verify-ok").textContent = this.guide.aligned ? "Listo" : "Coincide ✓";
    if (!t) return;
    if (!known) {
      el.textContent = "Las imágenes aparecerán cuando alinees con la mira.";
      el.classList.remove("ok");
      return;
    }
    const d = shortestAngleDiff(heading, t.displayBearing);
    if (Math.abs(d) < 1.5) {
      el.textContent = `✓ «${t.label}» está en la mira. ¿Coincide con el lugar real?`;
      el.classList.add("ok");
    } else {
      el.textContent = `«${t.label}» está ${fmtDeg(Math.abs(d), 0)} a la ${d > 0 ? "derecha" : "izquierda"} de la mira`;
      el.classList.remove("ok");
    }
  }

  #nudge(deg) {
    this.fusion.setUserYawOffset(this.fusion.userYawOffsetDeg + deg);
    this.#refreshFine();
  }

  #refreshFine() {
    const v = this.fusion.userYawOffsetDeg;
    $("fine-value").textContent = `${v > 0 ? "+" : ""}${fmtDeg(v)}`;
    $("verify-fine").hidden = !(this.guide?.aligned || Math.abs(v) > 0.05);
    this._dbgSync?.[2]();
  }

  #finishGuide() {
    if (!this.guide || !this.fusion.headingKnown) return;
    const { resolve } = this.guide;
    this.guide = null;
    $("guide").hidden = true;
    $("reticle").setAttribute("hidden", "");
    delete this.ar.dataset.guide;
    resolve();
  }

  /* ---------- Debug (?debug=1) ---------- */

  initDebug() {
    const el = $("debug");
    el.hidden = false;
    const pointsHtml = this.config.points
      .map(
        (p) => `
      <fieldset class="dbg-point">
        <legend>${p.label}</legend>
        <label>Elevación <input id="dbg-el-${p.id}" type="range" min="-10" max="45" step="0.5"><span id="dbg-el-${p.id}-v"></span></label>
        <label>Ancho <input id="dbg-aw-${p.id}" type="range" min="10" max="60" step="0.5"><span id="dbg-aw-${p.id}-v"></span></label>
        <label>Rumbo Δ <input id="dbg-bo-${p.id}" type="range" min="-30" max="30" step="0.2"><span id="dbg-bo-${p.id}-v"></span></label>
      </fieldset>`,
      )
      .join("");
    el.innerHTML = `
      <strong>Cuatro Puntos · debug</strong>
      <div id="dbg-body"></div>
      <label>Declinación <input id="dbg-decl" type="range" min="-20" max="10" step="0.1"><span id="dbg-decl-v"></span></label>
      <label>FOV lado largo <input id="dbg-fov" type="range" min="35" max="90" step="0.5"><span id="dbg-fov-v"></span></label>
      <label>Offset yaw usuario <input id="dbg-yaw" type="range" min="-180" max="180" step="0.5"><span id="dbg-yaw-v"></span></label>
      <button id="dbg-copy" class="btn" type="button">Copiar diagnóstico</button>
      <button id="dbg-hide" class="btn" type="button">Ocultar</button>
      <strong>Ajuste fino por punto</strong>
      ${pointsHtml}
      <button id="dbg-copy-points" class="btn" type="button">Copiar valores de los puntos</button>`;
    const bind = (id, get, set, fmt) => {
      const input = $(id);
      const out = $(`${id}-v`);
      const sync = () => {
        input.value = get();
        out.textContent = fmt(get());
      };
      input.addEventListener("input", () => {
        set(Number(input.value));
        out.textContent = fmt(Number(input.value));
      });
      sync();
      return sync;
    };
    const fmt1 = (v) => `${Number(v).toFixed(1)}°`;
    this._dbgSync = [
      bind("dbg-decl", () => this.fusion.declinationDeg, (v) => this.fusion.setDeclination(v), fmt1),
      bind("dbg-fov", () => this.scene.longSideFovDeg, (v) => this.onFovChange(v), fmt1),
      bind("dbg-yaw", () => this.fusion.userYawOffsetDeg, (v) => this.fusion.setUserYawOffset(v), fmt1),
    ];
    $("dbg-copy").addEventListener("click", async () => {
      const ok = await this.copyText(JSON.stringify(this.getDiagnostics(), null, 2));
      this.toast(ok ? "Diagnóstico copiado" : "No se pudo copiar", 2000);
    });
    $("dbg-hide").addEventListener("click", () => (el.hidden = true));

    // Ajuste fino por punto: estado local que arranca en los valores de config.js y se
    // empuja a la escena/geo en vivo vía onPointOverride (main.js).
    const pointState = new Map(
      this.config.points.map((p) => [p.id, { elevationDeg: p.elevationDeg, angularWidthDeg: p.angularWidthDeg, bearingOffsetDeg: p.bearingOffsetDeg || 0 }]),
    );
    for (const p of this.config.points) {
      const st = pointState.get(p.id);
      const field = (key, dbgId) =>
        bind(dbgId, () => st[key], (v) => { st[key] = v; this.onPointOverride(p.id, key, v); }, fmt1);
      this._dbgSync.push(field("elevationDeg", `dbg-el-${p.id}`));
      this._dbgSync.push(field("angularWidthDeg", `dbg-aw-${p.id}`));
      this._dbgSync.push(field("bearingOffsetDeg", `dbg-bo-${p.id}`));
    }
    $("dbg-copy-points").addEventListener("click", async () => {
      const lines = this.config.points.map((p) => {
        const st = pointState.get(p.id);
        return `    { id: "${p.id}", label: "${p.label}", place: "${p.place}", lat: ${p.lat}, lng: ${p.lng}, image: "${p.image}", elevationDeg: ${st.elevationDeg.toFixed(1)}, angularWidthDeg: ${st.angularWidthDeg.toFixed(1)}, bearingOffsetDeg: ${st.bearingOffsetDeg.toFixed(1)} },`;
      });
      const ok = await this.copyText(`points: [\n${lines.join("\n")}\n  ],`);
      this.toast(ok ? "Copiado: pégalo como \"points\" en config.js" : "No se pudo copiar", 3000);
    });

    setInterval(() => this.#renderDebug(), 250);
  }

  #fmtOrientationDiag(diag) {
    if (!diag) return "—";
    const parts = [];
    if (diag.aos) {
      const a = diag.aos;
      parts.push(`AOS: ${a.supported ? (a.result ?? "…") : "no soportado"}${a.permissions ? ` (${Object.entries(a.permissions).map(([k, v]) => `${k}:${v}`).join(", ")})` : ""}`);
    }
    if (diag.events) {
      const e = diag.events;
      parts.push(`Eventos: ${e.result ?? "…"} (DOA api:${e.hasDeviceOrientationAbsoluteApi ? "sí" : "no"}, deviceorientationabsolute ${e.doaEventsValid ?? 0}/${e.doaEventsTotal ?? 0} válidos, deviceorientation ${e.doEventsValid ?? 0}/${e.doEventsTotal ?? 0} válidos)`);
    }
    return parts.join(" · ") || "—";
  }

  #renderDebug() {
    if ($("debug").hidden) return;
    const d = this.getDiagnostics();
    const n = (v, digits = 1) => (v == null || !Number.isFinite(v) ? "—" : Number(v).toFixed(digits));
    const rows = d.targets
      .map((t) => `<tr><td>${t.label}</td><td>${n(t.trueBearing)}°</td><td>${n(t.displayBearing)}°</td><td>${n(t.offsetFromView)}°</td><td>${n(t.distanceKm, 2)} km</td></tr>`)
      .join("");
    $("dbg-body").innerHTML = `
      <table>
        <tr><td>Fuente</td><td>${d.source ?? "—"} · brújula ${d.compassQuality ?? "—"}</td></tr>
        <tr><td>α / β / γ</td><td>${n(d.raw.alpha)} / ${n(d.raw.beta)} / ${n(d.raw.gamma)}</td></tr>
        <tr><td>webkitCompassHeading</td><td>${n(d.raw.compassHeading)}° (±${n(d.raw.compassAccuracy, 0)})</td></tr>
        <tr><td>Rumbo magnético</td><td>${n(d.magneticHeading)}°</td></tr>
        <tr><td>Declinación</td><td>${n(d.declinationDeg)}°</td></tr>
        <tr><td>yawOffset iOS</td><td>${n(d.iosYawOffsetDeg)}°${d.iosOffsetProvisional ? " (provisional)" : ""}</td></tr>
        <tr><td>userYawOffset</td><td>${n(d.userYawOffsetDeg)}°</td></tr>
        <tr><td><b>Rumbo verdadero cámara</b></td><td><b>${n(d.trueHeading)}°</b> · cabeceo ${n(d.pitch)}°</td></tr>
        <tr><td>Interferencia</td><td>${d.interference.warning ? "SÍ" : "no"} (dispersión ${n(d.interference.spread)}°)</td></tr>
        <tr><td>Movimiento acumulado</td><td>${n(d.motionDeg, 0)}°</td></tr>
        <tr><td>Diagnóstico orientación</td><td>${this.#fmtOrientationDiag(d.orientationDiag)}</td></tr>
        <tr><td>GPS</td><td>${d.gps.status} ${d.gps.fix ? `${n(d.gps.fix.lat, 6)}, ${n(d.gps.fix.lng, 6)} ±${n(d.gps.fix.accuracy, 0)} m` : ""}</td></tr>
        <tr><td>GPS crudo</td><td>${d.gps.last ? `±${n(d.gps.last.accuracy, 0)} m` : "—"}</td></tr>
        <tr><td>Posición efectiva</td><td>${d.positionMode} → ${d.usingGps ? "GPS" : "origen fijo"}${d.distanceToOriginM != null ? ` (${n(d.distanceToOriginM, 0)} m del origen)` : ""}</td></tr>
        <tr><td>FOV v / h</td><td>${n(d.fovV)}° / ${n(d.fovH)}°</td></tr>
        <tr><td>Contraste · textura</td><td>${d.contrastMode} · ${d.textureSizes.join(", ")}</td></tr>
        <tr><td>Cámara · wake lock</td><td>${d.camera} · ${d.wakeLock ? "sí" : "no"}</td></tr>
        <tr><td>FPS</td><td>${n(d.fps, 0)}</td></tr>
      </table>
      <table><tr><th>Punto</th><th>Rumbo</th><th>Visual</th><th>Δ vista</th><th>Dist.</th></tr>${rows}</table>`;
  }
}
