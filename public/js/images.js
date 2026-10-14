// Preparación de las imágenes (recorte + realce de contraste) antes de entrar a la vista AR.
// Se hace en un Web Worker si el navegador tiene OffscreenCanvas; si no, en el hilo principal.
import { buildContrastVariants, idealContentWidth } from "./enhance.js";

function loadImage(url) {
  const img = new Image();
  img.decoding = "async";
  img.src = url;
  return img.decode().then(() => img);
}

/** Convierte los datos RGBA de cada variante en canvas (fuente de CanvasTexture). */
function toCanvases(v) {
  const canvases = {};
  for (const [mode, data] of Object.entries(v.data)) {
    const c = document.createElement("canvas");
    c.width = v.width;
    c.height = v.height;
    c.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(data.buffer ?? data), v.width, v.height), 0, 0);
    canvases[mode] = c;
  }
  return { ...v, data: undefined, canvases };
}

const nextFrame = () => new Promise((r) => setTimeout(r, 0));

/**
 * Empieza a preparar todas las imágenes. Devuelve un Map id → Promise<variantes con canvas>.
 * El ancho de textura se calcula para la pantalla actual (lado largo × pixel ratio ≤ 2).
 */
export function prepareImages(config, urlFor) {
  const longSidePx = Math.max(innerWidth, innerHeight) * Math.min(devicePixelRatio || 1, 2);
  const widthFor = (p) => idealContentWidth(p.angularWidthDeg, config.camera.verticalFovDeg, longSidePx, config.sprite);
  const useWorker = "Worker" in window && "OffscreenCanvas" in window && "createImageBitmap" in window;
  const results = new Map();

  let worker = null;
  const pending = new Map();
  if (useWorker) {
    try {
      worker = new Worker(new URL("./enhance-worker.js", import.meta.url), { type: "module" });
      worker.onmessage = ({ data }) => {
        const p = pending.get(data.id);
        pending.delete(data.id);
        if (data.ok) p.resolve(toCanvases(data.v));
        else p.reject(new Error(data.error));
        if (!pending.size) worker.terminate();
      };
      worker.onerror = () => {
        for (const p of pending.values()) p.reject(new Error("worker"));
        pending.clear();
      };
    } catch {
      worker = null;
    }
  }

  // Respaldo en el hilo principal, secuencial y cediendo el hilo entre imágenes.
  let chain = Promise.resolve();
  const onMainThread = (p) => {
    const job = chain.then(async () => {
      const img = await loadImage(urlFor(p.image));
      await nextFrame();
      const v = buildContrastVariants(img, config.contrast, widthFor(p));
      await nextFrame();
      return toCanvases(v);
    });
    chain = job.catch(() => {});
    return job;
  };

  for (const p of config.points) {
    let job;
    if (worker) {
      job = new Promise((resolve, reject) => {
        pending.set(p.id, { resolve, reject });
        worker.postMessage({ id: p.id, url: urlFor(p.image), cfg: config.contrast, contentWidthPx: widthFor(p) });
      }).catch((err) => {
        console.warn(`Worker de imágenes falló con ${p.image} (${err.message}); se procesa en el hilo principal.`);
        return onMainThread(p);
      });
    } else {
      job = onMainThread(p);
    }
    job.catch(() => {}); // el error se muestra al crear los sprites
    results.set(p.id, job);
  }
  return results;
}
