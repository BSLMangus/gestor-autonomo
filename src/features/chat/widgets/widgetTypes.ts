import type {
  ActiveWidgetEnvelope,
  CameraCaptureResult,
  ClientRow,
  HumanDecision,
  LocalFileBridge,
  PendingGate,
  QuickAction,
  SiteLogRecord,
  SqliteExecutor,
  TurnExecutionResult,
} from "../../../core/contracts/types";
import type { DocumentOpenerService } from "../../../core/files/documentOpener";
import type { CameraAdapter } from "../../../core/hardware/cameraAdapter";
import type { AppRoute } from "../../../core/navigation/routes";
import type { PdfPort } from "../../../core/ports/mediaPorts";
import type { SiteLogService } from "../../sitelog/siteLogService";

export interface WidgetRuntimeContext {
  executor: SqliteExecutor;
  fileBridge: LocalFileBridge;
  pdfPort: PdfPort;
  documentOpener: DocumentOpenerService;
  cameraAdapter: CameraAdapter;
  siteLogService: SiteLogService;
  onCapturePhoto?: (
    source: "scan_ticket" | "site_log" | "chat" | "global_camera",
    activeJobId: string | null
  ) => Promise<CameraCaptureResult>;
  onOpenPdf?: (pdfUri: string | null, docKind: "quote" | "invoice", docId: string) => Promise<void>;
  onDataMutated?: () => Promise<void> | void;
  onNavigateRoute?: (route: AppRoute) => void;
  onSiteLogSaved?: (log: SiteLogRecord, jobCode: string) => void;
  onClientSaved?: (client: ClientRow, isNew: boolean) => void;
  onScheduleSaved?: (payload: { mode: "daily_log" | "plan_range"; message: string }) => void;
  onGate4ShareFinished?: (payload: {
    docKind: "quote" | "invoice";
    docId: string;
    shareFeedback?: string;
  }) => void;
  onDismissOverlay?: () => void;
}

export interface WidgetCommonProps {
  widget: ActiveWidgetEnvelope;
  isActiveGate: boolean;
  activePendingGate: PendingGate | null;
  isSubmitting: boolean;
  runtime: WidgetRuntimeContext;
  onResumeDecision: (decision: HumanDecision) => Promise<TurnExecutionResult | null>;
  onQuickAction: (action: QuickAction) => Promise<void>;
}

export function getOverlayMetaForWidget(widget: ActiveWidgetEnvelope): {
  badge: string;
  title: string;
} {
  switch (widget.ui_widget_type) {
    case "QuoteBuilderWidget":
      return {
        badge: "Generative UI · Presupuesto",
        title: widget.widget_payload.job_title || "Nuevo presupuesto",
      };
    case "TicketOcrValidatorWidget":
      return {
        badge: "Generative UI · Ticket OCR",
        title: widget.widget_payload.supplier_name || "Validar gasto deducible",
      };
    case "JobLifecycleActionWidget":
      return {
        badge: "Generative UI · Expediente y Facturación",
        title:
          widget.widget_payload.mode === "preview_gate_3"
            ? "Emitir factura correlativa"
            : widget.widget_payload.mode === "preview_gate_4"
              ? "Preparar y compartir documento"
              : "Acciones de obra",
      };
    case "SiteLogStampWidget":
      return {
        badge: "Generative UI · Diario de Obra",
        title: "Sellar foto / nota de avance",
      };
    case "FiscalPiggyBankWidget":
      return {
        badge: "Generative UI · Hucha Fiscal",
        title: `Reserva trimestral · ${widget.widget_payload.quarter}`,
      };
    case "ClientProfileWidget":
      return {
        badge: "Generative UI · Ficha de Cliente",
        title: widget.widget_payload.client_id ? "Editar cliente" : "Nuevo cliente",
      };
    case "ScheduleWorkLogWidget":
      return {
        badge: "Generative UI · Agenda y Jornada",
        title:
          widget.widget_payload.mode === "plan_range"
            ? "Planificar fechas en calendario"
            : `Parte del día · ${widget.widget_payload.date_iso}`,
      };
  }
}
