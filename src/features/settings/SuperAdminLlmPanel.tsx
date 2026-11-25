import { useEffect, useState } from "react";
import type { LocalInferenceAdapterImpl } from "../../agent/inference/localInferenceAdapter";
import type {
  LlmStrategyOverride,
  MemoryCoordinator,
  SqliteExecutor,
} from "../../core/contracts/types";
import { SettingsRepository } from "../../core/db/repositories/settingsRepo";
import type { CapacitorLlmAdapter, NativeLlmStatus } from "../llm/capacitorLlmAdapter";
import type { MediaPipeLlmAdapter } from "../llm/mediaPipeAdapter";
import { ANDROID_MODEL_FILENAMES, selectAndroidModelTier } from "../llm/modelCatalog";

interface SuperAdminLlmPanelProps {
  executor: SqliteExecutor;
  inferenceAdapter: LocalInferenceAdapterImpl;
  mediaPipeAdapter: MediaPipeLlmAdapter;
  capacitorLlmAdapter: CapacitorLlmAdapter;
  memoryCoordinator: MemoryCoordinator;
  onLockAdminSession: () => void;
}

const STRATEGY_OPTIONS: Array<{ value: LlmStrategyOverride; label: string }> = [
  { value: "auto", label: "Auto (iOS Apple Intelligence / Android por RAM)" },
  { value: "force_270m", label: "Forzar Android Gemma 3 270M" },
  { value: "force_1b", label: "Forzar Android Gemma 3 1B" },
  { value: "force_apple_intelligence", label: "Forzar iOS Apple Intelligence" },
  { value: "force_webgpu", label: "Forzar WebGPU (MediaPipe Web)" },
  { value: "deterministic_only", label: "Solo Motor Determinista" },
];

export function SuperAdminLlmPanel({
  executor,
  inferenceAdapter,
  mediaPipeAdapter,
  capacitorLlmAdapter,
  memoryCoordinator,
  onLockAdminSession,
}: SuperAdminLlmPanelProps) {
  const [nativeStatus, setNativeStatus] = useState<NativeLlmStatus>(() =>
    capacitorLlmAdapter.getStatus()
  );
  const [strategy, setStrategy] = useState<LlmStrategyOverride>("auto");
  const [url270m, setUrl270m] = useState("");
  const [comp270m, setComp270m] = useState("");
  const [url1b, setUrl1b] = useState("");
  const [comp1b, setComp1b] = useState("");
  const [customUri, setCustomUri] = useState("");
  const [maxTokens, setMaxTokens] = useState("512");
  const [temperatureStr, setTemperatureStr] = useState("0.1");
  const [topk, setTopk] = useState("8");

  const [testPrompt, setTestPrompt] = useState(
    "Presupuesto para Juan: 1 termo eléctrico 80L por 280 euros"
  );
  const [testOutput, setTestOutput] = useState<string | null>(null);
  const [adminMsg, setAdminMsg] = useState<string | null>(null);
  const [adminErr, setAdminErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const unsub = capacitorLlmAdapter.onStatusChange((next) => {
      setNativeStatus(next);
    });
    return unsub;
  }, [capacitorLlmAdapter]);

  useEffect(() => {
    let active = true;
    new SettingsRepository(executor)
      .getAdminLlmConfig()
      .then((cfg) => {
        if (!active) return;
        setStrategy(cfg.strategy_override);
        setUrl270m(cfg.android_270m_url);
        setComp270m(cfg.android_270m_companion_url);
        setUrl1b(cfg.android_1b_url);
        setComp1b(cfg.android_1b_companion_url);
        setCustomUri(cfg.custom_model_uri);
        setMaxTokens(String(cfg.max_tokens));
        setTemperatureStr((cfg.temperature_thousandths / 1000).toFixed(2));
        setTopk(String(cfg.topk));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [executor]);

  const saveConfig = async () => {
    const parsedTemp = Number.parseFloat(temperatureStr.replace(",", "."));
    const tempThousandths = Number.isFinite(parsedTemp)
      ? Math.max(0, Math.min(2000, Math.round(parsedTemp * 1000)))
      : 100;

    return new SettingsRepository(executor).updateAdminLlmConfig({
      strategy_override: strategy,
      android_270m_url: url270m,
      android_270m_companion_url: comp270m,
      android_1b_url: url1b,
      android_1b_companion_url: comp1b,
      custom_model_uri: customUri,
      max_tokens: Number.parseInt(maxTokens, 10) || 512,
      temperature_thousandths: tempThousandths,
      topk: Number.parseInt(topk, 10) || 8,
    });
  };

  const handleSaveOnly = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdminErr(null);
    setAdminMsg(null);
    setBusy(true);
    try {
      await saveConfig();
      setAdminMsg("Configuración Super Admin guardada en SQLite.");
    } catch (err) {
      setAdminErr(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleApplyAndDownload = async () => {
    setAdminErr(null);
    setAdminMsg(null);
    setBusy(true);
    try {
      const saved = await saveConfig();
      const repo = new SettingsRepository(executor);

      if (saved.strategy_override === "deterministic_only") {
        await memoryCoordinator.releaseLlmIfLoaded();
        inferenceAdapter.setLlmRunner(undefined);
        setAdminMsg("Modo solo determinista activado.");
        return;
      }

      if (saved.strategy_override === "force_webgpu") {
        if (!saved.custom_model_uri.trim()) {
          throw new Error("Indica una ruta custom_model_uri para WebGPU.");
        }
        await mediaPipeAdapter.initialize(saved.custom_model_uri.trim());
        inferenceAdapter.setLlmRunner(mediaPipeAdapter.createRunner());
        setAdminMsg("Modelo WebGPU cargado y conectado al adaptador.");
        return;
      }

      const ready = await capacitorLlmAdapter.initializeFromConfig(repo);
      if (ready) {
        inferenceAdapter.setLlmRunner(capacitorLlmAdapter.createRunner());
        setAdminMsg("Modelo nativo cargado y conectado al adaptador.");
      } else {
        inferenceAdapter.setLlmRunner(undefined);
        const st = capacitorLlmAdapter.getStatus();
        setAdminMsg(
          st.lastError
            ? `Fallback determinista activo (${st.lastError})`
            : "Operando con motor determinista."
        );
      }
    } catch (err) {
      setAdminErr(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteLocalModel = async () => {
    setAdminErr(null);
    setAdminMsg(null);
    setBusy(true);
    try {
      await memoryCoordinator.releaseLlmIfLoaded();
      await capacitorLlmAdapter.deleteDownloadedModel(new SettingsRepository(executor));
      inferenceAdapter.setLlmRunner(undefined);
      setAdminMsg("Modelos descargados eliminados del dispositivo.");
    } catch (err) {
      setAdminErr(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleQuickPromptTest = async () => {
    setAdminErr(null);
    setTestOutput(null);
    setBusy(true);
    try {
      const t0 = performance.now();
      const res = await inferenceAdapter.classifyAndExtract({
        text: testPrompt,
        activeJobId: null,
        activeQuoteId: null,
        pendingDisambiguation: null,
        catalogCandidates: [],
      });
      const ms = Math.round(performance.now() - t0);
      setTestOutput(
        JSON.stringify(
          {
            latency_ms: ms,
            engine_used: res.engine_used,
            intent: res.intent,
            confidence: res.confidence,
            entities: res.entities,
          },
          null,
          2
        )
      );
    } catch (err) {
      setAdminErr(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const autoTier = selectAndroidModelTier(nativeStatus.deviceRamGb);

  return (
    <section
      data-testid="superadmin-llm-panel"
      className="paper-sheet rounded-2xl border-2 border-[#8B5CF6]/40 bg-[#FFFDF7] p-3.5 text-[#2C2621] space-y-3 font-sans"
    >
      <div className="flex items-center justify-between gap-2 border-b border-[#E5DFD2] pb-2.5">
        <div>
          <span className="paper-stamp status-violet inline-flex rounded-full px-2.5 py-0.5 text-[10px] font-bold">
            SUPER ADMIN · IA Nativa
          </span>
          <h3 className="mt-1.5 text-sm font-bold text-[#2C2621]">
            Consola de Modelos Locales
          </h3>
        </div>
        <button
          type="button"
          data-testid="superadmin-logout-btn"
          onClick={onLockAdminSession}
          className="min-h-9 rounded-xl border border-[#E5DFD2] bg-[#F5F1E6] px-3 text-[11px] font-bold text-[#2C2621] cursor-pointer"
        >
          Cerrar sesión
        </button>
      </div>

      {adminMsg && (
        <div className="rounded-xl status-emerald p-2.5 text-[11px] font-semibold">
          {adminMsg}
        </div>
      )}
      {adminErr && (
        <div role="alert" className="rounded-xl border border-[#DC2626]/30 bg-[#FAD2D8] p-2.5 text-[11px] font-semibold text-[#5A121C]">
          {adminErr}
        </div>
      )}

      {/* Telemetría del dispositivo */}
      <div className="ruled-index rounded-xl border border-[#E5DFD2] p-2.5 text-[11px] space-y-1 font-mono tabular-nums text-[#2C2621]">
        <div>Plataforma: <span className="font-bold text-[#059669]">{nativeStatus.platform}</span></div>
        <div>
          RAM detectada:{" "}
          <span className="font-bold text-[#059669]">
            {nativeStatus.deviceRamGb !== undefined ? `${nativeStatus.deviceRamGb} GB` : "No reportada"}
          </span>{" "}
          · Tier Auto Android: <span className="font-bold text-[#D97706]">{ANDROID_MODEL_FILENAMES[autoTier].label}</span>
        </div>
        <div>
          Estado: <span className="font-bold text-[#4B7094]">{nativeStatus.readiness}</span> · Runner activo:{" "}
          <span className="font-bold text-[#4B7094]">{inferenceAdapter.hasLlmRunner() ? "Sí" : "No"}</span>
        </div>
        <div className="truncate text-[#6B6860]">Ruta activa: {nativeStatus.activeModelPath ?? "ninguna"}</div>
        {nativeStatus.readiness === "downloading" && nativeStatus.progress !== null && (
          <div className="pt-1">
            <div className="h-2 w-full overflow-hidden rounded-full bg-[#EFECE4]">
              <div
                className="h-full bg-[#EA580C] transition-all"
                style={{ width: `${nativeStatus.progress}%` }}
              />
            </div>
            <div className="mt-0.5 text-[10px] font-semibold text-[#4C1D95]">Descargando: {nativeStatus.progress}%</div>
          </div>
        )}
      </div>

      <form onSubmit={(e) => void handleSaveOnly(e)} className="space-y-2">
        <label className="block space-y-1">
          <span className="text-[11px] font-bold text-[#2C2621]">Estrategia activa</span>
          <select
            data-testid="superadmin-strategy-select"
            value={strategy}
            onChange={(e) => setStrategy(e.target.value as LlmStrategyOverride)}
            className="min-h-[42px] w-full rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 py-2 text-xs text-[#2C2621] focus:border-[#EA580C] focus:outline-none"
          >
            {STRATEGY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <div className="space-y-1.5">
          <span className="block text-[11px] font-bold text-[#2C2621]">
            Android Tier &lt; 8 GB (Gemma 3 270M)
          </span>
          <input
            type="url"
            placeholder="URL .task (270M)"
            value={url270m}
            onChange={(e) => setUrl270m(e.target.value)}
            className="min-h-[38px] w-full rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 py-1.5 font-mono text-xs text-[#2C2621] placeholder:text-[#6B6860] focus:border-[#EA580C] focus:outline-none"
          />
          <input
            type="url"
            placeholder="URL .litertlm opcional (270M)"
            value={comp270m}
            onChange={(e) => setComp270m(e.target.value)}
            className="min-h-[38px] w-full rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 py-1.5 font-mono text-xs text-[#2C2621] placeholder:text-[#6B6860] focus:border-[#EA580C] focus:outline-none"
          />
        </div>

        <div className="space-y-1.5">
          <span className="block text-[11px] font-bold text-[#2C2621]">
            Android Tier &gt;= 8 GB (Gemma 3 1B)
          </span>
          <input
            type="url"
            placeholder="URL .task (1B)"
            value={url1b}
            onChange={(e) => setUrl1b(e.target.value)}
            className="min-h-[38px] w-full rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 py-1.5 font-mono text-xs text-[#2C2621] placeholder:text-[#6B6860] focus:border-[#EA580C] focus:outline-none"
          />
          <input
            type="url"
            placeholder="URL .litertlm opcional (1B)"
            value={comp1b}
            onChange={(e) => setComp1b(e.target.value)}
            className="min-h-[38px] w-full rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 py-1.5 font-mono text-xs text-[#2C2621] placeholder:text-[#6B6860] focus:border-[#EA580C] focus:outline-none"
          />
        </div>

        <label className="block space-y-1">
          <span className="text-[11px] font-bold text-[#2C2621]">URI WebGPU (solo modo Forzar WebGPU)</span>
          <input
            type="text"
            placeholder="assets/models/llm.task"
            value={customUri}
            onChange={(e) => setCustomUri(e.target.value)}
            className="min-h-[38px] w-full rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 py-1.5 font-mono text-xs text-[#2C2621] placeholder:text-[#6B6860] focus:border-[#EA580C] focus:outline-none"
          />
        </label>

        <div className="grid grid-cols-3 gap-2">
          <label className="space-y-1">
            <span className="text-[10px] font-semibold text-[#6B6860]">maxTokens</span>
            <input
              type="number"
              value={maxTokens}
              onChange={(e) => setMaxTokens(e.target.value)}
              className="min-h-[38px] w-full rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-2 py-1.5 font-mono-nums text-xs text-[#2C2621] focus:border-[#EA580C] focus:outline-none"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] font-semibold text-[#6B6860]">Temp.</span>
            <input
              type="text"
              value={temperatureStr}
              onChange={(e) => setTemperatureStr(e.target.value)}
              className="min-h-[38px] w-full rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-2 py-1.5 font-mono-nums text-xs text-[#2C2621] focus:border-[#EA580C] focus:outline-none"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] font-semibold text-[#6B6860]">topK</span>
            <input
              type="number"
              value={topk}
              onChange={(e) => setTopk(e.target.value)}
              className="min-h-[38px] w-full rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-2 py-1.5 font-mono-nums text-xs text-[#2C2621] focus:border-[#EA580C] focus:outline-none"
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-2 pt-1">
          <button
            type="submit"
            data-testid="superadmin-save-btn"
            disabled={busy}
            className="min-h-[42px] rounded-xl border border-[#E5DFD2] bg-[#F5F1E6] font-bold text-[#2C2621] cursor-pointer"
          >
            Guardar config
          </button>
          <button
            type="button"
            data-testid="superadmin-apply-btn"
            disabled={busy}
            onClick={() => void handleApplyAndDownload()}
            className="min-h-[42px] rounded-xl bg-[#4B7094] font-bold text-[#FFFDF9] cursor-pointer"
          >
            Descargar / Aplicar
          </button>
        </div>
      </form>

      <button
        type="button"
        data-testid="superadmin-delete-btn"
        disabled={busy}
        onClick={() => void handleDeleteLocalModel()}
        className="min-h-10 w-full rounded-xl border border-[#DC2626]/30 bg-[#FAD2D8] font-bold text-[#5A121C] cursor-pointer"
      >
        Borrar modelo descargado del dispositivo
      </button>

      {/* Prueba rápida */}
      <div className="space-y-1.5 border-t border-[#E5DFD2] pt-2.5">
        <span className="block text-[11px] font-bold text-[#2C2621]">Probar inferencia</span>
        <div className="flex gap-1.5">
          <input
            type="text"
            data-testid="superadmin-test-prompt-input"
            value={testPrompt}
            onChange={(e) => setTestPrompt(e.target.value)}
            className="min-h-[40px] flex-1 rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-2.5 py-1.5 text-xs text-[#2C2621] focus:border-[#EA580C] focus:outline-none"
          />
          <button
            type="button"
            data-testid="superadmin-test-prompt-btn"
            disabled={busy}
            onClick={() => void handleQuickPromptTest()}
            className="min-h-[40px] rounded-xl bg-[#059669] px-3 py-1.5 font-bold text-white cursor-pointer"
          >
            Probar
          </button>
        </div>
        {testOutput && (
          <pre
            data-testid="superadmin-test-output"
            className="max-h-40 overflow-auto rounded-xl border border-[#E5DFD2] bg-[#F5F1E6] p-2.5 font-mono text-[10px] text-[#1B3A24]"
          >
            {testOutput}
          </pre>
        )}
      </div>
    </section>
  );
}
