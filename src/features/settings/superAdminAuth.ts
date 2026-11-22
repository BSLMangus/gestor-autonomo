// Hash SHA-256 por defecto SOLO para entorno de desarrollo/pruebas (PIN dev: "246800")
const DEV_FALLBACK_PIN_SHA256 =
  "ffc4bc4e5c36110d47702a774b64d4a090d2c47150d4fb1a23be9b1ed0b2e938";

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function hashPinSha256(pin: string): Promise<string> {
  const encoded = new TextEncoder().encode(pin.trim());
  const digest = await globalThis.crypto.subtle.digest("SHA-256", encoded);
  return toHex(new Uint8Array(digest));
}

function getConfiguredPinHash(): { hash: string | null; isDevFallback: boolean } {
  const env = (import.meta as { env?: Record<string, string | boolean | undefined> }).env ?? {};
  const configured =
    typeof env.VITE_SUPERADMIN_PIN_HASH === "string"
      ? env.VITE_SUPERADMIN_PIN_HASH.trim().toLowerCase()
      : "";

  if (/^[0-9a-f]{64}$/.test(configured)) {
    return { hash: configured, isDevFallback: false };
  }

  const isDevOrTest = Boolean(env.DEV) || Boolean(env.VITEST);
  if (isDevOrTest) {
    return { hash: DEV_FALLBACK_PIN_SHA256, isDevFallback: true };
  }

  return { hash: null, isDevFallback: false };
}

export function isUsingDevSuperAdminPin(): boolean {
  return getConfiguredPinHash().isDevFallback;
}

export async function verifySuperAdminPin(
  pin: string,
  expectedHashOverride?: string
): Promise<boolean> {
  const trimmed = pin.trim();
  if (!trimmed) return false;

  const targetHash = expectedHashOverride?.trim().toLowerCase() || getConfiguredPinHash().hash;
  if (!targetHash || !/^[0-9a-f]{64}$/.test(targetHash)) {
    return false;
  }

  const candidateHash = await hashPinSha256(trimmed);
  if (candidateHash.length !== targetHash.length) return false;

  let diff = 0;
  for (let i = 0; i < candidateHash.length; i += 1) {
    diff |= candidateHash.charCodeAt(i) ^ targetHash.charCodeAt(i);
  }
  return diff === 0;
}
