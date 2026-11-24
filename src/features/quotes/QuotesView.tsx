import { ChevronRight, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { LocalFileBridge, QuoteStatus, SqliteExecutor } from "../../core/contracts/types";
import { QuotesRepository, type QuoteWithJobSummary } from "../../core/db/repositories/quotesRepo";
import { getLocalTodayIso } from "../../core/fiscal/dateQuarter";
import { computeQuoteValidUntilIso, formatCentsEs } from "../../core/fiscal/fiscalEngine";
import { ConfirmDeleteDialog } from "../../ui/ConfirmDeleteDialog";

interface QuotesViewProps {
  executor: SqliteExecutor;
  fileBridge: LocalFileBridge;
  refreshTick: number;
  onStartEmptyQuote: () => Promise<void>;
  onOpenQuoteDetail: (quoteId: string) => void;
  onDataChanged: () => Promise<void>;
  registerBackHandler?: (priority: number, handler: () => boolean) => () => void;
}

const QUOTE_STATUSES: Array<{ value: "" | QuoteStatus; label: string }> = [
  { value: "", label: "Todos" },
  { value: "borrador", label: "Borradores" },
  { value: "enviado", label: "Enviados" },
  { value: "aceptado", label: "Aceptados" },
  { value: "rechazado", label: "Rechazados" },
];

const STATUS_BADGES: Record<QuoteStatus, { label: string; cls: string }> = {
  borrador: {
    label: "Borrador",
    cls: "bg-terracotta-soft text-on-primary-container border-outline-variant",
  },
  enviado: {
    label: "Enviado",
    cls: "bg-info-container text-on-info-container border-info/20",
  },
  aceptado: {
    label: "Aceptado",
    cls: "bg-success-container text-on-success-container border-emerald-free/20",
  },
  rechazado: {
    label: "Rechazado",
    cls: "bg-error-container text-on-error-container border-coral-alert/20",
  },
};

export function QuotesView({
  executor,
  fileBridge,
  refreshTick,
  onStartEmptyQuote,
  onOpenQuoteDetail,
  onDataChanged,
  registerBackHandler,
}: QuotesViewProps) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | QuoteStatus>("");
  const [quotes, setQuotes] = useState<QuoteWithJobSummary[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<QuoteWithJobSummary | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [localRefresh, setLocalRefresh] = useState(0);

  useEffect(() => {
    let active = true;
    new QuotesRepository(executor)
      .listPaginated({
        search: search.trim() || undefined,
        status: statusFilter || undefined,
        limit: 50,
        offset: 0,
      })
      .then((res) => {
        if (!active) return;
        setQuotes(res.items);
        setTotalCount(res.totalCount);
      })
      .catch(() => {
        // ignore read error
      });
    return () => {
      active = false;
    };
  }, [executor, search, statusFilter, refreshTick, localRefresh]);

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteError(null);
    setDeleteBusy(true);
    try {
      await new QuotesRepository(executor).delete(deleteTarget.id, fileBridge);
      setDeleteTarget(null);
      setLocalRefresh((n) => n + 1);
      await onDataChanged();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div
      data-testid="quotes-view"
      className="flex flex-1 flex-col overflow-y-auto overflow-x-hidden no-scrollbar p-4 space-y-3.5 bg-surface"
    >
      <div className="flex w-full min-w-0 items-center gap-2">
        <input
          type="search"
          data-testid="quotes-search-input"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por PRE, cliente u obra..."
          className="min-h-[48px] min-w-0 flex-1 rounded-2xl border border-outline-variant bg-surface-container-lowest px-3.5 text-[14px] text-on-surface placeholder:text-outline focus:border-terracotta focus:outline-none"
        />
        <button
          type="button"
          data-testid="quotes-new-btn"
          onClick={() => void onStartEmptyQuote()}
          className="min-h-[48px] shrink-0 whitespace-nowrap rounded-2xl bg-primary hover:bg-terracotta px-3.5 text-[13px] font-semibold text-white shadow-xs cursor-pointer"
        >
          + Nuevo
        </button>
      </div>

      <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
        {QUOTE_STATUSES.map((st) => (
          <button
            key={st.value || "all"}
            type="button"
            onClick={() => setStatusFilter(st.value)}
            className={`min-h-[40px] shrink-0 rounded-full px-3.5 text-[12px] font-semibold cursor-pointer transition-colors ${
              statusFilter === st.value
                ? "bg-secondary text-on-secondary"
                : "bg-surface-container-lowest border border-outline-variant text-on-surface-variant"
            }`}
          >
            {st.label}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {quotes.map((q) => {
          const badge = STATUS_BADGES[q.status];
          const validUntilIso = computeQuoteValidUntilIso(q.created_at_ms, q.validity_days);
          const isExpired =
            (q.status === "borrador" || q.status === "enviado") &&
            Boolean(validUntilIso && validUntilIso < getLocalTodayIso());
          return (
            <div
              key={q.id}
              className="w-full max-w-full overflow-hidden rounded-[20px] border border-outline-variant bg-surface-warm-card shadow-[0_2px_10px_rgba(15,23,42,0.04)] hover:border-terracotta transition-colors text-xs"
            >
              <button
                type="button"
                data-testid={`quote-card-${q.id}`}
                onClick={() => onOpenQuoteDetail(q.id)}
                className="w-full p-4 pb-2.5 text-left cursor-pointer space-y-2"
              >
                <div className="flex w-full min-w-0 items-start justify-between gap-2">
                  <div className="min-w-0 flex-1 flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-[12px] font-semibold text-on-primary-container tabular-nums">
                      {q.quote_code}
                    </span>
                    <span
                      className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase ${badge.cls}`}
                    >
                      {badge.label}
                    </span>
                    {!q.client_id && (
                      <span className="rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
                        Sin cliente
                      </span>
                    )}
                    {isExpired && (
                      <span
                        data-testid={`quote-expired-badge-${q.id}`}
                        className="rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-900"
                      >
                        Caducado
                      </span>
                    )}
                  </div>

                  <div className="shrink-0 text-right">
                    <div className="font-mono text-[15px] font-bold text-on-surface tabular-nums">
                      {formatCentsEs(q.total_cents)}
                    </div>
                    <div className="text-[11px] text-on-surface-variant">IVA {q.vat_rate} %</div>
                  </div>
                </div>

                <div className="line-clamp-2 break-words [overflow-wrap:anywhere] text-[15px] font-semibold leading-snug text-on-surface">
                  {q.job_code} · {q.job_title}
                </div>
              </button>

              <div className="flex w-full min-w-0 items-center justify-between gap-2 px-4 py-2 border-t border-outline-variant/60">
                <button
                  type="button"
                  onClick={() => onOpenQuoteDetail(q.id)}
                  className="flex min-w-0 flex-1 items-center justify-between gap-2 py-1 text-left cursor-pointer"
                >
                  <span className="min-w-0 flex-1 truncate text-[12px] text-on-surface-variant">
                    {q.client_name_snapshot || "Sin datos de cliente"}
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-outline" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  data-testid={`quote-card-delete-${q.id}`}
                  aria-label={`Eliminar presupuesto ${q.quote_code}`}
                  onClick={() => {
                    setDeleteError(null);
                    setDeleteTarget(q);
                  }}
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-coral-alert/25 bg-surface-container-lowest text-coral-alert hover:bg-error-container cursor-pointer"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>
          );
        })}

        {quotes.length === 0 && (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-xs text-slate-500">
            No hay presupuestos ({totalCount}) que coincidan con el filtro.
          </div>
        )}
      </div>

      <ConfirmDeleteDialog
        open={deleteTarget !== null}
        title={deleteTarget ? `¿Eliminar presupuesto ${deleteTarget.quote_code}?` : "¿Eliminar presupuesto?"}
        description={
          deleteTarget
            ? `Se eliminará el presupuesto de ${deleteTarget.client_name_snapshot} (${formatCentsEs(deleteTarget.total_cents)}), todas sus partidas y su PDF generado. Esta acción no se puede deshacer.`
            : ""
        }
        errorMsg={deleteError}
        busy={deleteBusy}
        confirmTestId="quotes-confirm-delete-btn"
        registerBackHandler={registerBackHandler}
        onCancel={() => {
          if (!deleteBusy) {
            setDeleteTarget(null);
            setDeleteError(null);
          }
        }}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
}
