import { useEffect, useState } from "react";
import type { SqliteExecutor } from "../../core/contracts/types";
import { ClientsRepository, type ClientWithStats } from "../../core/db/repositories/clientsRepo";

interface ClientsViewProps {
  executor: SqliteExecutor;
  refreshTick: number;
  onSelectClient: (clientId: string) => void;
  onOpenNewClientWidget: () => void;
}

const INDEX_CARD_THEMES = [
  {
    avatar: "bg-[#FFD6B0] text-[#4A2500]",
    tab: "postit-peach text-[#4A2500]",
  },
  {
    avatar: "bg-[#CBE4F9] text-[#143552]",
    tab: "postit-blue text-[#143552]",
  },
  {
    avatar: "bg-[#D4EDDA] text-[#1B3A24]",
    tab: "postit-green text-[#1B3A24]",
  },
  {
    avatar: "bg-[#FAD2D8] text-[#5A121C]",
    tab: "postit-rose text-[#5A121C]",
  },
  {
    avatar: "bg-[#E5D4F3] text-[#4C1D95]",
    tab: "postit-lavender text-[#4C1D95]",
  },
] as const;

function getClientInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "CL";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
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
      className="flex flex-1 flex-col w-full max-w-full overflow-y-auto overflow-x-hidden no-scrollbar px-4 py-4 space-y-3.5 cotton-paper text-[#2C2621]"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 w-full min-w-0">
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-sans text-[18px] font-bold text-[#2C2621]">
            Clientes
          </h2>
          <p className="text-[12px] text-[#6B6860] tabular-nums">
            {totalCount} {totalCount === 1 ? "ficha guardada en local" : "fichas guardadas en local"}
          </p>
        </div>
        <button
          type="button"
          data-testid="clients-new-btn"
          onClick={onOpenNewClientWidget}
          className="min-h-[48px] w-full sm:w-auto shrink-0 rounded-2xl bg-[#4B7094] hover:bg-[#3F5F7E] px-4 text-[13px] font-semibold text-[#FFFDF9] shadow-xs cursor-pointer transition-colors"
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
          className="min-h-[48px] w-full min-w-0 rounded-2xl border border-[#E5DFD2] bg-[#FFFDF7] px-3.5 text-[14px] text-[#2C2621] placeholder:text-[#6B6860] focus:border-[#EA580C] focus:outline-none shadow-xs"
        />
      </div>

      <div className="space-y-3">
        {clients.map((cl, idx) => {
          const theme = INDEX_CARD_THEMES[idx % INDEX_CARD_THEMES.length]!;
          const initials = getClientInitials(cl.name);
          const tabLetter = (cl.name.trim()[0] ?? "C").toUpperCase();
          return (
            <button
              key={cl.id}
              type="button"
              data-testid={`client-card-${cl.id}`}
              onClick={() => onSelectClient(cl.id)}
              className="relative flex w-full max-w-full items-stretch text-left hover:translate-x-0.5 transition-transform cursor-pointer"
            >
              <div className="flex-1 min-w-0 ruled-index border border-[#E5DFD2] rounded-l-2xl p-4 space-y-2.5">
                <div className="flex min-w-0 items-center gap-3">
                  <div
                    className={`w-11 h-11 rounded-full border border-[#FFFDF7] font-sans text-[14px] font-bold flex items-center justify-center shrink-0 ${theme.avatar}`}
                  >
                    {initials}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold text-[15px] text-[#2C2621]">
                      {cl.name}
                    </div>
                    <div className="mt-0.5 font-mono text-[12px] text-[#6B6860] tabular-nums break-words [overflow-wrap:anywhere]">
                      {cl.nif ? `NIF ${cl.nif}` : "Sin NIF"} · {cl.phone || "Sin teléfono"}
                    </div>
                  </div>
                </div>

                {cl.fiscal_address && (
                  <div className="text-[12px] text-[#6B6860] break-words [overflow-wrap:anywhere]">
                    {cl.fiscal_address}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                  <span className="status-cobalt rounded-full px-2.5 py-0.5 text-[11px] font-semibold tabular-nums">
                    {cl.jobs_count} obra(s)
                  </span>
                  <span className="status-mustard rounded-full px-2.5 py-0.5 text-[11px] font-semibold tabular-nums">
                    {cl.quotes_count} pres.
                  </span>
                </div>
              </div>

              <div
                className={`w-7 border-y border-r border-[#E5DFD2] rounded-r-2xl flex items-center justify-center shrink-0 ${theme.tab}`}
                aria-hidden="true"
              >
                <span className="font-mono text-[12px] font-bold">{tabLetter}</span>
              </div>
            </button>
          );
        })}

        {clients.length === 0 && (
          <div className="paper-sheet rounded-2xl border border-dashed border-[#E5DFD2] bg-[#FFFDF7] p-6 text-center text-xs text-[#6B6860]">
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
            className="min-h-10 rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 font-semibold text-[#2C2621] disabled:opacity-40 cursor-pointer"
          >
            Anterior
          </button>
          <span className="font-mono text-[#6B6860] tabular-nums">
            {pageOffset + 1}–{Math.min(pageOffset + pageLimit, totalCount)} de {totalCount}
          </span>
          <button
            type="button"
            disabled={pageOffset + pageLimit >= totalCount}
            onClick={() => setPageOffset((p) => p + pageLimit)}
            className="min-h-10 rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 font-semibold text-[#2C2621] disabled:opacity-40 cursor-pointer"
          >
            Siguiente
          </button>
        </div>
      )}
    </div>
  );
}
