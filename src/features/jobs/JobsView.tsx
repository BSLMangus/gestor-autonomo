import { useEffect, useState } from "react";
import type { LocalInferenceAdapterImpl } from "../../agent/inference/localInferenceAdapter";
import {
  patchNewJobByVoice,
  type NewJobFormState,
  type VoiceDisambiguationPayload,
} from "../../agent/voiceFormPatcher";
import { TEXT_LIMITS } from "../../core/contracts/textLimits";
import type {
  BillingModeConfig,
  ClientRow,
  JobRow,
  JobStatus,
  LocalFileBridge,
  SqliteExecutor,
  WorkScheduleDefaults,
} from "../../core/contracts/types";
import { ClientsRepository } from "../../core/db/repositories/clientsRepo";
import { JobsRepository } from "../../core/db/repositories/jobsRepo";
import {
  computeDailyWorkHoursThousandths,
  ScheduleRepository,
} from "../../core/db/repositories/scheduleRepo";
import { SettingsRepository } from "../../core/db/repositories/settingsRepo";
import type { VoiceInputAdapter } from "../../core/hardware/voiceAdapter";
import { InlineVoiceFormTrigger } from "../../ui/ContextualVoiceDock";
import { ZoomableTextField } from "../../ui/ZoomableTextField";
import { SubDayDurationPicker } from "../calendar/SubDayDurationPicker";
import { JobDetailDrawer } from "../directory/JobDetailDrawer";
import {
  BillingModeSelector,
  createDefaultBillingModeConfig,
  getBillingModeBadgeLabel,
} from "./BillingModeSelector";

const FALLBACK_SCHEDULE_DEFAULTS: WorkScheduleDefaults = {
  work_days: [1, 2, 3, 4, 5],
  morning_start: "08:00",
  morning_end: "14:00",
  afternoon_start: "15:00",
  afternoon_end: "17:00",
  auto_apply_to_jobs: true,
};

interface JobsViewProps {
  executor: SqliteExecutor;
  fileBridge: LocalFileBridge;
  refreshTick: number;
  initialFocusJobId?: string | null;
  voiceAdapter?: VoiceInputAdapter;
  inferenceAdapter?: LocalInferenceAdapterImpl;
  onStartJobQuote: (jobId: string) => Promise<void>;
  onOpenClient: (clientId: string) => void;
  onOpenQuote: (quoteId: string) => void;
  onOpenInvoice: (invoiceId: string) => void;
  onOpenTicket: (ticketId: string) => void;
  onOpenActa: (actaId: string) => void;
  onPreviewQuote?: (quoteId: string) => void;
  onPreviewInvoice?: (invoiceId: string) => void;
  onPreviewActa?: (actaId: string) => void;
  onCreateJobActa: (jobId: string, clientId: string | null) => Promise<void>;
  onDataChanged: () => Promise<void>;
  registerBackHandler: (priority: number, handler: () => boolean) => () => void;
}

const JOB_STATUSES: Array<{ value: "" | JobStatus; label: string }> = [
  { value: "", label: "Todas" },
  { value: "pendiente", label: "Pendientes" },
  { value: "en_curso", label: "En curso" },
  { value: "finalizado", label: "Finalizadas" },
  { value: "cancelado", label: "Canceladas" },
];

export function JobsView({
  executor,
  fileBridge,
  refreshTick,
  initialFocusJobId = null,
  voiceAdapter,
  inferenceAdapter,
  onStartJobQuote,
  onOpenClient,
  onOpenQuote,
  onOpenInvoice,
  onOpenTicket,
  onOpenActa,
  onPreviewQuote,
  onPreviewInvoice,
  onPreviewActa,
  onCreateJobActa,
  onDataChanged,
  registerBackHandler,
}: JobsViewProps) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | JobStatus>("");
  const [pageOffset, setPageOffset] = useState(0);
  const pageLimit = 15;

  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(initialFocusJobId);
  const [showNewJobForm, setShowNewJobForm] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [newClientId, setNewClientId] = useState("");
  const [newStartDate, setNewStartDate] = useState("");
  const [newEndDate, setNewEndDate] = useState("");
  const [scheduleDefaults, setScheduleDefaults] =
    useState<WorkScheduleDefaults>(FALLBACK_SCHEDULE_DEFAULTS);
  const [newPlanStartTime, setNewPlanStartTime] = useState(
    FALLBACK_SCHEDULE_DEFAULTS.morning_start
  );
  const [newPlanEndTime, setNewPlanEndTime] = useState(
    FALLBACK_SCHEDULE_DEFAULTS.afternoon_end
  );
  const [newPlanHoursThousandths, setNewPlanHoursThousandths] = useState<number>(8000);
  const [defaultHourlyRateCents, setDefaultHourlyRateCents] = useState<number>(3800);
  const [newBillingConfig, setNewBillingConfig] = useState<BillingModeConfig>(() =>
    createDefaultBillingModeConfig(3800)
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newJobUndoStack, setNewJobUndoStack] = useState<NewJobFormState[]>([]);
  const [newJobVoiceChanges, setNewJobVoiceChanges] = useState<string[]>([]);
  const [newJobVoiceWarnings, setNewJobVoiceWarnings] = useState<string[]>([]);
  const [newJobVoiceDisambig, setNewJobVoiceDisambig] =
    useState<VoiceDisambiguationPayload | null>(null);

  useEffect(() => {
    if (initialFocusJobId) {
      setSelectedJobId(initialFocusJobId);
    }
  }, [initialFocusJobId]);

  const loadJobs = async () => {
    const scheduleRepo = new ScheduleRepository(executor);
    const settingsRepo = new SettingsRepository(executor);
    const [jobsRes, clientsRes, defaults, appSettings] = await Promise.all([
      new JobsRepository(executor).listPaginated({
        search: search.trim() || undefined,
        status: statusFilter || undefined,
        limit: pageLimit,
        offset: pageOffset,
      }),
      new ClientsRepository(executor).listPaginated({ limit: 100, offset: 0 }),
      scheduleRepo.getWorkScheduleDefaults(),
      settingsRepo.getAppSettings(),
    ]);
    const hourlyRate = appSettings.hourly_rate_cents ?? 3800;
    setJobs(jobsRes.items);
    setTotalCount(jobsRes.totalCount);
    setClients(clientsRes.items);
    setScheduleDefaults(defaults);
    setDefaultHourlyRateCents(hourlyRate);
    if (!showNewJobForm) {
      setNewPlanStartTime(defaults.morning_start);
      setNewPlanEndTime(defaults.afternoon_end || defaults.morning_end);
      setNewPlanHoursThousandths(computeDailyWorkHoursThousandths(defaults) || 8000);
      setNewBillingConfig(createDefaultBillingModeConfig(hourlyRate));
    }
  };

  useEffect(() => {
    void loadJobs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [executor, search, statusFilter, pageOffset, refreshTick]);

  const handleCreateJob = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setBusy(true);
    try {
      const effectiveEndDate = newStartDate ? newEndDate || newStartDate : newEndDate || null;
      const created = await new JobsRepository(executor).createDirectJob({
        title: newTitle,
        address: newAddress,
        client_id: newClientId || null,
        start_date_iso: newStartDate || null,
        end_date_iso: effectiveEndDate,
        modalidad_cobro: newBillingConfig.modalidad_cobro,
        solo_mano_obra_submodo: newBillingConfig.solo_mano_obra_submodo,
        horas_estimadas_thousandths: newBillingConfig.horas_estimadas_thousandths,
        tarifa_hora_cents: newBillingConfig.tarifa_hora_cents,
        mano_obra_fija_cents: newBillingConfig.mano_obra_fija_cents,
      });
      if (newStartDate && effectiveEndDate) {
        const scheduleRepo = new ScheduleRepository(executor);
        const defaults = await scheduleRepo.getWorkScheduleDefaults();
        const isSameDay = newStartDate === effectiveEndDate;
        const fullEnd = defaults.afternoon_end || defaults.morning_end;
        const hasCustomSubDay =
          isSameDay &&
          (newPlanStartTime !== defaults.morning_start || newPlanEndTime !== fullEnd);
        if (defaults.auto_apply_to_jobs || hasCustomSubDay) {
          await scheduleRepo.generateEntriesForJobDateRange(
            created.id,
            newStartDate,
            effectiveEndDate,
            isSameDay
              ? {
                  plannedStart: newPlanStartTime,
                  plannedEnd: newPlanEndTime,
                  plannedHoursThousandths: newPlanHoursThousandths,
                }
              : undefined
          );
        }
      }
      setNewTitle("");
      setNewAddress("");
      setNewClientId("");
      setNewStartDate("");
      setNewEndDate("");
      setNewPlanStartTime(scheduleDefaults.morning_start);
      setNewPlanEndTime(scheduleDefaults.afternoon_end || scheduleDefaults.morning_end);
      setNewPlanHoursThousandths(computeDailyWorkHoursThousandths(scheduleDefaults) || 8000);
      setNewBillingConfig(createDefaultBillingModeConfig(defaultHourlyRateCents));
      setShowNewJobForm(false);
      await loadJobs();
      await onDataChanged();
      setSelectedJobId(created.id);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const clientNameById = new Map(clients.map((c) => [c.id, c.name]));

  return (
    <div data-testid="jobs-view" className="cotton-paper flex flex-1 flex-col overflow-y-auto no-scrollbar p-4 space-y-3.5 bg-[#F9F7F2] text-[#2C2621] font-sans">
      <div className="flex items-center justify-between gap-2">
        <input
          type="search"
          data-testid="jobs-search-input"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPageOffset(0);
          }}
          placeholder="Buscar por código, título o dirección..."
          className="min-h-[48px] flex-1 rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3.5 text-[14px] text-[#2C2621] placeholder:text-[#6B6860] focus:border-[#EA580C] focus:outline-none shadow-xs"
        />
        <button
          type="button"
          data-testid="jobs-new-btn"
          onClick={() => setShowNewJobForm((v) => !v)}
          className="min-h-[48px] shrink-0 rounded-xl bg-[#D04B00] hover:bg-[#EA580C] px-4 text-[13px] font-semibold text-white shadow-xs cursor-pointer transition-colors"
        >
          + Nueva obra
        </button>
      </div>

      {showNewJobForm && (
        <form
          onSubmit={(e) => void handleCreateJob(e)}
          className="paper-sheet rounded-[20px] border border-[#E5DFD2] bg-[#FFFDF7] p-4 space-y-3 text-xs"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="text-[15px] font-semibold text-[#2C2621]">
              Abrir nuevo expediente de obra
            </div>
          </div>
          <InlineVoiceFormTrigger
            voiceAdapter={voiceAdapter}
            registerBackHandler={registerBackHandler}
            testId="new-job-voice-btn"
            title="Dictar nueva obra"
            placeholder="Ej: Título Reforma cocina, cliente Elena, calle Mayor 8, del 24 al 29"
            examples={[
              "Título Reforma baño, para Elena, del 24 al 29 de este mes",
              "Dirección Av. de la Libertad 14, Madrid",
            ]}
            buttonLabel="Dictar obra"
            disabled={busy}
            lastChanges={newJobVoiceChanges}
            lastWarnings={newJobVoiceWarnings}
            canUndo={newJobUndoStack.length > 0}
            onUndo={() => {
              const prev = newJobUndoStack[newJobUndoStack.length - 1];
              if (!prev) return;
              setNewJobUndoStack((s) => s.slice(0, -1));
              setNewTitle(prev.title);
              setNewAddress(prev.address);
              setNewClientId(prev.clientId);
              setNewStartDate(prev.startDate);
              setNewEndDate(prev.endDate);
              setNewJobVoiceChanges(["Último dictado deshecho"]);
              setNewJobVoiceWarnings([]);
              setNewJobVoiceDisambig(null);
            }}
            disambiguation={
              newJobVoiceDisambig
                ? {
                    prompt: newJobVoiceDisambig.prompt,
                    options: newJobVoiceDisambig.options,
                    onSelect: (id) => {
                      const snap: NewJobFormState = {
                        title: newTitle,
                        address: newAddress,
                        clientId: newClientId,
                        startDate: newStartDate,
                        endDate: newEndDate,
                      };
                      setNewJobUndoStack((s) => [...s.slice(-9), snap]);
                      setNewClientId(id);
                      const cl = clients.find((c) => c.id === id);
                      setNewJobVoiceChanges([cl ? `Cliente: ${cl.name}` : "Cliente seleccionado"]);
                      setNewJobVoiceWarnings([]);
                      setNewJobVoiceDisambig(null);
                    },
                    onDismiss: () => setNewJobVoiceDisambig(null),
                  }
                : null
            }
            onTranscript={async (text) => {
              const snap: NewJobFormState = {
                title: newTitle,
                address: newAddress,
                clientId: newClientId,
                startDate: newStartDate,
                endDate: newEndDate,
              };
              const res = await patchNewJobByVoice(snap, text, {
                executor,
                inferenceAdapter,
              });
              if (res.changed) {
                setNewJobUndoStack((s) => [...s.slice(-9), snap]);
                setNewTitle(res.nextState.title);
                setNewAddress(res.nextState.address);
                setNewClientId(res.nextState.clientId);
                setNewStartDate(res.nextState.startDate);
                setNewEndDate(res.nextState.endDate);
                setNewJobVoiceChanges(res.appliedChanges);
                setNewJobVoiceWarnings(res.warnings);
              } else if (!res.disambiguation) {
                setNewJobVoiceChanges([]);
                setNewJobVoiceWarnings(["No detecté datos nuevos de la obra."]);
              }
              setNewJobVoiceDisambig(res.disambiguation ?? null);
            }}
          />
          <input
            type="text"
            placeholder="Título de la obra *"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            className="min-h-[44px] w-full rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 text-[13px] text-[#2C2621] placeholder:text-[#6B6860] focus:border-[#EA580C] focus:outline-none"
          />
          <ZoomableTextField
            as="input"
            multiline={false}
            maxLength={TEXT_LIMITS.ADDRESS}
            zoomLabel="Dirección de la obra"
            placeholder="Dirección / Ubicación (opcional)"
            value={newAddress}
            onValueChange={setNewAddress}
            className="min-h-[44px] w-full rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 text-[13px] text-[#2C2621] placeholder:text-[#6B6860] focus:border-[#EA580C] focus:outline-none"
          />
          <select
            value={newClientId}
            onChange={(e) => setNewClientId(e.target.value)}
            className="min-h-[44px] w-full rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 text-[13px] text-[#2C2621] focus:border-[#EA580C] focus:outline-none"
          >
            <option value="">Sin cliente vinculado todavía</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-[#6B6860]">
                Fecha inicio (opcional)
              </span>
              <input
                type="date"
                data-testid="jobs-new-start-date"
                value={newStartDate}
                onChange={(e) => {
                  const next = e.target.value;
                  setNewStartDate(next);
                  if (!newEndDate || newEndDate === newStartDate || (next && newEndDate < next)) {
                    setNewEndDate(next);
                  }
                }}
                className="min-h-[44px] rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-2.5 font-mono tabular-nums text-[12px] text-[#2C2621] focus:border-[#EA580C] focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-[#6B6860]">
                Fecha fin (opcional)
              </span>
              <input
                type="date"
                data-testid="jobs-new-end-date"
                value={newEndDate}
                onChange={(e) => setNewEndDate(e.target.value)}
                className="min-h-[44px] rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-2.5 font-mono tabular-nums text-[12px] text-[#2C2621] focus:border-[#EA580C] focus:outline-none"
              />
            </label>
          </div>
          {newStartDate && (!newEndDate || newStartDate === newEndDate) && (
            <div className="rounded-xl border border-[#E5DFD2] bg-[#F5F1E6] p-3">
              <SubDayDurationPicker
                startTime={newPlanStartTime}
                endTime={newPlanEndTime}
                defaults={scheduleDefaults}
                disabled={busy}
                onChange={(next) => {
                  setNewPlanStartTime(next.startTime);
                  setNewPlanEndTime(next.endTime);
                  setNewPlanHoursThousandths(next.hoursThousandths);
                }}
              />
            </div>
          )}
          {newStartDate && (!newEndDate || newEndDate >= newStartDate) && (
            <div className="rounded-xl border border-[#E5DFD2] bg-[#FFD6B0] px-3 py-2 text-[11px] font-medium text-[#4A2500]">
              {!newEndDate || newStartDate === newEndDate
                ? "Trabajo de un solo día o por horas: se fijará directamente en el calendario."
                : "Si tienes activado el horario habitual, se generarán automáticamente las jornadas en el calendario."}
            </div>
          )}
          <BillingModeSelector
            value={newBillingConfig}
            onChange={setNewBillingConfig}
            defaultHourlyRateCents={defaultHourlyRateCents}
            disabled={busy}
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setShowNewJobForm(false)}
              className="min-h-[44px] rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-4 font-semibold text-[#6B6860] cursor-pointer hover:border-[#EA580C]"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={busy}
              className="min-h-[44px] flex-1 rounded-xl bg-[#4B7094] font-semibold text-[#FFFDF9] cursor-pointer shadow-xs"
            >
              Crear obra
            </button>
          </div>
        </form>
      )}

      <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
        {JOB_STATUSES.map((st) => (
          <button
            key={st.value || "all"}
            type="button"
            onClick={() => {
              setStatusFilter(st.value);
              setPageOffset(0);
            }}
            className={`min-h-[40px] shrink-0 rounded-full px-3.5 text-[12px] font-semibold cursor-pointer transition-colors ${
              statusFilter === st.value
                ? "bg-[#4B7094] text-[#FFFDF9] shadow-xs"
                : "bg-[#EAE5D9] border border-[#E5DFD2] text-[#3D352E]"
            }`}
          >
            {st.label}
          </button>
        ))}
      </div>

      {errorMsg && (
        <div role="alert" className="rounded-2xl border border-[#DC2626]/30 bg-[#FAD2D8] p-3 text-xs text-[#5A121C]">
          {errorMsg}
        </div>
      )}

      <div className="space-y-3">
        {jobs.map((job) => {
          const clName = job.client_id ? clientNameById.get(job.client_id) : null;
          return (
            <button
              key={job.id}
              type="button"
              data-testid={`directory-job-${job.id}`}
              onClick={() => setSelectedJobId(job.id)}
              className="relative w-full ruled-notebook rounded-2xl border border-[#E5DFD2] p-4 pl-10 text-left hover:border-[#EA580C] transition-colors cursor-pointer"
            >
              <span className="absolute left-2.5 top-4 w-2.5 h-2.5 rounded-full paper-hole border" aria-hidden="true" />
              <span className="absolute left-2.5 bottom-4 w-2.5 h-2.5 rounded-full paper-hole border" aria-hidden="true" />
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono font-mono-nums text-[12px] font-semibold text-[#6B6860] tabular-nums">
                  {job.job_code}
                </span>
                <div className="flex items-center gap-1.5">
                  <span
                    data-testid={`job-billing-badge-${job.id}`}
                    className="rounded-full border border-[#E5DFD2] bg-[#F5F1E6] px-2 py-0.5 text-[10px] font-semibold text-[#3D352E]"
                  >
                    {getBillingModeBadgeLabel(job.modalidad_cobro, job.solo_mano_obra_submodo)}
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                      job.status === "en_curso"
                        ? "status-emerald"
                        : job.status === "finalizado"
                          ? "status-cobalt"
                          : job.status === "cancelado"
                            ? "status-tangerine"
                            : "status-gold"
                    }`}
                  >
                    {job.status}
                  </span>
                </div>
              </div>
              <div className="mt-1.5 text-[16px] font-semibold text-[#2C2621]">{job.title}</div>
              {(clName || job.address || job.start_date_iso) && (
                <div className="mt-1 text-[13px] text-[#6B6860]">
                  {clName ? `${clName}${job.address ? ` · ${job.address}` : ""}` : job.address}
                  {job.start_date_iso
                    ? ` · ${job.start_date_iso}${job.end_date_iso ? ` → ${job.end_date_iso}` : ""}`
                    : ""}
                </div>
              )}
            </button>
          );
        })}
        {jobs.length === 0 && (
          <div className="paper-sheet rounded-2xl border border-dashed border-[#E5DFD2] bg-[#FFFDF7] p-6 text-center text-xs text-[#6B6860]">
            No hay obras que coincidan con el filtro actual.
          </div>
        )}
      </div>

      {totalCount > pageLimit && (
        <div className="flex items-center justify-between pt-2 text-xs">
          <button
            type="button"
            disabled={pageOffset === 0}
            onClick={() => setPageOffset((p) => Math.max(0, p - pageLimit))}
            className="min-h-10 rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 font-semibold text-[#2C2621] disabled:opacity-40"
          >
            Anterior
          </button>
          <span className="font-mono tabular-nums text-[#6B6860]">
            {pageOffset + 1}–{Math.min(pageOffset + pageLimit, totalCount)} de {totalCount}
          </span>
          <button
            type="button"
            disabled={pageOffset + pageLimit >= totalCount}
            onClick={() => setPageOffset((p) => p + pageLimit)}
            className="min-h-10 rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 font-semibold text-[#2C2621] disabled:opacity-40"
          >
            Siguiente
          </button>
        </div>
      )}

      <JobDetailDrawer
        jobId={selectedJobId}
        executor={executor}
        fileBridge={fileBridge}
        voiceAdapter={voiceAdapter}
        inferenceAdapter={inferenceAdapter}
        onClose={() => setSelectedJobId(null)}
        onOpenClient={(cid) => {
          setSelectedJobId(null);
          onOpenClient(cid);
        }}
        onOpenQuote={(qid) => {
          setSelectedJobId(null);
          onOpenQuote(qid);
        }}
        onOpenInvoice={(iid) => {
          setSelectedJobId(null);
          onOpenInvoice(iid);
        }}
        onOpenTicket={(tid) => {
          setSelectedJobId(null);
          onOpenTicket(tid);
        }}
        onOpenActa={(aid) => {
          setSelectedJobId(null);
          onOpenActa(aid);
        }}
        onPreviewQuote={onPreviewQuote}
        onPreviewInvoice={onPreviewInvoice}
        onPreviewActa={onPreviewActa}
        onCreateJobActa={async (jid, cid) => {
          setSelectedJobId(null);
          await onCreateJobActa(jid, cid);
        }}
        onStartJobQuote={onStartJobQuote}
        onDataChanged={async () => {
          await loadJobs();
          await onDataChanged();
        }}
        registerBackHandler={registerBackHandler}
      />
    </div>
  );
}
