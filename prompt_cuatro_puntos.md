# PROMPT PARA CLAUDE CODE — Proyecto "cuatro_puntos" (AR web geolocalizada)

Eres un ingeniero senior de front-end especializado en WebAR, sensores del dispositivo (Generic Sensor API / DeviceOrientation) y geodesia básica. Construye el proyecto completo descrito abajo. Sigue las especificaciones al pie de la letra; donde algo sea ambiguo, elige la opción más robusta y déjala configurable en `config.js`. Al final entrega el resumen indicado en la sección 14.

---

## 1. Objetivo

Experiencia de **realidad aumentada 100 % web (sin app)**, abierta escaneando un **código QR** que apunta a una URL HTTPS. El usuario está de pie en una **terraza con vista de 360°** en **Manizales, Caldas, Colombia**, en el **Centro Cultural Universitario Rogelio Salmona** (punto de escaneo). Al girar sobre su eje con el celular, debe ver **4 imágenes PNG con transparencia suspendidas en el aire, exactamente en la dirección geográfica real** de 4 lugares de referencia, sobre la imagen de la cámara.

**Criterio de éxito nº 1 (el más importante):** cuando el usuario apunte el celular hacia la dirección de cada lugar, la imagen correspondiente debe estar allí, centrada en pantalla, con un error de rumbo ≤ ±5° tras la calibración. Todo lo demás es secundario a esto.

Carga rápida y acceso inmediato: sin login, sin instalar nada, sin frameworks pesados, primera pantalla usable en < 3 s en 4G.

## 2. Datos geográficos

**Punto de observación (origen)** — terraza del Centro Cultural Universitario Rogelio Salmona, punto de escaneo del QR. Coordenadas **definitivas y medidas por mí en la terraza** (no las busques ni las cambies):

- **Lat `5.054639316762688`, Lng `-75.49156875803418`**

**Los 4 puntos objetivo** (lat, lng). El nombre del texto es el que aparece dentro de cada PNG:

| # | Texto (label) | Lugar real | Lat | Lng | Archivo PNG esperado en `public/` |
|---|---------------|-----------|-----|-----|-----------------------------------|
| 1 | **La Colina** | Cerro Sancancio | 5.046013136467171 | -75.494355479765 | `la-colina.png` |
| 2 | **Perla del Ruiz** | Dirección hacia el Nevado del Ruiz (Caldas) | 4.8910285046725495 | -75.32219651683367 | `perla-del-ruiz.png` |
| 3 | **La Ciudad** | Zona del Cable / Torre de Herveo | 5.056206752550917 | -75.48641124470727 | `la-ciudad.png` |
| 4 | **Fábrica** | Dirección hacia Chipre | 5.076726282340162 | -75.52799225866666 | `fabrica.png` |

**Rumbos y distancias de referencia** (cálculo aproximado mío desde el origen, solo para que verifiques tu implementación; el código debe calcularlos, no copiarlos):

| Texto | Rumbo verdadero aprox. | Distancia aprox. |
|-------|-----------------------|------------------|
| La Ciudad (Cable) | ~73° (ENE) | ~0.6 km |
| Perla del Ruiz | ~134° (SE) | ~26 km |
| La Colina (Sancancio) | ~198° (SSW) | ~1.0 km |
| Fábrica (Chipre) | ~301° (WNW) | ~4.7 km |

Si `test-geo.mjs` se aparta más de ~1° de estos valores, revisa la fórmula.

Antes de escribir código, ejecuta `Glob public/*.png`. Yo colocaré 4 PNG con transparencia en `public/`. Si los nombres difieren de la tabla, mapea cada archivo al punto más probable por su nombre (fabrica, ciudad, colina, perla/ruiz), ajusta `config.js` y repórtalo. Lee las dimensiones reales de cada PNG (para conservar su relación de aspecto).

## 3. Decisión de arquitectura (obligatoria)

- **Sitio 100 % estático**, sin backend, desplegable en **Cloudflare Pages** (directorio raíz de publicación = `public/`).
- **HTML + JavaScript ES modules + CSS vanilla**. Única dependencia: **Three.js**, *vendorizada localmente* (`npm i three` y copiar el build de módulo ES —`three.module.min.js` y, si la versión lo requiere, `three.core.min.js`— a `public/vendor/`). **Prohibido usar CDN externas** en runtime (la señal en terraza puede ser mala y un CDN caído rompe la experiencia). Usa `importmap` local.
- **No uses AR.js / A-Frame / 8th Wall / WebXR**: WebXR no soporta bien geo-anclaje en iOS y AR.js location-based es impreciso en rumbo. Implementamos la proyección propia con Three.js: cámara virtual cuya orientación se sincroniza con los sensores, sprites colocados a un radio fijo en el rumbo calculado.
- **Insight clave de diseño:** los objetivos están a ~0.6–26 km. Para los lejanos (Chipre, Ruiz) un error de GPS de decenas de metros cambia el rumbo < 1°, pero para **La Ciudad (~0.6 km) y La Colina (~1 km)** un error de 20–30 m ya puede mover el rumbo 2–3°, y en zona urbana el GPS del celular suele ser peor que eso. Por eso el **rumbo hacia cada punto se calcula desde el origen fijo medido en la terraza**; el GPS es un refinamiento opcional solo si el usuario está lejos del origen, **nunca un requisito**. El elemento crítico es el **rumbo del dispositivo (brújula)**, no la posición.

## 4. Estructura de carpetas

```
cuatro_puntos/
├── public/                      ← raíz web (Cloudflare Pages)
│   ├── index.html
│   ├── css/style.css
│   ├── js/
│   │   ├── main.js              ← orquestación / flujo de pantallas
│   │   ├── config.js            ← TODA la configuración (ver §5)
│   │   ├── geo.js               ← matemática geográfica (bearing, distancia, declinación)
│   │   ├── sensors.js           ← orientación (Android/iOS), GPS, wake lock
│   │   ├── ar-scene.js          ← escena Three.js, sprites, cámara virtual
│   │   ├── ui.js                ← HUD, brújula, indicadores, calibración, debug
│   ├── vendor/three.module.min.js (+ three.core.min.js si aplica)
│   ├── la-colina.png · perla-del-ruiz.png · la-ciudad.png · fabrica.png   ← (los pongo yo)
│   ├── _headers                 ← cabeceras Cloudflare (ver §11)
│   └── favicon.svg
├── tools/
│   ├── test-geo.mjs             ← prueba de la matemática geográfica (Node, sin deps)
│   └── make-qr.mjs              ← genera el QR (SVG + PNG) de la URL final
├── package.json
├── wrangler.jsonc               ← opcional, para `wrangler pages deploy`
└── README.md                    ← cómo probar en el celular y cómo desplegar
```

## 5. `config.js` (fuente única de verdad)

```js
export const CONFIG = {
  origin: { name: "Terraza - Centro Cultural Universitario Rogelio Salmona", lat: 5.054639316762688, lng: -75.49156875803418 },

  points: [
    { id: "colina", label: "La Colina",      place: "Cerro Sancancio",     lat: 5.046013136467171,  lng: -75.494355479765,   image: "la-colina.png",      elevationDeg: 4,  angularWidthDeg: 24 },
    { id: "perla",  label: "Perla del Ruiz", place: "Nevado del Ruiz",     lat: 4.8910285046725495, lng: -75.32219651683367, image: "perla-del-ruiz.png", elevationDeg: 8,  angularWidthDeg: 24 },
    { id: "ciudad", label: "La Ciudad",      place: "Zona del Cable",      lat: 5.056206752550917,  lng: -75.48641124470727, image: "la-ciudad.png",      elevationDeg: 4,  angularWidthDeg: 24 },
    { id: "fabrica",label: "Fábrica",        place: "Dirección a Chipre",  lat: 5.076726282340162,  lng: -75.52799225866666, image: "fabrica.png",        elevationDeg: 4,  angularWidthDeg: 24 },
  ],

  // "real": cada imagen en su rumbo geográfico verdadero (DEFAULT; cumple el criterio nº 1).
  // "cardinal": mismo orden angular pero forzados a 90° entre sí (0/90/180/270 rotados) — solo estético.
  layoutMode: "real",

  // Declinación magnética en Manizales (grados, ESTE positivo, OESTE negativo). Aprox. −7°.
  // VERIFICAR para la fecha actual con NOAA WMM (ngdc.noaa.gov/geomag/calculators/magcalc.shtml)
  // o con el paquete npm `geomagnetism`. Rumbo verdadero = rumbo magnético + declinación.
  magneticDeclinationDeg: -7.0,

  positionMode: "hybrid",     // "fixed" | "gps" | "hybrid"
  hybridRadiusM: 150,         // dentro de este radio del origen se usa el origen fijo
  gpsMaxAccuracyM: 40,        // fixes peores que esto se ignoran

  camera: { verticalFovDeg: 60, sphereRadius: 50 },  // FOV vertical típico cámara trasera en modo retrato
  smoothing: { orientationSlerp: 0.18, yawOffsetAlpha: 0.02 },

  sprite: { floatAmplitudeDeg: 0.4, floatPeriodS: 5, fadeInMs: 600 },
  showDistanceLabel: true,     // pequeño texto "≈ 23 km" bajo cada imagen
};
```

Todo se lee de aquí; **no hardcodees** coordenadas ni nombres en otros archivos.

## 6. Matemática geográfica (`geo.js`)

- `initialBearing(from, to)` → rumbo inicial de círculo máximo, grados verdaderos 0–360 desde el norte geográfico, sentido horario. Fórmula: `θ = atan2(sin Δλ · cos φ2, cos φ1 · sin φ2 − sin φ1 · cos φ2 · cos Δλ)`, normalizado con `(θ·180/π + 360) % 360`.
- `haversineDistance(from, to)` en metros.
- `normalizeAngle`, `shortestAngleDiff` (−180..180), `circularMean`.
- Posición del sprite en el mundo Three.js con **convención: +X = Este, +Y = Arriba, −Z = Norte**:
  `x = R·cos(el)·sin(θ)`, `y = R·sin(el)`, `z = −R·cos(el)·cos(θ)`, con `R = camera.sphereRadius`, `el = elevationDeg` y `θ` = rumbo **verdadero**.
- `layoutMode: "cardinal"`: ordena los puntos por rumbo real y reasigna θ = base + k·90° conservando el orden; deja la base configurable.
- El **tamaño angular** de cada sprite es constante (`angularWidthDeg`): calcula el ancho en unidades de mundo como `2·R·tan(angularWidthDeg/2)`; el alto sale del aspect ratio real del PNG.
- Las imágenes deben verse como "suspendidas": usar `THREE.Sprite` (billboard), `sizeAttenuation` normal, `depthTest:false`, `transparent:true`, `colorSpace = SRGBColorSpace`, y un leve flotado vertical senoidal (config) + fade-in.

## 7. Sensores de orientación (`sensors.js`) — la parte crítica

**Cadena de prioridad (detectar en runtime):**

1. **Android Chrome/Chromium:** `AbsoluteOrientationSensor` (Generic Sensor API, `{frequency: 60, referenceFrame: "screen"}`), pidiendo antes permisos `accelerometer`, `gyroscope`, `magnetometer` vía `navigator.permissions.query`. Da cuaternión ya referido al norte magnético → el más estable.
2. **Android fallback:** evento `deviceorientationabsolute` (alpha/beta/gamma). Si no existe, `deviceorientation` **solo si `event.absolute === true`**. Si nunca llega un evento absoluto, activar el flujo de **alineación manual obligatoria** (§9) y avisar al usuario.
3. **iOS Safari:** `DeviceOrientationEvent` con **`DeviceOrientationEvent.requestPermission()`** llamado **directamente dentro del handler del clic** del botón "Comenzar" (antes de cualquier `await` previo), porque exige gesto del usuario y HTTPS. En iOS `alpha` es relativo (no absoluto): usar `event.webkitCompassHeading` (rumbo magnético, grados horarios) para estimar el **offset de yaw**:
   - Construir la orientación con alpha/beta/gamma igual que `DeviceOrientationControls` de Three.js (Euler `(beta, alpha, −gamma)` orden `'YXZ'`, rotar −90° sobre X para que la cámara mire por la parte trasera, compensar `screen.orientation.angle`). En este marco, con alpha absoluto, la cámara mira a −Z = Norte.
   - Calcular el yaw relativo de la cámara (dirección de "adelante" proyectada al plano horizontal) y mantener `yawOffset = normalizar(webkitCompassHeading − yawRelativo)`, actualizado con **media circular exponencial** (`yawOffsetAlpha`), **solo cuando el teléfono está aproximadamente vertical (beta entre 50° y 130°)** y `webkitCompassAccuracy` ≥ 0 y ≤ 25° (si existe). Aplicar `yawOffset` a la cámara.
   - Marcar como **VALIDAR EN iPHONE REAL** el comportamiento de `webkitCompassHeading` con el teléfono vertical, y exponer el valor en el panel debug.
4. **Sin sensores** (escritorio o permiso denegado): modo demo, arrastrar con el mouse/dedo para rotar la vista.

**Correcciones obligatorias (todas las plataformas):**
- Rumbo verdadero de la cámara = rumbo magnético + `magneticDeclinationDeg` (aplicar al yaw de la escena, no a cada sprite).
- Aplicar además `userYawOffsetDeg` (calibración manual del usuario, §9), persistido en `localStorage` con try/catch.
- Suavizado: `quaternion.slerp` por frame con `orientationSlerp`; ignorar saltos de heading espurios (> 60° en un frame) durante 100 ms; zona muerta de 0.2°.
- Manejar rotación de pantalla (retrato/paisaje) y recalcular el aspect ratio y el FOV horizontal al `resize`/`orientationchange`.
- Registrar y mostrar la **fuente activa** (`AbsoluteOrientationSensor` | `deviceorientationabsolute` | `iOS webkit` | `mouse`) en el debug.
- Advertir al usuario ("mueve el teléfono dibujando un 8") si la precisión de brújula es mala (`webkitCompassAccuracy` alto/negativo, o sensor con `quality` bajo si está disponible).
- Detectar y avisar sobre interferencia: si el heading oscila > 10° estando el teléfono quieto 2 s, mostrar aviso de calibración.

## 8. GPS (`sensors.js`)

- `navigator.geolocation.watchPosition` con `{enableHighAccuracy: true, maximumAge: 1000, timeout: 20000}`.
- Descartar fixes con `accuracy > gpsMaxAccuracyM`. Promediar los últimos N fixes ponderando por 1/accuracy² para estabilizar.
- Lógica `positionMode`:
  - `fixed`: siempre el origen configurado.
  - `gps`: siempre la posición GPS (fallback al origen si no hay fix).
  - **`hybrid` (default):** usar el origen fijo mientras el GPS esté denegado/sin fix o la distancia GPS→origen ≤ `hybridRadiusM`; si el usuario está a más de `hybridRadiusM` con buena precisión, usar el GPS y mostrar un aviso discreto ("Estás lejos del punto de escaneo; las direcciones se ajustaron a tu ubicación").
- Al cambiar la posición efectiva, **recalcular rumbos y reposicionar sprites** con transición suave.
- Si el permiso de GPS se deniega, la experiencia **sigue funcionando** con el origen fijo (sin bloquear ni mostrar error rojo).
- Usar también `navigator.wakeLock.request('screen')` (con try/catch y re-solicitar en `visibilitychange`) para que la pantalla no se apague.

## 9. Flujo de UX (`ui.js`, `main.js`)

1. **Pantalla de bienvenida** (ligera, < 30 KB, mobile-first, español): título "Cuatro Puntos", 1 línea de explicación, instrucción "Sostén el celular en vertical", botón grande **"Comenzar"**.
2. Al tocar "Comenzar", en este orden y **sin perder el gesto de usuario**: (a) permiso de orientación (iOS: `requestPermission`), (b) `getUserMedia({video:{facingMode:{ideal:"environment"}, width:{ideal:1280}, height:{ideal:720}}, audio:false})` en un `<video playsinline muted autoplay>` a pantalla completa con `object-fit: cover`, (c) `watchPosition`, (d) wake lock. Cada paso falla de forma independiente y con degradación elegante:
   - Sin cámara → fondo de cielo degradado (CSS) y los sprites igual funcionan por brújula.
   - Sin sensores → modo arrastre.
   - Permiso de movimiento denegado en iOS → instrucciones para reactivarlo (Ajustes → Safari → Movimiento y orientación / recargar la página).
3. **Calibración rápida (paso corto, omitible):** animación "dibuja un 8 con el teléfono" ~3 s.
4. **Alineación manual (botón permanente "Alinear"):** "Apunta al Cerro Sancancio — donde aparecerá el texto **La Colina** — (o a cualquier otro de los 4 puntos que elijas en el menú) y toca *Alinear*". Calcula `userYawOffsetDeg = rumboVerdadero(punto) − rumboVerdaderoActualCámara` y lo guarda. Incluye botones de ajuste fino ±1° y "Restablecer". Si nunca hubo rumbo absoluto (§7.2), este paso es obligatorio antes de mostrar los sprites.
5. **HUD mínimo sobre la cámara:**
   - Brújula arriba (rumbo en grados + N/NE/E…, mini cinta de rumbos) con marcadores de los 4 puntos.
   - **Indicadores en el borde** (flecha + nombre) hacia el punto más cercano fuera de pantalla, para que el usuario los encuentre girando.
   - Botón de alineación y de ayuda. Nada más; que la imagen de la cámara domine.
6. **Detección de navegadores embebidos** (Instagram, Facebook, WhatsApp, WeChat, LinkedIn): mostrar aviso "Ábrelo en Safari/Chrome" con botón de copiar enlace, porque suelen bloquear sensores/cámara.
7. **Comprobar `window.isSecureContext`**; si es falso, mensaje claro (HTTPS obligatorio).

## 10. Modos de prueba y debug

- `?debug=1` → panel con: fuente de orientación, alpha/beta/gamma, heading magnético, declinación aplicada, `yawOffset`, `userYawOffset`, lat/lng/accuracy GPS, modo de posición efectivo, **tabla de rumbo y distancia a cada punto**, FPS; sliders en vivo para declinación, FOV vertical y offset de yaw; botón "copiar diagnóstico".
- `?mock=1` → simulación en escritorio: sin cámara, fondo degradado, rotación con mouse/touch, para desarrollar sin celular.
- `?origin=lat,lng` → sobreescribe el origen (para probar desde otro lugar).
- `tools/test-geo.mjs`: pruebas con casos conocidos (p. ej. (0,0)→(0,1) = 90°, (0,0)→(1,0) = 0°, (0,0)→(0,−1) = 270°, un caso de hemisferio sur) y al final **imprime una tabla con rumbo (°) y distancia (km) desde el origen a cada uno de los 4 puntos**. Debe salir con código ≠ 0 si algo falla.

## 11. Despliegue en Cloudflare Pages

- Recomendación: **Cloudflare Pages** con subida directa: `npx wrangler pages deploy public --project-name cuatro-puntos`. (Alternativa equivalente: Workers Static Assets con `wrangler.jsonc`.) HTTPS es automático y necesario para cámara, GPS y sensores.
- `public/_headers`:
  ```
  /*
    Permissions-Policy: camera=(self), geolocation=(self), accelerometer=(self), gyroscope=(self), magnetometer=(self)
    X-Content-Type-Options: nosniff
    Referrer-Policy: no-referrer
  /*.png
    Cache-Control: public, max-age=31536000, immutable
  /vendor/*
    Cache-Control: public, max-age=31536000, immutable
  /js/*
    Cache-Control: public, max-age=300
  /index.html
    Cache-Control: no-cache
  ```
- Optimización de carga: comprimir/redimensionar los PNG solo si superan ~400 KB cada uno (mantener transparencia; sugerir WebP con alfa como mejora opcional, sin sobrescribir originales); precargar los 4 PNG mientras el usuario lee la bienvenida; sin fuentes web externas (usar `system-ui`).
- Para probar sensores en el celular durante el desarrollo se necesita HTTPS: documenta en el README dos opciones: (a) `npx wrangler pages dev public` + `cloudflared tunnel --url http://localhost:8788`, o (b) un deploy de preview en Pages.

## 12. QR (`tools/make-qr.mjs`)

- Recibe la URL final por argumento y genera `qr.svg` y `qr.png` (paquete `qrcode`, corrección de error nivel **Q o H**, margen de 4 módulos, alto contraste, tamaño ≥ 1000 px) en `tools/out/`. Recomienda en el README usar una URL **corta** (dominio propio o `*.pages.dev` con nombre corto) para que el QR sea más simple y fácil de escanear a distancia.

## 13. Criterios de aceptación (verifica y reporta cada uno)

1. `node tools/test-geo.mjs` pasa y muestra la tabla rumbo/distancia de los 4 puntos.
2. `public/` funciona servido estáticamente sin build; no hay peticiones a dominios externos en runtime (revisa el HTML/JS).
3. En modo `?mock=1` los 4 sprites aparecen a los rumbos calculados; al rotar 360° cada uno pasa por el centro exactamente al rumbo que muestra la tabla (±1°).
4. La cámara virtual usa la convención −Z = Norte / +X = Este y el rumbo del HUD coincide con el rumbo de la cámara.
5. Flujo iOS: `requestPermission` se dispara dentro del clic; hay manejo de permiso denegado.
6. Flujo Android: prioriza `AbsoluteOrientationSensor` → `deviceorientationabsolute`; hay manejo de ausencia de rumbo absoluto.
7. GPS denegado o ausente → la experiencia funciona igual con el origen fijo.
8. Las relaciones de aspecto de los PNG se respetan; la transparencia se conserva; no hay parpadeo ni "deriva" apreciable con el teléfono quieto.
9. Sin errores en consola en escritorio (modo mock) ni en flujos de permiso denegado.
10. Lighthouse móvil: rendimiento ≥ 85 en la pantalla de bienvenida.

## 14. Reglas de trabajo y entregables

- Código limpio, modular, comentado en español donde la lógica sea no obvia (especialmente marcos de referencia de ejes y cuaternios).
- No inventes coordenadas ni valores: si un dato falta (origen, nombres de PNG), pregunta o deja un `TODO` explícito.
- No borres ni modifiques los PNG que yo coloque en `public/`.
- Al terminar, entrégame un resumen corto con: (1) coordenadas del origen usadas y cómo se obtuvieron; (2) la tabla de rumbos/distancias; (3) mapeo final de PNG → puntos; (4) comandos exactos para probar en el celular y para desplegar en Cloudflare; (5) una lista de **lo que debo validar en dispositivos reales** (iPhone y Android): valor de declinación, comportamiento de `webkitCompassHeading` con el teléfono vertical, FOV vertical de la cámara trasera, y el ajuste con "Alinear" contra el Cerro Sancancio.
