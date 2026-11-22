export const SEED_URI_PREFIX = "seed://";

export function isSeedVirtualUri(uri: string | null | undefined): boolean {
  return typeof uri === "string" && uri.startsWith(SEED_URI_PREFIX);
}

export function extractTempTimestampMs(uri: string): number | null {
  const match = /tmp_(\d+)_/.exec(uri);
  if (!match) return null;
  const val = Number(match[1]);
  return Number.isFinite(val) ? val : null;
}

export function isQuotaExceededError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = "name" in err ? String((err as { name: unknown }).name) : "";
  const msg = "message" in err ? String((err as { message: unknown }).message) : "";
  return (
    name === "QuotaExceededError" ||
    msg.includes("QuotaExceededError") ||
    msg.includes("STORAGE_QUOTA_EXCEEDED") ||
    msg.toLowerCase().includes("no space left")
  );
}

export type { LocalFileBridge } from "../contracts/types";
