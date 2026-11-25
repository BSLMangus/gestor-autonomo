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
    cls: "bg-terracotta-soft text-on-primary-container border-outline-variant",
  },
  completada: {
    label: "Completada",
    cls: "bg-info-container text-on-info-container border-info/20",
  },
  firmada: {
    label: "Firmada",
    cls: "bg-success-container text-on-success-container border-emerald-free/20",
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
      className="flex flex-1 flex-col w-full max-w-full overflow-y-auto overflow-x-hidden no-scrollbar p-4 space-y-3.5 text-xs bg-surface"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-[16px] font-bold text-on-surface">
            Actas de Puesta en Marcha ({totalCount})
          </h2>
          <p className="text-[11px] text-on-surface-variant">
            Certificación interna, mediciones reglamentarias y garantía de obra.
          </p>
        </div>
        <button
          type="button"
          data-testid="actas-new-btn"
          onClick={() => setShowCreatePanel((v) => !v)}
          className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full bg-terracotta px-4 text-[12px] font-semibold text-white shadow-xs cursor-pointer"
        >
          <Plus className="h-4 w-4 shrink-0" />
          <span>Nueva Acta</span>
        </button>
      </div>

      {showCreatePanel && (
        <form
          onSubmit={(e) => void handleConfirmCreate(e)}
          data-testid="actas-create-panel"
          className="rounded-2xl border border-terracotta/30 bg-surface-container-lowest p-3.5 space-y-3 shadow-xs"
        >
          <div className="text-[13px] font-bold text-on-surface">
            Preparar nueva acta (pre-rellenado automático)
          </div>

          <div className="space-y-1">
            <span className="block text-[11px] font-semibold text-on-surface-variant">
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
                      ? "border-terracotta bg-terracotta-soft text-on-primary-container"
                      : "border-outline-variant bg-surface-container-low text-on-surface"
                  }`}
                >
                  {ESPECIALIDAD_LABELS[esp]}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="block text-[11px] font-semibold text-on-surface-variant">
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
                className="min-h-[42px] w-full rounded-xl border border-outline-variant bg-white px-2.5 text-xs text-on-surface"
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
              <span className="block text-[11px] font-semibold text-on-surface-variant">
                Titular / Cliente (opcional)
              </span>
              <select
                data-testid="actas-new-client-select"
                value={selectedClientId}
                onChange={(e) => setSelectedClientId(e.target.value)}
                className="min-h-[42px] w-full rounded-xl border border-outline-variant bg-white px-2.5 text-xs text-on-surface"
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
              className="min-h-[44px] flex-1 rounded-xl border border-outline-variant bg-surface-container-low font-semibold text-on-surface cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              data-testid="actas-confirm-create-btn"
              disabled={creating}
              className="min-h-[44px] flex-[2] rounded-xl bg-secondary font-semibold text-on-secondary disabled:opacity-50 cursor-pointer"
            >
              {creating ? "Creando acta..." : "Crear y rellenar acta"}
            </button>
          </div>
        </form>
      )}

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-on-surface-variant" />
        <input
          type="search"
          data-testid="actas-search-input"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por código ACT, obra, cliente o ubicación..."
          className="min-h-[44px] w-full rounded-2xl border border-outline-variant bg-surface-container-lowest pl-9 pr-3 text-xs text-on-surface"
        />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value || "all"}
            type="button"
            onClick={() => setStatusFilter(f.value)}
            className={`min-h-[36px] rounded-full border px-3 text-[11px] font-semibold cursor-pointer ${
              statusFilter === f.value
                ? "border-secondary bg-secondary text-on-secondary"
                : "border-outline-variant bg-surface-container-lowest text-on-surface-variant"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading && actas.length === 0 ? (
        <div className="rounded-2xl border border-outline-variant bg-surface-container-lowest p-6 text-center text-on-surface-variant">
          Cargando actas técnicas...
        </div>
      ) : actas.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-outline-variant bg-surface-container-lowest p-6 text-center space-y-2">
          <ClipboardCheck className="mx-auto h-7 w-7 text-on-surface-variant/60" />
          <div className="text-[13px] font-semibold text-on-surface">
            Todavía no hay actas registradas
          </div>
          <p className="text-[11px] text-on-surface-variant">
            Crea un acta desde aquí, desde el detalle de una Obra/Presupuesto o desde la ficha de un Cliente.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
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
                className="w-full rounded-2xl border border-outline-variant bg-surface-container-lowest p-3.5 text-left hover:border-terracotta transition-colors cursor-pointer space-y-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono text-[13px] font-bold text-on-surface">
                      {acta.codigo_acta}
                    </span>
                    <span className="rounded-full bg-surface-container px-2 py-0.5 text-[10px] font-semibold text-on-surface-variant">
                      {ESPECIALIDAD_LABELS[acta.especialidad]}
                    </span>
                  </div>
                  <span
                    className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${badge.cls}`}
                  >
                    {badge.label}
                  </span>
                </div>
                <div className="truncate text-[12px] font-semibold text-on-surface">
                  {acta.client_name || acta.job_title || "Sin cliente ni obra asignada"}
                </div>
                <div className="flex items-center justify-between gap-2 text-[11px] text-on-surface-variant">
                  <span>
                    {acta.fecha_emision_iso}
                    {acta.job_code ? ` · ${acta.job_code}` : ""}
                  </span>
                  {progressLabel && (
                    <span className="font-semibold text-on-primary-container">{progressLabel}</span>
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
