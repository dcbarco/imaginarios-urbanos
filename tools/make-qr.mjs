// Genera el código QR de la URL final en tools/out/qr.svg y tools/out/qr.png.
// Uso: node tools/make-qr.mjs https://cuatro-puntos.pages.dev
import QRCode from "qrcode";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const url = process.argv[2];
if (!url || !/^https:\/\//i.test(url)) {
  console.error("Uso: node tools/make-qr.mjs https://tu-dominio/   (debe ser HTTPS: cámara y sensores lo exigen)");
  process.exit(1);
}

const outDir = join(dirname(fileURLToPath(import.meta.url)), "out");
mkdirSync(outDir, { recursive: true });

// Nivel H (30 % de redundancia): aguanta impresión imperfecta, reflejos y logos superpuestos.
const options = { errorCorrectionLevel: "H", margin: 4, color: { dark: "#000000", light: "#ffffff" } };

await QRCode.toFile(join(outDir, "qr.png"), url, { ...options, width: 1200 });
writeFileSync(join(outDir, "qr.svg"), await QRCode.toString(url, { ...options, type: "svg" }));

const { modules } = QRCode.create(url, options);
console.log(`✓ QR para ${url}`);
console.log(`  ${join(outDir, "qr.png")} (1200 px) y qr.svg — versión ${modules.size}×${modules.size} módulos, corrección H`);
if (url.length > 40) console.log("  Sugerencia: una URL más corta genera un QR más simple y fácil de escanear a distancia.");
