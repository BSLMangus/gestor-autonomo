import { useEffect, useState } from "react";
import type { SqliteExecutor } from "../../core/contracts/types";
import { ClientsRepository, type ClientWithStats } from "../../core/db/repositories/clientsRepo";

interface ClientsViewProps {
  executor: SqliteExecutor;
  refreshTick: number;
  onSelectClient: (clientId: string) => void;
  onOpenNewClientWidget: () => void;
}

export function ClientsView({
  executor,
  refreshTick,
  onSelectClient,
  onOpenNewClientWidget,
}: ClientsViewProps) {
  const [search, setSearch] = useState("");
  const [pageOffset, setPageOffset] = useState(0);
  const pageLimit = 15;

  const [clients, setClients] = useState<ClientWithStats[]>([]);
  const [totalCount, setTotalCount] = useState(0);

  useEffect(() => {
    let active = true;
    new ClientsRepository(executor)
      .listPaginatedWithStats({
        search: search.trim() || undefined,
        limit: pageLimit,
        offset: pageOffset,
      })
      .then((res) => {
        if (!active) return;
        setClients(res.items);
        setTotalCount(res.totalCount);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [executor, search, pageOffset, refreshTick]);

  return (
    <div
      data-testid="clients-view"
      className="flex flex-1 flex-col w-full max-w-full overflow-y-auto overflow-x-hidden no-scrollbar px-4 py-4 space-y-3.5 bg-surface"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 w-full min-w-0">
        <h2 className="min-w-0 flex-1 truncate text-[18px] font-bold text-on-surface">
          Clientes
        </h2>
        <button
          type="button"
          data-testid="clients-new-btn"
          onClick={onOpenNewClientWidget}
          className="min-h-[48px] w-full sm:w-auto shrink-0 rounded-2xl bg-primary hover:bg-terracotta px-4 text-[13px] font-semibold text-white shadow-xs cursor-pointer"
        >
          + Nuevo cliente
        </button>
      </div>

      <div className="w-full min-w-0">
        <input
          type="search"
          data-testid="clients-search-input"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPageOffset(0);
          }}
          placeholder="Buscar por nombre, NIF, teléfono..."
          className="min-h-[48px] w-full min-w-0 rounded-2xl border border-outline-variant bg-surface-container-lowest px-3.5 text-[14px] text-on-surface placeholder:text-outline focus:border-terracotta focus:outline-none"
        />
      </div>

      <div className="space-y-3">
        {clients.map((cl) => (
          <button
            key={cl.id}
            type="button"
            data-testid={`client-card-${cl.id}`}
            onClick={() => onSelectClient(cl.id)}
            className="w-full max-w-full overflow-hidden rounded-[20px] border border-outline-variant bg-surface-warm-card p-4 text-left shadow-[0_2px_10px_rgba(15,23,42,0.04)] hover:border-terracotta transition-colors cursor-pointer"
          >
            <div className="flex min-w-0 items-center justify-between gap-2">
              <span className="min-w-0 flex-1 truncate font-semibold text-[15px] text-on-surface">
                {cl.name}
              </span>
              <span className="shrink-0 rounded-full bg-terracotta-soft px-2.5 py-0.5 text-[11px] font-semibold text-on-primary-container tabular-nums">
                {cl.jobs_count} obra(s) · {cl.quotes_count} pres.
              </span>
            </div>
            <div className="mt-1 font-mono text-[12px] text-on-surface-variant break-words [overflow-wrap:anywhere]">
              {cl.nif ? `NIF ${cl.nif}` : "Sin NIF"} · {cl.phone || "Sin teléfono"}
            </div>
            {cl.fiscal_address && (
              <div className="mt-0.5 text-[12px] text-on-surface-variant break-words [overflow-wrap:anywhere]">
                {cl.fiscal_address}
              </div>
            )}
          </button>
        ))}

        {clients.length === 0 && (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-xs text-slate-500">
            No hay clientes que coincidan con la búsqueda.
          </div>
        )}
      </div>

      {totalCount > pageLimit && (
        <div className="flex items-center justify-between pt-2 text-xs">
          <button
            type="button"
            disabled={pageOffset === 0}
            onClick={() => setPageOffset((p) => Math.max(0, p - pageLimit))}
            className="min-h-10 rounded-xl border border-slate-300 bg-white px-3 font-semibold disabled:opacity-40"
          >
            Anterior
          </button>
          <span className="text-slate-600">
            {pageOffset + 1}–{Math.min(pageOffset + pageLimit, totalCount)} de {totalCount}
          </span>
          <button
            type="button"
            disabled={pageOffset + pageLimit >= totalCount}
            onClick={() => setPageOffset((p) => p + pageLimit)}
            className="min-h-10 rounded-xl border border-slate-300 bg-white px-3 font-semibold disabled:opacity-40"
          >
            Siguiente
          </button>
        </div>
      )}
    </div>
  );
}
