import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const projectRoot = process.cwd();
const ocrOutDir = path.join(projectRoot, "public", "assets", "ocr");
const mediapipeOutDir = path.join(projectRoot, "public", "assets", "mediapipe", "wasm");
const pdfOutDir = path.join(projectRoot, "public", "assets", "pdf");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyFile(src, dest) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

function copyDirectory(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) return;
  ensureDir(destDir);
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(srcPath, destPath);
    } else if (entry.isFile()) {
      copyFile(srcPath, destPath);
    }
  }
}

function resolvePackageRoot(pkgName) {
  try {
    const pkgJsonPath = require.resolve(`${pkgName}/package.json`, { paths: [projectRoot] });
    return path.dirname(pkgJsonPath);
  } catch {
    const fallback = path.join(projectRoot, "node_modules", ...pkgName.split("/"));
    return fs.existsSync(fallback) ? fallback : null;
  }
}

function findFileRecursive(dir, filename) {
  if (!fs.existsSync(dir)) return null;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && entry.name === filename) {
      return full;
    }
    if (entry.isDirectory()) {
      const nested = findFileRecursive(full, filename);
      if (nested) return nested;
    }
  }
  return null;
}

function main() {
  ensureDir(ocrOutDir);
  ensureDir(mediapipeOutDir);
  ensureDir(pdfOutDir);

  // 1. tesseract.js worker
  const tesseractRoot = resolvePackageRoot("tesseract.js");
  if (tesseractRoot) {
    const workerSrc = path.join(tesseractRoot, "dist", "worker.min.js");
    if (fs.existsSync(workerSrc)) {
      copyFile(workerSrc, path.join(ocrOutDir, "worker.min.js"));
    }
  }

  // 2. tesseract.js-core WASM + JS wrappers
  const tesseractCoreRoot = resolvePackageRoot("tesseract.js-core");
  if (tesseractCoreRoot) {
    for (const file of fs.readdirSync(tesseractCoreRoot)) {
      if (/^tesseract-core.*\.(wasm\.js|wasm)$/i.test(file)) {
        copyFile(path.join(tesseractCoreRoot, file), path.join(ocrOutDir, file));
      }
    }
  }

  // 3. @tesseract.js-data/spa -> spa.traineddata.gz
  const spaRoot = resolvePackageRoot("@tesseract.js-data/spa");
  if (spaRoot) {
    const spaFile = findFileRecursive(spaRoot, "spa.traineddata.gz");
    if (spaFile) {
      copyFile(spaFile, path.join(ocrOutDir, "spa.traineddata.gz"));
    }
  }

  // 4. @mediapipe/tasks-genai/wasm/*
  const mediapipeRoot = resolvePackageRoot("@mediapipe/tasks-genai");
  if (mediapipeRoot) {
    const wasmDir = path.join(mediapipeRoot, "wasm");
    if (fs.existsSync(wasmDir)) {
      for (const file of fs.readdirSync(wasmDir)) {
        const src = path.join(wasmDir, file);
        if (fs.statSync(src).isFile()) {
          copyFile(src, path.join(mediapipeOutDir, file));
        }
      }
    }
  }

  // 5. pdfjs-dist legacy worker, cmaps & standard_fonts
  const pdfjsRoot = resolvePackageRoot("pdfjs-dist");
  if (pdfjsRoot) {
    const workerSrc = path.join(pdfjsRoot, "legacy", "build", "pdf.worker.min.mjs");
    if (fs.existsSync(workerSrc)) {
      copyFile(workerSrc, path.join(pdfOutDir, "pdf.worker.min.mjs"));
    }
    copyDirectory(path.join(pdfjsRoot, "cmaps"), path.join(pdfOutDir, "cmaps"));
    copyDirectory(path.join(pdfjsRoot, "standard_fonts"), path.join(pdfOutDir, "standard_fonts"));
  }

  console.log("[sync-assets] Activos locales OCR, PDF.js y MediaPipe sincronizados.");
}

main();
