// Web Worker: descarga, decodifica y realza cada imagen fuera del hilo principal,
// para que la interfaz no se congele (los PNG miden 4321 px de ancho).
import { buildContrastVariants } from "./enhance.js";

self.onmessage = async ({ data: { id, url, cfg, contentWidthPx } }) => {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bitmap = await createImageBitmap(await response.blob());
    const v = buildContrastVariants(bitmap, cfg, contentWidthPx);
    bitmap.close();
    self.postMessage({ id, ok: true, v }, Object.values(v.data).map((d) => d.buffer));
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err?.message ?? err) });
  }
};
