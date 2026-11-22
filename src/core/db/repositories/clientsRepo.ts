import { validateSpanishTaxId } from "../../fiscal/taxIdValidator";
import type { ClientRow, InvoiceRow, JobRow, QuoteRow, SqliteExecutor } from "../../contracts/types";
import { sanitizeFts5Query } from "../sqliteExecutor";
import { InvoicesRepository } from "./invoicesRepo";

export interface ClientWithStats extends ClientRow {
  jobs_count: number;
  quotes_count: number;
}

export interface ClientPortfolio {
  client: ClientRow;
  jobs: JobRow[];
  quotes: QuoteRow[];
  invoices: InvoiceRow[];
}

export interface ClientInput {
  name: string;
  nif?: string;
  fiscal_address?: string;
  phone?: string;
  email?: string;
  notes?: string;
}

export class ClientsRepository {
  constructor(private readonly executor: SqliteExecutor) {}

  async listPaginated(opts?: {
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ items: ClientRow[]; totalCount: number }> {
    const limit = Math.max(1, Math.min(100, opts?.limit ?? 25));
    const offset = Math.max(0, opts?.offset ?? 0);
    const fts = opts?.search ? sanitizeFts5Query(opts.search) : "";

    if (fts.length > 0) {
      const countRows = await this.executor.query<{ cnt: number }>(
        `SELECT COUNT(*) AS cnt
         FROM clients c
         JOIN clients_fts f ON c.rowid = f.rowid
         WHERE clients_fts MATCH ?`,
        [fts]
      );
      const items = await this.executor.query<ClientRow>(
        `SELECT c.*, bm25(clients_fts) AS rank_score
         FROM clients c
         JOIN clients_fts f ON c.rowid = f.rowid
         WHERE clients_fts MATCH ?
         ORDER BY rank_score ASC, c.updated_at_ms DESC
         LIMIT ? OFFSET ?`,
        [fts, limit, offset]
      );
      return { items, totalCount: countRows[0]?.cnt ?? 0 };
    }

    const countRows = await this.executor.query<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM clients`
    );
    const items = await this.executor.query<ClientRow>(
      `SELECT * FROM clients ORDER BY updated_at_ms DESC LIMIT ? OFFSET ?`,
      [limit, offset]
    );
    return { items, totalCount: countRows[0]?.cnt ?? 0 };
  }

  async listPaginatedWithStats(opts?: {
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ items: ClientWithStats[]; totalCount: number }> {
    const limit = Math.max(1, Math.min(100, opts?.limit ?? 25));
    const offset = Math.max(0, opts?.offset ?? 0);
    const fts = opts?.search ? sanitizeFts5Query(opts.search) : "";

    if (fts.length > 0) {
      const countRows = await this.executor.query<{ cnt: number }>(
        `SELECT COUNT(*) AS cnt
         FROM clients c
         JOIN clients_fts f ON c.rowid = f.rowid
         WHERE clients_fts MATCH ?`,
        [fts]
      );
      const rawItems = await this.executor.query<ClientWithStats & Record<string, unknown>>(
        `SELECT c.*,
                (SELECT COUNT(*) FROM jobs j WHERE j.client_id = c.id) AS jobs_count,
                (SELECT COUNT(*) FROM quotes q WHERE q.client_id = c.id) AS quotes_count,
                bm25(clients_fts) AS rank_score
         FROM clients c
         JOIN clients_fts f ON c.rowid = f.rowid
         WHERE clients_fts MATCH ?
         ORDER BY rank_score ASC, c.updated_at_ms DESC
         LIMIT ? OFFSET ?`,
        [fts, limit, offset]
      );
      return {
        items: rawItems.map((r) => ({
          ...r,
          jobs_count: Number(r.jobs_count ?? 0),
          quotes_count: Number(r.quotes_count ?? 0),
        })),
        totalCount: Number(countRows[0]?.cnt ?? 0),
      };
    }

    const countRows = await this.executor.query<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM clients`
    );
    const rawItems = await this.executor.query<ClientWithStats & Record<string, unknown>>(
      `SELECT c.*,
              (SELECT COUNT(*) FROM jobs j WHERE j.client_id = c.id) AS jobs_count,
              (SELECT COUNT(*) FROM quotes q WHERE q.client_id = c.id) AS quotes_count
       FROM clients c
       ORDER BY c.updated_at_ms DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );
    return {
      items: rawItems.map((r) => ({
        ...r,
        jobs_count: Number(r.jobs_count ?? 0),
        quotes_count: Number(r.quotes_count ?? 0),
      })),
      totalCount: Number(countRows[0]?.cnt ?? 0),
    };
  }

  async getClientPortfolio(clientId: string): Promise<ClientPortfolio | null> {
    const client = await this.getById(clientId);
    if (!client) return null;
    await new InvoicesRepository(this.executor).syncOverdueOnRead();
    const [jobs, quotes, invoices] = await Promise.all([
      this.executor.query<JobRow>(
        `SELECT * FROM jobs WHERE client_id = ? ORDER BY updated_at_ms DESC, created_at_ms DESC`,
        [clientId]
      ),
      this.executor.query<QuoteRow>(
        `SELECT * FROM quotes WHERE client_id = ? ORDER BY created_at_ms DESC`,
        [clientId]
      ),
      this.executor.query<InvoiceRow>(
        `SELECT * FROM invoices WHERE client_id = ? ORDER BY issued_at_iso DESC, created_at_ms DESC`,
        [clientId]
      ),
    ]);
    return { client, jobs, quotes, invoices };
  }

  async searchFts5WithScore(
    search: string,
    limit = 5
  ): Promise<Array<ClientRow & { bm25_score: number }>> {
    const fts = sanitizeFts5Query(search);
    if (!fts) return [];
    return this.executor.query<ClientRow & { bm25_score: number }>(
      `SELECT c.*, bm25(clients_fts) AS bm25_score
       FROM clients c
       JOIN clients_fts f ON c.rowid = f.rowid
       WHERE clients_fts MATCH ?
       ORDER BY bm25_score ASC
       LIMIT ?`,
      [fts, limit]
    );
  }

  async getById(id: string): Promise<ClientRow | null> {
    const rows = await this.executor.query<ClientRow>(
      `SELECT * FROM clients WHERE id = ? LIMIT 1`,
      [id]
    );
    return rows[0] ?? null;
  }

  async create(input: ClientInput, idOverride?: string): Promise<ClientRow> {
    const name = input.name.trim();
    if (!name) {
      throw new Error("SCHEMA_VALIDATION_ERROR: El nombre del cliente es obligatorio");
    }
    const nif = (input.nif ?? "").trim().toUpperCase();
    if (nif && !validateSpanishTaxId(nif)) {
      throw new Error("SCHEMA_VALIDATION_ERROR: NIF/NIE/CIF del cliente inválido");
    }
    const now = Date.now();
    const id = idOverride ?? `cli_${crypto.randomUUID().slice(0, 12)}`;
    await this.executor.run(
      `INSERT INTO clients (
        id, name, nif, fiscal_address, phone, email, notes, created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        name,
        nif,
        (input.fiscal_address ?? "").trim(),
        (input.phone ?? "").trim(),
        (input.email ?? "").trim(),
        (input.notes ?? "").trim(),
        now,
        now,
      ]
    );
    const created = await this.getById(id);
    if (!created) throw new Error("SQLITE_QUERY_ERROR: error creando cliente");
    return created;
  }

  async update(id: string, input: Partial<ClientInput>): Promise<ClientRow> {
    const existing = await this.getById(id);
    if (!existing) {
      throw new Error("INVALID_STATE_TRANSITION: Cliente no encontrado");
    }
    const name = input.name !== undefined ? input.name.trim() : existing.name;
    if (!name) {
      throw new Error("SCHEMA_VALIDATION_ERROR: El nombre del cliente es obligatorio");
    }
    const nif = input.nif !== undefined ? input.nif.trim().toUpperCase() : existing.nif;
    if (nif && !validateSpanishTaxId(nif)) {
      throw new Error("SCHEMA_VALIDATION_ERROR: NIF/NIE/CIF del cliente inválido");
    }
    const now = Date.now();
    await this.executor.run(
      `UPDATE clients
       SET name = ?, nif = ?, fiscal_address = ?, phone = ?, email = ?, notes = ?, updated_at_ms = ?
       WHERE id = ?`,
      [
        name,
        nif,
        input.fiscal_address !== undefined ? input.fiscal_address.trim() : existing.fiscal_address,
        input.phone !== undefined ? input.phone.trim() : existing.phone,
        input.email !== undefined ? input.email.trim() : existing.email,
        input.notes !== undefined ? input.notes.trim() : existing.notes,
        now,
        id,
      ]
    );
    const updated = await this.getById(id);
    if (!updated) throw new Error("SQLITE_QUERY_ERROR: error actualizando cliente");
    return updated;
  }

  async delete(id: string): Promise<void> {
    const jobs = await this.executor.query<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM jobs WHERE client_id = ?`,
      [id]
    );
    const quotes = await this.executor.query<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM quotes WHERE client_id = ?`,
      [id]
    );
    const invoices = await this.executor.query<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM invoices WHERE client_id = ?`,
      [id]
    );
    if ((jobs[0]?.cnt ?? 0) > 0 || (quotes[0]?.cnt ?? 0) > 0 || (invoices[0]?.cnt ?? 0) > 0) {
      throw new Error(
        "INVALID_STATE_TRANSITION: No se puede borrar un cliente con obras, presupuestos o facturas vinculadas"
      );
    }
    await this.executor.run(`DELETE FROM clients WHERE id = ?`, [id]);
  }
}
