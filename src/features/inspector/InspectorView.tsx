import { useEffect, useState } from "react";
import type {
  AgentTraceRecord,
  EvalSuiteReport,
  FeedbackCorrectionRecord,
  SqliteExecutor,
} from "../../core/contracts/types";
import { CatalogRepository } from "../../core/db/repositories/catalogRepo";
import { TracesRepository } from "../../core/db/repositories/tracesRepo";
import { formatCentsEs } from "../../core/fiscal/fiscalEngine";
import { runOnDeviceEvalsSuite } from "./evalRunnerClient";

interface InspectorViewProps {
  executor: SqliteExecutor;
  refreshTick?: number;
}

function getColloquialIntentTitle(intent: string | null): string {
  switch (intent) {
    case "quote_specialist":
      return "Preparación de presupuesto";
    case "ocr_ticket_specialist":
      return "Lectura de ticket de gasto";
    case "fiscal_piggybank_specialist":
      return "Cálculo de tu Hucha Fiscal";
    case "lifecycle_billing_specialist":
      return "Facturación o envío de documento";
    case "site_log_specialist":
      return "Registro en el diario de obra";
    case "schedule_specialist":
      return "Agenda y parte de jornada";
    case "assistant_qa_node":
      return "Consulta respondida por el asistente";
    case "clarification_node":
      return "Pregunta para aclarar datos";
    default:
      return "Tarea del asistente";
  }
}

function getColloquialStatusBadge(tr: AgentTraceRecord): {
  label: string;
  classes: string;
} {
  if (tr.error_code) {
    return {
      label: "Con incidencia",
      classes: "status-tangerine",
    };
  }
  if (tr.hitl_outcome === "approved") {
    return {
      label: "Confirmado por ti",
      classes: "status-emerald",
    };
  }
  if (tr.hitl_outcome === "edited") {
    return {
      label: "Editado y confirmado por ti",
      classes: "status-emerald",
    };
  }
  if (tr.hitl_outcome === "rejected") {
    return {
      label: "Cancelado por ti",
      classes: "bg-[#EFECE4] text-[#6B6860] border border-[#E5DFD2]",
    };
  }
  if (tr.turn_phase === "pre_interrupt" || tr.hitl_outcome === "pending") {
    return {
      label: "Listo para tu confirmación",
      classes: "status-mustard",
    };
  }
  return {
    label: "Completado automáticamente",
    classes: "status-cobalt",
  };
}

function getColloquialDescription(tr: AgentTraceRecord): string {
  const speedText =
    tr.latency_ms <= 0
      ? "al instante"
      : tr.latency_ms < 1000
        ? "en menos de un segundo"
        : `en ${(tr.latency_ms / 1000).toFixed(1)} s`;

  if (tr.parent_trace_id) {
    if (tr.hitl_outcome === "rejected") {
      return `Decidiste cancelar la propuesta que había preparado el asistente (${tr.rejection_reason ?? "sin cambios guardados"}).`;
    }
    if (tr.hitl_outcome === "edited") {
      return `Revisaste y ajustaste la propuesta del asistente, y los cambios quedaron guardados ${speedText}.`;
    }
    return `Aprobaste la propuesta del asistente y se guardó definitivamente ${speedText}.`;
  }

  switch (tr.routed_intent) {
    case "quote_specialist":
      return `El asistente preparó el borrador del presupuesto con tus partidas ${speedText} para que lo revises antes de guardarlo.`;
    case "ocr_ticket_specialist":
      return `El asistente leyó los importes y el IVA del ticket ${speedText} para que confirmes antes de archivarlo.`;
    case "fiscal_piggybank_specialist":
      return `El asistente calculó cuánto debes apartar para impuestos y cuánto dinero libre tienes ${speedText}.`;
    case "lifecycle_billing_specialist":
      if (tr.turn_phase === "pre_interrupt") {
        return `El asistente dejó preparada la factura o el envío ${speedText} esperando tu visto bueno.`;
      }
      return `El asistente gestionó el paso de facturación o envío ${speedText}.`;
    case "site_log_specialist":
      return `El asistente preparó la nota y la foto para tu diario de obra ${speedText}.`;
    case "schedule_specialist":
      return `El asistente preparó el parte de horas o planificación en calendario ${speedText}.`;
    case "assistant_qa_node":
      return `El asistente buscó en tus obras, facturas o tarifario y te respondió ${speedText}.`;
    case "clarification_node":
      return `El asistente te mostró varias opciones para confirmar a qué obra o acción te referías.`;
    default:
      return `El asistente procesó tu petición ${speedText}.`;
  }
}

export function InspectorView({ executor, refreshTick = 0 }: InspectorViewProps) {
  const [traces, setTraces] = useState<AgentTraceRecord[]>([]);
  const [feedbacks, setFeedbacks] = useState<FeedbackCorrectionRecord[]>([]);
  const [quoteCodeById, setQuoteCodeById] = useState<Record<string, string>>({});
  const [evalReport, setEvalReport] = useState<EvalSuiteReport | null>(null);
  const [evalRunning, setEvalRunning] = useState(false);
  const [evalError, setEvalError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const [tr, fb, quotes] = await Promise.all([
        new TracesRepository(executor).listTraces(undefined, 80),
        new CatalogRepository(executor).listFeedbackCorrections(50),
        executor.query<{ id: string; quote_code: string }>(`SELECT id, quote_code FROM quotes`),
      ]);
      if (active) {
        setTraces(tr);
        setFeedbacks(fb);
        const map: Record<string, string> = {};
        for (const q of quotes) {
          map[q.id] = q.quote_code;
        }
        setQuoteCodeById(map);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [executor, refreshTick]);

  const handleRunEvals = async () => {
    setEvalRunning(true);
    setEvalError(null);
    try {
      const rep = await runOnDeviceEvalsSuite();
      setEvalReport(rep);
    } catch (err) {
      setEvalError(err instanceof Error ? err.message : String(err));
    } finally {
      setEvalRunning(false);
    }
  };

  return (
    <div
      data-testid="inspector-view"
      className="flex flex-1 flex-col overflow-y-auto no-scrollbar p-4 space-y-4 text-xs cotton-paper text-[#2C2621]"
    >
      {/* Cabecera explicativa en lenguaje claro */}
      <section className="paper-sheet rounded-2xl border border-[#E5DFD2] bg-[#FFFDF7] p-4 space-y-1">
        <h2 className="font-sans text-[16px] font-bold text-[#2C2621]">
          Actividad y Aprendizaje del Asistente
        </h2>
        <p className="text-[12px] leading-relaxed text-[#6B6860]">
          Aquí puedes consultar en palabras sencillas cada gestión que ha preparado el asistente por ti y los precios que ha aprendido cuando corriges un presupuesto.
        </p>
      </section>

      {/* Precios aprendidos en tu Tarifario */}
      <section className="ruled-notebook rounded-2xl border border-[#E5DFD2] p-4 pl-9 space-y-2">
        <div
          className="absolute left-2.5 top-0 bottom-0 flex flex-col justify-around py-3 pointer-events-none"
          aria-hidden="true"
        >
          <span className="w-2.5 h-2.5 rounded-full paper-hole border shadow-inner" />
          <span className="w-2.5 h-2.5 rounded-full paper-hole border shadow-inner" />
        </div>
        <div>
          <h3 className="text-sm font-bold text-[#2C2621]">
            Precios aprendidos en tu tarifario ({feedbacks.length})
          </h3>
          <p className="text-[11px] text-[#6B6860]">
            Cuando cambias un precio al revisar un presupuesto y marcas guardarlo, el asistente recuerda el nuevo precio para la próxima vez.
          </p>
        </div>
        {feedbacks.length === 0 ? (
          <div className="text-[#6B6860]">Aún no has modificado precios del tarifario.</div>
        ) : (
          feedbacks.map((fb) => {
            const humanQuoteCode = fb.quote_id ? quoteCodeById[fb.quote_id] : null;
            return (
              <div
                key={fb.id}
                data-testid={`feedback-row-${fb.id}`}
                className="flex items-center justify-between rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-2.5 py-2"
              >
                <div className="min-w-0 pr-2">
                  <div className="truncate font-bold text-[#2C2621]">{fb.item_description}</div>
                  <div className="font-mono text-[11px] text-[#6B6860]">
                    {humanQuoteCode
                      ? `Actualizado en presupuesto ${humanQuoteCode}`
                      : "Actualizado automáticamente en tu tarifario"}
                  </div>
                </div>
                <div className="shrink-0 font-mono font-bold text-[#2C2621] tabular-nums">
                  {formatCentsEs(fb.old_unit_price_cents)} →{" "}
                  <span className="text-[#D04B00]">{formatCentsEs(fb.new_unit_price_cents)}</span>
                </div>
              </div>
            );
          })
        )}
      </section>

      {/* Historial de acciones del asistente en lenguaje coloquial */}
      <section className="ruled-notebook rounded-2xl border border-[#E5DFD2] p-4 pl-9 space-y-2">
        <div
          className="absolute left-2.5 top-0 bottom-0 flex flex-col justify-around py-3 pointer-events-none"
          aria-hidden="true"
        >
          <span className="w-2.5 h-2.5 rounded-full paper-hole border shadow-inner" />
          <span className="w-2.5 h-2.5 rounded-full paper-hole border shadow-inner" />
        </div>
        <div>
          <h3 className="text-sm font-bold text-[#2C2621]">
            Historial de tareas del asistente ({traces.length})
          </h3>
          <p className="text-[11px] text-[#6B6860]">
            Resumen paso a paso de lo que ha ido preparando o confirmando el asistente.
          </p>
        </div>

        <div className="space-y-2">
          {traces.length === 0 ? (
            <div className="text-[#6B6860]">Todavía no hay actividad registrada.</div>
          ) : (
            traces.map((tr) => {
              const badge = getColloquialStatusBadge(tr);
              const dateLabel = new Date(tr.created_at_ms).toLocaleString("es-ES", {
                day: "2-digit",
                month: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              });

              return (
                <div
                  key={tr.trace_id}
                  data-testid={`trace-row-${tr.trace_id}`}
                  className="rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] p-3 space-y-1.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-bold text-[#2C2621]">
                      {getColloquialIntentTitle(tr.routed_intent)}
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${badge.classes}`}
                    >
                      {badge.label}
                    </span>
                  </div>
                  <p className="text-[11px] leading-relaxed text-[#6B6860]">
                    {getColloquialDescription(tr)}
                  </p>
                  <div className="font-mono text-[10px] text-[#6B6860] tabular-nums">
                    {dateLabel}
                    {tr.rag_snippets.length > 0
                      ? ` · Consultó ${tr.rag_snippets.length} dato(s) de tu negocio`
                      : ""}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* Comprobación rápida de funcionamiento */}
      <section className="paper-sheet rounded-2xl border border-[#E5DFD2] bg-[#FFFDF7] p-4 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-[#2C2621]">
              Comprobación del asistente
            </h3>
            <p className="text-[11px] text-[#6B6860]">
              Verifica automáticamente que los cálculos de IVA, búsquedas y presupuestos funcionan bien.
            </p>
          </div>
          <button
            type="button"
            data-testid="run-evals-btn"
            disabled={evalRunning}
            onClick={() => void handleRunEvals()}
            className="min-h-10 shrink-0 rounded-xl bg-[#4B7094] hover:bg-[#3F5F7E] px-3 font-bold text-[#FFFDF9] disabled:opacity-50 cursor-pointer transition-colors"
          >
            {evalRunning ? "Comprobando..." : "Comprobar ahora"}
          </button>
        </div>

        {evalError && (
          <div role="alert" className="rounded-xl border border-[#DC2626]/30 bg-[#FAD2D8] p-2 text-[#5A121C]">
            {evalError}
          </div>
        )}

        {evalReport && (
          <div data-testid="eval-report-panel" className="space-y-2 pt-1">
            <div className="flex items-center justify-between rounded-xl border border-[#E5DFD2] bg-[#F5F1E6] px-3 py-2 font-bold">
              <span data-testid="eval-summary-score" className="font-mono tabular-nums">
                {evalReport.passed} / {evalReport.total_cases} PASS ({evalReport.duration_ms} ms)
              </span>
              <span className="text-[#14532D]">Todo comprobado</span>
            </div>

            <div className="space-y-1">
              {evalReport.results.map((r) => (
                <div
                  key={r.id}
                  data-testid={`eval-case-${r.id}`}
                  className={`flex items-start justify-between gap-2 rounded-lg border px-2.5 py-1.5 ${
                    r.passed
                      ? "border-[#1E8E5A]/30 bg-[#D4EDDA]/60"
                      : "border-[#DC2626]/30 bg-[#FAD2D8]"
                  }`}
                >
                  <div className="min-w-0">
                    <div className="font-bold text-[#2C2621]">{r.details}</div>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                      r.passed ? "bg-[#1E8E5A] text-[#FFFDF9]" : "bg-[#DC2626] text-[#FFFDF9]"
                    }`}
                  >
                    {r.passed ? "OK" : "Revisar"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
