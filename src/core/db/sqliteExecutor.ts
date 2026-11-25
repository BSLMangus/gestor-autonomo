import schemaSql from "../../../docs/schema.sql?raw";
import type { SqliteExecutor } from "../contracts/types";

const FTS5_BOOLEAN_OPERATORS = new Set(["AND", "OR", "NOT", "NEAR"]);

/**
 * Sanitiza consultas de usuario para FTS5 eliminando caracteres especiales
 * y operadores booleanos independientes antes de entrecomillar cada término.
 */
export function sanitizeFts5Query(raw: string): string {
  const cleaned = raw.replace(/[-/%"*()]/g, " ");
  const tokens = cleaned
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && !FTS5_BOOLEAN_OPERATORS.has(t.toUpperCase()));

  if (tokens.length === 0) {
    return "";
  }
  return tokens.map((t) => `"${t}"`).join(" ");
}

/**
 * Divide un script SQL respetando comentarios (-- y /* *\/), literales ('...')
 * y bloques CREATE TRIGGER ... BEGIN ...; ...; END; de docs/schema.sql.
 */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;
  let pendingTrigger = false;
  let triggerBlockDepth = 0;

  let i = 0;
  while (i < sql.length) {
    const ch = sql[i] ?? "";
    const next = sql[i + 1] ?? "";

    if (inLineComment) {
      if (ch === "\n") {
        inLineComment = false;
        current += "\n";
      }
      i += 1;
      continue;
    }

    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i += 2;
      } else {
        i += 1;
      }
      continue;
    }

    if (inSingleQuote) {
      current += ch;
      if (ch === "'" && next === "'") {
        current += "'";
        i += 2;
        continue;
      }
      if (ch === "'") {
        inSingleQuote = false;
      }
      i += 1;
      continue;
    }

    if (inDoubleQuote) {
      current += ch;
      if (ch === '"' && next === '"') {
        current += '"';
        i += 2;
        continue;
      }
      if (ch === '"') {
        inDoubleQuote = false;
      }
      i += 1;
      continue;
    }

    if (ch === "-" && next === "-") {
      inLineComment = true;
      i += 2;
      continue;
    }

    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i += 2;
      continue;
    }

    if (ch === "'") {
      inSingleQuote = true;
      current += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inDoubleQuote = true;
      current += ch;
      i += 1;
      continue;
    }

    if (/[A-Za-z_]/.test(ch)) {
      let end = i + 1;
      while (end < sql.length && /[A-Za-z0-9_]/.test(sql[end] ?? "")) {
        end += 1;
      }
      const word = sql.slice(i, end);
      const upper = word.toUpperCase();
      current += word;
      if (upper === "TRIGGER") {
        pendingTrigger = true;
      } else if (upper === "BEGIN" && (pendingTrigger || triggerBlockDepth > 0)) {
        pendingTrigger = false;
        triggerBlockDepth += 1;
      } else if (upper === "CASE" && triggerBlockDepth > 0) {
        triggerBlockDepth += 1;
      } else if (upper === "END" && triggerBlockDepth > 0) {
        triggerBlockDepth -= 1;
      }
      i = end;
      continue;
    }

    if (ch === ";" && triggerBlockDepth === 0) {
      const trimmed = current.trim();
      if (trimmed.length > 0) {
        statements.push(trimmed);
      }
      current = "";
      pendingTrigger = false;
      i += 1;
      continue;
    }

    current += ch;
    i += 1;
  }

  const tail = current.trim();
  if (tail.length > 0) {
    statements.push(tail);
  }
  return statements;
}

async function rebuildLegacySequencesTable(executor: SqliteExecutor): Promise<void> {
  await executor.inTransaction(async (tx) => {
    await tx.run(`DROP TABLE IF EXISTS sequences_migrated;`);
    await tx.run(
      `CREATE TABLE sequences_migrated (
        series_type TEXT NOT NULL CHECK (series_type IN ('PRE', 'ANT', 'FAC', 'OBR', 'ACT')),
        fiscal_year INTEGER NOT NULL CHECK (fiscal_year BETWEEN 2020 AND 2100),
        last_seq INTEGER NOT NULL DEFAULT 0 CHECK (last_seq >= 0),
        updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0),
        PRIMARY KEY (series_type, fiscal_year)
      );`
    );
    await tx.run(
      `INSERT INTO sequences_migrated (series_type, fiscal_year, last_seq, updated_at_ms)
       SELECT series_type, fiscal_year, last_seq, updated_at_ms FROM sequences;`
    );
    await tx.run(`DROP TABLE sequences;`);
    await tx.run(`ALTER TABLE sequences_migrated RENAME TO sequences;`);
    const fkViolations = await tx.query<Record<string, unknown>>(`PRAGMA foreign_key_check;`);
    if (fkViolations.length > 0) {
      throw new Error(
        `SQLITE_QUERY_ERROR: Violación FK tras migrar sequences (${JSON.stringify(fkViolations[0])})`
      );
    }
  });
}

async function rebuildLegacyQuotesTable(
  executor: SqliteExecutor,
  quoteCols: Array<{ name: string; notnull: number }>
): Promise<void> {
  const hasValidity = quoteCols.some((c) => c.name === "validity_days");
  const hasMethods = quoteCols.some((c) => c.name === "payment_methods_json");
  const hasSchedule = quoteCols.some((c) => c.name === "payment_schedule_json");
  const validityExpr = hasValidity ? "validity_days" : "NULL";
  const methodsExpr = hasMethods ? "COALESCE(payment_methods_json, '[]')" : "'[]'";
  const scheduleExpr = hasSchedule ? "COALESCE(payment_schedule_json, '[]')" : "'[]'";

  await executor.run("PRAGMA foreign_keys = OFF;");
  const fkState = await executor.query<{ foreign_keys: number }>("PRAGMA foreign_keys;");
  if (fkState[0] && Number(fkState[0].foreign_keys) !== 0) {
    await executor.run("PRAGMA foreign_keys = ON;");
    throw new Error("SQLITE_QUERY_ERROR: No se pudo desactivar foreign_keys para migrar quotes");
  }

  try {
    await executor.inTransaction(async (tx) => {
      await tx.run(`DROP TABLE IF EXISTS quotes_migrated;`);
      await tx.run(
        `CREATE TABLE quotes_migrated (
          id TEXT PRIMARY KEY,
          quote_code TEXT NOT NULL UNIQUE,
          job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,
          client_id TEXT REFERENCES clients(id) ON DELETE RESTRICT,
          client_name_snapshot TEXT NOT NULL DEFAULT '',
          client_nif_snapshot TEXT NOT NULL DEFAULT '',
          client_address_snapshot TEXT NOT NULL DEFAULT '',
          client_phone_snapshot TEXT NOT NULL DEFAULT '',
          vat_rate REAL NOT NULL CHECK (vat_rate >= 0 AND vat_rate <= 100),
          subtotal_cents INTEGER NOT NULL CHECK (subtotal_cents >= 0),
          vat_cents INTEGER NOT NULL CHECK (vat_cents >= 0),
          total_cents INTEGER NOT NULL CHECK (total_cents >= 0 AND total_cents = subtotal_cents + vat_cents),
          status TEXT NOT NULL DEFAULT 'borrador' CHECK (status IN ('borrador', 'enviado', 'aceptado', 'rechazado')),
          validity_days INTEGER CHECK (validity_days IS NULL OR (validity_days BETWEEN 1 AND 365)),
          payment_methods_json TEXT NOT NULL DEFAULT '[]',
          payment_schedule_json TEXT NOT NULL DEFAULT '[]',
          notes TEXT NOT NULL DEFAULT '',
          pdf_uri TEXT,
          sent_at_iso TEXT CHECK (sent_at_iso IS NULL OR sent_at_iso GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
          created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
          updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0)
        );`
      );
      await tx.run(
        `INSERT INTO quotes_migrated (
          id, quote_code, job_id, client_id, client_name_snapshot, client_nif_snapshot,
          client_address_snapshot, client_phone_snapshot, vat_rate, subtotal_cents,
          vat_cents, total_cents, status, validity_days, payment_methods_json,
          payment_schedule_json, notes, pdf_uri, sent_at_iso, created_at_ms, updated_at_ms
        ) SELECT
          id, quote_code, job_id, client_id,
          COALESCE(client_name_snapshot, ''),
          COALESCE(client_nif_snapshot, ''),
          COALESCE(client_address_snapshot, ''),
          COALESCE(client_phone_snapshot, ''),
          vat_rate, subtotal_cents, vat_cents, total_cents, status,
          ${validityExpr}, ${methodsExpr}, ${scheduleExpr},
          COALESCE(notes, ''), pdf_uri, sent_at_iso, created_at_ms, updated_at_ms
        FROM quotes;`
      );
      await tx.run(`DROP TABLE quotes;`);
      await tx.run(`ALTER TABLE quotes_migrated RENAME TO quotes;`);
      await tx.run(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_quotes_one_active_per_job ON quotes(job_id) WHERE status != 'rechazado';`
      );
      await tx.run(
        `CREATE INDEX IF NOT EXISTS idx_quotes_status ON quotes(status, updated_at_ms DESC);`
      );
      const fkViolations = await tx.query<Record<string, unknown>>(`PRAGMA foreign_key_check;`);
      if (fkViolations.length > 0) {
        throw new Error(
          `SQLITE_QUERY_ERROR: Violación FK tras migrar quotes (${JSON.stringify(fkViolations[0])})`
        );
      }
    });
  } finally {
    await executor.run("PRAGMA foreign_keys = ON;");
  }
}

export async function initializeSchema(executor: SqliteExecutor): Promise<void> {
  await executor.run("PRAGMA foreign_keys = ON;");
  const statements = splitSqlStatements(schemaSql);
  for (const stmt of statements) {
    await executor.run(stmt);
  }
  const seqTableRows = await executor.query<{ sql: string | null }>(
    `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'sequences'`
  );
  const seqTableSql = seqTableRows[0]?.sql;
  if (typeof seqTableSql === "string" && !seqTableSql.includes("'ACT'")) {
    await rebuildLegacySequencesTable(executor);
  }

  const cols = await executor.query<{ name: string }>(`PRAGMA table_info(app_settings)`);
  if (cols.length > 0) {
    if (!cols.some((c) => c.name === "default_vat_rate")) {
      await executor.run(
        `ALTER TABLE app_settings ADD COLUMN default_vat_rate REAL NOT NULL DEFAULT 21 CHECK (default_vat_rate >= 0 AND default_vat_rate <= 100);`
      );
    }
    if (!cols.some((c) => c.name === "irpf_reserve_rate")) {
      await executor.run(
        `ALTER TABLE app_settings ADD COLUMN irpf_reserve_rate REAL NOT NULL DEFAULT 20 CHECK (irpf_reserve_rate >= 0 AND irpf_reserve_rate <= 100);`
      );
    }
    if (!cols.some((c) => c.name === "hourly_rate_cents")) {
      await executor.run(
        `ALTER TABLE app_settings ADD COLUMN hourly_rate_cents INTEGER NOT NULL DEFAULT 3800 CHECK (hourly_rate_cents > 0);`
      );
    }
    if (!cols.some((c) => c.name === "emitter_iban")) {
      await executor.run(
        `ALTER TABLE app_settings ADD COLUMN emitter_iban TEXT NOT NULL DEFAULT '';`
      );
    }
    if (!cols.some((c) => c.name === "emitter_logo_data_url")) {
      await executor.run(
        `ALTER TABLE app_settings ADD COLUMN emitter_logo_data_url TEXT;`
      );
    }
    if (!cols.some((c) => c.name === "active_account_id")) {
      await executor.run(
        `ALTER TABLE app_settings ADD COLUMN active_account_id TEXT REFERENCES local_accounts(id) ON DELETE SET NULL;`
      );
    }
    if (!cols.some((c) => c.name === "expand_long_text_inputs")) {
      await executor.run(
        `ALTER TABLE app_settings ADD COLUMN expand_long_text_inputs INTEGER NOT NULL DEFAULT 1 CHECK (expand_long_text_inputs IN (0, 1));`
      );
    }
    if (!cols.some((c) => c.name === "default_quote_validity_days")) {
      await executor.run(
        `ALTER TABLE app_settings ADD COLUMN default_quote_validity_days INTEGER NOT NULL DEFAULT 30 CHECK (default_quote_validity_days BETWEEN 1 AND 365);`
      );
    }
    if (!cols.some((c) => c.name === "default_payment_methods_json")) {
      await executor.run(
        `ALTER TABLE app_settings ADD COLUMN default_payment_methods_json TEXT NOT NULL DEFAULT '["transferencia"]';`
      );
    }
    if (!cols.some((c) => c.name === "default_payment_schedule_json")) {
      await executor.run(
        `ALTER TABLE app_settings ADD COLUMN default_payment_schedule_json TEXT NOT NULL DEFAULT '[]';`
      );
    }
    if (!cols.some((c) => c.name === "active_tax_models_json")) {
      await executor.run(
        `ALTER TABLE app_settings ADD COLUMN active_tax_models_json TEXT NOT NULL DEFAULT '["303","130","390","347","100"]';`
      );
    }
    if (!cols.some((c) => c.name === "emitter_email")) {
      await executor.run(
        `ALTER TABLE app_settings ADD COLUMN emitter_email TEXT NOT NULL DEFAULT '';`
      );
    }
    if (!cols.some((c) => c.name === "emitter_registry_number")) {
      await executor.run(
        `ALTER TABLE app_settings ADD COLUMN emitter_registry_number TEXT NOT NULL DEFAULT '';`
      );
    }
    if (!cols.some((c) => c.name === "emitter_tech_name")) {
      await executor.run(
        `ALTER TABLE app_settings ADD COLUMN emitter_tech_name TEXT NOT NULL DEFAULT '';`
      );
    }
    if (!cols.some((c) => c.name === "emitter_tech_dni")) {
      await executor.run(
        `ALTER TABLE app_settings ADD COLUMN emitter_tech_dni TEXT NOT NULL DEFAULT '';`
      );
    }
    if (!cols.some((c) => c.name === "emitter_installer_card")) {
      await executor.run(
        `ALTER TABLE app_settings ADD COLUMN emitter_installer_card TEXT NOT NULL DEFAULT '';`
      );
    }
    if (!cols.some((c) => c.name === "emitter_signature_data_url")) {
      await executor.run(
        `ALTER TABLE app_settings ADD COLUMN emitter_signature_data_url TEXT;`
      );
    }
    if (!cols.some((c) => c.name === "default_acta_warranty_months")) {
      await executor.run(
        `ALTER TABLE app_settings ADD COLUMN default_acta_warranty_months INTEGER NOT NULL DEFAULT 24 CHECK (default_acta_warranty_months BETWEEN 1 AND 120);`
      );
    }
  }

  const catalogCols = await executor.query<{ name: string }>(`PRAGMA table_info(catalog_items)`);
  if (catalogCols.length > 0) {
    if (!catalogCols.some((c) => c.name === "pricing_mode")) {
      await executor.run(
        `ALTER TABLE catalog_items ADD COLUMN pricing_mode TEXT NOT NULL DEFAULT 'fixed' CHECK (pricing_mode IN ('fixed', 'hourly_plus_materials'));`
      );
    }
    if (!catalogCols.some((c) => c.name === "estimated_hours_thousandths")) {
      await executor.run(
        `ALTER TABLE catalog_items ADD COLUMN estimated_hours_thousandths INTEGER NOT NULL DEFAULT 0 CHECK (estimated_hours_thousandths >= 0);`
      );
    }
    if (!catalogCols.some((c) => c.name === "materials_cents")) {
      await executor.run(
        `ALTER TABLE catalog_items ADD COLUMN materials_cents INTEGER NOT NULL DEFAULT 0 CHECK (materials_cents >= 0);`
      );
    }
  }

  const jobCols = await executor.query<{ name: string }>(`PRAGMA table_info(jobs)`);
  if (jobCols.length > 0) {
    if (!jobCols.some((c) => c.name === "start_date_iso")) {
      await executor.run(`ALTER TABLE jobs ADD COLUMN start_date_iso TEXT;`);
    }
    if (!jobCols.some((c) => c.name === "end_date_iso")) {
      await executor.run(`ALTER TABLE jobs ADD COLUMN end_date_iso TEXT;`);
    }
  }

  const quoteCols = await executor.query<{ name: string; notnull: number }>(
    `PRAGMA table_info(quotes)`
  );
  if (quoteCols.length > 0) {
    const clientCol = quoteCols.find((c) => c.name === "client_id");
    if (clientCol && Number(clientCol.notnull) === 1) {
      await rebuildLegacyQuotesTable(executor, quoteCols);
    } else {
      if (!quoteCols.some((c) => c.name === "validity_days")) {
        await executor.run(
          `ALTER TABLE quotes ADD COLUMN validity_days INTEGER CHECK (validity_days IS NULL OR (validity_days BETWEEN 1 AND 365));`
        );
      }
      if (!quoteCols.some((c) => c.name === "payment_methods_json")) {
        await executor.run(
          `ALTER TABLE quotes ADD COLUMN payment_methods_json TEXT NOT NULL DEFAULT '[]';`
        );
      }
      if (!quoteCols.some((c) => c.name === "payment_schedule_json")) {
        await executor.run(
          `ALTER TABLE quotes ADD COLUMN payment_schedule_json TEXT NOT NULL DEFAULT '[]';`
        );
      }
    }
  }
}

export function normalizeSqlParams(params: unknown[] | undefined): unknown[] {
  if (!params) return [];
  return params.map((p) => (p === undefined ? null : p));
}
