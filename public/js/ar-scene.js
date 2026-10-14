// Escena Three.js: cámara virtual (orientada por orientation.js) y sprites de los 4 puntos,
// colocados sobre una esfera de radio fijo en su rumbo. Mundo: +X Este, +Y Arriba, −Z Norte.
import {
  WebGLRenderer, Scene, PerspectiveCamera, Sprite, SpriteMaterial, CanvasTexture,
  SRGBColorSpace, LinearFilter, LinearMipmapLinearFilter, Vector3, MathUtils,
  CustomBlending, OneFactor, OneMinusSrcAlphaFactor,
} from "three";
import { worldPosition, angularSizeToWorld, worldSizeToAngular, circularLerp, shortestAngleDiff } from "./geo.js";
import { CONTRAST_MODES } from "./enhance.js";

const D2R = MathUtils.DEG2RAD;
const R2D = MathUtils.RAD2DEG;
const _p = new Vector3();
const _f = new Vector3();
const _r = new Vector3();
const _u = new Vector3();

function makeTexture(canvas, renderer) {
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  // Alfa premultiplicado: sin él, al generar mipmaps los halos blancos se mezclan con el
  // negro de los píxeles transparentes y aparece un borde gris.
  texture.premultiplyAlpha = true;
  texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  return texture;
}

const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

export class ArScene {
  constructor(canvas, config) {
    this.cfg = config;
    this.canvas = canvas;
    this.R = config.camera.sphereRadius;
    this.longSideFovDeg = config.camera.verticalFovDeg;
    this.renderer = new WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.scene = new Scene();
    this.camera = new PerspectiveCamera(this.longSideFovDeg, 1, 0.1, this.R * 4);
    this.items = new Map();
    this.fadeStart = null; // null = sprites ocultos
    this.width = 1;
    this.height = 1;
    this.resize();
  }

  /**
   * El FOV configurado corresponde al lado LARGO de la pantalla (vertical en retrato).
   * En paisaje se conserva sobre el eje horizontal y el vertical se deriva del aspect ratio.
   */
  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.width = w;
    this.height = h;
    const aspect = w / h;
    const tanLong = Math.tan((this.longSideFovDeg * D2R) / 2);
    this.camera.fov = aspect > 1 ? 2 * Math.atan(tanLong / aspect) * R2D : this.longSideFovDeg;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  setLongSideFov(deg) {
    this.longSideFovDeg = deg;
    this.resize();
  }

  get vFovDeg() {
    return this.camera.fov;
  }
  get hFovDeg() {
    return 2 * Math.atan(Math.tan((this.camera.fov * D2R) / 2) * this.camera.aspect) * R2D;
  }

  /** Crea el sprite de un punto a partir de sus variantes de contraste (images.js). */
  addPoint(point, v, index, contrastMode) {
    const textures = Object.fromEntries(CONTRAST_MODES.map((m) => [m, makeTexture(v.canvases[m], this.renderer)]));
    const material = new SpriteMaterial({
      map: textures[contrastMode] ?? textures.realce,
      transparent: true, depthTest: false, depthWrite: false, opacity: 0,
      // Mezcla para alfa premultiplicado; el fundido escala color y alfa (ver render()).
      blending: CustomBlending, blendSrc: OneFactor, blendDst: OneMinusSrcAlphaFactor,
      blendSrcAlpha: OneFactor, blendDstAlpha: OneMinusSrcAlphaFactor,
    });
    const sprite = new Sprite(material);
    sprite.visible = this.fadeStart != null; // puede llegar después de show()
    this.scene.add(sprite);
    this.items.set(point.id, {
      id: point.id, sprite, material, textures,
      elevationDeg: point.elevationDeg,
      canvasWidth: v.width, canvasHeight: v.height, contentWidthPx: v.contentWidthPx, contentHeightPx: v.contentHeightPx,
      contentHeightDeg: 0, // se calcula en setAngularWidth
      phase: index * 1.7,
      bearing: null, from: null, to: null, animStart: 0,
      textureSize: `${v.width}×${v.height}`,
    });
    // `angularWidthDeg` es el ancho del dibujo; el lienzo incluye margen para halos/placa.
    // Todas las proporciones salen de la imagen real (sin deformar).
    this.setAngularWidth(point.id, point.angularWidthDeg);
  }

  /** Elevación en vivo (grados), p. ej. desde el panel ?debug=1. */
  setElevation(id, deg) {
    const item = this.items.get(id);
    if (item) item.elevationDeg = deg;
  }

  /** Ancho angular en vivo (grados) del DIBUJO; recalcula la escala del sprite manteniendo su aspecto real. */
  setAngularWidth(id, deg) {
    const item = this.items.get(id);
    if (!item) return;
    item.angularWidthDeg = deg;
    const contentWorldW = angularSizeToWorld(deg, this.R);
    const worldW = contentWorldW * (item.canvasWidth / item.contentWidthPx);
    const worldH = worldW * (item.canvasHeight / item.canvasWidth);
    item.sprite.scale.set(worldW, worldH, 1);
    item.contentHeightDeg = worldSizeToAngular(contentWorldW * (item.contentHeightPx / item.contentWidthPx), this.R);
  }

  setContrastMode(mode) {
    for (const item of this.items.values()) {
      const t = item.textures[mode];
      if (t) item.material.map = t;
    }
  }

  /** Coloca (o mueve con transición) los sprites en su rumbo de visualización. */
  setTargets(targets, animate = false) {
    const now = performance.now();
    for (const t of targets) {
      const item = this.items.get(t.id);
      if (!item) continue;
      item.distanceM = t.distanceM;
      item.sprite.renderOrder = -t.distanceM; // los lejanos se dibujan primero
      if (item.bearing == null || !animate) {
        item.bearing = item.from = item.to = t.displayBearing;
      } else if (Math.abs(shortestAngleDiff(item.to, t.displayBearing)) > 0.01) {
        item.from = item.bearing;
        item.to = t.displayBearing;
        item.animStart = now;
      }
    }
  }

  show() {
    if (this.fadeStart != null) return;
    this.fadeStart = performance.now();
    for (const item of this.items.values()) item.sprite.visible = true;
  }

  get shown() {
    return this.fadeStart != null;
  }

  #elevationAt(item, timeS) {
    const { floatAmplitudeDeg, floatPeriodS } = this.cfg.sprite;
    return item.elevationDeg + floatAmplitudeDeg * Math.sin((2 * Math.PI * timeS) / floatPeriodS + item.phase);
  }

  render(quaternion, timeS) {
    this.camera.quaternion.copy(quaternion);
    this.camera.updateMatrixWorld();
    const now = performance.now();
    const { fadeInMs, repositionMs } = this.cfg.sprite;
    const opacity = this.fadeStart == null ? 0 : Math.min(1, (now - this.fadeStart) / fadeInMs);

    // Mantener las imágenes derechas respecto al horizonte aunque el teléfono se incline:
    // ángulo del "arriba" del mundo visto en pantalla.
    _r.set(1, 0, 0).applyQuaternion(quaternion);
    _u.set(0, 1, 0).applyQuaternion(quaternion);
    const roll = Math.atan2(-_r.y, _u.y);

    for (const item of this.items.values()) {
      if (item.bearing == null) continue;
      if (item.from !== item.to) {
        const k = Math.min(1, (now - item.animStart) / repositionMs);
        item.bearing = circularLerp(item.from, item.to, easeInOut(k));
        if (k >= 1) item.from = item.to;
      }
      const p = worldPosition(item.bearing, this.#elevationAt(item, timeS), this.R);
      item.sprite.position.set(p.x, p.y, p.z);
      item.material.opacity = opacity;
      item.material.color.setScalar(opacity); // textura premultiplicada: el color también se atenúa
      item.material.rotation = roll;
    }
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Proyección a pantalla (px CSS) del centro de cada sprite y del ancla de su etiqueta
   * de distancia (justo debajo de la imagen).
   */
  project(timeS) {
    const out = [];
    _f.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    for (const item of this.items.values()) {
      if (item.bearing == null) continue;
      const el = this.#elevationAt(item, timeS);
      const center = this.#toScreen(worldPosition(item.bearing, el, this.R));
      const below = this.#toScreen(worldPosition(item.bearing, el - item.contentHeightDeg / 2 - 0.8, this.R));
      out.push({
        id: item.id,
        bearing: item.bearing,
        center,
        label: below,
        onScreen: center.inFront && Math.abs(center.ndcX) <= 1 && Math.abs(center.ndcY) <= 1,
      });
    }
    return out;
  }

  #toScreen(p) {
    _p.set(p.x, p.y, p.z);
    const inFront = _p.dot(_f) > 0;
    _p.project(this.camera);
    return { x: ((_p.x + 1) / 2) * this.width, y: ((1 - _p.y) / 2) * this.height, ndcX: _p.x, ndcY: _p.y, inFront };
  }
}
