// Genera public/vendor/three.module.min.js a partir de node_modules/three.
// Three.js ≥ r176 ya no publica builds .min.js, así que se empaqueta y minifica aquí
// con esbuild, incluyendo solo lo que usa la app (tree-shaking).
// Si algún módulo de public/js empieza a importar otra clase de 'three', añádela a EXPORTS.
import { build } from "esbuild";
import { readFileSync, statSync } from "node:fs";

const EXPORTS = [
  "WebGLRenderer",
  "Scene",
  "PerspectiveCamera",
  "Sprite",
  "SpriteMaterial",
  "CanvasTexture",
  "SRGBColorSpace",
  "LinearFilter",
  "LinearMipmapLinearFilter",
  "Quaternion",
  "Vector3",
  "Euler",
  "MathUtils",
  "CustomBlending",
  "OneFactor",
  "OneMinusSrcAlphaFactor",
];

const out = "public/vendor/three.module.min.js";
const version = JSON.parse(readFileSync("node_modules/three/package.json", "utf8")).version;

await build({
  stdin: {
    contents: `export { ${EXPORTS.join(", ")} } from "three";`,
    resolveDir: process.cwd(),
    loader: "js",
  },
  bundle: true,
  format: "esm",
  minify: true,
  target: ["es2020", "safari15"],
  legalComments: "none",
  banner: { js: `/* three.js r${version} — MIT License — https://threejs.org/ (subset: ${EXPORTS.join(",")}) */` },
  outfile: out,
  logLevel: "warning",
});

console.log(`✓ ${out} (three ${version}, ${(statSync(out).size / 1024).toFixed(0)} KB)`);
