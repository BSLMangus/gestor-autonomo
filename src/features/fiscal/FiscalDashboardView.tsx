import { Landmark, Plus, Trash2, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import type {
  ExpenseTicketRow,
  FiscalPiggyBankPayload,
  InvoiceRow,
  JobRow,
  LocalFileBridge,
  QuoteRow,
  ScheduleEntryRow,
  SqliteExecutor,
} from "../../core/contracts/types";
import { InvoicesRepository } from "../../core/db/repositories/invoicesRepo";
import { JobsRepository } from "../../core/db/repositories/jobsRepo";
import { ScheduleRepository } from "../../core/db/repositories/scheduleRepo";
import { SettingsRepository } from "../../core/db/repositories/settingsRepo";
import { TicketsRepository } from "../../core/db/repositories/ticketsRepo";
import { compareQuarter, deriveFiscalQuarter, getLocalTodayIso } from "../../core/fiscal/dateQuarter";
import { computePiggyBank, formatCentsEs } from "../../core/fiscal/fiscalEngine";
import { BACK_PRIORITY } from "../../core/navigation/routes";
import { ConfirmDeleteDialog } from "../../ui/ConfirmDeleteDialog";
import { DeductibleTicketsModal, ProfitabilityAnalysisModal } from "./FiscalDetailModals";
import { TaxAlertsBanner } from "./TaxAlertsBanner";

interface FiscalDashboardViewProps {
  executor: SqliteExecutor;
  fileBridge?: LocalFileBridge;
  refreshTick?: number;
  todayIso?: string;
  onOpenTaxCalendar?: (focusDateIso?: string) => void;
  onQuickManualTicket: () => Promise<void>;
  onOpenInvoice?: (invoiceId: string) => void;
  onPreviewInvoice?: (invoiceId: string) => void;
  onOpenTicket?: (ticketId: string) => void;
  onDataChanged?: () => Promise<void>;
  registerBackHandler?: (priority: number, handler: () => boolean) => () => void;
}

export function FiscalDashboardView({
  executor,
  fileBridge,
  refreshTick = 0,
  todayIso,
  onOpenTaxCalendar,
  onQuickManualTicket,
  onOpenInvoice,
  onPreviewInvoice,
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
  const [allScheduleEntries, setAllScheduleEntries] = useState<ScheduleEntryRow[]>([]);
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
      const scheduleRepo = new ScheduleRepository(executor);
      const settingsRepo = new SettingsRepository(executor);

      const [invoices, tickets, jobs, quotes, scheduleEntries, settings] = await Promise.all([
        invoicesRepo.listAll(),
        ticketsRepo.listAll(),
        jobsRepo.listAll(),
        executor.query<QuoteRow>(`SELECT * FROM quotes ORDER BY created_at_ms DESC`),
        scheduleRepo.listAllEntries(),
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
        setAllScheduleEntries(scheduleEntries);
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
      className="flex flex-1 flex-col overflow-y-auto no-scrollbar px-4 pt-4 pb-8 space-y-4 cotton-paper text-[#2C2621]"
    >
      {/* Cabecera y selector de trimestre */}
      <div className="paper-sheet flex items-center justify-between gap-2 rounded-2xl border border-[#E5DFD2] bg-[#FFFDF7] p-4">
        <div>
          <h2 className="font-sans text-[16px] font-bold text-[#2C2621]">Hucha Fiscal</h2>
          <p className="text-[12px] text-[#6B6860]">
            Reserva trimestral (IVA + IRPF {irpfRate} %)
          </p>
        </div>

        <div className="rounded-full bg-[#FFFDF7] border border-[#E5DFD2] p-1 shadow-xs">
          <select
            aria-label="Trimestre fiscal"
            data-testid="fiscal-quarter-select"
            value={quarter}
            onChange={(e) => setQuarter(e.target.value)}
            className="min-h-[38px] rounded-full bg-[#4B7094] px-3.5 font-mono text-[12px] font-semibold text-[#FFFDF9] tabular-nums cursor-pointer focus:outline-none"
          >
            {availableQuarters.map((q) => (
              <option key={q} value={q} className="bg-[#FFFDF7] text-[#2C2621]">
                {q}
              </option>
            ))}
          </select>
        </div>
      </div>

      <TaxAlertsBanner
        executor={executor}
        refreshTick={refreshTick + localReloadTick}
        todayIso={todayIso}
        maxVisible={4}
        onOpenTaxCalendar={onOpenTaxCalendar}
        onTaxStateChanged={async () => {
          setLocalReloadTick((t) => t + 1);
          await onDataChanged?.();
        }}
      />

      {summary && (
        <>
          {/* Dos tarjetas KPI principales como Post-its con cinta washi */}
          <div className="grid grid-cols-2 gap-3 items-stretch pt-2">
            <div className="postit-note postit-yellow tilt-subtle-left h-full p-4 pt-5 flex flex-col justify-between gap-2">
              <span className="washi-tape washi-amber" aria-hidden="true" />
              <div className="flex items-center gap-1.5">
                <Landmark className="w-[18px] h-[18px] text-[#3E3300]" />
                <span className="text-[12px] font-semibold text-[#3E3300]">
                  Hacienda Intocable
                </span>
              </div>
              <div
                data-testid="dashboard-untouchable"
                className="font-mono text-[19px] leading-[24px] font-bold text-[#3E3300] tabular-nums"
              >
                {formatCentsEs(summary.untouchable_tax_cents)}
              </div>
              <div className="pt-1.5 border-t border-[#E5DFD2] font-mono text-[11px] text-[#4A473E] tabular-nums">
                IVA {formatCentsEs(summary.iva_to_reserve_cents)} + IRPF {irpfRate} % (
                {formatCentsEs(summary.irpf_20_cents)})
              </div>
            </div>

            <div className="postit-note postit-green tilt-subtle-right h-full p-4 pt-5 flex flex-col justify-between gap-2">
              <span className="washi-tape washi-green" aria-hidden="true" />
              <div className="flex items-center gap-1.5">
                <Wallet className="w-[18px] h-[18px] text-[#1B3A24]" />
                <span className="text-[12px] font-semibold text-[#1B3A24]">
                  Libre real
                </span>
              </div>
              <div
                data-testid="dashboard-available"
                className="font-mono text-[19px] leading-[24px] font-bold text-[#14532D] tabular-nums"
              >
                {formatCentsEs(summary.available_cash_cents)}
              </div>
              <div className="pt-1.5 border-t border-[#E5DFD2] font-mono text-[11px] text-[#354B3B] tabular-nums">
                Cobrado {summary.quarter}: {formatCentsEs(summary.cobrado_mismo_trimestre_cents)}
              </div>
            </div>
          </div>

          {/* Gráfico 1: Donut SVG — Reparto de cada euro (cuaderno rayado + agujeros) */}
          <section className="ruled-notebook border border-[#E5DFD2] rounded-2xl p-4 pl-9 pt-5 flex flex-col gap-3">
            <div
              className="absolute left-2.5 top-0 bottom-0 flex flex-col justify-around py-3 pointer-events-none"
              aria-hidden="true"
            >
              <span className="w-2.5 h-2.5 rounded-full paper-hole border shadow-inner" />
              <span className="w-2.5 h-2.5 rounded-full paper-hole border shadow-inner" />
              <span className="w-2.5 h-2.5 rounded-full paper-hole border shadow-inner" />
            </div>

            <div className="flex items-center justify-between gap-2">
              <h3 className="text-[15px] font-bold text-[#2C2621]">Reparto de cada euro</h3>
              <span className="font-mono text-[12px] text-[#6B6860] tabular-nums">
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
                  <circle cx="60" cy="60" r="44" fill="none" stroke="#EFECE4" strokeWidth="16" />
                  <circle
                    cx="60"
                    cy="60"
                    r="44"
                    fill="none"
                    stroke="#1E8E5A"
                    strokeWidth="16"
                    strokeDasharray={`${freeDash} ${C}`}
                    strokeDashoffset="0"
                  />
                  <circle
                    cx="60"
                    cy="60"
                    r="44"
                    fill="none"
                    stroke="#E85D2A"
                    strokeWidth="16"
                    strokeDasharray={`${expDash} ${C}`}
                    strokeDashoffset={-freeDash}
                  />
                  <circle
                    cx="60"
                    cy="60"
                    r="44"
                    fill="none"
                    stroke="#E6B84C"
                    strokeWidth="16"
                    strokeDasharray={`${taxDash} ${C}`}
                    strokeDashoffset={-(freeDash + expDash)}
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                  <span className="font-mono text-[16px] font-bold text-[#2C2621] tabular-nums">
                    {freePct}%
                  </span>
                  <span className="text-[11px] font-semibold text-[#6B6860]">Tuyo</span>
                </div>
              </div>

              <div className="flex-1 flex flex-col gap-2">
                <div className="flex items-center justify-between text-[13px]">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full chart-emerald shrink-0" />
                    <span className="text-[#2C2621]">Beneficio limpio</span>
                  </div>
                  <span className="font-mono text-[12px] font-semibold text-[#2C2621] tabular-nums">
                    {freePct}%
                  </span>
                </div>
                <div className="flex items-center justify-between text-[13px]">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full chart-tangerine shrink-0" />
                    <span className="text-[#2C2621]">Gastos</span>
                  </div>
                  <span className="font-mono text-[12px] font-semibold text-[#2C2621] tabular-nums">
                    {expPct}%
                  </span>
                </div>
                <div className="flex items-center justify-between text-[13px]">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full chart-mustard shrink-0" />
                    <span className="text-[#2C2621]">IVA + IRPF</span>
                  </div>
                  <span className="font-mono text-[12px] font-semibold text-[#2C2621] tabular-nums">
                    {taxPct}%
                  </span>
                </div>
              </div>
            </div>
          </section>

          {/* Gráfico 2: Barras verticales comparativas */}
          <section className="ruled-notebook border border-[#E5DFD2] rounded-2xl p-4 pl-9 pt-5 flex flex-col gap-3">
            <div
              className="absolute left-2.5 top-0 bottom-0 flex flex-col justify-around py-3 pointer-events-none"
              aria-hidden="true"
            >
              <span className="w-2.5 h-2.5 rounded-full paper-hole border shadow-inner" />
              <span className="w-2.5 h-2.5 rounded-full paper-hole border shadow-inner" />
              <span className="w-2.5 h-2.5 rounded-full paper-hole border shadow-inner" />
            </div>

            <h3 className="text-[15px] font-bold text-[#2C2621]">Resumen del trimestre</h3>

            <div className="grid grid-cols-4 gap-2 items-end pt-3 h-44">
              {[
                {
                  label: "Facturado",
                  val: quarterInvoicedCents,
                  cls: "chart-violet",
                  txt: "text-[#2C2621]",
                },
                {
                  label: "Cobrado",
                  val: quarterCollectedCents,
                  cls: "chart-gold",
                  txt: "text-[#2C2621]",
                },
                {
                  label: "Gastos",
                  val: quarterExpensesTotalCents,
                  cls: "chart-tangerine",
                  txt: "text-[#2C2621]",
                },
                {
                  label: "Beneficio",
                  val: freePositiveCents,
                  cls: "chart-emerald",
                  txt: "text-[#14532D]",
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
                  <span className="text-[11px] font-semibold text-[#6B6860]">
                    {bar.label}
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* Desglose fiscal detallado */}
          <div className="ruled-notebook rounded-2xl border border-[#E5DFD2] p-4 pl-9 text-[13px] space-y-2">
            <div
              className="absolute left-2.5 top-0 bottom-0 flex flex-col justify-around py-3 pointer-events-none"
              aria-hidden="true"
            >
              <span className="w-2.5 h-2.5 rounded-full paper-hole border shadow-inner" />
              <span className="w-2.5 h-2.5 rounded-full paper-hole border shadow-inner" />
            </div>
            <div className="font-bold text-[14px] text-[#2C2621]">
              Desglose trimestral ({summary.quarter})
            </div>
            <div className="flex justify-between text-[#6B6860]">
              <span>Cobrado emitido en {summary.quarter}</span>
              <span className="font-mono font-semibold text-[#2C2621] tabular-nums">
                {formatCentsEs(summary.cobrado_mismo_trimestre_cents)}
              </span>
            </div>
            <div className="flex justify-between text-[#6B6860]">
              <span>Cobros de trimestres anteriores</span>
              <span className="font-mono font-semibold text-[#2C2621] tabular-nums">
                {formatCentsEs(summary.cobros_trimestres_anteriores_cents)}
              </span>
            </div>
            <div className="flex justify-between text-[#6B6860]">
              <span>Pendiente cobro en {summary.quarter}</span>
              <span className="font-mono font-semibold text-[#2C2621] tabular-nums">
                {formatCentsEs(summary.pendiente_cobro_trimestre_cents)}
              </span>
            </div>
            <div className="flex justify-between text-[#6B6860]">
              <span>Pendiente trimestres anteriores</span>
              <span className="font-mono font-semibold text-[#2C2621] tabular-nums">
                {formatCentsEs(summary.pendiente_cobro_anteriores_cents)}
              </span>
            </div>
            <div className="flex justify-between border-t border-[#E5DFD2] pt-2 text-[#6B6860]">
              <span>IVA repercutido / IVA soportado</span>
              <span className="font-mono font-semibold text-[#2C2621] tabular-nums">
                {formatCentsEs(summary.iva_repercutido_cents)} /{" "}
                {formatCentsEs(summary.iva_soportado_cents)}
              </span>
            </div>
            {summary.iva_to_compensate_cents > 0 && (
              <div className="flex justify-between text-[#14532D] font-semibold">
                <span>Saldo IVA a compensar</span>
                <span className="font-mono tabular-nums">
                  {formatCentsEs(summary.iva_to_compensate_cents)}
                </span>
              </div>
            )}
          </div>

          {/* Gráfico 3: Rentabilidad neta por obra */}
          <section className="ruled-notebook rounded-2xl border border-[#E5DFD2] p-4 pl-9 space-y-3">
            <div
              className="absolute left-2.5 top-0 bottom-0 flex flex-col justify-around py-3 pointer-events-none"
              aria-hidden="true"
            >
              <span className="w-2.5 h-2.5 rounded-full paper-hole border shadow-inner" />
              <span className="w-2.5 h-2.5 rounded-full paper-hole border shadow-inner" />
            </div>
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-[15px] font-bold text-[#2C2621]">
                Rentabilidad acumulada por obra
              </h3>
              <button
                type="button"
                data-testid="open-profitability-analysis-btn"
                onClick={() => {
                  setSelectedProfitJobId(null);
                  setProfitModalOpen(true);
                }}
                className="status-emerald rounded-full px-3 py-1.5 text-[11px] font-semibold cursor-pointer"
              >
                Ver análisis y gráficas
              </button>
            </div>
            {summary.job_profits.length === 0 ? (
              <div className="text-[13px] text-[#6B6860]">
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
                    className="flex w-full flex-col gap-1.5 rounded-2xl border border-[#E5DFD2] bg-[#FFFDF7] p-3 text-left hover:border-[#EA580C] transition-colors cursor-pointer"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-mono text-[13px] font-semibold text-[#2C2621]">
                        {jp.job_code} · {jp.job_title}
                      </span>
                      <span
                        className={`shrink-0 font-mono text-[12px] font-bold tabular-nums ${
                          jp.net_profit_cents >= 0 ? "text-[#14532D]" : "text-[#9A2D08]"
                        }`}
                      >
                        {formatCentsEs(jp.net_profit_cents)}
                      </span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-[#EFECE4] overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          jp.net_profit_cents < 0
                            ? "chart-tangerine"
                            : idx % 3 === 2
                              ? "chart-gold"
                              : "chart-emerald"
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
              <h3 className="text-[15px] font-bold text-[#2C2621]">
                Facturas del trimestre ({quarterInvoices.length})
              </h3>
            </div>

            {quarterInvoices.length === 0 ? (
              <div className="paper-sheet rounded-2xl border border-dashed border-[#E5DFD2] bg-[#FFFDF7] p-4 text-[13px] text-[#6B6860]">
                Sin facturas emitidas en {quarter}.
              </div>
            ) : (
              <div className="paper-sheet bg-[#FFFDF7] border border-[#E5DFD2] rounded-2xl divide-y divide-dashed divide-[#E5DFD2]">
                {quarterInvoices.map((inv) => {
                  const isPaid = inv.status === "pagado";
                  const isOverdue = inv.status === "vencido";
                  return (
                    <div
                      key={inv.id}
                      className="flex items-center gap-2 pr-3 hover:bg-[#F5F1E6]/60 transition-colors"
                    >
                      <button
                        type="button"
                        data-testid={`fiscal-invoice-${inv.id}`}
                        onClick={() => {
                          if (onPreviewInvoice) {
                            onPreviewInvoice(inv.id);
                          } else {
                            onOpenInvoice?.(inv.id);
                          }
                        }}
                        className="flex min-w-0 flex-1 items-center justify-between gap-3 p-4 text-left cursor-pointer"
                      >
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-[13px] font-bold text-[#2C2621] tabular-nums">
                              {inv.invoice_number}
                            </span>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                                isPaid
                                  ? "status-emerald"
                                  : isOverdue
                                    ? "status-tangerine"
                                    : "status-mustard"
                              }`}
                            >
                              {isPaid ? "Cobrada" : isOverdue ? "Vencida" : "Pendiente"}
                            </span>
                          </div>
                          <div className="truncate text-[12px] text-[#6B6860]">
                            {inv.client_name_snapshot} ·{" "}
                            <span className="font-mono tabular-nums">{inv.issued_at_iso}</span>
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="font-mono text-[15px] font-semibold text-[#2C2621] tabular-nums">
                            {formatCentsEs(inv.total_cents)}
                          </div>
                          <div className="text-[11px] font-semibold text-[#D04B00]">
                            {onPreviewInvoice ? "Vista previa →" : "Ver detalle →"}
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
                          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#DC2626]/30 bg-[#FFFDF7] text-[#DC2626] hover:bg-[#FAD2D8] cursor-pointer"
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

          {/* Lista de tickets deducibles estilo recibo de papel dentado */}
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                data-testid="open-tickets-detail-btn"
                onClick={() => {
                  setSelectedTicketId(null);
                  setTicketsModalOpen(true);
                }}
                className="text-left text-[15px] font-bold text-[#2C2621] hover:text-[#D04B00] cursor-pointer"
              >
                Tickets deducibles ({quarterTickets.length}) · Ver todos →
              </button>
              <button
                type="button"
                onClick={() => void onQuickManualTicket()}
                className="inline-flex min-h-[38px] items-center gap-1 rounded-full bg-[#4B7094] hover:bg-[#3F5F7E] px-3 text-[12px] font-semibold text-[#FFFDF9] cursor-pointer transition-colors"
              >
                <Plus className="w-4 h-4" />
                <span>Añadir ticket</span>
              </button>
            </div>

            {quarterTickets.length === 0 ? (
              <div className="paper-sheet rounded-2xl border border-dashed border-[#E5DFD2] bg-[#FFFDF7] p-4 text-[13px] text-[#6B6860]">
                Sin tickets registrados en {quarter}.
              </div>
            ) : (
              <div className="receipt-slip my-2 border-x border-[#E5DFD2] divide-y divide-dashed divide-[#E5DFD2]">
                {quarterTickets.map((t) => (
                  <div
                    key={t.id}
                    className="flex items-center gap-2 pr-3 hover:bg-[#F5F1E6]/60 transition-colors"
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
                        <div className="text-[15px] font-semibold text-[#2C2621] truncate">
                          {t.supplier_name}
                        </div>
                        <div className="flex items-center gap-2 text-[11px] font-semibold text-[#6B6860]">
                          <span className="badge-expense rounded-full px-2 py-0.5 capitalize">
                            {t.category}
                          </span>
                          <span className="font-mono tabular-nums">
                            {t.issue_date_iso} · Base {formatCentsEs(t.base_cents)}
                          </span>
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="font-mono text-[15px] font-semibold text-[#2C2621] tabular-nums">
                          {formatCentsEs(t.total_cents)}
                        </div>
                        <div className="text-[11px] font-semibold text-[#D04B00]">
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
                        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#DC2626]/30 bg-[#FFFDF7] text-[#DC2626] hover:bg-[#FAD2D8] cursor-pointer"
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
        scheduleEntries={allScheduleEntries}
        onClose={() => setProfitModalOpen(false)}
        onOpenInvoice={onOpenInvoice}
        onPreviewInvoice={onPreviewInvoice}
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
