# Cuatro Puntos

Realidad aumentada 100 % web (sin app) para la terraza del **Centro Cultural Universitario Rogelio Salmona** (Manizales, Caldas). El visitante escanea un QR, toca **Comenzar** y, al girar con el celular, ve 4 imágenes PNG suspendidas en el aire en la dirección geográfica real de cada lugar.

| Texto | Lugar | Rumbo verdadero | Distancia | Archivo |
|---|---|---|---|---|
| La Ciudad | Zona del Cable | 73,03° (E) | 0,597 km | `public/la ciudad.png` |
| Perla del Ruiz | Nevado del Ruiz | 134,11° (SE) | 26,13 km | `public/perla del ruiz.png` |
| La Colina | Cerro Sancancio | 197,84° (S) | 1,008 km | `public/la colina.png` |
| Fábrica | Dirección a Chipre | 301,33° (NO) | 4,723 km | `public/fabrica.png` |

(Calculados desde el origen fijo `5.054639316762688, -75.49156875803418` por `node tools/test-geo.mjs`.)

## Cómo funciona

- Sitio estático (`public/`), sin build ni backend. Única dependencia en runtime: Three.js, vendorizado en `public/vendor/` (sin CDN).
- Los rumbos se calculan desde el **origen fijo medido en la terraza**; el GPS solo se usa si el visitante está a más de `hybridRadiusM` (150 m) del origen. Lo crítico es la brújula, no la posición.
- Orientación por prioridad: `AbsoluteOrientationSensor` → `deviceorientationabsolute` → `deviceorientation` absoluto → iOS (`webkitCompassHeading`) → `deviceorientation` relativo (con alineación manual obligatoria) → arrastre con el dedo/ratón.
- Rumbo verdadero = rumbo magnético + `magneticDeclinationDeg` + corrección manual ("Alinear").
- Toda la configuración está en `public/js/config.js`.

## Experiencia del visitante

1. **Bienvenida** → "Comenzar" (pide permisos de movimiento, cámara y ubicación). Mientras lee, las imágenes se preparan en segundo plano.
2. **Asistente de calibración** (2 pasos, cada uno omitible):
   - **Brújula**: "dibuja un 8". La barra avanza con el giro real del teléfono (`calibration.motionTargetDeg`); en iPhone además exige precisión ≤ 25°. Termina solo al completarse.
   - **Dirección**: aparece una **mira** en el centro. El visitante apunta la mira al Cerro Sancancio real (u otro punto de la lista) y ve cuántos grados separan la imagen de la mira. Si coincide → "Coincide ✓". Si no → "Alinear con la mira" y ajuste fino ◀ 1° / 1° ▶. Si el teléfono no da el norte, este paso es obligatorio.
3. **HUD**: brújula con los 4 puntos, flechas hacia el punto más cercano fuera de pantalla, y botones **?** (ayuda), **Brújula** (indicador verde/ámbar/rojo; tocarlo recalibra), **Alinear** y **◐** (contraste).
4. Si la brújula se degrada (interferencia o baja precisión), aparece un aviso con botón **Calibrar**. Si se niega la cámara o el movimiento, hay avisos con instrucciones y botón **Recargar**.

## Contraste de las imágenes

Las imágenes son texto blanco + líneas finas oscuras, y se pierden sobre cielo claro o terreno oscuro. Sin tocar los PNG, la app prepara tres variantes (en un Web Worker, `js/enhance.js`) y el visitante las alterna con **◐** (se recuerda en el teléfono):

| Modo | Qué hace |
|---|---|
| Original | Solo recorta el espacio vacío (el dibujo ocupa el 28 % inferior del PNG) |
| **Realzado** (inicial) | Líneas más opacas, gruesas y oscuras + halo oscuro tras el texto blanco + borde claro tras las líneas |
| Máximo | Realzado + placa oscura difusa detrás + cámara atenuada un 22 % |

Todos los parámetros están en `contrast` de `config.js` (`mode` es el modo inicial). Tras el recorte, `angularWidthDeg` y `elevationDeg` se refieren al dibujo en sí, que ahora queda centrado en su punto.

## Comandos

```bash
npm install            # instala three, esbuild, qrcode y selfsigned (solo para herramientas)
npm run lan            # servidor HTTPS para probar desde celulares en la misma Wi-Fi
npm test               # node tools/test-geo.mjs — prueba la matemática y muestra la tabla de rumbos
npm run vendor         # regenera public/vendor/three.module.min.js desde node_modules/three
npm run qr -- https://cuatro-puntos.pages.dev   # genera tools/out/qr.svg y qr.png
```

`npm run vendor` empaqueta y minifica con esbuild solo las clases de Three.js que usa la app (Three ≥ r176 ya no publica builds `.min.js`). Si un módulo empieza a importar otra clase de `three`, añádela a `EXPORTS` en `tools/vendor-three.mjs`.

## Probar en el escritorio

Cualquier servidor estático sirve `public/`. Por ejemplo:

```bash
npx wrangler pages dev public        # http://localhost:8788
```

- `?mock=1` — sin cámara ni sensores; arrastra (o usa las flechas; Shift = 10°) para girar.
- `?debug=1` — panel con fuente de orientación, α/β/γ, rumbo magnético, declinación, offsets, GPS, tabla de rumbos/distancias, FPS, sliders en vivo y "Copiar diagnóstico".
- `?origin=lat,lng` — sustituye el origen (para probar desde otro lugar).

Con `?mock=1` o `?debug=1` la consola expone `cuatroPuntos.setHeading(grados)`, `cuatroPuntos.project()`, `cuatroPuntos.openGuide("calibrate" | "verify")` y `cuatroPuntos.diagnostics()`.

## Probar en el celular desde tu red Wi-Fi (recomendado antes de desplegar)

La cámara, el GPS y los sensores **solo funcionan con HTTPS**; por eso `http://IP` no sirve. `npm run lan` levanta un servidor HTTPS con un certificado autofirmado que incluye la IP de tu PC:

```bash
npm run lan
```

Muestra la dirección (p. ej. `https://10.15.0.236:8443/`) y un **QR en la terminal** para escanear con el celular. Además:

- Sirve las mismas cabeceras de `public/_headers` que Cloudflare, pero **sin caché**: edita y recarga el celular para ver los cambios.
- Registra en la terminal cada petición con la IP del celular que la hace.
- `http://IP:8080` redirige a la versión HTTPS.
- Opciones: `npm run lan -- --port 9443`, `--http-port 8081`, `--cache` (usa la caché de `_headers`).

**La primera vez, en cada celular**, el navegador dirá que la conexión no es privada (el certificado es autofirmado):

- **Android / Chrome**: *Configuración avanzada* → *Acceder a 10.15.0.236 (sitio no seguro)*.
- **iPhone / Safari**: *Mostrar detalles* → *visitar este sitio web* → *Visitar sitio web*.

Si el celular no carga la página:

- Cuando Windows pregunte por Node.js en el firewall, permítelo en **redes privadas**. Si no preguntó, abre *Firewall de Windows* → *Permitir una aplicación* y marca Node.js en "Privada".
- Celular y PC deben estar en la **misma Wi-Fi**. Las redes de invitados o corporativas suelen aislar los equipos entre sí.
- Si cambia la IP del PC, el certificado se regenera solo (vuelve a aceptarlo en el celular).

Añade `?debug=1` a la dirección para ver el panel de diagnóstico en el celular.

## Otras formas de probar con HTTPS

**a) Túnel público a tu PC** (útil si el celular no está en tu Wi-Fi)

```bash
npx wrangler pages dev public
cloudflared tunnel --url http://localhost:8788      # imprime una URL https://….trycloudflare.com
```

Abre esa URL en el celular (añade `?debug=1` para ver el diagnóstico).

**b) Deploy de preview en Cloudflare Pages**

```bash
npx wrangler pages deploy public --project-name cuatro-puntos --branch preview
```

## Desplegar

```bash
npx wrangler login                                              # una sola vez
npx wrangler pages deploy public --project-name cuatro-puntos   # producción
node tools/make-qr.mjs https://cuatro-puntos.pages.dev          # QR de la URL final
```

`public/_headers` define `Permissions-Policy` (cámara, geolocalización y sensores) y la caché. Usa una URL **corta** (dominio propio o un `*.pages.dev` de nombre corto): el QR sale más simple y se escanea mejor a distancia. El QR se genera con corrección de errores H, margen de 4 módulos y 1200 px.

## Imágenes

Los PNG (4321×1859 px, RGBA, ~180 KB cada uno) se usan con sus nombres originales, con espacios; `config.js` los referencia tal cual y la app codifica la URL. No se modifican: en el navegador se recortan al dibujo y se reducen a ~1,5× su tamaño en pantalla (entre `sprite.minTextureWidth` y `sprite.maxTextureWidth`) para no agotar la memoria de GPU del celular. Para cambiar una imagen, reemplaza el archivo o ajusta `image` en `config.js`.

## Validar en dispositivos reales (iPhone y Android)

1. **Declinación magnética**: `magneticDeclinationDeg` es −7,0° (aprox.). Verifícala para la fecha actual en la [calculadora NOAA](https://www.ngdc.noaa.gov/geomag/calculators/magcalc.shtml) con el origen; se puede probar en vivo con el slider de `?debug=1`.
2. **iPhone — `webkitCompassHeading` con el teléfono vertical**: en `?debug=1`, apuntando la cámara trasera a un rumbo conocido, el "Rumbo verdadero cámara" debe coincidir. El offset de yaw solo se estima en retrato (β entre 50° y 130°).
3. **FOV vertical de la cámara trasera**: `camera.verticalFovDeg` (60°). Con `?debug=1`, gira y comprueba que la imagen se mueve a la misma velocidad que el paisaje; si "resbala", ajusta el slider de FOV y copia el valor a `config.js`.
4. **Alinear contra el Cerro Sancancio**: desde la terraza, apunta al cerro, toca **Alinear** y verifica que los otros 3 puntos quedan en su sitio (error ≤ ±5°). Si hace falta una corrección fija para todos los teléfonos, probablemente sea la declinación.
5. Android sin brújula absoluta: debe pedir alinear antes de mostrar las imágenes.
6. Permiso de movimiento denegado en iOS: debe mostrar cómo reactivarlo (Ajustes → Safari → Movimiento y orientación) y permitir arrastrar.
7. **Contraste en la terraza**, con sol y con cielo nublado: prueba los tres modos con ◐ y fija el mejor en `contrast.mode`. Si hace falta, ajusta los halos o `cameraDim`.
8. **Calibración**: que la barra del "dibuja un 8" se complete con un movimiento razonable (`calibration.motionTargetDeg`) y que el indicador "Brújula" cambie de color al acercarse a una baranda metálica.
