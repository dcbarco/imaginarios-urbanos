// Servidor HTTPS para probar desde celulares en la misma red Wi-Fi, antes de desplegar.
// La cámara, la brújula y el GPS exigen HTTPS, así que se usa un certificado autofirmado
// (se genera en .cert/ y se regenera si cambia la IP). El celular mostrará un aviso de
// "conexión no privada" la primera vez: hay que aceptarlo (ver README).
//
// Uso: node tools/serve-lan.mjs [--port 8443] [--http-port 8080] [--cache]
//   --cache  respeta el Cache-Control de public/_headers (por defecto: sin caché).
import https from "node:https";
import http from "node:http";
import os from "node:os";
import { readFile, stat } from "node:fs/promises";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import selfsigned from "selfsigned";
import QRCode from "qrcode";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_DIR = join(ROOT_DIR, "public");
const CERT_DIR = join(ROOT_DIR, ".cert");

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : fallback;
};
const PORT = argValue("--port", 8443);
const HTTP_PORT = argValue("--http-port", 8080);
const KEEP_CACHE = args.includes("--cache");

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png", ".webp": "image/webp",
  ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8",
};

function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((a) => a && a.family === "IPv4" && !a.internal)
    .map((a) => a.address);
}

async function loadCertificate(ips) {
  const certFile = join(CERT_DIR, "lan-cert.pem");
  const keyFile = join(CERT_DIR, "lan-key.pem");
  const metaFile = join(CERT_DIR, "meta.json");
  try {
    const meta = JSON.parse(readFileSync(metaFile, "utf8"));
    const covers = ips.every((ip) => meta.ips.includes(ip));
    if (covers && new Date(meta.notAfter) > new Date(Date.now() + 86400000)) {
      return { cert: readFileSync(certFile), key: readFileSync(keyFile) };
    }
  } catch { /* no hay certificado previo */ }

  const notAfter = new Date();
  notAfter.setDate(notAfter.getDate() + 365);
  const pems = await selfsigned.generate([{ name: "commonName", value: "cuatro-puntos.local" }], {
    keySize: 2048,
    algorithm: "sha256",
    notAfterDate: notAfter,
    extensions: [
      { name: "basicConstraints", cA: false },
      { name: "keyUsage", digitalSignature: true, keyEncipherment: true },
      { name: "extKeyUsage", serverAuth: true },
      {
        name: "subjectAltName",
        altNames: [
          { type: 2, value: "localhost" },
          { type: 7, ip: "127.0.0.1" },
          ...ips.map((ip) => ({ type: 7, ip })),
        ],
      },
    ],
  });
  mkdirSync(CERT_DIR, { recursive: true });
  writeFileSync(certFile, pems.cert);
  writeFileSync(keyFile, pems.private);
  writeFileSync(metaFile, JSON.stringify({ ips, notAfter: notAfter.toISOString() }, null, 2));
  console.log(`Certificado autofirmado generado para: localhost, ${ips.join(", ")}`);
  return { cert: pems.cert, key: pems.private };
}

/** Interpreta public/_headers (formato de Cloudflare Pages) para servir las mismas cabeceras. */
function loadHeaderRules() {
  const file = join(PUBLIC_DIR, "_headers");
  if (!existsSync(file)) return [];
  const rules = [];
  let current = null;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    if (!/^\s/.test(line)) {
      const pattern = line.trim().replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
      current = { re: new RegExp(`^${pattern}$`), headers: {} };
      rules.push(current);
    } else if (current) {
      const i = line.indexOf(":");
      if (i > 0) current.headers[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  }
  return rules;
}
const headerRules = loadHeaderRules();

async function handle(req, res) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, "https://x").pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  let file = normalize(join(PUBLIC_DIR, pathname));
  if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    if ((await stat(file)).isDirectory()) file = join(file, "index.html");
    const body = await readFile(file);
    const headers = { "Content-Type": MIME[extname(file).toLowerCase()] ?? "application/octet-stream" };
    for (const rule of headerRules) if (rule.re.test(req.url.split("?")[0])) Object.assign(headers, rule.headers);
    if (!KEEP_CACHE) headers["Cache-Control"] = "no-store";
    res.writeHead(200, headers);
    res.end(req.method === "HEAD" ? undefined : body);
    log(req, 200);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("404 — no encontrado");
    log(req, 404);
  }
}

function log(req, status) {
  const who = (req.socket.remoteAddress ?? "").replace("::ffff:", "");
  const time = new Date().toLocaleTimeString("es-CO", { hour12: false });
  console.log(`${time} ${who.padEnd(15)} ${status} ${req.method} ${decodeURIComponent(req.url)}`);
}

const ips = lanAddresses();
const credentials = await loadCertificate(ips);

const server = https.createServer(credentials, handle);
server.on("error", (err) => {
  console.error(err.code === "EADDRINUSE" ? `El puerto ${PORT} está en uso. Prueba: npm run lan -- --port 9443` : err);
  process.exit(1);
});
server.listen(PORT, "0.0.0.0", async () => {
  const urls = ips.map((ip) => `https://${ip}:${PORT}/`);
  console.log("\nCuatro Puntos — servidor de pruebas en red local (HTTPS)\n");
  console.log(`  En este PC:        https://localhost:${PORT}/?mock=1`);
  for (const u of urls) console.log(`  Desde el celular:  ${u}      (diagnóstico: ${u}?debug=1)`);
  if (!urls.length) console.log("  ⚠ No se encontró ninguna IP de red local. ¿Estás conectado a la Wi-Fi?");
  if (urls[0]) {
    console.log("\nEscanea con el celular (misma red Wi-Fi):\n");
    console.log(await QRCode.toString(urls[0], { type: "terminal", small: true, errorCorrectionLevel: "L" }));
  }
  console.log("La primera vez el celular dirá que la conexión no es privada: acéptalo (ver README).");
  console.log("Si el celular no conecta: permite Node.js en el Firewall de Windows (redes privadas) y");
  console.log("verifica que ambos estén en la misma Wi-Fi (las redes de invitados suelen aislar equipos).");
  console.log(KEEP_CACHE ? "Caché: según public/_headers\n" : "Caché desactivada: recarga la página para ver tus cambios.\n");
});

// Redirección http → https para quien escriba la dirección sin "https://".
http
  .createServer((req, res) => {
    const host = (req.headers.host ?? "localhost").replace(/:\d+$/, "");
    res.writeHead(301, { Location: `https://${host}:${PORT}${req.url}` }).end();
  })
  .on("error", () => {})
  .listen(HTTP_PORT, "0.0.0.0");
