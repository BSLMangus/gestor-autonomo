import { useEffect, useState } from "react";
import type {
  ClientRow,
  JobRow,
  JobStatus,
  LocalFileBridge,
  SqliteExecutor,
} from "../../core/contracts/types";
import { ClientsRepository } from "../../core/db/repositories/clientsRepo";
import { JobsRepository } from "../../core/db/repositories/jobsRepo";
import { ScheduleRepository } from "../../core/db/repositories/scheduleRepo";
import { JobDetailDrawer } from "../directory/JobDetailDrawer";

interface JobsViewProps {
  executor: SqliteExecutor;
  fileBridge: LocalFileBridge;
  refreshTick: number;
  initialFocusJobId?: string | null;
  onStartJobQuote: (jobId: string) => Promise<void>;
  onOpenClient: (clientId: string) => void;
  onOpenQuote: (quoteId: string) => void;
  onOpenInvoice: (invoiceId: string) => void;
  onOpenTicket: (ticketId: string) => void;
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
  onStartJobQuote,
  onOpenClient,
  onOpenQuote,
  onOpenInvoice,
  onOpenTicket,
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
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (initialFocusJobId) {
      setSelectedJobId(initialFocusJobId);
    }
  }, [initialFocusJobId]);

  const loadJobs = async () => {
    const [jobsRes, clientsRes] = await Promise.all([
      new JobsRepository(executor).listPaginated({
        search: search.trim() || undefined,
        status: statusFilter || undefined,
        limit: pageLimit,
        offset: pageOffset,
      }),
      new ClientsRepository(executor).listPaginated({ limit: 100, offset: 0 }),
    ]);
    setJobs(jobsRes.items);
    setTotalCount(jobsRes.totalCount);
    setClients(clientsRes.items);
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
      const created = await new JobsRepository(executor).createDirectJob({
        title: newTitle,
        address: newAddress,
        client_id: newClientId || null,
        start_date_iso: newStartDate || null,
        end_date_iso: newEndDate || null,
      });
      if (newStartDate && newEndDate) {
        const scheduleRepo = new ScheduleRepository(executor);
        const defaults = await scheduleRepo.getWorkScheduleDefaults();
        if (defaults.auto_apply_to_jobs) {
          await scheduleRepo.generateEntriesForJobDateRange(created.id, newStartDate, newEndDate);
        }
      }
      setNewTitle("");
      setNewAddress("");
      setNewClientId("");
      setNewStartDate("");
      setNewEndDate("");
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
    <div data-testid="jobs-view" className="flex flex-1 flex-col overflow-y-auto no-scrollbar p-4 space-y-3.5 bg-surface">
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
          className="min-h-[48px] flex-1 rounded-2xl border border-outline-variant bg-surface-container-lowest px-3.5 text-[14px] text-on-surface placeholder:text-outline focus:border-terracotta focus:outline-none"
        />
        <button
          type="button"
          data-testid="jobs-new-btn"
          onClick={() => setShowNewJobForm((v) => !v)}
          className="min-h-[48px] shrink-0 rounded-2xl bg-primary hover:bg-terracotta px-4 text-[13px] font-semibold text-white shadow-xs cursor-pointer"
        >
          + Nueva obra
        </button>
      </div>

      {showNewJobForm && (
        <form
          onSubmit={(e) => void handleCreateJob(e)}
          className="rounded-[20px] border border-outline-variant bg-surface-container-lowest p-4 shadow-[0_2px_10px_rgba(15,23,42,0.04)] space-y-3 text-xs"
        >
          <div className="text-[15px] font-semibold text-on-surface">
            Abrir nuevo expediente de obra
          </div>
          <input
            type="text"
            placeholder="Título de la obra *"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            className="min-h-[44px] w-full rounded-xl border border-outline-variant bg-surface-container-low px-3 text-[13px]"
          />
          <input
            type="text"
            placeholder="Dirección / Ubicación (opcional)"
            value={newAddress}
            onChange={(e) => setNewAddress(e.target.value)}
            className="min-h-[44px] w-full rounded-xl border border-outline-variant bg-surface-container-low px-3 text-[13px]"
          />
          <select
            value={newClientId}
            onChange={(e) => setNewClientId(e.target.value)}
            className="min-h-[44px] w-full rounded-xl border border-outline-variant bg-surface-container-low px-3 text-[13px]"
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
              <span className="text-[11px] font-semibold text-on-surface-variant">
                Fecha inicio (opcional)
              </span>
              <input
                type="date"
                data-testid="jobs-new-start-date"
                value={newStartDate}
                onChange={(e) => setNewStartDate(e.target.value)}
                className="min-h-[44px] rounded-xl border border-outline-variant bg-surface-container-low px-2.5 font-mono text-[12px]"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-on-surface-variant">
                Fecha fin (opcional)
              </span>
              <input
                type="date"
                data-testid="jobs-new-end-date"
                value={newEndDate}
                onChange={(e) => setNewEndDate(e.target.value)}
                className="min-h-[44px] rounded-xl border border-outline-variant bg-surface-container-low px-2.5 font-mono text-[12px]"
              />
            </label>
          </div>
          {newStartDate && newEndDate && (
            <div className="rounded-xl border border-outline-variant bg-terracotta-soft px-3 py-2 text-[11px] font-medium text-on-primary-container">
              Si tienes activado el horario habitual, se generarán automáticamente las jornadas en el calendario.
            </div>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setShowNewJobForm(false)}
              className="min-h-[44px] rounded-xl border border-outline-variant px-4 font-semibold text-on-surface-variant cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={busy}
              className="min-h-[44px] flex-1 rounded-xl bg-secondary font-semibold text-on-secondary cursor-pointer"
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
                ? "bg-secondary text-on-secondary"
                : "bg-surface-container-lowest border border-outline-variant text-on-surface-variant"
            }`}
          >
            {st.label}
          </button>
        ))}
      </div>

      {errorMsg && (
        <div role="alert" className="rounded-2xl border border-coral-alert/30 bg-error-container p-3 text-xs text-on-error-container">
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
              className="w-full rounded-[20px] border border-outline-variant bg-surface-warm-card p-4 text-left shadow-[0_2px_10px_rgba(15,23,42,0.04)] hover:border-terracotta transition-colors cursor-pointer"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[12px] font-semibold text-on-primary-container tabular-nums">
                  {job.job_code}
                </span>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                    job.status === "en_curso"
                      ? "bg-success-container text-on-success-container"
                      : job.status === "finalizado"
                        ? "bg-surface-container text-on-surface-variant"
                        : "bg-warning-container text-on-warning-container"
                  }`}
                >
                  {job.status}
                </span>
              </div>
              <div className="mt-1.5 text-[16px] font-semibold text-on-surface">{job.title}</div>
              {(clName || job.address || job.start_date_iso) && (
                <div className="mt-1 text-[13px] text-on-surface-variant">
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
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-xs text-slate-500">
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

      <JobDetailDrawer
        jobId={selectedJobId}
        executor={executor}
        fileBridge={fileBridge}
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
