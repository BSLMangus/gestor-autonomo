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

export async function initializeSchema(executor: SqliteExecutor): Promise<void> {
  await executor.run("PRAGMA foreign_keys = ON;");
  const statements = splitSqlStatements(schemaSql);
  for (const stmt of statements) {
    await executor.run(stmt);
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
}

export function normalizeSqlParams(params: unknown[] | undefined): unknown[] {
  if (!params) return [];
  return params.map((p) => (p === undefined ? null : p));
}
