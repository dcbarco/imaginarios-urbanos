// Fuente única de verdad del proyecto. Ningún otro archivo debe contener coordenadas,
// nombres de lugares ni nombres de imágenes.
export const CONFIG = {
  // Coordenadas medidas en la terraza (punto de escaneo del QR). No cambiar.
  origin: { name: "Terraza - Centro Cultural Universitario Rogelio Salmona", lat: 5.054639316762688, lng: -75.49156875803418 },

  // `image`: nombre EXACTO del archivo en public/ (los PNG entregados usan espacios;
  // la app los codifica al construir la URL). Todos miden 4321×1859 px (RGBA);
  // la relación de aspecto se lee en runtime de cada imagen, no de aquí.
  // `elevationDeg`/`angularWidthDeg`/`bearingOffsetDeg` son ajustables en vivo con ?debug=1
  // (sección "Ajuste fino por punto") — usa el botón "Copiar valores" allí para actualizar
  // estos números tras probar en la terraza.
  // `bearingOffsetDeg`: corrección manual de rumbo (grados; negativo = mueve la imagen a la
  // izquierda). NO toca el rumbo geodésico real (`trueBearing`, el que valida test-geo.mjs);
  // solo desplaza el `displayBearing` para compensar paralaje/perspectiva vistos desde la
  // terraza real (p. ej. si el punto de referencia elegido no es exactamente lo que se ve).
  //
  // Valores calibrados en la terraza (2026-09-28) con el panel ?debug=1. Durante esa prueba el
  // GPS reportó una posición ~200 m desplazada, así que los offsets del panel se recalcularon
  // para que sean relativos al ORIGEN fijo y sin la alineación manual del teléfono de prueba
  // (+1,64°): son la dirección física donde cada imagen coincidía con el lugar real.
  // Si recalibras, hazlo con positionMode "fixed" (o comprobando en ?debug=1 que diga
  // "origen fijo") y tras "Restablecer" la alineación manual, para poder copiarlos tal cual.
  points: [
    { id: "colina",  label: "La Colina",      place: "Cerro Sancancio",    lat: 5.046013136467171,  lng: -75.494355479765,   image: "la colina.png",      elevationDeg: 7.5,  angularWidthDeg: 24, bearingOffsetDeg: 0 },
    { id: "perla",   label: "Perla del Ruiz", place: "Nevado del Ruiz",    lat: 4.8910285046725495, lng: -75.32219651683367, image: "perla del ruiz.png", elevationDeg: 10.5, angularWidthDeg: 24, bearingOffsetDeg: 6.0 },
    { id: "ciudad",  label: "La Ciudad",      place: "Zona del Cable",     lat: 5.056206752550917,  lng: -75.48641124470727, image: "la ciudad.png",      elevationDeg: 14.5, angularWidthDeg: 34, bearingOffsetDeg: -11.9 },
    { id: "fabrica", label: "Fábrica",        place: "Dirección a Chipre", lat: 5.076726282340162,  lng: -75.52799225866666, image: "fabrica.png",        elevationDeg: 18,   angularWidthDeg: 34, bearingOffsetDeg: -25.8 },
  ],

  // "real": cada imagen en su rumbo geográfico verdadero (DEFAULT; cumple el criterio nº 1).
  // "cardinal": mismo orden angular pero forzados a 360°/n entre sí — solo estético.
  layoutMode: "real",
  // Rumbo del primer punto (ordenado por rumbo real) en modo "cardinal".
  // null = el que minimiza la desviación respecto a los rumbos reales.
  cardinalBaseDeg: null,

  // Declinación magnética en Manizales (grados, ESTE positivo, OESTE negativo). Aprox. −7°.
  // VERIFICAR para la fecha actual con NOAA WMM (ngdc.noaa.gov/geomag/calculators/magcalc.shtml)
  // o con el paquete npm `geomagnetism`. Rumbo verdadero = rumbo magnético + declinación.
  magneticDeclinationDeg: -7.0,

  // "fixed": el QR está en la terraza, así que siempre se usa el origen medido. En la prueba del
  // 2026-09-28 el GPS se desvió ~200 m reportando ±20 m de precisión: "hybrid" cambió al GPS y
  // La Ciudad (a 0,6 km) se corrió 19°. Usa "hybrid" solo si el QR se escanea lejos de la terraza.
  positionMode: "fixed",      // "fixed" | "gps" | "hybrid"
  hybridRadiusM: 150,         // dentro de este radio del origen se usa el origen fijo
  gpsMaxAccuracyM: 40,        // fixes peores que esto se ignoran
  gpsAverageFixes: 5,         // nº de fixes promediados (peso 1/accuracy²)

  // verticalFovDeg: FOV del lado LARGO de la pantalla (vertical en retrato). En paisaje
  // se conserva sobre el eje horizontal. Ajustable en vivo con ?debug=1.
  camera: { verticalFovDeg: 60, sphereRadius: 50 },
  smoothing: { orientationSlerp: 0.18, yawOffsetAlpha: 0.02, jumpThresholdDeg: 60, jumpHoldMs: 100, deadZoneDeg: 0.2 },

  // iOS: el offset de yaw solo se actualiza con el teléfono ~vertical y brújula precisa.
  ios: { betaMinDeg: 50, betaMaxDeg: 130, maxCompassAccuracyDeg: 25 },

  // Aviso de interferencia: rumbo oscila más de `headingSpreadDeg` con el teléfono quieto `windowMs`.
  interference: { windowMs: 2000, headingSpreadDeg: 10, stillToleranceDeg: 2.5 },

  // Las imágenes se recortan al contenido visible (el dibujo solo ocupa la franja inferior
  // del PNG) y se reducen en el navegador a ~1,5× su tamaño en pantalla, sin superar
  // maxTextureWidth. `angularWidthDeg` de cada punto es el ancho del DIBUJO.
  sprite: { floatAmplitudeDeg: 0.4, floatPeriodS: 5, fadeInMs: 600, maxTextureWidth: 2048, minTextureWidth: 768, repositionMs: 900 },
  showDistanceLabel: true,     // pequeño texto "≈ 23 km" bajo cada imagen

  // Realce de contraste (ver js/enhance.js). El visitante puede cambiar el modo con el botón ◐;
  // `mode` es el valor inicial: "original" | "realce" | "maximo". Radios en px para 1024 px de ancho.
  contrast: {
    mode: "realce",
    brightThreshold: 170,      // luminancia (0–255) a partir de la cual un píxel es "texto claro"
    lineAlphaGain: 2.2,        // recupera la opacidad que pierden las líneas finas al reducirse
    lineThickenPx: 1,          // engrosa las líneas
    lineDarken: 0.45,          // 0 = color original de las líneas (llega a gris medio), 1 = lineColor
    lineColor: "#0f2a24",
    // Halos: máscara difuminada (blurPx) y amplificada (strength: más = halo más ancho y sólido).
    darkHalo: { blurPx: 6, strength: 3.5, opacity: 0.8 },    // sombra oscura tras el texto blanco
    // Las líneas paralelas están a ~7 px (a 1024 px de ancho): un halo más ancho rellena los huecos.
    lightHalo: { blurPx: 2, strength: 2, opacity: 0.8 },     // resplandor claro tras las líneas oscuras
    plate: { opacity: 0.42, blurFrac: 0.35 },              // modo "maximo": placa oscura difusa detrás
    cameraDim: 0.22,                                        // modo "maximo": atenúa la imagen de la cámara
  },

  // Asistente de calibración: se completa al acumular este giro del teléfono ("dibuja un 8")
  // y, en iPhone, con precisión de brújula ≤ ios.maxCompassAccuracyDeg.
  calibration: { motionTargetDeg: 540, minMs: 2000, allowContinueAfterMs: 12000, referencePointId: "colina" },
  storageKey: "cuatro_puntos.v1",
};
