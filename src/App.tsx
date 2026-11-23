import { App as CapacitorApp } from "@capacitor/app";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DemoSeeder } from "./agent/demoSeeder";
import type { GraphRunner, StorageMode } from "./agent/graphRunner";
import type { LocalInferenceAdapterImpl } from "./agent/inference/localInferenceAdapter";
import type {
  ActiveWidgetEnvelope,
  CameraCaptureResult,
  ChatMessageRecord,
  ChatThreadRecord,
  DocumentImportReviewDraft,
  HumanDecision,
  InterruptPayload,
  LocalAccountRecord,
  LocalFileBridge,
  MemoryCoordinator,
  PendingCameraContext,
  PendingGate,
  QuickAction,
  RecoveredDraft,
  SqliteExecutor,
  TurnExecutionResult,
} from "./core/contracts/types";
import { AuthRepository } from "./core/db/repositories/authRepo";
import { ChatRepository } from "./core/db/repositories/chatRepo";
import { SettingsRepository } from "./core/db/repositories/settingsRepo";
import type { DocumentOpenerService } from "./core/files/documentOpener";
import { formatLocalDateTimeIso } from "./core/fiscal/dateQuarter";
import type { CameraAdapter } from "./core/hardware/cameraAdapter";
import type { VoiceInputAdapter } from "./core/hardware/voiceAdapter";
import { BACK_PRIORITY, getRouteTitle, useAppRouter, type AppRoute } from "./core/navigation/routes";
import type { OcrPort, PdfPort, WatermarkPort } from "./core/ports/mediaPorts";
import { ApkUpdaterService, type AvailableUpdateInfo } from "./core/updates/apkUpdaterService";
import { AuthScreen } from "./features/auth/AuthScreen";
import { ChatTimelineView } from "./features/chat/ChatTimelineView";
import {
  GenerativeWidgetOverlay,
  type ProtagonistOverlayState,
} from "./features/chat/widgets/GenerativeWidgetOverlay";
import { getOverlayMetaForWidget, type WidgetRuntimeContext } from "./features/chat/widgets/widgetTypes";
import { ClientProfileView } from "./features/clients/ClientProfileView";
import { ClientsView } from "./features/clients/ClientsView";
import { CalendarScheduleView } from "./features/calendar/CalendarScheduleView";
import { FiscalDashboardView } from "./features/fiscal/FiscalDashboardView";
import { TicketDetailView } from "./features/fiscal/TicketDetailView";
import { HomeHubView } from "./features/home/HomeHubView";
import { InspectorView } from "./features/inspector/InspectorView";
import { InvoiceDetailView } from "./features/invoices/InvoiceDetailView";
import { JobsView } from "./features/jobs/JobsView";
import type { CapacitorLlmAdapter } from "./features/llm/capacitorLlmAdapter";
import type { MediaPipeLlmAdapter } from "./features/llm/mediaPipeAdapter";
import { OnboardingWizard } from "./features/onboarding/OnboardingWizard";
import { PricingCatalogView } from "./features/pricing/PricingCatalogView";
import { QuoteDetailView } from "./features/quotes/QuoteDetailView";
import { QuotesView } from "./features/quotes/QuotesView";
import { SettingsSheet } from "./features/settings/SettingsSheet";
import type { SiteLogService } from "./features/sitelog/siteLogService";
import { UpdateBanner } from "./features/updates/UpdateBanner";
import { AppNavigationDrawer } from "./ui/AppNavigationDrawer";
import { BottomQuickBar } from "./ui/BottomQuickBar";
import { GlobalCameraChoiceSheet } from "./ui/GlobalCameraChoiceSheet";
import { GlobalVoiceOverlay } from "./ui/GlobalVoiceOverlay";
import { GuardBanners } from "./ui/GuardBanners";
import { MobileShell } from "./ui/MobileShell";

export interface AppRuntime {
  executor: SqliteExecutor;
  fileBridge: LocalFileBridge;
  memoryCoordinator: MemoryCoordinator;
  inferenceAdapter: LocalInferenceAdapterImpl;
  mediaPipeAdapter: MediaPipeLlmAdapter;
  capacitorLlmAdapter: CapacitorLlmAdapter;
  ocrPort: OcrPort;
  pdfPort: PdfPort;
  watermarkPort: WatermarkPort;
  documentOpener: DocumentOpenerService;
  cameraAdapter: CameraAdapter;
  voiceAdapter: VoiceInputAdapter;
  siteLogService: SiteLogService;
  graphRunner: GraphRunner;
  demoSeeder: DemoSeeder;
  storageMode: StorageMode;
  initialStorageError: string | null;
  initialRecoveredDrafts: RecoveredDraft[];
  consumePendingCameraRestores?: () => Array<{
    mediaUri: string;
    context: PendingCameraContext;
  }>;
  onCameraRestoredSubscribe?: (
    cb: (event: { mediaUri: string; context: PendingCameraContext }) => void
  ) => () => void;
}

interface ToastNotification {
  message: string;
  pdfAction?: {
    pdfUri: string | null;
    docKind: "quote" | "invoice";
    docId: string;
  };
}

function buildEnvelopeFromInterrupt(interrupt: InterruptPayload): ActiveWidgetEnvelope {
  if (interrupt.ui_widget_type === "QuoteBuilderWidget") {
    return {
      ui_widget_type: "QuoteBuilderWidget",
      widget_payload: {
        ...interrupt.proposed_payload,
        subtotal_cents: 0,
        vat_cents: 0,
        total_cents: 0,
      },
    };
  }
  if (interrupt.ui_widget_type === "TicketOcrValidatorWidget") {
    return {
      ui_widget_type: "TicketOcrValidatorWidget",
      widget_payload: {
        ...interrupt.proposed_payload,
        ocr_fallback_reason: null,
      },
    };
  }
  if (interrupt.gate_id === "gate_3_invoice") {
    return {
      ui_widget_type: "JobLifecycleActionWidget",
      widget_payload: {
        job_id: interrupt.proposed_payload.job_id,
        quote_id: interrupt.proposed_payload.quote_id,
        invoice_id: null,
        mode: "preview_gate_3",
        pdf_uri: null,
        gate_3_draft: interrupt.proposed_payload,
      },
    };
  }
  return {
    ui_widget_type: "JobLifecycleActionWidget",
    widget_payload: {
      job_id: interrupt.proposed_payload.document_id,
      quote_id:
        interrupt.proposed_payload.document_kind === "quote"
          ? interrupt.proposed_payload.document_id
          : null,
      invoice_id:
        interrupt.proposed_payload.document_kind === "invoice"
          ? interrupt.proposed_payload.document_id
          : null,
      mode: "preview_gate_4",
      pdf_uri: null,
      gate_4_draft: interrupt.proposed_payload,
    },
  };
}

export function App({ runtime }: { runtime: AppRuntime }) {
  const {
    executor,
    fileBridge,
    memoryCoordinator,
    inferenceAdapter,
    mediaPipeAdapter,
    capacitorLlmAdapter,
    ocrPort,
    pdfPort,
    documentOpener,
    cameraAdapter,
    voiceAdapter,
    siteLogService,
    graphRunner,
  } = runtime;

  const authRepo = useMemo(() => new AuthRepository(executor), [executor]);
  const chatRepo = useMemo(() => new ChatRepository(executor), [executor]);
  const settingsRepo = useMemo(() => new SettingsRepository(executor), [executor]);
  const apkUpdaterService = useMemo(() => new ApkUpdaterService(), []);

  const [authLoading, setAuthLoading] = useState(true);
  const [hasExistingAccounts, setHasExistingAccounts] = useState(false);
  const [activeAccount, setActiveAccount] = useState<LocalAccountRecord | null>(null);
  const [availableUpdate, setAvailableUpdate] = useState<AvailableUpdateInfo | null>(null);
  const [updateDismissed, setUpdateDismissed] = useState(false);
  const lastUpdateCheckAtRef = useRef<number>(0);

  const { route, navigate, goBack, registerBackHandler } = useAppRouter({ name: "home" });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [voiceOverlayOpen, setVoiceOverlayOpen] = useState(false);
  const [pendingCameraMediaUri, setPendingCameraMediaUri] = useState<string | null>(null);

  const [threads, setThreads] = useState<ChatThreadRecord[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const activeThreadIdRef = useRef<string | null>(null);
  const selectAndSetActiveThreadId = useCallback((tid: string | null) => {
    activeThreadIdRef.current = tid;
    setActiveThreadId(tid);
  }, []);

  const [activeThread, setActiveThread] = useState<ChatThreadRecord | null>(null);
  const [messages, setMessages] = useState<ChatMessageRecord[]>([]);
  const [checkpointStatus, setCheckpointStatus] = useState<"idle" | "interrupted">("idle");
  const [activeInterrupt, setActiveInterrupt] = useState<InterruptPayload | null>(null);

  const [protagonistOverlay, setProtagonistOverlay] = useState<ProtagonistOverlayState | null>(
    null
  );
  const [overlayError, setOverlayError] = useState<string | null>(null);

  const [recoveredDrafts, setRecoveredDrafts] = useState<RecoveredDraft[]>(
    runtime.initialRecoveredDrafts
  );
  const [storageError] = useState<string | null>(runtime.initialStorageError);
  const [uiError, setUiError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastNotification | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [superAdminUnlocked, setSuperAdminUnlocked] = useState(false);

  const showCleanToast = useCallback((nextToast: ToastNotification) => {
    setToast(nextToast);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => {
      setToast(null);
    }, 6000);
    return () => clearTimeout(timer);
  }, [toast]);

  const loadThreadsAndActive = useCallback(
    async (explicitThreadId?: string | null) => {
      const [allThreads, drafts] = await Promise.all([
        chatRepo.listThreads(),
        settingsRepo.listActiveRecoveredDrafts(),
      ]);
      setThreads(allThreads);
      setRecoveredDrafts(drafts);

      const targetId =
        explicitThreadId === null ? null : (explicitThreadId ?? activeThreadIdRef.current);

      if (!targetId) {
        selectAndSetActiveThreadId(null);
        setActiveThread(null);
        setMessages([]);
        setCheckpointStatus("idle");
        setActiveInterrupt(null);
        return null;
      }

      const st = await graphRunner.getThreadState(targetId);
      selectAndSetActiveThreadId(st.thread.thread_id);
      setActiveThread(st.thread);
      setMessages(st.messages);
      setCheckpointStatus(st.checkpointStatus);
      setActiveInterrupt(st.activeInterrupt);
      return st;
    },
    [chatRepo, settingsRepo, graphRunner, selectAndSetActiveThreadId]
  );

  useEffect(() => {
    void loadThreadsAndActive(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!apkUpdaterService.isSupported()) return;
    let active = true;
    const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

    const runSilentCheck = async (force = false) => {
      const now = Date.now();
      if (!force && now - lastUpdateCheckAtRef.current < SIX_HOURS_MS) return;
      lastUpdateCheckAtRef.current = now;
      const res = await apkUpdaterService.checkForUpdate();
      if (!active) return;
      if (res.status === "available") {
        setAvailableUpdate(res.update);
        setUpdateDismissed(false);
      }
    };

    void runSilentCheck(true);

    let listenerHandle: { remove: () => Promise<void> } | null = null;
    void CapacitorApp.addListener("appStateChange", ({ isActive }) => {
      if (isActive) {
        void runSilentCheck(false);
      }
    })
      .then((h) => {
        if (!active) {
          void h.remove();
        } else {
          listenerHandle = h;
        }
      })
      .catch(() => undefined);

    return () => {
      active = false;
      void listenerHandle?.remove();
    };
  }, [apkUpdaterService]);

  useEffect(() => {
    let active = true;
    Promise.all([authRepo.hasAnyAccount(), authRepo.getActiveAccount()])
      .then(([hasAny, acc]) => {
        if (!active) return;
        setHasExistingAccounts(hasAny);
        setActiveAccount(acc);
      })
      .finally(() => {
        if (active) setAuthLoading(false);
      });
    return () => {
      active = false;
    };
  }, [authRepo]);

  const handleLogout = useCallback(async () => {
    setDrawerOpen(false);
    setVoiceOverlayOpen(false);
    setPendingCameraMediaUri(null);
    setProtagonistOverlay(null);
    setOverlayError(null);
    await authRepo.logout();
    selectAndSetActiveThreadId(null);
    await loadThreadsAndActive(null);
    setActiveAccount(null);
    setHasExistingAccounts(true);
    navigate({ name: "home" }, { replace: true });
  }, [authRepo, selectAndSetActiveThreadId, loadThreadsAndActive, navigate]);

  const handleReopenOnboarding = useCallback(async () => {
    if (!activeAccount) return;
    const updated = await authRepo.reopenOnboarding(activeAccount.id);
    setActiveAccount(updated);
  }, [authRepo, activeAccount]);

  const openWidgetInOverlay = useCallback(
    (params: {
      widget: ActiveWidgetEnvelope;
      isActiveGate: boolean;
      activePendingGate: PendingGate | null;
      source?: "thread" | "direct";
    }) => {
      const meta = getOverlayMetaForWidget(params.widget);
      setOverlayError(null);
      setProtagonistOverlay({
        kind: "a2ui",
        badge: meta.badge,
        title: meta.title,
        widget: params.widget,
        isActiveGate: params.isActiveGate,
        activePendingGate: params.activePendingGate,
        source: params.source ?? "thread",
      });
    },
    []
  );

  const openOverlayFromTurnResult = useCallback(
    (res: TurnExecutionResult) => {
      if (!res.active_widget) return;
      const pendingGate =
        res.checkpoint_status === "interrupted" && res.active_interrupt
          ? res.active_interrupt.gate_id
          : null;
      openWidgetInOverlay({
        widget: res.active_widget,
        isActiveGate: pendingGate !== null,
        activePendingGate: pendingGate,
        source: "thread",
      });
    },
    [openWidgetInOverlay]
  );

  const openDirectSiteLogWidget = useCallback((rawMediaUri: string | null, activeJobId: string | null) => {
    const envelope: ActiveWidgetEnvelope = {
      ui_widget_type: "SiteLogStampWidget",
      widget_payload: {
        candidate_job_id: activeJobId,
        category: "antes",
        note_text: "",
        raw_media_uri: rawMediaUri,
        stamp_preview_meta: {
          job_code: null,
          client_name: null,
          timestamp_iso: formatLocalDateTimeIso(Date.now()),
        },
      },
    };
    openWidgetInOverlay({
      widget: envelope,
      isActiveGate: false,
      activePendingGate: null,
      source: "direct",
    });
  }, [openWidgetInOverlay]);

  const ensureWritableThread = useCallback(
    async (preferredJobId?: string | null): Promise<{
      threadId: string;
      activeJobId: string | null;
      activeQuoteId: string | null;
    }> => {
      const currentTid = activeThreadIdRef.current;
      if (currentTid) {
        const thr = await chatRepo.getThread(currentTid);
        if (thr && thr.status !== "interrupted") {
          return {
            threadId: thr.thread_id,
            activeJobId: preferredJobId ?? thr.active_job_id,
            activeQuoteId: thr.active_quote_id,
          };
        }
      }
      const created = await graphRunner.createThread({
        title: preferredJobId ? "Presupuesto de obra" : "Nueva conversación",
        active_job_id: preferredJobId ?? null,
      });
      await loadThreadsAndActive(created.thread_id);
      return {
        threadId: created.thread_id,
        activeJobId: created.active_job_id,
        activeQuoteId: created.active_quote_id,
      };
    },
    [chatRepo, graphRunner, loadThreadsAndActive]
  );

  const runTurnAndOpenOverlay = useCallback(
    async (params: {
      text: string;
      action_type?: Parameters<GraphRunner["runTurn"]>[1]["action_type"];
      target_ids?: Parameters<GraphRunner["runTurn"]>[1]["target_ids"];
      billing_sub_intent?: Parameters<GraphRunner["runTurn"]>[1]["billing_sub_intent"];
      disambiguation_choice?: Parameters<GraphRunner["runTurn"]>[1]["disambiguation_choice"];
      quarter?: string;
      raw_media_uri?: string;
      media_kind?: "ticket_photo" | "site_photo" | "voice_transcript";
      threadTitleIfNew?: string;
      forceNewThread?: boolean;
      navigateToChatIfNoWidget?: boolean;
    }): Promise<TurnExecutionResult | null> => {
      setUiError(null);
      setIsSubmitting(true);
      try {
        let targetTid = params.forceNewThread ? null : activeThreadIdRef.current;
        let sessionJobId: string | null = params.target_ids?.job_id ?? null;
        let sessionQuoteId: string | null = params.target_ids?.quote_id ?? null;

        if (!params.forceNewThread && targetTid) {
          const thr = await chatRepo.getThread(targetTid);
          if (thr && thr.status !== "interrupted") {
            sessionJobId = sessionJobId ?? thr.active_job_id;
            sessionQuoteId = sessionQuoteId ?? thr.active_quote_id;
          } else {
            targetTid = null;
          }
        }

        if (!targetTid) {
          const created = await graphRunner.createThread({
            title: params.threadTitleIfNew ?? "Nueva conversación",
            active_job_id: sessionJobId,
          });
          targetTid = created.thread_id;
        }

        const res = await graphRunner.runTurn(targetTid, {
          client_turn_id: `turn_${crypto.randomUUID().slice(0, 10)}`,
          text: params.text,
          action_type: params.action_type ?? "free_text_or_voice",
          target_ids: params.target_ids,
          billing_sub_intent: params.billing_sub_intent,
          disambiguation_choice: params.disambiguation_choice,
          quarter: params.quarter,
          raw_media_uri: params.raw_media_uri,
          media_kind: params.media_kind,
          session_context: {
            active_job_id: sessionJobId,
            active_quote_id: sessionQuoteId,
          },
        });

        await loadThreadsAndActive(targetTid);
        setRefreshTick((t) => t + 1);

        if (params.forceNewThread || (!res.active_widget && params.navigateToChatIfNoWidget)) {
          navigate({ name: "chat" });
        }
        if (res.active_widget) {
          openOverlayFromTurnResult(res);
        }
        return res;
      } catch (err) {
        setUiError(err instanceof Error ? err.message : String(err));
        return null;
      } finally {
        setIsSubmitting(false);
      }
    },
    [chatRepo, graphRunner, loadThreadsAndActive, openOverlayFromTurnResult, navigate]
  );

  const handleScanTicketWithUri = useCallback(
    async (mediaUri: string, preferredThreadId?: string | null, preferredJobId?: string | null) => {
      setUiError(null);
      setIsSubmitting(true);
      try {
        let targetTid: string | null = preferredThreadId ?? activeThreadIdRef.current;
        if (targetTid) {
          const thr = await chatRepo.getThread(targetTid);
          if (!thr || thr.status === "interrupted") {
            targetTid = null;
          }
        }
        if (!targetTid) {
          targetTid = (await graphRunner.createThread({ title: "Ticket escaneado" })).thread_id;
        }

        const res = await graphRunner.runTurn(targetTid, {
          client_turn_id: `turn_${crypto.randomUUID().slice(0, 10)}`,
          text: "",
          action_type: "scan_ticket",
          raw_media_uri: mediaUri,
          media_kind: "ticket_photo",
          session_context: {
            active_job_id: preferredJobId ?? activeThread?.active_job_id ?? null,
            active_quote_id: null,
          },
        });
        await loadThreadsAndActive(targetTid);
        setRefreshTick((t) => t + 1);
        openOverlayFromTurnResult(res);
      } catch (err) {
        setUiError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsSubmitting(false);
      }
    },
    [chatRepo, graphRunner, activeThread, loadThreadsAndActive, openOverlayFromTurnResult]
  );

  const handleRestoredCameraEvent = useCallback(
    async ({ mediaUri, context }: { mediaUri: string; context: PendingCameraContext }) => {
      if (context.source === "global_camera") {
        setPendingCameraMediaUri(mediaUri);
        return;
      }
      if (context.source === "site_log") {
        openDirectSiteLogWidget(mediaUri, context.active_job_id);
        return;
      }
      if (context.source === "scan_ticket" || context.source === "chat") {
        await handleScanTicketWithUri(mediaUri, context.thread_id, context.active_job_id);
      }
    },
    [openDirectSiteLogWidget, handleScanTicketWithUri]
  );

  // Consome restauraciones tempranas de Process Death y suscribe futuras
  useEffect(() => {
    const queued = runtime.consumePendingCameraRestores?.() ?? [];
    for (const ev of queued) {
      void handleRestoredCameraEvent(ev);
    }
    if (!runtime.onCameraRestoredSubscribe) return;
    return runtime.onCameraRestoredSubscribe(async (ev) => {
      await handleRestoredCameraEvent(ev);
    });
  }, [runtime, handleRestoredCameraEvent]);

  const handleGlobalCameraTrigger = useCallback(async () => {
    setUiError(null);
    const capture: CameraCaptureResult = await cameraAdapter.captureOrPick(
      "global_camera",
      activeThreadIdRef.current,
      activeThread?.active_job_id ?? null
    );
    if (capture.status === "cancelled") return;
    if (capture.status === "permission_denied") {
      setUiError(
        "Permiso de cámara o galería denegado. Revisa los permisos de Gestor Autónomo en Ajustes."
      );
      return;
    }
    if (capture.status === "error") {
      setUiError(capture.reason);
      return;
    }
    setPendingCameraMediaUri(capture.media_uri);
  }, [cameraAdapter, activeThread]);

  const handleSendText = async (text: string) => {
    await runTurnAndOpenOverlay({
      text,
      action_type: "free_text_or_voice",
      navigateToChatIfNoWidget: false,
    });
  };

  const handleGlobalVoiceSubmit = async (text: string) => {
    setVoiceOverlayOpen(false);
    const cleanTitle = text.trim().slice(0, 48) || "Nota de voz";
    await runTurnAndOpenOverlay({
      text,
      action_type: "free_text_or_voice",
      media_kind: "voice_transcript",
      forceNewThread: true,
      threadTitleIfNew: cleanTitle,
      navigateToChatIfNoWidget: true,
    });
  };

  const handleStartEmptyQuote = async () => {
    await runTurnAndOpenOverlay({
      text: "",
      action_type: "start_empty_quote",
      threadTitleIfNew: "Nuevo presupuesto",
    });
  };

  const handleStartJobQuote = async (jobId: string) => {
    await runTurnAndOpenOverlay({
      text: "",
      action_type: "start_job_quote",
      target_ids: { job_id: jobId },
      threadTitleIfNew: "Presupuesto de obra",
    });
  };

  const handleQuickManualTicket = async () => {
    await runTurnAndOpenOverlay({
      text: "",
      action_type: "manual_ticket_entry",
      threadTitleIfNew: "Alta manual de ticket",
    });
  };

  const handleResumeDecision = async (
    decision: HumanDecision
  ): Promise<TurnExecutionResult | null> => {
    const submittedThreadId = activeThreadIdRef.current;
    if (!submittedThreadId) return null;
    setOverlayError(null);
    setUiError(null);
    setIsSubmitting(true);

    try {
      const res = await graphRunner.resumeGate(submittedThreadId, decision);

      if (activeThreadIdRef.current === submittedThreadId) {
        await loadThreadsAndActive(submittedThreadId);
      } else {
        setThreads(await chatRepo.listThreads());
      }
      setRefreshTick((t) => t + 1);

      if (res.error_code !== null) {
        const msg =
          res.assistant_message?.content ||
          `No se pudo completar la operación (${res.error_code}).`;
        setOverlayError(msg);
        return res;
      }

      if (decision.action === "reject") {
        setProtagonistOverlay(null);
        setOverlayError(null);
        showCleanToast({ message: "Borrador descartado sin guardar cambios." });
        return res;
      }

      // Gate 4 Share difiere el autocierre hasta terminar Share nativo/Web
      if (decision.gate_id === "gate_4_share") {
        return res;
      }

      // Aceptar / Editar en Gate 1, Gate 2, Gate 3 -> autocierre + confirmación limpia
      setProtagonistOverlay(null);
      setOverlayError(null);

      if (decision.gate_id === "gate_1_quote") {
        const lp =
          res.active_widget?.ui_widget_type === "JobLifecycleActionWidget"
            ? res.active_widget.widget_payload
            : null;
        showCleanToast({
          message: "Presupuesto guardado y PDF generado.",
          ...(lp?.quote_id
            ? {
                pdfAction: {
                  pdfUri: lp.pdf_uri,
                  docKind: "quote",
                  docId: lp.quote_id,
                },
              }
            : {}),
        });
      } else if (decision.gate_id === "gate_2_ticket") {
        showCleanToast({ message: "Ticket de gasto archivado en tu Hucha Fiscal." });
      } else if (decision.gate_id === "gate_3_invoice") {
        const lp =
          res.active_widget?.ui_widget_type === "JobLifecycleActionWidget"
            ? res.active_widget.widget_payload
            : null;
        showCleanToast({
          message: "Factura correlativa emitida y PDF generado.",
          ...(lp?.invoice_id
            ? {
                pdfAction: {
                  pdfUri: lp.pdf_uri,
                  docKind: "invoice",
                  docId: lp.invoice_id,
                },
              }
            : {}),
        });
      }

      return res;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setOverlayError(msg);
      return null;
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleQuickAction = async (action: QuickAction) => {
    setOverlayError(null);
    const { threadId, activeJobId, activeQuoteId } = await ensureWritableThread(
      action.payload?.target_ids?.job_id ?? null
    );
    setIsSubmitting(true);
    try {
      const res = await graphRunner.runTurn(threadId, {
        client_turn_id: `turn_${crypto.randomUUID().slice(0, 10)}`,
        text: action.payload?.text ?? "",
        action_type: action.action_type,
        target_ids: action.payload?.target_ids,
        billing_sub_intent: action.payload?.billing_sub_intent,
        disambiguation_choice: action.payload?.disambiguation_choice,
        quarter: action.payload?.quarter,
        session_context: {
          active_job_id: activeJobId,
          active_quote_id: activeQuoteId,
        },
      });
      await loadThreadsAndActive(threadId);
      setRefreshTick((t) => t + 1);
      if (res.active_widget) {
        openOverlayFromTurnResult(res);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (protagonistOverlay) setOverlayError(msg);
      else setUiError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCloseOrRejectOverlay = useCallback(async () => {
    if (!protagonistOverlay || isSubmitting) return;
    if (protagonistOverlay.kind === "document_import") {
      setProtagonistOverlay(null);
      setOverlayError(null);
      showCleanToast({ message: "Importación cancelada sin modificar el tarifario." });
      return;
    }

    if (
      !overlayError &&
      protagonistOverlay.isActiveGate &&
      protagonistOverlay.activePendingGate
    ) {
      await handleResumeDecision({
        gate_id: protagonistOverlay.activePendingGate,
        action: "reject",
        rejection_reason: "Cerrado por el usuario",
        client_validated_at_ms: Date.now(),
      });
      return;
    }

    if (protagonistOverlay.widget.ui_widget_type === "SiteLogStampWidget") {
      const tempUri = protagonistOverlay.widget.widget_payload.raw_media_uri;
      if (tempUri) {
        await fileBridge.deleteIfTemp(tempUri).catch(() => undefined);
      }
    }

    setProtagonistOverlay(null);
    setOverlayError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [protagonistOverlay, isSubmitting, overlayError, fileBridge, showCleanToast]);

  // Registra prioridad de botón físico Atrás (Android Capacitor) para capas globales
  useEffect(() => {
    if (!voiceOverlayOpen) return;
    return registerBackHandler(BACK_PRIORITY.VOICE_OVERLAY, () => {
      void voiceAdapter.stop?.();
      setVoiceOverlayOpen(false);
      return true;
    });
  }, [voiceOverlayOpen, registerBackHandler, voiceAdapter]);

  useEffect(() => {
    if (!pendingCameraMediaUri) return;
    return registerBackHandler(BACK_PRIORITY.CAMERA_SHEET, () => {
      const uri = pendingCameraMediaUri;
      setPendingCameraMediaUri(null);
      void fileBridge.deleteIfTemp(uri).catch(() => undefined);
      return true;
    });
  }, [pendingCameraMediaUri, registerBackHandler, fileBridge]);

  useEffect(() => {
    if (!protagonistOverlay) return;
    return registerBackHandler(BACK_PRIORITY.WIDGET_OVERLAY, () => {
      void handleCloseOrRejectOverlay();
      return true;
    });
  }, [protagonistOverlay, registerBackHandler, handleCloseOrRejectOverlay]);

  useEffect(() => {
    if (!drawerOpen) return;
    return registerBackHandler(BACK_PRIORITY.NAV_DRAWER, () => {
      setDrawerOpen(false);
      return true;
    });
  }, [drawerOpen, registerBackHandler]);

  const widgetRuntime: WidgetRuntimeContext = {
    executor,
    fileBridge,
    pdfPort,
    documentOpener,
    cameraAdapter,
    siteLogService,
    voiceAdapter,
    inferenceAdapter,
    registerBackHandler,
    onCapturePhoto: async (source, activeJobId) =>
      cameraAdapter.captureOrPick(source, activeThreadIdRef.current, activeJobId),
    onDataMutated: async () => {
      setRefreshTick((t) => t + 1);
      if (activeThreadIdRef.current) {
        await loadThreadsAndActive(activeThreadIdRef.current);
      }
    },
    onNavigateRoute: (targetRoute: AppRoute) => {
      navigate(targetRoute);
    },
    onSiteLogSaved: async (_log, jobCode) => {
      setProtagonistOverlay(null);
      setOverlayError(null);
      setRefreshTick((t) => t + 1);
      showCleanToast({ message: `Entrada sellada y guardada en diario de ${jobCode}.` });
    },
    onClientSaved: (client, isNew) => {
      setProtagonistOverlay(null);
      setOverlayError(null);
      setRefreshTick((t) => t + 1);
      showCleanToast({
        message: isNew
          ? `Cliente «${client.name}» creado correctamente.`
          : `Ficha de «${client.name}» actualizada.`,
      });
    },
    onScheduleSaved: ({ message }) => {
      setProtagonistOverlay(null);
      setOverlayError(null);
      setRefreshTick((t) => t + 1);
      showCleanToast({ message });
    },
    onGate4ShareFinished: ({ shareFeedback }) => {
      setProtagonistOverlay(null);
      setOverlayError(null);
      setRefreshTick((t) => t + 1);
      showCleanToast({
        message: shareFeedback || "Documento preparado para compartir.",
      });
    },
    onDismissOverlay: () => {
      setProtagonistOverlay(null);
      setOverlayError(null);
    },
  };

  const activeDisplayTitle = activeThread?.title
    ? activeThread.title.replace(/\s*\((?:Pausa HITL|Validar Gate \d+)\)/gi, "").trim()
    : "Nueva conversación";

  const headerTitle =
    route.name === "chat" && activeThread ? activeDisplayTitle : getRouteTitle(route);

  const handleOpenDocumentImport = (
    draft: DocumentImportReviewDraft,
    currentHourlyRateCents: number
  ) => {
    setOverlayError(null);
    setProtagonistOverlay({
      kind: "document_import",
      badge: "Importador IA Offline",
      title: "Revisar tarifas y partidas extraídas",
      draft,
      currentHourlyRateCents,
    });
  };

  if (authLoading) {
    return (
      <div className="flex h-dvh items-center justify-center bg-surface text-xs font-semibold text-on-surface-variant">
        Cargando cuenta local...
      </div>
    );
  }

  const visibleUpdateBanner =
    availableUpdate && !updateDismissed ? (
      <UpdateBanner
        update={availableUpdate}
        updaterService={apkUpdaterService}
        onDismiss={availableUpdate.mandatory ? undefined : () => setUpdateDismissed(true)}
      />
    ) : null;

  if (!activeAccount) {
    return (
      <div className="min-h-dvh bg-surface">
        {visibleUpdateBanner && <div className="px-4 pt-3">{visibleUpdateBanner}</div>}
        <AuthScreen
          executor={executor}
          hasExistingAccounts={hasExistingAccounts}
          onAuthenticated={async (account) => {
            setActiveAccount(account);
            setHasExistingAccounts(true);
            selectAndSetActiveThreadId(null);
            await loadThreadsAndActive(null);
            setRefreshTick((t) => t + 1);
            navigate({ name: "home" }, { replace: true });
          }}
        />
      </div>
    );
  }

  if (!activeAccount.onboarding_completed) {
    return (
      <div className="min-h-dvh bg-surface">
        {visibleUpdateBanner && <div className="px-4 pt-3">{visibleUpdateBanner}</div>}
        <OnboardingWizard
          account={activeAccount}
          executor={executor}
          ocrPort={ocrPort}
          onFinished={async () => {
            const fresh = await authRepo.getActiveAccount();
            setActiveAccount(fresh);
            setRefreshTick((t) => t + 1);
            navigate({ name: "home" }, { replace: true });
          }}
        />
      </div>
    );
  }

  return (
    <>
      <MobileShell
        currentRoute={route}
        headerTitle={headerTitle}
        isSubmitting={isSubmitting}
        onOpenDrawer={() => setDrawerOpen(true)}
        onNavigateHome={() => navigate({ name: "home" })}
        onOpenVoice={() => setVoiceOverlayOpen(true)}
        onTriggerCamera={() => void handleGlobalCameraTrigger()}
        banners={
          <>
            {visibleUpdateBanner && <div className="bg-surface px-4 pt-2">{visibleUpdateBanner}</div>}
            <GuardBanners
              storageError={storageError}
              recoveredDrafts={recoveredDrafts}
              onReopenDraft={async (draftId) => {
                const res = await graphRunner.reopenRecoveredDraft(draftId);
                await loadThreadsAndActive(res.thread_id);
                navigate({ name: "chat" });
                openOverlayFromTurnResult(res);
              }}
              onDismissDraft={async (draftId) => {
                await settingsRepo.dismissRecoveredDraft(draftId);
                setRecoveredDrafts(await settingsRepo.listActiveRecoveredDrafts());
              }}
            />
            {uiError && (
              <div className="bg-surface px-4 pt-2">
                <div
                  role="alert"
                  className="flex items-center justify-between gap-2 rounded-2xl border border-coral-alert/30 bg-error-container px-3.5 py-2.5 text-xs text-on-error-container"
                >
                  <span>{uiError}</span>
                  <button
                    type="button"
                    onClick={() => setUiError(null)}
                    className="font-bold text-on-error-container"
                  >
                    ✕
                  </button>
                </div>
              </div>
            )}
            {toast && (
              <div className="bg-surface px-4 pt-2">
                <div
                  data-testid="app-confirmation-toast"
                  role="status"
                  className="flex items-center justify-between gap-2 rounded-2xl border border-outline-variant bg-success-container px-3.5 py-2.5 text-xs font-semibold text-on-success-container"
                >
                  <span className="min-w-0 flex-1">{toast.message}</span>
                  {toast.pdfAction && (
                    <button
                      type="button"
                      data-testid="toast-open-pdf-btn"
                      onClick={() =>
                        void documentOpener.openPdf(
                          toast.pdfAction!.pdfUri,
                          toast.pdfAction!.docKind,
                          toast.pdfAction!.docId,
                          pdfPort
                        )
                      }
                      className="shrink-0 rounded-xl bg-emerald-free px-3 py-1.5 text-[11px] font-bold text-white"
                    >
                      Abrir PDF
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setToast(null)}
                    className="shrink-0 font-bold text-on-success-container"
                  >
                    ✕
                  </button>
                </div>
              </div>
            )}
          </>
        }
        bottomComposer={
          route.name === "chat" ? (
            <BottomQuickBar
              isInterrupted={checkpointStatus === "interrupted"}
              pendingGate={activeInterrupt?.gate_id ?? null}
              isSubmitting={isSubmitting}
              onSendText={handleSendText}
              onOpenActiveInterrupt={
                checkpointStatus === "interrupted" && activeInterrupt
                  ? () => {
                      const matchingMsg = [...messages]
                        .reverse()
                        .find(
                          (m) =>
                            m.widget_json?.ui_widget_type === activeInterrupt.ui_widget_type
                        );
                      openWidgetInOverlay({
                        widget:
                          matchingMsg?.widget_json ?? buildEnvelopeFromInterrupt(activeInterrupt),
                        isActiveGate: true,
                        activePendingGate: activeInterrupt.gate_id,
                        source: "thread",
                      });
                    }
                  : undefined
              }
            />
          ) : undefined
        }
      >
        {route.name === "home" && (
          <HomeHubView
            executor={executor}
            refreshTick={refreshTick}
            onNavigate={(next) => navigate(next)}
          />
        )}

        {route.name === "chat" && (
          <ChatTimelineView
            threadTitle={activeDisplayTitle}
            messages={messages}
            checkpointStatus={checkpointStatus}
            activeInterrupt={activeInterrupt}
            isSubmitting={isSubmitting}
            onQuickAction={handleQuickAction}
            onOpenWidget={(params) => openWidgetInOverlay({ ...params, source: "thread" })}
          />
        )}

        {route.name === "jobs" && (
          <JobsView
            executor={executor}
            fileBridge={fileBridge}
            refreshTick={refreshTick}
            initialFocusJobId={route.focusJobId ?? null}
            voiceAdapter={voiceAdapter}
            inferenceAdapter={inferenceAdapter}
            onStartJobQuote={handleStartJobQuote}
            onOpenClient={(cid) => navigate({ name: "client_detail", clientId: cid })}
            onOpenQuote={(qid) => navigate({ name: "quote_detail", quoteId: qid })}
            onOpenInvoice={(iid) => navigate({ name: "invoice_detail", invoiceId: iid })}
            onOpenTicket={(tid) => navigate({ name: "ticket_detail", ticketId: tid })}
            onDataChanged={async () => {
              setRefreshTick((t) => t + 1);
            }}
            registerBackHandler={registerBackHandler}
          />
        )}

        {route.name === "calendar" && (
          <CalendarScheduleView
            executor={executor}
            refreshTick={refreshTick}
            initialFocusDateIso={route.focusDateIso}
            voiceAdapter={voiceAdapter}
            inferenceAdapter={inferenceAdapter}
            registerBackHandler={registerBackHandler}
            onOpenScheduleWidget={(widget) =>
              openWidgetInOverlay({
                widget,
                isActiveGate: false,
                activePendingGate: null,
                source: "direct",
              })
            }
            onDataChanged={async () => {
              setRefreshTick((t) => t + 1);
            }}
          />
        )}

        {route.name === "quotes" && (
          <QuotesView
            executor={executor}
            refreshTick={refreshTick}
            onStartEmptyQuote={handleStartEmptyQuote}
            onOpenQuoteDetail={(qid) => navigate({ name: "quote_detail", quoteId: qid })}
          />
        )}

        {route.name === "quote_detail" && (
          <QuoteDetailView
            quoteId={route.quoteId}
            executor={executor}
            pdfPort={pdfPort}
            documentOpener={documentOpener}
            refreshTick={refreshTick}
            onBack={() => navigate({ name: "quotes" })}
            onOpenJob={(jobId) => navigate({ name: "jobs", focusJobId: jobId })}
            onOpenClient={(cid) => navigate({ name: "client_detail", clientId: cid })}
            onOpenInvoice={(iid) => navigate({ name: "invoice_detail", invoiceId: iid })}
            onStartJobQuote={handleStartJobQuote}
            onRunQuoteLifecycleAction={async (params) => {
              await runTurnAndOpenOverlay({
                text: "",
                action_type: params.action_type,
                target_ids: {
                  job_id: params.job_id,
                  quote_id: params.quote_id,
                },
                billing_sub_intent: params.billing_sub_intent,
              });
            }}
            onDataChanged={async () => {
              setRefreshTick((t) => t + 1);
            }}
          />
        )}

        {route.name === "invoice_detail" && (
          <InvoiceDetailView
            invoiceId={route.invoiceId}
            executor={executor}
            pdfPort={pdfPort}
            documentOpener={documentOpener}
            refreshTick={refreshTick}
            onBack={() => {
              goBack();
            }}
            onOpenJob={(jobId) => navigate({ name: "jobs", focusJobId: jobId })}
            onOpenClient={(cid) => navigate({ name: "client_detail", clientId: cid })}
            onOpenQuote={(qid) => navigate({ name: "quote_detail", quoteId: qid })}
            onOpenInvoice={(iid) => navigate({ name: "invoice_detail", invoiceId: iid })}
            onShareInvoice={async (inv) => {
              await runTurnAndOpenOverlay({
                text: "",
                action_type: "request_share_gate",
                target_ids: {
                  job_id: inv.job_id,
                  quote_id: inv.quote_id,
                  invoice_id: inv.id,
                },
                billing_sub_intent: "share",
              });
            }}
            onDataChanged={async () => {
              setRefreshTick((t) => t + 1);
            }}
          />
        )}

        {route.name === "ticket_detail" && (
          <TicketDetailView
            ticketId={route.ticketId}
            executor={executor}
            fileBridge={fileBridge}
            refreshTick={refreshTick}
            voiceAdapter={voiceAdapter}
            inferenceAdapter={inferenceAdapter}
            registerBackHandler={registerBackHandler}
            onBack={() => {
              goBack();
            }}
            onOpenJob={(jobId) => navigate({ name: "jobs", focusJobId: jobId })}
            onDataChanged={async () => {
              setRefreshTick((t) => t + 1);
            }}
          />
        )}

        {route.name === "clients" && (
          <ClientsView
            executor={executor}
            refreshTick={refreshTick}
            onSelectClient={(cid) => navigate({ name: "client_detail", clientId: cid })}
            onOpenNewClientWidget={() =>
              openWidgetInOverlay({
                widget: {
                  ui_widget_type: "ClientProfileWidget",
                  widget_payload: {
                    client_id: null,
                    name: "",
                    phone: "",
                    nif: "",
                    fiscal_address: "",
                    email: "",
                    notes: "",
                    validation_hint: null,
                  },
                },
                isActiveGate: false,
                activePendingGate: null,
                source: "direct",
              })
            }
          />
        )}

        {route.name === "client_detail" && (
          <ClientProfileView
            clientId={route.clientId}
            executor={executor}
            refreshTick={refreshTick}
            onBackToClients={() => navigate({ name: "clients" })}
            onOpenJob={(jobId) => navigate({ name: "jobs", focusJobId: jobId })}
            onOpenQuote={(qid) => navigate({ name: "quote_detail", quoteId: qid })}
            onOpenInvoice={(iid) => navigate({ name: "invoice_detail", invoiceId: iid })}
            onStartJobQuote={handleStartJobQuote}
            onOpenEditWidget={(cl) =>
              openWidgetInOverlay({
                widget: {
                  ui_widget_type: "ClientProfileWidget",
                  widget_payload: {
                    client_id: cl.id,
                    name: cl.name,
                    phone: cl.phone,
                    nif: cl.nif,
                    fiscal_address: cl.fiscal_address,
                    email: cl.email,
                    notes: cl.notes,
                    validation_hint: null,
                  },
                },
                isActiveGate: false,
                activePendingGate: null,
                source: "direct",
              })
            }
            onDataChanged={async () => {
              setRefreshTick((t) => t + 1);
            }}
          />
        )}

        {route.name === "fiscal" && (
          <FiscalDashboardView
            executor={executor}
            fileBridge={fileBridge}
            refreshTick={refreshTick}
            onQuickManualTicket={handleQuickManualTicket}
            onOpenInvoice={(iid) => navigate({ name: "invoice_detail", invoiceId: iid })}
            onOpenTicket={(tid) => navigate({ name: "ticket_detail", ticketId: tid })}
            registerBackHandler={registerBackHandler}
          />
        )}

        {route.name === "activity" && (
          <InspectorView executor={executor} refreshTick={refreshTick} />
        )}

        {route.name === "pricing" && (
          <PricingCatalogView
            executor={executor}
            ocrPort={ocrPort}
            refreshTick={refreshTick}
            voiceAdapter={voiceAdapter}
            inferenceAdapter={inferenceAdapter}
            registerBackHandler={registerBackHandler}
            onOpenDocumentImport={handleOpenDocumentImport}
            onDataChanged={async () => {
              setRefreshTick((t) => t + 1);
            }}
          />
        )}

        {route.name === "settings" && (
          <SettingsSheet
            executor={executor}
            inferenceAdapter={inferenceAdapter}
            mediaPipeAdapter={mediaPipeAdapter}
            capacitorLlmAdapter={capacitorLlmAdapter}
            memoryCoordinator={memoryCoordinator}
            ocrPort={ocrPort}
            voiceAdapter={voiceAdapter}
            refreshTick={refreshTick}
            activeSection={route.section ?? "general"}
            activeAccount={activeAccount}
            onSelectSection={(sec) => navigate({ name: "settings", section: sec })}
            onOpenDocumentImport={handleOpenDocumentImport}
            superAdminUnlocked={superAdminUnlocked}
            onSetSuperAdminUnlocked={setSuperAdminUnlocked}
            onDataRebuilt={async (options) => {
              if (options?.resetRoute) {
                selectAndSetActiveThreadId(null);
                await loadThreadsAndActive(null);
                navigate({ name: "home" }, { replace: true });
              }
              setRefreshTick((t) => t + 1);
            }}
            onReopenOnboarding={handleReopenOnboarding}
            onLogout={handleLogout}
            apkUpdaterService={apkUpdaterService}
            onUpdateFound={(upd) => {
              setAvailableUpdate(upd);
              setUpdateDismissed(false);
            }}
            registerBackHandler={registerBackHandler}
          />
        )}
      </MobileShell>

      <AppNavigationDrawer
        open={drawerOpen}
        currentRoute={route}
        threads={threads}
        activeThreadId={activeThreadId}
        activeAccount={activeAccount}
        onClose={() => setDrawerOpen(false)}
        onNavigate={(next) => navigate(next)}
        onLogout={handleLogout}
        onSelectThread={async (tid) => {
          selectAndSetActiveThreadId(tid);
          try {
            await graphRunner.switchThread(tid);
            const st = await loadThreadsAndActive(tid);
            navigate({ name: "chat" });
            if (st && st.checkpointStatus === "interrupted" && st.activeInterrupt) {
              const matchingMsg = [...st.messages]
                .reverse()
                .find(
                  (m) => m.widget_json?.ui_widget_type === st.activeInterrupt?.ui_widget_type
                );
              openWidgetInOverlay({
                widget:
                  matchingMsg?.widget_json ?? buildEnvelopeFromInterrupt(st.activeInterrupt),
                isActiveGate: true,
                activePendingGate: st.activeInterrupt.gate_id,
                source: "thread",
              });
            }
          } catch (err) {
            setUiError(err instanceof Error ? err.message : String(err));
          } finally {
            setDrawerOpen(false);
          }
        }}
        onCreateThread={async () => {
          const thr = await graphRunner.createThread({ title: "Nueva conversación" });
          await loadThreadsAndActive(thr.thread_id);
          navigate({ name: "chat" });
          setDrawerOpen(false);
        }}
      />

      <GlobalVoiceOverlay
        open={voiceOverlayOpen}
        voiceAdapter={voiceAdapter}
        isSubmitting={isSubmitting}
        onSubmitTranscript={handleGlobalVoiceSubmit}
        onClose={() => setVoiceOverlayOpen(false)}
      />

      <GlobalCameraChoiceSheet
        mediaUri={pendingCameraMediaUri}
        fileBridge={fileBridge}
        isSubmitting={isSubmitting}
        onChooseTicket={async (mediaUri) => {
          setPendingCameraMediaUri(null);
          await handleScanTicketWithUri(mediaUri);
        }}
        onChooseSiteLog={(mediaUri) => {
          setPendingCameraMediaUri(null);
          openDirectSiteLogWidget(mediaUri, activeThread?.active_job_id ?? null);
        }}
        onCancel={async (mediaUri) => {
          setPendingCameraMediaUri(null);
          await fileBridge.deleteIfTemp(mediaUri).catch(() => undefined);
        }}
      />

      <GenerativeWidgetOverlay
        overlay={protagonistOverlay}
        overlayError={overlayError}
        isSubmitting={isSubmitting}
        runtime={widgetRuntime}
        onResumeDecision={handleResumeDecision}
        onQuickAction={handleQuickAction}
        onDocumentImportCommitted={async (res) => {
          setProtagonistOverlay(null);
          setOverlayError(null);
          setRefreshTick((t) => t + 1);
          showCleanToast({
            message: `Importación completada: ${res.savedCount} partida(s) guardadas en tu tarifario.`,
          });
        }}
        onCloseOrReject={() => void handleCloseOrRejectOverlay()}
      />
    </>
  );
}

export default App;
