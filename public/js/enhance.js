// Realce de contraste de las imágenes, hecho en el navegador (los PNG originales no se tocan).
// Se ejecuta en un Web Worker (enhance-worker.js) o, si no hay OffscreenCanvas, en el hilo principal.
//
// El arte es texto blanco + líneas finas verde oscuro→gris sobre transparente, y solo ocupa
// la franja inferior del lienzo. Sobre la cámara, el texto blanco se pierde contra el cielo
// y las líneas finas contra el terreno; además, al reducir la imagen las líneas quedan casi
// transparentes. Por eso cada imagen se prepara en tres variantes del mismo tamaño:
//   original → solo recortada al contenido
//   realce   → líneas más opacas/gruesas/oscuras + halo oscuro tras el texto y claro tras las líneas
//   maximo   → realce + placa oscura difusa detrás (y la cámara se atenúa vía CSS)

export const CONTRAST_MODES = ["original", "realce", "maximo"];
export const CONTRAST_LABELS = { original: "Original", realce: "Realzado", maximo: "Máximo" };

const hexToRgb = (hex) => {
  const n = parseInt(String(hex).replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

function makeCanvas(w, h) {
  if (typeof document === "undefined") return new OffscreenCanvas(w, h);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

// Contextos 2D en CPU: se leen con getImageData, y así se evita subir el PNG grande a la GPU
// para volver a bajarlo.
const ctx2d = (canvas) => {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  return ctx;
};

function alphaBounds(d, w, h, alphaThreshold) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > alphaThreshold) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? { x: 0, y: 0, w, h } : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/**
 * Caja del contenido en píxeles de la imagen original, calculada sobre una miniatura
 * (rápido) con un margen de un píxel de miniatura para no recortar trazos finos.
 */
export function contentBounds(img) {
  const W = img.naturalWidth ?? img.width, H = img.naturalHeight ?? img.height;
  const s = Math.min(1, 540 / W);
  const w = Math.max(1, Math.round(W * s)), h = Math.max(1, Math.round(H * s));
  const ctx = ctx2d(makeCanvas(w, h));
  ctx.drawImage(img, 0, 0, w, h);
  const b = alphaBounds(ctx.getImageData(0, 0, w, h).data, w, h, 2);
  const x = Math.max(0, Math.floor((b.x - 1) / s)), y = Math.max(0, Math.floor((b.y - 1) / s));
  return { x, y, w: Math.min(W, Math.ceil((b.x + b.w + 1) / s)) - x, h: Math.min(H, Math.ceil((b.y + b.h + 1) / s)) - y };
}

/* ---------- Filtros sobre máscaras Float32 (w×h) ---------- */

/** Caja horizontal de radio r (suma móvil, bordes extendidos). */
function boxRows(src, dst, w, h, r) {
  const inv = 1 / (2 * r + 1);
  for (let y = 0, o = 0; y < h; y++, o += w) {
    let acc = src[o] * (r + 1);
    for (let k = 1; k <= r; k++) acc += src[o + Math.min(k, w - 1)];
    const last = src[o + w - 1], first = src[o];
    for (let x = 0; x < w; x++) {
      dst[o + x] = acc * inv;
      acc += (x + r + 1 < w ? src[o + x + r + 1] : last) - (x - r >= 0 ? src[o + x - r] : first);
    }
  }
}

/** Caja vertical de radio r, recorriendo por filas (amigable con la caché). */
function boxCols(src, dst, w, h, r, acc) {
  const inv = 1 / (2 * r + 1);
  for (let x = 0; x < w; x++) acc[x] = src[x] * (r + 1);
  for (let k = 1; k <= r; k++) {
    const o = Math.min(k, h - 1) * w;
    for (let x = 0; x < w; x++) acc[x] += src[o + x];
  }
  const lastRow = (h - 1) * w;
  for (let y = 0; y < h; y++) {
    const o = y * w;
    const addRow = y + r + 1 < h ? (y + r + 1) * w : lastRow;
    const subRow = y - r >= 0 ? (y - r) * w : 0;
    for (let x = 0; x < w; x++) {
      dst[o + x] = acc[x] * inv;
      acc[x] += src[addRow + x] - src[subRow + x];
    }
  }
}

/** Desenfoque ~gaussiano: 2 pasadas de caja separables. Devuelve un array nuevo. */
function blur(mask, w, h, radius) {
  const r = Math.max(1, Math.round(radius / 1.4));
  const a = Float32Array.from(mask), b = new Float32Array(mask.length), acc = new Float32Array(w);
  for (let pass = 0; pass < 2; pass++) {
    boxRows(a, b, w, h, r);
    boxCols(b, a, w, h, r, acc);
  }
  return a;
}

/** Perfil 1D de un segmento [start, start+len) desenfocado (para la placa, que es separable). */
function blurredSegment(size, start, len, radius) {
  const p = new Float32Array(size);
  p.fill(1, start, start + len);
  const tmp = new Float32Array(size);
  const r = Math.max(1, Math.round(radius / 1.4));
  for (let pass = 0; pass < 2; pass++) {
    boxRows(p, tmp, size, 1, r);
    p.set(tmp);
  }
  return p;
}

/**
 * Ancho de textura (px) para el dibujo: ~1,5× lo que ocupará en pantalla con el lado largo
 * horizontal (el caso más exigente), dentro de [minTextureWidth, maxTextureWidth].
 */
export function idealContentWidth(angularWidthDeg, longSideFovDeg, longSidePx, { minTextureWidth, maxTextureWidth }) {
  const ratio = Math.tan((angularWidthDeg * Math.PI) / 360) / Math.tan((longSideFovDeg * Math.PI) / 360);
  return Math.round(Math.min(maxTextureWidth, Math.max(minTextureWidth, ratio * longSidePx * 1.5)));
}

/**
 * Prepara las tres variantes de una imagen (HTMLImageElement o ImageBitmap). `contentWidthPx`
 * es el ancho que tendrá el dibujo (el lienzo añade un margen para halos y placa).
 * Devuelve datos RGBA transferibles entre hilos:
 * { data: {original, realce, maximo}, width, height, contentWidthPx, contentHeightPx }.
 */
export function buildContrastVariants(img, cfg, contentWidthPx) {
  const W = Math.max(64, Math.round(contentWidthPx));
  const box = contentBounds(img);
  const H = Math.max(8, Math.round((box.h / box.w) * W));
  const k = W / 1024; // los radios de config están pensados para 1024 px de ancho
  const padX = Math.round(W * 0.05);
  const padY = Math.round(Math.max(H * 0.45, 12 * k));
  const w = W + 2 * padX, h = H + 2 * padY, n = w * h;

  const ctx = ctx2d(makeCanvas(w, h));
  ctx.drawImage(img, box.x, box.y, box.w, box.h, padX, padY, W, H);
  const px = ctx.getImageData(0, 0, w, h).data; // variante "original"

  // 1) Separar texto claro de líneas oscuras; recuperar opacidad y oscurecer las líneas.
  const [lr, lg, lb] = hexToRgb(cfg.lineColor);
  const dk = cfg.lineDarken, keep = 1 - dk, gain = cfg.lineAlphaGain, thr = cfg.brightThreshold;
  const bright = new Float32Array(n);
  const line = new Float32Array(n);
  const enh = new Uint8ClampedArray(px);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const a = px[j + 3];
    if (!a) continue;
    if (0.2126 * px[j] + 0.7152 * px[j + 1] + 0.0722 * px[j + 2] >= thr) {
      bright[i] = a / 255;
    } else {
      const a2 = Math.min(1, (a / 255) * gain);
      line[i] = a2;
      enh[j] = px[j] * keep + lr * dk;
      enh[j + 1] = px[j + 1] * keep + lg * dk;
      enh[j + 2] = px[j + 2] * keep + lb * dk;
      enh[j + 3] = a2 * 255;
    }
  }

  // 2) Engrosar líneas (sin invadir el texto) copiando el color del vecino de línea más opaco.
  const t = Math.round(cfg.lineThickenPx * k);
  const lineAlpha = Float32Array.from(line);
  if (t > 0) {
    const src = enh.slice();
    for (let y = t; y < h - t; y++) {
      for (let x = t; x < w - t; x++) {
        const i = y * w + x;
        if (bright[i] >= 0.5) continue;
        let best = line[i], bi = -1;
        for (let dy = -t; dy <= t; dy++) {
          for (let dx = -t; dx <= t; dx++) {
            const v = line[i + dy * w + dx];
            if (v > best) { best = v; bi = i + dy * w + dx; }
          }
        }
        if (bi < 0) continue;
        const a = Math.max(best * 0.85, enh[i * 4 + 3] / 255);
        enh[i * 4] = src[bi * 4];
        enh[i * 4 + 1] = src[bi * 4 + 1];
        enh[i * 4 + 2] = src[bi * 4 + 2];
        enh[i * 4 + 3] = a * 255;
        lineAlpha[i] = a;
      }
    }
  }

  // 3) Halos: máscara desenfocada y amplificada (equivale a dilatar + difuminar, más barato).
  const dH = cfg.darkHalo, lH = cfg.lightHalo;
  const darkHalo = blur(bright, w, h, dH.blurPx * k);
  const lightHalo = blur(lineAlpha, w, h, lH.blurPx * k);

  // 4) Placa (solo "maximo"): rectángulo difuminado = producto de dos perfiles 1D.
  const plateR = Math.max(4, H * cfg.plate.blurFrac);
  const plateX = blurredSegment(w, padX, W, plateR);
  const plateY = blurredSegment(h, padY, H, plateR);

  // 5) Composición "over" (alfa directo): [placa] → halo claro → halo oscuro → dibujo.
  const realce = new Uint8ClampedArray(n * 4);
  const maximo = new Uint8ClampedArray(n * 4);
  const po = cfg.plate.opacity;
  for (let y = 0, i = 0; y < h; y++) {
    const py = plateY[y] * po;
    for (let x = 0; x < w; x++, i++) {
      const j = i * 4;
      const dRaw = Math.min(1, darkHalo[i] * dH.strength);
      const da = dRaw * dH.opacity;
      // Alrededor del texto manda el halo oscuro: el claro de las líneas de detrás se atenúa.
      const la = Math.min(1, lightHalo[i] * lH.strength) * lH.opacity * (1 - dRaw);
      const ca = enh[j + 3] / 255;
      for (let pass = 0; pass < 2; pass++) {
        // pass 0 = realce (sin placa), pass 1 = maximo (con placa negra debajo)
        let a = pass ? plateX[x] * py : 0;
        let r = 0, g = 0, b = 0;
        // halo claro (blanco)
        if (la > 0) {
          const oa = la + a * (1 - la);
          r = g = b = (255 * la + r * a * (1 - la)) / oa;
          a = oa;
        }
        // halo oscuro (negro)
        if (da > 0) {
          const oa = da + a * (1 - da);
          const f = (a * (1 - da)) / oa;
          r *= f; g *= f; b *= f;
          a = oa;
        }
        // dibujo
        if (ca > 0) {
          const oa = ca + a * (1 - ca);
          const f = (a * (1 - ca)) / oa, s = ca / oa;
          r = enh[j] * s + r * f;
          g = enh[j + 1] * s + g * f;
          b = enh[j + 2] * s + b * f;
          a = oa;
        }
        const out = pass ? maximo : realce;
        out[j] = r;
        out[j + 1] = g;
        out[j + 2] = b;
        out[j + 3] = a * 255;
      }
    }
  }

  return { data: { original: px, realce, maximo }, contentWidthPx: W, contentHeightPx: H, width: w, height: h };
}
