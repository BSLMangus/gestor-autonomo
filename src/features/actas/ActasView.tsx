import { ClipboardCheck, Plus, Search } from "lucide-react";
import { useEffect, useState } from "react";
import type {
  ActaPuestaEnMarchaData,
  ClientRow,
  EspecialidadActa,
  EstadoActa,
  JobRow,
  SqliteExecutor,
} from "../../core/contracts/types";
import {
  ActasRepository,
  type ActaWithContextSummary,
} from "../../core/db/repositories/actasRepo";
import { ClientsRepository } from "../../core/db/repositories/clientsRepo";
import { JobsRepository } from "../../core/db/repositories/jobsRepo";
import { computeActaCompletion } from "./actaTemplates";

interface ActasViewProps {
  executor: SqliteExecutor;
  refreshTick: number;
  onOpenActa: (actaId: string) => void;
  onCreateActa: (params?: {
    jobId?: string | null;
    quoteId?: string | null;
    clientId?: string | null;
    especialidad?: EspecialidadActa;
  }) => Promise<void>;
}

const STATUS_BADGE: Record<EstadoActa, { label: string; cls: string }> = {
  borrador: {
    label: "Borrador",
    cls: "paper-stamp status-tangerine",
  },
  completada: {
    label: "Completada",
    cls: "paper-stamp status-cobalt",
  },
  firmada: {
    label: "Firmada",
    cls: "paper-stamp status-emerald",
  },
};

const ESPECIALIDAD_LABELS: Record<EspecialidadActa, string> = {
  electricidad: "Electricidad",
  fontaneria: "Fontanería",
  mixta: "Mixta",
};

const STATUS_FILTERS: Array<{ value: "" | EstadoActa; label: string }> = [
  { value: "", label: "Todas" },
  { value: "borrador", label: "Borradores" },
  { value: "completada", label: "Completadas" },
  { value: "firmada", label: "Firmadas" },
];

export function ActasView({
  executor,
  refreshTick,
  onOpenActa,
  onCreateActa,
}: ActasViewProps) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | EstadoActa>("");
  const [actas, setActas] = useState<ActaWithContextSummary[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const [showCreatePanel, setShowCreatePanel] = useState(false);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [selectedEsp, setSelectedEsp] = useState<EspecialidadActa>("electricidad");
  const [selectedJobId, setSelectedJobId] = useState("");
  const [selectedClientId, setSelectedClientId] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      try {
        const res = await new ActasRepository(executor).listPaginated({
          search: search.trim() || undefined,
          estado: statusFilter || undefined,
          limit: 50,
          offset: 0,
        });
        if (!active) return;
        setActas(res.items);
        setTotalCount(res.totalCount);
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [executor, search, statusFilter, refreshTick]);

  useEffect(() => {
    if (!showCreatePanel) return;
    let active = true;
    Promise.all([
      new JobsRepository(executor).listPaginated({ limit: 80, offset: 0 }),
      new ClientsRepository(executor).listPaginated({ limit: 80, offset: 0 }),
    ])
      .then(([jobsRes, clientsRes]) => {
        if (!active) return;
        setJobs(jobsRes.items);
        setClients(clientsRes.items);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [executor, showCreatePanel]);

  const handleConfirmCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      await onCreateActa({
        jobId: selectedJobId || null,
        clientId: selectedClientId || null,
        especialidad: selectedEsp,
      });
    } finally {
      setCreating(false);
    }
  };

  return (
    <div
      data-testid="actas-view"
      className="flex flex-1 flex-col w-full max-w-full overflow-y-auto overflow-x-hidden no-scrollbar p-4 space-y-3.5 text-xs font-sans cotton-paper bg-[#F9F7F2] text-[#2C2621]"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-[16px] font-bold text-[#2C2621]">
            Actas de Puesta en Marcha (<span className="font-mono-nums">{totalCount}</span>)
          </h2>
          <p className="text-[11px] text-[#6B6860]">
            Certificación interna, mediciones reglamentarias y garantía de obra.
          </p>
        </div>
        <button
          type="button"
          data-testid="actas-new-btn"
          onClick={() => setShowCreatePanel((v) => !v)}
          className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full bg-[#EA580C] hover:bg-[#D04B00] px-4 text-[12px] font-semibold text-white shadow-xs cursor-pointer transition-colors"
        >
          <Plus className="h-4 w-4 shrink-0" />
          <span>Nueva Acta</span>
        </button>
      </div>

      {showCreatePanel && (
        <form
          onSubmit={(e) => void handleConfirmCreate(e)}
          data-testid="actas-create-panel"
          className="ruled-notebook rounded-2xl border border-[#E5DFD2] bg-[#FFFDF7] p-3.5 space-y-3"
        >
          <div className="text-[13px] font-bold text-[#2C2621]">
            Preparar nueva acta (pre-rellenado automático)
          </div>

          <div className="space-y-1">
            <span className="block text-[11px] font-semibold text-[#6B6860]">
              Especialidad técnica
            </span>
            <div className="grid grid-cols-3 gap-1.5">
              {(["electricidad", "fontaneria", "mixta"] as const).map((esp) => (
                <button
                  key={esp}
                  type="button"
                  data-testid={`actas-new-esp-${esp}`}
                  onClick={() => setSelectedEsp(esp)}
                  className={`min-h-[42px] rounded-xl border px-2 text-[12px] font-semibold cursor-pointer ${
                    selectedEsp === esp
                      ? "border-[#EA580C] bg-[#FFD6B0] text-[#4A2500]"
                      : "border-[#E5DFD2] bg-[#F5F1E6] text-[#2C2621]"
                  }`}
                >
                  {ESPECIALIDAD_LABELS[esp]}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="block text-[11px] font-semibold text-[#6B6860]">
                Vincular a Obra (opcional)
              </span>
              <select
                data-testid="actas-new-job-select"
                value={selectedJobId}
                onChange={(e) => {
                  const nextJobId = e.target.value;
                  setSelectedJobId(nextJobId);
                  const found = jobs.find((j) => j.id === nextJobId);
                  if (found?.client_id) {
                    setSelectedClientId(found.client_id);
                  }
                }}
                className="min-h-[42px] w-full rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-2.5 text-xs text-[#2C2621] focus:border-[#EA580C] focus:outline-none"
              >
                <option value="">Sin obra vinculada</option>
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.job_code} · {j.title}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1">
              <span className="block text-[11px] font-semibold text-[#6B6860]">
                Titular / Cliente (opcional)
              </span>
              <select
                data-testid="actas-new-client-select"
                value={selectedClientId}
                onChange={(e) => setSelectedClientId(e.target.value)}
                className="min-h-[42px] w-full rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-2.5 text-xs text-[#2C2621] focus:border-[#EA580C] focus:outline-none"
              >
                <option value="">Sin cliente (podrás crearlo dentro)</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.nif ? ` (${c.nif})` : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setShowCreatePanel(false)}
              className="min-h-[44px] flex-1 rounded-xl border border-[#E5DFD2] bg-[#F5F1E6] font-semibold text-[#2C2621] cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              data-testid="actas-confirm-create-btn"
              disabled={creating}
              className="min-h-[44px] flex-[2] rounded-xl bg-[#4B7094] font-semibold text-[#FFFDF9] disabled:opacity-50 cursor-pointer"
            >
              {creating ? "Creando acta..." : "Crear y rellenar acta"}
            </button>
          </div>
        </form>
      )}

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6B6860]" />
        <input
          type="search"
          data-testid="actas-search-input"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por código ACT, obra, cliente o ubicación..."
          className="min-h-[44px] w-full rounded-2xl border border-[#E5DFD2] bg-[#FFFDF7] pl-9 pr-3 text-xs text-[#2C2621] placeholder:text-[#6B6860] focus:border-[#EA580C] focus:outline-none"
        />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value || "all"}
            type="button"
            onClick={() => setStatusFilter(f.value)}
            className={`min-h-[36px] rounded-full border px-3 text-[11px] font-semibold cursor-pointer transition-colors ${
              statusFilter === f.value
                ? "border-[#4B7094] bg-[#4B7094] text-[#FFFDF9]"
                : "border-[#E5DFD2] bg-[#FFFDF7] text-[#6B6860]"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading && actas.length === 0 ? (
        <div className="paper-sheet rounded-2xl border border-[#E5DFD2] bg-[#FFFDF7] p-6 text-center text-[#6B6860]">
          Cargando actas técnicas...
        </div>
      ) : actas.length === 0 ? (
        <div className="paper-sheet rounded-2xl border border-dashed border-[#E5DFD2] bg-[#FFFDF7] p-6 text-center space-y-2">
          <ClipboardCheck className="mx-auto h-7 w-7 text-[#6B6860]/70" />
          <div className="text-[13px] font-semibold text-[#2C2621]">
            Todavía no hay actas registradas
          </div>
          <p className="text-[11px] text-[#6B6860]">
            Crea un acta desde aquí, desde el detalle de una Obra/Presupuesto o desde la ficha de un Cliente.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {actas.map((acta) => {
            const badge = STATUS_BADGE[acta.estado];
            let progressLabel = "";
            try {
              const parsed = JSON.parse(acta.datos_json) as ActaPuestaEnMarchaData;
              const comp = computeActaCompletion(parsed, {
                cliente: acta.firma_cliente_base64,
                instalador: acta.firma_instalador_base64,
              });
              progressLabel = `${comp.completedBlocks}/${comp.totalBlocks} bloques`;
            } catch {
              progressLabel = "";
            }
            return (
              <button
                key={acta.id}
                type="button"
                data-testid={`acta-list-item-${acta.id}`}
                onClick={() => onOpenActa(acta.id)}
                className="paper-sheet w-full rounded-2xl border border-[#E5DFD2] bg-[#FFFDF7] p-3.5 text-left hover:border-[#EA580C] transition-colors cursor-pointer space-y-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono-nums text-[13px] font-bold text-[#2C2621]">
                      {acta.codigo_acta}
                    </span>
                    <span className="rounded-full border border-[#E5DFD2] bg-[#EFECE4] px-2 py-0.5 text-[10px] font-semibold text-[#6B6860]">
                      {ESPECIALIDAD_LABELS[acta.especialidad]}
                    </span>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-bold ${badge.cls}`}
                  >
                    {badge.label}
                  </span>
                </div>
                <div className="truncate text-[12px] font-semibold text-[#2C2621]">
                  {acta.client_name || acta.job_title || "Sin cliente ni obra asignada"}
                </div>
                <div className="flex items-center justify-between gap-2 text-[11px] text-[#6B6860]">
                  <span className="font-mono-nums">
                    {acta.fecha_emision_iso}
                    {acta.job_code ? ` · ${acta.job_code}` : ""}
                  </span>
                  {progressLabel && (
                    <span className="font-mono-nums font-semibold text-[#4A2500]">{progressLabel}</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
