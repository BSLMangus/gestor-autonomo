import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const GITHUB_REPO = "BSLMangus/gestor-autonomo";
const DEFAULT_JBR_WINDOWS = "C:\\Program Files\\Android\\Android Studio\\jbr";

function parseArgs(argv) {
  let bump = null;
  let notes = "";
  let mandatory = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--mandatory") {
      mandatory = true;
    } else if (arg.startsWith("--bump=")) {
      bump = arg.slice("--bump=".length).trim();
    } else if (arg === "--bump" && argv[i + 1]) {
      bump = argv[++i].trim();
    } else if (arg.startsWith("--notes=")) {
      notes = arg.slice("--notes=".length);
    } else if (arg === "--notes" && argv[i + 1]) {
      notes = argv[++i];
    }
  }

  if (bump !== null && !["patch", "minor", "major"].includes(bump)) {
    throw new Error(`Valor inválido para --bump: "${bump}". Usa patch, minor o major.`);
  }

  return { bump, notes: notes.trim(), mandatory };
}

function bumpSemver(version, kind) {
  const parts = version.split(".").map((n) => Number.parseInt(n, 10));
  if (parts.length !== 3 || parts.some((n) => !Number.isInteger(n) || n < 0)) {
    throw new Error(`Versión semver inválida para incrementar: "${version}"`);
  }
  const [major, minor, patch] = parts;
  if (kind === "major") return `${major + 1}.0.0`;
  if (kind === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function parseKeystoreProperties(content) {
  const map = new Map();
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIdx = line.indexOf("=");
    if (eqIdx > 0) {
      map.set(line.slice(0, eqIdx).trim(), line.slice(eqIdx + 1).trim());
    }
  }
  return map;
}

function runOrThrow(cmd, args, cwd, extraEnv = {}) {
  const isWin = process.platform === "win32";
  const result = spawnSync(cmd, args, {
    cwd,
    stdio: "inherit",
    shell: isWin,
    env: { ...process.env, ...extraEnv },
  });
  if (result.error) {
    throw result.error;
  }
  if (typeof result.status === "number" && result.status !== 0) {
    throw new Error(`El comando "${cmd} ${args.join(" ")}" finalizó con código ${result.status}.`);
  }
}

function main() {
  const { bump, notes, mandatory } = parseArgs(process.argv.slice(2));

  const pkgPath = path.join(rootDir, "package.json");
  const gradlePath = path.join(rootDir, "android", "app", "build.gradle");
  const keystorePropsPath = path.join(rootDir, "android", "keystore.properties");

  if (!fs.existsSync(keystorePropsPath)) {
    throw new Error(
      "Falta android/keystore.properties. Configura primero el keystore de firma antes de compilar la release."
    );
  }

  const keystoreProps = parseKeystoreProperties(fs.readFileSync(keystorePropsPath, "utf8"));
  const storeFileRel = keystoreProps.get("storeFile");
  if (!storeFileRel) {
    throw new Error("android/keystore.properties no define storeFile.");
  }
  const keystoreFilePath = path.resolve(rootDir, "android", storeFileRel);
  if (!fs.existsSync(keystoreFilePath)) {
    throw new Error(`No se encuentra el archivo de keystore en ${keystoreFilePath}.`);
  }

  const pkgRaw = fs.readFileSync(pkgPath, "utf8");
  const pkgJson = JSON.parse(pkgRaw);
  let gradleContent = fs.readFileSync(gradlePath, "utf8");

  const codeMatch = /versionCode\s+(\d+)/.exec(gradleContent);
  const nameMatch = /versionName\s+"([^"]+)"/.exec(gradleContent);
  if (!codeMatch || !nameMatch) {
    throw new Error("No se encontró versionCode / versionName en android/app/build.gradle.");
  }

  let versionCode = Number.parseInt(codeMatch[1], 10);
  let versionName = nameMatch[1].trim();

  if (bump) {
    versionCode += 1;
    versionName = bumpSemver(versionName, bump);

    pkgJson.version = versionName;
    fs.writeFileSync(pkgPath, `${JSON.stringify(pkgJson, null, 2)}\n`, "utf8");

    gradleContent = gradleContent
      .replace(/versionCode\s+\d+/, `versionCode ${versionCode}`)
      .replace(/versionName\s+"[^"]+"/, `versionName "${versionName}"`);
    fs.writeFileSync(gradlePath, gradleContent, "utf8");
    console.log(`[release:android] Versión actualizada a v${versionName} (versionCode ${versionCode}).`);
  } else {
    console.log(`[release:android] Compilando versión actual v${versionName} (versionCode ${versionCode}).`);
  }

  runOrThrow("npm", ["run", "build:capacitor"], rootDir);

  const javaHome =
    process.env.JAVA_HOME && fs.existsSync(process.env.JAVA_HOME)
      ? process.env.JAVA_HOME
      : process.platform === "win32" && fs.existsSync(DEFAULT_JBR_WINDOWS)
        ? DEFAULT_JBR_WINDOWS
        : undefined;

  if (!javaHome) {
    throw new Error("No se encontró JAVA_HOME ni el JBR de Android Studio.");
  }

  const androidDir = path.join(rootDir, "android");
  const gradlewCmd = process.platform === "win32" ? "gradlew.bat" : "./gradlew";
  runOrThrow(gradlewCmd, ["assembleRelease"], androidDir, { JAVA_HOME: javaHome });

  const builtApkPath = path.join(
    androidDir,
    "app",
    "build",
    "outputs",
    "apk",
    "release",
    "app-release.apk"
  );
  if (!fs.existsSync(builtApkPath)) {
    throw new Error(`No se generó el APK esperado en ${builtApkPath}.`);
  }

  const apkBuffer = fs.readFileSync(builtApkPath);
  const sha256 = createHash("sha256").update(apkBuffer).digest("hex").toLowerCase();

  const apkFileName = `GestorAutonomo-v${versionName}.apk`;
  const releasesDir = path.join(rootDir, "releases");
  fs.mkdirSync(releasesDir, { recursive: true });

  const outApkPath = path.join(releasesDir, apkFileName);
  fs.copyFileSync(builtApkPath, outApkPath);

  const manifest = {
    versionCode,
    versionName,
    apkUrl: `https://github.com/${GITHUB_REPO}/releases/latest/download/${apkFileName}`,
    sha256,
    releaseNotes: notes || `Gestor Autónomo v${versionName}`,
    mandatory,
  };

  const outManifestPath = path.join(releasesDir, "version.json");
  fs.writeFileSync(outManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  console.log("");
  console.log("========================================");
  console.log("Release Android firmada lista:");
  console.log(`- APK: ${outApkPath}`);
  console.log(`- Manifiesto: ${outManifestPath}`);
  console.log(`- SHA-256: ${sha256}`);
  console.log("");
  console.log("Cómo publicarla para que se actualice en el móvil de tu madre:");
  console.log(`1. Abre https://github.com/${GITHUB_REPO}/releases/new (crea el repo si aún no existe).`);
  console.log(`2. Usa como Tag: v${versionName}`);
  console.log(`3. Adjunta estos dos archivos exactos: ${apkFileName} y version.json`);
  console.log("4. Publica la Release como Latest release.");
  console.log("========================================");
}

main();
