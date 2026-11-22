import { ResetService } from "../../backup/resetService";
import { LoginAccountInputSchema, RegisterAccountInputSchema } from "../../contracts/schemas";
import type { LocalAccountRecord, SqliteExecutor } from "../../contracts/types";
import { SettingsRepository } from "./settingsRepo";

const PBKDF2_ACCOUNT_ITERATIONS = 100_000;

interface RawLocalAccountRow extends Record<string, unknown> {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  password_salt: string;
  password_iterations: number;
  onboarding_completed: number;
  created_at_ms: number;
  updated_at_ms: number;
}

function bytesToBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += 0x8000) {
    parts.push(String.fromCharCode(...bytes.subarray(i, i + 0x8000)));
  }
  return btoa(parts.join(""));
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

async function derivePasswordHashB64(
  password: string,
  salt: Uint8Array,
  iterations: number
): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("AUTH_CRYPTO_UNAVAILABLE: WebCrypto SubtleCrypto no disponible");
  }
  const keyMaterial = await subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: new Uint8Array(salt),
      iterations,
      hash: "SHA-256",
    },
    keyMaterial,
    256
  );
  return bytesToBase64(new Uint8Array(bits));
}

function mapAccountRow(row: RawLocalAccountRow): LocalAccountRecord {
  return {
    id: row.id,
    email: row.email,
    display_name: row.display_name,
    onboarding_completed: row.onboarding_completed === 1,
    created_at_ms: Number(row.created_at_ms),
    updated_at_ms: Number(row.updated_at_ms),
  };
}

export class AuthRepository {
  private readonly settingsRepo: SettingsRepository;

  constructor(private readonly executor: SqliteExecutor) {
    this.settingsRepo = new SettingsRepository(executor);
  }

  async hasAnyAccount(): Promise<boolean> {
    const rows = await this.executor.query<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM local_accounts`
    );
    return Number(rows[0]?.cnt ?? 0) > 0;
  }

  async getById(accountId: string): Promise<LocalAccountRecord | null> {
    const rows = await this.executor.query<RawLocalAccountRow>(
      `SELECT * FROM local_accounts WHERE id = ? LIMIT 1`,
      [accountId]
    );
    return rows[0] ? mapAccountRow(rows[0]) : null;
  }

  async getActiveAccount(): Promise<LocalAccountRecord | null> {
    const settings = await this.settingsRepo.getAppSettings();
    if (!settings.active_account_id) return null;
    const account = await this.getById(settings.active_account_id);
    if (!account) {
      await this.executor.run(
        `UPDATE app_settings SET active_account_id = NULL, updated_at_ms = ? WHERE id = 1`,
        [Date.now()]
      );
      return null;
    }
    return account;
  }

  async registerAccount(input: {
    display_name: string;
    email: string;
    password: string;
  }): Promise<LocalAccountRecord> {
    const parsed = RegisterAccountInputSchema.parse(input);
    const existingRows = await this.executor.query<{ id: string }>(
      `SELECT id FROM local_accounts WHERE LOWER(TRIM(email)) = ? LIMIT 1`,
      [parsed.email]
    );
    if (existingRows.length > 0) {
      throw new Error("EMAIL_ALREADY_EXISTS: Ya existe una cuenta registrada con ese correo.");
    }

    const currentSettings = await this.settingsRepo.getAppSettings();
    if (currentSettings.boot_mode === "demo") {
      await new ResetService(this.executor).startFromScratch({
        PRE: 0,
        ANT: 0,
        FAC: 0,
        OBR: 0,
      });
    }

    const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
    const passwordHashB64 = await derivePasswordHashB64(
      parsed.password,
      salt,
      PBKDF2_ACCOUNT_ITERATIONS
    );
    const saltB64 = bytesToBase64(salt);
    const now = Date.now();
    const accountId = `acc_${crypto.randomUUID().slice(0, 12)}`;

    await this.executor.inTransaction(async (tx) => {
      await tx.run(
        `INSERT INTO local_accounts (
          id, email, display_name, password_hash, password_salt,
          password_iterations, onboarding_completed, created_at_ms, updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        [
          accountId,
          parsed.email,
          parsed.display_name,
          passwordHashB64,
          saltB64,
          PBKDF2_ACCOUNT_ITERATIONS,
          now,
          now,
        ]
      );

      await tx.run(
        `UPDATE app_settings
         SET active_account_id = ?,
             boot_mode = 'clean',
             emitter_name = CASE WHEN length(trim(emitter_name)) = 0 THEN ? ELSE emitter_name END,
             updated_at_ms = ?
         WHERE id = 1`,
        [accountId, parsed.display_name, now]
      );
    });

    const created = await this.getById(accountId);
    if (!created) {
      throw new Error("SQLITE_QUERY_ERROR: No se pudo crear la cuenta local");
    }
    return created;
  }

  async loginAccount(input: { email: string; password: string }): Promise<LocalAccountRecord> {
    const parsed = LoginAccountInputSchema.parse(input);
    const rows = await this.executor.query<RawLocalAccountRow>(
      `SELECT * FROM local_accounts WHERE LOWER(TRIM(email)) = ? LIMIT 1`,
      [parsed.email]
    );
    const row = rows[0];
    if (!row) {
      throw new Error("INVALID_CREDENTIALS: Correo o contraseña incorrectos.");
    }

    const saltBytes = base64ToBytes(row.password_salt);
    const derivedB64 = await derivePasswordHashB64(
      parsed.password,
      saltBytes,
      Number(row.password_iterations)
    );
    const expectedBytes = base64ToBytes(row.password_hash);
    const actualBytes = base64ToBytes(derivedB64);

    if (!timingSafeEqual(expectedBytes, actualBytes)) {
      throw new Error("INVALID_CREDENTIALS: Correo o contraseña incorrectos.");
    }

    await this.settingsRepo.getAppSettings();
    const now = Date.now();
    await this.executor.run(
      `UPDATE app_settings SET active_account_id = ?, updated_at_ms = ? WHERE id = 1`,
      [row.id, now]
    );
    return mapAccountRow(row);
  }

  async logout(): Promise<void> {
    await this.settingsRepo.getAppSettings();
    await this.executor.run(
      `UPDATE app_settings SET active_account_id = NULL, updated_at_ms = ? WHERE id = 1`,
      [Date.now()]
    );
  }

  async completeOnboarding(accountId: string): Promise<LocalAccountRecord> {
    const now = Date.now();
    await this.executor.run(
      `UPDATE local_accounts SET onboarding_completed = 1, updated_at_ms = ? WHERE id = ?`,
      [now, accountId]
    );
    const updated = await this.getById(accountId);
    if (!updated) {
      throw new Error("INVALID_STATE_TRANSITION: Cuenta no encontrada");
    }
    return updated;
  }

  async reopenOnboarding(accountId: string): Promise<LocalAccountRecord> {
    const now = Date.now();
    await this.executor.run(
      `UPDATE local_accounts SET onboarding_completed = 0, updated_at_ms = ? WHERE id = ?`,
      [now, accountId]
    );
    const updated = await this.getById(accountId);
    if (!updated) {
      throw new Error("INVALID_STATE_TRANSITION: Cuenta no encontrada");
    }
    return updated;
  }
}
