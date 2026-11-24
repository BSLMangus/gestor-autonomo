import { useEffect, useState } from "react";
import {
  patchSiteLogByVoice,
  type SiteLogFormState,
  type VoiceDisambiguationPayload,
} from "../../../agent/voiceFormPatcher";
import { TEXT_LIMITS } from "../../../core/contracts/textLimits";
import type {
  ActiveWidgetEnvelope,
  JobRow,
  SiteLogCategory,
} from "../../../core/contracts/types";
import { useRegisterOverlayVoice } from "../../../ui/overlayVoiceContext";
import { ZoomableTextField } from "../../../ui/ZoomableTextField";
import { JobsRepository } from "../../../core/db/repositories/jobsRepo";
import type { WidgetCommonProps } from "./widgetTypes";

type SiteLogWidget = Extract<ActiveWidgetEnvelope, { ui_widget_type: "SiteLogStampWidget" }>;

const CATEGORIES: SiteLogCategory[] = ["antes", "despues", "nota"];

export function SiteLogStampWidget({ widget, runtime }: WidgetCommonProps) {
  const sl = (widget as SiteLogWidget).widget_payload;

  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string>(sl.candidate_job_id ?? "");
  const [createNewJob, setCreateNewJob] = useState<boolean>(sl.candidate_job_id === null);
  const [newJobTitle, setNewJobTitle] = useState("");
  const [newJobAddress, setNewJobAddress] = useState("");
  const [category, setCategory] = useState<SiteLogCategory>(sl.category);
  const [noteText, setNoteText] = useState(sl.note_text);
  const [mediaUri, setMediaUri] = useState<string | null>(sl.raw_media_uri);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [savedBanner, setSavedBanner] = useState<string | null>(null);
  const [undoStack, setUndoStack] = useState<SiteLogFormState[]>([]);
  const [voiceChanges, setVoiceChanges] = useState<string[]>([]);
  const [voiceWarnings, setVoiceWarnings] = useState<string[]>([]);
  const [voiceDisambig, setVoiceDisambig] = useState<VoiceDisambiguationPayload | null>(null);

  const initialSlJson = JSON.stringify(sl);

  useEffect(() => {
    setSelectedJobId(sl.candidate_job_id ?? "");
    setCreateNewJob(sl.candidate_job_id === null);
    setCategory(sl.category);
    setNoteText(sl.note_text);
    setMediaUri(sl.raw_media_uri);
    setErrorMsg(null);
    setSavedBanner(null);
    setUndoStack([]);
    setVoiceChanges([]);
    setVoiceWarnings([]);
    setVoiceDisambig(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSlJson]);

  const applySiteLogState = (st: SiteLogFormState) => {
    setSelectedJobId(st.selectedJobId);
    setCreateNewJob(st.createNewJob);
    setNewJobTitle(st.newJobTitle);
    setNewJobAddress(st.newJobAddress);
    setCategory(st.category);
    setNoteText(st.noteText);
  };

  useRegisterOverlayVoice({
    enabled: !busy && !savedBanner,
    title: "Dictar nota de diario",
    placeholder: "Ej: Categoría después, alicatado terminado sin incidencias",
    examples: [
      "Categoría antes, revisando bajante antigua",
      "Añade en notas que falta rematar la silicona",
      "Categoría después en la obra de Marta",
    ],
    buttonLabel: "Dictar diario",
    lastChanges: voiceChanges,
    lastWarnings: voiceWarnings,
    canUndo: undoStack.length > 0,
    onUndo: () => {
      const prev = undoStack[undoStack.length - 1];
      if (!prev) return;
      setUndoStack((s) => s.slice(0, -1));
      applySiteLogState(prev);
      setVoiceChanges(["Último dictado deshecho"]);
      setVoiceWarnings([]);
      setVoiceDisambig(null);
    },
    disambiguation: voiceDisambig
      ? {
          prompt: voiceDisambig.prompt,
          options: voiceDisambig.options,
          onSelect: (id) => {
            const snapshot: SiteLogFormState = {
              selectedJobId,
              createNewJob,
              newJobTitle,
              newJobAddress,
              category,
              noteText,
            };
            setUndoStack((s) => [...s.slice(-9), snapshot]);
            setCreateNewJob(false);
            setSelectedJobId(id);
            const hit = jobs.find((j) => j.id === id);
            setVoiceChanges([hit ? `Obra: ${hit.job_code}` : "Obra seleccionada"]);
            setVoiceWarnings([]);
            setVoiceDisambig(null);
          },
          onDismiss: () => setVoiceDisambig(null),
        }
      : null,
    onTranscript: async (text) => {
      const snapshot: SiteLogFormState = {
        selectedJobId,
        createNewJob,
        newJobTitle,
        newJobAddress,
        category,
        noteText,
      };
      const res = await patchSiteLogByVoice(snapshot, text, {
        executor: runtime.executor,
        inferenceAdapter: runtime.inferenceAdapter,
      });
      if (res.changed) {
        setUndoStack((s) => [...s.slice(-9), snapshot]);
        applySiteLogState(res.nextState);
        setVoiceChanges(res.appliedChanges);
        setVoiceWarnings(res.warnings);
      } else if (!res.disambiguation) {
        setVoiceChanges([]);
        setVoiceWarnings(["No detecté cambios claros para el diario."]);
      }
      setVoiceDisambig(res.disambiguation ?? null);
    },
  });

  useEffect(() => {
    let active = true;
    new JobsRepository(runtime.executor)
      .listAll()
      .then((rows) => {
        if (active) {
          const filtered = rows.filter((j) => j.status !== "cancelado");
          setJobs(filtered);
          if (!sl.candidate_job_id && filtered.length > 0 && !createNewJob) {
            setSelectedJobId(filtered[0]!.id);
          }
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime.executor]);

  useEffect(() => {
    let revoker: (() => void) | null = null;
    let active = true;
    if (!mediaUri) {
      setPreviewUrl(null);
      return;
    }
    runtime.fileBridge
      .resolveDisplayUrl(mediaUri)
      .then((res) => {
        if (!active) {
          res?.revoke();
          return;
        }
        revoker = res?.revoke ?? null;
        setPreviewUrl(res?.url ?? null);
      })
      .catch(() => {
        if (active) setPreviewUrl(null);
      });
    return () => {
      active = false;
      revoker?.();
    };
  }, [runtime.fileBridge, mediaUri]);

  const handleCapturePhoto = async () => {
    setErrorMsg(null);
    const res = runtime.onCapturePhoto
      ? await runtime.onCapturePhoto("site_log", selectedJobId || null)
      : await runtime.cameraAdapter.captureOrPick("site_log", null, selectedJobId || null);

    if (res.status === "ok") {
      setMediaUri(res.media_uri);
    } else if (res.status === "permission_denied") {
      setErrorMsg("Permiso de cámara denegado. Puedes guardar el diario solo con texto.");
    } else if (res.status === "error") {
      setErrorMsg(res.reason);
    }
  };

  const handleCancelNewJob = async () => {
    if (mediaUri) {
      await runtime.fileBridge.deleteIfTemp(mediaUri);
      setMediaUri(null);
    }
    setCreateNewJob(false);
    setNewJobTitle("");
    setNewJobAddress("");
    setErrorMsg(null);
  };

  const handleDiscardWidget = async () => {
    setErrorMsg(null);
    if (mediaUri) {
      await runtime.fileBridge.deleteIfTemp(mediaUri).catch(() => undefined);
    }
    runtime.onDismissOverlay?.();
  };

  const handleSave = async () => {
    setErrorMsg(null);
    setBusy(true);
    try {
      const payload = createNewJob
        ? {
            job_id: null,
            new_job: {
              title: newJobTitle.trim(),
              address: newJobAddress.trim(),
            },
            category,
            note_text: noteText.trim(),
            raw_media_uri: mediaUri,
          }
        : {
            job_id: selectedJobId || null,
            category,
            note_text: noteText.trim(),
            raw_media_uri: mediaUri,
          };

      const saved = await runtime.siteLogService.commitSiteLog(payload);
      setSavedBanner(`Guardado en diario de ${saved.jobCode} (${category})`);
      setMediaUri(null);
      await runtime.onDataMutated?.();
      runtime.onSiteLogSaved?.(saved.siteLog, saved.jobCode);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const activeJobObj = jobs.find((j) => j.id === selectedJobId) ?? null;

  return (
    <section
      data-testid="sitelog-stamp-widget"
      className="mt-2 rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm text-slate-900 space-y-3"
    >
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
        <div>
          <span className="inline-flex items-center rounded-full bg-sky-100 px-2.5 py-0.5 text-[11px] font-semibold text-sky-900">
            Diario de Obra · Sello Local
          </span>
          <h3 className="mt-1 text-sm font-bold text-slate-900">
            {createNewJob
              ? "Nueva obra rápida + entrada diario"
              : activeJobObj
                ? `${activeJobObj.job_code} · ${activeJobObj.title}`
                : "Registrar avance o nota técnica"}
          </h3>
        </div>
      </div>

      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-700">Obra destino</span>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (createNewJob) {
                void handleCancelNewJob();
              } else {
                setCreateNewJob(true);
              }
            }}
            className="text-xs font-semibold text-orange-700"
          >
            {createNewJob ? "Usar obra existente" : "+ Crear obra rápida"}
          </button>
        </div>

        {!createNewJob ? (
          <select
            aria-label="Seleccionar obra para diario"
            data-testid="sitelog-job-select"
            disabled={busy}
            value={selectedJobId}
            onChange={(e) => setSelectedJobId(e.target.value)}
            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs"
          >
            <option value="">-- Seleccionar obra --</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.job_code} · {j.title}
              </option>
            ))}
          </select>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-2.5 space-y-2">
            <input
              type="text"
              data-testid="sitelog-new-job-title"
              disabled={busy}
              placeholder="Título de nueva obra *"
              value={newJobTitle}
              onChange={(e) => setNewJobTitle(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
            />
            <ZoomableTextField
              as="input"
              multiline={false}
              maxLength={TEXT_LIMITS.ADDRESS}
              zoomLabel="Dirección de la obra"
              data-testid="sitelog-new-job-address"
              disabled={busy}
              placeholder="Dirección / Ubicación (opcional)"
              value={newJobAddress}
              onValueChange={setNewJobAddress}
              className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
            />
          </div>
        )}

        <div className="flex flex-wrap gap-1.5">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              data-testid={`sitelog-cat-${cat}`}
              disabled={busy}
              onClick={() => setCategory(cat)}
              className={`min-h-9 rounded-xl px-3 text-xs font-bold capitalize ${
                category === cat
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-700"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700" htmlFor="sl-note">
            Nota técnica de obra
          </label>
          <ZoomableTextField
            id="sl-note"
            as="textarea"
            multiline
            maxLength={TEXT_LIMITS.NOTES}
            zoomLabel="Nota técnica de obra"
            data-testid="sitelog-note-input"
            rows={2}
            disabled={busy}
            value={noteText}
            onValueChange={setNoteText}
            placeholder="Describe el avance, materiales o estado observado..."
            className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-xs"
          />
        </div>

        {previewUrl && (
          <div className="relative overflow-hidden rounded-xl border border-slate-200">
            <img src={previewUrl} alt="Foto de diario" className="max-h-40 w-full object-cover" />
            <div className="bg-slate-900/85 px-2.5 py-1 text-[10px] font-semibold text-white">
              GESTOR AUTÓNOMO · {activeJobObj?.job_code ?? (newJobTitle || "NUEVA OBRA")} ·{" "}
              {sl.stamp_preview_meta.timestamp_iso}
            </div>
          </div>
        )}

        {errorMsg && (
          <div role="alert" className="rounded-xl border border-rose-300 bg-rose-50 p-2 text-xs text-rose-800">
            {errorMsg}
          </div>
        )}

        {savedBanner && (
          <div
            data-testid="sitelog-saved-banner"
            className="rounded-xl border border-emerald-300 bg-emerald-50 p-2 text-xs font-semibold text-emerald-900"
          >
            {savedBanner}
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            data-testid="sitelog-cancel-btn"
            disabled={busy}
            onClick={() => void handleDiscardWidget()}
            className="min-h-12 rounded-xl border border-rose-300 bg-white px-3.5 text-xs font-bold text-rose-700"
          >
            Descartar
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleCapturePhoto()}
            className="min-h-12 rounded-xl border border-slate-300 bg-white px-3 text-xs font-bold text-slate-800"
          >
            {mediaUri ? "Cambiar foto" : "Adjuntar foto"}
          </button>
          <button
            type="button"
            data-testid="sitelog-save-btn"
            disabled={busy || Boolean(savedBanner)}
            onClick={() => void handleSave()}
            className="min-h-12 flex-1 rounded-xl bg-sky-700 px-4 text-sm font-bold text-white shadow-sm disabled:opacity-50"
          >
            {busy ? "Sellando y guardando..." : savedBanner ? "Guardado" : "Guardar en diario"}
          </button>
        </div>
      </div>
    </section>
  );
}
