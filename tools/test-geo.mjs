// Prueba de la matemática geográfica (Node ≥ 18, sin dependencias).
// Uso: node tools/test-geo.mjs   → sale con código ≠ 0 si algo falla.
import {
  initialBearing, haversineDistance, normalizeAngle, shortestAngleDiff, circularMean,
  worldPosition, angularSizeToWorld, worldSizeToAngular, computeTargets, parseLatLng, cardinalName,
} from "../public/js/geo.js";
import { CONFIG } from "../public/js/config.js";

let failures = 0;
function check(name, actual, expected, tol = 1e-6) {
  const ok = Number.isFinite(actual) && Math.abs(actual - expected) <= tol;
  if (!ok) failures++;
  console.log(`${ok ? "✓" : "✗"} ${name}: ${Number(actual).toFixed(4)} (esperado ${expected} ±${tol})`);
}
function checkAngle(name, actual, expected, tol) {
  check(name, expected + shortestAngleDiff(expected, actual), expected, tol);
}

console.log("— Rumbos de casos conocidos —");
checkAngle("(0,0)→(0,1) = 90°", initialBearing({ lat: 0, lng: 0 }, { lat: 0, lng: 1 }), 90, 1e-9);
checkAngle("(0,0)→(1,0) = 0°", initialBearing({ lat: 0, lng: 0 }, { lat: 1, lng: 0 }), 0, 1e-9);
checkAngle("(0,0)→(0,−1) = 270°", initialBearing({ lat: 0, lng: 0 }, { lat: 0, lng: -1 }), 270, 1e-9);
checkAngle("(0,0)→(−1,0) = 180°", initialBearing({ lat: 0, lng: 0 }, { lat: -1, lng: 0 }), 180, 1e-9);
// Hemisferio sur: el círculo máximo hacia el este se curva hacia el polo sur → rumbo inicial > 90°.
checkAngle("Sur (−10,0)→(−10,1) ≈ 90.0868°", initialBearing({ lat: -10, lng: 0 }, { lat: -10, lng: 1 }), 90.0868, 1e-3);
checkAngle("Simetría N/S: B(10,0→10,1) = 180 − B(−10,0→−10,1)",
  initialBearing({ lat: 10, lng: 0 }, { lat: 10, lng: 1 }),
  180 - initialBearing({ lat: -10, lng: 0 }, { lat: -10, lng: 1 }), 1e-9);
checkAngle("Sur (−30,20)→(−31,20) = 180°", initialBearing({ lat: -30, lng: 20 }, { lat: -31, lng: 20 }), 180, 1e-9);

console.log("— Distancias —");
check("1° de longitud en el ecuador ≈ 111 195 m", haversineDistance({ lat: 0, lng: 0 }, { lat: 0, lng: 1 }), 111195.08, 0.5);
check("Mismo punto = 0 m", haversineDistance({ lat: 5, lng: -75 }, { lat: 5, lng: -75 }), 0, 1e-9);

console.log("— Utilidades angulares —");
check("normalizeAngle(−90) = 270", normalizeAngle(-90), 270);
check("shortestAngleDiff(350, 10) = 20", shortestAngleDiff(350, 10), 20);
check("shortestAngleDiff(10, 350) = −20", shortestAngleDiff(10, 350), -20);
checkAngle("circularMean(350, 10) = 0", circularMean([350, 10]), 0, 1e-9);
const e = cardinalName(90) === "E" && cardinalName(225) === "SO" && cardinalName(359) === "N";
if (!e) failures++;
console.log(`${e ? "✓" : "✗"} cardinalName (E, SO, N)`);
const p = parseLatLng("5.05,-75.49");
const pOk = p && p.lat === 5.05 && p.lng === -75.49 && parseLatLng("abc") === null && parseLatLng("95,0") === null;
if (!pOk) failures++;
console.log(`${pOk ? "✓" : "✗"} parseLatLng`);

console.log("— Convención de ejes (+X Este, +Y Arriba, −Z Norte) —");
const R = 50;
let w = worldPosition(0, 0, R);   check("Norte → z = −R", w.z, -R); check("Norte → x = 0", w.x, 0);
w = worldPosition(90, 0, R);      check("Este → x = +R", w.x, R);
w = worldPosition(180, 0, R);     check("Sur → z = +R", w.z, R);
w = worldPosition(270, 0, R);     check("Oeste → x = −R", w.x, -R);
w = worldPosition(0, 90, R);      check("Cenit → y = +R", w.y, R);
check("Tamaño angular ida y vuelta (24°)", worldSizeToAngular(angularSizeToWorld(24, R), R), 24, 1e-9);

console.log("— Modo cardinal —");
const card = computeTargets(CONFIG.origin, CONFIG.points, { layoutMode: "cardinal" });
const cs = [...card].sort((a, b) => a.trueBearing - b.trueBearing);
cs.forEach((t, k) => k && checkAngle(`separación ${cs[k - 1].id}→${t.id} = 90°`, shortestAngleDiff(cs[k - 1].displayBearing, t.displayBearing), 90, 1e-9));

console.log("— Puntos del proyecto (desde el origen fijo) —");
const REFERENCE = { ciudad: [73, 0.6], perla: [134, 26], colina: [198, 1.0], fabrica: [301, 4.7] };
const targets = computeTargets(CONFIG.origin, CONFIG.points, { layoutMode: "real" });
for (const t of targets) {
  const [refB, refKm] = REFERENCE[t.id];
  // Los valores de referencia son aproximados y redondeados (±1° según la especificación;
  // se tolera 1.5° para absorber el redondeo de la tabla de referencia).
  checkAngle(`${t.label} rumbo vs referencia ~${refB}°`, t.trueBearing, refB, 1.5);
  check(`${t.label} distancia vs referencia ~${refKm} km`, t.distanceM / 1000, refKm, refKm * 0.12);
}

console.log(`\nOrigen: ${CONFIG.origin.name} (${CONFIG.origin.lat}, ${CONFIG.origin.lng})`);
console.table(
  [...targets].sort((a, b) => a.trueBearing - b.trueBearing).map((t) => ({
    Texto: t.label, Lugar: t.place, "Rumbo verdadero (°)": +t.trueBearing.toFixed(2),
    Cardinal: cardinalName(t.trueBearing), "Distancia (km)": +(t.distanceM / 1000).toFixed(3), Imagen: t.image,
  })),
);

if (failures) {
  console.error(`\n✗ ${failures} prueba(s) fallaron`);
  process.exit(1);
}
console.log("\n✓ Todas las pruebas pasaron");
