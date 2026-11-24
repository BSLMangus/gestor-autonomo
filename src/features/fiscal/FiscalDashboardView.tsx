import { Landmark, Plus, Trash2, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import type {
  ExpenseTicketRow,
  FiscalPiggyBankPayload,
  InvoiceRow,
  JobRow,
  LocalFileBridge,
  QuoteRow,
  SqliteExecutor,
} from "../../core/contracts/types";
import { InvoicesRepository } from "../../core/db/repositories/invoicesRepo";
import { JobsRepository } from "../../core/db/repositories/jobsRepo";
import { SettingsRepository } from "../../core/db/repositories/settingsRepo";
import { TicketsRepository } from "../../core/db/repositories/ticketsRepo";
import { compareQuarter, deriveFiscalQuarter, getLocalTodayIso } from "../../core/fiscal/dateQuarter";
import { computePiggyBank, formatCentsEs } from "../../core/fiscal/fiscalEngine";
import { BACK_PRIORITY } from "../../core/navigation/routes";
import { ConfirmDeleteDialog } from "../../ui/ConfirmDeleteDialog";
import { DeductibleTicketsModal, ProfitabilityAnalysisModal } from "./FiscalDetailModals";

interface FiscalDashboardViewProps {
  executor: SqliteExecutor;
  fileBridge?: LocalFileBridge;
  refreshTick?: number;
  onQuickManualTicket: () => Promise<void>;
  onOpenInvoice?: (invoiceId: string) => void;
  onOpenTicket?: (ticketId: string) => void;
  onDataChanged?: () => Promise<void>;
  registerBackHandler?: (priority: number, handler: () => boolean) => () => void;
}

export function FiscalDashboardView({
  executor,
  fileBridge,
  refreshTick = 0,
  onQuickManualTicket,
  onOpenInvoice,
  onOpenTicket,
  onDataChanged,
  registerBackHandler,
}: FiscalDashboardViewProps) {
  const defaultQuarter = deriveFiscalQuarter(getLocalTodayIso());
  const [quarter, setQuarter] = useState(defaultQuarter);
  const [availableQuarters, setAvailableQuarters] = useState<string[]>([defaultQuarter]);
  const [summary, setSummary] = useState<FiscalPiggyBankPayload | null>(null);
  const [quarterTickets, setQuarterTickets] = useState<ExpenseTicketRow[]>([]);
  const [allTickets, setAllTickets] = useState<ExpenseTicketRow[]>([]);
  const [allInvoices, setAllInvoices] = useState<InvoiceRow[]>([]);
  const [allJobs, setAllJobs] = useState<JobRow[]>([]);
  const [allQuotes, setAllQuotes] = useState<QuoteRow[]>([]);
  const [irpfRate, setIrpfRate] = useState(20);

  const [ticketsModalOpen, setTicketsModalOpen] = useState(false);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [profitModalOpen, setProfitModalOpen] = useState(false);
  const [selectedProfitJobId, setSelectedProfitJobId] = useState<string | null>(null);
  const [deleteInvoiceTarget, setDeleteInvoiceTarget] = useState<InvoiceRow | null>(null);
  const [deleteTicketTarget, setDeleteTicketTarget] = useState<ExpenseTicketRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [localReloadTick, setLocalReloadTick] = useState(0);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const invoicesRepo = new InvoicesRepository(executor);
      const ticketsRepo = new TicketsRepository(executor);
      const jobsRepo = new JobsRepository(executor);
      const settingsRepo = new SettingsRepository(executor);

      const [invoices, tickets, jobs, quotes, settings] = await Promise.all([
        invoicesRepo.listAll(),
        ticketsRepo.listAll(),
        jobsRepo.listAll(),
        executor.query<QuoteRow>(`SELECT * FROM quotes ORDER BY created_at_ms DESC`),
        settingsRepo.getAppSettings(),
      ]);

      const qSet = new Set<string>([defaultQuarter]);
      for (const inv of invoices) qSet.add(inv.quarter);
      for (const t of tickets) qSet.add(t.quarter);
      const sortedQuarters = Array.from(qSet).sort((a, b) => compareQuarter(b, a));

      const configuredIrpf = settings.irpf_reserve_rate;
      const computed = computePiggyBank({
        quarter,
        invoices,
        tickets,
        jobs,
        irpfRate: configuredIrpf,
      });

      if (active) {
        setIrpfRate(configuredIrpf);
        setAvailableQuarters(sortedQuarters);
        setSummary(computed);
        setAllInvoices(invoices);
        setAllTickets(tickets);
        setAllJobs(jobs);
        setAllQuotes(quotes);
        setQuarterTickets(tickets.filter((t) => t.quarter === quarter));
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [executor, quarter, defaultQuarter, refreshTick, localReloadTick]);

  const handleConfirmDelete = async () => {
    if (!fileBridge) return;
    setDeleteError(null);
    setDeleteBusy(true);
    try {
      if (deleteInvoiceTarget) {
        await new InvoicesRepository(executor).delete(deleteInvoiceTarget.id, fileBridge);
        setDeleteInvoiceTarget(null);
      } else if (deleteTicketTarget) {
        await new TicketsRepository(executor).delete(deleteTicketTarget.id, fileBridge);
        setDeleteTicketTarget(null);
      } else {
        return;
      }
      setLocalReloadTick((n) => n + 1);
      await onDataChanged?.();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleteBusy(false);
    }
  };

  useEffect(() => {
    if ((!ticketsModalOpen && !profitModalOpen) || !registerBackHandler) return;
    return registerBackHandler(BACK_PRIORITY.MODAL_SECONDARY, () => {
      if (ticketsModalOpen) {
        setTicketsModalOpen(false);
        return true;
      }
      if (profitModalOpen) {
        setProfitModalOpen(false);
        return true;
      }
      return false;
    });
  }, [ticketsModalOpen, profitModalOpen, registerBackHandler]);

  const quarterInvoices = allInvoices.filter((inv) => inv.quarter === quarter);
  const quarterCollectedCents = summary
    ? summary.cobrado_mismo_trimestre_cents + summary.cobros_trimestres_anteriores_cents
    : 0;
  const quarterInvoicedCents = summary
    ? summary.cobrado_mismo_trimestre_cents + summary.pendiente_cobro_trimestre_cents
    : 0;
  const quarterExpensesTotalCents = quarterTickets.reduce((s, t) => s + t.total_cents, 0);
  const freePositiveCents = Math.max(0, summary?.available_cash_cents ?? 0);
  const taxPositiveCents = Math.max(0, summary?.untouchable_tax_cents ?? 0);
  const expPositiveCents = Math.max(0, quarterExpensesTotalCents);
  const donutTotal = Math.max(1, freePositiveCents + expPositiveCents + taxPositiveCents);
  const freePct = Math.round((freePositiveCents / donutTotal) * 100);
  const expPct = Math.round((expPositiveCents / donutTotal) * 100);
  const taxPct = Math.max(0, 100 - freePct - expPct);

  const C = 276.46;
  const freeDash = (freePct / 100) * C;
  const expDash = (expPct / 100) * C;
  const taxDash = (taxPct / 100) * C;

  const maxBarVal = Math.max(
    quarterInvoicedCents,
    quarterCollectedCents,
    quarterExpensesTotalCents,
    freePositiveCents,
    1
  );
  const barPct = (val: number) => Math.max(8, Math.round((Math.max(0, val) / maxBarVal) * 100));

  const maxJobNet = summary
    ? Math.max(...summary.job_profits.map((j) => Math.abs(j.net_profit_cents)), 1)
    : 1;

  return (
    <div
      data-testid="fiscal-dashboard-view"
      className="flex flex-1 flex-col overflow-y-auto no-scrollbar px-4 pt-4 pb-8 space-y-4 bg-surface"
    >
      {/* Cabecera y selector de trimestre */}
      <div className="flex items-center justify-between gap-2 rounded-[20px] border border-outline-variant bg-surface-container-lowest p-4 shadow-[0_2px_10px_rgba(15,23,42,0.04)]">
        <div>
          <h2 className="text-[16px] font-semibold text-on-surface">Hucha Fiscal</h2>
          <p className="text-[12px] text-on-surface-variant">
            Reserva trimestral (IVA + IRPF {irpfRate} %)
          </p>
        </div>

        <select
          aria-label="Trimestre fiscal"
          data-testid="fiscal-quarter-select"
          value={quarter}
          onChange={(e) => setQuarter(e.target.value)}
          className="min-h-[42px] rounded-full border border-outline-variant bg-surface-container-low px-3.5 font-mono text-[12px] font-semibold text-on-surface tabular-nums"
        >
          {availableQuarters.map((q) => (
            <option key={q} value={q}>
              {q}
            </option>
          ))}
        </select>
      </div>

      {summary && (
        <>
          {/* Dos tarjetas KPI principales */}
          <div className="grid grid-cols-2 gap-3 items-stretch">
            <div className="h-full rounded-[20px] border border-outline-variant bg-warning-container p-4 flex flex-col justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <Landmark className="w-[18px] h-[18px] text-on-warning-container" />
                <span className="text-[12px] font-semibold text-on-warning-container">
                  Hacienda Intocable
                </span>
              </div>
              <div
                data-testid="dashboard-untouchable"
                className="font-mono text-[19px] leading-[24px] font-bold text-on-warning-container tabular-nums"
              >
                {formatCentsEs(summary.untouchable_tax_cents)}
              </div>
              <div className="pt-1.5 border-t border-outline-variant/60 font-mono text-[11px] text-on-warning-container tabular-nums">
                IVA {formatCentsEs(summary.iva_to_reserve_cents)} + IRPF {irpfRate} % (
                {formatCentsEs(summary.irpf_20_cents)})
              </div>
            </div>

            <div className="h-full rounded-[20px] border border-outline-variant bg-success-container p-4 flex flex-col justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <Wallet className="w-[18px] h-[18px] text-on-success-container" />
                <span className="text-[12px] font-semibold text-on-success-container">
                  Libre real
                </span>
              </div>
              <div
                data-testid="dashboard-available"
                className="font-mono text-[19px] leading-[24px] font-bold text-on-success-container tabular-nums"
              >
                {formatCentsEs(summary.available_cash_cents)}
              </div>
              <div className="pt-1.5 border-t border-outline-variant/60 font-mono text-[11px] text-on-success-container tabular-nums">
                Cobrado {summary.quarter}: {formatCentsEs(summary.cobrado_mismo_trimestre_cents)}
              </div>
            </div>
          </div>

          {/* Gráfico 1: Donut SVG — Reparto de cada euro */}
          <section className="bg-surface-warm-card border border-outline-variant rounded-[20px] p-4 shadow-[0_2px_10px_rgba(15,23,42,0.04)] flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-[15px] font-semibold text-on-surface">Reparto de cada euro</h3>
              <span className="font-mono text-[12px] text-on-surface-variant tabular-nums">
                {formatCentsEs(quarterCollectedCents)} cobrados
              </span>
            </div>

            <div className="flex items-center gap-4">
              <div className="relative w-32 h-32 shrink-0 flex items-center justify-center">
                <svg
                  viewBox="0 0 120 120"
                  className="w-32 h-32 -rotate-90"
                  role="img"
                  aria-label={`Reparto: ${freePct}% beneficio, ${expPct}% gastos, ${taxPct}% impuestos`}
                >
                  <circle cx="60" cy="60" r="44" fill="none" stroke="#F1F5F9" strokeWidth="16" />
                  <circle
                    cx="60"
                    cy="60"
                    r="44"
                    fill="none"
                    stroke="#059669"
                    strokeWidth="16"
                    strokeDasharray={`${freeDash} ${C}`}
                    strokeDashoffset="0"
                  />
                  <circle
                    cx="60"
                    cy="60"
                    r="44"
                    fill="none"
                    stroke="#0F172A"
                    strokeWidth="16"
                    strokeDasharray={`${expDash} ${C}`}
                    strokeDashoffset={-freeDash}
                  />
                  <circle
                    cx="60"
                    cy="60"
                    r="44"
                    fill="none"
                    stroke="#D97706"
                    strokeWidth="16"
                    strokeDasharray={`${taxDash} ${C}`}
                    strokeDashoffset={-(freeDash + expDash)}
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                  <span className="font-mono text-[16px] font-bold text-on-surface tabular-nums">
                    {freePct}%
                  </span>
                  <span className="text-[11px] font-semibold text-on-surface-variant">Tuyo</span>
                </div>
              </div>

              <div className="flex-1 flex flex-col gap-2">
                <div className="flex items-center justify-between text-[13px]">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-free" />
                    <span className="text-on-surface">Beneficio limpio</span>
                  </div>
                  <span className="font-mono text-[12px] font-semibold tabular-nums">
                    {freePct}%
                  </span>
                </div>
                <div className="flex items-center justify-between text-[13px]">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-secondary" />
                    <span className="text-on-surface">Gastos</span>
                  </div>
                  <span className="font-mono text-[12px] font-semibold tabular-nums">
                    {expPct}%
                  </span>
                </div>
                <div className="flex items-center justify-between text-[13px]">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-tax" />
                    <span className="text-on-surface">IVA + IRPF</span>
                  </div>
                  <span className="font-mono text-[12px] font-semibold tabular-nums">
                    {taxPct}%
                  </span>
                </div>
              </div>
            </div>
          </section>

          {/* Gráfico 2: Barras verticales comparativas */}
          <section className="bg-surface-warm-card border border-outline-variant rounded-[20px] p-4 shadow-[0_2px_10px_rgba(15,23,42,0.04)] flex flex-col gap-3">
            <h3 className="text-[15px] font-semibold text-on-surface">Resumen del trimestre</h3>

            <div className="grid grid-cols-4 gap-2 items-end pt-3 h-44">
              {[
                {
                  label: "Facturado",
                  val: quarterInvoicedCents,
                  cls: "bg-secondary",
                  txt: "text-on-surface",
                },
                {
                  label: "Cobrado",
                  val: quarterCollectedCents,
                  cls: "bg-terracotta",
                  txt: "text-on-surface",
                },
                {
                  label: "Gastos",
                  val: quarterExpensesTotalCents,
                  cls: "bg-amber-tax",
                  txt: "text-on-surface",
                },
                {
                  label: "Beneficio",
                  val: freePositiveCents,
                  cls: "bg-emerald-free",
                  txt: "text-on-success-container",
                },
              ].map((bar) => (
                <div
                  key={bar.label}
                  className="flex flex-col items-center justify-end h-full gap-1.5"
                >
                  <span className={`font-mono text-[10px] font-semibold tabular-nums ${bar.txt}`}>
                    {formatCentsEs(bar.val)}
                  </span>
                  <div className="w-full max-w-[44px] flex-1 flex items-end">
                    <div
                      className={`w-full rounded-t-lg transition-all duration-300 ${bar.cls}`}
                      style={{ height: `${barPct(bar.val)}%` }}
                    />
                  </div>
                  <span className="text-[11px] font-semibold text-on-surface-variant">
                    {bar.label}
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* Desglose fiscal detallado */}
          <div className="rounded-[20px] border border-outline-variant bg-surface-container-lowest p-4 text-[13px] space-y-2 shadow-[0_2px_10px_rgba(15,23,42,0.04)]">
            <div className="font-semibold text-[14px] text-on-surface">
              Desglose trimestral ({summary.quarter})
            </div>
            <div className="flex justify-between text-on-surface-variant">
              <span>Cobrado emitido en {summary.quarter}</span>
              <span className="font-mono font-semibold text-on-surface tabular-nums">
                {formatCentsEs(summary.cobrado_mismo_trimestre_cents)}
              </span>
            </div>
            <div className="flex justify-between text-on-surface-variant">
              <span>Cobros de trimestres anteriores</span>
              <span className="font-mono font-semibold text-on-surface tabular-nums">
                {formatCentsEs(summary.cobros_trimestres_anteriores_cents)}
              </span>
            </div>
            <div className="flex justify-between text-on-surface-variant">
              <span>Pendiente cobro en {summary.quarter}</span>
              <span className="font-mono font-semibold text-on-surface tabular-nums">
                {formatCentsEs(summary.pendiente_cobro_trimestre_cents)}
              </span>
            </div>
            <div className="flex justify-between text-on-surface-variant">
              <span>Pendiente trimestres anteriores</span>
              <span className="font-mono font-semibold text-on-surface tabular-nums">
                {formatCentsEs(summary.pendiente_cobro_anteriores_cents)}
              </span>
            </div>
            <div className="flex justify-between border-t border-outline-variant pt-2 text-on-surface-variant">
              <span>IVA repercutido / IVA soportado</span>
              <span className="font-mono font-semibold text-on-surface tabular-nums">
                {formatCentsEs(summary.iva_repercutido_cents)} /{" "}
                {formatCentsEs(summary.iva_soportado_cents)}
              </span>
            </div>
            {summary.iva_to_compensate_cents > 0 && (
              <div className="flex justify-between text-on-success-container font-semibold">
                <span>Saldo IVA a compensar</span>
                <span className="font-mono tabular-nums">
                  {formatCentsEs(summary.iva_to_compensate_cents)}
                </span>
              </div>
            )}
          </div>

          {/* Gráfico 3: Rentabilidad neta por obra */}
          <section className="rounded-[20px] border border-outline-variant bg-surface-warm-card p-4 space-y-3 shadow-[0_2px_10px_rgba(15,23,42,0.04)]">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-[15px] font-semibold text-on-surface">
                Rentabilidad acumulada por obra
              </h3>
              <button
                type="button"
                data-testid="open-profitability-analysis-btn"
                onClick={() => {
                  setSelectedProfitJobId(null);
                  setProfitModalOpen(true);
                }}
                className="rounded-full border border-outline-variant bg-success-container px-3 py-1.5 text-[11px] font-semibold text-on-success-container cursor-pointer"
              >
                Ver análisis y gráficas
              </button>
            </div>
            {summary.job_profits.length === 0 ? (
              <div className="text-[13px] text-on-surface-variant">
                Sin actividad en {summary.quarter}.
              </div>
            ) : (
              <div className="flex flex-col gap-2.5">
                {summary.job_profits.map((jp, idx) => (
                  <button
                    key={jp.job_id}
                    type="button"
                    data-testid={`fiscal-job-profit-${jp.job_id}`}
                    onClick={() => {
                      setSelectedProfitJobId(jp.job_id);
                      setProfitModalOpen(true);
                    }}
                    className="flex w-full flex-col gap-1.5 rounded-2xl border border-outline-variant bg-surface-container-lowest p-3 text-left hover:border-terracotta transition-colors cursor-pointer"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[13px] font-semibold text-on-surface">
                        {jp.job_code} · {jp.job_title}
                      </span>
                      <span
                        className={`shrink-0 font-mono text-[12px] font-bold tabular-nums ${
                          jp.net_profit_cents >= 0
                            ? "text-on-success-container"
                            : "text-coral-alert"
                        }`}
                      >
                        {formatCentsEs(jp.net_profit_cents)}
                      </span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-surface-container overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          jp.net_profit_cents < 0
                            ? "bg-coral-alert"
                            : idx % 3 === 2
                              ? "bg-terracotta"
                              : "bg-emerald-free"
                        }`}
                        style={{
                          width: `${Math.max(
                            10,
                            Math.round((Math.abs(jp.net_profit_cents) / maxJobNet) * 100)
                          )}%`,
                        }}
                      />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>

          {/* Lista de facturas del trimestre */}
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-[15px] font-semibold text-on-surface">
                Facturas del trimestre ({quarterInvoices.length})
              </h3>
            </div>

            {quarterInvoices.length === 0 ? (
              <div className="rounded-[20px] border border-dashed border-outline-variant bg-surface-container-lowest p-4 text-[13px] text-on-surface-variant">
                Sin facturas emitidas en {quarter}.
              </div>
            ) : (
              <div className="bg-surface-warm-card border border-outline-variant rounded-[20px] divide-y divide-outline-variant shadow-[0_2px_10px_rgba(15,23,42,0.04)] overflow-hidden">
                {quarterInvoices.map((inv) => {
                  const isPaid = inv.status === "pagado";
                  const isOverdue = inv.status === "vencido";
                  return (
                    <div
                      key={inv.id}
                      className="flex items-center gap-2 pr-3 hover:bg-surface-container-lowest/80 transition-colors"
                    >
                      <button
                        type="button"
                        data-testid={`fiscal-invoice-${inv.id}`}
                        onClick={() => onOpenInvoice?.(inv.id)}
                        className="flex min-w-0 flex-1 items-center justify-between gap-3 p-4 text-left cursor-pointer"
                      >
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-[13px] font-bold text-on-surface">
                              {inv.invoice_number}
                            </span>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                                isPaid
                                  ? "bg-success-container text-on-success-container"
                                  : isOverdue
                                    ? "bg-error-container text-on-error-container"
                                    : "bg-warning-container text-on-warning-container"
                              }`}
                            >
                              {isPaid ? "Cobrada" : isOverdue ? "Vencida" : "Pendiente"}
                            </span>
                          </div>
                          <div className="truncate text-[12px] text-on-surface-variant">
                            {inv.client_name_snapshot} · {inv.issued_at_iso}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="font-mono text-[15px] font-semibold text-on-surface tabular-nums">
                            {formatCentsEs(inv.total_cents)}
                          </div>
                          <div className="text-[11px] font-semibold text-on-primary-container">
                            Ver detalle →
                          </div>
                        </div>
                      </button>
                      {fileBridge && (
                        <button
                          type="button"
                          data-testid={`fiscal-invoice-delete-${inv.id}`}
                          aria-label={`Eliminar factura ${inv.invoice_number}`}
                          onClick={() => {
                            setDeleteError(null);
                            setDeleteTicketTarget(null);
                            setDeleteInvoiceTarget(inv);
                          }}
                          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-coral-alert/25 bg-surface-container-lowest text-coral-alert hover:bg-error-container cursor-pointer"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Lista de tickets deducibles */}
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                data-testid="open-tickets-detail-btn"
                onClick={() => {
                  setSelectedTicketId(null);
                  setTicketsModalOpen(true);
                }}
                className="text-left text-[15px] font-semibold text-on-surface hover:text-on-primary-container cursor-pointer"
              >
                Tickets deducibles ({quarterTickets.length}) · Ver todos →
              </button>
              <button
                type="button"
                onClick={() => void onQuickManualTicket()}
                className="inline-flex min-h-[38px] items-center gap-1 rounded-full bg-secondary px-3 text-[12px] font-semibold text-on-secondary cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Añadir ticket</span>
              </button>
            </div>

            {quarterTickets.length === 0 ? (
              <div className="rounded-[20px] border border-dashed border-outline-variant bg-surface-container-lowest p-4 text-[13px] text-on-surface-variant">
                Sin tickets registrados en {quarter}.
              </div>
            ) : (
              <div className="bg-surface-warm-card border border-outline-variant rounded-[20px] divide-y divide-outline-variant shadow-[0_2px_10px_rgba(15,23,42,0.04)] overflow-hidden">
                {quarterTickets.map((t) => (
                  <div
                    key={t.id}
                    className="flex items-center gap-2 pr-3 hover:bg-surface-container-lowest/80 transition-colors"
                  >
                    <button
                      type="button"
                      data-testid={`fiscal-ticket-${t.id}`}
                      onClick={() => {
                        if (onOpenTicket) {
                          onOpenTicket(t.id);
                        } else {
                          setSelectedTicketId(t.id);
                          setTicketsModalOpen(true);
                        }
                      }}
                      className="flex min-w-0 flex-1 items-center justify-between gap-3 p-4 text-left cursor-pointer"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="text-[15px] font-semibold text-on-surface truncate">
                          {t.supplier_name}
                        </div>
                        <div className="flex items-center gap-2 text-[11px] font-semibold text-on-surface-variant">
                          <span className="rounded-full bg-terracotta-soft px-2 py-0.5 text-on-primary-container capitalize">
                            {t.category}
                          </span>
                          <span className="font-mono tabular-nums">
                            {t.issue_date_iso} · Base {formatCentsEs(t.base_cents)}
                          </span>
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="font-mono text-[15px] font-semibold text-on-surface tabular-nums">
                          {formatCentsEs(t.total_cents)}
                        </div>
                        <div className="text-[11px] font-semibold text-on-primary-container">
                          Ver ficha →
                        </div>
                      </div>
                    </button>
                    {fileBridge && (
                      <button
                        type="button"
                        data-testid={`fiscal-ticket-delete-${t.id}`}
                        aria-label={`Eliminar ticket ${t.supplier_name}`}
                        onClick={() => {
                          setDeleteError(null);
                          setDeleteInvoiceTarget(null);
                          setDeleteTicketTarget(t);
                        }}
                        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-coral-alert/25 bg-surface-container-lowest text-coral-alert hover:bg-error-container cursor-pointer"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      <DeductibleTicketsModal
        open={ticketsModalOpen}
        quarter={quarter}
        tickets={quarterTickets}
        jobs={allJobs}
        initialTicketId={selectedTicketId}
        fileBridge={fileBridge}
        onClose={() => setTicketsModalOpen(false)}
        onOpenTicket={onOpenTicket}
        onQuickManualTicket={onQuickManualTicket}
      />

      <ProfitabilityAnalysisModal
        open={profitModalOpen}
        quarter={quarter}
        initialJobId={selectedProfitJobId}
        jobs={allJobs}
        quotes={allQuotes}
        invoices={allInvoices}
        tickets={allTickets}
        onClose={() => setProfitModalOpen(false)}
        onOpenInvoice={onOpenInvoice}
        onOpenTicket={onOpenTicket}
      />

      <ConfirmDeleteDialog
        open={deleteInvoiceTarget !== null || deleteTicketTarget !== null}
        title={
          deleteInvoiceTarget
            ? `¿Eliminar factura ${deleteInvoiceTarget.invoice_number}?`
            : deleteTicketTarget
              ? `¿Eliminar ticket de ${deleteTicketTarget.supplier_name}?`
              : "¿Eliminar documento?"
        }
        description={
          deleteInvoiceTarget
            ? `Se eliminará la factura de ${deleteInvoiceTarget.client_name_snapshot} (${formatCentsEs(deleteInvoiceTarget.total_cents)}) y su PDF generado. Esta acción no se puede deshacer.`
            : deleteTicketTarget
              ? `Se eliminará este ticket (${formatCentsEs(deleteTicketTarget.total_cents)}) y su imagen asociada. Esta acción no se puede deshacer.`
              : ""
        }
        warningNote={
          deleteInvoiceTarget
            ? `${
                deleteInvoiceTarget.status === "pagado" || deleteInvoiceTarget.sent_at_iso
                  ? `Atención: esta factura ya figura como ${
                      deleteInvoiceTarget.status === "pagado" ? "cobrada" : "enviada"
                    }. En facturación oficial corresponde emitir una rectificativa; elimínala solo si fue un error de registro. `
                  : ""
              }Se recalcularán los totales de tu Hucha Fiscal.`
            : deleteTicketTarget
              ? "Se recalculará el IVA soportado y el beneficio neto en tu Hucha Fiscal."
              : null
        }
        errorMsg={deleteError}
        busy={deleteBusy}
        confirmTestId="fiscal-confirm-delete-btn"
        registerBackHandler={registerBackHandler}
        onCancel={() => {
          if (!deleteBusy) {
            setDeleteInvoiceTarget(null);
            setDeleteTicketTarget(null);
            setDeleteError(null);
          }
        }}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
}
