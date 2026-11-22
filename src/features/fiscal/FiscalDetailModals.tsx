import { useEffect, useMemo, useState } from "react";
import type {
  ExpenseTicketRow,
  InvoiceRow,
  JobRow,
  LocalFileBridge,
  QuoteRow,
} from "../../core/contracts/types";
import { formatCentsEs } from "../../core/fiscal/fiscalEngine";

function TicketPhotoPreview({
  fileBridge,
  imageUri,
}: {
  fileBridge?: LocalFileBridge;
  imageUri: string | null;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let revoker: (() => void) | null = null;
    if (!fileBridge || !imageUri) {
      setUrl(null);
      return;
    }
    fileBridge
      .resolveDisplayUrl(imageUri)
      .then((res) => {
        if (!active) {
          res?.revoke();
          return;
        }
        revoker = res?.revoke ?? null;
        setUrl(res?.url ?? null);
      })
      .catch(() => {
        if (active) setUrl(null);
      });
    return () => {
      active = false;
      revoker?.();
    };
  }, [fileBridge, imageUri]);

  if (!url) return null;
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-2">
      <div className="mb-1 text-[11px] font-semibold text-slate-600">Imagen del ticket</div>
      <img
        src={url}
        alt="Imagen del ticket deducible"
        className="max-h-48 w-full rounded-lg object-contain bg-white"
      />
    </div>
  );
}

interface DeductibleTicketsModalProps {
  open: boolean;
  quarter: string;
  tickets: ExpenseTicketRow[];
  jobs: JobRow[];
  initialTicketId: string | null;
  fileBridge?: LocalFileBridge;
  onClose: () => void;
  onOpenTicket?: (ticketId: string) => void;
  onQuickManualTicket: () => Promise<void>;
}

export function DeductibleTicketsModal({
  open,
  quarter,
  tickets,
  jobs,
  initialTicketId,
  fileBridge,
  onClose,
  onOpenTicket,
  onQuickManualTicket,
}: DeductibleTicketsModalProps) {
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(initialTicketId);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  useEffect(() => {
    setSelectedTicketId(initialTicketId);
    setCategoryFilter("all");
  }, [initialTicketId, open]);

  if (!open) return null;

  const jobById = new Map(jobs.map((j) => [j.id, j]));
  const categories = Array.from(new Set(tickets.map((t) => t.category))).sort();
  const filteredTickets =
    categoryFilter === "all"
      ? tickets
      : tickets.filter((t) => t.category === categoryFilter);

  const selectedTicket = selectedTicketId
    ? tickets.find((t) => t.id === selectedTicketId) ?? null
    : null;

  const totalBase = filteredTickets.reduce((acc, t) => acc + t.base_cents, 0);
  const totalVat = filteredTickets.reduce((acc, t) => acc + t.vat_cents, 0);
  const totalGross = filteredTickets.reduce((acc, t) => acc + t.total_cents, 0);

  const categoryTotals = categories.map((cat) => {
    const sum = tickets
      .filter((t) => t.category === cat)
      .reduce((acc, t) => acc + t.total_cents, 0);
    return { cat, sum };
  });
  const maxCatSum = Math.max(1, ...categoryTotals.map((c) => c.sum));

  return (
    <div
      data-testid="tickets-detail-modal"
      className="fixed inset-0 z-50 flex flex-col bg-secondary/45 backdrop-blur-[1px]"
      role="dialog"
      aria-modal="true"
      aria-label={`Tickets deducibles ${quarter}`}
    >
      <div className="mx-auto mt-8 flex min-h-0 w-full max-w-md flex-1 flex-col rounded-t-[24px] border-t border-outline-variant bg-surface-container-lowest shadow-2xl">
        <div className="flex items-center justify-between border-b border-outline-variant px-4 py-3.5">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold text-on-warning-container">
              Tickets deducibles · {quarter}
            </div>
            <h3 className="truncate text-[16px] font-semibold text-on-surface">
              {selectedTicket ? selectedTicket.supplier_name : `Todos los gastos (${tickets.length})`}
            </h3>
          </div>
          <button
            type="button"
            data-testid="close-tickets-detail-btn"
            onClick={onClose}
            aria-label="Cerrar detalle de tickets"
            className="h-10 w-10 rounded-full hover:bg-surface-container text-sm font-bold text-on-surface-variant cursor-pointer"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
          {selectedTicket ? (
            <div data-testid="ticket-detail-panel" className="space-y-3">
              <button
                type="button"
                onClick={() => setSelectedTicketId(null)}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11px] font-bold text-slate-700"
              >
                ← Ver todos los tickets del trimestre
              </button>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3.5 space-y-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-base font-extrabold text-slate-900">
                      {selectedTicket.supplier_name}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {selectedTicket.supplier_nif
                        ? `NIF/CIF: ${selectedTicket.supplier_nif}`
                        : "NIF no indicado"}
                    </div>
                  </div>
                  <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-bold capitalize text-amber-900">
                    {selectedTicket.category}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 pt-1">
                  <div className="rounded-xl bg-white p-2 border border-slate-200">
                    <div className="text-[10px] text-slate-500">Base imponible</div>
                    <div className="font-bold text-slate-900">
                      {formatCentsEs(selectedTicket.base_cents)}
                    </div>
                  </div>
                  <div className="rounded-xl bg-white p-2 border border-slate-200">
                    <div className="text-[10px] text-slate-500">
                      IVA deducible ({selectedTicket.vat_rate_label === "mixed" ? "Mixto" : `${selectedTicket.vat_rate_label} %`})
                    </div>
                    <div className="font-bold text-emerald-700">
                      {formatCentsEs(selectedTicket.vat_cents)}
                    </div>
                  </div>
                  <div className="rounded-xl bg-slate-900 p-2 text-white">
                    <div className="text-[10px] text-slate-300">Total pagado</div>
                    <div className="font-extrabold">
                      {formatCentsEs(selectedTicket.total_cents)}
                    </div>
                  </div>
                </div>

                <div className="space-y-1 border-t border-slate-200 pt-2 text-slate-700">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Fecha del ticket</span>
                    <span className="font-semibold">{selectedTicket.issue_date_iso}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Trimestre fiscal</span>
                    <span className="font-semibold">{selectedTicket.quarter}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Imputado a obra</span>
                    <span className="font-semibold">
                      {selectedTicket.job_id
                        ? (() => {
                            const j = jobById.get(selectedTicket.job_id);
                            return j ? `${j.job_code} · ${j.title}` : selectedTicket.job_id;
                          })()
                        : "Gasto general de empresa"}
                    </span>
                  </div>
                </div>
              </div>

              <TicketPhotoPreview fileBridge={fileBridge} imageUri={selectedTicket.image_uri} />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-2.5">
                  <div className="text-[10px] text-slate-500">Base deducible</div>
                  <div className="mt-0.5 text-sm font-extrabold text-slate-900">
                    {formatCentsEs(totalBase)}
                  </div>
                </div>
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-2.5">
                  <div className="text-[10px] text-emerald-900">IVA a deducir</div>
                  <div className="mt-0.5 text-sm font-extrabold text-emerald-950">
                    {formatCentsEs(totalVat)}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-900 p-2.5 text-white">
                  <div className="text-[10px] text-slate-300">Total tickets</div>
                  <div className="mt-0.5 text-sm font-extrabold">{formatCentsEs(totalGross)}</div>
                </div>
              </div>

              {categoryTotals.length > 0 && (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 space-y-2">
                  <div className="font-bold text-slate-800">Gasto por categoría</div>
                  <div className="space-y-1.5">
                    {categoryTotals.map((c) => {
                      const pct = Math.round((c.sum / maxCatSum) * 100);
                      return (
                        <div key={c.cat} className="space-y-0.5">
                          <div className="flex justify-between text-[11px]">
                            <span className="capitalize font-medium text-slate-700">{c.cat}</span>
                            <span className="font-bold text-slate-900">{formatCentsEs(c.sum)}</span>
                          </div>
                          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
                            <div
                              className="h-full rounded-full bg-amber-500"
                              style={{ width: `${Math.max(4, pct)}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between gap-2">
                <div className="flex flex-wrap gap-1">
                  <button
                    type="button"
                    onClick={() => setCategoryFilter("all")}
                    className={`rounded-lg px-2.5 py-1 text-[11px] font-bold ${
                      categoryFilter === "all"
                        ? "bg-slate-900 text-white"
                        : "bg-slate-100 text-slate-700"
                    }`}
                  >
                    Todos
                  </button>
                  {categories.map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setCategoryFilter(cat)}
                      className={`rounded-lg px-2.5 py-1 text-[11px] font-bold capitalize ${
                        categoryFilter === cat
                          ? "bg-orange-600 text-white"
                          : "bg-slate-100 text-slate-700"
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    void onQuickManualTicket();
                  }}
                  className="shrink-0 rounded-lg bg-slate-900 px-2.5 py-1 text-[11px] font-bold text-white"
                >
                  + Añadir
                </button>
              </div>

              <div className="space-y-2">
                {filteredTickets.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-300 p-4 text-center text-slate-500">
                    No hay tickets en esta categoría para {quarter}.
                  </div>
                ) : (
                  filteredTickets.map((t) => {
                    const job = t.job_id ? jobById.get(t.job_id) : null;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => {
                          if (onOpenTicket) {
                            onClose();
                            onOpenTicket(t.id);
                          } else {
                            setSelectedTicketId(t.id);
                          }
                        }}
                        className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white p-2.5 text-left hover:bg-slate-50 cursor-pointer"
                      >
                        <div className="min-w-0 pr-2">
                          <div className="truncate font-bold text-slate-900">{t.supplier_name}</div>
                          <div className="text-[11px] text-slate-500">
                            {t.issue_date_iso} · <span className="capitalize">{t.category}</span>
                            {job ? ` · ${job.job_code}` : " · General"}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="font-extrabold text-slate-900">
                            {formatCentsEs(t.total_cents)}
                          </div>
                          <div className="text-[10px] font-semibold text-orange-700">Ver →</div>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

interface ProfitabilityAnalysisModalProps {
  open: boolean;
  quarter: string;
  initialJobId: string | null;
  jobs: JobRow[];
  quotes: QuoteRow[];
  invoices: InvoiceRow[];
  tickets: ExpenseTicketRow[];
  onClose: () => void;
  onOpenInvoice?: (invoiceId: string) => void;
  onOpenTicket?: (ticketId: string) => void;
}

export function ProfitabilityAnalysisModal({
  open,
  quarter,
  initialJobId,
  jobs,
  quotes,
  invoices,
  tickets,
  onClose,
  onOpenInvoice,
  onOpenTicket,
}: ProfitabilityAnalysisModalProps) {
  const [selectedScope, setSelectedScope] = useState<string>(initialJobId ?? "all");

  useEffect(() => {
    setSelectedScope(initialJobId ?? "all");
  }, [initialJobId, open]);

  const activeJobs = useMemo(
    () => jobs.filter((j) => j.status !== "cancelado"),
    [jobs]
  );

  const jobBreakdowns = useMemo(() => {
    return activeJobs.map((job) => {
      const jobQuotes = quotes.filter((q) => q.job_id === job.id && q.status !== "rechazado");
      const jobInvoices = invoices.filter((inv) => inv.job_id === job.id);
      const jobTickets = tickets.filter((t) => t.job_id === job.id);

      const quotedBaseCents = jobQuotes.reduce((s, q) => s + q.subtotal_cents, 0);
      const invoicedBaseCents = jobInvoices.reduce((s, inv) => s + inv.base_cents, 0);
      const invoicedGrossCents = jobInvoices.reduce((s, inv) => s + inv.total_cents, 0);
      const collectedGrossCents = jobInvoices
        .filter((inv) => inv.status === "pagado")
        .reduce((s, inv) => s + inv.total_cents, 0);
      const pendingGrossCents = jobInvoices
        .filter((inv) => inv.status === "pendiente_cobro" || inv.status === "vencido")
        .reduce((s, inv) => s + inv.total_cents, 0);
      const ticketsBaseCents = jobTickets.reduce((s, t) => s + t.base_cents, 0);
      const ticketsGrossCents = jobTickets.reduce((s, t) => s + t.total_cents, 0);
      const netProfitCents = invoicedBaseCents - ticketsBaseCents;
      const marginPct =
        invoicedBaseCents > 0 ? Math.round((netProfitCents / invoicedBaseCents) * 100) : 0;

      return {
        job,
        jobQuotes,
        jobInvoices,
        jobTickets,
        quotedBaseCents,
        invoicedBaseCents,
        invoicedGrossCents,
        collectedGrossCents,
        pendingGrossCents,
        ticketsBaseCents,
        ticketsGrossCents,
        netProfitCents,
        marginPct,
      };
    });
  }, [activeJobs, quotes, invoices, tickets]);

  if (!open) return null;

  const focused =
    selectedScope === "all"
      ? null
      : jobBreakdowns.find((b) => b.job.id === selectedScope) ?? null;

  const metrics = focused
    ? {
        title: `${focused.job.job_code} · ${focused.job.title}`,
        invoicedBaseCents: focused.invoicedBaseCents,
        invoicedGrossCents: focused.invoicedGrossCents,
        collectedGrossCents: focused.collectedGrossCents,
        pendingGrossCents: focused.pendingGrossCents,
        ticketsBaseCents: focused.ticketsBaseCents,
        ticketsGrossCents: focused.ticketsGrossCents,
        netProfitCents: focused.netProfitCents,
        marginPct: focused.marginPct,
      }
    : (() => {
        const invoicedBaseCents = jobBreakdowns.reduce((s, b) => s + b.invoicedBaseCents, 0);
        const invoicedGrossCents = jobBreakdowns.reduce((s, b) => s + b.invoicedGrossCents, 0);
        const collectedGrossCents = jobBreakdowns.reduce((s, b) => s + b.collectedGrossCents, 0);
        const pendingGrossCents = jobBreakdowns.reduce((s, b) => s + b.pendingGrossCents, 0);
        const ticketsBaseCents = jobBreakdowns.reduce((s, b) => s + b.ticketsBaseCents, 0);
        const ticketsGrossCents = jobBreakdowns.reduce((s, b) => s + b.ticketsGrossCents, 0);
        const netProfitCents = invoicedBaseCents - ticketsBaseCents;
        const marginPct =
          invoicedBaseCents > 0 ? Math.round((netProfitCents / invoicedBaseCents) * 100) : 0;
        return {
          title: `Todas las obras (${quarter})`,
          invoicedBaseCents,
          invoicedGrossCents,
          collectedGrossCents,
          pendingGrossCents,
          ticketsBaseCents,
          ticketsGrossCents,
          netProfitCents,
          marginPct,
        };
      })();

  const chartSeries = [
    {
      label: "Facturado",
      cents: metrics.invoicedBaseCents,
      color: "#0f172a",
    },
    {
      label: "Cobrado",
      cents: metrics.collectedGrossCents,
      color: "#0284c7",
    },
    {
      label: "Gastos",
      cents: metrics.ticketsBaseCents,
      color: "#d97706",
    },
    {
      label: "Beneficio",
      cents: Math.max(0, metrics.netProfitCents),
      color: metrics.netProfitCents >= 0 ? "#059669" : "#e11d48",
    },
  ];
  const maxBarCents = Math.max(100, ...chartSeries.map((s) => Math.abs(s.cents)));

  const costRatioPct =
    metrics.invoicedBaseCents > 0
      ? Math.min(100, Math.round((metrics.ticketsBaseCents / metrics.invoicedBaseCents) * 100))
      : 0;
  const profitRatioPct = Math.max(0, 100 - costRatioPct);

  return (
    <div
      data-testid="profitability-analysis-modal"
      className="fixed inset-0 z-50 flex flex-col bg-secondary/45 backdrop-blur-[1px]"
      role="dialog"
      aria-modal="true"
      aria-label="Análisis visual de rentabilidad por obra"
    >
      <div className="mx-auto mt-6 flex min-h-0 w-full max-w-md flex-1 flex-col rounded-t-[24px] border-t border-outline-variant bg-surface-container-lowest shadow-2xl">
        <div className="flex items-center justify-between border-b border-outline-variant px-4 py-3.5">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold text-on-success-container">
              Análisis de rentabilidad
            </div>
            <h3 className="truncate text-[16px] font-semibold text-on-surface">
              {metrics.title}
            </h3>
          </div>
          <button
            type="button"
            data-testid="close-profitability-modal-btn"
            onClick={onClose}
            aria-label="Cerrar análisis de rentabilidad"
            className="h-10 w-10 rounded-full hover:bg-surface-container text-sm font-bold text-on-surface-variant cursor-pointer"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
          {/* Selector de obra o vista general */}
          <div>
            <label
              htmlFor="profit-scope-select"
              className="block text-[11px] font-semibold text-slate-600 mb-1"
            >
              Obra analizada
            </label>
            <select
              id="profit-scope-select"
              data-testid="profitability-scope-select"
              value={selectedScope}
              onChange={(e) => setSelectedScope(e.target.value)}
              className="min-h-10 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 text-xs font-bold text-slate-900"
            >
              <option value="all">Todas las obras activas ({activeJobs.length})</option>
              {jobBreakdowns.map((b) => (
                <option key={b.job.id} value={b.job.id}>
                  {b.job.job_code} · {b.job.title}
                </option>
              ))}
            </select>
          </div>

          {/* 1. Análisis escrito en lenguaje claro */}
          <section
            data-testid="profitability-written-analysis"
            className="rounded-2xl border border-slate-200 bg-slate-50 p-3.5 space-y-2"
          >
            <div className="font-extrabold text-slate-900">Resumen escrito</div>
            <p className="leading-relaxed text-slate-700">
              {metrics.invoicedBaseCents === 0 && metrics.ticketsBaseCents === 0 ? (
                <>
                  Todavía no hay facturas emitidas ni tickets de gasto imputados en{" "}
                  <strong>{metrics.title}</strong>. En cuanto emitas una factura o imputes gastos,
                  verás aquí la evolución real de tu beneficio.
                </>
              ) : (
                <>
                  Has facturado <strong>{formatCentsEs(metrics.invoicedBaseCents)}</strong> sin IVA
                  ({formatCentsEs(metrics.invoicedGrossCents)} con IVA incluido), de los cuales ya has
                  cobrado <strong>{formatCentsEs(metrics.collectedGrossCents)}</strong>
                  {metrics.pendingGrossCents > 0
                    ? ` y quedan ${formatCentsEs(metrics.pendingGrossCents)} pendientes de cobro.`
                    : " (todo cobrado al 100 %)."}
                  {" "}
                  Tus gastos deducibles en tickets suman{" "}
                  <strong>{formatCentsEs(metrics.ticketsBaseCents)}</strong> sin IVA, lo que deja un{" "}
                  <strong
                    className={
                      metrics.netProfitCents >= 0 ? "text-emerald-700" : "text-rose-700"
                    }
                  >
                    beneficio neto de {formatCentsEs(metrics.netProfitCents)}
                  </strong>{" "}
                  (margen limpio del <strong>{metrics.marginPct} %</strong> sobre lo facturado).
                </>
              )}
            </p>
          </section>

          {/* 2. Gráficas muy visuales */}
          <section
            data-testid="profitability-visual-charts"
            className="rounded-2xl border border-slate-200 bg-white p-3.5 space-y-3"
          >
            <div className="flex items-center justify-between">
              <div className="font-extrabold text-slate-900">Gráfica comparativa</div>
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-900">
                Margen {metrics.marginPct} %
              </span>
            </div>

            {/* Gráfico de barras SVG */}
            <svg
              viewBox="0 0 320 140"
              role="img"
              aria-label="Gráfica comparativa de facturación, cobros, gastos y beneficio neto"
              className="w-full overflow-visible"
            >
              <line x1="8" y1="108" x2="312" y2="108" stroke="#cbd5e1" strokeWidth="1" />
              {chartSeries.map((bar, idx) => {
                const barWidth = 46;
                const gap = 28;
                const x = 22 + idx * (barWidth + gap);
                const maxHeight = 82;
                const height = Math.max(4, Math.round((bar.cents / maxBarCents) * maxHeight));
                const y = 108 - height;
                return (
                  <g key={bar.label}>
                    <text
                      x={x + barWidth / 2}
                      y={y - 6}
                      textAnchor="middle"
                      fontSize="9"
                      fontWeight="700"
                      fill="#0f172a"
                    >
                      {formatCentsEs(bar.cents)}
                    </text>
                    <rect
                      x={x}
                      y={y}
                      width={barWidth}
                      height={height}
                      rx="6"
                      fill={bar.color}
                    />
                    <text
                      x={x + barWidth / 2}
                      y="124"
                      textAnchor="middle"
                      fontSize="10"
                      fontWeight="600"
                      fill="#475569"
                    >
                      {bar.label}
                    </text>
                  </g>
                );
              })}
            </svg>

            {/* Barra de proporción Costes vs Beneficio */}
            <div className="space-y-1 pt-1">
              <div className="flex justify-between text-[11px] font-semibold text-slate-700">
                <span>Reparto sobre lo facturado</span>
                <span>
                  {profitRatioPct} % beneficio · {costRatioPct} % gastos
                </span>
              </div>
              <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-200">
                <div
                  className="bg-emerald-600 transition-all"
                  style={{ width: `${profitRatioPct}%` }}
                />
                <div
                  className="bg-amber-500 transition-all"
                  style={{ width: `${costRatioPct}%` }}
                />
              </div>
            </div>

            {/* Comparativa visual por obra cuando se ven todas */}
            {selectedScope === "all" && jobBreakdowns.length > 0 && (
              <div className="space-y-1.5 border-t border-slate-100 pt-2.5">
                <div className="font-bold text-slate-800">Beneficio neto por obra</div>
                {(() => {
                  const maxAbsProfit = Math.max(
                    100,
                    ...jobBreakdowns.map((b) => Math.abs(b.netProfitCents))
                  );
                  return jobBreakdowns.map((b) => {
                    const widthPct = Math.max(
                      6,
                      Math.round((Math.abs(b.netProfitCents) / maxAbsProfit) * 100)
                    );
                    return (
                      <button
                        key={b.job.id}
                        type="button"
                        onClick={() => setSelectedScope(b.job.id)}
                        className="block w-full text-left space-y-0.5 rounded-lg p-1 hover:bg-slate-50"
                      >
                        <div className="flex justify-between text-[11px]">
                          <span className="truncate font-semibold text-slate-800 pr-2">
                            {b.job.job_code} · {b.job.title}
                          </span>
                          <span
                            className={`shrink-0 font-bold ${
                              b.netProfitCents >= 0 ? "text-emerald-700" : "text-rose-700"
                            }`}
                          >
                            {formatCentsEs(b.netProfitCents)}
                          </span>
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                          <div
                            className={`h-full rounded-full ${
                              b.netProfitCents >= 0 ? "bg-emerald-500" : "bg-rose-500"
                            }`}
                            style={{ width: `${widthPct}%` }}
                          />
                        </div>
                      </button>
                    );
                  });
                })()}
              </div>
            )}
          </section>

          {/* 3. Tabla financiera detallada (modern-web-guidance: responsive-table) */}
          <section className="space-y-2">
            <div className="font-extrabold text-slate-900">
              {focused ? "Movimientos de la obra" : "Tabla de rentabilidad por obra"}
            </div>
            <div
              tabIndex={0}
              role="region"
              aria-labelledby="profit-table-caption"
              data-testid="profitability-data-table"
              className="table-wrapper responsive-stack rounded-2xl border border-slate-200 bg-white"
            >
              {!focused ? (
                <table className="text-left text-[11px]">
                  <caption id="profit-table-caption" className="sr-only">
                    Tabla comparativa de facturación, gastos y beneficio neto por obra
                  </caption>
                  <thead className="bg-slate-100 text-slate-700">
                    <tr>
                      <th className="px-2.5 py-2 font-bold">Obra</th>
                      <th className="px-2.5 py-2 font-bold">Facturado</th>
                      <th className="px-2.5 py-2 font-bold">Gastos</th>
                      <th className="px-2.5 py-2 font-bold">Beneficio</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {jobBreakdowns.map((b) => (
                      <tr key={b.job.id}>
                        <th scope="row" className="px-2.5 py-2 font-bold text-slate-900">
                          <button
                            type="button"
                            onClick={() => setSelectedScope(b.job.id)}
                            className="text-left text-orange-700 hover:underline"
                          >
                            {b.job.job_code} · {b.job.title}
                          </button>
                        </th>
                        <td data-label="Facturado" className="px-2.5 py-2 text-slate-700">
                          {formatCentsEs(b.invoicedBaseCents)}
                        </td>
                        <td data-label="Gastos" className="px-2.5 py-2 text-amber-800">
                          {formatCentsEs(b.ticketsBaseCents)}
                        </td>
                        <td
                          data-label="Beneficio"
                          className={`px-2.5 py-2 font-extrabold ${
                            b.netProfitCents >= 0 ? "text-emerald-700" : "text-rose-700"
                          }`}
                        >
                          {formatCentsEs(b.netProfitCents)} ({b.marginPct}%)
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table className="text-left text-[11px]">
                  <caption id="profit-table-caption" className="sr-only">
                    Tabla de facturas y tickets de gasto de la obra seleccionada
                  </caption>
                  <thead className="bg-slate-100 text-slate-700">
                    <tr>
                      <th className="px-2.5 py-2 font-bold">Concepto</th>
                      <th className="px-2.5 py-2 font-bold">Fecha</th>
                      <th className="px-2.5 py-2 font-bold">Base</th>
                      <th className="px-2.5 py-2 font-bold">Estado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {focused.jobInvoices.map((inv) => (
                      <tr key={inv.id}>
                        <th scope="row" className="px-2.5 py-2 font-bold text-slate-900">
                          {onOpenInvoice ? (
                            <button
                              type="button"
                              onClick={() => {
                                onClose();
                                onOpenInvoice(inv.id);
                              }}
                              className="text-left text-on-primary-container hover:underline cursor-pointer"
                            >
                              Factura {inv.invoice_number}
                            </button>
                          ) : (
                            <>Factura {inv.invoice_number}</>
                          )}
                        </th>
                        <td data-label="Fecha" className="px-2.5 py-2 text-slate-600">
                          {inv.issued_at_iso}
                        </td>
                        <td data-label="Base" className="px-2.5 py-2 font-bold text-emerald-700">
                          +{formatCentsEs(inv.base_cents)}
                        </td>
                        <td data-label="Estado" className="px-2.5 py-2 capitalize text-slate-700">
                          {inv.status.replace("_", " ")}
                        </td>
                      </tr>
                    ))}
                    {focused.jobTickets.map((t) => (
                      <tr key={t.id}>
                        <th scope="row" className="px-2.5 py-2 font-bold text-slate-900">
                          {onOpenTicket ? (
                            <button
                              type="button"
                              onClick={() => {
                                onClose();
                                onOpenTicket(t.id);
                              }}
                              className="text-left text-on-primary-container hover:underline cursor-pointer"
                            >
                              Ticket · {t.supplier_name}
                            </button>
                          ) : (
                            <>Ticket · {t.supplier_name}</>
                          )}
                        </th>
                        <td data-label="Fecha" className="px-2.5 py-2 text-slate-600">
                          {t.issue_date_iso}
                        </td>
                        <td data-label="Base" className="px-2.5 py-2 font-bold text-amber-800">
                          -{formatCentsEs(t.base_cents)}
                        </td>
                        <td data-label="Estado" className="px-2.5 py-2 capitalize text-slate-700">
                          {t.category}
                        </td>
                      </tr>
                    ))}
                    {focused.jobInvoices.length === 0 && focused.jobTickets.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-3 py-3 text-center text-slate-500">
                          No hay facturas ni tickets imputados aún en esta obra.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
